/**
 * Audio Track Editor (Logic: Editors ▸ Track): the selected audio region's
 * waveform, zoomable from the whole region down to single samples.
 *
 * The view is virtual: one canvas the size of the pane shows the visible source
 * window, painted synchronously from the WaveformPyramid on every scroll, zoom
 * and playhead tick. Finer tiles load in the background and repaint; a waveform
 * that has been drawn is never replaced by a placeholder.
 * This module only draws Freestyle's peak buckets; it never decodes or plays audio.
 */
export const AUDIO_EDITOR_MAX_PX_PER_FRAME=16;      // deepest zoom: one sample = 16 px
export const AUDIO_EDITOR_MIN_VIEW_PX=24;

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** Zoom limits for a region `lengthSec` long in a pane `width` px wide at `sampleRate`. */
export function audioEditorZoomRange({lengthSec,width,sampleRate=48000}){
 const fit=lengthSec>0&&width>0?lengthSec/width:1,deepest=1/(Math.max(1,sampleRate)*AUDIO_EDITOR_MAX_PX_PER_FRAME);
 return{max:Math.max(fit,deepest),min:Math.min(fit,deepest)}; // seconds per pixel: max = zoomed out (fit), min = zoomed in
}
/** Clamp a view {startSec, secondsPerPixel} to the region. */
export function clampAudioEditorView(view,{lengthSec,width,sampleRate=48000}){
 const range=audioEditorZoomRange({lengthSec,width,sampleRate}),secondsPerPixel=clamp(Number(view.secondsPerPixel)||range.max,range.min,range.max);
 const span=width*secondsPerPixel,startSec=clamp(Number(view.startSec)||0,0,Math.max(0,lengthSec-span));
 return{startSec,secondsPerPixel};
}
/** Zoom by `factor` (>1 zooms in) keeping the time under pixel `anchorX` fixed. */
export function zoomAudioEditorView(view,factor,anchorX,limits){
 const at=view.startSec+anchorX*view.secondsPerPixel,next=clampAudioEditorView({startSec:0,secondsPerPixel:view.secondsPerPixel/factor},limits);
 return clampAudioEditorView({startSec:at-anchorX*next.secondsPerPixel,secondsPerPixel:next.secondsPerPixel},limits);
}
/** Ruler ticks for the visible window. Units: bars/beats while a beat is wide enough, then seconds, then samples. */
export function audioEditorTicks({startSec,secondsPerPixel,width,bpm=120,regionStartBeat=0,sampleRate=48000,minGap=64}){
 const ticks=[],endSec=startSec+width*secondsPerPixel,secondsPerBeat=60/(Number(bpm)>0?Number(bpm):120),framesPerPixel=secondsPerPixel*sampleRate;
 if(framesPerPixel<=.5){
  const step=Math.max(1,Math.ceil(minGap*framesPerPixel)),first=Math.ceil(startSec*sampleRate/step)*step;
  for(let frame=first;frame/sampleRate<=endSec&&ticks.length<400;frame+=step)ticks.push({x:(frame/sampleRate-startSec)/secondsPerPixel,label:String(frame),unit:'samples'});
  return ticks;
 }
 const beatPx=secondsPerBeat/secondsPerPixel;
 if(beatPx*4>=minGap*1.5&&beatPx<=minGap*24){
  // Bars and beats on the project grid: the region starts at regionStartBeat.
  const perTick=beatPx>=minGap?1:beatPx*2>=minGap?2:4,originBeat=regionStartBeat+startSec/secondsPerBeat,first=Math.ceil(originBeat/perTick-1e-9)*perTick;
  for(let beat=first;(beat-regionStartBeat)*secondsPerBeat<=endSec&&ticks.length<400;beat+=perTick){
   const bar=Math.floor(beat/4)+1,inBar=Math.round(beat%4)+1;
   ticks.push({x:((beat-regionStartBeat)*secondsPerBeat-startSec)/secondsPerPixel,label:inBar===1?String(bar):`${bar}.${inBar}`,unit:'beats',major:inBar===1});
  }
  return ticks;
 }
 if(beatPx*4<minGap*1.5){
  const barsPerTick=Math.pow(2,Math.ceil(Math.log2(minGap*1.5/(beatPx*4)))),perTick=barsPerTick*4,originBeat=regionStartBeat+startSec/secondsPerBeat,first=Math.ceil(originBeat/perTick-1e-9)*perTick;
  for(let beat=first;(beat-regionStartBeat)*secondsPerBeat<=endSec&&ticks.length<400;beat+=perTick)ticks.push({x:((beat-regionStartBeat)*secondsPerBeat-startSec)/secondsPerPixel,label:String(Math.floor(beat/4)+1),unit:'beats',major:true});
  return ticks;
 }
 // Finer than beats: milliseconds of source time.
 const steps=[.0001,.0002,.0005,.001,.002,.005,.01,.02,.05,.1,.2,.5,1],step=steps.find(value=>value/secondsPerPixel>=minGap)||1,first=Math.ceil(startSec/step-1e-9)*step;
 for(let time=first;time<=endSec&&ticks.length<400;time+=step)ticks.push({x:(time-startSec)/secondsPerPixel,label:`${(time*1000).toFixed(step<.001?1:0)} ms`,unit:'time'});
 return ticks;
}

