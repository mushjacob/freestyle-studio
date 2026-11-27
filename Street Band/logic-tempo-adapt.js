/** Logic “Tempo change: Keep / Adapt Project Tempo” over Freestyle (Studio API 357).
 *
 * setProjectTempo PUT /projects/{id}/tempo {bpm, mode}:
 *  - keep_time (default): clips keep their time. On a Studio API project the KEEP
 *    LCD edit is ONE guarded PUT {bpm, mode:'keep_time'} with If-Match = the
 *    fresh getTimingMap ETag (the timing-map revision, e.g. "0" — never the
 *    project/timeline ETag, which Freestyle refuses with 400 invalid_argument),
 *    recorded as ONE external history step (Undo/Redo = the same PUT back/forth
 *    at a fresh timing-map ETag). Without a Studio API client the app keeps its
 *    edit() → set_project_tempo path.
 *  - stretch_audio (Logic “Adapt Project Tempo”): a pitch-preserving stretch job;
 *    regions, placements, automation and timed lyrics stay on their bar/beat.
 *    202 + TempoStretchJob {job_id, status queued|running|succeeded|failed|undone,
 *    status_url (= Location), retryAfterSec, progress, engine.reload}.
 *    If-Match = the timing-map ETag (412 when it moved); a non-constant map is
 *    409 tempo_map_not_constant; while the job runs, timeline writes answer 409
 *    tempo_stretch_in_progress.
 * getTempoStretchJob GET …/tempo-jobs/{job_id} is the read-only poll.
 * undoTempoStretchJob POST …/tempo-jobs/{job_id}:undo restores tempo, positions
 * and the original audio exactly; 409 tempo_stretch_undo_conflict when anything it
 * would overwrite changed since (nothing restored: the history step stays).
 *
 * One Adapt edit is ONE history step: Undo = undoTempoStretchJob, Redo = the same
 * stretch to the target BPM again (a new job). The Keep / Adapt choice is a UI
 * preference stored per project in localStorage (Logic: Project Settings ▸ Smart
 * Tempo; shown as KEEP / ADAPT under the LCD tempo).
 */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const fail=(message,code='tempo_adapt_invalid',extra={})=>Object.assign(new Error(message),{code},extra);
const refused=(message,code='tempo_adapt_refused',extra={})=>fail(message,code,{dispatched:false,historyNotApplied:true,...extra});

export const TEMPO_ADAPT_OPERATIONS=Object.freeze(['getTimingMap','setProjectTempo','getTempoStretchJob','undoTempoStretchJob']);
/** Optional: after a save whose live engine could not be reloaded (engine_reload_required). */
export const TEMPO_ADAPT_RELOAD_OPERATION='reloadEngineSession';
export const TEMPO_MODES=Object.freeze(['keep','adapt']);
export const TEMPO_BPM_MIN=20,TEMPO_BPM_MAX=400;
/** The server times a job out after 30 minutes; the client stops watching just after. */
export const TEMPO_JOB_POLL_LIMIT_MS=31*60*1000;
/** Background engine reload after the swap: keep reading the job this long while it is 'pending'. */
export const TEMPO_RELOAD_WAIT_MS=30*1000;
const ACTIVE=new Set(['queued','running']),STATUSES=new Set(['queued','running','succeeded','failed','undone']);

// ── Per-project Keep / Adapt preference (localStorage; a UI preference, not project data)
export const tempoModeKey=projectId=>'illogic:tempoMode:'+projectId;
export function readTempoMode(storage,projectId){
 if(!id(projectId))return'keep';
 try{const value=storage?.getItem?.(tempoModeKey(projectId));return value==='adapt'?'adapt':'keep';}catch{return'keep';}
}
export function writeTempoMode(storage,projectId,mode){
 if(!id(projectId)||!TEMPO_MODES.includes(mode))return false;
 try{if(mode==='keep')storage?.removeItem?.(tempoModeKey(projectId));else storage?.setItem?.(tempoModeKey(projectId),'adapt');return true;}catch{return false;}
}
export const tempoModeLcd=mode=>mode==='adapt'?'ADAPT':'KEEP';
export const tempoModeName=mode=>mode==='adapt'?'Adapt Project Tempo':'Keep Project Tempo';
/** "128", "127.5", "99.125" (at most three decimals, as the LCD). */
export function formatBpm(bpm){const value=Number(bpm);if(!Number.isFinite(value))return'?';return String(Math.round(value*1000)/1000);}

