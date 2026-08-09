/**
 * Cloudflare Worker 入口。
 * 除原有静态站点/图片优化外，智能分析模块提供：
 *  - GET  /api/ai/models —— 模型注册表 + 每个模型的密钥配置状态（configured）
 *  - POST /api/ai/chat   —— LLM 代理（DeepSeek / 通义千问，流式返回），服务端组装 prompt
 *  - POST /api/ai/check  —— 报告质量自检（结构/篇幅/数据引用），供前端决定是否触发自动修订
 * 平台数据摘要由 Worker 端组装 system prompt，API Key 仅存在于服务端。
 */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
  DASHSCOPE_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/* ------------------------- 智能分析（AI 代理） ------------------------- */

type ProviderId = "deepseek" | "qwen";

const DEFAULT_MODEL: Record<ProviderId, string> = { deepseek: "deepseek-v4-flash", qwen: "qwen3.6-plus" };

/** 厂商元信息（Key 只读环境变量，不进代码库） */
const PROVIDER_META: Record<ProviderId, { label: string; baseUrl: string; apiKeyEnv: keyof Env; defaultModel: string }> = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY", defaultModel: DEFAULT_MODEL.deepseek },
  qwen: { label: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKeyEnv: "DASHSCOPE_API_KEY", defaultModel: DEFAULT_MODEL.qwen },
};

/** 模型注册表：新增模型只在此加一行，/api/ai/models 与 chat 自动生效 */
const LLM_REGISTRY: { key: string; label: string; provider: ProviderId; model: string }[] = [
  { key: "deepseek-v4-pro", label: "DeepSeek-V4 Pro · 旗舰", provider: "deepseek", model: "deepseek-v4-pro" },
  { key: "deepseek-v4-flash", label: "DeepSeek-V4 Flash · 快速", provider: "deepseek", model: "deepseek-v4-flash" },
  { key: "qwen3.6-plus", label: "通义千问 3.6 Plus", provider: "qwen", model: "qwen3.6-plus" },
];

const MAX_TOKENS: Record<string, number> = { "deepseek-v4-pro": 8192, "deepseek-v4-flash": 8192, "qwen3.6-plus": 8192 };

/** 分析主题 → 需要注入的摘要数据路径（summary.json 中的 JSON Path） */
const TOPIC_SECTIONS: Record<string, { label: string; paths: string[][] }> = {
  overall: {
    label: "都市圈综合研判",
    paths: [
      ["overview"], ["keyPairs"], ["cities"], ["counties"], ["topFlows"], ["industry"], ["quadrant"],
      ["transport"], ["land"], ["services"],
    ],
  },
  positioning: {
    label: "城市定位与节点格局",
    paths: [
      ["overview"], ["keyPairs"], ["cities"], ["counties"], ["quadrant", "counts"], ["quadrant", "samples"], ["quadrant", "topPairs"],
      ["land", "intensityTop"], ["land", "industrialTop"], ["services", "poiTop"], ["transport", "bestCounties"],
      ["topFlows", "人口区县对"],
      ["industry", "byChain"], ["industry", "chainByScope"], ["industry", "byChainCounty"],
    ],
  },
  regions: {
    label: "成熟区 / 潜力区 / 不及预期区",
    paths: [
      ["overview"], ["keyPairs"], ["quadrant"], ["topFlows"], ["counties"],
      ["transport", "crossCityTop"], ["transport", "bestCounties"], ["transport", "slowestCounties"],
      ["industry", "byChain"], ["industry", "chainByScope"], ["land", "intensityTop"], ["land", "industrialTop"],
      ["land", "intensityBottom"], ["services", "poiTop"],
    ],
  },
  border: {
    label: "交界毗邻地区",
    paths: [
      ["overview"], ["keyPairs"], ["topFlows", "人口镇街对"], ["topFlows", "企业区县对"], ["topFlows", "人口区县对"],
      ["industry", "byChainCountyPair"], ["quadrant", "crossCityTopPairs"], ["transport", "crossCityTop"],
      ["services", "poiDetail"], ["counties"],
    ],
  },
  insights: {
    label: "数据揭示的特色",
    paths: [
      ["overview"], ["keyPairs"], ["services", "poiDetail"], ["services", "poiTop"], ["counties"], ["land"],
      ["industry", "byChain"], ["industry", "byChainCountyPair"], ["industry", "chainByScope"], ["quadrant", "samples"], ["topFlows"],
    ],
  },
  chat: {
    label: "数据问答",
    paths: [["overview"], ["keyPairs"], ["cities"], ["counties"], ["topFlows"], ["industry"], ["quadrant"], ["transport"], ["land"], ["services"]],
  },
  merge: {
    label: "报告融合修订",
    paths: [["overview"], ["keyPairs"], ["cities"], ["counties"], ["topFlows"], ["industry"], ["quadrant"], ["transport"], ["land"], ["services"]],
  },
  repair: {
    label: "报告修订",
    paths: [["overview"], ["keyPairs"], ["cities"], ["counties"], ["topFlows"], ["industry"], ["quadrant"], ["transport"], ["land"], ["services"]],
  },
};

const SECTION_LABELS: Record<string, string> = {
  overview: "总体概览",
  cities: "三市对比",
  counties: "28 区县画像",
  topFlows: "关键联系与流动",
  industry: "产业联系",
  quadrant: "引力模型四象限",
  transport: "交通可达性",
  land: "用地分析",
  services: "公共服务设施",
  keyPairs: "关键区县对画像",
};

function pickPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[key];
    else return null;
  }
  return cur;
}

