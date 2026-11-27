/** Typed engine helpers for Freestyle release 2026-11-12 (345 ops), updated for
 * release 2026-11-14 (357 ops: aux sends, tempo stretch, instrument/pattern duplicate).
 * Every call is a generated Studio API v1 operation through the same-origin /api/studio proxy
 * (StudioApiClient); nothing falls back to MCP or to an AI-rated engine action.
 *  - Clip gain: setClipGain (saved, If-Match, undo {gain}) on release; engine_set_clip_gain
 *    {persist:false} for drag previews (never saved, no history). >4 is rejected, not clamped.
 *  - Stems: splitClipStems -> getStemJob (poll, Retry-After) -> undoStemJob. Gated by the
 *    clip_stems feature flag; UI wiring comes later.
 *  - Project key: renameProject PATCH {key, scale, expected?}; 409 key_changed when expected
 *    no longer matches. Since 2026-11-14 getProject's ETag is "<timeline>.<content>" and a key change
 *    moves only the content part; the client snapshot keeps the timeline tag, so use the reply.
 *  - Lane duplicate: laneDuplicateAvailability() says whether ⌘D may run for a lane and why not.
 */
import {StudioApiClient,STUDIO_API_OPERATIONS} from './studio-api-client.js';

const bodySchema=operationId=>STUDIO_API_OPERATIONS[operationId]?.requestBody?.content?.['application/json']?.schema??null;
const fail=(message,fields={})=>Object.assign(new Error(message),{dispatched:false,...fields});
const id=(value,name)=>{if(typeof value!=='string'||!value||value.length>128||/[\u0000-\u001f\u007f]/.test(value))throw fail(`${name} must be a durable resource id.`,{code:'invalid_'+name});return value;};
const ifMatchOption=value=>value===undefined||value===null?{}:{ifMatch:value};
const keyOption=value=>value===undefined||value===null?{}:{idempotencyKey:value};

export const CLIP_GAIN_MAX=bodySchema('setClipGain')?.properties?.gain?.maximum??4;
export const STEM_MODES=Object.freeze([...(bodySchema('splitClipStems')?.properties?.mode?.enum??[])]);
export const PROJECT_KEYS=Object.freeze((bodySchema('renameProject')?.properties?.key?.enum??[]).filter(value=>value!==null));
export const PROJECT_SCALES=Object.freeze((bodySchema('renameProject')?.properties?.scale?.enum??[]).filter(value=>value!==null));
/** Lane kinds duplicateLane copies. Release 2026-11-14: audio (vocal / audio / guitar), instrument
 * lanes (trackType plugin: generator + chain + per-lane pattern copies) and pattern rows (trackType
 * pattern: independent pattern copies at identical geometry). Only the backing lane is refused. */
export const DUPLICABLE_LANE_KINDS=Object.freeze(['audio','vocal','guitar','instrument','pattern']);
const AUDIO_LANE_KINDS=Object.freeze(['audio','vocal','guitar']);

/** Linear clip gain 0..4 (1 = unity, 4 = +12 dB). Out of range is refused, never clamped. */
export function validClipGain(gain){
 if(typeof gain!=='number'||!Number.isFinite(gain)||gain<0||gain>CLIP_GAIN_MAX)throw fail(`Clip gain must be a linear value from 0 to ${CLIP_GAIN_MAX}.`,{code:'invalid_clip_gain'});
 return gain;
}

/** Saved clip gain (persist true, the default) or a live drag preview (persist false).
 * Saved: PUT /clips/{clip_id}/gain {gain, track_id?} with the timeline If-Match; returns the
 * receipt with `undo` {op:'gain', clip_id, gain} — PUT that gain back to undo. `trackId` is the
 * optional live-session scope (take/clip/lane), not the clip's lane.
 * Preview: engine_set_clip_gain {track_id: laneId, clip_id, gain, persist:false}. */
export async function setClipGain({client=new StudioApiClient(),projectId,clipId,gain,persist=true,laneId=null,trackId=null,ifMatch,idempotencyKey,signal}={}){
 id(projectId,'project_id');id(clipId,'clip_id');validClipGain(gain);
 if(typeof persist!=='boolean')throw fail('persist must be a boolean.',{code:'invalid_persist'});
 const options={...keyOption(idempotencyKey),...signal?{signal}:{}};
 if(!persist){
  id(laneId,'lane_id');
  const response=await client.call('engine_set_clip_gain',{path:{project_id:projectId},query:trackId?{scope_track_id:id(trackId,'track_id')}:{},body:{track_id:laneId,clip_id:clipId,gain,persist:false}},options);
  return Object.freeze({persisted:false,gain,clipId,response:response.data});
 }
 const response=await client.call('setClipGain',{path:{project_id:projectId,clip_id:clipId},body:{gain,...trackId?{track_id:id(trackId,'track_id')}:{}}},{...options,...ifMatchOption(ifMatch)});
 const data=response.data||{};
 return Object.freeze({persisted:true,clipId,gain:data.gain??gain,changed:data.changed!==false,timelineRevision:data.timelineRevision??null,etag:response.etag??null,
  engineApplied:data.engine_applied===true,engineReloadRequired:data.engine_reload_required===true,undo:data.undo??null,clip:data.clip??null,response:data});
}
/** Undo a saved clip gain with the receipt's own undo {gain} (never a rebuilt value). */
export function undoClipGain(receipt,{client,projectId,ifMatch,idempotencyKey,trackId}={}){
 const undo=receipt?.undo;if(undo?.op!=='gain'||typeof undo.clip_id!=='string')throw fail('This clip gain receipt has no server undo.',{code:'clip_gain_undo_missing'});
 return setClipGain({client,projectId,clipId:undo.clip_id,gain:undo.gain,trackId,ifMatch,idempotencyKey});
}

