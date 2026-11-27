/** FL Studio-style per-clip audio mute (Mute tool / T on an audio clip).
 *
 * Freestyle publishes `PUT /projects/{project_id}/clips/{clip_id}/mute`
 * (operation `setClipMuted`, body `{muted}`): only that clip goes silent and the
 * rest of its lane keeps playing. A muted lane (Mixer M, `setLaneMute`) still
 * silences every clip, independently. The saved per-clip state is the Clip
 * field `clipMuted`; the Clip `muted` field is only the lane mirror.
 *
 * The write is absolute and idempotent, but an unknown outcome is never
 * retried automatically: the caller reloads canonical state instead.
 * Undo/Redo send the response's `undo.muted` back through the same setter,
 * only while every clip still reports exactly the value this history recorded.
 */
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const fail=(message,code='audio_clip_mute_invalid',extra={})=>Object.assign(new Error(message),{code},extra);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
export const AUDIO_CLIP_MUTE_OPERATION='setClipMuted';

/** Saved per-clip mute of one normalized audio clip: true/false, or null when unreadable. */
export function audioClipMuted(clip){const value=clip?.cloudRaw?.clipMuted;if(value===undefined)return false;return typeof value==='boolean'?value:null;}
export function audioClipMuteTooltip({muted}){
 return `Mute tool: ${muted?'unmutes':'mutes'} only this audio clip; the rest of its track keeps playing. The Mixer track mute is separate.`;
}
export function audioClipMuteLabel({names=[],muted,count}){
 const total=Number.isInteger(count)?count:names.length,first=names[0]||'audio clip';
 return `${muted?'Muted':'Unmuted'} ${total>1?`${total} audio clips`:`audio clip “${first}”`} — the rest of the track keeps playing.`;
}
export function audioClipMuteReloadMessage(count=1){
 return `Clip mute saved${count>1?` for ${count} clips`:''}, but the live engine did not apply it. Reload the project to hear the change.`;
}

/** Detached plan for exact persisted audio clips. Already-matching clips are skipped. Pure. */
export function planAudioClipMute(project,{clipIds,muted}={}){
 const projectId=project?.cloud?.projectId,clips=Array.isArray(project?.audioClips)?project.audioClips:null;
 if(!id(projectId)||!clips||!Array.isArray(clipIds)||!clipIds.length||clipIds.length>256||clipIds.some(value=>!id(value))||new Set(clipIds).size!==clipIds.length||typeof muted!=='boolean')throw fail('Select exact persisted audio clip identities and an explicit boolean mute state.');
 const changes=[];
 for(const clipId of clipIds){
  const matches=clips.filter(clip=>clip?.id===clipId);
  if(matches.length!==1)throw fail('The audio clip is absent or ambiguous. Reload the Playlist.','audio_clip_mute_identity');
  const clip=matches[0],raw=clip.cloudRaw;
  if(clip.patternId||!record(raw)||clip.cloudId!==clipId||raw.id!==clipId)throw fail('The audio clip has no durable saved clip identity. Reload it before muting.','audio_clip_mute_identity');
  for(const key of ['projectId','project_id'])if(raw[key]!==undefined&&raw[key]!==projectId)throw fail('The audio clip belongs to another project.','audio_clip_mute_scope');
  const before=audioClipMuted(clip);if(before===null)throw fail('Reload the saved clip mute before toggling it.','audio_clip_mute_unknown');
  if(before===muted)continue;
  changes.push({clipId,name:clip.name||raw.name||clipId,laneId:clip.laneId,before,muted});
 }
 return {projectId,changed:changes.length>0,changes};
}

/** Validate one setClipMuted 200 body. Throws `audio_clip_mute_receipt` (outcome uncertain). */
export function validateClipMuteReceipt(data,{projectId,clipId,muted}){
 const bad=message=>fail(message,'audio_clip_mute_receipt',{operationUncertain:true});
 if(!record(data))throw bad('Freestyle returned no clip mute receipt.');
 if(data.projectId!==projectId)throw bad('Freestyle returned a clip mute receipt for another project.');
 if(!record(data.clip)||data.clip.id!==undefined&&data.clip.id!==clipId)throw bad('Freestyle returned a clip mute receipt for another clip.');
 if(data.clipMuted!==muted||data.clip.clipMuted!==undefined&&data.clip.clipMuted!==muted)throw bad('Freestyle did not report the requested saved clip mute.');
 if(typeof data.engine_applied!=='boolean'||typeof data.engine_reload_required!=='boolean')throw bad('Freestyle returned an invalid clip mute engine acknowledgement.');
 const undo=data.undo;if(!record(undo)||undo.op!=='mute'||undo.clip_id!==clipId||typeof undo.muted!=='boolean')throw bad('Freestyle returned no usable clip mute Undo.');
 return {clipId,clipMuted:data.clipMuted,changed:data.changed!==false,engineApplied:data.engine_applied,reloadRequired:data.engine_reload_required===true,undo:{muted:undo.muted},timelineRevision:data.timelineRevision??null,clip:structuredClone(data.clip)};
}

