import {PLAYBACK_SCROLL_DEFAULTS} from './audacity-playback-scroll.js';
import {logicalPlaybackScroll,timeToViewportX} from './audacity-virtual-timeline.js';
import {NORMAL_ZOOM,DEFAULT_ZOOM_TOGGLE,ZOOM_PRESETS,zoomViewport} from './audacity-zoom.js';
import {TRACK_GUTTER_PX} from './audacity-layout.js';

export const hasViewportClock=clock=>!!clock&&Number.isFinite(clock.seconds)&&clock.seconds>=0&&clock.clockAvailable!==false&&clock.previewClockAvailable!==false&&(clock.clockAvailable===true||clock.previewClockAvailable===true||['live','http','ack'].includes(clock.clockSource));

/** View operations consume real engine positions; they never send transport edits. */
export class AudacityViewport {
 constructor(workspace){
  this.w=workspace;this.views=new Map();Object.assign(this,PLAYBACK_SCROLL_DEFAULTS);this.presets=[...DEFAULT_ZOOM_TOGGLE];
  try{
   const saved=JSON.parse(workspace.root.ownerDocument.defaultView.localStorage.getItem('modesty:viewport')||'null');
   for(const key of ['autoScroll','continuousScrolling'])if(typeof saved?.[key]==='boolean')this[key]=saved[key];
   if(Number.isFinite(saved?.pinnedFraction)&&saved.pinnedFraction>=0&&saved.pinnedFraction<=1)this.pinnedFraction=saved.pinnedFraction;
   if(Array.isArray(saved?.presets)&&saved.presets.length===2&&saved.presets.every(id=>ZOOM_PRESETS.some(p=>p.id===id)))this.presets=[...saved.presets];
  }catch{}
  this.bindPinnedHead();
 }
 save(){try{this.w.root.ownerDocument.defaultView.localStorage.setItem('modesty:viewport',JSON.stringify({autoScroll:this.autoScroll,continuousScrolling:this.continuousScrolling,pinnedFraction:this.pinnedFraction,presets:this.presets}));}catch{}}
 adoptProject(projectId){
  if(this.projectId===projectId)return;const w=this.w;
  if(this.projectId!==undefined)this.views.set(this.projectId,{scale:w.scale,leftSec:w.leftSec,top:w.scroll.scrollTop,selection:{...w.selection},selectedTracks:[...w.selectedTracks],focusedTrack:w.focusedTrack,selectedClip:w.selectedClip});
  const saved=this.views.get(projectId);
  if(saved){this.restorePosition={leftSec:saved.leftSec,top:saved.top};w.scale=saved.scale;w.leftSec=saved.leftSec;w.scroll.scrollTop=saved.top;w.selection={...saved.selection};w.selectedTracks=new Set(saved.selectedTracks);w.focusedTrack=saved.focusedTrack;w.selectedClip=saved.selectedClip;}
  else if(this.projectId!==undefined){w.scale=NORMAL_ZOOM;w.leftSec=0;w.scroll.scrollTop=0;w.selection={start:0,end:0};w.selectedTracks.clear();w.selectedClip=null;w.focusedTrack=undefined;}
  this.projectId=projectId;w.loadedProjectId=projectId;w.paused=false;
 }
 restoreScrollPosition(){if(!this.restorePosition)return;this.w.setLeftSec(this.restorePosition.leftSec,{render:false});this.w.scroll.scrollTop=this.restorePosition.top;this.restorePosition=null;}
 clockAvailable(clock){const w=this.w,p=w.getProject(),id=p.cloud?.projectId||p.id;return !!w.engine.ready&&!w.engine.loading&&(!w.engine.projectId||w.engine.projectId===id)&&hasViewportClock(clock);}
 width(){return Math.max(0,this.w.scroll.clientWidth-TRACK_GUTTER_PX);}
 menuItems(){return [
  ['Scroll view to playhead',this.autoScroll?'✓':'',()=>this.set('autoScroll',!this.autoScroll)],
  ['Continuous scrolling',this.continuousScrolling?'✓':'',()=>this.set('continuousScrolling',!this.continuousScrolling)]
 ];}
 set(key,value){if(!['autoScroll','continuousScrolling'].includes(key)||typeof value!=='boolean')throw new Error('Choose a valid scrolling option.');this[key]=value;this.save();this.w.tick();}
 follow(clock){
  const w=this.w,project=w.getProject(),id=project.cloud?.projectId||project.id;
  if(this.pinDrag&&this.pinDrag.projectId!==id)this.finishPinnedHead(true);
  const marker=w.root.querySelector('#au-cursor span');marker?.classList.toggle('au-pinned-head',this.continuousScrolling&&this.clockAvailable(clock)&&!!(clock.playing||w.paused||w.engine.recorder?.recording));
  const result=logicalPlaybackScroll({seconds:clock?.seconds,clockAvailable:this.clockAvailable(clock),playing:clock?.playing===true,paused:!!w.paused,recording:!!w.engine.recorder?.recording,leftSec:w.leftSec,viewportWidth:this.width(),pixelsPerSecond:w.scale,autoScroll:this.autoScroll,continuousScrolling:this.continuousScrolling,pinnedFraction:this.pinnedFraction});
  this.lastFollow=result;
  if(result.changed)w.setLeftSec(result.leftSec);
  return result;
 }
 bindPinnedHead(){
  const w=this.w,marker=w.root.querySelector('#au-cursor span');if(!marker)return;
  marker.title='Click and drag to adjust, double-click to reset';
  marker.onpointerdown=e=>{
   const clock=w.engine.positionAt?.();if(e.button!==0||!this.continuousScrolling||!this.clockAvailable(clock)||!(clock.playing||w.paused||w.engine.recorder?.recording)||w.clipGesture||w.selectionGesture?.active||w.loopRegion?.active||w.envelopeView?.active)return;
   e.preventDefault();e.stopPropagation();const p=w.getProject();this.pinDrag={pointerId:e.pointerId,before:this.pinnedFraction,projectId:p.cloud?.projectId||p.id};
   try{marker.setPointerCapture?.(e.pointerId);}catch{}
  };
  this.pinMove=e=>{if(this.pinDrag?.pointerId!==e.pointerId)return;const width=this.width();if(width<=0)return;this.pinnedFraction=Math.max(0,Math.min(1,(e.clientX-w.scroll.getBoundingClientRect().left-TRACK_GUTTER_PX)/width));w.tick();};
  const document=w.root.ownerDocument;
  document.addEventListener('pointermove',this.pinMove,true);
  document.addEventListener('pointerup',e=>{if(this.pinDrag?.pointerId===e.pointerId){this.pinMove(e);this.finishPinnedHead(false);}},true);
  document.addEventListener('pointercancel',e=>{if(this.pinDrag?.pointerId===e.pointerId)this.finishPinnedHead(true);},true);
  marker.onlostpointercapture=()=>this.finishPinnedHead(true);document.defaultView.addEventListener('blur',()=>this.finishPinnedHead(true));
  marker.ondblclick=e=>{if(!this.continuousScrolling)return;e.preventDefault();e.stopPropagation();this.pinnedFraction=.5;this.save();w.tick();};
 }
 finishPinnedHead(cancel=false){
  const drag=this.pinDrag;if(!drag)return;this.pinDrag=null;if(cancel)this.pinnedFraction=drag.before;else this.save();
  const marker=this.w.root.querySelector('#au-cursor span');try{if(marker?.hasPointerCapture?.(drag.pointerId))marker.releasePointerCapture(drag.pointerId);}catch{}this.w.tick();
 }
 command(command,extra={}){
  const w=this.w;if(this.pinDrag||w.groupMoves?.active||w.amplitudeView?.active||w.panGesture||w.envelopeView?.active||w.clipGesture||w.selectionGesture?.active||w.loopRegion?.active)return null;
  const width=this.width();if(width<1)return null;
  const clock=w.engine.positionAt?.(),playing=clock?.playing===true;
  if(command==='in'&&playing&&!w.paused&&!this.clockAvailable(clock))throw new Error('Wait for the cloud playback position before zooming in.');
  const result=zoomViewport({command,scale:w.scale,leftSec:w.leftSec,width,selection:w.selection,projectEnd:w.duration(),playing,paused:!!w.paused,playheadSec:clock?.seconds,presets:this.presets,...extra});
  w.scale=result.scale;w.setLeftSec(result.leftSec,{render:false});w.render();w.renderRulerLabels?.();w.paintCursors();return result;
 }
 zoom(factor,anchor){return this.command('factor',{factor,anchorPx:anchor-TRACK_GUTTER_PX});}
 reset(){return this.command('normal');}
 toggle(){return this.command('toggle');}
 presetDialog(){
  const d=this.w.dialog('Zoom Toggle',`<form class="au-zoom-presets">${this.presets.map((id,index)=>`<label>Preset ${index+1}<select aria-label="Zoom preset ${index+1}">${ZOOM_PRESETS.map(p=>`<option value="${p.id}"${p.id===id?' selected':''}>${p.label}</option>`).join('')}</select></label>`).join('')}<footer><button type="button">Cancel</button><button class="primary" type="submit">OK</button></footer></form>`);
  const selectors=[...d.querySelectorAll('select')];selectors.forEach((select,index)=>select.value=this.presets[index]);
  d.querySelector('button[type=button]').onclick=()=>d.close();d.querySelector('form').onsubmit=e=>{e.preventDefault();this.presets=selectors.map(s=>s.value);this.save();d.close();};return d;
 }
}

