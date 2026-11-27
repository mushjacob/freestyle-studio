/** Local Playlist clipboard plans. Persistence belongs to the caller.
 * Pattern placements share their pattern source; audio copies use documented
 * apply_clip_batch inserts on the source lane, never fabricated local takes.
 */
import {paintedPatternPlacement} from './playlist-stroke.js';
import {assertCompleteCanonicalData,serializeCloudPlacement} from './cloud-session.js';
import {validateClipBatchOps,unwrapClipEditResult,validateClipEditReceipt} from './cloud-range-edits.js';
const clone=value=>structuredClone(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64;
const projectId=project=>project?.cloud?.projectId||project?.id;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Worker IDs may be reallocated between canonical reads. Clipboard operations
// use durable clip/lane IDs; saved source metadata remains an exact guard.
const durableAudio=clip=>{if(!clip||typeof clip!=='object')return clip;const{cloudRuntime,engineClipId,engineTrackId,...rest}=clip;return rest;};
const sameAudio=(a,b)=>same(durableAudio(a),durableAudio(b));
const near=(a,b)=>Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*1e-10;
const clips=project=>[...(project?.clips||[]),...(project?.audioClips||[])];
const timingKeys=['start_ms','duration_sec','audio_offset_sec'];
function sameTiming(actual,expected){return actual&&timingKeys.every(key=>finite(actual[key])&&near(actual[key],expected[key]));}
function acknowledged(raw,expectedProject){const receipt=unwrapClipEditResult(raw);validateClipEditReceipt(receipt,expectedProject);if(receipt.dry_run===true||receipt.applied!==undefined&&receipt.applied!==true||receipt.applied!==true&&receipt.ok!==true)throw new Error('Retain an acknowledged cloud clipboard receipt before publishing its result.');return receipt;}
function patternCounts(entries,project){const counts=new Map();for(const entry of entries){const key=JSON.stringify(serializeCloudPlacement(entry,project));counts.set(key,(counts.get(key)||0)+1);}return counts;}
function assertProject(project){
 if(!id(projectId(project))||!finite(project?.bpm)||project.bpm<=0||!Array.isArray(project?.clips)||!Array.isArray(project?.patterns)||project.audioClips!==undefined&&!Array.isArray(project.audioClips))throw new Error('Open a canonical Freestyle project before using the Playlist clipboard.');
 const entries=clips(project);if(entries.some(clip=>!id(clip?.id))||new Set(entries.map(clip=>clip.id)).size!==entries.length)throw new Error('Reload unambiguous Playlist clip identities before copying.');
}
function validBounds(clip){return finite(clip.start)&&clip.start>=0&&finite(clip.length)&&clip.length>0&&Number.isInteger(clip.track)&&clip.track>=0;}
function audioWindow(clip,project){
 const raw=clip.cloudRaw,spb=60/project.bpm;
 assertCompleteCanonicalData(raw,'copied audio clip');
 if(!id(clip.cloudId)||raw?.id!==clip.cloudId||!id(clip.laneId)||raw.laneId!==clip.laneId||!validBounds(clip)||!finite(raw.startMs)||raw.startMs<0||!finite(raw.durationSec)||raw.durationSec<=0||!near(clip.start*spb*1000,raw.startMs)||!near(clip.length*spb,raw.durationSec))throw new Error('Reload this audio clip’s exact durable identity and timing before copying.');
 const offset=[raw.audioOffsetSec,raw.effects?.timing?.audioOffsetSec].find(value=>finite(value)&&value>=0);
 if(clip.offsetKnown!==true||offset===undefined||!finite(clip.offset)||!near(clip.offset*spb,offset))throw new Error('Reload this audio clip’s exact source offset before copying its window.');
 return{start_ms:raw.startMs,duration_sec:raw.durationSec,audio_offset_sec:offset};
}
function capture(project,selectedIds){
 assertProject(project);const selection=new Set(Array.from(selectedIds||[],String));if(!selection.size)return null;
 const all=clips(project),chosen=all.filter(clip=>selection.has(clip.id));
 if(chosen.length!==selection.size)throw new Error('The Playlist selection changed. Select the clips again before copying.');
 const entries=chosen.map(clip=>{
  if(!validBounds(clip))throw new Error('Reload complete Playlist timing before copying.');
  assertCompleteCanonicalData(clip,'copied Playlist clip');
  if(!clip.patternId){audioWindow(clip,project);return{kind:'audio',clip:clone(clip)};}
  const pattern=project.patterns.find(pattern=>pattern.id===clip.patternId);
  if(!pattern)throw new Error('The copied placement has no current pattern source.');
  paintedPatternPlacement({project,pattern,sourcePlacement:clip,track:clip.track,start:clip.start,id:'clipboard-validation'});
  return{kind:'pattern',clip:clone(clip)};
 });
 return{version:1,projectId:projectId(project),bpm:project.bpm,firstBeat:Math.min(...chosen.map(clip=>clip.start)),lastBeat:Math.max(...chosen.map(clip=>clip.start+clip.length)),firstTrack:Math.min(...chosen.map(clip=>clip.track)),entries};
}
function planBase(project,operation){
 return{operation,projectId:projectId(project),bpm:project.bpm,expected:{clips:clone(project.clips),audioClips:clone(project.audioClips||[])},clips:project.clips,audioClips:project.audioClips||[],created:[],createdIds:[],audioOps:[],inverseAudioOps:[],changed:false};
}

export class PlaylistClipboard{
 constructor({idFactory=()=>globalThis.crypto.randomUUID(),createKey=()=>globalThis.crypto.randomUUID()}={}){this.idFactory=idFactory;this.createKey=createKey;this.value=null;this.reserved=new Set();this.epoch=0;this.cutPlans=new WeakMap();this.pastePlans=new WeakMap();}
 snapshot(){return this.value?clone(this.value):null;}
 clear(){this.value=null;this.activeCut=null;this.epoch++;}
 copy({project,selectedIds}={}){
  const value=capture(project,selectedIds);if(!value)return null;this.value=value;this.activeCut=null;this.epoch++;return this.snapshot();
 }
 cut({project,selectedIds}={}){
  const value=capture(project,selectedIds),plan=planBase(project,'cut');if(!value)return plan;
  const ids=new Set(value.entries.map(entry=>entry.clip.id)),audio=value.entries.filter(entry=>entry.kind==='audio');
  if(!audio.length){this.value=value;this.activeCut=null;this.epoch++;return{...plan,clips:project.clips.filter(clip=>!ids.has(clip.id)),removedIds:[...ids],changed:true};}
  if(audio.length>256)throw new RangeError('Cut at most 256 audio clips in one operation.');
  if(new Set(audio.map(entry=>entry.clip.cloudId)).size!==audio.length)throw new Error('Reload unique durable audio clip identities before cutting.');
  const result={...plan,clips:project.clips.filter(clip=>!ids.has(clip.id)),audioClips:(project.audioClips||[]).filter(clip=>!ids.has(clip.id)),removedIds:[...ids],audioOps:audio.map(entry=>({op:'remove',id:entry.clip.cloudId,expected:audioWindow(entry.clip,project)})),requiresNativeCut:true,changed:true};
  this.cutPlans.set(result,{value,trackId:project.cloud?.trackId,epoch:this.epoch,fingerprint:JSON.stringify(result),inverse:null,requests:null,phase:'planned',clipboard:null});return result;
 }
 cutEntry(plan){const entry=this.cutPlans.get(plan);if(!entry||entry.fingerprint!==JSON.stringify(plan))throw new Error('Use the unchanged audio Cut plan captured from this clipboard.');if(entry.epoch!==this.epoch)throw new Error('The clipboard changed while cutting. Keep its retained Undo receipt and copy again.');return entry;}
 /** Read-only range plans prove archived media restoration BEFORE deletion.
  * Their unrelated overlap edits are never sent as part of the selected Cut. */
 cutReadRequests(plan){
  const entry=this.cutEntry(plan);if(!entry.requests){const keys=new Set();entry.requests=entry.value.entries.filter(item=>item.kind==='audio').map(({clip})=>{const timing=audioWindow(clip,{bpm:entry.value.bpm}),key=this.createKey();if(typeof key!=='string'||!key.length||key.length>128||keys.has(key))throw new Error('Retain a unique audio Cut planning key.');keys.add(key);return{project_id:plan.projectId,...entry.trackId?{track_id:entry.trackId}:{},lane_ids:[clip.laneId],operation:'delete',start_ms:timing.start_ms,end_ms:timing.start_ms+timing.duration_sec*1000,ripple:false,idempotency_key:key,dry_run:true};});}return clone(entry.requests);
 }
 prepareCut(plan,nativeResults){
  const entry=this.cutEntry(plan),results=Array.isArray(nativeResults)?nativeResults:[nativeResults],proof=new Map();
  if(!results.length)throw new Error('Read Freestyle’s native restore plan before deleting audio.');
  for(const raw of results){
   const payload=unwrapClipEditResult(raw);validateClipEditReceipt(payload,plan.projectId);if(payload.projectId!==plan.projectId&&payload.project_id!==plan.projectId||payload.operation!=='delete'||payload.dry_run!==true||payload.applied!==false||payload.ripple!==false||!Array.isArray(payload.ops)||!Array.isArray(payload.inverse_ops))throw new Error('Audio Cut needs an authenticated native delete dry-run with its complete inverse.');
   for(const request of this.cutReadRequests(plan).filter(request=>request.idempotency_key===payload.idempotency_key)){if(!same(payload.lane_ids,request.lane_ids)||!near(payload.start_ms,request.start_ms)||!near(payload.end_ms,request.end_ms))throw new Error('Freestyle returned another audio Cut planning range.');}
   if(!entry.requests.some(request=>request.idempotency_key===payload.idempotency_key))throw new Error('The native Cut inverse belongs to another planning request.');
   if(payload.undo?.inverse_ops!==undefined&&!same(payload.undo.inverse_ops,payload.inverse_ops))throw new Error('Freestyle returned conflicting native Cut inverses.');
   for(const item of entry.value.entries.filter(item=>item.kind==='audio')){
    const target=item.clip.cloudId,forward=payload.ops.filter(op=>op.id===target),inverse=payload.inverse_ops.filter(op=>op.id===target);if(!forward.length&&!inverse.length)continue;
    const before=audioWindow(item.clip,{bpm:entry.value.bpm});if(forward.length!==1||forward[0].op!=='remove'||!sameTiming(forward[0].expected,before)||inverse.length!==1||inverse[0].op!=='restore'||!sameTiming(inverse[0],before))throw new Error('The native Cut plan must remove and exactly restore each selected audio clip.');
    const exact=validateClipBatchOps(inverse,{serverAuthoredInverse:true})[0];if(proof.has(target)&&!same(proof.get(target),exact))throw new Error('Freestyle returned conflicting archived audio identities.');proof.set(target,exact);
   }
  }
  const ids=entry.value.entries.filter(item=>item.kind==='audio').map(item=>item.clip.cloudId);if(ids.some(id=>!proof.has(id)))throw new Error('Read a native restore inverse for every selected audio clip before cutting.');
  entry.inverse=ids.map(id=>proof.get(id));entry.phase='prepared';return{audioOps:clone(plan.audioOps),inverseAudioOps:clone(entry.inverse),serverAuthoredInverse:true};
 }
 confirmCut(plan,{project,receipt}={}){
  const entry=this.cutEntry(plan);if(!entry.inverse)throw new Error('Read the native audio Cut inverse before confirming its deletion.');assertProject(project);if(projectId(project)!==plan.projectId||project.bpm!==plan.bpm)throw new Error('The project or tempo changed while cutting. Retain its Undo receipt.');acknowledged(receipt,plan.projectId);
  for(const item of entry.value.entries){const current=item.kind==='audio'?project.audioClips||[]:project.clips;if(current.some(clip=>clip.id===item.clip.id||clip.cloudId&&clip.cloudId===item.clip.cloudId))throw new Error('Freestyle has not confirmed removal of every cut clip. The clipboard was preserved.');}
  this.value={...clone(entry.value),mode:'cut',nativeRestores:clone(entry.inverse)};this.epoch++;entry.epoch=this.epoch;entry.phase='cut';entry.clipboard=this.value;this.activeCut=entry;return this.snapshot();
 }
 paste({project,at,track}={}){
  assertProject(project);if(!this.value)return planBase(project,'paste');
  if(this.value.mode==='cut')return this.placeCut(project,{at,track});
  return this.place(project,this.value,{at,track,operation:'paste'});
 }
 placeCut(project,{at,track}){
  const value=this.value,cut=this.activeCut;if(!cut||cut.clipboard!==value||cut.epoch!==this.epoch||!cut.inverse)throw new Error('Retain the acknowledged native Cut receipt before restoring archived audio.');if(projectId(project)!==value.projectId||project.bpm!==value.bpm)throw new Error('Restore cut clips only in their original project and tempo.');if(!finite(at)||at<0||track!==undefined&&(!Number.isInteger(track)||track<0))throw new RangeError('Paste needs a valid nonnegative beat and optional destination row.');
  const delta=at-value.firstBeat,trackDelta=track===undefined?0:track-value.firstTrack,created=[],createdIds=[],audioOps=[],inverseAudioOps=[];
  if(trackDelta!==0)throw new Error('Cut audio returns to its source lanes. Move it to another lane after pasting.');
  for(const item of value.entries){if(item.kind==='audio'){if((project.audioClips||[]).some(clip=>clip.cloudId===item.clip.cloudId))throw new Error('A cut audio clip was already restored. Copy its current clip before pasting again.');if(project.cloud?.timelineLaneIds?.[item.clip.track]!==item.clip.laneId)throw new Error('The source lane order changed. Undo Cut before trying again.');}else if(!project.patterns.some(pattern=>pattern.id===item.clip.patternId))throw new Error('A cut pattern source no longer exists. Undo Cut before trying again.');}
  for(const clip of clips(project))for(const reserved of [clip.id,clip.cloudId])if(reserved)this.reserved.add(reserved);
  for(const item of value.entries){
   if(item.kind==='pattern'){const nextId=this.allocate(),pattern=project.patterns.find(pattern=>pattern.id===item.clip.patternId);createdIds.push(nextId);created.push(paintedPatternPlacement({project,pattern,sourcePlacement:item.clip,track:item.clip.track,start:item.clip.start+delta,id:nextId}));}
   else{const native=cut.inverse.filter(op=>op.id===item.clip.cloudId);if(native.length!==1)throw new Error('Retain the exact native Cut inverse before pasting.');const restored={...clone(native[0]),start_ms:(item.clip.start+delta)*60/project.bpm*1000};audioOps.push(restored);inverseAudioOps.push({op:'remove',id:restored.id,expected:Object.fromEntries(timingKeys.map(key=>[key,restored[key]]))});createdIds.push(restored.id);}
  }
  const plan={...planBase(project,'paste'),clips:created.length?[...project.clips,...created]:project.clips,created,createdIds,audioOps:validateClipBatchOps(audioOps,{serverAuthoredInverse:true}),inverseAudioOps:validateClipBatchOps(inverseAudioOps),serverAuthoredOps:true,consumesCut:true,changed:true};this.pastePlans.set(plan,{value,epoch:this.epoch,fingerprint:JSON.stringify(plan)});return plan;
 }
 confirmPaste(plan,{project,receipt}={}){
  const entry=this.pastePlans.get(plan);if(!entry||entry.fingerprint!==JSON.stringify(plan)||entry.epoch!==this.epoch||entry.value!==this.value)throw new Error('The cut clipboard changed before its paste was confirmed.');assertProject(project);if(projectId(project)!==plan.projectId||project.bpm!==plan.bpm)throw new Error('The project changed before cut clips were restored.');acknowledged(receipt,plan.projectId);
  for(const op of plan.audioOps){const current=(project.audioClips||[]).filter(clip=>clip.cloudId===op.id);if(current.length!==1||current[0].laneId!==entry.value.entries.find(item=>item.kind==='audio'&&item.clip.cloudId===op.id).clip.laneId||!sameTiming(audioWindow(current[0],project),op))throw new Error('Freestyle has not confirmed every restored clip’s exact audio window. Reload before another paste.');}
  const actual=patternCounts(project.clips,project),before=patternCounts(plan.expected.clips,project),added=patternCounts(plan.created,project);for(const [key,count]of added)if((actual.get(key)||0)<(before.get(key)||0)+count)throw new Error('Freestyle has not confirmed every restored pattern placement.');
  this.clear();return{consumed:true,message:'Cut clips moved. Copy them to paste more copies.'};
 }
 duplicate({project,selectedIds}={}){
  const value=capture(project,selectedIds);return value?this.place(project,value,{at:value.lastBeat,operation:'duplicate'}):planBase(project,'duplicate');
 }
 allocate(){
  for(let attempt=0;attempt<64;attempt++){const next=this.idFactory();if(id(next)&&!this.reserved.has(next)){this.reserved.add(next);return next;}}
  throw new Error('A pasted Playlist clip needs a fresh identity.');
 }
 place(project,value,{at,track,operation}){
  if(projectId(project)!==value.projectId)throw new Error('This Playlist clipboard belongs to another project. Copy the clips in the current project first.');
  if(project.bpm!==value.bpm)throw new Error('The project tempo changed. Copy the clips again to preserve their exact source windows.');
  if(!finite(at)||at<0||track!==undefined&&(!Number.isInteger(track)||track<0))throw new RangeError('Paste needs a non-negative beat and an optional valid destination row.');
  const delta=at-value.firstBeat,trackDelta=track===undefined?0:track-value.firstTrack,created=[],audioOps=[],inverseAudioOps=[],createdIds=[];
  // Validate the complete selection before making a partial mixed plan.
  for(const entry of value.entries){
   const source=entry.clip,destination=source.track+trackDelta;
   if(destination<0)throw new RangeError('Keep every pasted clip on a valid Playlist row.');
   if(trackDelta!==0&&!id(project.cloud?.timelineLaneIds?.[destination]))throw new Error('Choose existing cloud lanes for every pasted clip.');
   if(entry.kind==='audio'){
    if(trackDelta!==0)throw new Error('Audio copies stay on their source lane. Move the copied clip after pasting.');
    const matches=(project.audioClips||[]).filter(clip=>clip.cloudId===source.cloudId);
    if(matches.length!==1||!sameAudio(matches[0],source))throw new Error('The copied audio source changed or is no longer live. Copy its current window again.');
    audioWindow(matches[0],project);
   }else if(!project.patterns.some(pattern=>pattern.id===source.patternId))throw new Error('The copied pattern source no longer exists in this project.');
  }
  if(value.entries.filter(entry=>entry.kind==='audio').length>256)throw new RangeError('Copy at most 256 audio clips in one operation.');
  for(const clip of [...clips(project),...value.entries.map(entry=>entry.clip)])for(const reserved of [clip.id,clip.cloudId,clip.cloudRaw?.id])if(reserved)this.reserved.add(reserved);
  for(const entry of value.entries){
   const source=entry.clip,nextId=this.allocate(),start=source.start+delta;createdIds.push(nextId);
   if(entry.kind==='pattern'){
    const pattern=project.patterns.find(pattern=>pattern.id===source.patternId);
    created.push(paintedPatternPlacement({project,pattern,sourcePlacement:source,track:source.track+trackDelta,start,id:nextId}));
   }else{
    const timing={...audioWindow(source,project),start_ms:start*60/project.bpm*1000};
    audioOps.push({op:'insert',id:nextId,source_id:source.cloudId,...timing});
    inverseAudioOps.push({op:'remove',id:nextId,expected:timing});
   }
  }
  const plan=planBase(project,operation);
  return{...plan,clips:created.length?[...project.clips,...created]:project.clips,created,createdIds,audioOps:validateClipBatchOps(audioOps,{allowEmpty:true}),inverseAudioOps:validateClipBatchOps(inverseAudioOps,{allowEmpty:true}),changed:createdIds.length>0};
 }
 /** Call after flush and immediately before persistence, along with the
  * caller's load/context fence. A mixed pattern+audio plan is separate cloud
  * writes; this helper does not claim a cross-domain atomic transaction.
  */
 assertCurrent(plan,project){
  assertProject(project);
  if(plan?.projectId!==projectId(project)||plan.bpm!==project.bpm||!same(plan.expected?.clips,project.clips)||!same(plan.expected?.audioClips?.map(durableAudio),(project.audioClips||[]).map(durableAudio)))throw new Error('The Playlist changed before its clipboard operation. Copy or paste again from the accepted state.');
  return true;
 }
}
