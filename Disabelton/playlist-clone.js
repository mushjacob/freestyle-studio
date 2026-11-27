/** Playlist Shift-drag cloning. Plans are local; saved writes are explicit,
 * sequential transactions with independent canonical confirmation. The user's
 * clipboard is never consulted or changed. No engine-history fallback/retries.
 */
import {PlaylistClipboard} from './playlist-clipboard.js';
import {paintedPatternPlacement} from './playlist-stroke.js';
import {serializeCloudPlacement,assertCompleteCanonicalData,normalizeCloudProject,storedClipMs} from './cloud-session.js';
import {placementCreationBody,placementPhaseWritable,placementHistorySide,placementHistoryAlias,rebindPlacementHistorySide,placementReceiptId,projectPlacementHistory} from './cloud-placement-history.js';
import {audioHistorySide} from './cloud-audio-history.js';
import {redactPlacementRestoreSecrets} from './cloud-placement-restore.js';
const clone=structuredClone,record=v=>!!v&&typeof v==='object'&&!Array.isArray(v),finite=v=>typeof v==='number'&&Number.isFinite(v),id=v=>typeof v==='string'&&v.length>0&&v.length<=64&&v.trim()===v;
const stable=v=>Array.isArray(v)?v.map(stable):record(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const exactIntegerMs=value=>{const nearest=Math.round(value);return Math.abs(value-nearest)<=Number.EPSILON*Math.max(1,Math.abs(value))*8?nearest:value;};
const omit=(v,keys)=>Object.fromEntries(Object.entries(v||{}).filter(([k])=>!keys.includes(k)));
const volatile=new Set(['updatedAt','updated_at']);
function canonical(v){return Array.isArray(v)?v.map(canonical):record(v)?Object.fromEntries(Object.entries(v).filter(([k])=>!volatile.has(k)).map(([k,x])=>[k,canonical(x)])):v;}
function durable(v){return canonical(omit(v,['cloudRuntime','engineTrackId','engineClipId','engineLoaded']));}
const all=project=>[...project.clips,...(project.audioClips||[])];
const fault=(message,code='playlist_clone_conflict')=>Object.assign(new Error(message),{code});
function rawProject(project){const raw=project.cloud?.rawProject;if(!record(raw)||raw._truncated===true||raw.truncated===true)throw fault('Read the complete saved project before cloning Playlist clips.');if(raw.counts!==undefined){if(!record(raw.counts))throw fault('Read canonical project collection counts before cloning.');for(const key of ['lanes','clips','patterns','placements'])if(Object.hasOwn(raw.counts,key)&&(!Number.isSafeInteger(raw.counts[key])||raw.counts[key]<0||!Array.isArray(raw[key])||raw.counts[key]!==raw[key].length))throw fault('The saved '+key+' count is inconsistent with its complete canonical collection.');}for(const key of ['lanes','clips','patterns','placements']){if(!Array.isArray(raw[key])||raw.truncated?.[key]===true)throw fault('Read complete saved '+key+' before cloning.');assertCompleteCanonicalData(raw[key],'Playlist clone '+key);const ids=raw[key].map(row=>row.id);if(ids.some(value=>!id(value))||new Set(ids).size!==ids.length)throw fault('Reload unique saved '+key+' identities.');}return raw;}
export function playlistCloneCheckpoint(project,{excludeAudio=[],excludePlacements=[]}={}){const raw=rawProject(project),audio=new Set(excludeAudio),placements=new Set(excludePlacements);const clips=raw.clips.filter(c=>!audio.has(c.id)),copies=raw.placements.filter(c=>!placements.has(c.id)),counts=raw.counts===undefined?null:{...clone(raw.counts),...Object.hasOwn(raw.counts,'clips')?{clips:clips.length}:{},...Object.hasOwn(raw.counts,'placements')?{placements:copies.length}:{}};return canonical({...omit(raw,['_studioApi','timelineRevision','updatedAt','updated_at']),...counts?{counts}:{},clips,placements:copies});}
function sourceEqual(a,b){return same(durable(a),durable(b));}
function lane(project,track,audio=false){const laneId=project.cloud?.timelineLaneIds?.[track],matches=rawProject(project).lanes.filter(l=>l.id===laneId);if(!id(laneId)||matches.length!==1||audio&&!['audio','vocal','guitar'].includes(matches[0].kind))throw fault('Choose an existing '+(audio?'audio ':'')+'Playlist lane for every cloned clip.');return laneId;}
export function planPlaylistClone({project,sourceIds,sourceClips,deltaBeats=0,deltaTracks=0,phaseWritable=false,idFactory=()=>globalThis.crypto.randomUUID()}={}){
 if(!finite(deltaBeats)||!Number.isInteger(deltaTracks)||!Array.isArray(sourceIds)||!sourceIds.length||sourceIds.length>256||new Set(sourceIds).size!==sourceIds.length)throw fault('Clone a bounded, uniquely selected group at a valid Playlist position.');rawProject(project);
 const sources=sourceIds.map(sourceId=>{const matches=all(project).filter(c=>c.id===sourceId);if(matches.length!==1)throw fault('The source Playlist clips changed before cloning.');return matches[0];});
 if(sourceClips&&(!Array.isArray(sourceClips)||sourceClips.length!==sources.length||sources.some(c=>{const rows=sourceClips.filter(x=>x.id===c.id);return rows.length!==1||!sourceEqual(rows[0],c);})))throw fault('The captured clone source changed before release.');
 const clipboard=new PlaylistClipboard({idFactory});const snapshot=clipboard.copy({project,selectedIds:sourceIds}),base=clipboard.paste({project,at:snapshot.firstBeat+deltaBeats}),patterns=[],audio=[],patternSources=new Map(snapshot.entries.filter(entry=>entry.kind==='pattern').map((entry,index)=>[entry.clip.id,base.created[index]]));
 for(const source of sources){const track=source.track+deltaTracks,start=source.start+deltaBeats;if(track<0||!finite(start)||start<0)throw fault('Keep every cloned clip inside the Playlist.');const laneId=lane(project,track,!source.patternId);
  if(source.patternId){placementCreationBody(placementHistorySide(project,source.cloudId),{phaseWritable});const created=patternSources.get(source.id);if(!created)throw fault('The copied pattern source is ambiguous.');const intent=paintedPatternPlacement({project,pattern:project.patterns.find(p=>p.id===source.patternId),sourcePlacement:source,track,start,id:created.id});const raw=serializeCloudPlacement(intent,project);if(raw.laneId!==laneId)throw fault('The cloned placement destination lane was not confirmed.');raw.startMs=exactIntegerMs(raw.startMs);const body=placementCreationBody(raw,{intent:true,phaseWritable});patterns.push({sourceId:source.id,localId:created.id,body});}
  else{const op=base.audioOps.find(op=>op.source_id===source.cloudId);if(!op)throw fault('Read this audio clip’s exact source window before cloning.');/* QA r4/r5: insert and move_clip_to_lane both store whole ms. Round EVERY copy (same-lane too) at this one
   boundary, so insert, move and the confirming read all use the stored value (r5: a same-lane ⌥-copy at a
   fractional pixel saved at 10487 ms and then failed a strict compare against 10487.25). */op.start_ms=storedClipMs(op.start_ms);if(!Number.isSafeInteger(op.start_ms)||op.start_ms<0)throw fault('Audio cloning needs a whole-millisecond destination inside the Arrangement.');audio.push({sourceId:source.id,source:clone(source),op:clone(op),laneId});}
 }
 return{kind:'playlist_clone',phaseWritable,projectId:project.cloud?.projectId||project.id,bpm:project.bpm,sourceIds:clone(sourceIds),sourceClips:clone(sources),deltaBeats,deltaTracks,patterns,audio,before:playlistCloneCheckpoint(project)};
}
function etag(project){const raw=rawProject(project),tag=raw._studioApi?.etag??(raw.timelineRevision!==undefined?JSON.stringify(raw.timelineRevision):null);if(typeof tag!=='string'||!tag||/[\r\n]/.test(tag))throw fault('Read a fresh timeline revision before saving a Playlist clone.');return tag;}
function body(result){let value=result?.structuredContent??result;for(let n=0;n<8;n++){if(!record(value)||value.ok===false||value.error||result?.isError)throw fault('Freestyle did not acknowledge the Playlist clone operation.');if(!record(value.response))return value;value=value.response;}throw fault('The clone acknowledgement is not complete.');}
// ClipBatchOp declares seconds as numbers. Production insert/readback has also
// returned the nearest six-decimal duration for an imported full-source copy.
// Accept only that exact representation, not a generic timing tolerance; onset,
// source offset and every non-navigation source/mix setting stay exact.
export const AUDIO_CLONE_DURATION_DECIMALS=6;
function confirmedCopyDuration(actual,item){
 const wanted=item.op.duration_sec,source=item.source.cloudRaw?.durationSec;
 if(actual===wanted)return true;
 if(!finite(actual)||actual<=0||!finite(wanted)||wanted<=0||wanted!==source)return false;
 const rounded=Number(wanted.toFixed(AUDIO_CLONE_DURATION_DECIMALS));
 const binaryRoundoff=Math.min(Number.EPSILON*Math.max(1,Math.abs(wanted))*2,1e-12);
 return rounded>0&&actual===rounded&&Math.abs(actual-wanted)<=.5*10**-AUDIO_CLONE_DURATION_DECIMALS+binaryRoundoff;
}
function editNavigation(raw){
 const value=raw?.editUrl;if(typeof value!=='string')return value;
 try{const url=new URL(value),parts=url.pathname.split('/');if(url.origin==='https://freestyle.audio'&&!url.username&&!url.password&&!url.search&&!url.hash&&parts.length===5&&/^[A-Za-z0-9_-]{1,128}$/.test(parts[1])&&parts[2]==='studio'&&parts[3]==='edit'&&parts[4]===encodeURIComponent(raw.id))return`https://freestyle.audio/${parts[1]}/studio/edit/:clip`; }catch{}
 return value;
}
const audioSettings=raw=>canonical({...omit(raw,['id','laneId','startMs','durationSec','audioOffsetSec','createdAt','created_at','updatedAt','updated_at','isImported']),...Object.hasOwn(raw||{},'editUrl')?{editUrl:editNavigation(raw)}:{}});
function rebindAudioRaw(raw,alias){if(raw?.id!==alias.fromId||alias.before?.id!==alias.fromId||alias.after?.id!==alias.toId||!same(audioSettings(raw),audioSettings(alias.before))||!same(audioSettings(alias.before),audioSettings(alias.after)))throw fault('The audio alias does not belong to this retained source.');const next={...clone(raw),id:alias.toId};for(const key of ['createdAt','created_at','editUrl']){if(Object.hasOwn(alias.after,key))next[key]=clone(alias.after[key]);else delete next[key];}return next;}
export function rebindPlaylistCloneAudioSide(side,alias){if(!side||side.clipId!==alias.fromId)throw fault('Use the matching retained audio clone side.');const next=clone(side);next.clipId=alias.toId;next.canonical=rebindAudioRaw(next.canonical,alias);next.metadata={...next.metadata,id:alias.toId};for(const key of ['createdAt','created_at','editUrl']){if(Object.hasOwn(alias.after,key))next.metadata[key]=clone(alias.after[key]);else delete next.metadata[key];}return next;}

function rebindCheckpoint(checkpoint,alias,scope){
 if(!checkpoint)return checkpoint;const next=clone(checkpoint);
 if(alias.kind==='audio')next.clips=next.clips.map(raw=>raw.id===alias.fromId?canonical(rebindAudioRaw(raw,alias)):raw);
 else{const from=alias.proof.fromId,match=next.placements.find(raw=>raw.id===from);if(match){const project=normalizeCloudProject(next,{studioApi:true},{projectId:scope.projectId,trackId:scope.trackId}),side=placementHistorySide(project,from),raw=canonical(rebindPlacementHistorySide(side,alias.proof,{phaseWritable:alias.phaseWritable===true}).canonical);next.placements=next.placements.map(item=>item.id===from?raw:item);}}
 return next;
}
// The next guarded write may use the revision its predecessor returned. No
// usable revision means one fresh saved read first, never a guessed tag.
function returnedTag(result){const usable=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\r\n]/.test(value)||Number.isSafeInteger(value)&&value>=0;let value=result?.structuredContent??result;for(let n=0;n<8&&record(value);n++){if(usable(value.timelineRevision))return JSON.stringify(value.timelineRevision);value=value.response;}return null;}
const newRecord=()=>({status:'idle',scope:null,plan:null,before:null,after:null,ownedAudio:[],ownedPatterns:[],receipts:[],attempted:false,error:null,aliases:[]});
export class PlaylistCloneController{
 constructor({getProject,getScope,read,flush=async()=>{},call,action,createId=()=>globalThis.crypto.randomUUID(),onChange=()=>{},phaseWritable=false}={}){if(![getProject,getScope,read,flush,call,action,createId,onChange].every(fn=>typeof fn==='function'))throw TypeError('Playlist cloning needs scoped saved-read/action callbacks.');if(typeof phaseWritable!=='boolean')throw TypeError('Playlist phase writing needs an explicit capability policy.');Object.assign(this,{getProject,getScope,read,flush,call,action,createId,onChange,phaseWritable});this.state=newRecord();this.busy=false;this.reserved=new Set();}
 snapshot(){return clone({...this.state,busy:this.busy});}
 notify(){try{this.onChange(this.snapshot());}catch{}}
 assert(){if(!same(this.state.scope,this.getScope()))throw fault('The Playlist project or engine context changed during cloning.','playlist_clone_scope_changed');}
 nextId(){for(let i=0;i<64;i++){const value=this.createId();if(id(value)&&!this.reserved.has(value)){this.reserved.add(value);return value;}}throw fault('Every cloned audio clip needs a fresh unused identity.');}
 // read() may return the saved project it adopted: while the history shows an instant Undo preview the
 // app's model is that preview, so guards must compare against the saved read, not getProject().
 async fresh(){this.assert();this.revisionTag=undefined;this.readFresh=false;this.saved=null;const saved=await this.read();this.assert();this.saved=record(saved)&&Array.isArray(saved.clips)?saved:null;this.readFresh=true;return this.saved??this.getProject();}
 savedProject(){return this.readFresh&&this.saved?this.saved:this.getProject();}
 guardProtected(project,{changingAudio=[],removedAudio=[],removedPatterns=[]}={}){
  if(!same(playlistCloneCheckpoint(project,{excludeAudio:this.state.ownedAudio.map(c=>c.id),excludePlacements:this.state.ownedPatterns.map(c=>c.id)}),this.state.before))throw fault('Unrelated saved project data changed while cloning. Inspect the retained operation before another edit.');
  for(const item of this.state.ownedAudio){const current=(project.audioClips||[]).filter(c=>c.cloudId===item.id);if(removedAudio.includes(item.id)){if(current.length)throw fault('The owned audio copy removal was not confirmed.');continue;}if(!item.canonical||changingAudio.includes(item.id))continue;if(current.length!==1||!same(canonical(current[0].cloudRaw),canonical(item.canonical)))throw fault('A previously confirmed audio copy changed during the clone operation. Inspect its retained state.');}
  for(const item of this.state.ownedPatterns){const current=project.clips.filter(c=>c.cloudId===item.id);if(removedPatterns.includes(item.id)){if(current.length)throw fault('The owned placement removal was not confirmed.');continue;}if(!item.side)continue;if(current.length!==1||!same(canonical(current[0].cloudRaw),canonical(item.side.canonical)))throw fault('A previously confirmed pattern copy changed during the clone operation. Inspect its retained state.');}
 }
 async send(kind,name,args){this.assert();if(this.revisionTag===null)await this.fresh();const headers={ifMatch:this.revisionTag??etag(this.savedProject()),idempotencyKey:this.nextId()},entry={kind,name,args:clone(args),...headers,status:'sending'};this.readFresh=false;this.state.receipts.push(entry);this.state.attempted=true;this.notify();try{this.revisionTag=null;const result=kind==='batch'?await this.call('apply_clip_batch',{project_id:this.state.plan.projectId,...this.state.scope.trackId?{track_id:this.state.scope.trackId}:{},ops:args},headers):await this.action(name,args,{...headers,refresh:false,confirmedDestructive:name==='delete_pattern_placement',...(name==='delete_pattern_placement'?{retainDeleteUndo:false}:{})});this.assert();this.revisionTag=returnedTag(result);entry.result=redactPlacementRestoreSecrets(result);entry.status='acknowledged';const receipt=body(result);if(['projectId','project_id'].some(key=>receipt[key]!==undefined&&receipt[key]!==this.state.plan.projectId)||kind==='batch'&&(receipt.dry_run===true||receipt.applied!==true&&receipt.ok!==true||receipt.applied===false))throw fault('Freestyle did not acknowledge this project’s applied clone operation.');return result;}catch(error){const safe=redactPlacementRestoreSecrets(error),clean=Object.assign(new Error(safe.message||'The Playlist clone operation was not confirmed.'),safe);entry.status='unconfirmed';entry.error=clean.message;throw clean;}}
 async create(options){if(this.busy||!['idle','undone'].includes(this.state.status))throw fault('Inspect or finish the retained clone before starting another one.');const previous=this.state,scope=clone(this.getScope());if(options.sourceScope&&!same(options.sourceScope,scope))throw fault('The clone gesture belongs to an earlier Playlist context.');const current=this.savedProject(),phaseWritable=this.phaseWritable&&current.cloud?.rawState?.studioApi===true&&placementPhaseWritable('createPatternPlacement'),plan=planPlaylistClone({...options,phaseWritable,project:current,idFactory:()=>this.nextId()});
  // Redo of a reconciled copy recreates the window Freestyle actually saved (and Undo removed).
  if(previous.status==='undone')for(const item of plan.audio){const old=previous.plan?.audio?.find(a=>a.reconciled&&a.sourceId===item.sourceId);if(old){Object.assign(item.op,{start_ms:old.op.start_ms,duration_sec:old.op.duration_sec,audio_offset_sec:old.op.audio_offset_sec});item.reconciled=true;}}
  this.state={...newRecord(),scope,plan,receipts:previous.receipts};this.busy=true;this.state.status='reading';this.notify();
  try{await this.flush();let project=await this.fresh();if(!same(playlistCloneCheckpoint(project),plan.before)||plan.sourceClips.some(c=>{const current=all(project).find(x=>x.id===c.id);return!current||!sourceEqual(current,c);} ))throw fault('The saved clone source changed before dispatch.');this.state.before=playlistCloneCheckpoint(project);
   const initial=new Set(rawProject(project).placements.map(p=>p.id));
   if(plan.audio.length){await this.send('batch','insert',plan.audio.map(c=>c.op));for(const item of plan.audio)this.state.ownedAudio.push({id:item.op.id,sourceId:item.sourceId,laneId:item.source.laneId,canonical:null});
    // Inserted copies start on their source lane; the server guards expected.
    for(const item of plan.audio.filter(item=>item.laneId!==item.source.laneId)){const startMs=item.op.start_ms;await this.send('action','move_clip_to_lane',{clip_id:item.op.id,lane_id:item.laneId,start_ms:startMs,expected:{lane_id:item.source.laneId,start_ms:startMs}});}
   }
   for(const item of plan.patterns){const result=await this.send('action','create_pattern_placement',{placement:item.body}),savedId=placementReceiptId(result,{projectId:plan.projectId,operationId:'createPatternPlacement'});if(initial.has(savedId)||this.state.ownedPatterns.some(c=>c.id===savedId))throw fault('Freestyle did not return a fresh cloned placement identity.');this.state.ownedPatterns.push({id:savedId,sourceId:item.sourceId,body:item.body,side:null});}
   // One complete saved read independently confirms every acknowledged copy.
   project=await this.fresh();for(const item of plan.audio)this.confirmAudio(item,project,item.laneId);
   for(const [index,item]of plan.patterns.entries()){const owned=this.state.ownedPatterns[index],side=placementHistorySide(project,owned.id);if(!same(placementCreationBody(side,{phaseWritable:plan.phaseWritable}),item.body))throw fault('The copied pattern placement did not preserve its exact source window and routing.');owned.side=side;}
   // QA r14: every write was acknowledged and every copy is independently confirmed above, so this clone's
   // effect is exactly known. Unrelated saved data that moved meanwhile is not ours to undo: rebase the
   // protected checkpoint onto it (recorded in state.rebased) instead of leaving N unaccounted copies as an
   // "uncertain" clone that ⌘Z cannot remove. Undo still removes only the owned copies and then requires
   // the rest of the project to equal this rebased checkpoint.
   const unowned=playlistCloneCheckpoint(project,{excludeAudio:this.state.ownedAudio.map(c=>c.id),excludePlacements:this.state.ownedPatterns.map(c=>c.id)});
   if(!same(unowned,this.state.before)){const before=this.state.before||{},keys=[...new Set([...Object.keys(before),...Object.keys(unowned)])].filter(key=>!same(before[key],unowned[key]));this.state.rebased={keys};this.state.before=unowned;}
   this.guardProtected(project);this.state.after=playlistCloneCheckpoint(project);this.state.status='committed';if(previous.status==='undone'){const aliases=[];for(let i=0;i<previous.ownedPatterns.length;i++)aliases.push({kind:'placement',proof:placementHistoryAlias(previous.ownedPatterns[i].side,this.state.ownedPatterns[i].side,{phaseWritable:plan.phaseWritable}),phaseWritable:plan.phaseWritable});for(let i=0;i<previous.ownedAudio.length;i++){const old=previous.ownedAudio[i],next=this.state.ownedAudio[i];if(!same(audioSettings(old.canonical),audioSettings(next.canonical)))throw fault('The recreated audio copy has different source settings.');aliases.push({kind:'audio',fromId:old.id,toId:next.id,before:old.canonical,after:next.canonical});}this.historyAliases=aliases;this.state.aliases=aliases.map(alias=>({kind:alias.kind,fromId:alias.kind==='placement'?alias.proof.fromId:alias.fromId,toId:alias.kind==='placement'?alias.proof.toId:alias.toId}));}return this.snapshot();
  }catch(error){this.state.status=this.state.attempted?'uncertain':'not_sent';this.state.error=error.message;throw Object.assign(error,{playlistCloneReceipt:this.snapshot(),operationUncertain:this.state.attempted});}finally{this.busy=false;this.readFresh=false;this.notify();}
 }
 // Compares in stored precision (whole ms onset). The copy's identity is ours (fresh id, acknowledged insert),
 // so a saved copy on the right lane with the source's exact settings is adopted from the read even when the
 // server stored a different window (QA r5: a saved copy must never leave history blocked). Its retained op
 // then carries the saved window, so Redo recreates exactly what Undo removed.
 confirmAudio(item,project,laneId){const matches=(project.audioClips||[]).filter(c=>c.cloudId===item.op.id);if(matches.length!==1)throw fault('The saved audio copy was not independently confirmed.');const side=audioHistorySide(project,item.op.id),raw=side.canonical;if(side.laneId!==laneId||!same(audioSettings(raw),audioSettings(item.source.cloudRaw)))throw fault('The saved audio copy has unconfirmed timing, source settings or routing. Inspect it before another clone.');
  const exact=side.geometry.start_ms===storedClipMs(item.op.start_ms)&&confirmedCopyDuration(side.geometry.duration_sec,item)&&side.geometry.audio_offset_sec===item.op.audio_offset_sec;
  if(!exact){Object.assign(item.op,{start_ms:side.geometry.start_ms,duration_sec:side.geometry.duration_sec,audio_offset_sec:side.geometry.audio_offset_sec});item.reconciled=true;this.state.reconciled=true;}
  Object.assign(this.state.ownedAudio.find(c=>c.id===item.op.id),{laneId,canonical:clone(raw)});}
 async undo(){if(this.busy||this.state.status!=='committed')throw fault('Only a fully confirmed owned clone can be undone.');this.busy=true;this.state.status='undoing';this.notify();const receiptsBefore=this.state.receipts.length;try{
  // The history has just read the saved project (its precondition); reuse it instead of a second read.
  // Each write is If-Match guarded with the revision its predecessor returned, and one saved read at the
  // end confirms the whole Undo (the UI already shows it through the history preview).
  let project=this.readFresh?this.savedProject():await this.fresh();const removedPatterns=this.state.ownedPatterns.map(item=>item.id),removedAudio=this.state.ownedAudio.map(item=>item.id);if(!same(playlistCloneCheckpoint(project),this.state.after))throw fault('The saved project changed after this clone. Undo newer edits before its copies.');
  const audioOps=this.state.ownedAudio.map(item=>({op:'remove',id:item.id,expected:audioHistorySide(project,item.id).geometry}));
  for(const item of [...this.state.ownedPatterns].reverse())await this.send('action','delete_pattern_placement',{placement_id:item.id});
  if(audioOps.length)await this.send('batch','remove',audioOps);
  project=await this.fresh();if(project.clips.some(c=>removedPatterns.includes(c.cloudId)))throw fault('The owned cloned placement deletion was not confirmed.');if(this.state.ownedAudio.some(item=>(project.audioClips||[]).some(c=>c.cloudId===item.id)))throw fault('The owned audio-copy removal was not confirmed.');this.guardProtected(project,{removedPatterns,removedAudio});if(!same(playlistCloneCheckpoint(project),this.state.before))throw fault('Clone Undo did not restore its exact protected project checkpoint.');this.state.status='undone';return this.snapshot();}catch(error){
  // A definite refusal of the first write (nothing of this Undo was applied) keeps the clone committed and
  // the history usable; the history re-renders the confirmed model (visible rollback). Anything else is uncertain.
  const sent=this.state.receipts.slice(receiptsBefore),status=Number(error?.status??error?.httpStatus),refused=sent.length===1&&sent[0].status==='unconfirmed'&&(status>=400&&status<500||/conflict|precondition|refus|mismatch/i.test(String(error?.code||'')));
  if(refused){this.state.status='committed';this.state.error=error.message;const message=/^Not saved/.test(error.message||'')?error.message:`Not saved: Freestyle refused the clone Undo (${error.message}). The copies stay; Undo again to retry.`;throw Object.assign(error,{message,historyTransient:true,playlistCloneReceipt:this.snapshot(),operationUncertain:false});}
  this.state.status='uncertain';this.state.error=error.message;throw Object.assign(error,{playlistCloneReceipt:this.snapshot(),operationUncertain:true});}finally{this.busy=false;this.readFresh=false;this.notify();}}
 rebindAliases(aliases){
  if(!this.state.plan)return;
  for(const alias of aliases||[]){
   const state=this.state,from=alias.kind==='placement'?alias.proof.fromId:alias.fromId,to=alias.kind==='placement'?alias.proof.toId:alias.toId;
   const checkpoint=rebindCheckpoint(state.plan.before,alias,state.scope),model=normalizeCloudProject(checkpoint,{studioApi:true},{projectId:state.scope.projectId,trackId:state.scope.trackId}),ids=new Map();
   state.plan.sourceClips=state.plan.sourceClips.map(source=>{if(source.cloudId!==from)return source;const current=all(model).find(item=>item.cloudId===to);if(!current)throw fault('The cloned-source alias was not confirmed in its retained project.');ids.set(source.id,current.id);return clone(current);});
   state.plan.sourceIds=state.plan.sourceIds.map(id=>ids.get(id)??id);state.plan.before=checkpoint;
   for(const item of state.plan.patterns)item.sourceId=ids.get(item.sourceId)??item.sourceId;
   for(const item of state.plan.audio){item.sourceId=ids.get(item.sourceId)??item.sourceId;if(item.source.cloudId===from){item.source=clone(state.plan.sourceClips.find(source=>source.id===item.sourceId));item.op.source_id=to;}}
   state.before=rebindCheckpoint(state.before,alias,state.scope);state.after=rebindCheckpoint(state.after,alias,state.scope);
   for(const item of [...state.ownedAudio,...state.ownedPatterns])item.sourceId=ids.get(item.sourceId)??item.sourceId;
   if(alias.kind==='placement')for(const item of state.ownedPatterns)if(item.id===from){item.side=rebindPlacementHistorySide(item.side,alias.proof,{phaseWritable:alias.phaseWritable===true});item.id=to;}
  }
 }
 async redo(){if(this.busy||this.state.status!=='undone')throw fault('Only a confirmed clone Undo can be redone.');if(!this.readFresh)await this.fresh();if(!same(playlistCloneCheckpoint(this.savedProject()),this.state.before))throw fault('The project changed after clone Undo. Its copies will not be recreated over newer edits.');return this.create({...this.state.plan,sourceScope:this.state.scope});}
}
/**
 * Instant clone Undo/Redo (Live / FL): the retained clone's owned copies leave (Undo) or return (Redo) in a
 * presentation-only raw project at once, from the clone receipt's ids and confirmed rows. Saving stays
 * guarded in the background; a refusal re-renders Freestyle's confirmed model (the history's visible rollback).
 * Mutates `raw`; returns true when it applies.
 */
