/** Typed live mixer preparation, using the discovered action's exact fields. */
const clone=value=>value==null?value:structuredClone(value),own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value),finite=value=>typeof value==='number'&&Number.isFinite(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const stable=value=>record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):Array.isArray(value)?value.map(stable):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const fail=(message,code='mixer_action_contract_invalid')=>Object.assign(new Error(message),{code});
const actions={set_bus_gain:['bus_id','gain'],set_bus_muted:['bus_id','muted'],set_bus_soloed:['bus_id','soloed'],route_track_to_bus:['track_id','bus_id'],set_track_pan:['track_id','pan']};
const annotation=key=>key.startsWith('x-')||['title','description','default','examples','$comment','deprecated','readOnly','writeOnly'].includes(key);
function keys(schema,allowed,label){if(!record(schema))throw fail(`${label} needs a typed schema.`);for(const key of Object.keys(schema))if(!annotation(key)&&!allowed.includes(key))throw fail(`${label} has unsupported schema constraint ${key}.`);}
function visit(value,callback){const queue=[{value,depth:0}],seen=new WeakSet();let budget=100000;while(queue.length){const{value:item,depth}=queue.pop();if(--budget<0||depth>32)throw fail('Mixer discovery/result exceeds the complete-data inspection limit.');if(!item||typeof item!=='object')continue;if(seen.has(item))throw fail('Mixer data must be complete and acyclic.');seen.add(item);callback(item);for(const [key,child]of Object.entries(item)){if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&child)throw fail('Reload complete mixer capability/state data.');if(child&&typeof child==='object')queue.push({value:child,depth:depth+1});}}}
function payload(result){if(result?.structuredContent!==undefined)return result.structuredContent;if(Array.isArray(result?.content)){try{return JSON.parse(result.content.filter(part=>part.type==='text').map(part=>part.text).join('\n'));}catch{throw fail('Freestyle returned unreadable mixer data.');}}return result;}
function statusOf(error){const queue=[error,error?.result],statuses=[];for(let index=0;index<queue.length&&index<24;index++){const item=queue[index];if(!item||typeof item!=='object')continue;for(const value of [item.status,item.statusCode])if(Number.isInteger(value))statuses.push(value);for(const field of ['response','structuredContent','error'])if(item[field]&&typeof item[field]==='object')queue.push(item[field]);}return statuses.find(value=>value>=500||value===408)??statuses[0];}
export function mixerActionRejected(error){const status=statusOf(error);if(error?.operationUncertain===true||status>=500||status===408)return false;return status>=400&&status<500||error?.mixerRejected===true;}
/** Unwrap known MCP/response containers without discarding project scope. */
export function mixerActionResult(result,projectId){
 let data=payload(result);if(result?.isError){const error=fail('Freestyle rejected the mixer action.','mixer_action_rejected');error.mixerRejected=true;error.result=clone(data);error.status=statusOf(error);throw error;}
 for(let depth=0;depth<8;depth++){
  if(!record(data)||!Object.keys(data).length)throw fail('Freestyle returned no usable mixer acknowledgement.','mixer_action_unconfirmed');
  visit(data,()=>{});if(projectId!==undefined){for(const field of ['project_id','projectId'])if(own(data,field)&&data[field]!==projectId)throw fail('Mixer response belongs to another project.','mixer_action_scope_changed');if(record(data.project)&&own(data.project,'id')&&data.project.id!==projectId)throw fail('Mixer response belongs to another project.','mixer_action_scope_changed');}
  if(data.ok===false||data.success===false||data.error){const reason=data.error,error=fail(typeof reason==='string'?reason:reason?.message||data.message||'Freestyle rejected the mixer action.','mixer_action_rejected');error.status=reason?.status??data.status??data.statusCode;error.mixerRejected=true;error.result=clone(data);throw error;}
  if(!own(data,'response'))return clone(data);data=data.response;
 }
 throw fail('Mixer response nesting exceeds the inspection limit.');
}
function scalar(value,schema,label){
 keys(schema,['type','enum','const','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','pattern'],label);
 if(schema.readOnly===true)throw fail(`${label} is read-only.`);
 if(schema.type==='string'){if(typeof value!=='string')throw fail(`${label} needs a string.`);}
 else if(schema.type==='boolean'){if(typeof value!=='boolean')throw fail(`${label} needs a boolean.`);}
 else if(schema.type==='number'||schema.type==='integer'){if(!finite(value)||schema.type==='integer'&&!Number.isInteger(value))throw fail(`${label} needs a finite ${schema.type}.`);}
 else if(schema.type==='null'){if(value!==null)throw fail(`${label} needs null.`);}else throw fail(`${label} has no supported scalar type.`);
 if(own(schema,'const')&&!same(value,schema.const)||own(schema,'enum')&&(!Array.isArray(schema.enum)||!schema.enum.some(item=>same(value,item))))throw fail(`${label} does not permit this value.`);
 if(typeof value==='string'){
  for(const field of ['minLength','maxLength'])if(own(schema,field)&&(!Number.isInteger(schema[field])||schema[field]<0))throw fail(`${label} has invalid ${field}.`);
  const length=Array.from(value).length;if(own(schema,'minLength')&&length<schema.minLength||own(schema,'maxLength')&&length>schema.maxLength)throw fail(`${label} is outside its discovered length.`);
  if(own(schema,'pattern')){if(typeof schema.pattern!=='string')throw fail(`${label} has an invalid pattern.`);let expression;try{expression=new RegExp(schema.pattern,'u');}catch{throw fail(`${label} has an invalid pattern.`);}if(!expression.test(value))throw fail(`${label} does not match its discovered pattern.`);}
 }
 if(typeof value==='number'){
  for(const field of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf'])if(own(schema,field)&&(!finite(schema[field])||field==='multipleOf'&&schema[field]<=0))throw fail(`${label} has invalid ${field}.`);
  if(own(schema,'minimum')&&value<schema.minimum||own(schema,'maximum')&&value>schema.maximum||own(schema,'exclusiveMinimum')&&value<=schema.exclusiveMinimum||own(schema,'exclusiveMaximum')&&value>=schema.exclusiveMaximum)throw fail(`${label} is outside its discovered range.`);
  if(own(schema,'multipleOf')){const ratio=value/schema.multipleOf;if(Math.abs(ratio-Math.round(ratio))>1e-12*Math.max(1,Math.abs(ratio)))throw fail(`${label} is not a discovered multiple.`);}
 }
 return clone(value);
}
function fieldUnit(field){const unit=field?.['x-unit'];if(unit===undefined)return null;if(typeof unit!=='string'||!unit.trim())throw fail('Mixer field has an invalid unit.');const value=unit.trim().toLowerCase();return /^linear\s*\(\s*1\s*=\s*unity\s*\)$/.test(value)?'linear':value.replace(/[ -]+/g,'_');}
function critical(action,name,value,schema){
 if(own(schema,'x-inferred')&&typeof schema['x-inferred']!=='boolean')throw fail('Mixer inference metadata must be an explicit boolean.');
 // Production labels its bus_id string schema inferred. Its identity domain is
 // still an explicitly supplied canonical durable bus ID; numeric controls and
 // runtime track domains must continue to come from non-inferred schemas.
 if(schema['x-inferred']===true&&!((name==='bus_id'||['set_track_pan','route_track_to_bus'].includes(action)&&name==='track_id')&&schema.type==='string'&&id(value)))throw fail(`${action}.${name} is inferred; an explicit typed identity/control contract is required.`);
 const unit=fieldUnit(schema);
 if(name==='bus_id'){if(!id(value)||!['route_track_to_bus','set_bus_gain'].includes(action)&&value==='master'||schema.type!=='string'||unit&&!['bus_id','durable_bus_id','id','string'].includes(unit))throw fail('Choose an exact durable bus identity supported by this control, not a runtime index.');}
 if(name==='track_id'){
  if(action==='set_track_pan'&&schema.type!=='string')throw fail('Lane pan requires its explicit durable lane string identity.');
  if(schema.type==='string'){if(!id(value)||unit&&!['lane_id','db_track_id','durable_track_id','track_id','id','string'].includes(unit))throw fail('Routing requires the exact discovered durable lane identity.');}
  else if(!['integer','number'].includes(schema.type)||!Number.isInteger(value)||value<0||unit&&!['runtime_track_id','engine_track_id','mozart_track_id','track_id','id'].includes(unit))throw fail('Routing requires an explicit native runtime track index for this schema.');
 }
 if(name==='project_id'&&(!id(value)||schema.type!=='string'||unit&&!['project_id','id','string'].includes(unit)))throw fail('Mixer action requires its captured project identity.');
 if(name==='gain'&&(!finite(value)||value<0||value>4||!['number','integer'].includes(schema.type)||!unit||!['linear','linear_gain','gain_linear','linear_amplitude','amplitude_ratio','linear_ratio'].includes(unit)))throw fail('Bus gain requires an explicitly typed linear-amplitude unit in the 0–4 persisted range.');
 if(name==='pan'&&(!finite(value)||value< -1||value>1||schema.type!=='number'||schema.minimum!==-1||schema.maximum!==1||schema['x-unit']!=='-1 hard left, 0 center, 1 hard right'))throw fail('Lane pan requires the published numeric -1 hard left / 0 center / 1 hard right contract.');
 if(['muted','soloed'].includes(name)&&(typeof value!=='boolean'||schema.type!=='boolean'||unit&&!['boolean','bool'].includes(unit)))throw fail(`${name} requires an exact boolean control contract.`);
 return scalar(value,schema,`${action}.${name}`);
}
export function typedMixerCapability(result,action){
 if(!own(actions,action))throw fail('This mixer adapter does not support arbitrary actions.');
 const data=mixerActionResult(result,undefined),matches=[];visit(data,item=>{if(item.name===action&&record(item.argumentSchema)&&item.argumentSchema.type==='object')matches.push(item);});
 if(matches.length!==1)throw fail(`Freestyle did not return one uniquely named typed ${action} capability.`);
 const capability=matches[0],schema=capability.argumentSchema;if(capability.mutates===false||schema.readOnly===true||!record(schema.properties))throw fail(`${action} is not a typed writable capability.`);
 keys(schema,['type','properties','required','additionalProperties','minProperties','maxProperties','$schema','$id'],`${action} arguments`);
 if(own(schema,'additionalProperties')&&typeof schema.additionalProperties!=='boolean')throw fail('Mixer argument additionalProperties must be an explicit boolean.');
 const required=schema.required??[];if(!Array.isArray(required)||required.some(field=>typeof field!=='string')||new Set(required).size!==required.length)throw fail('Mixer required arguments are invalid.');
 return{action,schema:clone(schema),destructive:capability.destructive===true||capability.requiresConfirmation===true};
}
export function typedMixerArguments(capability,args,{projectId}={}){
 const{action,schema}=capability;if(!own(actions,action)||!record(args)||!id(projectId))throw fail('Capture a supported mixer action, explicit arguments and project.');
 const allowed=[...actions[action],'project_id'];for(const field of Object.keys(args))if(!allowed.includes(field))throw fail(`Unsupported mixer argument ${field}.`);
 const request={};for(const field of actions[action]){if(!own(args,field)||!record(schema.properties[field]))throw fail(`The exact ${action}.${field} field was not published or supplied.`);request[field]=critical(action,field,args[field],schema.properties[field]);}
 if(own(args,'project_id')&&args.project_id!==projectId)throw fail('Mixer arguments do not belong to the captured project.');
 if(own(schema.properties,'project_id'))request.project_id=critical(action,'project_id',projectId,schema.properties.project_id);else if(own(args,'project_id'))throw fail('The action did not publish an inner project_id field.');
 for(const field of schema.required??[]){
  if(own(request,field))continue;const declared=schema.properties[field];
  if(/(?:^|_)pan(?:_|$)|master/i.test(field)||/^(?:gain|muted|soloed|(?:project|track|lane|bus|source|pattern|plugin|instrument)_(?:id|index))$/.test(field)||!record(declared)||!own(declared,'default')||declared['x-inferred']===true)throw fail(`Required mixer argument ${field} has no explicit supported typed default.`);
  request[field]=scalar(declared.default,declared,`${action}.${field}`);
 }
 // The published fader action persists by default. Include that explicit typed
 // optional default so the final user gesture has a reviewable persistence mode.
 if(['set_bus_gain','set_track_pan'].includes(action)&&!own(request,'persist')&&own(schema.properties,'persist')){const declared=schema.properties.persist;if(record(declared)&&own(declared,'default')){if(declared.type!=='boolean'||declared['x-inferred']===true)throw fail('The mixer persist default requires an explicit boolean contract.');request.persist=scalar(declared.default,declared,`${action}.persist`);}}
 for(const field of ['minProperties','maxProperties'])if(own(schema,field)&&(!Number.isInteger(schema[field])||schema[field]<0))throw fail(`Mixer schema has invalid ${field}.`);
 if(own(schema,'minProperties')&&Object.keys(request).length<schema.minProperties||own(schema,'maxProperties')&&Object.keys(request).length>schema.maxProperties)throw fail('Mixer arguments exceed their discovered property bounds.');
 return request;
}
/** The live-mix control a typed mixer action changes (for the revision guard). */
function mixGuardChange(prepared,mix){
 const args=prepared.arguments,lane=value=>typeof value==='string'?value:Number.isInteger(value)?(Array.isArray(mix?.tracks)?mix.tracks.filter(track=>track?.track_id===value):[]).map(track=>track.db_track_id).find(id):null;
 switch(prepared.action){
  case'route_track_to_bus':{const laneId=lane(args.track_id);return laneId?{target:{kind:'lane',id:laneId},control:'route',value:args.bus_id}:null;}
  case'set_track_pan':{const laneId=lane(args.track_id);return laneId?{target:{kind:'lane',id:laneId},control:'pan',value:args.pan}:null;}
  case'set_bus_gain':return{target:{kind:'bus',id:args.bus_id},control:'gain',value:args.gain};
  case'set_bus_muted':return{target:{kind:'bus',id:args.bus_id},control:'mute',value:args.muted};
  case'set_bus_soloed':return{target:{kind:'bus',id:args.bus_id},control:'solo',value:args.soloed};
 }
 return null;
}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export class TypedMixerActions{
 constructor({engine}={}){if(!engine?.session||typeof engine.session.call!=='function')throw new TypeError('Typed mixer actions need an engine session.');this.engine=engine;this.prepared=new WeakSet();this.executions=new WeakMap();}
 capture(){const e=this.engine,s=e.session,scope={projectId:e.projectId,trackId:s.trackId,loadVersion:e.loadVersion||0,contextVersion:s.contextVersion||0};if(!e.ready||e.loading||s.closed||s.projectId!==scope.projectId||!id(scope.projectId)||!id(scope.trackId)||!['loadVersion','contextVersion'].every(field=>Number.isInteger(scope[field])&&scope[field]>=0))throw fail('Open a ready mixer project first.','mixer_action_scope_changed');return scope;}
 assertCurrent(scope){if(!same(scope,this.capture()))throw fail('The project, load or engine context changed during the mixer request.','mixer_action_scope_changed');}
 async prepare(action,args,scope=this.capture()){
  scope=clone(scope);const requested=clone(args);this.assertCurrent(scope);const result=await this.engine.session.call('list_pro_capabilities',{action});this.assertCurrent(scope);const capability=typedMixerCapability(result,action),argumentsValue=typedMixerArguments(capability,requested,scope),prepared=freeze({scope,action,arguments:argumentsValue,capability});this.prepared.add(prepared);return prepared;
 }
 async prepareRouting({laneId,runtimeTrackId,busId}={},scope=this.capture()){
  scope=clone(scope);if(!id(laneId)||!id(busId)||!Number.isInteger(runtimeTrackId)||runtimeTrackId<0)throw fail('Routing needs the exact canonical lane/bus and a uniquely bound native track.');this.assertCurrent(scope);
  const action='route_track_to_bus',result=await this.engine.session.call('list_pro_capabilities',{action});this.assertCurrent(scope);const capability=typedMixerCapability(result,action),type=capability.schema.properties.track_id?.type;
  // Production resolves a durable lane string to its current native index.
  // Legacy explicitly numeric schemas receive the already verified runtime ID.
  // Neither identity is ever converted to the other domain.
  const track=type==='string'?laneId:['integer','number'].includes(type)?runtimeTrackId:undefined;if(track===undefined)throw fail('The route action has no supported explicit track identity domain.');
  const argumentsValue=typedMixerArguments(capability,{track_id:track,bus_id:busId},scope),prepared=freeze({scope,action,arguments:argumentsValue,capability});this.prepared.add(prepared);return prepared;
 }
 execute(prepared){
  if(!this.prepared.has(prepared))return Promise.reject(fail('Execute only an original prepared mixer action.'));
  if(this.executions.has(prepared))return this.executions.get(prepared);
  const session=this.engine.session,task=async()=>{let dispatched=false,rawResult=null,receipt=null;try{
   this.assertCurrent(prepared.scope);if(this.engine.interacting||this.engine.applying||this.engine.pending)throw fail('Finish the current cloud edit before applying mixer control.','mixer_action_busy');
   // Agent-safe mixing: carry the revision of a fresh live-mix read when the
   // action publishes expected_mix_revision (412 instead of overwriting a person).
   const argumentsValue=clone(prepared.arguments),guard=session.mixRevision;let guarded=false;
   if(guard?.available?.(prepared.scope.projectId)&&own(prepared.capability.schema.properties,'expected_mix_revision')&&!own(argumentsValue,'expected_mix_revision')){const change=mixGuardChange(prepared,guard.mix);const revision=await guard.guard(change?[change]:[],{projectId:prepared.scope.projectId});this.assertCurrent(prepared.scope);if(revision!=null){argumentsValue.expected_mix_revision=revision;guarded=true;}}
   const request={project_id:prepared.scope.projectId,track_id:prepared.scope.trackId,action:prepared.action,arguments:argumentsValue,...(prepared.capability.destructive?{confirmed_destructive:true}:{})};dispatched=true;rawResult=await session.call('execute_pro_action',request);if(guarded)guard.noteWrite(rawResult);receipt=mixerActionResult(rawResult,prepared.scope.projectId);if(own(prepared.arguments,'bus_id')&&own(receipt,'bus_id')&&receipt.bus_id!==prepared.arguments.bus_id)throw fail('Mixer acknowledgement identifies another bus.','mixer_action_receipt_mismatch');this.assertCurrent(prepared.scope);return rawResult;
  }catch(error){throw Object.assign(error,{dispatched,rawResult:clone(rawResult),operationAttempted:dispatched,operationUncertain:dispatched&&!mixerActionRejected(error),operationAcknowledged:!!receipt,mixerAction:{scope:clone(prepared.scope),action:prepared.action,arguments:clone(prepared.arguments),rawResult:clone(rawResult),receipt:clone(receipt)}});}};
  const promise=Promise.resolve(session.queue).then(task,task);session.queue=promise.catch(()=>{});this.executions.set(prepared,promise);return promise;
 }
}
