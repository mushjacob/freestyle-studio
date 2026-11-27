/** Studio API transport wrapper: the backing track as a Playlist/Mixer lane.
 *
 * Wraps `studioTransportCall` (freestyle-host-transport.js). Reads of
 * getProject / listLanes / listClips gain the "Backing" lane + clip
 * (backing-lane.js). A lane PATCH (updateLane) addressed to the backing is the
 * mixer's saved write (volume / pan / muted / soloed); the backend has no lane
 * row for it, so it is translated to the typed mixer operations the API
 * documents for lane_id "backing" (setLaneGain / setLanePan / setLaneMute /
 * setLaneSolo) and answered in updateLane's shape. Writes the API cannot do for
 * the backing are refused with one clear message.
 */
import {rememberBackingPlacement,backingPlacement,BACKING_LANE_ID,BACKING_NOT_EDITABLE,hostBackingOf,augmentProjectBody,augmentLanePage,augmentClipPage,backingLaneCard,backingWriteBlock,stripBackingLanes,createBackingStore} from './backing-lane.js';

const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const etagOf=headers=>{for(const [key,value]of Object.entries(headers||{}))if(key.toLowerCase()==='etag')return value;return null;};
const refuse=(status,code,message)=>({status,headers:{},data:{error:{code,message,stage:'validation'}},idempotencyKey:null});
const MIX_TAG=/^(?:W\/)?"?mix-\d+"?$/;

// Hot masters peak a hair past full scale; the views' tile validators accept
// signed PCM in [-1,1] only, so the backing tile is clamped (display only).
function clampWaveformTile(data){
 const chans=Array.isArray(data?.channels)?data.channels:null;if(!chans)return data;
 for(const ch of chans){
  const n=Math.min(ch?.min?.length||0,ch?.max?.length||0);
  for(const key of ['min','max','rms'])if(Array.isArray(ch?.[key]))ch[key]=ch[key].map(v=>Math.max(key==='rms'?0:-1,Math.min(1,Number(v)||0)));
  for(let i=0;i<n;i++)if(ch.min[i]>ch.max[i]){const t=ch.min[i];ch.min[i]=ch.max[i];ch.max[i]=t;}
 }
 return data;
}

