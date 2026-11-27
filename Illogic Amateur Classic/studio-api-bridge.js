/** Transitional UI names over the in-page Studio REST adapter (freestyle-host-transport.js); never an MCP fallback. */
import {clientLog} from './client-diagnostics.js';
import {hostFetch} from './freestyle-host-transport.js';
const etags=new Map();
const key=()=>globalThis.crypto?.randomUUID?.()||`studio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clipBatchBases=new Map();
export function clearStudioEtags(){etags.clear();clipBatchBases.clear();}
/** A clips:batch sent with If-Match = the cached read ETag commits exactly on
 * that base, so its response ETag is the next revision of the same snapshot.
 * A receipt projection may advance the cache to it, once, only while the cache
 * still holds the base the batch was sent against (no read moved it since). */
export function adoptClipBatchEtag(projectId,etag,{base}={}){
 const record=clipBatchBases.get(projectId);
 if(!record||typeof etag!=='string'||!etag||record.etag!==etag||!sameTimelineBase(record.base,base)||!sameTimelineBase(etags.get(projectId),base))return false;
 clipBatchBases.delete(projectId);etags.set(projectId,etag);return true;
}
/** QA round 19: a write sent on the cached revision returns the next one; the
 * cache must follow it or the next write of the same edit (shift then trim,
 * a placement batch then an audio batch) is a 412. Only a write whose base is
 * exactly the cached tag advances it; any other write (or a conflict) leaves it
 * for the next full read. Typed /api/studio writes report through here too. */
export function adoptStudioWrite(projectId,{base,etag}={}){
 if(typeof projectId!=='string'||!projectId||typeof base!=='string'||!base||typeof etag!=='string'||!etag||!etags.has(projectId)||!sameTimelineBase(etags.get(projectId),base))return false;
 etags.set(projectId,etag);clipBatchBases.delete(projectId);return true;
}
/** getProject's ETag is `"<timelineRevision>.<suffix>"`; timeline writes send (and Freestyle accepts) the bare
 * `"<timelineRevision>"` and answer with the next bare revision. Both name the same saved timeline, so a write sent on
 * the bare revision of the cached read is a write on the cached base: the cache follows it. Without this the cache
 * kept the read's tag after our own write and the next write of the same gesture (delete placement then delete
 * pattern; a nudge then Repeat) inherited a stale If-Match and was refused with 412 timeline_revision_conflict. */
export function timelineRevisionOf(tag){
 if(typeof tag!=='string')return null;const match=/^"([^".\r\n]+)(?:\.[^"\r\n]*)?"$/.exec(tag);return match?match[1]:null;
}
function sameTimelineBase(cached,base){if(typeof cached!=='string'||typeof base!=='string')return false;if(cached===base)return true;const a=timelineRevisionOf(cached),b=timelineRevisionOf(base);return !!a&&a===b&&!cached.startsWith('"mix-')&&!base.startsWith('"mix-');}
export function studioEtag(projectId){return etags.get(projectId)??null;}
const revisionTag=data=>{let value=data;for(let n=0;n<6&&value&&typeof value==='object';n++){const revision=value.timelineRevision??value._studioApi?.timelineRevision;if(typeof revision==='string'&&revision&&revision.length<=256&&!/[\r\n]/.test(revision))return JSON.stringify(revision);value=value.structuredContent??value.response;}return null;};
/** Clip batches are the only writes replayed after an UNKNOWN outcome: the
 * server returns the stored result for a reused Idempotency-Key (24 h). */
const CLIP_BATCH_REPLAY=new Set(['apply_clip_batch']);
function knownNotApplied(data){let value=data;for(let n=0;n<6&&value&&typeof value==='object';n++){if(value.applied===false||value.error?.applied===false)return true;value=value.structuredContent??value.response??value.error;}return false;}
/** Network loss, 408 or any 5xx that does not state applied:false. */
export function unknownOutcome(response,data){const status=response?.status;return !Number.isInteger(status)||status===408||status>=500&&!knownNotApplied(data);}
/** Live-mix writes compare If-Match with the mix revision ("mix-<n>"), not the
 * project ETag: they carry `expected_mix_revision` (or an explicit "mix-<n>")
 * and never inherit the cached project revision. */
export const MIX_REVISION_ACTIONS=Object.freeze(new Set(['set_track_gain','set_track_pan','set_track_muted','set_track_soloed','set_bus_gain','set_bus_muted','set_bus_soloed','set_master_gain','route_track_to_bus','apply_mix']));
export function mixRevisionCall(name,args){return name==='execute_pro_action'&&MIX_REVISION_ACTIONS.has(args?.action);}
/** Sample edits are guarded by the clip's source revision (If-Match or
 * expected_revision); the project ETag is a different value and makes Freestyle
 * answer 400 "If-Match and expected_revision disagree". Never inherit it. */
export const SOURCE_REVISION_CALLS=Object.freeze(new Set(['undo_clip_sample_edit','edit_clip_samples']));
/** Tempo / timing-map writes (setProjectTempo, setTimingMap, …) are guarded by the timing-map
 * revision (getTimingMap ETag, e.g. "0") or expected_revision. The project/timeline ETag is a
 * different value: Freestyle answers 400 invalid_argument "If-Match must be the integer
 * timing-map revision." Never inherit it; send only an explicit timing-map If-Match. */
export const TIMING_REVISION_ACTIONS=Object.freeze(new Set(['set_project_tempo','set_timing_map','undo_timing_map','undo_tempo_stretch']));
export function timingRevisionCall(name,args){return TIMING_REVISION_ACTIONS.has(name)||name==='execute_pro_action'&&TIMING_REVISION_ACTIONS.has(args?.action);}
export async function studioCompatibleRequest(name,args={},options={}){
 const projectId=args.project_id,inherit=!mixRevisionCall(name,args)&&!SOURCE_REVISION_CALLS.has(name)&&!timingRevisionCall(name,args)&&projectId&&etags.has(projectId),request={name,arguments:args,idempotencyKey:options.idempotencyKey||args.idempotency_key||args.arguments?.idempotency_key||key(),...(options.ifMatch!==undefined?{ifMatch:options.ifMatch}:inherit?{ifMatch:etags.get(projectId)}:{})};
 // Background reads (the engine's idle refresh) are marked so the proxy reads them
 // through its own slot pool, and carry an abort signal so a user read preempts them.
 if(options.priority==='background')request.priority='background';
 const post=async()=>{const response=await hostFetch('/api/call',{method:'POST',headers:{'Content-Type':'application/json'},body,...options.signal?{signal:options.signal}:{}});let data;try{data=await response.json();}catch(cause){if(!CLIP_BATCH_REPLAY.has(name))throw cause;throw Object.assign(new Error('Freestyle returned an unreadable response; the write outcome is unknown.'),{cause,status:response.status,operationUncertain:true});}return{response,data};};
 const body=JSON.stringify(request);let outcome,first;
 try{outcome=await post();}catch(error){if(!CLIP_BATCH_REPLAY.has(name))throw error;first={reason:'network',error};}
 if(!first&&CLIP_BATCH_REPLAY.has(name)&&unknownOutcome(outcome.response,outcome.data))first={reason:'status',status:outcome.response.status};
 if(first){
  // clips:batch replays its stored response for the same Idempotency-Key, even
  // past a stale If-Match. Send the identical body exactly once; never a third.
  clientLog('clip-batch-replay',{operation:name,reason:first.reason,status:first.status??null,idempotencyKey:request.idempotencyKey});
  try{outcome=await post();}catch(error){throw Object.assign(error,{operationUncertain:true,clipBatchReplayed:true,idempotencyKey:request.idempotencyKey});}
  clientLog('clip-batch-replay-result',{operation:name,status:outcome.response.status,replay:outcome.data?.replay??outcome.data?.structuredContent?.replay??null});
  request.replayedOnce=true;
 }
 const {response,data}=outcome;
 const metadata=data?.structuredContent?._studioApi??data?._studioApi,etag=response.headers?.get?.('etag')??metadata?.etag;
 // A conflict response can describe a newer revision, but it cannot authorize
 // replaying a gesture drawn on an older snapshot. Only full reads advance it.
 if(response.ok&&['get_project','get_pro_state'].includes(name)&&projectId&&typeof etag==='string'&&etag)etags.set(projectId,etag);
 if(name==='apply_clip_batch'&&projectId){
  const replayed=request.replayedOnce||data?.replay===true||data?.structuredContent?.replay===true;
  if(response.ok&&!replayed&&typeof request.ifMatch==='string'&&sameTimelineBase(etags.get(projectId),request.ifMatch)&&typeof etag==='string'&&etag)clipBatchBases.set(projectId,{base:request.ifMatch,etag});else clipBatchBases.delete(projectId);
 }
 // Every other successful timeline write on the cached base advances the cache to its returned revision.
 const replayedWrite=request.replayedOnce||data?.replay===true||data?.structuredContent?.replay===true;
 const action=name==='execute_pro_action'?String(args?.action||''):name,readOnly=/^(list|get|read|browse|search|preview|inspect|stop|start_stream|stop_stream)(_|$)/.test(action)||['preview_pattern','preview_pattern_sample','stop_all_pattern_previews'].includes(action);
 if(response.ok&&!replayedWrite&&!readOnly&&projectId&&!['get_project','get_pro_state','apply_clip_batch'].includes(name)&&!mixRevisionCall(name,args)&&!timingRevisionCall(name,args)&&typeof request.ifMatch==='string'){const next=revisionTag(data)??(typeof etag==='string'&&etag&&!etag.startsWith('"mix-')?etag:null);if(next&&next!==request.ifMatch)adoptStudioWrite(projectId,{base:request.ifMatch,etag:next});}
 return {response,data,request};
}
