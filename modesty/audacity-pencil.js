import {isIdempotencyInProgress,retainInProgress,captureWriteRequest,replayKnownBusyWrite} from './cloud-errors.js';
import {amplitudeAtY} from './audacity-amplitude.js';
const clone=value=>structuredClone(value),finite=Number.isFinite;
const revision=value=>{if(typeof value!=='string'||!/^[a-f0-9]{16}$/.test(value))throw new Error('Pencil editing needs the exact cloud source revision.');return value;};
const integer=(value,label,min=0)=>{if(!Number.isSafeInteger(value)||value<min)throw new Error(`${label} must be an integer ≥ ${min}.`);return value;};
const opaque=(value,label)=>{if(typeof value!=='string'||!value.length||value.length>64)throw new Error(`A durable ${label} is required.`);return value;};
const noApplyCodes=new Set(['revision_conflict','source_changed','source_encrypted_unsupported','source_not_durable','edit_in_progress','invalid_arguments','invalid_params','validation_error','clip_not_found','not_found','clip_not_loaded','no_undo_history','no_undo_steps']);
/** CloudSession unpacks MCP error envelopes into error.result, so a tool
 * rejection can arrive over HTTP 200 without error.status or isError. Only
 * documented precondition rejections establish that no source was written. */
export function pencilDefinitelyRejected(error){
 if(isIdempotencyInProgress(error))return false;
 if([400,401,403,404,409,412,413,422,429].includes(Number(error?.status)))return true;
 let result=error?.result;if(result?.structuredContent)result=result.structuredContent;
 if(Array.isArray(result?.content)){try{result=JSON.parse(result.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{return false;}}
 const response=result?.response??result,codes=[error?.code,response?.code,response?.error?.code,result?.code,result?.error?.code];
 return codes.some(code=>noApplyCodes.has(code));
}
const errorCodes=error=>{let result=error?.result;if(result?.structuredContent)result=result.structuredContent;if(Array.isArray(result?.content)){try{result=JSON.parse(result.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{result=null;}}const response=result?.response??result;return [error?.code,response?.code,response?.error?.code,result?.code,result?.error?.code].filter(code=>typeof code==='string');};
export const PENCIL_SOURCE_NOT_SYNCHRONIZED='The audio source is not synchronized yet. No samples were changed. Reopen this project, reload its waveform, then draw again.';
/** A definitely rejected initial stroke with 409 source_changed (known engine
 * issue right after import) gets actionable guidance. Undo/Redo conflicts and
 * every other outcome keep their original error. The raw code, receipt and
 * retained operation stay attached; nothing is resent or registered. */
export function pencilUserError(error){
 const operation=error?.pencilOperation;if(operation?.direction!=='edit'||operation.status!=='rejected'||!errorCodes(error).includes('source_changed'))return error;
 return Object.assign(new Error(PENCIL_SOURCE_NOT_SYNCHRONIZED,{cause:error}),{code:'source_changed',status:error.status,result:error.result,pencilOperation:operation,upstreamMessage:error.message});
}
export const pencilSourceKey=source=>JSON.stringify(['clipId','sampleRate','channelCount','frameCount','clipOffsetFrames','clipFrameCount','startMs','gain'].map(key=>source?.[key]));
export function validatePencilEdits(edits,{sampleRate,channelCount,frameCount}={}){
 integer(sampleRate,'Source sample rate',1);integer(channelCount,'Source channel count',1);integer(frameCount,'Source frame count',1);
 if(!Array.isArray(edits)||!edits.length||edits.length>64)throw new Error('A pencil stroke must contain 1–64 source ranges.');
 let total=0;const ranges=new Map(),result=edits.map(edit=>{
  const channel=integer(edit?.channel,'Source channel'),start=integer(edit?.start_frame,'First source frame');
  if(channel>=channelCount||!Array.isArray(edit.values)||!edit.values.length||start+edit.values.length>frameCount)throw new Error('The pencil stroke exceeds its source channel or frame range.');
  const values=edit.values.map(value=>{if(typeof value!=='number'||!finite(value)||value< -1||value>1)throw new Error('Pencil values must be finite raw PCM between -1 and 1.');return Math.fround(value);});
  total+=values.length;const same=ranges.get(channel)??[];if(same.some(([first,last])=>start<last&&start+values.length>first))throw new Error('Pencil ranges on one channel cannot overlap.');same.push([start,start+values.length]);ranges.set(channel,same);return {channel,start_frame:start,values};
 });if(total>sampleRate)throw new Error('One pencil stroke may change at most one second of source samples.');return result;
}
/** Invert the actual waveform projection, including clip gain and automation.
 * A zero-gain envelope has no reversible visible-to-source mapping. */
export function pencilValueAtY({y,height,display,gain=1}={}){
 if(!finite(gain)||gain<=0)throw new Error('Raise the clip gain or envelope above zero before drawing samples.');
 return Math.fround(Math.max(-1,Math.min(1,amplitudeAtY(y,height,display)/gain)));
}
/** One channel, source-frame stroke. Pointer segments fill every crossed real
 * sample; retracing replaces prior values and never creates duplicate ranges. */
export class PencilStroke{
 constructor({tile,channel,startFrame,y,height,display,gainAtFrame=()=>tile.gain}={}){
  if(!tile||tile.bucketCount!==tile.endFrame-tile.startFrame||!tile.channels?.every(row=>row.min?.every((value,index)=>value===row.max[index])))throw new Error('Zoom in until the cloud waveform shows individual source samples before drawing.');
  revision(tile.revision);integer(channel,'Source channel');if(channel>=tile.channelCount)throw new Error('The source channel is unavailable.');
  this.tile=tile;this.channel=channel;this.height=height;this.display=clone(display);this.gainAtFrame=gainAtFrame;this.values=new Map();this.last=null;this.add(startFrame,y);
 }
 bounds(){return {first:Math.max(this.tile.startFrame,this.tile.clipOffsetFrames),last:Math.min(this.tile.endFrame,this.tile.clipOffsetFrames+this.tile.clipFrameCount)-1};}
 add(frame,y){
  if(!Number.isSafeInteger(frame))throw new Error('The source frame must be an integer.');if(!finite(y))throw new Error('The pencil pointer position is unavailable.');const {first,last}=this.bounds();frame=Math.max(first,Math.min(last,frame));if(last<first)throw new Error('No editable source sample is visible.');
  const previous=this.last??{frame,y},step=frame>=previous.frame?1:-1,count=Math.abs(frame-previous.frame),next=new Map(this.values);
  if(count+1>this.tile.sampleRate)throw new Error('One pencil stroke may change at most one second of source samples.');
  for(let index=0;index<=count;index++){const sourceFrame=previous.frame+index*step,position=count?previous.y+(y-previous.y)*index/count:y;next.set(sourceFrame,pencilValueAtY({y:position,height:this.height,display:this.display,gain:this.gainAtFrame(sourceFrame)}));}
  if(next.size>this.tile.sampleRate)throw new Error('One pencil stroke may change at most one second of source samples.');this.values=next;this.last={frame,y};return this;
 }
 edits(){
  const ordered=[...this.values].sort((a,b)=>a[0]-b[0]),ranges=[];
  for(const [frame,value]of ordered){const last=ranges.at(-1);if(last&&last.start_frame+last.values.length===frame)last.values.push(value);else ranges.push({channel:this.channel,start_frame:frame,values:[value]});}
  return validatePencilEdits(ranges,this.tile);
 }
 changed(){return this.edits().some(edit=>edit.values.some((value,index)=>value!==this.tile.channels[edit.channel].min[edit.start_frame+index-this.tile.startFrame]));}
 preview(){const result={...this.tile,channels:this.tile.channels.map(row=>({...row,min:[...row.min],max:[...row.max],rms:[...row.rms]}))};for(const [frame,value]of this.values){const row=result.channels[this.channel],index=frame-this.tile.startFrame;row.min[index]=value;row.max[index]=value;row.rms[index]=Math.abs(value);}return result;}
}
export function unwrapPencilReceipt(raw){
 if(raw?.isError)throw Object.assign(new Error('Freestyle rejected the pencil edit.'),{result:raw});let data=raw?.structuredContent??raw;
 if(data===raw&&Array.isArray(raw?.content)){try{data=JSON.parse(raw.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{throw new Error('Freestyle returned no pencil receipt.');}}
 data=data?.response??data;if(!data||data.ok===false||data.error||isIdempotencyInProgress(data))throw Object.assign(new Error(typeof data?.error==='string'?data.error:data?.message||'Freestyle rejected the pencil edit.'),{result:raw});return data;
}
/** Receipt-owned native sample history. Explicit Verify may poll only a known
 * running intent with its immutable original key. Unknown outcomes stay read-
 * only; audio is never written optimistically. */
export class PencilController{
 constructor({captureContext,assertContext,readSource,write,refresh=async()=>{},refreshSource=null,onWarning=()=>{},onRegistered=()=>{},onReconciled=()=>{},key=()=>crypto.randomUUID()}={}){Object.assign(this,{captureContext,assertContext,readSource,write,refresh,refreshSource,onWarning,onRegistered,onReconciled,key});this.past=new Map();this.future=new Map();this.receipts=new Map();this.pending=new Map();}
 stack(map,id=this.captureContext().projectId){if(!map.has(id))map.set(id,[]);return map.get(id);}
 clearFuture(id){this.stack(this.future,id).length=0;}
 uncertain(id=this.captureContext().projectId){return this.pending.get(id)?.status==='uncertain';}
 unverified(id=this.captureContext().projectId){return this.pending.has(id)&&!this.uncertain(id);}
 async source(context,clipId,expected,geometry){this.assertContext(context);const value=await this.readSource(context,clipId);this.assertContext(context);if(value.clipId!==clipId||value.revision!==expected||geometry&&pencilSourceKey(value)!==geometry)throw new Error('The cloud audio source or placement changed. Refresh its waveform before drawing or using pencil history.');return value;}
 async commit({clipId,source,edits}={}){
  const context=clone(this.captureContext()),id=context.projectId;if(this.pending.has(id))throw new Error('Verify the pending pencil edit before drawing another stroke.');opaque(clipId,'clip id');const expected=revision(source?.revision),validated=validatePencilEdits(edits,source),geometry=pencilSourceKey(source);
  await this.source(context,clipId,expected,geometry);
  const entry={context,clipId,source:clone(source),geometry,edits:validated,beforeRevision:expected,currentRevision:expected,status:'preparing',attempts:[]};this.stack(this.receipts,id).push(entry);const request=captureWriteRequest('edit_clip_samples',{project_id:id,track_id:clipId,clip_id:clipId,expected_revision:expected,edits:validated,idempotency_key:this.key()}),operation={entry,direction:'edit',name:request.name,arguments:request.arguments,request,status:'sending'};
  this.pending.set(id,operation);return this.run(operation);
 }
 async history(direction){
  if(!['undo','redo'].includes(direction))throw new Error('Choose pencil Undo or Redo.');const context=this.captureContext(),id=context.projectId;if(this.pending.has(id))throw new Error('Verify the pending pencil edit before using history.');const from=this.stack(direction==='undo'?this.past:this.future,id),entry=from.at(-1);if(!entry)return false;this.assertContext(entry.context);
  await this.source(entry.context,entry.clipId,entry.currentRevision,entry.geometry);
  const request=captureWriteRequest(direction==='undo'?'undo_clip_sample_edit':'edit_clip_samples',{project_id:id,track_id:entry.clipId,clip_id:entry.clipId,expected_revision:entry.currentRevision,...(direction==='redo'?{edits:clone(entry.edits)}:{}),idempotency_key:this.key()}),operation={entry,direction,name:request.name,arguments:request.arguments,request,status:'sending'};this.pending.set(id,operation);return this.run(operation);
 }
 async run(operation,{reconcile=false}={}){
  const entry=operation.entry,c=entry.context,id=c.projectId;let dispatching=false;this.assertContext(c);
  try{
   if(!operation.receipt){
    if(reconcile&&!operation.idempotencyInProgress){operation.reconciledReadback=clone(await this.readSource(c,entry.clipId));this.assertContext(c);throw new Error('The pencil response was ambiguous. Its source readback and original request are retained; verification does not resend an unconfirmed write.');}
    const attempt={name:operation.name,arguments:clone(operation.arguments),status:'sending'};entry.attempts.push(attempt);dispatching=true;let raw,receipt;
    try{if(reconcile){({raw,receipt}=await replayKnownBusyWrite({knownBusy:operation.idempotencyInProgress===true,request:operation.request,call:(name,args)=>this.write(name,args,c),assertCurrent:()=>this.assertContext(c),parse:unwrapPencilReceipt}));}else{operation.status='sending';entry.status='sending';raw=await this.write(operation.name,clone(operation.arguments),c);receipt=unwrapPencilReceipt(raw);}attempt.raw=clone(raw);attempt.status='acknowledged';}
    catch(error){retainInProgress(attempt,error);attempt.status='uncertain';attempt.error=error.message;if(error.result!==undefined)attempt.raw=clone(error.result);throw error;}
    operation.raw=clone(raw);operation.receipt=clone(receipt);operation.idempotencyInProgress=false;entry.idempotencyInProgress=false;for(const row of entry.attempts)row.idempotencyInProgress=false;operation.status='applied-unverified';entry.status='applied-unverified';this.assertContext(c);
   }
   const receipt=operation.receipt,newRevision=revision(receipt.revision);if(receipt.clip_id!==undefined&&receipt.clip_id!==entry.clipId)throw new Error('The pencil receipt belongs to another clip.');
   if(operation.direction!=='undo'){
    if(receipt.previous_revision!==operation.arguments.expected_revision||receipt.undo?.clip_id!==entry.clipId||receipt.undo?.expected_revision!==newRevision)throw new Error('The pencil receipt does not prove its previous source and one-step Undo.');
   }else if(newRevision!==entry.beforeRevision)throw new Error('Pencil Undo did not restore the captured source revision.');
   // Audacity-style local commit: the validated ACK revision chain is the proof.
   // Only the edited source is refetched, in the background, keeping the drawn/old
   // samples on screen; no project/native/automation refresh; a mismatch warns.
   if(typeof this.refreshSource==='function'){if(receipt.engine_reload_required!==true){const geometry=entry.geometry;Promise.resolve().then(()=>this.refreshSource(c,entry.clipId,newRevision)).then(tile=>{if(tile&&(tile.revision!==newRevision||geometry&&pencilSourceKey(tile)!==geometry))this.onWarning('The redrawn audio source differs from the saved sample edit (revision '+tile.revision+'). Reload this clip’s waveform before drawing again.');},error=>{if(error?.name!=='AbortError')this.onWarning('The sample edit is saved; its refreshed waveform could not be read yet ('+error.message+').');});}}
   else{await this.refresh(c,entry.clipId);this.assertContext(c);await this.source(c,entry.clipId,newRevision,entry.geometry);}
   if(receipt.engine_reload_required===true)throw new Error('The sample edit is saved, but its live audio needs an engine reload. Its receipt is retained; playback remains blocked until verified.');
   if(reconcile&&operation.direction!=='edit')this.onReconciled(operation);
   if(operation.direction==='edit'){this.stack(this.past,id).push(entry);this.clearFuture(id);this.onRegistered(entry);}
   else{const from=this.stack(operation.direction==='undo'?this.past:this.future,id),to=this.stack(operation.direction==='undo'?this.future:this.past,id);if(from.at(-1)!==entry)throw new Error('Pencil history changed before its receipt was verified.');from.pop();to.push(entry);}
   entry.currentRevision=newRevision;entry.status=operation.direction==='undo'?'undone':'applied';operation.status='verified';this.pending.delete(id);return entry;
  }catch(error){if(dispatching&&!operation.receipt){retainInProgress(operation,error);retainInProgress(entry,error);}operation.error=entry.error=error.message;const rejected=!reconcile&&dispatching&&!operation.receipt&&pencilDefinitelyRejected(error);operation.status=operation.receipt?'applied-unverified':rejected?'rejected':'uncertain';entry.status=operation.status;if(rejected)this.pending.delete(id);throw Object.assign(error,{pencilOperation:operation});}
 }
 async reconcile(){const operation=this.pending.get(this.captureContext().projectId);if(!operation)return null;return this.run(operation,{reconcile:true});}
}
