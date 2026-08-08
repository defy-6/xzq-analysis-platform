/**
 * build_ai_summary.mjs
 * 为「智能分析」模块生成 AI 数据上下文摘要：从 public/data 各模块汇总 JSON 中
 * 抽取关键指标，输出精简的 public/data/ai/summary.json，供 Worker 端组装 prompt。
 *
 * 粒度对齐分析报告口径：数据具体到区县对、镇街、产业门类、POI 中类、用地门类，
 * 避免只保留总量/占比等大类指标。
 *
 * 运行：node scripts/build/build_ai_summary.mjs（在 apps/web 目录下）
 * 输出：public/data/ai/summary.json
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = path.join(root, "public", "data");

const load = async (file) => JSON.parse(await readFile(path.join(dataDir, file), "utf8"));
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

const CITIES = ["厦门市", "漳州市", "泉州市"];

/** 读取十二类产业链分类（根目录 data/reference/industry/十二类产业链分类.csv）→ 二级行业码 → 产业链名 */
async function loadChainMap() {
  const csvPath = path.join(root, "..", "..", "data", "reference", "industry", "十二类产业链分类.csv");
  const text = await readFile(csvPath, "utf8");
  const map = new Map();
  for (const line of text.trim().split("\n").slice(1)) {
    const [, name, codes] = line.split(",");
    if (!codes) continue;
    for (const code of codes.trim().split(/\s+/)) map.set(code.trim(), name);
  }
  return map;
}

/** 企业关系记录：relation|level|industryCode|industryName|oc|o|dc|d|count|amount|... */
function aggregateEnterprise(records, chainByCode) {
  const byRelation = {};
  const cityPairs = new Map();   // `${oc}→${dc}` -> {count, amount}
  const countyPairs = new Map(); // `${oc}·${o}→${dc}·${d}` -> {count, amount}
  const countyTotals = new Map();// `${city}·${county}` -> {count, amount}
  const cityTotals = new Map();  // city -> {count, amount}
  const industry = new Map();    // level1 industryName -> {count, amount, invest, branch, patent, byDir}
  const industryCounty = new Map(); // level1 行业 × 区县对
  const chain = new Map();       // 产业链名 -> {count, amount, invest, branch, patent, byDir}
  const chainCounty = new Map(); // 产业链 × 区县对
  let crossCityCount = 0;
  for (const rec of records) {
    const [relation, level, industryCode, industryName, oc, o, dc, d, count, amount] = rec;
    if (relation !== "投资" && relation !== "分支" && relation !== "专利") continue;
    const amt = amount ?? 0;
    const stats = byRelation[relation] ??= { count: 0, amount: 0, crossCityCount: 0, crossCityAmount: 0 };
    stats.count += count;
    stats.amount += amt;
    const isCross = oc !== dc;
    if (isCross) { stats.crossCityCount += count; stats.crossCityAmount += amt; crossCityCount += count; }

    const cp = `${oc}→${dc}`;
    const cps = cityPairs.get(cp) ?? { count: 0, amount: 0 };
    cps.count += count; cps.amount += amt; cityPairs.set(cp, cps);

    const kp = `${oc}·${o}↔${dc}·${d}`;
    const kps = countyPairs.get(kp) ?? { count: 0, amount: 0 };
    kps.count += count; kps.amount += amt; countyPairs.set(kp, kps);

    for (const [city, county] of [[oc, o], [dc, d]]) {
      const ck = `${city}·${county}`;
      const ct = countyTotals.get(ck) ?? { count: 0, amount: 0 };
      ct.count += count; ct.amount += amt; countyTotals.set(ck, ct);
      const ct2 = cityTotals.get(city) ?? { count: 0, amount: 0 };
      ct2.count += count; ct2.amount += amt; cityTotals.set(city, ct2);
    }

    if (level === 1 && industryName) {
      const ind = industry.get(industryName) ?? { count: 0, amount: 0, invest: 0, branch: 0, patent: 0, byDir: {} };
      ind.count += count; ind.amount += amt;
      if (relation === "投资") ind.invest += count;
      else if (relation === "分支") ind.branch += count;
      else ind.patent += count;
      const dir = `${oc}↔${dc}`;
      ind.byDir[dir] = (ind.byDir[dir] ?? 0) + count;
      industry.set(industryName, ind);

      const icKey = `${industryName}::${oc}·${o}↔${dc}·${d}`;
      const ic = industryCounty.get(icKey) ?? { invest: 0, branch: 0, patent: 0, amount: 0, cross: 0 };
      if (relation === "投资") ic.invest += count;
      else if (relation === "分支") ic.branch += count;
      else ic.patent += count;
      ic.amount += amt;
      if (isCross) ic.cross = 1;
      industryCounty.set(icKey, ic);
    }

    // 产业链门类（二级行业码映射十二类产业链）
    if (level === 2 && chainByCode?.has(industryCode)) {
      const chainName = chainByCode.get(industryCode);
      const ch = chain.get(chainName) ?? { count: 0, amount: 0, invest: 0, branch: 0, patent: 0, byDir: {} };
      ch.count += count; ch.amount += amt;
      if (relation === "投资") ch.invest += count;
      else if (relation === "分支") ch.branch += count;
      else ch.patent += count;
      const dir = `${oc}↔${dc}`;
      ch.byDir[dir] = (ch.byDir[dir] ?? 0) + count;
      chain.set(chainName, ch);

      const ccKey = `${chainName}::${oc}·${o}↔${dc}·${d}`;
      const cc = chainCounty.get(ccKey) ?? { invest: 0, branch: 0, patent: 0, amount: 0, cross: 0 };
      if (relation === "投资") cc.invest += count;
      else if (relation === "分支") cc.branch += count;
      else cc.patent += count;
      cc.amount += amt;
      if (isCross) cc.cross = 1;
      chainCounty.set(ccKey, cc);
    }
  }
  return { byRelation, cityPairs, countyPairs, countyTotals, cityTotals, industry, industryCounty, chain, chainCounty, crossCityCount };
}

