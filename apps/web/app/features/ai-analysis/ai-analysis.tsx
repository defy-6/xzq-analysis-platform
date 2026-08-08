"use client";

/**
 * 智能分析模块：基于平台数据调用 DeepSeek / 通义千问生成分析报告并支持追问。
 * - 模型列表与密钥配置状态来自 /api/ai/models（模型注册表，新增模型零前端改动）
 * - 报告生成后自动质量自检，不合格触发一次自动修订（/api/ai/check + repair）
 * - 报告可编辑并保存「审核稿」，历史版本保存在浏览器本地，打开主题优先显示已保存版本
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useFujianBackdrop from "../mapkit/fujian-backdrop";
import MapDecorations from "../mapkit/map-scale";
import MapScaleOverlay from "../mapkit/map-scale-overlay";
import DynamicMapLabels, { type MapLabelCandidate } from "../mapkit/map-labels";
import ThematicMap from "../mapkit/thematic-map";
import { exportMapPng, exportWithLabelsOn, numericLegend, type MapLegendItem } from "../mapkit/map-export";

type ProviderId = "deepseek" | "qwen";
type TopicId = "overall" | "positioning" | "regions" | "border" | "insights";
type ChatRole = "user" | "assistant";
interface ChatMessage { role: ChatRole; content: string; }

interface ModelInfo { key: string; label: string; provider: string; configured: boolean; }
interface ProviderInfo { id: string; label: string; defaultModel: string; configured: boolean; apiKeyEnv: string; models: string[]; }

interface SavedReport {
  reviewed: { content: string; ts: number } | null;
  draft?: { content: string; ts: number } | null;
  versions: { ts: number; content: string; source: string }[];
}

interface AcceptedConclusion { id: string; ts: number; text: string; kind: "accept" | "error"; }

const STORE_KEY = "xzq-ai-reports-v1";
const ACCEPTED_KEY = "xzq-ai-accepted-v1";
const WORD_KEY = "xzq-ai-wordrange-v1";
type WordRange = { min: number; max: number };
const DEFAULT_WORD_RANGE: WordRange = { min: 1500, max: 2500 };
const WORD_PRESETS: WordRange[] = [
  { min: 600, max: 1000 },
  { min: 1000, max: 1500 },
  { min: 1500, max: 2500 },
  { min: 2500, max: 4000 },
  { min: 4000, max: 6000 },
];
function loadWordRange(): WordRange {
  try {
    const raw = localStorage.getItem(WORD_KEY);
    if (raw) {
      const p = JSON.parse(raw) as WordRange;
      if (typeof p.min === "number" && typeof p.max === "number" && p.min > 0 && p.max >= p.min) return { min: p.min, max: p.max };
    }
  } catch { /* 忽略 */ }
  return DEFAULT_WORD_RANGE;
}
const FALLBACK_MODELS: Record<ProviderId, Record<string, string>> = {
  deepseek: { "deepseek-v4-pro": "DeepSeek-V4 Pro · 旗舰", "deepseek-v4-flash": "DeepSeek-V4 Flash · 快速" },
  qwen: { "qwen3.6-plus": "通义千问 3.6 Plus" },
};
const FALLBACK_PROVIDERS: Record<ProviderId, { label: string; defaultModel: string; apiKeyEnv: string }> = {
  deepseek: { label: "DeepSeek", defaultModel: "deepseek-v4-flash", apiKeyEnv: "DEEPSEEK_API_KEY" },
  qwen: { label: "通义千问", defaultModel: "qwen3.6-plus", apiKeyEnv: "DASHSCOPE_API_KEY" },
};

const TOPICS: { id: TopicId; title: string; desc: string; tag: string }[] = [
  { id: "overall", title: "都市圈综合研判", desc: "城市定位 · 区域分级 · 交界地区 · 数据特色 四部分一体成文", tag: "总报告" },
  { id: "positioning", title: "城市定位与节点格局", desc: "厦门、漳州、泉州及主要区县在都市圈中的层级与功能角色", tag: "定位" },
  { id: "regions", title: "成熟区 · 潜力区 · 不及预期区", desc: "基于引力模型四象限与跨市联系，对区域分区评级", tag: "分区" },
  { id: "border", title: "交界毗邻地区", desc: "海沧—龙海、翔安—南安等边界地区的联系形态、分工与差异", tag: "边界" },
  { id: "insights", title: "数据揭示的特色", desc: "只有通过数据才能体现的反常识发现与隐藏特征", tag: "洞察" },
];

/* ------------------------- 图表渲染（chartjson → SVG） ------------------------- */

interface ChartData { type?: string; title?: string; unit?: string; labels?: string[]; values?: number[]; series?: { name: string; values: number[] }[]; data?: string; relation?: string; scope?: string; top?: number; metric?: string; }

const CHART_COLORS = ["#173f38", "#6fae9d", "#e0a24a", "#b97f5f", "#5f8fb9", "#8a7bb5", "#b5666a", "#7fae6a"];

