import {unpackMixerResult} from './mixer-tools.js';
import {persistedBusId} from './cloud-mixer-state.js';
import {mixerActionResult,mixerActionRejected} from './typed-mixer-action.js';
const clone=value=>value==null?value:structuredClone(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const stable=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const fail=(message,code='mixer_routing_invalid')=>Object.assign(new Error(message),{code});
const marked=value=>value===false||value===0||value===''||value==null?false:typeof value==='object'?Object.values(value).some(marked):true;
function complete(value,path=new WeakSet(),depth=0){
 if(depth>40)throw fail('Reload complete routing data before editing.');if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
 if(typeof value!=='object'||path.has(value))throw fail('Routing data is incomplete or invalid.');path.add(value);for(const [key,child]of Object.entries(value)){if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&marked(child))throw fail('Routing data is truncated. Reload complete routing collections.');complete(child,path,depth+1);}if(Array.isArray(value))for(let index=0;index<value.length;index++)if(!own(value,index))throw fail('Routing collections must be complete.');path.delete(value);
}
function projectScope(value,scope){for(const key of ['project_id','projectId'])if(own(value,key)&&value[key]!==scope.projectId)throw fail('The routing response belongs to a different project.','mixer_routing_scope_changed');}
function payload(result,scope){
 let layer=result;projectScope(layer,scope);if(layer?.structuredContent!==undefined)layer=layer.structuredContent;else if(Array.isArray(layer?.content))try{layer=JSON.parse(layer.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'));}catch{}
 for(let depth=0;depth<8&&object(layer);depth++){projectScope(layer,scope);if(layer.success===false)throw fail('Freestyle rejected the routing request.');layer=layer.response;}
 const data=unpackMixerResult(result);projectScope(data,scope);if(!object(data)||!Object.keys(data).length)throw fail('Freestyle returned no usable routing response.');return clone(data);
}
function collectionMarkers(value,key){let global=false,specific=null;if(!object(value))return{global,specific};for(const[name,child]of Object.entries(value)){const normalized=name.replaceAll('_','').toLowerCase();if(normalized===`${key}truncated`||normalized===`truncated${key}`)specific=specific===true||marked(child);else if(normalized==='truncated'&&object(child)){if(own(child,key))specific=specific===true||marked(child[key]);}else if(['truncated','truncateditems','truncatedkeys','truncatedbytes','truncatedcharacters'].includes(normalized))global=global||marked(child);}return{global,specific};}
function collection(value,key,outer){
 const array=Array.isArray(value)?value:object(value)?value[key]:null,local=collectionMarkers(value,key),envelope=collectionMarkers(outer,key),independent=object(value)&&value.ok===true&&Array.isArray(array);
 if(value?.ok===false||value?.isError===true||value?.error||outer?.ok===false||outer?.isError===true||outer?.error||!Array.isArray(array)||local.specific===true||local.specific!==false&&local.global||envelope.specific===true||envelope.specific!==false&&!independent&&envelope.global)throw fail(`Reload the complete ${key} routing collection.`);
 // Routing consumes identities and outputs only. An omitted parameter summary
 // inside a plugin does not make the independently read output route unknown.
 for(let index=0;index<array.length;index++){const row=array[index],markers=collectionMarkers(row,key);if(!own(array,index)||!object(row)||markers.global||markers.specific===true)throw fail(`Reload the complete ${key} routing collection.`);complete(Object.fromEntries(['id','db_track_id','bus_id','busId','project_id','projectId'].filter(field=>own(row,field)).map(field=>[field,row[field]])));}
 return array;
}
export function parseMixerRoutingReads(projectResult,stateResult,scope){
 const project=payload(projectResult,scope),state=payload(stateResult,scope);if(project.id!==scope.projectId)throw fail('The canonical lane read belongs to a different project.','mixer_routing_scope_changed');
 for(const context of [state,state.session])if(object(context)){projectScope(context,scope);if(context.ok===false||context.isError===true||context.error)throw fail('Read the current live routing context before editing.');for(const key of ['track_id','trackId'])if(own(context,key)&&context[key]!==''&&context[key]!==scope.trackId)throw fail('The live routing read belongs to another engine context.','mixer_routing_scope_changed');}
 return{project,state,lanes:collection(project.lanes,'lanes',project),tracks:collection(state.tracks,'tracks',state),runtimeBuses:collection(state.buses,'buses',state)};
}
function unique(items,predicate,label){const matches=items.filter(predicate);if(matches.length!==1)throw fail(`Routing needs one uniquely identified ${label}.`);return matches[0];}
function output(row){const fields=['bus_id','busId'].filter(key=>own(row,key));if(!fields.length||fields.some(key=>!id(row[key]))||fields.some(key=>row[key]!==row[fields[0]]))throw fail('Read the actual saved and live output bus before routing.');return row[fields[0]];}
function reference(model,kind,identity){return unique(model.rows||[],row=>row.kind===kind&&row.id===identity,`${kind} strip`);}
function identity(scope,lane,bus,liveLane,liveBus){
 for(const row of [lane,bus,liveLane,liveBus])projectScope(row,scope);
 if(!id(lane?.id)||!id(persistedBusId(bus))||!Number.isInteger(liveLane?.id)||liveLane.id<0||liveLane.db_track_id!==lane.id||persistedBusId(liveBus)!==persistedBusId(bus))throw fail('Routing needs exact durable identities and a uniquely bound numeric live track.');
 return{projectId:scope.projectId,laneId:lane.id,busId:persistedBusId(bus),runtimeTrackId:liveLane.id,persistedBusId:output(lane),runtimeBusId:output(liveLane)};
}

/** Capture full before records but compare only routing/identity fields. Meter or
 * gain changes are not routing conflicts, and are never overwritten by this tool.
 */
export function prepareMixerRouting(model,busSnapshot,scope,{laneId,busId}={}){
 if(!id(laneId)||!id(busId)||model?.projectId!==scope.projectId||busSnapshot?.readStatus!=='ready'||!same(busSnapshot.scope,scope)||!Array.isArray(busSnapshot.buses))throw fail('Read this project’s saved lanes, buses and live routing before editing.');
 const lane=reference(model,'lane',laneId),bus=reference(model,'bus',busId),savedBus=unique(busSnapshot.buses,item=>persistedBusId(item)===busId,'saved bus');
 if(!lane.verified||!lane.persisted||!bus.verified||!bus.persisted||lane.runtime?.status!=='bound'||bus.runtime?.status!=='bound'||!['lanes','buses','runtimeTracks','runtimeBuses'].every(key=>model.reads?.[key]==='ready'))throw fail('The selected lane and bus need complete saved data and uniquely bound live targets.');
 if(!same(savedBus,bus.rawPersisted)||lane.rawPersisted?.id!==laneId||lane.rawRuntime?.id!==lane.runtime.trackId)throw fail('The mixer binding changed. Read routing again.');
 const target=identity(scope,lane.rawPersisted,savedBus,lane.rawRuntime,bus.rawRuntime);
 collection([lane.rawPersisted],'lanes');collection([savedBus,bus.rawRuntime],'buses');collection([lane.rawRuntime],'tracks');
 return{scope:clone(scope),laneId,busId,before:{...target,lane:clone(lane.rawPersisted),bus:clone(savedBus),runtimeLane:clone(lane.rawRuntime),runtimeBus:clone(bus.rawRuntime)},fingerprint:target};
}

/** Saved and live route changes are separate requests, never an atomic gesture or
 * undo group. Failed stages stop the sequence; inspect is strictly read-only.
 * typedAction must discover/validate before prepare resolves, and execute once.
 */
export class CloudMixerRouting{
 constructor({engine,mixerState,getModel,typedAction,onChange=()=>{}}={}){
  if(!engine?.session||typeof engine.session.call!=='function'||!mixerState||typeof getModel!=='function'||typeof typedAction?.prepare!=='function'||typeof typedAction?.execute!=='function')throw new Error('Routing needs scoped mixer state, the actual mixer model and a typed live-action adapter.');
  Object.assign(this,{engine,mixerState,getModel,typedAction,onChange});this.operation=null;this.prepared=null;this.records=[];this.observation=null;this.sequence=0;this.generation=0;this.destroyed=false;
 }
 capture(){const engine=this.engine,session=engine.session,scope={projectId:engine.projectId,trackId:session.trackId,loadVersion:engine.loadVersion||0,contextVersion:session.contextVersion||0};if(this.destroyed||!engine.ready||engine.loading||session.closed||session.projectId!==scope.projectId||!id(scope.projectId)||!id(scope.trackId)||!['loadVersion','contextVersion'].every(key=>Number.isInteger(scope[key])&&scope[key]>=0))throw fail('Open a ready cloud project before routing.','mixer_routing_scope_changed');return scope;}
 current(scope,generation=this.generation){try{return generation===this.generation&&same(scope,this.capture());}catch{return false;}}
 assertCurrent(scope,generation){if(!this.current(scope,generation))throw fail('The cloud project, load or engine context changed during routing.','mixer_routing_scope_changed');}
 get busy(){return !!this.operation;}
 snapshot(){let scope=null;try{scope=this.capture();}catch{}const records=this.records.filter(entry=>scope&&same(scope,entry.scope));return clone({scope,busy:this.busy,status:this.destroyed?'destroyed':this.operation&&scope&&same(scope,this.operation.scope)?this.operation.phase:records.at(-1)?.status??'idle',prepared:this.prepared&&scope&&same(scope,this.prepared.scope)?this.prepared:null,receipt:records.at(-1)??null,records:this.records,observation:this.observation&&scope&&same(scope,this.observation.scope)?this.observation:null,atomic:false,canUndo:false});}
 notify(){const state=this.snapshot();if(!this.destroyed)try{this.onChange(state);}catch{}return state;}
 assertAvailable(){if(this.busy||this.mixerState.snapshot().busy||this.engine.interacting)throw fail('Finish the current mixer request or drag before routing.','mixer_routing_busy');}
 prepare(options){this.assertAvailable();if(!object(options)||Object.keys(options).some(key=>!['laneId','busId'].includes(key)))throw fail('Choose only an exact persisted lane and bus identity.');const scope=this.capture();this.prepared=prepareMixerRouting(this.getModel(),this.mixerState.snapshot(),scope,options);return clone(this.prepared);}
 async read(scope,generation,{laneId,busId}){
  this.assertCurrent(scope,generation);const [projectResult,stateResult,buses]=await Promise.all([this.engine.session.call('get_project',{project_id:scope.projectId}),this.engine.session.call('get_pro_state',{project_id:scope.projectId,track_id:scope.trackId}),this.mixerState.refresh()]);this.assertCurrent(scope,generation);
  const {lanes,tracks,runtimeBuses}=parseMixerRoutingReads(projectResult,stateResult,scope);
  if(buses.readStatus!=='ready'||!same(buses.scope,scope)||!Array.isArray(buses.buses))throw fail('Read the complete saved bus list before confirming routing.');
  const lane=unique(lanes,item=>item.id===laneId,'persisted lane'),bus=unique(buses.buses,item=>persistedBusId(item)===busId,'persisted bus'),runtimeLane=unique(tracks,item=>item.db_track_id===laneId,'live lane'),runtimeBus=unique(runtimeBuses,item=>persistedBusId(item)===busId,'live destination bus');
  unique(tracks,item=>item.id===runtimeLane.id,'numeric runtime track');const target=identity(scope,lane,bus,runtimeLane,runtimeBus),observation={scope:clone(scope),...target,lane:clone(lane),bus:clone(bus),runtimeLane:clone(runtimeLane),runtimeBus:clone(runtimeBus)};this.observation=clone(observation);return observation;
 }
 async apply(options){
  this.assertAvailable();if(options)this.prepare(options);const plan=clone(this.prepared);if(!plan)throw fail('Choose a lane and output bus before routing.');const scope=this.capture(),generation=this.generation;this.assertCurrent(plan.scope,generation);
  if(this.records.some(entry=>same(entry.scope,scope)&&entry.requiresInspection&&!entry.inspection))throw fail('Inspect the previous routing result before starting another route. It will not be retried.','mixer_routing_inspection_required');
  const entry={sequence:++this.sequence,scope:clone(scope),plan,status:'preparing',before:clone(plan.before),beforeRead:null,persisted:{status:'not_sent',request:null,rawResult:null,receipt:null},live:{status:'not_sent',request:null,rawResult:null,receipt:null},inspection:null,error:null,requiresInspection:false},operation={scope,phase:'preparing'};this.records.push(entry);this.operation=operation;this.notify();
  try{
   await this.engine.flush?.();this.assertCurrent(scope,generation);if(this.engine.interacting)throw fail('Finish the current drag before routing.','mixer_routing_busy');
   operation.phase='reading_before';this.notify();let before=await this.read(scope,generation,plan);entry.beforeRead=clone(before);const fingerprint={projectId:before.projectId,laneId:before.laneId,busId:before.busId,runtimeTrackId:before.runtimeTrackId,persistedBusId:before.persistedBusId,runtimeBusId:before.runtimeBusId};if(!same(fingerprint,plan.fingerprint))throw fail('The saved or live route changed. Inspect it and choose the route again.','mixer_routing_before_changed');
   const saveNeeded=before.persistedBusId!==plan.busId,liveNeeded=before.runtimeBusId!==plan.busId;
   if(!saveNeeded&&!liveNeeded){entry.persisted.status='already_confirmed';entry.live.status='already_confirmed';entry.status='noop';return clone(entry);}
   let preparedLive=null;if(liveNeeded){operation.phase='discovering';this.notify();preparedLive=typeof this.typedAction.prepareRouting==='function'?await this.typedAction.prepareRouting({laneId:plan.laneId,runtimeTrackId:before.runtimeTrackId,busId:plan.busId},clone(scope)):await this.typedAction.prepare('route_track_to_bus',{track_id:before.runtimeTrackId,bus_id:plan.busId},clone(scope));this.assertCurrent(scope,generation);entry.live.request=clone(preparedLive);}
   if(saveNeeded){
    const stage=entry.persisted;stage.request={project_id:scope.projectId,lane_id:plan.laneId,bus_id:plan.busId};operation.phase='saving';this.notify();this.assertCurrent(scope,generation);stage.status='pending';
    try{const raw=await this.engine.session.call('set_lane_routing',clone(stage.request));stage.rawResult=clone(raw);stage.receipt=mixerActionResult(raw,scope.projectId);complete(stage.receipt);for(const [key,value]of [['lane_id',plan.laneId],['bus_id',plan.busId]])if(own(stage.receipt,key)&&stage.receipt[key]!==value)throw fail('The saved routing receipt identifies another target.');stage.status='acknowledged';}catch(error){stage.rawResult??=clone(error.rawResult??error.result);stage.error=error.message;stage.status=mixerActionRejected(error)?'rejected':'uncertain';throw error;}
    this.assertCurrent(scope,generation);operation.phase='confirming_saved';this.notify();before=await this.read(scope,generation,plan);stage.after=clone(before);if(before.persistedBusId!==plan.busId)throw fail('The canonical lane output did not confirm the saved route.');stage.status='confirmed';
   }else entry.persisted.status='already_confirmed';
   if(before.runtimeTrackId!==plan.fingerprint.runtimeTrackId)throw fail('The live lane binding changed after the saved route. No live command was sent.','mixer_routing_binding_changed');
   if(before.runtimeBusId!==plan.busId&&before.runtimeBusId!==plan.fingerprint.runtimeBusId)throw fail('The live route changed after the saved route. No live command was sent.','mixer_routing_before_changed');
   if(before.runtimeBusId===plan.busId)entry.live.status='already_confirmed';
   else{
    const stage=entry.live;operation.phase='applying_live';this.notify();this.assertCurrent(scope,generation);stage.status='pending';
    try{stage.rawResult=clone(await this.typedAction.execute(preparedLive));stage.receipt=mixerActionResult(stage.rawResult,scope.projectId);complete(stage.receipt);if(own(stage.receipt,'bus_id')&&stage.receipt.bus_id!==plan.busId)throw fail('The live routing receipt identifies another bus.');stage.status='acknowledged';}catch(error){stage.rawResult??=clone(error.rawResult??error.result);stage.error=error.message;stage.dispatched=error.dispatched??null;stage.typedAction=clone(error.mixerAction);stage.status=error.dispatched===false?'not_sent':error.operationAcknowledged?'acknowledged_unconfirmed':error.operationUncertain===false||mixerActionRejected(error)?'rejected':'uncertain';throw error;}
    this.assertCurrent(scope,generation);operation.phase='confirming_live';this.notify();const after=await this.read(scope,generation,plan);stage.after=clone(after);if(after.runtimeTrackId!==plan.fingerprint.runtimeTrackId||after.runtimeBusId!==plan.busId)throw fail('The fresh live state did not confirm the requested output route.');stage.status='confirmed';if(after.persistedBusId!==plan.busId){entry.persisted.status='changed_after_confirmation';throw fail('The saved output changed after live routing. Inspect both values before another edit.');}
   }
   entry.status='confirmed';return clone(entry);
  }catch(error){entry.error=error.message;entry.errorCode=error.code??null;entry.requiresInspection=[entry.persisted,entry.live].some(stage=>stage.status!=='not_sent'&&stage.status!=='already_confirmed');entry.status=entry.requiresInspection?['confirmed','already_confirmed'].includes(entry.persisted.status)?'partial':'uncertain':'not_sent';throw error;}
  finally{if(this.operation===operation)this.operation=null;this.prepared=null;this.notify();}
 }
 async inspect(){
  this.assertAvailable();const scope=this.capture(),generation=this.generation,entry=[...this.records].reverse().find(entry=>same(entry.scope,scope));if(!entry)throw fail('There is no routing receipt in this engine context to inspect.');const operation={scope,phase:'inspecting'};this.operation=operation;this.notify();try{entry.inspection=clone(await this.read(scope,generation,entry.plan));return clone(entry.inspection);}finally{if(this.operation===operation)this.operation=null;this.notify();}
 }
 invalidate(){this.generation++;this.prepared=null;this.observation=null;this.notify();}
 destroy(){this.generation++;this.destroyed=true;this.prepared=null;this.observation=null;}
}
