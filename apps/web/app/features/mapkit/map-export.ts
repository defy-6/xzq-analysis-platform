export type MapLegendItem={color?:string;label:string;heading?:boolean;shape?: "circle"|"square"|"diamond"|"triangle"|"ring"|"line";lineWidth?:number};

function drawLegendShape(context:CanvasRenderingContext2D,item:MapLegendItem,x:number,y:number,size:number){
  const cx=x+size/2,cy=y+size/2;
  context.save();
  switch(item.shape||"square"){
    case "line":{
      const lineHeight=item.lineWidth?Math.max(1.5,Math.min(6.5,item.lineWidth*2.2)):4;
      context.fillStyle=item.color||"#cccccc";context.fillRect(x,cy-lineHeight/2,size,lineHeight);break;
    }
    case "circle":
      context.beginPath();context.arc(cx,cy,size/2,0,Math.PI*2);context.fillStyle=item.color||"#cccccc";context.fill();break;
    case "diamond":
      context.translate(cx,cy);context.rotate(Math.PI/4);context.fillStyle=item.color||"#cccccc";context.fillRect(-size/2,-size/2,size,size);break;
    case "triangle":
      context.beginPath();context.moveTo(cx,cy-size/2);context.lineTo(cx+size/2,cy+size/2);context.lineTo(cx-size/2,cy+size/2);context.closePath();context.fillStyle=item.color||"#cccccc";context.fill();break;
    case "ring":
      context.beginPath();context.arc(cx,cy,size/2-3,0,Math.PI*2);context.fillStyle="#ffffff";context.fill();context.lineWidth=Math.max(3,size/9);context.strokeStyle=item.color||"#c0352c";context.stroke();break;
    default:
      context.fillStyle=item.color||"#cccccc";context.fillRect(x,y,size,size);break;
  }
  context.restore();
}

const numberLabel=(value:number,digits:number)=>new Intl.NumberFormat("zh-CN",{maximumFractionDigits:digits}).format(value);

export function numericLegend(colors:string[],breaks:number[],values:number[],unit:string,digits=0,lineWidths?:number[]):MapLegendItem[]{  const finite=values.filter(Number.isFinite);
  if(!finite.length)return colors.map((color,index)=>({color,label:index===2?"无数据":"—",shape:lineWidths?"line":undefined,lineWidth:lineWidths?lineWidths[index]:undefined}));
  if(!breaks.length||breaks.every(value=>value===breaks[0])){
    return [{color:colors[2],label:`全部 ${numberLabel(finite[0],digits)}${unit}`,shape:lineWidths?"line":undefined,lineWidth:lineWidths?lineWidths[2]:undefined}];
  }
  const labels=[
    `≤ ${numberLabel(breaks[0],digits)}${unit}`,
    `${numberLabel(breaks[0],digits)}–${numberLabel(breaks[1],digits)}${unit}`,
    `${numberLabel(breaks[1],digits)}–${numberLabel(breaks[2],digits)}${unit}`,
    `${numberLabel(breaks[2],digits)}–${numberLabel(breaks[3],digits)}${unit}`,
    `> ${numberLabel(breaks[3],digits)}${unit}`
  ];
  return colors.map((color,index)=>({color,label:labels[index],shape:lineWidths?"line":undefined,lineWidth:lineWidths?lineWidths[index]:undefined}));
}

const safeFilename=(value:string)=>value.replace(/[\\/:*?"<>|]/g,"-").replace(/\s+/g,"_");

function showExportPreview(blob:Blob,filename:string){
  const overlay=document.createElement("div");
  overlay.style.cssText="position:fixed;inset:0;z-index:9999;background:#0b1f1ab0;display:grid;place-items:center;padding:24px;font-family:'PingFang SC','Microsoft YaHei',sans-serif";
  const panel=document.createElement("div");
  panel.style.cssText="max-width:min(1200px,92vw);max-height:92vh;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:14px;background:#fff;border-radius:14px;padding:18px 20px;box-shadow:0 24px 80px #071b1755";
  const head=document.createElement("div");
  head.style.cssText="display:flex;align-items:center;justify-content:space-between;gap:16px;color:#173f38";
  const title=document.createElement("strong");title.textContent="导出预览";title.style.fontSize="15px";
  const closeButton=document.createElement("button");closeButton.textContent="×";closeButton.setAttribute("aria-label","关闭预览");
  closeButton.style.cssText="border:0;background:none;font-size:22px;cursor:pointer;color:#173f38;line-height:1";
  head.append(title,closeButton);
  const img=document.createElement("img");
  img.style.cssText="max-width:100%;max-height:calc(92vh - 170px);display:block;margin:0 auto;border:1px solid #e3e9e5;border-radius:8px";
  img.alt="导出预览";
  const actions=document.createElement("div");
  actions.style.cssText="display:flex;justify-content:flex-end;gap:10px";
  const download=document.createElement("button");download.textContent="下载 PNG";
  download.style.cssText="border:1px solid #b9cbc4;border-radius:8px;background:#173f38;color:#fff;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer";
  const cancel=document.createElement("button");cancel.textContent="取消";
  cancel.style.cssText="border:1px solid #d8e2dc;border-radius:8px;background:#fff;color:#315349;padding:9px 18px;font-size:13px;cursor:pointer";
  actions.append(cancel,download);
  panel.append(head,img,actions);
  overlay.append(panel);
  document.body.append(overlay);
  const url=URL.createObjectURL(blob);
  img.src=url;
  const close=()=>{overlay.remove();URL.revokeObjectURL(url);document.removeEventListener("keydown",onKey)};
  const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")close()};
  closeButton.onclick=close;cancel.onclick=close;
  overlay.onclick=event=>{if(event.target===overlay)close()};
  document.addEventListener("keydown",onKey);
  download.onclick=()=>{const link=document.createElement("a");link.href=url;link.download=filename;link.click()};
}

/** 导出始终带标注:若标注被调试开关关闭,临时开启 → 双 rAF 等待渲染 → 导出 → 恢复关闭。 */
export function exportWithLabelsOn(labelsOn:boolean,setLabelsOn:(on:boolean)=>void,run:()=>void){
  if(labelsOn){run();return}
  setLabelsOn(true);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{run();setLabelsOn(false)}));
}

