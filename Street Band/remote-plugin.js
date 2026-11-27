import {hostFetch} from './freestyle-host-transport.js';
/** Freestyle native plugin editor mirror: server frames and forwarded input. */
const emit=(target,type,detail)=>target.dispatchEvent(new CustomEvent(type,{detail}));
const clamp=value=>Math.max(0,Math.min(1,Number(value)||0));
const modifiers=event=>({shift_key:!!event.shiftKey,ctrl_key:!!event.ctrlKey,alt_key:!!event.altKey,meta_key:!!event.metaKey});
const keycodes={Tab:48,Enter:36,Backspace:51,Delete:117,Escape:53,Home:115,End:119,PageUp:116,PageDown:121,ArrowLeft:123,ArrowRight:124,ArrowDown:125,ArrowUp:126};
const characterCodes={a:0,b:11,c:8,d:2,e:14,f:3,g:5,h:4,i:34,j:38,k:40,l:37,m:46,n:45,o:31,p:35,q:12,r:15,s:1,t:17,u:32,v:9,w:13,x:7,y:16,z:6,0:29,1:18,2:19,3:20,4:21,5:23,6:22,7:26,8:28,9:25};

/** Match the Freestyle Studio: only an observed selected relay pair lowers limits. */
/** The ACTUAL selected ICE pair: transport.selectedCandidatePairId first (Chrome has no
 * candidate-pair.selected, and several pairs can be nominated+succeeded — the old "last
 * nominated" pick could report a relay pair while media flows host→host; live 2026-11-12 the
 * subscribe went out relay:true/640/5 fps). Falls back to a `selected` pair, then the
 * nominated succeeded pair with the most recent activity. Types only (no addresses). */
export function selectedCandidatePair(reports){
 if(!reports||typeof reports.forEach!=='function')return null;
 let id=null,flagged=null,nominated=null;
 reports.forEach(report=>{
  if(report.type==='transport'&&report.selectedCandidatePairId)id=report.selectedCandidatePairId;
  if(report.type==='candidate-pair'){if(report.selected)flagged=report;else if(report.nominated&&report.state==='succeeded'&&(!nominated||(Number(report.lastPacketReceivedTimestamp)||0)>(Number(nominated.lastPacketReceivedTimestamp)||0)))nominated=report;}
 });
 const pair=(id&&typeof reports.get==='function'&&reports.get(id))||flagged||nominated;if(!pair)return null;
 const local=typeof reports.get==='function'?reports.get(pair.localCandidateId):null,remote=typeof reports.get==='function'?reports.get(pair.remoteCandidateId):null;
 return{source:id&&reports.get?.(id)?'transport':flagged?'selected':'nominated',localType:local?.candidateType??null,remoteType:remote?.candidateType??null,protocol:local?.protocol??null,relayProtocol:local?.relayProtocol??null,rttMs:Number.isFinite(pair.currentRoundTripTime)?Math.round(pair.currentRoundTripTime*1000):null,relay:local?.candidateType==='relay'||remote?.candidateType==='relay'};
}
/** As in the Freestyle Studio: relay only when the selected pair is relayed, then ≤640 px / ≤5 fps.
 * fps: measured headless 2026-11-12 on a direct host→host pair, asking 30 fps gave changed frames
 * every 73–83 ms during a drag, asking 12 fps every 158–250 ms (the engine paces captures well under
 * the cap), so the GUI stream asks the documented maximum 30 when direct (`directFps`; the Freestyle Studio and the
 * native knob view ask 12). */
export async function editorSubscriptionProfile(peer,maxWidth,{directFps=12}={}){
 let pair=null;
 if(typeof peer?.getStats==='function')try{pair=selectedCandidatePair(await peer.getStats());}catch{}
 const relay=pair?.relay===true;
 return{max_width:relay?Math.min(640,maxWidth):maxWidth,fps:relay?5:directFps,relay,pair};
}

