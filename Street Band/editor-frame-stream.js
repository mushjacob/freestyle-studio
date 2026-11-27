/** Live plug-in editor frames over the monitor peer (339, freestyle.audio/docs/realtime.html
 * "Live plug-in editor frames"): the `mozart-editor-frames` data channel
 * ({negotiated:true, id:102, ordered:false}, created by CloudMonitor before the
 * offer) carries {"type":"editor.subscribe","lane_id","plugin_index",max_width,fps,relay}
 * out and `editor.state` text replies plus chunked binary JPEG/PNG frames in. No
 * HTTP round trip per frame: the low-latency path for the REST GUI mirror.
 * Input (Studio Pro parity, Freestyle release 2026-11-14): over the ordered `mozart-editor`
 * channel by default — at once with a write peer grant, as a verified probe when no grant was
 * reported. REST only when the channel is closed, the grant is read/expired, or the engine
 * refused channel input (project_control_forbidden / project_write_forbidden).
 *
 * One subscription per peer; a new editor.subscribe replaces it. Frames of
 * another engine track / plug-in slot, or older than the newest shown one, are
 * dropped. */
import {EditorFrameAssembler,editorSubscriptionProfile} from './remote-plugin.js';

export const EDITOR_STREAM_FPS=30;
/** editor.state error codes about the frame subscription itself (not about input). */
export const EDITOR_SUBSCRIPTION_CODES=new Set(['lane_not_loaded','invalid_target','project_access_denied','editor_not_open','capture_timeout']);
/** Round 38: `project_write_forbidden` ("Editor input needs edit access to the project") is an
 * auth-scope answer about the PROJECT, not the peer: remember it per project (in memory and,
 * best effort, 24 h in localStorage) so later peers/sessions never re-probe the channel. */
export const PROJECT_SCOPED_REFUSALS=new Set(['project_write_forbidden']);
/** Release 2026-11-14: a read-grant peer is refused with project_control_forbidden: about THIS peer
 * (the monitor marks it read-only for its generation), so it is never remembered per project. */
export const PEER_SCOPED_REFUSALS=new Set(['project_control_forbidden']);
const REFUSAL_TTL_MS=24*60*60*1000,refusedProjects=new Map(),refusalKey=projectId=>'illogic:editorInputRefused:'+projectId;
export function projectInputRefusal(projectId){
 if(typeof projectId!=='string'||!projectId)return null;const memory=refusedProjects.get(projectId);if(memory&&Date.now()-memory.at<REFUSAL_TTL_MS)return memory;
 try{const stored=JSON.parse(globalThis.localStorage?.getItem(refusalKey(projectId))||'null');if(stored&&Date.now()-stored.at<REFUSAL_TTL_MS){refusedProjects.set(projectId,stored);return stored;}}catch{}
 return null;
}
export function rememberProjectInputRefusal(projectId,reason){if(typeof projectId!=='string'||!projectId)return;const value={code:reason.code,message:reason.message??'',at:Date.now()};refusedProjects.set(projectId,value);try{globalThis.localStorage?.setItem(refusalKey(projectId),JSON.stringify(value));}catch{}}
export function forgetProjectInputRefusals(){refusedProjects.clear();}
export function forgetProjectInputRefusal(projectId){if(typeof projectId!=='string'||!projectId)return;refusedProjects.delete(projectId);try{globalThis.localStorage?.removeItem(refusalKey(projectId));}catch{}}
/** Freestyle release 2026-11-14 (realtime docs "Fast input on the monitoring peer"): the OAuth
 * monitor/offer answer carries `peerGrant`. "write" → input goes over `mozart-editor` from the
 * very first pointer-down (no probe, no REST). Not reported (null, or a peer object without the
 * field) → the channel is PROBED by default (first gesture checked by effect, REST replay if it
 * was ignored). "read" / expired → REST (the engine refuses channel input with
 * project_control_forbidden). localStorage['illogic.editorInputChannel']='rest' is a manual
 * escape hatch that keeps an unreported grant on REST; 'probe' (or nothing) is the default. */
