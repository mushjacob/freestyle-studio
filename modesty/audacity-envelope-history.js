import {retainInProgress,isIdempotencyInProgress,captureWriteRequest,replayKnownBusyWrite} from './cloud-errors.js';
import {automationWrite} from './automation-ui.js';
import {assertAutomationJsonValue,assertAutomationWritePreservesData,automationReadbackDifferences,LEGACY_AUTOMATION_CONTRACT} from './audacity-automation-contract.js';
import {assertCompleteCanonicalData} from './cloud-session.js';
const copy=value=>structuredClone(value);
const own=(value,key)=>Object.hasOwn(value,key);
const windowKey=window=>JSON.stringify(['clipId','timelineStartSec','durationSec','pointStartSec','pointEndSec','timeDomain','sourceStartSec','sourceEndSec','sourceDurationSec','offsetKnown','waveformRevision'].map(key=>window?.[key]));
function validate(envelope){assertAutomationJsonValue(envelope);assertCompleteCanonicalData(envelope,'envelope history state');if(!envelope||envelope.target?.kind!=='clip_gain'||typeof envelope.clipId!=='string'||!Array.isArray(envelope.points)||typeof envelope.persisted!=='boolean'||!Number.isSafeInteger(envelope.revision)||envelope.revision<0||envelope.persisted&&(typeof envelope.id!=='string'||!envelope.id))throw new Error('Envelope history requires complete canonical clip-gain identity and revision.');return envelope;}
export function envelopeHistoryMatches(actual,expected,{identity=true}={}){
 try{validate(actual);validate(expected);}catch{return false;}
 if(actual.persisted!==expected.persisted||actual.clipId!==expected.clipId)return false;
 const args={clip_id:expected.clipId,target:expected.target,points:expected.points};for(const [wire,key]of [['default_value','defaultValue'],['value_type','valueType']]){if(own(actual,key)!==own(expected,key))return false;if(own(expected,key))args[wire]=expected[key];}
 if(automationReadbackDifferences(args,actual).length)return false;
 return !identity||actual.revision===expected.revision&&(!expected.persisted||actual.id===expected.id);
}
function unwrap(raw){assertAutomationJsonValue(raw);let data=raw?.structuredContent??raw;if(data===raw&&Array.isArray(raw?.content))data=JSON.parse(raw.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));const value=data?.response??data;if(raw?.isError||data?.error||data?.ok===false||value?.error||value?.ok===false||isIdempotencyInProgress(raw))throw Object.assign(new Error(typeof value?.error==='string'?value.error:value?.message||'Freestyle rejected envelope history.'),{receipt:raw,result:raw});return value;}

/** Exact clip-gain history, separate from unregistered legacy engine Undo.
 * Snapshot identities never get overwritten; expected is rebased only after
 * our own verified restore. No failed/ambiguous mutation is retried.
 */
