import {definiteCloudRejection,retainInProgress,isIdempotencyInProgress,captureWriteRequest} from './cloud-errors.js';
import {normalizeCloudProject} from './cloud-session.js';
import {unwrapRangeEditResult} from './audacity-range-edit.js';
/** Per-clip mute over the published typed route (setClipMuted,
 * PUT /projects/{id}/clips/{clip_id}/mute {muted}). Audacity has no clip mute,
 * so the UI is one clip-menu toggle plus a dimmed waveform. Lane mute is a
 * separate control and still silences every clip on its lane.
 * Optimistic display, retained key + timeline If-Match, the returned clip card
 * is applied as canonical, the returned undo enters the shared ⌘Z history,
 * and engine_reload_required:true is shown as saved-but-not-yet-audible. */
const clone=structuredClone;
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const scope=w=>w.getProject().cloud?.projectId||w.getProject().id;
const abort=()=>Object.assign(new Error('The project or editing context changed during clip mute.'),{name:'AbortError',code:'clip_mute_scope_changed'});
export const CLIP_MUTE_OPERATION='setClipMuted';

/** Validate a ClipMuteResult against the captured intent. */
export function clipMuteReceipt(raw,{projectId,clipId,muted}){
 if(isIdempotencyInProgress(raw))throw Object.assign(new Error('The original clip mute request is still running.'),{code:'idempotency_in_progress',result:raw});
 const r=unwrapRangeEditResult(raw);
 if(r.projectId!==undefined&&r.projectId!==projectId)throw new Error('The clip mute acknowledgement belongs to another project.');
 const clip=r.clip;if(!clip||typeof clip!=='object'||clip.id!==clipId)throw new Error('The clip mute acknowledgement identifies another clip.');
 if(r.clipMuted!==muted||(clip.clipMuted!==undefined&&clip.clipMuted!==muted))throw new Error('The saved clip mute does not match the request. Its receipt is retained; no retry was sent.');
 if(typeof r.engine_applied!=='boolean'||typeof r.engine_reload_required!=='boolean')throw new Error('Freestyle returned no engine outcome for the clip mute.');
 const u=r.undo;if(!u||u.op!=='mute'||u.clip_id!==clipId||typeof u.muted!=='boolean')throw new Error('Freestyle returned no usable clip-mute undo.');
 return r;
}

