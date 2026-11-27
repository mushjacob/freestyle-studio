/** Discovery-driven cloud metronome. Requests never become displayed state. */
const clone=value=>value==null?value:structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const action='set_metronome';
const annotation=key=>key.startsWith('x-')||['title','description','default','examples','$comment','deprecated','readOnly','writeOnly'].includes(key);
const message=value=>typeof value==='string'?value:value?.message||value?.detail||'Freestyle rejected the metronome request.';
function statusOf(value){return[value?.status,value?.statusCode,value?.error?.status,value?.error?.statusCode,value?.result?.status,value?.result?.statusCode,value?.result?.error?.status,value?.result?.response?.status].find(status=>Number.isInteger(status)&&status>=100&&status<=599);}
function walk(value,visit){
 const pending=[{value,depth:0}],seen=new WeakSet();let nodes=0;
 while(pending.length){const {value:current,depth}=pending.pop();if(!current||typeof current!=='object')continue;if(seen.has(current))throw new Error('Freestyle returned a cyclic metronome contract.');seen.add(current);if(++nodes>4096||depth>16)throw new Error('The metronome capability response exceeds bounded discovery limits.');visit(current);for(const child of Object.values(current))if(child&&typeof child==='object')pending.push({value:child,depth:depth+1});}
}
function unwrap(result){
 let data=result?.structuredContent;
 if(data===undefined&&Array.isArray(result?.content)){try{data=JSON.parse(result.content.filter(part=>part.type==='text').map(part=>part.text).join('\n'));}catch{throw new Error('Freestyle returned an unreadable metronome response.');}}
 data=data??result;const payload=data?.response??data;
 if(result?.isError||data?.ok===false||data?.error||payload?.ok===false||payload?.error){const reason=payload?.error||data?.error,error=new Error(message(reason||payload?.message||data?.message));error.cloudRejected=true;error.result=clone(result);error.status=statusOf(reason)||statusOf(payload)||statusOf(data);throw error;}
 if(!record(payload)||!Object.keys(payload).length)throw new Error('Freestyle returned no usable metronome response.');
 walk(payload,value=>{for(const [key,child]of Object.entries(value))if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&child)throw new Error('Freestyle returned a truncated metronome contract.');});return clone(payload);
}
function assertKeywords(schema,allowed,label){for(const key of Object.keys(schema))if(!annotation(key)&&!allowed.includes(key))throw new Error(`${label} uses unsupported schema constraint ${key}; no metronome write was sent.`);}
function validateValue(value,schema,label){
 if(!record(schema))throw new Error(`${label} has no typed schema.`);
 assertKeywords(schema,['type','enum','const','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','pattern'],label);
 if(schema.readOnly===true)throw new Error(`${label} is read-only.`);
 const type=schema.type;
 if(type==='boolean'){if(typeof value!=='boolean')throw new Error(`${label} needs a boolean.`);}
 else if(type==='number'||type==='integer'){if(typeof value!=='number'||!Number.isFinite(value)||type==='integer'&&!Number.isInteger(value))throw new Error(`${label} needs a finite ${type}.`);}
 else if(type==='string'){if(typeof value!=='string')throw new Error(`${label} needs a string.`);}
 else if(type==='null'){if(value!==null)throw new Error(`${label} needs null.`);}
 else throw new Error(`${label} has an unsupported or missing argument type.`);
 if(own(schema,'const')&&!same(value,schema.const)||own(schema,'enum')&&(!Array.isArray(schema.enum)||!schema.enum.some(candidate=>same(candidate,value))))throw new Error(`${label} does not permit the requested value.`);
 if(typeof value==='number'){
  for(const key of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf'])if(own(schema,key)&&(!Number.isFinite(schema[key])||key==='multipleOf'&&schema[key]<=0))throw new Error(`${label} has an invalid ${key} constraint.`);
  if(own(schema,'minimum')&&value<schema.minimum||own(schema,'maximum')&&value>schema.maximum||own(schema,'exclusiveMinimum')&&value<=schema.exclusiveMinimum||own(schema,'exclusiveMaximum')&&value>=schema.exclusiveMaximum)throw new Error(`${label} is outside the discovered range.`);
  if(own(schema,'multipleOf')){const ratio=value/schema.multipleOf;if(Math.abs(ratio-Math.round(ratio))>Math.max(1,Math.abs(ratio))*1e-12)throw new Error(`${label} is not a discovered multiple.`);}
 }
 if(typeof value==='string'){
  for(const key of ['minLength','maxLength'])if(own(schema,key)&&(!Number.isInteger(schema[key])||schema[key]<0))throw new Error(`${label} has an invalid ${key} constraint.`);
  const length=Array.from(value).length;if(own(schema,'minLength')&&length<schema.minLength||own(schema,'maxLength')&&length>schema.maxLength)throw new Error(`${label} is outside the discovered string length.`);
  if(own(schema,'pattern')){if(typeof schema.pattern!=='string')throw new Error(`${label} has an invalid pattern.`);let expression;try{expression=new RegExp(schema.pattern,'u');}catch{throw new Error(`${label} has an unsupported pattern.`);}if(!expression.test(value))throw new Error(`${label} does not match the discovered pattern.`);}
 }
 return clone(value);
}
export function metronomeCapability(result){
 const payload=unwrap(result),matches=[];walk(payload,value=>{if(value.name===action&&record(value.argumentSchema)&&value.argumentSchema.type==='object')matches.push(value);});if(matches.length!==1)throw new Error('Freestyle did not return one uniquely named typed set_metronome capability.');const capability=matches[0];
 const schema=capability.argumentSchema;if(!record(schema)||schema.type!=='object'||!record(schema.properties))throw new Error('The set_metronome capability has no typed argumentSchema.');
 assertKeywords(schema,['type','properties','required','additionalProperties','minProperties','maxProperties','$schema','$id'],'Metronome argument schema');
 if(schema.readOnly===true||capability.mutates===false)throw new Error('The discovered metronome capability is not a writable setter.');
 const required=schema.required??[];if(!Array.isArray(required)||required.some(key=>typeof key!=='string')||new Set(required).size!==required.length)throw new Error('The metronome schema has invalid required arguments.');
 const controls=['enabled','on'].filter(key=>record(schema.properties[key])&&schema.properties[key].type==='boolean');if(controls.length!==1)throw new Error('The metronome schema must identify exactly one boolean enabled or on argument.');
 const field=controls[0],defaults={};
 for(const key of required){if(!record(schema.properties[key]))throw new Error(`Required metronome argument ${key} has no typed schema.`);if(key===field)continue;if(!own(schema.properties[key],'default'))throw new Error(`Required metronome argument ${key} has no explicit default; no value will be guessed.`);defaults[key]=validateValue(schema.properties[key].default,schema.properties[key],`Metronome argument ${key}`);}
 // Validate the control's schema even if a const/enum permits only one direction.
 const permitted=[false,true].filter(value=>{try{validateValue(value,schema.properties[field],`Metronome argument ${field}`);return true;}catch{return false;}});if(!permitted.length)throw new Error('The discovered metronome boolean schema permits no usable state.');
 return{action,field,defaults,schema:clone(schema),metadata:{method:capability.method??null,risk:capability.risk??null,destructive:capability.destructive??null,result:clone(capability.result),inferred:!!schema.properties[field]['x-inferred']}};
}
export function metronomeActionArguments(capability,enabled){
 if(typeof enabled!=='boolean')throw new TypeError('Choose an explicit metronome boolean state.');
 const args={...clone(capability.defaults),[capability.field]:validateValue(enabled,capability.schema.properties[capability.field],`Metronome argument ${capability.field}`)};
 for(const key of capability.schema.required??[])if(!own(args,key))throw new Error(`Required metronome argument ${key} is missing.`);
 for(const key of ['minProperties','maxProperties'])if(own(capability.schema,key)&&(!Number.isInteger(capability.schema[key])||capability.schema[key]<0))throw new Error(`The metronome schema has an invalid ${key}.`);
 if(own(capability.schema,'minProperties')&&Object.keys(args).length<capability.schema.minProperties||own(capability.schema,'maxProperties')&&Object.keys(args).length>capability.schema.maxProperties)throw new Error('The discovered metronome schema does not permit these argument fields.');
 return args;
}
const actualValue=value=>typeof value==='boolean'?value:record(value)&&typeof value.value==='boolean'?value.value:null;

/** subscribeActualState emits local observations {value:boolean,fresh:true,context?}
 * only for newly accepted authoritative clocks. Bare booleans may update display
 * but never confirm a mutation. A readActualState call must perform a new read.
 */
export class CloudMetronomeController{
 constructor({getContext,cloudCall,getActualState=()=>null,readActualState,subscribeActualState,flush=async()=>{},guard=()=>{},onChange=()=>{},confirmationTimeoutMs=4000,setTimeout:later=(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout:cancel=id=>globalThis.clearTimeout(id)}={}){
  if(typeof getContext!=='function'||typeof cloudCall!=='function')throw new TypeError('CloudMetronomeController needs context and cloud callbacks.');
  Object.assign(this,{getContext,cloudCall,getActualState,readActualState,flush,guard,onChange,confirmationTimeoutMs,later,cancel});this.inFlight=null;this.discovering=null;this.capability=null;this.waiter=null;this.blocked=new Set();this.destroyed=false;
  let actual=null;try{actual=actualValue(getActualState());}catch{}
  this.state={status:'idle',available:null,actual,requested:null,context:null,capability:null,acknowledged:false,error:null};this.actualContext=null;try{this.actualContext=JSON.stringify(this.capture());}catch{}
  this.unsubscribe=typeof subscribeActualState==='function'?subscribeActualState(sample=>this.observe(sample)):null;
 }
 snapshot(){let context=null,current=null,actual=null;try{context=this.capture();current=JSON.stringify(context);if(current===this.actualContext)actual=this.state.actual;else actual=actualValue(this.getActualState());}catch{}const replaced=this.state.context&&current!==JSON.stringify(this.state.context);return clone({...this.state,...(replaced?{status:this.inFlight?'waiting':'idle',context,requested:null,acknowledged:false,error:null}:{}),actual,busy:!!this.inFlight});}
 syncActual(){let context=null;try{context=this.capture();this.state.actual=actualValue(this.getActualState());}catch{this.state.actual=null;}this.actualContext=context?JSON.stringify(context):null;if(this.waiter&&!this.current(this.waiter.context))this.waiter.reject(new Error('The cloud project or engine context changed before metronome confirmation.'));return this.notify();}
 notify(){const state=this.snapshot();this.onChange(state);return state;}
 capture(){const context=clone(this.getContext());if(!record(context)||!['projectId','trackId'].every(key=>typeof context[key]==='string'&&context[key].length>0))throw new Error('Open a Freestyle project and its engine context before changing the metronome.');return context;}
 current(context){try{return same(this.capture(),context);}catch{return false;}}
 assertCurrent(context){if(this.destroyed||!this.current(context))throw new Error('The cloud project or engine context changed before metronome confirmation.');this.guard();}
 observe(sample){
  if(this.destroyed)return;const value=actualValue(sample),explicitNull=sample===null||record(sample)&&own(sample,'value')&&sample.value===null;if(value===null&&!explicitNull)return;const context=(()=>{try{return this.capture();}catch{return null;}})();if(!context||record(sample)&&sample.context!==undefined&&!same(sample.context,context))return;
  this.state.actual=value;this.actualContext=JSON.stringify(context);
  const waiter=this.waiter;if(waiter&&value!==null&&this.current(waiter.context)&&record(sample)&&sample.fresh===true){waiter.sawFresh=true;if(value===waiter.requested)waiter.resolve(value);}
  this.notify();
 }
 discover({refresh=false}={}){
  if(this.destroyed)return Promise.reject(new Error('The metronome controller is closed.'));
  if(this.discovering)return this.discovering;if(this.capability&&!refresh)return Promise.resolve(clone(this.capability));
  const task=(async()=>{try{const result=await this.cloudCall('list_pro_capabilities',{action});const capability=metronomeCapability(result);if(this.destroyed)throw new Error('The metronome controller is closed.');this.capability=capability;this.state.capability=clone(capability);this.state.available=true;this.notify();return clone(capability);}catch(error){this.state.available=false;this.state.error=error.message;if(!this.inFlight)this.state.status='unavailable';this.notify();throw error;}})();this.discovering=task;
  task.then(()=>{if(this.discovering===task)this.discovering=null;},()=>{if(this.discovering===task)this.discovering=null;});return task;
 }
 toggle(){return this.begin(null);}
 setEnabled(enabled){if(typeof enabled!=='boolean')return Promise.reject(new TypeError('Choose an explicit metronome boolean state.'));return this.begin(enabled);}
 begin(target){
  if(this.inFlight){if(target===null||this.inFlight.target===target)return this.inFlight.promise;return Promise.reject(new Error('A different metronome request is already in progress.'));}
  let context;try{context=this.capture();this.guard();if(this.destroyed)throw new Error('The metronome controller is closed.');if(this.blocked.has(JSON.stringify(context)))throw new Error('The earlier metronome request is uncertain. Read the actual cloud state; this controller will not repeat the write.');if(typeof this.readActualState!=='function'&&typeof this.unsubscribe!=='function')throw new Error('A fresh authoritative metronome state read is required before this control can be used.');}catch(error){return Promise.reject(error);}
  const pending={target,promise:null};this.inFlight=pending;this.state={...this.state,status:'discovering',context:clone(context),requested:null,acknowledged:false,error:null};this.notify();
  const task=(async()=>{let sent=false;
   try{
    const capability=await this.discover();this.assertCurrent(context);await this.flush();this.assertCurrent(context);
    let requested=target;
    if(requested===null){const sample=typeof this.readActualState==='function'?await this.readActualState(clone(context)):this.getActualState();this.assertCurrent(context);const actual=actualValue(sample);if(actual===null){this.state.actual=null;this.actualContext=JSON.stringify(context);throw new Error('Freestyle did not return an authoritative boolean metronome state.');}if(record(sample)&&sample.context!==undefined&&!same(sample.context,context))throw new Error('The metronome clock belongs to another project or engine context.');if(record(sample)&&sample.fresh===false)throw new Error('A fresh metronome state is required before toggling.');this.state.actual=actual;this.actualContext=JSON.stringify(context);requested=!actual;}
    pending.target=requested;const args=metronomeActionArguments(capability,requested);this.assertCurrent(context);this.state.status='sending';this.state.requested=requested;this.notify();
    sent=true;unwrap(await this.cloudCall('execute_pro_action',{project_id:context.projectId,track_id:context.trackId,action,arguments:args}));this.state.acknowledged=true;this.assertCurrent(context);this.state.status='confirming';this.notify();
    await this.confirm(context,requested);this.assertCurrent(context);this.state.status='ready';this.state.error=null;
   }catch(error){
    let rejection=error;if(!error.cloudRejected&&error.result){try{unwrap(error.result);}catch(decoded){if(decoded.cloudRejected)rejection=decoded;}}
    const status=statusOf(error)||statusOf(rejection),rejected=status===409||rejection.cloudRejected&&!(status>=500)||[400,401,403,404,422].includes(status);
    this.state.status=!sent?'failed':this.state.acknowledged?'unconfirmed':rejected?'rejected':'uncertain';this.state.error=error.message;if(sent&&!rejected)this.blocked.add(JSON.stringify(context));this.notify();throw error;
   }finally{this.clearWaiter();if(this.inFlight===pending)this.inFlight=null;this.notify();}
   return this.snapshot();
  })();pending.promise=task;return task;
 }
 async confirm(context,requested){
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;}),waiter={context:clone(context),requested,resolve,reject,timer:null,sawFresh:false};this.waiter=waiter;
  // Attach a rejection handler immediately; a teardown may happen during a slow read.
  promise.catch(()=>{});
  waiter.timer=this.later(()=>reject(new Error(`Freestyle acknowledged the metronome request, but no fresh boolean clock confirmed it.${waiter.readError?' '+waiter.readError:''} Read the actual cloud state before another change.`)),this.confirmationTimeoutMs);
  if(typeof this.readActualState==='function'){
   (async()=>{try{const sample=await this.readActualState(clone(context));if(this.waiter!==waiter)return;this.assertCurrent(context);if(record(sample)&&sample.context!==undefined&&!same(sample.context,context))throw Object.assign(new Error('The metronome clock belongs to another project or engine context.'),{scopeMismatch:true});const value=actualValue(sample);if(value===null){this.state.actual=null;this.actualContext=JSON.stringify(context);this.notify();throw new Error('Freestyle did not return a boolean metronome state after its acknowledgement.');}this.state.actual=value;this.actualContext=JSON.stringify(context);this.notify();if(!record(sample)||sample.fresh!==false){waiter.sawFresh=true;if(value===requested)resolve(value);else if(typeof this.unsubscribe!=='function')throw new Error('The fresh cloud clock did not confirm the requested metronome state.');}}catch(error){waiter.readError=error.message;if(typeof this.unsubscribe!=='function'||error.scopeMismatch||!this.current(context))reject(error);}})();
  }
  return promise;
 }
 clearWaiter(){if(this.waiter?.timer!==null&&this.waiter?.timer!==undefined)this.cancel(this.waiter.timer);this.waiter=null;}
 async refreshActual(){
  const context=this.capture();if(typeof this.readActualState!=='function')throw new Error('No authoritative metronome state read is configured.');const sample=await this.readActualState(clone(context));this.assertCurrent(context);const value=actualValue(sample);if(value===null)throw new Error('Freestyle did not return a boolean metronome state.');if(record(sample)&&sample.context!==undefined&&!same(sample.context,context))throw new Error('The metronome clock belongs to another project or engine context.');if(record(sample)&&sample.fresh===false)throw new Error('The metronome state read was not fresh.');this.observe({value,fresh:true,context});return this.snapshot();
 }
 destroy(){this.destroyed=true;this.waiter?.reject(new Error('The metronome controller closed before its clock confirmation.'));this.clearWaiter();if(typeof this.unsubscribe==='function')this.unsubscribe();this.unsubscribe=null;}
}