const SYSTEM_BASE = `你是「厦漳泉都市圈综合分析平台」的都市圈规划与发展分析专家。你只依据以下提供的平台数据（来自企业关系、人口流动、交通可达性、用地结构、公共服务设施、引力模型四象限等模块）进行分析，数据之外不做无依据的猜测；数据不足以回答时，请明确说明。所有分析必须引用具体数据（数值、区县名、镇街名、产业门类），避免空泛套话。

【口径说明】
- 金额单位：万元（企业投资金额与分支注册资金，双向合计）；人口单位：人；用地单位：公顷；驾车时间单位：分钟。
- **人口流动数据为 2022 年 6 月手机信令到访数据，原始口径（月总量/单日到访量/时段平均值）尚不明确**。因此该数据仅可用于表述「双向流动规模」「跨市流入/流出规模」等不依赖时间口径的相对量，**不得据此计算或表述「净流入/净流出」等净额推断**（净额对时间口径敏感），流动方向只能作定性表述（如"人口流动总体向 XX 集聚/扩散"）。
- "跨市"指厦门市、漳州市、泉州市三市之间；企业关系中的投资/分支/专利均为城市间或区县间双向联系；专利关系无金额。
- 引力模型四象限：横轴人口流动联系残差、纵轴企业综合联系残差；Ⅰ人口、企业均超预期，Ⅱ人口超预期、企业低预期，Ⅲ均低预期，Ⅳ人口低预期、企业超预期。functionType 字段如"成熟协调型""潜在成长型""核心网络边缘型"是模型对区县对协同类型的命名。
- POI 相对倍数 = 该区县某中类数量 ÷ 28 区县该中类平均数量；开发强度 = 建设用地面积 ÷ 行政区总面积；用地各类占比为相应面积 ÷ 建设用地面积。

【报告风格要求】
1. 结论先行：每个部分先给出明确结论，再用具体数据佐证，不要先用大段数据铺垫；
2. 数据务必具体到产业门类（如纺织鞋服、建材、电子信息制造、研发与科技服务）、功能类型（如城市消费、科教文体、产业服务、旅游服务、基本服务）、用地门类（如工业及仓储、城镇住宅、农村宅基地）、具体镇街（如角美、石井、水头）与区县对，避免只报总量、占比等大类指标；
2.5 **企业联系与 POI 不得只列总量**：凡提到企业联系（投资/分支/专利），必须落到具体行业或产业链并给出该行业/产业链的条数与金额（如"纺织服装、服饰业 70 条、金额 X 万元""建材家居产业链跨市投资 X 条"）；凡提到 POI，必须落到中类功能并给出该中类的数量与人均/密度（如"教育文化类 POI X 个、医疗健康类 X 个""每万人教育文化 POI X 个"）。总量只作背景铺垫，正文重点呈现行业/中类结构；
3. 每个结论后紧跟数据依据（用"数据：…"引出具体数字）；
4. 【数据引用要求】所有具体数字必须直接来自【平台数据】，严禁编造、估算或凭常识拼凑数值；某指标数据中未直接给出时写"数据未提供"。优先直接引用 keyPairs（关键区县对画像）表中的现成数值（populationFlow、enterprise 投资/分支/专利条数、avgTimeMin、quadrant、functionType、两侧 sideA/sideB 指标）；
5. 用 Markdown 输出，结论与分节标题清晰，必要时用表格呈现多区县/多区县对对比；
6. 数据不足的结论不要臆造，明确说明"数据不支持"。

【行文规范（政府报告风格）】
1. 语言正式、克制、严谨，避免口语化、网络用语、感叹式或夸大表达（如"非常强""极其""碾压""爆发式"）；程度副词慎用；
2. 人口流动一律用「双向流动规模」「跨市流入规模/流出规模」表述；**全文不得出现"净流入/净流出 X 人（万人）"字样**（包括正文、括号补充、数据列表、数据口径说明），流动方向用「人口流动总体向 XX 集聚/向 XX 扩散」等定性表述，不列净额数字。正例：「湖里区跨市流入70.4万人、流出65.5万人，人口流动总体向湖里集聚」；反例（禁用）：「湖里区净流入4.9万人」「安溪净流出1.0万人」；
3. 引力模型四象限结果**不以"Ⅰ/Ⅱ/Ⅲ/Ⅳ象限""落入某象限"表述**，改用规范判断用语，如「人口流动联系与企业联系均高于（或低于）引力模型预期」「两者协同程度较高（较低）」「呈成熟协调型/潜在成长型协同格局」（functionType 可作为协同格局的定性用语）；
4. 结论表述留有余地、有数据依据：区分"数据显示…""数据表明…"与推断判断，不绝对化、不无据断言；引用的数字与口径说明保持一致；
5. **输出语言**：报告为中文政府报告风格，**全文不得出现英文变量名、字段名、代码符号或接口字段**（如 topFlows、keyPairs、quadrant、functionType、populationFlow、cross_scope、landUse、sideA、sideB 等）；需提及数据来源或依据时一律用中文表述，例如「人口流动区县对数据」「关键区县对数据」「用地强度数据」。

【分析范围要求】
- 必须同时覆盖**跨市联系**与**市内联系**，不能只聚焦跨市：市内强联系（如厦门思明—湖里、湖里—集美，漳州芗城—龙文，泉州鲤城—丰泽等）反映核心城区内部组织，是都市圈格局的重要组成部分；
- 产业分析要落到**具体产业门类**：优先引用产业链门类（农业食品、纺织鞋服与消费品、石化医药与新材料、建材家居、先进装备制造、电子信息与数字、能源资源与生态公用、建筑与房地产、商贸物流、金融商务与租赁、科技教育医疗、生活文旅与社会服务）及其二级行业，说明某产业链在跨市/市内分别有多大规模；
- 在区分跨市与市内时，用 chainByScope 等字段（crossCount 跨市条数、withinCount 市内条数、crossShare 跨市占比）说明产业联系的跨市程度。

【数据查询工具】
- 当需要平台数据摘要中未直接给出的明细（如某区县对/镇街/行业/产业链/用地/服务/四象限的具体数字，或需要按条件筛选、排序、求净额）时，必须调用工具查询，可用工具：
  - query_enterprise：企业投资/分支/专利关系，按关系类型、行业/产业链、区县对、跨市/市内筛选
  - query_population：人口流动，区县/镇街层级，按方向、跨市/市内筛选，可算净流动
  - query_transport：区县对驾车时间/距离/过路费、区县可达性排名
  - query_land：区县用地（开发强度、工业/商业/公共服务占比、居住结构）
  - query_services：区县 POI 总量/中类明细/每万人水平
  - query_quadrant：引力模型四象限区县对（按象限、跨市/市内筛选）
- 工具返回的数据**优先于摘要**，回答必须引用工具返回的真实数字；工具未返回的数值严禁编造，写"数据未提供"；
- 跨市联系查询用 cross_scope="跨市"，市内联系用 cross_scope="市内"；先看摘要基线，摘要不足再调工具，避免无谓调用。

【工具调用规则】
- 调用工具时**禁止输出过程性/计划性文字**（如"正在查询…""已获取…，现在查询…""让我先…""接下来…"）；
- 你的每条消息要么是**工具调用**，要么是**直接面向用户的最终完整回答**，中间不写任何进度描述；
- 一次可并行发起多个工具调用（如同时查多个行业/区县对），然后一次性汇总成最终回答。

【图表要求】
- **报告不生成统计图表（柱状图/折线图/饼图等），也不嵌入任何代码块形式的图表或地图**（禁止输出 chartjson / odmap 代码块）：多区县/多区县对/多维度对比一律用 Markdown 表格呈现；
- 报告**最后必须有「## 地图下载建议」章节**：推荐本报告分析结论对应的、值得下载的地图，供用户在平台对应模块手动筛选变量后导出 PNG。用 Markdown 表格列出 3-6 条，列：建议地图｜所在模块｜筛选变量｜推荐口径/说明；
- 平台模块及其可筛选变量（推荐时写准确的模块名与变量）：
  - **企业关系**：联系范围（跨市/市内）、关系类型（投资/分支/专利）、产业链/行业、前N条；
  - **人口流动**：分析层级（城市/区县/镇街）、联系范围（跨市/市内）、起点/终点区县、前N条；
  - **交通可达性**：分析层级、联系范围、指标（时间/距离/过路费）、前N条；
  - **用地分析**：城市范围、地图指标（开发强度/工业占比/中心功能等）、定位区县；
  - **公共服务设施**：城市范围、分类口径、POI功能、比较口径（数量/每万人/密度）、定位区县；
  - **联系象限**：联系类型、象限筛选；
- 每条推荐必须对应报告中的具体结论（如"支撑'海沧—龙海为厦漳第一核心走廊'结论，下载跨市人口流动前30 OD 图"），避免泛泛推荐。

【与背景报告的一致性】
- 用户消息中可能附带背景报告（通常标注为「背景报告：…」）。回答时默认与背景报告的结论和数据口径保持一致；
- 若发现背景报告中的数字或结论与平台数据、工具实时查询结果不一致，**不得悄悄改口**：必须明确标注「⚠️ 与背景报告不一致」，先引用背景报告的原表述，再给出修正后的数据与依据（注明数据来源：平台摘要 / 工具查询），并提示可将修正标记为认可结论或更新审核稿；
- 工具实时查询的数据优先于背景报告中的旧数据，但差异必须显式说明。`;