function formatValue(v: number): string {
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}万`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

/** SVG → PNG 导出（前端零依赖：序列化 → Image → canvas → dataURL 下载） */
function exportSvgAsPng(svgEl: SVGSVGElement, filename: string) {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const vb = svgEl.viewBox.baseVal;
  const width = (vb?.width || 640) * 2;
  const height = (vb?.height || 360) * 2;
  const svgData = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
      a.click();
    }
    URL.revokeObjectURL(url);
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

function ChartExportButton({ svgRef, filename }: { svgRef: React.RefObject<SVGSVGElement | null>; filename: string }) {
  return (
    <button
      type="button"
      className="aiChartExport"
      title="导出 PNG"
      onClick={() => { if (svgRef.current) exportSvgAsPng(svgRef.current, filename); }}
    >
      ⤓ PNG
    </button>
  );
}

/* ------------------------- OD 地图渲染（odmap → 平台 OD 地图，可导出 PNG） ------------------------- */

type OdPoint = [number, number];
type OdRing = OdPoint[];
type OdPolygon = OdRing[];
type OdMultiPolygon = OdPolygon[];
type OdCountyFeature = { properties: { city: string; name: string; code: string }; geometry: { type: string; coordinates: OdMultiPolygon } };
type OdBoundaryPayload = { type?: string; features: OdCountyFeature[] };
type OdGovCenters = { county?: Record<string, [number, number]>; city?: Record<string, [number, number]>; township?: Record<string, [number, number]> };

interface OdFlow { key: string; oc: string; o: string; dc: string; d: string; value: number; }

const OD_FLOW_COLORS = ["#b8d8d0", "#79b7aa", "#f0c66e", "#e88a4d", "#b93b35"];
const TRANSPORT_FLOW_COLORS = ["#2f8f70", "#79b7aa", "#f0c66e", "#e88a4d", "#b93b35"];
const DEFAULT_OD_TITLE: Record<string, string> = {
  population: "厦漳泉跨市人口流动区县OD图",
  enterprise: "厦漳泉跨市企业联系区县OD图",
  transport: "厦漳泉区县驾车可达性OD图",
  land: "厦漳泉各区县建设用地开发强度分布",
  services: "厦漳泉各区县公共服务设施分布",
};
type OdTrafficRecord = [string, string, string, string, number, number, number, number, number];
const odQuantileBreaks = (values: number[]) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); if (!sorted.length) return []; return [0.2, 0.4, 0.6, 0.8].map(q => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))]); };
const odStrengthBand = (value: number, breaks: number[]) => { if (!breaks.length || breaks.every(x => x === breaks[0])) return 2; if (value <= breaks[0]) return 0; if (value <= breaks[1]) return 1; if (value <= breaks[2]) return 2; if (value <= breaks[3]) return 3; return 4; };
const odGeometryPath = (coordinates: OdMultiPolygon, project: (p: OdPoint) => OdPoint) => coordinates.map((polygon: OdPolygon) => polygon.map((ring: OdRing) => ring.map((point: OdPoint, index: number) => (index ? "L" : "M") + project(point).join(",")).join("") + "Z").join("")).join("");
const odQuadraticPoints = (p0: OdPoint, p1: OdPoint, c: OdPoint, segments = 5): OdPoint[] => { const out: OdPoint[] = []; for (let i = 0; i <= segments; i++) { const t = i / segments, u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]); } return out; };

type OdEnterpriseRecord = [string, number, string, string, string, string, string, string, number, number, number, number, number, number, number, number];
type OdPopulationRecord = [string, string, string, string, number, number];

// 模块级缓存：同一会话多张图共享加载结果（与各数据模块独立，仅智能分析使用）
const odDataCache: Record<string, Promise<unknown> | null> = {};
function loadOdJson(path: string): Promise<unknown> {
  if (!odDataCache[path]) {
    odDataCache[path] = fetch(path).then(r => r.json()).catch((e) => { odDataCache[path] = null; throw e; });
  }
  return odDataCache[path];
}

/* 专题填色图（land/services）：复用平台 ThematicMap（自带缩放/标注/导出），供 odmap 渲染 */
function OdThematicMap({ kind, title, exportable, svgRefCallback }: { kind: "land" | "services"; title: string; exportable?: boolean; svgRefCallback?: (el: SVGSVGElement | null) => void }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [payload, setPayload] = useState<{ features: OdCountyFeature[]; values: Map<string, number>; legendTitle: string; unit: string; digits: number } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (kind === "land") {
          const data = (await loadOdJson("/data/land-use.json")) as { countyBoundaries: OdBoundaryPayload; records: { county: string; developmentIntensity: number }[] };
          if (!alive) return;
          const values = new Map<string, number>();
          for (const row of data.records) values.set(row.county, Number(row.developmentIntensity) * 100);
          setPayload({ features: data.countyBoundaries.features, values, legendTitle: "建设用地开发强度", unit: "%", digits: 1 });
          setState("ready");
        } else {
          const data = (await loadOdJson("/data/public-services.json")) as { countyBoundaries: OdBoundaryPayload; functionalRecords: [string, string, string, number][] };
          if (!alive) return;
          const values = new Map<string, number>();
          for (const row of data.functionalRecords) values.set(row[1], (values.get(row[1]) || 0) + row[3]);
          setPayload({ features: data.countyBoundaries.features, values, legendTitle: "公共服务设施POI数量", unit: "个", digits: 0 });
          setState("ready");
        }
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, [kind]);
  if (state === "loading") return <div className="aiOdMapCard"><div className="aiOdMapState">正在载入地图数据…</div></div>;
  if (state === "error" || !payload) return <div className="aiOdMapCard"><div className="aiOdMapState error">地图数据加载失败</div></div>;
  return (
    <div className="aiOdMapCard">
      <ThematicMap features={payload.features} values={payload.values} activeCounties={new Set(payload.values.keys())} selected={null} onSelect={() => {}} title={title} subtitle={`${payload.values.size}个区县 · 按${payload.legendTitle}动态分级`} legendTitle={payload.legendTitle} unit={payload.unit} digits={payload.digits} exportable={exportable} svgRefCallback={svgRefCallback} />
    </div>
  );
}

function OdMapCard({ data: spec, exportable = true, svgRefCallback }: { data: ChartData; exportable?: boolean; svgRefCallback?: (el: SVGSVGElement | null) => void }) {
  const kind = spec.data === "enterprise" ? "enterprise" : spec.data === "land" ? "land" : spec.data === "services" ? "services" : spec.data === "transport" ? "transport" : "population";
  const relation = kind === "enterprise" ? (spec.relation || "投资") : "";
  const scope = spec.scope || "跨市";
  const top = Math.min(60, Math.max(5, Number(spec.top) || 30));
  const metric = kind === "enterprise" ? (spec.metric === "count" ? "count" : "amount") : "population";
  const title = spec.title || (kind === "enterprise" ? `厦漳泉跨市${relation}联系OD图` : (DEFAULT_OD_TITLE[kind] || "厦漳泉跨市人口流动区县OD图"));
  const unit = kind === "enterprise" ? (metric === "count" ? "条" : "万元") : kind === "transport" ? "分钟" : "人";
  const [loaded, setLoaded] = useState<{ boundaries: OdBoundaryPayload | null; centers: Record<string, [number, number]> | null; flows: OdFlow[]; state: "loading" | "ready" | "error" }>({ boundaries: null, centers: null, flows: [], state: "loading" });
  const [view, setView] = useState({ x: 0, y: 0, k: 1.1 });
  const [labelsOn, setLabelsOn] = useState(true);
  const mapRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const fujianBackdrop = useFujianBackdrop();

  useEffect(() => {
    if (kind === "land" || kind === "services") return;
    let alive = true;
    (async () => {
      try {
        if (kind === "enterprise") {
          const payload = (await loadOdJson("/data/enterprise-relations.json")) as { boundaries: OdBoundaryPayload; centers: Record<string, [number, number]>; records: OdEnterpriseRecord[] };
          const gov = (await loadOdJson("/data/government-centers.json")) as OdGovCenters;
          if (!alive) return;
          const centers = { ...payload.centers, ...(gov.county || {}) };
          const flowMap = new Map<string, OdFlow>();
          for (const r of payload.records) {
            if (r[0] !== relation || !r[4] || !r[6]) continue;
            const key = `${r[4]}|${r[5]}→${r[6]}|${r[7]}`;
            const value = metric === "count" ? r[8] : r[9];
            const existing = flowMap.get(key);
            if (existing) existing.value += value;
            else flowMap.set(key, { key, oc: r[4], o: r[5], dc: r[6], d: r[7], value });
          }
          const flows: OdFlow[] = [...flowMap.values()]
            .filter(f => (scope === "跨市" && f.oc !== f.dc) || (scope === "市内" && f.oc === f.dc) || scope === "全部")
            .sort((a, b) => b.value - a.value)
            .slice(0, top);
          setLoaded({ boundaries: payload.boundaries, centers, flows, state: "ready" });
        } else if (kind === "transport") {
          const payload = (await loadOdJson("/data/transport-accessibility.json")) as { countyBoundaries: OdBoundaryPayload; governmentCenters: Record<string, [number, number]>; records: OdTrafficRecord[] };
          if (!alive) return;
          const flows: OdFlow[] = payload.records
            .map(r => ({ key: `${r[0]}|${r[1]}→${r[2]}|${r[3]}`, oc: r[0], o: r[1], dc: r[2], d: r[3], value: Number(r[5]) || 0 }))
            .filter(f => (scope === "跨市" && f.oc !== f.dc) || (scope === "市内" && f.oc === f.dc) || scope === "全部")
            .sort((a, b) => b.value - a.value)
            .slice(0, top);
          setLoaded({ boundaries: payload.countyBoundaries, centers: payload.governmentCenters, flows, state: "ready" });
        } else {
          const payload = (await loadOdJson("/data/population-flow.json")) as { countyBoundaries: OdBoundaryPayload; countyCenters: Record<string, [number, number]>; countyRecords: OdPopulationRecord[] };
          const gov = (await loadOdJson("/data/government-centers.json")) as OdGovCenters;
          if (!alive) return;
          const centers = { ...payload.countyCenters, ...(gov.county || {}) };
          const flows: OdFlow[] = payload.countyRecords
            .map(r => ({ key: `${r[0]}|${r[1]}→${r[2]}|${r[3]}`, oc: r[0], o: r[1], dc: r[2], d: r[3], value: r[4] }))
            .filter(f => (scope === "跨市" && f.oc !== f.dc) || (scope === "市内" && f.oc === f.dc) || scope === "全部")
            .sort((a, b) => b.value - a.value)
            .slice(0, top);
          setLoaded({ boundaries: payload.countyBoundaries, centers, flows, state: "ready" });
        }
      } catch {
        if (alive) setLoaded((g) => ({ ...g, state: "error" }));
      }
    })();
    return () => { alive = false; };
  }, [kind, relation, scope, top, metric]);

  const geometry = useMemo(() => {
    const { boundaries, centers } = loaded;
    if (!boundaries) return null;
    const features = boundaries.features;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const feature of features) for (const polygon of feature.geometry.coordinates) for (const ring of polygon) for (const point of ring) { if (point[0] < minX) minX = point[0]; if (point[0] > maxX) maxX = point[0]; if (point[1] < minY) minY = point[1]; if (point[1] > maxY) maxY = point[1]; }
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2, cosLatitude = Math.cos(centerY * Math.PI / 180), xSpan = Math.max((maxX - minX) * cosLatitude, 0.0001), ySpan = Math.max(maxY - minY, 0.0001), scale = Math.min(820 / xSpan, 500 / ySpan) / 1.08;
    const project = (point: [number, number]): [number, number] => [450 + (point[0] - centerX) * cosLatitude * scale, 300 - (point[1] - centerY) * scale];
    const counties = features.map((feature) => ({ code: feature.properties.code, name: feature.properties.name, city: feature.properties.city, d: odGeometryPath(feature.geometry.coordinates, project) }));
    const projectedCenters: Record<string, [number, number]> = {};
    if (centers) Object.entries(centers).forEach(([key, point]) => { projectedCenters[key] = project(point); });
    const backdrop = fujianBackdrop.map((feature) => ({ code: feature.properties.code, d: odGeometryPath(feature.geometry.coordinates, project) }));
    return { counties, centers: projectedCenters, backdrop, kmPerPixel: 111.32 / (cosLatitude * scale) };
  }, [loaded, fujianBackdrop]);

  const centerFor = (flow: OdFlow, side: "o" | "d") => geometry?.centers[side === "o" ? `${flow.oc}|${flow.o}` : `${flow.dc}|${flow.d}`];
  const labelCandidates = useMemo<MapLabelCandidate[]>(() => loaded.flows.flatMap((flow, index) => (["o", "d"] as const).map((side) => {
    const city = side === "o" ? flow.oc : flow.dc, county = side === "o" ? flow.o : flow.d;
    const point = centerFor(flow, side);
    if (!point) return null;
    return { key: `${city}|${county}`, name: county, point, priority: loaded.flows.length - index, selected: false };
  }).filter((x): x is MapLabelCandidate => x !== null)), [loaded.flows, geometry]);
  const flowObstacles = useMemo<[number, number][]>(() => {
    const out: [number, number][] = [];
    for (const flow of loaded.flows) {
      const start = centerFor(flow, "o"), end = centerFor(flow, "d");
      if (!start || !end) continue;
      const dx = end[0] - start[0], dy = end[1] - start[1];
      if (dx === 0 && dy === 0) { out.push(start); continue; }
      const length = Math.max(1, Math.hypot(dx, dy)), bend = Math.min(46, Math.max(13, length * 0.13)), mx = (start[0] + end[0]) / 2 - dy / length * bend, my = (start[1] + end[1]) / 2 + dx / length * bend;
      for (const point of odQuadraticPoints(start, end, [mx, my])) out.push(point);
    }
    return out;
  }, [loaded.flows, geometry]);
  const values = loaded.flows.map(f => f.value);
  const breaks = odQuantileBreaks(values);
  const flowColors = kind === "transport" ? TRANSPORT_FLOW_COLORS : OD_FLOW_COLORS;
  const legendTitle = kind === "enterprise" ? (metric === "count" ? "关系数量分级" : "金额分级") : kind === "transport" ? "驾车时间分级" : "人口流量分级";
  const legend = numericLegend(flowColors, breaks, values, unit, 0, [0.55, 0.85, 1.25, 1.8, 2.8]);
  const zoom = (factor: number) => setView(current => { const k = Math.min(5, Math.max(1, current.k * factor)); return k === 1 ? { x: 0, y: 0, k } : { x: 450 - (450 - current.x) * k / current.k, y: 300 - (300 - current.y) * k / current.k, k }; });
  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setView(current => { const k = Math.min(5, Math.max(1, current.k * (event.deltaY < 0 ? 1.18 : 1 / 1.18))); return k === 1 ? { x: 0, y: 0, k } : { x: 450 - (450 - current.x) * k / current.k, y: 300 - (300 - current.y) * k / current.k, k }; });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [loaded.state]);
  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y }; };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => { const d = drag.current; if (!d) return; const box = event.currentTarget.getBoundingClientRect(); const ratio = 900 / box.width; setView(current => ({ ...current, x: d.vx + (event.clientX - d.x) * ratio, y: d.vy + (event.clientY - d.y) * ratio })); };
  const onPointerUp = () => { drag.current = null; };
  const subtitle = `${scope === "跨市" ? "跨市" : scope === "市内" ? "市内" : "全域"}${kind === "enterprise" ? `${relation}联系` : kind === "transport" ? "驾车可达性" : "人口流动"} · 前 ${Math.min(top, loaded.flows.length)} 条 OD`;

  // 把完整导出参数挂到 svg 节点上，供图表选择器批量导出复用（带样式注入 + 标题图例，避免克隆后类样式丢失导致黑底）
  useEffect(() => {
    const el = mapRef.current;
    if (el && loaded.state === "ready") {
      (el as unknown as { __odExport?: { title: string; subtitle: string; legendTitle: string; legend: MapLegendItem[] } }).__odExport = {
        title,
        subtitle,
        legendTitle,
        legend,
      };
    }
  }, [title, subtitle, legend, legendTitle, loaded.state]);

  if (kind === "land" || kind === "services") {
    return <OdThematicMap kind={kind} title={title} exportable={exportable} svgRefCallback={svgRefCallback} />;
  }

  return (
    <div className="aiOdMapCard">
      <div className="aiOdMapHead">
        <div className="aiOdMapTitle">{title}</div>
        {exportable && (
          <div className="aiOdMapActions">
            <label className="labelToggle"><input type="checkbox" checked={labelsOn} onChange={(e) => setLabelsOn(e.target.checked)} />标注</label>
            <button type="button" className="aiChartExport" title="导出 PNG" onClick={() => exportWithLabelsOn(labelsOn, setLabelsOn, () => exportMapPng(mapRef.current, { title, subtitle, legendTitle, legend, kmPerPixel: geometry?.kmPerPixel }))}>⤓ PNG</button>
          </div>
        )}
      </div>
      {loaded.state === "loading" ? <div className="aiOdMapState">正在载入 OD 地图数据…</div> : loaded.state === "error" || !geometry ? <div className="aiOdMapState error">OD 地图数据加载失败</div> : (
        <div className="aiOdMapBody">
          <svg ref={(el) => { mapRef.current = el; svgRefCallback?.(el); }} viewBox="0 34 900 600" className="aiOdMap" role="img" aria-label={title} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <defs><marker id="aiOdArrow" markerWidth={4 / view.k} markerHeight={4 / view.k} refX={3.8 / view.k} refY={2 / view.k} orient="auto" markerUnits="userSpaceOnUse"><path d={`M0,0 L${4 / view.k},${2 / view.k} L0,${4 / view.k} Z`} fill="context-stroke" /></marker></defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <g aria-hidden="true">{geometry.backdrop.map((feature) => <path key={`aiod-fj-${feature.code}`} d={feature.d} className="fujianPrefectureBackdrop" />)}</g>
              <g>{geometry.counties.map((c) => <path key={`aiod-${c.code}`} d={c.d} className="populationCounty"><title>{c.city} · {c.name}</title></path>)}</g>
              {labelsOn && <DynamicMapLabels candidates={labelCandidates} view={view} baseLimit={16} obstacles={flowObstacles} />}
              {loaded.flows.map((flow) => {
                const start = centerFor(flow, "o"), end = centerFor(flow, "d");
                if (!start || !end) return null;
                const band = odStrengthBand(flow.value, breaks), dx = end[0] - start[0], dy = end[1] - start[1];
                let d: string;
                if (dx === 0 && dy === 0) d = `M${start[0]},${start[1]} C${start[0] + 26},${start[1] - 38} ${start[0] + 34},${start[1] + 14} ${start[0] + 10},${start[1] + 4}`;
                else { const length = Math.max(1, Math.hypot(dx, dy)), bend = Math.min(46, Math.max(13, length * 0.13)), mx = (start[0] + end[0]) / 2 - dy / length * bend, my = (start[1] + end[1]) / 2 + dx / length * bend; d = `M${start} Q${mx},${my} ${end}`; }
                const width = [0.55, 0.85, 1.25, 1.8, 2.8][band];
                return <path key={flow.key} d={d} className="populationFlow" markerEnd="url(#aiOdArrow)" style={{ stroke: flowColors[band], strokeWidth: width, opacity: 0.5 + band * 0.1 }}><title>{flow.o} → {flow.d}：{new Intl.NumberFormat("zh-CN").format(flow.value)}{unit}</title></path>;
              })}
            </g>
            <MapDecorations kmPerPixel={geometry.kmPerPixel} viewK={view.k} width={900} height={600} />
          </svg>
          <MapScaleOverlay kmPerPixel={geometry.kmPerPixel} viewK={view.k} />
          <div className="mapTools"><button onClick={() => zoom(1.25)} aria-label="放大">＋</button><button onClick={() => zoom(0.8)} aria-label="缩小">－</button><button onClick={() => setView({ x: 0, y: 0, k: 1.1 })} aria-label="复位">复位</button></div>
          <div className="aiOdLegend"><strong>{legendTitle}</strong>{legend.map(item => <span className="legendItem" key={`${item.color}-${item.label}`}><i style={item.shape === "line" ? { background: item.color, height: Math.max(1.5, Math.min(6.5, (item.lineWidth || 1) * 2.2)), borderRadius: 2 } : { background: item.color }} />{item.label}</span>)}</div>
        </div>
      )}
    </div>
  );
}

function AiChart({ data, exportable = true, svgRefCallback }: { data: ChartData; exportable?: boolean; svgRefCallback?: (el: SVGSVGElement | null) => void }) {
  const chartSvgRef = useRef<SVGSVGElement | null>(null);
  const setChartRef = (el: SVGSVGElement | null) => { chartSvgRef.current = el; svgRefCallback?.(el); };
  const type = data.type ?? "bar";
  const title = data.title ?? "";
  const unit = data.unit ?? "";
  const labels = (data.labels ?? []).map(String);
  const values = (data.values ?? []).map(Number);
  const series = data.series ?? [];

  if (type === "pie") {
    const total = values.reduce((s, v) => s + Math.max(v, 0), 0);
    const W = 640, H = 300, cx = 200, cy = 150, r = 110;
    // 预计算每段角度（避免渲染中可变变量）
    const angles: number[] = [];
    let accAngle = -Math.PI / 2;
    for (const v of values) {
      angles.push(accAngle);
      accAngle += total > 0 ? (Math.max(v, 0) / total) * Math.PI * 2 : 0;
    }
    const slices = values.map((v, i) => {
      const a0 = angles[i];
      const a1 = i + 1 < angles.length ? angles[i + 1] : accAngle;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      return { i, v, a0, a1, x0, y0, x1, y1, large, color: CHART_COLORS[i % CHART_COLORS.length], label: labels[i] ?? `第${i + 1}项` };
    });
    return (
      <div className="aiChart">
        <div className="aiChartHead">
          {title && <div className="aiChartTitle">{title}{unit ? `（${unit}）` : ""}</div>}
          {exportable && <ChartExportButton svgRef={chartSvgRef} filename={`厦漳泉-${title || "图表"}`} />}
        </div>
        <div className="aiChartBody">
          <svg ref={setChartRef} viewBox={`0 0 ${W} ${H}`} role="img">
            {slices.map((s) => (
              <path key={s.i} d={`M ${cx} ${cy} L ${s.x0} ${s.y0} A ${r} ${r} 0 ${s.large} 1 ${s.x1} ${s.y1} Z`} fill={s.color} stroke="#fff" strokeWidth="1.5">
                <title>{`${s.label}：${formatValue(s.v)}${unit}`}</title>
              </path>
            ))}
          </svg>
          <div className="aiChartLegend">
            {slices.map((s) => (
              <div key={s.i} className="aiChartLegendItem"><i style={{ background: s.color }} /><span>{s.label}</span><b>{formatValue(s.v)}{unit}</b>{total > 0 ? `（${(s.v / total * 100).toFixed(1)}%）` : ""}</div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (type === "line" && series.length) {
    const W = 640, H = 320, PL = 64, PR = 16, PT = 44, PB = 48;
    const allV = series.flatMap((s) => s.values.map(Number));
    const maxV = Math.max(...allV, 1) * 1.08;
    const n = Math.max(...series.map((s) => s.values.length), 1);
    const plotW = W - PL - PR, plotH = H - PT - PB;
    const px = (i: number) => PL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const py = (v: number) => PT + plotH - (v / maxV) * plotH;
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ v: maxV * t, y: PT + plotH - t * plotH }));
    return (
      <div className="aiChart">
        <div className="aiChartHead">
          {title && <div className="aiChartTitle">{title}{unit ? `（${unit}）` : ""}</div>}
          {exportable && <ChartExportButton svgRef={chartSvgRef} filename={`厦漳泉-${title || "图表"}`} />}
        </div>
        <svg ref={setChartRef} viewBox={`0 0 ${W} ${H}`} role="img">
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={PL} y1={t.y} x2={W - PR} y2={t.y} stroke="#e3e9e5" strokeWidth="1" />
              <text x={PL - 6} y={t.y + 3} textAnchor="end" fontSize="10" fill="#8a9893">{formatValue(t.v)}</text>
            </g>
          ))}
          {labels.map((lb, i) => (
            <text key={i} x={px(i)} y={H - PB + 16} textAnchor="middle" fontSize="10" fill="#6b7a75">{lb.length > 6 ? `${lb.slice(0, 6)}…` : lb}</text>
          ))}
          {series.map((s, si) => (
            <g key={si}>
              <polyline
                fill="none" stroke={CHART_COLORS[si % CHART_COLORS.length]} strokeWidth="2.4"
                points={s.values.map((v, i) => `${px(i)},${py(Number(v))}`).join(" ")}
              />
              {s.values.map((v, i) => (
                <circle key={i} cx={px(i)} cy={py(Number(v))} r="3.4" fill="#fff" stroke={CHART_COLORS[si % CHART_COLORS.length]} strokeWidth="2">
                  <title>{`${labels[i] ?? i + 1} · ${s.name}：${formatValue(Number(v))}${unit}`}</title>
                </circle>
              ))}
            </g>
          ))}
        </svg>
        <div className="aiChartLegend">
          {series.map((s, i) => (
            <div key={i} className="aiChartLegendItem"><i style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} /><span>{s.name}</span></div>
          ))}
        </div>
      </div>
    );
  }

  // bar / hbar
  const horizontal = type === "hbar";
  const W = 640, H = 360;
  const hasNeg = values.some((v) => v < 0);
  const maxV = (hasNeg ? Math.max(...values.map((v) => Math.abs(v)), 1) : Math.max(...values, 1)) * 1.1;
  const n = Math.max(values.length, 1);
  if (horizontal) {
    const PL = 88, PR = 64, PT = 40, PB = 16;
    const plotW = W - PL - PR, plotH = H - PT - PB;
    const barH = Math.min(plotH / n * 0.6, 34);
    const zeroX = hasNeg ? PL + plotW / 2 : PL;
    return (
      <div className="aiChart">
        <div className="aiChartHead">
          {title && <div className="aiChartTitle">{title}{unit ? `（${unit}）` : ""}</div>}
          {exportable && <ChartExportButton svgRef={chartSvgRef} filename={`厦漳泉-${title || "图表"}`} />}
        </div>
        <svg ref={setChartRef} viewBox={`0 0 ${W} ${H}`} role="img">
          {hasNeg && <line x1={zeroX} y1={PT} x2={zeroX} y2={H - PB} stroke="#9fb4ab" strokeWidth="1.2" />}
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
            <g key={i}>
              <line x1={PL + t * plotW} y1={PT} x2={PL + t * plotW} y2={H - PB} stroke="#e3e9e5" strokeWidth="1" />
              <text x={PL + t * plotW} y={H - PB + 14} textAnchor="middle" fontSize="9" fill="#8a9893">{hasNeg ? formatValue((t * 2 - 1) * maxV) : formatValue(maxV * t)}</text>
            </g>
          ))}
          {values.map((v, i) => {
            const y = PT + (i / n) * plotH + (plotH / n - barH) / 2;
            const w = Math.max((Math.abs(v) / maxV) * plotW, 1);
            const x = hasNeg ? (v >= 0 ? zeroX : zeroX - w) : zeroX;
            return (
              <g key={i}>
                <rect x={x} y={y} width={w} height={barH} rx="3" fill={CHART_COLORS[i % CHART_COLORS.length]}>
                  <title>{`${labels[i] ?? i + 1}：${formatValue(v)}${unit}`}</title>
                </rect>
                <text x={PL - 6} y={y + barH / 2 + 3} textAnchor="end" fontSize="10" fill="#6b7a75">{labels[i]?.length > 6 ? `${labels[i].slice(0, 6)}…` : labels[i] ?? i + 1}</text>
                <text x={x + w + 4} y={y + barH / 2 + 3} fontSize="10" fill="#173f38" fontWeight="700">{formatValue(v)}{unit}</text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }
  const PL = 48, PR = 16, PT = 40, PB = 52;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const barW = Math.min(plotW / n * 0.55, 56);
  const zeroY = hasNeg ? PT + plotH / 2 : PT + plotH;
  return (
    <div className="aiChart">
      <div className="aiChartHead">
        {title && <div className="aiChartTitle">{title}{unit ? `（${unit}）` : ""}</div>}
        {exportable && <ChartExportButton svgRef={chartSvgRef} filename={`厦漳泉-${title || "图表"}`} />}
      </div>
      <svg ref={setChartRef} viewBox={`0 0 ${W} ${H}`} role="img">
        {hasNeg && <line x1={PL} y1={zeroY} x2={W - PR} y2={zeroY} stroke="#9fb4ab" strokeWidth="1.2" />}
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <g key={i}>
            <line x1={PL} y1={PT + plotH - t * plotH} x2={W - PR} y2={PT + plotH - t * plotH} stroke="#e3e9e5" strokeWidth="1" />
            <text x={PL - 6} y={PT + plotH - t * plotH + 3} textAnchor="end" fontSize="10" fill="#8a9893">{hasNeg ? formatValue((t * 2 - 1) * maxV) : formatValue(maxV * t)}</text>
          </g>
        ))}
        {values.map((v, i) => {
          const h = Math.max((Math.abs(v) / maxV) * plotH, 1);
          const x = PL + (i / n) * plotW + (plotW / n - barW) / 2;
          const y = hasNeg ? (v >= 0 ? zeroY - h : zeroY) : zeroY - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h} rx="3" fill={CHART_COLORS[i % CHART_COLORS.length]}>
                <title>{`${labels[i] ?? i + 1}：${formatValue(v)}${unit}`}</title>
              </rect>
              <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize="10" fill="#173f38" fontWeight="700">{formatValue(v)}</text>
              <text x={x + barW / 2} y={H - PB + 16} textAnchor="middle" fontSize="10" fill="#6b7a75">{labels[i]?.length > 6 ? `${labels[i].slice(0, 6)}…` : labels[i] ?? i + 1}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------- Markdown 轻量渲染（含认可/错误高亮） ------------------------- */

type MarkItem = { text: string; kind: "accept" | "error" };

/** 在文本中找出所有标记片段并高亮（认可绿/错误红），重叠时优先先出现者 */
function highlightText(text: string, marks: MarkItem[], keyPrefix: string): React.ReactNode[] {
  if (!marks.length || !text) return [<span key={`${keyPrefix}-0`}>{text}</span>];
  const ranges: { start: number; end: number; kind: "accept" | "error" }[] = [];
  for (const mark of marks) {
    if (!mark.text) continue;
    let from = 0;
    for (;;) {
      const idx = text.indexOf(mark.text, from);
      if (idx < 0) break;
      ranges.push({ start: idx, end: idx + mark.text.length, kind: mark.kind });
      from = idx + mark.text.length;
    }
  }
  if (!ranges.length) return [<span key={`${keyPrefix}-0`}>{text}</span>];
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: typeof ranges = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start < last.end) continue;
    merged.push(r);
  }
  const out: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach((r, i) => {
    if (r.start > cursor) out.push(<span key={`${keyPrefix}-a${i}`}>{text.slice(cursor, r.start)}</span>);
    out.push(<mark key={`${keyPrefix}-m${i}`} className={r.kind === "error" ? "aiMarkError" : "aiMarkAccept"}>{text.slice(r.start, r.end)}</mark>);
    cursor = r.end;
  });
  if (cursor < text.length) out.push(<span key={`${keyPrefix}-z`}>{text.slice(cursor)}</span>);
  return out;
}

function inline(text: string, keyPrefix: string, marks: MarkItem[] = []): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={`${keyPrefix}-${idx}`}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${keyPrefix}-${idx}`}>{highlightText(part.slice(2, -2), marks, `${keyPrefix}-${idx}`)}</strong>;
    return highlightText(part, marks, `${keyPrefix}-${idx}`);
  });
}