export async function exportMapPng(svg:SVGSVGElement|null,options:{title:string;subtitle:string;legendTitle:string;legend:MapLegendItem[];filename?:string;kmPerPixel?:number;legendPlacement?: "overlay"|"bottom"}){
  if(!svg)return;
  const viewBox=(svg.getAttribute("viewBox")||"0 0 900 600").split(/\s+/).map(Number);
  const sourceWidth=viewBox[2]||900,sourceHeight=viewBox[3]||600;
  const exportWidth=1800,mapAreaHeight=1200,headerHeight=170,canvas=document.createElement("canvas");
  const legendPlacement=options.legendPlacement??"overlay";
  const legendHeight=legendPlacement==="bottom"?210:0;
  canvas.width=exportWidth;canvas.height=headerHeight+mapAreaHeight+legendHeight;
  const context=canvas.getContext("2d");
  if(!context)return;
  context.fillStyle="#ffffff";context.fillRect(0,0,canvas.width,canvas.height);
  context.fillStyle="#173f38";context.font='600 48px "PingFang SC","Microsoft YaHei",sans-serif';context.fillText(options.title,60,70,canvas.width-120);
  context.fillStyle="#687872";
  let subtitleSize=26;context.font=`${subtitleSize}px "PingFang SC","Microsoft YaHei",sans-serif`;
  if(context.measureText(options.subtitle||"").width>canvas.width-120){subtitleSize=20;context.font=`${subtitleSize}px "PingFang SC","Microsoft YaHei",sans-serif`}
  context.fillText(options.subtitle||"",60,118,canvas.width-120);

  const clone=svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width",String(sourceWidth*2));clone.setAttribute("height",String(sourceHeight*2));
  clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
  const style=document.createElementNS("http://www.w3.org/2000/svg","style");
  style.textContent=`
    svg{background:#f4f8f4;font-family:"PingFang SC","Microsoft YaHei",sans-serif}
    .fujianPrefectureBackdrop{fill:#fbfcfb;fill-opacity:.78;stroke:#c9d0cd;stroke-width:.75;stroke-linejoin:round;stroke-linecap:round}
    .county,.populationCounty{fill:#e4ebe7;stroke:#aebdb6;stroke-width:.8;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
    .thematicCounty{fill:#e5ebe7;stroke:#aebdb6;stroke-width:.8;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
    .thematicCounty.muted{fill:#e8edea;opacity:.45}.thematicCounty.selected{stroke:#173f38;stroke-width:3}
    .townCountyBackground{fill:#e8eeea;stroke:#fff;stroke-width:1.05;opacity:.82;vector-effect:non-scaling-stroke}
    .populationTown{fill:#dfe9e3;stroke:#fff;stroke-width:.45;opacity:.86;vector-effect:non-scaling-stroke}
    .townBoundary{fill:#e7ece9;stroke:#fff;stroke-width:.65;opacity:.48;vector-effect:non-scaling-stroke}
    .townBoundary.selected{opacity:.95;stroke:#f9fbf9;stroke-width:1.05}
    .townBoundary.selected.sideA{fill:#9fb9d9}.townBoundary.selected.sideB{fill:#d9bdcc}
    .townshipCountyOverlay{fill:none;stroke:#fff;stroke-width:1.25;stroke-linejoin:round;stroke-linecap:round}
    .flow,.populationFlow,.townFlow{fill:none;stroke-linecap:round;vector-effect:non-scaling-stroke}
    .routeAllLine{fill:none;stroke:#d97706;stroke-width:1;opacity:.1;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
    .drivingRoute{fill:none;stroke:#e67e22;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;opacity:.62;vector-effect:non-scaling-stroke}
    .drivingRoute.routeBack{stroke:#3d7dd8;stroke-width:1.6;opacity:.35;stroke-dasharray:5 3}
    .flowHit,.populationFlowHit{display:none}
    .mapDecorations text{font-size:13px;fill:#65716c;stroke:none}
    circle{fill:#173f38}
    text{font-size:10px;fill:#37554d;paint-order:stroke;stroke:#f7faf7;stroke-width:3px}
    .quadrantGrid{stroke:#dce4df;stroke-width:1}
    .quadrantZero{stroke:#253f38;stroke-width:1.35}
    .quadrantTick,.quadrantAxis,.quadrantLabel{fill:#687872;stroke:none;paint-order:normal}
    .quadrantTick{font-size:12px}.quadrantAxis{font-size:13px;font-weight:650;fill:#38534b}.quadrantLabel{font-size:12px;font-weight:750;fill:#314b43}
    .quadrantPoint{stroke:#fff;stroke-width:1.2;opacity:.86}.quadrantPoint.high{stroke:#c0352c;stroke-width:3}.quadrantPoint.dimmed{opacity:.08}.quadrantPoint.selected{opacity:1;stroke:#173f38;stroke-width:2.2}
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
  context.fillStyle="#f4f8f4";context.fillRect(0,headerHeight,exportWidth,mapAreaHeight);
  const mapScale=Math.min(exportWidth/sourceWidth,mapAreaHeight/sourceHeight);
  const drawWidth=Math.round(sourceWidth*mapScale),drawHeight=Math.round(sourceHeight*mapScale);
  const drawX=Math.round((exportWidth-drawWidth)/2),drawY=Math.round(headerHeight+(mapAreaHeight-drawHeight)/2);
  context.drawImage(image,drawX,drawY,drawWidth,drawHeight);URL.revokeObjectURL(sourceUrl);

  if(legendPlacement==="overlay"){
  // 图例浮在地图区左上角（参考页面图例：标题 + 分组 + 纵向排布）
  context.font='600 24px "PingFang SC","Microsoft YaHei",sans-serif';
  const legendTitleWidth=context.measureText(options.legendTitle).width;
  context.font='20px "PingFang SC","Microsoft YaHei",sans-serif';
  let legendMaxLabel=0;for(const item of options.legend){legendMaxLabel=Math.max(legendMaxLabel,context.measureText(item.label).width)}
  const legendBoxWidth=Math.min(Math.max(legendTitleWidth,legendMaxLabel)+60,exportWidth-28);
  const legendBoxHeight=64+options.legend.length*34+16;
  const legendX=14,legendY=headerHeight+28;
  context.fillStyle="#ffffffed";context.fillRect(legendX,legendY,legendBoxWidth,legendBoxHeight);
  context.strokeStyle="#e3e9e5";context.strokeRect(legendX,legendY,legendBoxWidth,legendBoxHeight);
  context.fillStyle="#173f38";context.font='600 24px "PingFang SC","Microsoft YaHei",sans-serif';context.fillText(options.legendTitle,legendX+14,legendY+40);
  let legendRowY=legendY+80;
  context.font='20px "PingFang SC","Microsoft YaHei",sans-serif';
  for(const item of options.legend){
    if(item.heading){context.fillStyle="#173f38";context.font='600 20px "PingFang SC","Microsoft YaHei",sans-serif';context.fillText(item.label,legendX+14,legendRowY);context.font='20px "PingFang SC","Microsoft YaHei",sans-serif';legendRowY+=34;continue}
    if(item.shape==="line"){const lineHeight=item.lineWidth?Math.max(1.5,Math.min(6.5,item.lineWidth*2.2)):4;context.fillStyle=item.color||"#cccccc";context.fillRect(legendX+14,legendRowY-16-lineHeight/2+5,22,lineHeight)}
    else{context.fillStyle=item.color||"#cccccc";context.fillRect(legendX+14,legendRowY-16,22,11)}
    context.fillStyle="#5f706a";context.fillText(item.label,legendX+46,legendRowY-5);
    legendRowY+=34;
  }
  }else{
    // 图例在画布底部横排居中（散点图等非地图导出，参考网页 quadrantLegend 横排样式）
    const legendY=headerHeight+mapAreaHeight+58;
    const legendGap=40,shapeSize=24;
    context.font='22px "PingFang SC","Microsoft YaHei",sans-serif';
    let legendTotalWidth=0;for(const item of options.legend){legendTotalWidth+=shapeSize+14+context.measureText(item.label).width+legendGap}
    legendTotalWidth-=legendGap;
    context.textAlign="center";context.fillStyle="#173f38";context.font='600 26px "PingFang SC","Microsoft YaHei",sans-serif';context.fillText(options.legendTitle,exportWidth/2,legendY);context.textAlign="left";
    let legendX=(exportWidth-legendTotalWidth)/2;const legendRow=legendY+56;
    context.font='22px "PingFang SC","Microsoft YaHei",sans-serif';
    for(const item of options.legend){
      drawLegendShape(context,item,legendX,legendRow-26,shapeSize);
      context.fillStyle="#52645e";context.fillText(item.label,legendX+shapeSize+14,legendRow-6);
      legendX+=shapeSize+14+context.measureText(item.label).width+legendGap;
    }
  }

  const png=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/png",1));
  if(!png)return;
  showExportPreview(png,`${safeFilename(options.filename||options.title)}.png`);
}
