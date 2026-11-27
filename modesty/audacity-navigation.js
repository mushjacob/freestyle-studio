/** View-only keyboard navigation; no cloud or audio work occurs here.
 * Primary source: https://github.com/audacity/audacity/tree/master/au3/src/menus
 * SelectMenus.cpp, NavigationMenus.cpp and ClipMenus.cpp. */
const clone=value=>structuredClone(value);
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function ordered(range){if(!finite(range?.start)||!finite(range?.end)||Number(range.start)<0||Number(range.end)<Number(range.start))throw new RangeError('Selection must satisfy 0 ≤ start ≤ end.');return {...clone(range),start:Number(range.start),end:Number(range.end)};}
function directionValue(direction,vertical=false){if(direction===-1||direction===(vertical?'up':'left'))return -1;if(direction===1||direction===(vertical?'down':'right'))return 1;throw new Error('Choose a verified navigation direction.');}
function result(original,selection,targetSeconds=null,extra={}){return {selection,targetSeconds,scrollSeconds:targetSeconds,seek:false,seekDeltaSeconds:0,changed:original.start!==selection.start||original.end!==selection.end,...extra};}
function regionWithEdge(range,edge,time){const pair=edge==='start'?[Math.max(0,time),range.end]:[range.start,Math.max(0,time)];return {...range,start:Math.min(...pair),end:Math.max(...pair)};}

/**
 * For stopped pixel commands the native fast-key threshold is <50 ms, then
 * the step is four pixels. `repeat` alone is not an acceleration signal.
 * During playback move/extend return short/long relative seek requests and
 * leave the editing selection unchanged; contraction is a no-op.
 */
export function selectionNavigate(range,{command='move',direction='right',pixelsPerSecond,projectEnd,screenEnd,sinceLastAdjustmentMs,playing=false,playbackSeconds,shortSeekSeconds=1,longSeekSeconds=15,trackStart,trackEnd,snapTime,snapStep}={}){
 const original=ordered(range),selection=clone(original);
 const pixelCommands=new Set(['move','extend','contract']),jumpCommands=new Set(['jump-short','jump-long']);
 if(pixelCommands.has(command)||jumpCommands.has(command)){
  const sign=directionValue(direction);
  if(playing){
   if(command==='contract')return result(original,selection);
   const period=command==='extend'||command==='jump-long'?longSeekSeconds:shortSeekSeconds;
   if(!finite(period)||Number(period)<0)throw new RangeError('The seek preference must be finite and non-negative.');
   const delta=sign*Number(period),target=finite(playbackSeconds)?Math.max(0,Number(playbackSeconds)+delta):null;
   return result(original,selection,target,{seek:true,seekDeltaSeconds:delta});
  }
  let step;
  if(jumpCommands.has(command)){const period=command==='jump-long'?longSeekSeconds:shortSeekSeconds;if(!finite(period)||Number(period)<0)throw new RangeError('The seek preference must be finite and non-negative.');step=Number(period);}
  else{if(!finite(pixelsPerSecond)||Number(pixelsPerSecond)<=0)throw new RangeError('The timeline pixel scale must be positive.');step=(finite(sinceLastAdjustmentMs)&&Number(sinceLastAdjustmentMs)>=0&&Number(sinceLastAdjustmentMs)<50?4:1)/Number(pixelsPerSecond);}
  if(command==='move'||jumpCommands.has(command)){
   const point=selection.start===selection.end;
   let target=point?selection.start+sign*step:sign<0?selection.start:selection.end;
   if(pixelCommands.has(command)){if(point&&typeof snapStep==='function')target=snapStep(selection.start,sign,step);else if(!point&&typeof snapTime==='function')target=snapTime(target);}
   if(!finite(target))throw new Error('Navigation snapping returned an invalid time.');
   target=Math.max(0,Number(target));return result(original,{...selection,start:target,end:target},target);
  }
  if(command==='contract'&&selection.start===selection.end)return result(original,selection);
  const moveStart=command==='extend'?sign<0:sign>0,edge=moveStart?'start':'end';
  let target=selection[edge]+sign*step;
  if(typeof snapStep==='function')target=snapStep(selection[edge],sign,step);
  if(!finite(target))throw new Error('Navigation snapping returned an invalid time.');
  const bounds=[projectEnd,screenEnd].filter(finite).map(Number);if(bounds.some(value=>value<0))throw new RangeError('Timeline bounds cannot be negative.');
  const limit=bounds.length?Math.max(...bounds):Infinity;target=clamp(Number(target),0,limit);
  if(command==='contract')target=moveStart?Math.min(selection.end,target):Math.max(selection.start,target);
  return result(original,regionWithEdge(selection,edge,target),target);
 }
 if(command==='project-start'||command==='project-end'||command==='selection-start'||command==='selection-end'||command==='track-start'||command==='track-end'){
  let target=command==='project-start'?0:command==='project-end'?projectEnd:command==='selection-start'?selection.start:command==='selection-end'?selection.end:command==='track-start'?trackStart:trackEnd;
  if(target===undefined||target===null)return result(original,selection);
  if(!finite(target)||Number(target)<0)throw new RangeError('The cursor boundary must be a known non-negative time.');
  target=Number(target);return result(original,{...selection,start:target,end:target},target);
 }
 if(['extend-start','extend-end','extend-track-start','extend-track-end'].includes(command)){
  const start=command==='extend-start'||command==='extend-track-start',target=command==='extend-start'?0:command==='extend-end'?projectEnd:start?trackStart:trackEnd;
  if(target===undefined||target===null)return result(original,selection);
  if(!finite(target)||Number(target)<0)throw new RangeError('The selection boundary must be a known non-negative time.');
  return result(original,regionWithEdge(selection,start?'start':'end',Number(target)),Number(target));
 }
 throw new Error('Unsupported timeline navigation command.');
}

