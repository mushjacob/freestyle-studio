/** Logic Pro "Play from Selection" (⇧Space) and the MIDI panic ("Send All Notes
 * Off"; Logic's double-click on Stop) for Illogic Amateur.
 *
 * Play from Selection plays the selected regions' span once through the
 * published Studio API range command `playRange` POST /transport/play-range
 * {start_sec, end_sec, track_id?}: "plays [start, end) once; the engine stops
 * exactly at end (sample-accurate). Any later play/pause/seek/seek_and_play/
 * loop change cancels the pending end". There is no native mozart-control
 * range message (exact selection playback uses the REST range
 * command), so only the dispatch differs from Play: CloudEngine.play keeps the
 * gesture audio priming, monitor readiness, cancellation and permission
 * cleanup, and Stop stays the normal fast stop path (its transport stop cancels
 * the pending range end in the engine).
 *
 * MIDI panic sends `engineMidiAllNotesOff` POST /engine/midi:allNotesOff
 * {instrument_id} (required; "Silence an instrument") once per instrument lane
 * of the open project. The instrument id is the durable lane id, as for
 * send_midi (verified live in cloud-instrument-audition.js). Not an undo step.
 */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=(value,max=64)=>typeof value==='string'&&value.length>0&&value.length<=max&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const fail=(message,code,extra={})=>Object.assign(new Error(message),{code},extra);
export const PLAY_RANGE_OPERATION='playRange';
export const MIDI_PANIC_OPERATION='engineMidiAllNotesOff';
/** Margin after the range end before the clock is re-read (the engine stops by itself). */
export const PLAY_RANGE_END_RESYNC_MS=250;
const round=value=>Math.round(value*1e6)/1e6;

/**
 * The span to play, in seconds: a marquee / time selection when one exists,
 * else the selected regions' outer bounds (beats → seconds at the project tempo,
 * as Play from the Tracks area does). null when nothing is selected.
 */
export function selectionRange({regions=[],marquee=null,bpm}={}){
 if(!finite(bpm)||bpm<=0)return null;
 const toSec=beat=>beat*60/bpm;
 if(record(marquee)&&finite(marquee.startBeat)&&finite(marquee.endBeat)&&marquee.endBeat>marquee.startBeat)return{startSec:round(Math.max(0,toSec(marquee.startBeat))),endSec:round(toSec(marquee.endBeat)),startBeat:Math.max(0,marquee.startBeat),source:'marquee'};
 const spans=(Array.isArray(regions)?regions:[]).filter(region=>finite(region?.start)&&finite(region?.length)&&region.length>0);
 if(!spans.length)return null;
 const start=Math.max(0,Math.min(...spans.map(region=>region.start))),end=Math.max(...spans.map(region=>region.start+region.length));
 if(!(end>start))return null;
 return{startSec:round(toSec(start)),endSec:round(toSec(end)),startBeat:start,source:'regions'};
}

/** The published playRange body for a range (start_sec/end_sec; optional track_id scope). */
export function playRangeBody({startSec,endSec},trackId){
 if(!finite(startSec)||!finite(endSec)||startSec<0||endSec<=startSec)throw fail('Select regions with a length to play the selection.','play_range_invalid',{dispatched:false});
 return{start_sec:startSec,end_sec:endSec,...(id(trackId)?{track_id:trackId}:{})};
}

/**
 * The dispatcher handed to CloudEngine.play({dispatch}): sends playRange, checks
 * the receipt, adopts it as the transport acknowledgement (playing from start)
 * and re-reads the clock once the engine has stopped at the range end.
 * options: client (StudioApiClient), session (CloudSession), projectId, trackId,
 * range {startSec,endSec}, log, setTimeout, onEnded(position) after the
 * post-end clock re-read (the engine's actual stop position, e.g. stopped_at_sec).
 */
