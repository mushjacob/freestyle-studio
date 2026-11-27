import {hostFetch} from './freestyle-host-transport.js';
/** Stream microphone input into Freestyle's live-ingest uplink (Studio API sendLiveIngestOffer).
 *
 * Contract (docs/studio-api-openapi.json: sendLiveIngestOffer / startRecording /
 * finalizeRecording, as the Freestyle Studio uses them):
 *  - sendonly audio offering Opus as the ONLY audio codec (setCodecPreferences plus
 *    SDP munging, mono Opus fmtp like Pro: useinbandfec=1;stereo=0;maxaveragebitrate≥96k),
 *    tailnet host candidates filtered as Pro does;
 *  - negotiated, ordered data channel id 200 labelled mozart-live-ingest;
 *  - {type:'keepalive', id} every 5 s from channel open (answered keepalive_ack);
 *  - optional `arm` hook (startRecording, count-in) BEFORE take_start; take_start
 *    uses the reply's audio.take_start template plus our single-use take_id;
 *  - take_stop {take_id, song_end_sec = song_start_sec + take length};
 *  - optional `finalize` hook (finalizeRecording) runs while the uplink is still open.
 * Microphone permission is requested first, inside the Record gesture.
 */
import {nativeFilterIceSdp,nativeAllowTailnetCandidates} from './cloud-monitor-sdp.js';
const NATIVE_STUN={urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']};
export const LIVE_INGEST_CHANNEL_LABEL='mozart-live-ingest';
export const LIVE_INGEST_CHANNEL_ID=200;
export const KEEPALIVE_INTERVAL_MS=5000;
/** Pro closes an uplink that went silent this long after Mozart first spoke. */
export const KEEPALIVE_TIMEOUT_MS=16000;
export const OPUS_MIN_BITRATE=96000;
/** The Freestyle Studio's ICE gather: complete, or 400 ms after the first relay candidate, else 2.5 s. */
export const ICE_RELAY_SETTLE_MS=400;
export const ICE_GATHER_TIMEOUT_MS=2500;
const MIC_CONSTRAINTS={audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}};
const emit=(target,type,detail)=>target.dispatchEvent(new CustomEvent(type,{detail}));
const cancelled=()=>new DOMException('Cloud recording cancelled.','AbortError');
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const uuid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;

/** take_id: [A-Za-z0-9_-], 1–96 characters, no '__' (startRecording). */
export function validTakeId(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(value)&&!value.includes('__');}
/** A fresh single-use take id; ids are never reused (take_id_in_use). */
export function liveIngestTakeId(random=uuid){const id=`illogic-take-${String(random()).replace(/[^A-Za-z0-9-]/g,'').replace(/-+/g,'-')}`.slice(0,96);if(!validTakeId(id))throw Object.assign(new Error('Could not create a valid recording take id.'),{code:'take_id_invalid'});return id;}

/** Keep only Opus in every audio m-section (the engine decodes Opus only) and set
 * Pro's mono Opus fmtp. Throws when the browser offered no Opus. */
