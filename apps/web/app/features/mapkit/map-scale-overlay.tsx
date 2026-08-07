"use client";

// 网页实时比例尺 + 指北针（HTML 覆盖层，字号固定像素 → 所有地图屏幕上大小一致）。
// 位置：指北针右上角、比例尺右下角。导出 PNG 仍用 SVG 内 MapDecorations（克隆 SVG 时不受此 HTML 影响）。
export default function MapScaleOverlay({kmPerPixel,viewK=1}:{kmPerPixel?:number;viewK?:number}){
  const value=kmPerPixel??0.2;
  const gridValues=[2,5,10,20,25,50,100];
  const maxBarLength=340;
  let grid=10,bestDistance=Infinity;
  for(const candidate of gridValues){
    const length=candidate*4*viewK/value;
    if(length>maxBarLength)continue;
    const distance=Math.abs(length-200);
    if(distance<bestDistance){bestDistance=distance;grid=candidate}
  }
  const totalKm=grid*4,barLength=Math.min(totalKm*viewK/value,maxBarLength),segment=barLength/4;
  return <div className="mapScaleOverlay" aria-hidden="true">
    <div className="mapNorth">
      <svg viewBox="-24 -58 48 92" width="56" height="107">
        <text y="-36" textAnchor="middle" fontSize="21" fontWeight="700" fill="#25312d" fontFamily="SimHei,Microsoft YaHei,sans-serif">N</text>
        <ellipse cx="0" cy="6" rx="21" ry="24" fill="none" stroke="#4e5b56" strokeWidth="1.5"/>
        <path d="M0,-17 L-12,29 L0,19 Z" fill="#33413b"/>
        <path d="M0,-17 L12,29 L0,19 Z" fill="#87928c"/>
      </svg>
    </div>
    <div className="mapScaleBar" style={{width:barLength}}>
      {[0,1,2,3].map(index=><span key={index} className="mapScaleCell" style={{width:segment}}/>)}
      {[0,1,2,3,4].map(index=><b key={index} style={{left:index*segment}}>{index*grid}</b>)}
      <i style={{left:barLength}}>km</i>
    </div>
  </div>;
}
