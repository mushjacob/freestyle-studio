/** Bounded saved Playlist moves. A group of pattern clips only is ONE atomic
 * applyPatternPlacementBatch (338); a group with audio clips stays a client
 * journal sequence (audio moves have their own routes). Every member is
 * confirmed against one complete read either way. */
import {serializeCloudPattern} from './cloud-session.js';
import {capturePlacementHistory,placementHistorySide,placementHistoryEqual,placementHistoryArguments,placementProtectedProject,placementReceiptId} from './cloud-placement-history.js';
import {audioHistoryFingerprint} from './cloud-audio-history.js';
import {withoutObservedModelState} from './cloud-history-observed.js';
import {audioMoveSide,audioMoveEqual,audioMoveInverse,audioMoveArguments,audioMoveTimelineTag,projectAudioMoveHistory} from './cloud-audio-move-history.js';
import {updatePlacementOp} from './cloud-placement-batch.js';
const clone=structuredClone,object=v=>!!v&&typeof v==='object'&&!Array.isArray(v),omit=(v,keys)=>Object.fromEntries(Object.entries(v||{}).filter(([k])=>!keys.includes(k)));
const stable=v=>Array.isArray(v)?v.map(stable):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export const playlistMoveEqual=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const same=playlistMoveEqual,integer=v=>Number.isSafeInteger(v)&&v>=0,fail=message=>Object.assign(new Error(message),{code:'playlist_move_unconfirmed'});
const uid=()=>globalThis.crypto?.randomUUID?.()||`playlist-move-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function authored(project){return{...omit(withoutObservedModelState(project),['clips','audioClips','patterns','selectedPattern','cloud','loop']),patterns:project.patterns.map(p=>({id:p.id,cloudId:p.cloudId,raw:p.cloudRaw,score:serializeCloudPattern(p,project)}))};}
export function playlistMoveProtected(project,members=[]){
 const value=placementProtectedProject(project,members.filter(m=>m.kind==='placement').map(m=>m.id)),ids=members.filter(m=>m.kind==='audio').map(m=>m.id);
 value.clips=value.clips.filter(row=>!ids.includes(row.id));if(value.counts)value.counts.clips=value.clips.length;return value;
}
export function playlistMoveSide(project,member){return member.kind==='placement'?placementHistorySide(project,member.id):audioMoveSide(project,member.id);}
export const playlistMoveSideEqual=(member,a,b)=>member.kind==='placement'?placementHistoryEqual(a,b):audioMoveEqual(a,b);
/** Return only pure multi-clip position/lane edits. Invalid members of a pure
 * move throw before dispatch; unrelated edit families retain their own paths. */
export function capturePlaylistMove(before,next){
 if(before.cloud?.rawState?.studioApi!==true||!same(authored(before),authored(next))||before.cloud?.projectId!==next.cloud?.projectId||before.cloud?.trackId!==next.cloud?.trackId||!same(before.cloud?.timelineLaneIds,next.cloud?.timelineLaneIds))return null;
 const pairs=[];for(const key of ['clips','audioClips']){const a=before[key]||[],b=next[key]||[];if(!same(a.map(c=>c.id),b.map(c=>c.id)))return null;for(let i=0;i<a.length;i++){const old=key==='audioClips'?audioHistoryFingerprint(a[i]):a[i],value=key==='audioClips'?audioHistoryFingerprint(b[i]):b[i];if(same(old,value))continue;if(!same(omit(old,['start','track','laneId']),omit(value,['start','track','laneId'])))return null;pairs.push({key,old:a[i],value:b[i]});}}
 if(pairs.length<2)return null;if(pairs.length>256)throw fail('Move at most 256 uniquely selected Playlist clips at once.');
 // Existing same-lane audio groups retain their dedicated timing batch path.
 if(pairs.every(p=>p.key==='audioClips'&&p.old.track===p.value.track&&p.old.laneId===p.value.laneId))return null;
 const members=pairs.map(({key,old,value})=>{
  if(key==='clips'){const isolated={...before,clips:before.clips.map(c=>c.id===old.id?value:c)},plan=capturePlacementHistory(before,isolated);if(plan?.operation!=='update'||plan.fields.some(field=>!['laneId','startMs'].includes(field)))throw fail('Read exact saved placement timing and destination lanes before moving this group.');return{kind:'placement',id:plan.placementId,before:plan.before,after:plan.wanted};}
  const side=audioMoveSide(before,old.cloudId),laneId=value.track!==old.track?next.cloud.timelineLaneIds?.[value.track]:value.laneId,startMs=value.start===old.start?side.geometry.start_ms:value.start*60000/before.bpm,lanes=before.cloud.rawProject?.lanes?.filter(l=>l.id===laneId)||[];
  if(!integer(startMs)||!integer(side.geometry.start_ms)||lanes.length!==1||!['audio','vocal'].includes(lanes[0].kind)||value.laneId!==old.laneId&&value.laneId!==laneId)throw fail('Every audio destination needs one saved audio/vocal lane and exact integer-millisecond timing.');
  return{kind:'audio',id:old.cloudId,before:side,after:{...clone(side),laneId,geometry:{...side.geometry,start_ms:startMs},canonical:{...side.canonical,laneId,startMs}}};
 });
 if(new Set(members.map(m=>m.kind+':'+m.id)).size!==members.length)throw fail('Read unique saved identities before moving the selected group.');
 return{kind:'playlist_move',projectId:before.cloud.projectId,members,checkpoint:playlistMoveProtected(before),protected:playlistMoveProtected(before,members)};
}
export function projectPlaylistMove(session,body,scope){const projected=projectAudioMoveHistory({project:session.project,session},body,scope);session.rawProject=projected.rawProject;session.rawState=projected.rawState;session.project=projected.project;return projected.project;}
export function confirmPlaylistMove(plan,project){
 if(!same(playlistMoveProtected(project,plan.members),plan.protected)||plan.members.some(m=>!playlistMoveSideEqual(m,playlistMoveSide(project,m),m.after)))throw fail('The complete saved project has not confirmed this exact Playlist move.');
 return plan.members.map(m=>({...clone(m),after:playlistMoveSide(project,m)}));
}
function moveRequest(m){
 const timing=m.kind==='audio'&&m.before.laneId===m.after.laneId,move=m.kind==='audio'?audioMoveArguments(m.inverse||{op:'move',clip_id:m.id,lane_id:m.after.laneId,start_ms:m.after.geometry.start_ms},m.before):null;
 if(move&&(move.lane_id!==m.after.laneId||move.start_ms!==m.after.geometry.start_ms)||timing&&m.inverse?.provenance==='canonical_before_timing'&&!same(m.inverse.geometry,m.after.geometry))throw fail('The retained inverse does not restore this selected move side.');
 // Preserve the source window without rewriting its duration/offset; expected
 // still guards all three canonical timing values on the server.
 return{timing,action:m.kind==='placement'?'update_pattern_placement':timing?'shift_clip':'move_clip_to_lane',operationId:m.kind==='placement'?'updatePatternPlacement':timing?'applyClipBatch':'moveClipToLane',args:m.kind==='placement'?placementHistoryArguments('update',m.after,m.before):timing?{track_id:m.before.laneId,clip_id:m.id,start_ms:move.start_ms,expected:clone(m.before.geometry)}:move};
}
export async function executePlaylistMove({session,plan,scope,read,assert,record,onChange=()=>{}}){
 record.status='reading';record.steps=[];record.completedCount=0;record.acknowledgedCount=0;record.attempted=false;record.error=null;record.engineReloadRequired=false;
 try{
  await session.queue;assert();let project=await read();assert();
  if(!same(playlistMoveProtected(project),plan.checkpoint))throw fail('The canonical project changed before the selected Playlist move.');
  for(const m of plan.members)if(!playlistMoveSideEqual(m,playlistMoveSide(project,m),m.before))throw fail('A selected clip changed before the Playlist move.');
  const prepared=plan.members.map(moveRequest),nextTag=revision=>{try{return revision===undefined?null:audioMoveTimelineTag({timelineRevision:revision});}catch{return null;}};
  // One fresh read above, then each guarded write uses the revision its
  // predecessor returned; one complete read below confirms the whole group.
  // A response without a usable revision costs one extra read, never a guess.
  let tag=audioMoveTimelineTag(session.rawProject);
  // FL: a selection of pattern clips moves at once. One batch, one revision,
  // all or nothing; only a proven-missing route falls back to member writes.
  if(plan.members.length>=2&&plan.members.every(m=>m.kind==='placement')&&session.supportsPlacementBatch?.()===true){
   const ops=plan.members.map((m,index)=>updatePlacementOp(m.id,prepared[index].args.placement)),request={action:'apply_pattern_placement_batch',ops:clone(ops),ifMatch:tag,idempotencyKey:uid()};
   record.batched=true;record.batchRequest=clone(request);record.steps=plan.members.map(m=>({kind:m.kind,id:m.id,status:'sending',batch:true,request:{action:'update_pattern_placement',arguments:clone(prepared[plan.members.indexOf(m)].args)},receipt:null}));record.status='sending';record.attempted=true;onChange();
   let receipt=null;
   try{receipt=await session.applyPlacementBatch(ops,{expectedContext:scope,ifMatch:tag,idempotencyKey:request.idempotencyKey});}
   catch(error){if(error?.placementBatchUnavailable!==true)throw error;record.batched=false;record.attempted=false;record.steps=[];delete record.batchRequest;}
   if(receipt){assert();record.batchReceipt=receipt;record.batchOps=ops;for(const step of record.steps){step.status='acknowledged';step.receipt={ok:true,placementId:step.id,timelineRevision:receipt.timelineRevision};}record.acknowledgedCount=plan.members.length;onChange();}
  }
  if(!record.batched)for(const [index,m]of plan.members.entries()){
   assert();if(!tag){record.status='reading';onChange();project=await read();assert();tag=audioMoveTimelineTag(session.rawProject);}
   const{timing,action,operationId,args}=prepared[index],events=[],capture=e=>{if(e.detail?.name===action)events.push(clone(e.detail));};let returned;
   const step={kind:m.kind,id:m.id,status:'sending',request:{action,arguments:clone(args),ifMatch:tag,idempotencyKey:uid()},receipt:null};record.steps.push(step);record.status='sending';record.attempted=true;onChange();session.addEventListener('action',capture);
   try{step.receipt=clone(await session.action(action,args,{refresh:false,expectedContext:scope,ifMatch:step.request.ifMatch,idempotencyKey:step.request.idempotencyKey,onTimelineRevision:revision=>{returned=revision;}}));step.status='acknowledged';}finally{session.removeEventListener('action',capture);}
   assert();if(events.length!==1||events[0].studioApi?.operationId!==operationId)throw fail('Each selected move needs its dedicated acknowledged operation.');
   if(m.kind==='placement')placementReceiptId(step.receipt,{projectId:scope.projectId,operationId,expectedId:m.id});
   if(timing&&(step.receipt?.applied!==true&&step.receipt?.ok!==true||step.receipt.applied===false||step.receipt.dry_run===true||step.receipt.ok===false||step.receipt.error||step.receipt.projectId!==undefined&&step.receipt.projectId!==scope.projectId||step.receipt.engine_reload_required!==undefined&&typeof step.receipt.engine_reload_required!=='boolean'))throw fail('The timing batch did not acknowledge this project’s applied horizontal move.');
   record.engineReloadRequired=record.engineReloadRequired||step.receipt.engine_reload_required===true;record.acknowledgedCount++;tag=nextTag(returned);onChange();
  }
  // QA round 19 follow-up: the batch receipt's cards are the saved rows; they replace the confirm read when they project.
  record.status='confirming';onChange();
  const projectedFromReceipt=record.batched&&record.batchReceipt&&typeof session.projectSavedWrites==='function'&&session.projectSavedWrites([{name:'apply_pattern_placement_batch',args:{ops:record.batchOps},result:record.batchReceipt}],record.batchReceipt.timelineRevision,scope,{requireReturnedRows:true});
  if(projectedFromReceipt){project=session.project;record.confirmedFromReceipt=true;}else project=await read();assert();
  for(const [index,m]of plan.members.entries()){
   const step=record.steps[index],actual=playlistMoveSide(project,m);
   if(!playlistMoveSideEqual(m,actual,m.after))throw fail('A selected clip changed or its acknowledged move did not confirm its exact source and destination.');
   if(m.kind==='audio'){step.inverse=step.request.action==='shift_clip'?{op:'move',clip_id:m.id,lane_id:m.before.laneId,start_ms:m.before.geometry.start_ms,geometry:clone(m.before.geometry),provenance:'canonical_before_timing'}:audioMoveInverse(step.receipt,m.before,actual,{projectId:scope.projectId,operationId:prepared[index].operationId});step.inverseProvenance=step.request.action==='shift_clip'?'confirmed_canonical_timing':'server_move_receipt';}
   // Members are certified in order, as the former per-member reads did.
   step.status='confirmed';record.completedCount++;
  }
  // Unrelated-data drift cannot be attributed to one member: certify none.
  if(!same(playlistMoveProtected(project,plan.members),plan.protected)){for(const step of record.steps)step.status='acknowledged';record.completedCount=0;throw fail('A selected move changed unrelated saved project data.');}
  onChange();
  record.members=confirmPlaylistMove(plan,project);record.status='confirmed';return project;
 }catch(error){
  // Classify acknowledged members with one best-effort saved read; nothing is resent.
  if(record.acknowledgedCount>record.completedCount&&record.status!=='confirming')try{const project=await read();record.completedCount=0;for(const [index,m]of plan.members.slice(0,record.acknowledgedCount).entries()){const step=record.steps[index];if(step?.status!=='acknowledged')break;if(!playlistMoveSideEqual(m,playlistMoveSide(project,m),m.after))break;step.status='confirmed';record.completedCount++;}}catch{}
  const step=record.steps.at(-1),rejected=!step?.receipt&&[400,403,404,409,412,422,428].includes(error.status)&&error.operationUncertain!==true;if(step&&step.status!=='confirmed'){step.status=rejected?'rejected':'unconfirmed';step.error=error.message;}record.status=!record.attempted?'not_sent':rejected&&record.acknowledgedCount===0?'rejected':'uncertain';record.partial=record.acknowledgedCount>0&&record.acknowledgedCount<plan.members.length;record.error=error.message;if(record.status==='uncertain')error.message='The selected Playlist move is unconfirmed and may be partially saved. Inspect its retained receipts before repeating it. '+error.message;throw Object.assign(error,{playlistMoveReceipt:clone(record),operationUncertain:record.status==='uncertain'});}
 finally{onChange();}
}
