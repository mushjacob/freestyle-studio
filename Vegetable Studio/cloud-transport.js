/** Acknowledged native cloud transport, with authoritative MCP reconciliation. */
// Current Studio Pro Stop pauses at its current position; rewind is a separate seek.
// There is no transport_stop data-channel message .
const TYPES = {play:'transport_play',pause:'transport_pause',stop:'transport_pause',seek:'transport_seek',seek_and_play:'transport_seek_and_play'};
const SEEK = new Set(['seek','seek_and_play']);
// Round 10: Stop must always win. A Stop/Pause never waits unbounded on its
// HTTP fallback, and a superseded Play whose HTTP request was already in flight
// (it cannot be recalled) is followed by one idempotent trailing Stop.
const STOPS = new Set(['stop','pause']),STARTS = new Set(['play','seek_and_play']);
const FALLBACK_REASONS = new Set(['not-live','ack-timeout','not-applied','send-failed']);
const controlStateAllowed = monitor => monitor.state==='connected'||monitor.state==='blocked'&&monitor.peer?.connectionState==='connected';
const eventError = (message,code,name='Error') => Object.assign(new Error(message),{code,name});

/** Match the native Studio's fresh engine-clock recovery before replaying a command. */
export function transportAppliedByClock(command,seconds,clock,{sentAt,now,tolerance=.3,maxAge=350}={}) {
 if(!clock || clock.receivedAt<=sentAt || now-clock.receivedAt<0 || now-clock.receivedAt>maxAge)return false;
 const p=clock.payload,status=p?.status||{},rolling=p?.is_playing??p?.isPlaying??status.is_playing;
 if(rolling===undefined || rolling===null)return false;
 const playing=!!rolling,position=Number(p?.position_seconds??p?.position??status.position_seconds);
 const target=Number(seconds),elapsed=Math.max(0,(clock.receivedAt-sentAt)/1000);
 const atTarget=Number.isFinite(target)&&Number.isFinite(position)&&position>=target-tolerance&&position<=target+(playing?elapsed:0)+tolerance;
 if(command==='play')return playing;
 if(command==='pause'||command==='stop')return !playing;
 if(command==='seek')return atTarget;
 if(command==='seek_and_play')return playing&&atTarget;
 return false;
}

/**
 * fallback(command, {seconds?}, {projectId, signal, reason}) must return an
 * authoritative cloud result or throw. Bind the request to the supplied projectId;
 * do not read a mutable session target after awaiting. A socket send alone never
 * resolves send().
 * Successful native acknowledgements/clock snapshots are returned for the caller
 * to adopt; this helper does not change local transport or project state.
 */
