/**
 * Disabelton tempo stretch (Live: changing the tempo with warped audio follows the bars).
 *
 * Control bar BPM field: right-click ▸ "Stretch audio with tempo" toggles the mode (remembered per viewer).
 * When on, a small ⇔ warp badge shows next to BPM and a committed BPM edit goes to Freestyle release
 * 2026-11-14's typed route instead of the keep_time edit:
 *   PUT /projects/{id}/tempo {bpm, mode:"stretch_audio"} (Idempotency-Key, If-Match = timing-map revision)
 *   → 202 TempoStretchJob → poll getTempoStretchJob (Retry-After, bounded, aborted on project switch) with
 *     per-clip render progress in the status bar → succeeded: re-read the project (and reload the engine when
 *     engine_reload_required) as ONE global Undo step whose Undo is undoTempoStretchJob (exact restore) and whose
 *     Redo runs the stretch again. failed → nothing changed (toast). While a job runs, BPM edits are refused.
 * In stretch mode only a settled value starts a job: drag / scroll / Tap / ↑↓ bursts are coalesced to the last
 * value (settleMs after the last change); typed values commit on Enter (a typed value left without Enter reverts).
 * When off (default), nothing here intercepts the field: the existing keep_time path runs unchanged.
 *
 * hooks (app.js): document, studioClient(), projectId(), rawProject(), history(), refresh(), reloadEngine(detail),
 *  menu(event, items), toast(text), fail(error), log(kind, data), status(text)?, pollOptions? (tests).
 */
import {STUDIO_API_OPERATIONS} from './studio-api-client.js';

