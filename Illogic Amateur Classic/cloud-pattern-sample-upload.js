/** Disk file -> Channel Rack through the published sample-only upload route.
 * One retained Idempotency-Key per logical upload, no Playlist lane/take/clip,
 * no score events, no automatic retry of an unknown upload outcome.
 */
import {StudioApiClient,STUDIO_API_OPERATIONS} from './studio-api-client.js';
import {registeredPatternSample} from './cloud-pattern-sample-registration.js';
const clone=value=>value==null?value:structuredClone(value),record=value=>!!value&&typeof value==='object'&&!Array.isArray(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const fail=(message,code='pattern_sample_upload_invalid')=>Object.assign(new Error(message),{code});
const schema=STUDIO_API_OPERATIONS.uploadPatternSample?.requestBody?.content?.['application/json']?.schema;
// Decoded byte limit is published in the operation description (25 MB).
export const PATTERN_SAMPLE_UPLOAD_LIMITS=Object.freeze({bytes:25*1024*1024,name:schema?.properties?.name?.maxLength??80,filename:schema?.properties?.filename?.maxLength??160});
const chars=value=>Array.from(value);
/** Display name: the filename without its extension, bounded to the published name length. */
export function patternSampleUploadName(filename){
 const base=String(filename||'').replace(/\.[^./\\]{1,16}$/,'').trim()||'Sample';
 return chars(base).slice(0,PATTERN_SAMPLE_UPLOAD_LIMITS.name).join('');
}
export function validatePatternSampleFile(file){
 if(!file||typeof file.arrayBuffer!=='function'||typeof file.name!=='string'||!file.name.trim())throw fail('Choose a named audio file to add to the Channel Rack.');
 if(!Number.isSafeInteger(file.size)||file.size<=0||file.size>PATTERN_SAMPLE_UPLOAD_LIMITS.bytes)throw fail('Channel Rack samples must be nonempty and at most 25 MB.','file_too_large');
 // String length is checked in both UTF-16 units and code points so neither a
 // JavaScript nor a server-side length count can exceed the published bound.
 if(file.name.length>PATTERN_SAMPLE_UPLOAD_LIMITS.filename||/[\u0000-\u001f\u007f]/.test(file.name))throw fail('The sample filename must be at most 160 characters without control characters.');
 return file;
}
export async function patternSampleBase64(file){
 const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size)throw fail('The selected file changed while it was being read.');
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 const encoded=btoa(binary),decoded=encoded.length/4*3-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);
 if(decoded!==file.size)throw fail('The encoded sample size differs from its selected file.');return encoded;
}
/** Validate one upload receipt and derive the canonical Rack source (fresh source/rack ids). */
export function patternSampleUploadReceipt(result,projectId,{createId=()=>crypto.randomUUID()}={}){
 const status=result?.status,data=result?.data;
 if(![200,201].includes(status)||!record(data))throw fail('Freestyle did not confirm the uploaded Channel Rack sample.','pattern_sample_upload_unconfirmed');
 if(data.projectId!==projectId)throw fail('The uploaded sample belongs to another project.','pattern_sample_upload_unconfirmed');
 if(typeof data.existing!=='boolean'||!id(data.audioFileId)||!record(data.sample)||!id(data.sample.id))throw fail('The upload returned no canonical sample identity.','pattern_sample_upload_unconfirmed');
 if(data.sample.audioFileId!==undefined&&data.sample.audioFileId!==data.audioFileId)throw fail('The upload returned inconsistent canonical audio identities.','pattern_sample_upload_unconfirmed');
 if(data.sha256!==undefined&&(typeof data.sha256!=='string'||!/^[0-9a-f]{64}$/i.test(data.sha256)))throw fail('The upload returned an invalid content digest.','pattern_sample_upload_unconfirmed');
 const canonical=registeredPatternSample(data,projectId,{createId});
 return{...canonical,audioFileId:data.audioFileId,existing:data.existing,status,...(data.sha256!==undefined?{sha256:data.sha256}:{}),uploadReceipt:clone(data)};
}
function classify(error,attempted){
 const status=error?.status;
 // Only an HTTP 4xx answer (other than a timeout) proves nothing was stored.
 const explicit=attempted&&Number.isInteger(status)&&status>=400&&status<500&&status!==408&&error.operationUncertain!==true;
 return{explicit,uncertain:attempted&&!explicit};
}
export class CloudPatternSampleUpload{
 constructor({client=new StudioApiClient(),getScope,idFactory=()=>globalThis.crypto.randomUUID(),createId=()=>globalThis.crypto.randomUUID(),encode=patternSampleBase64}={}){
  if(!client||typeof client.call!=='function'||typeof getScope!=='function'||typeof idFactory!=='function'||typeof createId!=='function'||typeof encode!=='function')throw new TypeError('Pattern sample upload needs a typed client, scope and identity factories.');
  Object.assign(this,{client,getScope,idFactory,createId,encode});this.records=[];this.active=null;
 }
 get busy(){return !!this.active;}
 key(){const key=this.idFactory();if(typeof key!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(key)||this.records.some(entry=>entry.idempotencyKey===key))throw fail('A fresh retained upload key is required.');return key;}
 /** Upload one disk file and, when `attach` is supplied, add it to the target pattern's Rack. */
 upload(file,{targetPatternId,guard=()=>{},attach}={}){
  let scope,identity;
  try{
   validatePatternSampleFile(file);scope=clone(this.getScope());if(!id(scope?.projectId)||scope.projectId==='empty')throw fail('Open a saved Freestyle project before adding a sample to the Channel Rack.');
   if(targetPatternId!==undefined&&!id(targetPatternId))throw fail('Select a saved target pattern before adding a sample.');if(attach!==undefined&&typeof attach!=='function')throw fail('The Rack attachment must be an explicit callback.');
   identity={scope,targetPatternId:targetPatternId??null,file:{name:file.name,size:file.size,lastModified:Number.isFinite(file.lastModified)?file.lastModified:null,type:typeof file.type==='string'?file.type:''}};guard();
  }catch(error){return Promise.reject(error);}
  if(this.active)return Promise.reject(fail('Wait for the current Channel Rack sample upload.','pattern_sample_upload_busy'));
  const prior=this.records.findLast(entry=>same(entry.identity,identity));
  if(prior&&['uploading','upload_uncertain','attaching','attachment_unconfirmed'].includes(prior.status))return Promise.reject(fail('This file has an unconfirmed Channel Rack upload. Inspect the project sample pool and target pattern before adding it again.','pattern_sample_upload_uncertain'));
  const entry={identity:clone(identity),idempotencyKey:null,status:'preparing',attempted:false,acknowledged:false,existing:null,audioFileId:null,sampleId:null,result:null,attachmentAttempted:false,attachmentConfirmed:false,error:null,errorStatus:null,errorCode:null};
  this.records.push(entry);if(this.records.length>32)this.records.shift();this.active=entry;
  const check=()=>{guard();if(!same(scope,this.getScope()))throw fail(entry.attempted?'The project changed. Any uploaded sample remains in its original project sample pool.':'The project changed before the sample upload.','pattern_sample_upload_scope_changed');};
  entry.promise=(async()=>{
   try{
    const base64=await this.encode(file);check();entry.idempotencyKey=this.key();
    const body={base64,filename:file.name,name:patternSampleUploadName(file.name)};
    entry.status='uploading';entry.attempted=true;
    const result=await this.client.call('uploadPatternSample',{path:{project_id:scope.projectId},body},{idempotencyKey:entry.idempotencyKey});
    entry.acknowledged=true;const receipt=patternSampleUploadReceipt(result,scope.projectId,{createId:this.createId});
    Object.assign(entry,{status:'uploaded',existing:receipt.existing,audioFileId:receipt.audioFileId,sampleId:receipt.sample.id,result:clone(receipt.uploadReceipt)});check();
    const payload={projectId:scope.projectId,targetPatternId:identity.targetPatternId,...receipt,record:entry};
    if(attach){entry.status='attaching';entry.attachmentAttempted=true;await attach({...payload,guard:check});check();entry.attachmentConfirmed=true;entry.status='attached';}
    return payload;
   }catch(error){
    const {explicit,uncertain}=classify(error,entry.attempted&&!entry.acknowledged);
    entry.error=String(error?.message||error).slice(0,500);entry.errorStatus=error?.status??null;entry.errorCode=error?.code??null;
    // A response whose receipt cannot be validated may still have stored bytes.
    entry.status=!entry.attempted?'not_sent':entry.attachmentAttempted?'attachment_unconfirmed':entry.audioFileId?'uploaded':entry.acknowledged||uncertain||!explicit?'upload_uncertain':'rejected';
    throw Object.assign(error,{patternSampleUpload:this.describe(entry),operationUncertain:entry.status==='upload_uncertain'||entry.status==='attachment_unconfirmed',explicitRejection:entry.status==='rejected'});
   }finally{if(this.active===entry)this.active=null;}
  })();
  return entry.promise;
 }
 describe(entry){return clone({identity:entry.identity,idempotencyKey:entry.idempotencyKey,status:entry.status,attempted:entry.attempted,acknowledged:entry.acknowledged,existing:entry.existing,audioFileId:entry.audioFileId,sampleId:entry.sampleId,attachmentAttempted:entry.attachmentAttempted,attachmentConfirmed:entry.attachmentConfirmed,error:entry.error,errorStatus:entry.errorStatus,errorCode:entry.errorCode});}
 snapshot(){return this.records.map(entry=>this.describe(entry));}
}
