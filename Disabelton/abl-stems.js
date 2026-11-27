/**
 * Disabelton "Separate Stems to New Audio Tracks" (Live 12 audio clip context menu).
 *
 * Studio Pro: clip menu ▸ Extract stems (vocals / four stems). Typed Studio API v1 only:
 *   splitClipStems {mode, replace:true} (202 job, retained Idempotency-Key: a retry never starts a second metered split)
 *   → pollStemJob (getStemJob, Retry-After) with progress in the status bar
 *   → done: the new stem lanes exist (the source clip is muted when replace=true); the project is re-read so the
 *     tracks appear, and the whole split is ONE global Undo step whose Undo is undoStemJob (the one call that removes
 *     exactly what the job created and unmutes the source). Redo is not offered as a new split (it is metered GPU
 *     work); it says so and changes nothing.
 * One split per project at a time (Freestyle answers 409 otherwise); a second request here is refused locally.
 */
import {splitClipStems,pollStemJob,undoStemJob,STEM_MODES} from './studio-api-engine-helpers.js';
import {STUDIO_API_OPERATIONS} from './studio-api-client.js';

export const ABL_STEM_CHOICES=Object.freeze([
 Object.freeze({mode:'vocals',label:'Vocals + Instrumental'}),
 Object.freeze({mode:'four_stems',label:'4 Stems (Vocals, Drums, Bass, Other)'}),
 // 2026-11-14 typed modes (POST clips/{id}/stems): six stems, and a drum kit split
 // (kick, snare, toms, hh, ride, crash; non-drum audio also returns vocals, bass, other).
 Object.freeze({mode:'instruments',label:'6 Stems (Vocals, Drums, Bass, Guitar, Piano, Other)'}),
 Object.freeze({mode:'drums',label:'Drums (Kick, Snare, Toms, Hi-Hat, Ride, Crash)'}),
]);
export const ABL_STEMS_LABEL='Separate Stems to New Audio Tracks';
const STEM_NAMES={instrumental:'Instrumental',vocals:'Vocals',drums:'Drums',bass:'Bass',other:'Other',guitar:'Guitar',piano:'Piano',kick:'Kick',snare:'Snare',toms:'Toms',hh:'Hi-Hat',ride:'Ride',crash:'Crash'};
const keyFor=()=>globalThis.crypto?.randomUUID?.()||`stems-${Date.now()}-${Math.random().toString(36).slice(2,12)}`;

/** Status-bar text for one polled job. */
export function stemProgressText(job,label='Separating stems'){
 if(!job||typeof job!=='object')return `${label}…`;
 if(job.status==='done')return `${label}: done — ${(job.lanes||[]).filter(lane=>!lane.deleted).map(lane=>lane.name||STEM_NAMES[lane.stem]||lane.stem).join(', ')||'no tracks'}.`;
 if(job.status==='failed')return `${label} failed: ${job.error||'Freestyle reported no reason'}. Nothing was created.`;
 if(job.status==='undone')return `${label}: undone.`;
 const elapsed=Number.isFinite(job.elapsedSec)?job.elapsedSec:null,eta=Number.isFinite(job.etaSec)?job.etaSec:null;
 const pct=elapsed!=null&&eta!=null&&elapsed+eta>0?Math.min(99,Math.round(100*elapsed/(elapsed+eta))):null;
 return `${label}… ${pct!=null?`${pct}%`:''}${eta!=null?` (about ${eta}s left)`:elapsed!=null?` (${elapsed}s)`:''}`.replace(/\s+$/,'');
}

