"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PopulationModule from "./population";
import QuadrantModule from "./quadrants";
import TransportAccessibilityModule from "../transport-accessibility/transport-accessibility";
import { exportMapPng, numericLegend } from "./map-export";
import { ALL_CHAIN_CODES, CHAIN_BY_CODE, INDUSTRY_CHAINS, INDUSTRY_CHAIN_CODE_COUNT } from "./industry-chains";
import LocationTreePicker, { buildLocationTree } from "./location-tree";

type Rec=[string,number,string,string,string,string,string,string,number,number,number,number,number,number,number,number];
type TownRec=[string,number,string,string,string,string,string,string,string,string,number,number,number,number,number,number,number,number];
type Payload={meta:{baseline:string;amountUnit:string;sources:string[];patentUndirected?:boolean;patentDedupKey?:string;patentIndustryFilter?:string;patentDiagnostics?:Record<string,number>};industries:Record<string,[string,string][]>;centers:Record<string,[number,number]>;boundaries:{features:any[]};records:Rec[]};
type TownPayload={meta:{amountUnit:string;onlyCompleteTownOd:boolean;patentUndirected:boolean;fields:string[]};records:TownRec[]};
type TownIndex={meta:{pairCount:number;recordCount:number};pairs:Record<string,string>};
type TownBoundaryPayload={type:"FeatureCollection";features:{properties:{city:string;county:string;town:string;center:[number,number]};geometry:{type:"MultiPolygon";coordinates:any[]}}[]};
type Flow={key:string;oc:string;o:string;ot?:string;dc:string;d:string;dt?:string;count:number;amount:number;amountCount:number;patents:number;pairs:number;maxPair:number;share:number;unmatched:number};
type TownFlow={key:string;oc:string;o:string;ot:string;dc:string;d:string;dt:string;count:number;amount:number;amountCount:number;patents:number;pairs:number;maxPair:number;share:number;unmatched:number};
type DevEntry={time:string;type:"feature"|"data"|"server";title:string;detail:string};
type DevLog={updatedAt:string;entries:DevEntry[]};
type IndustryShare={code:string;name:string;value:number;share:number;color:string};
type IndustryComposition={level:number;items:IndustryShare[];total:number;title?:string;context?:string};
type IndustryMode="逐级行业"|"产业链归纳";

const fmt=(n:number,d=0)=>new Intl.NumberFormat("zh-CN",{maximumFractionDigits:d}).format(n);
const fmtTime=(value:string)=>new Date(value).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
const scale=["#b8d8d0","#79b7aa","#f0c66e","#e88a4d","#b93b35"];
const quantileBreaks=(values:number[])=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return [];return [.2,.4,.6,.8].map(q=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))])};
const strengthBand=(value:number,breaks:number[])=>{if(!breaks.length||breaks.every(x=>x===breaks[0]))return 2;if(value<=breaks[0])return 0;if(value<=breaks[1])return 1;if(value<=breaks[2])return 2;if(value<=breaks[3])return 3;return 4};
const normalizeTown=(value:string)=>value.replace(/^省/,"").replace(/(街道办事处|街道|镇|民族乡|乡)$/u,"");
const townCenter=(centers:Record<string,[number,number]>,city:string,county:string,town:string)=>centers[`${city}|${county}|${town}`]||centers[`${city}|${county}|~${normalizeTown(town)}`];
type IndustrySelection={level:number;code:string;name:string;path:string};
const concentrationLabel=(share:number)=>share>=.95?"企业个案型联系":share>.6?"高度集中":share>=.3?"龙头企业带动":"关系相对分散";
const industryColor=(code:string)=>{
  let hash=0;for(const char of code)hash=(hash*31+char.charCodeAt(0))>>>0;
  return `hsl(${(hash*47+154)%360} 48% ${46+(hash%3)*6}%)`;
};

function IndustryDonut({composition,metric,relation,parent}:{composition:IndustryComposition|null;metric:"count"|"amount";relation:string;parent:string}){
  if(!composition)return null;
  if(!composition.level)return <section className="industryDonutCard empty"><div><h4>下一级行业构成</h4><p>当前三级行业已是网站行业目录的最细层级。</p></div></section>;
  const levelName=["","一级","二级","三级"][composition.level],unit=metric==="amount"?"万元":"条";
  const title=composition.title||`${levelName}行业占比`;
  if(!composition.items.length)return <section className="industryDonutCard empty"><div><h4>{title}</h4><p>当前关系在所选产业口径中没有可汇总记录。</p></div></section>;
  const edges=composition.items.reduce<number[]>((values,item)=>[...values,values[values.length-1]+item.share*100],[0]);
  const gradient=composition.items.map((item,index)=>`${item.color} ${edges[index]}% ${edges[index+1]}%`).join(",");
  return <section className="industryDonutCard">
    <div className="industryDonutHead"><h4>{title}</h4><p>{composition.context||parent} · {relation==="专利"?"按行业关联次数":"双向关系合计"} · {metric==="amount"?"按金额":"按关系数量"}</p></div>
    <div className="industryDonutBody">
      <div className="industryDonut" style={{background:`conic-gradient(${gradient})`}} role="img" aria-label={`${title}环形图，共${composition.items.length}类`}><span><strong>{fmt(composition.total,metric==="amount"?1:0)}</strong><small>{unit}</small></span></div>
      <div className="industryDonutLegend">{composition.items.map(item=><div key={item.code}><i style={{background:item.color}}/><span><strong>{item.code==="UNCLASSIFIED"?"未分类":`${item.code} · ${item.name}`}</strong><small>{fmt(item.value,metric==="amount"?1:0)}{unit} · {fmt(item.share*100,1)}%</small></span></div>)}</div>
    </div>
  </section>;
}

