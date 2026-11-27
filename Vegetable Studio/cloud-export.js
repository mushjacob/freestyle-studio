/** Cloud-rendered export jobs. This module never synthesizes or processes audio. */
import {exportOptionArguments} from './cloud-export-options.js';
const clone=value=>value==null?value:structuredClone(value);
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const terminal=new Set(['ready','failed','cancelled','unavailable']);
const failedStatuses=new Set(['failed','error','cancelled','canceled']);
const completeStatuses=new Set(['complete','completed','ready','success','succeeded']);
const sleepDefault=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

function detail(value){return typeof value==='string'?value:value?.message||value?.detail||'The cloud export failed.';}
export function unwrapExportResult(result){
 let data=result?.structuredContent;
 if(data===undefined&&Array.isArray(result?.content)){
  const text=result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n');
  if(text){try{data=JSON.parse(text);}catch{data={message:text};}}
 }
 data=data??result??{};const payload=data?.response??data;
 if(!failedStatuses.has(String(payload?.status||'').toLowerCase())&&(result?.isError||data?.ok===false||data?.error||payload?.ok===false||payload?.error)){
  const error=new Error(detail(payload?.error||data?.error||payload?.message||data?.message));error.cloudRejected=true;error.result=result;error.retryAfterSec=payload?.retryAfterSec??data?.retryAfterSec;throw error;
 }
 return payload;
}

/** Accept signed HTTPS media URLs and local loopback URLs only. */
export function safeExportUrl(value){
 if(typeof value!=='string'||!value.trim())return null;
 try{const url=new URL(value);if(url.username||url.password)return null;
  if(url.protocol==='https:')return url.href;
  if(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))return url.href;
 }catch{}
 return null;
}

function audioBlocks(result){
 return (Array.isArray(result?.content)?result.content:[]).flatMap(block=>{
  if(block?.type!=='audio'||typeof block.data!=='string'||!/^audio\/[a-z0-9.+-]+$/i.test(block.mimeType||''))return [];
  const data=block.data.replace(/\s/g,'');if(!data||data.length>128*1024*1024||data.length%4===1||!/^[a-z0-9+/]*={0,2}$/i.test(data))return [];
  return [{mimeType:block.mimeType,data,dataUrl:`data:${block.mimeType};base64,${data}`}];
 });
}

/** Do not mistake project/studio URLs or arbitrary result links for audio output. */
/** Stems of a "Split mixer tracks" job: label, per-stem state and (when complete) a safe signed link. */
export function exportStems(payload){
 return (Array.isArray(payload?.stems)?payload.stems:[]).filter(item=>item&&typeof item==='object').map(item=>({index:finite(item.index)?Number(item.index):0,number:String(item.number||''),label:String(item.label||'').slice(0,255),state:String(item.state||'pending'),format:String(item.format||''),bytes:finite(item.bytes)?Number(item.bytes):null,fileName:String(item.fileName||''),downloadUrl:safeExportUrl(item.downloadUrl)}));
}
export function exportMedia(result,payload=unwrapExportResult(result)){
 const candidates=[payload.downloadUrl,payload.directDownloadUrl,payload.export?.downloadUrl,payload.render?.downloadUrl,payload.clip?.downloadUrl,payload.clip?.playbackUrl];
 const downloadUrl=candidates.map(safeExportUrl).find(Boolean)||null;
 return {downloadUrl,audio:audioBlocks(result),stems:exportStems(payload)};
}

/** `scope` 'project' = the whole song; 'selection' = the range startSec..endSec (the loop). `choices`: see cloud-export-options.js. */
export function exportRequest(project,{scope='project',startSec,endSec,choices={}}={}){
 const projectId=project?.cloud?.projectId||project?.id;
 if(typeof projectId!=='string'||!projectId)throw new Error('Open a Freestyle cloud project before exporting audio.');
 if(!['project','selection'].includes(scope))throw new Error('Choose the entire project or the current selection.');
 const request={scope,projectId,title:String(project.title||project.name||'Untitled')};
 let range='song',loop=null;
 if(scope==='selection'){
  if(!finite(startSec)||!finite(endSec)||Number(startSec)<0||Number(endSec)<=Number(startSec))throw new Error('Select a non-empty timeline range before exporting the current selection.');
  request.startSec=Number(startSec);request.endSec=Number(endSec);range='loop';loop={startSec:request.startSec,endSec:request.endSec};
 }
 request.options=exportOptionArguments({...choices,range,loop});
 return request;
}

