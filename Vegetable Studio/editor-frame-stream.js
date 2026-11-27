/** Live plug-in editor frames over the monitor peer (339, freestyle.audio/docs/realtime.html
 * "Live plug-in editor frames"): the `mozart-editor-frames` data channel
 * ({negotiated:true, id:102, ordered:false}, created by CloudMonitor before the
 * offer) carries {"type":"editor.subscribe","lane_id","plugin_index",max_width,fps,relay}
 * out and `editor.state` text replies plus chunked binary JPEG/PNG frames in. No
 * HTTP round trip per frame: the low-latency path for the REST GUI mirror.
 * Input (round 36, Studio Pro parity): over the ordered `mozart-editor` channel when it is
 * open; REST when it is not, or once the engine refuses channel input for this peer.
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
const REFUSAL_TTL_MS=24*60*60*1000,refusedProjects=new Map(),refusalKey=projectId=>'vegetable:editorInputRefused:'+projectId;
export function projectInputRefusal(projectId){
 if(typeof projectId!=='string'||!projectId)return null;const memory=refusedProjects.get(projectId);if(memory&&Date.now()-memory.at<REFUSAL_TTL_MS)return memory;
 try{const stored=JSON.parse(globalThis.localStorage?.getItem(refusalKey(projectId))||'null');if(stored&&Date.now()-stored.at<REFUSAL_TTL_MS){refusedProjects.set(projectId,stored);return stored;}}catch{}
 return null;
}
export function rememberProjectInputRefusal(projectId,reason){if(typeof projectId!=='string'||!projectId)return;const value={code:reason.code,message:reason.message??'',at:Date.now()};refusedProjects.set(projectId,value);try{globalThis.localStorage?.setItem(refusalKey(projectId),JSON.stringify(value));}catch{}}
export function forgetProjectInputRefusals(){refusedProjects.clear();}
export class EditorFrameStream{
 constructor({monitor,log=()=>{},now=()=>globalThis.performance?.now?.()??Date.now(),profile=editorSubscriptionProfile}={}){
  this.monitor=monitor;this.log=log;this.now=now;this.profile=profile;this.assembler=new EditorFrameAssembler();this.target=null;this.listener=null;this.trackId=null;this.latest=null;this.state='idle';this.stats={frames:0,bytes:0,dropped:0};
 }
 /** True when the monitor peer is connected and its frame channel is open. */
 available(){const m=this.monitor;return !!m&&m.peer?.connectionState==='connected'&&m.editorFrames?.readyState==='open'&&typeof m.editorFrames.send==='function';}
 /** Subscribe to one lane slot. Resolves true once the subscribe was sent. */
 async subscribe({laneId,pluginIndex,maxWidth=1280,fps=EDITOR_STREAM_FPS},{onFrame,onState}={}){
  if(!this.available()||typeof laneId!=='string'||!laneId||!Number.isInteger(pluginIndex))return false;
  let profile={max_width:maxWidth,fps,relay:false};try{const measured=await this.profile(this.monitor.peer,maxWidth);if(measured)profile={max_width:measured.relay?Math.min(640,maxWidth):maxWidth,fps:measured.relay?Math.min(5,fps):fps,relay:measured.relay===true};}catch{}
  if(!this.available())return false;
  this.detach();this.target={laneId,pluginIndex,channel:this.monitor.editorFrames};this.handlers={onFrame,onState};this.trackId=null;this.latest=null;this.assembler.clear();this.state='subscribing';
  this.listener=event=>this.message(event.detail);this.monitor.addEventListener('editorframe',this.listener);
  const message={type:'editor.subscribe',lane_id:laneId,plugin_index:pluginIndex,max_width:Math.max(64,Math.min(4096,Math.round(profile.max_width))),fps:Math.max(1,Math.min(30,Math.round(profile.fps))),...profile.relay?{relay:true}:{}};
  try{this.target.channel.send(JSON.stringify(message));}catch(error){this.detach();this.log('plugin-gui-stream',{event:'subscribe_failed',message:String(error?.message||'').slice(0,160)});return false;}
  this.subscribedAt=this.now();this.log('plugin-gui-stream',{event:'subscribe',laneId,pluginIndex,maxWidth:message.max_width,fps:message.fps,relay:!!message.relay});return true;
 }
 message(data){
  const target=this.target;if(!target)return;
  if(typeof data==='string'){
   let state;try{state=JSON.parse(data);}catch{return;}if(state?.type!=='editor.state')return;
   if(state.state==='subscribed'){if(state.lane_id!=null&&state.lane_id!==target.laneId||state.plugin_index!=null&&state.plugin_index!==target.pluginIndex)return;this.trackId=Number.isInteger(state.track_id)?state.track_id:null;this.state='subscribed';}
   else if(state.state==='error')this.state='error';
   this.log('plugin-gui-stream',{event:'state',state:state.state,code:state.code??null,trackId:this.trackId});try{this.handlers?.onState?.(state);}catch{}return;
  }
  const buffer=data instanceof ArrayBuffer?data:ArrayBuffer.isView(data)?data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength):null;if(!buffer)return;
  const frame=this.assembler.push(buffer);if(!frame)return;
  // Only this subscription's slot, and never older than the newest shown frame.
  // A standalone peer may never get the editor.state "subscribed" text reply that names the engine track: the frame's own
  // first-chunk header does. Adopting it lets editor input name track_id on the mozart-editor channel (no per-event HTTP).
  if(this.trackId==null&&frame.pluginIndex===target.pluginIndex&&Number.isSafeInteger(frame.trackId)&&frame.trackId>0){this.trackId=frame.trackId;this.log('plugin-gui-stream',{event:'frame-track',trackId:this.trackId});}
  if(frame.pluginIndex!==target.pluginIndex||this.trackId!=null&&frame.trackId!==this.trackId||this.latest!==null&&((frame.sequence-this.latest)>>>0)>=0x80000000){this.stats.dropped++;return;}
  this.latest=frame.sequence;this.stats.frames++;this.stats.bytes+=frame.blob.size;
  try{this.handlers?.onFrame?.({blob:frame.blob,width:frame.width,height:frame.height,revision:frame.revision,sequence:frame.sequence,receivedAt:this.now()});}catch{}
 }
 /** Studio Pro: editor input goes over the ORDERED `mozart-editor`
  * channel (negotiated id 100) as {type:"editor.<pointer|scroll|type>", track_id,
  * plugin_index, ...the REST body} — only for the subscribed slot, fire-and-forget (the
  * engine sends no per-input ack; it answers problems with editor.state errors there).
  * Returns true when sent; false means "use REST" (closed channel, other slot, refused). */
 inputAvailable(){const m=this.monitor;if(this.inputRefused&&!this.inputRefused.projectScoped&&this.inputRefused.generation!==(m?.generation??null))this.inputRefused=null;
  // A project-scoped refusal (any peer, any session within the TTL) skips the channel from the first input.
  if(!this.inputRefused){const known=projectInputRefusal(m?.projectId);if(known)this.inputRefused={...known,projectScoped:true,remembered:true,generation:m?.generation??null};}return !!this.target&&!this.inputRefused&&m?.peer?.connectionState==='connected'&&m.editor?.readyState==='open'&&typeof m.editor.send==='function';}
 sendInput(kind,body,{laneId,pluginIndex}={}){
  const target=this.target;if(!['pointer','scroll','type'].includes(kind)||!target||laneId!==target.laneId||pluginIndex!==target.pluginIndex||!this.inputAvailable())return false;
  this.watchInputErrors();
  const message={type:`editor.${kind}`,lane_id:target.laneId,...Number.isInteger(this.trackId)?{track_id:this.trackId}:{},plugin_index:target.pluginIndex,...body};
  try{this.monitor.editor.send(JSON.stringify(message));}catch(error){this.refuseInput({code:'channel_send_failed',message:String(error?.message||error).slice(0,200)});return false;}
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
   this.refuseInput({code:String(state.code||'editor_error'),message:String(state.message||'').slice(0,300),sinceInputMs:this.lastInputAt!=null?Math.round(this.now()-this.lastInputAt):null});};
  this.monitor.addEventListener('editorstate',this.inputListener);
 }
 refuseInput(reason){if(this.inputRefused)return;const projectScoped=PROJECT_SCOPED_REFUSALS.has(String(reason.code||''));this.inputRefused={...reason,at:Date.now(),generation:this.monitor?.generation??null,projectScoped};if(projectScoped)rememberProjectInputRefusal(this.monitor?.projectId,reason);this.log('plugin-gui-input-route',{event:'refused',route:'channel',...reason,inputsSent:this.stats.inputs||0,laneId:this.target?.laneId??null,pluginIndex:this.target?.pluginIndex??null});try{this.onInputRefused?.(this.inputRefused);}catch{}}
 detach(){if(this.listener)try{this.monitor.removeEventListener('editorframe',this.listener);}catch{}this.listener=null;if(this.inputListener)try{this.monitor.removeEventListener('editorstate',this.inputListener);}catch{}this.inputListener=null;}
 unsubscribe(){
  const target=this.target;this.detach();this.target=null;this.handlers=null;this.state='idle';this.assembler.clear();
  if(target&&target.channel?.readyState==='open')try{target.channel.send(JSON.stringify({type:'editor.unsubscribe',lane_id:target.laneId,plugin_index:target.pluginIndex}));}catch{}
 }
}
