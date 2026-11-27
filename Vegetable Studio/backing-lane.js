/** The project's backing track (the beat) as a first-class "Backing" lane + clip.
 *
 * Studio API v1 has no backing lane row and no backing clip: the beat lives on
 * the project card (`getProject().backing`: title, durationSec, muted, gain,
 * pan) and is addressed by the lane / clip id "backing" in the mixer, waveform
 * and automation operations. The Default studio draws it as a "Backing" row
 * with one pill from 0 to durationSec. These views build their timelines from
 * `lanes` + `clips`, so the transport layer adds exactly that row and clip to
 * the three canonical reads (getProject, listLanes, listClips). Everything
 * downstream (Playlist/track rows, mixer insert, mute/solo/gain/pan,
 * waveform via getClipWaveform clip_id "backing") then treats it like any
 * other audio lane. Writes the API cannot do for the backing (rename, delete,
 * move/trim/split/mute the clip, sample edits, pattern placements) are refused
 * here with one clear message instead of failing in the backend.
 *
 * The same module ships (identically) in Vegetable Studio and Modesty.
 */
export const BACKING_LANE_ID='backing';
export const BACKING_NOT_EDITABLE='The backing track is the project beat. Its level, pan, mute, solo and waveform work here; renaming, moving, trimming, splitting or deleting it is only possible from the Default studio.';
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.length>0?value:null;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const MIX_FIELDS=['volume','pan','muted','soloed'];

/** Default studio's backing snapshot for this project (asClips, displayOrder). */
export function hostBackingOf(host,projectId){
 try{
  const project=host?.getProject?.(),open=String(host?.getProjectId?.()||project?.id||'');
  if(record(project)&&record(project.backing)&&open===String(projectId))return project.backing;
 }catch{}
 return null;
}
/** The backing card of a getProject body, or null. */
export function backingOf(project){const backing=project?.backing;return record(backing)&&text(backing.id)?backing:null;}
// The engine's exact placement of the beat (its waveform \`clip\` card), per
// project: the views validate a clip against it, and the project card only
// carries a rounded duration.
const placements=new Map();
export function rememberBackingPlacement(projectId,clip){
 if(!text(projectId)||!record(clip))return;
 const duration=Number(clip.duration_sec),start=Number(clip.start_ms),offset=Number(clip.audio_offset_sec);
 if(!(duration>0))return;
 placements.set(projectId,{durationSec:duration,startMs:Number.isFinite(start)&&start>=0?start:0,audioOffsetSec:Number.isFinite(offset)&&offset>=0?offset:0});
}
export function backingPlacement(projectId){return placements.get(projectId)||null;}
function durationOf(backing,hostBacking,projectId){
 const exact=projectId?placements.get(projectId):null;if(exact)return exact.durationSec;
 for(const value of [backing?.durationSec,hostBacking?.durationSec])if(finite(value)&&value>0)return value;
 return null;
}
/** A backing split into clips (/backing/split) is real lanes + clips already. */
export function backingEligible(backing,hostBacking=null){return !!backing&&hostBacking?.asClips!==true;}
const hasBackingRow=(rows,laneKey)=>rows.some(row=>record(row)&&(row.id===BACKING_LANE_ID||row.kind==='backing'||row.isBacking===true||row[laneKey]===BACKING_LANE_ID));

/** One lane card exactly like getProject/listLanes rows. */
export function backingLaneCard(backing,{lanes=[],hostBacking=null}={}){
 const orders=lanes.map(lane=>Number(lane?.order)).filter(Number.isFinite).sort((a,b)=>a-b);
 // Owner 2026-11-12: a project's backing track is always the FIRST lane.
 let order=orders.length?orders[0]-1:0;
 const label=backing.type==='file'?'File Upload #1':'Backing';
 return {id:BACKING_LANE_ID,name:label,kind:'audio',trackType:'audio',muted:!!backing.muted,solo:false,volume:finite(backing.gain)&&backing.gain>=0?backing.gain:1,identityVersion:2,mixExplicit:true,pan:finite(backing.pan)?backing.pan:0,busId:'master',order,pluginChain:[]};
}
/** One clip card: the whole beat from 0 to durationSec, like Default's pill. */
export function backingClipCard(backing,{project=null,hostBacking=null}={}){
 const exact=project?.id?placements.get(project.id):null;
 const duration=durationOf(backing,hostBacking,project?.id);if(duration===null)return null;
 const name=String(backing.title||hostBacking?.title||hostBacking?.videoTitle||project?.title||'Backing').replace(/\s+/g,' ').trim().slice(0,160)||'Backing';
 return {id:BACKING_LANE_ID,laneId:BACKING_LANE_ID,name,startMs:exact?.startMs??0,durationSec:duration,audioOffsetSec:exact?.audioOffsetSec??0,muted:!!backing.muted,clipMuted:false,volume:1,isBacking:true,isImported:true,updatedAt:project?.updatedAt??null,editUrl:project?.studioUrl||project?.projectUrl||''};
}
/** getProject body: add the row + clip and keep counts exact. */
export function augmentProjectBody(body,hostBacking=null){
 const backing=backingOf(body);if(!backing||!backingEligible(backing,hostBacking)||!Array.isArray(body.lanes))return body;
 const clips=Array.isArray(body.clips)?body.clips:null,duration=durationOf(backing,hostBacking);
 if(duration===null||hasBackingRow(body.lanes,'id')||clips&&hasBackingRow(clips,'laneId'))return body;
 const truncated=body.truncated?.lanes===true||body.truncated?.clips===true;if(truncated)return body;
 const lane=backingLaneCard(backing,{lanes:body.lanes,hostBacking}),clip=backingClipCard(backing,{project:body,hostBacking});
 body.lanes=[lane,...body.lanes];
 if(clips&&clip)body.clips=[...clips,clip];
 if(record(body.counts)){if(Number.isSafeInteger(body.counts.lanes))body.counts.lanes+=1;if(clip&&Number.isSafeInteger(body.counts.clips))body.counts.clips+=1;}
 return body;
}
const lastPage=page=>record(page)&&Array.isArray(page.data)&&record(page.pagination)&&page.pagination.hasMore===false;
/** listLanes page (the last page only, unfiltered or kind=audio). */
export function augmentLanePage(page,{backing,hostBacking=null,query={},projectLanes=null}={}){
 if(!lastPage(page)||!backing||!backingEligible(backing,hostBacking)||durationOf(backing,hostBacking)===null)return page;
 if(query.kind!=null&&query.kind!=='audio'||page.pagination.nextCursor!=null)return page;
 if(hasBackingRow(page.data,'id'))return page;
 page.data=[backingLaneCard(backing,{lanes:projectLanes||page.data,hostBacking}),...page.data];
 return page;
}
/** listClips page (the last page only; a lane filter must name the backing). */
export function augmentClipPage(page,{backing,hostBacking=null,query={},project=null,lanesHaveBacking=true}={}){
 if(!lastPage(page)||!backing||!backingEligible(backing,hostBacking)||page.pagination.nextCursor!=null)return page;
 if(query.lane_id!=null&&query.lane_id!==BACKING_LANE_ID)return page;
 if(hasBackingRow(page.data,'laneId')||!lanesHaveBacking)return page;
 const clip=backingClipCard(backing,{project,hostBacking});if(!clip)return page;
 page.data=[...page.data,clip];return page;
}

