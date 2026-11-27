/** Logic 11 “Stem Splitter…” for Freestyle audio regions (Studio API 345).
 *
 * splitClipStems POST /projects/{id}/clips/{clip_id}/stems {mode, replace}
 * answers 202 with a StemJob (jobId, statusUrl = Location). getStemJob is a
 * read-only poll; `done` lists every created lane and its clips. undoStemJob
 * POST …/stems/jobs/{job_id}:undo removes exactly what the job created and
 * un-mutes a source it muted. All three are rate class `interactive`.
 *
 * Live 2026-11-12 (owned project 191d3c7bc7f84469, clip 779bc89c… “Cloud render
 * check”, mode vocals, replace:false): 202 rq5a82db1e…, done after 9 s with
 * lanes Instrumental + Vocal (both muted: Keep Original adds muted stems);
 * undoStemJob rq605a58ac… removed both lanes and clips → 8 lanes / 3 clips again.
 *
 * One split is ONE history step: Undo = undoStemJob, Redo = the same split again
 * (a new job). Progress is drawn on the source region while the job runs.
 *
 * Spec 357 job contract: 202 = a running job (statusUrl = its Location = getStemJob);
 * a backing split before answers at once with the finished job: 201 cached (the lanes
 * were created now: one history step as usual) or 200 deduplicated (the project still
 * has every stem lane of that earlier split: nothing was created, so NO history step —
 * its undoStemJob would delete tracks this step never made). getStemJob is polled at
 * the job's Retry-After (retryAfterSec, ~10 s) with backoff when it gives none; a 429
 * waits its Retry-After and a transient 5xx / network read is retried (a pure read), up
 * to STEM_POLL_READ_FAILURES in a row. Between polls the progress advances locally from
 * elapsedSec / etaSec every second. The POST carries one retained Idempotency-Key; an
 * unknown POST outcome is asked once more with that same key (Freestyle replays the
 * stored job, never a second split).
 *
 * Keep Original (Logic 11 semantics): the stem tracks play and the original region
 * is muted but kept. Freestyle lands replace:false stems muted, so after the job the
 * client unmutes each created lane (updateLane muted:false) and mutes the source
 * clip (setClipMuted, the region Mute op), confirmed by fresh lane/clip reads. Same
 * history step: Undo = undoStemJob, then the clip mute is put back (setClipMuted
 * with the receipt's undo.muted) when this step changed it. Replace is untouched.
 */
import {sendAudioClipMute} from './audio-clip-mute.js';
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const JOB=/^[a-f0-9]{32}$/;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const fail=(message,code='stem_split_invalid',extra={})=>Object.assign(new Error(message),{code},extra);
const refused=(message,code='stem_split_changed')=>fail(message,code,{dispatched:false,historyNotApplied:true});

