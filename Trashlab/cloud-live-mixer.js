import {mixValuesEqual} from './mix-revision.js';
import {TypedMixerActions,mixerActionResult,mixerActionRejected} from './typed-mixer-action.js';
import {persistedBusId,persistedBusRequest,parsePersistedBuses} from './cloud-mixer-state.js';
const clone=value=>value==null?value:structuredClone(value),record=value=>!!value&&typeof value==='object'&&!Array.isArray(value),own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const stable=value=>record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):Array.isArray(value)?value.map(stable):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b)),finite=value=>typeof value==='number'&&Number.isFinite(value);
const failure=(message,code='mixer_live_invalid_result')=>Object.assign(new Error(message),{code});
const controls={gain:{field:'gain',action:'set_bus_gain'},muted:{field:'muted',action:'set_bus_muted'},soloed:{field:'soloed',action:'set_bus_soloed'}};
const controlName=value=>({mute:'muted',solo:'soloed'}[value]??value);
function marked(value){return value===false||value===0||value===''||value==null?false:typeof value==='object'?Object.values(value).some(marked):true;}
function busCompleteness(value){let global=false,specific=null;if(!record(value))return{global,specific};for(const[key,child]of Object.entries(value)){const name=key.replaceAll('_','').toLowerCase();if(name==='busestruncated'||name==='truncatedbuses')specific=specific===true||marked(child);else if(name==='truncated'&&record(child)){if(own(child,'buses'))specific=specific===true||marked(child.buses);}else if(['truncated','truncateditems','truncatedkeys','truncatedbytes','truncatedcharacters'].includes(name))global=global||marked(child);}return{global,specific};}
function shallowComplete(value){if(!record(value))return;for(const[key,child]of Object.entries(value))if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&marked(child))throw failure('Reload the complete live bus collection.');}
function assertProject(value,projectId){for(const field of ['project_id','projectId'])if(own(value,field)&&value[field]!==projectId)throw failure('Live mixer data belongs to another project.','mixer_live_scope_changed');if(record(value?.project)&&own(value.project,'id')&&value.project.id!==projectId)throw failure('Live mixer data belongs to another project.','mixer_live_scope_changed');}
/** Inspect only the authoritative bus collection. get_pro_state may contain
 * deliberately bounded pattern/plugin summaries outside it; those cannot turn
 * a complete typed bus value into a guessed value or an empty bus list.
 */
export function parseLiveMixerBuses(result,projectId){
 let data=result?.structuredContent;if(data===undefined&&Array.isArray(result?.content)){try{data=JSON.parse(result.content.filter(part=>part.type==='text').map(part=>part.text).join('\n'));}catch{throw failure('Freestyle returned unreadable live mixer data.');}}data=data??result;
 if(result?.isError)throw failure('Freestyle rejected the live mixer read.');const envelopes=[];
 for(let depth=0;depth<8;depth++){
  if(!record(data))throw failure('Freestyle returned no live mixer state.');assertProject(data,projectId);envelopes.push(data);
  if(data.error||data.ok===false||data.success===false)throw failure(typeof data.error==='string'?data.error:'Freestyle rejected the live mixer read.');
  if(own(data,'response')){data=data.response;continue;}
  const container=data.buses;if(!Array.isArray(container)&&!record(container))throw failure('Freestyle returned no complete live buses collection.');
  // Reuse the strict durable-identity and complete-collection parser for this
  // specific collection, without treating live state as persisted confirmation.
  if(record(container)){assertProject(container,projectId);shallowComplete(container);if(container.error||container.ok===false||container.success===false)throw failure('Freestyle rejected the live bus collection.');}
  const buses=Array.isArray(container)?container:container.buses,independent=record(container)&&container.ok===true&&Array.isArray(buses);
  for(const envelope of envelopes){const flags=busCompleteness(envelope);if(flags.specific===true||flags.global&&flags.specific!==false&&!independent)throw failure('Reload the complete live bus collection.');}
  return parsePersistedBuses({project_id:projectId,buses},projectId);
 }
 throw failure('Live mixer state nesting exceeds the inspection limit.');
}
function oneBus(buses,busId){const matches=buses.filter(bus=>persistedBusId(bus)===busId);if(matches.length!==1)throw failure('Read one uniquely identified current user bus before changing its live control.','mixer_live_bus_unbound');return matches[0];}
function value(bus,field,{required=false}={}){
 if(!own(bus,field)){if(required)throw failure(`The live bus has no authoritative ${field} value.`,'mixer_live_value_unknown');return{present:false,value:null};}
 const current=bus[field];if(field==='gain'?!finite(current)||current<0:typeof current!=='boolean')throw failure(`The bus has an invalid ${field} value.`,'mixer_live_value_unknown');return{present:true,value:current};
}
/** One live write, then explicit saved-state reconciliation. This is staged,
 * not atomic/CAS, and has no invented generic history or audio verification.
 */
