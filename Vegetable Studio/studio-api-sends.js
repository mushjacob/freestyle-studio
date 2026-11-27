/** Studio API aux sends: setLaneSend / deleteLaneSend through the generated client only (never fetch).
 * Every write carries the live mix revision when it is known (If-Match "mix-<n>", or expected_mix_revision when
 * the operation takes it), is idempotent, and is refused before dispatch when the project or engine context
 * changed. One write at a time. A bus that still has live sends cannot be deleted (409): busDeleteConflictMessage.
 */
import {StudioApiClient,STUDIO_API_OPERATIONS} from './studio-api-client.js';
import {isMixRevisionConflict,mixEtag,mixRevisionOf} from './mix-revision.js';
import {SEND_MAX_LEVEL,roundLevel,sendFromCard} from './mixer-sends.js';

const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const failure=(message,code='studio_sends_invalid_result',extra={})=>Object.assign(new Error(message),{code},extra);
const OPERATIONS=['setLaneSend','deleteLaneSend'];
const accepts=(operationId,field)=>!!STUDIO_API_OPERATIONS[operationId]?.requestBody?.content?.['application/json']?.schema?.properties?.[field];
const takesIfMatch=operationId=>(STUDIO_API_OPERATIONS[operationId]?.parameters||[]).some(parameter=>parameter.in==='header'&&parameter.name.toLowerCase()==='if-match');
/** Toast text for a refused bus delete: a 409 while lanes still send to the bus (deleteLaneSend them first). */
export function busDeleteConflictMessage(error){
 if(!error||error.status!==409)return null;
 const detail=typeof error.message==='string'&&error.message?` ${error.message}`:'';
 return`This bus still has sends routed to it. Remove them first (right-click the route arrow), then delete the bus.${detail}`.slice(0,300);
}
function dataOf(result){
 if(!record(result)||!Number.isInteger(result.status)||result.status<200||result.status>=300||!record(result.data))throw failure('Studio API returned no complete send response.');
 const data=result.data;
 if(data.error||data.ok===false)throw failure(typeof data.error==='string'?data.error:data.error?.message||data.message||'Studio API rejected the send request.',data.error?.code??data.code??'studio_sends_rejected',{status:result.status,explicitRejection:true});
 return data;
}
export class StudioApiSends{
 /** capture() returns the current project scope (it throws when none is loaded). */
 constructor({capture,client=new StudioApiClient(),mixRevision=null,idFactory=()=>globalThis.crypto.randomUUID()}={}){
  if(typeof capture!=='function'||typeof client?.call!=='function'||typeof idFactory!=='function')throw new TypeError('Studio API sends need a scope capture, the generated client and a key factory.');
  Object.assign(this,{capture,client,mixRevision,idFactory});this.operation=null;
 }
 get busy(){return !!this.operation;}
 /** True when the generated client knows both send operations. */
 get available(){return OPERATIONS.every(id=>!!STUDIO_API_OPERATIONS[id]);}
 async run(operationId,{path={},body}){
  if(!STUDIO_API_OPERATIONS[operationId])throw failure('The Studio API sends contract is unavailable.','studio_sends_contract_unavailable',{dispatched:false});
  if(this.operation)throw failure('Wait for the current send change.','studio_sends_busy',{dispatched:false});
  const scope=this.capture();this.operation={operationId};
  try{
   for(let attempt=0;;attempt++){
    if(!same(scope,this.capture()))throw failure('The project changed during the send change.','studio_sends_scope_changed',{dispatched:false});
    const revision=this.mixRevision?.available?.(scope.projectId)?this.mixRevision.revision:null,inBody=revision!==null&&body!==undefined&&accepts(operationId,'expected_mix_revision'),inHeader=revision!==null&&!inBody&&takesIfMatch(operationId);
    const payload=body===undefined?undefined:{...body,...inBody?{expected_mix_revision:revision}:{}};
    let result;
    try{result=await this.client.call(operationId,{path:{project_id:scope.projectId,...path},...payload!==undefined?{body:payload}:{}},{idempotencyKey:this.idFactory(),...inHeader?{ifMatch:mixEtag(revision)}:{}});}
    catch(error){
     if(isMixRevisionConflict(error)&&attempt===0&&this.mixRevision?.resolveConflict){
      // Our own realtime messages may have moved the revision: adopt it and try once more.
      let resolved=null;try{resolved=await this.mixRevision.resolveConflict(error);}catch{}
      if(resolved?.explained)continue;
     }
     throw error;
    }
    if(!same(scope,this.capture()))throw failure('The project changed during the send change.','studio_sends_scope_changed',{dispatched:true,operationUncertain:true});
    const data=dataOf(result);
    this.mixRevision?.noteWrite?.({...result,data},null);
    return{data,revision:mixRevisionOf(data,{etag:result.etag})};
   }
  }finally{this.operation=null;}
 }
 /** Create or retune the send laneId -> busId; resolves to {send, previous} (live-send shape, previous null for a new send). */
 async put({laneId,busId,level,preFader}){
  if(!finite(level)||level<0||level>SEND_MAX_LEVEL)throw failure('The send level must be from 0 to 2.','studio_sends_invalid_input',{dispatched:false});
  const{data,revision}=await this.run('setLaneSend',{path:{lane_id:laneId,bus_id:busId},body:{level:roundLevel(level),...typeof preFader==='boolean'?{pre_fader:preFader}:{}}});
  const send=sendFromCard(laneId,data.send);if(!send)throw failure('Studio API returned an invalid send.');
  return{send,previous:sendFromCard(laneId,data.previous),mixRevision:revision};
 }
 /** Remove the send (idempotent); resolves to {previous}. */
 async remove({laneId,busId}){
  const{data,revision}=await this.run('deleteLaneSend',{path:{lane_id:laneId,bus_id:busId}});
  return{previous:sendFromCard(laneId,data.previous),mixRevision:revision};
 }
}
