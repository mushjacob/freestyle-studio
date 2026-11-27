import {channelRows,channelAtY} from './audacity-channel-layout.js';
import {automationValue} from './automation-ui.js';
import {hitEnvelopeContour,hitTimeShiftGrip,hitSamplePoint,multiToolHit,multiToolZoom} from './audacity-multi-tool.js';
const projectId=w=>{const p=w.getProject();return p.cloud?.projectId||p.id;};
const finite=Number.isFinite;
const svgNS='http://www.w3.org/2000/svg';
const laneIdentity=(track,lane)=>String(track?.laneId??track?.channel?.laneId??track?.channel?.id??track?.index??lane?.dataset.track??'');
const onSampleGrid=value=>finite(value)&&Math.abs(value-Math.round(value))<=4*Number.EPSILON*Math.max(1,Math.abs(value));
/** Routes Multi-Tool gestures into existing editing controllers. Only the view
 * zoom rubber band is implemented here. No envelope/audio edits are duplicated.
 * Root integration calls pointerDown before selection and before the envelope
 * graph's normal handler; beginEnvelope must bypass that wrapper to avoid a
 * routing recursion. Plain selection returns false for the existing lane path.
 */
export class AudacityMultiToolView{
 constructor(workspace,{beginEnvelope,beginMove,isCommandDown=event=>/Mac|iPhone|iPad/.test(globalThis.navigator?.platform||'Mac')?event.metaKey:event.ctrlKey,onHint=()=>{},now=()=>Date.now()}={}){
  this.w=workspace;this.beginEnvelope=beginEnvelope;this.beginMove=beginMove??((event,clip)=>workspace.dragClip(event,this.clipElement(clip),clip,{mode:'move'}));this.isCommandDown=isCommandDown;this.onHint=onHint;this.now=now;this.active=null;this.lastZoom=null;
 }
 context(){return JSON.stringify([projectId(this.w),this.w.cloudContext?.()??null,this.w.engine.loadVersion??0,this.w.engine.session?.contextVersion??0]);}
 clipElement(clip){return [...this.w.root.querySelectorAll('.au-clip')].find(element=>element.dataset.clip===String(clip?.id));}
 time(event,lane){return this.w.xToTime(event.clientX-lane.getBoundingClientRect().left);}
 clipAt(event,lane,track){const time=this.time(event,lane),matches=track.clips.filter(clip=>time>=this.w.seconds(clip.start)&&time<this.w.seconds(clip.start+clip.length));return matches.length===1?matches[0]:null;}
 row(event,clip){
  const body=this.clipElement(clip)?.querySelector('.au-clip-body'),rect=body?.getBoundingClientRect();if(!rect||!(rect.height>0)||event.clientY<rect.top||event.clientY>=rect.bottom)return null;
  const metadata=this.w.waveformView?.metadata?.(clip),count=metadata?.channelCount;if(!Number.isSafeInteger(count)||count<1||count>256)return null;
  const capture=this.w.envelopeView?.active,layout=capture?.clip?.id===clip.id?capture.channelLayout:this.w.channelLayoutForClip?.(clip)??this.w.trackLayout?.layoutForClip?.(clip),rows=channelRows(rect.height,count,layout),channel=channelAtY(event.clientY-rect.top,rows,{clamp:false});if(channel<0)return null;const {top,height}=rows[channel],y=event.clientY-rect.top;
  return {body,rect,channel,height,y:y-top,display:this.w.amplitudeView?.displayForClip?.(clip,channel),metadata};
 }
 envelope(event,lane,clip,row){
  if(!row||clip.patternId)return null;const view=this.w.envelopeView,state=view?.waveformState?.(clip),controller=view?.controller?.get?.(clip,{diagnostics:false});
  if(state?.status!=='ready'||!state.envelope||!controller?.window?.offsetKnown)return null;
  const clipTimeSec=this.time(event,lane)-controller.window.timelineStartSec,sourceTime=controller.window.sourceStartSec+clipTimeSec,envelope=state.envelope;
  if(!finite(clipTimeSec)||clipTimeSec<0||clipTimeSec>this.w.seconds(clip.length))return null;
  const value=envelope.points?.length?automationValue(envelope.points,clipTimeSec):envelope.defaultValue;if(!finite(value))return null;
  return {gain:Math.max(0,Math.min(4,value*4)),clipTimeSec,sourceTime,window:controller.window,envelope};
 }
 sample(event,lane,clip,row,envelope){
  const view=this.w.waveformView,meta=row?.metadata;if(!row||!envelope||!meta||this.w.scale<=3*meta.sampleRate||!view?.records||!view.available?.()||view.scope?.()!==view.scopeKey)return false;
  // Native SampleHandle rounds PROJECT time before GetFloats. Only offer a
  // hotspot when canonical placement/source offsets share that sample grid;
  // arbitrary millisecond cloud placements have no proven native mapping.
  const start=meta.startMs/1000*meta.sampleRate,window=envelope.window;
  if(!onSampleGrid(start)||!onSampleGrid(window.timelineStartSec*meta.sampleRate)||!onSampleGrid(window.sourceStartSec*meta.sampleRate)||Math.round(window.timelineStartSec*meta.sampleRate)!==Math.round(start)||Math.round(window.sourceStartSec*meta.sampleRate)!==meta.clipOffsetFrames)return false;
  const record=view.records.get(meta.clipId);if(!record||record.version!==view.version?.(clip))return false;const state=record.windows.get(record.desiredKey),tile=state?.status==='ready'?state.tile:null;
  if(!tile||tile.revision!==meta.revision||tile.sampleRate!==meta.sampleRate||tile.frameCount!==meta.frameCount||tile.channelCount!==meta.channelCount||tile.gain!==meta.gain||tile.clipOffsetFrames!==meta.clipOffsetFrames||tile.clipFrameCount!==meta.clipFrameCount||tile.startMs!==meta.startMs||tile.bucketCount!==tile.endFrame-tile.startFrame)return false;
  const timelineFrame=Math.floor(this.time(event,lane)*meta.sampleRate+.5),placementFrame=Math.floor(meta.startMs/1000*meta.sampleRate+.5),frame=meta.clipOffsetFrames+timelineFrame-placementFrame;
  if(!Number.isSafeInteger(frame)||frame<meta.clipOffsetFrames||frame>=meta.clipOffsetFrames+meta.clipFrameCount||frame<tile.startFrame||frame>=tile.endFrame)return false;
  const channel=tile.channels[row.channel],index=frame-tile.startFrame,min=channel?.min?.[index],max=channel?.max?.[index];if(!finite(min)||min!==max||!finite(tile.gain))return false;
  const normalized=envelope.envelope.points?.length?automationValue(envelope.envelope.points,(frame-meta.clipOffsetFrames)/meta.sampleRate):envelope.envelope.defaultValue;if(!finite(normalized))return false;
  return hitSamplePoint({verified:true,sample:min,envelopeGain:tile.gain*Math.max(0,Math.min(4,normalized*4)),y:row.y,height:row.height,display:row.display,pixelsPerSecond:this.w.scale,sampleRate:meta.sampleRate});
 }
 movement(clip,event,lane,track){
  const w=this.w,time=this.time(event,lane),selected=!event.shiftKey&&w.selectedTracks?.has(track.index)&&time>=w.selection.start&&time<w.selection.end,affected=event.shiftKey?track.clips:selected?(w.tracks||[track]).filter(item=>w.selectedTracks.has(item.index)).flatMap(item=>item.clips.filter(item=>w.seconds(item.start)<w.selection.end&&w.seconds(item.start+item.length)>w.selection.start)):clip?[clip]:[];
  const group=affected.length>1||selected&&!!w.groupMoves||event.shiftKey&&track.clips.every(item=>!item.patternId);
  if(group){if(!w.groupMoves)return {allowed:false,reason:'Moving this native selection or whole track requires an atomic group-move controller.'};const available=w.groupMoves.canBegin(event,lane,track,{clip});return {...available,group:true};}
  if(!clip)return {allowed:false,reason:'There is no unique audio clip at this move position.'};return {allowed:true,group:false};
 }
 hit(event,lane,track){
  if(this.w.tool!=='multi'||!lane||!track||event.target?.closest?.('button,input,select,textarea,.au-clip-head,.au-track-resize,.au-channel-divider')||event.target?.closest?.('.au-trim-left,.au-trim-right')&&!this.isCommandDown(event))return {action:'none'};
  const clip=this.clipAt(event,lane,track),row=clip&&this.row(event,clip),envelope=clip&&this.envelope(event,lane,clip,row),rect=lane.getBoundingClientRect(),policy=multiToolHit({commandDown:this.isCommandDown(event)===true,envelopeHit:!!envelope&&hitEnvelopeContour({gain:envelope.gain,y:row.y,height:row.height,display:row.display}),gripHit:hitTimeShiftGrip({x:event.clientX-rect.left,width:rect.width}),sampleHit:!!clip&&this.sample(event,lane,clip,row,envelope),rightButton:event.button===2||(event.buttons&2)!==0});
  if(policy.action==='sample-unavailable'&&this.w.pencil?.available?.())policy.action='sample';return {...policy,clip,channel:row?.channel,row,envelope};
 }
 editBlock(hit,event,lane,track){
  if(!['move','envelope','sample','sample-unavailable'].includes(hit.action))return '';
  if(this.w.busy||this.w.engine.applying||this.w.engine.playing||this.w.paused||this.w.engine.recorder?.recording||this.w.engine.playAttempt)return 'Stop cloud audio and finish pending edits before using this edit handle.';
  if(hit.action==='sample-unavailable')return 'Drawing individual audio samples needs a cloud engine sample-write API. The displayed sample is read-only.';
  if(hit.action==='move'){const motion=this.movement(hit.clip,event,lane,track);if(!motion.allowed)return motion.reason;}
  if(hit.action==='envelope'&&typeof this.beginEnvelope!=='function')return 'The gain-envelope gesture controller is unavailable.';
  return '';
 }
 hover(event,lane,track){
  if(this.active||this.w.pencil?.active||this.w.groupMoves?.active||this.w.clipGesture||this.w.envelopeView?.active||this.w.selectionGesture?.active)return null;
  const hit=this.hit(event,lane,track);if(hit.action==='none'){delete lane.dataset.multiAction;lane.style.removeProperty('cursor');return hit;}
  hit.reason=this.editBlock(hit,event,lane,track);lane.dataset.multiAction=hit.action;lane.style.cursor=hit.reason?'not-allowed':hit.action==='move'?'ew-resize':['envelope','sample'].includes(hit.action)?'crosshair':hit.action==='sample-unavailable'?'not-allowed':hit.action==='zoom'?'zoom-out':lane.dataset.selectionEdge?'ew-resize':'text';this.onHint(hit);return hit;
 }
 unavailable(message,event){event.preventDefault();event.stopPropagation();this.w.onError?.(new Error(message));return true;}
 pointerDown(event,lane,track){
  if(this.active)return true;this.lastZoom=null;const hit=this.hit(event,lane,track);if(hit.action==='none'||hit.action==='select')return false;
  // Earlier detailed handles do not handle right clicks. Keep their normal
  // context menu rather than falling through to the zoom handle.
  if(event.button===2&&hit.action!=='zoom')return false;
  if(hit.action==='zoom'){if(event.button!==2)return false;return this.beginZoom(event,lane,track);}
  if(event.button!==0)return false;
  const blocked=this.editBlock(hit,event,lane,track);if(blocked)return this.unavailable(blocked,event);
  if(hit.action==='move'){
   const motion=this.movement(hit.clip,event,lane,track);if(motion.group)return this.w.groupMoves.begin(event,lane,track,{clip:hit.clip});
   if(!this.clipElement(hit.clip))return this.unavailable('The clip view changed before the move. Refresh the view.',event);
   this.beginMove(event,hit.clip,hit);return true;
  }
  if(hit.action==='sample')return this.w.pencil.beginSample(event,hit.clip,hit);
  if(hit.action==='envelope'){
   this.beginEnvelope(event,hit.clip,hit);return true;
  }
  return false;
 }
 contextMenu(event,lane,track){
  if(this.w.tool!=='multi')return false;
  const recent=this.lastZoom&&this.lastZoom.laneId===laneIdentity(track,lane)&&this.lastZoom.context===this.context()&&this.now()-this.lastZoom.at<1000&&Math.abs(event.clientX-this.lastZoom.x)<=3&&Math.abs(event.clientY-this.lastZoom.y)<=3;
  if(this.active||recent||this.hit(event,lane,track).action==='zoom'){
   if(this.active)this.active.contextConsumed=true;if(recent)this.lastZoom=null;
   event.preventDefault();event.stopPropagation();return true;
  }return false;
 }
 beginZoom(event,lane,track){
  if(this.w.groupMoves?.active||this.w.clipGesture||this.w.envelopeView?.active||this.w.selectionGesture?.active||this.w.panGesture||this.w.amplitudeView?.active||this.w.loopRegion?.active)return false;
  event.preventDefault();event.stopPropagation();const rect=lane.getBoundingClientRect();if(!(rect.width>0))return true;
  const doc=lane.ownerDocument,state=this.active={lane,laneId:laneIdentity(track,lane),doc,pointer:event.pointerId,context:this.context(),rect,startX:event.clientX-rect.left,endX:event.clientX-rect.left,scale:this.w.scale,leftSec:this.w.leftSec,last:event,overlay:null};
  const move=move=>{if(move.pointerId!==state.pointer||this.active!==state)return;state.endX=Math.max(0,Math.min(rect.width-1,move.clientX-rect.left));state.last=move;this.paintZoom(state);};
  const finish=up=>{if(up.pointerId===state.pointer)this.finishZoom(false,up);};const cancel=up=>{if(up.pointerId===undefined||up.pointerId===state.pointer)this.cancel();};
  Object.assign(state,{move,finish,cancel,blur:()=>this.cancel()});doc.addEventListener('pointermove',move,true);doc.addEventListener('pointerup',finish,true);doc.addEventListener('pointercancel',cancel,true);doc.defaultView.addEventListener('blur',state.blur);lane.addEventListener('lostpointercapture',cancel);
  try{lane.setPointerCapture?.(state.pointer);}catch{}return true;
 }
 panelRect(state){
  const scroll=this.w.scroll,viewport=scroll?.getBoundingClientRect?.(),ruler=this.w.root.querySelector('#au-ruler')?.getBoundingClientRect?.();
  if(!viewport||!finite(viewport.top)||!finite(viewport.bottom)||!(scroll.clientHeight>0)||!(scroll.clientWidth>0))return null;
  const top=viewport.top+(scroll.clientTop||0),bottom=Math.min(viewport.bottom,top+scroll.clientHeight),panelTop=ruler?.height>0?Math.max(top,Math.min(bottom,ruler.bottom)):top,left=Math.max(state.rect.left,viewport.left+(scroll.clientLeft||0)),right=Math.min(state.rect.right,viewport.right,viewport.left+(scroll.clientLeft||0)+scroll.clientWidth);
  return bottom>panelTop&&right>left?{top:panelTop,left,width:right-left,height:bottom-panelTop}:null;
 }
 paintZoom(state){
  if(Math.abs(state.endX-state.startX)<=3){state.overlay?.remove();state.overlay=null;return;}
  const panel=this.panelRect(state);if(!panel){state.overlay?.remove();state.overlay=null;return;}
  // ZoomHandle::DrawingArea expands the clicked channel rect to the WHOLE
  // visible track panel (TrackPanelDrawable.h52), not just its lane/channel.
  // A fixed overlay avoids each track's overflow clipping and cannot hit audio.
  if(!state.overlay){const overlay=state.doc.createElementNS(svgNS,'svg');overlay.classList.add('au-multi-zoom-region');overlay.setAttribute('aria-hidden','true');Object.assign(overlay.style,{position:'fixed',pointerEvents:'none',overflow:'hidden',zIndex:'4500'});overlay.innerHTML='<rect fill="none" stroke="currentColor" stroke-dasharray="3 3"/>';state.doc.body.append(overlay);state.overlay=overlay;}
  Object.assign(state.overlay.style,{left:panel.left+'px',top:panel.top+'px',width:panel.width+'px',height:panel.height+'px'});
  const rect=state.overlay.firstElementChild;rect.setAttribute('x',String(state.rect.left+Math.min(state.startX,state.endX)-panel.left));rect.setAttribute('y','-1');rect.setAttribute('width',String(1+Math.abs(state.endX-state.startX)));rect.setAttribute('height',String(panel.height+2));
 }
 finishZoom(cancel,event){
  const state=this.active;if(!state)return;this.active=null;state.doc.removeEventListener('pointermove',state.move,true);state.doc.removeEventListener('pointerup',state.finish,true);state.doc.removeEventListener('pointercancel',state.cancel,true);state.doc.defaultView.removeEventListener('blur',state.blur);state.lane.removeEventListener('lostpointercapture',state.cancel);state.overlay?.remove();try{if(state.lane.hasPointerCapture?.(state.pointer))state.lane.releasePointerCapture(state.pointer);}catch{}
  if(cancel||state.context!==this.context()||this.w.tool!=='multi'||state.scale!==this.w.scale||state.leftSec!==this.w.leftSec||state.lane.getBoundingClientRect().width!==state.rect.width)return;
  event=event??state.last;if(finite(event.clientX))state.endX=event.clientX-state.rect.left;
  const zoom=multiToolZoom({startX:state.startX,endX:state.endX,width:state.rect.width,scale:state.scale,leftSec:state.leftSec,shift:event.shiftKey});
  this.lastZoom=state.contextConsumed?null:{at:this.now(),x:event.clientX,y:event.clientY,laneId:state.laneId,context:this.context()};
  const result=this.w.viewport.command('factor',{factor:zoom.factor,anchorPx:zoom.kind==='region'?0:zoom.anchorPx});
  if(zoom.kind==='region'&&result!==null)this.w.setLeftSec(zoom.leftSec);
 }
 cancel(){this.finishZoom(true);}
}