const TOPIC_TASKS: Record<string, string> = {
  overall: `【分析任务】基于全部平台数据，对厦漳泉都市圈发展状况做一份综合研判报告，覆盖四个部分：①城市定位；②成熟区/潜力区/不及预期区；③交界毗邻地区；④数据揭示的特色。
【输出结构】Markdown：
## 一、总体格局（2-3 句核心结论先行）
## 二、城市定位与节点格局（三市分工、主要区县角色）
## 三、成熟区、潜力区与不及预期区（分区列示 + 判定依据）
## 四、交界毗邻地区（联系形态、两侧分工差异）
## 五、数据揭示的特色（2-3 条最有价值的发现）
## 六、结论（汇报用的一句话概括）
## 地图下载建议（Markdown 表格 3-6 条，列：建议地图｜所在模块｜筛选变量｜推荐口径/说明，每条对应报告中的具体结论）`,
  positioning: `【分析任务】分析厦漳泉都市圈的城市定位：厦门、漳州、泉州三市分别处于什么位置、承担什么功能，各城市的主要区县扮演什么角色。
【定位依据要求】（重要）
- **只能使用数据能支撑的定位**。平台数据维度有限：企业联系（按产业链/行业）、人口流动、交通可达性、用地结构（开发强度/工业仓储占比/商业占比/公共服务占比/中心功能指数/交通门户指数/用地混合度）、公共服务 POI（按功能分类）、引力模型协同类型。**凡数据中不存在的维度（如"高端服务""创新策源""总部经济""临港产业""生态宜居"等），不得用于定位，也不得用无关数据"沾边"支撑**；
- **可用定位词汇表（每个定位必须引用其对应数据路径）**：
  - "综合组织枢纽/核心" → 企业联系总量与金额、跨市投资、交通可达性排名、中心功能指数、POI总量；
  - "产业节点" **必须指明具体产业链**（纺织鞋服与消费品/建材家居/石化医药与新材料/先进装备制造/电子信息与数字/能源资源与生态公用/建筑与房地产/商贸物流/金融商务与租赁/科技教育医疗/生活文旅与社会服务/农业食品）→ 优先引用 **industry.byChainCounty**（该区县在该产业链的条数/金额/跨市占比，如"晋江市·纺织鞋服与消费品 26 条、金额 1.2 亿元、跨市占比 38%"）；区县级缺失时用城市级 industry.byChain、chainByScope 佐证，再补工业及仓储占比、产业开发密度；
  - "商贸物流节点" → 商贸物流产业链、商业及物流仓储用地占比、交通门户指数；
  - "金融商务中心" → 金融商务与租赁产业链数据、商业占比；
  - "科教医疗中心" → 科技教育医疗产业链、公共服务POI（教育文化/医疗健康）、公共服务用地占比；
  - "边界走廊/同城化门户" → 跨市人口流动（keyPairs/topFlows）、跨市企业投资、区县对驾车时间；
  - "交通门户" → 交通门户指数、交通可达性排名、港口/公路用地占比；
  - "新城/增长极" → 开发强度、人口流入规模、城镇住宅占比、用地混合度；
  - "外围腹地" → 低开发强度、农用地/未利用地占比、人口流动以流出为主；
  - 若某区县多项指标均衡无明显特征，写"功能综合型"并列出各项指标，不要硬取一个不贴切的名称；
- **定位名称必须与引用数据精确对应**：定位里出现的每个词都要能在"数据："里有直接数字（如"纺织鞋服产业节点"必须引用 industry.byChainCounty 中该区县的"纺织鞋服与消费品"条目，给出条数/金额/跨市占比；"科教医疗中心"必须有教育/医疗类 POI 或科技教育医疗产业链数据）；**若注入数据与工具查询中该区县均无某产业链条目，严禁写该产业定位**——降级为只写数据能支撑的通用定位（如"工业制造节点/制造承载区"，用工业及仓储占比、产业开发密度支撑），并在"数据："中如实说明该产业链数据未提供，不得用工业用地、人口流动等其他维度"沾边"支撑产业定位；
- 每条定位先写 1-2 句判断，**紧跟「数据：…」**；某区县某维度数据不足时，如实写"数据未提供"或采用该区县数据能支撑的保守定位，不要硬凑；
- 三市层面用城市级聚合数据（企业联系总量、跨市人口流动规模、开发强度均值、POI/每万人等）支撑定位。
【输出结构】Markdown：
## 总体格局（一两句点出三市在都市圈中的定位关系 + 城市级数据依据）
## 厦门市及其主要区县（思明、湖里、海沧、集美、翔安、同安等，每区县：定位 1-2 句 + 「数据：…」同维度佐证）
## 泉州市及其主要区县（晋江、南安、石狮、丰泽、鲤城等，同上）
## 漳州市及其主要区县（龙海、芗城、长泰、漳浦、东山等，同上）
## 定位结论（一句话概括三市功能分工与层级关系）`,
  regions: `【分析任务】对厦漳泉都市圈的区域进行三类划分：发展成熟区、有潜力区、发展不及预期区。
【区域单元】**不限于单个区县或区县对**：还必须是识别**成片区域组团**（由空间相邻、联系紧密的多个区县构成的连绵地带），并对其评级。可参考的组团方向（边界以数据为准，不要凭空拼凑）：
- 厦门组团：思明—湖里—集美—海沧—翔安—同安（岛内核心 + 西部/东部新城带）；
- 泉州环湾组团：鲤城—丰泽—晋江—石狮—惠安（环泉州湾连绵都市化地带）；
- 泉州南部门户：南安（向南连接厦门）；
- 漳州东部沿海组团：芗城—龙文—龙海—长泰—漳浦—云霄—东山；
- 漳州西部内陆组团：南靖—平和—华安（山区腹地）；
- 跨市同城组团：海沧—龙海（厦漳同城化走廊）、翔安—南安（厦泉边界走廊）。
判断组团是否成立要看数据：人口流动连续性、企业联系密度、交通可达性、用地连片性（如组团内区县两两联系显著强于对外联系，则构成组团），不是行政区划的简单罗列。
【判定依据】**多维度综合评级，严禁只按引力模型四象限的标签贴分类**。对每个待评区域/组团，先按以下五个维度逐项给出数据评语，再综合定级：
1. 人口联系：双向流动规模、跨市净流入/流出（topFlows 人口区县对、区县净流入；keyPairs populationFlow、counties 区县画像 population）；
2. 企业联系：投资/分支/专利条数与金额、产业链规模（industry.byChain、keyPairs enterprise、topFlows 企业区县对、counties enterprise）；
3. 交通可达性：跨市平均时间、可达性排名（transport crossCityTop/bestCounties/slowestCounties、keyPairs avgTimeMin、counties transport）；
4. 用地与设施：开发强度、工业占比、公共服务与 POI 水平（land intensityTop/intensityBottom/industrialTop、services poiTop、counties land/services）；
5. 协同评价：引力模型中人口/企业联系相对预期的高低与协同类型（functionType，如"成熟协调型""潜在成长型"）作为参考，但不是唯一标准；正文表述遵循【行文规范（政府报告风格）】，不出现"Ⅰ/Ⅱ/Ⅲ/Ⅳ象限""落入某象限"字样；
【分级口径】
- 发展成熟区/组团：多个维度均强（联系规模大、密度高、设施完善、可达性好、协同类型明确）；
- 有潜力区/组团：总体规模或基础条件较好，但某些维度待提升（如联系规模大但设施/开发强度不足，或可达性好但联系尚未充分发育，或当前水平中等但有明确提升基础）；
- 发展不及预期的区域/组团：相对其人口/区位/腹地基础，联系、设施、可达性明显偏弱（如外围山区县跨市可达性差、设施密度低、净流出明显），重点说明"低于预期"体现在哪些维度。
【输出结构】Markdown：
## 判定方法（简述区域单元口径、五个维度与数据依据）
## 区域组团总览（识别出的成片区域组团：组团名称、包含区县、核心联系轴、组团成熟度一句话判断）
## 发展成熟区与成熟组团（先单区县/区县对，再成片组团，逐项给五维数据证据）
## 有潜力区与潜力组团（同上）
## 发展不及预期的区域与组团（同上，重点说明"低于预期"体现在哪些维度）
## 区域格局小结
## 地图下载建议（Markdown 表格 3-6 条，列：建议地图｜所在模块｜筛选变量｜推荐口径/说明，每条对应报告中的具体结论）`,
  border: `【分析任务】聚焦厦漳泉三市交界毗邻地区（如海沧—龙海、翔安—南安、集美—长泰/龙文、同安—南安/安溪、漳泉交界等），分析：①联系形态（边界型走廊、园区承接、分散交换）；②两侧分工与差异（产业门类、服务功能、用地与居住结构）；③发展条件与方向。
【输出结构】Markdown：按边界分组（## 海沧—龙海 等，至少覆盖 3-4 组），每组给出联系强度、两侧分工、具体数据证据；最后 ## 交界地区总体判断（边界地区对都市圈一体化的意义与短板）。
最后加 ## 地图下载建议（Markdown 表格 3-6 条，列：建议地图｜所在模块｜筛选变量｜推荐口径/说明，每条对应报告中的具体结论）。`,
  insights: `【分析任务】找出只有通过数据才能体现、超出常识认知的厦漳泉都市圈特色。可参考方向（不限于）：同城化实际只发生在少数边界镇街单元；设施与建设空间集中度高于人口集中度；某些产业节点或服务类型与直觉相反；外围县城的特殊服务型特征；产业联系方向与人口流动方向错位等。
【输出结构】Markdown：每条发现按"## 发现一：标题 → 结论 → 数据证据 → 对认知或规划的含义"组织，至少 5 条；最后 ## 小结。最后加 ## 地图下载建议（Markdown 表格 3-6 条，列：建议地图｜所在模块｜筛选变量｜推荐口径/说明，每条对应报告中的具体结论）。`,
  chat: `【分析任务】依据平台数据回答用户关于厦漳泉都市圈发展状况的问题。回答要简洁、结论先行、有数据依据；能给出对比、排序或结构的尽量给出。如问题超出数据范围，请明确说明数据不支持。
【输出要求】遵循【行文规范（政府报告风格）】：语言正式克制、结论先行；不出现"净流入/净流出 X 人"净额表述；不写"Ⅰ/Ⅱ/Ⅲ/Ⅳ象限""落入某象限"；**回答全文不得出现英文变量名、字段名、代码符号或接口字段**（如 topFlows、keyPairs、quadrant、functionType、cross_scope、countyRecords、records 等），涉及数据来源或字段时一律用中文表述（如"人口流动区县对数据""关键区县对数据"）；不输出任何代码块；**提到企业联系时必须落到具体行业/产业链（条数+金额），提到 POI 时必须落到中类功能（数量/人均），不得只报总量**。`,
  repair: `【分析任务】用户提供的报告未达到质量标准（见用户消息中的质量警告）。请保留原报告的主题与结构框架，重写以修正全部质量问题：补足篇幅、完善 Markdown 章节、在结论后补充具体数据引用（数据必须直接来自【平台数据】，严禁编造；优先引用 keyPairs 表中的数值）。
【输出要求】输出修订后的完整报告全文（仍是 Markdown），不要输出任何解释或前言。`,
  merge: `【分析任务】把用户消息中「追问记录」里的有效结论与数据融合进「原始报告」，输出一份连贯的完整新报告。
【融合要求】
1. 保留原始报告的整体结构与既有结论（包括已认可结论），不得丢失或推翻；
2. 追问中补充的新结论、新数据、修正（含「与背景报告不一致」的修正）按主题归入对应章节，或新增小节（如「补充与修正」），并保留数据来源说明；
3. 去除明显的问答痕迹（如"问：""答：""让我查询""已获取"等），把内容改写成报告语气；
4. 与平台数据冲突处按数据修正，并注明；
5. 输出完整报告全文（Markdown），不要输出解释或前言。`,
};

