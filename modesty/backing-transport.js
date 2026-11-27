/** Studio API transport wrapper: the backing track as an Audacity audio track.
 *
 * Wraps `studioTransport` (freestyle-host-transport.js). Reads of getProject /
 * listLanes / listClips gain the "Backing" lane + clip (backing-lane.js), so
 * the track list shows the beat with its waveform. Mute / solo / gain / pan
 * already address lane_id "backing" through the typed mixer operations the API
 * documents. Writes the API cannot do for the backing (rename, delete, move,
 * trim, split, clip mute, sample edits, pattern placements) are refused with
 * one clear message; bulk lane lists (reorder, range edits) drop "backing".
 */
import {rememberBackingPlacement,backingPlacement,BACKING_LANE_ID,BACKING_NOT_EDITABLE,hostBackingOf,augmentProjectBody,augmentLanePage,augmentClipPage,backingWriteBlock,stripBackingLanes,createBackingStore} from './backing-lane.js';

const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const headerOf=(headers,name)=>{for(const [key,value]of Object.entries(headers||{}))if(key.toLowerCase()===name)return value;return null;};
const PROJECT_PATH=/^\/api\/v1\/projects\/([^/?#:]+)/,LANE_PATH=/\/lanes\/([^/?#:]+)/,CLIP_PATH=/\/clips\/([^/?#:]+)/;
function describe(request){
 let url;try{url=new URL(String(request?.url||''),'https://studio.invalid');}catch{return null;}
 const project=PROJECT_PATH.exec(url.pathname);if(!project)return null;
 const decode=value=>{try{return decodeURIComponent(value);}catch{return value;}};
 const path={project_id:decode(project[1])},lane=LANE_PATH.exec(url.pathname),clip=CLIP_PATH.exec(url.pathname);
 if(lane)path.lane_id=decode(lane[1]);if(clip)path.clip_id=decode(clip[1]);
 return {operationId:request.operationId,method:String(request.method||'GET').toUpperCase(),path,query:Object.fromEntries(url.searchParams)};
}

/** raw(request,{signal}) -> StudioApiResponse; respond(status,data) builds one; fetchProject(id) -> {status,data,etag}. */
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

export function createBackingTransport({raw,respond,fetchProject,host}){
 const store=createBackingStore({fetchProject});
 const hostBacking=projectId=>hostBackingOf(host(),projectId);
 return async function backingTransport(request,options={}){
  const info=describe(request);
  if(!info)return raw(request,options);
  const {operationId,method,path,query}=info,projectId=path.project_id;
  if(method!=='GET'&&method!=='HEAD'){
   const block=backingWriteBlock({operationId,path,body:request.body});
   if(block)return respond(409,{error:{code:'backing_not_editable',message:block}});
   let next=request;
   const stripped=stripBackingLanes(operationId,request.body);
   if(stripped!==request.body){
    if(operationId==='editTimeRange'&&!stripped.lane_ids.length)return respond(409,{error:{code:'backing_not_editable',message:BACKING_NOT_EDITABLE}});
    next={...request,body:stripped};
   }
   try{return await raw(next,options);}finally{store.invalidate(projectId);}
  }
  // The synthetic backing lane/clip is not a Studio API track: never scope an
  // engine read to it, and it has no automation of its own.
  // The backing clip's waveform is read unscoped (a track_id scope 404/409s).
  if(path.clip_id===BACKING_LANE_ID&&/waveform/i.test(String(operationId||'')+String(request.url||''))&&query.track_id!==undefined){
   try{const url=new URL(String(request.url),'https://studio.invalid');url.searchParams.delete('track_id');const rel=String(request.url).startsWith('http')?url.href:url.pathname+url.search;request={...request,url:rel};}catch{}
  }
  if(query.scope_track_id===BACKING_LANE_ID){
   try{const url=new URL(String(request.url),'https://studio.invalid');url.searchParams.delete('scope_track_id');const rel=String(request.url).startsWith('http')?url.href:url.pathname+url.search;request={...request,url:rel};}catch{}
  }
  if(/\/automation(?:$|[/?])/.test(String(request.url||'').split('?')[0]+'?')&&(String(query.clip_id||'').startsWith(BACKING_LANE_ID)||path.clip_id?.startsWith?.(BACKING_LANE_ID)||query.lane_id===BACKING_LANE_ID||path.lane_id===BACKING_LANE_ID)){
   // The backend's synthesized default for a clip with no gain automation.
   const isClip=String(query.clip_id||path.clip_id||'').startsWith(BACKING_LANE_ID);
   return respond(200,{data:isClip?[{id:null,projectId,clipId:String(query.clip_id||path.clip_id||`${BACKING_LANE_ID}:${BACKING_LANE_ID}`),targetKey:'clip_gain',targetKind:'clip_gain',target:{kind:'clip_gain'},valueType:'continuous',defaultValue:1,points:[],revision:0,persisted:false}]:[],pagination:{limit:Number(query.limit)||50,hasMore:false,nextCursor:null}});
  }
  const response=await raw(request,options);
  if(response.status!==200||!record(response.data))return response;
  if(path.clip_id===BACKING_LANE_ID&&/waveform/i.test(String(operationId||'')+String(request.url||''))){clampWaveformTile(response.data);rememberBackingPlacement(projectId,response.data?.clip);}
  if(operationId==='getProject'){
   if(response.data?.backing&&!backingPlacement(projectId)){try{const wf=await raw({operationId:'getClipWaveform',method:'GET',url:`/api/v1/projects/${encodeURIComponent(projectId)}/clips/${BACKING_LANE_ID}/waveform?buckets=8`},options);if(wf?.status===200)rememberBackingPlacement(projectId,wf.data?.clip);}catch{}}
   store.observe(projectId,response.data,headerOf(response.headers,'etag'));
   augmentProjectBody(response.data,hostBacking(projectId));
  }else if(operationId==='listLanes'||operationId==='listClips'){
   const entry=await store.get(projectId);
   if(entry?.backing&&!backingPlacement(projectId)){
    try{const wf=await raw({operationId:'getClipWaveform',method:'GET',url:`/api/v1/projects/${encodeURIComponent(projectId)}/clips/${BACKING_LANE_ID}/waveform?buckets=8`},options);if(wf?.status===200)rememberBackingPlacement(projectId,wf.data?.clip);}catch{}
   }
   if(entry?.backing){
    const context={backing:entry.backing,hostBacking:hostBacking(projectId),query};
    if(operationId==='listLanes')augmentLanePage(response.data,context);
    else augmentClipPage(response.data,{...context,project:entry.project});
   }
  }
  return response;
 };
}
