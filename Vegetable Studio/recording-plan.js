/** FL recording count-in ("Countdown before recording", T05) and punch in/out (R03).
 *
 * Both are client-driven on the live-ingest path (docs/ENGINE_SPEC_REMAINING.md
 * section 4.2/4.3): the engine metronome plays through the transport, the take
 * only starts when the engine clock reaches the record point (mic audio before
 * that is never captured; capture time zero is the take start, and every sync
 * carries an exact {capture, song} pair so a late take_start moves nothing).
 * Punch keeps only the selection: take_stop is sent at the punch-out with the
 * exact song/capture end, and the saved clip is trimmed to [in, out] at
 * placement (`punchTrimOps`), so the rest of the take is discarded.
 * Everything here is pure; the engine calls are injected.
 */
export const COUNTDOWN_BARS=[1,2,4],DEFAULT_COUNTDOWN_BARS=2,MIN_PUNCH_SEC=0.1,MIN_TRIMMED_SEC=0.02;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const fail=(message,code='recording_plan_invalid',extra={})=>Object.assign(new Error(message),{code},extra);

/** Stored option -> {enabled, bars}; unknown bar counts fall back to FL's default of 2. */
export function normalizeCountdown(value){
 const bars=Number(value?.bars);
 return{enabled:value?.enabled===true,bars:COUNTDOWN_BARS.includes(bars)?bars:DEFAULT_COUNTDOWN_BARS};
}

/** The pre-roll before `startBeat`: N bars of `beatsPerBar` quarter-note beats, clamped at the song start.
 * `beatToSeconds` goes through the timing map, so tempo changes inside the pre-roll are honoured.
 * Returns {seekSec, recordSec, prerollBeats, prerollSec, bars, clamped}. */
export function countInPlan({startBeat,startSec,bars,beatsPerBar=4,beatToSeconds}){
 if(!finite(startBeat)||startBeat<0||!finite(startSec)||startSec<0)throw fail('The recording position is not known.');
 if(!COUNTDOWN_BARS.includes(bars))throw fail('Countdown is 1, 2 or 4 bars.');
 const perBar=finite(beatsPerBar)&&beatsPerBar>0?beatsPerBar:4,wanted=bars*perBar,prerollBeats=Math.min(wanted,startBeat);
 const seekSec=prerollBeats>0?Math.max(0,Number(beatToSeconds(startBeat-prerollBeats))):startSec;
 if(!finite(seekSec))throw fail('The timing map did not return the countdown start.');
 const clamped=Math.min(seekSec,startSec);
 return{seekSec:clamped,recordSec:startSec,prerollBeats,prerollSec:startSec-clamped,bars,clamped:prerollBeats<wanted};
}

/** A Playlist time selection {startSec,endSec} -> punch range, or throws. */
export function punchRange(selection){
 const inSec=Number(selection?.startSec),outSec=Number(selection?.endSec);
 if(!finite(inSec)||!finite(outSec)||inSec<0||outSec-inSec<MIN_PUNCH_SEC)throw fail('Punch needs a Playlist time selection of at least 0.1 s: right-drag the Playlist ruler to set one.','punch_range_missing');
 return{inSec,outSec};
}

/** Where playback starts for a punch pass. A playhead already before the punch-in rolls from where it is;
 * with a countdown on, the song rolls from `prerollSec` before the punch-in. */
export function punchPlan({inSec,outSec,playheadSec,prerollSec=0}){
 const range=punchRange({startSec:inSec,endSec:outSec});
 if(!finite(playheadSec)||playheadSec<0)throw fail('The recording position is not known.');
 if(playheadSec>=range.outSec)throw fail('The playhead is already past the punch-out. Move it before the selection.','punch_playhead_past');
 const inside=playheadSec>=range.inSec,seekSec=inside||!(prerollSec>0)?playheadSec:Math.max(0,range.inSec-prerollSec);
 return{...range,seekSec,recordSec:inside?playheadSec:range.inSec,inside};
}

