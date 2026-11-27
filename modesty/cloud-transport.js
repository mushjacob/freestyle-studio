/** Scoped transport: acknowledged WebRTC controls, typed REST fallback. */
const TYPES = {play:'transport_play',pause:'transport_pause',seek:'transport_seek',seek_and_play:'transport_seek_and_play'};
const SEEK = new Set(['seek','seek_and_play']);
const eventError = (message,code,name='Error') => Object.assign(new Error(message),{code,name});
const diagnosticText=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500):null;

/** Match the native Studio's fresh engine-clock recovery before replaying a command. */
export function transportAppliedByClock(command,seconds,clock,{sentAt,now,tolerance=.3,maxAge=350}={}) {
 if(!clock || clock.receivedAt<=sentAt || now-clock.receivedAt<0 || now-clock.receivedAt>maxAge)return false;
 const p=clock.payload,status=p?.status||{},rolling=p?.is_playing??p?.isPlaying??status.is_playing;
 if(rolling===undefined || rolling===null)return false;
 const playing=!!rolling,position=Number(p?.position_seconds??p?.position??status.position_seconds);
 const target=Number(seconds),elapsed=Math.max(0,(clock.receivedAt-sentAt)/1000);
 const atTarget=Number.isFinite(target)&&Number.isFinite(position)&&position>=target-tolerance&&position<=target+(playing?elapsed:0)+tolerance;
 if(command==='play')return playing;
 if(command==='pause')return !playing;
 if(command==='seek')return atTarget;
 if(command==='seek_and_play')return playing&&atTarget;
 return false;
}

/**
 * fallback(command, {seconds?}, {projectId, trackId?, signal, reason}) must return an
 * authoritative cloud result or throw. Bind the request to the supplied projectId;
 * do not read a mutable session target after awaiting. A socket send alone never
 * resolves send().
 * Successful native acknowledgements/clock snapshots are returned for the caller
 * to adopt; this helper does not change local transport or project state.
 */
