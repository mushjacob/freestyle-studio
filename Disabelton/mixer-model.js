/** Pure mixer topology, separate from per-pattern source controls.
 * Sources: canonical project lanes, explicitly project-bound list_buses records,
 * and get_pro_state tracks/buses. No invented inserts, values or live targets.
 */
import {mixValuesEqual,mixControlValue,patternLaneIds} from './mix-revision.js';
const clone=value=>value==null?value:structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const mixerRowKey=(kind,identity)=>JSON.stringify([kind,identity]);
export function mixerGainDb(value){return finite(value)&&value>=0?value===0?-Infinity:20*Math.log10(value):null;}
function marked(value,path=new WeakSet()){
 if(value===false||value===0||value===''||value==null)return false;if(typeof value!=='object')return true;if(path.has(value))return true;path.add(value);const active=Object.values(value).some(child=>marked(child,path));path.delete(value);return active;
}
function truncated(value,path=new WeakSet()){
 if(!value||typeof value!=='object')return false;if(path.has(value))return true;path.add(value);
 for(const [key,child]of Object.entries(value))if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&marked(child)||truncated(child,path)){path.delete(value);return true;}path.delete(value);return false;
}
function collectionMarkers(value,key){
 let global=false,specific=null;if(!record(value))return{global,specific};
 for(const [name,child]of Object.entries(value)){
  const normalized=name.replaceAll('_','').toLowerCase();
  if(normalized===`${key.toLowerCase()}truncated`||normalized===`truncated${key.toLowerCase()}`){const active=marked(child);specific=specific===true||active;}
  else if(normalized==='truncated'){
   if(record(child)){if(own(child,key)){const active=marked(child[key]);specific=specific===true||active;}}
   else global=global||marked(child);
  }
  else if(['truncateditems','truncatedkeys','truncatedbytes','truncatedcharacters'].includes(normalized))global=global||marked(child);
 }
 return{global,specific};
}
function collection(container,key,{outer=null}={}){
 const items=Array.isArray(container)?container:record(container)&&Array.isArray(container[key])?container[key]:null;
 const local=collectionMarkers(container,key),envelope=collectionMarkers(outer,key),independentRead=record(container)&&container.ok===true&&!!items;
 // get_pro_state may truncate unrelated capabilities/pattern summaries. Its
 // independently successful tracks/buses reads and a collection-specific false
 // marker are evidence for this list; a bare global true alone is not.
 const localPartial=local.specific===true||local.specific!==false&&local.global;
 const outerPartial=envelope.specific===true||envelope.specific!==false&&!independentRead&&envelope.global;
 const rowPartial=!!items&&items.some(item=>{const markers=collectionMarkers(item,key);return markers.global||markers.specific===true;});
 const failed=container?.ok===false||container?.isError===true||!!container?.error||outer?.ok===false||outer?.isError===true||!!outer?.error,partial=localPartial||outerPartial||rowPartial;
 return{items:items||[],complete:!!items&&!failed&&!partial,status:failed?'failed':partial?'incomplete':items?'ready':'unread'};
}
function busIdentity(bus){
 const snake=id(bus?.bus_id)?bus.bus_id:null,plain=id(bus?.id)?bus.id:null;
 return snake&&plain&&snake!==plain?null:snake||plain;
}
function groups(items,keyFor,diagnostics,type){
 const map=new Map();for(const item of items){const key=keyFor(item);if(!key){diagnostics.push({code:`invalid-${type}-identity`,raw:clone(item)});continue;}if(!map.has(key))map.set(key,[]);map.get(key).push(item);}
 for(const [identity,values]of map)if(values.length>1)diagnostics.push({code:`ambiguous-${type}-identity`,id:identity,count:values.length});return map;
}
const unknown=(reason='not-reported')=>({known:false,value:null,field:null,reason});
function reading(raw,fields,type,ready){
 if(!ready)return unknown('read-not-complete');if(!raw)return unknown();
 const present=fields.filter(field=>own(raw,field));if(!present.length)return unknown();
 const valid=value=>type==='gain'?finite(value)&&value>=0:type==='peak'?finite(value)&&value>=0:type==='pan'?finite(value)&&value>=-1&&value<=1:typeof value==='boolean';
 if(present.some(field=>!valid(raw[field])))return unknown('invalid-reported-value');
 if(present.some(field=>raw[field]!==raw[present[0]]))return unknown('conflicting-fields');
 return{known:true,value:raw[present[0]],field:present[0],reason:null};
}
function valueState(persisted,runtime,unit,preferSaved=false){
 const chosen=preferSaved?persisted.known?persisted:null:runtime.known?runtime:persisted.known?persisted:null;
 return{value:chosen?.value??null,known:!!chosen,origin:chosen===runtime?'runtime':chosen===persisted?'persisted':null,unit,persisted,runtime,mismatch:persisted.known&&runtime.known?!mixValuesEqual(persisted.value,runtime.value):null,readUnknown:!chosen};
}
function routeId(raw,fields){
 if(!raw)return{known:false,id:null,reason:'not-reported'};
 const values=fields.filter(field=>own(raw,field)).map(field=>raw[field]);if(!values.length)return{known:false,id:null,reason:'not-reported'};
 if(values.some(value=>!id(value))||values.some(value=>value!==values[0]))return{known:false,id:null,reason:'invalid-or-conflicting-route'};
 return{known:true,id:values[0],reason:null};
}
function targetRef(kind,value,lookup){
 if(!value.known)return{kind,id:null,key:null,name:null,label:'Unknown',status:'unknown',reason:value.reason};
 const key=mixerRowKey(kind,value.id),row=lookup.get(key);return{kind,id:value.id,key,name:row?.name??null,label:row?.name||value.id,status:row?'resolved':'unresolved',reason:row?null:'not-in-persisted-topology'};
}
function pluginSlots(raw,{origin,target,runtimeReady,diagnostics}){
 if(!Array.isArray(raw))return{status:'unread',origin,slots:[]};if(truncated(raw))return{status:'incomplete',origin,slots:[]};
 const indexCounts=new Map(),instanceCounts=new Map();for(const plugin of raw){const index=plugin?.index??plugin?.plugin_index;if(Number.isInteger(index)&&index>=0)indexCounts.set(index,(indexCounts.get(index)||0)+1);const instance=plugin?.instance_id??plugin?.instanceId;if(id(instance))instanceCounts.set(instance,(instanceCounts.get(instance)||0)+1);}
 const slots=raw.map(plugin=>{
  const indexes=['index','plugin_index'].filter(field=>own(plugin||{},field)).map(field=>plugin[field]),index=indexes.length&&indexes.every(value=>Number.isInteger(value)&&value>=0&&value===indexes[0])?indexes[0]:null;
  const identities=['instance_id','instanceId'].filter(field=>own(plugin||{},field)).map(field=>plugin[field]),instanceId=identities.length&&identities.every(value=>id(value)&&value===identities[0])&&instanceCounts.get(identities[0])===1?identities[0]:null;
  const uniqueIndex=index!==null&&indexCounts.get(index)===1,live=origin==='runtime'&&runtimeReady,slotReady=live&&uniqueIndex;
  if(index===null||!uniqueIndex)diagnostics.push({code:'plugin-slot-index-unknown',target:clone(target),raw:clone(plugin)});
  const binding=slotReady?{...clone(target),pluginIndex:index,...(instanceId?{instanceId}:{})}:null;
  return{index,name:typeof plugin?.name==='string'?plugin.name:typeof plugin?.label==='string'?plugin.label:null,instanceId,bypassed:reading(plugin,['bypassed'],'boolean',live),origin,status:slotReady?'bound':origin==='persisted'?'saved-only':'unbound',binding,editorBinding:slotReady&&instanceId&&target.kind==='lane'&&target.runtimeTrackId!==null?{laneId:target.laneId,engineTrackId:target.runtimeTrackId,pluginIndex:index,instanceId}:null,raw:clone(plugin)};
 });
 return{status:'ready',origin,slots};
}
function persistedPlugins(raw){
 const fields=['pluginChain','plugin_chain'].filter(field=>own(raw||{},field));if(!fields.length||fields.some(field=>!Array.isArray(raw[field]))||fields.some(field=>!same(raw[field],raw[fields[0]])))return null;return raw[fields[0]];
}
function controls(row,verified){
 const master=row.kind==='bus'&&row.id==='master',ready=verified&&row.runtime.status==='bound',target=row.kind==='lane'?{kind:'lane',laneId:row.id}:{kind:'bus',busId:row.id};
 const result={};for(const key of ['gain','mute','solo']){const enabled=!master&&ready&&row.values[key].runtime.known;result[key]={supported:!master,enabled,target:clone(target),reason:master?'Master live gain/mute/solo control is not verified.':!verified?'Persisted identity/read is incomplete or ambiguous.':!ready?'No uniquely bound live engine target.':!row.values[key].runtime.known?'Read the actual live control state first.':null};}
 result.pan={supported:false,enabled:false,target:null,reason:'Refresh the Mixer to read saved and live lane pan.'};return result;
}
/** REST controls address saved durable identities. Adapter track records are
 * not proof of native track IDs, live values, plugins, or meters. */