/** Combine the two (`startBeat` is the beat of the punch-in when punching, else of the playhead; `startSec` is always the playhead): with punch the record point is the punch-in; the countdown pre-roll still precedes it. */
export function recordingPlan({countdown,punch,startBeat,startSec,beatsPerBar,beatToSeconds,playing=false}){
 const count=normalizeCountdown(countdown);
 if(punch){
  const roll=count.enabled&&!playing?countInPlan({startBeat:Math.max(0,startBeat),startSec:punch.inSec,bars:count.bars,beatsPerBar,beatToSeconds}).prerollSec:0;
  const plan=punchPlan({inSec:punch.inSec,outSec:punch.outSec,playheadSec:startSec,prerollSec:roll});
  return{kind:'punch',...plan,metronome:count.enabled&&!playing&&plan.seekSec<plan.recordSec,roll:!playing,clamped:false};
 }
 if(count.enabled&&!playing){
  const plan=countInPlan({startBeat,startSec,bars:count.bars,beatsPerBar,beatToSeconds});
  return{kind:'count-in',...plan,metronome:plan.prerollSec>0,roll:true,inSec:null,outSec:null};
 }
 return{kind:'plain',seekSec:null,recordSec:startSec,metronome:false,roll:false,inSec:null,outSec:null,clamped:false};
}

const defaultSleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** Resolve with the first engine-clock reading at or after `targetSec`. A reading only counts once the clock
 * has been seen before the target and playing (a stale pre-seek position can sit past it). */
export async function awaitSongPosition({read,targetSec,signal=null,pollMs=4,timeoutMs=30000,sleep=defaultSleep,now=()=>performance.now()}){
 const began=now();let sawBefore=false;
 for(;;){
  if(signal?.aborted)throw Object.assign(new Error('Recording was cancelled during the countdown.'),{name:'AbortError'});
  const reading=read();
  if(reading&&finite(reading.seconds)&&reading.playing!==false){
   if(reading.seconds<targetSec)sawBefore=true;
   else if(sawBefore)return reading;
  }
  if(now()-began>timeoutMs)throw fail('The countdown never reached the record point. Check that playback is running.','countdown_timeout');
  await sleep(pollMs);
 }
}

/** Run the pre-roll for a `recordingPlan`: metronome on, seek and play, wait for the record point, then put the
 * metronome back. Returns {songStartSec}. On any failure the metronome is restored and `stopTransport` runs. */
export async function runPreroll({plan,readSong,seekAndPlay,setMetronome,metronomeWas=false,stopTransport=async()=>{},signal=null,sleep,now,pollMs,timeoutMs}){
 if(plan.kind==='plain'||!plan.roll)return plan.inSec!==null?waitForPunchIn({plan,readSong,signal,sleep,now,pollMs,timeoutMs}):{songStartSec:plan.recordSec};
 let clickOn=false;
 try{
  if(plan.metronome&&!metronomeWas){await setMetronome(true);clickOn=true;}
  await seekAndPlay(plan.seekSec);
  if(plan.seekSec>=plan.recordSec)return{songStartSec:plan.recordSec};
  const reading=await awaitSongPosition({read:readSong,targetSec:plan.recordSec,signal,sleep,now,pollMs,timeoutMs});
  if(clickOn){clickOn=false;Promise.resolve(setMetronome(false)).catch(()=>{});}
  return{songStartSec:reading.seconds};
 }catch(error){
  if(clickOn)await Promise.resolve(setMetronome(false)).catch(()=>{});
  await Promise.resolve(stopTransport()).catch(()=>{});
  throw error;
 }
}
/** Issue #21: the engine's own count-in. `play` with count_in_beats (1–16) clicks the beats (also with the metronome off)
 * and starts the stopped transport one beat after the last click, at seek_seconds; no timeline before it is needed, so a
 * take at bar 1 gets its full count-in. The body for a count-in plan, or null when the plan has none. */
