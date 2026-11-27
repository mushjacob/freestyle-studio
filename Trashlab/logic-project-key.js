/** Project key for the Logic LCD (Studio API 345).
 *
 * Set: renameProject PATCH /projects/{id} {key, scale, expected:{key, scale}};
 * a stale `expected` answers 409 key_changed and writes nothing. The getProject
 * ETag does not move on key changes yet (Freestyle known issue), so the guard is
 * `expected`, never If-Match. Live 2026-11-12 on the owned project: null → A
 * minor (rq ba381377…), stale guard 409 (rq 0d6bdf09…), A minor → null
 * (rq 988bda94…); the null restore is accepted.
 *
 * Analyze: startKeyAnalysis POST /projects/{id}/key-analysis {track_id?} and
 * getKeyAnalysis GET …/key-analysis/{job_id} (pending | running | succeeded |
 * failed). Logic has no key detection; Illogic offers it as Freestyle ▸
 * Analyze Key… with a “Set Project Key” result. Analysis never sets the key.
 */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const fail=(message,code='project_key_invalid',extra={})=>Object.assign(new Error(message),{code},extra);
const refused=(message,code='project_key_changed')=>fail(message,code,{dispatched:false,historyNotApplied:true});

export const PROJECT_KEY_OPERATIONS=Object.freeze(['getProject','renameProject']);
export const KEY_ANALYSIS_OPERATIONS=Object.freeze(['startKeyAnalysis','getKeyAnalysis']);
/** The published key enum (sharps) and Logic’s flat spellings for the popup. */
export const PROJECT_KEYS=Object.freeze(['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']);
export const PROJECT_SCALES=Object.freeze(['major','minor']);
const FLATS=Object.freeze({'C#':'D♭','D#':'E♭','F#':'G♭','G#':'A♭','A#':'B♭'});
export const KEY_ANALYSIS_POLL_LIMIT_MS=5*60*1000;
export const keyLabel=key=>FLATS[key]?`${key}/${FLATS[key]}`:String(key);
/** Display text: “A minor”, “C major”, “No Key”. */
export function keyName(key,scale){if(!key)return'No Key';return`${key}${scale?' '+scale:''}`;}
const sameKey=(a,b)=>(a?.key??null)===(b?.key??null)&&(a?.scale??null)===(b?.scale??null);
/** Normalize a detector answer to the writable enum (e.g. "Bb" → "A#", "Minor" → "minor"). */
export function writableKey(key,scale){
 const enharmonic={Db:'C#',Eb:'D#',Gb:'F#',Ab:'G#',Bb:'A#','D♭':'C#','E♭':'D#','G♭':'F#','A♭':'G#','B♭':'A#'};
 const root=typeof key==='string'?(enharmonic[key.trim()]||key.trim().replace(/^([a-g])/,char=>char.toUpperCase())):null;
 const mode=typeof scale==='string'?scale.trim().toLowerCase().replace(/^maj.*/,'major').replace(/^min.*/,'minor'):null;
 if(!PROJECT_KEYS.includes(root)||!['major','minor','chromatic'].includes(mode))return null;
 return{key:root,scale:mode};
}

/**
 * options: client() → StudioApiClient|null; scope() → {projectId}|null;
 * history() → CloudPatternHistory|null; refresh(context); log(event, detail);
 * sleep(ms); now().
 */