export const EDITOR_INPUT_CHANNEL_KEY='illogic.editorInputChannel';
export function editorInputChannelSetting(){try{return globalThis.localStorage?.getItem(EDITOR_INPUT_CHANNEL_KEY)==='rest'?'rest':'probe';}catch{return'probe';}}
export class EditorFrameStream{
 constructor({monitor,log=()=>{},now=()=>globalThis.performance?.now?.()??Date.now(),profile=editorSubscriptionProfile}={}){
  this.monitor=monitor;this.log=log;this.now=now;this.profile=profile;this.assembler=new EditorFrameAssembler();this.target=null;this.listener=null;this.trackId=null;this.latest=null;this.state='idle';this.stats={frames:0,bytes:0,dropped:0};
 }
 /** True when the monitor peer is connected and its frame channel is open. */
 available(){const m=this.monitor;return !!m&&m.peer?.connectionState==='connected'&&m.editorFrames?.readyState==='open'&&typeof m.editorFrames.send==='function';}
 /** Subscribe to one lane slot. Resolves true once the subscribe was sent. */
 async subscribe({laneId,pluginIndex,maxWidth=1280,fps=EDITOR_STREAM_FPS},{onFrame,onState}={}){
  if(!this.available()||typeof laneId!=='string'||!laneId||!Number.isInteger(pluginIndex))return false;
  let profile={max_width:maxWidth,fps,relay:false},pair=null;try{const measured=await this.profile(this.monitor.peer,maxWidth,{directFps:fps});if(measured){pair=measured.pair??null;profile={max_width:measured.relay?Math.min(640,maxWidth):maxWidth,fps:measured.relay?Math.min(5,fps):fps,relay:measured.relay===true};}}catch{}
  // The selected ICE pair decides relay (types only): logged so a relayed subscribe can be explained.
  this.log('plugin-gui-stream',{event:'ice_pair',...pair?{source:pair.source,localType:pair.localType,remoteType:pair.remoteType,protocol:pair.protocol,relayProtocol:pair.relayProtocol,rttMs:pair.rttMs}:{source:'none'},relay:profile.relay});
  if(!this.available())return false;
  // The Freestyle Studio subscribes on the ORDERED mozart-editor channel — the
  // same channel its input goes over — and receives only the binary frames on mozart-editor-frames.
  // With a write grant we do the same, so the engine's input target is this channel's subscription.
  const editorOpen=this.monitor.editor?.readyState==='open'&&typeof this.monitor.editor.send==='function';
  const channel=editorOpen&&this.inputPolicy()==='channel'?this.monitor.editor:this.monitor.editorFrames;
  this.detach();this.target={laneId,pluginIndex,channel,via:channel===this.monitor.editor?'mozart-editor':'mozart-editor-frames'};this.handlers={onFrame,onState};this.trackId=null;this.latest=null;this.assembler.clear();this.state='subscribing';
  this.listener=event=>this.message(event.detail);this.monitor.addEventListener('editorframe',this.listener);
  // Every inbound mozart-editor message is logged (type/state/code/message only) and its editor.state handled.
  this.stateListener=event=>{const state=event.detail;this.logInbound('mozart-editor',state);if(state?.type==='editor.state')this.message(state);};this.monitor.addEventListener('editorstate',this.stateListener);
  const message={type:'editor.subscribe',lane_id:laneId,plugin_index:pluginIndex,max_width:Math.max(64,Math.min(4096,Math.round(profile.max_width))),fps:Math.max(1,Math.min(30,Math.round(profile.fps))),...profile.relay?{relay:true}:{}};
  try{this.target.channel.send(JSON.stringify(message));}catch(error){this.detach();this.log('plugin-gui-stream',{event:'subscribe_failed',message:String(error?.message||'').slice(0,160)});return false;}
  this.subscription={maxWidth:message.max_width,fps:message.fps,relay:!!message.relay,via:this.target.via,localType:pair?.localType??null,remoteType:pair?.remoteType??null};
  this.subscribedAt=this.now();this.log('plugin-gui-stream',{event:'subscribe',laneId,pluginIndex,maxWidth:message.max_width,fps:message.fps,relay:!!message.relay,via:this.target.via});this.logOutbound(this.target.via,message);return true;
 }
 /** Diagnostics: an inbound editor-channel message (no frame bytes, no secrets). */
 logInbound(channel,data){try{const value=typeof data==='string'?JSON.parse(data):data;if(!value||typeof value!=='object')return;this.log('plugin-gui-editor-inbound',{channel,type:String(value.type??'').slice(0,40),state:value.state??null,code:value.code??null,message:typeof value.message==='string'?value.message.slice(0,200):null,trackId:Number.isInteger(value.track_id)?value.track_id:null,laneId:typeof value.lane_id==='string'?value.lane_id.slice(0,64):null,pluginIndex:Number.isInteger(value.plugin_index)?value.plugin_index:null,keys:Object.keys(value).slice(0,16)});}catch{}}
 /** Diagnostics: the exact outbound editor message (pointer moves sampled ≤4/s). */
 logOutbound(channel,message){const move=message?.phase==='move',at=this.now();this.outboundCount=(this.outboundCount||0)+1;if(move&&this.lastMoveLogAt!=null&&at-this.lastMoveLogAt<250)return;if(move)this.lastMoveLogAt=at;try{this.log('plugin-gui-editor-outbound',{channel,seq:this.outboundCount,message:structuredClone(message)});}catch{}}
 message(data){
  const target=this.target;if(!target)return;
  if(typeof data==='string'||data&&typeof data==='object'&&!(data instanceof ArrayBuffer)&&!ArrayBuffer.isView(data)){
   let state=data;if(typeof data==='string'){try{state=JSON.parse(data);}catch{return;}this.logInbound('mozart-editor-frames',state);}if(state?.type!=='editor.state')return;
   if(state.state==='subscribed'){if(state.lane_id!=null&&state.lane_id!==target.laneId||state.plugin_index!=null&&state.plugin_index!==target.pluginIndex)return;this.trackId=Number.isInteger(state.track_id)?state.track_id:null;this.state='subscribed';}
   else if(state.state==='error')this.state='error';
   this.log('plugin-gui-stream',{event:'state',state:state.state,code:state.code??null,trackId:this.trackId});try{this.handlers?.onState?.(state);}catch{}return;
  }
  const buffer=data instanceof ArrayBuffer?data:ArrayBuffer.isView(data)?data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength):null;if(!buffer)return;
  // Latency breakdown: when the first chunk of each frame id arrived (stream clock).
  const times=this.chunkTimes||=new Map();if(buffer.byteLength>=12){const id=new DataView(buffer).getUint32(0);if(!times.has(id)){times.set(id,this.now());if(times.size>16)times.delete(times.keys().next().value);}}
  const frame=this.assembler.push(buffer);if(!frame)return;
  const firstChunkAt=times.get(frame.sequence)??null;times.delete(frame.sequence);
  // Only this subscription's slot, and never older than the newest shown frame.
  // No editor.state reply named the engine track (seen on standalone peers): the frame header of the subscribed
  // slot does. Adopting it keeps input on the mozart-editor channel instead of one HTTP POST per pointer event.
  if(this.trackId==null&&frame.pluginIndex===target.pluginIndex&&Number.isSafeInteger(frame.trackId)&&frame.trackId>0){this.trackId=frame.trackId;this.log('plugin-gui-stream',{event:'track_from_frame',trackId:frame.trackId});}
  if(frame.pluginIndex!==target.pluginIndex||this.trackId!=null&&frame.trackId!==this.trackId||this.latest!==null&&((frame.sequence-this.latest)>>>0)>=0x80000000){this.stats.dropped++;return;}
  this.latest=frame.sequence;this.stats.frames++;this.stats.bytes+=frame.blob.size;
  const receivedAt=this.now();
  try{this.handlers?.onFrame?.({blob:frame.blob,width:frame.width,height:frame.height,revision:frame.revision,sequence:frame.sequence,receivedAt,assembleMs:firstChunkAt==null?null:Math.round((receivedAt-firstChunkAt)*10)/10,chunks:frame.received??null,bytes:frame.bytes??frame.blob.size});}catch{}
 }
 /** Studio Pro: editor input goes over the ORDERED `mozart-editor`
  * channel (negotiated id 100) as {type:"editor.<pointer|scroll|type>", track_id,
  * plugin_index, ...the REST body} — only for the subscribed slot, fire-and-forget (the
  * engine sends no per-input ack; it answers problems with editor.state errors there).
  * Returns true when sent; false means "use REST" (closed channel, other slot, refused). */
 /** 'channel' (write grant: mozart-editor, no probe), 'rest' (read / expired grant, or the manual
  * 'rest' setting with an unreported grant), or null (grant not reported: probe the channel). */
 inputPolicy(){const m=this.monitor;if(!m)return null;const grant=!('peerGrant' in m)?null:typeof m.controlGrant==='function'?m.controlGrant():m.peerGrant;if(grant==='write')return'channel';if(grant==='read'||grant==='expired')return'rest';return editorInputChannelSetting()==='rest'?'rest':null;}
 /** Why inputPolicy() is 'rest' (logged as the route reason). */
 inputRestReason(){const m=this.monitor,grant=typeof m?.controlGrant==='function'?m.controlGrant():m?.peerGrant;return grant==='read'?'peer-grant-read':grant==='expired'?'peer-grant-expired':'channel-setting-rest';}
 inputAvailable(){const m=this.monitor;if(this.inputPolicy()==='rest')return false;if(this.inputRefused&&!this.inputRefused.projectScoped&&this.inputRefused.generation!==(m?.generation??null))this.inputRefused=null;
  // A write grant received AFTER a refusal supersedes it (and the remembered project refusal).
  if(this.inputPolicy()==='channel'&&Number.isFinite(m.peerGrantReceivedAt)){const known=this.inputRefused||projectInputRefusal(m.projectId);if(known&&Number.isFinite(known.at)&&known.at<m.peerGrantReceivedAt){this.inputRefused=null;forgetProjectInputRefusal(m.projectId);this.log('plugin-gui-input-route',{event:'refusal_cleared',route:'channel',reason:'write-grant',code:known.code??null});}}
  // A project-scoped refusal (any peer, any session within the TTL) skips the channel from the first input.
  if(!this.inputRefused){const known=projectInputRefusal(m?.projectId);if(known)this.inputRefused={...known,projectScoped:true,remembered:true,generation:m?.generation??null};}return !!this.target&&!this.inputRefused&&m?.peer?.connectionState==='connected'&&m.editor?.readyState==='open'&&typeof m.editor.send==='function';}
 sendInput(kind,body,{laneId,pluginIndex}={}){
  const target=this.target;if(!['pointer','scroll','type'].includes(kind)||!target||laneId!==target.laneId||pluginIndex!==target.pluginIndex||!this.inputAvailable())return false;
  // Realtime docs: "Input must name that same track_id and plugin_index" (the subscribed reply's engine track).
  // Pro sends exactly {type, track_id, plugin_index, ...body} and never a lane_id. Without the subscribed track_id a
  // write-grant peer uses REST (the reason is logged), never a guessed target.
  const known=Number.isInteger(this.trackId);
  if(!known&&this.inputPolicy()==='channel'){this.lastInputSkip='no-track-id';if(!this.loggedNoTrack){this.loggedNoTrack=true;this.log('plugin-gui-input-route',{event:'no_track_id',route:'rest',state:this.state,via:target.via??null});}return false;}
  this.watchInputErrors();
  // The Freestyle Studio's pointer body also names pointer_id / pointer_type.
  const extra=kind==='pointer'?{pointer_id:Number.isInteger(body?.pointer_id)?body.pointer_id:1,pointer_type:typeof body?.pointer_type==='string'?body.pointer_type:'mouse'}:{};
  const message=known?{type:`editor.${kind}`,track_id:this.trackId,plugin_index:target.pluginIndex,...body,...extra}:{type:`editor.${kind}`,lane_id:target.laneId,plugin_index:target.pluginIndex,...body,...extra};
  try{this.monitor.editor.send(JSON.stringify(message));}catch(error){this.refuseInput({code:'channel_send_failed',message:String(error?.message||error).slice(0,200)});return false;}
  this.logOutbound('mozart-editor',message);
  this.stats.inputs=(this.stats.inputs||0)+1;this.lastInputAt=this.now();return true;
 }
 /** editor.state errors on mozart-editor. Subscription problems keep their own handling;
  * any other error after channel input is taken as the engine refusing input over this
  * peer (the realtime docs: an API-opened peer must send editor input over REST), and the
  * exact code/message are logged once as evidence. */
 watchInputErrors(){
  if(this.inputListener||typeof this.monitor?.addEventListener!=='function')return;
  this.inputListener=event=>{const state=event.detail;if(state?.type!=='editor.state'||state.state!=='error')return;
   if(EDITOR_SUBSCRIPTION_CODES.has(String(state.code||''))&&!/rest|input|not allowed|forbidden|permission/i.test(String(state.message||'')))return;
   if(PEER_SCOPED_REFUSALS.has(String(state.code||'')))try{this.monitor.noteControlForbidden?.(state);}catch{}
   this.refuseInput({code:String(state.code||'editor_error'),message:String(state.message||'').slice(0,300),sinceInputMs:this.lastInputAt!=null?Math.round(this.now()-this.lastInputAt):null});};
  this.monitor.addEventListener('editorstate',this.inputListener);
 }
 refuseInput(reason){if(this.inputRefused)return;const projectScoped=PROJECT_SCOPED_REFUSALS.has(String(reason.code||''));this.inputRefused={...reason,at:Date.now(),generation:this.monitor?.generation??null,projectScoped};if(projectScoped)rememberProjectInputRefusal(this.monitor?.projectId,reason);this.log('plugin-gui-input-route',{event:'refused',route:'channel',...reason,inputsSent:this.stats.inputs||0,laneId:this.target?.laneId??null,pluginIndex:this.target?.pluginIndex??null});try{this.onInputRefused?.(this.inputRefused);}catch{}}
 detach(){if(this.listener)try{this.monitor.removeEventListener('editorframe',this.listener);}catch{}this.listener=null;if(this.stateListener)try{this.monitor.removeEventListener('editorstate',this.stateListener);}catch{}this.stateListener=null;if(this.inputListener)try{this.monitor.removeEventListener('editorstate',this.inputListener);}catch{}this.inputListener=null;}
 unsubscribe(){
  const target=this.target;this.detach();this.target=null;this.handlers=null;this.state='idle';this.assembler.clear();
  if(target&&target.channel?.readyState==='open')try{target.channel.send(JSON.stringify({type:'editor.unsubscribe',lane_id:target.laneId,plugin_index:target.pluginIndex}));}catch{}
  this.loggedNoTrack=false;
 }
}