export function playRangeDispatch({client,session,projectId,trackId,range,log=()=>{},onEnded=()=>{},setTimeout:later=(fn,ms)=>globalThis.setTimeout(fn,ms)}){
 if(typeof client?.call!=='function')throw fail('Play from Selection needs a Studio API (OAuth) project. Reload the project.','play_range_unavailable',{dispatched:false});
 if(!id(projectId,128))throw fail('Open a Freestyle project first.','play_range_scope',{dispatched:false});
 const body=playRangeBody(range,trackId);
 return async()=>{
  const sentAt=Date.now(),result=await client.call(PLAY_RANGE_OPERATION,{path:{project_id:projectId},body});
  if(session&&session.projectId!==projectId)throw fail('The cloud project changed during Play from Selection.','transport_scope_changed',{name:'AbortError'});
  const data=result?.data,response=record(data?.response)?data.response:{};
  if(response.ok===false)throw fail(String(response.error||response.message||'Freestyle refused Play from Selection.'),'play_range_refused',{status:409});
  if(!record(data))throw fail('Freestyle did not confirm Play from Selection.','play_range_receipt',{operationUncertain:true});
  // EngineActionResult.response is the engine's own reply; a status block, when present, wins.
  const status=record(response.status)?response.status:response;
  const ack={...status,is_playing:typeof(status.is_playing??status.isPlaying)==='boolean'?(status.is_playing??status.isPlaying):true};
  if(!finite(Number(ack.position_seconds??ack.position)))ack.position_seconds=body.start_sec;
  let version=null;
  try{session?.applyTransportAcknowledgement?.('seek_and_play',ack,{seconds:body.start_sec,projectId});}catch{}
  version=Number.isInteger(session?.transportVersion)?session.transportVersion:null;try{session?.startTicking?.();}catch{}
  log('play-range',{startSec:body.start_sec,endSec:body.end_sec,ms:Date.now()-sentAt});
  // The engine stops by itself at end_sec; re-read the clock then unless a newer command ran.
  later(()=>{try{if(!session||session.projectId!==projectId||version!==null&&session.transportVersion!==version)return;Promise.resolve(session.refreshTransportClock?.({projectId,trackId})).then(position=>{if(session.projectId===projectId)onEnded(position);}).catch(()=>{});}catch{}},Math.round((body.end_sec-body.start_sec)*1000)+PLAY_RANGE_END_RESYNC_MS);
  return ack;
 };
}

/** The instrument lanes a panic silences: instrument lanes plus lanes hosting a pattern's plugin source. */
export function panicInstrumentIds(rawProject){
 const ids=new Set();
 for(const lane of Array.isArray(rawProject?.lanes)?rawProject.lanes:[])if(id(lane?.id)&&(lane.kind==='instrument'||lane.kind==='midi'||id(lane.instrumentType)))ids.add(lane.id);
 for(const pattern of Array.isArray(rawProject?.patterns)?rawProject.patterns:[]){
  const sources=pattern?.content?.sources||pattern?.pattern?.sources||pattern?.sources;
  for(const source of Array.isArray(sources)?sources:[])if(source?.kind==='plugin'&&id(source.laneId))ids.add(source.laneId);
 }
 return[...ids];
}

/**
 * Send All Notes Off to every instrument of the project (engineMidiAllNotesOff
 * per instrument lane). Resolves {sent, failed:[{instrumentId,message}]}.
 * Not an undo step and never journaled.
 */
export async function sendMidiPanic({client,projectId,instrumentIds,trackId,log=()=>{}}){
 if(typeof client?.call!=='function')throw fail('MIDI panic needs a Studio API (OAuth) project. Reload the project.','midi_panic_unavailable',{dispatched:false});
 if(!id(projectId,128))throw fail('Open a Freestyle project first.','midi_panic_scope',{dispatched:false});
 const targets=[...new Set((instrumentIds||[]).filter(value=>id(value)))];
 if(!targets.length)return{sent:0,failed:[],instruments:0};
 const query=id(trackId)?{scope_track_id:trackId}:{};
 const outcomes=await Promise.allSettled(targets.map(instrumentId=>client.call(MIDI_PANIC_OPERATION,{path:{project_id:projectId},query,body:{instrument_id:instrumentId}}).then(result=>{if(result?.data?.response?.ok===false)throw new Error(String(result.data.response.error||result.data.response.message||'refused'));return result;})));
 const failed=outcomes.map((outcome,index)=>outcome.status==='rejected'?{instrumentId:targets[index],message:String(outcome.reason?.message||outcome.reason).slice(0,160)}:null).filter(Boolean);
 log('midi-panic',{instruments:targets.length,failed:failed.length});
 return{sent:targets.length-failed.length,failed,instruments:targets.length};
}
