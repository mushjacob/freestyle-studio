/** Receive Freestyle's server-rendered audio. No local synthesizer or audio rendering. */
import {CloudAudibility} from './cloud-audibility.js';
import {nativeStereoOpusOffer,nativeFilterIceSdp,nativeAllowTailnetCandidates,nativeTailnetHostCandidate} from './cloud-monitor-sdp.js';
import {selectedCandidatePair} from './remote-plugin.js';
import {StudioApiClient} from './studio-api-client.js';
import {hostFetch,freestyleHost} from './freestyle-host-transport.js';
/** The host plays this engine session's audio itself (capability hostAudio): this peer stays muted
 * (control, clock and stats only), so switching views never gaps or doubles the sound. */
const hostPlaysAudio=()=>{try{return freestyleHost()?.capabilities?.hostAudio===true;}catch{return false;}};
// STUN, channel names and deployed playback policy match the Freestyle Studio.
const NATIVE_STUN = {urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']};
const dispatch = (target,type,detail) => target.dispatchEvent(new CustomEvent(type,{detail}));
function monitorErrorFields(value){
 const fields={};
 for(const source of [value?.error?.metadata,value?.error,value?.metadata,value]){
  if(!source||typeof source!=='object')continue;
  for(const key of ['code','stage','engineStatus','upstreamRequestId']){
   const item=source[key],limit=key==='upstreamRequestId'?160:128;
   if(typeof item==='string'&&item.length<=limit&&/^[A-Za-z0-9_.:-]+$/.test(item))fields[key]=item;
   else if(Number.isInteger(item)&&(key==='code'&&item>=-2147483648&&item<2147483648||key==='engineStatus'&&item>=0&&item<=599))fields[key]=item;
  }
 }
 return fields;
}

/** Release 2026-11-14 (sendMonitorOffer): the documented offer problems we act on. The local
 * bridge answers {"error":"cloud_audio_error","code":<upstream code>,"upstreamStatus",
 * "retryAfterSec","detail"}: the structured upstream `code` decides; the message text is matched
 * only when no specific code came through (older bridge). 'client_id_in_use' (409
 * webrtc_client_id_in_use: nothing was replaced, re-offer with a NEW client_id), 'engine_update'
 * (503 engine_update_required: nothing reached the engine, retry later), 'delegation' (502
 * peer_delegation_unconfirmed: no peer was left open, retry shortly), else null. */
export function monitorOfferProblem(error){
 const code=String(error?.code||''),known={webrtc_client_id_in_use:'client_id_in_use',engine_update_required:'engine_update',peer_delegation_unconfirmed:'delegation'};
 if(Object.hasOwn(known,code))return known[code];
 // A specific (other) structured code is authoritative: no guessing from its message.
 if(code&&code!=='cloud_audio_error'&&!/^\d+$/.test(code))return null;
 const text=`${code} ${String(error?.message||'')}`;
 if(/webrtc_client_id_in_use/i.test(text)||error?.status===409&&/client[ _-]?id/i.test(text)&&/in use|another peer/i.test(text))return'client_id_in_use';
 if(code==='engine_update_required'||/engine_update_required/i.test(text)||/engine\b.{0,40}\b(?:is )?(?:still )?being updated/i.test(text))return'engine_update';
 if(code==='peer_delegation_unconfirmed'||/peer_delegation_unconfirmed/i.test(text))return'delegation';
 return null;
}
/** Backoff before re-opening the monitor after engine_update_required / peer_delegation_unconfirmed. */
export const MONITOR_UPDATE_RETRY_MS=Object.freeze([2000,4000,8000,16000,30000,30000]);
const newClientId=()=>`illogic-${globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`}`;
/** Trickle ICE (sendMonitorOffer `trickle:true`, release 2026-11-18) is on unless this browser
 * switched it off for an A/B latency measurement (localStorage illogic:monitor-trickle = off). */
export function monitorTrickleEnabled(environment=globalThis){try{return environment?.localStorage?.getItem?.('illogic:monitor-trickle')!=='off';}catch{return true;}}
/** Bounded getMonitorCandidates polling: at most this many long-polls (2 s each) per offer. */
export const MONITOR_TRICKLE_MAX_POLLS=10,MONITOR_TRICKLE_WAIT_MS=2000;
/** Realtime → Instrument notes and pad samples on mozart-control (#9, documented 2026-11-18). */
export const LIVE_PLAY_MESSAGES=new Set(['midi_note','midi_all_notes_off','sample_preview','sample_preview_release','live_hold']);
/** sample_preview's documented `sampleRange` is {offsetSec, durationSec}; other spellings are converted, junk dropped. */
export function documentedSampleRange(range){
 if(!range||typeof range!=='object')return null;
 const offset=Number(range.offsetSec??range.offset_sec??range.startSec??range.start_sec),duration=Number(range.durationSec??range.duration_sec??(Number.isFinite(Number(range.endSec??range.end_sec))?Number(range.endSec??range.end_sec)-offset:NaN));
 return Number.isFinite(offset)&&offset>=0&&Number.isFinite(duration)&&duration>0?{offsetSec:offset,durationSec:duration}:null;
}

/** MCP tools may be proxied as JSON or returned in their standard content envelope. */
export function unpackMonitorResult(result) {
  let data=result?.structuredContent;
  if(!data&&Array.isArray(result?.content)){try{data=JSON.parse(result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'));}catch{}}
  data=data??result;const value=data?.response??data;
  if(result?.isError||data?.ok===false||data?.error||value?.ok===false||value?.error){const error=new Error(value?.message||value?.error?.message||data?.message||(typeof value?.error==='string'?value.error:'Freestyle could not open its live audio session.'));Object.assign(error,monitorErrorFields(data),monitorErrorFields(value));throw error;}
  return value;
}
export function turnExpiryMilliseconds(credentials,receivedAt=null) {
  const raw=credentials?.expiresAt;if(raw===null||raw===undefined||raw==='')return null;
  let expiry;
  if(typeof raw==='number'||(typeof raw==='string'&&/^\d+(?:\.\d+)?$/.test(raw))){const value=Number(raw);expiry=Number.isFinite(value)?value<1e12?value*1000:value:null;}
  else{const value=Date.parse(raw);expiry=Number.isFinite(value)?value:null;}
  // Pro bounds the server expiry by an explicitly supplied TTL in seconds.
  // Never turn an absent/invalid expiry or an untyped TTL into a guessed lease.
  const ttl=credentials?.ttlSec;
  return expiry!==null&&typeof receivedAt==='number'&&Number.isFinite(receivedAt)&&typeof ttl==='number'&&Number.isFinite(ttl)&&ttl>0?Math.min(expiry,Math.floor(receivedAt/1000)*1000+Math.floor(ttl)*1000):expiry;
}
function credentialsFrom(value) {
  const data=unpackMonitorResult(value),credentials=data?.turnCredentials??data?.turn_credentials??data;
  const urls=typeof credentials?.urls==='string'?[credentials.urls]:Array.isArray(credentials?.urls)?credentials.urls.filter(url=>typeof url==='string'&&url):[];
  if(!urls.length||typeof credentials?.username!=='string'||!credentials.username.length||typeof credentials?.credential!=='string'||!credentials.credential.length)throw new Error('Freestyle did not return usable TURN relay credentials.');
  return {urls,username:credentials.username,credential:credentials.credential,expiresAt:credentials.expiresAt,...credentials.ttlSec!=null?{ttlSec:credentials.ttlSec}:{}};
}
/** The 328 release's persistent meter subscription for one project's monitor peer. */
export function meterSubscribeMessage(projectId){
  return typeof projectId==='string'&&projectId?{type:'mixer_meters_subscribe',project_id:projectId,persistent:true}:null;
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

/** Playback profile for the monitor offer, including a mobile/save-data guard. */
export function nativeMonitorPlaybackProfile(navigator=globalThis.navigator) {
  const mobile=/Android|iPhone|iPad|iPod|Mobile/i.test(String(navigator?.userAgent||''))||(navigator?.platform==='MacIntel'&&navigator?.maxTouchPoints>1);
  const connection=navigator?.connection||navigator?.mozConnection||navigator?.webkitConnection;
  return mobile||connection?.saveData
    ?{qualityProfile:'robust_mobile',lowLatency:false,receiverTargetMs:160}
    :{qualityProfile:'regional_music',lowLatency:true,receiverTargetMs:5};
}

/** Diagnostics only: per-channel message type counts (type names/counts, never payloads). */
function countChannelMessage(monitor,label,data){try{const stats=monitor.channelStats||=({channels:{}}),channel=stats.channels[label]||=({messages:0,binary:0,unparsed:0,types:{}});channel.messages++;if(typeof data!=='string'){channel.binary++;return;}let type='(none)';try{const parsed=JSON.parse(data);type=typeof parsed?.type==='string'?parsed.type.slice(0,40):'(none)';}catch{channel.unparsed++;return;}if(type in channel.types||Object.keys(channel.types).length<40)channel.types[type]=(channel.types[type]||0)+1;}catch{}}
export class CloudMonitor extends EventTarget {
  constructor({fetch:fetchImpl=(...args)=>hostFetch(...args),peerFactory=config=>new RTCPeerConnection(config),audio=null,now=()=>Date.now(),timerFactory=(callback,delay)=>setTimeout(callback,delay),timerCancel=timer=>clearTimeout(timer),lifecycle=globalThis.window??null,studioClient=null,trickle=monitorTrickleEnabled}={}) {
    super();
    // Trickle ICE: the offer asks for an answer that does not wait for the engine's relay candidate;
    // later candidates come from getMonitorCandidates (trickleCandidates below).
    this.trickleEnabled=typeof trickle==='function'?trickle:()=>trickle!==false;this.trickle=null;
    // stopAudioMonitor (DELETE /projects/{id}/monitor?client_id) through the same-origin
    // /api/studio proxy: on pagehide and whenever the monitor is stopped for good (project
    // switch, disconnect), so the engine tears our peer down at once instead of timing it out.
    this.studioClient=studioClient;this.offered=null;this.remoteClose=null;this.updateRetry=null;this.grantNotice=null;
    if(typeof lifecycle?.addEventListener==='function'){this.onPageHide=()=>{this.closeRemotePeer({keepalive:true,reason:'pagehide'});};lifecycle.addEventListener('pagehide',this.onPageHide);}
    this.fetch=fetchImpl;
    this.peerFactory=peerFactory;
    // Release 2026-11-12 (realtime docs "Fast input on the monitoring peer"): the OAuth
    // monitor/offer answer carries peerGrant ("write"|"read") and peerGrantExpiresAt (unix s).
    // A write grant accepts Studio fast input on mozart-control and mozart-editor; a read grant
    // is refused (project_control_forbidden / project_write_forbidden). Renew by re-offering
    // with the SAME client_id before expiry (the engine replaces the old peer).
    this.peerGrant=null;this.peerGrantExpiresAt=null;this.peerGrantReceivedAt=null;this.controlForbidden=null;this.grantTimer=null;this.clientId=null;this.clientIdProject=null;
    this.audio=audio;this._volume=1;this.now=now;this.timerFactory=timerFactory;this.timerCancel=timerCancel;this.turnCredentials=null;this.session=null;this.dawBaseUrl='';
    this.audibility=new CloudAudibility({audible:false,getVolume:()=>this.volume,setTimer:timerFactory,clearTimer:timerCancel,apply:state=>{if(this.audio){this.audio.muted=state.muted||hostPlaysAudio();this.audio.volume=state.volume;}}});
    this.peer=null;
    this._state='idle';this.active=false;this.lastError=null;
    this.generation=0;this.sequence=0;
    this.stats={audioLevel:0,bytesReceived:0,packetsLost:0,jitter:0,roundTripTime:0,receiverLagSec:null,playoutLagSec:null};this.delayMeasurements=new Map();
  }
  get state(){return this._state;}
  /** Local listening level only; saved mixer gain and rendered exports are unchanged. */
  get volume(){return this._volume;}
  get audibilityEpoch(){return this.audibility.epoch;}
  holdAudibility(){return this.audibility.hold();}
  restoreAudibility(epoch=this.audibilityEpoch){return this.audibility.open(epoch);}
  silence(){return this.audibility.silence();}
  set volume(value){this.setVolume(value);}
  setVolume(value){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)throw new RangeError('Monitor volume must be a number from 0 to 1.');
    const previous=this._volume;
    this._volume=value;
    this.audibility.refresh();
    if(value!==previous)dispatch(this,'volume',{volume:value,previous});
    return value;
  }
  setState(state,detail={}) {this._state=state;if(state==='error')this.lastError={message:String(detail.message||'Cloud audio connection failed.'),code:null,...monitorErrorFields(detail),status:detail.status||null,at:this.now()};else if(state==='connecting'||state==='connected')this.lastError=null;dispatch(this,'state',{state,...detail});}
  async request(path,options={}) {
    const response=await this.fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers},signal:this.abortController.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok) {
      const message=data.error?.message||data.detail||data.message||data.error||`Freestyle audio request failed (${response.status}).`;
      const error=new Error(typeof message==='string'?message:JSON.stringify(message));error.status=response.status;Object.assign(error,monitorErrorFields({code:typeof data.error==='string'?data.error:undefined}),monitorErrorFields(data));
      // Bridge-relayed upstream status and retry hint (bounded numbers only).
      if(Number.isInteger(data.upstreamStatus)&&data.upstreamStatus>=400&&data.upstreamStatus<=599)error.upstreamStatus=data.upstreamStatus;
      const retry=Number(data.retryAfterSec);if(Number.isFinite(retry)&&retry>=0&&retry<=86400)error.retryAfterSec=retry;
      throw error;
    }
    return unpackMonitorResult(data);
  }
  async start(projectId,trackId,{useProjectDefault=()=>false,canRecover=()=>false,_recovery=null,_retry=null}={}) {
    if(!projectId)throw new Error('Open a cloud project before connecting its monitor.');
    if(typeof useProjectDefault!=='function')throw new TypeError('Default audio context requires a scoped verification function.');
    if(typeof canRecover!=='function')throw new TypeError('Monitor recovery requires a scoped eligibility function.');
    if(_recovery&&(_recovery!==this.recoveryRequest||_recovery.cancelled))return false;
    this.stop({preserveRecovery:_recovery,retainRemote:true,_retry:_retry});const generation=this.generation,playbackProfile=nativeMonitorPlaybackProfile();
    if(this.offered&&this.offered.projectId!==projectId)this.closeRemotePeer({keepalive:true,reason:'project-switch'});
    this.abortController=new AbortController();this.active=true;
    this.projectId=projectId;this.trackId=trackId||'';
    // One stable client_id per monitor and project: recovery and grant renewal re-offer with it.
    if(!this.clientId||this.clientIdProject!==projectId){this.clientId=newClientId();this.clientIdProject=projectId;}
    if(!this.audio) {
      this.audio=document.createElement('audio');this.audio.hidden=true;this.audio.autoplay=true;this.audio.playsInline=true;
      this.audio.setAttribute('playsinline','');this.audio.dataset.vegetableCloudMonitor='true';document.body.append(this.audio);
    }
    this.audibility.refresh();
    // Prime the native media element in the initiating user gesture.
    this.audio.play().catch(()=>{});
    this.setState('connecting');
    try {
      // Retain the expected take locally while eliding only a proven redundant
      // default scope from signaling. Recheck before each request; a later read
      // must never turn an explicitly selected take into an unverified default.
      const requestContext=()=>{const useDefault=useProjectDefault();if(typeof useDefault!=='boolean')throw new TypeError('Default audio context verification must return a boolean.');return{project_id:projectId,...!useDefault&&this.trackId?{track_id:this.trackId}:{}};};
      const startContext=requestContext(),omittedExpectedTrack=!!trackId&&!Object.hasOwn(startContext,'track_id');
      // In-page bridge: the engine session is already open; the expected context track is echoed, never selected.
      const opened=await this.request('/api/audio/start',{method:'POST',body:JSON.stringify({...startContext,...this.trackId?{context_track_id:this.trackId}:{}})});
      if(generation!==this.generation)return false;
      const session=opened.session||{};
      const returnedTracks=[opened.trackId,opened.track_id,session.trackId,session.track_id].filter(value=>value!=null),returnedProjects=[opened.projectId,opened.project_id,session.projectId,session.project_id].filter(value=>value!=null);
      if(returnedProjects.some(value=>typeof value!=='string'||value!==projectId)||returnedTracks.some(value=>typeof value!=='string'||!value||value!==returnedTracks[0]||trackId&&value!==trackId)||omittedExpectedTrack&&!returnedTracks.length)throw Object.assign(new Error('Freestyle returned a different or unverified audio project or track context.'),{code:'monitor_context_mismatch'});
      this.dawBaseUrl=session.dawBaseUrl||session.daw_base_url||opened.dawBaseUrl||'';
      this.trackId=returnedTracks[0]||this.trackId;
      // Retain routing metadata only. Engine access tokens are neither needed nor exposed.
      this.session={dawBaseUrl:this.dawBaseUrl,phase:session.phase,projectId:this.projectId,trackId:this.trackId};
      this.turnCredentials=credentialsFrom(opened);
      this.turnCredentialsReceivedAt=this.now();
      if((turnExpiryMilliseconds(this.turnCredentials,this.turnCredentialsReceivedAt)??0)<=this.now()+30000)await this.refreshTurnCredentials(generation,{schedule:false});
      if(generation!==this.generation)return false;
      const pc=this.peerFactory({iceServers:iceServersFor(this.turnCredentials)});this.peer=pc;
      const recoveryPolicy={generation,projectId,trackId:this.trackId,peer:pc,useProjectDefault:_recovery?.useProjectDefault??useProjectDefault,canRecover,established:false};this.recoveryPolicy=recoveryPolicy;
      pc.addTransceiver('audio',{direction:'recvonly'});
      this.control=pc.createDataChannel('mozart-control',{ordered:true});
      const control=this.control;control.onclose=()=>{if(generation===this.generation&&this.control===control&&recoveryPolicy.established){this.setState('disconnected');this.inspectMonitorRecovery(recoveryPolicy);}};
      this.control.onmessage=event=>{countChannelMessage(this,'mozart-control',event.data);if(typeof event.data!=='string')return;try{const data=JSON.parse(event.data);if(data.project_id&&data.project_id!==this.projectId)return;if(data.code==='project_control_forbidden'&&generation===this.generation&&this.control===control)this.noteControlForbidden(data);dispatch(this,'control',data);if(data.type==='engine_clock')dispatch(this,'clock',data);if(data.type==='mixer_meters'&&generation===this.generation&&this.control===control)dispatch(this,'meters',data);if(data.type==='transport_ack'||data.type==='pattern_preview_ack')dispatch(this,'ack',data);}catch{}};
      this.meters=pc.createDataChannel('mozart-meters',{ordered:false,maxRetransmits:0});
      const meters=this.meters;
      // Freestyle (328 release): meters are pushed once the peer subscribes on
      // mozart-meters with persistent:true. Each new peer/channel (start,
      // recovery, reconnect) subscribes again when its channel opens.
      meters.onopen=()=>{if(generation===this.generation&&this.meters===meters)this.subscribeMeters(meters);};
      this.meters.onmessage=event=>{countChannelMessage(this,'mozart-meters',event.data);if(typeof event.data!=='string'||generation!==this.generation||this.meters!==meters)return;try{dispatch(this,'meters',JSON.parse(event.data));}catch{}};
      // Native editor channels are negotiated at the same ids used by Freestyle.
      this.editor=pc.createDataChannel('mozart-editor',{ordered:true,negotiated:true,id:100});
      this.editorFrames=pc.createDataChannel('mozart-editor-frames',{ordered:false,negotiated:true,id:102});
      this.editorFrames.binaryType='arraybuffer';
      const editor=this.editor,editorFrames=this.editorFrames;
      // A queued message from a replaced channel can reuse the same numeric
      // native track ID. Fence the source connection before publishing it.
      const editorChannelCurrent=channel=>generation===this.generation&&this.active&&this.peer===pc&&!['closed','failed'].includes(pc.connectionState)&&channel.readyState==='open';
      editorFrames.onmessage=event=>{if(this.editorFrames===editorFrames&&editorChannelCurrent(editorFrames))dispatch(this,'editorframe',event.data);};
      editor.onmessage=event=>{if(this.editor!==editor||!editorChannelCurrent(editor)||typeof event.data!=='string')return;let data;try{data=JSON.parse(event.data);}catch{return;}
        // Release 2026-11-14: a read grant is refused on editor input with project_control_forbidden too.
        if(data?.type==='editor.state'&&data.code==='project_control_forbidden')this.noteControlForbidden(data);
        dispatch(this,'editorstate',data);};
      pc.ontrack=event=>{
        if(generation!==this.generation||event.track?.kind!=='audio')return;
        this.audio.srcObject=event.streams?.[0]||new MediaStream([event.track]);
        const receiver=event.receiver;
        try{if(receiver&&'jitterBufferTarget'in receiver)receiver.jitterBufferTarget=playbackProfile.receiverTargetMs;}catch{}
        try{if(receiver&&'playoutDelayHint'in receiver)receiver.playoutDelayHint=playbackProfile.receiverTargetMs/1000;}catch{}
        this.resume().catch(()=>{});
        dispatch(this,'track',{track:event.track});
      };
      pc.onconnectionstatechange=()=>{
        if(generation!==this.generation)return;
        if(pc.connectionState==='connected') {
          recoveryPolicy.established=true;this.inspectMonitorRecovery(recoveryPolicy);
          if(this.state!=='blocked')this.setState('connected');dispatch(this,'connected',{projectId,trackId:this.trackId,session:{...this.session}});
        } else if(pc.connectionState==='failed') {
          this.active=false;this.cancelTurnRefresh();this.turnCredentials=null;clearTimeout(this.statsTimer);const error=new Error('The Freestyle audio connection failed. Reconnect the cloud monitor.');this.setState('error',{message:error.message});dispatch(this,'error',error);
          this.inspectMonitorRecovery(recoveryPolicy);
        } else if(pc.connectionState==='disconnected'){this.setState('disconnected');this.inspectMonitorRecovery(recoveryPolicy);}
        else if(pc.connectionState==='closed')this.inspectMonitorRecovery(recoveryPolicy);
      };
      const offer=await pc.createOffer(),localOffer={type:offer.type,sdp:nativeStereoOpusOffer(offer.sdp)};
      await pc.setLocalDescription(localOffer);
      await this.waitForIce(pc,8000);
      if(generation!==this.generation)return false;
      let wantTrickle=false;try{wantTrickle=this.trickleEnabled()===true;}catch{}
      const sendOffer=()=>this.request('/api/audio/offer',{method:'POST',body:JSON.stringify({
        ...requestContext(),client_id:this.clientId,mode:'daw',low_latency:playbackProfile.lowLatency,...wantTrickle?{trickle:true}:{},
        quality_profile:playbackProfile.qualityProfile,sdp:nativeFilterIceSdp(pc.localDescription?.sdp||localOffer.sdp||offer.sdp,{allowTailnet:nativeAllowTailnetCandidates()}).sdp,turn_credentials:this.turnCredentials,
      })});
      let result;
      try{result=await sendOffer();}catch(error){
        // 409 webrtc_client_id_in_use: nothing was replaced. One new client_id, one re-offer (same SDP).
        if(generation!==this.generation||monitorOfferProblem(error)!=='client_id_in_use')throw error;
        const previous=this.clientId;this.clientId=newClientId();this.clientIdProject=projectId;
        dispatch(this,'clientid',{reason:'webrtc_client_id_in_use',previous,clientId:this.clientId});
        result=await sendOffer();
      }
      if(generation!==this.generation)return false;
      if(_recovery&&!this.recoveryAllowed(_recovery))throw Object.assign(new Error('The recovering monitor context is no longer eligible.'),{name:'AbortError',code:'monitor_recovery_cancelled'});
      const answer=result.answer||(result.sdp?result:null);
      if(!answer?.sdp)throw new Error('Freestyle did not return a WebRTC audio answer.');
      this.adoptPeerGrant(result);this.offered={projectId,clientId:this.clientId,trackId:this.trackId};
      await pc.setRemoteDescription({type:answer.type||'answer',sdp:nativeFilterIceSdp(answer.sdp,{allowTailnet:nativeAllowTailnetCandidates()}).sdp});
      // The engine says whether it really answered early: only then are there later candidates to fetch.
      this.trickle={requested:wantTrickle,answered:result.trickle===true,polls:0,added:0,skipped:0,complete:result.trickle!==true,error:null};
      if(result.trickle===true)this.trickleCandidates(pc,generation,projectId,this.clientId,this.trickle).catch(()=>{});
      this.startStats(generation);
      await this.waitForConnection(pc,20000);
      if(generation===this.generation){this.scheduleTurnRefresh(generation);this.schedulePeerGrantRenewal(generation);this.updateRetry=null;}
      return generation===this.generation;
    } catch(error) {
      if(generation!==this.generation)return false;
      this.active=false;this.cancelTurnRefresh();if(this.peer){this.peer.ontrack=null;this.peer.onconnectionstatechange=null;this.peer.close();}this.turnCredentials=null;clearTimeout(this.statsTimer);if(this.audio){this.audio.pause();for(const track of this.audio.srcObject?.getTracks?.()||[])track.stop();this.audio.srcObject=null;}
      this.setState('error',{message:error.message,...monitorErrorFields(error),status:error.status});dispatch(this,'error',error);
      // 503 engine_update_required / 502 peer_delegation_unconfirmed: one status message, then a
      // bounded backoff re-open of the same scope (never during a recovery, which has its own).
      if(!_recovery)this.scheduleUpdateRetry(error,{projectId,trackId,useProjectDefault,canRecover,retry:_retry});
      throw error;
    }
  }
  /** Trickle ICE after an early answer: long-poll getMonitorCandidates (GET /projects/{id}/monitor/candidates
   * ?client_id&after&wait_ms) and add each {candidate, sdpMid} to the peer, passing `next` back as `after`,
   * until `complete`, the peer connects/closes, or the bounded poll budget ends. Never throws: a failed poll
   * leaves the peer to connect on the candidates the answer already carried (direct routes). */
  async trickleCandidates(pc,generation,projectId,clientId,stats={polls:0,added:0,skipped:0,complete:false,error:null}){
    const current=()=>generation===this.generation&&this.peer===pc&&!['connected','closed','failed'].includes(pc.connectionState);
    let after=0;
    for(let poll=0;poll<MONITOR_TRICKLE_MAX_POLLS&&current();poll++){
      let data=null,status=null;
      try{
        this.studioClient||=new StudioApiClient();
        const request=this.studioClient.prepare('getMonitorCandidates',{path:{project_id:projectId},query:{client_id:clientId,after,wait_ms:MONITOR_TRICKLE_WAIT_MS}});
        const response=await this.fetch('/api/studio',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:this.abortController?.signal});
        status=response?.status??null;try{data=await response?.json?.();}catch{}
        if(!response?.ok){stats.error={status,code:typeof data?.error?.code==='string'?data.error.code.slice(0,80):null};break;}
      }catch(error){if(error?.name!=='AbortError')stats.error={status,code:null,message:String(error?.message||error).slice(0,120)};break;}
      stats.polls++;
      const value=data?.response??data,candidates=Array.isArray(value?.candidates)?value.candidates:[];
      for(const item of candidates){
        if(generation!==this.generation||this.peer!==pc||pc.connectionState==='closed')return stats;
        const line=typeof item?.candidate==='string'?item.candidate:'';if(!line)continue;
        if(!nativeAllowTailnetCandidates()&&nativeTailnetHostCandidate(line)){stats.skipped++;continue;}
        try{await pc.addIceCandidate({candidate:line,...typeof item.sdpMid==='string'?{sdpMid:item.sdpMid}:{sdpMid:'0'},...Number.isInteger(item.sdpMLineIndex)?{sdpMLineIndex:item.sdpMLineIndex}:{}});stats.added++;}catch{stats.skipped++;}
      }
      if(Number.isInteger(value?.next)&&value.next>=after)after=value.next;
      if(value?.complete===true){stats.complete=true;break;}
      // No progress marker at all (not the documented shape): stop instead of spinning.
      if(!Number.isInteger(value?.next)&&!candidates.length)break;
    }
    dispatch(this,'trickle',{...stats,generation});return stats;
  }
  cancelUpdateRetry(){const retry=this.updateRetry;if(retry?.timer!=null)this.timerCancel(retry.timer);this.updateRetry=null;}
  scheduleUpdateRetry(error,{projectId,trackId,useProjectDefault,canRecover,retry=null}){
    const problem=monitorOfferProblem(error);if(problem!=='engine_update'&&problem!=='delegation'){this.cancelUpdateRetry();return false;}
    const notice=problem==='engine_update'?{code:'engine_update_required',message:'This project\u2019s Freestyle engine is being updated. Cloud audio reconnects automatically in a moment.'}:{code:'peer_delegation_unconfirmed',message:'Freestyle could not confirm the live audio connection. Retrying shortly.'};
    // Only a scope the caller declared recoverable is re-opened unattended.
    if(!this.recoveryAllowed({canRecover})){this.cancelUpdateRetry();dispatch(this,'warning',{...notice,message:problem==='engine_update'?'This project\u2019s Freestyle engine is being updated. Try cloud audio again in a moment.':'Freestyle could not confirm the live audio connection. Try again in a moment.'});return false;}
    const attempts=(retry?.attempts??0)+1;if(attempts>MONITOR_UPDATE_RETRY_MS.length){this.updateRetry=null;dispatch(this,'warning',{code:problem==='engine_update'?'engine_update_required':'peer_delegation_unconfirmed',final:true,message:'Freestyle cloud audio is still unavailable after several retries. Press Play or Connect live cloud audio to try again.'});return false;}
    // The server's retryAfterSec wins over our backoff (bounded 1 s–5 min).
    const hinted=Number.isFinite(error?.retryAfterSec)?Math.min(300000,Math.max(1000,Math.round(error.retryAfterSec*1000))):null;
    const delay=hinted??MONITOR_UPDATE_RETRY_MS[attempts-1],generation=this.generation;
    // One status message per outage, not per attempt.
    if(attempts===1)dispatch(this,'warning',{...notice,retryInMs:delay});
    const state={attempts,problem,projectId,trackId,generation,timer:null};this.updateRetry=state;
    state.timer=this.timerFactory(()=>{
      state.timer=null;if(this.updateRetry!==state||this.generation!==generation||this.active||this.recoveryRequest)return;
      if(!this.recoveryAllowed({canRecover})){this.updateRetry=null;return;}
      dispatch(this,'updateretry',{attempt:attempts,problem,projectId});
      this.start(projectId,trackId,{useProjectDefault,canRecover,_retry:state}).catch(()=>{});
    },delay);
    return true;
  }
  /** Adopt the documented monitor/offer grant fields (never guessed: anything else is null). */
  adoptPeerGrant(result){
    const grant=result?.peerGrant??result?.peer_grant,expires=result?.peerGrantExpiresAt??result?.peer_grant_expires_at;
    this.peerGrant=grant==='write'||grant==='read'?grant:null;
    this.peerGrantExpiresAt=Number.isSafeInteger(expires)&&expires>0?expires:null;
    this.peerGrantReceivedAt=this.now();this.controlForbidden=null;
    dispatch(this,'grant',this.grantState());
    // One status message per project and grant (renewals, recoveries and refusal acks do not repeat it).
    if(this.peerGrant==='read')this.noticeReadOnly('peer_grant_read','This cloud audio connection is listen-only (Freestyle peer grant: read). Play, mixer and plug-in controls use HTTP where Freestyle has a REST route.');
    else if(this.peerGrant==='write'&&this.grantNotice?.projectId===this.projectId)this.grantNotice=null;
  }
  /** 'write' | 'read' | 'expired' | null (no grant reported: legacy server). */
  controlGrant(){
    if(this.controlForbidden&&this.controlForbidden.generation===this.generation)return'read';
    if(this.peerGrant==='write')return this.peerGrantExpiresAt!=null&&this.peerGrantExpiresAt*1000<=this.now()?'expired':'write';
    return this.peerGrant;
  }
  grantState(){return{grant:this.peerGrant,effective:this.controlGrant(),expiresAt:this.peerGrantExpiresAt,receivedAt:this.peerGrantReceivedAt,projectId:this.projectId,generation:this.generation};}
  /** The engine refused a mozart-control write (transport_ack code project_control_forbidden). */
  noteControlForbidden(data){
    if(this.controlForbidden?.generation===this.generation)return;
    this.controlForbidden={generation:this.generation,at:this.now(),type:typeof data?.type==='string'?data.type.slice(0,40):null};
    dispatch(this,'grant',this.grantState());
    this.noticeReadOnly('project_control_forbidden','Freestyle refused live controls on this audio connection (project_control_forbidden). Play, mixer and plug-in controls use HTTP until the connection is renewed.');
  }
  noticeReadOnly(code,message){if(this.grantNotice?.projectId===this.projectId)return false;this.grantNotice={projectId:this.projectId,code,at:this.now()};dispatch(this,'warning',{code,message});return true;}
  /** stopAudioMonitor for the peer we last offered (best effort, never throws). `keepalive`
   * lets the request outlive the page (pagehide). Resolves {closed} (the engine's answer) or null. */
  closeRemotePeer({keepalive=false,reason='stop'}={}){
    const offered=this.offered;if(!offered?.projectId||!offered.clientId)return Promise.resolve(null);this.offered=null;
    let request;try{this.studioClient||=new StudioApiClient();request=this.studioClient.prepare('stopAudioMonitor',{path:{project_id:offered.projectId},query:{client_id:offered.clientId}});}catch{return Promise.resolve(null);}
    const started=this.now();
    const pending=(async()=>{try{
      const response=await this.fetch('/api/studio',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),...keepalive?{keepalive:true}:{}});
      let data=null;try{data=await response?.json?.();}catch{}
      const closed=typeof data?.closed==='boolean'?data.closed:null,detail={reason,projectId:offered.projectId,status:response?.status??null,closed,ms:this.now()-started};
      dispatch(this,'remoteclosed',detail);return detail;
    }catch(error){const detail={reason,projectId:offered.projectId,status:null,closed:null,error:String(error?.message||error).slice(0,160)};dispatch(this,'remoteclosed',detail);return detail;}})();
    this.remoteClose=pending;return pending;
  }
  cancelPeerGrantRenewal(){if(this.grantTimer!=null)this.timerCancel(this.grantTimer);this.grantTimer=null;}
  /** Re-offer with the same client_id before peerGrantExpiresAt (5 % of the lease, 30 s–10 min ahead). */
  schedulePeerGrantRenewal(generation=this.generation){
    this.cancelPeerGrantRenewal();
    if(generation!==this.generation||!this.active||this.peerGrant!=='write'||this.peerGrantExpiresAt==null)return;
    const remaining=this.peerGrantExpiresAt*1000-this.now(),lead=Math.min(600000,Math.max(30000,remaining*.05)),policy=this.recoveryPolicy;
    // Not renewable right now (recording, an edit/history step or a recovery running): try again in 60 s, same peer only.
    const attempt=()=>{this.grantTimer=null;if(this.renewPeerGrant(policy))return;if(policy&&policy===this.recoveryPolicy&&generation===this.generation&&this.active)this.grantTimer=this.timerFactory(attempt,60000);};
    this.grantTimer=this.timerFactory(attempt,Math.max(1000,remaining-lead));
  }
  /** Renewal = a new offer with the same client_id on a fresh peer (the engine replaces the old
   * one), through the bounded recovery path (three attempts, scope-fenced). */
  renewPeerGrant(policy=this.recoveryPolicy){
    if(!policy||policy!==this.recoveryPolicy||policy.generation!==this.generation||policy.peer!==this.peer||!this.active||this.recoveryRequest||!this.recoveryAllowed(policy))return false;
    const request={...policy,origin:this.dawBaseUrl,control:this.control,attempts:0,running:false,cancelled:false,timer:null,renewal:true,audible:this.audibility.audible,audibilityEpoch:this.audibility.epoch};this.recoveryRequest=request;
    dispatch(this,'grantrenewal',{projectId:this.projectId,expiresAt:this.peerGrantExpiresAt});
    this.scheduleRecovery(request,0);return true;
  }
  /** Send the persistent mixer-meter subscription on the given (open) mozart-meters channel. */
  subscribeMeters(channel=this.meters){
    const message=meterSubscribeMessage(this.projectId);
    if(!message||!channel||channel.readyState!=='open')return false;
    try{channel.send(JSON.stringify(message));}catch{return false;}
    const stats=this.meterSubscription||={sent:0,lastAt:null,projectId:null};stats.sent++;stats.lastAt=this.now();stats.projectId=this.projectId;
    dispatch(this,'meterssubscribed',{projectId:this.projectId,generation:this.generation});return true;
  }
  cancelRecovery(){const request=this.recoveryRequest;if(request){request.cancelled=true;if(request.timer!=null)this.timerCancel(request.timer);}this.recoveryRequest=null;}
  recoveryAllowed(policy){try{return policy.canRecover()===true;}catch{return false;}}
  inspectMonitorRecovery(policy=this.recoveryPolicy){
    if(!policy||policy!==this.recoveryPolicy||!policy.established||policy.generation!==this.generation||policy.peer!==this.peer||policy.projectId!==this.projectId||policy.trackId!==this.trackId)return;
    const state=policy.peer.connectionState,closedControl=['closed','closing'].includes(this.control?.readyState);
    if(state==='connected'&&!closedControl&&this.active){if(this.recoveryRequest&&!this.recoveryRequest.running&&!this.recoveryRequest.renewal)this.cancelRecovery();return;}
    if(!['failed','closed','disconnected'].includes(state)&&!closedControl)return;
    if(this.recoveryRequest)return;
    if(!this.recoveryAllowed(policy))return;
    const request={...policy,origin:this.dawBaseUrl,control:this.control,attempts:0,running:false,cancelled:false,timer:null};this.recoveryRequest=request;
    this.scheduleRecovery(request,state==='disconnected'?4000:1000);
  }
  currentRecovery(request){return request===this.recoveryRequest&&!request.cancelled&&request.generation===this.generation&&request.projectId===this.projectId&&request.trackId===this.trackId&&request.peer===this.peer&&request.control===this.control&&request.origin===this.dawBaseUrl&&this.recoveryAllowed(request);}
  scheduleRecovery(request,delay){
    if(!this.currentRecovery(request)){if(request===this.recoveryRequest)this.cancelRecovery();return;}
    if(request.timer!=null)this.timerCancel(request.timer);
    request.timer=this.timerFactory(async()=>{
      request.timer=null;if(!this.currentRecovery(request)){if(request===this.recoveryRequest)this.cancelRecovery();return;}
      request.running=true;request.attempts++;
      try{
        const useProjectDefault=()=>{if(request.cancelled||!this.recoveryAllowed(request))throw Object.assign(new Error('Monitor recovery no longer belongs to an eligible project.'),{name:'AbortError',code:'monitor_recovery_cancelled'});return request.useProjectDefault();};
        const opening=this.start(request.projectId,request.trackId,{useProjectDefault,canRecover:request.canRecover,_recovery:request});
        request.generation=this.generation;
        const connected=await opening;
        if(request!==this.recoveryRequest||request.cancelled||request.generation!==this.generation)return;
        if(!this.recoveryAllowed(request)){this.stop();return;}
        if(!connected||this.peer?.connectionState!=='connected')throw new Error('The replacement receive connection did not become ready.');
        const attempts=request.attempts;this.cancelRecovery();
        // A grant renewal replaced a healthy peer: reopen the sink only if nothing else held or silenced it meanwhile (stop() advanced the epoch exactly once).
        if(request.renewal&&request.audible&&this.audibility.epoch===request.audibilityEpoch+1)this.audibility.open(this.audibility.epoch);
        dispatch(this,'recovered',{attempts,...request.renewal?{reason:'peer_grant_renewal'}:{}});
      }catch(error){
        if(request!==this.recoveryRequest||request.cancelled||request.generation!==this.generation)return;
        request.peer=this.peer;request.control=this.control;request.origin=this.dawBaseUrl;request.running=false;
        if(!this.currentRecovery(request)){this.cancelRecovery();return;}
        if(request.attempts>=3){this.cancelRecovery();dispatch(this,'warning',{code:'monitor_recovery_exhausted',message:'Cloud audio reconnection did not succeed after three attempts. Use Connect live cloud audio or press Play to retry.'});return;}
        this.scheduleRecovery(request,Math.min(8000,1000*2**request.attempts));
      }
    },delay);
  }
  cancelTurnRefresh(){this.turnScheduleVersion=(this.turnScheduleVersion||0)+1;if(this.turnTimer!=null)this.timerCancel(this.turnTimer);this.turnTimer=null;}
  turnScope(generation=this.generation){return{generation,projectId:this.projectId,trackId:this.trackId,dawBaseUrl:this.dawBaseUrl,peer:this.peer};}
  currentTurnScope(scope){return this.active&&Object.entries(scope).every(([key,value])=>this[key]===value);}
  scheduleTurnAttempt(scope,delay,retries=0){
    if(!this.currentTurnScope(scope))return;
    this.cancelTurnRefresh();const version=this.turnScheduleVersion;
    this.turnTimer=this.timerFactory(async()=>{
      if(version!==this.turnScheduleVersion)return;
      this.turnTimer=null;if(!this.currentTurnScope(scope))return;
      try{await this.refreshTurnCredentials(scope.generation,{scope});}catch(error){
        if(version!==this.turnScheduleVersion||!this.currentTurnScope(scope))return;
        dispatch(this,'warning',{code:'turn_refresh_failed',message:error.message});
        // Keep the same working peer while transient credential/configuration
        // failures retry indefinitely at a bounded rate. Stop/scope cancels them.
        this.scheduleTurnAttempt(scope,Math.min(30000,1000*2**Math.min(retries,5)),Math.min(6,retries+1));
      }
    },delay);
  }
  scheduleTurnRefresh(generation=this.generation) {
    this.cancelTurnRefresh();if(generation!==this.generation||!this.active||!this.turnCredentials)return;
    const expiry=turnExpiryMilliseconds(this.turnCredentials,this.turnCredentialsReceivedAt);if(expiry==null)throw new Error('Freestyle did not return a valid TURN credential expiry.');
    const remaining=expiry-this.now(),lead=Math.min(60000,Math.max(10000,remaining*.1));
    this.scheduleTurnAttempt(this.turnScope(generation),Math.max(1000,remaining-lead));
  }
  async refreshTurnCredentials(generation=this.generation,{schedule=true,scope=this.turnScope(generation)}={}) {
    const version=this.turnScheduleVersion,current=()=>version===this.turnScheduleVersion&&this.currentTurnScope(scope);
    if(!current())return false;
    let data;try{data=await this.request('/api/audio/ice'+(scope.dawBaseUrl?`?mozart_origin=${encodeURIComponent(scope.dawBaseUrl)}`:''));}catch(error){if(!current())return false;throw error;}
    if(!current())return false;
    const credentials=credentialsFrom(data),receivedAt=this.now(),expiry=turnExpiryMilliseconds(credentials,receivedAt);
    if(expiry==null||expiry<=this.now())throw new Error('Freestyle returned expired TURN credentials. Reconnect the cloud monitor.');
    if(scope.peer?.setConfiguration){const configuration=scope.peer.getConfiguration?.()||{};if(!current())return false;scope.peer.setConfiguration({...configuration,iceServers:iceServersFor(credentials)});}
    if(!current())return false;
    this.turnCredentials=credentials;this.turnCredentialsReceivedAt=receivedAt;
    if(schedule)this.scheduleTurnRefresh(generation);
    dispatch(this,'turn-refreshed',{expiresAt:credentials.expiresAt});return credentials;
  }
  sendControl(message) {
    if(this.peer?.connectionState!=='connected'||this.control?.readyState!=='open')throw new Error('Connect the Freestyle cloud audio monitor before sending live controls.');
    const allowed=new Set(['set_track_gain','set_track_muted','set_track_soloed','set_plugin_param','set_mix_state','transport_play','transport_pause','transport_seek','transport_seek_and_play','pattern_preview_start','pattern_preview_stop',...LIVE_PLAY_MESSAGES]);
    if(!message||!allowed.has(message.type))throw new Error('This live control type has no verified Freestyle data-channel contract.');
    const grant=this.controlGrant();
    if(grant==='read'||grant==='expired')throw Object.assign(new Error(grant==='expired'?'The Freestyle peer grant expired; live controls use HTTP until it is renewed.':'This cloud audio connection is listen-only (peer grant: read); live controls use HTTP.'),{code:'project_control_forbidden'});
    // Realtime docs (#9): note and pad messages carry project_id but no key or seq (they are never merged).
    if(LIVE_PLAY_MESSAGES.has(message.type)){const payload={...message,project_id:this.projectId};this.control.send(JSON.stringify(payload));return {sent:true,seq:null,payload};}
    const transport=message.type.startsWith('transport_');
    const payload={...message,project_id:this.projectId,seq:++this.sequence,control_route:'daw',sent_at_ms:performance.now(),...transport?{key:'transport',client_sent_ms:Date.now()}: {}};
    this.control.send(JSON.stringify(payload));return {sent:true,seq:payload.seq,payload};
  }
  sendMidi({trackId,laneId='',note,velocity=.82,on=true,channel=1,ack=false}) {
    if(this.peer?.connectionState!=='connected'||this.control?.readyState!=='open')throw new Error('Connect the Freestyle cloud audio monitor before playing an instrument.');
    const track=Number(trackId),pitch=Number(note),gain=Number(velocity);
    if((!Number.isFinite(track)||track<=0)&&!laneId)throw new Error('The selected instrument has no cloud track or lane identity.');
    if(!Number.isInteger(pitch)||pitch<0||pitch>127||!Number.isFinite(gain))throw new Error('Provide a valid MIDI note and velocity.');
    // Documented fields only (#9): lane_id, note, velocity 0–1, channel 1–16, on, event_id (+ ack). track_id only
    // when no lane is known (legacy numeric engine track).
    const payload={type:'midi_note',project_id:this.projectId,...!laneId&&Number.isFinite(track)&&track>0?{track_id:track}:{},lane_id:String(laneId),note:pitch,velocity:Math.max(0,Math.min(1,gain)),channel:Math.max(1,Math.min(16,Math.round(channel))),on:on!==false,event_id:globalThis.crypto?.randomUUID?.()||`note-${Date.now()}`,
      // Studio Pro sets ack:true on a note-on whose render position it needs; the engine then
      // returns it in engine_clock.midi_acks [{event_id, position_samples}]. Unrequested notes are never acked.
      ...ack===true&&on!==false?{ack:true}:{}};
    this.sendControl(payload);return payload;
  }
  allNotesOff({trackId,laneId=''}={}) {
    if(this.peer?.connectionState!=='connected'||this.control?.readyState!=='open')throw new Error('The cloud instrument connection is unavailable.');
    const track=Number(trackId);
    const payload={type:'midi_all_notes_off',project_id:this.projectId,...!laneId&&Number.isFinite(track)&&track>0?{track_id:track}:{},lane_id:String(laneId)};
    this.sendControl(payload);return payload;
  }
  async resume() {
    if(!this.audio?.srcObject)return;
    try{await this.audio.play();if(this.peer?.connectionState==='connected')this.setState('connected');}
    catch(error){this.setState('blocked',{message:'Click Enable cloud audio to allow browser playback.'});dispatch(this,'blocked',error);throw error;}
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
    // Hidden tab or inactive Freestyle studio view (suspended): 1 s health cadence only.
    const delay=()=>globalThis.document?.hidden||this.suspended?1000:100;
    const poll=async()=>{if(generation!==this.generation||!this.active)return;try{await this.collectStats();}catch{}finally{if(generation===this.generation&&this.active){this.inspectMonitorRecovery();this.statsTimer=setTimeout(poll,delay());}}};
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
    // The actual selected pair (transport.selectedCandidatePairId), types only: host/srflx/prflx/relay.
    const pair=selectedCandidatePair(reports);if(pair){stats.candidatePair={localType:pair.localType,remoteType:pair.remoteType,protocol:pair.protocol,relay:pair.relay,source:pair.source};if(pair.rttMs!=null)stats.roundTripTime=pair.rttMs/1000;
      const key=`${pair.localType}>${pair.remoteType}/${pair.protocol}`;if(key!==this.candidatePairKey){this.candidatePairKey=key;dispatch(this,'icepair',{...stats.candidatePair,generation});}}
    this.stats=stats;dispatch(this,'stats',stats);return stats;
  }
  /** retainRemote: an internal re-open of the same project (start/recovery/renewal) whose new
   * offer replaces the engine peer under the same client_id. Any other stop closes the engine
   * peer (stopAudioMonitor) and rotates the client_id, so a late DELETE never hits a new peer. */
  stop({preserveRecovery=null,retainRemote=false,_retry=null}={}) {
    if(this.recoveryRequest!==preserveRecovery)this.cancelRecovery();this.recoveryPolicy=null;
    if(!_retry||this.updateRetry!==_retry)this.cancelUpdateRetry();
    if(!retainRemote&&this.offered){this.closeRemotePeer({keepalive:true,reason:'stop'});this.clientId=null;this.clientIdProject=null;}
    this.audibility.reset({audible:false});
    this.generation++;this.active=false;
    this.abortController?.abort();this.cancelTurnRefresh();this.cancelPeerGrantRenewal();clearTimeout(this.statsTimer);this.turnCredentials=null;this.session=null;this.dawBaseUrl='';
    this.peerGrant=null;this.peerGrantExpiresAt=null;this.peerGrantReceivedAt=null;this.controlForbidden=null;
    if(this.peer){this.peer.ontrack=null;this.peer.onconnectionstatechange=null;this.peer.close();this.peer=null;}
    if(this.audio){this.audio.pause();for(const track of this.audio.srcObject?.getTracks?.()||[])track.stop();this.audio.srcObject=null;}
    this.stats={audioLevel:0,bytesReceived:0,packetsLost:0,jitter:0,roundTripTime:0,receiverLagSec:null,playoutLagSec:null};this.delayMeasurements=new Map();
    this.setState('idle');
  }
}