export function playlistClonePreviewRaw(controller,direction,raw){
 const state=controller?.state;if(!state||!record(raw)||!Array.isArray(raw.placements)||!Array.isArray(raw.clips))return false;
 const patterns=new Set(state.ownedPatterns.map(item=>item.id)),audio=new Set(state.ownedAudio.map(item=>item.id));if(!patterns.size&&!audio.size)return false;
 if(direction==='undo'){if(state.status!=='committed')return false;raw.placements=raw.placements.filter(row=>!patterns.has(row?.id));raw.clips=raw.clips.filter(row=>!audio.has(row?.id));}
 else if(direction==='redo'){if(state.status!=='undone'||!record(state.after))return false;const add=(rows,ids,list)=>{let count=0;for(const row of Array.isArray(rows)?rows:[])if(ids.has(row?.id)){count++;if(!list.some(item=>item?.id===row.id))list.push(clone(row));}return count;};if(add(state.after.placements,patterns,raw.placements)!==patterns.size||add(state.after.clips,audio,raw.clips)!==audio.size)return false;}
 else return false;
 if(record(raw.counts))raw.counts={...raw.counts,...Number.isFinite(raw.counts.clips)?{clips:raw.clips.length}:{},...Number.isFinite(raw.counts.placements)?{placements:raw.placements.length}:{}};
 return true;
}
/** Give a pattern history instance the clone preview (its own previewModel has no `playlist_clone` branch). */
export function installPlaylistClonePreview(history){
 if(!history||history.playlistClonePreview||typeof history.previewModel!=='function')return history;
 const base=history.previewModel;history.playlistClonePreview=true;
 history.previewModel=function(direction,entry,model){
  if(entry?.kind!=='playlist_clone')return base.call(this,direction,entry,model);
  const controller=this.externalEntries?.get?.(entry.externalId),raw0=model?.raw,state0=model?.state;if(!controller||!record(raw0)||!record(state0))return null;
  const raw=clone(raw0);if(!playlistClonePreviewRaw(controller,direction,raw))return null;
  const state={...state0},mirror=(field,rows,key)=>{const value=state[field];if(Array.isArray(value))state[field]=rows;else if(record(value)&&Array.isArray(value[key]))state[field]={...value,[key]:rows};};
  mirror('patternPlacements',raw.placements,'placements');mirror('placements',raw.placements,'placements');mirror('clips',raw.clips,'clips');if(record(state.project))state.project=raw;
  try{const project=normalizeCloudProject(raw,state,{projectId:this.engine?.projectId,trackId:this.engine?.session?.trackId});const selected=this.engine?.selectedPattern;if(selected&&project.patterns?.some(pattern=>pattern.id===selected))project.selectedPattern=selected;return{project,raw,state};}catch{return null;}
 };
 return history;
}
/** Adopt only a complete, authenticated saved read, preserving no stale worker
 * bindings. The existing history projector validates all canonical collections.
 */
export function projectPlaylistCloneRead(engine,result,scope){return projectPlacementHistory(engine,body(result),scope);}
