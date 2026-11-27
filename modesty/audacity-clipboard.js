import {automationValue} from './automation-ui.js';
import {assertAutomationJsonValue} from './audacity-automation-contract.js';
const clone=value=>structuredClone(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
// Operate on exact millisecond values in their integer domain. Source ends,
// gaps, offsets and automation points off that grid keep supplied precision.
const gridMilliseconds=value=>{const ms=Math.round(value*1000);return Number.isSafeInteger(ms)&&ms/1000===value?ms:null;};
const windowSpan=(start,end)=>{
 const a=gridMilliseconds(start),b=gridMilliseconds(end);
 return a!==null&&b!==null?(b-a)/1000:end-start;
};
const windowAdd=(start,span)=>{const a=gridMilliseconds(start),b=gridMilliseconds(span);return a!==null&&b!==null&&Number.isSafeInteger(a+b)?(a+b)/1000:start+span;};
export const clipboardMilliseconds=value=>gridMilliseconds(value)??value*1000;
export function clipboardStable(value){
 if(Array.isArray(value))return value.map(clipboardStable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,clipboardStable(value[key])]));
 return value;
}
export const clipboardKey=value=>JSON.stringify(clipboardStable(value));
export function clipboardTiming(clip){
 const result={start_ms:clip.startMs??clip.start_ms,duration_sec:clip.durationSec??clip.duration_sec,audio_offset_sec:clip.audioOffsetSec??clip.audio_offset_sec};
 if(!finite(result.start_ms)||result.start_ms<0||!finite(result.duration_sec)||result.duration_sec<=0||!finite(result.audio_offset_sec)||result.audio_offset_sec<0)throw new Error('Clipboard audio requires complete canonical start, duration and source offset.');
 return result;
}
export function clipboardEnvelopeKey(envelope){return `${envelope.clipId??envelope.clip_id}\0${JSON.stringify(clipboardStable(envelope.target))}`;}
export function clipboardEnvelopeData(envelope){const {id,revision,persisted,updatedAt,updated_at,createdAt,created_at,...data}=envelope;return clipboardStable({...data,persisted:persisted!==false});}
const receiptTimes=row=>{const {updatedAt,updated_at,createdAt,created_at,...data}=row;return data;};
export function clipboardStateKey(state){
 const project={...receiptTimes(state.project),clips:state.project.clips.map(receiptTimes).sort((a,b)=>a.id.localeCompare(b.id)),lanes:state.project.lanes.map(receiptTimes)};
 // A project-wide REST receipt advances during our own writes; nested
 // source/audio metadata remains exact and revision guards stay on requests.
 delete project.timelineRevision;
 // Counts are derived receipt cardinalities, not user metadata. Planned clip
 // membership necessarily changes counts.clips before a new receipt exists.
 if(project.counts&&typeof project.counts==='object')project.counts={...project.counts,clips:project.clips.length};
 return clipboardKey({project,placements:state.placements.map(receiptTimes).sort((a,b)=>a.id.localeCompare(b.id)),envelopes:state.envelopes.map(clipboardEnvelopeData).sort((a,b)=>clipboardEnvelopeKey(a).localeCompare(clipboardEnvelopeKey(b)))});
}
export function clipboardSourceSignature(clip){
 const {id,startMs,start_ms,durationSec,duration_sec,audioOffsetSec,audio_offset_sec,laneId,lane_id,editUrl,updatedAt,updated_at,createdAt,created_at,...source}=clip;
 return clipboardKey(source);
}
/** Live copy_append_clip marks a new copy isImported:false even when its
 * source isImported:true. That top-level creation provenance belongs to the
 * new identity. Accept only the observed transition here; retained originals,
 * source revisions, gains, names, mute state and nested metadata stay strict.
 */
export function clipboardCopyMetadataMatches(source,copied){
 const comparable=source.isImported===true&&copied.isImported===false?{...copied,isImported:true}:copied;
 return clipboardSourceSignature(source)===clipboardSourceSignature(comparable);
}
/** Control-point slicing only; audio remains in Freestyle. Retain ordered
 * discontinuities and point metadata. Linear/dB/hold subdivisions are exact.
 * A cropped nonzero-tension easing segment is not representable by that same
 * one-parameter curve, so fail before any write instead of approximating it.
 */
