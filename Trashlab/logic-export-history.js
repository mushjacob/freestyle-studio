/** File ▸ Export ▸ Export History… and the cloud Listen preview reuse.
 *
 * listExports GET /projects/{id}/exports?limit (1–20, default 10) → ExportList
 * {projectId, exports[], saves[], hasMore}: rendered exports (newest first) and saves
 * with a finished render, each with a ONE-HOUR signed downloadUrl. Row fields are
 * open (additionalProperties); the reader takes the documented ExportJob names
 * (jobId, status, downloadUrl, export{}) and common aliases, never inventing a link.
 * getExportStatus GET …/exports/jobs/{job_id} → ExportJob {status queued | rendering |
 * uploading | complete | failed | fallback_required, downloadUrl when complete,
 * retryAfterSec}: used to follow a pending row and to renew an expired link.
 *
 * getProjectListenPreview GET /projects/{id}/listen-preview → ListenPreview
 * {playbackAudioUrl, latestMix, durationSec, …}: the shared listen player's latest
 * rendered mix. Freestyle ▸ Listen plays it instead of rendering again ONLY when the
 * mix provably matches the current timeline (a revision it states equals the
 * project's, or it was rendered after the project's last saved change); otherwise
 * the existing 12-second cloud render runs as before.
 */
import {safeExportUrl} from './cloud-export.js';
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'?value.trim():'';
const pick=(row,keys)=>{for(const key of keys){const value=key.split('.').reduce((item,part)=>item?.[part],row);if(value!==undefined&&value!==null&&value!=='')return value;}return null;};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const fail=(message,code='export_history_invalid',extra={})=>Object.assign(new Error(message),{code},extra);
const JOB=/^[A-Za-z0-9._:-]{1,128}$/;

export const EXPORT_HISTORY_OPERATIONS=Object.freeze(['listExports','getExportStatus']);
export const LISTEN_PREVIEW_OPERATION='getProjectListenPreview';
export const EXPORT_HISTORY_LIMIT=20;
const COMPLETE=new Set(['complete','completed','ready','done','succeeded','success']),FAILED=new Set(['failed','error','cancelled','canceled','fallback_required']),PENDING=new Set(['queued','rendering','uploading','processing','running','pending']);
export function exportStatusKind(status){const value=text(status).toLowerCase();return COMPLETE.has(value)?'complete':FAILED.has(value)?'failed':PENDING.has(value)?'pending':value?'other':'unknown';}
const time=value=>{const parsed=typeof value==='number'?value:Date.parse(String(value||''));return Number.isFinite(parsed)?parsed:null;};