/** 人口流动区县记录：[oc, o, dc, d, count, records] */
function aggregatePopulation(countyRecords, townRecords) {
  const cityPairs = new Map();
  const countyPairs = new Map();
  const countyNet = new Map(); // `${city}·${county}` -> {in, out, crossIn, crossOut}
  const cityNet = new Map();
  const townPairs = []; // 跨市镇街对
  let total = 0, crossCity = 0, withinCity = 0;
  for (const [oc, o, dc, d, count] of countyRecords) {
    total += count;
    const isCross = oc !== dc;
    if (isCross) crossCity += count; else withinCity += count;

    const cp = `${oc}→${dc}`;
    cityPairs.set(cp, (cityPairs.get(cp) ?? 0) + count);

    const kp = `${oc}·${o}↔${dc}·${d}`;
    countyPairs.set(kp, (countyPairs.get(kp) ?? 0) + count);

    for (const [city, county, isDest] of [[oc, o, false], [dc, d, true]]) {
      const ck = `${city}·${county}`;
      const c = countyNet.get(ck) ?? { in: 0, out: 0, crossIn: 0, crossOut: 0 };
      c[isDest ? "in" : "out"] += count;
      if (isCross) c[isDest ? "crossIn" : "crossOut"] += count;
      countyNet.set(ck, c);

      const cc = cityNet.get(city) ?? { in: 0, out: 0, crossIn: 0, crossOut: 0 };
      cc[isDest ? "in" : "out"] += count;
      if (isCross) cc[isDest ? "crossIn" : "crossOut"] += count;
      cityNet.set(city, cc);
    }
  }
  // 跨市镇街对（镇街记录：[oc,o,ot,dc,d,dt,count,...]）
  for (const rec of townRecords) {
    const [oc, o, ot, dc, d, dt, count] = rec;
    if (oc !== dc && count > 0) {
      townPairs.push({ pair: `${oc}·${o}·${ot}↔${dc}·${d}·${dt}`, count, a: `${oc}·${o}·${ot}`, b: `${dc}·${d}·${dt}` });
    }
  }
  townPairs.sort((a, b) => b.count - a.count);
  return { cityPairs, countyPairs, countyNet, cityNet, townPairs, total, crossCity, withinCity };
}

