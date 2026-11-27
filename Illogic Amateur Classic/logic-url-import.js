/** File ▸ Import ▸ Audio from URL… (Logic: File ▸ Import ▸ Audio File…, from a web address).
 *
 * addAudioFromUrl POST /projects/{id}/audio:fromUrl {url, kind, title} (spec 357):
 * Freestyle downloads a public https file, scans it like an upload and answers 201
 * with a MediaAddResult {clipId, laneId, startMs, durationSec, engine_attached,
 * engine_reload_required, …}. The contract has no 202 / job form; a body without a
 * clip (a job id, kind backing) is reported, never guessed. kind 'audio' is "a plain
 * audio lane, like the app's file import"; 'vocal' adds a vocal lane with the default
 * vocal chain; 'backing' (replaces the backing track) is not offered here.
 *
 * Placement follows a file dropped on empty Tracks-area space at the playhead: the
 * new track, then (when Freestyle put the region elsewhere) ONE applyClipBatch update
 * of start_ms guarded by `expected.start_ms` (update may omit the other timing
 * fields). The live session loads the clip through attachClipToSession only when the
 * receipt did not say engine_attached. The caller runs all of it inside the same
 * AudioImportHistoryController step as a file import: Undo deletes the owned new
 * lane (deleteLane), Redo restores it.
 *
 * Every write carries one retained Idempotency-Key; an unknown outcome (network,
 * 408, 5xx) is asked once more with the same key (Freestyle replays the stored
 * answer for 24 h, never a second download).
 */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value===value.trim()&&!/[\u0000- \u007f]/.test(value);
