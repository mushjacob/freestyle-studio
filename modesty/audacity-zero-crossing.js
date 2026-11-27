/** Selection-only zero-crossing policy pinned to Audacity 3.2.1.
 * Native references (not claims of runtime verification):
 * https://github.com/audacity/audacity/blob/Audacity-3.2.1/src/menus/SelectMenus.cpp#L59-L136
 * https://github.com/audacity/audacity/blob/Audacity-3.2.1/src/menus/SelectMenus.cpp#L698-L716
 * https://github.com/audacity/audacity/blob/Audacity-3.2.1/libraries/lib-sample-track/SampleTrack.cpp#L42-L45
 * https://github.com/audacity/audacity/blob/Audacity-3.2.1/src/WaveTrack.cpp#L2122-L2206
 * https://github.com/audacity/audacity/blob/Audacity-3.2.1/libraries/lib-screen-geometry/SelectedRegion.h#L139-L143
 *
 * Inputs are exact raw per-frame PCM reads assembled in TIMELINE coordinates.
 * Each tracks[] entry is one native WaveTrack channel, including both selected
 * stereo channels. Known gaps/outside clips use sentinel 2, matching fillTwo.
 * Missing/failed reads must never be converted to this sentinel or to silence.
 * This module scores a selection location only: no audio output/DSP is made.
 */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const f32=Math.fround;
export const ZERO_CROSSING_GAP=2;

export function planZeroCrossingWindow(timeSec,sampleRate){
 if(!finite(timeSec)||!finite(sampleRate)||sampleRate<=0)throw new TypeError('Zero-crossing time and sample rate must be finite; sample rate must be positive.');
 const windowSize=Math.floor(Math.max(1,sampleRate/100)),centerSample=Math.floor(timeSec*sampleRate+.5),half=Math.floor(windowSize/2),startSample=centerSample-half,endSample=startSample+windowSize;
 if(![windowSize,centerSample,startSample,endSample].every(Number.isSafeInteger))throw new RangeError('Zero-crossing sample positions exceed exact browser integer precision.');
 return {timeSec,sampleRate,windowSize,centerSample,startSample,endSample};
}

/** Literal native score accumulation, including Float32 storage, strict first
 * minimum ties, rate-index mapping and native threshold/score-cap behavior.
 * `samples` must span exactly planZeroCrossingWindow(timeSec,sampleRate).
 */
export function nearestZeroCrossing({timeSec,projectRate,tracks}={}){
 const project=planZeroCrossingWindow(timeSec,projectRate),size=project.windowSize,half=Math.floor(size/2);
 // Normal audio rates have at least two samples per window. Below this the
 // native mixed-rate integer divisor is zero, so there is no safe policy to port.
 if(size<2)throw new RangeError('The native zero-crossing project window needs at least two samples.');
 if(!Array.isArray(tracks)||!tracks.length)throw new Error('Select at least one audio channel before finding a zero crossing.');
 const channels=tracks.map(track=>{
  const plan=planZeroCrossingWindow(timeSec,track?.sampleRate),samples=track?.samples;
  if((!Array.isArray(samples)&&!ArrayBuffer.isView(samples))||samples.length!==plan.windowSize)throw new Error('Each zero-crossing channel needs a complete exact per-frame window.');
  const channelScores=new Float32Array(plan.windowSize);let previous=2;
  for(let i=0;i<plan.windowSize;i++){
   if(!finite(samples[i])||!Number.isFinite(f32(samples[i])))throw new Error('Zero-crossing PCM contains missing or non-finite frames.');
   const current=f32(samples[i]),penalty=previous*current>0?.4:previous>0?.1:0;
   channelScores[i]=f32(Math.abs(current)+penalty);previous=current;
  }
  return channelScores;
 });
 const scores=new Float32Array(size);
 for(const channel of channels)for(let i=0;i<size;i++){
  const j=channel.length===size?i:Math.floor(i*(channel.length-1)/(size-1));
  scores[i]=f32(scores[i]+channel[j]);
  scores[i]=f32(scores[i]+.1*Math.abs(i-half)/half);
 }
 let index=0,score=3;
 for(let i=0;i<size;i++)if(scores[i]<score){index=i;score=scores[i];}
 const channelCount=channels.length,accepted=!(score>(channelCount===1?.2:.6)*channelCount),next=accepted?timeSec+(index-half)/projectRate:timeSec;
 return {timeSec:next,changed:next!==timeSec,accepted,score,index,channelCount,windowSize:size,reason:accepted?'accepted':'score-threshold'};
}

/** Native OnZeroCrossing adjusts a point once; for a range both independently
 * scored edges commit together, only if their new absolute span exceeds 1.5
 * project samples. Crossed endpoints are ordered by SelectedRegion::setTimes.
 */
export function selectAtZeroCrossings(selection,{projectRate,startTracks,endTracks}={}){
 if(!selection||!finite(selection.start)||!finite(selection.end)||selection.end<selection.start)throw new RangeError('Choose an ordered finite selection before finding zero crossings.');
 const first=nearestZeroCrossing({timeSec:selection.start,projectRate,tracks:startTracks});
 if(selection.start===selection.end){const result={start:first.timeSec,end:first.timeSec};return {selection:result,changed:first.changed,reason:first.reason,endpoints:{start:first,end:first}};}
 const last=nearestZeroCrossing({timeSec:selection.end,projectRate,tracks:endTracks}),usable=Math.abs(last.timeSec-first.timeSec)*projectRate>1.5;
 const result=usable?{start:Math.min(first.timeSec,last.timeSec),end:Math.max(first.timeSec,last.timeSec)}:{...selection};
 return {selection:result,changed:result.start!==selection.start||result.end!==selection.end,reason:usable?'range-scored':'short-selection',endpoints:{start:first,end:last}};
}