function Markdown({ text, marks = [] }: { text: string; marks?: MarkItem[] }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let block: string[] = [];
  let blockKind: "list" | "olist" | "table" | "code" | null = null;
  let key = 0;

  const flush = () => {
    if (!block.length) return;
    const k = key++;
    if (blockKind === "list") {
      out.push(<ul key={k}>{block.map((li, i) => <li key={`${k}-${i}`}>{inline(li.replace(/^[-*]\s+/, ""), `${k}-${i}`, marks)}</li>)}</ul>);
    } else if (blockKind === "olist") {
      out.push(<ol key={k}>{block.map((li, i) => <li key={`${k}-${i}`}>{inline(li.replace(/^\d+\.\s+/, ""), `${k}-${i}`, marks)}</li>)}</ol>);
    } else if (blockKind === "table") {
      const head = block[0].split("|").map((c) => c.trim()).filter(Boolean);
      const rows = block.slice(2).map((r) => r.split("|").map((c) => c.trim()).filter(Boolean));
      out.push(
        <table key={k}>
          <thead><tr>{head.map((c, i) => <th key={`${k}-h-${i}`}>{inline(c, `${k}-h-${i}`, marks)}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={`${k}-r-${i}`}>{r.map((c, j) => <td key={`${k}-c-${i}-${j}`}>{inline(c, `${k}-c-${i}-${j}`, marks)}</td>)}</tr>)}</tbody>
        </table>,
      );
    } else if (blockKind === "code") {
      const first = block[0]?.trim() ?? "";
      const body = block.slice(1).join("\n").trim();
      if (first === "chartjson" && body) {
        try {
          const parsed = JSON.parse(body) as ChartData;
          // 仅渲染平台地图（odmap）；统计图表块暂时不渲染，避免报告出现异常图形
          if (parsed.type === "odmap") out.push(<OdMapCard key={k} data={parsed} />);
        } catch {
          out.push(<pre key={k}><code>{block.join("\n")}</code></pre>);
        }
      } else {
        out.push(<pre key={k}><code>{block.join("\n")}</code></pre>);
      }
    }
    block = [];
    blockKind = null;
  };

  for (const line of lines) {
    const t = line.trim();
    if (blockKind === "code") {
      if (t.startsWith("```")) { flush(); continue; }
      block.push(line);
      continue;
    }
    if (t.startsWith("```")) { flush(); blockKind = "code"; block = []; continue; }
    if (t.startsWith("|") && t.endsWith("|")) {
      const isSep = /^\|[\s:|-]+\|$/.test(t) && t.includes("-");
      if (blockKind !== "table") { flush(); blockKind = "table"; }
      if (!isSep) block.push(t);
      continue;
    }
    if (blockKind === "table") flush();
    if (/^[-*]\s+/.test(t)) { if (blockKind !== "list") { flush(); blockKind = "list"; } block.push(t); continue; }
    if (/^\d+\.\s+/.test(t)) { if (blockKind !== "olist") { flush(); blockKind = "olist"; } block.push(t); continue; }
    if (blockKind === "list" || blockKind === "olist") flush();
    if (/^#{1,3}\s/.test(t)) {
      const level = t.match(/^#+/)?.[0].length ?? 1;
      const content = t.replace(/^#+\s+/, "");
      const k = key++;
      if (level === 1) out.push(<h2 key={k}>{inline(content, `${k}`, marks)}</h2>);
      else if (level === 2) out.push(<h3 key={k}>{inline(content, `${k}`, marks)}</h3>);
      else out.push(<h4 key={k}>{inline(content, `${k}`, marks)}</h4>);
      continue;
    }
    if (/^---+$/.test(t)) { const k = key++; out.push(<hr key={k} />); continue; }
    if (t.startsWith(">")) { const k = key++; out.push(<blockquote key={k}>{inline(t.replace(/^>\s?/, ""), `${k}`, marks)}</blockquote>); continue; }
    if (t === "") continue;
    const k = key++;
    out.push(<p key={k}>{inline(line, `${k}`, marks)}</p>);
  }
  flush();
  return <div className="aiMarkdown">{out}</div>;
}

/* ------------------------- SSE 流式请求 ------------------------- */

async function streamChat(
  body: Record<string, unknown>,
  signal: AbortSignal,
  onDelta: (delta: string) => void,
): Promise<void> {
  const resp = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) {
    let message = `请求失败（HTTP ${resp.status}）`;
    try { const j = await resp.json(); if (j?.error) message = j.error; } catch { /* 非 JSON */ }
    throw new Error(message);
  }
  if (!resp.body) throw new Error("响应没有数据流");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) onDelta(delta);
        } catch { /* 忽略无法解析的事件 */ }
      }
    }
  }
}

