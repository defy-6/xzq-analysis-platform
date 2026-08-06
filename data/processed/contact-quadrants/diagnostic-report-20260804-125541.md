# 引力模型扩展变量诊断报告

样本：378 个区县对；基准模型 `ln(1+Y) = b0 + b1·log_pop_mass + b2·log_gdp_mass + b3·log_distance`

判据：ΔadjR²（相对基准的调整 R² 提升）、新增变量系数与 p 值（p<0.05 为显著）。

## 1. 基准模型复现

| 因变量 | adjR² |
|---|---|
| 人口流动 | 0.8092 |
| 分支 | 0.7505 |
| 投资 | 0.7765 |
| 专利 | 0.5255 |

## 2. 候选变量增量解释力

ΔadjR² 正值表示在基准之上有增量解释力；`*` 表示系数 p<0.05。

| 候选变量 | 人口流动 | 分支 | 投资 | 专利 | 平均 |
|---|---|---|---|---|---|
| cand_poi_per_km2__sum | +0.0073* | +0.0356* | +0.0666* | +0.0436* | +0.0383 |
| cand_commercialShare__sum | +0.0147* | +0.0344* | +0.0641* | +0.0354* | +0.0372 |
| cand_centralFunctionIndex__sum | +0.0071* | +0.0315* | +0.0550* | +0.0486* | +0.0356 |
| cand_poi_per_km2__logprod | +0.0009 | +0.0276* | +0.0536* | +0.0392* | +0.0303 |
| cand_centralFunctionIndex__logprod | +0.0034* | +0.0255* | +0.0356* | +0.0545* | +0.0298 |
| cand_commercialShare__absdiff | +0.0149* | +0.0278* | +0.0552* | +0.0151* | +0.0283 |
| cand_landUseMix__sum | +0.0060* | +0.0112* | +0.0383* | +0.0543* | +0.0275 |
| cand_landUseMix__logprod | +0.0057* | +0.0106* | +0.0363* | +0.0558* | +0.0271 |
| cand_commercialShare__logprod | +0.0075* | +0.0260* | +0.0352* | +0.0353* | +0.0260 |
| cand_developmentIntensity__sum | +0.0067* | +0.0188* | +0.0450* | +0.0274* | +0.0245 |
| cand_poi_per_km2__absdiff | +0.0128* | +0.0197* | +0.0475* | +0.0107* | +0.0227 |
| cand_centralFunctionIndex__absdiff | +0.0104* | +0.0215* | +0.0441* | +0.0129* | +0.0222 |
| cand_transportGatewayIndex__sum | +0.0091* | +0.0001 | +0.0312* | +0.0469* | +0.0218 |
| cand_transportGatewayIndex__logprod | +0.0029* | -0.0000 | +0.0150* | +0.0684* | +0.0216 |
| cand_developmentIntensity__logprod | +0.0014 | +0.0123* | +0.0209* | +0.0349* | +0.0174 |
| cand_poi_commerce__absdiff | -0.0002 | +0.0075* | +0.0088* | +0.0319* | +0.0120 |
| cand_transportGatewayIndex__absdiff | +0.0052* | +0.0002 | +0.0263* | +0.0143* | +0.0115 |
| cand_developmentIntensity__absdiff | +0.0055* | +0.0087* | +0.0224* | -0.0008 | +0.0089 |
| cand_poi_public__absdiff | +0.0013 | +0.0042* | +0.0030* | +0.0233* | +0.0079 |
| cand_industryWarehouseShare__sum | -0.0001 | +0.0166* | +0.0105* | +0.0035 | +0.0076 |
| cand_poi_industry__absdiff | -0.0001 | +0.0051* | +0.0031* | +0.0220* | +0.0075 |
| cand_poi_commerce__sum | -0.0004 | +0.0033* | +0.0123* | +0.0146* | +0.0074 |
| cand_lq_产业功能__logprod | -0.0001 | +0.0181* | +0.0087* | +0.0018 | +0.0072 |
| cand_lq_产业功能__sum | -0.0003 | +0.0186* | +0.0081* | +0.0019 | +0.0071 |
| cand_industryWarehouseShare__logprod | -0.0003 | +0.0162* | +0.0095* | +0.0026 | +0.0070 |
| cand_poi_structure_cosine | +0.0089* | -0.0005 | +0.0182* | +0.0012 | +0.0070 |
| cand_poi_total__absdiff | +0.0019* | +0.0029* | +0.0006 | +0.0221* | +0.0069 |
| cand_urbanRuralHousingRatio__logprod | +0.0001 | +0.0088* | +0.0060* | +0.0056* | +0.0051 |
| cand_poi_per10k__sum | +0.0001 | +0.0036* | +0.0091* | +0.0073* | +0.0050 |
| cand_landUseMix__absdiff | +0.0009 | +0.0041* | +0.0100* | -0.0007 | +0.0036 |
| cand_land_mix_absdiff | +0.0009 | +0.0041* | +0.0100* | -0.0007 | +0.0036 |
| cand_poi_per10k__logprod | +0.0025* | +0.0007 | +0.0042* | +0.0060* | +0.0033 |
| cand_poi_total__logprod | +0.0025* | +0.0007 | +0.0042* | +0.0060* | +0.0033 |
| cand_poi_service_industry_ratio__sum | +0.0016* | +0.0101* | +0.0005 | +0.0006 | +0.0032 |
| cand_poi_service_industry_ratio__logprod | +0.0010 | +0.0102* | -0.0003 | +0.0015 | +0.0031 |
| cand_poi_per10k__absdiff | +0.0071* | +0.0005 | +0.0026* | +0.0017 | +0.0030 |
| cand_poi_commerce__logprod | +0.0043* | -0.0006 | +0.0027* | +0.0046* | +0.0028 |
| cand_poi_public__logprod | +0.0062* | +0.0051* | -0.0006 | -0.0003 | +0.0026 |
| cand_poi_industry__logprod | +0.0050* | +0.0053* | +0.0013 | -0.0012 | +0.0026 |
| cand_poi_industry__sum | -0.0005 | +0.0056* | +0.0032* | +0.0016 | +0.0025 |
| cand_lq_产业功能__absdiff | +0.0015* | +0.0015 | +0.0024* | +0.0007 | +0.0015 |
| cand_poi_service_industry_ratio__absdiff | +0.0004 | -0.0006 | +0.0036* | +0.0000 | +0.0009 |
| cand_urbanRuralHousingRatio__absdiff | +0.0028* | +0.0011 | +0.0003 | -0.0013 | +0.0008 |
| cand_urbanRuralHousingRatio__sum | +0.0029* | +0.0007 | +0.0001 | -0.0012 | +0.0006 |
| cand_poi_public__sum | -0.0002 | -0.0005 | +0.0013 | +0.0016 | +0.0005 |
| cand_industryWarehouseShare__absdiff | -0.0002 | +0.0001 | -0.0002 | -0.0010 | -0.0003 |
| cand_poi_total__sum | +0.0003 | -0.0003 | -0.0006 | -0.0013 | -0.0005 |

