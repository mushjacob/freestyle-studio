/** Freestyle's native region renderer. No browser DSP or replayed mutations. */
import {assertCompleteCanonicalData,cloudOperationError} from './cloud-session.js';
import {unwrapClipEditResult,validateClipBatchOps,validateClipEditReceipt} from './cloud-range-edits.js';
import {audioEditCheckpoint} from './audio-slice.js';

const clone=value=>value==null?value:structuredClone(value);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=64;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const projectId=project=>project?.cloud?.projectId||project?.id;
const fail=(message,code='region_effect_invalid_result')=>Object.assign(new Error(message),{code});

function unpack(raw){
 let data=raw?.structuredContent;
 if(data===undefined&&Array.isArray(raw?.content)){
  try{data=JSON.parse(raw.content.filter(part=>part.type==='text').map(part=>part.text).join('\n'));}
  catch{throw fail('Freestyle returned an unreadable region-effect response.');}
 }
 data=data??raw;
 for(let depth=0;depth<5;depth++){
  if(!object(data))throw fail('Freestyle returned no region-effect response.');
  if(raw?.isError||data.isError||data.ok===false||data.error){
   throw cloudOperationError({structuredContent:data,...raw?.isError?{isError:true}:{}},{fallback:'Freestyle rejected the region effect.'});
  }
  if(object(data.response)){data=data.response;continue;}
  return clone(data);
 }
 throw fail('Freestyle returned an unsupported region-effect envelope.');
}
const sourceRevision=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value);
// 338: specific live-engine 503s. Nothing was applied; Freestyle asks for a retry after Retry-After.
export const ENGINE_SESSION_RETRY_CODES=new Set(['engine_session_contended','engine_session_not_found','engine_restarting']);
const ENGINE_SESSION_MESSAGES={engine_session_contended:'Another project of this account is using your live Freestyle engine right now.',engine_session_not_found:'Freestyle has no live engine session for this project right now.',engine_restarting:'Your live Freestyle engine is restarting.'};
/** A specific engine-session 503: the request was refused before anything was
 * applied. The proxy already resends keyed/idempotent requests within its
 * bounded Retry-After budget, so reaching here means that budget ran out:
 * report it plainly and never resend a write from here. */
/** 339: engine_swap_failed with rolled_back:true — the live engine could not load the
 * processed version, so NOTHING was committed (same audio, same revision). A
 * definite "not applied", never an uncertain result. */
export function swapRefusal(error){
 if(error?.code!=='engine_swap_failed')return null;
 const layers=[error,error.details,error.result,error.data,error.data?.error,error.result?.error,error.result?.details];
 if(!layers.some(layer=>layer?.rolled_back===true||layer?.rolledBack===true))return null;
 return Object.assign(error,{message:'Not applied: Freestyle’s live engine could not load the processed audio, so nothing was saved. The clip keeps its audio; try again.',explicitRejection:true,operationUncertain:false,dispatched:false,rolledBack:true,swapRefused:true});
}
export function engineSessionRefusal(error){
 const status=error?.status??error?.statusCode;if(status!==503||!ENGINE_SESSION_RETRY_CODES.has(error?.code)&&error?.code!=='render_busy')return null;
 const seconds=Number.isFinite(Number(error.retryAfterSec))?Number(error.retryAfterSec):Number.isFinite(Number(error.retryAfterMs))?Number(error.retryAfterMs)/1000:Number.isFinite(Number(error.retryAfter))?Number(error.retryAfter):null;
 const when=seconds>0?` in ${Math.ceil(seconds)} s`:' in a moment';
 // 2026-11-11: in-place renders run one at a time (503 render_busy + Retry-After).
 if(error.code==='render_busy')return Object.assign(error,{message:`Another render is running; try again${when}. Nothing was changed.`,explicitRejection:true,operationUncertain:false,dispatched:false,renderBusy:true});
 return Object.assign(error,{message:`${ENGINE_SESSION_MESSAGES[error.code]} Nothing was changed; try again${seconds>0?` in about ${Math.ceil(seconds)} s`:' in a moment'}.`,explicitRejection:true,operationUncertain:false,dispatched:false,engineSessionRefused:true});
}
/** Client-side render serialisation: Freestyle renders one region effect at a
 * time, so while any controller's apply/redo is in flight or its job is still
 * pending, no other controller sends a render (the dialog disables Apply). */
