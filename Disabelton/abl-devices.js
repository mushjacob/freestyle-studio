/**
 * Disabelton devices lane entry point: installs the Device View, the Live mixers
 * and the Automation Mode API, and publishes the cross-module globals:
 *
 *  window.ablDevices.addPlugin(laneId, pluginRef) → Promise
 *      Add a plug-in to the end of a track's chain (browser drop / "+" menu). pluginRef is
 *      a catalog id string or {id?, type?, name?}; it is matched against the Freestyle
 *      plug-in catalog (the cached Browser catalog first), added with one guarded write (one Undo step).
 *      No window opens on add (Studio Pro adds with openEditor:false); the device box shows it.
 *  window.ablDevices.showLane(laneId)   show that track in the Device View (selects it)
 *  window.ablDevices.sync()              repaint after selection/chain changes
 *  window.ablAutomation.toggle(force?) → enabled   (A)
 *  window.ablAutomation.enabled
 *  window.ablAutomation.renderTrack(trackEl, laneId, {header, lane, beatAt, barWidth})
 *  window event 'abl:pad-select' {channelId}   (Drum Rack pad selected)
 *  listens: document 'abl:device-drop' {laneId,item} (preventDefault + addPlugin), 'abl:track-select' {laneId}
 *  window event 'abl:automation-repaint' {enabled}
 *
 * `hooks` come from app.js (every engine-facing action reuses its guarded paths).
 */
import {AblDeviceView} from './abl-dev-view.js';
import {AblMixer} from './abl-mixer.js';
import {AblPluginCatalog,openAblDeviceMenu} from './abl-dev-catalog.js';
export const ABL_WARM_QUIET_MS=400,ABL_WARM_POLL_MS=100,ABL_WARM_MAX_WAIT_MS=2500,ABL_WARM_IDLE_INPUT_MS=1500;
export const ABL_INSTRUMENT_PICK_REASON='Instruments: drag one from the Browser onto a MIDI track (Freestyle adds instruments with their own track).';

