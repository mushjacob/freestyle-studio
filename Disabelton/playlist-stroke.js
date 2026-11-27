/** Pattern placement Paint and clip Delete strokes.
 * Image-Line playlist.htm documents Paint B and Delete/right-drag sweeps;
 * basics_workflow.htm documents horizontal repeated painting. Paint stays on
 * its initial row; diagonal row-switch semantics are not asserted here.
 */
import {patternLengthBeats} from './pattern-preview.js';
const EPS=1e-9,MAX_TILES=10000;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clone=value=>structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validPoint=value=>value&&finite(value.beat)&&finite(value.row);
const signature=value=>JSON.stringify(value);
const validClip=clip=>clip&&typeof clip.id==='string'&&clip.id&&typeof clip.patternId==='string'&&clip.patternId&&finite(clip.start)&&clip.start>=0&&finite(clip.length)&&clip.length>0&&Number.isInteger(clip.track)&&clip.track>=0;
const validAudio=clip=>clip&&typeof clip.id==='string'&&clip.id&&finite(clip.start)&&clip.start>=0&&finite(clip.length)&&clip.length>0&&Number.isInteger(clip.track)&&clip.track>=0;
function complete(value,seen=new WeakSet()){
 if(!value||typeof value!=='object')return;if(seen.has(value))throw new Error('Reload the complete acyclic placement metadata before painting.');seen.add(value);
 for(const [key,child]of Object.entries(value)){if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&child)throw new Error('Reload the complete placement metadata before painting.');complete(child,seen);}seen.delete(value);
}
function validateRaw(raw){
 if(!record(raw)||!['durationMs','loopDurationMs','offsetMs','repeatCount','loopPhaseMs'].every(key=>finite(raw[key]))||raw.durationMs<=0||raw.loopDurationMs<=0||raw.offsetMs<0||raw.loopPhaseMs<0||!Number.isInteger(raw.repeatCount)||raw.repeatCount<1||!Object.hasOwn(raw,'windowMs')||raw.windowMs!==null&&(!finite(raw.windowMs)||raw.windowMs<=0)||!record(raw.sourceBusOverrides))throw new Error('Reload complete canonical placement timing, phase and source routing before painting this source.');
 complete(raw);
}
/** Fresh placement identity, shared pattern source and unchanged phase/routing. */
export function paintedPatternPlacement({project,pattern,sourcePlacement=null,track,start,id}){
 if(!pattern||typeof pattern.id!=='string'||!pattern.id||pattern.id==='empty'||!finite(project?.bpm)||project.bpm<=0||!Number.isInteger(track)||track<0||!finite(start)||start<0||typeof id!=='string'||!id)throw new TypeError('Paint requires an existing pattern, exact project tempo, row, onset and unused placement identity.');
 complete(pattern);
 const length=sourcePlacement?sourcePlacement.length:patternLengthBeats(pattern);
 if(!finite(length)||length<=0)throw new Error('The selected pattern has no valid authored length.');
 if(sourcePlacement&&(!validClip(sourcePlacement)||sourcePlacement.patternId!==pattern.id))throw new Error('The captured placement must reference the selected pattern.');
 if(sourcePlacement?.cloudRaw)validateRaw(sourcePlacement.cloudRaw);
 const msPerBeat=60000/project.bpm,laneId=project.cloud?.timelineLaneIds?.[track]||(sourcePlacement?.track===track?(sourcePlacement.laneId||sourcePlacement.cloudRaw?.laneId):undefined);
 const placement={...(sourcePlacement?clone(sourcePlacement):{}),id,patternId:pattern.id,track,start,length,cloudTrackIndex:track};delete placement.cloudId;
 if(laneId)placement.laneId=laneId;else delete placement.laneId;
 // New selected-pattern placements use the existing serializer's canonical
 // defaults. Only an explicitly selected placement carries source trim/phase.
 if(!sourcePlacement?.cloudRaw){delete placement.cloudRaw;return placement;}
 const raw=clone(sourcePlacement.cloudRaw);
 for(const key of ['id','placement_id','placementId'])delete raw[key];
 raw.patternId=pattern.cloudId||pattern.id;raw.startMs=start*msPerBeat;raw.displayOrder=track;
 if(Object.hasOwn(raw,'start_ms'))raw.start_ms=raw.startMs;if(Object.hasOwn(raw,'display_order'))raw.display_order=track;
 delete raw.lane_id;if(laneId)raw.laneId=laneId;else delete raw.laneId;
 placement.cloudRaw=raw;
 return placement;
}
function intersects(from,to,clip){
 const dx=to.beat-from.beat,dy=to.row-from.row;let lo=0,hi=1;
 for(const [p,q]of [[-dx,from.beat-clip.start],[dx,clip.start+clip.length-EPS-from.beat],[-dy,from.row-clip.track],[dy,clip.track+1-EPS-from.row]]){
  if(Math.abs(p)<EPS){if(q<0)return false;continue;}const fraction=q/p;
  if(p<0){if(fraction>hi)return false;lo=Math.max(lo,fraction);}else{if(fraction<lo)return false;hi=Math.min(hi,fraction);}
 }
 return lo<=hi;
}
export class PlaylistStroke{
 constructor({project,pattern,sourcePlacement=null,clips=project?.clips||[],audioClips=project?.audioClips||[],mode='paint',track=0,tileOrigin=0,idFactory=()=>globalThis.crypto.randomUUID()}={}){
  if(!['paint','erase'].includes(mode)||!Number.isInteger(track)||track<0||!finite(tileOrigin)||tileOrigin<0||!Array.isArray(clips)||clips.some(clip=>!validClip(clip))||!Array.isArray(audioClips)||audioClips.some(clip=>!validAudio(clip)))throw new TypeError('Playlist strokes require canonical pattern/audio clip bounds, a mode and a valid initial row.');
  if(new Set([...clips,...audioClips].map(clip=>clip.id)).size!==clips.length+audioClips.length)throw new Error('Reload unambiguous clip identities before starting a Playlist stroke.');
  complete(clips);complete(audioClips);this.initial=clone(clips);this.initialAudio=clone(audioClips);this.project=clone(project);this.pattern=clone(pattern);this.sourcePlacement=clone(sourcePlacement);this.mode=mode;this.track=track;this.tileOrigin=tileOrigin;this.idFactory=idFactory;
  this.length=sourcePlacement?.length??patternLengthBeats(pattern);if(mode==='paint'&&(!finite(this.length)||this.length<=0))throw new Error('Paint requires a positive authored pattern length.');
  if(mode==='paint')this.template=paintedPatternPlacement({project:this.project,pattern:this.pattern,sourcePlacement:this.sourcePlacement,track,start:tileOrigin,id:'validation-only'});
  this.occupied=clips.filter(clip=>clip.track===track&&clip.patternId===pattern?.id).map(clip=>clip.start).sort((a,b)=>a-b);
  this.created=[];this.erased=new Set();this.visited=new Set();this.previous=null;this.active=true;this.reserved=new Set([...clips,...audioClips].flatMap(clip=>[clip.id,clip.cloudId,clip.cloudRaw?.id].filter(Boolean)));for(const value of [sourcePlacement?.id,sourcePlacement?.cloudId,sourcePlacement?.cloudRaw?.id])if(value)this.reserved.add(value);
 }
 allocate(){for(let attempt=0;attempt<64;attempt++){const id=this.idFactory();if(typeof id==='string'&&id&&!this.reserved.has(id)){this.reserved.add(id);return id;}}throw new Error('A painted placement needs an unused identity.');}
 occupiedAt(start){let lo=0,hi=this.occupied.length;while(lo<hi){const mid=(lo+hi)>>1;if(this.occupied[mid]<start-EPS)lo=mid+1;else hi=mid;}return lo<this.occupied.length&&Math.abs(this.occupied[lo]-start)<EPS;}
 addPoint(next){
  if(!this.active||!validPoint(next))return false;const previous=this.previous||next,before=this.created.length+this.erased.size;
  if(this.mode==='erase'){for(const clip of [...this.initial,...this.initialAudio])if(!this.erased.has(clip.id)&&intersects(previous,next,clip))this.erased.add(clip.id);}
  else{
   // Preserve the existing Playlist's nearest pattern-length tile anchor. A
   // caller with a verified alternative anchor may provide tileOrigin explicitly.
   const first=Math.round((previous.beat-this.tileOrigin)/this.length),last=Math.round((next.beat-this.tileOrigin)/this.length),lo=Math.max(Math.ceil(-this.tileOrigin/this.length),Math.min(first,last)),hi=Math.max(first,last);
   if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||!Number.isSafeInteger(lo))throw new RangeError('Paint coordinates exceed safe Playlist tile limits.');
   if(hi-lo+1>MAX_TILES)throw new RangeError('Paint a shorter Playlist stroke before continuing.');
   for(let tile=lo;tile<=hi;tile++){
    if(this.visited.has(tile))continue;if(this.visited.size>=MAX_TILES)throw new RangeError('Paint a shorter Playlist stroke before continuing.');this.visited.add(tile);const start=Math.max(0,this.tileOrigin+tile*this.length);
    if(this.occupiedAt(start))continue;
    const placement=clone(this.template);placement.id=this.allocate();placement.start=start;
    if(placement.cloudRaw){placement.cloudRaw.startMs=start*60000/this.project.bpm;if(Object.hasOwn(placement.cloudRaw,'start_ms'))placement.cloudRaw.start_ms=placement.cloudRaw.startMs;}
    this.created.push(placement);
   }
  }
  this.previous={beat:next.beat,row:next.row};return before!==this.created.length+this.erased.size;
 }
 snapshot(){return{clips:clone(this.initial.filter(clip=>!this.erased.has(clip.id)).concat(this.created)),audioClips:clone(this.initialAudio.filter(clip=>!this.erased.has(clip.id))),created:clone(this.created),erased:new Set(this.erased),sourcePlacement:clone(this.sourcePlacement)};}
 finish(next,{cancel=false}={}){
  if(!this.active)return this.result;if(!cancel&&validPoint(next))this.addPoint(next);this.active=false;
  return this.result=cancel?{clips:clone(this.initial),audioClips:clone(this.initialAudio),created:[],erased:new Set(),sourcePlacement:clone(this.sourcePlacement),cancelled:true,changed:false}:{...this.snapshot(),cancelled:false,changed:this.created.length>0||this.erased.size>0};
 }
}