function restControls(row,verified){
 const master=row.kind==='bus'&&row.id==='master',lane=row.kind==='lane',actualLane=lane&&['audio','vocal','instrument'].includes(row.laneKind),target=lane?{kind:'lane',laneId:row.id}:{kind:'bus',busId:row.id},result={};
 for(const key of ['gain','mute','solo','pan']){
  // Bus and master pan (338 setBusPan / setMasterPan / mix:apply pan) are live
  // engine state only, NOT saved with the project: editable once the live mix reports them.
  const livePan=!lane&&key==='pan',supported=lane?actualLane:master?key==='gain'||livePan:true,value=row.values[key],known=livePan?value?.live===true&&value.runtime?.known===true:value?.persisted?.known===true,maxGain=lane?16:4,withinRange=key!=='gain'||known&&value.persisted.value<=maxGain;
  const enabled=supported&&verified&&known&&withinRange;
  result[key]={supported,enabled,target:supported?clone(target):null,...livePan?{liveOnly:true}:{},reason:!supported?'This saved lane or bus has no supported control.':!verified?'Persisted identity/read is incomplete or ambiguous.':!known?livePan?'Read the live mix (bus and master pan are live only) before editing.':'Read the saved control value before editing.':!withinRange?'The saved value is outside the Studio API control range.':null};
 }
 return result;
}
/** persistedBuses is an explicit array from a verified list_buses parser; undefined
 * means unread. Stamp it with the captured persistedBusProjectId to reject stale
 * cross-project results. State-only user buses remain diagnostics, not inserts.
 */