/** One clip-gain drag: preview() while dragging (coalesced, latest wins, one request in
 * flight, ≤ 1 per minIntervalMs), commit() on release sends the saved write after the last
 * preview settles. cancel() drops pending previews (the caller restores with a saved write). */
export function createClipGainGesture({client=new StudioApiClient(),projectId,clipId,laneId,trackId=null,minIntervalMs=50,now=()=>globalThis.performance?.now?.()??Date.now(),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=timer=>clearTimeout(timer)}={}){
 id(projectId,'project_id');id(clipId,'clip_id');id(laneId,'lane_id');
 let pending=null,inFlight=null,timer=null,lastSentAt=-Infinity,closed=false;const stats={previews:0,coalesced:0,errors:0};
 const flush=()=>{
  timer=null;if(closed||pending===null||inFlight)return;
  const gain=pending;pending=null;lastSentAt=now();stats.previews++;
  inFlight=setClipGain({client,projectId,clipId,laneId,trackId,gain,persist:false}).catch(error=>{stats.errors++;stats.lastError=String(error?.message||error).slice(0,200);}).finally(()=>{inFlight=null;if(pending!==null)schedule();});
 };
 const schedule=()=>{if(timer!=null||inFlight)return;const wait=lastSentAt+minIntervalMs-now();if(wait<=0)flush();else timer=setTimer(flush,Math.ceil(wait));};
 return Object.freeze({
  preview(gain){if(closed)return false;validClipGain(gain);if(pending!==null)stats.coalesced++;pending=gain;schedule();return true;},
  async commit(gain,{ifMatch,idempotencyKey}={}){validClipGain(gain);closed=true;pending=null;if(timer!=null){clearTimer(timer);timer=null;}if(inFlight)await inFlight;return setClipGain({client,projectId,clipId,trackId,gain,persist:true,ifMatch,idempotencyKey});},
  cancel(){closed=true;pending=null;if(timer!=null){clearTimer(timer);timer=null;}return inFlight??Promise.resolve();},
  get stats(){return{...stats};},
 });
}

/** Start one stem split of an audio clip (or 'backing'). 202 + job; send a retained
 * Idempotency-Key so a retry never starts a second (metered) split. */
export async function splitClipStems({client=new StudioApiClient(),projectId,clipId,mode,replace=true,idempotencyKey,signal}={}){
 id(projectId,'project_id');id(clipId,'clip_id');
 if(!STEM_MODES.includes(mode))throw fail(`Stem mode must be one of ${STEM_MODES.join(', ')}.`,{code:'invalid_stem_mode'});
 if(typeof replace!=='boolean')throw fail('replace must be a boolean.',{code:'invalid_stem_replace'});
 const response=await client.call('splitClipStems',{path:{project_id:projectId,clip_id:clipId},body:{mode,replace}},{...keyOption(idempotencyKey),...signal?{signal}:{}});
 return Object.freeze({...response.data,idempotencyKey:response.idempotencyKey});
}
export const STEM_JOB_FINAL=Object.freeze(new Set(['done','failed','undone']));
/** Poll getStemJob until done / failed / undone. Waits the server's retryAfterSec (default
 * 10 s, as documented), bounded by maxWaitMs. A pure read: it never mutes or acknowledges. */
