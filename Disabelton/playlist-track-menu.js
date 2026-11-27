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
 *   Move up/down  reorderLanes  POST  /lanes:reorder       (reorder_lanes)
 *   Mute / Solo   updateLane    muted / soloed             (the Mixer's own queued lane controls)
 * Track colour is not in this menu model: Disabelton's Live track menu adds
 * "Track Color…" (updateLane {color}) in abl-track-ops.js, which remembers the
 * confirmed colour per project because the saved lane read does not return it.
 * Duplicate (duplicateLane) covers audio, instrument and pattern lanes since
 * release 2026-11-14. */
import {STUDIO_API_OPERATIONS} from './studio-api-client.js';

export const TRACK_MENU_ROUTES=Object.freeze({rename:'updateLane',insert:'createLane',duplicate:'duplicateLane',delete:'deleteLane',restore:'restoreLane',reorder:'reorderLanes',mute:'updateLane',solo:'updateLane'});
/** Lane kinds Freestyle's duplicateLane copies. Release 2026-11-14: audio (vocal / audio / guitar),
 * instrument lanes (generator + chain + an independent per-lane pattern copy on a new pattern row)
 * and pattern rows (independent pattern copies at identical geometry). */
export const DUPLICABLE_LANE_KINDS=Object.freeze(['audio','vocal','guitar','instrument','pattern']);
const AUDIO_LANE_KINDS=new Set(['audio','vocal','guitar']);
/** Why New Track with Duplicate Settings cannot run for this lane, or null. Mirrors the
 * documented 409s (lane_kind_not_duplicable, lane_has_pattern_clips); see also
 * studio-api-engine-helpers.js laneDuplicateAvailability for the raw-project form. */
export function duplicateBlockReason(contents){
 if(!contents?.lane)return 'Select a saved track first.';
 if(!DUPLICABLE_LANE_KINDS.includes(contents.lane.kind))return 'Freestyle cannot duplicate this kind of track.';
 // duplicateLane documents an audio lane's copy as its takes/clips; pattern clips on an audio lane are not named.
 if(AUDIO_LANE_KINDS.has(contents.lane.kind)&&contents.placementIds?.length)return 'This audio track holds pattern clips, which Freestyle does not copy with an audio track.';
 return null;
}
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
 // Who plays this lane's instrument: the tracks holding clips (placements) of those patterns, and unplaced (Session) clips.
 const playing=new Set(sources.map(source=>source.patternId)),placed=array(raw?.placements).filter(row=>playing.has(row?.patternId)),laneName=id=>array(raw?.lanes).find(lane=>lane?.id===id)?.name||'another track';
 const playerTracks=[...new Set(placed.filter(row=>laneOf(row)!==laneId).map(row=>laneName(laneOf(row))))],placedPatterns=new Set(placed.map(row=>row.patternId));
 const playerClips=[...new Set(array(raw?.patterns).filter(pattern=>playing.has(pattern?.id)&&!placedPatterns.has(pattern.id)).map(pattern=>pattern.name||'MIDI clip'))];
 return{lane:matches.length===1?matches[0]:null,clipIds,placementIds,sources,playerTracks,playerClips,empty:!clipIds.length&&!placementIds.length&&!sources.length};
}
/** deletedPatternChannels / restoredPatternChannels rows as sorted {patternId, channelId} (invalid rows dropped). */
export function patternChannelKeys(value){return array(value).filter(item=>typeof item?.patternId==='string'&&typeof item?.channelId==='string').map(item=>({patternId:item.patternId,channelId:item.channelId})).sort((a,b)=>`${a.patternId}/${a.channelId}`.localeCompare(`${b.patternId}/${b.channelId}`));}
/** The channels a receipt names are exactly the lane's pattern sources ({patternId, sourceId}). */
export function samePatternChannels(channels,sources){const a=channels.map(item=>`${item.patternId}/${item.channelId}`).sort(),b=array(sources).map(item=>`${item.patternId}/${item.sourceId}`).sort();return JSON.stringify(a)===JSON.stringify(b);}
/** Saved lane settings a Delete → Undo must bring back unchanged. */
export const LANE_SETTING_FIELDS=Object.freeze(['id','name','kind','trackType','volume','pan','muted','solo','soloed','busId','order','pluginChain']);
export function laneSettings(lane){const out={};for(const key of LANE_SETTING_FIELDS)if(lane&&Object.prototype.hasOwnProperty.call(lane,key))out[key]=lane[key];return out;}
export function sameLaneSettings(a,b){return JSON.stringify(laneSettings(a))===JSON.stringify(laneSettings(b));}
/** Why Delete track cannot be applied (and undone) exactly, or null. */
export function deleteBlockReason(contents){
 if(!contents?.lane)return 'Reload the saved track before deleting it.';
 // Freestyle #15: deleting an instrument lane also removes the pattern channels that play it (deletedPatternChannels)
 // and restoreLane brings them back (restoredPatternChannels), so the channels no longer block Delete (Undo restores them).
 if(contents.placementIds.length)return `Move or delete its ${contents.placementIds.length} pattern clip${contents.placementIds.length===1?'':'s'} first: Freestyle has no exact Undo for pattern clips removed with a track.`;
 return null;
}
/** Edit ▸ Delete / ⌫ / Delete Track gate, known before anything is offered: {enabled, reason}. */
export function deleteTrackAvailability(raw,laneId){
 if(typeof laneId!=='string'||!laneId)return{enabled:false,reason:'This row has no saved track yet.'};
 const reason=deleteBlockReason(laneContents(raw,laneId));return{enabled:!reason,reason:reason||''};
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
 if(has(operations,TRACK_MENU_ROUTES.duplicate)&&has(operations,TRACK_MENU_ROUTES.delete)&&has(operations,TRACK_MENU_ROUTES.restore))add('duplicate','New Track with Duplicate Settings','⌘D',busy||api||noLane||(contents?duplicateBlockReason(contents):null));
 if(has(operations,TRACK_MENU_ROUTES.delete)&&has(operations,TRACK_MENU_ROUTES.restore))add('delete','Delete Track','⌘⌫',busy||api||noLane||deleteBlockReason(contents));
 // Drag a track header to reorder; Move Track Up / Down stay as the keyboard-free fallback.
 if(has(operations,TRACK_MENU_ROUTES.reorder)){items.push(null);add('move-up','Move Track Up','',busy||api||noLane||(moveRow(displayRows,row,-1)?null:'Already the top track.'));add('move-down','Move Track Down','',busy||api||noLane||(moveRow(displayRows,row,1)?null:'Already the bottom track.'));}
 if(has(operations,TRACK_MENU_ROUTES.mute)){items.push(null);add('mute',muted===true?'Unmute Track':'Mute Track','',busy||noLane||(muted===null?'Open the Mixer for this track to mute it.':null));add('solo',solo===true?'Unsolo Track':'Solo Track','',busy||noLane||(solo===null?'Open the Mixer for this track to solo it.':null));}
 while(items.length&&items.at(-1)===null)items.pop();return items;
}

