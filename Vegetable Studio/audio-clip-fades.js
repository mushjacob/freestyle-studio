/** FL Studio-style audio clip fades: the small squares at the top corners of an audio clip.
 *
 * Freestyle publishes `PUT /projects/{project_id}/clips/{clip_id}/fades` (operation
 * `setClipFades`, body `{fade_in?,fade_out?}` with each side `{duration_sec,curve}` or null).
 * A fade is a non-destructive gain ramp at the clip edge, saved on the clip as `fadeIn` /
 * `fadeOut` (`{durationSec,curve}` or null) and applied by the engine live and in exports.
 *
 * The write is absolute and idempotent; an unknown outcome is never retried automatically (the
 * caller reloads canonical state). Undo/Redo send the response's `undo` sides back through the
 * same setter, only while the clip still reports exactly the value this history recorded.
 * Pure: no DOM, no I/O except through the injected client.
 */
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const fail=(message,code='audio_clip_fades_invalid',extra={})=>Object.assign(new Error(message),{code},extra);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export const AUDIO_CLIP_FADES_OPERATION='setClipFades';
export const FADE_CURVES=Object.freeze(['linear','equal_power','exp','log','s_curve']);
export const FADE_CURVE_LABELS=Object.freeze({linear:'Linear',equal_power:'Equal power',exp:'Exponential',log:'Logarithmic',s_curve:'S-curve'});
const EPSILON=1e-6;
const round6=value=>Math.round(value*1e6)/1e6;

/** Gain of a fade-IN shape at x (0 start .. 1 end); 0 and 1 exactly at the ends. Mirrors Mozart's ClipFades.h. */
export function fadeCurveGain(curve,x){
 if(!(x>0))return 0;if(x>=1)return 1;
 switch(curve){
  case 'equal_power':return Math.sin(x*Math.PI/2);
  case 'exp':return x*x;
  case 'log':return 1-(1-x)*(1-x);
  case 's_curve':return x*x*(3-2*x);
  default:return x;
 }
}

/** SVG path data (viewBox 0 0 100 100) for one fade: `line` is the gain curve, `area` the attenuated region above it. */
export function fadeCurvePath(curve,side,steps=24){
 const points=[];for(let index=0;index<=steps;index++){const along=index/steps,gain=fadeCurveGain(curve,side==='out'?1-along:along);points.push([round6(along*100),round6(100-gain*100)]);}
 const line='M'+points.map(point=>point.join(',')).join(' L');
 return {line,area:`${line} L100,0 L0,0 Z`};
}

const normalizeSide=value=>{
 if(value===null)return null;
 if(!record(value)||!finite(value.durationSec)||value.durationSec<0||typeof value.curve!=='string'||!FADE_CURVES.includes(value.curve))return undefined;
 return value.durationSec<=EPSILON?null:{durationSec:value.durationSec,curve:value.curve};
};
/** Saved fades of one normalized audio clip. `known:false` = an older backend (no fadeIn/fadeOut on the clip card) or unreadable. */
export function audioClipFades(clip){
 const raw=clip?.cloudRaw;if(!record(raw)||raw.fadeIn===undefined&&raw.fadeOut===undefined)return {known:false,fadeIn:null,fadeOut:null};
 const fadeIn=normalizeSide(raw.fadeIn),fadeOut=normalizeSide(raw.fadeOut);
 if(fadeIn===undefined||fadeOut===undefined)return {known:false,fadeIn:null,fadeOut:null};
 return {known:true,fadeIn,fadeOut};
}
const sameSide=(a,b)=>a===null||b===null?a===b:Math.abs(a.durationSec-b.durationSec)<=EPSILON&&a.curve===b.curve;
export const sameFades=(a,b)=>!!a&&!!b&&sameSide(a.fadeIn,b.fadeIn)&&sameSide(a.fadeOut,b.fadeOut);

export const fadeSecondsFromBeats=(beats,bpm)=>round6(beats*60/bpm);
export const fadeBeatsFromSeconds=(seconds,bpm)=>seconds*bpm/60;
/** Handle / curve width as a percentage of the clip (0..100). */
export function fadePercent(fade,clipSeconds){return fade&&finite(clipSeconds)&&clipSeconds>0?Math.max(0,Math.min(100,fade.durationSec/clipSeconds*100)):0;}

/** Fade length in beats for a handle dragged to `pointerBeat` (beats from the clip start).
 * Dragging inward grows the fade; the left handle measures from the start, the right from the end.
 * Snap to the grid unless Alt is held; clamped to the clip; a length under a thousandth of a beat is 0. */
