/** Agent-safe mixing (Studio API, 318 ops): the live mix revision.
 *
 * Freestyle publishes getEngineMix (mixRevision + ETag "mix-<n>"), a
 * waitEngineMix long-poll (if_none_match=<rev>, wait_ms ≤ 10000, at most 2
 * in flight per user) and an `expected_mix_revision` / If-Match guard on every
 * lane gain/pan/mute/solo, routing, master and bus write plus mix:apply. The
 * revision moves on EVERY mix change from any source, including direct Studio
 * fader moves and this client's own realtime `mozart-control` messages (which
 * carry no revision). So a change is attributed by VALUE, not by revision: a
 * changed control is ours when it equals a value this client recently sent
 * for that control; anything else is a person or another agent and is
 * repainted. A write is guarded by a fresh read's revision after checking the
 * target control was not changed by someone else, so the server's atomic
 * compare-and-set covers the remaining window (412 mix_revision_conflict).
 *
 * Gains are float32 on the engine (0.4 → 0.4000000059604645): every numeric
 * comparison uses a relative tolerance.
 */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=128;
const revisionValue=value=>Number.isSafeInteger(value)&&value>=0?value:null;

export const MIX_WAIT_MAX_MS=10000;
export const MIX_MAX_WAITS_IN_FLIGHT=2;
export const MIX_VALUE_TOLERANCE=1e-6;
export const MIX_CONFLICT_NOTICE='Mixer changed elsewhere — your change wasn’t applied';
export const PLUGIN_CONFLICT_NOTICE='Plugin changed elsewhere — your change wasn’t applied';

/** Relative tolerance (≈1e-6) for numbers; strict equality otherwise. */
export function mixValuesEqual(a,b,tolerance=MIX_VALUE_TOLERANCE){
 if(sendShaped(a)&&sendShaped(b))return a.preFader===b.preFader&&mixValuesEqual(a.level,b.level,tolerance);
 if(typeof a==='number'&&typeof b==='number')return finite(a)&&finite(b)&&Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(a),Math.abs(b));
 return a===b;
}
export function mixEtag(revision){const value=revisionValue(revision);return value===null?null:`"mix-${value}"`;}
export function parseMixEtag(tag){
 const match=/^(?:W\/)?"mix-(\d{1,16})"$/.exec(typeof tag==='string'?tag.trim():'');if(!match)return null;
 return revisionValue(Number(match[1]));
}
/** The mix revision a response reports: mixRevision / response.mix_revision /
 * an ETag "mix-<n>" (header or adapter metadata). Null when absent. */
export function mixRevisionOf(value,{etag}={}){
 const fromTag=parseMixEtag(etag);if(fromTag!==null)return fromTag;
 const queue=[{value,depth:0}],seen=new Set();
 while(queue.length){
  const {value:item,depth}=queue.shift();if(!record(item)||depth>5||seen.has(item))continue;seen.add(item);
  for(const key of ['mixRevision','mix_revision']){const found=revisionValue(item[key]);if(found!==null)return found;}
  const tagged=parseMixEtag(item._studioApi?.etag);if(tagged!==null)return tagged;
  for(const key of ['structuredContent','response','result','data'])if(record(item[key]))queue.push({value:item[key],depth:depth+1});
 }
 return null;
}
function errorDetails(error){
 const found=[];const visit=(value,depth)=>{if(!record(value)||depth>6)return;if(record(value.details))found.push(value.details);for(const key of ['error','result','data','structuredContent','response'])visit(value[key],depth+1);};
 if(record(error?.details))found.push(error.details);visit({result:error?.result,data:error?.data},0);return found;
}
function errorCode(error){
 if(typeof error?.code==='string')return error.code;
 for(const value of [error?.data?.error,error?.result?.error,error?.result])if(record(value)&&typeof value.code==='string')return value.code;
 if(typeof error?.result?.error==='string')return error.result.error;return null;
}
export function isMixRevisionConflict(error){return error?.mixRevisionConflict===true||errorCode(error)==='mix_revision_conflict';}
export function isPluginParameterConflict(error){return errorCode(error)==='plugin_parameter_conflict';}
export function conflictMixRevision(error){
 const direct=revisionValue(error?.currentMixRevision);if(direct!==null)return direct;
 for(const details of errorDetails(error)){const value=revisionValue(details.currentMixRevision??details.current_mix_revision);if(value!==null)return value;}return null;
}
export function pluginConflictValue(error){
 if(finite(error?.currentValueNorm))return error.currentValueNorm;
 for(const details of errorDetails(error)){const value=details.currentValueNorm??details.current_value_norm;if(finite(value)&&value>=0&&value<=1)return value;}return null;
}
/** A client-side refusal shaped like the server's 412: nothing was dispatched. */
export function mixConflictError(message=MIX_CONFLICT_NOTICE,extra={}){
 return Object.assign(new Error(message),{code:'mix_revision_conflict',status:412,stage:'precondition',dispatched:false,explicitRejection:true,mixRevisionConflict:true,...extra});
}

