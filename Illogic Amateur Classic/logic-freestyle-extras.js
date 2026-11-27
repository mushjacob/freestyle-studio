/** Menu wiring for the Studio API extras (one install call from app.js):
 *  - File ▸ Import ▸ Audio from URL…   (logic-url-import.js, one import Undo step)
 *  - File ▸ Export ▸ Export History…   (logic-export-history.js)
 *  - File ▸ Share ▸ Collaborators…     (logic-collaborators.js)
 *  - Freestyle ▸ Assistant Job Status… / Undo Last Assistant Action (logic-assistant.js)
 *  - Freestyle ▸ Listen to Cloud-Rendered Preview reuses a current latest mix.
 * Every Studio call goes through the generated client the app already holds for the
 * open OAuth project; without one the items stay disabled with the reason.
 */
import {openUrlImportDialog,performUrlImport} from './logic-url-import.js';
import {openExportHistoryDialog,listenWithReuse} from './logic-export-history.js';
import {openCollaboratorsDialog} from './logic-collaborators.js';
import {AssistantJobTracker,assistantResultJob,openAssistantJobsDialog,runUndoLastAssistantAction} from './logic-assistant.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
export const STUDIO_API_REQUIRED='Needs a Freestyle Studio API (OAuth) project. Reload the project from Freestyle ▸ Freestyle Cloud Engine….';

/**
 * deps: studioClient() → StudioApiClient|null; projectId() → id|null (ready, not loading);
 * trackId() → engine context track; scope() → JSON-comparable import scope; dialog; confirm(title, html, ok);
 * toast; fail; log; busy() → reason string|null; flush(); refresh() (re-read project + waveforms);
 * importWithHistory(perform) → one audio-import history step; playhead() → {seconds, label};
 * timelineRevision(); projectUpdatedAt(); renderListen(); stopListen(); audioFactory(); openAssistant();
 * eventTarget (window) for the cloud panel's 'vegetable-cloud-result'.
 */
