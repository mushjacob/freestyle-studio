/** Realtime gesture controls over the monitor peer's ordered `mozart-control`
 * channel, mirroring the working Studio Pro client:
 *  - lane gain   {type:'set_track_gain',track_id:-1,lane_id,gain}           key `gain:<lane>`
 *  - lane mute   {type:'set_track_muted',track_id:-1,lane_id,muted}         key `mute:<lane>`
 *  - lane solo   {type:'set_track_soloed',track_id:-1,lane_id,soloed}       key `solo:<lane>`
 *  - lane plugin {type:'set_plugin_param',lane_id,plugin_index,parameter_index,value_norm,
 *                 expected_plugin_type,expected_plugin_instance_id}          key `plugin:<lane>:<slot>:<param>`
 * CloudMonitor.sendControl adds project_id, seq, control_route and sent_at_ms.
 * Durable lane IDs are the identity; runtime numeric track IDs are never
 * promoted (Pro also sends track_id:-1 with lane_id when it has no binding).
 *
 * Each key is latest-value-wins and throttled (leading edge, then one trailing
 * send per interval). A send is bound to the project and peer generation that
 * were current when the gesture started plus an optional caller validity check
 * (e.g. the exact plugin instance); anything stale is dropped, never redirected.
 * A socket send is NOT an acknowledgement: callers persist with their typed
 * REST write after release and confirm from that response. Pro has no data-channel
 * contract for pan, master or bus controls, so none is invented here.
 *
 * 339 (documented, freestyle.audio/docs/realtime.html): an ack is
 * {"type":"ack","id","status","revision","mix_revision"?,"into"?,…}; mix
 * commands carry mix_revision, and acks NEVER carry seq (seq numbers only
 * clock and meter frames): match acks by id. Each set_track_* send therefore
 * carries its own id; `acknowledge` matches an applied ack by that id (a
 * coalesced one just retires its id: the newer command's ack carries the
 * revision) and the mix tracker adopts it without a getEngineMix read.
 */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const id=value=>typeof value==='string'&&value.trim().length>0&&value.length<=128;
export const LIVE_CONTROL_INTERVAL_MS=33;

