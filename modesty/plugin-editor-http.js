/** OAuth HTTP transport for the remote plugin editor GUI (Studio API v1, 314-op contract).
 *
 * Frames:  GET  /projects/{p}/lanes/{l}/plugins/{i}/editor/frame  (getPluginEditorFrame)
 *          image/jpeg; max_width 64–1280; if_revision + wait_ms ≤ 500 long-poll, 304 = unchanged.
 *          At most 2 frame requests in flight per user (extra → 429): one loop per open editor,
 *          a shared cap of 2 across every plugin window, backoff on 429.
 * Input:   POST .../editor/pointer | scroll | type  (sendPluginEditorPointer/Scroll/Keys)
 *          1800/min, each event sent once (a reused key is refused with editor_input_not_retryable);
 *          pointer moves coalesced to ≤20/s, down/up always sent.
 * Quirk:   with no editor open a frame returns 409 editor_not_open (or 400
 *          engine_invalid_arguments): reopen once per open attempt, then resume.
 *
 * Local bridge (gated on /api/tools features.pluginEditorFrame / pluginEditorInput):
 *   GET  /api/editor/frame?project_id&lane_id&plugin_index[&max_width][&if_revision][&wait_ms][&expected_plugin_instance_id]
 *        200 image/jpeg + X-Editor-Revision/Width/Height/Plugin-Instance-Id/Plugin-Type; 304 + X-Editor-Revision;
 *        errors {error:"studio_api_error",code,details:{upstreamCode,upstreamStatus,operationId,retryable,retryAfterSec?},detail}
 *        (429 editor_rate_limited, 409 editor_not_open incl. the 400 quirk, 409 plugin_instance_mismatch, target_not_loaded).
 *   POST /api/call {name:"sendPluginEditorPointer"|"sendPluginEditorScroll"|"sendPluginEditorKeys",arguments:{project_id,lane_id,plugin_index,...body}}
 */
import {EditorError} from './remote-plugin.js';
import {bridgeFetch} from './freestyle-host-transport.js';