/** True only when the request provably did not change saved state (not sent / explicit 4xx). */
export function clipMuteRejected(error){
 if(error?.operationUncertain===true)return false;
 if(error?.dispatched===false)return true;
 const status=error?.status;return Number.isInteger(status)&&status>=400&&status<500&&status!==408;
}

/** One typed setClipMuted write through the generated client. Never retried here. */
export async function sendAudioClipMute(client,{projectId,clipId,muted,trackId=null,idempotencyKey=globalThis.crypto?.randomUUID?.()}){
 if(typeof client?.call!=='function')throw fail('Per-clip audio mute needs the Studio API client.','audio_clip_mute_unavailable',{dispatched:false});
 if(!id(projectId)||!id(clipId)||typeof muted!=='boolean'||typeof idempotencyKey!=='string')throw fail('Clip mute needs an exact project, clip and boolean value.','audio_clip_mute_invalid',{dispatched:false});
 const body={muted,...(typeof trackId==='string'&&id(trackId)&&trackId.length<=64?{track_id:trackId}:{})};
 const result=await client.call(AUDIO_CLIP_MUTE_OPERATION,{path:{project_id:projectId,clip_id:clipId},body},{idempotencyKey});
 return validateClipMuteReceipt(result?.data,{projectId,clipId,muted});
}

/** Retained inverse-value history for confirmed per-clip audio mutes. */
export class AudioClipMuteHistory{
 constructor(){this.entries=[];this.busy=false;}
 /** Record only confirmed changes: [{clipId,name,before,after,undoMuted}]. */
 record({projectId,scope,changes,revision}){
  if(!id(projectId)||!Array.isArray(changes)||!changes.length||!Number.isInteger(revision)||changes.some(change=>!id(change?.clipId)||typeof change.before!=='boolean'||typeof change.after!=='boolean'||change.before===change.after||typeof change.undoMuted!=='boolean'))throw fail('Only confirmed saved clip mute changes can enter history.');
  const entry={projectId,scope:JSON.stringify(scope??null),changes:changes.map(change=>({clipId:change.clipId,name:change.name||change.clipId,before:change.before,after:change.after,undoMuted:change.undoMuted,redoMuted:change.after})),status:'applied',revision};
  this.entries.push(entry);if(this.entries.length>64)this.entries.shift();return entry;
 }
 current({projectId,scope,revision}){const entry=this.entries.at(-1);return entry&&entry.projectId===projectId&&entry.scope===JSON.stringify(scope??null)&&entry.revision===revision?entry:null;}
 canUndo(context){return this.current(context)?.status==='applied';}
 canRedo(context){return this.current(context)?.status==='undone';}
 clear(){this.entries=[];}
 /** Undo sends each response `undo.muted`; Redo sends the undo write's own `undo.muted`.
  * send(clipId,value) -> validated receipt; currentValue(clipId) -> boolean|null;
  * begin(changes,value) runs after the guard passes, before the first write. */
 async step(context,direction,{send,currentValue,begin=()=>{}}){
  const entry=this.current(context),undo=direction==='undo';
  if(!entry||entry.status!==(undo?'applied':'undone'))throw fail(`There is no current clip mute to ${undo?'undo':'redo'}.`);
  if(this.busy)throw fail('Wait for the current clip mute request.','audio_clip_mute_busy');
  for(const change of entry.changes){const expected=undo?change.after:change.before;if(currentValue(change.clipId)!==expected)throw fail(`Clip “${change.name}” mute changed since this edit. ${undo?'Undo':'Redo'} will not guess; reload the Playlist.`,'audio_clip_mute_changed');}
  this.busy=true;const applied=[];let reloadRequired=false;
  try{
   begin(entry.changes.map(change=>({clipId:change.clipId,muted:undo?change.undoMuted:change.redoMuted})));
   for(const change of entry.changes){
    const value=undo?change.undoMuted:change.redoMuted,receipt=await send(change.clipId,value);
    if(undo)change.redoMuted=receipt.undo.muted;else change.undoMuted=receipt.undo.muted;
    reloadRequired||=receipt.reloadRequired;applied.push(change.clipId);
   }
   entry.status=undo?'undone':'applied';return {entry,applied,reloadRequired};
  }catch(failure){
   // Any confirmed partial step or an unknown outcome leaves this entry unusable.
   if(applied.length||!clipMuteRejected(failure))entry.status='uncertain';
   throw Object.assign(failure instanceof Error?failure:fail(String(failure)),{applied});
  }finally{this.busy=false;}
 }
}