/** Decode one owned object URL without painting or interpreting plugin pixels. */
async function decodeEditorImage(url,document){
 if(!document?.createElement)throw new Error('The browser image decoder is unavailable.');
 const probe=document.createElement('img');probe.decoding='async';
 try{
  if(typeof probe.decode==='function'){probe.src=url;await probe.decode();}
  else await new Promise((resolve,reject)=>{probe.onload=resolve;probe.onerror=()=>reject(new Error('The plugin image could not be decoded.'));probe.src=url;});
  return{naturalWidth:probe.naturalWidth,naturalHeight:probe.naturalHeight};
 }finally{probe.onload=probe.onerror=null;probe.removeAttribute('src');}
}
const newerFrame=(sequence,previous)=>previous===null||sequence!==previous&&((sequence-previous)>>>0)<0x80000000;
export class EditorFrameAssembler {
  constructor(){this.frames=new Map();}
  clear(){this.frames.clear();}
  push(input) {
    if(!(input instanceof ArrayBuffer)||input.byteLength<12)return null;
    const view=new DataView(input),sequence=view.getUint32(0),index=view.getUint16(4),count=view.getUint16(6),revision=view.getUint32(8).toString(16).padStart(8,'0');
    if(!count||count>4096||index>=count||input.byteLength<12+(index===0?11:0))return null;
    let frame=this.frames.get(sequence);
    if(!frame){frame={sequence,chunks:new Array(count),received:0,revision,bytes:0};this.frames.set(sequence,frame);while(this.frames.size>8)this.frames.delete(this.frames.keys().next().value);}
    if(frame.chunks.length!==count)return null;
    let offset=12;
    if(index===0){frame.trackId=view.getUint32(offset);frame.pluginIndex=view.getUint16(offset+4);frame.width=view.getUint16(offset+6);frame.height=view.getUint16(offset+8);frame.format=view.getUint8(offset+10)===1?'image/png':'image/jpeg';offset+=11;}
    if(!frame.chunks[index]){frame.chunks[index]=input.slice(offset);frame.received++;frame.bytes+=input.byteLength-offset;}
    if(frame.bytes>40*1024*1024){this.frames.delete(sequence);return null;}
    if(frame.received!==count)return null;
    this.frames.delete(sequence);return{...frame,chunks:undefined,blob:new Blob(frame.chunks,{type:frame.format})};
  }
}