export const FRAME_MAX_WIDTH=1280,FRAME_MIN_WIDTH=64,FRAME_WAIT_MS=500,FRAME_CONCURRENCY=2,POINTER_MOVE_INTERVAL_MS=50,POINTER_MAX_IN_FLIGHT=4,EDITOR_FRAME_ROUTE='modesty-bridge:/editor/frame';
const uid=()=>globalThis.crypto?.randomUUID?.()||`in-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Requested width: displayed CSS px × devicePixelRatio, clamped to the published 64–1280 range. */
export function frameWidthFor(cssWidth,devicePixelRatio=globalThis.devicePixelRatio||1){return Math.max(FRAME_MIN_WIDTH,Math.min(FRAME_MAX_WIDTH,Math.ceil((Number(cssWidth)||640)*Math.max(1,Number(devicePixelRatio)||1))));}

/** Shared per-user cap on concurrent frame requests (FIFO, abortable). */
export class FrameRequestLimiter{
  constructor(limit=FRAME_CONCURRENCY){this.limit=limit;this.active=0;this.waiting=[];}
  acquire(signal){
    if(signal?.aborted)return Promise.reject(abortError());
    if(this.active<this.limit){this.active++;return Promise.resolve(this.releaser());}
    return new Promise((resolve,reject)=>{const entry={resolve,reject};this.waiting.push(entry);signal?.addEventListener('abort',()=>{const at=this.waiting.indexOf(entry);if(at>=0){this.waiting.splice(at,1);reject(abortError());}},{once:true});});
  }
  releaser(){let done=false;return()=>{if(done)return;done=true;const next=this.waiting.shift();if(next)next.resolve(this.releaser());else this.active--;};}
}
export const sharedFrameLimiter=new FrameRequestLimiter(FRAME_CONCURRENCY);
const abortError=()=>Object.assign(new Error('The editor frame request was cancelled.'),{name:'AbortError'});

/** Local bridge URL for one frame read (only the documented query fields). */
export function editorFrameUrl(target,{maxWidth,ifRevision,waitMs,expectedInstanceId,route=EDITOR_FRAME_ROUTE}={}){
  const query=new URLSearchParams({project_id:target.projectId,lane_id:target.laneId,plugin_index:String(target.pluginIndex),max_width:String(Math.max(FRAME_MIN_WIDTH,Math.min(FRAME_MAX_WIDTH,Math.round(Number(maxWidth)||640))))});
  if(ifRevision){query.set('if_revision',ifRevision);query.set('wait_ms',String(Math.max(0,Math.min(FRAME_WAIT_MS,Number(waitMs)||0))));}
  if(expectedInstanceId)query.set('expected_plugin_instance_id',expectedInstanceId);
  return`${route}?${query}`;
}

const retryAfterMs=response=>{const value=response.headers?.get?.('Retry-After');if(!value)return null;const seconds=Number(value);if(Number.isFinite(seconds))return Math.max(0,seconds*1000);const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-Date.now()):null;};
/** One frame read: {kind:'frame',blob,revision,width,height} | {kind:'unchanged',revision}; errors carry code/status/details. */
export async function fetchEditorFrame({fetch:fetchImpl=(...args)=>bridgeFetch(...args),frameUrl=editorFrameUrl,route=EDITOR_FRAME_ROUTE,target,maxWidth,ifRevision,waitMs=FRAME_WAIT_MS,expectedInstanceId,signal}){
  const response=await fetchImpl(frameUrl(target,{maxWidth,ifRevision,waitMs,expectedInstanceId,route}),{method:'GET',headers:{Accept:'image/jpeg, application/json'},signal});
  const header=name=>response.headers?.get?.(name)||'';
  if(response.status===304)return{kind:'unchanged',revision:header('X-Editor-Revision')||ifRevision||''};
  if(response.ok&&/^image\//i.test(header('Content-Type'))){const blob=await response.blob();return{kind:'frame',blob,bytes:blob.size,revision:header('X-Editor-Revision'),width:Number(header('X-Editor-Width'))||null,height:Number(header('X-Editor-Height'))||null,format:blob.type||header('Content-Type'),instanceId:header('X-Editor-Plugin-Instance-Id')||null,pluginType:header('X-Editor-Plugin-Type')||null,captureSource:header('X-Editor-Capture-Source')||null};}
  const data=await response.json?.().catch(()=>({}))??{};
  const details=data.details&&typeof data.details==='object'?data.details:{},afterSec=details.retryAfterSec??data.retryAfterSec,header429=retryAfterMs(response);
  throw new EditorError(data.detail||data.message||(typeof data.error==='string'&&data.error!=='studio_api_error'?data.error:data.error?.message)||`The editor frame request failed (${response.status}).`,{code:data.code||data.error?.code||(response.ok?'editor_frame_not_image':`http_${response.status}`),stage:data.stage||details.operationId||'frame',status:response.status,requestId:data.requestId||null,details:{...details,...header429!=null?{retryAfterMs:header429}:{},...afterSec!=null&&Number.isFinite(Number(afterSec))?{retryAfterMs:Number(afterSec)*1000}:{}}});
}

export const isEditorNotOpen=error=>error?.code==='editor_not_open'||Number(error?.status)===409&&/editor_not_open|editor is not open/i.test(error?.message||'')||error?.code==='engine_invalid_arguments'||Number(error?.status)===400&&/engine_invalid_arguments/i.test(error?.message||'');
export const isInstanceMismatch=error=>error?.code==='plugin_instance_mismatch'||/plugin_instance_mismatch/.test(String(error?.message||''));
const isRateLimited=error=>Number(error?.status)===429||error?.code==='editor_rate_limited'||error?.code==='rate_limited';
// target_not_loaded: the engine is still attaching the lane; retry with backoff like other transient failures.
const isTransient=error=>error?.code==='target_not_loaded'||error?.details?.retryable===true||[408,502,503,504].includes(Number(error?.status))||/network|fetch|timed? ?out/i.test(String(error?.message||''));

/** One long-poll loop per open editor. */
export class HttpFrameLoop{
  constructor({fetchFrame,limiter=sharedFrameLimiter,reopen,maxWidth=()=>640,expectedInstanceId=null,onFrame,onError,onReopen,sleep=(ms,signal)=>new Promise((resolve,reject)=>{const id=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(id);reject(abortError());},{once:true});}),maxTransientFailures=5}){
    Object.assign(this,{fetchFrame,limiter,reopen,maxWidth,expectedInstanceId,onFrame,onError,onReopen,sleep,maxTransientFailures});
    this.revision='';this.running=false;this.reopened=false;this.backoffMs=0;this.stats={requests:0,frames:0,unchanged:0,rateLimited:0,reopens:0};
  }
  start(){if(this.running)return this.done;this.running=true;this.abort=new AbortController();this.done=this.run(this.abort.signal).finally(()=>{this.running=false;});return this.done;}
  stop(){this.running=false;this.abort?.abort();return this.done?.catch(()=>{});}
  /** Re-read now: restart an in-flight long-poll so the frame after a pointer release is requested immediately. */
  refreshNow(){this.request?.abort();}
  /** A new open attempt may reopen once more. */
  resetOpenAttempt(){this.reopened=false;}
  async run(signal){
    let transient=0;
    while(this.running&&!signal.aborted){
      let release;
      try{
        release=await this.limiter.acquire(signal);this.stats.requests++;
        // Each request has its own controller so a pointer release can restart a stale long-poll without stopping the loop.
        const request=this.request=new AbortController(),forward=()=>request.abort();signal.addEventListener('abort',forward,{once:true});
        let result;try{result=await this.fetchFrame({maxWidth:this.maxWidth(),ifRevision:this.revision,waitMs:this.revision?FRAME_WAIT_MS:0,expectedInstanceId:this.expectedInstanceId,signal:request.signal});}
        catch(error){if(!signal.aborted&&request.signal.aborted&&error?.name==='AbortError'){release();release=null;this.stats.restarts=(this.stats.restarts||0)+1;continue;}throw error;}
        finally{signal.removeEventListener('abort',forward);if(this.request===request)this.request=null;}
        release();release=null;transient=0;this.backoffMs=0;
        if(signal.aborted)return;
        if(result.kind==='unchanged'){this.stats.unchanged++;continue;}
        this.stats.frames++;if(result.revision)this.revision=result.revision;await this.onFrame?.(result);
      }catch(error){
        release?.();
        if(error?.name==='AbortError'||signal.aborted)return;
        if(isRateLimited(error)){this.stats.rateLimited++;this.backoffMs=Math.min(8000,Math.max(error.details?.retryAfterMs??0,this.backoffMs?this.backoffMs*2:500));try{await this.sleep(this.backoffMs,signal);}catch{return;}continue;}
        if(isEditorNotOpen(error)&&!this.reopened&&this.reopen){this.reopened=true;this.stats.reopens++;this.revision='';try{this.onReopen?.(error);await this.reopen();}catch(reopenError){this.onError?.(reopenError);return;}continue;}
        if(!isInstanceMismatch(error)&&isTransient(error)&&++transient<this.maxTransientFailures){try{await this.sleep(Math.min(8000,500*2**(transient-1)),signal);}catch{return;}continue;}
        this.onError?.(error);return;
      }
    }
  }
}

/** Input over REST. Pointer moves are pipelined (latest position only, ≤20/s, ≤4 in flight) and never wait for each
 *  other; a slow or failed move does not hold later ones. Ordering-sensitive events are barriers: the bridge is a
 *  ThreadingHTTPServer and the browser runs requests on parallel connections, so concurrent requests can arrive out of
 *  order. down is sent alone (moves start once it is dispatched); at release one final move at the release position is
 *  sent, and up goes alone after every earlier request has settled. One gesture keeps one gesture_id. */
export class HttpInputQueue{
  constructor({send,now=()=>globalThis.performance?.now?.()??Date.now(),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),moveIntervalMs=POINTER_MOVE_INTERVAL_MS,maxInFlight=4,onError,onMoveError=null}){
    Object.assign(this,{send,now,setTimer,clearTimer,moveIntervalMs,maxInFlight,onError,onMoveError});
    this.barrier=Promise.resolve();this.inflight=new Set();this.pendingMove=null;this.lastMoveAt=-Infinity;this.closed=false;this.gesture=null;
    this.stats={sent:0,coalesced:0,failed:0,moveFailures:0,maxInFlight:0};this.debug={lastMoveError:null};
  }
  push(kind,payload){
    if(this.closed)return;
    if(kind==='pointer'&&payload.phase==='down'){this.gesture={downX:payload.x_norm,downY:payload.y_norm,moved:false,buttons:payload.buttons||1,button:payload.button,pressure:payload.pressure,last:null};this.ordered(kind,payload);return;}
    if(kind==='pointer'&&payload.phase==='move'){if(this.pendingMove)this.stats.coalesced++;this.pendingMove=payload;if(this.gesture){this.gesture.moved=true;this.gesture.last=payload;}this.scheduleMove();return;}
    if(kind==='pointer'&&payload.phase==='up'){
      if(this.moveTimer!=null){this.clearTimer(this.moveTimer);this.moveTimer=null;}this.pendingMove=null;
      // One final move at the real release position, so coalescing never loses the end value.
      const gesture=this.gesture;this.gesture=null;
      if(gesture&&(gesture.moved||payload.x_norm!==gesture.downX||payload.y_norm!==gesture.downY)){const template=gesture.last||{};this.dispatchMove({...template,...payload,phase:'move',buttons:template.buttons||gesture.buttons||1,button:template.button??gesture.button??0,pressure:template.pressure||gesture.pressure||.5},{force:true});}
      this.ordered(kind,payload,{afterAll:true});return;
    }
    this.ordered(kind,payload,{afterAll:true});
  }
  scheduleMove(){if(this.moveTimer!=null)return;const wait=Math.max(0,this.lastMoveAt+this.moveIntervalMs-this.now());let fired=false;const id=this.setTimer(()=>{fired=true;this.moveTimer=null;this.flushMove();},wait);if(!fired)this.moveTimer=id;}
  /** Sends the latest move once the down is dispatched and a slot is free; otherwise it waits (still coalescing). */
  flushMove(){
    if(this.closed||!this.pendingMove)return;
    if(this.blocked){this.barrier.then(()=>this.flushMove());return;}
    if(this.inflight.size>=this.maxInFlight)return;// re-tried when a request settles
    const move=this.pendingMove;this.pendingMove=null;this.lastMoveAt=this.now();this.dispatchMove(move);
  }
  dispatchMove(move,{force=false}={}){
    const task=(async()=>{if(this.blocked)await this.barrier;if(this.closed)return;try{await this.send('pointer',move);this.stats.sent++;}catch(error){this.stats.failed++;this.stats.moveFailures++;this.debug.lastMoveError={code:error?.code||null,status:error?.status??null,message:String(error?.message||error),at:Date.now()};this.onMoveError?.(error,move);}})();
    this.track(task);return task;
  }
  track(task){this.inflight.add(task);this.stats.maxInFlight=Math.max(this.stats.maxInFlight,this.inflight.size);task.finally(()=>{this.inflight.delete(task);if(this.pendingMove&&this.moveTimer==null)this.scheduleMove();});return task;}
  /** down / up / scroll / type: one at a time, in order; up (and scroll/type) wait for every earlier request. */
  ordered(kind,payload,{afterAll=false}={}){
    const before=this.barrier,earlier=afterAll?[...this.inflight]:[];
    this.blocked=true;
    const task=(async()=>{await before;if(afterAll)await Promise.allSettled(earlier);if(this.closed)return;try{await this.send(kind,payload);this.stats.sent++;}catch(error){this.stats.failed++;this.onError?.(error,kind,payload);}})();
    this.barrier=task.finally(()=>{if(this.barrier===guard)this.blocked=false;});const guard=this.barrier;this.track(task);return task;
  }
  async idle(){for(let i=0;i<50;i++){const pending=[this.barrier,...this.inflight];await Promise.allSettled(pending);if(!this.inflight.size&&!this.pendingMove)return;if(this.pendingMove&&this.moveTimer==null&&!this.inflight.size)this.flushMove();await new Promise(resolve=>setTimeout(resolve,0));}}
  close(){this.closed=true;if(this.moveTimer!=null)this.clearTimer(this.moveTimer);this.moveTimer=null;this.pendingMove=null;}
}

const HTTP_KEYCODES=Object.freeze({Enter:13,Tab:9,Backspace:8,Escape:27,Delete:46,Home:36,End:35,PageUp:33,PageDown:34,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40});
const INPUT_OPERATIONS=Object.freeze({pointer:'sendPluginEditorPointer',scroll:'sendPluginEditorScroll',type:'sendPluginEditorKeys'});
const INPUT_FIELDS=Object.freeze({pointer:['phase','x_norm','y_norm','gesture_id','button','buttons','pressure','shift_key','ctrl_key','alt_key','meta_key'],scroll:['x_norm','y_norm','delta_x','delta_y','delta_mode','shift_key','ctrl_key','alt_key','meta_key'],type:['text','keycode','shift_key','ctrl_key','alt_key','meta_key']});
/** One typed input call; only published body fields are sent and nothing is retried. */
export async function sendEditorInput({call,target,kind,payload}){
  const operation=INPUT_OPERATIONS[kind];if(!operation)throw new EditorError('Unsupported native editor input.',{code:'editor_input_unsupported',stage:'input'});
  const body={};for(const key of INPUT_FIELDS[kind])if(payload[key]!==undefined)body[key]=payload[key];
  // HTTP key codes: Return is 13 (published); other named keys use the same virtual-key family (assumed until documented).
  if(kind==='type'&&payload.key){const code=HTTP_KEYCODES[payload.key]??((payload.meta_key||payload.ctrl_key)&&payload.text?.length===1?payload.text.toUpperCase().charCodeAt(0):undefined);if(code!==undefined)body.keycode=code;else if(body.text)delete body.keycode;}
  if(kind==='pointer'&&body.button!==undefined)body.button=Math.max(-1,Math.min(4,body.button));
  if(kind==='pointer'&&body.pressure!==undefined)body.pressure=Math.max(0,Math.min(1,body.pressure));
  return call(operation,{project_id:target.projectId,lane_id:target.laneId,plugin_index:target.pluginIndex,...body,idempotency_key:uid()});
}