const RENDERERS=new Set();
// A pending job of a project that is no longer open does not block forever.
export function regionEffectRenderPending(except=null){for(const controller of RENDERERS)if(controller!==except&&!controller.destroyed&&controller.rendering&&(controller.renderSending||controller.current()))return true;return false;}
const renderQueued=()=>Object.assign(new Error('Another region effect is still rendering in Freestyle. Wait for it to finish, then apply this one.'),{code:'render_busy',localRenderGate:true,explicitRejection:true,operationUncertain:false,dispatched:false,historyNotApplied:true});
function scoped(data,id){for(const key of ['projectId','project_id'])if(data[key]!=null&&data[key]!==id)throw fail('The region-effect response belongs to another project.','region_effect_scope_changed');return data;}
// QA round 22: an in-place apply/undo changes ONLY the clip row's updatedAt (verified
// live). Comparing the whole raw row made the checkpoint taken from the receipt stale
// as soon as the background read landed ("Audio changed before region-effect undo").
// Timestamps and derived links are not audio edits (as in the history fingerprint).
const VOLATILE_CLIP_FIELDS=new Set(['updatedAt','updated_at','editUrl']);
const stableRaw=raw=>raw&&typeof raw==='object'&&!Array.isArray(raw)?Object.fromEntries(Object.entries(raw).filter(([key])=>!VOLATILE_CLIP_FIELDS.has(key))):raw;
function audioCheckpoint(project){return JSON.stringify((project?.audioClips||[]).map(clip=>({id:clip.id,cloudId:clip.cloudId,laneId:clip.laneId,start:clip.start,length:clip.length,offset:clip.offset,raw:stableRaw(clip.cloudRaw)})).sort((a,b)=>String(a.id).localeCompare(String(b.id))));}

export function parseRegionEffectCatalog(raw){
 const result=unpack(raw);assertCompleteCanonicalData(result,'region-effect catalog');
 if(!Array.isArray(result.effects)||!result.effects.length)throw fail('Freestyle returned no region effects.');
 const ids=new Set();
 for(const effect of result.effects){
  if(!identity(effect?.id)||ids.has(effect.id)||typeof effect.label!=='string'||!object(effect.params))throw fail('Freestyle returned an invalid region-effect catalog.');ids.add(effect.id);
  for(const schema of Object.values(effect.params)){
   if(!object(schema)||!['number','integer','boolean','string'].includes(schema.type))throw fail('This effect has an unsupported parameter type.');
   if(schema.enum!==undefined&&(!Array.isArray(schema.enum)||!schema.enum.length))throw fail('This effect has an invalid parameter choice list.');
  }
 }
 return result;
}

export function regionEffectParams(effect,params={}){
 if(!object(params))throw new TypeError('Effect parameters must be an object.');const result={};
 for(const [key,value]of Object.entries(params)){
  const schema=effect?.params?.[key];if(!schema)throw new Error(`Unknown effect parameter ${key}.`);
  if(['number','integer'].includes(schema.type)){
   if(!finite(value)||schema.type==='integer'&&!Number.isInteger(value)||finite(schema.minimum)&&value<schema.minimum||finite(schema.maximum)&&value>schema.maximum)throw new RangeError(`Choose a valid ${key}${schema.unit?` (${schema.unit})`:''}.`);
  }else if(typeof value!==schema.type)throw new TypeError(`Choose a valid ${key}.`);
  if(schema.enum&&!schema.enum.includes(value))throw new RangeError(`Choose a supported ${key}.`);result[key]=value;
 }
 // Omitted parameters use the engine defaults. In particular, fade duration's
 // published default 0 means "whole selection" although explicit values >=1.
 return result;
}

