import {bridgeFetch,viewHidden,viewActivity,hostCapability} from './freestyle-host-transport.js';
/** The host plays this engine session's audio itself (capability hostAudio): this peer stays muted
 * (control, clock and stats only), so switching views never gaps or doubles the sound. */
const hostPlaysAudio=()=>hostCapability('hostAudio');
/** Receive Freestyle's server-rendered audio. No local synthesizer or audio rendering. */
// STUN and ordered control channels match the Freestyle Studio.
const NATIVE_STUN = {urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']};
const dispatch = (target,type,detail) => target.dispatchEvent(new CustomEvent(type,{detail}));

/** MCP tools may be proxied as JSON or returned in their standard content envelope. */
export function unpackMonitorResult(result) {
  let data=result?.structuredContent;
  if(!data&&Array.isArray(result?.content)){try{data=JSON.parse(result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'));}catch{}}
  data=data??result;const value=data?.response??data;
  if(result?.isError||data?.ok===false||data?.error||value?.ok===false||value?.error){const error=new Error(value?.message||value?.error?.message||data?.message||(typeof value?.error==='string'?value.error:'Freestyle could not open its live audio session.'));error.code=value?.code||data?.code;throw error;}
  return value;
}
export function turnExpiryMilliseconds(credentials) {
  const raw=credentials?.expiresAt;if(raw===null||raw===undefined||raw==='')return null;
  if(typeof raw==='number'||(typeof raw==='string'&&/^\d+(?:\.\d+)?$/.test(raw))){const value=Number(raw);return Number.isFinite(value)?value<1e12?value*1000:value:null;}
  const value=Date.parse(raw);return Number.isFinite(value)?value:null;
}
function credentialsFrom(value) {
  const data=unpackMonitorResult(value),credentials=data?.turnCredentials??data?.turn_credentials??data;
  const urls=typeof credentials?.urls==='string'?[credentials.urls]:Array.isArray(credentials?.urls)?credentials.urls.filter(url=>typeof url==='string'&&url):[];
  if(!urls.length||typeof credentials?.username!=='string'||typeof credentials?.credential!=='string')throw new Error('Freestyle did not return usable TURN relay credentials.');
  return {urls,username:credentials.username,credential:credentials.credential,expiresAt:credentials.expiresAt,...credentials.ttlSec!=null?{ttlSec:credentials.ttlSec}:{}};
}
/** Negotiate stereo Opus at the Freestyle Studio's verified music bitrate.
 * Keep other codecs/media and the source's line endings unchanged. */
export function studioOpusOfferSdp(sdp){
 const source=String(sdp||'');if(!source)return source;
 const lines=source.split(/(\r\n|\n|\r)/),opus=lines.findIndex((line,index)=>index%2===0&&/^a=rtpmap:\d+\s+opus\/48000\/2\s*$/i.test(line));
 if(opus<0)return source;
 const payload=lines[opus].match(/^a=rtpmap:(\d+)/i)[1];let start=0,end=lines.length;
 for(let index=opus-2;index>=0;index-=2)if(/^m=/.test(lines[index])){start=index;break;}
 for(let index=opus+2;index<lines.length;index+=2)if(/^m=/.test(lines[index])){end=index;break;}
 const match=new RegExp('^a=fmtp:'+payload+'\\s+([^\\r\\n]*)$','i'),params=['stereo=1','sprop-stereo=1','maxplaybackrate=48000','maxaveragebitrate=510000'];
 for(let index=start;index<end;index+=2){const existing=lines[index].match(match);if(!existing)continue;const retained=existing[1].split(';').map(value=>value.trim()).filter(Boolean).filter(value=>!/^(stereo|sprop-stereo|maxplaybackrate|maxaveragebitrate)\s*=/i.test(value));lines[index]='a=fmtp:'+payload+' '+[...retained,...params].join(';');return lines.join('');}
 const ending=lines[opus+1]||source.match(/\r\n|\n|\r/)?.[0]||'\r\n';
 lines[opus]+=(lines[opus+1]||ending)+'a=fmtp:'+payload+' '+params.join(';');return lines.join('');
}
/** Discard unusable VPN-overlay host candidates only when
 * another candidate remains. This changes the outbound SDP, never the peer. */
export function studioOutboundOfferSdp(sdp){
 const source=String(sdp||''),lines=source.match(/[^\n]*\n|[^\n]+$/g)||[];let kept=0,removed=0;
 const tailnet=address=>{
  let value=String(address||'').trim().toLowerCase();if(value.startsWith('[')&&value.includes(']'))value=value.slice(1,value.indexOf(']'));
  value=value.split('%')[0];if(value.startsWith('::ffff:')&&value.includes('.'))value=value.slice(7);
  if(!value.includes(':')){const match=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);if(!match)return false;const octets=match.slice(1).map(Number);return octets.every(n=>n<=255)&&octets[0]===100&&octets[1]>=64&&octets[1]<=127;}
  const parts=value.split(':');return ['fd7a','115c','a1e0'].every((part,index)=>/^[0-9a-f]{1,4}$/.test(parts[index]||'')&&parts[index].replace(/^0+(?=.)/,'')===part);
 };
 const filtered=lines.filter(line=>{if(!/^a=candidate:/i.test(line))return true;const match=/^a=candidate:(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+typ\s+(\S+)/i.exec(line),drop=match&&match[7].toLowerCase()==='host'&&(tailnet(match[5])||/\b(?:utun\d*|tailscale\d*)\b/i.test(line));if(drop){removed++;return false;}kept++;return true;});
 return removed&&kept?filtered.join(''):source;
}
/** Native Studio uses per-sample delay deltas, smoothed 85/15, never network RTT. */
export function playbackDelaySample(total,count,previous,smoothed=null){
 if(!Number.isFinite(total)||total<0||!Number.isFinite(count)||count<=0)return null;
 if(previous&&count===previous.count)return null;
 const sample=previous&&count>previous.count&&total>=previous.total?(total-previous.total)/(count-previous.count):total/count;
 if(!Number.isFinite(sample)||sample<0)return null;
 return smoothed==null?sample:smoothed*.85+sample*.15;
}
function iceServersFor(credentials) {return [NATIVE_STUN,{urls:credentials.urls,username:credentials.username,credential:credentials.credential}];}

// Slow/failed connects are retried; an HTTP refusal on the first bootstrap is
// reported once, but retried while recovering a peer.
function retryableMonitorError(error,{recovering=false}={}){if(error?.name==='AbortError')return false;const status=Number(error?.status);if(Number.isFinite(status)&&status>0)return recovering&&(status===408||status===429||status>=500);return !error?.code;}

export class CloudMonitor extends EventTarget {
  constructor({fetch:fetchImpl=(...args)=>bridgeFetch(...args),peerFactory=config=>new RTCPeerConnection(config),audio=null,now=()=>Date.now(),timerFactory=(callback,delay)=>setTimeout(callback,delay),timerCancel=timer=>clearTimeout(timer),reconnect={},trickle=globalThis.__modestyMonitorTrickle!==false/* measurement switch: set false before load to compare */,trickleGatherMs=400}={}) {
    super();this.trickle=trickle!==false;this.trickleGatherMs=trickleGatherMs;this.trickleActive=false;
    // A failed (or long-disconnected) current peer is torn down and
    // the SAME project is reopened after 3 s, with bounded retries.
    this.reconnectPolicy={baseMs:3000,maxDelayMs:30000,maxAttempts:5,disconnectGraceMs:10000,...reconnect};
    this.reconnectAttempts=0;this.reconnectTimer=null;this.reconnectToken=0;this.disconnectTimer=null;this.lastContext=null;this.unloading=false;
    this.fetch=fetchImpl;
    this.peerFactory=peerFactory;
    this.audio=audio;this.now=now;this.timerFactory=timerFactory;this.timerCancel=timerCancel;this.turnCredentials=null;this.session=null;this.dawBaseUrl='';
    this.peer=null;
    this._state='idle';this.active=false;this.lastError=null;
    this.generation=0;this.sequence=0;
    this.opening=null;this.requestedContext=null;this.turnRefreshToken=null;this.playPermissionVersion=0;this.playPermission=null;this.outputWanted=true;this.outputProjectId='';
    this.stats={audioLevel:0,bytesReceived:0,packetsLost:0,jitter:0,roundTripTime:0,receiverLagSec:null,playoutLagSec:null};this.delayMeasurements=new Map();
  }
  get state(){return this._state;}
  setState(state,detail={}) {this._state=state;if(state==='error')this.lastError={message:String(detail.message||'Cloud audio connection failed.'),code:detail.code||null,status:detail.status||null,at:this.now()};else if(state==='connecting'||state==='connected')this.lastError=null;dispatch(this,'state',{state,...detail});}
  async request(path,options={}) {
    const response=await this.fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers},signal:this.abortController.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok) {
      const message=data.error?.message||data.detail||data.message||data.error||`Freestyle audio request failed (${response.status}).`;
      const error=new Error(typeof message==='string'?message:JSON.stringify(message));error.status=response.status;error.code=data.code||data.error?.code||(typeof data.error==='string'?data.error:undefined);throw error;
    }
    return unpackMonitorResult(data);
  }
  wantsOutput(projectId=this.projectId){return this.outputWanted&&(!this.outputProjectId||this.outputProjectId===projectId);}
  setOutputWanted(wanted,{projectId=this.projectId}={}){
    this.outputWanted=wanted===true;this.outputProjectId=projectId||'';
    if(!wanted){this.playPermissionVersion++;this.playPermission=null;if(this.opening?.resume)this.opening.finish(null,false);}
    // Intent for a replacement project must never unmute an old project's sink.
    if(this.audio&&(!wanted||!projectId||projectId===this.projectId)){
      this.audio.muted=!wanted||hostPlaysAudio();this.audio.autoplay=wanted===true;
      if(!wanted)try{this.audio.pause();}catch{}
    }
  }
  primeOutput(){
    // play() may remain pending without a media source. Use the current gesture
    // to prime permission, but never make negotiation or Stop wait for it.
    if(!this.wantsOutput()||!this.audio||this.audio.srcObject)return;
    try{Promise.resolve(this.audio.play()).catch(()=>{});}catch{}
  }
  matchesRequestedContext(projectId,trackId){return this.active&&this.requestedContext?.projectId===projectId&&this.requestedContext.trackId===(trackId||'');}
  start(projectId,trackId,{reconnecting=false}={}) {
    if(!projectId)return Promise.reject(new Error('Open a cloud project before connecting its monitor.'));
    if(!reconnecting){this.reconnectAttempts=0;this.unloading=false;}
    const same=this.matchesRequestedContext(projectId,trackId);
    if(same&&this.opening?.generation===this.generation)return this.opening.promise;
    const resume=same&&this.peer?.connectionState==='connected'&&['connected','blocked'].includes(this.state);
    if(!resume)this.stop({reconnecting});
    const generation=this.generation;this.requestedContext={projectId,trackId:trackId||''};this.lastContext=this.requestedContext;
    let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;}),job={generation,promise,resume,done:false,finish:null};
    job.finish=(error,value)=>{if(job.done)return;job.done=true;if(this.opening===job)this.opening=null;error?reject(error):resolve(value);};this.opening=job;
    // Install the handle before state events can synchronously request the
    // same source again. Reuse never declares media ready before play() ends.
    const task=resume?this.resume().then(played=>played!==false&&generation===this.generation&&this.state==='connected'):this.open(projectId,trackId,generation);
    task.then(value=>job.finish(null,value),error=>job.finish(error));return promise;
  }
  async open(projectId,trackId,generation) {
    this.abortController=new AbortController();this.active=true;
    this.projectId=projectId;this.trackId=trackId||'';
    // One monitor peer per document with its own clientId, beside the Default studio's peer on the same device.
    this.clientId=`modesty-${globalThis.crypto?.randomUUID?.()||Date.now()}`;
    if(!this.audio) {
      this.audio=document.createElement('audio');this.audio.hidden=true;this.audio.autoplay=true;this.audio.playsInline=true;
      this.audio.setAttribute('playsinline','');this.audio.dataset.vegetableCloudMonitor='true';document.body.append(this.audio);
    }
    this.audio.muted=!this.wantsOutput(projectId)||hostPlaysAudio();this.audio.autoplay=this.wantsOutput(projectId);this.audio.volume=1;
    // A background connection negotiates silently. A user-started connection
    // may prime the sink without awaiting a no-source play() promise.
    if(this.wantsOutput(projectId))this.audio.play().catch(()=>{});
    this.setState('connecting');this.timeline=[];const mark=step=>{if(generation===this.generation)this.timeline.push({step,at:this.now()});};mark('start-sent');
    try {
      // Spec order (startAudioMonitor -> sendMonitorOffer): POST /monitor opens
      // the engine session, then the offer uses that same project/track scope.
      const opened=await this.request('modesty-bridge:/audio/start',{method:'POST',body:JSON.stringify({project_id:projectId,...trackId?{track_id:trackId}:{}})});
      if(generation!==this.generation)return false;mark('start-ack');
      const session=opened.session||{};
      this.dawBaseUrl=session.dawBaseUrl||session.daw_base_url||opened.dawBaseUrl||'';
      this.trackId=opened.trackId||opened.track_id||session.trackId||session.track_id||this.trackId;
      // Retain routing metadata only. Engine access tokens are neither needed nor exposed.
      this.session={dawBaseUrl:this.dawBaseUrl,phase:session.phase,projectId:this.projectId,trackId:this.trackId};
      // POST /monitor may return turnCredentials:null (published contract); the
      // existing /ice refresh below then supplies relays before the offer.
      const openedData=unpackMonitorResult(opened);
      this.turnCredentials=openedData&&(openedData.turnCredentials===null||openedData.turn_credentials===null)?null:credentialsFrom(opened);
      if((turnExpiryMilliseconds(this.turnCredentials)??0)<=this.now()+30000)await this.refreshTurnCredentials(generation,{schedule:false});
      if(generation!==this.generation)return false;
      const pc=this.peerFactory({iceServers:iceServersFor(this.turnCredentials)});this.peer=pc;
      pc.addTransceiver('audio',{direction:'recvonly'});
      this.control=pc.createDataChannel('mozart-control',{ordered:true});
      this.control.onmessage=event=>{if(!this.peerCurrent(generation,pc)||typeof event.data!=='string')return;try{const data=JSON.parse(event.data);if(data.project_id&&data.project_id!==this.projectId)return;dispatch(this,'control',data);if(data.type==='engine_clock')dispatch(this,'clock',data);if(data.type==='mixer_meters')dispatch(this,'meters',data);if(data.type==='transport_ack'||data.type==='pattern_preview_ack')dispatch(this,'ack',data);}catch{}};
      this.meters=pc.createDataChannel('mozart-meters',{ordered:false,maxRetransmits:0});
      this.meters.onmessage=event=>{if(typeof event.data==='string')try{dispatch(this,'meters',JSON.parse(event.data));}catch{}};
      // Persistent mixer meter subscription (Freestyle 328): ask once the meters channel is open.
      {const meters=this.meters,subscribe=()=>{if(meters.readyState!=='open'||meters.subscribed)return;try{meters.send(JSON.stringify({type:'mixer_meters_subscribe',persistent:true}));meters.subscribed=true;}catch{}};meters.onopen=subscribe;}
      // Native editor channels are negotiated at the same ids used by Freestyle.
      this.editor=pc.createDataChannel('mozart-editor',{ordered:true,negotiated:true,id:100});
      this.editorFrames=pc.createDataChannel('mozart-editor-frames',{ordered:false,negotiated:true,id:102});
      this.editorFrames.binaryType='arraybuffer';
      this.editorFrames.onmessage=event=>dispatch(this,'editorframe',event.data);
      this.editor.onmessage=event=>{if(typeof event.data==='string')try{dispatch(this,'editorstate',JSON.parse(event.data));}catch{}};
      pc.ontrack=event=>{
        if(generation!==this.generation||event.track?.kind!=='audio')return;
        this.audio.srcObject=event.streams?.[0]||new MediaStream([event.track]);
        const receiver=event.receiver;
        try{if(receiver&&'jitterBufferTarget'in receiver)receiver.jitterBufferTarget=100;}catch{}
        try{if(receiver&&'playoutDelayHint'in receiver)receiver.playoutDelayHint=.1;}catch{}
        if(this.wantsOutput(projectId))this.resume().catch(()=>{});
        dispatch(this,'track',{track:event.track});
      };
      pc.onconnectionstatechange=()=>{
        if(generation!==this.generation||pc!==this.peer)return;
        if(this.retireClosedPeer(generation,pc))return;
        if(pc.connectionState!=='disconnected')this.clearDisconnectWatch();
        if(pc.connectionState==='connected') {
          this.reconnectAttempts=0;
          if(this.state!=='blocked')this.setState('connected');dispatch(this,'connected',{projectId,trackId:this.trackId,session:{...this.session}});
        } else if(pc.connectionState==='failed') {
          this.peerLost(generation,pc,'failed');
        } else if(pc.connectionState==='disconnected'){this.setState('disconnected');this.watchDisconnected(generation,pc);}
      };
      const offer=await pc.createOffer();
      await pc.setLocalDescription({...offer,sdp:studioOpusOfferSdp(offer.sdp)});
      if(generation!==this.generation)return false;
      // #7 trickle ICE: the offer goes out with the first server-reflexive candidate (short bounded wait) instead of
      // after the relay candidate, and the engine answers without waiting for its own relay candidate; its later
      // candidates come from GET /monitor/candidates. Without trickle the full gather policy applies, as before.
      if(this.trickle)await this.waitForFirstCandidate(pc,this.trickleGatherMs);else await this.waitForIce(pc,8000);
      if(generation!==this.generation)return false;mark('offer-sent');
      const result=await this.request('modesty-bridge:/audio/offer',{method:'POST',body:JSON.stringify({
        project_id:projectId,...this.trackId?{track_id:this.trackId}:{},client_id:this.clientId,mode:'daw',low_latency:true,
        quality_profile:'regional_music',sdp:studioOutboundOfferSdp(pc.localDescription.sdp),turn_credentials:this.turnCredentials,...this.trickle?{trickle:true}:{},
      })});
      if(generation!==this.generation)return false;
      const answer=result.answer||(result.sdp?result:null);
      if(!answer?.sdp)throw new Error('Freestyle did not return a WebRTC audio answer.');mark('answer');
      await pc.setRemoteDescription({type:answer.type||'answer',sdp:answer.sdp});
      if(generation!==this.generation)return false;
      // trickle:false in the reply = the engine waited as before and the answer already holds every candidate.
      this.trickleActive=this.trickle&&(result.trickle===true||result.answer?.trickle===true);
      if(this.trickleActive)this.fetchRemoteCandidates(generation,pc,{projectId,mark}).catch(()=>{});
      this.startStats(generation);
      await this.waitForConnection(pc,20000);mark('connected');
      if(generation===this.generation)this.scheduleTurnRefresh(generation);
      return generation===this.generation;
    } catch(error) {
      if(generation!==this.generation)return false;
      this.active=false;this.cancelTurnRefresh();this.clearDisconnectWatch();if(this.peer){this.peer.ontrack=null;this.peer.onconnectionstatechange=null;this.peer.close();}this.turnCredentials=null;clearTimeout(this.statsTimer);if(this.audio){this.audio.pause();for(const track of this.audio.srcObject?.getTracks?.()||[])track.stop();this.audio.srcObject=null;}
      // A transient bootstrap/connect failure retries the same project; a
      // definite refusal (bad scope/auth) stays an error.
      // peerLost() already scheduled the reconnect for this failure.
      if(this.reconnectTimer!=null&&this.state==='reconnecting')throw error;
      if(retryableMonitorError(error,{recovering:this.reconnectAttempts>0})&&this.scheduleReconnect(error))throw error;
      this.setState('error',{message:error.message,code:error.code,status:error.status});dispatch(this,'error',error);throw error;
    }
  }
  peerCurrent(generation,peer=this.peer){return generation===this.generation&&this.active&&peer===this.peer&&(!peer||peer.signalingState!=='closed'&&peer.connectionState!=='closed');}
  retireClosedPeer(generation,peer){
    if(generation!==this.generation||!this.active||!peer||peer!==this.peer||peer.signalingState!=='closed'&&peer.connectionState!=='closed')return false;
    this.active=false;this.cancelTurnRefresh();this.turnCredentials=null;clearTimeout(this.statsTimer);this.setState('disconnected');return true;
  }
  cancelTurnRefresh(){if(this.turnTimer!=null)this.timerCancel(this.turnTimer);this.turnTimer=null;this.turnRefreshToken=null;}
  queueTurnRefresh(generation,peer,delay,callback){
    this.cancelTurnRefresh();const token={};this.turnRefreshToken=token;
    this.turnTimer=this.timerFactory(async()=>{
      if(this.turnRefreshToken!==token)return;
      this.turnTimer=null;this.turnRefreshToken=null;
      if(!this.peerCurrent(generation,peer)){this.retireClosedPeer(generation,peer);return;}
      await callback();
    },delay);
  }
  scheduleTurnRefresh(generation=this.generation) {
    const peer=this.peer;if(!this.peerCurrent(generation,peer)){this.retireClosedPeer(generation,peer);return;}if(!this.turnCredentials)return;
    const expiry=turnExpiryMilliseconds(this.turnCredentials);if(expiry==null)throw new Error('Freestyle did not return a valid TURN credential expiry.');
    const remaining=expiry-this.now(),lead=Math.min(60000,Math.max(10000,remaining*.1));
    this.queueTurnRefresh(generation,peer,Math.max(1000,remaining-lead),async()=>{
      const previous=this.turnCredentials;
      try{await this.refreshTurnCredentials(generation);}catch(error){
        if(!this.peerCurrent(generation,peer)){this.retireClosedPeer(generation,peer);return;}
        if(this.turnCredentials!==previous)return;
        dispatch(this,'warning',{code:'turn_refresh_failed',message:error.message});
        // Keep a working media connection while retrying a transient credential read.
        this.queueTurnRefresh(generation,peer,Math.max(1000,Math.min(30000,Math.max(0,expiry-this.now())/2)),async()=>{try{await this.refreshTurnCredentials(generation);}catch(retryError){if(this.peerCurrent(generation,peer))dispatch(this,'warning',{code:'turn_refresh_failed',message:retryError.message});else this.retireClosedPeer(generation,peer);}});
      }
    });
  }
  async refreshTurnCredentials(generation=this.generation,{schedule=true}={}) {
    // Bootstrap can refresh before a peer exists. Once a peer is captured, a
    // late credential read must never configure its closed/replaced successor.
    const peer=this.peer,current=()=>this.peerCurrent(generation,peer),stale=()=>{this.retireClosedPeer(generation,peer);return false;};
    if(!current())return stale();
    let data;try{data=await this.request('modesty-bridge:/audio/ice'+(this.dawBaseUrl?`?mozart_origin=${encodeURIComponent(this.dawBaseUrl)}`:''));}catch(error){if(!current())return stale();throw error;}
    if(!current())return stale();
    const credentials=credentialsFrom(data),expiry=turnExpiryMilliseconds(credentials);
    if(expiry==null||expiry<=this.now())throw new Error('Freestyle returned expired TURN credentials. Reconnect the cloud monitor.');
    try{
      if(peer?.setConfiguration){const configuration=peer.getConfiguration?.()||{};if(!current())return stale();peer.setConfiguration({...configuration,iceServers:iceServersFor(credentials)});}
    }catch(error){if(!current())return stale();throw error;}
    if(!current())return stale();this.turnCredentials=credentials;
    if(schedule)this.scheduleTurnRefresh(generation);
    dispatch(this,'turn-refreshed',{expiresAt:credentials.expiresAt});return credentials;
  }
  sendControl(message) {
    if(this.peer?.connectionState!=='connected'||this.control?.readyState!=='open')throw new Error('Connect the Freestyle cloud audio monitor before sending live controls.');
    const allowed=new Set(['set_track_gain','set_track_muted','set_track_soloed','set_plugin_param','set_mix_state','transport_play','transport_pause','transport_seek','transport_seek_and_play','pattern_preview_start','pattern_preview_stop','sample_preview','midi_note','midi_all_notes_off','live_hold']);
    if(!message||!allowed.has(message.type))throw new Error('This live control type has no verified Freestyle data-channel contract.');
    const transport=message.type.startsWith('transport_');
    const payload={...message,project_id:this.projectId,seq:++this.sequence,control_route:'daw',sent_at_ms:performance.now(),...transport?{key:'transport',client_sent_ms:Date.now()}: {}};
    this.control.send(JSON.stringify(payload));return {sent:true,seq:payload.seq,payload};
  }
  sendMidi({trackId,laneId='',note,velocity=.82,on=true,channel=1}) {
    if(this.peer?.connectionState!=='connected'||this.control?.readyState!=='open')throw new Error('Connect the Freestyle cloud audio monitor before playing an instrument.');
    const track=Number(trackId),pitch=Number(note),gain=Number(velocity);
    if((!Number.isFinite(track)||track<=0)&&!laneId)throw new Error('The selected instrument has no cloud track or lane identity.');
    if(!Number.isInteger(pitch)||pitch<0||pitch>127||!Number.isFinite(gain))throw new Error('Provide a valid MIDI note and velocity.');
    const payload={type:'midi_note',project_id:this.projectId,...Number.isFinite(track)&&track>0?{track_id:track}:{},lane_id:String(laneId),note:pitch,velocity:Math.max(0,Math.min(1,gain)),channel:Math.max(1,Math.min(16,Math.round(channel))),on:on!==false,perf_sent_ms:Date.now(),event_id:globalThis.crypto?.randomUUID?.()||`note-${Date.now()}`,event_source:`vegetable:${this.clientId}`};
    this.sendControl(payload);return payload;
  }
  allNotesOff({trackId,laneId=''}={}) {
    if(this.peer?.connectionState!=='connected'||this.control?.readyState!=='open')throw new Error('The cloud instrument connection is unavailable.');
    const track=Number(trackId);
    const payload={type:'midi_all_notes_off',project_id:this.projectId,...Number.isFinite(track)&&track>0?{track_id:track}:{},lane_id:String(laneId)};
    this.sendControl(payload);return payload;
  }
  resume() {
    const audio=this.audio,peer=this.peer,generation=this.generation,version=++this.playPermissionVersion;
    const current=()=>this.peerCurrent(generation,peer)&&audio===this.audio&&version===this.playPermissionVersion&&this.wantsOutput();
    if(!this.wantsOutput()||!audio?.srcObject)return Promise.resolve(false);
    audio.muted=hostPlaysAudio();audio.autoplay=true;
    const permission={generation,version,status:'pending',promise:null};this.playPermission=permission;
    permission.promise=(async()=>{try{await audio.play();if(!current())return false;permission.status='granted';if(peer?.connectionState==='connected')this.setState('connected');return true;}
    catch(error){if(!current())return false;permission.status='blocked';this.setState('blocked',{message:'Click Enable cloud audio to allow browser playback.'});dispatch(this,'blocked',error);throw error;}})();return permission.promise;
  }
  /** Trickle: wait for the first server-reflexive (or relay) candidate, at most `budgetMs`; host candidates are in
   *  the SDP already. The engine learns any other path from the connectivity checks. */
  waitForFirstCandidate(pc,budgetMs=400) {
    if(pc.iceGatheringState==='complete')return Promise.resolve('complete');
    return new Promise(resolve=>{
      const signal=this.abortController?.signal;let done=false;
      const finish=why=>{if(done)return;done=true;clearTimeout(timer);pc.removeEventListener?.('icecandidate',candidate);pc.removeEventListener?.('icegatheringstatechange',change);signal?.removeEventListener?.('abort',abort);resolve(why);};
      const candidate=event=>{const line=event?.candidate?.candidate||'';if(/ typ (srflx|relay)/.test(line))finish('srflx');};
      const change=()=>{if(pc.iceGatheringState==='complete')finish('complete');};const abort=()=>finish('aborted');
      const timer=setTimeout(()=>finish('budget'),budgetMs);
      pc.addEventListener?.('icecandidate',candidate);pc.addEventListener?.('icegatheringstatechange',change);signal?.addEventListener?.('abort',abort,{once:true});
    });
  }
  /** GET /projects/{id}/monitor/candidates long-poll: add each late engine candidate until complete or connected. */
  async fetchRemoteCandidates(generation,pc,{projectId=this.projectId,mark=()=>{},maxPolls=8}={}) {
    let after=0,added=0;
    for(let poll=0;poll<maxPolls;poll++){
      if(!this.peerCurrent(generation,pc)||['connected','closed','failed'].includes(pc.connectionState))break;
      let data;
      try{data=await this.request('modesty-bridge:/call',{method:'POST',body:JSON.stringify({name:'getMonitorCandidates',arguments:{project_id:projectId,client_id:this.clientId,after,wait_ms:2000,...this.trackId?{track_id:this.trackId}:{}}})});}
      catch(error){if(error?.name==='AbortError'||Number(error?.status)===404)break;if(Number(error?.status)===429){await new Promise(resolve=>this.timerFactory(resolve,1000));continue;}break;}
      if(!this.peerCurrent(generation,pc))break;
      const body=data?.candidates?data:data?.response?.candidates?data.response:data?.result?.candidates?data.result:data||{};
      for(const candidate of Array.isArray(body.candidates)?body.candidates:[]){if(!candidate?.candidate)continue;try{await pc.addIceCandidate({candidate:candidate.candidate,sdpMid:candidate.sdpMid??candidate.sdp_mid??'0'});added++;}catch{}}
      if(Number.isSafeInteger(Number(body.next)))after=Number(body.next);
      if(body.complete===true)break;
    }
    this.remoteCandidatesAdded=added;mark('candidates-done');return added;
  }
  waitForIce(pc,timeout) {
    if(pc.iceGatheringState==='complete')return Promise.resolve();
    // Inside Freestyle: the Default studio's gather policy (first relay candidate, 4 s cap).
    try{const host=globalThis.parent?.__freestyleStudioHost;if(host&&typeof host.waitForIceGathering==='function')return host.waitForIceGathering(pc,{signal:this.abortController?.signal}).then(()=>{});}catch{}
    return new Promise(resolve=>{
      const finish=()=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',change);this.abortController.signal.removeEventListener('abort',finish);resolve();};
      const change=()=>{if(pc.iceGatheringState==='complete')finish();};
      const timer=setTimeout(finish,timeout);pc.addEventListener('icegatheringstatechange',change);this.abortController.signal.addEventListener('abort',finish,{once:true});
    });
  }
  waitForConnection(pc,timeout) {
    if(pc.connectionState==='connected')return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const signal=this.abortController.signal;
      const finish=error=>{clearTimeout(timer);pc.removeEventListener('connectionstatechange',change);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
      const change=()=>{if(pc.connectionState==='connected')finish();else if(pc.connectionState==='failed'||pc.connectionState==='closed')finish(new Error('Freestyle could not establish the audio connection.'));};
      const abort=()=>finish(new DOMException('Cloud audio connection cancelled.','AbortError'));
      const timer=setTimeout(()=>finish(new Error('Timed out connecting Freestyle audio. Open the native Studio once, then reconnect.')),timeout);
      pc.addEventListener('connectionstatechange',change);signal.addEventListener('abort',abort,{once:true});
    });
  }
  startStats(generation=this.generation){
    clearTimeout(this.statsTimer);
    // Hidden tab or another Studio view active: keep the peer, poll its stats slowly.
    const delay=()=>viewHidden()?1000:100;
    const poll=async()=>{if(generation!==this.generation||!this.active)return;try{await this.collectStats();}catch{}finally{if(generation===this.generation&&this.active)this.statsTimer=setTimeout(poll,delay());}};
    this.statsTimer=setTimeout(poll,delay());
  }
  async collectStats() {
    if(!this.peer?.getStats)return;
    const peer=this.peer,generation=this.generation,reports=await peer.getStats();if(peer!==this.peer||generation!==this.generation)return this.stats;const stats={audioLevel:0,bytesReceived:0,packetsLost:0,jitter:0,roundTripTime:0,receiverLagSec:this.stats.receiverLagSec,playoutLagSec:this.stats.playoutLagSec};
    reports.forEach(report=>{
      if(report.type==='inbound-rtp'&&(report.kind==='audio'||report.mediaType==='audio')) {
        stats.audioLevel=Number(report.audioLevel)||0;stats.bytesReceived=Number(report.bytesReceived)||0;stats.packetsLost=Number(report.packetsLost)||0;stats.jitter=Number(report.jitter)||0;
        const key=`receiver:${report.id||'audio'}`,total=report.jitterBufferDelay,count=report.jitterBufferEmittedCount,lag=playbackDelaySample(total,count,this.delayMeasurements.get(key),stats.receiverLagSec);if(lag!=null){stats.receiverLagSec=lag;this.delayMeasurements.set(key,{total,count});}
      }
      if(report.type==='media-playout'&&(!report.kind||report.kind==='audio')){const key=`playout:${report.id||'audio'}`,total=report.totalPlayoutDelay,count=report.totalSamplesCount,lag=playbackDelaySample(total,count,this.delayMeasurements.get(key),stats.playoutLagSec);if(lag!=null){stats.playoutLagSec=lag;this.delayMeasurements.set(key,{total,count});}}
      if(report.type==='candidate-pair'&&(report.selected||report.nominated&&report.state==='succeeded'))stats.roundTripTime=Number(report.currentRoundTripTime)||0;
    });
    this.stats=stats;dispatch(this,'stats',stats);return stats;
  }
  /** Current peer failed: tear it down (force) and reopen the same project after a delay. */
  peerLost(generation,pc,reason){
    if(generation!==this.generation||pc!==this.peer)return false;
    this.active=false;this.cancelTurnRefresh();this.clearDisconnectWatch();this.turnCredentials=null;clearTimeout(this.statsTimer);
    pc.ontrack=null;pc.onconnectionstatechange=null;try{pc.close();}catch{}this.peer=null;
    if(this.audio){try{this.audio.pause();}catch{}for(const track of this.audio.srcObject?.getTracks?.()||[])track.stop();this.audio.srcObject=null;}
    const error=new Error(reason==='disconnected'?'The Freestyle audio connection stayed disconnected.':'The Freestyle audio connection failed.');error.code='monitor_peer_'+reason;
    if(this.scheduleReconnect(error))return true;
    this.setState('error',{message:error.message+' Reconnect the cloud monitor.',code:error.code});dispatch(this,'error',error);return true;
  }
  /** Keepalive: a peer that stays disconnected past the grace period is dead. */
  watchDisconnected(generation,pc){
    if(this.disconnectTimer!=null)return;
    this.disconnectTimer=this.timerFactory(()=>{this.disconnectTimer=null;if(generation===this.generation&&pc===this.peer&&pc.connectionState==='disconnected')this.peerLost(generation,pc,'disconnected');},this.reconnectPolicy.disconnectGraceMs);
  }
  clearDisconnectWatch(){if(this.disconnectTimer!=null){this.timerCancel(this.disconnectTimer);this.disconnectTimer=null;}}
  /** Bounded exponential backoff (3 s, 6 s, 12 s … ≤30 s) for the same project only. */
  scheduleReconnect(error){
    const context=this.requestedContext||this.lastContext,policy=this.reconnectPolicy;
    if(!context||this.unloading)return false;
    this.cancelReconnect();
    const attempt=this.reconnectAttempts+1;
    if(attempt>policy.maxAttempts){this.lastContext=context;const message=`The Freestyle audio connection could not be restored after ${policy.maxAttempts} attempts. Use Audio Setup → Connect live playback to retry.`;this.setState('error',{message,code:'monitor_reconnect_exhausted'});dispatch(this,'error',Object.assign(new Error(message),{code:'monitor_reconnect_exhausted',cause:error}));return true;}
    this.reconnectAttempts=attempt;this.lastContext=context;
    const delayMs=Math.min(policy.maxDelayMs,policy.baseMs*2**(attempt-1)),token=this.reconnectToken,generation=this.generation;
    this.setState('reconnecting',{attempt,delayMs,message:'Reconnecting Freestyle audio…'});dispatch(this,'reconnecting',{attempt,delayMs,projectId:context.projectId,reason:error?.message});
    this.reconnectTimer=this.timerFactory(()=>{
      this.reconnectTimer=null;
      // No reconnect after a project change, a user stop or unload.
      if(token!==this.reconnectToken||generation!==this.generation||this.unloading||(this.requestedContext&&this.requestedContext!==context)||this.lastContext!==context)return;
      this.start(context.projectId,context.trackId,{reconnecting:true}).catch(()=>{});
    },delayMs);
    return true;
  }
  cancelReconnect(){this.reconnectToken++;if(this.reconnectTimer!=null){this.timerCancel(this.reconnectTimer);this.reconnectTimer=null;}}
  /** Manual / visibility / online retry of the last project while in error or reconnecting. */
  reconnectNow(){
    const context=this.lastContext;if(!context||this.unloading||!['error','reconnecting','disconnected'].includes(this.state))return null;
    this.cancelReconnect();return this.start(context.projectId,context.trackId).catch(()=>false);
  }
  attachLifecycle({window:win=globalThis.window,document:doc=globalThis.document}={}){
    if(this.lifecycleDisposer)return this.lifecycleDisposer;
    const wake=()=>{if(doc?.visibilityState&&doc.visibilityState!=='visible'||viewHidden(doc))return;this.reconnectNow();};
    const unload=()=>{this.unloading=true;this.cancelReconnect();this.clearDisconnectWatch();};
    const show=event=>{if(event?.persisted)this.unloading=false;};
    doc?.addEventListener?.('visibilitychange',wake);win?.addEventListener?.('online',wake);win?.addEventListener?.('pagehide',unload);win?.addEventListener?.('pageshow',show);viewActivity.addEventListener('change',wake);
    return this.lifecycleDisposer=()=>{viewActivity.removeEventListener('change',wake);doc?.removeEventListener?.('visibilitychange',wake);win?.removeEventListener?.('online',wake);win?.removeEventListener?.('pagehide',unload);win?.removeEventListener?.('pageshow',show);this.lifecycleDisposer=null;};
  }
  stop({reconnecting=false}={}) {
    if(!reconnecting){this.cancelReconnect();this.lastContext=null;}this.clearDisconnectWatch();
    this.generation++;this.active=false;
    this.playPermissionVersion++;this.playPermission=null;this.requestedContext=null;this.opening?.finish(null,false);this.opening=null;
    this.abortController?.abort();this.cancelTurnRefresh();clearTimeout(this.statsTimer);this.turnCredentials=null;this.session=null;this.dawBaseUrl='';
    if(this.peer){this.peer.ontrack=null;this.peer.onconnectionstatechange=null;this.peer.close();this.peer=null;}
    if(this.audio){this.audio.pause();for(const track of this.audio.srcObject?.getTracks?.()||[])track.stop();this.audio.srcObject=null;}
    this.stats={audioLevel:0,bytesReceived:0,packetsLost:0,jitter:0,roundTripTime:0,receiverLagSec:null,playoutLagSec:null};this.delayMeasurements=new Map();
    this.setState('idle');
  }
}
