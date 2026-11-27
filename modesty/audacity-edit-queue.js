import {definiteCloudRejection} from './cloud-errors.js';
/** Ordered, per-workspace queue for owned cloud edits started while an earlier
 * write is in flight. Each task runs only after its predecessor settles, so it
 * reads the revision returned by the earlier ACK. A definite rejection cancels
 * every edit queued after it (they were built on the rejected result). */
export class EditQueue{
 constructor(){this.tail=Promise.resolve();this.epoch=0;this.depth=0;this.listeners=new Set();}
 get busy(){return this.depth>0;}
 onChange(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 notify(){for(const fn of this.listeners){try{fn(this.depth);}catch{}}}
 /** Mark a definite rejection that happened outside the queue (e.g. an engine-chained geometry batch). */
 rejectAfter(){this.epoch++;}
 enqueue(label,task){
  const epoch=this.epoch,queued=this.depth>0;this.depth++;this.notify();
  const run=this.tail.then(()=>{if(this.epoch!==epoch)throw Object.assign(new Error(`“${label}” was not sent: an earlier queued edit was rejected by Freestyle, so it and later edits were rolled back.`),{code:'queued_edit_cancelled',definiteRejection:true,writeDispatched:false});return task({queued});});
  this.tail=run.then(()=>{},error=>{if(error?.code!=='queued_edit_cancelled'&&definiteCloudRejection(error))this.epoch++;}).finally(()=>{this.depth--;this.notify();});
  return run;
 }
}
export const editQueue=w=>w.editQueue??=new EditQueue();
/** True while an owned write is in flight or queued (not a gesture). */
export const writesInFlight=w=>!!(w.busy||w.engine?.applying||w.engine?.inFlight||w.engine?.pending||w.editQueue?.busy);
/** Wait for the in-flight write chain to finish (bounded). */
export async function whenWritesIdle(w,timeoutMs=30000){const start=Date.now();await w.engine?.inFlight?.catch?.(()=>{});while((w.busy||w.engine?.applying||w.engine?.inFlight||w.engine?.pending)&&Date.now()-start<timeoutMs){await w.engine?.inFlight?.catch?.(()=>{});await new Promise(resolve=>setTimeout(resolve,10));}}
export const ENGINE_DESYNC_WARNING="The live engine still has a clip the saved project doesn't; playback may differ until the session reloads.";
/** Clips the live engine still holds on the touched lanes that the saved project does not (Freestyle has no client engine reload). Uses the session's existing refresh only. */
export function engineOrphans(session,laneIds){
 const lanes=new Set(laneIds),rows=session?.rawState?.clips?.clips??session?.rawState?.clips,saved=new Set((session?.rawProject?.clips??[]).map(clip=>clip.id));
 if(!Array.isArray(rows)||!lanes.size)return [];return rows.filter(row=>typeof row?.db_clip_id==='string'&&lanes.has(row.db_track_id)&&!saved.has(row.db_clip_id)).map(row=>row.db_clip_id);
}
/** Warn once per orphan set; never deletes anything. */
/* Desync found on a touched lane → one reconcile reload (328 engine:reload), once per orphan set. */
export function warnEngineOrphans(w,session,laneIds,warn){const orphans=engineOrphans(session,laneIds);if(!orphans.length)return [];const key=orphans.slice().sort().join(',');w.engineOrphanWarnings??=new Set();if(!w.engineOrphanWarnings.has(key)){w.engineOrphanWarnings.add(key);if(w.engineReloadSupported===false)warn(ENGINE_DESYNC_WARNING);else requestEngineReconcile(w,{reason:'engine_orphans'});}return orphans;}
export const pendingEngineReconcile=w=>w.engineReconcile?.get(w.engine?.session?.projectId??w.engine?.projectId)??null;
/** A committed batch (or any edit receipt) that says the live engine diverged. Never a failure. */
export function engineNeedsReconcile(payload){return !!payload&&(Array.isArray(payload.engine_divergent)&&payload.engine_divergent.length>0||payload.engine_reload_required===true||!!payload.reload&&typeof payload.reload==='object');}
/** Freestyle 328: rebuild the live session from the saved project (mode reconcile:
 * prunes deleted clips, restores missing ones). Single-flight per project, one
 * idempotency key; never re-sends the edit; a 504 engine_timeout is an unknown
 * outcome → poll engine state once, never repeat the reload. */
export function requestEngineReconcile(w,{reason='',status=message=>w.engine?.onStatus?.(message)}={}){
 const session=w.engine?.session,projectId=session?.projectId??w.engine?.projectId;if(!projectId||typeof session?.call!=='function')return Promise.resolve(null);
 w.engineReconcile??=new Map();const running=w.engineReconcile.get(projectId);if(running)return running;
 const key='modesty-reconcile-'+(globalThis.crypto?.randomUUID?.()??String(Date.now())+Math.random().toString(16).slice(2));status('Resyncing Freestyle engine…');
 const task=(async()=>{
  try{const raw=await session.call('reload_engine_session',{project_id:projectId,mode:'reconcile',...(session.trackId?{track_id:session.trackId}:{}),idempotency_key:key});const result=raw?.structuredContent??raw;try{await session.refresh?.();if(!w.engine.applying)w.engine.accept?.(session.project);}catch{}status(result?.fullyLoaded===false?'Freestyle engine resynced (still loading audio).':'Freestyle engine resynced.');return {ok:true,result,reason,key};}
  catch(error){if(error?.code==='engine_timeout'||Number(error?.status)===504){status('Freestyle engine is still resyncing…');try{await new Promise(resolve=>setTimeout(resolve,w.engineReconcilePollMs??1500));await session.refresh?.();if(!w.engine.applying)w.engine.accept?.(session.project);status('Freestyle engine state refreshed.');}catch{}return {ok:false,timeout:true,reason,key};}
   status('Freestyle engine resync failed: '+(error?.message??'unknown error')+'. Reopen the project to resync.');return {ok:false,error,reason,key};}
  finally{w.engineReconcile.delete(projectId);}
 })();
 w.engineReconcile.set(projectId,task);return task;
}
/** Freestyle "engine busy" transients: 502/503/504 or engine_error (never a reload's engine_timeout). */
export const ENGINE_BUSY_CODES=['engine_error','engine_busy','engine_unavailable','engine_session_contended','engine_session_not_found','engine_restarting','source_busy','render_busy'];/* 429 source_busy: same key after Retry-After */
export const isTransientEngineError=error=>!!error&&!['engine_timeout','engine_swap_failed'].includes(error.code)&&(/* a swap failure is handled by its caller (rolled back: one same-key retry) */[502,503,504].includes(Number(error.status))||ENGINE_BUSY_CODES.includes(error.code));
/** Retry-After (seconds or ms) from the bridge's error metadata, capped. */
export const retryAfterMs=(error,capMs=30000)=>{const ms=Number.isFinite(Number(error?.retryAfterMs))?Number(error.retryAfterMs):Number.isFinite(Number(error?.retryAfterSec))?Number(error.retryAfterSec)*1000:Number.isFinite(Number(error?.details?.retryAfterSec))?Number(error.details.retryAfterSec)*1000:NaN;return Number.isFinite(ms)&&ms>0?Math.min(capMs,ms):0;};
const engineReason=error=>error?.details?.engineReason??error?.result?.details?.engineReason??error?.result?.error?.details?.engineReason??null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-6;
const timingOf=clip=>({start_ms:clip.startMs,duration_sec:clip.durationSec,audio_offset_sec:clip.audioOffsetSec});
const sameTiming=(clip,want)=>['start_ms','duration_sec','audio_offset_sec'].every(key=>want[key]===undefined||close(timingOf(clip)[key],want[key]));
/** Compare a canonical clip list to an apply_clip_batch's before/after states.
 * before: every touched clip as its first op expected (inserted/restored ids absent);
 * after: the ops applied in order. Returns 'before' | 'after' | null (neither / unknown). */
export function classifyBatchOutcome(clips,ops){
 const byId=new Map(clips.map(clip=>[clip.id,clip])),first=new Map(),final=new Map();
 for(const op of ops){if(!first.has(op.id))first.set(op.id,op);const prior=final.get(op.id);if(op.op==='remove')final.set(op.id,null);else final.set(op.id,{...(prior??{}),...Object.fromEntries(['start_ms','duration_sec','audio_offset_sec'].filter(key=>op[key]!==undefined).map(key=>[key,op[key]]))});}
 let before=true,after=true;
 for(const [id,op]of first){const clip=byId.get(id);if(op.op==='insert'||op.op==='restore'){if(clip)before=false;}else if(!clip||!op.expected||!sameTiming(clip,op.expected))before=false;}
 for(const [id,want]of final){const clip=byId.get(id);if(want===null){if(clip)after=false;}else if(!clip||!sameTiming(clip,want))after=false;}
 return before&&!after?'before':after&&!before?'after':null;
}
const laneSnapshot=(clips,lanes)=>JSON.stringify(clips.filter(clip=>lanes.has(clip.laneId)).map(clip=>[clip.id,clip.laneId,clip.startMs,clip.durationSec,clip.audioOffsetSec]).sort());
/** Same-key retry of an owned write while the engine is busy (a committed key replays its stored
 * response), then — only if still transient — one canonical read decides: 'before' → a definite
 * non-commit (history stays usable); 'after' → adopt as committed; otherwise stay uncertain. */
export async function callWithEngineRetry(w,call,name,args,{delays=w.transientRetryDelays??[2000,4000,8000],status=message=>w.engine?.onStatus?.(message),beforeRevision=null,retryAfterCapMs=w.retryAfterCapMs??30000}={}){
 if(w.engineRetry===false)return call(name,args);/* legacy inline-verify harnesses only */
 const projectId=args?.project_id,beforeLanes=(name==='edit_time_range'||name==='apply_effect_to_region')?w.engine?.session?.rawProject?.clips?.slice?.():null;
 let last;for(let attempt=0;;attempt++){try{return await call(name,args);}catch(error){last=error;if(!isTransientEngineError(error)||typeof args?.idempotency_key!=='string'||attempt>=delays.length)break;status('Freestyle engine busy — retrying…');await sleep(Math.max(delays[attempt],retryAfterMs(error,retryAfterCapMs)));}}
 if(!isTransientEngineError(last)||typeof args?.idempotency_key!=='string'||!projectId)throw last;
 let outcome=null,project=null;try{const raw=await call('get_project',{project_id:projectId}),data=raw?.structuredContent??raw;project=data?.project??data;
  if(name==='apply_clip_batch'&&Array.isArray(args.ops))outcome=classifyBatchOutcome(project.clips??[],args.ops);
  else if(name==='apply_effect_to_region'&&args.mode==='in_place'){/* in place never changes timing: compare the clip's source revision */if(typeof beforeRevision==='string'){const wave=await call('get_clip_waveform',{project_id:projectId,clip_id:args.clip_id,track_id:args.track_id,buckets:1}),tile=wave?.structuredContent??wave;if(tile?.revision===beforeRevision)outcome='before';}}
  else if(beforeLanes&&args.mode!=='in_place'){const lanes=new Set(name==='edit_time_range'?args.lane_ids??[]:beforeLanes.filter(clip=>clip.id===args.track_id||clip.id===args.clip_id).map(clip=>clip.laneId));if(lanes.size&&laneSnapshot(project.clips??[],lanes)===laneSnapshot(beforeLanes,lanes))outcome='before';}
 }catch{outcome=null;}
 const reason=engineReason(last),because=reason?' (engine: '+reason+')':'';
 if(outcome==='before'){status('Freestyle engine was busy; nothing changed. Try again.'+because);throw Object.assign(new Error('Freestyle was busy and did not apply this edit. Nothing changed — try again.'+because),{status:409,code:'not_committed',definiteRejection:true,engineBusy:true,cause:last});}
 if(outcome==='after'){status('Saved in Freestyle.');return {applied:true,applied_ops:args.ops.length,projectId,timelineRevision:project?.timelineRevision,replay:true,inferredFromState:true};}
 last.message='Freestyle stayed busy and the saved project matches neither the state before nor after this edit. Use Tools → Verify last audio edit before continuing.'+because+' ('+last.message+')';throw last;
}
/** Wrap a call function so owned write names get the busy-engine retry/resolution. */
export const withEngineRetry=(w,call,names=['apply_clip_batch','edit_time_range','apply_effect_to_region'])=>(name,args)=>names.includes(name)?callWithEngineRetry(w,call,name,args):call(name,args);
