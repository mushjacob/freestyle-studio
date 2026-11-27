/** Isolated pattern previews use the advancing audio-device clock, not song time. */
const finite=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value));
const positive=value=>finite(value)&&Number(value)>0;
const mod=(n,d)=>((n%d)+d)%d;
const schedulingCounts=['scheduled_sample_clips','scheduled_midi_notes','scheduled_midi_messages','scheduled_cc_events'];
const failureCounts=['skipped_invalid_events','skipped_missing_sample_asset','skipped_missing_sample_source','skipped_missing_source_lane','skipped_sample_clip_errors'];
const message=value=>typeof value==='string'?value.replace(/\s+/g,' ').slice(0,180):'';
function schedulingFailure(receipt,detail,code='pattern_preview_scheduling_failed'){
 const error=new Error(detail);error.code=code;error.receipt=receipt;return error;
}
/** Scheduling counters establish audibility; partial source failures remain audible
 * previews with a warning. A success envelope alone is not scheduling evidence.
 */
export function previewScheduleStatus(receipt){
 const counts=[...schedulingCounts,...failureCounts];
 const invalid=counts.some(key=>receipt?.[key]!=null&&(!finite(receipt[key])||typeof receipt[key]==='boolean'||Number(receipt[key])<0||!Number.isInteger(Number(receipt[key]))));
 const failures=failureCounts.reduce((n,key)=>n+Math.max(0,Number(receipt?.[key])||0),0);
 const sampleErrors=Array.isArray(receipt?.sample_errors)?receipt.sample_errors:[];
 const errors=sampleErrors.slice(0,3).map(item=>{
  if(typeof item==='string')return message(item);
  const source=message(item?.source_id??item?.sourceId??item?.source_name??item?.source),detail=message(item?.error?.message??item?.error??item?.message??item?.detail);
  return [source,detail].filter(Boolean).join(': ');
 }).filter(Boolean);
 const scheduledSamples=Number(receipt?.scheduled_sample_clips)||0,midiNotes=Number(receipt?.scheduled_midi_notes)||0,midiMessages=Number(receipt?.scheduled_midi_messages)||0;
 const audibleEventCount=scheduledSamples+Math.max(midiNotes,midiMessages),failedEventCount=failures;
 if(invalid)throw schedulingFailure(receipt,`Freestyle could not schedule this pattern preview (${failures||'invalid'} failed events; invalid scheduling counts).`);
 const details=errors.length?` ${errors.join('; ')}${sampleErrors.length>errors.length?'…':''}`:'';
 if(receipt?.ok===false||receipt?.error||!(audibleEventCount>0)){
  const why=failures?`${failures} failed events`:sampleErrors.length?`${sampleErrors.length} failed sources`:'no audible events were acknowledged';
  throw schedulingFailure(receipt,`Freestyle could not schedule this pattern preview (${why}; scheduled samples: ${scheduledSamples}).${details}`,failures||sampleErrors.length?'pattern_preview_scheduling_failed':'pattern_preview_silent');
 }
 const partial=receipt?.complete===false||failures>0||sampleErrors.length>0;
 const warning=partial?`Pattern preview is incomplete: ${scheduledSamples} sample clips and ${Math.max(midiNotes,midiMessages)} MIDI events scheduled; ${failures?`${failures} failed events`:sampleErrors.length?`${sampleErrors.length} failed sources`:'some content was not scheduled'}.${details}`:null;
 return {audibleEventCount,failedEventCount,sampleErrors,complete:!partial,reportedComplete:typeof receipt?.complete==='boolean'?receipt.complete:null,warning};
}
export function assertPreviewScheduled(receipt){previewScheduleStatus(receipt);return receipt;}

