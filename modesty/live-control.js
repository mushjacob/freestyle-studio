/** Realtime fader / plug-in values WHILE a control is being dragged.
 *
 * Public contract (https://freestyle.audio/docs/realtime.html, "Transport and mixer on mozart-control"): the
 * monitoring peer's ordered `mozart-control` data channel accepts
 *   {type:"set_track_gain",  lane_id, gain}                                             key "gain:<lane_id>"   (linear 0..4)
 *   {type:"set_plugin_param", lane_id, plugin_index, parameter_index, value_norm,
 *    expected_plugin_type?}                                                             key "param:<lane>:<slot>:<index>"
 * Every message carries project_id, a `key` (one ordering lane) and a `seq` that increases per key; the engine
 * drops a message whose seq is not newer, so a late packet never overwrites a newer drag position. These
 * messages change the live engine at once, have no ack and are NOT saved: when the gesture ends the final value
 * goes through the REST route once (setLaneGain / setLanePluginParameter), which saves it and records history.
 *
 * Pan, bus and master level have no data-channel message; MixSync covers those with REST (see mix-sync.js).
 * Nothing here touches audio in the browser: the engine applies the value and the WebRTC stream carries the result.
 */
export const LIVE_INTERVAL_MS=33;   // ≈30 Hz, coalesced per key: the latest value wins

export class LiveControl{
  /** monitor: a CloudMonitor or a function returning the current one. projectId: function returning the open project id. */
  constructor({monitor,projectId=()=>null,intervalMs=LIVE_INTERVAL_MS,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),now=()=>globalThis.performance?.now?.()??Date.now()}={}){
    Object.assign(this,{monitorSource:monitor,projectId,intervalMs,setTimer,clearTimer,now});
    this.sentAt=new Map();this.pending=new Map();this.timers=new Map();this.stats={sent:0,coalesced:0,failed:0};this.log=[];
  }
  monitor(){return typeof this.monitorSource==='function'?this.monitorSource():this.monitorSource;}
  /** The channel is usable only on a connected peer that monitors the project being edited. */
  available(){
    const monitor=this.monitor(),projectId=this.projectId?.();
    return !!monitor&&typeof monitor.sendControl==='function'&&monitor.peer?.connectionState==='connected'&&monitor.control?.readyState==='open'&&(!projectId||!monitor.projectId||monitor.projectId===projectId);
  }
  transmit(key,message){
    try{const result=this.monitor().sendControl({...message,key,client_sent_ms:Date.now()});this.sentAt.set(key,this.now());this.stats.sent++;this.log.push({key,type:message.type,seq:result?.seq,at:this.now()});if(this.log.length>200)this.log.shift();return true;}
    catch{this.stats.failed++;return false;}
  }
  /** Throttled send. Returns false when there is no open channel (the caller then uses its REST path). */
  send(key,message){
    if(!this.available())return false;
    const wait=this.intervalMs-(this.now()-(this.sentAt.get(key)??-Infinity));
    if(wait<=0&&!this.timers.has(key))return this.transmit(key,message);
    if(this.pending.has(key))this.stats.coalesced++;
    this.pending.set(key,message);
    if(!this.timers.has(key))this.timers.set(key,this.setTimer(()=>{this.timers.delete(key);this.flush(key);},Math.max(0,wait)));
    return true;
  }
  /** Sends a value still waiting in the throttle window now (called when the gesture ends). */
  flush(key){
    const timer=this.timers.get(key);if(timer!=null){this.clearTimer(timer);this.timers.delete(key);}
    const message=this.pending.get(key);if(!message)return false;this.pending.delete(key);
    return this.available()?this.transmit(key,message):false;
  }
  gain(laneId,gain){
    if(!laneId||!Number.isFinite(Number(gain)))return false;
    return this.send(`gain:${laneId}`,{type:'set_track_gain',lane_id:String(laneId),gain:Math.max(0,Math.min(4,Number(gain)))});
  }
  parameter({laneId,pluginIndex,parameterIndex,valueNorm,type=''}={}){
    if(!laneId||!Number.isInteger(pluginIndex)||!Number.isInteger(parameterIndex)||!Number.isFinite(Number(valueNorm)))return false;
    return this.send(`param:${laneId}:${pluginIndex}:${parameterIndex}`,{type:'set_plugin_param',lane_id:String(laneId),plugin_index:pluginIndex,parameter_index:parameterIndex,value_norm:Math.max(0,Math.min(1,Number(valueNorm))),...type?{expected_plugin_type:String(type)}:{}});
  }
  parameterKey({laneId,pluginIndex,parameterIndex}){return `param:${laneId}:${pluginIndex}:${parameterIndex}`;}
}
