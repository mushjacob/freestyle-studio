/** Pure horizontal time-shift policy. No audio processing or cloud calls.
 * Audacity 3.2.1 commit 969e36f4968e66375a794a938dd906a3556e0bbc:
 * src/tracks/ui/TimeShiftHandle.cpp:Click/FindDesiredSlideAmount/DoSlideHorizontal;
 * src/tracks/playabletrack/wavetrack/ui/WaveTrackShifter.cpp:HitTest,
 * SelectInterval, QuantizeOffset; src/WaveTrack.cpp:CanOffsetClips/GetIntervals;
 * src/Snap.cpp:Find/SnapToPoints; src/Snap.h:kPixelTolerance;
 * libraries/lib-screen-geometry/ZoomInfo.cpp:TimeToPosition.
 * https://github.com/audacity/audacity/tree/969e36f4968e66375a794a938dd906a3556e0bbc
 *
 * Internal DTOs use the published batch timing names. Tracks/clips must be a
 * complete canonical snapshot. Preserve supplied native interval order; native
 * CapturedInterval chooses its first moving interval, not necessarily the hit.
 * A lane represents one validated linked channel group, never inferred mono.
 */
import {assertCompleteCanonicalData} from './cloud-session.js';
import {assertAutomationJsonValue} from './audacity-automation-contract.js';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 64;
const clone = value => structuredClone(value);
const start = clip => clip.start_ms / 1000;
const end = clip => start(clip) + clip.duration_sec;
function fail(message, reason = 'unsupported_group_move') { throw Object.assign(new Error(message), {code:'GROUP_MOVE_UNSUPPORTED',reason}); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function samples(time, rate) {
 const result = Math.floor(time * rate + .5);
 if (!Number.isSafeInteger(result)) fail('The group selection exceeds exact sample-frame indexing.');
 return result;
}
/** C rint under the native default nearest/ties-even rounding mode. */
export function nativeMoveRint(value) {
 if (!finite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) fail('The group move exceeds exact sample-frame precision.');
 const lower = Math.floor(value), fraction = value - lower;
 const result = fraction < .5 ? lower : fraction > .5 ? lower + 1 : lower % 2 === 0 ? lower : lower + 1;
 return result === 0 && value < 0 ? -0 : result;
}
function timing(clip) { return {start_ms:clip.start_ms,duration_sec:clip.duration_sec,audio_offset_sec:clip.audio_offset_sec}; }
function audioTrack(track) {
 if (track.kind !== 'audio' || !Number.isSafeInteger(track.sampleRate) || track.sampleRate <= 0 || !Number.isSafeInteger(track.channelCount) || track.channelCount < 1 || track.channelCount > 256) fail('Moving tracks require an actual audio sample rate and linked channel layout.');
 if (track.clips.some(clip => clip.patternId || clip.kind === 'pattern' || clip.sampleRate !== track.sampleRate || clip.channelCount !== track.channelCount || !finite(clip.audio_offset_sec) || clip.audio_offset_sec < 0)) fail('Mixed patterns, rates, source offsets or source channel layouts cannot be moved as one native audio track.');
}

/** Capture native membership once, before previewing a drag.
 * tracks: [{laneId,kind,sampleRate,channelCount,clips:[{id,start_ms,
 * duration_sec,audio_offset_sec,sampleRate,channelCount,...canonicalFields}]}].
 * Non-audio/fixed tracks may supply canonical intervals for snapping, but can
 * never become moving tracks. Shift intentionally works without a hit clip.
 */
export function captureNativeGroupMove({tracks,capturedLaneId,capturedClipId,clickSec,selection,selectedLaneIds = [],shift = false,syncLocked = false} = {}) {
 assertCompleteCanonicalData(tracks, 'group move tracks'); assertAutomationJsonValue(tracks);
 if (!Array.isArray(tracks) || !identity(capturedLaneId) || !finite(clickSec) || clickSec < 0 || typeof shift !== 'boolean' || typeof syncLocked !== 'boolean') fail('Capture a complete canonical audio track and finite click time.');
 if (syncLocked) fail('Sync-lock propagation requires a canonical group model before group movement.');
 if (!selection || !finite(selection.start) || !finite(selection.end) || selection.start < 0 || selection.end < selection.start) fail('Capture an ordered finite audio selection.');
 const lanes = new Set(), ids = new Set();
 for (const track of tracks) {
  if (!identity(track.laneId) || lanes.has(track.laneId) || !Array.isArray(track.clips)) fail('Group movement needs unique persisted lanes and complete clip lists.');
  lanes.add(track.laneId);
  for (const clip of track.clips) {
   if (!identity(clip.id) || ids.has(clip.id) || !finite(clip.start_ms) || clip.start_ms < 0 || !finite(clip.duration_sec) || clip.duration_sec <= 0 || clip.audio_offset_sec !== undefined && (!finite(clip.audio_offset_sec) || clip.audio_offset_sec < 0) || !finite(end(clip))) fail('Group movement needs unique durable clips with exact canonical timing and source offsets.');
   if (clip.lane_id !== undefined && clip.lane_id !== track.laneId || clip.laneId !== undefined && clip.laneId !== track.laneId) fail('A canonical clip belongs to another lane.');
   ids.add(clip.id);
  }
 }
 if (!Array.isArray(selectedLaneIds) || new Set(selectedLaneIds).size !== selectedLaneIds.length || selectedLaneIds.some(id => !lanes.has(id))) fail('The selected lane identities are stale or ambiguous.');
 const captured = tracks.find(track => track.laneId === capturedLaneId);
 if (!captured) fail('The captured audio lane no longer exists.');
 if (shift && captured.kind === 'audio' && captured.clips.length === 0) return freeze(clone({tracks,capturedLaneId,hitClipId:null,mode:'track',moving:[],movingSelection:false,selection,bounds:{start:0,end:0},preferRight:false,empty:true}));
 audioTrack(captured);
 let mode = 'track', hit = null;
 if (!shift) {
  const hits = captured.clips.filter(clip => start(clip) <= clickSec && clickSec < end(clip));
  if (hits.length !== 1 || capturedClipId !== undefined && hits[0].id !== capturedClipId) fail('Click a unique canonical audio clip before moving a selection.');
  hit = hits[0];
  mode = selectedLaneIds.includes(capturedLaneId) && clickSec >= selection.start && clickSec < selection.end ? 'selection' : 'clip';
 }
 const moving = [];
 for (const track of tracks) {
  const selected = mode === 'track' || mode === 'clip' ? track === captured : selectedLaneIds.includes(track.laneId);
  // An empty selected audio lane contributes no moving interval. Its source
  // rate/channel layout is legitimately unknown; keep it selected without
  // inventing audio metadata solely to validate a zero-interval lane.
  if (!selected || track.kind === 'audio' && track.clips.length === 0) continue;
  audioTrack(track);
  const chosen = track.clips.filter(clip => mode === 'track' || mode === 'clip' && clip === hit || mode === 'selection' && samples(selection.start,track.sampleRate) < samples(end(clip),track.sampleRate) && samples(selection.end,track.sampleRate) > samples(start(clip),track.sampleRate));
  for (const clip of chosen) moving.push({laneId:track.laneId,clipId:clip.id});
 }
 if (moving.length > 256) fail('An atomic group move supports at most 256 clips; no smaller subset will be sent.','batch_limit');
 if (hit && !moving.some(item => item.clipId === hit.id)) fail('The sample-rounded selection does not contain the clicked clip.');
 const movingIds = new Set(moving.map(item => item.clipId));
 const capturedInterval = mode === 'track' ? null : captured.clips.find(clip => movingIds.has(clip.id));
 const bounds = capturedInterval ? {start:start(capturedInterval),end:end(capturedInterval)} : {start:captured.clips.length ? Math.min(...captured.clips.map(start)) : 0,end:captured.clips.length ? Math.max(...captured.clips.map(end)) : 0};
 return freeze(clone({tracks,capturedLaneId,hitClipId:hit?.id ?? null,mode,moving,movingSelection:mode === 'selection',selection,bounds,preferRight:!!capturedInterval && Math.abs(clickSec-bounds.end) < Math.abs(clickSec-bounds.start)}));
}

function snappedPoint(candidates, laneId, time, position) {
 const pixelDiff = index => Math.abs(position(time)-position(candidates[index].time));
 let lo = 0, hi = candidates.length;
 while (hi > lo + 1) { const mid = Math.floor((lo+hi)/2); if (time < candidates[mid].time) hi = mid; else lo = mid; }
 let index = lo, next = index + 1;
 while (next + 1 < candidates.length && candidates[next].time === candidates[index].time) next++;
 if (next < candidates.length && pixelDiff(next) < pixelDiff(index)) index = next;
 if (pixelDiff(index) >= 4) return null;
 let left = index, right = index;
 while (left > 0 && pixelDiff(left-1) < 4) left--;
 while (right + 1 < candidates.length && pixelDiff(right+1) < 4) right++;
 if (left === right) return candidates[index].time;
 const same = candidates.slice(left,right+1).filter(point => point.laneId === laneId);
 if (same.length === 1) return same[0].time;
 if (candidates[right].time-candidates[left].time < 1/44100) return candidates[left].time;
 return null;
}

/** Native final-position collision policy, not swept-path obstacle avoidance. */
export function nativeMoveAllowedOffset(clips, movingIds, amount) {
 let allowed = amount;
 const moving = clips.filter(clip => movingIds.has(clip.id)), fixed = clips.filter(clip => !movingIds.has(clip.id));
 for (const other of fixed) for (const clip of moving) {
  if (start(other) < end(clip)+amount && end(other) > start(clip)+amount) {
   if (amount > 0) allowed = Math.max(0, Math.min(allowed,start(other)-end(clip)));
   else allowed = Math.min(0, Math.max(allowed,end(other)-start(clip)));
  }
 }
 if (allowed !== amount && fixed.some(other => moving.some(clip => start(other) < end(clip)+allowed && end(other) > start(clip)+allowed))) return 0;
 return allowed;
}

/** Native-reference timing intentions in batch-shaped DTOs, not a cloud
 * dispatch plan. Only native rint, point snapping and collision reduction adjust
 * this desired delta. The live cloud controller must use planCloudGroupMove for
 * its whole-ms persisted grid and complete forward/inverse timing fields.
 */
export function planNativeGroupMove(capture,{deltaSec,pixelsPerSecond,leftSec = 0,destinationLaneId = capture?.capturedLaneId} = {}) {
 if (!capture || !Array.isArray(capture.tracks) || !finite(deltaSec) || !finite(pixelsPerSecond) || pixelsPerSecond <= 0 || !finite(leftSec) || leftSec < 0) fail('A group move needs a captured native interval and finite viewport geometry.');
 if (destinationLaneId !== capture.capturedLaneId) fail('Atomic cross-lane group movement and native migration resampling need an additional engine contract.','vertical_migration');
 const captured = capture.tracks.find(track => track.laneId === capture.capturedLaneId), movingIds = new Set(capture.moving.map(item => item.clipId));
 let amount = capture.mode === 'track' ? deltaSec : nativeMoveRint(deltaSec*captured.sampleRate)/captured.sampleRate;
 const quantizedDeltaSec = amount, candidates = [{time:0,laneId:null}];
 if (capture.mode !== 'track') for (const track of capture.tracks) for (const clip of track.clips) if (!movingIds.has(clip.id)) {
  candidates.push({time:start(clip),laneId:track.laneId}); if (start(clip) !== end(clip)) candidates.push({time:end(clip),laneId:track.laneId});
 }
 candidates.sort((a,b) => a.time-b.time);
 const position = time => { const pixel = Math.floor(.5+pixelsPerSecond*(time-leftSec)); if (!Number.isSafeInteger(pixel)) fail('The snap viewport exceeds exact native pixel indexing.'); return pixel; };
 const left = capture.bounds.start+amount, right = capture.bounds.end+amount;
 let snapLeft = snappedPoint(candidates,capture.capturedLaneId,left,position), snapRight = snappedPoint(candidates,capture.capturedLaneId,right,position);
 if (snapLeft !== null && snapLeft !== left && snapRight !== null && snapRight !== right) { if (capture.preferRight) snapLeft = null; else snapRight = null; }
 let snap = null;
 if (snapLeft !== null && snapLeft !== left) { amount += snapLeft-left; snap = {edge:'left',timeSec:snapLeft}; }
 else if (snapRight !== null && snapRight !== right) { amount += snapRight-right; snap = {edge:'right',timeSec:snapRight}; }
 if (capture.mode !== 'track') {
  let previous, passes = 0;
  do {
   previous = amount;
   for (const track of capture.tracks) {
    const adjusted = nativeMoveAllowedOffset(track.clips,movingIds,amount);
    if (adjusted !== amount) { amount = adjusted; snap = null; }
    if (amount === 0) break;
   }
   if (++passes > 100000) fail('The native collision constraints did not converge.');
  } while (amount !== previous);
 }
 const before = [], after = [], ops = [], inverseOps = [];
 for (const track of capture.tracks) for (const clip of track.clips) if (movingIds.has(clip.id)) {
  const next = {...clone(clip),start_ms:amount===0?clip.start_ms:(start(clip)+amount)*1000};
  if (!finite(next.start_ms) || next.start_ms < 0) fail('Moving audio before time zero is not supported by the published batch contract.','negative_timeline');
  before.push(clone(clip)); after.push(next);
  if (amount !== 0) { ops.push({op:'update',id:clip.id,start_ms:next.start_ms,expected:timing(clip)}); inverseOps.push({op:'update',id:clip.id,start_ms:clip.start_ms,expected:timing(next)}); }
 }
 const selection = capture.movingSelection ? {start:capture.selection.start+amount,end:capture.selection.end+amount} : clone(capture.selection);
 if (selection.start < 0 || !finite(selection.start) || !finite(selection.end)) fail('The moved selection cannot be represented in the nonnegative timeline.','negative_selection');
 return {request:{deltaSec,pixelsPerSecond,leftSec,destinationLaneId},mode:capture.mode,deltaSec:amount,quantizedDeltaSec,movingSelection:capture.movingSelection,selection,before,after,ops,inverseOps,snap,noOp:!ops.length};
}

/** Freestyle's persisted clip-start grid is whole milliseconds. Keep the native
 * plan available above as a reference, but present/commit one shared integer-ms
 * shift rather than asking the server to discard sample-precision placement.
 * Recheck collisions after grid conversion; source duration/offset are retained
 * exactly. Full timing updates are required by the live batch implementation.
 */
export function planCloudGroupMove(capture,request) {
 const native=planNativeGroupMove(capture,request),movingIds=new Set(capture.moving.map(item=>item.clipId));
 for(const track of capture.tracks)for(const clip of track.clips)if(movingIds.has(clip.id)&&!Number.isSafeInteger(clip.start_ms))fail('The cloud group needs canonical whole-millisecond clip starts before moving.','persistence_grid');
 let deltaMs=Math.round(native.deltaSec*1000);if(!Number.isSafeInteger(deltaMs))fail('The cloud move exceeds exact whole-millisecond placement.','persistence_grid');
 if(deltaMs===0)deltaMs=0;const quantizedDeltaSec=deltaMs/1000;
 if(capture.mode!=='track'){
  let previous,passes=0;
  do{
   previous=deltaMs;
   for(const track of capture.tracks){const desired=deltaMs/1000,allowed=nativeMoveAllowedOffset(track.clips,movingIds,desired);if(allowed!==desired)deltaMs=allowed>0?Math.floor(allowed*1000):Math.ceil(allowed*1000);if(deltaMs===0)break;}
   if(++passes>100000)fail('The cloud placement-grid collision constraints did not converge.');
  }while(deltaMs!==previous);
 }
 const before=[],after=[],ops=[],inverseOps=[],amount=deltaMs/1000;
 for(const track of capture.tracks)for(const clip of track.clips)if(movingIds.has(clip.id)){
  const startMs=clip.start_ms+deltaMs;if(!Number.isSafeInteger(startMs)||startMs<0)fail('Moving audio before time zero is not supported by the published batch contract.','negative_timeline');
  const next={...clone(clip),start_ms:startMs};before.push(clone(clip));after.push(next);
  if(deltaMs!==0){ops.push({op:'update',id:clip.id,...timing(next),expected:timing(clip)});inverseOps.push({op:'update',id:clip.id,...timing(clip),expected:timing(next)});}
 }
 const selection=capture.movingSelection?{start:capture.selection.start+amount,end:capture.selection.end+amount}:clone(capture.selection);
 if(selection.start<0||!finite(selection.start)||!finite(selection.end))fail('The moved selection cannot be represented in the nonnegative timeline.','negative_selection');
 return {...native,persistenceGridMs:1,nativeDeltaSec:native.deltaSec,deltaSec:amount,quantizedDeltaSec,selection,before,after,ops,inverseOps,snap:amount===native.deltaSec?native.snap:null,noOp:!ops.length};
}