export function patternPreviewPosition(receipt,anchor,{at=performance.now(),bpm=120,heardLagSec=0,maxAgeMs=2500,expectedEpoch,smoothElapsed=null}={}){
 const unknown={seconds:null,beat:null,playing:true,previewing:true,previewClockAvailable:false,clockAvailable:false,clockSource:'pattern-preview-awaiting-clock',bpm};
 const clock=anchor?.payload||{},observed=anchor?.receivedAt,start=receipt?.min_schedule_time_sec??receipt?.engine_time_sec;
 if(!finite(start)||!positive(receipt?.cycle_duration_sec)||!finite(observed)||!finite(clock.audio_device_sample)||!positive(clock.sample_rate))return unknown;
 if(expectedEpoch!=null&&clock.session_epoch!=null&&Number(expectedEpoch)!==Number(clock.session_epoch))return unknown;
 const age=Number(at)-Number(observed);if(age< -5||age>maxAgeMs)return unknown;
 // All fields belong to the same engine snapshot. Compensate its device-clock
 // anchor with the native delivery floor while freshness uses raw arrival age.
 const anchorAt=finite(anchor?.anchorAt)?Number(anchor.anchorAt):Number(observed),deviceElapsed=Math.max(0,(Number(at)-anchorAt)/1000);
 const cycle=Number(receipt.cycle_duration_sec),rawElapsed=Number(clock.audio_device_sample)/Number(clock.sample_rate)+deviceElapsed-Math.max(0,Number(heardLagSec)||0)-Number(start),elapsed=typeof smoothElapsed==='function'?smoothElapsed(rawElapsed):rawElapsed;
 const loop=receipt.preview_program_active===true,repeats=positive(receipt.repeat_count)?Number(receipt.repeat_count):1,duration=positive(receipt.duration_sec)?Number(receipt.duration_sec):cycle*repeats;
 const ended=!loop&&elapsed>=duration,phase=mod(Math.max(0,elapsed)+(Number(receipt.phase_offset_sec)||0),cycle),seconds=ended?duration:phase;
 return {seconds,beat:seconds*Number(bpm)/60,patternBeat:seconds*Number(bpm)/60,playing:!ended,previewing:true,previewClockAvailable:true,clockAvailable:true,clockSource:'pattern-preview-audio-device',clockAgeMs:Math.max(0,age),bpm,previewElapsedSec:Math.max(0,elapsed),previewEnded:ended,pendingStart:elapsed<0,previewRepeatCount:repeats,previewDurationSec:duration,previewProgramActive:loop,loopEnabled:loop,loopStartSec:0,loopEndSec:loop?cycle:duration,heardLagSec:Math.max(0,Number(heardLagSec)||0)};
}

/** Read-only field-presence diagnostics. Never copy receipts, IDs, or error text. */
export function patternPreviewDiagnostics({receipt,context,session={},monitor={},previewing=false,at=session.now?.()??performance.now()}={}){
 const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null,boolean=value=>typeof value==='boolean'?value:null;
 const anchors={};
 for(const [name,anchor]of [['rtc',session.liveClock],['http',session.explicitClock],['interactive',session.interactiveClock]]){
  const payload=anchor?.payload||{};
  anchors[name]={present:!!anchor,ageMs:number(anchor?.receivedAt)===null?null:Math.round(at-anchor.receivedAt),deviceSample:finite(payload.audio_device_sample)&&Number(payload.audio_device_sample)>=0,sampleRate:positive(payload.sample_rate),projectMatches:anchor?anchor.projectId===session.projectId:null,epoch:number(payload.session_epoch)};
 }
 const generationMatches=context?.generation===monitor.generation&&context?.generation!==undefined,anchor=generationMatches?session.liveClock:null,clock=anchor?.payload||{};
 let reason='ready';
 if(!receipt)reason='missing-receipt';
 else if(!generationMatches)reason='peer-generation-mismatch';
 else if(!anchor)reason='missing-rtc-anchor';
 else if(!finite(receipt.min_schedule_time_sec??receipt.engine_time_sec))reason='missing-schedule-time';
 else if(!positive(receipt.cycle_duration_sec))reason='missing-cycle-duration';
 else if(!finite(clock.audio_device_sample))reason='missing-device-sample';
 else if(!positive(clock.sample_rate))reason='missing-sample-rate';
 else if(!finite(anchor.receivedAt))reason='missing-arrival-time';
 else if(context?.epoch!=null&&clock.session_epoch!=null&&Number(context.epoch)!==Number(clock.session_epoch))reason='engine-epoch-mismatch';
 else if(at-anchor.receivedAt< -5)reason='future-rtc-anchor';
 else if(at-anchor.receivedAt>2500)reason='stale-rtc-anchor';
 return{previewing:previewing===true,reason,generationMatches,expectedEpoch:number(context?.epoch),receipt:{present:!!receipt,programActive:boolean(receipt?.preview_program_active),initialCycles:number(receipt?.preview_program_initial_cycles),repeatCount:number(receipt?.repeat_count),cycleSec:number(receipt?.cycle_duration_sec),durationSec:number(receipt?.duration_sec),scheduleTimeSec:number(receipt?.min_schedule_time_sec??receipt?.engine_time_sec),scheduledSamples:number(receipt?.scheduled_sample_clips),scheduledMidi:number(receipt?.scheduled_midi_notes),complete:boolean(receipt?.complete)},anchors};
}
