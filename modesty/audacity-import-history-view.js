import {isIdempotencyInProgress,retainInProgress,captureWriteRequest,replayKnownBusyWrite} from './cloud-errors.js';
import {ImportHistoryController} from './audacity-import-history.js';
import {normalizeCloudProject,assertCompleteCanonicalData} from './cloud-session.js';
import {unwrapRangeEditResult} from './audacity-range-edit.js';
const clone=value=>structuredClone(value);
const scope=w=>w.getProject()?.cloud?.projectId||w.getProject()?.id;
const failure=message=>Object.assign(new Error(message),{name:'AbortError'});
// get_pro_state budgets unrelated capability/history arrays at the root. Only
// the native clip/track containers establish removal; their own completeness
// checks below remain mandatory, including every identity row.
function nativeStateReceipt(raw){
 let data=raw?.structuredContent??raw;
 if(data===raw&&Array.isArray(raw?.content))data=JSON.parse(raw.content.filter(row=>row.type==='text').map(row=>row.text).join('\n'));
 const state=data?.response??data;
 if(raw?.isError||data?.error||data?.ok===false||!state||typeof state!=='object'||Array.isArray(state)||state.error||state.ok===false)throw new Error(typeof state?.error==='string'?state.error:state?.message||'Freestyle rejected the native import removal read.');
 return state;
}
/** Owns a whole external-import command, including its uncertain dispatches.
 * Sources remain server-owned. Restored clips are published without stale
 * native handles, then explicitly attached and verified before Redo settles. */