/** Studio API: the live engine mix (getEngineMix / mix:wait body) is what you
 * hear, so a control shows it whenever it is known; the saved value stays in
 * `persisted` (and `mismatch`). Pattern-lane mute/solo is engine-track state
 * since the 338 release, so it is shown from the mix like any lane. Bus and
 * master pan exist only in the live mix (never saved). */
function heardValues(row,liveMix){
 if(!liveMix)return;const target=row.kind==='lane'?{kind:'lane',id:row.id}:{kind:'bus',id:row.id},units={gain:'linear-gain',pan:'signed-pan',mute:'boolean',solo:'boolean'};
 for(const control of row.kind==='lane'?['gain','pan','mute','solo']:row.id==='master'?['gain','pan']:['gain','pan','mute','solo']){
  const read=mixControlValue(liveMix,target,control);let current=row.values[control];if(!read.known)continue;
  if(row.kind==='bus'&&control==='pan')current=row.values.pan={...current,persisted:unknown('not-saved')};
  if(!current?.persisted)continue;
  row.values[control]=valueState(current.persisted,{known:true,value:read.value,field:control==='mute'?'muted':control==='solo'?'soloed':control,reason:null},units[control]);row.values[control].live=true;
 }
}
export function buildMixerModel({project,persistedBuses,persistedBusProjectId,liveMix=null}={}){
 const diagnostics=[],rows=[],routes=[],rawProject=project?.cloud?.rawProject,state=project?.cloud?.rawState||{},projectId=project?.cloud?.projectId||rawProject?.id||null;
 const empty={projectId,rows,routes,diagnostics,complete:false,reads:{lanes:'unread',buses:'unread',runtimeTracks:'unread',runtimeBuses:'unread'}};
 if(!id(projectId)||!record(rawProject)||rawProject.id!==projectId){diagnostics.push({code:'project-scope-unverified'});return empty;}
 const studioApi=state.studioApi===true,heard=studioApi&&record(liveMix)&&Array.isArray(liveMix.tracks)&&(liveMix.projectId==null||liveMix.projectId===projectId)?liveMix:null,patternLanes=heard?patternLaneIds(state.patternPlacements,state.placements,rawProject.placements):new Set(),unusedNative={items:[],complete:true,status:'not-requested'},lanes=collection(rawProject.lanes,'lanes',{outer:rawProject}),nativeState=studioApi&&state.nativeMixerStateAvailable===true,tracks=studioApi&&!(nativeState&&state.tracks?.live===true&&state.tracks?.runtime_ids_available===true)?unusedNative:collection(state.tracks,'tracks',{outer:state}),liveBuses=studioApi&&!(nativeState&&state.buses?.live===true)?unusedNative:collection(state.buses,'buses',{outer:state});
 const busScoped=persistedBusProjectId===projectId,buses=collection(busScoped?persistedBuses:undefined,'buses');
 if(persistedBuses!==undefined&&!busScoped)diagnostics.push({code:'persisted-bus-project-mismatch',expected:projectId,actual:persistedBusProjectId??null});
 for(const [kind,read]of [['lanes',lanes],['buses',buses],['runtime-tracks',tracks],['runtime-buses',liveBuses]])if(!read.complete)diagnostics.push({code:`${kind}-${read.status}`});
 const laneGroups=groups(lanes.items,lane=>id(lane?.id)?lane.id:null,diagnostics,'lane'),busGroups=groups(buses.items,busIdentity,diagnostics,'bus'),liveBusGroups=groups(liveBuses.items,busIdentity,diagnostics,'runtime-bus');
 const runtimeIds=new Map();for(const track of tracks.items)if(Number.isInteger(track?.id)&&track.id>=0)runtimeIds.set(track.id,(runtimeIds.get(track.id)||0)+1);
 const matchedRuntime=new Set();
 for(const [laneId,records]of laneGroups){
  if(studioApi&&records.every(lane=>lane.kind==='pattern')){diagnostics.push({code:'virtual-pattern-lane',laneId});continue;}
  const persisted=records.length===1?records[0]:null,verified=lanes.complete&&records.length===1,candidates=tracks.items.filter(track=>typeof track?.db_track_id==='string'&&track.db_track_id===laneId),runtime=candidates.length===1?candidates[0]:null;
  for(const candidate of candidates)matchedRuntime.add(candidate);
  const runtimeValid=tracks.complete&&!!runtime&&Number.isInteger(runtime.id)&&runtime.id>=0&&runtimeIds.get(runtime.id)===1,live=runtimeValid?runtime:null;
  const status=studioApi&&tracks===unusedNative?'rest':!tracks.complete?tracks.status:candidates.length>1?'ambiguous':!runtime?'unloaded':!Number.isInteger(runtime.id)||runtime.id<0?'invalid-runtime-id':runtimeIds.get(runtime.id)!==1?'ambiguous-runtime-id':'bound';
  if(status==='ambiguous'||status==='ambiguous-runtime-id'||status==='invalid-runtime-id')diagnostics.push({code:status,laneId,candidates:clone(candidates)});
  const row={key:mixerRowKey('lane',laneId),kind:'lane',id:laneId,name:typeof persisted?.name==='string'&&persisted.name?persisted.name:laneId,laneKind:persisted?.kind??null,persisted:!!persisted,verified,runtime:{status,trackId:runtimeValid?runtime.id:null},values:{},rawPersisted:clone(persisted),rawRuntime:clone(live)};
  row.values.gain=valueState(reading(persisted,['volume'],'gain',verified),reading(live,['gain'],'gain',runtimeValid),'linear-gain',studioApi);
  row.values.mute=valueState(reading(persisted,['muted'],'boolean',verified),reading(live,['muted'],'boolean',runtimeValid),'boolean',studioApi);
  row.values.solo=valueState(reading(persisted,['soloed','solo'],'boolean',verified),reading(live,['soloed'],'boolean',runtimeValid),'boolean',studioApi);
  row.values.pan=studioApi?valueState(reading(persisted,['pan'],'pan',verified),reading(live,['pan'],'pan',runtimeValid),'signed-pan',true):{value:null,known:false,origin:null,unit:null,readUnknown:true,supported:false};row.meter=reading(live,['post_fader_peak'],'peak',runtimeValid);if(heard){heardValues(row,heard);if(patternLanes.has(laneId))row.patternLane=true;}row.controls=studioApi?restControls(row,verified):controls(row,verified);if(studioApi)row.studioApi=true;
  const target={kind:'lane',laneId,runtimeTrackId:runtimeValid?runtime.id:null};
  row.plugins=runtimeValid&&own(live,'plugins')?pluginSlots(live.plugins,{origin:'runtime',target,runtimeReady:verified,diagnostics}):pluginSlots(persistedPlugins(persisted),{origin:'persisted',target,runtimeReady:false,diagnostics});
  row.output={persisted:routeId(persisted,['busId','bus_id']),runtime:runtimeValid?routeId(live,['bus_id','busId']):{known:false,id:null,reason:'live-target-unbound'}};rows.push(row);
 }
 // A directly observed built-in master may be shown read-only before persisted
 // buses have been read. Never synthesize its unity gain or a zero meter.
 const master=liveBusGroups.get('master');if(!busGroups.has('master')&&(studioApi&&own(rawProject,'masterGain')||master?.length===1))busGroups.set('master',[]);
 for(const [busId,records]of busGroups){
  const projectMaster=studioApi&&busId==='master',masterIdentity=projectMaster&&records.length<=1,persisted=projectMaster?(masterIdentity?{...(records[0]||{id:'master',name:'Master'}),gain:rawProject.masterGain}:null):records.length===1?records[0]:null,verified=projectMaster?masterIdentity&&rawProject.ok!==false&&!rawProject.error&&!rawProject.isError&&collectionMarkers(rawProject,'masterGain').specific!==true:buses.complete&&records.length===1,candidates=liveBusGroups.get(busId)||[],runtime=candidates.length===1?candidates[0]:null,runtimeValid=liveBuses.complete&&!!runtime;
  const status=studioApi&&liveBuses===unusedNative?'rest':!liveBuses.complete?liveBuses.status:candidates.length>1?'ambiguous':runtime?'bound':'unloaded';
  const row={key:mixerRowKey('bus',busId),kind:'bus',id:busId,name:typeof persisted?.name==='string'&&persisted.name?persisted.name:typeof runtime?.label==='string'&&runtime.label?runtime.label:busId==='master'?'Master':busId,laneKind:null,persisted:!!persisted,verified,runtime:{status,trackId:null},values:{},rawPersisted:clone(persisted),rawRuntime:clone(runtimeValid?runtime:null)};
  row.values.gain=valueState(reading(persisted,['gain'],'gain',verified),reading(runtime,['gain'],'gain',runtimeValid),'linear-gain',studioApi);row.values.mute=valueState(reading(persisted,['muted'],'boolean',verified),reading(runtime,['muted'],'boolean',runtimeValid),'boolean',studioApi);row.values.solo=valueState(reading(persisted,['soloed'],'boolean',verified),reading(runtime,['soloed'],'boolean',runtimeValid),'boolean',studioApi);row.values.pan={value:null,known:false,origin:null,unit:null,readUnknown:true,supported:false};row.meter=reading(runtime,['post_fader_peak'],'peak',runtimeValid);if(heard)heardValues(row,heard);row.controls=studioApi?restControls(row,verified):controls(row,verified);if(studioApi)row.studioApi=true;
  const target={kind:'bus',busId};row.plugins=runtimeValid&&own(runtime,'plugins')?pluginSlots(runtime.plugins,{origin:'runtime',target,runtimeReady:verified,diagnostics}):pluginSlots(persistedPlugins(persisted),{origin:'persisted',target,runtimeReady:false,diagnostics});row.output=null;rows.push(row);
 }
 for(const track of tracks.items)if(!matchedRuntime.has(track))diagnostics.push({code:'unmatched-runtime-track',raw:clone(track)});
 for(const [busId,records]of liveBusGroups)if(!busGroups.has(busId))diagnostics.push({code:'observed-only-bus',id:busId,records:clone(records)});
 const lookup=new Map(rows.map(row=>[row.key,row]));
 for(const row of rows)if(row.output){row.output.persisted=targetRef('bus',row.output.persisted,lookup);row.output.runtime=targetRef('bus',row.output.runtime,lookup);row.output.mismatch=row.output.persisted.id!==null&&row.output.runtime.id!==null?row.output.persisted.id!==row.output.runtime.id:null;}
 const patterns=Array.isArray(project.patterns)?project.patterns:[],placements=Array.isArray(project.clips)?project.clips:[];
 for(const pattern of patterns){
  const dto=pattern?.cloudRaw?.data?.pattern?pattern.cloudRaw.data:pattern?.cloudRaw,patternId=pattern?.cloudId||pattern?.id,sources=dto?.pattern?.sources;
  if(!id(patternId)||!Array.isArray(sources)||truncated(dto)){diagnostics.push({code:'pattern-routing-incomplete',patternId:patternId??null});continue;}
  const sourceGroups=groups(sources,source=>id(source?.id)?source.id:null,diagnostics,'pattern-source');
  for(const [sourceId,entries]of sourceGroups){if(entries.length!==1){diagnostics.push({code:'ambiguous-source-route',patternId,sourceId});continue;}const source=entries[0];
   const lane=targetRef('lane',source.kind==='plugin'?routeId(source,['laneId']):{known:false,id:null,reason:'sample-source-is-not-a-lane'},lookup),bus=targetRef('bus',routeId(source,['busId']),lookup);
   const route={key:JSON.stringify(['source',patternId,sourceId]),patternId,sourceId,name:typeof source.name==='string'?source.name:sourceId,kind:source.kind??null,lane,bus,gain:reading(source,['volume'],'gain',true),placements:[],rawSource:clone(source)};
   for(const placement of placements.filter(clip=>id(pattern.id)&&clip.patternId===pattern.id||id(pattern.cloudId)&&clip.patternId===pattern.cloudId)){
    const raw=placement.cloudRaw;if(!record(raw)||truncated(raw)){diagnostics.push({code:'placement-routing-incomplete',placementId:placement.cloudId||placement.id});continue;}
    const overrides=record(raw.sourceBusOverrides)?raw.sourceBusOverrides:null,override=overrides&&own(overrides,sourceId)?routeId({value:overrides[sourceId]},['value']):{known:false,id:null,reason:overrides?'not-set':'not-reported'};
    route.placements.push({placementId:placement.cloudId||placement.id,lane:targetRef('lane',routeId(raw,['laneId','lane_id']),lookup),bus:targetRef('bus',routeId(raw,['busId','bus_id']),lookup),sourceBusOverride:targetRef('bus',override,lookup)});
   }
   routes.push(route);
  }
 }
 const invalid=diagnostics.some(item=>/^(invalid|ambiguous)(-|$)/.test(item.code)||/routing-incomplete$/.test(item.code));
 return{projectId,...(studioApi?{studioApi:true}:{}),rows,routes,diagnostics,complete:lanes.complete&&buses.complete&&tracks.complete&&liveBuses.complete&&!invalid,reads:{lanes:lanes.status,buses:buses.status,runtimeTracks:tracks.status,runtimeBuses:liveBuses.status}};
}
