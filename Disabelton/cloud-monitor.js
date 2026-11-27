/** Receive Freestyle's server-rendered audio. No local synthesizer or audio rendering. */
import {CloudAudibility} from './cloud-audibility.js';
import {nativeStereoOpusOffer,nativeFilterIceSdp,nativeAllowTailnetCandidates} from './cloud-monitor-sdp.js';
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
/** Release 2026-11-12: sendMonitorOffer answers peerGrant ('write'|'read') and peerGrantExpiresAt
 * (unix seconds, ~8 h). Unknown/absent values stay null (an older server: no grant was stated). */
export function monitorPeerGrant(result){
 const grant=result?.peerGrant==='write'||result?.peerGrant==='read'?result.peerGrant:null;
 const raw=result?.peerGrantExpiresAt,expiresAt=typeof raw==='number'&&Number.isFinite(raw)&&raw>0?raw:null;
 return{grant,expiresAt};
}
/** When to renew a write grant: re-offer with the same client_id before peerGrantExpiresAt. */
export function peerGrantRenewDelay(expiresAtSec,now){
 if(typeof expiresAtSec!=='number'||!Number.isFinite(expiresAtSec))return null;
 const remaining=expiresAtSec*1000-now,lead=Math.min(600000,Math.max(30000,remaining*.05));
 return Math.max(1000,remaining-lead);
}
export const PEER_GRANT_PLAYING_DEFER_MS=30000;
/** Release 2026-11-14: sendMonitorOffer answers 503 engine_update_required before anything reaches
 * the engine (the existing peer keeps running): retry the same offer with bounded backoff, honouring
 * Retry-After (seconds, capped). Attempts beyond OFFER_UPDATE_RETRIES give up with the error. */
