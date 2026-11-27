/** Disabelton track operations (lane A): Live track colour, track Cut / Copy / Paste,
 * Split at insert marker for a whole track, Main activator and File ▸ Save Version….
 *
 * Every write is one guarded Studio API v1 call (If-Match from the fresh saved read,
 * an Idempotency-Key) inside ONE external step of the global history
 * (engine.patternHistory), with optimistic paint and rollback where it applies.
 *
 * Freestyle Studio reference (timeline track header menu):
 *  - "Change color…" swatch grid → onTrackIdentityChange(laneId,{color}) = PATCH lane
 *    (optimistic, rolled back on failure). Disabelton: updateLane {color}
 *    (MCP set_lane_identity).
 *  - "Cut track ⌘X / Copy track ⌘C / Paste ⌘V": Copy remembers the row; Cut = Copy +
 *    delete; Paste copies the remembered content. Disabelton: Copy + Paste =
 *    duplicateLane (audio, instrument and pattern lanes since 2026-11-14; the backing lane is
 *    409 lane_kind_not_duplicable) placed below the target track with reorderLanes; Cut = deleteLane
 *    (the track's normal Delete step), Paste after Cut = restoreLane of exactly that
 *    lane and its takes at its saved position (see pasteTrack).
 *  - Master "Mute master volume": master volume to 0 and back to the level it had.
 *
 * Freestyle limit (2026-11-13, prod): updateLane takes `color` and its receipt returns
 * the saved `lane.color`, but getProject / listLanes never return a lane colour, and
 * `color:""` is refused (400 invalid_argument). So the colour a write confirmed is
 * kept per project in this browser (localStorage) and shown from there; a colour
 * returned by a saved read (if Freestyle adds it) always wins. Undo of a lane's first
 * colour writes back the palette colour the track showed before (it cannot be cleared).
 */
import {laneContents,deleteBlockReason,savedRowOrder,moveRowTo} from './playlist-track-menu.js';
import {laneDuplicateAvailability} from './studio-api-engine-helpers.js';

/** Live 12's clip / track colour chooser (5 rows × 14). */
export const ABL_LIVE_PALETTE=Object.freeze([
 '#ff94a6','#ffa529','#cc9927','#f7f47c','#bffb00','#1aff2f','#25ffa8','#5cffe8','#8bc5ff','#5480e4','#92a7ff','#d86ce4','#e553a0','#ffffff',
 '#ff3636','#f66c03','#99724b','#fff034','#87ff67','#3dc300','#00bfaf','#19e9ff','#10a4ee','#007dc0','#886ce4','#b677c6','#ff39d4','#d0d0d0',
 '#e2675a','#ffa374','#d3ad71','#edffae','#d2e498','#bad074','#9bc48d','#d4fde1','#cdf1f8','#b9c1e3','#cdbbe4','#ae98e5','#e5dce1','#a9a9a9',
 '#c6928b','#b78256','#99836a','#bfba69','#a6be00','#7db04d','#88c2ba','#9bb3c4','#85a5c2','#8393cc','#a595b5','#bf9fbe','#bc7196','#7b7b7b',
 '#af3333','#a95131','#724f41','#dbc300','#85961f','#539f31','#0a9c8e','#236384','#1a2f96','#2f52a2','#624bad','#a34bad','#cc2e6e','#3c3c3c'
]);
export const ABL_COLOR_LIMIT_NOTE='Freestyle saves the track colour but does not return it when the project is read, so this browser remembers the colours it set.';
const COLOR=/^#[0-9a-f]{6}$/i;
const array=value=>Array.isArray(value)?value:[];
const fail=(message,fields={})=>Object.assign(new Error(message),fields);
const body=payload=>payload?.structuredContent?.response??payload?.structuredContent??payload?.response??payload;

