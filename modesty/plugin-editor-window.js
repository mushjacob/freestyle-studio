/** Plugin editor window: the remote native GUI mirror plus a generic parameter panel.
 *
 * The parameter panel mirrors the Freestyle Studio's generic plug-in controls: read the live parameter list for the lane slot, write one
 * normalized value per control with a 75 ms per-parameter debounce, apply the
 * returned parameter, and re-read every 2 s while no write is pending. Large
 * plug-ins (LABS reports >2,000 parameters, ~31 s per page) are read once,
 * rendered progressively in a virtualised list, and polling re-reads only the
 * pages holding visible or recently touched controls, never overlapping.
 * The Freestyle Studio sends `expected_plugin_instance_id`; the published Studio API parameter
 * route has no such guard, so every write burst first re-reads the lane chain
 * and refuses to write if the slot no longer holds the same instance.
 */
import {RemotePluginEditor,EditorError,describeEditorError,typesMatch} from './remote-plugin.js';
import {isInstanceMismatch} from './plugin-editor-http.js';
import {isParameterConflict,parameterGuard} from './mix-sync.js';
import {NativeEqEditor,isNativeEqPlugin} from './plugin-editor-native-eq.js';
import {normalizePluginParameters,unpackMixerResult} from './mixer-tools.js';
import {bridgeFetch,viewHidden,viewActivity} from './freestyle-host-transport.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const norm=value=>String(value??'').trim().toLowerCase();
const instanceOf=plugin=>String(plugin?.instance_id??plugin?.instanceId??plugin?.pluginKey??plugin?.plugin_key??'').trim();
const typeOf=plugin=>String(plugin?.type_id??plugin?.typeId??plugin?.type??'').trim();

/** Editor target from a channel/lane plugin row (runtime `instance_id`/`type_id` or persisted `pluginKey`/`type`). */
export function editorTargetFromPlugin(plugin,{laneId,index}={}){
  const pluginIndex=Number.isInteger(plugin?.index)?plugin.index:Number.isInteger(plugin?.plugin_index)?plugin.plugin_index:Number.isInteger(plugin?.position)?plugin.position:index;
  return{laneId:String(laneId||''),pluginIndex:Number.isInteger(pluginIndex)?pluginIndex:null,instanceId:instanceOf(plugin),type:typeOf(plugin),name:String(plugin?.name||plugin?.label||typeOf(plugin)||'Plug-in')};
}
/** Show the engine's text while it still describes the value, else a percentage. */
export function parameterText(parameter,value=parameter?.normalized){const numeric=Math.max(0,Math.min(1,Number(value)||0));return Math.abs(numeric-Number(parameter?.normalized))<5e-4&&parameter?.display?String(parameter.display):`${Math.round(numeric*1000)/10}%`;}

