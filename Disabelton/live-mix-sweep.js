/** Audible mixer drags for the controls that have no `mozart-control` message.
 *
 * Lane gain, mute and solo have realtime data-channel messages (cloud-live-control.js).
 * Lane pan, bus gain/pan and master gain/pan do not, but the public Studio API documents a
 * live sweep for them: the same PUT as the saved write with `persist:false` ("false while
 * sweeping (live only), then a final call without it"); bus and master pan are live only.
 * This sends those sweeps while a control is dragged:
 *  - one request in flight per control, the latest value wins (older ones are never sent);
 *  - at most one request per `intervalMs`;
 *  - `finish(key)` drops the queued value and resolves when the request in flight has
 *    settled, so the ONE persisted write on release is always the last thing the engine
 *    hears for that control;
 *  - a failed sweep (no running engine, a conflict) stops that control's sweeps until the
 *    gesture ends. Nothing is retried and nothing is saved here: undo history only ever
 *    sees the release.
 * No audio processing, no timers of its own beyond the injected ones. */
export const LIVE_MIX_SWEEP_INTERVAL_MS=50;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** The documented live request for one swept control, or null when there is none.
 * target: {kind:'lane'|'bus',id} (the master output is the bus with id 'master'). */
export function liveMixSweepRequest(projectId,target,control,value){
 if(!identity(projectId)||!target||!identity(target.id)||!finite(value)||!['gain','pan'].includes(control))return null;
 const master=target.kind==='bus'&&target.id==='master';if(target.kind!=='lane'&&target.kind!=='bus')return null;
 const amount=control==='pan'?clamp(value,-1,1):clamp(value,0,4);
 const path={project_id:projectId},body={[control]:amount};
 let operationId;
 if(master){operationId=control==='gain'?'setMasterGain':'setMasterPan';}
 else if(target.kind==='bus'){operationId=control==='gain'?'setBusGain':'setBusPan';path.bus_id=target.id;}
 else{operationId=control==='gain'?'setLaneGain':'setLanePan';path.lane_id=target.id;}
 // Bus and master pan are live-only operations without a persist flag.
 if(!['setBusPan','setMasterPan'].includes(operationId))body.persist=false;
 return{operationId,path,body,target:{kind:target.kind,id:target.id},control,value:amount};
}
export const liveMixSweepKey=(target,control)=>JSON.stringify([target?.kind,target?.id,control]);

export class LiveMixSweep{
 /** send(request) performs one live request and resolves or rejects when it settles. */
 constructor({send,intervalMs=LIVE_MIX_SWEEP_INTERVAL_MS,now=()=>globalThis.performance?.now?.()??Date.now(),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=timer=>clearTimeout(timer),onSent=()=>{},onError=()=>{}}={}){
  if(typeof send!=='function')throw new TypeError('A live mix sweep needs a send function.');
  Object.assign(this,{send,intervalMs,now,setTimer,clearTimer,onSent,onError});this.entries=new Map();this.stats={sent:0,coalesced:0,failed:0,last:null};
 }
 entry(key){let entry=this.entries.get(key);if(!entry){entry={key,inFlight:null,pending:null,timer:null,lastAt:-Infinity,failed:false,done:false};this.entries.set(key,entry);}return entry;}
 /** Latest value for one control: 'sent' (request started), 'queued' (it replaces any queued value) or false (this gesture's sweeps stopped after a failure). */
 set(key,request){
  if(typeof key!=='string'||!key||!request)return false;const entry=this.entry(key);
  if(entry.done){entry.done=false;entry.failed=false;}// a new gesture while the previous one's last request settles
  if(entry.failed)return false;
  if(entry.inFlight||entry.timer!==null){if(entry.pending)this.stats.coalesced++;entry.pending=request;return'queued';}
  const wait=this.intervalMs-(this.now()-entry.lastAt);
  if(wait>0){entry.pending=request;entry.timer=this.setTimer(()=>{entry.timer=null;this.pump(entry);},wait);return'queued';}
  this.start(entry,request);return'sent';
 }
 start(entry,request){
  entry.lastAt=this.now();this.stats.sent++;this.stats.last={key:entry.key,value:request.value,at:entry.lastAt};
  let sending;try{sending=Promise.resolve(this.send(request));}catch(error){sending=Promise.reject(error);}
  entry.inFlight=sending.then(result=>{try{this.onSent(request,result);}catch{}},error=>{if(!entry.done){entry.failed=true;entry.pending=null;}this.stats.failed++;try{this.onError(error,request);}catch{}}).then(()=>{entry.inFlight=null;this.pump(entry);});
 }
 pump(entry){
  if(entry.inFlight||entry.timer!==null)return;
  // An idle control keeps its last send time (the throttle) until its gesture is finished.
  if(!entry.pending){if(entry.done&&this.entries.get(entry.key)===entry)this.entries.delete(entry.key);return;}
  const wait=this.intervalMs-(this.now()-entry.lastAt);
  if(wait>0){entry.timer=this.setTimer(()=>{entry.timer=null;this.pump(entry);},wait);return;}
  const request=entry.pending;entry.pending=null;this.start(entry,request);
 }
 /** True while a sweep for this control is queued or in flight. */
 active(key){const entry=this.entries.get(key);return !!entry&&(!!entry.inFlight||!!entry.pending||entry.timer!==null);}
 /** End the gesture for one control: nothing queued is sent any more. Returns null when
  * nothing is in flight, else a promise that resolves (never rejects) once it has settled. */
 finish(key){
  const entry=this.entries.get(key);if(!entry)return null;
  entry.pending=null;if(entry.timer!==null){this.clearTimer(entry.timer);entry.timer=null;}
  entry.failed=false;entry.done=true;const settling=entry.inFlight;
  if(!settling){this.entries.delete(key);return null;}
  return settling;
 }
 /** Drop every queued value (project change, teardown). Requests in flight are left to settle. */
 clear(){for(const key of [...this.entries.keys()])this.finish(key);}
}