/** 用地 records 按城市聚合 */
function aggregateLand(records) {
  const city = {};
  for (const rec of records) {
    const { city: c, developmentIntensity, totalArea, constructionArea, agriculturalArea, unusedArea, commercialShare, publicServiceShare, landUseMix } = rec;
    const s = city[c] ??= { countyCount: 0, totalArea: 0, constructionArea: 0, agriculturalArea: 0, unusedArea: 0, intensitySum: 0, commercialShareSum: 0, publicServiceShareSum: 0, mixSum: 0 };
    s.countyCount++; s.totalArea += totalArea; s.constructionArea += constructionArea;
    s.agriculturalArea += agriculturalArea; s.unusedArea += unusedArea;
    s.intensitySum += developmentIntensity; s.commercialShareSum += commercialShare;
    s.publicServiceShareSum += publicServiceShare; s.mixSum += landUseMix;
  }
  const out = {};
  for (const [c, s] of Object.entries(city)) {
    out[c] = {
      countyCount: s.countyCount,
      totalAreaHa: r1(s.totalArea),
      constructionAreaHa: r1(s.constructionArea),
      developmentIntensity: r2(s.intensitySum / s.countyCount),
      commercialShare: r2(s.commercialShareSum / s.countyCount),
      publicServiceShare: r2(s.publicServiceShareSum / s.countyCount),
      landUseMix: r2(s.mixSum / s.countyCount),
    };
  }
  return out;
}

/** 公共服务：countyTotals + countyContext + functionalRecords + 中类明细 */
function aggregateServices(poi) {
  const city = {};
  for (const [county, total] of Object.entries(poi.countyTotals)) {
    const fr = poi.functionalRecords.find((r) => r[1] === county);
    const cityName = fr ? fr[0] : "未知";
    const s = city[cityName] ??= { poiTotal: 0, populationWan: 0, countyCount: 0 };
    s.poiTotal += total; s.countyCount++;
    const ctx = poi.countyContext?.[county];
    if (ctx?.residentPopulationWan) s.populationWan += ctx.residentPopulationWan;
  }
  const func = {};
  for (const [, , category, count] of poi.functionalRecords) {
    func[category] ??= { count: 0 };
    func[category].count += count;
  }
  // 区县 × POI 中类 → count；再算相对 28 区县均值倍数
  const countyCategory = new Map(); // `${county}::${category}` -> count
  const categoryTotals = new Map(); // category -> {count, countyCount}
  const countyNames = new Set();
  for (const [, county, , category, , count] of poi.records) {
    countyNames.add(county);
    const key = `${county}::${category}`;
    countyCategory.set(key, (countyCategory.get(key) ?? 0) + count);
    const ct = categoryTotals.get(category) ?? { count: 0, countyCount: 0 };
    ct.count += count; categoryTotals.set(category, ct);
  }
  const countyCount = countyNames.size;
  const BASIC_POI_CATEGORIES = new Set(["门牌信息", "普通地名", "停车场", "道路附属设施", "内部道路", "加油站", "公交线路相关", "临街院门"]);
  const poiDetail = [];
  for (const [key, count] of countyCategory) {
    const [county, category] = key.split("::");
    if (BASIC_POI_CATEGORIES.has(category)) continue;
    const ct = categoryTotals.get(category);
    const mean = ct.count / countyCount;
    const multiple = count / mean;
    if (count >= 80 && multiple >= 1.3) {
      poiDetail.push({ county, category, count, multiple: r2(multiple) });
    }
  }
  poiDetail.sort((a, b) => b.count - a.count);
  const poiDetailByCounty = new Map();
  for (const row of poiDetail) {
    const list = poiDetailByCounty.get(row.county) ?? [];
    if (list.length < 5) list.push({ category: row.category, count: row.count, multiple: row.multiple });
    poiDetailByCounty.set(row.county, list);
  }

  const out = {};
  for (const [c, s] of Object.entries(city)) {
    out[c] = {
      countyCount: s.countyCount,
      poiTotal: s.poiTotal,
      poiPerWan: s.populationWan ? r1(s.poiTotal / s.populationWan) : null,
      residentPopulationWan: r1(s.populationWan),
    };
  }
  return { city: out, functional: func, poiDetailByCounty };
}

