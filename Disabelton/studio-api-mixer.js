/** Durable Studio API mixer controls. Saved state and engine ACKs stay distinct. */
import {StudioApiClient,STUDIO_API_OPERATIONS} from './studio-api-client.js';
import {assertCompleteCanonicalData,hasCanonicalTruncation} from './cloud-session.js';
import {isMixRevisionConflict,mixConflictError,mixControlValue,mixEtag,mixValuesEqual,MIX_CONFLICT_NOTICE} from './mix-revision.js';

const clone=value=>value==null?value:structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const list=value=>Array.isArray(value)?value:[];
const error=(message,code='studio_mixer_invalid_result')=>Object.assign(new Error(message),{code});
const controls={
 lane:{gain:{operation:'setLaneGain',field:'gain',saved:['volume']},pan:{operation:'setLanePan',field:'pan',saved:['pan'],persist:true},mute:{operation:'setLaneMute',field:'muted',saved:['muted']},solo:{operation:'setLaneSolo',field:'soloed',saved:['solo','soloed']}},
 // 338: bus pan is LIVE ONLY (setBusPan): not saved with the project, a reopened project starts centered.
 bus:{gain:{operation:'setBusGain',field:'gain',saved:['gain'],persist:true},pan:{operation:'setBusPan',field:'pan',saved:[],live:true},mute:{operation:'setBusMute',field:'muted',saved:['muted']},solo:{operation:'setBusSolo',field:'soloed',saved:['soloed','solo']}}
};
// 338: master pan is LIVE ONLY too (setMasterPan, not saved with the project).
const masterControls={gain:{operation:'setMasterGain',field:'gain',saved:['masterGain'],persist:true},pan:{operation:'setMasterPan',field:'pan',saved:[],live:true}};
const laneFields={gain:'volume',pan:'pan',mute:'muted',solo:'soloed'};
// updateLane with a mix If-Match needs a running engine with mix revisions: without one the saved row is the whole state.
const laneNotLive=failure=>(failure?.status??failure?.statusCode)===409&&['target_not_loaded','engine_unavailable','engine_update_required'].includes(failure?.code);
function currentProject(engine){return engine.project??engine.session?.project;}
function scoped(value,projectId){for(const key of ['project_id','projectId'])if(value?.[key]!=null&&value[key]!==projectId)throw error('The mixer response belongs to another project.','studio_mixer_scope_changed');}
function resultData(result,projectId){
 if(!record(result)||!Number.isInteger(result.status)||result.status<200||result.status>=300||!record(result.data))throw error('Studio API returned no complete mixer response.');
 let data=result.data;scoped(data,projectId);
 for(let depth=0;depth<5;depth++){
  if(data.error||data.ok===false||data.isError)throw Object.assign(error(typeof data.error==='string'?data.error:data.error?.message||data.message||'Studio API rejected the mixer request.',data.error?.code??data.code),{status:result.status,stage:data.error?.stage??data.stage,operationUncertain:data.error?.stage==='engine_dispatch'||data.stage==='engine_dispatch',explicitRejection:data.error?.stage!=='engine_dispatch'&&data.stage!=='engine_dispatch'});
  scoped(data,projectId);if(record(data.response)){data=data.response;continue;}if(!Object.keys(data).length)throw error('Studio API returned an empty mixer response.');return data;
 }
 throw error('Studio API returned an unsupported mixer response envelope.');
}
function targetControl(target,control,value,{validateValue=true}={}){
 if(!record(target)||!['lane','bus'].includes(target.kind)||!identity(target.id))throw error('Choose a durable Studio API lane or bus.','studio_mixer_invalid_input');
 const master=target.kind==='bus'&&target.id==='master';
 if(master&&!masterControls[control]||!controls[target.kind]?.[control])throw error('This Studio API mixer control is not supported.','studio_mixer_invalid_input');
 const definition=master?masterControls[control]:controls[target.kind][control];
 const operation=STUDIO_API_OPERATIONS[definition.operation],schema=operation?.requestBody?.content?.['application/json']?.schema?.properties?.[definition.field];
 if(!schema)throw error('The Studio API mixer contract is unavailable.','studio_mixer_contract_unavailable');
 if(validateValue){
  if(schema.type==='boolean'?typeof value!=='boolean':!finite(value)||schema.minimum!=null&&value<schema.minimum||schema.maximum!=null&&value>schema.maximum)throw error('The mixer value is outside its documented Studio API range.','studio_mixer_invalid_input');
 }
 return{...definition,target:{kind:target.kind,id:target.id},control,master};
}
function savedValue_(row,definition){return savedValue(row,definition);}
function savedValue(row,definition){
 const values=definition.saved.filter(key=>own(row,key)).map(key=>row[key]);
 if(!values.length||values.some(value=>value!==values[0]))throw error('Read an unambiguous saved mixer value before changing this control.');
 const value=values[0];targetControl(definition.target,definition.control,value);return value;
}
function projectLanes(project){
 const explicit=project.truncated?.lanes??project.lanesTruncated??project.lanes_truncated;
 const global=project._truncated===true||project.truncated===true;
 return Array.isArray(project.lanes)&&explicit!==true&&(!global||explicit===false)&&!hasCanonicalTruncation(project.lanes)?project.lanes:null;
}
// Engine gains read back as float32 (0.4 → 0.4000000059604645): relative tolerance.
function matchesValue(value,requested){return typeof requested==='number'?finite(value)&&mixValuesEqual(value,requested):value===requested;}
function acceptsMixRevision(operationId){return !!STUDIO_API_OPERATIONS[operationId]?.requestBody?.content?.['application/json']?.schema?.properties?.expected_mix_revision;}
/** One mix:apply item (one value per control). Bus/master pan (338) are live only. */
function applyItem(definition,value){
 const field={gain:'gain',pan:'pan',mute:'muted',solo:'soloed'}[definition.control];
 if(definition.master)return{target:'master',[field]:value};
 return definition.target.kind==='lane'?{target:'lane',lane_id:definition.target.id,[field]:value}:{target:'bus',bus_id:definition.target.id,[field]:value};
}
/** mix:apply items (e.g. response.undo_changes) back to {target,control,value}. */
export function mixChangesFromApply(items){
 if(!Array.isArray(items)||!items.length)throw error('Freestyle returned no mix:apply undo changes.');
 const changes=[];
 for(const item of items){
  if(!record(item))throw error('Freestyle returned an invalid mix:apply change.');
  const target=item.target==='master'?{kind:'bus',id:'master'}:item.target==='lane'&&identity(item.lane_id)?{kind:'lane',id:item.lane_id}:item.target==='bus'&&identity(item.bus_id)?{kind:'bus',id:item.bus_id}:null;
  if(!target)throw error('A mix:apply change has no durable lane or bus identity.');
  for(const [field,control]of [['gain','gain'],['pan','pan'],['muted','mute'],['soloed','solo']])if(own(item,field))changes.push({target,control,value:item[field]});
  if(item.target==='lane'&&own(item,'bus_id'))throw error('Lane routing changes are not mixer-strip controls.','studio_mixer_invalid_input');
 }
 return changes;
}
function isConflict(error){return [409,412].includes(error?.status??error?.statusCode);}
function explicitRejection(error){return error?.operationUncertain!==true&&(error?.dispatched===false||error?.explicitRejection===true||[400,401,403,404,409,412,422,428,429].includes(error?.status??error?.statusCode));}

