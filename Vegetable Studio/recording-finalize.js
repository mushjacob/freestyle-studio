/** finalizeRecording for a take streamed on the live-ingest uplink (Realtime → Recording a take, GitHub issue #4).
 *
 *  1. placeTake: finalize with `wait_for:"placed"`. Freestyle answers about a second after take_stop with the
 *     clip already on its lane (`saved:false, state:"saving"`, track_id / lane_id / start_ms / duration_sec), so
 *     the UI replaces its live recording clip at once. An engine that does not know `wait_for` answers as before
 *     (`saved:true` once stored): that is accepted too.
 *  2. confirmSaved: the same take_id again (default `wait_for:"saved"`) until `saved:true`, in the background.
 *     409 recording_take_pending is the documented "still saving" signal; 422 recording_take_rejected /
 *     recording_take_silent, 404 and 403 are final.
 *
 *  `call(arguments)` sends one finalizeRecording with those body arguments and resolves the action result
 *  (or rejects with the HTTP error). Pure: no DOM, no timers except the injected `sleep`. */
const sleepMs=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const FINAL_CODES=Object.freeze(['recording_take_rejected','recording_take_silent','recording_take_not_found','recording_take_owner_mismatch']);
const codeOf=error=>String(error?.code||error?.data?.error?.code||error?.body?.error?.code||'');
/** The engine reply inside an action result ({response:{…}} over REST, structuredContent over MCP). */
export function finalizeBody(result){const value=result?.structuredContent??result;return value?.response??value?.result?.response??value?.result??value??{};}
function retryable(error){const code=codeOf(error);if(FINAL_CODES.includes(code))return false;return /recording_take_pending/.test(code||String(error?.message||''))||[429,503].includes(error?.status);}
function bodyError(result){
 const value=result?.structuredContent??result,body=finalizeBody(result),code=value?.error?.code||body?.code||value?.code||'';
 if(/recording_take_pending/.test(String(code)))return{pending:true,code};
 if(result?.isError||value?.error||body?.ok===false)return{error:Object.assign(new Error(value?.error?.message||body?.message||(typeof value?.error==='string'?value.error:'')||'Freestyle did not save the take.'),{code:code||'recording_take_not_saved',recordingFinalize:body})};
 return null;
}
async function loop(call,args,{attempts,retryMs,sleep,accept}){
 let last=null;
 for(let attempt=0;attempt<attempts;attempt++){
  let result;
  try{result=await call(args);}catch(error){if(!retryable(error))throw error;last=error;await sleep(error?.status===429?Math.max(retryMs,1000*(Number(error.retryAfterSec??error.retryAfter)||1)):retryMs);continue;}
  const problem=bodyError(result);
  if(problem?.pending){last=Object.assign(new Error('Freestyle is still saving the take.'),{code:problem.code});await sleep(retryMs);continue;}
  if(problem?.error)throw problem.error;
  const body={...finalizeBody(result)};
  if(accept(body))return body;
  last=Object.assign(new Error('Freestyle is still saving the take.'),{code:'recording_take_pending',recordingFinalize:body});await sleep(retryMs);
 }
 throw last||new Error('Freestyle is still saving the take.');
}
/** Step 1: resolves once the clip is on its lane (saved true or false). */
export function placeTake(call,takeId,{attempts=8,retryMs=250,waitMs=8000,sleep=sleepMs}={}){
 return loop(call,{take_id:takeId,confirm:true,wait_for:'placed',wait_ms:waitMs},{attempts,retryMs,sleep,accept:body=>body.saved===true||body.state==='saving'&&!!(body.track_id||body.clip_id)});
}
/** Step 2: resolves with the `saved:true` reply; rejects on a final refusal (the engine removed the clip). */
export function confirmSaved(call,takeId,{attempts=12,retryMs=500,waitMs=8000,sleep=sleepMs}={}){
 return loop(call,{take_id:takeId,confirm:true,wait_ms:waitMs},{attempts,retryMs,sleep,accept:body=>body.saved===true});
}
