"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { exportMapPng, numericLegend } from "./map-export";

type ModelParam={
  metric:string;
  r2:number;
  coefficients:Record<string,number>;
};
type QuadrantRow={
  pair:string;
  city_a:string;
  county_a:string;
  city_b:string;
  county_b:string;
  distance_km:number;
  population_flow:number;
  population_flow_expected:number;
  population_flow_z:number;
  branch:number;
  branch_expected:number;
  branch_z:number;
  investment:number;
  investment_expected:number;
  investment_z:number;
  patent:number;
  patent_expected:number;
  patent_z:number;
  enterprise_z:number;
  population_abs_pct:number;
  enterprise_abs_pct:number;
  absolute_composite:number;
  quadrant:1|2|3|4;
  quadrant_name:string;
  absolute_level:"高"|"低";
  function_type:string;
  flow_type:"市内流动"|"跨市区县流动";
  rank:number;
};
type QuadrantPayload={
  meta:{
    source:string;
    sourceFolder:string;
    generatedAt:string;
    pairCount:number;
    highAbsoluteCount:number;
    crossCityCount:number;
    withinCityCount:number;
    quadrantCounts:Record<string,number>;
    populationSourceRows:number;
    distanceSource?:string;
    distanceDefinition?:string;
    method:string;
  };
  weights:Record<"branch"|"investment"|"patent",number>;
  params:ModelParam[];
  rows:QuadrantRow[];
};
type BoundaryFeature={properties:{city:string;name:string;code:string};geometry:{type:"MultiPolygon";coordinates:any[]}};
type SpatialPayload={countyCenters:Record<string,[number,number]>;countyBoundaries:{features:BoundaryFeature[]}};

const fmt=(value:number,digits=0)=>new Intl.NumberFormat("zh-CN",{maximumFractionDigits:digits}).format(value);
const signed=(value:number)=>`${value>0?"+":""}${value.toFixed(2)}`;
const colors:Record<number,string>={1:"#2f8f70",2:"#d58a32",3:"#7f8a99",4:"#416fb5"};
const quadrantLabels:Record<number,string>={
  1:"Ⅰ 人口流动、企业均超预期",
  2:"Ⅱ 人口流动超预期、企业低预期",
  3:"Ⅲ 人口流动、企业均低预期",
  4:"Ⅳ 人口流动低预期、企业超预期",
};
const shortQuadrant:Record<number,string>={1:"成熟／潜在协调",2:"人口流动先导",3:"协同不足／边缘",4:"企业先导"};
const typeDefinitions=[
  {name:"成熟协调型",displayName:"成熟协调型",quadrant:1,level:"高",summary:"人口流动联系与企业联系均超出模型预期，且绝对联系规模较高。",meaning:"两类网络基础扎实，可作为一体化成熟区县对。"},
  {name:"成熟核心·产业协同提升型",displayName:"成熟核心·产业协同提升型",quadrant:2,level:"高",summary:"人口流动联系超预期、企业联系低预期，但绝对联系规模较高。",meaning:"人口流动基础成熟，重点补强产业分工与企业协作。"},
  {name:"规模强但协同不足型",displayName:"规模强但协同不足型",quadrant:3,level:"高",summary:"绝对联系规模较高，但人口流动联系与企业联系均低于模型预期。",meaning:"规模优势尚未转化为相对协同，需要排查结构性阻滞。"},
  {name:"成熟核心·人口联系提升型",displayName:"成熟核心·人口流动联系提升型",quadrant:4,level:"高",summary:"企业联系超预期、人口流动联系低预期，且绝对联系规模较高。",meaning:"产业协作基础成熟，重点改善通勤、居住与公共服务联系。"},
  {name:"潜在成长型",displayName:"潜在成长型",quadrant:1,level:"低",summary:"绝对规模仍低，但人口流动联系与企业联系均已超出模型预期。",meaning:"具有小规模、高效率特征，可作为后续培育型联系。"},
  {name:"生活联系先导型",displayName:"人口流动联系先导型",quadrant:2,level:"低",summary:"人口流动联系超预期，企业联系与绝对规模仍偏低。",meaning:"通勤、迁移或服务流动联系先行，产业协同尚需跟进。"},
  {name:"核心网络边缘型",displayName:"核心网络边缘型",quadrant:3,level:"低",summary:"人口流动联系与企业联系均低预期，绝对联系规模也较低。",meaning:"处于区域联系网络边缘，应谨慎判断协同潜力。"},
  {name:"产业联系先导型",displayName:"产业联系先导型",quadrant:4,level:"低",summary:"企业联系超预期，人口流动联系与绝对规模仍偏低。",meaning:"产业协作先行，需要增强人口流动和生活服务支撑。"},
] as const;
const displayFunctionType=(name:string)=>typeDefinitions.find(type=>type.name===name)?.displayName||name;
const mapColors=["#c7ddd6","#88bdb0","#f0c66e","#e88a4d","#b93b35"];
const quantileBreaks=(values:number[])=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return [];return [.2,.4,.6,.8].map(q=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))])};
const strengthBand=(value:number,breaks:number[])=>{if(!breaks.length||breaks.every(item=>item===breaks[0]))return 2;if(value<=breaks[0])return 0;if(value<=breaks[1])return 1;if(value<=breaks[2])return 2;if(value<=breaks[3])return 3;return 4};
const geometryPath=(coordinates:any[],project:(point:[number,number])=>[number,number])=>coordinates.map((polygon:any)=>polygon.map((ring:any)=>ring.map((point:any,index:number)=>(index?"L":"M")+project(point).join(",")).join("")+"Z").join("")).join("");

