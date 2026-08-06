"use client";

import { useMemo } from "react";

export type MapView={x:number;y:number;k:number};
export type MapLabelCandidate={key:string;name:string;point:[number,number];priority?:number;selected?:boolean};

type PlacedLabel=MapLabelCandidate&{dx:number;dy:number;anchor:"start"|"end"};

export const mapDisplayName=(name:unknown)=>String(name??"").replace(/街道办事处$/u,"街道");
const textWidth=(name:string)=>{const displayName=mapDisplayName(name);return Math.max(26,[...displayName].reduce((sum,char)=>sum+(/[\u0000-\u00ff]/.test(char)?6:10),0)+8)};

export function placeMapLabels(candidates:MapLabelCandidate[],view:MapView,width=900,height=600,baseLimit=14){
  const limit=Math.min(candidates.length,Math.round(baseLimit*Math.min(2.8,Math.max(1,view.k*.72))));
  const byKey=new Map<string,MapLabelCandidate>();for(const item of candidates){const previous=byKey.get(item.key);if(!previous||item.selected||(!previous.selected&&(item.priority||0)>(previous.priority||0)))byKey.set(item.key,item)}
  const unique=[...byKey.values()].sort((a,b)=>Number(Boolean(b.selected))-Number(Boolean(a.selected))+(b.priority||0)-(a.priority||0));
  const occupied:{left:number;right:number;top:number;bottom:number}[]=[];
  const placements:[[number,number],"start"|"end"][]=[[[8,-8],"start"],[[-8,-8],"end"],[[8,14],"start"],[[-8,14],"end"],[[11,3],"start"],[[-11,3],"end"]];
  const result:PlacedLabel[]=[];
  for(const item of unique){
    const screenX=view.x+item.point[0]*view.k,screenY=view.y+item.point[1]*view.k;
    if(screenX<-40||screenX>width+40||screenY<-25||screenY>height+25)continue;
    const labelWidth=textWidth(item.name),labelHeight=16;
    let placed:PlacedLabel|null=null;
    for(const [[dx,dy],anchor] of placements){
      const left=anchor==="start"?screenX+dx:screenX+dx-labelWidth,right=left+labelWidth,top=screenY+dy-labelHeight+3,bottom=top+labelHeight;
      if(left<4||right>width-4||top<4||bottom>height-4)continue;
      if(occupied.some(box=>!(right+3<box.left||left-3>box.right||bottom+2<box.top||top-2>box.bottom)))continue;
      occupied.push({left,right,top,bottom});placed={...item,dx,dy,anchor};break;
    }
    if(!placed&&item.selected){const [[dx,dy],anchor]=placements[0];placed={...item,dx,dy,anchor}}
    if(placed)result.push(placed);
    if(result.length>=limit)break;
  }
  return result;
}

export default function DynamicMapLabels({candidates,view,baseLimit=14,className="mapDynamicLabels"}:{candidates:MapLabelCandidate[];view:MapView;baseLimit?:number;className?:string}){
  const labels=useMemo(()=>placeMapLabels(candidates,view,900,600,baseLimit),[candidates,view,baseLimit]);
  const inverse=1/view.k;
  return <g className={className}>{labels.map(item=><g key={item.key} transform={`translate(${item.point[0]} ${item.point[1]}) scale(${inverse})`} className={item.selected?"selected":""}>
    <circle r={item.selected?4:2.6}/><text x={item.dx} y={item.dy} textAnchor={item.anchor}>{mapDisplayName(item.name)}</text>
  </g>)}</g>;
}
