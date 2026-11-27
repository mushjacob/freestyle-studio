/** One scoped canonical update for a rack clipboard plan, with read confirmation.
 * Caller flushes first and builds the plan from an accepted canonical DTO. This
 * writer never flushes from inside session.queue, or retries an uncertain write.
 */
import {assertCompletePattern,assertCompleteCanonicalData} from './cloud-session.js';
import {rackSourceBinding,copyRackScore} from './rack-selection.js';
const clone=value=>value==null?value:structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0;
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const stable=value=>Array.isArray(value)?value.map(stable):record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const fail=(message,code,extra={})=>Object.assign(new Error(message),{code,...extra});
const score=(event,sources)=>sources.has(event.sourceId)&&['sample','midi'].includes(event.type);
function ordered(items){return items.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)));}
function canonical(value){const dto=assertCompletePattern(value?.cloudRaw??value);if(!record(dto)||typeof dto.ppq!=='number'||!Number.isFinite(dto.ppq)||dto.ppq<=0||typeof dto.lengthTicks!=='number'||!Number.isFinite(dto.lengthTicks)||dto.lengthTicks<=0||typeof dto.bars!=='number'||!Number.isFinite(dto.bars)||dto.bars<=0)throw fail('Reload the complete accepted pattern timebase before using the rack clipboard.','rack_clipboard_before_required');return dto;}
function normalizedDTO(dto){return{...dto,pattern:{...dto.pattern,sources:ordered(dto.pattern.sources),events:ordered(dto.pattern.events)}};}
// The optimistic pre-write fence preserves array order too: even a source-list
// reorder must not be silently overwritten while this request was queued.
function rawSame(a,b){try{return same(a,b);}catch{return false;}}
function patternFrom(project,patternId){const matches=(project?.patterns||[]).filter(pattern=>(pattern.cloudId??pattern.id)===patternId);if(matches.length!==1)throw fail('The clipboard target is not uniquely present in the accepted project.','rack_clipboard_target_changed');return matches[0];}
function validatePlan(input){
 if(!record(input)||!id(input.projectId)||!id(input.patternId)||typeof input.changed!=='boolean'||!Array.isArray(input.sourceIds)||!input.sourceIds.length||input.sourceIds.some(value=>!id(value))||new Set(input.sourceIds).size!==input.sourceIds.length)throw fail('Use a complete canonical rack clipboard write plan.','rack_clipboard_plan_required');
 const plan=clone(input),before=canonical(plan.expected),after=canonical(plan.pattern),sources=new Set(plan.sourceIds),wrapper=dto=>({id:plan.patternId,cloudId:plan.patternId,cloudRaw:dto});
 for(const dto of [before,after]){
  const bindings=plan.sourceIds.map(sourceId=>rackSourceBinding({pattern:wrapper(dto),rowId:sourceId,sourceId}));copyRackScore({projectId:plan.projectId,pattern:wrapper(dto),bindings});
 }
 const strip=dto=>{const result=clone(dto);delete result.lengthTicks;delete result.length_ticks;delete result.bars;result.pattern.events=[];return result;};
 if(!rawSame(strip(before),strip(after))||before.ppq!==after.ppq||after.lengthTicks<before.lengthTicks||after.bars<before.bars)throw fail('Rack clipboard writes may change selected score only; instrument, routing and pattern controls must remain unchanged.','rack_clipboard_plan_scope_invalid');
 const retained=dto=>ordered(dto.pattern.events.filter(event=>!score(event,sources)));
 if(!same(retained(before),retained(after)))throw fail('Rack clipboard writes cannot change automation or unrelated channel events.','rack_clipboard_plan_scope_invalid');
 const changed=!rawSame(before,after);if(plan.changed!==changed)throw fail('The clipboard plan changed flag disagrees with its canonical score.','rack_clipboard_plan_invalid');
 return plan;
}
function walk(value,visit,path=new WeakSet(),depth=0){if(!value||typeof value!=='object')return;if(path.has(value)||depth>32)throw new Error('Freestyle returned an invalid recursive clipboard receipt.');path.add(value);visit(value);for(const child of Object.values(value))walk(child,visit,path,depth+1);path.delete(value);}
function response(result){
 let data=result?.structuredContent;if(data===undefined&&Array.isArray(result?.content)){try{data=JSON.parse(result.content.filter(part=>part.type==='text').map(part=>part.text).join('\n'));}catch{throw new Error('Freestyle returned an unreadable clipboard update acknowledgement.');}}
 data=data??result;const payload=data?.response??data;
 if(!record(payload)||!Object.keys(payload).length)throw new Error('Freestyle returned no usable clipboard update acknowledgement.');
 assertCompleteCanonicalData(payload,'rack clipboard update receipt');
 if(result?.isError)throw Object.assign(new Error(payload.message||'Freestyle rejected the rack clipboard update.'),{result,cloudRejected:true,stage:payload.stage,status:payload.status,cloudCode:payload.code});
 walk(data,item=>{if(item.ok===false||item.isError===true||item.error){const reason=item.error,error=new Error(typeof reason==='string'?reason:reason?.message||item.message||'Freestyle rejected the rack clipboard update.');Object.assign(error,{result,cloudRejected:true,stage:item.stage??payload.stage,status:item.status??reason?.status,cloudCode:item.code??payload.code});throw error;}});
 return clone(payload);
}
function rejection(error){
 const statuses=[error?.status,error?.statusCode,error?.result?.status,error?.result?.error?.status].filter(Number.isInteger);if(statuses.some(status=>status>=500||status===408))return false;
 return statuses.some(status=>status>=400&&status<500)||error?.cloudRejected&&error.stage==='validation';
}
const ignoredServerFields=new Set(['id','projectId','project_id','createdAt','created_at','updatedAt','updated_at','revision']);
/** Exact music semantics, including all IDs/metadata, regardless of list order.
 * Server revision/timestamp changes are not changes to the copied musical data.
 */
