import {hostFetch} from './freestyle-host-transport.js';
/** Stream microphone input into Freestyle's native cloud ingest connection. */
const NATIVE_STUN={urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']};
/* Event classes captured with the EventTarget this class extends (module evaluation time). A page (or a test harness)
 * that later swaps globalThis.CustomEvent for another realm's class must not break dispatch: Node's EventTarget
 * refuses foreign Event instances (the "record input chooser" TypeError). */
const BaseCustomEvent=globalThis.CustomEvent,BaseEvent=globalThis.Event;
const makeEvent=(type,detail)=>{if(typeof BaseCustomEvent==='function')return new BaseCustomEvent(type,{detail});const event=new BaseEvent(type);Object.defineProperty(event,'detail',{value:detail});return event;};
const emit=(target,type,detail)=>{try{return target.dispatchEvent(makeEvent(type,detail));}catch(error){if(!(error instanceof TypeError))throw error;const event=new globalThis.CustomEvent(type,{detail});return target.dispatchEvent(event);}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve,settled:false,settle(value){if(!this.settled){this.settled=true;resolve(value);}}};};
/** Live count-in choices (control bar metronome ▾ Count-In) → startRecording count_in_beats (Freestyle accepts 0–8). */
export const COUNT_IN_MAX_BEATS=8;
export function countInBeatsFor(bars,beatsPerBar=4){const total=Math.round(Number(bars)*Number(beatsPerBar));return Number.isFinite(total)&&total>0?Math.min(COUNT_IN_MAX_BEATS,total):0;}
/** take_id: [A-Za-z0-9_-], ≤ 96, no "__", single use (spec: startRecording step 3). */
export function liveTakeId(random=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`){return `abl-take-${String(random).replace(/[^A-Za-z0-9-]/g,'-').replace(/-{2,}/g,'-')}`.slice(0,96);}
const studioCode=error=>error?.code||error?.data?.error?.code||null;
/** Studio API live-ingest errors that must not fall back to a browser capture (another take owns the engine, or the
 * caller lost write access): the fallback would record over / beside someone else's take. */
const NO_FALLBACK=new Set(['recording_in_progress','project_write_forbidden','oauth_grant_revoked','editor_required','take_id_in_use']);
const cancelled=()=>new DOMException('Cloud recording cancelled.','AbortError');

/** Live's track In/Out "Audio From" + Monitor feed the capture: getUserMedia constraints for the chosen input.
 * Processing stays off for every source (Studio Pro's raw capture: echoCancellation/noiseSuppression/autoGainControl
 * false); the chosen device is required exactly, like Pro's raw capture (deviceId {exact}). mode 'instrument' (Pro's
 * guitar input) asks for the device's native latency; 'voice' keeps mono. */
export const RECORD_MONITOR_MODES=Object.freeze(['in','auto','off']);
export function recordingConstraints({deviceId='',mode='voice'}={}){
 const audio={echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1};
 if(typeof deviceId==='string'&&deviceId&&deviceId!=='default')audio.deviceId={exact:deviceId};
 if(mode==='instrument')audio.latency={ideal:0};
 return{audio};
}
/** Monitor In = always hear the input through the engine; Auto = while recording an armed track (the take); Off = never. */
export function recordSelfMonitor(monitor,fallback=false){return monitor==='in'||monitor==='auto'?true:monitor==='off'?false:!!fallback;}
/** Resolve/reject with `promise`, or reject with code record_wait_timeout after `ms` (then `onTimeout` runs once). */
export function settleWithin(promise,ms,onTimeout=()=>{}){
 return new Promise((resolve,reject)=>{let done=false;const timer=setTimeout(()=>{if(done)return;done=true;try{onTimeout();}catch{}reject(Object.assign(new Error('The recording start step did not finish in time.'),{code:'record_wait_timeout'}));},ms);
  Promise.resolve(promise).then(value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);},error=>{if(done)return;done=true;clearTimeout(timer);reject(error);});});
}
export class CloudRecorder extends EventTarget {
  /** Optional transport callbacks receive captured identities, never the active
   * project. They must not retry uncertain mutations. No MCP schema is assumed.
   * offerIngest(target, nativePayload, {signal}); closeIngest(target).
   */
  constructor({fetch:fetchImpl=(...args)=>hostFetch(...args),peerFactory=config=>new RTCPeerConnection(config),mediaDevices=globalThis.navigator?.mediaDevices,MediaRecorder:Recorder=globalThis.MediaRecorder,offerIngest=null,closeIngest=null,micTimeoutMs=4000,warmTimeoutMs=5000}={}) {
    super();this.micTimeoutMs=micTimeoutMs;this.warmTimeoutMs=warmTimeoutMs;Object.assign(this,{fetch:fetchImpl,peerFactory,mediaDevices,Recorder,offerIngest,closeIngest});this._state='idle';this.generation=0;this.attempt=null;this.input={deviceId:'',mode:'voice',monitor:null};
  }
  get state(){return this._state;}
  get recording(){return this._state==='recording';}
  get mode(){return this.attempt?.mode;}
  owns(attempt){return !!attempt&&this.attempt===attempt&&attempt.generation===this.generation&&!attempt.cancelled;}
  current(attempt){return this.owns(attempt)&&!attempt.released;}
  check(attempt){if(!this.current(attempt))throw cancelled();}
  setState(state,detail={}){this._state=state;emit(this,'state',{state,...detail});}
  async request(path,options={},attempt=this.attempt) {
    const response=await this.fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers},signal:attempt.abortController.signal});this.check(attempt);
    const data=await response.json().catch(()=>({}));this.check(attempt);
    if(!response.ok){const error=new Error(data.detail||data.error?.message||data.message||data.error||`Cloud input request failed (${response.status}).`);error.status=response.status;error.code=data.code||data.error?.code||(typeof data.error==='string'?data.error:undefined);throw error;}
    return data;
  }
  /** Record source chooser: {deviceId, mode:'voice'|'instrument', monitor:'in'|'auto'|'off'|null}. Takes effect on the next take. */
  setInput(input={}){const next={...this.input};if(typeof input.deviceId==='string')next.deviceId=input.deviceId;if(input.mode==='voice'||input.mode==='instrument')next.mode=input.mode;if(input.monitor===null||RECORD_MONITOR_MODES.includes(input.monitor))next.monitor=input.monitor;this.input=next;emit(this,'input',{...next});return next;}
  /** Studio API v1 live-ingest hooks (set by the app when the typed Studio client is active):
   * {offer(payload,{signal}) → {answer}, startRecording(body,{signal}) → response, finalize(takeId|null,{signal}) → response,
   *  close(clientId), countInBeats() → 0–8, bpm() → number|null, startTransport() → boolean}.
   * When set, start() records over sendLiveIngestOffer + startRecording + take_start/take_stop + finalizeRecording;
   * a failure before take_start falls back to the native ingest / browser capture-upload path below. */
  async start(projectId,trackId,options={}) {
    const studio=this.studio;
    if(studio&&options.legacy!==true){
      try{return await this.startStudio(projectId,trackId,options,studio);}
      catch(error){
        if(error?.name==='AbortError'||NO_FALLBACK.has(studioCode(error))||error?.takeSent||options.allowCaptureOnly===false)throw error;
        emit(this,'warning',{mode:'fallback',code:studioCode(error),message:`Freestyle live-ingest recording is unavailable (${error.message}). Recording through the fallback path.`});
        this.lastStudioFallback={code:studioCode(error),status:error?.status??null,message:String(error?.message||'')};
      }
    }
    return this.startNative(projectId,trackId,options);
  }
  async startStudio(projectId,trackId,{songStartSec=0,laneId=trackId,selfMonitor=false,songClock=null}={},studio) {
    selfMonitor=recordSelfMonitor(this.input?.monitor,selfMonitor);
    if(!projectId||!laneId)throw new Error('Select a Freestyle project and recording lane first.');
    if(!this.mediaDevices?.getUserMedia)throw new Error('This browser does not support microphone capture.');
    this.cancel();
    const attempt={generation:this.generation,abortController:new AbortController(),waiters:new Set(),mode:'live-ingest',studio,cancelled:false,released:false,songStartSec:Math.max(0,Number(songStartSec)||0),songClock};
    const clientId=`abl-input-${globalThis.crypto?.randomUUID?.()||Date.now()}`,takeId=liveTakeId();
    attempt.target=Object.freeze({projectId,trackId,contextTrackId:trackId,laneId,clientId,takeId,generation:attempt.generation});attempt.laneId=laneId;
    this.attempt=attempt;this.setState('connecting');const signal=attempt.abortController.signal;
    attempt.armEnd=deferred();attempt.marks={t0:performance.now()};const mark=name=>{attempt.marks[name]=Math.round(performance.now()-attempt.marks.t0);};
    try{
      // QA r13 speed: the microphone opens in parallel with the uplink (the track joins the sendonly transceiver by
      // replaceTrack, no renegotiation), and an uplink pre-warmed when the track was armed is adopted as is.
      // Round 2 (owner bug 4): a start could stay in "connecting" for ever when the microphone request or the warm uplink
      // never settled. Each wait is bounded; the microphone is asked a second time once before the start fails with a
      // clear error, and a warm uplink that does not come up in time is replaced by a fresh one.
      const openMic=async()=>{let last=null;for(let tries=0;tries<2;tries++){
        const request=this.mediaDevices.getUserMedia(recordingConstraints(this.input));
        // A stream that arrives after its wait gave up is closed, never leaked.
        const stream=await settleWithin(request,this.micTimeoutMs,()=>request.then(late=>late?.getTracks?.().forEach(track=>track.stop()),()=>{})).catch(error=>{last=error;return null;});
        if(stream)return stream;this.check(attempt);
        if(last&&last.code!=='record_wait_timeout')break;/* a refusal (permission, no device) is final */
        mark(`micRetry${tries+1}`);emit(this,'timing',{phase:'mic-retry',takeId,tries:tries+1});
       }
       if(last?.code==='record_wait_timeout')throw Object.assign(new Error('The microphone did not open. Check the input device and the browser’s microphone permission, then press Record again.'),{code:'recording_microphone_timeout'});
       throw last||new Error('The microphone did not open.');};
      const media=openMic().then(stream=>{mark('mic');if(!this.current(attempt)){stream.getTracks().forEach(track=>track.stop());throw cancelled();}attempt.stream=stream;return stream;});media.catch(()=>{});
      const warm=await settleWithin(this.adoptWarm(projectId,laneId,studio,attempt),this.warmTimeoutMs).catch(error=>{if(error?.code!=='record_wait_timeout')throw error;mark('warmTimeout');this.dropPrewarm();return null;});this.check(attempt);
      let uplink;
      if(warm){uplink=warm;attempt.marks.warm=true;}
      else uplink=await this.openUplink({projectId,laneId,clientId,studio,signal,check:()=>this.check(attempt),owner:attempt,mark});
      Object.assign(attempt,{peer:uplink.pc,sender:uplink.sender,channel:uplink.channel,offerDispatched:true});
      attempt.target=Object.freeze({...attempt.target,clientId:uplink.clientId});
      this.bindUplink(attempt,uplink);mark('uplink');
      const stream=await media;this.check(attempt);
      const track=stream.getAudioTracks()[0];if(!track)throw new Error('The microphone did not provide an audio track.');
      await uplink.sender.replaceTrack(track);this.check(attempt);
      // Count-in: the reply returns AT the recording boundary (the engine clicks count_in_beats first).
      const beats=Math.max(0,Math.min(COUNT_IN_MAX_BEATS,Math.round(Number(studio.countInBeats?.())||0))),bpm=Number(studio.bpm?.());
      const body={lane_id:laneId,...beats>0?{count_in_beats:beats,seek_seconds:attempt.songStartSec,start_transport:studio.startTransport?.()!==false,...Number.isFinite(bpm)&&bpm>=20&&bpm<=400?{bpm}:{}}:{}};
      attempt.countInBeats=beats;mark('armRequest');this.setState(beats>0?'counting-in':'arming',{countInBeats:beats,takeId,bpm:Number.isFinite(bpm)?bpm:null,since:performance.now()});
      attempt.armRequested=true;const reply=await studio.startRecording(body,{signal});this.check(attempt);attempt.armed=true;mark('armReply');
      const response=reply?.response??reply??{},countIn=response.count_in||null,template=response.audio?.take_start||response.take_start||{};
      const boundary=[countIn?.recording_start_position_seconds,template.song_start_sec].map(Number).find(value=>Number.isFinite(value)&&value>=0);
      let start=boundary;if(start===undefined){const clock=typeof songClock==='function'?Number(songClock()):NaN;start=Number.isFinite(clock)&&clock>=0?clock:attempt.songStartSec;}
      attempt.songStartSec=start;attempt.countIn=countIn;
      // QA r14: the reply returns AT the recording boundary, so the count-in display ends on this frame (not at take_started).
      if(beats>0)this.setState('arming',{countInBeats:beats,takeId,countIn,boundary:true});
      const acknowledgement=this.waitForMessage(message=>message.type==='take_started'&&String(message.take_id)===takeId,12000,attempt);acknowledgement.catch(()=>{});
      attempt.startedAt=performance.now();this.beginCapture(stream,attempt);/* a local copy for recovery only; the engine records the take */
      this.send({...template,type:'take_start',take_id:takeId,mode:'record',song_start_sec:start,lane_id:laneId,...selfMonitor?{self_monitor:true}:{}},attempt);attempt.takeSent=true;
      const ack=await acknowledgement;this.check(attempt);mark('takeStarted');
      // Freestyle #10: a take_start on a stopped transport rolls it from song_start_sec (started_transport:true).
      const startedTransport=ack?.started_transport===true;attempt.startedTransport=startedTransport;
      emit(this,'timing',{phase:'start',takeId,countInBeats:beats,songStartSec:start,startedTransport,...attempt.marks,t0:undefined});
      this.setState('recording',{takeId,laneId:ack.lane_id||laneId,mode:'live-ingest',countIn,startedTransport});
      return{...ack,mode:'live-ingest',takeId,countIn,songStartSec:start,startedTransport};
    }catch(error){
      if(attempt.takeSent)error.takeSent=true;
      emit(this,'timing',{phase:'start-failed',takeId,code:studioCode(error),...attempt.marks,t0:undefined});
      const owned=this.owns(attempt);await this.releaseStudio(attempt,{disarm:true});
      if(owned&&this.attempt===attempt){this.attempt=null;this.setState('idle');}
      if(!owned||error?.name==='AbortError')throw error?.name==='AbortError'?error:cancelled();
      throw error;
    }
  }
  /** Opens the Studio API live-ingest uplink (sendonly Opus + negotiated channel 200) and starts its 5 s keepalive.
   * owner: the attempt (or warm uplink) whose liveness check() guards each await. Returns {pc,sender,channel,clientId,...}. */
  async openUplink({laneId,clientId,studio,signal,check,owner,mark=()=>{}}){
    let iceServers=[NATIVE_STUN];try{const extra=await studio.iceServers?.();if(Array.isArray(extra)&&extra.length)iceServers=extra;}catch{}check();
    const pc=this.peerFactory({iceServers}),uplink={pc,clientId,laneId,keepalive:0,keepaliveTimer:null};owner.peer=pc;
    // sendonly Opus, the only codec the engine decodes (sendLiveIngestOffer).
    const transceiver=pc.addTransceiver('audio',{direction:'sendonly'});uplink.sender=transceiver.sender;
    try{const codecs=(globalThis.RTCRtpSender?.getCapabilities?.('audio')?.codecs||[]).filter(codec=>/^audio\/opus$/i.test(codec.mimeType));if(codecs.length)transceiver.setCodecPreferences?.(codecs);}catch{}
    const channel=pc.createDataChannel('mozart-live-ingest',{negotiated:true,id:200,ordered:true});uplink.channel=channel;owner.channel=channel;
    await pc.setLocalDescription(await pc.createOffer());check();
    // QA r13: no trickle endpoint, so the offer carries its candidates — but waiting for gathering 'complete' could
    // take the full 8 s when one STUN server / interface never answers. Send once a server-reflexive/relay candidate
    // has settled briefly (or at the cap); host-only networks still wait for completion.
    await this.waitForIce(pc,owner,{fast:true});check();mark('ice');
    owner.offerDispatched=true;
    const offered=await studio.offer({clientId,lane_id:laneId,profile:'regional_music',offer:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}},{signal});check();mark('answer');
    const answer=offered?.answer||offered?.response?.answer||offered?.sdp&&offered;if(!answer?.sdp)throw Object.assign(new Error('Freestyle did not return a live-ingest answer.'),{code:'live_ingest_no_answer'});
    await pc.setRemoteDescription({type:answer.type||'answer',sdp:answer.sdp});check();
    await this.waitForChannel(channel,15000,owner);check();mark('channel');
    // {type:'keepalive', id} every 5 s for the uplink's life (answered keepalive_ack); it also holds the arm.
    uplink.ping=()=>{if(channel.readyState==='open')try{channel.send(JSON.stringify({type:'keepalive',id:++uplink.keepalive}));}catch{}};uplink.ping();uplink.keepaliveTimer=setInterval(()=>uplink.ping(),5000);
    return uplink;
  }
  /** Hands an open uplink to a take attempt: its messages, close and failure now belong to that attempt. */
  bindUplink(attempt,uplink){
    const {pc,channel}=uplink;attempt.keepaliveTimer=uplink.keepaliveTimer;
    channel.onmessage=event=>{if(!this.current(attempt)||typeof event.data!=='string')return;try{this.handleMessage(JSON.parse(event.data),attempt);}catch(error){if(this.current(attempt))emit(this,'error',error);}};
    channel.onclose=()=>{if(this.current(attempt)&&this.recording)this.connectionFailed(attempt,'Freestyle microphone input disconnected before the take stopped.');};
    pc.onconnectionstatechange=()=>{if(this.current(attempt)&&pc.connectionState==='failed')this.connectionFailed(attempt,'The cloud microphone connection failed.');};
  }
  /** Studio Pro-style preconnect: when an audio track is armed, open its live-ingest uplink (no microphone, no arm, no
   * take) so ● only has to open the mic and call startRecording. Replaces a warm uplink for another project/lane. */
  prewarm(projectId,laneId,studio=this.studio){
    if(!studio?.offer||!projectId||!laneId||this.attempt)return null;
    const current=this.warm;if(current&&!current.dead&&current.projectId===projectId&&current.laneId===laneId)return current.promise;
    this.dropPrewarm();
    const warm={projectId,laneId,studio,clientId:`abl-input-${globalThis.crypto?.randomUUID?.()||Date.now()}`,abortController:new AbortController(),dead:false,waiters:new Set(),generation:this.generation,released:false,cancelled:false,marks:{t0:performance.now()}};
    this.warm=warm;const check=()=>{if(warm.dead||this.warm!==warm)throw cancelled();};
    warm.promise=this.openUplink({projectId,laneId,clientId:warm.clientId,studio,signal:warm.abortController.signal,check,owner:warm,mark:name=>{warm.marks[name]=Math.round(performance.now()-warm.marks.t0);}})
      .then(uplink=>{check();warm.uplink=uplink;uplink.channel.onclose=()=>{if(this.warm===warm)this.dropPrewarm();};uplink.pc.onconnectionstatechange=()=>{if(this.warm===warm&&['failed','closed'].includes(uplink.pc.connectionState))this.dropPrewarm();};emit(this,'timing',{phase:'prewarm',laneId,...warm.marks,t0:undefined});return uplink;})
      .catch(error=>{if(this.warm===warm)this.dropPrewarm();emit(this,'timing',{phase:'prewarm-failed',laneId,code:studioCode(error),...warm.marks,t0:undefined});return null;});
    return warm.promise;
  }
  /** Closes a warm (unused) uplink: keepalive off, peer closed, closeLiveIngest. Never touches a take attempt. */
  dropPrewarm(){
    const warm=this.warm;if(!warm)return Promise.resolve();this.warm=null;if(warm.dead)return Promise.resolve();warm.dead=true;warm.abortController.abort();
    clearInterval(warm.uplink?.keepaliveTimer);try{if(warm.channel){warm.channel.onclose=null;warm.channel.onmessage=null;}warm.peer?.close?.();}catch{}
    return warm.offerDispatched?Promise.resolve(warm.studio.close?.(warm.clientId)).catch(()=>{}):Promise.resolve();
  }
  /** A warm uplink for exactly this project and lane, still open, becomes the attempt's uplink (awaits one still opening). */
  async adoptWarm(projectId,laneId,studio,attempt){
    const warm=this.warm;if(!warm||warm.dead||warm.projectId!==projectId||warm.laneId!==laneId||studio?.projectId&&warm.studio?.projectId&&studio.projectId!==warm.studio.projectId)return null;
    const uplink=await warm.promise;if(!this.current(attempt))return null;
    if(this.warm!==warm||warm.dead||!uplink||uplink.channel.readyState!=='open'||['failed','closed','disconnected'].includes(uplink.pc.connectionState)){if(this.warm===warm)this.dropPrewarm();return null;}
    this.warm=null;warm.dead=true;/* now owned by the attempt: releaseStudio closes it */return uplink;
  }
  /** Resolves once this take's engine arm is ended (first finalizeRecording reply, or the disarm on cancel / failure).
   * The shared-transport pause must wait for it: the engine refuses transport_pause while the API arm records
   * (ack code recording_active, live QA r13). Resolves at once when no API arm is held. */
  armEnded(){const attempt=this.attempt;if(!attempt||attempt.mode!=='live-ingest'||!attempt.armEnd)return Promise.resolve();return attempt.armEnd.promise;}
  /** take_stop → finalizeRecording(take_id, confirm) retried while 409 recording_take_pending (spec). */
  async stopStudio(attempt,{songEndSec}={}){
    this.setState('stopping');clearInterval(attempt.syncTimer);const stopAt=performance.now();
    const captureSec=(performance.now()-attempt.startedAt)/1000,end=Number.isFinite(Number(songEndSec))&&Number(songEndSec)>attempt.songStartSec?Number(songEndSec):attempt.songStartSec+captureSec;
    const {takeId,projectId,contextTrackId,generation}=attempt.target;
    const filePromise=this.finishCapture(attempt).catch(()=>null);
    try{
      const stopped=this.waitForMessage(message=>message.type==='take_stopped'&&String(message.take_id)===takeId,4000,attempt);stopped.catch(()=>{});
      this.send({type:'take_stop',take_id:takeId,song_end_sec:end},attempt);attempt.takeSent=false;attempt.takeStopped=true;
      // Freestyle #4: finalize goes out right after take_stop (a finalize that reaches the engine first waits for it),
      // in parallel with the take_stopped receipt and the local recovery copy.
      let saved=null,lastError=null;
      const finalizing=(async()=>{for(let tries=0;tries<12;tries++){
        // Spec: "The caller's own arm always ends here" — the first finalize reply (saved or 409 recording_take_pending)
        // ends our arm, so the shared transport may pause while the take is still saving.
        // wait_for "placed" answers once the clip is on its lane (about a second after take_stop); the save is
        // confirmed in the background (confirmSaved).
        try{saved=await attempt.studio.finalize(takeId,{signal:attempt.abortController.signal,waitFor:'placed'});lastError=null;attempt.armEnd?.settle({finalized:true,engineDisarmed:(saved?.response??saved)?.engine_disarmed??null});break;}
        catch(error){lastError=error;if(Number.isFinite(Number(error?.status)))attempt.armEnd?.settle({finalized:false,code:studioCode(error),status:error.status});if(studioCode(error)!=='recording_take_pending'||error.status!==409)break;await sleep(Math.min(2000,400+tries*200));if(!this.current(attempt))break;}
      }})();
      try{await attempt.sender?.replaceTrack(null);}catch{}
      let stopReceipt=null;try{stopReceipt=await stopped;}catch(error){if(error.code!=='cloud_ack_timeout'){await finalizing.catch(()=>{});throw error;}}
      const file=await filePromise;await finalizing;this.check(attempt);
      if(lastError){
        const code=studioCode(lastError);
        if(code==='recording_take_silent')lastError.message='The take held no audio, so Freestyle saved nothing. Check the input and record again.';
        else if(code==='recording_take_rejected')lastError.message=`Freestyle refused the take (${lastError.message}). Record again.`;
        else if(code==='recording_take_pending')lastError.message='Freestyle is still saving the take. It will appear on the track when it is ready; do not record it again.';
        Object.assign(lastError,{recordingTake:{takeId,projectId,laneId:attempt.laneId,file,mode:'live-ingest',final:code==='recording_take_silent'||code==='recording_take_rejected'}});throw lastError;
      }
      attempt.armed=false;const response=saved?.response??saved??{},placedOnly=response.saved===false;
      const result={takeId,projectId,contextTrackId,laneId:response.lane_id||attempt.laneId,generation,file,duration:captureSec,songStartSec:attempt.songStartSec,songEndSec:end,mode:'live-ingest',stopSent:true,acknowledged:!!stopReceipt,receipt:response,clipId:response.track_id??null,startMs:response.start_ms??null,durationSec:response.duration_sec??null,persisted:!placedOnly,saving:placedOnly,inEngine:response.in_engine??null,needsFinalization:false,countIn:attempt.countIn||null,stopToPlacedMs:Math.round(performance.now()-stopAt)};
      if(placedOnly)result.saved=this.confirmSaved(attempt.studio,result);
      // The uplink close (closeLiveIngest, ~1 s) no longer holds the saved clip back: it finishes in the background.
      const releasing=this.releaseStudio(attempt);releasing.catch(()=>{});result.released=releasing;
      if(this.attempt===attempt)this.attempt=null;this.setState('stopped',result);emit(this,'stopped',result);return result;
    }catch(error){await this.releaseStudio(attempt,{disarm:true});if(this.attempt===attempt){this.attempt=null;this.setState('error',{message:error.message,code:studioCode(error)});}throw error;}
  }
  /** Freestyle #4: after a "placed" answer, call finalizeRecording again with the same take_id (wait_for "saved") until
   * saved:true, a final 422 (the clip is removed: recording_take_rejected) or the retry budget ends. Emits 'saved' or
   * 'save-failed' with the take; resolves {saved, code?}. Never throws. */
  async confirmSaved(studio,take,{tries=12}={}){
    const started=performance.now();let last=null;
    for(let attempt=0;attempt<tries;attempt++){
      try{
        const reply=await studio.finalize(take.takeId,{waitFor:'saved',waitMs:10000}),response=reply?.response??reply??{};
        if(response.saved===false){last={code:'recording_take_pending'};await sleep(500);continue;}
        const detail={...take,file:undefined,saved:undefined,persisted:true,saving:false,receipt:response,clipId:response.track_id??take.clipId,confirmMs:Math.round(performance.now()-started)};
        emit(this,'saved',detail);return{saved:true,confirmMs:detail.confirmMs};
      }catch(error){
        last={code:studioCode(error),status:error?.status??null,requestId:error?.requestId??null};
        if(last.code==='recording_take_pending'&&error.status===409)continue;
        if(Number(error?.status)>=500||error?.status===0||error?.status===429){await sleep(Math.min(4000,600*(attempt+1)));continue;}
        break;
      }
    }
    emit(this,'save-failed',{...take,file:undefined,saved:undefined,...last,final:last?.status===422});
    return{saved:false,...last};
  }
  /** Ends a Studio live-ingest attempt: keepalive off, peer closed, uplink closed (closeLiveIngest) and, when the arm
   * was requested but no take was finalized, the arm ended (finalizeRecording without take_id). Best effort, once. */
  releaseStudio(attempt,{disarm=false}={}){
    if(!attempt)return Promise.resolve();clearInterval(attempt.keepaliveTimer);clearInterval(attempt.syncTimer);
    if(!attempt.released){attempt.released=true;this.rejectWaiters(cancelled(),attempt);if(attempt.recorder?.state==='recording')try{attempt.recorder.stop();}catch{}this.closePeer(attempt);attempt.stream?.getTracks().forEach(track=>track.stop());attempt.stream=null;}
    if(attempt.studioCleanup)return attempt.studioCleanup;
    attempt.studioCleanup=(async()=>{
      try{if(disarm&&attempt.armRequested&&attempt.armed!==false)try{await attempt.studio.finalize(null,{});}catch(error){attempt.cleanupError=error;}}
      finally{attempt.armEnd?.settle({disarmed:true});}
      if(attempt.offerDispatched)try{await attempt.studio.close?.(attempt.target.clientId);}catch(error){attempt.cleanupError=error;}
    })();return attempt.studioCleanup;
  }
  async startNative(projectId,trackId,{songStartSec=0,laneId=trackId,selfMonitor=false,songClock=null,allowCaptureOnly=true}={}) {
    selfMonitor=recordSelfMonitor(this.input?.monitor,selfMonitor);
    if(!projectId||!trackId)throw new Error('Select a Freestyle project and recording lane first.');
    if(!this.mediaDevices?.getUserMedia)throw new Error('This browser does not support microphone capture.');
    this.cancel();
    const attempt={generation:this.generation,abortController:new AbortController(),waiters:new Set(),mode:'native-ingest',cancelled:false,released:false,songStartSec:Math.max(0,Number(songStartSec)||0),songClock};
    const clientId=`vegetable-input-${globalThis.crypto?.randomUUID?.()||Date.now()}`,takeId=`vegetable-take-${globalThis.crypto?.randomUUID?.()||Date.now()}`;
    attempt.target=Object.freeze({projectId,trackId,contextTrackId:trackId,laneId,clientId,takeId,generation:attempt.generation});attempt.laneId=laneId;
    this.attempt=attempt;this.setState('connecting');
    try {
      // Check the upstream audio grant before requesting microphone permission.
      const ice=await this.request(`/api/audio/ice?project_id=${encodeURIComponent(projectId)}`,{},attempt);this.check(attempt);
      const stream=await this.mediaDevices.getUserMedia(recordingConstraints(this.input));
      if(!this.current(attempt)){stream.getTracks().forEach(track=>track.stop());return false;}
      attempt.stream=stream;const track=stream.getAudioTracks()[0];if(!track)throw new Error('The microphone did not provide an audio track.');
      const iceServers=Array.isArray(ice.iceServers)?ice.iceServers:[NATIVE_STUN,...ice.urls?.length?[{urls:ice.urls,username:ice.username,credential:ice.credential}]:[]];
      const pc=this.peerFactory({iceServers});attempt.peer=pc;
      const transceiver=pc.addTransceiver('audio',{direction:'sendonly'}),sender=transceiver.sender;attempt.sender=sender;
      try{const codecs=(globalThis.RTCRtpSender?.getCapabilities?.('audio')?.codecs||[]).filter(codec=>/^audio\/opus$/i.test(codec.mimeType));if(codecs.length)transceiver.setCodecPreferences?.(codecs);}catch{}
      const channel=pc.createDataChannel('mozart-live-ingest',{negotiated:true,id:200,ordered:true});attempt.channel=channel;
      channel.onmessage=event=>{if(!this.current(attempt)||typeof event.data!=='string')return;try{this.handleMessage(JSON.parse(event.data),attempt);}catch(error){if(this.current(attempt))emit(this,'error',error);}};
      channel.onclose=()=>{if(this.current(attempt)&&this.recording)this.connectionFailed(attempt,'Freestyle microphone input disconnected before the take stopped.');};
      pc.onconnectionstatechange=()=>{if(this.current(attempt)&&pc.connectionState==='failed')this.connectionFailed(attempt,'The cloud microphone connection failed.');};
      const offer=await pc.createOffer();this.check(attempt);
      await pc.setLocalDescription(offer);this.check(attempt);
      await this.waitForIce(pc,attempt);this.check(attempt);
      const payload={clientId,lane_id:laneId,profile:'regional_music',offer:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}};
      attempt.offerDispatched=true;attempt.offerPending=true;attempt.offerDone=new Promise(resolve=>{attempt.finishOffer=resolve;});
      let result;
      try{result=await (this.offerIngest?this.offerIngest(attempt.target,payload,{signal:attempt.abortController.signal}):this.request('/api/audio/ingest-offer',{method:'POST',body:JSON.stringify({project_id:projectId,track_id:trackId,...payload})},attempt));}
      finally{attempt.offerPending=false;attempt.finishOffer();}
      this.check(attempt);
      const answer=result.answer||result.response?.answer;if(!answer?.sdp)throw new Error('Freestyle did not return a microphone ingest answer.');
      await pc.setRemoteDescription({type:answer.type||'answer',sdp:answer.sdp});this.check(attempt);
      await this.waitForChannel(channel,15000,attempt);this.check(attempt);
      await sender.replaceTrack(track);this.check(attempt);
      const acknowledgement=this.waitForMessage(message=>message.type==='take_started'&&String(message.take_id)===takeId,12000,attempt);
      // Cancellation can reject a waiter while an asynchronous sender is pending.
      acknowledgement.catch(()=>{});
      this.send({type:'room_unmute'},attempt);
      attempt.startedAt=performance.now();this.beginCapture(stream,attempt);
      this.send({type:'take_start',take_id:takeId,song_start_sec:attempt.songStartSec,engine_mode:true,mode:'record',self_monitor:!!selfMonitor,loop_comp_ms:0,...laneId?{lane_id:laneId}:{}},attempt);
      attempt.takeSent=true;
      const ack=await acknowledgement;this.check(attempt);
      this.setState('recording',{takeId,laneId:ack.lane_id||laneId});
      attempt.syncTimer=setInterval(()=>{
        if(!this.current(attempt)||!this.recording)return;
        const elapsed=(performance.now()-attempt.startedAt)/1000;
        const song=typeof attempt.songClock==='function'?Number(attempt.songClock()):attempt.songStartSec+elapsed;
        if(Number.isFinite(song))try{this.send({type:'sync',take_id:takeId,song_sec:Math.max(0,song),wall_ms:Date.now(),capture_sec:elapsed},attempt);}catch(error){if(this.current(attempt))emit(this,'error',error);}
      },100);
      return {...ack,mode:attempt.mode};
    } catch(error) {
      if(!this.current(attempt)){this.release(attempt);return false;}
      if(allowCaptureOnly&&(error.status===401||error.status===403||error.code==='cloud_audio_auth_required')&&!attempt.takeSent) {
        try {
          this.closePeer(attempt);this.cleanupIngest(attempt);
          if(!attempt.stream){const stream=await this.mediaDevices.getUserMedia(recordingConstraints(this.input));if(!this.current(attempt)){stream.getTracks().forEach(track=>track.stop());return false;}attempt.stream=stream;}
          this.check(attempt);attempt.mode='capture-upload';attempt.startedAt=performance.now();this.beginCapture(attempt.stream,attempt);
          const result={mode:attempt.mode,takeId,warning:'The cloud microphone stream requires engine authorization. This take is captured by the browser and must be uploaded to the cloud when stopped.'};
          this.setState('recording',result);emit(this,'warning',result);return result;
        } catch(captureError) {error=captureError;}
      }
      this.release(attempt);if(!this.owns(attempt))return false;
      this.setState('error',{message:error.message,code:error.code,status:error.status});emit(this,'error',error);throw error;
    }
  }
  connectionFailed(attempt,message){if(!this.current(attempt))return;const error=new Error(message);this.rejectWaiters(error,attempt);this.release(attempt);if(this.owns(attempt)){this.setState('error',{message});emit(this,'error',error);}}
  beginCapture(stream,attempt=this.attempt) {
    this.check(attempt);if(!this.Recorder)throw new Error('This browser does not support microphone file capture.');
    const mimeType=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type=>this.Recorder.isTypeSupported?.(type));
    const chunks=[];attempt.chunks=chunks;attempt.captureError=null;const recorder=new this.Recorder(stream,mimeType?{mimeType}:{});attempt.recorder=recorder;
    recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
    recorder.onerror=event=>{attempt.captureError=event.error||new Error('Microphone file capture failed.');if(this.current(attempt))emit(this,'error',attempt.captureError);};
    recorder.start(1000);
  }
  async finishCapture(attempt=this.attempt) {
    const recorder=attempt.recorder;if(!recorder)return null;
    if(recorder.state!=='inactive'){await new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=event=>reject(event.error||new Error('Microphone file capture failed.'));recorder.stop();});this.check(attempt);}
    this.check(attempt);if(!attempt.chunks.length)throw attempt.captureError||new Error('The microphone capture contained no encoded audio.');
    const mime=recorder.mimeType||attempt.chunks[0]?.type||'audio/webm',extension=mime.includes('mp4')?'m4a':'webm';
    return new File(attempt.chunks,`Vegetable recording ${new Date().toISOString().replaceAll(':','-')}.${extension}`,{type:mime});
  }
  handleMessage(message,attempt=this.attempt) {
    if(!this.current(attempt))return;
    if(message.type==='ping'){this.send({type:'pong',id:message.id},attempt);return;}
    if(message.type==='keepalive_ack')return;
    if(message.type==='take_refused'||message.type==='uplink_revoked'){
      const error=new Error(message.message||`Freestyle refused the take (${message.code||message.type}).`);error.code=message.code||message.type;error.status=message.status??null;error.closing=message.closing===true||message.type==='uplink_revoked';
      this.rejectWaiters(error,attempt);emit(this,'error',error);if(this.recording&&error.closing)this.connectionFailed(attempt,error.message);return;
    }
    if(message.type==='error'||message.type==='take_superseded') {
      const error=new Error(message.message||message.reason||message.code||'The cloud engine rejected the recording.');error.code=message.code||message.type;
      this.rejectWaiters(error,attempt);emit(this,'error',error);return;
    }
    if(message.lane_id)attempt.laneId=message.lane_id;
    emit(this,'message',message);
    for(const waiter of [...attempt.waiters])if(waiter.match(message))waiter.finish(null,message);
  }
  send(payload,attempt=this.attempt) {
    this.check(attempt);if(attempt.channel?.readyState!=='open')throw new Error('The cloud microphone control channel is unavailable.');attempt.channel.send(JSON.stringify(payload));
  }
  async stop({songEndSec}={}) {
    const attempt=this.attempt;if(!this.recording||!this.current(attempt))throw new Error('No acknowledged cloud microphone take is recording.');
    if(attempt.mode==='live-ingest')return this.stopStudio(attempt,{songEndSec});
    this.setState('stopping');clearInterval(attempt.syncTimer);
    const captureSec=(performance.now()-attempt.startedAt)/1000,end=Number.isFinite(Number(songEndSec))?Math.max(0,Number(songEndSec)):attempt.songStartSec+captureSec;
    const {takeId,projectId,contextTrackId,generation}=attempt.target;
    const filePromise=this.finishCapture(attempt);filePromise.catch(()=>{});
    try{
      let receipt=null;
      if(attempt.mode!=='capture-upload'){
        // Placement is timing evidence, not proof of a persisted clip.
        const pending=this.waitForMessage(message=>message.type==='live_placement'&&String(message.take_id)===takeId&&message.reason==='take_stop',4000,attempt);pending.catch(()=>{});
        this.send({type:'take_stop',take_id:takeId,song_end_sec:end,capture_end_sec:captureSec},attempt);attempt.takeSent=false;
        try{await attempt.sender?.replaceTrack(null);}catch{}this.check(attempt);
        attempt.stream?.getTracks().forEach(track=>track.stop());
        try{receipt=await pending;}catch(error){if(error.code!=='cloud_ack_timeout')throw error;}this.check(attempt);
      }
      const file=await filePromise;this.check(attempt);
      const result={takeId,projectId,contextTrackId,laneId:attempt.laneId,generation,file,duration:captureSec,songStartSec:attempt.songStartSec,mode:attempt.mode,stopSent:attempt.mode!=='capture-upload',acknowledged:!!receipt,...(attempt.mode!=='capture-upload'?{receipt}:{}),persisted:false,needsFinalization:true};
      this.release(attempt);if(!this.owns(attempt))throw cancelled();this.setState('stopped',result);emit(this,'stopped',result);return result;
    }catch(error){this.release(attempt);if(this.owns(attempt))this.setState('error',{message:error.message});throw error;}
  }
  waitForMessage(match,timeout,attempt=this.attempt) {
    this.check(attempt);return new Promise((resolve,reject)=>{
      const waiter={match,finish:(error,message)=>{clearTimeout(timer);attempt.waiters.delete(waiter);error?reject(error):resolve(message);}};
      const timer=setTimeout(()=>{const error=new Error('The cloud engine did not acknowledge this recording operation.');error.code='cloud_ack_timeout';waiter.finish(error);},timeout);attempt.waiters.add(waiter);
    });
  }
  /** fast (live-ingest): resolve settleMs after the first srflx/relay candidate, or at capMs once any candidate exists. */
  waitForIce(pc,attempt=this.attempt,{fast=false,settleMs=150,capMs=1500}={}) {
    if(attempt===this.attempt||attempt?.mode)this.check(attempt);else if(attempt?.dead)return Promise.reject(cancelled());
    if(pc.iceGatheringState==='complete')return Promise.resolve();
    return new Promise((resolve,reject)=>{const signal=attempt.abortController.signal;let settle=null,any=false;
      const finish=error=>{clearTimeout(timer);clearTimeout(settle);clearTimeout(cap);pc.removeEventListener('icegatheringstatechange',change);pc.removeEventListener?.('icecandidate',candidate);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
      const change=()=>{if(pc.iceGatheringState==='complete')finish();},abort=()=>finish(cancelled()),timer=setTimeout(()=>finish(),8000);
      const candidate=event=>{const text=String(event?.candidate?.candidate||'');if(!text)return;any=true;if(settle===null&&/ typ (srflx|relay)\b/.test(text))settle=setTimeout(()=>finish(),settleMs);};
      const cap=fast?setTimeout(()=>{if(any)finish();},capMs):null;
      pc.addEventListener('icegatheringstatechange',change);if(fast)pc.addEventListener?.('icecandidate',candidate);signal.addEventListener('abort',abort,{once:true});});
  }
  waitForChannel(channel,timeout,attempt=this.attempt) {
    if(attempt?.mode||attempt===this.attempt)this.check(attempt);else if(attempt?.dead)return Promise.reject(cancelled());
    if(channel.readyState==='open')return Promise.resolve();
    return new Promise((resolve,reject)=>{const signal=attempt.abortController.signal,finish=error=>{clearTimeout(timer);channel.removeEventListener('open',open);channel.removeEventListener('close',close);signal.removeEventListener('abort',abort);error?reject(error):resolve();},open=()=>finish(),close=()=>finish(new Error('The cloud microphone channel closed.')),abort=()=>finish(cancelled()),timer=setTimeout(()=>finish(new Error('Timed out opening the cloud microphone channel.')),timeout);channel.addEventListener('open',open,{once:true});channel.addEventListener('close',close,{once:true});signal.addEventListener('abort',abort,{once:true});});
  }
  rejectWaiters(error,attempt=this.attempt){if(attempt)for(const waiter of [...attempt.waiters])waiter.finish(error);}
  closePeer(attempt){if(!attempt.peer)return;attempt.peer.onconnectionstatechange=null;if(attempt.channel){attempt.channel.onclose=null;attempt.channel.onmessage=null;}attempt.peer.close();attempt.peer=null;}
  cleanupIngest(attempt){
    if(!attempt?.offerDispatched||!this.closeIngest)return Promise.resolve();
    if(attempt.cleanupPromise)return attempt.cleanupPromise;
    // A close sent before a delayed offer creates its client could miss it.
    attempt.cleanupPromise=(async()=>{if(attempt.offerPending)await attempt.offerDone;try{return await this.closeIngest(attempt.target);}catch(error){attempt.cleanupError=error;return{ok:false,error:error.message};}})();return attempt.cleanupPromise;
  }
  release(attempt=this.attempt) {
    if(attempt?.mode==='live-ingest')return this.releaseStudio(attempt,{disarm:true});
    if(!attempt)return Promise.resolve();clearInterval(attempt.syncTimer);
    if(!attempt.released){attempt.released=true;this.rejectWaiters(cancelled(),attempt);if(attempt.recorder?.state==='recording')try{attempt.recorder.stop();}catch{}this.closePeer(attempt);attempt.stream?.getTracks().forEach(track=>track.stop());attempt.stream=null;}
    return this.cleanupIngest(attempt);
  }
  cancel() {
    const attempt=this.attempt;
    if(attempt?.mode==='live-ingest'){this.generation++;attempt.cancelled=true;attempt.abortController.abort();this.rejectWaiters(cancelled(),attempt);this.attempt=null;const cleanup=this.releaseStudio(attempt,{disarm:true});this.setState('idle');return cleanup;}
    if(attempt&&this.current(attempt)&&attempt.takeSent&&attempt.channel?.readyState==='open')try{this.send({type:'take_cancel',take_id:attempt.target.takeId,song_end_sec:attempt.songStartSec+(performance.now()-attempt.startedAt)/1000},attempt);}catch{}
    this.generation++;if(attempt){attempt.cancelled=true;attempt.abortController.abort();this.rejectWaiters(cancelled(),attempt);}this.attempt=null;const cleanup=this.release(attempt);this.setState('idle');return cleanup;
  }
}
