/** FL plugin window "GUI" view: the real plugin editor, mirrored from the cloud
 * engine over Studio API v1 REST and driven by forwarded pointer/wheel/keys.
 *
 * Follows the Freestyle Studio's hosted editor component: mirror-open once, a single in-flight
 * frame request at a time, normalized pointer coordinates against the drawn
 * image rect (clamped 0..1), one crypto.randomUUID gesture_id per drag, moves
 * coalesced latest-wins with one in flight, the final up always sent (also on
 * pointercancel/lostpointercapture), wheel deltas merged while one scroll is in
 * flight, ctrl+wheel left to the browser, an immediate frame refresh after
 * input then an 83 ms cadence for a 1.5 s "active" window, a quiet 2.5 s cadence after 3 unchanged
 * frames, and release (not close) when the view goes away.
 *
 * REST differences from the realtime-channel path: frames are long-polled with
 * if_revision + wait_ms (<= 500), moves are throttled to 20/s (the spec asks for
 * <= ~20/s and the input bucket is 1800/min), keys use the documented
 * JUCE/ASCII codes, and input is never retried.
 *
 * Round 13 editor mirror contract: frames come from the slot's own instance
 * (X-Editor-Plugin-Instance-Id is checked), up/scroll/type are confirmed by
 * effect (200 ok:false code input_unconfirmed shows a subtle "Not applied"
 * mark and is never resent), and 409 editor_not_open reopens the editor once,
 * dropping every queued input that was not confirmed. Input → visible-frame
 * latency is measured per window (latencyStats()).
 */
import {StudioApiClient} from './studio-api-client.js';
import {clientLog} from './client-diagnostics.js';
import {hostFetch} from './freestyle-host-transport.js';

export const PLUGIN_GUI_OPERATIONS=Object.freeze(['openPluginEditor','getPluginEditorFrame','sendPluginEditorPointer','sendPluginEditorScroll','sendPluginEditorKeys','releasePluginEditor']);
export function pluginGuiSupported(operations){const set=operations instanceof Set?operations:new Set(Array.isArray(operations)?operations:Object.keys(operations||{}));return PLUGIN_GUI_OPERATIONS.every(operation=>set.has(operation));}

