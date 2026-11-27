/** Pre-armed native pattern preview: the Default studio's instant PAT Play.
 *
 * The Default studio never compiles the
 * pattern on the Play critical path:
 *   1. after every edit / session load / PAT-mode entry it POSTs
 *      `/patterns/preview` with `arm_only:true` + an opaque `armed_signature`
 *      (the engine prepares the preview for this browser device; nothing plays),
 *   2. Play is then ONE `pattern_preview_start` message on the open
 *      `mozart-control` data channel (`{preview_request_id, armed_signature,
 *      phase_offset_sec:0, repeat_count, gain, lead_sec:0.01}`) answered by a
 *      `pattern_preview_ack` carrying the normal preview receipt,
 *   3. a stale arm (`not_armed`), a closed channel or a lost ack falls back to
 *      the ordinary request, within the same press.
 * Vegetable used to send `execute_pro_action preview_pattern` (browser ->
 * Freestyle backend -> engine, preparation included) on every Play. This class is
 * the same arm + data-channel start for Vegetable. Song Play already rides the
 * data channel (`transport_play`, cloud-transport.js).
 */
import {freestyleHost} from './freestyle-host-transport.js';
import {clientLog} from './client-diagnostics.js';

export const ARM_DEBOUNCE_MS=150,START_ACK_TIMEOUT_MS=1200,START_LEAD_SEC=.01,DEFAULT_GAIN=.92;
const RETRY_MS=[2000,5000,10000];

/** Same opaque FNV-1a signature Default builds. */
export function armedPatternSignature(serialized,sessionEpoch=0){
 const input=`${Math.max(0,Number(sessionEpoch)||0)}:${String(serialized||'')}`;
 let hash=0x811c9dc5;
 for(let index=0;index<input.length;index+=1){hash^=input.charCodeAt(index);hash=Math.imul(hash,0x01000193);}
 return `pat-v1-${(hash>>>0).toString(16).padStart(8,'0')}-${input.length.toString(36)}`;
}
const finite=value=>typeof value==='number'&&Number.isFinite(value);
/** Mozart's refusal of a command it did not apply (control channel bound elsewhere, no arm, stale id). */
export function patternAckUnusable(ack){return !ack||ack.ok===false||ack.applied===false||ack.code==='project_control_forbidden'||ack.code==='not_armed'||ack.code==='stale_preview_request';}

