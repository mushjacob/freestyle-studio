import {applyLaneRowHints,laneRowHints} from './playlist-row-hints.js';
import {resolvedStepPianoPattern,isStepPianoNote,stepPianoEventId,retiredStepKey,retireSampleStep,retiredSampleStep} from './step-piano.js';
/** Authoritative Freestyle cloud DAW session; no local instruments or audio rendering. */
import {patternLengthBeats} from './pattern-preview.js';
import {placementTiming,wholePhaseMs,wholePlacementMs} from './playlist-edits.js';
import {typedActionCapability,typedIdentityActionArguments} from './cloud-action-contract.js';
import {canonicalMidiInput,canonicalInstrumentNoteRequest,canonicalMidiWriteConfirmed} from './canonical-midi-notes.js';
import {studioCompatibleRequest,adoptClipBatchEtag,adoptStudioWrite} from './studio-api-bridge.js';
import {projectClipBatchReceipt} from './cloud-clip-batch-receipt.js';
import {capturePlaylistMove,executePlaylistMove,projectPlaylistMove} from './cloud-playlist-move.js';
import {STUDIO_API_OPERATIONS,StudioApiClient} from './studio-api-client.js';
import {placementBatchSupported,placementBatchReceipt,validatePlacementBatchOps,placementBatchUnavailable,redactPlacementBatchOps,createPlacementOp,updatePlacementOp,deletePlacementOp,PLACEMENT_BATCH_LIMIT} from './cloud-placement-batch.js';
import {retainPlacementDeleteUndo,redactPlacementRestoreSecrets} from './cloud-placement-restore.js';
import {placementPhaseWritable as declaredPlacementPhaseWritable} from './cloud-placement-history.js';
import {mixValuesEqual,liveLaneValues,mixControlValue,isMixRevisionConflict} from './mix-revision.js';
import {embedded} from './freestyle-host-transport.js';
/** The live engine mix per project (MixRevisionTracker: getEngineMix seed,
 * mix:wait, acknowledged writes). Live is what you hear, so lane channels show
 * it whenever it is known (FL has one value per control); the saved lane row
 * stays in cloudRaw and catches up through the mixer's saved writes. A
 * canonical re-read therefore never paints an older saved value over it. */
