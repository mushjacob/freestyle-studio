import {isIdempotencyInProgress,definiteCloudRejection,retainInProgress,assertTerminalIdempotency,captureWriteRequest,replayKnownBusyWrite} from './cloud-errors.js';
import {assertCompleteCanonicalData} from './cloud-session.js';
import {assertAutomationJsonValue} from './audacity-automation-contract.js';
const copy=value=>structuredClone(value),id=value=>typeof value==='string'&&value.length>0&&value.length<=64;
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const key=value=>JSON.stringify(stable(value));
const ownProject=(row,projectId)=>['projectId','project_id'].every(field=>row[field]==null||row[field]===projectId);
const times=row=>Object.fromEntries(Object.entries(row).filter(([field])=>!['createdAt','created_at','updatedAt','updated_at'].includes(field)));
const clipId=row=>row.clipId??row.clip_id;
function snapshot(value,projectId){
 assertAutomationJsonValue(value);assertCompleteCanonicalData(value,'import history checkpoint');
 const project=value?.project,placements=value?.placements??project?.placements;
 if(!project||project.id!==projectId||!ownProject(project,projectId)||!Array.isArray(project.lanes)||!Array.isArray(project.clips)||!Array.isArray(placements)||!Array.isArray(value.envelopes))throw new Error('Import history needs complete canonical project, placement and automation arrays.');
 const lanes=new Set(),clips=new Set(),placementIds=new Set();
 for(const lane of project.lanes){if(!id(lane?.id)||lanes.has(lane.id)||!ownProject(lane,projectId))throw new Error('Import history has an ambiguous or foreign lane.');lanes.add(lane.id);}
 for(const clip of project.clips){if(!id(clip?.id)||clips.has(clip.id)||!lanes.has(clip.laneId)||!ownProject(clip,projectId))throw new Error('Import history has an ambiguous or foreign audio clip.');clips.add(clip.id);}
 for(const row of placements){if(!id(row?.id)||placementIds.has(row.id)||!lanes.has(row.laneId??row.lane_id)||!ownProject(row,projectId))throw new Error('Import history has an ambiguous or foreign pattern placement.');placementIds.add(row.id);}
 for(const row of value.envelopes)if(!row||clipId(row)!=null&&!clips.has(clipId(row))||!ownProject(row,projectId))throw new Error('Import history automation is outside its canonical project or audio clips.');
 for(const [field,rows]of [['lanes',project.lanes],['clips',project.clips],['placements',placements]])if(project.counts?.[field]!==undefined&&(!Number.isSafeInteger(project.counts[field])||project.counts[field]!==rows.length))throw new Error('Import history has contradictory canonical membership counts.');
 return {...copy(value),placements:copy(placements)};
}
/** Compare editable canonical data, not project receipt timestamps or the
 * project-wide REST timeline revision advanced by our own lane writes. Envelope
 * identity/revision can change after a verified F2 Undo; full points, metadata,
 * ordering, defaults, value type and persisted absence remain exact. Nested
 * source/audio revisions and metadata are deliberately never stripped.
 */
