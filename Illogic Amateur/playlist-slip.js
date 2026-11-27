/** FL Slip (S): move content with the pointer inside fixed clip boundaries.
 * Reference: Image-Line's official Playlist manual, Slip Edit tool.
 */
import {patternLoopPhaseBeats} from './pattern-preview.js';
import {placementTiming} from './playlist-edits.js';
const finite=value=>typeof value==='number'&&Number.isFinite(value),mod=(value,span)=>((value%span)+span)%span;
const near=(a,b)=>Math.abs(a-b)<=16*Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b));
const fail=(message,code='playlist_slip_unavailable')=>Object.assign(new Error(message),{code});
export function slipPlaylistClipContents(clip,{deltaBeats=0,snapBeats=.25,bpm=120,pattern}={}){
 if(!clip||!finite(clip.start)||clip.start<0||!finite(clip.length)||clip.length<=0||!finite(deltaBeats)||!finite(snapBeats)||snapBeats<0||!finite(bpm)||bpm<=0)throw fail('Slip needs the clip’s exact timing, a positive tempo and a valid snap.');
 const requested=snapBeats>0?Math.round(deltaBeats/snapBeats)*snapBeats:deltaBeats;if(requested===0)return clip;
 if(!clip.patternId){
  if(clip.offsetKnown!==true||!finite(clip.offset)||clip.offset<0)throw fail('Freestyle has not exposed this audio clip’s source offset. Reload its audio state before slipping its contents.','playlist_slip_offset_unknown');
  const bounded=Object.hasOwn(clip,'sourceLength');if(bounded&&(!finite(clip.sourceLength)||clip.sourceLength<0||clip.offset+clip.length>clip.sourceLength+1e-8))throw fail('Reload this audio clip’s complete source bounds before slipping its contents.');
  if(!bounded&&requested<0)throw fail('Freestyle has not exposed this audio file’s full length. Reload its source bounds before slipping toward later audio.','playlist_slip_source_length_unknown');
  const lower=bounded?clip.offset+clip.length-clip.sourceLength:0,delta=Math.max(lower,Math.min(clip.offset,requested));if(delta===0)return clip;const offset=clip.offset-delta;
  return{...clip,offset:near(offset,0)?0:offset};
 }
 if(pattern&&pattern.id!==clip.patternId)throw fail('Select this placement’s actual pattern before slipping its contents.');
 const raw=clip.cloudRaw||{},duration=raw.durationMs??raw.duration_ms,loopValue=raw.loopDurationMs??raw.loop_duration_ms,offsetValue=raw.offsetMs??raw.offset_ms;
 if(duration==null&&!pattern||duration!=null&&(!finite(duration)||duration<=0)||loopValue!=null&&(!finite(loopValue)||loopValue<=0)||offsetValue!=null&&(!finite(offsetValue)||offsetValue<0)||clip.cloudId&&offsetValue==null)throw fail('Reload this pattern placement’s canonical cycle and source offset before slipping its contents.');
 const project={bpm,patterns:pattern?[pattern]:[]},timing=placementTiming(clip,project),msToBeat=bpm/60000,base=timing.durationMs*msToBeat,loop=timing.loopDurationMs*msToBeat,offset=timing.offsetMs*msToBeat,phase=patternLoopPhaseBeats(raw,{base,loop,offset,msToBeat});
 if(phase===null)throw fail('This pattern’s source trim and phase are not fully exposed. Its contents cannot be slipped without guessing.','playlist_slip_phase_unsupported');
 const tiled=timing.windowMs!==null,cycle=tiled?(loop<base-.002?loop:Math.max(50*msToBeat,base-offset)):base,advance=mod(requested,cycle);
 if(near(advance,0)||near(advance,cycle))return clip;
 if(!near(loop,base)||tiled&&offset!==0)throw fail('Slipping inside this trimmed or shortened pattern cycle needs a phase combination Freestyle has not exposed.','playlist_slip_phase_unsupported');
 // Untiled offsets are absolute source displacement before modulo; translating
 // that into the verified untrimmed phase/window mode preserves the same cycle.
 const initialPhase=timing.loopPhaseMs+(tiled?0:timing.offsetMs),durationMs=timing.durationMs,windowMs=clip.length/msToBeat;
 let loopPhaseMs=mod(initialPhase-requested/msToBeat,durationMs);if(near(loopPhaseMs,0)||near(loopPhaseMs,durationMs))loopPhaseMs=0;
 const timingNext={...timing,offsetMs:0,loopPhaseMs,windowMs,repeatCount:Math.max(1,Math.ceil((windowMs+loopPhaseMs)/durationMs-1e-9))},cloudRaw={...raw,...timingNext};
 for(const[alias,key]of [['offset_ms','offsetMs'],['loop_phase_ms','loopPhaseMs'],['window_ms','windowMs'],['repeat_count','repeatCount']])if(Object.hasOwn(raw,alias))cloudRaw[alias]=timingNext[key];
 return{...clip,cloudRaw};
}