export function sliceClipboardEnvelope(envelope,startSec,endSec){
 assertAutomationJsonValue(envelope);if(!finite(startSec)||!finite(endSec)||startSec<0||endSec<=startSec||!Array.isArray(envelope.points))throw new Error('Clipboard envelope window is incomplete.');
 const points=envelope.points;if(points.some((point,index)=>!finite(point.timeSec)||!finite(point.value)||index&&point.timeSec<points[index-1].timeSec))throw new Error('Clipboard envelope points are incomplete or out of order.');
 if(!points.length&&envelope.persisted===false){if(!finite(envelope.defaultValue))throw new Error('The implicit clipboard envelope has no canonical default.');return clone(envelope);}
 const boundary=time=>{
  const exact=points.filter(point=>point.timeSec===time);if(exact.length)return clone(exact);
  const left=points.findLast(point=>point.timeSec<time),right=points.find(point=>point.timeSec>time);
  if(left&&right&&left.curve==='bezier'&&Number(left.tension||0)!==0)throw new Error('The selected boundary cuts a non-linear Bezier automation segment. Its exact subcurve must be supplied by Freestyle before this region can be copied.');
  const template=left??right,value=points.length?automationValue(points,time):envelope.defaultValue;
  if(!finite(value))throw new Error('The clipboard envelope has no known value at its boundary.');
  return [{...(template?clone(template):{curve:envelope.valueType==='continuous'?'linear':'hold',tension:0}),timeSec:time,value}];
 };
 const selected=[...boundary(startSec),...points.filter(point=>point.timeSec>startSec&&point.timeSec<endSec).map(clone),...boundary(endSec)];
 return {...clone(envelope),...(Object.hasOwn(envelope,'pointCount')?{pointCount:selected.length}:{}),points:selected.map(point=>({...point,timeSec:windowSpan(startSec,point.timeSec)}))};
}
export function captureAudioClipboard({projectId,state,laneIds,selection}={}){
 if(!projectId||!Array.isArray(laneIds)||!laneIds.length||new Set(laneIds).size!==laneIds.length)throw new Error('Select persisted audio lanes before copying.');
 const requested=clone(selection),aligned=clipboardGridSelection(selection,state.project.clips,laneIds),start=aligned.start,end=aligned.end;if(end<=start)throw new Error('Select an audio time region of at least 1 ms before Cut or Copy.');
 if(laneIds.some(id=>!state.project.lanes?.some(lane=>lane.id===id)))throw new Error('The copied audio lane is no longer in the canonical project.');
 const lanes=laneIds.map(laneId=>({laneId,fragments:state.project.clips.filter(clip=>(clip.laneId??clip.lane_id)===laneId).flatMap(clip=>{
  const timing=clipboardTiming(clip),a=timing.start_ms/1000,b=windowAdd(a,timing.duration_sec),left=Math.max(a,start),right=Math.min(b,end);if(right<=left)return [];
  const sourceEnvelopes=state.envelopes.filter(row=>(row.clipId??row.clip_id)===clip.id).map(clone),sourceStart=windowSpan(a,left),sourceEnd=right===b?timing.duration_sec:windowSpan(a,right),envelopes=sourceEnvelopes.map(row=>sliceClipboardEnvelope(row,sourceStart,sourceEnd));
  if(!envelopes.some(row=>row.target?.kind==='clip_gain'))throw new Error('Read the complete canonical clip gain envelope before copying this audio.');
  return [{sourceId:clip.id,source:clone(clip),sourceEnvelopes,relativeSec:windowSpan(start,left),durationSec:windowSpan(sourceStart,sourceEnd),audioOffsetSec:windowAdd(timing.audio_offset_sec,sourceStart),envelopes}];
 })}));
 if(lanes.reduce((count,lane)=>count+lane.fragments.length,0)>128)throw new Error('The clipboard contains more than 128 audio windows; no partial copy was made.');
 return {projectId,requestedSelection:requested,selection:aligned,durationSec:(Math.round(end*1000)-Math.round(start*1000))/1000,lanes,gridMs:1};
}
export function clipboardGridSelection(selection,clips=[],laneIds=[]){
 const start=selection?.start,end=selection?.end;if(!finite(start)||!finite(end)||start<0||end<start||end*1000>Number.MAX_SAFE_INTEGER)throw new Error('Choose a finite ordered clipboard selection.');
 let startMs=Math.round(start*1000),endMs=Math.round(end*1000);
 // Preserve a completely selected source ending between stored timeline ms:
 // include its last samples and retain the resulting sub-ms trailing gap.
 for(const clip of clips){if(laneIds.length&&!laneIds.includes(clip.laneId??clip.lane_id))continue;const timing=clipboardTiming(clip),edge=timing.start_ms/1000+timing.duration_sec;if(Math.abs(end-edge)<=1e-10&&endMs/1000<edge)endMs=Math.ceil(edge*1000);}
 return {start:startMs/1000,end:endMs/1000};
}
/** Native insertion: split crossing clips, shift all following clips on each
 * destination lane, and retain clipboard gaps. A single copied lane fans out
 * to selected lanes; multiple copied lanes map in selected-track order.
 */