export function importHistoryStateKey(state){
 const project=times(state.project);delete project.revision;delete project.timelineRevision;
 project.lanes=project.lanes.map(times);project.clips=project.clips.map(times).sort((a,b)=>a.id.localeCompare(b.id));
 const placements=state.placements??project.placements??[];
 if(Array.isArray(project.placements))project.placements=placements.map(times).sort((a,b)=>a.id.localeCompare(b.id));
 const envelopes=state.envelopes.map(row=>{const data=times(row);delete data.id;delete data.revision;return data;}).sort((a,b)=>key([clipId(a),a.target]).localeCompare(key([clipId(b),b.target])));
 return key({project,placements:placements.map(times).sort((a,b)=>a.id.localeCompare(b.id)),envelopes});
}
function withoutLanes(state,laneIds){
 const next=copy(state),lanes=new Set(laneIds),removed=new Set(next.project.clips.filter(row=>lanes.has(row.laneId)).map(row=>row.id));
 next.project.lanes=next.project.lanes.filter(row=>!lanes.has(row.id));next.project.clips=next.project.clips.filter(row=>!removed.has(row.id));next.placements=next.placements.filter(row=>!lanes.has(row.laneId??row.lane_id));
 if(Array.isArray(next.project.placements))next.project.placements=copy(next.placements);next.envelopes=next.envelopes.filter(row=>!removed.has(clipId(row)));
 if(next.project.counts)for(const [field,rows]of [['lanes',next.project.lanes],['clips',next.project.clips],['placements',next.placements]])if(Object.hasOwn(next.project.counts,field))next.project.counts[field]=rows.length;
 return next;
}
function unwrap(raw){
 let data=raw?.structuredContent??raw;if(data===raw&&Array.isArray(raw?.content))data=JSON.parse(raw.content.filter(row=>row.type==='text').map(row=>row.text).join('\n'));const result=data?.response??data;
 if(raw?.isError||data?.error||data?.ok===false||result?.error||result?.ok===false)throw Object.assign(new Error(typeof result?.error==='string'?result.error:result?.message||'Freestyle rejected the lane history operation.'),{definiteRejection:true,result:copy(raw),code:result?.code??result?.error?.code});
 assertAutomationJsonValue(result);assertCompleteCanonicalData(result,'lane history receipt');return result;
}
/** Owned import/new-track Undo. Dedicated soft-delete/restore keeps uploaded
 * sources and durable identities; no upload, recreation or generic native Undo.
 * The API has no lane CAS: preflight cannot eliminate a concurrent external
 * edit. Every acknowledged step therefore requires an exact post-read; an
 * ambiguous/interrupted composite remains blocked with all receipts retained.
 */
