/**
 * build_ai_query_index.mjs
 * 为「智能分析」模块的 function calling（AI 按问题查询源数据）生成紧凑查询索引。
 * 从 public/data 各模块汇总 JSON 提取可筛选字段，输出 public/data/ai/query-*.json，
 * 由 Worker 端按需加载（本地 dev 走 node:fs，生产走 ASSETS），供工具执行器筛选/聚合。
 *
 * 运行：node scripts/build/build_ai_query_index.mjs（在 apps/web 目录下）
 * 输出：public/data/ai/query-enterprise.json / query-population.json / query-transport.json
 *       / query-land.json / query-services.json / query-quadrant.json
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = path.join(root, "public", "data");
const outDir = path.join(dataDir, "ai");

const load = async (file) => JSON.parse(await readFile(path.join(dataDir, file), "utf8"));
const r2 = (n) => Math.round(n * 100) / 100;

/** 读取十二类产业链分类（根目录 data/reference/industry/十二类产业链分类.csv） */
async function loadChainMap() {
  const csvPath = path.join(root, "..", "..", "data", "reference", "industry", "十二类产业链分类.csv");
  const text = await readFile(csvPath, "utf8");
  const map = {};
  for (const line of text.trim().split("\n").slice(1)) {
    const [, name, codes] = line.split(",");
    if (!codes) continue;
    for (const code of codes.trim().split(/\s+/)) map[code.trim()] = name;
  }
  return map;
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // 企业关系：只保留筛选/聚合所需字段
  const ent = await load("enterprise-relations.json");
  const chainMap = await loadChainMap();
  const enterprise = {
    meta: { source: ent.meta.sources, amountUnit: ent.meta.amountUnit, recordCount: ent.records.length, chains: chainMap },
    records: ent.records.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r2(r[9])]),
  };

  // 人口流动：区县对 + 镇街对
  const pop = await load("population-flow.json");
  const population = {
    meta: { source: pop.meta.source, unit: pop.meta.unit },
    countyRecords: pop.countyRecords.map((r) => [r[0], r[1], r[2], r[3], r[4]]),
    townRecords: pop.townRecords.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], r[6]]),
  };

  // 交通：区县无向对 + 节点统计 + 城市对
  const traf = await load("transport-accessibility.json");
  const transport = {
    meta: { nodeCount: traf.meta.nodeCount, directedOdCount: traf.meta.directedOdCount },
    pairRecords: traf.pairRecords.map((r) => [r[0], r[1], r[2], r[3], r2(r[4]), r2(r[5]), r2(r[6])]),
    nodeStats: traf.nodeStats.map((n) => [n.city, n.county, r2(n.avgTime), r2(n.avgDistance), r2(n.avgToll), n.rank]),
    cityRecords: traf.cityRecords.map((r) => [r[0], r[1], r2(r[2]), r2(r[3]), r[4]]),
  };

  // 用地：28 区县全字段
  const landData = await load("land-use.json");
  const land = {
    meta: { countyCount: landData.meta.countyCount, areaUnit: landData.meta.areaUnit },
    records: landData.records.map((r) => ({
      city: r.city, county: r.county,
      totalAreaHa: r2(r.totalArea), constructionAreaHa: r2(r.constructionArea),
      developmentIntensity: r2(r.developmentIntensity),
      industrialShare: r2(r.industryWarehouseShare), commercialShare: r2(r.commercialShare),
      publicServiceShare: r2(r.publicServiceShare),
      urbanHousingShare: r2(r.urbanHousingShare), ruralHousingShare: r2(r.ruralHousingShare),
      urbanRuralHousingRatio: r2(r.urbanRuralHousingRatio), landUseMix: r2(r.landUseMix),
    })),
  };

  // 公共服务：区县总量 + 中类明细 + 人口上下文
  const poi = await load("public-services.json");
  const services = {
    meta: { poiTotal: poi.meta.poiTotal, middleCategoryCount: poi.meta.middleCategoryCount },
    countyTotals: poi.countyTotals,
    countyContext: poi.countyContext,
    records: poi.records.map((r) => [r[0], r[1], r[2], r[3], r[5]]),
  };

  // 四象限：378 区县对关键字段
  const quad = await load("quadrant-analysis.json");
  const quadrant = {
    meta: { pairCount: quad.meta.pairCount, quadrantCounts: quad.meta.quadrantCounts },
    rows: quad.rows.map((r) => ({
      pair: `${r.county_a}—${r.county_b}`, cities: `${r.city_a}↔${r.city_b}`, flowType: r.flow_type,
      populationFlow: r.population_flow, branch: r.branch, investment: r.investment, patent: r.patent,
      distanceKm: r2(r.distance_km), quadrant: r.quadrant, quadrantName: r.quadrant_name,
      functionType: r.function_type,
      populationZ: r2(r.population_flow_z), enterpriseZ: r2(r.enterprise_z),
    })),
  };

  const files = { "query-enterprise.json": enterprise, "query-population.json": population, "query-transport.json": transport, "query-land.json": land, "query-services.json": services, "query-quadrant.json": quadrant };
  let total = 0;
  for (const [name, payload] of Object.entries(files)) {
    const outPath = path.join(outDir, name);
    await writeFile(outPath, `${JSON.stringify(payload)}\n`, "utf8");
    const kb = Buffer.byteLength(JSON.stringify(payload), "utf8") / 1024;
    total += kb;
    console.log(`已生成 ${name}（${kb.toFixed(0)} KB）`);
  }
  console.log(`查询索引合计 ${(total / 1024).toFixed(1)} MB`);
}

main().catch((err) => { console.error(err); process.exit(1); });
