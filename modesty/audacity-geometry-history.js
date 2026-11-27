import {definiteCloudRejection,retainInProgress,isIdempotencyInProgress,captureWriteRequest,replayKnownBusyWrite} from './cloud-errors.js';
import {importHistoryStateKey} from './audacity-import-history.js';
import {audioAttachArguments} from './cloud-audio-import.js';
import {assertCompleteCanonicalData,normalizeCloudProject} from './cloud-session.js';
import {warnEngineOrphans,engineNeedsReconcile,requestEngineReconcile,pendingEngineReconcile,callWithEngineRetry} from './audacity-edit-queue.js';
import {createFreestyleRangeAdapters,unwrapRangeEditResult,batchPostCommitError} from './audacity-range-edit.js';
const clone=v=>structuredClone(v),stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const key=v=>JSON.stringify(stable(v));
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
const sourceKey=v=>key(Object.fromEntries(Object.entries(v).filter(([k])=>!['startMs','durationSec','audioOffsetSec','createdAt','updatedAt','created_at','updated_at'].includes(k))));
const timing=c=>({start_ms:c.startMs,duration_sec:c.durationSec,audio_offset_sec:c.audioOffsetSec});
const geometryKey=state=>importHistoryStateKey({...state,envelopes:[]});
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-7;
function geometryModel(p){const n=clone(p);delete n.cloud;delete n.selectedPattern;for(const c of n.audioClips??[]){delete c.cloudRaw;delete c.cloudRuntime;for(const k of ['start','length','offset','engineLoaded','engineTrackId','engineClipId','engineState','cloudTrackIndex'])delete c[k];}return n;}
const moveLane=lane=>lane&&['audio','vocal'].includes(lane.kind)&&!['pattern','instrument','midi','backing'].includes(lane.trackType)&&lane.id!=='backing'&&!lane.id.startsWith('backing:');
const nativeInventory=(state,projectId)=>{
 if(state?.session?.projectId!==projectId||state.projectId!==undefined&&state.projectId!==projectId||state.transport?.is_playing!==false)throw new Error('Read the stopped original native project before moving its audio.');
 const containers=[state.tracks,state.clips];for(const container of containers)assertCompleteCanonicalData(container,'native clip move');
 const tracks=Array.isArray(state.tracks)?state.tracks:state.tracks?.tracks,clips=Array.isArray(state.clips)?state.clips:state.clips?.clips;
 if(!Array.isArray(tracks)||!Array.isArray(clips))throw new Error('Complete native tracks and clips are required for a cross-track move.');
 for(const row of [...tracks,...clips])for(const field of ['projectId','project_id'])if(row[field]!==undefined&&row[field]!==projectId)throw new Error('The native move inventory contains foreign project membership.');
 if(tracks.some(row=>!Number.isSafeInteger(row.id)||row.id<0)||clips.some(row=>!Number.isSafeInteger(row.clip_id)||row.clip_id<0||!Number.isSafeInteger(row.mozart_track_id)||!tracks.some(track=>track.id===row.mozart_track_id&&track.db_track_id===row.db_track_id)))throw new Error('The native move inventory has incomplete clip/track crosslinks.');
 if(new Set(tracks.map(row=>row.id)).size!==tracks.length||new Set(clips.map(row=>row.clip_id)).size!==clips.length||new Set(clips.map(row=>row.db_clip_id).filter(Boolean)).size!==clips.filter(row=>row.db_clip_id).length)throw new Error('The native move inventory has duplicate clip or track identities.');
 return {tracks,clips};
};
const nativeSource=(state,clip,projectId)=>{
 const {tracks,clips}=nativeInventory(state,projectId);
 const matches=clips.filter(row=>row.db_clip_id===clip.id),trackMatches=tracks.filter(row=>row.db_track_id===clip.laneId),native=matches[0],track=trackMatches[0];
 if(matches.length!==1||trackMatches.length!==1||!Number.isSafeInteger(native?.clip_id)||native.clip_id<0||!Number.isSafeInteger(native?.mozart_track_id)||native.mozart_track_id<0||!Number.isSafeInteger(track?.id)||native.mozart_track_id!==track.id||native.db_track_id!==clip.laneId||clips.filter(row=>row.clip_id===native.clip_id).length!==1||tracks.filter(row=>row.id===track.id).length!==1)throw new Error('The moved audio lacks unique native clip, track and durable lane links.');
 if(!close(native.start_ms,clip.startMs)||!close(native.clip_duration_sec,clip.durationSec)||!close(native.audio_offset_sec,clip.audioOffsetSec))throw new Error('The audio source window has not reached its current native lane and timeline position.');
 if(native.library_file_ready!==true||native.library_file_set!==true||native.library_file_sr!==48000||![1,2].includes(native.library_file_channels)||typeof native.s3_key_or_path!=='string'||!native.s3_key_or_path||!Number.isFinite(native.file_duration_sec)||native.file_duration_sec<=0||clip.audioOffsetSec+clip.durationSec>native.file_duration_sec+1e-7)throw new Error('The moved audio needs a ready 48 kHz mono/stereo native source with its actual source identity.');
 return {uri:native.s3_key_or_path,durationSec:native.file_duration_sec,sampleRate:native.library_file_sr,channels:native.library_file_channels};
};
const terminalMove=payload=>payload&&typeof payload==='object'&&!isIdempotencyInProgress(payload)&&!['queued','pending','running','processing','accepted','in_progress'].includes(String(payload.status??payload.state??'').toLowerCase())&&payload.moved!==false&&payload.ok!==false&&typeof payload.engine_moved==='boolean'&&typeof payload.engine_reload_required==='boolean'&&payload.clip&&payload.undo;
/** Exact local inverse history for header moves and source-window trims.
 * Horizontal/trim edits use guarded batches; one imported cross-lane move uses
 * its dedicated typed endpoint. Generic native/AI Undo is never used.
 * Unknown receipts are retained and never retried automatically. */