const abortError=()=>Object.assign(new Error('The plugin parameter read was cancelled.'),{name:'AbortError',code:'parameter_read_cancelled'});
/** Abortable local Studio call for long parameter reads (closing the window cancels the request). */
export async function abortableStudioCall(name,args,{signal}={}){
  const response=await bridgeFetch('modesty-bridge:/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args}),signal});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new EditorError(data.detail||data.error?.message||(typeof data.error==='string'?data.error:'')||`Freestyle request failed (${response.status}).`,{code:data.code||'studio_request_failed',stage:data.stage||name,status:data.upstreamStatus||response.status,requestId:data.requestId||null}),{result:data});
  return data;
}

export class PluginParameterPanel extends EventTarget{
  constructor({call,readCall=null,action=null,projectId,contextTrackId,target,liveControl=null,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),now=()=>Date.now(),debounceMs=75,pollMs=2000,guardMs=1500,rowHeight=44,touchedMs=10000,pageLimit=200}={}){
    super();if(typeof call!=='function')throw new Error('A Freestyle call function is required for plugin parameters.');
    if(!projectId||!target?.laneId||!Number.isInteger(target?.pluginIndex))throw new Error('Choose a saved lane plugin slot before reading its parameters.');
    this.call=async(name,args)=>unpackMixerResult(await call(name,args));this.readCall=readCall||call;this.action=action;this.projectId=projectId;this.contextTrackId=contextTrackId||null;this.target={...target};this.liveControl=liveControl;
    Object.assign(this,{setTimer,clearTimer,now,debounceMs,pollMs,guardMs,rowHeight,touchedMs,pageLimit});
    this.parameters=[];this.byIndex=new Map();this.pageOf=new Map();this.values=new Map();this.touched=new Map();this.visible=new Set();
    this.timers=new Map();this.inflight=new Map();this.queued=new Set();this.generation=0;this.query='';this.statusText='';this.reading=false;this.polling=false;this.complete=false;
    this.abort=new AbortController();
  }
  context(){return{project_id:this.projectId,...this.contextTrackId?{track_id:this.contextTrackId}:{}};}
  setStatus(text,error=false){this.statusText=text;this.statusError=error;if(this.statusElement){this.statusElement.textContent=text;this.statusElement.classList.toggle('error',error);}this.dispatchEvent(new CustomEvent('status',{detail:{text,error}}));}
  pending(){return this.timers.size>0||this.inflight.size>0;}
  async readPage(cursor){
    const signal=this.abort.signal;if(signal.aborted)throw abortError();
    const data=unpackMixerResult(await this.readCall('get_plugin_state',{...this.context(),lane_id:this.target.laneId,plugin_index:this.target.pluginIndex,limit:this.pageLimit,...cursor?{cursor}:{}},{signal}));
    if(signal.aborted)throw abortError();
    if(data.projectId!==undefined&&data.projectId!==this.projectId||data.laneId!==undefined&&data.laneId!==this.target.laneId)throw new EditorError('Parameter discovery belongs to another lane.',{code:'parameter_target_mismatch',stage:'parameters:read'});
    const instance=instanceOf(data.plugin);if(this.target.instanceId&&instance&&norm(instance)!==norm(this.target.instanceId))throw new EditorError('This plugin slot now holds another instance. Reopen the editor.',{code:'editor_plugin_changed',stage:'parameters:read'});
    if(data.plugin?.index!==undefined&&data.plugin.index!==this.target.pluginIndex)throw new EditorError('This plugin slot moved during parameter discovery.',{code:'editor_plugin_changed',stage:'parameters:read'});
    return{data,parameters:normalizePluginParameters(data)};
  }
  /** Reads the paged list exactly once, rendering each page as it arrives. */
  load(){
    this.loadPromise??=(async()=>{
      const generation=this.generation;this.reading=true;this.setStatus('Reading controls…');
      try{
        const seen=new Set();let cursor=null;
        for(let page=0;page<100;page++){
          const {data,parameters}=await this.readPage(cursor);if(generation!==this.generation)return null;
          for(const parameter of parameters){if(this.byIndex.has(parameter.index))throw new EditorError('The plugin parameter list contains duplicate indexes.',{code:'parameter_duplicate',stage:'parameters:read'});this.byIndex.set(parameter.index,parameter);this.pageOf.set(parameter.index,cursor);this.parameters.push(parameter);if(!this.timers.has(parameter.index)&&!this.inflight.has(parameter.index))this.values.set(parameter.index,parameter.normalized);}
          const more=data.pagination?.hasMore===true;this.setStatus(more?`Reading controls… ${this.parameters.length} so far`:`${this.parameters.length} live controls`);this.paint();
          if(!more)break;const next=data.pagination.nextCursor;if(typeof next!=='string'||!next||seen.has(next))throw new EditorError('The plugin parameter cursor is incomplete or repeated.',{code:'parameter_cursor_invalid',stage:'parameters:read'});seen.add(next);cursor=next;
          if(page===99)throw new EditorError('The plugin parameter list exceeded its page limit.',{code:'parameter_page_limit',stage:'parameters:read'});
        }
        this.complete=true;return this.parameters;
      }catch(error){if(error?.name==='AbortError'||generation!==this.generation)return null;this.setStatus(describeEditorError(error,this.target.name),true);this.loadPromise=null;throw error;}
      finally{this.reading=false;this.paint();}
    })();
    return this.loadPromise;
  }
  /** Parameters worth refreshing: the rendered rows plus recently touched controls. */
  pollTargets(){const now=this.now();for(const [index,at] of this.touched)if(now-at>this.touchedMs)this.touched.delete(index);return new Set([...this.visible,...this.touched.keys()]);}
  async poll(){
    if(this.polling||this.reading||!this.complete||this.pending()||this.abort.signal.aborted)return false;
    const wanted=this.pollTargets();if(!wanted.size)return false;
    const pages=[...new Set([...wanted].filter(index=>this.pageOf.has(index)).map(index=>this.pageOf.get(index)))];
    const generation=this.generation;this.polling=true;
    try{for(const cursor of pages){const {parameters}=await this.readPage(cursor);if(generation!==this.generation||this.pending())return false;
        for(const parameter of parameters)if(this.byIndex.has(parameter.index)&&wanted.has(parameter.index)){this.byIndex.set(parameter.index,{...this.byIndex.get(parameter.index),...parameter});this.values.set(parameter.index,parameter.normalized);}
        this.parameters=this.parameters.map(item=>this.byIndex.get(item.index)||item);}
      this.paint();return true;
    }catch{return false;}finally{this.polling=false;}
  }
  /** Optimistic value. While the slider moves the engine follows through `set_plugin_param` on the mozart-control
   *  data channel (live, not saved; see live-control.js); the saved write is debounced per parameter (75 ms). */
  set(index,value){
    if(this.changed)throw new EditorError('The plug-in in this slot changed. Reopen the editor.',{code:'plugin_instance_mismatch',stage:'parameters:write'});
    const parameter=this.byIndex.get(index);if(!parameter||!parameter.writeForms.includes('value_norm'))throw new EditorError('This control is not writable as a normalized value.',{code:'parameter_not_writable',stage:'parameters:write'});
    const numeric=Math.max(0,Math.min(1,Number(value)||0));this.values.set(index,numeric);this.touched.set(index,this.now());
    const live={laneId:this.target.laneId,pluginIndex:this.target.pluginIndex,parameterIndex:index};
    try{this.liveControl?.parameter({...live,valueNorm:numeric,type:this.target.type||''});}catch{}
    const existing=this.timers.get(index);if(existing!=null)this.clearTimer(existing);
    this.timers.set(index,this.setTimer(()=>{this.timers.delete(index);try{this.liveControl?.flush(this.liveControl.parameterKey(live));}catch{}this.flush(index);},this.debounceMs));
    return numeric;
  }
  async guard(){
    if(this.guardedAt!=null&&this.now()-this.guardedAt<this.guardMs)return;
    const chain=await this.call('list_plugins',{...this.context(),lane_id:this.target.laneId});
    const current=list(chain.plugins).find(plugin=>(plugin.index??plugin.plugin_index)===this.target.pluginIndex);
    const same=current&&(this.target.instanceId?norm(instanceOf(current))===norm(this.target.instanceId):typesMatch(typeOf(current),this.target.type));
    if(!same)throw new EditorError('This plugin slot changed in Freestyle. Reopen the editor before changing controls.',{code:'editor_plugin_changed',stage:'parameters:guard'});
    this.guardedAt=this.now();
  }
  async flush(index){
    if(this.inflight.has(index)){this.queued.add(index);return this.inflight.get(index);}
    const generation=this.generation,value=this.values.get(index);
    const task=(async()=>{
      this.setStatus('Applying…');
      try{
        // The published write carries the instance guard; the client re-read is kept only when no identity is known.
        if(!this.target.instanceId&&!this.target.type)await this.guard();if(generation!==this.generation)return null;
        const args={lane_id:this.target.laneId,plugin_index:this.target.pluginIndex,parameter_index:index,value_norm:value,...parameterGuard(this.byIndex.get(index)?.normalized),...this.target.instanceId?{expected_plugin_instance_id:this.target.instanceId}:{},...this.target.type?{expected_plugin_type:this.target.type}:{}};
        const result=unpackMixerResult(this.action?await this.action('set_plugin_parameter',args,{refresh:false}):await this.call('execute_pro_action',{...this.context(),action:'set_plugin_parameter',arguments:args,idempotency_key:globalThis.crypto?.randomUUID?.()||String(Date.now())}));
        if(generation!==this.generation)return result;
        const returned=result.parameter?normalizePluginParameters({snapshot:{parameters:[result.parameter]}})[0]:null;
        if(returned&&returned.index===index){this.byIndex.set(index,{...this.byIndex.get(index),...returned});this.parameters=this.parameters.map(item=>item.index===index?this.byIndex.get(index):item);if(!this.queued.has(index)&&!this.timers.has(index))this.values.set(index,returned.normalized??value);}
        this.touched.set(index,this.now());this.lastReceipt=result;this.setStatus(result.engine_applied===false||result.engine_reload_required===true?'Saved; live engine processing is not confirmed yet.':'Applied');
        this.paint(index);this.dispatchEvent(new CustomEvent('applied',{detail:{index,value,result}}));return result;
      }catch(error){this.guardedAt=null;
        if(isInstanceMismatch(error)&&generation===this.generation){this.instanceChanged(error);return null;}
        if(isParameterConflict(error)&&generation===this.generation){await this.parameterChanged(index,error);return null;}
        if(generation===this.generation){this.setStatus(describeEditorError(error,this.target.name),true);this.dispatchEvent(new CustomEvent('error',{detail:error}));}return null;}
    })();
    this.inflight.set(index,task);
    try{return await task;}finally{this.inflight.delete(index);if(this.queued.delete(index)&&generation===this.generation)this.flush(index);}
  }
  /** 412 plugin_parameter_conflict: someone else changed this control; show their value and never resend. */
  async parameterChanged(index,error){
    const details=error?.details||error?.result?.details||{},timer=this.timers.get(index);if(timer!=null){this.clearTimer(timer);this.timers.delete(index);}this.queued.delete(index);
    let current=Number.isFinite(Number(details.currentValueNorm))?Number(details.currentValueNorm):null;
    if(current===null)try{const {parameters}=await this.readPage(this.pageOf.get(index)??null);const fresh=parameters.find(item=>item.index===index);if(fresh){this.byIndex.set(index,{...this.byIndex.get(index),...fresh});current=fresh.normalized;}}catch{}
    if(current!==null){this.byIndex.set(index,{...this.byIndex.get(index),normalized:current,display:''});this.parameters=this.parameters.map(item=>item.index===index?this.byIndex.get(index):item);this.values.set(index,current);}
    this.setStatus(`${this.byIndex.get(index)?.name||'This control'} was changed elsewhere — showing the current value; your change was not applied.`,true);this.paint(index);
    this.dispatchEvent(new CustomEvent('parameterconflict',{detail:{index,current,error}}));
  }
  /** 409 plugin_instance_mismatch: no write happened; stop editing and never re-send. */
  instanceChanged(error){
    const details=error?.details||error?.result?.details||{},current=details.currentPluginType||details.currentInstanceId;
    this.destroy();this.changed={currentInstanceId:details.currentInstanceId??null,currentPluginType:details.currentPluginType??null};
    this.setStatus(`The plug-in in this slot changed${current?` (now ${current})`:''}. Reopen the editor; nothing was changed.`,true);
    if(this.grid)this.grid.querySelectorAll('input').forEach(input=>{input.disabled=true;});
    this.dispatchEvent(new CustomEvent('instancechanged',{detail:{error,...this.changed}}));
  }
  /** Polls never overlap: the next tick is scheduled only after the previous one finishes. */
  start(){this.stop();this.running=true;const tick=()=>{this.pollTimer=this.setTimer(async()=>{this.pollTimer=null;if(!this.running)return;if(!(globalThis.document?.hidden))await this.poll();if(this.running)tick();},this.pollMs);};tick();}
  stop(){this.running=false;if(this.pollTimer!=null)this.clearTimer(this.pollTimer);this.pollTimer=null;}
  destroy(){this.generation++;this.stop();this.abort.abort();for(const id of this.timers.values())this.clearTimer(id);this.timers.clear();this.queued.clear();}
  mount(container){
    container.replaceChildren();this.container=container;container.classList.add('plugin-parameter-panel');
    container.innerHTML=`<header><strong>${esc(this.target.name)}</strong><span class="plugin-parameter-status" role="status"></span><input type="search" placeholder="Search controls" aria-label="Search ${esc(this.target.name)} controls"><button type="button" class="plugin-parameter-refresh" aria-label="Refresh ${esc(this.target.name)} controls">↻</button></header><div class="plugin-parameter-scroll"><div class="plugin-parameter-grid" role="list"></div></div>`;
    this.statusElement=container.querySelector('.plugin-parameter-status');this.scroller=container.querySelector('.plugin-parameter-scroll');this.grid=container.querySelector('.plugin-parameter-grid');this.setStatus(this.statusText,this.statusError);
    container.querySelector('input[type=search]').oninput=event=>{this.query=event.target.value.toLowerCase();this.scroller.scrollTop=0;this.paint();};
    container.querySelector('.plugin-parameter-refresh').onclick=()=>{this.poll();};
    this.scroller.addEventListener('scroll',()=>this.paint(),{passive:true});
    this.paint();
  }
  filtered(){return this.query?this.parameters.filter(parameter=>parameter.name.toLowerCase().includes(this.query)):this.parameters;}
  /** Virtualised rendering: only rows inside the scroll viewport (plus overscan) exist in the DOM. */
  paint(onlyIndex){
    if(!this.grid)return;
    if(onlyIndex!==undefined){const row=this.grid.querySelector(`[data-parameter="${onlyIndex}"]`),parameter=this.byIndex.get(onlyIndex);if(row&&parameter){const value=this.values.get(onlyIndex)??parameter.normalized??0,input=row.querySelector('input');if(document.activeElement!==input)input.value=value;row.querySelector('small').textContent=parameterText(parameter,value);}return;}
    const shown=this.filtered(),height=this.rowHeight,viewport=this.scroller?.clientHeight||480,top=this.scroller?.scrollTop||0;
    const first=Math.max(0,Math.floor(top/height)-4),last=Math.min(shown.length,first+Math.ceil(viewport/height)+8),rows=shown.slice(first,last);
    this.grid.style.position='relative';this.grid.style.height=`${shown.length*height}px`;this.visible=new Set(rows.map(parameter=>parameter.index));
    this.grid.innerHTML=shown.length?rows.map((parameter,offset)=>{const value=this.values.get(parameter.index)??parameter.normalized??0,writable=parameter.normalized!==null&&parameter.writeForms.includes('value_norm');return`<label class="plugin-parameter" role="listitem" data-parameter="${parameter.index}" style="top:${(first+offset)*height}px"><span>${esc(parameter.name)}</span><input type="range" min="0" max="1" step="0.001" value="${value}" ${writable?'':'disabled'} aria-label="${esc(parameter.name)}"><small>${esc(parameterText(parameter,value))}</small></label>`;}).join(''):`<p class="plugin-parameter-empty">${this.reading?'Reading plug-in parameters…':this.parameters.length?'No controls match that search.':'No host-automatable controls exposed.'}</p>`;
    this.grid.querySelectorAll('[data-parameter]').forEach(row=>{const index=Number(row.dataset.parameter),input=row.querySelector('input'),parameter=this.byIndex.get(index);input.oninput=()=>{try{const value=this.set(index,input.value);row.querySelector('small').textContent=parameterText(parameter,value);}catch(error){this.setStatus(describeEditorError(error,this.target.name),true);}};});
  }
}

