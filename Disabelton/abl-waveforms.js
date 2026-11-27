/**
 * abl-waveforms.js: canvas waveforms for Disabelton on top of waveform-pyramid.js.
 *
 * A waveform that was seen once is never replaced by a placeholder. Peaks are cached
 * per clip source in the pyramid, so every scroll / zoom / drag / trim repaints
 * synchronously from memory (coarser data is stretched while finer tiles load). This
 * module only maps clip geometry to a source range and draws peak buckets; it never
 * decodes or plays audio.
 *
 * Geometry (pure helpers, unit-tested):
 *   clipSourceWindow()  the source second shown at the clip element's left edge and
 *                       the px-per-second scale, including a live left-trim preview
 *                       (element narrower/wider than the model with the right edge
 *                       fixed) and a slip preview (offset override).
 *   visibleSpan()       the part of the clip element inside the viewport (+margin),
 *                       so the canvas never grows with the zoom.
 */
import {WaveformPyramid,restPeaksFetcher} from './waveform-pyramid.js';

const finite=value=>typeof value==='number'&&Number.isFinite(value);

/** Source window of a clip element. Beats are quarter notes; audio is not tempo-warped. */
export function clipSourceWindow({start,length,offset=0,bpm,pxPerBeat,elementLeft,elementWidth,offsetOverride=null}){
 if(!(bpm>0)||!(pxPerBeat>0))return null;
 const secPerBeat=60/bpm,pxPerSec=pxPerBeat/secPerBeat;
 let offsetBeats=finite(offsetOverride)?offsetOverride:(finite(offset)?offset:0);
 if(!finite(offsetOverride)&&finite(elementLeft)&&finite(elementWidth)&&finite(start)&&finite(length)){
  const modelLeft=start*pxPerBeat,modelWidth=length*pxPerBeat;
  // Left-trim preview: the width changed while the right edge stayed where the model has it.
  if(Math.abs(elementWidth-modelWidth)>.75&&Math.abs(elementLeft+elementWidth-(modelLeft+modelWidth))<=1.5)offsetBeats+=(elementLeft-modelLeft)/pxPerBeat;
 }
 return{startSec:Math.max(0,offsetBeats*secPerBeat),pxPerSec};
}

/** Visible part of an element ([from,to) px inside the element), widened by `margin`, capped at `maxWidth`. */
export function visibleSpan({elementLeft,elementWidth,viewLeft,viewRight,margin=256,maxWidth=8192}){
 if(!(elementWidth>0))return null;
 let from=Math.max(0,viewLeft-margin-elementLeft),to=Math.min(elementWidth,viewRight+margin-elementLeft);
 if(!(to>from))return null;
 from=Math.floor(from);to=Math.ceil(to);
 if(to-from>maxWidth){const centre=Math.max(from,Math.min(to,(Math.max(viewLeft,elementLeft)+Math.min(viewRight,elementLeft+elementWidth))/2-elementLeft));from=Math.max(from,Math.floor(centre-maxWidth/2));to=Math.min(to,from+maxWidth);}
 return{from,to};
}

/** True where a 2D canvas exists (not in the DOM test shim): the caller keeps its legacy drawing otherwise. */
export function canvasWaveformsSupported(doc=globalThis.document){
 // A real 2D context: DOM test shims return null or a partial stub, and then the SVG fallback stays in charge.
 try{const context=doc?.createElement?.('canvas')?.getContext?.('2d');return !!context&&['setTransform','getTransform','clearRect','beginPath','rect','fill'].every(name=>typeof context[name]==='function');}catch{return false;}
}

/**
 * Arrangement + Clip View waveform painter.
 * @param {object} o
 *  host()            → Freestyle host (apiFetch)
 *  getProjectId(), getTrackId()
 *  getClip(id)       → {cloudId,start,length,offset,volume} | null   (beats)
 *  getBpm(), getPxPerBeat()
 *  root              → element holding `.audio-clip[data-clip]` (Arrangement lanes)
 *  viewport          → the Arrangement scroller
 */