export function fadeLengthFromDrag({side,pointerBeat,clipBeats,snapBeats=0,alt=false}){
 if(!finite(pointerBeat)||!finite(clipBeats)||clipBeats<=0)return 0;
 let beats=side==='out'?clipBeats-pointerBeat:pointerBeat;
 beats=Math.max(0,Math.min(clipBeats,beats));
 if(!alt&&finite(snapBeats)&&snapBeats>0)beats=Math.round(beats/snapBeats)*snapBeats;
 beats=Math.max(0,Math.min(clipBeats,beats));
 return beats<1e-3?0:beats;
}

/** Detached plan for one exact persisted audio clip. Sides left `undefined` stay as saved; `null` clears. Pure. */
export function planAudioClipFades(project,{clipId,fadeIn,fadeOut}={}){
 const projectId=project?.cloud?.projectId,clips=Array.isArray(project?.audioClips)?project.audioClips:null;
 if(!id(projectId)||!clips||!id(clipId)||fadeIn===undefined&&fadeOut===undefined)throw fail('Select one exact persisted audio clip and at least one fade side.');
 const matches=clips.filter(clip=>clip?.id===clipId);
 if(matches.length!==1)throw fail('The audio clip is absent or ambiguous. Reload the Playlist.','audio_clip_fades_identity');
 const clip=matches[0],raw=clip.cloudRaw;
 if(clip.patternId||!record(raw)||clip.cloudId!==clipId||raw.id!==clipId)throw fail('The audio clip has no durable saved clip identity. Reload it before setting fades.','audio_clip_fades_identity');
 for(const key of ['projectId','project_id'])if(raw[key]!==undefined&&raw[key]!==projectId)throw fail('The audio clip belongs to another project.','audio_clip_fades_scope');
 const before=audioClipFades(clip);if(!before.known)throw fail('Clip fades need a Freestyle backend that reports them. Reload the project.','audio_clip_fades_unknown');
 const after={fadeIn:fadeIn===undefined?before.fadeIn:fadeIn,fadeOut:fadeOut===undefined?before.fadeOut:fadeOut};
 for(const side of [after.fadeIn,after.fadeOut])if(normalizeSide(side)===undefined)throw fail('A fade needs a finite length and one of the supported curves.');
 const send={};if(fadeIn!==undefined)send.fade_in=fadeIn===null?null:{duration_sec:fadeIn.durationSec,curve:fadeIn.curve};if(fadeOut!==undefined)send.fade_out=fadeOut===null?null:{duration_sec:fadeOut.durationSec,curve:fadeOut.curve};
 return {projectId,clipId,name:clip.name||raw.name||clipId,laneId:clip.laneId,before:{fadeIn:before.fadeIn,fadeOut:before.fadeOut},after,changed:!sameFades(before,after),send};
}

const sideFromWire=value=>value===null?null:record(value)&&finite(value.duration_sec)&&value.duration_sec>=0&&FADE_CURVES.includes(value.curve)?(value.duration_sec<=EPSILON?null:{durationSec:value.duration_sec,curve:value.curve}):undefined;
const sideToWire=value=>value===null?null:{duration_sec:value.durationSec,curve:value.curve};
/** Request body that restores `fades` exactly (both sides). */
export const fadesBody=fades=>({fade_in:sideToWire(fades.fadeIn),fade_out:sideToWire(fades.fadeOut)});

/** Validate one setClipFades 200 body against what was sent. Throws `audio_clip_fades_receipt` (outcome uncertain). */
export function validateClipFadesReceipt(data,{projectId,clipId,send}){
 const bad=message=>fail(message,'audio_clip_fades_receipt',{operationUncertain:true});
 if(!record(data))throw bad('Freestyle returned no clip fades receipt.');
 if(data.projectId!==projectId)throw bad('Freestyle returned a clip fades receipt for another project.');
 if(!record(data.clip)||data.clip.id!==undefined&&data.clip.id!==clipId)throw bad('Freestyle returned a clip fades receipt for another clip.');
 const fadeIn=normalizeSide(data.fadeIn),fadeOut=normalizeSide(data.fadeOut);
 if(fadeIn===undefined||fadeOut===undefined)throw bad('Freestyle returned unreadable saved fades.');
 for(const [key,saved] of [['fade_in',fadeIn],['fade_out',fadeOut]]){
  if(!(key in send))continue;const wanted=sideFromWire(send[key]);
  if(wanted===undefined||!sameSide(wanted,saved))throw bad('Freestyle did not report the requested saved clip fades.');
 }
 if(typeof data.engine_applied!=='boolean'||typeof data.engine_reload_required!=='boolean')throw bad('Freestyle returned an invalid clip fades engine acknowledgement.');
 const undo=data.undo,undoIn=record(undo)?sideFromWire(undo.fade_in):undefined,undoOut=record(undo)?sideFromWire(undo.fade_out):undefined;
 if(!record(undo)||undo.op!=='fades'||undo.clip_id!==clipId||undoIn===undefined||undoOut===undefined)throw bad('Freestyle returned no usable clip fades Undo.');
 return {clipId,fadeIn,fadeOut,changed:data.changed!==false,engineApplied:data.engine_applied,reloadRequired:data.engine_reload_required===true,undo:{fadeIn:undoIn,fadeOut:undoOut},timelineRevision:data.timelineRevision??null};
}

