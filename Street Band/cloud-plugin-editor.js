/** OAuth/MCP editor lifecycle. Discovery fixtures are not proof of a deployed contract. */
const clone=value=>value==null?value:structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const actions={'mirror-open':'open_plugin_editor',release:'release_plugin_editor'};
const annotation=key=>key.startsWith('x-')||['title','description','default','examples','$comment','deprecated','readOnly','writeOnly'].includes(key);
const fail=(message,code='plugin_editor_contract_required')=>Object.assign(new Error(message),{code});
function walk(value,visit){
 const pending=[{value,depth:0}],seen=new WeakSet();let count=0;
 while(pending.length){const {value:item,depth}=pending.pop();if(!item||typeof item!=='object')continue;if(seen.has(item)||++count>4096||depth>16)throw fail('Editor discovery exceeds bounded, acyclic contract limits.');seen.add(item);visit(item);for(const [key,child]of Object.entries(item)){if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&child)throw fail('Editor discovery was truncated; request the full action argumentSchema.');if(child&&typeof child==='object')pending.push({value:child,depth:depth+1});}}
}
function resultData(result){
 let data=result?.structuredContent;
 if(data===undefined&&Array.isArray(result?.content)){try{data=JSON.parse(result.content.filter(part=>part.type==='text').map(part=>part.text).join('\n'));}catch{throw fail('Freestyle returned an unreadable plugin editor response.','plugin_editor_response_invalid');}}
 return data??result;
}
function unwrap(result){
 const data=resultData(result),payload=data?.response??data;
 if(result?.isError||data?.ok===false||data?.error||payload?.ok===false||payload?.error){const reason=payload?.error||data?.error,error=fail(typeof reason==='string'?reason:reason?.message||payload?.message||data?.message||'Freestyle rejected the plugin editor request.',payload?.code||data?.code||'plugin_editor_rejected');error.stage=payload?.stage||data?.stage;error.cloudRejected=true;error.result=clone(result);throw error;}
 if(!record(payload)||!Object.keys(payload).length)throw fail('Freestyle returned no usable plugin editor receipt.','plugin_editor_response_invalid');
 walk(payload,()=>{});return clone(payload);
}
function keywords(schema,allowed,label){if(!record(schema))throw fail(`${label} has no typed schema.`);for(const key of Object.keys(schema))if(!annotation(key)&&!allowed.includes(key))throw fail(`${label} uses unsupported schema constraint ${key}; no editor write was sent.`);}
function primitive(value,schema,label){
 keywords(schema,['type','enum','const','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','pattern'],label);
 if(schema.readOnly===true)throw fail(`${label} is read-only.`);
 const type=schema.type;
 if(type==='boolean'){if(typeof value!=='boolean')throw fail(`${label} requires a boolean.`);}
 else if(type==='number'||type==='integer'){if(typeof value!=='number'||!Number.isFinite(value)||type==='integer'&&!Number.isInteger(value))throw fail(`${label} requires a finite ${type}.`);}
 else if(type==='string'){if(typeof value!=='string')throw fail(`${label} requires a string.`);}
 else if(type==='null'){if(value!==null)throw fail(`${label} requires null.`);}
 else throw fail(`${label} requires a supported explicit scalar type; nested or union arguments need a documented mapping.`);
 if(own(schema,'const')&&!same(value,schema.const)||own(schema,'enum')&&(!Array.isArray(schema.enum)||!schema.enum.some(candidate=>same(candidate,value))))throw fail(`${label} does not permit the requested value.`);
 if(typeof value==='number'){
  for(const key of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf'])if(own(schema,key)&&(!Number.isFinite(schema[key])||key==='multipleOf'&&schema[key]<=0))throw fail(`${label} has invalid ${key}.`);
  if(own(schema,'minimum')&&value<schema.minimum||own(schema,'maximum')&&value>schema.maximum||own(schema,'exclusiveMinimum')&&value<=schema.exclusiveMinimum||own(schema,'exclusiveMaximum')&&value>=schema.exclusiveMaximum)throw fail(`${label} is outside the discovered range.`);
  if(own(schema,'multipleOf')){const ratio=value/schema.multipleOf;if(Math.abs(ratio-Math.round(ratio))>Math.max(1,Math.abs(ratio))*1e-12)throw fail(`${label} violates multipleOf.`);}
 }
 if(typeof value==='string'){
  for(const key of ['minLength','maxLength'])if(own(schema,key)&&(!Number.isInteger(schema[key])||schema[key]<0))throw fail(`${label} has invalid ${key}.`);
  const length=Array.from(value).length;if(own(schema,'minLength')&&length<schema.minLength||own(schema,'maxLength')&&length>schema.maxLength)throw fail(`${label} is outside the discovered length.`);
  if(own(schema,'pattern')){let pattern;try{if(typeof schema.pattern!=='string')throw 0;pattern=new RegExp(schema.pattern,'u');}catch{throw fail(`${label} has an unsupported pattern.`);}if(!pattern.test(value))throw fail(`${label} violates the discovered pattern.`);}
 }
 return clone(value);
}
const groups={engine:['engine_track_id','mozart_track_id','track_id','engineTrackId','mozartTrackId','trackId'],plugin:['plugin_index','pluginIndex'],lane:['lane_id','laneId'],project:['project_id','projectId'],context:['context_track_id','contextTrackId']};
export function pluginEditorCapability(result,action){
 if(!Object.values(actions).includes(action))throw fail('Unsupported plugin editor lifecycle action.');
 const payload=unwrap(result),matches=[];walk(payload,item=>{if(item.name===action)matches.push(item);});
 if(matches.length!==1)throw fail(`Freestyle must return one uniquely named ${action} capability with a full argumentSchema.`);
 const capability=matches[0],schema=capability.argumentSchema;
 keywords(schema,['type','properties','required','additionalProperties','minProperties','maxProperties','$schema','$id'],'Editor argumentSchema');
 if(schema.type!=='object'||!record(schema.properties)||schema.readOnly===true||capability.mutates===false)throw fail(`${action} has no writable typed object argumentSchema.`);
 if(own(schema,'additionalProperties')&&typeof schema.additionalProperties!=='boolean')throw fail('Editor additionalProperties schema needs an explicit mapping.');
 const required=schema.required??[];if(!Array.isArray(required)||required.some(key=>typeof key!=='string')||new Set(required).size!==required.length)throw fail('Editor required arguments are malformed.');
 const fields={};
 for(const [role,names]of Object.entries(groups)){
  const present=names.filter(name=>own(schema.properties,name));if(present.length>1)throw fail(`Ambiguous ${role} identity fields in ${action}; a unique mapping is required.`);
  if(!present.length)continue;const name=present[0],field=schema.properties[name],numeric=role==='engine'||role==='plugin';
  // The deployed editor resolver accepts the durable lane in string track_id.
  // Inferred numeric track identities remain unsupported; never stringify one.
  const durableTrack=role==='engine'&&name==='track_id'&&field?.type==='string';
  const deployedPlugin=role==='plugin'&&name==='plugin_index'&&field?.type==='integer'&&schema.properties.track_id?.type==='string'&&!groups.engine.filter(key=>own(schema.properties,key)&&key!=='track_id').length;
  if(!record(field)||!(durableTrack?true:numeric?['number','integer'].includes(field.type):field.type==='string')||field['x-inferred']===true&&!durableTrack&&!deployedPlugin)throw fail(`Editor ${name} needs a confirmed ${numeric?'numeric':'string'} identity schema; inferred or ambiguous identity is unsupported.`);
  fields[durableTrack?'track':role]=name;
 }
 if((!fields.engine&&!fields.track)||!fields.plugin)throw fail(`${action} must identify an explicit numeric engine track or durable string track_id and plugin index; current-track defaults are unsafe.`);
 for(const key of required)if(!record(schema.properties[key]))throw fail(`Required editor argument ${key} has no typed schema.`);
 return{action,schema:clone(schema),fields,metadata:{method:capability.method??null,risk:capability.risk??null,destructive:capability.destructive??null,requiresConfirmation:capability.requiresConfirmation??null,result:clone(capability.result)}};
}
function targetIdentity(target,{durable=false}={}){
 if(!record(target))throw fail('Plugin editor target is missing.');
 const engine=target.engineTrackId??target.trackId;
 if(['engineTrackId','trackId'].some(key=>own(target,key)&&target[key]!==undefined&&(!Number.isSafeInteger(target[key])||target[key]<=0)))throw fail('Plugin editor needs an exact positive numeric engine track and nonnegative plugin index.');
 if(target.engineTrackId!==undefined&&target.trackId!==undefined&&target.engineTrackId!==target.trackId)throw fail('Plugin editor engine track aliases disagree.');
 if((engine!==undefined&&(!Number.isSafeInteger(engine)||engine<=0))||engine===undefined&&!durable||!Number.isSafeInteger(target.pluginIndex)||target.pluginIndex<0)throw fail('Plugin editor needs an exact positive numeric engine track and nonnegative plugin index.');
 for(const key of ['projectId','contextTrackId'])if(typeof target[key]!=='string'||!target[key].length)throw fail(`Plugin editor needs captured ${key}.`);
 if(durable&&engine===undefined&&(typeof target.laneId!=='string'||!target.laneId.length))throw fail('A durable editor target requires its captured laneId.');
 if(target.laneId!==undefined&&(typeof target.laneId!=='string'||!target.laneId.length))throw fail('Plugin editor laneId must be a durable nonempty string.');
 return{projectId:target.projectId,contextTrackId:target.contextTrackId,...(engine!==undefined?{engineTrackId:engine}:{}),pluginIndex:target.pluginIndex,...(target.laneId!==undefined?{laneId:target.laneId}:{})};
}
export function pluginEditorArguments(capability,target,args={}){
 const identity=targetIdentity(target,{durable:!!capability.fields.track}),schema=capability.schema,properties=schema.properties,values={engine:identity.engineTrackId,track:identity.laneId,plugin:identity.pluginIndex,lane:identity.laneId,project:identity.projectId,context:identity.contextTrackId},result={};
 if(capability.fields.track&&!identity.laneId)throw fail('Editor string track_id requires the captured durable laneId; runtime IDs cannot be converted to strings.');
 if(!record(args)||Object.keys(args).some(key=>key!=='visible'))throw fail('Only the documented explicit visible boolean is supported as an editor option.');
 for(const [role,name]of Object.entries(capability.fields))if(values[role]!==undefined)result[name]=primitive(values[role],properties[name],`Editor ${name}`);
 if(own(args,'visible')){if(properties.visible?.type!=='boolean'||properties.visible?.['x-inferred']===true)throw fail('The editor schema does not confirm a visible boolean; visibility will not be guessed or silently discarded.');result.visible=primitive(args.visible,properties.visible,'Editor visible');}
 for(const key of schema.required??[]){
  if(own(result,key))continue;
  if(Object.values(capability.fields).includes(key))throw fail(`Required editor identity ${key} is missing from the captured target.`);
  if(!own(properties[key],'default'))throw fail(`Required editor argument ${key} has no explicit default; no value will be guessed.`);
  Object.defineProperty(result,key,{value:primitive(properties[key].default,properties[key],`Editor ${key}`),enumerable:true,writable:true,configurable:true});
 }
 for(const key of ['minProperties','maxProperties'])if(own(schema,key)&&(!Number.isInteger(schema[key])||schema[key]<0))throw fail(`Editor schema has invalid ${key}.`);
 if(own(schema,'minProperties')&&Object.keys(result).length<schema.minProperties||own(schema,'maxProperties')&&Object.keys(result).length>schema.maxProperties)throw fail('The editor arguments violate the discovered property count.');
 return result;
}
/** One instance per dialog. getContext includes projectId, trackId (engine context),
 * loadVersion, contextVersion and monitorGeneration. cloudCall must retain the
 * explicit envelope, including for cleanup of a previously active project.
 */
export class CloudPluginEditorLifecycle{
 constructor({getContext,cloudCall,guard=()=>{},onChange=()=>{}}={}){
  if(typeof getContext!=='function'||typeof cloudCall!=='function')throw new TypeError('Plugin editor lifecycle needs getContext and cloudCall.');
  Object.assign(this,{getContext,cloudCall,guard,onChange});this.queue=Promise.resolve();this.target=null;this.scope=null;this.records=new Map();this.capabilities=new Map();this.capabilityRequests=new Map();this.state={status:'idle',action:null,error:null,target:null,receipt:null};this.requestEditor=this.requestEditor.bind(this);
 }
 capture(){const context=this.getContext();if(!record(context)||!['projectId','trackId'].every(key=>typeof context[key]==='string'&&context[key].length)||!['loadVersion','contextVersion','monitorGeneration'].every(key=>Number.isInteger(context[key])&&context[key]>=0))throw fail('Plugin editor requires the project, engine context, load/context versions and monitor generation.','plugin_editor_context_required');return clone(context);}
 current(scope){try{return same(this.capture(),scope);}catch{return false;}}
 assertCurrent(scope){if(!this.current(scope))throw fail('The project, engine context or monitor generation changed during the plugin editor request.','plugin_editor_context_changed');this.guard();}
 snapshot(){return clone({...this.state,current:this.scope?this.current(this.scope):false});}
 notify(){try{this.onChange(this.snapshot());}catch{/* Observers must not alter mutation certainty. */}}
 async discover(action){
  if(this.capabilities.has(action))return clone(this.capabilities.get(action));
  let pending=this.capabilityRequests.get(action);
  if(!pending){pending=(async()=>{const contract=pluginEditorCapability(await this.cloudCall('list_pro_capabilities',{action}),action);this.capabilities.set(action,contract);return contract;})();this.capabilityRequests.set(action,pending);}
  try{return clone(await pending);}finally{if(this.capabilityRequests.get(action)===pending)this.capabilityRequests.delete(action);}
 }
 async prepareTarget(target){
  const scope=this.capture();this.assertCurrent(scope);const capability=await this.discover(actions['mirror-open']);this.assertCurrent(scope);
  const identity=targetIdentity(target,{durable:!!capability.fields.track});
  if(identity.projectId!==scope.projectId||identity.contextTrackId!==scope.trackId)throw fail('The plugin target belongs to a different project or engine context.','plugin_editor_context_changed');
  // Validate identities with the discovered contract before the remote viewer
  // can accept an unresolved durable target. Visible defaults are handled later.
  pluginEditorArguments(capability,identity,await this.defaultArguments('mirror-open'));this.assertCurrent(scope);return identity;
 }
 async defaultArguments(action){
  if(!own(actions,action))throw fail('Unsupported editor lifecycle action.');
  if(action==='release')return{};
  const capability=await this.discover(actions[action]),visible=capability.schema.properties.visible;
  if(visible===undefined)return{};
  if(visible.type!=='boolean'||visible['x-inferred']===true)throw fail('The editor schema does not confirm a visible boolean.');
  return{visible:primitive(false,visible,'Editor visible')};
 }
 requestEditor(target,action,args={}){
  let identity,scope;try{
   if(!own(actions,action))throw fail(`Unsupported editor action ${action}; only mirror-open and release are mapped.`);
   identity=targetIdentity(target,{durable:true});args=clone(args);
   if(action==='mirror-open'){
    scope=this.capture();this.assertCurrent(scope);
    if(identity.projectId!==scope.projectId||identity.contextTrackId!==scope.trackId)throw fail('The plugin target belongs to a different project or engine context.','plugin_editor_context_changed');
    if(this.target&&!same(this.target,identity))throw fail('A plugin editor lifecycle cannot switch targets; create a new dialog lifecycle.');
    if(!this.target){this.target=identity;this.scope=scope;}else{scope=clone(this.scope);this.assertCurrent(scope);}
   }else{if(!this.target||!same(this.target,identity))throw fail('Release requires the exact previously captured editor target.');scope=clone(this.scope);}
  }catch(error){return Promise.reject(error);}
  const task=this.queue.then(()=>this.run(identity,scope,action,args));this.queue=task.catch(()=>{});return task;
 }
 async run(target,scope,action,args){
  if(action==='mirror-open'&&this.records.has('release'))throw fail('This editor lifecycle has already released its target.');
  const prior=this.records.get(action);
  if(prior){if(!same(prior.args,args))throw fail('This editor action was already dispatched with different options; it will not be repeated.');if(prior.error)throw prior.error;if(action==='mirror-open')this.assertCurrent(scope);return clone(prior.receipt);}
  const open=this.records.get('mirror-open');
  if(action==='release'&&!open)return{skipped:true,reason:'editor-open-not-dispatched'};
  let dispatched=false,entry;
  this.state={...this.state,status:'discovering',action,error:null,target:clone(target),receipt:null};this.notify();
  try{
   if(action==='mirror-open')this.assertCurrent(scope);
   const capability=await this.discover(actions[action]);
   if(action==='mirror-open')this.assertCurrent(scope);
   if(action==='release'&&capability.fields.engine&&open?.durableTrack&&(!Number.isSafeInteger(this.resolvedEngineTrackId)||this.resolvedEngineTrackId<=0))throw fail('Numeric editor cleanup requires the durable open’s acknowledged engine track.','plugin_editor_cleanup_binding_required');
   const argumentTarget=action==='release'&&capability.fields.engine&&Number.isSafeInteger(this.resolvedEngineTrackId)?{...target,engineTrackId:this.resolvedEngineTrackId}:target;
   const arguments_=pluginEditorArguments(capability,argumentTarget,args);
   // Release deliberately bypasses the new active-project guard. Both identities
   // below come from the old captured target, never from getContext().
   if(action==='mirror-open')this.assertCurrent(scope);
   entry={args:clone(args),receipt:null,error:null,durableTrack:!!capability.fields.track};this.records.set(action,entry);dispatched=true;this.state.status='sending';this.notify();
   const confirmed=capability.metadata.destructive===true||capability.metadata.requiresConfirmation===true;
   const rawReceipt=await this.cloudCall('execute_pro_action',{project_id:target.projectId,track_id:target.contextTrackId,action:actions[action],arguments:arguments_,...(confirmed?{confirmed_destructive:true}:{})}),receipt=unwrap(rawReceipt),resolved=resultData(rawReceipt)?.resolvedArgs;
   let engineTrackId=target.engineTrackId;
   if(resolved?.plugin_index!==undefined&&resolved.plugin_index!==target.pluginIndex)throw fail('The editor acknowledgement identifies a different plugin slot.','plugin_editor_response_invalid');
   if(capability.fields.track&&action==='mirror-open'){
    if(!Number.isSafeInteger(resolved?.track_id)||resolved.track_id<=0)throw fail('The durable editor open did not confirm its current numeric engine track for WebRTC.','plugin_editor_response_invalid');
    engineTrackId=resolved.track_id;
   }
   if(action==='mirror-open'){if(Number.isSafeInteger(engineTrackId)&&engineTrackId>0)this.resolvedEngineTrackId=engineTrackId;this.assertCurrent(scope);}
   const result={...receipt,editorLifecycle:{action,cleanup:action==='release',stale:!this.current(scope),engineTrackId}};
   entry.receipt=clone(result);this.state={...this.state,status:action==='release'?'released':'acknowledged',receipt:clone(result)};this.notify();return result;
  }catch(error){
   if(!error.cloudRejected&&error.result){try{unwrap(error.result);}catch(decoded){if(decoded.cloudRejected)error=decoded;}}
   // Only a documented pre-dispatch validation refusal proves no editor mutation.
   // Network errors, missing receipts and changed scopes remain uncertain.
   const rejected=dispatched&&error.cloudRejected&&error.stage==='validation';
   if(entry)entry.error=error;
   this.state={...this.state,status:!dispatched?'unavailable':rejected?'rejected':'uncertain',error:error.message,receipt:null};this.notify();throw error;
  }
 }
}
