import {audioAttachArguments} from './cloud-audio-import.js';
import {isIdempotencyInProgress,definiteCloudRejection,retainInProgress,assertTerminalIdempotency,captureWriteRequest,replayKnownBusyWrite} from './cloud-errors.js';
import {captureAudioClipboard,planAudioClipboardPaste,clipboardTiming,clipboardKey,clipboardStateKey,clipboardSourceSignature,clipboardCopyMetadataMatches,clipboardEnvelopeKey,clipboardEnvelopeData,sliceClipboardEnvelope,clipboardGridSelection,clipboardMilliseconds} from './audacity-clipboard.js';
import {assertCompleteCanonicalData,normalizeCloudProject} from './cloud-session.js';
import {unwrapRangeEditResult,validateRangeBatchOperations,assertRangeAppliedState,batchPostCommitError} from './audacity-range-edit.js';
import {automationWrite} from './automation-ui.js';
import {LEGACY_AUTOMATION_CONTRACT,assertAutomationJsonValue,assertAutomationWritePreservesData,automationReadbackDifferences} from './audacity-automation-contract.js';
import {normalizeClipWaveform} from './cloud-waveform.js';
import {completeCanonicalPlacements} from './audacity-canonical-placements.js';
import {editQueue,writesInFlight,whenWritesIdle,warnEngineOrphans,engineNeedsReconcile,requestEngineReconcile,pendingEngineReconcile,callWithEngineRetry} from './audacity-edit-queue.js';
import {TRACK_GUTTER_PX} from './audacity-layout.js';
const clone=value=>structuredClone(value),scope=w=>w.getProject()?.cloud?.projectId||w.getProject()?.id;
const problem=message=>Object.assign(new Error(message),{code:'clipboard_scope_changed',name:'AbortError'});
const rejected=definiteCloudRejection;
const laneOf=clip=>clip.laneId??clip.lane_id;
const remapEnvelope=(envelope,id)=>{const result={...clone(envelope),clipId:id,persisted:envelope.persisted!==false},old=envelope.clipId??envelope.clip_id;delete result.clip_id;if(typeof result.targetKey==='string'&&result.targetKey.startsWith(old+':'))result.targetKey=id+result.targetKey.slice(old.length);delete result.id;delete result.revision;return result;};
const rawClone=(source,id)=>({...clone(source),id,...(typeof source.editUrl==='string'&&source.editUrl.endsWith('/'+source.id)?{editUrl:source.editUrl.slice(0,-source.id.length)+id}:{})});
function setTiming(clip,timing){clip.startMs=timing.start_ms;clip.durationSec=timing.duration_sec;clip.audioOffsetSec=timing.audio_offset_sec;delete clip.start_ms;delete clip.duration_sec;delete clip.audio_offset_sec;return clip;}

/** Cloud-owned audio, browser-owned region clipboard and composite history.
 * Every mutation has a retained receipt; ambiguity blocks writes until explicit
 * recovery. Temporary source restoration is removed before final verification.
 */
