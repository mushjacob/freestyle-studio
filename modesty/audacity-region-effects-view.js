import {isIdempotencyInProgress,retainInProgress,definiteCloudRejection} from './cloud-errors.js';
import {audioAttachArguments} from './cloud-audio-import.js';
import {assertCompleteCanonicalData} from './cloud-session.js';
import {AudacityRangeEdits} from './audacity-range-view.js';
import {RangeEditController,createFreestyleRangeAdapters,rangeEditCheckpoint,assertRangeAppliedState,unwrapRangeEditResult} from './audacity-range-edit.js';
import {withEngineRetry,callWithEngineRetry,engineNeedsReconcile,requestEngineReconcile} from './audacity-edit-queue.js';
import {normalizeRegionEffectCatalog,regionEffectParameters,regionEffectArguments,observeRegionEffect,regionPreviewUrl,regionEffectRedoOperations} from './audacity-region-effects.js';
const clone=value=>structuredClone(value),key=value=>JSON.stringify(value),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceRecordKey=value=>JSON.stringify((function stable(input,top=false){if(Array.isArray(input))return input.map(item=>stable(item));if(input&&typeof input==='object')return Object.fromEntries(Object.keys(input).sort().filter(field=>!top||!['createdAt','created_at','updatedAt','updated_at'].includes(field)).map(field=>[field,stable(input[field])]));return input;})(value,true));
const clipSourceKey=clip=>sourceRecordKey(Object.fromEntries(Object.entries(clip).filter(([field])=>!['startMs','start_ms','durationSec','duration_sec','audioOffsetSec','audio_offset_sec'].includes(field))));
const parameterLabel=(name,schema)=>{const suffix={db:['_db'],dbfs:['_db'],hz:['_hz'],ms:['_ms'],sec:['_sec'],s:['_sec'],'%':['_pct']}[String(schema.unit??'').toLowerCase()]??[];let label=name;for(const ending of suffix)if(label.endsWith(ending)){label=label.slice(0,-ending.length);break;}return label.split('_').map(part=>part.toLowerCase()==='dc'?'DC':part.charAt(0).toUpperCase()+part.slice(1)).join(' ');};
const scope=w=>w.getProject()?.cloud?.projectId||w.getProject()?.id;
/** 339: success is engine_swapped:true / engine_status 'swapped'. This catches only an old-style answer that saved a version the engine never loaded. */
const field=(error,name)=>error?.[name]??error?.details?.[name]??error?.result?.[name]??error?.result?.details?.[name]??error?.result?.error?.[name];
const timelineConflict=error=>Number(error?.status??error?.result?.status)===412&&(error?.code??error?.result?.code??error?.result?.error?.code)==='timeline_revision_conflict';
const swapFailure=error=>(error?.code??error?.result?.code??error?.result?.error?.code)==='engine_swap_failed';
const rolledBackOf=error=>error?.typedError?.rolledBack??error?.result?.typedError?.rolledBack??field(error,'rolledBack')??field(error,'rolled_back');
const swapRolledBack=error=>swapFailure(error)&&rolledBackOf(error)===true;
/* rolled_back:false (or unknown): the new version stayed bound but the engine has not loaded it */
const swapStuck=error=>swapFailure(error)&&rolledBackOf(error)!==true;
const inPlaceNotLive=p=>p.engine_swap_failed!==true&&p.engine_swapped===false||p.engine_reload_required===true||(p.engine_status!==undefined&&p.engine_status!==null&&!['ok','swapped','done','loaded'].includes(p.engine_status));
/** Selected-region processors share the range transaction's exact inverse
 * history harness. Its internal selection marker never becomes a Delete call:
 * sendEdit is exclusively apply_effect_to_region/get_region_effect_job. */
