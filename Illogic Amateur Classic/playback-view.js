/** Map the audible song cursor into the selected pattern's actual placement cycle. */
import {patternLengthBeats,patternLoopPhaseBeats} from './pattern-preview.js';
const positive=(value,fallback)=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):fallback;
const mod=(value,length)=>((value%length)+length)%length;
export function patternPlaybackAt(project,patternId,tick,{mode='song',previewPatternId,selectedClipId}={}){
 const inactive={active:false,beat:null,step:-1,clipId:null};
 const pattern=project.patterns?.find(p=>p.id===patternId);
 if(!pattern||!tick?.playing||tick.clockAvailable===false||tick.beat==null||!Number.isFinite(Number(tick.beat)))return inactive;
 const length=patternLengthBeats(pattern),beat=Number(tick.beat);
 if(mode==='pattern'||tick.previewing){
  if(tick.previewClockAvailable===false||previewPatternId&&previewPatternId!==patternId)return inactive;
  const phase=mod(Number(tick.patternBeat??beat),length);return{active:true,beat:phase,step:Math.floor(phase*4),clipId:null,cycleBeats:length};
 }
 const candidates=(project.clips||[]).filter(c=>c.patternId===patternId&&!c.muted&&!c.cloudRaw?.muted&&!(project.mutedTracks||[]).includes(c.track)&&beat>=Number(c.start)&&beat<Number(c.start)+Number(c.length));
 const clip=candidates.find(c=>c.id===selectedClipId)||candidates[0];if(!clip)return inactive;
 const raw=clip.cloudRaw||{},msToBeat=positive(tick.bpm,positive(project.bpm,120))/60000;
 const base=positive(raw.durationMs??raw.duration_ms,length/msToBeat)*msToBeat;
 const loop=positive(raw.loopDurationMs??raw.loop_duration_ms,base/msToBeat)*msToBeat;
 const offset=Math.max(0,Number(raw.offsetMs??raw.offset_ms)||0)*msToBeat;
 const tiled=positive(raw.windowMs??raw.window_ms,0)>0;
 const cycle=tiled?(loop<base-.002?loop:Math.max(50*msToBeat,base-offset)):base;
 const loopPhase=patternLoopPhaseBeats(raw,{base,loop,offset,msToBeat});
 if(loopPhase===null)return{...inactive,phaseSupported:false};
 const scale=Math.max(base,loop)/length;
 // Native tiled windows trim the start of each tile. Their source offset is
 // added after choosing the tile phase; putting it inside modulo wraps early.
 const relative=beat-Number(clip.start),phase=(tiled?mod(relative+loopPhase,cycle)+offset:mod(relative+offset+loopPhase,cycle))/scale;
 return{active:true,beat:phase,step:Math.floor(phase*4),clipId:clip.id,cycleBeats:cycle,overlapping:candidates.length>1,phaseSupported:true};
}
