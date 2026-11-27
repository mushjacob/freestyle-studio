import {batchPostCommitError,RangeEditController,createFreestyleRangeAdapters,exactRangeMilliseconds,rangeEditCheckpoint,rangeEditMixCheckpoint,assertRangeAppliedState} from './audacity-range-edit.js';
import {assertCompleteCanonicalData,normalizeCloudProject} from './cloud-session.js';
import {editQueue,warnEngineOrphans,engineNeedsReconcile,requestEngineReconcile,pendingEngineReconcile,withEngineRetry} from './audacity-edit-queue.js';
import {definiteCloudRejection} from './cloud-errors.js';
import {completeCanonicalPlacements} from './audacity-canonical-placements.js';
const clone=value=>value==null?value:structuredClone(value);
const scope=w=>w.getProject()?.cloud?.projectId||w.getProject()?.id;
const transient=new Set(['selectedPattern','selectedChannel','updatedAt','updated_at','createdAt','created_at','cursorSec','cursor_sec','projectUrl','studioUrl','editUrl','audioUrl','audio_url','downloadUrl']);
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(key=>!transient.has(key)).sort().map(key=>[key,stable(value[key])])):value;
const body=result=>result?.response??result;
const RANGE_LABEL={split:'Split','trim-to-selection':'Trim',delete:'Delete'};
const reportStatus=receipt=>{
 const cuts=receipt?.cuts||[],skipped=receipt?.skippedLanes||[],parts=[];
 if(cuts.length)parts.push('Actual cuts (server uses a 1 ms grid): '+cuts.slice(0,4).map(cut=>Number.isFinite(cut.actual_ms)?`${cut.actual_ms} ms${Number.isFinite(cut.difference_ms)&&cut.difference_ms!==0?` (requested ${cut.requested_ms} ms; difference ${cut.difference_ms} ms)`:''}`:JSON.stringify(cut)).join('; ')+(cuts.length>4?`; ${cuts.length-4} more retained in receipt`:''));
 if(skipped.length)parts.push('Skipped lanes: '+skipped.slice(0,4).map(row=>JSON.stringify(row)).join('; ')+(skipped.length>4?`; ${skipped.length-4} more retained in receipt`:''));
 return parts.length?' — '+parts.join(' — '):'';
};

/** Native audio-range operations have explicit batch inverses, separate from the
 * legacy engine stack. Complete canonical checkpoints prevent mixing histories.
 */