export class AudacityClipboard{
 constructor(workspace){this.w=workspace;this.clipboard=null;this.past=new Map();this.future=new Map();this.receipts=new Map();this.pending=new Map();this.active=null;}
 stack(map,id=scope(this.w)){if(!map.has(id))map.set(id,[]);return map.get(id);}
 context(){const e=this.w.engine;return {projectId:scope(this.w),trackId:e.session.trackId,loadVersion:e.loadVersion||0,contextVersion:e.session.contextVersion||0};}
 assertContext(c){const e=this.w.engine;if(!e.ready||e.loading||e.session.closed||scope(this.w)!==c.projectId||e.projectId!==c.projectId||e.session.projectId&&e.session.projectId!==c.projectId||e.session.trackId!==c.trackId||(e.loadVersion||0)!==c.loadVersion||(e.session.contextVersion||0)!==c.contextVersion)throw problem('The project changed during the clipboard operation. Return to its original project to recover its receipts.');}
 idle(){const w=this.w,e=w.engine;if(w.busy||e.loading||e.applying||e.interacting||e.playing||w.paused||e.recorder?.recording||w.clipGesture||w.selectionGesture?.active||w.envelopeView?.active||w.multiToolView?.active||w.trackLayout?.active||w.amplitudeView?.active||w.panGesture||w.loopRegion?.active||w.viewport?.pinDrag)throw new Error('Stop audio and finish the current edit before using the audio clipboard.');this.assertContext(this.context());}
 uncertain(id=scope(this.w)){return this.stack(this.receipts,id).some(entry=>entry.status==='uncertain'||entry.status==='interrupted');}
 unverified(id=scope(this.w)){return this.stack(this.receipts,id).some(entry=>entry.status==='applied-unverified');}
 hasClipboard(){return !!this.clipboard;}
 clearFuture(id=scope(this.w)){this.stack(this.future,id).length=0;}
 lanes(){const w=this.w,rows=w.tracks.filter(track=>w.selectedTracks.has(track.index));if(!rows.length||rows.length!==w.selectedTracks.size||rows.some(row=>!row.laneId||row.clips.some(clip=>clip.patternId)||['instrument','pattern','midi'].includes(row.channel?.type)))throw new Error('Select persisted audio tracks for the clipboard. Pattern and mixed tracks are not silently omitted.');return rows.map(row=>row.laneId);}
 async lock(action){this.idle();const w=this.w,body=w.root?.ownerDocument?.body;w.busy=true;body?.classList.add('au-cloud-busy');try{return await action();}finally{w.busy=false;body?.classList.remove('au-cloud-busy');w.lanePan?.sync?.();this.renderRecovery();}}
 async flush(c){await this.w.envelopeView?.controller.saveQueue;await this.w.engine.flush();this.assertContext(c);}
 /** Identical read calls already in flight share one request (never a cache: a
  * read started after the first one completed always goes to the server). */
 async call(c,name,args){this.assertContext(c);const shared=name==='get_project'||name==='list_automation',id=shared?JSON.stringify([name,args]):null;this.inflightReads??=new Map();
  let promise=shared?this.inflightReads.get(id):null;if(!promise){promise=Promise.resolve(this.w.engine.session.call(name,args));if(shared){this.inflightReads.set(id,promise);const drop=()=>{if(this.inflightReads.get(id)===promise)this.inflightReads.delete(id);};promise.then(drop,drop);}}
  const raw=await promise;this.assertContext(c);return unwrapRangeEditResult(clone(raw));}
 async read(c){
  this.assertContext(c);const projectResult=await this.call(c,'get_project',{project_id:c.projectId}),project=projectResult.project??projectResult;
  assertCompleteCanonicalData(project,'clipboard project');assertAutomationJsonValue(project);
  if(project.id!==c.projectId||!Array.isArray(project.clips)||!Array.isArray(project.lanes))throw new Error('A complete canonical project is required for clipboard recovery.');
  const ids=project.clips.map(clip=>clip.id);if(new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw new Error('Canonical clipboard audio identities are ambiguous.');if(project.counts?.clips!==undefined&&project.counts.clips!==ids.length)throw new Error('The canonical audio clip count is incomplete.');project.clips.forEach(clipboardTiming);
  const savedPlacements=completeCanonicalPlacements(project,c.projectId);
  // Clip-gain envelopes come from the per-clip read below (it returns persisted and
  // implicit rows); the project-wide list_automation duplicated it on every checkpoint.
  const [all,placements]=await Promise.all([{envelopes:[]},savedPlacements===null?this.call(c,'execute_pro_action',{project_id:c.projectId,track_id:c.trackId||project.lanes[0]?.id,action:'list_pattern_placements',arguments:{}}):{placements:savedPlacements}]);
  if(!Array.isArray(all.envelopes)||!Array.isArray(placements.placements))throw new Error('Complete automation and pattern checkpoints are required before clipboard edits.');
  const envelopes=new Map();for(const row of all.envelopes)envelopes.set(clipboardEnvelopeKey(row),clone(row));
  for(let start=0;start<ids.length;start+=128){const data=await this.call(c,'list_automation',{project_id:c.projectId,clip_ids:ids.slice(start,start+128)});if(!Array.isArray(data.envelopes))throw new Error('The canonical clip-gain envelopes are unavailable.');for(const row of data.envelopes)envelopes.set(clipboardEnvelopeKey(row),clone(row));}
  const result={project:clone(project),placements:clone(placements.placements),envelopes:[...envelopes.values()]};assertCompleteCanonicalData(result,'clipboard checkpoint');assertAutomationJsonValue(result);for(const row of result.envelopes)if(!Array.isArray(row.points)||row.pointCount!==undefined&&row.pointCount!==row.points.length)throw new Error('A canonical clipboard envelope is incomplete.');
  for(const row of [projectResult,...result.project.clips,...result.envelopes,...result.placements])for(const key of ['projectId','project_id'])if(row[key]!==undefined&&row[key]!==c.projectId)throw new Error('A clipboard checkpoint belongs to another project.');
  return result;
 }
 contract(){return this.w.envelopeView?.automationContract?.()??this.w.envelopeView?.controller.getAutomationContract?.()??LEGACY_AUTOMATION_CONTRACT;}
 async sourceProof(c,id){const request={projectId:c.projectId,clipId:id,trackId:id,startFrame:0,endFrame:1,buckets:1},raw=await this.w.engine.session.call('get_clip_waveform',{project_id:c.projectId,clip_id:id,track_id:id,start_frame:0,end_frame:1,buckets:1});this.assertContext(c);const tile=normalizeClipWaveform(raw,request);return {revision:tile.revision,sampleRate:tile.sampleRate,channelCount:tile.channelCount,frameCount:tile.frameCount};}
 async pinSources(c,clipboard){clipboard.sources={};for(const id of new Set(clipboard.lanes.flatMap(lane=>lane.fragments.map(item=>item.sourceId))))clipboard.sources[id]=await this.sourceProof(c,id);return clipboard;}
 checkEnvelopes(clipboard){for(const lane of clipboard.lanes)for(const fragment of lane.fragments)for(const envelope of fragment.envelopes)if(envelope.persisted!==false)assertAutomationWritePreservesData({points:envelope.points,envelope,window:{durationSec:fragment.durationSec},contract:this.contract()});}
 async copy(){
  this.w.assertOwnedEditsSettled?.();if(this.uncertain()||this.unverified())throw new Error('Recover the retained clipboard edit before capturing another region.');const c=this.context(),selection=clone(this.w.selection),laneIds=this.lanes();
  return this.lock(async()=>{this.w.engine.onStatus?.('Copying selected audio and checking its cloud source…');await this.flush(c);const state=await this.read(c);if(clipboardKey(selection)!==clipboardKey(this.w.selection)||clipboardKey(laneIds)!==clipboardKey(this.lanes()))throw problem('The selection changed while Copy was waiting.');const captured=await this.pinSources(c,captureAudioClipboard({projectId:c.projectId,state,laneIds,selection}));this.checkEnvelopes(captured);this.clipboard=captured;this.w.engine.onStatus?.('Copied audio, gaps and envelopes; clipboard insertion uses the cloud 1 ms timeline grid.');return clone(captured);});
 }
 owned(action){return this.w.ownedEdit?this.w.ownedEdit('clipboard',action):action();}
 cut(){return this.owned(()=>this.mutate('cut'));}
 /** ⌘V during an in-flight write is queued in order (not refused): its ghost
  * shows at once and it pastes at the selection captured at the keystroke. */
 paste(){
  const w=this.w;if(w.historyRunning||!writesInFlight(w))return this.owned(()=>this.mutate('paste'));
  if(!this.clipboard)return Promise.reject(new Error('Copy or Cut an audio region before Paste.'));
  const selection=clone(w.selection),tracks=new Set(w.selectedTracks),focused=w.focusedTrack;let ghosts=[];try{ghosts=this.pasteGhosts(this.lanes(),selection.start,Number(this.clipboard.durationSec));}catch{}w.engine.onStatus?.('Paste queued behind the previous edit…');
  const task=editQueue(w).enqueue('Paste',async()=>{await whenWritesIdle(w);w.selection=clone(selection);w.selectedTracks=new Set(tracks);w.focusedTrack=focused;return this.owned(()=>this.mutate('paste'));});
  const clear=()=>ghosts.forEach(ghost=>ghost.remove());task.then(clear,clear);return task;
 }
 async write(entry,name,args,label){
  this.assertContext(entry.context);args={...args,idempotency_key:args.idempotency_key??args._studio?.idempotency_key??crypto.randomUUID()};const attempt={name,arguments:clone(args),request:captureWriteRequest(name,args),label,status:'submitted',raw:null};entry.attempts.push(attempt);this.w.engine.onStatus?.(label+' in Freestyle…');
  try{const raw=name==='apply_clip_batch'?await callWithEngineRetry(this.w,(n,a)=>this.w.engine.session.call(n,a),name,args):await this.w.engine.session.call(name,args);attempt.raw=clone(raw);const receipt=unwrapRangeEditResult(raw);attempt.receipt=clone(receipt);attempt.status='acknowledged';{const post=batchPostCommitError(receipt);if(post||name==='apply_clip_batch'&&engineNeedsReconcile(receipt)){entry.mirrorUnverified=true;requestEngineReconcile(this.w,{reason:'clipboard'});}}this.assertContext(entry.context);if(receipt.engine_reload_required===true){entry.mirrorUnverified=true;if(name!=='apply_clip_batch'&&name!=='edit_time_range'&&!(name==='execute_pro_action'&&['copy_append_clip','move_clip_to_lane','attach_clip_to_session'].includes(args.action))){entry.status='applied-unverified';throw new Error('The clipboard operation is persisted but its native engine mirror needs verification.');}}return receipt;}
  catch(error){if(attempt.status!=='acknowledged'){retainInProgress(entry,error);retainInProgress(attempt,error);if(error.result!==undefined)attempt.raw=clone(error.result);}attempt.error=error.message;if(attempt.status!=='acknowledged'){attempt.status=rejected(error)?'rejected':'uncertain';entry.status=attempt.status==='uncertain'?'uncertain':entry.attempts.some(row=>row.status==='acknowledged')?'interrupted':'rejected';}else if(entry.status!=='applied-unverified')entry.status='interrupted';entry.error=error.message;throw error;}
 }
 action(entry,name,args,label=name){return this.write(entry,'execute_pro_action',{project_id:entry.context.projectId,track_id:args.lane_id||entry.context.trackId||entry.before.project.lanes[0]?.id,action:name,arguments:args},label);}
 /** The pasted clip shows at its persisted ACK; engine attachment is
  * background work (backgroundVerify, default on). Only owned new clones are
  * deferred; their exact attach logic is unchanged and runs after registration. */
 async loadOwnedClone(entry,expected,parentAttempt){const receipt=parentAttempt?.receipt;if(this.backgroundVerify!==false&&(receipt?.engine_attached===true&&receipt?.engine_reload_required!==true||receipt?.applied===true&&receipt?.engine_reload_required===false||Array.isArray(receipt?.inserted)&&receipt.inserted.some(row=>(row?.clipId??row?.id)===expected.id&&row.engine_attached===true))){(entry.attachSkipped??=[]).push({expected:clone(expected),parentAttempt});return expected;}/* the engine applied the insert itself; attach only if the background check finds it not live *//* round 5: server-attached; the background settle only confirms */
  if(this.backgroundVerify!==false){(entry.deferredLoads??=[]).push({expected:clone(expected),parentAttempt});return expected;}return this.loadOwnedCloneNow(entry,expected,parentAttempt);}
 async loadOwnedCloneNow(entry,expected,parentAttempt){
  if(!entry.createdIds.includes(expected.id)||entry.before.project.clips.some(row=>row.id===expected.id))throw new Error('Only this Paste newly acknowledged clone may be loaded.');
  const capability=await this.call(entry.context,'list_pro_capabilities',{action:'attach_clip_to_session'}),fresh=await this.read(entry.context),matches=fresh.project.clips.filter(row=>row.id===expected.id),actual=matches[0];
  if(matches.length!==1||laneOf(actual)!==laneOf(expected)||clipboardSourceSignature(actual)!==clipboardSourceSignature(expected)||clipboardKey(clipboardTiming(actual))!==clipboardKey(clipboardTiming(expected)))throw new Error('The owned clipboard clone changed before its live attachment.');
  entry.clipLoads??=[];let load=entry.clipLoads.find(row=>row.parentKey===parentAttempt.arguments.idempotency_key&&row.clipId===expected.id);
  if(!load){const args=audioAttachArguments(capability,{projectId:entry.context.projectId,clip:actual,laneId:laneOf(actual)});load={parentKey:parentAttempt.arguments.idempotency_key,clipId:expected.id,key:crypto.randomUUID(),arguments:{project_id:entry.context.projectId,track_id:entry.context.trackId,action:'attach_clip_to_session',arguments:args}};load.arguments.idempotency_key=load.key;entry.clipLoads.push(load);}
  if(!load.acknowledged){try{load.receipt=await this.write(entry,'execute_pro_action',clone(load.arguments),'Loading the owned clipboard clone');load.acknowledged=true;}catch(error){load.error=error.message;if(isIdempotencyInProgress(error)||Number(error.status)!==409)throw error;load.conflict=true;}}
  if(!entry.backgroundSettling)entry.status='applied-unverified';await this.w.engine.refresh();this.assertContext(entry.context);this.assertLiveClip(expected.id,expected);if(!entry.backgroundSettling)entry.status='preparing';load.nativeVerified=true;parentAttempt.nativeVerified=true;const attempt=entry.attempts.findLast(row=>row.arguments.idempotency_key===load.key);if(attempt)attempt.nativeVerified=true;entry.mirrorUnverified=entry.attempts.some(row=>row.receipt?.engine_reload_required===true&&!row.nativeVerified);return actual;
 }
 async batch(entry,operations,label){
  if(!operations.length)return null;entry.liveParticipants.push(...operations.map(op=>op.id));const receipt=await this.write(entry,'apply_clip_batch',{project_id:entry.context.projectId,ops:validateRangeBatchOperations(operations)},label);
  if(receipt.engine_reload_required===true){
   entry.mirrorUnverified=true;
   if(operations.every(op=>op.op==='restore'||op.op==='insert')){
    // This is native hydration of already persisted audio, never another
    // database insert/restore. Its acknowledged result still needs live proof.
    for(const op of operations)try{await this.action(entry,'attach_clip_to_session',{db_track_id:op.id},'Loading the restored clipboard audio');}catch(error){if(isIdempotencyInProgress(error)||Number(error.status)!==409)throw error;}
    await this.w.engine.refresh();this.assertContext(entry.context);for(const op of operations)this.assertLiveClip(op.id);entry.mirrorUnverified=false;
   }else{entry.status='applied-unverified';throw new Error('The clipboard edit is persisted, but Freestyle reported engine_reload_required. Live timing/removal is unverified; reload the engine before continuing.');}
  }
  return receipt;
 }
 assertLiveClip(id,target){
  const project=this.w.getProject(),rows=project.audioClips??this.w.engine.project?.audioClips??[],matches=rows.filter(row=>(row.cloudId||row.id)===id);if(matches.length!==1||matches[0].engineLoaded!==true)throw new Error('The saved clipboard clip is not verified in the live engine. Reload its retained receipt before playback.');
  if(target){const clip=matches[0],runtime=clip.cloudRuntime;if(runtime?.db_track_id&&runtime.db_track_id!==laneOf(target))throw new Error('The clipboard clone is saved on its destination lane but its native lane still needs verification.');const bpm=project.bpm;if(!Number.isFinite(bpm)||bpm<=0||clip.offsetKnown!==true)throw new Error('The live clipboard source window is not known.');assertRangeAppliedState([{id,laneId:clip.laneId,start_ms:clip.start*60000/bpm,duration_sec:clip.length*60/bpm,audio_offset_sec:clip.offset*60/bpm}],{clipsAfter:[target]});}
  return matches[0];
 }
 async mutate(kind){
  this.w.assertOwnedEditsSettled?.();if(this.uncertain()||this.unverified())throw new Error('Recover the retained clipboard transaction before another Cut or Paste.');
  const c=this.context(),selection=clone(this.w.selection),lanes=this.lanes(),clipboard=kind==='paste'?clone(this.clipboard):null;
  if(kind==='paste'&&(!clipboard||clipboard.projectId!==c.projectId))throw new Error(clipboard?'This audio clipboard belongs to another project. Return to its original project before pasting.':'Copy or Cut an audio region before Paste.');
  if(kind==='paste'){
   const sources=clipboard.lanes;if(!Array.isArray(sources)||!sources.length||sources.some(lane=>typeof lane?.laneId!=='string'||!lane.laneId))throw new Error('The audio clipboard has no complete source-lane mapping.');
   if(sources.length!==1&&sources.length!==lanes.length)throw new Error('Select one destination lane for each copied lane.');
   if(this.w.crossTrackPasteSupported===false&&lanes.some((lane,index)=>sources[sources.length===1?0:index].laneId!==lane))throw Object.assign(new Error('Cross-track Paste is temporarily disabled until live track routing is verified. Paste into the original audio track.'),{code:'cross_track_paste_disabled'});
  }

  // Immediate feedback: a non-interactive ghost of the pasted
  // region appears on each destination row until the guarded paste settles.
  const ghosts=kind==='paste'?this.pasteGhosts(lanes,selection.start,Number(clipboard?.durationSec)):[];
  const task=this.lock(async()=>{
   this.w.engine.onStatus?.(kind==='cut'?'Preparing Cut and retaining its cloud source…':'Preparing Paste and checking the destination…');
   await this.flush(c);const before=await this.read(c);if(clipboardKey(selection)!==clipboardKey(this.w.selection)||clipboardKey(lanes)!==clipboardKey(this.lanes()))throw problem('The clipboard selection changed while the edit was waiting.');
   const entry={kind,context:c,before,after:null,attempts:[],createdIds:[],createdSnapshots:{},temporaryIds:[],envelopeWrites:[],liveParticipants:[],status:'preparing',applied:'edit',selectionBefore:selection,selectionAfter:null,checkpoint:null,error:null};this.stack(this.receipts,c.projectId).push(entry);this.pending.set(c.projectId,entry);
   try{
    if(kind==='cut'){
     const copied=captureAudioClipboard({projectId:c.projectId,state:before,laneIds:lanes,selection});this.checkEnvelopes(copied);
     const args={project_id:c.projectId,lane_ids:lanes,operation:'delete',start_ms:Math.round(copied.selection.start*1000),end_ms:Math.round(copied.selection.end*1000),ripple:true,idempotency_key:crypto.randomUUID(),dry_run:true};
     entry.planIdempotencyKey=crypto.randomUUID();const plan=await this.call(c,'edit_time_range',{...args,idempotency_key:entry.planIdempotencyKey});entry.rangePlan=clone(plan);if(!Array.isArray(plan.ops)||!Array.isArray(plan.inverse_ops))throw new Error('Freestyle did not provide the complete Cut plan and its inverse.');validateRangeBatchOperations(plan.inverse_ops,{allowEmpty:true});
     // Clipboard contents must correspond to the server's actual cut boundaries.
     const actual=clone(copied.selection);for(const cut of plan.cuts||[])if(Number.isFinite(cut.actual_ms)&&['start','end'].includes(cut.boundary))actual[cut.boundary]=cut.actual_ms/1000;
     const exact=await this.pinSources(c,captureAudioClipboard({projectId:c.projectId,state:before,laneIds:lanes,selection:actual}));this.checkEnvelopes(exact);entry.capturedClipboard=exact;entry.allowedRangeIds=(plan.ops||[]).filter(op=>op.op==='insert').map(op=>op.id);
     entry.intendedAfter=this.rangeTarget(before,plan.ops);entry.selectionAfter={start:actual.start,end:actual.start};const receipt=await this.write(entry,'edit_time_range',{...args,dry_run:false},'Cutting audio');entry.cutReceipt=receipt;entry.liveParticipants.push(...plan.ops.map(op=>op.id));if(receipt.engine_reload_required===true){entry.mirrorUnverified=true;entry.status='applied-unverified';throw new Error('Cut is persisted, but Freestyle could not mirror it in the live engine. Reload and verify the retained receipt before playback or another edit.');}
     let after=await this.read(c);assertRangeAppliedState(after.project.clips,{operations:receipt.ops??plan.ops,clipsAfter:receipt.clips_after??[],inverseOps:receipt.undo?.inverse_ops??plan.inverse_ops});
     const expected=this.rangeTarget(before,receipt.ops??plan.ops);await this.syncAutomation(entry,expected,after);after=await this.read(c);this.assertState(expected,after);entry.after=after;entry.selectionAfter={start:actual.start,end:actual.start};this.clipboard=exact;
    }else{
     this.checkEnvelopes(clipboard);entry.capturedClipboard=clipboard;let insertionState=before;
     // Native Paste replaces the selected region before inserting the clipboard.
     const aligned=clipboardGridSelection(selection,before.project.clips,lanes);if(aligned.end>aligned.start){const args={project_id:c.projectId,lane_ids:lanes,operation:'delete',start_ms:Math.round(aligned.start*1000),end_ms:Math.round(aligned.end*1000),ripple:true,idempotency_key:crypto.randomUUID(),dry_run:false};entry.replaceReceipt=await this.write(entry,'edit_time_range',args,'Replacing the selected audio region');insertionState=await this.read(c);}
     const plan=planAudioClipboardPaste({clipboard,state:insertionState,laneIds:lanes,cursorSec:aligned.start});entry.plan=clone(plan);await this.performPaste(entry,plan,insertionState);entry.selectionAfter=plan.selection;
    }
    entry.status='applied-unverified';await this.finish(entry,entry.after);this.stack(this.past,c.projectId).push(entry);this.clearFuture(c.projectId);this.w.selection=clone(entry.selectionAfter);this.w.paintSelection?.();this.w.engine.onStatus?.((kind==='cut'?'Cut audio region; source and Undo are retained.':'Pasted audio region with its gaps and envelopes.')+' Cloud timeline grid: 1 ms.');return entry;
   }catch(error){entry.error=error.message;if(entry.status==='preparing')entry.status=entry.attempts.some(row=>row.status==='acknowledged')?'interrupted':'rejected';if(entry.status==='applied-unverified'&&!this.stack(this.past,c.projectId).includes(entry)){this.stack(this.past,c.projectId).push(entry);this.clearFuture(c.projectId);}throw Object.assign(error,{clipboardEntry:entry});}
   finally{this.active=null;if(!['uncertain','interrupted','applied-unverified'].includes(entry.status))this.pending.delete(c.projectId);}
  });
  const clear=()=>ghosts.forEach(ghost=>ghost.remove());task.then(clear,clear);return task;
 }
 pasteGhosts(laneIds,startSec,durationSec){
  try{
   const w=this.w,doc=w.root?.ownerDocument;if(!doc||!Number.isFinite(startSec)||!(durationSec>0))return [];
   return laneIds.map(laneId=>{const track=w.tracks.find(row=>row.laneId===laneId),lane=track&&w.root.querySelector(`.au-track[data-track="${track.index}"] .au-lane`);if(!lane)return null;const el=doc.createElement('div');el.className='au-paste-placeholder';el.setAttribute('aria-hidden','true');Object.assign(el.style,{position:'absolute',left:Math.round(w.timeToX(startSec))+'px',top:'2px',bottom:'2px',width:Math.max(3,Math.round(durationSec*w.scale))+'px',pointerEvents:'none',opacity:'.55',border:'1px dashed currentColor',background:'rgba(127,127,127,.18)',zIndex:'5'});lane.append(el);return el;}).filter(Boolean);
  }catch{return [];}
 }
 rangeTarget(before,operations){
  const target=clone(before),original=new Map(before.project.clips.map(clip=>[clip.id,clip])),sourceIds=new Map(before.project.clips.map(clip=>[clip.id,clip.id])),clips=new Map(target.project.clips.map(clip=>[clip.id,clip]));
  for(const op of operations){if(op.op==='remove')clips.delete(op.id);else if(op.op==='insert'){const source=original.get(op.source_id);if(!source)throw new Error('A Cut split has an unknown canonical source.');clips.set(op.id,rawClone(source,op.id));sourceIds.set(op.id,op.source_id);}if(op.op!=='remove'){const clip=clips.get(op.id);if(!clip)throw new Error('Cut changed an unknown clip.');setTiming(clip,{...clipboardTiming(clip),...Object.fromEntries(['start_ms','duration_sec','audio_offset_sec'].filter(key=>op[key]!==undefined).map(key=>[key,op[key]]))});}}
  target.project.clips=[...clips.values()];const edited=new Set(operations.map(op=>op.id));target.envelopes=before.envelopes.filter(row=>!edited.has(row.clipId??row.clip_id)).map(clone);
  for(const clip of target.project.clips.filter(row=>edited.has(row.id))){const source=original.get(sourceIds.get(clip.id)),a=clipboardTiming(source),b=clipboardTiming(clip),offset=b.audio_offset_sec-a.audio_offset_sec;for(const row of before.envelopes.filter(row=>(row.clipId??row.clip_id)===source.id))target.envelopes.push(remapEnvelope(sliceClipboardEnvelope(row,offset,offset+b.duration_sec),clip.id));}
  return target;
 }
 /** Round-5 chain: each write's ACK card replaces the read between steps. */
 chain(){return this.backgroundVerify!==false&&this.chainMode!==false;}
 ackCard(receipt,id){const card=receipt?.clip??receipt?.card??receipt?.clipCard??(receipt?.id&&receipt.laneId?receipt:null);return card&&typeof card.id==='string'&&(id===undefined||card.id===id)&&typeof card.laneId==='string'&&Number.isFinite(card.startMs)&&Number.isFinite(card.durationSec)&&Number.isFinite(card.audioOffsetSec)?clone(card):null;}
 /** 328 clips:batch receipts list each inserted clip {clipId,laneId,sourceId,startMs,durationSec,audioOffsetSec,engine_attached}. */
 insertedCard(receipt,source){const rows=Array.isArray(receipt?.inserted)?receipt.inserted:[],row=rows.find(item=>item?.sourceId===source.id)??(rows.length===1?rows[0]:null),id=row?.clipId??row?.id;if(!row||typeof id!=='string'||![row.startMs,row.durationSec,row.audioOffsetSec].every(Number.isFinite)||typeof row.laneId!=='string')return null;const card={...rawClone(source,id),laneId:row.laneId,startMs:row.startMs,durationSec:row.durationSec,audioOffsetSec:row.audioOffsetSec};if(source.isImported===true)card.isImported=false;return card;}
 async performPaste(entry,plan,before){
  const chained=this.chain()&&!plan.clones.some(item=>item.envelopes?.some(row=>row.persisted===true))&&!plan.updates.some(update=>update.envelopes?.some(row=>row.persisted===true));entry.chained=chained;
  let current=chained?clone(before):await this.read(entry.context);const target=clone(before),byId=new Map(target.project.clips.map(clip=>[clip.id,clip])),newEnvelopes=[];
  for(const update of plan.updates){setTiming(byId.get(update.id),update.timing);if(update.envelopes){target.envelopes=target.envelopes.filter(row=>(row.clipId??row.clip_id)!==update.id);target.envelopes.push(...update.envelopes.map(clone));}}
  const end=Math.max(0,...current.project.clips.map(clip=>{const t=clipboardTiming(clip);return t.start_ms/1000+t.duration_sec;}));let stagingSec=Math.ceil(end+plan.durationSec+1);
  for(const item of plan.clones){
   let source=current.project.clips.find(clip=>clip.id===item.sourceId);
   if(!source){entry.temporaryIds.push(item.sourceId);await this.batch(entry,[{op:'restore',id:item.sourceId,...clipboardTiming(item.source)}],'Restoring the retained clipboard source');current=await this.read(entry.context);source=current.project.clips.find(clip=>clip.id===item.sourceId);if(!source)throw new Error('Freestyle did not restore the retained source.');}
   if(clipboardSourceSignature(source)!==clipboardSourceSignature(item.source))throw new Error('The clipboard source audio or metadata changed. Its retained snapshot will not be replaced with different audio.');
   const proof=entry.capturedClipboard?.sources?.[item.sourceId];if(proof&&clipboardKey(await this.sourceProof(entry.context,item.sourceId))!==clipboardKey(proof))throw new Error('The clipboard source audio revision changed after capture. No different source will be pasted.');
   const ids=new Set(current.project.clips.map(clip=>clip.id)),attemptSource=clone(source);entry.stagingSource={source:attemptSource,startMs:stagingSec*1000,beforeIds:[...ids]};
   const copyReceipt=await this.action(entry,'copy_append_clip',{clip_id:source.id,start_ms:stagingSec*1000},'Copying the retained source audio');const copyAttempt=entry.attempts.at(-1);let card=chained?(this.ackCard(copyReceipt)??this.insertedCard(copyReceipt,source)):null;if(card&&(ids.has(card.id)||laneOf(card)!==laneOf(source)||clipboardTiming(card).start_ms!==stagingSec*1000||!clipboardCopyMetadataMatches(item.source,card)))card=null;
   if(card){current.project.clips.push(card);if(current.project.counts&&Object.hasOwn(current.project.counts,'clips'))current.project.counts.clips=current.project.clips.length;}else current=await this.read(entry.context);const added=current.project.clips.filter(clip=>!ids.has(clip.id));
   if(added.length!==1)throw new Error('The copied audio identity is ambiguous. The copy receipt is retained; no duplicate copy will be sent.');const copied=added[0];this.w.waveformView?.aliasSource?.(copied.id,source.id);entry.createdIds.push(copied.id);entry.liveParticipants.push(copied.id);entry.createdSnapshots[copied.id]={clip:clone(copied),envelopes:current.envelopes.filter(row=>(row.clipId??row.clip_id)===copied.id).map(clone)};item.newId=copied.id;entry.stagingSource=null;
   if(!clipboardCopyMetadataMatches(item.source,copied))throw new Error('Freestyle copied different clip metadata. The transaction is retained for recovery.');
   await this.loadOwnedClone(entry,copied,copyAttempt);let copiedName=copied.name;
   if(laneOf(copied)!==item.laneId){const move=await this.action(entry,'move_clip_to_lane',{clip_id:copied.id,lane_id:item.laneId,start_ms:stagingSec*1000},'Mapping the copied audio to its destination lane'),moveAttempt=entry.attempts.at(-1),moveCard=chained?this.ackCard(move,copied.id):null;if(moveCard&&laneOf(moveCard)===item.laneId&&clipboardTiming(moveCard).start_ms===stagingSec*1000){const index=current.project.clips.findIndex(row=>row.id===copied.id);current.project.clips[index]=moveCard;}else current=await this.read(entry.context);const moved=current.project.clips.find(row=>row.id===copied.id),card=move.clip??move.card??move.clipCard??(move.id===copied.id?move:null);
    // Some engine MOVE receipts label a NEW clone with its lane name. Only
    // that exact ACK-owned cosmetic field is accepted; source metadata and
    // originals remain strict, and Undo owns this verified resulting card.
    if(card?.id===copied.id&&laneOf(card)===item.laneId&&(card.startMs??card.start_ms)===stagingSec*1000&&move.undo?.clip_id===copied.id&&typeof card.name==='string'&&card.name===moved?.name)copiedName=card.name;
    const expectedMove={...clone(copied),name:copiedName,laneId:item.laneId};setTiming(expectedMove,{...clipboardTiming(copied),start_ms:stagingSec*1000});
    if(!moved||laneOf(moved)!==item.laneId||clipboardSourceSignature(moved)!==clipboardSourceSignature(expectedMove)||clipboardKey(clipboardTiming(moved))!==clipboardKey(clipboardTiming(expectedMove)))throw new Error('The moved clipboard clone changed source, geometry or unacknowledged metadata.');
    (entry.acknowledgedMoves??=[]).push({before:clone(copied),after:clone(moved),receipt:clone(move)});if(this.backgroundVerify===false){entry.status='applied-unverified';await this.w.engine.refresh();this.assertContext(entry.context);this.assertLiveClip(copied.id,moved);entry.status='preparing';moveAttempt.nativeVerified=true;}else(entry.deferredMoveChecks??=[]).push({id:copied.id,clip:clone(moved),attempt:moveAttempt});entry.mirrorUnverified=entry.attempts.some(row=>row.receipt?.engine_reload_required===true&&!row.nativeVerified);
   }
   const expected=rawClone(item.source,copied.id);if(item.source.isImported===true&&copied.isImported===false)expected.isImported=false;expected.laneId=item.laneId;if(copiedName!==undefined)expected.name=copiedName;setTiming(expected,{start_ms:clipboardMilliseconds(item.startSec),duration_sec:item.durationSec,audio_offset_sec:item.audioOffsetSec});byId.set(copied.id,expected);newEnvelopes.push(...item.envelopes.map(row=>remapEnvelope(row,copied.id)));stagingSec+=Math.ceil(item.source.durationSec??item.source.duration_sec)+1;
  }
  target.project.clips=[...byId.values()];target.envelopes.push(...newEnvelopes);entry.intendedAfter=clone(target);
  if(!chained)current=await this.read(entry.context);const actual=new Map(current.project.clips.map(clip=>[clip.id,clip])),ops=[];
  for(const id of entry.temporaryIds){const clip=actual.get(id);if(clip&&!byId.has(id))ops.push({op:'remove',id,expected:clipboardTiming(clip)});}
  for(const clip of target.project.clips){const now=actual.get(clip.id);if(!now)throw new Error('A Paste participant disappeared before the final batch.');if(clipboardKey(clipboardTiming(now))!==clipboardKey(clipboardTiming(clip)))ops.push({op:'update',id:clip.id,...clipboardTiming(clip),expected:clipboardTiming(now)});}
  await this.batch(entry,ops,'Inserting the audio region and shifting following clips');
  if(chained){entry.after=clone(target);return;}/* the single canonical verify runs in the background (finishFast) */
  current=await this.read(entry.context);await this.syncAutomation(entry,target,current);current=await this.read(entry.context);this.assertState(target,current);entry.after=current;
 }
 assertState(expected,actual){if(clipboardStateKey(expected)!==clipboardStateKey(actual))throw new Error('The canonical clipboard result differs in timing, source, routing, metadata or automation. Its receipts are retained; no ambiguous write is retried.');}
 async syncAutomation(entry,target,current){
  let rows=current.envelopes;const desired=new Map(target.envelopes.map(row=>[clipboardEnvelopeKey(row),row])),liveClips=new Map(target.project.clips.map(clip=>[clip.id,clip]));
  for(const row of rows){if(!desired.has(clipboardEnvelopeKey(row))&&row.persisted&&row.id&&liveClips.has(row.clipId??row.clip_id)){await this.write(entry,'delete_automation',{project_id:entry.context.projectId,envelope_id:row.id,expected_revision:row.revision,confirm:true},'Restoring the canonical clipboard envelope set');}}
  for(const envelope of target.envelopes){
   const clip=liveClips.get(envelope.clipId??envelope.clip_id);if(!clip)continue;const saved=rows.find(row=>clipboardEnvelopeKey(row)===clipboardEnvelopeKey(envelope));if(saved&&clipboardKey(clipboardEnvelopeData(saved))===clipboardKey(clipboardEnvelopeData(envelope)))continue;
   if(envelope.persisted===false){if(saved?.persisted&&saved.id){await this.write(entry,'delete_automation',{project_id:entry.context.projectId,envelope_id:saved.id,expected_revision:saved.revision,confirm:true},'Restoring the implicit clipboard gain');rows=(await this.read(entry.context)).envelopes;}continue;}
   assertAutomationWritePreservesData({points:envelope.points,envelope,window:{durationSec:clipboardTiming(clip).duration_sec},contract:this.contract()});
   const base={...clone(envelope),clipId:clip.id,...(saved?.persisted&&saved.id?{persisted:true,id:saved.id,revision:saved.revision}:{persisted:false})},write=automationWrite(base,envelope.points,entry.context.projectId);entry.envelopeWrites.push({write:clone(write),before:saved?clone(saved):null,desired:clone(envelope)});await this.write(entry,write.name,write.arguments,'Preserving the clipboard automation');
   const next=await this.read(entry.context),readback=next.envelopes.find(row=>clipboardEnvelopeKey(row)===clipboardEnvelopeKey(envelope));if(automationReadbackDifferences(write,readback).length)throw new Error('Freestyle returned different clipboard automation after saving.');rows=next.envelopes;
  }
 }
 async finish(entry,target){assertTerminalIdempotency(entry);
  if(this.backgroundVerify!==false)return this.finishFast(entry,target);
  this.assertContext(entry.context);entry.status='applied-unverified';await this.w.engine.refresh();this.assertContext(entry.context);await this.w.envelopeView?.reload();const actual=await this.read(entry.context);this.assertState(target,actual);if(entry.mirrorUnverified)throw new Error('Freestyle reported an unmirrored clipboard edit. Its canonical state is saved but audible playback still needs engine verification.');for(const id of new Set(entry.liveParticipants)){const clip=target.project.clips.find(row=>row.id===id);if(clip)this.assertLiveClip(id,clip);}entry.checkpoint=clipboardStateKey(actual);entry.status=entry.applied==='undone'?'undone':'applied';entry.error=null;this.pending.delete(entry.context.projectId);this.w.render?.();return actual;
 }
 /** Canonical result is already proven by fast reads; show it now and settle
  * native attachment/readback in the background (non-modal warning on mismatch). */
 async finishFast(entry,target){
  this.assertContext(entry.context);const chained=entry.chained===true&&this.chain(),actual=chained?clone(target):await this.read(entry.context);if(!chained)this.assertState(target,actual);entry.checkpoint=clipboardStateKey(actual);entry.status=entry.applied==='undone'?'undone':'applied';entry.error=null;this.pending.delete(entry.context.projectId);if(chained)entry.canonicalVerify=this.verifyChained(entry,target);
  try{const session=this.w.engine.session;session.rawProject={...clone(session.rawProject??{}),...clone(actual.project)};session.project=normalizeCloudProject(session.rawProject,session.rawState,{projectId:entry.context.projectId,trackId:session.trackId});if(!this.w.engine.applying)this.w.engine.accept?.(session.project);}catch(error){entry.localError=error.message;}
  this.w.render?.();entry.nativeSettle=this.settleNative(entry,target);return actual;
 }
 /** One background canonical read per chained paste/Undo/Redo; mismatch warns and adopts server truth. */
 async verifyChained(entry,target){
  const w=this.w,generation=entry.verifyGeneration=(entry.verifyGeneration||0)+1,superseded=()=>entry.verifyGeneration!==generation;await new Promise(resolve=>setTimeout(resolve,this.settleIdleMs??600));for(let i=0;i<600&&(w.busy||w.engine.applying||w.editQueue?.busy);i++)await new Promise(resolve=>setTimeout(resolve,50));
  if(superseded())return;try{this.assertContext(entry.context);const actual=await this.read(entry.context);if(superseded()||entry.status!==(entry.applied==='undone'?'undone':'applied'))return;this.assertState(target,actual);entry.checkpoint=clipboardStateKey(actual);if(entry.applied!=='undone')entry.after=actual;entry.canonicalVerified=true;}
  catch(error){if(error?.name==='AbortError'||superseded())return;entry.canonicalError=error.message;const message='Freestyle differs from the last clipboard edit ('+error.message+') — showing the saved server state.';(this.warnings??=[]).push(message);w.engine.onStatus?.(message);w.onWarning?.(message);try{await w.engine.refresh();if(!w.engine.applying)w.engine.accept?.(w.engine.session.project);}catch{}}
 }
 async settleNative(entry,target){
  // Run only once the user is idle so a readback never lands mid-edit.
  const w=this.w,idle=()=>!w.busy&&!w.engine.applying&&!w.engine.interacting&&!w.clipGesture&&!w.envelopeView?.active&&!w.editQueue?.busy;
  await new Promise(resolve=>setTimeout(resolve,this.settleIdleMs??600));for(let i=0;i<600&&!idle();i++)await new Promise(resolve=>setTimeout(resolve,50));await w.envelopeView?.controller?.saveQueue;
  if(entry.context&&JSON.stringify(entry.context)!==JSON.stringify(this.context?.()))return;
  if(entry.status!=='applied'){entry.deferredLoads=[];return;}// undone (or superseded) before settling: nothing of it is live to attach
  const loads=entry.deferredLoads??[];entry.deferredLoads=[];const status=entry.status;entry.backgroundSettling=true;
  try{
   for(const load of loads){const final=target.project.clips.find(row=>row.id===load.expected.id);if(!final)continue;await this.loadOwnedCloneNow(entry,final,load.parentAttempt);entry.status=status;}
   await pendingEngineReconcile(this.w);await this.w.engine.refresh();this.assertContext(entry.context);{const lanes=new Set();for(const state of [entry.before,entry.after,entry.intendedAfter,target])for(const clip of state?.project?.clips??[])if(entry.createdIds?.includes(clip.id)||entry.liveParticipants?.includes(clip.id)||entry.temporaryIds?.includes(clip.id))lanes.add(clip.laneId);entry.engineOrphans=warnEngineOrphans(this.w,this.w.engine.session,[...lanes],message=>{(this.warnings??=[]).push(message);this.w.engine.onStatus?.(message);this.w.onWarning?.(message);});}
   for(const skipped of entry.attachSkipped??[]){const final=target.project.clips.find(row=>row.id===skipped.expected.id);if(!final)continue;try{this.assertLiveClip(final.id,final);}catch{await this.loadOwnedCloneNow(entry,final,skipped.parentAttempt);entry.status=status;}}entry.attachSkipped=[];for(const id of new Set(entry.liveParticipants)){const clip=target.project.clips.find(row=>row.id===id);if(clip)this.assertLiveClip(id,clip);}
   for(const check of entry.deferredMoveChecks??[])check.attempt.nativeVerified=true;entry.deferredMoveChecks=[];entry.nativeVerified=true;entry.backgroundSettling=false;entry.status=status;
  }catch(error){entry.status=status;entry.nativeError=error.message;entry.backgroundSettling=false;const message='The paste is saved, but the live engine has not confirmed it yet ('+error.message+'). Its receipts are retained; playback of that audio may be silent until verified.';(this.warnings??=[]).push(message);this.w.engine.onStatus?.(message);this.w.onWarning?.(message);}
 }
 can(direction){const entry=this.stack(direction==='undo'?this.past:this.future).at(-1);if(!entry?.checkpoint||this.w.busy||this.uncertain()||this.unverified())return false;try{this.assertContext(entry.context);return true;}catch{return false;}}
 async restoreState(entry,target,current){
  const wanted=new Map(target.project.clips.map(clip=>[clip.id,clip])),existing=new Map(current.project.clips.map(clip=>[clip.id,clip])),ops=[];
  for(const clip of current.project.clips)if(!wanted.has(clip.id))ops.push({op:'remove',id:clip.id,expected:clipboardTiming(clip)});
  for(const clip of target.project.clips)if(!existing.has(clip.id))ops.push({op:'restore',id:clip.id,...clipboardTiming(clip)});
  const chained=entry.chained===true&&this.chain(),local=state=>{const next=clone(state);for(const op of ops){if(op.op==='remove')next.project.clips=next.project.clips.filter(row=>row.id!==op.id);else if(op.op==='restore')next.project.clips.push(clone(wanted.get(op.id)));}return next;};
  await this.batch(entry,ops,'Restoring clipboard clip membership');current=chained?local(current):await this.read(entry.context);
  for(const clip of target.project.clips){const actual=current.project.clips.find(row=>row.id===clip.id);if(!actual)throw new Error('The retained clip could not be restored.');if(clipboardSourceSignature(actual)!==clipboardSourceSignature(clip))throw new Error('The retained clipboard source or metadata changed.');if(laneOf(actual)!==laneOf(clip)){const move=await this.action(entry,'move_clip_to_lane',{clip_id:clip.id,lane_id:laneOf(clip),start_ms:clipboardTiming(clip).start_ms},'Restoring the clipboard lane mapping'),card=chained?this.ackCard(move,clip.id):null;if(card){const index=current.project.clips.findIndex(row=>row.id===clip.id);current.project.clips[index]=card;}else current=await this.read(entry.context);}}
  const timingOps=[];for(const clip of target.project.clips){const actual=current.project.clips.find(row=>row.id===clip.id);if(clipboardKey(clipboardTiming(actual))!==clipboardKey(clipboardTiming(clip)))timingOps.push({op:'update',id:clip.id,...clipboardTiming(clip),expected:clipboardTiming(actual)});}
  await this.batch(entry,timingOps,'Restoring the clipboard timing');
  if(chained&&!target.envelopes.some(row=>row.persisted===true&&target.project.clips.some(clip=>clip.id===(row.clipId??row.clip_id))&&!current.envelopes?.some(saved=>clipboardEnvelopeKey(saved)===clipboardEnvelopeKey(row)))){return clone(target);}/* verified in the background */
  current=await this.read(entry.context);await this.syncAutomation(entry,target,current);current=await this.read(entry.context);this.assertState(target,current);return current;
 }
 async history(direction){
  if(!['undo','redo'].includes(direction))throw new Error('Choose clipboard Undo or Redo.');const id=scope(this.w),from=this.stack(direction==='undo'?this.past:this.future,id),to=this.stack(direction==='undo'?this.future:this.past,id),entry=from.at(-1);if(!entry)return false;if(!this.can(direction))throw new Error('The clipboard history needs its verified original project checkpoint.');
  return this.lock(async()=>{await this.flush(entry.context);const chained=entry.chained===true&&this.chain(),current=chained?clone(direction==='undo'?entry.after:entry.before):await this.read(entry.context);if(!chained&&clipboardStateKey(current)!==entry.checkpoint)throw new Error('Other edits changed the clipboard checkpoint. Its history will not overwrite them.');/* chained: each op carries its expected timing; the server refuses stale state */const target=direction==='undo'?entry.before:entry.after;entry.historyPending={direction,target:clone(target)};entry.status='preparing';this.pending.set(id,entry);
   try{await this.restoreState(entry,target,current);entry.applied=direction==='undo'?'undone':'edit';entry.status='applied-unverified';await this.finish(entry,target);from.pop();to.push(entry);entry.historyPending=null;this.w.selection=clone(direction==='undo'?entry.selectionBefore:entry.selectionAfter);this.w.paintSelection?.();this.w.engine.onStatus?.(direction==='undo'?'Clipboard edit undone; canonical audio and live clips verified.':'Clipboard edit redone; canonical audio and live clips verified.');return true;}
   catch(error){entry.error=error.message;if(entry.status==='preparing')entry.status='interrupted';throw error;}
  });
 }
 async settleKnownBusy(entry){
  const pending=entry.attempts.filter(attempt=>attempt.idempotencyInProgress===true);if(!pending.length)assertTerminalIdempotency(entry);
  for(const attempt of pending){
   const {raw,receipt}=await replayKnownBusyWrite({knownBusy:true,request:attempt.request,call:(name,args)=>this.w.engine.session.call(name,args),assertCurrent:()=>this.assertContext(entry.context),parse:unwrapRangeEditResult});
   attempt.raw=clone(raw);attempt.receipt=clone(receipt);if(receipt.engine_reload_required===true)entry.mirrorUnverified=true;attempt.status='acknowledged';delete attempt.idempotencyInProgress;if(!entry.attempts.some(row=>row.idempotencyInProgress))delete entry.idempotencyInProgress;entry.status='interrupted';
   if(attempt.name==='execute_pro_action'&&attempt.arguments.action==='move_clip_to_lane'){
    const args=attempt.arguments.arguments,id=args.clip_id,before=entry.createdSnapshots[id]?.clip,card=receipt.clip??receipt.card??receipt.clipCard??(receipt.id===id?receipt:null);
    if(before&&entry.createdIds.includes(id)&&card?.id===id&&laneOf(card)===args.lane_id&&(card.startMs??card.start_ms)===args.start_ms&&receipt.undo?.clip_id===id&&typeof card.name==='string'){
     const expected={...clone(before),laneId:args.lane_id,name:card.name};setTiming(expected,{...clipboardTiming(before),start_ms:args.start_ms});if(clipboardSourceSignature(card)!==clipboardSourceSignature(expected)||clipboardKey(clipboardTiming(card))!==clipboardKey(clipboardTiming(expected)))throw new Error('The recovered move receipt changed the owned clone source or geometry.');(entry.acknowledgedMoves??=[]).push({before:clone(before),after:clone(card),receipt:clone(receipt)});
    }
   }
   if(attempt.name==='edit_time_range'&&Array.isArray(receipt.ops)){const target=this.rangeTarget(entry.before,receipt.ops);(entry.recoveredRangeStates??=[]).push(target);entry.allowedRangeIds=[...new Set([...(entry.allowedRangeIds??[]),...receipt.ops.filter(op=>op.op==='insert').map(op=>op.id)])];}
   const load=entry.clipLoads?.find(row=>row.key===attempt.arguments.idempotency_key);if(load){load.acknowledged=true;load.receipt=clone(receipt);}
  }
  if(!entry.attempts.some(attempt=>attempt.idempotencyInProgress))delete entry.idempotencyInProgress;assertTerminalIdempotency(entry);entry.status='interrupted';entry.error=null;
 }
 async reconcile(){
  const entry=[...this.stack(this.receipts)].reverse().find(row=>['uncertain','interrupted','applied-unverified'].includes(row.status));if(!entry)throw new Error('No clipboard transaction is waiting for verification.');if(entry.knownBusyRollback||entry.idempotencyInProgress||entry.attempts.some(row=>row.idempotencyInProgress))return this.recover();assertTerminalIdempotency(entry);
  return this.lock(async()=>{const target=entry.historyPending?.target??entry.after??entry.intendedAfter;if(!target)throw new Error('The interrupted clipboard transaction has no complete final state. Use Recover to restore its retained starting state.');const actual=await this.read(entry.context);this.assertState(target,actual);const direction=entry.historyPending?.direction;if(direction)entry.applied=direction==='undo'?'undone':'edit';await this.finish(entry,target);
   if(direction){const from=this.stack(direction==='undo'?this.past:this.future,entry.context.projectId),to=this.stack(direction==='undo'?this.future:this.past,entry.context.projectId);if(from.at(-1)!==entry)throw new Error('The chronological clipboard history changed during reconciliation.');from.pop();to.push(entry);this.w.clipboardHistoryReconciled?.({direction,entry});entry.historyPending=null;}
   else if(!this.stack(this.past,entry.context.projectId).includes(entry)){entry.after=actual;this.stack(this.past,entry.context.projectId).push(entry);this.clearFuture(entry.context.projectId);this.w.recordOwnedHistory?.('clipboard',entry.context.projectId);if(entry.kind==='cut')this.clipboard=clone(entry.capturedClipboard);}
   return entry;
  });
 }
 async recover(){
  const entry=[...this.stack(this.receipts)].reverse().find(row=>['uncertain','interrupted','applied-unverified'].includes(row.status));if(!entry)throw new Error('No interrupted clipboard transaction needs recovery.');if((entry.idempotencyInProgress||entry.attempts.some(row=>row.idempotencyInProgress))&&!entry.attempts.some(row=>row.idempotencyInProgress&&row.request))assertTerminalIdempotency(entry);
  return this.lock(async()=>{this.w.engine.onStatus?.('Recovering the retained clipboard starting state…');if(entry.idempotencyInProgress||entry.attempts.some(row=>row.idempotencyInProgress)){entry.knownBusyRollback=true;await this.settleKnownBusy(entry);}let current=await this.read(entry.context);const known=new Set([...entry.before.project.clips.map(row=>row.id),...entry.createdIds,...entry.temporaryIds,...(entry.allowedRangeIds||[])]),unknown=current.project.clips.filter(row=>!known.has(row.id));
   if(unknown.length===1&&entry.stagingSource&&clipboardCopyMetadataMatches(entry.stagingSource.source,unknown[0])&&clipboardTiming(unknown[0]).start_ms===entry.stagingSource.startMs&&clipboardTiming(unknown[0]).duration_sec===clipboardTiming(entry.stagingSource.source).duration_sec&&clipboardTiming(unknown[0]).audio_offset_sec===clipboardTiming(entry.stagingSource.source).audio_offset_sec){entry.createdIds.push(unknown[0].id);entry.createdSnapshots[unknown[0].id]={clip:clone(unknown[0]),envelopes:current.envelopes.filter(row=>(row.clipId??row.clip_id)===unknown[0].id).map(clone)};known.add(unknown[0].id);}else if(unknown.length)throw new Error('Unrelated or ambiguous new clips exist. Clipboard recovery will not remove them.');
   this.assertRecoverable(entry,current);
   const target=entry.historyPending?(entry.historyPending.direction==='undo'?entry.after:entry.before):entry.before,hadPast=this.stack(this.past,entry.context.projectId).includes(entry);entry.status='recovering';try{await this.restoreState(entry,target,current);if(entry.mirrorUnverified){await this.w.engine.refresh();this.assertContext(entry.context);for(const id of new Set(entry.liveParticipants)){const wanted=target.project.clips.find(row=>row.id===id);if(wanted)this.assertLiveClip(id,wanted);else if((this.w.getProject().audioClips??[]).some(row=>(row.cloudId||row.id)===id))throw new Error('The rolled-back clipboard clone remains in the live engine.');}entry.mirrorUnverified=false;}entry.applied=entry.historyPending?.direction==='redo'||!entry.historyPending&&hadPast?'undone':'edit';await this.finish(entry,target);if(!entry.historyPending){if(hadPast){const from=this.stack(this.past,entry.context.projectId);if(from.at(-1)!==entry)throw new Error('The chronological clipboard history changed before recovery.');from.pop();this.stack(this.future,entry.context.projectId).push(entry);this.w.clipboardHistoryReconciled?.({direction:'undo',entry});}else entry.status='recovered';}entry.historyPending=null;entry.error=null;delete entry.knownBusyRollback;this.pending.delete(entry.context.projectId);this.w.engine.onStatus?.('Clipboard recovery completed; the retained starting state and live clips are verified.');return entry;}catch(error){entry.status='interrupted';entry.error=error.message;throw error;}
  });
 }
 assertRecoverable(entry,current){
  const shell=state=>clipboardStateKey({...state,project:{...state.project,clips:[]},envelopes:[]});if(shell(current)!==shell(entry.before))throw new Error('Other project, lane or pattern edits prevent clipboard recovery.');
  const states=[entry.before,entry.after,...(entry.recoveredRangeStates??[])].filter(Boolean),timings=new Map(),lanes=new Map(),sources=new Map(),envelopes=new Map(),removed=new Set(),deletedEnvelopes=new Set();
  const add=(map,id,value)=>{if(!map.has(id))map.set(id,new Set());map.get(id).add(clipboardKey(value));};
  const row=clip=>{add(timings,clip.id,clipboardTiming(clip));add(lanes,clip.id,laneOf(clip));add(sources,clip.id,clipboardSourceSignature(clip));};
  const env=envelope=>add(envelopes,clipboardEnvelopeKey(envelope),clipboardEnvelopeData(envelope));
  for(const state of states){state.project.clips.forEach(row);state.envelopes.forEach(env);}
  if(entry.rangePlan&&entry.attempts.some(attempt=>attempt.name==='edit_time_range'&&attempt.arguments.dry_run===false&&attempt.status!=='rejected')){const planned=this.rangeTarget(entry.before,entry.rangePlan.ops);planned.project.clips.forEach(row);planned.envelopes.forEach(env);}
  for(const snapshot of Object.values(entry.createdSnapshots)){row(snapshot.clip);snapshot.envelopes.forEach(env);}
  for(const move of entry.acknowledgedMoves??[]){row(move.before);row(move.after);}
  for(const lane of entry.capturedClipboard?.lanes||[])for(const fragment of lane.fragments){row(fragment.source);(fragment.sourceEnvelopes||[]).forEach(env);}
  const operations=entry.attempts.flatMap(attempt=>attempt.arguments.ops??attempt.receipt?.ops??[]).concat(entry.rangePlan?.ops??[]);
  for(const op of operations){if(op.op==='remove')removed.add(op.id);if(op.expected&&['start_ms','duration_sec','audio_offset_sec'].every(key=>op.expected[key]!==undefined))add(timings,op.id,op.expected);if(['update','restore','insert'].includes(op.op)&&['start_ms','duration_sec','audio_offset_sec'].every(key=>op[key]!==undefined))add(timings,op.id,Object.fromEntries(['start_ms','duration_sec','audio_offset_sec'].map(key=>[key,op[key]])));}
  for(const attempt of entry.attempts){const args=attempt.arguments;if(attempt.name==='delete_automation')deletedEnvelopes.add(args.envelope_id);if(attempt.name==='execute_pro_action'&&args.action==='move_clip_to_lane')add(lanes,args.arguments.clip_id,args.arguments.lane_id);}
  for(const written of entry.envelopeWrites){env({...clone(written.before??written.desired),...clone(written.desired),persisted:true});}
  for(const clip of current.project.clips){if(!timings.get(clip.id)?.has(clipboardKey(clipboardTiming(clip)))||!lanes.get(clip.id)?.has(clipboardKey(laneOf(clip)))||!sources.get(clip.id)?.has(clipboardKey(clipboardSourceSignature(clip))))throw new Error('Other timing, source, routing or metadata edits prevent safe clipboard recovery.');}
  const currentIds=new Set(current.project.clips.map(clip=>clip.id));for(const clip of entry.before.project.clips)if(!currentIds.has(clip.id)&&!removed.has(clip.id))throw new Error('An unrelated clip was removed after interruption. Recovery will not restore over that edit.');
  for(const envelope of current.envelopes)if(!envelopes.get(clipboardEnvelopeKey(envelope))?.has(clipboardKey(clipboardEnvelopeData(envelope))))throw new Error('Other automation or point metadata edits prevent safe clipboard recovery.');
  for(const original of entry.before.envelopes){if(!currentIds.has(original.clipId??original.clip_id))continue;if(!current.envelopes.some(row=>clipboardEnvelopeKey(row)===clipboardEnvelopeKey(original))&&!deletedEnvelopes.has(original.id))throw new Error('An unrelated automation envelope was removed. Clipboard recovery will not overwrite it.');}
 }
 renderRecovery(){const entry=[...this.stack(this.receipts)].reverse().find(row=>['uncertain','interrupted','applied-unverified'].includes(row.status));const root=this.w.root;if(!root?.ownerDocument)return;if(!entry){this.banner?.remove();this.banner=null;return;}if(!this.banner){const box=root.ownerDocument.createElement('aside');box.className='au-clipboard-recovery';box.setAttribute('role','status');box.style.cssText='position:absolute;bottom:48px;left:'+(TRACK_GUTTER_PX+5)+'px;z-index:26;padding:8px;background:#fff4d7;color:#17181b;border:1px solid #aaa';box.append(root.ownerDocument.createElement('span'),root.ownerDocument.createElement('button'));root.append(box);this.banner=box;}this.banner.firstElementChild.textContent='Clipboard edit needs recovery: '+(entry.error||entry.status)+' ';this.banner.lastElementChild.textContent='Recover clipboard edit';this.banner.lastElementChild.disabled=!!this.w.busy;this.banner.lastElementChild.onclick=()=>this.recover().catch(error=>this.w.onError(error));}
}
