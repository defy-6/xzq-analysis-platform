"use client";

export type RegionPerformanceRow={name:string;total:number;average:number;odCount:number;rank:number};

export function buildRegionPerformance<T>(flows:T[],origin:(flow:T)=>string,value:(flow:T)=>number,lowerBetter=false){
  const grouped=new Map<string,{total:number;odCount:number}>();
  for(const flow of flows){const name=origin(flow),metric=value(flow);if(!name||!Number.isFinite(metric))continue;const current=grouped.get(name)||{total:0,odCount:0};current.total+=metric;current.odCount+=1;grouped.set(name,current)}
  return [...grouped].map(([name,row])=>({name,total:row.total,average:row.odCount?row.total/row.odCount:0,odCount:row.odCount,rank:0})).sort((a,b)=>lowerBetter?a.average-b.average:b.total-a.total).map((row,index)=>({...row,rank:index+1}));
}

const fmt=(value:number,digits=0)=>new Intl.NumberFormat("zh-CN",{maximumFractionDigits:digits}).format(value);

export default function RegionalPerformance({title,rows,selected,onSelect,unit,digits=0,rankBasis="总量"}:{title:string;rows:RegionPerformanceRow[];selected:string;onSelect:(name:string)=>void;unit:string;digits?:number;rankBasis?:string}){
  const current=rows.find(row=>row.name===selected)||rows[0];
  if(!current)return null;
  return <section className="regionalPerformance">
    <header><div><span>REGIONAL PROFILE</span><h2>{title}</h2></div><label>查看区域<select value={current.name} onChange={event=>onSelect(event.target.value)}>{rows.map(row=><option key={row.name}>{row.name}</option>)}</select></label></header>
    <div className="regionalPerformanceCards">
      <article><span>对外联系总量</span><strong>{fmt(current.total,digits)}</strong><small>{unit} · 当前筛选</small></article>
      <article><span>单条 OD 平均值</span><strong>{fmt(current.average,digits)}</strong><small>{unit} / 条</small></article>
      <article><span>有效对外 OD</span><strong>{fmt(current.odCount)}</strong><small>条有效方向</small></article>
      <article><span>当前范围排名</span><strong>第 {current.rank}</strong><small>共 {rows.length} 个区域 · 按{rankBasis}</small></article>
    </div>
  </section>;
}
