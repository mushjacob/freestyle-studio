/** Isolated pattern previews use the advancing audio-device clock, not song time. */
const finite=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value));
const positive=value=>finite(value)&&Number(value)>0;
const mod=(n,d)=>((n%d)+d)%d;
const failureCounters=['skipped_invalid_events','skipped_missing_sample_asset','skipped_missing_sample_source','skipped_missing_source_lane','skipped_sample_clip_errors'];
const scheduleCounters=['scheduled_sample_clips','scheduled_midi_notes','scheduled_midi_messages','scheduled_cc_events'];
/** Keep native diagnostics intact; bound only the human-readable error text. */
export function previewSchedulingDiagnostics(receipt){
 const failures=failureCounters.reduce((n,key)=>n+Math.max(0,Number(receipt?.[key])||0),0);
 const invalidCounts=scheduleCounters.some(key=>finite(receipt?.[key])&&Number(receipt[key])<0);
 const sampleErrors=Array.isArray(receipt?.sample_errors)?receipt.sample_errors:receipt?.sample_errors==null?[]:[receipt.sample_errors];
 const partial=receipt?.complete===false,failed=receipt?.ok===false||partial||failures>0||invalidCounts||sampleErrors.length>0;
 const reasons=sampleErrors.slice(0,6).map(entry=>{
  if(typeof entry==='string')return entry.slice(0,240);
  if(entry&&typeof entry==='object'){const text=entry.reason??entry.code??entry.error??entry.message;return (typeof text==='string'?text:JSON.stringify(entry)).slice(0,240);}
  return String(entry).slice(0,240);
 });
 return {failed,complete:typeof receipt?.complete==='boolean'?receipt.complete:null,failures,invalidCounts,sampleErrors,reasons};
}
export function assertPreviewScheduled(receipt){
 const diagnostics=previewSchedulingDiagnostics(receipt);
 if(diagnostics.failed){
  const count=diagnostics.failures||diagnostics.sampleErrors.length||(diagnostics.invalidCounts?'invalid':'unreported');
  const detail=diagnostics.reasons.length?` Reasons: ${diagnostics.reasons.join('; ')}${diagnostics.sampleErrors.length>6?'; …':''}.`:'';
  const error=new Error(`Freestyle could not schedule this ${diagnostics.complete===false?'complete ':''}pattern preview (${count} failed events; scheduled samples: ${receipt?.scheduled_sample_clips??'unknown'}).${detail}`);
  error.code='pattern_preview_scheduling_failed';error.receipt=receipt;error.diagnostics=diagnostics;throw error;
 }
 return receipt;
}
/** Native preview fields are opt-in; no unadvertised defaults are invented. */
export function patternPreviewOptions(options={}){
 if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Pattern preview options must be an object.');
 const allowed=['repeat_count','gain','phase_offset_sec','lead_sec','swing'],result={};
 for(const key of Object.keys(options)){
  if(!allowed.includes(key))throw new TypeError(`Unsupported pattern preview option: ${key}.`);
  const value=options[key];if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`Pattern preview ${key} must be finite.`);
  if(key==='repeat_count'&&(!Number.isInteger(value)||value<1||value>64))throw new RangeError('Pattern preview repeat_count must be an integer from 1 to 64.');
  result[key]=value;
 }
 return result;
}
export function patternPreviewPosition(receipt,anchor,{at=performance.now(),bpm=120,heardLagSec=0,maxAgeMs=2500,expectedEpoch,finiteRepeats=false}={}){
 const unknown={seconds:null,beat:null,playing:true,previewing:true,previewClockAvailable:false,clockAvailable:false,clockSource:'pattern-preview-awaiting-clock',bpm};
 const clock=anchor?.payload||{},observed=anchor?.receivedAt,start=receipt?.min_schedule_time_sec??receipt?.engine_time_sec;
 if(!finite(start)||!positive(receipt?.cycle_duration_sec)||!finite(observed)||!finite(clock.audio_device_sample)||!positive(clock.sample_rate))return unknown;
 if(expectedEpoch!=null&&clock.session_epoch!=null&&Number(expectedEpoch)!==Number(clock.session_epoch))return unknown;
 const age=Number(at)-Number(observed);if(age< -5||age>maxAgeMs)return unknown;
 // All fields belong to the same engine snapshot. Compensate its device-clock
 // anchor with the native delivery floor while freshness uses raw arrival age.
 const anchorAt=finite(anchor?.anchorAt)?Number(anchor.anchorAt):Number(observed),deviceElapsed=Math.max(0,(Number(at)-anchorAt)/1000);
 const cycle=Number(receipt.cycle_duration_sec),elapsed=Number(clock.audio_device_sample)/Number(clock.sample_rate)+deviceElapsed-Math.max(0,Number(heardLagSec)||0)-Number(start);
 // A scheduler program can implement a finite repeated preview. Its active
 // flag must not turn an explicitly bounded request into endless playback.
 if(finiteRepeats&&!positive(receipt.duration_sec)&&!positive(receipt.repeat_count))return unknown;
 const loop=receipt.preview_program_active===true&&!finiteRepeats,repeats=positive(receipt.repeat_count)?Number(receipt.repeat_count):1,duration=positive(receipt.duration_sec)?Number(receipt.duration_sec):cycle*repeats;
 const ended=!loop&&elapsed>=duration,phase=mod(Math.max(0,elapsed)+(Number(receipt.phase_offset_sec)||0),cycle),seconds=ended?duration:phase;
 return {seconds,beat:seconds*Number(bpm)/60,patternBeat:seconds*Number(bpm)/60,playing:!ended,previewing:true,previewClockAvailable:true,clockAvailable:true,clockSource:'pattern-preview-audio-device',clockAgeMs:Math.max(0,age),bpm,previewElapsedSec:Math.max(0,elapsed),previewEnded:ended,pendingStart:elapsed<0,loopEnabled:loop,loopStartSec:0,loopEndSec:loop?cycle:duration,heardLagSec:Math.max(0,Number(heardLagSec)||0)};
}
