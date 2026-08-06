"use client";

import { useRef } from "react";
import { mapDisplayName } from "../mapkit/map-labels";

export type LocationLevel="城市"|"区县"|"镇街";
export type LocationEntry={city:string;county:string;town?:string};
export type LocationTreeCity={city:string;counties:{county:string;towns:string[]}[]};

export function buildLocationTree(entries:LocationEntry[]):LocationTreeCity[]{
  const cities=new Map<string,Map<string,Set<string>>>();
  for(const entry of entries){
    if(!entry.city||!entry.county)continue;
    const counties=cities.get(entry.city)||new Map<string,Set<string>>();
    const towns=counties.get(entry.county)||new Set<string>();
    if(entry.town)towns.add(entry.town);
    counties.set(entry.county,towns);cities.set(entry.city,counties);
  }
  return [...cities].sort(([a],[b])=>a.localeCompare(b,"zh-CN")).map(([city,counties])=>({
    city,
    counties:[...counties].sort(([a],[b])=>a.localeCompare(b,"zh-CN")).map(([county,towns])=>({
      county,
      towns:[...towns].sort((a,b)=>a.localeCompare(b,"zh-CN"))
    }))
  }));
}

export default function LocationTreePicker({label,level,value,onChange,tree,allLabel}:{label:string;level:LocationLevel;value:string;onChange:(value:string)=>void;tree:LocationTreeCity[];allLabel:string}){
  const root=useRef<HTMLDetailsElement|null>(null);
  const parts=value.split("|");
  const display=value==="ALL"?allLabel:level==="城市"?parts[0]:level==="区县"?`${parts[0]} / ${parts[1]}`:`${parts[0]} / ${parts[1]} / ${mapDisplayName(parts[2]||"")}`;
  const choose=(next:string)=>{onChange(next);if(root.current)root.current.open=false};
  return <details ref={root} className="locationTree">
    <summary><span>{label}</span><strong>{display}</strong></summary>
    <div className="locationTreePanel">
      <button type="button" className={value==="ALL"?"chosen":""} onClick={()=>choose("ALL")}>{allLabel}</button>
      {tree.map(city=>level==="城市"?<button type="button" key={city.city} className={value===city.city?"chosen":""} onClick={()=>choose(city.city)}>{city.city}</button>:<details key={city.city}>
        <summary>{city.city}</summary>
        <div>{city.counties.map(county=>level==="区县"
          ?<button type="button" key={county.county} className={value===`${city.city}|${county.county}`?"chosen":""} onClick={()=>choose(`${city.city}|${county.county}`)}>{county.county}</button>
          :<details key={county.county}>
            <summary>{county.county}</summary>
            <div>{county.towns.map(town=><button type="button" key={town} className={value===`${city.city}|${county.county}|${town}`?"chosen":""} onClick={()=>choose(`${city.city}|${county.county}|${town}`)}>{mapDisplayName(town)}</button>)}</div>
          </details>
        )}</div>
      </details>)}
    </div>
  </details>;
}