export class AudacityClipMute{
 constructor(w){this.w=w;this.past=new Map();this.future=new Map();this.records=[];this.overlay=new Map();this.reloadPending=new Map();this.operation=null;this.verification=null;}
 context(){const e=this.w.engine;return {projectId:scope(this.w),trackId:e.session?.trackId,loadVersion:e.loadVersion||0,contextVersion:e.session?.contextVersion||0};}
 assertContext(c){const e=this.w.engine,n=this.context();if(!e.ready||e.loading||e.session?.closed||e.projectId&&e.projectId!==c.projectId||Object.keys(c).some(key=>n[key]!==c[key]))throw abort();}
 key(projectId,clipId){return projectId+'\u0000'+clipId;}
 stack(map,id){if(!map.has(id))map.set(id,[]);return map.get(id);}
 clearFuture(id){this.future.get(id)?.splice(0);}
 uncertain(id=scope(this.w)){return this.records.some(row=>row.context.projectId===id&&row.status==='uncertain');}
 unverified(){return false;}
 clip(id){const rows=(this.w.getProject().audioClips||[]).filter(clip=>!clip.patternId&&(clip.cloudId||clip.id)===id);return rows.length===1?rows[0]:null;}
 available(clip){return this.w.clipMuteSupported===true&&!!clip&&!clip.patternId&&validId(clip.cloudId||clip.id)&&this.w.engine.ready&&!this.w.engine.loading&&!this.operation&&!this.uncertain();}
 muted(clip){if(!clip||clip.patternId)return false;const k=this.key(scope(this.w),clip.cloudId||clip.id);return this.overlay.has(k)?this.overlay.get(k):clip.cloudRaw?.clipMuted===true;}
 /** Saved but not applied by the live engine (engine_reload_required). Cleared by a project reload. */
 notYetAudible(clip){const pending=clip&&this.reloadPending.get(this.key(scope(this.w),clip.cloudId||clip.id));return pending!==undefined&&pending===(this.w.engine.loadVersion||0);}
 classes(clip){return this.muted(clip)?' au-clip-muted'+(this.notYetAudible(clip)?' au-clip-mute-pending':''):'';}
 idle(){const w=this.w,e=w.engine;if(w.busy||e.applying||e.interacting||w.clipGesture||w.selectionGesture?.active||w.envelopeView?.active||w.trackLayout?.active||w.amplitudeView?.active||w.multiToolView?.active||w.groupMoves?.active||w.loopRegion?.active||w.panGesture||w.viewport?.pinDrag||w.pencil?.active)throw new Error('Finish the current edit before muting a clip.');}
 toggle(clip){return this.set(clip?.cloudId||clip?.id,!this.muted(clip));}
 set(clipId,muted){
  try{if(this.w.clipMuteSupported!==true)throw new Error('This Freestyle contract does not publish per-clip mute.');if(typeof muted!=='boolean'||!validId(clipId))throw new Error('Choose one saved audio clip to mute.');if(this.operation)throw new Error('Wait for the current clip mute request.');if(this.uncertain())throw new Error('Verify the pending clip mute before another edit.');this.w.assertOwnedEditsSettled?.();this.idle();}catch(error){return Promise.reject(error);}
  return this.write(clipId,muted,'edit');
 }
 applyClip(c,receipt){
  const w=this.w,e=w.engine,s=e.session;if(!s||s.projectId!==c.projectId||!s.rawProject)return;const raw=clone(s.rawProject),index=(raw.clips||[]).findIndex(row=>row.id===receipt.clip.id);if(index<0)return;
  raw.clips[index]={...raw.clips[index],...clone(receipt.clip),clipMuted:receipt.clipMuted};if(typeof receipt.timelineRevision==='string'&&receipt.timelineRevision)raw.timelineRevision=receipt.timelineRevision;
  s.rawProject=raw;s.project=normalizeCloudProject(raw,s.rawState??{},{projectId:c.projectId,trackId:s.trackId});if(!e.applying)e.accept?.(s.project);
 }
 write(clipId,muted,mode,entry=null){
  const w=this.w;let c;try{c=this.context();this.assertContext(c);if(!this.clip(clipId))throw new Error('The clip is no longer a saved audio clip in this project.');}catch(error){return Promise.reject(error);}
  const k=this.key(c.projectId,clipId),hadOverlay=this.overlay.has(k),previousOverlay=this.overlay.get(k);
  const record={context:c,clipId,requested:muted,mode,direction:mode,entry,idempotencyKey:crypto.randomUUID(),status:'preparing',attempted:false,raw:null,receipt:null,error:null,request:null};this.records.push(record);
  const job={clipId,muted,promise:null};this.operation=job;this.overlay.set(k,muted);w.busy=true;w.root?.ownerDocument.body.classList.add('au-cloud-busy');w.render?.();
  const rollback=()=>{if(hadOverlay)this.overlay.set(k,previousOverlay);else this.overlay.delete(k);};
  job.promise=(async()=>{try{
   w.engine.onStatus?.((muted?'Muting':'Unmuting')+' clip…');await w.engine.flush?.();this.assertContext(c);if(!this.clip(clipId))throw abort();
   const revision=w.engine.session?.rawProject?.timelineRevision,trackId=c.trackId;
   record.request=captureWriteRequest(CLIP_MUTE_OPERATION,{project_id:c.projectId,clip_id:clipId,muted,...validId(trackId)?{track_id:trackId}:{},idempotency_key:record.idempotencyKey,...typeof revision==='string'&&revision?{if_match:revision}:{}});
   record.attempted=true;record.status='sending';record.raw=clone(await w.engine.session.call(record.request.name,clone(record.request.arguments)));this.assertContext(c);
   return this.acknowledge(record,entry);
  }catch(error){
   if(record.attempted&&!record.receipt)retainInProgress(record,error);if(error.result!==undefined&&!record.receipt)record.raw=clone(error.result);record.error=error.message;
   if(!record.attempted||record.receipt||definiteCloudRejection(error)){record.status=record.receipt?'confirmed':'rejected';if(!record.receipt)rollback();}else record.status='uncertain';
   throw Object.assign(error,{clipMuteReceipt:record});
  }finally{if(this.operation===job)this.operation=null;w.busy=false;w.root?.ownerDocument.body.classList.remove('au-cloud-busy');w.render?.();}})();
  return job.promise;
 }
 acknowledge(record,entry){
  const w=this.w,c=record.context,k=this.key(c.projectId,record.clipId);
  const receipt=clipMuteReceipt(record.raw,{projectId:c.projectId,clipId:record.clipId,muted:record.requested});record.receipt=clone(receipt);record.status='confirmed';record.error=null;record.idempotencyInProgress=false;
  this.applyClip(c,receipt);this.overlay.delete(k);
  if(receipt.engine_reload_required||receipt.engine_applied!==true)this.reloadPending.set(k,w.engine.loadVersion||0);else this.reloadPending.delete(k);
  if(record.mode==='edit'&&receipt.changed!==false){const created={context:clone(c),clipId:record.clipId,before:receipt.undo.muted,after:record.requested};this.stack(this.past,c.projectId).push(created);w.recordOwnedHistory?.('clipMute',c.projectId);}
  const label=record.requested?'Clip muted':'Clip unmuted';
  w.engine.onStatus?.(receipt.engine_reload_required||receipt.engine_applied!==true?label+' and saved. The live engine has not applied it yet; it becomes audible after the project reloads.':label+'.');
  return record;
 }
 /** Shared ⌘Z/⌘⇧Z: PUT the receipt's undo value (or the redo value) with a new key. */
 async history(direction){
  const id=scope(this.w),from=this.stack(direction==='undo'?this.past:this.future,id),to=this.stack(direction==='undo'?this.future:this.past,id),entry=from.at(-1);
  if(!entry)return false;if(this.operation)throw new Error('Wait for the current clip mute request.');if(this.uncertain(id))throw new Error('Verify the pending clip mute before history.');
  const record=await this.write(entry.clipId,direction==='undo'?entry.before:entry.after,direction,entry);
  if(record.status!=='confirmed')return false;from.pop();to.push(entry);return true;
 }
 /** Explicit Verify: replay ONLY the retained original request (same key, body
  * and If-Match). A stored terminal response is adopted; a precondition
  * failure is decided by a canonical read and never answered with a new write. */
 reconcile(){
  if(this.verification)return this.verification;const id=scope(this.w),record=[...this.records].reverse().find(row=>row.context.projectId===id&&row.status==='uncertain');
  if(!record)return Promise.reject(new Error('No clip mute receipt is waiting for verification.'));
  if(!record.request)return Promise.reject(new Error('The original clip mute request is missing; no new request was sent.'));
  try{this.idle();this.assertContext(record.context);}catch(error){return Promise.reject(error);}
  const w=this.w,k=this.key(id,record.clipId);w.busy=true;w.root?.ownerDocument.body.classList.add('au-cloud-busy');
  const pending=(async()=>{try{
   let raw;try{raw=await w.engine.session.call(record.request.name,clone(record.request.arguments));}catch(error){
    this.assertContext(record.context);if(isIdempotencyInProgress(error)){record.idempotencyInProgress=true;throw error;}
    if(Number(error?.status)!==412)throw error;
    const read=unwrapRangeEditResult(await w.engine.session.call('get_project',{project_id:id}));this.assertContext(record.context);const project=read.project??read,clip=(project.clips||[]).find(row=>row.id===record.clipId);
    if(!clip)throw new Error('The clip is no longer in the canonical project.');
    this.overlay.delete(k);this.applyClip(record.context,{clip,clipMuted:clip.clipMuted===true,timelineRevision:project.timelineRevision});
    record.status=clip.clipMuted===true===record.requested?'confirmed':'rejected';record.error=null;record.readback=clone(clip);
    w.engine.onStatus?.('Clip mute verified from the saved project'+(record.status==='confirmed'?'.':'; the request was not applied.'));return record;
   }
   this.assertContext(record.context);record.raw=clone(raw);this.acknowledge(record,null);
   // A recovered Undo/Redo moves its entry exactly once in both histories.
   if(record.entry&&['undo','redo'].includes(record.mode)){const from=this.stack(record.mode==='undo'?this.past:this.future,id),to=this.stack(record.mode==='undo'?this.future:this.past,id);if(from.at(-1)===record.entry){w.ownedHistoryReconciled?.('clipMute',record);from.pop();to.push(record.entry);}}
   return record;
  }catch(error){record.error=error.message;throw error;}finally{if(this.verification===pending)this.verification=null;w.busy=false;w.root?.ownerDocument.body.classList.remove('au-cloud-busy');w.render?.();}})();
  this.verification=pending;return pending;
 }
}
