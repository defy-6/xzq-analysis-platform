"use client";

import { useMemo } from "react";

export type MapView={x:number;y:number;k:number};
export type MapLabelCandidate={key:string;name:string;point:[number,number];priority?:number;selected?:boolean};

type PlacedLabel=MapLabelCandidate&{dx:number;dy:number;anchor:"start"|"end"};

const COUNTIES=["思明区","湖里区","集美区","海沧区","同安区","翔安区","芗城区","龙文区","龙海区","长泰区","漳浦县","云霄县","东山县","诏安县","南靖县","平和县","华安县","鲤城区","丰泽区","洛江区","泉港区","石狮市","晋江市","南安市","惠安县","安溪县","永春县","德化县"];
export const mapDisplayName=(name:unknown)=>{
  let value=String(name??"");
  for(const county of COUNTIES){if(value.startsWith(county)){const rest=value.slice(county.length);if(rest)value=rest;break}}
  return value.replace(/街道办事处$/u,"街道");
};
const textWidth=(name:string)=>{const displayName=mapDisplayName(name);return Math.max(26,[...displayName].reduce((sum,char)=>sum+(/[\u0000-\u00ff]/.test(char)?6:10),0)+8)};

export function placeMapLabels(candidates:MapLabelCandidate[],view:MapView,width=900,height=600,baseLimit=14,obstacles?:[number,number][]){
  const limit=Math.min(candidates.length,Math.max(4,Math.round(baseLimit*Math.min(3,Math.max(.5,view.k*.9)))));
  const labelScale=1;
  const byKey=new Map<string,MapLabelCandidate>();for(const item of candidates){const previous=byKey.get(item.key);if(!previous||item.selected||(!previous.selected&&(item.priority||0)>(previous.priority||0)))byKey.set(item.key,item)}
  const byPoint=new Map<string,MapLabelCandidate>();for(const item of byKey.values()){const pointKey=`${item.point[0].toFixed(3)},${item.point[1].toFixed(3)}`;const previous=byPoint.get(pointKey);if(!previous||Number(Boolean(item.selected))>Number(Boolean(previous?.selected))||(item.selected===previous?.selected&&(item.priority||0)>(previous.priority||0)))byPoint.set(pointKey,item)}
  const unique=[...byPoint.values()].sort((a,b)=>Number(Boolean(b.selected))-Number(Boolean(a.selected))+(b.priority||0)-(a.priority||0));
  const occupied:{left:number;right:number;top:number;bottom:number}[]=[];
  const placements:[[number,number],"start"|"end"][]=[[[8,-8],"start"],[[-8,-8],"end"],[[8,14],"start"],[[-8,14],"end"],[[11,3],"start"],[[-11,3],"end"]];
  const obstacleScreen=obstacles&&obstacles.length?obstacles.map(([x,y])=>[view.x+x*view.k,view.y+y*view.k] as [number,number]):[];
  const result:PlacedLabel[]=[];
  for(const item of unique){
    const screenX=view.x+item.point[0]*view.k,screenY=view.y+item.point[1]*view.k;
    if(screenX<-40||screenX>width+40||screenY<-25||screenY>height+25)continue;
    const labelWidth=textWidth(item.name)*labelScale,labelHeight=16*labelScale;
    let placed:PlacedLabel|null=null;
    let bestPlacement:PlacedLabel|null=null,bestHits=Infinity,bestBox:{left:number;right:number;top:number;bottom:number}|null=null;
    for(const [[dx,dy],anchor] of placements){
      const offsetX=dx*labelScale,offsetY=dy*labelScale;
      const left=anchor==="start"?screenX+offsetX:screenX+offsetX-labelWidth,right=left+labelWidth,top=screenY+offsetY-labelHeight+3,bottom=top+labelHeight;
      if(left<4||right>width-4||top<4||bottom>height-4)continue;
      if(occupied.some(box=>!(right+3<box.left||left-3>box.right||bottom+2<box.top||top-2>box.bottom)))continue;
      let hits=0;
      for(const [ox,oy] of obstacleScreen){if(ox>=left-5&&ox<=right+5&&oy>=top-5&&oy<=bottom+5){if(++hits>=bestHits)break}}
      if(hits===0){occupied.push({left,right,top,bottom});placed={...item,dx,dy,anchor};break}
      if(hits<bestHits){bestHits=hits;bestPlacement={...item,dx,dy,anchor};bestBox={left,right,top,bottom}}
    }
    if(!placed&&bestPlacement){if(bestBox)occupied.push(bestBox);placed=bestPlacement}
    if(!placed&&item.selected){const [[dx,dy],anchor]=placements[0];placed={...item,dx,dy,anchor}}
    if(placed)result.push(placed);
    if(result.length>=limit)break;
  }
  return result;
}

export default function DynamicMapLabels({candidates,view,baseLimit=14,width=900,height=600,className="mapDynamicLabels",obstacles}:{candidates:MapLabelCandidate[];view:MapView;baseLimit?:number;width?:number;height?:number;className?:string;obstacles?:[number,number][]}){
  const labels=useMemo(()=>placeMapLabels(candidates,view,width,height,baseLimit,obstacles),[candidates,view,width,height,baseLimit,obstacles]);
  const inverse=1/view.k;
  return <g className={className}>{labels.map(item=><g key={item.key} transform={`translate(${item.point[0]} ${item.point[1]}) scale(${inverse})`} className={item.selected?"selected":""}>
    <circle r={item.selected?4:2.6}/><text x={item.dx} y={item.dy} textAnchor={item.anchor}>{mapDisplayName(item.name)}</text>
  </g>)}</g>;
}