export class StudioApiMixer{
 constructor({engine,client=new StudioApiClient(),onChange=()=>{},onApplied=async()=>{},persistLaneMix=false,savedLaneMix=false,mixRevision=null,idFactory=()=>globalThis.crypto.randomUUID()}={}){
  if(!engine?.session||typeof client?.call!=='function'||typeof idFactory!=='function')throw new TypeError('Studio API mixer needs an engine, generated client and key factory.');
  Object.assign(this,{engine,client,onChange,onApplied,persistLaneMix,savedLaneMix,idFactory,mixRevision});this.operation=null;this.records=[];this.sequence=0;this.destroyed=false;this.generation=0;this.read=null;
 }
 get isRestMode(){return currentProject(this.engine)?.cloud?.rawState?.studioApi===true;}
 get busy(){return !!this.operation;}
 capture(){
  const {engine}=this,project=currentProject(engine),projectId=engine.projectId,trackId=engine.session.trackId||null;
  if(this.destroyed||!this.isRestMode||!engine.ready||engine.loading||!identity(projectId)||engine.session.projectId!==projectId||project?.cloud?.projectId!==projectId||trackId!==null&&(!identity(trackId)||trackId.length>64))throw error('Load a Studio API project before using its mixer.','studio_mixer_scope_changed');
  return{projectId,trackId,loadVersion:engine.loadVersion||0,contextVersion:engine.session.contextVersion||0};
 }
 current(scope,generation=this.generation){try{return generation===this.generation&&same(scope,this.capture());}catch{return false;}}
 assert(scope,generation){if(!this.current(scope,generation))throw Object.assign(error('The project or engine context changed during mixer control.','studio_mixer_scope_changed'),{name:'AbortError',dispatched:false});}
 snapshot(){
  let scope=null;try{scope=this.capture();}catch{}
  const receipt=this.records.filter(entry=>scope&&same(entry.scope,scope)).at(-1)??null;
  return clone({scope,isRestMode:this.isRestMode,busy:this.busy,status:this.operation?.phase??receipt?.status??'idle',receipt,records:this.records,read:this.read&&scope&&same(this.read.scope,scope)?this.read:null,audioVerified:false});
 }
 notify(){const state=this.snapshot();if(!this.destroyed)try{this.onChange(state);}catch{}return state;}
 async listAll(operationId,scope,generation){
  const rows=[],cursors=new Set();let cursor=null,etag=null;
  for(let page=0;page<128;page++){
   this.assert(scope,generation);const result=await this.client.call(operationId,{path:{project_id:scope.projectId},query:{limit:200,...cursor?{cursor}:{}}});this.assert(scope,generation);
   const data=resultData(result,scope.projectId);assertCompleteCanonicalData(data,'Studio API mixer list');const pagination=data.pagination;
   if(!Array.isArray(data.data)||!data.data.every(record)||!record(pagination)||typeof pagination.hasMore!=='boolean'||pagination.nextCursor!==null&&(!identity(pagination.nextCursor)&&!(typeof pagination.nextCursor==='string'&&pagination.nextCursor.length<=512&&pagination.nextCursor.length>0)))throw error('Studio API returned an incomplete mixer page.');
   rows.push(...data.data);etag=result.etag??etag;
   if(!pagination.hasMore){if(pagination.nextCursor!==null)throw error('The mixer page has conflicting completion metadata.');return{rows,etag};}
   if(typeof pagination.nextCursor!=='string'||!pagination.nextCursor||cursors.has(pagination.nextCursor))throw error('The mixer page cursor did not advance.');cursors.add(pagination.nextCursor);cursor=pagination.nextCursor;
  }
  throw error('The mixer list exceeds its safe paging bound.');
 }
 async readSaved(definition,scope,generation){
  this.assert(scope,generation);const path={project_id:scope.projectId};let row,etag,source;
  if(definition.master||definition.target.kind==='lane'){
   const result=await this.client.call('getProject',{path});this.assert(scope,generation);const project=resultData(result,scope.projectId);
   if(project.id!==scope.projectId)throw error('The saved mixer project identity is inconsistent.');etag=result.etag??null;source='getProject';
   if(definition.master)row=project;
   else{let lanes=projectLanes(project);if(!lanes){const listed=await this.listAll('listLanes',scope,generation);lanes=listed.rows;etag=listed.etag??etag;source='listLanes';}const matches=lanes.filter(lane=>lane?.id===definition.target.id);if(matches.length!==1)throw error('The saved mixer lane is missing or ambiguous.');row=matches[0];}
  }else{
   const listed=await this.listAll('listBuses',scope,generation);etag=listed.etag;source='listBuses';
   const matches=listed.rows.filter(bus=>bus.id===definition.target.id||bus.busId===definition.target.id||bus.bus_id===definition.target.id);if(matches.length!==1)throw error('The saved mixer bus is missing or ambiguous.');row=matches[0];
   const ids=['id','busId','bus_id'].filter(key=>row[key]!=null).map(key=>row[key]);if(ids.some(id=>id!==definition.target.id))throw error('The saved mixer bus identity is inconsistent.');
  }
  this.assert(scope,generation);scoped(row,scope.projectId);if(!definition.master)assertCompleteCanonicalData(row,'saved mixer target');if(source!=='listBuses')this.noteSavedTag(scope,etag,definition.target.kind==='lane'&&!definition.master?row:null);const result={scope:clone(scope),target:clone(definition.target),control:definition.control,savedValue:savedValue(row,definition),etag:etag??null,source};this.read=clone(result);return result;
 }
 /** The project ETag of the newest saved read or lane PATCH reply in this scope. */
 noteSavedTag(scope,etag,lane=null){if(typeof etag==='string'&&etag)this.savedTag={scope:clone(scope),etag,raw:currentProject(this.engine)?.cloud?.rawProject??null,lanes:record(lane)&&identity(lane.id)?{[lane.id]:clone(lane)}:{}};}
 /** A canonical read accepted after our last saved read/PATCH is newer. */
 heldSaved(definition,scope){
  const project=currentProject(this.engine)?.cloud?.rawProject,canonical=project?.id===scope.projectId&&typeof project?._studioApi?.etag==='string'&&project._studioApi.etag?project._studioApi.etag:null,ours=this.savedTag&&same(this.savedTag.scope,scope)?this.savedTag:null;
  const useOurs=!!ours&&(ours.raw===project||!canonical),held=useOurs?ours.etag:canonical;
  // The saved row as of that ETag (for an exact compensating write): our own read/PATCH reply, else the canonical read.
  const id=definition.target.id,lane=useOurs?ours.lanes?.[id]??null:list(project?.lanes).filter(item=>item?.id===id).length===1?list(project.lanes).find(item=>item?.id===id):null;
  let savedValue;if(lane&&held&&definition.target.kind==='lane'&&!definition.master)try{savedValue=savedValue_(lane,definition);}catch{savedValue=undefined;}
  return{scope:clone(scope),target:clone(definition.target),control:definition.control,savedValue,etag:held,source:'held'};
 }
 key(){const key=this.idFactory();if(typeof key!=='string'||key.length<8||key.length>128||!/^[-A-Za-z0-9._:]+$/.test(key))throw error('The mixer needs a retained valid idempotency key.','studio_mixer_invalid_key');return key;}
 /** Mix writes are guarded by the live mix revision when it is known. */
 mixGuarded(scope){return !!this.mixRevision?.available?.(scope.projectId);}
 /** The optional engine-context track_id (omitted for the default take). */
 contextTrack(scope){
  const project=currentProject(this.engine)?.cloud?.rawProject,clips=project?.id===scope.projectId&&project._studioApi&&project.truncated?.clips!==true&&project.clipsTruncated!==true&&project.clips_truncated!==true&&Array.isArray(project.clips)&&!hasCanonicalTruncation(project.clips)&&project.clips.every(clip=>identity(clip?.id)&&(clip.deleted==null||typeof clip.deleted==='boolean')&&(clip.isBacking==null||typeof clip.isBacking==='boolean'))?project.clips:null,first=clips?.find(clip=>identity(clip?.id)&&!clip.deleted&&!clip.isBacking),useDefault=!!first&&first.id===scope.trackId&&clips.filter(clip=>clip.id===scope.trackId).length===1;
  return scope.trackId&&!useDefault?{track_id:scope.trackId}:{};
 }
 request(definition,scope,value,read,expectedRevision=null){
  const operation=STUDIO_API_OPERATIONS[definition.operation],path={project_id:scope.projectId,...definition.master?{}:definition.target.kind==='lane'?{lane_id:definition.target.id}:{bus_id:definition.target.id}},body={[definition.field]:value,...definition.persist?{persist:true}:{},...this.contextTrack(scope)};
  // The engine compares If-Match / expected_mix_revision with the live mix
  // revision, so a project/list ETag never goes there once revisions exist.
  if(expectedRevision!==null&&acceptsMixRevision(definition.operation))return{operationId:definition.operation,path,body:{...body,expected_mix_revision:expectedRevision},idempotencyKey:this.key()};
  const match=operation.parameters.find(parameter=>parameter.in==='header'&&parameter.name.toLowerCase()==='if-match');if(match?.required&&!read.etag)throw error('Read the current mixer ETag before changing this value.','studio_mixer_precondition_required');
  return{operationId:definition.operation,path,body,idempotencyKey:this.key(),...read.etag?{ifMatch:read.etag}:{}};
 }
 async send(request){return this.client.call(request.operationId,{path:clone(request.path),body:clone(request.body)},{idempotencyKey:request.idempotencyKey,...request.ifMatch?{ifMatch:request.ifMatch}:{}});}
 // A saved-lane write sets one absolute field after a fresh read and If-Match,
 // so whatever an earlier saved-lane write did (conflict, lost reply, value
 // changed afterwards by an undo) the next one is still exact: those receipts
 // never lock the mixer. Engine-setter receipts keep requiring inspection.
 recoveryNeeded(scope){return this.records.some(entry=>same(entry.scope,scope)&&!entry.inspected&&entry.route!=='saved_lane'&&['uncertain','saved_unconfirmed','saved_read_failed','conflict'].includes(entry.status));}
 /** `expected` (history inverse guard): write only if the fresh saved value still
  * equals it; otherwise refuse before dispatch with studio_mixer_history_conflict. */
 setControl(target,control,value,{expected}={}){
  let scope,definition,intent;try{definition=targetControl(target,control,value);scope=this.capture();intent={scope,target:definition.target,control,value,...expected!==undefined?{expected}:{}};if(this.operation){if(this.operation.kind==='write'&&same(this.operation.intent,intent))return this.operation.promise;throw error('Wait for the current Studio API mixer request.','studio_mixer_busy');}if(this.engine.applying||this.engine.interacting)throw error('Finish the current edit before changing the mixer.','studio_mixer_busy');if(this.recoveryNeeded(scope))throw error('Inspect the previous mixer result before another edit. It will not be replayed.','studio_mixer_recovery_required');if(!this.savedRoute(definition,value,this.mixGuarded(scope))&&this.records.some(entry=>same(entry.intent,intent)&&entry.attempted&&!entry.savedConfirmed&&entry.status!=='not_sent'&&entry.status!=='rejected'&&entry.status!=='conflict'&&entry.status!=='confirmed_live'))throw error('This mixer apply already has an unresolved receipt. It will not be repeated.','studio_mixer_recovery_required');}catch(failure){return Promise.reject(failure);}
  const generation=this.generation,entry={sequence:++this.sequence,scope:clone(scope),intent:clone(intent),target:clone(definition.target),control,requested:value,status:'preparing',attempted:false,liveApplyAcknowledged:false,savedConfirmed:false,audioVerified:false,before:null,after:null,request:null,receipt:null,error:null,detached:false},operation={kind:'write',intent,scope,phase:'preparing',promise:null};this.operation=operation;this.records.push(entry);
  operation.promise=(async()=>{try{
   await this.engine.flush?.();this.assert(scope,generation);
   const guarded=this.mixGuarded(scope),fast=guarded&&expected===undefined,changes=[{target:definition.target,control,value}];let expectedRevision;
   if(definition.live){await this.liveOnlyWrite(entry,definition,scope,generation,operation,{guarded,expected,changes});await this.applied(entry,scope,generation);return;}
   if(fast){
    // FL / Studio Pro feel: no pre-read. The held revision is kept current by
    // the mix:wait loop and by write receipts; the server's compare-and-set
    // covers the rest, and only a 412 costs one fresh read. When one of our own
    // realtime sends is known to be unobserved (it moved the revision), that
    // one read happens first instead of after a certain 412.
    entry.before=this.heldSaved(definition,scope);
    if(this.mixRevision.ownPending?.()){entry.preRead=true;expectedRevision=await this.mixRevision.guard(changes,{projectId:scope.projectId});}
    else{this.mixRevision.noteOwn(definition.target,control,value);expectedRevision=this.mixRevision.revision;}
    this.assert(scope,generation);
   }else{
    // History Undo/Redo (and unguarded engines): the saved read and a fresh
    // live-mix read run together; the guard refuses before dispatch if someone
    // else moved this control.
    [entry.before,expectedRevision]=await Promise.all([this.readSaved(definition,scope,generation),guarded?this.mixRevision.guard(changes,{projectId:scope.projectId}):null]);this.assert(scope,generation);
   }
   if(expected!==undefined&&!matchesValue(entry.before.savedValue,expected))throw Object.assign(error('This mixer control changed after that edit. Undo will not overwrite the newer value.','studio_mixer_history_conflict'),{dispatched:false,explicitRejection:true,savedValue:entry.before.savedValue,expected});
   if(expectedRevision!=null)entry.expectedMixRevision=expectedRevision;
   if(this.savedRoute(definition,value,expectedRevision!=null)){await this.saveLaneDirect(entry,definition,scope,generation,operation);await this.applied(entry,scope,generation);return;}
   // 338: one updateLane guarded by If-Match "mix-<n>" applies the lane's mix
   // field to the running engine (atomic compare-and-set) and saves the row.
   if(expectedRevision!=null&&this.laneMixRoute(definition,value)){await this.saveLaneGuarded(entry,definition,scope,generation,operation,expectedRevision,changes);await this.applied(entry,scope,generation);return;}
   let result;
   for(let attempt=0;;attempt++){
    entry.request=this.request(definition,scope,value,entry.before,expectedRevision??null);this.assert(scope,generation);entry.status='pending';operation.phase='applying';this.notify();entry.attempted=true;
    try{result=await this.send(entry.request);break;}
    catch(failure){
     if(expectedRevision==null||!isMixRevisionConflict(failure)||!this.current(scope,generation))throw failure;
     // 412: adopt the server mix. Our own realtime fader messages also move
     // the revision; only when every change since our baseline was ours (the
     // control is untouched by anyone else) is the write sent once more.
     const resolution=await this.mixRevision.resolveConflict(failure);entry.mixConflicts=(entry.mixConflicts||0)+1;
     if(attempt>0||!resolution.explained||resolution.revision==null)throw this.mixConflict(failure,resolution);
     expectedRevision=resolution.revision;entry.expectedMixRevision=expectedRevision;
    }
   }
   this.mixRevision?.noteWrite?.(result,changes,{expected:expectedRevision??null});entry.receipt=clone(result.data);entry.liveReceipt=clone(resultData(result,scope.projectId));assertCompleteCanonicalData(entry.liveReceipt,'mixer acknowledgement');if(own(entry.liveReceipt,'engine_reload_required')&&typeof entry.liveReceipt.engine_reload_required!=='boolean')throw error('Studio API returned an invalid mixer reload acknowledgement.');entry.liveApplyAcknowledged=true;entry.engineReloadRequired=typeof entry.liveReceipt.engine_reload_required==='boolean'?entry.liveReceipt.engine_reload_required:null;
   this.assert(scope,generation);entry.status='acknowledged';this.notify();
   if(guarded){await this.followSaved(entry,definition,scope,generation,operation);await this.applied(entry,scope,generation);return;}
   operation.phase='confirming';entry.after=await this.readSaved(definition,scope,generation);entry.savedConfirmed=matchesValue(entry.after.savedValue,value);entry.status=entry.savedConfirmed?'confirmed':'saved_unconfirmed';await this.applied(entry,scope,generation);
  }catch(failure){this.failed(entry,failure);throw Object.assign(failure,{studioMixerReceipt:clone(entry)});}finally{entry.detached=!this.current(scope,generation);if(this.operation===operation)this.operation=null;this.notify();}})().then(()=>({receipt:clone(entry),liveApplyAcknowledged:entry.liveApplyAcknowledged,savedConfirmed:entry.savedConfirmed,audioVerified:false,snapshot:this.snapshot()}));this.notify();return operation.promise;
 }
 /** 338: lane gain (≤4, the saved range), pan, mute and solo — pattern lanes
  * included — go through ONE updateLane guarded by the live mix revision. */
 laneMixRoute(definition,value){return definition.target.kind==='lane'&&!definition.master&&!!laneFields[definition.control]&&!(definition.control==='gain'&&!(finite(value)&&value>=0&&value<=4));}
 async saveLaneGuarded(entry,definition,scope,generation,operation,revision,changes){
  const field=laneFields[entry.control];entry.route='lane_mix';
  for(let attempt=0;;attempt++){
   entry.request={operationId:'updateLane',path:{project_id:scope.projectId,lane_id:entry.target.id},body:{[field]:entry.requested},idempotencyKey:this.key(),ifMatch:mixEtag(revision)};
   this.assert(scope,generation);entry.status='pending';operation.phase='applying';this.notify();entry.attempted=true;
   let result;
   try{result=await this.send(entry.request);}
   catch(failure){
    // No running engine (or one without mix revisions, or a lane it has not
    // loaded): nothing was applied, and the saved row is the whole state.
    if(attempt===0&&laneNotLive(failure)&&this.current(scope,generation)){entry.engineNotLoaded=true;entry.attempted=false;entry.route='saved_lane';entry.request=null;await this.patchSavedLane(entry,definition,scope,generation,operation);return;}
    if(!isMixRevisionConflict(failure)||!this.current(scope,generation))throw failure;
    // 412: adopt the server mix; resend once only when every change since our baseline was ours.
    const resolution=await this.mixRevision.resolveConflict(failure);entry.mixConflicts=(entry.mixConflicts||0)+1;
    if(attempt>0||!resolution.explained||resolution.revision==null)throw this.mixConflict(failure,resolution);
    revision=resolution.revision;entry.expectedMixRevision=revision;continue;
   }
   this.mixRevision?.noteWrite?.(result,changes,{expected:revision});entry.receipt=clone(result.data);const data=resultData(result,scope.projectId);entry.savedAcknowledged=true;
   // The mix apply runs before the row is saved and refuses with 412 as a whole, so an OK reply is the live acknowledgement too.
   entry.liveApplyAcknowledged=data.liveMix?.applied!==false;
   const lane=record(data.lane)&&data.lane.id===entry.target.id?data.lane:null;this.noteSavedTag(scope,result.etag,lane);this.assert(scope,generation);
   const fields=definition.saved.filter(key=>lane&&own(lane,key)),replied=fields.length&&fields.every(key=>lane[key]===lane[fields[0]])?lane[fields[0]]:undefined;
   if(replied!==undefined&&matchesValue(replied,entry.requested)){entry.after={scope:clone(scope),target:clone(entry.target),control:entry.control,savedValue:replied,etag:result.etag??null,source:'updateLane'};this.read=clone(entry.after);}
   else{operation.phase='confirming';entry.status='acknowledged';this.notify();entry.after=await this.readSaved(definition,scope,generation);}
   entry.savedConfirmed=matchesValue(entry.after.savedValue,entry.requested);entry.status=entry.savedConfirmed?'confirmed':'saved_unconfirmed';return;
  }
 }
 /** Bus / master pan (338): LIVE ONLY. setBusPan / setMasterPan change the
  * running engine's mix and are NOT saved with the project (a reopened project
  * starts centered), so there is no saved read: the guard and the history
  * `expected` check use the live mix, and the receipt confirms the live value. */
 async liveOnlyWrite(entry,definition,scope,generation,operation,{guarded,expected,changes}){
  entry.route='live_only';entry.liveOnly=true;
  if(!guarded)throw Object.assign(error('Bus and master pan need the live mix. Reload the mixer.','studio_mixer_contract_unavailable'),{dispatched:false,explicitRejection:true});
  let revision;if(expected===undefined&&!this.mixRevision.ownPending?.()){this.mixRevision.noteOwn(definition.target,entry.control,entry.requested);revision=this.mixRevision.revision;}else revision=await this.mixRevision.guard(changes,{projectId:scope.projectId});
  this.assert(scope,generation);const read=mixControlValue(this.mixRevision.mix,definition.target,entry.control);
  entry.before={scope:clone(scope),target:clone(definition.target),control:entry.control,savedValue:read.known?read.value:undefined,etag:null,source:'live_mix'};
  if(expected!==undefined&&(!read.known||!matchesValue(read.value,expected)))throw Object.assign(error('This mixer control changed after that edit. Undo will not overwrite the newer value.','studio_mixer_history_conflict'),{dispatched:false,explicitRejection:true,expected});
  let result;
  for(let attempt=0;;attempt++){
   entry.expectedMixRevision=revision;entry.request=this.request(definition,scope,entry.requested,entry.before,revision);this.assert(scope,generation);entry.status='pending';operation.phase='applying';this.notify();entry.attempted=true;
   try{result=await this.send(entry.request);break;}
   catch(failure){
    if(!isMixRevisionConflict(failure)||!this.current(scope,generation))throw failure;
    const resolution=await this.mixRevision.resolveConflict(failure);entry.mixConflicts=(entry.mixConflicts||0)+1;
    if(attempt>0||!resolution.explained||resolution.revision==null)throw this.mixConflict(failure,resolution);
    revision=resolution.revision;
   }
  }
  this.mixRevision.noteWrite(result,changes,{expected:revision});entry.receipt=clone(result.data);entry.liveReceipt=clone(resultData(result,scope.projectId));entry.liveApplyAcknowledged=true;this.assert(scope,generation);
  entry.after={scope:clone(scope),target:clone(definition.target),control:entry.control,savedValue:undefined,liveValue:entry.requested,etag:null,source:'live'};entry.savedConfirmed=false;entry.status='confirmed_live';
 }
 /** Studio Pro's lane fader/M/S persistence: realtime audio goes over the
  * mozart-control channel and the durable value is a guarded lane PATCH
  * (`fse(project,lane,{volume|muted|soloed})`). The typed engine setters
  * (setLaneGain/Mute/Solo) validate against a server-side live session: on the
  * live project they took ~32 s and rejected lanes that session had not loaded
  * ("No live engine track matches '<lane>'"), and setLaneMute also applies the
  * Studio M-button clip mute. So UI lane mix writes only the changed field.
  * Agent-safe mixing: once a live mix revision is known, the lane PATCH itself
  * carries it (338: If-Match "mix-<n>", see saveLaneGuarded), so this
  * project-ETag-only route is for engines without mix revisions. */
 savedRoute(definition,value,mixGuarded=false){return !mixGuarded&&this.savedLaneMix===true&&definition.target.kind==='lane'&&!definition.master&&['gain','mute','solo'].includes(definition.control)&&!(definition.control==='gain'&&!(finite(value)&&value>=0&&value<=4));}
 async saveLaneDirect(entry,definition,scope,generation,operation){
  const field={gain:'volume',pan:'pan',mute:'muted',solo:'soloed'}[entry.control],contract=STUDIO_API_OPERATIONS.updateLane,match=contract?.parameters?.find(parameter=>parameter.in==='header'&&parameter.name.toLowerCase()==='if-match');
  if(!contract)throw error('The Studio API lane contract is unavailable.','studio_mixer_contract_unavailable');
  if(match?.required&&!entry.before.etag)throw error('Read the current lane ETag before saving its mix.','studio_mixer_precondition_required');
  entry.route='saved_lane';entry.request={operationId:'updateLane',path:{project_id:scope.projectId,lane_id:entry.target.id},body:{[field]:entry.requested},idempotencyKey:this.key(),...entry.before.etag?{ifMatch:entry.before.etag}:{}};
  this.assert(scope,generation);entry.status='pending';operation.phase='saving';this.notify();entry.attempted=true;
  const result=await this.send(entry.request);entry.receipt=clone(result.data);const data=resultData(result,scope.projectId);entry.savedAcknowledged=true;this.assert(scope,generation);
  // The PATCH reply carries the saved lane; confirm from it, else read back once.
  const lane=record(data.lane)&&data.lane.id===entry.target.id?data.lane:null;
  if(lane&&own(lane,field)&&matchesValue(lane[field],entry.requested)){entry.after={scope:clone(scope),target:clone(entry.target),control:entry.control,savedValue:lane[field],etag:result.etag??null,source:'updateLane'};this.read=clone(entry.after);}
  else{operation.phase='confirming';entry.status='acknowledged';this.notify();entry.after=await this.readSaved(definition,scope,generation);}
  entry.savedConfirmed=matchesValue(entry.after.savedValue,entry.requested);entry.status=entry.savedConfirmed?'confirmed':'saved_unconfirmed';
 }
 /** The saved side of a guarded live write, without confirming reads:
  * - lane controls within the saved range never get here (saveLaneGuarded);
  *   a lane gain above 4 (setLaneGain allows 16) has no saved volume;
  * - master/bus gain (persist:true) are persisted by the setter itself
  *   (documented), so its receipt confirms them;
  * - bus mute/solo keep one confirming read. */
 async followSaved(entry,definition,scope,generation,operation){
  const lane=definition.target.kind==='lane'&&!definition.master,control=entry.control,value=entry.requested;
  if(lane&&control==='gain'&&!(finite(value)&&value<=4)){entry.savedConfirmed=false;entry.status='saved_unconfirmed';return;}
  if(definition.target.kind==='bus'&&!definition.master&&control!=='gain'){operation.phase='confirming';entry.after=await this.readSaved(definition,scope,generation);entry.savedConfirmed=matchesValue(entry.after.savedValue,value);entry.status=entry.savedConfirmed?'confirmed':'saved_unconfirmed';return;}
  entry.after={scope:clone(scope),target:clone(entry.target),control,savedValue:value,etag:null,source:'setter'};entry.savedConfirmed=true;entry.status='confirmed';
 }
 async patchSavedLane(entry,definition,scope,generation,operation){
  const field={gain:'volume',pan:'pan',mute:'muted',solo:'soloed'}[entry.control];let tag=entry.before?.etag??null;
  const confirmFrom=read=>{entry.after=read;entry.savedConfirmed=matchesValue(read.savedValue,entry.requested);entry.status=entry.savedConfirmed?'confirmed':'saved_unconfirmed';if(entry.persistence)entry.persistence.status=entry.status;};
  if(!tag){const read=await this.readSaved(definition,scope,generation);tag=read.etag;if(matchesValue(read.savedValue,entry.requested))return confirmFrom(read);}
  for(let attempt=0;;attempt++){
   const request={operationId:'updateLane',path:{project_id:scope.projectId,lane_id:entry.target.id},body:{[field]:entry.requested},idempotencyKey:this.key(),...tag?{ifMatch:tag}:{}},stage={status:'pending',attempted:true,acknowledged:false,request};entry.persistence=stage;
   operation.phase='saving';this.assert(scope,generation);this.notify();
   let result;
   try{result=await this.send(request);}
   catch(failure){
    const status=failure?.status??failure?.statusCode;
    if(attempt===0&&[409,412].includes(status)&&this.current(scope,generation)){entry.heldStale=true;const read=await this.readSaved(definition,scope,generation);tag=read.etag;if(matchesValue(read.savedValue,entry.requested)){stage.status='not_needed';return confirmFrom(read);}stage.status='conflict';continue;}
    stage.error=failure.message;stage.status=explicitRejection(failure)?isConflict(failure)?'conflict':'rejected':'uncertain';throw failure;
   }
   stage.receipt=clone(result.data);const data=resultData(result,scope.projectId);stage.acknowledged=true;entry.savedAcknowledged=true;this.noteSavedTag(scope,result.etag,record(data.lane)&&data.lane.id===entry.target.id?data.lane:null);this.assert(scope,generation);
   const lane=record(data.lane)&&data.lane.id===entry.target.id?data.lane:null;
   // The reply's saved row (solo is stored as `solo` and/or `soloed`; every present alias must agree).
   const fields=definition.saved.filter(key=>lane&&own(lane,key)),replied=fields.length&&fields.every(key=>lane[key]===lane[fields[0]])?lane[fields[0]]:undefined;
   if(replied!==undefined&&matchesValue(replied,entry.requested)){const read={scope:clone(scope),target:clone(entry.target),control:entry.control,savedValue:replied,etag:result.etag??null,source:'updateLane'};this.read=clone(read);return confirmFrom(read);}
   operation.phase='confirming';return confirmFrom(await this.readSaved(definition,scope,generation));
  }
 }
 /** A refused mix write changed nothing and the server mix was adopted. */
 mixConflict(failure,resolution={}){return Object.assign(failure,{message:MIX_CONFLICT_NOTICE,mixRevisionConflict:true,historyNotApplied:true,explicitRejection:true,operationUncertain:false,...resolution.revision!=null?{currentMixRevision:resolution.revision}:{}});}
 failed(entry,failure){if(isMixRevisionConflict(failure)){this.mixConflict(failure);entry.inspected=true;entry.mixRevisionConflict=true;}entry.error=failure.message;if(failure.dispatched===false&&!entry.liveApplyAcknowledged&&!entry.savedAcknowledged)entry.attempted=false;entry.status=entry.persistence?.status==='uncertain'?'uncertain':entry.liveApplyAcknowledged||entry.savedAcknowledged?(isConflict(failure)?'conflict':'saved_read_failed'):!entry.attempted?'not_sent':explicitRejection(failure)?isConflict(failure)?'conflict':'rejected':'uncertain';}
 async applied(entry,scope,generation){
  if(!this.current(scope,generation))return;try{await this.onApplied(clone(entry),{scope:clone(scope),saved:clone(entry.after)});}catch(failure){entry.displayError=failure.message;if(entry.savedConfirmed)entry.status='confirmed_refresh_pending';}
 }
 inspect(target,control){
  let scope,definition;try{scope=this.capture();definition=targetControl(target,control,undefined,{validateValue:false});if(this.operation)throw error('Wait for the current mixer request.','studio_mixer_busy');}catch(failure){return Promise.reject(failure);}
  const generation=this.generation,operation={kind:'inspect',scope,phase:'inspecting',promise:null};this.operation=operation;
  operation.promise=(async()=>{try{const saved=definition.live?await this.readLive(definition,scope,generation):await this.readSaved(definition,scope,generation);for(const entry of this.records.filter(entry=>same(entry.scope,scope)&&same(entry.target,definition.target)&&entry.control===control)){entry.inspected=true;entry.inspection=clone(saved);if(matchesValue(saved.savedValue,entry.requested)){entry.savedConfirmed=true;if(entry.liveApplyAcknowledged)entry.status='confirmed_by_inspection';}}return saved;}finally{if(this.operation===operation)this.operation=null;this.notify();}})();this.notify();return operation.promise;
 }
 /** A live-only control (bus/master pan) read from a fresh live mix. */
 async readLive(definition,scope,generation){
  this.assert(scope,generation);if(!this.mixGuarded(scope))throw error('Read the live mix before inspecting bus or master pan.','studio_mixer_contract_unavailable');
  await this.mixRevision.refresh({source:'inspect'});this.assert(scope,generation);const read=mixControlValue(this.mixRevision.mix,definition.target,definition.control);
  if(!read.known)throw error('The live mix does not report this control.');return{scope:clone(scope),target:clone(definition.target),control:definition.control,savedValue:read.value,etag:null,source:'live_mix'};
 }
 /** Several mixer controls as ONE mix:apply step: all or nothing, one mix
  * revision step, guarded by expected_mix_revision. Resolves with the
  * response's undo_changes for the history inverse. `expected` (history guard):
  * [{target,control,value}] each control's live value must still equal. */
 applyMix(changes,{expected=null}={}){
  let scope,definitions;
  try{
   if(!Array.isArray(changes)||!changes.length||changes.length>64)throw error('Choose 1–64 mixer controls for one mix step.','studio_mixer_invalid_input');
   definitions=changes.map(change=>({definition:targetControl(change?.target,change?.control,change?.value),value:change.value}));
   if(new Set(definitions.map(({definition})=>JSON.stringify([definition.target,definition.control]))).size!==definitions.length)throw error('Each mixer control may change only once per mix step.','studio_mixer_invalid_input');
   if(expected!==null&&(!Array.isArray(expected)||!expected.every(item=>record(item?.target)&&typeof item.control==='string')))throw error('A history mix step needs its expected control values.','studio_mixer_invalid_input');
   scope=this.capture();
   if(!this.mixGuarded(scope))throw error('Multi-control mixer moves need the live mix revision. Reload the mixer.','studio_mixer_contract_unavailable');
   if(this.operation)throw error('Wait for the current Studio API mixer request.','studio_mixer_busy');
   if(this.engine.applying||this.engine.interacting)throw error('Finish the current edit before changing the mixer.','studio_mixer_busy');
   if(this.recoveryNeeded(scope))throw error('Inspect the previous mixer result before another edit. It will not be replayed.','studio_mixer_recovery_required');
  }catch(failure){return Promise.reject(failure);}
  const generation=this.generation,items=definitions.map(({definition,value})=>applyItem(definition,value)),targets=definitions.map(({definition,value})=>({target:clone(definition.target),control:definition.control,value}));
  const entry={sequence:++this.sequence,scope:clone(scope),kind:'apply',route:'mix_apply',target:{kind:'mix',id:'apply'},control:'apply',requested:items.length,changes:clone(targets),status:'preparing',attempted:false,liveApplyAcknowledged:false,savedConfirmed:false,audioVerified:false,request:null,receipt:null,error:null,detached:false},operation={kind:'apply',scope,phase:'preparing',promise:null};this.operation=operation;this.records.push(entry);
  operation.promise=(async()=>{try{
   await this.engine.flush?.();this.assert(scope,generation);
   // No pre-read on a fresh gesture (see setControl); History Undo/Redo keeps its guard read.
   let revision;if(expected||this.mixRevision.ownPending?.())revision=await this.mixRevision.guard(targets,{projectId:scope.projectId});else{for(const item of targets)this.mixRevision.noteOwn(item.target,item.control,item.value);revision=this.mixRevision.revision;}this.assert(scope,generation);
   if(expected)for(const item of expected){const read=mixControlValue(this.mixRevision.mix,item.target,item.control);if(!read.known||!matchesValue(read.value,item.value))throw Object.assign(error('These mixer controls changed after that edit. History will not overwrite the newer values.','studio_mixer_history_conflict'),{dispatched:false,explicitRejection:true});}
   entry.expectedMixRevision=revision;let result;
   for(let attempt=0;;attempt++){
    entry.request={operationId:'applyEngineMix',path:{project_id:scope.projectId},body:{changes:clone(items),expected_mix_revision:revision,...this.contextTrack(scope)},idempotencyKey:this.key()};
    this.assert(scope,generation);entry.status='pending';operation.phase='applying';this.notify();entry.attempted=true;
    try{result=await this.send(entry.request);break;}
    catch(failure){
     if(!isMixRevisionConflict(failure)||!this.current(scope,generation))throw failure;
     const resolution=await this.mixRevision.resolveConflict(failure);entry.mixConflicts=(entry.mixConflicts||0)+1;
     if(attempt>0||!resolution.explained||resolution.revision==null)throw this.mixConflict(failure,resolution);
     revision=resolution.revision;entry.expectedMixRevision=revision;
    }
   }
   this.mixRevision.noteWrite(result,targets,{expected:revision});entry.receipt=clone(result.data);const data=resultData(result,scope.projectId);
   if(data.applied!=null&&data.applied!==items.length)throw Object.assign(error('Freestyle did not apply every mixer change in this step.'),{operationUncertain:true});
   entry.undoChanges=clone(data.undo_changes);mixChangesFromApply(entry.undoChanges);entry.liveApplyAcknowledged=true;
   // mix:apply saves lane gain/pan/mute/solo and master gain (338: lane gain
   // too; its per-change db_persisted reads false although the saved volume
   // changes, verified live Nov 10). Bus and master pan are live only.
   entry.savedConfirmed=true;entry.status='confirmed';await this.applied(entry,scope,generation);
  }catch(failure){this.failed(entry,failure);throw Object.assign(failure,{studioMixerReceipt:clone(entry)});}finally{entry.detached=!this.current(scope,generation);if(this.operation===operation)this.operation=null;this.notify();}})().then(()=>({receipt:clone(entry),changes:clone(targets),undoChanges:clone(entry.undoChanges),snapshot:this.snapshot()}));this.notify();return operation.promise;
 }
 /** One mixer step over any lane/bus controls, all or nothing. Everything
  * mix:apply supports goes in ONE guarded mix:apply; mute/solo of pattern lanes
  * (refused by mix:apply: 400 unsupported_mix_field) and controls of lanes the
  * live mix does not list go through their own guarded setters, in order. If a
  * later part fails, the landed parts are rolled back. `changes` items may
  * carry `before` (the value shown when the step started); it is the history
  * inverse of the per-lane writes. Resolves with {changes,inverse}: the exact
  * forward and inverse lists ({target,control,value,before}). */
 async applyChanges(changes,{expected=null}={}){
  if(!Array.isArray(changes)||!changes.length||changes.length>64)throw error('Choose 1–64 mixer controls for one mix step.','studio_mixer_invalid_input');
  for(const change of changes){targetControl(change?.target,change?.control,change?.value);if(change.before===undefined||change.before===null)throw error('Each mixer change needs the value it replaces (its Undo).','studio_mixer_invalid_input');}
  const mix=this.mixRevision?.mix,projectId=this.engine.projectId,pattern=new Set();
  // 339: mix:apply carries pattern-lane mute/solo atomically (verified live Nov 11:
  // patternRuntimeMuted.applied, db_persisted), so a multi-lane M/S gesture is ONE
  // mix:apply. Only a lane an older server refused (400 unsupported_mix_field)
  // moves to its own guarded write, as does a lane the live mix does not list.
  if(this.refusedLanes?.projectId===projectId)for(const id of this.refusedLanes.ids)pattern.add(id);
  const listed=id=>!Array.isArray(mix?.tracks)||mix.tracks.some(track=>track?.db_track_id===id);
  const single=change=>change.target.kind==='lane'&&(['mute','solo'].includes(change.control)&&pattern.has(change.target.id)||!listed(change.target.id));
  const plain=change=>({target:clone(change.target),control:change.control,value:change.value});
  const expectFor=change=>expected?.find(item=>same(item.target,change.target)&&item.control===change.control)??null;
  let batch=changes.filter(change=>!single(change)),lanes=changes.filter(single),applied=null;
  while(batch.length){
   const guard=expected?batch.map(expectFor).filter(Boolean).map(plain):null;
   try{applied=await this.applyMix(batch.map(plain),{expected:guard});break;}
   catch(failure){const index=failure?.code==='unsupported_mix_field'?failure.details?.changeIndex:null;if(!Number.isInteger(index)||!batch[index])throw failure;const moved=batch[index];if(moved.target.kind==='lane'){if(this.refusedLanes?.projectId!==projectId)this.refusedLanes={projectId,ids:new Set()};this.refusedLanes.ids.add(moved.target.id);}lanes.push(moved);batch=batch.filter((_,position)=>position!==index);}
  }
  const done=[];
  try{for(const change of lanes){const guard=expectFor(change);await this.setControl(change.target,change.control,change.value,guard?{expected:guard.value}:{});done.push(change);}}
  catch(failure){
   // A per-lane write refused before it applied anything is resolved by this
   // rollback, so its receipt does not lock the mixer for inspection.
   const refused=this.records.find(entry=>entry.sequence===failure?.studioMixerReceipt?.sequence);if(refused&&!refused.liveApplyAcknowledged&&!refused.savedAcknowledged&&explicitRejection(failure))refused.inspected=true;
   const problems=[];
   for(const change of done.reverse()){try{await this.setControl(change.target,change.control,change.before,{expected:change.value});}catch(rollback){problems.push(rollback);}}
   if(applied)try{await this.applyMix(mixChangesFromApply(applied.undoChanges),{expected:applied.changes});}catch(rollback){problems.push(rollback);}
   if(problems.length)Object.assign(failure,{operationUncertain:true,rollbackFailed:true});else if(done.length||applied)Object.assign(failure,{rolledBack:true,historyNotApplied:true,dispatched:false});
   throw failure;
  }
  const forward=[...(applied?applied.changes:[]),...lanes.map(plain)].map(change=>({...change,before:changes.find(item=>same(item.target,change.target)&&item.control===change.control)?.before}));
  const inverse=[...(applied?mixChangesFromApply(applied.undoChanges):[]),...lanes.map(change=>({...plain(change),value:change.before}))].map(change=>({...change,before:forward.find(item=>same(item.target,change.target)&&item.control===change.control)?.value}));
  return{changes:forward,inverse,applied:!!applied,perLane:lanes.length};
 }
 destroy(){this.destroyed=true;this.generation++;this.read=null;}
}
