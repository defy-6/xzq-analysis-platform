"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { exportMapPng, numericLegend } from "./map-export";
import DynamicMapLabels, { MapLabelCandidate } from "./map-labels";
import MapDecorations from "./map-scale";
import MapScaleOverlay from "./map-scale-overlay";
import useFujianBackdrop from "./fujian-backdrop";

type BoundaryFeature={properties:{city:string;name:string;code:string};geometry:{type:"MultiPolygon";coordinates:any[]}};
const colors=["#dceae4","#acd2c5","#72ae9d","#e5b85b","#b9513f"];
const quantiles=(values:number[])=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return [];return [.2,.4,.6,.8].map(q=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))])};
const band=(value:number,breaks:number[])=>{if(!breaks.length||breaks.every(item=>item===breaks[0]))return 2;if(value<=breaks[0])return 0;if(value<=breaks[1])return 1;if(value<=breaks[2])return 2;if(value<=breaks[3])return 3;return 4};
const geometryPath=(coordinates:any[],project:(point:[number,number])=>[number,number])=>coordinates.map((polygon:any)=>polygon.map((ring:any)=>ring.map((point:any,index:number)=>(index?"L":"M")+project(point).join(",")).join("")+"Z").join("")).join("");

export default function ThematicMap({features,values,activeCounties,selected,onSelect,title,subtitle,legendTitle,unit,digits=1}:{features:BoundaryFeature[];values:Map<string,number>;activeCounties:Set<string>;selected:string|null;onSelect:(county:string)=>void;title:string;subtitle:string;legendTitle:string;unit:string;digits?:number}){
  const [view,setView]=useState({x:0,y:0,k:1.1});
  const [labelsOn,setLabelsOn]=useState(true);
  const [exporting,setExporting]=useState(false);
  const [governmentCenters,setGovernmentCenters]=useState<Record<string,[number,number]>>({});
  const fujianBackdrop=useFujianBackdrop();
  const mapRef=useRef<SVGSVGElement|null>(null);
  const drag=useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
  useEffect(()=>{fetch("/data/government-centers.json").then(response=>response.json()).then(payload=>setGovernmentCenters(payload.county||{}))},[]);
  const geometry=useMemo(()=>{
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const feature of features)for(const polygon of feature.geometry.coordinates)for(const ring of polygon)for(const point of ring){minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);minY=Math.min(minY,point[1]);maxY=Math.max(maxY,point[1])}
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2,cos=Math.cos(centerY*Math.PI/180),scale=Math.min(820/Math.max((maxX-minX)*cos,.0001),500/Math.max(maxY-minY,.0001))/1.08;
    const project=(point:[number,number]):[number,number]=>[450+(point[0]-centerX)*cos*scale,300-(point[1]-centerY)*scale];
    const counties=features.map(feature=>{let fx0=Infinity,fx1=-Infinity,fy0=Infinity,fy1=-Infinity;for(const polygon of feature.geometry.coordinates)for(const ring of polygon)for(const point of ring){fx0=Math.min(fx0,point[0]);fx1=Math.max(fx1,point[0]);fy0=Math.min(fy0,point[1]);fy1=Math.max(fy1,point[1])}const government=governmentCenters[`${feature.properties.city}|${feature.properties.name}`];return{...feature.properties,d:geometryPath(feature.geometry.coordinates,project),center:project(government||[(fx0+fx1)/2,(fy0+fy1)/2])}});
    const backdrop=fujianBackdrop.map(feature=>({...feature.properties,d:geometryPath(feature.geometry.coordinates,project)}));
    return{counties,backdrop,kmPerPixel:111.32/(cos*scale)};
  },[features,governmentCenters,fujianBackdrop]);
  const selectedGeometry=useMemo(()=>selected?geometry.counties.find(feature=>feature.name===selected)||null:null,[geometry,selected]);
  const labelCandidates=useMemo<MapLabelCandidate[]>(()=>geometry.counties.filter(feature=>activeCounties.has(feature.name)).map(feature=>({key:feature.code,name:feature.name,point:feature.center,priority:values.get(feature.name)||0,selected:!exporting&&feature.name===selected})),[geometry,activeCounties,values,selected,exporting]);
  const currentValues=[...values.entries()].filter(([county])=>activeCounties.has(county)).map(([,value])=>value),breaks=quantiles(currentValues),legend=numericLegend(colors,breaks,currentValues,unit,digits);
  const zoom=(factor:number)=>setView(current=>{const k=Math.min(5,Math.max(1,current.k*factor));return k===1?{x:0,y:0,k}:{x:450-(450-current.x)*k/current.k,y:300-(300-current.y)*k/current.k,k}});
  useEffect(()=>{const element=mapRef.current;if(!element)return;const wheel=(event:WheelEvent)=>{event.preventDefault();event.stopPropagation();zoom(event.deltaY<0?1.18:1/1.18)};element.addEventListener("wheel",wheel,{passive:false});return()=>element.removeEventListener("wheel",wheel)},[]);
  useEffect(()=>setView({x:0,y:0,k:1.1}),[title]);
  return <div className="thematicMapCard"><div className="cardHead"><div><h2>{title}</h2><p>{subtitle}；点击区县查看详情</p></div><div className="mapHeadActions"><label className="labelToggle"><input type="checkbox" checked={labelsOn} onChange={event=>setLabelsOn(event.target.checked)}/>标注</label><button onClick={()=>{const run=()=>exportMapPng(mapRef.current,{title,subtitle,legendTitle,legend,kmPerPixel:geometry?.kmPerPixel});const doExport=()=>{if(!selected){run();return}setExporting(true);requestAnimationFrame(()=>requestAnimationFrame(()=>{run();setExporting(false)}))};if(labelsOn){doExport();return}setLabelsOn(true);requestAnimationFrame(()=>requestAnimationFrame(()=>{doExport();setLabelsOn(false)}))}}>导出 PNG</button></div></div>
    <div className="thematicMapWrap"><svg ref={mapRef} viewBox="0 34 900 600" className="thematicMap" role="img" aria-label={title} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,y:event.clientY,vx:view.x,vy:view.y}}} onPointerMove={event=>{const dragState=drag.current;if(!dragState)return;const ratio=900/event.currentTarget.getBoundingClientRect().width;setView(current=>({...current,x:dragState.vx+(event.clientX-dragState.x)*ratio,y:dragState.vy+(event.clientY-dragState.y)*ratio}))}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        <g aria-hidden="true">{geometry.backdrop.map(feature=><path key={`fujian-${feature.code}`} d={feature.d} className="fujianPrefectureBackdrop"/>)}</g>
        {geometry.counties.map(feature=>{const active=activeCounties.has(feature.name),value=values.get(feature.name),grade=value===undefined?0:band(value,breaks);return <path key={feature.code} d={feature.d} className={`thematicCounty${active?" active":" muted"}`} style={active&&value!==undefined?{fill:colors[grade]}:undefined} onPointerDown={event=>event.stopPropagation()} onClick={()=>active&&onSelect(feature.name)}><title>{feature.city} · {feature.name}{value===undefined?"":`：${new Intl.NumberFormat("zh-CN",{maximumFractionDigits:digits}).format(value)}${unit}`}</title></path>})}
        {!exporting&&selectedGeometry&&<path d={selectedGeometry.d} className="thematicCounty selected selectedOverlay" aria-hidden="true"/>}
        {labelsOn&&<DynamicMapLabels candidates={labelCandidates} view={view} baseLimit={18}/>}
      </g>
      <MapDecorations kmPerPixel={geometry?.kmPerPixel} viewK={view.k} width={900} height={600}/>
    </svg><MapScaleOverlay kmPerPixel={geometry?.kmPerPixel} viewK={view.k}/><div className="mapTools"><button onClick={()=>zoom(1.25)}>＋</button><button onClick={()=>zoom(.8)}>－</button><button onClick={()=>setView({x:0,y:0,k:1.1})}>复位</button></div><span className="mapHint">滚轮缩放 · 按住拖动</span><div className="populationLegend numericLegend"><strong>{legendTitle}</strong>{legend.map(item=><span className="legendItem" key={`${item.color}-${item.label}`}><i style={{background:item.color}}/>{item.label}</span>)}</div></div>
  </div>;
}