/** The job id addressed by a status_url / Location for this project, or null. */
export function tempoJobIdFromUrl(url,projectId){
 if(typeof url!=='string'||!url)return null;
 const match=/\/projects\/([^/?#]+)\/tempo-jobs\/([^/?#:]+)(?:[?#]|$)/.exec(url);if(!match)return null;
 let project,job;try{project=decodeURIComponent(match[1]);job=decodeURIComponent(match[2]);}catch{return null;}
 return project===projectId&&id(job)?job:null;
}
/** Validate one TempoStretchJob body for this project (and job). */
export function checkTempoJob(job,{projectId,jobId=null}={}){
 if(!record(job)||!id(job.job_id)||!STATUSES.has(job.status))throw fail('Freestyle returned an unreadable tempo stretch job.','tempo_adapt_receipt',{operationUncertain:true});
 if(job.projectId!=null&&job.projectId!==projectId||jobId&&job.job_id!==jobId)throw fail('Freestyle returned another project’s tempo stretch job.','tempo_adapt_receipt',{operationUncertain:true});
 if(job.mode!=null&&job.mode!=='stretch_audio')throw fail('Freestyle returned a tempo job that is not an audio stretch.','tempo_adapt_receipt',{operationUncertain:true});
 const located=tempoJobIdFromUrl(job.status_url,projectId);
 if(job.status_url!=null&&located!==job.job_id)throw fail('The tempo job’s status location does not match the job.','tempo_adapt_receipt',{operationUncertain:true});
 return job;
}
/** {done,total} from progress.renders_succeeded / renders_total, or null when unknown. */
export function tempoJobProgress(job){
 const done=Number(job?.progress?.renders_succeeded),total=Number(job?.progress?.renders_total);
 if(!Number.isInteger(done)||!Number.isInteger(total)||total<=0||done<0)return null;return{done:Math.min(done,total),total};
}
/** Status-line text while a stretch (or its undo/redo) runs. */
export function tempoAdaptStatusText(state){
 if(!state||!['starting','running','reloading','undoing'].includes(state.status))return'';
 if(state.status==='undoing')return`Restoring the audio to ${formatBpm(state.fromBpm)} BPM…`;
 const progress=state.progress,detail=state.status==='reloading'?' (reloading the engine)':progress?` (${progress.done}/${progress.total} region${progress.total===1?'':'s'})`:'';
 return`Adapting audio to ${formatBpm(state.toBpm)} BPM…${detail}`;
}
const changedText=details=>{const list=Array.isArray(details?.changed)?details.changed.filter(item=>typeof item==='string'||record(item)).map(item=>typeof item==='string'?item:item.kind||item.field||item.what||'').filter(Boolean):[];return list.length?` (${[...new Set(list)].slice(0,4).join(', ')})`:'';};
export const TEMPO_ENGINE_REVISION_MESSAGE='Freestyle could not adapt the audio (timing map revision check failed in the engine). Nothing was changed.';
/** A clear Logic-worded message for the Freestyle tempo-stretch codes, or null. */
export function tempoStretchMessage(error){
 const code=error?.code,status=error?.status,details=error?.details||error?.data?.error?.details||null;
 if(code==='tempo_stretch_in_progress')return'Freestyle is adapting the audio to a new tempo. Edit the regions again when it finishes.';
 if(code==='tempo_stretch_undo_conflict')return`Can’t undo Adapt Project Tempo: regions, automation or the tempo changed after the audio was adapted${changedText(details)}. Undo those edits first; this step stays in the history.`;
 if(code==='tempo_stretch_not_undoable')return'This tempo change can’t be undone yet: its audio stretch is still running or failed.';
 if(code==='tempo_map_not_constant')return'This project has tempo changes or ramps. Adapt Project Tempo needs one constant tempo; edit it in Tempo & Time Signatures….';
 if(code==='tempo_out_of_range')return`Adapt Project Tempo would take an already-stretched region outside ${TEMPO_BPM_MIN}–${TEMPO_BPM_MAX} BPM. Choose a tempo closer to the original.`;
 if(code==='tempo_stretch_project_changed')return`Adapt Project Tempo stopped: the project was edited while the audio was being adapted${changedText(details)}. Nothing was stretched; the edit was kept.`;
 // Only a 412 on the PUT (If-Match = the timing-map ETag) means the tempo really moved first.
 if(status===412)return'The tempo changed in Freestyle before the audio could be adapted. Nothing was changed; try again.';
 // A stretch JOB that ends failed/timing_map_revision_conflict is the engine's own revision check
 // ("The timing map is at revision 0, not 0" — engine request K), not a concurrent tempo edit.
 if(code==='timing_map_revision_conflict')return TEMPO_ENGINE_REVISION_MESSAGE;
 return null;
}
const transient=error=>{const status=error?.status;return !Number.isInteger(status)||status===0||status===408||status===429||status>=500;};
const retryAfterMs=error=>{const value=Number(error?.retryAfter);return Number.isFinite(value)&&value>=0?Math.min(30,value)*1000:null;};
/** Next poll delay: the job’s retryAfterSec (1–15 s), else a 1 s → 5 s backoff. */
export function tempoPollDelay(job,attempt=0){
 const hint=Number(job?.retryAfterSec);if(Number.isFinite(hint)&&hint>0)return Math.min(15,Math.max(1,hint))*1000;
 return Math.min(5000,Math.round(1000*1.5**Math.max(0,attempt)));
}

/**
 * options: client() → StudioApiClient|null; scope() → {projectId}|null;
 * history() → CloudPatternHistory|null; refresh(context) → reload the project
 * (bpm, clips, placements); onChange(state); log(event, detail); sleep(ms); now().
 */
export class TempoAdaptController{
 constructor({client,scope,history=()=>null,refresh=null,prepare=null,onChange=()=>{},log=()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>Date.now()}={}){
  if(typeof client!=='function'||typeof scope!=='function')throw new TypeError('TempoAdaptController needs client and scope.');
  Object.assign(this,{client,scope,history,refresh,prepare,onChange,log,sleep,now});this.running=null;this.current=null;
 }
 get busy(){return !!this.running;}
 /** {status: idle|starting|running|reloading|undoing|done|failed, fromBpm, toBpm, jobId, progress, error}. */
 state(){return this.current?{...this.current}:{status:'idle'};}
 statusText(){return tempoAdaptStatusText(this.current);}
 /** The message shown when another edit is attempted while a stretch runs. */
 blockMessage(action='editing'){const state=this.current;if(state?.status==='saving')return`Saving the tempo (${formatBpm(state.toBpm)} BPM)… Wait for it to finish before ${action}.`;const what=state?.status==='undoing'?`Restoring the audio to ${formatBpm(state.fromBpm)} BPM`:`Adapting audio to ${formatBpm(state?.toBpm)} BPM`;return`${what}… Wait for it to finish before ${action}.`;}
 update(patch){this.current={...(this.current||{}),...patch};try{this.onChange(this.state());}catch{}return this.current;}
 api(){const client=this.client();if(typeof client?.call!=='function')throw refused('Adapt Project Tempo needs a Studio API (OAuth) project. Reload the project.','tempo_adapt_unavailable');return client;}
 context(){const scope=this.scope();if(!id(scope?.projectId))throw refused('Open a Freestyle project first.','tempo_adapt_scope');return{projectId:scope.projectId};}
 assertContext(context){if(this.scope()?.projectId!==context.projectId)throw fail('The project changed while its audio was being adapted. The job continues in Freestyle; reopen the project to see it.','tempo_adapt_scope',{operationUncertain:true});}
 /** Re-raise a Studio error with the Logic message; a refused 4xx changed nothing. */
 explain(error){
  const message=tempoStretchMessage(error);if(message)error.message=message;
  const status=error?.status;if(Number.isInteger(status)&&status>=400&&status<500&&status!==408&&status!==429){error.dispatched=false;error.historyNotApplied=true;}
  return error;
 }
 /** Fresh timing map: constant tempo, current BPM; returns its ETag (If-Match). */
 async timing(context,fromBpm,{keep=false}={}){
  const result=await this.api().call('getTimingMap',{path:{project_id:context.projectId}});this.assertContext(context);
  const map=result?.data;if(!record(map)||map.projectId!=null&&map.projectId!==context.projectId)throw refused('Freestyle returned no readable tempo map.','tempo_adapt_receipt');
  if(map.is_constant_tempo===false)throw refused((keep?tempoKeepMessage:tempoStretchMessage)({code:'tempo_map_not_constant'}),'tempo_map_not_constant');
  const saved=Number(map.bpm_at_start??map.tempo?.[0]?.bpm);
  if(finite(fromBpm)&&Number.isFinite(saved)&&Math.abs(saved-fromBpm)>.0005)throw refused(`Freestyle’s tempo is now ${formatBpm(saved)} BPM. Reload the project before ${keep?'changing':'adapting'} the tempo.`,'tempo_adapt_changed');
  // getTimingMap: "ETag = revision". The header is the guard; a missing header falls back to the read revision.
  const revision=Number.isInteger(map.revision)&&map.revision>=0?map.revision:null,etag=typeof result?.etag==='string'&&result.etag&&!/[\r\n]/.test(result.etag)?result.etag:revision!==null?JSON.stringify(String(revision)):null;
  return{etag,bpm:Number.isFinite(saved)?saved:null,revision};
 }
 /** PUT the stretch and poll it to a terminal status. */
 async stretch(bpm,context,{fromBpm=null}={}){
  const timing=await this.timing(context,fromBpm);
  let result;
  try{result=await this.api().call('setProjectTempo',{path:{project_id:context.projectId},body:{bpm,mode:'stretch_audio'}},timing.etag?{ifMatch:timing.etag}:{});}
  catch(error){throw this.explain(error);}
  this.assertContext(context);
  const data=result?.data;
  if(!record(data)||data.job_id==null&&result?.status!==202){
   // 200 without a job: Freestyle had nothing to stretch (same tempo). Nothing to undo.
   this.log('tempo-adapt-no-job',{bpm,status:result?.status??null});return{job:null,from:timing.bpm};
  }
  let job=checkTempoJob(data,{projectId:context.projectId});
  this.log('tempo-adapt-start',{jobId:job.job_id,from:job.from_bpm,to:job.to_bpm,status:job.status,replay:job.replay===true});
  job=await this.poll(job,context);
  return{job,from:Number.isFinite(Number(job.from_bpm))?Number(job.from_bpm):timing.bpm};
 }
 /** Read the job until it is no longer queued/running (and its engine reload settled). */
 async poll(job,context){
  const started=this.now(),jobId=tempoJobIdFromUrl(job.status_url,context.projectId)||job.job_id;let attempt=0,failures=0,reloadSince=null;
  const read=async()=>{
   for(;;){
    try{const result=await this.api().call('getTempoStretchJob',{path:{project_id:context.projectId,job_id:jobId}});this.assertContext(context);failures=0;return checkTempoJob(result?.data,{projectId:context.projectId,jobId});}
    catch(error){if(error?.code==='tempo_adapt_scope'||!transient(error)||++failures>6)throw Object.assign(this.explain(error),{operationUncertain:error?.historyNotApplied!==true});
     this.log('tempo-adapt-poll-retry',{jobId,status:error?.status??0,failures});await this.sleep(retryAfterMs(error)??tempoPollDelay(null,failures));this.assertContext(context);}
   }
  };
  for(;;){
   const reloading=job.status==='succeeded'&&job.engine?.reload==='pending';
   if(!ACTIVE.has(job.status)&&!reloading)return job;
   if(reloading){reloadSince??=this.now();if(this.now()-reloadSince>TEMPO_RELOAD_WAIT_MS)return job;}
   this.update({status:reloading?'reloading':'running',jobId,progress:tempoJobProgress(job)});
   if(this.now()-started>TEMPO_JOB_POLL_LIMIT_MS)throw fail('Freestyle is still adapting the audio. The job continues; reopen the project later to see it.','tempo_adapt_timeout',{operationUncertain:true});
   await this.sleep(tempoPollDelay(job,attempt++));this.assertContext(context);
   job=await read();
  }
 }
 /** A saved stretch/undo whose live engine still plays the old arrangement. */
 async reloadEngine(job,context){
  if(job?.engine_reload_required!==true&&job?.engine?.engine_reload_required!==true)return false;
  try{await this.api().call(TEMPO_ADAPT_RELOAD_OPERATION,{path:{project_id:context.projectId},body:{}});this.log('tempo-adapt-engine-reload',{jobId:job.job_id});return true;}
  catch(error){this.log('tempo-adapt-engine-reload',{jobId:job.job_id,message:String(error?.message||error).slice(0,160)});return false;}
 }
 async reload(context){try{await this.refresh?.(context);}catch(error){this.log('tempo-adapt-refresh',{message:String(error?.message||error).slice(0,160)});}}
 failedJob(job){const message=job.error?.message||'Freestyle could not adapt the audio.',code=job.error?.code;return refused(tempoStretchMessage({code,details:job.error?.details})||`Adapt Project Tempo failed: ${message.replace(/[.]$/,'')}. Nothing was changed.`,code||'tempo_adapt_failed');}
 /** Run one guarded operation as the controller’s single running task. */
 async exclusive(work){
  if(this.running)throw refused(this.blockMessage('changing the tempo again'),'tempo_adapt_busy');
  const running=(async()=>work())();this.running=running;
  try{return await running;}finally{if(this.running===running)this.running=null;try{this.onChange(this.state());}catch{}}
 }
 /** Stretch once to `bpm` (start, poll, engine reload, refresh). */
 async runStretch(bpm,context,fromBpm){
  const {job,from}=await this.stretch(bpm,context,{fromBpm});
  if(!job){await this.reload(context);return{job:null,from};}
  if(job.status==='failed')throw this.failedJob(job);
  if(job.status!=='succeeded')throw fail('Freestyle reported the tempo stretch as '+job.status+'.','tempo_adapt_receipt',{operationUncertain:true});
  await this.reloadEngine(job,context);await this.reload(context);return{job,from};
 }
 /** Undo one succeeded job exactly (undoTempoStretchJob). */
 async undoJob(jobId,context){
  let result;try{result=await this.api().call('undoTempoStretchJob',{path:{project_id:context.projectId,job_id:jobId}});}catch(error){throw this.explain(error);}
  this.assertContext(context);const job=checkTempoJob(result?.data,{projectId:context.projectId,jobId});
  if(job.status!=='undone')throw fail('Freestyle did not confirm restoring the previous tempo and audio.','tempo_adapt_receipt',{operationUncertain:true});
  await this.reloadEngine(job,context);await this.reload(context);return job;
 }
 begin(label,kind='tempo_adapt'){const history=this.history();let token=null;try{token=history?.beginExternalStep?.({kind,label})??null;}catch(error){throw Object.assign(error,{dispatched:false,historyNotApplied:true});}return{history,token};}

 /** Adapt Project Tempo: change the tempo to `bpm` and stretch the audio. ONE history step. */
 adapt(bpm,{fromBpm=null}={}){
  return this.exclusive(async()=>{
   if(!finite(bpm)||bpm<TEMPO_BPM_MIN||bpm>TEMPO_BPM_MAX)throw refused(`Adapt Project Tempo works from ${TEMPO_BPM_MIN} to ${TEMPO_BPM_MAX} BPM.`,'tempo_adapt_invalid');
   bpm=Math.round(bpm*1000)/1000;
   if(finite(fromBpm)&&Math.abs(fromBpm-bpm)<.0005)return{changed:false,bpm};
   const context=this.context();this.api();let pending=null,sent=false;
   const label=`Adapt Project Tempo (${finite(fromBpm)?formatBpm(fromBpm)+' → ':''}${formatBpm(bpm)} BPM)`;
   this.update({status:'starting',fromBpm,toBpm:bpm,jobId:null,progress:null,error:null});
   try{
    // Earlier local edits save first, so the stretch never races them (and they never get 409).
    await this.prepare?.();this.assertContext(context);
    pending=this.begin(label);sent=true;
    const {job,from}=await this.runStretch(bpm,context,fromBpm);
    if(!job){if(pending.token)pending.history.failExternalStep(pending.token,refused('Nothing to adapt.'));pending=null;this.update({status:'done',jobId:null,progress:null});return{changed:false,bpm};}
    const step={jobId:job.job_id},fromValue=finite(from)?from:fromBpm,name=`Adapt Project Tempo (${finite(fromValue)?formatBpm(fromValue)+' → ':''}${formatBpm(bpm)} BPM)`;
    const undo=()=>this.exclusive(async()=>{const now=this.context();if(now.projectId!==context.projectId)throw refused('Reopen the project to use its Adapt Project Tempo history.','tempo_adapt_scope');
     this.update({status:'undoing',fromBpm:fromValue,toBpm:bpm,jobId:step.jobId,progress:null,error:null});
     try{const undone=await this.undoJob(step.jobId,now);this.update({status:'done'});return{jobId:step.jobId,bpm:fromValue,status:undone.status};}
     catch(error){this.update({status:'failed',error:error.message});throw error;}});
    const redo=()=>this.exclusive(async()=>{const now=this.context();if(now.projectId!==context.projectId)throw refused('Reopen the project to use its Adapt Project Tempo history.','tempo_adapt_scope');
     this.update({status:'starting',fromBpm:fromValue,toBpm:bpm,jobId:null,progress:null,error:null});
     try{const again=await this.runStretch(bpm,now,fromValue);if(!again.job)throw refused('Freestyle had nothing to adapt.','tempo_adapt_receipt');step.jobId=again.job.job_id;this.update({status:'done',jobId:step.jobId,progress:null});return{jobId:step.jobId,bpm};}
     catch(error){this.update({status:'failed',error:error.message});throw error;}});
    const detail={jobId:job.job_id,fromBpm:fromValue,toBpm:bpm};let journaled=false;
    if(pending.history)journaled=pending.token?pending.history.finishExternalStep(pending.token,{label:name,detail,undo,redo})===true:pending.history.recordExternalStep?.({kind:'tempo_adapt',label:name,detail,undo,redo})===true;
    pending=null;this.update({status:'done',jobId:job.job_id,progress:null});
    this.log('tempo-adapt-done',{jobId:job.job_id,from:fromValue,to:bpm,clips:Array.isArray(job.clips)?job.clips.length:null,journaled});
    return{changed:true,bpm,fromBpm:fromValue,job,journaled,label:name};
   }catch(error){
    if(pending?.token)try{pending.history.failExternalStep(pending.token,error);}catch{}
    if(!sent&&error.dispatched===undefined)error.dispatched=false;
    const status=error?.status;if(sent&&error.historyNotApplied!==true&&!(Number.isInteger(status)&&status>=400&&status<500&&status!==408&&status!==429))error.operationUncertain=true;
    this.update({status:'failed',progress:null,error:error.message});throw error;
   }
  });
 }
 /** One keep_time PUT from `fromBpm` to `bpm`, guarded by a FRESH getTimingMap ETag (the
  * timing-map revision; never the project/timeline ETag), then the canonical re-read. */
 async keepTempo(bpm,context,fromBpm){
  const timing=await this.timing(context,fromBpm,{keep:true});
  if(finite(timing.bpm)&&Math.abs(timing.bpm-bpm)<.0005){await this.reload(context);return{changed:false,from:timing.bpm};}
  let result;
  try{result=await this.api().call('setProjectTempo',{path:{project_id:context.projectId},body:{bpm,mode:'keep_time'}},timing.etag?{ifMatch:timing.etag}:{});}
  catch(error){const message=tempoKeepMessage(error);if(message)error.message=message;const status=error?.status;if(Number.isInteger(status)&&status>=400&&status<500&&status!==408&&status!==429){error.dispatched=false;error.historyNotApplied=true;}throw error;}
  this.assertContext(context);const data=result?.data,saved=Number(record(data)?data.bpm??data.bpm_at_start:NaN);
  if(result?.status===202||record(data)&&data.job_id!=null)throw fail('Freestyle answered the Keep Project Tempo change with a stretch job. Reopen the project to inspect it.','tempo_keep_receipt',{operationUncertain:true});
  if(record(data)&&data.ok===false||Number.isFinite(saved)&&Math.abs(saved-bpm)>.0005)throw fail('Freestyle did not confirm the tempo change. Reopen the project to inspect it.','tempo_keep_receipt',{operationUncertain:true});
  await this.reload(context);return{changed:true,from:timing.bpm};
 }
 /** Keep Project Tempo: change the tempo to `bpm`; regions keep their time. ONE history step
  * (Undo = keep_time back to the previous tempo, Redo = to `bpm`, each at a fresh timing-map ETag). */
 keep(bpm,{fromBpm=null}={}){
  return this.exclusive(async()=>{
   if(!finite(bpm)||bpm<TEMPO_BPM_MIN||bpm>TEMPO_BPM_MAX)throw refused(`Freestyle accepts a project tempo from ${TEMPO_BPM_MIN} to ${TEMPO_BPM_MAX} BPM.`,'tempo_keep_invalid');
   bpm=Math.round(bpm*1000)/1000;
   if(finite(fromBpm)&&Math.abs(fromBpm-bpm)<.0005)return{changed:false,bpm};
   const context=this.context();this.api();let pending=null,sent=false;
   const named=from=>`Tempo Change (${finite(from)?formatBpm(from)+' → ':''}${formatBpm(bpm)} BPM)`;
   this.update({status:'saving',fromBpm,toBpm:bpm,jobId:null,progress:null,error:null});
   try{
    await this.prepare?.();this.assertContext(context);
    pending=this.begin(named(fromBpm),'tempo_keep');sent=true;
    const {changed,from}=await this.keepTempo(bpm,context,fromBpm);
    if(!changed){if(pending.token)pending.history.failExternalStep(pending.token,refused('The tempo is already '+formatBpm(bpm)+' BPM.'));pending=null;this.update({status:'done'});return{changed:false,bpm};}
    const fromValue=finite(from)?from:fromBpm,name=named(fromValue);
    const replay=(to,expected)=>()=>this.exclusive(async()=>{const now=this.context();if(now.projectId!==context.projectId)throw refused('Reopen the project to use its tempo history.','tempo_adapt_scope');
     this.update({status:'saving',fromBpm:expected,toBpm:to,jobId:null,progress:null,error:null});
     try{const again=await this.keepTempo(to,now,expected);this.update({status:'done'});return{bpm:to,changed:again.changed};}
     catch(error){this.update({status:'failed',error:error.message});throw error;}});
    const undo=finite(fromValue)?replay(fromValue,bpm):()=>Promise.reject(refused('The previous tempo is unknown; this tempo change cannot be undone.','tempo_keep_receipt'));
    const redo=replay(bpm,fromValue),detail={fromBpm:fromValue,toBpm:bpm,mode:'keep_time'};let journaled=false;
    if(pending.history)journaled=pending.token?pending.history.finishExternalStep(pending.token,{label:name,detail,undo,redo})===true:pending.history.recordExternalStep?.({kind:'tempo_keep',label:name,detail,undo,redo})===true;
    pending=null;this.update({status:'done'});this.log('tempo-keep-done',{from:fromValue,to:bpm,journaled});
    return{changed:true,bpm,fromBpm:fromValue,journaled,label:name};
   }catch(error){
    if(pending?.token)try{pending.history.failExternalStep(pending.token,error);}catch{}
    if(!sent&&error.dispatched===undefined)error.dispatched=false;
    const status=error?.status;if(sent&&error.historyNotApplied!==true&&!(Number.isInteger(status)&&status>=400&&status<500&&status!==408&&status!==429))error.operationUncertain=true;
    this.log('tempo-keep-refused',{bpm,status:status??null,code:error?.code??null,uncertain:error.operationUncertain===true});
    this.update({status:'failed',progress:null,error:error.message});throw error;
   }
  });
 }
 /** Follow a stretch this window did not start (a 409 tempo_stretch_in_progress named it). */
 watch(jobId){
  if(this.running||!id(jobId))return null;let context;try{context=this.context();this.api();}catch{return null;}
  return this.exclusive(async()=>{
   this.update({status:'running',fromBpm:null,toBpm:null,jobId,progress:null,error:null,foreign:true});
   try{const first=checkTempoJob((await this.api().call('getTempoStretchJob',{path:{project_id:context.projectId,job_id:jobId}}))?.data,{projectId:context.projectId,jobId});
    this.update({fromBpm:Number(first.from_bpm),toBpm:Number(first.to_bpm)});const job=await this.poll(first,context);
    if(job.status==='succeeded')await this.reloadEngine(job,context);await this.reload(context);this.update({status:'done',progress:null,foreign:false});return job;}
   catch(error){this.update({status:'failed',error:error.message,foreign:false});this.log('tempo-adapt-watch',{jobId,message:String(error?.message||error).slice(0,160)});return null;}
  }).catch(()=>null);
 }
}

/** Keep Project Tempo (keep_time PUT): the 412 / timing_map_revision_conflict answer. Engine
 * engine request K: even a correct If-Match currently gets "The timing map is at revision 0, not 0". */
export const TEMPO_KEEP_REVISION_MESSAGE='Freestyle refused the tempo change (timing map revision check failed in the engine). Nothing was changed.';
const KEEP_MESSAGE_CODES=new Set(['tempo_stretch_in_progress','tempo_map_not_constant']);
/** A clear message for a refused keep_time tempo PUT, or null for an unexplained error. */
export function tempoKeepMessage(error){
 const code=error?.code,status=error?.status;
 if(status===412||code==='timing_map_revision_conflict')return TEMPO_KEEP_REVISION_MESSAGE;
 if(code==='tempo_map_not_constant')return'This project has tempo changes or ramps. Edit its tempo in Tempo & Time Signatures…. Nothing was changed.';
 if(KEEP_MESSAGE_CODES.has(code))return tempoStretchMessage(error);
 if(code==='tempo_out_of_range')return`Freestyle accepts a project tempo from ${TEMPO_BPM_MIN} to ${TEMPO_BPM_MAX} BPM. Nothing was changed.`;
 if(Number.isInteger(status)&&status>=400&&status<500&&status!==408&&status!==429){
  const raw=String(error?.data?.error?.message??error?.message??'').trim(),detail=raw&&!/^HTTP \d+/.test(raw)?`: ${raw.replace(/[.]$/,'')}`:'';
  return`Freestyle refused the tempo change${detail}. Nothing was changed.`;
 }
 return null;
}

/** LCD tempo-mode popup items (Logic: KEEP / ADAPT under the tempo). */
export function tempoModeMenuItems({mode='keep',available=true,busy=false,onSelect=()=>{}}={}){
 const why=!available?'Adapt Project Tempo needs a Studio API (OAuth) project.':busy?'Wait for the current tempo adaptation to finish.':'';
 return[
  {label:'Keep Project Tempo',shortcut:'KEEP',checked:mode!=='adapt',disabled:busy,title:'Tempo changes keep every audio region at its time position (the regions move against the bars).',run:()=>onSelect('keep')},
  {label:'Adapt Project Tempo',shortcut:'ADAPT',checked:mode==='adapt',disabled:!available||busy,title:why||'Tempo changes time-stretch the audio regions (pitch preserved) so every region, automation point and lyric stays on its bar and beat. ⌘Z restores the original audio.',run:()=>onSelect('adapt')}
 ];
}

/**
 * LCD wiring. api: document, controller, storage, projectId(), studioClient(),
 * getProject(), menu(event, items), toast(text), fail(error), status(text).
 * Returns {mode(), setMode(mode), commit(bpm) → Promise|null (null = the app's edit() path),
 * handles() (commit owns the edit), paint(), destroy()}.
 */
export function installTempoAdapt(api){
 const doc=api.document||globalThis.document,controller=api.controller,disposers=[],$=selector=>doc.querySelector(selector);
 const on=(target,type,listener,options)=>{if(!target)return;target.addEventListener(type,listener,options);disposers.push(()=>target.removeEventListener(type,listener,options));};
 const projectId=()=>api.projectId?.()||null,available=()=>!!api.studioClient?.();
 const mode=()=>{const value=readTempoMode(api.storage,projectId());return value==='adapt'&&available()?'adapt':'keep';};
 function paint(){
  const label=$('#lcd-tempo-mode'),cell=label?.closest?.('.logic-lcd-tempo')||$('.logic-lcd-tempo'),current=mode(),text=controller?.busy?controller.statusText():'';
  if(label){const lcd=tempoModeLcd(current);if(label.textContent!==lcd)label.textContent=lcd;label.title=`${tempoModeName(current)} — click to choose Keep or Adapt Project Tempo`;label.setAttribute('role','button');label.tabIndex=0;label.setAttribute('aria-label',`Tempo change: ${tempoModeName(current)}`);}
  cell?.classList?.toggle('logic-tempo-adapting',!!controller?.busy);
  // While a stretch runs the tempo field is locked; otherwise the app’s own state (e.g. a tempo map) owns it.
  const input=$('#tempo');
  if(input&&controller?.busy){input.disabled=true;input.dataset.tempoAdaptLock='1';input.title=text;}
  else if(input){if(input.dataset.tempoAdaptLock){delete input.dataset.tempoAdaptLock;input.disabled=false;input.title='Tempo (BPM)';}if(!input.disabled)input.title=current==='adapt'?'Tempo (BPM) · Adapt Project Tempo: the audio follows the new tempo':'Tempo (BPM)';}
  if(text)api.status?.(text);
 }
 function setMode(next){
  if(!TEMPO_MODES.includes(next))return mode();
  if(next==='adapt'&&!available()){api.toast?.('Adapt Project Tempo needs a Studio API (OAuth) project. Reload the project.');return mode();}
  if(controller?.busy){api.toast?.(controller.blockMessage('changing the tempo mode'));return mode();}
  writeTempoMode(api.storage,projectId(),next);paint();api.toast?.(`Tempo change: ${tempoModeName(next)}`);return mode();
 }
 function openMenu(event){
  event?.preventDefault?.();event?.stopPropagation?.();
  const rect=event?.currentTarget?.getBoundingClientRect?.()||$('#lcd-tempo-mode')?.getBoundingClientRect?.(),point=event&&Number.isFinite(event.clientX)&&event.clientX>0?event:{clientX:rect?.left??0,clientY:(rect?.bottom??0)+2};
  api.menu?.(point,tempoModeMenuItems({mode:mode(),available:available(),busy:!!controller?.busy,onSelect:setMode}));
 }
 /** True when commit() owns the LCD edit: ADAPT, or KEEP on a Studio API project (keep_time PUT). */
 const handles=()=>mode()==='adapt'||available()&&typeof controller?.keep==='function';
 /** The LCD edit: ADAPT → the stretch job; KEEP on a Studio API project → one keep_time PUT at the
  * fresh timing-map ETag (one history step). Returns its promise, or null for the app's edit() path. */
 function commit(bpm){
  if(!handles())return null;const adapting=mode()==='adapt';
  const fromBpm=Number(api.getProject?.()?.bpm),target=Number(bpm),options={fromBpm:Number.isFinite(fromBpm)?fromBpm:null};
  const running=adapting?controller.adapt(target,options):controller.keep(target,options);paint();
  return running.then(result=>{if(result.changed)api.toast?.(adapting?`Tempo ${formatBpm(result.bpm)} BPM · audio adapted${result.journaled===false?' (not in Undo history)':''}`:`Tempo ${formatBpm(result.bpm)} BPM${result.journaled===false?' (not in Undo history)':''}`);return result;},error=>{api.fail?.(error);return null;}).finally(()=>{paint();api.status?.('');});
 }
 const label=$('#lcd-tempo-mode');
 on(label,'click',openMenu);on(label,'keydown',event=>{if(event.key==='Enter'||event.key===' ')openMenu(event);});
 on($('.logic-lcd-tempo'),'contextmenu',openMenu);
 paint();
 return{mode,setMode,commit,handles,paint,openMenu,controller,destroy(){for(const dispose of disposers.splice(0))dispose();}};
}