// The Freestyle Studio exposes one active native-editor subscription per monitor connection.
// Parameter dialogs remain independent; only original-image viewers share this.
const editorOwners=new WeakMap();
const ownershipMessage='The previous original plugin viewer cleanup is unconfirmed. Inspect its release before opening another viewer.';
function editorOwner(monitor){let entry=editorOwners.get(monitor);if(!entry){entry={owner:null,wanted:null,tail:Promise.resolve(),blocked:false};editorOwners.set(monitor,entry);}return entry;}
function ownershipError(){return Object.assign(new Error(ownershipMessage),{code:'editor_ownership_cleanup_failed'});}
export class RemotePluginEditor extends EventTarget {
  constructor({monitor,requestEditor=null,prepareTarget=null,editorArguments=()=>({visible:false}),guard=()=>{},decodeImage=decodeEditorImage,fetch:fetchImpl=(...args)=>hostFetch(...args)}={}) {
    super();if(!monitor)throw new Error('A cloud monitor is required to mirror plugin editors.');
    if(typeof editorArguments!=='function')throw new TypeError('Plugin editor arguments require a capability-aware callback.');
    if(typeof guard!=='function')throw new TypeError('Plugin editor input requires a scope guard function.');
    if(prepareTarget!==null&&typeof prepareTarget!=='function')throw new TypeError('Plugin editor target preparation requires a capability-aware callback.');
    this.allowDurableTarget=typeof requestEditor==='function'&&typeof prepareTarget==='function';this.prepareTarget=prepareTarget;this.guard=guard;this.editorArguments=editorArguments;this.monitor=monitor;this.fetch=fetchImpl;this.requestEditor=requestEditor||((target,action,arguments_)=>this.proxy(target,action,arguments_));
    if(typeof decodeImage!=='function')throw new TypeError('Plugin images require a browser decode callback.');
    this.decodeImage=decodeImage;this.assembler=new EditorFrameAssembler();this.state='closed';this.generation=0;this.latestSequence=null;this.decoding=null;this.queuedFrame=null;this.openIntent=0;this.closePromise=null;this.target=null;this.streamTarget=null;this.streamConnection=null;this.attempt=null;this.imageUrl=null;this.frameListener=null;this.stateListener=null;
  }
  setState(state,message=''){this.state=state;if(this.status)this.status.textContent=message||state;emit(this,'state',{state,message});}
  async proxy(target,action,arguments_={}) {
    const response=await this.fetch('/api/audio/editor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:target.projectId,track_id:target.contextTrackId,engine_track_id:target.trackId,plugin_index:target.pluginIndex,action,arguments:arguments_})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.detail||data.error?.message||data.error||`Cloud plugin editor failed (${response.status}).`);return data;
  }
  get ownershipState(){
    const entry=editorOwners.get(this.monitor),state=entry?.blocked?'cleanup_unconfirmed':entry?.owner===this?'active':this.state==='displaced'?'displaced':'idle';
    return Object.freeze({state,canOpen:!entry?.blocked,message:entry?.blocked?ownershipMessage:state==='displaced'?'Another original plugin viewer is active. Reopen this viewer to continue.':''});
  }
  open(target,container){
    const entry=editorOwner(this.monitor),intent={editor:this,version:++this.openIntent};entry.wanted=intent;
    // Invalidate an in-flight opener immediately, before its late ACK can
    // subscribe. Exact cleanup still waits for that request to settle.
    if(entry.owner&&!entry.owner.attempt?.subscribed)entry.owner.generation++;
    const current=()=>entry.wanted===intent&&intent.version===this.openIntent;
    const opening=entry.tail.then(async()=>{
      if(!current())return false;
      if(entry.blocked){const error=ownershipError();this.setState('error',error.message);emit(this,'error',error);throw error;}
      const previous=entry.owner;
      if(previous){await previous.closeForOwnership();if(entry.blocked){const error=ownershipError();this.setState('error',error.message);emit(this,'error',error);throw error;}
        if(previous!==this){previous.setState('displaced','Another original plugin viewer is active. Reopen this viewer to continue.');emit(previous,'displaced',{reason:'another-original-editor-opened'});}
      }
      if(!current())return false;
      entry.owner=this;const result=await this.openOwned(target,container);
      // A superseded pending open may already have reached the host. Even if
      // its replacement was cancelled, retire that exact attempted open.
      if(result===false&&entry.owner===this){await this.closeForOwnership();if(!entry.blocked&&entry.wanted?.editor&&entry.wanted.editor!==this){this.setState('displaced','Another original plugin viewer is active. Reopen this viewer to continue.');emit(this,'displaced',{reason:'another-original-editor-opened'});}}
      return result;
    });
    entry.tail=opening.catch(()=>{});return opening;
  }
  async openOwned(target,container) {
    const generation=++this.generation;
    let normalized={...target,projectId:target.projectId||this.monitor.projectId,contextTrackId:target.contextTrackId||this.monitor.trackId,pluginIndex:Number(target.pluginIndex??0)};
    if(this.prepareTarget){try{normalized={...normalized,...await this.prepareTarget(normalized)};}catch(error){if(generation!==this.generation)return false;throw error;}if(generation!==this.generation)return false;}
    const numeric=normalized.engineTrackId??normalized.trackId,pendingNumeric=numeric===undefined&&this.allowDurableTarget&&typeof normalized.laneId==='string'&&!!normalized.laneId;
    normalized={...normalized,...numeric===undefined?{}:{trackId:Number(numeric)}};
    if((!pendingNumeric&&(!Number.isSafeInteger(normalized.trackId)||normalized.trackId<=0))||!Number.isSafeInteger(normalized.pluginIndex)||normalized.pluginIndex<0)throw new Error('Select a live cloud plugin with a numeric engine track identity.');
    if(normalized.projectId!==this.monitor.projectId||normalized.contextTrackId!==this.monitor.trackId)throw new Error('The plugin and audio monitor must belong to the same cloud project and track context.');
    this.target=normalized;const attempt={target:normalized,generation,openRequested:false,subscribed:false};this.attempt=attempt;this.streamTarget=normalized;
    if(container)this.mount(container);
    this.setState('opening','Opening the original cloud plugin editor…');
    try {
      const arguments_=await this.editorArguments('mirror-open',normalized);
      if(generation!==this.generation||this.target!==normalized)return false;
      attempt.openRequested=true;attempt.openPromise=Promise.resolve(this.requestEditor(normalized,'mirror-open',arguments_));const receipt=await attempt.openPromise;
      if(generation!==this.generation)return false;
      const acknowledged=receipt?.editorLifecycle?.engineTrackId;
      if((pendingNumeric&&acknowledged===undefined)||acknowledged!==undefined&&(!Number.isSafeInteger(acknowledged)||acknowledged<=0))throw new Error('The editor acknowledged an invalid numeric stream target.');
      this.streamTarget={...normalized,trackId:acknowledged??normalized.trackId,engineTrackId:acknowledged??normalized.trackId};
      if(this.monitor.editor?.readyState!=='open'||this.monitor.editorFrames?.readyState!=='open')throw new Error('Connect the cloud audio monitor to receive the original plugin editor.');
      const connection={projectId:this.monitor.projectId,trackId:this.monitor.trackId,generation:this.monitor.generation,peer:this.monitor.peer,editor:this.monitor.editor,editorFrames:this.monitor.editorFrames};this.streamConnection=connection;
      const maxWidth=Math.max(64,Math.min(4096,Math.ceil((container?.clientWidth||1280)*(globalThis.devicePixelRatio||1))));
      const profile=await editorSubscriptionProfile(connection.peer,maxWidth);
      if(generation!==this.generation||this.target!==normalized)return false;
      this.guard();
      if(Object.entries(connection).some(([key,value])=>this.monitor[key]!==value))throw Object.assign(new Error('The plugin editor connection changed before subscription.'),{name:'AbortError',code:'editor_scope_changed'});
      if(connection.editor.readyState!=='open'||connection.editorFrames.readyState!=='open')throw new Error('The cloud plugin editor channels closed before subscription.');
      this.frameListener=event=>this.receiveFrame(event.detail);
      this.stateListener=event=>{if(attempt.generation===this.generation&&editorOwners.get(this.monitor)?.owner===this&&event.detail?.state==='error')this.setState('error',event.detail.message||'The cloud plugin editor failed.');};
      this.monitor.addEventListener('editorframe',this.frameListener);this.monitor.addEventListener('editorstate',this.stateListener);
      connection.editor.send(JSON.stringify({type:'editor.subscribe',track_id:this.streamTarget.trackId,plugin_index:normalized.pluginIndex,format:'jpeg',max_width:profile.max_width,fps:profile.fps,relay:profile.relay}));
      attempt.subscribed=true;this.setState('waiting','Waiting for the original plugin image…');return true;
    } catch(error){if(generation!==this.generation)return false;this.setState('error',error.message);emit(this,'error',error);throw error;}
  }
  mount(container) {
    container.replaceChildren();this.container=container;
    const status=document.createElement('div');status.className='remote-plugin-status';status.style.cssText='padding:8px;color:#bbc5c4;font:12px Arial';
    const image=document.createElement('img');image.alt='Live cloud plugin editor';image.tabIndex=0;image.draggable=false;image.style.cssText='display:none;max-width:100%;height:auto;outline:none;touch-action:none;user-select:none';
    container.append(status,image);this.status=status;this.image=image;
    const point=event=>{const rect=image.getBoundingClientRect();return{x_norm:clamp((event.clientX-rect.left)/rect.width),y_norm:clamp((event.clientY-rect.top)/rect.height)};};
    // gesturestart / gestureend bracket one undoable knob or fader gesture (the
    // data channel has no input acknowledgement: the app's read-back decides).
    const pointer=(event,phase)=>{event.preventDefault();event.stopPropagation();if(phase==='down'){image.focus();image.setPointerCapture?.(event.pointerId);this.gesture=globalThis.crypto?.randomUUID?.()||String(Date.now());emit(this,'gesturestart',{kind:'pointer',id:this.gesture});}const sent=this.sendInput('pointer',{phase,...point(event),pointer_id:Number(event.pointerId)||0,pointer_type:event.pointerType||'mouse',button:Number.isInteger(event.button)?event.button:-1,buttons:Number(event.buttons)||0,pressure:Number(event.pressure)||0,gesture_id:this.gesture,...modifiers(event)});if(phase==='up'&&this.gesture){const id=this.gesture;this.gesture=null;emit(this,'gestureend',{kind:'pointer',id,ok:!!sent});}};
    image.onpointerdown=event=>pointer(event,'down');image.onpointermove=event=>{if(event.buttons)pointer(event,'move');};image.onpointerup=event=>pointer(event,'up');image.onpointercancel=event=>pointer(event,'up');image.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();};image.onauxclick=event=>{event.preventDefault();event.stopPropagation();};
    image.addEventListener('wheel',event=>{if(event.ctrlKey)return;event.preventDefault();event.stopPropagation();this.sendInput('scroll',{...point(event),delta_x:event.deltaX,delta_y:event.deltaY,delta_mode:event.deltaMode,...modifiers(event)});},{passive:false});
    // FL: Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z and Cmd/Ctrl+Y stay the project's Undo/Redo while the plug-in window has focus.
    image.onkeydown=event=>{if((event.metaKey||event.ctrlKey)&&!event.altKey&&['z','y'].includes(String(event.key).toLowerCase()))return;let payload;if(Object.hasOwn(keycodes,event.key))payload={keycode:keycodes[event.key],...modifiers(event)};else if(event.key.length===1){payload={text:event.key,...modifiers(event)};if(event.metaKey||event.ctrlKey){if(!Object.hasOwn(characterCodes,event.key.toLowerCase()))return;payload.keycode=characterCodes[event.key.toLowerCase()];}}else return;event.preventDefault();event.stopPropagation();this.sendInput('type',payload);};
  }
  /** Release 2026-11-14: a read (or expired) peer grant is refused on editor input (project_control_forbidden).
   * Input is then not sent at all; the refusal is reported once per peer generation, never per event. */
  sendInput(type,payload){try{return this.send(type,payload);}catch(error){if(error?.code==='project_control_forbidden'){const notice=`generation:${this.monitor?.generation??0}`;if(this.readOnlyNotice===notice)return null;this.readOnlyNotice=notice;}const failure=new Error(String(error?.message||'The cloud plugin editor input could not be sent.').slice(0,300));if(typeof error?.code==='string')failure.code=error.code.slice(0,128);this.setState('error',failure.message);emit(this,'error',failure);return null;}}
  send(type,payload) {
    if(!this.target||!this.attempt?.subscribed||this.attempt.generation!==this.generation||editorOwners.get(this.monitor)?.owner!==this||this.monitor.editor?.readyState!=='open')throw new Error('The cloud plugin editor connection is unavailable.');
    if(!['pointer','scroll','type'].includes(type))throw new Error('Unsupported native editor input.');
    let grant=null;try{grant=typeof this.monitor.controlGrant==='function'?this.monitor.controlGrant():null;}catch{}
    if(grant==='read'||grant==='expired')throw Object.assign(new Error(grant==='read'?'This cloud audio connection is listen-only (Freestyle peer grant: read); the plugin editor shows the live GUI but cannot take input.':'The Freestyle peer grant expired; plugin editor input resumes once the connection is renewed.'),{code:'project_control_forbidden'});
    this.guard();const message={...payload,type:`editor.${type}`,track_id:this.streamTarget.trackId,plugin_index:this.streamTarget.pluginIndex};this.monitor.editor.send(JSON.stringify(message));return message;
  }
  frameCurrent(job){
    return job.generation===this.generation&&job.target===this.target&&job.streamTarget===this.streamTarget&&this.attempt?.subscribed===true&&this.attempt.generation===this.generation&&editorOwners.get(this.monitor)?.owner===this&&this.monitor.editor?.readyState==='open'&&this.monitor.editorFrames?.readyState==='open'&&!['closed','failed'].includes(this.monitor.peer?.connectionState)&&!!this.streamConnection&&Object.entries(this.streamConnection).every(([key,value])=>this.monitor[key]===value);
  }
  releaseFrame(job){if(job?.url&&!job.released){job.released=true;URL.revokeObjectURL(job.url);}}
  receiveFrame(input) {
    if(!this.target||!this.attempt?.subscribed)return;
    const frame=this.assembler.push(input);if(!frame||frame.trackId!==this.streamTarget?.trackId||frame.pluginIndex!==this.streamTarget?.pluginIndex||!newerFrame(frame.sequence,this.latestSequence))return;
    const job={frame,generation:this.generation,target:this.target,streamTarget:this.streamTarget,url:null,released:false,published:false};if(!this.frameCurrent(job))return;
    this.latestSequence=frame.sequence;
    // A single active decode plus only the newest waiting frame bounds work.
    this.queuedFrame=job;if(!this.decoding)this.decodeNextFrame();
  }
  decodeNextFrame(){
    if(this.decoding||!this.queuedFrame)return;const job=this.queuedFrame;this.queuedFrame=null;if(!this.frameCurrent(job))return;
    this.decoding=job;
    this.setState('decoding',this.imageUrl?'Last decoded frame · Decoding the latest plugin image…':'Decoding the original plugin image…');
    Promise.resolve().then(async()=>{
      this.guard();if(!this.frameCurrent(job))return;
      if(!job.frame.blob.size)throw new Error('The plugin editor returned an empty image.');
      job.url=URL.createObjectURL(job.frame.blob);
      const decoded=await this.decodeImage(job.url,this.image?.ownerDocument||globalThis.document);
      // A faster incoming stream must not starve completed valid decodes.
      // Publish this current result, then decode the newest coalesced frame.
      if(!this.frameCurrent(job))return;
      this.guard();const width=decoded?.naturalWidth,height=decoded?.naturalHeight;
      if(!Number.isSafeInteger(width)||width<=0||!Number.isSafeInteger(height)||height<=0)throw new Error('The plugin image decoded without valid natural dimensions.');
      const previous=this.imageUrl;this.imageUrl=job.url;job.published=true;
      if(this.image){this.image.src=job.url;this.image.width=width;this.image.height=height;this.image.style.display='block';}
      if(previous)URL.revokeObjectURL(previous);
      this.setState('ready',`${width} × ${height} · Live cloud plugin (decoded)`);emit(this,'frame',{...job.frame,decoded:{width,height}});
    }).catch(error=>{
      if(!this.frameCurrent(job)||this.queuedFrame)return;
      const failure=new Error(String(error?.message||'The plugin image could not be decoded.').slice(0,300));this.setState('error',failure.message);emit(this,'error',failure);
    }).finally(()=>{
      if(!job.published)this.releaseFrame(job);
      if(this.decoding===job){this.decoding=null;this.decodeNextFrame();}
    });
  }
  close(){
    this.openIntent++;const entry=editorOwners.get(this.monitor);if(entry?.wanted?.editor===this)entry.wanted=null;
    return this.closeForOwnership();
  }
  closeForOwnership(){
    if(this.closePromise)return this.closePromise;
    const entry=editorOwners.get(this.monitor);
    if(entry?.blocked&&entry.owner===this)return Promise.resolve(Object.freeze({ok:false,cleanupUnconfirmed:true}));
    const closing=this.closeOwned().then(receipt=>{
      if(entry?.owner===this){if(!receipt.ok)entry.blocked=true;else entry.owner=null;}
      return receipt;
    },error=>{if(entry?.owner===this)entry.blocked=true;throw error;});
    this.closePromise=closing;const settled=()=>{if(this.closePromise===closing)this.closePromise=null;};closing.then(settled,settled);return closing;
  }
  async closeOwned() {
    const generation=++this.generation;
    if(this.frameListener)this.monitor.removeEventListener('editorframe',this.frameListener);
    if(this.stateListener)this.monitor.removeEventListener('editorstate',this.stateListener);
    this.frameListener=this.stateListener=null;
    const target=this.target,stream=this.streamTarget,connection=this.streamConnection,attempt=this.attempt,imageUrl=this.imageUrl,decoding=this.decoding,failures=[];
    this.target=null;this.streamTarget=null;this.streamConnection=null;this.attempt=null;this.imageUrl=null;this.latestSequence=null;this.queuedFrame=null;this.decoding=null;this.assembler.clear();if(this.image){this.image.removeAttribute('src');this.image.width=0;this.image.height=0;this.image.style.display='none';}
    const retain=(stage,error)=>failures.push(Object.assign(new Error(`${stage==='unsubscribe'?'Plugin editor stream unsubscribe':stage==='release'?'Plugin editor API release':'Plugin editor image cleanup'} failed: ${String(error?.message||'Cleanup unavailable').slice(0,220)}`),{code:`editor_${stage}_failed`,stage}));
    try{
      // A channel can close between readyState and send. That must never skip
      // API cleanup of the exact previously captured editor target.
      try{if(target&&attempt?.subscribed&&connection?.editor?.readyState==='open')connection.editor.send(JSON.stringify({type:'editor.unsubscribe',track_id:stream.trackId,plugin_index:stream.pluginIndex}));}
      catch(error){retain('unsubscribe',error);}
      finally{if(target&&attempt?.openRequested)try{await attempt.openPromise?.catch(()=>{});await this.requestEditor(target,'release',{});}catch(error){retain('release',error);}}
    }finally{
      if(!decoding?.published)try{this.releaseFrame(decoding);}catch(error){retain('image_cleanup',error);}
      if(imageUrl)try{URL.revokeObjectURL(imageUrl);}catch(error){retain('image_cleanup',error);}
      if(generation===this.generation)this.setState('closed');
      if(failures.length){this.lastCloseErrors=failures.map(error=>({code:error.code,stage:error.stage,message:error.message}));for(const error of failures)emit(this,'error',error);}
    }
    return Object.freeze({ok:failures.length===0,cleanupUnconfirmed:failures.length>0});
  }
}
