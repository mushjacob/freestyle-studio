import {bridgeFetch,realtimeSocketUrl} from './freestyle-host-transport.js';
/** Read-only Studio API clock/invalidation channel. REST owns edits and state
 * readback; this socket never sends a command or requests native state snapshots.
 * Replay may still supply a snapshot when its revision buffer is unavailable. */
const opaque=(value,label)=>{if(typeof value!=='string'||!value||value.length>128||/[\x00-\x1f\x7f]/.test(value))throw new Error(`A valid ${label} is required.`);return value;};
const finite=Number.isFinite,integer=value=>Number.isSafeInteger(value)&&value>=0;
const emit=(target,type,detail)=>target.dispatchEvent(new CustomEvent(type,{detail}));
const abort=()=>Object.assign(new Error('The realtime editor context changed.'),{name:'AbortError'});
// The ticket's socket must be Freestyle's own /api/ws/mcp-session on this deployment's host (validated by the bridge).
function socketUrl(value){try{return realtimeSocketUrl(value);}catch{throw new Error('Studio API returned an invalid realtime socket URL.');}}
const epoch=value=>typeof value==='string'&&value.length>0&&value.length<=128||integer(value);
export function studioClockPayload(frame,projectId){
 if(frame?.type!=='transport_clock'||frame.project_id!==undefined&&frame.project_id!==projectId||!integer(frame.seq)||!integer(frame.sample_frame)||!integer(frame.sample_rate)||frame.sample_rate<8000||frame.sample_rate>384000||typeof frame.playing!=='boolean'||!finite(frame.server_time_ms)||frame.server_time_ms<=0)return null;
 const loop=frame.loop;if(!loop||typeof loop.enabled!=='boolean'||!finite(loop.start_sec)||!finite(loop.end_sec)||loop.start_sec<0||loop.end_sec<0)return null;
 const result={project_id:projectId,seq:frame.seq,position_seconds:frame.sample_frame/frame.sample_rate,is_playing:frame.playing,sample_rate:frame.sample_rate,server_sent_ms:frame.server_time_ms,loop_enabled:loop.enabled,loop_start_sec:loop.start_sec,loop_end_sec:loop.end_sec};
 for(const name of ['bpm','bar','beat','tick','recording','producer_latency_seconds','session_epoch','play_range','tempo_segment','time_signature','timing_map_revision','timing_map_fingerprint'])if(frame[name]!==undefined)result[name]=structuredClone(frame[name]);
 if(result.producer_latency_seconds!==undefined&&(!finite(result.producer_latency_seconds)||result.producer_latency_seconds<0))return null;
 return result;
}
export class StudioRealtime extends EventTarget{
 constructor({fetch:fetchImpl=(...args)=>bridgeFetch(...args),webSocketFactory=url=>new WebSocket(url),now=()=>performance.now(),timer=(fn,ms)=>setTimeout(fn,ms),cancelTimer=id=>clearTimeout(id)}={}){super();Object.assign(this,{fetch:fetchImpl,webSocketFactory,now,timer,cancelTimer});this.current=null;this.generation=0;this.clockGeneration=0;this.state='idle';this.lastError=null;this.lastClockAt=null;this.closing=new Map();}
 setState(state,extra={}){this.state=state;emit(this,'state',{state,projectId:this.current?.projectId??null,...extra});}
 isCurrent(c){return this.current===c&&!c.closed&&c.generation===this.generation;}
 subscribeClock(enabled){if(typeof enabled!=='boolean')throw new TypeError('Choose whether the realtime clock is enabled.');const c=this.current;if(!c)return false;c.clockEnabled=enabled;if(!enabled)this.lastClockAt=null;return this.send(c,{type:'subscribe',clock:enabled});}
 hasFreshClock(maxAge=1500){return this.current?.clockEnabled!==false&&this.state==='connected'&&this.lastClockAt!==null&&this.now()-this.lastClockAt>=0&&this.now()-this.lastClockAt<=maxAge;}
 clearTimers(c){for(const id of c.timers.values())this.cancelTimer(id);c.timers.clear();}
 schedule(c,name,delay,fn){const previous=c.timers.get(name);if(previous!==undefined)this.cancelTimer(previous);const id=this.timer(()=>{if(c.timers.get(name)!==id)return;c.timers.delete(name);if(this.isCurrent(c))fn();},delay);c.timers.set(name,id);}
 send(c,frame){if(!this.isCurrent(c)||c.socket?.readyState!==1)return false;c.socket.send(JSON.stringify(frame));return true;}
 async closeSession(id){if(!id)return;const pending=this.closing.get(id);if(pending)return pending;const task=(async()=>{const response=await this.fetch('modesty-bridge:/realtime/session/'+encodeURIComponent(id),{method:'DELETE',keepalive:true});if(!response.ok)throw new Error('The realtime session could not be closed.');})();this.closing.set(id,task);try{return await task;}finally{if(this.closing.get(id)===task)this.closing.delete(id);}}
 cleanup(c){if(!c)return Promise.resolve();c.closed=true;this.clearTimers(c);if(c.socket){try{if(c.socket.readyState===1)c.socket.send(JSON.stringify({type:'close'}));c.socket.close();}catch{}}c.resolve?.(false);return this.closeSession(c.sessionId).catch(error=>{emit(this,'warning',{code:'realtime_close_failed',message:error.message});});}
 stop(){const c=this.current;this.current=null;this.generation++;this.lastClockAt=null;this.setState('idle');return this.cleanup(c);}
 start(projectId,{trackId}={}){
  opaque(projectId,'project id');if(trackId!==undefined)opaque(trackId,'track id');const previous=this.current;if(previous&&!previous.closed&&previous.projectId===projectId&&previous.trackId===trackId&&['connecting','connected'].includes(this.state))return previous.promise;
  const closing=this.stop(),c={projectId,trackId,generation:++this.generation,closed:false,clockEnabled:true,socket:null,sessionId:null,timers:new Map(),epoch:null,revision:null,lastClockSeq:null,gapTarget:null};c.promise=new Promise((resolve,reject)=>{c.resolve=resolve;c.reject=reject;});this.current=c;this.lastError=null;this.lastClockAt=null;this.setState('connecting');this.open(c,closing).catch(error=>this.fail(c,error));return c.promise;
 }
 async open(c,closing){
  await closing;if(!this.isCurrent(c))return;const response=await this.fetch('modesty-bridge:/realtime/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:c.projectId,...c.trackId?{track_id:c.trackId}:{}})}),data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.detail||data.error?.message||'Studio API could not open realtime push.'),{code:data.code??data.error?.code,status:response.status});
  c.sessionId=opaque(data.session_id,'realtime session id');if(!this.isCurrent(c)){await this.closeSession(c.sessionId);return;}
  if(data.project_id!==undefined&&data.project_id!==c.projectId||data.mode!==undefined&&data.mode!=='read'||typeof data.session_ticket!=='string'||!data.session_ticket||data.session_ticket.length>16384)throw new Error('Studio API returned no scoped read-only realtime ticket.');
  const socket=c.socket=this.webSocketFactory(socketUrl(data.websocket_url));let ticket=data.session_ticket;
  this.schedule(c,'connect',15000,()=>this.fail(c,new Error('The realtime socket did not connect.')));
  socket.onopen=()=>{if(!this.isCurrent(c))return;this.send(c,{type:'auth',ticket,snapshot:false});ticket=null;this.schedule(c,'connect',10000,()=>this.fail(c,new Error('The realtime socket did not authenticate.')));};
  socket.onmessage=event=>{if(!this.isCurrent(c))return;try{if(typeof event.data!=='string'||new TextEncoder().encode(event.data).byteLength>8*1024*1024)throw new Error('Studio API returned an invalid realtime frame.');const frame=JSON.parse(event.data);if(!frame||typeof frame!=='object'||Array.isArray(frame))throw new Error('Studio API returned an invalid realtime frame.');this.frame(c,frame);}catch(error){this.fail(c,error);}};
  socket.onerror=()=>{if(this.isCurrent(c))this.fail(c,new Error('The realtime channel became unavailable.'));};
  socket.onclose=()=>{if(this.isCurrent(c))this.fail(c,new Error('The realtime channel closed.'));};
 }
 fail(c,error){if(!this.isCurrent(c))return;this.lastError={code:error.code||'realtime_unavailable',message:error.message,status:error.status??null};this.current=null;this.generation++;this.lastClockAt=null;c.reject?.(error);this.cleanup(c);this.setState('error',{message:error.message});emit(this,'warning',{code:error.code||'realtime_unavailable',message:error.message});}
 frame(c,frame){
  if(frame.project_id!==undefined&&frame.project_id!==c.projectId)throw new Error('The realtime frame belongs to another project.');
  if(frame.type==='welcome'){
   if(frame.project_id!==c.projectId||frame.session_id!==c.sessionId||frame.mode!=='read'||!epoch(frame.epoch)||!integer(frame.revision))throw new Error('The realtime welcome does not match this read-only editor.');
   c.welcomeServerMs=finite(frame.server_time_ms)?frame.server_time_ms:null;c.welcomeReceivedAt=this.now();c.epoch=frame.epoch;c.revision=frame.revision;c.lastClockSeq=null;this.clockGeneration++;this.clearTimers(c);this.setState('connected');this.send(c,{type:'subscribe',clock:c.clockEnabled});c.resolve(true);emit(this,'welcome',{...frame,project_id:c.projectId});this.heartbeat(c);return;
  }
  if(c.epoch===null)throw new Error('Studio API sent state before its realtime welcome.');
  if(frame.type==='transport_clock'){
   if(c.clockEnabled===false)return;const payload=studioClockPayload(frame,c.projectId);if(!payload)return;if(c.welcomeServerMs!==null&&payload.server_sent_ms<c.welcomeServerMs+Math.max(0,this.now()-c.welcomeReceivedAt)-2000)return;
   const nativeEpoch=payload.session_epoch;if(finite(nativeEpoch)&&finite(c.nativeEpoch)&&nativeEpoch<c.nativeEpoch)return;
   if(finite(nativeEpoch)&&finite(c.nativeEpoch)&&nativeEpoch>c.nativeEpoch){c.lastClockSeq=null;this.clockGeneration++;}
   if(finite(nativeEpoch))c.nativeEpoch=nativeEpoch;if(c.lastClockSeq!==null&&payload.seq<=c.lastClockSeq)return;c.lastClockSeq=payload.seq;this.lastClockAt=this.now();emit(this,'clock',payload);return;
  }
  if(frame.type==='snapshot'){
   if(!epoch(frame.epoch)||!integer(frame.revision)||!frame.state||typeof frame.state!=='object'||Array.isArray(frame.state))throw new Error('Studio API returned an invalid state snapshot.');
   const project=frame.state.session?.projectId??frame.state.session?.project_id;if(project!==undefined&&project!==c.projectId)throw new Error('The native snapshot belongs to another project.');
   if(frame.epoch!==c.epoch){c.lastClockSeq=null;this.clockGeneration++;}else if(frame.revision<c.revision)return;c.epoch=frame.epoch;c.revision=frame.revision;c.gapTarget=null;emit(this,'snapshot',{...frame,project_id:c.projectId});return;
  }
  if(['state_patch','resync_required'].includes(frame.type)){
   if(!epoch(frame.epoch)||!integer(frame.from_revision)||!integer(frame.revision)||frame.revision!==frame.from_revision+1)throw new Error('Studio API returned an invalid revision event.');
   if(frame.epoch===c.epoch&&frame.revision<=c.revision)return;
   if(frame.epoch!==c.epoch||frame.from_revision!==c.revision){if(c.gapTarget===null){c.gapTarget=frame.revision;this.send(c,{type:'resubscribe',epoch:c.epoch,since_revision:c.revision});emit(this,'gap',{project_id:c.projectId,epoch:c.epoch,revision:c.revision});}return;}
   // The interactive contract permits own reads after resync_required. Our REST
   // owners verify saved edits; another full snapshot per invalidation would
   // consume the socket's snapshot budget without updating those owners.
   c.revision=frame.revision;if(c.gapTarget!==null&&c.revision>=c.gapTarget)c.gapTarget=null;emit(this,'change',{...frame,project_id:c.projectId});return;
  }
  if(frame.type==='renewed'){emit(this,'renewed',{project_id:c.projectId,expires_at:frame.session_expires_at??frame.expires_at});return;}
  if(frame.type==='pong'){emit(this,'pong',{...frame,project_id:c.projectId});return;}
  if(frame.type==='session_closed'||frame.type==='reject'||frame.type==='error')throw Object.assign(new Error(typeof frame.error==='string'?frame.error:'The realtime session was closed or rejected.'),{code:frame.code});
 }
 heartbeat(c){this.schedulePing(c);this.scheduleRenew(c);}
 schedulePing(c){this.schedule(c,'ping',20000,()=>{this.send(c,{type:'ping',client_time:Date.now()});this.schedulePing(c);});}
 scheduleRenew(c){this.schedule(c,'renew',60000,()=>{this.send(c,{type:'renew'});this.scheduleRenew(c);});}
}
