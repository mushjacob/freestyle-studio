/** FL Playlist track header menu (right-click a track name): Rename, Insert
 * track, Delete track, Move up / Move down, Mute, Solo. Every item maps to a
 * declared Studio API v1 lane route; an item whose route is absent from the
 * checked-in contract is left out, and an item that cannot be applied exactly
 * to this row is shown disabled with its reason.
 *
 * Routes (docs/studio-api-operations.json):
 *   Rename        updateLane    PATCH /lanes/{id}          (rename_track / set_lane_identity)
 *   Insert track  createLane    POST  /lanes               (create_track) + presentation row hint
 *   Delete track  deleteLane    DELETE /lanes/{id}         (delete_lane), Undo: restoreLane (restore_lane)
 *   ⌘D New Track with Duplicate Settings / Duplicate Track
 *                 duplicateLane POST  /lanes/{id}:duplicate  (duplicate_lane), Undo: deleteLane
 *   Move up/down  reorderLanes  POST  /lanes:reorder       (reorder_lanes)
 *   Mute / Solo   updateLane    muted / soloed             (the Mixer's own queued lane controls)
 * Change color is deliberately absent: updateLane accepts `color`, but the
 * saved lane read never returns one, so a recolor could be neither shown nor
 * confirmed. */
import {STUDIO_API_OPERATIONS} from './studio-api-client.js';

export const TRACK_MENU_ROUTES=Object.freeze({rename:'updateLane',insert:'createLane',duplicate:'duplicateLane',delete:'deleteLane',restore:'restoreLane',reorder:'reorderLanes',mute:'updateLane',solo:'updateLane'});
/** Lane kinds Freestyle's duplicateLane copies: audio/vocal lanes (takes, chain, mix, sends),
 * instrument lanes (generator + patch state, chain, independent pattern copies on a new
 * pattern row) and pattern rows (independent pattern copies, same clip geometry). The
 * backing slot is not a lane row here (409 lane_kind_not_duplicable). */
export const DUPLICABLE_LANE_KINDS=Object.freeze(['audio','vocal','instrument']);
/** Why duplicateLane (Track ▸ Duplicate Track) cannot run for this lane, or null. */
export function duplicateBlockReason(contents){
 if(!contents?.lane)return 'Select a saved track first.';
 if(!DUPLICABLE_LANE_KINDS.includes(contents.lane.kind))return 'Freestyle cannot duplicate this kind of track.';
 return null;
}
/** Logic ⌘D "New Track with Duplicate Settings" never copies regions: it adds an empty
 * track of the same type directly below, with the same channel strip (instrument + patch
 * state, effects, sends, volume, pan, output) and the same name. Built on Freestyle
 * duplicateLane (exact channel-strip copy, placed below), then the copied content its
 * receipt names is removed: audio copies (applyClipBatch remove), pattern clips
 * (applyPatternPlacementBatch delete), the independent pattern copies (deletePattern) and
 * the pattern row it created (deleteLane). */
export const DUPLICATE_SETTINGS_ROUTES=Object.freeze(['duplicateLane','deleteLane','applyClipBatch','deletePattern','updateLane','reorderLanes']);
/** Track ▸ Duplicate Track: duplicateLane as-is; Undo deleteLane, Redo restoreLane (audio) or duplicateLane again. */
export const DUPLICATE_TRACK_ROUTES=Object.freeze(['duplicateLane','deleteLane','restoreLane']);
const chainOf=lane=>array(lane?.pluginChain).slice().sort((a,b)=>Number(a?.position)-Number(b?.position));
const trackName=lane=>Array.from(typeof lane?.name==='string'&&lane.name.trim()?lane.name.trim():'Track').slice(0,80).join('').trim();
/** What ⌘D would create for this saved lane: {kind,trackType,name}, or {blocked}. */
export function duplicateSettingsPlan(lane){
 if(!lane||typeof lane.id!=='string')return{blocked:'Select a saved track first.'};
 if(!DUPLICABLE_LANE_KINDS.includes(lane.kind))return{blocked:'Freestyle cannot duplicate this kind of track.'};
 return{kind:lane.kind,trackType:typeof lane.trackType==='string'?lane.trackType:null,name:trackName(lane)};
}
/** Why ⌘D (Logic semantics) cannot run for this lane, or null. */
export function duplicateSettingsBlockReason(contents){return contents?.lane?duplicateSettingsPlan(contents.lane).blocked||null:'Select a saved track first.';}
/** Copy ids a duplicateLane receipt names: {laneId, rowLaneId, clipIds, patternIds, placementIds}. */
export function duplicateReceiptContent(receipt,sourceLaneId){
 const values=map=>map&&typeof map==='object'&&!Array.isArray(map)?Object.values(map).filter(value=>typeof value==='string'&&value):[];
 const laneId=typeof receipt?.laneId==='string'&&receipt.laneId&&receipt.laneId!==sourceLaneId?receipt.laneId:null;
 const row=typeof receipt?.patternRowLaneId==='string'&&receipt.patternRowLaneId&&receipt.patternRowLaneId!==sourceLaneId?receipt.patternRowLaneId:null;
 return{laneId,rowLaneId:row&&row!==laneId?row:null,clipIds:values(receipt?.clipIds),patternIds:values(receipt?.patternIds),placementIds:values(receipt?.placementIds)};
}
/** Order-sensitive effect identity used to confirm a chain matches (keys may differ per lane). */
export const chainSignature=lane=>chainOf(lane).map(plugin=>({type:plugin?.type??null,preset:plugin?.preset??null,bypassed:plugin?.bypassed===true}));
/** Same instrument patch: exact, or the saved short name ("Subdued" for "Intimate Grand Piano - Subdued"). */
export const samePatch=(got,wanted)=>typeof got==='string'&&typeof wanted==='string'&&!!wanted&&(got===wanted||wanted.endsWith(' - '+got));
const has=(operations,id)=>!!operations&&Object.prototype.hasOwnProperty.call(operations,id);
const ROW_KINDS=new Set(['audio','vocal','instrument']);
const array=value=>Array.isArray(value)?value:[];
const laneOf=row=>row?.laneId??row?.lane_id;