/** Live's default track palette (same order as abl-session.js ABL_TRACK_COLORS) picked by an FNV-1a hash of the lane id. */
const ABL_STABLE_PALETTE=Object.freeze(['#c8e39c','#ebbd62','#9fd38d','#b4c7ec','#e8a99c','#cfa1e3','#f3ec8a','#cfeff1','#c3b6ea','#e0eb8e','#9ed6d0','#f6d38f','#e6b3c8','#b6dd8c']);
export function ablStableLaneColor(laneId){const text=String(laneId||'');if(!text)return null;let hash=0x811c9dc5;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,0x01000193)>>>0;}return ABL_STABLE_PALETTE[hash%ABL_STABLE_PALETTE.length];}
/** Lane colours: saved read (lane.color) > colour a write receipt confirmed (kept per project) > none. */
export const ablLaneColors=(()=>{
 let projectId=()=>null,rowLanes=()=>[],rawLanes=()=>[];/* see ablStableLaneColor */const memory=new Map(),listeners=new Set();
 const storageKey=id=>'disabelton:abl:laneColors:'+id;
 const load=id=>{if(!id)return new Map();if(memory.has(id))return memory.get(id);let map=new Map();try{const text=globalThis.localStorage?.getItem(storageKey(id));const data=text?JSON.parse(text):null;if(data&&typeof data==='object')map=new Map(Object.entries(data).filter(([,value])=>typeof value==='string'&&COLOR.test(value)));}catch{}memory.set(id,map);return map;};
 const save=id=>{try{globalThis.localStorage?.setItem(storageKey(id),JSON.stringify(Object.fromEntries(load(id))));}catch{}};
 const api={
  configure(options={}){if(typeof options.projectId==='function')projectId=options.projectId;if(typeof options.rowLanes==='function')rowLanes=options.rowLanes;if(typeof options.rawLanes==='function')rawLanes=options.rawLanes;},
  /** The lane's colour, or null (palette by position). */
  laneColor(laneId){if(!laneId)return null;try{const saved=array(rawLanes()).find(lane=>lane?.id===laneId)?.color;if(typeof saved==='string'&&COLOR.test(saved))return saved.toLowerCase();}catch{}let id=null;try{id=projectId();}catch{}return load(id).get(laneId)||null;},
  rowColor(row){let laneId=null;try{laneId=array(rowLanes())[row]||null;}catch{}return api.laneColor(laneId);},
  /** QA r12: the colour SHOWN for a row — its set colour, else a palette colour fixed by its lane id (never by row
   * position, so inserting a track, e.g. a ⌘D copy, does not repaint the tracks below). null for a row without a lane. */
  displayColor(row){let laneId=null,lanes=[];try{lanes=array(rowLanes());laneId=lanes[row]||null;}catch{}if(!laneId)return null;const own=api.laneColor(laneId);if(own)return own;
   // QA r13: a ⌘D copy's pattern row (same saved order as the copied track, trackType pattern, no colour of its own)
   // shows in the copied track's colour, so its clip reads as that track's, not an orphan row.
   try{const raw=array(rawLanes()),lane=raw.find(item=>item?.id===laneId),next=raw.find(item=>item?.id===lanes[row+1]);
    if(lane?.trackType==='pattern'&&next&&next.trackType!=='pattern'&&lane.order!=null&&Number(lane.order)===Number(next.order))return api.laneColor(next.id)||ablStableLaneColor(next.id);}catch{}
   return ablStableLaneColor(laneId);},
  /** Record (or forget, color=null) a lane colour for the current project. */
  remember(laneId,color){let id=null;try{id=projectId();}catch{}if(!id||!laneId)return;const map=load(id);if(color&&COLOR.test(color))map.set(laneId,color.toLowerCase());else map.delete(laneId);save(id);for(const fn of listeners)try{fn(laneId,color);}catch{}},
  onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  resetForTest(){memory.clear();projectId=()=>null;rowLanes=()=>[];rawLanes=()=>[];listeners.clear();}
 };
 return api;
})();

/** Track ▸ Paste availability for the clipboard against `raw` (pure). {enabled, reason, code}. */
export function trackPasteAvailability(clipboard,raw){
 if(!clipboard)return{enabled:false,reason:'Cut or copy a track first (⌘X / ⌘C on a selected track).',code:'empty_clipboard'};
 const exists=array(raw?.lanes).some(lane=>lane?.id===clipboard.laneId);
 if(clipboard.mode==='cut'&&!exists)return{enabled:true,reason:'',code:null};
 if(!exists)return{enabled:false,reason:`The copied track “${clipboard.name||'Track'}” no longer exists.`,code:'source_missing'};
 const gate=laneDuplicateAvailability(raw,clipboard.laneId);return gate.enabled?{enabled:true,reason:'',code:null}:{enabled:false,reason:gate.reason,code:gate.code};
}
/** Track ▸ Copy availability: a copy can only be pasted through duplicateLane. */
export function trackCopyAvailability(raw,laneId){
 if(!laneId)return{enabled:false,reason:'This row has no saved track yet.',code:'no_lane'};
 const gate=laneDuplicateAvailability(raw,laneId);return gate.enabled?{enabled:true,reason:'',code:null}:{enabled:false,reason:gate.reason,code:gate.code};
}
/** Track ▸ Cut availability (the track's Delete gate; Paste brings it back with restoreLane). */
export function trackCutAvailability(raw,laneId){
 if(!laneId)return{enabled:false,reason:'This row has no saved track yet.',code:'no_lane'};
 const reason=deleteBlockReason(laneContents(raw,laneId));return reason?{enabled:false,reason,code:'delete_blocked'}:{enabled:true,reason:'',code:null};
}
/** Clips a whole-track Split at the insert marker cuts: the track's clips strictly containing `beat`. */
export function trackSplitTargets(clips,track,beat){
 const at=Number(beat);if(!Number.isFinite(at))return[];
 return array(clips).filter(clip=>clip?.track===track&&Number(clip.start)+1e-6<at&&at<Number(clip.start)+Number(clip.length)-1e-6).sort((a,b)=>a.start-b.start);
}