export async function pollStemJob({client=new StudioApiClient(),projectId,jobId,signal,onProgress=()=>{},maxWaitMs=15*60*1000,sleep=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,ms);signal?.addEventListener?.('abort',()=>{clearTimeout(timer);reject(signal.reason??Object.assign(new Error('Stem polling was cancelled.'),{name:'AbortError'}));},{once:true});}),now=()=>Date.now()}={}){
 id(projectId,'project_id');if(typeof jobId!=='string'||!/^[a-f0-9]{32}$/.test(jobId))throw fail('A stem job id is 32 hex characters.',{code:'invalid_job_id'});
 const started=now();
 for(;;){
  const job=(await client.call('getStemJob',{path:{project_id:projectId,job_id:jobId}},signal?{signal}:{})).data||{};
  try{onProgress(job);}catch{}
  if(STEM_JOB_FINAL.has(job.status))return Object.freeze(job);
  const wait=Math.max(1000,Math.min(30000,1000*(Number(job.retryAfterSec)||10)));
  if(now()-started+wait>maxWaitMs)throw Object.assign(new Error('The stem split is still processing. Check it again later; nothing was undone.'),{code:'stem_job_poll_timeout',job});
  await sleep(wait,signal);
 }
}
/** Remove exactly what one finished split created (idempotent; alreadyUndone on a replay). */
export async function undoStemJob({client=new StudioApiClient(),projectId,jobId,ifMatch,idempotencyKey,signal}={}){
 id(projectId,'project_id');if(typeof jobId!=='string'||!/^[a-f0-9]{32}$/.test(jobId))throw fail('A stem job id is 32 hex characters.',{code:'invalid_job_id'});
 const response=await client.call('undoStemJob',{path:{project_id:projectId,job_id:jobId},body:{}},{...keyOption(idempotencyKey),...ifMatchOption(ifMatch),...signal?{signal}:{}});
 return Object.freeze({...response.data,etag:response.etag??null});
}

/** Set (or clear with key:null) the project's musical key. `expected` {key, scale} guards
 * against overwriting another change (409 key_changed). The reply's undo {key, scale} is the
 * exact inverse: pass it back as {key, scale}. getProject's ETag does not move on this. */
export async function setProjectKey({client=new StudioApiClient(),projectId,key,scale,expected,idempotencyKey,signal}={}){
 id(projectId,'project_id');
 if(key!==null&&key!==undefined&&!PROJECT_KEYS.includes(key))throw fail(`Key must be one of ${PROJECT_KEYS.join(' ')} or null.`,{code:'invalid_project_key'});
 if(scale!==null&&scale!==undefined&&!PROJECT_SCALES.includes(scale))throw fail(`Scale must be one of ${PROJECT_SCALES.join(', ')}.`,{code:'invalid_project_scale'});
 if(key===undefined&&scale===undefined)throw fail('Send a key, a scale or both.',{code:'invalid_project_key'});
 const body={...key!==undefined?{key}:{},...scale!==undefined?{scale}:{}};
 if(expected!==undefined){if(!expected||typeof expected!=='object')throw fail('expected must be {key, scale}.',{code:'invalid_expected_key'});body.expected={...'key'in expected?{key:expected.key}:{},...'scale'in expected?{scale:expected.scale}:{}};}
 const response=await client.call('renameProject',{path:{project_id:projectId},body},{...keyOption(idempotencyKey),...signal?{signal}:{}});
 const data=response.data||{};
 return Object.freeze({key:data.key??null,scale:data.scale??null,keyChanged:data.keyChanged===true,undo:data.undo??null,project:data.project??null,response:data});
}

/** Whether New Track with Duplicate Settings (⌘D) can run for one lane of a raw project.
 * Mirrors duplicateLane's documented 409s so the UI disables it with the same reason instead
 * of sending a doomed write: lane_kind_not_duplicable (the backing lane) and pattern clips on an
 * audio lane (not covered by the audio copy). project_track_limit can only be learned from the server. */
export function laneDuplicateAvailability(raw,laneId,{operations=STUDIO_API_OPERATIONS}={}){
 const has=name=>!!operations&&Object.prototype.hasOwnProperty.call(operations,name);
 if(!has('duplicateLane'))return{enabled:false,code:'studio_operation_unavailable',reason:'Duplicating tracks is unavailable in this API build.'};
 const lanes=Array.isArray(raw?.lanes)?raw.lanes.filter(lane=>lane?.id===laneId):[];
 if(lanes.length!==1)return{enabled:false,code:'lane_not_found',reason:'Select a saved track first.'};
 const lane=lanes[0],kind=String(lane.kind||'');
 if(lane.isBacking===true||kind==='backing')return{enabled:false,code:'lane_kind_not_duplicable',reason:'Freestyle cannot duplicate the backing track.'};
 if(!DUPLICABLE_LANE_KINDS.includes(kind))return{enabled:false,code:'lane_kind_not_duplicable',reason:'Freestyle cannot duplicate this kind of track.'};
 // An audio lane's copy is documented for its takes/clips only; pattern clips placed on an
 // audio lane are not named in duplicateLane, so that one case stays refused before dispatch.
 const placements=Array.isArray(raw?.placements)?raw.placements:[];
 if(AUDIO_LANE_KINDS.includes(kind)&&placements.some(row=>(row?.laneId??row?.lane_id)===laneId))return{enabled:false,code:'lane_has_pattern_clips',reason:'This audio track holds pattern clips, which Freestyle does not copy with an audio track.'};
 return{enabled:true,code:null,reason:null};
}