export function installAblDevices(hooks={}){
 const document=hooks.document||globalThis.document,window=document.defaultView||globalThis;
 // The whole paged plug-in catalog, one per project for the session (window.ablDevices.catalog), never blocking.
 // hooks.readCatalogPage({cursor,limit}) → listPluginCatalog page; hooks.catalogScope() → project id.
 let catalogInstance=null;
 const catalog=()=>{if(!hooks.readCatalogPage)return null;const scope=String(hooks.catalogScope?.()??'');if(!catalogInstance||catalogInstance.scope!==scope)catalogInstance=new AblPluginCatalog({scope,readPage:page=>hooks.readCatalogPage(page)});return catalogInstance;};
 if(hooks.readCatalogPage){const legacy=hooks.openAddMenu;hooks.openAddMenu=(laneId,event,rect)=>{const source=catalog();if(!source)return legacy?.(laneId,event,rect);
  return openAblDeviceMenu(document,{anchor:event?.target||null,rect,catalog:source,title:'Add Device',log:(kind,data)=>{try{hooks.log?.(kind,data);}catch{}},entryState:entry=>entry.kind==='instrument'?{disabled:true,title:ABL_INSTRUMENT_PICK_REASON}:{},onPick:entry=>{api.addPlugin(laneId,{id:entry.id,name:entry.name}).catch(error=>{try{hooks.fail?.(error);}catch{}});}});};}
 // Presets (abl-dev-presets.js): the Studio API client and the global history come from abl-engine-tools.js
 // (installed by app.js) unless app.js passes them directly.
 hooks.studioClient??=()=>window.ablEngineTools?.studioClient?.()??null;
 hooks.recordHistoryStep??=step=>window.ablEngineTools?.recordStep?.(step)??false;
 const devices=new AblDeviceView(hooks),mixer=new AblMixer(hooks);
 const automation={
  toggle:force=>hooks.toggleAutomation(force),
  get enabled(){try{return !!hooks.automationView?.()?.enabled;}catch{return false;}},
  renderTrack:(trackEl,laneId,geometry)=>hooks.automationView?.()?.renderTrack(trackEl,laneId,geometry),
 };
 const api={addPlugin:(laneId,pluginRef)=>devices.addPlugin(laneId,pluginRef),/** Drum pad / Fold-row audition: Pro's sample_preview over mozart-control, REST fallback. Returns {stop(),route}. */auditionPad:channelId=>hooks.auditionPad?.(channelId),showLane:laneId=>devices.showLane(laneId),/** Paged plug-in catalog for the "+" menu and the Browser Plug-ins (AblPluginCatalog: ensure(), more(), groups(query), 'change'). */get catalog(){return catalog();},openAddMenu:(laneId,event,rect)=>hooks.openAddMenu?.(laneId,event,rect),sync:()=>{devices.sync();mixer.attach();mixer.paintArms();},view:devices,mixer};
 window.ablDevices=api;window.ablAutomation=automation;
 // Shell events (docs/DISABELTON_PLAN.md layout contract): a browser device dropped on a track; a track selected.
 const onDeviceDrop=event=>{const {laneId,item}=event.detail||{};if(!laneId||!item)return;event.preventDefault();devices.addPlugin(laneId,item).catch(error=>{try{hooks.fail?.(error);}catch{}});};
 // Lazy reads: a track selection (user or the shell's automatic first-track selection) only paints the cached chain.
// Parameters are read once the user works in the Device View (pointer/focus/hover arms that lane) and never
// during a gesture (AblDeviceView.settled waits for hooks.gestureActive).
// Live speed: the selected track's chain and first parameter page are still warmed, but only after the app has been
// quiet for ABL_WARM_QUIET_MS (no gesture, no audition, no pending write — hooks.gestureActive / hooks.quiet).
// A newer selection cancels the pending warm; a user read (pointer/focus in the Device View) arms the lane at once
// and shares the same in-flight read, so the warm never delays it. The shell's automatic first-track selection
// on load goes through the same idle gate.
let warm=null;
const cancelWarm=()=>{if(warm){clearTimeout(warm.timer);warm=null;}};
const layoutDetail=state=>state?.detail&&typeof state.detail==='object'?{visible:!!state.detail.visible,kind:state.detail.kind}:{visible:!!state?.detailVisible,kind:state?.detailKind};
const deviceShown=()=>{const layout=window.ablLayout;if(typeof layout?.state!=='function')return devices.visible();try{const detail=layoutDetail(layout.state());return detail.visible&&detail.kind==='device'&&devices.visible();}catch{return false;}};
// The user's own input (pointer/key/wheel anywhere) postpones the forced warm: it only runs while the user is idle,
// so it never lands inside a pointer gesture or the audition readiness it starts.
let lastInputAt=-Infinity;const noteInput=()=>{lastInputAt=Date.now();};const INPUT_EVENTS=['pointerdown','pointerup','keydown','wheel'];
for(const type of INPUT_EVENTS)document.addEventListener(type,noteInput,{capture:true,passive:true});
const readyNow=()=>{try{return hooks.ready?.()!==false;}catch{return false;}};
const busyNow=()=>{if(devices.gestureActive())return true;try{return hooks.quiet?.()===false;}catch{return true;}};
const scheduleWarm=laneId=>{cancelWarm();if(!laneId)return;const job={laneId,startedAt:Date.now(),quietSince:busyNow()?null:Date.now(),polls:0,timer:null};warm=job;
 const tick=()=>{if(warm!==job||devices.destroyed)return;if(devices.currentLane()!==laneId){cancelWarm();return;}
  if(busyNow())job.quietSince=null;else if(job.quietSince==null)job.quietSince=Date.now();
  if(job.quietSince!=null&&Date.now()-job.quietSince>=ABL_WARM_QUIET_MS){warm=null;devices.arm(laneId);return;}
  // QA r4: LABS stayed on "Click to show…" and the EQ on "Reading the EQ…" — the app was never quiet for 400 ms
  // (background writes/reads kept hooks.quiet false) and the warm gave up. After ABL_WARM_MAX_WAIT_MS on the same
  // track the lane is armed anyway unless a gesture is in progress: every read still goes through
  // AblDeviceView.settled (waits for idle, never runs during a gesture, retries guard refusals quietly).
  // Lazy: only for a Device View the user can actually see (layout detail = device), never while a gesture or an
  // audition readiness is pending, and only once the project is ready. Otherwise the on-show path below takes over.
  if(Date.now()-job.startedAt>=ABL_WARM_MAX_WAIT_MS&&Date.now()-lastInputAt>=ABL_WARM_IDLE_INPUT_MS&&deviceShown()&&!devices.gestureActive()&&readyNow()){warm=null;devices.log('abl-device-warm-forced',{laneId,waitedMs:Date.now()-job.startedAt});devices.arm(laneId);return;}
  job.polls++;job.timer=setTimeout(tick,ABL_WARM_POLL_MS);};
 job.timer=setTimeout(tick,ABL_WARM_POLL_MS);};
// A lane shown by any other path (clip/slot/strip selection moves only the mixer row) gets the same idle warm.
devices.onLaneShown=laneId=>{if(warm?.laneId!==laneId)scheduleWarm(laneId);};
const onTrackSelect=event=>{const laneId=event.detail?.laneId;if(laneId&&devices.currentLane()!==laneId)devices.showLane(laneId,{arm:false});else devices.sync();scheduleWarm(laneId||null);};
 // On show: the Device View becoming visible (⇧Tab / ⌥⌘L / Detail View opened) loads the shown track by itself.
 const onLayout=state=>{const detail=layoutDetail(state);if(!detail.visible||detail.kind!=='device')return;devices.sync();const lane=devices.currentLane();if(!lane)return;if(devices.armed.has(devices.laneKey(lane)))devices.mountWaiting(lane);else if(!devices.gestureActive()&&readyNow()){cancelWarm();devices.arm(lane);}else if(warm?.laneId!==lane)scheduleWarm(lane);};
 let unsubscribeLayout=null;const subscribeLayout=()=>{if(unsubscribeLayout||typeof window.ablLayout?.onChange!=='function')return;try{unsubscribeLayout=window.ablLayout.onChange(onLayout);}catch{unsubscribeLayout=null;}};
 subscribeLayout();window.addEventListener('abl:layout-ready',subscribeLayout);
 document.addEventListener('abl:device-drop',onDeviceDrop);document.addEventListener('abl:track-select',onTrackSelect);
 return{devices,mixer,automation,api,destroy(){cancelWarm();for(const type of INPUT_EVENTS)document.removeEventListener(type,noteInput,{capture:true});try{unsubscribeLayout?.();}catch{}window.removeEventListener('abl:layout-ready',subscribeLayout);document.removeEventListener('abl:device-drop',onDeviceDrop);document.removeEventListener('abl:track-select',onTrackSelect);devices.destroy();mixer.destroy();if(window.ablDevices===api)delete window.ablDevices;if(window.ablAutomation===automation)delete window.ablAutomation;}};
}