export function installFreestyleExtras(deps){
 const d={log:()=>{},busy:()=>null,flush:async()=>{},refresh:async()=>{},stopListen:()=>{},audioFactory:()=>new Audio(),toast:()=>{},fail:error=>{throw error;},...deps};
 const client=()=>{try{return d.studioClient();}catch{return null;}};
 const available=()=>!!d.projectId()&&typeof client()?.call==='function';
 const sameScope=scope=>()=>JSON.stringify(d.scope())===JSON.stringify(scope)&&d.projectId()===scope?.projectId;
 const requireApi=()=>{const projectId=d.projectId(),api=client();if(!projectId)throw new Error('Open a Freestyle project first.');if(typeof api?.call!=='function')throw new Error(STUDIO_API_REQUIRED);return{projectId,api};};
 const tracker=new AssistantJobTracker({client,scope:()=>{const projectId=d.projectId();return projectId?{projectId}:null;},log:d.log,
  onChange:()=>{},onDone:async(job,{projectId})=>{if(d.projectId()!==projectId)return;await d.refresh();d.toast(job.status==='done'?`Assistant finished${job.reply?': '+job.reply:'.'} The project was read again.`:`Assistant job ${job.status}.${job.reply?' '+job.reply:''}`);}});
 // The Assistant panel reports each tool result; a background generation is followed here,
 // and any other applied Mozart command is an outside change: re-read the project.
 const onCloudResult=event=>{const {name,args,result}=event?.detail||{};if(name!=='mozart_ai_command'||!result||result.isError)return;const projectId=d.projectId();if(!projectId||args?.project_id&&args.project_id!==projectId)return;
  const jobId=assistantResultJob(result);if(jobId){try{tracker.track(jobId).catch(()=>{});d.toast('Assistant job started. Follow it in Freestyle ▸ Assistant Job Status….');}catch(error){d.log('assistant-track-failed',{message:String(error?.message||error).slice(0,160)});}return;}
  Promise.resolve().then(()=>d.refresh()).catch(error=>d.log('assistant-refresh-failed',{message:String(error?.message||error).slice(0,160)}));};
 d.eventTarget?.addEventListener?.('vegetable-cloud-result',onCloudResult);

 async function importFromUrl(){
  const {projectId}=requireApi(),blocked=d.busy();if(blocked)throw new Error(blocked);const playhead=d.playhead?.()||{seconds:0,label:''};
  return openUrlImportDialog({dialog:d.dialog,playheadLabel:playhead.label,onSubmit:request=>{
   const scope=d.scope();if(d.projectId()!==projectId)return d.toast('The project changed. Choose Import ▸ Audio from URL… again.');
   const reason=d.busy();if(reason)return d.toast(reason);const current=sameScope(scope),assert=()=>{if(!current())throw Object.assign(new Error('The project changed during the URL import.'),{name:'AbortError'});};
   const startMs=request.atPlayhead&&Number.isFinite(playhead.seconds)&&playhead.seconds>=0?Math.round(playhead.seconds*1000):null;
   d.toast('Freestyle is downloading the audio…');
   return d.importWithHistory(()=>performUrlImport({client:client(),projectId,trackId:d.trackId(),url:request.url,title:request.title,kind:request.kind,startMs,assert,log:d.log,onReloadRequired:info=>d.onReloadRequired?.(info)}))
    .then(result=>{const notes=[result?.positionError?'it stays where Freestyle placed it ('+result.positionError+')':'',result?.attachmentPending?'live loading is unconfirmed: reload the session if it does not play':''].filter(Boolean);d.toast(`${result?.title||'Audio'} imported from the URL on a new track.${notes.length?' Note: '+notes.join('; ')+'.':''} ⌘Z removes it.`);return result;})
    .catch(error=>d.fail(error));
  }});
 }
 function exportHistory(){const {projectId,api}=requireApi();const current=()=>d.projectId()===projectId;return openExportHistoryDialog({dialog:d.dialog,client:api,projectId,isCurrent:current,log:d.log});}
 function collaborators(){const {projectId,api}=requireApi();return openCollaboratorsDialog({dialog:d.dialog,client:api,projectId,isCurrent:()=>d.projectId()===projectId,toast:d.toast,log:d.log,
  confirm:row=>d.confirm('Remove Collaborator',`<p>Remove <b>${esc(row.label)}</b> from this project?</p><p>They lose access at once. You can invite them again later.</p>`,'Remove')});}
 function assistantJobs(){return openAssistantJobsDialog({dialog:d.dialog,tracker,openAssistant:d.openAssistant||null});}
 async function undoAssistant(){
  const {projectId,api}=requireApi(),blocked=d.busy();if(blocked)throw new Error(blocked);const scope=d.scope(),current=sameScope(scope);
  return runUndoLastAssistantAction({client:api,projectId,trackId:d.trackId(),log:d.log,toast:d.toast,isCurrent:current,prepare:()=>d.flush(),refresh:()=>d.refresh(),
   confirm:()=>d.confirm('Undo Last Assistant Action','<p>Revert the latest change the Freestyle Assistant (Mozart AI) made to this project?</p><p>Freestyle undoes it in the cloud project. It is not part of this window’s ⌘Z history: older ⌘Z steps that touch the same material stop until you reopen the project.</p>','Undo Assistant Action')});
 }
 let listenAudio=null;
 async function playMix(url,{startSec=0}={}){
  d.stopListen();listenAudio?.pause?.();const audio=d.audioFactory();listenAudio=audio;audio.preload='auto';audio.src=url;
  if(startSec>0){await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;resolve();};audio.addEventListener?.('loadedmetadata',finish,{once:true});audio.addEventListener?.('error',finish,{once:true});setTimeout(finish,4000);});try{audio.currentTime=startSec;}catch{}}
  await audio.play();
 }
 async function listen(){
  const api=client(),projectId=d.projectId();if(!api||!projectId)return d.renderListen();
  await d.flush();if(d.projectId()!==projectId)throw new Error('The project changed. Choose Listen again.');
  const outcome=await listenWithReuse({client:api,projectId,timelineRevision:d.timelineRevision?.()??null,projectUpdatedAt:d.projectUpdatedAt?.()??null,startSec:d.playhead?.()?.seconds??0,render:()=>d.renderListen(),play:playMix,log:d.log});
  if(outcome.reused)d.toast('Playing the latest cloud mix of this version (no new render).');return outcome;
 }
 const gate=(label,run,{extra=null,shortcut=''}={})=>{const ok=available(),reason=ok?extra:null;return{label,shortcut,run:()=>Promise.resolve().then(run).catch(error=>d.fail(error)),disabled:!ok||!!reason,title:!d.projectId()?'Open a Freestyle project first.':!ok?STUDIO_API_REQUIRED:reason||''};};
 const items={
  importUrl:()=>gate('Audio from URL…',importFromUrl,{extra:d.busy()}),
  exportHistory:()=>gate('Export History…',exportHistory),
  collaborators:()=>gate('Collaborators…',collaborators),
  assistantJobs:()=>({label:'Assistant Job Status…',run:()=>{try{return assistantJobs();}catch(error){d.fail(error);}},disabled:false,title:'Progress of Mozart AI generations started from the Assistant'}),
  undoAssistant:()=>gate('Undo Last Assistant Action',undoAssistant,{extra:d.busy()})
 };
 const destroy=()=>{d.eventTarget?.removeEventListener?.('vegetable-cloud-result',onCloudResult);tracker.stop();listenAudio?.pause?.();};
 return{item:name=>items[name](),importFromUrl,exportHistory,collaborators,assistantJobs,undoAssistant,listen,tracker,destroy};
}
