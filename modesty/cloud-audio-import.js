import {isIdempotencyInProgress,definiteCloudRejection,retainInProgress,assertTerminalIdempotency,captureWriteRequest,replayKnownBusyWrite} from './cloud-errors.js';
/** Persist, hydrate and place real uploaded audio. No local decoding/playback. */
import {assertCompleteCanonicalData,normalizeCloudProject} from './cloud-session.js';
export const MAX_AUDIO_UPLOAD_BYTES=25*1024*1024;
const identity=value=>typeof value==='string'&&value.length>0;
const body=value=>{
 let data=value?.structuredContent??value;
 if(data===value&&Array.isArray(value?.content)){const text=value.content.filter(item=>item.type==='text').map(item=>item.text).join('\n');try{data=JSON.parse(text);}catch{throw new Error('Freestyle returned an unreadable audio import receipt.');}}
 data=data?.response??data;if(value?.isError||data?.ok===false||data?.error)throw new Error(typeof data?.error==='string'?data.error:data?.message||'Freestyle rejected the audio import.');return data;
};
const problem=(message,code,record,cause)=>Object.assign(new Error(message,{cause}),{code,importRecord:record});
export function validateAudioFile(file){
 if(!file||typeof file.arrayBuffer!=='function'||!identity(file.name)||!Number.isSafeInteger(file.size)||file.size<=0)throw new Error('Choose a nonempty audio file.');
 if(file.size>MAX_AUDIO_UPLOAD_BYTES)throw new Error('Freestyle audio uploads are limited to 25 MB per file.');
 if(!/^audio\//i.test(file.type||'')&&!/\.(wav|wave|mp3|flac|ogg|oga|opus|m4a|aac|aif|aiff|webm|mp4)$/i.test(file.name))throw new Error('Choose an audio file such as WAV, MP3, FLAC, AIFF, Ogg or M4A.');
 return file;
}
function scopeFor(engine){return {projectId:engine.projectId,trackId:engine.session.trackId,loadVersion:engine.loadVersion??0,contextVersion:engine.session.contextVersion??0};}
function assertScope(engine,scope,guard){
 if(!engine.ready||engine.loading||engine.session.closed||engine.projectId!==scope.projectId||engine.session.projectId!==scope.projectId||engine.session.trackId!==scope.trackId||(engine.loadVersion??0)!==scope.loadVersion||(engine.session.contextVersion??0)!==scope.contextVersion)throw Object.assign(new Error('The cloud project changed during audio import.'),{name:'AbortError',code:'import_scope_changed'});
 guard?.();
}
function canonicalClips(engine){const clips=engine.session.project?.audioClips??engine.project?.audioClips;if(!Array.isArray(clips))throw new Error('Freestyle has not supplied a complete canonical audio clip list.');assertCompleteCanonicalData(clips,'imported audio clip list');return clips;}
function canonicalClip(engine,id){const clips=canonicalClips(engine),matches=clips.filter(clip=>(clip.cloudId||clip.id)===id);return matches.length===1?matches[0]:null;}
function currentLane(engine,laneId){return (engine.session.project??engine.project)?.channels?.find(channel=>!channel.patternSource&&(channel.laneId||channel.cloudTrackId||channel.id)===laneId);}
function assertLane(engine,laneId){if(!laneId)return;const lane=currentLane(engine,laneId);if(!lane||['pattern','instrument','midi'].includes(lane.type))throw new Error('The destination audio lane is no longer available.');}
async function refresh(engine,scope,guard){assertScope(engine,scope,guard);await engine.refresh();assertScope(engine,scope,guard);}
async function action(engine,scope,name,args,guard,idempotencyKey=crypto.randomUUID()){assertScope(engine,scope,guard);const request={project_id:scope.projectId,track_id:scope.trackId,action:name,arguments:args,idempotency_key:idempotencyKey};try{return await engine.session.call('execute_pro_action',request);}catch(error){error.studioRequest={name:'execute_pro_action',arguments:structuredClone(request)};throw error;}}
async function importWrite(engine,record,scope,stage,name,args,guard){
 assertScope(engine,scope,guard);record.scope??=structuredClone(scope);const revision=engine.session.rawProject?.timelineRevision;if(['placement','create'].includes(stage)&&typeof revision==='string'&&revision)args={...args,if_match:revision};const request=captureWriteRequest(name,args);record.writeAttempts??=[];
 const attempt={stage,request,status:'sending'};record.writeAttempts.push(attempt);
 try{const raw=await engine.session.call(name,structuredClone(request.arguments));attempt.raw=structuredClone(raw);if(isIdempotencyInProgress(raw))throw Object.assign(new Error('The original import request is still running.'),{status:409,code:'idempotency_in_progress',result:raw});attempt.receipt=body(raw);attempt.status='acknowledged';return attempt.receipt;}
 catch(error){retainInProgress(record,error);retainInProgress(attempt,error);attempt.error=error.message;attempt.status=Number(error.status)===400&&(error.code??error.result?.code??error.result?.error)==='studio_request_invalid'&&(error.stage??error.result?.stage)==='studio_preflight'&&!isIdempotencyInProgress(error)?'rejected':'uncertain';if(attempt.status==='rejected')attempt.providerDispatched=false;throw error;}
}
async function recoverImportWrite(engine,record,guard){
 const attempt=record.writeAttempts?.findLast(item=>item.idempotencyInProgress);if(!record.idempotencyInProgress)return;
 const scope=record.scope;const {raw,receipt}=await replayKnownBusyWrite({knownBusy:attempt?.idempotencyInProgress===true,request:attempt?.request,call:(name,args)=>engine.session.call(name,args),assertCurrent:()=>{if(!scope)throw new Error('The original import scope is unavailable.');assertScope(engine,scope,guard);},parse:body});
 attempt.raw=structuredClone(raw);attempt.receipt=structuredClone(receipt);attempt.status='acknowledged';attempt.idempotencyInProgress=false;record.idempotencyInProgress=false;
 record.receipts[attempt.stage]=structuredClone(receipt);
 if(attempt.stage==='upload'){record.acknowledged=true;record.clipId=receiptClipIdentity(receipt,new Set(record.beforeClipIds));record.persisted=!!record.clipId;}
 return attempt;
}
async function base64(file){const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size||bytes.length>MAX_AUDIO_UPLOAD_BYTES)throw new Error('The selected audio file changed or exceeds 25 MB.');let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
function filename(name,max){if(name.length<=max)return name;const suffix=/\.[^.]+$/.exec(name)?.[0]||'';return name.slice(0,Math.max(0,max-suffix.length))+suffix;}
// Upload ACKs name persisted clips, independently of native session readiness.
// Only explicit clip fields establish an early identity; lane/runtime fields
// remain candidates only after comparison with a fresh canonical clip list.
function receiptClipIdentity(receipt,before){
 const values=[receipt?.clipId,receipt?.clip_id,receipt?.clip?.id,receipt?.take?.id].filter(value=>value!==undefined&&value!==null);
 if(values.some(value=>!identity(value)||value.length>64||/^[0-9]+$/.test(value)||/[\s\x00-\x1f\x7f]/.test(value)))throw new Error('The upload returned an invalid persisted clip identity. Its receipt is retained; do not upload again.');
 const ids=[...new Set(values)];if(ids.length>1||ids.length===1&&before.has(ids[0]))throw new Error('The upload returned a conflicting or pre-existing clip identity. Its receipt is retained; do not upload again.');
 return ids[0]??null;
}
async function readSavedAudio(engine,record,scope,guard){
 assertScope(engine,scope,guard);const response=body(await engine.session.call('get_project',{project_id:scope.projectId})),project=response.project??response;assertScope(engine,scope,guard);
 assertCompleteCanonicalData(project,'saved audio project');
 if(project.id!==scope.projectId||!Array.isArray(project.clips)||!Array.isArray(project.lanes))throw new Error('A complete canonical project is required to recover the saved audio.');
 const ids=project.clips.map(clip=>clip.id);if(ids.some(id=>!identity(id))||new Set(ids).size!==ids.length||project.counts?.clips!==undefined&&project.counts.clips!==ids.length)throw new Error('The saved project has incomplete or ambiguous audio identities.');
 const before=new Set(record.beforeClipIds||[]);receiptClipIdentity(record.receipts.upload,before);
 const resolved=uploadedIdentity(record.receipts.upload,project.clips,before);if(record.clipId&&record.clipId!==resolved)throw new Error('The fresh canonical audio does not match the retained upload identity.');
 const clip=project.clips.find(row=>row.id===resolved),lane=project.lanes.find(row=>row.id===clip?.laneId);
 if(!lane||['pattern','instrument','midi'].includes(lane.kind)||record.laneId&&clip.laneId!==record.laneId||!Number.isFinite(clip.startMs)||clip.startMs<0||!Number.isFinite(clip.durationSec)||clip.durationSec<=0||!Number.isFinite(clip.audioOffsetSec)||clip.audioOffsetSec<0)throw new Error('The saved clip has no verified audio lane or source geometry.');
 record.clipId=resolved;record.persisted=true;record.canonicalVerified=true;record.savedClip=structuredClone(clip);
 // This is canonical persistence only. Reusing prior native observations does
 // not invent attachment handles for the newly saved clip.
 const session=engine.session;session.rawProject=structuredClone(project);session.project=normalizeCloudProject(session.rawProject,session.rawState??{},{projectId:scope.projectId,trackId:scope.trackId});engine.accept(session.project);assertScope(engine,scope,guard);
 return clip;
}
function uploadedIdentity(receipt,clips,before){
 const candidates=[receipt?.clipId,receipt?.clip_id,receipt?.clip?.id,receipt?.take?.id,receipt?.trackId,receipt?.track?.id].filter(identity),newClips=clips.filter(clip=>!before.has(clip.cloudId||clip.id));
 const explicit=[...new Set(candidates)].filter(id=>newClips.some(clip=>(clip.cloudId||clip.id)===id));if(explicit.length===1)return explicit[0];
 if(explicit.length===0&&newClips.length===1&&!candidates.length)return newClips[0].cloudId||newClips[0].id;
 throw new Error('The upload succeeded, but its new clip identity is ambiguous. Inspect the cloud project before uploading again.');
}
function capabilitySchema(receipt){
 const root=body(receipt),candidates=[root,root?.action,root?.capability,...(Array.isArray(root?.actions)?root.actions:[]),...(Array.isArray(root?.capabilities)?root.capabilities:[])];
 const matching=candidates.filter(item=>item&&typeof item==='object'&&(!item.name||item.name==='attach_clip_to_session')&&(!item.action||typeof item.action!=='string'||item.action==='attach_clip_to_session')&&item.argumentSchema?.type==='object');
 if(matching.length!==1)throw new Error('Freestyle has not returned an unambiguous typed attach_clip_to_session schema.');return matching[0];
}
/** Only bind fields actually declared by the runtime typed schema. Unknown or
 * inferred required fields stop before attachment; no speculative RPC fields.
 */
export function audioAttachArguments(capability,{projectId,clip,laneId}){
 const discovered=capabilitySchema(capability),schema=discovered.argumentSchema,properties=schema.properties;
 // The live action's explicit description disambiguates its unfortunately
 // named db_track_id: it is the upload's persisted clipId, not a lane/runtime
 // track. Its schema marks the string type inferred; the mapping comes from
 // that published semantic description, not from guessing the field name.
 const documentedDbClip=properties?.db_track_id?.type==='string'&&/db_track_id\s*=\s*the\s+clipId/i.test(discovered.description||'')&&/upload_audio/.test(discovered.description||'');
 const key=documentedDbClip?'db_track_id':properties?.clip_id?.type==='string'&&!properties.clip_id['x-inferred']?'clip_id':null;
 if(!key)throw new Error('The live attach schema does not declare a typed persisted clip_id or document its db_track_id clip identity.');
 const values={[key]:clip.cloudId||clip.id},required=new Set([...(schema.required||[]),key]);
 for(const name of required){
  if(name===key)continue;const field=properties[name];if(!field||field['x-inferred'])throw new Error('The attach schema has an unknown or inferred required field: '+name);
  if(name==='project_id'&&field.type==='string')values[name]=projectId;
  else if(name==='lane_id'&&field.type==='string'&&identity(laneId||clip.laneId))values[name]=laneId||clip.laneId;
  else if(Object.hasOwn(field,'default')&&['string','number','integer','boolean'].includes(field.type)&&typeof field.default===(field.type==='integer'?'number':field.type))values[name]=field.default;
  else throw new Error('The typed attach schema requires an unmapped field: '+name);
 }
 return values;
}
const live=clip=>clip?.engineLoaded===true&&Number.isSafeInteger(clip.engineTrackId)&&clip.engineTrackId>=0&&Number.isSafeInteger(clip.engineClipId)&&clip.engineClipId>=0;
function startMilliseconds(clip,bpm){const raw=clip?.cloudRaw;if(typeof raw?.startMs==='number'&&Number.isFinite(raw.startMs))return raw.startMs;if(typeof clip?.start==='number'&&Number.isFinite(clip.start)&&Number.isFinite(bpm)&&bpm>0)return clip.start*60/bpm*1000;return null;}
async function finishSavedAudio(engine,record,scope,assertCurrent,{retryAttach=false,retryPlacement=false,savedClip,deferAttach=false}={}){
 let clip=canonicalClip(engine,record.clipId);if(!clip)throw new Error('The saved audio clip is no longer in this project.');if(record.laneId&&clip.laneId!==record.laneId)throw new Error('The saved clip is in a different lane from the import target.');
 if(!live(clip)&&!deferAttach&&record.engineAttached&&!record.attachObserved){record.attachObserved=true;await refresh(engine,scope,assertCurrent);clip=canonicalClip(engine,record.clipId);if(!clip)throw new Error('The saved audio clip is no longer in this project.');}// round 5: upload attaches with the project open; one fast read confirms it
 if(!live(clip)&&!deferAttach){
  if(!retryAttach)return false;
  record.phase='discovering-live-attach';const capability=await engine.session.call('list_pro_capabilities',{action:'attach_clip_to_session'});assertScope(engine,scope,assertCurrent);clip=canonicalClip(engine,record.clipId);if(!clip)throw new Error('The uploaded clip is no longer present.');
  const args=audioAttachArguments(capability,{projectId:scope.projectId,clip:savedClip??clip,laneId:record.laneId}),attempt={arguments:structuredClone(args)};(record.attachAttempts||=[]).push(attempt);record.phase='attaching';let rejected;
  try{attempt.receipt=await importWrite(engine,record,scope,'attach','execute_pro_action',{project_id:scope.projectId,track_id:scope.trackId,action:'attach_clip_to_session',arguments:args,idempotency_key:record.attachIdempotencyKey??=crypto.randomUUID()},assertCurrent);record.receipts.attach=body(attempt.receipt);}catch(error){attempt.error=error.message;attempt.status=error.status??error.statusCode??error.code;if(isIdempotencyInProgress(error)||Number(attempt.status)!==409){retainInProgress(record,error);throw error;}rejected=error;}
  // Even a 409 is not an already-loaded success until a NEW native read proves
  // this persisted clip is ready. No attachment is retried by this read.
  await refresh(engine,scope,assertCurrent);clip=canonicalClip(engine,record.clipId);
  if(!live(clip)){if(rejected)throw rejected;throw new Error('Audio is saved, but the live session has not confirmed the imported clip. Refresh its saved receipt before playback.');}
  if(rejected)record.receipts.attach={alreadyLoaded:true,status:409,nativeVerified:true};
 }
 const targetMs=Math.round(record.startSec*1000),bpm=engine.session.project?.bpm??engine.project?.bpm;
 if(Math.round(startMilliseconds(clip,bpm))!==targetMs){
  if(!retryPlacement)return false;
  record.phase='placing';const durationSec=savedClip?.durationSec??clip.length*60/bpm,audioOffsetSec=savedClip?.audioOffsetSec??clip.offset*60/bpm,startMs=startMilliseconds(clip,bpm);if(!Number.isFinite(durationSec)||durationSec<=0||!Number.isFinite(audioOffsetSec)||audioOffsetSec<0||!Number.isFinite(startMs))throw new Error('The imported source window is unavailable for guarded placement.');record.receipts.placementRaw=await importWrite(engine,record,scope,'placement','execute_pro_action',{project_id:scope.projectId,track_id:scope.trackId,action:'shift_clip',arguments:{clip_id:record.clipId,start_ms:targetMs,duration_sec:durationSec,audio_offset_sec:audioOffsetSec,expected:{start_ms:startMs,duration_sec:durationSec,audio_offset_sec:audioOffsetSec}},idempotency_key:record.placementIdempotencyKey??=crypto.randomUUID()},assertCurrent);record.receipts.placement=body(record.receipts.placementRaw);// Deferred attach: one canonical read shows the placed clip; native readback belongs to the background attach.
  if(deferAttach)await readSavedAudio(engine,record,scope,assertCurrent);else await refresh(engine,scope,assertCurrent);clip=canonicalClip(engine,record.clipId);
 }
 if((!deferAttach&&!live(clip))||record.laneId&&clip.laneId!==record.laneId||startMilliseconds(clip,bpm)===null||Math.round(startMilliseconds(clip,bpm))!==targetMs)throw new Error('Freestyle has not confirmed the imported clip at the requested live timeline position.');
 if(deferAttach&&!live(clip)){record.attachDeferred=true;record.clip=structuredClone(clip);return true;}
 record.liveVerified=true;record.clip=structuredClone(clip);return true;
}
/** Explicit recovery starts with canonical reads and never reuploads bytes.
 * Retrying live attachment/placement is opt-in for this call, not automatic.
 */
export async function reconcileCloudAudioImport(engine,record,{retryAttach=false,retryPlacement=false,assertCurrent}={}){
 if(!record||record.projectId!==engine.projectId||!engine.ready)throw new Error('Open the audio import’s original project before checking its saved clip.');if(engine.audioImportActive)throw new Error('Wait for the current audio import to finish.');
 const scope=scopeFor(engine);engine.audioImportActive=true;
 try{
  const recovered=await recoverImportWrite(engine,record,assertCurrent);assertTerminalIdempotency(record);await engine.flush();if(!record.acknowledged||!record.receipts.upload)throw new Error('The upload has no acknowledged clip identity. Inspect the canonical project before choosing which clip to recover.');
  const savedClip=await readSavedAudio(engine,record,scope,assertCurrent);
  if(recovered||record.liveVerified||!retryAttach)await refresh(engine,scope,assertCurrent);
  const verified=await finishSavedAudio(engine,record,scope,assertCurrent,{retryAttach,retryPlacement,savedClip});record.phase=verified?'complete':'saved-unverified';if(verified)delete record.error;return {...record.receipts.upload,clipId:record.clipId,importRecord:record};
 }catch(error){record.phase='saved-unverified';record.error=error.message;throw problem(error.message,'import_saved_unverified',record,error);}finally{engine.audioImportActive=false;}
}
export async function importCloudAudio(engine,file,{laneId,startSec=0,assertCurrent,deferAttach=false}={}){
 validateAudioFile(file);if(!Number.isFinite(startSec)||startSec<0)throw new Error('Choose a finite nonnegative import position.');if(!engine.ready||!identity(engine.projectId))throw new Error('Load a Freestyle cloud project first.');if(engine.audioImportActive)throw new Error('Wait for the current audio import to finish.');
 const scope=scopeFor(engine),record={id:crypto.randomUUID(),idempotencyKey:crypto.randomUUID(),file,projectId:scope.projectId,laneId:laneId||null,startSec,phase:'preparing',clipId:null,persisted:false,liveVerified:false,receipts:{}};engine.lastImport=record;engine.audioImportActive=true;
 try{
  await engine.flush();assertScope(engine,scope,assertCurrent);assertLane(engine,laneId);const before=new Set(canonicalClips(engine).map(clip=>clip.cloudId||clip.id)),encoded=await base64(file);assertScope(engine,scope,assertCurrent);assertLane(engine,laneId);
  record.beforeClipIds=[...before];record.phase='uploading';record.dispatched=true;
  record.receipts.upload=await importWrite(engine,record,scope,'upload','upload_audio',{project_id:scope.projectId,filename:filename(file.name,160),base64:encoded,kind:'audio',title:filename(file.name,120),idempotency_key:record.idempotencyKey,...(laneId?{track_id:laneId}:{}),...(startSec>0?{start_ms:Math.round(startSec*1000)}:{})},assertCurrent);record.acknowledged=true;{const upload=record.receipts.upload??{};record.engineAttached=upload.engine_attached===true&&upload.engine_reload_required!==true;record.serverReloadRequired=upload.engine_reload_required===true;}record.clipId=receiptClipIdentity(record.receipts.upload,before);record.persisted=!!record.clipId;record.phase='reading-upload';
  const savedClip=await readSavedAudio(engine,record,scope,assertCurrent);
  await finishSavedAudio(engine,record,scope,assertCurrent,{retryAttach:!deferAttach,retryPlacement:true,savedClip,deferAttach});
  if(record.attachDeferred){record.phase='saved-attach-pending';record.engineAttachedByServer=record.engineAttached===true;record.clip=structuredClone(canonicalClip(engine,record.clipId));engine.onStatus?.('Placed '+file.name+'; loading it into the live engine…');return {...record.receipts.upload,clipId:record.clipId,importRecord:record,attachDeferred:true,engineAttached:record.engineAttached===true,serverReloadRequired:record.serverReloadRequired===true};}
  record.phase='complete';record.liveVerified=true;record.clip=structuredClone(canonicalClip(engine,record.clipId));engine.onStatus?.('Imported '+file.name+' into the live timeline.');return {...record.receipts.upload,clipId:record.clipId,importRecord:record};
 }catch(error){record.idempotencyInProgress=record.writeAttempts?.some(attempt=>attempt.idempotencyInProgress===true)??false;record.error=error.message;record.planningRejected=record.writeAttempts?.length===1&&record.writeAttempts[0].stage==='upload'&&record.writeAttempts[0].status==='rejected'&&record.writeAttempts[0].providerDispatched===false&&!record.acknowledged&&!record.persisted;record.phase=record.acknowledged?'saved-unverified':record.planningRejected?'failed':record.dispatched?'uncertain':'failed';throw problem(error.message,error.code||(record.acknowledged?'import_saved_unverified':record.dispatched?'import_uncertain':'import_failed'),record,error);}finally{engine.audioImportActive=false;}
}

export async function createCloudAudioTrack(engine,{name='Audio track',assertCurrent}={}){
 if(!engine.ready)throw new Error('Load a Freestyle cloud project first.');
 const scope=scopeFor(engine),args={kind:'audio',label:String(name).slice(0,80)},attempt={receipts:{},projectId:scope.projectId,trackId:scope.trackId,action:'create_empty_lane',arguments:args,idempotencyKey:crypto.randomUUID(),dispatched:false,acknowledged:false,status:'preparing'};engine.lastTrackCreation=attempt;let receipt;
 try{
  await engine.flush();assertScope(engine,scope,assertCurrent);
  const before=new Set((engine.session.project??engine.project).channels.map(channel=>channel.laneId||channel.id));attempt.beforeLaneIds=[...before];attempt.dispatched=true;attempt.status='sending';
  receipt=await importWrite(engine,attempt,scope,'create','execute_pro_action',{project_id:scope.projectId,track_id:scope.trackId,action:'create_empty_lane',arguments:args,idempotency_key:attempt.idempotencyKey},assertCurrent);attempt.acknowledged=true;attempt.receipt=structuredClone(receipt);attempt.status='acknowledged-unverified';
  return await verifyCreatedTrack(engine,attempt,scope,assertCurrent);
 }catch(error){
  attempt.idempotencyInProgress=attempt.writeAttempts?.some(write=>write.idempotencyInProgress===true)??false;attempt.error=error.message;
  if(!attempt.acknowledged)attempt.status=attempt.dispatched&&definiteCloudRejection(error,[400,401,403,404,412,413,422,429])?'rejected':attempt.dispatched?'uncertain':'not-dispatched';
  error.trackAttempt=attempt;if(receipt!==undefined)error.trackReceipt=receipt;throw error;
 }
}
async function verifyCreatedTrack(engine,attempt,scope,assertCurrent){const before=new Set(attempt.beforeLaneIds),receipt=attempt.receipt;await refresh(engine,scope,assertCurrent);const channels=(engine.session.project??engine.project).channels.filter(channel=>!channel.patternSource&&!before.has(channel.laneId||channel.id)),id=receipt?.laneId||receipt?.lane_id||receipt?.lane?.id||receipt?.track?.id||receipt?.trackId;
  const channel=id?channels.find(channel=>(channel.laneId||channel.id)===id):channels.length===1?channels[0]:null;if(!channel||['instrument','pattern','midi'].includes(channel.type))throw new Error('Freestyle has not confirmed the new audio lane.');attempt.status='verified';return {receipt,laneId:channel.laneId||channel.id,channel};

}
export async function reconcileCloudAudioTrack(engine,attempt,{assertCurrent}={}){
 if(!attempt||attempt.projectId!==engine.projectId)throw new Error('Open the new track’s original project.');
 if(attempt.idempotencyInProgress){const recovered=await recoverImportWrite(engine,attempt,assertCurrent);attempt.receipt=structuredClone(recovered.receipt);attempt.acknowledged=true;attempt.status='acknowledged-unverified';}
 assertTerminalIdempotency(attempt);if(!attempt.acknowledged)throw new Error('The new track has no terminal receipt; an unknown creation will not be replayed.');
 return verifyCreatedTrack(engine,attempt,attempt.scope,assertCurrent);
}
