/** Retained server inverses for one dedicated integer-millisecond lane move. */
import {assertCompleteCanonicalData,assertCompletePattern,normalizeCloudProject,storedClipMs} from './cloud-session.js';
import {audioHistorySide,audioHistoryFingerprint} from './cloud-audio-history.js';
import {withoutObservedSavedState} from './cloud-history-observed.js';
const clone=structuredClone,object=v=>!!v&&typeof v==='object'&&!Array.isArray(v),stable=v=>Array.isArray(v)?v.map(stable):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v,same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const omit=(v,keys)=>Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k))),id=v=>typeof v==='string'&&v.length>0&&v.length<=64&&v.trim()===v&&!/[\u0000-\u001f\u007f]/.test(v),integer=v=>Number.isSafeInteger(v)&&v>=0;
const fail=message=>new Error(message);
export function audioMoveSide(project,clipId){const side=audioHistorySide(project,clipId);return{...side,metadata:omit(side.canonical,['laneId','startMs','updatedAt','updated_at'])};}
export const audioMoveEqual=(a,b)=>a?.clipId===b?.clipId&&a?.laneId===b?.laneId&&a?.geometry?.start_ms===b?.geometry?.start_ms&&same(a?.metadata,b?.metadata);
export function audioMoveProtectedProject(project,clipId){const raw=project.cloud?.rawProject;if(!object(raw))throw fail('Read complete saved project data before lane move history.');return{lanes:clone(withoutObservedSavedState(raw).lanes),clips:clone(raw.clips?.filter(c=>c.id!==clipId)),patterns:clone(raw.patterns),placements:clone(raw.placements),bpm:raw.bpm,loop:clone(raw.loop),timingMap:clone(raw.timingMap)};}
export function captureAudioMoveHistory(before,next){
 const a=before.audioClips||[],b=next.audioClips||[];if(a.length!==b.length||!same(a.map(c=>c.cloudId),b.map(c=>c.cloudId)))return null;let plan=null;
 for(let index=0;index<a.length;index++){const old=a[index],clip=b[index];if(same(audioHistoryFingerprint(old),audioHistoryFingerprint(clip)))continue;
  if(plan||!same(omit(audioHistoryFingerprint(old),['laneId','track','start']),omit(audioHistoryFingerprint(clip),['laneId','track','start'])))return null;
  const beforeSide=audioMoveSide(before,old.cloudId),laneId=clip.track!==old.track?next.cloud?.timelineLaneIds?.[clip.track]:clip.laneId,startMs=clip.start===old.start?beforeSide.geometry.start_ms:storedClipMs(clip.start*60/before.bpm*1000)/* QA r6: stored whole ms */;
  if(!id(laneId)||laneId===old.laneId||!integer(startMs)||!(clip.start>=0)||!integer(beforeSide.geometry.start_ms))return null;
  const lanes=before.cloud?.rawProject?.lanes,matches=Array.isArray(lanes)?lanes.filter(l=>l.id===laneId):[];if(matches.length!==1||!['audio','vocal'].includes(matches[0].kind))return null;
  plan={kind:'audio_move',clipId:old.cloudId,protected:audioMoveProtectedProject(before,old.cloudId),before:beforeSide,wanted:{...clone(beforeSide),laneId,geometry:{...beforeSide.geometry,start_ms:startMs}}};
 }return plan;
}
export function audioMoveInverse(receipt,before,after,{projectId,operationId}={}){
 assertCompleteCanonicalData(receipt,'audio move receipt');
 if(operationId!=='moveClipToLane'||!object(receipt)||receipt.ok===false||receipt.error||receipt.projectId!==projectId||typeof receipt.engine_moved!=='boolean'||typeof receipt.engine_reload_required!=='boolean')throw fail('Only an acknowledged dedicated lane move with a server inverse can enter audio move history.');
 const inverse=receipt.undo,clip=receipt.clip;
 if(!object(inverse)||inverse.op!=='move'||inverse.clip_id!==before.clipId||inverse.lane_id!==before.laneId||inverse.start_ms!==before.geometry.start_ms||!integer(inverse.start_ms)||!object(clip)||clip.id!==after.clipId||clip.laneId!==after.laneId||clip.startMs!==after.geometry.start_ms)throw fail('The lane move inverse or returned clip does not match its exact saved before/after state.');
 return clone(inverse);
}
export function audioMoveArguments(inverse,expected){
 if(!object(inverse)||inverse.op!=='move'||inverse.clip_id!==expected.clipId||!id(inverse.lane_id)||!integer(inverse.start_ms)||!id(expected.laneId)||!integer(expected.geometry.start_ms))throw fail('Reload the exact retained integer lane move inverse before Undo/Redo.');
 return{clip_id:inverse.clip_id,lane_id:inverse.lane_id,start_ms:inverse.start_ms,expected:{lane_id:expected.laneId,start_ms:expected.geometry.start_ms}};
}
export function audioMoveTimelineTag(project){const revision=project?.timelineRevision;if(typeof revision==='string'&&revision&&revision.length<=256&&!/[\r\n]/.test(revision)||Number.isSafeInteger(revision)&&revision>=0)return JSON.stringify(revision);throw fail('Read a fresh timeline revision before replaying a retained lane move.');}
export function projectAudioMoveHistory(engine,body,scope){
 /* a new project saves bpm:null and plays at 120 (cloud-session normalizes the same way) */if(body?.id!==scope.projectId||(body.bpm??120)!==engine.project.bpm)throw fail('The saved project identity or tempo changed before lane move history.');
 for(const key of ['clips','lanes','patterns','placements']){if(!Array.isArray(body[key])||body.truncated?.[key]===true||body[key+'Truncated']===true)throw fail('Read complete canonical '+key+' before lane move history.');assertCompleteCanonicalData(body[key],'lane move '+key);const ids=new Set();for(const row of body[key]){if(!id(row?.id)||ids.has(row.id))throw fail('The canonical '+key+' identities are ambiguous.');ids.add(row.id);}}
 body.patterns.forEach(assertCompletePattern);for(const clip of body.clips)if(!id(clip.laneId)||body.lanes.filter(l=>l.id===clip.laneId).length!==1)throw fail('The saved clip has no unique project lane.');audioMoveTimelineTag(body);
 const rawProject=clone(body),rawState={...engine.session.rawState,project:rawProject,patterns:{ok:true,patterns:rawProject.patterns},patternPlacements:{ok:true,placements:rawProject.placements},persistedLanes:rawProject.lanes};
 // Saved refresh cannot certify cached numeric bindings or meters as current.
 if(rawState.studioApi===true){rawState.nativeMixerStateAvailable=false;rawState.tracks={ok:true,tracks:[],live:false,runtime_ids_available:false};rawState.clips={ok:true,clips:rawProject.clips,live:false};rawState.buses={ok:false,buses:[],live:false};delete rawState.mix;}
 const project=normalizeCloudProject(rawProject,rawState,{projectId:scope.projectId,trackId:scope.trackId});return{rawProject,rawState,project};
}