/**
 * Mount the editor into `element` (the pane body). Options:
 *   pyramid       WaveformPyramid
 *   getRegion()   → {clipId, name, offsetSec, lengthSec, startBeat, bpm, gain, color} | null
 *   getPlayheadBeat() → beat | null
 */
export function mountAudioEditor(element,{pyramid,getRegion,getPlayheadBeat=()=>null,onSeekBeat=null,document:doc=globalThis.document,window:win=globalThis}={}){
 if(!element||!pyramid||typeof getRegion!=='function')throw new TypeError('mountAudioEditor needs an element, a pyramid and getRegion.');
 element.classList.add('logic-audio-editor');
 element.innerHTML='<div class="logic-audio-editor-overview" title="Region overview: drag to scroll"><canvas></canvas><i class="logic-audio-editor-window"></i></div><div class="logic-audio-editor-ruler"><canvas></canvas></div><div class="logic-audio-editor-stage" tabindex="0" aria-label="Audio Track Editor waveform"><canvas></canvas><i class="logic-audio-editor-playhead"></i><p class="logic-audio-editor-empty" hidden></p></div>';
 const stage=element.querySelector('.logic-audio-editor-stage'),canvas=stage.querySelector('canvas'),ruler=element.querySelector('.logic-audio-editor-ruler canvas'),overview=element.querySelector('.logic-audio-editor-overview'),overviewCanvas=overview.querySelector('canvas'),windowMark=overview.querySelector('.logic-audio-editor-window'),playhead=stage.querySelector('.logic-audio-editor-playhead'),empty=stage.querySelector('.logic-audio-editor-empty');
 const state={view:{startSec:0,secondsPerPixel:0},regionKey:'',painted:'',overviewKey:'',destroyed:false,lastStatus:'empty'};
 const dpr=()=>clamp(win.devicePixelRatio||1,1,3);
 const sampleRate=region=>pyramid.info(region.clipId)?.sampleRate||48000;
 const limits=region=>({lengthSec:region.lengthSec,width:Math.max(1,stage.clientWidth),sampleRate:sampleRate(region)});
 const size=(target,width,height)=>{const ratio=dpr(),w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));if(target.width!==w)target.width=w;if(target.height!==h)target.height=h;const context=target.getContext?.('2d');context?.setTransform(ratio,0,0,ratio,0,0);return context;};
 function region(){let value=null;try{value=getRegion();}catch{value=null;}return value&&value.clipId&&value.lengthSec>0?value:null;}
 function paint(){
  if(state.destroyed||!element.isConnected)return'hidden';
  const current=region(),width=stage.clientWidth,height=stage.clientHeight;
  if(!current){empty.hidden=false;empty.textContent='Select an audio region to edit it here.';canvas.style.visibility='hidden';playhead.hidden=true;windowMark.hidden=true;state.regionKey='';return'none';}
  if(!(width>0)||!(height>0))return'hidden';
  const key=`${current.clipId}|${current.offsetSec}|${current.lengthSec}`;
  if(key!==state.regionKey){state.regionKey=key;state.view={startSec:0,secondsPerPixel:current.lengthSec/width};state.painted='';state.overviewKey='';}
  state.view=clampAudioEditorView(state.view,limits(current));
  const {startSec,secondsPerPixel}=state.view,visibleSec=Math.min(current.lengthSec-startSec,width*secondsPerPixel),drawWidth=Math.min(width,visibleSec/secondsPerPixel);
  const has=pyramid.has(current.clipId);if(!has)pyramid.prefetch(current.clipId);
  canvas.style.visibility=has?'visible':canvas.style.visibility||'hidden';empty.hidden=has;if(!has)empty.textContent='Loading waveform…';
  const version=`${key}|${startSec}|${secondsPerPixel}|${width}|${height}|${dpr()}|${current.gain??1}|${pyramid.version??''}|${state.bump||0}`;
  if(has&&version!==state.painted){
   const context=size(canvas,width,height);
   if(context){
    context.clearRect(0,0,width,height);
    context.fillStyle=current.background||'#3a7bd5';context.fillRect(0,0,drawWidth,height);
    const result=pyramid.paint(context,current.clipId,{x:0,y:0,width:drawWidth,height,startSec:current.offsetSec+startSec,endSec:current.offsetSec+startSec+visibleSec,gain:current.gain??1,color:current.color||'#0d2d5c',rmsColor:null});
    state.lastStatus=result.status;element.dataset.waveStatus=result.status;
    // Zero line.
    const rows=pyramid.info(current.clipId)?.channelCount||1;context.fillStyle='rgba(8,26,51,.35)';for(let row=0;row<rows;row++)context.fillRect(0,Math.round((row+.5)*height/rows),drawWidth,1/dpr());
    if(result.status==='exact')state.painted=version;
   }
   // Ruler.
   const rulerHeight=ruler.parentElement.clientHeight||20,ctx=size(ruler,width,rulerHeight);
   if(ctx){ctx.clearRect(0,0,width,rulerHeight);ctx.fillStyle='#a9a9a9';ctx.font='10px -apple-system,BlinkMacSystemFont,sans-serif';ctx.textBaseline='top';
    for(const tick of audioEditorTicks({startSec,secondsPerPixel,width,bpm:current.bpm,regionStartBeat:current.startBeat,sampleRate:sampleRate(current)})){ctx.fillRect(Math.round(tick.x),tick.major?4:10,1,rulerHeight);ctx.fillText(tick.label,Math.round(tick.x)+4,3);}
   }
  }
  // Overview strip + viewport window.
  const overviewWidth=overview.clientWidth,overviewHeight=overview.clientHeight;
  if(has&&overviewWidth>0&&overviewHeight>0){
   const overviewKey=`${key}|${overviewWidth}|${overviewHeight}|${dpr()}|${pyramid.version??''}|${state.bump||0}`;
   if(overviewKey!==state.overviewKey){const context=size(overviewCanvas,overviewWidth,overviewHeight);if(context){context.clearRect(0,0,overviewWidth,overviewHeight);const result=pyramid.paint(context,current.clipId,{x:0,y:0,width:overviewWidth,height:overviewHeight,startSec:current.offsetSec,endSec:current.offsetSec+current.lengthSec,gain:current.gain??1,color:'#8fb4ea',rmsColor:null,mono:true});if(result.status!=='empty')state.overviewKey=overviewKey;}}
   windowMark.hidden=false;windowMark.style.left=`${startSec/current.lengthSec*overviewWidth}px`;windowMark.style.width=`${Math.max(3,visibleSec/current.lengthSec*overviewWidth)}px`;
  }
  // Playhead.
  let beat=null;try{beat=getPlayheadBeat();}catch{beat=null;}
  const secondsPerBeat=60/(Number(current.bpm)>0?Number(current.bpm):120),at=Number.isFinite(beat)?(beat-current.startBeat)*secondsPerBeat-startSec:NaN,x=at/secondsPerPixel;
  if(Number.isFinite(x)&&x>=0&&x<=drawWidth){playhead.hidden=false;playhead.style.transform=`translate3d(${x}px,0,0)`;}else playhead.hidden=true;
  return state.lastStatus;
 }
 const setView=view=>{const current=region();if(!current)return;state.view=clampAudioEditorView(view,limits(current));paint();};
 const zoomBy=(factor,anchorX=stage.clientWidth/2)=>{const current=region();if(!current)return;state.view=zoomAudioEditorView(state.view,factor,anchorX,limits(current));paint();};
 const onWheel=event=>{
  const current=region();if(!current)return;event.preventDefault();
  if(event.ctrlKey||event.metaKey||event.altKey){const rect=stage.getBoundingClientRect();zoomBy(Math.exp(-event.deltaY*.01),event.clientX-rect.left);return;}
  const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;setView({startSec:state.view.startSec+delta*state.view.secondsPerPixel,secondsPerPixel:state.view.secondsPerPixel});
 };
 stage.addEventListener('wheel',onWheel,{passive:false});
 stage.addEventListener('keydown',event=>{if(event.metaKey&&event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();zoomBy(1.6);}else if(event.metaKey&&event.key==='ArrowLeft'){event.preventDefault();event.stopPropagation();zoomBy(1/1.6);}});
 stage.addEventListener('pointerdown',event=>{if(event.button!==0)return;stage.focus?.();const current=region();if(!current||typeof onSeekBeat!=='function')return;const rect=stage.getBoundingClientRect(),seconds=state.view.startSec+(event.clientX-rect.left)*state.view.secondsPerPixel;if(seconds>=0&&seconds<=current.lengthSec)onSeekBeat(current.startBeat+seconds/(60/(Number(current.bpm)||120)));});
 const dragOverview=event=>{const current=region();if(!current)return;const rect=overview.getBoundingClientRect(),span=stage.clientWidth*state.view.secondsPerPixel,center=clamp((event.clientX-rect.left)/Math.max(1,rect.width),0,1)*current.lengthSec;setView({startSec:center-span/2,secondsPerPixel:state.view.secondsPerPixel});};
 overview.addEventListener('pointerdown',event=>{if(event.button!==0)return;overview.setPointerCapture?.(event.pointerId);dragOverview(event);const move=next=>dragOverview(next),up=()=>{overview.removeEventListener('pointermove',move);overview.removeEventListener('pointerup',up);overview.removeEventListener('pointercancel',up);};overview.addEventListener('pointermove',move);overview.addEventListener('pointerup',up);overview.addEventListener('pointercancel',up);});
 const Observer=win.ResizeObserver,observer=typeof Observer==='function'?new Observer(()=>paint()):null;observer?.observe(stage);
 return{
  element,paint,
  /** New peaks arrived (or the source changed): repaint from the cache now. */
  repaint(){state.bump=(state.bump||0)+1;return paint();},
  zoomBy,setView,
  /** 0 = whole region, 1 = one sample per AUDIO_EDITOR_MAX_PX_PER_FRAME px (logarithmic). */
  setZoom(amount){const current=region();if(!current)return;const range=audioEditorZoomRange(limits(current)),value=Math.exp(Math.log(range.max)+(Math.log(range.min)-Math.log(range.max))*clamp(amount,0,1)),width=stage.clientWidth;state.view=zoomAudioEditorView({...state.view},state.view.secondsPerPixel/value,width/2,limits(current));paint();},
  zoomAmount(){const current=region();if(!current)return 0;const range=audioEditorZoomRange(limits(current));return range.max===range.min?0:clamp((Math.log(state.view.secondsPerPixel)-Math.log(range.max))/(Math.log(range.min)-Math.log(range.max)),0,1);},
  view:()=>({...state.view}),status:()=>state.lastStatus,
  destroy(){state.destroyed=true;observer?.disconnect();stage.removeEventListener('wheel',onWheel);element.innerHTML='';},
 };
}