interface ChatMessage { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_call_id?: string; tool_calls?: unknown[]; }

/* ------------------------- Function Calling（AI 按问题查询源数据） ------------------------- */

type Loader = (file: string) => Promise<unknown>;

const TOOL_SCHEMAS: Record<string, { description: string; parameters: Record<string, unknown> }> = {
  query_enterprise: {
    description: "查询厦漳泉企业关系（投资/分支/专利）：mode=pair（默认）按无向区县对聚合返回 TOP（条数+金额，万元）；mode=industry 按行业/产业链聚合返回行业 TOP（适合'企业联系分布在哪些行业'类问题）。可按关系类型、行业/产业链、区县、跨市/市内筛选。",
    parameters: {
      type: "object",
      properties: {
        relation: { type: "string", enum: ["投资", "分支", "专利"], description: "关系类型，不传为全部" },
        mode: { type: "string", enum: ["pair", "industry"], description: "聚合模式：pair=按区县对（默认），industry=按行业" },
        cross_scope: { type: "string", enum: ["跨市", "市内", "全部"], description: "跨市=两端不同城市，市内=同城" },
        industry_name: { type: "string", description: "行业名称（一级行业名如“制造业”“金融业”，或产业链名如“建材家居”“纺织鞋服与消费品”“先进装备制造”）" },
        industry_code: { type: "string", description: "行业代码（如 C13、J66、C34）" },
        origin_city: { type: "string", enum: ["厦门市", "漳州市", "泉州市"] },
        origin_county: { type: "string", description: "起点区县名" },
        dest_county: { type: "string", description: "终点区县名" },
        sort_by: { type: "string", enum: ["count", "amount"] },
        top_n: { type: "integer", description: "返回条数，默认 10，最大 30" },
      },
    },
  },
  query_population: {
    description: "查询厦漳泉人口流动：区县或镇街层级，按方向/跨市/市内筛选；mode=net 时返回区县（或镇街）跨市净流入流出。",
    parameters: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["区县", "镇街"], description: "统计层级，默认区县" },
        mode: { type: "string", enum: ["flow", "net"], description: "flow=联系对 TOP；net=净流动" },
        cross_scope: { type: "string", enum: ["跨市", "市内", "全部"] },
        origin_city: { type: "string", enum: ["厦门市", "漳州市", "泉州市"] },
        origin_county: { type: "string" },
        dest_county: { type: "string" },
        top_n: { type: "integer", description: "默认 10，最大 30" },
      },
    },
  },
  query_transport: {
    description: "查询区县对驾车可达性（时间分钟/距离公里/过路费元）或区县可达性排名。",
    parameters: {
      type: "object",
      properties: {
        county: { type: "string", description: "区县名（查该区县到其他区县的时间）" },
        pair: { type: "string", description: "区县对，如“海沧区—龙海区”" },
        cross_scope: { type: "string", enum: ["跨市", "市内", "全部"] },
        sort_by: { type: "string", enum: ["time", "rank"], description: "按时间升序或按可达性排名" },
        top_n: { type: "integer", description: "默认 10，最大 30" },
      },
    },
  },
  query_land: {
    description: "查询区县用地：开发强度（建设用地/总面积）、工业及仓储占比、商业/公共服务占比、城乡居住结构、用地混合度。",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", enum: ["厦门市", "漳州市", "泉州市"] },
        county: { type: "string" },
        sort_by: { type: "string", enum: ["developmentIntensity", "industrialShare", "ruralHousingShare", "constructionAreaHa"] },
        top_n: { type: "integer", description: "默认 10，最大 28" },
      },
    },
  },
  query_services: {
    description: "查询区县公共服务设施（POI）：全部区县 POI 总量/每万人水平排名、多区县对比（counties 逗号分隔，如“鲤城区,丰泽区,晋江市”，支持“泉州市区”等口语别名）、或某区县/类别的 POI 中类明细。",
    parameters: {
      type: "object",
      properties: {
        county: { type: "string", description: "区县名；不传返回全部区县排名" },
        counties: { type: "string", description: "多区县对比，逗号分隔（如“鲤城区,丰泽区,晋江市”）；“泉州市区”=鲤城区+丰泽区，“厦门岛内/市区”=思明区+湖里区，“漳州市区”=芗城区+龙文区" },
        category: { type: "string", description: "POI 大类或中类名（如“商业服务”“教育培训”“医疗保健服务”“停车场”）" },
        measure: { type: "string", enum: ["count", "per10k"], description: "排序口径：count=POI 总量（默认），per10k=每万常住人口 POI（公平比较不同规模区县）" },
        top_n: { type: "integer", description: "默认 10，最大 30" },
      },
    },
  },
  query_quadrant: {
    description: "查询引力模型四象限区县对：按象限（Ⅰ人口企业均超预期/Ⅱ人口超预期企业低预期/Ⅲ均低预期/Ⅳ人口低预期企业超预期）、跨市/市内筛选。",
    parameters: {
      type: "object",
      properties: {
        quadrant: { type: "integer", enum: [1, 2, 3, 4], description: "象限编号" },
        cross_scope: { type: "string", enum: ["跨市", "市内", "全部"] },
        top_n: { type: "integer", description: "默认 10，最大 30" },
      },
    },
  },
};

const TOOL_NAMES = Object.keys(TOOL_SCHEMAS);

