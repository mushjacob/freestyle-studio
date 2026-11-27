/** Pure timeline-gesture math; clip edits are persisted by the cloud session. */
export const MIN_CLIP_DURATION_SEC=.001;
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/**
 * Project clip times are beats; pointer deltas and optional snap are seconds.
 * cloudRaw keeps its persisted metadata/identity. Only a pattern's source
 * offset changes here; the session serializer computes placement timing/routing
 * from normalized fields and the project's real target-lane map.
 */
export function computeClipGesture(clip,{bpm=120,pixelsPerSecond,deltaX=0,mode='move',targetTrack,targetLaneId,snapSeconds=0}={}) {
 if(!clip||typeof clip!=='object')throw new TypeError('Choose a cloud clip before dragging.');
 if(!finite(bpm)||Number(bpm)<=0)throw new RangeError('The project tempo must be finite and positive.');
 if(!finite(pixelsPerSecond)||Number(pixelsPerSecond)<=0)throw new RangeError('The timeline scale must be finite and positive.');
 if(!finite(deltaX))throw new TypeError('The pointer delta must be finite.');
 if(!['move','trim-start','trim-end'].includes(mode))throw new RangeError('Choose move, trim-start, or trim-end.');
 if(!finite(clip.start)||Number(clip.start)<0||!finite(clip.length)||Number(clip.length)<=0)throw new RangeError('The clip must have a non-negative start and positive duration.');
 if(!finite(snapSeconds)||Number(snapSeconds)<0)throw new RangeError('The snap interval must be finite and non-negative.');
 const spb=60/Number(bpm),startSec=Number(clip.start)*spb,durationSec=Number(clip.length)*spb,endSec=startSec+durationSec,deltaSec=Number(deltaX)/Number(pixelsPerSecond),snap=Number(snapSeconds);
 const snapped=value=>snap>0?Math.round(value/snap)*snap:value;
 const next=structuredClone(clip);
 if(Number(deltaX)===0&&(targetTrack===undefined||Number(targetTrack)===Number(clip.track))&&(targetLaneId===undefined||targetLaneId===clip.laneId))return next;
 if(mode==='trim-start'&&clip.patternId&&Number(clip.cloudRaw?.loopPhaseMs??clip.cloudRaw?.loop_phase_ms??0)!==0)throw new Error('Trimming the start of a phased pattern needs a native phase-aware trim operation. Its source offset cannot be substituted for its loop phase.');
 if(mode==='move'){
  next.start=deltaSec===0?Number(clip.start):Math.max(0,snapped(startSec+deltaSec))/spb;
  if(targetTrack!==undefined){if(!finite(targetTrack)||Number(targetTrack)<0||!Number.isInteger(Number(targetTrack)))throw new RangeError('Choose an existing non-negative cloud track index.');next.track=Number(targetTrack);}
  if(targetLaneId!==undefined){if(typeof targetLaneId!=='string'||!targetLaneId.trim())throw new TypeError('Choose an existing cloud lane identity.');next.laneId=targetLaneId;}
  return next;
 }
 if(durationSec<MIN_CLIP_DURATION_SEC-1e-12)throw new RangeError('The clip is shorter than the minimum editable duration of .001 seconds.');
 if(mode==='trim-start'){
  let offsetSec;
  if(clip.patternId){
   const rawOffset=clip.cloudRaw?.offsetMs??clip.cloudRaw?.offset_ms??0;
   if(!finite(rawOffset)||Number(rawOffset)<0)throw new RangeError('The pattern source offset must be finite and non-negative.');
   offsetSec=Number(rawOffset)/1000;
  }else{
   if(clip.offsetKnown!==true)throw new Error('Freestyle has not exposed this clip’s source offset. Reload its audio state before trimming its start.');
   if(!finite(clip.offset)||Number(clip.offset)<0)throw new RangeError('The audio source offset must be finite and non-negative.');
   offsetSec=Number(clip.offset)*spb;
  }
  const targetSec=clamp(snapped(startSec+deltaSec),Math.max(0,startSec-offsetSec),endSec-MIN_CLIP_DURATION_SEC),changeSec=targetSec-startSec;
  next.start=targetSec/spb;next.length=Number(clip.start)+Number(clip.length)-next.start;
  const sourceOffsetSec=Math.max(0,offsetSec+changeSec);
  if(clip.patternId){
   next.cloudRaw={...(next.cloudRaw||{}),offsetMs:sourceOffsetSec*1000};
   if(Object.hasOwn(next.cloudRaw,'offset_ms'))next.cloudRaw.offset_ms=next.cloudRaw.offsetMs;
  }else next.offset=sourceOffsetSec/spb;
  return next;
 }
 let maximumEndSec=Infinity;
 if(clip.patternId){const raw=clip.cloudRaw||{},duration=Number(raw.durationMs??raw.duration_ms),repeats=Number(raw.repeatCount??raw.repeat_count),offset=Number(raw.offsetMs??raw.offset_ms??0);maximumEndSec=Number.isFinite(duration)&&duration>0&&Number.isFinite(repeats)&&repeats>=1&&Number.isFinite(offset)?startSec+Math.max(MIN_CLIP_DURATION_SEC,(duration*repeats-offset)/1000):endSec;}
 if(!clip.patternId){
  // Without the full source extent and its known offset, extending would
  // invent available audio. Shortening the existing range is still safe.
  maximumEndSec=endSec;
  if(clip.offsetKnown===true&&finite(clip.offset)&&Number(clip.offset)>=0&&finite(clip.sourceLength)&&Number(clip.sourceLength)>=0){
   const availableSec=(Number(clip.sourceLength)-Number(clip.offset))*spb;
   if(availableSec<MIN_CLIP_DURATION_SEC-1e-12)throw new RangeError('The audio source has no editable duration after its offset.');
   maximumEndSec=startSec+availableSec;
  }
 }
 const targetSec=clamp(snapped(endSec+deltaSec),startSec+MIN_CLIP_DURATION_SEC,maximumEndSec);
 next.length=(targetSec-startSec)/spb;
 return next;
}
