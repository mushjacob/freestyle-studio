import {isIdempotencyInProgress,definiteCloudRejection,retainInProgress,captureWriteRequest,replayKnownBusyWrite} from './cloud-errors.js';
import {assertCompleteCanonicalData} from './cloud-session.js';
/** Atomic time-range operations. All request/receipt names here are internal DTOs.
 * Adapters translate the published Freestyle schema; this module invents no wire
 * fields, audio processing, clipboard semantics, or generic engine history.
 */
const clone=value=>value==null?value:structuredClone(value);
const projectIdentity=p=>p?.cloud?.projectId||p?.id;
const text=value=>typeof value==='string'&&value.length>0;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const sortValue=value=>Array.isArray(value)?value.map(sortValue):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,sortValue(value[key])])):value;
const fingerprint=value=>JSON.stringify(sortValue(value));
const errorText=error=>error?.message||String(error);
const rejection=error=>isIdempotencyInProgress(error)?'uncertain':Number(error?.status)===409||error?.code==='conflict'?'conflict':error?.definiteRejection===true||[400,401,403,404,412,422].includes(Number(error?.status))?'rejected':'uncertain';

/** Exact editable project projection. Browser selection is not an engine edit. */
const editableChannel=channel=>{const result=clone(channel);delete result.engineTrackId;return result;};
export function rangeEditMixCheckpoint(project){return {master:project.master,channels:Array.isArray(project.channels)?project.channels.map(editableChannel):project.channels,bpm:project.bpm,loop:project.loop};}
export function rangeEditCheckpoint(project){
 const checkpoint=clone(project);if(!checkpoint||typeof checkpoint!=='object')throw new Error('Open a cloud project before editing a time range.');
 for(const key of ['selectedPattern','selectedChannel'])delete checkpoint[key];
 // Ignore only canonical project receipt versions, never clip/source revisions.
 delete checkpoint.timelineRevision;
 if(checkpoint.cloud?.rawProject)delete checkpoint.cloud.rawProject.timelineRevision;
 // Engine observations and attachment handles are diagnostics, rather than
 // persisted edits. Keep canonical cloudRaw/rawProject and all mix parameters.
 if(checkpoint.cloud){delete checkpoint.cloud.rawState;delete checkpoint.cloud.warnings;}
 if(Array.isArray(checkpoint.channels))checkpoint.channels=checkpoint.channels.map(editableChannel);
 if(Array.isArray(checkpoint.audioClips))for(const clip of checkpoint.audioClips)for(const key of ['engineTrackId','engineClipId','engineLoaded','cloudRuntime'])delete clip[key];
 return checkpoint;
}
function assertOperations(operations){
 if(!Array.isArray(operations)||operations.length>256||operations.some(op=>!op||typeof op!=='object'||Array.isArray(op)))throw new Error('The adapter must return at most 256 exact inverse operation objects.');
 return clone(operations);
}
function assertReceipt(receipt,request,{preview=false}={}){
 if(!receipt||typeof receipt!=='object'||receipt.projectId!==request.projectId)throw new Error('The range-edit adapter returned a receipt for an unverified project.');
 if(receipt.idempotencyKey!==undefined&&receipt.idempotencyKey!==request.idempotencyKey)throw new Error('The range-edit adapter returned a different idempotency identity.');
 if(['conflict','rejected'].includes(receipt.status)){const error=new Error(receipt.message||`The cloud range edit was ${receipt.status}.`);error.definiteRejection=true;error.status=receipt.status==='conflict'?409:422;error.result=clone(receipt);error.code=receipt.code;if(isIdempotencyInProgress(error))error.definiteRejection=false;throw error;}
 if(preview){if(receipt.status!=='previewed'||!receipt.plan||typeof receipt.plan!=='object')throw new Error('The adapter did not return a verified dry-run plan.');}
 else {if(receipt.status!=='applied')throw new Error('The adapter did not confirm an applied atomic edit.');if(receipt.inverseOps!==null)assertOperations(receipt.inverseOps);}
 return receipt;
}