export function opusOnlyOfferSdp(sdp,{bitrate=OPUS_MIN_BITRATE}={}){
 const value=String(sdp||'');const eol=value.includes('\r\n')?'\r\n':'\n',lines=value.split(/\r?\n/);
 const sections=[];let current={header:null,lines:[]};sections.push(current);
 for(const line of lines){if(line.startsWith('m=')){current={header:line,lines:[]};sections.push(current);}else current.lines.push(line);}
 let audio=0;
 const out=[...sections[0].lines];
 for(const section of sections.slice(1)){
  if(!/^m=audio\s/.test(section.header)){out.push(section.header,...section.lines);continue;}
  audio++;const parts=section.header.split(' '),payloads=parts.slice(3);
  const opus=new Set(section.lines.map(line=>/^a=rtpmap:(\d+)\s+opus\/48000(?:\/\d+)?\s*$/i.exec(line)?.[1]).filter(Boolean));
  const kept=payloads.filter(pt=>opus.has(pt));
  if(!kept.length)throw Object.assign(new Error('This browser did not offer the Opus codec that Freestyle microphone input requires.'),{code:'live_ingest_opus_unavailable'});
  const body=[];
  for(const line of section.lines){
   const pt=/^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)[\s]/.exec(line)?.[1];
   if(pt!==undefined&&!kept.includes(pt))continue;
   const f=/^a=fmtp:(\d+) (.*)$/.exec(line);
   if(f){const params=f[2].split(';').map(item=>item.trim()).filter(Boolean).map(item=>{const at=item.indexOf('=');return at>0?[item.slice(0,at).trim().toLowerCase(),item.slice(at+1).trim()]:[item,''];});
    for(const [key,setting] of Object.entries({maxaveragebitrate:String(bitrate),useinbandfec:'1',stereo:'0'})){const found=params.find(param=>param[0]===key);if(found)found[1]=key==='maxaveragebitrate'?String(Math.max(Number(found[1])||0,bitrate)):setting;else params.push([key,setting]);}
    body.push(`a=fmtp:${f[1]} ${params.map(([key,setting])=>setting===''?key:`${key}=${setting}`).join(';')}`);continue;}
   body.push(line);
   const rtpmap=/^a=rtpmap:(\d+)\s+opus\/48000/i.exec(line)?.[1];
   if(rtpmap&&kept.includes(rtpmap)&&!section.lines.some(other=>other.startsWith(`a=fmtp:${rtpmap} `))){body.push(`a=fmtp:${rtpmap} minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=${bitrate}`);}
  }
  out.push([...parts.slice(0,3),...kept].join(' '),...body);
 }
 if(!audio)throw Object.assign(new Error('The microphone offer has no audio section.'),{code:'live_ingest_opus_unavailable'});
 return out.join(eol);
}
/** Clear user-facing microphone permission/device errors. */
export function microphoneError(error){
 const name=String(error?.name||'');
 if(['NotAllowedError','PermissionDeniedError','SecurityError'].includes(name))return Object.assign(new Error('Microphone access was denied. Allow microphone access for this site (address bar ▸ site settings ▸ Microphone), then press Record again.'),{code:'microphone_permission_denied',cause:error});
 if(['NotFoundError','DevicesNotFoundError','OverconstrainedError'].includes(name))return Object.assign(new Error('No microphone was found. Connect an input device, then press Record again.'),{code:'microphone_not_found',cause:error});
 if(['NotReadableError','TrackStartError','AbortError'].includes(name))return Object.assign(new Error('The microphone is in use by another application or could not start.'),{code:'microphone_unavailable',cause:error});
 return error instanceof Error?error:new Error(String(error||'Microphone capture failed.'));
}
const TAKE_REFUSALS={
 take_id_in_use:'Freestyle refused this take id (already used). Press Record again.',
 take_id_invalid:'Freestyle refused the take id. Press Record again.',
 oauth_grant_revoked:'The Freestyle authorization for recording was revoked. Reconnect Freestyle, then record again.',
 project_write_forbidden:'You do not have write access to record in this project.',
 peer_delegation_write_required:'The microphone connection’s access window ended. Press Record again.',
 permission_lookup_unavailable:'Freestyle could not confirm recording permission right now. Press Record again.',
};

