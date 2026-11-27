/** Pure Edit > Insert space / Delete space plans in beat coordinates. No DOM, no I/O. */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const eps=1e-9;

function check(startBeat,endBeat){
 if(!finite(startBeat)||!finite(endBeat)||startBeat<0||endBeat<=startBeat)throw new RangeError('Choose a non-empty time selection.');
}

/** Clips starting at or after startBeat move right by the range length. Crossing clips stay put. */
export function planInsertSpace(clips,startBeat,endBeat){
 check(startBeat,endBeat);const length=endBeat-startBeat,update=[];
 for(const clip of clips||[])if(finite(clip?.start)&&clip.start>=startBeat-eps)update.push({id:clip.id,changes:{start:clip.start+length}});
 return{update,remove:[],skipped:[]};
}

/**
 * Remove clips fully inside the range, trim crossing clips, shift later clips left.
 * trimStart(clip,deltaBeats) returns the left-trimmed clip or throws; a throw leaves
 * that clip untrimmed and unmoved, reported in `skipped`.
 */
export function planDeleteSpace(clips,startBeat,endBeat,{trimStart}={}){
 check(startBeat,endBeat);const length=endBeat-startBeat,update=[],remove=[],skipped=[];
 for(const clip of clips||[]){
  if(!finite(clip?.start)||!finite(clip?.length))continue;
  const left=clip.start,right=left+clip.length;
  if(right<=startBeat+eps)continue;
  if(left>=endBeat-eps){update.push({id:clip.id,changes:{start:left-length}});continue;}
  if(left>=startBeat-eps&&right<=endBeat+eps){remove.push(clip.id);continue;}
  if(left<startBeat-eps&&right>endBeat+eps){update.push({id:clip.id,changes:{length:clip.length-length}});continue;}
  if(left<startBeat-eps){update.push({id:clip.id,changes:{length:startBeat-left}});continue;}
  // The clip starts inside the range and runs past its end: trim its left edge to endBeat, then shift left.
  try{
   if(typeof trimStart!=='function')throw new Error('Left trim is unavailable.');
   const trimmed=trimStart(clip,endBeat-left);
   if(!trimmed||!finite(trimmed.start)||trimmed.start<endBeat-eps)throw new Error('Left trim did not reach the range end.');
   const{id,...rest}=trimmed;const changes={};
   for(const key of Object.keys(rest))if(JSON.stringify(rest[key])!==JSON.stringify(clip[key]))changes[key]=rest[key];
   changes.start=trimmed.start-length;update.push({id:clip.id,changes});
  }catch(error){skipped.push({id:clip.id,reason:error.message});}
 }
 return{update,remove,skipped};
}
