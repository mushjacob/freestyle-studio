/**
 * Audacity 3.7.1 ruler snapping, without DOM, playback, or cloud mutations.
 * Primary sources:
 * https://github.com/audacity/audacity/blob/Audacity-3.7.1/libraries/lib-snapping/Snap.cpp
 * https://github.com/audacity/audacity/blob/Audacity-3.7.1/libraries/lib-screen-geometry/ZoomInfo.cpp#L44
 * https://github.com/audacity/audacity/blob/Audacity-3.7.1/src/AdornedRulerPanel.cpp#L2294
 * Clips supplied here represent the native track intervals. No selection/mute
 * filtering is applied. The ruler passes currentTrack=null and rightEdge=false.
 */
export const LOOP_SNAP_PIXEL_TOLERANCE=4;
export const LOOP_SNAP_EPSILON=1/44100;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
// ZoomInfo::TimeToPosition: floor(0.5 + zoom*(time-hpos) + origin).
export function loopScreenPixel(seconds,pixelsPerSecond,viewportStartSeconds=0){
 return Math.floor(.5+pixelsPerSecond*(seconds-viewportStartSeconds));
}
// C++ std::round rounds negative ties away from zero, unlike Math.round.
const nativeRound=value=>value<0?-Math.floor(.5-value):Math.floor(.5+value);
const gridTime=(seconds,gridSeconds)=>{
 const multiplier=1/gridSeconds;
 return nativeRound(seconds*multiplier)/multiplier;
};

/**
 * Snap an absolute song time. viewportStartSeconds preserves native rounding
 * when the horizontal viewport begins between pixels. unsnapped suppresses
 * snapping for this invocation only (the next pointer move may snap again).
 * kind is 'none', 'point', or 'grid'; pointKind describes the winning magnet.
 * Point snapping stays enabled when gridSeconds is zero (Snap checkbox off).
 */
export function snapLoopTime(seconds,{
 pixelsPerSecond,clips=[],selection,syncSelection=false,gridSeconds=0,
 unsnapped=false,viewportStartSeconds=0,
}={}){
 if(!finite(seconds))throw new TypeError('The loop time must be finite.');
 if(!finite(pixelsPerSecond)||pixelsPerSecond<=0)throw new RangeError('The timeline scale must be finite and positive.');
 if(!finite(viewportStartSeconds))throw new TypeError('The viewport start must be finite.');
 if(!finite(gridSeconds)||gridSeconds<0)throw new RangeError('The grid interval must be finite and non-negative.');
 const original={seconds,snapped:false,kind:'none'};
 if(unsnapped)return original;
 const candidates=[{seconds:0,nullTrack:true,pointKind:'zero'}];
 for(const clip of clips){
  if(finite(clip?.start))candidates.push({seconds:clip.start,nullTrack:false,pointKind:'clip'});
  if(finite(clip?.end)&&clip.end!==clip.start)candidates.push({seconds:clip.end,nullTrack:false,pointKind:'clip'});
 }
 if(!syncSelection){
  for(const edge of ['start','end'])if(finite(selection?.[edge]))candidates.push({seconds:selection[edge],nullTrack:true,pointKind:'selection'});
 }
 const pixel=loopScreenPixel(seconds,pixelsPerSecond,viewportStartSeconds);
 const points=candidates
  // SnapManager only retains points exactly representable on an enabled grid.
  .filter(point=>!gridSeconds||gridTime(point.seconds,gridSeconds)===point.seconds)
  .filter(point=>Math.abs(loopScreenPixel(point.seconds,pixelsPerSecond,viewportStartSeconds)-pixel)<LOOP_SNAP_PIXEL_TOLERANCE)
  .sort((a,b)=>a.seconds-b.seconds);
 let winner;
 if(points.length===1)winner=points[0];
 else if(points.length>1){
  const nullTrackPoints=points.filter(point=>point.nullTrack);
  if(nullTrackPoints.length===1)winner=nullTrackPoints[0];
  else if(points.at(-1).seconds-points[0].seconds<LOOP_SNAP_EPSILON)winner=points[0];
 }
 if(winner)return {seconds:winner.seconds,snapped:true,kind:'point',pointKind:winner.pointKind};
 if(gridSeconds)return {seconds:gridTime(seconds,gridSeconds),snapped:true,kind:'grid'};
 return original;
}

/**
 * Rigid whole-loop move. Both proposed endpoints use the same candidate set;
 * the first snapped endpoint wins, and its delta shifts the other endpoint.
 * This follows AdornedRulerPanel::SnappedTimes, including start-edge priority
 * when both endpoints could independently snap to different places.
 */
export function snapLoopPair(start,end,options){
 if(!finite(start)||!finite(end)||end<start)throw new RangeError('Choose ordered, finite loop bounds.');
 const first=snapLoopTime(start,options),last=snapLoopTime(end,options);
 const edge=first.snapped?'start':last.snapped?'end':null;
 const result=edge==='start'?first:edge==='end'?last:null;
 const delta=result?result.seconds-(edge==='start'?start:end):0;
 return {start:start+delta,end:end+delta,snapped:!!result,kind:result?.kind||'none',edge,results:[first,last]};
}
