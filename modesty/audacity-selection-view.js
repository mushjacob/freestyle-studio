import {TRACK_GUTTER_PX} from './audacity-layout.js';
/** Mouse selection gestures follow Audacity's Selecting Audio model.
 * https://manual.audacityteam.org/man/audacity_selection.html
 * This changes view selection only; a completed stopped gesture seeks once.
 */
const scope=workspace=>workspace.getProject()?.cloud?.projectId||workspace.getProject()?.id;
const pointerTime=(w,x)=>w.xToTime?w.xToTime(x):x/w.scale;
export class AudacitySelectionGesture {
 constructor(workspace,{requestFrame=callback=>globalThis.requestAnimationFrame?.(callback)??setTimeout(callback,16),cancelFrame=id=>typeof globalThis.cancelAnimationFrame==='function'?globalThis.cancelAnimationFrame(id):clearTimeout(id)}={}){this.workspace=workspace;this.requestFrame=requestFrame;this.cancelFrame=cancelFrame;this.active=null;}
 shiftTracks(index){
  const w=this.workspace,indexes=(w.tracks||[]).map(track=>track.index);if(!indexes.includes(index))indexes.push(index);
  const selected=indexes.filter(index=>w.selectedTracks.has(index));let anchor=indexes.includes(w.selectionAnchorTrack)?w.selectionAnchorTrack:undefined;
  // SelectionState::ChangeSelectionOnShiftClick extends from the last picked
  // track, or the first/last selected track when no surviving anchor exists.
  if(anchor===undefined&&selected.length)anchor=indexes.indexOf(index)>=indexes.indexOf(selected[0])?selected[0]:selected.at(-1);
  if(anchor===undefined)anchor=index;const low=Math.min(indexes.indexOf(anchor),indexes.indexOf(index)),high=Math.max(indexes.indexOf(anchor),indexes.indexOf(index));
  w.selectedTracks=new Set(indexes.slice(low,high+1));w.selectionAnchorTrack=anchor;
 }
 begin(e,lane,track){
  const w=this.workspace;
  if(e.button!==0||e.target.closest('button,.au-clip-head,.au-trim-left,.au-trim-right')||w.clipGesture||w.envelopeView?.active)return;
  this.cancel();e.preventDefault();w.scroll.focus?.({preventScroll:true});
  const before={selection:{...w.selection},tracks:new Set(w.selectedTracks),clip:w.selectedClip,focusedTrack:w.focusedTrack,anchorTrack:w.selectionAnchorTrack};
  const at=this.time(e,lane),range=before.selection,selected=before.tracks.has(track.index),raw=pointerTime(w,e.clientX-lane.getBoundingClientRect().left),left=Math.abs(raw-range.start)*w.scale,right=Math.abs(raw-range.end)*w.scale;
  const edge=range.end>range.start&&selected&&Math.min(left,right)<=6?(left<=right?'start':'end'):null;
  const control=e.metaKey||e.ctrlKey,moving=e.shiftKey||control?(range.end<=range.start?(raw<range.start?'start':'end'):left<=right?'start':'end'):edge;
  const anchor=moving==='start'?range.end:moving==='end'?range.start:at;
  if(e.shiftKey)this.shiftTracks(track.index);
  else if(!control&&!edge)w.selectedTracks.clear();
  w.selectedTracks.add(track.index);
  if(control)w.selectionAnchorTrack=track.index;
  else if(!e.shiftKey&&!edge){w.focusedTrack=track.index;w.selectionAnchorTrack=track.index;}
  const clicked=e.target.closest('.au-clip');if(!edge)w.selectedClip=clicked?.dataset?.clip??null;
  const state=this.active={before,lane,track,projectId:scope(w),pointerId:e.pointerId,anchor,control:!!control,tracks:new Set(w.selectedTracks),last:{clientX:e.clientX,clientY:e.clientY},frame:null,pendingRender:false,paintPending:true};
  this.update(state,e);w.paintSelection();
  lane.onpointermove=event=>{if(event.pointerId!==undefined&&event.pointerId!==state.pointerId)return;if(!this.current(state))return;state.last={clientX:event.clientX,clientY:event.clientY};this.update(state,state.last);state.paintPending=true;this.schedule(state);};
  lane.onpointerup=event=>{if(event.pointerId===undefined||event.pointerId===state.pointerId)this.finish(false,event);};
  lane.onpointercancel=()=>this.finish(true);lane.onlostpointercapture=()=>this.finish(true);
  const doc=lane.ownerDocument??globalThis.document;if(doc){state.document=doc;state.globalUp=event=>{if(event.pointerId===undefined||event.pointerId===state.pointerId)this.finish(false,event);};state.globalCancel=event=>{if(event.pointerId===undefined||event.pointerId===state.pointerId)this.finish(true);};state.globalMove=event=>{if(!lane.hasPointerCapture?.(state.pointerId))lane.onpointermove?.(event);};doc.addEventListener('pointerup',state.globalUp,true);doc.addEventListener('pointercancel',state.globalCancel,true);doc.addEventListener('pointermove',state.globalMove,true);}
  try{lane.setPointerCapture?.(e.pointerId);}catch{state.captureUnavailable=true;}
  lane.style?.setProperty('cursor',moving?'ew-resize':'text');
  this.schedule(state);return state;
 }
 panel(e,track){
  const w=this.workspace,panel=e.currentTarget?.matches?.('.au-track-panel')?e.currentTarget:e.target.closest?.('.au-track-panel');
  if(e.button!==0||w.lanePan?.operation||e.target.closest('button,input,select,textarea,[contenteditable=true]'))return;
  // Chrome can retarget the second click to this panel when a range control
  // becomes disabled between clicks. Its measured control area still owns the
  // pointer; an ancestor target must not select the entire audio track.
  if(Number.isFinite(e.clientX)&&Number.isFinite(e.clientY)&&[...panel?.querySelectorAll('button,input,select,textarea,[contenteditable=true]')||[]].some(control=>{const r=control.getBoundingClientRect();return r.width>0&&r.height>0&&e.clientX>=r.left&&e.clientX<r.right&&e.clientY>=r.top&&e.clientY<r.bottom;}))return;
  e.preventDefault();w.scroll.focus?.({preventScroll:true});const tracks=w.tracks,indexes=tracks.map(t=>t.index),anchor=w.selectionAnchorTrack,modified=e.metaKey||e.ctrlKey;
  if(modified){if(w.selectedTracks.has(track.index))w.selectedTracks.delete(track.index);else w.selectedTracks.add(track.index);w.selectionAnchorTrack=track.index;}
  else if(e.shiftKey&&indexes.includes(anchor)){const low=Math.min(indexes.indexOf(anchor),indexes.indexOf(track.index)),high=Math.max(indexes.indexOf(anchor),indexes.indexOf(track.index));w.selectedTracks=new Set(indexes.slice(low,high+1));w.focusedTrack=track.index;}
  else{w.selectedTracks=new Set([track.index]);w.focusedTrack=track.index;w.selectionAnchorTrack=track.index;w.selection={start:track.clips.length?Math.min(...track.clips.map(c=>w.seconds(c.start))):0,end:track.clips.length?Math.max(...track.clips.map(c=>w.seconds(c.start+c.length))):0};}
  const candidates=tracks.filter(t=>w.selectedTracks.has(t.index)).flatMap(t=>t.clips).filter(c=>w.selection.start>=w.seconds(c.start)&&w.selection.end<=w.seconds(c.start+c.length));w.selectedClip=candidates.length===1?candidates[0].id:null;w.paintSelection();if(!modified&&(!e.shiftKey||!indexes.includes(anchor))&&!w.engine.playing&&!w.paused)w.seek(w.selection.start);
 }
 hover(event,lane,track){if(this.active)return;const w=this.workspace,at=pointerTime(w,event.clientX-lane.getBoundingClientRect().left),range=w.selection,left=Math.abs(at-range.start)*w.scale,right=Math.abs(at-range.end)*w.scale,modified=event.shiftKey||event.metaKey||event.ctrlKey;const edge=modified?(range.end<=range.start?(at<range.start?'start':'end'):left<=right?'start':'end'):w.selectedTracks.has(track.index)&&range.end>range.start&&Math.min(left,right)<=6?(left<=right?'start':'end'):null;if(edge)lane.dataset.selectionEdge=edge;else delete lane.dataset.selectionEdge;}
 doubleClick(event,lane,track){
  const w=this.workspace;if(event.button!==0||event.shiftKey||!['select','multi'].includes(w.tool)||event.target.closest('button,input,select,textarea,.au-clip-head,.au-trim-left,.au-trim-right'))return false;
  if(w.tool==='multi'&&w.multiToolView?.hit(event,lane,track)?.action!=='select')return false;
  this.cancel();event.preventDefault();event.stopPropagation();w.scroll.focus?.({preventScroll:true});
  const time=pointerTime(w,event.clientX-lane.getBoundingClientRect().left),clicked=event.target.closest('.au-clip'),clip=track.clips.find(clip=>String(clip.id)===clicked?.dataset.clip)??track.clips.find(clip=>time>=w.seconds(clip.start)&&time<w.seconds(clip.start+clip.length));
  w.selectedTracks=new Set([track.index]);w.focusedTrack=track.index;w.selectionAnchorTrack=track.index;w.selectedClip=clip?.id??null;
  const clips=clip?[clip]:track.clips;w.selection={start:clips.length?Math.min(...clips.map(clip=>w.seconds(clip.start))):0,end:clips.length?Math.max(...clips.map(clip=>w.seconds(clip.start+clip.length))):0};w.paintSelection();return true;
 }
 time(event,lane){return this.workspace.quantize(pointerTime(this.workspace,event.clientX-lane.getBoundingClientRect().left));}
 current(state){if(this.active!==state)return false;if(scope(this.workspace)!==state.projectId){this.finish(true,undefined,{restore:false});return false;}return true;}
 update(state,event){
  if(!this.current(state))return;
  const w=this.workspace,end=this.time(event,state.lane);w.selection={start:Math.min(state.anchor,end),end:Math.max(state.anchor,end)};
  const rows=[...w.root.querySelectorAll('.au-track')],source=rows.findIndex(row=>Number(row.dataset.track)===state.track.index),over=rows.findIndex(row=>{const r=row.getBoundingClientRect();return event.clientY>=r.top&&event.clientY<r.bottom;});
  if(source>=0&&over>=0&&!state.control){const low=Math.min(source,over),high=Math.max(source,over);w.selectedTracks=new Set([...state.tracks,...rows.slice(low,high+1).map(row=>Number(row.dataset.track))]);}
 }
 schedule(state){if(!this.current(state)||state.frame!==null)return;state.frame=this.requestFrame(timestamp=>{state.frame=null;if(!this.current(state))return;const now=Number.isFinite(timestamp)?timestamp:Date.now(),pace=state.lastFrameTime===undefined?1:Math.max(.25,Math.min(2,(now-state.lastFrameTime)/(1000/60)));state.lastFrameTime=now;const moved=this.autoscroll(state,pace);if(moved)this.update(state,state.last);if(state.paintPending||moved){state.paintPending=false;this.workspace.paintSelection();}if(moved)this.schedule(state);});}
 autoscroll(state,pace=1){
  const w=this.workspace,scroll=w.scroll,r=scroll.getBoundingClientRect(),x=state.last.clientX,y=state.last.clientY;
  const delta=(value,min,max)=>value<min?-Math.min(18,Math.max(2,(min-value)*.6)):value>max?Math.min(18,Math.max(2,(value-max)*.6)):0;
  const dx=delta(x,r.left+TRACK_GUTTER_PX+20,r.right-20),dy=Number.isFinite(y)?delta(y,r.top+51,r.bottom-20):0,oldX=w.leftSec??scroll.scrollLeft/w.scale,oldY=scroll.scrollTop;
  if(dx){const next=Math.max(0,oldX+dx*pace/w.scale);if(w.setLeftSec)w.setLeftSec(next);else scroll.scrollLeft=next*w.scale;}if(dy)scroll.scrollTop=Math.max(0,oldY+dy*pace);
  return oldX!==(w.leftSec??scroll.scrollLeft/w.scale)||oldY!==scroll.scrollTop;
 }
 finish(cancel,event,{restore=true}={}){
  const state=this.active;if(!state)return;const w=this.workspace,same=scope(w)===state.projectId;
  if(!cancel&&event&&Number.isFinite(event.clientX))this.update(state,event);
  this.active=null;if(state.frame!==null)this.cancelFrame(state.frame);if(state.document){state.document.removeEventListener('pointerup',state.globalUp,true);state.document.removeEventListener('pointercancel',state.globalCancel,true);state.document.removeEventListener('pointermove',state.globalMove,true);}
  const lane=state.lane;lane.onpointermove=lane.onpointerup=lane.onpointercancel=lane.onlostpointercapture=null;lane.style?.removeProperty('cursor');
  if(lane.hasPointerCapture?.(state.pointerId))lane.releasePointerCapture(state.pointerId);
  if(cancel&&restore&&same){w.selection={...state.before.selection};w.selectedTracks=new Set(state.before.tracks);w.selectedClip=state.before.clip;w.focusedTrack=state.before.focusedTrack;w.selectionAnchorTrack=state.before.anchorTrack;}
  if(same){w.paintSelection();if(!cancel){if(!w.engine.playing&&!w.paused)w.seek(w.selection.start);else w.tick?.();}}
  if(state.pendingRender)w.render();
 }
 cancel(options){this.finish(true,undefined,options);}
 deferRender(){if(!this.active)return false;if(scope(this.workspace)!==this.active.projectId){this.cancel({restore:false});return false;}this.active.pendingRender=true;return true;}
}
