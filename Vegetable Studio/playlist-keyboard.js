/** Native Playlist Shift+arrows: one snap horizontally, one row vertically.
 * Reference: https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/playlist.htm
 * Provisional gestures only; the caller supplies the existing cloud commit path.
 */
import {movePlaylistSelection} from './playlist-selection.js';
const clone=value=>structuredClone(value);
const arrows=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']);
const selectedSet=value=>new Set((typeof value==='string'||typeof value==='number'?[value]:Array.from(value||[])).map(String));
const clipsOf=project=>[...project?.clips||[],...project?.audioClips||[]];
const identity=project=>project?.cloud?.projectId||project?.id||null;
const signature=value=>JSON.stringify(value);
const selectedSignature=(clips,selected)=>signature(clips.filter(clip=>selected.has(String(clip.id))).map(clip=>({id:clip.id,cloudId:clip.cloudId,patternId:clip.patternId,laneId:clip.laneId,start:clip.start,length:clip.length,track:clip.track,offset:clip.offset,offsetKnown:clip.offsetKnown,raw:clip.cloudRaw,runtime:clip.cloudRuntime})).sort((a,b)=>String(a.id).localeCompare(String(b.id))));

export function playlistNudgeKey(event,{snapBeats=.25,pianoActive=false,dialogOpen=false,playlistActive=true}={}){
 if(event?.defaultPrevented||event?.isComposing||!playlistActive||pianoActive||dialogOpen||!event?.shiftKey||event.ctrlKey||event.metaKey||event.altKey||!arrows.has(event.key))return null;
 if(event.target?.closest?.('input,select,textarea,dialog,[contenteditable]:not([contenteditable=false]),[role=textbox]'))return null;
 if(!Number.isFinite(snapBeats)||snapBeats<0)return null;
 const step=snapBeats>0?snapBeats:1/96;
 return{deltaBeats:event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,deltaTracks:event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0};
}
/** Compute one shared group transform, preserving fractional timing and metadata. */
export function moveKeyboardPlaylistSelection(clips,selected,{deltaBeats=0,deltaTracks=0,maxTrack=Infinity,laneIds=[],canMoveAudio=()=>true}={}){
 const result=movePlaylistSelection(clips,selected,{deltaBeats,deltaTracks,snapBeats:0,maxTrack});
 if(result.changed&&result.deltaTracks!==0){
  const keys=selectedSet(selected),before=new Map(clips.map(clip=>[String(clip.id),clip]));
  for(const clip of result.clips){const old=before.get(String(clip.id));if(!keys.has(String(clip.id))||clip.patternId||clip.track===old.track)continue;
   if(typeof laneIds[clip.track]!=='string'||!laneIds[clip.track]||!canMoveAudio(old,clip,laneIds[clip.track]))return{clips,changed:false,deltaBeats:0,deltaTracks:0,blocked:true,reason:'Choose existing cloud lanes for every selected audio clip.'};
  }
 }
 return{...result,blocked:false};
}

/** One key-hold gesture. Repeat events paint at most once per display frame;
 * only releasing all arrow keys (or Shift) commits. Blur/Escape cancel.
 */