let featureRequest=null;
/** HTTP editor path is gated on the backend's advertised features (/api/tools features.pluginEditorFrame / pluginEditorInput). */
export function editorHttpFeatures(fetchImpl=(...args)=>bridgeFetch(...args),{refresh=false}={}){
  if(refresh)featureRequest=null;
  featureRequest??=(async()=>{try{const response=await fetchImpl('modesty-bridge:/tools');if(!response.ok)return{frame:null,input:false};const data=await response.json();const features=data?.features||{};return{frame:typeof features.pluginEditorFrame==='string'&&features.pluginEditorFrame.startsWith('modesty-bridge:/')?features.pluginEditorFrame:null,input:features.pluginEditorInput===true};}catch{featureRequest=null;return{frame:null,input:false};}})();
  return featureRequest;
}
function stylesheet(){if(document.querySelector('link[data-plugin-editor]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./plugin-editor.css',import.meta.url).href;link.dataset.pluginEditor='';document.head.append(link);}

/** Opens one plugin editor window. Closing it releases the lease; a failed release keeps the window open with a retry. */
/** Drag a floating editor by its title bar (like any effect window). Modal dialogs stay centred. */
function makeWindowMovable(dialog){
  const header=dialog.querySelector('header');if(!header)return;
  header.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('button,select,input,label')||dialog.matches?.(':modal'))return;
    const rect=dialog.getBoundingClientRect(),dx=event.clientX-rect.left,dy=event.clientY-rect.top;event.preventDefault();
    try{header.setPointerCapture(event.pointerId);}catch{}
    const move=e=>{const view=dialog.ownerDocument.defaultView,left=Math.max(40-rect.width,Math.min((view?.innerWidth||1200)-40,e.clientX-dx)),top=Math.max(0,Math.min((view?.innerHeight||800)-30,e.clientY-dy));Object.assign(dialog.style,{left:left+'px',top:top+'px',right:'auto',margin:'0'});};
    const end=()=>{header.removeEventListener('pointermove',move);header.removeEventListener('pointerup',end);header.removeEventListener('pointercancel',end);};
    header.addEventListener('pointermove',move);header.addEventListener('pointerup',end);header.addEventListener('pointercancel',end);
  });
}
export async function openPluginEditorWindow({monitor,call,readCall=null,cachedState=null,editorHttp=undefined,action=null,projectId,contextTrackId,target,ensureMonitor=null,editorFactory=null,onError=null,showControls=false,liveControl=null}={}){
  stylesheet();
  // The native EQ has no plug-in GUI to mirror: its window is the band editor.
  if(isNativeEqPlugin({type:target?.type,instance_id:target?.instanceId}))return openNativeEqWindow({call,action,projectId,contextTrackId,target,cachedState,onError});
  const label=target?.name||target?.type||'Plug-in',dialog=document.createElement('dialog');dialog.className='plugin-editor-window studio-dialog';dialog.setAttribute('aria-label',`${label} plugin editor`);
  dialog.innerHTML=`<header><span class="plugin-editor-dot"></span><strong>${esc(label)}</strong><small class="plugin-editor-slot">SLOT ${Number.isInteger(target?.pluginIndex)?target.pluginIndex+1:'?'}</small><label class="plugin-editor-zoom">Zoom <select aria-label="Editor zoom"><option value="auto">Fit</option><option value="0.5">50%</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></label><button type="button" class="plugin-editor-controls-toggle" aria-pressed="false">Controls</button><button type="button" class="plugin-editor-retry" hidden>Retry</button><button type="button" class="plugin-editor-release" hidden>Retry release</button><button type="button" class="plugin-editor-close" aria-label="Close ${esc(label)} editor">×</button></header><div class="plugin-editor-body"><div class="plugin-editor-viewport"></div><aside class="plugin-editor-controls" hidden></aside></div><footer class="plugin-editor-footer" role="status"></footer>`;
  document.body.append(dialog);
  try{if(document.querySelector('dialog.studio-dialog[open]:modal')||document.querySelector('dialog[open]:modal'))dialog.showModal();else dialog.show();}catch{try{dialog.showModal();}catch{dialog.setAttribute('open','');}}
  const $=selector=>dialog.querySelector(selector),footer=(text,error=false)=>{$('.plugin-editor-footer').textContent=text;$('.plugin-editor-footer').classList.toggle('error',error);};
  makeWindowMovable(dialog);
  const features=editorFactory?null:editorHttp??await editorHttpFeatures();
  const editor=editorFactory?editorFactory():new RemotePluginEditor({monitor,call,cachedState,http:!!features?.frame,httpInput:!!features?.input,...features?.frame?{frameRoute:features.frame}:{}});
  // Parameters are read only when the Controls panel is first shown (the Freestyle Studio loads them lazily too).
  const panel=new PluginParameterPanel({call,readCall,action,projectId,contextTrackId,target,liveControl});
  dialog.editor=editor;dialog.panel=panel;
  let controlsLoaded=false;
  const showPanel=visible=>{$('.plugin-editor-controls').hidden=!visible;$('.plugin-editor-controls-toggle').setAttribute('aria-pressed',String(visible));if(visible){if(!panel.container)panel.mount($('.plugin-editor-controls'));if(!controlsLoaded){controlsLoaded=true;panel.load().then(result=>{if(result&&!$('.plugin-editor-controls').hidden)panel.start();}).catch(error=>{controlsLoaded=false;onError?.(error);});}else if(panel.complete)panel.start();}else panel.stop();};
  $('.plugin-editor-controls-toggle').onclick=()=>showPanel($('.plugin-editor-controls').hidden);
  $('.plugin-editor-zoom select').onchange=event=>editor.setZoom?.(event.target.value);
  editor.addEventListener('state',event=>{const {state,message}=event.detail;dialog.dataset.editorState=state;footer(message,['error','release-failed','degraded'].includes(state));$('.plugin-editor-retry').hidden=state!=='error';$('.plugin-editor-release').hidden=state!=='release-failed';});
  // The generic controls are the fallback when the mirror cannot render.
  editor.addEventListener('error',()=>{if(editor.state==='error')showPanel(true);});
  let currentTarget=target;
  const open=async()=>{try{if(ensureMonitor)await ensureMonitor();await editor.open({...currentTarget,projectId,contextTrackId},$('.plugin-editor-viewport'));}catch(error){footer(describeEditorError(error,label),true);showPanel(true);onError?.(error);}};
  $('.plugin-editor-retry').onclick=()=>open();
  let closing=null;
  const close=async()=>{
    closing??=(async()=>{document.removeEventListener('visibilitychange',visibility);viewActivity.removeEventListener('change',visibility);panel.destroy();const result=await editor.close();if(!result.released){footer(`Release failed: ${describeEditorError(result.error,label)}`,true);$('.plugin-editor-release').hidden=false;closing=null;return result;}dialog.close();dialog.remove();return result;})();
    return closing;
  };
  dialog.closeEditor=close;
  // Frame polling stops while the page is hidden and resumes on the same open attempt.
  // Frame polling pauses while the tab is hidden or another Studio view is active.
  const visibility=()=>{if(viewHidden(document))editor.pause?.();else editor.resume?.();};document.addEventListener('visibilitychange',visibility);viewActivity.addEventListener('change',visibility);
  editor.addEventListener('instancechanged',event=>{const current=event.detail?.current;if(current)currentTarget={...target,pluginIndex:current.pluginIndex,instanceId:current.instanceId,type:current.typeId,name:current.name||target.name};footer(editor.message||'The plug-in in this slot changed. Reopen the editor.',true);$('.plugin-editor-retry').hidden=false;});
  $('.plugin-editor-close').onclick=()=>close();
  $('.plugin-editor-release').onclick=()=>close();
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  if(showControls)showPanel(true);
  dialog.opened=open();
  await dialog.opened;
  return dialog;
}