export class PatternPreviewArm{
 constructor({engine,debounceMs=ARM_DEBOUNCE_MS,ackTimeoutMs=START_ACK_TIMEOUT_MS}={}){
  Object.assign(this,{engine,debounceMs,ackTimeoutMs});
  this.timer=null;this.inFlight=null;this.queued=false;this.armed=null;this.desired='';this.requestId=0;this.retry=0;this.retryTimer=null;this.attached=false;this.lastEpoch=null;this.stats={arms:0,starts:0,fallbacks:0,lastPrepareMs:null,lastStartMs:null,lastFallback:null};
 }
 /** Listen to the monitor once: a (re)connected peer or a new engine session epoch needs a fresh arm. */
 attach(){
  if(this.attached)return;this.attached=true;const monitor=this.engine.monitor;
  monitor.addEventListener('state',event=>{if(event.detail?.state==='connected')this.schedule('monitor-connected',{immediate:true});});
  monitor.addEventListener('clock',event=>{const epoch=Number(event.detail?.session_epoch);if(!Number.isFinite(epoch))return;if(this.lastEpoch!==null&&epoch!==this.lastEpoch){this.armed=null;this.schedule('session-epoch',{immediate:true});}this.lastEpoch=epoch;});
  this.schedule('attach',{immediate:true});
 }
 sessionEpoch(){const payload=this.engine.session.liveClock?.payload;return Math.max(0,Math.round(Number(payload?.session_epoch??payload?.sessionEpoch)||0));}
 /** The armed program is only valid for the live, active peer of this exact project. */
 canArm(){
  const engine=this.engine,monitor=engine.monitor;
  if(freestyleHost()?.capabilities?.patternArm===false)return false; // a host without pre-arming: Play uses previewPattern with the same request id
  // Issue #11: an arm belongs to one monitor peer (client_id), so arming needs this page's own peer id.
  if(!engine.previewPeer?.().client_id)return false;
  return !!(engine.ready&&!engine.loading&&engine.projectId&&monitor.projectId===engine.projectId&&monitor.peer?.connectionState==='connected'&&monitor.suspended!==true&&!globalThis.document?.hidden&&!engine.pending&&!engine.inFlight&&freestyleHost()?.dawFetch);
 }
 /** Current request (same fields as preview_pattern) and its arm signature, or null. */
 describe({patternLoop=true,preview={}}={}){
  let request=null;try{request=this.engine.patternPreviewRequest({patternLoop,preview});}catch{return null;}
  if(!request||!(request.dto?.pattern?.events||[]).length)return null;
  const {pattern,bpm,bars,ppq,length_ticks,repeat_count}=request.body;
  const signature=armedPatternSignature(JSON.stringify({project:this.engine.projectId,pattern:request.chosen.id,bpm,bars,ppq,length_ticks,repeat_count,content:pattern}),this.sessionEpoch());
  return {request,signature,body:request.body};
 }
 schedule(reason='pattern-change',{immediate=false}={}){
  clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;this.run(reason).catch(()=>{});},immediate?0:this.debounceMs);
 }
 async run(reason){
  if(!this.canArm())return null;
  const description=this.describe();
  if(!description){this.armed=null;this.desired='';return null;}
  if(this.armed?.signature===description.signature){this.desired=description.signature;return this.armed;}
  this.desired=description.signature;
  if(this.inFlight){this.queued=true;return this.inFlight;}
  this.inFlight=(async()=>{
   try{do{
    this.queued=false;const next=this.describe();if(!next||!this.canArm())break;
    if(this.armed?.signature===next.signature)break;
    await this.post(next,reason);
   }while(this.queued);}
   finally{this.inFlight=null;}
   return this.armed;
  })();
  return this.inFlight;
 }
 async post(description,reason){
  const engine=this.engine,projectId=engine.projectId,{signature,body}=description,started=performance.now();
  try{
   const response=await freestyleHost().dawFetch('/patterns/preview',{method:'POST',body:JSON.stringify({...body,lead_sec:.025,phase_offset_sec:0,preview_request_id:0,gain:DEFAULT_GAIN,arm_only:true,armed_signature:signature,...engine.previewPeer?.()})},{projectId,timeoutMs:15000});
   if(!response.ok)throw Object.assign(new Error(`arm ${response.status}`),{status:response.status});
   const data=await response.json();
   if(engine.projectId!==projectId||this.desired!==signature)return null;
   if(!data?.ok||!data?.armed)throw new Error('arm refused');
   const floor=Number(data.stopped_through_preview_request_id??data.preview_request_id_floor??0)||0;
   if(floor>this.requestId)this.requestId=floor;
   this.armed={signature,projectId,at:Date.now(),prepareMs:Number(data.prepare_ms)||0,epoch:Number(data.session_epoch)||null};
   this.stats.arms++;this.stats.lastPrepareMs=Math.round(performance.now()-started);this.retry=0;
   clientLog('pattern-preview-armed',{reason,prepareMs:Math.round(this.armed.prepareMs),roundTripMs:this.stats.lastPrepareMs});
   return this.armed;
  }catch(error){
   if(this.desired===signature)this.armed=null;
   clientLog('pattern-preview-arm-failed',{reason,status:error?.status??null,message:String(error?.message||error).slice(0,120)});
   // Session still loading (409) or a transient failure: try again a few times.
   if(this.retry<RETRY_MS.length){clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>{this.retryTimer=null;this.schedule('retry',{immediate:true});},RETRY_MS[this.retry++]);}
   return null;
  }
 }
 /** A claimed id must stay above Mozart's global stop watermark. */
 claimRequestId(){this.requestId=Math.max(this.requestId+1,Date.now());return this.requestId;}
 /** Start the pattern preview the way the Default studio does: ONE preview_request_id per Play. Armed: one
  * pattern_preview_start on the control channel; a missed ack / not_armed /
  * closed channel falls back to Mozart /patterns/preview with the SAME id, so
  * Mozart can never run two previews for one press, and a Stop through that id
  * makes any late start of it stale. (Standalone, the public previewPattern has
  * no request id: freestyle-standalone-host.js re-sends the stop when a start
  * that was in flight during Stop lands, and reports it stale.) Resolves the receipt, {stopped:true} when
  * a Stop already covered this request, or null (no saved pattern to send). */
 async start({patternLoop=true,preview={}}={}){
  const engine=this.engine,monitor=engine.monitor,armed=this.armed;
  const description=this.describe({patternLoop,preview});
  if(!description)return this.fallback('no-pattern');
  const body=description.body,requestId=this.claimRequestId(),started=performance.now();
  this.activeRequestId=requestId;
  // REST fallback: with this peer's client_id and the armed signature it starts the arm (or compiles when the arm is gone).
  const peer=engine.previewPeer?.()||{},startBody={...body,lead_sec:finite(preview.lead_sec)?preview.lead_sec:.025,phase_offset_sec:finite(preview.phase_offset_sec)?preview.phase_offset_sec:0,preview_request_id:requestId,gain:finite(preview.gain)?preview.gain:DEFAULT_GAIN,...peer,...(peer.client_id&&armed?.signature===description.signature?{armed_signature:armed.signature}:{})};
  const channelOpen=monitor.projectId===engine.projectId&&monitor.peer?.connectionState==='connected'&&monitor.control?.readyState==='open';
  if(armed&&armed.projectId===engine.projectId&&armed.signature===description.signature&&channelOpen){
   const message={type:'pattern_preview_start',key:'pattern',client_sent_ms:Date.now(),preview_request_id:requestId,armed_signature:armed.signature,phase_offset_sec:startBody.phase_offset_sec,repeat_count:body.repeat_count,gain:startBody.gain,lead_sec:finite(preview.lead_sec)?preview.lead_sec:START_LEAD_SEC};
   let ack=null;
   try{const sent=monitor.sendControl(message);ack=await this.waitForAck(sent.seq);}catch{ack=null;}
   if(ack&&!patternAckUnusable(ack)){
    this.stats.starts++;this.stats.lastStartMs=Math.round(performance.now()-started);
    clientLog('pattern-preview-armed-start',{ackMs:this.stats.lastStartMs,requestId});
    return {...ack,preview_request_id:ack.preview_request_id??requestId};
   }
   if(ack?.code==='stale_preview_request'){const floor=Number(ack.stopped_through_preview_request_id)||0;if(floor>this.requestId)this.requestId=floor;return {stopped:true,code:'stale_preview_request'};}
   if(ack?.code==='not_armed')this.armed=null;
   this.schedule('start-fallback',{immediate:true});
   this.fallback(ack?String(ack.code||'refused'):'ack-timeout');
  }else this.fallback(!armed?'not-armed':armed.signature!==description.signature?'signature-changed':'channel-closed');
  // Same request id over HTTP, direct to the project's engine (Default's httpFallback).
  const response=await freestyleHost().dawFetch('/patterns/preview',{method:'POST',body:JSON.stringify(startBody)},{projectId:engine.projectId,timeoutMs:15000});
  const text=await response.text().catch(()=>'');let data=null;try{data=JSON.parse(text);}catch{}
  if(!response.ok){
   if(data?.code==='stale_preview_request'){const floor=Number(data.stopped_through_preview_request_id)||0;if(floor>this.requestId)this.requestId=floor;return {stopped:true,code:'stale_preview_request'};}
   throw Object.assign(new Error(`patterns/preview ${response.status}: ${String(data?.error||data?.message||text).slice(0,160)}`),{status:response.status,code:data?.code});
  }
  this.stats.lastStartMs=Math.round(performance.now()-started);
  return {...data,preview_request_id:data?.preview_request_id??requestId};
 }
 /** Default-studio stop: pattern_preview_stop through the
  * newest claimed id on the control channel (instant), HTTP on a missed ack.
  * Mozart stops every preview up to that id and refuses any later start of
  * one, so a Play still in flight can never resurrect after Stop. */
 async stop(){
  const engine=this.engine,monitor=engine.monitor,requestId=Math.max(this.activeRequestId||0,this.requestId||0);
  const body={...(requestId>=1?{preview_request_id:requestId}:{}),...engine.previewPeer?.()};
  if(monitor.projectId===engine.projectId&&monitor.peer?.connectionState==='connected'&&monitor.control?.readyState==='open'){
   try{const sent=monitor.sendControl({type:'pattern_preview_stop',key:'pattern',client_sent_ms:Date.now(),preview_request_id:requestId});const ack=await this.waitForAck(sent.seq);if(ack&&ack.ok!==false)return ack;}catch{}
  }
  const response=await freestyleHost().dawFetch('/patterns/preview/stop',{method:'POST',body:JSON.stringify(body)},{projectId:engine.projectId,timeoutMs:8000});
  if(!response.ok)throw Object.assign(new Error(`patterns/preview/stop ${response.status}`),{status:response.status});
  return response.json().catch(()=>({ok:true}));
 }
 fallback(reason){this.stats.fallbacks++;this.stats.lastFallback=reason;clientLog('pattern-preview-armed-fallback',{reason});return null;}
 waitForAck(seq){
  const monitor=this.engine.monitor,projectId=this.engine.projectId;
  return new Promise(resolve=>{
   let timer=null;
   const done=value=>{clearTimeout(timer);monitor.removeEventListener('ack',onAck);monitor.removeEventListener('state',onState);resolve(value);};
   const onAck=event=>{const ack=event.detail;if(ack?.type!=='pattern_preview_ack'||Number(ack.seq)!==Number(seq)||String(ack.project_id||'')!==String(projectId))return;done(ack);};
   const onState=event=>{if(event.detail?.state!=='connected')done(null);};
   monitor.addEventListener('ack',onAck);monitor.addEventListener('state',onState);timer=setTimeout(()=>done(null),this.ackTimeoutMs);
  });
 }
 destroy(){clearTimeout(this.timer);clearTimeout(this.retryTimer);this.armed=null;}
}