const LIVE_MIX=new Map();
export function setLiveMixOverlay(projectId,mix){if(typeof projectId!=='string'||!projectId)return;if(mix&&typeof mix==='object'&&Array.isArray(mix.tracks)&&(mix.projectId==null||mix.projectId===projectId))LIVE_MIX.set(projectId,mix);else LIVE_MIX.delete(projectId);}
export function clearLiveMixOverlays(){LIVE_MIX.clear();}
export function liveMixOverlay(projectId){return LIVE_MIX.get(projectId)??null;}
const array = value => Array.isArray(value) ? value : [];
const numeric = (value,fallback=0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const hasLoopClock=value=>typeof value?.loop_enabled==='boolean'&&['loop_start_sec','loop_end_sec'].every(key=>value[key]!=null&&Number.isFinite(Number(value[key]))&&Number(value[key])>=0);
function authoritativeTransportAcknowledgement(result,projectId){
  const source=result?.status&&typeof result.status==='object'?result.status:result?.ack?.status||result?.clock||result;
  if(!source||typeof source!=='object'||Array.isArray(source))return false;
  for(const value of [result,result?.ack,source]){if(value?.ok===false||value?.error||value?.isError)return false;for(const key of ['projectId','project_id'])if(value?.[key]!=null&&value[key]!==projectId)return false;}
  const playing=source.is_playing??source.isPlaying,position=source.position_seconds??source.position;
  if(typeof playing!=='boolean'||typeof position!=='number'||!Number.isFinite(position)||position<0)return false;
  if(source.is_playing!==undefined&&source.isPlaying!==undefined&&source.is_playing!==source.isPlaying)return false;
  if(source.position_seconds!==undefined&&source.position!==undefined&&source.position_seconds!==source.position)return false;
  return true;
}
// Published compose-family capabilities are MCP-only, including their reads.
const MCP_ONLY_ACTIONS=new Set(['compose','detect_tempo','analyze_song_sections','find_splice_sounds','find_sounds','listen_back','set_instrument_patch','add_groove','analyze_harmony','separate_stems','stem_status','replace_stem_part','adjust_volume','add_808','add_hat_rolls','compose_song','audit_arrangement','read_skill','refine_song','search_patches','set_patch','audition_patch','listen','mix_check','song_brief','restore_original','remove_track','swap_sound','align_to_beat','add_drum_hits','set_pattern_steps','write_pattern_notes','add_instrument_track']);
// Native preview and mixer writes can exceed the socket acknowledgement deadline.
// Choose the verified MCP route before dispatch; never replay a timed-out write.
const MCP_SLOW_ACK_ACTIONS=new Set(['preview_pattern','preview_pattern_sample','stop_all_pattern_previews','set_track_gain','set_track_muted','set_track_soloed']);
// Read fencing: a canonical read that overlapped a project mutation (or was
// overtaken by a newer applied read) can carry the pre-write project. Adopting
// it lets the next whole-score write erase the acknowledged edit (QA lost rack
// clicks this way), so such reads are re-read or discarded, never adopted.
const NON_MUTATING_CALLS=new Set(['convert_musical_time','listen_to_project','export_mix','open_interactive_session','close_interactive_session','transport_control']);
const NON_MUTATING_ACTIONS=new Set(['preview_pattern','preview_pattern_sample','stop_all_pattern_previews','start_stream','stop_stream','get_history']);
export function projectMutationCall(name,args){if(typeof name!=='string'||/^(get|list|browse|search)_/.test(name)||NON_MUTATING_CALLS.has(name))return false;if(name==='execute_pro_action')return !NON_MUTATING_ACTIONS.has(args?.action)&&!/^(get|list)_/.test(String(args?.action||''));return true;}
const READ_STALE=Symbol('stale canonical read'),READ_FENCE_ATTEMPTS=3,READ_FENCE_WAIT_MS=5000;
const uid = () => globalThis.crypto?.randomUUID?.() || `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const PLACEMENT_WRITES=new Set(['create_pattern_placement','update_pattern_placement','delete_pattern_placement']);
// QA round 19: audio clip writes of one edit (shift then trim, erase) chain the
// timeline revision each returns, like placement writes, instead of inheriting
// the bridge's cached read tag (which a previous write of the same edit made stale).
const CHAINED_TIMELINE_WRITES=new Set(['shift_clip','trim_clip','delete_clip']);
/** FL's default step velocity (100 of 128). */
export const DEFAULT_STEP_VELOCITY=100/128;
/** Audio clip rows are stored at whole milliseconds and 6-decimal seconds. */
export const storedClipMs=value=>Math.round(value);
export const storedClipSeconds=value=>Math.round(value*1e6)/1e6;
// In-place saved writes whose acknowledged payload fully determines the saved row.
const PROJECTABLE_WRITES=new Set(['update_pattern','update_pattern_placement','delete_pattern_placement','apply_pattern_placement_batch']);
PLACEMENT_WRITES.add('restore_pattern_placement');
// Signed undo capabilities never enter public session fields or action events.
const placementUndoStores=new WeakMap();
// Signed inverse ops of acknowledged placement batches (restore tokens), handed
// once to history; events and diagnostics only ever see redacted copies.
const placementBatchInverseStores=new WeakMap();
function redactedPlacementError(error,handle){const safe=redactPlacementRestoreSecrets(error,handle);return Object.assign(new Error(safe.message||'The signed placement operation failed.'),safe);}
const timelineRevisionValue=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\r\n]/.test(value)||Number.isSafeInteger(value)&&value>=0?value:undefined;
/** Preserve the bridge's bounded diagnostic fields without interpreting an
 * engine-dispatch HTTP400 as proof that a mutation could not have committed. */
export function cloudOperationError(result,{status,fallback='Freestyle could not complete the operation.'}={}){
 const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value),identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value),queue=[{value:result,depth:0}],layers=[],seen=new WeakSet();
 while(queue.length&&layers.length<32){const {value,depth}=queue.shift();if(!record(value)||depth>4||seen.has(value))continue;seen.add(value);layers.push(value);for(const key of ['result','structuredContent','response','error','data'])if(record(value[key]))queue.push({value:value[key],depth:depth+1});}
 const fields={};let message=null,knownNotApplied=false;
 for(const value of layers){const human=typeof value.detail==='string'&&value.detail.trim()?value.detail:typeof value.message==='string'&&value.message.trim()?value.message:typeof value.error==='string'&&!/^(?:freestyle_error|engine_error|mcp_error|cloud_error)$/.test(value.error)?value.error:null;if(human)message=human.slice(0,1600);if(identifier(value.code)||Number.isInteger(value.code))fields.code=value.code;if(identifier(value.stage))fields.stage=value.stage;if(Number.isInteger(value.engineStatus)&&value.engineStatus>=0&&value.engineStatus<=599||identifier(value.engineStatus))fields.engineStatus=value.engineStatus;for(const key of ['retryAfterSec','retryAfterMs'])if(typeof value[key]==='number'&&Number.isFinite(value[key])&&value[key]>=0)fields[key]=value[key];if(typeof value.retryable==='boolean')fields.retryable=value.retryable;if(record(value.details)&&!fields.details)fields.details=Object.fromEntries(Object.entries(value.details).filter(([,item])=>typeof item==='string'||typeof item==='number'&&Number.isFinite(item)));if(value.applied===false)knownNotApplied=true;}
 const observedStatus=status??layers.flatMap(value=>[value.status,value.statusCode,value.upstreamStatus]).find(value=>Number.isInteger(value)&&value>=100&&value<=599),dispatch=fields.code==='engine_error'||fields.stage==='engine_dispatch'||Number(fields.engineStatus)>=500,uncertain=!knownNotApplied&&(dispatch||observedStatus>=500||observedStatus===408);
 // 2026-11-11 updatePattern: bars + lengthTicks that disagree is 400 with
 // details.expectedBars. Nothing was written; say so plainly (the edit queue
 // rolls the model back to the re-read saved pattern).
 const expectedBars=Number(fields.details?.expectedBars);if(observedStatus===400&&Number.isFinite(expectedBars)&&expectedBars>0){message=`Freestyle refused this pattern length: its bars and length in ticks disagree (Freestyle expected ${expectedBars} bar${expectedBars===1?'':'s'}). Nothing was saved; the pattern keeps its saved length.`;fields.patternLengthRefused=true;}
 return Object.assign(new Error(message||fallback),fields,{...(observedStatus!==undefined?{status:observedStatus}:{}),result:result?.structuredContent??result,explicitRejection:!uncertain,operationUncertain:uncertain,...(knownNotApplied?{applied:false}:{}),...(layers.some(value=>value.isError===true)?{mcpRejected:!uncertain}:{})});
}
function unpack(result) {
  let data=result?.structuredContent;
  if (!data) { try { data=JSON.parse(array(result?.content).filter(x=>x.type==='text').map(x=>x.text).join('\n')); } catch { data=result; } }
  const response=data?.response ?? data;
  // clips:batch postCommitError is a COMMITTED 200, never a rejection.
  const committedWithPostError=!!response?.postCommitError&&typeof response.postCommitError==='object'&&response.applied!==false&&!result?.isError;
  if (!committedWithPostError&&(result?.isError || data?.error || data?.ok===false || response?.error || response?.ok===false)) {
    throw cloudOperationError({...result,structuredContent:data});
  }
  return data;
}
const DEFAULT_CONTEXT_CALLS=new Set(['execute_pro_action','get_pro_state','transport_control','apply_clip_batch']);
const LANE_CONTEXT_CALLS=new Set(['list_lane_plugin_parameters','list_plugins','get_plugin_state','set_plugin_parameter','set_plugin_bypassed']);
const BUS_CONTEXT_CALLS=new Set(['list_bus_plugin_parameters']);
const CLIP_CONTEXT_CALLS=new Set(['get_clip_waveform']);
function omitVerifiedDefaultContext(session,name,args){
  const saved=session?.rawProject,metadata=saved?._studioApi,projectId=session?.projectId;
  if(!(DEFAULT_CONTEXT_CALLS.has(name)||LANE_CONTEXT_CALLS.has(name)&&typeof args?.lane_id==='string'&&args.lane_id||BUS_CONTEXT_CALLS.has(name)&&typeof args?.bus_id==='string'&&args.bus_id||CLIP_CONTEXT_CALLS.has(name)&&typeof args?.clip_id==='string'&&args.clip_id)||!args||typeof args.track_id!=='string'||!metadata||typeof metadata!=='object'||Array.isArray(metadata)||saved.id!==projectId||args.project_id!==projectId||metadata.projectId!=null&&metadata.projectId!==projectId||!Array.isArray(saved.clips)||hasCanonicalTruncation(saved.clips)||saved.truncated?.clips===true||saved.clipsTruncated===true||saved.clips_truncated===true)return args;
  if(saved.clips.some(clip=>!clip||typeof clip.id!=='string'||!clip.id||clip.deleted!=null&&typeof clip.deleted!=='boolean'||clip.isBacking!=null&&typeof clip.isBacking!=='boolean'))return args;
  const first=saved.clips.find(clip=>!clip.deleted&&!clip.isBacking);if(first?.id!==args.track_id)return args;
  // The default session is already selected by this exact canonical take.
  // Sending it again can reload Mozart. Preserve nested action target IDs and
  // media APIs whose track_id denotes an actual destination rather than scope.
  const forwarded={...args};delete forwarded.track_id;return forwarded;
}
async function defaultCall(name,args,options={}) {
  const {response:res,data,request}=await studioCompatibleRequest(name,omitVerifiedDefaultContext(this,name,args),options);
  if(!res.ok)throw Object.assign(cloudOperationError(data,{status:res.status,fallback:`Freestyle returned HTTP ${res.status}.`}),{studioRequest:request,idempotencyKey:request.idempotencyKey});return unpack(data);
}
function body(result) { return result?.response ?? result; }
function emit(target,type,detail) { target.dispatchEvent(new CustomEvent(type,{detail})); }
function splitResult(result){
  const data=body(unpack(result));assertCompleteCanonicalData(data,'pattern split receipt');
  const visit=value=>{if(!value||typeof value!=='object')return;if(value.ok===false||value.isError===true||value.error)throw new Error(typeof value.error==='string'?value.error:value.message||'Freestyle rejected the pattern split.');for(const child of Object.values(value))visit(child);};visit(data);
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Freestyle did not return a pattern split receipt.');return data;
}
function assertSplitSnapshot(receipt,placementId,childId){
  splitResult(receipt);
  if(String(receipt.left?.id||'')!==placementId||String(receipt.right?.id||'')!==childId||!receipt.before||typeof receipt.before!=='object'||Array.isArray(receipt.before)||!Object.keys(receipt.before).length)throw new Error('Freestyle returned an incomplete pattern split identity or undo snapshot.');
}
function assertCompletePlacement(placement){
  assertCompleteCanonicalData(placement,'canonical pattern placement');
  if(!placement||typeof placement!=='object'||typeof placement.id!=='string'||!placement.id||!placement.patternId||!placement.laneId||!['startMs','durationMs','loopDurationMs','repeatCount','offsetMs','loopPhaseMs'].every(key=>placement[key]!=null&&Number.isFinite(Number(placement[key])))||Number(placement.startMs)<0||Number(placement.durationMs)<=0||Number(placement.loopDurationMs)<=0||Number(placement.repeatCount)<1||Number(placement.offsetMs)<0||!Object.hasOwn(placement,'windowMs')||(placement.windowMs!==null&&(!Number.isFinite(Number(placement.windowMs))||Number(placement.windowMs)<=0))||!placement.sourceBusOverrides||typeof placement.sourceBusOverrides!=='object'||Array.isArray(placement.sourceBusOverrides))throw new Error('Freestyle returned an incomplete canonical pattern placement. Reload its full timing and routing data before editing.');
  return placement;
}
function patternId(pattern) { return typeof pattern==='string'?pattern:pattern?.cloudId || pattern?.id; }
function channelName(channel) { return typeof channel==='string'?channel:channel?.cloudName || channel?.name || channel?.id; }
function channelLane(channel) { return typeof channel==='string'?channel:channel?.laneId || channel?.cloudTrackId || channel?.id || channel?.name; }
/** Canonical native pattern DTO documented by Freestyle's public browser client. */
function patternDTO(entry) { return entry?.data?.pattern ? entry.data : entry || {}; }
function patternContent(entry) { const dto=patternDTO(entry);return dto.pattern || {sources:[],events:[]}; }
/** Budget sentinels are not musical events and must never reach a write/preview. */
export function hasCanonicalTruncation(value,seen=new WeakSet()){
  if(!value||typeof value!=='object'||seen.has(value))return false;seen.add(value);
  const marked=v=>{if(v===false||v===0||v===''||v==null)return false;if(typeof v==='object')return Object.values(v).some(marked);return true;};
  for(const [key,child]of Object.entries(value)){
    if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&marked(child))return true;
    if(hasCanonicalTruncation(child,seen))return true;
  }
  return false;
}
export function assertCompleteCanonicalData(value,label='canonical pattern'){
  if(hasCanonicalTruncation(value))throw new Error(`Freestyle returned an incomplete ${label}. Reload its full canonical data before editing or previewing to preserve every event.`);
  return value;
}
/** Accept a native DTO or a normalized view carrying cloudRaw; return its DTO. */
export function assertCompletePattern(entry){
  const raw=entry?.cloudRaw??entry;assertCompleteCanonicalData(raw);const dto=patternDTO(raw),content=dto.pattern;
  if(!content||typeof content!=='object'||!Array.isArray(content.sources)||!Array.isArray(content.events))throw new Error('Freestyle has not returned the full canonical pattern. Reload its sources and events before editing or previewing.');
  if(content.sources.some(source=>!source||typeof source!=='object'||source.id==null)||content.events.some(event=>!event||typeof event!=='object'||typeof event.type!=='string'||!event.type))throw new Error('Freestyle returned an incomplete canonical pattern event or source. Reload the full pattern before editing or previewing.');
  return dto;
}
const ownField=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const patternSourceKey=(patternId,sourceId)=>JSON.stringify([String(patternId),String(sourceId)]);
const sampleStepKey=(sourceId,tick)=>JSON.stringify([String(sourceId),Number(tick)]);
const unpitchedSampleStep=event=>event?.type==='sample'&&event.durationTick==null&&event.tick!=null&&Number.isFinite(Number(event.tick));
function protectedSampleStepKeys(events){return new Set(events.filter(event=>unpitchedSampleStep(event)&&event.velocity===0).map(event=>sampleStepKey(event.sourceId,event.tick)));}
function setPatternField(object,key,value){Object.defineProperty(object,key,{value,writable:true,enumerable:true,configurable:true});}
/** UI identities never replace the native source id sent to Freestyle. */
export function allocatePatternSourceChannelId(patternId,sourceId,reservedIds=[],{scoped=false}={}){
  if(patternId==null||sourceId==null||String(patternId)===''||String(sourceId)==='')throw new Error('A pattern source needs explicit pattern and source identities.');
  const reserved=new Set(Array.from(reservedIds,String)),plain=String(sourceId);
  if(!scoped&&!reserved.has(plain))return plain;
  const base=`pattern-source:${encodeURIComponent(patternSourceKey(patternId,sourceId))}`;let candidate=base,index=2;
  while(reserved.has(candidate))candidate=`${base}:${index++}`;
  return candidate;
}
function sourceAttachmentValue(value){return Array.isArray(value)?value.map(sourceAttachmentValue):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sourceAttachmentValue(value[key])])):value;}
function sourceAttachmentConflicts(before,next){
  const fields=before.kind==='sample'?['kind','audioFileId','rackId','sourceAudioFileId','sourceTrackId','sampleRange','padOnly']:['kind','laneId','instrumentType','pluginId','pluginKey','pluginPath','vstPath','instrumentId','pluginIndex'];
  return fields.some(key=>ownField(before,key)&&ownField(next,key)&&JSON.stringify(sourceAttachmentValue(before[key]))!==JSON.stringify(sourceAttachmentValue(next[key])));
}
function assertSourceAttachmentJSON(value,path=new WeakSet()){
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
  if(!value||typeof value!=='object'||path.has(value)||Object.getOwnPropertySymbols(value).length)throw new Error('Attach an acyclic canonical JSON source without local files or callbacks.');
  const prototype=Object.getPrototypeOf(value);
  if(Array.isArray(value)){for(let index=0;index<value.length;index++)if(!ownField(value,index))throw new Error('Attach complete canonical source arrays.');if(Object.keys(value).some(key=>!/^\d+$/.test(key)))throw new Error('Source array metadata needs an explicit canonical JSON representation.');}
  else if(prototype!==Object.prototype&&prototype!==null)throw new Error('Attach an acyclic canonical JSON source without local files or callbacks.');
  path.add(value);for(const child of Object.values(value))assertSourceAttachmentJSON(child,path);path.delete(value);
}
function assertAttachSource(source){
  assertCompleteCanonicalData(source,'pattern source');
  if(!source||typeof source!=='object'||Array.isArray(source))throw new Error('Attach a complete canonical sample or instrument source.');
  const identity=typeof source?.id==='string'&&source.id.length>0||typeof source?.id==='number'&&Number.isFinite(source.id),sample=source?.kind==='sample',plugin=source?.kind==='plugin';
  if(!identity||!sample&&!plugin)throw new Error('Attach a complete canonical sample or instrument source.');
  if(sample&&(typeof source.audioFileId!=='string'||!source.audioFileId.trim()))throw new Error('A sample source needs its explicit canonical audioFileId.');
  if(plugin&&(typeof source.laneId!=='string'||!source.laneId||source.laneId.length>64||source.laneId.trim()!==source.laneId||typeof source.instrumentType!=='string'||!source.instrumentType.trim()))throw new Error('An instrument source needs its explicit durable laneId and instrumentType binding.');
  assertSourceAttachmentJSON(source);
}
/** Attach an explicitly chosen canonical source; never invent a global binding.
 * New memberships use a caller-allocated source ID. Existing same-ID bindings
 * are idempotent, never an asset/instrument replacement operation.
 */
export function attachPatternSource(project,pattern,source){
  assertAttachSource(source);
  if(!project||!Array.isArray(project.channels)||!Array.isArray(project.patterns)||!project.patterns.includes(pattern))throw new Error('Attach a complete cloud sample or instrument source to its explicit project pattern.');
  const owner=String(pattern.id??pattern.cloudId??''),native=String(source.id);if(!owner)throw new Error('The target pattern has no identity.');
  for(const field of ['cloudSources','steps','notes'])if(pattern[field]!=null&&(typeof pattern[field]!=='object'||Array.isArray(pattern[field])))throw new Error('Reload the pattern’s explicit source and score dictionaries before attaching a channel.');
  if(pattern.cloudRaw)assertCompletePattern(pattern.cloudRaw);assertCompleteCanonicalData(pattern.steps);assertCompleteCanonicalData(pattern.notes);
  const mapped=new Set(Object.keys(pattern.cloudSources||{}).filter(key=>String(pattern.cloudSources[key])===native));
  const candidates=project.channels.filter(channel=>channel.patternSource===true&&String(channel.patternId)===owner&&String(channel.sourceId??channel.cloudSource?.id)===native);
  const originals=array(patternContent(pattern.cloudRaw).sources).filter(item=>String(item.id)===native);
  if(candidates.length>1||originals.length>1||mapped.size>1)throw new Error('The pattern has ambiguous source controls. Reload its canonical sources before attaching a channel.');
  if(candidates[0]&&!candidates[0].cloudSource)throw new Error('Reload the owning channel’s canonical source before attaching it.');
  const existing=originals[0]||candidates[0]?.cloudSource;
  if(existing){assertAttachSource(existing);if(String(existing.id)!==native||sourceAttachmentConflicts(existing,source)||candidates[0]?.cloudSource&&(String(candidates[0].cloudSource.id)!==native||sourceAttachmentConflicts(existing,candidates[0].cloudSource)))throw Object.assign(new Error('This source ID already has a different sample or instrument binding. Allocate a new source ID instead of replacing it.'),{code:'pattern_source_binding_conflict'});}
  if(!existing&&typeof source.id!=='string')throw new Error('Allocate an explicit string source ID for a new pattern membership.');
  const canonicalEvents=array(patternContent(pattern.cloudRaw).events).filter(event=>event.sourceId!=null&&String(event.sourceId)===native);
  if(canonicalEvents.length&&![...mapped].some(key=>Array.isArray(pattern.steps?.[key])&&Array.isArray(pattern.notes?.[key])))throw new Error('Reload the existing source’s complete local score before reattaching it.');
  // Rehoming a copied pattern uses THAT pattern's canonical controls, not the
  // incoming template's or a different owner's gain/root/routing settings.
  const chosen=existing||source,plugin=chosen.kind==='plugin';
  for(const key of mapped){const matching=project.channels.filter(channel=>channel.id===key);if(matching.length>1)throw new Error('The pattern has ambiguous source UI identities.');if(matching[0]?.cloudSource&&sourceAttachmentConflicts(chosen,matching[0].cloudSource))throw Object.assign(new Error('The copied score map points at a different sample or instrument binding. Reload its canonical owner before reattaching.'),{code:'pattern_source_binding_conflict'});}
  const sourceMap=structuredClone(pattern.cloudSources||{}),steps=structuredClone(pattern.steps||{}),notes=structuredClone(pattern.notes||{});
  let channel=candidates[0];
  if(!channel){
    const reserved=new Set(project.channels.map(channel=>String(channel.id)));
    for(const other of project.patterns||[]){if(other.cloudRaw)assertCompletePattern(other.cloudRaw);for(const value of Object.values(other.cloudSources||{}))reserved.add(String(value));for(const item of patternContent(other.cloudRaw).sources||[])reserved.add(String(item.id));}
    const id=allocatePatternSourceChannelId(owner,chosen.id,reserved),raw=structuredClone(chosen),name=chosen.name||(plugin?'Instrument':'Sample');
    channel={id,name,cloudName:name,type:plugin?'instrument':'sample',volume:numeric(chosen.volume,1),pan:numeric(chosen.pan,0),mute:!!chosen.muted,solo:!!chosen.solo,effects:{},plugins:[],patternSource:true,patternId:owner,sourceId:chosen.id,laneId:chosen.laneId,instrumentType:chosen.instrumentType,rackId:chosen.rackId,audioFileId:chosen.audioFileId,durationSec:chosen.durationSec,rootPitch:chosen.rootPitch,cloudSource:raw,cloudRaw:raw};
  }
  // A copied pattern may still point at the old owner's UI row. Detach only
  // this pattern's dictionaries, retaining its notes/steps and the other owner.
  for(const key of mapped)if(key!==channel.id){
    if(ownField(steps,key)&&!ownField(steps,channel.id))setPatternField(steps,channel.id,steps[key]);
    if(ownField(notes,key)&&!ownField(notes,channel.id))setPatternField(notes,channel.id,notes[key]);
    delete sourceMap[key];delete steps[key];delete notes[key];
  }
  setPatternField(sourceMap,channel.id,chosen.id);
  if(!ownField(steps,channel.id))setPatternField(steps,channel.id,Array(Math.max(16,Math.ceil(patternLengthBeats(pattern)*4))).fill(false));
  if(!ownField(notes,channel.id))setPatternField(notes,channel.id,[]);
  pattern.cloudSources=sourceMap;pattern.steps=steps;pattern.notes=notes;
  if(!candidates.length)project.channels.push(channel);
  return channel;
}
/** Backward-compatible sample-only entrypoint; plugin attachment is explicit. */
export function attachPatternSampleSource(project,pattern,source){
  if(source?.kind!=='sample')throw new Error('Attach a complete cloud sample to an explicit pattern.');
  return attachPatternSource(project,pattern,source);
}
function patternSource(channel,existing) {
  const original=existing||channel.cloudSource;
  if(original){
    const source={...original},originalName=channel.cloudName??original.name??channel.name;
    if(channel.name!==originalName)source.name=channel.name;
    if(numeric(channel.volume,1)!==numeric(original.volume,1))source.volume=numeric(channel.volume,1);
    if(!!channel.mute!==!!original.muted)source.muted=!!channel.mute;
    if(!!channel.solo!==!!original.solo)source.solo=!!channel.solo;
    if(source.kind==='sample'&&channel.rootPitch!=null&&numeric(channel.rootPitch,60)!==numeric(original.rootPitch,60))source.rootPitch=channel.rootPitch;
    // FL channel menu Replace: the channel now plays another saved sample of
    // this project (explicit sampleReplaced flag only). Same source id and
    // controls; the old sample's window goes.
    if(source.kind==='sample'&&channel.sampleReplaced===true&&typeof channel.audioFileId==='string'&&channel.audioFileId&&channel.audioFileId!==original.audioFileId){
      source.audioFileId=channel.audioFileId;source.durationSec=numeric(channel.durationSec,0);
      for(const key of ['audioUrl','mimeType'])if(typeof channel[key]==='string'&&channel[key])source[key]=channel[key];else delete source[key];
      for(const key of ['sourceAudioFileId','sourceTrackId','sampleRange'])delete source[key];
    }
    return source;
  }
  if(channel.audioFileId)return {id:channel.sourceId || channel.id,rackId:channel.rackId || channel.id,kind:'sample',name:channel.name,audioFileId:channel.audioFileId,durationSec:channel.durationSec || 0,samplePlaybackMode:'one-shot',rootPitch:channel.rootPitch ?? 60,busId:'master',muted:!!channel.mute,solo:!!channel.solo,volume:numeric(channel.volume,1),order:0};
  if(channel.laneId && (channel.type==='instrument'||channel.instrumentType))return {id:channel.sourceId || channel.id,kind:'plugin',name:channel.name,laneId:channel.laneId,instrumentType:channel.instrumentType || channel.cloudRaw?.instrumentType || '',busId:'master',muted:!!channel.mute,solo:!!channel.solo,volume:numeric(channel.volume,1),order:0};
  throw new Error(`${channel.name || 'This channel'} has no Freestyle sample or instrument. Add a cloud instrument or choose a cloud sample first.`);
}
export function serializeCloudPattern(pattern,project) {
  pattern=resolvedStepPianoPattern(pattern);
  if(pattern.cloudRaw)assertCompletePattern(pattern.cloudRaw);assertCompleteCanonicalData(pattern.steps);assertCompleteCanonicalData(pattern.notes);
  const old=patternDTO(pattern.cloudRaw),content=patternContent(pattern.cloudRaw),ppq=numeric(old.ppq,96),oldSources=array(content.sources),oldEvents=array(content.events);
  const protectedStepKeys=protectedSampleStepKeys(oldEvents);
  if(ppq<=0)throw new Error('The canonical pattern has an invalid PPQ. Reload it before editing notes.');
  if(old._truncated || old.truncated || content._truncated || content.truncated || content.eventsTruncated || content.events_truncated || content.sourcesTruncated || content.sources_truncated)throw new Error('Freestyle returned an incomplete canonical pattern. Reload its full pattern data before editing to preserve hidden events.');
  const oldSourceIds=new Set(oldSources.map(source=>String(source.id))),localIds=new Set([...Object.keys(pattern.steps || {}),...Object.keys(pattern.notes || {})]),usedIds=new Set([...localIds,...oldSourceIds]);
  const mappedIds=new Set(pattern.cloudMappedEventIds || oldEvents.filter(event=>(['midi','sample'].includes(event.type)&&event.startTick!=null&&event.durationTick!=null)||(event.type==='sample'&&event.durationTick==null&&event.tick!=null&&Number.isInteger(Number(event.tick)/ppq*4))).map(event=>event.id));
  // Zero-valued cells currently mean inactive in the local step model. Retain
  // unsupported canonical zero hits and their same-cell peers as raw events,
  // including a stale view whose mapped-ID list predates this protection.
  for(const event of oldEvents)if(unpitchedSampleStep(event)&&protectedStepKeys.has(sampleStepKey(event.sourceId,event.tick)))mappedIds.delete(event.id);
  const sources=[],sourceIds=new Set(),events=oldEvents.filter(event=>!mappedIds.has(event.id));
  for(const channel of project.channels || []) {
    const mapped=ownField(pattern.cloudSources,channel.id),sourceIdentity=mapped?pattern.cloudSources[channel.id]:channel.sourceId??channel.id;
    const existing=oldSources.find(source=>String(source.id)===String(sourceIdentity));
    const owns=channel.patternSource&&[pattern.id,pattern.cloudId].filter(value=>value!=null).some(value=>String(value)===String(channel.patternId));
    // Same native source ids can have different gain/mute/name in other patterns.
    // Only an explicit map/owner may supply controls for an existing source.
    if(existing&&!mapped&&!owns)continue;
    if(channel.patternSource&&!mapped&&!owns&&!localIds.has(channel.id))continue;
    if(!usedIds.has(channel.id)&&!existing)continue;
    const steps=pattern.steps?.[channel.id] || [],notes=pattern.notes?.[channel.id] || [];
    if(!existing&&!pattern.cloudSources?.[channel.id]&&!steps.some(Boolean)&&!notes.length)continue;
    const source=patternSource(channel,existing),nativeKey=String(source.id);
    if(sourceIds.has(nativeKey))throw new Error('Two UI channels map to the same native pattern source. Reload canonical sources before editing.');
    sourceIds.add(nativeKey);sources.push(source);
    const sourceId=source.id;
    steps.forEach((active,index)=>{
      const tick=index*ppq/4,retiredKey=retiredStepKey(pattern,sourceId,tick);
      // FL: a step toggled off and on again in this session keeps its event (id, pan, pitch…).
      if(!active){if(source.kind==='sample'){const hits=oldEvents.filter(e=>e.type==='sample'&&String(e.sourceId)===String(sourceId)&&e.durationTick==null&&Number(e.tick)===tick&&!notes.some(note=>!isStepPianoNote(note)&&String(note.id)===String(e.id)));if(hits.length===1)retireSampleStep(retiredKey,hits[0]);}return;}
      const velocity=typeof active==='number'?active:DEFAULT_STEP_VELOCITY;
      if(source.kind==='sample'&&protectedStepKeys.has(sampleStepKey(sourceId,tick)))throw Object.assign(new Error('This cell contains a canonical zero-velocity sample event that the step editor cannot replace. Edit that event in Freestyle before adding a step here.'),{code:'unsupported_zero_step_collision',sourceId,tick});
      if(source.kind==='plugin')events.push({id:`vegetable-step:${sourceId}:${tick}`,type:'midi',sourceId,note:60,startTick:tick,durationTick:ppq/4,velocity});
      else {const originals=oldEvents.filter(e=>!notes.some(note=>!isStepPianoNote(note)&&String(note.id)===String(e.id))&&e.type==='sample'&&String(e.sourceId)===String(sourceId)&&e.durationTick==null&&Number(e.tick)===tick),oldEvent=originals.at(-1);
        if(originals.length&&active===(oldEvent.velocity??true))events.push(...originals);
        else {if(originals.length>1)throw new Error('This Rack cell contains several canonical hits. Edit them in Freestyle before changing its velocity.');// QA round 23: the Piano step projection reuses the retired id for its entry, so a step-piano id equal to it is the same hit.
          const pianoId=stepPianoEventId(pattern,channel.id,index),retired=!oldEvent?retiredSampleStep(retiredKey,oldEvents):null,base=oldEvent||(retired&&(pianoId==null||String(pianoId)===String(retired.id))?retired:null);events.push({...(base || {}),id:base?.id || stepPianoEventId(pattern,channel.id,index) || uid(),type:'sample',sourceId,tick,velocity});}}

    });
    for(const note of notes){
      if(isStepPianoNote(note))continue;
      const original=note.cloudRaw||{},start=note.start==null?0:Number(note.start),duration=note.duration==null?.25:Number(note.duration);
      if(!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<=0)throw new Error('Pattern notes need finite non-negative starts and positive durations.');
      const sameStart=original.startTick!=null&&Number.isFinite(Number(original.startTick))&&start===Number(original.startTick)/ppq;
      const sameDuration=original.durationTick!=null&&Number.isFinite(Number(original.durationTick))&&Number(original.durationTick)>0&&duration===Number(original.durationTick)/ppq;
      const tick=sameStart?original.startTick:start*ppq,durationTick=sameDuration?original.durationTick:duration*ppq,pitch=numeric(note.pitch,60),event={...original,id:original.id??note.id??uid(),type:source.kind==='sample'?'sample':'midi',sourceId,note:pitch,startTick:tick,durationTick,velocity:numeric(note.velocity,.8)};
      // FL note flags (328 PatternNote): muted never sounds; slide is stored only. An unset
      // flag stays absent (exact restore); an explicit stored false is kept as false.
      for(const flag of ['muted','slide']){if(note[flag]===true)event[flag]=true;else if(note[flag]===false){if(original[flag]===false)event[flag]=false;else delete event[flag];}}
      if(source.kind==='sample'){
        event.tick=sameStart&&ownField(original,'tick')?original.tick:tick;event.pitch=pitch;
        const oldPitch=original.note??original.pitch,rootChanged=numeric(source.rootPitch,60)!==numeric(existing?.rootPitch??channel.cloudSource?.rootPitch,60),hasPitch=oldPitch!=null&&Number.isFinite(Number(oldPitch));
        if(hasPitch&&pitch===Number(oldPitch)&&!rootChanged){
          // The native consumer preserves explicit rate/root overrides. An
          // unrelated note, duration, velocity or step edit must do the same.
          if(ownField(original,'rootPitch'))event.rootPitch=original.rootPitch;else delete event.rootPitch;
          if(ownField(original,'playbackRate'))event.playbackRate=original.playbackRate;else delete event.playbackRate;
        }else if(hasPitch&&!rootChanged&&typeof original.playbackRate==='number'&&Number.isFinite(original.playbackRate)&&original.playbackRate>0){
          event.playbackRate=Math.max(.25,Math.min(4,original.playbackRate*Math.pow(2,(pitch-Number(oldPitch))/12)));
          if(ownField(original,'rootPitch'))event.rootPitch=original.rootPitch;else delete event.rootPitch;
        }else{event.rootPitch=source.rootPitch??60;event.playbackRate=Math.max(.25,Math.min(4,Math.pow(2,(pitch-event.rootPitch)/12)));}
      }
      events.push(event);
    }
  }
  return {name:pattern.name || 'Pattern',ppq,bars:Math.max(1,numeric(pattern.bars,1)),lengthTicks:patternLengthBeats(pattern)*ppq,swing:numeric(pattern.swing,numeric(old.swing,0)),pattern:{...content,version:content.version || 1,sources,events:events.filter(event=>event.sourceId==null||sourceIds.has(String(event.sourceId))||!oldSourceIds.has(String(event.sourceId)))}};
}
export function serializeCloudPlacement(clip,project,patternIdMap={}) {
  const old=clip.cloudRaw || {},pattern=project.patterns.find(p=>p.id===clip.patternId),spb=60/numeric(project.bpm,120),pId=patternIdMap[clip.patternId] || pattern?.cloudId || clip.patternId;
  const movedLane=clip.cloudTrackIndex!=null && numeric(clip.track)!==numeric(clip.cloudTrackIndex);
  const laneId=movedLane?(project.cloud?.timelineLaneIds?.[clip.track] || ''):(old.laneId || old.lane_id || clip.laneId || project.cloud?.timelineLaneIds?.[clip.track] || '');
  // The Studio API stores whole milliseconds; beats at e.g. 124 BPM are fractional ms. Round here,
  // once, so the preflight, the history capture and both REST transports agree (playlist-edits.js).
  // The legacy action path keeps its exact values.
  const wire=project.cloud?.rawState?.studioApi===true?wholePlacementMs:value=>value;
  return wire({patternId:pId,laneId,name:clip.name ?? old.name ?? pattern?.name ?? 'Pattern',startMs:Math.max(0,numeric(clip.start))*spb*1000,...placementTiming(clip,project),displayOrder:clip.cloudId?numeric(old.displayOrder,0):numeric(clip.track,0),busId:old.busId || old.bus_id || 'master',sourceBusOverrides:old.sourceBusOverrides || {},muted:!!old.muted,soloed:!!old.soloed});
}
const knownNumber=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
function runtimeAudioClip(take,state) {
  const entries=array(state.clips?.clips || state.clips),id=String(take.id);
  // Overlapping takes can share a lane and start time. A nearby runtime clip
  // is not evidence of identity; leave legacy rows unresolved for the durable
  // server resolver rather than sending a mutation to an inferred numeric ID.
  const matches=entries.filter(entry=>entry.db_clip_id!=null&&String(entry.db_clip_id)===id);
  return matches.length===1?matches[0]:undefined;
}
function audioIdentity(clip) {
  const id=clip?.cloudId,laneId=clip?.laneId,valid=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
  if(!valid(id)||!valid(laneId)||clip.cloudRaw?.id!==id||clip.cloudRaw?.laneId!==laneId)throw new Error('Reload this audio clip’s matching durable Freestyle identity and lane before editing it.');
  // The live resolver independently identifies the saved lane and saved clip.
  // A clip UUID is not a track identity. Cached numeric worker IDs can change
  // between consecutive requests and must never be used or stringified here.
  return {track_id:laneId,clip_id:id};
}
export function normalizeCloudAudioClip(take,state,bpm,track) {
  const runtime=runtimeAudioClip(take,state),timing=take.effects?.timing || {},engineTrackId=runtime?.mozart_track_id,engineClipId=runtime?.clip_id;
  const offsetValue=[take.audioOffsetSec,timing.audioOffsetSec,runtime?.audio_offset_sec].find(knownNumber),offsetKnown=knownNumber(offsetValue),spb=60/bpm;
  // #22 (2026-11-18): every clip read carries sourceDurationSec (the full source audio length, or null when unknown);
  // trims and slips keep audioOffsetSec + durationSec <= sourceDurationSec. The older audioFullDurationSec is a fallback.
  const fullDuration=[take.sourceDurationSec,take.audioFullDurationSec,timing.audioFullDurationSec].find(value=>knownNumber(value)&&Number(value)>0);
  const clip={id:String(take.id),cloudId:String(take.id),laneId:take.laneId,track,cloudTrackIndex:track,start:numeric(take.startMs)/1000/spb,length:Math.max(0,numeric(take.durationSec))/spb,offset:offsetKnown?Number(offsetValue)/spb:0,offsetKnown,name:take.name || 'Audio clip',volume:numeric(take.volume,1),mute:!!take.muted,engineLoaded:!!runtime&&knownNumber(engineTrackId)&&knownNumber(engineClipId),cloudRaw:take};
  if(clip.engineLoaded){clip.engineTrackId=Number(engineTrackId);clip.engineClipId=Number(engineClipId);clip.cloudRuntime=runtime;}
  if(knownNumber(fullDuration))clip.sourceLength=Number(fullDuration)/spb;
  if(typeof take.audioUrl==='string')clip.url=take.audioUrl;
  if(Array.isArray(take.peaks))clip.peaks=take.peaks;else if(Array.isArray(take.waveform?.peaks))clip.peaks=take.waveform.peaks;
  return clip;
}
const sameData=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const omitKeys=(value,keys)=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>!keys.includes(key)));
const exactNumber=value=>typeof value==='number'&&Number.isFinite(value);
const near=(a,b)=>Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*1e-12;
/** Only existing audio windows with complete canonical before timing are batchable. */
export function planAudioTimingBatch(previous,next){
  if(!previous?.cloud?.projectId||previous.cloud.projectId!==next?.cloud?.projectId||!exactNumber(previous.bpm)||previous.bpm<=0||!sameData(omitKeys(previous,['audioClips']),omitKeys(next,['audioClips'])))return null;
  const before=array(previous.audioClips),after=array(next.audioClips),secondsPerBeat=60/previous.bpm,ops=[],inverseOps=[],beforeClips=[],seen=new Set();
  if(before.length!==after.length)return null;
  for(let index=0;index<before.length;index++){
    const old=before[index],clip=after[index],id=old?.cloudId;
    if(!clip||clip.id!==old.id||!sameData(omitKeys(old,['start','length','offset']),omitKeys(clip,['start','length','offset'])))return null;
    const startChanged=clip.start!==old.start,lengthChanged=clip.length!==old.length,offsetChanged=clip.offset!==old.offset;
    if(!startChanged&&!lengthChanged&&!offsetChanged)continue;
    const raw=old.cloudRaw;
    if(typeof id!=='string'||!id||id.length>64||seen.has(id)||before.filter(item=>item.cloudId===id).length!==1||raw?.id!==id||!exactNumber(raw.startMs)||raw.startMs<0||!exactNumber(raw.durationSec)||raw.durationSec<=0||!exactNumber(old.start)||!exactNumber(old.length)||!near(old.start*secondsPerBeat*1000,raw.startMs)||!near(old.length*secondsPerBeat,raw.durationSec))return null;
    if(hasCanonicalTruncation(raw))return null;seen.add(id);
    const offsetValue=[raw.audioOffsetSec,raw.effects?.timing?.audioOffsetSec].find(value=>exactNumber(value)&&value>=0),offsetKnown=old.offsetKnown===true&&offsetValue!==undefined;
    if(offsetKnown&&(!exactNumber(old.offset)||!near(old.offset*secondsPerBeat,offsetValue)))return null;
    // Every expected guard carries start_ms, duration_sec and audio_offset_sec.
    // An unknown source offset cannot be guessed, so use the per-clip path.
    if(!offsetKnown)return null;
    if(!exactNumber(clip.start)||clip.start<0||!exactNumber(clip.length)||clip.length<=0||offsetChanged&&(!exactNumber(clip.offset)||clip.offset<0))return null;
    const expected={start_ms:raw.startMs,duration_sec:raw.durationSec,audio_offset_sec:offsetValue},timing={...startChanged?{start_ms:clip.start*secondsPerBeat*1000}:{},...lengthChanged?{duration_sec:clip.length*secondsPerBeat}:{},...offsetChanged?{audio_offset_sec:clip.offset*secondsPerBeat}:{}},restore={};
    for(const field of Object.keys(timing))restore[field]=expected[field];
    ops.push({op:'update',id,...timing,expected});inverseOps.push({op:'update',id,...restore,expected:{...expected,...timing}});beforeClips.push(structuredClone(old));
  }
  return ops.length>=2&&ops.length<=256?{projectId:previous.cloud.projectId,ops,inverseOps,beforeClips}:null;
}
/** A 200 clips:batch with postCommitError IS committed: adopt it, keep its
 * history and reload the live engine; never roll it back or resend it. */
export function clipBatchCommitOutcome(payload){
 const postCommitError=payload?.postCommitError&&typeof payload.postCommitError==='object'&&!Array.isArray(payload.postCommitError)?structuredClone(payload.postCommitError):null,engineReloadRequired=payload?.engine_reload_required===true||!!postCommitError;
 const appliedOps=Number.isSafeInteger(payload?.applied_ops)&&payload.applied_ops>=0?payload.applied_ops:null,revision=payload?.timelineRevision;
 return{committed:true,postCommitError,engineReloadRequired,appliedOps,replay:payload?.replay===true,revisionKnown:typeof revision==='string'&&revision.length>0||Number.isSafeInteger(revision),
  warning:postCommitError?'The audio edit was saved, but Freestyle could not finish mirroring it to the live engine. Reloading the session.':engineReloadRequired?'The audio edit was saved. The live engine still needs to reload it.':null};
}
/** applied_ops is the engine's integer count (null or 0 on a replay that
 * applied nothing new). Legacy arrays are read by length. */
export function clipBatchAppliedCount(payload){const value=payload?.applied_ops;return Number.isSafeInteger(value)&&value>=0?value:Array.isArray(value)?value.length:null;}
/** Every committed clips:batch that left the live engine behind announces it
 * once, so the engine reloads its session and shows a soft warning. */
function clipBatchNotifyingCall(session,call){
  return async function(name,args,options){
    // A user's read or write preempts an in-flight background refresh (it is a
    // read, so aborting it is safe; the engine runs it again once idle).
    if(options?.priority!=='background')session.preemptBackgroundRead?.(name);
    const result=await call.call(this??session,name,args,options);
    if(name==='apply_clip_batch'){try{const data=body(unpack(result)),outcome=clipBatchCommitOutcome(data);if(outcome.engineReloadRequired)emit(session,'clip-batch-reload-required',{projectId:args?.project_id??session.projectId,...outcome,divergent:Array.isArray(data?.engine_divergent)?structuredClone(data.engine_divergent):[]});}catch{/* the caller validates its own receipt */}}
    return result;
  };
}
function audioBatchResult(value,projectId){
  let data;try{data=body(unpack(value));}catch(error){if(value?.isError)error.mcpRejected=true;throw error;}assertCompleteCanonicalData(data,'atomic audio timing receipt');
  const visit=item=>{if(!item||typeof item!=='object')return;if(item.ok===false||item.isError===true||item.error)throw Object.assign(new Error(typeof item.error==='string'?item.error:item.message||'Freestyle rejected the atomic audio timing edit.'),{result:data});for(const [key,child] of Object.entries(item))if(key!=='postCommitError')visit(child);};visit(data);
  if(!data||typeof data!=='object'||Array.isArray(data)||!Object.keys(data).length)throw new Error('Freestyle returned no atomic audio timing receipt.');
  for(const key of ['projectId','project_id'])if(data[key]!==undefined&&data[key]!==projectId)throw new Error('Freestyle returned an atomic audio timing receipt for a different project.');
  for(const key of ['replay','engine_reload_required'])if(data[key]!==undefined&&typeof data[key]!=='boolean')throw new Error('Freestyle returned an invalid atomic audio timing acknowledgement.');
  return structuredClone(data);
}
function audioBatchStatus(error){
  const data=error?.result?.structuredContent??error?.result,payload=data?.response??data;
  return[error?.status,error?.statusCode,data?.status,data?.statusCode,data?.error?.status,payload?.status,payload?.statusCode,payload?.error?.status].find(value=>Number.isInteger(value)&&value>=100&&value<=599);
}
function rejectedAudioBatch(error){
  const data=error?.result?.structuredContent??error?.result,payload=data?.response??data,status=audioBatchStatus(error);
  // An upstream timeout/5xx can arrive after a database commit. Error-shaped
  // transport bodies must not turn that uncertainty into permission to retry.
  if(error?.operationUncertain===true||status>=500||status===408)return false;
  return error?.explicitRejection===true||status>=400&&status<500||error?.mcpRejected===true||data?.ok===false||payload?.ok===false;
}
export function normalizeCloudProject(project,state={},context={}) {
  const studioApi=state.studioApi===true,bpm=numeric(project.bpm || state.transport?.bpm || state.clock?.bpm,120),lanes=array(project.lanes),liveTracks=studioApi?state.nativeMixerStateAvailable===true&&state.tracks?.live===true&&state.tracks?.runtime_ids_available===true?array(state.tracks.tracks).filter(track=>Number.isSafeInteger(track?.id)&&track.id>=0&&array(state.tracks.tracks).filter(other=>other.id===track.id).length===1):[]:array(state.tracks?.tracks || state.tracks);
  // Pattern-lane mute/solo is engine-track state since 338, so the heard values cover every lane.
  const liveMix=studioApi?LIVE_MIX.get(context.projectId??project.id)??null:null;
  const channels=lanes.map((lane,index)=>{
    const matches=liveTracks.filter(track=>track.db_track_id!=null&&String(track.db_track_id)===String(lane.id)),live=matches.length===1?matches[0]:{},heard=liveMix?liveLaneValues(liveMix,String(lane.id)):{};
    return {id:String(lane.id),laneId:String(lane.id),cloudTrackId:String(lane.id),engineTrackId:live.id,name:lane.name || live.label || `Lane ${index+1}`,cloudName:lane.name || live.label,type:lane.kind || live.kind || 'cloud',volume:numeric(studioApi?heard.gain??lane.volume:live.gain ?? lane.volume,1),pan:numeric(studioApi?heard.pan??lane.pan:live.pan ?? lane.pan,0),mute:!!(studioApi?heard.mute??lane.muted:live.muted ?? lane.muted),solo:!!(studioApi?heard.solo??(lane.soloed??lane.solo):(live.soloed??lane.solo)),effects:{},plugins:array(live.plugins || lane.pluginChain),cloudRaw:lane};
  });
  const persistedLanes=new Set(lanes.map(lane=>String(lane.id)));
  for(const [index,live]of liveTracks.entries()){
    if(studioApi)continue; // Unmatched native tracks are diagnostics, not saved lane identities.
    if(live.db_track_id!=null&&persistedLanes.has(String(live.db_track_id))||live.id!=null&&channels.some(channel=>channel.engineTrackId===live.id))continue;
    const preferred=String(live.db_track_id??`engine-${live.id??index}`);let runtimeId=preferred,suffix=2;while(channels.some(channel=>channel.id===runtimeId))runtimeId=`${preferred}:${suffix++}`;
    channels.push({id:runtimeId,laneId:live.db_track_id || live.label,cloudTrackId:live.db_track_id || live.label,engineTrackId:live.id,name:live.label || `Track ${live.id}`,cloudName:live.label,type:live.kind || 'cloud',volume:numeric(live.gain,1),pan:numeric(live.pan,0),mute:!!live.muted,solo:!!live.soloed,effects:{},plugins:array(live.plugins),cloudRaw:live});
  }
  const laneChannels=channels.slice();
  const sourcePatterns=array(state.patterns?.patterns || state.patterns).length ? array(state.patterns?.patterns || state.patterns) : array(project.patterns);
  assertCompleteCanonicalData(sourcePatterns);
  const prepared=sourcePatterns.map((entry,index)=>{const dto=assertCompletePattern(entry),content=patternContent(entry),id=String(entry.id??dto.id??entry.pattern_id??`cloud-pattern-${index}`),seen=new Set();for(const source of content.sources){const key=String(source.id);if(!key||seen.has(key))throw new Error('Freestyle returned duplicate or empty source identities within a pattern. Reload its canonical sources before editing.');seen.add(key);}return{entry,dto,content,id};});
  const owners=new Map(),reserved=new Set(channels.map(channel=>channel.id)),channelIds=new Map();
  for(const pattern of prepared)for(const source of pattern.content.sources){const key=String(source.id);reserved.add(key);if(!owners.has(key))owners.set(key,new Set());owners.get(key).add(pattern.id);}
  const sourceKeys=prepared.flatMap(pattern=>pattern.content.sources.map(source=>({patternId:pattern.id,sourceId:String(source.id),key:patternSourceKey(pattern.id,source.id)}))).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  for(const source of sourceKeys){const collision=owners.get(source.sourceId).size>1||laneChannels.some(channel=>channel.id===source.sourceId),uiId=collision?allocatePatternSourceChannelId(source.patternId,source.sourceId,reserved,{scoped:true}):source.sourceId;reserved.add(uiId);channelIds.set(source.key,uiId);}
  const patterns=prepared.map(({entry,dto,content,id},index)=>{
    const ppq=numeric(dto.ppq,96);
    const pattern={id,cloudId:id,name:dto.name || `Pattern ${index+1}`,bars:Math.max(1,numeric(dto.bars,numeric(dto.lengthTicks,384)/ppq/4)),swing:numeric(dto.swing,0),steps:{},notes:{},cloudSources:{},cloudMappedEventIds:[],cloudRaw:entry};
    const protectedStepKeys=protectedSampleStepKeys(array(content.events));
    for(const [index,source]of array(content.sources).entries()) {
      const sourceId=String(source.id),lane=source.laneId==null?undefined:laneChannels.find(channel=>String(channel.laneId)===String(source.laneId)),name=source.name||`Channel ${index+1}`;
      const channel={id:channelIds.get(patternSourceKey(id,source.id)),name,cloudName:name,type:source.kind==='plugin'?'instrument':'sample',volume:numeric(source.volume,1),pan:numeric(source.pan,0),mute:!!source.muted,solo:!!source.solo,effects:{},plugins:lane?.plugins || [],patternSource:true,patternId:id,sourceId:source.id,laneId:source.laneId,engineTrackId:lane?.engineTrackId,instrumentType:source.instrumentType,audioFileId:source.audioFileId,rootPitch:source.rootPitch,durationSec:source.durationSec,cloudSource:source,cloudRaw:source};channels.push(channel);
      setPatternField(pattern.cloudSources,channel.id,source.id);
      const steps=Array(Math.max(16,Math.ceil(patternLengthBeats(pattern)*4))).fill(false),notes=[];
      for(const event of array(content.events).filter(e=>String(e.sourceId)===sourceId)) {
        if(unpitchedSampleStep(event)&&protectedStepKeys.has(sampleStepKey(event.sourceId,event.tick)))continue;
        if(['midi','sample'].includes(event.type)&&event.startTick!=null&&event.durationTick!=null){notes.push({id:String(event.id),pitch:numeric(event.note ?? event.pitch,60),start:numeric(event.startTick)/ppq,duration:numeric(event.durationTick)/ppq,velocity:numeric(event.velocity,.8),...(event.muted===true?{muted:true}:{}),...(event.slide===true?{slide:true}:{}),cloudRaw:event});pattern.cloudMappedEventIds.push(event.id);}
        else if(event.type==='sample'&&event.tick!=null&&Number.isFinite(Number(event.tick))){const position=Number(event.tick)/ppq*4;if(Number.isInteger(position)&&position>=0&&position<steps.length){steps[position]=event.velocity ?? true;pattern.cloudMappedEventIds.push(event.id);}}
      }
      setPatternField(pattern.steps,channel.id,steps);setPatternField(pattern.notes,channel.id,notes);
    }
    return pattern;
  });
  const takes=array(project.clips);
  const observedPlacements=state.patternPlacements?.placements??state.placements,placements=Array.isArray(observedPlacements)?observedPlacements:array(project.placements);assertCompleteCanonicalData(placements,'canonical pattern placement list');
  // FL Playlist rows are fixed: one row per saved timeline lane in its persisted
  // `order` (ties keep the saved array order). Row positions never depend on
  // which lanes currently hold clips or on placement displayOrder hints, so a
  // Delete/Undo, clone or move cannot reorder rows or shift other clips.
  const hosted=new Set([...placements.map(placement=>placement.laneId || placement.lane_id),...takes.map(take=>take.laneId)].filter(Boolean));
  const rowLanes=lanes.map((lane,index)=>({lane,index})).filter(({lane})=>lane&&typeof lane.id==='string'&&lane.id&&(['audio','vocal','instrument'].includes(lane.kind)||hosted.has(lane.id))).sort((a,b)=>{const x=Number(a.lane.order),y=Number(b.lane.order),ax=Number.isFinite(x)?x:Infinity,by=Number.isFinite(y)?y:Infinity;return ax===by?a.index-b.index:ax-by;});
  const orderedLaneIds=rowLanes.map(({lane})=>lane.id);
  // A clip on a saved lane of another kind (or a lane missing from the read)
  // still gets a stable row, after the ordered lanes, in first-seen order.
  for(const laneId of [...placements.map(placement=>placement.laneId || placement.lane_id),...takes.map(take=>take.laneId)])if(laneId&&!orderedLaneIds.includes(laneId))orderedLaneIds.push(laneId);
  // A lane the client created by dropping onto an empty row keeps that row
  // (presentation-only hint; nothing is written back).
  const timelineLaneIds=applyLaneRowHints(orderedLaneIds,laneRowHints(context.projectId || project.id));
  const clips=placements.map((placement,index)=>{const laneId=placement.laneId || placement.lane_id,track=Math.max(0,timelineLaneIds.indexOf(laneId)),duration=numeric(placement.durationMs ?? placement.duration_ms,2000),window=numeric(placement.windowMs,0),totalMs=window>0?window:Math.max(50,duration*Math.max(1,numeric(placement.repeatCount,1))-Math.max(0,numeric(placement.offsetMs,0)));return {id:String(placement.id || placement.placement_id || `placement-${index}`),cloudId:placement.id || placement.placement_id,patternId:String(placement.patternId || placement.pattern_id),name:placement.name,start:numeric(placement.startMs ?? placement.start_ms)/1000*bpm/60,length:totalMs/1000*bpm/60,track,laneId,cloudTrackIndex:track,cloudRaw:placement};});
  const audioClips=takes.map(take=>normalizeCloudAudioClip(take,state,bpm,Math.max(0,timelineLaneIds.indexOf(take.laneId))));
  const trackNames=Object.fromEntries(timelineLaneIds.flatMap((laneId,index)=>{if(!laneId)return [];const lane=lanes.find(l=>l.id===laneId),placement=placements.find(p=>(p.laneId || p.lane_id)===laneId);return [[index,lane?.name || placement?.laneName || placement?.name || `Track ${index+1}`]];}));
  // A placement's mute is independent of its lane's M switch. Muting every
  // clip on a lane must not synthesize a lane mute or a later lane write.
  const mutedTracks=timelineLaneIds.flatMap((laneId,index)=>laneId&&lanes.find(l=>l.id===laneId)?.muted?[index]:[]);
  const master=array(state.buses?.buses).find(b=>b.bus_id==='master'||b.id==='master');
  return {id:project.id || context.projectId,title:project.title || 'Freestyle project',name:project.title || 'Freestyle project',bpm,master:numeric(studioApi?project.masterGain:master?.gain,1),channels,patterns,clips,audioClips,trackNames,mutedTracks,selectedPattern:patterns[0]?.id || '',loop:!!state.transport?.loop_enabled,metronome:!!state.transport?.metronome,cloud:{projectId:context.projectId || project.id,trackId:context.trackId,studioUrl:project.studioUrl || project.projectUrl,patternLaneId:placements[0]?.laneId || placements[0]?.lane_id || lanes.find(l=>l.kind==='pattern')?.id,timelineLaneIds,rawProject:project,rawState:state,warnings:[]}};
}
/** Rebuild a complete saved REST snapshot without treating an old transport
 * payload, saved gain, or lane UUID as a fresh native engine observation. */
function restSavedSnapshot(project,busesResult,current,projectId){
  if(project?.id!==projectId||project.ok===false||project.error||project.isError)throw new Error('Freestyle returned saved state for another or invalid project.');
  for(const field of ['lanes','clips','patterns','placements']){
    if(!Array.isArray(project[field])||project.truncated?.[field]===true||project[field+'Truncated']===true||project[field+'_truncated']===true)throw new Error('Freestyle returned incomplete saved '+field+'.');
    assertCompleteCanonicalData(project[field],'saved '+field);
  }
  for(const value of [project._studioApi,busesResult,busesResult?._studioApi])for(const field of ['projectId','project_id'])if(value?.[field]!=null&&value[field]!==projectId)throw new Error('The saved mixer read belongs to another project.');
  assertCompleteCanonicalData(busesResult,'saved mixer buses');const buses=busesResult?.buses;
  if(busesResult?.ok===false||busesResult?.error||busesResult?.isError||!Array.isArray(buses)||busesResult.nextCursor!=null||busesResult.pagination?.nextCursor!=null||busesResult.pagination?.hasMore===true||Number.isFinite(busesResult.total)&&busesResult.total>buses.length)throw new Error('Freestyle did not return the complete saved mixer buses.');
  const ids=new Set();for(const bus of buses){const id=bus?.id??bus?.bus_id;if(typeof id!=='string'||!id||ids.has(id)||bus.id!=null&&bus.bus_id!=null&&bus.id!==bus.bus_id)throw new Error('Freestyle returned ambiguous saved mixer buses.');ids.add(id);}
  const tracks=project.lanes.map(lane=>({db_track_id:lane.id,label:lane.name,kind:lane.kind,...(Object.hasOwn(lane,'volume')?{gain:lane.volume}:{}),...(Object.hasOwn(lane,'pan')?{pan:lane.pan}:{}),...(Object.hasOwn(lane,'muted')?{muted:lane.muted}:{}),...(Object.hasOwn(lane,'solo')?{soloed:lane.solo}:Object.hasOwn(lane,'soloed')?{soloed:lane.soloed}:{}),...(Object.hasOwn(lane,'busId')?{bus_id:lane.busId}:{})}));
  return{...current,apiSurface:'studio-v1',studioApi:true,_studioApi:{...project._studioApi,projectId,operationId:'getProjectSavedState'},project,
    patterns:{ok:true,patterns:project.patterns},patternPlacements:{ok:true,placements:project.placements},
    tracks:{ok:true,tracks,live:false,runtime_ids_available:false,source:'studio-v1-persisted-lanes'},
    clips:{ok:true,clips:project.clips,live:false},buses:{ok:false,buses,live:false,error:'Studio API v1 does not expose native live mixer state.'},
    persistedLanes:project.lanes,persistedBuses:buses,nativeMixerStateAvailable:false,transportReadFresh:false};
}
/** Native Studio delivery jitter compensation: a sliding minimum transit floor. */
export function createClockDeliveryEstimator({windowMs=20000,bucketMs=2000,maxExcessMs=8000,sustainedRefloorMs=6000}={}){
  let buckets=[],plateau=null,samples=0,lastExcessMs=0,maxSeenExcessMs=0;
  return {
    note({serverSentMs,receivedUnixMs}={}){
      const sent=Number(serverSentMs),received=Number(receivedUnixMs);
      if(!Number.isFinite(sent)||sent<=0||!Number.isFinite(received)||received<=0){lastExcessMs=0;return{excessMs:0,transitMs:null,floorMs:null,refloored:false};}
      const transitMs=received-sent; samples++;
      const last=buckets[buckets.length-1];
      if(!last||received-last.startMs>=bucketMs)buckets.push({startMs:received,min:transitMs});else last.min=Math.min(last.min,transitMs);
      buckets=buckets.filter(bucket=>received-bucket.startMs<windowMs+bucketMs);
      let floorMs=Math.min(...buckets.map(bucket=>bucket.min)),excessMs=Number.isFinite(floorMs)?transitMs-floorMs:0,refloored=false;
      if(excessMs>=40){
        if(!plateau)plateau={sinceMs:received,min:excessMs,max:excessMs};else{plateau.min=Math.min(plateau.min,excessMs);plateau.max=Math.max(plateau.max,excessMs);}
        if(received-plateau.sinceMs>=sustainedRefloorMs&&plateau.max-plateau.min<=25){buckets=[{startMs:received,min:transitMs}];floorMs=transitMs;excessMs=0;plateau=null;refloored=true;}
      }else plateau=null;
      excessMs=Math.max(0,Math.min(maxExcessMs,excessMs));lastExcessMs=excessMs;maxSeenExcessMs=Math.max(maxSeenExcessMs,excessMs);
      return{excessMs,transitMs,floorMs,refloored};
    },
    stats(){return{samples,lastExcessMs:Math.round(lastExcessMs),maxExcessMs:Math.round(maxSeenExcessMs)};},
    reset(){buckets=[];plateau=null;samples=0;lastExcessMs=0;maxSeenExcessMs=0;}
  };
}
function performanceUnixMs(at){const origin=Number(globalThis.performance?.timeOrigin);return Number.isFinite(origin)&&origin>0?origin+Number(at):Date.now();}
export class CloudSession extends EventTarget {
  // Every assigned transport is wrapped so project mutations are counted.
  get call(){return this._fencedCall;}
  set call(fn){this._rawCall=fn;this._fencedCall=typeof fn!=='function'?fn:(name,args,options)=>projectMutationCall(name,args)?this.fenceMutation(()=>fn.call(this,name,args,options)):fn.call(this,name,args,options);}
  fenceMutation(run){this.mutationEpoch=(this.mutationEpoch||0)+1;this.mutationsInFlight=(this.mutationsInFlight||0)+1;let result;try{result=Promise.resolve(run());}catch(error){result=Promise.reject(error);}return result.finally(()=>{this.mutationEpoch++;this.mutationsInFlight=Math.max(0,this.mutationsInFlight-1);if(!this.mutationsInFlight){const waiters=this.mutationIdleWaiters||[];this.mutationIdleWaiters=[];for(const resolve of waiters)resolve();}});}
  mutationsIdle(timeoutMs=READ_FENCE_WAIT_MS){if(!this.mutationsInFlight)return Promise.resolve(true);return new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),timeoutMs);(this.mutationIdleWaiters||=[]).push(()=>{clearTimeout(timer);resolve(true);});});}
  constructor({call=defaultCall,pollInterval=3500,now=()=>performance.now(),toUnixTime=performanceUnixMs}={}) {
    super();this.call=clipBatchNotifyingCall(this,call);this.now=now;this.toUnixTime=toUnixTime;this.clockDelivery=createClockDeliveryEstimator();this.clockSource='none';this.liveClock=null;this.loopIterations=0;this.loopEnabled=false;this.loopStartSec=0;this.loopEndSec=0;this.producerLagSec=null;this.polling=false;this.transportVersion=0;this.lastTransportAppliedAt=-Infinity;this.transportGuard=null;this.pollInterval=Math.max(2500,pollInterval);this.projectId='';this.trackId='';this.project=null;this.rawProject=null;this.rawState=null;this.playing=false;this.positionSeconds=0;this.positionObserved=this.now();this.queue=Promise.resolve();this.pollTimer=null;this.tickTimer=null;this.closed=false;this.streamAudio=null;this.streamInfo=null;
  }
  async load(projectId,trackId) {
    const contextVersion=(this.contextVersion||0)+1,canonicalRead=(this.canonicalProjectReadRequested||0)+1;let expectedTrackId=trackId||'';
    this.contextVersion=contextVersion;this.canonicalProjectReadRequested=canonicalRead;this.transportVersion++;this.transportObservationVersion=(this.transportObservationVersion||0)+1;this.closed=false;this.liveClock=null;this.interactiveClock=null;this.explicitClock=null;this.rawState=null;this.rawProject=null;this.project=null;this.clockDelivery.reset();this.loopIterations=0;this.loopEnabled=false;this.loopStartSec=0;this.loopEndSec=0;this.clockSource='none';this.transportBpm=null;this.producerLagSec=null;this.playing=false;this.positionSeconds=0;this.positionObserved=this.now();this.transportGuard=null;this.lastTransportAppliedAt=-Infinity;this.projectId=projectId;this.trackId=expectedTrackId;
    clearTimeout(this.pollTimer);clearInterval(this.tickTimer);this.pollTimer=null;this.tickTimer=null;
    const check=()=>{if(this.closed||this.projectId!==projectId||this.trackId!==expectedTrackId||this.contextVersion!==contextVersion)throw Object.assign(new Error('The cloud project changed while its saved project was loading.'),{name:'AbortError',code:'load_scope_changed'});};
    if(!projectId)throw new Error('Select a Freestyle project first.');
    // Inside Freestyle every project is a Studio API (REST) project: read the bus list in the
    // same phase as the saved project instead of after it.
    let busesRead=embedded()?this.call('list_buses',{project_id:projectId}):null;busesRead?.catch(()=>{});
    const saved=body(unpack(await this.call('get_project',{project_id:projectId})));check();
    if(saved?.id!==projectId)throw new Error('Freestyle returned saved state for another or invalid project.');
    const metadata=saved._studioApi,rest=metadata&&typeof metadata==='object'&&!Array.isArray(metadata)&&metadata.projectId===projectId;
    if(metadata?.projectId!=null&&metadata.projectId!==projectId)throw new Error('The saved project metadata belongs to another project.');
    this.rawProject=saved;this.trackId=expectedTrackId=expectedTrackId||saved.clips?.find(clip=>clip?.id&&!clip.deleted&&!clip.isBacking&&clip.id!=='backing')?.id||saved.lanes?.find(lane=>lane?.id&&lane.id!=='backing')?.id||saved.lanes?.[0]?.id;
    if(!this.trackId)throw new Error('This Freestyle project has no track. Create an audio lane in the cloud panel, then load it again.');
    if(rest){
      // get_project is already the adapter's complete, revisioned saved read.
      // Cold Mozart startup is not required to display/edit that persisted score.
      const buses=body(unpack(await (busesRead||this.call('list_buses',{project_id:projectId}))));check();
      const state=restSavedSnapshot(saved,buses,this.rawState,projectId);
      for(const entry of saved.patterns)assertCompletePattern(entry);for(const entry of saved.placements)assertCompletePlacement(entry);
      check();this.rawState=state;this.project=normalizeCloudProject(saved,state,{projectId,trackId:this.trackId});this.canonicalProjectReadCompleted=canonicalRead;
      emit(this,'state',{project:this.project,raw:this.rawState});this.startTicking();return this.project;
    }
    await this.refresh();check();if(!hasLoopClock(this.rawState?.transport)){await this.refreshTransportClock();check();}this.startTicking();return this.project;
  }
  async create(title='Street Band session',{open=true}={}) {
    const created=body(await this.call('create_project',{title}));
    const id=created.project?.id || created.projectId || created.id;
    if(!id)throw new Error('Freestyle did not return the new project ID. Open the project list before retrying.');
    const lane=body(await this.call('create_track',{project_id:id,kind:'audio',name:'Engine context'}));
    const track=lane.trackId || lane.track?.id || lane.laneId || lane.lane?.id || lane.id;
    // Embedded (open:false): the host opens it, then this view follows its "project" event.
    if(!open)return {projectId:id,trackId:track||''};
    return this.load(id,track);
  }
  /** QA round 19 follow-up: per-clip timing writes (shift_clip / trim_clip are
   * clips:batch updates) carry the stored timing in their receipts. Project them
   * in order instead of a confirm read; any doubt returns false (one read). */
  projectClipTimingWrites(writes,scope){
    if(this.closed||this.projectId!==scope.projectId||this.trackId!==scope.trackId||(this.contextVersion||0)!==(scope.contextVersion||0))return false;
    let raw=this.rawProject,revision;const state=this.rawState||{};if(!raw||raw.id!==scope.projectId||!Array.isArray(raw.clips))return false;
    try{for(const write of writes){
      const args=write.args||{},op={op:'update',id:args.clip_id};for(const key of ['start_ms','duration_sec','audio_offset_sec'])if(args[key]!==undefined)op[key]=args[key];
      const {projected}=projectClipBatchReceipt(raw,[op],write.result);if(!projected)return false;raw=projected.rawProject;revision=projected.timelineRevision;
    }}catch{return false;}
    const savedClips=state.clips&&!Array.isArray(state.clips)&&state.clips.live===false,nextRaw={...raw,...raw._studioApi?{_studioApi:{...raw._studioApi,etag:JSON.stringify(revision)}}:{}};
    const nextState={...state,...state.project?{project:nextRaw}:{},...savedClips?{clips:{...state.clips,clips:nextRaw.clips}}:{}};
    let next;try{next=normalizeCloudProject(nextRaw,nextState,{projectId:this.projectId,trackId:this.trackId});}catch{return false;}
    if(next.patterns.some(pattern=>pattern.id===this.project?.selectedPattern))next.selectedPattern=this.project.selectedPattern;
    this.rawProject=nextRaw;this.rawState=nextState;this.project=next;this.projectedRevision=revision;this.lastClipTimingProjection={projected:true,writes:writes.length,revision};
    emit(this,'state',{project:next,raw:nextState,source:'clip-timing-receipt'});return true;
  }
  /** Abort the in-flight background refresh (QA round 19: a 12.4 s background
   * snapshot delayed a user Undo). Returns true when one was aborted. */
  preemptBackgroundRead(reason='user'){
    const read=this.backgroundRead;if(!read||read.controller.signal.aborted)return false;
    read.controller.abort();this.backgroundPreemptions=(this.backgroundPreemptions||0)+1;this.lastBackgroundPreemption={reason,at:this.now()};return true;
  }
  /** The engine's idle refresh: proxy background read slots, abortable by any user call. */
  backgroundRefresh(options={}){
    if(this.backgroundRead&&!this.backgroundRead.controller.signal.aborted)return this.backgroundRead.promise;
    const controller=new AbortController(),read={controller,promise:null};this.backgroundRead=read;
    read.promise=(async()=>{try{return await this.refresh({...options,requestOptions:{priority:'background',signal:controller.signal}});}
      catch(error){if(controller.signal.aborted)throw Object.assign(new Error('The background refresh gave way to a user request.'),{name:'AbortError',code:'background_read_preempted'});throw error;}
      finally{if(this.backgroundRead===read)this.backgroundRead=null;}})();
    return read.promise;
  }
  async refresh(options={}){
    if(!options.requestOptions)this.preemptBackgroundRead('refresh');
    // Bounded: at most READ_FENCE_WAIT_MS total waiting for overlapping writes.
    const deadline=Date.now()+(this.readFenceWaitMs??READ_FENCE_WAIT_MS);
    for(let attempt=1;;attempt++){
      if(this.mutationsInFlight){const left=deadline-Date.now();if(left<=0){this.lastStaleRead={skipped:true,attempt};return this.project;}await this.mutationsIdle(left);}
      const result=await this.readCanonical(options);
      if(result!==READ_STALE)return result;
      if(attempt>=READ_FENCE_ATTEMPTS){this.lastStaleRead={discarded:attempt,at:this.now()};return this.project;}
    }
  }
  async readCanonical({project=true,native=false,requestOptions}={}) {
    if(!this.projectId || !this.trackId)return null;
    const readOrder=this.readOrder=(this.readOrder||0)+1,mutationEpoch=this.mutationEpoch||0,overlapped=(this.mutationsInFlight||0)>0;
    const stale=()=>overlapped||mutationEpoch!==(this.mutationEpoch||0);
    const canonicalRead=project?(this.canonicalProjectReadRequested=(this.canonicalProjectReadRequested||0)+1):null;
    const id=this.projectId,trackId=this.trackId,contextVersion=this.contextVersion||0,placementVersion=this.placementReceiptVersion||0,startedAt=this.now(),transportVersion=this.transportVersion,observationVersion=this.transportObservationVersion||0,interactiveGeneration=this.interactive?.generation,interactiveRevision=this.interactive?.revision;
    const savedOnly=project&&this.rawState?.studioApi===true&&!native;
    const read=(name,args)=>requestOptions?this.call(name,args,requestOptions):this.call(name,args);
    const requests=savedOnly?[read('get_project',{project_id:id}),read('list_buses',{project_id:id})]:[read('get_pro_state',{project_id:id,track_id:trackId})];
    if(project&&!savedOnly)requests.push(read('get_project',{project_id:id}));
    const results=await Promise.all(requests);if(id!==this.projectId||trackId!==this.trackId||contextVersion!==(this.contextVersion||0))return this.project;
    let rawProject=savedOnly?body(unpack(results[0])):project?body(results[1]):this.rawProject;
    const baseState=savedOnly?restSavedSnapshot(rawProject,body(unpack(results[1])),this.rawState,id):body(results[0]),receiptFence=!!this.receiptPlacementProjects?.has(id);
    // These independent collections share the same captured project/context;
    // avoid serial engine round trips before enabling the editor.
    const [mixerState,patternState,placementState]=await Promise.all([
      this.hydrateMixerTracks(baseState,{projectId:id,trackId,requestOptions}),
      this.hydrateCanonicalPatterns(baseState,rawProject,{projectId:id,trackId,requestOptions}),
      this.hydrateCanonicalPlacements(baseState,rawProject,{projectId:id,trackId,contextVersion,forceCanonical:receiptFence,requestOptions})
    ]);
    if(id!==this.projectId||trackId!==this.trackId||contextVersion!==(this.contextVersion||0))return this.project;
    // A newer read already applied: keep it. A read overlapping a mutation is re-read.
    if(readOrder<(this.appliedReadOrder||0))return this.project;
    if(stale())return READ_STALE;
    this.appliedReadOrder=readOrder;
    let state={...baseState,tracks:mixerState.tracks,patterns:patternState.patterns,patternPlacements:placementState.patternPlacements,...(Array.isArray(placementState.placements)?{placements:placementState.placements}:{})};
    if(receiptFence)rawProject={...rawProject,placements:state.patternPlacements.placements};
    // An older read cannot restore a child removed by an acknowledged undo.
    if(placementVersion!==(this.placementReceiptVersion||0)){
      state={...state,patternPlacements:this.rawState.patternPlacements};
      if(Array.isArray(this.rawState.placements))state.placements=this.rawState.placements;
      rawProject={...rawProject,placements:this.rawProject.placements};
    }
    const currentTransport=this.rawState?.transport,metronomeFresh=!savedOnly&&typeof state.transport?.metronome==='boolean';
    if(savedOnly){state.project=rawProject;if(currentTransport)state.transport=currentTransport;else delete state.transport;}
    this.rawState=state;if(project){this.rawProject=rawProject;this.projectedRevision=undefined;}
    // get_pro_state can omit loop fields even after a successful loop write.
    // Sparse snapshots cannot erase previously observed authoritative bounds.
    for(const key of ['loop_enabled','loop_start_sec','loop_end_sec','metronome'])if(this.rawState.transport?.[key]==null&&currentTransport?.[key]!=null){this.rawState.transport||={};this.rawState.transport[key]=currentTransport[key];}
    // Live engine clocks have lower delivery latency than an HTTP state snapshot.
    // A slow poll must not jump the playhead backwards over a newer live anchor.
    if(savedOnly){/* Saved edits do not sample or re-anchor the transport clock. */}
    else if(this.hasFreshInteractiveClock())this.rawState.transport={...this.rawState.transport,...this.interactiveClock.payload};
    else if(this.hasFreshLiveClock())this.rawState.transport={...this.rawState.transport,...this.liveClock.payload};
    else if(transportVersion!==this.transportVersion||observationVersion!==(this.transportObservationVersion||0))this.rawState.transport={...this.rawState.transport,...currentTransport};
    else this.adoptTransport(this.rawState.transport||{is_playing:this.rawState.session?.isPlaying},{source:'http',observedAt:(startedAt+this.now())/2,metronomeFresh});
    this.project=normalizeCloudProject(this.rawProject || {},this.rawState,{projectId:this.projectId,trackId:this.trackId});
    // A conflict can be replanned only from a full canonical read requested
    // after the rejection. Clock-only polls and older in-flight reads do not
    // establish that recovery boundary. Keep the sequence of the applied read,
    // not the maximum, so a later stale completion cannot masquerade as fresh.
    if(project)this.canonicalProjectReadCompleted=canonicalRead;
    const interactiveRead=project&&interactiveGeneration===this.interactive?.generation&&interactiveRevision===this.interactive?.revision?{interactiveGeneration,interactiveRevision}:{};
    emit(this,'state',{project:this.project,raw:this.rawState,...interactiveRead});return this.project;
  }
  async refreshLaneMix(laneIds){
    const projectId=this.projectId,trackId=this.trackId,contextVersion=this.contextVersion||0,previousState=this.rawState,previousProject=this.rawProject;
    const check=()=>{if(this.closed||this.projectId!==projectId||this.trackId!==trackId||(this.contextVersion||0)!==contextVersion)throw Object.assign(new Error('The cloud project changed while confirming mixer values.'),{name:'AbortError',code:'lane_mix_scope_changed'});};
    const studioApi=previousState?.studioApi===true;check();const [raw,tracks]=await Promise.all([this.call('get_project',{project_id:projectId}),studioApi?Promise.resolve(previousState.tracks):this.readMixerTracks({projectId,trackId})]);check();
    const saved=body(raw?.structuredContent??raw);if(saved.id!==projectId||!Array.isArray(saved.lanes)||hasCanonicalTruncation(saved.lanes))throw new Error('Reload complete saved mixer lanes before another edit.');
    if(this.rawState!==previousState||this.rawProject!==previousProject)return this.refresh();
    const requested=new Set(laneIds),fields=['volume','muted','soloed','solo',...(studioApi?['pan']:[])];
    const lanes=previousProject.lanes.map(lane=>{if(!requested.has(lane.id))return lane;const matches=saved.lanes.filter(item=>item.id===lane.id);if(matches.length!==1)throw new Error('Freestyle did not confirm the saved mixer lane.');const patch={};for(const field of fields)if(Object.hasOwn(matches[0],field))patch[field]=matches[0][field];const nextLane={...lane,...patch};if(studioApi)for(const field of ['soloed','solo'])if(!Object.hasOwn(matches[0],field))delete nextLane[field];return nextLane;});
    // A mixer-only edit needs no repeated score, waveform or placement reads.
    // Preserve those accepted collections, and do not advertise this as a full
    // canonical conflict-recovery read.
    if(studioApi)this.lastLaneMixRead={projectId,trackId,contextVersion,project:structuredClone(saved),etag:saved._studioApi?.etag??null};
    this.rawProject={...previousProject,lanes};this.rawState={...previousState,tracks};
    this.project=normalizeCloudProject(this.rawProject,this.rawState,{projectId,trackId});emit(this,'state',{project:this.project,raw:this.rawState});return this.project;
  }
  /** Repaint from a live getEngineMix / waitEngineMix body (another person's
   * Studio fader move) without a project reload. The live mix becomes this
   * project's display overlay (lane volume/pan/mute/solo; pattern-lane mute/solo
   * stay saved because Freestyle keeps those on the placements); the saved raw
   * project is left as read, so a later canonical read cannot paint an older
   * saved value back. Float32 readbacks within tolerance are not a change.
   * Returns true when a shown lane, master or bus value changed. */
  adoptEngineMix(mix){
    const projectId=this.projectId,raw=this.rawProject,state=this.rawState;
    if(!mix||typeof mix!=='object'||!Array.isArray(mix.tracks)||!Array.isArray(mix.buses)||!raw||!state||raw.id!==projectId||mix.projectId!=null&&mix.projectId!==projectId)return false;
    // Compare what is shown now (this.project's lane channels; master/bus from
    // their saved rows) with the live mix: the overlay itself may already hold
    // this body (the tracker publishes every adopted mix).
    const num=value=>typeof value==='number'&&Number.isFinite(value),equal=(a,b)=>a===b||num(a)&&num(b)&&mixValuesEqual(a,b);
    let baseline=this.project;if(!baseline){const held=LIVE_MIX.get(projectId);LIVE_MIX.delete(projectId);try{baseline=normalizeCloudProject(raw,state,{projectId,trackId:this.trackId});}finally{if(held)LIVE_MIX.set(projectId,held);}}
    setLiveMixOverlay(projectId,mix);const project=normalizeCloudProject(raw,state,{projectId,trackId:this.trackId});
    const lanesChanged=project.channels.some(channel=>{if(channel.patternSource)return false;const old=baseline?.channels?.find(item=>!item.patternSource&&item.laneId===channel.laneId);return !old||['volume','pan','mute','solo'].some(field=>!equal(old[field],channel[field]));});
    let changed=lanesChanged;const master=mixControlValue(mix,{kind:'bus',id:'master'},'gain');if(master.known&&num(raw.masterGain)&&!equal(raw.masterGain,master.value))changed=true;
    for(const bus of Array.isArray(state.persistedBuses)?state.persistedBuses:[]){const id=bus?.id??bus?.bus_id;if(!id||id==='master')continue;for(const [control,field]of [['gain','gain'],['mute','muted'],['solo','soloed']]){const read=mixControlValue(mix,{kind:'bus',id},control);if(read.known&&Object.hasOwn(bus,field)&&!equal(bus[field],read.value))changed=true;}}
    if(!changed)return false;
    if(lanesChanged){this.project=project;emit(this,'state',{project,raw:state,mixAdopted:true});}return true;
  }
  async confirmRestLaneMix(previous,next,laneIds,fields,scope){
    const check=()=>{if(this.closed||this.projectId!==scope.projectId||this.trackId!==scope.trackId||(this.contextVersion||0)!==scope.contextVersion)throw Object.assign(new Error('The project changed before its mixer values could be saved.'),{name:'AbortError',code:'action_scope_changed'});};
    const entry={projectId:scope.projectId,status:'inspecting',laneIds:[...laneIds],source:'studio-api'};this.lastLaneMixPersistence=entry;
    const failure=(laneId,reason)=>Object.assign(new Error('Freestyle applied the live mixer edit, but its saved values are unconfirmed. Reload before another edit.'),{code:'mixer_saved_state_unconfirmed',laneId,reason});
    const read=()=>{const current=this.lastLaneMixRead;return current&&current.projectId===scope.projectId&&current.trackId===scope.trackId&&current.contextVersion===scope.contextVersion?current.project:this.rawProject;};
    const observed=(laneId,field)=>{const saved=read(),matches=array(saved?.lanes).filter(lane=>lane.id===laneId),lane=matches[0];if(saved?.id!==scope.projectId||matches.length!==1)throw failure(laneId,'ambiguous_saved_lane');if(field==='solo'){const aliases=['soloed','solo'].filter(key=>Object.hasOwn(lane,key));if(!aliases.length||!aliases.every(key=>typeof lane[key]==='boolean'&&lane[key]===lane[aliases[0]]))throw failure(laneId,'unknown_saved_value');return lane[aliases[0]];}const value=lane[{volume:'volume',pan:'pan',mute:'muted'}[field]];if(typeof value!==(field==='mute'?'boolean':'number')||typeof value==='number'&&!Number.isFinite(value))throw failure(laneId,'unknown_saved_value');return value;};
    const matches=(value,desired)=>typeof desired==='number'?typeof value==='number'&&Number.isFinite(value)&&mixValuesEqual(value,desired):value===desired;
    // A channel shows the live engine value; its cloudRaw keeps the saved row it was read with. Either is this gesture's starting point.
    const savedOf=(channel,field)=>{const lane=channel?.cloudRaw;return !lane||typeof lane!=='object'?undefined:field==='volume'?lane.volume:field==='pan'?lane.pan:field==='mute'?lane.muted:lane.soloed??lane.solo;};
    const changes=[];for(const laneId of laneIds){const before=previous.channels.find(channel=>!channel.patternSource&&channelLane(channel)===laneId),desired=next.channels.find(channel=>!channel.patternSource&&channelLane(channel)===laneId);for(const field of fields)if(desired[field]!==before[field])changes.push({laneId,field,before:before[field],savedBefore:savedOf(before,field),desired:desired[field]});}
    try{check();
      // Validate the entire saved group before the first fallback PATCH. A
      // different saved value belongs to another editor, never to this gesture.
      const startedAt=(value,change)=>matches(value,change.before)||change.savedBefore!==undefined&&matches(value,change.savedBefore);
      for(const change of changes){const value=observed(change.laneId,change.field);if(matches(value,change.desired))continue;if(!startedAt(value,change)||!['volume','mute','solo'].includes(change.field)||change.field==='volume'&&change.desired>4)throw failure(change.laneId,'saved_value_changed');}
      for(const change of changes){check();let value=observed(change.laneId,change.field);if(matches(value,change.desired))continue;if(!startedAt(value,change))throw failure(change.laneId,'saved_value_changed');
        const tag=read()?._studioApi?.etag;if(typeof tag!=='string'||!tag||/[\u0000-\u001f\u007f]/.test(tag))throw failure(change.laneId,'missing_saved_etag');
        const field={volume:'volume',mute:'muted',solo:'soloed'}[change.field],options={ifMatch:tag,idempotencyKey:uid()},args={project_id:scope.projectId,lane_id:change.laneId,[field]:change.desired},patch={laneId:change.laneId,field,before:change.before,value:change.desired,ifMatch:tag,idempotencyKey:options.idempotencyKey,status:'pending'};
        (entry.patches??=[]).push(patch);entry.status='saving';
        try{patch.receipt=structuredClone(body(unpack(await this.call('set_lane_identity',args,options))));patch.status='acknowledged';}catch(error){patch.status='unconfirmed';patch.error=error.message;throw error;}
        check();await this.refreshLaneMix(laneIds);check();value=observed(change.laneId,change.field);if(!matches(value,change.desired))throw failure(change.laneId,'patch_not_confirmed');patch.status='confirmed';
      }
      for(const change of changes)if(!matches(observed(change.laneId,change.field),change.desired))throw failure(change.laneId,'saved_value_changed');entry.status='saved';return entry;
    }catch(error){entry.status='saved_unconfirmed';entry.error=error.message;entry.code=error.code;throw error;}
  }
  async refreshTransportClock({projectId=this.projectId,trackId=this.trackId}={}){
    const scopeError=()=>Object.assign(new Error('The cloud project changed before its transport clock was observed.'),{name:'AbortError',code:'transport_scope_changed'});
    if(this.closed||!projectId||!trackId||projectId!==this.projectId||trackId!==this.trackId)throw scopeError();
    const canonicalTiming=()=>JSON.stringify([this.rawProject?.bpm??null,this.rawProject?.timingMap?.revision??null]),requestedTiming=canonicalTiming();
    const transportVersion=this.transportVersion,liveClock=this.liveClock,interactiveClock=this.interactiveClock,contextVersion=this.contextVersion||0;
    const payload=body(await this.call('execute_pro_action',{project_id:projectId,track_id:trackId,action:'get_transport_clock',arguments:{}}));
    const receivedAt=this.now();if(this.closed||projectId!==this.projectId||trackId!==this.trackId||contextVersion!==(this.contextVersion||0))throw scopeError();
    // A slower explicit read cannot undo a command acknowledgement or a newer
    // scoped WebRTC sequence/epoch, including packets received in the same ms.
    if(transportVersion!==this.transportVersion||liveClock!==this.liveClock&&!this.hasFreshInteractiveClock())return this.positionAt();
    // A nonblocking startup read can outlive a saved tempo/map edit. It cannot
    // put the old BPM back into the newly accepted project or clock anchor.
    if(requestedTiming!==canonicalTiming())return this.positionAt();
    if(payload?.session_epoch!=null&&liveClock?.epoch!=null&&Number.isFinite(Number(payload.session_epoch))&&Number(payload.session_epoch)<liveClock.epoch)return this.positionAt();
    if(payload?.ok===false||payload?.error||!hasLoopClock(payload)||typeof(payload?.is_playing??payload?.isPlaying)!=='boolean'||!Number.isFinite(Number(payload?.position_seconds))||Number(payload.position_seconds)<0)throw new Error('Freestyle did not return a complete authoritative transport clock.');
    // Without a producer timestamp, request duration says nothing about when
    // the server sampled the clock. Anchor at receipt, never half the HTTP RTT.
    const serverSentMs=Number(payload.server_sent_ms),delivery=Number.isFinite(serverSentMs)&&serverSentMs>0?this.clockDelivery.note({serverSentMs,receivedUnixMs:this.toUnixTime(receivedAt)}):null;
    const anchorAt=receivedAt-(delivery?.excessMs||0);this.explicitClock={projectId,trackId,receivedAt,anchorAt,anchorSource:delivery?'server-transit-excess':'response-receipt',payload:{...payload}};
    if(this.hasFreshInteractiveClock()){
      // An explicit clock read can confirm metronome state without replacing
      // a fresh, independently scoped push position with HTTP delivery timing.
      if(typeof payload.metronome==='boolean'){this.rawState||={};this.rawState.transport={...this.rawState.transport,metronome:payload.metronome};if(this.project)this.project.metronome=payload.metronome;emit(this,'transport',{...this.positionAt(),metronomeFresh:true});}
    }else this.adoptTransport(payload,{source:'http',observedAt:anchorAt});
    return this.positionAt();
  }
  async hydrateMixerTracks(state,{projectId=this.projectId,trackId=this.trackId,requestOptions}={}){
    if(state?.studioApi===true||!hasCanonicalTruncation(state?.tracks))return state;
    const result=await this.readMixerTracks({projectId,trackId,requestOptions});
    return {...state,tracks:result};
  }
  async readMixerTracks({projectId=this.projectId,trackId=this.trackId,requestOptions}={}){
    const raw=await this.call('execute_pro_action',{project_id:projectId,track_id:trackId,action:'list_tracks',arguments:{}},...requestOptions?[requestOptions]:[]),result=body(raw?.structuredContent??raw);
    assertCompleteCanonicalData(result,'live mixer tracks');
    if(raw?.isError||result.isError||result.ok===false||result.error||!Array.isArray(result.tracks))throw new Error('Freestyle did not return its complete live mixer tracks.');
    for(const key of ['project_id','projectId'])if(result[key]!=null&&result[key]!==projectId)throw new Error('The live mixer tracks belong to another project.');
    return result;
  }
  async hydrateCanonicalPatterns(state,project,{projectId=this.projectId,trackId=this.trackId,requestOptions}={}){
    const container=state?.patterns,current=array(container?.patterns||container),summaries=array(project?.patterns);
    const needsHydration=hasCanonicalTruncation(container)||current.some(entry=>{try{assertCompletePattern(entry);return false;}catch{return true;}})||(!current.length&&summaries.length>0);
    if(!needsHydration)return state;
    // list_patterns is an existing read action returning complete persisted DTOs;
    // get_pro_state intentionally budgets nested arrays and has no expansion flag.
    const result=body(await this.call('execute_pro_action',{project_id:projectId,track_id:trackId,action:'list_patterns',arguments:{}},...requestOptions?[requestOptions]:[]));
    const full=array(result?.patterns);assertCompleteCanonicalData(result,'canonical pattern list');
    for(const entry of full)assertCompletePattern(entry);
    const ids=new Set(full.map(entry=>String(entry.id||patternDTO(entry).id||entry.pattern_id||'')));
    const required=[...current,...summaries].filter(entry=>entry&&typeof entry==='object').map(entry=>entry.id||patternDTO(entry).id||entry.pattern_id).filter(Boolean).map(String);
    if(required.some(id=>!ids.has(id)))throw new Error('Freestyle returned an incomplete canonical pattern list. Reload the project before editing or previewing.');
    if(!Array.isArray(result?.patterns))throw new Error('Freestyle did not return its full canonical pattern list. Reload the project before editing or previewing.');
    return {...state,patterns:Array.isArray(container)?full:{...result,patterns:full}};
  }
  async hydrateCanonicalPlacements(state,project,{projectId=this.projectId,trackId=this.trackId,contextVersion=this.contextVersion||0,forceCanonical=false,requestOptions}={}){
    const container=state?.patternPlacements??state?.placements,current=array(container?.placements??container),summaries=array(project?.placements);
    const needsHydration=forceCanonical||!Array.isArray(container?.placements??container)||container?.ok===false||container?.error||container?.isError||hasCanonicalTruncation(container)||current.some(entry=>{try{assertCompletePlacement(entry);return false;}catch{return true;}})||(!current.length&&summaries.length>0);
    if(!needsHydration)return state;
    const check=()=>{if(this.closed||this.projectId!==projectId||this.trackId!==trackId||(this.contextVersion||0)!==contextVersion)throw Object.assign(new Error('The cloud project changed while its canonical placements were loading.'),{name:'AbortError',code:'canonical_placement_scope_changed'});};
    check();const result=body(await this.call('execute_pro_action',{project_id:projectId,track_id:trackId,action:'list_pattern_placements',arguments:{}},...requestOptions?[requestOptions]:[]));check();
    assertCompleteCanonicalData(result,'canonical pattern placement list');
    if(!Array.isArray(result?.placements)||result.ok===false||result.error)throw new Error('Freestyle did not return its full canonical pattern placement list.');
    const full=result.placements;for(const entry of full){assertCompletePlacement(entry);if(entry.projectId!=null&&entry.projectId!==projectId)throw new Error('Freestyle returned a pattern placement belonging to another cloud project.');}
    if((result.projectId!=null&&result.projectId!==projectId)||(result.project_id!=null&&result.project_id!==projectId))throw new Error('Freestyle returned a pattern placement list belonging to another cloud project.');
    // A complete canonical read can legitimately omit deleted placements; older
    // state and project summaries cannot require those stale identities back.
    const ids=new Set(full.map(entry=>entry.id));
    if(ids.size!==full.length)throw new Error('Freestyle returned an incomplete canonical pattern placement list. Reload the project before editing.');
    return {...state,patternPlacements:{...result,placements:full},...(Array.isArray(state?.placements)?{placements:full}:{})};
  }
  hasFreshLiveClock(maxAgeMs=1500){return !!this.liveClock&&this.liveClock.projectId===this.projectId&&!(this.clockSource==='http'&&this.explicitClock&&this.liveClock.receivedAt<=this.explicitClock.receivedAt)&&this.liveClock.receivedAt>this.lastTransportAppliedAt&&this.now()-this.liveClock.receivedAt>=0&&this.now()-this.liveClock.receivedAt<=maxAgeMs;}
  hasFreshInteractiveClock(maxAgeMs=2500,at=this.now()){const clock=this.interactiveClock,age=Number(at)-clock?.receivedAt;return !!clock&&!this.closed&&clock.projectId===this.projectId&&clock.trackId===this.trackId&&clock.contextVersion===(this.contextVersion||0)&&clock.transportVersion===this.transportVersion&&clock.receivedAt>=this.lastTransportAppliedAt&&age>=0&&age<=maxAgeMs;}
  /** WebSocket sample_frame is a project transport head, NOT the WebRTC device
   * clock used by preview receipts. Keep both sequence/generation domains apart.
   */
  acceptInteractiveClock(frame,{projectId=this.projectId,trackId=this.trackId,generation=0,receivedAt=this.now()}={}){
    if(this.closed||projectId!==this.projectId||trackId!==this.trackId||!frame||!Number.isSafeInteger(frame.seq)||frame.seq<0||!Number.isSafeInteger(frame.sample_frame)||frame.sample_frame<0||!Number.isFinite(frame.sample_rate)||frame.sample_rate<=0||typeof frame.playing!=='boolean'||!Number.isFinite(frame.bpm)||frame.bpm<=0||typeof frame.loop?.enabled!=='boolean'||!['start_sec','end_sec'].every(key=>Number.isFinite(frame.loop[key])&&frame.loop[key]>=0))return false;
    const previous=this.interactiveClock,sameGeneration=previous?.projectId===projectId&&previous.trackId===trackId&&previous.contextVersion===(this.contextVersion||0)&&previous.generation===generation;
    if(previous&&generation<previous.generation||sameGeneration&&frame.seq<=previous.sequence)return false;
    const payload={position_seconds:frame.sample_frame/frame.sample_rate,is_playing:frame.playing,bpm:frame.bpm,sample_rate:frame.sample_rate,loop_enabled:frame.loop.enabled,loop_start_sec:frame.loop.start_sec,loop_end_sec:frame.loop.end_sec};
    if(typeof frame.recording==='boolean')payload.recording=frame.recording;
    if(Number.isFinite(frame.producer_latency_seconds)&&frame.producer_latency_seconds>=0)payload.producer_latency_seconds=frame.producer_latency_seconds;
    const guard=this.transportGuard;
    if(guard&&receivedAt<guard.until){if(payload.is_playing!==guard.playing)return false;if(guard.seconds!=null){let expected=guard.seconds+(payload.is_playing?Math.max(0,(receivedAt-guard.appliedAt)/1000):0);const span=this.loopEndSec-this.loopStartSec;if(this.loopEnabled&&span>0&&expected>=this.loopStartSec)expected=this.loopStartSec+(expected-this.loopStartSec)%span;if(Math.abs(payload.position_seconds-expected)>.75)return false;}}
    this.transportGuard=null;
    this.interactiveClock={projectId,trackId,contextVersion:this.contextVersion||0,generation,sequence:frame.seq,receivedAt,anchorAt:receivedAt,transportVersion:this.transportVersion,payload,frame:structuredClone(frame)};
    this.adoptTransport(payload,{source:'interactive',observedAt:receivedAt,resetPhase:!sameGeneration});return true;
  }
  /** Adopt only this project's increasing native clock sequence, including loop bounds. */
  acceptClock(payload,{generation=0,receivedAt=this.now()}={}){
    if(!payload||String(payload.project_id||'')!==String(this.projectId)||this.closed)return false;
    const position=Number(payload.position_seconds??payload.position),seq=Number(payload.seq),epoch=Number(payload.session_epoch);
    if(!Number.isFinite(position)||position<0||typeof (payload.is_playing??payload.isPlaying)!=='boolean')return false;
    const guard=this.transportGuard;
    if(guard&&receivedAt<guard.until){
      const rolling=payload.is_playing??payload.isPlaying;if(rolling!==guard.playing)return false;
      if(guard.seconds!=null){let expected=guard.seconds+(rolling?Math.max(0,(receivedAt-guard.appliedAt)/1000):0);const span=this.loopEndSec-this.loopStartSec;if(this.loopEnabled&&span>0&&expected>=this.loopStartSec)expected=this.loopStartSec+(expected-this.loopStartSec)%span;if(Math.abs(position-expected)>.75)return false;}
    }
    this.transportGuard=null;
    const previous=this.liveClock,sameGeneration=previous?.projectId===this.projectId&&previous?.generation===generation;
    if(sameGeneration&&Number.isFinite(epoch)&&Number.isFinite(previous.epoch)&&epoch<previous.epoch)return false;
    const sameEpoch=!Number.isFinite(epoch)||!Number.isFinite(previous?.epoch)||epoch===previous.epoch;
    if(sameGeneration&&sameEpoch&&Number.isFinite(seq)&&seq<=previous.sequence)return false;
    if(!sameGeneration||!sameEpoch){this.loopIterations=0;this.clockDelivery.reset();}
    const delivery=this.clockDelivery.note({serverSentMs:payload.server_sent_ms,receivedUnixMs:this.toUnixTime(receivedAt)}),anchorAt=receivedAt-delivery.excessMs;
    // Preserve raw arrival/device-clock metadata independently of song-position
    // delivery compensation. Sequence and command guards run before estimation.
    this.liveClock={projectId:this.projectId,generation,epoch:Number.isFinite(epoch)?epoch:null,sequence:Number.isFinite(seq)?seq:0,receivedAt,anchorAt,deliveryExcessMs:delivery.excessMs,payload:{...payload}};
    if(!this.hasFreshInteractiveClock())this.adoptTransport(payload,{source:'live',observedAt:anchorAt,resetPhase:!sameGeneration||!sameEpoch});return true;
  }
  adoptTransport(payload,{source='ack',observedAt=this.now(),resetPhase=false,metronomeFresh}={}){
    this.transportObservationVersion=(this.transportObservationVersion||0)+1;
    const t=payload?.status&&typeof payload.status==='object'?{...payload,...payload.status}:{...(payload||{})};
    // Transport acknowledgements may echo requested settings. The metronome
    // indicator is owned by clock/state observations, never an ack payload.
    if(source==='ack')delete t.metronome;
    const oldPosition=this.positionSeconds,oldPlaying=this.playing,oldLoop=this.loopEnabled,oldStart=this.loopStartSec,oldEnd=this.loopEndSec;
    const position=Number(t.position_seconds??t.position),rolling=t.is_playing??t.isPlaying;
    if(Number.isFinite(position)&&position>=0)this.positionSeconds=position;
    if(typeof rolling==='boolean')this.playing=rolling;
    if(typeof t.loop_enabled==='boolean')this.loopEnabled=t.loop_enabled;
    if(Number.isFinite(Number(t.loop_start_sec)))this.loopStartSec=Math.max(0,Number(t.loop_start_sec));
    if(Number.isFinite(Number(t.loop_end_sec)))this.loopEndSec=Math.max(0,Number(t.loop_end_sec));
    const span=this.loopEndSec-this.loopStartSec,sameLoop=oldLoop===this.loopEnabled&&oldStart===this.loopStartSec&&oldEnd===this.loopEndSec;
    if(resetPhase||!sameLoop||!oldPlaying||!this.playing)this.loopIterations=0;
    else if((source==='live'||source==='interactive')&&this.loopEnabled&&span>0&&oldPosition-this.positionSeconds>span/2)this.loopIterations++;
    this.positionObserved=observedAt;this.clockSource=source;if(source==='ack')this.lastTransportAppliedAt=observedAt;
    if(Number.isFinite(Number(t.bpm))&&Number(t.bpm)>0)this.transportBpm=Number(t.bpm);
    const producer=t.measured_producer_latency_seconds??t.producer_latency_seconds;
    if(producer!==null&&producer!==undefined&&Number.isFinite(Number(producer))&&Number(producer)>=0)this.producerLagSec=Number(producer);
    this.rawState||={};this.rawState.transport={...this.rawState.transport,...t};
    if(this.project){this.project.loop=this.loopEnabled;if(this.transportBpm)this.project.bpm=this.transportBpm;if(typeof t.metronome==='boolean')this.project.metronome=t.metronome;}
    emit(this,'transport',{...this.positionAt(this.now()),metronomeFresh:source!=='ack'&&metronomeFresh!==false&&typeof t.metronome==='boolean'});
  }
  /** Display-clock interpolation only. Audio continues to be rendered by Mozart. */
  positionAt(at=this.now(),{heardLagSec=0}={}){
    if(this.clockSource==='interactive'&&!this.hasFreshInteractiveClock(2500,at)&&this.hasFreshLiveClock())this.adoptTransport(this.liveClock.payload,{source:'live',observedAt:this.liveClock.anchorAt,resetPhase:true});
    const elapsed=this.playing?Math.max(0,(Number(at)-this.positionObserved)/1000):0;
    const lag=this.playing?Math.max(0,Number(heardLagSec)||0):0,span=this.loopEndSec-this.loopStartSec;
    let seconds=this.positionSeconds+elapsed-lag;
    if(this.playing&&this.loopEnabled&&span>0&&this.positionSeconds>=this.loopStartSec){
      const phase=seconds-this.loopStartSec+this.loopIterations*span;
      seconds=phase<0?this.loopStartSec:this.loopStartSec+((phase%span)+span)%span;
    }
    seconds=Math.max(0,seconds);const bpm=this.transportBpm||this.project?.bpm||120;
    return {seconds,beat:seconds*bpm/60,playing:this.playing,bpm,transportKnown:['ack','http','live','interactive'].includes(this.clockSource),metronome:typeof this.rawState?.transport?.metronome==='boolean'?this.rawState.transport.metronome:null,loopEnabled:this.loopEnabled,loopStartSec:this.loopStartSec,loopEndSec:this.loopEndSec,clockSource:this.clockSource,clockAgeMs:Math.max(0,Number(at)-(this.clockSource==='interactive'?this.interactiveClock?.receivedAt??this.positionObserved:this.clockSource==='live'?this.liveClock?.receivedAt??this.positionObserved:this.positionObserved)),clockDeliveryExcessMs:this.clockSource==='live'?this.liveClock?.deliveryExcessMs||0:0,producerLagSec:this.producerLagSec,heardLagSec:lag};
  }
  applyTransportAcknowledgement(command,result,{seconds,projectId=this.projectId}={}){
    if(projectId!==this.projectId)return false;
    const source=result?.status&&typeof result.status==='object'?result.status:result?.ack?.status||result?.clock||result||{};
    const status={...source};
    if(typeof (status.is_playing??status.isPlaying)!=='boolean'){
      if(command==='play'||command==='seek_and_play')status.is_playing=true;
      if(command==='pause'||command==='stop')status.is_playing=false;
    }
    // Acknowledged pause freezes at the latest authoritative interpolation if its
    // status omits position. Stop does not invent a rewind that the engine denied.
    if(!Number.isFinite(Number(status.position_seconds??status.position)))status.position_seconds=seconds!=null?Number(seconds):this.positionAt().seconds;
    this.transportVersion++;const appliedAt=this.now();this.transportGuard={playing:status.is_playing??status.isPlaying??this.playing,seconds:command==='seek'||command==='seek_and_play'?Number(seconds):null,appliedAt,until:appliedAt+700};
    this.adoptTransport(status,{source:'ack',observedAt:appliedAt,resetPhase:command==='seek'||command==='seek_and_play'||command==='stop'});
    return true;
  }
  supportsPlacementRestore(){return this.placementRestoreSupported??((this.rawState?.studioApi===true||this.project?.cloud?.rawState?.studioApi===true)&&!!STUDIO_API_OPERATIONS.restorePatternPlacement);}
  supportsPlacementPhase(operation){return this.placementPhaseWritable!==false&&(this.rawState?.studioApi===true||this.project?.cloud?.rawState?.studioApi===true)&&declaredPlacementPhaseWritable(operation==='create'?'createPatternPlacement':operation==='update'?'updatePatternPlacement':operation);}
  /** 338 applyPatternPlacementBatch is in the generated contract and has not been refused as unknown on this connection. */
  supportsPlacementBatch(){return this.placementBatchUnavailable!==true&&(this.rawState?.studioApi===true||this.project?.cloud?.rawState?.studioApi===true)&&placementBatchSupported();}
  /** The signed inverse ops of one acknowledged batch (handed out once, same scope). */
  placementBatchInverse(result){const store=placementBatchInverseStores.get(this),entry=store?.get(result?._placementBatchReceiptId);if(!entry||entry.projectId!==this.projectId||entry.trackId!==this.trackId||entry.contextVersion!==(this.contextVersion||0))throw new Error('The acknowledged placement batch has no retained inverse.');store.delete(result._placementBatchReceiptId);return structuredClone(entry.inverseOps);}
  /** One atomic placement batch: queued like action(), If-Match = timeline
   * revision, one caller-retained Idempotency-Key, one 'action' event. Never
   * resent here (the proxy alone resends a keyed 503 engine-session refusal). */
  applyPlacementBatch(ops,{expectedContext,ifMatch,idempotencyKey=uid(),client=null,onTimelineRevision=null}={}){
    try{validatePlacementBatchOps(ops);assertCompleteCanonicalData(ops,'placement batch');}catch(error){return Promise.reject(error);}
    const scope=expectedContext||{projectId:this.projectId,trackId:this.trackId,contextVersion:this.contextVersion||0};
    this.actionPending=(this.actionPending||0)+1;
    const task=async()=>{
      const checkScope=()=>{if(this.closed||this.projectId!==scope.projectId||this.trackId!==scope.trackId||(this.contextVersion||0)!==(scope.contextVersion||0))throw Object.assign(new Error('The cloud project changed before this placement batch completed.'),{name:'AbortError',code:'action_scope_changed'});};
      checkScope();
      if(typeof ifMatch!=='string'||!ifMatch)throw Object.assign(new Error('Read a fresh saved timeline revision before a placement batch.'),{dispatched:false});
      const studio=client||(this.studioApiClient||=new StudioApiClient());let response;
      try{response=await studio.call('applyPatternPlacementBatch',{path:{project_id:scope.projectId},body:{ops:structuredClone(ops)}},{idempotencyKey,ifMatch});}
      catch(error){if(placementBatchUnavailable(error)){this.placementBatchUnavailable=true;Object.assign(error,{placementBatchUnavailable:true,operationUncertain:false,dispatched:false});}else if(error.operationUncertain===undefined)error.operationUncertain=![400,403,404,409,412,422,428].includes(error.status);error.idempotencyKey=idempotencyKey;throw error;}
      checkScope();let receipt;
      try{receipt=placementBatchReceipt(response.data,ops,{projectId:scope.projectId});}catch(error){throw Object.assign(error,{operationUncertain:true,idempotencyKey});}
      adoptStudioWrite(scope.projectId,{base:ifMatch,etag:typeof response.etag==='string'&&response.etag?response.etag:JSON.stringify(receipt.timelineRevision)});
      onTimelineRevision?.(receipt.timelineRevision);
      let store=placementBatchInverseStores.get(this);if(!store){store=new Map();placementBatchInverseStores.set(this,store);}const key=uid();store.set(key,{...scope,inverseOps:receipt.inverseOps});
      const result={ok:true,_placementBatchReceiptId:key,results:receipt.results,createdIds:receipt.createdIds,deletedIds:receipt.deletedIds,placements:receipt.placements,inverseOps:redactPlacementBatchOps(receipt.inverseOps),timelineRevision:receipt.timelineRevision,createdLaneIds:receipt.createdLaneIds};
      this.lastPlacementBatch={scope:structuredClone(scope),ops:redactPlacementBatchOps(ops),result:structuredClone(result),idempotencyKey};
      emit(this,'action',{name:'apply_pattern_placement_batch',args:{ops:redactPlacementBatchOps(ops)},result,studioApi:{operationId:'applyPatternPlacementBatch',etag:response.etag??null}});
      return result;
    };
    const pending=this.queue.then(task).finally(()=>{this.actionPending=Math.max(0,(this.actionPending||1)-1);});this.queue=pending.catch(error=>{emit(this,'error',error);});return pending;
  }
  placementDeleteUndo(receipt,placementId){const store=placementUndoStores.get(this),entry=store?.get(receipt?._placementRestoreReceiptId);if(!entry||entry.projectId!==this.projectId||entry.trackId!==this.trackId||entry.contextVersion!==(this.contextVersion||0)||entry.handle.placementId!==placementId)throw new Error('The acknowledged deletion has no verified retained signed restore receipt.');store.delete(receipt._placementRestoreReceiptId);return entry.handle;}
  action(name,args={},options={}) {
    try{assertCompleteCanonicalData(args,'cloud action payload');if(['preview_pattern','update_pattern','create_pattern'].includes(name)&&args.pattern)assertCompletePattern(args.pattern.pattern?args.pattern:{pattern:args.pattern});}catch(error){return Promise.reject(error);}
    const expectedContext=options.expectedContext||{projectId:this.projectId,trackId:this.trackId,contextVersion:this.contextVersion||0};
    this.actionPending=(this.actionPending||0)+1;
    const task=async()=>{
      const checkScope=()=>{if(this.closed||this.projectId!==expectedContext.projectId||this.trackId!==expectedContext.trackId||(this.contextVersion||0)!==(expectedContext.contextVersion||0))throw Object.assign(new Error('The cloud project changed before this action completed.'),{name:'AbortError',code:'action_scope_changed'});};
      checkScope();
      if(!this.projectId || !this.trackId)throw new Error('Load a Freestyle cloud project first.');
      const studioApi=this.rawState?.studioApi===true||this.project?.cloud?.rawState?.studioApi===true;let result;
      if(!studioApi&&this.interactive?.ready&&!this.isGenerativeAction(name)&&!MCP_SLOW_ACK_ACTIONS.has(name)){
        const acknowledgement=await this.interactive.command(name,args,{...(options.confirmedDestructive?{confirmed_destructive:true}:{}),...(options.baseRevision!==undefined?{base_revision:options.baseRevision}:{}),...(options.requireBase!==undefined?{require_base:options.requireBase}:{})});
        if(acknowledgement.status!=='applied'||acknowledgement.committed!==true)throw Object.assign(new Error('The interactive command was not committed as this edit. Inspect canonical state before repeating it.'),{code:acknowledgement.status==='coalesced'?'interactive_coalesced':'interactive_uncommitted',sent:true,uncertain:false,fallbackAllowed:false,receipt:acknowledgement});
        result=acknowledgement.result;
      }else try{result=await this.call('execute_pro_action',{project_id:this.projectId,track_id:this.trackId,action:name,arguments:args,...(options.confirmedDestructive?{confirmed_destructive:true}:{})},Object.fromEntries(['idempotencyKey','ifMatch'].filter(key=>options[key]!==undefined).map(key=>[key,options[key]])));}
      catch(error){if(studioApi&&PLACEMENT_WRITES.has(name)){if(error.operationUncertain===undefined)error.operationUncertain=![400,403,404,409,412,422,428].includes(error.status);if(options.idempotencyKey!==undefined&&error.idempotencyKey===undefined)error.idempotencyKey=options.idempotencyKey;}throw name==='restore_pattern_placement'?redactedPlacementError(error,options.placementRestoreHandle):error;}
      checkScope();
      const decoded=studioApi?unpack(result):result;let response=body(decoded);const metadata=studioApi?decoded?._studioApi:null;
      if(studioApi){
        const outer=timelineRevisionValue(decoded?.timelineRevision),inner=timelineRevisionValue(response?.timelineRevision);
        if(outer!==undefined&&inner!==undefined&&outer!==inner)throw Object.assign(new Error('Freestyle returned conflicting timeline revisions for this acknowledged action.'),{code:'action_revision_unconfirmed',operationUncertain:true});
        const revision=outer??inner;options.onTimelineRevision?.(revision);
        if(PLACEMENT_WRITES.has(name)&&revision!==undefined&&response&&typeof response==='object'&&!Array.isArray(response))response={...response,timelineRevision:revision,...(response.ok===undefined&&typeof decoded?.ok==='boolean'?{ok:decoded.ok}:{})};
      }
      if(name==='delete_pattern_placement'){
        const placementId=args.placement_id,prior=this.project?.clips?.find(clip=>clip.cloudId===placementId);
        let handle;if(options.retainDeleteUndo!==false&&this.supportsPlacementRestore())try{handle=retainPlacementDeleteUndo(decoded,{projectId:this.projectId,placementId,beforeSide:prior?.cloudRaw});}catch{/* The saved deletion remains visible; history refuses its invalid undo. */}
        response=redactPlacementRestoreSecrets(response);
        if(handle){let store=placementUndoStores.get(this);if(!store){store=new Map();placementUndoStores.set(this,store);}const key=uid();store.set(key,{...expectedContext,handle});response={...response,_placementRestoreReceiptId:key};}
      }
      const safeArgs=name==='restore_pattern_placement'?redactPlacementRestoreSecrets(args,options.placementRestoreHandle):args;
      emit(this,'action',{name,args:safeArgs,result:response,...(metadata?{studioApi:structuredClone(metadata)}:{})});
      if(options.refresh!==false)await this.refresh();return response;
    };
    const pending=this.queue.then(task).finally(()=>{this.actionPending=Math.max(0,(this.actionPending||1)-1);});this.queue=pending.catch(error=>{emit(this,'error',error);});return pending;
  }
  isGenerativeAction(name){return this.generativeActions?.has(name)||MCP_ONLY_ACTIONS.has(name);}
  async applyProject(previous,next,{deferRefresh}={}) {
    this.lastLaneMixPersistence=null;this.lastLaneMixRead=null;this.lastApplyIdMap={patterns:{},placements:{}};this.lastApplyProjected=false;
    previous={...previous,audioClips:array(previous.audioClips),channels:previous.channels.filter(c=>c.id!=='empty'),patterns:previous.patterns.filter(p=>p.id!=='empty')};
    next={...next,audioClips:Array.isArray(next.audioClips)?next.audioClips:previous.audioClips,channels:next.channels.filter(c=>c.id!=='empty'),patterns:next.patterns.filter(p=>p.id!=='empty')};
    for(const pattern of [...previous.patterns,...next.patterns]){if(pattern.cloudRaw)assertCompletePattern(pattern.cloudRaw);assertCompleteCanonicalData(pattern.steps);assertCompleteCanonicalData(pattern.notes);}
    if(next.clips.some(clip=>clip.patternId==='empty'))throw new Error('Create a cloud pattern before placing a clip.');
    if(!this.projectId || previous.cloud?.projectId!==this.projectId || next.cloud?.projectId!==this.projectId)throw new Error('The edit does not belong to the loaded cloud project. Reload it before editing.');
    const studioApi=previous.cloud?.rawState?.studioApi===true||this.rawState?.studioApi===true,mixFields=['volume','mute','solo',...(studioApi?['pan']:[])];
    const mixLaneIds=next.channels.filter(channel=>{const old=previous.channels.find(item=>item.id===channel.id);return old&&!channel.patternSource&&mixFields.some(field=>channel[field]!==old[field]);}).map(channel=>channelLane(channel));
    const withoutMix={...next,channels:next.channels.map(channel=>{const old=previous.channels.find(item=>item.id===channel.id);return old&&!channel.patternSource?{...channel,volume:old.volume,mute:old.mute,solo:old.solo,...(studioApi?{pan:old.pan}:{})}:channel;})};
    const laneMixOnly=mixLaneIds.length>0&&JSON.stringify(previous)===JSON.stringify(withoutMix);
    const expectedContext={projectId:this.projectId,trackId:this.trackId,contextVersion:this.contextVersion||0};
    const checkEditScope=()=>{if(this.closed||this.projectId!==expectedContext.projectId||this.trackId!==expectedContext.trackId||(this.contextVersion||0)!==expectedContext.contextVersion)throw Object.assign(new Error('The cloud project changed before this edit completed.'),{name:'AbortError',code:'action_scope_changed'});};
    if(next.master!==previous.master)throw new Error('Use the Mixer master fader to confirm saved and live master gain.');
    const unsupported=next.channels.filter(c=>{const old=previous.channels.find(o=>o.id===c.id);return old&&(!studioApi&&numeric(c.pan)!==numeric(old.pan)||JSON.stringify(c.effects || {})!==JSON.stringify(old.effects || {}));});
    if(unsupported.length)throw new Error('Use the Mixer pan control to confirm saved and live pan. Effects use their actual cloud plugin parameters.');
    const audioMoveTargets=new Map();
    for(const clip of next.audioClips){
      const old=previous.audioClips.find(c=>c.id===clip.id);
      if(!old)throw new Error('New audio clips must be imported or split in Freestyle; a local clone cannot create persisted audio.');
      if(numeric(clip.offset)!==numeric(old.offset)&&!old.offsetKnown)throw new Error('Freestyle has not exposed this clip’s source offset. Reload its live audio state before changing the source trim.');
      if(clip.name!==old.name || clip.mute!==old.mute)throw new Error('Rename individual audio clips through clip appearance tools. Use the playlist track controls to mute their lane.');
      if(clip.track!==old.track||clip.laneId!==old.laneId){
        this.durableAudioClipId(old);const target=clip.track!==old.track?next.cloud.timelineLaneIds?.[clip.track]:clip.laneId,lanes=array(previous.cloud?.rawProject?.lanes),matches=lanes.filter(lane=>lane.id===target);
        if(typeof target!=='string'||matches.length!==1||!['audio','vocal'].includes(matches[0].kind)||clip.laneId!==old.laneId&&clip.laneId!==target)throw new Error('Choose one existing audio or vocal track before moving this audio clip.');
        if(studioApi&&Number.isInteger(numeric(clip.start)*60/numeric(next.bpm,120)*1000)){const revision=previous.cloud?.rawProject?.timelineRevision;if(typeof revision!=='string'||!revision||revision.length>128||/[\r\n]/.test(revision))throw new Error('Reload the saved timeline revision before moving audio between tracks.');}
        audioMoveTargets.set(clip.id,target);
      }
      if(clip.volume!==old.volume&&(!exactNumber(clip.volume)||clip.volume<0||clip.volume>4))throw new Error('Audio clip gain must be a finite linear value from 0 to 4.');
      if(clip.start!==old.start||clip.length!==old.length||clip.offset!==old.offset||clip.volume!==old.volume)audioIdentity(old);
    }
    for(const old of previous.audioClips)if(!next.audioClips.some(clip=>clip.id===old.id))audioIdentity(old);
    // Pattern validation must precede every mutation in a mixed gesture. Reuse
    // these DTOs so preflight and dispatch keep the same generated identities.
    const previousPatternDTOs=new Map(previous.patterns.map(pattern=>[pattern,serializeCloudPattern(pattern,previous)]));
    const nextPatternDTOs=new Map(next.patterns.map(pattern=>[pattern,serializeCloudPattern(pattern,next)]));
    // Validate every requested phase before any other member can be written.
    for(const clip of next.clips){const old=previous.clips.find(c=>c.id===clip.id),dto=serializeCloudPlacement(clip,next),prior=old?serializeCloudPlacement(old,previous):null,raw=clip.cloudRaw||{},rawPhase=Object.hasOwn(raw,'loopPhaseMs')?raw.loopPhaseMs:Object.hasOwn(raw,'loop_phase_ms')?raw.loop_phase_ms:dto.loopPhaseMs,/* REST: the same whole-ms phase serializeCloudPlacement sends (a trim at 124 BPM is fractional ms). */phase=next.cloud?.rawState?.studioApi===true?wholePhaseMs(rawPhase,raw.loopDurationMs??raw.loop_duration_ms??raw.durationMs??raw.duration_ms??dto.loopDurationMs??dto.durationMs):rawPhase,phaseChanged=!old||phase!==prior.loopPhaseMs;if(!phaseChanged)continue;
      const writable=this.supportsPlacementPhase(old?'update':'create');if(!writable){if(phase!==0||old)throw new Error('This connection does not advertise writable pattern-placement phase.');continue;}
      const unit=dto.loopDurationMs??dto.durationMs;if(!Number.isSafeInteger(phase)||phase<0||!Number.isSafeInteger(unit)||unit<1||phase>=unit)throw new Error('Pattern-placement phase must be integer milliseconds inside its loop unit.');
    }
    const removedChannels=previous.channels.filter(channel=>!channel.patternSource&&!next.channels.some(nextChannel=>nextChannel.id===channel.id));
    const removals=[];
    for(const channel of removedChannels){
      const id=channel.laneId||channel.cloudTrackId,lanes=array(previous.cloud?.rawProject?.lanes);
      if(typeof id!=='string'||!id||id.length>64||!array(previous.cloud?.timelineLaneIds).includes(id)&&!lanes.some(lane=>lane.id===id))throw new Error('Reload the channel’s canonical durable lane identity before deleting it; display names and runtime indexes cannot select a deletion target.');
      removals.push({channel,id});
    }
    if(removals.length){
      if(!expectedContext.trackId||this.closed)throw new Error('Load a Freestyle engine context before discovering track deletion.');
      checkEditScope();const capability=typedActionCapability(await this.call('list_pro_capabilities',{action:'delete_track'}),'delete_track');checkEditScope();
      for(const removal of removals)removal.args=typedIdentityActionArguments(capability,{identityField:'track_id',identity:removal.id,projectId:expectedContext.projectId});
    }
    const mixerTargets=new Map();
    if(mixLaneIds.length&&studioApi){
      checkEditScope();const source=previous.cloud?.rawProject||this.rawProject,lanes=source?.lanes;
      const bad=(laneId,message)=>Object.assign(new Error(message),{code:'mixer_target_unavailable',laneId});
      if(source?.id!==expectedContext.projectId||!Array.isArray(lanes)||hasCanonicalTruncation(lanes)||source.truncated?.lanes===true||source.lanesTruncated===true||source.lanes_truncated===true||new Set(mixLaneIds).size!==mixLaneIds.length)throw bad(null,'Reload complete, unambiguous saved mixer lanes before editing.');
      for(const laneId of mixLaneIds){const matches=lanes.filter(lane=>lane.id===laneId),lane=matches[0],old=previous.channels.find(channel=>channelLane(channel)===laneId),channel=next.channels.find(item=>item.id===old?.id);
        if(typeof laneId!=='string'||matches.length!==1||!['audio','vocal','instrument'].includes(lane?.kind)||!old||!channel)throw bad(laneId,'This mixer control has no uniquely verified audio or instrument lane.');
        const savedSolo=['soloed','solo'].filter(field=>Object.hasOwn(lane,field)),saved={volume:lane.volume,pan:lane.pan,mute:lane.muted,solo:savedSolo.length&&savedSolo.every(field=>typeof lane[field]==='boolean'&&lane[field]===lane[savedSolo[0]])?lane[savedSolo[0]]:undefined};
        for(const field of mixFields){if(channel[field]===old[field])continue;const valid=value=>field==='volume'?typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=16:field==='pan'?typeof value==='number'&&Number.isFinite(value)&&value>=-1&&value<=1:typeof value==='boolean';if(!valid(saved[field])||!mixValuesEqual(saved[field],old[field])||!valid(channel[field]))throw bad(laneId,'Read the saved mixer value before changing this control.');}
        mixerTargets.set(laneId,laneId);
      }
    }else if(mixLaneIds.length){
      checkEditScope();let live;
      for(let attempt=0;attempt<3;attempt++){
        live=await this.readMixerTracks(expectedContext);checkEditScope();
        if(mixLaneIds.every(laneId=>live.tracks.some(track=>track.db_track_id===laneId)))break;
        // A session replacement can expose an empty track list while its
        // persisted lanes restore. Re-read only; no write has been dispatched.
        if(attempt<2)await new Promise(resolve=>setTimeout(resolve,150));
      }
      for(const laneId of mixLaneIds){const matches=live.tracks.filter(track=>track.db_track_id===laneId),track=matches[0];if(matches.length!==1||!Number.isInteger(track?.id)||track.id<0||live.tracks.filter(item=>item.id===track.id).length!==1)throw Object.assign(new Error(`Reload the Mixer: ${previous.channels.find(channel=>channelLane(channel)===laneId)?.name||laneId} has no unique current engine track.`),{code:'mixer_target_unavailable',laneId,tracks:live.tracks.map(item=>({id:item.id,laneId:item.db_track_id}))});mixerTargets.set(laneId,String(track.id));}
    }
    // A projected snapshot leaves the bridge's read-only ETag cache behind the
    // returned revision. Writes that rely on that cache read once first.
    const unproject=async()=>{if(studioApi&&this.projectedRevision!==undefined){checkEditScope();await this.refresh();checkEditScope();}};
    const playlistMove=studioApi?capturePlaylistMove(previous,next):null;
    if(playlistMove){
      if(this.lastPlaylistMove?.status==='uncertain'&&sameData(this.lastPlaylistMove.scope,expectedContext))throw Object.assign(new Error('Inspect and reopen the project before repeating an uncertain Playlist move.'),{operationUncertain:true,playlistMoveReceipt:structuredClone(this.lastPlaylistMove)});
      const record={scope:structuredClone(expectedContext),plan:structuredClone(playlistMove)};this.lastPlaylistMove=record;
      const result=await executePlaylistMove({session:this,plan:playlistMove,scope:expectedContext,record,assert:checkEditScope,read:async()=>{const saved=body(unpack(await this.call('get_project',{project_id:expectedContext.projectId})));checkEditScope();this.projectedRevision=undefined;return projectPlaylistMove(this,saved,expectedContext);}});
      if(result.patterns.some(p=>p.id===next.selectedPattern))result.selectedPattern=next.selectedPattern;emit(this,'state',{project:result,raw:this.rawState});return result;
    }
    const audioBatch=planAudioTimingBatch(previous,next);
    if(audioBatch){if(studioApi&&this.projectedRevision!==undefined)await unproject();return this.applyAudioTimingBatch(audioBatch,{selectedPattern:next.selectedPattern});}
    let placementRevision=timelineRevisionValue(previous.cloud?.rawProject?.timelineRevision);
    const run=(name,args,confirmed=false,requestOptions={})=>{
      if(!PROJECTABLE_WRITES.has(name)&&studioApi&&this.projectedRevision!==undefined)return unproject().then(()=>run(name,args,confirmed,requestOptions));
      checkEditScope();const placementWrite=studioApi&&PLACEMENT_WRITES.has(name);
      // After a projected batch, a pattern write is guarded by the revision our
      // own acknowledged write returned, not by the older cached read ETag.
      // QA round 22: always guard a pattern write by the confirmed base's revision, never the
      // bridge's cached read tag (typed channel writes and their undo descriptors move the
      // timeline without that cache: a stale tag was a 412 that rolled the step/swing back).
      if(studioApi&&name==='update_pattern'&&placementRevision!==undefined&&requestOptions.ifMatch===undefined)requestOptions={...requestOptions,ifMatch:JSON.stringify(placementRevision)};
      if(placementWrite&&placementRevision===undefined)throw new Error('Read a fresh saved timeline revision before continuing placement edits; the previous write will not be repeated.');
      const chained=studioApi&&CHAINED_TIMELINE_WRITES.has(name)&&placementRevision!==undefined&&requestOptions.ifMatch===undefined;
      return this.action(name,args,{refresh:false,confirmedDestructive:confirmed,expectedContext,...requestOptions,
        ...(placementWrite?{ifMatch:JSON.stringify(placementRevision),idempotencyKey:requestOptions.idempotencyKey||uid()}:{}),
        ...(chained?{ifMatch:JSON.stringify(placementRevision)}:{}),
        ...(studioApi?{onTimelineRevision:revision=>{placementRevision=revision;}}:{})}).then(result=>{writes.push({name,args,result});return result;});
    };
    // Acknowledged writes of this batch, used to project an in-place edit
    // without a full read while newer local edits are already queued.
    const writes=[];
    // Agent-safe mixing: each live-mix write carries the held live revision
    // (kept current by mix:wait and write receipts; no pre-read). A 412 costs
    // one fresh read: resent once only when every change since was our own.
    const mixGuard=studioApi&&this.mixRevision?.available?.(expectedContext.projectId)?this.mixRevision:null;
    const mixRun=async(action,args,target,control,value)=>{
      if(!mixGuard)return run(action,args);const changes=[{target,control,value}];
      let revision;if(mixGuard.ownPending?.())revision=await mixGuard.guard(changes,{projectId:expectedContext.projectId});else{mixGuard.noteOwn(target,control,value);revision=mixGuard.revision;}checkEditScope();
      for(let attempt=0;;attempt++){
        try{const result=await run(action,revision==null?args:{...args,expected_mix_revision:revision});mixGuard.noteWrite(result,changes,{expected:revision});return result;}
        catch(error){if(attempt>0||revision==null||!isMixRevisionConflict(error))throw error;const resolution=await mixGuard.resolveConflict(error);checkEditScope();if(!resolution.explained||resolution.revision==null)throw error;revision=resolution.revision;}
      }
    };
    const changed=(a,b)=>JSON.stringify(a)!==JSON.stringify(b),idMap={};
    const trackDeletion=removals.length?{projectId:expectedContext.projectId,trackIds:removals.map(removal=>removal.id),receipts:[],status:'prepared',canonicalConfirmed:false}:null;let deletionAttempted=false,deletionRefreshStarted=false;
    try {
      checkEditScope();if(next.title!==previous.title){if(studioApi&&this.projectedRevision!==undefined)await unproject();await this.call('rename_project',{project_id:expectedContext.projectId,title:next.title});checkEditScope();}
      if(next.bpm!==previous.bpm)await run('set_project_tempo',{bpm:Number(next.bpm)});
      // Model.loop is observed transport state, not an authored project field.
      // Intentional loop edits use the dedicated scoped loop-region controls.
      const timelineIds=previous.cloud.timelineLaneIds || [];
      const rowKeys=new Set([...Object.keys(previous.trackNames || {}),...Object.keys(next.trackNames || {}),...(previous.mutedTracks || []).map(String),...(next.mutedTracks || []).map(String)]);
      for(const key of rowKeys){
        const index=Number(key),renamed=next.trackNames?.[key]!==previous.trackNames?.[key],muted=(next.mutedTracks || []).includes(index),muteChanged=muted!==(previous.mutedTracks || []).includes(index);
        if(!renamed&&!muteChanged)continue;
        const laneId=timelineIds[index];if(!laneId)throw new Error(`Playlist row ${index+1} has no cloud lane yet. Place a cloud pattern there before renaming or muting the row.`);
        if(renamed)await run('rename_track',{track_id:laneId,label:next.trackNames?.[key] || `Track ${index+1}`});
        if(muteChanged)await mixRun('set_track_muted',{track_id:laneId,muted},{kind:'lane',id:laneId},'mute',muted);
      }
      for(const channel of next.channels){
        const old=previous.channels.find(c=>c.id===channel.id);
        if(!old)continue;
        if(channel.patternSource)continue;
        const laneId=channelLane(channel);
        const savedMix={};
        if(channel.volume!==old.volume){await mixRun('set_track_gain',{track_id:mixerTargets.get(laneId),gain:Number(channel.volume)},{kind:'lane',id:laneId},'gain',Number(channel.volume));savedMix.volume=Number(channel.volume);}
        if(channel.mute!==old.mute){await mixRun('set_track_muted',{track_id:mixerTargets.get(laneId),muted:!!channel.mute},{kind:'lane',id:laneId},'mute',!!channel.mute);savedMix.muted=!!channel.mute;}
        if(channel.solo!==old.solo){await mixRun('set_track_soloed',{track_id:mixerTargets.get(laneId),soloed:!!channel.solo},{kind:'lane',id:laneId},'solo',!!channel.solo);savedMix.soloed=!!channel.solo;}
        if(studioApi&&channel.pan!==old.pan)await mixRun('set_track_pan',{track_id:laneId,pan:Number(channel.pan),persist:true},{kind:'lane',id:laneId},'pan',Number(channel.pan));
        // Native mix actions alter the running session; lane identity owns the
        // durable mixer values restored on the next project load.
        if(!studioApi&&Object.keys(savedMix).length){checkEditScope();try{await this.call('set_lane_identity',{project_id:expectedContext.projectId,lane_id:laneId,...savedMix});}catch(error){if(error.code!=='legacy_track_identity')throw error;this.lastLaneMixPersistence={projectId:expectedContext.projectId,status:'live_only',laneIds:[...(this.lastLaneMixPersistence?.laneIds||[]),laneId],code:error.code};}checkEditScope();}
        if(channel.name!==old.name)await run('rename_track',{track_id:laneId,label:channel.name});
      }
      const secondsPerBeat=60/numeric(next.bpm,120);
      for(const old of previous.audioClips)if(!next.audioClips.some(c=>c.id===old.id))await run('delete_clip',audioIdentity(old),true);
      for(const clip of next.audioClips){
        const old=previous.audioClips.find(c=>c.id===clip.id),identity=audioIdentity(old),targetLane=audioMoveTargets.get(clip.id)||old.laneId;
        const movedLane=targetLane!==old.laneId;
        if(movedLane){
          const startMs=numeric(clip.start)*secondsPerBeat*1000,dedicated=studioApi&&Number.isInteger(startMs),revision=previous.cloud?.rawProject?.timelineRevision;
          if(dedicated&&(typeof revision!=='string'||!revision||revision.length>128||/[\r\n]/.test(revision)))throw new Error('Reload the saved timeline revision before moving audio between tracks.');
          const expected=dedicated&&Number.isInteger(old.cloudRaw?.startMs)?{lane_id:old.laneId,start_ms:old.cloudRaw.startMs}:undefined;
          await run('move_clip_to_lane',{clip_id:this.durableAudioClipId(old),lane_id:targetLane,start_ms:startMs,...(expected?{expected}:{})},false,dedicated?{ifMatch:JSON.stringify(revision),idempotencyKey:uid()}:{});identity.track_id=targetLane;
        }
        // QA round 20: send the server's storage precision (whole ms, 6-decimal
        // seconds; live 30000.4 → 30000). An unsnapped drag otherwise saves a
        // rounded window that its own receipt/history cannot confirm.
        else if(clip.start!==old.start)await run('shift_clip',{...identity,start_ms:storedClipMs(numeric(clip.start)*secondsPerBeat*1000)});
        if(clip.length!==old.length || clip.offset!==old.offset){const args={...identity,duration_sec:Math.max(.001,storedClipSeconds(numeric(clip.length)*secondsPerBeat))};if(clip.offset!==old.offset)args.audio_offset_sec=Math.max(0,storedClipSeconds(numeric(clip.offset)*secondsPerBeat));await run('trim_clip',args);}
        if(clip.volume!==old.volume)await run('set_clip_gain',{...identity,gain:Number(clip.volume)});
      }
      // 338: two or more pattern-clip writes of one gesture (multi-select move,
      // Delete, Paste, Duplicate, a Paint stroke) are ONE atomic placement batch;
      // its undo.inverse_ops is the exact Undo. A single write keeps its route.
      const removedPlacements=previous.clips.filter(clip=>!next.clips.some(c=>c.id===clip.id)&&clip.cloudId);
      const placementWork=removedPlacements.length+next.clips.filter(clip=>{const old=previous.clips.find(c=>c.id===clip.id);return !old||changed(serializeCloudPlacement(old,previous),serializeCloudPlacement(clip,next));}).length;
      // An FL erase across pattern AND audio clips (one right-drag) is one Undo step:
      // its pattern part always goes as a batch, so the step holds one exact inverse per kind.
      const mixedDelete=removedPlacements.length>=1&&previous.audioClips.some(old=>!next.audioClips.some(c=>c.id===old.id));
      const batchOps=studioApi&&(placementWork>=2||mixedDelete&&placementWork===removedPlacements.length)&&placementWork<=PLACEMENT_BATCH_LIMIT&&this.supportsPlacementBatch()?[]:null,batchCreated=[];
      if(batchOps)for(const clip of removedPlacements)batchOps.push(deletePlacementOp(clip.cloudId));
      else for(const clip of removedPlacements)await run('delete_pattern_placement',{placement_id:clip.cloudId},true);
      for(const pattern of next.patterns){
        const old=previous.patterns.find(p=>p.id===pattern.id),dto=nextPatternDTOs.get(pattern);
        if(!old){
          const made=await run('create_pattern',{pattern:dto});const id=made.pattern?.id || made.patternId || made.pattern_id || made.id;
          if(!id)throw new Error('Freestyle created a pattern without returning its ID. Refresh the project before adding placements.');idMap[pattern.id]=id;this.lastApplyIdMap.patterns[pattern.id]=id;
        } else if(changed(previousPatternDTOs.get(old),dto))await run('update_pattern',{pattern_id:pattern.cloudId || pattern.id,pattern:dto});
      }
      for(const clip of next.clips){
        const old=previous.clips.find(c=>c.id===clip.id),dto=serializeCloudPlacement(clip,next,idMap);
        if(!old){
          // The destination row is laneId. displayOrder (Timeline row order) is
          // declared on createPatternPlacement and batch create ops since the
          // 2026-11-11 contract, so the REST path saves the FL row; the legacy
          // native action does not declare it and still omits it.
          const placement={...dto};if(!studioApi)delete placement.displayOrder;
          if(!this.supportsPlacementPhase('create'))delete placement.loopPhaseMs;
          if(batchOps){batchOps.push(createPlacementOp(placement));batchCreated.push(clip.id);continue;}
          const made=body(await run('create_pattern_placement',{placement})),ids=[made?.placement?.id,made?.placementId,made?.placement_id,made?.id].filter(value=>typeof value==='string'&&value.length);if(ids.length&&new Set(ids).size===1){this.lastApplyIdMap.placements[clip.id]=ids[0];emit(this,'placement-created',{...expectedContext,localId:clip.id,placementId:ids[0]});}
        }
        else {const beforeDto=serializeCloudPlacement(old,previous);if(changed(beforeDto,dto)){
          // displayOrder is declared on updatePatternPlacement / batch update ops
          // (omitted = unchanged); only the legacy native action omits it. A read
          // that did not carry the stored order never sends a guessed 0.
          const placement={...dto};if(!studioApi||!Number.isSafeInteger((clip.cloudRaw||old.cloudRaw)?.displayOrder))delete placement.displayOrder;if(studioApi&&beforeDto.windowMs===null&&dto.windowMs===null)delete placement.windowMs;
          // REST PATCH keeps an omitted stored phase. The legacy action has always
          // received the complete placement body, so echo its unchanged saved
          // phase rather than risk a reset (a changed phase was refused above).
          if(studioApi&&(beforeDto.loopPhaseMs===dto.loopPhaseMs||!this.supportsPlacementPhase('update')))delete placement.loopPhaseMs;
          if(batchOps)batchOps.push(updatePlacementOp(clip.cloudId || clip.id,placement));
          else await run('update_pattern_placement',{placement_id:clip.cloudId || clip.id,placement});
        }}
      }
      if(batchOps?.length){
        let sent=null;
        try{
          checkEditScope();
          if(placementRevision===undefined)throw Object.assign(new Error('Read a fresh saved timeline revision before continuing placement edits; the previous write will not be repeated.'),{dispatched:false});
          sent=await this.applyPlacementBatch(batchOps,{expectedContext,ifMatch:JSON.stringify(placementRevision),onTimelineRevision:revision=>{placementRevision=revision;}});
        }catch(error){
          // Only a proven-missing route falls back; anything else (412, 400
          // invalid_op, uncertain) is the batch's answer and is not replayed.
          if(error?.placementBatchUnavailable!==true)throw error;
          for(const op of batchOps){
            if(op.op==='delete')await run('delete_pattern_placement',{placement_id:op.placementId},true);
            else if(op.op==='update')await run('update_pattern_placement',{placement_id:op.placementId,placement:op.placement});
            else{const localId=batchCreated[batchOps.filter(item=>item.op==='create').indexOf(op)],made=body(await run('create_pattern_placement',{placement:op.placement})),ids=[made?.placement?.id,made?.placementId,made?.placement_id,made?.id].filter(value=>typeof value==='string'&&value.length);if(ids.length&&new Set(ids).size===1){this.lastApplyIdMap.placements[localId]=ids[0];emit(this,'placement-created',{...expectedContext,localId,placementId:ids[0]});}}
          }
        }
        if(sent){writes.push({name:'apply_pattern_placement_batch',args:{ops:redactPlacementBatchOps(batchOps)},result:sent});sent.createdIds.forEach((placementId,index)=>{const localId=batchCreated[index];this.lastApplyIdMap.placements[localId]=placementId;emit(this,'placement-created',{...expectedContext,localId,placementId});});}
      }
      for(const pattern of previous.patterns)if(!next.patterns.some(p=>p.id===pattern.id))await run('delete_pattern',{pattern_id:pattern.cloudId || pattern.id},true);
      // No compose/name matcher fallback: every deletion was typed and scoped
      // before any project mutation, and targets one persisted lane identity.
      for(const removal of removals){
        deletionAttempted=true;this.lastTrackDeletion=trackDeletion;trackDeletion.status='sending';
        const receipt=body(unpack(await run('delete_track',removal.args,true)));
        if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||!Object.keys(receipt).length)throw new Error('Freestyle returned no usable track deletion receipt; inspect canonical state before another deletion.');
        for(const key of ['projectId','project_id'])if(receipt[key]!==undefined&&receipt[key]!==expectedContext.projectId)throw new Error('Freestyle returned a track deletion receipt for a different project.');
        trackDeletion.receipts.push({trackId:removal.id,arguments:structuredClone(removal.args),receipt:structuredClone(receipt)});trackDeletion.status='acknowledged';
      }
      const selected=idMap[next.selectedPattern] || next.selectedPattern;checkEditScope();deletionRefreshStarted=!!trackDeletion;
      // Newer local edits are already queued: an in-place score/placement batch
      // is reconciled from its acknowledged payloads and returned revision. The
      // engine performs one canonical read after its queue drains.
      const projectable=studioApi&&!trackDeletion&&!mixLaneIds.length&&next.title===previous.title&&writes.length>0&&writes.every(write=>PROJECTABLE_WRITES.has(write.name));
      // QA round 19 follow-up: a reply that carries the saved rows replaces the
      // confirm read (placement batch cards, returned placement / pattern rows).
      // Without them, only a deferred projection (newer edits queued) merges payloads.
      const deferred=typeof deferRefresh==='function'&&deferRefresh();
      const clipTiming=studioApi&&!trackDeletion&&!mixLaneIds.length&&next.title===previous.title&&writes.length>0&&writes.every(write=>['shift_clip','trim_clip'].includes(write.name));
      if(projectable&&this.projectSavedWrites(writes,placementRevision,expectedContext,{requireReturnedRows:!deferred})){this.lastApplyProjected=true;checkEditScope();}
      else if(clipTiming&&this.projectClipTimingWrites(writes,expectedContext)){this.lastApplyProjected=true;checkEditScope();}
      else if(laneMixOnly&&this.rawProject&&this.rawState)await this.refreshLaneMix(mixLaneIds);else await this.refresh();checkEditScope();
      if(studioApi&&mixLaneIds.length)await this.confirmRestLaneMix(previous,next,mixLaneIds,mixFields,expectedContext);
      if(trackDeletion){
        if(this.rawProject?.id!==expectedContext.projectId||!Array.isArray(this.rawProject?.lanes)||trackDeletion.trackIds.some(id=>this.rawProject.lanes.some(lane=>lane.id===id))){trackDeletion.status='unconfirmed';throw Object.assign(new Error('Freestyle acknowledged track deletion, but the full canonical project has not confirmed removal of every persisted lane. No deletion will be repeated.'),{code:'track_delete_unconfirmed'});}
        trackDeletion.status='confirmed';trackDeletion.canonicalConfirmed=true;
      }
      if(this.project.patterns.some(p=>p.id===selected))this.project.selectedPattern=selected;return this.project;
    }catch(error){
      if(trackDeletion&&deletionAttempted){
        if(deletionRefreshStarted&&trackDeletion.status!=='unconfirmed'){trackDeletion.status='committed-refresh-failed';trackDeletion.refreshError=error.message;}
        else if(trackDeletion.status==='sending')trackDeletion.status=rejectedAudioBatch(error)?'rejected':'uncertain';
        throw Object.assign(error,{code:error.code||(deletionRefreshStarted?'track_delete_refresh_failed':'track_delete_failed'),operationCommitted:trackDeletion.receipts.length>0,operationUncertain:trackDeletion.status==='uncertain',trackDeletionReceipt:structuredClone(trackDeletion)});
      }
      try{await this.refresh();}catch{}throw error;
    }
  }
  /** Project acknowledged in-place writes onto the last complete saved read.
   * Returned complete rows win over sent payloads; every write must target an
   * existing row. Returns false (caller performs a full read) when it cannot. */
  projectSavedWrites(writes,revision,scope,{requireReturnedRows=false}={}){
    if(this.closed||this.projectId!==scope.projectId||this.trackId!==scope.trackId||(this.contextVersion||0)!==scope.contextVersion)return false;
    const source=this.rawProject;if(!source||source.id!==scope.projectId||!Array.isArray(source.patterns)||!Array.isArray(source.placements)||timelineRevisionValue(revision)===undefined)return false;
    const raw={...source,patterns:[...source.patterns],placements:[...source.placements]},key=row=>row?.id??patternDTO(row).id??row?.pattern_id;
    try{
      for(const write of writes){
        const result=write.result&&typeof write.result==='object'?write.result:{};
        if(result.ok===false||result.error)return false;
        if(write.name==='update_pattern'){
          const index=raw.patterns.findIndex(row=>key(row)===write.args.pattern_id);if(index<0||raw.patterns.filter(row=>key(row)===write.args.pattern_id).length!==1)return false;
          const returned=result.pattern&&typeof result.pattern==='object'&&key(result.pattern)===write.args.pattern_id?result.pattern:null,row=raw.patterns[index],dto=structuredClone(write.args.pattern);
          // Without the saved row (e.g. the server derives lengthTicks from bars) only a deferred projection may merge the sent payload.
          if(!returned&&requireReturnedRows)return false;
          raw.patterns[index]=returned?structuredClone(returned):row?.data?.pattern?{...row,data:{...row.data,...dto}}:{...row,...dto};assertCompletePattern(raw.patterns[index]);
          // Placements carry a joined copy of their pattern: keep it equal to the saved row a read would return.
          const saved=raw.patterns[index];raw.placements=raw.placements.map(item=>item?.patternId===write.args.pattern_id&&item.pattern&&typeof item.pattern==='object'&&!Array.isArray(item.pattern)?{...item,pattern:structuredClone(saved)}:item);
        }else if(write.name==='update_pattern_placement'){
          const id=write.args.placement_id,index=raw.placements.findIndex(row=>row.id===id);if(index<0||raw.placements.filter(row=>row.id===id).length!==1)return false;
          // A single placement reply is not certified to match the canonical row shape: undeferred, it is confirmed by a read.
          if(requireReturnedRows)return false;const returned=result.placement&&typeof result.placement==='object'&&result.placement.id===id?result.placement:null;
          raw.placements[index]=assertCompletePlacement(returned?structuredClone(returned):{...raw.placements[index],...structuredClone(write.args.placement)});
        }else if(write.name==='delete_pattern_placement'){
          const id=write.args.placement_id;if(!raw.placements.some(row=>row.id===id))return false;raw.placements=raw.placements.filter(row=>row.id!==id);
        }else if(write.name==='apply_pattern_placement_batch'){
          // 338 batch receipt: complete cards of the created / updated / restored rows, and deletedIds.
          const cards=Array.isArray(result.placements)?result.placements:null,deleted=Array.isArray(result.deletedIds)?result.deletedIds:null;if(!cards||!deleted)return false;
          const touched=new Set([...(result.results||[]).filter(item=>item.op!=='delete').map(item=>item.placementId)]);if(cards.length!==touched.size||cards.some(card=>!touched.has(card?.id)))return false;
          raw.placements=raw.placements.filter(row=>!deleted.includes(row.id));
          for(const card of cards){const complete=assertCompletePlacement(structuredClone(card)),at=raw.placements.findIndex(row=>row.id===card.id);if(at>=0)raw.placements[at]=complete;else raw.placements.push(complete);}
        }else return false;
      }
    }catch{return false;}
    this.projectedRevision=revision;raw.timelineRevision=revision;if(raw.counts&&typeof raw.counts==='object')raw.counts={...raw.counts,...Object.hasOwn(raw.counts,'placements')?{placements:raw.placements.length}:{}};
    const state={...this.rawState};
    const mirror=(field,rows,itemKey)=>{const value=state[field];if(Array.isArray(value))state[field]=rows;else if(value&&typeof value==='object'&&Array.isArray(value[itemKey]))state[field]={...value,[itemKey]:rows};};
    mirror('patterns',raw.patterns,'patterns');mirror('patternPlacements',raw.placements,'placements');mirror('placements',raw.placements,'placements');
    if(state.project&&typeof state.project==='object')state.project=raw;
    this.rawProject=raw;this.rawState=state;this.project=normalizeCloudProject(raw,state,{projectId:this.projectId,trackId:this.trackId});
    return true;
  }
  /** One native transaction for an audio-only timing gesture; never generic history. */
  applyAudioTimingBatch(plan,{selectedPattern}={}){
    const projectId=this.projectId,trackId=this.trackId,contextVersion=this.contextVersion||0,captured=structuredClone(plan);
    const current=()=>!this.closed&&this.projectId===projectId&&this.trackId===trackId&&(this.contextVersion||0)===contextVersion;
    const failure=(message,code,properties={})=>Object.assign(new Error(message),{code,...properties});
    const task=async()=>{
      if(!current()||captured.projectId!==projectId)throw failure('The cloud project changed before its audio timing batch.','audio_batch_scope_changed',{name:'AbortError'});
      const prior=[...(this.audioTimingBatchReceipts||[])].reverse().find(record=>record.projectId===projectId&&record.trackId===trackId&&record.contextVersion===contextVersion&&sameData(record.ops,captured.ops)&&(record.status==='uncertain'||record.refreshError||record.conflict&&(this.canonicalProjectReadCompleted||0)<=(record.recoveryReadSeq??Infinity)));
      if(prior)throw failure('Inspect and reload the prior audio timing edit before submitting the same batch again.','audio_batch_recovery_required',{operationCommitted:prior.status==='committed',operationUncertain:prior.status==='uncertain',audioBatchReceipt:structuredClone(prior)});
      if(!captured.beforeClips.every(before=>sameData(before,this.project?.audioClips?.find(clip=>clip.id===before.id))))throw failure('A cloud audio clip changed before its timing batch. Reload canonical timing before editing.','audio_batch_before_changed');
      const args={project_id:projectId,...trackId?{track_id:trackId}:{},ops:structuredClone(captured.ops)},record={projectId,trackId,contextVersion,ops:structuredClone(captured.ops),inverseOps:structuredClone(captured.inverseOps),beforeClips:structuredClone(captured.beforeClips),status:'pending',receipt:null,error:null};
      this.audioTimingBatchReceipts||=[];this.audioTimingBatchReceipts.push(record);this.lastAudioTimingBatch=record;
      let result;
      try{result=await this.call('apply_clip_batch',args);record.receipt=audioBatchResult(result,projectId);record.status='committed';const outcome=clipBatchCommitOutcome(record.receipt);record.postCommitError=outcome.postCommitError;record.engineReloadRequired=outcome.engineReloadRequired;record.warning=outcome.warning;}
      catch(error){record.status=rejectedAudioBatch(error)?'rejected':'uncertain';record.error=error.message;record.conflict=audioBatchStatus(error)===409;if(record.conflict)record.recoveryReadSeq=this.canonicalProjectReadRequested||0;throw Object.assign(error,{audioBatchReceipt:structuredClone(record),operationUncertain:record.status==='uncertain'});}
      if(!current())throw failure('The audio timing batch was acknowledged after the cloud project changed.','audio_batch_scope_changed',{name:'AbortError',operationCommitted:true,audioBatchReceipt:structuredClone(record)});
      // QA round 19 follow-up: the clips:batch receipt (stored timing of every op)
      // replaces the confirm read when it is sufficient; otherwise one read.
      let projected=null;try{projected=this.applyClipBatchReceipt(record.receipt,{ops:captured.ops,projectId,trackId,contextVersion});}catch{projected=null;}record.projected=!!projected;
      try{if(!projected)await this.refresh();}
      catch(cause){record.refreshError=cause.message;throw failure('The audio timing batch was committed, but refreshing its canonical project failed.','audio_batch_refresh_failed',{cause,operationCommitted:true,audioBatchReceipt:structuredClone(record)});}
      if(!current())throw failure('The cloud project changed while refreshing its acknowledged audio timing batch.','audio_batch_scope_changed',{name:'AbortError',operationCommitted:true,audioBatchReceipt:structuredClone(record)});
      if(this.project?.patterns?.some(pattern=>pattern.id===selectedPattern))this.project.selectedPattern=selectedPattern;
      return this.project;
    };
    const pending=this.queue.then(task);this.queue=pending.catch(error=>emit(this,'error',error));return pending;
  }
  durableAudioClipId(clip){const id=clip?.cloudId;if(typeof id!=='string'||!id||id.length>64||clip.cloudRaw?.id!==undefined&&clip.cloudRaw.id!==id)throw new Error('Reload this audio clip’s durable Freestyle identity before editing it.');return id;}
  async splitAudioClip(clip,absoluteBeat){const beat=Number(absoluteBeat);if(!Number.isFinite(beat)||beat<=clip.start||beat>=clip.start+clip.length)throw new Error('Choose a slice position inside this audio clip.');return this.action('split_clip',{clip_id:this.durableAudioClipId(clip),split_ms:beat*60/numeric(this.project?.bpm,120)*1000});}
  /** Project a validated cloud acknowledgement; no mutation request or timing math. */
  applyPatternSplitReceipt(payload,{projectId=this.projectId,trackId=this.trackId,contextVersion=this.contextVersion||0,placementId,childId,operation='split'}={}){
    if(this.closed||!projectId||!trackId||this.projectId!==projectId||this.trackId!==trackId||(this.contextVersion||0)!==contextVersion||this.project?.cloud?.projectId!==projectId)throw Object.assign(new Error('The cloud project changed before its pattern receipt could be displayed.'),{name:'AbortError',code:'pattern_split_scope_changed'});
    const data=body(unpack(payload)),undo=operation==='undo';assertCompleteCanonicalData(data,'pattern split receipt');
    if(!data||data.projectId!==projectId||data.placementId!==placementId||data.left?.id!==placementId||data.undone!==undo||!data.before||typeof data.before!=='object')throw new Error('Freestyle returned an incomplete or mismatched pattern receipt.');
    for(const row of [data.left,data.right].filter(Boolean))if((row.projectId!=null&&row.projectId!==projectId)||(row.project_id!=null&&row.project_id!==projectId)||row.ok===false||row.error)throw new Error('Freestyle returned a mismatched or rejected pattern placement.');
    assertCompletePlacement(data.left);
    if(undo){if(data.right!==null)throw new Error('Freestyle did not confirm removal of the split child.');}
    else{assertCompletePlacement(data.right);if(data.right.id!==childId)throw new Error('Freestyle returned a different split child.');}
    const state=this.rawState,rawProject=this.rawProject,container=state?.patternPlacements,current=container?.placements??state?.placements;
    if(!state||!rawProject||!Array.isArray(current))throw new Error('Reload the canonical project before displaying its pattern receipt.');
    assertCompleteCanonicalData(container??current,'canonical pattern placement list');current.forEach(assertCompletePlacement);
    if(!current.some(row=>row.id===placementId))throw new Error('The acknowledged parent is absent from this canonical project.');
    const left=structuredClone(data.left),right=undo?null:structuredClone(data.right),rows=[];
    for(const row of current){if(row.id===placementId)rows.push(left);else if(row.id!==childId)rows.push(row);}
    if(right)rows.push(right);
    const placements={...(container&&!Array.isArray(container)?container:{}),placements:rows};
    for(const key of ['count','total','totalCount','total_count'])if(placements[key]===current.length)placements[key]=rows.length;
    const nextState={...state,patternPlacements:placements};if(Array.isArray(state.placements))nextState.placements=rows;
    // Keep the saved counts in step with the acknowledged rows: a later read
    // reports them, and a stale count would look like an edit outside history.
    // The receipt's timeline revision guards the next write (a stale one is a 412).
    const counts=rawProject.counts&&typeof rawProject.counts==='object'&&Number.isFinite(rawProject.counts.placements)?{counts:{...rawProject.counts,placements:rows.length}}:{};
    const unpacked=unpack(payload),revision=timelineRevisionValue(data.timelineRevision)??timelineRevisionValue(unpacked?.timelineRevision);
    const nextRawProject={...rawProject,...counts,...revision!==undefined?{timelineRevision:revision}:{},placements:rows},next=normalizeCloudProject(nextRawProject,nextState,{projectId,trackId});
    if(next.patterns.some(pattern=>pattern.id===this.project.selectedPattern))next.selectedPattern=this.project.selectedPattern;
    this.rawState=nextState;this.rawProject=nextRawProject;this.project=next;this.placementReceiptVersion=(this.placementReceiptVersion||0)+1;
    // Engine snapshots can lag DB edits. For the rest of this session, read the
    // persisted placement list on refresh; failures retain this acknowledgement.
    (this.receiptPlacementProjects??=new Set()).add(projectId);
    emit(this,'state',{project:next,raw:nextState,source:'pattern-split-receipt'});return next;
  }
  /** Paint an acknowledged clips:batch from its receipt (inserted cards, the
   * sent ops and the new timeline revision) instead of re-reading the project.
   * Returns the projected project, or null when the receipt is not sufficient
   * (the caller then reads canonical state). Never sends a request. */
  applyClipBatchReceipt(payload,{ops,projectId=this.projectId,trackId=this.trackId,contextVersion=this.contextVersion||0}={}){
    const decline=reason=>{this.lastClipBatchProjection={projected:false,reason};return null;};
    if(this.closed||!projectId||this.projectId!==projectId||this.trackId!==trackId||(this.contextVersion||0)!==contextVersion||this.project?.cloud?.projectId!==projectId)return decline('scope changed');
    const state=this.rawState,rawProject=this.rawProject;if(!state||!rawProject||rawProject.id!==projectId||state.studioApi!==true)return decline('no saved REST snapshot');
    if(this.mutationsInFlight>0)return decline('another write is in flight');
    const retained=this.clipBatchRetainedRows||=new Map(),{projected,reason}=projectClipBatchReceipt(rawProject,ops,payload,{retained});if(!projected)return decline(reason);
    const revision=projected.timelineRevision,base=rawProject._studioApi?.etag,etag=typeof payload?._studioApi?.etag==='string'?payload._studioApi.etag:JSON.stringify(revision);
    // The cached If-Match must move with the model, or the next write is a 412.
    if(typeof base!=='string'||!adoptClipBatchEtag(projectId,etag,{base}))return decline('the cached revision is not this batch\'s base');
    const nextRawProject={...projected.rawProject,_studioApi:{...rawProject._studioApi,etag}},savedClips=state.clips&&!Array.isArray(state.clips)&&state.clips.live===false;
    const nextState={...state,...state.project?{project:nextRawProject}:{},...savedClips?{clips:{...state.clips,clips:nextRawProject.clips}}:{}};
    const next=normalizeCloudProject(nextRawProject,nextState,{projectId,trackId});
    if(next.patterns.some(pattern=>pattern.id===this.project.selectedPattern))next.selectedPattern=this.project.selectedPattern;
    for(const row of projected.removed)retained.set(row.id,structuredClone(row));for(const {row} of projected.inserted)retained.delete(row.id);
    while(retained.size>256)retained.delete(retained.keys().next().value);
    this.rawState=nextState;this.rawProject=nextRawProject;this.project=next;
    this.lastClipBatchProjection={projected:true,revision,inserted:projected.inserted.length,removed:projected.removed.length};
    emit(this,'state',{project:next,raw:nextState,source:'clip-batch-receipt'});return next;
  }
  /** Caller must flush pending project edits before requesting an atomic split. */
  async splitPatternPlacement(clip,absoluteBeat,{childId=globalThis.crypto?.randomUUID?.(),refresh=false}={}){
    const projectId=this.projectId,trackId=this.trackId,contextVersion=this.contextVersion||0,placementId=String(clip?.cloudId||'');
    const canonical=this.project?.clips?.find(item=>item.cloudId===placementId&&item.id===clip?.id),rawId=canonical?.cloudRaw?.id??canonical?.cloudRaw?.placement_id;
    if(this.closed||!projectId||!trackId||this.project?.cloud?.projectId!==projectId||!placementId||rawId!==placementId||!canonical||String(clip?.cloudRaw?.id??clip?.cloudRaw?.placement_id??'')!==placementId)throw new Error('Reload the persisted cloud pattern placement before splitting it.');
    assertCompleteCanonicalData(clip.cloudRaw,'pattern placement');assertCompleteCanonicalData(this.rawState?.patternPlacements,'pattern placement list');
    const bpm=Number(this.project.bpm);if(!Number.isFinite(bpm)||bpm<=0||!Number.isFinite(absoluteBeat))throw new Error('A pattern split requires a finite timeline beat and the authoritative project tempo.');
    const cutMs=Math.round(absoluteBeat*60/bpm*1000),startMs=Math.round(canonical.start*60/bpm*1000),endMs=Math.round((canonical.start+canonical.length)*60/bpm*1000);
    if(cutMs<=startMs||cutMs>=endMs)throw new Error('Choose a slice position inside this persisted pattern placement.');
    if(typeof childId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(childId))throw new Error('The right pattern placement requires a UUID identity.');
    return this.queuePatternPlacementSplit({projectId,trackId,contextVersion,placementId,childId,cutMs,refresh});
  }
  async undoPatternPlacementSplit(receipt,{refresh=false}={}){
    const {projectId,placementId,childId}=receipt||{};if(typeof projectId!=='string'||typeof placementId!=='string'||typeof childId!=='string')throw new Error('Use the complete receipt from the original pattern split to undo it.');
    assertSplitSnapshot(receipt,placementId,childId);const before=receipt.undoSnapshot??receipt.before;assertCompleteCanonicalData(before,'pattern split undo snapshot');
    return this.queuePatternPlacementSplit({projectId,trackId:this.trackId,contextVersion:this.contextVersion||0,placementId,childId,before:structuredClone(before),undo:true,refresh});
  }
  queuePatternPlacementSplit({projectId,trackId,contextVersion,placementId,childId,cutMs,before,undo=false,refresh=false}){
    const check=()=>{if(this.closed||!projectId||!trackId||this.projectId!==projectId||this.trackId!==trackId||(this.contextVersion||0)!==contextVersion)throw Object.assign(new Error('The cloud project changed during the pattern split.'),{name:'AbortError',code:'pattern_split_scope_changed'});};
    const task=async()=>{
      check();const args={project_id:projectId,placement_id:placementId,child_id:childId,...undo?{undo:true,before}:{cut_ms:cutMs}};
      const result=splitResult(await this.call('split_pattern_placement',args));check();
      if(!undo){assertSplitSnapshot(result,placementId,childId);if(result.cutMs!==cutMs)throw new Error('Freestyle returned a different pattern split position.');}
      this.applyPatternSplitReceipt(result,{projectId,trackId,contextVersion,placementId,childId,operation:undo?'undo':'split'});
      const receipt=undo?{...result,projectId,placementId,childId,undone:true}:{...result,projectId,placementId,childId,cutMs,undoSnapshot:structuredClone(result.before)};
      if(refresh)try{await this.refresh();}catch(cause){throw Object.assign(new Error(`The pattern ${undo?'undo':'split'} was committed and displayed, but refreshing the project failed.`,{cause}),{code:'pattern_split_refresh_failed',operationCommitted:true,splitReceipt:receipt});}
      check();return receipt;
    };
    const pending=this.queue.then(task);this.queue=pending.catch(error=>emit(this,'error',error));return pending;
  }
  // The archived capability names track_id, while the current guide requires a
  // durable clip identity. Retain that published field name; do not invent a
  // clip_id alias. Current runtime acknowledgement still needs verification.
  async duplicateAudioClip(clip,{startBeat=clip.start+clip.length}={}){return this.action('copy_append_clip',{track_id:this.durableAudioClipId(clip),start_ms:Math.max(0,Number(startBeat))*60/numeric(this.project?.bpm,120)*1000});}
  async addInstrument(role,name) {return this.action('add_instrument_track',{role,name,verify:true});}
  async createPatternLane(label='Patterns') {return this.action('create_empty_lane',{kind:'pattern',label});}
  async setSteps(pattern,channel,steps,{bars,placeAtMeasure,place=false,replace=true,soundQuery}={}) {
    const id=patternId(pattern), name=typeof pattern==='object'?pattern.name:undefined;
    const active=steps.flatMap((value,index)=>value?[index+1]:[]);
    const source={channel:channelName(channel),steps:active};
    if(soundQuery || channel?.soundQuery)source.sound_query=soundQuery || channel.soundQuery;
    const args={...(id&&!id.startsWith('local-')?{pattern_id:id}:{}),...(name?{pattern_name:name}:{}),channels:[source],bars:bars || pattern?.bars || 1,replace,place};
    if(placeAtMeasure!=null){args.place_at_measure=placeAtMeasure;args.place=true;}
    return this.action('set_pattern_steps',args);
  }
  async writeNotes(pattern,channel,notes,{bars,placeAtMeasure,place=false,replace=true}={}) {
    const id=patternId(pattern),name=typeof pattern==='object'?pattern.name:undefined;
    const mapped=notes.map(note=>{const start=numeric(note.start),bar=Math.floor(start/4)+1,step=Math.round((start%4)*4)+1;return {pitch:numeric(note.pitch,60),bar,step,length_steps:Math.max(.25,numeric(note.duration,.25)*4),velocity:numeric(note.velocity,.8)};});
    const args={...(id&&!id.startsWith('local-')?{pattern_id:id}:{}),...(name?{pattern_name:name}:{}),channel:channelName(channel),notes:mapped,bars:bars || pattern?.bars || 1,replace,place};
    if(placeAtMeasure!=null){args.place_at_measure=placeAtMeasure;args.place=true;}
    return this.action('write_pattern_notes',args);
  }
  /** Import into an explicit existing instrument without names or step quantization. */
  writeInstrumentNotesCanonical(pattern,channel,notes,options={}){
    let request,context,before,key,channelId;
    try{
      if(this.closed||!this.projectId||!this.trackId||this.project?.cloud?.projectId!==this.projectId)throw new Error('Load a Freestyle pattern and instrument before importing MIDI.');
      context={projectId:this.projectId,trackId:this.trackId,contextVersion:this.contextVersion||0};
      const current=this.project.patterns.find(value=>value.id===pattern?.id&&value.cloudId===pattern?.cloudId),chosen=this.project.channels.find(value=>value.id===channel?.id);
      if(!current||!chosen||JSON.stringify(current.cloudRaw)!==JSON.stringify(pattern.cloudRaw)||chosen.laneId!==channel.laneId||chosen.patternId!==channel.patternId)throw new Error('The selected cloud pattern or instrument changed before MIDI import.');
      before=structuredClone(current.cloudRaw);channelId=chosen.id;
      const input=canonicalMidiInput(notes,options);key=JSON.stringify([context,current.cloudId,channelId,before,input]);
      request=canonicalInstrumentNoteRequest({project:this.project,pattern:current,channel:chosen,notes:input.notes,options:input.options});
    }catch(error){return Promise.reject(error);}
    const currentScope=()=>!this.closed&&this.projectId===context.projectId&&this.trackId===context.trackId&&(this.contextVersion||0)===context.contextVersion;
    const failure=(message,code,extra={})=>Object.assign(new Error(message),{code,...extra});
    const task=async()=>{
      if(!currentScope())throw failure('The cloud project changed before MIDI import.','canonical_midi_scope_changed',{name:'AbortError'});
      const prior=(this.canonicalMidiWrites||[]).find(value=>value.key===key&&['uncertain','committed-refresh-failed','unconfirmed'].includes(value.status));
      if(prior)throw failure('Inspect and reload the previous MIDI import before submitting the same score again.','canonical_midi_recovery_required',{operationCommitted:prior.status!=='uncertain',operationUncertain:prior.status==='uncertain',midiWriteReceipt:structuredClone(prior)});
      const pattern=this.project?.patterns?.find(value=>value.cloudId===request.patternId),chosen=this.project?.channels?.find(value=>value.id===channelId);
      if(!pattern||!chosen||chosen.laneId!==request.laneId||JSON.stringify(pattern.cloudRaw)!==JSON.stringify(before))throw failure('The canonical pattern or instrument changed while MIDI import was queued.','canonical_midi_before_changed');
      const entry={key,context:structuredClone(context),patternId:request.patternId,laneId:request.laneId,sourceId:request.sourceId,before:structuredClone(before),request:structuredClone(request),status:'sending',receipt:null};
      this.canonicalMidiWrites||=[];this.canonicalMidiWrites.push(entry);this.lastCanonicalMidiWrite=entry;
      let data;
      try{
        emit(this,'pattern-history-barrier',{reason:'Canonical MIDI import has its own write receipt and is outside retained pattern Undo/Redo.'});
        data=body(unpack(await this.call('execute_pro_action',{project_id:context.projectId,track_id:context.trackId,action:'update_pattern',arguments:{pattern_id:request.patternId,pattern:structuredClone(request.pattern)}})));
        assertCompleteCanonicalData(data,'canonical MIDI update receipt');
        if(!data||typeof data!=='object'||Array.isArray(data)||!Object.keys(data).length)throw new Error('Freestyle returned no usable canonical MIDI update receipt.');
        const inspect=value=>{if(!value||typeof value!=='object')return;if(value.ok===false||value.error||value.isError===true)throw Object.assign(new Error(typeof value.error==='string'?value.error:'Freestyle returned a failed nested MIDI update receipt.'),{result:data});for(const child of Object.values(value))inspect(child);};inspect(data);
        for(const field of ['projectId','project_id'])if(data[field]!==undefined&&data[field]!==context.projectId)throw new Error('Freestyle returned a MIDI update receipt for a different project.');
        for(const field of ['patternId','pattern_id'])if(data[field]!==undefined&&data[field]!==request.patternId)throw new Error('Freestyle returned a MIDI update receipt for a different pattern.');
        entry.receipt=structuredClone(data);entry.status='committed';
      }catch(error){entry.status=rejectedAudioBatch(error)?'rejected':'uncertain';entry.error=error.message;throw Object.assign(error,{operationUncertain:entry.status==='uncertain',midiWriteReceipt:structuredClone(entry)});}
      if(!currentScope())throw failure('MIDI import was acknowledged after its cloud project changed.','canonical_midi_scope_changed',{name:'AbortError',operationCommitted:true,midiWriteReceipt:structuredClone(entry)});
      try{await this.refresh();}catch(cause){entry.status='committed-refresh-failed';entry.refreshError=cause.message;throw failure('MIDI import was acknowledged, but its canonical project could not be refreshed. No score will be resubmitted.','canonical_midi_refresh_failed',{cause,operationCommitted:true,midiWriteReceipt:structuredClone(entry)});}
      if(!currentScope())throw failure('The cloud project changed while confirming MIDI import.','canonical_midi_scope_changed',{name:'AbortError',operationCommitted:true,midiWriteReceipt:structuredClone(entry)});
      const actual=this.project?.patterns?.find(value=>value.cloudId===request.patternId);let confirmed=false;try{confirmed=!!actual&&canonicalMidiWriteConfirmed(actual,request);}catch{}
      if(!confirmed){entry.status='unconfirmed';throw failure('Freestyle acknowledged MIDI import, but the full canonical score has not confirmed its notes. No import will be repeated.','canonical_midi_unconfirmed',{operationCommitted:true,midiWriteReceipt:structuredClone(entry)});}
      this.project.selectedPattern=request.patternId;entry.status='confirmed';return this.project;
    };
    const pending=this.queue.then(task);this.queue=pending.catch(error=>emit(this,'error',error));return pending;
  }
  setGain(channel,gain){if(channel?.patternSource)return this.setSourceState(channel,{volume:Number(gain)});return this.action('set_track_gain',{track_id:channelLane(channel),gain:Number(gain)});}
  setSourceState(channel,changes){if(!this.project)throw new Error('Load a Freestyle project first.');const next=JSON.parse(JSON.stringify(this.project)),source=next.channels.find(c=>c.id===channel.id);if(!source)throw new Error('The source is no longer in the loaded cloud project.');Object.assign(source,changes);return this.applyProject(this.project,next);}
  setMuted(channel,muted){if(channel?.patternSource)return this.setSourceState(channel,{mute:!!muted});return this.action('set_track_muted',{track_id:channelLane(channel),muted:!!muted});}
  setSolo(channel,soloed){if(channel?.patternSource)return this.setSourceState(channel,{solo:!!soloed});return this.action('set_track_soloed',{track_id:channelLane(channel),soloed:!!soloed});}
  setTempo(bpm){return this.action('set_project_tempo',{bpm:Number(bpm)});}
  setMaster(){return Promise.reject(new Error('Use the Mixer master fader to confirm saved and live master gain.'));}
  setLoop(enabled,startSec,endSec){return this.action('set_transport_loop',{enabled:!!enabled,...(startSec!=null?{start_sec:Number(startSec)}:{}),...(endSec!=null?{end_sec:Number(endSec)}:{})});}
  setPluginParameter(laneId,pluginIndex,parameterIndex,value){return this.action('set_lane_plugin_parameter',{lane_id:laneId,plugin_index:Number(pluginIndex),parameter_index:Number(parameterIndex),value_norm:Number(value)});}
  async transport(command,{seconds}={}, {projectId=this.projectId}={}) {
    if(!projectId||projectId!==this.projectId)throw new Error('The cloud project changed before transport dispatch.');
    const trackId=this.trackId,version=++this.transportVersion;
    const result=await this.call('transport_control',{project_id:projectId,track_id:trackId,command,...(seconds!=null?{seconds:Number(seconds)}:{})});
    if(projectId!==this.projectId||trackId!==this.trackId||version!==this.transportVersion)throw Object.assign(new Error('The cloud transport request was superseded.'),{name:'AbortError',code:'transport_scope_changed'});
    const acknowledgement=body(result),studioApi=this.rawState?.studioApi===true||this.project?.cloud?.rawState?.studioApi===true,complete=studioApi&&authoritativeTransportAcknowledgement(acknowledgement,projectId);
    this.applyTransportAcknowledgement(command,acknowledgement,{seconds,projectId});
    this.startTicking();
    // REST already returned this command's authoritative play state/position.
    // An aggregate project read adds latency without strengthening that receipt.
    if(!complete)await this.refresh({project:false});return acknowledgement;
  }
  startTicking(){
    clearTimeout(this.pollTimer);clearInterval(this.tickTimer);
    this.tickTimer=setInterval(()=>{if(this.project)emit(this,'tick',this.positionAt());},50);
    const poll=async()=>{if(this.closed)return;try{if(this.playing&&!this.hasFreshInteractiveClock()&&!this.hasFreshLiveClock()){if(this.rawState?.studioApi===true||this.project?.cloud?.rawState?.studioApi===true)await this.refreshTransportClock();else await this.refresh({project:false});}}catch(error){emit(this,'error',error);}finally{if(!this.closed)this.pollTimer=setTimeout(poll,this.pollInterval);}};
    this.pollTimer=setTimeout(poll,this.pollInterval);
  }
  async startMonitor(){
    this.streamInfo=await this.action('start_stream',{}, {refresh:false});
    emit(this,'monitor',{status:'engine-ready',info:this.streamInfo});
    return this.streamInfo;
  }
  async stopMonitor(){this.streamAudio?.pause();this.streamAudio=null;return this.action('stop_stream',{}, {refresh:false});}
  async listen({lengthSec=12,startSec=this.positionSeconds}={}) {
    const result=await this.call('listen_to_project',{project_id:this.projectId,track_id:this.trackId,start_sec:startSec,length_sec:Math.max(1,Math.min(30,lengthSec)),include_audio:true});
    const data=body(result);const url=data.clip?.playbackUrl;if(url){this.streamAudio?.pause();this.streamAudio=new Audio(url);await this.streamAudio.play();}emit(this,'listen',data);return data;
  }
  async exportMix(){return this.call('export_mix',{project_id:this.projectId});}
  close(){placementUndoStores.delete(this);this.contextVersion=(this.contextVersion||0)+1;this.transportVersion++;this.closed=true;this.interactiveClock=null;const closing=this.interactive?.close?.();closing?.catch?.(()=>{});clearTimeout(this.pollTimer);clearInterval(this.tickTimer);this.streamAudio?.pause();this.streamAudio=null;}
}