/** What a Delete of `laneId` would remove from the saved project. */
export function laneContents(raw,laneId){
 const matches=array(raw?.lanes).filter(lane=>lane?.id===laneId);
 const clipIds=array(raw?.clips).filter(clip=>clip?.laneId===laneId).map(clip=>clip.id);
 const placementIds=array(raw?.placements).filter(row=>laneOf(row)===laneId).map(row=>row.id);
 const sources=array(raw?.patterns).flatMap(pattern=>array(pattern?.pattern?.sources).filter(source=>source?.laneId===laneId).map(source=>({patternId:pattern.id,sourceId:source.id})));
 return{lane:matches.length===1?matches[0]:null,clipIds,placementIds,sources,empty:!clipIds.length&&!placementIds.length&&!sources.length};
}
/** Saved lane settings a Delete → Undo must bring back unchanged. */
export const LANE_SETTING_FIELDS=Object.freeze(['id','name','kind','trackType','volume','pan','muted','solo','soloed','busId','order','pluginChain']);
export function laneSettings(lane){const out={};for(const key of LANE_SETTING_FIELDS)if(lane&&Object.prototype.hasOwnProperty.call(lane,key))out[key]=lane[key];return out;}
export function sameLaneSettings(a,b){return JSON.stringify(laneSettings(a))===JSON.stringify(laneSettings(b));}
/** Why Delete track cannot be applied (and undone) exactly, or null. */
/** #15 (release 2026-11-18): deleteLane removes the pattern channels that play the lane in the same request
 * (deletedPatternChannels) and restoreLane puts them back (restoredPatternChannels), so they no longer block. */
export function deleteBlockReason(contents,{patternChannels=true}={}){
 if(!contents?.lane)return 'Reload the saved track before deleting it.';
 if(contents.sources.length&&!patternChannels)return 'This track plays a Channel Rack instrument. Remove the channel from the Channel Rack instead.';
 if(contents.placementIds.length)return `Move or delete its ${contents.placementIds.length} pattern clip${contents.placementIds.length===1?'':'s'} first: Freestyle has no exact Undo for pattern clips removed with a track.`;
 return null;
}
/** Saved row order of lanes (persisted `order`, ties by array order), exactly as cloud-session lays out rows. */
export function savedRowOrder(raw){
 return array(raw?.lanes).map((lane,index)=>({lane,index})).filter(({lane})=>lane&&typeof lane.id==='string'&&lane.id&&ROW_KINDS.has(lane.kind)).sort((a,b)=>{const x=Number(a.lane.order),y=Number(b.lane.order),ax=Number.isFinite(x)?x:Infinity,by=Number.isFinite(y)?y:Infinity;return ax===by?a.index-b.index:ax-by;}).map(({lane})=>lane.id);
}
/** Full lane_ids body for reorderLanes: the displayed rows top-down (gaps
 * closed), then every other saved lane in its saved order. */
export function reorderLaneIds(displayRows,raw){
 const known=new Set(array(raw?.lanes).map(lane=>lane?.id)),rows=array(displayRows).filter(id=>typeof id==='string'&&known.has(id)),seen=new Set(rows);
 return[...rows,...array(raw?.lanes).map(lane=>lane?.id).filter(id=>typeof id==='string'&&!seen.has(id))];
}
/** Display rows after moving the lane at `row` one row up (-1) or down (+1),
 * or null when it is at the edge. Gaps (empty rows) are closed first. */