// ---- Aux sends (setLaneSend / deleteLaneSend) -------------------------------
// One send is a control `send:<bus_id>` of its lane whose value is
// {level, preFader} (linear level 0-2) or null when the lane has no send to
// that bus. getEngineMix reports them as tracks[].sends [{bus_id, level, pre_fader}].
const SEND_PREFIX='send:';
function sendShaped(value){return record(value)&&finite(value.level)&&typeof value.preFader==='boolean';}
export function isSendControl(control){return typeof control==='string'&&control.startsWith(SEND_PREFIX)&&identity(control.slice(SEND_PREFIX.length));}
export function sendControl(busId){return SEND_PREFIX+busId;}
export function sendControlBus(control){return isSendControl(control)?control.slice(SEND_PREFIX.length):null;}
/** One send row in any spelling (engine bus_id/pre_fader, REST busId/preFader) → {busId, level, preFader} or null. */
export function normalizeMixSend(raw){
 if(!record(raw))return null;const busId=raw.busId??raw.bus_id,level=raw.level,pre=raw.preFader??raw.pre_fader;
 if(!identity(busId)||busId==='master'||!finite(level)||level<0||level>2||(pre!==undefined&&typeof pre!=='boolean'))return null;
 return{busId,level,preFader:pre===true};
}
/** A sends array → normalized list, or null when it is missing or invalid (unknown, never "no sends"). */
export function normalizeMixSends(list){
 if(!Array.isArray(list))return null;const seen=new Set(),sends=[];
 for(const raw of list){const send=normalizeMixSend(raw);if(!send||seen.has(send.busId))return null;seen.add(send.busId);sends.push(send);}
 return sends;
}
/** {known, sends} of one lane in a getEngineMix body (known only when the engine reports its sends array). */
export function mixLaneSends(mix,laneId){
 const rows=laneRows(mix,laneId);if(rows.length!==1)return{known:false,sends:null};
 const sends=normalizeMixSends(rows[0].sends);return sends?{known:true,sends}:{known:false,sends:null};
}

