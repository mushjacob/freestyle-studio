/** Pure plans for pattern placement mute. Audio clips have their own per-clip
 * contract (`setClipMuted`, see audio-clip-mute.js); pattern sources and
 * MIDI/sample notes are different targets.
 * This module never substitutes gain/velocity zero for an unsupported mute.
 */
import {assertCompleteCanonicalData} from './cloud-session.js';
const copy=value=>structuredClone(value),record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const fail=(message,code='item_mute_unsupported')=>Object.assign(new Error(message),{code});
export function itemMuteSupport(kind){
 if(kind==='pattern-placement')return {supported:true,action:'update_pattern_placement',field:'placement.muted'};
 // FL-style per-clip audio mute: PUT /clips/{clip_id}/mute (audio-clip-mute.js). Lane mute stays separate.
 if(kind==='audio-clip')return {supported:true,action:'setClipMuted',field:'clip.clipMuted'};
 if(kind==='note')return {supported:false,reason:'Freestyle has not published a per-note mute playback contract. Velocity zero is not a mute replacement.'};
 return {supported:false,reason:'Choose a canonical pattern timeline clip to mute an individual item.'};
}
/** Capture a complete canonical placement and change only its real muted flag.
 * Returned project/actions are detached; no local acceptance or engine write occurs.
 */
export function planPatternClipMute(project,{clipIds,muted}={}){
 const projectId=project?.cloud?.projectId;
 if(!id(projectId)||project.id!==undefined&&project.id!==projectId||!Array.isArray(project.clips)||!Array.isArray(clipIds)||!clipIds.length||clipIds.length>256||clipIds.some(value=>!id(value))||new Set(clipIds).size!==clipIds.length||typeof muted!=='boolean')throw fail('Select exact persisted pattern clip identities and an explicit boolean mute state.','item_mute_invalid');
 const changes=[];
 for(const clipId of clipIds){
  const matches=project.clips.filter(clip=>clip?.id===clipId);
  if(matches.length!==1)throw fail('The pattern clip is absent or ambiguous. Reload its canonical placement.','item_mute_identity');
  const clip=matches[0],raw=clip.cloudRaw;assertCompleteCanonicalData(raw,'canonical pattern mute placement');
  if(!record(raw)||!id(clip.cloudId)||clip.cloudId!==clipId||[raw.id,raw.placement_id].filter(value=>value!==undefined).some(value=>value!==clip.cloudId)||raw.id===undefined&&raw.placement_id===undefined||project.clips.filter(item=>item.cloudId===clip.cloudId).length!==1)throw fail('The pattern clip has no unique durable canonical placement identity.','item_mute_identity');
  for(const key of ['projectId','project_id'])if(raw[key]!==undefined&&raw[key]!==projectId)throw fail('The placement belongs to another project.','item_mute_scope');
  const patterns=[raw.patternId,raw.pattern_id].filter(value=>value!==undefined),lanes=[raw.laneId,raw.lane_id].filter(value=>value!==undefined);
  if(!patterns.length||patterns.some(value=>!id(value)||value!==patterns[0])||!lanes.length||lanes.some(value=>!id(value)||value!==lanes[0])||raw.muted!==undefined&&typeof raw.muted!=='boolean')throw fail('Reload a complete canonical pattern/lane binding and boolean placement mute.','item_mute_identity');
  if((raw.muted??false)===muted)continue;
  changes.push({clipId,placementId:clip.cloudId,before:copy(raw),placement:{...copy(raw),muted},action:'update_pattern_placement',arguments:{placement_id:clip.cloudId,placement:{...copy(raw),muted}}});
 }
 const next=copy(project);for(const change of changes)next.clips.find(clip=>clip.id===change.clipId).cloudRaw=copy(change.placement);
 return {projectId,changed:changes.length>0,changes,project:next};
}