export function moveRow(displayRows,row,delta){
 const laneId=displayRows?.[row];if(typeof laneId!=='string'||!laneId||![-1,1].includes(delta))return null;
 const rows=array(displayRows).filter(id=>typeof id==='string'&&id),at=rows.indexOf(laneId),to=at+delta;if(at<0||to<0||to>=rows.length)return null;
 [rows[at],rows[to]]=[rows[to],rows[at]];return rows;
}
/** Display rows after dragging the lane at `row` to the insertion boundary `to`
 * (Logic track-header drag: 0 = above the first row, k = between display rows
 * k-1 and k), or null when it would not move. Gaps are closed first; `to` past
 * the last track means "last". */
export function moveRowTo(displayRows,row,to){
 const laneId=displayRows?.[row];if(typeof laneId!=='string'||!laneId||!Number.isInteger(to)||to<0)return null;
 const rows=array(displayRows).filter(id=>typeof id==='string'&&id),at=rows.indexOf(laneId);if(at<0)return null;
 const target=array(displayRows).slice(0,to).filter(id=>typeof id==='string'&&id&&id!==laneId).length;
 rows.splice(at,1);rows.splice(Math.min(target,rows.length),0,laneId);
 return rows.indexOf(laneId)===at?null:rows;
}
/** Menu model for one Playlist row. Items are {id,label,shortcut,disabled,reason} or null (separator). */
export function playlistTrackMenuItems({row,laneId=null,contents=null,studioApi=false,operations=STUDIO_API_OPERATIONS,displayRows=[],muted=false,solo=null,editable=true}={}){
 const items=[],busy=editable?null:'Wait for the current cloud operation to finish.',noLane=laneId?null:'This Playlist row has no saved track yet.',api=studioApi?null:'Track edits need a Freestyle Studio API project.';
 // A disabled item shows why in place of its hint (never "asks first" or a shortcut it cannot run).
 const add=(id,label,shortcut,reason=null)=>items.push({id,label,shortcut:reason||shortcut,disabled:!!reason,reason});
 // Logic Pro track header menu names (Track menu): Rename Track, New Track, New Track with Duplicate Settings ⌘D, Delete Track ⌘⌫.
 if(has(operations,TRACK_MENU_ROUTES.rename))add('rename','Rename Track','',busy||noLane);
 if(has(operations,TRACK_MENU_ROUTES.insert))add('insert','New Track','',busy||api);
 if(DUPLICATE_SETTINGS_ROUTES.every(id=>has(operations,id)))add('duplicate','New Track with Duplicate Settings','⌘D',busy||api||noLane||(contents?duplicateSettingsBlockReason(contents):null));
 // Logic Track ▸ Duplicate Track (no default key): the full copy with its regions.
 if(DUPLICATE_TRACK_ROUTES.every(id=>has(operations,id)))add('duplicate-track','Duplicate Track','',busy||api||noLane||(contents?duplicateBlockReason(contents):null));
 if(has(operations,TRACK_MENU_ROUTES.delete)&&has(operations,TRACK_MENU_ROUTES.restore))add('delete','Delete Track','⌘⌫',busy||api||noLane||deleteBlockReason(contents));
 // Drag a track header to reorder; Move Track Up / Down stay as the keyboard-free fallback.
 if(has(operations,TRACK_MENU_ROUTES.reorder)){items.push(null);add('move-up','Move Track Up','',busy||api||noLane||(moveRow(displayRows,row,-1)?null:'Already the top track.'));add('move-down','Move Track Down','',busy||api||noLane||(moveRow(displayRows,row,1)?null:'Already the bottom track.'));}
 if(has(operations,TRACK_MENU_ROUTES.mute)){items.push(null);add('mute',muted===true?'Unmute Track':'Mute Track','',busy||noLane||(muted===null?'Open the Mixer for this track to mute it.':null));add('solo',solo===true?'Unsolo Track':'Solo Track','',busy||noLane||(solo===null?'Open the Mixer for this track to solo it.':null));}
 while(items.length&&items.at(-1)===null)items.pop();return items;
}

