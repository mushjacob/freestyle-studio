/** Freestyle ▸ Assistant: Mozart AI job status and “Undo Last Assistant Action”.
 *
 * getMozartAiJob GET /projects/{id}/ai/jobs/{job_id} → AiJob {jobId, status queued |
 * running | done | failed | cancelled | timeout | unknown, lastStep, reply, laneId,
 * clipId, elapsedSec, durationSec}. "unknown" = finished or no longer tracked. A job
 * comes from a mozart_ai_command answer with a generator (AiCommandResult.jobId) run
 * in the Assistant panel; the tracker polls it (backoff 2, 4, 8, 10 s…; a 429 waits
 * its Retry-After) and, when it ends, re-reads the project like any outside change.
 *
 * undoLastAiAction POST /projects/{id}/ai:undo {track_id?} (body required; may be
 * empty) reverts the latest still-applied Mozart AI / Pro action. It is NOT a step of
 * this window's ⌘Z history: afterwards the project is re-read (the history observes
 * the outside change and stops older steps that no longer match). One retained
 * Idempotency-Key; an unknown outcome is asked once more with it (a replay, never a
 * second undo).
 */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const JOB=/^[A-Za-z0-9._:-]{1,128}$/;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const fail=(message,code='assistant_invalid',extra={})=>Object.assign(new Error(message),{code},extra);
