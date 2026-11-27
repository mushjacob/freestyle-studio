import {assertCompleteCanonicalData,normalizeCloudProject,storedClipMs,storedClipSeconds} from './cloud-session.js';
import {typedActionCapability} from './cloud-action-contract.js';
const clone=value=>structuredClone(value),object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const omit=(value,keys)=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>!keys.includes(key)));
const stable=value=>Array.isArray(value)?value.map(stable):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const fail=message=>new Error(message);
export const audioGeometryEqual=(a,b)=>['start_ms','duration_sec','audio_offset_sec'].every(key=>finite(a?.[key])&&finite(b?.[key])&&Math.abs(a[key]-b[key])<=Math.max(1,Math.abs(a[key]),Math.abs(b[key]))*1e-12);
export function audioStableMetadata(raw){return omit(raw,['startMs','durationSec','audioOffsetSec','updatedAt','updated_at']);}
// editUrl is a derived link (…/studio/edit/<clipId>), like updatedAt not an edit:
// a receipt-painted clip gains it on the next read.
export function audioHistoryFingerprint(clip){return{...omit(clip,['engineLoaded','engineTrackId','engineClipId','cloudRuntime']),cloudRaw:omit(clip.cloudRaw,['updatedAt','updated_at','editUrl'])};}
export function audioHistorySide(project,clipId){
 const matches=(project.audioClips||[]).filter(clip=>clip.cloudId===clipId);if(matches.length!==1)throw fail('Reload the uniquely identified saved audio clip before using its history.');
 const clip=matches[0],raw=clip.cloudRaw,bpm=project.bpm,offset=[raw?.audioOffsetSec,raw?.effects?.timing?.audioOffsetSec].find(finite);
 if(!identity(clipId)||!identity(clip.laneId)||raw?.id!==clipId||raw.laneId!==clip.laneId||raw.deleted||clip.offsetKnown!==true||!finite(bpm)||bpm<=0||!finite(raw.startMs)||raw.startMs<0||!finite(raw.durationSec)||raw.durationSec<=0||!finite(offset)||offset<0)throw fail('This audio clip needs its exact saved lane, source offset and complete timing before Undo/Redo.');
 assertCompleteCanonicalData(raw,'audio history clip');const geometry={start_ms:raw.startMs,duration_sec:raw.durationSec,audio_offset_sec:offset},view={start_ms:clip.start*60/bpm*1000,duration_sec:clip.length*60/bpm,audio_offset_sec:clip.offset*60/bpm};
 if(!audioGeometryEqual(geometry,view))throw fail('The displayed audio window differs from its complete saved timing.');
 return{clipId,laneId:clip.laneId,geometry,canonical:clone(raw),metadata:clone(audioStableMetadata(raw))};
}
export function captureAudioHistory(before,next){
 const a=before.audioClips||[],b=next.audioClips||[];if(a.length!==b.length||!same(a.map(clip=>clip.cloudId),b.map(clip=>clip.cloudId)))return null;
 let plan=null;for(let index=0;index<a.length;index++){
  const old=a[index],clip=b[index];if(!same(omit(old,['start','length','offset']),omit(clip,['start','length','offset'])))return null;
  if(same([old.start,old.length,old.offset],[clip.start,clip.length,clip.offset]))continue;if(plan)return null;const side=audioHistorySide(before,old.cloudId),spb=60/before.bpm;
  // The session sends (and the server stores) whole ms and 6-decimal seconds.
  const wanted={start_ms:clip.start===old.start?side.geometry.start_ms:storedClipMs(clip.start*spb*1000),duration_sec:clip.length===old.length?side.geometry.duration_sec:Math.max(.001,storedClipSeconds(clip.length*spb)),audio_offset_sec:clip.offset===old.offset?side.geometry.audio_offset_sec:storedClipSeconds(clip.offset*spb)};
  if(!Object.values(wanted).every(finite)||wanted.start_ms<0||wanted.duration_sec<=0||wanted.audio_offset_sec<0)return null;
  plan={kind:'audio',clipId:old.cloudId,laneId:old.laneId,before:side,wanted};
 }return plan;
}
function scalar(value,schema,label){
 if(!object(schema)||schema.readOnly===true)throw fail('Reload the typed '+label+' contract.');
 const allowed=new Set(['type','enum','const','minimum','maximum','exclusiveMinimum','exclusiveMaximum','minLength','maxLength']);for(const key of Object.keys(schema))if(!allowed.has(key)&&!key.startsWith('x-')&&!['description','title','default','examples','$comment'].includes(key))throw fail('Unsupported '+label+' schema constraint '+key+'.');
 if(schema.type==='string'?typeof value!=='string':schema.type==='boolean'?typeof value!=='boolean':schema.type==='number'?!finite(value):schema.type==='integer'?!Number.isInteger(value):true)throw fail(label+' does not match its discovered scalar type.');
 if(own(schema,'const')&&!same(value,schema.const)||own(schema,'enum')&&(!Array.isArray(schema.enum)||!schema.enum.some(item=>same(value,item))))throw fail(label+' is outside its discovered values.');
 for(const key of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum','minLength','maxLength'])if(own(schema,key)&&!finite(schema[key]))throw fail('Invalid '+label+' constraint.');
 if(typeof value==='number'&&(own(schema,'minimum')&&value<schema.minimum||own(schema,'maximum')&&value>schema.maximum||own(schema,'exclusiveMinimum')&&value<=schema.exclusiveMinimum||own(schema,'exclusiveMaximum')&&value>=schema.exclusiveMaximum)||typeof value==='string'&&(own(schema,'minLength')&&value.length<schema.minLength||own(schema,'maxLength')&&value.length>schema.maxLength))throw fail(label+' is outside its discovered range.');return value;
}
export function audioHistoryArguments(result,side){
 const {schema}=typedActionCapability(result,'trim_clip'),fields=schema.properties;
 if(fields.track_id?.type!=='string'||fields.clip_id?.type!=='string')throw fail('Audio history needs the verified durable string lane and clip identity fields.');
 const args={track_id:side.laneId,clip_id:side.clipId,...side.geometry};
 for(const[key,expression]of [['start_ms',/milliseconds/i],['duration_sec',/^seconds$/i],['audio_offset_sec',/seconds.*source/i]])if(!['number','integer'].includes(fields[key]?.type)||!expression.test(fields[key]?.['x-unit']||''))throw fail('Audio history needs the published '+key+' unit before trimming.');
 for(const key of schema.required||[])if(!own(args,key)){if(!own(fields[key],'default'))throw fail('Required trim argument '+key+' has no explicit default.');args[key]=fields[key].default;}
 for(const key of Object.keys(args))args[key]=scalar(args[key],fields[key],'trim_clip.'+key);
 if(own(schema,'minProperties')&&Object.keys(args).length<schema.minProperties||own(schema,'maxProperties')&&Object.keys(args).length>schema.maxProperties)throw fail('The typed trim contract does not accept the full retained timing.');return args;
}
function marked(value){return value===false||value===0||value===''||value==null?false:object(value)||Array.isArray(value)?Object.values(value).some(marked):true;}
function completeCollection(project,key){
 if(!Array.isArray(project[key]))throw fail('Reload the complete saved '+key+' collection.');let global=false,specific=null;for(const[name,value]of Object.entries(project)){const normalized=name.replaceAll('_','').toLowerCase();if(['truncated'+key,key+'truncated'].includes(normalized))specific=specific===true||marked(value);else if(normalized==='truncated'&&object(value)){if(own(value,key))specific=specific===true||marked(value[key]);}else if(['truncated','truncateditems','truncatedkeys','truncatedbytes','truncatedcharacters'].includes(normalized))global=global||marked(value);}if(specific===true||global&&specific!==false)throw fail('Reload the complete saved '+key+' collection.');
 const ids=new Set();for(const row of project[key]){if(!object(row)||!identity(row.id)||ids.has(row.id))throw fail('The saved '+key+' collection has incomplete or duplicate identities.');ids.add(row.id);}return project[key];
}
/** Only clips are projected. Cached complete pattern/placement/live state stays
 * authoritative for those collections; a project summary cannot replace it.
 */
export function projectAudioHistory(engine,body,scope){
 if(['projectId','project_id'].some(key=>own(body,key)&&body[key]!==scope.projectId)||body.id!==scope.projectId||!finite(body.bpm)||body.bpm!==engine.project.bpm)throw fail('The saved project identity or tempo changed before audio history.');
 const clips=completeCollection(body,'clips'),lanes=completeCollection(body,'lanes');for(const clip of clips){assertCompleteCanonicalData(clip,'audio history clip');if(['projectId','project_id'].some(key=>own(clip,key)&&clip[key]!==scope.projectId))throw fail('The saved audio clip belongs to a different project.');if(!identity(clip.laneId)||lanes.filter(lane=>lane.id===clip.laneId).length!==1)throw fail('The saved audio clip has no unique durable lane.');}
 const session=engine.session,rawProject={...session.rawProject,clips:clone(clips)},rawState=session.rawState,project=normalizeCloudProject(rawProject,rawState,{projectId:scope.projectId,trackId:scope.trackId});return{rawProject,rawState,project};
}