export class ImportHistoryController{
 constructor({captureContext,assertContext,read,write,publish=async()=>{},hydrate=async()=>{},verifyNativeRemoval,prepareWrite=async()=>{}}={}){Object.assign(this,{captureContext,assertContext,read,write,publish,hydrate,verifyNativeRemoval,prepareWrite});this.past=new Map();this.future=new Map();this.receipts=new Map();this.pending=new Map();this.active=false;}
 stack(map,projectId=this.captureContext().projectId){if(!map.has(projectId))map.set(projectId,[]);return map.get(projectId);}
 clearFuture(projectId=this.captureContext().projectId){this.stack(this.future,projectId).length=0;}
 uncertain(projectId=this.captureContext().projectId){return ['uncertain','interrupted'].includes(this.pending.get(projectId)?.status);}
 unverified(projectId=this.captureContext().projectId){return !!this.pending.has(projectId)&&!this.uncertain(projectId);}
 begin({context=this.captureContext(),before,bootstrapLaneIds=[]}={}){
  this.assertContext(context);if(this.pending.has(context.projectId)||this.active)throw new Error('Verify the previous import receipt before starting another import.');
  const captured=snapshot(before,context.projectId);if(!Array.isArray(bootstrapLaneIds)||new Set(bootstrapLaneIds).size!==bootstrapLaneIds.length||bootstrapLaneIds.some(laneId=>!captured.project.lanes.some(lane=>lane.id===laneId&&lane.kind==='audio')||captured.project.clips.some(clip=>clip.laneId===laneId)||captured.placements.some(row=>(row.laneId??row.lane_id)===laneId)))throw new Error('Only a fresh empty canonical audio bootstrap lane can be owned by new-project import history.');
  const entry={kind:'import',context:copy(context),before:withoutLanes(captured,bootstrapLaneIds),initial:captured,laneIds:[...bootstrapLaneIds],clipIds:[],attempts:[],steps:[],operations:[],status:'preparing',registered:false};this.pending.set(context.projectId,entry);this.stack(this.receipts,context.projectId).push(entry);return entry;
 }
 recordMutation(entry,{name,arguments:args={},receipt,status='sending'}={}){this.assertContext(entry.context);if(this.pending.get(entry.context.projectId)!==entry)throw new Error('The import batch no longer owns the pending receipt.');const attempt={name,arguments:copy(args),status,...(receipt!==undefined?{rawReceipt:copy(receipt)}:{})};entry.attempts.push(attempt);entry.status=status==='sending'?'sending':'unverified';return attempt;}
 captureStep(entry,{after,laneIds=[],clipIds=[]}={}){
  assertTerminalIdempotency(entry);this.assertContext(entry.context);if(entry.registered)throw new Error('A registered import receipt cannot capture another mutation.');const current=snapshot(after,entry.context.projectId),known=new Set(entry.before.project.lanes.map(lane=>lane.id));
  if(!Array.isArray(laneIds)||!Array.isArray(clipIds)||laneIds.some(laneId=>!id(laneId)||known.has(laneId)||!current.project.lanes.some(lane=>lane.id===laneId&&lane.kind==='audio'))||clipIds.some(clip=>!id(clip)))throw new Error('An import history step must identify its fresh canonical audio lanes and clips.');
  const owned=[...new Set([...entry.laneIds,...laneIds])],ownedClips=current.project.clips.filter(clip=>owned.includes(clip.laneId));
  if(clipIds.some(clip=>!ownedClips.some(row=>row.id===clip))||owned.some(lane=>ownedClips.filter(clip=>clip.laneId===lane).length>200)||current.placements.some(row=>owned.includes(row.laneId??row.lane_id)))throw new Error('Imported lanes contain unknown clips, pattern placements or more than 200 restorable takes.');
  const expectedClips=[...new Set([...entry.clipIds,...clipIds])];if(ownedClips.length!==expectedClips.length||ownedClips.some(row=>!expectedClips.includes(row.id))||importHistoryStateKey(withoutLanes(current,owned))!==importHistoryStateKey(entry.before))throw new Error('The import changed audio or metadata outside its exclusively owned lanes.');
  entry.laneIds=owned;entry.clipIds=expectedClips;entry.after=current;entry.steps.push({laneIds:copy(laneIds),clipIds:copy(clipIds),after:copy(current)});entry.status='unverified';return entry;
 }
 complete(entry,{after=entry.after}={}){
  assertTerminalIdempotency(entry);this.assertContext(entry.context);if(entry.registered){this.assertState(snapshot(after,entry.context.projectId),entry.after);return {entry,added:false};}if(!entry.laneIds.length)throw new Error('No verified imported or new audio lane is available for Undo.');this.captureStep(entry,{after});entry.status='applied';entry.expected=copy(entry.after);this.stack(this.past,entry.context.projectId).push(entry);this.clearFuture(entry.context.projectId);entry.registered=true;this.pending.delete(entry.context.projectId);return {entry,added:true};
 }
 interrupt(entry,error,{status}={}){entry.idempotencyInProgress=entry.attempts.some(attempt=>attempt.idempotencyInProgress===true||attempt.importRecord?.writeAttempts?.some(write=>write.idempotencyInProgress===true)||attempt.trackAttempt?.writeAttempts?.some(write=>write.idempotencyInProgress===true));entry.error=error?.message??String(error);entry.status=status??(entry.attempts.length?'uncertain':'interrupted');this.pending.set(entry.context.projectId,entry);return entry;}
 abandonUnsent(entry,{attempt,importRecord}={}){
  this.assertContext(entry.context);
  if(this.pending.get(entry.context.projectId)!==entry||entry.registered||entry.laneIds.length||entry.steps.length||entry.after||!entry.attempts.includes(attempt)||importRecord?.phase!=='failed'||importRecord.dispatched===true||importRecord.acknowledged===true||entry.attempts.some(row=>row!==attempt&&row.status!=='rejected'))throw new Error('The retained import does not prove that no owned mutation was dispatched.');
  attempt.status='rejected';attempt.importRecord=copy(importRecord);entry.status='not-dispatched';this.pending.delete(entry.context.projectId);return {entry,applied:false};
 }
 can(direction){const projectId=this.captureContext().projectId,entry=this.stack(direction==='undo'?this.past:this.future,projectId).at(-1);if(this.active||this.pending.has(projectId)||!entry)return false;try{this.assertContext(entry.context);return true;}catch{return false;}}
 async readCurrent(context){this.assertContext(context);const result=snapshot(await this.read(context),context.projectId);this.assertContext(context);return result;}
 assertState(actual,expected){if(importHistoryStateKey(actual)!==importHistoryStateKey(expected))throw new Error('The canonical lane, source, timing or automation changed outside owned import history. No other audio will be removed or overwritten.');}
 async request(record,name,args){
  this.assertContext(record.entry.context);const revision=record.writeRevision??(record.expectedIntermediate??record.before)?.project?.timelineRevision;if(typeof revision==='string'&&revision)args={...args,if_match:revision};const request=captureWriteRequest(name,args),attempt={name,arguments:copy(request.arguments),request,status:'sending'};record.attempts.push(attempt);record.status='sending';
  try{attempt.rawReceipt=copy(await this.write(name,copy(attempt.request.arguments),record.entry.context));attempt.status='acknowledged';const result=unwrap(attempt.rawReceipt);this.assertContext(record.entry.context);return result;}
  catch(error){attempt.error=error.message;if(attempt.status!=='acknowledged'){retainInProgress(record,error);retainInProgress(attempt,error);}if(definiteCloudRejection(error))attempt.status='rejected';else if(!attempt.rawReceipt)attempt.status='uncertain';throw error;}
 }
 async finish(record,actual,{beforeFinish}={}){
  const {entry,direction}=record,id=entry.context.projectId;this.assertState(actual,record.desired);this.assertContext(entry.context);
  const from=this.stack(direction==='undo'?this.past:this.future,id),to=this.stack(direction==='undo'?this.future:this.past,id);if(from.at(-1)!==entry)throw new Error('Import history order changed while verification was pending.');
  await this.publish(actual,{entry,direction,restored:direction==='redo'});this.assertContext(entry.context);
  if(direction==='undo'&&(record.engineReloadRequired||this.verifyNativeRemoval)&&(typeof this.verifyNativeRemoval!=='function'||await this.verifyNativeRemoval(entry,actual,record)!==true))throw new Error('The imported lane is archived, but Freestyle requires native engine verification. Its receipt remains pending.');
  if(direction==='redo'&&entry.clipIds.length){await this.hydrate(entry,actual,record);this.assertContext(entry.context);actual=await this.readCurrent(entry.context);this.assertState(actual,record.desired);}
  beforeFinish?.(record);record.status='verified';record.readback=copy(actual);entry.expected=copy(actual);entry.status=direction==='undo'?'undone':'applied';from.pop();to.push(entry);this.pending.delete(id);return record;
 }
 async history(direction){
  if(!['undo','redo'].includes(direction))throw new Error('Choose Undo or Redo.');const id=this.captureContext().projectId;if(this.active||this.pending.has(id))throw new Error('Verify the pending import receipt before applying history.');const entry=this.stack(direction==='undo'?this.past:this.future,id).at(-1);if(!entry)return false;this.active=true;let record;
  try{
   this.assertContext(entry.context);await this.prepareWrite();const current=await this.readCurrent(entry.context);this.assertState(current,entry.expected);
   record={kind:'history',entry,direction,before:current,desired:copy(direction==='undo'?entry.before:entry.after),attempts:[],status:'preparing'};entry.operations.push(record);this.stack(this.receipts,id).push(record);this.pending.set(id,record);
   await this.continueHistory(record);
   return await this.finish(record,record.readback);
  }catch(error){if(record){record.error=error.message;record.status=record.attempts.some(attempt=>attempt.status==='uncertain')?'uncertain':'unverified';}throw error;}finally{this.active=false;}
 }
 async laneRequest(record,name,args){
  const existing=record.attempts.find(attempt=>attempt.name===name&&attempt.arguments.lane_id===args.lane_id);
  if(!existing){if(record.recoveringKnownBusy){const current=await this.readCurrent(record.entry.context);this.assertState(current,record.expectedIntermediate??record.before);}return this.request(record,name,args);}
  if(existing.status==='acknowledged'&&existing.rawReceipt)return unwrap(existing.rawReceipt);
  const {raw,receipt}=await replayKnownBusyWrite({knownBusy:existing.idempotencyInProgress===true,request:existing.request,call:(n,a)=>this.write(n,a,record.entry.context),assertCurrent:()=>this.assertContext(record.entry.context),parse:unwrap});
  existing.rawReceipt=copy(raw);existing.status='acknowledged';existing.idempotencyInProgress=false;record.idempotencyInProgress=false;record.status='unverified';return receipt;
 }
 async continueHistory(record){
  const {entry,direction}=record,id=entry.context.projectId;let intermediate=copy(record.before);
   for(const laneId of entry.laneIds){
    if(record.completedLanes?.includes(laneId)){intermediate=direction==='undo'?withoutLanes(intermediate,[laneId]):withoutLanes(record.desired,entry.laneIds.slice(entry.laneIds.indexOf(laneId)+1));continue;}
    const expectedIds=entry.after.project.clips.filter(clip=>clip.laneId===laneId).map(clip=>clip.id),args={project_id:id,lane_id:laneId};
    if(direction==='undo'){
     const receipt=await this.laneRequest(record,'delete_lane',{...args,confirm:true});if(!Array.isArray(receipt.deletedClipIds)||new Set(receipt.deletedClipIds).size!==receipt.deletedClipIds.length||key([...receipt.deletedClipIds].sort())!==key([...expectedIds].sort())){record.receiptMismatch=true;throw new Error('The lane deletion receipt did not identify exactly the owned takes.');}
     (entry.deletedClipIds??={})[laneId]=copy(receipt.deletedClipIds);intermediate=withoutLanes(intermediate,[laneId]);
     if(receipt.engine_reload_required===true)record.engineReloadRequired=true;
    }else{
     const deleted=entry.deletedClipIds?.[laneId];if(!Array.isArray(deleted)||key([...deleted].sort())!==key([...expectedIds].sort()))throw new Error('The exact archived takes are unavailable for Redo.');await this.laneRequest(record,'restore_lane',{...args,clip_ids:copy(deleted)});
     // Build each restoration checkpoint from the original complete target;
     // remove only the still-archived owned lanes, preserving original order.
     const restored=entry.laneIds.slice(0,entry.laneIds.indexOf(laneId)+1);intermediate=withoutLanes(record.desired,entry.laneIds.filter(id=>!restored.includes(id)));
    }
    record.status='unverified';record.expectedIntermediate=copy(intermediate);const observed=await this.readCurrent(entry.context);record.readback=copy(observed);this.assertState(observed,intermediate);record.writeRevision=observed.project.timelineRevision;(record.completedLanes??=[]).push(laneId);
   }
 }
 async reconcile({beforeFinish}={}){
  const id=this.captureContext().projectId,record=this.pending.get(id);if(!record)throw new Error('There is no pending import receipt to verify.');if(this.active)throw new Error('Wait for the current import history request.');this.active=true;
  try{
   const entry=record.kind==='history'?record.entry:record;this.assertContext(entry.context);if(record.kind==='history'&&(record.idempotencyInProgress||record.recoveringKnownBusy)){record.recoveringKnownBusy=true;if(record.direction==='redo')record.recoveringHydration=true;await this.continueHistory(record);record.recoveringKnownBusy=false;}assertTerminalIdempotency(record);const actual=await this.readCurrent(entry.context);record.reconciledReadback=copy(actual);
   if(record.kind==='history'){
    const exactDeletes=record.direction!=='undo'||record.entry.laneIds.every(lane=>Array.isArray(record.entry.deletedClipIds?.[lane]));
    if(!record.receiptMismatch&&exactDeletes&&importHistoryStateKey(actual)===importHistoryStateKey(record.desired))return {record:await this.finish(record,actual,{beforeFinish}),applied:true};
    if(record.attempts.length&&record.attempts.every(attempt=>attempt.status==='rejected')&&importHistoryStateKey(actual)===importHistoryStateKey(record.before)){record.status='not-applied';this.pending.delete(id);return {record,applied:false};}
   }else if(entry.after&&entry.attempts.every(attempt=>!['sending','uncertain'].includes(attempt.status))&&importHistoryStateKey(actual)===importHistoryStateKey(entry.after)){const result=this.complete(entry,{after:actual});return {record:entry,applied:true,registered:result.added};}
   record.status=record.status==='uncertain'?'uncertain':'unverified';throw new Error('The import receipt does not match its complete owned result. Receipts are retained; no write was retried or foreign edit compensated.');
  }finally{this.active=false;}
 }
}