## 3. 共线性诊断

与基准控制变量 |r|>0.5 的候选（共线性预警）：

| 候选变量 | 基准变量 | 相关系数 |
|---|---|---|
| cand_poi_public__logprod | log_pop_mass | +0.964 |
| cand_poi_total__logprod | log_gdp_mass | +0.954 |
| cand_poi_public__logprod | log_gdp_mass | +0.954 |
| cand_poi_commerce__logprod | log_pop_mass | +0.952 |
| cand_poi_commerce__logprod | log_gdp_mass | +0.944 |
| cand_poi_total__logprod | log_pop_mass | +0.931 |
| cand_poi_industry__logprod | log_gdp_mass | +0.922 |
| cand_poi_industry__logprod | log_pop_mass | +0.911 |
| cand_poi_public__sum | log_gdp_mass | +0.901 |
| cand_poi_total__sum | log_gdp_mass | +0.901 |
| cand_poi_commerce__sum | log_gdp_mass | +0.875 |
| cand_poi_public__sum | log_pop_mass | +0.873 |
| cand_poi_total__sum | log_pop_mass | +0.862 |
| cand_poi_commerce__sum | log_pop_mass | +0.861 |
| cand_poi_industry__sum | log_pop_mass | +0.798 |
| cand_poi_industry__sum | log_gdp_mass | +0.794 |
| cand_developmentIntensity__sum | log_gdp_mass | +0.657 |
| cand_poi_per_km2__logprod | log_gdp_mass | +0.608 |
| cand_developmentIntensity__logprod | log_gdp_mass | +0.596 |
| cand_poi_per_km2__sum | log_gdp_mass | +0.548 |
| cand_poi_per10k__logprod | log_gdp_mass | +0.536 |
| cand_poi_per10k__sum | log_gdp_mass | +0.521 |

基准 + 最优前 6 候选的 VIF（>10 提示严重共线）：

| 变量 | VIF |
|---|---|
| log_pop_mass | 6.2 |
| log_gdp_mass | 8.9 |
| log_distance | 1.4 |
| cand_poi_per_km2__sum | 40.1 |
| cand_commercialShare__sum | 16.2 |
| cand_centralFunctionIndex__sum | 22.4 |
| cand_poi_per_km2__logprod | 14.4 |
| cand_centralFunctionIndex__logprod | 16.3 |
| cand_commercialShare__absdiff | 9.5 |

## 4. 结论建议

平均 ΔadjR² > 0.005 的候选变量（优先纳入最终模型）：

- `cand_poi_per_km2__sum`  平均 ΔadjR² +0.0383
- `cand_commercialShare__sum`  平均 ΔadjR² +0.0372
- `cand_centralFunctionIndex__sum`  平均 ΔadjR² +0.0356
- `cand_poi_per_km2__logprod`  平均 ΔadjR² +0.0303
- `cand_centralFunctionIndex__logprod`  平均 ΔadjR² +0.0298
- `cand_commercialShare__absdiff`  平均 ΔadjR² +0.0283
- `cand_landUseMix__sum`  平均 ΔadjR² +0.0275
- `cand_landUseMix__logprod`  平均 ΔadjR² +0.0271
- `cand_commercialShare__logprod`  平均 ΔadjR² +0.0260
- `cand_developmentIntensity__sum`  平均 ΔadjR² +0.0245
- `cand_poi_per_km2__absdiff`  平均 ΔadjR² +0.0227
- `cand_centralFunctionIndex__absdiff`  平均 ΔadjR² +0.0222

> 注意：ΔadjR² 仅为单变量增量，正式建模需综合变量间共线性、样本量（378）与方向一致性后再取舍；用地为单期横截面、POI 为 2024 年，年份口径与人口/企业数据需复核。