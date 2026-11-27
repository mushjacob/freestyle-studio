import {MINIMIZED_TRACK_HEIGHT,createTrackLayout,partitionTrackHeight,trackLayoutHeight,setTrackMinimized,resizeTrackLayout,resizeTrackChannelBoundary,fitTrackLayouts} from './audacity-track-layout.js';
import {DEFAULT_TRACK_HEIGHT_PX} from './audacity-layout.js';
export {NATIVE_FIT_RESERVE} from './audacity-track-layout.js';

const copy=state=>({expandedHeights:[...state.expandedHeights],minimized:state.minimized});
const validCount=count=>Number.isSafeInteger(count)&&count>0&&count<=256;
const editable=target=>!!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');

function explicitChannelCount(raw){
 if(!raw||typeof raw!=='object')return null;
 const values=['channelCount','channel_count','channels'].filter(key=>Object.hasOwn(raw,key)&&(key!=='channels'||!Array.isArray(raw[key]))).map(key=>raw[key]);
 if(!values.length||!values.every(validCount)||new Set(values).size!==1)return null;
 return values[0];
}
/** A Freestyle lane is not automatically a native mono AudioTrack. Actual
 * waveform metadata or explicit canonical counts must establish its layout.
 * In particular, do not interpret project/plugin `channels` arrays as PCM.
 */
export function describeWaveformTrack(workspace,track){
 const fixed={kind:'fixed',channelCount:null};if(!track)return fixed;
 const channel=track.channel,raw=channel?.cloudRaw??track.cloudRaw;
 const kinds=[channel?.type,raw?.kind,raw?.type].filter(value=>typeof value==='string').map(value=>value.toLowerCase());
 const clips=track.clips||[];
 if(kinds.some(kind=>['instrument','pattern','midi'].includes(kind))||clips.some(clip=>clip.patternId))return fixed;
 const laneCount=explicitChannelCount(raw);
 if(!clips.length)return kinds.includes('audio')&&laneCount?{kind:'audio',channelCount:laneCount}:fixed;
 const counts=[];
 for(const clip of clips){
  const metadata=workspace.waveformView?.metadata?.(clip),count=validCount(metadata?.channelCount)?metadata.channelCount:explicitChannelCount(clip.cloudRaw);
  if(!count)return fixed;counts.push(count);
 }
 if(new Set(counts).size!==1||laneCount&&laneCount!==counts[0])return fixed;
 return {kind:'audio',channelCount:counts[0]};
}

/** Per-project, local presentation state. describeTrack must distinguish actual
 * audio channel metadata from fixed/unknown lanes; no source/channel inference.
 * Root render calls deferRender() first and height(track) for each track.
 */