export function engineCountInBody(plan,{bars,beatsPerBar=4}={}){
 if(plan?.kind!=='count-in'||!finite(plan.recordSec)||plan.recordSec<0)return null;
 const perBar=finite(beatsPerBar)&&beatsPerBar>0?beatsPerBar:4,beats=Math.round((COUNTDOWN_BARS.includes(bars)?bars:DEFAULT_COUNTDOWN_BARS)*perBar);
 return{count_in_beats:Math.max(1,Math.min(16,beats)),seek_seconds:plan.recordSec,wait:true};
}
/** Run that count-in: resolves {songStartSec} on the downbeat (the reply's start_position_seconds). 409 count_in_cancelled /
 * transport_rolling / recording_in_progress are passed through as they are. */
export async function runEngineCountIn({body,play,signal=null}){
 if(signal?.aborted)throw Object.assign(new Error('Recording was cancelled during the countdown.'),{name:'AbortError'});
 const reply=await play(body),response=reply?.response??reply;
 if(signal?.aborted)throw Object.assign(new Error('Recording was cancelled during the countdown.'),{name:'AbortError'});
 if(response?.transport_started===false)throw fail('The count-in finished but Freestyle did not start the transport.','count_in_not_started');
 const start=Number(response?.start_position_seconds??response?.position_seconds);
 return{songStartSec:finite(start)&&start>=0?start:body.seek_seconds,countIn:{beats:response?.count_in_beats??body.count_in_beats,bpm:response?.count_in_bpm??null}};
}
async function waitForPunchIn({plan,readSong,signal,sleep,now,pollMs,timeoutMs}){
 // Already rolling: wait for the clock to reach the punch-in (no wait when it is inside the range).
 const first=readSong();if(first&&finite(first.seconds)&&first.seconds>=plan.recordSec)return{songStartSec:Math.max(first.seconds,plan.recordSec)};
 const reading=await awaitSongPosition({read:readSong,targetSec:plan.recordSec,signal,sleep,now,pollMs,timeoutMs});
 return{songStartSec:reading.seconds};
}

/** The capture-time of song position `songSec`, given the take's capture start and a live (capture, song) pair. */
export function captureAtSong({songSec,captureNowSec,songNowSec}){
 if(![songSec,captureNowSec,songNowSec].every(finite))return null;
 return Math.max(0,captureNowSec-(songNowSec-songSec));
}

/** Clip window kept after a punch. `clip` = {startMs,durationSec,audioOffsetSec}. Returns null when nothing
 * falls inside [in, out] (the take is left alone), or when no trim is needed (`unchanged`). */
export function punchTrimWindow(clip,{inSec,outSec}){
 if(!clip||!finite(clip.startMs)||!finite(clip.durationSec)||clip.durationSec<=0)return null;
 const base=clip.audioOffsetSec||0,start=clip.startMs/1000,end=start+clip.durationSec;
 const keepStart=Math.max(start,inSec),keepEnd=Math.min(end,outSec);
 if(keepEnd-keepStart<MIN_TRIMMED_SEC)return null;
 if(keepStart===start&&keepEnd===end)return{unchanged:true};
 return{start_ms:Math.round(keepStart*1000),audio_offset_sec:base+(keepStart-start),duration_sec:keepEnd-keepStart,unchanged:false};
}

/** applyClipBatch update op that trims the saved clip to the punch range. */
export function punchTrimOps(clip,range){
 const window=punchTrimWindow(clip,range);
 if(!window||window.unchanged)return null;
 const{unchanged,...fields}=window;
 return[{op:'update',id:clip.id,...fields,expected:{start_ms:clip.startMs,duration_sec:clip.durationSec,audio_offset_sec:clip.audioOffsetSec||0}}];
}

/** Trim the uploaded take to the punch range (one batch, newest state reloaded by the caller). */
export async function trimTakeToPunch(client,{projectId,clip,range,trackId=null}){
 if(typeof client?.call!=='function')throw fail('Punch trimming needs the Studio API client.','punch_unavailable');
 const ops=punchTrimOps(clip,range);if(!ops)return{trimmed:false};
 const scope=typeof trackId==='string'&&trackId?{track_id:trackId}:{};
 await client.call('applyClipBatch',{path:{project_id:projectId},body:{ops,...scope}},{idempotencyKey:globalThis.crypto.randomUUID()});
 return{trimmed:true,window:ops[0]};
}