export const STEM_SPLITTER_OPERATIONS=Object.freeze(['splitClipStems','getStemJob','undoStemJob']);
/** Keep Original audibility: lane unmute, region mute and their confirming reads. */
export const STEM_KEEP_ORIGINAL_OPERATIONS=Object.freeze(['listLanes','updateLane','listClips','setClipMuted']);
const rows=result=>Array.isArray(result?.data?.data)?result.data.data:Array.isArray(result?.data)?result.data:null;
/** Freestyle stem ids → Logic 11 stem names. */
export const STEM_NAMES=Object.freeze({instrumental:'Instrumental',vocals:'Vocals',drums:'Drums',bass:'Bass',other:'Other',guitar:'Guitar',piano:'Piano',kick:'Kick',snare:'Snare',toms:'Toms',hh:'Hi-Hat',ride:'Ride',crash:'Crash'});
/** The published modes (splitClipStems `mode` enum) with Logic-style names. */
export const STEM_MODES=Object.freeze([
 Object.freeze({mode:'vocals',label:'Vocals',detail:'Vocals and Instrumental'}),
 Object.freeze({mode:'four_stems',label:'Vocals, Drums, Bass, Other',detail:'Four stems, as Logic’s Stem Splitter'}),
 Object.freeze({mode:'instruments',label:'All Instruments',detail:'Every instrument stem Freestyle detects (the result lists them)'}),
 Object.freeze({mode:'drums',label:'Drum Kit Pieces',detail:'Kick, Snare, Toms, Hi-Hat, Ride, Crash'})
]);
export const STEM_POLL_LIMIT_MS=15*60*1000;
/** Poll pacing (seconds): the job's Retry-After when it gives one (bounded), else backoff 2, 4, 8, 10, 10, … */
export const STEM_POLL_MIN_SEC=1,STEM_POLL_MAX_SEC=30,STEM_POLL_BACKOFF_SEC=Object.freeze([2,4,8,10]);
/** Consecutive transient getStemJob read failures tolerated before the job is reported uncertain. */
export const STEM_POLL_READ_FAILURES=5;
/** Seconds to wait before the next getStemJob: Retry-After (body or header), else backoff by attempt. */
export function stemPollDelaySec({retryAfterSec=null,attempt=0}={}){
 const hint=Number(retryAfterSec);if(Number.isFinite(hint)&&hint>0)return Math.max(STEM_POLL_MIN_SEC,Math.min(STEM_POLL_MAX_SEC,Math.ceil(hint)));
 return STEM_POLL_BACKOFF_SEC[Math.min(Math.max(0,attempt|0),STEM_POLL_BACKOFF_SEC.length-1)];
}
/** How a splitClipStems answer created its job: 'started' (202), 'cached' (201, lanes created now) or 'deduplicated' (200, nothing created). */
export function stemSplitKind(result){
 const job=result?.data,status=Number(result?.status);
 if(job?.deduplicated===true||status===200&&job?.status==='done'&&job?.cached===true&&job?.deduplicated!==false)return'deduplicated';
 if(status===201||job?.cached===true&&job?.status==='done')return'cached';
 return'started';
}
const transient=error=>{const status=Number(error?.status);return !Number.isInteger(status)||status===0||status===408||status>=500;};
export const stemName=stem=>STEM_NAMES[stem]||String(stem||'Stem');
export const stemModeLabel=mode=>STEM_MODES.find(item=>item.mode===mode)?.label||String(mode||'');