export class AudacityTrackLayoutView {
 constructor(workspace,{describeTrack=track=>describeWaveformTrack(workspace,track),defaultExpandedHeight=DEFAULT_TRACK_HEIGHT_PX,getFitHeight=()=>workspace.scroll.clientHeight,onChange=()=>workspace.render?.(),onPreview,isBusy}={}){
  this.w=workspace;this.describeTrack=describeTrack;this.defaultExpandedHeight=defaultExpandedHeight;this.getFitHeight=getFitHeight;this.onChange=onChange;this.onPreview=onPreview;this.isBusy=isBusy;this.projects=new Map();this.anonymousProjects=new WeakMap();this.trackScopes=new WeakMap();this.active=null;
  const doc=workspace.root?.ownerDocument;
  this.handlers={move:event=>this.move(event),finish:event=>this.finish(event),cancel:event=>{if(this.active?.pointerId===event.pointerId)this.cancel();},blur:()=>this.cancel(),key:event=>{if(event.key==='Escape'&&this.active){event.preventDefault();event.stopImmediatePropagation();this.cancel();}}};
  doc?.addEventListener('pointermove',this.handlers.move,true);doc?.addEventListener('pointerup',this.handlers.finish,true);doc?.addEventListener('pointercancel',this.handlers.cancel,true);doc?.addEventListener('keydown',this.handlers.key,true);doc?.defaultView?.addEventListener('blur',this.handlers.blur);
 }
 projectKey(){const p=this.w.getProject();return p.cloud?.projectId||p.id||p;}
 scope(){const e=this.w.engine;return JSON.stringify([this.projectToken(),e?.projectId,e?.loadVersion??0,e?.session?.contextVersion??0,e?.session?.closed===true]);}
 projectToken(){const key=this.projectKey();if(typeof key!=='object')return key;if(!this.anonymousProjects.has(key))this.anonymousProjects.set(key,{});return this.anonymousProjects.get(key);}
 entries(){const key=this.projectKey();if(!this.projects.has(key))this.projects.set(key,new Map());return this.projects.get(key);}
 laneKey(track){return track.laneId||'track:'+track.index;}
 description(track){const input=this.describeTrack(track)||{},channelCount=validCount(input.channelCount)?input.channelCount:null;return {kind:input.kind==='audio'&&channelCount?'audio':'fixed',channelCount};}
 entry(track){
  if(!this.trackScopes.has(track))this.trackScopes.set(track,this.projectKey());const key=this.laneKey(track),entries=this.entries(),description=this.description(track);let entry=entries.get(key);
  if(!entry){entry={...description,state:createTrackLayout({height:this.defaultExpandedHeight*(description.channelCount||1),channelCount:description.channelCount||1})};entries.set(key,entry);}
  // Discovery/change of actual channel metadata preserves the custom total,
  // including saved expanded height while the linked group is minimized.
  // Audacity gives every channel TrackView::DefaultHeight, so a never-resized
  // default track grows to the discovered count (stereo: 2 x 150).
  if(description.channelCount&&description.channelCount!==entry.channelCount){const total=entry.state.expandedHeights.reduce((a,b)=>a+b,0),untouched=total===this.defaultExpandedHeight*(entry.channelCount||1);entry.state={...entry.state,expandedHeights:partitionTrackHeight(untouched?this.defaultExpandedHeight*description.channelCount:total,description.channelCount)};entry.channelCount=description.channelCount;}
  entry.kind=description.kind;return entry;
 }
 state(track){return copy(this.entry(track).state);}
 displayState(track){if(this.active&&this.laneKey(track)===this.active.lane&&this.projectKey()===this.active.project)return copy(this.active.preview);return this.state(track);}
 layoutForClip(clip){const index=clip.track??clip.index,current=this.w.tracks.find(track=>track.index===index&&(!clip.laneId||track.laneId===clip.laneId));if(!current)return null;const description=this.description(current),state=this.displayState(current);return description.kind==='audio'&&description.channelCount===state.expandedHeights.length?state:null;}
 height(track){if(this.active&&this.laneKey(track)===this.active.lane&&this.projectKey()===this.active.project)return trackLayoutHeight(this.active.preview);return trackLayoutHeight(this.entry(track).state);}
 minimized(track){if(this.active&&this.laneKey(track)===this.active.lane&&this.projectKey()===this.active.project)return this.active.preview.minimized;return this.entry(track).state.minimized;}
 blocked(){const w=this.w;return !!(this.isBusy?.()||w.busy||w.engine?.applying||w.clipGesture||w.selectionGesture?.active||w.envelopeView?.active||w.amplitudeView?.active||w.loopRegion?.active||w.viewport?.pinDrag||w.panGesture||(!this.active&&w.engine?.interacting));}
 currentTrack(track){
  if(this.trackScopes.has(track)&&this.trackScopes.get(track)!==this.projectKey())return null;
  return this.w.tracks.find(candidate=>this.laneKey(candidate)===this.laneKey(track)&&candidate.index===track.index)||null;
 }
 assertIdle(){if(this.active||this.blocked())throw new Error('Finish the current edit or gesture before resizing tracks.');}
 setMinimized(track,minimized){this.assertIdle();const current=this.currentTrack(track);if(!current)return false;const entry=this.entry(current),next=setTrackMinimized(entry.state,minimized);if(next.minimized===entry.state.minimized)return false;entry.state=next;this.onChange();return true;}
 toggle(track){this.assertIdle();const current=this.currentTrack(track);return current?this.setMinimized(current,!this.minimized(current)):false;}
 setHeight(track,height){this.assertIdle();const current=this.currentTrack(track);if(!current)return false;const entry=this.entry(current);entry.state={expandedHeights:partitionTrackHeight(height,entry.state.expandedHeights.length),minimized:false};this.onChange();return true;}
 setAllMinimized(minimized){this.assertIdle();let changed=false;for(const track of this.w.tracks){const entry=this.entry(track);if(entry.state.minimized!==minimized){entry.state=setTrackMinimized(entry.state,minimized);changed=true;}}if(changed)this.onChange();return changed;}
 collapseAll(){return this.setAllMinimized(true);}
 expandAll(){return this.setAllMinimized(false);}
 fitToHeight(){
  this.assertIdle();const rows=this.w.tracks.map(track=>{const entry=this.entry(track);return {id:this.laneKey(track),kind:entry.kind,channelCount:this.description(track).channelCount,state:entry.state};});
  const result=fitTrackLayouts(rows,this.getFitHeight());if(!result.changed){this.w.scroll.scrollTop=0;return false;}
  for(const [key,state]of result.layouts)this.entries().get(key).state=state;
  this.onChange();this.w.scroll.scrollTop=0;return true;
 }
 /** Called by the workspace's existing shortcut owner, not a second listener. */
 shortcut(event){
  if(!(event.ctrlKey||event.metaKey)||!event.shiftKey||event.altKey||editable(event.target))return false;
  const command={f:'fitToHeight',c:'collapseAll',x:'expandAll'}[event.key?.toLowerCase()];if(!command)return false;
  event.preventDefault();event.stopImmediatePropagation();this[command]();return true;
 }
 beginChannelResize(event,row,track,boundaryIndex){return this.beginResize(event,row,track,{boundaryIndex});}
 beginResize(event,row,track,{boundaryIndex}={}){
  if(event.button!==0||this.active||this.blocked())return false;const current=this.currentTrack(track);if(!current||!row.isConnected)return false;
  const entry=this.entry(current),target=event.currentTarget,scope=this.scope(),project=this.projectKey(),original=copy(entry.state),description=this.description(current);
  if(boundaryIndex!==undefined&&(description.kind!=='audio'||!Number.isInteger(boundaryIndex)||boundaryIndex<0||boundaryIndex>=description.channelCount-1||description.channelCount!==original.expandedHeights.length))return false;
  event.preventDefault();event.stopPropagation();
  this.active={pointerId:event.pointerId,target,row,lane:this.laneKey(current),index:current.index,scope,project,entry,original,preview:copy(original),description:JSON.stringify(description),boundaryIndex,startY:event.clientY,originalStyle:row.style.height,moved:false,interacting:this.w.engine?.interacting};
  if(this.w.engine)this.w.engine.interacting=true;
  target.onlostpointercapture=lost=>{if(this.active?.pointerId===lost.pointerId)this.cancel();};
  try{target.setPointerCapture?.(event.pointerId);}catch{this.cancel();return false;}return true;
 }
 valid(active){
  if(!active.row.isConnected||this.projectKey()!==active.project||this.scope()!==active.scope||this.blocked())return false;
  const current=this.w.tracks.find(track=>track.index===active.index&&this.laneKey(track)===active.lane);return !!(current&&this.entries().get(active.lane)===active.entry&&JSON.stringify(this.description(current))===active.description);
 }
 move(event){const active=this.active;if(!active||event.pointerId!==active.pointerId)return;if(!this.valid(active)){this.cancel();return;}const delta=Math.trunc(event.clientY)-Math.trunc(active.startY);if(!Number.isFinite(delta))return;
  // A border click without a drag must leave a minimized group minimized.
  if(delta===0&&!active.moved)return;active.moved=true;
  const basis=active.original.minimized&&delta===0?{expandedHeights:partitionTrackHeight(MINIMIZED_TRACK_HEIGHT,active.original.expandedHeights.length),minimized:false}:active.original;
  active.preview=active.boundaryIndex===undefined?resizeTrackLayout(basis,delta):resizeTrackChannelBoundary(basis,active.boundaryIndex,delta);if(active.moved)active.preview.minimized=false;
  active.row.style.height=trackLayoutHeight(active.preview)+'px';this.onPreview?.(active.row,trackLayoutHeight(active.preview));
 }
 finish(event){const active=this.active;if(!active||event.pointerId!==active.pointerId)return;if(!this.valid(active)){this.cancel();return;}this.move(event);if(this.active!==active)return;const changed=active.moved;if(changed)active.entry.state=copy(active.preview);this.clear();if(changed)this.onChange();this.w.finishDeferredRender?.();}
 clear(){const active=this.active;if(!active)return;this.active=null;active.target.onlostpointercapture=null;try{if(active.target.hasPointerCapture?.(active.pointerId))active.target.releasePointerCapture(active.pointerId);}catch{}if(this.w.engine)this.w.engine.interacting=active.interacting;}
 cancel(repaint=true){const active=this.active;if(!active)return;active.row.style.height=active.originalStyle;this.clear();if(repaint){this.onPreview?.(active.row,trackLayoutHeight(active.original));this.w.finishDeferredRender?.();}}
 deferRender(){if(!this.active)return false;if(!this.valid(this.active)){this.cancel(false);return false;}this.w.deferredRender=true;return true;}
 destroy(){this.cancel(false);const doc=this.w.root?.ownerDocument;doc?.removeEventListener('pointermove',this.handlers.move,true);doc?.removeEventListener('pointerup',this.handlers.finish,true);doc?.removeEventListener('pointercancel',this.handlers.cancel,true);doc?.removeEventListener('keydown',this.handlers.key,true);doc?.defaultView?.removeEventListener('blur',this.handlers.blur);}
}