export class CloudRecorder extends EventTarget {
  /** Optional transport callbacks receive captured identities, never the active
   * project. They must not retry uncertain mutations.
   * offerIngest(target, payload, {signal}); closeIngest(target).
   * Per take (start options): arm({target,takeId,laneId,songStartSec,signal}) →
   * {songStartSec?, takeStart?, transportStarted?, captureOnly?, disarm?};
   * finalize({target,takeId,laneId,songStartSec,songEndSec,signal}) → receipt.
   */
  constructor({fetch:fetchImpl=(...args)=>hostFetch(...args),peerFactory=config=>new RTCPeerConnection(config),mediaDevices=globalThis.navigator?.mediaDevices,MediaRecorder:Recorder=globalThis.MediaRecorder,offerIngest=null,closeIngest=null,iceServers=null,keepaliveIntervalMs=KEEPALIVE_INTERVAL_MS,keepaliveTimeoutMs=KEEPALIVE_TIMEOUT_MS,interval=(fn,ms)=>setInterval(fn,ms),clearInterval:clear=id=>clearInterval(id),now=()=>performance.now(),codecCapabilities=()=>globalThis.RTCRtpSender?.getCapabilities?.('audio')?.codecs||[],allowTailnet=()=>nativeAllowTailnetCandidates()}={}) {
    super();Object.assign(this,{fetch:fetchImpl,peerFactory,mediaDevices,Recorder,offerIngest,closeIngest,iceServersFor:iceServers,keepaliveIntervalMs,keepaliveTimeoutMs,interval,clearTimer:clear,now,codecCapabilities,allowTailnet});this._state='idle';this.generation=0;this.attempt=null;
  }
  get state(){return this._state;}
  get recording(){return this._state==='recording';}
  get mode(){return this.attempt?.mode;}
  owns(attempt){return !!attempt&&this.attempt===attempt&&attempt.generation===this.generation&&!attempt.cancelled;}
  current(attempt){return this.owns(attempt)&&!attempt.released;}
  check(attempt){if(!this.current(attempt))throw cancelled();}
  setState(state,detail={}){this._state=state;emit(this,'state',{state,...detail});}
  /** Microphone level (0..1) from the uplink's WebRTC media-source statistics, or null. Display only: nothing is decoded or processed locally. */
  async inputLevel(){
    const attempt=this.attempt,source=attempt?.sender?.getStats?attempt.sender:attempt?.peer;if(!source?.getStats)return null;
    try{const stats=await source.getStats();let level=null;stats.forEach(report=>{if(report.type==='media-source'&&(report.kind==='audio'||report.kind===undefined)&&typeof report.audioLevel==='number')level=report.audioLevel;});return level;}catch{return null;}
  }
  /** Phase timing in ms since the Record gesture (recording-timing diagnostic). */
  mark(attempt,phase){if(attempt?.timing&&attempt.timing[phase]===undefined)attempt.timing[phase]=Math.round(this.now()-attempt.t0);}
  async request(path,options={},attempt=this.attempt) {
    const response=await this.fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers},signal:attempt.abortController.signal});this.check(attempt);
    const data=await response.json().catch(()=>({}));this.check(attempt);
    if(!response.ok){const error=new Error(data.detail||data.error?.message||data.message||data.error||`Cloud input request failed (${response.status}).`);error.status=response.status;error.code=data.code||data.error?.code||(typeof data.error==='string'?data.error:undefined);throw error;}
    return data;
  }
  async iceConfiguration(attempt){
    const servers=this.iceServersFor?await this.iceServersFor(attempt.target):null;this.check(attempt);
    if(Array.isArray(servers)&&servers.length)return servers;
    const ice=await this.request(`/api/audio/ice?project_id=${encodeURIComponent(attempt.target.projectId)}`,{},attempt);
    return Array.isArray(ice.iceServers)?ice.iceServers:[NATIVE_STUN,...ice.urls?.length?[{urls:ice.urls,username:ice.username,credential:ice.credential}]:[]];
  }
  /** A record-enabled track opens its microphone uplink ahead of Record (Logic: an armed track is live):
   * the connection (microphone, ICE, offer, data channel) is ready, so Record only arms the take. */
  warmUsable(warm,projectId,trackId,laneId){
    if(!warm||!this.current(warm)||warm.adopted||warm.target.projectId!==projectId||warm.target.trackId!==trackId||warm.laneId!==laneId)return false;
    const state=warm.peer?.connectionState;if(['failed','closed','disconnected'].includes(state))return false;
    return !warm.warmReady||warm.channel?.readyState==='open';
  }
  prewarm(projectId,trackId,{laneId=trackId}={}){
    if(!projectId||!trackId||!this.mediaDevices?.getUserMedia)return false;
    if(this.warm&&this.warmUsable(this.warm,projectId,trackId,laneId))return true;
    if(this.recording||['connecting','stopping'].includes(this._state))return false;
    const promise=this.start(projectId,trackId,{laneId,prewarmOnly:true});if(this.warm)this.warm.promise=promise;promise.catch(()=>{});return true;
  }
  /** Close an unused warm uplink (track disarmed, project changed). */
  dropPrewarm(){const warm=this.warm;if(!warm)return false;this.warm=null;if(this.attempt===warm&&!warm.adopted){this.cancel();return true;}return false;}
  async start(projectId,trackId,{songStartSec=0,laneId=trackId,selfMonitor=false,songClock=null,allowCaptureOnly=true,arm=null,finalize=null,prewarmOnly=false}={}) {
    if(!projectId||!trackId)throw new Error('Select a Freestyle project and recording lane first.');
    if(!this.mediaDevices?.getUserMedia)throw new Error('This browser does not support microphone capture.');
    if(!prewarmOnly){
      const warm=this.warm;this.warm=null;
      if(warm&&warm.promise&&this.warmUsable(warm,projectId,trackId,laneId)){
        // Adopt the warm uplink: this take's options replace the placeholders and the gate opens.
        warm.adopted=true;warm.timing={warm:{...warm.timing,readyBeforeRecord:!!warm.warmReady}};warm.t0=this.now();
        Object.assign(warm,{songStartSec:Math.max(0,Number(songStartSec)||0),songClock,arm,finalize,options:{selfMonitor,allowCaptureOnly}});
        this.setState('connecting');warm.openGate();return warm.promise;
      }
    }
    this.cancel();
    const attempt={generation:this.generation,abortController:new AbortController(),waiters:new Set(),mode:'native-ingest',cancelled:false,released:false,songStartSec:Math.max(0,Number(songStartSec)||0),songClock,arm,finalize,keepaliveSeq:0,timing:{}};attempt.t0=this.now();
    const clientId=`illogic-input-${uuid()}`,takeId=liveIngestTakeId();
    attempt.target=Object.freeze({projectId,trackId,contextTrackId:trackId,laneId,clientId,takeId,generation:attempt.generation});attempt.laneId=laneId;
    this.attempt=attempt;
    if(prewarmOnly){attempt.prewarm=true;attempt.gate=new Promise(resolve=>{attempt.openGate=resolve;});this.warm=attempt;}else this.setState('connecting');
    try {
      // Ask for the microphone first, inside the Record gesture; ICE configuration loads meanwhile.
      const micRequest=this.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      const icePromise=this.iceConfiguration(attempt).then(value=>{this.mark(attempt,'ice_config');return value;});icePromise.catch(()=>{});
      let stream;try{stream=await micRequest;}catch(error){if(!this.current(attempt))return false;throw microphoneError(error);}
      this.mark(attempt,'mic');
      if(!this.current(attempt)){stream.getTracks().forEach(track=>track.stop());return false;}
      attempt.stream=stream;const track=stream.getAudioTracks()[0];if(!track)throw new Error('The microphone did not provide an audio track.');
      const iceServers=await icePromise;this.check(attempt);
      const pc=this.peerFactory({iceServers});attempt.peer=pc;
      const transceiver=pc.addTransceiver('audio',{direction:'sendonly'}),sender=transceiver.sender;attempt.sender=sender;
      try{const codecs=(this.codecCapabilities()||[]).filter(codec=>/^audio\/opus$/i.test(codec.mimeType));if(codecs.length)transceiver.setCodecPreferences?.(codecs);}catch{}
      const channel=pc.createDataChannel(LIVE_INGEST_CHANNEL_LABEL,{negotiated:true,id:LIVE_INGEST_CHANNEL_ID,ordered:true});attempt.channel=channel;
      channel.onmessage=event=>{if(!this.current(attempt)||typeof event.data!=='string')return;attempt.lastHeardAt=this.now();attempt.mozartSpoke=true;try{this.handleMessage(JSON.parse(event.data),attempt);}catch(error){if(this.current(attempt))emit(this,'error',error);}};
      channel.onclose=()=>{if(this.current(attempt)&&(this.recording||this._state==='stopping'))this.connectionFailed(attempt,'Freestyle microphone input disconnected before the take stopped.');};
      pc.onconnectionstatechange=()=>{if(this.current(attempt)&&pc.connectionState==='failed')this.connectionFailed(attempt,'The cloud microphone connection failed.');};
      const offer=await pc.createOffer();this.check(attempt);
      await pc.setLocalDescription(offer);this.check(attempt);
      await this.waitForIce(pc,attempt);this.check(attempt);this.mark(attempt,'ice_gathered');
      const allowTailnet=!!this.allowTailnet();
      const sdp=opusOnlyOfferSdp(nativeFilterIceSdp(pc.localDescription.sdp,{allowTailnet}).sdp);
      const payload={clientId,lane_id:laneId,profile:'regional_music',offer:{type:pc.localDescription.type||'offer',sdp}};
      attempt.offerDispatched=true;attempt.offerPending=true;attempt.offerDone=new Promise(resolve=>{attempt.finishOffer=resolve;});
      let result;
      try{result=await (this.offerIngest?this.offerIngest(attempt.target,payload,{signal:attempt.abortController.signal}):this.request('/api/audio/ingest-offer',{method:'POST',body:JSON.stringify({project_id:projectId,track_id:trackId,...payload})},attempt));}
      finally{attempt.offerPending=false;attempt.finishOffer();}
      this.check(attempt);this.mark(attempt,'offer_answered');
      const answer=result?.answer||result?.response?.answer;if(!answer?.sdp)throw new Error('Freestyle did not return a microphone ingest answer.');
      await pc.setRemoteDescription({type:answer.type||'answer',sdp:nativeFilterIceSdp(answer.sdp,{allowTailnet}).sdp});this.check(attempt);
      await this.waitForChannel(channel,15000,attempt);this.check(attempt);this.mark(attempt,'channel_open');
      this.startKeepalive(attempt);
      await sender.replaceTrack(track);this.check(attempt);
      try{const parameters=sender.getParameters?.();if(parameters?.encodings?.length){parameters.encodings[0].maxBitrate=OPUS_MIN_BITRATE;await sender.setParameters(parameters);}}catch{}this.check(attempt);
      if(attempt.prewarm){
        // Standing by with the uplink open until Record adopts it (start()) or the track is disarmed (dropPrewarm()).
        this.mark(attempt,'warm_ready');attempt.warmReady=true;emit(this,'warm',{laneId});
        await attempt.gate;this.check(attempt);({selfMonitor,allowCaptureOnly}=attempt.options||{selfMonitor:false,allowCaptureOnly:true});
      }
      // startRecording (count-in) arms the engine; with count-in it returns at the boundary.
      let armed=null;
      if(attempt.arm){
        this.mark(attempt,'arm_sent');
        try{armed=await attempt.arm({target:attempt.target,takeId,laneId,songStartSec:attempt.songStartSec,signal:attempt.abortController.signal});}
        catch(error){if(!this.current(attempt))return false;if(allowCaptureOnly&&error?.code==='clean_media_activation_required')armed={captureOnly:true,warning:error.message};else throw error;}
        if(typeof armed?.disarm==='function')attempt.disarm=armed.disarm;
        // Cancelled during the count-in: end the arm that the late reply confirmed.
        if(!this.current(attempt)){this.disarm(attempt);return false;}
        if(armed?.captureOnly)return this.captureOnly(attempt,armed.warning||'Freestyle API recording is unavailable. This take is captured by the browser and uploaded when stopped.');
        this.mark(attempt,'armed');
        const start=Number(armed?.songStartSec);if(Number.isFinite(start)&&start>=0)attempt.songStartSec=start;
      }
      const acknowledgement=this.waitForMessage(message=>message.type==='take_started'&&String(message.take_id)===takeId,12000,attempt);
      // Cancellation can reject a waiter while an asynchronous sender is pending.
      acknowledgement.catch(()=>{});
      this.send({type:'room_unmute'},attempt);
      attempt.startedAt=this.now();this.beginCapture(stream,attempt);
      this.send(this.takeStartMessage(attempt,armed?.takeStart,{selfMonitor}),attempt);
      attempt.takeSent=true;this.mark(attempt,'take_start_sent');
      const ack=await acknowledgement;this.check(attempt);this.mark(attempt,'take_started');
      this.setState('recording',{takeId,laneId:ack.lane_id||laneId,songStartSec:attempt.songStartSec});
      attempt.syncTimer=this.interval(()=>{
        if(!this.current(attempt)||!this.recording)return;
        const elapsed=(this.now()-attempt.startedAt)/1000;
        const song=typeof attempt.songClock==='function'?Number(attempt.songClock()):attempt.songStartSec+elapsed;
        if(Number.isFinite(song))try{this.send({type:'sync',take_id:takeId,song_sec:Math.max(0,song),wall_ms:Date.now(),capture_sec:elapsed},attempt);}catch(error){if(this.current(attempt))emit(this,'error',error);}
      },100);
      // Release 2026-11-18: a take_start on a STOPPED transport rolls it from song_start_sec and the engine says so
      // (take_started.started_transport:true), exactly like a count-in boundary start: the caller must not send its own Play.
      return {...ack,mode:attempt.mode,takeId,songStartSec:attempt.songStartSec,transportStarted:armed?.transportStarted===true||ack?.started_transport===true,engineStartedTransport:ack?.started_transport===true,countIn:armed?.countIn??null,timing:{...attempt.timing}};
    } catch(error) {
      if(!this.current(attempt)){this.release(attempt);return false;}
      // A warm uplink that failed before Record is dropped quietly; Record then opens a fresh one.
      if(attempt.prewarm&&!attempt.adopted){if(this.warm===attempt)this.warm=null;this.release(attempt);return false;}
      if(allowCaptureOnly&&(error.status===401||error.status===403||error.code==='cloud_audio_auth_required')&&!attempt.takeSent&&attempt.stream) {
        try{return this.captureOnly(attempt,'The cloud microphone stream requires engine authorization. This take is captured by the browser and must be uploaded to the cloud when stopped.');}catch(captureError){error=captureError;}
      }
      this.disarm(attempt);
      this.release(attempt);if(!this.owns(attempt))return false;
      this.setState('error',{message:error.message,code:error.code,status:error.status});emit(this,'error',error);throw error;
    }
  }
  /** Browser-only capture (upload on stop) when the cloud take path is unavailable. */
  captureOnly(attempt,warning){
    this.check(attempt);this.stopKeepalive(attempt);this.closePeer(attempt);this.cleanupIngest(attempt);
    attempt.mode='capture-upload';attempt.startedAt=this.now();this.beginCapture(attempt.stream,attempt);
    const result={mode:attempt.mode,takeId:attempt.target.takeId,warning,timing:{...attempt.timing}};
    this.setState('recording',result);emit(this,'warning',result);return result;
  }
  /** take_start: the startRecording reply's template plus our take id, record mode, start and lane. */
  takeStartMessage(attempt,template,{selfMonitor=false}={}){
    const {takeId}=attempt.target,laneId=attempt.laneId;
    if(record(template)){
      const base=Object.fromEntries(Object.entries(template).filter(([key,value])=>!['type','take_id','song_start_sec','mode','lane_id'].includes(key)&&(value===null||['string','number','boolean'].includes(typeof value))));
      return{...base,type:'take_start',take_id:takeId,mode:'record',song_start_sec:attempt.songStartSec,...(laneId?{lane_id:laneId}:{}),...(selfMonitor?{self_monitor:true}:{})};
    }
    return{type:'take_start',take_id:takeId,song_start_sec:attempt.songStartSec,engine_mode:true,mode:'record',self_monitor:!!selfMonitor,loop_comp_ms:0,...(laneId?{lane_id:laneId}:{})};
  }
  startKeepalive(attempt){
    if(attempt.keepaliveTimer)return;attempt.lastHeardAt=this.now();
    attempt.keepaliveTimer=this.interval(()=>{
      if(!this.current(attempt)){this.stopKeepalive(attempt);return;}
      if(attempt.channel?.readyState!=='open')return;
      attempt.keepaliveSeq+=1;try{attempt.channel.send(JSON.stringify({type:'keepalive',id:attempt.keepaliveSeq}));}catch{}
      if(attempt.mozartSpoke&&this.now()-(attempt.lastHeardAt??this.now())>this.keepaliveTimeoutMs&&['connecting','recording','stopping'].includes(this._state))this.connectionFailed(attempt,'Freestyle stopped answering the microphone connection (keepalive timeout).');
    },this.keepaliveIntervalMs);
  }
  stopKeepalive(attempt){if(attempt?.keepaliveTimer){this.clearTimer(attempt.keepaliveTimer);attempt.keepaliveTimer=null;}}
  disarm(attempt){const disarm=attempt?.disarm;if(typeof disarm!=='function')return;attempt.disarm=null;Promise.resolve().then(disarm).catch(error=>emit(this,'warning',{message:`Freestyle did not confirm ending the recording arm: ${error?.message||error}`}));}
  connectionFailed(attempt,message){if(!this.current(attempt))return;const error=new Error(message);this.rejectWaiters(error,attempt);this.disarm(attempt);this.release(attempt);if(this.owns(attempt)){this.setState('error',{message});emit(this,'error',error);}}
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
    return new File(attempt.chunks,`Illogic recording ${new Date().toISOString().replaceAll(':','-')}.${extension}`,{type:mime});
  }
  handleMessage(message,attempt=this.attempt) {
    if(!this.current(attempt))return;
    if(message.type==='keepalive_ack'){attempt.keepaliveAcks=(attempt.keepaliveAcks||0)+1;return;}
    if(message.type==='ping'){this.send({type:'pong',id:message.id},attempt);return;}
    if(message.type==='uplink_revoked'){this.connectionFailed(attempt,`Freestyle closed the microphone connection (${message.code||'revoked'}). Press Record again.`);return;}
    if(message.type==='take_refused'&&(!message.take_id||String(message.take_id)===attempt.target.takeId)){
      const code=String(message.code||'take_refused'),error=new Error(TAKE_REFUSALS[code]||`Freestyle refused the take (${code}).`);error.code=code;error.status=message.status;error.refused=true;
      this.rejectWaiters(error,attempt);emit(this,'error',error);return;
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
  /** End the take: take_stop (song_end_sec = song_start_sec + take length), then finalize while the uplink is open. */
  async stop() {
    const attempt=this.attempt;if(!this.recording||!this.current(attempt))throw new Error('No acknowledged cloud microphone take is recording.');
    this.setState('stopping');this.clearTimer(attempt.syncTimer);attempt.syncTimer=null;
    const captureSec=Math.max(0,(this.now()-attempt.startedAt)/1000),end=Math.round((attempt.songStartSec+captureSec)*1e6)/1e6;
    const {takeId,projectId,contextTrackId,generation}=attempt.target;const stopAt=this.now();attempt.stopTiming={};const markStop=phase=>{if(attempt.stopTiming[phase]===undefined)attempt.stopTiming[phase]=Math.round(this.now()-stopAt);};
    const songClockSec=typeof attempt.songClock==='function'?Number(attempt.songClock()):null;
    const filePromise=this.finishCapture(attempt);filePromise.catch(()=>{});
    try{
      let receipt=null,finalized=null,finalizeError=null,file=null;const native=attempt.mode!=='capture-upload';
      if(native){
        // Placement is timing evidence, not proof of a persisted clip.
        const pending=this.waitForMessage(message=>String(message.take_id)===takeId&&(message.type==='take_stopped'||message.type==='live_placement'&&message.reason==='take_stop'),4000,attempt);pending.catch(()=>{});
        this.send({type:'take_stop',take_id:takeId,song_end_sec:end,capture_end_sec:captureSec},attempt);attempt.takeSent=false;markStop('take_stop_sent');
        try{await attempt.sender?.replaceTrack(null);}catch{}this.check(attempt);
        attempt.stream?.getTracks().forEach(track=>track.stop());
        try{receipt=await pending;}catch(error){if(error.code!=='cloud_ack_timeout')throw error;}this.check(attempt);markStop(receipt?'take_stopped':'take_stop_unacknowledged');
        try{file=await filePromise;}catch{file=null;}this.check(attempt);
        if(attempt.finalize){
          try{finalized=await attempt.finalize({target:attempt.target,takeId,laneId:attempt.laneId,songStartSec:attempt.songStartSec,songEndSec:end,signal:attempt.abortController.signal});}
          catch(error){if(!this.current(attempt))throw cancelled();finalizeError=error;}
          attempt.disarm=null;this.check(attempt);markStop('finalized');
        }
      }else{file=await filePromise;this.check(attempt);}
      const result={takeId,projectId,contextTrackId,laneId:attempt.laneId,generation,file,duration:captureSec,songStartSec:attempt.songStartSec,songEndSec:end,mode:attempt.mode,stopSent:native,acknowledged:!!receipt,...(native?{receipt}:{}),finalized,finalizeError,persisted:false,needsFinalization:!finalized,songClockSec:Number.isFinite(songClockSec)?songClockSec:null,timing:{...attempt.timing},stopTiming:{...attempt.stopTiming}};
      this.release(attempt);if(!this.owns(attempt))throw cancelled();this.setState('stopped',result);emit(this,'stopped',result);return result;
    }catch(error){this.disarm(attempt);this.release(attempt);if(this.owns(attempt))this.setState('error',{message:error.message});throw error;}
  }
  waitForMessage(match,timeout,attempt=this.attempt) {
    this.check(attempt);return new Promise((resolve,reject)=>{
      const waiter={match,finish:(error,message)=>{clearTimeout(timer);attempt.waiters.delete(waiter);error?reject(error):resolve(message);}};
      const timer=setTimeout(()=>{const error=new Error('The cloud engine did not acknowledge this recording operation.');error.code='cloud_ack_timeout';waiter.finish(error);},timeout);attempt.waiters.add(waiter);
    });
  }
  waitForIce(pc,attempt=this.attempt) {
    this.check(attempt);if(pc.iceGatheringState==='complete')return Promise.resolve();
    // Pro: done when gathering completes, 400 ms after the first relay candidate, or after 2.5 s.
    return new Promise((resolve,reject)=>{const signal=attempt.abortController.signal,started=this.now();let firstRelay=0,poll=null;
      const finish=error=>{clearTimeout(timer);clearTimeout(poll);pc.removeEventListener?.('icegatheringstatechange',change);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
      const check=()=>{if(pc.iceGatheringState==='complete')return finish();const now=this.now(),sdp=String(pc.localDescription?.sdp||'');if(!firstRelay&&/typ relay/.test(sdp))firstRelay=now;if(firstRelay&&now-firstRelay>=ICE_RELAY_SETTLE_MS)return finish();if(now-started>=ICE_GATHER_TIMEOUT_MS)return finish();poll=setTimeout(check,25);};
      const change=()=>{if(pc.iceGatheringState==='complete')finish();},abort=()=>finish(cancelled()),timer=setTimeout(()=>finish(),ICE_GATHER_TIMEOUT_MS+50);
      pc.addEventListener?.('icegatheringstatechange',change);signal.addEventListener('abort',abort,{once:true});poll=setTimeout(check,25);});
  }
  waitForChannel(channel,timeout,attempt=this.attempt) {
    this.check(attempt);if(channel.readyState==='open')return Promise.resolve();
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
    if(!attempt)return Promise.resolve();this.clearTimer(attempt.syncTimer);attempt.syncTimer=null;this.stopKeepalive(attempt);
    if(!attempt.released){attempt.released=true;this.rejectWaiters(cancelled(),attempt);if(attempt.recorder?.state==='recording')try{attempt.recorder.stop();}catch{}this.closePeer(attempt);attempt.stream?.getTracks().forEach(track=>track.stop());attempt.stream=null;}
    return this.cleanupIngest(attempt);
  }
  cancel() {
    const attempt=this.attempt;
    if(attempt&&this.current(attempt)&&attempt.takeSent&&attempt.channel?.readyState==='open')try{this.send({type:'take_cancel',take_id:attempt.target.takeId,song_end_sec:attempt.songStartSec+(this.now()-attempt.startedAt)/1000},attempt);}catch{}
    if(attempt)this.disarm(attempt);
    this.generation++;if(attempt){attempt.cancelled=true;attempt.abortController.abort();this.rejectWaiters(cancelled(),attempt);}this.attempt=null;const cleanup=this.release(attempt);this.setState('idle');return cleanup;
  }
}