function scanBacking(value,keys,depth=0){
 if(depth>6||value==null)return false;
 if(Array.isArray(value))return value.some(item=>scanBacking(item,keys,depth+1));
 if(!record(value))return false;
 return Object.entries(value).some(([key,item])=>keys.includes(key)&&item===BACKING_LANE_ID||keys.includes(key)&&Array.isArray(item)&&item.includes(BACKING_LANE_ID)||typeof item==='object'&&scanBacking(item,keys,depth+1));
}
const CLIP_BLOCKED=new Set(['moveClipToLane','setClipMuted','setClipFades','editClipSamples','undoClipSampleEdit']);
const LANE_BLOCKED=new Set(['deleteLane','restoreLane','duplicateLane']);
/** A write the API cannot do for the backing: the refusal message, else null. */
export function backingWriteBlock({operationId,path={},body=null}){
 const lane=path.lane_id===BACKING_LANE_ID,clip=path.clip_id===BACKING_LANE_ID;
 if(LANE_BLOCKED.has(operationId)&&lane||CLIP_BLOCKED.has(operationId)&&clip)return BACKING_NOT_EDITABLE;
 if(operationId==='updateLane'&&lane&&record(body)&&Object.keys(body).some(key=>!MIX_FIELDS.includes(key)&&key!=='expected_mix_revision'))return BACKING_NOT_EDITABLE;
 if(operationId==='applyClipBatch'&&record(body)&&Array.isArray(body.ops)&&body.ops.some(op=>record(op)&&(op.id===BACKING_LANE_ID||op.source_id===BACKING_LANE_ID)))return BACKING_NOT_EDITABLE;
 if(['createPatternPlacement','updatePatternPlacement','applyPatternPlacementBatch','placePatternSampleOnTimeline','assignPatternChannelToNewTrack'].includes(operationId)&&scanBacking(body,['lane_id','laneId','track_id']))return BACKING_NOT_EDITABLE;
 return null;
}
/** Bulk lane lists (reorder, range edit) are the real lanes only: drop "backing" from them. */
export function stripBackingLanes(operationId,body){
 if(!record(body))return body;
 if(['reorderLanes','editTimeRange'].includes(operationId)){
  const key='lane_ids';
  if(Array.isArray(body[key])&&body[key].includes(BACKING_LANE_ID))return {...body,[key]:body[key].filter(id=>id!==BACKING_LANE_ID)};
 }
 return body;
}

/** Per-project backing cache so list reads that do not carry the project card can still add the row. */
export function createBackingStore({fetchProject,ttlMs=2500,now=()=>Date.now()}={}){
 const entries=new Map(),pending=new Map();
 const remember=(projectId,body,etag)=>{const backing=backingOf(body),lanes=Array.isArray(body?.lanes)?body.lanes.filter(lane=>lane?.id!==BACKING_LANE_ID).map(lane=>({order:lane?.order})):[];entries.set(projectId,{backing,lanes,project:{id:body?.id,title:body?.title,updatedAt:body?.updatedAt,studioUrl:body?.studioUrl,projectUrl:body?.projectUrl},etag:etag??null,at:now()});};
 return {
  observe(projectId,body,etag=null){if(text(projectId)&&record(body)&&'backing' in body)remember(projectId,body,etag);},
  invalidate(projectId){entries.delete(projectId);},
  async get(projectId,{force=false}={}){
   const hit=entries.get(projectId);if(!force&&hit&&now()-hit.at<ttlMs)return hit;
   if(pending.has(projectId))return pending.get(projectId);
   const promise=(async()=>{try{const result=await fetchProject(projectId);if(result?.status===200&&record(result.data)){remember(projectId,result.data,result.etag);return entries.get(projectId);}}catch{}return hit&&{...hit,stale:true}||null;})().finally(()=>pending.delete(projectId));
   pending.set(projectId,promise);return promise;
  },
 };
}
export {MIX_FIELDS as BACKING_MIX_FIELDS};