export const ABL_TEMPO_STRETCH_LABEL='Stretch audio with tempo';
export const ABL_TEMPO_STORAGE_KEY='disabelton.tempoStretch';
const OPERATIONS=['setProjectTempo','getTempoStretchJob','undoTempoStretchJob'];
const FINAL=new Set(['succeeded','failed','undone']);
const keyFor=()=>globalThis.crypto?.randomUUID?.()||`tempo-${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
const short=value=>String(value?.message||value||'').slice(0,200);

/** Whether this API build declares the stretch route (setProjectTempo with a `mode` body field). */
export function tempoStretchSupported(operations=STUDIO_API_OPERATIONS){
 if(!operations||!OPERATIONS.every(name=>Object.prototype.hasOwnProperty.call(operations,name)))return false;
 const mode=operations.setProjectTempo?.requestBody?.content?.['application/json']?.schema?.properties?.mode;
 return Array.isArray(mode?.enum)?mode.enum.includes('stretch_audio'):!!mode;
}

/** Status-bar text for one polled job. */
export function tempoJobText(job,label='Stretching audio'){
 if(!job||typeof job!=='object')return `${label}…`;
 const to=Number.isFinite(job.to_bpm)?job.to_bpm:Number.isFinite(job.bpm)?job.bpm:null,target=to!=null?` to ${to} BPM`:'';
 if(job.status==='succeeded')return `${label}${target}: done${job.engine_reload_required?' (reloading the live engine)':''}.`;
 if(job.status==='failed')return `${label}${target} failed: ${job.error?.message||job.error?.code||'Freestyle reported no reason'}. Nothing changed.`;
 if(job.status==='undone')return `${label}${target}: undone.`;
 const done=job.progress?.renders_succeeded,total=job.progress?.renders_total;
 return `${label}${target}… ${Number.isInteger(done)&&Number.isInteger(total)&&total>0?`${done}/${total} clips rendered`:job.status==='queued'?'queued':'rendering'}`;
}

/** Message for a refused stretch / undo. */
export function tempoErrorText(error,{undo=false}={}){
 const code=error?.code,details=error?.data?.error?.details||error?.details||{};
 if(code==='tempo_stretch_undo_conflict'){const changed=Array.isArray(details.changed)?details.changed.slice(0,4).map(item=>typeof item==='string'?item:item?.kind||item?.field||item?.id||JSON.stringify(item)).join(', '):'';return `Cannot undo the tempo stretch: the project changed since${changed?` (${changed})`:''}. Nothing was restored.`;}
 if(code==='tempo_stretch_in_progress')return 'A tempo stretch is already running on this project. Wait for it to finish.';
 if(code==='tempo_stretch_not_undoable')return 'This tempo stretch cannot be undone (it is still running or it failed).';
 if(code==='tempo_map_not_constant')return 'This project has tempo changes: edit them in the tempo map instead.';
 if(code==='tempo_out_of_range')return 'A stretched clip would leave 20–400 BPM. Choose a closer tempo.';
 if(error?.status===412)return 'The tempo changed elsewhere. Try again on the current tempo.';
 return `${undo?'Undo of the tempo stretch':'Tempo stretch'} failed: ${short(error)||'unknown error'}.`;
}

/** Poll one job until it is final (Retry-After honoured, 1–30 s, bounded, abortable). */
export async function pollTempoJob({client,projectId,jobId,signal,onProgress=()=>{},maxWaitMs=35*60*1000,now=()=>Date.now(),
 sleep=(ms,abort)=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,ms);abort?.addEventListener?.('abort',()=>{clearTimeout(timer);reject(abort.reason??Object.assign(new Error('aborted'),{name:'AbortError'}));},{once:true});})}={}){
 const started=now();
 for(;;){
  if(signal?.aborted)throw Object.assign(new Error('The tempo job poll was cancelled.'),{name:'AbortError'});
  const response=await client.call('getTempoStretchJob',{path:{project_id:projectId,job_id:jobId}},signal?{signal}:{});
  const job=response?.data||{};try{onProgress(job);}catch{}
  if(FINAL.has(job.status))return job;
  const header=Number(response?.headers?.retryAfter??response?.retryAfter),wait=Math.max(1000,Math.min(30000,1000*(Number(job.retryAfterSec)||header||2)));
  if(now()-started+wait>maxWaitMs)throw Object.assign(new Error('The tempo stretch is still running. Check it again later; nothing was undone.'),{code:'tempo_job_poll_timeout',job});
  await sleep(wait,signal);
 }
}

export class AblTempoStretch{
 constructor(hooks={}){this.hooks=hooks;this.job=null;this.enabled=this.readStored();}
 log(kind,data){try{this.hooks.log?.(kind,data);}catch{}}
 status(text){try{this.hooks.status?.(text);}catch{}}
 toast(text){try{this.hooks.toast?.(text);}catch{}}
 storage(){try{return this.hooks.storage??globalThis.localStorage??null;}catch{return null;}}
 readStored(){try{return this.storage()?.getItem?.(ABL_TEMPO_STORAGE_KEY)==='1';}catch{return false;}}
 setEnabled(on){this.enabled=!!on;try{this.storage()?.setItem?.(ABL_TEMPO_STORAGE_KEY,this.enabled?'1':'0');}catch{}this.log('abl-tempo-mode',{stretch:this.enabled});this.hooks.onMode?.(this.enabled);return this.enabled;}
 /** Why stretch mode cannot run now (null when it can). */
 unavailable(){
  if(!tempoStretchSupported(this.hooks.operations||STUDIO_API_OPERATIONS))return 'Tempo stretching is unavailable in this Freestyle API build.';
  let client=null,project=null;try{client=this.hooks.studioClient?.()??null;project=this.hooks.projectId?.()??null;}catch{}
  if(!client||!project)return 'Connect the Freestyle cloud project (Studio API) first.';
  return null;
 }
 menuItems(){const reason=this.unavailable();return[{label:ABL_TEMPO_STRETCH_LABEL,checked:this.enabled,...reason&&!this.enabled?{disabled:true,title:reason}:{title:'Tempo changes time-stretch every audio clip (pitch kept) so everything stays on its bar. Undo restores it exactly.'},run:()=>this.setEnabled(!this.enabled)}];}
 /** True when a committed BPM edit should be handled here instead of the keep_time path. */
 intercepts(){return this.enabled||!!this.job;}
 timingIfMatch(raw){const revision=raw?.timingMap?.revision;return Number.isSafeInteger(revision)&&revision>=0?`"${revision}"`:undefined;}
 /** Start a stretch to `bpm`, wait for it and record one Undo step. Resolves with the final job. */
 async commit(bpm,{record=true}={}){
  if(this.job)throw Object.assign(new Error(`Wait for the current tempo stretch (${this.job.label}) to finish.`),{dispatched:false,code:'tempo_stretch_busy'});
  const reason=this.unavailable();if(reason)throw Object.assign(new Error(reason),{dispatched:false});
  const target=Math.round(Number(bpm)*1000)/1000;if(!Number.isFinite(target)||target<20||target>400)throw Object.assign(new Error('Stretching keeps tempo between 20 and 400 BPM.'),{dispatched:false,code:'tempo_out_of_range'});
  const raw=this.hooks.rawProject?.()??null;if(raw?.timingMap?.isConstantTempo===false)throw Object.assign(new Error(tempoErrorText({code:'tempo_map_not_constant'})),{dispatched:false});
  const client=this.hooks.studioClient(),projectId=this.hooks.projectId(),from=Number(raw?.bpm),label=`Stretching audio to ${target} BPM`;
  if(Number.isFinite(from)&&Math.abs(from-target)<1e-6)return null;
  const controller=typeof AbortController==='function'?new AbortController():null,job={label,projectId,to:target,from,idempotencyKey:keyFor(),jobId:null,abort:()=>controller?.abort()};this.job=job;
  this.status(`${label}…`);this.log('abl-tempo-stretch-start',{from,to:target});
  try{
   const ifMatch=this.timingIfMatch(raw);
   let started;
   try{started=await client.call('setProjectTempo',{path:{project_id:projectId},body:{bpm:target,mode:'stretch_audio'}},{idempotencyKey:job.idempotencyKey,...ifMatch?{ifMatch}:{}});}
   catch(error){if(error?.status>=400&&error?.status<500&&error?.status!==408)error.dispatched=false;error.message=tempoErrorText(error);throw error;}
   const first=started?.data||{};job.jobId=first.job_id??null;this.log('abl-tempo-stretch-job',{jobId:job.jobId,status:first.status??null,http:started?.status??null});
   let final=first;
   if(!FINAL.has(first.status)){
    if(typeof job.jobId!=='string'||!job.jobId)throw Object.assign(new Error('Freestyle accepted the tempo stretch without a job id; re-read the project before editing.'),{operationUncertain:true});
    final=await pollTempoJob({client,projectId,jobId:job.jobId,signal:controller?.signal,onProgress:state=>{if(this.hooks.projectId?.()!==projectId){job.abort();return;}if(this.job===job)this.status(tempoJobText(state));},...(this.hooks.pollOptions||{})});
   }
   this.status(tempoJobText(final));this.log('abl-tempo-stretch-finished',{jobId:job.jobId,status:final.status,reload:final.engine_reload_required===true,error:final.error?.code??null});
   if(final.status==='failed')throw Object.assign(new Error(tempoJobText(final,'Tempo stretch')),{dispatched:true,tempoJob:final,code:final.error?.code??'tempo_stretch_failed'});
   if(this.hooks.projectId?.()!==projectId){this.log('abl-tempo-project-changed',{jobId:job.jobId});return final;}
   await this.adopt(final,projectId,{record,from,to:target});
   return final;
  }finally{if(this.job===job)this.job=null;}
 }
 async settle(receipt,projectId,reason){
  if(receipt?.engine_reload_required)try{await this.hooks.reloadEngine?.({projectId,divergent:[],reason});}catch(error){this.log('abl-tempo-reload-failed',{message:short(error)});}
  await this.hooks.refresh?.();
 }
 /** Re-read the project; record ONE Undo step (Undo = undoTempoStretchJob, Redo = a new stretch to the same BPM). */
 async adopt(final,projectId,{record,from,to}){
  const history=record?this.hooks.history?.()??null:null;let token=null;
  try{token=history?.beginExternalStep?.({kind:'tempo_stretch',label:`Tempo ${to} BPM (stretch audio)`})??null;}catch(error){this.log('abl-tempo-history-busy',{message:short(error)});}
  try{await this.settle(final,projectId,'tempo-stretch');}catch(error){if(token)history.failExternalStep(token,error);throw error;}
  if(!record)return false;
  const state={jobId:final.job_id??this.lastJobId??null};
  const undo=async()=>{
   if(this.hooks.projectId?.()!==projectId)throw Object.assign(new Error('Open the stretched project before undoing its tempo change.'),{dispatched:false});
   if(this.job)throw Object.assign(new Error('Wait for the running tempo stretch to finish.'),{dispatched:false});
   let receipt;
   try{receipt=(await this.hooks.studioClient().call('undoTempoStretchJob',{path:{project_id:projectId,job_id:state.jobId},body:{}},{idempotencyKey:keyFor()}))?.data||{};}
   catch(error){if(error?.status>=400&&error?.status<500&&error?.status!==408)error.dispatched=false;error.message=tempoErrorText(error,{undo:true});throw error;}
   await this.settle(receipt,projectId,'tempo-stretch-undo');
   this.status(`Tempo back to ${from} BPM; audio restored.`);this.log('abl-tempo-stretch-undo',{jobId:state.jobId,replay:receipt.replay===true});return receipt;
  };
  const redo=async()=>{const again=await this.commit(to,{record:false});if(again?.job_id)state.jobId=again.job_id;return again;};
  let recorded=false;
  if(token)recorded=history.finishExternalStep(token,{undo,redo,detail:{jobId:state.jobId,from,to}});
  if(!recorded)this.toast('Tempo stretched. Undo History is busy, so this change is not an Undo step.');
  return recorded;
 }
 cancel(){this.job?.abort?.();}
}

/** Mount on the control bar: right-click menu, badge, and the stretch-mode commit interception. */
export function installAblTempo(hooks={}){
 const document=hooks.document||globalThis.document,window=document?.defaultView||globalThis;
 const stretch=new AblTempoStretch({...hooks,status:text=>{try{if(hooks.status)hooks.status(text);else{const node=document.querySelector('#status-message');if(node)node.textContent=text;}}catch{}},
  onMode:()=>paint()});
 const field=()=>document.querySelector('#tempo');
 function paint(){
  const input=field();if(!input)return;const host=input.closest?.('.abl-bpm')||input.parentElement;if(!host)return;
  let badge=host.querySelector?.('.abl-tempo-warp');
  if(!badge){badge=document.createElement('span');badge.className='abl-tempo-warp';badge.textContent='⇔';badge.setAttribute('aria-label',ABL_TEMPO_STRETCH_LABEL);
   badge.style.cssText='margin-left:2px;font-size:10px;line-height:1;color:#ffa31a;cursor:pointer;user-select:none';badge.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();stretch.setEnabled(false);hooks.toast?.('Tempo changes keep audio timing.');});host.appendChild(badge);}
  badge.hidden=!stretch.enabled;badge.title=stretch.job?stretch.job.label:`${ABL_TEMPO_STRETCH_LABEL} is on (click to turn off)`;
  host.classList?.toggle?.('abl-tempo-stretching',!!stretch.job);
 }
 const onContext=event=>{if(event.target!==field()&&!event.target?.closest?.('.abl-bpm'))return;event.preventDefault();event.stopPropagation();hooks.menu?.(event,stretch.menuItems());};
 // A stretch is a whole render job, so in stretch mode only a SETTLED value starts one:
 //  - typed values commit on Enter (immediately); a typed value left by clicking away is reverted;
 //  - drag (commits on pointer-up), scroll bursts, Tap and ↑/↓ steps are coalesced: each change replaces
 //    the pending value and only the last one, settleMs after the last change, starts the job.
 const settleMs=Number.isFinite(hooks.settleMs)?hooks.settleMs:600,setTimer=hooks.setTimer||((fn,ms)=>setTimeout(fn,ms)),clearTimer=hooks.clearTimer||(id=>clearTimeout(id));
 let pending=null,keyIntent=null;
 const cancelPending=()=>{if(pending){clearTimer(pending.timer);pending=null;}};
 const start=(input,value,current)=>{
  stretch.commit(value).then(()=>paint(),error=>{if(Number.isFinite(current)&&!stretch.job)input.value=String(Number(hooks.rawProject?.()?.bpm)||current);paint();hooks.fail?.(error);});
  paint();
 };
 const onKey=event=>{if(event.target!==field())return;const key=event.key;keyIntent=key==='Enter'?'enter':key==='Escape'?'escape':['ArrowUp','ArrowDown','PageUp','PageDown'].includes(key)?'step':key?.length===1||key==='Backspace'||key==='Delete'?'typing':keyIntent;};
 const onFocus=event=>{if(event.target===field())keyIntent=null;};
 // Capture phase: runs before the field's own onchange (the keep_time edit) and stops it only in stretch mode.
 const onChange=event=>{
  const input=field();if(!input||event.target!==input||!stretch.intercepts())return;
  const raw=hooks.rawProject?.()??null,current=Number(raw?.bpm),value=Number(input.value),intent=keyIntent;
  if(stretch.job){event.stopImmediatePropagation();cancelPending();if(Number.isFinite(current))input.value=String(current);hooks.toast?.(`Wait for the current tempo stretch (${stretch.job.label}) to finish.`);return;}
  if(stretch.unavailable()||raw?.timingMap?.isConstantTempo===false)return;// the existing path explains/handles it
  event.stopImmediatePropagation();
  if(intent==='enter'||intent==='escape'||intent==='typing')keyIntent=null;
  if(intent==='escape'||intent==='typing'){cancelPending();if(Number.isFinite(current))input.value=String(current);if(intent==='typing')hooks.toast?.('Press Enter to stretch audio to the typed tempo.');return;}
  if(!Number.isFinite(value)||Number.isFinite(current)&&Math.abs(current-value)<1e-6){cancelPending();return;}
  if(intent==='enter'){cancelPending();start(input,value,current);return;}
  const projectId=hooks.projectId?.()??null;cancelPending();
  const entry={value,timer:null};entry.timer=setTimer(()=>{if(pending!==entry)return;pending=null;if((hooks.projectId?.()??null)!==projectId)return;start(input,entry.value,Number(hooks.rawProject?.()?.bpm));},settleMs);pending=entry;
  stretch.status(`Tempo ${value} BPM: stretching audio when you stop adjusting…`);
 };
 document.addEventListener('contextmenu',onContext,true);document.addEventListener('change',onChange,true);document.addEventListener('keydown',onKey,true);document.addEventListener('focusin',onFocus,true);
 paint();
 const api={get enabled(){return stretch.enabled;},setEnabled:on=>{stretch.setEnabled(on);return stretch.enabled;},get busy(){return !!stretch.job;},commit:bpm=>stretch.commit(bpm),menuItems:()=>stretch.menuItems(),cancel:()=>stretch.cancel(),stretch};
 window.ablTempo=api;
 return{api,stretch,destroy(){cancelPending();document.removeEventListener('contextmenu',onContext,true);document.removeEventListener('change',onChange,true);document.removeEventListener('keydown',onKey,true);document.removeEventListener('focusin',onFocus,true);stretch.cancel();if(window.ablTempo===api)delete window.ablTempo;}};
}
