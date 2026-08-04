"use client";

import { useEffect, useState } from "react";

export type FujianBackdropFeature={properties:{code:string;name:string};geometry:{type:"MultiPolygon";coordinates:any[]}};
let cached:FujianBackdropFeature[]|null=null;
let pending:Promise<FujianBackdropFeature[]>|null=null;

export default function useFujianBackdrop(){
  const [features,setFeatures]=useState<FujianBackdropFeature[]>(cached||[]);
  useEffect(()=>{
    if(cached){setFeatures(cached);return}
    pending||=fetch("/data/fujian-prefecture-boundaries.json").then(response=>response.json()).then(payload=>{cached=payload.features||[];return cached!});
    pending.then(setFeatures).catch(()=>setFeatures([]));
  },[]);
  return features;
}
