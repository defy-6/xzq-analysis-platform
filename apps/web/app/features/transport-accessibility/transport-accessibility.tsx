"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { exportMapPng, exportWithLabelsOn, numericLegend } from "../mapkit/map-export";
import LocationTreePicker, { buildLocationTree } from "../contact-network/location-tree";
import DynamicMapLabels, { MapLabelCandidate, mapDisplayName } from "../mapkit/map-labels";
import MapDecorations from "../mapkit/map-scale";
import MapScaleOverlay from "../mapkit/map-scale-overlay";
const quadraticPoints=(p0:[number,number],p1:[number,number],c:[number,number],segments=5):[number,number][]=>{const out:[number,number][]=[];for(let i=0;i<=segments;i++){const t=i/segments,u=1-t;out.push([u*u*p0[0]+2*u*t*c[0]+t*t*p1[0],u*u*p0[1]+2*u*t*c[1]+t*t*p1[1]])}return out};
import RegionalPerformance, { buildRegionPerformance } from "../contact-network/regional-performance";
import useFujianBackdrop from "../mapkit/fujian-backdrop";

type CountyTrafficRecord=[string,string,string,string,number,number,number,number,number];
type TownshipTrafficRecord=[string,string,string,string,string,string,number,number,number,number,number];
type BoundaryFeature={properties:{city:string;name?:string;code?:string;county?:string;town?:string};geometry:{type:"MultiPolygon";coordinates:any[]}};
type NodeStat={city:string;county:string;town?:string;avgTime:number;avgDistance:number;avgToll:number;coverage90:number;coverage120?:number;coverage60?:number;rank:number};
type Payload={meta:{source:string;level?:string;nodeCount:number;directedOdCount:number;expectedDirectedOdCount?:number;pairCount:number;incompletePairCount?:number;boundaryCount?:number;odNodeBoundaryCount?:number;distanceDefinition:string};governmentCenters:Record<string,[number,number]>;countyBoundaries:{features:BoundaryFeature[]};townshipBoundaries?:{features:BoundaryFeature[]};records:(CountyTrafficRecord|TownshipTrafficRecord)[];nodeStats:NodeStat[];incompletePairs?:string[][];cityCenters?:Record<string,[number,number]>;cityRecords?:[string,string,number,number,number][];cityCountyAvgRecords?:[string,string,number,number,number][];cityTownAvgRecords?:[string,string,number,number,number][];countyRoutes?:Record<string,[number,number][]>};
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
  const [cityMetric,setCityMetric]=useState<"gov"|"countyAvg"|"townAvg">("gov");
  const [layerMode,setLayerMode]=useState<"od"|"route">("od");
  const [rankPage,setRankPage]=useState(0);
  const [labelsOn,setLabelsOn]=useState(true);
  const [drillLabelsOn,setDrillLabelsOn]=useState(true);
  const [destination,setDestination]=useState("ALL");
  const [profileRegion,setProfileRegion]=useState("");
  const [limit,setLimit]=useState(60);
  const [selected,setSelected]=useState<Flow|null>(null);
  const [drillOpen,setDrillOpen]=useState(false);
  const [drillLimit,setDrillLimit]=useState(60);
  const [drillData,setDrillData]=useState<Payload|null>(null);
  const [drillLoading,setDrillLoading]=useState(false);
  const [view,setView]=useState({x:0,y:0,k:1.1});
  const [drillView,setDrillView]=useState({x:0,y:0,k:1});
  const mapRef=useRef<SVGSVGElement|null>(null);
  const drag=useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
  const drillMapRef=useRef<SVGSVGElement|null>(null);
  const drillDrag=useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
  useEffect(()=>{setData(null);fetch(level==="镇街"?"/data/transport-accessibility-township.json":"/data/transport-accessibility.json").then(response=>response.json()).then(setData)},[level]);
  useEffect(()=>{setOrigin("ALL");setDestination("ALL");setSelected(null);setView({x:0,y:0,k:1.1});setLimit(60)},[level]);
  useEffect(()=>{setSelected(null);setDrillOpen(false);setView({x:0,y:0,k:1.1})},[scope,metric,origin,destination]);

  const openDrill=async()=>{setDrillOpen(true);setDrillLimit(60);setDrillView({x:0,y:0,k:1});if(drillData||drillLoading)return;setDrillLoading(true);try{const response=await fetch("/data/transport-accessibility-township.json");setDrillData(await response.json())}finally{setDrillLoading(false)}};

  const tree=useMemo(()=>data?buildLocationTree(Object.keys(data.governmentCenters).map(key=>{const [city,county,town]=key.split("|");return{city,county,town}})):[],[data]);
  const allFlows=useMemo<Flow[]>(()=>{if(!data)return[];if(level==="城市"){const rows=cityMetric==="gov"?data.cityRecords:cityMetric==="countyAvg"?data.cityCountyAvgRecords:data.cityTownAvgRecords;if(rows&&rows.length)return rows.map(row=>({key:`${row[0]}→${row[1]}`,oc:row[0],oCounty:row[0],o:row[0],dc:row[1],dCounty:row[1],d:row[1],time:row[2],distance:row[3],toll:row[4]}));const grouped=new Map<string,{oc:string;dc:string;time:number;distance:number;toll:number;n:number}>();for(const row of data.records as CountyTrafficRecord[]){const key=`${row[0]}→${row[2]}`,item=grouped.get(key)||{oc:row[0],dc:row[2],time:0,distance:0,toll:0,n:0};item.time+=row[5];item.distance+=row[7];item.toll+=row[8];item.n++;grouped.set(key,item)}return[...grouped.entries()].map(([key,item])=>({key,oc:item.oc,oCounty:item.oc,o:item.oc,dc:item.dc,dCounty:item.dc,d:item.dc,time:item.time/item.n,distance:item.distance/item.n,toll:item.toll/item.n}))}return data.records.map(row=>level==="区县"?{key:`${row[0]}|${row[1]}→${row[2]}|${row[3]}`,oc:row[0] as string,oCounty:row[1] as string,o:row[1] as string,dc:row[2] as string,dCounty:row[3] as string,d:row[3] as string,time:row[5] as number,distance:row[7] as number,toll:row[8] as number}:{key:`${row[0]}|${row[1]}|${row[2]}→${row[3]}|${row[4]}|${row[5]}`,oc:row[0] as string,oCounty:row[1] as string,o:row[2] as string,dc:row[3] as string,dCounty:row[4] as string,d:row[5] as string,time:row[7] as number,distance:row[9] as number,toll:row[10] as number})},[data,level,cityMetric]);
  const valueFor=(flow:Flow)=>metric==="time"?flow.time:metric==="distance"?flow.distance:flow.toll;
  const flows=useMemo(()=>allFlows.filter(flow=>{
    if(scope==="跨市"&&flow.oc===flow.dc)return false;
    if(scope==="市内"&&flow.oc!==flow.dc)return false;
    const originKey=level==="城市"?flow.oc:`${flow.oc}|${flow.oCounty}${level==="镇街"?`|${flow.o}`:""}`;
    const destinationKey=level==="城市"?flow.dc:`${flow.dc}|${flow.dCounty}${level==="镇街"?`|${flow.d}`:""}`;
    if(origin!=="ALL"&&originKey!==origin&&!originKey.startsWith(`${origin}|`))return false;
    if(destination!=="ALL"&&destinationKey!==destination&&!destinationKey.startsWith(`${destination}|`))return false;
    return true;
  }).sort((a,b)=>valueFor(a)-valueFor(b)),[allFlows,scope,origin,destination,metric]);
  const shown=limit===0?flows:flows.slice(0,limit), renderFlows=[...shown].reverse();
  useEffect(()=>setRankPage(0),[shown.length,level,scope,metric,cityMetric,origin,destination,limit]);
  const breaks=quantileBreaks(shown.map(valueFor));
  const unit=metric==="time"?"分钟":metric==="distance"?"公里":"元";
  const metricName=metric==="time"?"驾车时间":metric==="distance"?"驾车距离":"过路费";
  const legend=numericLegend(colors,breaks,shown.map(valueFor),unit,metric==="toll"?0:1,[2.5,2,1.55,1.15,.8]);
  const reverse=selected?allFlows.find(flow=>flow.key!==selected.key&&flow.oc===selected.dc&&flow.oCounty===selected.dCounty&&flow.o===selected.d&&flow.dc===selected.oc&&flow.dCounty===selected.oCounty&&flow.d===selected.o):null;
  const orderedFlows=[...renderFlows].sort((a,b)=>{const sa=a.key===selected?.key||a.key===reverse?.key?1:0;const sb=b.key===selected?.key||b.key===reverse?.key?1:0;return sa-sb});
  const average=(key:"time"|"distance"|"toll")=>flows.length?flows.reduce((sum,flow)=>sum+flow[key],0)/flows.length:0;
  const crossFastest=flows.find(flow=>flow.oc!==flow.dc);
  const drillFlows=useMemo<Flow[]>(()=>{
    if(!drillData||!selected||level!=="区县")return[];
    return (drillData.records as TownshipTrafficRecord[]).map(row=>({key:`${row[0]}|${row[1]}|${row[2]}→${row[3]}|${row[4]}|${row[5]}`,oc:row[0],oCounty:row[1],o:row[2],dc:row[3],dCounty:row[4],d:row[5],time:row[7],distance:row[9],toll:row[10]})).filter(flow=>(flow.oc===selected.oc&&flow.oCounty===selected.oCounty&&flow.dc===selected.dc&&flow.dCounty===selected.dCounty)||(flow.oc===selected.dc&&flow.oCounty===selected.dCounty&&flow.dc===selected.oc&&flow.dCounty===selected.oCounty)).sort((a,b)=>valueFor(a)-valueFor(b));
  },[drillData,selected,level,metric]);
  const displayedDrillFlows=drillLimit===0?drillFlows:drillFlows.slice(0,drillLimit);
  const drillBreaks=quantileBreaks(displayedDrillFlows.map(valueFor));
  const drillLegend=numericLegend(colors,drillBreaks,displayedDrillFlows.map(valueFor),metric==="time"?"分钟":metric==="distance"?"公里":"元",metric==="toll"?0:1,[.45,.7,1,1.5,2.3]);

  const geometry=useMemo(()=>{
    if(!data)return null;
    const selectedKeys=new Set([origin,destination].filter(value=>value!=="ALL"));
    const townshipFeatures=data.townshipBoundaries?.features||[];
    const boundaries=level==="镇街"?townshipFeatures:data.countyBoundaries.features;
    const featureKey=(feature:BoundaryFeature)=>level==="城市"?feature.properties.city:level==="镇街"?`${feature.properties.city}|${feature.properties.county}|${feature.properties.town}`:`${feature.properties.city}|${feature.properties.name}`;
    const focus=selectedKeys.size===2?boundaries.filter(feature=>{const key=featureKey(feature);return key!=null&&[...selectedKeys].some(selected=>selected.indexOf("|")<0?feature.properties.city===selected:key===selected||key.startsWith(`${selected}|`))}):boundaries;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const feature of focus)for(const polygon of feature.geometry.coordinates)for(const ring of polygon)for(const point of ring){minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);minY=Math.min(minY,point[1]);maxY=Math.max(maxY,point[1])}
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2,cos=Math.cos(centerY*Math.PI/180),scale=Math.min(820/Math.max((maxX-minX)*cos,.0001),500/Math.max(maxY-minY,.0001))/1.08;
    const project=(point:[number,number]):[number,number]=>[450+(point[0]-centerX)*cos*scale,300-(point[1]-centerY)*scale];
    const cityNames=["厦门市","泉州市","漳州市"];
    const prefectureFeatures=level==="城市"?fujianBackdrop.filter(feature=>cityNames.includes(feature.properties.name)):[];
    const counties=(level==="城市"&&prefectureFeatures.length?prefectureFeatures:data.countyBoundaries.features).map(feature=>({...feature.properties,city:(feature.properties as any).city||feature.properties.name,key:feature.properties.name,label:feature.properties.name,d:geometryPath(feature.geometry.coordinates,project)}));
    const towns=level==="镇街"?townshipFeatures.map(feature=>({...feature.properties,key:featureKey(feature),label:feature.properties.town,d:geometryPath(feature.geometry.coordinates,project)})):[];
    const centers:Record<string,[number,number]>={},cityParts=new Map<string,[number,number][]>();Object.entries(data.governmentCenters).forEach(([key,point])=>{const projected=project(point),city=key.split("|")[0];centers[key]=projected;const items=cityParts.get(city)||[];items.push(projected);cityParts.set(city,items)});cityParts.forEach((items,city)=>centers[city]=[items.reduce((sum,item)=>sum+item[0],0)/items.length,items.reduce((sum,item)=>sum+item[1],0)/items.length]);
    if(data.cityCenters)Object.entries(data.cityCenters).forEach(([city,point])=>centers[city]=project(point));
    cityParts.forEach((_items,city)=>centers[`${city}|${city}`]=centers[city]);
    const backdrop=(level==="城市"?fujianBackdrop.filter(feature=>!cityNames.includes(feature.properties.name)):fujianBackdrop).map(feature=>({...feature.properties,d:geometryPath(feature.geometry.coordinates,project)}));
    const routePaths:string[]=[],allRoutePaths:string[]=[],allRoutePoints:[number,number][]=[],allRouteKeys:string[]=[];
    if(level==="区县"&&data.countyRoutes){
      const oParts=origin.split("|"),dParts=destination.split("|");
      const exactPair=oParts.length>=2&&dParts.length>=2&&oParts[0]!=="ALL"&&dParts[0]!=="ALL";
      if(exactPair){
        const forward=data.countyRoutes[`${oParts[0]}|${oParts[1]}|${dParts[0]}|${dParts[1]}`];
        const backward=data.countyRoutes[`${dParts[0]}|${dParts[1]}|${oParts[0]}|${oParts[1]}`];
        if(forward&&forward.length>=2)routePaths.push(forward.map((point,index)=>`${index?"L":"M"}${project(point as [number,number]).join(",")}`).join(""));
        if(backward&&backward.length>=2)routePaths.push(backward.map((point,index)=>`${index?"L":"M"}${project(point as [number,number]).join(",")}`).join(""));
      }
      const metricByKey=new Map<string,number>();
      for(const row of data.records as CountyTrafficRecord[]){metricByKey.set(`${row[0]}|${row[1]}|${row[2]}|${row[3]}`,metric==="time"?row[5] as number:metric==="distance"?row[7] as number:row[8] as number)}
      const routeEntries:{key:string;pts:[number,number][]}[]=[];
      for(const [key,pts] of Object.entries(data.countyRoutes)){
        const oc=key.split("|")[0],co=key.split("|")[1],dc=key.split("|")[2],cd=key.split("|")[3];
        if(scope==="跨市"&&oc===dc)continue;
        if(scope==="市内"&&oc!==dc)continue;
        if(origin!=="ALL"){const originKey=`${oc}|${co}`;if(originKey!==origin&&!originKey.startsWith(`${origin}|`))continue}
        if(destination!=="ALL"){const destinationKey=`${dc}|${cd}`;if(destinationKey!==destination&&!destinationKey.startsWith(`${destination}|`))continue}
        if(pts.length>=2)routeEntries.push({key,pts});
      }
      if(layerMode==="route"&&limit>0)routeEntries.sort((a,b)=>(metricByKey.get(a.key)??Infinity)-(metricByKey.get(b.key)??Infinity));
      const visibleRoutes=layerMode==="route"&&limit>0?routeEntries.slice(0,limit):routeEntries;
      for(const entry of visibleRoutes){const projected=entry.pts.map(point=>project(point as [number,number]));allRoutePaths.push(projected.map((point,index)=>`${index?"L":"M"}${point.join(",")}`).join(""));allRouteKeys.push(entry.key);for(const point of projected)allRoutePoints.push(point);}
    }
    return{counties,towns,centers,backdrop,kmPerPixel:111.32/(cos*scale),routePaths,allRoutePaths,allRoutePoints,allRouteKeys};
  },[data,origin,destination,level,fujianBackdrop,scope,metric,limit,layerMode]);
  const flowObstacles=useMemo<[number,number][]>(()=>{
    if(!geometry)return[];
    if(layerMode==="route")return geometry.allRoutePoints;
    const rows=limit===0?flows:flows.slice(0,limit);
    const out:[number,number][]=[];
    for(const flow of rows){
      const startKey=`${flow.oc}|${flow.oCounty}${level==="镇街"?`|${flow.o}`:""}`,endKey=`${flow.dc}|${flow.dCounty}${level==="镇街"?`|${flow.d}`:""}`;
      const start=geometry.centers[startKey],end=geometry.centers[endKey];
      if(!start||!end)continue;
      const dx=end[0]-start[0],dy=end[1]-start[1];
      if(dx===0&&dy===0){out.push(start);continue}
      const length=Math.max(1,Math.hypot(dx,dy)),bend=Math.min(42,Math.max(12,length*.12)),mx=(start[0]+end[0])/2-dy/length*bend,my=(start[1]+end[1])/2+dx/length*bend;
      for(const point of quadraticPoints(start,end,[mx,my]))out.push(point);
    }
    return out;
  },[geometry,layerMode,flows,limit,level]);
  const drillGeometry=useMemo(()=>{
    if(!drillData||!selected||level!=="区县")return null;
    const countyKeys=new Set([`${selected.oc}|${selected.oCounty}`,`${selected.dc}|${selected.dCounty}`]);
    const countyFeatures=drillData.countyBoundaries.features.filter(feature=>countyKeys.has(`${feature.properties.city}|${feature.properties.name}`));
    const townFeatures=(drillData.townshipBoundaries?.features||[]).filter(feature=>countyKeys.has(`${feature.properties.city}|${feature.properties.county}`));
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const feature of countyFeatures)for(const polygon of feature.geometry.coordinates)for(const ring of polygon)for(const point of ring){minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);minY=Math.min(minY,point[1]);maxY=Math.max(maxY,point[1])}
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2,cos=Math.cos(centerY*Math.PI/180),scale=Math.min(820/Math.max((maxX-minX)*cos,.0001),440/Math.max(maxY-minY,.0001))/1.08,project=(point:[number,number]):[number,number]=>[450+(point[0]-centerX)*cos*scale,260-(point[1]-centerY)*scale];
    const counties=drillData.countyBoundaries.features.map(feature=>({...feature.properties,key:`${feature.properties.city}|${feature.properties.name}`,d:geometryPath(feature.geometry.coordinates,project)}));
    const towns=townFeatures.map(feature=>({...feature.properties,key:`${feature.properties.city}|${feature.properties.county}|${feature.properties.town}`,d:geometryPath(feature.geometry.coordinates,project)}));
    const centers:Record<string,[number,number]>={};Object.entries(drillData.governmentCenters).forEach(([key,point])=>{const parts=key.split("|");if(countyKeys.has(`${parts[0]}|${parts[1]}`))centers[key]=project(point)});const backdrop=fujianBackdrop.map(feature=>({...feature.properties,d:geometryPath(feature.geometry.coordinates,project)}));return{counties,towns,centers,backdrop,kmPerPixel:111.32/(cos*scale)};
  },[drillData,selected,level,fujianBackdrop]);
  const drillLabelCandidates=useMemo<MapLabelCandidate[]>(()=>displayedDrillFlows.flatMap((flow,index)=>([[flow.oc,flow.oCounty,flow.o],[flow.dc,flow.dCounty,flow.d]] as string[][]).map(([city,county,name])=>{const clean=mapDisplayName(name),key=`${city}|${county}|${clean}`,point=drillGeometry?.centers[key];return{key,name:clean,point:point!,priority:displayedDrillFlows.length-index}})).filter(item=>Boolean(item.point)),[displayedDrillFlows,drillGeometry]);
  const drillObstacles=useMemo<[number,number][]>(()=>{
    if(!drillGeometry)return[];
    const rows=drillLimit===0?drillFlows:drillFlows.slice(0,drillLimit);
    const out:[number,number][]=[];
    for(const flow of rows){
      const start=drillGeometry.centers[`${flow.oc}|${flow.oCounty}|${flow.o}`],end=drillGeometry.centers[`${flow.dc}|${flow.dCounty}|${flow.d}`];
      if(!start||!end)continue;
      const dx=end[0]-start[0],dy=end[1]-start[1],length=Math.max(1,Math.hypot(dx,dy)),bend=Math.min(24,Math.max(8,length*.1)),mx=(start[0]+end[0])/2-dy/length*bend,my=(start[1]+end[1])/2+dx/length*bend;
      for(const point of quadraticPoints(start,end,[mx,my]))out.push(point);
    }
    return out;
  },[drillGeometry,drillFlows,drillLimit]);
  const labelCandidates=useMemo<MapLabelCandidate[]>(()=>{if(!geometry)return[];const selectedKeys=new Set<string>();if(selected){selectedKeys.add(level==="城市"?selected.oc:`${selected.oc}|${selected.oCounty}${level==="镇街"?`|${selected.o}`:""}`);selectedKeys.add(level==="城市"?selected.dc:`${selected.dc}|${selected.dCounty}${level==="镇街"?`|${selected.d}`:""}`)}return shown.flatMap((flow,index)=>[[flow.oc,flow.oCounty,flow.o],[flow.dc,flow.dCounty,flow.d]].map(([city,county,name])=>{const key=level==="城市"?city:`${city}|${county}${level==="镇街"?`|${name}`:""}`;return{key,name:level==="城市"?city:name,point:geometry.centers[key],priority:shown.length-index,selected:selectedKeys.has(key)}})).filter(item=>Boolean(item.point)) as MapLabelCandidate[]},[shown,geometry,level,selected]);

  const zoom=(factor:number)=>setView(current=>{const k=Math.min(5,Math.max(1,current.k*factor));return k===1?{x:0,y:0,k}:{x:450-(450-current.x)*k/current.k,y:300-(300-current.y)*k/current.k,k}});
  useEffect(()=>{const element=mapRef.current;if(!element)return;const wheel=(event:WheelEvent)=>{event.preventDefault();event.stopPropagation();zoom(event.deltaY<0?1.18:1/1.18)};element.addEventListener("wheel",wheel,{passive:false});return()=>element.removeEventListener("wheel",wheel)},[data,level]);
  const onPointerDown=(event:React.PointerEvent<SVGSVGElement>)=>{event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,y:event.clientY,vx:view.x,vy:view.y}};
  const onPointerMove=(event:React.PointerEvent<SVGSVGElement>)=>{const dragState=drag.current;if(!dragState)return;const ratio=900/event.currentTarget.getBoundingClientRect().width;setView(current=>({...current,x:dragState.vx+(event.clientX-dragState.x)*ratio,y:dragState.vy+(event.clientY-dragState.y)*ratio}))};
  const onPointerUp=()=>{drag.current=null};
  const zoomDrill=(factor:number)=>setDrillView(current=>{const k=Math.min(5,Math.max(1,current.k*factor));return k===1?{x:0,y:0,k}:{x:450-(450-current.x)*k/current.k,y:260-(260-current.y)*k/current.k,k}});
  useEffect(()=>{const element=drillMapRef.current;if(!element||!drillOpen)return;const wheel=(event:WheelEvent)=>{event.preventDefault();event.stopPropagation();zoomDrill(event.deltaY<0?1.18:1/1.18)};element.addEventListener("wheel",wheel,{passive:false});return()=>element.removeEventListener("wheel",wheel)},[drillOpen,drillLoading]);
  useEffect(()=>{const element=drillMapRef.current;if(!element||!drillOpen)return;element.style.transformOrigin="center";element.style.transform=`translate(${drillView.x/4}px,${drillView.y/4}px) scale(${drillView.k})`;element.style.transition=drillDrag.current?"none":"transform .12s ease-out"},[drillView,drillOpen,drillLoading]);
  useEffect(()=>{const element=drillMapRef.current;if(!element||!drillOpen)return;let start:{x:number;y:number;vx:number;vy:number}|null=null;const down=(event:PointerEvent)=>{element.setPointerCapture(event.pointerId);start={x:event.clientX,y:event.clientY,vx:0,vy:0}};const move=(event:PointerEvent)=>{if(!start)return;const sx=start.x,sy=start.y,vx=start.vx,vy=start.vy,ox=event.clientX,oy=event.clientY;setDrillView(current=>({...current,x:vx+(ox-sx)*4,y:vy+(oy-sy)*4}))};const up=()=>{start=null};const reset=()=>setDrillView({x:0,y:0,k:1});element.addEventListener("pointerdown",down);element.addEventListener("pointermove",move);element.addEventListener("pointerup",up);element.addEventListener("pointercancel",up);element.addEventListener("dblclick",reset);return()=>{element.removeEventListener("pointerdown",down);element.removeEventListener("pointermove",move);element.removeEventListener("pointerup",up);element.removeEventListener("pointercancel",up);element.removeEventListener("dblclick",reset)}},[drillOpen,drillLoading]);
  const onDrillPointerDown=(event:React.PointerEvent<SVGSVGElement>)=>{event.currentTarget.setPointerCapture(event.pointerId);drillDrag.current={x:event.clientX,y:event.clientY,vx:drillView.x,vy:drillView.y}};
  const onDrillPointerMove=(event:React.PointerEvent<SVGSVGElement>)=>{const drillDragState=drillDrag.current;if(!drillDragState)return;const ratio=900/event.currentTarget.getBoundingClientRect().width;setDrillView(current=>({...current,x:drillDragState.vx+(event.clientX-drillDragState.x)*ratio,y:drillDragState.vy+(event.clientY-drillDragState.y)*ratio}))};
  const onDrillPointerUp=()=>{drillDrag.current=null};
  if(!data||!geometry)return <section className="trafficLoading">正在载入交通可达性数据…</section>;

  const scopeTitle=scope==="跨市"?"跨市":scope==="市内"?"市内":"全域";
  const locationLabel=(value:string,allLabel:string)=>value==="ALL"?allLabel:value.split("|").at(-1)!;
  const mapTitle=`厦漳泉${level}${level==="城市"?(cityMetric==="gov"?"政府驻地":cityMetric==="countyAvg"?"区县对平均":"镇街对平均"):"政府驻地"}${scopeTitle}${metricName}图`;
  const mapSubtitle=`${locationLabel(origin,"全部起点")} → ${locationLabel(destination,"全部终点")} · ${limit===0?`全部 ${flows.length} 条 OD`:`${metricName}最低的 ${Math.min(limit,flows.length)} 条 OD`}`;
  const performanceRows=buildRegionPerformance(flows,flow=>level==="城市"?flow.oc:level==="区县"?flow.oCounty:flow.o,valueFor,true);
  const activeProfile=performanceRows.some(row=>row.name===profileRegion)?profileRegion:(performanceRows[0]?.name||"");

  return <section className="trafficModule">
    <div className="moduleTopRow">{toolbar}<section className="trafficControls">
      <label>分析层级<select value={level} onChange={event=>{const next=event.target.value as Level;setLevel(next);if(next==="城市")setScope("跨市")}}><option value="城市">城市总体</option><option value="区县">区县政府驻地</option><option value="镇街">乡镇街政府驻地</option></select></label>
      <label>联系范围<select value={scope} onChange={event=>setScope(event.target.value as typeof scope)}><option value="全部">全部联系</option><option value="跨市">仅跨市联系</option><option value="市内">仅市内联系</option></select></label>
      <label>评价指标<select value={metric} onChange={event=>setMetric(event.target.value as Metric)}><option value="time">驾车时间</option><option value="distance">驾车距离</option><option value="toll">过路费</option></select></label>
      {level==="区县"&&<label>图层显示<select value={layerMode} onChange={event=>setLayerMode(event.target.value as "od"|"route")}><option value="od">OD 流线</option><option value="route">驾车路径</option></select></label>}
      {level==="城市"&&<label>统计口径<select value={cityMetric} onChange={event=>setCityMetric(event.target.value as typeof cityMetric)}><option value="gov">市政府</option><option value="countyAvg">区县对平均</option><option value="townAvg">乡镇街对平均</option></select></label>}
      <LocationTreePicker label={`起点${level}`} level={level} value={origin} onChange={setOrigin} tree={tree} allLabel={`全部起点${level}`} allowCity/>
      <LocationTreePicker label={`终点${level}`} level={level} value={destination} onChange={setDestination} tree={tree} allLabel={`全部终点${level}`} allowCity/>
    </section></div>
    <section className="mapFirstStage"><section className="populationStats trafficStats">
      <article><span>平均驾车时间</span><strong>{fmt(average("time"),1)}</strong><small>分钟 · 当前筛选</small></article>
      <article><span>平均驾车距离</span><strong>{fmt(average("distance"),1)}</strong><small>公里 · 当前筛选</small></article>
      <article><span>90分钟可达</span><strong>{fmt(flows.filter(flow=>flow.time<=90).length)}</strong><small>{flows.length?`${fmt(flows.filter(flow=>flow.time<=90).length/flows.length*100,1)}%`:`0%`} · 当前 OD</small></article>
      <article><span>最快跨市联系</span><strong className="populationTopName">{crossFastest?`${crossFastest.o} → ${crossFastest.d}`:"暂无"}</strong><small>{crossFastest?`${fmt(crossFastest.time,1)} 分钟 · ${fmt(crossFastest.distance,1)} 公里`:"当前筛选无记录"}</small></article>
    </section>
    <section className="populationWorkspace">
      <div className="populationMapCard"><div className="cardHead"><div><h2>{mapTitle}</h2><p>{mapSubtitle}；绿色表示可达性较好，点击连线查看双向数据</p></div><div className="mapHeadActions"><select value={limit} onChange={event=>setLimit(+event.target.value)}><option value="30">前30</option><option value="60">前60</option><option value="120">前120</option><option value="200">前200</option><option value="0">全部</option></select><label className="labelToggle"><input type="checkbox" checked={labelsOn} onChange={event=>setLabelsOn(event.target.checked)}/>标注</label><button onClick={()=>exportWithLabelsOn(labelsOn,setLabelsOn,()=>exportMapPng(mapRef.current,{title:mapTitle,subtitle:mapSubtitle,legendTitle:layerMode==="route"?"驾车路径廊道":`${metricName}分级`,legend:layerMode==="route"?[{shape:"line",color:"#d97706",label:"实际驾车路线"}]:legend,kmPerPixel:geometry.kmPerPixel}))}>导出 PNG</button></div></div>
        <div className="populationMapWrap"><svg ref={mapRef} viewBox="0 34 900 600" className="populationMap" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} role="img" aria-label={`厦漳泉${level}政府驾车可达性地图`}>
          <defs><marker id="trafficArrow" markerWidth={4/view.k} markerHeight={4/view.k} refX={3.8/view.k} refY={2/view.k} orient="auto" markerUnits="userSpaceOnUse"><path d={`M0,0 L${4/view.k},${2/view.k} L0,${4/view.k} Z`} fill="context-stroke"/></marker></defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}><g aria-hidden="true">{geometry.backdrop.map(feature=><path key={`fujian-${feature.code}`} d={feature.d} className="fujianPrefectureBackdrop"/>)}</g><g>{geometry.counties.map(feature=><path key={feature.key} d={feature.d} className="populationCounty"><title>{feature.city===feature.name?feature.name:feature.city+" · "+feature.name}</title></path>)}</g>
          {level==="镇街"&&<g>{geometry.towns.map(feature=><path key={feature.key} d={feature.d} className="populationTown"><title>{feature.city} · {feature.county} · {feature.town}</title></path>)}</g>}
          {level==="镇街"&&<g>{geometry.counties.map(feature=><path key={`town-county-overlay-${feature.key}`} d={feature.d} className="townshipCountyOverlay"/>)}</g>}
          {labelsOn&&<DynamicMapLabels candidates={labelCandidates} view={view} baseLimit={level==="镇街"?10:16} obstacles={flowObstacles}/>}
          {layerMode==="od"&&<g>{orderedFlows.map(flow=>{const startKey=`${flow.oc}|${flow.oCounty}${level==="镇街"?`|${flow.o}`:""}`,endKey=`${flow.dc}|${flow.dCounty}${level==="镇街"?`|${flow.d}`:""}`,start=geometry.centers[startKey],end=geometry.centers[endKey];if(!start||!end)return null;const grade=band(valueFor(flow),breaks),dx=end[0]-start[0],dy=end[1]-start[1];let d;if(dx===0&&dy===0){d=`M${start[0]},${start[1]} C${start[0]+26},${start[1]-38} ${start[0]+34},${start[1]+14} ${start[0]+10},${start[1]+4}`}else{const length=Math.max(1,Math.hypot(dx,dy)),bend=Math.min(42,Math.max(12,length*.12)),mx=(start[0]+end[0])/2-dy/length*bend,my=(start[1]+end[1])/2+dx/length*bend;d=`M${start} Q${mx},${my} ${end}`}const lineWidth=[2.5,2,1.55,1.15,.8][grade],highlighted=flow.key===selected?.key||flow.key===reverse?.key,dimmed=Boolean(selected&&!highlighted);return <g key={flow.key} onPointerDown={event=>event.stopPropagation()} onClick={()=>setSelected(flow)}><path d={d} className="populationFlowHit" style={{strokeWidth:10}}/><path d={d} className={highlighted?"populationFlow flowSelected":"populationFlow"} markerEnd="url(#trafficArrow)" style={{stroke:colors[grade],strokeWidth:highlighted?lineWidth+2.5:lineWidth,opacity:highlighted?1:dimmed?.12:.82}}><title>{flow.o} → {flow.d}：{fmt(valueFor(flow),1)} {unit}</title></path></g>})}</g>}
          {layerMode==="od"&&geometry.routePaths.length>0&&<g className="drivingRouteLayer">{geometry.routePaths.map((d,index)=><path key={`route-${index}`} d={d} className={index===0?"drivingRoute":"drivingRoute routeBack"}/>)}</g>}
          {layerMode==="route"&&geometry.allRoutePaths.length>0&&<g className="routeAllLayer">{geometry.allRoutePaths.map((d,index)=>{const routeKey=geometry.allRouteKeys[index],pairKey=level==="区县"&&selected?`${selected.oc}|${selected.oCounty}|${selected.dc}|${selected.dCounty}`:"",reversePairKey=level==="区县"&&selected?`${selected.dc}|${selected.dCounty}|${selected.oc}|${selected.oCounty}`:"",forward=Boolean(pairKey&&routeKey===pairKey),backward=Boolean(pairKey&&routeKey===reversePairKey),dimmed=Boolean(selected&&!forward&&!backward);return <path key={`route-all-${index}`} d={d} className="routeAllLine" style={forward?{stroke:"#e67e22",strokeWidth:2.8,opacity:1}:backward?{stroke:"#3d7dd8",strokeWidth:2.2,opacity:1,strokeDasharray:"6 4"}:dimmed?{opacity:.03}:undefined}><title>驾车路径{forward?"（起点→终点）":backward?"（终点→起点）":""}</title></path>})}</g>}</g>
          <MapDecorations kmPerPixel={geometry.kmPerPixel} viewK={view.k} width={900} height={600}/>
          </svg><MapScaleOverlay kmPerPixel={geometry.kmPerPixel} viewK={view.k}/><div className="mapTools"><button onClick={()=>zoom(1.25)}>＋</button><button onClick={()=>zoom(.8)}>－</button><button onClick={()=>setView({x:0,y:0,k:1.1})}>复位</button></div><span className="mapHint">滚轮缩放 · 按住拖动</span><div className="populationLegend numericLegend">{layerMode==="od"?<><strong>{metricName}分级</strong>{legend.map(item=><span className="legendItem" key={item.label}><i style={item.shape==="line"?{background:item.color,height:Math.max(1.5,Math.min(6.5,(item.lineWidth||1)*2.2)),borderRadius:2}:{background:item.color}}/>{item.label}</span>)}{level==="区县"&&geometry.routePaths.length>0&&<><strong>实际驾车路线</strong><span className="legendItem"><i className="routeSwatch"/>起点→终点</span><span className="legendItem"><i className="routeSwatch back"/>终点→起点</span></>}</>:geometry.allRoutePaths.length>0?<><strong>驾车路径廊道</strong><span className="legendItem"><i className="routeSwatch"/>{limit===0?"全部":`前 ${Math.min(limit,geometry.allRoutePaths.length)} 条`}实际驾车路线 · 重叠越密颜色越深=主要廊道</span></>:<span className="legendItem">当前筛选无实际驾车路线</span>}</div></div>
      </div>
      <aside className="populationRanking"><div className="cardHead"><div><h2>{metricName}排名</h2><p>数值越低，可达性越好</p></div></div><div className="ranking">{shown.slice(rankPage*12,rankPage*12+12).map((flow,index)=><button key={flow.key} onClick={()=>setSelected(flow)}><b>{String(rankPage*12+index+1).padStart(2,"0")}</b><span><strong>{mapDisplayName(flow.o)} → {mapDisplayName(flow.d)}</strong><small>{level==="镇街"?`${flow.oCounty} · ${flow.dCounty}`:`${flow.oc} · ${flow.dc}`}</small></span><em>{fmt(valueFor(flow),1)}</em></button>)}<div className="rankingPager"><button disabled={rankPage===0} onClick={()=>setRankPage(page=>Math.max(0,page-1))}>‹ 上一页</button><span>{rankPage+1} / {Math.max(1,Math.ceil(shown.length/12))}</span><button disabled={rankPage>=Math.ceil(shown.length/12)-1} onClick={()=>setRankPage(page=>page+1)}>下一页 ›</button></div></div></aside>
    </section></section>
    <RegionalPerformance title={`${level}${metricName}表现`} rows={performanceRows} selected={activeProfile} onSelect={setProfileRegion} unit={unit} digits={metric==="toll"?0:1} rankBasis={`平均${metricName}（越低越好）`}/>
    {selected&&<div className="populationDetail trafficDetail"><button onClick={()=>setSelected(null)}>×</button><span>{level}政府驻地双向驾车详情</span><h3>{mapDisplayName(selected.o)} ⇄ {mapDisplayName(selected.d)}</h3><p>{selected.oc}·{selected.oCounty} 与 {selected.dc}·{selected.dCounty}</p>{[[selected,`${mapDisplayName(selected.o)} → ${mapDisplayName(selected.d)}`],[reverse,`${mapDisplayName(selected.d)} → ${mapDisplayName(selected.o)}`]].map(([item,title])=><section key={String(title)}><h4>{title as string}</h4>{item?<><div><strong>{fmt((item as Flow).time,1)}</strong><small>分钟</small></div><div><strong>{fmt((item as Flow).distance,1)}</strong><small>公里</small></div><div><strong>{fmt((item as Flow).toll)}</strong><small>过路费（元）</small></div></>:<div><small>未找到反向记录</small></div>}</section>)}{level==="区县"&&<div className="populationDrillAction"><button onClick={openDrill}>查看两区县镇街驾车联系</button><small>沿用当前评价指标，双向展示</small></div>}</div>}
    {drillOpen&&selected&&level==="区县"&&<div className="townOverlay" role="dialog" aria-modal="true" aria-label={`${selected.oCounty}与${selected.dCounty}镇街驾车联系`} onMouseDown={()=>setDrillOpen(false)}><section className="townPanel populationTownPanel" onMouseDown={event=>event.stopPropagation()}><button className="townClose" onClick={()=>setDrillOpen(false)}>×</button><div className="townHeader"><span>交通可达性 · 镇街级联系</span><h2>{selected.oCounty} ⇄ {selected.dCounty}</h2><p>{metricName}升序 · 同时展示两个方向</p></div>{drillLoading?<div className="townState townLoadingState">正在载入镇街驾车数据…</div>:drillGeometry?<><div className="townNetworkMap"><div className="townMapCaption"><div><strong>{selected.oCounty}—{selected.dCounty}镇街{metricName}图</strong><span>默认显示前60条，自动聚焦两区县</span></div><div className="mapHeadActions"><select value={drillLimit} onChange={event=>setDrillLimit(+event.target.value)}><option value="30">前30</option><option value="60">前60</option><option value="120">前120</option><option value="200">前200</option><option value="0">全部</option></select><label className="labelToggle"><input type="checkbox" checked={drillLabelsOn} onChange={event=>setDrillLabelsOn(event.target.checked)}/>标注</label><button onClick={()=>exportWithLabelsOn(drillLabelsOn,setDrillLabelsOn,()=>exportMapPng(drillMapRef.current,{title:`${selected.oCounty}—${selected.dCounty}镇街${metricName}图`,subtitle:`${metricName}最低的 ${drillLimit===0?drillFlows.length:Math.min(drillLimit,drillFlows.length)} 条镇街OD`,legendTitle:`${metricName}分级`,legend:[{heading:true,label:"区县"},{color:"#9fb9d9",label:selected.oCounty},{color:"#d9bdcc",label:selected.dCounty},{heading:true,label:"强度分级"},...drillLegend],kmPerPixel:drillGeometry?.kmPerPixel}))}>导出 PNG</button></div></div><svg ref={drillMapRef} viewBox="0 0 900 520"><defs><marker id="trafficDrillArrow" markerWidth="4" markerHeight="4" refX="3.8" refY="2" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L4,2 L0,4 Z" fill="context-stroke"/></marker></defs><g>{drillGeometry.counties.map(feature=><path key={feature.key} d={feature.d} className="townCountyBackground"/>)}</g><g>{drillGeometry.towns.map(feature=><path key={feature.key} d={feature.d} className={`townBoundary selected ${feature.city===selected.oc&&feature.county===selected.oCounty?"sideA":"sideB"}`}/>)}</g>{drillLabelsOn&&<DynamicMapLabels candidates={drillLabelCandidates} view={drillView} width={900} height={520} baseLimit={16} obstacles={drillObstacles}/>}<g>{[...displayedDrillFlows].reverse().map(flow=>{const start=drillGeometry.centers[`${flow.oc}|${flow.oCounty}|${flow.o}`],end=drillGeometry.centers[`${flow.dc}|${flow.dCounty}|${flow.d}`];if(!start||!end)return null;const grade=band(valueFor(flow),drillBreaks),dx=end[0]-start[0],dy=end[1]-start[1],length=Math.max(1,Math.hypot(dx,dy)),bend=Math.min(24,Math.max(8,length*.1)),mx=(start[0]+end[0])/2-dy/length*bend,my=(start[1]+end[1])/2+dx/length*bend;return <path key={flow.key} d={`M${start} Q${mx},${my} ${end}`} className="townFlow" markerEnd="url(#trafficDrillArrow)" style={{stroke:colors[grade],strokeWidth:[.45,.7,1,1.5,2.3][grade],opacity:.55+grade*.1}}/>})}</g><MapDecorations kmPerPixel={drillGeometry?.kmPerPixel} viewK={1} width={900} height={520}/></svg><MapScaleOverlay kmPerPixel={drillGeometry?.kmPerPixel} viewK={drillView.k}/><div className="populationLegend"><strong>区县</strong><span className="legendItem"><i className="drillSide sideA"/>{selected.oCounty}</span><span className="legendItem"><i className="drillSide sideB"/>{selected.dCounty}</span><strong>强度分级</strong>{drillLegend.map(item=><span className="legendItem" key={item.label}><i style={item.shape==="line"?{background:item.color,height:Math.max(1.5,Math.min(6.5,(item.lineWidth||1)*2.2)),borderRadius:2}:{background:item.color}}/>{item.label}</span>)}</div></div><div className="townToolbar"><div><strong>镇街驾车联系明细</strong><span>共 {drillFlows.length} 条，当前显示 {displayedDrillFlows.length} 条</span></div></div><div className="townTable"><div className="townTableHead"><span>序号</span><span>O端镇街</span><span>方向</span><span>D端镇街</span><span>{metricName}</span><span>距离 / 过路费</span></div>{displayedDrillFlows.map((flow,index)=><article key={flow.key}><b>{String(index+1).padStart(2,"0")}</b><div><strong>{flow.o}</strong><small>{flow.oc} · {flow.oCounty}</small></div><i>→</i><div><strong>{flow.d}</strong><small>{flow.dc} · {flow.dCounty}</small></div><em>{fmt(valueFor(flow),1)} {unit}</em><div className="townValue"><strong>{fmt(flow.distance,1)} km / {fmt(flow.toll)} 元</strong><small>{fmt(flow.time,1)} 分钟</small></div></article>)}</div></>:<div className="townState error">镇街驾车数据读取失败。</div>}</section></div>}
    <div className="populationNote">数据源：{data.meta.source}；共 {fmt(data.meta.nodeCount)} 个{level}政府驻地、{fmt(data.meta.directedOdCount)} 条非自身有向 OD。{level==="镇街"&&data.meta.boundaryCount?`底图完整显示 ${fmt(data.meta.boundaryCount)} 个乡镇街边界，其中 ${fmt(data.meta.odNodeBoundaryCount||data.meta.nodeCount)} 个具有政府驻地OD；`:""}{data.meta.incompletePairCount?`源数据有 ${fmt(data.meta.incompletePairCount)} 组同名跨区县镇街对缺少双向记录；`:""}{data.meta.distanceDefinition}。</div>
  </section>;
}
