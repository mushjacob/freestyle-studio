/** Instrument slot ▸ swap the instrument of an existing software-instrument track in place (#20, release 2026-11-18).
 *
 * replaceLaneInstrument: PUT /projects/{id}/lanes/{lane_id}/instrument {instrument_id, preset?} with If-Match (the
 * timeline revision). The lane keeps its patterns, notes, effects, sends and mix. The reply names previousInstrument
 * and an `undo` request (PUT, same route, body {instrument_id, restore_state}) that restores the exact previous sound;
 * it is sent as is with If-Match = the reply's timelineRevision. Same instrument with no preset → replaced:false
 * (nothing changed, no undo step).
 */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
const text=value=>typeof value==='string'&&value?value:null;
/** "<timeline>.<hash>" (getProject) or "<timeline>" → the bare quoted timeline revision If-Match expects. */
export function timelineIfMatch(etag){
 const raw=text(etag);if(!raw)return null;const bare=raw.replace(/^W\//,'').replace(/^"|"$/g,'').replace(/-(?:gzip|zstd|br)$/,'').split('.')[0];
 return bare?`"${bare}"`:null;
}
const quote=revision=>text(revision)?(revision.startsWith('"')?revision:`"${revision}"`):null;
/** The lane id an `undo` request addresses (…/lanes/{lane_id}/instrument), or null. */
export function undoLaneId(undo){const match=/\/lanes\/([^/?#]+)\/instrument(?:[?#]|$)/.exec(String(undo?.path||''));return match?decodeURIComponent(match[1]):null;}
/** Normalized reply; throws on a reply that does not confirm the swap. */
export function replaceReceipt(data,{laneId,instrumentId}={}){
 const body=record(data?.response)?data.response:data;
 if(!record(body)||body.ok===false||typeof body.replaced!=='boolean')throw Object.assign(new Error('Freestyle did not confirm the instrument swap.'),{code:'instrument_replace_unconfirmed',operationUncertain:true});
 if(laneId&&text(body.laneId)&&body.laneId!==laneId)throw Object.assign(new Error('Freestyle swapped the instrument of another track.'),{code:'instrument_replace_scope'});
 const undo=record(body.undo)&&body.undo.method==='PUT'&&record(body.undo.body)?copy(body.undo):null;
 if(undo&&laneId&&undoLaneId(undo)!==laneId)throw Object.assign(new Error('The instrument undo request names another track.'),{code:'instrument_replace_scope'});
 const name=item=>text(item?.name)||text(item?.id);
 return{replaced:body.replaced,laneId:text(body.laneId)||laneId||null,instrumentId:text(body.instrument?.id)||instrumentId||null,instrumentName:name(body.instrument)||instrumentId||null,previousId:text(body.previousInstrument?.id),previousName:name(body.previousInstrument),pluginIndex:Number.isInteger(body.pluginIndex)?body.pluginIndex:0,instanceId:text(body.instanceId),presetApplied:text(body.presetApplied),timelineRevision:text(body.timelineRevision),undo,warnings:Array.isArray(body.warnings)?body.warnings.filter(text):[]};
}
/**
 * client: StudioApiClient-like {call(operationId,{path,body},{ifMatch})}; ifMatch(): the current timeline If-Match.
 * Returns {receipt, undo(), redo()} — undo/redo resolve the next receipt and keep the pair current.
 */
/** The instrument type in listLanePlugins slot 0 (an instrument lane's generator), or null. */
export async function laneInstrumentType(client,projectId,laneId){
 const result=await client.call('listLanePlugins',{path:{project_id:projectId,lane_id:laneId}});const data=result?.data??result,body=record(data?.response)?data.response:data;
 const rows=Array.isArray(body?.plugins)?body.plugins:Array.isArray(body?.data)?body.data:[];const slot=rows.find(row=>row?.index===0);
 return text(slot?.type_id)||text(slot?.typeId)||text(slot?.type);
}
export async function replaceLaneInstrument({client,projectId,laneId,instrumentId,preset=null,ifMatch,log=()=>{}}){
 if(typeof client?.call!=='function'||!text(projectId)||!text(laneId)||!text(instrumentId))throw new TypeError('Replacing an instrument needs the project, the track and a catalog instrument id.');
 const send=async(body,revision)=>{let fresh=null;try{fresh=timelineIfMatch(await ifMatch?.());}catch{}const tag=fresh||quote(revision);if(!tag)throw Object.assign(new Error('Read the project before swapping its instrument.'),{code:'instrument_replace_revision',dispatched:false});
  let result;try{result=await client.call('replaceLaneInstrument',{path:{project_id:projectId,lane_id:laneId},body},{ifMatch:tag});}
  catch(error){
   // Live 2026-11-18: an undo (restore_state) can answer 502 engine_error (engine 504) after ~26 s although the swap
   // landed. Only a read-back of slot 0 decides; the 502 is logged, never hidden, and nothing is resent.
   if(!(Number(error?.status)>=500))throw error;let now=null;try{now=await laneInstrumentType(client,projectId,laneId);}catch{}
   log('instrument-replace-uncertain',{status:error.status,code:error.code??null,requestId:error.requestId??null,wanted:body.instrument_id,readBack:now});
   if(now&&now.toLowerCase()===String(body.instrument_id).toLowerCase())return{replaced:true,confirmedByRead:true,laneId,instrumentId:body.instrument_id,instrumentName:body.instrument_id,previousId:null,previousName:null,pluginIndex:0,instanceId:null,presetApplied:null,timelineRevision:null,undo:null,warnings:[`Freestyle answered HTTP ${error.status}; the track was read back with ${now}.`],requestId:error.requestId??null};
   throw Object.assign(error,{operationUncertain:true});
  }
  return replaceReceipt(result?.data??result,{laneId,instrumentId:body.instrument_id});};
 const receipt=await send({instrument_id:instrumentId,...text(preset)?{preset}:{}});
 const state={current:receipt};
 return{receipt,
  /** Put the previous instrument back with its exact saved sound (the reply's undo request). */
  async undo(){const step=state.current;if(!step?.undo)throw Object.assign(new Error('Freestyle returned no way to restore the previous instrument.'),{dispatched:false});const back=await send(copy(step.undo.body),step.timelineRevision);state.previous=step;state.current=back;return back;},
  /** Swap again to the instrument this step chose (its preset, when one was named). */
  async redo(){const back=await send({instrument_id:instrumentId,...text(preset)?{preset}:{}});state.current=back;return back;}};
}
