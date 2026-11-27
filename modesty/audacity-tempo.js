import {isIdempotencyInProgress} from './cloud-errors.js';
/** Whole-clip tempo rendering through Freestyle. No browser audio processing. */
const sharedReceipts=new Map();
const clone=value=>structuredClone(value);
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const projectId=project=>project?.cloud?.projectId||project?.id;
const clipId=clip=>clip?.cloudId||clip?.id;
const keyFor=(project,clip)=>`${project}\u0000${clip}`;
const activePhases=new Set(['starting','submitting','pending','running','uncertain','reverting','refreshing']);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** Tooltip for the project Tempo field from getProject's bpmSource: the tempo is always the one Freestyle plays
 *  (bpm is never null); `default` means nobody set it yet (120), `backing` that it follows the backing track. */
export function projectTempoHint(bpmSource,bpm){
 const value=finite(bpm)?`${Math.round(Number(bpm)*100)/100} BPM`:'Project tempo';
 if(bpmSource==='default')return `${value} — Freestyle's default; no tempo has been set for this project yet`;
 if(bpmSource==='backing')return `${value} — follows the backing track`;
 if(bpmSource==='set')return `${value} — set for this project`;
 return 'Project tempo';
}

function unpack(result){
 let data=result?.structuredContent;
 if(data===undefined&&Array.isArray(result?.content)){
  try{data=JSON.parse(result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'));}catch{throw new Error('Freestyle returned an unreadable tempo-render receipt.');}
 }
 data=data??result;const response=data?.response??data,failedJob=response?.status==='failed';
 if(result?.isError||!failedJob&&(data?.ok===false||data?.error||response?.ok===false||response?.error)){const detail=response?.error??data?.error??response?.message??data?.message;const error=new Error(typeof detail==='string'?detail:detail?.message||'Freestyle rejected the tempo operation.');error.cloudRejected=true;error.result=clone(result);throw error;}
 return response;
}
function definiteRejection(error){if(isIdempotencyInProgress(error))return false;if(error?.cloudRejected)return true;if(error?.result!==undefined){try{if(unpack(error.result)?.status==='failed')return true;}catch(decoded){if(decoded.cloudRejected)return true;}}return [400,401,403,422].includes(Number(error?.status));}

function errorText(error,fallback='The cloud tempo render failed.'){return typeof error==='string'?error:error?.message||fallback;}
function verifyTrack(track,receipt){
 if(!track||typeof track!=='object')throw new Error('Freestyle has not returned the rendered clip identity. Completion is unverified.');
 const id=track.id??track.clipId??track.clip_id??track.trackId??track.track_id;
 if(String(id??'')!==receipt.trackId)throw new Error('Freestyle returned a rendered clip for a different target.');
 const project=track.projectId??track.project_id;if(project!==undefined&&String(project)!==receipt.projectId)throw new Error('Freestyle returned a rendered clip from a different project.');
 return track;
}

/**
 * apply()/revert() submit at most once and retain their captured receipt.
 * resume() only polls an existing job. Closing the dialog stops observation;
 * it does not cancel a renderer. Shared receipts survive dialog reconstruction.
 */
export class AudacityTempoController {
 constructor({getProject,getClip,getSelection,getSelectedTracks=()=>[],flush=async()=>{},cloudCall,refresh=async()=>{},onChange=()=>{},pollIntervalMs=2000,maxPolls=60,wait=sleep,receiptStore=sharedReceipts}={}){
  if(typeof getProject!=='function'||typeof getClip!=='function'||typeof getSelection!=='function'||typeof cloudCall!=='function')throw new TypeError('Tempo controls require project, clip, selection, and cloud callbacks.');
  Object.assign(this,{getProject,getClip,getSelection,getSelectedTracks,flush,cloudCall,refresh,onChange,wait,receiptStore});this.pollIntervalMs=Math.max(0,Number(pollIntervalMs)||0);this.maxPolls=Math.max(1,Math.floor(Number(maxPolls)||60));this.record=null;this.listener=()=>{try{this.onChange(this.state(this.record));}catch{}};
 }
 bind(record){if(this.record===record)return;this.record?.listeners.delete(this.listener);this.record=record;record?.listeners.add(this.listener);}
 notify(record){for(const listener of record.listeners)listener();}
 state(record){
  if(!record)return {phase:'idle',status:null,receipt:null,jobId:null,result:null,error:'',observing:false,canResume:false,canRevert:false};
  const sameProject=projectId(this.getProject())===record.receipt.projectId;
  const canResume=sameProject&&!!record.jobId&&['pending','running','uncertain'].includes(record.phase);
  const canRevert=sameProject&&record.successfulApply&&record.phase==='succeeded'&&record.receipt.operation==='apply';
  return {phase:record.phase,status:record.status,receipt:clone(record.receipt),jobId:record.jobId,result:record.result?clone(record.result):null,error:record.error||'',observing:record.observing,canResume,canRevert};
 }
 snapshot(target){
  const project=target?.projectId??projectId(this.getProject()),clip=target?.clipId??clipId(this.getClip()),record=project&&clip?this.receiptStore.get(keyFor(project,clip)):null;
  this.bind(record||null);return this.state(record);
 }
 capture({sourceBpm,targetBpm}={}){
  const project=this.getProject(),clip=this.getClip(),id=projectId(project),take=clipId(clip),selection=this.getSelection();
  if(typeof id!=='string'||!id)throw new Error('Open a known Freestyle project first.');
  if(!clip||clip.patternId||String(take??'').startsWith('pattern:'))throw new Error('Select one audio clip; pattern placements cannot use this audio renderer.');
  if(typeof take!=='string'||!take||take.length>64)throw new Error('The audio clip has no valid persisted take identity.');
  if(!finite(project.bpm)||Number(project.bpm)<=0||!finite(clip.start)||!finite(clip.length)||Number(clip.start)<0||Number(clip.length)<=0)throw new Error('The cloud clip timing is unavailable.');
  if(!finite(selection?.start)||!finite(selection?.end)||selection.start<0||selection.end<selection.start)throw new Error('Choose an ordered time selection.');
  const tracks=[...(this.getSelectedTracks()||[])];if(tracks.length>1)throw new Error('Tempo rendering supports one whole audio clip, not multiple tracks.');
  if(tracks.length===1&&clip.track!==undefined&&String(tracks[0])!==String(clip.track)&&String(tracks[0])!==String(clip.laneId))throw new Error('The highlighted track does not contain the selected audio clip.');
  const startSec=Number(clip.start)*60/Number(project.bpm),endSec=(Number(clip.start)+Number(clip.length))*60/Number(project.bpm);
  if(selection.end>selection.start&&(Math.abs(selection.start-startSec)>1e-6||Math.abs(selection.end-endSec)>1e-6))throw new Error('The cloud tempo renderer processes a whole audio clip. Partial-range tempo edits are unavailable.');
  for(const value of [sourceBpm,targetBpm])if(!finite(value)||Number(value)<20||Number(value)>400)throw new RangeError('Source and target tempos must be between 20 and 400 BPM.');
  return {projectId:id,clipId:take,trackId:take,clipName:String(clip.name||clip.cloudRaw?.name||'Audio clip'),sourceBpm:Number(sourceBpm),targetBpm:Number(targetBpm),startSec,endSec,operation:'apply',creationAttempted:false};
 }
 assertTarget(receipt,{requireSelected=false}={}){
  const project=this.getProject();if(projectId(project)!==receipt.projectId)throw new Error('Return to the captured cloud project before continuing this tempo operation.');
  if(requireSelected){const selected=this.getClip();if(String(clipId(selected)??'')!==receipt.trackId)throw new Error('The selected audio clip changed while pending edits were saved. Close and reopen Change Tempo.');if(finite(project.bpm)&&finite(selected.start)&&finite(selected.length)){const start=Number(selected.start)*60/Number(project.bpm),end=(Number(selected.start)+Number(selected.length))*60/Number(project.bpm);if(Math.abs(start-receipt.startSec)>1e-6||Math.abs(end-receipt.endSec)>1e-6)throw new Error('The audio clip timing changed while pending edits were saved. Close and reopen Change Tempo.');}}
  const clips=Array.isArray(project.audioClips)?project.audioClips:Array.isArray(project.cloud?.rawProject?.clips)?project.cloud.rawProject.clips:null;
  if(clips?!clips.some(clip=>String(clipId(clip))===receipt.trackId):String(clipId(this.getClip())??'')!==receipt.trackId)throw new Error('The captured audio clip is no longer available in this cloud project.');
 }
 makeRecord(receipt,previous){return {receipt:clone(receipt),phase:receipt.operation==='revert'?'reverting':'submitting',status:null,jobId:null,result:null,error:'',observing:false,successfulApply:previous?.successfulApply||false,submission:null,observation:null,observationGeneration:0,listeners:new Set()};}
 apply(parameters){
  const receipt=this.capture(parameters),key=keyFor(receipt.projectId,receipt.trackId),old=this.receiptStore.get(key);
  if(old&&activePhases.has(old.phase)){
   this.bind(old);
   if(old.receipt.operation!=='apply'||old.receipt.sourceBpm!==receipt.sourceBpm||old.receipt.targetBpm!==receipt.targetBpm)throw new Error('A tempo operation already exists for this clip. Observe its receipt before starting another.');
   if(old.phase==='uncertain'&&!old.jobId)throw new Error(old.error||'The previous submission is unverified and has no job identity. Inspect the cloud clip before another render.');
   return old.submission||Promise.resolve(this.state(old));
  }
  if(old?.phase==='succeeded'&&old.receipt.operation==='apply'&&old.receipt.sourceBpm===receipt.sourceBpm&&old.receipt.targetBpm===receipt.targetBpm){this.bind(old);return Promise.resolve(this.state(old));}
  const record=this.makeRecord(receipt);this.receiptStore.set(key,record);this.bind(record);this.notify(record);
  return this.submit(record,'apply_track_tempo',{project_id:receipt.projectId,track_id:receipt.trackId,source_bpm:receipt.sourceBpm,target_bpm:receipt.targetBpm});
 }
 start(parameters){return this.apply(parameters);}
 submit(record,name,args){
  const operation=Promise.resolve().then(async()=>{
   let called=false;
   try{
    await this.flush();this.assertTarget(record.receipt,{requireSelected:record.receipt.operation==='apply'});record.receipt.creationAttempted=true;called=true;this.notify(record);
    const response=unpack(await this.cloudCall(name,args));await this.accept(record,response,{submission:true});return this.state(record);
   }catch(error){
    if(record.phase!=='failed'&&!['succeeded','reverted'].includes(record.phase)){record.phase=called&&!definiteRejection(error)?'uncertain':'failed';record.error=errorText(error);this.notify(record);}
    throw error;
   }finally{record.submission=null;}
  });record.submission=operation;return operation;
 }
 async accept(record,response,{submission=false}={}){
  if(!response||typeof response!=='object')throw new Error('Freestyle returned no usable tempo-render receipt.');
  const receipt=record.receipt,returnedProject=response.projectId??response.project_id,returnedTrack=response.trackId??response.track_id;
  if(returnedProject!==undefined&&String(returnedProject)!==receipt.projectId)throw new Error('Freestyle returned a tempo job from a different project.');
  if(returnedTrack!==undefined&&String(returnedTrack)!==receipt.trackId)throw new Error('Freestyle returned a tempo job for a different clip.');
  const job=response.jobId??response.job_id;
  if(job!==undefined){if(typeof job!=='string'||!job.trim()||job.length>64)throw new Error('Freestyle returned an invalid tempo job identity.');if(record.jobId&&record.jobId!==job)throw new Error('Freestyle returned a different tempo job identity.');record.jobId=job;}
  const status=response.status,retryAfter=response.retryAfterSec??response.retry_after_sec;if(finite(retryAfter)&&Number(retryAfter)>0)record.retryAfterMs=Math.max(1000,Math.min(10000,Number(retryAfter)*1000));
  if(status==='failed'){record.status='failed';record.phase='failed';record.error=errorText(response.error);this.notify(record);throw new Error(record.error);}
  const result=response.result&&typeof response.result==='object'?response.result:submission&&response.track?response:null;
  if(status==='succeeded'||(submission&&status===undefined&&response.track)){
   verifyTrack(result?.track,receipt);
   if(receipt.operation==='revert'&&result?.reverted===false)throw new Error('Freestyle returned the clip without confirming its tempo restore.');
   record.status='succeeded';record.result=clone(result);record.successfulApply=receipt.operation==='apply'&&!result.reverted;record.phase='refreshing';record.error='';this.notify(record);
   try{if(projectId(this.getProject())===receipt.projectId)await this.refresh(clone(receipt),clone(result));}
   catch(error){record.error=`The cloud tempo operation completed, but refreshing the project failed: ${errorText(error)}`;}
   record.phase=receipt.operation==='revert'||result.reverted?'reverted':'succeeded';this.notify(record);return;
  }
  if((status==='pending'||status==='running')&&record.jobId){record.status=status;record.phase=status;record.error='';this.notify(record);return;}
  record.phase='uncertain';record.error=record.jobId?'The tempo job identity is known, but its completion state is unverified. Check its status.':'The tempo submission returned neither a verified clip nor a job identity. Do not submit it again blindly.';this.notify(record);throw new Error(record.error);
 }
 resume(record=this.record){
  if(!record)return Promise.resolve(this.state(null));
  if(record.submission)return record.submission.then(()=>this.resume(record));
  if(record.observation)return record.observation;
  if(['succeeded','reverted','failed'].includes(record.phase))return Promise.resolve(this.state(record));
  if(!record.jobId)return Promise.reject(new Error(record.error||'There is no cloud job identity to observe.'));
  try{this.assertTarget(record.receipt);}catch(error){return Promise.reject(error);}
  const generation=++record.observationGeneration;record.observing=true;record.error='';this.notify(record);
  const observe=Promise.resolve().then(async()=>{
   try{
    for(let polls=0;generation===record.observationGeneration&&polls<this.maxPolls;polls++){
     this.assertTarget(record.receipt);
     const data=unpack(await this.cloudCall('get_tempo_job_status',{project_id:record.receipt.projectId,track_id:record.receipt.trackId,job_id:record.jobId}));
     if(generation!==record.observationGeneration)break;
     await this.accept(record,data);
     if(['succeeded','reverted','failed'].includes(record.phase))break;
     if(polls+1<this.maxPolls)await this.wait(record.retryAfterMs??this.pollIntervalMs);else{record.error=`The cloud render is still processing after ${this.maxPolls} status checks. Resume observation to check the same job.`;this.notify(record);}
    }
    return {...this.state(record),observing:generation===record.observationGeneration?false:record.observing};
   }catch(error){if(generation===record.observationGeneration){record.error=errorText(error);this.notify(record);throw error;}return this.state(record);}
   finally{if(generation===record.observationGeneration){record.observing=false;record.observation=null;this.notify(record);}}
  });record.observation=observe;return observe;
 }
 stopObservation(){const record=this.record;if(!record)return;record.observationGeneration++;record.observing=false;record.observation=null;this.notify(record);}
 revert(){
  const record=this.record;if(!record||!this.state(record).canRevert)throw new Error('A verified completed tempo render for this captured clip is required before restoring its original audio.');
  this.assertTarget(record.receipt);const receipt={...clone(record.receipt),operation:'revert',creationAttempted:false},next=this.makeRecord(receipt,record),key=keyFor(receipt.projectId,receipt.trackId);
  this.receiptStore.set(key,next);this.bind(next);this.notify(next);
  return this.submit(next,'revert_track_tempo',{project_id:receipt.projectId,track_id:receipt.trackId});
 }
 dispose(){this.stopObservation();this.bind(null);}
}