/** Native focus/selection uses actual visual order, not dense track arithmetic. */
export function trackFocusNavigate({focusedTrack=null,selectedTracks=[]}={}, {command='move',direction='down',trackIndexes=[],circular=false}={}){
 const tracks=[...new Set(trackIndexes)],selected=new Set([...selectedTracks].filter(index=>tracks.includes(index))),before=[...selected];let focus=tracks.includes(focusedTrack)?focusedTrack:null;
 const previous=focus;
 if(!['move','extend','first','last','toggle'].includes(command))throw new Error('Unsupported track-focus command.');
 if(!tracks.length)return {focusedTrack:null,selectedTracks:[],changed:focusedTrack!==null||before.length>0};
 if(command==='toggle'){if(focus!==null){if(selected.has(focus))selected.delete(focus);else selected.add(focus);}}
 else if(command==='first'||command==='last'){if(focus!==null)focus=command==='first'?tracks[0]:tracks.at(-1);}
 else{
  const sign=directionValue(direction,true);
  if(focus===null)focus=sign<0?tracks.at(-1):tracks[0];
  else{
   let index=tracks.indexOf(focus)+sign;
   if(circular)index=(index+tracks.length)%tracks.length;
   if(index>=0&&index<tracks.length){
    const next=tracks[index];
    if(command==='extend'){
     const here=selected.has(focus),there=selected.has(next);
     if(here&&there)selected.delete(focus);
     else if(here&&!there)selected.add(next);
     else if(!here&&there)selected.delete(next);
     else selected.add(focus);
    }
    focus=next;
   }
  }
 }
 const selectedResult=tracks.filter(index=>selected.has(index));
 return {focusedTrack:focus,selectedTracks:selectedResult,changed:previous!==focus||before.length!==selectedResult.length||before.some(index=>!selected.has(index))};
}

