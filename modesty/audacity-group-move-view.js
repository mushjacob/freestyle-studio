import {isIdempotencyInProgress,definiteCloudRejection,retainInProgress,captureWriteRequest,replayKnownBusyWrite} from './cloud-errors.js';
import {completeCanonicalPlacements} from './audacity-canonical-placements.js';
import {captureNativeGroupMove,planCloudGroupMove} from './audacity-group-move.js';
import {createFreestyleRangeAdapters,validateRangeBatchOperations,unwrapRangeEditResult} from './audacity-range-edit.js';
import {assertCompleteCanonicalData} from './cloud-session.js';
import {assertAutomationJsonValue} from './audacity-automation-contract.js';
import {normalizeClipWaveform} from './cloud-waveform.js';
const clone = value => structuredClone(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const idOf = w => w.getProject()?.cloud?.projectId || w.getProject()?.id;
const abort = () => Object.assign(new Error('The cloud project, source or group-move binding changed.'),{name:'AbortError'});
const ignored = new Set(['updatedAt','updated_at','createdAt','created_at']);
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(key => !ignored.has(key)).sort().map(key => [key,stable(value[key])])) : value;
const key = value => JSON.stringify(stable(value));
const checkpointKey=value=>key({...value,project:{...value.project,timelineRevision:undefined}});
const sorted = rows => rows.slice().sort((a,b) => String(a.id ?? `${a.clipId}:${a.targetKey}`).localeCompare(String(b.id ?? `${b.clipId}:${b.targetKey}`)));
const canonical = result => unwrapRangeEditResult(result);
const localBinding = w => key({bpm:w.getProject().bpm,clips:w.getProject().audioClips,patterns:w.getProject().clips,lanes:w.getProject().cloud?.timelineLaneIds,channels:w.getProject().channels});
const rawTiming = clip => ({start_ms:clip.startMs,duration_sec:clip.durationSec,audio_offset_sec:clip.audioOffsetSec ?? clip.effects?.timing?.audioOffsetSec});
const sameNumber = (a,b) => finite(a) && finite(b) && Math.abs(a-b) <= 8*Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b));
function sourceSignature(tile) { return {clipId:tile.clipId,revision:tile.revision,sampleRate:tile.sampleRate,channelCount:tile.channelCount,frameCount:tile.frameCount,startMs:tile.startMs,clipOffsetFrames:tile.clipOffsetFrames,clipFrameCount:tile.clipFrameCount,gain:tile.gain}; }
async function mapBounded(items, callback, parallel = 4) {
 const result = new Array(items.length); let next = 0;
 await Promise.all(Array.from({length:Math.min(parallel,items.length)},async () => { for (;;) { const index = next++; if (index >= items.length) return; result[index] = await callback(items[index],index); } }));
 return result;
}

/** Atomic same-lane horizontal audio movement on the persisted whole-ms start
 * grid. Preview and writes use one common grid delta, with full timing fields
 * in forward and inverse updates. The batch tool supplies timing
 * preconditions, not a whole-project compare-and-swap. Fresh complete before/
 * after project, placement, automation and source-revision reads therefore
 * verify what happened; any discrepancy remains applied-unverified. They cannot
 * retroactively prevent an unrelated external edit during the server request.
 * Only explicit verification of a known-running idempotent write replays its original request. No engine history, routing field or
 * idempotency argument is invented. The inverse is the exact retained timing
 * update, enabled only at its matching complete canonical checkpoint.
 */