export class CloudTransport {
 constructor({monitor,getProjectId=()=>monitor?.projectId,getTrackId=()=>undefined,fallback,restOnly=false,fallbackRoute='studio-api',timeoutMs=1200,cooldownMs=2000,now=()=>performance.now(),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}) {
  if(!monitor?.addEventListener || typeof fallback!=='function')throw new TypeError('A cloud monitor and authoritative transport fallback are required.');
  Object.assign(this,{monitor,getProjectId,getTrackId,fallback,restOnly,fallbackRoute,timeoutMs,cooldownMs,now,setTimer,clearTimer});
  this.serial=0;this.pending=null;this.clock=null;this.cooldownUntil=0;this.destroyed=false;
  this.onClock=event=>{const p=event.detail;if(String(p?.project_id||'')!==String(this.getProjectId()||''))return;const seq=Number(p?.seq);if(this.clock?.projectId===p.project_id&&Number.isFinite(seq)&&seq<=this.clock.sequence)return;this.clock={projectId:p.project_id,sequence:Number.isFinite(seq)?seq:0,payload:p,receivedAt:this.now()};};
  this.onState=event=>{if(this.pending?.route==='data-channel'&&!this.nativeReady(this.pending.projectId,event.detail?.state))this.cancel('The cloud audio connection changed before transport acknowledgement.');};
  monitor.addEventListener('clock',this.onClock);monitor.addEventListener('state',this.onState);
 }
 nativeReady(projectId,state=this.monitor.state){
  const monitor=this.monitor;
  // Browser autoplay permission does not close a negotiated control peer.
  // A blocked sink needs explicit current-peer proof before using that channel.
  return String(monitor.projectId||'')===String(projectId||'')&&monitor.control?.readyState==='open'&&(state==='connected'||state==='blocked'&&monitor.active===true&&monitor.peer?.connectionState==='connected');
 }
 send(command,{seconds,startSec,endSec,signal}={}) {
  if(this.destroyed)return Promise.reject(eventError('The cloud transport has been closed.','transport_closed'));
  if(!Object.hasOwn(TYPES,command)&&command!=='stop'&&command!=='play_range')return Promise.reject(eventError('Unsupported cloud transport command.','invalid_transport_command'));
  if(SEEK.has(command)&&(!Number.isFinite(Number(seconds))||Number(seconds)<0))return Promise.reject(eventError('Seek requires a nonnegative position in seconds.','invalid_transport_position'));
  if(command==='play_range'&&(!Number.isFinite(startSec)||!Number.isFinite(endSec)||startSec<0||endSec<=startSec))return Promise.reject(eventError('Play range requires finite ordered start/end seconds.','invalid_transport_range'));
  const projectId=String(this.getProjectId()||'');if(!projectId)return Promise.reject(eventError('Open a cloud project before controlling transport.','missing_project'));
  const trackId=this.getTrackId()||undefined;
  this.cancel('A newer transport command superseded this request.','transport_superseded');
  if(signal?.aborted)return Promise.reject(eventError('Cloud transport was cancelled.','transport_cancelled','AbortError'));
  const token=++this.serial,generation=this.monitor.generation,options=command==='play_range'?{startSec,endSec}:SEEK.has(command)?{seconds:Number(seconds)}:{};
  const liveContext=!!trackId&&this.monitor.projectId===projectId&&this.monitor.trackId===trackId&&this.monitor.state!=='idle';
  return new Promise((resolve,reject)=>{
   const controller=new AbortController();
   const r={token,projectId,generation,command,nativeCommand:command,nativeOptions:options,phase:0,route:'pending',timer:null,seq:null,sentAt:this.now(),startedAt:this.now(),controller,done:false,buffer:[]};this.pending=r;
   const current=()=>!r.done&&this.pending===r&&String(this.getProjectId()||'')===projectId&&(this.getTrackId()||undefined)===trackId&&(!liveContext||this.monitor.generation===generation);
   const scopeError=()=>eventError('The cloud project changed before transport completed.','transport_scope_changed','AbortError');
   const cleanup=()=>{if(r.timer!==null)this.clearTimer(r.timer);this.monitor.removeEventListener('ack',ack);signal?.removeEventListener('abort',abort);if(this.pending===r)this.pending=null;};
   const settle=(error,value)=>{if(r.done)return;r.done=true;cleanup();
    const status=error?.status??error?.result?.status??error?.payload?.status;
    this.lastResult={outcome:error?'error':'success',command,projectId,route:value?.route||r.route,seq:r.seq,reason:diagnosticText(value?.reason||r.reason||error?.code),elapsedMs:Math.max(0,Math.round(this.now()-r.startedAt)),code:diagnosticText(error?.code),stage:diagnosticText(error?.stage??error?.result?.stage??error?.payload?.stage),status:typeof status==='number'&&Number.isFinite(status)?status:null,message:diagnosticText(error?.message)};
    if(error)this.lastFailure={...this.lastResult};error?reject(error):resolve(value);
   };
   r.cancel=(message,code)=>{controller.abort();settle(eventError(message,code,'AbortError'));};
   const abort=()=>r.cancel('Cloud transport was cancelled.','transport_cancelled');
   const validScope=()=>{if(!current()){if(!r.done)settle(scopeError());return false;}if(r.route==='data-channel'&&(this.monitor.generation!==generation||String(this.monitor.projectId||'')!==projectId)){settle(scopeError());return false;}return true;};
   const restRoute=this.fallbackRoute;
   const reconcile=async reason=>{
    if(r.route===restRoute||!validScope())return;
    if(r.timer!==null){this.clearTimer(r.timer);r.timer=null;}this.monitor.removeEventListener('ack',ack);
    r.route=restRoute;r.reason=reason;if(reason!=='not-live'&&reason!=='stop'&&reason!=='play-range')this.cooldownUntil=this.now()+this.cooldownMs;
    try{
     const result=await this.fallback(command,options,{projectId,...(trackId?{trackId}:{}),signal:controller.signal,reason});
     if(!validScope())return;
     if(result===false||result?.ok===false||result?.isError||result?.error)throw eventError(result?.message||result?.error?.message||'The authoritative cloud transport command failed.',result?.code||'transport_reconcile_failed');
     settle(null,{ok:true,route:restRoute,reconciled:true,reason,result});
    }catch(error){if(!r.done)settle(current()?error:scopeError());}
   };
   const nativeApplied=result=>{
    if(!validScope())return;
    if(command!=='stop'){settle(null,result);return;}
    const status=result.status||{},rolling=status.is_playing??status.isPlaying,position=status.position_seconds??status.position;
    // A Stop is one request, not two independently cancellable send() calls.
    // Pause must be applied before rewind; contradictory native status falls
    // back to the captured authoritative Stop rather than claiming success.
    if(rolling===true||(r.nativeCommand==='seek'&&position!==undefined&&(!Number.isFinite(Number(position))||Math.abs(Number(position))>1e-7))){reconcile('stop-state-mismatch');return;}
    if(r.nativeCommand==='pause'){
     r.pauseReceipt=result;
     if(r.timer!==null){this.clearTimer(r.timer);r.timer=null;}
     dispatchNative('seek',{seconds:0});return;
    }
    // Missing fields are established by the two applied command receipts,
    // never by a socket send or a local playback estimate. Keep both proofs.
    settle(null,{...result,status:{...r.pauseReceipt.status,...status,is_playing:false,position_seconds:position===undefined?0:Number(position)},nativeSteps:{pause:r.pauseReceipt,seek:result}});
   };
   const ack=event=>{
    const a=event.detail;if(r.route!=='data-channel'||a?.type!=='transport_ack'||String(a?.project_id||'')!==projectId)return;
    if(r.seq===null){r.buffer.push(a);return;}
    if(Number(a.seq)!==r.seq||!validScope())return;
    if(a.ok===false||a.applied===false)this.lastRejectedAck={code:diagnosticText(a.code),message:diagnosticText(a.message),ok:typeof a.ok==='boolean'?a.ok:null,applied:typeof a.applied==='boolean'?a.applied:null,seq:r.seq,projectId,nativeCommand:r.nativeCommand};
    if(a.ok===false){
     if(command==='stop'||a.applied===false||a.code==='project_control_forbidden'){reconcile('not-applied');return;}
     const error=eventError(String(a.message||a.code||`${command} was refused by the cloud engine.`),String(a.code||'transport_refused'));error.payload=a;settle(error);return;
    }
    if(a.applied===false){reconcile('not-applied');return;}
    nativeApplied({ok:true,route:'data-channel',acknowledged:true,status:a.status||a,ack:a});
   };
   const dispatchNative=(nativeCommand,nativeOptions)=>{
    if(!validScope())return;
    const phase=++r.phase;r.nativeCommand=nativeCommand;r.nativeOptions=nativeOptions;r.seq=null;r.buffer=[];r.sentAt=this.now();
    try{
    const sent=this.monitor.sendControl({type:TYPES[nativeCommand],...nativeOptions});r.seq=Number(sent?.seq);
    if(!Number.isSafeInteger(r.seq)||r.seq<=0)throw eventError('The cloud control channel returned no transport sequence.','missing_transport_sequence');
    const buffered=r.buffer;r.buffer=[];for(const a of buffered)ack({detail:a});
    if(r.done||r.route!=='data-channel'||phase!==r.phase)return;
    r.timer=this.setTimer(()=>{
     if(phase!==r.phase)return;r.timer=null;if(!validScope())return;
     const clock=this.clock;
     const clockOptions={sentAt:r.sentAt,now:this.now(),...(command==='stop'&&nativeCommand==='seek'?{tolerance:1e-7}:{})};
     if(clock?.projectId===projectId&&transportAppliedByClock(nativeCommand,nativeOptions.seconds,clock,clockOptions)&&(command!=='stop'||nativeCommand!=='seek'||transportAppliedByClock('pause',null,clock,clockOptions))){
      nativeApplied({ok:true,route:'data-channel',recoveredFromClock:true,status:clock.payload.status||clock.payload,clock:clock.payload});return;
     }
     reconcile('ack-timeout');
    },Math.max(100,Number(this.timeoutMs)||1200));
   }catch(error){if(!r.done)reconcile('send-failed');}
   };
   signal?.addEventListener('abort',abort,{once:true});
   if(this.restOnly){reconcile('studio-api');return;}
   if(command==='play_range'){reconcile('play-range');return;}
   if(!this.nativeReady(projectId)||this.now()<this.cooldownUntil){reconcile(command==='stop'?'stop':'not-live');return;}
   r.route='data-channel';this.monitor.addEventListener('ack',ack);
   dispatchNative(command==='stop'?'pause':command,options);
  });
 }
 cancel(message='Cloud transport was cancelled.',code='transport_cancelled'){this.pending?.cancel(message,code);}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.cancel('The cloud transport has been closed.','transport_closed');this.monitor.removeEventListener('clock',this.onClock);this.monitor.removeEventListener('state',this.onState);this.clock=null;}
}