/**
 * deps: read() → fresh saved raw project; call(name,args,{ifMatch,idempotencyKey}); projectId(); laneIds() →
 * displayed rows; history() → engine.patternHistory; flush(); editable(); exclusive(fn) (the app's lane lock);
 * render(); actions (PlaylistTrackActions); deleteTrack(row) → deleteLane state (one history step);
 * afterRestore(laneId,result); selectTrack(row); defaultColor(row); key().
 */
export function createAblTrackOps(deps){
 const key=deps.key||(()=>globalThis.crypto?.randomUUID?.()||`abl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
 const headers=raw=>{const tag=raw?._studioApi?.etag||(raw?.timelineRevision!=null?JSON.stringify(raw.timelineRevision):null);if(typeof tag!=='string'||!tag)throw fail('Reload the project revision before changing tracks.',{dispatched:false});return{ifMatch:tag,idempotencyKey:key()};};
 const exclusive=deps.exclusive||(fn=>fn());
 const guard=()=>{if(deps.editable&&!deps.editable())throw fail('Wait for the current cloud operation to finish.',{dispatched:false});};
 let clipboard=null;
 /** One external history step around `run` (→ {result, undo, redo, detail}). */
 async function step(kind,label,run){
  guard();return exclusive(async()=>{
   await deps.flush?.();const history=deps.history();let pending=history.beginExternalStep({kind,label});
   try{const {result,undo,redo,detail}=await run();history.finishExternalStep(pending,{detail,undo,redo});pending=null;return result;}
   catch(error){if(pending)history.failExternalStep(pending,error);pending=null;throw error;}
   finally{if(pending)history.failExternalStep(pending,{operationUncertain:true});}
  });
 }
 /** One confirmed colour write: the receipt must name this lane with exactly this colour. */
 async function writeColor(laneId,color){
  const raw=await deps.read();if(!array(raw?.lanes).some(lane=>lane?.id===laneId))throw fail('That track no longer exists.',{dispatched:false});
  let receipt;try{receipt=body(await deps.call('set_lane_identity',{project_id:deps.projectId(),lane_id:laneId,color},headers(raw)));}
  catch(error){const status=Number(error?.status);if(!(status>=400&&status<500)&&error&&typeof error==='object')error.operationUncertain??=true;throw error;}
  if(receipt?.laneId!==undefined&&receipt.laneId!==laneId)throw fail('The colour acknowledgement identifies another track.',{operationUncertain:true});
  const saved=receipt?.lane?.color;if(typeof saved!=='string'||saved.toLowerCase()!==color.toLowerCase())throw fail('Freestyle did not confirm the track colour.',{operationUncertain:true});
  ablLaneColors.remember(laneId,saved);await deps.read();return saved.toLowerCase();
 }
 const rowOf=laneId=>array(deps.laneIds()).indexOf(laneId);
 const displayColor=row=>ablLaneColors.rowColor(row)||deps.defaultColor?.(row)||null;
 async function setTrackColor(row,color){
  if(typeof color!=='string'||!COLOR.test(color))throw fail('Pick a colour from the palette.',{dispatched:false});
  const laneId=array(deps.laneIds())[row];if(!laneId)throw fail('This row has no saved track yet.',{dispatched:false});
  const next=color.toLowerCase(),remembered=ablLaneColors.laneColor(laneId),before=displayColor(row);
  if(remembered===next)return{laneId,color:next,unchanged:true};
  // Optimistic: the header, clips, Session column and mixer strip repaint now; a refusal puts the old colour back.
  ablLaneColors.remember(laneId,next);deps.render?.();
  try{
   return await step('lane_color','Track Color',async()=>{
    await writeColor(laneId,next);
    const apply=async value=>{const prior=ablLaneColors.laneColor(laneId);if(value)ablLaneColors.remember(laneId,value);deps.render?.();try{await writeColor(laneId,value);}catch(error){if(error?.operationUncertain!==true)ablLaneColors.remember(laneId,prior);deps.render?.();throw error;}deps.render?.();return{laneId,color:value};};
    deps.log?.('abl-track-color',{laneId,row,color:next,before});
    return{result:{laneId,color:next},detail:{laneId,row,color:next,before},undo:()=>before?apply(before):Promise.reject(fail('Undo needs the previous track colour.')),redo:()=>apply(next)};
   });
  }catch(error){if(error?.operationUncertain!==true)ablLaneColors.remember(laneId,remembered);deps.render?.();throw error;}
 }
 function copyTrack(row){
  const raw=deps.rawProject?.(),laneId=array(deps.laneIds())[row];const gate=trackCopyAvailability(raw,laneId);if(!gate.enabled)throw fail(gate.reason,{dispatched:false,code:gate.code});
  const lane=array(raw?.lanes).find(item=>item?.id===laneId);clipboard={mode:'copy',laneId,name:lane?.name||deps.trackName?.(row)||'Track'};deps.log?.('abl-track-copy',{row,laneId});return clipboard;
 }
 async function cutTrack(row){
  const raw=deps.rawProject?.(),laneId=array(deps.laneIds())[row];const gate=trackCutAvailability(raw,laneId);if(!gate.enabled)throw fail(gate.reason,{dispatched:false,code:gate.code});
  const lane=array(raw?.lanes).find(item=>item?.id===laneId),name=lane?.name||deps.trackName?.(row)||'Track';
  // The track's own Delete step (one Undo); the clipboard keeps exactly what was removed for restoreLane.
  const state=await deps.deleteTrack(row);if(!state?.laneId)throw fail('Freestyle did not confirm the cut track.',{operationUncertain:true});
  clipboard={mode:'cut',laneId,name,state:structuredClone(state)};deps.log?.('abl-track-cut',{row,laneId,clipIds:state.clipIds?.length??0});return clipboard;
 }
 /** Put the lane `laneId` right below display row `target` (one reorderLanes) — or leave it when already there. */
 async function placeBelow(laneId,target){
  if(!Number.isInteger(target)||target<0)return null;const rows=array(deps.laneIds()),from=rows.indexOf(laneId);if(from<0)return null;
  const anchor=rows[target]===laneId?null:rows[target];if(!anchor)return null;
  const next=moveRowTo(rows,from,rows.indexOf(anchor)+1);if(!next)return null;
  const raw=await deps.read();return deps.actions.reorder(next,{expectedRows:savedRowOrder(raw)});
 }
 async function pasteTrack(targetRow){
  const raw=await deps.read(),gate=trackPasteAvailability(clipboard,raw);if(!gate.enabled)throw fail(gate.reason,{dispatched:false,code:gate.code});
  const source=clipboard;
  return step(source.mode==='cut'?'lane_restore':'lane_duplicate',source.mode==='cut'?'Paste Track':'Paste Track',async()=>{
   let laneId,created=null,restored=null;
   if(source.mode==='cut'&&!array(raw.lanes).some(lane=>lane?.id===source.laneId)){restored=await deps.actions.restoreLane(source.state);laneId=source.laneId;try{deps.afterRestore?.(laneId,restored);}catch{}}
   else{created=await deps.actions.duplicateLane(source.laneId);laneId=created.laneId;}
   deps.render?.();let placed=false;
   // Only a pasted COPY moves below the target track. A cut track comes back where it was saved: moving it would change
   // its saved order, and the Cut's own Undo (restoreLane) could then no longer confirm the lane it restores.
   if(created)try{placed=!!await placeBelow(laneId,targetRow);}catch(error){deps.log?.('abl-track-paste-place-failed',{laneId,error:String(error?.message||error).slice(0,160)});if(error?.operationUncertain)throw error;}
   deps.render?.();const row=rowOf(laneId);if(row>=0)deps.selectTrack?.(row);
   // After a Paste of a cut track the clipboard holds that track as a copy (Live: paste again duplicates it).
   clipboard={mode:'copy',laneId,name:source.name};
   let removed=null;
   // A pasted copy is deleted as that duplicate (an instrument copy takes its own pattern row / copies with it).
   const undo=async()=>{removed=await deps.actions.deleteLane(laneId,created?{duplicate:created}:undefined);deps.render?.();return{laneId,clipIds:removed.clipIds};};
   const redo=async()=>{if(!removed)throw fail('Redo needs the removed track.');const result=await deps.actions.restoreLane(removed);try{deps.afterRestore?.(laneId,result);}catch{}deps.render?.();return result;};
   deps.log?.('abl-track-paste',{mode:source.mode,laneId,sourceLaneId:source.laneId,targetRow,placed,renderedRow:row});
   return{result:{laneId,mode:source.mode,placed,row},detail:{laneId,sourceLaneId:source.laneId,mode:source.mode,targetRow},undo,redo};
  });
 }
 /** ⌘E with no clip selected (Live: Split at the insert marker on the selected track). */
 async function splitTrack(row,beat,{clips,split,findClip}){
  const targets=trackSplitTargets(clips,row,beat);if(!targets.length)return{split:0};
  guard();let count=0;for(const clip of targets){const current=findClip?.(clip.id)||clip;if(trackSplitTargets([current],row,beat).length){await split(current,beat);count++;}}
  deps.log?.('abl-track-split',{row,beat,clips:count});return{split:count};
 }
 return{
  setTrackColor,copyTrack,cutTrack,pasteTrack,splitTrack,displayColor,
  get clipboard(){return clipboard?{...clipboard}:null;},
  clearClipboard(){clipboard=null;},
  copyAvailability:row=>trackCopyAvailability(deps.rawProject?.(),array(deps.laneIds())[row]),
  cutAvailability:row=>trackCutAvailability(deps.rawProject?.(),array(deps.laneIds())[row]),
  pasteAvailability:()=>trackPasteAvailability(clipboard,deps.rawProject?.())
 };
}

/** Main activator (Pro's "Mute master volume"): master gain to 0, and back to the level it had. */
export function createMainActivator({masterRow,setMasterGain,log}={}){
 let restore=1;
 const gainOf=row=>{const value=row?.values?.gain;if(value&&typeof value==='object'&&value.known===false)return null;const gain=value&&typeof value==='object'?value.value:value;return typeof gain==='number'&&Number.isFinite(gain)?gain:null;};
 return{
  state(){const row=masterRow?.(),gain=gainOf(row),enabled=!!row?.controls?.gain?.enabled&&gain!==null;return{enabled,muted:gain!==null&&gain<=.001,gain,reason:enabled?'':row?'Wait for the current mixer write to finish.':'Main gain is unavailable until the project mixer loads.'};},
  async toggle(){
   const row=masterRow?.(),gain=gainOf(row);if(!row?.controls?.gain?.enabled||gain===null)throw fail('Main gain is unavailable until the project mixer loads.',{dispatched:false});
   const muting=gain>.001;if(muting)restore=gain;const value=muting?0:(restore>.001?restore:1);
   log?.('abl-main-activator',{muting,before:gain,value});return setMasterGain(gain,value);
  }
 };
}

/** File ▸ Save Version…: one createProjectSave (named; render the mix unless snapshot only). */
export async function createNamedSave({call,projectId,flush,name,render=true,key}){
 const text=String(name??'').trim();if(!text)throw fail('Name the version.',{dispatched:false});if(text.length>255)throw fail('A version name has at most 255 characters.',{dispatched:false});
 await flush?.();const receipt=body(await call('create_project_save',{project_id:projectId(),name:text,snapshot_only:!render},{idempotencyKey:(key||(()=>globalThis.crypto?.randomUUID?.()||`save-${Date.now()}`))()}));
 return receipt;
}
/** Revert list item state for one save: its WAV (Pro's Save History "WAV" button). */
export function saveDownloadState(save){
 const url=typeof save?.downloadUrl==='string'&&save.downloadUrl.trim()?save.downloadUrl.trim():null;if(url)return{available:true,url,reason:''};
 const status=String(save?.renderStatus||'').toLowerCase();
 return{available:false,url:null,reason:status==='error'||status==='failed'?'The mix render of this version failed: no WAV.':status==='rendering'||status==='pending'||status==='queued'?'The mix of this version is still rendering.':'This version was saved without a mix render (snapshot only).'};
}
export function saveWavFilename(save){const base=String(save?.name||'project save').trim().replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,' ').replace(/^[ ._]+|[ ._]+$/g,'')||'project-save';return base.toLowerCase().endsWith('.wav')?base:`${base}.wav`;}
