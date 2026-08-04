"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { exportMapPng, numericLegend } from "./map-export";
import LocationTreePicker, { buildLocationTree } from "./location-tree";
import DynamicMapLabels, { MapLabelCandidate, mapDisplayName } from "../thematic/map-labels";
import RegionalPerformance, { buildRegionPerformance } from "./regional-performance";
import useFujianBackdrop from "../thematic/fujian-backdrop";

type CountyRecord=[string,string,string,string,number,number];
type TownRecord=[string,string,string,string,string,string,number,number];
type BoundaryFeature={properties:{city:string;name:string;code:string};geometry:{type:"MultiPolygon";coordinates:any[]}};
type TownBoundaryFeature={properties:{city:string;county:string;town:string;center:[number,number]};geometry:{type:"MultiPolygon";coordinates:any[]}};
type PopulationPayload={
  meta:{source:string;generatedAt:string;unit:string;rawRows:number;positiveRows:number;validRows:number;excludedNonPositive:number;excludedIncomplete:number;excludedSameTown?:number;excludedSameTownPopulation?:number;fallbackTownNames:number;withinCountyPopulation:number;rule:string};
  countyCenters:Record<string,[number,number]>;
  townCenters:Record<string,[number,number]>;
  countyBoundaries:{type:"FeatureCollection";features:BoundaryFeature[]};
  countyRecords:CountyRecord[];
  townRecords:TownRecord[];
};
type TownBoundaryPayload={type:"FeatureCollection";features:TownBoundaryFeature[]};
type GovernmentCenters={county:Record<string,[number,number]>;township:Record<string,[number,number]>};
type PopulationFlow={key:string;oc:string;o:string;ot:string;dc:string;d:string;dt:string;population:number;rows:number};

const fmt=(value:number,digits=0)=>new Intl.NumberFormat("zh-CN",{maximumFractionDigits:digits}).format(value);
const colors=["#b8d8d0","#79b7aa","#f0c66e","#e88a4d","#b93b35"];
const quantileBreaks=(values:number[])=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return [];return [.2,.4,.6,.8].map(q=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))])};
const strengthBand=(value:number,breaks:number[])=>{if(!breaks.length||breaks.every(x=>x===breaks[0]))return 2;if(value<=breaks[0])return 0;if(value<=breaks[1])return 1;if(value<=breaks[2])return 2;if(value<=breaks[3])return 3;return 4};

function geometryPath(coordinates:any[],project:(point:[number,number])=>[number,number]){
  return coordinates.map((polygon:any)=>polygon.map((ring:any)=>ring.map((point:any,index:number)=>(index?"L":"M")+project(point).join(",")).join("")+"Z").join("")).join("");
}