/** 交通：cityRecords + nodeStats + cityPairStats */
function aggregateTransport(transport) {
  const cityPairs = transport.cityRecords.map(([oc, dc, avgTime, avgDistance, odCount]) => ({
    pair: `${oc}↔${dc}`, avgTime: r1(avgTime), avgDistance: r1(avgDistance), odCount,
  }));
  const nodeStats = transport.nodeStats
    .map((n) => ({ county: n.county, city: n.city, avgTime: r1(n.avgTime), avgDistance: r1(n.avgDistance), avgToll: r1(n.avgToll), rank: n.rank }))
    .sort((a, b) => a.rank - b.rank);
  const crossCity = transport.cityPairStats
    .filter((p) => p.originCity !== p.destinationCity)
    .map((p) => ({ pair: `${p.originCity}↔${p.destinationCity}`, avgTime: r1(p.avgTime), avgDistance: r1(p.avgDistance), avgToll: r1(p.avgToll), odCount: p.odCount }))
    .sort((a, b) => a.avgTime - b.avgTime);
  return { cityPairs, nodeStats, crossCity };
}

async function main() {
  const [ent, pop, quadrant, land, poi, transport] = await Promise.all([
    load("enterprise-relations.json"),
    load("population-flow.json"),
    load("quadrant-analysis.json"),
    load("land-use.json"),
    load("public-services.json"),
    load("transport-accessibility.json"),
  ]);
  const chainByCode = await loadChainMap();

  const entAgg = aggregateEnterprise(ent.records, chainByCode);
  const popAgg = aggregatePopulation(pop.countyRecords, pop.townRecords);
  const landCity = aggregateLand(land.records);
  const svc = aggregateServices(poi);
  const traf = aggregateTransport(transport);

  /* ---- 企业联系 ---- */
  const topCityPairs = [...entAgg.cityPairs.entries()]
    .map(([k, v]) => ({ pair: k, count: v.count, amount: r2(v.amount) }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.amount - a.amount).slice(0, 12);
  const topCountyPairs = [...entAgg.countyPairs.entries()]
    .map(([k, v]) => ({ pair: k, count: v.count, amount: r2(v.amount) }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.amount - a.amount).slice(0, 18);
  const industryTop = [...entAgg.industry.entries()]
    .filter(([, v]) => v.count > 0)
    .map(([name, v]) => ({
      name, count: v.count, amount: r2(v.amount), invest: v.invest, branch: v.branch, patent: v.patent,
      strongestDir: Object.entries(v.byDir).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
    }))
    .sort((a, b) => b.amount - a.amount);
  // 产业链门类聚合
  const industryChain = [...entAgg.chain.entries()]
    .filter(([, v]) => v.count > 0)
    .map(([name, v]) => ({
      name, count: v.count, amount: r2(v.amount), invest: v.invest, branch: v.branch, patent: v.patent,
      strongestDir: Object.entries(v.byDir).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
    }))
    .sort((a, b) => b.amount - a.amount);
  // 产业链 × 区县对（跨市 TOP 15 + 市内 TOP 8，带跨市标记）
  const chainCountyRows = [...entAgg.chainCounty.entries()]
    .map(([k, v]) => { const [name, pair] = k.split("::"); return { name, pair, invest: v.invest, branch: v.branch, patent: v.patent, amount: r2(v.amount), cross: v.cross === 1 }; })
    .filter((x) => x.invest + x.branch > 0)
    .sort((a, b) => (b.invest + b.branch) - (a.invest + a.branch));
  const industryChainCounty = [
    ...chainCountyRows.filter((x) => x.cross).slice(0, 15),
    ...chainCountyRows.filter((x) => !x.cross).slice(0, 8),
  ];
  // 产业链总量按方向汇总（跨市 vs 市内）
  const chainByScope = {};
  for (const [name, v] of entAgg.chain) {
    const crossCount = Object.entries(v.byDir).filter(([d]) => d.split("↔")[0] !== d.split("↔")[1]).reduce((s, [, c]) => s + c, 0);
    chainByScope[name] = { count: v.count, crossCount, withinCount: v.count - crossCount, crossShare: r2(crossCount / v.count) };
  }

  /* ---- 人口流动 ---- */
  const popCityTop = [...popAgg.cityPairs.entries()]
    .map(([k, v]) => ({ pair: k, count: v }))
    .sort((a, b) => b.count - a.count).slice(0, 9);
  const popCountyTop = [...popAgg.countyPairs.entries()]
    .map(([k, v]) => ({ pair: k, count: v }))
    .sort((a, b) => b.count - a.count).slice(0, 15);
  const countyNetTop = [...popAgg.countyNet.entries()]
    .map(([ck, v]) => ({ county: ck, net: v.crossIn - v.crossOut, crossIn: v.crossIn, crossOut: v.crossOut }))
    .filter((x) => x.crossIn + x.crossOut > 0)
    .sort((a, b) => b.net - a.net);
  const cityNetTop = [...popAgg.cityNet.entries()]
    .map(([city, v]) => ({ city, net: v.crossIn - v.crossOut, crossIn: v.crossIn, crossOut: v.crossOut }))
    .sort((a, b) => b.net - a.net);
  const townPairsTop = popAgg.townPairs.filter((t) => t.pair.includes("↔")).slice(0, 40)
    .map((t) => ({ pair: t.pair, count: t.count }));

  /* ---- 四象限 ---- */
  const quadRows = quadrant.rows;
  const quadTop = [...quadRows]
    .sort((a, b) => (b.population_flow_z + b.enterprise_z) - (a.population_flow_z + a.enterprise_z))
    .slice(0, 12)
    .map((r) => ({
      pair: `${r.county_a}—${r.county_b}`, cities: `${r.city_a}↔${r.city_b}`, flowType: r.flow_type,
      populationFlow: r.population_flow, quadrant: r.quadrant_name, functionType: r.function_type,
      populationZ: r2(r.population_flow_z), enterpriseZ: r2(r.enterprise_z), distanceKm: r1(r.distance_km),
    }));
  const crossQuadTop = [...quadRows]
    .filter((r) => r.flow_type.includes("跨市"))
    .sort((a, b) => (b.population_flow_z + b.enterprise_z) - (a.population_flow_z + a.enterprise_z))
    .slice(0, 14)
    .map((r) => ({
      pair: `${r.county_a}—${r.county_b}`, cities: `${r.city_a}↔${r.city_b}`, populationFlow: r.population_flow,
      quadrant: r.quadrant_name, functionType: r.function_type, distanceKm: r1(r.distance_km),
    }));
  // 四象限各象限代表性区县对（含低预期象限）
  const quadSamples = {};
  for (const qn of [1, 2, 3, 4]) {
    const rows = [...quadRows].filter((r) => r.quadrant === qn)
      .sort((a, b) => (b.population_flow_z + b.enterprise_z) - (a.population_flow_z + a.enterprise_z))
      .slice(0, 6)
      .map((r) => ({ pair: `${r.county_a}—${r.county_b}`, cities: `${r.city_a}↔${r.city_b}`, flowType: r.flow_type, populationFlow: r.population_flow, functionType: r.function_type }));
    quadSamples[qn] = rows;
  }

  /* ---- 用地 ---- */
  const landRecs = land.records.map((rec) => ({
    county: rec.county, city: rec.city,
    developmentIntensity: r2(rec.developmentIntensity),
    constructionAreaHa: r1(rec.constructionArea),
    commercialShare: r2(rec.commercialShare),
    industrialShare: r2(rec.industryWarehouseShare),
    industrialDensity: r2(rec.industrialDevelopmentDensity),
    publicServiceShare: r2(rec.publicServiceShare),
    urbanHousingShare: r2(rec.urbanHousingShare),
    ruralHousingShare: r2(rec.ruralHousingShare),
    urbanRuralHousingRatio: r2(rec.urbanRuralHousingRatio),
    landUseMix: r2(rec.landUseMix),
    lq: rec.lq,
  }));
  const intensityTop = [...landRecs].sort((a, b) => b.developmentIntensity - a.developmentIntensity).slice(0, 8)
    .map((r) => ({ county: r.county, value: r.developmentIntensity }));
  const intensityBottom = [...landRecs].sort((a, b) => a.developmentIntensity - b.developmentIntensity).slice(0, 5)
    .map((r) => ({ county: r.county, value: r.developmentIntensity }));
  const industrialTop = [...landRecs].sort((a, b) => b.industrialShare - a.industrialShare).slice(0, 8)
    .map((r) => ({ county: r.county, share: r.industrialShare }));

  /* ---- 公共服务 ---- */
  const poiTop = Object.entries(poi.countyTotals)
    .map(([county, total]) => ({ county, total, perWan: (() => { const c = poi.countyContext?.[county]; return c?.residentPopulationWan ? r1(total / c.residentPopulationWan) : null; })() }))
    .sort((a, b) => b.total - a.total).slice(0, 10);

  /* ---- 交通 ---- */
  const trafBest = traf.crossCity.slice(0, 6);
  const trafWorst = traf.nodeStats.slice(-5).map((n) => ({ county: n.county, avgTime: n.avgTime }));

  /* ---- 区县画像（紧凑但含用地细分） ---- */
  const counties = {};
  for (const rec of landRecs) counties[rec.county] = { city: rec.city };
  for (const [ck, v] of popAgg.countyNet) {
    const county = ck.split("·")[1];
    if (counties[county]) {
      counties[county].population = { total: v.in + v.out, crossIn: v.crossIn, crossOut: v.crossOut, net: v.crossIn - v.crossOut };
    }
  }
  for (const [ck, v] of entAgg.countyTotals) {
    const county = ck.split("·")[1];
    if (counties[county]) counties[county].enterprise = { count: v.count, amount: r2(v.amount) };
  }
  for (const rec of landRecs) {
    counties[rec.county].land = {
      intensity: rec.developmentIntensity, constructionHa: rec.constructionAreaHa,
      commercialShare: rec.commercialShare, industrialShare: rec.industrialShare,
      publicServiceShare: rec.publicServiceShare, urbanHousingShare: rec.urbanHousingShare,
      ruralHousingShare: rec.ruralHousingShare, mix: rec.landUseMix,
    };
  }
  for (const [county, total] of Object.entries(poi.countyTotals)) {
    if (counties[county]) {
      const ctx = poi.countyContext?.[county];
      counties[county].services = { poiTotal: total, poiPerWan: ctx?.residentPopulationWan ? r1(total / ctx.residentPopulationWan) : null };
    }
  }
  for (const n of transport.nodeStats) {
    if (counties[n.county]) counties[n.county].transport = { avgTime: r1(n.avgTime), avgDistance: r1(n.avgDistance), rank: n.rank };
  }
  const poiDetailByCounty = {};
  for (const [county, list] of svc.poiDetailByCounty) {
    if (counties[county]) poiDetailByCounty[county] = list;
  }

  /* ---- 关键区县对画像（跨市重点对：人口 TOP + 企业 TOP 并集，含交通时间与两侧画像；依赖 counties） ---- */
  const pairTimeKey = (cityA, countyA, cityB, countyB) => [`${cityA}·${countyA}`, `${cityB}·${countyB}`].sort().join("↔");
  const transportPairTime = new Map();
  for (const r of transport.pairRecords) {
    const key = pairTimeKey(r[0], r[1], r[2], r[3]);
    transportPairTime.set(key, { avgTime: r1(r[4]), avgDistance: r1(r[5]), avgToll: r1(r[6]) });
  }
  const crossCityRows = quadrant.rows.filter((r) => r.flow_type.includes("跨市"));
  const withinCityRows = quadrant.rows.filter((r) => r.flow_type.includes("市内"));
  const byPop = [...crossCityRows].sort((a, b) => b.population_flow - a.population_flow).slice(0, 14);
  const byEnt = [...crossCityRows].sort((a, b) => (b.branch + b.investment + b.patent) - (a.branch + a.investment + a.patent)).slice(0, 12);
  const byWithin = [...withinCityRows].sort((a, b) => b.population_flow - a.population_flow).slice(0, 8);
  const keyPairSet = new Map();
  for (const r of [...byPop, ...byEnt, ...byWithin]) keyPairSet.set(pairTimeKey(r.city_a, r.county_a, r.city_b, r.county_b), r);
  const keyPairs = [...keyPairSet.values()].map((r) => {
    const tt = transportPairTime.get(pairTimeKey(r.city_a, r.county_a, r.city_b, r.county_b)) ?? null;
    const side = (county) => {
      const c = counties[county] ?? null;
      return {
        county,
        popNet: c?.population?.net ?? null,
        intensity: c?.land?.intensity ?? null,
        industrialShare: c?.land?.industrialShare ?? null,
        ruralHousingShare: c?.land?.ruralHousingShare ?? null,
        poiPerWan: c?.services?.poiPerWan ?? null,
      };
    };
    return {
      pair: `${r.county_a}—${r.county_b}`,
      cities: `${r.city_a}↔${r.city_b}`,
      flowType: r.flow_type,
      populationFlow: r.population_flow,
      enterprise: { 投资: r.investment, 分支: r.branch, 专利: r.patent },
      distanceKm: r1(r.distance_km),
      avgTimeMin: tt?.avgTime ?? null,
      avgTollYuan: tt?.avgToll ?? null,
      quadrant: r.quadrant_name,
      functionType: r.function_type,
      sideA: side(r.county_a),
      sideB: side(r.county_b),
    };
  });
  keyPairs.sort((a, b) => b.populationFlow - a.populationFlow);

  /* ---- 三市企业关系汇总 ---- */
  const entCity = {};
  for (const [ck, v] of entAgg.cityTotals) entCity[ck] = { count: v.count, amount: r2(v.amount) };

  const summary = {
    generatedAt: new Date().toISOString(),
    source: "由 build_ai_summary.mjs 从 public/data 各模块汇总 JSON 自动生成",
    note: "金额单位：万元（企业投资金额与分支注册资金，双向合计）；人口单位：人；用地单位：公顷；驾车时间单位：分钟；POI 相对倍数=该区县某中类数量/28 区县该中类平均数量。跨市指厦门/漳州/泉州三市之间。",
    overview: {
      cities: CITIES,
      countyCount: 28,
      enterprise: Object.fromEntries(Object.entries(entAgg.byRelation).map(([rel, s]) => [rel, {
        count: s.count, amount: r2(s.amount), crossCityCount: s.crossCityCount, crossCityShare: r2(s.crossCityCount / s.count),
      }])),
      population: { total: popAgg.total, crossCity: popAgg.crossCity, withinCity: popAgg.withinCity, crossCityShare: r2(popAgg.crossCity / popAgg.total) },
      transport: { directedOdCount: transport.meta.directedOdCount, countyPairCount: transport.meta.pairCount, nodeCount: transport.meta.nodeCount },
      land: { countyCount: land.meta.countyCount, unit: land.meta.areaUnit },
      services: { poiTotal: poi.meta.poiTotal, middleCategoryCount: poi.meta.middleCategoryCount },
      quadrant: { pairCount: quadrant.meta.pairCount, quadrantCounts: quadrant.meta.quadrantCounts, crossCityCount: quadrant.meta.crossCityCount },
    },
    cities: {
      企业联系: entCity,
      企业城市对: topCityPairs,
      人口净流入: cityNetTop,
      人口城市对: popCityTop,
      用地: landCity,
      公共服务: svc.city,
      交通城市对: traf.cityPairs,
    },
    topFlows: {
      企业区县对: topCountyPairs,
      人口区县对: popCountyTop,
      区县净流入: countyNetTop,
      人口镇街对: townPairsTop,
    },
    industry: {
      byAmount: industryTop,
      byChain: industryChain,
      byChainCountyPair: industryChainCounty,
      chainByScope,
    },
    quadrant: {
      counts: quadrant.meta.quadrantCounts,
      topPairs: quadTop,
      crossCityTopPairs: crossQuadTop,
      samples: quadSamples,
    },
    transport: {
      crossCityTop: trafBest,
      bestCounties: traf.nodeStats.slice(0, 5).map((n) => ({ county: n.county, avgTime: r1(n.avgTime) })),
      slowestCounties: trafWorst,
      cityPairStats: traf.crossCity,
    },
    land: {
      intensityTop,
      intensityBottom,
      industrialTop,
      citySummary: landCity,
    },
    services: {
      poiTop,
      poiDetail: poiDetailByCounty,
      functional: Object.fromEntries(Object.entries(svc.functional).map(([k, v]) => [k, { count: v.count }])),
    },
    keyPairs,
    counties,
  };

  const outDir = path.join(dataDir, "ai");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "summary.json");
  await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  const bytes = Buffer.byteLength(JSON.stringify(summary), "utf8");
  console.log(`已生成 ${outPath}（${(bytes / 1024).toFixed(1)} KB）`);
}

main().catch((err) => { console.error(err); process.exit(1); });
