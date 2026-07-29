export type IndustryChain={id:string;name:string;codes:string[]};

// 来源：《厦漳泉都市圈_十二类产业链二级行业名单.xlsx》。
// 97个二级行业均唯一归入一类产业链，匹配代码采用行业代码前三位。
export const INDUSTRY_CHAINS:IndustryChain[]=[
  {id:"agriculture-food",name:"农业食品",codes:["A01","A02","A03","A04","A05","C13","C14","C15"]},
  {id:"textile-consumer",name:"纺织鞋服与消费品",codes:["C16","C17","C18","C19","C22","C23","C24","C41"]},
  {id:"petro-pharma-material",name:"石化医药与新材料",codes:["C25","C26","C27","C28","C29","C31","C32"]},
  {id:"building-home",name:"建材家居",codes:["C20","C21","C30","C33"]},
  {id:"equipment",name:"先进装备制造",codes:["C34","C35","C36","C37","C38","C43"]},
  {id:"digital",name:"电子信息与数字",codes:["C39","C40","I63","I64","I65"]},
  {id:"energy-eco",name:"能源资源与生态公用",codes:["B06","B07","B08","B09","B10","B11","B12","C42","D44","D45","D46","N76","N77","N78","N79"]},
  {id:"construction-realestate",name:"建筑与房地产",codes:["E47","E48","E49","E50","K70"]},
  {id:"commerce-logistics",name:"商贸物流",codes:["F51","F52","G53","G54","G55","G56","G57","G58","G59","G60"]},
  {id:"finance-business",name:"金融商务与租赁",codes:["J66","J67","J68","J69","L71","L72"]},
  {id:"science-edu-health",name:"科技教育医疗",codes:["M73","M74","M75","P83","Q84"]},
  {id:"life-tourism-social",name:"生活文旅与社会服务",codes:["H61","H62","O80","O81","O82","Q85","R86","R87","R88","R89","R90","S91","S92","S93","S94","S95","S96","T97"]}
];

export const CHAIN_BY_CODE=new Map(INDUSTRY_CHAINS.flatMap(chain=>chain.codes.map(code=>[code,chain] as const)));
export const ALL_CHAIN_CODES=new Set(INDUSTRY_CHAINS.flatMap(chain=>chain.codes));
export const INDUSTRY_CHAIN_CODE_COUNT=ALL_CHAIN_CODES.size;