export class AudacityRegionEffects extends AudacityRangeEdits{
 constructor(workspace){super(workspace);this.catalog=null;this.catalogPromise=null;this.dialog=null;this.pollLimit=60;}
 async lock(action){if(this.w.pencil?.active)throw new Error('Finish the active sample drawing before region effect history or verification.');return super.lock(action);}
 clearFuture(id=scope(this.w)){this.stack(this.future,id).length=0;}
 async loadCatalog(){if(this.catalog)return this.catalog;if(this.catalogPromise)return this.catalogPromise;this.catalogPromise=(async()=>{const raw=await this.w.engine.session.call('list_region_effects',{});return this.catalog=normalizeRegionEffectCatalog(raw);})();try{return await this.catalogPromise;}finally{this.catalogPromise=null;}}
 captureSelection(){
  const w=this.w,e=w.engine;if(w.regionEffectsSupported===false)throw new Error('Refresh the connected Freestyle region effect tools before processing audio.');w.assertOwnedEditsSettled?.();if(w.busy||!e.ready||e.loading||e.playing||e.playAttempt||w.paused||e.applying||e.interacting||e.recorder?.recording||w.clipGesture||w.selectionGesture?.active||w.envelopeView?.active||w.trackLayout?.active||w.amplitudeView?.active||w.multiToolView?.active||w.loopRegion?.active||w.groupMoves?.active||w.pencil?.active||w.panGesture||w.viewport?.pinDrag)throw new Error('Stop audio and finish the current edit before processing a selected region.');
  const indexes=[...w.selectedTracks],track=indexes.length===1?w.tracks.find(t=>t.index===indexes[0]):null,{start,end}=w.selection;
  if(!track?.laneId||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)throw new Error('Select a nonempty region in one audio track.');
  const overlaps=track.clips.filter(c=>w.seconds(c.start)<end&&w.seconds(c.start+c.length)>start);
  if(overlaps.length!==1||overlaps[0].patternId||!overlaps[0].cloudId)throw new Error('Select a region inside one persisted audio clip.');
  const clip=overlaps[0];if(clip.engineLoaded===false||clip.laneId!==track.laneId||start<w.seconds(clip.start)||end>w.seconds(clip.start+clip.length))throw new Error('Select a region wholly inside one loaded audio clip.');
  return {context:this.captureContext(),clipId:clip.cloudId,sourceRecord:clone(clip.cloudRaw??null),laneId:track.laneId,startSec:start,endSec:end,checkpoint:key(rangeEditCheckpoint(w.getProject()))};
 }
 assertSelection(c){this.assertContext(c.context);if(c.checkpoint!==key(rangeEditCheckpoint(this.w.getProject()))||this.w.selection.start!==c.startSec||this.w.selection.end!==c.endSec||this.w.selectedTracks.size!==1||!this.w.tracks.some(t=>this.w.selectedTracks.has(t.index)&&t.laneId===c.laneId))throw new Error('The selection or cloud audio changed. Reopen the region effect before applying it.');}
 async assertFreshSource(capture){
  try{const raw=unwrapRangeEditResult(await this.call(capture.context,'get_project',{project_id:capture.context.projectId})),project=raw.project??raw;assertCompleteCanonicalData(project,'region effect source preflight');if(project.id!==capture.context.projectId||!Array.isArray(project.clips))throw new Error('A complete current cloud source is required before processing the selection.');const matches=project.clips.filter(clip=>clip.id===capture.clipId);if(matches.length!==1||!capture.sourceRecord||sourceRecordKey(matches[0])!==sourceRecordKey(capture.sourceRecord))throw new Error('The selected audio source changed in the cloud. Refresh the project before applying this effect.');this.assertSelection(capture);}
  catch(error){error.definiteRejection=true;error.readOnlyVerification=true;error.writeDispatched=false;throw error;}
 }
 /** Freestyle 338: Audacity keeps ONE clip. mode in_place writes a new source version of the same
  * clip (Pencil-like; Undo = sample-edits:undo). A definite in-place refusal falls back to the split
  * path with a new key; a split-shaped answer (an older bridge dropped `mode`) replays the SAME key
  * through the split path, so nothing renders twice. */
 /** Effect > Repeat Last Effect (⌘R): the last applied effect, with the same settings, on the current selection. */
 repeatLast(){if(!this.last)throw new Error('Apply an effect first.');return this.effect(this.last.effectId,this.last.values,{capture:this.captureSelection(),allowClipping:this.last.allowClipping});}
 async effect(effectId,values={},options={}){
  this.last={effectId,values:{...values},allowClipping:options.allowClipping};
  if(this.inPlaceMode!==false&&!options.split){const result=await this.effectInPlace(effectId,values,options);if(!result.fallback)return result;options={...options,capture:result.capture,split:true,...(result.replayKey?{idempotencyKey:result.replayKey,replay:true}:{})};}
  return this.effectSplit(effectId,values,options);
 }
 inPlaceRefused(error){return definiteCloudRejection(error)&&['source_too_long_for_in_place','in_place_unsupported_source','invalid_mode'].includes(error?.code??error?.result?.code)||Number(error?.status)===413;}
 async effectInPlace(effectId,values={},options={}){
  const capture=options.capture??this.captureSelection(),catalog=await this.loadCatalog(),effect=catalog.effects.find(item=>item.id===effectId);if(!effect)throw new Error('Choose an effect from the current Freestyle catalog.');
  this.assertSelection(capture);if(capture.endSec-capture.startSec>catalog.limits.max_region_sec)throw new Error('Select at most '+catalog.limits.max_region_sec+' seconds for a region effect.');
  const w=this.w,c=capture.context,params=regionEffectParameters(effect,values),key=globalThis.crypto.randomUUID(),clip=(w.getProject().audioClips??[]).find(row=>(row.cloudId||row.id)===capture.clipId),beforeRevision=w.waveformView?.metadata?.(clip)?.revision??null;
  const args={...regionEffectArguments({projectId:c.projectId,clipId:capture.clipId,startSec:capture.startSec,endSec:capture.endSec,effect:effectId,params,crossfadeMs:options.crossfadeMs??0,allowClipping:options.allowClipping??false,idempotencyKey:key}),mode:'in_place'};
  return this.lock(async()=>{
   w.engine.onStatus?.('Applying '+effect.label+'…');let payload;
   try{payload=await this.renderInPlaceOrRetry(c,args,beforeRevision,effect.label);}catch(error){if(error.swapStuck)throw this.holdUnloaded({context:c,label:effect.label,effectId,clipId:capture.clipId,startSec:capture.startSec,endSec:capture.endSec,revision:error.revision??null,previousRevision:beforeRevision},error);if(this.inPlaceRefused(error))return {fallback:true,capture};if(!definiteCloudRejection(error)&&!error.swapFailed)this.inPlacePending={context:c,args,beforeRevision,label:effect.label,capture,effectId,params,allowClipping:args.allow_clipping,crossfadeMs:args.crossfade_ms};throw error;}
   if(payload.mode!=='in_place'||typeof payload.revision!=='string')return {fallback:true,capture,replayKey:key};
   if(inPlaceNotLive(payload)){/* defensive (pre-339 answer): saved but not swapped (silent, source_busy) — release it and render this one effect via split; later effects still try in place */w.engine.onStatus?.('Applying '+effect.label+'…');const orphan={kind:'in-place',orphan:true,context:c,label:effect.label,effectId,clipId:capture.clipId,startSec:capture.startSec,endSec:capture.endSec,revision:payload.undo?.expected_revision??payload.revision,previousRevision:payload.undo?.restores_revision??payload.previous_revision??null};
    try{await this.releaseInPlace(orphan);}catch(error){this.inPlaceOrphan=orphan;this.stack(this.past,c.projectId).push(orphan);this.clearFuture(c.projectId);w.recordOwnedHistory?.('region',c.projectId);const message='Freestyle saved '+effect.label+' without loading it, and releasing that unused version failed. Press ⌘Z to retry before editing this clip. ('+(error?.message??error)+')';w.engine.onStatus?.(message);throw Object.assign(new Error(message),{cause:error,inPlaceOrphan:true});}
    return {fallback:true,capture};}
   return this.registerInPlace({context:c,label:effect.label,effectId,params,allowClipping:args.allow_clipping,crossfadeMs:args.crossfade_ms,capture},payload);
  },effect.label);
 }
 /** 339: engine_swap_failed + rolled_back:true saved nothing — retry once in place with a NEW key
  * per the 339 spec with the SAME key, then a clear definite error. Never split. rolled_back:false
  * (the version stayed bound) is not retried: the caller records it as uncertain, reload needed. */
 async renderInPlaceOrRetry(c,args,beforeRevision,label){
  const stuck=error=>{if(swapStuck(error))throw Object.assign(error,{swapStuck:true});};
  try{return await this.renderInPlace(c,args,beforeRevision);}catch(error){stuck(error);if(!swapRolledBack(error))throw error;}
  this.w.engine.onStatus?.('Applying '+label+'…');
  try{return await this.renderInPlace(c,args,beforeRevision);}catch(error){stuck(error);if(!swapRolledBack(error))throw error;const reason=field(error,'engineReason'),message='Freestyle could not load the processed audio for '+label+' into the engine, so nothing was changed. Try again.'+(reason?' (engine: '+reason+')':'');this.w.engine.onStatus?.(message);throw Object.assign(new Error(message),{cause:error,definiteRejection:true,swapFailed:true,status:error.status,code:'engine_swap_failed'});}
 }
 async renderInPlace(c,args,beforeRevision){
  /* sample-edits:undo bumps the timeline revision without reporting it, so the bridge's cached If-Match
   * goes stale: send a fresh one. A 412 timeline_revision_conflict applied nothing — re-read once and
   * retry with the same key; a second conflict is a friendly definite error, never the raw 412. */
  const send=async ifMatch=>unwrapRangeEditResult(await this.call(c,'apply_effect_to_region',{...args,wait_sec:20,...(ifMatch?{if_match:ifMatch}:{})},{beforeRevision}));
  let data;
  try{data=await send(await this.timelineIfMatch(c));}catch(error){if(!timelineConflict(error))throw error;
   const fresh=await this.readTimelineRevision(c);
   try{data=await send(fresh);}catch(again){if(!timelineConflict(again))throw again;const message='The project changed; try again.';this.w.engine.onStatus?.(message);throw Object.assign(new Error(message),{cause:again,definiteRejection:true,status:412,code:'timeline_revision_conflict'});}}
  for(let count=0;['queued','running'].includes(data.status);count++){this.progress(data);if(typeof data.job_id!=='string'||count>=this.pollLimit)throw new Error('The region render is still running. Check its retained job to continue.');data=unwrapRangeEditResult(await this.call(c,'get_region_effect_job',{project_id:c.projectId,track_id:args.clip_id,job_id:data.job_id,wait_sec:20}));}
  if(data.status==='failed'){const swap=data.code==='engine_swap_failed',rolledBack=rolledBackOf(data);throw Object.assign(new Error(data.error?.message||data.error||data.message||'The selected-region effect failed.'),{definiteRejection:!swap||rolledBack===true,code:data.code,typedError:data.typedError,rolledBack,revision:data.revision??null,details:data.details});}
  return data.status==='done'&&data.result?unwrapRangeEditResult(data.result):data;
 }
 registerInPlace(base,payload){
  const w=this.w,c=base.context,capture=base.capture,entry={kind:'in-place',...base,clipId:capture.clipId,startSec:capture.startSec,endSec:capture.endSec,revision:payload.revision,previousRevision:payload.previous_revision??null,undo:clone(payload.undo??null),selectionBefore:{start:capture.startSec,end:capture.endSec},selectionAfter:{start:capture.startSec,end:capture.endSec},registered:true};
  this.inPlacePending=null;this.stack(this.past,c.projectId).push(entry);this.clearFuture(c.projectId);w.recordOwnedHistory?.('region',c.projectId);
  if(engineNeedsReconcile(payload))requestEngineReconcile(w,{reason:'region-in-place'});
  w.waveformView?.refreshSource?.(capture.clipId,{revision:payload.revision});try{w.selection={start:capture.startSec,end:capture.endSec};w.paintSelection?.();}catch{}
  w.engine.onStatus?.(base.label+' applied.');return {record:{status:'applied',applied:'edit',receipt:{payload:clone(payload)}},entry};
 }
 /** Swap failed with rolled_back:false: the processed version is bound but not loaded. Keep an
  * uncertain record; ⌘Z (or Verify) releases it via sample-edits:undo when its revision is known,
  * otherwise Verify asks Freestyle to reload the engine session. */
 holdUnloaded(entry,error){
  const w=this.w,c=entry.context;Object.assign(entry,{kind:'in-place',orphan:true,unloaded:true});this.inPlaceOrphan=entry;
  if(entry.revision){this.stack(this.past,c.projectId).push(entry);this.clearFuture(c.projectId);w.recordOwnedHistory?.('region',c.projectId);}
  const message='Freestyle saved '+entry.label+' but its engine has not loaded it — reload needed. '+(entry.revision?'Press ⌘Z to release it, or use':'Use')+' Tools → Verify last audio edit before editing this clip.';
  w.engine.onStatus?.(message);return Object.assign(new Error(message),{cause:error,inPlaceOrphan:true,code:'engine_swap_failed',rolledBack:false});
 }
 async releaseInPlace(entry){const receipt=unwrapRangeEditResult(await this.call(entry.context,'undo_clip_sample_edit',{project_id:entry.context.projectId,track_id:entry.clipId,clip_id:entry.clipId,expected_revision:entry.revision,idempotency_key:entry.releaseKey??=globalThis.crypto.randomUUID()}));this.adoptUndoTimeline(entry.context,receipt);return receipt;}
 /** After sample-edits:undo: adopt its timelineRevision when reported, else mark the guard stale so the
  * next in-place render reads the project once first. */
 adoptUndoTimeline(c,receipt){const revision=receipt?.timelineRevision??receipt?.timeline_revision;if(typeof revision==='string'&&revision){try{this.w.engine.session.rawProject.timelineRevision=revision;}catch{}this.timelineGuard={projectId:c.projectId,revision};}else this.timelineGuard={projectId:c.projectId,stale:true};}
 async timelineIfMatch(c){const guard=this.timelineGuard;if(!guard||guard.projectId!==c.projectId)return undefined;this.timelineGuard=null;
  if(guard.revision)return this.w.engine.session?.rawProject?.timelineRevision===guard.revision?guard.revision:undefined;/* a later write already moved it */
  return this.readTimelineRevision(c);}
 async readTimelineRevision(c){const raw=await this.call(c,'get_project',{project_id:c.projectId}),data=raw?.structuredContent??raw,project=data?.project??data,revision=project?.timelineRevision??project?.timeline_revision;if(typeof revision!=='string'||!revision)return undefined;try{this.w.engine.session.rawProject.timelineRevision=revision;}catch{}return revision;}
 async history(direction){
  const orphan=this.inPlaceOrphan;if(orphan&&direction==='undo'&&this.stack(this.past,scope(this.w)).at(-1)===orphan)return this.lock(async()=>{this.assertContext(orphan.context);await this.releaseInPlace(orphan);/* the same key: a lost answer replays */this.stack(this.past,orphan.context.projectId).pop();this.inPlaceOrphan=null;this.w.waveformView?.refreshSource?.(orphan.clipId,{revision:orphan.previousRevision??undefined});this.w.engine.onStatus?.('Released the unapplied '+orphan.label+'. Nothing else changed.');return true;},'Release '+orphan.label);
  const id=scope(this.w),from=direction==='undo'?this.past:this.future,to=direction==='undo'?this.future:this.past,entry=this.stack(from,id).at(-1);if(entry?.kind!=='in-place')return super.history(direction);
  return this.lock(async()=>{
   const w=this.w,c=entry.context;this.assertContext(c);
   if(direction==='undo'){const raw=await this.call(c,'undo_clip_sample_edit',{project_id:c.projectId,track_id:entry.clipId,clip_id:entry.clipId,expected_revision:entry.revision,idempotency_key:globalThis.crypto.randomUUID()}),receipt=unwrapRangeEditResult(raw);this.adoptUndoTimeline(c,receipt);entry.restoredRevision=typeof receipt.revision==='string'?receipt.revision:entry.previousRevision;w.waveformView?.refreshSource?.(entry.clipId,{revision:entry.restoredRevision});}
   else{const args={...regionEffectArguments({projectId:c.projectId,clipId:entry.clipId,startSec:entry.startSec,endSec:entry.endSec,effect:entry.effectId,params:entry.params,crossfadeMs:entry.crossfadeMs??0,allowClipping:entry.allowClipping??false,idempotencyKey:globalThis.crypto.randomUUID()}),mode:'in_place'},payload=await this.renderInPlaceOrRetry(c,args,entry.restoredRevision??null,entry.label);if(typeof payload.revision!=='string')throw new Error('Freestyle did not confirm the redone effect as a new source version.');entry.previousRevision=payload.previous_revision??entry.restoredRevision;entry.revision=payload.revision;w.waveformView?.refreshSource?.(entry.clipId,{revision:payload.revision});}
   this.stack(from,id).pop();this.stack(to,id).push(entry);try{w.selection={start:entry.startSec,end:entry.endSec};w.paintSelection?.();}catch{}w.engine.onStatus?.((direction==='undo'?'Undid ':'Redid ')+entry.label+'.');return true;
  },(direction==='undo'?'Undo ':'Redo ')+entry.label);
 }
 async effectSplit(effectId,values={},options={}){
  const capture=options.capture??this.captureSelection(),catalog=await this.loadCatalog(),effect=catalog.effects.find(item=>item.id===effectId);if(!effect)throw new Error('Choose an effect from the current Freestyle catalog.');
  this.assertSelection(capture);if(capture.endSec-capture.startSec>catalog.limits.max_region_sec)throw new Error('Select at most '+catalog.limits.max_region_sec+' seconds for a region effect.');const params=regionEffectParameters(effect,values),w=this.w,c=capture.context;
  return this.lock(async()=>{
   const entry={context:c,sourceRecord:clone(capture.sourceRecord),laneId:capture.laneId,request:{projectId:c.projectId,clipId:capture.clipId,effect:effectId,params,startSec:capture.startSec,endSec:capture.endSec,idempotencyKey:options.idempotencyKey??globalThis.crypto.randomUUID()},selectionBefore:{start:capture.startSec,end:capture.endSec},selectionAfter:{start:capture.startSec,end:capture.endSec},checkpoint:null,responses:[],registered:false};
   entry.arguments=regionEffectArguments({...entry.request,crossfadeMs:options.crossfadeMs??0,allowClipping:options.allowClipping??false});
   const adapters=createFreestyleRangeAdapters({cloudCall:withEngineRetry(w,(name,args)=>{this.assertContext(c);return w.engine.session.call(name,args);}),getTrackId:()=>c.trackId});
   const controller=entry.controller=new RangeEditController({getProject:()=>w.getProject(),flush:async()=>{await w.envelopeView?.controller.saveQueue;await w.engine.flush();this.assertContext(c);},getCheckpoint:rangeEditCheckpoint,sendBatch:request=>this.sendHistoryBatch(entry,adapters,request),sendEdit:async()=>{if(!options.replay)await this.assertFreshSource(capture);/* a same-key replay answers the already committed render */const receipt=await observeRegionEffect(entry,(name,args)=>this.call(c,name,args),{maxPolls:this.pollLimit,onProgress:data=>this.progress(data)});entry.effectReceipt=clone(receipt);return receipt;},refresh:async applied=>{await this.refreshApplied(entry,applied);return {historyCheckpointVerified:true};},isInteracting:()=>!!w.engine.interacting});
   controller.prepare({operation:'delete',selection:{startSec:capture.startSec,endSec:capture.endSec},laneIds:[capture.laneId]});
   // Use one retained identity both in the generic inverse harness and native job.
   controller.record.request.idempotencyKey=entry.request.idempotencyKey;
   this.stack(this.receipts,c.projectId).push(controller);controller.regionEntry=entry;this.pending.set(c.projectId,controller);
   entry.label=effect.label;
   try{w.engine.onStatus?.('Applying '+effect.label+'…');const result=await controller.apply();this.register(entry);this.enableAckHistory(entry,controller);this.reportResult(entry,result);try{w.selection={start:capture.startSec,end:capture.endSec};w.paintSelection?.();}catch{}return result;}
   finally{if(controller.record.status!=='uncertain')this.pending.delete(c.projectId);}
  });
 }
 async sendHistoryBatch(entry,adapters,request){
  let next=null;try{if(entry.effectReceipt){const forward=regionEffectRedoOperations(entry.effectReceipt),inverse=entry.effectReceipt.inverseOps;next=request.reason==='undo'&&sourceRecordKey(request.operations)===sourceRecordKey(inverse)?forward:request.reason==='redo'&&sourceRecordKey(request.operations)===sourceRecordKey(forward)?inverse:null;}}catch{/* A missing retained plan disables the fallback; an acknowledged batch remains usable. */}
  const receipt=await adapters.sendBatch(request);if(receipt.inverseOps!==null||!next)return receipt;
  // apply_clip_batch does not currently return inverses. These are exact
  // plans already owned by this native effect, guarded by before/after reads.
  return {...receipt,inverseOps:clone(next),historyUnavailableReason:null,derivedInverse:true};
 }
 async call(c,name,args,retry={}){this.assertContext(c);try{const raw=['apply_effect_to_region','undo_clip_sample_edit'].includes(name)?await callWithEngineRetry(this.w,(n,a)=>this.w.engine.session.call(n,a),name,args,retry):await this.w.engine.session.call(name,args);this.assertContext(c);return raw;}catch(error){if(['get_project','get_region_effect_job','list_pro_capabilities'].includes(name))error.readOnlyVerification=true;throw error;}}
 progress(data){const message=['queued','running'].includes(data.status)?'Rendering selected-region effect'+(data.step?' — '+data.step:'')+'…':'Verifying selected-region audio…';this.w.engine.onStatus?.(message);if(this.dialog?.isConnected)this.dialog.querySelector('.au-region-state').textContent=message;}
 register(entry){if(entry.registered)return;this.stack(this.past,entry.context.projectId).push(entry);this.clearFuture(entry.context.projectId);entry.registered=true;this.w.recordOwnedHistory?.('region',entry.context.projectId);}
 /** An atomic restore can persist children without loading their media. Load
  * only explicit insert/restore participants from the owned native receipt.
  * Reconciliation reuses an unresolved attachment's original key/arguments;
  * acknowledged loads are not sent again and never stand in for native proof. */
 async attachRegionChildren(entry,applied){
  const c=entry.context,payload=applied.receipt.payload,operations=applied.request.operations??payload.ops??[];
  if(payload.engine_reload_required!==true)return [];
  const children=operations.filter(op=>['insert','restore'].includes(op.op));if(!children.length)return [];
  const original=entry.effectReceipt?.payload??payload,known=new Set([entry.request.clipId,...(original.ops??[]).map(op=>op.id),...(original.undo?.inverse_ops??entry.effectReceipt?.inverseOps??[]).map(op=>op.id)]),lane=entry.laneId??original.region?.lane_id??original.region?.laneId;
  if(!lane||children.some(op=>!known.has(op.id))||typeof applied.request.idempotencyKey!=='string'||!applied.request.idempotencyKey)throw new Error('Only owned region replacement identities and a retained history key may be attached.');
  this.assertContext(c);const capability=await this.call(c,'list_pro_capabilities',{action:'attach_clip_to_session'});this.assertContext(c);const response=unwrapRangeEditResult(await this.call(c,'get_project',{project_id:c.projectId})),project=response.project??response;assertCompleteCanonicalData(project,'region attachment checkpoint');
  if(project.id!==c.projectId||!Array.isArray(project.clips))throw new Error('A complete current canonical project is required before attaching region audio.');
  assertRangeAppliedState(project.clips,{operations,clipsAfter:payload.clips_after??[],inverseOps:applied.receipt.inverseOps??[]});
  entry.regionClipSnapshots??={};
  const rows=children.map(op=>{const matches=project.clips.filter(row=>row.id===op.id),row=matches[0],previous=entry.regionClipSnapshots[op.id]??(op.id===entry.request.clipId?entry.sourceRecord:null);
   if(matches.length!==1||row.laneId!==lane||['projectId','project_id'].some(field=>row[field]!==undefined&&row[field]!==c.projectId)||previous&&clipSourceKey(previous)!==clipSourceKey(row))throw new Error('The owned region child source, lane or metadata changed before attachment.');return row;});
  // Check every child before the first load; retain source snapshots across a
  // failed load so Verify cannot silently adopt an unrelated replacement.
  for(const row of rows)entry.regionClipSnapshots[row.id]=clone(row);
  this.assertContext(c);
  entry.regionAttachments??=[];const active=[];
  for(const row of rows){
   let attempt=entry.regionAttachments.find(item=>item.parentKey===applied.request.idempotencyKey&&item.clipId===row.id);
   if(!attempt){const args=audioAttachArguments(capability,{projectId:c.projectId,clip:row,laneId:lane});attempt={parentKey:applied.request.idempotencyKey,clipId:row.id,idempotencyKey:crypto.randomUUID(),status:'preparing',arguments:{project_id:c.projectId,track_id:c.trackId,action:'attach_clip_to_session',arguments:args}};attempt.arguments.idempotency_key=attempt.idempotencyKey;entry.regionAttachments.push(attempt);}
   active.push(attempt);if(['acknowledged','native-proof-required','verified'].includes(attempt.status))continue;
   this.assertContext(c);attempt.status='sending';attempt.dispatches=(attempt.dispatches??0)+1;
   try{attempt.raw=clone(await this.call(c,'execute_pro_action',clone(attempt.arguments)));attempt.receipt=clone(unwrapRangeEditResult(attempt.raw));attempt.status='acknowledged';delete attempt.idempotencyInProgress;}
   catch(error){attempt.error=error.message;attempt.errorCode=error.code;attempt.errorStatus=error.status??error.statusCode;if(error.result!==undefined)attempt.raw=clone(error.result);
    if(isIdempotencyInProgress(error)){retainInProgress(attempt,error);entry.hydrationInProgress=true;attempt.status='in-progress';throw error;}
    if(Number(attempt.errorStatus)===409){attempt.status='native-proof-required';attempt.rejection=error;}
    else{attempt.status='uncertain';throw error;}
   }
  }
  entry.hydrationInProgress=entry.regionAttachments.some(attempt=>attempt.idempotencyInProgress);return active;
 }
 async refreshApplied(entry,applied){
  const w=this.w,c=entry.context,payload=applied.receipt.payload;this.assertContext(c);const attachments=await this.attachRegionChildren(entry,applied);await w.engine.refresh();this.assertContext(c);await w.envelopeView?.reload();
  const raw=w.engine.session.rawProject??w.getProject().cloud?.rawProject;assertRangeAppliedState(raw?.clips,{operations:applied.request.operations??payload.ops,clipsAfter:payload.clips_after??[],inverseOps:applied.receipt.inverseOps??[]});
  if(payload.engine_reload_required===true){
   const native=w.engine.session.rawState;for(const field of ['projectId','project_id'])if(native?.session?.[field]!==undefined&&native.session[field]!==c.projectId)throw new Error('The native effect read belongs to another project.');const runtime=native?.clips;assertCompleteCanonicalData(runtime,'native region audio clips');const rows=Array.isArray(runtime)?runtime:runtime?.clips;if(!Array.isArray(rows))throw new Error('The effect is saved but its live engine reload is not verified.');
   const operations=applied.request.operations??payload.ops,wanted=new Set(operations.map(op=>op.id)),byId=new Map();for(const row of rows){const id=row.db_clip_id??row.db_track_id;if(wanted.has(id)&&byId.has(id))throw new Error('Duplicate native audio identities prevent verifying the region effect.');byId.set(id,row);}for(const op of operations){const row=byId.get(op.id);if(op.op==='remove'){if(row)throw new Error('The effect is saved but removed audio remains in the live engine.');continue;}if(!row||row.library_file_ready===false||row.library_file_set===false)throw new Error('The effect is saved but replacement audio is not loaded in the live engine.');for(const [field,aliases]of Object.entries({start_ms:['start_ms'],duration_sec:['clip_duration_sec','duration_sec','duration_seconds'],audio_offset_sec:['audio_offset_sec','audioOffsetSec']})){if(op[field]===undefined)continue;const actual=aliases.map(alias=>row[alias]).find(value=>typeof value==='number');if(!Number.isFinite(actual)||Math.abs(actual-op[field])>1e-7)throw new Error('The effect is saved but native audio timing still needs a verified reload.');}}
  }
  for(const attempt of attachments){const current=raw.clips?.find(row=>row.id===attempt.clipId);if(!current||clipSourceKey(current)!==clipSourceKey(entry.regionClipSnapshots[attempt.clipId]))throw new Error('The region child source changed while its live attachment was pending.');const container=w.engine.session.rawState?.clips,rows=Array.isArray(container)?container:container?.clips,matches=Array.isArray(rows)?rows.filter(row=>(row.db_clip_id??row.db_track_id)===attempt.clipId):[];if(matches.length!==1||matches[0].library_file_ready!==true||matches[0].library_file_set!==true)throw new Error('The attached region child still needs fresh native readiness proof.');attempt.nativeVerified=true;attempt.status='verified';}
  const owned=new Set([entry.request.clipId,...(entry.effectReceipt?.payload?.clips_after??[]).map(row=>row.id)]);entry.regionClipSnapshots??={};for(const row of raw.clips??[])if(owned.has(row.id))entry.regionClipSnapshots[row.id]=clone(row);
  entry.checkpoint=await this.checkpoint(c,applied);w.render?.();
 }
 reportResult(entry,result){const state=result.record,label=entry?.label??'Effect';this.w.engine.onStatus?.(state.status==='applied-unverified'?label+' saved; verify its receipt before playback or another edit.':state.status==='undone'?'Undid '+label+'.':label+' applied.');}
 /** Undo/Redo of an applied effect use the stored inverse directly (no checkpoint read before the batch). */
 enableAckHistory(entry,controller){if(this.ackMode===false||controller.record?.status!=='applied')return;this.removedClips??=new Map();for(const [id,row]of Object.entries(entry.regionClipSnapshots??{}))if(!this.removedClips.has(id))this.removedClips.set(id,clone(row));if(entry.sourceRecord&&!this.removedClips.has(entry.request.clipId))this.removedClips.set(entry.request.clipId,clone(entry.sourceRecord));controller.ackCommit=args=>this.commitFromReceipt(entry,args);controller.record.ackCommitted=true;}
 uncertain(id){return !!this.inPlacePending||!!this.inPlaceOrphan||super.uncertain(id);}
 async reconcile(){
  if(this.inPlaceOrphan){const orphan=this.inPlaceOrphan;return this.lock(async()=>{this.assertContext(orphan.context);if(orphan.revision)await this.releaseInPlace(orphan);else await requestEngineReconcile(this.w,{reason:'region-in-place-unloaded'});const stack=this.stack(this.past,orphan.context.projectId);if(stack.at(-1)===orphan)stack.pop();this.inPlaceOrphan=null;this.w.waveformView?.refreshSource?.(orphan.clipId,{revision:orphan.previousRevision??undefined});this.w.engine.onStatus?.(orphan.revision?'Released the unapplied '+orphan.label+'. Nothing else changed.':'Freestyle engine resynced.');return true;});}
  if(this.inPlacePending){const pending=this.inPlacePending;return this.lock(async()=>{const payload=await this.renderInPlace(pending.context,pending.args,pending.beforeRevision);/* same key: the stored response */if(typeof payload.revision!=='string')throw new Error('The saved in-place effect could not be confirmed.');return this.registerInPlace(pending,payload);});}
  const id=scope(this.w),controller=[...this.stack(this.receipts,id)].reverse().find(item=>['uncertain','applied-unverified'].includes(item.record?.status));if(!controller)throw new Error('There is no region effect waiting for verification.');const entry=controller.regionEntry;
  return this.lock(async()=>{
   if(controller.record.status==='uncertain'){
    const historyAttempt=controller.record.historyAttempts.at(-1);if(historyAttempt&&['undo','redo'].includes(historyAttempt.operation)){if(controller.record.idempotencyInProgress!==true)throw new Error('The region effect '+historyAttempt.operation+' receipt is uncertain. Inspect its retained atomic batch before continuing; the original effect will not be reapplied.');const result=await controller.reconcile();if(['applied','undone'].includes(result.record.status))this.finishReconciledHistory(entry,'region');this.reportResult(entry,result);return result;}
    const receipt=await observeRegionEffect(entry,(name,args)=>this.call(entry.context,name,args),{maxPolls:this.pollLimit,onProgress:data=>this.progress(data)}),record=controller.record;
    entry.effectReceipt=clone(receipt);delete record.idempotencyInProgress;record.receipt=clone(receipt);if(record.pendingAttempt){record.pendingAttempt.receipt=clone(receipt);record.pendingAttempt.status='acknowledged';delete record.pendingAttempt.idempotencyInProgress;}record.inverseOps=clone(receipt.inverseOps);record.applied='edit';record.status='applied-unverified';record.checkpointVerified=false;record.error=null;
   }
   const result=await controller.reconcile();this.register(entry);if(['applied','undone'].includes(result.record.status))this.finishReconciledHistory(entry,'region');this.pending.delete(id);this.reportResult(entry,result);return result;
  });
 }
 async preview(effectId,values={},options={}){const capture=options.capture??this.captureSelection(),catalog=await this.loadCatalog(),effect=catalog.effects.find(item=>item.id===effectId);if(!effect)throw new Error('Choose a supported region effect.');this.assertSelection(capture);if(capture.endSec-capture.startSec>catalog.limits.max_region_sec)throw new Error('Select at most '+catalog.limits.max_region_sec+' seconds.');const args=regionEffectArguments({projectId:capture.context.projectId,clipId:capture.clipId,startSec:capture.startSec,endSec:capture.endSec,effect:effectId,params:regionEffectParameters(effect,values),crossfadeMs:options.crossfadeMs??0});const raw=await this.call(capture.context,'preview_region_effect',{...args,context_ms:0});this.assertSelection(capture);return regionPreviewUrl(raw,{projectId:capture.context.projectId,clipId:capture.clipId});}
 async open(effectId='amplify'){
  if(this.dialog?.isConnected){this.dialog.focus?.();return this.dialog;}const capture=this.captureSelection(),catalog=await this.loadCatalog();this.assertSelection(capture);if(!catalog.effects.some(effect=>effect.id===effectId))effectId=catalog.effects[0].id;
  const w=this.w,view=w.scroll&&typeof w.setLeftSec==='function'&&Number.isFinite(w.leftSec)&&w.leftSec>=0&&Number.isFinite(w.scale)&&w.scale>0?{leftSec:w.leftSec,scale:w.scale,top:w.scroll.scrollTop}:null;
  const titleEffect=catalog.effects.find(effect=>effect.id===effectId),d=this.w.dialog(titleEffect?.label??'Effect',`<form class="au-region-effect-form"><label>Effect <select class="au-region-effect-select">${catalog.effects.map(effect=>`<option value="${esc(effect.id)}"${effect.id===effectId?' selected':''}>${esc(effect.label)}</option>`).join('')}</select></label><p class="au-region-description"></p><p>Selection: ${esc(capture.startSec.toFixed(3))}–${esc(capture.endSec.toFixed(3))} s</p><div class="au-region-parameters"></div><label><input type="checkbox" class="au-region-allow-clipping"> Allow clipping</label><p class="au-region-state" role="status"></p><audio class="au-region-preview-audio" controls hidden></audio><footer><button type="button" class="au-region-preview">Preview</button><button type="button" class="au-region-recover" hidden>Check saved effect</button><button type="button" class="au-region-close">Cancel</button><button type="submit" class="primary au-region-apply">OK</button></footer></form>`);this.dialog=d;d.classList.add('au-region-effect-dialog');
  const select=d.querySelector('.au-region-effect-select'),parameters=d.querySelector('.au-region-parameters'),state=d.querySelector('.au-region-state'),audio=d.querySelector('audio');let working=false;
  const stopAudio=()=>{audio.pause?.();audio.removeAttribute('src');audio.hidden=true;};
  const fields=()=>{stopAudio();const effect=catalog.effects.find(item=>item.id===select.value);d.querySelector('.au-region-description').textContent=effect.description||'';parameters.innerHTML=Object.entries(effect.params).map(([name,schema])=>`<label>${esc(parameterLabel(name,schema))}${schema.unit?' ('+esc(schema.unit)+')':''} ${schema.type==='boolean'?`<input type="checkbox" data-region-param="${esc(name)}"${schema.default?' checked':''}>`:schema.enum?`<select data-region-param="${esc(name)}">${schema.enum.map(value=>`<option value="${esc(value)}"${value===schema.default?' selected':''}>${esc(value)}</option>`).join('')}</select>`:`<input type="${schema.type==='number'||schema.type==='integer'?'number':'text'}" data-region-param="${esc(name)}" value="${esc(schema.default??'')}"${Number.isFinite(schema.minimum)?` min="${esc(Number.isFinite(schema.default)&&schema.default<schema.minimum?schema.default:schema.minimum)}"`:''}${Number.isFinite(schema.maximum)?` max="${esc(schema.maximum)}"`:''} step="${schema.type==='integer'?'1':'any'}">`}</label>`).join('');state.textContent='Only the selected audio region will be processed.';};
  const values=()=>{const effect=catalog.effects.find(item=>item.id===select.value);return Object.fromEntries([...parameters.querySelectorAll('[data-region-param]')].map(input=>{const name=input.dataset.regionParam,type=effect.params[name].type;return [name,type==='boolean'?input.checked:['number','integer'].includes(type)?Number(input.value):input.value];}));};
  const run=async task=>{if(working)return;working=true;stopAudio();for(const input of d.querySelectorAll('input,select,button'))if(!input.classList.contains('au-region-close'))input.disabled=true;try{await task();}catch(error){state.textContent=error.message;this.w.onError?.(error);}finally{working=false;for(const input of d.querySelectorAll('input,select,button'))input.disabled=false;d.querySelector('.au-region-recover').hidden=!(this.uncertain()||this.unverified());if(this.uncertain()||this.unverified()||d.dataset.applied==='true')d.querySelector('.au-region-apply').disabled=true;}};
  select.onchange=fields;d.querySelector('.au-region-close').onclick=()=>d.close();d.addEventListener('close',()=>{stopAudio();if(this.dialog===d)this.dialog=null;
   // Restore the modal's opening view after native focus restoration. This is
   // local presentation only; a new context, zoom or transport keeps its view.
   if(view)d.ownerDocument.defaultView.requestAnimationFrame(()=>{try{this.assertContext(capture.context);}catch{return;}if(this.dialog||!w.root?.isConnected||w.scale!==view.scale||w.engine.playing||w.engine.positionAt?.()?.playing||w.paused||w.engine.playAttempt||w.engine.recorder?.recording)return;w.setLeftSec(view.leftSec);w.scroll.scrollTop=view.top;});
  },{once:true});
  d.querySelector('.au-region-preview').onclick=()=>run(async()=>{state.textContent='Rendering preview…';const result=await this.preview(select.value,values(),{capture});if(!d.isConnected)return;audio.src=result.url;audio.hidden=false;state.textContent=(result.truncated?'Preview ready (first 30 seconds).':'Preview ready.')+(Number.isFinite(result.receipt.measured?.processed?.peak_dbfs)?' Processed peak: '+result.receipt.measured.processed.peak_dbfs+' dBFS.':'')+(result.receipt.measured?.would_clip?' This effect would clip; reduce the level or explicitly allow clipping.':'');try{await audio.play();}catch{state.textContent+=' Press Play to listen.';}});
  d.querySelector('form').onsubmit=event=>{event.preventDefault();if(this.closeOnOk!==false){const id=select.value,params=values(),allowClipping=d.querySelector('.au-region-allow-clipping').checked;d.close();this.effect(id,params,{capture,allowClipping}).catch(error=>this.w.onError?.(error));return;}run(async()=>{state.textContent='Applying effect to the selected audio…';d.querySelector('.au-region-close').textContent='Close';const result=await this.effect(select.value,values(),{capture,allowClipping:d.querySelector('.au-region-allow-clipping').checked});d.dataset.applied='true';state.textContent=result.record.status==='applied'?'Effect applied to the selected region. Undo is available.':'Effect saved; check its live engine state before continuing.';d.querySelector('.au-region-close').textContent='Close';});};
  d.querySelector('.au-region-recover').onclick=()=>run(async()=>{state.textContent='Checking the saved region effect…';const result=await this.reconcile();state.textContent=['applied','undone'].includes(result.record.status)?'Saved region effect verified.':'The saved effect still needs live engine verification.';});fields();return d;
 }
 hasAudioSelection(){const w=this.w;return Number.isFinite(w.selection?.start)&&w.selection.end>w.selection.start&&w.selectedTracks?.size===1;}
 prefetch(){if(this.w.regionEffectsSupported===true&&!this.catalog)this.loadCatalog().catch(()=>{});}
 /** Audacity's Effect menu: each catalog effect directly ("…" when it opens a dialog). */
 menuItems(){
  const w=this.w,disabled=w.regionEffectsSupported!==true||!this.hasAudioSelection(),effects=this.catalog?.effects??[{id:'amplify',label:'Amplify',params:{gain_db:{}}},{id:'normalize',label:'Normalize',params:{target_db:{}}},{id:'reverse',label:'Reverse',params:{}}];
  return effects.filter(effect=>!['fade_in','fade_out'].includes(effect.id)).map(effect=>[effect.label+(Object.keys(effect.params??{}).length?'…':''),'',()=>{this.launch(effect.id).catch(error=>w.onError?.(error));},disabled]);
 }
 async launch(effectId){const catalog=await this.loadCatalog(),effect=catalog.effects.find(item=>item.id===effectId);if(!effect)throw new Error('Choose an effect from the current Freestyle catalog.');if(effectId==='amplify')return this.amplifyDialog();if(effectId==='normalize')return this.normalizeDialog();if(!Object.keys(effect.params??{}).length)return this.applyNow(effectId);return this.open(effectId);}
 /** No-parameter effects (Reverse, Invert, Silence) apply at once, as in Audacity. */
 async applyNow(effectId,values={},options={}){const capture=options.capture??this.captureSelection();return this.effect(effectId,values,{...options,capture});}
 /** Peak (dBFS) of the selected source frames from the cached waveform tiles; null when unknown. */
 selectionPeakDb(capture){
  const view=this.w.waveformView,clip=(this.w.getProject().audioClips??[]).find(row=>(row.cloudId||row.id)===capture.clipId),record=clip&&view?.records?.get(capture.clipId);if(!record)return null;
  const tiles=[...record.windows.values()].filter(state=>state.status==='ready').map(state=>state.source??state.tile).concat(record.source?[record.source]:[]).filter(Boolean).sort((a,b)=>(a.endFrame-a.startFrame)/a.bucketCount-(b.endFrame-b.startFrame)/b.bucketCount);
  for(const raw of tiles){let tile;try{tile=view.placement?view.placement(clip,raw):raw;}catch{continue;}const rate=tile.sampleRate,clipStart=this.w.seconds(clip.start),f0=Math.floor(tile.clipOffsetFrames+(capture.startSec-clipStart)*rate),f1=Math.ceil(tile.clipOffsetFrames+(capture.endSec-clipStart)*rate);if(!(tile.startFrame<=f0&&tile.endFrame>=f1))continue;
   const n=tile.bucketCount,span=tile.endFrame-tile.startFrame,edge=i=>tile.bucketBoundaries?tile.bucketBoundaries[i]:tile.startFrame+Math.floor(i*span/n);let peak=0;
   for(let i=0;i<n;i++){const a=edge(i),b=edge(i+1);if(b<=f0||a>=f1)continue;for(const channel of tile.channels)peak=Math.max(peak,Math.abs(channel.min[i]),Math.abs(channel.max[i]));}
   return peak>0?20*Math.log10(peak):null;}
  return null;
 }
 dialogShell(title,body){const d=this.w.dialog(title,`<form class="au-effect-form">${body}<p class="au-effect-state" role="status"></p><audio class="au-effect-preview-audio" hidden></audio><footer>${body.includes('data-preview')?'<button type="button" class="au-effect-preview">Preview</button>':''}<button type="button" class="au-effect-cancel">Cancel</button><button type="submit" class="primary au-effect-ok">OK</button></footer></form>`);d.classList.add('au-region-effect-dialog');d.querySelector('.au-effect-cancel').onclick=()=>d.close();this.dialog=d;d.addEventListener('close',()=>{const audio=d.querySelector('audio');audio?.pause?.();if(this.dialog===d)this.dialog=null;},{once:true});return d;}
 /** OK closes the dialog at once; progress and result go to the status bar. */
 commit(d,effectId,values,options){d.close();const label=this.catalog?.effects?.find(effect=>effect.id===effectId)?.label??'Effect';this.w.engine.onStatus?.('Applying '+label+'…');this.effect(effectId,values,options).catch(error=>this.w.onError?.(error));}
 async amplifyDialog(){
  const capture=this.captureSelection(),catalog=await this.loadCatalog(),schema=catalog.effects.find(effect=>effect.id==='amplify')?.params?.gain_db??{minimum:-60,maximum:24},min=Number.isFinite(schema.minimum)?schema.minimum:-60,max=Number.isFinite(schema.maximum)?schema.maximum:24,peakDb=this.selectionPeakDb(capture),round=value=>Math.round(value*1000)/1000,clamp=value=>Math.min(max,Math.max(min,value));
  const initial=peakDb===null?0:clamp(Math.floor(-peakDb*1000)/1000);/* Audacity: new peak 0.0 dB (338 stores an exact 0 dBFS peak); rounded down so it never exceeds it *//* round down: the default never clips */
  const d=this.dialogShell('Amplify',`<label>Amplification (dB): <input type="number" class="au-amp-db" min="${min}" max="${max}" step="any" value="${initial}" data-preview></label><input type="range" class="au-amp-slider" min="${min}" max="${max}" step="any" value="${initial}" aria-label="Amplification (dB)"><label>New Peak Amplitude (dB): <input type="number" class="au-amp-peak" step="any" value="${peakDb===null?'':round(peakDb+initial)}"${peakDb===null?' disabled':''}></label><label><input type="checkbox" class="au-amp-clip"> Allow clipping</label>`);
  const amp=d.querySelector('.au-amp-db'),slider=d.querySelector('.au-amp-slider'),peak=d.querySelector('.au-amp-peak'),clip=d.querySelector('.au-amp-clip'),ok=d.querySelector('.au-effect-ok'),state=d.querySelector('.au-effect-state');
  const sync=(value,from)=>{value=round(clamp(Number(value)||0));if(from!=='amp')amp.value=value;if(from!=='slider')slider.value=value;if(peakDb!==null&&from!=='peak')peak.value=round(peakDb+value);ok.disabled=peakDb!==null&&peakDb+value>1e-9&&!clip.checked;state.textContent=ok.disabled?'Clipping: the new peak is above 0 dB. Allow clipping or lower the amplification.':'';return value;};
  amp.oninput=()=>sync(amp.value,'amp');slider.oninput=()=>sync(slider.value,'slider');peak.oninput=()=>{if(peakDb!==null)sync(Number(peak.value)-peakDb,'peak');};clip.onchange=()=>sync(amp.value,'clip');sync(initial,'init');
  d.querySelector('.au-effect-preview').onclick=async()=>{try{state.textContent='Rendering preview…';const result=await this.preview('amplify',{gain_db:Number(amp.value)},{capture});if(!d.isConnected)return;const audio=d.querySelector('audio');audio.src=result.url;audio.hidden=false;state.textContent='Previewing.';await audio.play?.();}catch(error){state.textContent=error.message;}};
  d.querySelector('form').onsubmit=event=>{event.preventDefault();if(ok.disabled)return;this.commit(d,'amplify',{gain_db:Number(amp.value)},{capture,allowClipping:clip.checked});};return d;
 }
 async normalizeDialog(){
  const capture=this.captureSelection(),catalog=await this.loadCatalog(),params=catalog.effects.find(effect=>effect.id==='normalize')?.params??{},target=params.target_db??{minimum:-24,maximum:0,default:-1};
  const d=this.dialogShell('Normalize',`<label><input type="checkbox" class="au-norm-dc"${(params.remove_dc?.default??true)?' checked':''}> Remove DC offset</label><label>Normalize peak amplitude to <input type="number" class="au-norm-db" min="${target.minimum??-24}" max="${target.maximum??0}" step="any" value="${(target.default??-1).toFixed(1)}"> dB</label>`);
  d.querySelector('form').onsubmit=event=>{event.preventDefault();this.commit(d,'normalize',{remove_dc:d.querySelector('.au-norm-dc').checked,target_db:Number(d.querySelector('.au-norm-db').value)},{capture});};return d;
 }
 destroy(){this.dialog?.close?.();this.dialog=null;}
}
