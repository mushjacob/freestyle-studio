import {unpackMixerResult} from './mixer-tools.js';
const clone=value=>value==null?value:structuredClone(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const failure=(message,code='mixer_bus_invalid_result')=>Object.assign(new Error(message),{code});
function complete(value,path=new WeakSet(),depth=0,budget={remaining:100000}){
 if(--budget.remaining<0||depth>40)throw failure('Reload the complete bus data; this response exceeds the inspection limit.');
 if(value===null||typeof value==='string'||typeof value==='boolean'||finite(value))return;
 if(typeof value!=='object'||path.has(value))throw failure('Freestyle returned invalid or incomplete bus data.');path.add(value);
 for(const [key,child]of Object.entries(value)){
  if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&child)throw failure('Freestyle returned truncated bus data. Reload the complete list.');
  complete(child,path,depth+1,budget);
 }
 if(Array.isArray(value))for(let index=0;index<value.length;index++)if(!own(value,index))throw failure('Freestyle returned an incomplete bus array.');path.delete(value);
}
function projectEnvelope(value,projectId){
 for(const key of ['project_id','projectId'])if(own(value,key)&&value[key]!==projectId)throw failure('Freestyle returned bus data for a different project.','mixer_bus_project_mismatch');
 if(record(value?.project)&&own(value.project,'id')&&value.project.id!==projectId)throw failure('Freestyle returned bus data for a different project.','mixer_bus_project_mismatch');
}
function resultProjects(result,projectId){
 let outer=result;projectEnvelope(outer,projectId);if(outer?.structuredContent!==undefined)outer=outer.structuredContent;else if(Array.isArray(outer?.content))try{outer=JSON.parse(outer.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'));}catch{}
 for(let depth=0;depth<8&&record(outer);depth++){complete(outer);projectEnvelope(outer,projectId);outer=outer.response;}
}
export function persistedBusId(bus){
 if(!record(bus))return null;const fields=['id','bus_id'].filter(key=>own(bus,key));if(!fields.length||fields.some(key=>!id(bus[key]))||fields.some(key=>bus[key]!==bus[fields[0]]))return null;return bus[fields[0]];
}
/** The .buses output shape is checked, never inferred from an empty/error body.
 * Both durable identity spellings already recognized by the mixer are allowed;
 * conflicting spellings, project bindings and partial results are refused.
 */
export function parsePersistedBuses(result,projectId){
 if(!id(projectId))throw failure('A current cloud project is required.');complete(result);
 // Validate project bindings before unpacking response containers discards them.
 resultProjects(result,projectId);
 const data=unpackMixerResult(result);complete(data);projectEnvelope(data,projectId);
 if(!record(data)||!Array.isArray(data.buses))throw failure('Freestyle returned no verified buses array. The saved bus list remains unknown.');
 const seen=new Set();for(const bus of data.buses){const key=persistedBusId(bus);if(!key||seen.has(key))throw failure('Freestyle returned duplicate or invalid durable bus identities.');seen.add(key);projectEnvelope(bus,projectId);}
 return clone(data.buses);
}
const busFields=['name','gain','muted','soloed','display_order','plugin_chain'];
export function persistedBusRequest(projectId,options){
 if(!id(projectId)||!record(options)||!id(options.bus_id)||options.bus_id==='master')throw failure('Choose a durable user bus; the built-in master bus cannot be created or updated here.','mixer_bus_invalid_input');
 for(const key of Object.keys(options))if(!['bus_id',...busFields].includes(key))throw failure(`Unsupported bus field: ${key}.`,'mixer_bus_invalid_input');
 if(own(options,'name')&&(typeof options.name!=='string'||options.name.length>255))throw failure('A bus name must be at most 255 characters.','mixer_bus_invalid_input');
 if(own(options,'gain')&&(!finite(options.gain)||options.gain<0||options.gain>4))throw failure('Bus gain must be a finite linear value from 0 to 4.','mixer_bus_invalid_input');
 for(const key of ['muted','soloed'])if(own(options,key)&&typeof options[key]!=='boolean')throw failure(`${key} must be a boolean.`,'mixer_bus_invalid_input');
 if(own(options,'display_order')&&(!Number.isInteger(options.display_order)||options.display_order<1||options.display_order>1024))throw failure('Bus order must be a whole number from 1 to 1024.','mixer_bus_invalid_input');
 if(own(options,'plugin_chain')&&(!Array.isArray(options.plugin_chain)||options.plugin_chain.length>32||!options.plugin_chain.every(record)))throw failure('A saved plugin chain needs at most 32 complete plugin objects.','mixer_bus_invalid_input');
 complete(options);return{project_id:projectId,...clone(options)};
}

/** Persisted bus CRUD state only. There is no live-engine acknowledgement or CAS
 * revision in the published tools. Local scope/preflight checks cannot provide
 * atomic compare-and-swap against another client; no such guarantee is claimed.
 */
export class CloudMixerState{
 constructor({engine,onChange=()=>{}}={}){if(!engine?.session||typeof engine.session.call!=='function')throw new Error('Cloud mixer state requires a cloud engine session.');Object.assign(this,{engine,onChange});this.cache=null;this.readScope=null;this.readState='unread';this.error=null;this.operation=null;this.generation=0;this.sequence=0;this.readSequence=0;this.records=[];this.destroyed=false;}
 capture(){const e=this.engine,s=e.session,scope={projectId:e.projectId,trackId:s.trackId,loadVersion:e.loadVersion||0,contextVersion:s.contextVersion||0};if(this.destroyed||!e.ready||e.loading||s.closed||!id(scope.projectId)||!id(scope.trackId)||s.projectId!==scope.projectId||!['loadVersion','contextVersion'].every(key=>Number.isInteger(scope[key])&&scope[key]>=0))throw failure('Open a ready cloud project before reading saved buses.','mixer_bus_scope_changed');return scope;}
 current(scope,generation=this.generation){try{return generation===this.generation&&same(scope,this.capture());}catch{return false;}}
 assertCurrent(scope,generation){if(!this.current(scope,generation))throw failure('The cloud project, load or engine context changed during the bus request.','mixer_bus_scope_changed');}
 get busy(){return !!this.operation;}
 snapshot(){
  let scope=null;try{scope=this.capture();}catch{}const bound=!!scope&&same(scope,this.cache?.scope),operationCurrent=!!scope&&same(scope,this.operation?.scope),receipts=this.records.filter(entry=>scope&&same(entry.scope,scope)),receipt=receipts.at(-1)||null,readStatus=scope&&same(scope,this.readScope)?this.readState:operationCurrent&&this.operation.kind==='read'?'loading':'unread';
  return clone({scope,status:this.destroyed?'destroyed':operationCurrent?this.operation.phase:readStatus,readStatus,mutationStatus:receipt?.status??null,buses:bound&&this.readState==='ready'?this.cache.buses:null,lastKnownBuses:bound?this.cache.buses:null,stale:bound&&this.readState!=='ready',busy:this.busy,error:scope&&same(scope,this.error?.scope)?this.error.message:null,persistedOnly:true,receipt,records:this.records});
 }
 notify(){const state=this.snapshot();if(!this.destroyed)try{this.onChange(state);}catch{}return state;}
 invalidate(){this.generation++;this.cache=null;this.readScope=null;this.readState='unread';this.error=null;this.notify();}
 async read(scope,generation){
  this.assertCurrent(scope,generation);const result=await this.engine.session.call('list_buses',{project_id:scope.projectId});this.assertCurrent(scope,generation);const buses=parsePersistedBuses(result,scope.projectId);this.assertCurrent(scope,generation);this.cache={scope:clone(scope),buses,sequence:++this.readSequence};this.readScope=clone(scope);this.readState='ready';this.error=null;return buses;
 }
 refresh(){
  const scope=this.capture();if(this.operation){if(this.operation.kind==='read'&&same(scope,this.operation.scope))return this.operation.promise;return Promise.reject(failure('Wait for the current bus request to finish.','mixer_bus_busy'));}
  const generation=this.generation,operation={kind:'read',scope,phase:'loading',promise:null};this.operation=operation;this.readScope=clone(scope);this.readState='loading';this.error=null;
  operation.promise=(async()=>{try{await this.read(scope,generation);for(const receipt of this.records)if(same(scope,receipt.scope)&&['uncertain','saved_unconfirmed','rejected'].includes(receipt.status))receipt.inspectedRead=this.cache.sequence;}catch(error){if(this.current(scope,generation)){this.readState='error';this.error={scope,message:error.message};}throw error;}finally{if(this.operation===operation)this.operation=null;this.notify();}return this.snapshot();})();this.notify();return operation.promise;
 }
 createBus(options){return this.mutate('create_bus',options);}
 updateBus(options){return this.mutate('update_bus',options);}
 async mutate(tool,options){
  const scope=this.capture(),request=persistedBusRequest(scope.projectId,options);if(this.busy)throw failure('Wait for the current bus request to finish.','mixer_bus_busy');if(this.engine.interacting)throw failure('Finish the current drag before editing saved buses.','mixer_bus_busy');
  if(!same(this.cache?.scope,scope)||this.readState!=='ready')throw failure('Read the complete saved bus list before editing it.','mixer_bus_read_required');
  if(this.records.some(entry=>same(scope,entry.scope)&&['uncertain','saved_unconfirmed','rejected'].includes(entry.status)&&!entry.inspectedRead))throw failure('Inspect the saved bus list before another edit. The previous write will not be retried.','mixer_bus_inspection_required');
  const existing=this.cache.buses.find(bus=>persistedBusId(bus)===request.bus_id);if(tool==='create_bus'&&existing)throw failure('That saved bus already exists. Choose another durable id.','mixer_bus_exists');if(tool==='update_bus'&&!existing)throw failure('The target bus is not present in the saved bus list.','mixer_bus_missing');
  const changed=busFields.filter(key=>own(request,key));if(tool==='update_bus'&&changed.every(key=>same(request[key],existing[key])))return{noop:true,snapshot:this.snapshot()};
  const generation=this.generation,entry={sequence:++this.sequence,scope:clone(scope),tool,request:clone(request),status:'preparing',rawResult:null,receipt:null,error:null,confirmationError:null,inspectedRead:null},operation={kind:'write',scope,phase:'preparing'};this.records.push(entry);this.operation=operation;this.notify();let dispatched=false;
  try{
   await this.engine.flush?.();this.assertCurrent(scope,generation);if(this.engine.interacting)throw failure('Finish the current drag before editing saved buses.','mixer_bus_busy');
   operation.phase='mutating';entry.status='pending';this.readState='unread';this.notify();this.assertCurrent(scope,generation);dispatched=true;
   const result=await this.engine.session.call(tool,clone(request));entry.rawResult=clone(result);complete(result);resultProjects(result,scope.projectId);let receipt;try{receipt=unpackMixerResult(result);}catch(error){error.busRejected=true;throw error;}if(!record(receipt)||!Object.keys(receipt).length)throw failure('The bus mutation returned no usable receipt. Inspect the saved bus list.');complete(receipt);projectEnvelope(receipt,scope.projectId);if(own(receipt,'bus_id')&&receipt.bus_id!==request.bus_id)throw failure('Freestyle returned a receipt for a different bus.','mixer_bus_receipt_mismatch');entry.receipt=clone(receipt);entry.status='acknowledged';this.assertCurrent(scope,generation);
   operation.phase='confirming';this.notify();try{
    const buses=await this.read(scope,generation),after=buses.find(bus=>persistedBusId(bus)===request.bus_id);if(!after||changed.some(key=>!own(after,key)||!same(after[key],request[key])))throw failure('The canonical saved bus list did not confirm the requested values.','mixer_bus_confirmation_mismatch');entry.status='confirmed';entry.inspectedRead=this.cache.sequence;
   }catch(error){entry.status='saved_unconfirmed';entry.confirmationError=error.message;if(this.current(scope,generation)){if(this.readState!=='ready')this.readState='error';this.error={scope,message:'The bus request returned, but its saved state could not be confirmed. Read buses to inspect it; the write will not be retried.'};}throw error;}
  }catch(error){entry.error=error.message;entry.errorCode=error.code??null;entry.httpStatus=error.status??error.statusCode??null;if(entry.status!=='saved_unconfirmed')entry.status=entry.receipt?'saved_unconfirmed':dispatched?error.busRejected||entry.httpStatus>=400&&entry.httpStatus<500?'rejected':'uncertain':'not_sent';if(this.current(scope,generation)){if(dispatched&&this.readState!=='ready')this.readState='error';this.error={scope,message:error.message};}throw error;}
  finally{if(this.operation===operation)this.operation=null;this.notify();}
  return{receipt:clone(entry),snapshot:this.snapshot()};
 }
 destroy(){this.generation++;this.destroyed=true;this.cache=null;this.readScope=null;this.readState='unread';}
}
