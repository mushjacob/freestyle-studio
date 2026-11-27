/**
 * Disabelton Device View (Live's bottom Detail View, Device side).
 *
 * Mounts into #abl-detail-device (owned by the shell's layout) as soon as it
 * exists, and shows the selected track's device chain left to right: a Drum Rack
 * for a step-sequenced pattern-rack track, then the instrument, then the audio
 * effects, then "Drop Audio Effects Here". Each device is a Live device box:
 * title bar with the orange activator (bypass), name, wrench (plug-in window),
 * fold arrow; the body shows the plug-in's typed parameters as knobs/switches
 * (abl-dev-params.js), or the lane EQ curve for the native EQ.
 *
 * Everything acts through host hooks wired in app.js to the existing guarded
 * paths (bypassEffectSlot, editEffectSlot move/remove, pluginDialog,
 * addLogicPlugin/insertLogicPlugin, recordPluginParameterHistory, mixer EQ).
 *
 * Public API (window.ablDevices):
 *  addPlugin(laneId, pluginRef) → Promise   pluginRef: catalog id string or {id|type|name}
 *  showLane(laneId)                         show that track's chain (selects it in the mixer)
 *  sync()                                   repaint after a chain/selection change
 */
import {AblKnob,AblSwitch} from './abl-dev-knob.js';
import {DeviceParamSession,identity,ablParameterText,ABL_DEVICE_FACE_PARAMETERS} from './abl-dev-params.js';
import {renderDrumRack,drumRackSignature} from './abl-dev-drumrack.js';
import {readPresetChoices,applyPresetChoice,neighbourChoice,ABL_PRESET_REASONS} from './abl-dev-presets.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const ABL_DEVICE_HOST='#abl-detail-device';
export const ABL_PLUGIN_MIME='application/x-abl-device';
const DEVICE_MIME='application/x-disabelton-device';
export const ABL_DEVICE_UNSUPPORTED=Object.freeze({
 rename:'Rename: Freestyle has no name field for a lane plug-in instance.',
 duplicate:'Duplicate: Freestyle has no plug-in instance copy; add the same plug-in again from the browser.',
 hotSwap:'Hot-Swap: drop (or double-click) an instrument from the Browser on this track to replace its instrument in place; effects are added from the Browser.',
});
/** Live's small title-bar glyphs (stroke icons, currentColor). */
const ABL_ICONS=Object.freeze({
 hand:'<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M4 6V2.5a.7.7 0 0 1 1.4 0V5.5M5.4 5V1.8a.7.7 0 0 1 1.4 0V5.3M6.8 5.2V2.4a.7.7 0 0 1 1.4 0v3.4M8.2 5.4V3.6a.7.7 0 0 1 1.4 0v3.6c0 2-1.3 3.6-3.3 3.6-1.3 0-2.1-.6-2.8-1.6L2 6.9a.7.7 0 0 1 1.1-.8L4 7" fill="none" stroke="currentColor" stroke-width=".9" stroke-linejoin="round"/></svg>',
 wrench:'<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M7.8 1.3a2.6 2.6 0 0 0-2.4 3.5L1.5 8.7a1 1 0 0 0 1.4 1.4l3.9-3.9a2.6 2.6 0 0 0 3.5-2.4l-1.6 1-1.4-.4-.4-1.4z" fill="none" stroke="currentColor" stroke-width=".9" stroke-linejoin="round"/></svg>',
});
const typeOf=plugin=>String(plugin?.type_id??plugin?.typeId??plugin?.type??'');
export const isNativeEq=plugin=>typeOf(plugin)==='native-eq';
/** A Freestyle native effect (format "native" or a native-* type): no plug-in GUI, the built-in editor instead. */
export const isNative=plugin=>{const has=plugin?.hasEditor??plugin?.has_editor;if(typeof has==='boolean')return !has;/* Freestyle #6 */return plugin?.format==='native'||typeOf(plugin).startsWith('native-');};
/** The chain signature that decides a full re-render (values repaint in place). */
export function chainSignature(chain){return JSON.stringify(chain?{l:chain.laneId,n:chain.name,c:chain.color,h:(chain.plugins||[]).map(item=>item.hostLaneId||'').join(),m:!!chain.midi,b:!!chain.busy,r:!!chain.reading,e:chain.error||'',a:!!chain.canAdd,p:(chain.plugins||[]).map(plugin=>[plugin.index,identity(plugin),plugin.name,!!plugin.bypassed,!!plugin.bypassKnown,!!plugin.instrument,!!plugin.savedChain]),rack:drumRackSignature(chain.rack)}:null);}