function PointShape({row,x,y,size,selected,dimmed,onSelect,onHover,onLeave}:{row:QuadrantRow;x:number;y:number;size:number;selected:boolean;dimmed:boolean;onSelect:()=>void;onHover:(event:React.MouseEvent<SVGElement>)=>void;onLeave:()=>void}){
  const common={className:`quadrantPoint${row.absolute_level==="高"?" high":""}${selected?" selected":""}${dimmed?" dimmed":""}`,onClick:onSelect,onMouseMove:onHover,onMouseLeave:onLeave,tabIndex:0,role:"button","aria-label":`${row.pair}，${quadrantLabels[row.quadrant]}，${displayFunctionType(row.function_type)}`} as const;
  if(row.quadrant===1)return <circle {...common} cx={x} cy={y} r={size} fill={colors[row.quadrant]}/>;
  if(row.quadrant===2)return <rect {...common} x={x-size} y={y-size} width={size*2} height={size*2} rx={1.5} fill={colors[row.quadrant]}/>;
  if(row.quadrant===3)return <path {...common} d={`M${x},${y-size*1.25} L${x+size*1.25},${y} L${x},${y+size*1.25} L${x-size*1.25},${y} Z`} fill={colors[row.quadrant]}/>;
  return <path {...common} d={`M${x},${y-size*1.35} L${x+size*1.25},${y+size} L${x-size*1.25},${y+size} Z`} fill={colors[row.quadrant]}/>;
}