export function planAudioClipboardPaste({clipboard,state,laneIds,cursorSec}={}){
 if(!clipboard||!finite(cursorSec)||cursorSec<0||!Array.isArray(laneIds)||!laneIds.length||new Set(laneIds).size!==laneIds.length)throw new Error('Choose a cursor and persisted destination audio lanes.');
 if(clipboard.lanes.length!==1&&clipboard.lanes.length!==laneIds.length)throw new Error('Select one destination lane for each copied lane.');
 if(laneIds.some(id=>!state.project.lanes?.some(lane=>lane.id===id)))throw new Error('A clipboard destination lane is no longer available.');
 cursorSec=Math.round(cursorSec*1000)/1000;const spanMs=Math.round(clipboard.durationSec*1000);if(Math.abs(spanMs/1000-clipboard.durationSec)>1e-10||spanMs<=0)throw new Error('The clipboard span must use the supported 1 ms insertion grid.');
 const updates=[],clones=[];
 for(const [index,laneId]of laneIds.entries()){
  for(const clip of state.project.clips.filter(row=>(row.laneId??row.lane_id)===laneId)){
   const timing=clipboardTiming(clip),start=timing.start_ms/1000,end=windowAdd(start,timing.duration_sec);
   if(start>=cursorSec)updates.push({id:clip.id,timing:{...timing,start_ms:timing.start_ms+spanMs},envelopes:null});
   else if(end>cursorSec){
    const left=windowSpan(start,cursorSec),right=windowSpan(left,timing.duration_sec),rows=state.envelopes.filter(row=>(row.clipId??row.clip_id)===clip.id);
    updates.push({id:clip.id,timing:{...timing,duration_sec:left},envelopes:rows.map(row=>sliceClipboardEnvelope(row,0,left))});
    clones.push({sourceId:clip.id,source:clone(clip),laneId,startSec:windowAdd(cursorSec,clipboard.durationSec),durationSec:right,audioOffsetSec:windowAdd(timing.audio_offset_sec,left),envelopes:rows.map(row=>sliceClipboardEnvelope(row,left,timing.duration_sec)),kind:'right'});
   }
  }
  const source=clipboard.lanes[clipboard.lanes.length===1?0:index];
  for(const fragment of source.fragments)clones.push({...clone(fragment),laneId,startSec:windowAdd(cursorSec,fragment.relativeSec),kind:'paste'});
 }
 if(updates.length+clones.length>256)throw new Error('This insertion exceeds the 256-operation clip batch; no smaller paste was substituted.');
 return {cursorSec,durationSec:clipboard.durationSec,laneIds:[...laneIds],updates,clones,selection:{start:cursorSec,end:windowAdd(cursorSec,clipboard.durationSec)}};
}
