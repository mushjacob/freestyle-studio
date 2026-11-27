import {hostFetch} from './freestyle-host-transport.js';
import {loopTakeStartFields} from './loop-takes.js';
/** Stream microphone input into Freestyle's native cloud ingest connection. */
const NATIVE_STUN={urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']};
const emit=(target,type,detail)=>target.dispatchEvent(new CustomEvent(type,{detail}));
const cancelled=()=>new DOMException('Cloud recording cancelled.','AbortError');

export class CloudRecorder extends EventTarget {
  /** Optional transport callbacks receive captured identities, never the active
   * project. They must not retry uncertain mutations. No MCP schema is assumed.
   * offerIngest(target, nativePayload, {signal}); closeIngest(target).
   */
  constructor({fetch:fetchImpl=(...args)=>hostFetch(...args),peerFactory=config=>new RTCPeerConnection(config),mediaDevices=globalThis.navigator?.mediaDevices,MediaRecorder:Recorder=globalThis.MediaRecorder,offerIngest=null,closeIngest=null}={}) {
    super();Object.assign(this,{fetch:fetchImpl,peerFactory,mediaDevices,Recorder,offerIngest,closeIngest});this._state='idle';this.generation=0;this.attempt=null;
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
  async start(projectId,trackId,{songStartSec=0,laneId=trackId,selfMonitor=false,songClock=null,allowCaptureOnly=true,loopTakes=null,beforeTake=null}={}) {
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
      const stream=await this.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
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
      // Count-in / punch: hold the take until the engine clock reaches the record point (mic audio before it is never captured).
      if(typeof beforeTake==='function'){const held=await beforeTake({signal:attempt.abortController.signal});this.check(attempt);if(Number.isFinite(Number(held?.songStartSec)))attempt.songStartSec=Math.max(0,Number(held.songStartSec));if(held?.takeStart&&typeof held.takeStart==='object')attempt.takeStartFields={...held.takeStart};}
      this.send({type:'room_unmute'},attempt);
      attempt.startedAt=performance.now();this.beginCapture(stream,attempt);
      this.send({type:'take_start',take_id:takeId,song_start_sec:attempt.songStartSec,engine_mode:true,mode:'record',self_monitor:!!selfMonitor,loop_comp_ms:0,...loopTakeStartFields(loopTakes),...laneId?{lane_id:laneId}:{},...(attempt.takeStartFields||{}),take_id:takeId},attempt);
      attempt.takeSent=true;
      const ack=await acknowledgement;this.check(attempt);
      this.setState('recording',{takeId,laneId:ack.lane_id||laneId});
      attempt.syncTimer=setInterval(()=>{
        if(!this.current(attempt)||!this.recording)return;
        const elapsed=(performance.now()-attempt.startedAt)/1000;
        const song=typeof attempt.songClock==='function'?Number(attempt.songClock()):attempt.songStartSec+elapsed;
        if(Number.isFinite(song))try{this.send({type:'sync',take_id:takeId,song_sec:Math.max(0,song),wall_ms:Date.now(),capture_sec:elapsed},attempt);}catch(error){if(this.current(attempt))emit(this,'error',error);}
      },100);
      return {...ack,mode:attempt.mode,songStartSec:attempt.songStartSec};
    } catch(error) {
      if(!this.current(attempt)){this.release(attempt);return false;}
      if(allowCaptureOnly&&(error.status===401||error.status===403||error.code==='cloud_audio_auth_required')&&!attempt.takeSent) {
        try {
          this.closePeer(attempt);this.cleanupIngest(attempt);
          if(!attempt.stream){const stream=await this.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});if(!this.current(attempt)){stream.getTracks().forEach(track=>track.stop());return false;}attempt.stream=stream;}
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
  /** Capture time (seconds into the take) of song position `songSec`, from the live clock; null when no take is recording. */
  captureSecAtSong(songSec){
    const attempt=this.attempt;if(!attempt||!attempt.startedAt||!Number.isFinite(Number(songSec)))return null;
    const elapsed=(performance.now()-attempt.startedAt)/1000,now=typeof attempt.songClock==='function'?Number(attempt.songClock()):attempt.songStartSec+elapsed;
    return Number.isFinite(now)?Math.max(0,elapsed-(now-Number(songSec))):null;
  }
  async stop({songEndSec,captureEndSec,keepUplink=false}={}) {
    const attempt=this.attempt;if(!this.recording||!this.current(attempt))throw new Error('No acknowledged cloud microphone take is recording.');
    this.setState('stopping');clearInterval(attempt.syncTimer);
    const captureSec=Number.isFinite(Number(captureEndSec))?Math.max(0,Number(captureEndSec)):(performance.now()-attempt.startedAt)/1000;
    // song_end_sec bounds the saved clip (start + take length). With the transport stopped the song clock never moves, so a clock-derived end equal to the start would save an empty take.
    let end=Number.isFinite(Number(songEndSec))?Math.max(0,Number(songEndSec)):attempt.songStartSec+captureSec;if(!(end>attempt.songStartSec+.02))end=attempt.songStartSec+captureSec;
    // The engine saves the take from this uplink (finalizeRecording), so the uplink must outlive take_stop until the caller finalizes.
    if(keepUplink&&attempt.mode!=='capture-upload')attempt.deferUplinkClose=true;
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
      result.songEndSec=end;this.release(attempt);if(!this.owns(attempt))throw cancelled();this.setState('stopped',result);emit(this,'stopped',result);return result;
    }catch(error){this.release(attempt);if(this.owns(attempt))this.setState('error',{message:error.message});throw error;}
  }
  waitForMessage(match,timeout,attempt=this.attempt) {
    this.check(attempt);return new Promise((resolve,reject)=>{
      const waiter={match,finish:(error,message)=>{clearTimeout(timer);attempt.waiters.delete(waiter);error?reject(error):resolve(message);}};
      const timer=setTimeout(()=>{const error=new Error('The cloud engine did not acknowledge this recording operation.');error.code='cloud_ack_timeout';waiter.finish(error);},timeout);attempt.waiters.add(waiter);
    });
  }
  waitForIce(pc,attempt=this.attempt) {
    this.check(attempt);if(pc.iceGatheringState==='complete')return Promise.resolve();
    // Same gather policy as the monitor peer: the host resolves on the first relay candidate (4 s cap)
    // instead of waiting out the full 8 s for "complete", which delayed every take by seconds.
    try{const host=globalThis.parent?.__freestyleStudioHost||globalThis.__freestyleStudioHost;if(host&&typeof host.waitForIceGathering==='function')return Promise.resolve(host.waitForIceGathering(pc,{signal:attempt.abortController.signal})).then(()=>{this.check(attempt);});}catch{}
    return new Promise((resolve,reject)=>{const signal=attempt.abortController.signal,finish=error=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',change);signal.removeEventListener('abort',abort);error?reject(error):resolve();},change=()=>{if(pc.iceGatheringState==='complete')finish();},abort=()=>finish(cancelled()),timer=setTimeout(()=>finish(),8000);pc.addEventListener('icegatheringstatechange',change);signal.addEventListener('abort',abort,{once:true});});
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
    if(!attempt)return Promise.resolve();clearInterval(attempt.syncTimer);
    if(!attempt.released){attempt.released=true;this.rejectWaiters(cancelled(),attempt);if(attempt.recorder?.state==='recording')try{attempt.recorder.stop();}catch{}attempt.stream?.getTracks().forEach(track=>track.stop());attempt.stream=null;if(attempt.deferUplinkClose){(this.heldUplinks??=new Map()).set(attempt.target.takeId,attempt);return Promise.resolve();}this.closePeer(attempt);}
    if(attempt.deferUplinkClose)return Promise.resolve();
    return this.cleanupIngest(attempt);
  }
  /** Close an uplink kept open for finalizeRecording (see stop({keepUplink})). Safe to call for an unknown take. */
  finishUplink(takeId){const attempt=this.heldUplinks?.get(takeId);if(!attempt)return Promise.resolve();this.heldUplinks.delete(takeId);attempt.deferUplinkClose=false;this.closePeer(attempt);return this.cleanupIngest(attempt);}
  cancel() {
    const attempt=this.attempt;
    if(attempt&&this.current(attempt)&&attempt.takeSent&&attempt.channel?.readyState==='open')try{this.send({type:'take_cancel',take_id:attempt.target.takeId,song_end_sec:attempt.songStartSec+(performance.now()-attempt.startedAt)/1000},attempt);}catch{}
    this.generation++;if(attempt){attempt.cancelled=true;attempt.abortController.abort();this.rejectWaiters(cancelled(),attempt);}this.attempt=null;const cleanup=this.release(attempt);this.setState('idle');return cleanup;
  }
}
