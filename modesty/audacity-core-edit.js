const finite=value=>typeof value==='number'&&Number.isFinite(value);
/** Resolve what a timeline edit actually targets, independently of clip-border
 * highlighting. No project, selection, source window or server time is changed.
 * Multi-target edits need the corresponding atomic engine controller.
 */
export function resolveCoreEdit({operation,selection,selectedTracks,selectedClip,tracks,bpm}={}){
 if(!['split','trim'].includes(operation))throw new Error('Choose Split or Trim.');
 if(!finite(bpm)||bpm<=0)throw new Error('Reload the project’s canonical tempo before editing.');
 const start=selection?.start,end=selection?.end;if(!finite(start)||!finite(end)||start<0||end<start)throw new Error('Choose an ordered finite audio selection.');
 if(operation==='split'&&start!==end)throw new Error('Splitting both edges of a time range requires the atomic range-edit tool.');
 if(operation==='trim'&&end<=start)throw new Error('Select an audio range to keep before trimming.');
 // Legacy split_clip accepts numeric split_ms; retain its exact existing
 // numeric behavior. The atomic range controller owns its own integer schema.
 const all=Array.isArray(tracks)?tracks:[],selected=[...(selectedTracks||[])];
 if(new Set(selected).size!==selected.length)throw new Error('Select distinct canonical tracks before editing.');
 const highlighted=all.flatMap(track=>track.clips||[]).filter(clip=>clip.id===selectedClip),indexes=selected.length?selected:highlighted.length===1?[highlighted[0].track]:[],eligible=all.filter(track=>indexes.includes(track.index));
 if(!indexes.length||eligible.length!==indexes.length)throw new Error('Select the canonical track containing the cursor or range.');
 const seconds=beat=>beat*60/bpm,candidates=eligible.flatMap(track=>(track.clips||[]).filter(clip=>finite(clip.start)&&finite(clip.length)&&clip.length>0&&(operation==='split'?start>seconds(clip.start)&&start<seconds(clip.start+clip.length):end>seconds(clip.start)&&start<seconds(clip.start+clip.length))).map(clip=>({clip,track})));
 if(candidates.length!==1)throw new Error(candidates.length?'This edit affects multiple clips or tracks. Use the atomic range-edit tool.':operation==='split'?'Place the cursor inside a clip on the selected track.':'Select a range overlapping a clip on the selected track.');
 const {clip,track}=candidates[0],startBeat=Math.max(clip.start,start*bpm/60),endBeat=Math.min(clip.start+clip.length,end*bpm/60);
 if(!clip.cloudId)throw new Error('This clip has no persisted cloud identity. Reload the project before editing.');
 if(operation==='trim'&&startBeat>clip.start){
  if(clip.patternId&&Number(clip.cloudRaw?.loopPhaseMs??clip.cloudRaw?.loop_phase_ms??0)!==0)throw new Error('Trimming the start of a phased pattern needs a phase-aware cloud trim operation.');
  if(!clip.patternId&&(clip.offsetKnown!==true||!finite(clip.offset)))throw new Error('Freestyle has not exposed the source offset for this clip.');
 }
 return {operation,clip,kind:clip.patternId?'pattern':'audio',trackIndex:track.index,cursorSec:start,cursorBeat:start*bpm/60,startBeat,endBeat,bpm};
}

/** Read-only confirmation from refreshed canonical clips, not an inferred
 * mutation-receipt schema. A lagging/differently quantized read stays explicitly
 * unverified without replaying a split that may already have committed. */
export function splitBoundaryReadback({clip,afterClips,bpm,cursorSec}={}){
 if(!clip||!Array.isArray(afterClips)||!finite(bpm)||bpm<=0||!finite(cursorSec))return {verified:false,reason:'Canonical split boundaries are unavailable.'};
 const seconds=value=>value*60/bpm,same=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=8*Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b)),start=seconds(clip.start),end=seconds(clip.start+clip.length),rows=afterClips.filter(row=>!row.patternId&&(clip.laneId?row.laneId===clip.laneId:row.track===clip.track));
 const left=rows.filter(row=>same(seconds(row.start),start)&&same(seconds(row.start+row.length),cursorSec)),right=rows.filter(row=>same(seconds(row.start),cursorSec)&&same(seconds(row.start+row.length),end));
 if(left.length!==1||right.length!==1||left[0].id===right[0].id)return {verified:false,reason:'The refreshed clips do not yet show the requested split boundaries.'};
 if(rows.some(row=>seconds(row.start)<cursorSec&&!same(seconds(row.start),cursorSec)&&seconds(row.start+row.length)>cursorSec&&!same(seconds(row.start+row.length),cursorSec)))return {verified:false,reason:'A refreshed clip still spans the requested split point.'};
 return {verified:true,leftId:left[0].cloudId||left[0].id,rightId:right[0].cloudId||right[0].id};
}
