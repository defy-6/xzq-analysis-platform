#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""诊断脚本：检验用地/POI 数据对引力模型（区县对联系）的增量解释力。

思路：
  1. 以 model-results.json 的 378 个区县对为样本，重建当前基准模型
     ln(1+Y) = b0 + b1·log_pop_mass + b2·log_gdp_mass + b3·log_distance
     复现 R²，确认脚本与现模型口径一致；
  2. 从 land-use.json / public-services.json 构造区县对级候选变量
     （规模合计 sum、对数乘积 logprod、异质性 absdiff、结构相似度等）；
  3. 对 4 个因变量（population_flow/branch/investment/patent）逐个做
     "基准 + 候选变量" 回归，报告 ΔadjR²、系数、p 值，筛出有增量解释力
     的用地/POI 变量；
  4. 相关性矩阵 + VIF 诊断共线性，为最终模型选变量提供依据。

用法：python3 apps/web/scripts/diagnose_quadrant_variables.py
输出：终端报告 + data/processed/contact-quadrants/diagnostic-report-<ts>.md
"""
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.stats.outliers_influence import variance_inflation_factor

ROOT = Path(__file__).resolve().parents[3]
MODEL = ROOT / "data/processed/contact-quadrants/current-model/model-results.json"
LAND = ROOT / "apps/web/public/data/land-use.json"
POI = ROOT / "apps/web/public/data/public-services.json"
OUT_DIR = ROOT / "data/processed/contact-quadrants"

DEPENDENTS = ["population_flow", "branch", "investment", "patent"]
BASELINE = ["log_pop_mass", "log_gdp_mass", "log_distance"]
DEP_LABEL = {"population_flow": "人口流动", "branch": "分支", "investment": "投资", "patent": "专利"}

# 区县级候选指标（用地 + POI），每个都会合成对级变量
LAND_METRICS = {
    "开发强度": "developmentIntensity",
    "中心功能指数": "centralFunctionIndex",
    "交通门户指数": "transportGatewayIndex",
    "用地混合度": "landUseMix",
    "工业仓储占比": "industryWarehouseShare",
    "商业占比": "commercialShare",
    "城乡居住结构比": "urbanRuralHousingRatio",
    "产业功能LQ": "lq_产业功能",
}
POI_METRICS = {
    "POI有效功能总量": "poi_total",
    "每万人口POI": "poi_per10k",
    "每km2建设用地POI": "poi_per_km2",
    "公共服务POI": "poi_public",
    "商业消费POI": "poi_commerce",
    "产业就业POI": "poi_industry",
    "服务/产业比": "poi_service_industry_ratio",
}


def load_data():
    """读取三个数据源，返回区县级指标表 + 区县对表。"""
    model = json.load(open(MODEL, encoding="utf-8"))
    land_records = json.load(open(LAND, encoding="utf-8"))["records"]
    poi = json.load(open(POI, encoding="utf-8"))

    # ---- 区县级指标 ----
    county = {}
    for r in land_records:
        d = {k: r[k] for k in LAND_METRICS.values() if k in r}
        for lq_key in ("产业功能",):
            if lq_key in r.get("lq", {}):
                d["lq_产业功能"] = r["lq"][lq_key]
        county[r["county"]] = d

    poi_county = defaultdict(lambda: dict.fromkeys(poi["meta"]["functionalCategories"], 0))
    for _city, cnty, cat, n in poi["functionalRecords"]:
        poi_county[cnty][cat] += n
    poi_ctx = poi["countyContext"]
    poi_total = poi["countyTotals"]
    cats = poi["meta"]["functionalCategories"]
    service_cats = ["公共管理", "教育文化", "医疗健康"]
    commerce_cats = ["商业消费", "餐饮休闲"]
    industry_cats = ["产业就业", "物流服务"]

    for cnty in county:
        f = poi_county.get(cnty, {})
        total = poi_total.get(cnty, 0)
        ctx = poi_ctx.get(cnty, {})
        pop = ctx.get("residentPopulationWan", 0) or 0
        cons_km2 = (ctx.get("constructionAreaHa", 0) or 0) / 100
        county[cnty]["poi_total"] = total
        county[cnty]["poi_per10k"] = total / pop if pop else 0
        county[cnty]["poi_per_km2"] = total / cons_km2 if cons_km2 else 0
        county[cnty]["poi_public"] = sum(f.get(c, 0) for c in service_cats)
        county[cnty]["poi_commerce"] = sum(f.get(c, 0) for c in commerce_cats)
        county[cnty]["poi_industry"] = sum(f.get(c, 0) for c in industry_cats)
        serv = county[cnty]["poi_public"] + county[cnty]["poi_commerce"]
        county[cnty]["poi_service_industry_ratio"] = serv / county[cnty]["poi_industry"] if county[cnty]["poi_industry"] else 0.0
        county[cnty]["_poi_share_vector"] = np.array([f.get(c, 0) for c in cats], dtype=float)
        s = county[cnty]["_poi_share_vector"].sum()
        county[cnty]["_poi_share_vector"] = county[cnty]["_poi_share_vector"] / s if s else county[cnty]["_poi_share_vector"]

    # ---- 区县对表 ----
    pairs = []
    missing = set()
    for r in model["rows"]:
        a, b = r["county_a"], r["county_b"]
        for c in (a, b):
            if c not in county:
                missing.add(c)
        pairs.append(r)
    if missing:
        print(f"[警告] model-results 中存在不在 land/poi 的区县: {sorted(missing)}")
    return county, pairs


def cosine_sim(u, v):
    nu, nv = np.linalg.norm(u), np.linalg.norm(v)
    if nu == 0 or nv == 0:
        return 0.0
    return float(np.dot(u, v) / (nu * nv))


def build_pair_frame(county, pairs):
    """构造 378 行的区县对 DataFrame：控制变量、因变量、候选变量。"""
    rows = []
    for r in pairs:
        ca, cb = county[r["county_a"]], county[r["county_b"]]
        row = {
            "pair": r["pair"],
            "flow_type": r.get("flow_type", ""),
            "same_city": 1 if r.get("city_a") == r.get("city_b") else 0,
        }
        for b in BASELINE:
            row[b] = r[b]
        for dep in DEPENDENTS:
            row[f"y_{dep}"] = math.log(1.0 + max(0.0, r[dep]))
        # 候选：对级合成
        for label, key in {**LAND_METRICS, **POI_METRICS}.items():
            xa, xb = ca[key], cb[key]
            row[f"cand_{key}__sum"] = xa + xb
            row[f"cand_{key}__logprod"] = math.log(1.0 + xa * xb) if xa * xb > 0 else 0.0
            row[f"cand_{key}__absdiff"] = abs(xa - xb)
        row["cand_poi_structure_cosine"] = cosine_sim(ca["_poi_share_vector"], cb["_poi_share_vector"])
        row["cand_land_mix_absdiff"] = abs(ca["landUseMix"] - cb["landUseMix"])
        rows.append(row)
    return pd.DataFrame(rows)


def fit(df, dep, extra_cols):
    """基准 + 候选列 的 OLS，返回 (adjR2, 新增列系数, 新增列p值)。"""
    y = df[f"y_{dep}"]
    x_cols = BASELINE + list(extra_cols)
    X = sm.add_constant(df[x_cols])
    m = sm.OLS(y, X).fit()
    new_extra = extra_cols[0] if extra_cols else None
    coef = m.params[new_extra] if new_extra else None
    pval = m.pvalues[new_extra] if new_extra else None
    return m.rsquared_adj, coef, pval


def main():
    county, pairs = load_data()
    df = build_pair_frame(county, pairs)
    print(f"样本：{len(df)} 个区县对；跨市 {int((df.same_city == 0).sum())}，市内 {int((df.same_city == 1).sum())}")

    report = []
    report.append("# 引力模型扩展变量诊断报告\n")
    report.append(f"样本：{len(df)} 个区县对；基准模型 `ln(1+Y) = b0 + b1·log_pop_mass + b2·log_gdp_mass + b3·log_distance`\n")
    report.append("判据：ΔadjR²（相对基准的调整 R² 提升）、新增变量系数与 p 值（p<0.05 为显著）。\n")

    # ---- 1. 基准复现 ----
    print("\n==== 1. 基准模型复现 ====")
    report.append("## 1. 基准模型复现\n")
    report.append("| 因变量 | adjR² |")
    report.append("|---|---|")
    for dep in DEPENDENTS:
        adj, _, _ = fit(df, dep, [])
        print(f"  {DEP_LABEL[dep]:<6} adjR² = {adj:.4f}")
        report.append(f"| {DEP_LABEL[dep]} | {adj:.4f} |")

    # ---- 2. 单变量增量检验 ----
    print("\n==== 2. 候选变量增量解释力（ΔadjR²，加粗=显著 p<0.05） ====")
    report.append("\n## 2. 候选变量增量解释力\n")
    report.append("ΔadjR² 正值表示在基准之上有增量解释力；`*` 表示系数 p<0.05。\n")
    report.append("| 候选变量 | 人口流动 | 分支 | 投资 | 专利 | 平均 |")
    report.append("|---|---|---|---|---|---|")

    cand_cols = [c for c in df.columns if c.startswith("cand_")]
    # 去掉结构相似度的冗余副本（land_mix_absdiff 与 cand_landUseMix__absdiff 重复）
    summary = []
    for col in cand_cols:
        deltas = {}
        for dep in DEPENDENTS:
            adj0, _, _ = fit(df, dep, [])
            adj1, coef, pval = fit(df, dep, [col])
            deltas[dep] = (adj1 - adj0, coef, pval)
        avg = np.mean([d[0] for d in deltas.values()])
        summary.append((col, deltas, avg))

    summary.sort(key=lambda t: -t[2])
    for col, deltas, avg in summary:
        cells = []
        for dep in DEPENDENTS:
            d, coef, pval = deltas[dep]
            sig = "*" if (pval is not None and pval < 0.05) else ""
            cells.append(f"{d:+.4f}{sig}")
        report.append(f"| {col} | " + " | ".join(cells) + f" | {avg:+.4f} |")
        print(f"  {col:<45} ΔadjR²: " + "  ".join(cells) + f"   平均 {avg:+.4f}")

    # ---- 3. 相关性 + VIF ----
    print("\n==== 3. 共线性诊断 ====")
    report.append("\n## 3. 共线性诊断\n")

    # 与基准变量相关性最高的候选（按 |r| 排序）
    corr_rows = []
    base_cols = BASELINE + ["same_city"]
    for col in cand_cols:
        for bc in base_cols:
            r = df[col].corr(df[bc])
            if abs(r) > 0.5:
                corr_rows.append((col, bc, r))
    corr_rows.sort(key=lambda t: -abs(t[2]))
    report.append("与基准控制变量 |r|>0.5 的候选（共线性预警）：\n")
    report.append("| 候选变量 | 基准变量 | 相关系数 |")
    report.append("|---|---|---|")
    seen = set()
    for col, bc, r in corr_rows:
        if (col, bc) in seen:
            continue
        seen.add((col, bc))
        report.append(f"| {col} | {bc} | {r:+.3f} |")
        print(f"  候选 {col:<45} × {bc:<14} r = {r:+.3f}")

    # VIF：对 4 个因变量综合表现最好的前 6 个候选，与基准变量一起算 VIF
    top6 = [c for c, _, _ in summary[:6]]
    vif_cols = BASELINE + top6
    X = sm.add_constant(df[vif_cols])
    vif_report = []
    for i, c in enumerate(vif_cols, start=1):
        vif = variance_inflation_factor(X.values, i)
        vif_report.append((c, vif))
    report.append("\n基准 + 最优前 6 候选的 VIF（>10 提示严重共线）：\n")
    report.append("| 变量 | VIF |")
    report.append("|---|---|")
    for c, v in vif_report:
        report.append(f"| {c} | {v:.1f} |")
        print(f"  VIF {c:<45} = {v:.1f}")

    # ---- 4. 结论建议 ----
    print("\n==== 4. 结论建议 ====")
    report.append("\n## 4. 结论建议\n")
    strong = [(c, d, avg) for c, d, avg in summary if avg > 0.005]
    report.append("平均 ΔadjR² > 0.005 的候选变量（优先纳入最终模型）：\n")
    for c, d, avg in strong[:12]:
        report.append(f"- `{c}`  平均 ΔadjR² {avg:+.4f}")
    if not strong:
        report.append("- 无。现有基准模型已较饱和，或需更换变量构造方式。")
    report.append("\n> 注意：ΔadjR² 仅为单变量增量，正式建模需综合变量间共线性、样本量（378）"
                 "与方向一致性后再取舍；用地为单期横截面、POI 为 2024 年，年份口径与人口/企业数据需复核。")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    from datetime import datetime
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = OUT_DIR / f"diagnostic-report-{ts}.md"
    out.write_text("\n".join(report), encoding="utf-8")
    print(f"\n报告已写入: {out}")


if __name__ == "__main__":
    main()