export function createBackingTransport({raw,methodOf,host}){
 const store=createBackingStore({fetchProject:async projectId=>{const result=await raw({operationId:'getProject',path:{project_id:projectId}});return {status:result.status,data:result.data,etag:etagOf(result.headers)};}});
 const hostBacking=projectId=>hostBackingOf(host(),projectId);
 async function updateBackingLane(payload,options){
  const projectId=payload.path.project_id,body=record(payload.body)?payload.body:{},calls=[];
  if('muted' in body)calls.push({operationId:'setLaneMute',field:'muted',body:{muted:body.muted}});
  if('soloed' in body)calls.push({operationId:'setLaneSolo',field:'soloed',body:{soloed:body.soloed}});
  if('volume' in body)calls.push({operationId:'setLaneGain',field:'volume',body:{gain:body.volume}});
  if('pan' in body)calls.push({operationId:'setLanePan',field:'pan',body:{pan:body.pan}});
  if(!calls.length)return refuse(400,'invalid_argument','Send volume, pan, muted or soloed for the backing track.');
  const tag=typeof payload.ifMatch==='string'&&MIX_TAG.test(payload.ifMatch)?payload.ifMatch:null,expected=body.expected_mix_revision;
  let last=null;
  for(const [index,call]of calls.entries()){
   // The mix precondition guards the first write; the rest of one PATCH follow it.
   const guarded=index===0,request={operationId:call.operationId,path:{project_id:projectId,lane_id:BACKING_LANE_ID},body:{...call.body,...guarded&&expected!=null?{expected_mix_revision:expected}:{}},...guarded&&tag&&expected==null?{ifMatch:tag}:{}};
   try{last=await raw(request,options);}finally{store.invalidate(projectId);}
   if(last.status>=400)return last;
  }
  const fresh=await store.get(projectId,{force:true}),backing=fresh?.backing;
  if(!backing)return refuse(502,'backing_read_failed','The backing track was changed but its saved state could not be read back.');
  const lane=backingLaneCard(backing,{lanes:fresh.lanes||[],hostBacking:hostBacking(projectId)});
  // The typed writes are the acknowledgement; solo is live-only for the beat.
  if('muted' in body)lane.muted=!!body.muted;
  if('soloed' in body)lane.solo=!!body.soloed;
  if('volume' in body)lane.volume=body.volume;
  if('pan' in body)lane.pan=body.pan;
  const data={ok:true,projectId,laneId:BACKING_LANE_ID,changed:calls.map(call=>call.field),lane,timelineRevision:fresh.etag??null};
  const revision=last?.data?.mixRevision;if(Number.isInteger(revision))data.mixRevision=revision;
  if(tag||expected!=null)data.liveMix={applied:true};
  return {status:200,headers:fresh.etag?{ETag:fresh.etag}:{},data,idempotencyKey:last?.idempotencyKey??null};
 }
 return async function backingTransport(payload,options={}){
  const operationId=payload?.operationId,path=payload?.path,projectId=path?.project_id;
  if(typeof operationId!=='string'||typeof projectId!=='string'||!projectId)return raw(payload,options);
  const method=methodOf(operationId)||'GET';
  if(method!=='GET'&&method!=='HEAD'){
   const block=backingWriteBlock({operationId,path,body:payload.body});
   if(block)return refuse(409,'backing_not_editable',block);
   let next=payload;
   const stripped=stripBackingLanes(operationId,payload.body);
   if(stripped!==payload.body){
    if(operationId==='editTimeRange'&&!stripped.lane_ids.length)return refuse(409,'backing_not_editable',BACKING_NOT_EDITABLE);
    next={...payload,body:stripped};
   }
   if(operationId==='updateLane'&&path.lane_id===BACKING_LANE_ID)return updateBackingLane(next,options);
   try{return await raw(next,options);}finally{store.invalidate(projectId);}
  }
  // The synthetic backing lane/clip is not a Studio API track: never scope an
  // engine read to it, and it has no automation of its own.
  const query=payload.query||{};
  // The backing clip's waveform is read unscoped (a track_id scope 404/409s).
  if(path.clip_id===BACKING_LANE_ID&&/waveform/i.test(operationId)&&payload.query?.track_id!==undefined){const {track_id,...rest}=payload.query;payload={...payload,query:rest};}
  if(query.scope_track_id===BACKING_LANE_ID){const {scope_track_id,...rest}=payload.query||{};payload={...payload,query:rest};}
  if(/automation/i.test(operationId)&&(String(query.clip_id||path.clip_id||'').startsWith(BACKING_LANE_ID)||query.lane_id===BACKING_LANE_ID||path.lane_id===BACKING_LANE_ID)){
   // The backend's synthesized default for a clip with no gain automation.
   const isClip=String(query.clip_id||path.clip_id||'').startsWith(BACKING_LANE_ID);
   return {status:200,headers:{},data:{data:isClip?[{id:null,projectId,clipId:String(query.clip_id||path.clip_id||`${BACKING_LANE_ID}:${BACKING_LANE_ID}`),targetKey:'clip_gain',targetKind:'clip_gain',target:{kind:'clip_gain'},valueType:'continuous',defaultValue:1,points:[],revision:0,persisted:false}]:[],pagination:{limit:Number(query.limit)||50,hasMore:false,nextCursor:null}}};
  }
  const result=await raw(payload,options);
  if(result.status!==200||!record(result.data))return result;
  if(path.clip_id===BACKING_LANE_ID&&/waveform/i.test(operationId)){clampWaveformTile(result.data);rememberBackingPlacement(projectId,result.data?.clip);}
  if(operationId==='getProject'){
   if(result.data?.backing&&!backingPlacement(projectId)){try{const wf=await raw({operationId:'getClipWaveform',path:{project_id:projectId,clip_id:BACKING_LANE_ID},query:{buckets:8}},options);if(wf?.status===200)rememberBackingPlacement(projectId,wf.data?.clip);}catch{}}
   store.observe(projectId,result.data,etagOf(result.headers));
   augmentProjectBody(result.data,hostBacking(projectId));
  }else if(operationId==='listLanes'||operationId==='listClips'){
   const entry=await store.get(projectId);
   if(entry?.backing&&!backingPlacement(projectId)){
    try{const wf=await raw({operationId:'getClipWaveform',path:{project_id:projectId,clip_id:BACKING_LANE_ID},query:{buckets:8}},options);if(wf?.status===200)rememberBackingPlacement(projectId,wf.data?.clip);}catch{}
   }
   if(entry?.backing){
    const context={backing:entry.backing,hostBacking:hostBacking(projectId),query:payload.query||{}};
    if(operationId==='listLanes')augmentLanePage(result.data,context);
    else augmentClipPage(result.data,{...context,project:entry.project});
   }
  }
  return result;
 };
}