/** One explicit atomic transaction, followed only by its own inverse receipts.
 * `refresh` returns {historyCheckpointVerified:true} only after complete canonical
 * engine reads. A local optimistic project is insufficient to enable history.
 */
export class RangeEditController {
 constructor({getProject,flush=async()=>{},refresh,sendEdit,sendBatch,getCheckpoint=rangeEditCheckpoint,makeIdempotencyKey=()=>globalThis.crypto.randomUUID(),onChange=()=>{},isBusy=()=>false,isInteracting=()=>false}={}){
  if([getProject,refresh,sendEdit,sendBatch,getCheckpoint,makeIdempotencyKey].some(fn=>typeof fn!=='function'))throw new TypeError('RangeEditController requires project, refresh and typed adapter callbacks.');
  Object.assign(this,{getProject,flush,refresh,sendEdit,sendBatch,getCheckpoint,makeIdempotencyKey,onChange,isBusy,isInteracting});this.inFlight=null;this.record=null;this.archived=[];
 }
 snapshot(){const record=clone(this.record),same=record?.request.projectId===projectIdentity(this.getProject()),available=!!same&&!this.inFlight&&['applied','undone'].includes(record?.status)&&!!record?.checkpointVerified&&(record.ackCommitted===true||fingerprint(this.checkpoint())===fingerprint(record.historyCheckpoint));/* ACK-committed: the server inverse ops carry exact expected guards; the background verify may replace local metadata */return {record,archived:clone(this.archived),canUndo:available&&record.applied==='edit'&&record.inverseOps?.length>0,canRedo:available&&record.applied==='undone'&&record.inverseOps?.length>0,inFlight:!!this.inFlight};}
 notify(){const state=this.snapshot();this.onChange(state);return state;}
 guard(){if(this.isBusy()||this.isInteracting())throw new Error('Finish the current cloud operation or gesture before editing a time range.');}
 checkpoint(){return clone(this.getCheckpoint(this.getProject()));}
 assertScope(request,expected=request.expectedCheckpoint){if(projectIdentity(this.getProject())!==request.projectId)throw new Error('Return to the captured cloud project before continuing this range edit.');if(fingerprint(this.checkpoint())!==fingerprint(expected))throw new Error('The canonical project changed. Capture a new range edit instead of mixing history.');}
 prepare({operation,selection,laneIds,ripple=false}={}){
  this.guard();if(this.inFlight)throw new Error('A range-edit operation is already in progress.');
  if(this.record&&(this.record.mutationAttempted||this.record.status==='uncertain'))throw new Error('Release the completed transaction explicitly before preparing another range edit. An uncertain edit cannot be released.');
  const project=this.getProject(),projectId=projectIdentity(project);
  if(!text(projectId))throw new Error('Open a persisted cloud project before editing a range.');
  if(!['split','delete','trim-to-selection'].includes(operation))throw new Error('Choose split, delete or trim-to-selection.');
  const boundaries=rangeEditBoundaryArguments(selection),start=boundaries.start_frame??boundaries.start_ms,end=boundaries.end_frame??boundaries.end_ms;
  if(end<start||operation!=='split'&&end===start)throw new RangeError('Choose an ordered non-empty time range; only Split accepts a cursor.');
  if(typeof ripple!=='boolean'||ripple&&operation!=='delete')throw new Error('Ripple is an explicit boolean option for range deletion only.');
  const known=new Set([...(project.cloud?.timelineLaneIds||[]),...(project.channels||[]).map(c=>c.laneId||c.cloudTrackId||c.id),...[...(project.clips||[]),...(project.audioClips||[])].map(c=>c.laneId||c.cloudRaw?.laneId||c.cloudRaw?.lane_id)].filter(text));
  if(!Array.isArray(laneIds)||!laneIds.length||laneIds.some(id=>!text(id)||!known.has(id))||new Set(laneIds).size!==laneIds.length)throw new Error('Choose unique canonical lane identities from the current project.');
  const idempotencyKey=this.makeIdempotencyKey();if(!text(idempotencyKey))throw new Error('The adapter requires a retained idempotency identity.');
  this.record={status:'prepared',request:{projectId,operation,selection:clone(selection),laneIds:[...laneIds],ripple,idempotencyKey,expectedCheckpoint:this.checkpoint()},plan:null,receipt:null,inverseOps:null,checkpointVerified:false,applied:null,mutationAttempted:false,historyAttempts:[],error:null,refreshError:null};return this.notify();
 }
 preview(){return this.perform('preview');}
 apply(){return this.perform('apply');}
 undo(){return this.perform('undo');}
 redo(){return this.perform('redo');}
 perform(operation){
  if(this.inFlight){if(this.activeOperation===operation)return this.inFlight;return Promise.reject(new Error('A different range-edit operation is already in progress.'));}
  const record=this.record;if(!record)return Promise.reject(new Error('Capture a time range first.'));
  try{
   this.guard();
   if(record.status==='uncertain'||record.status==='applied-unverified')throw new Error('Inspect the retained receipt and verify its checkpoint before another mutation.');
   if((operation==='apply'||operation==='preview')&&record.mutationAttempted)throw new Error('This transaction has already been submitted. It will not be repeated.');
   if(operation==='undo'&&(!record.checkpointVerified||record.applied!=='edit'||!record.inverseOps?.length)||operation==='redo'&&(!record.checkpointVerified||record.applied!=='undone'||!record.inverseOps?.length))throw new Error('A verified matching inverse receipt is required for this history operation.');
  }catch(error){return Promise.reject(error);}
  const preview=operation==='preview',history=operation==='undo'||operation==='redo';
  const expected=history?record.historyCheckpoint:record.request.expectedCheckpoint;
  const request=history?{projectId:record.request.projectId,operations:clone(record.inverseOps),expectedCheckpoint:clone(expected),idempotencyKey:this.makeIdempotencyKey(),reason:operation,parentIdempotencyKey:record.request.idempotencyKey}:{...clone(record.request),dryRun:preview};
  if(preview){record.previewIdempotencyKey??=this.makeIdempotencyKey();request.idempotencyKey=record.previewIdempotencyKey;}
  if(!text(request.idempotencyKey))return Promise.reject(new Error('The history adapter requires a retained idempotency identity.'));
  const attempt={operation,request:clone(request),receipt:null,status:'preparing',writeRequest:captureWriteRequest(history?'sendBatch':'sendEdit',{request:clone(request),idempotency_key:request.idempotencyKey})};record.pendingAttempt=attempt;if(history)record.historyAttempts.push(attempt);
  record.status=preview?'previewing':operation==='apply'?'applying':operation==='undo'?'undoing':'redoing';record.error=null;record.refreshError=null;this.activeOperation=operation;
  const task=Promise.resolve().then(async()=>{
   let dispatched=false;
   try{
    await this.flush();this.guard();if(history&&record.ackCommitted){if(projectIdentity(this.getProject())!==request.projectId)throw new Error('Return to the captured cloud project before continuing this range edit.');}else this.assertScope(request,expected);
    dispatched=true;attempt.status='submitted';if(!preview)record.mutationAttempted=true;
    const receipt=await (history?this.sendBatch(clone(request)):this.sendEdit(clone(request)));attempt.receipt=clone(receipt);record.receipt=clone(receipt);
    assertReceipt(receipt,request,{preview});attempt.status='acknowledged';
    if(preview){record.plan=clone(receipt.plan);record.status='previewed';return;}
    record.applied=operation==='undo'?'undone':'edit';record.inverseOps=receipt.inverseOps===null?null:assertOperations(receipt.inverseOps);record.historyUnavailableReason=receipt.historyUnavailableReason||null;record.checkpointVerified=false;record.status='applied-unverified';
    // Freestyle Studio model: the terminal ACK (clips_after / ops / inverse) commits
    // locally and history is usable at once; canonical/native readback runs later.
    if(typeof this.ackCommit==='function'&&await this.ackCommit({record,attempt:clone(attempt),request:clone(request),receipt:clone(attempt.receipt)})===true){record.historyCheckpoint=this.checkpoint();record.checkpointVerified=true;record.ackCommitted=true;record.status=record.applied==='undone'?'undone':'applied';record.refreshError=null;}
    else await this.verifyAppliedCheckpoint(record,attempt);
   }catch(error){const acknowledged=attempt.status==='acknowledged';if(dispatched&&!acknowledged&&error.readOnlyVerification!==true){retainInProgress(record,error);retainInProgress(attempt,error);if(error?.receipt!==undefined||error?.result!==undefined){attempt.receipt=clone(error.receipt??error.result);record.receipt=clone(attempt.receipt);}}const status=!dispatched||error.writeDispatched===false?'rejected':isIdempotencyInProgress(error)?'uncertain':preview?'rejected':rejection(error);if(!acknowledged)attempt.status=status;attempt.error=errorText(error);record.status=acknowledged&&!preview?'applied-unverified':status;record.error=errorText(error);throw error;}
   finally{this.inFlight=null;this.activeOperation=null;this.notify();}
  }).then(()=>this.snapshot());this.inFlight=task;this.notify();return task;
 }
 async verifyAppliedCheckpoint(record,attempt){
  if(projectIdentity(this.getProject())!==record.request.projectId){record.refreshError='The transaction completed in the captured project. Return there to verify its checkpoint.';return;}
  try{
   const result=await this.refresh({projectId:record.request.projectId,operation:attempt.operation,request:clone(attempt.request),receipt:clone(attempt.receipt)});
   if(projectIdentity(this.getProject())!==record.request.projectId)throw new Error('The project changed while the transaction checkpoint was being read.');
   if(result?.historyCheckpointVerified!==true)throw new Error('Complete canonical project and automation reads are required before history.');
   record.historyCheckpoint=this.checkpoint();record.checkpointVerified=true;record.status=record.applied==='undone'?'undone':'applied';record.refreshError=null;
  }catch(error){record.checkpointVerified=false;record.status='applied-unverified';record.refreshError=errorText(error);}
 }
 reconcile(){
  if(this.inFlight)return this.activeOperation==='reconcile'?this.inFlight:Promise.reject(new Error('Wait for the current range-edit operation.'));const record=this.record;
  const busy=record?.status==='uncertain'&&record.idempotencyInProgress===true,attempt=record?.pendingAttempt??[...(record?.historyAttempts??[])].reverse().find(item=>item.status==='acknowledged')??(record?{operation:'apply',request:{...clone(record.request),dryRun:false},receipt:record.receipt}:null);
  if(!record||!busy&&(record.status!=='applied-unverified'||!record.applied))return Promise.reject(new Error('A verified applied receipt is required before refreshing its checkpoint. An uncertain mutation is not retried.'));
  this.activeOperation='reconcile';const task=Promise.resolve().then(async()=>{
   if(busy){
    const {receipt}=await replayKnownBusyWrite({knownBusy:attempt?.idempotencyInProgress===true,request:attempt?.writeRequest,assertCurrent:()=>{this.guard();if(projectIdentity(this.getProject())!==record.request.projectId)throw new Error('Return to the captured cloud project before verifying the original request.');},call:(name,args)=>name==='sendBatch'?this.sendBatch(clone(args.request)):this.sendEdit(clone(args.request)),parse:value=>assertReceipt(value,attempt.request,{preview:attempt.operation==='preview'})});
    attempt.receipt=clone(receipt);attempt.status='acknowledged';delete attempt.idempotencyInProgress;delete record.idempotencyInProgress;record.receipt=clone(receipt);record.error=null;
    if(attempt.operation==='preview'){record.plan=clone(receipt.plan);record.status='previewed';return;}
    record.applied=attempt.operation==='undo'?'undone':'edit';record.inverseOps=receipt.inverseOps===null?null:assertOperations(receipt.inverseOps);record.historyUnavailableReason=receipt.historyUnavailableReason||null;record.checkpointVerified=false;record.status='applied-unverified';
   }
   await this.verifyAppliedCheckpoint(record,attempt);
  }).finally(()=>{this.inFlight=null;this.activeOperation=null;this.notify();}).then(()=>this.snapshot());this.inFlight=task;this.notify();return task;
 }
 release(){
  if(this.inFlight||this.record?.status==='uncertain'||this.record?.status==='applied-unverified')throw new Error('An active, uncertain or unverified range edit cannot be released.');
  if(this.record)this.archived.push(clone(this.record));this.record=null;return this.notify();
 }
}

