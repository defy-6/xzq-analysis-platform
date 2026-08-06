from __future__ import annotations

import json
import math
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np


PLATFORM_ROOT = Path(__file__).resolve().parents[4]
MODEL_DIR = PLATFORM_ROOT / "data" / "processed" / "contact-quadrants" / "current-model"
MODEL = MODEL_DIR / "model-results.json"
BASELINE = MODEL_DIR / "baseline-straight-line-model-results.json"
TRANSPORT = Path(__file__).resolve().parents[2] / "public" / "data" / "transport-accessibility.json"
LAND_USE = Path(__file__).resolve().parents[2] / "public" / "data" / "land-use.json"
PUBLIC_SERVICES = Path(__file__).resolve().parents[2] / "public" / "data" / "public-services.json"
METRICS = ["population_flow", "branch", "investment", "patent"]
# 用地/POI 扩展变量：仅加入企业三类子模型（人口流动子模型保持原口径，见诊断结论）
EXTRA_METRICS = ["branch", "investment", "patent"]
EXTRA_COLUMNS = ["function_intensity_sum"]
# 合成"功能强度指数"的区县级原始指标（三者 z-score 标准化后取均值）
FUNCTION_INTENSITY_METRICS = ["commercial_share", "central_function_index", "poi_density"]


def average_rank_percentile(values):
    order = sorted(range(len(values)), key=lambda index: values[index])
    ranks = [0.0] * len(values)
    position = 0
    while position < len(order):
        end = position + 1
        while end < len(order) and values[order[end]] == values[order[position]]:
            end += 1
        average_rank = ((position + 1) + end) / 2
        for slot in order[position:end]:
            ranks[slot] = (average_rank - 1) / (len(values) - 1)
        position = end
    return ranks


def fit(rows, metric):
    columns = ["log_pop_mass", "log_gdp_mass", "log_distance"]
    if metric in EXTRA_METRICS:
        columns += EXTRA_COLUMNS
    matrix = np.array([[1.0] + [row[c] for c in columns] for row in rows], dtype=float)
    target = np.log1p(np.array([row[metric] for row in rows], dtype=float))
    beta, *_ = np.linalg.lstsq(matrix, target, rcond=None)
    predicted_log = matrix @ beta
    residual = target - predicted_log
    rmse = float(np.sqrt(np.mean(residual ** 2)))
    r2 = float(1 - np.sum(residual ** 2) / np.sum((target - target.mean()) ** 2))
    smearing = float(np.mean(np.exp(residual)))
    expected = np.exp(predicted_log) * smearing - 1
    z = residual / rmse
    formula = "ln(1+Y)=alpha+b1*ln(popA*popB)+b2*ln(gdpA*gdpB)+gamma*ln(distance)"
    if metric in EXTRA_METRICS:
        formula += "+d1*functionIntensitySum"
    return {
        "metric": metric,
        "intercept": float(beta[0]),
        "coefficients": {c: float(beta[i + 1]) for i, c in enumerate(columns)},
        "r2": r2,
        "rmse": rmse,
        "smearing": smearing,
        "formula": formula,
    }, expected, z


def load_county_extension():
    """读取用地（商业占比、中心功能指数）与 POI（建成密度）数据，
    将三者区县级 z-score 标准化后取均值，合成区县级"功能强度指数"。"""
    land = {r["county"]: r for r in json.loads(LAND_USE.read_text(encoding="utf-8"))["records"]}
    poi = json.loads(PUBLIC_SERVICES.read_text(encoding="utf-8"))
    poi_total = poi["countyTotals"]
    poi_ctx = poi["countyContext"]
    raw = {}
    for county, rec in land.items():
        cons_km2 = (poi_ctx.get(county, {}).get("constructionAreaHa", 0) or 0) / 100
        raw[county] = {
            "commercial_share": rec.get("commercialShare", 0.0) or 0.0,
            "central_function_index": rec.get("centralFunctionIndex", 0.0) or 0.0,
            "poi_density": (poi_total.get(county, 0) or 0) / cons_km2 if cons_km2 else 0.0,
        }
    counties = list(raw)
    arrays = {}
    for metric in FUNCTION_INTENSITY_METRICS:
        values = np.array([raw[c][metric] for c in counties], dtype=float)
        std = values.std(ddof=1)
        arrays[metric] = (values - values.mean()) / std if std > 0 else np.zeros_like(values)
    out = {}
    for index, county in enumerate(counties):
        out[county] = {
            "function_intensity": float(np.mean([arrays[m][index] for m in FUNCTION_INTENSITY_METRICS])),
        }
    return out