export class CloudLiveMixer{
 constructor({engine,mixerState,onChange=()=>{}}={}){
  if(!engine?.session||!mixerState||typeof mixerState.snapshot!=='function'||typeof mixerState.refresh!=='function'||typeof mixerState.updateBus!=='function')throw new TypeError('Live mixer controls need an engine and persisted mixer state.');
  Object.assign(this,{engine,mixerState,onChange});this.typed=new TypedMixerActions({engine});this.operation=null;this.records=[];this.sequence=0;this.liveReadSequence=0;this.readRequestSequence=0;this.generation=0;this.liveCache=null;this.liveReadScope=null;this.liveReadStatus='unread';this.destroyed=false;
 }
 get busy(){return!!this.operation;}
 capture(){if(this.destroyed)throw failure('The live mixer controller was destroyed.','mixer_live_scope_changed');return this.typed.capture();}
 current(scope,generation=this.generation){try{return generation===this.generation&&same(scope,this.capture());}catch{return false;}}
 assertCurrent(scope,generation){if(!this.current(scope,generation))throw failure('The project, load or engine context changed during live mixer control.','mixer_live_scope_changed');}
 snapshot(){
  // A sequence identifies a completed, parsed live read. Pending/failed reads
  // retain its number only as historical evidence and never expose liveBuses.
  let scope=null;try{scope=this.capture();}catch{}const bound=scope&&same(scope,this.liveCache?.scope),readCurrent=scope&&same(scope,this.liveReadScope),active=scope&&same(scope,this.operation?.scope),receipt=this.records.filter(entry=>scope&&same(scope,entry.scope)).at(-1)??null;
  return clone({scope,busy:this.busy,status:this.destroyed?'destroyed':active?this.operation.phase:receipt?.status??'idle',liveReadStatus:readCurrent?this.liveReadStatus:'unread',liveReadSequence:bound?this.liveCache.sequence:0,readRequestSequence:this.readRequestSequence,completedReadRequestSequence:bound?this.liveCache.requestSequence:0,liveBuses:bound&&readCurrent&&this.liveReadStatus==='ready'?this.liveCache.buses:null,lastKnownLiveBuses:bound?this.liveCache.buses:null,receipt,records:this.records,atomic:false,audioVerified:false});
 }
 notify(){const result=this.snapshot();if(!this.destroyed)try{this.onChange(result);}catch{}return result;}
 saved(scope){const snapshot=this.mixerState.snapshot();if(!same(scope,snapshot.scope)||snapshot.readStatus!=='ready'||!Array.isArray(snapshot.buses))throw failure('Read the complete saved buses for this exact project/context before changing live control.','mixer_live_saved_read_required');return parsePersistedBuses({project_id:scope.projectId,buses:snapshot.buses},scope.projectId);}
 async readSaved(scope,generation){this.assertCurrent(scope,generation);if(this.mixerState.busy)throw failure('Wait for the current saved bus operation.','mixer_live_busy');await this.mixerState.refresh();this.assertCurrent(scope,generation);return this.saved(scope);}
 async readLive(scope,generation){
  this.assertCurrent(scope,generation);const requestSequence=++this.readRequestSequence;this.liveReadScope=clone(scope);this.liveReadStatus='unread';this.notify();
  try{const raw=await this.engine.session.call('get_pro_state',{project_id:scope.projectId,track_id:scope.trackId});this.assertCurrent(scope,generation);const buses=parseLiveMixerBuses(raw,scope.projectId);this.liveCache={scope:clone(scope),buses,sequence:++this.liveReadSequence,requestSequence};this.liveReadStatus='ready';return buses;}
  catch(error){if(this.current(scope,generation))this.liveReadStatus='error';throw error;}
 }
 setBusGain(busId,gain){return this.setControl(busId,'gain',gain);}
 setBusMuted(busId,muted){return this.setControl(busId,'muted',muted);}
 setBusSoloed(busId,soloed){return this.setControl(busId,'soloed',soloed);}
 setControl(busId,control,requested){
  let scope,definition,intent;
  try{scope=this.capture();control=controlName(control);definition=controls[control];if(!definition)throw failure('Live pan/master or arbitrary controls are not supported.','mixer_live_invalid_input');persistedBusRequest(scope.projectId,{bus_id:busId,[definition.field]:requested});intent={scope,busId,control,value:clone(requested)};
   if(this.operation){if(this.operation.kind==='write'&&same(intent,this.operation.intent))return this.operation.promise;throw failure('Wait for the current live mixer request.','mixer_live_busy');}
   if(this.mixerState.busy||this.engine.interacting||this.engine.applying)throw failure('Finish the current cloud operation before changing live mixer control.','mixer_live_busy');
   if(this.records.some(entry=>same(entry.intent,intent)&&!['confirmed','confirmed_by_inspection','not_sent','rejected'].includes(entry.status)))throw failure('Inspect the previous bus control result; the same uncertain or partial request will not be resent.','mixer_live_recovery_required');
   oneBus(this.saved(scope),busId);
  }catch(error){return Promise.reject(error);}
  const generation=this.generation,entry={sequence:++this.sequence,scope:clone(scope),intent:clone(intent),busId,control,requested:clone(requested),status:'preparing',liveAttempted:false,persistedAttempted:false,liveAcknowledged:false,liveInitiallyConfirmed:false,liveConfirmed:false,persistedConfirmed:false,liveBefore:null,savedBefore:null,rawLiveResult:null,liveReceipt:null,savedReceipt:null,liveAfter:null,savedAfter:null,liveReloadPending:false,error:null,atomic:false},operation={kind:'write',scope,intent,phase:'preparing',promise:null};this.operation=operation;this.records.push(entry);
  operation.promise=(async()=>{try{
   await this.engine.flush?.();this.assertCurrent(scope,generation);if(this.engine.interacting||this.engine.applying)throw failure('Finish the current cloud operation before changing live mixer control.','mixer_live_busy');
   entry.savedBefore=clone(oneBus(await this.readSaved(scope,generation),busId));value(entry.savedBefore,definition.field);
   entry.liveBefore=clone(oneBus(await this.readLive(scope,generation),busId));const liveBefore=value(entry.liveBefore,definition.field,{required:true});
   const prepared=await this.typed.prepare(definition.action,{bus_id:busId,[definition.field]:requested},scope);entry.prepared={action:prepared.action,arguments:clone(prepared.arguments),capability:clone(prepared.capability)};this.assertCurrent(scope,generation);
   if(this.mixerState.busy||!same(value(oneBus(this.saved(scope),busId),definition.field),value(entry.savedBefore,definition.field)))throw failure('The saved bus changed during live mixer preparation.','mixer_live_saved_conflict');
   if(!mixValuesEqual(liveBefore.value,requested)){operation.phase='setting_live';entry.status='live_pending';entry.liveAttempted=true;this.liveReadStatus='unread';this.notify();try{entry.rawLiveResult=clone(await this.typed.execute(prepared));entry.liveReceipt=mixerActionResult(entry.rawLiveResult,scope.projectId);entry.liveAcknowledged=true;if(own(entry.liveReceipt,'engine_reload_required')&&typeof entry.liveReceipt.engine_reload_required!=='boolean')throw failure('The live mixer acknowledgement has an invalid engine-reload flag.');entry.liveReloadPending=entry.liveReceipt.engine_reload_required===true;}catch(error){entry.rawLiveResult=clone(error.rawResult??error.mixerAction?.rawResult??entry.rawLiveResult);entry.liveReceipt=clone(error.mixerAction?.receipt??entry.liveReceipt);entry.liveAcknowledged=!!entry.liveReceipt;if(error.dispatched===false)entry.liveAttempted=false;throw error;}}
   operation.phase='confirming_live';entry.status='live_unconfirmed';this.notify();entry.liveAfter=clone(oneBus(await this.readLive(scope,generation),busId));if(!mixValuesEqual(value(entry.liveAfter,definition.field,{required:true}).value,requested))throw failure('Fresh live bus state did not confirm the requested control value.','mixer_live_confirmation_mismatch');entry.liveConfirmed=true;entry.liveInitiallyConfirmed=true;
   operation.phase='checking_saved';entry.status='live_only';this.notify();let saved=oneBus(await this.readSaved(scope,generation),busId),observed=value(saved,definition.field);
   if(!observed.present||!mixValuesEqual(observed.value,requested)){
    if(!same(observed,value(entry.savedBefore,definition.field)))throw failure('The saved bus control changed elsewhere after the live write; it was not overwritten.','mixer_live_saved_conflict');
    this.assertCurrent(scope,generation);if(this.engine.interacting||this.engine.applying||this.mixerState.busy)throw failure('Finish the current cloud operation before reconciling the saved bus.','mixer_live_busy');
    operation.phase='saving';entry.status='saving';entry.persistedAttempted=true;entry.liveConfirmed=false;this.liveReadStatus='unread';this.notify();try{const savedResult=await this.mixerState.updateBus({bus_id:busId,[definition.field]:requested});entry.savedReceipt=clone(savedResult.receipt??savedResult);}catch(error){entry.savedReceipt=clone(this.mixerState.snapshot().receipt);throw error;}this.assertCurrent(scope,generation);saved=oneBus(this.saved(scope),busId);
   }
   entry.savedAfter=clone(saved);const savedValue=value(saved,definition.field);if(!savedValue.present||!mixValuesEqual(savedValue.value,requested))throw failure('Fresh persisted bus state did not confirm the requested control value.','mixer_live_saved_unconfirmed');entry.persistedConfirmed=true;
   operation.phase='confirming';entry.liveConfirmed=false;entry.liveAfter=clone(oneBus(await this.readLive(scope,generation),busId));if(!mixValuesEqual(value(entry.liveAfter,definition.field,{required:true}).value,requested))throw failure('The live bus changed during saved-state reconciliation.','mixer_live_confirmation_mismatch');entry.liveConfirmed=true;entry.status=entry.liveReloadPending?'confirmed_reload_pending':'confirmed';entry.noop=!entry.liveAttempted&&!entry.persistedAttempted;return{receipt:clone(entry)};
  }catch(error){entry.error=error.message;entry.errorCode=error.code??null;entry.status=entry.persistedConfirmed?'saved_live_unconfirmed':entry.liveInitiallyConfirmed?'live_only':entry.liveAttempted?mixerActionRejected(error)?'rejected':'uncertain':'not_sent';if(this.current(scope,generation)&&entry.liveAttempted&&this.liveReadStatus!=='ready')this.liveReadStatus='error';throw Object.assign(error,{mixerLiveReceipt:clone(entry),operationAttempted:entry.liveAttempted||entry.persistedAttempted,operationUncertain:entry.status==='uncertain'||entry.status==='live_only'||entry.status==='saved_live_unconfirmed'});
  }finally{if(this.operation===operation)this.operation=null;this.notify();}})().then(result=>({...result,snapshot:this.snapshot()}));this.notify();return operation.promise;
 }
 /** Read-only recovery. It may confirm already-observed requested values but
  * never replays a live or persisted mutation, including a partial request.
  */
 inspect(){
  let scope;try{scope=this.capture();if(this.operation){if(this.operation.kind==='inspect'&&same(scope,this.operation.scope))return this.operation.promise;throw failure('Wait for the current live mixer request.','mixer_live_busy');}if(this.mixerState.busy)throw failure('Wait for the current saved mixer request.','mixer_live_busy');}catch(error){return Promise.reject(error);}
  const generation=this.generation,operation={kind:'inspect',scope,phase:'inspecting',promise:null};this.operation=operation;this.liveReadScope=clone(scope);this.liveReadStatus='unread';
  operation.promise=(async()=>{try{const saved=await this.readSaved(scope,generation),live=await this.readLive(scope,generation);for(const entry of this.records.filter(entry=>same(entry.scope,scope))){const definition=controls[entry.control];let liveBus,savedBus;try{liveBus=oneBus(live,entry.busId);savedBus=oneBus(saved,entry.busId);}catch{continue;}entry.inspected=true;entry.inspection={live:clone(liveBus),saved:clone(savedBus)};if(mixValuesEqual(value(liveBus,definition.field,{required:true}).value,entry.requested)&&value(savedBus,definition.field).present&&mixValuesEqual(value(savedBus,definition.field).value,entry.requested)){entry.status=entry.liveReloadPending?'confirmed_reload_pending':'confirmed_by_inspection';entry.liveConfirmed=true;entry.persistedConfirmed=true;entry.liveAfter=clone(liveBus);entry.savedAfter=clone(savedBus);}}}catch(error){if(this.current(scope,generation))this.liveReadStatus='error';throw error;}finally{if(this.operation===operation)this.operation=null;this.notify();}})().then(()=>this.snapshot());this.notify();return operation.promise;
 }
 destroy(){this.generation++;this.destroyed=true;this.liveCache=null;this.liveReadScope=null;this.liveReadStatus='unread';}
}