/** Exact unit conversion, with no client quantization. The live range tool
 * accepts fractional milliseconds, but currently snaps cuts to its 1 ms grid.
 * Its returned cuts, rather than the requested input, describe actual edits.
 */
export function exactRangeMilliseconds(seconds){
 if(!finite(seconds)||seconds<0)throw new RangeError('Choose a finite non-negative audio range in seconds.');
 const milliseconds=seconds*1000;
 if(!Number.isFinite(milliseconds)||milliseconds>Number.MAX_SAFE_INTEGER)throw new RangeError('The audio range exceeds exact timeline millisecond indexing.');
 return milliseconds;
}
/** Internal seconds or frame DTO -> the two mutually exclusive live wire modes.
 * No unverified engine rate is substituted when frame sampleRate is absent.
 */
export function rangeEditBoundaryArguments(selection){
 if(!selection||typeof selection!=='object'||Array.isArray(selection))throw new RangeError('Choose exact audio range boundaries.');
 const frame=Object.hasOwn(selection,'startFrame')||Object.hasOwn(selection,'endFrame');
 if(frame){
  if(Object.hasOwn(selection,'startSec')||Object.hasOwn(selection,'endSec'))throw new RangeError('Choose either second or frame boundaries, never both.');
  const {startFrame,endFrame,sampleRate}=selection;
  if(!Number.isSafeInteger(startFrame)||startFrame<0||!Number.isSafeInteger(endFrame)||endFrame<0)throw new RangeError('Frame boundaries must be nonnegative safe integers.');
  if(sampleRate!==undefined&&(!finite(sampleRate)||sampleRate<8000||sampleRate>384000))throw new RangeError('A frame sample rate must be known and between 8000 and 384000 Hz.');
  return {start_frame:startFrame,end_frame:endFrame,...(sampleRate!==undefined?{sample_rate:sampleRate}:{})};
 }
 if(Object.hasOwn(selection,'sampleRate'))throw new RangeError('A source sample rate belongs with explicit frame boundaries.');
 return {start_ms:exactRangeMilliseconds(selection.startSec),end_ms:exactRangeMilliseconds(selection.endSec)};
}
/** Preserve the published actual-cut/skip reports without guessing nested keys. */
export function rangeEditReports(payload){
 const report={cuts:[],skippedLanes:[]};
 for(const [wire,internal]of [['cuts','cuts'],['skipped_lanes','skippedLanes']]){
  if(payload[wire]===undefined)continue;
  if(!Array.isArray(payload[wire])||payload[wire].some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error(`Freestyle returned an invalid ${wire} report.`);
  report[internal]=clone(payload[wire]);
 }
 return report;
}
const preflight=fn=>{try{return fn();}catch(error){error.definiteRejection=true;throw error;}};
const clipTiming=['start_ms','duration_sec','audio_offset_sec'];
/** Round-5 batch receipts report applied_ops as an integer (older: the op list). */
export function batchAppliedCount(payload){const value=payload?.applied_ops??payload?.appliedOps;if(Number.isSafeInteger(value)&&value>=0)return value;if(Array.isArray(value))return value.length;return null;}
/** 200 + postCommitError: committed, but a post-commit step (engine) failed. Never a failure, never re-applied. */
export function batchPostCommitError(payload){const value=payload?.postCommitError??payload?.post_commit_error;return value==null?null:typeof value==='string'?value:(value.message??value.code??JSON.stringify(value));}
export function validateRangeBatchOperations(operations,{allowEmpty=false}={}){
 assertCompleteCanonicalData(operations,'range inverse operations');
 if(!Array.isArray(operations)||operations.length>256||operations.length<(allowEmpty?0:1))throw new Error('The atomic clip batch requires 1–256 complete operations.');
 const identity=id=>text(id)&&id.length<=64;
 const timing=(value,label)=>{for(const key of Object.keys(value)){if(!clipTiming.includes(key))throw new Error(`${label} contains unsupported field ${key}.`);if(!finite(value[key])||value[key]<(key==='duration_sec'?Number.MIN_VALUE:0))throw new Error(`${label}.${key} is not valid canonical timing.`);}};
 for(const op of operations){
  if(!op||typeof op!=='object'||Array.isArray(op)||!['update','insert','remove','restore'].includes(op.op)||!identity(op.id))throw new Error('Each atomic clip operation requires a supported op and persisted identity.');
  for(const key of Object.keys(op))if(!['op','id','source_id','expected',...clipTiming].includes(key))throw new Error(`The audio batch does not support ${key}.`);
  if(op.source_id!==undefined&&!identity(op.source_id)||op.op==='insert'&&!identity(op.source_id))throw new Error('Insert requires a persisted same-audio source identity. An optional restore source must be valid.');
  timing(Object.fromEntries(clipTiming.filter(key=>Object.hasOwn(op,key)).map(key=>[key,op[key]])),'Clip operation');
  if(Object.hasOwn(op,'expected')){if(!op.expected||typeof op.expected!=='object'||Array.isArray(op.expected))throw new Error('Expected clip timing must be an object.');timing(op.expected,'Expected clip timing');}
 }
 return clone(operations);
}
/** Verify the acknowledged target state before enabling inverse history. A full
 * read can still be stale; completeness alone does not prove it reflects this
 * transaction. Source offsets are compared only when explicitly available.
 */
export function assertRangeAppliedState(clips,{operations=[],clipsAfter=[],inverseOps=[]}={}){
 assertCompleteCanonicalData(clips,'range canonical audio clips');
 if(!Array.isArray(clips))throw new Error('A complete canonical audio clip list is required after the range edit.');
 const identity=c=>c?.id??c?.clipId??c?.clip_id;
 const fields={start_ms:['start_ms','startMs'],duration_sec:['duration_sec','durationSec'],audio_offset_sec:['audio_offset_sec','audioOffsetSec'],lane_id:['lane_id','laneId']};
 const value=(c,key)=>{for(const alias of fields[key])if(c?.[alias]!==undefined&&c[alias]!==null)return c[alias];};
 const byId=new Map();for(const clip of clips){const id=identity(clip);if(!text(id)||byId.has(id))throw new Error('The canonical audio clip list has missing or duplicate identities.');byId.set(id,clip);}
 const present=id=>{const clip=byId.get(id);if(!clip)throw new Error('The canonical audio read has not reached the acknowledged range result. Refresh its checkpoint.');return clip;};
 const compare=(clip,expected)=>{for(const key of Object.keys(fields)){const target=value(expected,key);if(target===undefined)continue;const actual=value(clip,key);if(key==='lane_id'?actual!==target:!finite(actual)||!finite(target)||(key==='start_ms'&&Number.isSafeInteger(actual)&&Number.isSafeInteger(target)?actual!==target:Math.abs(actual-target)>Math.max(key==='start_ms'?1e-7:1e-10,4*Number.EPSILON*Math.max(1,Math.abs(actual),Math.abs(target)))))throw new Error('The canonical audio timing or lane differs from the acknowledged range result. Refresh its checkpoint.');}};
 if(!Array.isArray(operations)||!Array.isArray(clipsAfter)||!Array.isArray(inverseOps))throw new Error('The acknowledged range state is incomplete.');
 for(const clip of clipsAfter){const id=identity(clip);if(!text(id))throw new Error('The acknowledged audio clip has no durable identity.');compare(present(id),clip);}
 const final=new Map();for(const op of operations){
  if(!op||typeof op!=='object'||!['update','insert','remove','restore'].includes(op.op)||!text(op.id))throw new Error('The acknowledged range operations cannot verify their resulting state.');
  if(op.op==='remove')final.set(op.id,{present:false,timing:{}});
  else{const previous=final.get(op.id),timing=op.op==='update'&&previous?.present!==false?{...previous?.timing}:{};for(const key of clipTiming)if(Object.hasOwn(op,key))timing[key]=op[key];final.set(op.id,{present:true,timing});}
 }
 for(const [id,state]of final){if(!state.present){if(byId.has(id))throw new Error('A removed range clip is still present in the canonical read. Refresh its checkpoint.');}else compare(present(id),state.timing);}
 // The first inverse operation for each clip describes the starting post-state.
 // Later operations on that same identity may intentionally expect the result
 // of an earlier inverse operation, rather than the initial checkpoint.
 const inverseSeen=new Set();for(const op of inverseOps){if(inverseSeen.has(op.id))continue;inverseSeen.add(op.id);if(op.op==='restore'||op.op==='insert'){if(byId.has(op.id))throw new Error('The canonical read still contains a clip removed by the acknowledged range edit.');}else if(op.op==='remove'||op.op==='update')compare(present(op.id),op.expected||{});}

 return true;
}
export function unwrapRangeEditResult(result){
 let data=result?.structuredContent;
 if(data===undefined&&Array.isArray(result?.content)){try{data=JSON.parse(result.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{throw new Error('Freestyle returned an unreadable range-edit receipt.');}}
 data=data??result;const payload=data?.response??data;
 if(result?.isError||data?.ok===false||data?.error||payload?.ok===false||payload?.error||isIdempotencyInProgress(payload)){const reason=payload?.error||data?.error,error=new Error(reason?.message||reason?.detail||payload?.message||data?.message||String(reason||'The cloud range edit was rejected.'));error.result=clone(result);const status=Number(reason?.status??reason?.statusCode??payload?.status??payload?.statusCode??data?.status??data?.statusCode);if(status)error.status=status;error.code=reason?.code||payload?.code||data?.code;error.definiteRejection=definiteCloudRejection(error);throw error;}
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Object.keys(payload).length)throw new Error('Freestyle returned no usable range-edit acknowledgement.');
 assertCompleteCanonicalData(payload,'range edit receipt');return payload;
}
/** Exact published production mapping, deliberately excluding unsupported batch
 * idempotency keys and expected-project fields from the wire request. */
export function createFreestyleRangeAdapters({cloudCall,getTrackId=()=>undefined}={}){
 if(typeof cloudCall!=='function')throw new TypeError('A cloud tool callback is required.');
 const context=request=>{if(!text(request.projectId)||request.projectId.length>64)throw new Error('A valid captured cloud project is required.');const track=getTrackId(request.projectId);if(track!==undefined&&track!==null&&(!text(track)||track.length>64))throw new Error('A valid cloud track context is required.');return {project_id:request.projectId,...(track?{track_id:track}:{})};};
 const validate=(payload,request)=>{for(const key of ['project_id','projectId'])if(payload[key]!==undefined&&payload[key]!==request.projectId)throw new Error('Freestyle returned a range receipt for a different project.');for(const key of ['engine_reload_required','replay'])if(payload[key]!==undefined&&typeof payload[key]!=='boolean')throw new Error(`Freestyle returned an invalid ${key} acknowledgement.`);};
 return {
  async sendEdit(request){
   const args=preflight(()=>{
   const boundaries=rangeEditBoundaryArguments(request.selection),start=boundaries.start_frame??boundaries.start_ms,end=boundaries.end_frame??boundaries.end_ms;
   if(end<start||request.operation!=='split'&&end===start)throw new Error('Choose an ordered non-empty audio selection; Split also accepts a cursor.');
   if(!Array.isArray(request.laneIds)||!request.laneIds.length||request.laneIds.length>64||request.laneIds.some(id=>!text(id)||id.length>64)||new Set(request.laneIds).size!==request.laneIds.length)throw new Error('Choose 1–64 distinct persisted audio lanes.');
   if(!text(request.idempotencyKey)||request.idempotencyKey.length>128)throw new Error('Retain an idempotency key with at most 128 characters.');
   const operation={'trim-to-selection':'trim_to_selection',split:'split',delete:'delete'}[request.operation];if(!operation||typeof request.ripple!=='boolean'||typeof request.dryRun!=='boolean')throw new Error('Choose a supported explicit audio range operation.');
   return {...context(request),lane_ids:[...request.laneIds],operation,...boundaries,ripple:request.ripple,idempotency_key:request.idempotencyKey,dry_run:request.dryRun};});
   const raw=await cloudCall('edit_time_range',args);
   try{
    const payload=unwrapRangeEditResult(raw);validate(payload,request);const reports=rangeEditReports(payload);
    if(request.dryRun)return {status:'previewed',projectId:request.projectId,idempotencyKey:request.idempotencyKey,plan:clone(payload),sourceReceipt:clone(raw),...reports};
    if(!Array.isArray(payload.clips_after)||payload.clips_after.some(clip=>!clip||typeof clip!=='object'||Array.isArray(clip))||!Array.isArray(payload.undo?.inverse_ops))throw new Error('Freestyle did not return complete clips_after and undo.inverse_ops for the atomic range edit.');
    const inverseOps=validateRangeBatchOperations(payload.undo.inverse_ops,{allowEmpty:true}),noOp=Array.isArray(payload.ops)&&payload.ops.length===0&&inverseOps.length===0;
    return {status:'applied',projectId:request.projectId,idempotencyKey:request.idempotencyKey,inverseOps,noOp,sourceReceipt:clone(raw),payload:clone(payload),...reports};
   }catch(error){if(error.result===undefined)error.result=clone(raw);throw error;}
  },
  async sendBatch(request){
   const args=preflight(()=>{if(request.idempotencyKey!==undefined&&(!text(request.idempotencyKey)||request.idempotencyKey.length>128))throw new Error('Retain a valid atomic batch idempotency key.');return {...context(request),ops:validateRangeBatchOperations(request.operations),...(request.idempotencyKey!==undefined?{idempotency_key:request.idempotencyKey}:{})};});
   const raw=await cloudCall('apply_clip_batch',args),payload=unwrapRangeEditResult(raw);validate(payload,request);
   const inverse=payload.undo?.inverse_ops??undefined;/* replays may carry null: the original intent's inverse is used */
   return {status:'applied',projectId:request.projectId,appliedOps:batchAppliedCount(payload),postCommitError:batchPostCommitError(payload),inverseOps:inverse===undefined?null:validateRangeBatchOperations(inverse,{allowEmpty:true}),sourceReceipt:clone(raw),payload:clone(payload),...(inverse===undefined?{historyUnavailableReason:'The cloud batch completed, but returned no exact inverse receipt. Redo requires the engine to return that inverse.'}:{})};
  }
 };
}
