"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { exportMapPng, numericLegend } from "../contact-network/map-export";
import LocationTreePicker, { buildLocationTree } from "../contact-network/location-tree";

type TrafficRecord=[string,string,string,string,number,number,number,number,number];
type BoundaryFeature={properties:{city:string;name:string;code:string};geometry:{type:"MultiPolygon";coordinates:any[]}};
type NodeStat={city:string;county:string;avgTime:number;avgDistance:number;avgToll:number;coverage90:number;coverage120:number;rank:number};
type Payload={meta:{source:string;nodeCount:number;directedOdCount:number;pairCount:number;distanceDefinition:string};governmentCenters:Record<string,[number,number]>;countyBoundaries:{features:BoundaryFeature[]};records:TrafficRecord[];nodeStats:NodeStat[]};
type Flow={key:string;oc:string;o:string;dc:string;d:string;time:number;distance:number;toll:number};
type Metric="time"|"distance"|"toll";

const fmt=(value:number,digits=0)=>new Intl.NumberFormat("zh-CN",{maximumFractionDigits:digits}).format(value);
const colors=["#2f8f70","#79b7aa","#f0c66e","#e88a4d","#b93b35"];
const quantileBreaks=(values:number[])=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return [];return [.2,.4,.6,.8].map(q=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))])};
const band=(value:number,breaks:number[])=>{if(!breaks.length||breaks.every(x=>x===breaks[0]))return 2;if(value<=breaks[0])return 0;if(value<=breaks[1])return 1;if(value<=breaks[2])return 2;if(value<=breaks[3])return 3;return 4};
const geometryPath=(coordinates:any[],project:(point:[number,number])=>[number,number])=>coordinates.map((polygon:any)=>polygon.map((ring:any)=>ring.map((point:any,index:number)=>(index?"L":"M")+project(point).join(",")).join("")+"Z").join("")).join("");