/** Audacity 3.2.1 Ruler::FindLinearTickSizes for the horizontal TimeFormat
 * ruler: minor ticks at least 22px apart, then whole-second steps (1/5, 5/15,
 * 10/30, 15/60 ... seconds) or decimal 1-5-10 steps below half a second.
 *
 * The native pairs alone let labels touch where a major step is only twice
 * its minor (0.5/1, 30/60 s, 30/60 min) or where the label is long ("1:00:00",
 * "12.3460"). So the first pair is taken whose minor ticks are at least
 * RULER_MINOR_MIN_PX apart AND whose labels are at least RULER_LABEL_MIN_PX
 * apart and wider than the longest label in view (maxSeconds). */
export const RULER_MINOR_MIN_PX=22,RULER_LABEL_MIN_PX=60,RULER_LABEL_CHAR_PX=7,RULER_LABEL_PAD_PX=10,RULER_LABEL_MAX_PX=150;
const HOUR=3600,DAY=24*HOUR;
const RULER_STEPS=Object.freeze([
 ...[6,5,4,3,2,1].flatMap(digits=>{const base=10**-digits;return [[base,base*5,digits],[base*5,base*10,digits]];}),
 ...[[1,5],[5,15],[10,30],[15,60],[30,60],[60,300],[300,900],[600,1800],[900,HOUR],[1800,HOUR],[HOUR,6*HOUR],[6*HOUR,DAY],[DAY,7*DAY],[7*DAY,28*DAY]].map(([minor,major])=>[minor,major,0])
]);
export function timeRulerTickSizes(scale,{maxSeconds=0,minLabelPx=RULER_LABEL_MIN_PX}={}){
 if(!(scale>0)||!Number.isFinite(scale))return {minor:1,major:5,digits:0};
 const latest=Number.isFinite(maxSeconds)&&maxSeconds>0?maxSeconds:0;
 for(const [minor,major,digits] of RULER_STEPS){
  if(minor*scale<RULER_MINOR_MIN_PX)continue;
  const labelPx=Math.max(minLabelPx,formatTimeRulerLabel(latest,digits).length*RULER_LABEL_CHAR_PX+RULER_LABEL_PAD_PX);
  if(major*scale>=labelPx)return {minor,major,digits};
 }
 return {minor:28*DAY,major:28*DAY,digits:0};
}
/** Audacity's TimeFormat label: "15", "1:00", "1:02:03", or "1.5" / "1:00.25"
 * when the minor step is below a second. Integer arithmetic avoids "59.99 -> 60.0". */
