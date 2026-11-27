import {isIdempotencyInProgress} from './cloud-errors.js';
/** Named cloud snapshots and explicit project copies. No local project format is invented. */
const clone=value=>value==null?value:structuredClone(value);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=64;
const describe=value=>typeof value==='string'?value:value?.message||value?.detail||'Freestyle could not save the project.';

export function unwrapProjectSave(result){
 let data=result?.structuredContent;
 if(data===undefined&&Array.isArray(result?.content)){
  const text=result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n');
  if(text){try{data=JSON.parse(text);}catch{throw new Error('Freestyle returned an unreadable project-save receipt.');}}
 }
 data=data??result??{};const payload=data?.response??data;
 if(result?.isError||data?.ok===false||data?.error||payload?.ok===false||payload?.error){const error=new Error(describe(payload?.error||data?.error||payload?.message||data?.message));error.cloudRejected=true;error.result=clone(result);throw error;}
 return payload;
}

function textOption(value,label){
 if(value===undefined)return undefined;
 if(typeof value!=='string'||Array.from(value).length>255)throw new Error(`${label} must be text with at most 255 characters.`);
 return value;
}

export function projectSaveRequest(project,operation,options={}){
 const projectId=project?.cloud?.projectId||project?.id;
 if(!identity(projectId))throw new Error('Open a Freestyle cloud project before saving.');
 if(!['save','duplicate'].includes(operation))throw new Error('Choose a project snapshot or a project copy.');
 const source={projectId,title:String(project.title||project.name||'Untitled')};
 const value=operation==='save'?textOption(options.name,'Snapshot name'):textOption(options.title,'Copy title');
 return {operation,source,...(value===undefined?{}:operation==='save'?{name:value}:{title:value})};
}

export function projectSaveIdentity(payload,request){
 if(request.operation==='duplicate'){
  const project=payload.project||payload.newProject||payload.new_project;
  const projectId=project?.id||project?.projectId||payload.newProjectId||payload.duplicatedProjectId||payload.projectId||payload.project_id||payload.id;
  if(!identity(projectId)||projectId===request.source.projectId)throw new Error('Freestyle did not return a distinct copied project identity. Inspect the project library before creating another copy.');
  if(payload.sourceProjectId&&payload.sourceProjectId!==request.source.projectId)throw new Error('Freestyle returned a copy receipt for a different source project. Inspect the project library before retrying.');
  const track=project?.lanes?.find(lane=>lane?.id&&lane.id!=='backing')?.id||project?.trackId||payload.copyTrackId;
  return {copyProjectId:projectId,copyTrackId:identity(track)?track:null,copyTitle:typeof project?.title==='string'?project.title:null};
 }
 const projectId=payload.projectId||payload.project_id||payload.save?.projectId||payload.save?.project_id;
 if(projectId&&projectId!==request.source.projectId)throw new Error('Freestyle returned a snapshot receipt for a different project. Inspect saved versions before retrying.');
 const saveId=payload.saveId||payload.save_id||payload.save?.id||payload.snapshot?.id||payload.snapshotId||payload.id;
 if(!identity(saveId))throw new Error('Freestyle did not return a saved snapshot identity. Inspect saved versions before saving again.');
 return {saveId};
}

function definiteRejection(error){if(isIdempotencyInProgress(error))return false;
 if(error?.cloudRejected)return true;
 if(error?.result!==undefined){try{unwrapProjectSave(error.result);}catch(receiptError){if(receiptError.cloudRejected)return true;}}
 // These statuses represent validated input/authentication rejection before
 // dispatch. A network failure or a 5xx response can follow a committed write.
 return [400,401,403,422].includes(Number(error?.status));
}

const sameRequest=(a,b)=>a&&b&&a.operation===b.operation&&a.source.projectId===b.source.projectId&&a.name===b.name&&a.title===b.title;