function openNativeEqWindow({call,action,projectId,contextTrackId,target,cachedState,onError}){
  const dialog=document.createElement('dialog');dialog.className='plugin-editor-window plugin-editor-native-eq studio-dialog';dialog.setAttribute('aria-label',`${target?.name||'EQ'} band editor`);
  dialog.innerHTML=`<header><span class="plugin-editor-dot"></span><strong>${esc(target?.name||'EQ')}</strong><small class="plugin-editor-slot">SLOT ${Number.isInteger(target?.pluginIndex)?target.pluginIndex+1:'?'} · NATIVE EQ</small><button type="button" class="plugin-editor-close" aria-label="Close EQ">×</button></header><div class="plugin-editor-body"><section class="plugin-editor-eq"></section></div>`;
  document.body.append(dialog);
  try{if(document.querySelector('dialog[open]:modal'))dialog.showModal();else dialog.show();}catch{try{dialog.showModal();}catch{dialog.setAttribute('open','');}}
  const editor=new NativeEqEditor({call:async(name,args)=>unpackMixerResult(await call(name,args)),action,projectId,contextTrackId,laneId:target.laneId,pluginIndex:target.pluginIndex,instanceId:target.instanceId,cachedState});
  dialog.eqEditor=editor;editor.mount(dialog.querySelector('.plugin-editor-eq'));
  const close=async()=>{editor.destroy();dialog.close?.();dialog.remove();return{released:true,leased:false};};
  dialog.closeEditor=close;dialog.querySelector('.plugin-editor-close').onclick=()=>close();dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.opened=editor.load().catch(error=>onError?.(error));
  return dialog.opened.then(()=>dialog);
}
