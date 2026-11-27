import {isIdempotencyInProgress,definiteCloudRejection,retainInProgress} from './cloud-errors.js';
import {completeCanonicalPlacements} from './audacity-canonical-placements.js';
/** Authoritative Freestyle cloud DAW session; no local instruments or audio rendering. */
import {patternLengthBeats} from './pattern-preview.js';
import {placementTiming} from './playlist-edits.js';
import {bridgeFetch} from './freestyle-host-transport.js';
const array = value => Array.isArray(value) ? value : [];
const numeric = (value,fallback=0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const nativeUnavailableError=error=>error?.name!=='AbortError'&&error?.code==='native_state_unavailable'&&error?.status===503;
const hasLoopClock=value=>typeof value?.loop_enabled==='boolean'&&['loop_start_sec','loop_end_sec'].every(key=>value[key]!=null&&Number.isFinite(Number(value[key]))&&Number(value[key])>=0);
const uid = () => globalThis.crypto?.randomUUID?.() || `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function unpack(result) {
  let data=result?.structuredContent;
  if (!data) { try { data=JSON.parse(array(result?.content).filter(x=>x.type==='text').map(x=>x.text).join('\n')); } catch { data=result; } }
  const response=data?.response ?? data;
  if (result?.isError || data?.error || data?.ok===false || response?.error || response?.ok===false || isIdempotencyInProgress(response)) {
    const message=response?.error || data?.error || response?.message || data?.message || 'Freestyle could not complete the operation.';
    const error=new Error(typeof message==='string'?message:JSON.stringify(message)); error.result=data;
    error.retryAfterSec=response?.retryAfterSec || data?.retryAfterSec;for(const key of ['code','stage','status'])if(response?.[key]!==undefined||data?.[key]!==undefined)error[key]=response?.[key]??data?.[key];if(isIdempotencyInProgress(error))error.definiteRejection=false;throw error;
  }
  return data;
}
async function defaultCall(name,args) {
  const res=await bridgeFetch('modesty-bridge:/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})});
  const data=await res.json(); if(!res.ok) { const error=new Error(data.detail || data.message || data.error || `HTTP ${res.status}`);error.status=res.status;error.result=data;for(const key of ['code','stage','engineStatus','requestId','details','retryAfterSec','retryAfterMs'])if(data[key]!==undefined)error[key]=data[key];error.definiteRejection=definiteCloudRejection(error);throw error; } return unpack(data);
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
function patternSource(channel,existing) {
  if(existing)return {...existing,name:channel.name,volume:numeric(channel.volume,1),muted:!!channel.mute,solo:!!channel.solo};
  if(channel.cloudSource)return {...channel.cloudSource,name:channel.name,volume:numeric(channel.volume,1),muted:!!channel.mute,solo:!!channel.solo};
  if(channel.audioFileId)return {id:channel.sourceId || channel.id,rackId:channel.rackId || channel.id,kind:'sample',name:channel.name,audioFileId:channel.audioFileId,durationSec:channel.durationSec || 0,samplePlaybackMode:'one-shot',rootPitch:channel.rootPitch ?? 60,busId:'master',muted:!!channel.mute,solo:!!channel.solo,volume:numeric(channel.volume,1),order:0};
  if(channel.laneId && (channel.type==='instrument'||channel.instrumentType))return {id:channel.sourceId || channel.id,kind:'plugin',name:channel.name,laneId:channel.laneId,instrumentType:channel.instrumentType || channel.cloudRaw?.instrumentType || '',busId:'master',muted:!!channel.mute,solo:!!channel.solo,volume:numeric(channel.volume,1),order:0};
  throw new Error(`${channel.name || 'This channel'} has no Freestyle sample or instrument. Add a cloud instrument or choose a cloud sample first.`);
}
export function serializeCloudPattern(pattern,project) {
  if(pattern.cloudRaw)assertCompletePattern(pattern.cloudRaw);assertCompleteCanonicalData(pattern.steps);assertCompleteCanonicalData(pattern.notes);
  const old=patternDTO(pattern.cloudRaw),content=patternContent(pattern.cloudRaw),ppq=numeric(old.ppq,96),oldSources=array(content.sources),oldEvents=array(content.events);
  if(old._truncated || old.truncated || content._truncated || content.truncated || content.eventsTruncated || content.events_truncated || content.sourcesTruncated || content.sources_truncated)throw new Error('Freestyle returned an incomplete canonical pattern. Reload its full pattern data before editing to preserve hidden events.');
  const usedIds=new Set([...Object.keys(pattern.steps || {}),...Object.keys(pattern.notes || {}),...oldSources.map(source=>String(source.id))]);
  const mappedIds=new Set(pattern.cloudMappedEventIds || oldEvents.filter(event=>(['midi','sample'].includes(event.type)&&event.startTick!=null&&event.durationTick!=null)||(event.type==='sample'&&event.durationTick==null&&event.tick!=null&&Number.isInteger(Number(event.tick)/ppq*4))).map(event=>event.id));
  const sources=[],events=oldEvents.filter(event=>!mappedIds.has(event.id));
  for(const channel of project.channels || []) {
    const existing=oldSources.find(source=>String(source.id)===String(pattern.cloudSources?.[channel.id] || channel.sourceId || channel.id));
    if(!usedIds.has(channel.id)&&!existing)continue;
    const steps=pattern.steps?.[channel.id] || [],notes=pattern.notes?.[channel.id] || [];
    if(!existing&&!pattern.cloudSources?.[channel.id]&&!steps.some(Boolean)&&!notes.length)continue;
    const source=patternSource(channel,existing);sources.push(source);
    const sourceId=source.id;
    steps.forEach((active,index)=>{
      if(!active)return;const tick=index*ppq/4,velocity=typeof active==='number'?active:.85;
      if(source.kind==='plugin')events.push({id:`vegetable-step:${sourceId}:${tick}`,type:'midi',sourceId,note:60,startTick:tick,durationTick:ppq/4,velocity});
      else {const oldEvent=oldEvents.find(e=>e.type==='sample'&&e.sourceId===sourceId&&e.durationTick==null&&e.tick===tick);events.push({...(oldEvent || {}),id:oldEvent?.id || uid(),type:'sample',sourceId,tick,velocity});}
    });
    for(const note of notes){
      const original=note.cloudRaw || {},tick=Math.round(numeric(note.start)*ppq*1000)/1000,pitch=numeric(note.pitch,60),event={...original,id:original.id || note.id || uid(),type:source.kind==='sample'?'sample':'midi',sourceId,note:pitch,startTick:tick,durationTick:Math.max(1,Math.round(numeric(note.duration,.25)*ppq*1000)/1000),velocity:numeric(note.velocity,.8)};
      if(source.kind==='sample'){event.tick=tick;event.pitch=pitch;event.rootPitch=source.rootPitch ?? 60;event.playbackRate=Math.max(.25,Math.min(4,Math.pow(2,(event.pitch-event.rootPitch)/12)));}
      events.push(event);
    }
  }
  return {name:pattern.name || 'Pattern',ppq,bars:Math.max(1,numeric(pattern.bars,1)),lengthTicks:patternLengthBeats(pattern)*ppq,swing:numeric(old.swing,0),pattern:{...content,version:content.version || 1,sources,events:events.filter(event=>!event.sourceId || sources.some(source=>source.id===event.sourceId))}};
}
export function serializeCloudPlacement(clip,project,patternIdMap={}) {
  const old=clip.cloudRaw || {},pattern=project.patterns.find(p=>p.id===clip.patternId),spb=60/numeric(project.bpm,120),pId=patternIdMap[clip.patternId] || pattern?.cloudId || clip.patternId;
  const movedLane=clip.cloudTrackIndex!=null && numeric(clip.track)!==numeric(clip.cloudTrackIndex);
  const laneId=movedLane?(project.cloud?.timelineLaneIds?.[clip.track] || ''):(old.laneId || old.lane_id || clip.laneId || project.cloud?.timelineLaneIds?.[clip.track] || '');
  return {patternId:pId,laneId,name:clip.name ?? old.name ?? pattern?.name ?? 'Pattern',startMs:Math.max(0,numeric(clip.start))*spb*1000,...placementTiming(clip,project),displayOrder:numeric(clip.track,0),busId:old.busId || old.bus_id || 'master',sourceBusOverrides:old.sourceBusOverrides || {},muted:!!old.muted,soloed:!!old.soloed};
}
const knownNumber=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const persistedId=value=>value!==null&&value!==undefined&&value!==''?String(value):null;
const observedPatternId=entry=>typeof entry==='string'?entry:entry?.cloudId||entry?.id||patternDTO(entry)?.id||entry?.pattern_id;
function belongsToProject(row,projectId){return !projectId||['projectId','project_id'].every(field=>row?.[field]==null||String(row[field])===String(projectId));}
function canonicalPatternIds(project,state={}){
  const declared=Array.isArray(project.patterns)||Array.isArray(project.placements),lanes=new Set(array(project.lanes).map(lane=>String(lane.id)));
  // Older receipt projections can omit both summary lists. Only a placement
  // on an actual canonical lane then proves pattern membership; an unscoped
  // runtime rack never does, including for a completely audio-only project.
  const placements=declared?array(project.placements):array(state.patternPlacements?.placements??state.placements).filter(row=>belongsToProject(row,project.id)&&lanes.has(String(row.laneId||row.lane_id||'')));
  return new Set([...array(project.patterns).map(observedPatternId),...placements.map(entry=>entry.patternId||entry.pattern_id||entry.pattern?.id)].filter(Boolean).map(String));
}
function runtimeAudioClip(take,state,{projectId,takes=[take]}={}) {
  const entries=array(state.clips?.clips || state.clips),id=String(take.id),identities=[take.id,take.laneId,take.audioSourceId,take.sourceId].filter(Boolean).map(String);
  // Native numeric handles are safe only after canonical durable identities
  // agree. An exact clip id must not override a contradictory lane/project.
  const eligible=entries.filter(entry=>belongsToProject(entry,projectId)&&(!persistedId(entry.db_track_id)||identities.includes(String(entry.db_track_id))));
  const exact=eligible.filter(entry=>persistedId(entry.db_clip_id)===id);if(exact.length)return exact.length===1?exact[0]:undefined;
  const legacy=eligible.filter(entry=>!persistedId(entry.db_clip_id)&&persistedId(entry.db_track_id)&&identities.includes(String(entry.db_track_id))&&Math.abs(numeric(entry.start_ms)-numeric(take.startMs))<=45);
  if(legacy.length!==1)return undefined;
  const entry=legacy[0],owners=takes.filter(candidate=>[candidate.id,candidate.laneId,candidate.audioSourceId,candidate.sourceId].filter(Boolean).map(String).includes(String(entry.db_track_id))&&Math.abs(numeric(entry.start_ms)-numeric(candidate.startMs))<=45);
  return owners.length===1?entry:undefined;
}
function audioIdentity(clip) {
  if(!clip.cloudId)throw new Error('This audio clip has no persisted Freestyle identity. Import audio through Freestyle before editing it.');
  // Studio API edits address immutable persisted identities; native numeric
  // handles remain readback evidence and are never substituted into REST paths.
  return {track_id:clip.cloudId,clip_id:clip.cloudId};
}
export function normalizeCloudAudioClip(take,state,bpm,track,context={}) {
  const runtime=runtimeAudioClip(take,state,context),timing=take.effects?.timing || {},engineTrackId=runtime?.mozart_track_id,engineClipId=runtime?.clip_id;
  const offsetValue=[take.audioOffsetSec,timing.audioOffsetSec,runtime?.audio_offset_sec].find(knownNumber),offsetKnown=knownNumber(offsetValue),spb=60/bpm;
  // Every clip read carries sourceDurationSec (the untrimmed source length; null when unknown): the trim / un-trim
  // limit is audioOffsetSec + durationSec <= sourceDurationSec. The older effect-timing field is the fallback.
  const fullDuration=[take.sourceDurationSec,take.audioFullDurationSec,timing.audioFullDurationSec].find(knownNumber);
  const clip={id:String(take.id),cloudId:String(take.id),laneId:take.laneId,track,cloudTrackIndex:track,start:numeric(take.startMs)/1000/spb,length:Math.max(0,numeric(take.durationSec))/spb,offset:offsetKnown?Number(offsetValue)/spb:0,offsetKnown,name:take.name || 'Audio clip',volume:numeric(take.volume,1),mute:!!take.muted,engineLoaded:!!runtime&&knownNumber(engineTrackId)&&knownNumber(engineClipId),cloudRaw:take};
  if(clip.engineLoaded){clip.engineTrackId=Number(engineTrackId);clip.engineClipId=Number(engineClipId);clip.cloudRuntime=runtime;}
  if(knownNumber(fullDuration))clip.sourceLength=Number(fullDuration)/spb;
  if(typeof take.audioUrl==='string')clip.url=take.audioUrl;
  if(Array.isArray(take.peaks))clip.peaks=take.peaks;else if(Array.isArray(take.waveform?.peaks))clip.peaks=take.waveform.peaks;
  return clip;
}
/** Audio rows come from complete persisted lane membership. Nonempty clips
 * and native allocation order cannot move empty rows or insert an import above
 * them. Legacy complete lane arrays without published order retain array order;
 * partial numeric order is never used to invent missing positions. */
function orderedCanonicalLanes(project,takes,projectId){
  if(!Array.isArray(project.lanes)){if(takes.length)throw new Error('Complete canonical lanes are required to order audio tracks.');return [];}
  assertCompleteCanonicalData({lanes:project.lanes,truncated:project.truncated&&typeof project.truncated==='object'?{lanes:project.truncated.lanes}:project.truncated,lanesTruncated:project.lanesTruncated,lanes_truncated:project.lanes_truncated},'canonical audio lane order');
  const lanes=project.lanes,ids=new Set();for(const lane of lanes){if(!lane||typeof lane.id!=='string'||!lane.id||ids.has(lane.id)||!belongsToProject(lane,projectId))throw new Error('Canonical lane membership is ambiguous or belongs to another project.');ids.add(lane.id);}
  if(project.counts?.lanes!==undefined&&(!Number.isSafeInteger(project.counts.lanes)||project.counts.lanes!==lanes.length))throw new Error('The canonical lane count is incomplete.');
  if(takes.some(take=>typeof take.laneId!=='string'||!ids.has(take.laneId)))throw new Error('A canonical audio clip has no proven persisted lane.');
  const audio=lanes.map((lane,index)=>({lane,index})).filter(({lane})=>['audio','vocal'].includes(lane.kind));
  if(audio.every(({lane})=>typeof lane.order==='number'&&Number.isFinite(lane.order)))audio.sort((a,b)=>a.lane.order-b.lane.order||a.index-b.index);
  let index=0;return lanes.map(lane=>['audio','vocal'].includes(lane.kind)?audio[index++].lane:lane);
}
export function normalizeCloudProject(project,state={},context={}) {
  if(project.id&&context.projectId&&String(project.id)!==String(context.projectId))throw new Error('The canonical project belongs to another cloud context.');
  const projectId=project.id||context.projectId,bpm=numeric(project.bpm || state.transport?.bpm || state.clock?.bpm,120),takes=array(project.clips),lanes=orderedCanonicalLanes(project,takes,projectId),liveTracks=array(state.tracks?.tracks || state.tracks).filter(row=>belongsToProject(row,projectId));
  const channels=lanes.map((lane,index)=>{
    const exact=liveTracks.filter(t=>persistedId(t.db_track_id)===String(lane.id)),sourceTracks=liveTracks.filter(t=>takes.some(take=>String(take.laneId)===String(lane.id)&&persistedId(t.db_track_id)===String(take.id)));
    const live=exact.length===1?exact[0]:exact.length===0&&sourceTracks.length===1?sourceTracks[0]:{};
    return {id:String(lane.id),laneId:String(lane.id),cloudTrackId:String(lane.id),engineTrackId:live.id,name:lane.name || live.label || `Lane ${index+1}`,cloudName:lane.name || live.label,type:lane.kind || live.kind || 'cloud',volume:numeric(live.gain ?? lane.volume,1),pan:numeric(lane.pan ?? live.pan,0),mute:!!(live.muted ?? lane.muted),solo:!!(live.soloed ?? lane.solo),effects:{},plugins:array(live.plugins || lane.pluginChain),cloudRaw:lane};
  });
  // Runtime sessions can contain tracks/patterns from other projects. They
  // enrich proven canonical members; labels and numeric ids create no lanes.
  if(state.patterns!==undefined)assertCompleteCanonicalData(state.patterns,'canonical pattern list');
  const observedPatterns=array(state.patterns?.patterns || state.patterns),membership=canonicalPatternIds(project,state);
  const sourcePatterns=(observedPatterns.length?observedPatterns:array(project.patterns)).filter(entry=>belongsToProject(entry,projectId)&&belongsToProject(patternDTO(entry),projectId)&&membership.has(String(observedPatternId(entry)||'')));
  assertCompleteCanonicalData(sourcePatterns);
  const patterns=sourcePatterns.map((entry,index)=>{
    const dto=assertCompletePattern(entry),content=patternContent(entry),id=String(entry.id || dto.id || entry.pattern_id || `cloud-pattern-${index}`),ppq=numeric(dto.ppq,96);
    const pattern={id,cloudId:id,name:dto.name || `Pattern ${index+1}`,bars:Math.max(1,numeric(dto.bars,numeric(dto.lengthTicks,384)/ppq/4)),steps:{},notes:{},cloudSources:{},cloudMappedEventIds:[],cloudRaw:entry};
    for(const [index,source]of array(content.sources).entries()) {
      const sourceId=String(source.id),lane=channels.find(c=>c.laneId===source.laneId);
      let channel=channels.find(c=>c.id===sourceId);
      if(!channel){channel={id:sourceId,name:source.name || `Channel ${index+1}`,cloudName:source.name,type:source.kind==='plugin'?'instrument':'sample',volume:numeric(source.volume,1),pan:numeric(source.pan,0),mute:!!source.muted,solo:!!source.solo,effects:{},plugins:lane?.plugins || [],patternSource:true,patternId:id,sourceId:source.id,laneId:source.laneId,engineTrackId:lane?.engineTrackId,instrumentType:source.instrumentType,audioFileId:source.audioFileId,rootPitch:source.rootPitch,durationSec:source.durationSec,cloudSource:source,cloudRaw:source};channels.push(channel);}
      pattern.cloudSources[channel.id]=source.id;
      const steps=Array(Math.max(16,Math.ceil(patternLengthBeats(pattern)*4))).fill(false),notes=[];
      for(const event of array(content.events).filter(e=>String(e.sourceId)===sourceId)) {
        if(['midi','sample'].includes(event.type)&&event.startTick!=null&&event.durationTick!=null){notes.push({id:String(event.id),pitch:numeric(event.note ?? event.pitch,60),start:numeric(event.startTick)/ppq,duration:numeric(event.durationTick)/ppq,velocity:numeric(event.velocity,.8),cloudRaw:event});pattern.cloudMappedEventIds.push(event.id);}
        else if(event.type==='sample'&&event.tick!=null&&Number.isFinite(Number(event.tick))){const position=Number(event.tick)/ppq*4;if(Number.isInteger(position)&&position>=0&&position<steps.length){steps[position]=event.velocity ?? true;pattern.cloudMappedEventIds.push(event.id);}}
      }
      pattern.steps[channel.id]=steps;pattern.notes[channel.id]=notes;
    }
    return pattern;
  });
  const observedPlacements=state.patternPlacements?.placements??state.placements,placementRows=Array.isArray(observedPlacements)?observedPlacements:array(project.placements);assertCompleteCanonicalData(placementRows,'canonical pattern placement list');
  const laneMembership=Array.isArray(project.lanes)?new Set(lanes.map(lane=>String(lane.id))):null,placements=placementRows.filter(row=>belongsToProject(row,projectId)&&(!laneMembership||laneMembership.has(String(row.laneId||row.lane_id||''))));
  const timelineLaneIds=[];for(const placement of placements){const laneId=placement.laneId || placement.lane_id;if(!laneId||timelineLaneIds.includes(laneId))continue;let index=Math.max(0,Math.floor(numeric(placement.displayOrder,0)));while(timelineLaneIds[index])index++;timelineLaneIds[index]=laneId;}
  for(const lane of lanes.filter(lane=>['audio','vocal'].includes(lane.kind))){if(timelineLaneIds.includes(lane.id))continue;let index=0;while(timelineLaneIds[index])index++;timelineLaneIds[index]=lane.id;}
  for(const take of takes){if(!take.laneId || timelineLaneIds.includes(take.laneId))continue;let index=0;while(timelineLaneIds[index])index++;timelineLaneIds[index]=take.laneId;}
  const clips=placements.map((placement,index)=>{const laneId=placement.laneId || placement.lane_id,track=Math.max(0,timelineLaneIds.indexOf(laneId)),duration=numeric(placement.durationMs ?? placement.duration_ms,2000),window=numeric(placement.windowMs,0),totalMs=window>0?window:Math.max(50,duration*Math.max(1,numeric(placement.repeatCount,1))-Math.max(0,numeric(placement.offsetMs,0)));return {id:String(placement.id || placement.placement_id || `placement-${index}`),cloudId:placement.id || placement.placement_id,patternId:String(placement.patternId || placement.pattern_id),name:placement.name,start:numeric(placement.startMs ?? placement.start_ms)/1000*bpm/60,length:totalMs/1000*bpm/60,track,laneId,cloudTrackIndex:track,cloudRaw:placement};});
  const audioClips=takes.map(take=>normalizeCloudAudioClip(take,state,bpm,Math.max(0,timelineLaneIds.indexOf(take.laneId)),{projectId,takes}));
  const trackNames=Object.fromEntries(timelineLaneIds.flatMap((laneId,index)=>{if(!laneId)return [];const lane=lanes.find(l=>l.id===laneId),placement=placements.find(p=>(p.laneId || p.lane_id)===laneId);return [[index,lane?.name || placement?.laneName || placement?.name || `Track ${index+1}`]];}));
  const mutedTracks=timelineLaneIds.flatMap((laneId,index)=>{if(!laneId)return [];const lane=lanes.find(l=>l.id===laneId),rows=placements.filter(p=>(p.laneId || p.lane_id)===laneId);return lane?.muted || (rows.length&&rows.every(p=>p.muted))?[index]:[];});
  const master=array(state.buses?.buses).find(b=>b.bus_id==='master'||b.id==='master');
  return {id:project.id || context.projectId,title:project.title || 'Freestyle project',name:project.title || 'Freestyle project',bpm,...(typeof project.bpmSource==='string'?{bpmSource:project.bpmSource}:{}),master:numeric(master?.gain,1),channels,patterns,clips,audioClips,trackNames,mutedTracks,selectedPattern:patterns[0]?.id || '',loop:!!state.transport?.loop_enabled,metronome:!!state.transport?.metronome,cloud:{projectId:context.projectId || project.id,trackId:context.trackId,studioUrl:project.studioUrl || project.projectUrl,patternLaneId:placements[0]?.laneId || placements[0]?.lane_id || lanes.find(l=>l.kind==='pattern')?.id,timelineLaneIds,rawProject:project,rawState:state,warnings:[]}};
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
  constructor({call=defaultCall,pollInterval=3500,now=()=>performance.now(),toUnixTime=performanceUnixMs}={}) {
    super();this.call=call;this.now=now;this.toUnixTime=toUnixTime;this.clockDelivery=createClockDeliveryEstimator();this.clockSource='none';this.liveClock=null;this.playRange=null;this.loopIterations=0;this.loopEnabled=false;this.loopStartSec=0;this.loopEndSec=0;this.producerLagSec=null;this.polling=false;this.transportVersion=0;this.lastTransportAppliedAt=-Infinity;this.transportGuard=null;this.pollInterval=Math.max(2500,pollInterval);this.projectId='';this.trackId='';this.project=null;this.rawProject=null;this.rawState=null;this.playing=false;this.positionSeconds=0;this.positionObserved=this.now();this.queue=Promise.resolve();this.pendingInProgress=new Map();this.pollTimer=null;this.tickTimer=null;this.closed=false;this.streamAudio=null;this.streamInfo=null;
  }
  async load(projectId,trackId,{onCanonicalAudio,onCanonicalProject}={}) {
    this.contextVersion=(this.contextVersion||0)+1;this.closed=false;this.playing=false;this.positionSeconds=0;this.positionObserved=this.now();this.loopEnabled=undefined;this.loopStartSec=undefined;this.loopEndSec=undefined;this.transportBpm=undefined;this.producerLagSec=null;this.liveClock=null;this.playRange=null;this.explicitClock=null;this.rawState=null;this.project=null;this.clockDelivery.reset();this.loopIterations=0;this.clockSource='none';this.transportGuard=null;this.lastTransportAppliedAt=-Infinity;this.projectId=projectId;this.trackId=trackId || '';
    if(!projectId)throw new Error('Select a Freestyle project first.');
    const contextVersion=this.contextVersion;let expectedTrackId=this.trackId;
    const check=()=>{if(this.closed||this.projectId!==projectId||this.trackId!==expectedTrackId||this.contextVersion!==contextVersion)throw Object.assign(new Error('The cloud load was superseded before its canonical project was accepted.'),{name:'AbortError',code:'cloud_load_scope_changed'});};
    let initial=body(await this.call('get_project',{project_id:projectId}));check();
    // A brand-new project has no lane yet. Like a new empty editor window it must still open, so the
    // first audio track is created here (public createLane) and Import / Record / Add Track work at once.
    if(initial?.id===projectId&&!this.trackId&&!initial.lanes?.length&&!initial.clips?.length&&initial.role!=='viewer'){try{await this.call('execute_pro_action',{project_id:projectId,action:'create_empty_lane',arguments:{kind:'audio',label:'Audio 1'}});check();initial=body(await this.call('get_project',{project_id:projectId}));check();}catch(error){if(error?.name==='AbortError')throw error;}}
    if(initial?.id!==projectId)throw new Error('The initial canonical project belongs to another cloud context.');
    this.rawProject=initial;expectedTrackId=(this.trackId!=='backing'&&this.trackId) || initial.lanes?.find(lane=>lane?.id&&lane.id!=='backing')?.id || initial.clips?.find(clip=>clip?.id&&clip.id!=='backing')?.id || initial.lanes?.[0]?.id;this.trackId=expectedTrackId;
    if(!this.trackId)throw new Error('This Freestyle project has no track. Create an audio lane in the cloud panel, then load it again.');
    const cancellation=new AbortController(),audioClockContext=this.clockContextTrackId({fallback:false});
    // The Freestyle Studio negotiates its silent receive/control peer concurrently with native
    // inventory. Expose only proven canonical membership, never a normalized
    // project or an invented engineLoaded flag.
    if(typeof onCanonicalAudio==='function'&&audioClockContext){check();onCanonicalAudio({projectId,trackId:audioClockContext,editTrackId:expectedTrackId,contextVersion});check();}
    // First paint, as the Freestyle Studio does: draw lanes/clips/names from the stored
    // project while the native engine snapshot (get_pro_state) is still
    // loading. Display-only: edits and playback wait for this load to finish.
    if(typeof onCanonicalProject==='function')this.provisionalProject(initial,{projectId,trackId:expectedTrackId,contextVersion}).then(project=>{if(project&&!this.project&&!this.closed&&this.projectId===projectId&&this.contextVersion===contextVersion)onCanonicalProject(project);},()=>{});
    // Capture the snapshot's observation fence before starting the independent
    // clock read. An earlier explicit clock then survives the later snapshot.
    const refreshing=this.refresh({allowUnavailableNative:true,initialProject:{project:initial,projectId,trackId:expectedTrackId,contextVersion}});
    const clockRead=audioClockContext?this.refreshTransportClock({signal:cancellation.signal}).then(()=>({}),error=>({error})):null;
    try{
      await refreshing;check();
      const unavailable=this.rawState?.nativeUnavailable?.code==='native_state_unavailable';
      if(clockRead){const result=await clockRead;check();if(result.error?.name==='AbortError'||unavailable&&([400,401,403].includes(result.error?.status)||['foreign_transport_clock','incomplete_transport_clock'].includes(result.error?.code)))throw result.error;if(audioClockContext!==this.clockContextTrackId({fallback:false}))throw Object.assign(new Error('The canonical audio clock source changed during startup.'),{name:'AbortError',code:'transport_scope_changed'});if(!hasLoopClock(this.rawState?.transport)&&!unavailable)throw result.error||new Error('Freestyle did not return a complete authoritative transport clock.');}
      else if(!hasLoopClock(this.rawState?.transport)){try{await this.refreshTransportClock({signal:cancellation.signal});}catch(error){if(!unavailable||error.name==='AbortError'||[400,401,403].includes(error.status)||['foreign_transport_clock','incomplete_transport_clock'].includes(error.code))throw error;}}
      if(unavailable){this.project.cloud.nativeUnavailable={...this.rawState.nativeUnavailable};this.project.cloud.clockUnavailable=!hasLoopClock(this.rawState?.transport);if(this.project.cloud.clockUnavailable)this.project.loop=undefined;}
      check();this.startTicking();return this.project;
    }catch(error){cancellation.abort();throw error;}
  }
  /** Canonical-only projection (native engine state pending); never stored as session state. */
  async provisionalProject(rawProject,{projectId,trackId,contextVersion}){
    assertCompleteCanonicalData(rawProject,'canonical project');
    if(rawProject?.id!==projectId||!Array.isArray(rawProject.lanes)||!Array.isArray(rawProject.clips))return null;
    const pending={code:'native_state_pending',status:202,message:'The live engine snapshot is still loading.'};
    let state={session:{projectId},tracks:{unavailable:'native_state_pending'},clips:{unavailable:'native_state_pending'},nativeUnavailable:pending};
    state=await this.hydrateCanonicalPatterns(state,rawProject,{projectId,trackId});
    state=await this.hydrateCanonicalPlacements(state,rawProject,{projectId,trackId,contextVersion});
    if(this.closed||this.projectId!==projectId||this.contextVersion!==contextVersion)return null;
    const project=normalizeCloudProject(rawProject,state,{projectId,trackId});project.cloud={...project.cloud,provisional:true,nativePending:true};
    // Native attachment is not known yet (pending), which is different from a
    // verified unavailable engine: no 'needs verification' badge while connecting.
    for(const clip of project.audioClips||[])if(clip.engineLoaded===false){delete clip.engineLoaded;clip.engineLoadPending=true;}
    return project;
  }
  async create(title='Modesty session') {
    const created=body(await this.call('create_project',{title}));
    const id=created.project?.id || created.projectId || created.id;
    if(!id)throw new Error('Freestyle did not return the new project ID. Open the project list before retrying.');
    const lane=body(await this.call('create_track',{project_id:id,kind:'audio',name:'Audio 1'}));
    const track=lane.trackId || lane.track?.id || lane.laneId || lane.lane?.id || lane.id;
    return this.load(id,track);
  }
  /** `cachedNative`: re-read only the canonical project and reuse the last engine snapshot (get_pro_state takes
   *  ~2.5 s on stage). Used right after a placed recording; a full refresh follows in the background. */
  async refresh({project=true,initialProject,allowUnavailableNative=false,cachedNative=false}={}) {
    if(!this.projectId || !this.trackId)return null;
    const id=this.projectId,trackId=this.trackId,contextVersion=this.contextVersion||0,placementVersion=this.placementReceiptVersion||0,startedAt=this.now(),transportVersion=this.transportVersion,observationVersion=this.transportObservationVersion||0;
    if(initialProject&&(!project||initialProject.projectId!==id||initialProject.trackId!==trackId||initialProject.contextVersion!==contextVersion||initialProject.project?.id!==id))throw Object.assign(new Error('The initial canonical project no longer matches this refresh.'),{name:'AbortError',code:'cloud_load_scope_changed'});
    let unavailable=null;
    const nativeTrackId=this.clockContextTrackId();
    const readNative=async()=>{try{return await this.call('get_pro_state',{project_id:id,track_id:nativeTrackId});}catch(error){if(allowUnavailableNative===true&&initialProject&&nativeUnavailableError(error)){unavailable=error;return null;}throw error;}};
    const requests=[cachedNative&&this.rawState&&project&&!initialProject?Promise.resolve(this.rawState):readNative()];
    if(project&&!initialProject)requests.push(this.call('get_project',{project_id:id}));
    const results=await Promise.all(requests);if(id!==this.projectId||trackId!==this.trackId||contextVersion!==(this.contextVersion||0))return this.project;
    let rawProject=project?(initialProject?initialProject.project:body(results[1])):this.rawProject;
    if(unavailable){
      assertCompleteCanonicalData(rawProject,'canonical project');
      if(rawProject?.id!==id||!belongsToProject(rawProject,id)||!Array.isArray(rawProject.lanes)||!Array.isArray(rawProject.clips))throw new Error('The unavailable live engine needs a complete canonical project before it can be displayed.');
      const lanes=new Set();for(const lane of rawProject.lanes){if(typeof lane?.id!=='string'||!lane.id||lanes.has(lane.id)||!belongsToProject(lane,id))throw new Error('The canonical audio lane is ambiguous or foreign.');lanes.add(lane.id);}
      const clips=new Set();for(const clip of rawProject.clips){if(typeof clip?.id!=='string'||!clip.id||clips.has(clip.id)||!lanes.has(clip.laneId)||!belongsToProject(clip,id)||!Number.isFinite(clip.startMs)||clip.startMs<0||!Number.isFinite(clip.durationSec)||clip.durationSec<=0)throw new Error('The canonical audio clip is incomplete, ambiguous or foreign.');clips.add(clip.id);}
      for(const [field,rows]of [['lanes',rawProject.lanes],['clips',rawProject.clips]])if(rawProject.counts?.[field]!==undefined&&rawProject.counts[field]!==rows.length)throw new Error('The canonical audio membership count is incomplete.');
    }
    const native=unavailable?{session:{projectId:id},tracks:{unavailable:'native_state_unavailable'},clips:{unavailable:'native_state_unavailable'},nativeUnavailable:{code:unavailable.code,status:unavailable.status,message:unavailable.message}}:body(results[0]);
    let state=await this.hydrateCanonicalPatterns(native,rawProject,{projectId:id,trackId});if(id!==this.projectId||trackId!==this.trackId||contextVersion!==(this.contextVersion||0))return this.project;
    const receiptFence=!!this.receiptPlacementProjects?.has(id);
    state=await this.hydrateCanonicalPlacements(state,rawProject,{projectId:id,trackId,contextVersion,forceCanonical:receiptFence});if(id!==this.projectId||trackId!==this.trackId||contextVersion!==(this.contextVersion||0))return this.project;
    if(receiptFence)rawProject={...rawProject,placements:state.patternPlacements.placements};
    // An older read cannot restore a child removed by an acknowledged undo.
    if(placementVersion!==(this.placementReceiptVersion||0)){
      state={...state,patternPlacements:this.rawState.patternPlacements};
      if(Array.isArray(this.rawState.placements))state.placements=this.rawState.placements;
      rawProject={...rawProject,placements:this.rawProject.placements};
    }
    const currentTransport=this.rawState?.transport;this.rawState=state;if(project)this.rawProject=rawProject;
    // get_pro_state can omit loop fields even after a successful loop write.
    // Sparse snapshots cannot erase previously observed authoritative bounds.
    for(const key of ['loop_enabled','loop_start_sec','loop_end_sec'])if(this.rawState.transport?.[key]==null&&currentTransport?.[key]!=null){this.rawState.transport||={};this.rawState.transport[key]=currentTransport[key];}
    // Live engine clocks have lower delivery latency than an HTTP state snapshot.
    // A slow poll must not jump the playhead backwards over a newer live anchor.
    if(this.hasFreshLiveClock())this.rawState.transport={...this.rawState.transport,...this.liveClock.payload};
    else if(transportVersion!==this.transportVersion||observationVersion!==(this.transportObservationVersion||0))this.rawState.transport={...this.rawState.transport,...currentTransport};
    else if(!unavailable||hasLoopClock(this.rawState.transport))this.adoptTransport(this.rawState.transport||{is_playing:this.rawState.session?.isPlaying},{source:'http',observedAt:(startedAt+this.now())/2});
    this.project=normalizeCloudProject(this.rawProject || {},this.rawState,{projectId:this.projectId,trackId:this.trackId});
    emit(this,'state',{project:this.project,raw:this.rawState});return this.project;
  }
  clockContextTrackId({fallback=true}={}){
    const project=this.rawProject,id=this.projectId,valid=value=>typeof value==='string'&&value.length>0&&value.length<=64&&!/^\d+$/.test(value);
    if(project?.id!==id||!belongsToProject(project,id)||!Array.isArray(project.clips)||!Array.isArray(project.lanes)||hasCanonicalTruncation({clips:project.clips,lanes:project.lanes,truncated:project.truncated,_truncated:project._truncated,clipsTruncated:project.clipsTruncated,lanesTruncated:project.lanesTruncated})||['clips','lanes'].some(field=>project.counts?.[field]!==undefined&&(!Number.isSafeInteger(project.counts[field])||project.counts[field]!==project[field].length)))return fallback?this.trackId:null;
    const lanes=array(project.lanes),clips=array(project.clips);
    if(lanes.some(lane=>!valid(lane?.id)||!belongsToProject(lane,id)||lanes.filter(row=>row?.id===lane.id).length!==1)||clips.some(clip=>!valid(clip?.id)||!valid(clip?.laneId)||!belongsToProject(clip,id)||clips.filter(row=>row?.id===clip.id).length!==1||lanes.filter(lane=>lane?.id===clip.laneId).length!==1))return fallback?this.trackId:null;
    const sources=clips.filter(clip=>lanes.some(lane=>lane.id===clip.laneId&&lane.kind==='audio'));
    return (sources.find(clip=>clip.id===this.trackId||clip.laneId===this.trackId)||sources[0])?.id||(fallback?this.trackId:null);
  }
  async refreshTransportClock({projectId=this.projectId,trackId,signal}={}){
    const scopeError=()=>Object.assign(new Error('The cloud project changed before its transport clock was observed.'),{name:'AbortError',code:'transport_scope_changed'});
    const defaultContext=trackId===undefined;trackId=defaultContext?this.clockContextTrackId():trackId;
    const editTrackId=this.trackId,contextVersion=this.contextVersion||0;
    const checkScope=()=>{if(signal?.aborted||this.closed||!projectId||typeof trackId!=='string'||!trackId||trackId.length>64||projectId!==this.projectId||editTrackId!==this.trackId||contextVersion!==(this.contextVersion||0)||defaultContext&&trackId!==this.clockContextTrackId())throw scopeError();};checkScope();
    const transportVersion=this.transportVersion,liveClock=this.liveClock;
    const payload=body(await this.call('execute_pro_action',{project_id:projectId,track_id:trackId,action:'get_transport_clock',arguments:{}}));
    const receivedAt=this.now();checkScope();
    if(!belongsToProject(payload,projectId))throw Object.assign(new Error('The transport clock belongs to another project.'),{code:'foreign_transport_clock'});
    try{assertCompleteCanonicalData(payload,'transport clock');}catch(error){error.code='incomplete_transport_clock';throw error;}
    // A slower explicit read cannot undo a command acknowledgement or a newer
    // scoped WebRTC sequence/epoch, including packets received in the same ms.
    if(transportVersion!==this.transportVersion||liveClock!==this.liveClock)return this.positionAt();
    if(payload?.session_epoch!=null&&liveClock?.epoch!=null&&Number.isFinite(Number(payload.session_epoch))&&Number(payload.session_epoch)<liveClock.epoch)return this.positionAt();
    if(payload?.ok===false||payload?.error||!hasLoopClock(payload)||typeof(payload?.is_playing??payload?.isPlaying)!=='boolean'||!Number.isFinite(Number(payload?.position_seconds))||Number(payload.position_seconds)<0)throw new Error('Freestyle did not return a complete authoritative transport clock.');
    // Without a producer timestamp, request duration says nothing about when
    // the server sampled the clock. Anchor at receipt, never half the HTTP RTT.
    const serverSentMs=Number(payload.server_sent_ms),delivery=Number.isFinite(serverSentMs)&&serverSentMs>0?this.clockDelivery.note({serverSentMs,receivedUnixMs:this.toUnixTime(receivedAt)}):null;
    const anchorAt=receivedAt-(delivery?.excessMs||0);this.explicitClock={projectId,trackId,editTrackId,receivedAt,anchorAt,anchorSource:delivery?'server-transit-excess':'response-receipt',payload:{...payload}};
    this.adoptTransport(payload,{source:'http',observedAt:anchorAt});
    return this.positionAt();
  }
  async hydrateCanonicalPatterns(state,project,{projectId=this.projectId,trackId=this.trackId}={}){
    const container=state?.patterns,current=array(container?.patterns||container),membership=canonicalPatternIds(project||{},state),expectedProject=project?.id||projectId;
    // A complete canonical empty rack cannot be made nonempty by a shared or
    // budgeted native session. Missing counts/flags retain the canonical fallback.
    if(project?.id===projectId&&Array.isArray(project.patterns)&&project.patterns.length===0&&Number.isSafeInteger(project.counts?.patterns)&&project.counts.patterns===0&&(project.truncated===false||project.truncated?.patterns===false)&&membership.size===0){if(!belongsToProject(project,projectId))throw new Error('The canonical pattern membership belongs to another cloud project.');return {...state,patterns:Array.isArray(container)?[]:{ok:true,patterns:[]}};}
    const eligible=current.filter(entry=>belongsToProject(entry,expectedProject)&&belongsToProject(patternDTO(entry),expectedProject)&&membership.has(String(observedPatternId(entry)||'')));
    const present=new Set(eligible.map(entry=>String(observedPatternId(entry)||'')));
    const required=[...membership];
    const needsHydration=hasCanonicalTruncation(container)||eligible.some(entry=>{try{assertCompletePattern(entry);return false;}catch{return true;}})||required.some(id=>!present.has(id));
    if(!needsHydration)return state;
    // list_patterns is an existing read action returning complete persisted DTOs;
    // get_pro_state intentionally budgets nested arrays and has no expansion flag.
    const result=body(await this.call('execute_pro_action',{project_id:projectId,track_id:trackId,action:'list_patterns',arguments:{}}));
    const full=array(result?.patterns);assertCompleteCanonicalData(result,'canonical pattern list');if(!belongsToProject(result,projectId)||full.some(entry=>!belongsToProject(entry,expectedProject)||!belongsToProject(patternDTO(entry),expectedProject)))throw new Error('Freestyle returned a pattern belonging to another cloud project.');
    for(const entry of full)assertCompletePattern(entry);
    const ids=new Set(full.map(entry=>String(entry.id||patternDTO(entry).id||entry.pattern_id||'')));
    if(required.some(id=>!ids.has(id)))throw new Error('Freestyle returned an incomplete canonical pattern list. Reload the project before editing or previewing.');
    if(!Array.isArray(result?.patterns))throw new Error('Freestyle did not return its full canonical pattern list. Reload the project before editing or previewing.');
    return {...state,patterns:Array.isArray(container)?full:{...result,patterns:full}};
  }
  async hydrateCanonicalPlacements(state,project,{projectId=this.projectId,trackId=this.trackId,contextVersion=this.contextVersion||0,forceCanonical=false}={}){
    const container=state?.patternPlacements??state?.placements,current=array(container?.placements??container),summaries=array(project?.placements);
    const canonical=completeCanonicalPlacements(project,projectId);if(canonical!==null){if(this.closed||this.projectId!==projectId||this.trackId!==trackId||(this.contextVersion||0)!==contextVersion)throw Object.assign(new Error('The cloud project changed while its canonical placements were loading.'),{name:'AbortError',code:'canonical_placement_scope_changed'});return {...state,patternPlacements:{placements:canonical},...(Array.isArray(state?.placements)?{placements:canonical}:{})};}
    const needsHydration=forceCanonical||!Array.isArray(container?.placements??container)||container?.ok===false||container?.error||container?.isError||hasCanonicalTruncation(container)||current.some(entry=>{try{assertCompletePlacement(entry);return false;}catch{return true;}})||(!current.length&&summaries.length>0);
    if(!needsHydration)return state;
    const check=()=>{if(this.closed||this.projectId!==projectId||this.trackId!==trackId||(this.contextVersion||0)!==contextVersion)throw Object.assign(new Error('The cloud project changed while its canonical placements were loading.'),{name:'AbortError',code:'canonical_placement_scope_changed'});};
    check();const result=body(await this.call('execute_pro_action',{project_id:projectId,track_id:trackId,action:'list_pattern_placements',arguments:{}}));check();
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
  /** Adopt only this project's increasing native clock sequence, including loop bounds. */
  acceptClock(payload,{generation=0,receivedAt=this.now()}={}){
    if(!payload||String(payload.project_id||'')!==String(this.projectId)||this.closed)return false;
    const position=Number(payload.position_seconds??payload.position),seq=Number(payload.seq),epoch=Number(payload.session_epoch);
    if(!Number.isFinite(position)||position<0||typeof (payload.is_playing??payload.isPlaying)!=='boolean')return false;
    const guard=this.transportGuard;
    if(guard&&receivedAt<guard.until){
      const rolling=payload.is_playing??payload.isPlaying;if(rolling!==guard.playing)return false;
      if(guard.seconds!=null){let expected=guard.seconds+(rolling?Math.max(0,(receivedAt-guard.appliedAt)/1000):0);const span=this.loopEndSec-this.loopStartSec;if(this.loopEnabled&&this.playRange?.active!==true&&payload.play_range?.active!==true&&span>0&&expected>=this.loopStartSec)expected=this.loopStartSec+(expected-this.loopStartSec)%span;if(Math.abs(position-expected)>.75)return false;}
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
    this.adoptTransport(payload,{source:'live',observedAt:anchorAt,resetPhase:!sameGeneration||!sameEpoch});return true;
  }
  adoptTransport(payload,{source='ack',observedAt=this.now(),resetPhase=false}={}){
    this.transportObservationVersion=(this.transportObservationVersion||0)+1;
    const t=payload?.status&&typeof payload.status==='object'?{...payload,...payload.status}:payload||{};
    const oldPosition=this.positionSeconds,oldPlaying=this.playing,oldLoop=this.loopEnabled,oldStart=this.loopStartSec,oldEnd=this.loopEndSec;
    const position=Number(t.position_seconds??t.position),rolling=t.is_playing??t.isPlaying;
    if(Number.isFinite(position)&&position>=0)this.positionSeconds=position;
    if(typeof rolling==='boolean')this.playing=rolling;
    if(t.play_range&&typeof t.play_range==='object'&&typeof t.play_range.active==='boolean')this.playRange={...t.play_range};
    if(typeof t.loop_enabled==='boolean')this.loopEnabled=t.loop_enabled;
    if(Number.isFinite(Number(t.loop_start_sec)))this.loopStartSec=Math.max(0,Number(t.loop_start_sec));
    if(Number.isFinite(Number(t.loop_end_sec)))this.loopEndSec=Math.max(0,Number(t.loop_end_sec));
    const span=this.loopEndSec-this.loopStartSec,sameLoop=oldLoop===this.loopEnabled&&oldStart===this.loopStartSec&&oldEnd===this.loopEndSec;
    if(resetPhase||!sameLoop||!oldPlaying||!this.playing)this.loopIterations=0;
    else if(source==='live'&&this.loopEnabled&&this.playRange?.active!==true&&span>0&&oldPosition-this.positionSeconds>span/2)this.loopIterations++;
    this.positionObserved=observedAt;this.clockSource=source;if(source==='ack')this.lastTransportAppliedAt=observedAt;
    if(Number.isFinite(Number(t.bpm))&&Number(t.bpm)>0)this.transportBpm=Number(t.bpm);
    const producer=t.measured_producer_latency_seconds??t.producer_latency_seconds;
    if(producer!==null&&producer!==undefined&&Number.isFinite(Number(producer))&&Number(producer)>=0)this.producerLagSec=Number(producer);
    this.rawState||={};this.rawState.transport={...this.rawState.transport,...t};
    if(this.project){this.project.loop=this.loopEnabled;if(this.transportBpm)this.project.bpm=this.transportBpm;}
    emit(this,'transport',this.positionAt(this.now()));
  }
  /** Display-clock interpolation only. Audio continues to be rendered by Mozart. */
  positionAt(at=this.now(),{heardLagSec=0}={}){
    const elapsed=this.playing?Math.max(0,(Number(at)-this.positionObserved)/1000):0;
    const lag=this.playing?Math.max(0,Number(heardLagSec)||0):0,span=this.loopEndSec-this.loopStartSec;
    let seconds=this.positionSeconds+elapsed-lag;
    if(this.playing&&this.loopEnabled&&this.playRange?.active!==true&&span>0&&this.positionSeconds>=this.loopStartSec){
      const phase=seconds-this.loopStartSec+this.loopIterations*span;
      seconds=phase<0?this.loopStartSec:this.loopStartSec+((phase%span)+span)%span;
    }
    seconds=Math.max(0,seconds);const bpm=this.transportBpm||this.project?.bpm||120;
    return {seconds,beat:seconds*bpm/60,playing:this.playing,bpm,loopEnabled:this.loopEnabled,loopStartSec:this.loopStartSec,loopEndSec:this.loopEndSec,playRange:this.playRange?{...this.playRange}:null,clockSource:this.clockSource,clockAgeMs:Math.max(0,Number(at)-(this.clockSource==='live'?this.liveClock?.receivedAt??this.positionObserved:this.positionObserved)),clockDeliveryExcessMs:this.clockSource==='live'?this.liveClock?.deliveryExcessMs||0:0,producerLagSec:this.producerLagSec,heardLagSec:lag};
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
    if(['play','pause','stop','seek','seek_and_play'].includes(command)){this.playRange=null;this.rawState?.transport&&delete this.rawState.transport.play_range;}
    this.transportVersion++;const appliedAt=this.now();this.transportGuard={playing:status.is_playing??status.isPlaying??this.playing,seconds:command==='seek'||command==='seek_and_play'?Number(seconds):null,appliedAt,until:appliedAt+700};
    this.adoptTransport(status,{source:'ack',observedAt:appliedAt,resetPhase:command==='seek'||command==='seek_and_play'||command==='stop'});
    return true;
  }
  assertNoInProgressWrites(projectId=this.projectId){
    const record=[...this.pendingInProgress.values()].find(row=>row.projectId===projectId);if(record)throw Object.assign(new Error('The original cloud write is still running. Its idempotency key and request are retained; wait for its terminal receipt before another edit.'),{code:'idempotency_in_progress',definiteRejection:false,pendingWrite:record});
  }
  retainInProgressWrite(record,error){if(retainInProgress(record,error)){record.error=error.message;record.errorResult=error.result;record.status='uncertain';this.pendingInProgress.set(record.idempotencyKey,record);}}
  hasInProgressWrite(projectId=this.projectId){return [...this.pendingInProgress.values()].some(row=>row.projectId===projectId);}
  verifyInProgressWrite(){
    const record=[...this.pendingInProgress.values()].find(row=>row.projectId===this.projectId);if(!record)return Promise.reject(new Error('No cloud write is waiting for its original terminal receipt.'));if(record.verifying)return record.verifying;
    const contextVersion=this.contextVersion||0,projectId=this.projectId;const check=()=>{if(this.closed||this.projectId!==projectId||(this.contextVersion||0)!==contextVersion)throw Object.assign(new Error('Return to the original project context before verifying its pending write.'),{name:'AbortError'});};
    const task=(async()=>{try{check();const result=await this.call(record.callName,structuredClone(record.request));record.recoveryReceipt=structuredClone(result);check();const receipt=body(result),status=typeof receipt?.status==='string'?receipt.status:null;
      if(['projectId','project_id'].some(key=>receipt?.[key]!==undefined&&receipt[key]!==projectId))throw new Error('The recovered cloud write receipt belongs to another project.');
      if(isIdempotencyInProgress(receipt)||['queued','pending','running','processing','accepted','in_progress'].includes(status)||!(receipt?.ok===true||receipt?.applied===true||['done','complete','completed','succeeded','success'].includes(status)))throw Object.assign(new Error('The original cloud write has not returned a terminal success receipt. Its original key and pending barrier are retained.'),{code:'idempotency_in_progress'});
      record.status='confirmed';record.idempotencyInProgress=false;this.pendingInProgress.delete(record.idempotencyKey);this.lastRecoveredWrite=record;
      try{await this.refresh();check();}catch(error){record.refreshError=error.message;}return record;
    }catch(error){record.recoveryError=error.message;throw error;}finally{delete record.verifying;}})();record.verifying=task;return task;
  }
  action(name,args={},options={}) {
    try{assertCompleteCanonicalData(args,'cloud action payload');if(['preview_pattern','update_pattern','create_pattern'].includes(name)&&args.pattern)assertCompletePattern(args.pattern.pattern?args.pattern:{pattern:args.pattern});}catch(error){return Promise.reject(error);}
    const task=async()=>{
      if(!this.projectId || !this.trackId)throw new Error('Load a Freestyle cloud project first.');
      if(!['stop_all_pattern_previews','stop_pattern_preview'].includes(name))this.assertNoInProgressWrites();const idempotencyKey=options.idempotencyKey??args.idempotency_key??uid(),request={project_id:this.projectId,track_id:this.trackId,action:name,arguments:args,idempotency_key:idempotencyKey,...(options.confirmedDestructive?{confirmed_destructive:true}:{})},record={callName:'execute_pro_action',projectId:this.projectId,trackId:this.trackId,idempotencyKey,request:structuredClone(request),status:'sending'};let result;
      try{result=await this.call('execute_pro_action',request);}catch(error){this.retainInProgressWrite(record,error);throw error;}
      const response=body(result);emit(this,'action',{name,args,result:response});
      if(options.refresh!==false)await this.refresh();return response;
    };
    const pending=this.queue.then(task);this.queue=pending.catch(error=>{emit(this,'error',error);});return pending;
  }
  async applyProject(previous,next) {
    previous={...previous,audioClips:array(previous.audioClips),channels:previous.channels.filter(c=>c.id!=='empty'),patterns:previous.patterns.filter(p=>p.id!=='empty')};
    next={...next,audioClips:Array.isArray(next.audioClips)?next.audioClips:previous.audioClips,channels:next.channels.filter(c=>c.id!=='empty'),patterns:next.patterns.filter(p=>p.id!=='empty')};
    for(const pattern of [...previous.patterns,...next.patterns]){if(pattern.cloudRaw)assertCompletePattern(pattern.cloudRaw);assertCompleteCanonicalData(pattern.steps);assertCompleteCanonicalData(pattern.notes);}
    if(next.clips.some(clip=>clip.patternId==='empty'))throw new Error('Create a cloud pattern before placing a clip.');
    if(!this.projectId || previous.cloud?.projectId!==this.projectId || next.cloud?.projectId!==this.projectId)throw new Error('The edit does not belong to the loaded cloud project. Reload it before editing.');
    const unsupported=next.channels.filter(c=>{const old=previous.channels.find(o=>o.id===c.id);return old&&(numeric(c.pan)!==numeric(old.pan)||JSON.stringify(c.effects || {})!==JSON.stringify(old.effects || {}));});
    if(unsupported.length)throw new Error('Pan and effect controls require their actual Freestyle plugin parameters. Open the cloud plugin panel to edit them.');
    for(const clip of next.audioClips){
      const old=previous.audioClips.find(c=>c.id===clip.id);
      if(!old)throw new Error('New audio clips must be imported or split in Freestyle; a local clone cannot create persisted audio.');
      if(numeric(clip.offset)!==numeric(old.offset)&&!old.offsetKnown)throw new Error('Freestyle has not exposed this clip’s source offset. Reload its live audio state before changing the source trim.');
      if(clip.name!==old.name || clip.mute!==old.mute)throw new Error('Rename or mute the audio lane using its playlist track controls; individual take name/mute setters are not exposed.');
    }
    const run=(name,args,confirmed=false)=>this.action(name,args,{refresh:false,confirmedDestructive:confirmed});
    const changed=(a,b)=>JSON.stringify(a)!==JSON.stringify(b),idMap={};
    try {
      if(next.title!==previous.title)await this.call('rename_project',{project_id:this.projectId,title:next.title});
      if(next.bpm!==previous.bpm)await run('set_project_tempo',{bpm:Number(next.bpm)});
      if(next.master!==previous.master)await run('set_bus_gain',{bus_id:'master',gain:Number(next.master)});
      if(next.loop!==previous.loop)await run('set_transport_loop',{enabled:!!next.loop});
      const timelineIds=previous.cloud.timelineLaneIds || [];
      const rowKeys=new Set([...Object.keys(previous.trackNames || {}),...Object.keys(next.trackNames || {}),...(previous.mutedTracks || []).map(String),...(next.mutedTracks || []).map(String)]);
      for(const key of rowKeys){
        const index=Number(key),renamed=next.trackNames?.[key]!==previous.trackNames?.[key],muted=(next.mutedTracks || []).includes(index),muteChanged=muted!==(previous.mutedTracks || []).includes(index);
        if(!renamed&&!muteChanged)continue;
        const laneId=timelineIds[index];if(!laneId)throw new Error(`Playlist row ${index+1} has no cloud lane yet. Place a cloud pattern there before renaming or muting the row.`);
        if(renamed)await run('rename_track',{track_id:laneId,label:next.trackNames?.[key] || `Track ${index+1}`});
        if(muteChanged)await run('set_track_muted',{track_id:laneId,muted});
      }
      for(const channel of next.channels){
        const old=previous.channels.find(c=>c.id===channel.id);
        if(!old)continue;
        if(channel.patternSource)continue;
        const laneId=channelLane(channel);
        if(channel.volume!==old.volume)await run('set_track_gain',{track_id:laneId,gain:Number(channel.volume)});
        if(channel.mute!==old.mute)await run('set_track_muted',{track_id:laneId,muted:!!channel.mute});
        if(channel.solo!==old.solo)await run('set_track_soloed',{track_id:laneId,soloed:!!channel.solo});
        if(channel.name!==old.name)await run('rename_track',{track_id:laneId,label:channel.name});
      }
      const secondsPerBeat=60/numeric(next.bpm,120);
      for(const old of previous.audioClips)if(!next.audioClips.some(c=>c.id===old.id))await run('delete_clip',audioIdentity(old),true);
      for(const clip of next.audioClips){
        const old=previous.audioClips.find(c=>c.id===clip.id),identity=audioIdentity(old),targetLane=clip.track!==old.track?next.cloud.timelineLaneIds?.[clip.track]:clip.laneId;
        const movedLane=targetLane!==old.laneId;
        if(movedLane){if(!targetLane)throw new Error('Choose an existing cloud lane before moving this audio clip.');await run('move_clip_to_lane',{clip_id:identity.clip_id,lane_id:targetLane,start_ms:numeric(clip.start)*secondsPerBeat*1000});}
        else if(clip.start!==old.start)await run('shift_clip',{...identity,start_ms:numeric(clip.start)*secondsPerBeat*1000});
        if(clip.length!==old.length || clip.offset!==old.offset){const args={...identity,duration_sec:Math.max(.001,numeric(clip.length)*secondsPerBeat)};if(clip.offset!==old.offset)args.audio_offset_sec=Math.max(0,numeric(clip.offset)*secondsPerBeat);await run('trim_clip',args);}
        if(clip.volume!==old.volume)await run('set_clip_gain',{...identity,gain:Number(clip.volume)});
      }
      for(const clip of previous.clips)if(!next.clips.some(c=>c.id===clip.id)&&clip.cloudId)await run('delete_pattern_placement',{placement_id:clip.cloudId},true);
      for(const pattern of next.patterns){
        const old=previous.patterns.find(p=>p.id===pattern.id),dto=serializeCloudPattern(pattern,next);
        if(!old){
          const made=await run('create_pattern',{pattern:dto});const id=made.pattern?.id || made.patternId || made.pattern_id || made.id;
          if(!id)throw new Error('Freestyle created a pattern without returning its ID. Refresh the project before adding placements.');idMap[pattern.id]=id;
        } else if(changed(serializeCloudPattern(old,previous),dto))await run('update_pattern',{pattern_id:pattern.cloudId || pattern.id,pattern:dto});
      }
      for(const clip of next.clips){
        const old=previous.clips.find(c=>c.id===clip.id),dto=serializeCloudPlacement(clip,next,idMap);
        if(!old)await run('create_pattern_placement',{placement:dto});
        else if(changed(serializeCloudPlacement(old,previous),dto))await run('update_pattern_placement',{placement_id:clip.cloudId || clip.id,placement:dto});
      }
      for(const pattern of previous.patterns)if(!next.patterns.some(p=>p.id===pattern.id))await run('delete_pattern',{pattern_id:pattern.cloudId || pattern.id},true);
      for(const channel of previous.channels)if(!channel.patternSource&&!next.channels.some(c=>c.id===channel.id))await run('remove_track',{tracks:[channel.name]},true);
      const selected=idMap[next.selectedPattern] || next.selectedPattern;await this.refresh();if(this.project.patterns.some(p=>p.id===selected))this.project.selectedPattern=selected;return this.project;
    }catch(error){try{await this.refresh();}catch{}throw error;}
  }
  async splitAudioClip(clip,absoluteBeat){const beat=Number(absoluteBeat);if(!Number.isFinite(beat)||beat<=clip.start||beat>=clip.start+clip.length)throw new Error('Choose a slice position inside this audio clip.');const identity=audioIdentity(clip);return this.action('split_clip',{track_id:identity.track_id,split_ms:beat*60/numeric(this.project?.bpm,120)*1000});}
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
    const nextRawProject={...rawProject,placements:rows,...(Number.isSafeInteger(rawProject.counts?.placements)&&rawProject.counts.placements===current.length?{counts:{...rawProject.counts,placements:rows.length}}:{})},next=normalizeCloudProject(nextRawProject,nextState,{projectId,trackId});
    if(next.patterns.some(pattern=>pattern.id===this.project.selectedPattern))next.selectedPattern=this.project.selectedPattern;
    this.rawState=nextState;this.rawProject=nextRawProject;this.project=next;this.placementReceiptVersion=(this.placementReceiptVersion||0)+1;
    // Engine snapshots can lag DB edits. For the rest of this session, read the
    // persisted placement list on refresh; failures retain this acknowledgement.
    (this.receiptPlacementProjects??=new Set()).add(projectId);
    emit(this,'state',{project:next,raw:nextState,source:'pattern-split-receipt'});return next;
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
  async duplicateAudioClip(clip,{startBeat=clip.start+clip.length}={}){const identity=audioIdentity(clip);return this.action('copy_append_clip',{track_id:identity.track_id,start_ms:Math.max(0,Number(startBeat))*60/numeric(this.project?.bpm,120)*1000});}
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
  setGain(channel,gain){if(channel?.patternSource && channel.patternId && channel.sourceId)return this.action('set_pattern_source_gain',{pattern_id:channel.patternId,source_id:channel.sourceId,gain:Number(gain)});return this.action('set_track_gain',{track_id:channelLane(channel),gain:Number(gain)});}
  setSourceState(channel,changes){if(!this.project)throw new Error('Load a Freestyle project first.');const next=JSON.parse(JSON.stringify(this.project)),source=next.channels.find(c=>c.id===channel.id);if(!source)throw new Error('The source is no longer in the loaded cloud project.');Object.assign(source,changes);return this.applyProject(this.project,next);}
  setMuted(channel,muted){if(channel?.patternSource)return this.setSourceState(channel,{mute:!!muted});return this.action('set_track_muted',{track_id:channelLane(channel),muted:!!muted});}
  setSolo(channel,soloed){if(channel?.patternSource)return this.setSourceState(channel,{solo:!!soloed});return this.action('set_track_soloed',{track_id:channelLane(channel),soloed:!!soloed});}
  setTempo(bpm){return this.action('set_project_tempo',{bpm:Number(bpm)});}
  setMaster(gain){return this.action('set_bus_gain',{bus_id:'master',gain:Number(gain)});}
  setLoop(enabled,startSec,endSec){return this.action('set_transport_loop',{enabled:!!enabled,...(startSec!=null?{start_sec:Number(startSec)}:{}),...(endSec!=null?{end_sec:Number(endSec)}:{})});}
  setPluginParameter(laneId,pluginIndex,parameterIndex,value){return this.action('set_lane_plugin_parameter',{lane_id:laneId,plugin_index:Number(pluginIndex),parameter_index:Number(parameterIndex),value_norm:Number(value)});}
  async transport(command,{seconds,startSec,endSec}={}, {projectId=this.projectId,trackId=this.trackId,signal}={}) {
    if(!projectId||projectId!==this.projectId)throw new Error('The cloud project changed before transport dispatch.');if(!['stop','pause'].includes(command))this.assertNoInProgressWrites(projectId);
    if(typeof trackId!=='string'||!trackId||trackId.length>64)throw new Error('Transport requires an exact live track context.');
    const editTrackId=this.trackId,contextVersion=this.contextVersion||0;let version=++this.transportVersion;
    // The monitor may be bound to a durable clip while editing remains bound
    // to its lane. Route RPCs to the supplied live context without rewriting
    // the edit identity used by history and pending-edit guards.
    const check=()=>{if(signal?.aborted||this.closed||projectId!==this.projectId||editTrackId!==this.trackId||contextVersion!==(this.contextVersion||0)||version!==this.transportVersion)throw Object.assign(new Error('The cloud transport was cancelled or superseded.'),{name:'AbortError',code:'transport_scope_changed'});};
    const dispatch=async(name,args)=>{const idempotencyKey=uid(),request={...args,idempotency_key:idempotencyKey},record={callName:name,projectId,trackId,idempotencyKey,request:structuredClone(request),status:'sending'};try{return await this.call(name,request);}catch(error){this.retainInProgressWrite(record,error);throw error;}};
    if(command==='play_range'){
      if(!Number.isFinite(startSec)||!Number.isFinite(endSec)||startSec<0||endSec<=startSec)throw new Error('Play range requires finite ordered start/end seconds.');
      // Unlike transport_control, this newly published action is RPC-only. Wait
      // the mutation queue, then check cancellation before sending any request.
      const diagnostic=this.rangeTransportDiagnostic={projectId,contextVersion,stage:'queue',startedAt:this.now(),stageStartedAt:this.now(),queueMs:null,postMs:null,clockMs:null,elapsedMs:null};
      try{
      await this.queue;check();
      const dispatchedAt=this.now(),previousLiveClock=this.liveClock;diagnostic.queueMs=Math.max(0,dispatchedAt-diagnostic.startedAt);diagnostic.stage='range-post';diagnostic.stageStartedAt=dispatchedAt;
      let result;try{result=await dispatch('execute_pro_action',{project_id:projectId,track_id:trackId,action:'play_range',arguments:{start_sec:startSec,end_sec:endSec}});}finally{diagnostic.postMs=Math.max(0,this.now()-dispatchedAt);}check();
      const response=body(result);if(response?.ok===false||response?.error||response?.isError)throw Object.assign(new Error(response.message||response.error?.message||response.error||'Freestyle rejected range playback.'),{result});
      // No guessed rolling flag or end timer. A short range can already have
      // completed before the REST reply. Keep an already adopted newer live
      // observation only when its exact engine range/epoch proves this request.
      const live=this.liveClock,payload=live?.payload,range=response?.play_range,observedRange=payload?.play_range,status=response?.status;
      const exactRange=range&&observedRange&&['generation','start_frame','end_frame'].every(key=>Number.isSafeInteger(range[key])&&range[key]>=0&&range[key]===observedRange[key])&&range.end_frame>range.start_frame;
      const sameRate=Number.isFinite(range?.sample_rate)&&range.sample_rate>0&&range.sample_rate===observedRange?.sample_rate&&range.sample_rate===status?.sample_rate&&range.sample_rate===payload?.sample_rate;
      const sameEpoch=Number.isSafeInteger(status?.session_epoch)&&status.session_epoch>=0&&status.session_epoch===payload?.session_epoch;
      const observed=live!==previousLiveClock&&live?.projectId===projectId&&live.receivedAt>dispatchedAt&&this.clockSource==='live'&&this.hasFreshLiveClock(350)&&exactRange&&sameRate&&sameEpoch;
      this.transportGuard=null;if(!observed){diagnostic.stage='clock-get';diagnostic.stageStartedAt=this.now();try{await this.refreshTransportClock({projectId,trackId,signal});}finally{diagnostic.clockMs=Math.max(0,this.now()-diagnostic.stageStartedAt);}}else diagnostic.clockObservation='live';check();this.startTicking();diagnostic.stage='complete';return response;
      }catch(error){diagnostic.failedStage=diagnostic.stage;diagnostic.stage=error?.name==='AbortError'?'cancelled':'error';throw error;}finally{diagnostic.elapsedMs=Math.max(0,this.now()-diagnostic.startedAt);}
    }
    check();
    const result=await dispatch('transport_control',{project_id:projectId,track_id:trackId,command,...(seconds!=null?{seconds:Number(seconds)}:{})});
    check();
    this.applyTransportAcknowledgement(command,body(result),{seconds,projectId});version=this.transportVersion;
    this.startTicking();if(trackId!==editTrackId)await this.refreshTransportClock({projectId,trackId,signal});else await this.refresh({project:false});check();return body(result);
  }
  /** Paused while another Studio view is active; startTicking() resumes. */
  stopTicking(){clearTimeout(this.pollTimer);clearInterval(this.tickTimer);this.pollTimer=this.tickTimer=null;}
  startTicking(){
    clearTimeout(this.pollTimer);clearInterval(this.tickTimer);
    this.tickTimer=setInterval(()=>{if(this.project)emit(this,'tick',this.positionAt());},50);
    const poll=async()=>{if(this.closed)return;try{if(this.playing&&!this.hasFreshLiveClock())await this.refresh({project:false});}catch(error){emit(this,'error',error);}finally{if(!this.closed)this.pollTimer=setTimeout(poll,this.pollInterval);}};
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
  close(){this.contextVersion=(this.contextVersion||0)+1;this.transportVersion++;this.closed=true;clearTimeout(this.pollTimer);clearInterval(this.tickTimer);this.streamAudio?.pause();this.streamAudio=null;}
}