def main():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if not BASELINE.exists():
        shutil.copy2(MODEL, BASELINE)
    source = json.loads(BASELINE.read_text(encoding="utf-8"))
    transport = json.loads(TRANSPORT.read_text(encoding="utf-8"))
    extension = load_county_extension()
    distance_by_pair = {
        frozenset(((row[0], row[1]), (row[2], row[3]))): row[5]
        for row in transport["pairRecords"]
    }
    rows = source["rows"]
    missing = []
    for row in rows:
        key = frozenset(((row["city_a"], row["county_a"]), (row["city_b"], row["county_b"])))
        distance = distance_by_pair.get(key)
        if not distance:
            missing.append(row["pair"])
            continue
        row["distance_km"] = distance
        row["log_distance"] = math.log(distance)
        ext_a, ext_b = extension[row["county_a"]], extension[row["county_b"]]
        row["function_intensity_sum"] = ext_a["function_intensity"] + ext_b["function_intensity"]
    if missing:
        raise ValueError(f"有 {len(missing)} 个区县对未匹配驾车距离: {missing[:5]}")

    params = []
    z_values = {}
    for metric in METRICS:
        param, expected, z = fit(rows, metric)
        params.append(param)
        z_values[metric] = z
        for index, row in enumerate(rows):
            row[f"{metric}_expected"] = float(expected[index])
            row[f"{metric}_z"] = float(z[index])

    enterprise_metrics = ["branch", "investment", "patent"]
    r2_total = sum(next(param["r2"] for param in params if param["metric"] == metric) for metric in enterprise_metrics)
    weights = {metric: next(param["r2"] for param in params if param["metric"] == metric) / r2_total for metric in enterprise_metrics}
    raw = np.array([sum(weights[metric] * row[f"{metric}_z"] for metric in enterprise_metrics) for row in rows])
    normalized = (raw - raw.mean()) / raw.std(ddof=1)
    population_pct = average_rank_percentile([row["population_flow"] for row in rows])
    metric_pct = {metric: average_rank_percentile([row[metric] for row in rows]) for metric in enterprise_metrics}

    type_map = {
        ("高", 1): "成熟协调型", ("高", 2): "成熟核心·产业协同提升型", ("高", 3): "规模强但协同不足型", ("高", 4): "成熟核心·人口联系提升型",
        ("低", 1): "潜在成长型", ("低", 2): "生活联系先导型", ("低", 3): "核心网络边缘型", ("低", 4): "产业联系先导型",
    }
    quadrant_names = {1: "Ⅰ 人口、企业均超预期", 2: "Ⅱ 人口超预期、企业低预期", 3: "Ⅲ 人口、企业均低预期", 4: "Ⅳ 人口低预期、企业超预期"}
    for index, row in enumerate(rows):
        row["enterprise_z_raw"] = float(raw[index])
        row["enterprise_z"] = float(normalized[index])
        row["population_abs_pct"] = population_pct[index]
        for metric in enterprise_metrics:
            row[f"{metric}_abs_pct"] = metric_pct[metric][index]
        row["enterprise_abs_pct"] = sum(weights[metric] * metric_pct[metric][index] for metric in enterprise_metrics)
        row["absolute_composite"] = math.sqrt(row["population_abs_pct"] * row["enterprise_abs_pct"])
        quadrant = 1 if row["population_flow_z"] >= 0 and row["enterprise_z"] >= 0 else 2 if row["population_flow_z"] >= 0 else 4 if row["enterprise_z"] >= 0 else 3
        row["quadrant"] = quadrant
        row["quadrant_name"] = quadrant_names[quadrant]
        row["absolute_level"] = "高" if row["population_abs_pct"] >= .8 and row["enterprise_abs_pct"] >= .8 else "低"
        row["function_type"] = type_map[(row["absolute_level"], quadrant)]
    rows.sort(key=lambda row: row["absolute_composite"], reverse=True)
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank

    output = {
        "rows": rows,
        "params": params,
        "weights": weights,
        "meta": {
            **source.get("meta", {}),
            "distance_source": transport["meta"]["source"],
            "distance_definition": transport["meta"]["distanceDefinition"],
            "distance_pair_count": len(distance_by_pair),
            "recalculated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "baseline_model": BASELINE.name,
            "extension_variables": {
                "metrics": EXTRA_METRICS,
                "columns": EXTRA_COLUMNS,
                "description": "企业三类子模型在基准上新增区县对级变量 function_intensity_sum（两端功能强度指数合计）；该指数由商业用地占比、中心功能指数、建设用地POI密度三个区县级指标 z-score 标准化后取均值合成，避免三指标共线。人口流动子模型保持原口径。",
                "land_use_source": LAND_USE.name,
                "public_services_source": PUBLIC_SERVICES.name,
            },
        },
    }
    MODEL.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(MODEL), "pairCount": len(rows), "weights": weights, "params": params}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