export function rackClipboardConfirmed(actual,desired){
 try{
  const a=canonical(actual),b=canonical(desired);
  for(const key of Object.keys(b))if(key!=='pattern'&&!ignoredServerFields.has(key)&&!same(a[key],b[key]))return false;
  const extras=body=>Object.fromEntries(Object.entries(body).filter(([key])=>!['sources','events'].includes(key)));
  return same(extras(a.pattern),extras(b.pattern))&&same(ordered(a.pattern.sources),ordered(b.pattern.sources))&&same(ordered(a.pattern.events),ordered(b.pattern.events));
 }catch{return false;}
}
const intentKey=(scope,plan)=>JSON.stringify(stable({scope,patternId:plan.patternId,before:normalizedDTO(plan.expected),after:{...plan.pattern,pattern:{...plan.pattern.pattern,sources:ordered(plan.pattern.pattern.sources),events:ordered(plan.pattern.pattern.events).map(event=>({...event,id:score(event,new Set(plan.sourceIds))?'copied-score-event':event.id})).sort((a,b)=>JSON.stringify(stable(a)).localeCompare(JSON.stringify(stable(b))))}},sourceIds:plan.sourceIds.slice().sort()}));

export class CloudRackClipboardWriter{
 constructor({engine,onChange=()=>{},getSelection=()=>null,restoreSelection=()=>{}}={}){
  if(!engine?.session||typeof engine.session.call!=='function'||typeof engine.session.refresh!=='function'||typeof engine.accept!=='function')throw new TypeError('CloudRackClipboardWriter needs the existing cloud engine/session.');
  Object.assign(this,{engine,onChange,getSelection,restoreSelection});this.inFlight=null;this.last=null;
 }
 capture(){const engine=this.engine,session=engine.session,scope={projectId:engine.projectId,trackId:session.trackId,loadVersion:engine.loadVersion||0,contextVersion:session.contextVersion||0};if(!engine.ready||engine.loading||session.closed||!id(scope.projectId)||!id(scope.trackId)||session.projectId!==scope.projectId||!['loadVersion','contextVersion'].every(key=>Number.isInteger(scope[key])&&scope[key]>=0))throw fail('Open the current cloud project before editing the rack clipboard.','rack_clipboard_scope_changed',{name:'AbortError'});return scope;}
 current(scope){try{return same(this.capture(),scope);}catch{return false;}}
 assertScope(scope){if(!this.current(scope))throw fail('The cloud project, engine context or load changed during the rack clipboard update.','rack_clipboard_scope_changed',{name:'AbortError'});}
 assertIdle({owned=false}={}){const engine=this.engine;if(engine.pending||engine.inFlight||engine.interacting||engine.applying&&!(owned&&engine.rackClipboardApplying===this.last))throw fail('Finish and flush pending cloud edits before applying rack clipboard data.','rack_clipboard_pending_edits');}
 assertBefore(plan,scope,{owned=false}={}){
  this.assertScope(scope);this.assertIdle({owned});
  for(const project of [this.engine.session.project,this.engine.project]){
   if(project?.cloud?.projectId!==scope.projectId)throw fail('The accepted clipboard target belongs to a different cloud project.','rack_clipboard_before_changed');
   const actual=canonical(patternFrom(project,plan.patternId));if(!rawSame(actual,plan.expected))throw fail('The canonical target score or instrument changed before the clipboard write completed.','rack_clipboard_before_changed');
  }
 }
 snapshot(){return{...clone(this.last||{status:'idle',receipt:null,acknowledgement:null,error:null}),busy:!!this.inFlight};}
 notify(){try{this.onChange(this.snapshot());}catch{}}
 assertRecovery(key){const prior=(this.engine.session.rackClipboardWrites||[]).find(entry=>entry.key===key&&['uncertain','acknowledged-refresh-failed','unconfirmed'].includes(entry.status));if(prior)throw fail('The earlier rack clipboard update needs a canonical reload before another write. No score will be resubmitted.','rack_clipboard_recovery_required',{operationUncertain:prior.status==='uncertain',operationCommitted:prior.status!=='uncertain',rackClipboardReceipt:clone(prior)});}
 write(input){
  let plan,scope,key;
  try{
   plan=validatePlan(input);scope=this.capture();key=intentKey(scope,plan);
   if(this.inFlight){if(this.inFlight.key===key)return this.inFlight.promise;throw fail('A rack clipboard update is already in progress.','rack_clipboard_busy');}
   this.assertBefore(plan,scope);
   if(!plan.changed)return Promise.resolve({status:'noop',changed:false,projectId:scope.projectId,patternId:plan.patternId});
   this.assertRecovery(key);
  }catch(error){return Promise.reject(error);}
  const entry={key,scope:clone(scope),projectId:scope.projectId,patternId:plan.patternId,sourceIds:plan.sourceIds.slice(),expected:clone(plan.expected),request:clone(plan.pattern),status:'queued',acknowledgement:null,receipt:null,confirmed:false,refreshes:0,error:null};
  const pending={key,promise:null};this.inFlight=pending;this.last=entry;this.notify();
  const task=()=>this.perform(plan,scope,entry),session=this.engine.session,queued=Promise.resolve(session.queue).then(task);
  session.queue=queued.catch(()=>{});
  const promise=queued.finally(()=>{if(this.inFlight===pending)this.inFlight=null;this.notify();}).then(()=>this.snapshot());pending.promise=promise;return promise;
 }
 async perform(plan,scope,entry){
  const engine=this.engine,session=engine.session;let dispatched=false,owned=false;
  try{
   this.assertBefore(plan,scope);this.assertRecovery(entry.key);
   session.rackClipboardWrites||=[];session.rackClipboardWrites.push(entry);session.lastRackClipboardWrite=entry;
   engine.rackClipboardApplying=entry;engine.applying=true;owned=true;entry.status='sending';this.notify();
   let receipt;
   try{
    dispatched=true;const result=await session.call('execute_pro_action',{project_id:scope.projectId,track_id:scope.trackId,action:'update_pattern',arguments:{pattern_id:plan.patternId,pattern:clone(plan.pattern)}});entry.acknowledgement=clone(result);receipt=response(result);
    for(const field of ['projectId','project_id'])if(own(receipt,field)&&receipt[field]!==scope.projectId)throw new Error('Freestyle returned a clipboard receipt for a different project.');
    for(const field of ['patternId','pattern_id'])if(own(receipt,field)&&receipt[field]!==plan.patternId)throw new Error('Freestyle returned a clipboard receipt for a different pattern.');
    entry.receipt=clone(receipt);entry.status='acknowledged';this.notify();
   }catch(original){let error=original;if(error.result&&entry.acknowledgement===null)entry.acknowledgement=clone(error.result);if(!error.cloudRejected&&error.result){try{response(error.result);}catch(decoded){if(decoded.cloudRejected){decoded.status??=original.status;error=decoded;}}}entry.status=rejection(error)?'rejected':'uncertain';
    throw error;}
   // Do not refresh a new project or overwrite a newly changed local score.
   try{this.assertBefore(plan,scope,{owned:true});}catch(error){entry.status='unconfirmed';throw error;}
   entry.status='confirming';entry.refreshes++;this.notify();
   try{await session.refresh();}catch(cause){entry.status='acknowledged-refresh-failed';throw fail('Freestyle acknowledged the clipboard update, but its canonical refresh failed. No write will be repeated.','rack_clipboard_refresh_failed',{cause});}
   try{this.assertScope(scope);this.assertIdle({owned:true});}catch(error){entry.status='unconfirmed';throw error;}
   let actual;try{actual=patternFrom(session.project,plan.patternId);}catch{}
   if(!actual||!rackClipboardConfirmed(actual,plan.pattern)){entry.status='unconfirmed';throw fail('The canonical pattern has not confirmed the exact copied score, source settings and unrelated events. No write will be repeated.','rack_clipboard_unconfirmed');}
   entry.status='confirmed';entry.confirmed=true;entry.error=null;this.notify();
   // Preserve the latest local selection, rather than reviving a selection that
   // the user changed while the cloud response was in flight.
   const selection=clone(this.getSelection()),selectedPattern=engine.selectedPattern||engine.project?.selectedPattern;
   this.assertScope(scope);this.assertIdle({owned:true});
   if(session.project.patterns?.some(pattern=>pattern.id===selectedPattern))session.project.selectedPattern=selectedPattern;
   try{engine.accept(session.project);this.assertScope(scope);this.restoreSelection(selection,{scope:clone(scope),patternId:plan.patternId});}
   catch(cause){entry.displayError=cause.message;throw fail('The rack clipboard update is confirmed, but refreshing its local display failed.','rack_clipboard_display_failed',{cause});}
   this.notify();return this.snapshot();
  }catch(error){
   if(!dispatched)entry.status='failed';entry.error=error.message;this.notify();
   throw Object.assign(error,{operationCommitted:!!entry.receipt,operationUncertain:entry.status==='uncertain',rackClipboardReceipt:clone(entry)});
  }finally{if(owned&&engine.rackClipboardApplying===entry){engine.rackClipboardApplying=null;engine.applying=false;}}
 }
}