export function formatTimeRulerLabel(seconds,digits=0){
 const scale=10**digits,total=Math.round(Math.max(0,seconds)*scale),whole=Math.floor(total/scale),fraction=total-whole*scale;
 const tail=digits?'.'+String(fraction).padStart(digits,'0'):'',hours=Math.floor(whole/3600),minutes=Math.floor(whole/60)%60,secs=whole%60;
 if(whole<60)return whole+tail;
 if(hours<1)return minutes+':'+String(secs).padStart(2,'0')+tail;
 return hours+':'+String(minutes).padStart(2,'0')+':'+String(secs).padStart(2,'0')+tail;
}
/** Render only visible major labels, even when sample zoom spans millions of pixels. */
export function rulerLabels({scale,leftSec,scrollLeft=0,width}){
 leftSec=leftSec??scrollLeft/scale;
 if(!(scale>0)||!Number.isFinite(scale)||!Number.isFinite(leftSec)||!Number.isFinite(width)||width<=0)return {step:1,minor:1,digits:0,labels:[]};
 const {minor,major:step,digits}=timeRulerTickSizes(scale,{maxSeconds:Math.max(0,leftSec)+width/scale});
 const first=Math.max(0,Math.floor(leftSec/step)),count=Math.min(1000,Math.ceil(width/scale/step)+2);
 const labels=[];for(let index=0;index<count;index++){
  // A label is drawn to the right of its tick: one that starts more than a label's width before the view, or
  // after its right edge, has nothing visible.
  const seconds=(first+index)*step,x=timeToViewportX(seconds,leftSec,scale);if(x>width)break;if(x<=-RULER_LABEL_MAX_PX)continue;
  labels.push({seconds,x,text:formatTimeRulerLabel(seconds,digits)});
 }
 return {step,minor,digits,labels};
}

export {NORMAL_ZOOM};
