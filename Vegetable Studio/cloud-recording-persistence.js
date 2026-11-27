/** Persist one captured file into its immutable original Freestyle context. */
import {cloudOperationError} from './cloud-session.js';
export const RECORDING_UPLOAD_LIMIT=25*1024*1024;
const clone=value=>value==null?value:structuredClone(value),record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64,finite=value=>typeof value==='number'&&Number.isFinite(value);
function freeze(value,seen=new WeakSet()){if(!value||typeof value!=='object'||seen.has(value))return value;seen.add(value);for(const child of Object.values(value))freeze(child,seen);return Object.freeze(value);}
const marked=value=>value===false||value===0||value===''||value==null?false:typeof value==='object'?Object.values(value).some(marked):true;
function complete(value){if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&marked(child))throw new Error('Freestyle returned incomplete recording data.');complete(child);}}
function truncatedCollection(project,name){let global=false;const specific=[];for(const [key,value]of Object.entries(project)){if(new RegExp(`${name}.*trunc|trunc.*${name}`,'i').test(key))specific.push(value!==false&&value!==0);else if(key==='truncated'||/^_+truncated$/i.test(key)){if(record(value)&&Object.prototype.hasOwnProperty.call(value,name))specific.push(value[name]!==false&&value[name]!==0);else global||=marked(value);}}return specific.some(Boolean)||global&&!specific.includes(false);}
function unwrap(result){
 let data=result?.structuredContent;
 if(data===undefined&&Array.isArray(result?.content)){try{data=JSON.parse(result.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{throw new Error('Freestyle returned an unreadable recording receipt.');}}
 data=data??result;const payload=data?.response??data;
 if(result?.isError||data?.ok===false||data?.error||payload?.ok===false||payload?.error)throw cloudOperationError(result,{fallback:'Freestyle rejected recording persistence.'});
 if(!record(payload)||!Object.keys(payload).length)throw new Error('Freestyle returned no usable recording receipt.');return clone(payload);
}
function rejection(error){const status=error?.status??error?.result?.status??error?.result?.response?.status;if(error?.operationUncertain===true||error?.stage==='engine_dispatch'&&error?.operationUncertain!==false&&error?.explicitRejection!==true||status>=500||status===408)return false;return status>=400&&status<500||error?.explicitRejection===true;}
function checkProject(data,projectId){for(const key of ['projectId','project_id'])if(data?.[key]!==undefined&&data[key]!==projectId)throw new Error('Freestyle returned recording data for a different project.');if(record(data?.project)&&data.project.id!==undefined&&data.project.id!==projectId)throw new Error('Freestyle returned recording data for a different project.');}
function uploadIdentity(receipt,context){
 checkProject(receipt,context.projectId);
 const values=[receipt.clipId,receipt.clip?.id].filter(value=>value!==undefined&&value!==null);
 if(!values.length||values.some(value=>!id(value))||new Set(values).size!==1)throw new Error('The upload returned no consistent durable clipId/clip.id. Inspect the cloud project; this file will not be uploaded again.');
 for(const lane of [receipt.laneId,receipt.clip?.laneId])if(lane!==undefined&&lane!==context.laneId)throw new Error('The upload acknowledged a different recording lane. Inspect its receipt before another edit.');
 checkProject(receipt.clip,context.projectId);return values[0];
}
function canonicalClip(result,context,clipId){
 const data=unwrap(result);checkProject(data,context.projectId);const project=record(data.project)?data.project:data;
 if(project.id!==context.projectId||!Array.isArray(project.clips)||!Array.isArray(project.lanes))throw new Error('Freestyle returned no canonical audio-clip and lane lists for the captured project.');
 if(truncatedCollection(project,'clips')||truncatedCollection(project,'lanes'))throw new Error('Freestyle returned incomplete canonical recording clip or lane lists.');
 complete(project.clips);complete(project.lanes);const lanes=project.lanes.filter(lane=>lane?.id===context.laneId);if(lanes.length!==1||!['audio','vocal'].includes(lanes[0].kind))throw new Error('The captured recording lane is not uniquely confirmed as a saved audio or vocal lane.');const found=project.clips.filter(clip=>clip?.id===clipId);
 if(found.length!==1)throw new Error('The uploaded durable clip is not uniquely confirmed in its captured project. Read its state before retrying; no upload will be repeated.');
 const clip=found[0];if(clip.laneId!==context.laneId)throw new Error('The canonical uploaded clip belongs to a different lane.');
 return{project,clip};
}
function encodedFile(value,size){
 if(typeof value!=='string')throw new Error('Recording encoding returned no base64 file.');
 const raw=value.startsWith('data:')?value.slice(value.indexOf(',')+1):value;
 if(value.startsWith('data:')&&!/^data:[^,]*;base64,/.test(value)||raw.length<4||raw.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(raw))throw new Error('Recording encoding returned malformed base64.');
 const bytes=raw.length/4*3-(raw.endsWith('==')?2:raw.endsWith('=')?1:0);
 if(bytes!==size||bytes>RECORDING_UPLOAD_LIMIT)throw new Error('The encoded recording size does not match the captured file or exceeds 25 MB.');return value;
}
function placementReceipt(result,context){
 const data=unwrap(result);checkProject(data,context.projectId);complete(data);
 for(const [key,value]of [['db_clip_id',context.clipId],['db_track_id',context.laneId]])if(data[key]!==undefined&&data[key]!==value)throw new Error('The recording placement receipt identifies a different saved lane or clip.');
 if(data.engine_reload_required!==undefined&&typeof data.engine_reload_required!=='boolean')throw new Error('Freestyle returned an invalid recording mirror acknowledgement.');return data;
}
function unchangedMedia(before,after){
 // Only start_ms is written. Known source/window/level fields must not silently
 // change during confirmation; missing offsets are never treated as zero.
 for(const key of ['durationSec','audioOffsetSec','audioFullDurationSec','volume','muted','audioSourceId','sourceId','audioFileId'])if(Object.prototype.hasOwnProperty.call(before,key)&&JSON.stringify(before[key])!==JSON.stringify(after[key]))return false;
 for(const key of ['audioOffsetSec','audioFullDurationSec'])if(before.effects?.timing?.[key]!==undefined&&before.effects.timing[key]!==after.effects?.timing?.[key])return false;
 return true;
}
export class CloudRecordingPersistence{
 constructor({context,file,call,encodeFile,onChange=()=>{},title}={}){
  if(typeof call!=='function'||typeof encodeFile!=='function')throw new TypeError('Recording persistence needs cloud call and file encoder callbacks.');
  const captured=clone(context);
  if(!record(captured)||!['projectId','contextTrackId','laneId'].every(key=>id(captured[key]))||!finite(captured.bpm)||captured.bpm<=0||!finite(captured.songStartSec)||captured.songStartSec<0||!finite(captured.songStartSec*1000))throw new Error('Recording persistence needs its captured project, engine context, durable lane, tempo and song start.');
  if(!file||!Number.isSafeInteger(file.size)||file.size<=0||file.size>RECORDING_UPLOAD_LIMIT||typeof file.name!=='string'||!file.name||Array.from(file.name).length>160)throw new Error('Choose a named captured recording of at most 25 MB.');
  if(title!==undefined&&(typeof title!=='string'||Array.from(title).length>120))throw new Error('The recording title exceeds the documented upload limit.');
  this.context=freeze(captured);this.file=file;this.call=call;this.encodeFile=encodeFile;this.onChange=onChange;this.title=title??Array.from(file.name).slice(0,120).join('');this.persistPromise=null;this.running=false;this.observing=null;this.resuming=null;
  this.state={status:'idle',projectId:captured.projectId,laneId:captured.laneId,persisted:false,uploaded:false,clipId:null,saved:null,uploadReceipt:null,uploadAcknowledgement:null,placementReceipt:null,placementAcknowledgement:null,placementBefore:null,placementPending:true,liveReloadPending:false,liveStateVerified:false,uploadAttempted:false,placementAttempted:false,uploadUncertain:false,placementUncertain:false,canonicalClip:null,canonicalProject:null,error:null};
 }
 snapshot(){return{...clone(this.state),context:clone(this.context),file:this.file};}
 notify(){const state=this.snapshot();try{this.onChange(state);}catch{}return state;}
 fail(error){this.state.error=error.message;this.state.errorCode=error.code??null;this.state.errorStage=error.stage??null;this.state.engineStatus=error.engineStatus??null;this.notify();return Object.assign(error,{recordingPersistence:this.snapshot()});}
 persist(){
  if(this.persistPromise)return this.persistPromise;
  this.running=true;
  this.persistPromise=(async()=>{
   try{
    this.state.status='encoding';this.notify();const base64=encodedFile(await this.encodeFile(this.file),this.file.size);
    this.state.status='uploading';this.state.uploadAttempted=true;this.notify();let receipt;
    try{const result=await this.call('upload_audio',{project_id:this.context.projectId,track_id:this.context.laneId,kind:'audio',filename:this.file.name,title:this.title,base64});this.state.uploadAcknowledgement=clone(result);receipt=unwrap(result);this.state.saved=receipt;this.state.uploadReceipt=clone(receipt);this.state.clipId=uploadIdentity(receipt,this.context);this.state.uploaded=true;if(receipt.engine_reload_required===true)this.state.liveReloadPending=true;}
    catch(error){if(this.state.uploadAcknowledgement===null&&error.result)this.state.uploadAcknowledgement=clone(error.result);this.state.status=rejection(error)?'upload-rejected':'upload-uncertain';this.state.uploadUncertain=!rejection(error);throw error;}
    return await this.readAndPlace({allowPlacement:true});
   }catch(error){if(!this.state.uploadAttempted)this.state.status='encoding-failed';else if(!['upload-rejected','upload-uncertain','placement-rejected','placement-uncertain','placement-unconfirmed','placement-read-failed'].includes(this.state.status))this.state.status='upload-unconfirmed';throw this.fail(error);}
  })().finally(()=>{this.running=false;});return this.persistPromise;
 }
 async read(){
  if(!this.state.clipId)throw new Error('No verified durable upload identity is available. Inspect the retained receipt; filename matching and re-upload are disabled.');
  const observed=canonicalClip(await this.call('get_project',{project_id:this.context.projectId}),this.context,this.state.clipId);this.state.canonicalClip=clone(observed.clip);this.state.canonicalProject=clone(observed.project);return observed;
 }
 async readAndPlace({allowPlacement=false}={}){
  this.state.status='observing';this.notify();let observed=await this.read();this.state.persisted=false;
  const desired=this.context.songStartSec*1000;
  if(!finite(observed.clip.startMs)||observed.clip.startMs<0){this.state.status='placement-pending';this.state.placementPending=true;return this.notify();}
  if(observed.clip.startMs!==desired){
   if(!allowPlacement||this.state.placementAttempted){this.state.status='placement-pending';this.state.placementPending=true;return this.notify();}
   const before=clone(observed.clip);this.state.placementBefore=clone(before);this.state.status='positioning';this.state.placementAttempted=true;this.notify();
   const args={project_id:this.context.projectId,track_id:this.context.contextTrackId,action:'shift_clip',arguments:{track_id:this.context.laneId,clip_id:this.state.clipId,start_ms:desired}};this.state.placementAction='shift_clip';this.state.placementRequest=clone(args);
   try{const result=await this.call('execute_pro_action',args);this.state.placementAcknowledgement=clone(result);this.state.placementReceipt=placementReceipt(result,{...this.context,clipId:this.state.clipId});this.state.liveReloadPending||=this.state.placementReceipt.engine_reload_required===true;}
   catch(error){if(this.state.placementAcknowledgement===null&&error.result)this.state.placementAcknowledgement=clone(error.result);this.state.status=rejection(error)?'placement-rejected':'placement-uncertain';this.state.placementUncertain=!rejection(error);throw error;}
   this.state.status='confirming';this.notify();
   try{observed=await this.read();}catch(error){this.state.status='placement-read-failed';throw error;}
   if(observed.clip.startMs!==desired||!unchangedMedia(before,observed.clip)){this.state.status='placement-unconfirmed';throw new Error('The canonical recording has not confirmed its exact placement and retained media window/level. No timing write will be repeated.');}
  }
  if(this.state.placementBefore&&!unchangedMedia(this.state.placementBefore,observed.clip)){this.state.status='placement-unconfirmed';throw new Error('The observed recording media window/level differs from its acknowledged positioning snapshot. No timing write will be repeated.');}
  this.state.status='persisted';this.state.persisted=true;this.state.placementPending=false;this.state.error=null;return this.notify();
 }
 /** Read-only recovery of the known clip; never upload or repeat a timing edit. */
 observe(){
  if(this.observing)return this.observing;
  if(this.running||this.resuming)return Promise.reject(new Error('Wait for the current recording persistence stage before observing it.'));
  this.observing=this.readAndPlace({allowPlacement:false}).catch(error=>{this.state.status='observation-failed';throw this.fail(error);}).finally(()=>{this.observing=null;});return this.observing;
 }
 /** Finish an unattempted positioning stage after a prior read failure. */
 resumePlacement(){
  if(this.resuming)return this.resuming;
  if(this.running||this.observing)return Promise.reject(new Error('Wait for the current recording persistence stage before resuming placement.'));
  if(!this.state.uploaded||!this.state.clipId||this.state.placementAttempted)return Promise.reject(new Error('Only an acknowledged upload with no prior timing-write attempt may resume placement. Use read-only observation for an uncertain edit.'));
  this.resuming=this.readAndPlace({allowPlacement:true}).catch(error=>{throw this.fail(error);}).finally(()=>{this.resuming=null;});return this.resuming;
 }
}