const sameRequest=(a,b)=>a&&b&&a.scope===b.scope&&a.projectId===b.projectId&&a.startSec===b.startSec&&a.endSec===b.endSec&&JSON.stringify(a.options||{})===JSON.stringify(b.options||{});

export class CloudExportController {
 constructor({getProject,cloudCall,flush=async()=>{},onChange=()=>{},onError=()=>{},pollIntervalMs=2000,sleep=sleepDefault,now=()=>Date.now()}={}){
  if(typeof getProject!=='function'||typeof cloudCall!=='function')throw new TypeError('CloudExportController requires getProject and cloudCall callbacks.');
  Object.assign(this,{getProject,cloudCall,flush,onChange,onError,pollIntervalMs,sleep,now});this.starting=null;this.polling=null;this.observation=null;this.observationVersion=0;
  this.state={status:'idle',request:null,jobId:null,downloadUrl:null,audio:[],stems:[],result:null,payload:null,providerStatus:null,progress:null,retryAfterSec:null,error:null,observing:false,timedOut:false};
 }
 snapshot(){return clone(this.state);}
 notify(){const state=this.snapshot();this.onChange(state);return state;}
 projectId(){const p=this.getProject();return p?.cloud?.projectId||p?.id;}
 accept(result,{creating=false,notify=true}={}){
  const payload=unwrapExportResult(result),media=exportMedia(result,payload),providerStatus=typeof payload.status==='string'?payload.status.toLowerCase():null;
  const responseProject=payload.projectId||payload.project_id;
  if(responseProject&&responseProject!==this.state.request.projectId)throw new Error('Freestyle returned an export receipt for a different cloud project.');
  const returnedJob=payload.jobId||payload.job_id||payload.export?.jobId||null;
  if(!creating&&returnedJob&&this.state.jobId&&returnedJob!==this.state.jobId)throw new Error('Freestyle returned a different export job.');
  this.state={...this.state,result:clone(result),payload:clone(payload),providerStatus,progress:finite(payload.progress)?Number(payload.progress):null,retryAfterSec:finite(payload.retryAfterSec)&&Number(payload.retryAfterSec)>0?Number(payload.retryAfterSec):null,error:null,timedOut:false,jobId:returnedJob||this.state.jobId,...media};
  if(failedStatuses.has(providerStatus)){this.state.status=providerStatus==='cancelled'||providerStatus==='canceled'?'cancelled':'failed';this.state.error=detail(payload.message||payload.error||'The cloud export failed.');}
  else if(this.state.request?.options?.stems&&completeStatuses.has(providerStatus)){
   if(media.stems.length&&media.stems.every(stem=>stem.downloadUrl))this.state.status='ready';
   else{this.state.status='unavailable';this.state.error='The stems finished rendering, but Freestyle did not return a download link for every stem.';}
  }
  else if(media.downloadUrl||media.audio.length)this.state.status='ready';
  else if(this.state.jobId)this.state.status='pending';
  else{this.state.status='unavailable';this.state.error=completeStatuses.has(providerStatus)?'The render completed without returning downloadable audio.':'Freestyle returned no downloadable audio or export job identity.';}
  return notify?this.notify():this.snapshot();
 }
 async begin(options={}){
  const request=exportRequest(this.getProject(),options);
  if(this.starting){if(sameRequest(request,this.state.request))return this.starting;throw new Error('An export request is already being sent.');}
  if(this.state.status==='pending'&&this.state.jobId){if(sameRequest(request,this.state.request))return this.snapshot();throw new Error('An export is already pending. Resume that job before starting a different export.');}
  if(this.state.status==='uncertain')throw new Error('The previous export receipt is uncertain. Check the project’s exports before sending another render request.');
  this.cancelObservation();this.state={status:'starting',request,jobId:null,downloadUrl:null,audio:[],stems:[],result:null,payload:null,providerStatus:null,progress:null,retryAfterSec:null,error:null,observing:false,timedOut:false};this.notify();
  let sent=false;
  const task=(async()=>{
   try{
    await this.flush();if(this.projectId()!==request.projectId)throw new Error('The cloud project changed before the export request was sent.');
    // One typed operation for the whole song and for a range: the same job, promotion and signed link.
    sent=true;return this.accept(await this.cloudCall('export_mix',{project_id:request.projectId,...request.options}),{creating:true});
   }catch(error){
    // 409 export_in_progress: the server refused a second export with other options; nothing was started.
    const busy=error?.code==='export_in_progress'||error?.details?.code==='export_in_progress';
    if(busy)error.message='Another export with different options is still running for this project. Wait for it to finish, then try again.';
    this.state.status=!sent?'cancelled':error.cloudRejected||busy||error.dispatched===false||(error.status>=400&&error.status<500)?'failed':'uncertain';this.state.error=error.message;this.notify();this.onError(error);throw error;}
  })();this.starting=task;
  try{return await task;}finally{if(this.starting===task)this.starting=null;}
 }
 async poll({refreshReady=false}={}){
  if(this.starting)return this.starting;
  if(this.polling)return this.polling;
  const renewing=this.state.status==='ready'&&refreshReady;
  if((this.state.status!=='pending'&&!renewing)||!this.state.jobId)return this.snapshot();
  const previous=this.snapshot(),request=this.state.request,jobId=this.state.jobId;
  const task=(async()=>{
   try{
    const result=await this.cloudCall('get_export_status',{project_id:request.projectId,job_id:jobId});
    const state=this.accept(result,{notify:false});
    if(renewing&&state.status!=='ready')this.state={...previous,error:state.error||'Freestyle did not return a refreshed download link. The previous file receipt is retained.'};
    return this.notify();
   }catch(error){this.state=renewing?{...previous,error:error.message}:{...this.state,error:error.message,status:'pending'};this.notify();this.onError(error);throw error;}
  })();this.polling=task;
  try{return await task;}finally{if(this.polling===task)this.polling=null;}
 }
 async resume({maxPolls=60,timeoutMs=120000}={}){
  if(!Number.isInteger(maxPolls)||maxPolls<0)throw new Error('The export observation limit must be a non-negative integer.');
  if(!finite(timeoutMs)||Number(timeoutMs)<0)throw new Error('The export observation timeout must be finite and non-negative.');
  if(this.observation)return this.observation;
  if(this.starting)await this.starting;
  if(this.state.status!=='pending'||!this.state.jobId)return this.snapshot();
  const version=++this.observationVersion,deadline=this.now()+Number(timeoutMs);this.state.observing=true;this.state.timedOut=false;this.notify();
  const task=(async()=>{
   try{
    for(let index=0;index<maxPolls&&version===this.observationVersion&&this.now()<deadline;index++){
     await this.poll();if(terminal.has(this.state.status)||version!==this.observationVersion)break;
     if(index+1<maxPolls&&this.now()<deadline)await this.sleep(Math.min(Math.max(this.pollIntervalMs,(this.state.retryAfterSec||0)*1000),Math.max(0,deadline-this.now())));
    }
    if(version===this.observationVersion&&this.state.status==='pending')this.state.timedOut=true;
   }finally{if(version===this.observationVersion){this.state.observing=false;this.notify();}}
   return this.snapshot();
  })();this.observation=task;
  try{return await task;}finally{if(this.observation===task)this.observation=null;}
 }
 cancelObservation(){this.observationVersion++;this.observation=null;this.state.observing=false;return this.notify();}
}