export default function QuadrantModule(){
  const [data,setData]=useState<QuadrantPayload|null>(null);
  const [spatial,setSpatial]=useState<SpatialPayload|null>(null);
  const [scope,setScope]=useState<"全部"|"跨市"|"市内">("全部");
  const [quadrant,setQuadrant]=useState<"ALL"|"1"|"2"|"3"|"4">("ALL");
  const [functionType,setFunctionType]=useState("ALL");
  const [axisMode,setAxisMode]=useState<"密集展开"|"线性范围">("密集展开");
  const [selected,setSelected]=useState<QuadrantRow|null>(null);
  const [tooltip,setTooltip]=useState<{row:QuadrantRow;x:number;y:number}|null>(null);
  const [mapView,setMapView]=useState({x:0,y:0,k:1});
  const chartRef=useRef<SVGSVGElement|null>(null);
  const typeMapRef=useRef<SVGSVGElement|null>(null);
  const mapDrag=useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
  useEffect(()=>{fetch("/data/quadrant-analysis.json").then(response=>response.json()).then(setData)},[]);
  useEffect(()=>{fetch("/data/population-flow.json").then(response=>response.json()).then(setSpatial)},[]);

  const functionTypes=useMemo(()=>data?[...new Set(data.rows.map(row=>row.function_type))].sort():[],[data]);
  const scopeRows=useMemo(()=>data?.rows.filter(row=>{
    if(scope==="跨市")return row.flow_type==="跨市区县流动";
    if(scope==="市内")return row.flow_type==="市内流动";
    return true;
  })||[],[data,scope]);
  const filtered=useMemo(()=>data?.rows.filter(row=>{
    if(scope==="跨市"&&row.flow_type!=="跨市区县流动")return false;
    if(scope==="市内"&&row.flow_type!=="市内流动")return false;
    if(quadrant!=="ALL"&&row.quadrant!==Number(quadrant))return false;
    return functionType==="ALL"||row.function_type===functionType;
  })||[],[data,scope,quadrant,functionType]);
  const visiblePairs=useMemo(()=>new Set(filtered.map(row=>row.pair)),[filtered]);
  useEffect(()=>{if(selected&&!visiblePairs.has(selected.pair))setSelected(null)},[visiblePairs,selected]);

  const geometry=useMemo(()=>{
    if(!data)return null;
    const width=980,height=620,margin={top:42,right:36,bottom:78,left:86},innerWidth=width-margin.left-margin.right,innerHeight=height-margin.top-margin.bottom;
    const rawXs=data.rows.map(row=>row.population_flow_z),rawYs=data.rows.map(row=>row.enterprise_z);
    const transform=(value:number)=>axisMode==="密集展开"?Math.asinh(value/.72):value;
    const transformedXs=rawXs.map(transform),transformedYs=rawYs.map(transform),padding=.18;
    const xMin=Math.min(...transformedXs)-padding,xMax=Math.max(...transformedXs)+padding,yMin=Math.min(...transformedYs)-padding,yMax=Math.max(...transformedYs)+padding;
    const x=(value:number)=>margin.left+(transform(value)-xMin)/(xMax-xMin)*innerWidth;
    const y=(value:number)=>margin.top+(yMax-transform(value))/(yMax-yMin)*innerHeight;
    const actualXMin=Math.floor(Math.min(...rawXs)),actualXMax=Math.ceil(Math.max(...rawXs)),actualYMin=Math.floor(Math.min(...rawYs)),actualYMax=Math.ceil(Math.max(...rawYs));
    return{width,height,margin,innerWidth,innerHeight,actualXMin,actualXMax,actualYMin,actualYMax,x,y,x0:x(0),y0:y(0)};
  },[data,axisMode]);
  const typeMapGeometry=useMemo(()=>{
    if(!spatial)return null;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const feature of spatial.countyBoundaries.features)for(const polygon of feature.geometry.coordinates)for(const ring of polygon)for(const point of ring){minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);minY=Math.min(minY,point[1]);maxY=Math.max(maxY,point[1])}
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2,cos=Math.cos(centerY*Math.PI/180),scale=Math.min(820/Math.max((maxX-minX)*cos,.0001),500/Math.max(maxY-minY,.0001))/1.08;
    const project=(point:[number,number]):[number,number]=>[450+(point[0]-centerX)*cos*scale,300-(point[1]-centerY)*scale];
    const counties=spatial.countyBoundaries.features.map(feature=>({...feature.properties,d:geometryPath(feature.geometry.coordinates,project)}));
    const centers:Record<string,[number,number]>={};Object.entries(spatial.countyCenters).forEach(([key,point])=>centers[key]=project(point));
    return{counties,centers};
  },[spatial]);
  const zoomTypeMap=(factor:number)=>setMapView(current=>{const k=Math.min(5,Math.max(1,current.k*factor));return k===1?{x:0,y:0,k}:{x:450-(450-current.x)*k/current.k,y:300-(300-current.y)*k/current.k,k}});
  useEffect(()=>{const element=typeMapRef.current;if(!element||functionType==="ALL")return;const wheel=(event:WheelEvent)=>{event.preventDefault();zoomTypeMap(event.deltaY<0?1.18:1/1.18)};element.addEventListener("wheel",wheel,{passive:false});return()=>element.removeEventListener("wheel",wheel)},[functionType]);
  useEffect(()=>setMapView({x:0,y:0,k:1}),[functionType,scope]);
  if(!data||!geometry)return <section className="quadrantLoading">正在载入区县对四象限分析…</section>;

  const highCount=filtered.filter(row=>row.absolute_level==="高").length;
  const crossCount=filtered.filter(row=>row.flow_type==="跨市区县流动").length;
  const top=filtered[0];
  const populationParam=data.params.find(item=>item.metric==="population_flow");
  const branchParam=data.params.find(item=>item.metric==="branch");
  const investmentParam=data.params.find(item=>item.metric==="investment");
  const patentParam=data.params.find(item=>item.metric==="patent");
  const enterpriseWeight=`${fmt(data.weights.branch*100,1)}% / ${fmt(data.weights.investment*100,1)}% / ${fmt(data.weights.patent*100,1)}%`;
  const {width,height,margin,innerWidth,innerHeight,actualXMin,actualXMax,actualYMin,actualYMax,x,y,x0,y0}=geometry;
  const ticks=(minimum:number,maximum:number)=>{
    const values=Array.from({length:maximum-minimum+1},(_,index)=>minimum+index);
    return axisMode==="密集展开"?[...new Set([...values,-.5,.5])].filter(value=>value>=minimum&&value<=maximum).sort((a,b)=>a-b):values;
  };
  const xTicks=ticks(actualXMin,actualXMax),yTicks=ticks(actualYMin,actualYMax);
  const typeCounts=Object.fromEntries(typeDefinitions.map(type=>[type.name,scopeRows.filter(row=>row.function_type===type.name).length]));
  const typeCountScope=scope==="跨市"?"跨市区县对":scope==="市内"?"市内区县对":"全部区县对";
  const exportLegend=[
    {color:colors[1],label:"Ⅰ 成熟／潜在协调"},
    {color:colors[2],label:"Ⅱ 人口流动先导"},
    {color:colors[3],label:"Ⅲ 协同不足／边缘"},
    {color:colors[4],label:"Ⅳ 企业先导"},
    {color:"#c99a2e",label:"金色外圈：高绝对强度"},
  ];
  const chartTitle=`厦漳泉${scope==="全部"?"全域":scope}区县对人口流动—企业联系四象限`;
  const chartSubtitle=`${quadrant==="ALL"?"全部象限":shortQuadrant[Number(quadrant)]} · ${functionType==="ALL"?"全部功能类型":functionType} · ${filtered.length} 个区县对 · ${axisMode==="密集展开"?"密集区非线性展开":"线性完整范围"}`;
  const typeMapRows=functionType==="ALL"?[]:scopeRows.filter(row=>row.function_type===functionType);
  const typeMapBreaks=quantileBreaks(typeMapRows.map(row=>row.absolute_composite*100));
  const typeMapLegend=numericLegend(mapColors,typeMapBreaks,typeMapRows.map(row=>row.absolute_composite*100),"分",1);
  const typeMapTitle=`厦漳泉${scope==="全部"?"全域":scope}${displayFunctionType(functionType)}区县对分布图`;
  const typeMapSubtitle=`${typeMapRows.length} 个无向区县对 · 按人口流动—企业联系绝对综合强度分级`;
  const typeMapLabels=[...new Map(typeMapRows.flatMap(row=>[[`${row.city_a}|${row.county_a}`,{city:row.city_a,county:row.county_a}],[`${row.city_b}|${row.county_b}`,{city:row.city_b,county:row.county_b}]]) as Array<[string,{city:string;county:string}]>).values()];

  const hover=(row:QuadrantRow,event:React.MouseEvent<SVGElement>)=>{
    const rect=chartRef.current?.getBoundingClientRect();if(!rect)return;
    setTooltip({row,x:event.clientX-rect.left,y:event.clientY-rect.top});
  };
  return <section className="quadrantModule">
    <section className="quadrantControls">
      <label>联系范围<select value={scope} onChange={event=>setScope(event.target.value as "全部"|"跨市"|"市内")}><option value="全部">全部区县对</option><option value="跨市">仅跨市区县对</option><option value="市内">仅市内区县对</option></select></label>
      <label>联系象限<select value={quadrant} onChange={event=>setQuadrant(event.target.value as typeof quadrant)}><option value="ALL">全部四个象限</option>{[1,2,3,4].map(value=><option value={value} key={value}>{quadrantLabels[value]}</option>)}</select></label>
      <label>功能类型<select value={functionType} onChange={event=>{const value=event.target.value;setFunctionType(value);const definition=typeDefinitions.find(type=>type.name===value);setQuadrant(definition?String(definition.quadrant) as "1"|"2"|"3"|"4":"ALL")}}><option value="ALL">全部功能类型</option>{functionTypes.map(value=><option key={value} value={value}>{displayFunctionType(value)}</option>)}</select></label>
      <label>定位区县对<select value={selected?.pair||""} onChange={event=>setSelected(data.rows.find(row=>row.pair===event.target.value)||null)}><option value="">选择一个区县对</option>{filtered.map(row=><option value={row.pair} key={row.pair}>{row.pair}</option>)}</select></label>
    </section>

    <section className="quadrantStats">
      <article><span>当前区县对</span><strong>{fmt(filtered.length)}</strong><small>无向区县组合</small></article>
      <article><span>高绝对强度</span><strong>{fmt(highCount)}</strong><small>{filtered.length?`${fmt(highCount/filtered.length*100,1)}% · 人口流动和企业联系均处高位`:"当前无记录"}</small></article>
      <article><span>跨市区县对</span><strong>{fmt(crossCount)}</strong><small>{filtered.length?`${fmt(crossCount/filtered.length*100,1)}% · 当前筛选`:"当前无记录"}</small></article>
      <article><span>综合强度首位</span><strong className="quadrantTopName">{top?.pair||"暂无"}</strong><small>{top?`${displayFunctionType(top.function_type)} · ${fmt(top.absolute_composite*100,1)}分`:"当前筛选无记录"}</small></article>
    </section>

    <section className="quadrantTypeGuide">
      <div className="quadrantTypeHead"><div><span>FUNCTION TYPOLOGY</span><h2>八类区县联系功能类型</h2><p>四个象限进一步叠加绝对综合强度，形成“高强度核心型”与“低强度成长／边缘型”两组八类联系；卡片数量当前按{typeCountScope}统计。</p></div><button className={functionType==="ALL"?"active":""} onClick={()=>{setFunctionType("ALL");setQuadrant("ALL")}}>显示全部类型</button></div>
      <div className="quadrantTypeGrid">{typeDefinitions.map(type=><button key={type.name} className={functionType===type.name?"active":""} onClick={()=>{setFunctionType(type.name);setQuadrant(String(type.quadrant) as "1"|"2"|"3"|"4")}}>
        <span><i style={{background:colors[type.quadrant]}}/>{type.level}绝对强度 · 象限 {["","Ⅰ","Ⅱ","Ⅲ","Ⅳ"][type.quadrant]}<b>{typeCounts[type.name]} 对</b></span>
        <strong>{type.displayName}</strong>
        <p>{type.summary}</p>
        <small>{type.meaning}</small>
      </button>)}</div>
    </section>

    {functionType!=="ALL"&&typeMapGeometry&&<section className="quadrantTypeMapCard">
      <div className="cardHead"><div><h2>{typeMapTitle}</h2><p>{typeMapSubtitle}；点击连线查看区县对详情</p></div><div className="mapHeadActions"><button onClick={()=>exportMapPng(typeMapRef.current,{title:typeMapTitle,subtitle:typeMapSubtitle,legendTitle:"绝对综合强度",legend:typeMapLegend})}>导出 PNG</button></div></div>
      <div className="quadrantTypeMapWrap"><svg ref={typeMapRef} viewBox="0 0 900 600" className="quadrantTypeMap" role="img" aria-label={`${displayFunctionType(functionType)}区县对空间分布图`} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);mapDrag.current={x:event.clientX,y:event.clientY,vx:mapView.x,vy:mapView.y}}} onPointerMove={event=>{if(!mapDrag.current)return;const ratio=900/event.currentTarget.getBoundingClientRect().width;setMapView(current=>({...current,x:mapDrag.current!.vx+(event.clientX-mapDrag.current!.x)*ratio,y:mapDrag.current!.vy+(event.clientY-mapDrag.current!.y)*ratio}))}} onPointerUp={()=>{mapDrag.current=null}} onPointerCancel={()=>{mapDrag.current=null}}>
        <g transform={`translate(${mapView.x} ${mapView.y}) scale(${mapView.k})`}><g>{typeMapGeometry.counties.map(feature=><path key={feature.code} d={feature.d} className="populationCounty"><title>{feature.city} · {feature.name}</title></path>)}</g>
        <g>{[...typeMapRows].sort((a,b)=>a.absolute_composite-b.absolute_composite).map(row=>{const start=typeMapGeometry.centers[`${row.city_a}|${row.county_a}`],end=typeMapGeometry.centers[`${row.city_b}|${row.county_b}`];if(!start||!end)return null;const grade=strengthBand(row.absolute_composite*100,typeMapBreaks),dx=end[0]-start[0],dy=end[1]-start[1],length=Math.max(1,Math.hypot(dx,dy)),bend=Math.min(32,Math.max(8,length*.08)),mx=(start[0]+end[0])/2-dy/length*bend,my=(start[1]+end[1])/2+dx/length*bend,d=`M${start} Q${mx},${my} ${end}`;return <g key={row.pair} onPointerDown={event=>event.stopPropagation()} onClick={()=>setSelected(row)}><path d={d} className="populationFlowHit" style={{strokeWidth:11}}/><path d={d} className="quadrantTypeLink" style={{stroke:mapColors[grade],strokeWidth:[.8,1.1,1.55,2.15,3][grade],opacity:.78}}><title>{row.pair}：{fmt(row.absolute_composite*100,1)}分</title></path></g>})}</g>
        <g>{typeMapLabels.map(item=>{const point=typeMapGeometry.centers[`${item.city}|${item.county}`];return point?<g key={`${item.city}|${item.county}`}><circle cx={point[0]} cy={point[1]} r="2.6" className="quadrantTypeNode"/><text x={point[0]+4} y={point[1]-4}>{item.county}</text></g>:null})}</g></g>
      </svg><div className="mapTools"><button onClick={()=>zoomTypeMap(1.25)}>＋</button><button onClick={()=>zoomTypeMap(.8)}>－</button><button onClick={()=>setMapView({x:0,y:0,k:1})}>复位</button></div><span className="mapHint">滚轮缩放 · 按住拖动</span></div>
      <div className="populationLegend numericLegend"><strong>绝对综合强度</strong>{typeMapLegend.map(item=><span className="legendItem" key={`${item.color}-${item.label}`}><i style={{background:item.color}}/>{item.label}</span>)}</div>
    </section>}

    <section className="quadrantWorkspace">
      <div className="quadrantChartCard">
        <div className="cardHead"><div><h2>{chartTitle}</h2><p>{chartSubtitle}；点击散点查看实际值、模型预期与分类解释</p></div><div className="mapHeadActions quadrantChartActions"><div className="quadrantAxisToggle"><button className={axisMode==="密集展开"?"active":""} onClick={()=>setAxisMode("密集展开")}>展开密集区</button><button className={axisMode==="线性范围"?"active":""} onClick={()=>setAxisMode("线性范围")}>完整线性范围</button></div><button onClick={()=>exportMapPng(chartRef.current,{title:chartTitle,subtitle:chartSubtitle,legendTitle:"四象限分类",legend:exportLegend})}>导出 PNG</button></div></div>
        <div className="quadrantChartWrap">
          <svg ref={chartRef} className="quadrantChart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="区县人口流动与企业联系四象限散点图">
            <rect x={margin.left} y={margin.top} width={x0-margin.left} height={y0-margin.top} fill={colors[4]} opacity=".07"/>
            <rect x={x0} y={margin.top} width={margin.left+innerWidth-x0} height={y0-margin.top} fill={colors[1]} opacity=".07"/>
            <rect x={margin.left} y={y0} width={x0-margin.left} height={margin.top+innerHeight-y0} fill={colors[3]} opacity=".08"/>
            <rect x={x0} y={y0} width={margin.left+innerWidth-x0} height={margin.top+innerHeight-y0} fill={colors[2]} opacity=".07"/>
            {xTicks.map(value=><g key={`x-${value}`}><line x1={x(value)} y1={margin.top} x2={x(value)} y2={margin.top+innerHeight} className="quadrantGrid"/><text x={x(value)} y={margin.top+innerHeight+25} textAnchor="middle" className="quadrantTick">{value>0?"+":""}{value}</text></g>)}
            {yTicks.map(value=><g key={`y-${value}`}><line x1={margin.left} y1={y(value)} x2={margin.left+innerWidth} y2={y(value)} className="quadrantGrid"/><text x={margin.left-12} y={y(value)+4} textAnchor="end" className="quadrantTick">{value>0?"+":""}{value}</text></g>)}
            <line x1={x0} y1={margin.top} x2={x0} y2={margin.top+innerHeight} className="quadrantZero"/>
            <line x1={margin.left} y1={y0} x2={margin.left+innerWidth} y2={y0} className="quadrantZero"/>
            <text x={margin.left+innerWidth/2} y={height-24} textAnchor="middle" className="quadrantAxis">人口流动联系相对引力预期（标准化残差）</text>
            <text x="24" y={margin.top+innerHeight/2} textAnchor="middle" transform={`rotate(-90 24 ${margin.top+innerHeight/2})`} className="quadrantAxis">企业联系相对引力预期（综合标准化残差）</text>
            <text x={x0+12} y={margin.top+24} className="quadrantLabel">Ⅰ 人口流动、企业均超预期</text>
            <text x={x0+12} y={margin.top+innerHeight-14} className="quadrantLabel">Ⅱ 人口流动先导</text>
            <text x={margin.left+12} y={margin.top+innerHeight-14} className="quadrantLabel">Ⅲ 协同不足／边缘</text>
            <text x={margin.left+12} y={margin.top+24} className="quadrantLabel">Ⅳ 企业先导</text>
            {data.rows.map(row=><PointShape key={row.pair} row={row} x={x(row.population_flow_z)} y={y(row.enterprise_z)} size={3+5.5*Math.sqrt(row.absolute_composite)} selected={selected?.pair===row.pair} dimmed={!visiblePairs.has(row.pair)||(Boolean(selected)&&selected?.pair!==row.pair)} onSelect={()=>setSelected(row)} onHover={event=>hover(row,event)} onLeave={()=>setTooltip(null)}/>)}
            {selected&&<text x={x(selected.population_flow_z)+(x(selected.population_flow_z)>width-240?-13:13)} y={Math.max(margin.top+18,y(selected.enterprise_z)-13)} textAnchor={x(selected.population_flow_z)>width-240?"end":"start"} className="quadrantSelectedLabel">{selected.pair}</text>}
          </svg>
          {tooltip&&<div className="quadrantTooltip" style={{left:Math.min(tooltip.x+12,760),top:Math.max(8,tooltip.y-92)}}><strong>{tooltip.row.pair}</strong><span>{displayFunctionType(tooltip.row.function_type)} · {tooltip.row.absolute_level}绝对强度</span><span>人口流动残差 {signed(tooltip.row.population_flow_z)} · 企业联系残差 {signed(tooltip.row.enterprise_z)}</span><span>综合强度 {fmt(tooltip.row.absolute_composite*100,1)}分</span></div>}
        </div>
        <div className="quadrantLegend">
          {[1,2,3,4].map(value=><span key={value}><i className={`shape q${value}`} style={{background:colors[value]}}/>{shortQuadrant[value]} <b>{data.meta.quadrantCounts[String(value)]}</b></span>)}
          <span><i className="highRing"/>高绝对强度 <b>{data.meta.highAbsoluteCount}</b></span>
          <small>{axisMode==="密集展开"?"当前采用反双曲正弦坐标展开0值附近，保留正负方向和点的先后顺序。":"当前按标准化残差线性比例显示全部范围。"}</small>
        </div>
      </div>
      <aside className="quadrantRanking"><div className="cardHead"><div><h2>区县对综合强度排名</h2><p>按绝对综合强度降序</p></div></div><div className="ranking">{filtered.slice(0,14).map((row,index)=><button key={row.pair} className={selected?.pair===row.pair?"active":""} onClick={()=>setSelected(row)}><b>{String(index+1).padStart(2,"0")}</b><span><strong>{row.pair}</strong><small><i style={{background:colors[row.quadrant]}}/>{shortQuadrant[row.quadrant]} · {displayFunctionType(row.function_type)}</small></span><em>{fmt(row.absolute_composite*100,1)}</em></button>)}</div></aside>
    </section>

    <section className="quadrantModelStrip">
      <div><span>人口流动模型 R²</span><strong>{populationParam?.r2.toFixed(3)}</strong></div>
      <div><span>分支／投资／专利 R²</span><strong>{branchParam?.r2.toFixed(3)} / {investmentParam?.r2.toFixed(3)} / {patentParam?.r2.toFixed(3)}</strong></div>
      <div><span>企业综合权重</span><strong>{enterpriseWeight}</strong><small>分支／投资／专利</small></div>
      <p>横轴、纵轴均为控制人口规模、GDP规模和区县政府驻地双向驾车平均距离后的标准化残差；0轴表示模型预期。点越大，人口流动联系与企业联系的绝对综合强度越高。</p>
    </section>

    {selected&&<div className="quadrantDetail">
      <button onClick={()=>setSelected(null)} aria-label="关闭区县对详情">×</button>
      <span>{quadrantLabels[selected.quadrant]}</span><h3>{selected.pair}</h3><p>{selected.city_a}与{selected.city_b} · {selected.flow_type} · 双向驾车平均距离 {fmt(selected.distance_km,1)} km</p>
      <div className="quadrantVerdict"><strong>{displayFunctionType(selected.function_type)}</strong><small>{selected.absolute_level}绝对强度 · 综合得分 {fmt(selected.absolute_composite*100,1)}</small></div>
      <section><h4>人口流动联系</h4><div><strong>{fmt(selected.population_flow)}</strong><small>实际流动人口</small></div><div><strong>{fmt(selected.population_flow_expected)}</strong><small>模型预期流动人口</small></div><div><strong>{signed(selected.population_flow_z)}</strong><small>标准化残差</small></div></section>
      <section><h4>企业联系</h4><div><strong>{fmt(selected.branch)}</strong><small>分支／预期 {fmt(selected.branch_expected)}</small></div><div><strong>{fmt(selected.investment)}</strong><small>投资／预期 {fmt(selected.investment_expected)}</small></div><div><strong>{fmt(selected.patent)}</strong><small>专利／预期 {fmt(selected.patent_expected)}</small></div><em>企业综合残差 {signed(selected.enterprise_z)}</em></section>
    </div>}
    <div className="quadrantNote">数据源：{data.meta.sourceFolder}／{data.meta.source}；距离源：{data.meta.distanceSource||"区县政府驾车OD"}。区县对为无向组合；{data.meta.distanceDefinition||"距离取两个方向驾车里程的算术平均值"}。</div>
  </section>;
}