export const OFFER_UPDATE_RETRIES=4;
/** Trickle ICE bounds: at most this many candidate long-polls (2 s each) and failed polls per peer. */
export const TRICKLE_MAX_POLLS=10,TRICKLE_MAX_FAILURES=3;
export function engineUpdateRetryDelay(retryAfterSec,attempt){
 const hinted=typeof retryAfterSec==='number'&&Number.isFinite(retryAfterSec)&&retryAfterSec>=0?retryAfterSec*1000:null;
 return Math.min(15000,Math.max(500,hinted??1000*2**Math.max(0,attempt)));
}
export const freshMonitorClientId=()=>`vegetable-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
/** stopAudioMonitor through the typed same-origin proxy: DELETE /projects/{id}/monitor?client_id=. */
export function stopMonitorRequest(projectId,clientId,trackId=null){
 if(typeof projectId!=='string'||!projectId||typeof clientId!=='string'||!clientId||clientId.length>128)return null;
 return{operationId:'stopAudioMonitor',path:{project_id:projectId},query:{client_id:clientId,...typeof trackId==='string'&&trackId&&trackId.length<=64?{track_id:trackId}:{}},idempotencyKey:`stop-${clientId}`.slice(0,128)};
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
  constructor({fetch:fetchImpl=(...args)=>hostFetch(...args),peerFactory=config=>new RTCPeerConnection(config),audio=null,now=()=>Date.now(),timerFactory=(callback,delay)=>setTimeout(callback,delay),timerCancel=timer=>clearTimeout(timer)}={}) {
    super();
    this.fetch=fetchImpl;
    this.peerFactory=peerFactory;
    // Freestyle release 2026-11-12: OAuth peers with a daw:write grant
    // may send editor.pointer/scroll/type on mozart-editor. Channel input is the default again;
    // a refusal still falls back to REST (editor-frame-stream.js).
    this.editorInputOverRest=false;
    this.audio=audio;this._volume=1;this.now=now;this.timerFactory=timerFactory;this.timerCancel=timerCancel;this.turnCredentials=null;this.session=null;this.dawBaseUrl='';
    this.audibility=new CloudAudibility({audible:false,getVolume:()=>this.volume,setTimer:timerFactory,clearTimer:timerCancel,apply:state=>{if(this.audio){this.audio.muted=state.muted||hostPlaysAudio();this.audio.volume=state.volume;}}});
    this.peer=null;
    // Fast-input grant of the current peer (release 2026-11-12). null = not stated by the server.
    this.peerGrant=null;this.peerGrantExpiresAt=null;this.controlForbidden=null;this.grantTimer=null;this.lastClock=null;
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
      const error=new Error(typeof message==='string'?message:JSON.stringify(message));error.status=response.status;const retry=[data.retryAfterSec,data.error?.retryAfterSec,data.metadata?.retryAfterSec].find(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0);if(retry!==undefined)error.retryAfterSec=retry;Object.assign(error,monitorErrorFields({code:typeof data.error==='string'?data.error:undefined}),monitorErrorFields(data));throw error;
    }
    return unpackMonitorResult(data);
  }
  async start(projectId,trackId,{useProjectDefault=()=>false,canRecover=()=>false,_recovery=null,_renewClientId=null}={}) {
    if(!projectId)throw new Error('Open a cloud project before connecting its monitor.');
    if(typeof useProjectDefault!=='function')throw new TypeError('Default audio context requires a scoped verification function.');
    if(typeof canRecover!=='function')throw new TypeError('Monitor recovery requires a scoped eligibility function.');
    if(_recovery&&(_recovery!==this.recoveryRequest||_recovery.cancelled))return false;
    // A project switch closes the previous project's peer on the engine (stopAudioMonitor); a
    // renewal / recovery of the same project re-offers instead (the engine replaces that peer).
    this.stop({preserveRecovery:_recovery,release:!!this.projectId&&this.projectId!==projectId});const generation=this.generation,playbackProfile=nativeMonitorPlaybackProfile();
    this.abortController=new AbortController();this.active=true;
    this.projectId=projectId;this.trackId=trackId||'';
    // A grant renewal re-offers with the same client_id (the engine replaces that peer).
    this.clientId=typeof _renewClientId==='string'&&_renewClientId?_renewClientId:freshMonitorClientId();
    this.installPageLifecycle();
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
      this.control.onmessage=event=>{countChannelMessage(this,'mozart-control',event.data);if(typeof event.data!=='string')return;try{const data=JSON.parse(event.data);if(data.project_id&&data.project_id!==this.projectId)return;dispatch(this,'control',data);if(data.code==='project_control_forbidden'&&generation===this.generation&&this.control===control)this.noteControlForbidden(data);if(data.type==='engine_clock'){this.lastClock={at:this.now(),playing:data.is_playing??data.isPlaying??data.status?.is_playing??null};dispatch(this,'clock',data);}if(data.type==='mixer_meters'&&generation===this.generation&&this.control===control)dispatch(this,'meters',data);if(data.type==='transport_ack'||data.type==='pattern_preview_ack')dispatch(this,'ack',data);}catch{}};
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
      editor.onmessage=event=>{if(this.editor!==editor||!editorChannelCurrent(editor)||typeof event.data!=='string')return;try{const data=JSON.parse(event.data);if(['project_control_forbidden','project_write_forbidden'].includes(data?.code??data?.error?.code)&&generation===this.generation)this.noteControlForbidden({...data,type:data.type||'editor.state'});dispatch(this,'editorstate',data);}catch{}};
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
      const offerSdp=nativeFilterIceSdp(pc.localDescription?.sdp||localOffer.sdp||offer.sdp,{allowTailnet:nativeAllowTailnetCandidates()}).sdp;
      let result,rotatedClientId=false;
      for(let attempt=0;;attempt++){
        try{
          result=await this.request('/api/audio/offer',{method:'POST',body:JSON.stringify({
            ...requestContext(),client_id:this.clientId,mode:'daw',low_latency:playbackProfile.lowLatency,
            quality_profile:playbackProfile.qualityProfile,sdp:offerSdp,turn_credentials:this.turnCredentials,
            // Freestyle #7: trickle ICE. The engine answers without waiting for its relay candidate;
            // the later candidates come from getMonitorCandidates (trickleCandidates below).
            trickle:true,
          })});
          break;
        }catch(error){
          if(generation!==this.generation)return false;
          // 409 webrtc_client_id_in_use: nothing was replaced; offer once more with a new client id.
          if(error?.code==='webrtc_client_id_in_use'&&!rotatedClientId){rotatedClientId=true;const previous=this.clientId;this.clientId=freshMonitorClientId();dispatch(this,'clientidrotated',{projectId,previous,clientId:this.clientId});continue;}
          // 503 engine_update_required: refused before the engine; retry the same offer (bounded).
          if(error?.code==='engine_update_required'&&attempt<OFFER_UPDATE_RETRIES){const delay=engineUpdateRetryDelay(error.retryAfterSec,attempt);dispatch(this,'offerretry',{projectId,code:error.code,attempt:attempt+1,delayMs:delay});await new Promise(resolve=>this.timerFactory(resolve,delay));if(generation!==this.generation)return false;continue;}
          throw error;
        }
      }
      if(generation!==this.generation)return false;
      if(_recovery&&!this.recoveryAllowed(_recovery))throw Object.assign(new Error('The recovering monitor context is no longer eligible.'),{name:'AbortError',code:'monitor_recovery_cancelled'});
      const answer=result.answer||(result.sdp?result:null);
      if(!answer?.sdp)throw new Error('Freestyle did not return a WebRTC audio answer.');
      await pc.setRemoteDescription({type:answer.type||'answer',sdp:nativeFilterIceSdp(answer.sdp,{allowTailnet:nativeAllowTailnetCandidates()}).sdp});
      this.adoptPeerGrant(result,generation);
      this.trickleStats={offered:true,answered:result.trickle===true,polls:0,added:0,complete:false,failures:0};
      if(result.trickle===true)this.trickleCandidates(pc,generation,requestContext).catch(()=>{});
      this.startStats(generation);
      await this.waitForConnection(pc,20000);
      if(generation===this.generation)this.scheduleTurnRefresh(generation);
      return generation===this.generation;
    } catch(error) {
      if(generation!==this.generation)return false;
      this.active=false;this.cancelTurnRefresh();if(this.peer){this.peer.ontrack=null;this.peer.onconnectionstatechange=null;this.peer.close();}this.turnCredentials=null;clearTimeout(this.statsTimer);if(this.audio){this.audio.pause();for(const track of this.audio.srcObject?.getTracks?.()||[])track.stop();this.audio.srcObject=null;}
      this.setState('error',{message:error.message,...monitorErrorFields(error),status:error.status});dispatch(this,'error',error);throw error;
    }
  }
  /** Freestyle #7 (trickle ICE): after an answer with trickle:true, long-poll getMonitorCandidates and add each
   * later engine candidate (the TURN relay one restrictive networks need) until gathering is complete or the peer
   * is connected. Reading candidates never changes the peer; a failed poll is retried a bounded number of times. */
  async trickleCandidates(pc,generation,requestContext=()=>({project_id:this.projectId})){
    const stats=this.trickleStats||={offered:true,answered:true,polls:0,added:0,complete:false,failures:0},current=()=>generation===this.generation&&this.peer===pc&&!['connected','closed','failed'].includes(pc.connectionState);
    let after=0;
    while(current()&&stats.polls<TRICKLE_MAX_POLLS){
      stats.polls++;let data;
      try{
        const context=requestContext();
        data=await this.request('/api/studio',{method:'POST',body:JSON.stringify({operationId:'getMonitorCandidates',path:{project_id:this.projectId},query:{client_id:this.clientId,after,wait_ms:2000,...typeof context?.track_id==='string'&&context.track_id?{track_id:context.track_id}:{}}})});
      }catch(error){
        if(!current())return stats;
        // 404 monitor_peer_not_found: the peer was replaced or closed; nothing more to fetch.
        if(error?.status===404||++stats.failures>=TRICKLE_MAX_FAILURES){stats.error=String(error?.code||error?.status||error?.message||'failed').slice(0,80);dispatch(this,'warning',{code:'monitor_trickle_failed',message:'Freestyle did not return the audio peer’s later ICE candidates; the connection continues with the ones it has.'});return stats;}
        await new Promise(resolve=>this.timerFactory(resolve,250*stats.failures));continue;
      }
      if(generation!==this.generation||this.peer!==pc)return stats;
      for(const candidate of Array.isArray(data?.candidates)?data.candidates:[]){
        if(typeof candidate?.candidate!=='string'||!candidate.candidate)continue;
        try{await pc.addIceCandidate({candidate:candidate.candidate,sdpMid:typeof candidate.sdpMid==='string'?candidate.sdpMid:'0'});stats.added++;}catch{stats.rejected=(stats.rejected||0)+1;}
      }
      if(Number.isInteger(data?.next)&&data.next>=after)after=data.next;
      if(data?.complete===true){stats.complete=true;break;}
    }
    dispatch(this,'trickle',{...stats,projectId:this.projectId});
    return stats;
  }
  /** Record the offer reply's fast-input grant. A read grant (or none renewable) is logged, and
   * every channel write is routed to REST by channelWritesAllowed() — never sent to be refused. */
  adoptPeerGrant(result,generation=this.generation){
    const {grant,expiresAt}=monitorPeerGrant(result);
    this.peerGrant=grant;this.peerGrantExpiresAt=expiresAt;this.controlForbidden=null;
    dispatch(this,'grant',{grant,expiresAt,projectId:this.projectId,generation});
    if(grant==='read'){dispatch(this,'warning',{code:'peer_grant_read',message:'Freestyle granted this audio peer read-only access: transport, mixer and plug-in editor input use REST.'});dispatch(this,'readonly',{readOnly:true,reason:'peer_grant_read',projectId:this.projectId});}
    this.scheduleGrantRenewal(generation);
  }
  /** True when this peer cannot take fast input (read grant, or a project_control_forbidden refusal):
   * the UI shows a read-only live-control state; writes go to REST. */
  get readOnly(){return !!this.controlForbidden||this.peerGrant==='read';}
  /** False when the engine would refuse a write on mozart-control / mozart-editor for this peer. */
  channelWritesAllowed(){
    if(this.controlForbidden||this.peerGrant==='read')return false;
    return !(this.peerGrantExpiresAt!=null&&this.now()>=this.peerGrantExpiresAt*1000);
  }
  /** A transport_ack {ok:false, code:'project_control_forbidden'}: the grant was refused or
   * revoked (OAuth revoked, role removed). Later writes go to REST at once; logged once per peer. */
  noteControlForbidden(data){
    if(this.controlForbidden)return;
    this.controlForbidden={code:'project_control_forbidden',at:this.now(),type:typeof data?.type==='string'?data.type.slice(0,40):null};
    dispatch(this,'warning',{code:'project_control_forbidden',message:'Freestyle refused live control on this audio peer: transport, mixer and plug-in editor input now use REST.'});
    dispatch(this,'readonly',{readOnly:true,reason:'project_control_forbidden',source:this.controlForbidden.type,projectId:this.projectId});
  }
  /** Best-effort stopAudioMonitor for one peer (project switch, pagehide, explicit stop). closed:false
   * (no such peer) is not an error; 502 webrtc_close_failed is logged (the peer may still be up). */
  releasePeer({projectId=this.projectId,clientId=this.clientId,trackId=this.trackId,keepalive=false}={}){
    const request=stopMonitorRequest(projectId,clientId,trackId);if(!request)return Promise.resolve(null);
    let sent;try{sent=Promise.resolve(this.fetch('/api/studio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),...keepalive?{keepalive:true}:{}}));}catch(error){sent=Promise.reject(error);}
    return sent.then(async response=>{const data=await response?.json?.().catch(()=>({}))??{};
      if(response?.ok){dispatch(this,'peerreleased',{projectId,clientId,closed:data?.closed===true});return{closed:data?.closed===true};}
      const code=(typeof data?.error==='object'?data.error?.code:data?.code)??null;dispatch(this,'warning',{code:code==='webrtc_close_failed'?'webrtc_close_failed':'monitor_release_failed',status:response?.status??null,message:'Freestyle could not confirm that the previous audio peer closed.'});return null;
    },error=>{dispatch(this,'warning',{code:'monitor_release_failed',message:String(error?.message||error).slice(0,200)});return null;});
  }
  /** pagehide: close this page's peer on the engine (keepalive fetch). Installed once per monitor. */
  installPageLifecycle(target=globalThis){
    if(this.pageLifecycleInstalled||typeof target?.addEventListener!=='function')return;this.pageLifecycleInstalled=true;
    target.addEventListener('pagehide',()=>{if(this.peer&&this.projectId&&this.clientId)this.releasePeer({keepalive:true});});
  }
  cancelGrantRenewal(){if(this.grantTimer!=null)this.timerCancel(this.grantTimer);this.grantTimer=null;}
  /** Renew a write grant before peerGrantExpiresAt by re-offering with the same client_id.
   * The engine replaces the peer, so this is a clean reconnect; while the transport rolls it
   * waits (bounded by the expiry) so playback is not interrupted. */
  scheduleGrantRenewal(generation=this.generation,delay=null){
    this.cancelGrantRenewal();
    if(generation!==this.generation||!this.active||this.peerGrant!=='write')return;
    const wait=delay??peerGrantRenewDelay(this.peerGrantExpiresAt,this.now());if(wait==null)return;
    const scope={generation,projectId:this.projectId,trackId:this.trackId,clientId:this.clientId,policy:this.recoveryPolicy};
    this.grantTimer=this.timerFactory(()=>{this.grantTimer=null;return this.renewGrant(scope).catch(()=>false);},wait);
  }
  async renewGrant(scope){
    if(scope.generation!==this.generation||!this.active||scope.projectId!==this.projectId||scope.clientId!==this.clientId||!scope.policy||scope.policy!==this.recoveryPolicy)return false;
    const now=this.now(),deadline=this.peerGrantExpiresAt!=null?this.peerGrantExpiresAt*1000-15000:now;
    const rolling=this.lastClock?.playing===true&&now-this.lastClock.at<3000;
    if(rolling&&now+PEER_GRANT_PLAYING_DEFER_MS<deadline){this.scheduleGrantRenewal(scope.generation,PEER_GRANT_PLAYING_DEFER_MS);return false;}
    dispatch(this,'grantrenewing',{projectId:scope.projectId,expiresAt:this.peerGrantExpiresAt,deferredWhilePlaying:false});
    try{
      const ok=await this.start(scope.projectId,scope.trackId,{useProjectDefault:scope.policy.useProjectDefault,canRecover:scope.policy.canRecover,_renewClientId:scope.clientId});
      if(ok)dispatch(this,'grantrenewed',{projectId:scope.projectId,grant:this.peerGrant,expiresAt:this.peerGrantExpiresAt});
      return ok;
    }catch(error){dispatch(this,'warning',{code:'peer_grant_renew_failed',message:'Renewing the live-control grant failed: '+String(error?.message||error).slice(0,200)});return false;}
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
    if(state==='connected'&&!closedControl&&this.active){if(this.recoveryRequest&&!this.recoveryRequest.running)this.cancelRecovery();return;}
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
        const attempts=request.attempts;this.cancelRecovery();dispatch(this,'recovered',{attempts});
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
    if(!this.channelWritesAllowed())throw Object.assign(new Error('This audio peer has no live-control grant; use the REST route.'),{code:'project_control_forbidden',dispatched:false,peerGrant:this.peerGrant});
    const allowed=new Set(['set_track_gain','set_track_muted','set_track_soloed','set_plugin_param','set_mix_state','transport_play','transport_pause','transport_seek','transport_seek_and_play','pattern_preview_start','pattern_preview_stop','pattern_preview_launch','sample_preview','sample_preview_release','live_hold','midi_note','midi_all_notes_off']);
    if(!message||!allowed.has(message.type))throw new Error('This live control type has no verified Freestyle data-channel contract.');
    const transport=message.type.startsWith('transport_');
    const payload={...message,project_id:this.projectId,seq:++this.sequence,control_route:'daw',sent_at_ms:performance.now(),...transport?{key:'transport',client_sent_ms:Date.now()}: {}};
    this.control.send(JSON.stringify(payload));return {sent:true,seq:payload.seq,payload};
  }
  sendMidi({trackId,laneId='',note,velocity=.82,on=true,channel=1,ack=false}) {
    if(this.peer?.connectionState!=='connected'||this.control?.readyState!=='open')throw new Error('Connect the Freestyle cloud audio monitor before playing an instrument.');
    const track=Number(trackId),pitch=Number(note),gain=Number(velocity);
    if((!Number.isFinite(track)||track<=0)&&!laneId)throw new Error('The selected instrument has no cloud track or lane identity.');
    if(!Number.isInteger(pitch)||pitch<0||pitch>127||!Number.isFinite(gain))throw new Error('Provide a valid MIDI note and velocity.');
    const payload={type:'midi_note',project_id:this.projectId,...Number.isFinite(track)&&track>0?{track_id:track}:{},lane_id:String(laneId),note:pitch,velocity:Math.max(0,Math.min(1,gain)),channel:Math.max(1,Math.min(16,Math.round(channel))),on:on!==false,perf_sent_ms:Date.now(),event_id:globalThis.crypto?.randomUUID?.()||`note-${Date.now()}`,event_source:`vegetable:${this.clientId}`,
      // Studio Pro sets ack:true on a note-on whose render position it needs; the engine then
      // returns it in engine_clock.midi_acks [{event_id, position_samples}]. Unrequested notes are never acked.
      ...ack===true&&on!==false?{ack:true}:{}};
    this.sendControl(payload);return payload;
  }
  allNotesOff({trackId,laneId=''}={}) {
    if(this.peer?.connectionState!=='connected'||this.control?.readyState!=='open')throw new Error('The cloud instrument connection is unavailable.');
    const track=Number(trackId);
    const payload={type:'midi_all_notes_off',project_id:this.projectId,...Number.isFinite(track)&&track>0?{track_id:track}:{},lane_id:String(laneId)};
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
    this.stats=stats;dispatch(this,'stats',stats);return stats;
  }
  stop({preserveRecovery=null,release=true}={}) {
    if(release&&this.peer&&this.projectId&&this.clientId)this.releasePeer({projectId:this.projectId,clientId:this.clientId,trackId:this.trackId});
    if(this.recoveryRequest!==preserveRecovery)this.cancelRecovery();this.recoveryPolicy=null;
    this.audibility.reset({audible:false});
    this.generation++;this.active=false;
    this.abortController?.abort();this.cancelTurnRefresh();this.cancelGrantRenewal();this.peerGrant=null;this.peerGrantExpiresAt=null;this.controlForbidden=null;this.lastClock=null;clearTimeout(this.statsTimer);this.turnCredentials=null;this.session=null;this.dawBaseUrl='';
    if(this.peer){this.peer.ontrack=null;this.peer.onconnectionstatechange=null;this.peer.close();this.peer=null;}
    if(this.audio){this.audio.pause();for(const track of this.audio.srcObject?.getTracks?.()||[])track.stop();this.audio.srcObject=null;}
    this.stats={audioLevel:0,bytesReceived:0,packetsLost:0,jitter:0,roundTripTime:0,receiverLagSec:null,playoutLagSec:null};this.delayMeasurements=new Map();
    this.setState('idle');
  }
}