export function regionEffectRequest(project,clipId,options,catalog){
 const id=projectId(project),trackId=project?.cloud?.trackId;
 if(!identity(id)||trackId!=null&&!identity(trackId))throw new Error('Open a Freestyle cloud project before applying an effect.');
 const clips=(project.audioClips||[]).filter(clip=>clip.cloudId===clipId),clip=clips[0];
 if(clips.length!==1||!identity(clipId)||clip.cloudRaw?.id!==clipId)throw new Error('Choose one current persisted audio clip.');
 assertCompleteCanonicalData(clip.cloudRaw,'region-effect clip');
 const raw=clip.cloudRaw,start=raw.startMs,duration=raw.durationSec;
 if(!finite(start)||start<0||!finite(duration)||duration<=0)throw new Error('Reload this clip’s exact saved timing before applying an effect.');
 const effect=catalog?.effects?.find(item=>item.id===options.effect);if(!effect)throw new Error('Choose an effect from Freestyle’s current catalog.');
 const first=options.startMs??start,last=options.endMs??start+duration*1000;
 if(!finite(first)||!finite(last)||first<0||last<=first)throw new RangeError('Choose a non-empty region in timeline milliseconds.');
 const startMs=Math.max(start,first),endMs=Math.min(start+duration*1000,last);
 if(endMs<=startMs||endMs-startMs>120000)throw new RangeError('Choose a region inside the clip, at most 120 seconds long.');
 const crossfade=options.crossfadeMs??0;if(!finite(crossfade)||crossfade<0||crossfade>100)throw new RangeError('Edge crossfade must be 0–100 ms.');
 const mode=options.mode??'in_place';if(!['in_place','split'].includes(mode))throw new RangeError('Choose in-place or split rendering.');
 return{project_id:id,...trackId?{track_id:trackId}:{},clip_id:clipId,effect:effect.id,params:regionEffectParams(effect,options.params),start_ms:startMs,end_ms:endMs,crossfade_ms:crossfade,mode};
}

export function regionEffectPreviewUrl(result){
 const value=result?.preview?.clip?.playbackUrl??result?.preview?.playbackUrl??result?.playbackUrl;
 if(typeof value!=='string')throw fail('Freestyle did not return a region preview URL.');
 let url;try{url=new URL(value);}catch{throw fail('Freestyle returned an invalid region preview URL.');}
 if(url.protocol!=='https:'||url.username||url.password)throw fail('Freestyle returned an unsafe region preview URL.');return value;
}

/** Owns one apply, its background job and its exact server-authored inverse.
 * 338 (FL-like): the effect renders IN PLACE by default — the same clip gets a
 * new source version (same id, start, duration and offset) and its undo is
 * sample-edits:undo against that revision. A clip Freestyle cannot render in
 * place (over 240 s, tempo-stretched) falls back to the split render, whose
 * undo is its server-authored inverse_ops. With `history` (the app's ordered
 * journal) each apply is ONE step of the global Undo/Redo. */
