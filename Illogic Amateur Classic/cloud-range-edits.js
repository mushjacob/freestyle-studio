/** Typed Freestyle audio-clip transactions. No local audio or guessed pattern edits. */
import {assertCompleteCanonicalData,clipBatchCommitOutcome,clipBatchAppliedCount} from './cloud-session.js';
export {clipBatchCommitOutcome,clipBatchAppliedCount};
const clone=value=>value==null?value:structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const timingFields=['start_ms','duration_sec','audio_offset_sec'];
const projectIdentity=project=>project?.cloud?.projectId||project?.id;
const detail=value=>typeof value==='string'?value:value?.message||value?.detail||'Freestyle rejected the audio-clip edit.';
const scopeKey=value=>JSON.stringify(value);
function assertKeys(value,keys,label){for(const key of Object.keys(value))if(!keys.includes(key))throw new Error(`${label} contains unsupported field ${key}; the audio batch cannot edit pattern placement or lane metadata.`);}
function assertTiming(value,label){
 if(own(value,'start_ms')&&(!finite(value.start_ms)||value.start_ms<0))throw new RangeError(`${label}.start_ms must be a finite non-negative number.`);
 if(own(value,'duration_sec')&&(!finite(value.duration_sec)||value.duration_sec<=0))throw new RangeError(`${label}.duration_sec must be a finite positive number.`);
 if(own(value,'audio_offset_sec')&&(!finite(value.audio_offset_sec)||value.audio_offset_sec<0))throw new RangeError(`${label}.audio_offset_sec must be a finite non-negative number.`);
}
export function validateClipBatchOps(ops,{allowEmpty=false,serverAuthoredInverse=false}={}){
 assertCompleteCanonicalData(ops,'audio clip batch');
 if(!Array.isArray(ops)||ops.length>256||ops.length<(allowEmpty?0:1))throw new RangeError('An atomic audio clip batch needs 1–256 operations.');
 for(const op of ops){
  if(!record(op))throw new TypeError('Each audio clip operation must be an object.');
  assertKeys(op,['op','id','source_id',...timingFields,'expected'],'Audio clip operation');
  if(!['update','insert','remove','restore'].includes(op.op)||!id(op.id))throw new Error('Each audio clip operation needs a supported op and a durable clip id.');
  if(own(op,'source_id')&&!id(op.source_id))throw new Error('Audio clip source_id must be a durable clip id.');
  // A range delete can remove the final live clip. Its documented native Undo
  // restores that same durable take without a source_id. Permit only a retained
  // server inverse with complete timing; ordinary caller-created restores still
  // require a live source and cannot invent a deleted clip's media identity.
  const nativeRestore=serverAuthoredInverse&&op.op==='restore'&&!own(op,'source_id')&&timingFields.every(key=>own(op,key));
  if(['insert','restore'].includes(op.op)&&!id(op.source_id)&&!nativeRestore)throw new Error(`${op.op} needs a live same-audio source_id or an exact server-authored restore inverse.`);
  assertTiming(op,'Audio clip operation');
  // Contract: a batch op's expected guard is the clip's complete window. A
  // partial guard would let the server compare against an unstated field.
  if(own(op,'expected')){if(!record(op.expected))throw new TypeError('Audio clip expected timing must be an object.');assertKeys(op.expected,timingFields,'Expected audio clip timing');const missing=timingFields.filter(key=>!own(op.expected,key));if(missing.length)throw new Error(`Expected audio clip timing needs ${missing.join(', ')}; reload the clip's complete saved window before editing it.`);assertTiming(op.expected,'Expected audio clip timing');}
 }
 return clone(ops);
}
function context(project){
 const projectId=projectIdentity(project),trackId=project?.cloud?.trackId??project?.trackId;
 if(!id(projectId))throw new Error('Open a Freestyle cloud project before editing audio clips.');
 if(trackId!==undefined&&trackId!==null&&!id(trackId))throw new Error('The cloud engine context has no valid take identity.');
 return{projectId,trackId:trackId??null};
}
export function rangeEditRequest(project,{laneIds,operation,startMs,endMs,ripple=false,idempotencyKey}={}){
 const {projectId,trackId}=context(project);
 if(!Array.isArray(laneIds)||laneIds.length<1||laneIds.length>64||!laneIds.every(id)||new Set(laneIds).size!==laneIds.length)throw new Error('Choose 1–64 distinct persisted audio lane ids.');
 if(!['split','delete','trim_to_selection'].includes(operation))throw new Error('Choose split, delete or trim_to_selection.');
 // A split is a cursor: Freestyle needs end_ms equal to start_ms.
 if(operation==='split'){if(endMs===undefined)endMs=startMs;if(!Number.isSafeInteger(startMs)||startMs<0||endMs!==startMs)throw new RangeError('A split needs one whole-millisecond cursor (end_ms equal to start_ms).');}
 else if(!Number.isSafeInteger(startMs)||startMs<0||!Number.isSafeInteger(endMs)||endMs<=startMs)throw new RangeError('Choose a non-empty whole-millisecond audio range.');
 if(typeof ripple!=='boolean')throw new TypeError('The range ripple option must be a boolean.');
 if(typeof idempotencyKey!=='string'||!idempotencyKey.length||idempotencyKey.length>128)throw new Error('Retain a nonempty idempotency key of at most 128 characters for this range edit.');
 return{project_id:projectId,...trackId?{track_id:trackId}:{},lane_ids:[...laneIds],operation,start_ms:startMs,end_ms:endMs,ripple,idempotency_key:idempotencyKey};
}
function statusOf(error){
 const values=[error?.status,error?.statusCode,error?.error?.status,error?.error?.statusCode,error?.result?.status,error?.result?.statusCode,error?.result?.error?.status,error?.result?.error?.statusCode,error?.result?.response?.status,error?.result?.response?.statusCode,error?.result?.response?.error?.status];
 return values.find(value=>Number.isInteger(value)&&value>=100&&value<=599);
}
export function unwrapClipEditResult(result){
 let data=result?.structuredContent;
 if(data===undefined&&Array.isArray(result?.content)){
  try{data=JSON.parse(result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'));}
  catch{throw new Error('Freestyle returned an unreadable audio edit receipt.');}
 }
 data=data??result;const payload=data?.response??data;
 // postCommitError marks a COMMITTED batch whose later mirror step failed.
 const committedWithPostError=record(payload?.postCommitError)&&payload.applied!==false&&!result?.isError;
 if(!committedWithPostError&&(result?.isError||data?.ok===false||data?.error||payload?.ok===false||payload?.error)){
    const reason=payload?.error||data?.error,err=new Error(detail(reason||payload?.message||data?.message));err.cloudRejected=true;err.result=clone(result);err.status=statusOf(reason)||statusOf(payload)||statusOf(data);err.code=reason?.code??payload?.code??data?.code;err.stage=reason?.stage??payload?.stage??data?.stage;if(reason?.applied===false||payload?.applied===false){err.operationUncertain=false;err.explicitRejection=true;}else if(err.stage==='engine_dispatch')err.operationUncertain=true;throw err;
 }
 if(!record(payload)||!Object.keys(payload).length)throw new Error('Freestyle returned no usable audio edit receipt.');
 assertCompleteCanonicalData(payload,'audio edit receipt');return clone(payload);
}
export function validateClipEditReceipt(payload,projectId,{range=false}={}){
 if(!record(payload))throw new Error('Freestyle returned no usable audio edit receipt.');
 for(const key of ['project_id','projectId'])if(own(payload,key)&&payload[key]!==projectId)throw new Error('Freestyle returned an audio edit receipt for a different project.');
 for(const key of ['replay','engine_reload_required'])if(own(payload,key)&&typeof payload[key]!=='boolean')throw new Error(`Freestyle returned an invalid ${key} acknowledgement.`);
 if(own(payload,'clips_after')&&(!Array.isArray(payload.clips_after)||!payload.clips_after.every(record)))throw new Error('Freestyle returned invalid clips_after data.');
 // The public range contract names these fields, but does not specify a full
 // clip DTO or a dry-run plan field. Preserve unknown returned metadata; do not
 // turn it into guessed canonical clips or fabricate an undo snapshot.
 if(range&&(!Array.isArray(payload.clips_after)||!record(payload.undo)||!Array.isArray(payload.undo.inverse_ops)))throw new Error('The range edit returned no clips_after and undo.inverse_ops receipt; inspect canonical state before another write.');
 // undo.inverse_ops is null on a replay of an already-committed batch (or when a
 // prior state was unknown): the same committed result, with no server inverse.
 if(payload.undo?.inverse_ops!=null)validateClipBatchOps(payload.undo.inverse_ops,{allowEmpty:true,serverAuthoredInverse:true});
 return clone(payload);
}

/** One logical range edit (or one supplied audio batch), with an explicit inverse. */
export class CloudRangeEditController{
 constructor({getProject,cloudCall,getScope=()=>null,flush=async()=>{},onChange=()=>{},onCommitted=async()=>{},createIdempotencyKey=()=>globalThis.crypto.randomUUID()}={}){
  if(typeof getProject!=='function'||typeof cloudCall!=='function')throw new TypeError('CloudRangeEditController needs getProject and cloudCall callbacks.');
  Object.assign(this,{getProject,cloudCall,getScope,flush,onChange,onCommitted,createIdempotencyKey});this.inFlight=null;this.prepared=null;this.uncertain=false;this.needsPlan=false;
  this.state={status:'idle',operation:null,scope:null,request:null,rawResult:null,payload:null,receipt:null,undoReceipt:null,inverseOps:[],error:null,refreshError:null,detached:false,planVerified:false,applied:false};
 }
 capture(){return{...context(this.getProject()),epoch:clone(this.getScope())};}
 isCurrent(scope=this.state.scope){try{return !!scope&&scopeKey(this.capture())===scopeKey(scope);}catch{return false;}}
 snapshot(){return clone({...this.state,busy:!!this.inFlight,canUndo:!this.inFlight&&this.state.status==='committed'&&this.state.applied&&this.state.inverseOps.length>0&&this.isCurrent()});}
 notify(){const state=this.snapshot();this.onChange(state);return state;}
 assertAvailable(){if(this.inFlight)throw new Error('An audio clip request is already in progress.');if(this.uncertain)throw new Error('The previous audio edit result is uncertain. Inspect its canonical clips before creating another controller; the mutation will not be retried.');}
 assertUnused(){if(this.state.applied||this.state.status==='undone')throw new Error('This controller already owns an audio edit receipt. Use its inverse or create a controller for a different gesture.');}
 prepare(options){
  const previous=this.prepared,scope=this.capture(),key=options?.idempotencyKey??previous?.request.idempotency_key??this.createIdempotencyKey();let request=rangeEditRequest(this.getProject(),{...options,idempotencyKey:key});
  const changed=previous&&scopeKey({...request,idempotency_key:null})!==scopeKey({...previous.request,idempotency_key:null});
  if(changed){if(options?.idempotencyKey===previous.request.idempotency_key)throw new Error('A changed audio range needs a fresh native idempotency key.');if(options?.idempotencyKey===undefined)request={...request,idempotency_key:this.createIdempotencyKey()};}
  if(typeof request.idempotency_key!=='string'||!request.idempotency_key.length||request.idempotency_key.length>128)throw new Error('The generated range idempotency key is invalid.');
  // The body key seeds native child identities and stays the same from plan
  // through commit. HTTP idempotency hashes the complete body, including
  // dry_run, so a preview needs its own retained transport key.
  const unchanged=previous&&scopeKey(previous.scope)===scopeKey(scope)&&scopeKey(previous.request)===scopeKey(request);let planHttpKey=unchanged?previous.planHttpKey:null;
  if(!planHttpKey){for(let attempt=0;attempt<8;attempt++){const candidate=this.createIdempotencyKey();if(typeof candidate!=='string'||!candidate.length||candidate.length>128)throw new Error('The generated range planning key is invalid.');if(candidate!==request.idempotency_key&&candidate!==previous?.planHttpKey){planHttpKey=candidate;break;}}if(!planHttpKey)throw new Error('Audio planning needs a distinct retained HTTP idempotency key.');}
  this.prepared={scope,request,planHttpKey};return clone(this.prepared);
 }
 async dryRunRange(options){
  this.assertAvailable();this.assertUnused();const prepared=options?this.prepare(options):clone(this.prepared);if(!prepared)throw new Error('Choose an audio range before requesting its dry-run plan.');
  if(!this.isCurrent(prepared.scope))throw new Error('The cloud project or engine context changed since this range was prepared.');
  return this.run('plan',prepared.scope,{...prepared.request,dry_run:true},'edit_time_range',{mutating:false,callOptions:{idempotencyKey:prepared.planHttpKey},accept:payload=>{validateClipEditReceipt(payload,prepared.scope.projectId);this.needsPlan=false;this.state.planVerified=false;}});
 }
 async commitRange(options){
  this.assertAvailable();this.assertUnused();if(this.needsPlan)throw new Error('Read a fresh dry-run range plan after the rejected edit before committing again.');
  const prepared=options?this.prepare(options):clone(this.prepared);if(!prepared)throw new Error('Prepare the audio range before committing it.');
  if(!this.isCurrent(prepared.scope))throw new Error('The cloud project or engine context changed since this range was prepared.');
  return this.run('range',prepared.scope,{...prepared.request,dry_run:false},'edit_time_range',{accept:payload=>{validateClipEditReceipt(payload,prepared.scope.projectId,{range:true});this.state.receipt=clone(payload);this.state.inverseOps=validateClipBatchOps(payload.undo.inverse_ops,{allowEmpty:true,serverAuthoredInverse:true});this.state.applied=true;}});
 }
 /** Caller inverses must come from canonical before-state, with expected timing
  * checks. The batch response is not assumed to return clips or an inverse. */
 async applyBatch(ops,{inverseOps,serverAuthoredOps=false,serverAuthoredInverse=false}={}){
  this.assertAvailable();this.assertUnused();const scope=this.capture(),request={project_id:scope.projectId,...scope.trackId?{track_id:scope.trackId}:{},ops:validateClipBatchOps(ops,{serverAuthoredInverse:serverAuthoredOps})},inverse=inverseOps===undefined?null:validateClipBatchOps(inverseOps,{allowEmpty:true,serverAuthoredInverse});
  return this.run('batch',scope,request,'apply_clip_batch',{accept:payload=>{validateClipEditReceipt(payload,scope.projectId);this.adoptCommit(payload);this.state.receipt=clone(payload);this.state.inverseOps=Array.isArray(payload.undo?.inverse_ops)?validateClipBatchOps(payload.undo.inverse_ops,{allowEmpty:true,serverAuthoredInverse:true}):inverse||[];this.state.inverseSource=Array.isArray(payload.undo?.inverse_ops)?'server':inverse?'client':'none';this.state.applied=true;}});
 }
 async applyInverse(){
  this.assertAvailable();if(!this.snapshot().canUndo)throw new Error('There is no acknowledged inverse for the current cloud project and engine context.');
  const scope=clone(this.state.scope),request={project_id:scope.projectId,...scope.trackId?{track_id:scope.trackId}:{},ops:validateClipBatchOps(this.state.inverseOps,{serverAuthoredInverse:true})};
  return this.run('inverse',scope,request,'apply_clip_batch',{accept:payload=>{validateClipEditReceipt(payload,scope.projectId);this.adoptCommit(payload);this.state.undoReceipt=clone(payload);this.state.applied=false;}});
 }
 adoptCommit(payload){const outcome=clipBatchCommitOutcome(payload);this.state.postCommitError=outcome.postCommitError;this.state.engineReloadRequired=outcome.engineReloadRequired;this.state.warning=outcome.warning;}
 async run(operation,scope,request,name,{mutating=true,callOptions,accept}={}){
  const token={};this.inFlight=token;this.state={...this.state,status:operation==='plan'?'planning':operation==='inverse'?'undoing':'committing',operation,scope:clone(scope),request:clone(request),rawResult:null,payload:null,error:null,refreshError:null,detached:false,postCommitError:null,engineReloadRequired:false,warning:null};let sent=false;
  try{
   this.notify();await this.flush();if(!this.isCurrent(scope))throw new Error('The cloud project or engine context changed before the audio request was sent.');
   sent=true;const result=await this.cloudCall(name,clone(request),clone(callOptions));this.state.rawResult=clone(result);const payload=unwrapClipEditResult(result);this.state.payload=clone(payload);accept(payload);
   this.state.status=operation==='plan'?'planned':operation==='inverse'?'undone':'committed';this.state.detached=!this.isCurrent(scope);this.notify();
   if(mutating&&!this.state.detached){try{await this.onCommitted(clone(payload),{operation,scope:clone(scope),request:clone(request)});}catch(error){this.state.refreshError=error.message||String(error);}}
   this.state.detached=!this.isCurrent(scope);
  }catch(error){
   let rejection=error;if(!error.cloudRejected&&error.result){try{unwrapClipEditResult(error.result);}catch(decoded){if(decoded.cloudRejected)rejection=decoded;}}const status=statusOf(error)||statusOf(rejection),uncertainError=value=>value.operationUncertain===true||value.operationUncertain!==false&&value.explicitRejection!==true&&value.stage==='engine_dispatch',upstreamUncertain=uncertainError(error)||uncertainError(rejection),rejected=!upstreamUncertain&&([409,412].includes(status)||rejection.cloudRejected===true&&!(status>=500)||[400,401,403,404,422].includes(status));
   this.uncertain=!!(mutating&&sent&&!rejected);this.needsPlan=operation==='range'&&(sent||[409,412].includes(status));
   this.state.status=this.uncertain?'uncertain':[409,412].includes(status)?'conflict':'failed';this.state.error=error.message||String(error);this.state.detached=!this.isCurrent(scope);if(this.uncertain)this.state.error+=' The mutation will not be retried; inspect canonical cloud state.';this.notify();throw error;
  }finally{if(this.inFlight===token)this.inFlight=null;this.notify();}
  return this.snapshot();
 }
}