/** One display row from an export or save entry (open object): never a guessed link. */
export function exportHistoryRow(entry,kind='export'){
 if(!record(entry))return null;const nested=record(entry.export)?entry.export:{};
 const jobId=pick(entry,['jobId','job_id','export.jobId'])??null,rowId=pick(entry,['id','exportId','export_id','saveId','save_id'])??jobId;
 const status=text(pick(entry,['status','export.status','render.status','renderStatus']))||(kind==='save'?'complete':'');
 const url=safeExportUrl(pick(entry,['downloadUrl','download_url','export.downloadUrl','render.downloadUrl','directDownloadUrl','audioUrl']));
 const created=pick(entry,['createdAt','created_at','completedAt','completed_at','finishedAt','updatedAt','export.createdAt','savedAt']);
 const title=text(pick(entry,['title','name','label','filename','fileName','export.title','export.filename']))||(kind==='save'?'Saved version':'Cloud mix');
 const duration=Number(pick(entry,['durationSec','duration_sec','export.durationSec']));const format=text(pick(entry,['format','mimeType','mime_type','export.format','export.mimeType']));
 return{kind,id:rowId==null?null:String(rowId),jobId:typeof jobId==='string'&&JOB.test(jobId)?jobId:null,title,status:status||null,statusKind:status?exportStatusKind(status):url?'complete':'unknown',downloadUrl:url,createdAt:typeof created==='string'||typeof created==='number'?created:null,createdMs:time(created),durationSec:Number.isFinite(duration)&&duration>0?duration:null,format:format||nested.format||null,error:text(pick(entry,['error.message','error','message']))||null};
}
/** ExportList → {rows (exports first, then saves; newest first inside each), hasMore}. */
export function exportHistoryRows(data,{projectId}={}){
 if(!record(data)||!Array.isArray(data.exports)||!Array.isArray(data.saves))throw fail('Freestyle returned an unreadable export list.');
 if(data.projectId!=null&&projectId&&data.projectId!==projectId)throw fail('Freestyle returned the exports of another project.');
 const rows=[...data.exports.map(entry=>exportHistoryRow(entry,'export')),...data.saves.map(entry=>exportHistoryRow(entry,'save'))].filter(Boolean);
 return{rows,hasMore:data.hasMore===true,projectUrl:safeExportUrl(data.projectUrl)};
}
export async function loadExportHistory({client,projectId,limit=EXPORT_HISTORY_LIMIT,signal}={}){
 if(typeof client?.call!=='function')throw fail('Export history needs a Studio API (OAuth) project. Reload the project.','export_history_unavailable',{dispatched:false});
 if(typeof projectId!=='string'||!projectId)throw fail('Open a Freestyle project first.','export_history_scope',{dispatched:false});
 const bounded=Math.max(1,Math.min(EXPORT_HISTORY_LIMIT,Math.trunc(limit)||EXPORT_HISTORY_LIMIT));
 const result=await client.call('listExports',{path:{project_id:projectId},query:{limit:bounded}},signal?{signal}:undefined);
 return exportHistoryRows(result?.data,{projectId});
}
/** getExportStatus → the row with its current status and (renewed) one-hour link. */
export async function refreshExportRow({client,projectId,row}={}){
 if(!row?.jobId)throw fail('This export has no job to check.','export_history_no_job',{dispatched:false});
 const result=await client.call('getExportStatus',{path:{project_id:projectId,job_id:row.jobId}}),job=result?.data;
 if(!record(job)||job.projectId!=null&&job.projectId!==projectId||job.jobId!=null&&job.jobId!==row.jobId)throw fail('Freestyle returned another export job.');
 const next=exportHistoryRow({...job,title:row.title,createdAt:row.createdAt},row.kind);
 return{...row,status:next.status||row.status,statusKind:next.status?next.statusKind:row.statusKind,downloadUrl:next.downloadUrl||(next.statusKind==='complete'?row.downloadUrl:null),retryAfterSec:Number.isFinite(Number(job.retryAfterSec))?Number(job.retryAfterSec):null,checkedAt:Date.now(),error:next.error};
}
const when=row=>row.createdMs==null?'':new Date(row.createdMs).toLocaleString();
const statusLabel=row=>({complete:'Ready',failed:row.status==='fallback_required'?'Needs a Studio render':'Failed',pending:row.status?row.status[0].toUpperCase()+row.status.slice(1)+'…':'Rendering…',other:row.status||'',unknown:'—'})[row.statusKind]||row.status||'';
/** Render the list into a container; actions call back with the row index. */
export function exportHistoryMarkup({rows,hasMore,loading=false,error=null}={}){
 if(loading)return'<p class="logic-export-history-state" role="status">Reading this project’s exports from Freestyle…</p>';
 const head=error?`<p class="logic-export-history-state" role="alert">${esc(error)}</p>`:'';
 if(!rows?.length)return head+'<p class="logic-export-history-state">No exports yet. File ▸ Bounce ▸ Project or Section… (⌘B) renders one.</p>';
 const items=rows.map((row,index)=>`<li data-export-row="${index}" data-export-kind="${row.kind}" data-export-status="${esc(row.statusKind)}"><span class="logic-export-title">${esc(row.title)}</span> <small>${esc([row.kind==='save'?'Save':'Export',when(row),row.durationSec?`${row.durationSec.toFixed(1)} s`:'',row.format||''].filter(Boolean).join(' · '))}</small> <span class="logic-export-status">${esc(statusLabel(row))}</span> ${row.downloadUrl?`<a class="logic-export-download" href="${esc(row.downloadUrl)}" target="_blank" rel="noopener noreferrer" download>Download</a>`:''}${row.jobId?` <button type="button" class="logic-export-check" data-export-check="${index}">${row.statusKind==='complete'?'Renew link':'Check status'}</button>`:''}${row.error&&row.statusKind==='failed'?` <small class="logic-export-error">${esc(row.error)}</small>`:''}</li>`).join('');
 return`${head}<ol class="logic-export-history" style="max-height:340px;overflow:auto;margin:6px 0;padding-left:22px">${items}</ol>${hasMore?'<p class="logic-export-history-more">Older exports exist beyond the newest 20.</p>':''}<p class="logic-export-history-note"><small>Download links are signed for one hour. Reopen this list (or Renew link) for a fresh one.</small></p>`;
}
/** File ▸ Export ▸ Export History… dialog. */
export function openExportHistoryDialog({dialog,client,projectId,isCurrent=()=>true,log=()=>{}}={}){
 if(typeof dialog!=='function')throw new TypeError('openExportHistoryDialog needs dialog.');
 const d=dialog('Export History','<div class="logic-export-history-body"></div><button type="button" class="logic-export-history-refresh">Refresh</button><button type="button" class="cancel">Close</button>');
 const body=d.querySelector('.logic-export-history-body');let state={rows:[],hasMore:false,loading:true,error:null},generation=0;
 const paint=()=>{if(!d.isConnected&&d.open===false&&!body.isConnected)return;body.innerHTML=exportHistoryMarkup(state);};
 const load=async()=>{const mine=++generation;state={...state,loading:true,error:null};paint();
  try{const next=await loadExportHistory({client,projectId});if(mine!==generation)return state;if(!isCurrent())throw fail('The project changed. Reopen Export History.');state={rows:next.rows,hasMore:next.hasMore,loading:false,error:null};}
  catch(error){if(mine!==generation)return state;state={...state,loading:false,error:error?.message||String(error)};log('export-history-read-failed',{status:error?.status??null,code:error?.code??null});}
  paint();return state;};
 body.addEventListener('click',async event=>{const button=event.target.closest?.('[data-export-check]');if(!button)return;const index=Number(button.dataset.exportCheck),row=state.rows[index];if(!row)return;button.disabled=true;
  try{const next=await refreshExportRow({client,projectId,row});if(!isCurrent())throw fail('The project changed. Reopen Export History.');state.rows=state.rows.map((item,at)=>at===index?next:item);state.error=null;}
  catch(error){state.error=error?.message||String(error);}paint();});
 d.querySelector('.logic-export-history-refresh').onclick=()=>load();d.querySelector('.cancel').onclick=()=>d.close();
 d.ready=load();return d;
}