export class AblStems{
 /** hooks: client() → StudioApiClient|null, projectId() → id|null, history() → CloudPatternHistory, refresh() → Promise,
  *  etag() → timeline If-Match|null, reloadEngine(detail)?, status(text), toast(text), log(kind,data), fail(error),
  *  pollOptions? (tests: sleep/now). */
 constructor(hooks={}){this.hooks=hooks;this.job=null;}
 log(kind,data){try{this.hooks.log?.(kind,data);}catch{}}
 status(text){try{this.hooks.status?.(text);}catch{}}
 /** Why the split cannot run for this clip now (null when it can). */
 unavailable(clip){
  const ops=this.hooks.operations||STUDIO_API_OPERATIONS;
  if(!['splitClipStems','getStemJob','undoStemJob'].every(name=>Object.prototype.hasOwnProperty.call(ops,name)))return 'Stem separation is unavailable in this Freestyle API build.';
  if(!clip||clip.patternId)return 'Stem separation works on audio clips.';
  if(!clip.cloudId)return 'Wait until this clip is saved in Freestyle.';
  let client=null,project=null;try{client=this.hooks.client?.()??null;project=this.hooks.projectId?.()??null;}catch{}
  if(!client||!project)return 'Connect the Freestyle cloud project (Studio API) first.';
  if(this.job)return `Wait for the current stem separation (${this.job.label}) to finish.`;
  return null;
 }
 /** The context-menu entry: a submenu (Vocals + Instrumental / 4 Stems), or one disabled item with its reason. */
 menuItems(clip,guard=run=>run){
  const reason=this.unavailable(clip);
  if(reason)return[{label:ABL_STEMS_LABEL,disabled:true,title:reason}];
  return[{label:ABL_STEMS_LABEL,submenu:ABL_STEM_CHOICES.filter(choice=>STEM_MODES.includes(choice.mode)).map(choice=>({label:choice.label,run:guard(()=>this.run(clip,choice.mode))}))}];
 }
 async run(clip,mode){
  const reason=this.unavailable(clip);if(reason)throw Object.assign(new Error(reason),{dispatched:false});
  const choice=ABL_STEM_CHOICES.find(item=>item.mode===mode);if(!choice)throw Object.assign(new Error('Choose a stem separation mode.'),{dispatched:false});
  const client=this.hooks.client(),projectId=this.hooks.projectId(),label=`Separating ${clip.name?`“${clip.name}”`:'the clip'} (${choice.label})`;
  const job={label,clipId:clip.cloudId,mode,idempotencyKey:keyFor(),projectId,jobId:null,status:'starting'};this.job=job;
  const controller=typeof AbortController==='function'?new AbortController():null;job.abort=()=>controller?.abort();
  this.status(`${label}…`);this.log('abl-stems-start',{clipId:clip.cloudId,mode});
  try{
   const started=await splitClipStems({client,projectId,clipId:clip.cloudId,mode,replace:true,idempotencyKey:job.idempotencyKey});
   job.jobId=started.jobId;job.status=started.status;this.log('abl-stems-job',{jobId:started.jobId,status:started.status,cached:started.cached===true});
   const final=started.status==='processing'?await pollStemJob({client,projectId,jobId:started.jobId,signal:controller?.signal,onProgress:state=>{if(this.job===job)this.status(stemProgressText(state,label));},...(this.hooks.pollOptions||{})}):started;
   job.status=final.status;this.status(stemProgressText(final,label));
   if(final.status!=='done'){this.log('abl-stems-finished',{jobId:final.jobId,status:final.status,error:final.error??null});if(final.status==='failed')throw Object.assign(new Error(stemProgressText(final,'Stem separation')),{dispatched:true,stemJob:final});return final;}
   if(this.hooks.projectId?.()!==projectId){this.log('abl-stems-project-changed',{jobId:final.jobId});return final;}
   await this.adopt(final,projectId,choice);
   return final;
  }finally{if(this.job===job)this.job=null;}
 }
 /** Re-read the project so the stem tracks appear, as ONE global history step (Undo = undoStemJob). */
 async adopt(final,projectId,choice){
  const history=this.hooks.history?.()??null;let token=null;
  try{token=history?.beginExternalStep?.({kind:'clip_stems',label:'Separate Stems'})??null;}catch(error){this.log('abl-stems-history-busy',{message:String(error?.message||error).slice(0,160)});}
  try{if(final.reload)this.hooks.reloadEngine?.({projectId,divergent:[],reason:'stems'});await this.hooks.refresh?.();}
  catch(error){if(token)history.failExternalStep(token,error);throw error;}
  const lanes=(final.lanes||[]).filter(lane=>!lane.deleted).map(lane=>lane.laneId);
  const undo=async()=>{
   if(this.hooks.projectId?.()!==projectId)throw Object.assign(new Error('Open the project that was split before undoing its stems.'),{dispatched:false});
   let receipt;try{receipt=await undoStemJob({client:this.hooks.client(),projectId,jobId:final.jobId,ifMatch:this.hooks.etag?.()??undefined,idempotencyKey:keyFor()});}
   catch(error){if(error?.status>=400&&error?.status<500&&error?.status!==408)error.dispatched=false;throw error;}
   if(receipt.engine_reload_required||receipt.liveEngine?.applied===false)this.hooks.reloadEngine?.({projectId,divergent:[],reason:'stems-undo'});
   await this.hooks.refresh?.();this.status(receipt.alreadyUndone?'Stems were already removed.':`Stems removed (${receipt.removedLaneIds?.length??0} tracks); the source clip is active again.`);
   this.log('abl-stems-undo',{jobId:final.jobId,removedLanes:receipt.removedLaneIds?.length??0,alreadyUndone:receipt.alreadyUndone===true});return receipt;
  };
  const redo=async()=>{throw Object.assign(new Error('Redo of a stem separation would start a new (metered) split: use Separate Stems again.'),{dispatched:false,historyNotApplied:true});};
  let recorded=false;
  if(token)recorded=history.finishExternalStep(token,{undo,redo,detail:{jobId:final.jobId,mode:choice.mode,lanes}});
  this.log('abl-stems-done',{jobId:final.jobId,lanes:lanes.length,recorded});
  if(!recorded)try{this.hooks.toast?.('Stems created. Undo History is busy, so this split is not an Undo step; remove the stem tracks by hand.');}catch{}
  this.lastJob={jobId:final.jobId,projectId,undo};
  return recorded;
 }
 cancel(){this.job?.abort?.();}
}