export class AudacityGeometryHistory{
 constructor(w){this.w=w;this.past=new Map();this.future=new Map();this.pending=new Map();this.receipts=new Map();this.active=false;this.adapters=createFreestyleRangeAdapters({cloudCall:(name,args)=>{const record=this.dispatchRecord;if(record&&typeof record.ifMatch==='string'&&record.ifMatch)args={...args,if_match:record.ifMatch};if(!record)throw new Error('The geometry request has no captured owner.');if(!record.request)Object.defineProperty(record,'request',{value:freeze({name,arguments:clone(args)}),enumerable:true});else if(record.request.name!==name||key(record.request.arguments)!==key(args))throw new Error('The original geometry request changed. Its retained key will not be reused for a different intent.');return callWithEngineRetry(w,(n,a)=>w.engine.session.call(n,a),record.request.name,clone(record.request.arguments));},getTrackId:()=>w.engine.session.trackId});this.known=new Map();this.nativeSources=new Map();this.verifier={timer:null,generation:0,running:null};this.verifyIdleMs=600;this.warnings=[];}
 context(){return this.w.clipboard.context();}
 /* The Freestyle Studio trusts the write ACK. The last acknowledged canonical state (chained
  * by the ACK's timeline revision) is the next edit's baseline; any foreign
  * refresh that moves the session revision invalidates it, forcing one read. */
 async baseline(c){
  const known=this.known.get(c.projectId),revision=this.w.engine.session?.rawProject?.timelineRevision;
  if(known&&known.contextKey===key(c)&&typeof revision==='string'&&revision===known.state.project.timelineRevision)return clone(known.state);
  const state=await this.w.clipboard.read(c);this.assertContext(c);return state;
 }
 /** Show a canonical geometry state locally at once (≤ one render). */
 applyLocal(c,state,ids,{keepRevision=false}={}){
  try{
   const session=this.w.engine.session;if(!session||session.projectId!==c.projectId||!session.rawProject)return;const raw=clone(session.rawProject);if(!keepRevision&&typeof state.project.timelineRevision==='string')raw.timelineRevision=state.project.timelineRevision;
   for(const id of ids){const wanted=state.project.clips.find(row=>row.id===id),index=raw.clips.findIndex(row=>row.id===id);if(wanted&&index>=0)raw.clips[index]={...raw.clips[index],laneId:wanted.laneId,startMs:wanted.startMs,durationSec:wanted.durationSec,audioOffsetSec:wanted.audioOffsetSec};else if(wanted)raw.clips.push(clone(wanted));else if(index>=0)raw.clips.splice(index,1);}
   if(raw.counts&&Object.hasOwn(raw.counts,'clips'))raw.counts.clips=raw.clips.length;session.rawProject=raw;session.project=normalizeCloudProject(raw,session.rawState,{projectId:c.projectId,trackId:session.trackId});
   if(!this.w.engine.applying)this.w.engine.accept?.(session.project);
  }catch(error){(this.localErrors??=[]).push(error.message);}
 }
 warn(message){this.warnings.push(message);this.w.engine.onStatus?.(message);this.w.onWarning?.(message);}
 /** ACK = committed: local state, next-edit baseline, unlock; verify later. */
 acknowledge(record){
  const {entry,direction}=record,c=entry.context,target=direction==='undo'?entry.before:entry.after,payload=record.receipt?.payload??record.receipt;
  if(entry.kind==='lane-move')this.validateMove(record,payload);
  if(engineNeedsReconcile(payload)||batchPostCommitError(payload))requestEngineReconcile(this.w,{reason:'geometry'});/* committed; resync the engine once, never re-send */
  if(entry.kind!=='lane-move'&&payload?.applied===false||isIdempotencyInProgress(payload))throw Object.assign(new Error('The geometry write has no terminal applied receipt.'),{code:'idempotency_in_progress'});
  const revision=payload?.timelineRevision??payload?.timeline_revision,state=clone(target);state.project.timelineRevision=typeof revision==='string'&&revision?revision:null;
  {const inverse=payload?.undo?.inverse_ops;if(entry.kind!=='lane-move'&&Array.isArray(inverse)&&inverse.length){const guarded=inverse.map(op=>{if(op.expected||!['update','remove'].includes(op.op))return clone(op);const after=state.project.clips.find(row=>row.id===op.id);return after?{...clone(op),expected:timing(after)}:clone(op);});if(direction==='undo')entry.redoOps=guarded;else entry.undoOps=guarded;}}/* prefer the server-computed inverse (328) */
  record.status='acknowledged';record.acknowledgedAt=Date.now();if(this.pending.get(c.projectId)===record)this.pending.delete(c.projectId);
  if(state.project.timelineRevision)this.known.set(c.projectId,{contextKey:key(c),state});else this.known.delete(c.projectId);
  this.applyLocal(c,state,entry.ids);this.scheduleVerify(record);return record;
 }
 /** Background verifier: runs after idle, coalesces to the newest ACK and is
  * superseded by newer edits. A mismatch warns and adopts server truth. */
 scheduleVerify(record){const v=this.verifier;v.generation++;v.record=record;clearTimeout(v.timer);const generation=v.generation;v.timer=setTimeout(()=>{v.timer=null;this.runVerify(record,generation);},this.verifyIdleMs);}
 cancelVerify(){const v=this.verifier;v.generation++;clearTimeout(v.timer);v.timer=null;}
 busyForVerify(){const w=this.w;return this.active||w.busy||w.engine.applying||w.engine.interacting||!!w.clipGesture||w.engine.pending!=null;}
 async runVerify(record,generation){
  const v=this.verifier;if(generation!==v.generation)return;if(this.busyForVerify()){v.timer=setTimeout(()=>{v.timer=null;this.runVerify(record,generation);},this.verifyIdleMs);return;}
  const c=record.entry.context;v.running=generation;await pendingEngineReconcile(this.w);
  try{await this.verify(record);if(generation!==v.generation)return;{const lanes=new Set();for(const state of [record.entry.before,record.entry.after])for(const clip of state?.project?.clips??[])if(record.entry.ids.includes(clip.id))lanes.add(clip.laneId);record.engineOrphans=warnEngineOrphans(this.w,this.w.engine.session,[...lanes],message=>this.warn(message));}if(record.readback?.project?.timelineRevision)this.known.set(c.projectId,{contextKey:key(c),state:clone(record.readback)});}
  catch(error){if(generation!==v.generation)return;
   // A failed READ is not evidence of a wrong edit: retry with backoff, never re-write.
   if(error?.status!==undefined||typeof error?.code==='string'){record.verifyAttempts=(record.verifyAttempts||0)+1;if(record.verifyAttempts<3){v.timer=setTimeout(()=>{v.timer=null;this.runVerify(record,generation);},this.verifyIdleMs*(record.verifyAttempts+1));return;}record.status='verify-pending';this.warn('Saved, but Freestyle could not be read to confirm the last audio edit ('+error.message+'). It will be checked again after the next edit.');return;}
   record.status='verify-mismatch';record.verifyError=error.message;this.known.delete(c.projectId);this.warn('Freestyle differs from the last audio edit ('+error.message+') — showing the saved server state.');try{await this.w.engine.session.refresh();if(generation===v.generation)this.w.engine.accept?.(this.w.engine.session.project);}catch(refreshError){this.warn('Reload the project: '+refreshError.message);}}
  finally{if(v.running===generation)v.running=null;}
 }
 whenVerified(){const v=this.verifier;return new Promise(resolve=>{const poll=()=>v.timer||v.running!=null?setTimeout(poll,5):resolve();poll();});}
 scheduleRecovery(record){setTimeout(()=>{if(this.pending.get(record.entry.context.projectId)!==record||record.status!=='uncertain')return;this.reconcile().then(()=>this.warn('The interrupted audio edit was confirmed from its retained request.'),error=>this.warn('The audio edit outcome is still unknown: '+error.message+' Use Verify before further edits.'));},this.verifyIdleMs);}
 nativeSourceFor(c,clip){try{const signature=nativeSource(this.w.engine.session.rawState,clip,c.projectId);this.nativeSources.set(clip.id,signature);return signature;}catch(error){const retained=this.nativeSources.get(clip.id);if(retained)return retained;throw error;}}
 assertContext(c){this.w.clipboard.assertContext(c);}
 stack(map,id=this.context().projectId){if(!map.has(id))map.set(id,[]);return map.get(id);}
 clearFuture(id){this.stack(this.future,id).length=0;}
 uncertain(id=this.context().projectId){return this.pending.get(id)?.status==='uncertain';}
 /** An in-flight ('sending') write is not unverified: later edits queue behind it via the engine chain. */
 unverified(id=this.context().projectId){const record=this.pending.get(id);return !!record&&!['uncertain','sending'].includes(record.status);}
 handles(before,after){return (before.audioClips??[]).some(c=>{const n=after.audioClips?.find(v=>v.id===c.id);return n&&['start','length','offset','track','laneId'].some(k=>n[k]!==c[k]);});}
 async commit(before,after){
  const c=this.context();this.assertContext(c);this.w.assertOwnedEditsSettled?.({except:'geometry'});
  if(this.active||this.pending.has(c.projectId))throw new Error('Verify the pending clip geometry receipt before another edit.');
  const old=before.audioClips??[],next=after.audioClips??[];
  const routing=old.filter(o=>{const n=next.find(row=>row.id===o.id);return n&&(n.track!==o.track||n.laneId!==o.laneId);});if(routing.length)return this.commitMove(before,after,routing,c);
  if(key(geometryModel(before))!==key(geometryModel(after)))throw new Error('Finish the clip move or trim separately from other project edits. Cross-track moves require the dedicated Studio route.');
  if(!Number.isFinite(before.bpm)||before.bpm<=0)throw new Error('A valid project tempo is required for audio geometry.');
  const changes=old.map(o=>({old:o,next:next.find(n=>n.id===o.id)})).filter(({old:o,next:n})=>n&&['start','length','offset'].some(k=>n[k]!==o[k]));
  if(!changes.length)return false;
  const initial=await this.baseline(c);const target=clone(initial),ops=[];
  for(const {old:o,next:n}of changes){
   const id=o.cloudId||o.id,row=initial.project.clips.find(v=>v.id===id);
   if(!row||o.offsetKnown!==true||o.laneId!==row.laneId||!close(row.startMs,o.start*60000/before.bpm)||!close(row.durationSec,o.length*60/before.bpm)||!close(row.audioOffsetSec,o.offset*60/before.bpm))throw new Error('The clip source, lane or timing changed. Refresh before moving or trimming it.');
   if(o.cloudRaw&&sourceKey(o.cloudRaw)!==sourceKey(row))throw new Error('The clip source or metadata changed during the gesture. Refresh before editing.');
   const t={start_ms:n.start*60000/before.bpm,duration_sec:n.length*60/before.bpm,audio_offset_sec:n.offset*60/before.bpm};
   if(!Object.values(t).every(Number.isFinite)||t.start_ms<0||t.duration_sec<=0||t.audio_offset_sec<0)throw new Error('Choose a valid nonnegative audio source window.');
   ops.push({op:'update',id,...t,expected:timing(row)});Object.assign(target.project.clips.find(v=>v.id===id),{startMs:t.start_ms,durationSec:t.duration_sec,audioOffsetSec:t.audio_offset_sec});
  }
  const entry={context:clone(c),before:initial,after:target,ids:ops.map(o=>o.id)},record={direction:'edit',entry,operations:ops,ifMatch:initial.project.timelineRevision,status:'prepared',idempotencyKey:crypto.randomUUID()};
  await this.execute(record);this.stack(this.past,c.projectId).push(entry);this.w.recordOwnedHistory?.('geometry',c.projectId);return true;
 }
 /** One Undo step for a file dropped onto an existing audio lane at its drop
  * time (upload into that lane + placement, verified by the import pipeline).
  * Undo removes exactly that owned clip with guarded timing; Redo restores it
  * and attaches it once only if the native engine lacks it. */
 registerDropImport({context,before,after,clipId,nativeDeferred=false}){
  this.assertContext(context);this.w.assertOwnedEditsSettled?.({except:'geometry'});if(this.active||this.pending.has(context.projectId))throw new Error('Verify the pending clip geometry receipt before another edit.');
  const added=after.project.clips.filter(row=>!before.project.clips.some(old=>old.id===row.id));if(added.length!==1||added[0].id!==clipId||before.project.clips.length+1!==after.project.clips.length)throw new Error('The dropped audio must add exactly one owned clip.');
  const comparison=clone(after);comparison.project.clips=comparison.project.clips.filter(row=>row.id!==clipId);comparison.envelopes=(comparison.envelopes??[]).filter(row=>(row.clipId??row.clip_id)!==clipId);if(comparison.project.counts&&Object.hasOwn(comparison.project.counts,'clips'))comparison.project.counts.clips=comparison.project.clips.length;
  if(importHistoryStateKey(comparison)!==importHistoryStateKey(before))throw new Error('Other tracks changed during the audio drop. It was saved but has no Undo entry.');
  const clip=added[0],native=nativeDeferred?null:this.nativeSourceFor(context,clip);
  const entry={kind:'drop-import',context:clone(context),before:clone(before),after:clone(after),ids:[clipId],nativeSource:native?freeze(native):null};this.stack(this.past,context.projectId).push(entry);this.w.recordOwnedHistory?.('geometry',context.projectId);return entry;
 }
 /** The background attach of a dropped clip reports its now-live native source. */
 adoptDropNative(clipId){const c=this.context(),entry=[...this.stack(this.past,c.projectId),...this.stack(this.future,c.projectId)].find(row=>row.kind==='drop-import'&&row.ids[0]===clipId);if(!entry||entry.nativeSource)return;const clip=entry.after.project.clips.find(row=>row.id===clipId);try{entry.nativeSource=freeze(this.nativeSourceFor(c,clip));}catch{}}
 async ensureDropNative(record,target){
  const {entry}=record,c=entry.context,id=entry.ids[0],clip=target.project.clips.find(row=>row.id===id);let inventory=nativeInventory(this.w.engine.session.rawState,c.projectId),matches=inventory.clips.filter(row=>row.db_clip_id===id);
  if(!clip){if(matches.length)throw new Error('The removed dropped audio is still loaded in the native engine.');return;}
  if(!matches.length){
   if(record.hydration)throw new Error('The dropped audio attachment has not reached the native engine. Verify its retained receipt without attaching twice.');
   const capability=await this.w.engine.session.call('list_pro_capabilities',{action:'attach_clip_to_session'});this.assertContext(c);const args=audioAttachArguments(capability,{projectId:c.projectId,clip,laneId:clip.laneId});
   const attachment=record.hydration={request:captureWriteRequest('execute_pro_action',{project_id:c.projectId,track_id:c.trackId,action:'attach_clip_to_session',arguments:args}),status:'sending'};
   try{const raw=await this.w.engine.session.call(attachment.request.name,clone(attachment.request.arguments));attachment.receipt=clone(this.parseAttachment(raw));attachment.status='acknowledged';}
   catch(error){attachment.error=error.message;retainInProgress(attachment,error);attachment.status=Number(error.status)===409&&!attachment.idempotencyInProgress?'conflict':'uncertain';if(attachment.status!=='conflict')throw error;}
   await this.moveReadback(record,target);inventory=nativeInventory(this.w.engine.session.rawState,c.projectId);matches=inventory.clips.filter(row=>row.db_clip_id===id);if(!matches.length)throw new Error('The restored dropped audio has not reached the native engine.');
  }
  const signature=nativeSource(this.w.engine.session.rawState,clip,c.projectId);if(!entry.nativeSource){entry.nativeSource=freeze(clone(signature));this.nativeSources.set(clip.id,signature);}else if(key(signature)!==key(entry.nativeSource))throw new Error('The restored dropped audio has a different native source.');
 }
 async prepareMove(context,state,clipId,destinationId,expectedSource){
  this.assertContext(context);const source=state.project.clips.find(row=>row.id===clipId),destination=state.project.lanes.find(row=>row.id===destinationId),origin=state.project.lanes.find(row=>row.id===source?.laneId);
  if(!source||source.isImported!==true||!moveLane(origin)||!moveLane(destination))throw new Error('Cross-track moves currently require one imported clip and ordinary canonical audio lanes.');
  if(!Number.isSafeInteger(source.startMs)||source.startMs<0)throw new Error('The original clip start cannot be represented by the move endpoint’s integer-millisecond inverse.');
  const fresh=state;// baseline: last ACKed state or one canonical read; the MOVE's If-Match/expected guard the server
  if(typeof fresh.project.timelineRevision!=='string'||!fresh.project.timelineRevision)throw new Error('Read the current timeline revision before moving audio between tracks.');
  const signature=this.nativeSourceFor(context,source);if(expectedSource&&key(signature)!==key(expectedSource))throw new Error('The imported native audio source changed since its owned move.');
  for(const take of fresh.project.clips.filter(row=>row.laneId===destinationId&&row.id!==clipId)){const targetSource=this.nativeSourceFor(context,take);if(targetSource.channels!==signature.channels)throw new Error('The destination audio has an incompatible native channel count.');}
  return {state:fresh,source:signature};
 }
 async commitMove(before,after,routing,context){
  if(this.w.crossTrackPasteSupported!==true)throw new Error('Cross-track audio moves require the verified dedicated Studio move route.');
  const changed=before.audioClips.filter(o=>{const n=after.audioClips.find(row=>row.id===o.id);return n&&['start','length','offset','track','laneId'].some(field=>o[field]!==n[field]);});
  if(routing.length!==1||changed.length!==1)throw new Error('Move one audio clip between tracks; vertical group moves need an atomic engine operation.');
  const old=routing[0],next=after.audioClips.find(row=>row.id===old.id),comparison=clone(after),comparable=comparison.audioClips.find(row=>row.id===old.id);Object.assign(comparable,{track:old.track,laneId:old.laneId});
  if(key(geometryModel(before))!==key(geometryModel(comparison))||next.length!==old.length||next.offset!==old.offset)throw new Error('Finish the cross-track move separately from trims, gain or other edits.');
  if(!Number.isFinite(before.bpm)||before.bpm<=0||!Number.isFinite(next.start)||next.start<0||old.offsetKnown!==true)throw new Error('A known source window and finite timeline position are required for cross-track movement.');
  const initial=await this.baseline(context);const row=initial.project.clips.find(clip=>clip.id===(old.cloudId||old.id));
  if(!row||row.laneId!==old.laneId||old.cloudRaw&&sourceKey(old.cloudRaw)!==sourceKey(row)||!close(row.startMs,old.start*60000/before.bpm)||!close(row.durationSec,old.length*60/before.bpm)||!close(row.audioOffsetSec,old.offset*60/before.bpm))throw new Error('The imported clip source or geometry changed during the cross-track gesture.');
  const laneIds=before.cloud?.timelineLaneIds;if(!Number.isSafeInteger(next.track)||next.track<0||!Array.isArray(laneIds)||laneIds[next.track]!==next.laneId||next.laneId===old.laneId)throw new Error('Choose one existing canonical destination audio row.');
  const startMs=Math.round(next.start*60000/before.bpm);if(!Number.isSafeInteger(startMs)||startMs<0)throw new Error('Choose a supported nonnegative integer-millisecond move position.');
  const prepared=await this.prepareMove(context,initial,row.id,next.laneId),target=clone(prepared.state),targetClip=target.project.clips.find(clip=>clip.id===row.id);targetClip.laneId=next.laneId;targetClip.startMs=startMs;
  const entry={kind:'lane-move',context:clone(context),before:prepared.state,after:target,ids:[row.id],nativeSource:freeze(prepared.source)},record={direction:'edit',entry,move:{clipId:row.id,laneId:next.laneId,startMs,expectedLane:row.laneId,expectedStart:row.startMs},ifMatch:prepared.state.project.timelineRevision,status:'prepared',idempotencyKey:crypto.randomUUID()};
  await this.execute(record);this.stack(this.past,context.projectId).push(entry);this.w.recordOwnedHistory?.('geometry',context.projectId);return true;
 }
 validateMove(record,payload){
  if(payload?.inferredFromState===true)return;
  const m=record.move,target=(record.direction==='undo'?record.entry.before:record.entry.after).project.clips.find(row=>row.id===m.clipId),card=payload?.clip,inverse=payload?.undo;
  if(!terminalMove(payload)||payload.projectId!==record.entry.context.projectId||card?.id!==m.clipId||card.laneId!==m.laneId||!close(card.startMs,m.startMs)||sourceKey(card)!==sourceKey(target)||key(timing(card))!==key(timing(target))||inverse?.op!=='move'||inverse.clip_id!==m.clipId||inverse.lane_id!==m.expectedLane||inverse.start_ms!==m.expectedStart)throw new Error('The dedicated move receipt changed the imported clip source, name, window or exact inverse. Its receipt remains unverified.');
 }
 async dispatch(record){
  this.assertContext(record.entry.context);
  if(record.entry.kind==='lane-move'){
   const m=record.move,args={project_id:record.entry.context.projectId,track_id:record.entry.context.trackId,action:'move_clip_to_lane',arguments:{clip_id:m.clipId,lane_id:m.laneId,start_ms:m.startMs,expected:{lane_id:m.expectedLane,start_ms:m.expectedStart}},idempotency_key:record.idempotencyKey,if_match:record.ifMatch};
   if(!record.request)Object.defineProperty(record,'request',{value:freeze({name:'execute_pro_action',arguments:clone(args)}),enumerable:true});else if(record.request.name!=='execute_pro_action'||key(record.request.arguments)!==key(args))throw new Error('The original cross-track request changed. Its retained key will not describe a new intent.');
   const raw=await this.w.engine.session.call(record.request.name,clone(record.request.arguments)),payload=unwrapRangeEditResult(raw);
   if(isIdempotencyInProgress(payload)||['queued','pending','running','processing','accepted','in_progress'].includes(String(payload.status??payload.state??'').toLowerCase()))throw Object.assign(new Error('The original cross-track move is still running.'),{code:'idempotency_in_progress',result:raw});
   return {payload:clone(payload),sourceReceipt:clone(raw)};
  }
  this.dispatchRecord=record;
  try{return await this.adapters.sendBatch({projectId:record.entry.context.projectId,operations:record.operations,idempotencyKey:record.idempotencyKey});}finally{this.dispatchRecord=null;}
 }
 async execute(record){
  const {entry}=record,c=entry.context;this.assertContext(c);if(this.active)throw new Error('Wait for the current clip geometry edit.');this.active=true;record.operations=freeze(clone(record.operations));this.pending.set(c.projectId,record);this.stack(this.receipts,c.projectId).push(record);
  try{
   this.cancelVerify();if(record.direction!=='edit')this.applyLocal(c,record.direction==='undo'?entry.before:entry.after,entry.ids,{keepRevision:true});
   record.status='sending';const receipt=await this.dispatch(record);record.receipt=clone(receipt);record.status='applied-unverified';this.assertContext(c);
   // verifyInline=true runs the same verification synchronously (legacy proofs/tests).
   if(this.verifyInline===true){await this.verify(record);const revision=record.readback?.project?.timelineRevision;if(revision)this.known.set(c.projectId,{contextKey:key(c),state:clone(record.readback)});return record;}
   this.acknowledge(record);return record;
  }catch(error){if(record.status==='sending')retainInProgress(record,error);record.error=error.message;if(record.status==='sending')record.status=definiteCloudRejection(error)?'rejected':'uncertain';if(record.status==='rejected'){this.pending.delete(c.projectId);if(record.previous)this.applyLocal(c,record.previous,entry.ids,{keepRevision:true});}if(record.status==='uncertain')this.scheduleRecovery(record);throw error;}
  finally{this.active=false;}
 }
 parseAttachment(raw){
  const receipt=unwrapRangeEditResult(raw);
  if(isIdempotencyInProgress(receipt)||['accepted','queued','pending','running','processing','in_progress'].includes(String(receipt.status??receipt.state??'').toLowerCase()))throw Object.assign(new Error('The original move attachment is still running.'),{code:'idempotency_in_progress',result:raw});
  if(receipt.ok!==true&&receipt.attached!==true&&!(Number.isSafeInteger(receipt.clip_id)&&receipt.clip_id>=0&&Number.isSafeInteger(receipt.track_id)&&receipt.track_id>=0))throw new Error('The move attachment has no terminal success receipt.');return receipt;
 }
 async moveReadback(record,target){
  const c=record.entry.context;this.assertContext(c);await this.w.engine.session.refresh();this.assertContext(c);const actual=await this.w.clipboard.read(c);this.assertContext(c);record.readback=clone(actual);if(importHistoryStateKey(actual)!==importHistoryStateKey(target))throw new Error('The moved source, complete canonical metadata or envelopes changed during native attachment.');return actual;
 }
 async ensureMoveNative(record,target){
  const {entry}=record,c=entry.context,clip=target.project.clips.find(row=>row.id===entry.ids[0]);this.validateMove(record,record.receipt?.payload);
  let inventory=nativeInventory(this.w.engine.session.rawState,c.projectId),matches=inventory.clips.filter(row=>row.db_clip_id===clip.id),attachment=record.hydration;
  if(attachment&&['sending','uncertain','rejected'].includes(attachment.status))throw new Error('The original move attachment has no acknowledged outcome. Keep its retained request; another attachment will not be sent.');
  if(!matches.length){
   if(attachment)throw new Error('The acknowledged move attachment has not reached the native engine. Verify its retained receipt without attaching twice.');
   if(inventory.clips.some(row=>typeof row.db_clip_id!=='string'||!row.db_clip_id))throw new Error('Unresolved native clip identities cannot prove that the moved clip is absent.');
   const source=entry.nativeSource;if(!source||source.sampleRate!==48000||![1,2].includes(source.channels)||typeof source.uri!=='string'||!source.uri)throw new Error('The move has no retained ready native source baseline.');
   const capability=await this.w.engine.session.call('list_pro_capabilities',{action:'attach_clip_to_session'});this.assertContext(c);const args=audioAttachArguments(capability,{projectId:c.projectId,clip,laneId:clip.laneId});await this.moveReadback(record,target);
   inventory=nativeInventory(this.w.engine.session.rawState,c.projectId);matches=inventory.clips.filter(row=>row.db_clip_id===clip.id);
   if(matches.length){const signature=nativeSource(this.w.engine.session.rawState,clip,c.projectId);if(key(signature)!==key(source))throw new Error('The moved native source changed before attachment.');return;}
   if(inventory.clips.some(row=>typeof row.db_clip_id!=='string'||!row.db_clip_id))throw new Error('Unresolved native clip identities cannot authorize a move attachment.');
   attachment=record.hydration={request:captureWriteRequest('execute_pro_action',{project_id:c.projectId,track_id:c.trackId,action:'attach_clip_to_session',arguments:args}),status:'sending'};
   try{const raw=await this.w.engine.session.call(attachment.request.name,clone(attachment.request.arguments));attachment.raw=clone(raw);attachment.receipt=clone(this.parseAttachment(raw));attachment.status='acknowledged';this.assertContext(c);}
   catch(error){attachment.error=error.message;if(attachment.status!=='acknowledged'){if(error.result!==undefined)attachment.rejection=clone(error.result);attachment.httpStatus=error.status;retainInProgress(attachment,error);if(attachment.idempotencyInProgress)record.idempotencyInProgress=true;attachment.status=attachment.idempotencyInProgress?'uncertain':Number(error.status)===409?'conflict':definiteCloudRejection(error)?'rejected':'uncertain';if(attachment.status!=='conflict')throw error;}else throw error;}
   await this.moveReadback(record,target);
  }
  const signature=nativeSource(this.w.engine.session.rawState,clip,c.projectId);if(key(signature)!==key(entry.nativeSource))throw new Error('The moved native source URI, full source duration or channel format changed.');
  if(attachment?.status==='conflict'){attachment.status='already-loaded';attachment.nativeVerified=true;attachment.readback=clone(signature);}else if(attachment?.status==='acknowledged')attachment.nativeVerified=true;
 }
 async recoverMoveAttachment(record){
  const attachment=record.hydration,c=record.entry.context;if(!attachment||attachment.status!=='uncertain')return;
  const {raw,receipt}=await replayKnownBusyWrite({knownBusy:attachment.idempotencyInProgress===true,request:attachment.request,call:(name,args)=>this.w.engine.session.call(name,args),assertCurrent:()=>this.assertContext(c),parse:raw=>this.parseAttachment(raw)});
  attachment.raw=clone(raw);attachment.receipt=clone(receipt);attachment.status='acknowledged';attachment.idempotencyInProgress=false;record.idempotencyInProgress=false;record.status='applied-unverified';
 }
 async verify(record){
  const {entry,direction}=record,c=entry.context,target=direction==='undo'?entry.before:entry.after;this.assertContext(c);
  if(entry.kind==='lane-move')this.validateMove(record,record.receipt?.payload);
  await this.w.engine.session.refresh();this.assertContext(c);const actual=await this.w.clipboard.read(c);this.assertContext(c);record.readback=clone(actual);
  if(importHistoryStateKey(actual)!==importHistoryStateKey(target))throw new Error('The saved clip geometry, source metadata or automation differs from its complete checkpoint. Verify the retained receipt before further edits.');
  if(entry.kind==='lane-move')await this.ensureMoveNative(record,target);
  else if(entry.kind==='drop-import')await this.ensureDropNative(record,target);
  else if(record.receipt?.payload?.engine_reload_required===true){
   const native=this.w.engine.session.rawState,rows=Array.isArray(native?.clips)?native.clips:native?.clips?.clips;
   if(!Array.isArray(rows))throw new Error('The saved geometry needs a complete native engine readback.');
   for(const id of entry.ids){const targetClip=target.project.clips.find(v=>v.id===id),matches=rows.filter(v=>(v.db_clip_id??v.db_track_id??v.clipId)===id);if(matches.length!==1||!close(Number(matches[0].start_ms),targetClip.startMs)||!close(Number(matches[0].clip_duration_sec),targetClip.durationSec)||!close(Number(matches[0].audio_offset_sec),targetClip.audioOffsetSec))throw new Error('The saved audio geometry has not reached the live engine. Verify its retained receipt before playback.');}
  }
  record.status='verified';if(this.pending.get(c.projectId)===record)this.pending.delete(c.projectId);return record;
 }
 async history(direction){
  if(!['undo','redo'].includes(direction))throw new Error('Choose Undo or Redo.');const c=this.context();if(this.pending.has(c.projectId)||this.active)throw new Error('Verify the pending audio geometry edit before Undo or Redo.');
  const from=this.stack(direction==='undo'?this.past:this.future,c.projectId),to=this.stack(direction==='undo'?this.future:this.past,c.projectId),entry=from.at(-1);if(!entry)return false;this.assertContext(c);
  entry.context=clone(c);const current=await this.baseline(c),expected=direction==='undo'?entry.after:entry.before,target=direction==='undo'?entry.before:entry.after;this.assertContext(c);
  if(importHistoryStateKey(current)!==importHistoryStateKey(expected))throw new Error('The project changed since this clip edit. Undo newer edits before applying its inverse.');
  if(entry.kind==='lane-move'){
   if(this.w.crossTrackPasteSupported!==true)throw new Error('The dedicated cross-track move capability is unavailable.');const id=entry.ids[0],actual=current.project.clips.find(row=>row.id===id),desired=target.project.clips.find(row=>row.id===id),prepared=await this.prepareMove(c,current,id,desired.laneId,entry.nativeSource),record={direction,entry,previous:current,move:{clipId:id,laneId:desired.laneId,startMs:desired.startMs,expectedLane:actual.laneId,expectedStart:actual.startMs},ifMatch:prepared.state.project.timelineRevision,status:'prepared',idempotencyKey:crypto.randomUUID()};await this.execute(record);from.pop();to.push(entry);return true;
  }
  if(entry.kind==='drop-import'){const id=entry.ids[0],clip=entry.after.project.clips.find(row=>row.id===id),record={direction,entry,previous:current,operations:[direction==='undo'?{op:'remove',id,expected:timing(clip)}:{op:'restore',id,...timing(clip)}],ifMatch:current.project.timelineRevision,status:'prepared',idempotencyKey:crypto.randomUUID()};await this.execute(record);from.pop();to.push(entry);this.w.engine.onStatus?.((direction==='undo'?'Undid Import ':'Redid Import ')+(clip?.name||'audio'));return true;}
  const server=direction==='undo'?entry.undoOps:entry.redoOps,operations=Array.isArray(server)&&server.length?clone(server):entry.ids.map(id=>({op:'update',id,...timing(target.project.clips.find(v=>v.id===id)),expected:timing(current.project.clips.find(v=>v.id===id))})),record={direction,entry,previous:current,operations,ifMatch:current.project.timelineRevision,status:'prepared',idempotencyKey:crypto.randomUUID()};
  await this.execute(record);from.pop();to.push(entry);return true;
 }
 async reconcile(){
  const c=this.context(),record=this.pending.get(c.projectId);if(!record)return null;if(this.active)throw new Error('Wait for the current geometry verification.');this.assertContext(record.entry.context);this.active=true;
  try{
   if(record.entry.kind==='lane-move'&&record.hydration?.status==='uncertain')await this.recoverMoveAttachment(record);
   if(record.status==='uncertain'){
    if(!record.request)throw new Error('The geometry request has an unknown outcome and no retained intent; it will not be resent.');
    // Replay ONLY the retained intent: same key, body and original If-Match.
    // The server either returns the stored result or refuses (412) because the
    // timeline moved — then a read decides whether that original applied.
    try{
     const receipt=await this.dispatch(record),payload=receipt.payload,status=typeof payload?.status==='string'?payload.status:null;
     if(record.entry.kind==='lane-move'?!terminalMove(payload):isIdempotencyInProgress(payload)||['queued','pending','running','processing','accepted','in_progress'].includes(status)||payload?.applied===false||!(payload?.applied===true||payload?.ok===true||['done','complete','completed','succeeded','success'].includes(status)))throw Object.assign(new Error('The original geometry write has not returned a terminal success receipt. Its request and key are retained.'),{code:'idempotency_in_progress'});
     record.receipt=clone(receipt);record.idempotencyInProgress=false;record.status='applied-unverified';record.recoveryError=null;
    }catch(error){
     if(!(Number(error.status)===412||error.code==='timeline_revision_conflict'||error.code==='clip_changed')||record.idempotencyInProgress){retainInProgress(record,error);record.recoveryError=error.message;throw error;}
     await this.w.engine.session.refresh();this.assertContext(record.entry.context);const actual=await this.w.clipboard.read(record.entry.context),target=record.direction==='undo'?record.entry.before:record.entry.after;
     if(geometryKey(actual)!==geometryKey(target)){record.recoveryError='The retained request was refused and the saved timeline does not show it applied. Its outcome remains unknown.';throw Object.assign(new Error(record.recoveryError),{cause:error});}
     record.receipt={payload:{inferredFromState:true,replayConflict:{code:error.code??null,status:error.status??null},timelineRevision:actual.project.timelineRevision}};record.idempotencyInProgress=false;record.status='applied-unverified';record.recoveryError=null;
    }
   }
   const {entry,direction}=record;
   const from=direction==='edit'?null:this.stack(direction==='undo'?this.past:this.future,c.projectId),to=direction==='edit'?null:this.stack(direction==='undo'?this.future:this.past,c.projectId);
   if(from&&from.at(-1)!==entry)throw new Error('The geometry history changed during verification.');
   await this.verify(record);if(record.readback?.project?.timelineRevision)this.known.set(c.projectId,{contextKey:key(record.entry.context),state:clone(record.readback)});if(!this.w.engine.applying)this.w.engine.accept?.(this.w.engine.session.project);
   if(direction==='edit'){if(!this.stack(this.past,c.projectId).includes(entry)){this.stack(this.past,c.projectId).push(entry);this.w.recordOwnedHistory?.('geometry',c.projectId);}}
   else{from.pop();to.push(entry);this.w.ownedHistoryReconciled?.('geometry',record);}
   record.historySettled=true;return record;
  }finally{this.active=false;}
 }
}