// ---- Mix state -------------------------------------------------------------
const CONTROL_FIELDS={gain:'gain',pan:'pan',mute:'muted',solo:'soloed',route:'bus_id'};
export function mixControlKey(target,control){return JSON.stringify([target?.kind,target?.id,control]);}
function laneRows(mix,laneId){return (Array.isArray(mix?.tracks)?mix.tracks:[]).filter(track=>record(track)&&track.db_track_id===laneId);}
function busRows(mix,busId){return (Array.isArray(mix?.buses)?mix.buses:[]).filter(bus=>record(bus)&&(bus.bus_id??bus.id)===busId);}
/** {known,value} of one control in a getEngineMix body. */
export function mixControlValue(mix,target,control){
 if(!record(mix)||!record(target))return{known:false,value:null};
 if(isSendControl(control)){if(target.kind!=='lane')return{known:false,value:null};const read=mixLaneSends(mix,target.id);if(!read.known)return{known:false,value:null};const busId=sendControlBus(control),send=read.sends.find(item=>item.busId===busId);return{known:true,value:send?{level:send.level,preFader:send.preFader}:null};}
 // 338: masterPan / bus pan are live engine state (not saved with the project).
 if(target.kind==='bus'&&target.id==='master'){const value=control==='gain'?mix.masterGain:control==='pan'?mix.masterPan:undefined,valid=control==='gain'?finite(value)&&value>=0:control==='pan'?finite(value)&&value>=-1&&value<=1:false;return valid?{known:true,value}:{known:false,value:null};}
 const field=CONTROL_FIELDS[control],rows=target.kind==='lane'?laneRows(mix,target.id):target.kind==='bus'?busRows(mix,target.id):[];
 if(!field||rows.length!==1||!Object.hasOwn(rows[0],field))return{known:false,value:null};
 const value=rows[0][field],valid=control==='gain'?finite(value)&&value>=0:control==='pan'?finite(value)&&value>=-1&&value<=1:control==='route'?identity(value):typeof value==='boolean';
 return valid?{known:true,value}:{known:false,value:null};
}
/** Every reported control of a mix body as key → {target,control,value}. */
export function mixControls(mix){
 const controls=new Map();if(!record(mix))return controls;
 const add=(target,control)=>{const read=mixControlValue(mix,target,control);if(read.known)controls.set(mixControlKey(target,control),{target,control,value:read.value});};
 add({kind:'bus',id:'master'},'gain');add({kind:'bus',id:'master'},'pan');
 for(const track of Array.isArray(mix.tracks)?mix.tracks:[])if(identity(track?.db_track_id)){for(const control of ['gain','pan','mute','solo','route'])add({kind:'lane',id:track.db_track_id},control);for(const send of normalizeMixSends(track.sends)||[])add({kind:'lane',id:track.db_track_id},sendControl(send.busId));}
 for(const bus of Array.isArray(mix.buses)?mix.buses:[]){const id=bus?.bus_id??bus?.id;if(identity(id)&&id!=='master')for(const control of ['gain','pan','mute','solo'])add({kind:'bus',id},control);}
 return controls;
}
/** Controls whose value differs (with tolerance) between two mix bodies. */
export function diffMix(before,after){
 const previous=mixControls(before),next=mixControls(after),changes=[];
 for(const [key,entry]of next){const old=previous.get(key);if(!old||!mixValuesEqual(old.value,entry.value))changes.push({key,target:entry.target,control:entry.control,before:old?old.value:undefined,after:entry.value});}
 // A removed send: the lane still reports its sends array, without that bus.
 for(const [key,old]of previous)if(isSendControl(old.control)&&!next.has(key)&&mixControlValue(after,old.target,old.control).known)changes.push({key,target:old.target,control:old.control,before:old.value,after:null});
 return changes;
}
/** Saved lanes that carry pattern placements ("pattern lanes"). Since the 338
 * release their mute/solo reach the lane's engine track (getEngineMix reflects
 * them; updateLane with a mix If-Match applies and saves them), and since 339
 * mix:apply carries them atomically too (one multi-lane M/S step). */
export function patternLaneIds(...sources){
 const ids=new Set();
 for(const source of sources){const rows=Array.isArray(source)?source:Array.isArray(source?.placements)?source.placements:null;if(!rows)continue;for(const row of rows){const id=row?.laneId??row?.lane_id??row?.cloudRaw?.laneId;if(identity(id))ids.add(id);}}
 return ids;
}
/** The live engine values of one saved lane, for display (when the lane is an
 * engine track). Pattern lanes included: their mute/solo is engine-track state
 * since the 338 release. */
export function liveLaneValues(mix,laneId){
 const values={};if(!record(mix)||!identity(laneId))return values;
 for(const control of ['gain','pan','mute','solo']){const read=mixControlValue(mix,{kind:'lane',id:laneId},control);if(read.known)values[control]=read.value;}
 return values;
}
/** Return a copy of `mix` with our acknowledged `changes` applied. */
export function patchMix(mix,changes,revision){
 if(!record(mix))return mix;const next=structuredClone(mix);
 for(const change of changes||[]){
  const target=change?.target,field=CONTROL_FIELDS[change?.control];if(!record(target)||!field&&!isSendControl(change?.control))continue;
  if(target.kind==='bus'&&target.id==='master'){if(change.control==='gain')next.masterGain=change.value;else if(change.control==='pan')next.masterPan=change.value;continue;}
  if(isSendControl(change?.control)){if(target.kind!=='lane')continue;const lanes=laneRows(next,target.id);if(lanes.length!==1||!Array.isArray(lanes[0].sends))continue;const busId=sendControlBus(change.control),list=lanes[0].sends.filter(send=>(send?.bus_id??send?.busId)!==busId),value=change.value;if(sendShaped(value)){const at=lanes[0].sends.findIndex(send=>(send?.bus_id??send?.busId)===busId),row={bus_id:busId,level:value.level,pre_fader:value.preFader};if(at>=0&&at<=list.length)list.splice(at,0,row);else list.push(row);}lanes[0].sends=list;continue;}
  const rows=target.kind==='lane'?laneRows(next,target.id):target.kind==='bus'?busRows(next,target.id):[];if(rows.length===1)rows[0][field]=change.value;
 }
 if(revision!=null)next.mixRevision=revision;return next;
}
export function validEngineMix(data,projectId){
 return record(data)&&(data.projectId==null||data.projectId===projectId)&&Array.isArray(data.tracks)&&Array.isArray(data.buses)&&(data.mixRevision===null||revisionValue(data.mixRevision)!==null);
}

