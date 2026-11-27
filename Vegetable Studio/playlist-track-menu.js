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
 * Change color is deliberately absent: updateLane accepts `color`, but the
 * saved lane read never returns one, so a recolor could be neither shown nor
 * confirmed. */
import {STUDIO_API_OPERATIONS} from './studio-api-client.js';

export const TRACK_MENU_ROUTES=Object.freeze({rename:'updateLane',insert:'createLane',delete:'deleteLane',restore:'restoreLane',reorder:'reorderLanes',mute:'updateLane',solo:'updateLane'});
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
export function deleteBlockReason(contents){
 if(!contents?.lane)return 'Reload the saved track before deleting it.';
 // Issue #15: deleteLane also removes the pattern channels that play the lane (deletedPatternChannels) and restoreLane
 // puts them back (restoredPatternChannels), so a track played by Channel rack channels is deletable with an exact Undo.
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
/** Menu model for one Playlist row. Items are {id,label,shortcut,disabled,reason} or null (separator). */
export function playlistTrackMenuItems({row,laneId=null,contents=null,studioApi=false,operations=STUDIO_API_OPERATIONS,displayRows=[],muted=false,solo=null,editable=true}={}){
 const items=[],busy=editable?null:'Wait for the current cloud operation to finish.',noLane=laneId?null:'This Playlist row has no saved track yet.',api=studioApi?null:'Track edits need a Freestyle Studio API project.';
 // A disabled item shows why in place of its hint (never "asks first" or a shortcut it cannot run).
 const add=(id,label,shortcut,reason=null)=>items.push({id,label,shortcut:reason||shortcut,disabled:!!reason,reason});
 if(has(operations,TRACK_MENU_ROUTES.rename))add('rename','Rename…','F2',busy||noLane);
 if(has(operations,TRACK_MENU_ROUTES.insert))add('insert','Insert track','above',busy||api);
 if(has(operations,TRACK_MENU_ROUTES.delete)&&has(operations,TRACK_MENU_ROUTES.restore))add('delete','Delete track',contents&&!contents.empty?'asks first':'',busy||api||noLane||deleteBlockReason(contents));
 if(has(operations,TRACK_MENU_ROUTES.reorder)){items.push(null);add('move-up','Move up','',busy||api||noLane||(moveRow(displayRows,row,-1)?null:'Already the top track.'));add('move-down','Move down','',busy||api||noLane||(moveRow(displayRows,row,1)?null:'Already the bottom track.'));}
 if(has(operations,TRACK_MENU_ROUTES.mute)){items.push(null);add('mute',muted===true?'Unmute':'Mute','',busy||noLane||(muted===null?'Open the Mixer for this track to mute it.':null));add('solo',solo===true?'Unsolo':'Solo','',busy||noLane||(solo===null?'Open the Mixer for this track to solo it.':null));}
 while(items.length&&items.at(-1)===null)items.pop();return items;
}

const body=payload=>payload?.structuredContent?.response??payload?.structuredContent??payload?.response??payload;
/** The documented liveEngine part of a deleteLane / restoreLane receipt (or null). */
export function liveEngineReceipt(receipt){const live=receipt?.liveEngine;if(!live||typeof live!=='object'||typeof live.applied!=='boolean')return null;return{applied:live.applied,...typeof live.chainRestored==='boolean'?{chainRestored:live.chainRestored}:{},...Array.isArray(live.attachedClipIds)?{attachedClipIds:[...live.attachedClipIds]}:{},...typeof live.reason==='string'?{reason:live.reason}:{},...typeof live.alreadyUnloaded==='boolean'?{alreadyUnloaded:live.alreadyUnloaded}:{}};}
const fail=(message,fields={})=>Object.assign(new Error(message),fields);
/** {patternId, channelId} pairs, as one sorted key list (contents.sources use sourceId). */
const channelKeys=list=>array(list).map(item=>`${item?.patternId}/${item?.channelId??item?.sourceId}`).sort();
export const samePatternChannels=(a,b)=>JSON.stringify(channelKeys(a))===JSON.stringify(channelKeys(b));
/** Guarded lane writes with read-back confirmation. `read()` returns the
 * fresh saved project, `call(name,args,options)` sends one typed write. A
 * guard that refuses before sending is dispatched:false; a write whose result
 * cannot be confirmed is operationUncertain and is never repeated. */
export class PlaylistTrackActions{
 constructor({read,call,projectId,key=()=>globalThis.crypto?.randomUUID?.()||`track-${Date.now()}-${Math.random().toString(36).slice(2)}`}){Object.assign(this,{read,call,projectId,key});}
 headers(raw){const tag=raw?._studioApi?.etag||(raw?.timelineRevision!=null?JSON.stringify(raw.timelineRevision):null);if(typeof tag!=='string'||!tag)throw fail('Reload the project revision before changing tracks.',{dispatched:false});return{ifMatch:tag,idempotencyKey:this.key()};}
 /** Delete one lane. `expect` (Redo) is the state the first Delete removed. */
 async deleteLane(laneId,{expect=null}={}){
  const raw=await this.read(),contents=laneContents(raw,laneId),blocked=deleteBlockReason(contents);if(blocked)throw fail(blocked,{dispatched:false});
  if(expect&&(!sameLaneSettings(contents.lane,expect.lane)||JSON.stringify([...contents.clipIds].sort())!==JSON.stringify([...expect.clipIds].sort())||!samePatternChannels(contents.sources,expect.patternChannels)))throw fail('That track changed after Undo. Redo will not delete newer data.',{dispatched:false});
  const lane=structuredClone(contents.lane),receipt=body(await this.call('delete_lane',{project_id:this.projectId(),lane_id:laneId},this.headers(raw)));
  const deleted=receipt?.deletedClipIds;if(receipt?.laneId!==undefined&&receipt.laneId!==laneId)throw fail('The delete acknowledgement identifies another track.',{operationUncertain:true});
  if(!Array.isArray(deleted)||JSON.stringify([...deleted].sort())!==JSON.stringify([...contents.clipIds].sort()))throw fail('Freestyle did not confirm exactly this track’s clips as deleted. Inspect the project; nothing will be repeated.',{operationUncertain:true});
  // Issue #15: the same request removed the pattern channels that played this lane; the receipt names them.
  const channels=array(receipt?.deletedPatternChannels).map(item=>({patternId:item?.patternId,channelId:item?.channelId}));
  if((contents.sources.length||channels.length)&&!samePatternChannels(channels,contents.sources))throw fail('Freestyle did not confirm exactly the Channel rack channels that played this track as deleted. Inspect the project; nothing will be repeated.',{operationUncertain:true});
  const after=await this.read();if(array(after?.lanes).some(item=>item?.id===laneId))throw fail('Freestyle has not confirmed the track removal.',{operationUncertain:true});
  if(laneContents(after,laneId).sources.length)throw fail('Freestyle still lists Channel rack channels for the deleted track.',{operationUncertain:true});
  // 339: the running session drops the lane at once (liveEngine.applied); a
  // saved-only delete (no live session) is still the confirmed edit.
  return{laneId,lane,clipIds:[...deleted],patternChannels:channels,liveEngine:liveEngineReceipt(receipt)};
 }
 /** Undo of deleteLane: the same lane (same id and settings) with its clips. */
 async restoreLane(state){
  const raw=await this.read();if(array(raw?.lanes).some(item=>item?.id===state.laneId))throw fail('That track already exists again. Undo will not overwrite it.',{dispatched:false});
  const receipt=body(await this.call('restore_lane',{project_id:this.projectId(),lane_id:state.laneId,clip_ids:[...state.clipIds]},this.headers(raw)));if(receipt?.laneId!==undefined&&receipt.laneId!==state.laneId)throw fail('The restore acknowledgement identifies another track.',{operationUncertain:true});
  const after=await this.read(),contents=laneContents(after,state.laneId);
  if(!contents.lane||!sameLaneSettings(contents.lane,state.lane)||!state.clipIds.every(id=>contents.clipIds.includes(id)))throw fail('Freestyle has not confirmed the restored track with its settings and clips.',{operationUncertain:true});
  // Issue #15: the restore puts the deleted pattern channels back (restoredPatternChannels) at their rack positions.
  const wanted=array(state.patternChannels);
  if(wanted.length&&(!samePatternChannels(receipt?.restoredPatternChannels,wanted)||!samePatternChannels(contents.sources,wanted)))throw fail('Freestyle restored the track but has not confirmed its Channel rack channels.',{operationUncertain:true});
  // 339: restoreLane re-attaches the clips and reloads the effects chain in the
  // running session (liveEngine.chainRestored). The saved restore above is the
  // confirmed edit; a live chain that did not reload is reported, not hidden.
  const liveEngine=liveEngineReceipt(receipt),chain=array(state.lane?.pluginChain).length>0;
  const liveChainRestored=liveEngine?.applied===true?(chain?liveEngine.chainRestored===true:true):null;
  return{laneId:state.laneId,clipIds:[...state.clipIds],patternChannels:[...wanted],liveEngine,liveChainRestored};
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