export class AblWaveforms{
 constructor({host,getProjectId,getTrackId=()=>null,getClip,getBpm,getPxPerBeat,root,viewport,document:doc=globalThis.document,pyramid=null,onPaint=null}){
  /* Clips that exist only on screen (a take being recorded): id → {cloudId,start,length,offset}. */
  this.liveClips=new Map();
  Object.assign(this,{getClip:id=>this.liveClips.get(id)||getClip(id),getBpm,getPxPerBeat,root,viewport,doc,onPaint});
  const view=doc.defaultView||globalThis;this.view=view;
  this.pyramid=pyramid||new WaveformPyramid({fetchPeaks:restPeaksFetcher({apiFetch:(path,init)=>host().apiFetch(path,init),getProjectId,getTrackId}),onUpdate:clipId=>this.updated(clipId)});
  this.frame=null;this.destroyed=false;this.epoch=0;this.detail=null;this.stats={paints:0,skips:0,empty:0};
  this.schedule=()=>{if(this.destroyed||this.frame!==null)return;this.frame=view.requestAnimationFrame(()=>{this.frame=null;this.paintAll();});};
  this.now=()=>{if(this.destroyed)return;if(this.frame!==null){view.cancelAnimationFrame(this.frame);this.frame=null;}this.paintAll();};
  // Scroll paints in the same frame; DOM re-renders and gesture previews (style changes) paint before the next frame.
  viewport?.addEventListener('scroll',this.now,{passive:true});
  view.addEventListener('resize',this.schedule);
  const Observer=view.MutationObserver;if(Observer&&root){this.observer=new Observer(records=>{if(records.some(record=>!(record.target instanceof view.HTMLCanvasElement)))this.now();});this.observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','data-wave-offset']});}
  const Resize=view.ResizeObserver;if(Resize&&root){this.resize=new Resize(()=>this.schedule());this.resize.observe(root);if(viewport)this.resize.observe(viewport);}
 }
 updated(clipId){this.epoch++;this.schedule();if(this.detail?.clipId===clipId)this.paintDetail();}
 sourceId(clip){return clip?.cloudId??(clip?.id==='backing'?'backing':null);}
 /** Warm the overview of every audio clip of the project (cheap: one read each, three at a time). */
 prefetch(clips){for(const clip of clips||[]){const id=this.sourceId(clip);if(id)this.pyramid.prefetch(id);}}
 sync(clips){this.pyramid.sync([...(clips||[]).map(clip=>this.sourceId(clip)).filter(Boolean),...this.liveClips.keys()]);}
 invalidate(clipId){this.pyramid.invalidate(clipId);this.epoch++;this.schedule();}
 reset(){this.pyramid.sync([]);this.epoch++;}
 canvasFor(host,className){
  let canvas=host.querySelector(`:scope > canvas.${className}`);
  if(!canvas){canvas=this.doc.createElement('canvas');canvas.className=className;canvas.setAttribute('aria-hidden','true');host.append(canvas);}
  return canvas;
 }
 /** Paint one canvas: `from..to` px of a strip whose px 0 shows `startSec`. Returns the pyramid status. */
 draw(canvas,{clipId,from,to,height,startSec,pxPerSec,gain=1,color,rmsColor,signature}){
  const dpr=Math.max(1,Math.min(3,this.view.devicePixelRatio||1)),width=to-from;
  const key=`${signature}|${from}|${to}|${height}|${dpr}|${this.epoch}`;
  if(canvas._ablKey===key){this.stats.skips++;return canvas.dataset.waveformStatus||'empty';}
  const pixelWidth=Math.max(1,Math.round(width*dpr)),pixelHeight=Math.max(1,Math.round(height*dpr));
  // Resizing a canvas clears it: do it only when the size really changed, then repaint in the same task.
  if(canvas.width!==pixelWidth)canvas.width=pixelWidth;if(canvas.height!==pixelHeight)canvas.height=pixelHeight;
  canvas.style.left=`${from}px`;canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  const result=this.pyramid.paint(ctx,clipId,{x:0,y:0,width,height,startSec:startSec+from/pxPerSec,endSec:startSec+to/pxPerSec,gain,color,rmsColor,mono:height<36});
  canvas._ablKey=key;canvas.dataset.waveformStatus=result.status;
  this.stats.paints++;if(result.status==='empty')this.stats.empty++;
  return result.status;
 }
 paintAll(){
  if(this.destroyed||!this.root||!this.viewport)return;
  const bpm=this.getBpm(),pxPerBeat=this.getPxPerBeat();if(!(bpm>0)||!(pxPerBeat>0))return;
  const view=this.viewport.getBoundingClientRect();if(!(view.width>0))return;
  for(const element of this.root.querySelectorAll('.audio-clip[data-clip]')){
   const clip=this.getClip(element.dataset.clip),clipId=this.sourceId(clip),host=element.querySelector('.audio-waveform')||element;
   if(!clipId)continue;
   const rect=element.getBoundingClientRect();
   if(rect.bottom<view.top-200||rect.top>view.bottom+200)continue;
   const span=visibleSpan({elementLeft:rect.left,elementWidth:rect.width,viewLeft:view.left,viewRight:view.right});
   if(!span)continue;
   const override=element.dataset.waveOffset,source=clipSourceWindow({start:clip.start,length:clip.length,offset:clip.offset,bpm,pxPerBeat,elementLeft:rect.left-(element.parentElement?.getBoundingClientRect().left??rect.left-element.offsetLeft),elementWidth:rect.width,offsetOverride:override!==undefined&&override!==''?Number(override):null});
   if(!source)continue;
   const canvas=this.canvasFor(host,'abl-wave-canvas'),top=canvas.offsetTop||12,height=Math.max(4,Math.round((element.clientHeight||rect.height-2)-top));span.from=Math.max(0,span.from-(element.clientLeft||0));span.to=Math.max(span.from+1,span.to-(element.clientLeft||0));const placementGain=this.pyramid.info(clipId)?.placement?.gain;
   const status=this.draw(canvas,{clipId,from:span.from,to:span.to,height,startSec:source.startSec,pxPerSec:source.pxPerSec,gain:finite(placementGain)?placementGain:1,color:'rgba(0,0,0,.66)',rmsColor:'rgba(0,0,0,.22)',signature:`${clipId}|${source.startSec.toFixed(6)}|${source.pxPerSec.toFixed(6)}|${placementGain}`});
   host.dataset.waveformStatus=status==='empty'?(this.pyramid.clips.get(clipId)?.lastError&&!this.pyramid.has(clipId)?'error':'loading'):'ready';
  }
  try{this.onPaint?.(this.stats);}catch{}
 }
 /**
  * Clip View sample display: `host` shows [startSec,endSec) of the clip's source across its full width.
  * Call again whenever the window changes (zoom, scroll, trim); repaint is synchronous from cache.
  */
 showDetail(host,clip,{startSec,endSec,gain=1,color='rgba(20,20,20,.85)',rmsColor='rgba(0,0,0,.25)'}={}){
  const clipId=this.sourceId(clip);if(!host||!clipId||!(endSec>startSec)){this.detail=null;return'empty';}
  this.detail={host,clipId,startSec,endSec,gain,color,rmsColor};
  if(!this.detailResize&&this.view.ResizeObserver){this.detailResize=new this.view.ResizeObserver(()=>this.paintDetail());}
  if(this.detailHost!==host){this.detailResize?.disconnect();this.detailResize?.observe(host);this.detailHost=host;}
  return this.paintDetail();
 }
 paintDetail(){
  const detail=this.detail;if(!detail||this.destroyed||!detail.host.isConnected)return'empty';
  const width=Math.floor(detail.host.clientWidth),height=Math.floor(detail.host.clientHeight);if(!(width>0)||!(height>0))return'empty';
  const canvas=this.canvasFor(detail.host,'abl-wave-canvas'),pxPerSec=width/(detail.endSec-detail.startSec);
  const status=this.draw(canvas,{clipId:detail.clipId,from:0,to:width,height,startSec:detail.startSec,pxPerSec,gain:detail.gain,color:detail.color,rmsColor:detail.rmsColor,signature:`d|${detail.clipId}|${detail.startSec.toFixed(6)}|${detail.endSec.toFixed(6)}|${detail.gain}`});
  detail.host.dataset.status=status==='empty'?'loading':'ready';
  return status;
 }
 info(clip){const id=this.sourceId(clip);return id?this.pyramid.info(id):null;}
 destroy(){
  this.destroyed=true;if(this.frame!==null)this.view.cancelAnimationFrame(this.frame);
  this.viewport?.removeEventListener('scroll',this.now);this.view.removeEventListener('resize',this.schedule);
  this.observer?.disconnect();this.resize?.disconnect();this.detailResize?.disconnect();this.pyramid.destroy();
 }
}
