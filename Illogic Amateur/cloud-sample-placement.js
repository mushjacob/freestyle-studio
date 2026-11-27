/** Stored pattern sample -> Playlist audio clip (placePatternSampleOnTimeline).
 * The clip references the SAME stored audio; no bytes move. One retained
 * Idempotency-Key and a fresh timeline If-Match per logical placement. A clip
 * is durable even when live attach fails, so a failure is never re-placed.
 */
import {StudioApiClient,STUDIO_API_OPERATIONS} from './studio-api-client.js';
import {assertCompleteCanonicalData} from './cloud-session.js';
export const LIBRARY_SOUND_MIME='application/vegetable-library-sound';
const clone=value=>value==null?value:structuredClone(value),record=value=>!!value&&typeof value==='object'&&!Array.isArray(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const id=(value,max=128)=>typeof value==='string'&&value.length>0&&value.length<=max&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const fail=(message,code='sample_placement_invalid')=>Object.assign(new Error(message),{code});
const fields=STUDIO_API_OPERATIONS.placePatternSampleOnTimeline?.requestBody?.content?.['application/json']?.schema?.properties||{};
const MAX_START=fields.startMs?.maximum??86400000;
/** Parse a Browser/Rack drag payload. It is presentation data only: callers
 * must still resolve it to a canonical project sample before placing. */
export function parseLibrarySoundDrag(raw){
 if(typeof raw!=='string'||!raw||raw.length>16384)throw fail('Drag a sound returned by the Freestyle Browser or Channel Rack.');
 let item;try{item=JSON.parse(raw);}catch{throw fail('The dragged sound is unreadable.');}
 if(!record(item)||!id(item.id,512))throw fail('Drag a sound returned by the Freestyle Browser or Channel Rack.');return item;
}
/** Exact published body; laneId omitted requests a new audio lane. */
export function samplePlacementBody({startMs,laneId,name,rackChannelId}={}){
 if(!Number.isSafeInteger(startMs)||startMs<0||startMs>MAX_START)throw fail('Choose a Playlist position between 0 and 24 hours (whole milliseconds).');
 const body={startMs};
 if(laneId!=null){if(!id(laneId,fields.laneId?.maxLength??64))throw fail('Drop onto one saved audio lane, or empty Playlist space for a new lane.');body.laneId=laneId;}
 if(name!=null){if(typeof name!=='string')throw fail('The clip name must be text.');const bounded=Array.from(name.trim()).slice(0,fields.name?.maxLength??255).join('');if(bounded)body.name=bounded;}
 if(rackChannelId!=null){if(!id(rackChannelId,fields.rackChannelId?.maxLength??255))throw fail('The Rack channel identity is invalid.');body.rackChannelId=rackChannelId;}
 return body;
}
/** Validate a 201 placement receipt against the exact request. */
export function samplePlacementReceipt(result,{projectId,audioFileId,body}){
 const data=result?.data;
 if(result?.status!==201||!record(data))throw fail('Freestyle did not confirm the Playlist sample placement.','sample_placement_unconfirmed');
 assertCompleteCanonicalData(data,'sample placement receipt');
 const bad=message=>fail(message,'sample_placement_unconfirmed');
 if(data.projectId!==projectId)throw bad('The placement belongs to another project.');
 if(data.audioFileId!==audioFileId)throw bad('The placed clip references a different stored sample.');
 if(!id(data.clipId)||!record(data.clip)||data.clip.id!==data.clipId||data.trackId!==undefined&&data.trackId!==data.clipId)throw bad('The placement returned no consistent durable clip identity.');
 if(!id(data.laneId)||!record(data.lane)||data.lane.id!==data.laneId||data.clip.laneId!==undefined&&data.clip.laneId!==data.laneId)throw bad('The placement returned no consistent lane identity.');
 if(data.lane.kind!=null&&!['audio','vocal'].includes(data.lane.kind))throw bad('The sample was placed on a non-audio lane.');
 if(typeof data.createdLane!=='boolean'||(body.laneId!==undefined?data.createdLane!==false||data.laneId!==body.laneId:data.createdLane!==true))throw bad('The placement lane does not match the requested target.');
 if(data.startMs!==body.startMs||data.clip.startMs!==undefined&&data.clip.startMs!==body.startMs)throw bad('The placed clip did not confirm its exact start time.');
 if(typeof data.engine_attached!=='boolean'||typeof data.engine_reload_required!=='boolean')throw bad('The placement has no explicit live attach state.');
 if(data.timelineRevision!==null&&typeof data.timelineRevision!=='string')throw bad('The placement returned an invalid timeline revision.');
 const undo=data.undo;if(!record(undo)||undo.op!=='remove'||undo.clipId!==data.clipId||undo.laneId!==data.laneId||undo.createdLane!==data.createdLane)throw bad('The placement has no exact server-authored remove inverse.');
 const reloadRequired=data.engine_reload_required===true||data.engine_attached!==true;
 return{clipId:data.clipId,laneId:data.laneId,createdLane:data.createdLane,startMs:data.startMs,clip:clone(data.clip),lane:clone(data.lane),timelineRevision:data.timelineRevision,etag:result.etag??null,engineAttached:data.engine_attached,engineReloadRequired:reloadRequired,status:reloadRequired?'saved_reload_required':'placed',undo:clone(undo),receipt:clone(data)};
}
export class CloudSamplePlacement{
 constructor({client=new StudioApiClient(),getScope,idFactory=()=>globalThis.crypto.randomUUID()}={}){
  if(!client||typeof client.call!=='function'||typeof getScope!=='function'||typeof idFactory!=='function')throw new TypeError('Sample placement needs a typed client, scope and key factory.');
  Object.assign(this,{client,getScope,idFactory});this.records=[];this.active=null;
 }
 get busy(){return !!this.active;}
 key(){const key=this.idFactory();if(typeof key!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(key)||this.records.some(entry=>entry.idempotencyKey===key))throw fail('A fresh retained placement key is required.');return key;}
 place({audioFileId,startMs,laneId,name,rackChannelId}={},{ifMatch,guard=()=>{}}={}){
  let scope,body,identity;
  try{
   scope=clone(this.getScope());if(!id(scope?.projectId)||scope.projectId==='empty')throw fail('Open a saved Freestyle project before placing a sample.');
   if(!id(audioFileId))throw fail('Resolve a canonical project sample before placing it.');
   if(typeof ifMatch!=='string'||!ifMatch||/[\r\n]/.test(ifMatch))throw fail('Read the current timeline revision before placing a sample.','sample_placement_revision_required');
   body=samplePlacementBody({startMs,laneId,name,rackChannelId});identity={scope,audioFileId,body};guard();
  }catch(error){return Promise.reject(error);}
  if(this.active)return Promise.reject(fail('Wait for the current Playlist sample placement.','sample_placement_busy'));
  const prior=this.records.findLast(entry=>same(entry.identity,identity));
  if(prior&&['sending','uncertain'].includes(prior.status))return Promise.reject(fail('This sample placement is unconfirmed. Inspect the Playlist before placing it again.','sample_placement_uncertain'));
  const entry={identity:clone(identity),idempotencyKey:this.key(),ifMatch,status:'preparing',attempted:false,acknowledged:false,result:null,error:null,errorStatus:null,errorCode:null};
  this.records.push(entry);if(this.records.length>32)this.records.shift();this.active=entry;
  const check=()=>{guard();if(!same(scope,this.getScope()))throw fail('The project changed. Any placed clip remains in its original project.','sample_placement_scope_changed');};
  entry.promise=(async()=>{
   try{
    check();entry.status='sending';entry.attempted=true;
    const result=await this.client.call('placePatternSampleOnTimeline',{path:{project_id:scope.projectId,audio_file_id:audioFileId},body},{idempotencyKey:entry.idempotencyKey,ifMatch});
    entry.acknowledged=true;const receipt=samplePlacementReceipt(result,{projectId:scope.projectId,audioFileId,body});
    entry.result=clone(receipt);entry.status=receipt.status;check();return{...receipt,record:this.describe(entry)};
   }catch(error){
    const status=error?.status,explicit=entry.attempted&&!entry.acknowledged&&Number.isInteger(status)&&status>=400&&status<500&&status!==408&&error.operationUncertain!==true;
    entry.error=String(error?.message||error).slice(0,500);entry.errorStatus=status??null;entry.errorCode=error?.code??null;
    // A validated receipt followed by a scope change keeps its durable result.
    entry.status=!entry.attempted?'not_sent':entry.result?entry.result.status:explicit?(status===412?'conflict':'rejected'):'uncertain';
    if(status===412&&explicit)error.message='The Playlist changed before the sample was placed. Nothing was placed; read the project and drop it again.';
    throw Object.assign(error,{samplePlacement:this.describe(entry),explicitRejection:explicit,operationAttempted:entry.attempted,operationCommitted:!!entry.result,operationUncertain:entry.status==='uncertain'});
   }finally{if(this.active===entry)this.active=null;}
  })();
  return entry.promise;
 }
 describe(entry){return clone({identity:entry.identity,idempotencyKey:entry.idempotencyKey,status:entry.status,attempted:entry.attempted,acknowledged:entry.acknowledged,clipId:entry.result?.clipId??null,laneId:entry.result?.laneId??null,createdLane:entry.result?.createdLane??null,engineReloadRequired:entry.result?.engineReloadRequired??null,error:entry.error,errorStatus:entry.errorStatus,errorCode:entry.errorCode});}
 snapshot(){return this.records.map(entry=>this.describe(entry));}
}
/** Rack channel -> drag payload. Only a saved sample source with a canonical
 * audioFileId in the current project can be placed. */
export function rackSampleDragPayload(channel,projectId){
 const source=channel?.cloudSource;
 if(!record(channel)||channel.type!=='sample'||!id(channel.audioFileId)||!record(source)||source.kind!=='sample'||source.audioFileId!==channel.audioFileId||!id(projectId))return null;
 return{id:`rack:${channel.id}`,name:String(channel.name||source.name||'Sample').slice(0,255),_libraryView:'rack-channel',projectId,audioFileId:channel.audioFileId,...(id(source.rackId,255)?{rackChannelId:source.rackId}:{}),channelId:String(channel.id)};
}
/** FL: a Playlist sample drop goes onto the hovered track. Returns the saved
 * lane under `track` that can host the placed audio clip, or null when only a
 * new lane can (no lane on that row, or a pattern / instrument / backing lane,
 * which the published contract rejects as lane_not_audio). An untyped
 * (kind null) lane with no pattern placements is an empty track: place on it.
 * `strict` restricts to typed audio/vocal lanes (OS file import contract). */
export function playlistDropLane({track,timelineLaneIds=[],lanes=[],placements=[]}={},{strict=false}={}){
 if(!Number.isInteger(track)||track<0||!Array.isArray(timelineLaneIds))return null;
 const laneId=timelineLaneIds[track];if(!id(laneId))return null;
 const matches=(Array.isArray(lanes)?lanes:[]).filter(lane=>record(lane)&&lane.id===laneId);if(matches.length!==1)return null;
 const lane=matches[0];if(['audio','vocal'].includes(lane.kind))return lane;
 if(strict||lane.kind!=null&&lane.kind!=='')return null;
 return (Array.isArray(placements)?placements:[]).some(placement=>(placement?.laneId??placement?.lane_id)===laneId)?null:lane;
}