export class ProjectSaveController {
 constructor({getProject,flush=async()=>{},cloudCall,isInteracting=()=>false,isBusy=()=>false,openProject,onChange=()=>{},onError=()=>{}}={}){
  if(typeof getProject!=='function'||typeof cloudCall!=='function')throw new TypeError('ProjectSaveController requires getProject and cloudCall callbacks.');
  Object.assign(this,{getProject,flush,cloudCall,isInteracting,isBusy,openProject,onChange,onError});this.inFlight=null;this.opening=null;
  this.state={status:'idle',operation:null,source:null,request:null,receipt:null,payload:null,saveId:null,copyProjectId:null,copyTrackId:null,copyTitle:null,error:null,opened:false};
 }
 snapshot(){return clone(this.state);}
 notify(){const state=this.snapshot();this.onChange(state);return state;}
 projectId(){const project=this.getProject();return project?.cloud?.projectId||project?.id;}
 guard(){if(this.isInteracting())throw new Error('Finish the current edit before saving a project.');if(this.isBusy())throw new Error('Wait for the current cloud operation before saving.');}
 save(options={}){return this.perform('save',options);}
 duplicate(options={}){return this.perform('duplicate',options);}
 async perform(operation,options){
  const request=projectSaveRequest(this.getProject(),operation,options);
  if(this.inFlight){if(sameRequest(request,this.state.request))return this.inFlight;throw new Error('A project save or copy is already in progress.');}
  if(this.opening||this.state.status==='opening')throw new Error('Wait for the copied project to finish opening.');
  if(this.state.status==='uncertain')throw new Error('The previous save receipt is uncertain. Inspect the project library or saved versions before trying another save or copy.');
  this.guard();this.state={status:operation==='save'?'saving':'duplicating',operation,source:clone(request.source),request:clone(request),receipt:null,payload:null,saveId:null,copyProjectId:null,copyTrackId:null,copyTitle:null,error:null,opened:false};this.notify();
  let sent=false;
  const task=(async()=>{
   try{
    await this.flush();this.guard();if(this.projectId()!==request.source.projectId)throw new Error('The cloud project changed before the save request was sent.');
    const args=operation==='save'?{project_id:request.source.projectId,snapshot_only:true,...(request.name===undefined?{}:{name:request.name})}:{project_id:request.source.projectId,...(request.title===undefined?{}:{title:request.title})};
    sent=true;const result=await this.cloudCall(operation==='save'?'create_project_save':'duplicate_project',args);
    this.state.receipt=clone(result);const payload=unwrapProjectSave(result);this.state.payload=clone(payload);
    const resultIdentity=projectSaveIdentity(payload,request);Object.assign(this.state,resultIdentity,{status:operation==='save'?'saved':'copied',error:null});
   }catch(error){if(error.result&&!this.state.receipt)this.state.receipt=clone(error.result);this.state.status=!sent||definiteRejection(error)?'failed':'uncertain';this.state.error=error.message;this.notify();this.onError(error);throw error;}
   return this.notify();
  })();this.inFlight=task;
  try{return await task;}finally{if(this.inFlight===task)this.inFlight=null;}
 }
 copyTarget(){
  const id=this.state.copyProjectId;
  if(!identity(id)||id===this.state.source?.projectId||!['copied','opening'].includes(this.state.status))throw new Error('Create and verify a distinct project copy before opening it.');
  return {projectId:id,trackId:this.state.copyTrackId||undefined};
 }
 async openCopy(){
  if(this.opening)return this.opening;
  if(this.inFlight)throw new Error('Wait for the project copy to finish.');
  const target=this.copyTarget();if(typeof this.openProject!=='function')throw new Error('Opening a copied project is not configured.');
  this.guard();this.state.status='opening';this.state.error=null;this.notify();
  const task=(async()=>{
   try{await this.openProject(target.projectId,target.trackId);this.state.opened=true;this.state.status='copied';return this.notify();}
   catch(error){this.state.status='copied';this.state.error=error.message;this.notify();this.onError(error);throw error;}
  })();this.opening=task;
  try{return await task;}finally{if(this.opening===task)this.opening=null;}
 }
}