const transient=error=>{const status=Number(error?.status);return error?.dispatched!==false&&(!Number.isInteger(status)||status===0||status===408||status>=500);};
const defaultKey=()=>globalThis.crypto?.randomUUID?.()||`ai-undo-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const ASSISTANT_OPERATIONS=Object.freeze(['getMozartAiJob','undoLastAiAction']);
export const AI_JOB_TERMINAL=Object.freeze(new Set(['done','failed','cancelled','timeout','unknown']));
export const AI_JOB_POLL_BACKOFF_SEC=Object.freeze([2,4,8,10]);
export const AI_JOB_POLL_LIMIT_MS=20*60*1000,AI_JOB_READ_FAILURES=5;
export function aiJobDelaySec({retryAfterSec=null,attempt=0}={}){const hint=Number(retryAfterSec);if(Number.isFinite(hint)&&hint>0)return Math.max(1,Math.min(30,Math.ceil(hint)));return AI_JOB_POLL_BACKOFF_SEC[Math.min(Math.max(0,attempt|0),AI_JOB_POLL_BACKOFF_SEC.length-1)];}
export function checkAiJob(job,{jobId}={}){
 if(!record(job)||typeof job.jobId!=='string'||!JOB.test(job.jobId)||typeof job.status!=='string'||!job.status)throw fail('Freestyle returned an unreadable Assistant job.','assistant_job_receipt');
 if(jobId&&job.jobId!==jobId)throw fail('Freestyle returned another Assistant job.','assistant_job_receipt');
 return job;
}
const stepText=step=>typeof step==='string'?step:record(step)?String(step.label||step.title||step.name||step.action||step.step||''):'';
/** Human status line for one job. */
export function aiJobLabel(job){
 if(!job)return'';const step=stepText(job.lastStep),elapsed=Number(job.elapsedSec);
 const status={queued:'Queued',running:'Running',done:'Done',failed:'Failed',cancelled:'Cancelled',timeout:'Timed out',unknown:'Finished (no longer tracked)'}[job.status]||job.status;
 return[status,step&&!AI_JOB_TERMINAL.has(job.status)?step:'',Number.isFinite(elapsed)&&elapsed>0?`${Math.round(elapsed)} s`:'',job.status==='done'&&job.laneId?'new track added':'',job.reply&&AI_JOB_TERMINAL.has(job.status)?job.reply:''].filter(Boolean).join(' · ');
}
/** The job id of a mozart_ai_command answer (MCP structuredContent / REST body), or null. */
export function assistantResultJob(result){
 let value=result;for(let depth=0;depth<4&&record(value);depth++){const job=value.jobId??value.job_id;if(typeof job==='string'&&JOB.test(job))return job;value=value.structuredContent??value.response??value.data;}
 return null;
}

/** Polls Mozart AI jobs of the open project. options: client() → StudioApiClient|null; scope() → {projectId}|null;
 * onChange(jobs); onDone(job, context) (re-read the project); sleep(ms); now(); log(event, detail). */
export class AssistantJobTracker{
 constructor({client,scope,onChange=()=>{},onDone=()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>Date.now(),log=()=>{}}={}){
  if(typeof client!=='function'||typeof scope!=='function')throw new TypeError('AssistantJobTracker needs client and scope.');
  Object.assign(this,{client,scope,onChange,onDone,sleep,now,log});this.entries=new Map();
 }
 /** [{jobId, projectId, status, job, error, polling, startedAt}] newest first, current project only. */
 jobs(){const projectId=this.scope()?.projectId;return[...this.entries.values()].filter(entry=>entry.projectId===projectId).sort((a,b)=>b.startedAt-a.startedAt).map(entry=>({...entry,job:entry.job?structuredClone(entry.job):null}));}
 notify(){try{this.onChange(this.jobs());}catch{}}
 api(){const client=this.client();if(typeof client?.call!=='function')throw fail('Assistant job status needs a Studio API (OAuth) project. Reload the project.','assistant_unavailable',{dispatched:false});return client;}
 /** Start following a job (idempotent per job). Returns its polling promise. */
 track(jobId){
  const projectId=this.scope()?.projectId;if(typeof jobId!=='string'||!JOB.test(jobId))throw fail('Enter an Assistant job id.','assistant_job_id',{dispatched:false});if(typeof projectId!=='string'||!projectId)throw fail('Open a Freestyle project first.','assistant_scope',{dispatched:false});
  const existing=this.entries.get(jobId);if(existing?.projectId===projectId&&existing.polling)return existing.polling;
  const entry={jobId,projectId,status:'queued',job:null,error:null,polling:null,startedAt:this.now()};this.entries.set(jobId,entry);
  entry.polling=this.follow(entry).finally(()=>{entry.polling=null;this.notify();});this.notify();return entry.polling;
 }
 /** One read now (Check status). */
 async check(jobId){const entry=this.entries.get(jobId);if(!entry)return this.track(jobId);const job=checkAiJob((await this.api().call('getMozartAiJob',{path:{project_id:entry.projectId,job_id:jobId}}))?.data,{jobId});entry.job=job;entry.status=job.status;entry.error=null;this.notify();return job;}
 current(entry){return this.scope()?.projectId===entry.projectId&&this.entries.get(entry.jobId)===entry;}
 async follow(entry){
  let attempt=0,failures=0;const started=this.now();
  for(;;){
   if(!this.current(entry))return null;
   try{const job=checkAiJob((await this.api().call('getMozartAiJob',{path:{project_id:entry.projectId,job_id:entry.jobId}}))?.data,{jobId:entry.jobId});if(!this.current(entry))return null;entry.job=job;entry.status=job.status;entry.error=null;failures=0;this.notify();
    if(AI_JOB_TERMINAL.has(job.status)){this.log('assistant-job-ended',{jobId:entry.jobId,status:job.status});try{await this.onDone(job,{projectId:entry.projectId});}catch(error){entry.error=error?.message||String(error);}return job;}}
   catch(error){
    const status=Number(error?.status);if(error?.dispatched===false||error?.code==='assistant_job_receipt'||status===404||status>=400&&status<500&&status!==408&&status!==429){entry.status='error';entry.error=error?.message||String(error);this.notify();return null;}
    if(++failures>AI_JOB_READ_FAILURES){entry.status='error';entry.error=`Freestyle has not answered the Assistant job status (${error?.message||error}).`;this.notify();return null;}
    this.log('assistant-job-poll-retry',{jobId:entry.jobId,status:Number.isFinite(status)?status:null,failures});
    await this.sleep(aiJobDelaySec({retryAfterSec:status===429?error?.retryAfter:null,attempt:failures-1})*1000);continue;
   }
   if(this.now()-started>AI_JOB_POLL_LIMIT_MS){entry.error='Still running in Freestyle. Check its status again later.';this.notify();return null;}
   await this.sleep(aiJobDelaySec({retryAfterSec:entry.job?.retryAfterSec,attempt:attempt++})*1000);
  }
 }
 stop(){this.entries.clear();this.notify();}
}

/** POST undoLastAiAction (one retained key; an unknown outcome is asked once more with it). */
export async function undoLastAssistantAction({client,projectId,trackId=null,key=defaultKey(),log=()=>{}}={}){
 if(typeof client?.call!=='function')throw fail('Undo Last Assistant Action needs a Studio API (OAuth) project. Reload the project.','assistant_unavailable',{dispatched:false});
 if(typeof projectId!=='string'||!projectId)throw fail('Open a Freestyle project first.','assistant_scope',{dispatched:false});
 const body=typeof trackId==='string'&&trackId&&trackId.length<=64?{track_id:trackId}:{},send=()=>client.call('undoLastAiAction',{path:{project_id:projectId},body},{idempotencyKey:key});
 let result;try{result=await send();}catch(error){if(!transient(error)&&error?.operationUncertain!==true)throw error;log('assistant-undo-replay',{status:error?.status??null});try{result=await send();}catch(again){throw Object.assign(again,{operationUncertain:transient(again)||again?.operationUncertain===true});}}
 const data=result?.data;let value=data;for(let depth=0;depth<4&&record(value);depth++){if(value.ok===false||value.applied===false||record(value.error))throw fail(value.error?.message||value.message||(typeof value.error==='string'?value.error:'')||'Freestyle has no Assistant action to undo.','assistant_undo_refused',{explicitRejection:true});value=value.response??value.result;}
 return data??{};
}
const undoMessage=receipt=>{const label=record(receipt)?(receipt.undone?.label||receipt.undone?.action||receipt.action||receipt.label||receipt.description):null;return typeof label==='string'&&label?`Undid the Assistant’s ${label}.`:'Undid the last Assistant action.';};
/** The menu action: confirm, flush, undo in Freestyle, then re-read the project. */
export async function runUndoLastAssistantAction({client,projectId,trackId,confirm,prepare=async()=>{},refresh=async()=>{},isCurrent=()=>true,toast=()=>{},log=()=>{}}={}){
 if(typeof confirm==='function'&&!await confirm())return null;
 if(!isCurrent())throw fail('The project changed. Choose Undo Last Assistant Action again.','assistant_scope',{dispatched:false});
 await prepare();if(!isCurrent())throw fail('The project changed. Choose Undo Last Assistant Action again.','assistant_scope',{dispatched:false});
 let receipt;try{receipt=await undoLastAssistantAction({client,projectId,trackId,log});}
 catch(error){if(error?.operationUncertain&&isCurrent()){try{await refresh();}catch{}error.message=`The Assistant undo did not confirm. ${error.message} The project was read again; check it before undoing again.`;}throw error;}
 if(isCurrent())await refresh();toast(undoMessage(receipt));return receipt;
}
/** Freestyle ▸ Assistant Job Status… dialog over a tracker. */
export function openAssistantJobsDialog({dialog,tracker,openAssistant=null}={}){
 if(typeof dialog!=='function'||!tracker)throw new TypeError('openAssistantJobsDialog needs dialog and tracker.');
 const d=dialog('Assistant Jobs','<div class="logic-assistant-jobs"></div><form class="logic-assistant-track"><label>Job id <input name="job" maxlength="128" autocomplete="off" spellcheck="false" placeholder="From a Mozart AI generation"></label><button type="submit">Follow</button></form><p class="logic-assistant-error" role="alert"></p>'+(openAssistant?'<button type="button" class="logic-assistant-open">Open Assistant…</button>':'')+'<button type="button" class="cancel">Close</button>');
 const list=d.querySelector('.logic-assistant-jobs'),error=d.querySelector('.logic-assistant-error');
 const paint=jobs=>{if(!list.isConnected&&!d.open)return;list.innerHTML=jobs.length?`<ol class="logic-assistant-job-list">${jobs.map(entry=>`<li data-ai-job="${esc(entry.jobId)}" data-ai-status="${esc(entry.status)}"><code>${esc(entry.jobId)}</code> ${esc(entry.job?aiJobLabel(entry.job):entry.status==='error'?'Status unavailable':'Waiting for status…')}${entry.error?` <small>${esc(entry.error)}</small>`:''} <button type="button" data-ai-check="${esc(entry.jobId)}"${entry.polling?' disabled':''}>Check status</button></li>`).join('')}</ol>`:'<p>No Assistant jobs in this session. A Mozart AI generation started from Freestyle ▸ Assistant… appears here with its progress.</p>';};
 const previous=tracker.onChange;tracker.onChange=jobs=>{try{previous?.(jobs);}finally{paint(jobs);}};
 d.addEventListener('close',()=>{tracker.onChange=previous;},{once:true});
 list.addEventListener('click',event=>{const button=event.target.closest?.('[data-ai-check]');if(!button)return;error.textContent='';Promise.resolve().then(()=>tracker.check(button.dataset.aiCheck)).catch(cause=>{error.textContent=cause?.message||String(cause);});});
 d.querySelector('form').onsubmit=event=>{event.preventDefault();error.textContent='';const job=event.currentTarget.elements.job.value.trim();try{tracker.track(job).catch(cause=>{error.textContent=cause?.message||String(cause);});event.currentTarget.elements.job.value='';}catch(cause){error.textContent=cause.message;}};
 d.querySelector('.logic-assistant-open')?.addEventListener('click',()=>{d.close();openAssistant();});d.querySelector('.cancel').onclick=()=>d.close();
 paint(tracker.jobs());return d;
}
