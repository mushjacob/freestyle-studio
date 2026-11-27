/** Saved Undo/Redo for exactly one newly created, content-free lane. */
import {assertCompleteCanonicalData} from './cloud-session.js';
const clone=structuredClone,record=v=>!!v&&typeof v==='object'&&!Array.isArray(v),id=v=>typeof v==='string'&&v.length>0&&v.length<=64&&!/[\u0000-\u0020\u007f]/.test(v);
const collections=['lanes','clips','patterns','placements'],ignored=new Set(['_studioApi','timelineRevision','updatedAt','updated_at']);
const stable=(v,path=[])=>Array.isArray(v)?v.map((child,index)=>stable(child,[...path,index])):record(v)?Object.fromEntries(Object.keys(v).filter(k=>!(path.length===0&&ignored.has(k)||path.length===2&&collections.includes(path[0])&&['updatedAt','updated_at'].includes(k))).sort().map(k=>[k,stable(v[k],[...path,k])])):v;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const fail=(message,code='lane_create_history_unconfirmed')=>Object.assign(new Error(message),{code});
function canonical(value){
 const raw=value?.cloud?.rawProject??value;if(!record(raw)||!id(raw.id))throw fail('Read the complete saved project before track history.');assertCompleteCanonicalData(raw,'lane creation history project');
 for(const key of collections){if(!Array.isArray(raw[key]))throw fail('Read the complete saved '+key+' before track history.');const seen=new Set();for(const row of raw[key]){if(!record(row)||!id(row.id)||seen.has(row.id))throw fail('Saved '+key+' identities are missing or duplicated.');seen.add(row.id);}if(raw.counts?.[key]!==undefined&&raw.counts[key]!==raw[key].length)throw fail('Track history counts do not match the complete saved project.');}
 return clone(raw);
}
function withoutLane(raw,laneId){const copy=clone(raw);copy.lanes=copy.lanes.filter(l=>l.id!==laneId);if(copy.counts?.lanes!==undefined)copy.counts.lanes=copy.lanes.length;return copy;}
function assertEmpty(raw,laneId){
 const references=raw.clips.some(c=>c.laneId===laneId||c.lane_id===laneId)||raw.placements.some(p=>p.laneId===laneId||p.lane_id===laneId)||raw.patterns.some(p=>{const content=p.pattern??p.data?.pattern??p;return(content.sources||[]).some(s=>s.laneId===laneId||s.lane_id===laneId);});
 if(references)throw fail('This lane now contains clips, placements or pattern sources. Undo its newer content first.');
}
function payload(result,projectId){
 let value=result?.structuredContent??result;for(let depth=0;depth<8;depth++){if(!record(value)||result?.isError||value.ok===false||value.applied===false||value.dry_run===true||value.error)throw fail('The lane history action was not acknowledged.');if(['projectId','project_id'].some(k=>value[k]!==undefined&&value[k]!==projectId))throw fail('The lane acknowledgement belongs to a different project.');if(!record(value.response))return value;value=value.response;}throw fail('Lane acknowledgement nesting exceeded its limit.');
}
export class LaneCreateHistoryController{
 constructor({before,after,laneId,getProject,getScope,read,call,flush=async()=>{},createId=()=>crypto.randomUUID(),onChange=()=>{}}={}){
  if(![getProject,getScope,read,call,flush,createId,onChange].every(fn=>typeof fn==='function'))throw TypeError('Track history needs scoped project/read/call callbacks.');Object.assign(this,{getProject,getScope,read,call,flush,createId,onChange});this.before=canonical(before);this.scope=clone(getScope());
  if(this.scope?.projectId!==this.before.id||!id(this.scope.trackId))throw fail('Capture the current project and take before adding a track.');
  this.busy=false;this.keys=new Set();this.state={status:'idle',scope:clone(this.scope),laneId:null,laneKind:null,createConfirmed:false,attempted:false,operationCommitted:false,knownNotApplied:true,rejected:false,error:null,receipts:[]};if(after!==undefined)this.adopt({after,laneId});
 }
 snapshot(){return clone({...this.state,busy:this.busy,canUndo:!this.busy&&this.state.status==='committed',canRedo:!this.busy&&this.state.status==='undone'});}
 notify(){try{this.onChange(this.snapshot());}catch{}}
 assert(){if(!same(this.scope,this.getScope()))throw Object.assign(fail('The track history project or take changed.','lane_create_history_scope_changed'),{name:'AbortError'});}
 adopt({after,laneId}={}){
  this.assert();if(this.busy||this.state.status!=='idle'||!id(laneId))throw fail('Adopt one newly confirmed empty lane once.');const raw=canonical(after),added=raw.lanes.filter(l=>!this.before.lanes.some(old=>old.id===l.id));
  if(raw.id!==this.before.id||added.length!==1||added[0].id!==laneId||!same(withoutLane(raw,laneId),this.before))throw fail('Track creation changed content beyond one new empty lane.');
  // Freestyle saves a software-instrument lane as kind "instrument" with trackType "plugin" (its generator is a
  // plug-in); trackType names the audio flavours (audio / vocal). Either field may carry the supported kind.
  const lane=added[0],allowed=['audio','vocal','instrument'],kind=allowed.includes(lane.trackType)?lane.trackType:lane.kind;if(!allowed.includes(kind)||lane.deleted===true)throw fail('Confirm the newly saved audio, vocal or instrument lane.');assertEmpty(raw,laneId);
  // A source-free instrument uses Pro's same saved lane restore. Native plug-in
  // readiness after restore is separate; saved plug-in metadata stays protected.
  this.lane=clone(lane);this.state={...this.state,status:'committed',laneId,laneKind:kind,createConfirmed:true,attempted:true,operationCommitted:true,knownNotApplied:false};this.notify();return this.snapshot();
 }
 failCreate({attempted,committed,uncertain,explicitRejection=false,error}={}){
  if(![attempted,committed,uncertain,explicitRejection].every(v=>typeof v==='boolean'))throw TypeError('Track failure needs explicit attempt, commit and uncertainty flags.');const knownNotApplied=!committed&&!uncertain&&(!attempted||explicitRejection);
  this.state={...this.state,status:knownNotApplied?'not_sent':'uncertain',attempted,operationCommitted:committed,knownNotApplied,error:String(error?.message||'Track creation was not confirmed.').slice(0,500)};this.notify();return this.snapshot();
 }
 async fresh(){this.assert();await this.read();this.assert();return canonical(this.getProject());}
 guard(raw,present){if(raw.id!==this.scope.projectId)throw fail('Read the same saved project before track history.');const matches=raw.lanes.filter(l=>l.id===this.state.laneId);if(present?matches.length!==1||!same(matches[0],this.lane):matches.length!==0)throw fail('The complete owned lane changed. Undo newer target edits before track history.');assertEmpty(raw,this.state.laneId);}
 revision(raw){const meta=raw._studioApi,tag=meta?.etag;if(meta?.projectId!=null&&meta.projectId!==raw.id||typeof tag!=='string'||!tag||/[\r\n]/.test(tag))throw fail('Read the current project ETag before track history.');return tag;}
 key(){for(let n=0;n<64;n++){const key=this.createId();if(typeof key==='string'&&/^[A-Za-z0-9._:-]{8,128}$/.test(key)&&!this.keys.has(key)){this.keys.add(key);return key;}}throw fail('Track history needs a fresh write key.');}
 undo(){return this.apply('undo');}redo(){return this.apply('redo');}
 async apply(direction){
  if(this.busy||this.state.status!==(direction==='undo'?'committed':'undone'))throw fail('Inspect the retained track before repeating history.');this.busy=true;this.state.knownNotApplied=true;this.state.rejected=false;this.state.error=null;const prior=this.state.status;let attempted=false,acknowledged=false;
  try{
   this.assert();await this.flush();const raw=await this.fresh();this.guard(raw,direction==='undo');const protectedBefore=withoutLane(raw,this.state.laneId),headers={ifMatch:this.revision(raw),idempotencyKey:this.key()},name=direction==='undo'?'delete_lane':'restore_lane',args={project_id:this.scope.projectId,lane_id:this.state.laneId,...direction==='redo'?{clip_ids:[]}:{}};
   const step={direction,name,status:'sending',idempotencyKey:headers.idempotencyKey};this.state.receipts.push(step);this.assert();attempted=true;this.state.attempted=true;this.state.knownNotApplied=false;this.notify();const result=await this.call(name,args,headers);acknowledged=true;this.assert();const receipt=payload(result,this.scope.projectId);
   if(receipt.ok!==true&&receipt.applied!==true||receipt.laneId!==undefined&&receipt.laneId!==this.state.laneId||receipt.engine_reload_required!==undefined&&typeof receipt.engine_reload_required!=='boolean')throw fail('The lane history acknowledgement did not confirm this saved lane.');
   if(direction==='undo'&&(!Array.isArray(receipt.deletedClipIds)||receipt.deletedClipIds.length!==0))throw fail('An empty lane deletion must confirm exactly zero deletedClipIds.');
   step.status='acknowledged';step.engineReloadRequired=receipt.engine_reload_required===true;const confirmed=await this.fresh();this.guard(confirmed,direction==='redo');if(!same(withoutLane(confirmed,this.state.laneId),protectedBefore))throw fail('Unrelated saved content changed during track history.');step.status='confirmed';this.state.status=direction==='undo'?'undone':'committed';this.state.operationCommitted=true;
  }catch(error){const rejected=attempted&&!acknowledged&&error.explicitRejection===true;this.state.knownNotApplied=!attempted||rejected;this.state.rejected=rejected;this.state.status=this.state.knownNotApplied?prior:'uncertain';this.state.error=String(error?.message||'Track history was not confirmed.').slice(0,500);throw Object.assign(error,{operationCommitted:acknowledged||error.operationCommitted===true,operationUncertain:!this.state.knownNotApplied,laneCreateHistory:{...this.snapshot(),busy:false}});
  }finally{this.busy=false;this.notify();}
  return this.snapshot();
 }
}