export class ProjectKeyController{
 constructor({client,scope,history=()=>null,refresh=null,log=()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>Date.now()}={}){
  if(typeof client!=='function'||typeof scope!=='function')throw new TypeError('ProjectKeyController needs client and scope.');
  Object.assign(this,{client,scope,history,refresh,log,sleep,now});this.busy=false;this.analysis=null;
 }
 api(){const client=this.client();if(typeof client?.call!=='function')throw fail('The project key needs a Studio API (OAuth) project. Reload the project.','project_key_unavailable',{dispatched:false});return client;}
 context(){const scope=this.scope();if(!id(scope?.projectId))throw fail('Open a Freestyle project first.','project_key_scope',{dispatched:false});return{projectId:scope.projectId};}
 assertContext(context){if(this.scope()?.projectId!==context.projectId)throw fail('The project changed before the key was saved.','project_key_scope',{operationUncertain:true});}
 async read(context=this.context()){
  const result=await this.api().call('getProject',{path:{project_id:context.projectId}});this.assertContext(context);
  const data=result?.data;if(!record(data)||data.id!=null&&data.id!==context.projectId)throw fail('Freestyle returned another project.','project_key_receipt');
  return{key:data.key??null,scale:data.scale??null};
 }
 /** One guarded PATCH: writes only while the saved key still equals `expected`. */
 async write(target,expected,context){
  let result;
  try{result=await this.api().call('renameProject',{path:{project_id:context.projectId},body:{key:target.key,scale:target.scale,expected:{key:expected.key,scale:expected.scale}}});}
  catch(error){if(error?.status===409)throw Object.assign(refused('The project key changed in Freestyle since it was read. Nothing was written.'),{status:409,current:error?.data?.error?.details?.current??null});throw error;}
  this.assertContext(context);const data=result?.data;
  if(!record(data)||data.ok===false||(data.key??null)!==target.key||(data.scale??null)!==target.scale)throw fail('Freestyle did not confirm the project key.','project_key_receipt',{operationUncertain:true});
  try{await this.refresh?.(context);}catch(error){this.log('project-key-refresh',{message:String(error?.message||error).slice(0,160)});}
  return{key:data.key??null,scale:data.scale??null,changed:data.keyChanged!==false};
 }
 /** Set the project key (null key = No Key). One history step. */
 async setKey(key,scale){
  if(this.busy)throw fail('Wait for the current key change to save.','project_key_busy',{dispatched:false});
  const target=key==null?{key:null,scale:null}:{key,scale};
  if(target.key!==null&&(!PROJECT_KEYS.includes(target.key)||!['major','minor','chromatic'].includes(target.scale)))throw fail('Choose a key and major or minor.','project_key_invalid',{dispatched:false});
  const context=this.context();this.busy=true;let pending=null,sent=false;
  try{
   const before=await this.read(context);if(sameKey(before,target))return{changed:false,...before};
   const history=this.history();let token=null;try{token=history?.beginExternalStep?.({kind:'project_key',label:'Project Key'})??null;}catch(error){throw Object.assign(error,{dispatched:false});}pending={history,token};
   sent=true;const after=await this.write(target,before,context);
   const step=(from,to)=>async()=>{const now=this.context();if(now.projectId!==context.projectId)throw refused('Reopen the project to use its key history.');return this.write(to,from,now);};
   const label=`Project Key ${keyName(after.key,after.scale)}`;let journaled=false;
   if(history)journaled=token?history.finishExternalStep(token,{label,detail:{before,after},undo:step(after,before),redo:step(before,after)})===true:history.recordExternalStep?.({kind:'project_key',label,detail:{before,after},undo:step(after,before),redo:step(before,after)})===true;
   pending=null;this.log('project-key',{before,after,journaled});
   return{changed:true,...after,before,journaled,label};
  }catch(error){
   if(pending?.token)try{pending.history.failExternalStep(pending.token,error);}catch{}
   if(!sent&&error.dispatched===undefined)error.dispatched=false;
   const status=error?.status;if(sent&&error.historyNotApplied!==true&&!(Number.isInteger(status)&&status>=400&&status<500&&status!==408))error.operationUncertain=true;
   throw error;
  }finally{this.busy=false;}
 }
 /** Detect the key (of a take when `trackId` is given, else the backing). Reads only; never sets the key. */
 async analyze({trackId=null,onProgress=()=>{}}={}){
  if(this.analysis)throw fail('Key analysis is already running.','key_analysis_busy',{dispatched:false});
  const context=this.context(),client=this.api();const run=(async()=>{
   let result;try{result=await client.call('startKeyAnalysis',{path:{project_id:context.projectId},body:trackId?{track_id:trackId}:{}});}
   catch(error){if(error?.status===410)throw fail('This project has no backing track with a stored key. Select an audio region and analyze it instead.','key_analysis_unavailable',{status:410});throw error;}
   this.assertContext(context);let job=result?.data;const started=this.now();
   while(record(job)&&['pending','running'].includes(job.status)){
    try{onProgress(job);}catch{}
    if(!id(job.jobId))throw fail('Freestyle started the analysis without a job id.','key_analysis_receipt');
    if(this.now()-started>KEY_ANALYSIS_POLL_LIMIT_MS)throw fail('Key analysis is taking too long. Try again later.','key_analysis_timeout');
    await this.sleep(Math.min(5,Math.max(1,Number(job.retryAfterSec)||2))*1000);this.assertContext(context);
    job=(await client.call('getKeyAnalysis',{path:{project_id:context.projectId,job_id:job.jobId}}))?.data;this.assertContext(context);
   }
   if(!record(job)||job.projectId!=null&&job.projectId!==context.projectId)throw fail('Freestyle returned an unreadable key analysis.','key_analysis_receipt');
   if(job.status==='failed')throw fail(`Key analysis failed: ${job.error?.message||'Freestyle could not detect a key.'}`,job.error?.code||'key_analysis_failed');
   if(job.status!=='succeeded')throw fail('Freestyle reported the key analysis as '+job.status+'.','key_analysis_receipt');
   const analysis=job.analysis||{},writable=writableKey(analysis.key,analysis.scale);
   this.log('key-analysis',{jobId:job.jobId??null,key:analysis.key??null,scale:analysis.scale??null,confidence:analysis.confidence??null});
   return{key:analysis.key??null,scale:analysis.scale??null,confidence:Number.isFinite(analysis.confidence)?analysis.confidence:null,detector:analysis.detector??null,writable,jobId:job.jobId??null};
  })();
  this.analysis=run;try{return await run;}finally{this.analysis=null;}
 }
}

/** Logic-style key popup: 12 keys + major / minor (+ No Key). */
export function keyPopupHtml({key=null,scale=null}={}){
 const keys=PROJECT_KEYS.map(item=>`<button type="button" class="logic-key-choice${item===key?' on':''}" data-key="${esc(item)}" aria-pressed="${item===key}">${esc(keyLabel(item))}</button>`).join('');
 const mode=scale==='minor'?'minor':'major';
 const scales=PROJECT_SCALES.map(item=>`<button type="button" class="logic-scale-choice${item===mode?' on':''}" data-scale="${item}" aria-pressed="${item===mode}">${item==='major'?'Major':'Minor'}</button>`).join('');
 return `<div class="logic-key-popup" role="dialog" aria-label="Project key"><div class="logic-key-grid">${keys}</div><div class="logic-scale-row">${scales}</div><button type="button" class="logic-key-none" data-key-none>No Key</button></div>`;
}
/** Result text of an analysis for the dialog. */
export function keyAnalysisText(result){
 if(!result?.key)return'Freestyle did not detect a key.';
 const confidence=result.confidence==null?'':` (confidence ${Math.round(result.confidence*(result.confidence<=1?100:1))}%)`;
 return `Detected key: ${keyName(result.key,result.scale)}${confidence}`;
}
