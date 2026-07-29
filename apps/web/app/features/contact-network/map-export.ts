export type MapLegendItem={color:string;label:string};

const numberLabel=(value:number,digits:number)=>new Intl.NumberFormat("zh-CN",{maximumFractionDigits:digits}).format(value);

export function numericLegend(colors:string[],breaks:number[],values:number[],unit:string,digits=0):MapLegendItem[]{
  const finite=values.filter(Number.isFinite);
  if(!finite.length)return colors.map((color,index)=>({color,label:index===2?"无数据":"—"}));
  if(!breaks.length||breaks.every(value=>value===breaks[0])){
    return [{color:colors[2],label:`全部 ${numberLabel(finite[0],digits)}${unit}`}];
  }
  const labels=[
    `≤ ${numberLabel(breaks[0],digits)}${unit}`,
    `${numberLabel(breaks[0],digits)}–${numberLabel(breaks[1],digits)}${unit}`,
    `${numberLabel(breaks[1],digits)}–${numberLabel(breaks[2],digits)}${unit}`,
    `${numberLabel(breaks[2],digits)}–${numberLabel(breaks[3],digits)}${unit}`,
    `> ${numberLabel(breaks[3],digits)}${unit}`
  ];
  return colors.map((color,index)=>({color,label:labels[index]}));
}

const safeFilename=(value:string)=>value.replace(/[\\/:*?"<>|]/g,"-").replace(/\s+/g,"_");

export async function exportMapPng(svg:SVGSVGElement|null,options:{title:string;subtitle:string;legendTitle:string;legend:MapLegendItem[];filename?:string}){
  if(!svg)return;
  const viewBox=(svg.getAttribute("viewBox")||"0 0 900 600").split(/\s+/).map(Number);
  const sourceWidth=viewBox[2]||900,sourceHeight=viewBox[3]||600,scale=2;
  const headerHeight=170,legendHeight=210,canvas=document.createElement("canvas");
  canvas.width=sourceWidth*scale;canvas.height=headerHeight+sourceHeight*scale+legendHeight;
  const context=canvas.getContext("2d");
  if(!context)return;
  context.fillStyle="#ffffff";context.fillRect(0,0,canvas.width,canvas.height);
  context.fillStyle="#173f38";context.font='600 48px "PingFang SC","Microsoft YaHei",sans-serif';context.fillText(options.title,60,70,canvas.width-120);
  context.fillStyle="#687872";context.font='26px "PingFang SC","Microsoft YaHei",sans-serif';context.fillText(options.subtitle,60,118,canvas.width-120);

  const clone=svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width",String(sourceWidth*scale));clone.setAttribute("height",String(sourceHeight*scale));
  clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
  const style=document.createElementNS("http://www.w3.org/2000/svg","style");
  style.textContent=`
    svg{background:#f4f8f4;font-family:"PingFang SC","Microsoft YaHei",sans-serif}
    .county,.populationCounty,.townCountyBackground{fill:#e2ebe5;stroke:#fff;stroke-width:1.5;vector-effect:non-scaling-stroke}
    .populationTown{fill:#dfe9e3;stroke:#fff;stroke-width:.55;opacity:.86;vector-effect:non-scaling-stroke}
    .townBoundary{fill:#e4ebe7;stroke:#fff;stroke-width:.7;vector-effect:non-scaling-stroke}
    .townBoundary.sideA{fill:#a9cec3}.townBoundary.sideB{fill:#ecd39b}
    .flow,.populationFlow,.townFlow{fill:none;stroke-linecap:round;vector-effect:non-scaling-stroke}
    .flowHit,.populationFlowHit{display:none}
    circle{fill:#173f38}
    text{font-size:10px;fill:#37554d;paint-order:stroke;stroke:#f7faf7;stroke-width:3px}
    .quadrantGrid{stroke:#dce4df;stroke-width:1}
    .quadrantZero{stroke:#253f38;stroke-width:1.35}
    .quadrantTick,.quadrantAxis,.quadrantLabel{fill:#687872;stroke:none;paint-order:normal}
    .quadrantTick{font-size:12px}.quadrantAxis{font-size:13px;font-weight:650;fill:#38534b}.quadrantLabel{font-size:12px;font-weight:750;fill:#314b43}
    .quadrantPoint{stroke:#fff;stroke-width:1.2;opacity:.86}.quadrantPoint.high{stroke:#c99a2e;stroke-width:3}.quadrantPoint.dimmed{opacity:.08}.quadrantPoint.selected{opacity:1;stroke:#173f38;stroke-width:2.2}
    .quadrantSelectedLabel{fill:#173f38;font-size:12px;font-weight:800;stroke:#fff;stroke-width:4px}
  `;
  clone.insertBefore(style,clone.firstChild);
  const background=document.createElementNS("http://www.w3.org/2000/svg","rect");
  background.setAttribute("x",String(viewBox[0]));background.setAttribute("y",String(viewBox[1]));
  background.setAttribute("width",String(sourceWidth));background.setAttribute("height",String(sourceHeight));background.setAttribute("fill","#f4f8f4");
  clone.insertBefore(background,style.nextSibling);
  const blob=new Blob([new XMLSerializer().serializeToString(clone)],{type:"image/svg+xml;charset=utf-8"});
  const sourceUrl=URL.createObjectURL(blob),image=new Image();
  await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error("地图图像生成失败"));image.src=sourceUrl});
  context.drawImage(image,0,headerHeight,sourceWidth*scale,sourceHeight*scale);URL.revokeObjectURL(sourceUrl);

  const legendY=headerHeight+sourceHeight*scale+58;
  context.fillStyle="#173f38";context.font='600 25px "PingFang SC","Microsoft YaHei",sans-serif';context.fillText(options.legendTitle,60,legendY);
  let x=260,rowY=legendY;
  context.font='22px "PingFang SC","Microsoft YaHei",sans-serif';
  for(const item of options.legend){
    const itemWidth=54+context.measureText(item.label).width+38;
    if(x+itemWidth>canvas.width-60){x=260;rowY+=52}
    context.fillStyle=item.color;context.fillRect(x,rowY-24,42,22);
    context.fillStyle="#52645e";context.fillText(item.label,x+54,rowY-4);
    x+=itemWidth;
  }
  context.fillStyle="#8a9692";context.font='18px "PingFang SC","Microsoft YaHei",sans-serif';
  context.fillText(`导出时间：${new Date().toLocaleString("zh-CN",{hour12:false})}`,60,legendY+112);

  const png=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/png",1));
  if(!png)return;
  const downloadUrl=URL.createObjectURL(png),link=document.createElement("a");
  link.href=downloadUrl;link.download=`${safeFilename(options.filename||options.title)}.png`;link.click();
  window.setTimeout(()=>URL.revokeObjectURL(downloadUrl),1000);
}