function clipGroups(clips,bpm,selectedTracks){
 if(!finite(bpm)||Number(bpm)<=0)throw new RangeError('A known project tempo is required for clip navigation.');
 const spb=60/Number(bpm),selected=new Set(selectedTracks||[]),groups=new Map();
 for(const clip of clips||[]){
  const track=clip.track;
  if(selected.size&&!selected.has(track))continue;
  if(!finite(clip.start)||!finite(clip.length)||Number(clip.start)<0||Number(clip.length)<=0)continue;
  const entry={clipId:clip.id,cloudId:clip.cloudId,track,start:Number(clip.start)*spb,end:(Number(clip.start)+Number(clip.length))*spb};
  if(!groups.has(track))groups.set(track,[]);groups.get(track).push(entry);
 }
 for(const group of groups.values())group.sort((a,b)=>a.start-b.start||a.end-b.end);
 return groups;
}
function adjustedStart(clips,time,tolerance){const index=clips.findIndex(clip=>clip.end===time);return index>=0&&index+1<clips.length&&Math.abs(clips[index].end-clips[index+1].start)<=tolerance?clips[index+1].start:time;}
function adjustedEnd(clips,time,tolerance){const index=clips.findIndex(clip=>clip.start===time);return index>0&&Math.abs(clips[index-1].end-clips[index].start)<=tolerance?clips[index-1].end:time;}

/**
 * Alt+, / Alt+. choose previous/next clips. Boundary and extend-boundary are
 * verified menu commands without default shortcuts. Root must not invent a
 * Ctrl+Arrow or Tab binding. Optional tolerance must come from known media
 * precision; the default does not invent a sample rate or close real gaps.
 */
export function clipNavigate(range,{command='clip',direction='right',clips=[],bpm,selectedTracks=[],boundaryToleranceSeconds=0}={}){
 const original=ordered(range),sign=directionValue(direction),groups=clipGroups(clips,bpm,selectedTracks),candidates=[];
 if(!['clip','boundary','extend-boundary'].includes(command))throw new Error('Unsupported clip-navigation command.');
 if(!finite(boundaryToleranceSeconds)||Number(boundaryToleranceSeconds)<0)throw new RangeError('The boundary tolerance must be finite and non-negative.');
 const tolerance=Number(boundaryToleranceSeconds);
 for(const group of groups.values()){
  if(command==='clip'){
   const start=adjustedStart(group,original.start,tolerance),same=group.find(clip=>clip.start===start);
   let found=same&&(sign>0?same.end>original.end:same.end<original.end)?same:null;
   if(!found)found=sign>0?group.find(clip=>clip.start>start):group.findLast(clip=>clip.start<start);
   if(found)candidates.push(found);
  }else{
   const time=sign>0?original.end:original.start,start=adjustedStart(group,time,tolerance),end=adjustedEnd(group,time,tolerance);
   const first=sign>0?group.find(clip=>clip.start>start):group.findLast(clip=>clip.start<start),last=sign>0?group.find(clip=>clip.end>end):group.findLast(clip=>clip.end<end);
   if(!first&&!last)continue;
   const adjacent=first&&last&&Math.abs(last.end-first.start)<=tolerance;
   const target=adjacent?(sign>0?last.end:first.start):!first?last.end:!last?first.start:sign>0?Math.min(first.start,last.end):Math.max(first.start,last.end);
   const matches=[];if(first&&(adjacent||first.start===target))matches.push(first);if(last&&(adjacent||last.end===target)&&!matches.includes(last))matches.push(last);
   candidates.push({time:target,clips:matches,track:group[0].track});
  }
 }
 if(!candidates.length)return {...result(original,clone(original)),matches:[],clipId:null};
 if(command==='clip'){
  const start=sign>0?Math.min(...candidates.map(clip=>clip.start)):Math.max(...candidates.map(clip=>clip.start)),same=candidates.filter(clip=>clip.start===start);
  const end=sign>0?Math.min(...same.map(clip=>clip.end)):Math.max(...same.map(clip=>clip.end)),matches=same.filter(clip=>clip.end===end);
  return {...result(original,{...original,start,end},start),matches:clone(matches),clipId:matches.length===1?matches[0].clipId:null};
 }
 const target=sign>0?Math.min(...candidates.map(item=>item.time)):Math.max(...candidates.map(item=>item.time)),matches=candidates.filter(item=>item.time===target).flatMap(item=>item.clips),selection=command==='boundary'?{...original,start:target,end:target}:regionWithEdge(original,sign>0?'end':'start',target);
 return {...result(original,selection,target),matches:clone(matches),clipId:null};
}
export function clipBoundaryNavigate(range,options={}){return clipNavigate(range,{command:'boundary',...options});}