const body=payload=>payload?.structuredContent?.response??payload?.structuredContent??payload?.response??payload;
/** The documented liveEngine part of a deleteLane / restoreLane receipt (or null). */
export function liveEngineReceipt(receipt){const live=receipt?.liveEngine;if(!live||typeof live!=='object'||typeof live.applied!=='boolean')return null;return{applied:live.applied,...typeof live.chainRestored==='boolean'?{chainRestored:live.chainRestored}:{},...Array.isArray(live.attachedClipIds)?{attachedClipIds:[...live.attachedClipIds]}:{},...typeof live.reason==='string'?{reason:live.reason}:{},...typeof live.alreadyUnloaded==='boolean'?{alreadyUnloaded:live.alreadyUnloaded}:{}};}
const fail=(message,fields={})=>Object.assign(new Error(message),fields);
const sortedIds=value=>array(value).filter(id=>typeof id==='string'&&id).sort();
/** The pattern copies / pattern row a duplicateLane created for `duplicate` (its receipt), when they are
 * still the only things that play the copied instrument: {laneIds, patternIds, placementIds} sorted, or
 * null when other clips now use it (then Undo would delete newer data). Audio copies own nothing extra. */
export function duplicateOwnedContents(raw,contents,duplicate){
 if(!contents?.lane||!duplicate)return null;
 const patternIds=new Set(sortedIds(duplicate.patternIds)),row=duplicate.patternRowLaneId||null;
 if(contents.sources.some(source=>!patternIds.has(source.patternId)))return null;
 const placements=array(raw?.placements).filter(item=>patternIds.has(item?.patternId));
 if(placements.some(item=>laneOf(item)!==row&&laneOf(item)!==contents.lane.id))return null;
 if(contents.placementIds.length)return null;
 const rowPlacements=row?array(raw?.placements).filter(item=>laneOf(item)===row):[];
 if(rowPlacements.some(item=>!patternIds.has(item?.patternId)))return null;
 if(!patternIds.size&&!row)return deleteBlockReason(contents)?null:{laneIds:[],patternIds:[],placementIds:[]};
 return{laneIds:row?[row]:[],patternIds:[...patternIds].sort(),placementIds:sortedIds(placements.map(item=>item.id))};
}
/** Guarded lane writes with read-back confirmation. `read()` returns the
 * fresh saved project, `call(name,args,options)` sends one typed write. A
 * guard that refuses before sending is dispatched:false; a write whose result
 * cannot be confirmed is operationUncertain and is never repeated. */
