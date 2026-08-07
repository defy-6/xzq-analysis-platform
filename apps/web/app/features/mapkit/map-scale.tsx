"use client";

import { useLayoutEffect, useRef, useState } from "react";

// 地图装饰：指北针 + 比例尺（真实比例由 kmPerPixel 换算，网页与导出 PNG 共用）。
// 位置固定在 viewBox 右上角 / 右下角，放在地图 transform 组之外，不随缩放平移。
// 标注字号按 SVG 实际渲染缩放(getScreenCTM)反补偿，保证所有地图屏幕上比例尺标注大小一致。
export default function MapDecorations({kmPerPixel,viewK=1,width=900,height=600}:{kmPerPixel?:number;viewK?:number;width?:number;height?:number}){
  const groupRef=useRef<SVGGElement>(null);
  const [factor,setFactor]=useState(1);
  useLayoutEffect(()=>{
    const svg=groupRef.current?.ownerSVGElement;
    if(!svg)return;
    const measure=()=>{const ctm=svg.getScreenCTM();if(ctm&&ctm.a>0&&Math.abs(ctm.a-1)>0.01)setFactor(ctm.a);else if(ctm&&ctm.a>0)setFactor(1)};
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(svg);
    window.addEventListener("resize",measure);
    return()=>{observer.disconnect();window.removeEventListener("resize",measure)};
  },[]);
  const fs=(size:number)=>size/factor;
  const value=kmPerPixel??0.2;
  const gridValues=[2,5,10,20,25,50,100];
  const maxBarLength=width-150;
  let grid=10,bestDistance=Infinity;
  for(const candidate of gridValues){
    const length=candidate*4*viewK/value;
    if(length>maxBarLength)continue;
    const distance=Math.abs(length-200);
    if(distance<bestDistance){bestDistance=distance;grid=candidate}
  }
  const totalKm=grid*4,barLength=Math.min(totalKm*viewK/value,maxBarLength),segment=barLength/4;
  const northX=width-96,northY=86;
  const barX=width-barLength-46,barY=height-44;
  return <g ref={groupRef} className="mapDecorations" pointerEvents="none">
    {/* 指北针：双色箭头 + 顶部 N + 椭圆外圈（大小为原 2/3） */}
    <g transform={`translate(${northX} ${northY})`}>
      <ellipse rx={21} ry={24} fill="none" stroke="#4e5b56" strokeWidth={1.5}/>
      <path d="M0,-17 L-12,29 L0,19 Z" fill="#33413b"/>
      <path d="M0,-17 L12,29 L0,19 Z" fill="#87928c"/>
      <text y={-34} textAnchor="middle" fontSize={fs(16)} fontWeight={700} fill="#25312d" stroke="none" fontFamily="SimHei,Microsoft YaHei,sans-serif">N</text>
    </g>
    {/* 比例尺：四格（每格 2/5/10/20/25/50/100 km 的倍数，总长 4 格，无底框） */}
    <g transform={`translate(${barX} ${barY})`}>
      {[0,1,2,3].map(index=><rect key={index} x={index*segment} width={segment} height={9} fill={index%2===0?"#4e5b56":"#ffffff"} stroke="#4e5b56"/>)}
      {[0,1,2,3,4].map(index=><text key={index} x={index*segment} y={-18} textAnchor="middle" fontSize={fs(40)} fill="#65716c" stroke="none" fontFamily="SimHei,Microsoft YaHei,sans-serif">{index*grid}</text>)}
      <text x={barLength+22} y={-18} fontSize={fs(40)} fill="#65716c" stroke="none" fontFamily="SimHei,Microsoft YaHei,sans-serif">km</text>
    </g>
  </g>;
}