/** ListenPreview → {url, title, durationSec, mix} or null when there is no playable mix. */
export function listenPreviewMedia(preview){
 if(!record(preview))return null;const mix=record(preview.latestMix)?preview.latestMix:null;
 const url=safeExportUrl(preview.playbackAudioUrl)||safeExportUrl(mix?.downloadUrl??mix?.playbackUrl??mix?.audioUrl??mix?.url);
 if(!url)return null;const duration=Number(preview.durationSec??mix?.durationSec);
 return{url,title:text(preview.title)||'Cloud mix',durationSec:Number.isFinite(duration)&&duration>0?duration:null,mix};
}
const revisionOf=value=>{const raw=pick(value||{},['timelineRevision','timeline_revision','revision','projectRevision','etag']);return raw==null?null:String(raw).replace(/^W\//,'').replace(/^"|"$/g,'').split('.')[0];};
/** True only when the latest mix provably renders the current saved timeline. */
export function listenPreviewIsCurrent(preview,{timelineRevision=null,projectUpdatedAt=null}={}){
 const media=listenPreviewMedia(preview);if(!media?.mix)return false;
 const mixRevision=revisionOf(media.mix),current=timelineRevision==null?null:String(timelineRevision).replace(/^W\//,'').replace(/^"|"$/g,'').split('.')[0];
 if(mixRevision!=null&&current!=null)return mixRevision===current;
 const rendered=time(pick(media.mix,['createdAt','created_at','completedAt','renderedAt','updatedAt'])),changed=time(projectUpdatedAt);
 return rendered!=null&&changed!=null&&rendered>=changed;
}
/** Read the listen preview; returns {media, current} (current = reuse it without re-rendering). Never throws for a missing mix. */
export async function readListenPreview({client,projectId,timelineRevision=null,projectUpdatedAt=null}={}){
 if(typeof client?.call!=='function'||typeof projectId!=='string'||!projectId)return{media:null,current:false};
 const result=await client.call(LISTEN_PREVIEW_OPERATION,{path:{project_id:projectId}}),preview=result?.data;
 if(record(preview)&&preview.projectId!=null&&preview.projectId!==projectId)throw fail('Freestyle returned the listen preview of another project.');
 const media=listenPreviewMedia(preview);return{media,current:!!media&&listenPreviewIsCurrent(preview,{timelineRevision,projectUpdatedAt}),preview};
}
/**
 * Freestyle ▸ Listen to Cloud-Rendered Preview: play the latest mix when it is current
 * (from `startSec`), else run `render()` (the existing listen_to_project path).
 * Returns {reused:boolean, media}.
 */
export async function listenWithReuse({client,projectId,timelineRevision,projectUpdatedAt,startSec=0,render,play,log=()=>{}}={}){
 let read={media:null,current:false};
 try{read=await readListenPreview({client,projectId,timelineRevision,projectUpdatedAt});}catch(error){log('listen-preview-read-failed',{status:error?.status??null});}
 if(read.current&&read.media){
  const offset=Number.isFinite(startSec)&&startSec>0&&(!read.media.durationSec||startSec<read.media.durationSec)?startSec:0;
  try{await play(read.media.url,{startSec:offset});log('listen-preview-reused',{startSec:offset});return{reused:true,media:read.media};}
  catch(error){log('listen-preview-reuse-failed',{message:String(error?.message||error).slice(0,160)});}
 }
 await render();return{reused:false,media:read.media};
}