export class AudacityGroupMoves {
 constructor(workspace,{isAvailable = () => workspace.rangeSupported === true && workspace.waveformSupported === true,onCommit} = {}) {
  this.w = workspace; this.isAvailable = isAvailable; this.onCommit = onCommit ?? (action => workspace.ownedEdit ? workspace.ownedEdit('move',action) : action());
  this.active = null; this.past = new Map(); this.future = new Map(); this.receipts = new Map(); this.pending = new Map();
 }
 stack(map,id = idOf(this.w)) { if (!map.has(id)) map.set(id,[]); return map.get(id); }
 context() { const w=this.w,e=w.engine,s=e.session; return {projectId:idOf(w),trackId:s?.trackId,loadVersion:e.loadVersion??0,contextVersion:s?.contextVersion??0,cloudContext:w.cloudContext?.()??null}; }
 assertContext(context) {
  const w=this.w,e=w.engine,s=e.session,now=this.context();
  if (key(now)!==key(context) || e.ready!==true || e.loading || s?.closed || e.projectId && e.projectId!==context.projectId || s?.projectId && s.projectId!==context.projectId) throw abort();
 }
 available() {
  const w=this.w,e=w.engine;
  if (!this.isAvailable() || e.ready!==true || typeof e.session?.call!=='function' || !e.session.trackId || w.capabilityContext && w.capabilityContext!==w.cloudContext?.()) throw new Error('Refresh the connected waveform and atomic clip-batch capabilities before moving an audio group.');
 }
 idle({gesture=false}={}) {
  const w=this.w,e=w.engine;
  if (w.busy || e.applying || e.playing || w.paused || e.playAttempt || e.recorder?.recording || w.clipGesture || w.envelopeView?.active || w.selectionGesture?.active || w.trackLayout?.active || w.amplitudeView?.active || w.loopRegion?.active || w.panGesture || !gesture && e.interacting) throw new Error('Stop cloud audio and finish the current edit or gesture before moving an audio group.');
 }
 uncertain(id = idOf(this.w)) { return this.stack(this.receipts,id).some(entry => entry.status==='uncertain'); }
 unverified(id = idOf(this.w)) { return this.stack(this.receipts,id).some(entry => entry.status==='applied-unverified'); }
 clearFuture(id = idOf(this.w)) { this.stack(this.future,id).length=0; }
 async metadata(clipId,context) {
  this.assertContext(context);
  const input={projectId:context.projectId,trackId:context.trackId,clipId,buckets:1};
  const response=await this.w.engine.session.call('get_clip_waveform',{project_id:context.projectId,track_id:context.trackId,clip_id:clipId,buckets:1});
  this.assertContext(context); return sourceSignature(normalizeClipWaveform(response,input));
 }
 rawProject() {
  const p=this.w.getProject(),raw=p.cloud?.rawProject;
  if (!raw || (raw.id!==undefined && raw.id!==idOf(this.w)) || !Array.isArray(raw.clips)) throw new Error('A complete canonical audio project is required before capturing group movement.');
  assertCompleteCanonicalData(raw,'group move project');assertAutomationJsonValue(raw);return raw;
 }
 async capture({track,clip,clickSec,shift=false,selection=clone(this.w.selection),selectedTracks=[...this.w.selectedTracks]}={}) {
  this.w.assertOwnedEditsSettled?.();this.available();const context=this.context(),binding=localBinding(this.w),raw=this.rawProject(),w=this.w,bpm=w.getProject().bpm;
  if (!finite(bpm) || bpm<=0 || !track?.laneId) throw new Error('Capture a persisted audio lane and known tempo.');
  const rows=w.tracks,selectedLaneIds=rows.filter(row=>selectedTracks.includes(row.index)).map(row=>row.laneId);
  if (selectedLaneIds.length!==selectedTracks.length || selectedLaneIds.some(id=>!id)) throw new Error('The selected track identities changed.');
  const rawById=new Map();for(const take of raw.clips){if(typeof take.id!=='string'||rawById.has(take.id))throw new Error('Canonical audio identities are missing or duplicated.');rawById.set(take.id,take);}
  const audio=w.getProject().audioClips??[];
  if (audio.length!==raw.clips.length || new Set(audio.map(item=>item.cloudId||item.id)).size!==raw.clips.length) throw new Error('Visible and canonical audio clip membership disagree.');
  const selectedMode=!shift&&selectedTracks.includes(track.index)&&clickSec>=selection.start&&clickSec<selection.end;
  const requiredRows=shift?[track]:selectedMode?rows.filter(row=>selectedTracks.includes(row.index)):[track];
  const required=requiredRows.flatMap(row=>row.clips);
  if (required.some(item=>item.patternId)) throw new Error('Pattern or mixed lanes cannot be moved by the audio batch contract.');
  if (required.length>4096) throw new Error('This source layout exceeds the bounded group metadata read. No partial group will be moved.');
  const sources=new Map(await mapBounded(required,async item=>{const id=item.cloudId||item.id;if(!rawById.has(id))throw new Error('A group clip lacks a durable canonical audio identity.');return [id,await this.metadata(id,context)];}));
  this.assertContext(context);if(localBinding(w)!==binding)throw abort();
  const tracks=rows.map(row=>{
   const kind=row.clips.some(item=>item.patternId)||['instrument','pattern','midi'].includes(row.channel?.type)?'fixed':'audio';
   // timelineTracks sorts for paint. Native interval ownership preserves the
   // supplied canonical clip order, which also chooses CapturedInterval.
   const ordered=kind==='audio'?raw.clips.filter(item=>item.laneId===row.laneId).map(take=>audio.find(item=>(item.cloudId||item.id)===take.id)):row.clips;
   if(ordered.some(item=>!item))throw new Error('Canonical audio membership differs from the visible source clips.');
   const clips=ordered.map(item=>{
    if(item.patternId)return {id:item.cloudId||item.id,start_ms:w.seconds(item.start)*1000,duration_sec:w.seconds(item.length),audio_offset_sec:0,patternId:item.patternId};
    const id=item.cloudId||item.id,take=rawById.get(id);if(!take||take.laneId!==row.laneId)throw new Error('The canonical clip lane differs from its visible routing.');
    const timing=rawTiming(take),source=sources.get(id);
    if(source && (!Object.is(source.startMs,timing.start_ms)||!sameNumber(source.clipFrameCount/source.sampleRate,timing.duration_sec)||!sameNumber(source.clipOffsetFrames/source.sampleRate,timing.audio_offset_sec)))throw new Error('The source sample window differs from the canonical clip timing. Refresh before moving this group.');
    return {id,lane_id:row.laneId,...Object.fromEntries(Object.entries(timing).filter(([,value])=>value!==undefined)),...(source?{sampleRate:source.sampleRate,channelCount:source.channelCount,sourceRevision:source.revision}:{}),canonical:clone(take)};
   });
   const first=clips.find(item=>sources.has(item.id)),source=first&&sources.get(first.id);
   return {laneId:row.laneId,kind,clips,...(source?{sampleRate:source.sampleRate,channelCount:source.channelCount}:{})};
  });
  const native=captureNativeGroupMove({tracks,capturedLaneId:track.laneId,...(clip?{capturedClipId:clip.cloudId||clip.id}:{}),clickSec,selection,selectedLaneIds,shift,syncLocked:w.syncLocked===true||w.getProject().syncLocked===true});
  return {native,context,binding,sources:Object.fromEntries(sources),selection:clone(selection),bpm};
 }
 async checkpoint(context,clipIds) {
  this.assertContext(context);const s=this.w.engine.session;
  const [projectResponse,automationResponse]=await Promise.all([
   s.call('get_project',{project_id:context.projectId}),
   s.call('list_automation',{project_id:context.projectId}),
  ]);
  this.assertContext(context);
  const projectBody=canonical(projectResponse),project=projectBody.project??projectBody,fastPlacements=completeCanonicalPlacements(project,context.projectId);
  const placements=fastPlacements===null?canonical(await s.call('execute_pro_action',{project_id:context.projectId,track_id:context.trackId,action:'list_pattern_placements',arguments:{}})):{placements:fastPlacements},automation=canonical(automationResponse);
  this.assertContext(context);
  for(const value of [projectBody,project,placements,automation]){
   assertCompleteCanonicalData(value,'group move canonical checkpoint');assertAutomationJsonValue(value);
   for(const field of ['projectId','project_id'])if(value[field]!==undefined&&value[field]!==context.projectId)throw new Error('A group checkpoint belongs to another project.');
  }
  if(project.id!==undefined&&project.id!==context.projectId||!Array.isArray(project.clips)||!Array.isArray(placements.placements)||!Array.isArray(automation.envelopes))throw new Error('Complete project, placement and automation reads are required for group history.');
  for(const row of [...project.clips,...placements.placements,...automation.envelopes])for(const field of ['projectId','project_id'])if(row[field]!==undefined&&row[field]!==context.projectId)throw new Error('A canonical group row belongs to a different project.');
  const ids=new Set();for(const take of project.clips){if(typeof take.id!=='string'||ids.has(take.id))throw new Error('The group checkpoint has ambiguous audio identities.');ids.add(take.id);}
  const sources=Object.fromEntries(await mapBounded(clipIds,async id=>[id,await this.metadata(id,context)]));
  return {project:{...project,clips:sorted(project.clips)},placements:sorted(placements.placements),automation:sorted(automation.envelopes),sources};
 }
 verifyCapture(captured,before) {
  const actual=new Map(before.project.clips.map(clip=>[clip.id,clip]));
  const expected=captured.native.tracks.flatMap(track=>track.clips.filter(clip=>clip.canonical));
  if(actual.size!==expected.length)throw new Error('Canonical audio membership changed while the group was captured.');
  for(const clip of expected)if(key(actual.get(clip.id))!==key(clip.canonical))throw new Error('Canonical timing, source, routing or revision changed before the group move.');
  for(const moving of captured.native.moving)if(key(before.sources[moving.clipId])!==key(captured.sources[moving.clipId]))throw new Error('A group source revision changed before the move.');
 }
 verifyResult(before,after,ops) {
  const expected=clone(before),byId=new Map(expected.project.clips.map(clip=>[clip.id,clip]));
  for(const op of ops){const clip=byId.get(op.id);if(!clip)throw new Error('The moved clip disappeared from its canonical checkpoint.');for(const [field,value]of Object.entries(op.expected??{}))if(!Object.is(rawTiming(clip)[field],value))throw new Error('The retained batch precondition differs from its canonical checkpoint.');clip.startMs=op.start_ms;if(expected.sources[op.id])expected.sources[op.id].startMs=op.start_ms;}
  if(checkpointKey(expected)!==checkpointKey(after))throw new Error('The atomic group readback changed timing, source, routing, revisions, automation or other canonical data. The requested numeric precision is not verified.');
 }
 async lock(action) {
  this.available();this.idle();const w=this.w,body=w.root?.ownerDocument?.body;w.busy=true;body?.classList.add('au-cloud-busy');
  try{return await action();}finally{w.busy=false;body?.classList.remove('au-cloud-busy');w.lanePan?.sync?.();}
 }
 async flush(context) { await this.w.envelopeView?.controller.saveQueue;await this.w.engine.flush();this.assertContext(context); }
 async dispatch(entry,operations,reason) {
  const request={projectId:entry.context.projectId,operations:validateRangeBatchOperations(operations),idempotencyKey:crypto.randomUUID()},attempt={reason,request:clone(request),raw:null,receipt:null,status:'sending'};entry.attempts.push(attempt);
  const adapters=createFreestyleRangeAdapters({getTrackId:()=>entry.context.trackId,cloudCall:async(name,args)=>{this.assertContext(entry.context);const revision=(entry.verifyBefore??entry.before)?.project?.timelineRevision;if(revision)args={...args,if_match:revision};attempt.writeRequest=captureWriteRequest(name,args);const raw=await this.w.engine.session.call(name,clone(attempt.writeRequest.arguments));attempt.raw=clone(raw);return raw;}});
  try{const receipt=await adapters.sendBatch(request);attempt.receipt=clone(receipt);attempt.status='acknowledged';return attempt;}catch(error){retainInProgress(entry,error);retainInProgress(attempt,error);attempt.error=error.message;attempt.status=isIdempotencyInProgress(error)?'uncertain':Number(error.status)===409?'conflict':definiteCloudRejection(error)?'rejected':'uncertain';entry.status=attempt.status;throw error;}
 }
 async verifyAfter(entry,attempt,before) {
  entry.status='applied-unverified';entry.verifyBefore=clone(before);entry.verifyOperations=clone(attempt.request.operations);
  try{
   this.assertContext(entry.context);await this.w.engine.refresh();this.assertContext(entry.context);await this.w.envelopeView?.reload();
   const after=await this.checkpoint(entry.context,entry.clipIds);entry.readback=clone(after);this.verifyResult(before,after,attempt.request.operations);
   if(attempt.receipt.payload.engine_reload_required===true)throw new Error('The persisted group move needs a live engine reload before its source placements are verified.');
   entry.checkpoint=after;entry.checkpointKey=checkpointKey(after);entry.status=entry.applied==='undone'?'undone':'applied';entry.error=null;
   return true;
  }catch(error){entry.status='applied-unverified';entry.error=error.message;return false;}
 }
 async apply(captured,plan) {
  this.w.assertOwnedEditsSettled?.();if(key(planCloudGroupMove(captured.native,plan.request))!==key(plan))throw new Error('The native group plan was changed or reduced after capture.');
  if(plan.noOp)return {status:'noop',plan};
  return this.lock(async()=>{
   const id=captured.context.projectId;if(this.uncertain(id)||this.unverified(id))throw new Error('Reconcile the retained group receipt before another group mutation.');
   await this.flush(captured.context);if(localBinding(this.w)!==captured.binding)throw abort();
   const entry={context:clone(captured.context),capture:clone(captured.native),plan:clone(plan),clipIds:captured.native.moving.map(item=>item.clipId),forwardOps:clone(plan.ops),inverseOps:clone(plan.inverseOps),beforeSelection:clone(captured.selection),afterSelection:clone(plan.selection),attempts:[],status:'preparing',applied:null,checkpoint:null,error:null};
   this.stack(this.receipts,id).push(entry);this.pending.set(id,entry);
   try{
    const before=await this.checkpoint(captured.context,entry.clipIds);entry.before=clone(before);this.assertContext(captured.context);if(localBinding(this.w)!==captured.binding)throw abort();this.verifyCapture(captured,before);
    const attempt=await this.dispatch(entry,entry.forwardOps,'move');entry.applied='move';this.stack(this.past,id).push(entry);this.clearFuture(id);
    const verified=await this.verifyAfter(entry,attempt,before);
    if(verified&&idOf(this.w)===id){this.w.selection=clone(entry.afterSelection);this.w.paintSelection?.();}
    this.w.engine.onStatus?.(verified?'Audio group moved in Freestyle (1 ms placement grid).':'Audio group saved; exact canonical history is unverified: '+entry.error);
    return entry;
   }catch(error){entry.error=error.message;if(!entry.attempts.length)entry.status='rejected';throw error;}finally{if(entry.status!=='uncertain')this.pending.delete(id);}
  });
 }
 can(direction) { const entry=this.stack(direction==='undo'?this.past:this.future).at(-1);if(!entry?.checkpoint||this.w.busy||this.uncertain()||this.unverified())return false;try{this.assertContext(entry.context);return true;}catch{return false;} }
 undo(){return this.history('undo');} redo(){return this.history('redo');}
 async history(direction) {
  if(!['undo','redo'].includes(direction))throw new Error('Choose group Undo or Redo.');
  const id=idOf(this.w),from=this.stack(direction==='undo'?this.past:this.future,id),to=this.stack(direction==='undo'?this.future:this.past,id),entry=from.at(-1);if(!entry)return false;
  if(!this.can(direction))throw new Error('This group move has no verified matching canonical history checkpoint.');
  return this.lock(async()=>{
   await this.flush(entry.context);const before=await this.checkpoint(entry.context,entry.clipIds);if(checkpointKey(before)!==entry.checkpointKey)throw new Error('Other cloud edits changed the group checkpoint. Its inverse will not be mixed with separate history.');
   entry.verifyBefore=clone(before);const operations=direction==='undo'?entry.inverseOps:entry.forwardOps,attempt=await this.dispatch(entry,operations,direction);entry.applied=direction==='undo'?'undone':'move';from.pop();to.push(entry);
   const verified=await this.verifyAfter(entry,attempt,before);
   if(verified){this.w.selection=clone(direction==='undo'?entry.beforeSelection:entry.afterSelection);this.w.paintSelection?.();}
   this.w.engine.onStatus?.(verified?`Audio group ${direction==='undo'?'undone':'redone'} in Freestyle.`:'Group history saved but its canonical result remains unverified: '+entry.error);return true;
  });
 }
 async reconcile() {
  const entry=[...this.stack(this.receipts)].reverse().find(item=>['applied-unverified','uncertain'].includes(item.status));if(!entry)throw new Error('No acknowledged group move is waiting for verification. Uncertain mutations are never retried.');
  return this.lock(async()=>{this.assertContext(entry.context);const attempt=entry.attempts.at(-1);
   if(entry.status==='uncertain'){
    const {raw,receipt}=await replayKnownBusyWrite({knownBusy:attempt?.idempotencyInProgress===true,request:attempt?.writeRequest,call:(name,args)=>this.w.engine.session.call(name,args),assertCurrent:()=>this.assertContext(entry.context),parse:canonical});
    attempt.raw=clone(raw);attempt.receipt={payload:clone(receipt)};attempt.status='acknowledged';attempt.idempotencyInProgress=false;entry.idempotencyInProgress=false;entry.status='applied-unverified';
    entry.recoveredDirection=attempt.reason;entry.verifyBefore??=clone(entry.before);entry.verifyOperations=clone(attempt.request.operations);
   }
   if(entry.recoveredDirection&&entry.recoveredDirection!=='move'){const from=this.stack(entry.recoveredDirection==='undo'?this.past:this.future,entry.context.projectId);if(from.at(-1)!==entry)throw new Error('Group history order changed while its receipt was pending.');}
   const verified=await this.verifyAfter(entry,attempt,entry.verifyBefore);
   if(verified&&entry.recoveredDirection){
    const direction=entry.recoveredDirection,id=entry.context.projectId;
    if(direction==='move'){entry.applied='move';if(!this.stack(this.past,id).includes(entry)){this.stack(this.past,id).push(entry);this.clearFuture(id);this.w.recordOwnedHistory?.('move',id);}}
    else{const from=this.stack(direction==='undo'?this.past:this.future,id),to=this.stack(direction==='undo'?this.future:this.past,id);if(from.at(-1)!==entry)throw new Error('Group history order changed while its receipt was pending.');try{this.w.ownedHistoryReconciled?.('move',entry.recoveryHistoryRecord??={direction,entry});}catch(error){entry.status='applied-unverified';throw error;}from.pop();to.push(entry);entry.applied=direction==='undo'?'undone':'move';}
    entry.status=entry.applied==='undone'?'undone':'applied';delete entry.recoveredDirection;this.pending.delete(id);
   }
   if(verified){this.w.selection=clone(entry.applied==='undone'?entry.beforeSelection:entry.afterSelection);this.w.paintSelection?.();}return entry;});
 }
 previewClip(clip) {
  const active=this.active,after=active?.plan?.after.find(item=>item.id===(clip.cloudId||clip.id));
  return after?{...clip,start:after.start_ms/1000*active.prepared.bpm/60}:clip;
 }
 canBegin(event,lane,track,{clip}={}) {
  try {
   this.w.assertOwnedEditsSettled?.();this.available();this.idle();
   if(this.active||this.uncertain()||this.unverified())throw new Error('Reconcile the retained group receipt before starting another move.');
   if(!lane||!track?.laneId||!this.w.tracks.some(row=>row.laneId===track.laneId&&row.index===track.index))throw new Error('The captured audio lane is no longer present.');
   if(this.w.syncLocked===true||this.w.getProject().syncLocked===true)throw new Error('Sync-lock group movement needs a canonical engine model.');
   const selected=!event.shiftKey&&this.w.selectedTracks.has(track.index)&&this.w.xToTime(event.clientX-lane.getBoundingClientRect().left)>=this.w.selection.start&&this.w.xToTime(event.clientX-lane.getBoundingClientRect().left)<this.w.selection.end;
   const rows=selected?this.w.tracks.filter(row=>this.w.selectedTracks.has(row.index)):[track];
   if(rows.some(row=>row.clips.some(item=>item.patternId)||['instrument','pattern','midi'].includes(row.channel?.type)))throw new Error('Pattern or mixed lanes cannot be moved by the audio batch contract.');
   if(!event.shiftKey&&!clip)throw new Error('Click a unique canonical audio clip before moving the selection.');
   return {allowed:true};
  }catch(error){return {allowed:false,reason:error.message};}
 }
 begin(event,lane,track,{clip}={}) {
  if(event.button!==0||this.active)return false;
  const availability=this.canBegin(event,lane,track,{clip});if(!availability.allowed){event.preventDefault();event.stopPropagation();this.w.onError?.(new Error(availability.reason));return true;}
  event.preventDefault();event.stopPropagation();
  const w=this.w,doc=w.root.ownerDocument,context=this.context(),state=this.active={pointer:event.pointerId,lane,track,doc,context,startX:event.clientX,startLeftSec:w.leftSec,scale:w.scale,tool:w.tool,last:event,selection:clone(w.selection),selectedTracks:[...w.selectedTracks],interacting:w.engine.interacting,prepared:null,plan:null,error:null,released:false};
  w.engine.interacting=true;
  state.move=e=>{if(e.pointerId===state.pointer&&this.active===state){state.last=e;this.updatePreview(state);}};
  state.finish=e=>{if(e.pointerId===state.pointer)this.finish(e);};state.cancel=e=>{if(e.pointerId===undefined||e.pointerId===state.pointer)this.cancel();};state.blur=()=>this.cancel();
  doc.addEventListener('pointermove',state.move,true);doc.addEventListener('pointerup',state.finish,true);doc.addEventListener('pointercancel',state.cancel,true);doc.defaultView.addEventListener('blur',state.blur);
  const clickSec=w.xToTime(event.clientX-lane.getBoundingClientRect().left);
  state.preparation=this.capture({track,clip,clickSec,shift:event.shiftKey,selection:state.selection,selectedTracks:state.selectedTracks}).then(prepared=>{if(this.active!==state)throw abort();state.prepared=prepared;this.updatePreview(state);return prepared;});
  state.preparation.catch(error=>{if(this.active===state){state.error=error;this.w.onError?.(error);this.cancel();}});
  return true;
 }
 valid(state) { try{this.assertContext(state.context);return state.scale===this.w.scale&&state.tool===this.w.tool&&(!state.prepared||localBinding(this.w)===state.prepared.binding);}catch{return false;} }
 updatePreview(state) {
  if(this.active!==state||!state.prepared)return;
  if(!this.valid(state)){this.cancel();return;}
  try{
   const rows=[...this.w.root.querySelectorAll('.au-track')],over=rows.find(row=>{const r=row.getBoundingClientRect();return state.last.clientY>=r.top&&state.last.clientY<r.bottom;}),target=over&&this.w.tracks.find(row=>String(row.index)===over.dataset.track);
   const destination=state.prepared.native.mode==='track'?state.prepared.native.capturedLaneId:target?.laneId??state.prepared.native.capturedLaneId;
   state.plan=planCloudGroupMove(state.prepared.native,{deltaSec:(state.last.clientX-state.startX)/state.scale+this.w.leftSec-state.startLeftSec,pixelsPerSecond:state.scale,leftSec:this.w.leftSec,destinationLaneId:destination});state.error=null;
   if(state.plan.movingSelection)this.w.selection=clone(state.plan.selection);
  }catch(error){state.plan=null;state.error=error;this.w.selection=clone(state.selection);}
  this.w.renderWindow?.();this.w.paintSelection?.();this.w.paintCursors?.();
 }
 detach(state) { state.doc.removeEventListener('pointermove',state.move,true);state.doc.removeEventListener('pointerup',state.finish,true);state.doc.removeEventListener('pointercancel',state.cancel,true);state.doc.defaultView.removeEventListener('blur',state.blur); }
 clear(state) { this.detach(state);if(this.active===state)this.active=null;this.w.engine.interacting=state.interacting; }
 async finish(event) {
  const state=this.active;if(!state||state.released||event.pointerId!==state.pointer)return;state.released=true;state.last=event;this.detach(state);
  try{
   await state.preparation;if(this.active!==state)return;this.updatePreview(state);if(this.active!==state)return;
   if(!this.valid(state)||state.error||!state.plan)throw state.error??abort();
   const prepared=state.prepared,plan=state.plan;this.clear(state);
   if(!plan.noOp){const result=await this.onCommit(()=>this.apply(prepared,plan));if(result.status!=='applied'&&idOf(this.w)===state.context.projectId)this.w.selection=clone(state.selection);}
  }catch(error){if(idOf(this.w)===state.context.projectId)this.w.selection=clone(state.selection);if(error.name!=='AbortError')this.w.onError?.(error);}finally{if(this.active===state)this.clear(state);this.w.renderWindow?.();this.w.paintSelection?.();this.w.paintCursors?.();this.w.finishDeferredRender?.();}
 }
 cancel(repaint=true) {const state=this.active;if(!state)return;this.clear(state);if(idOf(this.w)===state.context.projectId)this.w.selection=clone(state.selection);if(repaint){this.w.renderWindow?.();this.w.paintSelection?.();this.w.paintCursors?.();this.w.finishDeferredRender?.();}}
 deferRender(){if(!this.active)return false;if(!this.valid(this.active)){this.cancel(false);return false;}this.w.deferredRender=true;return true;}
}
