/** POST /projects/{id}/engine:reload (reloadEngineSession) after a committed
 * clips:batch reports engine_reload_required / engine_divergent.
 *
 * Spec: mode=reconcile reuses the running session (prunes deleted clips,
 * restores missing ones; fast) but does not rebuild plug-ins or fix a clip on
 * the wrong lane; mode=full rebuilds everything (up to ~90 s, listeners hear a
 * short gap). Reconcile is tried first; full runs only when reconcile fails,
 * answers that it did not reload, or the divergence is one reconcile documents
 * it cannot fix. Exactly one reload chain per call: never a loop. The transport
 * is not touched here (reconcile keeps the running session and its playback).
 */
import {StudioApiClient} from './studio-api-client.js';

const RECONCILE_UNFIXABLE=new Set(['wrong_lane']);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);

export function engineReloadResult(data,projectId,mode){
 if(!record(data)||data.projectId!==projectId||typeof data.reloaded!=='boolean'||typeof data.fullyLoaded!=='boolean'||!['full','reconcile'].includes(data.mode)||!Number.isSafeInteger(data.durationMs)||data.durationMs<0)throw Object.assign(new Error('Freestyle returned an invalid engine reload receipt.'),{code:'engine_reload_invalid'});
 if(data.mode!==mode)throw Object.assign(new Error(`Freestyle answered a ${data.mode} reload for a ${mode} request.`),{code:'engine_reload_invalid'});
 return structuredClone(data);
}
/** Both modes fail the same way for these: a full reload cannot help. */
function sharedRefusal(error){return error?.status===409&&['recording_in_progress','studio_busy_on_other_project'].includes(error?.code)||error?.status===429||[400,401,403,404,422,428].includes(error?.status);}

/** Saved REST snapshots omit the outer take when it is the project's default
 * (first non-backing clip); otherwise the session's scope is forwarded. */
export function reloadScopeTrack(rawProject,trackId){
 if(typeof trackId!=='string'||!trackId)return undefined;
 const clips=Array.isArray(rawProject?.clips)?rawProject.clips:null,first=clips?.find(clip=>clip&&!clip.deleted&&!clip.isBacking);
 return first?.id===trackId?undefined:trackId;
}

export async function resyncEngineSession({client=new StudioApiClient(),projectId,trackId,divergent=[],isCurrent=()=>true,now=()=>globalThis.performance?.now?.()??Date.now()}={}){
 if(typeof projectId!=='string'||!projectId)throw new Error('Open a Freestyle project before resyncing its engine.');
 const attempts=[],started=now(),body=mode=>({mode,...(trackId?{track_id:trackId}:{})});
 const send=async mode=>{const at=now(),entry={mode,status:'sending'};attempts.push(entry);try{const response=await client.call('reloadEngineSession',{path:{project_id:projectId},body:body(mode)});entry.ms=Math.round(now()-at);entry.status='ok';return engineReloadResult(response.data,projectId,mode);}catch(error){entry.ms=Math.round(now()-at);entry.status='failed';entry.code=error?.code??null;entry.httpStatus=error?.status??null;throw error;}};
 const wanted=(Array.isArray(divergent)?divergent:[]).some(item=>RECONCILE_UNFIXABLE.has(item?.reason))?'full':'reconcile';
 let result=null,reconcileError=null;
 if(wanted==='reconcile'){
  try{result=await send('reconcile');}catch(error){if(sharedRefusal(error))throw Object.assign(error,{engineReloadAttempts:attempts});reconcileError=error;}
  if(!isCurrent())return{status:'stale',attempts};
  if(result&&result.reloaded===true&&result.fullyLoaded===true)return{status:'resynced',mode:'reconcile',result,attempts,ms:Math.round(now()-started)};
 }
 try{result=await send('full');}catch(error){throw Object.assign(error,{engineReloadAttempts:attempts,reconcileError:reconcileError?.message??null});}
 if(!isCurrent())return{status:'stale',attempts};
 if(result.reloaded!==true||result.fullyLoaded!==true)throw Object.assign(new Error('Freestyle did not confirm a fully loaded engine session.'),{code:'engine_reload_incomplete',engineReloadAttempts:attempts,result});
 return{status:'resynced',mode:'full',result,attempts,ms:Math.round(now()-started),reason:wanted==='full'?'wrong_lane':reconcileError?'reconcile_failed':'reconcile_incomplete'};
}