/** True only when the request provably did not change saved state (not sent / explicit 4xx). */
export function clipFadesRejected(error){
 if(error?.operationUncertain===true)return false;
 if(error?.dispatched===false)return true;
 const status=error?.status;return Number.isInteger(status)&&status>=400&&status<500&&status!==408;
}

/** One typed setClipFades write through the generated client. Never retried here. */
export async function sendAudioClipFades(client,{projectId,clipId,send,trackId=null,idempotencyKey=globalThis.crypto?.randomUUID?.()}){
 if(typeof client?.call!=='function')throw fail('Clip fades need the Studio API client.','audio_clip_fades_unavailable',{dispatched:false});
 if(!id(projectId)||!id(clipId)||!record(send)||!('fade_in' in send||'fade_out' in send)||typeof idempotencyKey!=='string')throw fail('Clip fades need an exact project, clip and fade values.','audio_clip_fades_invalid',{dispatched:false});
 const body={...send,...(typeof trackId==='string'&&id(trackId)&&trackId.length<=64?{track_id:trackId}:{})};
 const result=await client.call(AUDIO_CLIP_FADES_OPERATION,{path:{project_id:projectId,clip_id:clipId},body},{idempotencyKey});
 return validateClipFadesReceipt(result?.data,{projectId,clipId,send});
}

/** Retained inverse-value history for confirmed audio clip fade edits (one clip per step). */
export class AudioClipFadesHistory{
 constructor(){this.entries=[];this.busy=false;}
 /** Record only a confirmed change: {projectId,scope,clipId,name,before,after,undo,revision}. */
 record({projectId,scope,clipId,name,before,after,undo,revision}){
  if(!id(projectId)||!id(clipId)||!Number.isInteger(revision)||!before||!after||!undo||sameFades(before,after))throw fail('Only a confirmed saved clip fade change can enter history.');
  const entry={projectId,scope:JSON.stringify(scope??null),clipId,name:name||clipId,before:structuredClone(before),after:structuredClone(after),undo:structuredClone(undo),redo:structuredClone(after),status:'applied',revision};
  this.entries.push(entry);if(this.entries.length>64)this.entries.shift();return entry;
 }
 current({projectId,scope,revision}){const entry=this.entries.at(-1);return entry&&entry.projectId===projectId&&entry.scope===JSON.stringify(scope??null)&&entry.revision===revision?entry:null;}
 canUndo(context){return this.current(context)?.status==='applied';}
 canRedo(context){return this.current(context)?.status==='undone';}
 clear(){this.entries=[];}
 /** Undo sends the response `undo` sides; Redo sends the undo write's own `undo`.
  * send(clipId,body) -> validated receipt; currentValue(clipId) -> {fadeIn,fadeOut}|null;
  * begin(clipId) runs after the guard passes, before the write. */
 async step(context,direction,{send,currentValue,begin=()=>{}}){
  const entry=this.current(context),undo=direction==='undo';
  if(!entry||entry.status!==(undo?'applied':'undone'))throw fail(`There is no current clip fade to ${undo?'undo':'redo'}.`);
  if(this.busy)throw fail('Wait for the current clip fade request.','audio_clip_fades_busy');
  if(!sameFades(currentValue(entry.clipId),undo?entry.after:entry.before))throw fail(`Clip “${entry.name}” fades changed since this edit. ${undo?'Undo':'Redo'} will not guess; reload the Playlist.`,'audio_clip_fades_changed');
  this.busy=true;
  try{
   begin(entry.clipId);
   const target=undo?entry.undo:entry.redo,receipt=await send(entry.clipId,fadesBody(target));
   const inverse={fadeIn:receipt.undo.fadeIn,fadeOut:receipt.undo.fadeOut};if(undo)entry.redo=inverse;else entry.undo=inverse;
   entry.status=undo?'undone':'applied';return {entry,reloadRequired:receipt.reloadRequired};
  }catch(failure){
   if(!clipFadesRejected(failure))entry.status='uncertain';
   throw failure instanceof Error?failure:fail(String(failure));
  }finally{this.busy=false;}
 }
}