export function liveLaneGainMessage(laneId,gain){
 if(!id(laneId)||!finite(gain))return null;
 return{type:'set_track_gain',track_id:-1,lane_id:laneId,gain:Math.max(0,Math.min(4,gain))};
}
export function liveLaneToggleMessage(laneId,control,value){
 if(!id(laneId)||typeof value!=='boolean'||!['mute','solo'].includes(control))return null;
 return control==='mute'?{type:'set_track_muted',track_id:-1,lane_id:laneId,muted:value}:{type:'set_track_soloed',track_id:-1,lane_id:laneId,soloed:value};
}
export function livePluginParameterMessage({laneId,pluginIndex,parameterIndex,valueNorm,pluginType='',instanceId}={}){
 if(!id(laneId)||!Number.isInteger(pluginIndex)||pluginIndex<0||!Number.isInteger(parameterIndex)||parameterIndex<0||!finite(valueNorm)||valueNorm<0||valueNorm>1||!id(instanceId))return null;
 return{type:'set_plugin_param',lane_id:laneId,plugin_index:pluginIndex,parameter_index:parameterIndex,value_norm:valueNorm,expected_plugin_type:String(pluginType||'').toLowerCase(),expected_plugin_instance_id:instanceId};
}
const TRACK_FIELDS={set_track_gain:['gain','gain'],set_track_muted:['mute','muted'],set_track_soloed:['solo','soloed']};
const revisionOf=value=>{for(const key of ['mix_revision','mixRevision']){const found=value?.[key];if(Number.isSafeInteger(found)&&found>=0)return found;}return null;};
/** {id,status,data} of a documented ack frame, or null. */
export function liveControlAckReference(data){
 if(!data||typeof data!=='object'||Array.isArray(data)||data.type!=='ack'||typeof data.id!=='string'||!data.id)return null;
 return{id:data.id,status:typeof data.status==='string'?data.status:null,data};
}
const commandId=()=>globalThis.crypto?.randomUUID?.()||`live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const liveControlKey=message=>!message?'':message.type==='set_plugin_param'?`plugin:${message.lane_id}:${message.plugin_index}:${message.parameter_index}`:`${{set_track_gain:'gain',set_track_muted:'mute',set_track_soloed:'solo'}[message.type]}:${message.lane_id}`;

export class CloudLiveControl{
 constructor({monitor,getProjectId=()=>monitor?.projectId,intervalMs=LIVE_CONTROL_INTERVAL_MS,now=()=>globalThis.performance?.now?.()??Date.now(),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=timer=>clearTimeout(timer)}={}){
  Object.assign(this,{monitor,getProjectId,intervalMs,now,setTimer,clearTimer});this.entries=new Map();this.observers=new Set();this.stats={sent:0,dropped:0,last:null,acks:0};this.sent=[];
 }
 /** Our sent set_track_* message an engine ack names, as a mix change
  * {projectId,target,control,value,mixRevision}; null for anything else. */
 acknowledge(data){
  const reference=liveControlAckReference(data);if(!reference)return null;
  const index=this.sent.findIndex(item=>item.id===reference.id);if(index<0)return null;
  // pending: still running (keep waiting); coalesced: a newer send replaced it (its own ack follows).
  if(reference.status==='pending')return null;
  const [item]=this.sent.splice(index,1);if(reference.status!=='applied')return null;
  const revision=revisionOf(reference.data);if(revision===null)return null;const [control,field]=TRACK_FIELDS[item.message.type];this.stats.acks++;
  return{projectId:item.projectId,target:{kind:'lane',id:item.message.lane_id},control,value:item.message[field],mixRevision:revision,id:item.id};
 }
 /** Observe every valid set() message (live automation recording). Returns the unsubscribe function; observer errors never reach the control path. */
 observe(observer){if(typeof observer!=='function')return()=>{};this.observers.add(observer);return()=>this.observers.delete(observer);}
 /** The project/peer generation a gesture is bound to, or null when no open channel serves the current project. */
 scope(){
  const m=this.monitor,projectId=String(this.getProjectId?.()||'');
  if(!m||typeof m.sendControl!=='function'||!projectId||String(m.projectId||'')!==projectId||m.peer?.connectionState!=='connected'||m.control?.readyState!=='open')return null;
  return{projectId,generation:m.generation??null,peer:m.peer,control:m.control};
 }
 current(scope){const now=this.scope();return!!scope&&!!now&&now.projectId===scope.projectId&&now.generation===scope.generation&&now.peer===scope.peer&&now.control===scope.control;}
 /** Queue the latest value for message's key. Returns 'sent', 'queued', 'unavailable' (use REST) or 'invalid'. */
 set(message,{scope=this.scope(),valid=null}={}){
  const key=liveControlKey(message);if(!key)return'invalid';
  for(const observer of this.observers)try{observer(message);}catch{}
  if(!scope||!this.current(scope)){this.cancel(key);return'unavailable';}
  const entry=this.entries.get(key)||{key,lastSentAt:-Infinity,timer:null};entry.message={...message,key};entry.scope=scope;entry.valid=valid;this.entries.set(key,entry);
  const wait=entry.lastSentAt+this.intervalMs-this.now();
  if(wait<=0)return this.send(entry);
  if(entry.timer==null)entry.timer=this.setTimer(()=>{entry.timer=null;if(this.entries.get(key)===entry&&entry.message)this.send(entry);},Math.ceil(wait));
  return'queued';
 }
 /** Send a key's pending value immediately (gesture release). */
 flush(key){const entry=this.entries.get(key);if(!entry?.message)return null;if(entry.timer!=null){this.clearTimer(entry.timer);entry.timer=null;}return this.send(entry);}
 cancel(key){const entry=this.entries.get(key);if(!entry)return;if(entry.timer!=null)this.clearTimer(entry.timer);this.entries.delete(key);}
 cancelAll(){for(const key of [...this.entries.keys()])this.cancel(key);}
 send(entry){
  const message=entry.message;entry.message=null;
  let valid=this.current(entry.scope);if(valid&&entry.valid)try{valid=entry.valid()!==false;}catch{valid=false;}
  if(!valid){this.stats.dropped++;this.stats.last={key:entry.key,status:'stale'};this.cancel(entry.key);return'unavailable';}
  // A mix command carries its own id: its documented ack is matched by that id (never seq).
  const id=TRACK_FIELDS[message.type]?commandId():null,outgoing=id?{...message,id}:message;
  try{const receipt=this.monitor.sendControl(outgoing);entry.lastSentAt=this.now();this.stats.sent++;if(id){this.sent.push({id,peer:entry.scope.peer,projectId:entry.scope.projectId,message:{type:message.type,lane_id:message.lane_id,[TRACK_FIELDS[message.type][1]]:message[TRACK_FIELDS[message.type][1]]}});if(this.sent.length>64)this.sent.splice(0,this.sent.length-64);}this.stats.last={key:entry.key,status:'sent',seq:receipt?.seq??null,acknowledged:false};return'sent';}
  catch(error){this.stats.dropped++;this.stats.last={key:entry.key,status:'failed',error:error.message};this.cancel(entry.key);return'unavailable';}
 }
}
