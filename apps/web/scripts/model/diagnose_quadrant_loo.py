#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""稳健性检验：留一区县（LOO）检验诊断脚本筛出的最强候选变量。

问题：diagnose_quadrant_variables.py 报告的 ΔadjR² 可能是由个别强势区县
（如厦门岛内思明/湖里）的对拉动。本脚本对每个最强候选变量做：
  1. 全样本回归（基准 + 候选），记录系数与显著性；
  2. 依次剔除与某区县相关的全部对（28 次），重新回归，检查：
     - 系数符号是否翻转、p 值是否失效、ΔadjR² 是否仍为正；
     - 找出“杠杆区县”（剔除后系数变化最大者）与最坏情形；
  3. 汇总哪些区县反复成为杠杆点，判定各变量是否稳健。

用法：python3 apps/web/scripts/diagnose_quadrant_loo.py
输出：终端报告 + data/processed/contact-quadrants/diagnostic-loo-<ts>.md
"""
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

ROOT = Path(__file__).resolve().parents[4]
MODEL = ROOT / "data/processed/contact-quadrants/current-model/model-results.json"
LAND = ROOT / "apps/web/public/data/land-use.json"
POI = ROOT / "apps/web/public/data/public-services.json"
OUT_DIR = ROOT / "data/processed/contact-quadrants"

DEPENDENTS = ["population_flow", "branch", "investment", "patent"]
BASELINE = ["log_pop_mass", "log_gdp_mass", "log_distance"]
DEP_LABEL = {"population_flow": "人口流动", "branch": "分支", "investment": "投资", "patent": "专利"}

LAND_METRICS = {
    "开发强度": "developmentIntensity",
    "中心功能指数": "centralFunctionIndex",
    "交通门户指数": "transportGatewayIndex",
    "用地混合度": "landUseMix",
    "商业占比": "commercialShare",
}
POI_METRICS = {
    "每km2建设用地POI": "poi_per_km2",
}

# 上一轮诊断中平均 ΔadjR² 最强且具代表性的候选（含 sum/logprod/absdiff 三种形式）
TOP_CANDIDATES = [
    "cand_poi_per_km2__sum",
    "cand_commercialShare__sum",
    "cand_centralFunctionIndex__sum",
    "cand_poi_per_km2__logprod",
    "cand_centralFunctionIndex__logprod",
    "cand_commercialShare__absdiff",
    "cand_landUseMix__sum",
    "cand_landUseMix__logprod",
    "cand_developmentIntensity__sum",
    "cand_transportGatewayIndex__logprod",
]


def load_county_metrics():
    """区县级指标表（与 diagnose_quadrant_variables.py 一致）。"""
    county = {}
    for r in json.load(open(LAND, encoding="utf-8"))["records"]:
        d = {k: r[k] for k in LAND_METRICS.values() if k in r}
        county[r["county"]] = d
    poi = json.load(open(POI, encoding="utf-8"))
    poi_county = defaultdict(lambda: dict.fromkeys(poi["meta"]["functionalCategories"], 0))
    for _c, cnty, cat, n in poi["functionalRecords"]:
        poi_county[cnty][cat] += n
    poi_total = poi["countyTotals"]
    poi_ctx = poi["countyContext"]
    service_cats = ["公共管理", "教育文化", "医疗健康"]
    for cnty in county:
        ctx = poi_ctx.get(cnty, {})
        cons_km2 = (ctx.get("constructionAreaHa", 0) or 0) / 100
        total = poi_total.get(cnty, 0)
        county[cnty]["poi_per_km2"] = total / cons_km2 if cons_km2 else 0
    return county


def build_pair_frame(county):
    rows = []
    model = json.load(open(MODEL, encoding="utf-8"))
    for r in model["rows"]:
        a, b = r["county_a"], r["county_b"]
        ca, cb = county[a], county[b]
        row = {"pair": r["pair"], "county_a": a, "county_b": b}
        for bcol in BASELINE:
            row[bcol] = r[bcol]
        for dep in DEPENDENTS:
            row[f"y_{dep}"] = math.log(1.0 + max(0.0, r[dep]))
        for col in TOP_CANDIDATES:
            key = col.split("__")[0].replace("cand_", "")
            xa, xb = ca[key], cb[key]
            if col.endswith("__sum"):
                row[col] = xa + xb
            elif col.endswith("__logprod"):
                row[col] = math.log(1.0 + xa * xb) if xa * xb > 0 else 0.0
            elif col.endswith("__absdiff"):
                row[col] = abs(xa - xb)
        rows.append(row)
    return pd.DataFrame(rows)


def fit(df, dep, col):
    y = df[f"y_{dep}"]
    X = sm.add_constant(df[BASELINE + [col]])
    m = sm.OLS(y, X).fit()
    return m.rsquared_adj, m.params[col], m.pvalues[col]


def main():
    county = load_county_metrics()
    df = build_pair_frame(county)
    counties = sorted(set(df.county_a) | set(df.county_b))
    print(f"样本：{len(df)} 个区县对；LOO 剔除区县数：{len(counties)}")

    report = []
    report.append("# 引力模型候选变量 LOO 稳健性检验报告\n")
    report.append(f"样本：{len(df)} 个区县对；基准 `ln(1+Y)=b0+b1·log_pop_mass+b2·log_gdp_mass+b3·log_distance`。\n")
    report.append("对每个（因变量 × 候选变量）：全样本拟合后，依次剔除与 28 个区县之一相关的全部对再拟合。"
                  "稳健判定：符号零翻转 且 ≥90% 剔除后 p<0.05 且 ΔadjR² 恒为正。\n")

    # 表头：因变量 × 候选
    print(f"{'候选变量':<38}{'因变量':<6}{'全样本系数':>10}{'p':>8}{'符号翻转':>7}{'不显著次数':>9}{'最差ΔadjR²':>11}{'杠杆区县':<10}{'剔除后系数':>11}{'判定':>6}")
    report.append("\n## 1. 逐变量 LOO 结果\n")
    report.append("| 候选变量 | 因变量 | 全样本系数 | p | 符号翻转 | 不显著剔除次数(/28) | 杠杆区县 | 剔除杠杆后系数 | 判定 |")
    report.append("|---|---|---|---|---|---|---|---|---|")

    verdicts = []
    leverage_counter = defaultdict(int)
    for col in TOP_CANDIDATES:
        for dep in DEPENDENTS:
            adj_all, coef_all, p_all = fit(df, dep, col)
            sign_all = 1 if coef_all > 0 else -1
            flips, insig, rows_loo = 0, 0, []
            for c in counties:
                sub = df[(df.county_a != c) & (df.county_b != c)]
                adj_c, coef_c, p_c = fit(sub, dep, col)
                if coef_c * sign_all < 0:
                    flips += 1
                if p_c >= 0.05:
                    insig += 1
                rows_loo.append((c, adj_c, coef_c, p_c))
            # 杠杆区县：剔除后系数偏离全样本最大者
            lev_c, lev_adj, lev_coef, lev_p = max(rows_loo, key=lambda t: abs(t[2] - coef_all))
            # 剔除后 ΔadjR² 仍为正的最坏情况（基准 adjR²）
            adj0, _, _ = fit(df, dep, None) if False else (None, None, None)
            # 直接计算基准
            y = df[f"y_{dep}"]
            adj0 = sm.OLS(y, sm.add_constant(df[BASELINE])).fit().rsquared_adj
            worst = min((adj_c - adj0 for _, adj_c, _, _ in rows_loo))
            # 判定
            if flips == 0 and insig <= 2 and worst > 0:
                verdict = "稳健"
            elif flips <= 1 and insig <= 5 and worst > 0:
                verdict = "较稳"
            else:
                verdict = "不稳健"
            verdicts.append((col, dep, verdict, flips, insig, worst))
            leverage_counter[lev_c] += 1
            print(f"{col:<38}{DEP_LABEL[dep]:<6}{coef_all:>10.4f}{p_all:>8.4f}{flips:>7}{insig:>9}{worst:>11.4f}{lev_c:<10}{lev_coef:>11.4f}{verdict:>6}")
            report.append(f"| {col} | {DEP_LABEL[dep]} | {coef_all:.4f} | {p_all:.4f} | {flips} | {insig}/28 | {lev_c} | {lev_coef:.4f} | {worst:+.4f} | {verdict} |")

    # 2. 杠杆区县汇总
    print("\n==== 杠杆区县出现频次（跨 40 个 变量×因变量 组合） ====")
    report.append("\n## 2. 杠杆区县汇总\n")
    report.append("| 区县 | 作为杠杆点的次数 |")
    report.append("|---|---|")
    for c, n in sorted(leverage_counter.items(), key=lambda t: -t[1]):
        print(f"  {c:<10} {n} 次")
        report.append(f"| {c} | {n} |")

    # 3. 判定汇总
    print("\n==== 判定汇总（按候选变量） ====")
    report.append("\n## 3. 判定汇总\n")
    report.append("| 候选变量 | 各因变量判定 | 不稳健组合数 |")
    report.append("|---|---|---|")
    for col in TOP_CANDIDATES:
        vs = [v for c, d, v, *_ in verdicts if c == col]
        n_bad = sum(1 for v in vs if v == "不稳健")
        report.append(f"| {col} | {' / '.join(vs)} | {n_bad} |")
        print(f"  {col:<40} {' / '.join(vs)}")

    report.append("\n> 判定规则：符号零翻转 且 ≥90% 剔除后显著 且 剔除任意区县后 ΔadjR² 恒为正 → 稳健；"
                  "符号翻转≤1 且不显著剔除≤5 → 较稳；否则不稳健。\n")
    report.append("> 杠杆区县：剔除该区县后候选变量系数偏离全样本最大者；出现频次高说明结果对该区县敏感。")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    from datetime import datetime
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = OUT_DIR / f"diagnostic-loo-{ts}.md"
    out.write_text("\n".join(report), encoding="utf-8")
    print(f"\n报告已写入: {out}")


if __name__ == "__main__":
    main()
