/** Aux sends (Freestyle release 2026-11-14). Typed REST only.
 *
 *  - setLaneSend    PUT    /projects/{p}/lanes/{l}/sends/{bus}  {level 0..2, pre_fader?}
 *  - deleteLaneSend DELETE /projects/{p}/lanes/{l}/sends/{bus}
 *  - listLaneSends  GET    /projects/{p}/lanes/{l}/sends        (saved view)
 *  - getEngineMix   tracks[].sends (live view) + mixRevision / ETag "mix-<n>"
 *  - createBus      POST   /projects/{p}/buses {bus_id, name}   (a Return track)
 *
 * Every send write is guarded by If-Match "mix-<n>" (412 mix_revision_conflict: nothing
 * changed) and its reply carries `undo` = the request that restores the previous state
 * ({method: DELETE, path} when there was no send, {method: PUT, path, body} otherwise).
 * No realtime (mozart-control) send message exists in the realtime docs or the Studio Pro
 * bundle, so sends never go over the data channel. Nothing here retries a write.
 */
import {StudioApiClient} from './studio-api-client.js';

export const SEND_LEVEL_MAX=2,SEND_LIMIT_PER_LANE=16;
const fail=(message,fields={})=>Object.assign(new Error(message),{dispatched:false,...fields});
const id=(value,name)=>{if(typeof value!=='string'||!value||value.length>128||/[\u0000-\u001f\u007f/\\?#%]/.test(value))throw fail(`${name} must be a durable resource id.`,{code:'invalid_'+name});return value;};
const revisionOf=value=>{if(Number.isSafeInteger(value)&&value>=0)return value;if(typeof value==='string'){const match=/^(?:W\/)?"?mix-(\d+)"?$/.exec(value.trim());if(match&&Number.isSafeInteger(Number(match[1])))return Number(match[1]);}return null;};
export const mixTag=revision=>{const value=revisionOf(revision);if(value===null)throw fail('Read the live mix revision before changing a send.',{code:'mix_revision_required'});return `"mix-${value}"`;};
export function validSendLevel(level){if(typeof level!=='number'||!Number.isFinite(level)||level<0||level>SEND_LEVEL_MAX)throw fail(`A send level is linear 0 to ${SEND_LEVEL_MAX}.`,{code:'invalid_send_level'});return Math.round(level*1e6)/1e6;}
/** {busId, level, preFader} from either the REST (camelCase) or the engine (snake_case) shape. */
export function normalizeSend(value){
 if(!value||typeof value!=='object')return null;const busId=value.busId??value.bus_id,level=value.level;
 if(typeof busId!=='string'||!busId||typeof level!=='number'||!Number.isFinite(level))return null;
 return{busId,level,preFader:(value.preFader??value.pre_fader)===true};
}
export const sameSend=(a,b)=>a===b||!!a&&!!b&&a.busId===b.busId&&Math.abs(a.level-b.level)<=1e-6&&a.preFader===b.preFader;
export const isMixRevisionConflict=error=>error?.status===412||(error?.data?.error?.code??error?.code)==='mix_revision_conflict';
const errorCode=error=>error?.data?.error?.code??error?.code??null;

/** Live sends per lane (getEngineMix tracks[].sends) and the revision guarding them. */
export function sendsFromMix(mix){
 const lanes=new Map();for(const track of Array.isArray(mix?.tracks)?mix.tracks:[]){const lane=track?.db_track_id;if(typeof lane!=='string'||!lane)continue;lanes.set(lane,(Array.isArray(track.sends)?track.sends:[]).map(normalizeSend).filter(Boolean));}
 return{revision:revisionOf(mix?.mixRevision??mix?.mix_revision),lanes};
}
export async function readMixSends({client=new StudioApiClient(),projectId,signal}={}){
 id(projectId,'project_id');const response=await client.call('getEngineMix',{path:{project_id:projectId}},signal?{signal}:{});
 const data=response.data||{};if(data.projectId!==undefined&&data.projectId!==projectId)throw fail('The live mix belongs to another project.',{code:'mix_project_mismatch'});
 const read=sendsFromMix(data);const tagged=revisionOf(response.etag);return{...read,revision:tagged??read.revision,mix:data};
}
export async function listLaneSends({client=new StudioApiClient(),projectId,laneId}={}){
 const response=await client.call('listLaneSends',{path:{project_id:id(projectId,'project_id'),lane_id:id(laneId,'lane_id')}});
 return(Array.isArray(response.data?.sends)?response.data.sends:[]).map(normalizeSend).filter(Boolean);
}
const receipt=(response,laneId,busId)=>{const data=response.data||{};return Object.freeze({laneId,busId,send:normalizeSend(data.send),previous:normalizeSend(data.previous),
 mixRevision:revisionOf(data.mixRevision)??revisionOf(response.etag),undo:data.undo&&typeof data.undo==='object'?structuredClone(data.undo):null,dbPersisted:data.dbPersisted!==false,response:data});};

export async function setLaneSend({client=new StudioApiClient(),projectId,laneId,busId,level,preFader,mixRevision,idempotencyKey}={}){
 id(projectId,'project_id');id(laneId,'lane_id');id(busId,'bus_id');if(busId==='master')throw fail('A send goes to a return bus, never to Main.',{code:'send_to_master'});
 if(laneId==='backing')throw fail('The beat has no lane to send from.',{code:'send_from_backing'});
 const body={level:validSendLevel(level),...typeof preFader==='boolean'?{pre_fader:preFader}:{}};
 const response=await client.call('setLaneSend',{path:{project_id:projectId,lane_id:laneId,bus_id:busId},body},{ifMatch:mixTag(mixRevision),...idempotencyKey?{idempotencyKey}:{}});
 return receipt(response,laneId,busId);
}
export async function deleteLaneSend({client=new StudioApiClient(),projectId,laneId,busId,mixRevision,idempotencyKey}={}){
 id(projectId,'project_id');id(laneId,'lane_id');id(busId,'bus_id');
 const response=await client.call('deleteLaneSend',{path:{project_id:projectId,lane_id:laneId,bus_id:busId}},{ifMatch:mixTag(mixRevision),...idempotencyKey?{idempotencyKey}:{}});
 return receipt(response,laneId,busId);
}
/** Send a reply's `undo` back exactly (PUT body or DELETE); its path must name this project's lane send. */
export function applySendUndo({client=new StudioApiClient(),projectId,undo,mixRevision,idempotencyKey}={}){
 const match=typeof undo?.path==='string'?/^\/projects\/([^/]+)\/lanes\/([^/]+)\/sends\/([^/]+)$/.exec(undo.path):null;
 if(!match||match[1]!==projectId)throw fail('This send reply has no undo for this project.',{code:'send_undo_missing'});
 const laneId=decodeURIComponent(match[2]),busId=decodeURIComponent(match[3]);
 if(undo.method==='DELETE')return deleteLaneSend({client,projectId,laneId,busId,mixRevision,idempotencyKey});
 if(undo.method==='PUT'&&undo.body&&typeof undo.body.level==='number')return setLaneSend({client,projectId,laneId,busId,level:undo.body.level,preFader:typeof undo.body.pre_fader==='boolean'?undo.body.pre_fader:undefined,mixRevision,idempotencyKey});
 throw fail('This send undo is not a send request.',{code:'send_undo_invalid'});
}
/** The forward request of a receipt (redo): PUT the written send, or DELETE when it removed one. */
export function sendRedoRequest(result){
 if(!result)return null;const path=`/projects/${result.projectId}/lanes/${result.laneId}/sends/${result.busId}`;
 return result.send?{method:'PUT',path,body:{level:result.send.level,pre_fader:result.send.preFader}}:{method:'DELETE',path};
}

/** Next free "bus-<n>" id and Live's "<Letter>-Return" name for Insert Return Track. */
export function nextReturnBus(buses=[]){
 const ids=new Set(buses.map(bus=>bus?.busId??bus?.bus_id??bus?.id).filter(Boolean));let n=1;while(ids.has(`bus-${n}`))n++;
 const returns=buses.filter(bus=>(bus?.busId??bus?.bus_id??bus?.id)!=='master').length;return{busId:`bus-${n}`,name:`${String.fromCharCode(65+returns%26)}-Return`};
}
export async function createReturnBus({client=new StudioApiClient(),projectId,buses=[],idempotencyKey}={}){
 id(projectId,'project_id');const next=nextReturnBus(buses);
 const response=await client.call('createBus',{path:{project_id:projectId},body:{bus_id:next.busId,name:next.name}},idempotencyKey?{idempotencyKey}:{});
 return Object.freeze({...next,response:response.data??null});
}
export async function deleteReturnBus({client=new StudioApiClient(),projectId,busId,idempotencyKey}={}){
 id(projectId,'project_id');id(busId,'bus_id');if(busId==='master')throw fail('Main cannot be deleted.',{code:'delete_master'});
 const response=await client.call('deleteBus',{path:{project_id:projectId,bus_id:busId}},idempotencyKey?{idempotencyKey}:{});return response.data??null;
}

/**
 * One send gesture = one guarded write and one Undo step.
 * options: client(), projectId(), mix() → {revision, lanes}|null (the app's live mix tracker),
 * recordStep(step) (global history), onChange(), toast(text), log(kind, data).
 * commit() refuses (never retries) a 412; Undo/Redo re-check that the send still holds the
 * value this step left, against a fresh mix read, before sending the reply's own inverse.
 */
export class SendController{
 constructor(options={}){this.options=options;this.own=new Map();this.cache=null;this.busy=null;}
 client(){const client=this.options.client?.();if(!client)throw fail('Open a Freestyle cloud project first.',{code:'studio_client_unavailable'});return client;}
 projectId(){return id(this.options.projectId?.(),'project_id');}
 key(laneId,busId){return `${laneId}\u0000${busId}`;}
 /** The send shown for lane → bus: our own unconfirmed/confirmed write, else the last mix read. */
 current(laneId,busId){const key=this.key(laneId,busId);if(this.own.has(key))return this.own.get(key);
  const sources=[this.options.mix?.(),this.cache];for(const source of sources){const lane=source?.lanes?.get?.(laneId);if(lane)return lane.find(send=>send.busId===busId)||null;}return null;}
 known(){return !!(this.options.mix?.()?.lanes?.size||this.cache?.lanes?.size);}
 async refresh(){const projectId=this.projectId(),read=await readMixSends({client:this.client(),projectId});if(projectId!==this.options.projectId?.())return null;this.cache={...read,projectId};this.own.clear();this.options.onChange?.();return read;}
 revision(){const live=this.options.mix?.();const values=[live?.revision,this.cache?.revision].filter(value=>Number.isSafeInteger(value));return values.length?Math.max(...values):null;}
 async freshRevision(){const read=await this.refresh();return read?.revision??null;}
 async write(laneId,busId,send,{mixRevision}){
  const client=this.client(),projectId=this.projectId();
  const result=send?await setLaneSend({client,projectId,laneId,busId,level:send.level,preFader:send.preFader,mixRevision}):await deleteLaneSend({client,projectId,laneId,busId,mixRevision});
  if(this.cache&&Number.isSafeInteger(result.mixRevision))this.cache.revision=Math.max(this.cache.revision??0,result.mixRevision);
  this.own.set(this.key(laneId,busId),result.send);this.options.onChange?.();return{...result,projectId};
 }
 /** Commit a gesture. level null/0 with reset=true deletes the send (Live's -inf default). */
 async commit({laneId,busId,level,reset=false,label}={}){
  if(this.busy)throw fail('Wait for the current send change to save.',{code:'send_busy'});
  const projectId=this.projectId(),before=this.current(laneId,busId);
  const target=reset||level===0&&!before?null:{busId,level:validSendLevel(level),preFader:before?.preFader??false};
  if(sameSend(before,target))return{changed:false};
  let revision=this.revision();this.busy=(async()=>{
   if(revision===null)revision=await this.freshRevision();
   let result;try{result=await this.write(laneId,busId,target,{mixRevision:revision});}
   catch(error){this.own.delete(this.key(laneId,busId));this.options.onChange?.();
    if(isMixRevisionConflict(error)){this.options.log?.('abl-send-conflict',{laneId,busId,code:errorCode(error)});try{await this.refresh();}catch{}throw Object.assign(fail('The mix changed in another window; the send was not changed. Try again.',{code:'mix_revision_conflict'}),{cause:error});}
    throw error;}
   const undo=result.undo,redo=sendRedoRequest(result),after=result.send,previous=result.previous;
   const step=direction=>async()=>{const read=await this.refresh(),now=read?.lanes?.get(laneId)?.find(send=>send.busId===busId)||null,expected=direction==='undo'?after:previous;
    if(!sameSend(now,expected))throw Object.assign(fail('This send changed since; Undo would overwrite it.',{code:'send_history_conflict'}),{historyNotApplied:true});
    const request=direction==='undo'?undo:redo;const applied=await applySendUndo({client:this.client(),projectId,undo:request,mixRevision:read.revision});
    this.own.set(this.key(laneId,busId),applied.send);this.options.onChange?.();return{status:'confirmed'};};
   if(undo)this.options.recordStep?.({kind:'mixer_send',label:label||`Send ${busId}`,undo:step('undo'),redo:step('redo'),detail:{laneId,busId,before:previous,after}});
   this.options.log?.('abl-send-saved',{laneId,busId,level:after?.level??null,removed:!after,mixRevision:result.mixRevision});
   return{changed:true,result};})();
  try{return await this.busy;}finally{this.busy=null;}
 }
}