export default function PopulationModule(){
  const [data,setData]=useState<PopulationPayload|null>(null);
  const [governmentCenters,setGovernmentCenters]=useState<GovernmentCenters|null>(null);
  const fujianBackdrop=useFujianBackdrop();
  const [townBoundaries,setTownBoundaries]=useState<TownBoundaryPayload|null>(null);
  const [level,setLevel]=useState<"城市"|"区县"|"镇街">("区县");
  const [scope,setScope]=useState<"全部"|"跨市"|"市内">("跨市");
  const [originCounty,setOriginCounty]=useState("ALL");
  const [destinationCounty,setDestinationCounty]=useState("ALL");
  const [profileRegion,setProfileRegion]=useState("");
  const [limit,setLimit]=useState(30);
  const [listPage,setListPage]=useState(1);
  const [selected,setSelected]=useState<PopulationFlow|null>(null);
  const [loadingTown,setLoadingTown]=useState(false);
  const [drillOpen,setDrillOpen]=useState(false);
  const [drillLimit,setDrillLimit]=useState(30);
  const [view,setView]=useState({x:0,y:0,k:1});
  const [drillView,setDrillView]=useState({x:0,y:0,k:1});
  const mapRef=useRef<SVGSVGElement|null>(null);
  const drillMapRef=useRef<SVGSVGElement|null>(null);
  const drag=useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
  const drillDrag=useRef<{x:number;y:number;vx:number;vy:number}|null>(null);

  useEffect(()=>{Promise.all([fetch("/data/population-flow.json").then(response=>response.json()),fetch("/data/government-centers.json").then(response=>response.json())]).then(([population,centers])=>{setData(population);setGovernmentCenters(centers)})},[]);
  useEffect(()=>{
    if(level!=="镇街"||townBoundaries||loadingTown)return;
    setLoadingTown(true);
    fetch("/data/township-boundaries.json").then(response=>response.json()).then(setTownBoundaries).finally(()=>setLoadingTown(false));
  },[level,townBoundaries,loadingTown]);
  useEffect(()=>{setSelected(null);setView({x:0,y:0,k:1})},[level,scope,originCounty,destinationCounty]);
  useEffect(()=>setListPage(1),[level,scope,originCounty,destinationCounty]);
  useEffect(()=>setDrillOpen(false),[selected?.key,level]);
  const openDrill=async()=>{
    setDrillOpen(true);setDrillLimit(30);setDrillView({x:0,y:0,k:1});
    if(townBoundaries||loadingTown)return;
    setLoadingTown(true);
    try{const response=await fetch("/data/township-boundaries.json");setTownBoundaries(await response.json())}
    finally{setLoadingTown(false)}
  };

  const locationTree=useMemo(()=>data?buildLocationTree([
    ...data.countyBoundaries.features.map(feature=>({city:feature.properties.city,county:feature.properties.name})),
    ...data.townRecords.flatMap(record=>[
      {city:record[0],county:record[1],town:record[2]},
      {city:record[3],county:record[4],town:record[5]}
    ])
  ]):[],[data]);
  const allFlows=useMemo<PopulationFlow[]>(()=>{
    if(!data)return [];
    if(level==="城市"){
      const grouped=new Map<string,PopulationFlow>();
      for(const record of data.countyRecords){if(record[0]===record[2])continue;const key=`${record[0]}→${record[2]}`,current=grouped.get(key)||{key,oc:record[0],o:record[0],ot:"",dc:record[2],d:record[2],dt:"",population:0,rows:0};current.population+=record[4];current.rows+=record[5];grouped.set(key,current)}
      return [...grouped.values()];
    }
    if(level==="区县")return data.countyRecords.map(record=>({key:`${record[0]}|${record[1]}→${record[2]}|${record[3]}`,oc:record[0],o:record[1],ot:"",dc:record[2],d:record[3],dt:"",population:record[4],rows:record[5]}));
    return data.townRecords.filter(record=>!(record[0]===record[3]&&record[1]===record[4]&&record[2]===record[5])).map(record=>({key:`${record[0]}|${record[1]}|${record[2]}→${record[3]}|${record[4]}|${record[5]}`,oc:record[0],o:record[1],ot:record[2],dc:record[3],d:record[4],dt:record[5],population:record[6],rows:record[7]}));
  },[data,level]);
  const flows=useMemo(()=>allFlows.filter(flow=>{
    if(scope==="跨市"&&flow.oc===flow.dc)return false;
    if(scope==="市内"&&flow.oc!==flow.dc)return false;
    const originKey=level==="城市"?flow.oc:level==="区县"?`${flow.oc}|${flow.o}`:`${flow.oc}|${flow.o}|${flow.ot}`;
    const destinationKey=level==="城市"?flow.dc:level==="区县"?`${flow.dc}|${flow.d}`:`${flow.dc}|${flow.d}|${flow.dt}`;
    if(originCounty!=="ALL"&&originKey!==originCounty)return false;
    if(destinationCounty!=="ALL"&&destinationKey!==destinationCounty)return false;
    return true;
  }).sort((a,b)=>b.population-a.population),[allFlows,scope,originCounty,destinationCounty,level]);
  const shown=limit===0?flows:flows.slice(0,limit);
  const renderFlows=[...shown].reverse();
  const breaks=quantileBreaks(shown.map(flow=>flow.population));
  const legend=numericLegend(colors,breaks,shown.map(flow=>flow.population),"人");
  const totalPopulation=flows.reduce((sum,flow)=>sum+flow.population,0);
  const crossCityPopulation=flows.reduce((sum,flow)=>sum+(flow.oc!==flow.dc?flow.population:0),0);
  const reverseSelected=selected?allFlows.find(flow=>flow.oc===selected.dc&&flow.o===selected.d&&flow.ot===selected.dt&&flow.dc===selected.oc&&flow.d===selected.o&&flow.dt===selected.ot):null;
  const pageSize=50;
  const listPageCount=Math.max(1,Math.ceil(flows.length/pageSize));
  const currentListPage=Math.min(listPage,listPageCount);
  const listFlows=flows.slice((currentListPage-1)*pageSize,currentListPage*pageSize);
  const allFlowMap=useMemo(()=>new Map(allFlows.map(flow=>[flow.key,flow])),[allFlows]);
  const reverseFor=(flow:PopulationFlow)=>allFlowMap.get(level==="城市"?`${flow.dc}→${flow.oc}`:level==="区县"?`${flow.dc}|${flow.d}→${flow.oc}|${flow.o}`:`${flow.dc}|${flow.d}|${flow.dt}→${flow.oc}|${flow.o}|${flow.ot}`);

  const mapGeometry=useMemo(()=>{
    if(!data)return null;
    const selectedCountyKeys=new Set([originCounty,destinationCounty].filter(value=>value!=="ALL").map(value=>value.split("|").slice(0,2).join("|")));
    const focusFeatures=selectedCountyKeys.size===2?data.countyBoundaries.features.filter(feature=>selectedCountyKeys.has(`${feature.properties.city}|${feature.properties.name}`)):data.countyBoundaries.features;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const feature of focusFeatures)for(const polygon of feature.geometry.coordinates)for(const ring of polygon)for(const point of ring){if(point[0]<minX)minX=point[0];if(point[0]>maxX)maxX=point[0];if(point[1]<minY)minY=point[1];if(point[1]>maxY)maxY=point[1]}
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2,cosLatitude=Math.cos(centerY*Math.PI/180),xSpan=Math.max((maxX-minX)*cosLatitude,.0001),ySpan=Math.max(maxY-minY,.0001),scale=Math.min(820/xSpan,500/ySpan)/1.08;
    const project=(point:[number,number]):[number,number]=>[450+(point[0]-centerX)*cosLatitude*scale,300-(point[1]-centerY)*scale];
    const counties=data.countyBoundaries.features.map(feature=>({...feature.properties,d:geometryPath(feature.geometry.coordinates,project)}));
    const countyCenters:Record<string,[number,number]>={};Object.entries(governmentCenters?.county||data.countyCenters).forEach(([key,point])=>countyCenters[key]=project(point));
    const cityCenterParts=new Map<string,[number,number][]>();Object.entries(governmentCenters?.county||data.countyCenters).forEach(([key,point])=>{const city=key.split("|")[0],items=cityCenterParts.get(city)||[];items.push(project(point));cityCenterParts.set(city,items)});
    const cityCenters:Record<string,[number,number]>={};cityCenterParts.forEach((items,city)=>cityCenters[city]=[items.reduce((sum,item)=>sum+item[0],0)/items.length,items.reduce((sum,item)=>sum+item[1],0)/items.length]);
    const towns=(townBoundaries?.features||[]).map(feature=>({...feature.properties,d:geometryPath(feature.geometry.coordinates,project),point:project(feature.properties.center)}));
    const townCenters:Record<string,[number,number]>={};Object.entries({...data.townCenters,...(governmentCenters?.township||{})}).forEach(([key,point])=>townCenters[key]=project(point));
    const backdrop=fujianBackdrop.map(feature=>({...feature.properties,d:geometryPath(feature.geometry.coordinates,project)}));
    return{counties,countyCenters,cityCenters,towns,townCenters,backdrop};
  },[data,townBoundaries,originCounty,destinationCounty,governmentCenters,fujianBackdrop]);

  const drillFlows=useMemo<PopulationFlow[]>(()=>{
    if(!data||!selected||level!=="区县")return [];
    return data.townRecords.map(record=>({key:`${record[0]}|${record[1]}|${record[2]}→${record[3]}|${record[4]}|${record[5]}`,oc:record[0],o:record[1],ot:record[2],dc:record[3],d:record[4],dt:record[5],population:record[6],rows:record[7]})).filter(flow=>{
      const forward=flow.oc===selected.oc&&flow.o===selected.o&&flow.dc===selected.dc&&flow.d===selected.d;
      const backward=flow.oc===selected.dc&&flow.o===selected.d&&flow.dc===selected.oc&&flow.d===selected.o;
      return forward||backward;
    }).sort((a,b)=>b.population-a.population);
  },[data,selected,level]);
  const displayedDrillFlows=drillLimit===0?drillFlows:drillFlows.slice(0,drillLimit);
  const drillBreaks=quantileBreaks(displayedDrillFlows.map(flow=>flow.population));
  const drillLegend=numericLegend(colors,drillBreaks,displayedDrillFlows.map(flow=>flow.population),"人");
  const drillRenderFlows=[...displayedDrillFlows].reverse();
  const drillTotals=drillFlows.reduce((result,flow)=>({population:result.population+flow.population,rows:result.rows+flow.rows,links:result.links+1}),{population:0,rows:0,links:0});
  const drillLabelKeys=new Set(drillFlows.slice(0,18).flatMap(flow=>[`${flow.oc}|${flow.o}|${flow.ot}`,`${flow.dc}|${flow.d}|${flow.dt}`]));
  const drillGeometry=useMemo(()=>{
    if(!data||!selected||!townBoundaries||level!=="区县")return null;
    const selectedCountyKeys=new Set([`${selected.oc}|${selected.o}`,`${selected.dc}|${selected.d}`]);
    const focusFeatures=data.countyBoundaries.features.filter(feature=>selectedCountyKeys.has(`${feature.properties.city}|${feature.properties.name}`));
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const feature of focusFeatures)for(const polygon of feature.geometry.coordinates)for(const ring of polygon)for(const point of ring){if(point[0]<minX)minX=point[0];if(point[0]>maxX)maxX=point[0];if(point[1]<minY)minY=point[1];if(point[1]>maxY)maxY=point[1]}
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2,cosLatitude=Math.cos(centerY*Math.PI/180),xSpan=Math.max((maxX-minX)*cosLatitude,.0001),ySpan=Math.max(maxY-minY,.0001),scale=Math.min(820/xSpan,440/ySpan)/1.08;
    const project=(point:[number,number]):[number,number]=>[450+(point[0]-centerX)*cosLatitude*scale,260-(point[1]-centerY)*scale];
    const counties=data.countyBoundaries.features.map(feature=>({...feature.properties,d:geometryPath(feature.geometry.coordinates,project)}));
    const towns=townBoundaries.features.filter(feature=>selectedCountyKeys.has(`${feature.properties.city}|${feature.properties.county}`)).map(feature=>({...feature.properties,d:geometryPath(feature.geometry.coordinates,project)}));
    const townCenters:Record<string,[number,number]>={};Object.entries({...data.townCenters,...(governmentCenters?.township||{})}).forEach(([key,point])=>{const parts=key.split("|");if(selectedCountyKeys.has(`${parts[0]}|${parts[1]}`))townCenters[key]=project(point)});
    const backdrop=fujianBackdrop.map(feature=>({...feature.properties,d:geometryPath(feature.geometry.coordinates,project)}));
    return{counties,towns,townCenters,backdrop};
  },[data,selected,townBoundaries,level,governmentCenters,fujianBackdrop]);

  const centerFor=(flow:PopulationFlow,side:"o"|"d")=>{
    if(!mapGeometry)return undefined;
    const city=side==="o"?flow.oc:flow.dc,county=side==="o"?flow.o:flow.d,town=side==="o"?flow.ot:flow.dt;
    return level==="城市"?mapGeometry.cityCenters[city]:level==="区县"?mapGeometry.countyCenters[`${city}|${county}`]:mapGeometry.townCenters[`${city}|${county}|${town}`];
  };
  const drillCenterFor=(flow:PopulationFlow,side:"o"|"d")=>{
    if(!drillGeometry)return undefined;
    const city=side==="o"?flow.oc:flow.dc,county=side==="o"?flow.o:flow.d,town=side==="o"?flow.ot:flow.dt;
    return drillGeometry.townCenters[`${city}|${county}|${town}`];
  };
  const labelCandidates=useMemo<MapLabelCandidate[]>(()=>shown.flatMap((flow,index)=>(["o","d"] as const).map(side=>{const city=side==="o"?flow.oc:flow.dc,county=side==="o"?flow.o:flow.d,town=side==="o"?flow.ot:flow.dt,point=centerFor(flow,side),name=level==="城市"?city:level==="区县"?county:town,key=level==="城市"?city:level==="区县"?`${city}|${county}`:`${city}|${county}|${town}`;return{key,name,point:point!,priority:shown.length-index,selected:Boolean(selected&&(key===(level==="城市"?selected.oc:`${selected.oc}|${selected.o}${level==="镇街"?`|${selected.ot}`:""}`)||key===(level==="城市"?selected.dc:`${selected.dc}|${selected.d}${level==="镇街"?`|${selected.dt}`:""}`)))}})).filter(item=>Boolean(item.point)),[shown,mapGeometry,level,selected]);
  const drillLabelCandidates=useMemo<MapLabelCandidate[]>(()=>displayedDrillFlows.flatMap((flow,index)=>(["o","d"] as const).map(side=>{const city=side==="o"?flow.oc:flow.dc,county=side==="o"?flow.o:flow.d,town=side==="o"?flow.ot:flow.dt;return{key:`${city}|${county}|${town}`,name:town,point:drillCenterFor(flow,side)!,priority:displayedDrillFlows.length-index}})).filter(item=>Boolean(item.point)),[displayedDrillFlows,drillGeometry]);
  const zoom=(factor:number)=>setView(current=>{const k=Math.min(5,Math.max(1,current.k*factor));return k===1?{x:0,y:0,k}:{x:450-(450-current.x)*k/current.k,y:300-(300-current.y)*k/current.k,k}});
  useEffect(()=>{const element=mapRef.current;if(!element)return;const onWheel=(event:WheelEvent)=>{event.preventDefault();event.stopPropagation();const factor=event.deltaY<0?1.18:1/1.18;setView(current=>{const k=Math.min(5,Math.max(1,current.k*factor));return k===1?{x:0,y:0,k}:{x:450-(450-current.x)*k/current.k,y:300-(300-current.y)*k/current.k,k}})};element.addEventListener("wheel",onWheel,{passive:false});return()=>element.removeEventListener("wheel",onWheel)},[data,level]);
  const onPointerDown=(event:React.PointerEvent<SVGSVGElement>)=>{event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,y:event.clientY,vx:view.x,vy:view.y}};
  const onPointerMove=(event:React.PointerEvent<SVGSVGElement>)=>{if(!drag.current)return;const box=event.currentTarget.getBoundingClientRect(),scale=900/box.width;setView(current=>({...current,x:drag.current!.vx+(event.clientX-drag.current!.x)*scale,y:drag.current!.vy+(event.clientY-drag.current!.y)*scale}))};
  const onPointerUp=()=>{drag.current=null};
  const zoomDrill=(factor:number)=>setDrillView(current=>{const k=Math.min(5,Math.max(1,current.k*factor));return k===1?{x:0,y:0,k}:{x:450-(450-current.x)*k/current.k,y:260-(260-current.y)*k/current.k,k}});
  useEffect(()=>{const element=drillMapRef.current;if(!element||!drillOpen)return;const wheel=(event:WheelEvent)=>{event.preventDefault();event.stopPropagation();zoomDrill(event.deltaY<0?1.18:1/1.18)};element.addEventListener("wheel",wheel,{passive:false});return()=>element.removeEventListener("wheel",wheel)},[drillOpen,loadingTown]);
  const onDrillPointerDown=(event:React.PointerEvent<SVGSVGElement>)=>{event.currentTarget.setPointerCapture(event.pointerId);drillDrag.current={x:event.clientX,y:event.clientY,vx:drillView.x,vy:drillView.y}};
  const onDrillPointerMove=(event:React.PointerEvent<SVGSVGElement>)=>{if(!drillDrag.current)return;const ratio=900/event.currentTarget.getBoundingClientRect().width;setDrillView(current=>({...current,x:drillDrag.current!.vx+(event.clientX-drillDrag.current!.x)*ratio,y:drillDrag.current!.vy+(event.clientY-drillDrag.current!.y)*ratio}))};
  const onDrillPointerUp=()=>{drillDrag.current=null};

  if(!data||!mapGeometry)return <section className="populationLoading">正在载入人口流动数据…</section>;
  const topFlow=flows[0];
  const endpointLabel=(flow:PopulationFlow,side:"o"|"d")=>mapDisplayName(level==="城市"?(side==="o"?flow.oc:flow.dc):level==="区县"?(side==="o"?flow.o:flow.d):(side==="o"?flow.ot:flow.dt));
  const scopeTitle=scope==="跨市"?"跨市":scope==="市内"?"市内":"全域";
  const selectedLocationName=(value:string,allLabel:string)=>value==="ALL"?allLabel:(value.split("|")[level==="城市"?0:level==="区县"?1:2]||value);
  const originLabel=selectedLocationName(originCounty,"全部起点"),destinationLabel=selectedLocationName(destinationCounty,"全部终点");
  const mapTitle=`厦漳泉${scopeTitle}${level}人口流向图`;
  const mapSubtitle=`${originLabel} → ${destinationLabel} · ${limit===0?`全部 ${flows.length} 条 OD`:`人口流量前 ${Math.min(limit,flows.length)} 条 OD`}`;
  const drillMapTitle=selected?`${selected.o}—${selected.d}镇街人口流动图`:"镇街人口流动图";
  const drillMapSubtitle=selected?`${selected.oc}与${selected.dc} · 双向 ${drillFlows.length} 条镇街 OD`:"";
  const performanceRows=buildRegionPerformance(flows,flow=>level==="城市"?flow.oc:level==="区县"?flow.o:flow.ot,flow=>flow.population);
  const activeProfile=performanceRows.some(row=>row.name===profileRegion)?profileRegion:(performanceRows[0]?.name||"");

  return <section className="populationModule">
    <section className="populationControls">
      <label>分析层级<select value={level} onChange={event=>{const next=event.target.value as "城市"|"区县"|"镇街";setLevel(next);if(next==="城市")setScope("跨市");setOriginCounty("ALL");setDestinationCounty("ALL")}}><option>城市</option><option>区县</option><option>镇街</option></select></label>
      <label>联系范围<select value={scope} onChange={event=>setScope(event.target.value as "全部"|"跨市"|"市内")}><option value="全部">全部联系</option><option value="跨市">仅跨市联系</option><option value="市内">仅市内联系</option></select></label>
      <LocationTreePicker label={`起点${level}`} level={level} value={originCounty} onChange={setOriginCounty} tree={locationTree} allLabel={`全部起点${level}`}/>
      <LocationTreePicker label={`终点${level}`} level={level} value={destinationCounty} onChange={setDestinationCounty} tree={locationTree} allLabel={`全部终点${level}`}/>
    </section>
    <section className="mapFirstStage"><section className="populationStats">
      <article><span>人口流量</span><strong>{fmt(totalPopulation)}</strong><small>人 · 当前筛选合计</small></article>
      <article><span>有效 OD</span><strong>{fmt(flows.length)}</strong><small>{level}方向</small></article>
      <article><span>跨市占比</span><strong>{totalPopulation?fmt(crossCityPopulation/totalPopulation*100,1):"0"}%</strong><small>按人口数量计算</small></article>
      <article><span>首位联系</span><strong className="populationTopName">{topFlow?`${endpointLabel(topFlow,"o")} → ${endpointLabel(topFlow,"d")}`:"暂无"}</strong><small>{topFlow?`${fmt(topFlow.population)} 人`:"当前筛选无记录"}</small></article>
    </section>
    <section className="populationWorkspace">
      <div className="populationMapCard"><div className="cardHead"><div><h2>{mapTitle}</h2><p>{mapSubtitle}；点击连线查看双向关系</p></div><div className="mapHeadActions"><select value={limit} onChange={event=>setLimit(+event.target.value)}><option value="30">前30</option><option value="60">前60</option><option value="120">前120</option><option value="200">前200</option><option value="0">全部</option></select><button onClick={()=>exportMapPng(mapRef.current,{title:mapTitle,subtitle:mapSubtitle,legendTitle:"人口流量分级",legend})}>导出 PNG</button></div></div>
        <div className="populationMapWrap">
          <svg ref={mapRef} viewBox="0 0 900 600" className="populationMap" role="img" aria-label={`可缩放、可拖动的厦漳泉${level}人口流动地图`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <defs><marker id="populationArrow" markerWidth={4/view.k} markerHeight={4/view.k} refX={3.8/view.k} refY={2/view.k} orient="auto" markerUnits="userSpaceOnUse"><path d={`M0,0 L${4/view.k},${2/view.k} L0,${4/view.k} Z`} fill="context-stroke"/></marker></defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <g aria-hidden="true">{mapGeometry.backdrop.map(feature=><path key={`fujian-${feature.code}`} d={feature.d} className="fujianPrefectureBackdrop"/>)}</g>
              <g>{mapGeometry.counties.map(feature=><path key={feature.code} d={feature.d} className="populationCounty"><title>{feature.city} · {feature.name}</title></path>)}</g>
              {level==="镇街"&&<g>{mapGeometry.towns.map(feature=><path key={`${feature.city}-${feature.county}-${feature.town}`} d={feature.d} className="populationTown"><title>{feature.city} · {feature.county} · {feature.town}</title></path>)}</g>}
              {level==="镇街"&&<g>{mapGeometry.counties.map(feature=><path key={`town-county-overlay-${feature.code}`} d={feature.d} className="townshipCountyOverlay"/>)}</g>}
              <g>{renderFlows.map(flow=>{const start=centerFor(flow,"o"),end=centerFor(flow,"d");if(!start||!end)return null;const band=strengthBand(flow.population,breaks),dx=end[0]-start[0],dy=end[1]-start[1],length=Math.max(1,Math.hypot(dx,dy)),bend=Math.min(46,Math.max(13,length*.13)),middleX=(start[0]+end[0])/2-dy/length*bend,middleY=(start[1]+end[1])/2+dx/length*bend,d=`M${start} Q${middleX},${middleY} ${end}`,width=[.55,.85,1.25,1.8,2.8][band];return <g key={flow.key} onPointerDown={event=>event.stopPropagation()} onClick={()=>setSelected(flow)}><path d={d} className="populationFlowHit" style={{strokeWidth:width+9}}/><path d={d} className="populationFlow" markerEnd="url(#populationArrow)" style={{stroke:colors[band],strokeWidth:width,opacity:.5+band*.1}}><title>{endpointLabel(flow,"o")} → {endpointLabel(flow,"d")}：{fmt(flow.population)}人</title></path></g>})}</g>
              <DynamicMapLabels candidates={labelCandidates} view={view} baseLimit={level==="镇街"?10:16}/>
            </g>
          </svg>
          <div className="mapTools"><button onClick={()=>zoom(1.25)} aria-label="放大人口地图">＋</button><button onClick={()=>zoom(.8)} aria-label="缩小人口地图">－</button><button onClick={()=>setView({x:0,y:0,k:1})} aria-label="重置人口地图">复位</button></div>
          <span className="mapHint">滚轮缩放 · 按住拖动</span>
          {level==="镇街"&&loadingTown&&<div className="populationMapLoading">正在载入镇街边界…</div>}
        </div>
        <div className="populationLegend numericLegend"><strong>人口流量分级</strong>{legend.map(item=><span className="legendItem" key={`${item.color}-${item.label}`}><i style={{background:item.color}}/>{item.label}</span>)}</div>
      </div>
      <aside className="populationRanking"><div className="cardHead"><div><h2>人口 OD 排名</h2><p>按人口数量降序</p></div></div><div className="ranking">{shown.slice(0,12).map((flow,index)=><button key={flow.key} onClick={()=>setSelected(flow)}><b>{String(index+1).padStart(2,"0")}</b><span><strong>{endpointLabel(flow,"o")} → {endpointLabel(flow,"d")}</strong><small>{flow.oc} · {flow.dc}</small></span><em>{fmt(flow.population)}</em></button>)}</div></aside>
    </section></section>
    <RegionalPerformance title={`${level}人口流动表现`} rows={performanceRows} selected={activeProfile} onSelect={setProfileRegion} unit="人" rankBasis="对外流动总量"/>
    <section className="populationOdList">
      <div className="populationOdHead"><div><h2>人口流动 OD 列表</h2><p>沿用当前筛选条件，按人口数量降序，共 {fmt(flows.length)} 条</p></div><div className="populationPagination"><button disabled={currentListPage<=1} onClick={()=>setListPage(page=>Math.max(1,page-1))}>上一页</button><span>第 {currentListPage} / {listPageCount} 页</span><button disabled={currentListPage>=listPageCount} onClick={()=>setListPage(page=>Math.min(listPageCount,page+1))}>下一页</button></div></div>
      {listFlows.length===0?<div className="populationOdEmpty">当前筛选条件下没有人口流动记录。</div>:<div className="populationOdTable"><div className="populationOdTableHead"><span>序号</span><span>O端</span><span>方向</span><span>D端</span><span>人口数量</span><span>反向人口</span><span>净流量差</span></div>{listFlows.map((flow,index)=>{const reverse=reverseFor(flow),difference=flow.population-(reverse?.population||0);return <button key={`list-${flow.key}`} onClick={()=>setSelected(flow)}><b>{String((currentListPage-1)*pageSize+index+1).padStart(3,"0")}</b><div><strong>{endpointLabel(flow,"o")}</strong><small>{flow.oc}{level==="镇街"?` · ${flow.o}`:""}</small></div><i>→</i><div><strong>{endpointLabel(flow,"d")}</strong><small>{flow.dc}{level==="镇街"?` · ${flow.d}`:""}</small></div><em>{fmt(flow.population)}</em><span>{fmt(reverse?.population||0)}</span><span className={difference>=0?"positive":"negative"}>{difference>0?"+":""}{fmt(difference)}</span></button>})}</div>}
    </section>
    {selected&&<div className="populationDetail"><button onClick={()=>setSelected(null)}>×</button><span>{level}人口双向关系详情</span><h3>{endpointLabel(selected,"o")} ⇄ {endpointLabel(selected,"d")}</h3><p>{selected.oc} {selected.o} 与 {selected.dc} {selected.d}</p><section><h4>{endpointLabel(selected,"o")} → {endpointLabel(selected,"d")}</h4><div><strong>{fmt(selected.population)}</strong><small>人口数量（人）</small></div><div><strong>{fmt(selected.rows)}</strong><small>源记录数</small></div></section><section><h4>{endpointLabel(selected,"d")} → {endpointLabel(selected,"o")}</h4><div><strong>{fmt(reverseSelected?.population||0)}</strong><small>人口数量（人）</small></div><div><strong>{fmt(reverseSelected?.rows||0)}</strong><small>源记录数</small></div></section><div className="populationNet"><strong>{fmt(Math.abs(selected.population-(reverseSelected?.population||0)))}</strong><span>{selected.population>=(reverseSelected?.population||0)?`${endpointLabel(selected,"o")}相对净流出差`:`${endpointLabel(selected,"o")}相对净流入差`}</span></div>{level==="区县"&&<div className="populationDrillAction"><button onClick={openDrill}>查看两区县镇街人口联系</button><small>同时展示两个方向</small></div>}</div>}
    {drillOpen&&selected&&level==="区县"&&<div className="townOverlay" role="dialog" aria-modal="true" aria-label={`${selected.o}与${selected.d}镇街人口联系`} onMouseDown={()=>setDrillOpen(false)}>
      <section className="townPanel populationTownPanel" onMouseDown={event=>event.stopPropagation()}>
        <button className="townClose" onClick={()=>setDrillOpen(false)} aria-label="关闭镇街人口联系">×</button>
        <div className="townHeader"><span>人口流动 · 镇街级联系</span><h2>{selected.o} ⇄ {selected.d}</h2><p>{selected.oc} 与 {selected.dc} · 同时展示两个方向</p></div>
        {loadingTown?<div className="townState townLoadingState">正在载入镇街边界…</div>:drillGeometry?<>
          <div className="townNetworkMap">
            <div className="townMapCaption"><div><strong>{drillMapTitle}</strong><span>{drillMapSubtitle}；等比例投影并自动聚焦两区县</span></div><div className="mapHeadActions"><small>按当前联系动态分级</small><button onClick={()=>exportMapPng(drillMapRef.current,{title:drillMapTitle,subtitle:drillMapSubtitle,legendTitle:"人口流量分级",legend:drillLegend})}>导出 PNG</button></div></div>
            <svg ref={drillMapRef} viewBox="0 0 900 520" role="img" aria-label={`${selected.o}与${selected.d}镇街人口流动地图`} onPointerDown={onDrillPointerDown} onPointerMove={onDrillPointerMove} onPointerUp={onDrillPointerUp} onPointerCancel={onDrillPointerUp}>
              <defs><marker id="populationDrillArrow" markerWidth={4/drillView.k} markerHeight={4/drillView.k} refX={3.8/drillView.k} refY={2/drillView.k} orient="auto" markerUnits="userSpaceOnUse"><path d={`M0,0 L${4/drillView.k},${2/drillView.k} L0,${4/drillView.k} Z`} fill="context-stroke"/></marker></defs><g transform={`translate(${drillView.x} ${drillView.y}) scale(${drillView.k})`}>
              <g aria-hidden="true">{drillGeometry.backdrop.map(feature=><path key={`drill-fujian-${feature.code}`} d={feature.d} className="fujianPrefectureBackdrop"/>)}</g>
              <g>{drillGeometry.counties.map(feature=><path key={`population-county-${feature.code}`} d={feature.d} className="townCountyBackground"><title>{feature.city} · {feature.name}</title></path>)}</g>
              <g>{drillGeometry.towns.map(feature=>{const sideA=feature.city===selected.oc&&feature.county===selected.o;return <path key={`${feature.city}-${feature.county}-${feature.town}`} d={feature.d} className={`townBoundary selected ${sideA?"sideA":"sideB"}`}><title>{feature.city} · {feature.county} · {feature.town}</title></path>})}</g>
              <g>{drillRenderFlows.map(flow=>{const start=drillCenterFor(flow,"o"),end=drillCenterFor(flow,"d");if(!start||!end)return null;const band=strengthBand(flow.population,drillBreaks),dx=end[0]-start[0],dy=end[1]-start[1],length=Math.max(1,Math.hypot(dx,dy)),bend=Math.min(24,Math.max(8,length*.1)),middleX=(start[0]+end[0])/2-dy/length*bend,middleY=(start[1]+end[1])/2+dx/length*bend,d=`M${start} Q${middleX},${middleY} ${end}`;return <path key={flow.key} d={d} className="townFlow" markerEnd="url(#populationDrillArrow)" style={{stroke:colors[band],strokeWidth:[.45,.7,1,1.5,2.3][band],opacity:.5+band*.1}}><title>{flow.ot} → {flow.dt}：{fmt(flow.population)}人</title></path>})}</g>
              <DynamicMapLabels candidates={drillLabelCandidates} view={drillView} baseLimit={16}/></g>
            </svg><div className="mapTools"><button onClick={()=>zoomDrill(1.25)}>＋</button><button onClick={()=>zoomDrill(.8)}>－</button><button onClick={()=>setDrillView({x:0,y:0,k:1})}>复位</button></div>
            <div className="townMapLegend"><span><i className="sideA"/>{selected.o}</span><span><i className="sideB"/>{selected.d}</span><span className="townStrengthLegend">{drillLegend.map(item=><span className="legendItem" key={`${item.color}-${item.label}`}><i style={{background:item.color}}/>{item.label}</span>)}</span></div>
          </div>
          <div className="townSummary"><article><span>镇街联系</span><strong>{fmt(drillTotals.links)}</strong><small>个双向OD组合</small></article><article><span>人口流量</span><strong>{fmt(drillTotals.population)}</strong><small>人</small></article><article><span>源记录</span><strong>{fmt(drillTotals.rows)}</strong><small>条</small></article></div>
          <div className="townToolbar"><div><strong>镇街人口联系明细</strong><span>按人口数量降序，共 {drillFlows.length} 条</span></div><div className="townToggle"><select value={drillLimit} onChange={event=>setDrillLimit(+event.target.value)}><option value="30">前30</option><option value="60">前60</option><option value="120">前120</option><option value="200">前200</option><option value="0">全部</option></select></div></div>
          {drillFlows.length===0?<div className="townState">这两个区县之间没有镇街人口流动记录。</div>:<div className="townTable"><div className="townTableHead"><span>序号</span><span>O端镇街</span><span>方向</span><span>D端镇街</span><span>人口数量</span><span>源记录数</span></div>{displayedDrillFlows.map((flow,index)=><article key={flow.key}><b>{String(index+1).padStart(2,"0")}</b><div><strong>{mapDisplayName(flow.ot)}</strong><small>{flow.oc} · {flow.o}</small></div><i>→</i><div><strong>{mapDisplayName(flow.dt)}</strong><small>{flow.dc} · {flow.d}</small></div><em>{fmt(flow.population)}</em><div className="townValue"><strong>{fmt(flow.rows)}</strong><small>条源记录</small></div></article>)}</div>}
          <div className="townNote">行政区名称直接采用源文件字段；人口数量为所选两个区县全部有效镇街OD记录汇总。</div>
        </>:<div className="townState error">镇街边界读取失败，请刷新页面后重试。</div>}
      </section>
    </div>}
    <div className="populationNote">数据源：{data.meta.source}；有效正值记录 {fmt(data.meta.validRows)} 条。行政区代码未参与统计，O/D 地市、区县和镇街均按源文件名称直接汇总；{fmt(data.meta.fallbackTownNames)} 个边界中无同名镇街仅使用所属区县中心定位。</div>
  </section>;
}
