/** One confirmed file import, restored through documented saved-clip/lane inverses. */
import {withoutObservedSavedState} from './cloud-history-observed.js';
import {assertCompleteCanonicalData} from './cloud-session.js';
import {validateClipBatchOps,validateClipEditReceipt,clipBatchCommitOutcome,clipBatchAppliedCount} from './cloud-range-edits.js';
import {audioGeometryEqual} from './cloud-audio-history.js';
const clone=structuredClone,record=v=>!!v&&typeof v==='object'&&!Array.isArray(v),finite=v=>typeof v==='number'&&Number.isFinite(v);
const id=v=>typeof v==='string'&&v.length>0&&v.length<=64&&!/[\u0000-\u0020\u007f]/.test(v);
const ignored=new Set(['_studioApi','timelineRevision','updatedAt','updated_at']);
const stable=(v,path=[])=>Array.isArray(v)?v.map((child,index)=>stable(child,[...path,index])):record(v)?Object.fromEntries(Object.keys(v).filter(k=>!(path.length===0&&ignored.has(k)||path.length===2&&['clips','lanes','patterns','placements'].includes(path[0])&&['updatedAt','updated_at'].includes(k))).sort().map(k=>[k,stable(v[k],[...path,k])])):v;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const fail=(message,code='audio_import_history_unconfirmed')=>Object.assign(new Error(message),{code});
function canonical(value){
 const raw=value?.cloud?.rawProject??value;
 if(!record(raw)||!id(raw.id))throw fail('Read the complete saved import project.');
 assertCompleteCanonicalData(raw,'import history project');
 for(const key of ['clips','lanes','patterns','placements']){
  if(!Array.isArray(raw[key]))throw fail('Read the complete saved '+key+' before import history.');
  const seen=new Set();for(const row of raw[key]){if(!record(row)||!id(row.id)||seen.has(row.id))throw fail('Saved '+key+' identities are missing or duplicated.');seen.add(row.id);}
  if(raw.counts?.[key]!==undefined&&raw.counts[key]!==raw[key].length)throw fail('Saved import project counts do not match its complete collections.');
 }
 return clone(raw);
}
function without(raw,clipId,laneId){
 const copy=clone(raw);copy.clips=copy.clips.filter(c=>c.id!==clipId);if(laneId)copy.lanes=copy.lanes.filter(l=>l.id!==laneId);
 for(const key of ['clips','lanes'])if(copy.counts?.[key]!==undefined)copy.counts[key]=copy[key].length;
 return copy;
}
/** A recorded take's promotion bumps its record lane's identityVersion (live QA r12: 1 → 2 on the take's lane, nothing
 * else). For a take adopted with recordedLaneId, that one lane's identityVersion is the take's own write: it is
 * compared nowhere else, and only a forward (larger integer) bump is accepted at adoption. */