export class CloudRegionEffects{
 constructor({getProject,cloudCall,getScope=()=>null,getEditRevision=()=>0,flush=async()=>{},refresh=async()=>{},guard=()=>{},onChange=()=>{},history=null,label=null,sourceView=null,log=()=>{},createIdempotencyKey=()=>globalThis.crypto.randomUUID()}={}){
  if(typeof getProject!=='function'||typeof cloudCall!=='function')throw new TypeError('Region effects need getProject and cloudCall callbacks.');
  // sourceView (QA round 21 speed): {remember(clipId), show(clipId,revision)→bool, invalidate(clipId), settle(), confirmRead()}.
  // Lets an in-place Undo repaint the cached older source revision at once and
  // confirm from the undo reply instead of re-reading the whole project.
  Object.assign(this,{getProject,cloudCall,getScope,getEditRevision,flush,refresh,guard,onChange,createIdempotencyKey,label,log});this.sourceView=sourceView&&typeof sourceView.show==='function'?sourceView:null;this.history=history&&typeof history.beginExternalStep==='function'?history:null;this.historyToken=null;this.journaled=false;this.catalog=null;this.inFlight=false;this.destroyed=false;this.uncertain=false;this.appliedCheckpoint=null;this.renderSending=false;RENDERERS.add(this);
  this.state={status:'idle',scope:null,request:null,preview:null,receipt:null,undoReceipt:null,inverseOps:[],inPlace:null,mode:null,jobId:null,error:null,refreshError:null,applied:false,detached:false};
 }
 capture(){const p=this.getProject();if(!identity(projectId(p)))throw new Error('Open a Freestyle cloud project first.');return{projectId:projectId(p),trackId:p?.cloud?.trackId??null,epoch:clone(this.getScope())};}
 current(scope=this.state.scope){try{return !this.destroyed&&!!scope&&same(scope,this.capture());}catch{return false;}}
 get busy(){return !!this.preparing||this.inFlight||!!this.state.jobId&&this.state.status==='pending';}
 /** A render of this controller is being sent or its job is still pending. */
 get rendering(){return this.renderSending||!!this.state.jobId&&this.state.status==='pending';}
 snapshot(){return clone({...this.state,busy:this.busy,uncertain:this.uncertain,journaled:this.journaled,canUndo:!this.busy&&!this.uncertain&&this.state.status==='applied'&&this.state.applied&&this.current()&&(this.state.inPlace?sourceRevision(this.state.inPlace.revision):this.state.inverseOps.length>0)&&this.appliedCheckpoint===audioCheckpoint(this.getProject())&&this.appliedRevision===this.getEditRevision()});}
 notify(){this.onChange(this.snapshot());}
 assertCurrent(scope){if(!this.current(scope))throw Object.assign(new Error('The cloud project changed. Reopen the region effect.'),{name:'AbortError',code:'region_effect_scope_changed'});}
 async loadCatalog(){if(this.catalog)return clone(this.catalog);const scope=this.capture();const result=await this.cloudCall('list_region_effects',{});this.assertCurrent(scope);this.catalog=parseRegionEffectCatalog(result);return clone(this.catalog);}
 async preview(clipId,options){if(this.busy)throw new Error('Wait for the current region effect.');this.preparing=true;try{return await this.previewPrepared(clipId,options);}finally{this.preparing=false;this.notify();}}
 async previewPrepared(clipId,options){
  this.guard();const scope=this.capture();await this.loadCatalog();this.assertCurrent(scope);const checkpoint=audioCheckpoint(this.getProject()),revision=this.getEditRevision(),request=regionEffectRequest(this.getProject(),clipId,options,this.catalog),context=options.contextMs??0;
  if(!finite(context)||context<0||context>2000)throw new RangeError('Preview context must be 0–2000 ms.');this.inFlight=true;this.state={...this.state,status:'previewing',error:null};this.notify();
  const {mode,...previewRequest}=request;void mode;
  try{const payload=scoped(unpack(await this.cloudCall('preview_region_effect',{...previewRequest,context_ms:context})),scope.projectId);this.assertCurrent(scope);if(checkpoint!==audioCheckpoint(this.getProject())||revision!==this.getEditRevision())throw fail('The audio changed while its preview was rendering. Preview the current region again.');if(payload.applied!==false)throw fail('Freestyle did not identify this render as an unchanged preview.');regionEffectPreviewUrl(payload);this.state.preview=payload;this.state.status='previewed';return clone(payload);}
  catch(error){engineSessionRefusal(error);this.state.error=error.message;this.state.status='failed';throw error;}finally{this.inFlight=false;this.notify();}
 }
 async apply(clipId,options){
  if(this.busy||this.state.applied||['undone','conflict'].includes(this.state.status)||this.uncertain)throw new Error('This region effect already has an apply receipt or an unresolved result. It will not be repeated.');
  // Checked and claimed synchronously: two Apply clicks can never both send.
  if(regionEffectRenderPending(this))throw renderQueued();
  this.preparing=true;this.renderSending=true;try{await this.applyPrepared(clipId,options);}finally{this.preparing=false;this.renderSending=false;this.notify();}return this.snapshot();
 }
 async applyPrepared(clipId,options){
  this.guard();const scope=this.capture();await this.loadCatalog();this.assertCurrent(scope);const request=regionEffectRequest(this.getProject(),clipId,options,this.catalog),checkpoint=audioCheckpoint(this.getProject());
  const key=this.createIdempotencyKey();if(typeof key!=='string'||!key.length||key.length>128)throw new Error('The region effect needs a valid retained idempotency key.');
  if(options.allowClipping!==undefined&&typeof options.allowClipping!=='boolean')throw new TypeError('Allow clipping must be a boolean.');
  const effect=this.catalog.effects.find(item=>item.id===request.effect);this.label=`Effect: ${effect?.label||request.effect}`;
  this.state={...this.state,status:'applying',scope,request:{...request,idempotency_key:key,wait_sec:20,allow_clipping:options.allowClipping===true},error:null,preview:this.state.preview};this.appliedRevision=this.getEditRevision();this.inFlight=true;this.notify();let sent=false;
  try{
   await this.flush();this.assertCurrent(scope);if(checkpoint!==audioCheckpoint(this.getProject()))throw new Error('The audio changed before rendering. Reopen its region effect.');
   // One ordered history step, opened before the first write so the refresh it causes belongs to it.
   if(this.history&&!this.historyToken)this.historyToken=this.history.beginExternalStep({kind:'region_effect',label:this.label});
   // 339: in place really swaps the live source (engine_swapped:true); a clip it cannot
   // render in place is refused with a reason, never silently split instead.
   // Keep the waveform of the source version this apply replaces, so its Undo can show it at once.
   try{this.sourceView?.remember?.(request.clip_id);}catch{}
   sent=true;const payload=scoped(unpack(await this.cloudCall('apply_effect_to_region',clone(this.state.request))),scope.projectId);
   await this.accept(payload,scope);return this.snapshot();
  }
  catch(error){this.reject(error,sent);throw error;}finally{this.inFlight=false;this.state.detached=!this.current(scope);this.notify();}
 }
 async accept(payload,scope){
  const result=object(payload.result)?payload.result:object(payload.job?.result)?payload.job.result:payload;
  scoped(result,scope.projectId);
  if(result.mode==='in_place'&&sourceRevision(result.revision)&&result.status!=='failed'&&payload.status!=='failed'){
   assertCompleteCanonicalData(result,'region-effect receipt');
   if(result.clip_id!==undefined&&result.clip_id!==this.state.request?.clip_id||result.previous_revision!==undefined&&!sourceRevision(result.previous_revision)||result.undo?.expected_revision!==undefined&&result.undo.expected_revision!==result.revision)throw fail('Freestyle returned an in-place effect receipt for another clip or revision. Inspect the project before another apply.');
   this.state.receipt=clone(result);this.state.mode='in_place';this.state.inverseOps=[];this.state.inPlace={clipId:this.state.request.clip_id,revision:result.revision,previousRevision:result.previous_revision??null};this.state.applied=true;this.state.jobId=null;this.state.status='applied';
   // Round 21 speed (Redo and Apply): the in-place receipt names the new source revision and
   // the clip's unchanged geometry; when that geometry is what the project shows, confirm from
   // the receipt (new waveform read only) and refresh the timeline revision off the critical path.
   if(this.current(scope)&&this.sourceView&&this.receiptGeometryCurrent(result)&&this.appliedRevision===this.getEditRevision()){
    try{this.sourceView.show(this.state.inPlace.clipId,result.revision);this.sourceView.settle?.();}catch{}
    this.appliedCheckpoint=audioCheckpoint(this.getProject());this.appliedEditCheckpoint=audioEditCheckpoint(this.getProject());this.state.refreshError=null;
    this.log('region-apply-confirmed-from-receipt',{clipId:this.state.inPlace.clipId,revision:result.revision});
    try{Promise.resolve(this.sourceView.confirmRead?.()).catch(()=>{});}catch{}
    this.finishHistory();return;
   }
   if(this.sourceView)this.log('history-receipt-confirm-declined',{kind:'region_effect',stage:'in_place_apply'});
   if(this.current(scope))await this.refreshAccepted();this.finishHistory();return;
  }
  if(result.undo?.inverse_ops!==undefined){
   validateClipEditReceipt(result,scope.projectId,{range:true});assertCompleteCanonicalData(result,'region-effect receipt');
   this.state.receipt=clone(result);this.state.mode='split';this.state.inPlace=null;this.state.inverseOps=validateClipBatchOps(result.undo.inverse_ops,{serverAuthoredInverse:true});this.state.applied=true;this.state.jobId=null;this.state.status='applied';
   if(this.current(scope))await this.refreshAccepted();this.finishHistory();return;
  }
  const status=payload.status??payload.job?.status,jobId=payload.job_id??payload.job?.id;
  if(['failed','error','cancelled'].includes(status)){const failure=Object.assign(fail(payload.message||payload.error||payload.job?.error||'The region renderer did not complete.',payload.code),{explicitRejection:true,jobTerminalFailure:true,status:payload.http_status,rolled_back:payload.rolled_back??payload.job?.rolled_back});engineSessionRefusal(failure);swapRefusal(failure);throw failure;}
  if(identity(jobId)){this.state.jobId=jobId;this.state.status='pending';return;}
  throw fail('Freestyle returned no complete region-effect receipt or background job. Inspect the project before another apply.');
 }
 // ---- global ordered history (app.js journal) ----
 finishHistory(){
  const token=this.historyToken;if(!token)return;this.historyToken=null;
  const step={detail:{clipId:this.state.request?.clip_id,effect:this.state.request?.effect,mode:this.state.mode},undo:()=>this.historyUndo(),redo:()=>this.historyRedo()};
  try{this.journaled=this.history.finishExternalStep(token,step)===true;}catch{this.journaled=false;}this.notify();
 }
 failHistory(error){const token=this.historyToken;if(!token)return;this.historyToken=null;try{this.history.failExternalStep(token,error);}catch{}}
 /** Journal Undo: the server-authored inverse of the CURRENT apply (sample-edits:undo / inverse_ops). */
 async historyUndo(){
  if(this.inFlight)throw Object.assign(new Error('Wait for the current region-effect request.'),{dispatched:false});
  if(!this.state.applied||this.uncertain||!this.current(this.state.scope))throw Object.assign(new Error('This region effect is no longer the applied state. Its Undo was not sent.'),{dispatched:false});
  return this.undoNow({fromHistory:true});
 }
 /** Journal Redo: render the same effect again (a NEW idempotency key, as Freestyle requires after an undo). */
 async historyRedo(){
  if(this.inFlight)throw Object.assign(new Error('Wait for the current region-effect request.'),{dispatched:false});
  if(this.state.applied||this.state.status!=='undone'||this.uncertain||!this.current(this.state.scope))throw Object.assign(new Error('This region effect cannot be redone from the current audio.'),{dispatched:false});
  if(regionEffectRenderPending(this))throw renderQueued();
  const scope=clone(this.state.scope),key=this.createIdempotencyKey();this.state={...this.state,status:'applying',request:{...this.state.request,idempotency_key:key},error:null};this.appliedRevision=this.getEditRevision();this.inFlight=true;this.renderSending=true;this.notify();let sent=false;
  try{await this.flush();this.assertCurrent(scope);sent=true;const payload=scoped(unpack(await this.cloudCall('apply_effect_to_region',clone(this.state.request))),scope.projectId);await this.accept(payload,scope);if(this.state.status!=='applied')throw Object.assign(new Error('Freestyle is still rendering the redone effect. Inspect it before using older history.'),{operationUncertain:true});return clone(this.state.receipt);}
  catch(error){this.reject(error,sent);if(!sent)error.dispatched=false;throw error;}finally{this.inFlight=false;this.renderSending=false;this.notify();}
 }
 reject(error,sent){
  engineSessionRefusal(error);swapRefusal(error);this.failHistory(error);
  const status=error.status??error.statusCode,known=error.operationUncertain!==true&&(error.explicitRejection===true||[400,401,403,404,409,412,413,422,429].includes(status));
  this.uncertain=!!(sent&&!known);this.state.status=this.uncertain?'uncertain':[409,412].includes(status)?'conflict':'failed';this.state.error=error.message;this.state.detached=this.state.scope&&!this.current();
  // A definite refusal committed nothing: tell the global history so the step stays usable.
  if(known)Object.assign(error,{dispatched:false,historyNotApplied:true});
  return known;
 }
 async poll(){
  if(this.inFlight)throw new Error('A region-effect request is already in progress.');if(!this.state.jobId||this.uncertain)throw new Error('There is no known region-render job to inspect.');
  const scope=clone(this.state.scope);this.guard();this.assertCurrent(scope);this.inFlight=true;this.notify();
  try{const payload=scoped(unpack(await this.cloudCall('get_region_effect_job',{project_id:scope.projectId,...scope.trackId?{track_id:scope.trackId}:{},job_id:this.state.jobId,wait_sec:0})),scope.projectId);await this.accept(payload,scope);this.state.error=null;}
  catch(error){engineSessionRefusal(error);this.state.error=error.message;if(error.jobTerminalFailure){this.state.status='failed';this.state.jobId=null;this.failHistory(error);}throw error;}finally{this.inFlight=false;this.notify();}return this.snapshot();
 }
 /** The in-place receipt's clips_after is exactly the one clip, at the start, duration and offset the saved project shows. */
 receiptGeometryCurrent(result){
  const after=Array.isArray(result?.clips_after)?result.clips_after:null,clipId=this.state.inPlace?.clipId;if(!after||after.length!==1||after[0]?.id!==clipId)return false;
  const matches=(this.getProject()?.audioClips||[]).filter(clip=>(clip.cloudId??clip.id)===clipId),raw=matches[0]?.cloudRaw;if(matches.length!==1||!raw)return false;
  const offset=raw.audioOffsetSec??0,close=(a,b)=>typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=1e-6;
  return close(after[0].start_ms,raw.startMs)&&close(after[0].duration_sec,raw.durationSec)&&close(after[0].audio_offset_sec??0,offset)&&(after[0].lane_id===undefined||after[0].lane_id===raw.laneId);
 }
 async refreshAccepted(){
  try{await this.refresh();this.assertCurrent(this.state.scope);if(this.appliedRevision!==this.getEditRevision())throw new Error('Newer edits changed the region-effect checkpoint.');this.appliedCheckpoint=audioCheckpoint(this.getProject());this.appliedEditCheckpoint=audioEditCheckpoint(this.getProject());this.state.refreshError=null;}
  catch(error){this.state.refreshError=error.message;}
 }
 async inspect(){if(this.inFlight)throw new Error('Wait for the current region-effect request.');this.guard();this.assertCurrent(this.state.scope);this.inFlight=true;this.notify();try{await this.refreshAccepted();}finally{this.inFlight=false;this.notify();}return this.snapshot();}
 async undo(){
  this.guard();if(this.journaled)throw new Error('This region effect is in the project history: use Edit → Undo.');
  return this.undoNow();
 }
 async undoNow({fromHistory=false}={}){
  // The ordered journal undoes every later step first, so its Undo checks what
  // this effect's inverse depends on: the source revision (in place, also
  // guarded by Freestyle's expected_revision) or the stored clip geometry (split).
  const eligible=fromHistory?this.state.applied&&!this.uncertain&&!this.busy&&this.current()&&(this.state.inPlace?sourceRevision(this.state.inPlace.revision):this.state.inverseOps.length>0&&this.appliedEditCheckpoint===audioEditCheckpoint(this.getProject())):this.snapshot().canUndo;
  if(!eligible)throw Object.assign(new Error('Reload the unchanged audio state before undoing this effect.'),{dispatched:false});const scope=clone(this.state.scope);this.inFlight=true;this.state.status='undoing';this.notify();let sent=false,replyConfirmed=false;
  try{
   await this.flush();this.assertCurrent(scope);if(this.appliedCheckpoint!==audioCheckpoint(this.getProject()))throw new Error('Audio changed before region-effect undo.');
   if(this.state.inPlace){
    // In place: restore the clip's previous source version, guarded by the revision this apply wrote.
    const {clipId,revision,previousRevision}=this.state.inPlace,key=this.createIdempotencyKey(),started=Date.now();
    // QA round 21 speed: paint the cached older source revision now (optimistic);
    // the applied revision is remembered so a refusal can put it back.
    let shown=false;try{this.sourceView?.remember?.(clipId);shown=!!(previousRevision&&this.sourceView?.show(clipId,previousRevision));}catch{shown=false;}
    let payload;sent=true;
    // One guard only: If-Match = this apply's source revision. A body
    // expected_revision beside the bridge's inherited project ETag is a 400
    // ("If-Match and expected_revision disagree"), verified live on 339.
    try{payload=scoped(unpack(await this.cloudCall('undo_clip_sample_edit',{project_id:scope.projectId,...scope.trackId?{track_id:scope.trackId}:{},clip_id:clipId,idempotency_key:key},{ifMatch:JSON.stringify(revision),idempotencyKey:key})),scope.projectId);}
    catch(error){if(shown)try{if(!this.sourceView.show(clipId,revision))this.sourceView.settle?.();}catch{}throw error;}
    if(!sourceRevision(payload.revision)||payload.clip_id!==undefined&&payload.clip_id!==clipId||payload.undone_revision!==undefined&&payload.undone_revision!==revision||previousRevision&&payload.revision!==previousRevision){try{this.sourceView?.invalidate?.(clipId);this.sourceView?.settle?.();}catch{}throw Object.assign(fail('Freestyle undid a different sample revision. Inspect the clip before another edit.'),{operationUncertain:true});}
    this.state.undoReceipt=clone(payload);
    // Confirmed by the reply itself: undone_revision is exactly this apply's
    // revision and the restored revision is the one it replaced. Clip id,
    // start, duration and offset never change in place (verified live), so no
    // project re-read is needed before the step completes.
    if(this.sourceView&&payload.undone_revision===revision&&(!previousRevision||payload.revision===previousRevision)&&this.current(scope)){
     this.state.applied=false;this.state.status='undone';
     try{if(!shown||payload.revision!==previousRevision)this.sourceView.show(clipId,payload.revision);this.sourceView.settle?.();}catch{}
     if(this.appliedRevision===this.getEditRevision()){this.appliedCheckpoint=audioCheckpoint(this.getProject());this.appliedEditCheckpoint=audioEditCheckpoint(this.getProject());}this.state.refreshError=null;
     this.log('region-undo-confirmed-from-reply',{clipId,undone:payload.undone_revision,restored:payload.revision,optimistic:shown,ms:Date.now()-started});
     // The sample-edit reply carries no timeline revision, but the undo moves it
     // (verified live): refresh that one value off the critical path so the next
     // guarded timeline write carries a current If-Match.
     try{Promise.resolve(this.sourceView.confirmRead?.()).catch(()=>{});}catch{}
     replyConfirmed=true;
    }
    this.log('history-receipt-confirm-declined',{kind:'region_effect',stage:'sample_edit_undo',reason:this.sourceView?'reply_incomplete':'no_source_view'});
   }else{sent=true;const payload=unwrapClipEditResult(await this.cloudCall('apply_clip_batch',{project_id:scope.projectId,...scope.trackId?{track_id:scope.trackId}:{},ops:validateClipBatchOps(this.state.inverseOps,{serverAuthoredInverse:true})}));validateClipEditReceipt(payload,scope.projectId);this.state.undoReceipt=clone(payload);}
   this.state.applied=false;this.state.status='undone';if(!replyConfirmed&&this.current(scope))await this.refreshAccepted();
  }
  catch(error){if(fromHistory&&!sent){error.dispatched=false;this.state.status='applied';}else if(this.reject(error,sent)&&this.state.applied&&this.state.status==='failed')this.state.status='applied';throw error;}finally{this.inFlight=false;this.notify();}return this.snapshot();
 }
 destroy(){this.destroyed=true;RENDERERS.delete(this);}
}