export class AblDeviceView{
 constructor(hooks={}){
  this.hooks=hooks;this.document=hooks.document||globalThis.document;this.host=null;this.signature=null;this.sessions=new Map();this.knobs=[];this.folded=new Set();this.rackState={bank:0};this.rackView=null;this.eqSections=[];this.readRequests=new Set();this.projectKey=null;this.laneId=null;this.destroyed=false;this.armed=new Set();this.pendingAdds=[];this.pendingSeq=0;
  const Observer=this.document.defaultView?.MutationObserver||globalThis.MutationObserver;
  if(Observer){this.observer=new Observer(()=>{if(!this.host?.isConnected&&this.document.querySelector(ABL_DEVICE_HOST))this.sync();});this.observer.observe(this.document.documentElement||this.document,{childList:true,subtree:true});}
  // GUI → knobs: input in a plug-in window this view opened (GUI mirror clicks/drags/keys, parameter page) re-reads
  // that instance's values once the write lands (Freestyle pushes the new editor frame ≈110 ms after a write).
  this.onWindowInput=event=>{const d=event.target?.closest?.('dialog[data-abl-instance]');if(!d)return;this.refreshInstance(d.dataset.ablInstance,d.dataset.ablLane,event.type==='keyup'?300:250);};
  for(const type of ['pointerup','keyup','change','wheel'])this.document.addEventListener(type,this.onWindowInput,true);
  this.onValues=event=>this.adoptValues(event.detail);this.document.defaultView?.addEventListener('abl:plugin-values',this.onValues);
  this.sync();
 }
 call(name,...args){try{const result=this.hooks[name]?.(...args);if(result&&typeof result.catch==='function')result.catch(error=>this.fail(error));return result;}catch(error){this.fail(error);return null;}}
 fail(error){try{this.hooks.fail?.(error);}catch{}}
 log(event,data){try{this.hooks.log?.(event,data);}catch{}}
 attach(){const host=this.document.querySelector(ABL_DEVICE_HOST);if(host!==this.host){this.host=host;this.signature=null;if(host){host.classList.add('abl-device-view');this.bindSelection(host);host.addEventListener('contextmenu',event=>{if(!event.defaultPrevented)event.preventDefault();});this.bindDrop(host);
   // Working in the Device View arms its background reads for the shown track (no re-render: the press keeps its target).
   for(const type of ['pointerdown','focusin','pointerenter'])host.addEventListener(type,()=>this.arm(this.currentLane()));}}return host;}
 /* ---- Reads. Rendering only paints cached state (deviceChain, loaded sessions); every engine read runs in the
  * background, only for a track the user is working with in a visible Device View, after the current cloud
  * operation settles. A guard refusal ("Wait for the current cloud operation…") is retried, never surfaced. */
 laneKey(laneId){return `${this.projectKey}|${laneId}`;}
 visible(){const host=this.host;return !!host&&host.isConnected&&!host.hidden&&!host.closest?.('[hidden]');}
 canRead(laneId){let ready=true;try{ready=this.hooks.ready?.()!==false;}catch{ready=false;}return !!laneId&&ready&&this.armed.has(this.laneKey(laneId))&&this.visible();}
 /** A queued chain read re-checks when it finally runs (settled() can wait out a write): a write receipt or the app's own
  * read may have confirmed the chain meanwhile, or its shape changed — then it is dropped, never repeated. */
 chainReadStillNeeded(laneId,key,project){
  let current=null;try{current=this.hooks.projectId?.()??null;}catch{}const chain=current===project?this.chainOf(laneId):null;
  const needed=!!chain&&!chain.cached&&!chain.reading&&!chain.busy&&!!chain.plugins?.length&&key===`${project}|${laneId}|${chain.plugins.map(identity).join(',')}`;
  if(!needed){this.readRequests.delete(key);this.log('abl-device-chain-read-skipped',{laneId,cached:!!chain?.cached});}
  return needed;
 }
 arm(laneId){if(!laneId||this.destroyed)return;const key=this.laneKey(laneId);if(this.armed.has(key))return;this.armed.add(key);this.kick(laneId);}
 /** Start the reads a newly armed track was waiting for, repainting only the waiting bodies. */
 kick(laneId){
  if(!this.canRead(laneId)||!this.host)return;this.sync();this.mountWaiting(laneId);
 }
 /** Mount the bodies still waiting for a read (EQ curve, parameter page) once their lane is armed and shown — also when
  * the arm (idle warm) happened while the Device View was hidden and the next sync finds an unchanged chain. */
 mountWaiting(laneId){
  if(!this.host||!this.canRead(laneId))return;
  for(const body of this.host.querySelectorAll('.abl-device-body[data-waiting]')){const box=body.closest('.abl-device'),chain=this.chainOf(laneId),plugin=(chain?.plugins||[]).find(item=>String(identity(item))===box?.dataset.device&&item.index===Number(box?.dataset.index));if(chain&&plugin)this.mountBody(box,chain,plugin);}
 }
 chainOf(laneId){try{return laneId?this.hooks.deviceChain?.(laneId)??null:null;}catch(error){this.log('abl-device-chain-error',{message:String(error?.message||error).slice(0,160)});return null;}}
 /** Transient: a guarded operation is running, or the project moved on while a REST snapshot loaded (an Undo/edit landed). Retried, never shown. */
 static isGuardRefusal(error){return /current cloud operation|operation to finish|cloud project changed|project changed while|fresh snapshot/i.test(String(error?.message||error));}
 /** Run a read after the app is idle; retry while a guarded operation is still running (bounded, backing off 250 ms → 4 s). */
 async settled(task,{tries=24,delay=250}={}){
  for(let attempt=0;;attempt++){
   if(this.destroyed)return null;try{await this.hooks.idle?.();}catch{}
   await new Promise(resolve=>setTimeout(resolve,attempt?Math.min(delay*2**Math.max(0,attempt-2),4000):0));if(this.destroyed)return null;
   // Never start a background read during a gesture (held key, drag, audition): wait until it ends (bounded ~2 min).
   for(let wait=0;wait<480&&this.gestureActive()&&!this.destroyed;wait++)await new Promise(resolve=>setTimeout(resolve,250));if(this.destroyed)return null;
   try{return await task();}catch(error){if(!AblDeviceView.isGuardRefusal(error)||attempt>=tries)throw error;if(!attempt)this.log('abl-device-read-deferred',{message:String(error?.message||error).slice(0,120)});}
  }
 }
 /** Show `laneId` (also selects it in the mixer so every view agrees). */
 /** arm:false paints the cached chain only (no engine read) — automatic/background selections. */
 showLane(laneId,{arm=true}={}){this.call('selectLane',laneId);this.laneId=laneId;this.sync();if(arm)this.arm(laneId);}
 /** A held key, drag or audition is in progress (hooks.gestureActive): background reads wait for it. */
 gestureActive(){try{return !!this.hooks.gestureActive?.();}catch{return false;}}
 /** The lane that owns a device: a pattern track can show the instrument hosted on another track (plugin.hostLaneId). */
 laneFor(chain,plugin){return plugin?.hostLaneId||chain?.laneId||null;}
 currentLane(){let lane=null;try{lane=this.hooks.selectedLaneId?.()??null;}catch{}return lane||this.laneId||null;}
 sync(){
  if(this.destroyed)return;const host=this.attach();if(!host)return;
  let project=null;try{project=this.hooks.projectId?.()??null;}catch{}if(project!==this.projectKey){
   // A reload of the same project (load version bump, e.g. after an Undo) keeps the lanes the user was working with armed.
   const prior=this.projectKey,same=!!prior&&!!project&&prior.split('|')[0]===project.split('|')[0],carry=same?[...this.armed].filter(key=>key.startsWith(`${prior}|`)).map(key=>key.slice(prior.length+1)):[];
   this.projectKey=project;this.closeSessions();this.readRequests.clear();this.signature=null;for(const lane of carry)this.armed.add(this.laneKey(lane));}
  const laneId=this.currentLane(),chain=this.chainOf(laneId);
  // QA r6 ("Cloud render check" stayed on "Reading the EQ…"): a track shown WITHOUT the shell's abl:track-select (selected
  // through a clip / Session slot / mixer strip, which only move the mixer selection) was never armed, so its EQ body
  // waited for a pointer in the Device View. A newly shown, unarmed lane now asks for the same idle warm (onLaneShown).
  if(laneId!==this.shownLane){this.shownLane=laneId;if(laneId&&!this.armed.has(this.laneKey(laneId)))try{this.onLaneShown?.(laneId);}catch{}}
  // The live chain (bypass state, exact slots) is read once per lane/chain shape, in the background; the saved chain shows meanwhile.
  if(chain&&!chain.cached&&!chain.reading&&!chain.busy&&chain.plugins?.length&&this.canRead(laneId)){const key=`${project}|${laneId}|${(chain.plugins||[]).map(identity).join(',')}`;if(!this.readRequests.has(key)){this.readRequests.add(key);this.settled(()=>this.chainReadStillNeeded(laneId,key,project)?this.hooks.requestChainRead?.(laneId):null).catch(error=>{this.readRequests.delete(key);this.log('abl-device-chain-read-error',{message:String(error?.message||error).slice(0,160)});});}}
  const signature=chainSignature(chain);
  // A knob or EQ Eight gesture in progress keeps its device boxes (a re-render would drop the gesture's release).
  const holding=this.knobs.some(knob=>knob.active)||this.eqSections.some(section=>{try{return !!section.gesturing?.();}catch{return false;}});
  if(signature===this.signature&&!holding){this.repaintValues();this.mountWaiting(laneId);return;}
  if(holding){this.pending=true;return;}
  this.signature=signature;
  // A paint failure stays in the view (logged), never escaping into the caller's render pass.
  try{this.render(host,chain);}catch(error){this.signature=null;this.log('abl-device-render-error',{message:String(error?.message||error).slice(0,160)});host.innerHTML=`<div class="abl-device-chain abl-device-empty"><p class="abl-device-note error" role="status">${esc(error?.message||error)}</p></div>`;}
 }
 closeSessions(){for(const session of this.sessions.values())session.close();this.sessions.clear();}
 session(chain,plugin){
  const key=`${this.projectKey}|${this.laneFor(chain,plugin)}|${identity(plugin)}|${plugin.index}`;let session=this.sessions.get(key);
  if(!session){const c=this.hooks.channelFor?.(this.laneFor(chain,plugin));session=new DeviceParamSession({channel:c,plugin,load:(channel,item)=>this.settled(()=>this.hooks.loadParameters(channel,item)),record:packet=>this.hooks.recordParameterStep?.(packet),historyScope:()=>this.hooks.historyScope?.(),refreshGui:detail=>this.hooks.refreshGui?.({...detail,laneId:this.laneFor(chain,plugin)}),idle:()=>this.hooks.idle?.(),log:(event,data)=>this.log(event,data),onError:error=>this.fail(error)});session.addEventListener('change',()=>this.repaintSession(session));this.sessions.set(key,session);}
  else session.plugin=plugin;
  return session;
 }
 destroyBodies(keep=new Set()){for(const knob of this.knobs)knob.destroy();this.knobs=[];this.rackView?.destroy?.();this.rackView=null;for(const section of this.eqSections)if(!keep.has(section))try{section.destroy?.();}catch{}this.eqSections=[];}
 /** QA r10 (adding Free Comp blanked the EQ to "Reading the EQ…"): a chain re-render keeps every EQ Eight body that is
  *  mounted (or mounting) for the same project, lane and instance; the new box adopts it instead of re-reading. */
 keptEqBodies(host,chain){
  const kept=new Map();if(!chain||!host)return kept;const old=host.querySelector(':scope > .abl-device-chain');if(!old||old.dataset.laneId!==String(chain.laneId))return kept;
  for(const box of old.querySelectorAll(':scope > .abl-device.abl-eq-device[data-device]')){const body=box.querySelector(':scope > .abl-device-body');if(!body||body.dataset.eqProject!==String(this.projectKey))continue;
   const section=this.eqSections.find(item=>item?.element&&body.contains(item.element))||null;if(section||body.dataset.eqMounting)kept.set(box.dataset.device,{body,section});}
  return kept;}
 render(host,chain){
  const kept=this.keptEqBodies(host,chain);
  this.destroyBodies(new Set([...kept.values()].map(item=>item.section).filter(Boolean)));
  if(!chain){host.innerHTML=`<div class="abl-device-chain abl-device-empty"><p>${this.hooks.ready?.()===false?'Open a Freestyle project to see its devices.':'Select a track to see its devices.'}</p></div>`;return;}
  const plugins=chain.plugins||[],instrument=plugins.filter(plugin=>plugin.instrument),effects=plugins.filter(plugin=>!plugin.instrument);
  const status=chain.reading?'<span class="abl-device-status" role="status">Reading devices…</span>':chain.error?`<span class="abl-device-status error" role="status">${esc(chain.error)}</span>`:'';
  host.innerHTML=`<div class="abl-device-chain" data-lane-id="${esc(chain.laneId)}" style="--abl-track-color:${esc(chain.color||'#a6a6a6')}" aria-label="Devices on ${esc(chain.name)}">${status}${chain.rack?this.rackHtml(chain):''}${[...instrument,...effects].map(plugin=>this.deviceHtml(chain,plugin)).join('')}${this.pendingHtml(chain.laneId)}<div class="abl-device-drop" data-device-drop tabindex="0">${chain.canAdd?'<button type="button" class="abl-device-add" data-device-add title="Add an audio effect" aria-label="Add an audio effect">+</button>':''}<span>${chain.midi&&!chain.rack&&!(chain.plugins||[]).some(item=>item.instrument)?'Drop an Instrument or Sample Here':'Drop Audio Effects Here'}</span></div></div>`;
  if(chain.rack){const body=host.querySelector('.abl-device[data-rack] .abl-device-body');if(body&&!this.folded.has('rack'))this.rackView=renderDrumRack(body,chain.rack,{...this.rackHooks(),onError:error=>this.fail(error)},this.rackState);this.bindTitle(host.querySelector('.abl-device[data-rack]'),chain,null);}
  for(const plugin of plugins){const box=[...host.querySelectorAll('.abl-device[data-device]')].find(node=>node.dataset.device===String(identity(plugin))&&Number(node.dataset.index)===plugin.index);if(!box)continue;this.bindTitle(box,chain,plugin);if(this.folded.has(identity(plugin)))continue;
   const keep=isNativeEq(plugin)?kept.get(String(identity(plugin))):null;if(keep){kept.delete(String(identity(plugin)));box.querySelector(':scope > .abl-device-body')?.replaceWith(keep.body);if(keep.section)this.eqSections.push(keep.section);continue;}
   this.mountBody(box,chain,plugin);}
  // EQ bodies whose device left the chain (removed, folded, moved to a new identity) are released.
  for(const {section}of kept.values())try{section?.destroy?.();}catch{}
  const add=host.querySelector('[data-device-add]');if(add)add.onclick=event=>{event.stopPropagation();this.call('openAddMenu',chain.laneId,event,add.getBoundingClientRect?.()||null);};
 }
 rackHtml(chain){const folded=this.folded.has('rack');return `<section class="abl-device abl-drum-rack-device${folded?' folded':''}" data-rack aria-label="Drum Rack"><header class="abl-device-title"><button type="button" class="abl-device-activator on" disabled title="Drum Rack: mute pads individually (M)" aria-label="Drum Rack on"></button><span class="abl-device-name">Drum Rack</span><button type="button" class="abl-device-fold" data-device-fold title="${folded?'Unfold':'Fold'} device" aria-expanded="${!folded}">${folded?'▸':'▾'}</button></header><div class="abl-device-body"></div></section>`;}
 deviceHtml(chain,plugin){
  const id=identity(plugin)||'',folded=this.folded.has(id),known=!!plugin.bypassKnown,on=known&&!plugin.bypassed,busy=!!chain.busy||!!chain.reading,name=plugin.displayName||plugin.name||typeOf(plugin)||'Plug-in';
  const activatorTitle=known?`${plugin.bypassed?'Activate':'Deactivate'} ${name}`:'Reading this device’s on/off state from Freestyle…';
  return `<section class="abl-device${plugin.instrument?' abl-instrument':''}${isNativeEq(plugin)?' abl-eq-device':''}${folded?' folded':''}${known&&plugin.bypassed?' off':''}" data-device="${esc(id)}" data-index="${plugin.index}" aria-label="${esc(name)}"><header class="abl-device-title" draggable="${!plugin.instrument&&!plugin.savedChain}"><button type="button" class="abl-device-activator${on?' on':''}${known?'':' unknown'}" data-device-activator aria-pressed="${known?String(on):'mixed'}" ${busy?'disabled':''} title="${esc(activatorTitle)}" aria-label="${esc(name)} on/off"></button><span class="abl-device-name" title="${esc(name)}">${esc(name)}</span>${plugin.hostedOn?`<span class="abl-device-host" title="This instrument lives on ${esc(plugin.hostedOn)}; edits change that instance">on ${esc(plugin.hostedOn)}</span>`:''}${/* Live's preset area: ▾ chooser; instruments also get Pro's previous / next sound arrows. */''}<span class="abl-device-presets">${plugin.instrument?`<button type="button" class="abl-device-step" data-device-prev ${busy?'disabled':''} title="Previous preset (Studio Pro: ↑ Previous sound)" aria-label="Previous preset of ${esc(name)}">◀</button><button type="button" class="abl-device-step" data-device-next ${busy?'disabled':''} title="Next preset (Studio Pro: ↓ Next sound)" aria-label="Next preset of ${esc(name)}">▶</button>`:''}<button type="button" class="abl-device-preset" data-device-preset aria-haspopup="menu" ${busy?'disabled':''} title="Presets of ${esc(name)}" aria-label="Presets of ${esc(name)}">▾</button></span><span class="abl-device-icons"><button type="button" class="abl-device-hand" disabled title="${esc(ABL_DEVICE_UNSUPPORTED.hotSwap)}" aria-label="Hot-Swap (unavailable)">${ABL_ICONS.hand}</button>${/* Native effects (EQ included) open the built-in editor; third-party plug-ins their GUI. */''}<button type="button" class="abl-device-wrench" data-device-window title="${isNative(plugin)?'Show the built-in editor':'Show plug-in window'}" aria-label="Show ${esc(name)} ${isNative(plugin)?'editor':'plug-in window'}">${ABL_ICONS.wrench}</button><button type="button" class="abl-device-fold" data-device-fold title="${folded?'Unfold':'Fold'} device" aria-expanded="${!folded}">${folded?'▸':'▾'}</button></span></header><div class="abl-device-body"></div></section>`;
 }
 bindTitle(box,chain,plugin){
  if(!box)return;const id=plugin?identity(plugin):'rack';
  box.querySelector('[data-device-fold]')?.addEventListener('click',event=>{event.stopPropagation();if(this.folded.has(id))this.folded.delete(id);else this.folded.add(id);this.signature=null;this.sync();});
  if(!plugin)return;
  box.querySelector('[data-device-activator]')?.addEventListener('click',event=>{event.stopPropagation();this.toggleBypass(chain,plugin,event.currentTarget);});
  box.querySelector('[data-device-preset]')?.addEventListener('click',event=>{event.stopPropagation();this.presetMenu(event,chain,plugin).catch(error=>this.fail(error));});
  box.querySelector('[data-device-prev]')?.addEventListener('click',event=>{event.stopPropagation();this.stepPreset(chain,plugin,-1).catch(error=>this.fail(error));});
  box.querySelector('[data-device-next]')?.addEventListener('click',event=>{event.stopPropagation();this.stepPreset(chain,plugin,1).catch(error=>this.fail(error));});
  box.querySelector('[data-device-window]')?.addEventListener('click',event=>{event.stopPropagation();this.openWindow(this.laneFor(chain,plugin),plugin);});
  box.addEventListener('contextmenu',event=>{if(event.target.closest('.abl-knob,.abl-switch,.abl-eq-section'))return;event.preventDefault();event.stopPropagation();this.deviceMenu(event,chain,plugin);});
  box.querySelector('.abl-device-name')?.addEventListener('dblclick',event=>{event.stopPropagation();this.openWindow(this.laneFor(chain,plugin),plugin);});
  const title=box.querySelector('.abl-device-title');
  title?.addEventListener('dragstart',event=>{if(plugin.instrument||plugin.savedChain){event.preventDefault();return;}event.dataTransfer?.setData(DEVICE_MIME,JSON.stringify({laneId:chain.laneId,index:plugin.index,instanceId:identity(plugin)}));if(event.dataTransfer)event.dataTransfer.effectAllowed='move';box.classList.add('dragging');});
  title?.addEventListener('dragend',()=>box.classList.remove('dragging'));
  box.addEventListener('dragover',event=>{if(![...(event.dataTransfer?.types||[])].includes(DEVICE_MIME)||plugin.instrument)return;event.preventDefault();box.classList.add('drop-before');});
  box.addEventListener('dragleave',()=>box.classList.remove('drop-before'));
  box.addEventListener('drop',event=>{box.classList.remove('drop-before');const raw=event.dataTransfer?.getData?.(DEVICE_MIME);if(!raw||plugin.instrument)return;event.preventDefault();event.stopPropagation();this.dropDevice(raw,chain,plugin.index);});
 }
 toggleBypass(chain,plugin,button){
  if(!plugin.bypassKnown){this.call('requestChainRead',chain.laneId);this.call('toast',`Reading ${plugin.name||'the device'}’s on/off state; click its activator again in a moment.`);return;}
  // Optimistic: the activator flips at the click; the chain read after the write (or a refusal) repaints it.
  button.classList.toggle('on',!!plugin.bypassed);button.setAttribute('aria-pressed',String(!!plugin.bypassed));button.closest('.abl-device')?.classList.toggle('off',!plugin.bypassed);button.disabled=true;
  Promise.resolve(this.call('toggleBypass',this.laneFor(chain,plugin),plugin)).catch(()=>{}).finally(()=>{this.signature=null;this.sync();});
 }
 deviceMenu(event,chain,plugin){
  const effects=(chain.plugins||[]).filter(item=>!item.instrument&&!item.savedChain).map(item=>item.index).sort((a,b)=>a-b),at=effects.indexOf(plugin.index);
  const name=plugin.name||'Device',busy=!!chain.busy||!!chain.reading;
  this.call('menu',event,[
   {label:isNative(plugin)?'Show Editor':'Show Plug-In Window',run:()=>this.openWindow(this.laneFor(chain,plugin),plugin)},
   {label:plugin.bypassed?'Activate':'Deactivate',disabled:busy||!plugin.bypassKnown,title:plugin.bypassKnown?'':'Reading the device’s on/off state first',run:()=>this.call('toggleBypass',this.laneFor(chain,plugin),plugin)},
   null,
   {label:'Rename',shortcut:'⌘R',disabled:true,title:ABL_DEVICE_UNSUPPORTED.rename},
   {label:'Duplicate',shortcut:'⌘D',disabled:true,title:ABL_DEVICE_UNSUPPORTED.duplicate},
   {label:'Delete',shortcut:'⌫',disabled:busy||plugin.savedChain||!!plugin.hostedOn,title:plugin.hostedOn?`Delete it on ${plugin.hostedOn}`:'',run:()=>this.call('removePlugin',this.laneFor(chain,plugin),plugin)},
   null,
   {label:'Move Left',disabled:busy||plugin.instrument||at<=0,run:()=>this.call('movePlugin',this.laneFor(chain,plugin),plugin,effects[at-1])},
   {label:'Move Right',disabled:busy||plugin.instrument||at<0||at>=effects.length-1,run:()=>this.call('movePlugin',this.laneFor(chain,plugin),plugin,effects[at+1])},
   null,
   {label:this.folded.has(identity(plugin))?'Unfold':'Fold',run:()=>{const id=identity(plugin);if(this.folded.has(id))this.folded.delete(id);else this.folded.add(id);this.signature=null;this.sync();}},
  ]);
  this.log('abl-device-menu',{laneId:this.laneFor(chain,plugin),pluginIndex:plugin.index});
 }
 /* ---- Presets (abl-dev-presets.js): the title-bar ▾ chooser and the instrument ◀ ▶ arrows. ---- */
 studioClient(){try{return this.hooks.studioClient?.()??null;}catch{return null;}}
 /** The device's loaded parameter controller and its preset choices (cached on the session until a write). */
 async presetChoices(chain,plugin,{force=false}={}){
  const session=this.session(chain,plugin),controller=await session.load();if(!controller)throw new Error(session.error||'Load this device’s parameters first.');
  if(!force&&session.presetChoices&&session.presetController===controller)return{session,controller,choices:session.presetChoices};
  const choices=await readPresetChoices({controller,plugin,laneId:this.laneFor(chain,plugin),client:this.studioClient(),log:(event,data)=>this.log(event,data)});
  session.presetChoices=choices;session.presetController=controller;return{session,controller,choices};
 }
 async presetMenu(event,chain,plugin){
  const button=event.currentTarget||event.target,rect=button?.getBoundingClientRect?.(),at={clientX:rect?rect.left:event.clientX,clientY:rect?rect.bottom:event.clientY,target:button,currentTarget:button,preventDefault(){},stopPropagation(){}};
  const {choices}=await this.presetChoices(chain,plugin);const chainItem={label:'Chain Presets…',disabled:true,title:ABL_PRESET_REASONS.chain};
  if(choices.kind==='none'){this.call('menu',at,[{label:'No Presets',disabled:true,title:choices.reason},null,chainItem]);this.log('abl-device-presets',{kind:'none',pluginIndex:plugin.index});return;}
  const item=choice=>({label:choice.label,checked:choice.value===choices.current,run:()=>this.applyPreset(chain,plugin,choice.value)});
  // Long named catalogs ("Music/Ad Libs") fold into one submenu per category, as Live's browser folders do.
  let items=choices.items.map(item);
  if(choices.items.length>24){const groups=new Map();for(const choice of choices.items){const [head,...rest]=String(choice.label).split('/');const key=rest.length?head:'Other';if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...item(choice),label:rest.length?rest.join('/'):choice.label});}if(groups.size>1)items=[...groups].map(([label,submenu])=>({label,submenu}));}
  this.call('menu',at,[...items,null,...choices.kind==='preset'?[{label:'Undo restores program changes only',disabled:true,title:ABL_PRESET_REASONS.namedUndo}]:[],chainItem]);
  this.log('abl-device-presets',{kind:choices.kind,count:choices.items.length,pluginIndex:plugin.index});
 }
 async stepPreset(chain,plugin,direction){
  // QA r18: the first ◀/▶ after a load waits for the (slow, uncached) patch list before applyPreset marks the step
  // pending; a ⌘Z in that gap found an empty history. Mark it pending from the click; applyPreset holds its own mark.
  globalThis.ablPendingHistorySteps=(Number(globalThis.ablPendingHistorySteps)||0)+1;
  let applying=null;
  // QA r21: say something on the click, not only after the (possibly slow, uncached) patch list read.
  try{this.call('toast',`${plugin.displayName||plugin.name||'Device'}: ${direction<0?'previous':'next'} preset…`,{transient:true});}catch{}
  try{
   const {choices}=await this.presetChoices(chain,plugin);
   if(choices.kind==='none')return void this.call('toast',choices.reason);
   const next=neighbourChoice(choices,direction);if(!next)return void this.call('toast',direction<0?'Already at the first preset.':'Already at the last preset.');
   applying=this.applyPreset(chain,plugin,next.value);
  }finally{globalThis.ablPendingHistorySteps=Math.max(0,(Number(globalThis.ablPendingHistorySteps)||0)-1);}
  return applying;
 }
 /** One preset/program write (instance-checked), then the knobs re-read. A program change is ONE Undo step. */
 async applyPreset(chain,plugin,value){
  if(this.presetApplying)return void this.call('toast','Wait for the current preset to load.');
  // QA r17: a ⌘Z pressed while the patch is in flight must wait for this step, not find an empty history.
  globalThis.ablPendingHistorySteps=(Number(globalThis.ablPendingHistorySteps)||0)+1;let pendingStep=true;const endPending=()=>{if(pendingStep){pendingStep=false;globalThis.ablPendingHistorySteps=Math.max(0,(Number(globalThis.ablPendingHistorySteps)||0)-1);}};
  const laneId=this.laneFor(chain,plugin),name=plugin.displayName||plugin.name||'Device';
  let picked;try{picked=await this.presetChoices(chain,plugin);}catch(error){endPending();throw error;}const {session,controller,choices}=picked;const label=choices.items.find(item=>item.value===value)?.label??String(value);
  this.presetApplying=true;const box=[...(this.host?.querySelectorAll('.abl-device[data-device]')||[])].find(node=>node.dataset.device===String(identity(plugin)));box?.setAttribute('aria-busy','true');
  const refresh=async()=>{session.presetChoices=null;if(!session.closed)await session.load({force:true});};
  try{
   const result=await applyPresetChoice({controller,plugin,laneId,choices,value,reload:()=>this.hooks.loadParameters(session.channel,plugin)});
   this.log('abl-device-preset-applied',{laneId,pluginIndex:plugin.index,kind:choices.kind,changed:result.changed});
   if(result.changed&&result.undo&&result.redo){// The repaint must not be awaited inside the history step: session.load({force}) defers until the current
   // cloud operation ends, and the Undo/Redo IS that operation, so awaiting it deadlocked (live QA r15).
   const wrap=fn=>async()=>{const receipt=await fn();setTimeout(()=>{refresh().catch(()=>{});},0);return receipt;};
    let recorded=false;try{recorded=!!this.hooks.recordHistoryStep?.({kind:choices.kind==='patch'?'instrument_patch':'plugin_program',label:`${name} ${choices.kind==='patch'?'Patch':'Program'}`,undo:wrap(result.undo),redo:wrap(result.redo),detail:{laneId,pluginIndex:plugin.index,from:result.from,to:result.to}});}catch{}endPending();
    const savedNote=choices.kind==='patch'&&!result.unsaved?' Saved in Freestyle.':'';
    this.call('toast',recorded?`${name}: ${label}.${savedNote}`:`${name}: ${label}.${savedNote} (Not added to Undo History: history is busy.)`);}
   if(choices.kind==='patch'&&result.changed){if(!(result.undo&&result.redo))this.call('toast',`${name}: ${label}. ${ABL_PRESET_REASONS.patchNoUndo}`,{transient:true});if(result.unsaved)this.call('toast',`${name}: ${label}. ${ABL_PRESET_REASONS.patchUnsaved}`,{transient:true});}
   else if(result.changed&&!(result.undo&&result.redo))this.call('toast',`${name}: ${label} applied. ${ABL_PRESET_REASONS.namedUndo}`);
   await refresh();return result;
  }finally{endPending();this.presetApplying=false;box?.removeAttribute('aria-busy');}
 }
 dropDevice(raw,chain,toIndex){let data;try{data=JSON.parse(raw);}catch{return;}if(data.laneId!==chain.laneId)return this.fail(new Error('Freestyle moves effects within one track only.'));const plugin=(chain.plugins||[]).find(item=>item.index===data.index&&identity(item)===data.instanceId);if(!plugin||plugin.index===toIndex)return;this.call('movePlugin',this.laneFor(chain,plugin),plugin,toIndex);}
 /** Live: a click on a device's title bar selects the device; Delete / Backspace then removes it (the same write and
  * guards as the context menu's Delete — one Undo step). The selection survives re-renders of the chain. */
 bindSelection(host){
  if(host.tabIndex<0&&!host.hasAttribute('tabindex'))host.tabIndex=-1;
  const paint=()=>{for(const box of host.querySelectorAll('.abl-device[data-device]'))box.classList.toggle('selected',!!this.selectedDevice&&box.dataset.device===this.selectedDevice);};
  host.addEventListener('pointerdown',event=>{const box=event.target.closest?.('.abl-device[data-device]');if(!box){if(!event.target.closest?.('button,input,select'))this.selectedDevice=null;paint();return;}
   if(!event.target.closest('.abl-device-title')||event.target.closest('button'))return;this.selectedDevice=box.dataset.device;paint();try{host.focus({preventScroll:true});}catch{}});
  host.addEventListener('keydown',event=>{
   // Live: ⌘R renames the selected device. Freestyle stores no name for a plug-in instance, so the key answers with that.
   if(event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&String(event.key).toLowerCase()==='r'&&this.selectedDevice){event.preventDefault();event.stopPropagation();this.call('toast',ABL_DEVICE_UNSUPPORTED.rename);return;}
   if(event.key!=='Delete'&&event.key!=='Backspace'||event.metaKey||event.ctrlKey||event.altKey||!this.selectedDevice)return;
   if(event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),.abl-knob,.abl-eq-section'))return;
   const laneId=host.querySelector('.abl-device-chain')?.dataset.laneId,chain=laneId?this.hooks.deviceChain?.(laneId):null,plugin=(chain?.plugins||[]).find(item=>identity(item)===this.selectedDevice);if(!plugin)return;
   event.preventDefault();event.stopPropagation();
   /* A row still shown from the saved chain (the live inventory read can take many seconds) is deleted through the same edit path, which reads the live slot first. */if(plugin.hostedOn||chain.busy){this.call('toast',plugin.hostedOn?`Delete it on ${plugin.hostedOn}.`:'Wait for the current device edit to finish, then delete.');return;}
   this.selectedDevice=null;this.call('removePlugin',this.laneFor(chain,plugin),plugin);});
  const Observer=this.document.defaultView?.MutationObserver||globalThis.MutationObserver;if(Observer){const observer=new Observer(paint);observer.observe(host,{childList:true,subtree:true});}
 }
 bindDrop(host){
  host.addEventListener('dragover',event=>{const types=[...(event.dataTransfer?.types||[])];if(!types.includes(ABL_PLUGIN_MIME)&&!types.includes(DEVICE_MIME))return;event.preventDefault();host.classList.add('drop-target');});
  host.addEventListener('dragleave',event=>{if(!host.contains(event.relatedTarget))host.classList.remove('drop-target');});
  host.addEventListener('drop',event=>{host.classList.remove('drop-target');const laneId=host.querySelector('.abl-device-chain')?.dataset.laneId;
   const device=event.dataTransfer?.getData?.(DEVICE_MIME);if(device&&event.target.closest?.('[data-device-drop]')){event.preventDefault();const chain=laneId?this.hooks.deviceChain?.(laneId):null;const last=(chain?.plugins||[]).filter(item=>!item.instrument&&!item.savedChain).map(item=>item.index).sort((a,b)=>a-b).at(-1);if(chain&&Number.isInteger(last))this.dropDevice(device,chain,last);return;}
   const raw=event.dataTransfer?.getData?.(ABL_PLUGIN_MIME);if(!raw)return;event.preventDefault();event.stopPropagation();if(!laneId)return this.fail(new Error('Select a track before adding a device.'));let ref=raw;try{ref=JSON.parse(raw);}catch{}
   // Live: a device dropped between two devices is inserted there. Freestyle adds at the end of the chain, so the
   // new device is then moved to the drop position (the chain's own move write; instruments keep slot 0).
   const target=this.dropIndex(host,event.clientX);
   this.addPlugin(laneId,ref).then(()=>{if(target==null)return;const chain=this.hooks.deviceChain?.(laneId),effects=(chain?.plugins||[]).filter(item=>!item.instrument&&!item.savedChain).sort((a,b)=>a.index-b.index),added=effects.at(-1);if(added&&effects.length>1&&added.index>target&&effects.some(item=>item.index===target))this.call('movePlugin',this.laneFor(chain,added),added,target);}).catch(error=>this.fail(error));});
 }
 /** Chain index a drop at `clientX` asks for: the first effect whose middle is right of the pointer; null = the end. */
 dropIndex(host,clientX){
  if(!Number.isFinite(clientX))return null;
  for(const box of host.querySelectorAll('.abl-device[data-index]:not(.abl-instrument):not(.pending)')){const rect=box.getBoundingClientRect();if(rect.width>0&&clientX<rect.left+rect.width/2){const index=Number(box.dataset.index);return Number.isInteger(index)?index:null;}}
  return null;
 }
 /** Browser drop / shell entry point: add `pluginRef` to the end of `laneId`'s chain (one Undo step). */
 async addPlugin(laneId,pluginRef){
  if(!laneId)throw new Error('Select a track before adding a device.');const ref=typeof pluginRef==='string'?{id:pluginRef}:pluginRef||{};
  if(!ref.id&&!ref.type&&!ref.name)throw new Error('Choose a plug-in from the browser.');
  // Live: the dropped device appears at once (a placeholder box) and becomes the real device when Freestyle confirms it;
  // a refusal removes it again. Undo of the add is a normal chain change: the next sync drops the box and the
  // plug-in window registry (app.js registerPluginWindow) closes that instance's window.
  const pending={id:++this.pendingSeq,laneId,name:ref.name||ref.label||ref.type||ref.id||'Plug-in',before:new Set((this.chainOf(laneId)?.plugins||[]).map(identity))};this.pendingAdds.push(pending);this.signature=null;this.sync();
  try{return await this.hooks.addPlugin?.(laneId,ref);}
  finally{this.pendingAdds=this.pendingAdds.filter(item=>item!==pending);this.signature=null;this.sync();}
 }
 /** Placeholders still waiting: one per add, and none once the chain already shows the confirmed device (the add hook
  * may still be opening its plug-in window — QA r2 showed the real box and the placeholder side by side). */
 pendingHtml(laneId,chain=this.chainOf(laneId)){
  const lower=value=>String(value??'').toLowerCase(),current=chain?.plugins||[],claimed=new Set();
  const waiting=this.pendingAdds.filter(item=>item.laneId===laneId).filter(item=>{const fresh=current.find(plugin=>!item.before?.has(identity(plugin))&&!claimed.has(identity(plugin))&&(lower(plugin.name)===lower(item.name)||this.pendingAdds.filter(other=>other.laneId===laneId).length===1));if(fresh){claimed.add(identity(fresh));return false;}return true;});
  return waiting.map(item=>`<section class="abl-device abl-device-pending" data-pending-device="${item.id}" aria-label="${esc(item.name)} (adding)" aria-busy="true"><header class="abl-device-title"><button type="button" class="abl-device-activator" disabled aria-label="${esc(item.name)} on"></button><span class="abl-device-name">${esc(item.name)}</span></header><div class="abl-device-body"><p class="abl-device-note" role="status">Adding to Freestyle…</p></div></section>`).join('');}
 mountBody(box,chain,plugin){
  const body=box.querySelector('.abl-device-body');if(!body)return;
  const laneId=chain.laneId,armed=this.canRead(laneId);
  if(isNativeEq(plugin)){
   if(!armed){body.dataset.waiting='';body.innerHTML='<p class="abl-device-note">Reading the EQ…</p>';return;}// QA r3: never a click-to-read prompt — the idle warm (or any work in the Device View) arms the lane and mountWaiting reads it.
   delete body.dataset.waiting;body.innerHTML='<p class="abl-device-note">Reading the EQ…</p>';body.dataset.eqProject=String(this.projectKey);body.dataset.eqMounting='1';
   // The EQ section reads/guards on mount, so it mounts in the background once the current cloud operation settles.
   this.settled(()=>{if(!body.isConnected||this.destroyed)return null;delete body.dataset.eqMounting;const section=this.hooks.mountLaneEq?.(body,laneId);body.querySelector(':scope > .abl-device-note')?.remove();if(section){this.eqSections.push(section);section.element?.classList.add('abl-eq-section');}else body.insertAdjacentHTML('afterbegin','<p class="abl-device-note">EQ: this track’s EQ stage is not readable here.</p>');return section;})
    .catch(error=>{if(!body.isConnected)return;if(AblDeviceView.isGuardRefusal(error)){body.innerHTML='<p class="abl-device-note">Waiting for the project to settle…</p>';setTimeout(()=>{if(body.isConnected&&!this.destroyed)this.mountBody(box,chain,plugin);},2000);return;}body.innerHTML=`<p class="abl-device-note error">${esc(error?.message||error)}</p><button type="button" class="abl-device-retry">Retry</button>`;body.querySelector('.abl-device-retry').onclick=event=>{event.stopPropagation();this.mountBody(box,chain,plugin);};});
   return;
  }
  let session;try{session=this.session(chain,plugin);}catch(error){body.innerHTML=`<p class="abl-device-note error">${esc(error?.message||error)}</p>`;return;}
  body.dataset.sessionKey=`${this.laneFor(chain,plugin)}|${identity(plugin)}`;
  if(session.state==='idle'&&armed){delete body.dataset.waiting;session.load();}
  this.paintBody(body,session,chain,plugin);
 }
 paintBody(body,session,chain,plugin){
  for(const knob of this.knobs.filter(knob=>knob.body===body)){knob.destroy();}this.knobs=this.knobs.filter(knob=>knob.body!==body);
  if(session.state==='idle'){body.dataset.waiting='';body.innerHTML='<p class="abl-device-note">Click to show this device’s parameters.</p>';return;}
  delete body.dataset.waiting;
  if(session.state==='loading'){body.innerHTML='<p class="abl-device-note">Loading parameters…</p>';return;}
  // A transient refusal is never a sticky error: show a quiet note and re-read once the project is quiet again.
  if(session.state==='error'&&AblDeviceView.isGuardRefusal(session.error)){body.innerHTML='<p class="abl-device-note">Waiting for the project to settle…</p>';if(!session.autoRetry)session.autoRetry=setTimeout(()=>{session.autoRetry=null;if(!session.closed&&!this.destroyed)session.load({force:true});},2000);return;}
  if(session.state==='error'){body.innerHTML=`<p class="abl-device-note error">${esc(session.error)}</p><button type="button" class="abl-device-retry">Retry</button>`;body.querySelector('.abl-device-retry').onclick=event=>{event.stopPropagation();session.load({force:true});};return;}
  const rows=session.rows(),shown=rows.slice(0,ABL_DEVICE_FACE_PARAMETERS);
  if(!rows.length){body.innerHTML=`<p class="abl-device-note">No automatable parameters. Use ⚙ for the plug-in window.</p>`;return;}
  body.innerHTML=`<div class="abl-device-params">${shown.map(row=>`<div class="abl-param" data-param="${row.parameter.index}"><span class="abl-param-name" title="${esc(row.parameter.name)}">${esc(row.parameter.name)}</span>${row.kind==='switch'?'<button class="abl-param-switch"></button>':'<div class="abl-param-knob"></div>'}</div>`).join('')}</div>${rows.length>shown.length?`<button type="button" class="abl-device-more" title="Show all ${rows.length} parameters in the plug-in window (Configure)">+${rows.length-shown.length}</button>`:''}`;
  body.querySelector('.abl-device-more')?.addEventListener('click',event=>{event.stopPropagation();this.openWindow(this.laneFor(chain,plugin),plugin,{configure:true});});
  for(const row of shown){
   const cell=body.querySelector(`[data-param="${row.parameter.index}"]`),index=row.parameter.index,name=`${plugin.name||'Device'} ${row.parameter.name}`;
   const commit=({before,after})=>{Promise.resolve().then(()=>session.commit(index,after,{before})).catch(error=>{this.fail(error);session.changed();});};
   const menu=event=>this.call('parameterMenu',event,this.laneFor(chain,plugin),plugin,row.parameter);
   let widget;
   if(row.kind==='switch')widget=new AblSwitch(cell.querySelector('.abl-param-switch'),{value:row.value,min:row.control.min,max:row.control.max,label:row.text,onCommit:commit,onMenu:menu});
   else widget=new AblKnob(cell.querySelector('.abl-param-knob'),{min:row.control.min,max:row.control.max,value:row.value,defaultValue:row.control.defaultValue,steps:row.kind==='stepped'?Number(row.parameter.steps):null,label:name,format:value=>{const fresh=session.rows().find(item=>item.parameter.index===index);return fresh?this.text(session,fresh,value):String(value);},onInput:value=>session.live(index,value),onCommit:commit,onCancel:()=>session.restore(index),onMenu:menu});
   widget.body=body;widget.session=session;widget.index=index;this.knobs.push(widget);
  }
 }
 text(session,row,value){return ablParameterText(row.parameter,row.control,value);}
 /** A session's values changed (load, write, Undo preview, GUI): repaint its knobs in place, or rebuild its body when its rows changed. */
 repaintSession(session){
  if(!this.host)return;const bodies=[...this.host.querySelectorAll('.abl-device-body[data-session-key]')].filter(body=>this.knobs.some(knob=>knob.body===body&&knob.session===session)||body.dataset.sessionKey===`${this.laneOf(session)}|${session.instanceId}`);
  for(const body of bodies){
   const knobs=this.knobs.filter(knob=>knob.body===body),rows=session.rows(),shownIndexes=rows.slice(0,ABL_DEVICE_FACE_PARAMETERS).map(row=>row.parameter.index);
   if(session.state!=='ready'||knobs.length!==shownIndexes.length||knobs.some((knob,i)=>knob.index!==shownIndexes[i])){if(knobs.some(knob=>knob.active))continue;const box=body.closest('.abl-device'),shown=this.chainOf(this.currentLane()),hit=(shown?.plugins||[]).find(item=>identity(item)===session.instanceId),chain=hit?shown:this.hooks.deviceChain?.(this.laneOf(session)),plugin=hit||(chain?.plugins||[]).find(item=>identity(item)===session.instanceId);if(chain&&plugin)this.paintBody(body,session,chain,plugin);void box;continue;}
   for(const knob of knobs){const row=rows.find(item=>item.parameter.index===knob.index);if(!row)continue;knob.set(row.value);if(knob instanceof AblSwitch)knob.element.textContent=row.text;}
  }
 }
 laneOf(session){return session.controller?.target?.id??session.channel?.laneId??null;}
 repaintValues(){for(const session of new Set(this.knobs.map(knob=>knob.session)))this.repaintSession(session);if(this.pending){this.pending=false;}}
 /** The plug-in window reported values for an instance (its GUI or its parameter page). */
 adoptValues(detail){if(!detail?.instanceId)return;for(const session of this.sessions.values())if(session.instanceId===detail.instanceId&&(!detail.laneId||this.laneOf(session)===detail.laneId))session.adoptExternal(detail.parameters);}
 rackHooks(){
  const hooks=this.hooks;
  return{selectPad:channelId=>{hooks.selectPad?.(channelId);this.document.defaultView?.dispatchEvent(new (this.document.defaultView.CustomEvent||CustomEvent)('abl:pad-select',{detail:{channelId}}));this.signature=null;this.sync();},
   auditionPad:channelId=>hooks.auditionPad?.(channelId),togglePadMute:channelId=>hooks.togglePadMute?.(channelId),togglePadSolo:channelId=>hooks.togglePadSolo?.(channelId),
   padMenu:(event,channelId)=>hooks.padMenu?.(event,channelId),menu:typeof hooks.menu==='function'?(event,items)=>hooks.menu(event,items):undefined,
   renamePad:(channelId,name)=>hooks.renamePad?.(channelId,name),addPadInstrument:(ref,patternId,slot)=>hooks.addPadInstrument?.(ref,patternId,slot),setPadVolume:(channelId,value)=>hooks.setPadVolume?.(channelId,value),setPadPan:(laneId,before,value)=>hooks.setPadPan?.(laneId,before,value),removePad:typeof hooks.removePad==='function'?channelId=>hooks.removePad(channelId):undefined,addPadSound:(raw,patternId)=>hooks.addPadSound?.(raw,patternId),openPadPlugin:channelId=>hooks.openPadPlugin?.(channelId),selectPattern:patternId=>{hooks.selectPattern?.(patternId);this.signature=null;this.sync();}};
 }
 /** Open the Live plug-in window (app.js pluginDialog: GUI mirror + parameter page) and tag it with its instance. */
 openWindow(laneId,plugin,options){
  const before=new Set(this.document.querySelectorAll('dialog.plugin-parameter-dialog')),result=this.call('openPluginWindow',laneId,plugin,options);
  // pluginDialog builds its dialog before its first await, so the new window exists now.
  const d=[...this.document.querySelectorAll('dialog.plugin-parameter-dialog')].find(node=>!before.has(node));
  if(d){d.dataset.ablInstance=String(identity(plugin)||'');d.dataset.ablLane=String(laneId||'');}
  return result;
 }
 refreshInstance(instanceId,laneId,ms){if(!instanceId)return;for(const session of this.sessions.values())if(session.instanceId===instanceId&&session.state==='ready'&&(!laneId||this.laneOf(session)===laneId))session.scheduleRefresh(ms);}
 destroy(){this.destroyed=true;for(const type of ['pointerup','keyup','change','wheel'])this.document.removeEventListener(type,this.onWindowInput,true);this.observer?.disconnect();this.document.defaultView?.removeEventListener('abl:plugin-values',this.onValues);this.destroyBodies();this.closeSessions();}
}