function withoutLaneIdentity(raw,laneId){
 if(!laneId||!record(raw)||!Array.isArray(raw.lanes))return raw;
 return{...raw,lanes:raw.lanes.map(lane=>record(lane)&&lane.id===laneId?Object.fromEntries(Object.entries(lane).filter(([key])=>key!=='identityVersion')):lane)};
}
function geometry(clip){
 const offsets=[clip.audioOffsetSec,clip.effects?.timing?.audioOffsetSec].filter(v=>v!==undefined);
 if(!finite(clip.startMs)||clip.startMs<0||!finite(clip.durationSec)||clip.durationSec<=0||!offsets.length||offsets.some(v=>!finite(v)||v<0||v!==offsets[0]))throw fail('Import history needs complete canonical millisecond start and second-based source timing.');
 return{start_ms:clip.startMs,duration_sec:clip.durationSec,audio_offset_sec:offsets[0]};
}
function payload(result,projectId){
 let value=result?.structuredContent??result;
 for(let depth=0;depth<8;depth++){
  if(!record(value)||result?.isError||value.ok===false||value.applied===false||value.dry_run===true||value.error)throw fail('The saved import history action was not acknowledged.');
  if(['projectId','project_id'].some(key=>value[key]!==undefined&&value[key]!==projectId))throw fail('Import history acknowledgement belongs to another project.');
  if(!record(value.response))return value;value=value.response;
 }
 throw fail('Import history acknowledgement nesting exceeded its limit.');
}
export class AudioImportHistoryController{
 constructor({before,after,clipId,getProject,getSaved=null,getScope,read,call,flush=async()=>{},createId=()=>crypto.randomUUID(),onChange=()=>{}}={}){
  if(![getProject,getScope,read,call,flush,createId,onChange].every(f=>typeof f==='function')||getSaved!==null&&typeof getSaved!=='function')throw TypeError('Import history needs scoped project/read/call callbacks.');
  Object.assign(this,{getProject,getSaved,getScope,read,call,flush,createId,onChange});this.busy=false;this.before=canonical(before);this.scope=clone(getScope());
  if(this.scope?.projectId!==this.before.id||!id(this.scope.trackId))throw fail('Capture the current project and take before importing.');
  this.state={status:'idle',scope:clone(this.scope),clipId:null,laneId:null,ownedLane:false,attempted:false,operationCommitted:false,knownNotApplied:true,importConfirmed:false,rejected:false,error:null,receipts:[]};this.keys=new Set();this.inverse=null;
  if(after!==undefined)this.adopt({after,clipId});
 }
 snapshot(){return clone({...this.state,busy:this.busy,canUndo:!this.busy&&this.state.status==='committed',canRedo:!this.busy&&this.state.status==='undone'&&this.state.redoUnavailable!==true});}
 notify(){try{this.onChange(this.snapshot());}catch{}}
 assert(){if(!same(this.scope,this.getScope()))throw Object.assign(fail('The import history project or take changed.','audio_import_history_scope_changed'),{name:'AbortError'});}
 adopt({after,clipId,recordedLaneId=null}={}){
  this.assert();if(this.busy||this.state.status!=='idle'||!id(clipId))throw fail('Adopt one uniquely confirmed uploaded clip once.');
  const raw=canonical(after);if(raw.id!==this.before.id||this.before.clips.some(c=>c.id===clipId))throw fail('The uploaded clip is not a new identity in this project.');
  const added=raw.clips.filter(c=>!this.before.clips.some(old=>old.id===c.id));if(added.length!==1||added[0].id!==clipId||!id(added[0].laneId))throw fail('Confirm exactly one saved imported clip before retaining its history.');
  const clip=added[0],lane=raw.lanes.find(l=>l.id===clip.laneId);// The service may leave a lane untyped (no kind) after placing audio on it;
  // only lanes typed as something other than audio/vocal are refused.
  if(!lane||!(lane.kind==null||lane.kind===''||['audio','vocal'].includes(lane.kind)))throw fail('The imported clip needs a uniquely saved audio lane.');
  const ownedLane=!this.before.lanes.some(l=>l.id===lane.id),newLanes=raw.lanes.filter(l=>!this.before.lanes.some(old=>old.id===l.id));
  const takeLane=!ownedLane&&recordedLaneId!==null&&recordedLaneId===lane.id?lane.id:null;
  if(takeLane){const old=this.before.lanes.find(l=>l.id===takeLane)?.identityVersion,next=lane.identityVersion;if(old!==next&&!(Number.isSafeInteger(old)&&Number.isSafeInteger(next)&&next>old))throw fail('The recorded take changed its lane identity backwards.');}
  if(newLanes.length!==(ownedLane?1:0)||!same(withoutLaneIdentity(withoutObservedSavedState(without(raw,clipId,ownedLane?lane.id:null)),takeLane),withoutLaneIdentity(withoutObservedSavedState(this.before),takeLane)))throw fail('The import changed saved content beyond its owned clip and optional new lane.');
  this.takeLaneId=takeLane;this.clip=clone(clip);this.lane=clone(lane);this.timing=geometry(clip);this.state={...this.state,status:'committed',clipId,laneId:lane.id,ownedLane,attempted:true,operationCommitted:true,knownNotApplied:false,importConfirmed:true};this.guard(raw,true);this.notify();return this.snapshot();
 }
 failImport({attempted,committed,uncertain,explicitRejection=false,error}={}){
  if(![attempted,committed,uncertain,explicitRejection].every(v=>typeof v==='boolean'))throw TypeError('Import failure needs explicit attempt, commit and uncertainty flags.');
  const knownNotApplied=!committed&&!uncertain&&(!attempted||explicitRejection);
  this.state={...this.state,status:knownNotApplied?'not_sent':'uncertain',attempted,operationCommitted:committed,knownNotApplied,error:String(error?.message||'The import was not confirmed.').slice(0,500)};this.notify();return this.snapshot();
 }
 // The saved model just read (the app's model may be showing an optimistic history preview).
 async fresh(){this.assert();await this.read();this.assert();return canonical(this.getSaved?.()||this.getProject());}
 guard(raw,present){
  if(raw.id!==this.scope.projectId)throw fail('Read the same project before import history.');
  const clips=raw.clips.filter(c=>c.id===this.state.clipId),lanes=raw.lanes.filter(l=>l.id===this.state.laneId);
  const laneSame=lane=>this.takeLaneId?same(withoutLaneIdentity({lanes:[lane]},this.takeLaneId).lanes[0],withoutLaneIdentity({lanes:[this.lane]},this.takeLaneId).lanes[0]):same(lane,this.lane);
  if(present){if(clips.length!==1||!same(clips[0],this.clip)||lanes.length!==1||!laneSame(lanes[0]))throw fail('The complete imported clip or lane changed; undo newer target edits first.');}
  else if(this.state.ownedLane?(clips.length||lanes.length):(clips.length||lanes.length!==1||!laneSame(lanes[0])))throw fail('The removed import or its retained lane changed before Redo.');
  if(this.state.ownedLane&&(raw.clips.some(c=>c.laneId===this.state.laneId&&c.id!==this.state.clipId)||raw.placements.some(p=>p.laneId===this.state.laneId)||raw.patterns.some(p=>(p.pattern?.sources||p.data?.pattern?.sources||[]).some(s=>s.laneId===this.state.laneId))))throw fail('The imported lane now contains other content and cannot be removed by import Undo.');
 }
 sourceLive(raw,source){return source===undefined||source===this.state.clipId||id(source)&&raw.clips.some(c=>c.id===source&&!c.deleted);}
 key(){for(let n=0;n<64;n++){const key=this.createId();if(typeof key==='string'&&/^[A-Za-z0-9._:-]{8,128}$/.test(key)&&!this.keys.has(key)){this.keys.add(key);return key;}}throw fail('Import history needs a fresh write key.');}
 revision(raw){const meta=raw._studioApi,tag=meta?.etag;if(meta?.projectId!=null&&meta.projectId!==raw.id||typeof tag!=='string'||!tag||/[\r\n]/.test(tag))throw fail('Read the current project ETag before import history.');return tag;}
 async undo(){return this.apply('undo');}
 async redo(){return this.apply('redo');}
 async apply(direction){
  if(this.busy||this.state.status!==(direction==='undo'?'committed':'undone'))throw fail('Inspect the retained import before repeating history.');
  if(direction==='redo'&&this.state.redoUnavailable===true)throw fail('This import Undo kept no exact restore inverse, so it cannot be redone.');
  this.busy=true;this.state.knownNotApplied=true;this.state.rejected=false;this.state.error=null;let attempted=false,acknowledged=false,noRedo=null;const prior=this.state.status;
  try{
   // QA round 21 speed: the journal's own verified read just before this call is the
   // before-state (no second read); If-Match on its revision makes Freestyle refuse
   // (412, nothing applied) if it went stale, and only then is it read and sent once more.
   const handed=this.freshBefore;this.freshBefore=null;
   this.assert();await this.flush();let raw=null,cached=false;if(handed){try{raw=canonical(handed);this.guard(raw,direction==='undo');this.revision(raw);cached=true;}catch{raw=null;}}if(!raw){raw=await this.fresh();this.guard(raw,direction==='undo');}
   let protectedBefore=without(raw,this.state.clipId,this.state.ownedLane?this.state.laneId:null),headers={ifMatch:this.revision(raw),idempotencyKey:this.key()};let name,args;
   if(this.state.ownedLane){name=direction==='undo'?'delete_lane':'restore_lane';args={project_id:this.scope.projectId,lane_id:this.state.laneId,...direction==='redo'?{clip_ids:[...this.deletedClipIds]}:{}};}
   else{name='apply_clip_batch';const ops=direction==='undo'?[{op:'remove',id:this.state.clipId,expected:clone(this.timing)}]:clone(this.inverse);validateClipBatchOps(ops,{serverAuthoredInverse:direction==='redo'});
    // The retained restore names a live source clip that shares the stored media; Redo must not run without it.
    if(direction==='redo'&&!this.sourceLive(raw,ops[0]?.source_id))throw fail('The clip whose stored audio the Redo restores was removed; undo or restore it first.');args={project_id:this.scope.projectId,track_id:this.scope.trackId,ops};}
   const step={direction,name,status:'sending',idempotencyKey:headers.idempotencyKey};this.state.receipts.push(step);this.assert();attempted=true;this.state.attempted=true;this.state.knownNotApplied=false;this.notify();
   let result;try{result=await this.call(name,args,headers);}catch(error){
    if(!cached||Number(error?.status)!==412)throw error;
    attempted=false;this.state.knownNotApplied=true;raw=await this.fresh();this.guard(raw,direction==='undo');protectedBefore=without(raw,this.state.clipId,this.state.ownedLane?this.state.laneId:null);
    Object.assign(headers,{ifMatch:this.revision(raw),idempotencyKey:this.key()});step.idempotencyKey=headers.idempotencyKey;attempted=true;this.state.knownNotApplied=false;result=await this.call(name,args,headers);
   }
   acknowledged=true;this.assert();const receipt=payload(result,this.scope.projectId);
   if(receipt.ok!==true&&receipt.applied!==true)throw fail('The saved import action did not acknowledge application.');
   if(this.state.ownedLane){if(receipt.laneId!==undefined&&receipt.laneId!==this.state.laneId)throw fail('The lane acknowledgement identifies another lane.');if(direction==='undo'){const ids=receipt.deletedClipIds;if(!Array.isArray(ids)||ids.length!==1||ids[0]!==this.state.clipId)throw fail('Lane deletion did not return the exact owned deletedClipIds.');this.deletedClipIds=clone(ids);}}
   else{validateClipEditReceipt(receipt,this.scope.projectId);if(direction==='undo'){
    // Prefer the server's undo.inverse_ops (exact). It is null on a replay of
    // our own key; applied_ops is then 0/null (1 for this one-op batch when
    // applied now), and the documented same-id restore uses this owned clip's
    // canonical timing.
    const count=clipBatchAppliedCount(receipt),appliedThisOp=count===1||receipt.replay===true&&(count===0||count===null)||receipt.applied_ops==null&&clipBatchCommitOutcome(receipt).postCommitError!==null;
    if(receipt.undo?.inverse_ops==null&&receipt.applied===true&&appliedThisOp)receipt.undo={inverse_ops:[{op:'restore',id:this.state.clipId,...clone(this.timing)}]};
    // A placed Browser/project sample is restored from the live take that owns its stored
    // audio (the sample's sourceTrackId), so Freestyle's exact inverse carries that clip
    // as source_id (live QA r10). Accept it only when it names another clip in the
    // verified pre-delete read; any other id, op count or timing is still refused.
    let inverse=null;try{inverse=validateClipBatchOps(receipt.undo?.inverse_ops,{serverAuthoredInverse:true});}catch{}
    if(!inverse||inverse.length!==1||inverse[0].op!=='restore'||inverse[0].id!==this.state.clipId||!this.sourceLive(raw,inverse[0].source_id)||!audioGeometryEqual(inverse[0],this.timing)){
     // When Freestyle acknowledges exactly this one removal, only Redo lacks an exact inverse: the
     // canonical read below still proves the exact post-Undo state, so the Undo stays one known step.
     const message='The deletion has no exact server-authored imported-clip restore inverse.';if(!appliedThisOp)throw fail(message);noRedo=message;this.inverse=null;
    }else this.inverse=clone(inverse);}}
   const outcome=name==='apply_clip_batch'?clipBatchCommitOutcome(receipt):null;step.status='acknowledged';step.engineReloadRequired=receipt.engine_reload_required===true||outcome?.engineReloadRequired===true;if(outcome?.postCommitError){step.postCommitError=outcome.postCommitError;step.warning=outcome.warning;}const confirmed=await this.fresh();this.guard(confirmed,direction==='redo');
   if(!same(withoutLaneIdentity(without(confirmed,this.state.clipId,this.state.ownedLane?this.state.laneId:null),this.takeLaneId),withoutLaneIdentity(protectedBefore,this.takeLaneId)))throw fail('Unrelated saved content changed during import history.');
   step.status='confirmed';this.state.status=direction==='undo'?'undone':'committed';this.state.operationCommitted=true;if(direction==='undo'){this.state.redoUnavailable=noRedo!==null;if(noRedo){step.redoUnavailable=true;this.state.error=noRedo;}}this.notify();
  }catch(error){
   const rejected=attempted&&!acknowledged&&error.explicitRejection===true;this.state.knownNotApplied=!attempted||rejected;this.state.rejected=rejected;this.state.status=this.state.knownNotApplied?prior:'uncertain';this.state.error=String(error?.message||'Import history was not confirmed.').slice(0,500);
   throw Object.assign(error,{operationCommitted:acknowledged||error.operationCommitted===true,operationUncertain:!this.state.knownNotApplied,audioImportHistory:this.snapshot()});
  }finally{this.busy=false;this.notify();}
  return this.snapshot();
 }
}