export class AudacityRangeEdits {
 constructor(workspace){this.w=workspace;this.past=new Map();this.future=new Map();this.pending=new Map();this.receipts=new Map();this.prepared=new Map();}
 stack(map,id=scope(this.w)){if(!map.has(id))map.set(id,[]);return map.get(id);}
 captureContext(){const engine=this.w.engine;return {projectId:scope(this.w),trackId:engine.session.trackId||undefined,loadVersion:engine.loadVersion||0,contextVersion:engine.session.contextVersion||0};}
 assertContext(captured){const e=this.w.engine;if(scope(this.w)!==captured.projectId||e.ready===false||e.loading||e.projectId&&e.projectId!==captured.projectId||e.session.projectId&&e.session.projectId!==captured.projectId||(e.session.trackId||undefined)!==captured.trackId||(e.loadVersion||0)!==captured.loadVersion||(e.session.contextVersion||0)!==captured.contextVersion)throw new Error('The cloud project context changed while its range edit was pending.');}
 capture(operation,{ripple=false}={}){
  if(!['split','delete','trim-to-selection'].includes(operation))throw new Error('Choose a supported audio range operation.');
  const w=this.w,startSec=w.selection.start,endSec=w.selection.end,start=exactRangeMilliseconds(startSec),end=exactRangeMilliseconds(endSec);
  if(end<start||operation!=='split'&&end===start)throw new Error('Select an ordered non-empty audio range; Split also accepts a cursor across the selected audio lanes.');
  const indexes=[...w.selectedTracks],tracks=w.tracks.filter(track=>indexes.includes(track.index));
  if(!indexes.length||tracks.length!==indexes.length||tracks.some(track=>!track.laneId))throw new Error('Select persisted audio tracks before editing a time range.');
  if(tracks.some(track=>track.clips.some(clip=>clip.patternId)||['instrument','pattern'].includes(track.channel?.type)))throw new Error('Atomic range editing currently supports audio lanes only. Deselect pattern lanes before editing; their notes and phase will not be approximated.');
  const laneIds=tracks.map(track=>track.laneId);if(laneIds.length>64||new Set(laneIds).size!==laneIds.length)throw new Error('Choose 1–64 distinct persisted audio lanes.');
  return {operation,selection:{startSec,endSec},laneIds,ripple};
 }
 uncertain(projectId=scope(this.w)){return this.stack(this.receipts,projectId).some(controller=>controller.snapshot().record?.status==='uncertain');}
 unverified(projectId=scope(this.w)){return this.stack(this.receipts,projectId).some(controller=>controller.snapshot().record?.status==='applied-unverified');}
 /** Edits started while another owned write is in flight are queued in order
  * (not refused); a gesture in progress still refuses. */
 async lock(fn,label='Audio range edit'){const w=this.w;if(w.engine.interacting||w.clipGesture||w.selectionGesture?.active||w.envelopeView?.active||w.loopRegion?.active)throw new Error('Finish the current gesture before editing an audio range.');
  if(w.historyRunning)return this.lockNow(fn);// inside a queued Undo/Redo: already ordered
  return editQueue(w).enqueue(label,async({queued})=>{if(queued)w.engine.onStatus?.(label+' queued behind the previous edit…');await w.engine.inFlight?.catch(()=>{});for(let i=0;i<600&&(w.busy||w.engine.applying);i++)await new Promise(resolve=>setTimeout(resolve,10));return this.lockNow(fn);});
 }
 async lockNow(fn){const w=this.w;if(w.busy||w.engine.interacting||w.engine.applying||w.clipGesture||w.selectionGesture?.active||w.envelopeView?.active||w.loopRegion?.active)throw new Error('Finish the current cloud operation or gesture before editing an audio range.');const body=w.root?.ownerDocument?.body||globalThis.document?.body;w.busy=true;body?.classList.add('au-cloud-busy');try{return await fn();}finally{w.busy=false;body?.classList.remove('au-cloud-busy');w.lanePan?.sync?.();}}
 async checkpoint(captured,applied,{automation:readAutomation=true}={}){
  this.assertContext(captured);const w=this.w,session=w.engine.session;
  if(!captured.trackId)throw new Error('A complete live project context is required before range history.');
  const responses=await Promise.all([session.call('get_project',{project_id:captured.projectId}),readAutomation?session.call('list_automation',{project_id:captured.projectId}):{envelopes:[]}]);
  this.assertContext(captured);const [project,automation]=responses.map(body),p=project.project??project,canonicalPlacements=completeCanonicalPlacements(p,captured.projectId);
  const placements=canonicalPlacements===null?body(await session.call('execute_pro_action',{project_id:captured.projectId,track_id:captured.trackId,action:'list_pattern_placements',arguments:{}})):{placements:canonicalPlacements};
  this.assertContext(captured);for(const data of [project,placements,automation])assertCompleteCanonicalData(data,'range history checkpoint');
  const verifyProject=data=>{for(const key of ['projectId','project_id'])if(data?.[key]!==undefined&&data[key]!==captured.projectId)throw new Error('The range checkpoint belongs to a different project.');};for(const data of [project,p,placements,automation])verifyProject(data);if(p.id!==undefined&&p.id!==captured.projectId)throw new Error('The range checkpoint belongs to a different project.');
  if(!Array.isArray(p.clips)||!Array.isArray(placements.placements)||!Array.isArray(automation.envelopes))throw new Error('Freestyle did not return complete audio, pattern placement and automation checkpoints.');
  for(const row of [...p.clips,...placements.placements,...automation.envelopes])verifyProject(row);
  if(applied){const receipt=applied.receipt,payload=receipt?.payload||{},state={operations:applied.request.operations??payload.ops??[],clipsAfter:payload.clips_after??[],inverseOps:receipt?.inverseOps??[]};assertRangeAppliedState(p.clips,state);
   const local=w.getProject(),bpm=Number(local.bpm);if(!Number.isFinite(bpm)||bpm<=0||!Array.isArray(local.audioClips))throw new Error('The visible project has no canonical audio timing after the range edit.');
   const clips=local.audioClips.map(c=>({id:c.cloudId||c.id,laneId:c.laneId,start_ms:c.start*60000/bpm,duration_sec:c.length*60/bpm,...(c.offsetKnown===true?{audio_offset_sec:c.offset*60/bpm}:{})}));assertRangeAppliedState(clips,state);
  }
  const curves=automation.envelopes.map(({id,updatedAt,revision,...curve})=>curve).sort((a,b)=>String(a.clipId).localeCompare(String(b.clipId))||String(a.targetKey).localeCompare(String(b.targetKey)));
  const editableProject={...p};delete editableProject.timelineRevision;
  return JSON.stringify(stable({project:editableProject,placements:placements.placements.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id))),automation:curves,mix:rangeEditMixCheckpoint(w.getProject())}));
 }
 async edit(operation,{ripple=false,dryRun=false}={}){
  if(operation==='split'&&!dryRun&&!this.splittingBoundaries){const w=this.w,selection=clone(w.selection);if(selection.end>selection.start){const single=this.batchSplitOps(selection);if(single)return this.batchSplit(selection,single);this.splittingBoundaries=true;try{w.selection={start:selection.start,end:selection.start};const id=scope(w),first=await this.edit('split',{ripple});if(first?.record?.status!=='applied'){w.selection=selection;return first;}/* only a cleanly committed first cut continues */
     const firstEntry=this.stack(this.past,id).at(-1);w.selection={start:selection.end,end:selection.end};let second;
     try{second=await this.edit('split',{ripple});}catch(error){if(definiteCloudRejection(error)&&this.stack(this.past,id).at(-1)===firstEntry){try{await this.lock(()=>this.applyHistory(firstEntry,'undo'));this.stack(this.past,id).pop();w.engine.onStatus?.('Split was rejected at the selection end; the first cut was rolled back.');}catch(rollback){error.rollbackError=rollback.message;}}w.selection=selection;w.paintSelection?.();throw error;}
     const secondEntry=this.stack(this.past,id).at(-1),grouped=second?.record?.status==='applied'&&secondEntry&&secondEntry!==firstEntry&&firstEntry?.controller.record?.ackCommitted&&secondEntry.controller.record?.ackCommitted;
     if(grouped){const past=this.stack(this.past,id);past.pop();past.pop();const combined=[secondEntry,firstEntry].map(part=>part.controller.record?.inverseOps);past.push({label:'Split',group:[firstEntry,secondEntry],context:firstEntry.context,selectionBefore:selection,selectionAfter:selection,controller:secondEntry.controller,...(combined.every(ops=>Array.isArray(ops)&&ops.length)?{undoOps:combined.flat().map(op=>clone(op)),redoOps:null}:{})});}else if(secondEntry!==firstEntry)w.recordOwnedHistory?.('range',id);/* inline-verify mode keeps two entries */
     w.selection=selection;w.paintSelection?.();return second??first;}finally{this.splittingBoundaries=false;}}}
  const options=this.capture(operation,{ripple}),captured=this.captureContext(),projectId=captured.projectId;
  if(!dryRun&&this.uncertain(projectId))throw new Error('A previous audio range edit has an uncertain receipt. Inspect canonical cloud state before another mutation.');
  if(!dryRun&&this.unverified(projectId))throw new Error('The acknowledged audio range edit needs a verified checkpoint before another range mutation. Reconcile its retained receipt first.');
  return this.lock(async()=>{
   const w=this.w;this.assertContext(captured);w.engine.onStatus?.(dryRun?'Checking the audio selection…':operation==='split'?'Splitting the selected audio…':operation==='trim-to-selection'?'Trimming the selected audio…':'Deleting the selected audio…');let entry=this.prepared.get(projectId),controller;const requestKey=JSON.stringify(options);if(entry&&(entry.requestKey!==requestKey||JSON.stringify(entry.context)!==JSON.stringify(captured)||entry.controller.snapshot().record.mutationAttempted||JSON.stringify(entry.controller.snapshot().record.request.expectedCheckpoint)!==JSON.stringify(stable(rangeEditCheckpoint(w.getProject())))))entry=null;
   const retrying=withEngineRetry(w,(name,args)=>{this.assertContext(captured);return w.engine.session.call(name,args);}),adapters=createFreestyleRangeAdapters({cloudCall:retrying,getTrackId:()=>captured.trackId});
   if(!entry){controller=new RangeEditController({getProject:()=>w.getProject(),getCheckpoint:project=>stable(rangeEditCheckpoint(project)),...adapters,
    flush:async()=>{await w.envelopeView?.controller.saveQueue;await w.engine.flush();this.assertContext(captured);},
    refresh:async context=>{this.assertContext(captured);await w.engine.refresh();this.assertContext(captured);await w.envelopeView?.reload();entry.checkpoint=await this.checkpoint(captured,context);w.render?.();return {historyCheckpointVerified:true};},
    isInteracting:()=>!!w.engine.interacting});
   if(this.ackMode!==false)controller.ackCommit=args=>this.commitFromReceipt(entry,args);controller.prepare(options);entry={controller,context:captured,checkpoint:null,requestKey,selectionBefore:{start:options.selection.startSec,end:options.selection.endSec},selectionAfter:{start:options.selection.startSec,end:options.selection.endSec}};controller.rangeEntry=entry;this.prepared.set(projectId,entry);this.stack(this.receipts,projectId).push(controller);}else controller=entry.controller;this.pending.set(projectId,controller);
   try{
    const result=await (dryRun?controller.preview():controller.apply());
    if(!dryRun&&result.record.applied==='edit'){
     this.prepared.delete(projectId);const receipt=result.record.receipt;
     if(operation==='delete'&&ripple){const actualStart=receipt.cuts?.find(cut=>cut.boundary==='start'&&Number.isFinite(cut.actual_ms))?.actual_ms;const start=actualStart===undefined?options.selection.startSec:actualStart/1000;entry.selectionAfter={start,end:start};}
     try{this.assertContext(captured);w.selection=clone(entry.selectionAfter);w.paintSelection?.();}catch{}
     // An explicit empty forward and inverse plan changed no clips. Do not
     // replace the prior owned history or discard its redo for this no-op.
     if(!receipt.noOp){this.stack(this.past,projectId).push(entry);this.stack(this.future,projectId).length=0;}
     if(result.record.ackCommitted)this.scheduleVerify(entry,{projectId,operation:'apply',request:clone(result.record.request),receipt:clone(receipt)});
     const label=RANGE_LABEL[operation]??'Edit';entry.label=label;const status=result.record.status==='applied-unverified'?'The audio range edit completed, but its canonical history checkpoint is unavailable: '+result.record.refreshError:receipt.noOp?'No audio clips changed.':receipt.payload?.engine_reload_required?label+' saved; the live engine is reloading its clips.':label+'.';
     w.engine.onStatus?.(status);(this.debugLog??=[]).push(label+reportStatus(receipt));if(globalThis.localStorage?.getItem?.('modesty:debug')==='1')console.debug('[range]',label+reportStatus(receipt));
    }
    else if(dryRun)w.engine.onStatus?.('Cloud audio range plan read; no edit applied'+reportStatus(result.record.receipt));
    return result;
   }finally{if(controller.snapshot().record.status!=='uncertain')this.pending.delete(projectId);}
  });
 }
 /** Apply an acknowledged range receipt to the visible project immediately. */
 /** Exact inverse of an applied clip batch from the pre-edit timings (round-5 batch
  * receipts carry no undo.inverse_ops). remove→restore, update→update back (with
  * expected = the new timing), insert/restore→remove; reverse order. */
 localInverse(raw,ops){
  const byId=new Map(raw.clips.map(clip=>[clip.id,clip])),stash=this.removedClips??new Map(),timing=clip=>({start_ms:clip.startMs,duration_sec:clip.durationSec,audio_offset_sec:clip.audioOffsetSec}),applied=op=>({start_ms:op.start_ms,duration_sec:op.duration_sec,audio_offset_sec:op.audio_offset_sec}),inverse=[];
  /* simulate in order: a batch may touch the same clip twice (grouped Split Undo) */
  const live=new Map([...byId].map(([id,clip])=>[id,{...clip}])),gone=new Map([...stash].map(([id,clip])=>[id,{...clip}])),set=(id,op)=>{const clip=live.get(id)??gone.get(id)??{id};const next={...clip,...(op.start_ms!==undefined?{startMs:op.start_ms}:{}),...(op.duration_sec!==undefined?{durationSec:op.duration_sec}:{}),...(op.audio_offset_sec!==undefined?{audioOffsetSec:op.audio_offset_sec}:{})};gone.delete(id);live.set(id,next);};
  for(const op of ops){const before=live.get(op.id)??gone.get(op.id);if(op.op==='remove'){if(!before)return null;inverse.push({op:'restore',id:op.id,...timing(before)});gone.set(op.id,before);live.delete(op.id);}else if(op.op==='update'){if(!before)return null;inverse.push({op:'update',id:op.id,...timing(before),expected:applied({...timing(before),...op})});set(op.id,op);}else if(op.op==='insert'||op.op==='restore'){inverse.push({op:'remove',id:op.id,expected:applied(op)});set(op.id,op);}else return null;}
  return inverse.reverse();
 }
 commitFromReceipt(entry,{request,receipt,record}){
  try{
   const w=this.w,session=w.engine.session,context=entry?.context??this.captureContext();if(!session?.rawProject||session.projectId!==context.projectId)return false;
   const payload=receipt?.payload??{};const postCommit=batchPostCommitError(payload)??receipt?.postCommitError??null;if(postCommit||engineNeedsReconcile(payload))requestEngineReconcile(this.w,{reason:'range'});const raw=clone(session.rawProject),byId=new Map(raw.clips.map(clip=>[clip.id,clip])),ops=Array.isArray(payload.ops)&&payload.ops.length?payload.ops:Array.isArray(request?.operations)?request.operations:[];this.removedClips??=new Map();
   const timing=row=>({...(row.lane_id!==undefined?{laneId:row.lane_id}:{}),...(row.start_ms!==undefined?{startMs:row.start_ms}:{}),...(row.duration_sec!==undefined?{durationSec:row.duration_sec}:{}),...(row.audio_offset_sec!==undefined?{audioOffsetSec:row.audio_offset_sec}:{})});
   if(record&&(record.inverseOps==null||!record.inverseOps.length)&&ops.length){const inverse=this.localInverse(raw,ops);if(inverse){record.inverseOps=inverse;record.historyUnavailableReason=null;}}
   /* strictly in op order, as the server applies them (a batch may update then remove the same clip) */
   for(const op of ops){if(op.op==='remove'){const clip=byId.get(op.id);if(!clip)return false;this.removedClips.set(op.id,clone(clip));byId.delete(op.id);}else if(op.op==='update'){const clip=byId.get(op.id);if(!clip)return false;Object.assign(clip,timing(op));}else if(op.op==='insert'){const source=byId.get(op.source_id)??this.removedClips.get(op.source_id);if(!source)return false;const copy={...clone(source),id:op.id,...timing(op)};if(source.isImported===true)copy.isImported=false;byId.set(op.id,copy);w.waveformView?.aliasSource?.(op.id,op.source_id);}else if(op.op==='restore'){const clip=this.removedClips.get(op.id);if(!clip)return false;byId.set(op.id,{...clone(clip),...timing(op)});}else if(op.op!=='remove')return false;}
   for(const row of payload.clips_after??[]){const clip=byId.get(row.id);if(!clip)return false;Object.assign(clip,timing(row));}
   raw.clips=[...byId.values()];if(raw.counts&&Object.hasOwn(raw.counts,'clips'))raw.counts.clips=raw.clips.length;
   if(record&&Array.isArray(record.inverseOps))record.inverseOps=record.inverseOps.map(op=>{if(op.expected||!['update','remove'].includes(op.op))return op;const after=byId.get(op.id);return after?{...op,expected:{start_ms:after.startMs,duration_sec:after.durationSec,audio_offset_sec:after.audioOffsetSec}}:op;});/* server inverse ops carry expected (= post-batch state); fill any missing guard from the after-state */
   const revision=payload.timelineRevision??payload.timeline_revision;if(typeof revision==='string'&&revision)raw.timelineRevision=revision;
   session.rawProject=raw;session.project=normalizeCloudProject(raw,session.rawState,{projectId:context.projectId,trackId:session.trackId});w.engine.accept?.(session.project);w.render?.();return true;
  }catch(error){(this.localErrors??=[]).push(error.message);return false;}
 }
 /** Background verification of the newest acknowledged range write. */
 scheduleVerify(entry,applied){const v=this.verifier??={timer:null,generation:0,running:null};v.generation++;const generation=v.generation;clearTimeout(v.timer);v.timer=setTimeout(()=>{v.timer=null;this.runVerify(entry,applied,generation);},this.verifyIdleMs??600);}
 cancelVerify(){const v=this.verifier??={timer:null,generation:0,running:null};v.generation++;clearTimeout(v.timer);v.timer=null;}
 whenVerified(){const v=this.verifier??={timer:null,generation:0,running:null};return new Promise(resolve=>{const poll=()=>v.timer||v.running!=null?setTimeout(poll,5):resolve();poll();});}
 warn(message){(this.warnings??=[]).push(message);this.w.engine.onStatus?.(message);this.w.onWarning?.(message);}
 async runVerify(entry,applied,generation){
  const v=this.verifier,w=this.w;if(generation!==v.generation)return;if(w.busy||w.engine.applying||w.engine.interacting||w.clipGesture||w.editQueue?.busy){v.timer=setTimeout(()=>{v.timer=null;this.runVerify(entry,applied,generation);},this.verifyIdleMs??600);return;}
  v.running=generation;await pendingEngineReconcile(w);
  try{this.assertContext(entry.context);const touched=new Set(applied?.request?.laneIds??[]),ids=new Set([...(applied?.receipt?.payload?.ops??applied?.request?.operations??[])].map(op=>op.id));for(const clip of [...(w.engine.session.rawProject?.clips??[]),...(this.removedClips?.values?.()??[])])if(ids.has(clip.id))touched.add(clip.laneId);
   await w.engine.session.refresh();if(generation!==v.generation)return;entry.engineOrphans=warnEngineOrphans(w,w.engine.session,[...touched],message=>this.warn(message));entry.checkpoint=await this.checkpoint(entry.context,applied,{automation:false});if(generation!==v.generation)return;if(!w.busy&&!w.engine.applying)w.engine.accept?.(w.engine.session.project);if(this.touchesSavedEnvelope(applied))await w.envelopeView?.reload?.();entry.verified=true;/* no list_automation unless a saved clip-gain envelope was touched */}
  catch(error){if(generation!==v.generation)return;if(error?.status!==undefined||typeof error?.code==='string'){entry.verifyAttempts=(entry.verifyAttempts||0)+1;if(entry.verifyAttempts<3){v.timer=setTimeout(()=>{v.timer=null;this.runVerify(entry,applied,generation);},(this.verifyIdleMs??600)*(entry.verifyAttempts+1));return;}this.warn('Saved, but Freestyle could not be read to confirm the last audio range edit ('+error.message+').');return;}
   entry.verifyError=error.message;entry.checkpoint=null;this.warn('Freestyle differs from the last audio range edit ('+error.message+') — showing the saved server state.');try{if(!w.busy&&!w.engine.applying)w.engine.accept?.(w.engine.session.project);}catch{}}
  finally{if(v.running===generation)v.running=null;}
 }
 preview(operation,options={}){return this.edit(operation,{...options,dryRun:true});}
 async history(direction){
  if(!['undo','redo'].includes(direction))throw new Error('Choose Undo or Redo.');const projectId=scope(this.w);
  if(this.uncertain(projectId))throw new Error('An audio range receipt is uncertain. Check canonical cloud state before Undo or Redo.');
  if(this.unverified(projectId))throw new Error('The acknowledged audio range edit needs a verified checkpoint before Undo or Redo. Reconcile its retained receipt first.');
  const from=direction==='undo'?this.past:this.future,to=direction==='undo'?this.future:this.past,stack=this.stack(from,projectId),entry=stack.at(-1);if(!entry)return false;
  return this.lock(async()=>{
   const w=this.w;w.engine.onStatus?.(direction==='undo'?'Undoing the audio edit…':'Redoing the audio edit…');await w.envelopeView?.controller.saveQueue;await w.engine.flush();this.assertContext(entry.context);
   let result;if(entry.undoOps!==undefined||entry.redoOps!==undefined){let done=false;try{done=await this.historyOps(entry,direction);}catch(error){if(!(entry.group&&Number(error?.status)===400&&definiteCloudRejection(error)))throw error;/* validation refusal of the combined batch only: sequential fallback */entry.undoOps=entry.redoOps=undefined;}if(done){stack.pop();this.stack(to,projectId).push(entry);result={record:{receipt:{payload:{}}}};}}
   if(!result&&entry.group){const parts=direction==='undo'?[...entry.group].reverse():entry.group,done=[];try{for(const part of parts){result=await this.applyHistory(part,direction);done.push(part);}}catch(error){/* restore the cuts already reverted, newest first, so the timeline is never left half-split */for(const part of done.reverse()){try{await this.applyHistory(part,direction==='undo'?'redo':'undo');}catch(compensation){error.compensationError=compensation.message;}}throw error;}stack.pop();this.stack(to,projectId).push(entry);}
   else if(!result){result=await this.applyHistory(entry,direction,()=>{stack.pop();this.stack(to,projectId).push(entry);});}
   try{this.assertContext(entry.context);w.selection=clone(direction==='undo'?entry.selectionBefore:entry.selectionAfter);w.paintSelection?.();}catch{}
   const label=entry.label??'Edit';w.engine.onStatus?.(result.record.receipt.payload?.engine_reload_required?(direction==='undo'?'Undid ':'Redid ')+label+'; the live engine is reloading its clips.':(direction==='undo'?'Undid ':'Redid ')+label+'.');return true;
  });
 }
 touchesSavedEnvelope(applied){const ids=new Set([...(applied?.receipt?.payload?.ops??applied?.request?.operations??[])].flatMap(op=>[op.id,op.source_id]).filter(Boolean));return (this.w.getProject().audioClips||[]).some(clip=>ids.has(clip.cloudId||clip.id)&&this.w.envelopeView?.waveformState?.(clip)?.envelope?.persisted===true);}
 /** One apply_clip_batch for a whole Undo/Redo of an ops entry (one If-Match, one retained key).
  * The next direction's ops come from the server's undo.inverse_ops, else the exact local inverse. */
 async historyOps(entry,direction){
  const ops=direction==='undo'?entry.undoOps:direction==='redo'?entry.redoOps:entry.forwardOps;if(!Array.isArray(ops)||!ops.length)return false;
  const w=this.w,context=entry.context;this.assertContext(context);let pending=entry.pendingWrite;
  if(!pending||pending.direction!==direction)pending=entry.pendingWrite={direction,key:crypto.randomUUID(),ops:clone(ops),ifMatch:w.engine.session?.rawProject?.timelineRevision??null};/* an unknown outcome keeps this exact intent; a retry replays the same key */
  const adapters=createFreestyleRangeAdapters({cloudCall:withEngineRetry(w,(name,args)=>{this.assertContext(context);return w.engine.session.call(name,{...args,...(name!=='get_project'&&typeof pending.ifMatch==='string'&&pending.ifMatch?{if_match:pending.ifMatch}:{})});}),getTrackId:()=>context.trackId});
  this.cancelVerify();let receipt;
  try{receipt=await adapters.sendBatch({projectId:context.projectId,operations:pending.ops,idempotencyKey:pending.key});}catch(error){if(definiteCloudRejection(error))entry.pendingWrite=null;throw error;}
  entry.pendingWrite=null;const holder={inverseOps:Array.isArray(receipt.inverseOps)&&receipt.inverseOps.length?clone(receipt.inverseOps):null};
  if(!this.commitFromReceipt(entry,{request:{operations:pending.ops},receipt,record:holder})){await w.engine.refresh();if(!w.engine.applying)w.engine.accept?.(w.engine.session.project);}
  if(direction==='undo')entry.redoOps=holder.inverseOps;else entry.undoOps=holder.inverseOps;
  this.scheduleVerify(entry,{projectId:context.projectId,operation:direction,request:{operations:clone(pending.ops)},receipt:clone(receipt)});return true;
 }
 /** Audacity Split over a selection as ONE apply_clip_batch: update each crossed clip to its first piece
  * and insert the rest from the same source. Used only when every crossed clip's gain envelope is known
  * implicit (a batch insert does not split saved envelopes); otherwise the two-cut path is used. */
 batchSplitOps(selection){
  const w=this.w,raw=w.engine.session?.rawProject;if(!raw||this.ackMode===false)return null;const a=exactRangeMilliseconds(selection.start),b=exactRangeMilliseconds(selection.end),lanes=new Set([...w.selectedTracks].map(index=>w.tracks.find(track=>track.index===index)?.laneId).filter(Boolean));if(!lanes.size)return null;
  const ops=[];for(const clip of raw.clips){if(!lanes.has(clip.laneId))continue;const start=clip.startMs,end=start+clip.durationSec*1000,cuts=[a,b].filter(cut=>cut>start&&cut<end);if(!cuts.length)continue;
   const model=(w.getProject().audioClips||[]).find(row=>(row.cloudId||row.id)===clip.id);if(!model||model.offsetKnown!==true||w.envelopeView?.waveformState?.(model)?.status!=='ready'||w.envelopeView.waveformState(model).envelope?.persisted!==false)return null;
   const timing={start_ms:start,duration_sec:clip.durationSec,audio_offset_sec:clip.audioOffsetSec};ops.push({op:'update',id:clip.id,start_ms:start,duration_sec:(cuts[0]-start)/1000,audio_offset_sec:clip.audioOffsetSec,expected:timing});
   cuts.forEach((cut,index)=>{const next=cuts[index+1]??end;ops.push({op:'insert',id:crypto.randomUUID().replace(/-/g,''),source_id:clip.id,start_ms:cut,duration_sec:(next-cut)/1000,audio_offset_sec:clip.audioOffsetSec+(cut-start)/1000});});}
  return ops.length?ops:null;
 }
 async batchSplit(selection,ops){
  const w=this.w,id=scope(w);return this.lock(async()=>{const entry={label:'Split',opsEntry:true,context:this.captureContext(),selectionBefore:clone(selection),selectionAfter:clone(selection),forwardOps:ops,undoOps:null,redoOps:null};await this.historyOps(entry,'edit');entry.redoOps=clone(ops);this.stack(this.past,id).push(entry);this.stack(this.future,id).length=0;w.selection=clone(selection);w.paintSelection?.();w.engine.onStatus?.('Split.');return {record:{status:'applied',applied:'edit',receipt:{noOp:false}},entry};},'Split');
 }
 /** Audacity Join for the case Freestyle can express exactly: clips on the selected tracks that touch on the timeline
  * AND continue the same source audio (start B = end A, source offset B = source end A) — i.e. the pieces of a Split —
  * become one clip again in ONE apply_clip_batch (update the first, remove the rest). A join across a gap would need
  * rendered silence, which Freestyle has no operation for. */
 joinOps(selection){
  const w=this.w,raw=w.engine.session?.rawProject;if(!raw)return null;const from=exactRangeMilliseconds(selection.start),to=exactRangeMilliseconds(Math.max(selection.end,selection.start)),lanes=new Set([...w.selectedTracks].map(index=>w.tracks.find(track=>track.index===index)?.laneId).filter(Boolean));if(!lanes.size)return null;
  const model=id=>(w.getProject().audioClips||[]).find(row=>(row.cloudId||row.id)===id),implicit=id=>{const row=model(id);return !!row&&row.offsetKnown===true&&w.envelopeView?.waveformState?.(row)?.status==='ready'&&w.envelopeView.waveformState(row).envelope?.persisted===false;};
  const sameSource=(a,b)=>{const view=w.waveformView;return !!view?.sourceOf&&view.sourceOf(a.id)===view.sourceOf(b.id);},timing=clip=>({start_ms:clip.startMs,duration_sec:clip.durationSec,audio_offset_sec:clip.audioOffsetSec}),ops=[];
  for(const lane of lanes){
   const clips=raw.clips.filter(clip=>clip.laneId===lane&&clip.startMs<=to&&clip.startMs+clip.durationSec*1000>=from).sort((a,b)=>a.startMs-b.startMs);
   for(let index=0;index<clips.length;index++){
    const first=clips[index];let end=first.startMs+first.durationSec*1000,sourceEnd=first.audioOffsetSec+first.durationSec,duration=first.durationSec;const rest=[];
    while(index+1<clips.length){const next=clips[index+1];if(Math.abs(next.startMs-end)>1||Math.abs(next.audioOffsetSec-sourceEnd)>.0015||!sameSource(first,next))break;rest.push(next);end=next.startMs+next.durationSec*1000;sourceEnd=next.audioOffsetSec+next.durationSec;duration+=next.durationSec;index++;}
    if(!rest.length)continue;if(![first,...rest].every(clip=>implicit(clip.id)))return null;
    ops.push({op:'update',id:first.id,start_ms:first.startMs,duration_sec:duration,audio_offset_sec:first.audioOffsetSec,expected:timing(first)});for(const clip of rest)ops.push({op:'remove',id:clip.id,expected:timing(clip)});
   }
  }
  return ops.length?ops:null;
 }
 async join(){
  const w=this.w,selection=clone(w.selection),ops=this.joinOps(selection);
  if(!ops)throw new Error('Join needs clips that touch and continue the same audio (for example the two sides of a Split) on the selected tracks. Joining across a gap needs an engine operation that does not exist yet.');
  const id=scope(w);return this.lock(async()=>{const entry={label:'Join',opsEntry:true,context:this.captureContext(),selectionBefore:clone(selection),selectionAfter:clone(selection),forwardOps:ops,undoOps:null,redoOps:null};await this.historyOps(entry,'edit');entry.redoOps=clone(ops);this.stack(this.past,id).push(entry);this.stack(this.future,id).length=0;w.selection=clone(selection);w.paintSelection?.();w.engine.onStatus?.('Joined clips.');return {record:{status:'applied',applied:'edit',receipt:{noOp:false}},entry};},'Join');
 }
 /** One range history step for one cut (also used for each part of a grouped Split). */
 async applyHistory(entry,direction,moved=()=>{}){
  this.assertContext(entry.context);
  if(this.ackMode!==false&&entry.controller.record?.ackCommitted){this.cancelVerify();}else if(!entry.checkpoint||await this.checkpoint(entry.context)!==entry.checkpoint)throw new Error('Other cloud edits changed this audio range checkpoint. Combining its inverse with legacy engine history needs a unified history contract.');
  const state=entry.controller.snapshot();if(!state[direction==='undo'?'canUndo':'canRedo'])throw new Error(state.record.historyUnavailableReason||'This audio range has no verified inverse receipt for that history direction.');
  entry.historyPending={direction};Object.defineProperty(entry.historyPending,'entry',{value:entry});await entry.controller[direction]();moved();entry.historyPending=null;
  const result=entry.controller.snapshot();if(result.record.status==='applied-unverified')entry.checkpoint=null;if(result.record.ackCommitted){const attempt=result.record.historyAttempts.at(-1);this.scheduleVerify(entry,{projectId:entry.context.projectId,operation:direction,request:clone(attempt.request),receipt:clone(attempt.receipt)});}
  return result;
 }
 finishReconciledHistory(entry,kind='range'){
  const pending=entry.historyPending;if(!pending)return;const id=entry.context.projectId,direction=pending.direction,from=this.stack(direction==='undo'?this.past:this.future,id),to=this.stack(direction==='undo'?this.future:this.past,id);if(from.at(-1)!==entry)throw new Error('The chronological audio history changed while its receipt was pending.');try{this.w.ownedHistoryReconciled?.(kind,pending);}catch(error){entry.controller.record.status='applied-unverified';entry.controller.record.refreshError=error.message;throw error;}from.pop();to.push(entry);entry.historyPending=null;
 }
 async reconcile(){
  const projectId=scope(this.w),controller=[...this.stack(this.receipts,projectId)].reverse().find(candidate=>['uncertain','applied-unverified'].includes(candidate.snapshot().record?.status));
  if(!controller)throw new Error('There is no acknowledged range edit waiting for a canonical checkpoint.');
  return this.lock(async()=>{const entry=controller.rangeEntry??this.prepared.get(projectId);if(entry)this.assertContext(entry.context);const result=await controller.reconcile();if(entry&&['applied','undone'].includes(result.record.status)){
   if(entry.historyPending)this.finishReconciledHistory(entry);
   else if(result.record.applied==='edit'&&!result.record.receipt.noOp&&!this.stack(this.past,projectId).includes(entry)){if(result.record.request.operation==='delete'&&result.record.request.ripple){const actual=result.record.receipt.cuts?.find(cut=>cut.boundary==='start'&&Number.isFinite(cut.actual_ms))?.actual_ms,start=actual===undefined?result.record.request.selection.startSec:actual/1000;entry.selectionAfter={start,end:start};}this.stack(this.past,projectId).push(entry);this.stack(this.future,projectId).length=0;this.w.recordOwnedHistory?.('range',projectId);}
   this.prepared.delete(projectId);this.pending.delete(projectId);this.w.selection=clone(result.record.applied==='undone'?entry.selectionBefore:entry.selectionAfter);this.w.paintSelection?.();
  }return result;});
 }
 can(direction){const projectId=scope(this.w),entry=this.stack(direction==='undo'?this.past:this.future,projectId).at(-1);if(!entry?.checkpoint||this.w.busy||this.uncertain(projectId))return false;try{this.assertContext(entry.context);return !!entry.controller.snapshot()[direction==='undo'?'canUndo':'canRedo'];}catch{return false;}}
}