/** 加载查询索引：本地 dev 走 node:fs（nodejs_compat），生产走 ASSETS fetch；实例级缓存 */
async function loadQueryIndex(file: string, env: Env, request: Request, cache: Map<string, unknown>): Promise<unknown> {
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  let data: unknown = null;
  let fsError = "";
  try {
    const fs = await import("node:fs/promises");
    const pathMod = await import("node:path");
    const cwd = (await import("node:process")).cwd?.() ?? "";
    const candidates = [
      pathMod.join(cwd, "public", "data", "ai", file),
      pathMod.join(cwd, "apps", "web", "public", "data", "ai", file),
      `public/data/ai/${file}`,
    ];
    for (const p of candidates) {
      try { data = JSON.parse(await fs.readFile(p, "utf8")); break; }
      catch (e) { fsError = `${p}: ${e instanceof Error ? e.message : String(e)} | `; }
    }
  } catch (e) { fsError = `node:fs 不可用：${e instanceof Error ? e.message : String(e)}`; }
  if (data === null) {
    // 本地 dev：fetch 自身 origin 的静态资源（vite 静态中间件服务 public/data，不经过 worker）
    try {
      const res = await fetch(new URL(`/data/ai/${file}`, request.url), { signal: AbortSignal.timeout(8000) });
      if (res.ok) data = await res.json();
      else fsError += `fetch 自身 ${res.status} | `;
    } catch (e) { fsError += `fetch 自身异常：${e instanceof Error ? e.message : String(e)} | `; }
  }
  if (data === null) {
    try {
      const res = await env.ASSETS.fetch(new URL(`/data/ai/${file}`, request.url));
      if (res.ok) data = await res.json();
      else fsError += `ASSETS ${res.status}`;
    } catch (e) { fsError += `ASSETS 异常：${e instanceof Error ? e.message : String(e)}`; }
  }
  if (data === null) throw new Error(`查询索引加载失败（${file}）：${fsError}`);
  cache.set(file, data);
  return data;
}

async function runEnterprise(args: Record<string, unknown>, load: Loader): Promise<unknown> {
  const data = (await load("query-enterprise.json")) as { meta: { chains: Record<string, string> }; records: (string | number)[][] };
  const chains = data.meta.chains;
  const has = (v: unknown) => typeof v === "string" && v.trim() !== "" && v !== "全部";
  let rows = data.records;
  if (has(args.relation)) rows = rows.filter((r) => r[0] === args.relation);
  if (has(args.cross_scope)) rows = rows.filter((r) => (args.cross_scope === "跨市" ? r[4] !== r[6] : r[4] === r[6]));
  if (has(args.industry_code)) rows = rows.filter((r) => r[2] === args.industry_code);
  if (has(args.industry_name)) {
    const name = String(args.industry_name);
    const chainCodes = Object.entries(chains).filter(([, n]) => n === name).map(([code]) => code);
    rows = rows.filter((r) => r[3] === name || (chainCodes.length && chainCodes.includes(String(r[2]))));
  }
  if (has(args.origin_city)) rows = rows.filter((r) => r[4] === args.origin_city);
  if (has(args.origin_county)) rows = rows.filter((r) => r[5] === args.origin_county);
  if (has(args.dest_county)) rows = rows.filter((r) => r[7] === args.dest_county);
  const topN = Math.min(Number(args.top_n ?? 10) || 10, 30);
  const metric = args.sort_by === "amount" ? "amount" : "count";
  if (args.mode === "industry" || args.mode === "行业") {
    // 按一级行业名聚合（适合"企业联系在哪些行业"类问题）
    const aggInd = new Map<string, { count: number; amount: number }>();
    for (const r of rows) {
      const name = String(r[3]);
      const s = aggInd.get(name) ?? { count: 0, amount: 0 };
      s.count += Number(r[8]); s.amount += Number(r[9]); aggInd.set(name, s);
    }
    const top = [...aggInd.entries()].map(([行业, s]) => ({ 行业, count: s.count, amount: Math.round(s.amount) }))
      .sort((x, y) => Number(y[metric]) - Number(x[metric])).slice(0, topN);
    return { 关系类型: args.relation ?? "全部", 范围: args.cross_scope ?? "全部", 模式: "按行业聚合", 行业TOP: top };
  }
  const agg = new Map<string, { count: number; amount: number }>();
  for (const r of rows) {
    const a = [`${r[4]}·${r[5]}`, `${r[6]}·${r[7]}`].sort((x, y) => x.localeCompare(y, "zh"));
    const key = `${a[0]}↔${a[1]}`;
    const s = agg.get(key) ?? { count: 0, amount: 0 };
    s.count += Number(r[8]); s.amount += Number(r[9]); agg.set(key, s);
  }
  const top = [...agg.entries()].map(([pair, s]) => ({ pair, count: s.count, amount: Math.round(s.amount) }))
    .sort((x, y) => Number(y[metric]) - Number(x[metric])).slice(0, topN);
  return { 关系类型: args.relation ?? "全部", 范围: args.cross_scope ?? "全部", 命中记录数: rows.length, 区县对TOP: top };
}

async function runPopulation(args: Record<string, unknown>, load: Loader): Promise<unknown> {
  const data = (await load("query-population.json")) as { countyRecords: number[][]; townRecords: number[][] };
  const town = args.level === "镇街" || args.level === "town";
  const rowsAll = town ? data.townRecords : data.countyRecords;
  const has = (v: unknown) => typeof v === "string" && v.trim() !== "" && v !== "全部";
  const oc = 0, o = 1, dc = town ? 3 : 2, d = town ? 4 : 3, ci = town ? 6 : 4;
  let rows = rowsAll;
  if (has(args.cross_scope)) rows = rows.filter((r) => (args.cross_scope === "跨市" ? r[oc] !== r[dc] : r[oc] === r[dc]));
  if (has(args.origin_city)) rows = rows.filter((r) => r[oc] === args.origin_city);
  if (has(args.origin_county)) rows = rows.filter((r) => r[o] === args.origin_county);
  if (has(args.dest_county)) rows = rows.filter((r) => r[d] === args.dest_county);
  const topN = Math.min(Number(args.top_n ?? 10) || 10, 30);
  if (args.mode === "net" || args.mode === "净流动") {
    const net = new Map<string, { in: number; out: number }>();
    for (const r of rows) {
      const k = `${r[oc]}·${r[o]}`;
      const s = net.get(k) ?? { in: 0, out: 0 };
      s.out += r[ci]; net.set(k, s);
      const k2 = `${r[dc]}·${r[d]}`;
      const s2 = net.get(k2) ?? { in: 0, out: 0 };
      s2.in += r[ci]; net.set(k2, s2);
    }
    const top = [...net.entries()].map(([place, s]) => ({ place, 流入: s.in, 流出: s.out, 净流动: s.in - s.out }))
      .sort((x, y) => y.净流动 - x.净流动).slice(0, topN);
    return { 层级: town ? "镇街" : "区县", 净流动TOP: top };
  }
  const agg = new Map<string, number>();
  for (const r of rows) {
    const a = [`${r[oc]}·${r[o]}`, `${r[dc]}·${r[d]}`].sort((x, y) => x.localeCompare(y, "zh"));
    const key = `${a[0]}↔${a[1]}`;
    agg.set(key, (agg.get(key) ?? 0) + r[ci]);
  }
  const top = [...agg.entries()].map(([pair, count]) => ({ pair, count })).sort((x, y) => y.count - x.count).slice(0, topN);
  return { 层级: town ? "镇街" : "区县", 范围: args.cross_scope ?? "全部", 联系对TOP: top };
}