export class PlaylistTrackActions{
 constructor({read,call,projectId,key=()=>globalThis.crypto?.randomUUID?.()||`track-${Date.now()}-${Math.random().toString(36).slice(2)}`}){Object.assign(this,{read,call,projectId,key});}
 headers(raw){const tag=raw?._studioApi?.etag||(raw?.timelineRevision!=null?JSON.stringify(raw.timelineRevision):null);if(typeof tag!=='string'||!tag)throw fail('Reload the project revision before changing tracks.',{dispatched:false});return{ifMatch:tag,idempotencyKey:this.key()};}
 /** Delete one lane. `expect` (Redo) is the state the first Delete removed. */
 async deleteLane(laneId,{expect=null,duplicate=null}={}){
  const raw=await this.read(),contents=laneContents(raw,laneId),owned=duplicate?.laneId===laneId?duplicateOwnedContents(raw,contents,duplicate):null,blocked=owned?null:deleteBlockReason(contents);if(blocked)throw fail(blocked,{dispatched:false});
  if(duplicate&&!owned)throw fail('That duplicated track is now played by other clips. Undo will not delete newer data.',{dispatched:false});
  if(expect&&(!sameLaneSettings(contents.lane,expect.lane)||JSON.stringify([...contents.clipIds].sort())!==JSON.stringify([...expect.clipIds].sort())))throw fail('That track changed after Undo. Redo will not delete newer data.',{dispatched:false});
  const lane=structuredClone(contents.lane),receipt=body(await this.call('delete_lane',{project_id:this.projectId(),lane_id:laneId},this.headers(raw)));
  const deleted=receipt?.deletedClipIds;if(receipt?.laneId!==undefined&&receipt.laneId!==laneId)throw fail('The delete acknowledgement identifies another track.',{operationUncertain:true});
  if(!Array.isArray(deleted)||JSON.stringify([...deleted].sort())!==JSON.stringify([...contents.clipIds].sort()))throw fail('Freestyle did not confirm exactly this track’s clips as deleted. Inspect the project; nothing will be repeated.',{operationUncertain:true});
  // 2026-11-14: deleting a duplicated instrument lane also removes its pattern copies, their clips and
  // its pattern row (the duplicate's documented undo). Confirm exactly those went, nothing else.
  const companions=owned?{laneIds:sortedIds(receipt?.deletedLaneIds),patternIds:sortedIds(receipt?.deletedPatternIds),placementIds:sortedIds(receipt?.deletedPlacementIds)}:null;
  if(owned&&JSON.stringify(companions)!==JSON.stringify(owned))throw fail('Freestyle did not confirm exactly the duplicated track’s pattern copies as deleted. Inspect the project; nothing will be repeated.',{operationUncertain:true});
  // Freestyle #15: exactly the pattern channels that played this lane went with it.
  // (A duplicate's undo removes its whole pattern copies instead: confirmed as companions above.)
  const channels=owned?[]:patternChannelKeys(receipt?.deletedPatternChannels);
  if(!owned&&!samePatternChannels(channels,contents.sources))throw fail('Freestyle did not confirm exactly this track’s pattern channels as deleted. Inspect the project; nothing will be repeated.',{operationUncertain:true});
  const after=await this.read();if(array(after?.lanes).some(item=>item?.id===laneId||companions?.laneIds.includes(item?.id)))throw fail('Freestyle has not confirmed the track removal.',{operationUncertain:true});
  // 339: the running session drops the lane at once (liveEngine.applied); a
  // saved-only delete (no live session) is still the confirmed edit.
  return{laneId,lane,clipIds:[...deleted],patternChannels:channels,liveEngine:liveEngineReceipt(receipt),...companions?{companions}:{}};
 }
 /** Undo of deleteLane: the same lane (same id and settings) with its clips. */
 async restoreLane(state){
  const raw=await this.read();if(array(raw?.lanes).some(item=>item?.id===state.laneId))throw fail('That track already exists again. Undo will not overwrite it.',{dispatched:false});
  const receipt=body(await this.call('restore_lane',{project_id:this.projectId(),lane_id:state.laneId,clip_ids:[...state.clipIds]},this.headers(raw)));if(receipt?.laneId!==undefined&&receipt.laneId!==state.laneId)throw fail('The restore acknowledgement identifies another track.',{operationUncertain:true});
  // A duplicated instrument lane comes back with exactly the pattern row / copies its delete removed.
  if(state.companions&&(JSON.stringify(sortedIds(receipt?.restoredLaneIds))!==JSON.stringify(state.companions.laneIds)||JSON.stringify(sortedIds(receipt?.restoredPatternIds))!==JSON.stringify(state.companions.patternIds)||JSON.stringify(sortedIds(receipt?.restoredPlacementIds))!==JSON.stringify(state.companions.placementIds)))throw fail('Freestyle did not confirm the duplicated track’s pattern copies as restored.',{operationUncertain:true});
  // Freestyle #15: the pattern channels the delete removed come back with the lane.
  if(array(state.patternChannels).length&&!samePatternChannels(patternChannelKeys(receipt?.restoredPatternChannels),array(state.patternChannels).map(item=>({patternId:item.patternId,sourceId:item.channelId}))))throw fail('Freestyle did not confirm the track’s pattern channels as restored.',{operationUncertain:true});
  const after=await this.read(),contents=laneContents(after,state.laneId);
  if(!contents.lane||!sameLaneSettings(contents.lane,state.lane)||!state.clipIds.every(id=>contents.clipIds.includes(id)))throw fail('Freestyle has not confirmed the restored track with its settings and clips.',{operationUncertain:true});
  // 339: restoreLane re-attaches the clips and reloads the effects chain in the
  // running session (liveEngine.chainRestored). The saved restore above is the
  // confirmed edit; a live chain that did not reload is reported, not hidden.
  const liveEngine=liveEngineReceipt(receipt),chain=array(state.lane?.pluginChain).length>0;
  const liveChainRestored=liveEngine?.applied===true?(chain?liveEngine.chainRestored===true:true):null;
  return{laneId:state.laneId,clipIds:[...state.clipIds],liveEngine,liveChainRestored,...state.companions?{companions:structuredClone(state.companions)}:{}};
 }
 /** Logic's New Track with Duplicate Settings over Freestyle duplicateLane
  * (settings, effects chain and takes). The new lane is identified by the
  * confirming read (exactly one lane that did not exist before); Undo deletes it
  * through deleteLane / restoreLane like any other track. */
 async duplicateLane(laneId){
  const raw=await this.read(),contents=laneContents(raw,laneId),blocked=duplicateBlockReason(contents);if(blocked)throw fail(blocked,{dispatched:false});
  const before=new Set(array(raw?.lanes).map(lane=>lane?.id));
  // A definite 4xx refusal created nothing; any other failure has an unknown outcome and is never resent.
  let receipt;try{receipt=body(await this.call('duplicate_lane',{project_id:this.projectId(),lane_id:laneId},this.headers(raw)));}catch(error){const status=Number(error?.status);if(!(status>=400&&status<500)&&error&&typeof error==='object')error.operationUncertain??=true;throw error;}
  const after=await this.read(),created=array(after?.lanes).filter(lane=>lane?.id&&!before.has(lane.id));
  const named=typeof receipt?.laneId==='string'&&receipt.laneId!==laneId?receipt.laneId:typeof receipt?.lane?.id==='string'&&receipt.lane.id!==laneId?receipt.lane.id:null;
  // An instrument lane's copy brings its own new pattern row (receipt.patternRowLaneId).
  const patternRowLaneId=typeof receipt?.patternRowLaneId==='string'&&receipt.patternRowLaneId&&receipt.patternRowLaneId!==named?receipt.patternRowLaneId:null;
  const lane=named?created.find(item=>item.id===named):created.length===1?created[0]:null;
  const expected=1+(patternRowLaneId?1:0);
  if(!lane||created.length!==expected||patternRowLaneId&&!created.some(item=>item.id===patternRowLaneId))throw fail('Freestyle has not confirmed exactly one duplicated track. Inspect the tracks; nothing will be repeated.',{operationUncertain:true});
  const ids=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.values(value).filter(id=>typeof id==='string'&&id):[];
  return{laneId:lane.id,sourceLaneId:laneId,lane:structuredClone(lane),patternRowLaneId,patternIds:ids(receipt?.patternIds),placementIds:ids(receipt?.placementIds),clipIds:ids(receipt?.clipIds)};
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