export class EnvelopeHistoryController{
 constructor({captureContext,assertContext,getClip,getBinding,resolveWindow,read,cloudCall,prepareWrite=async()=>{},getContract=()=>LEGACY_AUTOMATION_CONTRACT}={}){Object.assign(this,{captureContext,assertContext,getClip,getBinding,resolveWindow,read,cloudCall,prepareWrite,getContract});this.past=new Map();this.future=new Map();this.receipts=new Map();this.pending=new Map();this.registered=new Map();this.active=false;}
 stack(map,id=this.captureContext().projectId){if(!map.has(id))map.set(id,[]);return map.get(id);}
 clearFuture(id=this.captureContext().projectId){this.stack(this.future,id).length=0;}
 uncertain(id=this.captureContext().projectId){return this.pending.get(id)?.status==='uncertain';}
 unverified(id=this.captureContext().projectId){return ['unverified','sending','acknowledged'].includes(this.pending.get(id)?.status);}
 register(receipt){
  if(receipt?.status!=='verified'||!receipt.before||!receipt.after)throw new Error('Only a verified envelope save with exact before/after states can own Undo.');validate(receipt.before);validate(receipt.after);if(!receipt.after.persisted||receipt.before.clipId!==receipt.after.clipId)throw new Error('The verified envelope receipt changed its target.');
  const context=this.captureContext();this.assertContext(context);if(context.projectId!==receipt.projectId)throw new Error('The envelope history receipt belongs to another project.');
  const key=JSON.stringify([receipt.projectId,receipt.after.id,receipt.after.revision]);if(this.registered.has(key))return {entry:this.registered.get(key),added:false};const clip=this.getClip(receipt.clipId);if(!clip||windowKey(this.resolveWindow(clip))!==windowKey(receipt.window))throw new Error('The envelope source window changed before history registration.');
  const entry={context:copy(context),clipId:receipt.clipId,binding:this.getBinding(clip),window:copy(receipt.window),before:copy(receipt.before),after:copy(receipt.after),expected:copy(receipt.after),receipt:copy(receipt),operations:[]};this.stack(this.past,context.projectId).push(entry);this.clearFuture(context.projectId);this.registered.set(key,entry);return {entry,added:true};
 }
 check(entry){this.assertContext(entry.context);const clip=this.getClip(entry.clipId);if(!clip||this.getBinding(clip)!==entry.binding||windowKey(this.resolveWindow(clip))!==windowKey(entry.window))throw new Error('The clip placement or audio source changed since this envelope edit.');return clip;}
 desired(entry,direction){return direction==='undo'?entry.before:entry.after;}
 write(entry,current,desired){
  if(!desired.persisted){if(!current.persisted)throw new Error('The envelope is already absent.');return {name:'delete_automation',arguments:{project_id:entry.context.projectId,envelope_id:current.id,expected_revision:current.revision,confirm:true}};}
  assertAutomationWritePreservesData({points:desired.points,envelope:desired,window:entry.window,contract:this.getContract()});
  for(const key of ['defaultValue','valueType'])if(!own(desired,key)&&own(current,key))throw new Error('The API cannot restore an unknown optional envelope field by omitting its current value.');
  const base={...copy(desired),persisted:current.persisted,id:current.id,revision:current.revision};return automationWrite(base,desired.points,entry.context.projectId);
 }
 applied(record,actual){
  if(!envelopeHistoryMatches(actual,record.desired,{identity:false}))return false;
  if(record.desired.persisted){if(!actual.persisted)return false;if(record.request.name==='update_automation'&&(actual.id!==record.before.id||actual.revision<=record.before.revision))return false;}
  else if(actual.revision!==record.desired.revision)return false;return true;
 }
 finish(record,actual){
  const {entry,direction}=record,id=entry.context.projectId,from=this.stack(direction==='undo'?this.past:this.future,id),to=this.stack(direction==='undo'?this.future:this.past,id);if(from.at(-1)!==entry)throw new Error('Envelope history order changed while its receipt was pending.');
  record.status='verified';record.readback=copy(actual);entry.expected=copy(actual);from.pop();to.push(entry);this.pending.delete(id);
  const next=from.findLast(candidate=>candidate.clipId===entry.clipId);if(next&&next.binding===entry.binding&&envelopeHistoryMatches(actual,next.expected,{identity:false}))next.expected=copy(actual);return record;
 }
 async history(direction){
  if(!['undo','redo'].includes(direction))throw new Error('Choose Undo or Redo.');if(this.active)throw new Error('Wait for the current envelope history request.');const id=this.captureContext().projectId;if(this.pending.has(id))throw new Error('Reconcile the previous envelope history receipt before continuing.');const entry=this.stack(direction==='undo'?this.past:this.future,id).at(-1);if(!entry)return false;this.active=true;let record;
  try{
   this.check(entry);await this.prepareWrite();let clip=this.check(entry);const current=validate(await this.read(clip,entry.context));this.check(entry);if(!envelopeHistoryMatches(current,entry.expected))throw new Error('The current envelope identity, revision or points changed outside this owned history.');
   const desired=this.desired(entry,direction),generated=this.write(entry,current,desired),request=captureWriteRequest(generated.name,generated.arguments);this.check(entry);record={direction,before:copy(current),desired:copy(desired),request,acknowledgement:null,terminalAcknowledged:false,readback:null,status:'sending'};Object.defineProperty(record,'entry',{value:entry});entry.operations.push(record);this.stack(this.receipts,id).push(record);this.pending.set(id,record);
   record.acknowledgement=copy(await this.cloudCall(request.name,request.arguments));unwrap(record.acknowledgement);record.terminalAcknowledged=true;record.status='acknowledged';clip=this.check(entry);record.readback=copy(await this.read(clip,entry.context));this.check(entry);if(!this.applied(record,record.readback))throw new Error('Envelope history readback does not exactly match the requested restoration.');return this.finish(record,record.readback);
  }catch(error){if(record){if(!record.terminalAcknowledged)retainInProgress(record,error);record.status=record.terminalAcknowledged?'unverified':'uncertain';record.error=error.message;}throw error;}finally{this.active=false;}
 }
 async reconcile({beforeFinish}={}){
  const id=this.captureContext().projectId,record=this.pending.get(id);if(!record)throw new Error('There is no uncertain envelope history receipt to verify.');if(this.active)throw new Error('Wait for the current envelope history request.');this.active=true;let replaying=false;
  try{let clip=this.check(record.entry);
   if(record.idempotencyInProgress){replaying=true;const recovered=await replayKnownBusyWrite({knownBusy:true,request:record.request,call:(name,args)=>this.cloudCall(name,args),assertCurrent:()=>this.check(record.entry),parse:unwrap});record.acknowledgement=copy(recovered.raw);record.terminalAcknowledged=true;record.idempotencyInProgress=false;record.status='acknowledged';clip=this.check(record.entry);}
   const actual=validate(await this.read(clip,record.entry.context));this.check(record.entry);record.reconciledReadback=copy(actual);if(this.applied(record,actual)){if(this.stack(record.direction==='undo'?this.past:this.future,id).at(-1)!==record.entry)throw new Error('Envelope history order changed before reconciliation.');beforeFinish?.(record);return {record:this.finish(record,actual),applied:true};}if(!record.terminalAcknowledged&&envelopeHistoryMatches(actual,record.before)){record.status='not-applied';this.pending.delete(id);return {record,applied:false};}record.status='unverified';throw new Error('The canonical envelope matches neither the prior state nor the requested history result. No mutation was retried.');}catch(error){if(replaying&&!record.terminalAcknowledged)retainInProgress(record,error);record.status=record.terminalAcknowledged?'unverified':'uncertain';record.error=error.message;throw error;}finally{this.active=false;}
 }
}