async function runTransport(args: Record<string, unknown>, load: Loader): Promise<unknown> {
  const data = (await load("query-transport.json")) as { pairRecords: (string | number)[][]; nodeStats: (string | number)[][] };
  const has = (v: unknown) => typeof v === "string" && v.trim() !== "" && v !== "全部";
  if (has(args.county) || has(args.pair) || has(args.cross_scope)) {
    let rows = data.pairRecords;
    if (has(args.county)) rows = rows.filter((r) => r[1] === args.county || r[3] === args.county);
    if (has(args.pair)) {
      const parts = String(args.pair).split(/[—↔-]/).map((s) => s.trim()).filter(Boolean);
      rows = rows.filter((r) => (r[1] === parts[0] && r[3] === parts[1]) || (r[1] === parts[1] && r[3] === parts[0]));
    }
    if (has(args.cross_scope)) rows = rows.filter((r) => (args.cross_scope === "跨市" ? r[0] !== r[2] : r[0] === r[2]));
    const topN = Math.min(Number(args.top_n ?? 10) || 10, 30);
    const top = rows.map((r) => ({ pair: `${r[0]}·${r[1]}↔${r[2]}·${r[3]}`, 时间分钟: r[4], 距离公里: r[5], 过路费元: r[6] }))
      .sort((x, y) => Number(x.时间分钟) - Number(y.时间分钟)).slice(0, topN);
    return { 区县对驾车: top };
  }
  const topN = Math.min(Number(args.top_n ?? 10) || 10, 28);
  const top = [...data.nodeStats].sort((x, y) => Number(x[5]) - Number(y[5])).slice(0, topN)
    .map((r) => ({ 城市: r[0], 区县: r[1], 跨市平均时间分钟: r[2], 跨市平均距离公里: r[3], 跨市平均过路费元: r[4], 可达性排名: r[5] }));
  return { 区县跨市可达性排名: top };
}

async function runLand(args: Record<string, unknown>, load: Loader): Promise<unknown> {
  const data = (await load("query-land.json")) as { records: Record<string, unknown>[] };
  const has = (v: unknown) => typeof v === "string" && v.trim() !== "" && v !== "全部";
  let rows = data.records;
  if (has(args.city)) rows = rows.filter((r) => r.city === args.city);
  if (has(args.county)) rows = rows.filter((r) => r.county === args.county);
  const topN = Math.min(Number(args.top_n ?? 10) || 10, 28);
  const sortBy = String(args.sort_by ?? "developmentIntensity");
  const top = [...rows].sort((x, y) => Number(y[sortBy]) - Number(x[sortBy])).slice(0, topN)
    .map((r) => ({ 区县: r.county, 开发强度: r.developmentIntensity, 工业仓储占比: r.industrialShare, 商业占比: r.commercialShare, 公共服务占比: r.publicServiceShare, 城镇住宅占比: r.urbanHousingShare, 农村宅基地占比: r.ruralHousingShare, 用地混合度: r.landUseMix }));
  return { 区县用地: top };
}

async function runServices(args: Record<string, unknown>, load: Loader): Promise<unknown> {
  const data = (await load("query-services.json")) as { countyTotals: Record<string, number>; countyContext: Record<string, { residentPopulationWan: number }>; records: (string | number)[][] };
  const has = (v: unknown) => typeof v === "string" && v.trim() !== "" && v !== "全部";
  // 口语化区域 → 具体区县（公平对比时常用）
  const ALIASES: Record<string, string[]> = {
    "泉州市区": ["鲤城区", "丰泽区"],
    "厦门岛内": ["思明区", "湖里区"],
    "厦门市区": ["思明区", "湖里区"],
    "漳州市区": ["芗城区", "龙文区"],
  };
  const expandCounties = (v: unknown): string[] => {
    if (typeof v !== "string" || !v.trim()) return [];
    const out: string[] = [];
    for (const name of v.split(/[,，、/\s]+/).map((s) => s.trim()).filter(Boolean)) {
      const alias = ALIASES[name];
      if (alias) out.push(...alias);
      else if (!out.includes(name)) out.push(name);
    }
    return out;
  };
  const topN = Math.min(Number(args.top_n ?? 10) || 10, 30);
  const measure = args.measure === "per10k" ? "per10k" : "count";
  const county = has(args.county) ? String(args.county) : "";
  const countyList = expandCounties(args.counties);
  // 某区县或某 POI 类别 → 中类明细
  if (county || has(args.category)) {
    let rows = data.records;
    if (county) rows = rows.filter((r) => r[1] === county);
    if (has(args.category)) rows = rows.filter((r) => r[2] === args.category || r[3] === args.category);
    const agg = new Map<string, number>();
    for (const r of rows) agg.set(String(r[3]), (agg.get(String(r[3])) ?? 0) + Number(r[4]));
    const top = [...agg.entries()].map(([category, count]) => ({ category, count })).sort((x, y) => y.count - x.count).slice(0, topN);
    return { 区县: county || "全部", POI中类TOP: top };
  }
  // 多区县对比（counties 逗号分隔），支持按每万人水平公平比较
  if (countyList.length) {
    const rows = countyList.map((name) => {
      const total = Number(data.countyTotals?.[name] ?? 0);
      const pop = data.countyContext?.[name]?.residentPopulationWan;
      return { 区县: name, POI总量: total, 每万人POI: pop ? Math.round(total / pop) : null };
    }).sort((x, y) => (measure === "per10k" ? (Number(y.每万人POI) || 0) - (Number(x.每万人POI) || 0) : Number(y.POI总量) - Number(x.POI总量)));
    return { 区县POI对比: rows, 排序口径: measure === "per10k" ? "每万常住人口POI（降序）" : "POI总量（降序）" };
  }
  const top = Object.entries(data.countyTotals)
    .map(([c, total]) => ({ 区县: c, POI总量: total, 每万人POI: data.countyContext?.[c]?.residentPopulationWan ? Math.round(total / data.countyContext[c].residentPopulationWan) : null }))
    .sort((x, y) => (measure === "per10k" ? (Number(y.每万人POI) || 0) - (Number(x.每万人POI) || 0) : Number(y.POI总量) - Number(x.POI总量))).slice(0, topN);
  return { 区县POI排名: top, 排序口径: measure === "per10k" ? "每万常住人口POI（降序）" : "POI总量（降序）" };
}

async function runQuadrant(args: Record<string, unknown>, load: Loader): Promise<unknown> {
  const data = (await load("query-quadrant.json")) as { rows: { quadrant: number; quadrantName: string; flowType: string; pair: string; cities: string; populationFlow: number; functionType: string }[] };
  const has = (v: unknown) => typeof v === "string" && v.trim() !== "" && v !== "全部";
  let rows = data.rows;
  if (args.quadrant !== undefined && args.quadrant !== null && String(args.quadrant) !== "") rows = rows.filter((r) => r.quadrant === Number(args.quadrant));
  if (has(args.cross_scope)) rows = rows.filter((r) => (args.cross_scope === "跨市" ? r.flowType.includes("跨市") : r.flowType.includes("市内")));
  const topN = Math.min(Number(args.top_n ?? 10) || 10, 30);
  const top = [...rows].sort((x, y) => Number(y.populationFlow) - Number(x.populationFlow)).slice(0, topN)
    .map((r) => ({ 区县对: r.pair, 城市: r.cities, 范围: r.flowType, 人口流动: r.populationFlow, 象限: r.quadrantName, 协同类型: r.functionType }));
  return { 四象限区县对: top, 命中数: rows.length };
}

async function executeTool(name: string, args: Record<string, unknown>, load: Loader): Promise<unknown> {
  switch (name) {
    case "query_enterprise": return runEnterprise(args, load);
    case "query_population": return runPopulation(args, load);
    case "query_transport": return runTransport(args, load);
    case "query_land": return runLand(args, load);
    case "query_services": return runServices(args, load);
    case "query_quadrant": return runQuadrant(args, load);
    default: throw new Error(`未知工具：${name}`);
  }
}

