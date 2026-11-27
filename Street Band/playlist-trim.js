/** Immutable left-edge trim in normalized beat coordinates. No cloud writes. */
import {patternLengthBeats,patternLoopPhaseBeats} from './pattern-preview.js';
import {placementTiming} from './playlist-edits.js';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const near=(a,b)=>Math.abs(a-b)<=Number.EPSILON*16*Math.max(1,Math.abs(a),Math.abs(b));
const mod=(value,length)=>((value%length)+length)%length;
const failure=(message,code='playlist_trim_unavailable')=>Object.assign(new Error(message),{code});
function writeTiming(raw,timing){const next={...raw,...timing};for(const[alias,key]of [['duration_ms','durationMs'],['loop_duration_ms','loopDurationMs'],['offset_ms','offsetMs'],['repeat_count','repeatCount'],['window_ms','windowMs'],['loop_phase_ms','loopPhaseMs']])if(Object.hasOwn(raw,alias)&&Object.hasOwn(timing,key))next[alias]=timing[key];return next;}
/** Snap the gesture delta, preserving off-grid source/start coordinates. Compute
 * every pointer sample from the gesture's original clip, never from a prior trim.
 * Pattern phases use the same verified native formula as playback-view.
 */
export function trimPlaylistClipStart(clip,{deltaBeats=0,snapBeats=.25,bpm=120,minLengthBeats,pattern}={}){
 if(!clip||!finite(clip.start)||clip.start<0||!finite(clip.length)||clip.length<=0||!finite(deltaBeats)||!finite(snapBeats)||snapBeats<0||!finite(bpm)||bpm<=0||minLengthBeats!==undefined&&(!finite(minLengthBeats)||minLengthBeats<=0))throw failure('Left trim needs the clip’s exact timing, a positive tempo and a valid snap.','playlist_trim_invalid_input');
 const minimum=minLengthBeats??.001*bpm/60,requested=snapBeats>0?Math.round(deltaBeats/snapBeats)*snapBeats:deltaBeats;
 if(requested===0)return clip;
 let lower=-clip.start,upper=Math.max(0,clip.length-minimum);
 if(!clip.patternId){
  if(clip.offsetKnown!==true||!finite(clip.offset)||clip.offset<0)throw failure('Freestyle has not exposed this audio clip’s source offset. Reload its audio state before trimming the left edge.','playlist_trim_offset_unknown');
  if(Object.hasOwn(clip,'sourceLength')&&(!finite(clip.sourceLength)||clip.sourceLength<0||clip.offset+clip.length>clip.sourceLength+1e-8))throw failure('The audio clip’s saved span exceeds its known source bounds. Reload its audio timing before trimming.');
  lower=Math.max(lower,-clip.offset);const delta=Math.max(lower,Math.min(upper,requested));if(delta===0)return clip;
  return{...clip,start:clip.start+delta,length:clip.length-delta,offset:clip.offset+delta};
 }
 if(pattern&&pattern.id!==clip.patternId)throw failure('Select this placement’s actual pattern before trimming its left edge.');
 const raw=clip.cloudRaw||{},duration=raw.durationMs??raw.duration_ms;
 for(const[field,value]of [['duration',duration],['loop duration',raw.loopDurationMs??raw.loop_duration_ms],['source offset',raw.offsetMs??raw.offset_ms]])if(value!==undefined&&value!==null&&(!finite(value)||value<(field==='source offset'?0:Number.MIN_VALUE)))throw failure('Reload the pattern placement’s exact cycle and source offset before trimming.');
 if(clip.cloudId&&(raw.offsetMs??raw.offset_ms)==null)throw failure('Freestyle has not exposed this pattern placement’s source offset. Reload its placement timing before trimming.','playlist_trim_offset_unknown');
 if((duration===undefined||duration===null)&&!pattern)throw failure('Reload the pattern’s canonical cycle timing before trimming its left edge.');
 if(pattern&&(!finite(patternLengthBeats(pattern))||patternLengthBeats(pattern)<=0))throw failure('Reload the pattern’s canonical length before trimming.');
 const project={bpm,patterns:pattern?[pattern]:[]},timing=placementTiming(clip,project),msToBeat=bpm/60000,msPerBeat=1/msToBeat,base=timing.durationMs*msToBeat,loop=timing.loopDurationMs*msToBeat,offset=timing.offsetMs*msToBeat;
 if(![timing.durationMs,timing.loopDurationMs].every(value=>finite(value)&&value>0)||!finite(timing.offsetMs)||timing.offsetMs<0)throw failure('Reload the pattern placement’s exact cycle and source offset before trimming.');
 const phase=patternLoopPhaseBeats(raw,{base,loop,offset,msToBeat});if(phase===null)throw failure('This placement combines source trimming with a loop phase that Freestyle has not exposed completely. Its left edge cannot be changed without guessing.','playlist_trim_phase_unsupported');
 // An untiled legacy offset is a single absolute source displacement. Keep its
 // mode and repeat count: incrementing the offset also shortens its total span.
 const legacy=timing.windowMs===null&&(offset>0||!near(loop,base));
 if(legacy)lower=Math.max(lower,-offset);
 const delta=Math.max(lower,Math.min(upper,requested));if(delta===0)return clip;
 const next={...clip,start:clip.start+delta,length:clip.length-delta};let changed;
 if(legacy){
  const offsetMs=timing.offsetMs+delta*msPerBeat,span=timing.durationMs*timing.repeatCount-offsetMs;
  if(!near(span,next.length*msPerBeat))throw failure('The saved legacy pattern span does not match its source offset. Reload its placement timing before trimming.');
  changed={...timing,offsetMs,windowMs:null};
 }else if(offset===0&&near(loop,base)){
  // Atomic split receipts prove this phase/window combination, including cuts
  // through repeated cycles. Offset stays zero so source trimming is not mixed
  // into the tile modulo and the audible pitch/time scale stays unchanged.
  let loopPhaseMs=mod(timing.loopPhaseMs+delta*msPerBeat,timing.durationMs);if(near(loopPhaseMs,timing.durationMs)||near(loopPhaseMs,0))loopPhaseMs=0;
  const windowMs=next.length*msPerBeat;changed={...timing,loopPhaseMs,windowMs,repeatCount:Math.max(1,Math.ceil((windowMs+loopPhaseMs)/timing.durationMs-1e-9))};
 }else{
  const cycle=loop<base-.002?loop:Math.max(50*msToBeat,base-offset),advance=mod(delta,cycle);
  if(!near(advance,0)&&!near(advance,cycle))throw failure('This tiled source trim needs a phase inside a trimmed cycle. Freestyle has not exposed that combination; trim at a full cycle boundary.','playlist_trim_phase_unsupported');
  changed={...timing,windowMs:next.length*msPerBeat,repeatCount:Math.max(1,Math.ceil(next.length/cycle-1e-9))};
 }
 next.cloudRaw=writeTiming(raw,changed);return next;
}
/** FL edge hit zones: about 8 px at each clip edge resize instead of move.
 * Narrow clips keep a central move area (each zone at most a third of the
 * width, at least 2 px). Returns 'start' | 'end' | null. */
export const PLAYLIST_TRIM_EDGE_PX=8;
export function playlistTrimEdge({clientX,left,right,zonePx=PLAYLIST_TRIM_EDGE_PX}={}){
 if(![clientX,left,right,zonePx].every(finite)||right<=left)return null;
 const width=right-left,x=clientX-left;if(x<0||x>width)return null;
 const zone=Math.max(2,Math.min(zonePx,width/3));
 return width-x<=zone?'end':x<=zone?'start':null;
}