/** Progress 0–1 of a processing job from its elapsed / ETA seconds (null = unknown). */
export function stemProgress(job){
 if(job?.status==='done')return 1;
 const elapsed=Number(job?.elapsedSec),eta=Number(job?.etaSec);
 if(!Number.isFinite(elapsed)||!Number.isFinite(eta)||elapsed<0||eta<0)return null;
 return Math.max(.02,Math.min(.97,eta>0?elapsed/(elapsed+eta):.97));
}
/** Validate one StemJob body for this project / clip. */
export function checkStemJob(job,{projectId,clipId=null,jobId=null}={}){
 if(!record(job)||!JOB.test(job.jobId||'')||!['processing','failed','done','undone'].includes(job.status))throw fail('Freestyle returned an unreadable Stem Splitter job.','stem_split_receipt',{operationUncertain:true});
 if(job.projectId!=null&&job.projectId!==projectId||jobId&&job.jobId!==jobId||clipId&&job.sourceClipId!=null&&job.sourceClipId!==clipId)throw fail('Freestyle returned another region’s Stem Splitter job.','stem_split_receipt',{operationUncertain:true});
 if(typeof job.statusUrl==='string'&&job.statusUrl&&!job.statusUrl.split(/[?#]/)[0].endsWith('/stems/jobs/'+job.jobId))throw fail('Freestyle named another Stem Splitter job’s status URL.','stem_split_receipt',{operationUncertain:true});
 if(job.status==='done'&&(!Array.isArray(job.lanes)||!job.lanes.length||job.lanes.some(lane=>!id(lane?.laneId)||!Array.isArray(lane.clipIds))))throw fail('Freestyle finished the split but did not list the new tracks.','stem_split_receipt',{operationUncertain:true});
 return job;
}

/**
 * options: client() → StudioApiClient|null; scope() → {projectId}|null;
 * history() → CloudPatternHistory|null; refresh(context) → reload lanes/clips;
 * onChange(clipId); log(event, detail); sleep(ms); now().
 */
export class StemSplitController{
 constructor({client,scope,history=()=>null,refresh=null,onChange=()=>{},log=()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>Date.now(),key=()=>globalThis.crypto?.randomUUID?.()||`stems-${Date.now()}-${Math.random().toString(36).slice(2)}`}={}){
  if(typeof client!=='function'||typeof scope!=='function')throw new TypeError('StemSplitController needs client and scope.');
  Object.assign(this,{client,scope,history,refresh,onChange,log,sleep,now,key});this.jobs=new Map();this.running=null;
 }
 get busy(){return !!this.running;}
 /** {status: starting|processing|done|failed, progress, mode, stems, error} for a region, or null. */
 job(clipId){return this.jobs.get(clipId)||null;}
 reset(){this.jobs.clear();}
 api(){const client=this.client();if(typeof client?.call!=='function')throw fail('Stem Splitter needs a Studio API (OAuth) project. Reload the project.','stem_split_unavailable',{dispatched:false});return client;}
 context(){const scope=this.scope();if(!id(scope?.projectId))throw fail('Open a Freestyle project first.','stem_split_scope',{dispatched:false});return{projectId:scope.projectId};}
 assertContext(context){if(this.scope()?.projectId!==context.projectId)throw fail('The project changed while the stems were being split. The job continues in Freestyle; reopen the project to see it.','stem_split_scope',{operationUncertain:true});}
 notify(clipId){try{this.onChange(clipId);}catch{}}
 update(clipId,patch){const entry={...(this.jobs.get(clipId)||{}),...patch};this.jobs.set(clipId,entry);this.notify(clipId);return entry;}
 /** POST the split (one retained Idempotency-Key), then poll the job until it is done or
  * failed. Returns the job with `splitKind` = started | cached | deduplicated. */
 async run(clip,{mode,replace},context){
  const request=['splitClipStems',{path:{project_id:context.projectId,clip_id:clip.cloudId},body:{mode,replace}},{idempotencyKey:this.key()}];let result;
  try{result=await this.api().call(...request);}
  catch(error){
   // A lost answer: the same key replays the stored job (never a second split).
   // 503 stem_extraction_disabled is a definite refusal: nothing was queued.
   if(error?.code==='stem_extraction_disabled')throw Object.assign(error,{operationUncertain:false,historyNotApplied:true});
   // 429 (stem split limit) and other 4xx answers are definite refusals: nothing was queued,
   // so an Undo/Redo step that hits them stays as it was (never "uncertain").
   if(Number.isInteger(error?.status)&&error.status>=400&&error.status<500&&error.status!==408)throw Object.assign(error,{operationUncertain:false,historyNotApplied:true});
   if(error?.operationUncertain!==true&&!(transient(error)&&error?.dispatched!==false))throw error;
   this.assertContext(context);this.log('stem-split-replay',{clipId:clip.cloudId,status:error?.status??null});
   try{result=await this.api().call(...request);}catch(again){throw Object.assign(again,again?.code==='stem_extraction_disabled'?{operationUncertain:false,historyNotApplied:true}:{operationUncertain:again?.operationUncertain??transient(again)});}
  }
  this.assertContext(context);
  let job=checkStemJob(result?.data,{projectId:context.projectId,clipId:clip.cloudId});const started=this.now(),splitKind=stemSplitKind(result);
  this.log('stem-split-start',{clipId:clip.cloudId,jobId:job.jobId,mode,replace,status:result?.status??null,splitKind});
  let attempt=0,failures=0;
  while(job.status==='processing'){
   this.update(clip.cloudId,{status:'processing',jobId:job.jobId,progress:stemProgress(job),stems:job.expectedStems||null,etaSec:job.etaSec??null,elapsedSec:job.elapsedSec??null});
   let delay=stemPollDelaySec({retryAfterSec:job.retryAfterSec,attempt:attempt++});
   for(;;){
    if(this.now()-started>STEM_POLL_LIMIT_MS)throw fail('Freestyle is still splitting this region. The job continues; reopen the project later to see its tracks.','stem_split_timeout',{operationUncertain:true});
    // Wait in one-second steps; the region's progress advances from elapsed / ETA meanwhile.
    for(let waited=1;waited<=delay;waited++){
     await this.sleep(1000);this.assertContext(context);
     if(waited<delay&&Number.isFinite(Number(job.elapsedSec))&&Number.isFinite(Number(job.etaSec)))this.update(clip.cloudId,{progress:stemProgress({status:'processing',elapsedSec:Number(job.elapsedSec)+waited,etaSec:Math.max(0,Number(job.etaSec)-waited)})});
    }
    try{const read=await this.api().call('getStemJob',{path:{project_id:context.projectId,job_id:job.jobId}});this.assertContext(context);job=checkStemJob(read?.data,{projectId:context.projectId,clipId:clip.cloudId,jobId:job.jobId});failures=0;break;}
    catch(error){
     if(error?.code==='stem_split_scope'||error?.code==='stem_split_receipt')throw error;
     const status=Number(error?.status);
     if(status===429||transient(error)){
      if(++failures>STEM_POLL_READ_FAILURES)throw Object.assign(fail(`Freestyle has not answered the Stem Splitter job status (${error?.message||error}). The job continues; reopen the project later to see its tracks.`,'stem_split_poll',{operationUncertain:true}),{cause:error});
      this.log('stem-split-poll-retry',{jobId:job.jobId,status:Number.isFinite(status)?status:null,failures});
      delay=stemPollDelaySec({retryAfterSec:status===429?error?.retryAfter:null,attempt:failures-1});continue;
     }
     throw Object.assign(error,{operationUncertain:true});
    }
   }
  }
  if(job.status==='failed')throw fail(`Stem Splitter failed: ${job.error||'Freestyle could not split this region.'} Nothing was created.`,'stem_split_failed',{historyNotApplied:true});
  if(job.status!=='done')throw fail('Freestyle reported the split as '+job.status+'.','stem_split_receipt',{operationUncertain:true});
  // Job receipts can be frozen (deepFreeze'd client results): return a copy, never mutate.
  return {...job,splitKind};
 }
 async reload(context){try{await this.refresh?.(context);}catch(error){this.log('stem-split-refresh',{message:String(error?.message||error).slice(0,160)});}}
 /** Remove exactly what one job created (undoStemJob). */
 async undoJob(jobId,context){
  const result=await this.api().call('undoStemJob',{path:{project_id:context.projectId,job_id:jobId},body:{}});this.assertContext(context);
  const data=result?.data;if(!record(data)||data.jobId!==jobId||data.undone!==true||!Array.isArray(data.removedLaneIds)||!Array.isArray(data.removedClipIds)||data.projectId!=null&&data.projectId!==context.projectId)throw fail('Freestyle did not confirm removing the stem tracks.','stem_split_receipt',{operationUncertain:true});
  this.log('stem-split-undo',{jobId,removedLanes:data.removedLaneIds.length,removedClips:data.removedClipIds.length,alreadyUndone:data.alreadyUndone===true,liveApplied:data.liveEngine?.applied??null,engineReloadRequired:data.engine_reload_required===true});
  await this.reload(context);return data;
 }
 /** Keep Original (Logic): unmute the job's stem lanes, mute the source region, confirm
  * both by fresh reads. Throws with `partial` = what was confirmed before the failure. */
 async keepOriginal(clip,job,context){
  const api=this.api(),project_id=context.projectId,laneIds=job.lanes.map(lane=>lane.laneId),done={unmutedLaneIds:[],sourceMute:null};
  const readLanes=async()=>{const result=await api.call('listLanes',{path:{project_id},query:{limit:200}});this.assertContext(context);const lanes=rows(result);if(!lanes)throw fail('Freestyle returned no readable track list.','stem_keep_original',{operationUncertain:true});return{lanes,etag:typeof result?.etag==='string'&&result.etag?result.etag:null};};
  const readClip=async()=>{const result=await api.call('listClips',{path:{project_id},query:{...id(clip.laneId)?{lane_id:clip.laneId}:{},limit:200}});this.assertContext(context);const found=(rows(result)||[]).filter(item=>item?.id===clip.cloudId);if(found.length!==1)throw fail('Freestyle no longer lists the original region.','stem_keep_original',{operationUncertain:true});return found[0];};
  try{
   let {lanes,etag}=await readLanes();
   for(const laneId of laneIds){
    const lane=lanes.find(item=>item?.id===laneId);if(!lane)throw fail('Freestyle has not listed the new stem track.','stem_keep_original',{operationUncertain:true});
    if(lane.muted===false)continue;
    const result=await api.call('updateLane',{path:{project_id,lane_id:laneId},body:{muted:false}},etag?{ifMatch:etag}:{});this.assertContext(context);
    if(result?.data?.lane?.muted!==false)throw fail('Freestyle did not confirm unmuting the stem track.','stem_keep_original',{operationUncertain:true});
    etag=typeof result?.etag==='string'&&result.etag?result.etag:null;done.unmutedLaneIds.push(laneId);
   }
   const source=await readClip();
   if(source.clipMuted===true)done.sourceMute={changed:false};
   else{const receipt=await sendAudioClipMute(api,{projectId:project_id,clipId:clip.cloudId,muted:true});this.assertContext(context);done.sourceMute={changed:receipt.changed,undoMuted:receipt.undo.muted,engineApplied:receipt.engineApplied};}
   ({lanes}=await readLanes());const after=await readClip();
   if(laneIds.some(laneId=>lanes.find(item=>item?.id===laneId)?.muted!==false)||after.clipMuted!==true)throw fail('Freestyle has not confirmed the stems audible and the original region muted.','stem_keep_original',{operationUncertain:true});
   return done;
  }catch(error){throw Object.assign(error instanceof Error?error:fail(String(error),'stem_keep_original'),{partial:done});}
 }
 /** keepOriginal that never throws: {unmutedLaneIds, sourceMute, error}. */
 async keepOriginalSettled(clip,job,context){
  try{return{...await this.keepOriginal(clip,job,context),error:null};}
  catch(error){this.log('stem-split-keep-original',{clipId:clip.cloudId,jobId:job.jobId,message:String(error?.message||error).slice(0,160)});return{...(error?.partial||{unmutedLaneIds:[],sourceMute:null}),error};}
 }
 /** Undo of a Keep Original mute: put the region mute back (receipt undo.muted). */
 async restoreSourceMute(clip,sourceMute,context){
  if(!sourceMute?.changed)return null;
  try{const receipt=await sendAudioClipMute(this.api(),{projectId:context.projectId,clipId:clip.cloudId,muted:sourceMute.undoMuted});return receipt.clipMuted;}
  catch(error){throw Object.assign(fail(`The stem tracks were removed, but the original region could not be unmuted (${error?.message||error}). Unmute it with the Mute tool.`,'stem_keep_original',{operationUncertain:error?.operationUncertain===true||!(Number.isInteger(error?.status)&&error.status>=400&&error.status<500)}),{cause:error});}
 }
 begin(label){const history=this.history();let token=null;try{token=history?.beginExternalStep?.({kind:'stem_split',label})??null;}catch(error){throw Object.assign(error,{dispatched:false});}return{history,token};}
 /** Split one audio region into stems. One history step. */
 async split(clip,{mode,replace=true}={}){
  if(this.running)throw fail('Wait for the current Stem Splitter job to finish.','stem_split_busy',{dispatched:false});
  if(!id(clip?.cloudId)||clip.patternId)throw fail('Stem Splitter works on saved audio regions.','stem_split_invalid',{dispatched:false});
  if(!STEM_MODES.some(item=>item.mode===mode))throw fail('Choose which stems to split.','stem_split_invalid',{dispatched:false});
  if(typeof replace!=='boolean')throw fail('Choose Replace or Keep Original.','stem_split_invalid',{dispatched:false});
  const context=this.context();this.api();const label=`Stem Splitter (${stemModeLabel(mode)})`;let pending=null,sent=false;
  const running=(async()=>{
   try{
    this.update(clip.cloudId,{status:'starting',progress:null,mode,replace,error:null,stems:null});
    pending=this.begin(label);sent=true;const job=await this.run(clip,{mode,replace},context);
    // 200 deduplicated: the project already holds every stem track of an earlier split and
    // nothing was created. No history step (its undoStemJob would delete those older tracks).
    if(job.splitKind==='deduplicated'){
     if(pending.token)try{pending.history.failExternalStep(pending.token,{message:'Stem Splitter: the stem tracks already exist.',operationUncertain:false});}catch{}
     pending=null;await this.reload(context);this.update(clip.cloudId,{status:'done',progress:1,jobId:job.jobId,stems:job.lanes.map(lane=>lane.stem)});
     this.log('stem-split-deduplicated',{clipId:clip.cloudId,jobId:job.jobId,lanes:job.lanes.length});
     return{job,journaled:false,deduplicated:true,label,lanes:job.lanes.map(lane=>({laneId:lane.laneId,stem:lane.stem,name:lane.name||stemName(lane.stem),muted:lane.muted===true}))};
    }
    // Keep Original: stems audible, original region muted — inside this same step.
    const keep=replace?null:await this.keepOriginalSettled(clip,job,context);
    await this.reload(context);this.update(clip.cloudId,{status:'done',progress:1,jobId:job.jobId,stems:job.lanes.map(lane=>lane.stem)});
    const current={jobId:job.jobId,sourceMute:keep?.sourceMute||null},name=clip.name||'Region';
    const undo=async()=>{const now=this.context();if(now.projectId!==context.projectId)throw refused('Reopen the region’s project to use its Stem Splitter history.');const data=await this.undoJob(current.jobId,now);const restored=await this.restoreSourceMute(clip,current.sourceMute,now);if(current.sourceMute?.changed){current.sourceMute=null;await this.reload(now);}return{jobId:current.jobId,removedLaneIds:data.removedLaneIds||[],alreadyUndone:data.alreadyUndone===true,...restored===null?{}:{sourceClipMuted:restored}};};
    const redo=async()=>{const now=this.context();if(now.projectId!==context.projectId)throw refused('Reopen the region’s project to use its Stem Splitter history.');const again=await this.run(clip,{mode,replace},now);current.jobId=again.jobId;const kept=replace?null:await this.keepOriginalSettled(clip,again,now);current.sourceMute=kept?.sourceMute||null;await this.reload(now);this.update(clip.cloudId,{status:'done',progress:1,jobId:again.jobId});return{jobId:again.jobId,lanes:again.lanes.map(lane=>lane.laneId),...kept?{keepOriginal:{unmutedLaneIds:kept.unmutedLaneIds,sourceMuted:!!kept.sourceMute,error:kept.error?.message||null}}:{}};};
    let journaled=false;if(pending.history){journaled=pending.token?pending.history.finishExternalStep(pending.token,{label:`${label} – ${name}`,detail:{clipId:clip.cloudId,jobId:job.jobId,mode,replace},undo,redo})===true:pending.history.recordExternalStep?.({kind:'stem_split',label:`${label} – ${name}`,detail:{clipId:clip.cloudId,jobId:job.jobId,mode,replace},undo,redo})===true;}
    pending=null;this.log('stem-split-done',{clipId:clip.cloudId,jobId:job.jobId,lanes:job.lanes.length,journaled});
    const unmuted=new Set(keep?.unmutedLaneIds||[]);
    return{job,journaled,label,lanes:job.lanes.map(lane=>({laneId:lane.laneId,stem:lane.stem,name:lane.name||stemName(lane.stem),muted:lane.muted===true&&!unmuted.has(lane.laneId)})),
     ...keep?{keepOriginal:{unmutedLaneIds:[...unmuted],sourceMuted:!!keep.sourceMute,sourceMuteChanged:keep.sourceMute?.changed===true,error:keep.error?.message||null}}:{}};
   }catch(error){
    if(pending?.token)try{pending.history.failExternalStep(pending.token,error);}catch{}
    if(!sent&&error.dispatched===undefined)error.dispatched=false;
    const status=error?.status;if(sent&&error.historyNotApplied!==true&&!(Number.isInteger(status)&&status>=400&&status<500&&status!==408))error.operationUncertain=true;
    this.update(clip.cloudId,{status:'failed',progress:null,error:error.message});
    throw error;
   }
  })();
  this.running=running;try{return await running;}finally{if(this.running===running)this.running=null;}
 }
}

/** The Stem Splitter dialog body (Logic 11: choose stems; Replace / Keep original). */
export function stemSplitterDialogHtml({name='Region',mode='vocals',replace=true}={}){
 const modes=STEM_MODES.map(item=>`<label class="logic-stem-mode"><input type="radio" name="stem-mode" value="${esc(item.mode)}"${item.mode===mode?' checked':''}><span><b>${esc(item.label)}</b><small>${esc(item.detail)}</small></span></label>`).join('');
 return `<form class="logic-stem-form" method="dialog"><p>Split “${esc(name)}” into stems on new tracks below it. Freestyle separates the audio in the cloud.</p>`
  +`<fieldset><legend>Stems</legend>${modes}</fieldset>`
  +`<fieldset><legend>Original region</legend><label><input type="radio" name="stem-replace" value="replace"${replace?' checked':''}> Replace (mute the original; the stems play)</label><label><input type="radio" name="stem-replace" value="keep"${replace?'':' checked'}> Keep Original (the stems play; the original region is kept, muted)</label></fieldset>`
  +`<div class="logic-stem-actions"><button type="button" data-stem-cancel>Cancel</button><button type="submit" class="primary" data-stem-split>Split</button></div></form>`;
}
/** Read the dialog choice. */
export function stemSplitterChoice(form){
 const mode=form?.querySelector?.('input[name="stem-mode"]:checked')?.value,replace=form?.querySelector?.('input[name="stem-replace"]:checked')?.value;
 if(!STEM_MODES.some(item=>item.mode===mode)||!['replace','keep'].includes(replace))return null;
 return{mode,replace:replace==='replace'};
}
/** Region overlay while a job runs. */
export function stemProgressHtml(entry){
 if(!entry||!['starting','processing'].includes(entry.status))return'';
 const pct=entry.progress==null?null:Math.round(entry.progress*100),text=entry.status==='starting'?'Stem Splitter…':`Splitting${pct==null?'…':` ${pct}%`}`;
 return `<div class="logic-stem-progress" role="progressbar" aria-label="Stem Splitter" ${pct==null?'':`aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"`}><span class="logic-stem-bar" style="width:${pct==null?100:pct}%"></span><small>${esc(text)}</small></div>`;
}
