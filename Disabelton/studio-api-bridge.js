/** Transitional UI names over the in-page Studio REST adapter (freestyle-host-transport.js); never an MCP fallback. */
import {clientLog} from './client-diagnostics.js';
import {hostFetch} from './freestyle-host-transport.js';
const etags=new Map();
const key=()=>globalThis.crypto?.randomUUID?.()||`studio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clipBatchBases=new Map();
export function clearStudioEtags(){etags.clear();clipBatchBases.clear();}
/** Release 2026-11-14: getProject's ETag is "<timelineRevision>.<content hash>"
 * (a title/key/scale change moves only the content part) while list pages,
 * write replies and every If-Match guard use "<timelineRevision>". The cache
 * holds the timeline tag so a meta-only change is never an outside edit and a
 * write base always compares like for like. Non-composite tags pass through. */
export function timelineEtag(tag){if(typeof tag!=='string')return tag;const match=/^(W\/)?"([^".]*)\.[^"]*"$/.exec(tag.trim());return match?`"${match[2]}"`:tag;}
/** A clips:batch sent with If-Match = the cached read ETag commits exactly on
 * that base, so its response ETag is the next revision of the same snapshot.
 * A receipt projection may advance the cache to it, once, only while the cache
 * still holds the base the batch was sent against (no read moved it since). */
export function adoptClipBatchEtag(projectId,etag,{base}={}){
 etag=timelineEtag(etag);base=timelineEtag(base);
 const record=clipBatchBases.get(projectId);
 if(!record||typeof etag!=='string'||!etag||record.etag!==etag||record.base!==base||etags.get(projectId)!==base)return false;
 clipBatchBases.delete(projectId);etags.set(projectId,etag);return true;
}
/** QA round 19: a write sent on the cached revision returns the next one; the
 * cache must follow it or the next write of the same edit (shift then trim,
 * a placement batch then an audio batch) is a 412. Only a write whose base is
 * exactly the cached tag advances it; any other write (or a conflict) leaves it
 * for the next full read. Typed /api/studio writes report through here too. */
export function adoptStudioWrite(projectId,{base,etag}={}){
 base=timelineEtag(base);etag=timelineEtag(etag);
 if(typeof projectId!=='string'||!projectId||typeof base!=='string'||!base||typeof etag!=='string'||!etag||!etags.has(projectId)||etags.get(projectId)!==base)return false;
 etags.set(projectId,etag);clipBatchBases.delete(projectId);return true;
}
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
/** Timing-map writes (tempo, timing map, undo) are guarded by the plain integer timing-map revision, not the project ETag
 * (live: PUT /tempo with the project ETag is 400 "If-Match must be the integer timing-map revision"). */
export const TIMING_REVISION_ACTIONS=Object.freeze(new Set(['set_project_tempo','set_timing_map','undo_timing_map']));
export function timingRevisionCall(name,args){return name==='execute_pro_action'&&TIMING_REVISION_ACTIONS.has(args?.action);}
export function timingIfMatch(name,args){const revision=timingRevisionCall(name,args)?args.arguments?.expected_revision:undefined;return Number.isInteger(revision)&&revision>=0?String(revision):undefined;}
/** Sample edits are guarded by the clip's source revision (If-Match or
 * expected_revision); the project ETag is a different value and makes Freestyle
 * answer 400 "If-Match and expected_revision disagree". Never inherit it. */
export const SOURCE_REVISION_CALLS=Object.freeze(new Set(['undo_clip_sample_edit','edit_clip_samples']));
export async function studioCompatibleRequest(name,args={},options={}){
 const projectId=args.project_id,inherit=!mixRevisionCall(name,args)&&!timingRevisionCall(name,args)&&!SOURCE_REVISION_CALLS.has(name)&&projectId&&etags.has(projectId),request={name,arguments:args,idempotencyKey:options.idempotencyKey||args.idempotency_key||args.arguments?.idempotency_key||key(),...(options.ifMatch!==undefined?{ifMatch:options.ifMatch}:timingIfMatch(name,args)!==undefined?{ifMatch:timingIfMatch(name,args)}:inherit?{ifMatch:etags.get(projectId)}:{})};
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
 const metadata=data?.structuredContent?._studioApi??data?._studioApi,etag=timelineEtag(response.headers?.get?.('etag')??metadata?.etag);
 // A conflict response can describe a newer revision, but it cannot authorize
 // replaying a gesture drawn on an older snapshot. Only full reads advance it.
 if(response.ok&&['get_project','get_pro_state'].includes(name)&&projectId&&typeof etag==='string'&&etag)etags.set(projectId,etag);
 if(name==='apply_clip_batch'&&projectId){
  const replayed=request.replayedOnce||data?.replay===true||data?.structuredContent?.replay===true;
  if(response.ok&&!replayed&&typeof request.ifMatch==='string'&&timelineEtag(request.ifMatch)===etags.get(projectId)&&typeof etag==='string'&&etag)clipBatchBases.set(projectId,{base:timelineEtag(request.ifMatch),etag});else clipBatchBases.delete(projectId);
 }
 // Every other successful timeline write on the cached base advances the cache to its returned revision.
 const replayedWrite=request.replayedOnce||data?.replay===true||data?.structuredContent?.replay===true;
 const action=name==='execute_pro_action'?String(args?.action||''):name,readOnly=/^(list|get|read|browse|search|preview|inspect|stop|start_stream|stop_stream)(_|$)/.test(action)||['preview_pattern','preview_pattern_sample','stop_all_pattern_previews'].includes(action);
 if(response.ok&&!replayedWrite&&!readOnly&&projectId&&!['get_project','get_pro_state','apply_clip_batch'].includes(name)&&!mixRevisionCall(name,args)&&typeof request.ifMatch==='string'){const next=revisionTag(data)??(typeof etag==='string'&&etag&&!etag.startsWith('"mix-')?etag:null);if(next&&next!==timelineEtag(request.ifMatch))adoptStudioWrite(projectId,{base:request.ifMatch,etag:next});}
 return {response,data,request};
}
