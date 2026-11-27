import {unwrapRangeEditResult,validateRangeBatchOperations,exactRangeMilliseconds} from './audacity-range-edit.js';
import {assertCompleteCanonicalData} from './cloud-session.js';
const clone=value=>structuredClone(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64;

export function normalizeRegionEffectCatalog(raw){
 const data=unwrapRangeEditResult(raw);assertCompleteCanonicalData(data,'region effect catalog');
 if(!Array.isArray(data.effects)||!data.effects.length||!finite(data.limits?.max_region_sec)||data.limits.max_region_sec<=0)throw new Error('Freestyle returned no complete region effect catalog.');
 const seen=new Set();for(const effect of data.effects){if(!id(effect.id)||seen.has(effect.id)||typeof effect.label!=='string'||!effect.params||typeof effect.params!=='object'||Array.isArray(effect.params))throw new Error('Freestyle returned an invalid region effect description.');seen.add(effect.id);for(const schema of Object.values(effect.params)){if(!schema||!['number','integer','boolean','string'].includes(schema.type)||schema.enum!==undefined&&(!Array.isArray(schema.enum)||!schema.enum.length))throw new Error('This effect contains an unsupported parameter schema.');}}
 return clone(data);
}
export function regionEffectParameters(effect,values={}){
 if(!effect||!values||typeof values!=='object'||Array.isArray(values))throw new Error('Choose valid region effect parameters.');
 const result={};for(const key of Object.keys(values))if(!Object.hasOwn(effect.params,key))throw new Error('Unknown effect parameter: '+key);
 for(const [key,schema]of Object.entries(effect.params)){
  if(!Object.hasOwn(values,key))continue;const value=values[key];
  if(schema.type==='boolean'?typeof value!=='boolean':schema.type==='string'?typeof value!=='string':!finite(value)||schema.type==='integer'&&!Number.isSafeInteger(value))throw new Error('Choose a valid '+key+' value.');
  if(schema.enum&&!schema.enum.includes(value))throw new Error('Choose a supported '+key+' value.');
  if(typeof value==='number'&&(finite(schema.minimum)&&value<schema.minimum||finite(schema.maximum)&&value>schema.maximum)){
   // The live fade schemas use default 0 to mean the entire selection although
   // their explicit duration minimum is 1. Preserve that omission semantics.
   if(value===schema.default)continue;throw new Error(key+' is outside the supported range.');
  }
  result[key]=value;
 }
 return result;
}
export function regionEffectArguments({projectId,clipId,startSec,endSec,effect,params={},crossfadeMs=0,allowClipping=false,idempotencyKey}={}){
 if(!id(projectId)||!id(clipId)||!id(effect)||!finite(startSec)||!finite(endSec)||startSec<0||endSec<=startSec||!finite(crossfadeMs)||crossfadeMs<0||crossfadeMs>100||typeof allowClipping!=='boolean')throw new Error('Choose a nonempty audio selection and a supported region effect.');
 if(idempotencyKey!==undefined&&(typeof idempotencyKey!=='string'||idempotencyKey.length<16||idempotencyKey.length>128))throw new Error('A retained region effect idempotency key is required.');
 return {project_id:projectId,track_id:clipId,clip_id:clipId,start_ms:exactRangeMilliseconds(startSec),end_ms:exactRangeMilliseconds(endSec),effect,params:clone(params),crossfade_ms:crossfadeMs,...(idempotencyKey!==undefined?{idempotency_key:idempotencyKey,allow_clipping:allowClipping}:{})};
}
export function regionEffectAppliedReceipt(raw,request){
 const outer=unwrapRangeEditResult(raw),payload=outer.status==='done'&&outer.result?unwrapRangeEditResult(outer.result):outer;
 for(const data of [outer,payload])for(const key of ['projectId','project_id'])if(data[key]!==undefined&&data[key]!==request.projectId)throw new Error('The region effect result belongs to another project.');
 if(payload.applied===false||payload.dry_run===true||['queued','running','planned','failed'].includes(payload.status))throw new Error('The region effect has not confirmed a completed audio edit.');
 if(!Array.isArray(payload.clips_after)||!payload.clips_after.length||!Array.isArray(payload.ops)||!Array.isArray(payload.undo?.inverse_ops))throw new Error('The region effect returned no complete atomic replacement and Undo receipt.');
 const inverseOps=validateRangeBatchOperations(payload.undo.inverse_ops),operations=validateRangeBatchOperations(payload.ops);
 if(payload.region?.clip_id!==undefined&&payload.region.clip_id!==request.clipId)throw new Error('The region effect belongs to another source clip.');
 if(!finite(payload.region?.start_ms)||!finite(payload.region?.end_ms)||payload.region.end_ms<=payload.region.start_ms)throw new Error('The region effect did not report its actual edited boundaries.');
 return {status:'applied',projectId:request.projectId,idempotencyKey:request.idempotencyKey,inverseOps,sourceReceipt:clone(raw),payload:{...clone(payload),ops:operations},cuts:clone(payload.region.cuts??[]),skippedLanes:[]};
}
/** Long-running cloud render: every response is retained, and recovery uses
 * only the captured job id or the original idempotency key. No local DSP. */
export async function observeRegionEffect(entry,call,{maxPolls=60,onProgress=()=>{}}={}){
 let data;
 if(entry.jobId)data=unwrapRangeEditResult(await call('get_region_effect_job',{project_id:entry.request.projectId,track_id:entry.request.clipId,job_id:entry.jobId,wait_sec:20}));
 else data=unwrapRangeEditResult(await call('apply_effect_to_region',{...entry.arguments,wait_sec:20}));
 entry.responses??=[];entry.responses.push(clone(data));
 for(let count=0;;count++){
  if(typeof data.job_id==='string')entry.jobId=data.job_id;
  onProgress(data);
  if(data.status==='failed'){const error=new Error(data.error?.message||data.error||data.message||'The selected-region effect failed.');error.definiteRejection=true;throw error;}
  if(!['queued','running'].includes(data.status))return regionEffectAppliedReceipt(data,entry.request);
  if(!id(entry.jobId))throw new Error('The pending region render returned no recoverable job id.');
  if(count>=maxPolls)throw new Error('The region render is still running. Check its retained job to continue.');
  data=unwrapRangeEditResult(await call('get_region_effect_job',{project_id:entry.request.projectId,track_id:entry.request.clipId,job_id:entry.jobId,wait_sec:20}));entry.responses.push(clone(data));
 }
}
export function regionPreviewUrl(raw,request={}){
 let data=raw?.structuredContent;if(data===undefined&&Array.isArray(raw?.content)){try{data=JSON.parse(raw.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{throw new Error('Freestyle returned no readable region preview.');}}data=data??raw;data=data?.response??data;
 if(raw?.isError)unwrapRangeEditResult(raw);const checked=clone(data);if(typeof checked.preview?.truncated==='boolean')delete checked.preview.truncated;unwrapRangeEditResult(checked);const preview=data.preview??data;
 for(const field of ['projectId','project_id'])if(request.projectId&&data[field]!==undefined&&data[field]!==request.projectId)throw new Error('The preview belongs to another cloud project.');if(request.clipId&&data.region?.clip_id!==undefined&&data.region.clip_id!==request.clipId)throw new Error('The preview belongs to another source clip.');
 const value=preview.clip?.playbackUrl??preview.clip?.playback_url??preview.url??preview.playback_url??preview.audio_url??data.playback_url??data.audio_url;
 let parsed;try{parsed=new URL(value);}catch{throw new Error('Freestyle returned no playable region preview URL.');}
 if(!['https:','http:'].includes(parsed.protocol))throw new Error('Freestyle returned an unsupported preview URL.');
 return {url:parsed.href,receipt:clone(data),truncated:preview.truncated===true};
}

/** Native Apply already supplies the complete forward and inverse transaction.
 * After Undo, its inserted children still exist as soft-deleted durable clips.
 * Restore those exact identities rather than inserting/rerendering again. */
export function regionEffectRedoOperations(receipt){
 const payload=receipt?.payload??receipt,operations=validateRangeBatchOperations(payload?.ops),rows=payload?.clips_after;
 if(!Array.isArray(rows))throw new Error('The retained region result has no exact child windows for Redo.');
 const byId=new Map(rows.map(row=>[row.id??row.clip_id,row]));
 return validateRangeBatchOperations(operations.map(operation=>{
  if(operation.op!=='insert')return clone(operation);
  const row=byId.get(operation.id),expected={start_ms:row?.start_ms??row?.startMs,duration_sec:row?.duration_sec??row?.durationSec,audio_offset_sec:row?.audio_offset_sec??row?.audioOffsetSec};
  if(!Object.values(expected).every(finite))throw new Error('The retained region child has no complete original timing for Redo.');
  return {...clone(operation),op:'restore',expected};
 }));
}
