"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { exportMapPng, numericLegend } from "../mapkit/map-export";
import LocationTreePicker, { buildLocationTree } from "../contact-network/location-tree";
import DynamicMapLabels, { MapLabelCandidate, mapDisplayName } from "../mapkit/map-labels";
import RegionalPerformance, { buildRegionPerformance } from "../contact-network/regional-performance";
import useFujianBackdrop from "../mapkit/fujian-backdrop";

type CountyTrafficRecord=[string,string,string,string,number,number,number,number,number];
type TownshipTrafficRecord=[string,string,string,string,string,string,number,number,number,number,number];
type BoundaryFeature={properties:{city:string;name?:string;code?:string;county?:string;town?:string};geometry:{type:"MultiPolygon";coordinates:any[]}};
type NodeStat={city:string;county:string;town?:string;avgTime:number;avgDistance:number;avgToll:number;coverage90:number;coverage120?:number;coverage60?:number;rank:number};
type Payload={meta:{source:string;level?:string;nodeCount:number;directedOdCount:number;expectedDirectedOdCount?:number;pairCount:number;incompletePairCount?:number;boundaryCount?:number;odNodeBoundaryCount?:number;distanceDefinition:string};governmentCenters:Record<string,[number,number]>;countyBoundaries:{features:BoundaryFeature[]};townshipBoundaries?:{features:BoundaryFeature[]};records:(CountyTrafficRecord|TownshipTrafficRecord)[];nodeStats:NodeStat[];incompletePairs?:string[][]};
type Flow={key:string;oc:string;oCounty:string;o:string;dc:string;dCounty:string;d:string;time:number;distance:number;toll:number};
type Metric="time"|"distance"|"toll";
type Level="城市"|"区县"|"镇街";

const fmt=(value:number,digits=0)=>new Intl.NumberFormat("zh-CN",{maximumFractionDigits:digits}).format(value);
const colors=["#2f8f70","#79b7aa","#f0c66e","#e88a4d","#b93b35"];
const quantileBreaks=(values:number[])=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return [];return [.2,.4,.6,.8].map(q=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))])};
const band=(value:number,breaks:number[])=>{if(!breaks.length||breaks.every(x=>x===breaks[0]))return 2;if(value<=breaks[0])return 0;if(value<=breaks[1])return 1;if(value<=breaks[2])return 2;if(value<=breaks[3])return 3;return 4};
const geometryPath=(coordinates:any[],project:(point:[number,number])=>[number,number])=>coordinates.map((polygon:any)=>polygon.map((ring:any)=>ring.map((point:any,index:number)=>(index?"L":"M")+project(point).join(",")).join("")+"Z").join("")).join("");

