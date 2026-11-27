/** Freestyle native plugin editor mirror: server frames and forwarded input.
 *
 * Matches the Freestyle Studio: every lifecycle call re-resolves the
 * live runtime track/plugin from the session, subscribes the
 * negotiated editor channel 100 with the resolved identity,
 * assembles big-endian frame chunks from channel 102 and forwards
 * pointer/scroll/type input on channel 100.
 * Lifecycle (open/status/release/close) uses the published Studio API lane routes
 * (bridged `modesty-bridge:/audio/editor`), never a cached numeric handle. Inside Freestyle the
 * monitor is a first-party session peer, so input rides the editor channel (id 100)
 * like the Freestyle Studio; REST input (sendPluginEditorPointer/Scroll/Keys) is the fallback.
 */
import {HttpFrameLoop,HttpInputQueue,fetchEditorFrame,sendEditorInput,sharedFrameLimiter,frameWidthFor,isInstanceMismatch} from './plugin-editor-http.js';
import {bridgeFetch} from './freestyle-host-transport.js';
const emit=(target,type,detail)=>target.dispatchEvent(new CustomEvent(type,{detail}));
const list=value=>Array.isArray(value)?value:[];
const norm=value=>String(value??'').trim().toLowerCase();
const clamp=value=>Math.max(0,Math.min(1,Number(value)||0));
const modifiers=event=>({shift_key:!!event?.shiftKey,ctrl_key:!!event?.ctrlKey,alt_key:!!event?.altKey,meta_key:!!event?.metaKey});
const keycodes=Object.freeze({Tab:48,Enter:36,Backspace:51,Delete:117,Escape:53,Home:115,End:119,PageUp:116,PageDown:121,ArrowLeft:123,ArrowRight:124,ArrowDown:125,ArrowUp:126});
const characterCodes=Object.freeze({a:0,b:11,c:8,d:2,e:14,f:3,g:5,h:4,i:34,j:38,k:40,l:37,m:46,n:45,o:31,p:35,q:12,r:15,s:1,t:17,u:32,v:9,w:13,x:7,y:16,z:6,0:29,1:18,2:19,3:20,4:21,5:23,6:22,7:26,8:28,9:25});
// LABS and Splice runtime type aliases.
const TYPE_ALIASES=Object.freeze({labs:Object.freeze(['labs','spitfire_labs']),splice_instrument:Object.freeze(['splice_instrument'])});
const PROTECTED_TYPES=new Set(['labs','spitfire_labs','splice_instrument']);
export const EDITOR_CHANNEL_ID=100,EDITOR_FRAMES_CHANNEL_ID=102;
const HEADER=12,FIRST_HEADER=11,MOVE_INTERVAL_MS=16;
const uid=()=>{try{if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();}catch{}return`g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;};

export function typesMatch(a,b){const left=norm(a),right=norm(b);if(!left||!right)return false;return left===right||!!(TYPE_ALIASES[left]?.includes(right)||TYPE_ALIASES[right]?.includes(left));}
const requestedTypes=target=>new Set([target?.runtimeType,target?.runtime_type,target?.type,target?.typeId,target?.type_id].map(norm).filter(Boolean));
const protectedMismatch=(types,actual)=>(PROTECTED_TYPES.has(actual)||[...types].some(type=>PROTECTED_TYPES.has(type)))&&![...types].some(type=>typesMatch(type,actual));

/** Plugin selection: by instance id (with protected-type guard), else a unique type match. */
export function matchLanePlugin(plugins,target={}){
  if(!Array.isArray(plugins))return null;
  const instance=norm(target.instanceId??target.instance_id),types=requestedTypes(target);
  const byInstance=instance?plugins.find(plugin=>norm(plugin?.instance_id??plugin?.instanceId)===instance):null;
  if(byInstance&&types.size&&protectedMismatch(types,norm(byInstance.type_id??byInstance.typeId)))return null;
  const byType=types.size?plugins.filter(plugin=>[...types].some(type=>typesMatch(type,plugin?.type_id??plugin?.typeId))):[];
  const plugin=instance?byInstance:byType.length===1?byType[0]:null;if(!plugin)return null;
  const pluginIndex=Number(plugin.index??plugin.plugin_index??plugins.indexOf(plugin));if(!Number.isInteger(pluginIndex)||pluginIndex<0)return null;
  return{pluginIndex,instanceId:String(plugin.instance_id??plugin.instanceId??'').trim(),typeId:String(plugin.type_id??plugin.typeId??'').trim(),name:String(plugin.name||'').trim()};
}
/** Resolve one runtime plugin from a live track. */
export function matchRuntimePlugin(track,target={}){
  if(!track||!Array.isArray(track.plugins))return null;
  const plugin=matchLanePlugin(track.plugins,target),trackId=Number(track.id);
  if(!plugin||!Number.isSafeInteger(trackId)||trackId<=0)return null;
  return{trackId,pluginIndex:plugin.pluginIndex,laneId:String(track.db_track_id??track.dbTrackId??'').trim(),instanceId:plugin.instanceId,typeId:plugin.typeId,name:plugin.name};
}

/** A frame/open response must name the same lane and plugin instance. */
export function editorTargetMatches(editorTarget,target={}){
  if(!editorTarget||typeof editorTarget!=='object')return false;
  const lane=norm(target.laneId??target.lane_id),frameLane=norm(editorTarget.lane_id??editorTarget.laneId);if(lane&&frameLane&&lane!==frameLane)return false;
  const instance=norm(target.instanceId??target.instance_id),frameInstance=norm(editorTarget.instance_id??editorTarget.instanceId),types=requestedTypes(target),frameType=norm(editorTarget.type_id??editorTarget.typeId);
  if(instance){if(!frameInstance||instance!==frameInstance)return false;return!(types.size&&protectedMismatch(types,frameType));}
  if(types.size&&frameType&&![...types].some(type=>typesMatch(type,frameType)))return false;
  const index=Number(target.pluginIndex??target.plugin_index),frameIndex=Number(editorTarget.plugin_index??editorTarget.pluginIndex);
  return!!(lane&&frameLane&&lane===frameLane&&types.size&&frameType&&[...types].some(type=>typesMatch(type,frameType))&&Number.isInteger(index)&&index>=0&&index===frameIndex);
}

export class EditorError extends Error{
  constructor(message,{code='editor_error',stage='editor',status=null,requestId=null,details=null,cause}={}){super(message,cause?{cause}:undefined);this.name='EditorError';this.code=code;this.stage=stage;this.status=status;this.requestId=requestId;this.details=details;}
}
/** The engine is still loading the session or plugin baseline. */
export function isEditorLoading(error){const status=Number(error?.status||0),text=norm(error?.message||error);return status===409&&/session_loading|still loading|loading this project|session load/.test(text)||/waiting for (?:its )?live mozart instance/.test(text)||status===503&&/plugin_state_baseline_pending/.test(text)||/timed out waiting for juce message thread/.test(text)||error?.code==='editor_runtime_pending';}
/** Retryable unless auth/licence/missing plug-in. */
export function isEditorRetryable(error){const text=norm(error?.message||error),status=Number(error?.status||0);if([401,403].includes(status)||/unauthorized|forbidden|sign.?in|license|content_unavailable|not installed|plugin not found/.test(text))return false;return isEditorLoading(error)||[408,429,502,503,504].includes(status)||/editor is not open|track not found|timed? ?out|network|fetch|no image frame|rejected (?:near-black|near-uniform|effectively transparent)/.test(text);}
/** Error wording plus the real code/stage/HTTP status. */
export function describeEditorError(error,label='plugin'){
  const raw=String(error?.message||error||'');
  const text=/editor is not open|plugin not found|track not found/i.test(raw)?`Reconnecting the original ${label} editor…`:/near-black|near-uniform|effectively transparent/i.test(raw)?`The original ${label} editor has not rendered a usable frame yet. ${raw}`:raw||`The original ${label} editor is unavailable.`;
  const facts=[error?.code&&`code ${error.code}`,error?.stage&&`stage ${error.stage}`,error?.status&&`HTTP ${error.status}`,error?.requestId&&`request ${error.requestId}`].filter(Boolean);
  return facts.length?`${text} (${facts.join(' · ')})`:text;
}
function toEditorError(error,stage,code='editor_error'){if(error instanceof EditorError){error.stage||=stage;return error;}return new EditorError(error?.message||String(error),{code:error?.code||code,stage:error?.stage||stage,status:error?.status??null,requestId:error?.requestId??null,details:error?.details??null,cause:error});}
const unpack=result=>{let data=result?.structuredContent??result;for(let i=0;i<4&&data?.response&&typeof data.response==='object';i++)data={...data,...data.response,response:undefined};return data||{};};

/** Numeric engine track id from an editor:open reply (resolvedArgs.track_id), else null. */
export function openedTrackId(response){
  for(const value of [response?.resolvedArgs?.track_id,response?.result?.resolvedArgs?.track_id,response?.structuredContent?.resolvedArgs?.track_id]){const id=Number(value);if(value!==null&&value!==undefined&&value!==''&&Number.isSafeInteger(id)&&id>0)return id;}
  return null;
}
const contextOf=(projectId,contextTrackId)=>({project_id:projectId,...contextTrackId?{track_id:contextTrackId}:{}});
const pendingError=label=>new EditorError(`The original ${label} editor is waiting for its live Mozart instance.`,{code:'editor_runtime_pending',stage:'resolve'});
/** Slot identity from the lane's own plugin list: the cheapest fresh source, and all the typed lifecycle routes need. */
export async function resolveEditorSlot({call,projectId,contextTrackId,target}){
  if(typeof call!=='function')throw new EditorError('A Freestyle call function is required to resolve the plugin editor.',{code:'editor_resolver_missing',stage:'resolve'});
  const laneId=String(target?.laneId??target?.lane_id??'').trim(),label=target?.name||target?.type||'plug-in';
  if(!projectId||!laneId)throw new EditorError('Native editor lane is not ready.',{code:'editor_lane_missing',stage:'resolve'});
  if(!requestedTypes(target).size&&!norm(target?.instanceId??target?.instance_id))throw new EditorError('Select a plugin with its live instance id or type.',{code:'editor_identity_missing',stage:'resolve'});
  const chain=unpack(await call('list_plugins',{...contextOf(projectId,contextTrackId),lane_id:laneId}));
  if(chain.projectId!==undefined&&String(chain.projectId)!==String(projectId)||chain.laneId!==undefined&&String(chain.laneId)!==laneId)throw new EditorError('The plugin list belongs to another lane.',{code:'foreign_plugin_list',stage:'resolve'});
  const slot=matchLanePlugin(chain.plugins,target);if(!slot)throw pendingError(label);
  return Object.freeze({...slot,laneId,projectId:String(projectId),contextTrackId:contextTrackId||null});
}
/** Numeric runtime track (frames/input only) from a native snapshot, scoped by project, lane and session epoch. */
export function runtimeFromState(state,slot){
  const data=unpack(state),label=slot?.name||slot?.typeId||'plug-in',sessionProject=data?.session?.projectId??data?.session?.project_id??data?.projectId;
  if(sessionProject!==undefined&&String(sessionProject)!==String(slot.projectId))throw new EditorError('Native editor project is no longer active.',{code:'foreign_native_snapshot',stage:'resolve'});
  const tracks=list(data?.tracks?.tracks??data?.tracks).filter(track=>String(track?.db_track_id??track?.dbTrackId??'')===slot.laneId);
  if(tracks.length>1)throw new EditorError('The live engine reports this lane more than once.',{code:'editor_identity_conflict',stage:'resolve'});
  const track=tracks[0],trackId=Number(track?.id);if(!track||!Number.isSafeInteger(trackId)||trackId<=0)throw pendingError(label);
  // The lane chain is authoritative; a different live index is a conflict, not a guess.
  const live=Array.isArray(track.plugins)?matchLanePlugin(track.plugins,{instanceId:slot.instanceId,type:slot.typeId}):null;
  if(live&&live.pluginIndex!==slot.pluginIndex)throw new EditorError('The live plugin chain and lane chain disagree. Refresh and try again.',{code:'editor_identity_conflict',stage:'resolve'});
  const epoch=data?.tracks?.session_epoch??data?.session?.session_epoch??null;
  return{trackId,sessionEpoch:Number.isSafeInteger(epoch)?epoch:null};
}
/** Full fresh resolution (lane chain + a fresh native snapshot). */
export async function resolveEditorTarget({call,projectId,contextTrackId,target,state=null}){
  const [slot,snapshot]=await Promise.all([resolveEditorSlot({call,projectId,contextTrackId,target}),state?Promise.resolve(state):call('get_pro_state',contextOf(projectId,contextTrackId))]);
  return Object.freeze({...slot,...runtimeFromState(snapshot,slot)});
}

export class EditorFrameAssembler {
  constructor(){this.frames=new Map();}
  clear(){this.frames.clear();}
  push(input) {
    if(!(input instanceof ArrayBuffer)||input.byteLength<HEADER)return null;
    const view=new DataView(input),sequence=view.getUint32(0),index=view.getUint16(4),count=view.getUint16(6),revision=view.getUint32(8).toString(16).padStart(8,'0');
    if(!count||count>4096||index>=count||input.byteLength<HEADER+(index===0?FIRST_HEADER:0))return null;
    let frame=this.frames.get(sequence);
    if(!frame){frame={chunks:new Array(count),received:0,revision,bytes:0};this.frames.set(sequence,frame);while(this.frames.size>8)this.frames.delete(this.frames.keys().next().value);}
    if(frame.chunks.length!==count)return null;
    let offset=HEADER;
    if(index===0){frame.trackId=view.getUint32(offset);frame.pluginIndex=view.getUint16(offset+4);frame.width=view.getUint16(offset+6);frame.height=view.getUint16(offset+8);frame.format=view.getUint8(offset+10)===1?'image/png':'image/jpeg';offset+=FIRST_HEADER;}
    if(!frame.chunks[index]){frame.chunks[index]=input.slice(offset);frame.received++;frame.bytes+=input.byteLength-offset;}
    if(frame.bytes>40*1024*1024){this.frames.delete(sequence);return null;}
    if(frame.received!==count)return null;
    this.frames.delete(sequence);
    // Drop partial frames far older than the completed sequence.
    for(const key of this.frames.keys())if(key+8<sequence)this.frames.delete(key);
    return{sequence,revision:frame.revision,bytes:frame.bytes,trackId:frame.trackId,pluginIndex:frame.pluginIndex,width:frame.width,height:frame.height,format:frame.format,blob:new Blob(frame.chunks,{type:frame.format})};
  }
}

/** Pixel statistics proving that a frame is a usable image (the server rejects near-black, near-uniform and transparent captures). */
export function assessEditorPixels(data,{width,height}={}){
  const pixels=Math.floor((data?.length||0)/4);if(!pixels)return{verdict:'unverified',reason:'no-pixels'};
  const step=Math.max(1,Math.floor(pixels/4096));let n=0,sum=0,sumSq=0,alpha=0;
  for(let i=0;i<pixels;i+=step){const o=i*4,luma=.2126*data[o]+.7152*data[o+1]+.0722*data[o+2];sum+=luma;sumSq+=luma*luma;alpha+=data[o+3];n++;}
  const mean=sum/n,deviation=Math.sqrt(Math.max(0,sumSq/n-mean*mean)),alphaMean=alpha/n;
  const verdict=alphaMean<8?'transparent':mean<6&&deviation<4?'near-black':deviation<1.5?'near-uniform':'usable';
  return{verdict,luminanceMean:Math.round(mean*10)/10,luminanceDeviation:Math.round(deviation*10)/10,alphaMean:Math.round(alphaMean),samples:n,width,height};
}
export async function analyzeEditorFrame(blob,{width,height}={}){
  try{
    if(typeof globalThis.createImageBitmap!=='function')return{verdict:'unverified',reason:'no-decoder'};
    const bitmap=await globalThis.createImageBitmap(blob),w=Math.min(256,bitmap.width),h=Math.max(1,Math.round(bitmap.height*w/Math.max(1,bitmap.width)));
    const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});
    const context=canvas.getContext('2d');if(!context){bitmap.close?.();return{verdict:'unverified',reason:'no-canvas'};}
    context.drawImage(bitmap,0,0,w,h);bitmap.close?.();
    return{...assessEditorPixels(context.getImageData(0,0,w,h).data,{width,height}),decoded:true};
  }catch(error){return{verdict:'undecodable',reason:String(error?.message||error)};}
}

export class RemotePluginEditor extends EventTarget {
  constructor({monitor,call=null,requestEditor=null,resolveSlot=null,cachedState=null,http=true,httpInput=true,quietMs=1500,frameRoute='modesty-bridge:/editor/frame',fetchFrame=null,sendInput=null,limiter=sharedFrameLimiter,channelGraceMs=1500,inputTimers=null,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),frameTimeoutMs=4000,fetch:fetchImpl=(...args)=>bridgeFetch(...args),analyzeFrame=analyzeEditorFrame,raf=callback=>(globalThis.requestAnimationFrame||(fn=>setTimeout(()=>fn(Date.now()),16)))(callback),cancelRaf=id=>(globalThis.cancelAnimationFrame||clearTimeout)(id),now=()=>globalThis.performance?.now?.()??Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxOpenAttempts=8}={}) {
    super();if(!monitor)throw new Error('A cloud monitor is required to mirror plugin editors.');
    this.monitor=monitor;this.call=call;this.fetch=fetchImpl;this.analyzeFrame=analyzeFrame;this.raf=raf;this.cancelRaf=cancelRaf;this.now=now;this.sleep=sleep;this.maxOpenAttempts=maxOpenAttempts;
    this.requestEditor=requestEditor||((target,action,arguments_,options)=>this.proxy(target,action,arguments_,options));
    this.resolveSlot=resolveSlot||(target=>resolveEditorSlot({call:this.call,projectId:target.projectId,contextTrackId:target.contextTrackId,target}));
    this.http=!!http;this.httpInput=!!httpInput;this.quietMs=quietMs;this.frameRoute=frameRoute;this.limiter=limiter;this.channelGraceMs=channelGraceMs;this.inputTimers=inputTimers;
    this.fetchFrame=fetchFrame||(options=>fetchEditorFrame({fetch:this.fetch,route:this.frameRoute,target:this.target,...options}));
    this.sendInput=sendInput||((kind,payload)=>{if(typeof this.call!=='function')throw new EditorError('A Freestyle call function is required for editor input.',{code:'editor_input_unavailable',stage:'input'});return sendEditorInput({call:this.call,target:this.target,kind,payload});});
    this.cachedState=cachedState;this.setTimer=setTimer;this.clearTimer=clearTimer;this.frameTimeoutMs=frameTimeoutMs;
    this.assembler=new EditorFrameAssembler();this.state='closed';this.generation=0;this.zoom='auto';this.relay=false;
    this.stats={frames:0,rejectedFrames:0,droppedInput:0,sentInput:0};
  }
  get label(){return this.target?.name||this.request?.name||this.request?.type||'plugin';}
  setState(state,message=''){this.state=state;this.message=message||state;if(this.statusElement){this.statusElement.textContent=this.message;this.statusElement.setAttribute('role',['error','release-failed','degraded'].includes(state)?'alert':'status');}this.view?.setAttribute('data-native-editor-state',state);emit(this,'state',{state,message:this.message});}
  fail(error,stage){const failure=toEditorError(error,stage);this.lastError=failure;this.setState('error',describeEditorError(failure,this.label));emit(this,'error',failure);return failure;}
  async proxy(target,action,arguments_={},{idempotencyKey}={}) {
    const response=await this.fetch('modesty-bridge:/audio/editor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:target.projectId,...target.contextTrackId?{track_id:target.contextTrackId}:{},lane_id:target.laneId,plugin_index:target.pluginIndex,action,arguments:arguments_,...idempotencyKey?{idempotency_key:idempotencyKey}:{}})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new EditorError(data.detail||data.error?.message||(typeof data.error==='string'?data.error:'')||`Cloud plugin editor ${action} failed (${response.status}).`,{code:data.code||(typeof data.error==='string'?data.error:null)||'editor_http_error',stage:data.stage||`lifecycle:${action}`,status:data.upstreamStatus||response.status,requestId:data.requestId||null,details:data.details||null});
    return data;
  }
  /** Numeric handle for frames/input: the session's already-loaded native snapshot first, else one fresh read. */
  async resolveRuntime(slot,{fresh=false}={}){
    if(!fresh&&typeof this.cachedState==='function'){const cached=this.cachedState();if(cached)try{return{...runtimeFromState(cached,slot),source:'cache'};}catch(error){if(error.code==='editor_identity_conflict')throw error;}}
    if(typeof this.call!=='function')throw new EditorError('A Freestyle call function is required to resolve the plugin editor.',{code:'editor_resolver_missing',stage:'resolve'});
    return{...runtimeFromState(await this.call('get_pro_state',contextOf(slot.projectId,slot.contextTrackId)),slot),source:'fresh'};
  }
  sameIdentity(a,b){return!!a&&!!b&&a.trackId===b.trackId&&a.pluginIndex===b.pluginIndex&&a.laneId===b.laneId&&norm(a.instanceId)===norm(b.instanceId)&&(a.sessionEpoch??null)===(b.sessionEpoch??null);}
  async lifecycle(resolved,action,arguments_={visible:false},idempotencyKey=uid()){
    try{return{resolved,response:await this.requestEditor(resolved,action,arguments_,{idempotencyKey})};}
    catch(error){
      // On a non-input failure, re-resolve once; retry only if the live identity moved.
      if(['status'].includes(action))throw error;
      let fresh;try{fresh=await this.resolveSlot(this.request);}catch{throw error;}
      if(fresh.pluginIndex===resolved.pluginIndex&&norm(fresh.instanceId)===norm(resolved.instanceId))throw error;
      return{resolved:fresh,response:await this.requestEditor(fresh,action,arguments_,{idempotencyKey:uid()})};
    }
  }
  async open(target,container,{maxWidth,format}={}) {
    const previous=await this.close();
    if(!previous.released)throw previous.error||new EditorError('Release the previous plugin editor before opening another.',{code:'editor_release_pending',stage:'lifecycle:release'});
    const generation=++this.generation;
    const request={...target,projectId:target.projectId||this.monitor.projectId,contextTrackId:target.contextTrackId||this.monitor.trackId||null};
    if(typeof request.laneId!=='string'||!request.laneId||request.laneId.length>64)throw this.fail(new EditorError('Select the persisted lane for this cloud plugin editor.',{code:'editor_lane_missing',stage:'preflight'}),'preflight');
    if(this.monitor.projectId&&request.projectId!==this.monitor.projectId)throw this.fail(new EditorError('The plugin and audio monitor must belong to the same cloud project.',{code:'editor_project_mismatch',stage:'preflight'}),'preflight');
    this.request=request;this.target=null;this.frame=null;this.liveFrame=false;this.stats={frames:0,rejectedFrames:0,droppedInput:0,sentInput:0};
    if(container)this.mount(container);
    try{
      // The negotiated WebRTC editor channels are used when the monitor has them; the OAuth HTTP frame/input
      // routes are the fallback (and the only path without a monitor peer).
      // 339 realtime docs ("Live plug-in editor frames"): subscribe by lane on the negotiated frames channel (id 102);
      // no numeric engine track handle is needed. Input always goes over REST on API-opened peers.
      const channel=!!this.monitor.editorFrames;
      if(!channel&&!this.http)throw new EditorError('Connect the cloud audio monitor to receive the original plugin editor.',{code:'editor_channel_unavailable',stage:'subscribe'});
      // Critical path: lane chain -> mirror-open -> subscribe. The numeric frame handle is
      // read from the session snapshot in parallel; parameters are never read here.
      let slot,response;
      for(let attempt=0;;attempt++){
        this.setState('resolving',`Finding the live ${this.label} instance…`);
        try{
          slot=await this.resolveSlot(request);if(generation!==this.generation)return false;
          this.setState('opening',`Opening the original ${this.label} editor…`);
          const lease={key:uid(),target:slot,acknowledged:false};this.lease=lease;
          // The lease is marked before any awaiting close() can observe the settled open.
          const pending=this.lifecycle(slot,'mirror-open',{visible:false},lease.key).then(result=>{lease.target=result.resolved;lease.acknowledged=true;lease.acknowledgedAt=Date.now();return result;});this.opening=pending.catch(()=>null);
          const result=await pending;slot=result.resolved;response=result.response;break;
        }catch(error){
          if(this.lease&&!this.lease.acknowledged)this.lease=null;
          if(generation!==this.generation)return false;
          if(!isEditorLoading(error)||attempt+1>=this.maxOpenAttempts)throw error;
          this.setState('opening',`Waiting for the live ${this.label} instance…`);
          await this.sleep(Math.min(8000,500*2**attempt));if(generation!==this.generation)return false;
        }
      }
      this.openResponse=response;if(generation!==this.generation)return false;
      this.httpReopened=false;
      // #8: editor:open's resolvedArgs.track_id is the engine track the frames will carry (the frame header and the
      // editor.state "subscribed" message stay authoritative). Only a numeric engine handle is adopted.
      const opened=openedTrackId(response);
      this.target=Object.freeze({...slot,...(opened!==null&&!Number.isSafeInteger(slot.trackId)?{trackId:opened}:{})});
      if(!channel)this.startHttp(generation);else{this.subscribe({maxWidth,format});this.watchChannel(generation);}
      this.setState('waiting',`Waiting for the original ${this.label} image…`);return true;
    }catch(error){throw this.fail(error,error?.stage||'lifecycle:mirror-open');}
  }
  /** WebRTC is preferred (pushed frames, no per-frame request, outside the 2-request HTTP cap); if it has
   *  not delivered a frame within the grace period, or its channel closes, the HTTP long-poll takes over. */
  watchChannel(generation){
    if(!this.http||!Number.isFinite(this.channelGraceMs))return;
    this.channelTimer=this.setTimer(()=>{this.channelTimer=null;if(generation===this.generation&&this.transport!=='webrtc')this.startHttp(generation);},this.channelGraceMs);
  }
  httpMaxWidth(){return frameWidthFor(this.container?.clientWidth||this.frame?.width||640);}
  startHttp(generation=this.generation){
    if(!this.http||generation!==this.generation||!this.target||this.httpLoop?.running||this.paused)return;
    this.inputQueue??=new HttpInputQueue({send:(kind,payload)=>this.sendInput(kind,payload),...this.inputTimers||{},onError:error=>this.inputFailed(error),onMoveError:error=>{this.stats.failedMoves=(this.stats.failedMoves||0)+1;this.debugInfo({lastMoveError:error?.code||error?.status||'error'});}});
    const loop=this.httpLoop??=new HttpFrameLoop({fetchFrame:options=>this.fetchFrame(options),limiter:this.limiter,maxWidth:()=>this.httpMaxWidth(),expectedInstanceId:this.target.instanceId||null,
      reopen:async()=>{if(generation!==this.generation)return;this.setState('opening',`Reopening the original ${this.label} editor…`);await this.requestEditor(this.lease?.target||this.target,'mirror-open',{visible:false},{idempotencyKey:uid()});},
      onFrame:frame=>generation===this.generation?this.presentFrame({...frame,trackId:this.target?.trackId,pluginIndex:this.target?.pluginIndex},'http'):null,
      onError:error=>{if(generation!==this.generation)return;if(isInstanceMismatch(error))this.instanceChanged(error);else this.fail(error,'frame');}});
    if(this.httpReopened)loop.reopened=true;
    loop.start().finally(()=>{this.httpReopened=loop.reopened;});
  }
  stopHttp(){const loop=this.httpLoop;this.httpLoop=null;if(loop)this.httpReopened=loop.reopened;return loop?.stop();}
  /** Pauses frame polling while the window is hidden; resumes on the same open attempt. */
  pause(){this.paused=true;return this.stopHttp();}
  resume(){if(!this.paused)return;this.paused=false;if(this.target&&this.transport!=='webrtc')this.startHttp();}
  /** 409 plugin_instance_mismatch: stop, refresh the slot identity and tell the user; nothing is re-sent. */
  async instanceChanged(error){
    this.stopHttp();this.inputQueue?.close();this.inputQueue=null;
    const current=error?.details?.currentPluginType||error?.details?.currentInstanceId;
    const failure=new EditorError(`The plug-in in this slot changed${current?` (now ${current})`:''}. Reopen the editor for the current plug-in.`,{code:'plugin_instance_mismatch',stage:error?.stage||'frame',status:error?.status??409,details:error?.details||null});
    this.fail(failure,'frame');
    try{this.currentSlot=await this.resolveSlot({...this.request,instanceId:error?.details?.currentInstanceId||'',type:error?.details?.currentPluginType||this.request?.type});}catch{this.currentSlot=null;}
    emit(this,'instancechanged',{error:failure,current:this.currentSlot});
  }
  /** Typed input refusals (328): delivered-but-unconfirmed codes are shown, never resent. */
  inputFailed(error){
    if(isInstanceMismatch(error))return this.instanceChanged(error);this.stats.failedInput=(this.stats.failedInput||0)+1;this.lastInputError=toEditorError(error,'input');
    const code=this.lastInputError.code,delivered=error?.details?.delivered===true;
    const text=code==='input_unconfirmed'?'The plug-in received the input but reported no change':code==='not_hit_testable'?'That spot in the plug-in window does not accept clicks':code==='no_editor_view'?'The plug-in has no editor view to receive input':code==='editor_not_open'?'The plug-in editor is not open; reopen it to send input':'Input not delivered';
    if(this.statusElement)this.statusElement.textContent=`${text}${delivered?'':' (not retried)'}: ${describeEditorError(this.lastInputError,this.label)}`;emit(this,'inputerror',this.lastInputError);
  }
  subscribe({maxWidth,format}={}){
    const width=this.container?.clientWidth||1280,scale=Math.max(1,globalThis.devicePixelRatio||1);
    this.subscription={laneId:this.target.laneId,pluginIndex:this.target.pluginIndex,maxWidth:Math.max(64,Math.min(4096,Math.ceil(Number(maxWidth)||width*scale))),format:format==='png'?'png':'jpeg',fps:30};
    this.frameListener=event=>this.receiveFrame(event.detail);
    this.connectedListener=()=>{this.attachChannel();this.sendSubscribe();};
    this.monitor.addEventListener('editorframe',this.frameListener);this.monitor.addEventListener('connected',this.connectedListener);
    this.attachChannel();this.sendSubscribe();this.detectRelay();
  }
  attachChannel(){
    const channel=this.monitor.editorFrames;if(!channel||channel===this.channel)return;
    if(this.channel&&this.channelOpenListener)this.channel.removeEventListener?.('open',this.channelOpenListener);
    if(this.channel&&this.channelCloseListener)this.channel.removeEventListener?.('close',this.channelCloseListener);
    this.channel=channel;this.channelOpenListener=()=>{this.sendSubscribe();this.detectRelay();};channel.addEventListener?.('open',this.channelOpenListener);
    this.channelCloseListener=()=>{this.subscribed=false;if(this.transport==='webrtc')this.transport=null;this.startHttp();};channel.addEventListener?.('close',this.channelCloseListener);
  }
  /** {type:"editor.subscribe", lane_id, plugin_index, max_width, fps, format, relay} on mozart-editor-frames; relay ≤640 px / ≤5 fps. */
  sendSubscribe(){
    const channel=this.monitor.editorFrames,s=this.subscription;if(!s||channel?.readyState!=='open')return false;
    try{channel.send(JSON.stringify({type:'editor.subscribe',lane_id:s.laneId,plugin_index:s.pluginIndex,max_width:this.relay?Math.min(640,s.maxWidth):s.maxWidth,fps:this.relay?Math.min(5,s.fps):s.fps,format:s.format,...this.relay?{relay:true}:{}}));}catch(error){this.fail(new EditorError(`The editor subscription could not be sent: ${error?.message||error}`,{code:'editor_subscribe_failed',stage:'subscribe'}),'subscribe');return false;}
    this.subscribed=true;return true;
  }
  /** Text replies on the frames channel: {type:"editor.state", state:"subscribed"|"error", track_id, code, message}. */
  channelState(detail){
    if(detail?.type!=='editor.state')return;this.editorState=detail;
    if(detail.state==='subscribed'){if(Number.isSafeInteger(Number(detail.track_id))&&this.target)this.target=Object.freeze({...this.target,trackId:Number(detail.track_id)});this.debugInfo({channelState:'subscribed'});return;}
    if(detail.state==='error'){this.debugInfo({channelState:'error',channelError:detail.code||null});
      // The engine keeps retrying; frames come over HTTP until the channel delivers again.
      if(this.http){if(!this.httpLoop?.running)this.startHttp();}
      else if(!this.liveFrame)this.fail(new EditorError(detail.message||'The cloud plugin editor failed.',{code:detail.code||'editor_engine_error',stage:'engine'}),'engine');}
  }
  /** Inspect the selected ICE pair and resubscribe when relay state changes. */
  async detectRelay(){
    const peer=this.monitor.peer;if(!peer?.getStats)return;
    try{const stats=await peer.getStats();let pair=null;stats.forEach(row=>{if(row.type==='candidate-pair'&&(row.selected||row.nominated&&row.state==='succeeded'))pair=row;});if(!pair)return;
      const local=stats.get?.(pair.localCandidateId),remote=stats.get?.(pair.remoteCandidateId),relay=local?.candidateType==='relay'||remote?.candidateType==='relay';
      if(relay!==this.relay){this.relay=relay;this.sendSubscribe();}}catch{}
  }
  mount(container) {
    container.replaceChildren();this.container=container;
    const view=document.createElement('div');view.className='plugin-editor-mirror';view.dataset.nativeEditorState=this.state;
    const status=document.createElement('div');status.className='remote-plugin-status plugin-editor-status';status.setAttribute('role','status');
    const surface=document.createElement('div');surface.className='plugin-editor-surface';surface.tabIndex=0;surface.setAttribute('role','application');surface.setAttribute('aria-label',`Interactive original ${this.label} editor`);
    // No <img> exists until a decoded frame has a source (a src-less image renders a broken icon).
    const loading=document.createElement('div');loading.className='plugin-editor-loading';loading.setAttribute('aria-hidden','true');loading.innerHTML='<span class="plugin-editor-spinner"></span>';
    surface.append(loading);view.append(status,surface);container.append(view);
    Object.assign(this,{view,statusElement:status,surface,loading,image:null});
    // Moves and the release are tracked on the document for the whole gesture, so a drag keeps working when
    // pointer capture is unavailable (synthetic events, capture lost to another element) or leaves the frame.
    surface.onpointerdown=event=>this.pointerDown(event);
    surface.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();};
    surface.addEventListener('wheel',event=>this.wheel(event),{passive:false});surface.onkeydown=event=>this.key(event);
    this.resizeObserver?.disconnect();if(typeof ResizeObserver==='function'){this.resizeObserver=new ResizeObserver(()=>this.fit());this.resizeObserver.observe(container);}
  }
  /** Automatic zoom: native frame size, scaled down to fit the window. */
  fit(){
    if(!this.image||!this.frame)return 1;const available=Math.max(1,this.container?.clientWidth||this.frame.width),scale=this.zoom==='auto'?Math.min(1,available/this.frame.width):Math.max(.25,Math.min(4,Number(this.zoom)||1));
    this.scale=scale;this.surface.style.width=`${Math.round(this.frame.width*scale)}px`;this.surface.style.height=`${Math.round(this.frame.height*scale)}px`;
    this.image.style.width='100%';this.image.style.height='100%';this.surface.dataset.zoomScale=scale.toFixed(3);return scale;
  }
  setZoom(zoom){this.zoom=zoom==='auto'?'auto':Number(zoom);return this.fit();}
  /** Normalised to the displayed frame content: letterbox bars (object-fit: contain) are excluded. */
  point(event){
    const rect=this.surface.getBoundingClientRect(),boxWidth=Math.max(1,rect.width||0),boxHeight=Math.max(1,rect.height||0);
    let left=rect.left||0,top=rect.top||0,width=boxWidth,height=boxHeight;
    if(this.frame?.width&&this.frame?.height){const scale=Math.min(boxWidth/this.frame.width,boxHeight/this.frame.height);width=Math.max(1,this.frame.width*scale);height=Math.max(1,this.frame.height*scale);left+=(boxWidth-width)/2;top+=(boxHeight-height)/2;}
    return{x_norm:clamp((Number(event.clientX)-left)/width),y_norm:clamp((Number(event.clientY)-top)/height)};
  }
  pointerPayload(event,phase){return{phase,...this.point(event),pointer_id:Number(event.pointerId)||0,pointer_type:String(event.pointerType||'mouse'),button:Number.isInteger(Number(event.button))?Number(event.button):-1,buttons:Number(event.buttons)||0,pressure:Number.isFinite(Number(event.pressure))?Number(event.pressure):0,...modifiers(event)};}
  inputReady(reason){if(this.liveFrame&&this.target)return true;this.stats.droppedInput++;emit(this,'inputdropped',{reason:reason||(this.target?'no-live-frame':'closed')});return false;}
  pointerDown(event){
    if(this.gesture||!this.inputReady())return;
    event.preventDefault();event.stopPropagation();this.surface.focus?.({preventScroll:true});
    try{this.surface.setPointerCapture?.(event.pointerId);}catch{}
    const down={...this.pointerPayload(event,'down'),gesture_id:uid()};
    // A drag must reach the plug-in as a pressed move; some event sources report buttons=0 on moves.
    this.gesture={pointerId:event.pointerId,down,last:down,button:down.button>=0?down.button:0,buttons:down.buttons||1<<Math.max(0,down.button)};
    const doc=this.surface.ownerDocument||globalThis.document;
    this.gestureListeners={move:moveEvent=>this.pointerMove(moveEvent),up:upEvent=>this.pointerEnd(upEvent,'up'),doc};
    doc?.addEventListener('pointermove',this.gestureListeners.move,true);doc?.addEventListener('pointerup',this.gestureListeners.up,true);doc?.addEventListener('pointercancel',this.gestureListeners.up,true);
    this.trySend('pointer',down);
  }
  /** Drag moves carry the pressed button state and are coalesced by a timer (never by requestAnimationFrame, which
   *  stalls in occluded/background windows); the latest move is never dropped and is flushed before the release. */
  pointerMove(event){
    const gesture=this.gesture;if(!gesture||event.pointerId!==gesture.pointerId||!this.liveFrame)return;event.preventDefault?.();
    const payload=this.pointerPayload(event,'move');
    this.pendingMove={...payload,button:gesture.button,buttons:payload.buttons||gesture.buttons,pressure:payload.pressure||gesture.down.pressure||.5,gesture_id:gesture.down.gesture_id};gesture.last=this.pendingMove;
    if(this.moveTimer==null){const wait=Math.max(0,(this.lastMoveSentAt??-Infinity)+MOVE_INTERVAL_MS-this.now());this.moveTimer=this.setTimer(()=>{this.moveTimer=null;this.flushMove();},wait);}
  }
  flushMove(){if(this.moveTimer!=null){this.clearTimer(this.moveTimer);this.moveTimer=null;}const move=this.pendingMove;this.pendingMove=null;if(!move)return;this.lastMoveSentAt=this.now();this.trySend('pointer',{...move});}
  endGestureListeners(){const listeners=this.gestureListeners;this.gestureListeners=null;if(!listeners?.doc)return;listeners.doc.removeEventListener('pointermove',listeners.move,true);listeners.doc.removeEventListener('pointerup',listeners.up,true);listeners.doc.removeEventListener('pointercancel',listeners.up,true);}
  pointerEnd(event,phase='up'){
    const gesture=this.gesture;if(!gesture||event.pointerId!==gesture.pointerId)return;event.preventDefault?.();event.stopPropagation?.();
    if(this.pendingMove)this.flushMove();
    const synthetic=event.type==='pointercancel';
    const payload=synthetic?{...gesture.last,phase,buttons:0,pressure:0}:{...this.pointerPayload(event,phase),button:gesture.button,buttons:0,pressure:0,gesture_id:gesture.down.gesture_id};
    this.gesture=null;this.endGestureListeners();try{if(this.surface?.hasPointerCapture?.(event.pointerId))this.surface.releasePointerCapture?.(event.pointerId);}catch{}this.trySend('pointer',payload);
    // The engine delivers input to the plug-in view; once the release has been sent, re-read the frame at once.
    if(this.transport!=='webrtc'&&this.httpLoop){const loop=this.httpLoop,queue=this.inputQueue;Promise.resolve(queue?.idle()).then(()=>{if(this.httpLoop===loop)loop.refreshNow();});}
  }
  wheel(event){
    if(event.ctrlKey||!this.inputReady())return;event.preventDefault();event.stopPropagation();
    const next={...this.point(event),delta_x:Number(event.deltaX)||0,delta_y:Number(event.deltaY)||0,delta_mode:Number(event.deltaMode)||0,...modifiers(event)},queued=this.pendingScroll;
    this.pendingScroll=queued&&queued.delta_mode===next.delta_mode?{...next,delta_x:queued.delta_x+next.delta_x,delta_y:queued.delta_y+next.delta_y}:next;
    if(queued&&queued.delta_mode!==next.delta_mode)this.trySend('scroll',queued);
    this.scrollTimer??=this.setTimer(()=>{this.scrollTimer=null;const scroll=this.pendingScroll;this.pendingScroll=null;if(scroll)this.trySend('scroll',scroll);},MOVE_INTERVAL_MS);
  }
  key(event){const payload=editorKeyPayload(event);if(!payload||!this.inputReady())return;event.preventDefault();event.stopPropagation();this.trySend('type',{...payload,key:String(event.key||'')});}
  trySend(type,payload){try{return this.send(type,payload);}catch(error){this.fail(error,'input');return null;}}
  /** Input is sent only for the active subscription over the editor channel. */
  send(type,payload) {
    if(!['pointer','scroll','type'].includes(type))throw new EditorError('Unsupported native editor input.',{code:'editor_input_unsupported',stage:'input'});
    if(!this.target)throw new EditorError('The cloud plugin editor is not open.',{code:'editor_input_unavailable',stage:'input'});
    // First-party session monitor peer: while frames arrive over WebRTC and the engine has named the runtime
    // track, input goes over mozart-editor exactly like the Freestyle Studio (no per-event HTTP request).
    const channelInput=this.channelInput(type,payload);if(channelInput)return channelInput;
    // Otherwise REST (sendPluginEditorPointer / Scroll / Keys): sent once, never retried.
    if(!this.httpInput)throw new EditorError('This backend publishes no REST plug-in editor input.',{code:'editor_input_unavailable',stage:'input'});
    this.inputQueue??=new HttpInputQueue({send:(kind,payload)=>this.sendInput(kind,payload),...this.inputTimers||{},onError:error=>this.inputFailed(error),onMoveError:error=>{this.stats.failedMoves=(this.stats.failedMoves||0)+1;this.debugInfo({lastMoveError:error?.code||error?.status||'error'});}});
    const body={...payload};delete body.queued_at;delete body.pointer_id;delete body.pointer_type;this.inputQueue.push(type,body);this.stats.sentInput++;
    this.markInput();return{type:`editor.${type}`,transport:'rest',...body};
  }
  /** {type:"editor.pointer|scroll|type", track_id, plugin_index, ...payload} on the negotiated editor channel (id 100). */
  channelInput(type,payload){
    const channel=this.monitor.editor,trackId=Number(this.target?.trackId);
    if(this.transport!=='webrtc'||channel?.readyState!=='open'||!Number.isSafeInteger(trackId)||trackId<=0||this.monitor.peer?.connectionState!=='connected')return null;
    const body={type:`editor.${type}`,track_id:trackId,plugin_index:this.target.pluginIndex,...payload};delete body.queued_at;
    try{channel.send(JSON.stringify(body));}catch{return null;}
    this.stats.sentInput++;this.markInput();return{...body,transport:'webrtc'};
  }
  /** Debug-only latency probe: input sent → next frame with a new revision (data-frame-latency-ms, window.__modestyEditorLatency). */
  markInput(){
    const now=this.now();if(!this.latencyProbe)this.latencyProbe={sentAt:now,revision:this.frame?.revision??null};
    // A WebRTC channel that goes quiet after input falls back to the HTTP poll until it delivers again.
    if(this.http&&this.transport==='webrtc'&&Number.isFinite(this.quietMs)){if(this.quietTimer!=null)this.clearTimer(this.quietTimer);const frames=this.stats.frames,generation=this.generation;this.quietTimer=this.setTimer(()=>{this.quietTimer=null;if(generation===this.generation&&this.stats.frames===frames&&this.target){this.debugInfo({quietFallback:(this.debug?.quietFallback||0)+1});this.transport=null;this.startHttp(generation);}},this.quietMs);}
  }
  noteFrameLatency(frame){
    const probe=this.latencyProbe;if(!probe||!frame.revision||frame.revision===probe.revision)return;this.latencyProbe=null;
    const ms=Math.round(this.now()-probe.sentAt),samples=[...(this.latency?.samples||[]),ms].slice(-50),sorted=[...samples].sort((a,b)=>a-b);
    this.latency={last:ms,samples,p50:sorted[Math.floor((sorted.length-1)/2)],max:sorted.at(-1),transport:frame.transport};
    if(this.view){this.view.dataset.frameLatencyMs=String(ms);this.view.dataset.frameLatencyP50Ms=String(this.latency.p50);}
    try{globalThis.window&&(globalThis.window.__modestyEditorLatency={...this.latency,label:this.label,at:Date.now()});}catch{}
    emit(this,'latency',this.latency);
  }
  debugInfo(values){this.debug={...this.debug||{},...values};if(this.view)for(const [key,value] of Object.entries(values))if(value!=null&&typeof value!=='object')this.view.dataset[`debug${key[0].toUpperCase()}${key.slice(1)}`]=String(value);}
  async receiveFrame(input) {
    if(typeof input==='string'){try{this.channelState(JSON.parse(input));}catch{}return;}
    const frame=this.assembler.push(input);if(!frame)return;
    // Subscribed by lane: the engine names its numeric track in editor.state; until then match the plug-in slot.
    if(!this.target||frame.pluginIndex!==this.target.pluginIndex||Number.isSafeInteger(this.target.trackId)&&frame.trackId!==this.target.trackId){this.stats.rejectedFrames++;return;}
    // The subscription is by lane; when no editor.state text reply named the engine track, the frame's own header
    // does (first chunk: track id). Adopting it lets input use the mozart-editor channel instead of per-event HTTP.
    if(!Number.isSafeInteger(this.target.trackId)&&Number.isSafeInteger(frame.trackId)&&frame.trackId>0){this.target=Object.freeze({...this.target,trackId:frame.trackId});this.debugInfo({channelState:'frame-track'});}
    return this.presentFrame(frame,'webrtc');
  }
  async presentFrame(frame,source){
    const generation=this.generation;let sequence;
    if(source==='webrtc'){sequence=frame.sequence;if(this.latestSequence!=null&&sequence<this.latestSequence)return;this.latestSequence=sequence;
      // Pushed frames are faster and cost no HTTP request; stop the long-poll once WebRTC delivers.
      if(this.transport!=='webrtc'){this.transport='webrtc';if(this.channelTimer!=null){this.clearTimer(this.channelTimer);this.channelTimer=null;}this.stopHttp();}}
    else{if(this.transport==='webrtc')return;this.transport='http';sequence=this.httpSequence=(this.httpSequence||0)+1;this.latestSequence=sequence;}
    if(!frame.width||!frame.height){const size=await imageSize(frame.blob);if(!size)return;frame.width=size.width;frame.height=size.height;}
    const previousFrame=this.frame,reuse=previousFrame?.quality?.verdict==='usable'&&previousFrame.width===frame.width&&previousFrame.height===frame.height&&this.stats.frames%24!==0;
    const quality=reuse?{...previousFrame.quality,reused:true}:await this.analyzeFrame(frame.blob,frame);if(generation!==this.generation||sequence!==this.latestSequence||!this.target)return;
    frame.quality=quality;frame.receivedAt=Date.now();frame.transport=source;this.stats.frames++;
    // Debug only (never shown to users): which path delivered the frame and how the engine captured it.
    this.debug={...this.debug||{},transport:source,captureSource:frame.captureSource||null,revision:frame.revision||null,width:frame.width,height:frame.height,at:frame.receivedAt};if(this.view){this.view.dataset.transport=source;if(frame.captureSource)this.view.dataset.captureSource=frame.captureSource;else delete this.view.dataset.captureSource;}
    if(this.quietTimer!=null){this.clearTimer(this.quietTimer);this.quietTimer=null;}this.noteFrameLatency(frame);
    if(quality?.verdict==='undecodable'){this.stats.rejectedFrames++;this.setState('degraded',describeEditorError(new EditorError(`The original ${this.label} editor sent an image that could not be decoded.`,{code:'editor_frame_undecodable',stage:'frame'}),this.label));emit(this,'frame',frame);return;}
    const url=URL.createObjectURL(frame.blob),previous=this.imageUrl;this.imageUrl=url;this.frame=frame;
    if(this.surface){
      if(!this.image){const image=document.createElement('img');image.className='plugin-editor-frame';image.alt=`Original ${this.label} plug-in editor`;image.draggable=false;image.decoding='async';image.src=url;this.image=image;this.loading?.remove();this.loading=null;this.surface.append(image);}
      else this.image.src=url;
      this.image.width=frame.width;this.image.height=frame.height;this.fit();
    }
    if(previous)URL.revokeObjectURL(previous);
    const bad=['near-black','near-uniform','transparent'].includes(quality?.verdict);this.liveFrame=true;
    if(bad)this.setState('degraded',describeEditorError(new EditorError(`Frame rejected as ${quality.verdict} plugin editor capture.`,{code:'editor_frame_unusable',stage:'frame'}),this.label));
    else this.setState('ready',`Live · ${frame.width} × ${frame.height} · ${source==='http'?'HTTP':'WebRTC'}${quality?.verdict==='usable'?'':' · image quality not verified'}`);
    emit(this,'frame',frame);
  }
  /** Explicit status read through the published lifecycle route. */
  async status(){if(!this.lease?.target&&!this.target)throw new EditorError('No plugin editor is open.',{code:'editor_not_open',stage:'lifecycle:status'});return this.requestEditor(this.lease?.target||this.target,'status',{});}
  teardown(){
    if(this.quietTimer!=null)this.clearTimer(this.quietTimer);this.quietTimer=null;this.latencyProbe=null;
    if(this.gesture&&this.target&&this.pendingMove)this.flushMove();if(this.moveTimer!=null)this.clearTimer(this.moveTimer);if(this.scrollTimer!=null)this.clearTimer(this.scrollTimer);this.moveTimer=this.scrollTimer=null;this.pendingMove=this.pendingScroll=null;this.endGestureListeners();
    if(this.gesture&&this.target)try{this.send('pointer',{...this.gesture.last,phase:'up',buttons:0,pressure:0});}catch{}
    if(this.channelTimer!=null)this.clearTimer(this.channelTimer);this.channelTimer=null;
    this.stopHttp();this.httpReopened=false;const queue=this.inputQueue;this.inputQueue=null;this.inputDrain=queue?queue.idle().finally(()=>queue.close()):null;
    this.transport=null;this.paused=false;this.httpSequence=0;
    this.gesture=null;
    const s=this.subscription;if(s&&this.monitor.editorFrames?.readyState==='open')try{this.monitor.editorFrames.send(JSON.stringify({type:'editor.unsubscribe',lane_id:s.laneId,plugin_index:s.pluginIndex}));}catch{}
    this.subscription=null;this.subscribed=false;
    if(this.frameListener)this.monitor.removeEventListener('editorframe',this.frameListener);if(this.connectedListener)this.monitor.removeEventListener('connected',this.connectedListener);
    if(this.channel&&this.channelOpenListener)this.channel.removeEventListener?.('open',this.channelOpenListener);
    if(this.channel&&this.channelCloseListener)this.channel.removeEventListener?.('close',this.channelCloseListener);
    this.frameListener=this.stateListener=this.connectedListener=this.channelOpenListener=this.channelCloseListener=this.channel=null;
    this.resizeObserver?.disconnect();this.resizeObserver=null;this.assembler.clear();this.liveFrame=false;this.latestSequence=null;
  }
  /** Releases this caller's lease. A failed release is reported, retained and retryable; it is never shown as closed. */
  async close({verifyStatus=false}={}) {
    this.generation++;this.teardown();
    await this.opening;this.opening=null;await this.inputDrain;this.inputDrain=null;
    const lease=this.lease;this.target=null;
    if(lease?.acknowledged){
      this.setState('releasing',`Releasing the original ${this.label} editor…`);
      try{this.lastRelease={response:await this.requestEditor(lease.target,'release',{visible:false},{idempotencyKey:lease.releaseKey??=uid()}),target:lease.target};}
      catch(error){const failure=toEditorError(error,'lifecycle:release','editor_release_failed');
        this.lastError=failure;this.setState('release-failed',`Release failed: ${describeEditorError(failure,this.label)}`);emit(this,'error',failure);return{released:false,error:failure,target:lease.target};}
      this.lease=null;this.lastRelease.releasedAt=Date.now();
      // The editor status is never read after release; the release ACK is authoritative. The host may keep the
      // window open/visible in its warm mirror pool, so a status read is diagnostic only and never a warning.
      if(verifyStatus)try{this.lastRelease.status=await this.requestEditor(lease.target,'status',{});}catch(error){this.lastRelease.status={error:{code:error?.code,stage:error?.stage,status:error?.status,message:error?.message}};}
    }else this.lease=null;
    if(this.imageUrl)URL.revokeObjectURL(this.imageUrl);this.imageUrl=null;this.frame=null;this.image=null;
    if(this.state!=='closed')this.setState('closed');
    return{released:true,leased:!!lease?.acknowledged,status:this.lastRelease?.status??null,target:lease?.target??null};
  }
  /** Retries a failed release with the same idempotency key. */
  async retryRelease(){if(!this.lease?.acknowledged)return{released:true,leased:false};return this.close();}
}

async function imageSize(blob){try{if(typeof globalThis.createImageBitmap!=='function')return null;const bitmap=await globalThis.createImageBitmap(blob);const size={width:bitmap.width,height:bitmap.height};bitmap.close?.();return size;}catch{return null;}}

/** Key mapping. */
export function editorKeyPayload(event){
  const key=String(event?.key||''),mods=modifiers(event);
  if(Object.hasOwn(keycodes,key))return{keycode:keycodes[key],...mods};
  if(key.length===1&&(event?.metaKey||event?.ctrlKey)){const code=characterCodes[key.toLowerCase()];return Number.isInteger(code)?{text:key,keycode:code,...mods}:null;}
  return key.length===1?{text:key,...mods}:null;
}
