import {bridgeFetch} from './freestyle-host-transport.js';
/** Stream microphone input into Freestyle's native cloud ingest connection. */
const NATIVE_STUN={urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']};
const emit=(target,type,detail)=>target.dispatchEvent(new CustomEvent(type,{detail}));

export class CloudRecorder extends EventTarget {
  constructor({fetch:fetchImpl=(...args)=>bridgeFetch(...args),peerFactory=config=>new RTCPeerConnection(config),mediaDevices=globalThis.navigator?.mediaDevices,MediaRecorder:Recorder=globalThis.MediaRecorder}={}) {
    super();this.fetch=fetchImpl;this.peerFactory=peerFactory;this.mediaDevices=mediaDevices;this.Recorder=Recorder;this._state='idle';this.waiters=new Set();this.generation=0;
  }
  get state(){return this._state;}
  get recording(){return this._state==='recording';}
  setState(state,detail={}){this._state=state;emit(this,'state',{state,...detail});}
  async request(path,options={}) {
    const response=await this.fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers},signal:this.abortController.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(data.detail||data.error?.message||data.message||data.error||`Cloud input request failed (${response.status}).`);error.status=response.status;error.code=data.code||data.error?.code||(typeof data.error==='string'?data.error:undefined);throw error;}
    return data;
  }
  async start(projectId,trackId,{songStartSec=0,laneId=trackId,selfMonitor=false,songClock=null,allowCaptureOnly=true,beforeTake=null}={}) {
    if(!projectId||!trackId)throw new Error('Select a Freestyle project and recording lane first.');
    if(!this.mediaDevices?.getUserMedia)throw new Error('This browser does not support microphone capture.');
    this.cancel();const generation=this.generation;
    this.abortController=new AbortController();this.projectId=projectId;this.trackId=trackId;this.laneId=laneId;
    this.clientId=`modesty-input-${globalThis.crypto?.randomUUID?.()||Date.now()}`;this.takeId=`vegetable-take-${globalThis.crypto?.randomUUID?.()||Date.now()}`;
    this.songStartSec=Math.max(0,Number(songStartSec)||0);this.songClock=songClock;
    this.mode='native-ingest';this.setState('connecting');
    try {
      // Check the upstream audio grant before requesting microphone permission.
      const ice=await this.request(`modesty-bridge:/audio/ice?project_id=${encodeURIComponent(projectId)}`);
      if(generation!==this.generation)return false;
      const stream=await this.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
      if(generation!==this.generation){stream.getTracks().forEach(track=>track.stop());return false;}
      this.stream=stream;const track=stream.getAudioTracks()[0];if(!track)throw new Error('The microphone did not provide an audio track.');
      const iceServers=Array.isArray(ice.iceServers)?ice.iceServers:[NATIVE_STUN,...ice.urls?.length?[{urls:ice.urls,username:ice.username,credential:ice.credential}]:[]];
      const pc=this.peerFactory({iceServers});this.peer=pc;
      const transceiver=pc.addTransceiver('audio',{direction:'sendonly'});this.sender=transceiver.sender;
      try{const codecs=(globalThis.RTCRtpSender?.getCapabilities?.('audio')?.codecs||[]).filter(codec=>/^audio\/opus$/i.test(codec.mimeType));if(codecs.length)transceiver.setCodecPreferences?.(codecs);}catch{}
      const channel=pc.createDataChannel('mozart-live-ingest',{negotiated:true,id:200,ordered:true});this.channel=channel;
      channel.onmessage=event=>{if(typeof event.data!=='string')return;try{this.handleMessage(JSON.parse(event.data));}catch(error){emit(this,'error',error);}};
      channel.onclose=()=>{if(generation===this.generation&&this.recording){const error=new Error('Freestyle microphone input disconnected before the take stopped.');this.rejectWaiters(error);this.release();this.setState('error',{message:error.message});emit(this,'error',error);}};
      pc.onconnectionstatechange=()=>{if(generation===this.generation&&pc.connectionState==='failed'){const error=new Error('The cloud microphone connection failed.');this.rejectWaiters(error);this.release();this.setState('error',{message:error.message});emit(this,'error',error);}};
      await pc.setLocalDescription(await pc.createOffer());await this.waitForIce(pc);
      if(generation!==this.generation)return false;
      const result=await this.request('modesty-bridge:/audio/ingest-offer',{method:'POST',body:JSON.stringify({project_id:projectId,track_id:trackId,clientId:this.clientId,lane_id:laneId,profile:'regional_music',offer:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}})});
      const answer=result.answer||result.response?.answer;if(!answer?.sdp)throw new Error('Freestyle did not return a microphone ingest answer.');
      await pc.setRemoteDescription({type:answer.type||'answer',sdp:answer.sdp});await this.waitForChannel(channel,15000);
      if(generation!==this.generation)return false;
      await this.sender.replaceTrack(track);this.startLevels();
      // The published sequence: uplink first, then the engine arm (startRecording), then take_start.
      if(typeof beforeTake==='function'){const armed=await beforeTake();if(generation!==this.generation)return false;if(Number.isFinite(Number(armed?.songStartSec)))this.songStartSec=Math.max(0,Number(armed.songStartSec));}
      const acknowledgement=this.waitForMessage(message=>message.type==='take_started'&&String(message.take_id)===this.takeId,12000);
      this.send({type:'room_unmute'});
      this.startedAt=performance.now();this.beginCapture(this.stream);
      this.send({type:'take_start',take_id:this.takeId,song_start_sec:this.songStartSec,engine_mode:true,mode:'record',self_monitor:!!selfMonitor,loop_comp_ms:0,...laneId?{lane_id:laneId}:{}});
      const ack=await acknowledgement;
      if(generation!==this.generation)return false;
      this.setState('recording',{takeId:this.takeId,laneId:ack.lane_id||laneId,songStartSec:this.songStartSec});
      // Uplink keepalive (every 5 s) also keeps the engine's recording arm alive.
      this.keepaliveTimer=setInterval(()=>{try{this.send({type:'keepalive',id:Date.now()});}catch{}},5000);
      this.syncTimer=setInterval(()=>{
        if(!this.recording)return;
        const elapsed=(performance.now()-this.startedAt)/1000;
        const song=typeof this.songClock==='function'?Number(this.songClock()):this.songStartSec+elapsed;
        if(Number.isFinite(song))try{this.send({type:'sync',take_id:this.takeId,song_sec:Math.max(0,song),wall_ms:Date.now(),capture_sec:elapsed});}catch(error){emit(this,'error',error);}
      },100);
      return {...ack,mode:this.mode};
    } catch(error) {
      if(generation!==this.generation)return false;
      if(allowCaptureOnly&&(error.status===401||error.status===403||error.code==='cloud_audio_auth_required')) {
        try {
        if(this.peer){this.peer.onconnectionstatechange=null;if(this.channel)this.channel.onclose=null;this.peer.close();this.peer=null;}
        if(!this.stream)this.stream=await this.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
        if(generation!==this.generation){this.release();return false;}
        this.mode='capture-upload';this.startedAt=performance.now();this.beginCapture(this.stream);this.startLevels();
        const result={mode:this.mode,takeId:this.takeId,warning:'The cloud microphone stream requires engine authorization. This take is captured by the browser and must be uploaded to the cloud when stopped.'};
        this.setState('recording',result);emit(this,'warning',result);return result;
        } catch(captureError) {error=captureError;}
      }
      this.release();this.setState('error',{message:error.message,code:error.code,status:error.status});emit(this,'error',error);throw error;
    }
  }
  /** Input level for the Recording meter and the growing take: the browser's own measurement of the captured
   *  microphone track (RTCPeerConnection stats `media-source.audioLevel`). Nothing is processed or analysed here. */
  startLevels(intervalMs=50) {
    clearInterval(this.levelTimer);const peer=this.peer;if(!peer?.getStats)return;let busy=false;
    this.levelTimer=setInterval(async()=>{
      if(busy||this.peer!==peer)return;busy=true;
      try{const stats=await peer.getStats();let level=null;stats.forEach(row=>{if(row.type==='media-source'&&row.kind==='audio'&&Number.isFinite(row.audioLevel))level=row.audioLevel;});
        if(level!==null&&this.peer===peer)emit(this,'level',{level:Math.max(0,Math.min(1,level)),recording:this.recording,elapsedSec:this.recording?(performance.now()-this.startedAt)/1000:null});}
      catch{}finally{busy=false;}
    },intervalMs);
  }
  beginCapture(stream) {
    if(!this.Recorder)throw new Error('This browser does not support microphone file capture.');
    const mimeType=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type=>this.Recorder.isTypeSupported?.(type));
    const chunks=[];this.chunks=chunks;this.captureError=null;this.recorder=new this.Recorder(stream,mimeType?{mimeType}:{});
    this.recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
    this.recorder.onerror=event=>{this.captureError=event.error||new Error('Microphone file capture failed.');emit(this,'error',this.captureError);};
    this.recorder.start(1000);
  }
  async finishCapture() {
    const recorder=this.recorder;if(!recorder)return null;
    if(recorder.state!=='inactive')await new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=event=>reject(event.error||new Error('Microphone file capture failed.'));recorder.stop();});
    if(!this.chunks.length)throw this.captureError||new Error('The microphone capture contained no encoded audio.');
    const mime=recorder.mimeType||this.chunks[0]?.type||'audio/webm';
    const extension=mime.includes('mp4')?'m4a':'webm';
    return new File(this.chunks,`Vegetable recording ${new Date().toISOString().replaceAll(':','-')}.${extension}`,{type:mime});
  }
  handleMessage(message) {
    if(message.type==='ping'){try{this.send({type:'pong',id:message.id});}catch{/* the take already stopped and its uplink is being released */}return;}
    if(message.type==='error'||message.type==='take_superseded') {
      const error=new Error(message.message||message.reason||message.code||'The cloud engine rejected the recording.');error.code=message.code||message.type;
      this.rejectWaiters(error);emit(this,'error',error);return;
    }
    if(message.lane_id)this.laneId=message.lane_id;
    emit(this,'message',message);
    for(const waiter of [...this.waiters])if(waiter.match(message))waiter.finish(null,message);
  }
  send(payload) {
    if(this.channel?.readyState!=='open')throw new Error('The cloud microphone control channel is unavailable.');
    this.channel.send(JSON.stringify(payload));
  }
  /** `deferRelease` (used with finalizeRecording wait_for:"placed"): return as soon as take_stop is sent, without
   *  waiting for the placement receipt. The uplink stays open until the caller's `release()` (after finalize answered),
   *  so the engine still receives take_stop and the tail of the audio; `placement` resolves with the receipt or null. */
  async stop({songEndSec,deferRelease=false}={}) {
    if(!this.recording)throw new Error('No acknowledged cloud microphone take is recording.');
    this.setState('stopping');clearInterval(this.syncTimer);clearInterval(this.levelTimer);clearInterval(this.keepaliveTimer);
    const captureSec=(performance.now()-this.startedAt)/1000;
    const end=Number.isFinite(Number(songEndSec))?Math.max(0,Number(songEndSec)):this.songStartSec+captureSec;
    const takeId=this.takeId;
    const filePromise=this.finishCapture();
    if(this.mode==='capture-upload') {
      const file=await filePromise;this.release();
      const result={takeId,file,duration:captureSec,songStartSec:this.songStartSec,mode:this.mode,stopSent:false,acknowledged:false,persisted:false,needsFinalization:true};
      this.setState('stopped',result);emit(this,'stopped',result);return result;
    }
    // The live recording channel exposes a placement timing receipt, not a persisted-clip acknowledgement.
    const pending=this.waitForMessage(message=>message.type==='live_placement'&&String(message.take_id)===takeId&&message.reason==='take_stop',4000);
    this.send({type:'take_stop',take_id:takeId,song_end_sec:end,capture_end_sec:captureSec});
    try{await this.sender?.replaceTrack(null);}catch{}
    this.stream?.getTracks().forEach(track=>track.stop());
    if(deferRelease) {
      // Detach this take's uplink from the recorder: a later start()/cancel() must not close it early, and its own
      // release() never touches a newer take's peer.
      const held={peer:this.peer,channel:this.channel,stream:this.stream};this.peer=null;this.channel=null;this.stream=null;let released=false;
      const release=()=>{if(released)return;released=true;if(held.peer){held.peer.onconnectionstatechange=null;if(held.channel){held.channel.onclose=null;held.channel.onmessage=null;}try{held.peer.close();}catch{}}held.stream?.getTracks().forEach(track=>track.stop());};
      const placement=pending.then(value=>value,()=>null);
      const result={takeId,file:await filePromise,duration:captureSec,songStartSec:this.songStartSec,songEndSec:end,laneId:this.laneId,mode:this.mode,stopSent:true,acknowledged:false,receipt:null,persisted:false,needsFinalization:true,placement,release};
      // Never keep an uplink open for good when the caller forgets to release it.
      placement.then(()=>{const timer=setTimeout(release,15000);timer?.unref?.();});
      this.setState('stopped',result);emit(this,'stopped',result);return result;
    }
    let receipt=null;
    try{receipt=await pending;}catch(error){if(error.code!=='cloud_ack_timeout'){this.release();this.setState('error',{message:error.message});throw error;}}
    const result={takeId,file:await filePromise,duration:captureSec,songStartSec:this.songStartSec,songEndSec:end,laneId:this.laneId,mode:this.mode,stopSent:true,acknowledged:!!receipt,receipt,persisted:false,needsFinalization:true};
    this.release();this.setState('stopped',result);emit(this,'stopped',result);return result;
  }
  waitForMessage(match,timeout) {
    return new Promise((resolve,reject)=>{
      const waiter={match,finish:(error,message)=>{clearTimeout(timer);this.waiters.delete(waiter);error?reject(error):resolve(message);}};
      const timer=setTimeout(()=>{const error=new Error('The cloud engine did not acknowledge this recording operation.');error.code='cloud_ack_timeout';waiter.finish(error);},timeout);
      this.waiters.add(waiter);
    });
  }
  /** Freestyle Studio's gather policy (first relay candidate / complete, 4 s cap, 2.5 s with no candidate):
   *  the host's own implementation when it offers one, the same rule otherwise. The old wait-for-complete took 8 s. */
  waitForIce(pc) {
    if(pc.iceGatheringState==='complete')return Promise.resolve();
    const signal=this.abortController.signal;
    try{const host=globalThis.parent?.__freestyleStudioHost??globalThis.__freestyleStudioHost;if(host&&typeof host.waitForIceGathering==='function')return Promise.resolve(host.waitForIceGathering(pc,{signal})).then(()=>{});}catch{}
    return new Promise(resolve=>{
      let seen=0,done=false;
      const finish=()=>{if(done)return;done=true;clearTimeout(cap);clearTimeout(dead);pc.removeEventListener?.('icecandidate',candidate);pc.removeEventListener('icegatheringstatechange',change);signal.removeEventListener('abort',finish);resolve();};
      const candidate=event=>{const line=event?.candidate?.candidate||'';if(!line)return;seen++;if(line.includes(' relay '))finish();};
      const change=()=>{if(pc.iceGatheringState==='complete')finish();};
      const cap=setTimeout(finish,4000),dead=setTimeout(()=>{if(!seen)finish();},2500);
      pc.addEventListener?.('icecandidate',candidate);pc.addEventListener('icegatheringstatechange',change);signal.addEventListener('abort',finish,{once:true});
    });
  }
  waitForChannel(channel,timeout) {
    if(channel.readyState==='open')return Promise.resolve();
    return new Promise((resolve,reject)=>{const signal=this.abortController.signal;const finish=error=>{clearTimeout(timer);channel.removeEventListener('open',open);channel.removeEventListener('close',close);signal.removeEventListener('abort',abort);error?reject(error):resolve();};const open=()=>finish();const close=()=>finish(new Error('The cloud microphone channel closed.'));const abort=()=>finish(new DOMException('Cloud microphone cancelled.','AbortError'));const timer=setTimeout(()=>finish(new Error('Timed out opening the cloud microphone channel.')),timeout);channel.addEventListener('open',open,{once:true});channel.addEventListener('close',close,{once:true});signal.addEventListener('abort',abort,{once:true});});
  }
  rejectWaiters(error){for(const waiter of [...this.waiters])waiter.finish(error);}
  release() {
    clearInterval(this.syncTimer);clearInterval(this.levelTimer);clearInterval(this.keepaliveTimer);
    if(this.recorder?.state==='recording')try{this.recorder.stop();}catch{}
    if(this.peer){this.peer.onconnectionstatechange=null;if(this.channel)this.channel.onclose=null;this.peer.close();this.peer=null;}
    this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;
  }
  cancel() {
    if(this.recording&&this.channel?.readyState==='open')try{this.send({type:'take_cancel',take_id:this.takeId,song_end_sec:this.songStartSec+(performance.now()-this.startedAt)/1000});}catch{}
    this.generation++;this.abortController?.abort();this.rejectWaiters(new DOMException('Cloud recording cancelled.','AbortError'));this.release();this.setState('idle');
  }
}