export default function TransportAccessibilityModule({toolbar}:{toolbar?:ReactNode}){
  const fujianBackdrop=useFujianBackdrop();
  const [data,setData]=useState<Payload|null>(null);
  const [level,setLevel]=useState<Level>("区县");
  const [scope,setScope]=useState<"全部"|"跨市"|"市内">("跨市");
  const [metric,setMetric]=useState<Metric>("time");
  const [origin,setOrigin]=useState("ALL");
  const [destination,setDestination]=useState("ALL");
  const [profileRegion,setProfileRegion]=useState("");
  const [limit,setLimit]=useState(30);
  const [selected,setSelected]=useState<Flow|null>(null);
  const [drillOpen,setDrillOpen]=useState(false);
  const [drillLimit,setDrillLimit]=useState(30);
  const [drillData,setDrillData]=useState<Payload|null>(null);
  const [drillLoading,setDrillLoading]=useState(false);
  const [view,setView]=useState({x:0,y:0,k:1.1});
  const [drillView,setDrillView]=useState({x:0,y:0,k:1});
  const mapRef=useRef<SVGSVGElement|null>(null);
  const drag=useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
  const drillMapRef=useRef<SVGSVGElement|null>(null);
  const drillDrag=useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
  useEffect(()=>{setData(null);fetch(level==="镇街"?"/data/transport-accessibility-township.json":"/data/transport-accessibility.json").then(response=>response.json()).then(setData)},[level]);
  useEffect(()=>{setOrigin("ALL");setDestination("ALL");setSelected(null);setView({x:0,y:0,k:1.1});setLimit(30)},[level]);
  useEffect(()=>{setSelected(null);setDrillOpen(false);setView({x:0,y:0,k:1.1})},[scope,metric,origin,destination]);

  const openDrill=async()=>{setDrillOpen(true);setDrillLimit(30);setDrillView({x:0,y:0,k:1});if(drillData||drillLoading)return;setDrillLoading(true);try{const response=await fetch("/data/transport-accessibility-township.json");setDrillData(await response.json())}finally{setDrillLoading(false)}};

  const tree=useMemo(()=>data?buildLocationTree(Object.keys(data.governmentCenters).map(key=>{const [city,county,town]=key.split("|");return{city,county,town}})):[],[data]);
  const allFlows=useMemo<Flow[]>(()=>{if(!data)return[];if(level==="城市"){const grouped=new Map<string,{oc:string;dc:string;time:number;distance:number;toll:number;n:number}>();for(const row of data.records as CountyTrafficRecord[]){const key=`${row[0]}→${row[2]}`,item=grouped.get(key)||{oc:row[0],dc:row[2],time:0,distance:0,toll:0,n:0};item.time+=row[5];item.distance+=row[7];item.toll+=row[8];item.n++;grouped.set(key,item)}return[...grouped.entries()].map(([key,item])=>({key,oc:item.oc,oCounty:item.oc,o:item.oc,dc:item.dc,dCounty:item.dc,d:item.dc,time:item.time/item.n,distance:item.distance/item.n,toll:item.toll/item.n}))}return data.records.map(row=>level==="区县"?{key:`${row[0]}|${row[1]}→${row[2]}|${row[3]}`,oc:row[0] as string,oCounty:row[1] as string,o:row[1] as string,dc:row[2] as string,dCounty:row[3] as string,d:row[3] as string,time:row[5] as number,distance:row[7] as number,toll:row[8] as number}:{key:`${row[0]}|${row[1]}|${row[2]}→${row[3]}|${row[4]}|${row[5]}`,oc:row[0] as string,oCounty:row[1] as string,o:row[2] as string,dc:row[3] as string,dCounty:row[4] as string,d:row[5] as string,time:row[7] as number,distance:row[9] as number,toll:row[10] as number})},[data,level]);
  const valueFor=(flow:Flow)=>metric==="time"?flow.time:metric==="distance"?flow.distance:flow.toll;
  const flows=useMemo(()=>allFlows.filter(flow=>{
    if(scope==="跨市"&&flow.oc===flow.dc)return false;
    if(scope==="市内"&&flow.oc!==flow.dc)return false;
    if(origin!=="ALL"&&(level==="城市"?flow.oc:`${flow.oc}|${flow.oCounty}${level==="镇街"?`|${flow.o}`:""}`)!==origin)return false;
    if(destination!=="ALL"&&(level==="城市"?flow.dc:`${flow.dc}|${flow.dCounty}${level==="镇街"?`|${flow.d}`:""}`)!==destination)return false;
    return true;
  }).sort((a,b)=>valueFor(a)-valueFor(b)),[allFlows,scope,origin,destination,metric]);
  const shown=limit===0?flows:flows.slice(0,limit), renderFlows=[...shown].reverse();
  const breaks=quantileBreaks(shown.map(valueFor));
  const unit=metric==="time"?"分钟":metric==="distance"?"公里":"元";
  const metricName=metric==="time"?"驾车时间":metric==="distance"?"驾车距离":"过路费";
  const legend=numericLegend(colors,breaks,shown.map(valueFor),unit,metric==="toll"?0:1);
  const reverse=selected?allFlows.find(flow=>flow.key!==selected.key&&flow.oc===selected.dc&&flow.oCounty===selected.dCounty&&flow.o===selected.d&&flow.dc===selected.oc&&flow.dCounty===selected.oCounty&&flow.d===selected.o):null;
  const average=(key:"time"|"distance"|"toll")=>flows.length?flows.reduce((sum,flow)=>sum+flow[key],0)/flows.length:0;
  const crossFastest=flows.find(flow=>flow.oc!==flow.dc);
  const drillFlows=useMemo<Flow[]>(()=>{
    if(!drillData||!selected||level!=="区县")return[];
    return (drillData.records as TownshipTrafficRecord[]).map(row=>({key:`${row[0]}|${row[1]}|${row[2]}→${row[3]}|${row[4]}|${row[5]}`,oc:row[0],oCounty:row[1],o:row[2],dc:row[3],dCounty:row[4],d:row[5],time:row[7],distance:row[9],toll:row[10]})).filter(flow=>(flow.oc===selected.oc&&flow.oCounty===selected.oCounty&&flow.dc===selected.dc&&flow.dCounty===selected.dCounty)||(flow.oc===selected.dc&&flow.oCounty===selected.dCounty&&flow.dc===selected.oc&&flow.dCounty===selected.oCounty)).sort((a,b)=>valueFor(a)-valueFor(b));
  },[drillData,selected,level,metric]);
  const displayedDrillFlows=drillLimit===0?drillFlows:drillFlows.slice(0,drillLimit);
  const drillBreaks=quantileBreaks(displayedDrillFlows.map(valueFor));
  const drillLegend=numericLegend(colors,drillBreaks,displayedDrillFlows.map(valueFor),metric==="time"?"分钟":metric==="distance"?"公里":"元",metric==="toll"?0:1);

  const geometry=useMemo(()=>{
    if(!data)return null;
    const selectedKeys=new Set([origin,destination].filter(value=>value!=="ALL"));
    const townshipFeatures=data.townshipBoundaries?.features||[];
    const boundaries=level==="镇街"?townshipFeatures:data.countyBoundaries.features;
    const featureKey=(feature:BoundaryFeature)=>level==="城市"?feature.properties.city:level==="镇街"?`${feature.properties.city}|${feature.properties.county}|${feature.properties.town}`:`${feature.properties.city}|${feature.properties.name}`;
    const focus=selectedKeys.size===2?boundaries.filter(feature=>selectedKeys.has(featureKey(feature)!)):boundaries;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const feature of focus)for(const polygon of feature.geometry.coordinates)for(const ring of polygon)for(const point of ring){minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);minY=Math.min(minY,point[1]);maxY=Math.max(maxY,point[1])}
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2,cos=Math.cos(centerY*Math.PI/180),scale=Math.min(820/Math.max((maxX-minX)*cos,.0001),500/Math.max(maxY-minY,.0001))/1.08;
    const project=(point:[number,number]):[number,number]=>[450+(point[0]-centerX)*cos*scale,300-(point[1]-centerY)*scale];
    const counties=data.countyBoundaries.features.map(feature=>({...feature.properties,key:`${feature.properties.city}|${feature.properties.name}`,label:feature.properties.name,d:geometryPath(feature.geometry.coordinates,project)}));
    const towns=level==="镇街"?townshipFeatures.map(feature=>({...feature.properties,key:featureKey(feature),label:feature.properties.town,d:geometryPath(feature.geometry.coordinates,project)})):[];
    const centers:Record<string,[number,number]>={},cityParts=new Map<string,[number,number][]>();Object.entries(data.governmentCenters).forEach(([key,point])=>{const projected=project(point),city=key.split("|")[0];centers[key]=projected;const items=cityParts.get(city)||[];items.push(projected);cityParts.set(city,items)});cityParts.forEach((items,city)=>centers[city]=[items.reduce((sum,item)=>sum+item[0],0)/items.length,items.reduce((sum,item)=>sum+item[1],0)/items.length]);
    cityParts.forEach((_items,city)=>centers[`${city}|${city}`]=centers[city]);
    const backdrop=fujianBackdrop.map(feature=>({...feature.properties,d:geometryPath(feature.geometry.coordinates,project)}));
    return{counties,towns,centers,backdrop};
  },[data,origin,destination,level,fujianBackdrop]);
  const drillGeometry=useMemo(()=>{
    if(!drillData||!selected||level!=="区县")return null;
    const countyKeys=new Set([`${selected.oc}|${selected.oCounty}`,`${selected.dc}|${selected.dCounty}`]);
    const countyFeatures=drillData.countyBoundaries.features.filter(feature=>countyKeys.has(`${feature.properties.city}|${feature.properties.name}`));
    const townFeatures=(drillData.townshipBoundaries?.features||[]).filter(feature=>countyKeys.has(`${feature.properties.city}|${feature.properties.county}`));
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const feature of countyFeatures)for(const polygon of feature.geometry.coordinates)for(const ring of polygon)for(const point of ring){minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);minY=Math.min(minY,point[1]);maxY=Math.max(maxY,point[1])}
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2,cos=Math.cos(centerY*Math.PI/180),scale=Math.min(820/Math.max((maxX-minX)*cos,.0001),440/Math.max(maxY-minY,.0001))/1.08,project=(point:[number,number]):[number,number]=>[450+(point[0]-centerX)*cos*scale,260-(point[1]-centerY)*scale];
    const counties=drillData.countyBoundaries.features.map(feature=>({...feature.properties,key:`${feature.properties.city}|${feature.properties.name}`,d:geometryPath(feature.geometry.coordinates,project)}));
    const towns=townFeatures.map(feature=>({...feature.properties,key:`${feature.properties.city}|${feature.properties.county}|${feature.properties.town}`,d:geometryPath(feature.geometry.coordinates,project)}));
    const centers:Record<string,[number,number]>={};Object.entries(drillData.governmentCenters).forEach(([key,point])=>{const parts=key.split("|");if(countyKeys.has(`${parts[0]}|${parts[1]}`))centers[key]=project(point)});const backdrop=fujianBackdrop.map(feature=>({...feature.properties,d:geometryPath(feature.geometry.coordinates,project)}));return{counties,towns,centers,backdrop};
  },[drillData,selected,level,fujianBackdrop]);
  useEffect(()=>{const svg=drillMapRef.current;if(!svg||!drillGeometry||!drillOpen)return;svg.querySelector(".trafficDrillLabels")?.remove();const ns="http://www.w3.org/2000/svg",group=document.createElementNS(ns,"g");group.setAttribute("class","mapDynamicLabels trafficDrillLabels");const endpoints=new Map<string,{name:string;point:[number,number]}>();for(const flow of displayedDrillFlows){for(const [city,county,name] of [[flow.oc,flow.oCounty,flow.o],[flow.dc,flow.dCounty,flow.d]] as string[][]){const key=`${city}|${county}|${name}`,point=drillGeometry.centers[key];if(point&&!endpoints.has(key))endpoints.set(key,{name,point})}}for(const {name,point} of [...endpoints.values()].slice(0,16)){const node=document.createElementNS(ns,"g"),circle=document.createElementNS(ns,"circle"),text=document.createElementNS(ns,"text");circle.setAttribute("cx",String(point[0]));circle.setAttribute("cy",String(point[1]));circle.setAttribute("r","2.5");text.setAttribute("x",String(point[0]+5));text.setAttribute("y",String(point[1]-5));text.textContent=mapDisplayName(name);node.append(circle,text);group.append(node)}svg.append(group);return()=>group.remove()},[drillGeometry,displayedDrillFlows,drillOpen]);
  const labelCandidates=useMemo<MapLabelCandidate[]>(()=>{if(!geometry)return[];return shown.flatMap((flow,index)=>[[flow.oc,flow.oCounty,flow.o],[flow.dc,flow.dCounty,flow.d]].map(([city,county,name])=>{const key=level==="城市"?city:`${city}|${county}${level==="镇街"?`|${name}`:""}`;return{key,name:level==="城市"?city:name,point:geometry.centers[key],priority:shown.length-index,selected:Boolean(selected&&(selected.oc===city||selected.dc===city))}})).filter(item=>Boolean(item.point)) as MapLabelCandidate[]},[shown,geometry,level,selected]);

  const zoom=(factor:number)=>setView(current=>{const k=Math.min(5,Math.max(1,current.k*factor));return k===1?{x:0,y:0,k}:{x:450-(450-current.x)*k/current.k,y:300-(300-current.y)*k/current.k,k}});
  useEffect(()=>{const element=mapRef.current;if(!element)return;const wheel=(event:WheelEvent)=>{event.preventDefault();event.stopPropagation();zoom(event.deltaY<0?1.18:1/1.18)};element.addEventListener("wheel",wheel,{passive:false});return()=>element.removeEventListener("wheel",wheel)},[data,level]);
  const onPointerDown=(event:React.PointerEvent<SVGSVGElement>)=>{event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,y:event.clientY,vx:view.x,vy:view.y}};
  const onPointerMove=(event:React.PointerEvent<SVGSVGElement>)=>{if(!drag.current)return;const ratio=900/event.currentTarget.getBoundingClientRect().width;setView(current=>({...current,x:drag.current!.vx+(event.clientX-drag.current!.x)*ratio,y:drag.current!.vy+(event.clientY-drag.current!.y)*ratio}))};
  const onPointerUp=()=>{drag.current=null};
  const zoomDrill=(factor:number)=>setDrillView(current=>{const k=Math.min(5,Math.max(1,current.k*factor));return k===1?{x:0,y:0,k}:{x:450-(450-current.x)*k/current.k,y:260-(260-current.y)*k/current.k,k}});
  useEffect(()=>{const element=drillMapRef.current;if(!element||!drillOpen)return;const wheel=(event:WheelEvent)=>{event.preventDefault();event.stopPropagation();zoomDrill(event.deltaY<0?1.18:1/1.18)};element.addEventListener("wheel",wheel,{passive:false});return()=>element.removeEventListener("wheel",wheel)},[drillOpen,drillLoading]);
  useEffect(()=>{const element=drillMapRef.current;if(!element||!drillOpen)return;element.style.transformOrigin="center";element.style.transform=`translate(${drillView.x/4}px,${drillView.y/4}px) scale(${drillView.k})`;element.style.transition=drillDrag.current?"none":"transform .12s ease-out"},[drillView,drillOpen,drillLoading]);
  useEffect(()=>{const element=drillMapRef.current;if(!element||!drillOpen)return;let start:{x:number;y:number;vx:number;vy:number}|null=null;const down=(event:PointerEvent)=>{element.setPointerCapture(event.pointerId);start={x:event.clientX,y:event.clientY,vx:0,vy:0}};const move=(event:PointerEvent)=>{if(!start)return;setDrillView(current=>({...current,x:start!.vx+(event.clientX-start!.x)*4,y:start!.vy+(event.clientY-start!.y)*4}))};const up=()=>{start=null};const reset=()=>setDrillView({x:0,y:0,k:1});element.addEventListener("pointerdown",down);element.addEventListener("pointermove",move);element.addEventListener("pointerup",up);element.addEventListener("pointercancel",up);element.addEventListener("dblclick",reset);return()=>{element.removeEventListener("pointerdown",down);element.removeEventListener("pointermove",move);element.removeEventListener("pointerup",up);element.removeEventListener("pointercancel",up);element.removeEventListener("dblclick",reset)}},[drillOpen,drillLoading]);
  const onDrillPointerDown=(event:React.PointerEvent<SVGSVGElement>)=>{event.currentTarget.setPointerCapture(event.pointerId);drillDrag.current={x:event.clientX,y:event.clientY,vx:drillView.x,vy:drillView.y}};
  const onDrillPointerMove=(event:React.PointerEvent<SVGSVGElement>)=>{if(!drillDrag.current)return;const ratio=900/event.currentTarget.getBoundingClientRect().width;setDrillView(current=>({...current,x:drillDrag.current!.vx+(event.clientX-drillDrag.current!.x)*ratio,y:drillDrag.current!.vy+(event.clientY-drillDrag.current!.y)*ratio}))};
  const onDrillPointerUp=()=>{drillDrag.current=null};
  if(!data||!geometry)return <section className="trafficLoading">正在载入交通可达性数据…</section>;

  const scopeTitle=scope==="跨市"?"跨市":scope==="市内"?"市内":"全域";
  const locationLabel=(value:string,allLabel:string)=>value==="ALL"?allLabel:value.split("|").at(-1)!;
  const mapTitle=`厦漳泉${level}政府驻地${scopeTitle}${metricName}图`;
  const mapSubtitle=`${locationLabel(origin,"全部起点")} → ${locationLabel(destination,"全部终点")} · ${limit===0?`全部 ${flows.length} 条 OD`:`${metricName}最低的 ${Math.min(limit,flows.length)} 条 OD`}`;
  const performanceRows=buildRegionPerformance(flows,flow=>level==="城市"?flow.oc:level==="区县"?flow.oCounty:flow.o,valueFor,true);
  const activeProfile=performanceRows.some(row=>row.name===profileRegion)?profileRegion:(performanceRows[0]?.name||"");

  return <section className="trafficModule">
    <div className="moduleTopRow">{toolbar}<section className="trafficControls">
      <label>分析层级<select value={level} onChange={event=>{const next=event.target.value as Level;setLevel(next);if(next==="城市")setScope("跨市")}}><option value="城市">城市总体</option><option value="区县">区县政府驻地</option><option value="镇街">乡镇街政府驻地</option></select></label>
      <label>联系范围<select value={scope} onChange={event=>setScope(event.target.value as typeof scope)}><option value="全部">全部联系</option><option value="跨市">仅跨市联系</option><option value="市内">仅市内联系</option></select></label>
      <label>评价指标<select value={metric} onChange={event=>setMetric(event.target.value as Metric)}><option value="time">驾车时间</option><option value="distance">驾车距离</option><option value="toll">过路费</option></select></label>
      <LocationTreePicker label={`起点${level}`} level={level} value={origin} onChange={setOrigin} tree={tree} allLabel={`全部起点${level}`}/>
      <LocationTreePicker label={`终点${level}`} level={level} value={destination} onChange={setDestination} tree={tree} allLabel={`全部终点${level}`}/>
    </section></div>
    <section className="mapFirstStage"><section className="populationStats trafficStats">
      <article><span>平均驾车时间</span><strong>{fmt(average("time"),1)}</strong><small>分钟 · 当前筛选</small></article>
      <article><span>平均驾车距离</span><strong>{fmt(average("distance"),1)}</strong><small>公里 · 当前筛选</small></article>
      <article><span>90分钟可达</span><strong>{fmt(flows.filter(flow=>flow.time<=90).length)}</strong><small>{flows.length?`${fmt(flows.filter(flow=>flow.time<=90).length/flows.length*100,1)}%`:`0%`} · 当前 OD</small></article>
      <article><span>最快跨市联系</span><strong className="populationTopName">{crossFastest?`${crossFastest.o} → ${crossFastest.d}`:"暂无"}</strong><small>{crossFastest?`${fmt(crossFastest.time,1)} 分钟 · ${fmt(crossFastest.distance,1)} 公里`:"当前筛选无记录"}</small></article>
    </section>
    <section className="populationWorkspace">
      <div className="populationMapCard"><div className="cardHead"><div><h2>{mapTitle}</h2><p>{mapSubtitle}；绿色表示可达性较好，点击连线查看双向数据</p></div><div className="mapHeadActions"><select value={limit} onChange={event=>setLimit(+event.target.value)}><option value="30">前30</option><option value="60">前60</option><option value="120">前120</option><option value="200">前200</option><option value="0">全部</option></select><button onClick={()=>exportMapPng(mapRef.current,{title:mapTitle,subtitle:mapSubtitle,legendTitle:`${metricName}分级`,legend})}>导出 PNG</button></div></div>
        <div className="populationMapWrap"><svg ref={mapRef} viewBox="0 0 900 600" className="populationMap" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} role="img" aria-label={`厦漳泉${level}政府驾车可达性地图`}>
          <defs><marker id="trafficArrow" markerWidth={4/view.k} markerHeight={4/view.k} refX={3.8/view.k} refY={2/view.k} orient="auto" markerUnits="userSpaceOnUse"><path d={`M0,0 L${4/view.k},${2/view.k} L0,${4/view.k} Z`} fill="context-stroke"/></marker></defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}><g aria-hidden="true">{geometry.backdrop.map(feature=><path key={`fujian-${feature.code}`} d={feature.d} className="fujianPrefectureBackdrop"/>)}</g><g>{geometry.counties.map(feature=><path key={feature.key} d={feature.d} className="populationCounty"><title>{feature.city} · {feature.name}</title></path>)}</g>
          {level==="镇街"&&<g>{geometry.towns.map(feature=><path key={feature.key} d={feature.d} className="populationTown"><title>{feature.city} · {feature.county} · {feature.town}</title></path>)}</g>}
          {level==="镇街"&&<g>{geometry.counties.map(feature=><path key={`town-county-overlay-${feature.key}`} d={feature.d} className="townshipCountyOverlay"/>)}</g>}
          <g>{renderFlows.map(flow=>{const startKey=`${flow.oc}|${flow.oCounty}${level==="镇街"?`|${flow.o}`:""}`,endKey=`${flow.dc}|${flow.dCounty}${level==="镇街"?`|${flow.d}`:""}`,start=geometry.centers[startKey],end=geometry.centers[endKey];if(!start||!end)return null;const grade=band(valueFor(flow),breaks),dx=end[0]-start[0],dy=end[1]-start[1];let d;if(dx===0&&dy===0){d=`M${start[0]},${start[1]} C${start[0]+26},${start[1]-38} ${start[0]+34},${start[1]+14} ${start[0]+10},${start[1]+4}`}else{const length=Math.max(1,Math.hypot(dx,dy)),bend=Math.min(42,Math.max(12,length*.12)),mx=(start[0]+end[0])/2-dy/length*bend,my=(start[1]+end[1])/2+dx/length*bend;d=`M${start} Q${mx},${my} ${end}`}return <g key={flow.key} onPointerDown={event=>event.stopPropagation()} onClick={()=>setSelected(flow)}><path d={d} className="populationFlowHit" style={{strokeWidth:10}}/><path d={d} className="populationFlow" markerEnd="url(#trafficArrow)" style={{stroke:colors[grade],strokeWidth:[2.5,2,1.55,1.15,.8][grade],opacity:.82}}><title>{flow.o} → {flow.d}：{fmt(valueFor(flow),1)} {unit}</title></path></g>})}</g>
          <DynamicMapLabels candidates={labelCandidates} view={view} baseLimit={level==="镇街"?10:16}/></g>
        </svg><div className="mapTools"><button onClick={()=>zoom(1.25)}>＋</button><button onClick={()=>zoom(.8)}>－</button><button onClick={()=>setView({x:0,y:0,k:1.1})}>复位</button></div><span className="mapHint">滚轮缩放 · 按住拖动</span></div>
        <div className="populationLegend numericLegend"><strong>{metricName}分级</strong>{legend.map(item=><span className="legendItem" key={item.label}><i style={{background:item.color}}/>{item.label}</span>)}</div>
      </div>
      <aside className="populationRanking"><div className="cardHead"><div><h2>{metricName}排名</h2><p>数值越低，可达性越好</p></div></div><div className="ranking">{shown.slice(0,12).map((flow,index)=><button key={flow.key} onClick={()=>setSelected(flow)}><b>{String(index+1).padStart(2,"0")}</b><span><strong>{mapDisplayName(flow.o)} → {mapDisplayName(flow.d)}</strong><small>{level==="镇街"?`${flow.oCounty} · ${flow.dCounty}`:`${flow.oc} · ${flow.dc}`}</small></span><em>{fmt(valueFor(flow),1)}</em></button>)}</div></aside>
    </section></section>
    <RegionalPerformance title={`${level}${metricName}表现`} rows={performanceRows} selected={activeProfile} onSelect={setProfileRegion} unit={unit} digits={metric==="toll"?0:1} rankBasis={`平均${metricName}（越低越好）`}/>
    {selected&&<div className="populationDetail trafficDetail"><button onClick={()=>setSelected(null)}>×</button><span>{level}政府驻地双向驾车详情</span><h3>{mapDisplayName(selected.o)} ⇄ {mapDisplayName(selected.d)}</h3><p>{selected.oc}·{selected.oCounty} 与 {selected.dc}·{selected.dCounty}</p>{[[selected,`${mapDisplayName(selected.o)} → ${mapDisplayName(selected.d)}`],[reverse,`${mapDisplayName(selected.d)} → ${mapDisplayName(selected.o)}`]].map(([item,title])=><section key={String(title)}><h4>{title as string}</h4>{item?<><div><strong>{fmt((item as Flow).time,1)}</strong><small>分钟</small></div><div><strong>{fmt((item as Flow).distance,1)}</strong><small>公里</small></div><div><strong>{fmt((item as Flow).toll)}</strong><small>过路费（元）</small></div></>:<div><small>未找到反向记录</small></div>}</section>)}{level==="区县"&&<div className="populationDrillAction"><button onClick={openDrill}>查看两区县镇街驾车联系</button><small>沿用当前评价指标，双向展示</small></div>}</div>}
    {drillOpen&&selected&&level==="区县"&&<div className="townOverlay" role="dialog" aria-modal="true" aria-label={`${selected.oCounty}与${selected.dCounty}镇街驾车联系`} onMouseDown={()=>setDrillOpen(false)}><section className="townPanel populationTownPanel" onMouseDown={event=>event.stopPropagation()}><button className="townClose" onClick={()=>setDrillOpen(false)}>×</button><div className="townHeader"><span>交通可达性 · 镇街级联系</span><h2>{selected.oCounty} ⇄ {selected.dCounty}</h2><p>{metricName}升序 · 同时展示两个方向</p></div>{drillLoading?<div className="townState townLoadingState">正在载入镇街驾车数据…</div>:drillGeometry?<><div className="townNetworkMap"><div className="townMapCaption"><div><strong>{selected.oCounty}—{selected.dCounty}镇街{metricName}图</strong><span>默认显示前30条，自动聚焦两区县</span></div><div className="mapHeadActions"><select value={drillLimit} onChange={event=>setDrillLimit(+event.target.value)}><option value="30">前30</option><option value="60">前60</option><option value="120">前120</option><option value="200">前200</option><option value="0">全部</option></select><button onClick={()=>exportMapPng(drillMapRef.current,{title:`${selected.oCounty}—${selected.dCounty}镇街${metricName}图`,subtitle:`${displayedDrillFlows.length} / ${drillFlows.length} 条镇街OD`,legendTitle:`${metricName}分级`,legend:drillLegend})}>导出 PNG</button></div></div><svg ref={drillMapRef} viewBox="0 0 900 520"><defs><marker id="trafficDrillArrow" markerWidth="4" markerHeight="4" refX="3.8" refY="2" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L4,2 L0,4 Z" fill="context-stroke"/></marker></defs><g>{drillGeometry.counties.map(feature=><path key={feature.key} d={feature.d} className="townCountyBackground"/>)}</g><g>{drillGeometry.towns.map(feature=><path key={feature.key} d={feature.d} className={`townBoundary selected ${feature.city===selected.oc&&feature.county===selected.oCounty?"sideA":"sideB"}`}/>)}</g><g>{[...displayedDrillFlows].reverse().map(flow=>{const start=drillGeometry.centers[`${flow.oc}|${flow.oCounty}|${flow.o}`],end=drillGeometry.centers[`${flow.dc}|${flow.dCounty}|${flow.d}`];if(!start||!end)return null;const grade=band(valueFor(flow),drillBreaks),dx=end[0]-start[0],dy=end[1]-start[1],length=Math.max(1,Math.hypot(dx,dy)),bend=Math.min(24,Math.max(8,length*.1)),mx=(start[0]+end[0])/2-dy/length*bend,my=(start[1]+end[1])/2+dx/length*bend;return <path key={flow.key} d={`M${start} Q${mx},${my} ${end}`} className="townFlow" markerEnd="url(#trafficDrillArrow)" style={{stroke:colors[grade],strokeWidth:[.45,.7,1,1.5,2.3][grade],opacity:.55+grade*.1}}/>})}</g></svg><div className="townMapLegend"><span><i className="sideA"/>{selected.oCounty}</span><span><i className="sideB"/>{selected.dCounty}</span><span className="townStrengthLegend">{drillLegend.map(item=><span className="legendItem" key={item.label}><i style={{background:item.color}}/>{item.label}</span>)}</span></div></div><div className="townToolbar"><div><strong>镇街驾车联系明细</strong><span>共 {drillFlows.length} 条，当前显示 {displayedDrillFlows.length} 条</span></div></div><div className="townTable"><div className="townTableHead"><span>序号</span><span>O端镇街</span><span>方向</span><span>D端镇街</span><span>{metricName}</span><span>距离 / 过路费</span></div>{displayedDrillFlows.map((flow,index)=><article key={flow.key}><b>{String(index+1).padStart(2,"0")}</b><div><strong>{flow.o}</strong><small>{flow.oc} · {flow.oCounty}</small></div><i>→</i><div><strong>{flow.d}</strong><small>{flow.dc} · {flow.dCounty}</small></div><em>{fmt(valueFor(flow),1)} {unit}</em><div className="townValue"><strong>{fmt(flow.distance,1)} km / {fmt(flow.toll)} 元</strong><small>{fmt(flow.time,1)} 分钟</small></div></article>)}</div></>:<div className="townState error">镇街驾车数据读取失败。</div>}</section></div>}
    <div className="populationNote">数据源：{data.meta.source}；共 {fmt(data.meta.nodeCount)} 个{level}政府驻地、{fmt(data.meta.directedOdCount)} 条非自身有向 OD。{level==="镇街"&&data.meta.boundaryCount?`底图完整显示 ${fmt(data.meta.boundaryCount)} 个乡镇街边界，其中 ${fmt(data.meta.odNodeBoundaryCount||data.meta.nodeCount)} 个具有政府驻地OD；`:""}{data.meta.incompletePairCount?`源数据有 ${fmt(data.meta.incompletePairCount)} 组同名跨区县镇街对缺少双向记录；`:""}{data.meta.distanceDefinition}。</div>
  </section>;
}
