/** Register existing saved audio as a canonical Channel Rack sample. No upload,
 * temporary lane mutation, local audio, filename matching or automatic retry.
 */
import {cloudOperationError} from './cloud-session.js';
import {STUDIO_API_OPERATIONS} from './studio-api-client.js';
import {hostFetch} from './freestyle-host-transport.js';
const clone=value=>value==null?value:structuredClone(value),record=value=>!!value&&typeof value==='object'&&!Array.isArray(value),own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key),id=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=(message,code='pattern_sample_registration_invalid')=>Object.assign(new Error(message),{code});
const catalogSelectors=new Set(['track_id','audio_file_id','preset_pack_item_id','sound_pack_item_id','catalog_sound_id']);
const registrationFields=STUDIO_API_OPERATIONS.registerPatternSample.requestBody.content['application/json'].schema.properties;
/** Published catalog registration handles are authoritative opaque identities.
 * A presentation row id, rackId or relativePath is never a registration handle.
 */
export function catalogPatternSampleSelector(row){
 if(!record(row))throw fail('Read a playable sound from the current catalog.');
 if(row.canAdd===false)throw fail('This catalog sound is not addable. Read its canAddReason before registering it.');
 if(own(row,'register')){
  const handle=row.register,keys=record(handle)?Object.keys(handle):[];
  const selectors=keys.filter(key=>catalogSelectors.has(key));
  if(selectors.length!==1||!id(handle[selectors[0]])||keys.some(key=>!own(registrationFields,key)||!catalogSelectors.has(key)&&key!=='name'||typeof handle[key]!==registrationFields[key].type||registrationFields[key].maxLength!==undefined&&Array.from(handle[key]).length>registrationFields[key].maxLength))throw fail('This sound has an invalid or ambiguous registration handle. Read the catalog again.');
  return clone(handle);
 }
 // Keep older explicit canonical selectors supported. Generic row.id is
 // deliberately absent; the new handle also takes precedence over row metadata.
 const audioIds=[row.audioFileId,row.audio_file_id].filter(value=>value!==undefined),selectors=[];
 if(audioIds.length){if(audioIds.some(value=>!id(value))||new Set(audioIds).size!==1)throw fail('This library row has ambiguous audio identities.');selectors.push(['audio_file_id',audioIds[0]]);}
 for(const key of ['preset_pack_item_id','sound_pack_item_id','catalog_sound_id'])if(row[key]!==undefined){if(!id(row[key]))throw fail('This library row has an invalid sound registration identity.');selectors.push([key,row[key]]);}
 if(selectors.length>1)throw fail('This library row has ambiguous audio identities.');
 return selectors.length?Object.fromEntries(selectors):null;
}
function body(result){let data=result?.structuredContent;if(data===undefined&&Array.isArray(result?.content))try{data=JSON.parse(result.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{throw fail('Freestyle returned unreadable sample registration data.');}data=data??result;const value=data?.response??data;if(result?.isError||data?.error||data?.ok===false||value?.error||value?.ok===false)throw cloudOperationError({...result,structuredContent:data});if(!record(value))throw fail('Freestyle returned no canonical sample.');return value;}
function complete(value,depth=0){if(!value||typeof value!=='object')return;if(depth>12)throw fail('The sample descriptor exceeds its inspection limit.');for(const [key,child]of Object.entries(value)){if((/^_+truncated/i.test(key)||key==='truncated')&&child)throw fail('Read the complete canonical sample descriptor.');if(child&&typeof child==='object')complete(child,depth+1);}}
export function registeredPatternSample(result,projectId,{createId=()=>crypto.randomUUID()}={}){
 const data=body(result);complete(data);const sample=data.sample;if(!record(sample))throw fail('Registration returned no canonical sample descriptor.');
 for(const item of [data,sample])for(const key of ['projectId','project_id'])if(own(item,key)&&item[key]!==projectId)throw fail('The registered sample belongs to another project.');
 const identities=[data.audioFileId,data.audio_file_id,sample.audioFileId,sample.audio_file_id].filter(value=>value!==undefined);if(!identities.length||identities.some(value=>!id(value))||new Set(identities).size!==1)throw fail('Registration has no consistent explicit audioFileId. A clip ID cannot substitute for a sample asset.');
 if(typeof sample.name!=='string'||!sample.name.trim()||typeof sample.durationSec!=='number'||!Number.isFinite(sample.durationSec)||sample.durationSec<=0)throw fail('The canonical sample has no confirmed name and positive duration.');
 const sourceId=createId(),rackId=createId();if(!id(sourceId)||!id(rackId))throw fail('A sample source needs fresh explicit source and rack identities.');
 return{sample:clone(sample),source:{...clone(sample),id:sourceId,rackId,kind:'sample',audioFileId:identities[0],samplePlaybackMode:sample.samplePlaybackMode||'one-shot',busId:sample.busId||'master',muted:false,solo:false,volume:1},registrationReceipt:clone(data)};
}
async function defaultTools(){const response=await hostFetch('/api/tools');if(!response.ok)throw fail('Read the current Freestyle sample registration schema.');return response.json();}
function schemaFrom(catalog){const tools=catalog?.tools,matches=Array.isArray(tools)?tools.filter(tool=>tool.name==='register_pattern_sample'):[],tool=matches[0],schema=tool?.inputSchema;if(matches.length!==1||schema?.type!=='object'||!record(schema.properties)||schema.additionalProperties!==false||!Array.isArray(schema.required)||schema.required.some(key=>key!=='project_id')||!schema.required.includes('project_id'))throw fail('This connection has no complete register_pattern_sample tool.');for(const key of ['project_id','track_id','name'])if(schema.properties[key]?.type!=='string')throw fail('The sample registration identity/name types are unavailable.');return schema;}
function bounded(value,schema,label){if(typeof value!=='string'||schema.minLength!==undefined&&value.length<schema.minLength||schema.maxLength!==undefined&&Array.from(value).length>schema.maxLength)throw fail(`${label} is outside its published length.`);return value;}
export class CloudPatternSampleRegistration{
 constructor({call,getScope,getTools=defaultTools,createId=()=>crypto.randomUUID()}={}){if(typeof call!=='function'||typeof getScope!=='function')throw new TypeError('Sample registration needs cloud calls and project scope.');Object.assign(this,{call,getScope,getTools,createId});this.records=[];this.active=null;}
 get busy(){return !!this.active;}
 registerClip(clip,{targetPatternId,name,guard=()=>{}}={}){
  let scope,clipId,laneId;try{scope=clone(this.getScope());clipId=clip?.cloudId;laneId=clip?.laneId;if(!id(scope?.projectId)||!id(clipId)||!id(laneId)||clip.cloudRaw?.id!==clipId||clip.cloudRaw?.laneId!==laneId||!id(targetPatternId))throw fail('Select saved audio and a persisted target pattern before registering a sample.');guard();}catch(error){return Promise.reject(error);}
  const intent={scope,clipId,laneId,targetPatternId,...name!==undefined?{name}:{}},prior=this.records.find(entry=>same(entry.intent,intent));if(prior)return prior.promise;if(this.active)return Promise.reject(fail('Wait for the current sample registration.'));
  const entry={intent:clone(intent),fileUploaded:false,status:'preparing',attempted:false,rawReceipt:null,result:null,error:null,attachmentAttempted:false,attachmentConfirmed:false};this.records.push(entry);this.active=entry;
  const check=()=>{guard();if(!same(scope,this.getScope()))throw fail('The project changed. The registered sample, if created, remains in its original project.','pattern_sample_registration_scope_changed');};
  entry.promise=(async()=>{try{const schema=schemaFrom(await this.getTools());check();const args={project_id:bounded(scope.projectId,schema.properties.project_id,'Project identity'),track_id:bounded(clipId,schema.properties.track_id,'Clip identity'),...(name!==undefined?{name:bounded(name,schema.properties.name,'Sample name')}:{})};entry.status='registering';entry.attempted=true;entry.rawReceipt=clone(await this.call('register_pattern_sample',args));entry.result=registeredPatternSample(entry.rawReceipt,scope.projectId,{createId:this.createId});entry.status='registered';check();return{...clone(entry.result),projectId:scope.projectId,targetPatternId,record:entry};}catch(error){entry.error=error;entry.status=entry.attempted?'registration_unconfirmed':'not_sent';throw Object.assign(error,{sampleRegistration:entry});}finally{if(this.active===entry)this.active=null;}})();return entry.promise;
 }
 snapshot(){return this.records.map(entry=>({intent:clone(entry.intent),status:entry.status,attempted:entry.attempted,registrationReceipt:clone(entry.rawReceipt),attachmentAttempted:entry.attachmentAttempted,attachmentConfirmed:entry.attachmentConfirmed,error:entry.error?.message??null}));}
}