export default function TransportAccessibilityModule(){
  const [data,setData]=useState<Payload|null>(null);
  const [scope,setScope]=useState<"全部"|"跨市"|"市内">("全部");
  const [metric,setMetric]=useState<Metric>("time");
  const [origin,setOrigin]=useState("ALL");
  const [destination,setDestination]=useState("ALL");
  const [limit,setLimit]=useState(30);
  const [selected,setSelected]=useState<Flow|null>(null);
  const [view,setView]=useState({x:0,y:0,k:1});
  const mapRef=useRef<SVGSVGElement|null>(null);
  const drag=useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
  useEffect(()=>{fetch("/data/transport-accessibility.json").then(response=>response.json()).then(setData)},[]);
  useEffect(()=>{setSelected(null);setView({x:0,y:0,k:1})},[scope,metric,origin,destination]);

  const tree=useMemo(()=>data?buildLocationTree(data.countyBoundaries.features.map(feature=>({city:feature.properties.city,county:feature.properties.name}))):[],[data]);
  const allFlows=useMemo<Flow[]>(()=>data?data.records.map(row=>({key:`${row[0]}|${row[1]}→${row[2]}|${row[3]}`,oc:row[0],o:row[1],dc:row[2],d:row[3],time:row[5],distance:row[7],toll:row[8]})):[],[data]);
  const valueFor=(flow:Flow)=>metric==="time"?flow.time:metric==="distance"?flow.distance:flow.toll;
  const flows=useMemo(()=>allFlows.filter(flow=>{
    if(scope==="跨市"&&flow.oc===flow.dc)return false;
    if(scope==="市内"&&flow.oc!==flow.dc)return false;
    if(origin!=="ALL"&&`${flow.oc}|${flow.o}`!==origin)return false;
    if(destination!=="ALL"&&`${flow.dc}|${flow.d}`!==destination)return false;
    return true;
  }).sort((a,b)=>valueFor(a)-valueFor(b)),[allFlows,scope,origin,destination,metric]);
  const shown=limit===0?flows:flows.slice(0,limit), renderFlows=[...shown].reverse();
  const breaks=quantileBreaks(shown.map(valueFor));
  const unit=metric==="time"?"分钟":metric==="distance"?"公里":"元";
  const metricName=metric==="time"?"驾车时间":metric==="distance"?"驾车距离":"过路费";
  const legend=numericLegend(colors,breaks,shown.map(valueFor),unit,metric==="toll"?0:1);
  const reverse=selected?allFlows.find(flow=>flow.oc===selected.dc&&flow.o===selected.d&&flow.dc===selected.oc&&flow.d===selected.o):null;
  const average=(key:"time"|"distance"|"toll")=>flows.length?flows.reduce((sum,flow)=>sum+flow[key],0)/flows.length:0;
  const crossFastest=flows.find(flow=>flow.oc!==flow.dc);

  const geometry=useMemo(()=>{
    if(!data)return null;
    const selectedKeys=new Set([origin,destination].filter(value=>value!=="ALL"));
    const focus=selectedKeys.size===2?data.countyBoundaries.features.filter(feature=>selectedKeys.has(`${feature.properties.city}|${feature.properties.name}`)):data.countyBoundaries.features;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const feature of focus)for(const polygon of feature.geometry.coordinates)for(const ring of polygon)for(const point of ring){minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);minY=Math.min(minY,point[1]);maxY=Math.max(maxY,point[1])}
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2,cos=Math.cos(centerY*Math.PI/180),scale=Math.min(820/Math.max((maxX-minX)*cos,.0001),500/Math.max(maxY-minY,.0001))/1.08;
    const project=(point:[number,number]):[number,number]=>[450+(point[0]-centerX)*cos*scale,300-(point[1]-centerY)*scale];
    const counties=data.countyBoundaries.features.map(feature=>({...feature.properties,d:geometryPath(feature.geometry.coordinates,project)}));
    const centers:Record<string,[number,number]>={};Object.entries(data.governmentCenters).forEach(([key,point])=>centers[key]=project(point));
    return{counties,centers};
  },[data,origin,destination]);

  const zoom=(factor:number)=>setView(current=>{const k=Math.min(5,Math.max(1,current.k*factor));return k===1?{x:0,y:0,k}:{x:450-(450-current.x)*k/current.k,y:300-(300-current.y)*k/current.k,k}});
  useEffect(()=>{const element=mapRef.current;if(!element)return;const wheel=(event:WheelEvent)=>{event.preventDefault();zoom(event.deltaY<0?1.18:1/1.18)};element.addEventListener("wheel",wheel,{passive:false});return()=>element.removeEventListener("wheel",wheel)},[]);
  const onPointerDown=(event:React.PointerEvent<SVGSVGElement>)=>{event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,y:event.clientY,vx:view.x,vy:view.y}};
  const onPointerMove=(event:React.PointerEvent<SVGSVGElement>)=>{if(!drag.current)return;const ratio=900/event.currentTarget.getBoundingClientRect().width;setView(current=>({...current,x:drag.current!.vx+(event.clientX-drag.current!.x)*ratio,y:drag.current!.vy+(event.clientY-drag.current!.y)*ratio}))};
  const onPointerUp=()=>{drag.current=null};
  if(!data||!geometry)return <section className="trafficLoading">正在载入交通可达性数据…</section>;

  const scopeTitle=scope==="跨市"?"跨市":scope==="市内"?"市内":"全域";
  const mapTitle=`厦漳泉区县政府驻地${scopeTitle}${metricName}图`;
  const mapSubtitle=`${origin==="ALL"?"全部起点":origin.split("|")[1]} → ${destination==="ALL"?"全部终点":destination.split("|")[1]} · ${limit===0?`全部 ${flows.length} 条 OD`:`${metricName}最低的 ${Math.min(limit,flows.length)} 条 OD`}`;

  return <section className="trafficModule">
    <section className="trafficControls">
      <label>联系范围<select value={scope} onChange={event=>setScope(event.target.value as typeof scope)}><option value="全部">全部联系</option><option value="跨市">仅跨市联系</option><option value="市内">仅市内联系</option></select></label>
      <label>评价指标<select value={metric} onChange={event=>setMetric(event.target.value as Metric)}><option value="time">驾车时间</option><option value="distance">驾车距离</option><option value="toll">过路费</option></select></label>
      <LocationTreePicker label="起点区县" level="区县" value={origin} onChange={setOrigin} tree={tree} allLabel="全部起点区县"/>
      <LocationTreePicker label="终点区县" level="区县" value={destination} onChange={setDestination} tree={tree} allLabel="全部终点区县"/>
    </section>
    <section className="populationStats trafficStats">
      <article><span>平均驾车时间</span><strong>{fmt(average("time"),1)}</strong><small>分钟 · 当前筛选</small></article>
      <article><span>平均驾车距离</span><strong>{fmt(average("distance"),1)}</strong><small>公里 · 当前筛选</small></article>
      <article><span>90分钟可达</span><strong>{fmt(flows.filter(flow=>flow.time<=90).length)}</strong><small>{flows.length?`${fmt(flows.filter(flow=>flow.time<=90).length/flows.length*100,1)}%`:`0%`} · 当前 OD</small></article>
      <article><span>最快跨市联系</span><strong className="populationTopName">{crossFastest?`${crossFastest.o} → ${crossFastest.d}`:"暂无"}</strong><small>{crossFastest?`${fmt(crossFastest.time,1)} 分钟 · ${fmt(crossFastest.distance,1)} 公里`:"当前筛选无记录"}</small></article>
    </section>
    <section className="populationWorkspace">
      <div className="populationMapCard"><div className="cardHead"><div><h2>{mapTitle}</h2><p>{mapSubtitle}；绿色表示可达性较好，点击连线查看双向数据</p></div><div className="mapHeadActions"><select value={limit} onChange={event=>setLimit(+event.target.value)}><option value="30">前30</option><option value="60">前60</option><option value="120">前120</option><option value="200">前200</option><option value="0">全部</option></select><button onClick={()=>exportMapPng(mapRef.current,{title:mapTitle,subtitle:mapSubtitle,legendTitle:`${metricName}分级`,legend})}>导出 PNG</button></div></div>
        <div className="populationMapWrap"><svg ref={mapRef} viewBox="0 0 900 600" className="populationMap" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} role="img" aria-label="厦漳泉区县政府驾车可达性地图">
          <defs><marker id="trafficArrow" markerWidth="4" markerHeight="4" refX="3.8" refY="2" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L4,2 L0,4 Z" fill="context-stroke"/></marker></defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}><g>{geometry.counties.map(feature=><path key={feature.code} d={feature.d} className="populationCounty"><title>{feature.city} · {feature.name}</title></path>)}</g>
          <g>{renderFlows.map(flow=>{const start=geometry.centers[`${flow.oc}|${flow.o}`],end=geometry.centers[`${flow.dc}|${flow.d}`];if(!start||!end)return null;const grade=band(valueFor(flow),breaks),dx=end[0]-start[0],dy=end[1]-start[1],length=Math.max(1,Math.hypot(dx,dy)),bend=Math.min(42,Math.max(12,length*.12)),mx=(start[0]+end[0])/2-dy/length*bend,my=(start[1]+end[1])/2+dx/length*bend,d=`M${start} Q${mx},${my} ${end}`;return <g key={flow.key} onPointerDown={event=>event.stopPropagation()} onClick={()=>setSelected(flow)}><path d={d} className="populationFlowHit" style={{strokeWidth:10}}/><path d={d} className="populationFlow" markerEnd="url(#trafficArrow)" style={{stroke:colors[grade],strokeWidth:[2.5,2,1.55,1.15,.8][grade],opacity:.82}}><title>{flow.o} → {flow.d}：{fmt(valueFor(flow),1)} {unit}</title></path></g>})}</g>
          <g>{shown.slice(0,14).flatMap(flow=>[[flow.oc,flow.o],[flow.dc,flow.d]]).map(([city,county],index)=>{const point=geometry.centers[`${city}|${county}`];return point?<text key={`${city}-${county}-${index}`} x={point[0]+4} y={point[1]-4}>{county}</text>:null})}</g></g>
        </svg><div className="mapTools"><button onClick={()=>zoom(1.25)}>＋</button><button onClick={()=>zoom(.8)}>－</button><button onClick={()=>setView({x:0,y:0,k:1})}>复位</button></div><span className="mapHint">滚轮缩放 · 按住拖动</span></div>
        <div className="populationLegend numericLegend"><strong>{metricName}分级</strong>{legend.map(item=><span className="legendItem" key={item.label}><i style={{background:item.color}}/>{item.label}</span>)}</div>
      </div>
      <aside className="populationRanking"><div className="cardHead"><div><h2>{metricName}排名</h2><p>数值越低，可达性越好</p></div></div><div className="ranking">{shown.slice(0,12).map((flow,index)=><button key={flow.key} onClick={()=>setSelected(flow)}><b>{String(index+1).padStart(2,"0")}</b><span><strong>{flow.o} → {flow.d}</strong><small>{flow.oc} · {flow.dc}</small></span><em>{fmt(valueFor(flow),1)}</em></button>)}</div></aside>
    </section>
    {selected&&<div className="populationDetail trafficDetail"><button onClick={()=>setSelected(null)}>×</button><span>区县政府驻地双向驾车详情</span><h3>{selected.o} ⇄ {selected.d}</h3><p>{selected.oc} 与 {selected.dc}</p>{[[selected,`${selected.o} → ${selected.d}`],[reverse,`${selected.d} → ${selected.o}`]].map(([item,title])=><section key={String(title)}><h4>{title as string}</h4>{item?<><div><strong>{fmt((item as Flow).time,1)}</strong><small>分钟</small></div><div><strong>{fmt((item as Flow).distance,1)}</strong><small>公里</small></div><div><strong>{fmt((item as Flow).toll)}</strong><small>过路费（元）</small></div></>:<div><small>未找到反向记录</small></div>}</section>)}</div>}
    <div className="populationNote">数据源：{data.meta.source}；共 {fmt(data.meta.nodeCount)} 个区县政府驻地、{fmt(data.meta.directedOdCount)} 条非自身有向 OD。联系象限使用的距离口径：{data.meta.distanceDefinition}。</div>
  </section>;
}
