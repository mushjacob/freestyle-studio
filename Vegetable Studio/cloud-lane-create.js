/** Real persisted audio/vocal lanes. Dedicated create_track remains the default;
 * the runtime-unverified native-first gateway requires explicit opt-in.
 * Instrument creation is a different action; a pattern source is never a lane.
 */
const clone=value=>value==null?value:structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const fail=(message,code='lane_create_invalid_result')=>Object.assign(new Error(message),{code});
const marked=value=>value===false||value===0||value===''||value==null?false:typeof value==='object'?Object.values(value).some(marked):true;
function complete(value,depth=0,budget={left:100000}){
 if(--budget.left<0||depth>32)throw fail('The complete lane response could not be inspected.');
 if(value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value))return;
 if(!value||typeof value!=='object')throw fail('Freestyle returned incomplete lane data.');
 for(const [key,child]of Object.entries(value)){if(/truncated/i.test(key)&&marked(child))throw fail('Read complete lane data before continuing.');complete(child,depth+1,budget);}
 if(Array.isArray(value))for(let i=0;i<value.length;i++)if(!own(value,i))throw fail('Freestyle returned an incomplete lane list.');
}
function unpack(result,projectId,{native=false}={}){
 complete(result);let value=result;
 for(const key of ['project_id','projectId'])if(own(value,key)&&value[key]!==projectId)throw fail('The lane result belongs to another project.','lane_create_scope_changed');
 if(result?.isError)throw Object.assign(fail('Freestyle rejected the lane request.','lane_create_rejected'),{rejected:true});
 if(own(value,'structuredContent'))value=value.structuredContent;
 else if(Array.isArray(value?.content)){try{value=JSON.parse(value.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{throw fail('Freestyle returned unreadable lane data.');}}
 for(let depth=0;depth<8;depth++){
  if(!record(value)||!Object.keys(value).length)throw fail('Freestyle returned no usable lane result.');complete(value);
  for(const key of ['project_id','projectId'])if(own(value,key)&&value[key]!==projectId)throw fail('The lane result belongs to another project.','lane_create_scope_changed');
  if(value.ok===false||value.success===false||value.error)throw Object.assign(fail(typeof value.error==='string'?value.error:value.error?.message||value.message||'Freestyle rejected the lane request.','lane_create_rejected'),{rejected:!(native&&own(value,'db_lane_id'))});
  if(!own(value,'response'))return clone(value);value=value.response;
 }
 throw fail('The lane response contains too many nested results.');
}
export function parseLaneProject(result,projectId){
 const data=unpack(result,projectId),project=record(data.project)?data.project:data;
 if(project.id!==projectId||!Array.isArray(project.lanes))throw fail('Freestyle did not return this project’s complete saved lane list.');
 const ids=new Set();for(const lane of project.lanes){if(!record(lane)||!id(lane.id)||ids.has(lane.id))throw fail('Freestyle returned invalid or duplicate saved lane identities.');ids.add(lane.id);}
 return clone(project);
}
export function laneCreateRequest(projectId,{kind,name,...extra}={}){
 if(!id(projectId)||!['audio','vocal'].includes(kind)||Object.keys(extra).length)throw fail('Choose an audio or vocal lane. Instrument lanes use their own instrument command.','lane_create_invalid_input');
 if(name!==undefined&&(typeof name!=='string'||Array.from(name).length>80||!name.trim()||/[\u0000-\u001f\u007f]/.test(name)))throw fail('Give the lane a name of 1 to 80 characters.','lane_create_invalid_input');
 return{project_id:projectId,kind,...(name===undefined?{}:{name:name.trim()})};
}
function receiptLaneId(result,{native=false}={}){
 // These are the explicit durable create_track identities already consumed by
 // CloudSession.create. Never resolve a lane from its name or runtime index.
 const candidates=[...(native?[result.db_lane_id]:[]),result.trackId,result.laneId,result.track?.id,result.lane?.id,result.id].filter(value=>value!==undefined);
 if(native&&!id(result.db_lane_id))throw fail('Native lane creation returned without a durable db_lane_id. Inspect lanes before creating another.');
 if(!candidates.length||candidates.some(value=>!id(value))||new Set(candidates).size!==1)throw fail('The lane request returned without one unambiguous saved lane identity. Inspect lanes before creating another.');
 return candidates[0];
}
export class CloudLaneCreate{
 constructor({engine,onChange=()=>{},nativeFirst=false}={}){if(typeof engine?.session?.call!=='function')throw new Error('Lane creation requires a cloud session.');Object.assign(this,{engine,onChange,nativeFirst:nativeFirst===true});this.operation=null;this.records=[];this.sequence=0;this.generation=0;this.destroyed=false;}
 capture(){const e=this.engine,s=e.session,scope={projectId:e.projectId,trackId:s.trackId,loadVersion:e.loadVersion||0,contextVersion:s.contextVersion||0};if(this.destroyed||!e.ready||e.loading||s.closed||s.projectId!==scope.projectId||!id(scope.projectId)||!id(scope.trackId)||!['loadVersion','contextVersion'].every(key=>Number.isInteger(scope[key])&&scope[key]>=0))throw fail('Open a ready cloud project before adding a lane.','lane_create_scope_changed');return scope;}
 current(scope,generation=this.generation){try{return generation===this.generation&&same(scope,this.capture());}catch{return false;}}
 assert(scope,generation){if(!this.current(scope,generation))throw fail('The project or engine context changed during lane creation.','lane_create_scope_changed');}
 get busy(){return !!this.operation;}
 snapshot(){let scope=null;try{scope=this.capture();}catch{}const receipt=this.records.filter(item=>same(item.scope,scope)).at(-1)||null;return clone({scope,busy:this.busy,status:this.operation?.phase||receipt?.status||'idle',receipt,records:this.records});}
 notify(){if(!this.destroyed)try{this.onChange(this.snapshot());}catch{}}
 create(options){
  const scope=this.capture(),request=laneCreateRequest(scope.projectId,options),native=this.nativeFirst&&(this.engine.session.rawState?.studioApi===true||this.engine.session.project?.cloud?.rawState?.studioApi===true);if(this.busy)throw fail('Wait for the current lane request.','lane_create_busy');if(this.engine.interacting)throw fail('Finish the current drag before adding a lane.','lane_create_busy');
  const last=this.snapshot().receipt;if(last&&['uncertain','saved_unconfirmed','rejected'].includes(last.status)&&!last.inspection)throw fail('Inspect the previous lane result before creating another. It will not be retried.','lane_create_inspection_required');
  const generation=this.generation,entry={sequence:++this.sequence,scope,request,status:'preparing',before:null,rawResult:null,laneId:null,lane:null,inspection:null,error:null},operation={phase:'preparing'};this.records.push(entry);this.operation=operation;this.notify();
  operation.promise=(async()=>{let sent=false;try{
   await this.engine.flush?.();this.assert(scope,generation);if(this.engine.interacting)throw fail('Finish the current drag before adding a lane.','lane_create_busy');
   entry.before=parseLaneProject(await this.engine.session.call('get_project',{project_id:scope.projectId}),scope.projectId);this.assert(scope,generation);
   operation.phase=entry.status='creating';this.notify();this.assert(scope,generation);sent=true;
   entry.rawResult=clone(await this.engine.session.call(native?'execute_pro_action':'create_track',native?{project_id:scope.projectId,track_id:scope.trackId,action:'create_empty_lane',arguments:{kind:request.kind,...(own(request,'name')?{label:request.name}:{})}}:clone(request)));const receipt=unpack(entry.rawResult,scope.projectId,{native});entry.status='acknowledged';entry.receipt=receipt;this.assert(scope,generation);entry.laneId=receiptLaneId(receipt,{native});
   operation.phase='confirming';this.notify();const after=parseLaneProject(await this.engine.session.call('get_project',{project_id:scope.projectId}),scope.projectId);this.assert(scope,generation);
   this.confirm(entry,after);entry.status='confirmed';return clone(entry);
  }catch(error){entry.error=error.message;entry.errorCode=error.code||null;entry.status=!sent?'not_sent':error.rejected||error.status>=400&&error.status<500&&error.status!==408?'rejected':entry.status==='acknowledged'?'saved_unconfirmed':'uncertain';error.laneReceipt=clone(entry);throw error;}
  finally{if(this.operation===operation)this.operation=null;this.notify();}})();return operation.promise;
 }
 confirm(entry,project){const lane=project.lanes.find(lane=>lane.id===entry.laneId),kind=['audio','vocal'].includes(lane?.trackType)?lane.trackType:lane?.kind;if(!lane||entry.before?.lanes.some(old=>old.id===entry.laneId)||kind!==entry.request.kind||own(entry.request,'name')&&lane.name!==entry.request.name)throw fail('The saved project did not confirm this new lane. Inspect lanes; creation will not be repeated.');entry.lane=clone(lane);}
 inspect(){
  const scope=this.capture();if(this.busy)throw fail('Wait for the current lane request.','lane_create_busy');const generation=this.generation,entry=this.snapshot().receipt,operation={phase:'inspecting'};this.operation=operation;this.notify();
  operation.promise=(async()=>{try{const project=parseLaneProject(await this.engine.session.call('get_project',{project_id:scope.projectId}),scope.projectId);this.assert(scope,generation);const inspection={project,sequence:entry?.sequence??null};if(entry){const original=this.records.find(item=>item.sequence===entry.sequence);original.inspection=clone(inspection);if(original.laneId)try{this.confirm(original,project);original.status='confirmed';}catch{}}return clone(inspection);}finally{if(this.operation===operation)this.operation=null;this.notify();}})();return operation.promise;
 }
 invalidate(){this.generation++;this.notify();}
 destroy(){this.destroyed=true;this.generation++;}
}