export class AudacityImportHistory{
 constructor(workspace,{read}={}){
  this.w=workspace;this.batches=new Map();this.provisional=null;this.reconciling=false;
  this.controller=new ImportHistoryController({captureContext:()=>this.context(),assertContext:c=>this.assertContext(c),read:read??(c=>workspace.clipboard.read(c)),write:(name,args,c)=>this.write(name,args,c),publish:(state,options)=>this.publish(state,options),hydrate:(entry,state)=>this.hydrate(entry,state),verifyNativeRemoval:(entry,state,record)=>this.verifyNativeRemoval(entry,state,record),prepareWrite:()=>this.flush(this.context())});
  for(const field of ['past','future','receipts','pending'])this[field]=this.controller[field];
 }
 context(){const e=this.w.engine;return {projectId:scope(this.w),trackId:e.session?.trackId,loadVersion:e.loadVersion||0,contextVersion:e.session?.contextVersion||0};}
 assertContext(c){const e=this.w.engine,n=this.context();if(!e.ready||e.loading||e.session?.closed||e.projectId!==c.projectId||e.session?.projectId!==c.projectId||Object.keys(n).some(key=>!Object.is(n[key],c[key])))throw failure('The project changed during import history. Its retained receipt will not be applied to another editor context.');}
 batch(job){return this.batches.get(job?.batch);}
 owns(job){return !!this.batch(job)&&this.pending.get(this.batch(job).context.projectId)===this.batch(job)||job&&this.provisional?.batch===job.batch;}
 uncertain(id=scope(this.w)){return !!this.provisional||this.controller.uncertain(id);}
 unverified(id=scope(this.w)){return this.controller.unverified(id);}
 clearFuture(id=scope(this.w)){this.controller.clearFuture(id);}
 idle(){const w=this.w,e=w.engine;if(w.busy||e.loading||e.applying||e.interacting||e.playing||e.playAttempt||w.paused||e.recorder?.recording||w.clipGesture||w.selectionGesture?.active||w.envelopeView?.active||w.multiToolView?.active||w.groupMoves?.active||w.trackLayout?.active||w.amplitudeView?.active||w.panGesture||w.loopRegion?.active||w.viewport?.pinDrag)throw new Error('Stop audio and finish the current edit before applying import history.');}
 async flush(c){await this.w.envelopeView?.controller.saveQueue;await this.w.engine.flush();this.assertContext(c);}
 invalidateFuture(id){this.w.ownedHistoryFuture?.get(id)?.splice(0);for(const view of this.w.ownedViews?.()??[])view?.clearFuture?.(id);}
 beforeCreate(job){if(this.provisional&&this.provisional.batch!==job.batch)throw new Error('Verify the pending project creation before another import.');this.provisional??={batch:job.batch,status:'sending',job};}
 async beginBatch(job){
  let entry=this.batch(job);if(entry){this.assertContext(entry.context);return entry;}
  const c=this.context();await this.flush(c);const before=await this.controller.readCurrent(c);
  entry=this.controller.begin({context:c,before,bootstrapLaneIds:job.createdProject?[job.createdLaneId]:[]});this.batches.set(job.batch,entry);
  if(job&&this.provisional?.batch===job.batch){entry.projectCreation=this.provisional;this.provisional=null;}return entry;
 }
 async beforeMutation(job){const entry=await this.beginBatch(job);this.assertContext(entry.context);this.invalidateFuture(entry.context.projectId);job.historyAttempt=this.controller.recordMutation(entry,{name:job.kind==='track'?'create_empty_lane':'upload_audio',arguments:job.kind==='track'?{kind:'audio'}:{filename:job.file.name}});return entry;}
 async resumeJob(job){
  const entry=this.batch(job);if(!entry)return;const current=this.context();if(job.importRecord?.idempotencyInProgress)this.assertContext(entry.context);if(current.projectId!==entry.context.projectId)throw failure('Return to the imported project before recovering its saved audio.');
  this.assertContext(current);entry.context=current;job.result??={};job.result.clipId??=job.importRecord?.clipId;
  // Rebind scope only. Canonical capture follows saved-audio reconciliation,
  // which can resolve a legacy missing ACK identity and verify native readiness.
  return entry;
 }
 async captureJob(job){
  const entry=this.batch(job);if(!entry)throw new Error('The import command has no retained history capture.');
  this.assertContext(entry.context);const after=await this.controller.readCurrent(entry.context),known=new Set(entry.initial.project.lanes.map(row=>row.id));
  const clipIds=job.result?.clipId?[job.result.clipId]:[],laneId=job.kind==='track'?job.result?.laneId:after.project.clips.find(row=>row.id===job.result?.clipId)?.laneId;
  if(!laneId||known.has(laneId)&&!entry.laneIds.includes(laneId))throw new Error('The import did not identify its own newly added audio lane.');const laneIds=[laneId];
  this.controller.captureStep(entry,{after,laneIds,clipIds});if(job.historyAttempt){job.historyAttempt.status='acknowledged';job.historyAttempt.rawReceipt=clone(job.result);}
  return entry;
 }
 finishBatch(job){const entry=this.batch(job);if(!entry)return;const result=this.controller.complete(entry);if(result.added)this.w.recordOwnedHistory?.('import',entry.context.projectId);const partial=this.w.importView?.records.some(row=>row.batch===job.batch&&row.historyNotDispatched);this.w.engine.onStatus?.(entry.clipIds.length?partial?'Imported available files; Undo owns the successful audio.':'Audio import completed; Undo owns this complete file batch.':'Audio track added.');return result;}
 async interrupt(job,error){
  const entry=this.batch(job);if(entry){
   const attempt=job.historyAttempt,record=error.importRecord??job.importRecord;
   if(attempt){attempt.error=error.message;attempt.status=record?.phase==='saved-unverified'?'acknowledged':record?.phase==='failed'?'rejected':'uncertain';attempt.importRecord=record;attempt.trackAttempt=error.trackAttempt;attempt.trackReceipt=error.trackReceipt;}
   // The import engine explicitly records whether upload_audio was dispatched.
   // A local file-read failure must not permanently block every subsequent edit.
   // If earlier files or a new-project lane already exist, retain that ownership
   // and verify its exact checkpoint before continuing the remaining files.
   if(attempt&&record?.phase==='failed'&&record.dispatched!==true&&record.acknowledged!==true){
    try{
     if(entry.laneIds.length||entry.steps.length||entry.after){const after=await this.controller.readCurrent(entry.context);this.controller.captureStep(entry,{after});}
     else{this.controller.abandonUnsent(entry,{attempt,importRecord:record});this.batches.delete(job.batch);}
     job.historyNotDispatched=true;return;
    }catch(verificationError){this.controller.interrupt(entry,verificationError);return;}
   }
   this.controller.interrupt(entry,error,{status:record?.phase==='saved-unverified'?'unverified':undefined});
  }else if(job&&this.provisional?.batch===job.batch){this.provisional.status='uncertain';this.provisional.error=error.message;}
 }
 async write(name,args,c){this.assertContext(c);const raw=await this.w.engine.session.call(name,args);this.assertContext(c);return raw;}
 invalidateRuntime(entry){
  const s=this.w.engine.session,state=clone(s.rawState??{}),owned=new Set([...entry.clipIds,...entry.laneIds]);
  const retained=row=>![row?.db_clip_id,row?.db_track_id,row?.clipId,row?.laneId].some(id=>owned.has(id));
  for(const field of ['clips','tracks']){if(Array.isArray(state[field]))state[field]=state[field].filter(retained);else if(Array.isArray(state[field]?.[field]))state[field][field]=state[field][field].filter(retained);}
  return state;
 }
 async publish(state,{entry}){
  this.assertContext(entry.context);const e=this.w.engine,s=e.session,raw=this.invalidateRuntime(entry);raw.patternPlacements={placements:clone(state.placements)};
  const project=normalizeCloudProject(clone(state.project),raw,{projectId:entry.context.projectId,trackId:entry.context.trackId});s.rawProject=clone(state.project);s.rawState=raw;s.project=project;e.accept(project);
  this.w.selectedTracks=new Set();this.w.selectedClip=null;this.w.focusedTrack=0;this.w.render?.();
 }
 async verifyNativeRemoval(entry,state,record){
  const e=this.w.engine,s=e.session,c=entry.context;
  this.assertContext(c);
  const raw=await this.write('get_pro_state',{project_id:c.projectId,track_id:s.clockContextTrackId?.()||c.trackId},c),native=nativeStateReceipt(raw);
  record.nativeRemovalReadback=clone(native);
  if(native.session?.projectId!=null&&native.session.projectId!==c.projectId)throw new Error('The native import removal read belongs to another project.');
  const rows=(field)=>{const container=native[field];assertCompleteCanonicalData(container,'native import '+field);const values=Array.isArray(container)?container:container?.[field];if(!Array.isArray(values)||container?.ok===false||container?.error)throw new Error('Complete native '+field+' are required to verify the imported lane was removed.');return values;};
  const owned=new Set([...entry.laneIds,...entry.clipIds]),clips=rows('clips'),tracks=rows('tracks');
  const foreign=row=>['projectId','project_id'].some(field=>row?.[field]!=null&&row[field]!==c.projectId);
  const identities=row=>[row?.db_clip_id,row?.db_track_id,row?.clipId,row?.laneId].filter(value=>typeof value==='string'&&value);
  if(clips.some(row=>!foreign(row)&&(!identities(row).length||identities(row).some(id=>owned.has(id))))||tracks.some(row=>!foreign(row)&&identities(row).some(id=>owned.has(id))))throw new Error('The archived import is still present or unresolved in the native engine. Verify its retained receipt before playback.');
  this.assertContext(c);s.rawProject=clone(state.project);s.rawState=clone(native);s.project=normalizeCloudProject(s.rawProject,s.rawState,{projectId:c.projectId,trackId:c.trackId});e.accept(s.project);return true;
 }
 async hydrate(entry){
  const w=this.w,e=w.engine,c=entry.context,record=entry.operations.at(-1);record.hydration??=[];
  for(const id of entry.clipIds){
   this.assertContext(c);let attempt=record.hydration.find(item=>item.clipId===id);
   if(!attempt){
    if(this.reconciling&&!record.recoveringHydration)throw new Error('The restored import needs an explicit live attachment. Verification does not retry mutations.');
    attempt={clipId:id,status:'sending',request:captureWriteRequest('execute_pro_action',{project_id:c.projectId,track_id:c.trackId,action:'attach_clip_to_session',arguments:{db_track_id:id}})};record.hydration.push(attempt);
    try{attempt.raw=clone(await this.write(attempt.request.name,clone(attempt.request.arguments),c));unwrapRangeEditResult(attempt.raw);attempt.status='acknowledged';}
    catch(error){if(!isIdempotencyInProgress(error)&&Number(error.status)===409){attempt.status='already-loaded';attempt.error=error.message;}else{retainInProgress(record,error);retainInProgress(attempt,error);attempt.status='uncertain';attempt.error=error.message;throw error;}}
   }
  }
  await e.refresh();this.assertContext(c);
  for(const id of entry.clipIds){const matches=e.project.audioClips.filter(clip=>(clip.cloudId||clip.id)===id);if(matches.length!==1||matches[0].engineLoaded!==true)throw new Error('The restored import is saved but its live audio is not verified. Its receipts remain pending.');}
  await w.envelopeView?.reload();
 }
 can(direction){try{this.idle();return !this.provisional&&this.controller.can(direction);}catch{return false;}}
 async lock(action){this.idle();const w=this.w,body=w.root?.ownerDocument?.body;w.busy=true;body?.classList.add('au-cloud-busy');try{return await action();}finally{w.busy=false;body?.classList.remove('au-cloud-busy');w.lanePan?.sync?.();}}
 async history(direction){if(this.provisional)throw new Error('Verify the pending project creation before applying history.');return this.lock(async()=>{const result=await this.controller.history(direction);if(result)this.w.engine.onStatus?.('Audio import '+(direction==='undo'?'undone.':'redone.'));return result;});}
 async reconcile(){const pending=this.pending.get(scope(this.w));if(pending?.kind==='import'){const job=this.w.importView?.records.find(row=>row.batch&&this.batch(row)===pending&&(row.trackAttempt||row.error?.trackAttempt||row.importRecord));if(job){if(job.kind==='track')return this.w.importView.reconcileTrack(job);return this.w.importView.reconcileSaved(job.id,{retryAttach:true});}}if(this.provisional)throw new Error('Project creation has an uncertain receipt. Inspect the retained import before another edit.');return this.lock(async()=>{this.reconciling=true;try{const pending=this.pending.get(scope(this.w));if(pending?.kind==='history'&&pending.hydration?.some(row=>row.idempotencyInProgress)){for(const attempt of pending.hydration.filter(row=>row.idempotencyInProgress)){const {raw}=await replayKnownBusyWrite({knownBusy:true,request:attempt.request,call:(name,args)=>this.write(name,args,pending.entry.context),assertCurrent:()=>this.assertContext(pending.entry.context),parse:unwrapRangeEditResult});attempt.raw=clone(raw);attempt.status='acknowledged';attempt.idempotencyInProgress=false;}pending.idempotencyInProgress=pending.attempts.some(row=>row.idempotencyInProgress);pending.recoveringHydration=true;}const result=await this.controller.reconcile({beforeFinish:record=>this.w.ownedHistoryReconciled?.('import',record)});if(result.registered)this.w.recordOwnedHistory?.('import',result.record.context.projectId);this.w.engine.onStatus?.('The saved import history is verified.');return result;}finally{this.reconciling=false;}});}
}
