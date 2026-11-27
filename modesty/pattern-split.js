import {isIdempotencyInProgress} from './cloud-errors.js';
/** Atomic cloud pattern-placement splits, with their own explicit undo receipt. */
const clone=value=>value==null?value:structuredClone(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=64;
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const projectIdentity=project=>project?.cloud?.projectId||project?.id;
const placementIdentity=placement=>placement?.cloudId||placement?.id||placement?.placement_id;
const detail=value=>typeof value==='string'?value:value?.message||value?.detail||'Freestyle rejected the pattern split.';

export function unwrapPatternSplit(result){
 let data=result?.structuredContent;
 if(data===undefined&&Array.isArray(result?.content)){
  try{data=JSON.parse(result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'));}
  catch{throw new Error('Freestyle returned an unreadable pattern-split receipt.');}
 }
 data=data??result;const payload=data?.response??data;
 if(result?.isError||data?.ok===false||data?.error||payload?.ok===false||payload?.error){const reason=payload?.error||data?.error;const error=new Error(detail(reason||payload?.message||data?.message));error.cloudRejected=true;error.result=clone(result);error.status=Number(reason?.status??reason?.statusCode??payload?.statusCode??payload?.status??data?.statusCode??data?.status)||undefined;error.code=reason?.code??payload?.code??data?.code;throw error;}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Freestyle returned no usable pattern-split receipt.');
 return payload;
}

/** Seconds are rounded once to the native integer millisecond timeline. */
export function patternSplitMilliseconds(seconds){
 if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0)throw new RangeError('Choose a finite timeline position in seconds.');
 const milliseconds=Math.round(seconds*1000);
 if(!Number.isSafeInteger(milliseconds))throw new RangeError('The timeline position exceeds the supported millisecond range.');
 return milliseconds;
}

function placementWindow(placement,project){
 const raw=placement?.cloudRaw||placement;
 const start=raw?.startMs??raw?.start_ms;
 const duration=raw?.durationMs??raw?.duration_ms;
 const offset=raw?.offsetMs??raw?.offset_ms??0;
 const window=raw?.windowMs??raw?.window_ms;
 const repeat=raw?.repeatCount??raw?.repeat_count??1;
 let startMs=Number(start),lengthMs=Number(window);
 if(start===undefined&&typeof placement?.start==='number'&&Number(project?.bpm)>0)startMs=placement.start*60000/Number(project.bpm);
 if(!(Number.isFinite(lengthMs)&&lengthMs>0)){
  if(duration!==undefined&&Number.isFinite(Number(duration))&&Number(duration)>0&&Number.isFinite(Number(repeat))&&Number(repeat)>=1&&Number.isFinite(Number(offset))&&Number(offset)>=0)lengthMs=Number(duration)*Number(repeat)-Number(offset);
  else if(typeof placement?.length==='number'&&Number(project?.bpm)>0)lengthMs=placement.length*60000/Number(project.bpm);
 }
 if(!Number.isFinite(startMs)||startMs<0||!Number.isFinite(lengthMs)||lengthMs<=0)throw new Error('The canonical pattern placement timing is unavailable.');
 const signature=JSON.stringify([placementIdentity(placement),raw?.patternId??raw?.pattern_id??placement?.patternId,raw?.laneId??raw?.lane_id??placement?.laneId,startMs,lengthMs,duration,offset,repeat,window]);
 return {startMs,lengthMs,signature};
}

function assertProject(value,expected){
 for(const key of ['projectId','project_id'])if(value?.[key]!==undefined&&value[key]!==expected)throw new Error('Freestyle returned a pattern-split receipt from a different project.');
}
function assertPlacement(value,expected,project){
 if(!value||typeof value!=='object'||placementIdentity(value)!==expected)throw new Error('Freestyle returned a different pattern placement identity.');
 assertProject(value,project);
}
function validateBefore(before){
 if(!before||typeof before!=='object'||Array.isArray(before)||!own(before,'windowMs')||!own(before,'envelopes'))throw new Error('Freestyle did not return the original placement window and automation undo snapshot.');
 if(before.windowMs!==null&&(typeof before.windowMs!=='number'||!Number.isFinite(before.windowMs)||before.windowMs<0))throw new Error('Freestyle returned an invalid original placement window.');
 if(!before.envelopes||typeof before.envelopes!=='object'||Array.isArray(before.envelopes))throw new Error('Freestyle did not return the original placement automation envelopes.');
}

export function validatePatternSplitReceipt(payload,receipt,{undo=false}={}){
 if(payload.projectId!==receipt.projectId||payload.placementId!==receipt.placementId)throw new Error('Freestyle returned a pattern-split receipt for a different project or placement.');
 assertProject(payload,receipt.projectId);
 if(undo){
  // The undo response contract is deliberately checked separately from split.
  const restored=payload.left;
  assertPlacement(restored,receipt.placementId,receipt.projectId);
  if(payload.right!==null||payload.undone!==true)throw new Error('Freestyle did not confirm removal of the child placement and restoration of the original.');
  validateBefore(payload.before);
  if(restored.windowMs!==receipt.before.windowMs)throw new Error('Freestyle did not restore the captured original placement window.');
  return {restored:clone(restored)};
 }
 if(payload.undone!==false||payload.cutMs!==receipt.cutMs)throw new Error('Freestyle did not confirm the captured split position.');
 assertPlacement(payload.left,receipt.placementId,receipt.projectId);assertPlacement(payload.right,receipt.childId,receipt.projectId);validateBefore(payload.before);
 return {left:clone(payload.left),right:clone(payload.right),before:clone(payload.before)};
}

function rejection(error){
 if(isIdempotencyInProgress(error))return 'uncertain';
 if(Number(error?.status)===409||error?.code==='conflict'||error?.code==='already_exists')return 'conflict';
 if(error?.result!==undefined){try{unwrapPatternSplit(error.result);}catch(decoded){if(Number(decoded.status)===409||decoded.code==='conflict'||decoded.code==='already_exists')return 'conflict';if(decoded.cloudRejected)return 'rejected';}}
 if(error?.cloudRejected)return 'rejected';
 return [400,401,403,404,422].includes(Number(error?.status))?'rejected':'uncertain';
}

export class PatternSplitController {
 constructor({getProject,getPlacement,getCursorSec,flush=async()=>{},cloudCall,refresh=async()=>{},onChange=()=>{},isBusy=()=>false,isInteracting=()=>false,createChildId=()=>globalThis.crypto.randomUUID()}={}){
  if(typeof getProject!=='function'||typeof getPlacement!=='function'||typeof cloudCall!=='function')throw new TypeError('PatternSplitController requires project, placement and cloud callbacks.');
  Object.assign(this,{getProject,getPlacement,getCursorSec,flush,cloudCall,refresh,onChange,isBusy,isInteracting,createChildId});this.inFlight=null;
  this.state={status:'idle',operation:null,applied:null,receipt:null,result:null,error:null,refreshError:null};
 }
 snapshot(){const same=this.state.receipt?.projectId===projectIdentity(this.getProject()),available=!this.inFlight&&this.state.status!=='uncertain';return {...clone(this.state),canUndo:!!(same&&available&&this.state.applied==='split'),canRedo:!!(same&&available&&this.state.applied==='undone')};}
 notify(){const snapshot=this.snapshot();this.onChange(snapshot);return snapshot;}
 guard(){if(this.isBusy())throw new Error('Wait for the current cloud operation before splitting a pattern.');if(this.isInteracting())throw new Error('Finish the current edit before splitting a pattern.');}
 capture({cursorSec=this.getCursorSec?.()}={}){
  const project=this.getProject(),placement=this.getPlacement(),projectId=projectIdentity(project),placementId=placementIdentity(placement);
  if(!validId(projectId)||!validId(placementId))throw new Error('Select a persisted pattern placement in a cloud project.');
  if(!placement?.patternId&&!placement?.pattern_id&&!placement?.cloudRaw?.patternId&&!placement?.cloudRaw?.pattern_id)throw new Error('Select a pattern placement before splitting.');
  const window=placementWindow(placement,project),cutMs=patternSplitMilliseconds(cursorSec);
  if(cutMs<=window.startMs||cutMs>=window.startMs+window.lengthMs)throw new RangeError('The rounded split position must be strictly inside the pattern placement.');
  const childId=this.createChildId();if(!uuid(childId)||childId===placementId)throw new Error('A distinct UUID is required for the new placement.');
  return {projectId,placementId,cutMs,childId,window,creationAttempted:false,before:null,left:null,right:null};
 }
 assertScope(receipt,{selected=false}={}){
  if(projectIdentity(this.getProject())!==receipt.projectId)throw new Error('Return to the captured project before continuing this pattern split.');
  if(selected){const placement=this.getPlacement();if(placementIdentity(placement)!==receipt.placementId||placementWindow(placement,this.getProject()).signature!==receipt.window.signature)throw new Error('The selected pattern placement changed while pending edits were saved.');}
 }
 split(options={}){
  if(this.inFlight){if(this.state.operation==='split')return this.inFlight;return Promise.reject(new Error('A pattern split history operation is already in progress.'));}
  if(this.state.status==='uncertain')return Promise.reject(new Error('The previous pattern split is uncertain. Inspect the cloud placements before another operation.'));
  if(this.state.applied)return Promise.reject(new Error('This controller already owns a pattern split. Use its explicit undo or redo.'));
  this.guard();const receipt=this.capture(options);this.state.receipt=receipt;return this.perform('split');
 }
 undo(){return this.history('undo','split');}
 redo(){return this.history('redo','undone');}
 history(operation,expected){
  if(this.inFlight){if(this.state.operation===operation)return this.inFlight;return Promise.reject(new Error('A pattern split operation is already in progress.'));}
  if(this.state.status==='uncertain'||this.state.applied!==expected)return Promise.reject(new Error(`A verified ${expected==='split'?'split':'undo'} receipt is required before ${operation}.`));
  this.guard();this.assertScope(this.state.receipt);return this.perform(operation);
 }
 perform(operation){
  const receipt=this.state.receipt;this.state.status=operation==='split'?'splitting':operation==='undo'?'undoing':'redoing';this.state.operation=operation;this.state.error=null;this.state.refreshError=null;
  const task=Promise.resolve().then(async()=>{
   let dispatched=false;
   try{
    await this.flush();this.guard();this.assertScope(receipt,{selected:operation==='split'});
    const args={project_id:receipt.projectId,placement_id:receipt.placementId,child_id:receipt.childId,...(operation==='undo'?{undo:true,before:clone(receipt.before)}:{cut_ms:receipt.cutMs})};
    receipt.creationAttempted=true;dispatched=true;const raw=await this.cloudCall('split_pattern_placement',args);this.state.result=clone(raw);const payload=unwrapPatternSplit(raw),validated=validatePatternSplitReceipt(payload,receipt,{undo:operation==='undo'});
    if(operation==='undo')this.state.applied='undone';else{Object.assign(receipt,validated);this.state.applied='split';}
    this.state.status=this.state.applied;
    // Refresh can only affect the still-active captured project. A refresh error
    // never turns an acknowledged commit into a retryable mutation failure.
    if(projectIdentity(this.getProject())===receipt.projectId){try{await this.refresh({projectId:receipt.projectId,placementId:receipt.placementId,childId:receipt.childId,operation},clone(payload));}catch(error){this.state.refreshError=error.message||String(error);}}
    this.inFlight=null;return this.snapshot();
   }catch(error){if(error.result)this.state.result=clone(error.result);const classification=dispatched?rejection(error):'rejected';this.state.status=classification==='rejected'?'failed':'uncertain';this.state.error=classification==='conflict'?`${error.message} The child identity may already exist. Inspect the cloud placements; this operation will not be retried.`:error.message;throw error;}
   finally{this.inFlight=null;this.notify();}
  });this.inFlight=task;this.notify();return task;
 }
}