/** One live-mix revision per project: seeded by getEngineMix, advanced by our
 * own write receipts and a single waitEngineMix long-poll loop. */
export class MixRevisionTracker{
 constructor({client,onExternalChange=()=>{},onChange=()=>{},onMix=()=>{},waitMs=MIX_WAIT_MAX_MS,maxInFlight=MIX_MAX_WAITS_IN_FLIGHT,backoffMs=1000,maxBackoffMs=30000,ownTtlMs=30000,abortGraceMs=1000,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=timer=>clearTimeout(timer),now=()=>Date.now()}={}){
  if(typeof client?.call!=='function')throw new TypeError('The mix revision tracker needs the generated Studio API client.');
  Object.assign(this,{client,onExternalChange,onChange,onMix,waitMs:Math.max(0,Math.min(MIX_WAIT_MAX_MS,Math.floor(waitMs))),maxInFlight:Math.max(1,Math.min(MIX_MAX_WAITS_IN_FLIGHT,maxInFlight)),backoffMs,maxBackoffMs,ownTtlMs,abortGraceMs,setTimer,clearTimer,now});
  this.projectId=null;this.revision=null;this.mix=null;this.supported=null;this.generation=0;this.inFlight=0;this.maxObservedInFlight=0;this.failures=0;this.running=false;this.lastError=null;
  this.own=new Map();this.timers=new Set();this.controllers=new Set();this.stats={waits:0,notModified:0,changes:0,external:0,errors:0};
 }
 get ifMatch(){return mixEtag(this.revision);}
 /** True when writes for this project can carry a mix revision. */
 available(projectId=this.projectId){return !!projectId&&projectId===this.projectId&&this.supported!==false&&this.revision!==null;}
 snapshot(){return{projectId:this.projectId,revision:this.revision,supported:this.supported,running:this.running,inFlight:this.inFlight,failures:this.failures,lastError:this.lastError,stats:{...this.stats}};}
 notify(){try{this.onChange(this.snapshot());}catch{}}
 /** The live mix body changed (adopted read/wait or our acknowledged write). */
 mixChanged(){try{this.onMix(this.mix,{projectId:this.projectId,revision:this.revision});}catch{}}
 timer(fn,ms){let handle;const wrapped=()=>{this.timers.delete(handle);fn();};handle=this.setTimer(wrapped,ms);this.timers.add(handle);return handle;}
 sleep(ms,generation){return new Promise(resolve=>{if(generation!==this.generation)return resolve();this.timer(resolve,ms);});}
 /** Start (or keep) the single long-poll loop for a project. */
 start(projectId){
  if(!identity(projectId))return this.stop();
  if(this.running&&this.projectId===projectId)return;
  this.stop();this.projectId=projectId;this.running=true;const generation=++this.generation;this.notify();
  this.loop(generation).finally(()=>{if(generation===this.generation){this.running=false;this.notify();}});
 }
 /** Stop the loop and forget the project (project change, disconnect). */
 stop(){
  this.generation++;this.running=false;for(const controller of this.controllers)try{controller.abort();}catch{}this.controllers.clear();
  for(const handle of this.timers)this.clearTimer(handle);this.timers.clear();
  const had=!!this.mix;this.projectId=null;this.revision=null;this.mix=null;this.supported=null;this.failures=0;this.own.clear();this.notify();if(had)this.mixChanged();
 }
 /** Remember a value this client sent (realtime or REST) for one control. */
 noteOwn(target,control,value,{realtime=false}={}){
  if(!record(target)||value===undefined||value===null&&!isSendControl(control))return;const key=mixControlKey(target,control),now=this.now();
  const list=(this.own.get(key)||[]).filter(entry=>now-entry.at<=this.ownTtlMs);list.push({value,at:now,...realtime?{realtime:true,target:{kind:target.kind,id:target.id},control}:{}});if(list.length>64)list.splice(0,list.length-64);this.own.set(key,list);
 }
 /** True while one of our realtime (mozart-control) sends has not been seen in
  * the adopted mix yet: such a send moved the live revision, so the held one
  * is known to be stale and a write would only meet a 412. */
 ownPending(){
  if(!this.mix)return false;const now=this.now();
  for(const list of this.own.values()){const last=list.at(-1);if(!last?.realtime||now-last.at>this.ownTtlMs)continue;const read=mixControlValue(this.mix,last.target,last.control);if(read.known&&!mixValuesEqual(read.value,last.value))return true;}
  return false;
 }
 ownExplains(key,value){const now=this.now(),list=this.own.get(key)||[];return list.some(entry=>now-entry.at<=this.ownTtlMs&&mixValuesEqual(entry.value,value));}
 /** Changes from the current baseline that this client did not cause. */
 external(next){return this.mix?diffMix(this.mix,next).filter(change=>!this.ownExplains(change.key,change.after)):[];}
 /** Accept a full mix body as the new baseline; report others' changes. */
 adopt(mix,{source='read',etag=null}={}){
  if(!validEngineMix(mix,this.projectId))return[];
  const revision=revisionValue(mix.mixRevision)??parseMixEtag(etag);
  // A body older than the revision we hold (a wait answered before our own
  // acknowledged write landed) would paint a superseded value back.
  if(revision!==null&&this.revision!==null&&revision<this.revision)return[];
  const external=this.external(mix);
  this.mix=mix;if(revision!==null)this.revision=revision;
  if(mix.mixRevision===null&&revision===null)this.supported=false;else if(revision!==null)this.supported=true;
  if(external.length){this.stats.external++;try{this.onExternalChange({projectId:this.projectId,revision:this.revision,mix,changes:external,source});}catch{}}
  this.notify();this.mixChanged();return external;
 }
 /** A write receipt advances the held revision. With the acknowledged
  * `changes` and a receipt exactly one step past the revision the write was
  * guarded by, nothing else can have happened in between: the held mix body is
  * patched too, so the next write needs no read and the view shows the value. */
 noteWrite(result,changes=null,{expected=null}={}){
  const revision=mixRevisionOf(result?.data??result,{etag:result?.etag});
  if(revision!==null&&(this.revision===null||revision>this.revision)){
   const exact=Array.isArray(changes)&&changes.length&&this.mix&&expected!==null&&revision===expected+1&&this.revision===expected;
   this.revision=revision;if(exact){for(const change of changes)this.noteOwn(change.target,change.control,change.value);this.mix=patchMix(this.mix,changes,revision);}
   this.notify();if(exact)this.mixChanged();
  }
  return revision;
 }
 /** A mozart-control acknowledgement of one of OUR realtime set_track_* sends
  * that echoes the mix revision it produced (338). When it is exactly one step
  * past the held revision nothing else happened in between: the held mix is
  * patched and advanced, so the next guarded write needs no getEngineMix read.
  * A larger jump means someone else changed the mix too; the long-poll adopts
  * that (and ownPending keeps forcing one read until it does). */
 noteRealtimeAck(ack){
  const revision=revisionValue(ack?.mixRevision);if(revision===null||!record(ack?.target)||!ack.control||ack.value===undefined)return false;
  if(ack.projectId!=null&&ack.projectId!==this.projectId)return false;
  if(this.revision===null||!this.mix||revision<=this.revision)return false;
  if(revision!==this.revision+1){this.stats.ackGaps=(this.stats.ackGaps||0)+1;return false;}
  const change={target:ack.target,control:ack.control,value:ack.value};this.noteOwn(change.target,change.control,change.value);
  this.mix=patchMix(this.mix,[change],revision);this.revision=revision;this.stats.acks=(this.stats.acks||0)+1;this.notify();this.mixChanged();return true;
 }
 async read({projectId=this.projectId,signal}={}){
  if(!identity(projectId))throw mixConflictError('Load a Studio API project before reading its mix.',{code:'mix_scope_changed',mixRevisionConflict:false});
  const result=await this.client.call('getEngineMix',{path:{project_id:projectId}},signal?{signal}:{});
  if(!validEngineMix(result?.data,projectId))throw Object.assign(new Error('Freestyle returned an incomplete live mix.'),{code:'mix_read_invalid'});
  return{mix:result.data,revision:revisionValue(result.data.mixRevision)??parseMixEtag(result.etag),etag:result.etag??null};
 }
 /** Fresh read (adopted as the baseline) and adoption of other people's changes. */
 async refresh({source='read'}={}){
  const projectId=this.projectId,generation=this.generation,fresh=await this.read({projectId});
  if(generation!==this.generation||projectId!==this.projectId)throw Object.assign(new Error('The project changed while reading its mix.'),{name:'AbortError',code:'mix_scope_changed'});
  return{...fresh,external:this.adopt(fresh.mix,{source,etag:fresh.etag})};
 }
 /** Pre-write check for `changes` [{target,control,value}]: a fresh read,
  * refusing (412-shaped, not dispatched) when someone else changed one of
  * the target controls. Returns the revision to send as expected_mix_revision. */
 async guard(changes,{projectId=this.projectId}={}){
  if(!this.available(projectId))return null;
  const {revision,external}=await this.refresh({source:'guard'}),keys=new Set(changes.map(change=>mixControlKey(change.target,change.control)));
  const touched=external.filter(change=>keys.has(change.key));
  if(touched.length)throw mixConflictError(MIX_CONFLICT_NOTICE,{currentMixRevision:revision,changes:touched});
  for(const change of changes)this.noteOwn(change.target,change.control,change.value);
  return revision;
 }
 /** After a 412: adopt the server mix. `explained` is true when every change
  * since our baseline was ours (our own realtime messages moved the revision). */
 async resolveConflict(error){
  try{const {external,revision}=await this.refresh({source:'conflict'});return{explained:external.length===0,revision};}
  catch(failure){const revision=conflictMixRevision(error);if(revision!==null&&(this.revision===null||revision>this.revision))this.revision=revision;return{explained:false,revision:this.revision,error:failure};}
 }
 async waitOnce(generation,revision){
  const controller=typeof AbortController==='function'?new AbortController():null,started=this.now();let aborted=false;
  if(controller){this.controllers.add(controller);controller.signal.addEventListener?.('abort',()=>{aborted=true;});}
  this.inFlight++;this.maxObservedInFlight=Math.max(this.maxObservedInFlight,this.inFlight);this.stats.waits++;
  try{return await this.client.call('waitEngineMix',{path:{project_id:this.projectId},query:{if_none_match:revision,wait_ms:this.waitMs}},controller?{signal:controller.signal}:{});}
  finally{
   if(controller)this.controllers.delete(controller);
   // An aborted fetch settles at once, but the upstream wait can still hold its
   // slot until wait_ms passes: keep counting it so we never exceed 2.
   if(aborted){const hold=Math.max(0,started+this.waitMs+this.abortGraceMs-this.now());if(hold>0){const handle=this.setTimer(()=>{this.inFlight--;},hold);void handle;}else this.inFlight--;}
   else this.inFlight--;
  }
 }
 async loop(generation){
  let delay=0;
  while(generation===this.generation){
   if(delay>0){await this.sleep(delay,generation);if(generation!==this.generation)return;delay=0;}
   try{
    if(this.revision===null){
     const fresh=await this.read({projectId:this.projectId});if(generation!==this.generation)return;
     this.adopt(fresh.mix,{source:'seed',etag:fresh.etag});this.failures=0;this.lastError=null;
     if(fresh.revision===null){this.supported=false;this.notify();return;}
     continue;
    }
    if(this.inFlight>=this.maxInFlight){delay=250;continue;}
    const result=await this.waitOnce(generation,this.revision);if(generation!==this.generation)return;
    this.failures=0;this.lastError=null;
    if(result?.status===304){this.stats.notModified++;const tagged=parseMixEtag(result.etag);if(tagged!==null&&tagged>this.revision)this.revision=tagged;continue;}
    if(!validEngineMix(result?.data,this.projectId))throw Object.assign(new Error('Freestyle returned an incomplete live mix.'),{code:'mix_read_invalid'});
    this.stats.changes++;this.adopt(result.data,{source:'wait',etag:result.etag});
   }catch(error){
    if(generation!==this.generation||error?.name==='AbortError')return;
    this.stats.errors++;this.lastError={code:error?.code??null,status:error?.status??null,message:String(error?.message||error).slice(0,200)};this.notify();
    if(error?.status===409&&error?.code==='engine_update_required'){this.supported=false;this.notify();return;}
    if([400,401,403,404].includes(error?.status))return;
    this.failures++;delay=Math.min(this.maxBackoffMs,this.backoffMs*2**Math.min(10,this.failures-1));
    const retryAfter=Number(error?.retryAfter);if(error?.status===429&&Number.isFinite(retryAfter)&&retryAfter>0)delay=Math.max(delay,Math.min(this.maxBackoffMs,retryAfter*1000));
   }
  }
 }
}