const body=payload=>payload?.structuredContent?.response??payload?.structuredContent??payload?.response??payload;
/** deletedPatternChannels / restoredPatternChannels as [{patternId, channelId}], or null when absent or malformed. */
export function patternChannelList(value){if(!Array.isArray(value))return null;const rows=value.filter(item=>typeof item?.patternId==='string'&&item.patternId&&typeof item?.channelId==='string'&&item.channelId).map(item=>({patternId:item.patternId,channelId:item.channelId}));return rows.length===value.length?rows:null;}
const sameChannel=(a,b)=>a.patternId===b.patternId&&a.channelId===b.channelId;
const sameChannels=(a,b)=>a.length===b.length&&a.every(item=>b.some(other=>sameChannel(item,other)));
const remainingSources=(raw,laneId)=>array(raw?.patterns).flatMap(pattern=>array(pattern?.pattern?.sources).filter(source=>source?.laneId===laneId));
/** The documented liveEngine part of a deleteLane / restoreLane receipt (or null). */
export function liveEngineReceipt(receipt){const live=receipt?.liveEngine;if(!live||typeof live!=='object'||typeof live.applied!=='boolean')return null;return{applied:live.applied,...typeof live.chainRestored==='boolean'?{chainRestored:live.chainRestored}:{},...Array.isArray(live.attachedClipIds)?{attachedClipIds:[...live.attachedClipIds]}:{},...typeof live.reason==='string'?{reason:live.reason}:{},...typeof live.alreadyUnloaded==='boolean'?{alreadyUnloaded:live.alreadyUnloaded}:{}};}
const fail=(message,fields={})=>Object.assign(new Error(message),fields);
/** A returned timeline revision as an If-Match tag (the form getProject's ETag compares), or null. */
const revisionTag=value=>typeof value?.timelineRevision==='string'&&value.timelineRevision?JSON.stringify(value.timelineRevision):null;
const chunks=(ids,size)=>{const out=[];for(let i=0;i<ids.length;i+=size)out.push(ids.slice(i,i+size));return out;};
/** Guarded lane writes with read-back confirmation. `read()` returns the
 * fresh saved project, `call(name,args,options)` sends one typed write. A
 * guard that refuses before sending is dispatched:false; a write whose result
 * cannot be confirmed is operationUncertain and is never repeated. */