/* ------------------------- localStorage 审核稿存取 ------------------------- */

function loadStore(): Record<string, SavedReport> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, SavedReport>;
  } catch { /* 忽略损坏数据 */ }
  return {};
}
function saveStore(store: Record<string, SavedReport>) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* 忽略容量/隐私模式异常 */ }
}

function loadAccepted(): Record<string, AcceptedConclusion[]> {
  try {
    const raw = localStorage.getItem(ACCEPTED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, AcceptedConclusion[]>;
      // 兼容旧数据（无 kind 字段）→ 默认 accept
      const normalized: Record<string, AcceptedConclusion[]> = {};
      for (const [topic, list] of Object.entries(parsed)) {
        normalized[topic] = (list ?? []).map((a) => ({ id: a.id, ts: a.ts, text: a.text, kind: (a as { kind?: "accept" | "error" }).kind ?? "accept" }));
      }
      return normalized;
    }
  } catch { /* 忽略损坏数据 */ }
  return {};
}
function saveAccepted(store: Record<string, AcceptedConclusion[]>) {
  try { localStorage.setItem(ACCEPTED_KEY, JSON.stringify(store)); } catch { /* 忽略 */ }
}

/* ------------------------- 模块组件 ------------------------- */

export default function AiAnalysisModule() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [modelsInfo, setModelsInfo] = useState<ModelInfo[]>([]);
  const [providerId, setProviderId] = useState<ProviderId>("deepseek");
  const [model, setModel] = useState<string>(FALLBACK_PROVIDERS.deepseek.defaultModel);
  const [summaryError, setSummaryError] = useState("");
  const [activeTopic, setActiveTopic] = useState<TopicId | null>(null);
  const [reports, setReports] = useState<Partial<Record<TopicId, string>>>({});
  const [store, setStore] = useState<Record<string, SavedReport>>(() => loadStore());
  const [accepted, setAccepted] = useState<Record<string, AcceptedConclusion[]>>(() => loadAccepted());
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState("");
  const [repairNotice, setRepairNotice] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatError, setChatError] = useState("");
  const [editMode, setEditMode] = useState(false);  const [editText, setEditText] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [selBar, setSelBar] = useState<{ text: string; top: number; left: number } | null>(null);
  const [wordRange, setWordRange] = useState<WordRange>(() => loadWordRange());
  const [showWordPicker, setShowWordPicker] = useState(false);
  const [pendingTopic, setPendingTopic] = useState<TopicId | null>(null);
  const reportRef = useRef<HTMLDivElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const saveWordRange = useCallback((r: WordRange) => {
    setWordRange(r);
    try { localStorage.setItem(WORD_KEY, JSON.stringify(r)); } catch { /* 忽略 */ }
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  const reportEndRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<string | null>(null);
  const storeRef = useRef<Record<string, SavedReport>>({});
  const acceptedRef = useRef<Record<string, AcceptedConclusion[]>>({});
  const reportsRef = useRef<Partial<Record<TopicId, string>>>({});

  /* 加载模型注册表（/api/ai/models）+ 数据摘要 */
  useEffect(() => {
    let active = true;
    fetch("/api/ai/models").then((r) => (r.ok ? r.json() : null)).then((data) => {
      if (!active || !data) return;
      const ps = (data.providers ?? []) as ProviderInfo[];
      const ms = (data.models ?? []) as ModelInfo[];
      setProviders(ps);
      setModelsInfo(ms);
      const preferred = ps.find((p) => p.id === "deepseek" && p.configured) ?? ps.find((p) => p.configured) ?? ps[0];
      if (preferred) {
        setProviderId(preferred.id as ProviderId);
        setModel(preferred.defaultModel);
      }
    }).catch(() => { /* 本地无 worker 时用内置默认 */ });
    fetch("/data/ai/summary.json")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
      .then((text) => { if (active) summaryRef.current = text; })
      .catch(() => { if (active) setSummaryError("数据摘要加载失败，请确认 public/data/ai/summary.json 已生成"); });
    return () => { active = false; };
  }, []);
  useEffect(() => { storeRef.current = store; }, [store]);
  useEffect(() => { acceptedRef.current = accepted; }, [accepted]);
  useEffect(() => { reportsRef.current = reports; }, [reports]);

  useEffect(() => {
    reportEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [reports, streaming]);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatHistory, chatStreaming]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    setChatStreaming(false);
  }, []);

  const providerConfigured = providers.length
    ? (providers.find((p) => p.id === providerId)?.configured ?? false)
    : !!providerId;

  const displayReport = useCallback((topicId: TopicId): string => {
    const saved = store[topicId];
    if (saved?.reviewed) return saved.reviewed.content;
    if (reports[topicId]) return reports[topicId];
    if (saved?.draft) return saved.draft.content;
    const versions = saved?.versions ?? [];
    return versions.length ? versions[versions.length - 1].content : "";
  }, [reports, store]);

  /* 质量自检 → 不合格自动修订 */
  const runQualityCheck = useCallback(async (topicId: TopicId, content: string, pid: ProviderId, mdl: string): Promise<void> => {
    let result: { ok: boolean; warnings: string[] } | null = null;
    try {
      const resp = await fetch("/api/ai/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: content.slice(0, 20000) }),
      });
      if (resp.ok) result = await resp.json();
    } catch { /* check 不可用时跳过自动修订 */ }
    if (!result || result.ok) return;
    setRepairNotice(`初版报告未达质量标准，正在自动修订：${result.warnings.join("；")}`);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(
        {
          provider: pid,
          model: mdl,
          topicId: "repair",
          summaryText: summaryRef.current ?? "",
          messages: [{ role: "user", content: `质量警告：${result.warnings.join("；")}\n\n原报告：\n${content.slice(0, 20000)}` }],
        },
        controller.signal,
        (delta) => setReports((prev) => ({ ...prev, [topicId]: (prev[topicId] ?? "") + delta })),
      );
      setRepairNotice("已自动修订完成");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setRepairNotice("自动修订失败，已保留初版报告");
    } finally {
      abortRef.current = null;
    }
  }, []);

  const generateReport = useCallback(async (topicId: TopicId, range?: WordRange) => {
    if (streaming || chatStreaming) return;
    if (!summaryRef.current) { setStreamError("数据摘要尚未就绪，请稍候重试"); return; }
    setActiveTopic(topicId);
    setEditMode(false);
    setRepairNotice("");
    setStreamError("");
    // 当前显示版本归档到历史
    setStore((prev) => {
      const current = prev[topicId]?.reviewed?.content ?? prev[topicId]?.draft?.content ?? reports[topicId] ?? "";
      const next = { ...prev };
      const saved = next[topicId] ?? { reviewed: null, versions: [], draft: null };
      if (current) saved.versions = [...saved.versions, { ts: Date.now(), content: current, source: "生成" }].slice(-3);
      next[topicId] = saved;
      saveStore(next);
      return next;
    });
    setReports((prev) => ({ ...prev, [topicId]: "" }));
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    try {
      await streamChat(
        { provider: providerId, model, topicId, summaryText: summaryRef.current, acceptedConclusions: (accepted[topicId] ?? []), wordRange: range ?? undefined, messages: [{ role: "user", content: "请生成分析报告。" }] },
        controller.signal,
        (delta) => { acc += delta; setReports((prev) => ({ ...prev, [topicId]: (prev[topicId] ?? "") + delta })); },
      );
      // 生成完成 → 质量自检 + 自动修订，并把最终报告自动保存为分析稿（draft）+ 历史版本（刷新后仍可找回，不重新生成）
      if (acc) {
        await runQualityCheck(topicId, acc, providerId, model);
        const final = reportsRef.current[topicId] ?? acc;
        if (final.trim()) {
          setStore((prev) => {
            const next = { ...prev };
            const saved = next[topicId] ?? { reviewed: null, versions: [], draft: null };
            saved.draft = { content: final, ts: Date.now() };
            const last = saved.versions[saved.versions.length - 1];
            if (!last || last.content !== final) saved.versions = [...saved.versions, { ts: Date.now(), content: final, source: "生成" }].slice(-3);
            next[topicId] = saved;
            saveStore(next);
            return next;
          });
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setStreamError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [providerId, model, streaming, chatStreaming, reports, runQualityCheck, accepted]);

  const openTopic = useCallback((topicId: TopicId) => {
    setActiveTopic(topicId);
    setEditMode(false);
    setShowHistory(false);
    const saved = storeRef.current[topicId];
    const hasContent = !!saved?.reviewed || !!saved?.draft || !!saved?.versions?.length;
    if (!hasContent && !reports[topicId]) generateReport(topicId, wordRange);
  }, [reports, generateReport, wordRange]);

  const saveReviewed = useCallback(() => {
    if (!activeTopic) return;
    const content = editText.trim();
    if (!content) return;
    const isFirstReview = !storeRef.current[activeTopic]?.reviewed;
    setStore((prev) => {
      const next = { ...prev };
      const saved = next[activeTopic] ?? { reviewed: null, versions: [] };
      saved.reviewed = { content, ts: Date.now() };
      saved.versions = [...saved.versions, { ts: Date.now(), content, source: "审核稿" }].slice(-3);
      next[activeTopic] = saved;
      saveStore(next);
      return next;
    });
    setEditMode(false);
    setRepairNotice(isFirstReview ? "已保存为审核稿，下次打开将优先显示此版本" : "审核稿已更新保存");
  }, [activeTopic, editText]);

  /** 标记认可/错误结论：把报告或追问回答中选中的文字存为该主题的标注结论，下次生成/追问自动延续或避免 */
  const markSelection = useCallback((kind: "accept" | "error") => {
    const key = activeTopic ?? "chat";
    const text = selBar?.text ?? window.getSelection()?.toString().trim() ?? "";
    if (text.length < 10) { setRepairNotice("请先在报告或追问回答中选中要标记的段落文字（至少 10 字）"); return; }
    setAccepted((prev) => {
      const next = { ...prev };
      // 同一句话（text 相同）不重复标记：相同内容直接切换为新标记，避免"认可+错误"并存
      const list = (next[key] ?? []).filter((a) => a.text !== text);
      next[key] = [...list, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ts: Date.now(), text, kind }].slice(-30);
      saveAccepted(next);
      return next;
    });
    window.getSelection()?.removeAllRanges();
    setSelBar(null);
    setRepairNotice(kind === "error" ? "已标记为错误结论：下次生成与追问将避免沿用该说法" : "已标记为认可结论：下次生成与追问时将自动延续该结论");
  }, [activeTopic, selBar]);

  /** 报告区或追问对话区选中文字 → 显示浮动标记条（无需回到顶部） */
  const handleReportMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { setSelBar(null); return; }
    const text = sel.toString().trim();
    if (text.length < 10) { setSelBar(null); return; }
    const anchor = sel.anchorNode as Node | null;
    const inReport = reportRef.current && anchor && reportRef.current.contains(anchor);
    const inChat = chatRef.current && anchor && chatRef.current.contains(anchor);
    if (inReport || inChat) {
      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setSelBar({
          text,
          top: Math.max(8, rect.top - 44),
          left: Math.min(window.innerWidth - 260, Math.max(8, rect.left + rect.width / 2 - 120)),
        });
      } catch { setSelBar(null); }
    } else setSelBar(null);
  }, []);

  // 滚动或点击其他区域时收起浮动标记条
  useEffect(() => {
    if (!selBar) return;
    const close = () => setSelBar(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [selBar]);

  const removeAccepted = useCallback((id: string) => {
    const key = activeTopic ?? "chat";
    setAccepted((prev) => {
      const next = { ...prev };
      next[key] = (next[key] ?? []).filter((a) => a.id !== id);
      saveAccepted(next);
      return next;
    });
  }, [activeTopic]);

  /** 当前选中文本是否已标记（已标记时浮动条切换为「取消标记」） */
  const existingMark = useMemo(() => {
    if (!selBar) return null;
    return (accepted[activeTopic ?? "chat"] ?? []).find((a) => a.text === selBar.text) ?? null;
  }, [activeTopic, selBar, accepted]);

  const clearMark = useCallback(() => {
    const key = activeTopic ?? "chat";
    if (!existingMark) return;
    setAccepted((prev) => {
      const next = { ...prev };
      next[key] = (next[key] ?? []).filter((a) => a.id !== existingMark.id);
      saveAccepted(next);
      return next;
    });
    window.getSelection()?.removeAllRanges();
    setSelBar(null);
    setRepairNotice("已取消该标记");
  }, [activeTopic, existingMark]);

  /** 删除历史版本（保留审核稿与当前显示） */
  const removeVersion = useCallback((ts: number) => {
    if (!activeTopic) return;
    setStore((prev) => {
      const saved = prev[activeTopic];
      if (!saved) return prev;
      const next = { ...prev, [activeTopic]: { ...saved, versions: saved.versions.filter((v) => v.ts !== ts) } };
      saveStore(next);
      return next;
    });
  }, [activeTopic]);

  /** 把追问问答格式化为可并入/可融合的文本 */
  const formatChatForMerge = useCallback((): string => {
    return chatHistory.slice(-6).map((m) => (m.role === "user" ? `**问：** ${m.content}` : `**答：** ${m.content}`)).join("\n\n");
  }, [chatHistory]);

  /** 并入追问：把问答追加为「追问补充」章节，保存为新版本 */
  const appendChatToReport = useCallback(() => {
    if (!activeTopic) return;
    const qa = chatHistory.some((m) => m.role === "user") ? formatChatForMerge() : "";
    if (!qa) { setRepairNotice("暂无追问内容可并入"); return; }
    const merged = `${displayReport(activeTopic) || ""}\n\n## 追问补充\n\n${qa}`;
    setReports((prev) => ({ ...prev, [activeTopic!]: merged }));
    setStore((prev) => {
      const next = { ...prev };
      const saved = next[activeTopic!] ?? { reviewed: null, versions: [] };
      saved.versions = [...saved.versions, { ts: Date.now(), content: merged, source: "追问补充" }].slice(-3);
      next[activeTopic!] = saved;
      saveStore(next);
      return next;
    });
    setRepairNotice("已把追问内容并入报告并保存为新版本（可继续编辑或保存为审核稿）");
  }, [activeTopic, chatHistory, formatChatForMerge, displayReport]);

  /** AI 融合修订：把原报告 + 追问记录交给模型，融合输出完整新报告 */
  const mergeReport = useCallback(async () => {
    if (!activeTopic || streaming || chatStreaming) return;
    if (!summaryRef.current) { setStreamError("数据摘要尚未就绪，请稍候重试"); return; }
    const qa = formatChatForMerge();
    if (!qa) { setRepairNotice("暂无追问内容可融合"); return; }
    const original = displayReport(activeTopic);
    setStreaming(true);
    setRepairNotice("正在把追问结论融合进报告…");
    setReports((prev) => ({ ...prev, [activeTopic!]: "" }));
    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    try {
      await streamChat(
        {
          provider: providerId, model, topicId: "merge", summaryText: summaryRef.current,
          acceptedConclusions: (accepted[activeTopic!] ?? []),
          messages: [{ role: "user", content: `原始报告：\n${original}\n\n追问记录：\n${qa}\n\n请融合输出完整新报告。` }],
        },
        controller.signal,
        (delta) => { acc += delta; setReports((prev) => ({ ...prev, [activeTopic!]: (prev[activeTopic!] ?? "") + delta })); },
      );
      if (acc) {
        setStore((prev) => {
          const next = { ...prev };
          const saved = next[activeTopic!] ?? { reviewed: null, versions: [] };
          saved.versions = [...saved.versions, { ts: Date.now(), content: acc, source: "AI 融合" }].slice(-3);
          next[activeTopic!] = saved;
          saveStore(next);
          return next;
        });
        setRepairNotice("融合完成：追问结论已并入报告并保存为新版本（可编辑或保存为审核稿）");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setStreamError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [activeTopic, streaming, chatStreaming, formatChatForMerge, displayReport, providerId, model, accepted]);

  const sendChat = useCallback(async () => {
    const question = chatInput.trim();
    if (!question || chatStreaming || streaming) return;
    if (!summaryRef.current) { setChatError("数据摘要尚未就绪，请稍候重试"); return; }
    setChatInput("");
    setChatError("");
    const history: ChatMessage[] = [...chatHistory, { role: "user", content: question }];
    setChatHistory(history);
    setChatStreaming(true);
    setChatHistory((prev) => [...prev, { role: "assistant", content: "" }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const context = activeTopic ? (() => { const r = displayReport(activeTopic); return r.length <= 8000 ? r : `${r.slice(0, 4000)}\n……（中间省略）……\n${r.slice(-3000)}`; })() : "";
      const userContent = context
        ? `背景报告（${TOPICS.find((t) => t.id === activeTopic)?.title ?? "当前主题"}）：\n${context}\n\n请基于平台数据回答：${question}`
        : question;
      const upstream = history.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const last = { role: "user" as const, content: userContent };
      await streamChat(
        { provider: providerId, model, topicId: activeTopic ?? "chat", summaryText: summaryRef.current, tools: true, acceptedConclusions: (accepted[activeTopic ?? "chat"] ?? []), messages: [...upstream.slice(0, -1), last] },
        controller.signal,
        (delta) => setChatHistory((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: next[next.length - 1].content + delta };
          return next;
        }),
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatStreaming(false);
      abortRef.current = null;
    }
  }, [chatInput, chatHistory, chatStreaming, streaming, providerId, model, activeTopic, displayReport, accepted]);

  const current = activeTopic ? displayReport(activeTopic) : "";
  /* 图表选择器：从报告文本提取 chartjson 块，支持勾选批量导出 PNG */
  const reportCharts = useMemo(() => {
    const list: { key: string; data: ChartData }[] = [];
    const re = /```chartjson\s*([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(current))) {
      try {
        const data = JSON.parse(m[1].trim()) as ChartData;
        if (data.type === "odmap") list.push({ key: `chart-${i++}`, data });
      } catch { /* 忽略无法解析的块 */ }
    }
    return list;
  }, [current]);
  const [selectedCharts, setSelectedCharts] = useState<Set<string>>(() => new Set());
  useEffect(() => { setSelectedCharts(new Set()); }, [current]);
  const chartRefs = useRef<Record<string, SVGSVGElement | null>>({});
  const toggleChart = useCallback((key: string) => {
    setSelectedCharts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const exportSelectedCharts = useCallback(() => {
    reportCharts.filter((c) => selectedCharts.has(c.key)).forEach((c, i) => {
      const svg = chartRefs.current[c.key];
      if (!svg) return;
      // OD 地图走 exportMapPng（注入样式 + 标题/图例，避免克隆后类样式丢失导致黑底与巨大字号）
      const od = (svg as unknown as { __odExport?: { title: string; subtitle: string; legendTitle: string; legend: MapLegendItem[] } }).__odExport;
      if (od) setTimeout(() => exportMapPng(svg, od), i * 300);
      else setTimeout(() => exportSvgAsPng(svg, `厦漳泉-${c.data.title || `图表${i + 1}`}`), i * 300);
    });
  }, [reportCharts, selectedCharts]);
  const providerMeta = (providers.length ? providers.find((p) => p.id === providerId) : null)
    ?? FALLBACK_PROVIDERS[providerId];
  const modelOptions: Record<string, string> = modelsInfo.length
    ? Object.fromEntries(modelsInfo.filter((m) => m.provider === providerId).map((m) => [m.key, m.label]))
    : FALLBACK_MODELS[providerId];
  const history = activeTopic ? store[activeTopic]?.versions ?? [] : [];
  const lastAssistant = [...chatHistory].reverse().find((m) => m.role === "assistant");
  const reportConflict = !!lastAssistant && /⚠️|与背景报告不一致/.test(lastAssistant.content);

  return (
    <section className="aiModule">
      {/* 模型工具栏 */}
      <div className="aiToolbar">
        <div className="aiProviderToggle" role="tablist" aria-label="模型厂商">
          {(providers.length ? providers : (Object.entries(FALLBACK_PROVIDERS) as [ProviderId, { label: string }][])).map((p) => (
            <button
              key={p.id}
              type="button"
              className={providerId === p.id ? "active" : ""}
              onClick={() => { setProviderId(p.id as ProviderId); setModel((p as ProviderInfo).defaultModel ?? FALLBACK_PROVIDERS[p.id as ProviderId].defaultModel); setChatHistory([]); }}
            >
              {p.label}
              {providers.length > 0 && !(p as ProviderInfo).configured && <i className="aiKeyDot" title="API Key 未配置" />}
            </button>
          ))}
        </div>
        <label className="aiModelSelect">模型
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {Object.entries(modelOptions).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </select>
        </label>
        {providers.length > 0 && !providerConfigured && (
          <span className="aiKeyWarn">未配置 {providerMeta.apiKeyEnv}，调用该模型将失败（服务端 503）</span>
        )}
        <p className="aiToolbarHint">平台将数据摘要（区县对、镇街、产业门类、用地与 POI 中类等）随请求提交，由服务端调用所选模型生成分析；API Key 不经过浏览器。报告可编辑保存为「审核稿」，历史版本保存在本机。</p>
      </div>

      {/* 分析主题 */}
      <div className="aiTopics">
        {TOPICS.map((topic) => {
          const hasReviewed = !!store[topic.id]?.reviewed;
          const hasText = hasReviewed || !!store[topic.id]?.draft || !!reports[topic.id];
          const busy = streaming && activeTopic === topic.id;
          return (
            <button
              key={topic.id}
              type="button"
              className={`aiTopicCard${activeTopic === topic.id ? " active" : ""}${busy ? " busy" : ""}${hasReviewed ? " reviewed" : ""}`}
              onClick={() => { if (busy) return; if (hasText) openTopic(topic.id); else { setPendingTopic(topic.id); setShowWordPicker(true); } }}
            >
              <b>{topic.tag}</b>
              <span>{topic.title}</span>
              <small>{topic.desc}</small>
              {hasText && <i className={`aiTopicState${hasReviewed ? " reviewed" : ""}`}>{hasReviewed ? "审核稿" : "分析稿"}</i>}
              <em>{busy ? "正在生成…" : hasReviewed ? "查看审核稿" : hasText ? "查看分析稿" : "生成报告"}</em>
            </button>
          );
        })}
      </div>

      {/* 报告区 */}
      <div className="aiPanel">
        <div className="aiPanelHead">
          <div className="aiPanelTitle">
            <h3>{activeTopic ? TOPICS.find((t) => t.id === activeTopic)?.title : "分析报告"}</h3>
            {activeTopic && current && (
              <span className={`aiSourceBadge${store[activeTopic]?.reviewed ? " reviewed" : ""}`}>
                {editMode ? (store[activeTopic]?.reviewed ? "编辑中 · 审核稿" : "编辑中 · 分析稿") : (store[activeTopic]?.reviewed ? "人工审核稿" : "分析稿")}
              </span>
            )}
          </div>
          <div>
            {streaming && <button type="button" className="aiStop" onClick={stopStreaming}>停止生成</button>}
            {activeTopic && !streaming && (
              <>
                <button type="button" onClick={() => { setPendingTopic(null); setShowWordPicker(true); }}>{current ? "重新生成" : "生成报告"}</button>
                {current && !editMode && chatHistory.some((m) => m.role === "user") && (
                  <>
                    <button type="button" onClick={appendChatToReport}>并入追问</button>
                    <button type="button" onClick={mergeReport} disabled={streaming || chatStreaming}>AI 融合</button>
                  </>
                )}
                {current && !editMode && <button type="button" onClick={() => { setEditText(current); setEditMode(true); }}>{store[activeTopic]?.reviewed ? "继续编辑" : "编辑审核"}</button>}
                {editMode && <button type="button" className="aiSave" onClick={saveReviewed}>{store[activeTopic]?.reviewed ? "保存审核稿" : "保存为审核稿"}</button>}
                {editMode && <button type="button" onClick={() => setEditMode(false)}>取消</button>}
                {current && !editMode && <button type="button" onClick={() => setShowHistory((v) => !v)}>历史版本</button>}
                {current && !editMode && <button type="button" className="aiCopy" onClick={() => navigator.clipboard?.writeText(current).catch(() => {})}>复制全文</button>}
              </>
            )}
          </div>
        </div>
        {!activeTopic ? (
          <div className="aiEmpty">
            <p>选择上方分析主题，平台将调用大模型基于平台数据生成分析报告。</p>
            <p>报告采用「结论先行、数据佐证」的结构，数据具体到区县对、镇街、产业门类、用地与 POI 中类；生成后自动质检，不合格会触发一次自动修订。</p>
          </div>
        ) : (
          <>
            {editMode ? (
              <textarea className="aiEditArea" value={editText} onChange={(e) => setEditText(e.target.value)} spellCheck={false} />
            ) : current ? (
              <div ref={reportRef} onMouseUp={handleReportMouseUp}>
                <Markdown text={current} marks={(accepted[activeTopic] ?? []).map((a) => ({ text: a.text, kind: a.kind }))} />
              </div>
            ) : (
              <div className="aiStreamingHint">正在调用 {providerMeta.label} 生成报告，首次生成约需 1–3 分钟…</div>
            )}
            {streaming && current && !editMode && <div className="aiCursor" aria-label="生成中" />}
            {repairNotice && <div className="aiRepairNotice">{repairNotice}</div>}
            {streamError && <div className="aiError">{streamError}</div>}
            {showHistory && history.length > 0 && (
              <div className="aiHistory">
                {[...history].reverse().map((v, i) => (
                  <div key={`${v.ts}-${i}`} className="aiHistoryItem">
                    <span>{new Date(v.ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · {v.source}</span>
                    <button type="button" onClick={() => { setEditText(v.content); setEditMode(true); setShowHistory(false); }}>载入编辑</button>
                    <button type="button" onClick={() => { setReports((prev) => ({ ...prev, [activeTopic!]: v.content })); setShowHistory(false); }}>查看</button>
                    <button type="button" className="aiHistoryDel" onClick={() => removeVersion(v.ts)}>删除</button>
                  </div>
                ))}
              </div>
            )}
            {activeTopic && (accepted[activeTopic] ?? []).length > 0 && (
              <div className="aiAccepted">
                <div className="aiAcceptedHead">
                  <b>已标记结论（{accepted[activeTopic].length} 条：认可将自动延续，错误将避免沿用）</b>
                </div>
                {(accepted[activeTopic] ?? []).map((a) => (
                  <div key={a.id} className="aiAcceptedItem">
                    <i className={`aiAcceptedKind ${a.kind}`}>{a.kind === "error" ? "错误" : "认可"}</i>
                    <span>{a.text}</span>
                    <button type="button" onClick={() => removeAccepted(a.id)}>删除</button>
                  </div>
                ))}
              </div>
            )}
            {reportCharts.length > 0 && (
              <div className="aiChartPicker">
                <div className="aiChartPickerHead">
                  <b>图表（{reportCharts.length}）· 勾选后导出 PNG</b>
                  <div>
                    <button type="button" onClick={() => setSelectedCharts(new Set(reportCharts.map((c) => c.key)))}>全选</button>
                    <button type="button" onClick={() => setSelectedCharts(new Set())}>清空</button>
                    <button type="button" className="aiExportSelected" onClick={exportSelectedCharts} disabled={!selectedCharts.size}>导出选中 PNG（{selectedCharts.size}）</button>
                  </div>
                </div>
                <div className="aiChartPickerGrid">
                  {reportCharts.map((c) => (
                    <div key={c.key} className={`aiChartPick${selectedCharts.has(c.key) ? " on" : ""}`} onClick={() => toggleChart(c.key)} role="checkbox" aria-checked={selectedCharts.has(c.key)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleChart(c.key); } }}>
                      <input type="checkbox" readOnly checked={selectedCharts.has(c.key)} tabIndex={-1} aria-hidden="true" />
                      {c.data.type === "odmap"
                        ? <OdMapCard data={c.data} exportable={false} svgRefCallback={(el) => { chartRefs.current[c.key] = el; }} />
                        : <AiChart data={c.data} exportable={false} svgRefCallback={(el) => { chartRefs.current[c.key] = el; }} />}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div ref={reportEndRef} />
          </>
        )}
      </div>

      {/* 追问对话 */}
      <div className="aiChat">
        <div className="aiPanelHead"><h3>追问</h3><small>{activeTopic ? `基于「${TOPICS.find((t) => t.id === activeTopic)?.title}」回答` : "基于平台数据自由提问"}</small></div>
        {reportConflict && <div className="aiConflictNotice">⚠️ 本次回答与背景报告存在差异，AI 已标注「与背景报告不一致」并给出依据；建议核对后更新审核稿或将该修正标记为认可结论。</div>}
        <div className="aiChatHistory" ref={chatRef} onMouseUp={handleReportMouseUp}>
          {chatHistory.length === 0 && <p className="aiChatEmpty">可对报告或平台数据继续提问，例如：“为什么海沧—龙海是厦漳方向第一核心？”“石井镇在哪些产业上最突出？”</p>}
          {chatHistory.map((m, i) => (
            <div key={i} className={`aiChatMessage ${m.role}`}>
              {m.role === "user" ? <b>问</b> : <b>答</b>}
              <div>{m.content ? <Markdown text={m.content} marks={(accepted[activeTopic ?? "chat"] ?? []).map((a) => ({ text: a.text, kind: a.kind }))} /> : chatStreaming && i === chatHistory.length - 1 ? <span className="aiCursor" /> : null}</div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="aiChatInputRow">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) sendChat(); }}
            placeholder="输入对都市圈发展状况的追问…"
            disabled={chatStreaming || streaming}
          />
          <button type="button" onClick={sendChat} disabled={chatStreaming || streaming || !chatInput.trim()}>
            {chatStreaming ? "生成中…" : "发送"}
          </button>
        </div>
        {chatError && <div className="aiError">{chatError}</div>}
      </div>
      {summaryError && <div className="aiError">{summaryError}</div>}
      {selBar && (
        <div className="aiSelBar" style={{ top: selBar.top, left: selBar.left }} role="toolbar" aria-label="标记选中内容">
          {existingMark ? (
            <>
              <span className={`aiSelMarked ${existingMark.kind}`}>已标记：{existingMark.kind === "error" ? "错误" : "认可"}</span>
              <button type="button" className="aiSelClear" onClick={clearMark} title="清除该标记，下次生成不再延续/规避">✕ 取消标记</button>
              <button type="button" className="aiSelClose" onClick={() => setSelBar(null)} aria-label="关闭">×</button>
            </>
          ) : (
            <>
              <span className="aiSelBarText">已选中 {selBar.text.length} 字</span>
              <button type="button" className="aiSelAccept" onClick={() => markSelection("accept")} title="下次生成自动延续该结论">✓ 标记认可</button>
              <button type="button" className="aiSelError" onClick={() => markSelection("error")} title="下次生成避免沿用该说法">✗ 标记错误</button>
              <button type="button" className="aiSelClose" onClick={() => setSelBar(null)} aria-label="关闭">×</button>
            </>
          )}
        </div>
      )}
      {showWordPicker && (pendingTopic ?? activeTopic) && (
        <div className="aiWordOverlay" onClick={() => { setShowWordPicker(false); setPendingTopic(null); }}>
          <div className="aiWordPicker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="预设报告字数">
            <div className="aiWordHead">
              <b>预设报告字数</b>
              <button type="button" onClick={() => { setShowWordPicker(false); setPendingTopic(null); }} aria-label="关闭">×</button>
            </div>
            <p className="aiWordHint">选择本份报告的目标篇幅，生成请求会携带字数要求（AI 对字数的把握存在一定偏差，约 ±30%）。</p>
            <div className="aiWordPresets">
              {WORD_PRESETS.map((p) => (
                <button
                  key={`${p.min}-${p.max}`}
                  type="button"
                  className={wordRange.min === p.min && wordRange.max === p.max ? "on" : ""}
                  onClick={() => saveWordRange(p)}
                >
                  {p.min}-{p.max} 字
                </button>
              ))}
            </div>
            <div className="aiWordCustom">
              <label>自定义（字）</label>
              <input
                type="number" min={200} step={100} value={wordRange.min}
                onChange={(e) => { const v = Number(e.target.value) || 200; saveWordRange({ min: v, max: Math.max(v, wordRange.max) }); }}
                aria-label="字数下限"
              />
              <span>—</span>
              <input
                type="number" min={wordRange.min} step={100} value={wordRange.max}
                onChange={(e) => { const v = Number(e.target.value) || wordRange.min; saveWordRange({ min: Math.min(v, wordRange.min), max: v }); }}
                aria-label="字数上限"
              />
            </div>
            <div className="aiWordActions">
              <button type="button" onClick={() => { setShowWordPicker(false); setPendingTopic(null); }}>取消</button>
              <button type="button" className="aiWordGo" onClick={() => { const target = pendingTopic ?? activeTopic; if (target) generateReport(target, wordRange); setShowWordPicker(false); setPendingTopic(null); }}>按此字数生成</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