export default function Home(){
  const [module,setModule]=useState<"企业关系"|"人口流动"|"交通可达性"|"联系象限">("企业关系");
  const [data,setData]=useState<Payload|null>(null);
  const [devLog,setDevLog]=useState<DevLog|null>(null);
  const [analysisLevel,setAnalysisLevel]=useState<"区县"|"镇街">("区县");
  const [relation,setRelation]=useState("投资");
  const [scope,setScope]=useState<"全部"|"跨市"|"市内">("全部");
  const [originLocation,setOriginLocation]=useState("ALL");
  const [destinationLocation,setDestinationLocation]=useState("ALL");
  const [industryMode,setIndustryMode]=useState<IndustryMode>("逐级行业");
  const [chainId,setChainId]=useState("ALL");
  const [industry,setIndustry]=useState<IndustrySelection>({level:1,code:"ALL",name:"全部行业",path:"全部行业"});
  const [metric,setMetric]=useState<"count"|"amount">("count");
  const [limit,setLimit]=useState(30);
  const [selected,setSelected]=useState<Flow|null>(null);
  const [townData,setTownData]=useState<TownPayload|null>(null);
  const [allTownData,setAllTownData]=useState<TownPayload|null>(null);
  const [directTownLoading,setDirectTownLoading]=useState(false);
  const [directTownError,setDirectTownError]=useState("");
  const [townIndex,setTownIndex]=useState<TownIndex|null>(null);
  const [townBoundaries,setTownBoundaries]=useState<TownBoundaryPayload|null>(null);
  const [townDataKey,setTownDataKey]=useState("");
  const [townOpen,setTownOpen]=useState(false);
  const [townLoading,setTownLoading]=useState(false);
  const [townError,setTownError]=useState("");
  const [townMetric,setTownMetric]=useState<"count"|"amount">("count");
  const [view,setView]=useState({x:0,y:0,k:1});
  const mapRef=useRef<SVGSVGElement|null>(null);
  const townMapRef=useRef<SVGSVGElement|null>(null);
  const drag=useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
  useEffect(()=>{fetch("/data/dashboard.json").then(r=>r.json()).then(setData)},[]);
  useEffect(()=>{
    let active=true;
    const load=()=>fetch(`/data/dev-log.json?t=${Date.now()}`,{cache:"no-store"}).then(r=>r.json()).then(x=>{if(active)setDevLog(x)}).catch(()=>{});
    load();const timer=window.setInterval(load,3000);
    return()=>{active=false;window.clearInterval(timer)};
  },[]);
  useEffect(()=>{setIndustry(relation==="专利"?{level:0,code:"ALL",name:"全部行业",path:"全部行业"}:{level:1,code:"ALL",name:"全部行业",path:"全部行业"});setSelected(null);if(relation==="专利")setMetric("count")},[relation]);
  useEffect(()=>setSelected(null),[scope]);
  useEffect(()=>setTownOpen(false),[selected?.key,relation,industry.level,industry.code,industryMode,chainId,scope]);
  const changeAnalysisLevel=async(level:"区县"|"镇街")=>{
    setAnalysisLevel(level);setOriginLocation("ALL");setDestinationLocation("ALL");setSelected(null);setTownOpen(false);setView({x:0,y:0,k:1});setDirectTownError("");
    if(level!=="镇街"||allTownData)return;
    setDirectTownLoading(true);
    try{
      const [relations,boundaries]=await Promise.all([
        fetch("/data/township-relations.json").then(response=>{if(!response.ok)throw new Error(String(response.status));return response.json() as Promise<TownPayload>}),
        townBoundaries?Promise.resolve(townBoundaries):fetch("/data/township-boundaries.json").then(response=>{if(!response.ok)throw new Error(String(response.status));return response.json() as Promise<TownBoundaryPayload>})
      ]);
      setAllTownData(relations);if(!townBoundaries)setTownBoundaries(boundaries);
    }catch{setDirectTownError("全量镇街关系读取失败，请重新生成企业关系数据。")}
    finally{setDirectTownLoading(false)}
  };
  const industryTree=useMemo(()=>{
    if(!data)return [];
    const source=data.industries;
    return source["1"].map(([c1,n1])=>({code:c1,name:n1,children:source["2"].filter(([c])=>c.startsWith(c1)).map(([c2,n2])=>({code:c2,name:n2,children:source["3"].filter(([c])=>c.startsWith(c2)).map(([c3,n3])=>({code:c3,name:n3}))}))}));
  },[data]);
  const locationTree=useMemo(()=>data?buildLocationTree([
    ...data.boundaries.features.map(feature=>({city:feature.properties.city,county:feature.properties.name})),
    ...(allTownData?.records||[]).flatMap(record=>[
      {city:record[4],county:record[5],town:record[6]},
      {city:record[7],county:record[8],town:record[9]}
    ])
  ]):[],[data,allTownData]);
  const selectedChain=useMemo(()=>INDUSTRY_CHAINS.find(chain=>chain.id===chainId),[chainId]);
  const activeChainCodes=useMemo(()=>selectedChain?new Set(selectedChain.codes):ALL_CHAIN_CODES,[selectedChain]);
  const activeIndustryName=industryMode==="产业链归纳"?(selectedChain?.name||"全部产业链"):industry.name;
  const activeIndustryPath=industryMode==="产业链归纳"?(selectedChain?`${selectedChain.name} / ${selectedChain.codes.length}个二级行业`:`${INDUSTRY_CHAINS.length}条产业链 / ${INDUSTRY_CHAIN_CODE_COUNT}个二级行业`):industry.path;
  const matchesIndustry=useCallback((level:number,code:string)=>industryMode==="产业链归纳"?(level===2&&activeChainCodes.has(code)):(level===industry.level&&(industry.code==="ALL"||code===industry.code)),[industryMode,activeChainCodes,industry.level,industry.code]);
  const flows=useMemo(()=>{
    if(!data)return [];
    const m=new Map<string,Flow>();
    if(analysisLevel==="区县")for(const r of data.records){
      if(r[0]!==relation||!matchesIndustry(r[1],r[2]))continue;
      if((scope==="跨市"&&r[4]===r[6])||(scope==="市内"&&r[4]!==r[6]))continue;
      if(originLocation!=="ALL"&&`${r[4]}|${r[5]}`!==originLocation)continue;
      if(destinationLocation!=="ALL"&&`${r[6]}|${r[7]}`!==destinationLocation)continue;
      const key=`${r[4]}${r[5]}${relation==="专利"?"—":"→"}${r[6]}${r[7]}`;
      const x=m.get(key)||{key,oc:r[4],o:r[5],dc:r[6],d:r[7],count:0,amount:0,amountCount:0,patents:0,pairs:0,maxPair:0,share:0,unmatched:0};
      x.count+=r[8];x.amount+=r[9];x.amountCount+=r[10];x.patents+=r[11]||0;x.pairs+=r[12]||0;x.maxPair=Math.max(x.maxPair,r[13]||0);x.share=Math.max(x.share,r[14]||0);x.unmatched+=r[15]||0;m.set(key,x);
    }else for(const r of allTownData?.records||[]){
      if(r[0]!==relation||!matchesIndustry(r[1],r[2]))continue;
      if((scope==="跨市"&&r[4]===r[7])||(scope==="市内"&&r[4]!==r[7]))continue;
      if(r[4]===r[7]&&r[5]===r[8]&&r[6]===r[9])continue;
      if(originLocation!=="ALL"&&`${r[4]}|${r[5]}|${r[6]}`!==originLocation)continue;
      if(destinationLocation!=="ALL"&&`${r[7]}|${r[8]}|${r[9]}`!==destinationLocation)continue;
      const key=`${r[4]}${r[5]}${r[6]}${relation==="专利"?"—":"→"}${r[7]}${r[8]}${r[9]}`;
      const x=m.get(key)||{key,oc:r[4],o:r[5],ot:r[6],dc:r[7],d:r[8],dt:r[9],count:0,amount:0,amountCount:0,patents:0,pairs:0,maxPair:0,share:0,unmatched:0};
      x.count+=r[10];x.amount+=r[11];x.amountCount+=r[12];x.patents+=r[13]||0;x.pairs+=r[14]||0;x.maxPair=Math.max(x.maxPair,r[15]||0);x.share=Math.max(x.share,r[16]||0);x.unmatched+=r[17]||0;m.set(key,x);
    }
    return [...m.values()].sort((a,b)=>(metric==="count"?b.count-a.count:b.amount-a.amount));
  },[data,allTownData,analysisLevel,relation,metric,scope,originLocation,destinationLocation,matchesIndustry]);
  const shown=limit===0?flows:flows.slice(0,limit);
  const renderFlows=[...shown].reverse();
  const currentBreaks=quantileBreaks(shown.map(x=>metric==="count"?x.count:x.amount));
  const metricUnit=metric==="count"?"条":"万元";
  const currentLegend=numericLegend(scale,currentBreaks,shown.map(x=>metric==="count"?x.count:x.amount),metricUnit,metric==="amount"?1:0);
  const strength=(value:number)=>strengthBand(value,currentBreaks);
  const lineWidths=[.65,1,1.45,2.2,3.4];
  const reverseSelected=selected&&relation!=="专利"?flows.find(x=>x.o===selected.d&&x.d===selected.o&&(analysisLevel==="区县"||(x.ot===selected.dt&&x.dt===selected.ot))):null;
  const openTown=async()=>{
    setTownOpen(true);setTownMetric(relation==="专利"?"count":metric);setTownError("");
    if(!selected)return;
    const pairKey=[`${selected.oc}|${selected.o}`,`${selected.dc}|${selected.d}`].sort().join("↔");
    if(townData&&townDataKey===pairKey)return;
    setTownLoading(true);
    try{
      const boundaryPromise=townBoundaries?Promise.resolve(townBoundaries):fetch("/data/township-boundaries.json").then(response=>{if(!response.ok)throw new Error(String(response.status));return response.json() as Promise<TownBoundaryPayload>});
      let index=townIndex;
      if(!index){const response=await fetch("/data/township-index.json");if(!response.ok)throw new Error(String(response.status));index=await response.json();setTownIndex(index)}
      const filename=index?.pairs[pairKey];
      let payload:TownPayload={meta:{amountUnit:"万元人民币",onlyCompleteTownOd:true,patentUndirected:true,fields:[]},records:[]};
      if(filename){const response=await fetch(`/data/township/${filename}`);if(!response.ok)throw new Error(String(response.status));payload=await response.json()}
      const boundaries=await boundaryPromise;if(!townBoundaries)setTownBoundaries(boundaries);setTownData(payload);setTownDataKey(pairKey);
    }
    catch{setTownError("镇街数据读取失败，请先重新生成关系数据。")}
    finally{setTownLoading(false)}
  };
  const townFlows=useMemo(()=>{
    if(!townData||!selected)return [];
    const grouped=new Map<string,TownFlow>();
    for(const r of townData.records){
      if(r[0]!==relation||!matchesIndustry(r[1],r[2]))continue;
      const forward=r[4]===selected.oc&&r[5]===selected.o&&r[7]===selected.dc&&r[8]===selected.d;
      const backward=r[4]===selected.dc&&r[5]===selected.d&&r[7]===selected.oc&&r[8]===selected.o;
      if(!forward&&!backward)continue;
      const key=`${r[4]}${r[5]}${r[6]}${relation==="专利"?"—":"→"}${r[7]}${r[8]}${r[9]}`;
      const x=grouped.get(key)||{key,oc:r[4],o:r[5],ot:r[6],dc:r[7],d:r[8],dt:r[9],count:0,amount:0,amountCount:0,patents:0,pairs:0,maxPair:0,share:0,unmatched:0};
      x.count+=r[10];x.amount+=r[11];x.amountCount+=r[12];x.patents+=r[13]||0;x.pairs+=r[14]||0;x.maxPair=Math.max(x.maxPair,r[15]||0);x.share=Math.max(x.share,r[16]||0);x.unmatched+=r[17]||0;grouped.set(key,x);
    }
    return [...grouped.values()].sort((a,b)=>(townMetric==="count"?b.count-a.count:b.amount-a.amount));
  },[townData,selected,relation,townMetric,matchesIndustry]);
  const townTotals=townFlows.reduce((a,x)=>({count:a.count+x.count,amount:a.amount+x.amount,links:a.links+1,patents:a.patents+x.patents,pairs:a.pairs+x.pairs}),{count:0,amount:0,links:0,patents:0,pairs:0});
  const townBreaks=quantileBreaks(townFlows.map(x=>townMetric==="count"?x.count:x.amount));
  const townLegend=numericLegend(scale,townBreaks,townFlows.map(x=>townMetric==="count"?x.count:x.amount),townMetric==="count"?"条":"万元",townMetric==="amount"?1:0);
  const townStrength=(value:number)=>strengthBand(value,townBreaks);
  const townRenderFlows=[...townFlows].reverse();
  const districtPairCount=selected?(selected.count+(relation!=="专利"?(reverseSelected?.count||0):0)):0;
  const townCoverage=districtPairCount?townTotals.count/districtPairCount:0;
  const totals=flows.reduce((a,x)=>({count:a.count+x.count,amount:a.amount+x.amount,links:a.links+1,patents:a.patents+x.patents,pairs:a.pairs+x.pairs}),{count:0,amount:0,links:0,patents:0,pairs:0});
  const industryComposition=useMemo<IndustryComposition|null>(()=>{
    if(!data||!selected)return null;
    const compositionRecords:Array<Rec|TownRec>=analysisLevel==="镇街"?(allTownData?.records||[]):data.records;
    const matchesSelected=(record:Rec|TownRec)=>{
      if(analysisLevel==="镇街"){
        const r=record as TownRec;
        const forward=r[4]===selected.oc&&r[5]===selected.o&&r[6]===selected.ot&&r[7]===selected.dc&&r[8]===selected.d&&r[9]===selected.dt;
        const reverse=r[4]===selected.dc&&r[5]===selected.d&&r[6]===selected.dt&&r[7]===selected.oc&&r[8]===selected.o&&r[9]===selected.ot;
        return forward||reverse;
      }
      const r=record as Rec;
      const forward=r[4]===selected.oc&&r[5]===selected.o&&r[6]===selected.dc&&r[7]===selected.d;
      const reverse=r[4]===selected.dc&&r[5]===selected.d&&r[6]===selected.oc&&r[7]===selected.o;
      return forward||reverse;
    };
    const recordValue=(record:Rec|TownRec)=>analysisLevel==="镇街"?(metric==="count"?(record as TownRec)[10]:(record as TownRec)[11]):(metric==="count"?(record as Rec)[8]:(record as Rec)[9]);
    if(industryMode==="产业链归纳"){
      const grouped=new Map<string,{code:string;name:string;value:number}>();
      for(const r of compositionRecords){
        if(r[0]!==relation||r[1]!==2||!activeChainCodes.has(r[2]))continue;
        if(!matchesSelected(r))continue;
        const value=recordValue(r);
        if(!Number.isFinite(value)||value<=0)continue;
        const chain=CHAIN_BY_CODE.get(r[2]);
        const code=selectedChain?r[2]:(chain?.id||"UNCLASSIFIED");
        const name=selectedChain?(r[3]||"未分类"):(chain?.name||"未分类");
        const current=grouped.get(code)||{code,name,value:0};current.value+=value;grouped.set(code,current);
      }
      const total=[...grouped.values()].reduce((sum,item)=>sum+item.value,0);
      const items=[...grouped.values()].sort((a,b)=>b.value-a.value).map(item=>({...item,share:total?item.value/total:0,color:industryColor(item.code)}));
      return{level:2,items,total,title:selectedChain?"产业链内二级行业占比":"产业链占比",context:selectedChain?.name||`${INDUSTRY_CHAINS.length}条产业链 / ${INDUSTRY_CHAIN_CODE_COUNT}个二级行业`};
    }
    const nextLevel=industry.code==="ALL"?1:(industry.level<3?industry.level+1:0);
    if(!nextLevel)return{level:0,items:[],total:0};
    const grouped=new Map<string,{code:string;name:string;value:number}>();
    for(const r of compositionRecords){
      if(r[0]!==relation||r[1]!==nextLevel)continue;
      if(industry.code!=="ALL"&&!r[2].startsWith(industry.code))continue;
      if(!matchesSelected(r))continue;
      const value=recordValue(r);
      if(!Number.isFinite(value)||value<=0)continue;
      const code=r[2]||"UNCLASSIFIED",name=r[3]||"未分类",current=grouped.get(code)||{code,name,value:0};
      current.value+=value;grouped.set(code,current);
    }
    const total=[...grouped.values()].reduce((sum,item)=>sum+item.value,0);
    const items=[...grouped.values()].sort((a,b)=>b.value-a.value).map(item=>({...item,share:total?item.value/total:0,color:industryColor(item.code)}));
    return{level:nextLevel,items,total};
  },[data,allTownData,analysisLevel,selected,relation,industry,industryMode,metric,activeChainCodes,selectedChain]);
  const zoom=(factor:number)=>setView(v=>{const k=Math.min(5,Math.max(1,v.k*factor));return k===1?{x:0,y:0,k}:{x:450-(450-v.x)*k/v.k,y:300-(300-v.y)*k/v.k,k}});
  useEffect(()=>{const el=mapRef.current;if(!el)return;const onWheel=(e:WheelEvent)=>{e.preventDefault();const factor=e.deltaY<0?1.18:1/1.18;setView(v=>{const k=Math.min(5,Math.max(1,v.k*factor));return k===1?{x:0,y:0,k}:{x:450-(450-v.x)*k/v.k,y:300-(300-v.y)*k/v.k,k}})};el.addEventListener("wheel",onWheel,{passive:false});return()=>el.removeEventListener("wheel",onWheel)},[]);
  const onPointerDown=(e:React.PointerEvent<SVGSVGElement>)=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y}};
  const onPointerMove=(e:React.PointerEvent<SVGSVGElement>)=>{if(!drag.current)return;const box=e.currentTarget.getBoundingClientRect(),s=900/box.width;setView(v=>({...v,x:drag.current!.vx+(e.clientX-drag.current!.x)*s,y:drag.current!.vy+(e.clientY-drag.current!.y)*s}))};
  const onPointerUp=()=>{drag.current=null};
  const geo=useMemo(()=>{
    if(!data)return null;const pts:any[]=[];
    data.boundaries.features.forEach(f=>f.geometry.coordinates.flat(2).forEach((p:any)=>pts.push(p)));
    const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),centerX=(minX+maxX)/2,centerY=(minY+maxY)/2,cosLatitude=Math.cos(centerY*Math.PI/180),xSpan=Math.max((maxX-minX)*cosLatitude,.0001),ySpan=Math.max(maxY-minY,.0001),mapScale=Math.min(820/xSpan,500/ySpan)/1.08;
    const project=(p:[number,number]):[number,number]=>[450+(p[0]-centerX)*cosLatitude*mapScale,300-(p[1]-centerY)*mapScale];
    const paths=data.boundaries.features.map(f=>({
      name:f.properties.name,
      d:f.geometry.coordinates
        .map((poly:any)=>poly.map((ring:any)=>ring.map((p:any,i:number)=>(i?"L":"M")+project(p).join(",")).join("")+"Z").join(""))
        .join("")
    }));
    const centers:Record<string,[number,number]>={};Object.entries(data.centers).forEach(([k,v])=>centers[k]=project(v));
    const townPaths=(townBoundaries?.features||[]).map(feature=>({...feature.properties,d:feature.geometry.coordinates.map((poly:any)=>poly.map((ring:any)=>ring.map((point:any,index:number)=>(index?"L":"M")+project(point).join(",")).join("")+"Z").join("")).join("")}));
    const townCenters:Record<string,[number,number]>={};(townBoundaries?.features||[]).forEach(feature=>{const point=project(feature.properties.center);townCenters[`${feature.properties.city}|${feature.properties.county}|${feature.properties.town}`]=point;townCenters[`${feature.properties.city}|${feature.properties.county}|~${normalizeTown(feature.properties.town)}`]=point});
    return{paths,centers,townPaths,townCenters};
  },[data,townBoundaries]);
  const townGeo=useMemo(()=>{
    if(!townBoundaries||!data||!selected)return null;
    const selectedCountyNames=new Set([selected.o,selected.d]);
    const selectedCountyFeatures=data.boundaries.features.filter(feature=>selectedCountyNames.has(feature.properties.name));
    const selectedTownFeatures=townBoundaries.features.filter(feature=>(feature.properties.city===selected.oc&&feature.properties.county===selected.o)||(feature.properties.city===selected.dc&&feature.properties.county===selected.d));
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const feature of selectedCountyFeatures)for(const polygon of feature.geometry.coordinates)for(const ring of polygon)for(const point of ring){if(point[0]<minX)minX=point[0];if(point[0]>maxX)maxX=point[0];if(point[1]<minY)minY=point[1];if(point[1]>maxY)maxY=point[1]}
    if(!Number.isFinite(minX))for(const feature of selectedTownFeatures)for(const polygon of feature.geometry.coordinates)for(const ring of polygon)for(const point of ring){if(point[0]<minX)minX=point[0];if(point[0]>maxX)maxX=point[0];if(point[1]<minY)minY=point[1];if(point[1]>maxY)maxY=point[1]}
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2,cosLatitude=Math.cos(centerY*Math.PI/180),xSpan=Math.max((maxX-minX)*cosLatitude,.0001),ySpan=Math.max(maxY-minY,.0001),mapScale=Math.min(820/xSpan,440/ySpan)/1.08;
    const project=(point:[number,number]):[number,number]=>[450+(point[0]-centerX)*cosLatitude*mapScale,260-(point[1]-centerY)*mapScale];
    const paths=selectedTownFeatures.map(feature=>({
      ...feature.properties,
      d:feature.geometry.coordinates.map((poly:any)=>poly.map((ring:any)=>ring.map((point:any,index:number)=>(index?"L":"M")+project(point).join(",")).join("")+"Z").join("")).join("")
    }));
    const countyPaths=data.boundaries.features.map(feature=>({name:feature.properties.name,d:feature.geometry.coordinates.map((poly:any)=>poly.map((ring:any)=>ring.map((point:any,index:number)=>(index?"L":"M")+project(point).join(",")).join("")+"Z").join("")).join("")}));
    const centers:Record<string,[number,number]>={};selectedTownFeatures.forEach(feature=>{const point=project(feature.properties.center);centers[`${feature.properties.city}|${feature.properties.county}|${feature.properties.town}`]=point;centers[`${feature.properties.city}|${feature.properties.county}|~${normalizeTown(feature.properties.town)}`]=point});
    return{paths,countyPaths,centers};
  },[townBoundaries,data,selected]);
  const townLabelKeys=new Set(townFlows.slice(0,18).flatMap(flow=>[`${flow.oc}|${flow.o}|~${normalizeTown(flow.ot)}`,`${flow.dc}|${flow.d}|~${normalizeTown(flow.dt)}`]));
  const endpointName=(flow:Flow,side:"o"|"d")=>analysisLevel==="镇街"?(side==="o"?flow.ot||flow.o:flow.dt||flow.d):(side==="o"?flow.o:flow.d);
  const endpointContext=(flow:Flow,side:"o"|"d")=>side==="o"?`${flow.oc} · ${flow.o}`:`${flow.dc} · ${flow.d}`;
  const mainCenter=(flow:Flow,side:"o"|"d")=>{
    const county=side==="o"?flow.o:flow.d;
    if(analysisLevel==="区县")return geo?.centers[county];
    return townCenter(geo?.townCenters||{},side==="o"?flow.oc:flow.dc,county,side==="o"?flow.ot||"":flow.dt||"")||geo?.centers[county];
  };
  const mainTownLabels=[...new Map(shown.slice(0,18).flatMap(flow=>[
    {key:`${flow.oc}|${flow.o}|~${normalizeTown(flow.ot||"")}`,name:flow.ot||flow.o,point:mainCenter(flow,"o")},
    {key:`${flow.dc}|${flow.d}|~${normalizeTown(flow.dt||"")}`,name:flow.dt||flow.d,point:mainCenter(flow,"d")}
  ]).map(item=>[item.key,item] as const)).values()];
  const scopeTitle=scope==="跨市"?"跨市":scope==="市内"?"市内":"全域";
  const mapTitle=`厦漳泉${scopeTitle}${analysisLevel}${relation}${relation==="专利"?"联系网络":"关系流向图"} · ${activeIndustryName}`;
  const mapSubtitle=`${activeIndustryPath} · ${metric==="count"?"关系数量":"金额（万元人民币）"} · ${limit===0?`全部 ${flows.length} 条`:`强度前 ${Math.min(limit,flows.length)} 条`}`;
  const townMapTitle=selected?`${selected.o}—${selected.d}${relation}镇街联系图 · ${activeIndustryName}`:`镇街联系图 · ${activeIndustryName}`;
  const townMapSubtitle=`${activeIndustryPath} · ${townMetric==="count"?"关系数量":"金额（万元人民币）"} · ${townFlows.length} 条镇街联系`;
  if(!data||!geo)return <main className="loading"><span>正在载入厦漳泉关系数据…</span></main>;
  const headerTitle=module==="企业关系"?"厦漳泉企业关系流动图谱":module==="人口流动"?"厦漳泉人口流动图谱":module==="交通可达性"?"厦漳泉交通可达性":"厦漳泉区县联系四象限";
  const headerSubtitle=module==="企业关系"?"区县与镇街两级投资、分支与专利协作网络 · 已排除区县内部关系":module==="人口流动"?"区县与镇街两级人口流动方向、双向联系与净流动分析":module==="交通可达性"?"区县政府驻地驾车时间、距离、过路费与跨市走廊分析":"人口流动联系与企业联系相对引力预期的协同类型识别";
  const headerStatus=module==="企业关系"?"3 类关系 · 28 个区县":module==="人口流动"?"人口流动 · 28 个区县":module==="交通可达性"?"驾车 OD · 28 个区县":"四类象限 · 378 个区县对";
  const headerNote=module==="企业关系"?`汇率基准 ${data.meta.baseline}`:module==="人口流动"?"行政区按源文件名称汇总":module==="交通可达性"?"756 条有向非自身 OD":"优化引力模型 · 无向区县对";
  const header=<header><div><p className="eyebrow">XIAMEN · ZHANGZHOU · QUANZHOU</p><h1>{headerTitle}</h1><p className="sub">{headerSubtitle}</p></div><div className="source"><div className="dataStatus"><span>数据状态</span><strong>{headerStatus}</strong><small>{headerNote}</small></div><details className="devLog"><summary><i/><span>开发日志</span><b>实时</b></summary><div className="devLogPanel"><div className="devLogHead"><div><strong>开发日志</strong><small>每 3 秒自动更新</small></div><time>{devLog?`更新于 ${fmtTime(devLog.updatedAt)}`:"正在读取…"}</time></div><div className="devLogList">{devLog&&[...devLog.entries].reverse().slice(0,10).map((entry,index)=><article key={`${entry.time}-${index}`} className={`log-${entry.type}`}><div><i/><time>{fmtTime(entry.time)}</time><em>{entry.type==="data"?"数据":entry.type==="server"?"服务":"功能"}</em></div><strong>{entry.title}</strong><p>{entry.detail}</p></article>)}</div><a href="/data/dev-log.json" target="_blank" rel="noreferrer">查看原始实时记录</a></div></details></div></header>;
  const platformSwitch=<nav className="platformSwitch" aria-label="平台功能"><button className="active"><span>区域联系网络</span><small>企业 · 人口流动 · 交通 · 协同象限</small></button><button disabled><span>用地分析</span><small>功能预留</small></button><button disabled><span>公共服务设施</span><small>功能预留</small></button></nav>;
  const moduleSwitch=<nav className="moduleSwitch" aria-label="区域联系网络子模块"><button className={module==="企业关系"?"active":""} onClick={()=>setModule("企业关系")}><span>企业关系</span><small>投资 · 分支 · 专利</small></button><button className={module==="人口流动"?"active":""} onClick={()=>setModule("人口流动")}><span>人口流动</span><small>区县 · 镇街</small></button><button className={module==="交通可达性"?"active":""} onClick={()=>setModule("交通可达性")}><span>交通可达性</span><small>区县政府驾车 OD</small></button><button className={module==="联系象限"?"active":""} onClick={()=>setModule("联系象限")}><span>联系象限</span><small>人口流动 · 企业 · 协同</small></button></nav>;
  if(module==="交通可达性")return <main>{header}{platformSwitch}{moduleSwitch}<TransportAccessibilityModule/><footer><span>数据源：厦漳泉区县政府所在地_OD.xlsx · 福建省 GeoPackage 行政边界</span><span>距离口径：有向地图保留实际方向；无向联系象限取两方向驾车里程算术平均值</span></footer></main>;
  if(module==="人口流动")return <main>{header}{platformSwitch}{moduleSwitch}<PopulationModule/><footer><span>数据源：厦漳泉乡镇级人口流动_汇总版.xlsx · 福建省 GeoPackage 行政边界</span><span>人口流动口径：不使用行政区代码，O/D 地市、区县和镇街均按源文件名称汇总</span></footer></main>;
  if(module==="联系象限")return <main>{header}{platformSwitch}{moduleSwitch}<QuadrantModule/><footer><span>数据源：优化引力模型四象限成果 · 人口流动汇总版 · 企业三类关系</span><span>象限口径：无向区县对；横轴人口流动联系残差，纵轴企业综合联系残差</span></footer></main>;
  return <main>{header}{platformSwitch}{moduleSwitch}
    <section className="controls">
      <label>分析层级<select value={analysisLevel} onChange={e=>changeAnalysisLevel(e.target.value as "区县"|"镇街")}><option>区县</option><option>镇街</option></select></label>
      <label>关系类型<select value={relation} onChange={e=>setRelation(e.target.value)}>{["投资","分支","专利"].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>联系范围<select value={scope} onChange={e=>setScope(e.target.value as "全部"|"跨市"|"市内")}><option value="全部">全部{analysisLevel}联系</option><option value="跨市">仅跨市{analysisLevel}联系</option><option value="市内">仅市内{analysisLevel}联系</option></select></label>
      <LocationTreePicker label={analysisLevel==="区县"?"起点区县":"起点镇街"} level={analysisLevel} value={originLocation} onChange={value=>{setOriginLocation(value);setSelected(null);setTownOpen(false)}} tree={locationTree} allLabel={analysisLevel==="区县"?"全部起点区县":"全部起点镇街"}/>
      <LocationTreePicker label={analysisLevel==="区县"?"终点区县":"终点镇街"} level={analysisLevel} value={destinationLocation} onChange={value=>{setDestinationLocation(value);setSelected(null);setTownOpen(false)}} tree={locationTree} allLabel={analysisLevel==="区县"?"全部终点区县":"全部终点镇街"}/>
      <div className="industrySelectorGroup">
        <label>行业口径<select value={industryMode} onChange={e=>{setIndustryMode(e.target.value as IndustryMode);setSelected(null);setTownOpen(false)}}><option>逐级行业</option><option>产业链归纳</option></select></label>
        {industryMode==="逐级行业"?<details className="industryTree"><summary><span>{relation==="专利"?"相关行业（任一企业端）":"D端行业（展开选择）"}</span><strong>{industry.path}</strong></summary><div className="treePanel"><button className={industry.code==="ALL"?"chosen":""} onClick={()=>setIndustry(relation==="专利"?{level:0,code:"ALL",name:"全部行业",path:"全部行业"}:{level:1,code:"ALL",name:"全部行业",path:"全部行业"})}>全部行业</button>{industryTree.map(a=><details key={a.code}><summary>{a.code} · {a.name}</summary><button className={industry.code===a.code?"chosen levelChoice":"levelChoice"} onClick={()=>setIndustry({level:1,code:a.code,name:a.name,path:a.name})}>选择“{a.name}”全部</button><div>{a.children.map(b=><details key={b.code}><summary>{b.code} · {b.name}</summary><button className={industry.code===b.code?"chosen levelChoice":"levelChoice"} onClick={()=>setIndustry({level:2,code:b.code,name:b.name,path:`${a.name} / ${b.name}`})}>选择“{b.name}”全部</button><div>{b.children.map(c=><button key={c.code} className={industry.code===c.code?"chosen":""} onClick={()=>setIndustry({level:3,code:c.code,name:c.name,path:`${a.name} / ${b.name} / ${c.name}`})}>{c.code} · {c.name}</button>)}</div></details>)}</div></details>)}</div></details>:<label className="chainSelector">{relation==="专利"?"相关产业链（任一企业端）":"D端产业链"}<select value={chainId} onChange={e=>{setChainId(e.target.value);setSelected(null);setTownOpen(false)}}><option value="ALL">全部产业链（{INDUSTRY_CHAIN_CODE_COUNT}个二级行业）</option>{INDUSTRY_CHAINS.map(chain=><option key={chain.id} value={chain.id}>{chain.name}（{chain.codes.length}个行业）</option>)}</select><small>{selectedChain?selectedChain.codes.join("、"):`${INDUSTRY_CHAINS.length}条产业链，覆盖全部${INDUSTRY_CHAIN_CODE_COUNT}个二级行业`}</small></label>}
      </div>
      <div className="toggle" aria-label="统计指标"><button className={metric==="count"?"active":""} onClick={()=>setMetric("count")}>关系数量</button><button disabled={relation==="专利"} className={metric==="amount"?"active":""} onClick={()=>setMetric("amount")}>金额</button></div>
    </section>
    <section className="stats"><article><span>{relation==="专利"?"专利—企业对关系":`跨${analysisLevel}关系`}</span><strong>{fmt(totals.count)}</strong><small>{relation==="专利"?(industryMode==="产业链归纳"?"按产业链行业关联次数":"按名称无向去重后"):"条去重关系"}</small></article><article><span>{relation==="专利"?`无向${analysisLevel}对`:"OD方向"}</span><strong>{fmt(totals.links)}</strong><small>{relation==="专利"?`个有效${analysisLevel}对`:"个有效流向"}</small></article><article><span>{relation==="专利"?`${analysisLevel}对内唯一专利名合计`:"金额合计"}</span><strong>{relation==="专利"?fmt(totals.patents):fmt(totals.amount,1)}</strong><small>{relation==="专利"?"同一专利名跨行业可出现":"万元人民币"}</small></article><article><span>{industryMode==="产业链归纳"?"当前产业链":"当前行业"}</span><strong className="industryName">{activeIndustryName}</strong><small>{activeIndustryPath}</small></article></section>
    <section className="workspace">
      <div className="mapCard"><div className="cardHead"><div><h2>{mapTitle}</h2><p>{mapSubtitle}；点击连线查看详情</p></div><div className="mapHeadActions"><select value={limit} onChange={e=>setLimit(+e.target.value)}><option value="30">前30</option><option value="60">前60</option><option value="120">前120</option><option value="200">前200</option><option value="0">全部</option></select><button onClick={()=>exportMapPng(mapRef.current,{title:mapTitle,subtitle:mapSubtitle,legendTitle:`${metric==="count"?"关系数量":"金额"}分级`,legend:currentLegend})}>导出 PNG</button></div></div>
        <div className="mapWrap">
          <svg ref={mapRef} viewBox="0 0 900 600" className="map" role="img" aria-label={`可缩放、可拖动的厦漳泉${analysisLevel}企业关系地图`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <defs><marker id="flowArrow" markerWidth="5" markerHeight="5" refX="4.7" refY="2.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L5,2.5 L0,5 Z" fill="context-stroke"/></marker></defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <g>{geo.paths.map(p=><path key={p.name} d={p.d} className="county"><title>{p.name}</title></path>)}</g>
              {analysisLevel==="镇街"&&<g>{geo.townPaths.map(path=><path key={`${path.city}-${path.county}-${path.town}`} d={path.d} className="enterpriseTownBoundary"><title>{path.city} · {path.county} · {path.town}</title></path>)}</g>}
              <g>{renderFlows.map(x=>{const a=mainCenter(x,"o"),b=mainCenter(x,"d");if(!a||!b)return null;const val=metric==="count"?x.count:x.amount,dx=b[0]-a[0],dy=b[1]-a[1],len=Math.max(1,Math.hypot(dx,dy)),bend=Math.min(52,Math.max(18,len*.16));const mx=(a[0]+b[0])/2-dy/len*bend,my=(a[1]+b[1])/2+dx/len*bend,d=`M${a} Q${mx},${my} ${b}`,band=strength(val),width=lineWidths[band];return <g key={x.key} onPointerDown={e=>e.stopPropagation()} onClick={()=>setSelected(x)}><path d={d} className="flowHit" style={{strokeWidth:width+9}}/><path d={d} className="flow" markerEnd={relation==="专利"?undefined:"url(#flowArrow)"} style={{stroke:scale[band],strokeWidth:width,opacity:.48+band*.1}}><title>{x.key}：{metric==="count"?fmt(x.count)+"条":fmt(x.amount,2)+"万元"}</title></path></g>})}</g>
              {analysisLevel==="区县"?<g>{Object.entries(geo.centers).map(([n,p])=><g key={n}><circle cx={p[0]} cy={p[1]} r="3.2"/><text x={p[0]+5} y={p[1]-5}>{n}</text></g>)}</g>:<g>{mainTownLabels.map(item=>item.point&&<g key={`main-town-${item.key}`}><circle cx={item.point[0]} cy={item.point[1]} r="2.4"/><text x={item.point[0]+4} y={item.point[1]-4}>{item.name}</text></g>)}</g>}
            </g>
          </svg>
          {analysisLevel==="镇街"&&directTownLoading&&<div className="enterpriseTownState">正在载入全量镇街关系与边界…</div>}
          {analysisLevel==="镇街"&&directTownError&&<div className="enterpriseTownState error">{directTownError}</div>}
          <div className="mapTools"><button onClick={()=>zoom(1.25)} aria-label="放大地图">＋</button><button onClick={()=>zoom(.8)} aria-label="缩小地图">－</button><button onClick={()=>setView({x:0,y:0,k:1})} aria-label="重置地图">复位</button></div>
          <span className="mapHint">滚轮缩放 · 按住拖动</span>
        </div>
        <div className="legend numericLegend"><span>{metric==="count"?"关系数量":"金额"}分级</span>{currentLegend.map(item=><span className="legendItem" key={`${item.color}-${item.label}`}><i style={{background:item.color}}/>{item.label}</span>)}</div>
      </div>
      <aside><div className="cardHead"><div><h2>{relation==="专利"?`${analysisLevel}对排名`:"OD 排名"}</h2><p>按当前指标降序</p></div></div><div className="ranking">{shown.slice(0,12).map((x,i)=><button key={x.key} onClick={()=>setSelected(x)}><b>{String(i+1).padStart(2,"0")}</b><span><strong>{endpointName(x,"o")} {relation==="专利"?"—":"→"} {endpointName(x,"d")}</strong><small>{endpointContext(x,"o")} · {endpointContext(x,"d")}</small></span><em>{metric==="count"?fmt(x.count):fmt(x.amount,1)}</em></button>)}</div></aside>
    </section>
    {selected&&(relation==="专利"?<div className="detail patentDetail"><button onClick={()=>setSelected(null)}>×</button><span>{analysisLevel}专利无向关系详情</span><h3>{endpointName(selected,"o")} — {endpointName(selected,"d")}</h3><p>{endpointContext(selected,"o")} 与 {endpointContext(selected,"d")} · 筛选产业：{activeIndustryName}</p><section className="direction"><h4>与所选产业有关的专利联系</h4><div><strong>{fmt(selected.count)}</strong><small>{industryMode==="产业链归纳"?"行业关联次数":"专利—企业对关系"}</small></div><div><strong>{fmt(selected.patents)}</strong><small>唯一专利名合计</small></div><div><strong>{fmt(selected.pairs)}</strong><small>唯一企业对合计</small></div><div><strong>{selected.maxPair?fmt(selected.maxPair):"—"}</strong><small>最大企业对专利名数</small></div><div><strong>{selected.share?`${fmt(selected.share*100,1)}%`:"—"}</strong><small>最大企业对贡献率</small></div><div><strong>{fmt(selected.unmatched)}</strong><small>方向不匹配关系</small></div>{selected.maxPair>0&&<em>集中度判断：{concentrationLabel(selected.share)}</em>}</section><IndustryDonut composition={industryComposition} metric={metric} relation={relation} parent={activeIndustryName}/>{analysisLevel==="区县"&&<div className="townAction"><button onClick={openTown}>查看两区县镇街级产业联系</button><small>沿用当前关系与产业筛选</small></div>}</div>:<div className="detail"><button onClick={()=>setSelected(null)}>×</button><span>{analysisLevel}{relation}双向关系详情</span><h3>{endpointName(selected,"o")} ⇄ {endpointName(selected,"d")}</h3><p>{endpointContext(selected,"o")} 与 {endpointContext(selected,"d")} · 当前产业：{activeIndustryName}</p><section className="direction"><h4>{endpointName(selected,"o")} → {endpointName(selected,"d")}</h4><div><strong>{fmt(selected.count)}</strong><small>关系数量</small></div><div><strong>{fmt(selected.amount,2)}</strong><small>金额（万元人民币）</small></div><div><strong>{selected.amountCount}</strong><small>有金额记录</small></div></section><section className="direction reverse"><h4>{endpointName(selected,"d")} → {endpointName(selected,"o")}</h4><div><strong>{fmt(reverseSelected?.count||0)}</strong><small>关系数量</small></div><div><strong>{fmt(reverseSelected?.amount||0,2)}</strong><small>金额（万元人民币）</small></div><div><strong>{reverseSelected?.amountCount||0}</strong><small>有金额记录</small></div>{!reverseSelected&&<em>当前筛选条件下无反向记录</em>}</section><IndustryDonut composition={industryComposition} metric={metric} relation={relation} parent={activeIndustryName}/>{analysisLevel==="区县"&&<div className="townAction"><button onClick={openTown}>查看两区县镇街级产业联系</button><small>同时展示两个方向</small></div>}</div>)}
    {townOpen&&selected&&analysisLevel==="区县"&&<div className="townOverlay" role="dialog" aria-modal="true" aria-label={`${selected.o}与${selected.d}镇街联系`} onMouseDown={()=>setTownOpen(false)}>
      <section className="townPanel" onMouseDown={e=>e.stopPropagation()}>
        <button className="townClose" onClick={()=>setTownOpen(false)} aria-label="关闭镇街联系">×</button>
        <div className="townHeader"><span>{relation} · 镇街级产业联系</span><h2>{selected.o} {relation==="专利"?"—":"⇄"} {selected.d}</h2><p>{activeIndustryPath} · 仅统计 O/D 两端镇街字段均有效的记录</p></div>
        {townLoading?<div className="townState townLoadingState">正在载入镇街关系与边界地图…</div>:townError?<div className="townState error">{townError}</div>:<>
          {townGeo&&<div className="townNetworkMap">
            <div className="townMapCaption"><div><strong>{townMapTitle}</strong><span>{townMapSubtitle}；仅展开所选两个区县的镇街边界</span></div><div className="mapHeadActions"><small>按当前列表动态分级</small><button onClick={()=>exportMapPng(townMapRef.current,{title:townMapTitle,subtitle:townMapSubtitle,legendTitle:`${townMetric==="count"?"关系数量":"金额"}分级`,legend:townLegend})}>导出 PNG</button></div></div>
            <svg ref={townMapRef} viewBox="0 0 900 520" role="img" aria-label={`${selected.o}与${selected.d}镇街级产业联系地图`}>
              <defs><marker id="townArrow" markerWidth="4" markerHeight="4" refX="3.8" refY="2" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L4,2 L0,4 Z" fill="context-stroke"/></marker></defs>
              <g>{townGeo.countyPaths.map(path=><path key={`county-${path.name}`} d={path.d} className="townCountyBackground"><title>{path.name}</title></path>)}</g>
              <g>{townGeo.paths.map(path=>{const sideA=path.city===selected.oc&&path.county===selected.o,sideB=path.city===selected.dc&&path.county===selected.d;if(!sideA&&!sideB)return null;return <path key={`${path.city}-${path.county}-${path.town}`} d={path.d} className={`townBoundary selected ${sideA?"sideA":"sideB"}`}><title>{path.city} · {path.county} · {path.town}</title></path>})}</g>
              <g>{townRenderFlows.map(flow=>{const a=townCenter(townGeo.centers,flow.oc,flow.o,flow.ot),b=townCenter(townGeo.centers,flow.dc,flow.d,flow.dt);if(!a||!b)return null;const value=townMetric==="count"?flow.count:flow.amount,band=townStrength(value),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.max(1,Math.hypot(dx,dy)),bend=Math.min(24,Math.max(8,length*.1)),mx=(a[0]+b[0])/2-dy/length*bend,my=(a[1]+b[1])/2+dx/length*bend,d=`M${a} Q${mx},${my} ${b}`;return <path key={flow.key} d={d} className="townFlow" markerEnd={relation==="专利"?undefined:"url(#townArrow)"} style={{stroke:scale[band],strokeWidth:[.45,.7,1,1.5,2.3][band],opacity:.5+band*.1}}><title>{flow.ot} {relation==="专利"?"—":"→"} {flow.dt}：{townMetric==="count"?fmt(flow.count)+"条":fmt(flow.amount,2)+"万元"}</title></path>})}</g>
              <g>{townGeo.paths.filter(path=>townLabelKeys.has(`${path.city}|${path.county}|~${normalizeTown(path.town)}`)).map(path=>{const point=townCenter(townGeo.centers,path.city,path.county,path.town);if(!point)return null;return <text key={`label-${path.city}-${path.county}-${path.town}`} x={point[0]+3} y={point[1]-3}>{path.town}</text>})}</g>
            </svg>
            <div className="townMapLegend"><span><i className="sideA"/>{selected.o}</span><span><i className="sideB"/>{selected.d}</span><span className="townStrengthLegend">{townLegend.map(item=><span className="legendItem" key={`${item.color}-${item.label}`}><i style={{background:item.color}}/>{item.label}</span>)}</span></div>
          </div>}
          <div className="townSummary"><article><span>镇街联系</span><strong>{fmt(townTotals.links)}</strong><small>个有效组合</small></article><article><span>{relation==="专利"?"专利—企业对关系":"关系数量"}</span><strong>{fmt(townTotals.count)}</strong><small>镇街字段覆盖 {fmt(townCoverage*100,1)}%</small></article><article><span>{relation==="专利"?"唯一专利名合计":"金额合计"}</span><strong>{relation==="专利"?fmt(townTotals.patents):fmt(townTotals.amount,1)}</strong><small>{relation==="专利"?"按镇街组合合计":"万元人民币"}</small></article></div>
          <div className="townToolbar"><div><strong>镇街联系明细</strong><span>按当前指标降序，共 {townFlows.length} 条</span></div><div className="townToggle"><button className={townMetric==="count"?"active":""} onClick={()=>setTownMetric("count")}>关系数量</button><button disabled={relation==="专利"} className={townMetric==="amount"?"active":""} onClick={()=>setTownMetric("amount")}>金额</button></div></div>
          {townFlows.length===0?<div className="townState">当前筛选下没有两端镇街均完整的关系记录。</div>:<div className="townTable"><div className="townTableHead"><span>序号</span><span>O端镇街</span><span>方向</span><span>D端镇街</span><span>关系数量</span><span>{relation==="专利"?"专利名 / 企业对":"金额（万元）"}</span></div>{townFlows.map((x,index)=><article key={x.key}><b>{String(index+1).padStart(2,"0")}</b><div><strong>{x.ot}</strong><small>{x.oc} · {x.o}</small></div><i>{relation==="专利"?"—":"→"}</i><div><strong>{x.dt}</strong><small>{x.dc} · {x.d}</small></div><em>{fmt(x.count)}</em><div className="townValue">{relation==="专利"?<><strong>{fmt(x.patents)} / {fmt(x.pairs)}</strong><small>唯一专利名 / 企业对</small></>:<><strong>{fmt(x.amount,2)}</strong><small>{fmt(x.amountCount)} 条有金额</small></>}</div></article>)}</div>}
          <div className="townNote">镇街字段来自三个源文件的 <code>o_village</code> 与 <code>d_village</code>；专利按标准化专利名＋无序企业对去重，正反向及 role 重复均合并。</div>
        </>}
      </section>
    </div>}
    <footer><span>数据源：{data.meta.sources.join(" · ")} · 福建省 GeoPackage 行政边界</span><span>{relation==="专利"?"专利口径：专利名＋无序企业对去重，正反向及 role 重复合并":"统一口径：O/D 区县均有效，且 O ≠ D"}</span></footer>
  </main>
}