export class PlaylistKeyboardGesture{
 constructor({getProject,getSelectedIds,getSnap=()=>.25,getMaxTrack=()=>Infinity,getScope=()=>null,canStart=()=>true,canContinue=()=>true,getContext=()=>({}),onStart=()=>{},paint=()=>{},restore=()=>{},commit=()=>{},onFinish=()=>{},onBlocked=()=>{},onError=()=>{},move=moveKeyboardPlaylistSelection,raf=fn=>globalThis.requestAnimationFrame(fn),caf=id=>globalThis.cancelAnimationFrame(id)}={}){
  if(typeof getProject!=='function'||typeof getSelectedIds!=='function')throw new TypeError('PlaylistKeyboardGesture needs project and selection callbacks.');
  Object.assign(this,{getProject,getSelectedIds,getSnap,getMaxTrack,getScope,canStart,canContinue,getContext,onStart,paint,restore,commit,onFinish,onBlocked,onError,move,raf,caf});this.gesture=null;this.frame=null;this.suppressed=new Set();
 }
 get active(){return !!this.gesture;}
 capture(){const project=this.getProject(),selected=selectedSet(this.getSelectedIds());return{projectId:identity(project),trackId:project?.cloud?.trackId??null,epoch:clone(this.getScope()),selected:[...selected].sort(),canonical:selectedSignature(clipsOf(project),selected),snap:this.getSnap()};}
 isCurrent(){try{const context=this.getContext();return !!this.gesture&&!context.pianoActive&&!context.dialogOpen&&context.playlistActive!==false&&signature(this.capture())===signature(this.gesture.scope)&&this.canContinue();}catch{return false;}}
 consume(event){event.preventDefault?.();return true;}
 keyDown(event){
  if(this.active&&event.key==='Escape'){this.cancel();return this.consume(event);}
  if(this.active&&(!this.isCurrent()||event.target?.closest?.('input,select,textarea,dialog,[contenteditable]:not([contenteditable=false]),[role=textbox]')||this.getContext().pianoActive||this.getContext().dialogOpen)){this.cancel();return false;}
  const delta=playlistNudgeKey(event,{snapBeats:this.getSnap(),...this.getContext()});if(!delta)return false;
  if(this.suppressed.has(event.key)){if(event.repeat===true)return this.consume(event);this.suppressed.delete(event.key);}
  const existing=this.gesture,project=this.getProject(),selected=existing?.selected||selectedSet(this.getSelectedIds()),initial=existing?.initial||clone(clipsOf(project));if(!selected.size||!initial.some(clip=>selected.has(String(clip.id))))return false;
  if(!this.active&&!this.canStart(event))return false;
  const prior={base:existing?.base||0,steps:existing?.steps||0,tracks:existing?.tracks||0},steps=prior.steps+(delta.deltaBeats>0?1:delta.deltaBeats<0?-1:0),desiredBeats=prior.base+steps*(this.getSnap()>0?this.getSnap():1/96),desiredTracks=prior.tracks+delta.deltaTracks;
  let result;
  try{result=this.move(initial,selected,{deltaBeats:desiredBeats,deltaTracks:desiredTracks,maxTrack:this.getMaxTrack(),laneIds:project.cloud?.timelineLaneIds||[]});}
  catch(error){if(this.active)this.cancel();this.onError(error);return this.consume(event);}
  if(result.blocked){this.onBlocked(result.reason);return this.consume(event);}
  if(!existing&&!result.changed)return this.consume(event);
  if(!existing){
   const scope=this.capture();this.gesture={initial,selected,scope,keys:new Set(),clips:initial,base:0,steps:0,tracks:0};
   try{this.onStart({initial:clone(initial),selectedIds:new Set(selected)});}catch(error){this.cancel();this.onError(error);return this.consume(event);}
  }
  const gesture=this.gesture;gesture.keys.add(event.key);gesture.clips=result.clips;gesture.tracks=result.deltaTracks;gesture.base=result.deltaBeats===desiredBeats?prior.base:result.deltaBeats;gesture.steps=result.deltaBeats===desiredBeats?steps:0;
  if(this.frame===null)this.frame=this.raf(()=>{this.frame=null;if(!this.active)return;if(!this.isCurrent()){this.cancel();return;}try{this.paint({initial:clone(this.gesture.initial),clips:clone(this.gesture.clips),selectedIds:new Set(this.gesture.selected)});}catch(error){this.cancel();this.onError(error);}});
  return this.consume(event);
 }
 keyUp(event){
  this.suppressed.delete(event.key);if(!this.active)return false;if(event.target?.closest?.('input,select,textarea,dialog,[contenteditable]:not([contenteditable=false]),[role=textbox]')){this.cancel();return false;}
  if(event.key!=='Shift'&&!this.gesture.keys.has(event.key))return false;
  if(event.key==='Shift'){this.finish();return true;}
  this.gesture.keys.delete(event.key);if(!this.gesture.keys.size)this.finish();return true;
 }
 finish({cancel=false}={}){
  const gesture=this.gesture;if(!gesture)return null;cancel=cancel||!this.isCurrent();
  if(this.frame!==null)this.caf(this.frame);this.frame=null;this.gesture=null;
  if(cancel)for(const key of gesture.keys)this.suppressed.add(key);
  const before=new Map(gesture.initial.map(clip=>[String(clip.id),clip])),changed=!cancel&&gesture.clips.some(clip=>gesture.selected.has(String(clip.id))&&['start','track'].some(key=>clip[key]!==before.get(String(clip.id))[key]));
  const result={cancelled:cancel,changed,initial:clone(gesture.initial),clips:clone(cancel?gesture.initial:gesture.clips),selectedIds:new Set(gesture.selected)};
  try{this.restore(result);}catch(error){this.onError(error);result.error=error;}
  // Release the engine interaction barrier before the single final update, so
  // its ordinary debounce is scheduled without a redundant second update.
  try{this.onFinish(result);}catch(error){this.onError(error);result.error=error;}
  if(changed&&!result.error){try{const pending=this.commit(result);if(pending&&typeof pending.then==='function')pending.catch(this.onError);}catch(error){this.onError(error);result.error=error;}}
  return result;
 }
 cancel(){return this.finish({cancel:true});}
 blur(){return this.cancel();}
 destroy(){this.cancel();this.suppressed.clear();}
}
