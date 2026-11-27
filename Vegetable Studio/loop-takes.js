/** FL Studio loop recording with stacked takes (audit rows R04 / T14).
 *
 * With "Loop recording" on and a loop range set, Mozart cuts ONE continuous
 * microphone take at every transport loop wrap (LoopPassSplit.h) and reports
 * the passes in the take_stop receipt (`loop_passes`: capture window + song
 * position of each pass). The browser still uploads its single capture file
 * once; this module turns that one clip into one clip per pass (windows of the
 * same source: no re-upload), stacks them as a take group (`groupTakes`, the
 * newest audible, older ones clip-muted) and builds the Clip menu's Takes
 * picker. Everything here is pure except `stackLoopTakes`, which goes through
 * the generated Studio API client.
 */
const MIN_PASS_SEC=0.05,MAX_PASSES=64;
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const fail=(message,code='loop_take_invalid',extra={})=>Object.assign(new Error(message),{code},extra);

/** The loop range to record over, or null (ordinary recording). `clock` is the engine transport clock. */
export function loopRecordRange(enabled,clock){
 if(enabled!==true||!clock||clock.loopEnabled!==true)return null;
 const start=Number(clock.loopStartSec),end=Number(clock.loopEndSec);
 return Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end-start>=0.5?{startSec:start,endSec:end}:null;
}

/** take_start fields for a loop-record take; {} for an ordinary one. */
export function loopTakeStartFields(range){return range?{loop_takes:true,loop_start_sec:range.startSec,loop_end_sec:range.endSec}:{};}

/** Per-pass clip windows from Mozart's `loop_passes` and the uploaded clip
 * ({startMs,durationSec,audioOffsetSec}). File time c plays at song time
 * song_start + (c - capture_start) of its pass; the saved single clip's own
 * placement shift (latency trim) is applied to every pass alike. Passes under
 * 50 ms are dropped. Returns [] when fewer than two passes remain. */
export function loopPassWindows(passes,clip){
 if(!Array.isArray(passes)||passes.length<2||passes.length>MAX_PASSES)return[];
 if(!clip||!finite(clip.startMs)||!finite(clip.audioOffsetSec)&&clip.audioOffsetSec!==undefined)return[];
 const base=clip.audioOffsetSec||0,first=passes[0],shift=clip.startMs-Math.round(1000*((Number(first.song_start_sec)||0)+base));
 const fileEnd=finite(clip.durationSec)?base+clip.durationSec:Infinity,out=[];
 for(const pass of passes){
  const song=Number(pass?.song_start_sec),cs=Number(pass?.capture_start_sec);let ce=Number(pass?.capture_end_sec);
  if(!Number.isFinite(song)||!Number.isFinite(cs)||cs<0)return[];
  if(!Number.isFinite(ce)||ce<0)ce=fileEnd; // the open (last) pass runs to the end of the file
  const offset=out.length===0&&pass===first?Math.max(cs,base):cs,end=Math.min(ce,fileEnd);
  if(!(end-offset>=MIN_PASS_SEC))continue;
  out.push({audio_offset_sec:offset,duration_sec:end-offset,start_ms:Math.max(0,pass===first?clip.startMs:Math.round(1000*song)+shift)});
 }
 return out.length>=2?out:[];
}

/** applyClipBatch ops: the uploaded clip becomes pass 0, one insert per later pass (same source). */
export function loopTakeBatchOps(clip,windows,idFactory=()=>globalThis.crypto.randomUUID()){
 if(!id(clip?.id)||windows.length<2)throw fail('Loop takes need the saved clip and two or more pass windows.');
 const ops=[{op:'update',id:clip.id,...windows[0],expected:{start_ms:clip.startMs,duration_sec:clip.durationSec,audio_offset_sec:clip.audioOffsetSec||0}}],ids=[clip.id];
 for(const window of windows.slice(1)){const next=idFactory();if(!id(next)||ids.includes(next))throw fail('A loop take needs a fresh clip identity.');ids.push(next);ops.push({op:'insert',id:next,source_id:clip.id,...window});}
 return{ops,ids};
}

/** Cut the uploaded clip into passes and stack them. Never retried; the caller reloads canonical state. */
export async function stackLoopTakes(client,{projectId,clip,passes,trackId=null,idFactory}){
 if(typeof client?.call!=='function')throw fail('Loop takes need the Studio API client.','loop_take_unavailable');
 const windows=loopPassWindows(passes,clip);if(windows.length<2)return{stacked:false,reason:'single-pass'};
 const {ops}=loopTakeBatchOps(clip,windows,idFactory),scope=typeof trackId==='string'&&id(trackId)?{track_id:trackId}:{};
 const batch=await client.call('applyClipBatch',{path:{project_id:projectId},body:{ops,...scope}},{idempotencyKey:globalThis.crypto.randomUUID()});
 const inserted=(batch?.data?.inserted||[]).map(item=>item?.clipId);
 if(inserted.length!==windows.length-1||inserted.some(value=>!id(value)))throw fail('Freestyle did not confirm every loop take clip. Reload the project and check the lane.','loop_take_batch_unconfirmed',{operationUncertain:true});
 const clipIds=[clip.id,...inserted];
 const grouped=await client.call('groupTakes',{path:{project_id:projectId},body:{clip_ids:clipIds,...scope}},{idempotencyKey:globalThis.crypto.randomUUID()});
 const data=grouped?.data;
 if(!data||data.projectId!==projectId||!id(data.groupId)||!Array.isArray(data.takes)||data.takes.length!==clipIds.length)throw fail('Freestyle did not confirm the take stack.','loop_take_group_unconfirmed',{operationUncertain:true});
 return{stacked:true,groupId:data.groupId,activeClipId:data.activeClipId,clipIds,engineApplied:data.engine_applied===true,reloadRequired:data.engine_reload_required===true};
}

/** The saved takes of `clip`'s stack, oldest first: [{clipId,index,name,muted}]; [] for an ordinary clip. */
export function takeStack(audioClips,clip){
 const group=clip?.cloudRaw?.takeGroupId;if(!id(group))return[];
 return(audioClips||[]).filter(item=>item?.cloudRaw?.takeGroupId===group).map(item=>({clipId:item.id,index:Number(item.cloudRaw.takeIndex)||0,name:item.name||item.cloudRaw.name||item.id,laneId:item.laneId,muted:item.cloudRaw.clipMuted===true})).sort((a,b)=>a.index-b.index||String(a.clipId).localeCompare(String(b.clipId)));
}

/** Clip menu ▸ Takes ▸ pick one: the per-clip mutes that make `pickId` the only audible take (already-correct clips are skipped). */
export function takePickChanges(stack,pickId,mutedNow=take=>take.muted){
 if(!stack.some(take=>take.clipId===pickId))throw fail('That take is not part of this stack.');
 const changes=[];
 for(const take of stack){const want=take.clipId!==pickId,before=mutedNow(take);if(before===null||before===undefined)throw fail('Reload the saved clip mutes before choosing a take.','loop_take_unknown');if(before!==want)changes.push({clipId:take.clipId,name:take.name,laneId:take.laneId,before,muted:want});}
 return changes;
}

/** Menu entries for the Takes submenu. */
export function takeMenuItems(stack,run,mutedNow=take=>take.muted){
 return stack.map((take,position)=>({label:`Take ${position+1}`,checked:mutedNow(take)===false,run:()=>run(take.clipId)}));
}