export class CloudTransport {
 constructor({monitor,getProjectId=()=>monitor?.projectId,fallback,timeoutMs=1200,cooldownMs=2000,stopDeadlineMs=4000,onEvent=()=>{},now=()=>performance.now(),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}) {
  if(!monitor?.addEventListener || typeof fallback!=='function')throw new TypeError('A cloud monitor and authoritative transport fallback are required.');
  Object.assign(this,{monitor,getProjectId,fallback,timeoutMs,cooldownMs,stopDeadlineMs,onEvent,now,setTimer,clearTimer});this.fallbacks=new Set();this.trailing=null;
  this.serial=0;this.pending=null;this.clock=null;this.cooldownUntil=0;this.destroyed=false;
  this.onClock=event=>{const p=event.detail;if(String(p?.project_id||'')!==String(this.getProjectId()||''))return;const seq=Number(p?.seq);if(this.clock?.projectId===p.project_id&&Number.isFinite(seq)&&seq<=this.clock.sequence)return;this.clock={projectId:p.project_id,sequence:Number.isFinite(seq)?seq:0,payload:p,receivedAt:this.now()};};
  this.onState=event=>{
   const r=this.pending,state=event.detail?.state;if(state==='connected')return;
   const waiting=r?.route==='channel-opening',peer=waiting?r.waitPeer:r?.nativePeer,control=waiting?r.waitChannel:r?.nativeControl;
   if(state==='blocked'&&peer&&peer===monitor.peer&&peer.connectionState==='connected'&&control===monitor.control&&String(this.getProjectId()||'')===r.projectId&&String(monitor.projectId||'')===r.projectId&&monitor.generation===r.generation&&(control?.readyState==='open'||waiting&&control?.readyState==='connecting'))return;
   if(waiting)r.channelUnavailable?.();else if(r?.route==='data-channel')this.cancel('The cloud audio connection changed before transport acknowledgement.');
  };
  monitor.addEventListener('clock',this.onClock);monitor.addEventListener('state',this.onState);
 }
 /** Most recent completion only; no project identities, payloads or credentials. */
 get lastResult(){return this._lastResult??null;}
 send(command,{seconds,signal}={}) {
  if(this.destroyed)return Promise.reject(eventError('The cloud transport has been closed.','transport_closed'));
  if(!Object.hasOwn(TYPES,command))return Promise.reject(eventError('Unsupported cloud transport command.','invalid_transport_command'));
  if(SEEK.has(command)&&(!Number.isFinite(Number(seconds))||Number(seconds)<0))return Promise.reject(eventError('Seek requires a nonnegative position in seconds.','invalid_transport_position'));
  const projectId=String(this.getProjectId()||'');if(!projectId)return Promise.reject(eventError('Open a cloud project before controlling transport.','missing_project'));
  if(STARTS.has(command)&&this.trailingDispatch){const wait=this.trailingDispatch;return new Promise(resolve=>{const id=this.setTimer(resolve,Math.max(100,Number(this.stopDeadlineMs)||4000));wait.then(()=>{this.clearTimer(id);resolve();});}).then(()=>{this.trailingDispatch=null;return this.send(command,{seconds,signal});});}
  this.cancel('A newer transport command superseded this request.','transport_superseded');
  if(signal?.aborted)return Promise.reject(eventError('Cloud transport was cancelled.','transport_cancelled','AbortError'));
  const token=++this.serial,generation=this.monitor.generation,options=SEEK.has(command)?{seconds:Number(seconds)}:{};
  return new Promise((resolve,reject)=>{
   const controller=new AbortController();
   const r={token,projectId,generation,command,route:'pending',timer:null,seq:null,sentAt:this.now(),controller,done:false,buffer:[]};this.pending=r;
   let clearChannelWait=()=>{};
   const current=()=>!r.done&&this.pending===r&&String(this.getProjectId()||'')===projectId;
   const scopeError=()=>eventError('The cloud project changed before transport completed.','transport_scope_changed','AbortError');
   const cleanup=()=>{if(r.timer!==null)this.clearTimer(r.timer);if(r.deadline!=null){this.clearTimer(r.deadline);r.deadline=null;}clearChannelWait();this.monitor.removeEventListener('ack',ack);signal?.removeEventListener('abort',abort);if(this.pending===r)this.pending=null;};
   const settle=(error,value)=>{if(r.done)return;r.done=true;cleanup();this._lastResult=Object.freeze({command,route:value?.route??r.route,reason:FALLBACK_REASONS.has(r.reason)?r.reason:null,ok:!error,acknowledged:value?.acknowledged===true,recoveredFromClock:value?.recoveredFromClock===true,reconciled:value?.reconciled===true,elapsedMs:Math.max(0,this.now()-r.sentAt)});this.emit('settled',this._lastResult);if(!error&&STOPS.has(command))this.trailStop(command,projectId,token);error?reject(error):resolve(value);};
   r.cancel=(message,code)=>{controller.abort();settle(eventError(message,code,'AbortError'));};
   const abort=()=>r.cancel('Cloud transport was cancelled.','transport_cancelled');
   const validScope=()=>{if(!current()){if(!r.done)settle(scopeError());return false;}if(['data-channel','channel-opening'].includes(r.route)&&(this.monitor.generation!==generation||String(this.monitor.projectId||'')!==projectId||r.route==='channel-opening'&&(this.monitor.peer!==r.waitPeer||this.monitor.control!==r.waitChannel||this.monitor.trackId!==r.waitTrackId)||r.route==='data-channel'&&(this.monitor.peer!==r.nativePeer||this.monitor.control!==r.nativeControl))){settle(scopeError());return false;}return true;};
   const reconcile=async reason=>{
    if(r.route==='mcp'||!validScope())return;
    if(r.timer!==null){this.clearTimer(r.timer);r.timer=null;}clearChannelWait();this.monitor.removeEventListener('ack',ack);
    const sent=r.route==='data-channel';r.route='mcp';r.reason=reason;if(sent&&reason!=='not-live')this.cooldownUntil=this.now()+this.cooldownMs;
    try{
     let call;try{call=Promise.resolve(this.fallback(command,options,{projectId,signal:controller.signal,reason}));}catch(error){call=Promise.reject(error);}
     const record={command,token,projectId,promise:call};this.fallbacks.add(record);call.then(()=>{},()=>{}).finally(()=>this.fallbacks.delete(record));
     // An unanswered Stop must not stay pending (greyed) forever: local playback
     // is already silenced; report the unconfirmed engine state instead.
     if(STOPS.has(command)&&Number(this.stopDeadlineMs)>0)r.deadline=this.setTimer(()=>{r.deadline=null;if(r.done||!current())return;controller.abort();settle(eventError(`Freestyle did not confirm ${command==='stop'?'Stop':'Pause'} in time. Local playback is stopped; press Stop again to resend.`,'transport_unconfirmed'));},Number(this.stopDeadlineMs));
     const result=await call;
     if(!validScope())return;
     if(result===false||result?.ok===false||result?.isError||result?.error)throw eventError(result?.message||result?.error?.message||'The authoritative cloud transport command failed.',result?.code||'transport_reconcile_failed');
     settle(null,{ok:true,route:'mcp',reconciled:true,reason,result});
    }catch(error){if(!r.done)settle(current()?error:scopeError());}
   };
   const ack=event=>{
    const a=event.detail;if(r.route!=='data-channel'||a?.type!=='transport_ack'||String(a?.project_id||'')!==projectId)return;
    if(r.seq===null){r.buffer.push(a);return;}
    if(Number(a.seq)!==r.seq||!validScope())return;
    if(a.ok===false){
     if(a.applied===false||a.code==='project_control_forbidden'){reconcile('not-applied');return;}
     const error=eventError(String(a.message||a.code||`${command} was refused by the cloud engine.`),String(a.code||'transport_refused'));error.payload=a;settle(error);return;
    }
    if(a.applied===false){reconcile('not-applied');return;}
    settle(null,{ok:true,route:'data-channel',acknowledged:true,status:a.status||a,ack:a});
   };
   signal?.addEventListener('abort',abort,{once:true});
   const sendNative=()=>{
   if(!validScope())return;
   if(r.timer!==null){this.clearTimer(r.timer);r.timer=null;}clearChannelWait();
   r.route='data-channel';r.nativePeer=this.monitor.peer;r.nativeControl=this.monitor.control;r.commandSentAt=this.now();this.monitor.addEventListener('ack',ack);
   try{
    const sent=this.monitor.sendControl({type:TYPES[command],...options,...command==='stop'?{end_recording:true}:{}});r.seq=Number(sent?.seq);
    if(!Number.isSafeInteger(r.seq)||r.seq<=0)throw eventError('The cloud control channel returned no transport sequence.','missing_transport_sequence');
    for(const a of r.buffer)ack({detail:a});r.buffer=[];
    if(r.done||r.route!=='data-channel')return;
    r.timer=this.setTimer(()=>{
     r.timer=null;if(!validScope())return;
     const clock=this.clock;
     if(clock?.projectId===projectId&&transportAppliedByClock(command,options.seconds,clock,{sentAt:r.commandSentAt,now:this.now()})){
      settle(null,{ok:true,route:'data-channel',recoveredFromClock:true,status:clock.payload.status||clock.payload,clock:clock.payload});return;
     }
     reconcile('ack-timeout');
    },Math.max(100,Number(this.timeoutMs)||1200));
   }catch(error){if(!r.done)reconcile('send-failed');}
   };
   if(String(this.monitor.projectId||'')!==projectId||!controlStateAllowed(this.monitor)||this.now()<this.cooldownUntil){reconcile('not-live');return;}
   const channel=this.monitor.control,peer=this.monitor.peer;
   if(channel?.readyState==='open'){sendNative();return;}
   // Peer connection and ordered SCTP channel opening are distinct events.
   // Wait only for this already-connected peer's own channel, never a replacement.
   if(channel?.readyState!=='connecting'||peer?.connectionState!=='connected'||typeof channel.addEventListener!=='function'||typeof channel.removeEventListener!=='function'){reconcile('not-live');return;}
   r.route='channel-opening';r.waitPeer=peer;r.waitChannel=channel;r.waitTrackId=this.monitor.trackId;
   const opened=()=>{if(!validScope())return;if(channel.readyState==='open'&&peer.connectionState==='connected'&&controlStateAllowed(this.monitor))sendNative();};
   const unavailable=()=>{if(validScope())reconcile('not-live');};r.channelUnavailable=unavailable;
   const peerChanged=()=>{if(!validScope())return;if(peer.connectionState!=='connected')unavailable();};
   clearChannelWait=()=>{channel.removeEventListener('open',opened);channel.removeEventListener('close',unavailable);channel.removeEventListener('error',unavailable);peer.removeEventListener?.('connectionstatechange',peerChanged);r.channelUnavailable=null;};
   channel.addEventListener('open',opened);channel.addEventListener('close',unavailable);channel.addEventListener('error',unavailable);peer.addEventListener?.('connectionstatechange',peerChanged);
   r.timer=this.setTimer(()=>{r.timer=null;if(validScope())reconcile('not-live');},Math.max(100,Math.min(1200,Number(this.timeoutMs)||1200)));
   opened();
  });
 }
 cancel(message='Cloud transport was cancelled.',code='transport_cancelled'){this.pending?.cancel(message,code);}
 emit(type,detail){try{this.onEvent(type,detail);}catch{}}
 /** After a confirmed Stop/Pause, an earlier Play's HTTP request may still land
  * on the engine. Wait for it (bounded), then send the same idempotent Stop once
  * more unless a newer command was issued. `trailing` exposes it for tests. */
 trailStop(command,projectId,token){
  const earlier=[...this.fallbacks].filter(f=>f.token<token&&f.projectId===projectId&&STARTS.has(f.command));if(!earlier.length)return null;
  this.emit('trailing-stop',{command,waitingFor:earlier.map(f=>f.command)});
  const bound=new Promise(resolve=>{const id=this.setTimer(resolve,Math.max(100,Number(this.stopDeadlineMs)||4000));Promise.allSettled(earlier.map(f=>f.promise)).then(()=>{this.clearTimer(id);resolve();});});
  const run=bound.then(async()=>{
   if(this.destroyed||this.serial!==token||String(this.getProjectId()||'')!==projectId)return false;
   let call;try{call=Promise.resolve(this.fallback(command,{}, {projectId,reason:'trailing-stop'}));}catch(error){call=Promise.reject(error);}
   // A Play pressed while this Stop is on the wire is ordered after it.
   const dispatched=call.then(()=>{},()=>{});this.trailingDispatch=dispatched;dispatched.finally(()=>{if(this.trailingDispatch===dispatched)this.trailingDispatch=null;});
   try{await call;this.emit('trailing-stop-sent',{command,ok:true});return true;}catch(error){this.emit('trailing-stop-sent',{command,ok:false,code:error?.code??null});return false;}
  });
  this.trailing=run;return run;
 }
 destroy(){if(this.destroyed)return;this.destroyed=true;this.cancel('The cloud transport has been closed.','transport_closed');this.monitor.removeEventListener('clock',this.onClock);this.monitor.removeEventListener('state',this.onState);this.clock=null;}
}