/** Parent owns DOM capture/rendering and its existing cloud update function.
 * createAutoScroll({pointerId,isValid,onScroll}) returns a PlaylistAutoScroll.
 * pointForEvent must use LIVE viewport geometry so onScroll samples compensation.
 */
export class PlaylistStrokeGesture{
 constructor({getProject,getPattern,getSourcePlacement=()=>null,getTool=()=> 'paint',getScope=()=>null,pointForEvent=event=>({beat:event.beat,row:event.row}),canStart=()=>true,canContinue=()=>true,onStart=()=>{},paint=()=>{},restore=()=>{},commit=()=>{},onFinish=()=>{},onError=()=>{},createAutoScroll=null,idFactory,raf=fn=>globalThis.requestAnimationFrame(fn),caf=id=>globalThis.cancelAnimationFrame(id)}={}){
  if(typeof getProject!=='function'||typeof getPattern!=='function')throw new TypeError('Playlist stroke gestures require project and pattern callbacks.');
  Object.assign(this,{getProject,getPattern,getSourcePlacement,getTool,getScope,pointForEvent,canStart,canContinue,onStart,paint,restore,commit,onFinish,onError,createAutoScroll,idFactory,raf,caf});this.gesture=null;this.frame=null;
 }
 get active(){return !!this.gesture;}
 capture(){const project=this.getProject();return signature({projectId:project?.cloud?.projectId||project?.id,trackId:project?.cloud?.trackId,bpm:project?.bpm,lanes:project?.cloud?.timelineLaneIds,clips:project?.clips,audioClips:project?.audioClips,pattern:this.getPattern(),source:this.getSourcePlacement(),scope:this.getScope(),tool:this.getTool()});}
 current(){try{return !!this.gesture&&this.getProject()===this.gesture.project&&this.capture()===this.gesture.scope&&this.canContinue();}catch{return false;}}
 start(event,{mode=event?.button===2?'erase':'paint',tileOrigin=0}={}){
  if(this.active||event?.isPrimary===false||event?.pointerId==null||!this.canStart(event)||!['paint','erase'].includes(mode)||mode==='paint'&&event.button!==0||mode==='erase'&&![0,2].includes(event.button))return false;
  try{
   const point=this.pointForEvent(event);if(!validPoint(point)||point.row<0)return false;
   const project=this.getProject(),stroke=new PlaylistStroke({project,pattern:this.getPattern(),sourcePlacement:this.getSourcePlacement(),mode,track:Math.floor(point.row),tileOrigin,idFactory:this.idFactory});
   this.gesture={project,stroke,pointerId:event.pointerId,scope:this.capture(),lastEvent:null,autoScroll:null};
   this.onStart({pointerId:event.pointerId,mode,track:Math.floor(point.row)});
   if(this.createAutoScroll)this.gesture.autoScroll=this.createAutoScroll({pointerId:event.pointerId,isValid:()=>this.current(),onScroll:()=>{if(this.gesture?.lastEvent)this.move(this.gesture.lastEvent);}});
   this.move(event);return this.active;
  }catch(error){if(this.active)this.cancel();this.onError(error);return false;}
 }
 move(event){
  const gesture=this.gesture;if(!gesture||event?.pointerId!==gesture.pointerId)return false;
  if(!this.current()){this.cancel();return false;}
  try{
   const point=this.pointForEvent(event);if(!validPoint(point))return false;
   gesture.lastEvent={pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY,beat:event.beat,row:event.row};
   const changed=gesture.stroke.addPoint(point);gesture.autoScroll?.update(event,{enabled:true});
   if(changed&&this.frame===null)this.frame=this.raf(()=>{this.frame=null;if(!this.active)return;if(!this.current()){this.cancel();return;}try{this.paint(this.gesture.stroke.snapshot());}catch(error){this.cancel();this.onError(error);}});
   return changed;
  }catch(error){this.cancel();this.onError(error);return false;}
 }
 finish(event,{cancel=false}={}){
  const gesture=this.gesture;if(!gesture||event?.pointerId!=null&&event.pointerId!==gesture.pointerId)return null;
  cancel=cancel||!this.current();let point;
  if(!cancel){try{point=this.pointForEvent(event);if(!validPoint(point))cancel=true;}catch{cancel=true;}}
  if(this.frame!==null)this.caf(this.frame);this.frame=null;gesture.autoScroll?.destroy();
  let result;try{result=gesture.stroke.finish(point,{cancel});}catch(error){result=gesture.stroke.finish(undefined,{cancel:true});result.error=error;this.onError(error);}
  this.gesture=null;
  for(const callback of [this.restore,this.onFinish])try{callback(result);}catch(error){result.error=error;this.onError(error);}
  // DOM restoration/finish callbacks can change the project or tool synchronously.
  const stillCurrent=()=>{try{return this.getProject()===gesture.project&&this.capture()===gesture.scope&&this.canContinue();}catch{return false;}};
  if(result.changed&&!result.error&&stillCurrent())try{const pending=this.commit(result);if(pending&&typeof pending.then==='function')pending.catch(this.onError);}catch(error){result.error=error;this.onError(error);}
  else if(result.changed&&!stillCurrent()){result.cancelled=true;result.changed=false;}
  return result;
 }
 cancel(event){return this.finish(event,{cancel:true});}
 keyDown(event){if(!this.active)return false;if(event.key==='Escape'){event.preventDefault?.();this.cancel();return true;}if(!this.current())this.cancel();return false;}
 blur(){return this.cancel();}
 lostPointerCapture(event){return this.cancel(event);}
 pointerCancel(event){return this.cancel(event);}
 destroy(){this.cancel();}
}