export class PlaylistTrackActions{
 /** placementBatch(ops,{ifMatch,idempotencyKey}) = the session's applyPatternPlacementBatch
  * (optional; without it copied pattern clips are deleted one by one); now() times each phase. */
 constructor({read,call,projectId,placementBatch=null,now=()=>globalThis.performance?.now?.()??Date.now(),key=()=>globalThis.crypto?.randomUUID?.()||`track-${Date.now()}-${Math.random().toString(36).slice(2)}`}){Object.assign(this,{read,call,projectId,placementBatch,now,key});}
 headers(raw){const tag=raw?._studioApi?.etag||(raw?.timelineRevision!=null?JSON.stringify(raw.timelineRevision):null);if(typeof tag!=='string'||!tag)throw fail('Reload the project revision before changing tracks.',{dispatched:false});return{ifMatch:tag,idempotencyKey:this.key()};}
 /** Delete one lane. `expect` (Redo) is the state the first Delete removed. */
 async deleteLane(laneId,{expect=null}={}){
  const raw=await this.read(),contents=laneContents(raw,laneId),blocked=deleteBlockReason(contents);if(blocked)throw fail(blocked,{dispatched:false});
  if(expect&&(!sameLaneSettings(contents.lane,expect.lane)||JSON.stringify([...contents.clipIds].sort())!==JSON.stringify([...expect.clipIds].sort())))throw fail('That track changed after Undo. Redo will not delete newer data.',{dispatched:false});
  const lane=structuredClone(contents.lane),receipt=body(await this.call('delete_lane',{project_id:this.projectId(),lane_id:laneId},this.headers(raw)));
  const deleted=receipt?.deletedClipIds;if(receipt?.laneId!==undefined&&receipt.laneId!==laneId)throw fail('The delete acknowledgement identifies another track.',{operationUncertain:true});
  if(!Array.isArray(deleted)||JSON.stringify([...deleted].sort())!==JSON.stringify([...contents.clipIds].sort()))throw fail('Freestyle did not confirm exactly this track’s clips as deleted. Inspect the project; nothing will be repeated.',{operationUncertain:true});
  // #15: every pattern channel that played this lane is named in deletedPatternChannels ({patternId, channelId}).
  const channels=patternChannelList(receipt?.deletedPatternChannels);
  if(contents.sources.length&&(!channels||!sameChannels(channels,contents.sources.map(source=>({patternId:source.patternId,channelId:source.sourceId})))))throw fail('Freestyle did not confirm exactly this track’s pattern channels as deleted. Inspect the project; nothing will be repeated.',{operationUncertain:true});
  const after=await this.read();if(array(after?.lanes).some(item=>item?.id===laneId))throw fail('Freestyle has not confirmed the track removal.',{operationUncertain:true});
  if(remainingSources(after,laneId).length)throw fail('Freestyle removed the track, but patterns still name it. Inspect the project.',{operationUncertain:true});
  // 339: the running session drops the lane at once (liveEngine.applied); a
  // saved-only delete (no live session) is still the confirmed edit.
  return{laneId,lane,clipIds:[...deleted],patternChannels:channels||[],liveEngine:liveEngineReceipt(receipt)};
 }
 /** Undo of deleteLane: the same lane (same id and settings) with its clips. */
 async restoreLane(state){
  const raw=await this.read();if(array(raw?.lanes).some(item=>item?.id===state.laneId))throw fail('That track already exists again. Undo will not overwrite it.',{dispatched:false});
  const receipt=body(await this.call('restore_lane',{project_id:this.projectId(),lane_id:state.laneId,clip_ids:[...state.clipIds]},this.headers(raw)));if(receipt?.laneId!==undefined&&receipt.laneId!==state.laneId)throw fail('The restore acknowledgement identifies another track.',{operationUncertain:true});
  const after=await this.read(),contents=laneContents(after,state.laneId);
  if(!contents.lane||!sameLaneSettings(contents.lane,state.lane)||!state.clipIds.every(id=>contents.clipIds.includes(id)))throw fail('Freestyle has not confirmed the restored track with its settings and clips.',{operationUncertain:true});
  // #15: the pattern channels the delete removed come back (restoredPatternChannels) and are in the saved patterns again.
  const wanted=array(state.patternChannels);
  if(wanted.length){const restored=patternChannelList(receipt?.restoredPatternChannels),present=contents.sources.map(source=>({patternId:source.patternId,channelId:source.sourceId}));if(!restored||!wanted.every(item=>restored.some(other=>sameChannel(item,other)))||!wanted.every(item=>present.some(other=>sameChannel(item,other))))throw fail('Freestyle restored the track, but not all of its pattern channels. Inspect the Step Sequencer.',{operationUncertain:true});}
  // 339: restoreLane re-attaches the clips and reloads the effects chain in the
  // running session (liveEngine.chainRestored). The saved restore above is the
  // confirmed edit; a live chain that did not reload is reported, not hidden.
  const liveEngine=liveEngineReceipt(receipt),chain=array(state.lane?.pluginChain).length>0;
  const liveChainRestored=liveEngine?.applied===true?(chain?liveEngine.chainRestored===true:true):null;
  return{laneId:state.laneId,clipIds:[...state.clipIds],patternChannels:[...wanted],liveEngine,liveChainRestored};
 }
 /** One typed write with an explicit If-Match (a revision tag, or null = none: only for
  * concurrent deletes of copies this step itself created). A definite 4xx refusal is
  * explicitRejection, any other failure an unknown outcome (never resent).
  * Returns {receipt, revision} (revision = the returned timeline revision as an If-Match tag, or null). */
 async sendWrite(name,args,ifMatch){
  let result;try{result=await this.call(name,{project_id:this.projectId(),...args},{ifMatch,idempotencyKey:this.key()});}catch(error){const status=Number(error?.status);if(error&&typeof error==='object'){if(status>=400&&status<500)error.explicitRejection??=true;else error.operationUncertain??=true;}throw error;}
  const receipt=body(result);if(result?.isError||receipt?.ok===false||receipt?.error)throw fail(typeof receipt?.error==='string'?receipt.error:receipt?.error?.message||receipt?.message||`Freestyle refused ${name}.`,{explicitRejection:true});
  return{receipt:receipt??{},revision:revisionTag(receipt)??revisionTag(result?.structuredContent)??revisionTag(result)};
 }
 /** One typed write on the revision of the read `raw`. */
 async write(name,args,raw){return(await this.sendWrite(name,args,this.headers(raw).ifMatch)).receipt;}
 /** duplicateLane on `laneId` (one guarded write). The copy is identified by its receipt
  * (laneId, patternRowLaneId, clipIds / patternIds / placementIds maps). */
 async copyLane(laneId){
  const raw=await this.read(),contents=laneContents(raw,laneId),blocked=duplicateBlockReason(contents);if(blocked)throw fail(blocked,{dispatched:false});
  const before=new Set(array(raw?.lanes).map(lane=>lane?.id)),started=this.now();
  const {receipt,revision}=await this.sendWrite('duplicate_lane',{lane_id:laneId},this.headers(raw).ifMatch);
  const copy=duplicateReceiptContent(receipt,laneId);
  if(!copy.laneId||before.has(copy.laneId)||copy.rowLaneId&&before.has(copy.rowLaneId)||receipt.sourceLaneId!==undefined&&receipt.sourceLaneId!==laneId)throw fail('Freestyle has not identified the duplicated track. Inspect the tracks; nothing will be repeated.',{operationUncertain:true});
  return{raw,source:structuredClone(contents.lane),receipt,copy,revision,beforeRows:savedRowOrder(raw),beforeOrders:Object.fromEntries(array(raw?.lanes).map(lane=>[lane.id,lane.order])),duplicateMs:this.now()-started};
 }
 /** Remove content this step created: audio copies (one applyClipBatch), pattern clips (one
  * applyPatternPlacementBatch) on the revision chain, then the pattern copies, extra lanes
  * and `extra` writes concurrently (no If-Match when several run at once: they touch only
  * new ids). Every concurrent write settles before the first failure is thrown. */
 async removeContent({clipIds=[],placementIds=[],patternIds=[],laneIds=[],extra=[]}={},revision=null){
  const tag=async()=>revision||(revision=this.headers(await this.read()).ifMatch),out={engineReloadRequired:false};
  for(const ids of chunks(clipIds,256)){const sent=await this.sendWrite('apply_clip_batch',{ops:ids.map(id=>({op:'remove',id}))},await tag());revision=sent.revision;if(sent.receipt?.engine_reload_required===true)out.engineReloadRequired=true;}
  for(const ids of chunks(placementIds,256)){
   // One atomic batch when the session supports it (null / placementBatchUnavailable = it does not: one delete per clip).
   let result=null;
   if(typeof this.placementBatch==='function')try{result=await this.placementBatch(ids.map(placementId=>({op:'delete',placementId})),{ifMatch:await tag(),idempotencyKey:this.key()});}catch(error){if(error?.placementBatchUnavailable!==true){const status=Number(error?.status);if(error&&typeof error==='object'&&!(status>=400&&status<500))error.operationUncertain??=true;throw error;}}
   if(result)revision=revisionTag(result);
   else for(const placementId of ids)revision=(await this.sendWrite('execute_pro_action',{action:'delete_pattern_placement',arguments:{placement_id:placementId},confirmed_destructive:true},await tag())).revision;
  }
  const writes=[...patternIds.map(id=>['execute_pro_action',{action:'delete_pattern',arguments:{pattern_id:id},confirmed_destructive:true}]),...laneIds.map(id=>['delete_lane',{lane_id:id}]),...extra];
  if(writes.length){
   const ifMatch=writes.length===1?await tag():null,settled=await Promise.allSettled(writes.map(([name,args])=>this.sendWrite(name,args,ifMatch)));
   const failed=settled.find(item=>item.status==='rejected');if(failed)throw failed.reason;
   revision=writes.length===1?settled[0].value.revision:null;
  }
  return{...out,revision};
 }
 /** What of a copy still exists in a read: {laneIds, clipIds, placementIds, patternIds}. */
 copyLeft(raw,copy){
  const lanes=new Set(array(raw?.lanes).map(lane=>lane?.id)),clips=new Set(array(raw?.clips).map(clip=>clip?.id)),placements=new Set(array(raw?.placements).map(row=>row?.id)),patterns=new Set(array(raw?.patterns).map(row=>row?.id));
  const own=new Set([copy.laneId,copy.rowLaneId].filter(Boolean));
  return{laneIds:[copy.laneId,copy.rowLaneId].filter(id=>id&&lanes.has(id)),clipIds:[...new Set([...array(copy.clipIds).filter(id=>clips.has(id)),...array(raw?.clips).filter(clip=>own.has(clip?.laneId)).map(clip=>clip.id)])],placementIds:[...new Set([...array(copy.placementIds).filter(id=>placements.has(id)),...array(raw?.placements).filter(row=>own.has(laneOf(row))).map(row=>row.id)])],patternIds:array(copy.patternIds).filter(id=>patterns.has(id))};
 }
 /** Delete a whole copy (rollback, and Undo of Duplicate Track): deleteLane on the copy
  * (which takes its clips, pattern copies and pattern row with it), then whatever is still
  * there is removed explicitly. Confirmed by a fresh read; returns {after, receipt}. */
 async discardCopy(copy,raw=null){
  raw??=await this.read();let receipt=null;
  if(array(raw?.lanes).some(lane=>lane?.id===copy.laneId)){receipt=await this.write('delete_lane',{lane_id:copy.laneId},raw);if(receipt?.laneId!==undefined&&receipt.laneId!==copy.laneId)throw fail('The delete acknowledgement identifies another track.',{operationUncertain:true});raw=await this.read();}
  let left=this.copyLeft(raw,copy);
  if(left.laneIds.length||left.clipIds.length||left.placementIds.length||left.patternIds.length){
   // Clips and pattern clips on a lane that is deleted go with it.
   const gone=new Set(left.laneIds),clipLane=new Map(array(raw?.clips).map(clip=>[clip?.id,clip?.laneId])),placementLane=new Map(array(raw?.placements).map(row=>[row?.id,laneOf(row)]));
   await this.removeContent({clipIds:left.clipIds.filter(id=>!gone.has(clipLane.get(id))),placementIds:left.placementIds.filter(id=>!gone.has(placementLane.get(id))),patternIds:[],laneIds:left.laneIds},this.headers(raw).ifMatch);
   raw=await this.read();left=this.copyLeft(raw,copy);
   if(left.patternIds.length){await this.removeContent({placementIds:left.placementIds,patternIds:left.patternIds},this.headers(raw).ifMatch);raw=await this.read();left=this.copyLeft(raw,copy);}
  }
  if(left.laneIds.length||left.clipIds.length||left.placementIds.length||left.patternIds.length)throw fail('Freestyle still lists part of the duplicated track.',{operationUncertain:true});
  return{after:raw,receipt};
 }
 /** Put the saved order values back when a removal left the rows but not their orders. */
 async restoreOrder(state,after){if(JSON.stringify(savedRowOrder(after))===JSON.stringify(state.beforeRows)&&array(after?.lanes).some(lane=>state.beforeOrders?.[lane.id]!==undefined&&state.beforeOrders[lane.id]!==lane.order))await this.reorder(state.beforeRows,{expectedRows:state.beforeRows});}
 /** Rows with `laneId` directly below `sourceLaneId`. */
 static belowSource(rows,sourceLaneId,laneId){return rows.filter(id=>id!==laneId).flatMap(id=>id===sourceLaneId?[id,laneId]:[id]);}
 /** Logic Track ▸ Duplicate Track: duplicateLane as-is (regions, pattern copies on their new
  * pattern row, channel strip), named like the source, confirmed by one read. Undo =
  * removeTrackCopy, Redo = redoTrackCopy. */
 async duplicateLane(laneId){
  const started=this.now(),{source,receipt,copy,revision,beforeRows,beforeOrders,duplicateMs}=await this.copyLane(laneId),name=trackName(source),notCopied=[];
  if(receipt.name!==name)try{await this.sendWrite('set_lane_identity',{lane_id:copy.laneId,name},revision);}catch(error){notCopied.push(`name “${name}”`);}
  const after=await this.read(),lane=array(after?.lanes).find(item=>item?.id===copy.laneId),left=this.copyLeft(after,copy);
  if(!lane||copy.rowLaneId&&!left.laneIds.includes(copy.rowLaneId)||copy.clipIds.some(id=>!left.clipIds.includes(id))||copy.patternIds.some(id=>!left.patternIds.includes(id))||copy.placementIds.some(id=>!left.placementIds.includes(id)))throw fail('Freestyle has not confirmed the duplicated track with its regions. Inspect the tracks; nothing will be repeated.',{operationUncertain:true});
  return{laneId:copy.laneId,sourceLaneId:laneId,rowLaneId:copy.rowLaneId,clipIds:left.clipIds,placementIds:left.placementIds,patternIds:left.patternIds,lane:structuredClone(lane),beforeRows,beforeOrders,afterRows:savedRowOrder(after),deletedClipIds:null,notCopied,liveEngine:liveEngineReceipt(receipt),timings:{duplicateMs,totalMs:this.now()-started}};
 }
 /** Undo of Duplicate Track: delete the copy (with its pattern copies and row) only while it is unchanged. */
 async removeTrackCopy(state){
  const raw=await this.read(),lane=array(raw?.lanes).find(item=>item?.id===state.laneId);if(!lane)throw fail('The duplicated track no longer exists.',{dispatched:false});
  const left=this.copyLeft(raw,state),same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
  if(!sameLaneSettings(lane,state.lane)||!same(left.clipIds,state.clipIds)||!same(left.placementIds,state.placementIds)||!same(left.patternIds,state.patternIds))throw fail('That track changed after Duplicate Track. Undo will not delete newer data.',{dispatched:false});
  const {after,receipt}=await this.discardCopy(state,raw);await this.restoreOrder(state,after);
  state.deletedClipIds=Array.isArray(receipt?.deletedClipIds)?[...receipt.deletedClipIds]:[];
  return{laneId:state.laneId,clipIds:[...state.deletedClipIds],liveEngine:liveEngineReceipt(receipt)};
 }
 /** Redo of Duplicate Track: restoreLane brings back that exact audio copy (same id, clips
  * and row); a copy with pattern copies is made again with duplicateLane (new ids). */
 async redoTrackCopy(state){
  if(!state.rowLaneId&&!state.patternIds.length&&!state.placementIds.length&&Array.isArray(state.deletedClipIds)&&state.deletedClipIds.length===state.clipIds.length){
   const result=await this.restoreLane({laneId:state.laneId,lane:state.lane,clipIds:state.deletedClipIds}),after=await this.read();
   if(state.afterRows&&JSON.stringify(savedRowOrder(after))!==JSON.stringify(state.afterRows))await this.reorder(state.afterRows,{expectedRows:savedRowOrder(after)});
   state.clipIds=[...state.deletedClipIds];state.deletedClipIds=null;return result;
  }
  const raw=await this.read();if(array(raw?.lanes).some(lane=>lane?.id===state.laneId))throw fail('The duplicated track already exists again. Redo will not copy it twice.',{dispatched:false});
  const next=await this.duplicateLane(state.sourceLaneId);Object.assign(state,next);return{laneId:next.laneId,clipIds:next.clipIds};
 }
 /** Logic ⌘D: a new EMPTY track of the same type directly below `laneId` with the same
  * channel strip. duplicateLane copies the strip exactly (instrument + patch state, chain,
  * sends, fader, pan, bus); the copied regions, pattern copies and pattern row its receipt
  * names are removed again, the copy is named like the source, and one read confirms it.
  * If any step fails the copy is deleted again (`rolledBack`). */
 async duplicateSettings(laneId){
  const started=this.now(),{source,receipt,copy,revision,beforeRows,beforeOrders,duplicateMs}=await this.copyLane(laneId),name=trackName(source);
  const state={laneId:copy.laneId,sourceLaneId:laneId,sourceName:source.name||'',beforeRows,beforeOrders,afterRows:null,lane:null,notCopied:[],engineReloadRequired:false,liveEngine:liveEngineReceipt(receipt),timings:{duplicateMs}};
  try{
   const removing=this.now(),removed=await this.removeContent({clipIds:copy.clipIds,placementIds:copy.placementIds,patternIds:copy.patternIds,laneIds:copy.rowLaneId?[copy.rowLaneId]:[],extra:receipt.name===name?[]:[['set_lane_identity',{lane_id:copy.laneId,name}]]},revision);
   state.engineReloadRequired=removed.engineReloadRequired;state.timings.removeMs=this.now()-removing;
   let after=await this.read();const left=this.copyLeft(after,copy);let lane=array(after?.lanes).find(item=>item?.id===copy.laneId);
   if(!lane)throw fail('Freestyle has not confirmed the new track.');
   if(left.laneIds.length>1||left.clipIds.length||left.placementIds.length||left.patternIds.length||!laneContents(after,copy.laneId).empty)throw fail('The new track is not empty.');
   // duplicateLane copies the strip exactly; anything that still differs is reported, not hidden.
   const got=chainSignature(lane),want=chainSignature(source);
   if(got.length!==want.length||got.some((plugin,index)=>plugin.type!==want[index].type||plugin.bypassed!==want[index].bypassed))state.notCopied.push('effects chain');
   else{const at=got.findIndex((plugin,index)=>plugin.preset!==want[index].preset&&!samePatch(plugin.preset,want[index].preset)&&!samePatch(want[index].preset,plugin.preset));if(at>=0)state.notCopied.push(want[at].preset?`patch “${want[at].preset}”`:'patch');}
   for(const [field,label] of [['volume','volume'],['pan','pan'],['busId','output']])if(source[field]!==undefined&&(typeof source[field]==='number'?Math.abs(Number(lane[field])-source[field])>1e-6:lane[field]!==source[field]))state.notCopied.push(label);
   if(lane.name!==name)state.notCopied.push(`name “${name}”`);
   // Directly below the source (duplicateLane places it there; a pattern row removed above closed its own gap).
   const wanted=PlaylistTrackActions.belowSource(beforeRows,laneId,copy.laneId);if(JSON.stringify(savedRowOrder(after))!==JSON.stringify(wanted)){await this.reorder(wanted,{expectedRows:savedRowOrder(after)});after=await this.read();lane=array(after?.lanes).find(item=>item?.id===copy.laneId);}
   state.afterRows=savedRowOrder(after);state.lane=structuredClone(lane);state.timings.totalMs=this.now()-started;
   return state;
  }catch(error){
   const reason=String(error?.message||error).replace(/([^.!?])$/,'$1.');
   try{const {after}=await this.discardCopy(copy);await this.restoreOrder(state,after);}catch(rollbackError){throw fail(`Not saved: ${reason} The new track could not be removed (${rollbackError.message}). Inspect the tracks; nothing will be repeated.`,{operationUncertain:true,cause:error});}
   throw fail(`Not saved: ${reason} The new track was removed again.`,{rolledBack:true,cause:error,status:error?.status});
  }
 }
 /** Undo of duplicateSettings: delete the new lane only while it is still empty and
  * unchanged, then put the previous saved order back. */
 async removeDuplicate(state){
  const raw=await this.read(),contents=laneContents(raw,state.laneId);if(!contents.lane)throw fail('The duplicated track no longer exists.',{dispatched:false});if(!contents.empty||!sameLaneSettings(contents.lane,state.lane))throw fail('That track changed after New Track with Duplicate Settings. Undo will not delete it.',{dispatched:false});
  const removed=await this.deleteLane(state.laneId,{expect:{lane:state.lane,clipIds:[]}});await this.restoreOrder(state,await this.read());
  return removed;
 }
 /** Redo of duplicateSettings: the same ⌘D again (a fresh duplicateLane of the source). */
 async redoDuplicate(state){
  const raw=await this.read();if(array(raw?.lanes).some(lane=>lane?.id===state.laneId))throw fail('The new track already exists again. Redo will not add another.',{dispatched:false});
  const next=await this.duplicateSettings(state.sourceLaneId);Object.assign(state,next);return{laneId:next.laneId};
 }
 /** Persist a row order. `expectedRows` guards the saved order it replaces. */
 async reorder(laneIds,{expectedRows=null}={}){
  const raw=await this.read();if(expectedRows&&JSON.stringify(savedRowOrder(raw))!==JSON.stringify(expectedRows))throw fail('The track order changed. Reorder will not overwrite newer data.',{dispatched:false});
  const ids=reorderLaneIds(laneIds,raw);await this.call('reorder_lanes',{project_id:this.projectId(),lane_ids:ids},this.headers(raw));
  const after=await this.read(),rows=savedRowOrder(after),wanted=ids.filter(id=>rows.includes(id));
  if(JSON.stringify(rows)!==JSON.stringify(wanted))throw fail('Freestyle has not confirmed the new track order.',{operationUncertain:true});
  return{rows};
 }
}