const fail=(message,code='url_import_invalid',extra={})=>Object.assign(new Error(message),{code},extra);
/* Freestyle answers a URL it could not fetch or accept with a typed code (live: 502 download_failed); that is a definite refusal, never an unknown outcome. */
const DEFINITE_REFUSALS=new Set(['download_failed','file_too_large','unsupported_media_type','invalid_audio','url_not_allowed']);
const refusalCode=error=>String(error?.code??error?.error?.code??'');
const definiteRefusal=error=>DEFINITE_REFUSALS.has(refusalCode(error));
const transient=error=>{if(definiteRefusal(error))return false;const status=Number(error?.status);return error?.dispatched!==false&&(!Number.isInteger(status)||status===0||status===408||status>=500);};
const defaultKey=()=>globalThis.crypto?.randomUUID?.()||`url-import-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const URL_IMPORT_OPERATION='addAudioFromUrl';
export const URL_IMPORT_OPERATIONS=Object.freeze(['addAudioFromUrl','applyClipBatch','attachClipToSession']);
export const URL_IMPORT_KINDS=Object.freeze([
 Object.freeze({kind:'audio',label:'Audio track',detail:'A plain audio track, like File ▸ Import ▸ Audio File…'}),
 Object.freeze({kind:'vocal',label:'Vocal track',detail:'A vocal track with Freestyle’s default vocal chain'})
]);
export const URL_IMPORT_MAX_URL=8192,URL_IMPORT_MAX_TITLE=120;

/** A public https address (the contract downloads https only); no credentials in the URL. */
export function checkImportUrl(value){
 const text=typeof value==='string'?value.trim():'';
 if(!text)throw fail('Enter the web address of an audio file.','url_import_url',{dispatched:false});
 if(text.length>URL_IMPORT_MAX_URL)throw fail('That address is longer than Freestyle accepts (8192 characters).','url_import_url',{dispatched:false});
 let url;try{url=new URL(text);}catch{throw fail('Enter a complete https:// address of an audio file.','url_import_url',{dispatched:false});}
 if(url.protocol!=='https:')throw fail('Freestyle downloads audio from public https:// addresses only.','url_import_url',{dispatched:false});
 if(url.username||url.password)throw fail('Remove the user name or password from the address; Freestyle downloads public files only.','url_import_url',{dispatched:false});
 if(!url.hostname)throw fail('Enter a complete https:// address of an audio file.','url_import_url',{dispatched:false});
 return url.href.length<=URL_IMPORT_MAX_URL?url.href:text;
}
/** Region / track name: the typed title, else the file name in the address (decoded, extension kept off). */
export function urlImportTitle(url,title=''){
 const typed=String(title||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();if(typed)return Array.from(typed).slice(0,URL_IMPORT_MAX_TITLE).join('');
 let name='';try{const last=new URL(url).pathname.split('/').filter(Boolean).pop()||'';name=decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i,'');}catch{}
 name=name.replace(/[\u0000-\u001f\u007f]/g,' ').trim();return name?Array.from(name).slice(0,URL_IMPORT_MAX_TITLE).join(''):'';
}
/** The documented body: {url, kind, title?}. */
export function urlImportBody({url,title='',kind='audio'}={}){
 const href=checkImportUrl(url);if(!URL_IMPORT_KINDS.some(item=>item.kind===kind))throw fail('Choose an audio or a vocal track.','url_import_kind',{dispatched:false});
 const name=urlImportTitle(href,title);return{url:href,kind,...(name?{title:name}:{})};
}
/** Validate a MediaAddResult for this project: one new clip on one lane. */
export function checkMediaAddResult(result,{projectId}={}){
 const status=Number(result?.status),data=result?.data;
 if(!record(data))throw fail('Freestyle answered the URL import without a readable result.','url_import_receipt',{operationCommitted:true,operationUncertain:true});
 if(data.ok===false||record(data.error))throw fail(data.error?.message||data.message||'Freestyle refused the URL import.','url_import_refused',{explicitRejection:true});
 const owner=data.project?.id??data.projectId??data.project_id;if(owner!=null&&owner!==projectId)throw fail('Freestyle returned the URL import of another project.','url_import_receipt',{operationCommitted:true,operationUncertain:true});
 if(status===202||!data.clipId&&(data.jobId||data.job_id))throw fail('Freestyle answered with a background job, which the published addAudioFromUrl contract does not describe. Reload the project to see whether the audio arrived; it was not requested again.','url_import_job_unsupported',{operationCommitted:true,operationUncertain:true});
 if(!id(data.clipId)||!id(data.laneId))throw fail('Freestyle added the audio but did not name its new region and track. Reload the project before importing it again.','url_import_receipt',{operationCommitted:true,operationUncertain:true});
 if(data.startMs!==undefined&&(!Number.isSafeInteger(data.startMs)||data.startMs<0))throw fail('Freestyle returned an invalid start for the imported region.','url_import_receipt',{operationCommitted:true,operationUncertain:true});
 for(const key of ['engine_attached','engine_reload_required'])if(data[key]!==undefined&&typeof data[key]!=='boolean')throw fail(`Freestyle returned an invalid ${key} acknowledgement.`,'url_import_receipt',{operationCommitted:true,operationUncertain:true});
 return data;
}
/** One retained key; an unknown outcome is asked once more with the same key. */
async function retainedWrite(client,operationId,parameters,{key,assert=()=>{},log=()=>{}}={}){
 const send=()=>client.call(operationId,parameters,{idempotencyKey:key});
 try{return await send();}
 catch(error){
  if(definiteRefusal(error)||!transient(error)&&error?.operationUncertain!==true)throw Object.assign(error,{explicitRejection:definiteRefusal(error)||Number(error?.status)>=400&&Number(error?.status)<500&&Number(error?.status)!==408,operationAttempted:error?.dispatched!==false,...definiteRefusal(error)?{operationUncertain:false}:{}});
  assert();log('url-import-replay',{operationId,status:error?.status??null});
  try{return await send();}catch(again){throw Object.assign(again,{operationAttempted:true,operationUncertain:transient(again)||again?.operationUncertain===true,explicitRejection:!transient(again)&&Number(again?.status)>=400&&Number(again?.status)<500});}
 }
}
/** POST addAudioFromUrl (one retained key) → the validated MediaAddResult. */
export async function sendAddAudioFromUrl({client,projectId,body,key=defaultKey(),assert,log}={}){
 if(typeof client?.call!=='function')throw fail('Import from URL needs a Studio API (OAuth) project. Reload the project.','url_import_unavailable',{dispatched:false});
 if(!id(projectId)&&!(typeof projectId==='string'&&projectId.length<=128&&projectId))throw fail('Open a Freestyle project first.','url_import_scope',{dispatched:false});
 const result=await retainedWrite(client,URL_IMPORT_OPERATION,{path:{project_id:projectId},body},{key,assert,log});
 return checkMediaAddResult(result,{projectId});
}
/** Move the new region to the playhead (applyClipBatch update guarded by expected.start_ms).
 * Never fatal: the clip is saved either way and the history step adopts the read-back truth. */
export async function positionImportedClip({client,projectId,trackId=null,clipId,fromMs,toMs,key=defaultKey(),assert,log=()=>{}}={}){
 if(!Number.isSafeInteger(toMs)||toMs<0||toMs>86400000||!Number.isSafeInteger(fromMs)||fromMs===toMs)return{moved:false,skipped:true};
 const body={ops:[{op:'update',id:clipId,start_ms:toMs,expected:{start_ms:fromMs}}],...(typeof trackId==='string'&&trackId&&trackId.length<=64?{track_id:trackId}:{})};
 try{const result=await retainedWrite(client,'applyClipBatch',{path:{project_id:projectId},body},{key,assert,log});const data=result?.data;if(record(data)&&(data.ok===false||data.applied===false))return{moved:false,error:data.error?.message||'Freestyle did not move the region.'};return{moved:true,engineReloadRequired:data?.engine_reload_required===true};}
 catch(error){if(error?.code==='url_import_scope'||error?.name==='AbortError')throw error;log('url-import-position-failed',{status:error?.status??null,code:error?.code??null});return{moved:false,error:error?.message||String(error),uncertain:transient(error)};}
}
/** Load the saved clip into the open live session unless the receipt already did. Never fatal. */
export async function attachImportedClip({client,projectId,trackId=null,clipId,receipt={},key=defaultKey(),assert,log=()=>{}}={}){
 if(receipt.engine_attached===true&&receipt.engine_reload_required!==true)return{attached:true,byImport:true};
 if(receipt.engine_reload_required===true)return{attached:false,reloadRequired:true};
 if(receipt.engine_attached===false)return{attached:false,noSession:true};
 try{await retainedWrite(client,'attachClipToSession',{path:{project_id:projectId,clip_id:clipId},body:typeof trackId==='string'&&trackId&&trackId.length<=64?{track_id:trackId}:{}},{key,assert,log});return{attached:true};}
 catch(error){if(Number(error?.status)===409)return{attached:true,alreadyLoaded:true};if(error?.name==='AbortError')throw error;log('url-import-attach-failed',{status:error?.status??null});return{attached:false,error:error?.message||String(error)};}
}
/**
 * The whole import (the `perform` of one audio-import history step):
 * addAudioFromUrl → optional move to the playhead → live attachment.
 * Returns the receipt plus {clipId, laneId, persisted:true, positioned, attachmentPending, attachmentError}.
 */
export async function performUrlImport({client,projectId,trackId=null,url,title,kind='audio',startMs=null,assert=()=>{},log=()=>{},onReloadRequired=()=>{},key=defaultKey}={}){
 let receipt;
 try{const body=urlImportBody({url,title,kind});receipt=await sendAddAudioFromUrl({client,projectId,body,key:key(),assert,log});}
 catch(error){if(error?.operationAttempted===undefined)error.operationAttempted=error?.dispatched!==false;if(error.code==='url_import_receipt'||error.code==='url_import_job_unsupported')error.operationCommitted=true;throw error;}
 assert();log('url-import-added',{clipId:receipt.clipId,laneId:receipt.laneId,startMs:receipt.startMs??null,kind});
 let positioned={moved:false,skipped:true};
 if(Number.isSafeInteger(startMs)&&Number.isSafeInteger(receipt.startMs)&&receipt.startMs!==startMs){positioned=await positionImportedClip({client,projectId,trackId,clipId:receipt.clipId,fromMs:receipt.startMs,toMs:startMs,key:key(),assert,log});assert();}
 const attachment=await attachImportedClip({client,projectId,trackId,clipId:receipt.clipId,receipt,key:key(),assert,log});assert();
 if(attachment.reloadRequired||positioned.engineReloadRequired){try{onReloadRequired({projectId,warning:'Audio saved; the live session could not load it yet. Reloading the session.'});}catch{}}
 return{...receipt,persisted:true,positioned:positioned.moved===true,positionError:positioned.error||null,attachmentPending:attachment.attached!==true&&!attachment.noSession,attachmentError:attachment.error||null,liveReloadPending:attachment.reloadRequired===true};
}
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
/** The Import ▸ Audio from URL… sheet. onSubmit({url, title, kind, atPlayhead}) runs after validation. */
export function openUrlImportDialog({dialog,playheadLabel='',onSubmit}={}){
 if(typeof dialog!=='function'||typeof onSubmit!=='function')throw new TypeError('openUrlImportDialog needs dialog and onSubmit.');
 const d=dialog('Import Audio from URL',`<form class="logic-url-import"><p>Freestyle downloads a public <b>https://</b> audio file (WAV, MP3, M4A, FLAC…), checks it like an upload and adds it on a new track. ⌘Z removes it again.</p><label>Address <input name="url" type="url" required maxlength="${URL_IMPORT_MAX_URL}" placeholder="https://example.com/take.wav" autocomplete="off" spellcheck="false"></label><label>Name <input name="title" maxlength="${URL_IMPORT_MAX_TITLE}" placeholder="From the file name" autocomplete="off"></label><label>New track <select name="kind">${URL_IMPORT_KINDS.map(item=>`<option value="${item.kind}" title="${esc(item.detail)}">${esc(item.label)}</option>`).join('')}</select></label><label><input type="checkbox" name="playhead" checked> Place at the playhead${playheadLabel?` (${esc(playheadLabel)})`:''}</label><p class="logic-url-import-error" role="alert"></p><button type="submit" class="primary">Import</button><button type="button" class="cancel">Cancel</button></form>`);
 const form=d.querySelector('form'),error=d.querySelector('.logic-url-import-error');d.querySelector('.cancel').onclick=()=>d.close();
 form.onsubmit=event=>{event.preventDefault();const url=form.elements.url.value,title=form.elements.title.value,kind=form.elements.kind.value,atPlayhead=!!form.elements.playhead.checked;
  try{urlImportBody({url,title,kind});}catch(cause){error.textContent=cause.message;return;}
  d.close();onSubmit({url:url.trim(),title:title.trim(),kind,atPlayhead});};
 return d;
}