/** Silent-ignore guard: evidence window after pointer-up of the first channel-routed gesture. */
export const CHANNEL_VERIFY_MS=700;
const clone=value=>structuredClone(value);
export const PLUGIN_GUI_TIMING=Object.freeze({waitMs:500,moveIntervalMs:50,activeWindowMs:1500,activeGapMs:83,idleGapMs:250,quietGapMs:2500,quietAfter:3,maxFailures:6,frameLogEveryMs:5000,maxFrameRequests:2,maxMovesInFlight:4,staleRetries:6,staleRetryMs:200,staleRetryMaxMs:2000});
/** QA19: a fresh frame marked X-Editor-Frame-Stale: 1 is re-requested with backoff (200 ms … 2 s, about 7 s in all). */
export const staleRetryDelay=attempt=>Math.min(PLUGIN_GUI_TIMING.staleRetryMaxMs,PLUGIN_GUI_TIMING.staleRetryMs*2**Math.max(0,attempt));
const MIN_WIDTH=64,MAX_WIDTH=1280,DEFAULT_WIDTH=640;
// Documented sendPluginEditorKeys codes (JUCE/ASCII). Other named keys are
// swallowed rather than guessed so the studio's shortcuts still stay quiet.
const KEYCODES=Object.freeze({Enter:13,Escape:27,Backspace:8,Tab:9,Delete:127});
const BROWSER_COMBOS=new Set(['w','t','n','q','r','l']);
const clamp01=value=>{const number=Number(value);return Number.isFinite(number)?Math.max(0,Math.min(1,number)):0;};
const clampDelta=value=>{const number=Number(value);return Number.isFinite(number)?Math.max(-10000,Math.min(10000,number)):0;};
const modifiers=event=>({shift_key:!!event?.shiftKey,ctrl_key:!!event?.ctrlKey,alt_key:!!event?.altKey,meta_key:!!event?.metaKey});
const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
const gestureId=()=>{try{if(typeof globalThis.crypto?.randomUUID==='function')return globalThis.crypto.randomUUID();}catch{}return`g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;};

/** Pure pointer mapping: client coordinates → 0..1 of the drawn image rect. */
export function normalizedEditorPoint(rect,clientX,clientY){
 const width=Number(rect?.width),height=Number(rect?.height);
 if(!(width>0)||!(height>0)||!Number.isFinite(Number(clientX))||!Number.isFinite(Number(clientY)))return null;
 return{x_norm:clamp01((Number(clientX)-(Number(rect.left)||0))/width),y_norm:clamp01((Number(clientY)-(Number(rect.top)||0))/height)};
}
/** sendPluginEditorKeys body for one keydown, or null when nothing is sent. */
export function editorKeyPayload(event){
 const key=String(event?.key||''),mods=modifiers(event);
 if(Object.hasOwn(KEYCODES,key))return{keycode:KEYCODES[key],...mods};
 if([...key].length!==1)return null;
 if(event.ctrlKey||event.metaKey){const code=key.toLowerCase().codePointAt(0);return code<128?{keycode:code,...mods}:null;}
 return{text:key,...mods};
}
export const pluginGuiNotOpen=error=>error?.status===409&&error.code==='editor_not_open'||error?.status===400&&error.code==='engine_invalid_arguments';
/** 200 ok:false input outcomes: delivered/unconfirmed, never a reason to resend. */
export const PLUGIN_GUI_SCROLL_IDLE_MS=400;
export const PLUGIN_GUI_NOT_APPLIED_CODES=Object.freeze(['input_unconfirmed','not_hit_testable','no_editor_view','input_not_applied']);
const percentile=(sorted,p)=>sorted.length?sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1))]:null;
/** Summary of input → visible-frame samples (ms). */
export function latencySummary(samples){
 const values=(Array.isArray(samples)?samples:[]).map(Number).filter(Number.isFinite),sorted=[...values].sort((a,b)=>a-b);
 return{count:values.length,last:values.length?values.at(-1):null,min:sorted[0]??null,p50:percentile(sorted,.5),p95:percentile(sorted,.95),max:sorted.at(-1)??null};
}
/**
 * Parameter-list sync after GUI input: debounced, one read in flight, reads the
 * loaded typed parameter page again so the list shows what the drag changed.
 * `read()` performs the guarded read; `repaint()` redraws the list.
 */
export function createGuiParameterSync({read,repaint=()=>{},canRead=()=>true,delayMs=150,setTimer=(callback,ms)=>setTimeout(callback,ms),clearTimer=id=>clearTimeout(id),log=()=>{}}={}){
 let timer=null,running=null,again=false,closed=false,reads=0;
 const run=async()=>{
  timer=null;if(closed)return;if(running){again=true;return;}
  if(!canRead()){again=false;return;}
  again=false;const started=Date.now();
  running=(async()=>{try{await read();reads++;log('plugin-gui-param-sync',{outcome:'ok',ms:Date.now()-started});}catch(error){log('plugin-gui-param-sync',{outcome:'error',code:error?.code??null,message:String(error?.message||'').slice(0,160)});}finally{try{repaint();}catch{}}})();
  try{await running;}finally{running=null;}if(again&&!closed)schedule();
 };
 const schedule=()=>{if(closed)return;if(timer!==null)clearTimer(timer);timer=setTimer(()=>{run();},delayMs);};
 return{schedule,get reads(){return reads;},get pending(){return timer!==null||!!running;},close(){closed=true;if(timer!==null)clearTimer(timer);timer=null;}};
}

async function responseError(response,fallback){
 let data=null;try{data=await response.json();}catch{}
 const detail=data?.error&&typeof data.error==='object'?data.error:{},code=text(detail.code)||text(data?.error)||text(data?.code);
 return Object.assign(new Error(text(detail.message)||text(data?.message)||fallback||`Freestyle returned HTTP ${response.status}.`),{status:response.status,code,details:detail.details??null,currentInstanceId:detail.currentInstanceId??detail.details?.currentInstanceId??null,currentPluginType:detail.currentPluginType??detail.details?.currentPluginType??null,retryAfter:response.headers?.get?.('retry-after')??null});
}

// The API admits at most two concurrent frame requests per user; extra plugin
// windows wait for a slot instead of collecting 429s. Slots are handed over.
const frameSlots={active:0,waiters:[]};
function acquireFrameSlot(){if(frameSlots.active<PLUGIN_GUI_TIMING.maxFrameRequests){frameSlots.active++;return Promise.resolve();}return new Promise(resolve=>frameSlots.waiters.push(resolve));}
function releaseFrameSlot(){const next=frameSlots.waiters.shift();if(next)next();else frameSlots.active=Math.max(0,frameSlots.active-1);}

// releasePluginEditor drops this *caller's* hold on a slot, so two windows on
// the same slot would share one hold. Like the WebRTC mirror's one-owner rule,
// a new window waits for the previous owner's release and displaces it; an
// unconfirmed release blocks further opens of that slot.
const owners=new Map();
export const PLUGIN_GUI_CLEANUP_MESSAGE='The previous plugin GUI release is unconfirmed. Inspect it before opening another GUI for this plugin.';
const slotKey=target=>JSON.stringify([target.projectId,target.laneId??`bus:${target.busId}`,target.pluginIndex]);
/** The bus twin of a lane editor operation (openPluginEditor → openBusPluginEditor, …) for a bus target. */
export function busEditorOperation(operationId,target){return target?.busId&&/PluginEditor/.test(operationId)?operationId.replace('PluginEditor','BusPluginEditor'):operationId;}
export const BUS_PLUGIN_GUI_OPERATIONS=Object.freeze(PLUGIN_GUI_OPERATIONS.map(id=>busEditorOperation(id,{busId:'master'})));
function slotOwner(key){let entry=owners.get(key);if(!entry){entry={owner:null,tail:Promise.resolve(),blocked:false};owners.set(key,entry);}return entry;}

export class PluginGuiView{
 constructor({target,guard=()=>{},client=new StudioApiClient(),fetch:fetchImpl=(...args)=>hostFetch(...args),isVisible=()=>true,onMismatch=null,onTargetMissing=null,onStateChange=()=>{},onParametersChanged=null,onGestureStart=null,onGestureEnd=null,whenIdle=null,frameStream=null,onLatency=null,log=clientLog,now=()=>Date.now(),setTimer=(callback,ms)=>setTimeout(callback,ms),clearTimer=id=>clearTimeout(id),createUrl=blob=>URL.createObjectURL(blob),revokeUrl=url=>URL.revokeObjectURL(url),pixelRatio=()=>globalThis.devicePixelRatio||1,requestFrame=null,document:doc=globalThis.document}={}){
  // Moves are coalesced to the latest position once per animation frame.
  this.requestFrame=typeof requestFrame==='function'?requestFrame:typeof globalThis.requestAnimationFrame==='function'?callback=>globalThis.requestAnimationFrame(callback):callback=>this.setTimer(callback,16);
  // A lane slot (laneId) or, since issue #3, a master/bus slot (busId: the bus editor routes, REST frames only).
  if(!text(target?.projectId)||!text(target?.laneId)&&!text(target?.busId)||!Number.isSafeInteger(target?.pluginIndex)||target.pluginIndex<0)throw new Error('Select a loaded lane plugin to open its GUI.');
  this.target=Object.freeze({projectId:target.projectId,laneId:text(target.laneId)?target.laneId:null,busId:text(target.laneId)?null:target.busId,pluginIndex:target.pluginIndex,instanceId:text(target.instanceId),pluginType:text(target.pluginType),trackId:text(target.trackId)});
  if(this.target.busId)frameStream=null; // the mozart-editor-frames stream addresses lane slots only
  // onGestureStart/onGestureEnd bracket one undoable GUI gesture (a pointer drag, one scroll burst).
  // whenIdle: input waits (queued, in order) while a history step or other cloud edit runs, instead of failing the view.
  // frameStream (339): pushed frames over the monitor peer's mozart-editor-frames channel
  // (editor-frame-stream.js) when it is up; REST frame polling otherwise and as the fallback.
  Object.assign(this,{guard,client,fetch:fetchImpl,isVisible,onMismatch,onTargetMissing,onStateChange,onParametersChanged,onGestureStart,onGestureEnd,whenIdle,frameStream,onLatency,log,now,setTimer,clearTimer,createUrl,revokeUrl,pixelRatio,document:doc});
  this.state='idle';this.revision=null;this.imageUrl=null;this.displayedUrl=null;this.frameSize=null;this.timer=null;this.inflight=false;this.again=false;this.paused=false;this.stopped=false;this.closed=false;this.released=false;
  this.openDispatched=false;this.openPromise=null;this.notOpenRetried=false;this.failures=0;this.throttles=0;this.unchanged=0;this.activeUntil=0;this.gesture=null;this.pendingScroll=null;this.scrollInFlight=false;this.inputChain=Promise.resolve();this.abort=null;this.closePromise=null;
  this.frameStats={frames:0,unchanged:0,bytes:0,ms:0,lastLogAt:-Infinity,logged:0};
  // inputEpoch: bumped on editor_not_open so queued, unconfirmed input is dropped, never resent.
  this.inputEpoch=0;this.notApplied=null;this.notAppliedTimer=null;this.latency={samples:[],probe:null};
 }
 /** Redraw now: after a parameter write elsewhere (typed list, Undo/Redo, native knob view,
  * automation). `fresh`: the next frame is fetched without if_revision, so it is a new
  * capture (the host redraws the editor before each capture) rather than a 304. */
 refresh({fresh=false}={}){if(this.closed||this.stopped)return;if(fresh)this.staleRetries=PLUGIN_GUI_TIMING.staleRetries;if(this.streaming){if(fresh){this.resubscribe();this.freshWhileStreaming();}return;}if(fresh)this.forceFresh=true;this.wake();}
 /** QA19: the stream pushes only CHANGED pixels, and a parameter write that does
  * not repaint the editor (setLanePluginParameter, Undo/Redo, automation) leaves
  * it on the old image. Fetch one fresh REST capture beside the stream, retrying
  * (bounded) while Freestyle marks it X-Editor-Frame-Stale: 1. */
 freshWhileStreaming(){
  if(this.freshRun){this.freshAgain=true;return this.freshRun;}
  this.freshRun=(async()=>{try{for(;;){
   this.freshAgain=false;this.forceFresh=true;
   try{await this.fetchFrame();}catch(error){this.forceFresh=false;this.logEvent('plugin-gui-frame',{event:'fresh_failed',source:'rest',code:error?.code??null,status:error?.status??null});return;}
   if(this.closed||this.stopped||!this.streaming)return;if(this.freshAgain)continue;if(this.staleRetry==null)return;
   await new Promise(resolve=>this.setTimer(resolve,this.staleRetry));if(this.closed||this.stopped||!this.streaming)return;
  }}finally{this.freshRun=null;}})();
  return this.freshRun;
 }
 /** Pushed frames (339). Resolves true when the subscription is up; any later
  * stream error or a lost channel falls back to REST polling. */
 async startStream(){
  const stream=this.frameStream;if(!stream||this.closed||this.stopped||typeof stream.available!=='function'||!stream.available())return false;
  let ok=false;try{ok=await stream.subscribe({laneId:this.target.laneId,pluginIndex:this.target.pluginIndex,maxWidth:this.maxWidth()},{onFrame:frame=>this.streamFrame(frame),onState:state=>this.streamState(state)});}catch{ok=false;}
  if(!ok||this.closed){if(ok)stream.unsubscribe();return false;}
  this.streaming=true;this.streamFrames=0;this.logEvent('plugin-gui-frame',{event:'stream',source:'stream'});
  // Watch the channel: a closed peer/channel is not an error frame, so check it.
  // No first frame within ~2 s (e.g. the engine never answered) also falls back.
  const watch=()=>{this.streamWatch=null;if(!this.streaming||this.closed)return;if(!stream.available()){this.stopStream('channel_closed');return;}if(!this.streamFrames){this.stopStream('no_first_frame');return;}this.streamWatch=this.setTimer(watch,2000);};this.streamWatch=this.setTimer(watch,2000);
  return true;
 }
 resubscribe(){const stream=this.frameStream;if(!this.streaming||!stream)return;stream.subscribe({laneId:this.target.laneId,pluginIndex:this.target.pluginIndex,maxWidth:this.maxWidth()},{onFrame:frame=>this.streamFrame(frame),onState:state=>this.streamState(state)}).then(ok=>{if(!ok)this.stopStream('resubscribe_failed');},()=>this.stopStream('resubscribe_failed'));}
 stopStream(reason){
  if(!this.streaming)return;this.streaming=false;if(this.streamWatch!=null){this.clearTimer(this.streamWatch);this.streamWatch=null;}
  try{this.frameStream?.unsubscribe();}catch{}this.logEvent('plugin-gui-frame',{event:'stream_stopped',source:'stream',reason,frames:this.streamFrames||0});
  if(!this.closed&&!this.stopped)this.schedule(0);
 }
 streamFrame(frame){
  if(!this.streaming||this.closed||!frame?.blob?.size)return;
  this.revision=frame.revision||this.revision;if(frame.width>0&&frame.height>0)this.frameSize={width:frame.width,height:frame.height};
  this.paint(frame.blob);this.unchanged=0;this.frameOk();this.channelEvidence();this.streamFrames=(this.streamFrames||0)+1;
  this.sampleFrame({status:200,source:'stream',ms:0,bytes:frame.blob.size,width:this.frameSize?.width??null,height:this.frameSize?.height??null});
 }
 // editor_not_open / capture_timeout etc.: the engine keeps retrying, but the view
 // does not wait on it: REST polling (which can reopen the editor) takes over.
 streamState(state){if(state?.state==='error')this.stopStream(String(state.code||'stream_error'));}
 latencyStats(){return latencySummary(this.latency.samples);}
 /** Scope guard (project/dialog still current). Release deliberately skips it. */
 checkScope(stage){try{this.guard();return true;}catch(error){this.fail(error,stage);return false;}}
 path(){return this.target.busId?{project_id:this.target.projectId,bus_id:this.target.busId,plugin_index:this.target.pluginIndex}:{project_id:this.target.projectId,lane_id:this.target.laneId,plugin_index:this.target.pluginIndex};}
 scopeBody(){return this.target.trackId?{track_id:this.target.trackId}:{};}
 logEvent(kind,data){try{this.log(kind,{laneId:this.target.laneId,pluginIndex:this.target.pluginIndex,...data});}catch{}}
 setState(state,message=''){this.state=state;if(this.status)this.status.textContent=message;if(this.surface)this.surface.dataset.state=state;try{this.onStateChange({state,message});}catch{}}
 /** One documented operation through the same-origin OAuth proxy. Generated
  * client validation runs first; writes get a fresh Idempotency-Key and are
  * never resent by this view. */
 request(operationId,{query,body,signal}={}){
  const prepared=this.client.prepare(busEditorOperation(operationId,this.target),{path:this.path(),...(query?{query}:{}),...(body!==undefined?{body}:{})});
  return this.fetch('/api/studio',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(prepared),...(signal?{signal}:{})});
 }
 mount(container){
  const doc=container?.ownerDocument||this.document;this.container=container;
  const surface=doc.createElement('div');surface.className='plugin-gui-surface';surface.tabIndex=0;surface.setAttribute('role','application');surface.setAttribute('aria-label','Plugin editor');surface.style.cssText='position:relative;outline:none;max-width:100%';
  const status=doc.createElement('div');status.className='plugin-gui-status remote-plugin-status';status.setAttribute('role','status');status.style.cssText='padding:6px 8px;color:#bbc5c4;font:12px Arial';
  const image=doc.createElement('img');image.className='plugin-gui-frame';image.alt='Live cloud plugin editor';image.draggable=false;image.hidden=true;image.style.cssText='display:block;max-width:100%;height:auto;touch-action:none;user-select:none;-webkit-user-drag:none;cursor:default';
  surface.append(image);container.replaceChildren(status,surface);Object.assign(this,{surface,status,image});
  const on=(element,type,handler,options)=>{element.addEventListener(type,handler,options);(this.listeners??=[]).push(()=>element.removeEventListener(type,handler,options));};
  on(image,'pointerdown',event=>this.pointerDown(event));on(image,'pointermove',event=>this.pointerMove(event));
  on(image,'pointerup',event=>this.pointerEnd(event,false));on(image,'pointercancel',event=>this.pointerEnd(event,true));on(image,'lostpointercapture',event=>this.pointerEnd(event,true));
  on(image,'wheel',event=>this.wheel(event),{passive:false});
  const swallow=event=>{event.preventDefault();event.stopPropagation();};on(image,'contextmenu',swallow);on(image,'auxclick',swallow);on(image,'dragstart',swallow);
  on(image,'load',()=>this.frameLoaded());
  on(surface,'keydown',event=>this.keyDown(event));on(surface,'keyup',event=>{if(!event.isComposing)event.stopPropagation();});
  if(doc?.addEventListener)on(doc,'visibilitychange',()=>this.resume());
  this.setState('idle','Opening the cloud plugin editor…');return surface;
 }
 /** editor:open, then the frame loop. Rejects when the editor cannot open. */
 async open(){
  if(this.closed)throw new Error('This plugin GUI view is closed.');
  this.setState('opening','Opening the cloud plugin editor…');
  const entry=slotOwner(slotKey(this.target)),claim=entry.tail.then(async()=>{
   if(entry.blocked)throw Object.assign(new Error(PLUGIN_GUI_CLEANUP_MESSAGE),{code:'editor_ownership_cleanup_failed'});
   const previous=entry.owner;
   if(previous&&previous!==this){await previous.close();previous.setState('displaced','Another plugin window opened this editor. Reopen it here to continue.');if(entry.blocked)throw Object.assign(new Error(PLUGIN_GUI_CLEANUP_MESSAGE),{code:'editor_ownership_cleanup_failed'});}
   if(this.closed)return false;entry.owner=this;return true;
  });
  entry.tail=claim.catch(()=>{});
  try{if(!await claim)return false;}catch(error){this.ownershipBlocked=error.code==='editor_ownership_cleanup_failed';this.fail(error,'ownership');throw error;}
  try{await this.openEditor();}catch(error){this.fail(error,'open');throw error;}
  if(this.closed)return false;
  this.setState('waiting','Waiting for the plugin editor image…');
  // Pushed frames when the peer is up (no HTTP round trip per frame); the REST long-poll otherwise.
  if(await this.startStream())return true;
  this.schedule(0);return true;
 }
 openEditor(){
  if(this.openPromise)return this.openPromise;
  const started=this.now();this.openDispatched=true;
  const pending=(async()=>{
   const response=await this.request('openPluginEditor',{body:this.scopeBody()});
   if(!response.ok)throw await responseError(response,'Freestyle could not open the plugin editor.');
   let data=null;try{data=await response.json();}catch{}
   if(data?.ok===false||data?.error)throw Object.assign(new Error(text(data?.error?.message)||text(data?.message)||'Freestyle could not open the plugin editor.'),{status:response.status,code:text(data?.error?.code)||text(data?.code)});
   this.logEvent('plugin-gui-frame',{event:'open',ms:this.now()-started});return data;
  })();
  this.openPromise=pending;const clear=()=>{if(this.openPromise===pending)this.openPromise=null;};pending.then(clear,clear);return pending;
 }
 maxWidth(){
  const css=Number(this.container?.clientWidth)||Number(this.surface?.clientWidth)||DEFAULT_WIDTH,ratio=Math.max(1,Number(this.pixelRatio())||1);
  return Math.max(MIN_WIDTH,Math.min(MAX_WIDTH,Math.ceil(css*ratio)));
 }
 active(){return !!this.gesture||this.now()<this.activeUntil;}
 gap(){return this.active()?PLUGIN_GUI_TIMING.activeGapMs:this.unchanged>=PLUGIN_GUI_TIMING.quietAfter?PLUGIN_GUI_TIMING.quietGapMs:PLUGIN_GUI_TIMING.idleGapMs;}
 schedule(delay){
  if(this.closed||this.stopped)return;
  if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}
  if(this.inflight){if(delay<=0)this.again=true;return;}
  if(delay<=0){this.poll();return;}
  this.timer=this.setTimer(()=>{this.timer=null;this.poll();},delay);
 }
 /** Poll now (after input, a tab switch or the page becoming visible). */
 wake(){this.activeUntil=this.now()+PLUGIN_GUI_TIMING.activeWindowMs;this.schedule(0);}
 resume(){if(this.paused&&!this.closed&&!this.stopped&&this.safeVisible())this.schedule(0);}
 safeVisible(){try{return this.isVisible()!==false;}catch{return false;}}
 async poll(){
  if(this.closed||this.stopped||this.inflight||this.streaming)return;
  if(!this.safeVisible()){this.paused=true;return;}
  if(!this.checkScope('scope'))return;
  this.paused=false;this.inflight=true;this.again=false;let delay=null;
  try{delay=await this.fetchFrame();}catch(error){delay=await this.frameError(error);}finally{this.inflight=false;}
  if(this.closed||this.stopped||delay===null)return;
  this.schedule(this.again?0:delay);
 }
 async fetchFrame(){
  await acquireFrameSlot();
  try{
   if(this.closed||this.stopped)return null;
   const query={max_width:this.maxWidth()};
   if(this.revision&&!this.forceFresh){query.if_revision=this.revision;query.wait_ms=PLUGIN_GUI_TIMING.waitMs;}
   this.forceFresh=false;
   if(this.target.instanceId)query.expected_plugin_instance_id=this.target.instanceId;
   const started=this.now(),controller=typeof AbortController==='function'?new AbortController():null;this.abort=controller;
   const response=await this.request('getPluginEditorFrame',{query,signal:controller?.signal});
   if(this.closed)return null;
   if(response.status===304){this.unchanged++;this.frameOk();this.sampleFrame({status:304,ms:this.now()-started,bytes:0});return this.gap();}
   if(response.status!==200)throw await responseError(response,'The plugin editor frame could not be read.');
   const type=String(response.headers?.get?.('content-type')||'').split(';')[0].trim().toLowerCase();
   if(!type.startsWith('image/'))throw Object.assign(new Error('Freestyle returned a plugin frame that is not an image.'),{status:502,code:'invalid_frame'});
   const blob=await response.blob();if(this.closed)return null;
   if(!blob?.size)throw Object.assign(new Error('The plugin editor returned an empty image.'),{status:502,code:'invalid_frame'});
   const header=name=>response.headers?.get?.(name)??null,width=Number(header('x-editor-width')),height=Number(header('x-editor-height'));
   // Frames come from the slot's own instance: a frame of another instance is never shown.
   const frameInstance=text(header('x-editor-plugin-instance-id'));
   if(frameInstance&&this.target.instanceId&&frameInstance!==this.target.instanceId)throw Object.assign(new Error('Freestyle returned another plugin instance’s editor frame.'),{status:409,code:'plugin_instance_mismatch',currentInstanceId:frameInstance,currentPluginType:text(header('x-editor-plugin-type'))});
   // QA19: X-Editor-Frame-Stale: 1 = the host could not capture a fresh image. After
   // a parameter write the next request asks for a fresh capture again (bounded).
   const stale=String(header('x-editor-frame-stale')??'')==='1',fresh=!query.if_revision;this.staleRetry=null;
   if(stale&&fresh&&this.staleRetries>0){this.staleRetries--;this.forceFresh=true;this.staleRetry=staleRetryDelay(PLUGIN_GUI_TIMING.staleRetries-this.staleRetries-1);this.logEvent('plugin-gui-frame',{event:'stale_retry',source:'rest',left:this.staleRetries,delayMs:this.staleRetry,streaming:!!this.streaming});}
   else if(!stale&&fresh)this.staleRetries=0;
   // A stale REST image never replaces pushed stream pixels.
   if(stale&&this.streaming){this.frameOk();return this.staleRetry??this.gap();}
   this.revision=text(header('x-editor-revision'))||text(header('etag'))||null;
   this.frameSize=width>0&&height>0?{width,height}:this.frameSize;
   this.paint(blob);this.unchanged=0;this.frameOk();
   this.sampleFrame({status:200,ms:this.now()-started,bytes:blob.size,width:this.frameSize?.width??null,height:this.frameSize?.height??null,maxWidth:query.max_width,...stale?{stale:true}:{},...this.streaming?{source:'rest_fresh'}:{}});
   return this.staleRetry??this.gap();
  }finally{this.abort=null;releaseFrameSlot();}
 }
 frameOk(){this.failures=0;this.throttles=0;this.notOpenRetried=false;if(this.imageUrl&&this.state!=='ready')this.setState('ready',this.readyMessage());}
 readyMessage(){return this.frameSize?`${this.frameSize.width} × ${this.frameSize.height} · Live cloud plugin`:'Live cloud plugin';}
 paint(blob){
  const url=this.createUrl(blob),superseded=this.imageUrl&&this.imageUrl!==this.displayedUrl?this.imageUrl:null;
  this.imageUrl=url;if(this.image){this.image.src=url;this.image.hidden=false;if(this.frameSize){this.image.dataset.editorWidth=String(this.frameSize.width);this.image.dataset.editorHeight=String(this.frameSize.height);}}
  // Keep the displayed frame until its replacement has loaded; a frame that
  // never displayed is superseded immediately.
  if(superseded)this.revokeUrl(superseded);
  // A changed frame after input resolves the latency probe's arrival; display completes it on load.
  const probe=this.latency.probe;if(probe&&!probe.frameAt&&this.revision!==probe.revision){probe.frameAt=this.now();probe.url=url;}
  if(this.state!=='ready')this.setState('ready',this.readyMessage());
 }
 frameLoaded(){const loaded=this.imageUrl;if(this.displayedUrl&&this.displayedUrl!==loaded)this.revokeUrl(this.displayedUrl);this.displayedUrl=loaded;const probe=this.latency.probe;if(probe?.frameAt&&probe.url===loaded)this.completeLatency(probe);}
 /** Input → visible frame: from the first input not yet reflected to the display of the next changed frame. */
 startLatency(kind,phase){if(this.latency.probe||this.closed)return;this.latency.probe={at:this.now(),revision:this.revision,kind,phase:phase??null,frameAt:null,url:null};}
 completeLatency(probe){
  if(this.latency.probe!==probe)return;this.latency.probe=null;const visibleMs=this.now()-probe.at,frameMs=probe.frameAt-probe.at,samples=this.latency.samples;samples.push(visibleMs);if(samples.length>50)samples.shift();
  if(this.image)this.image.dataset.latencyMs=String(Math.round(visibleMs));
  // source: 'stream' (pushed over the peer) or 'rest' (polled), so QA can compare both paths in the client log.
  const entry={kind:probe.kind,phase:probe.phase,frameMs,visibleMs,source:this.streaming?'stream':'rest',inputRoute:this.lastInputRoute??null,...this.latencyStats()};this.logEvent('plugin-gui-latency',entry);try{this.onLatency?.(entry);}catch{}
 }
 sampleFrame(entry){
  const stats=this.frameStats,time=this.now();stats.frames+=entry.status===200?1:0;stats.unchanged+=entry.status===304?1:0;stats.bytes+=entry.bytes||0;stats.ms+=entry.ms||0;
  const first=entry.status===200&&!stats.logged;
  if(!first&&time-stats.lastLogAt<PLUGIN_GUI_TIMING.frameLogEveryMs)return;
  const requests=stats.frames+stats.unchanged;
  this.logEvent('plugin-gui-frame',{...entry,first,framesSinceLog:stats.frames,unchangedSinceLog:stats.unchanged,bytesSinceLog:stats.bytes,avgMs:requests?Math.round(stats.ms/requests):null});
  Object.assign(stats,{frames:0,unchanged:0,bytes:0,ms:0,lastLogAt:time,logged:stats.logged+1});
 }
 /** Returns the next poll delay, or null to stop the loop. */
 async frameError(error){
  if(this.closed)return null;
  if(error?.name==='AbortError')return null;
  if(pluginGuiNotOpen(error)){
   if(this.notOpenRetried){this.fail(error,'frame');return null;}
   // Known quirk: no editor open → 409 editor_not_open or 400
   // engine_invalid_arguments. Open it, then retry the frame once.
   this.notOpenRetried=true;this.logEvent('plugin-gui-error',{stage:'frame',status:error.status,code:error.code,recovery:'reopen'});
   try{await this.openEditor();}catch(openError){this.fail(openError,'reopen');return null;}
   return this.closed?null:0;
  }
  // The engine answers 409 target_not_loaded for a slot whose instance is gone: stop polling and let the owner re-read the chain.
  if(error?.status===409&&error.code==='target_not_loaded'){this.fail(error,'frame','Checking whether this plugin is still in its chain…');try{this.onTargetMissing?.(error);}catch{}return null;}
  if(error?.status===409&&error.code==='plugin_instance_mismatch'){this.fail(error,'frame',`This plugin slot now holds a different plugin${error.currentPluginType?` (${error.currentPluginType})`:''}. Reopen it from the mixer.`);try{this.onMismatch?.(error);}catch{}return null;}
  if(error?.status===429){
   const retry=Number(error.retryAfter),delay=Number.isFinite(retry)&&retry>0?Math.min(30000,retry*1000):Math.round(Math.min(8000,500*2**this.throttles++)*(.75+Math.random()*.5));
   this.logEvent('plugin-gui-error',{stage:'frame',status:429,code:error.code,backoffMs:delay});this.setState('throttled','Freestyle is rate limiting plugin frames · retrying shortly…');return delay;
  }
  const transient=!error?.status||error.status>=500||error.status===408;
  if(!transient||++this.failures>=PLUGIN_GUI_TIMING.maxFailures){this.fail(error,'frame');return null;}
  this.logEvent('plugin-gui-error',{stage:'frame',status:error?.status??null,code:error?.code??null,failures:this.failures,message:String(error?.message||'').slice(0,160)});
  return Math.round(Math.min(8000,500*2**(this.failures-1))*(.75+Math.random()*.5));
 }
 fail(error,stage,message){
  this.stopped=true;if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}
  this.logEvent('plugin-gui-error',{stage,status:error?.status??null,code:error?.code??null,fatal:true,message:String(error?.message||'').slice(0,200)});
  if(!this.closed)this.setState('error',message||String(error?.message||'The cloud plugin editor is unavailable.'));
 }
 canInput(){return !this.closed&&!this.stopped&&!this.released&&!!this.imageUrl&&!!this.image;}
 point(event){return normalizedEditorPoint(this.image?.getBoundingClientRect?.(),event?.clientX,event?.clientY);}
 pointerDown(event){
  if(!this.canInput()){this.logEvent('plugin-gui-input',{phase:'down',outcome:'dropped',reason:this.closed?'closed':this.stopped?'stopped':'no-frame'});return;}
  event.preventDefault();event.stopPropagation();this.surface?.focus?.({preventScroll:true});
  if(this.gesture)return;const point=this.point(event);if(!point)return;
  try{this.image.setPointerCapture?.(event.pointerId);}catch{}
  const button=Number.isInteger(event.button)?Math.max(-1,Math.min(4,event.button)):0,gesture={revisionAtDown:this.revision,id:gestureId(),pointerId:event.pointerId,button,buttons:Math.max(0,Math.min(31,Number(event.buttons)||0)),last:point,pending:null,inFlight:0,frame:false,timer:null,lastMoveAt:-Infinity,moves:0,coalesced:0,startedAt:this.now(),downTask:null};
  this.gesture=gesture;this.activeUntil=this.now()+PLUGIN_GUI_TIMING.activeWindowMs;
  // The undo capture starts before the down goes out; it never delays the input.
  this.gestureHook('start',{kind:'pointer',id:gesture.id});
  // Moves gate on the down only (never on each other), so the engine sees down → moves → up.
  gesture.downTask=this.sendInput('pointer',{phase:'down',...point,gesture_id:gesture.id,button,buttons:gesture.buttons,...this.pressure(event),...modifiers(event)}).then(()=>{},()=>{});
 }
 pressure(event){const value=Number(event?.pressure);return Number.isFinite(value)&&value>0?{pressure:Math.min(1,value)}:{};}
 pointerMove(event){
  const gesture=this.gesture;if(!gesture||event.pointerId!==gesture.pointerId)return;
  event.preventDefault();if(gesture.lost)return;const point=this.point(event);if(!point)return;
  gesture.last=point;if(gesture.pending)gesture.coalesced++;
  gesture.pending={phase:'move',...point,gesture_id:gesture.id,button:gesture.button,buttons:Math.max(0,Math.min(31,Number(event.buttons)||gesture.buttons)),...this.pressure(event),...modifiers(event)};
  this.activeUntil=this.now()+PLUGIN_GUI_TIMING.activeWindowMs;
  if(!gesture.frame){gesture.frame=true;this.requestFrame(()=>{gesture.frame=false;if(this.gesture===gesture)this.pumpMoves();});}
 }
 /** QA19: latest-wins move coalescing per animation frame, at most 20/s (the
  * documented rate). Moves stream without awaiting each other's REST reply
  * (bounded in flight); the up still follows every move. */
 pumpMoves(){
  const gesture=this.gesture;if(!gesture||!gesture.pending||gesture.inFlight>=PLUGIN_GUI_TIMING.maxMovesInFlight||gesture.timer!==null)return;
  const wait=gesture.lastMoveAt+PLUGIN_GUI_TIMING.moveIntervalMs-this.now();
  if(wait>0){gesture.timer=this.setTimer(()=>{gesture.timer=null;if(this.gesture===gesture)this.pumpMoves();},wait);return;}
  const body=gesture.pending;gesture.pending=null;gesture.inFlight++;gesture.lastMoveAt=this.now();gesture.moves++;
  this.sendInput('pointer',body,{quiet:true,parallel:true}).finally(()=>{gesture.inFlight--;if(this.gesture===gesture)this.pumpMoves();});
 }
 pointerEnd(event,cancelled){
  const gesture=this.gesture;if(!gesture||event.pointerId!==gesture.pointerId)return;
  if(!cancelled){event.preventDefault();event.stopPropagation();}
  const point=cancelled?null:this.point(event);this.finishGesture(point,modifiers(event),cancelled);
 }
 /** The up is always sent (a missed up leaves the plugin's gesture held). */
 finishGesture(point,mods={},cancelled=false){
  const gesture=this.gesture;if(!gesture)return Promise.resolve(null);this.gesture=null;
  if(gesture.timer!==null){this.clearTimer(gesture.timer);gesture.timer=null;}
  // The editor that received this gesture's down closed (editor_not_open): the
  // reopened editor holds no gesture, so nothing of it is resent.
  if(gesture.lost){gesture.pending=null;try{if(this.image?.hasPointerCapture?.(gesture.pointerId))this.image.releasePointerCapture(gesture.pointerId);}catch{}this.logEvent('plugin-gui-input',{kind:'pointer',phase:'up',outcome:'dropped',reason:'editor-reopened'});this.gestureHook('end',{kind:'pointer',id:gesture.id,ok:false});return Promise.resolve({ok:false,dropped:true});}
  // The latest coalesced move carries the drag's end position; send it before
  // the up (a slider moves on drag events, not on mouse-up).
  if(gesture.pending&&!cancelled){const last=gesture.pending;gesture.pending=null;gesture.moves++;this.sendInput('pointer',last,{quiet:true,parallel:true});}
  gesture.pending=null;
  try{if(this.image?.hasPointerCapture?.(gesture.pointerId))this.image.releasePointerCapture(gesture.pointerId);}catch{}
  const up=this.sendInput('pointer',{phase:'up',...(point||gesture.last),gesture_id:gesture.id,button:gesture.button,buttons:0,...mods},{gesture:{moves:gesture.moves,coalesced:gesture.coalesced,ms:this.now()-gesture.startedAt,cancelled,frameChangedDuringGesture:this.revision!==gesture.revisionAtDown}});
  // Confirmed by effect (not 'unconfirmed', not a not-applied/dropped input): the gesture is one undo step.
  up.then(result=>this.gestureHook('end',{kind:'pointer',id:gesture.id,ok:result?.ok===true&&result.confirmation!=='unconfirmed'&&!gesture.unconfirmed}),()=>this.gestureHook('end',{kind:'pointer',id:gesture.id,ok:false}));
  return up;
 }
 wheel(event){
  if(event.ctrlKey||!this.canInput())return;
  event.preventDefault();event.stopPropagation();const point=this.point(event);if(!point)return;
  const mode=[0,1,2].includes(event.deltaMode)?event.deltaMode:0,next={...point,delta_x:clampDelta(event.deltaX),delta_y:clampDelta(event.deltaY),delta_mode:mode,...modifiers(event)},pending=this.pendingScroll;
  this.pendingScroll=pending&&pending.delta_mode===mode?{...next,delta_x:clampDelta(pending.delta_x+next.delta_x),delta_y:clampDelta(pending.delta_y+next.delta_y)}:next;
  this.pumpScroll();
 }
 pumpScroll(){
  if(this.scrollInFlight||!this.pendingScroll)return;const body=this.pendingScroll;this.pendingScroll=null;this.scrollInFlight=true;
  // One scroll burst = one gesture: it starts with the first wheel input and ends once the wheel has been idle.
  if(!this.scrollGesture){this.scrollGesture={id:gestureId(),ok:true,timer:null};this.gestureHook('start',{kind:'scroll',id:this.scrollGesture.id});}
  const burst=this.scrollGesture;if(burst.timer!==null){this.clearTimer(burst.timer);burst.timer=null;}
  this.sendInput('scroll',body).then(result=>{if(!result?.ok||result.confirmation==='unconfirmed')burst.ok=false;},()=>{burst.ok=false;}).finally(()=>{this.scrollInFlight=false;this.pumpScroll();
   if(!this.scrollInFlight&&!this.pendingScroll&&this.scrollGesture===burst)burst.timer=this.setTimer(()=>{if(this.scrollGesture!==burst||this.scrollInFlight||this.pendingScroll)return;this.scrollGesture=null;this.gestureHook('end',{kind:'scroll',id:burst.id,ok:burst.ok});},PLUGIN_GUI_SCROLL_IDLE_MS);});
 }
 gestureHook(phase,detail){const hook=phase==='start'?this.onGestureStart:this.onGestureEnd;if(typeof hook!=='function')return;try{hook(detail);}catch(error){this.logEvent('plugin-gui-error',{stage:'gesture-'+phase,message:String(error?.message||'').slice(0,160)});}}
 keyDown(event){
  if(event.isComposing||event.keyCode===229)return;
  // FL: Cmd/Ctrl+Z (Shift: Redo) and Cmd/Ctrl+Y stay the project's Undo/Redo
  // even while a plugin window has focus; they reach the studio, not the plugin.
  if((event.metaKey||event.ctrlKey)&&!event.altKey&&['z','y'].includes(String(event.key).toLowerCase()))return;
  // While the GUI has focus its keys belong to the plugin, never to the
  // studio's document shortcuts (Space, F-keys, tools, Escape-closes-window).
  event.stopPropagation();
  if((event.metaKey||event.ctrlKey)&&BROWSER_COMBOS.has(String(event.key).toLowerCase()))return;
  const payload=this.canInput()?editorKeyPayload(event):null;if(!payload)return;
  event.preventDefault();this.sendInput('type',payload);
 }
 /** One input request, in order with the others. Never retried. */
 sendInput(kind,body,{quiet=false,gesture=null,parallel=false}={}){
  const operationId={pointer:'sendPluginEditorPointer',scroll:'sendPluginEditorScroll',type:'sendPluginEditorKeys'}[kind],epoch=this.inputEpoch,live=this.gesture&&this.gesture.id===body.gesture_id?this.gesture:null;
  this.startLatency(kind,body.phase);
  // A parallel move waits only for its gesture's down; everything else (and the up) waits for all earlier input.
  const gate=parallel&&live?.downTask?live.downTask:this.inputChain;
  const task=gate.then(async()=>{
   if(this.released)return{ok:false,skipped:true};
   // FL: input made while an Undo/Redo or other cloud edit runs is queued, then sent in order.
   if(typeof this.whenIdle==='function')try{await this.whenIdle();}catch{}
   if(this.released)return{ok:false,skipped:true};
   // Queued before an editor_not_open: never confirmed, so never resent to the reopened editor.
   if(epoch!==this.inputEpoch){this.logEvent('plugin-gui-input',{kind,...(body.phase?{phase:body.phase}:{}),outcome:'dropped',reason:'editor-reopened'});return{ok:false,dropped:true};}
   // A held gesture's up during close still goes out; new input needs a current scope.
   if(!(this.closed&&body.phase==='up')&&!this.checkScope('input')){this.logEvent('plugin-gui-input',{kind,outcome:'blocked',reason:'scope'});return{ok:false,blocked:true};}
   const started=this.now(),summary={kind,...(kind==='pointer'?{phase:body.phase}:{}),...(kind==='type'?{key:body.keycode!==undefined?'keycode':'text'}:{})};
   let error=null,data=null;
   // Round 36 (Studio Pro parity): the ordered mozart-editor channel when it is open for
   // this subscribed slot — fire-and-forget like Pro; REST otherwise (and after a refusal).
   const route=this.channelInput(kind,body);
   if(route.sent){this.inputRoute(kind,body,'channel',null,this.now()-started);this.noteChannelInput(kind,body);this.trackChannelGesture(kind,body);
    if(!this.closed){this.activeUntil=this.now()+PLUGIN_GUI_TIMING.activeWindowMs;this.schedule(0);const terminal=kind!=='pointer'||body.phase==='up';if(terminal)try{this.onParametersChanged?.({kind,phase:body.phase??null,confirmation:'dispatched'});}catch{}}
    if(!quiet||gesture)this.logEvent('plugin-gui-input',{...summary,outcome:'ok',ms:this.now()-started,confirmation:'dispatched',delivery:'webrtc-data-channel',...(gesture?{gesture}:{})});
    return{ok:true,confirmation:'dispatched',delivery:'webrtc-data-channel'};}
   this.inputRoute(kind,body,'rest',route.reason,null);
   // Round 38: a gesture re-routed to REST mid-way (the channel refused after its down) has
   // its channel-sent down (+ latest move) re-sent over REST FIRST, so the engine sees one
   // complete down→moves→up gesture (the refused down never reached it).
   await this.replayChannelGesture(kind,body);
   try{const response=await this.request(operationId,{body});if(!response.ok)error=await responseError(response,'The plugin editor did not accept the input.');else{try{data=await response.json();}catch{}if(data?.ok===false)error=Object.assign(new Error(text(data.message)||'The plugin editor did not apply the input.'),{status:response.status,code:text(data.code)||'input_not_applied',notApplied:true,confirmation:data.confirmation??null,delivery:data.delivery??null});}}
   catch(failure){error=failure;}
   const ms=this.now()-started;
   if(error){if(error.notApplied&&live&&body.phase!=='up')live.unconfirmed=true;this.inputFailed(summary,error,ms,{epoch,gesture:live});return{ok:false,error};}
   const confirmation=data?.confirmation??null;
   if(!quiet||gesture)this.logEvent('plugin-gui-input',{...summary,outcome:'ok',ms,confirmation,delivery:data?.delivery??null,...(gesture?{gesture}:{})});
   this.clearNotApplied();
   if(!this.closed){this.activeUntil=this.now()+PLUGIN_GUI_TIMING.activeWindowMs;this.schedule(0);
    // Terminal input confirmed by effect: the typed parameter list re-reads what changed.
    const terminal=kind!=='pointer'||body.phase==='up';if(terminal&&confirmation!=='unconfirmed')try{this.onParametersChanged?.({kind,phase:body.phase??null,confirmation});}catch{}}
   return{ok:true,confirmation};
  });
  this.inputChain=parallel?Promise.all([this.inputChain,task.catch(()=>{})]).then(()=>{}):task.catch(()=>{});return task;
 }
 /** Silent-ignore guard (round 36b). Trust in the channel route is per monitor peer (kept
  * on the shared frame stream, keyed by the peer generation): `probing` until the first
  * channel-routed pointer gesture shows evidence it was applied — a pushed frame whose
  * revision differs from the one shown at pointer-down, or a parameter change reported by
  * the optional verifyGesture hook — within CHANNEL_VERIFY_MS of pointer-up. Evidence →
  * `verified` (channel trusted for that peer). None → `unverified-ignored`: logged, that
  * gesture is replayed ONCE over the documented REST route (same gesture_id), and REST is
  * used for the rest of the peer's life. While a verdict is pending, new input uses REST. */
 channelTrust(){
  const stream=this.frameStream;if(!stream)return null;const generation=stream.monitor?.generation??null;
  if(!stream.channelTrust||stream.channelTrust.generation!==generation)stream.channelTrust={generation,status:'probing',probe:null};
  return stream.channelTrust;
 }
 noteChannelInput(kind,body){
  if(kind!=='pointer')return;const trust=this.channelTrust();if(!trust||trust.status!=='probing')return;
  if(body.phase==='down'&&!trust.probe){trust.probe={view:this,gestureId:body.gesture_id,bodies:[clone(body)],revision:this.revision,evidence:null,timer:null,upAt:null};return;}
  const probe=trust.probe;if(!probe||probe.view!==this||probe.gestureId!==body.gesture_id||probe.upAt!=null)return;
  if(body.phase==='move'){if(probe.bodies.at(-1)?.phase==='move')probe.bodies[probe.bodies.length-1]=clone(body);else probe.bodies.push(clone(body));return;}
  if(body.phase==='up'){probe.bodies.push(clone(body));probe.upAt=this.now();
   if(probe.evidence){this.verifyChannel('frame');return;}
   probe.timer=this.setTimer(()=>{probe.timer=null;if(trust.probe===probe&&trust.status==='probing')this.ignoreChannel();},CHANNEL_VERIFY_MS);
   try{Promise.resolve(this.verifyGesture?.({gestureId:probe.gestureId})).then(changed=>{if(changed===true&&trust.probe===probe&&trust.status==='probing')this.verifyChannel('parameters');},()=>{});}catch{}}
 }
 /** A pushed frame with a new revision after the probe gesture's down is evidence. */
 channelEvidence(){const trust=this.frameStream?.channelTrust,probe=trust?.probe;if(!probe||probe.view!==this||trust.status!=='probing'||this.revision===probe.revision)return;probe.evidence=probe.evidence||'frame';if(probe.upAt!=null)this.verifyChannel('frame');}
 verifyChannel(evidence){
  const trust=this.frameStream?.channelTrust,probe=trust?.probe;if(!probe||trust.status!=='probing')return;if(probe.timer!=null){this.clearTimer(probe.timer);probe.timer=null;}
  trust.status='verified';trust.probe=null;this.logEvent('plugin-gui-input-route',{event:'verified',route:'channel',evidence,afterUpMs:probe.upAt!=null?Math.round(this.now()-probe.upAt):null,gestureId:probe.gestureId});
 }
 ignoreChannel(){
  const trust=this.frameStream?.channelTrust,probe=trust?.probe;if(!probe||trust.status!=='probing')return;trust.status='unverified-ignored';trust.probe=null;
  this.logEvent('plugin-gui-input-route',{event:'ignored',route:'channel',status:'unverified-ignored',windowMs:CHANNEL_VERIFY_MS,gestureId:probe.gestureId,replayed:probe.bodies.map(body=>body.phase)});
  // Replay that gesture ONCE over REST, in order with any later input.
  const replay=this.inputChain.then(async()=>{for(const body of probe.bodies){let status=null,code=null;try{const response=await this.request('sendPluginEditorPointer',{body});status=response.status;if(!response.ok)code=(await responseError(response,'replay')).code??null;}catch(error){code=error?.code??'error';}this.logEvent('plugin-gui-input-route',{event:'replay',route:'rest',phase:body.phase,gestureId:body.gesture_id,status,code});}
   if(!this.closed){this.activeUntil=this.now()+PLUGIN_GUI_TIMING.activeWindowMs;this.schedule(0);try{this.onParametersChanged?.({kind:'pointer',phase:'up',confirmation:'replayed'});}catch{}}});
  this.inputChain=replay.catch(()=>{});
 }
 trackChannelGesture(kind,body){
  if(kind!=='pointer'||!body.gesture_id)return;
  if(body.phase==='down'){this.channelGesture={id:body.gesture_id,bodies:[clone(body)],replayed:false};return;}
  const record=this.channelGesture;if(!record||record.id!==body.gesture_id)return;
  if(body.phase==='move'){if(record.bodies.at(-1)?.phase==='move')record.bodies[record.bodies.length-1]=clone(body);else record.bodies.push(clone(body));}
  else if(body.phase==='up')this.channelGesture=null;
 }
 /** Every REST input of a re-routed gesture (parallel moves included) awaits ONE replay. */
 replayChannelGesture(kind,body){
  const record=this.channelGesture;if(kind!=='pointer'||!record||record.id!==body.gesture_id)return Promise.resolve();
  if(body.phase==='up')this.channelGesture=null;
  if(record.replay)return record.replay;
  // A gesture caught by the silent-ignore probe is handled here, not by the probe's replay.
  const trust=this.frameStream?.channelTrust;if(trust?.probe?.gestureId===record.id)trust.probe=null;
  const bodies=record.bodies.filter(replay=>replay.phase==='down'||body.phase!=='move');
  record.replay=(async()=>{for(const replay of bodies){let status=null,code=null;
   try{const response=await this.request('sendPluginEditorPointer',{body:replay});status=response.status;if(!response.ok)code=(await responseError(response,'reroute')).code??null;}catch(error){code=error?.code??'error';}
   this.logEvent('plugin-gui-input-route',{event:'reroute-replay',route:'rest',phase:replay.phase,gestureId:replay.gesture_id,status,code});}})();
  return record.replay;
 }
 /** Channel attempt: {sent} or {sent:false, reason} (why this input goes over REST). */
 channelInput(kind,body){
  const stream=this.frameStream;
  if(!stream||typeof stream.sendInput!=='function')return{sent:false,reason:'no-stream'};
  if(!this.streaming)return{sent:false,reason:'not-subscribed'};
  // Loads a remembered project refusal (reload / new peer) BEFORE anything else.
  const open=typeof stream.inputAvailable==='function'?stream.inputAvailable():true;
  if(stream.inputRefused){const pending=stream.channelTrust?.probe;if(pending){if(pending.timer!=null)this.clearTimer(pending.timer);stream.channelTrust.probe=null;}return{sent:false,reason:'refused:'+String(stream.inputRefused.code||'error')};}
  const trust=this.channelTrust();if(trust?.status==='unverified-ignored')return{sent:false,reason:'unverified-ignored'};
  // A probe gesture awaiting its verdict: other gestures (and other windows) use REST meanwhile.
  if(trust?.status==='probing'&&trust.probe&&(trust.probe.upAt!=null||trust.probe.view!==this||kind!=='pointer'||body.gesture_id!==trust.probe.gestureId))return{sent:false,reason:'channel-probing'};
  if(!open)return{sent:false,reason:'channel-closed'};
  let sent=false;try{sent=stream.sendInput(kind,body,{laneId:this.target.laneId,pluginIndex:this.target.pluginIndex})===true;}catch{sent=false;}
  return sent?{sent:true}:{sent:false,reason:stream.inputRefused?'refused:'+String(stream.inputRefused.code||'error'):'channel-send-failed'};
 }
 /** plugin-gui-input-route: which path each input took; logged on route changes and every terminal input. */
 inputRoute(kind,body,route,reason,ms){
  const terminal=kind!=='pointer'||body.phase!=='move',changed=this.lastInputRoute!==route||this.lastInputReason!==reason;this.lastInputRoute=route;this.lastInputReason=reason;
  if(changed||terminal)this.logEvent('plugin-gui-input-route',{kind,phase:body.phase??null,route,reason:reason??null,sendMs:ms==null?null:Math.round(ms*10)/10,changed});
 }
 inputFailed(summary,error,ms,{gesture=null}={}){
  this.logEvent('plugin-gui-input',{...summary,outcome:error?.notApplied?'not_applied':'error',ms,status:error?.status??null,code:error?.code??null});
  this.logEvent('plugin-gui-error',{stage:'input',...summary,status:error?.status??null,code:error?.code??null,retried:false,message:String(error?.message||'').slice(0,160)});
  if(this.closed)return;
  // Delivered but not confirmed by effect: a subtle mark, the true frame, no resend.
  if(error?.notApplied){this.showNotApplied(error);this.schedule(0);return;}
  if(error?.status===409&&error.code==='target_not_loaded'){this.fail(error,'input','Checking whether this plugin is still in its chain…');try{this.onTargetMissing?.(error);}catch{}return;}
  if(error?.status===409&&error.code==='plugin_instance_mismatch'){this.fail(error,'input',`This plugin slot now holds a different plugin${error.currentPluginType?` (${error.currentPluginType})`:''}. Reopen it from the mixer.`);try{this.onMismatch?.(error);}catch{}return;}
  if(pluginGuiNotOpen(error)){
   // Nothing queued behind the failed input was confirmed: drop it, end the held gesture locally, reopen once.
   this.inputEpoch++;this.pendingScroll=null;const held=this.gesture;if(held){held.lost=true;held.pending=null;if(held.timer!==null){this.clearTimer(held.timer);held.timer=null;}}if(gesture)gesture.lost=true;
   if(this.notOpenRetried){this.fail(error,'reopen','The plugin editor closed again on the engine host. Reopen it from the mixer.');return;}
   this.notOpenRetried=true;this.logEvent('plugin-gui-error',{stage:'input-recovery',status:error.status,code:error.code,recovery:'reopen'});
   this.openEditor().then(()=>this.schedule(0),openError=>this.fail(openError,'reopen'));return;
  }
  if(error?.status===429&&this.status)this.status.textContent='Too many plugin inputs · slow down';
 }
 showNotApplied(error){
  this.notApplied={code:error?.code??null,at:this.now()};const mark=this.notAppliedMark();
  if(mark){mark.hidden=false;mark.title=String(error?.message||'The plugin did not change.');}if(this.surface)this.surface.dataset.input='not-applied';
  if(this.notAppliedTimer!==null)this.clearTimer(this.notAppliedTimer);this.notAppliedTimer=this.setTimer(()=>{this.notAppliedTimer=null;this.clearNotApplied();},2500);
 }
 clearNotApplied(){if(!this.notApplied)return;this.notApplied=null;if(this.notAppliedTimer!==null){this.clearTimer(this.notAppliedTimer);this.notAppliedTimer=null;}if(this.mark)this.mark.hidden=true;if(this.surface)delete this.surface.dataset.input;}
 notAppliedMark(){
  if(this.mark||!this.surface)return this.mark||null;const doc=this.surface.ownerDocument||this.document,mark=doc.createElement('span');
  mark.className='plugin-gui-not-applied';mark.setAttribute('role','status');mark.textContent='Not applied';mark.hidden=true;
  mark.style.cssText='position:absolute;top:4px;right:6px;padding:1px 6px;border-radius:3px;background:rgba(20,24,26,.72);color:#e8b46a;font:11px Arial;pointer-events:none';
  this.surface.append(mark);this.mark=mark;return mark;
 }
 /** Stop polling, finish a held gesture, then release this caller's editor hold. */
 close(){
  if(this.closePromise)return this.closePromise;
  this.closePromise=(async()=>{
   if(this.streaming){this.streaming=false;if(this.streamWatch!=null){this.clearTimer(this.streamWatch);this.streamWatch=null;}try{this.frameStream?.unsubscribe();}catch{}}
   this.closed=true;if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}if(this.notAppliedTimer!==null){this.clearTimer(this.notAppliedTimer);this.notAppliedTimer=null;}this.latency.probe=null;
   try{this.abort?.abort();}catch{}
   this.pendingScroll=null;if(this.gesture)this.finishGesture(null,{},true);
   for(const url of new Set([this.imageUrl,this.displayedUrl]))if(url)try{this.revokeUrl(url);}catch{}
   this.imageUrl=this.displayedUrl=null;if(this.image){this.image.removeAttribute('src');this.image.hidden=true;}
   await this.inputChain;
   let receipt={ok:true,released:false};
   if(this.openDispatched){
    try{await this.openPromise;}catch{}
    try{const response=await this.request('releasePluginEditor',{body:this.scopeBody()});if(!response.ok)throw await responseError(response,'The plugin editor release was not confirmed.');receipt={ok:true,released:true};}
    catch(error){receipt={ok:false,released:false,error:error.message};this.logEvent('plugin-gui-error',{stage:'release',status:error?.status??null,code:error?.code??null,message:String(error?.message||'').slice(0,160)});}
   }
   this.released=true;
   const entry=owners.get(slotKey(this.target));if(entry?.owner===this){if(receipt.ok)entry.owner=null;else entry.blocked=true;}
   for(const remove of this.listeners||[])try{remove();}catch{}this.listeners=[];
   this.setState('closed','Plugin editor closed.');return receipt;
  })();
  return this.closePromise;
 }
}