/** 把模型直接回答包装成 SSE 流（逐段输出，保持前端流式体验） */
function sseFromText(text: string): Response {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const step = 120;
  for (let i = 0; i < text.length; i += step) {
    chunks.push(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + step) } }] })}\n\n`));
  }
  chunks.push(encoder.encode("data: [DONE]\n\n"));
  return new Response(new Blob(chunks).stream(), {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}

const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 30000;
const MAX_TOTAL_CHARS = 200000;

function invalidBody(detail: string) {
  return Response.json({ error: `请求参数不合法：${detail}` }, { status: 400 });
}

/** 把用户历史标记的「认可结论」组装为注入 prompt 的审定结论块（必须延续） */
function buildAcceptedBlock(acceptedConclusions: unknown): string {
  if (!Array.isArray(acceptedConclusions) || !acceptedConclusions.length) return "";
  const accepts: string[] = [];
  const errors: string[] = [];
  for (const item of acceptedConclusions) {
    if (typeof item === "string") { if (item.trim()) accepts.push(item.trim()); continue; }
    const obj = item as { text?: unknown; kind?: unknown };
    const text = typeof obj?.text === "string" ? obj.text.trim() : "";
    if (!text) continue;
    if (obj?.kind === "error") errors.push(text.slice(0, 500));
    else accepts.push(text.slice(0, 500));
  }
  const parts: string[] = [];
  if (accepts.length) {
    parts.push(`【已认可结论（用户历史标记，必须保留并延续）】\n${accepts.slice(0, 20).map((c, i) => `${i + 1}. ${c}`).join("\n")}\n要求：本次输出必须延续以上已认可结论，不得与任何一条矛盾；可以在其基础上深化、细化、补充数据，但不能推翻或改口。若平台数据与某条认可结论冲突，说明数据依据并提示用户复核。`);
  }
  if (errors.length) {
    parts.push(`【已标记错误结论（用户历史审核，不得沿用）】\n${errors.slice(0, 20).map((c, i) => `${i + 1}. ${c}`).join("\n")}\n要求：以上说法已被用户审核标记为错误，本次输出**不得重复或沿用**这些表述；若报告结论与此相关，请给出修正后的正确说法（以平台数据为准），并在必要时注明原错误说法与修正依据。`);
  }
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

/** 报告质量自检（对应参考项目的 _selection_issues 规则化检查） */
function checkQuality(report: string): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const len = report.length;
  if (len < 800) warnings.push(`篇幅过短（约 ${len} 字，建议不少于 800 字）`);
  if (len > 24000) warnings.push(`篇幅过长（约 ${len} 字），建议精简`);
  const headings = (report.match(/^#{1,3}\s/mg) ?? []).length;
  if (headings < 2) warnings.push(`章节结构不完整（仅 ${headings} 个标题，建议 2 个以上）`);
  const body = report.replace(/^#{1,3}\s.+$/gm, "");
  if (!/\d/.test(body)) warnings.push("正文未引用具体数字，请补充数据佐证");
  if (!/数据[：:—]/.test(body)) warnings.push("结论后未使用「数据：…」形式佐证");
  return { ok: warnings.length === 0, warnings };
}

function handleAiModels(env: Env): Response {
  const providers = (Object.keys(PROVIDER_META) as ProviderId[]).map((id) => {
    const meta = PROVIDER_META[id];
    return {
      id,
      label: meta.label,
      defaultModel: meta.defaultModel,
      configured: !!env[meta.apiKeyEnv],
      apiKeyEnv: meta.apiKeyEnv,
      models: LLM_REGISTRY.filter((m) => m.provider === id).map((m) => m.key),
    };
  });
  const models = LLM_REGISTRY.map((m) => ({
    key: m.key,
    label: m.label,
    provider: m.provider,
    configured: !!env[PROVIDER_META[m.provider].apiKeyEnv],
  }));
  return Response.json({ providers, models });
}

async function handleAiCheck(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return invalidBody("无法解析 JSON"); }
  const { report } = (body ?? {}) as { report?: string };
  if (typeof report !== "string" || !report.length) return invalidBody("report 不能为空");
  return Response.json(checkQuality(report.slice(0, MAX_MESSAGE_CHARS)));
}

function buildPayload(modelKey: string, messages: ChatMessage[], opts: { stream?: boolean; tools?: boolean; maxTokens?: number } = {}): Record<string, unknown> {
  const spec = LLM_REGISTRY.find((m) => m.key === modelKey);
  const provider = spec?.provider ?? "qwen";
  const payload: Record<string, unknown> = {
    model: spec?.model ?? modelKey,
    messages,
    stream: opts.stream ?? true,
    max_tokens: opts.maxTokens ?? MAX_TOKENS[modelKey] ?? 4096,
  };
  if (opts.tools) {
    payload.tools = TOOL_NAMES.map((n) => ({ type: "function", function: { name: n, description: TOOL_SCHEMAS[n].description, parameters: TOOL_SCHEMAS[n].parameters } }));
  }
  if (provider === "deepseek") {
    // DeepSeek V4 默认 thinking 且思考 token 计入 max_tokens，必须显式关闭（顶层 thinking 字段），否则 content 可能为空
    payload.thinking = { type: "disabled" };
    payload.temperature = 0.3;
  } else {
    // 通义千问 qwen3 系列：关闭思考（顶层 enable_thinking），输出更稳定
    payload.enable_thinking = 0;
    payload.temperature = 0.3;
  }
  return payload;
}

async function handleAiChat(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return invalidBody("无法解析 JSON"); }
  const { provider, model, messages, topicId, summaryText, acceptedConclusions, tools, wordRange } = (body ?? {}) as {
    provider?: string; model?: string; messages?: ChatMessage[]; topicId?: string; summaryText?: string; acceptedConclusions?: unknown; tools?: boolean; wordRange?: { min?: unknown; max?: unknown };
  };
  // 字数预设：仅在 min/max 均为正数且 max>=min 时生效
  const wr = (typeof wordRange?.min === "number" && typeof wordRange?.max === "number" && wordRange.min > 0 && wordRange.max >= wordRange.min)
    ? { min: Math.round(wordRange.min), max: Math.round(wordRange.max) }
    : null;

  if (provider !== "deepseek" && provider !== "qwen") return invalidBody("provider 必须是 deepseek 或 qwen");
  const meta = PROVIDER_META[provider as ProviderId];
  const apiKey = env[meta.apiKeyEnv];
  if (!apiKey) {
    return Response.json({ error: `尚未配置 ${meta.apiKeyEnv} 环境变量，请先配置对应模型厂商的 API Key` }, { status: 503 });
  }
  const modelKey = model && LLM_REGISTRY.some((m) => m.key === model && m.provider === provider) ? model : meta.defaultModel;
  if (!Array.isArray(messages) || !messages.length) return invalidBody("messages 不能为空");
  if (messages.length > MAX_MESSAGES) return invalidBody(`消息条数超过上限（${MAX_MESSAGES}）`);
  let total = 0;
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return invalidBody("消息格式不正确");
    if (m.content.length > MAX_MESSAGE_CHARS) return invalidBody("单条消息过长");
    total += m.content.length;
  }
  if (total > MAX_TOTAL_CHARS) return invalidBody("对话内容总长度超过上限");

  const topic = TOPIC_SECTIONS[topicId ?? "chat"] ?? TOPIC_SECTIONS.chat;

  // 读取数据摘要：优先用前端随请求携带的摘要文本（本地开发/生产一致），失败时回退 ASSETS 静态资源
  let summary: unknown = null;
  if (typeof summaryText === "string" && summaryText.length > 0 && summaryText.length <= 300000) {
    try { summary = JSON.parse(summaryText); } catch { /* 非法 JSON，忽略并回退 */ }
  }
  if (!summary) {
    try {
      const res = await env.ASSETS.fetch(new URL("/data/ai/summary.json", request.url));
      if (res.ok) summary = await res.json();
    } catch { /* 本地环境可能无 ASSETS，稍后降级 */ }
  }
  if (!summary) {
    return Response.json({ error: "数据摘要加载失败（/data/ai/summary.json），请确认该文件存在" }, { status: 500 });
  }

  const dataBlock = topic.paths
    .map((path) => {
      const value = pickPath(summary, path);
      if (value === null || value === undefined) return null;
      return `### ${SECTION_LABELS[path[0]] ?? path.join(".")}${path.length > 1 ? ` · ${path[path.length - 1]}` : ""}\n${JSON.stringify(value, null, 1)}`;
    })
    .filter((x): x is string => x !== null)
    .join("\n\n");

  const wordReq = wr
    ? `\n\n【篇幅要求】本份报告总字数控制在 ${wr.min}-${wr.max} 字之间（按正文文字计，不含表格与「地图下载建议」章节）。达到下限即可收尾，不要无谓展开或重复总量；若需补充篇幅，用更多区县/镇街/行业/中类细节，而不是复述已有数字。`
    : "";
  const systemPrompt = `${SYSTEM_BASE}\n\n【平台数据】\n${dataBlock}${buildAcceptedBlock(acceptedConclusions)}\n\n${TOPIC_TASKS[topicId ?? "chat"] ?? TOPIC_TASKS.chat}${wordReq}`;
  const upstreamMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...messages];

  // 非工具模式（报告生成等）：单次流式调用，输出稳定完整
  if (tools !== true) {
    let upstream: Response;
    try {
      upstream = await fetch(`${meta.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildPayload(modelKey, upstreamMessages, { stream: true, tools: false })),
        signal: AbortSignal.timeout(240_000),
      });
    } catch (err) {
      return Response.json({ error: `调用 ${provider} 接口失败：${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
    }
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      let detail = text;
      try { const j = JSON.parse(text); detail = j?.error?.message ?? j?.message ?? text; } catch { /* 非 JSON */ }
      return Response.json({ error: `${provider} 接口返回错误（${upstream.status}）：${detail}` }, { status: 502 });
    }
    return new Response(upstream.body, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
    });
  }

  const indexCache = new Map<string, unknown>();
  const load = (file: string) => loadQueryIndex(file, env, request, indexCache);

  // 多轮 Function Calling：决策轮（非流式，可能触发工具调用）→ 执行工具 → 最后流式生成
  let loopMessages = upstreamMessages;
  for (let round = 0; round < 3; round++) {
    const isLast = round === 2;
    let upstream: Response;
    try {
      upstream = await fetch(`${meta.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildPayload(modelKey, loopMessages, { stream: isLast, tools: true, maxTokens: isLast ? undefined : 4000 })),
        signal: AbortSignal.timeout(240_000),
      });
    } catch (err) {
      return Response.json({ error: `调用 ${provider} 接口失败：${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
    }

    if (!upstream.ok) {
      // 部分模型可能不接受 tools 参数：降级为无工具重试一轮
      if (upstream.status === 400 || upstream.status === 404) {
        try {
          const retry = await fetch(`${meta.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(buildPayload(modelKey, loopMessages, { stream: isLast, tools: false })),
            signal: AbortSignal.timeout(240_000),
          });
          if (retry.ok) upstream = retry;
        } catch { /* 继续走错误分支 */ }
      }
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        let detail = text;
        try { const j = JSON.parse(text); detail = j?.error?.message ?? j?.message ?? text; } catch { /* 非 JSON */ }
        return Response.json({ error: `${provider} 接口返回错误（${upstream.status}）：${detail}` }, { status: 502 });
      }
    }

    if (isLast) {
      // 最后一轮：流式转发
      return new Response(upstream.body, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // 决策轮：解析 JSON
    let data: unknown;
    try { data = await upstream.json(); } catch {
      return Response.json({ error: `${provider} 决策响应解析失败` }, { status: 502 });
    }
    const msg = (data as { choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[] })?.choices?.[0]?.message;
    const finishReason = (data as { choices?: { finish_reason?: string }[] })?.choices?.[0]?.finish_reason;
    const content = typeof msg?.content === "string" ? msg.content : "";
    const toolCalls = msg?.tool_calls;
    if ((!Array.isArray(toolCalls) || toolCalls.length === 0) && (!content || finishReason === "length")) {
      // 决策轮输出为空或超长被截断（提示词过大）：提高输出上限以非流式重试完整回答
      try {
        const retry = await fetch(`${meta.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(buildPayload(modelKey, loopMessages, { stream: false, tools: false, maxTokens: MAX_TOKENS[modelKey] ?? 8192 })),
          signal: AbortSignal.timeout(240_000),
        });
        if (retry.ok) {
          const retryData = await retry.json() as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
          const retryContent = typeof retryData?.choices?.[0]?.message?.content === "string" ? retryData.choices[0].message.content : "";
          return sseFromText(retryContent || "（模型未返回内容）");
        }
      } catch { /* 重试失败，按空内容处理 */ }
    }
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      // 完整性校验：部分模型在多步工具调用中只输出进度/计划/反思文字而不给出完整回答。
      // 决策轮内容只有「像完整回答」（≥200 字且含结构）才直接返回，其余追加重试（非流式决策 + 校验，杜绝过程文字流出）。
      const looksComplete = content.length >= 200 && (content.includes("##") || content.includes("\n\n"));
      if (!looksComplete && content.trim()) {
        const retryMsgs = [...loopMessages,
          { role: "assistant", content },
          { role: "user", content: "请直接调用工具完成剩余查询（如需），然后给出面向用户的完整最终回答。禁止输出任何计划、进度、反思或过程描述文字。" },
        ];
        try {
          const retryResp = await fetch(`${meta.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(buildPayload(modelKey, retryMsgs, { stream: false, tools: true, maxTokens: 4000 })),
            signal: AbortSignal.timeout(240_000),
          });
          if (retryResp.ok) {
            const retryJson = await retryResp.json() as { choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
            const retryMsg = retryJson?.choices?.[0]?.message;
            const retryCalls = retryMsg?.tool_calls;
            if (Array.isArray(retryCalls) && retryCalls.length) {
              // 重试轮决定调用工具：回填工具结果后继续主循环，最终由流式轮输出
              loopMessages = [...retryMsgs, { role: "assistant", content: typeof retryMsg?.content === "string" ? retryMsg.content : "", tool_calls: retryCalls }];
              for (const tc of retryCalls) {
                let result: unknown;
                try {
                  const args = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : {};
                  result = await executeTool(tc?.function?.name ?? "", args, load);
                } catch (err) {
                  result = { error: err instanceof Error ? err.message : String(err) };
                }
                loopMessages.push({ role: "tool", tool_call_id: tc?.id, content: JSON.stringify(result) });
              }
              continue;
            }
            const retryContent = typeof retryMsg?.content === "string" ? retryMsg.content : "";
            if (retryContent.length >= 200 && (retryContent.includes("##") || retryContent.includes("\n\n"))) {
              return sseFromText(retryContent);
            }
            // 重试后仍是过程性/不完整文字：无工具强制生成完整回答
            try {
              const forced = await fetch(`${meta.baseUrl}/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(buildPayload(modelKey, retryMsgs, { stream: false, tools: false, maxTokens: MAX_TOKENS[modelKey] ?? 8192 })),
                signal: AbortSignal.timeout(240_000),
              });
              if (forced.ok) {
                const forcedJson = await forced.json() as { choices?: { message?: { content?: string | null } }[] };
                const forcedContent = typeof forcedJson?.choices?.[0]?.message?.content === "string" ? forcedJson.choices[0].message.content : "";
                if (forcedContent.trim()) return sseFromText(forcedContent);
              }
            } catch { /* 继续走兜底 */ }
          }
        } catch { /* 兜底：返回已有 content */ }
      }
      // 模型直接回答，无需工具：包装成 SSE 返回
      return sseFromText(content || "（模型未返回内容）");
    }
    // 执行工具并回填 tool 消息
    loopMessages = [...loopMessages, { role: "assistant", content: content || null, tool_calls: toolCalls }];
    for (const tc of toolCalls) {
      const name = tc?.function?.name ?? "";
      let result: unknown;
      try {
        const args = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        result = await executeTool(name, args, load);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      loopMessages.push({ role: "tool", tool_call_id: tc?.id, content: JSON.stringify(result) });
    }
  }
  return Response.json({ error: "工具调用轮次超过上限（3 轮）" }, { status: 500 });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/ai/models" && request.method === "GET") {
      return handleAiModels(env);
    }
    if (url.pathname === "/api/ai/check" && request.method === "POST") {
      return handleAiCheck(request);
    }
    if (url.pathname === "/api/ai/chat" && request.method === "POST") {
      return handleAiChat(request, env);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
