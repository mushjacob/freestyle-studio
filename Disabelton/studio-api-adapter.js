/** Studio API v1 request compatibility for the old `/api/call` names.
 *
 * Browser port of the local bridge's studio_api_adapter.py (no network or
 * credentials here; freestyle-host-transport.js owns HTTP). Only documented
 * aliases are translated. Unsupported deterministic calls fail closed; they are
 * never sent to MCP. Operation contracts come from the generated client's
 * STUDIO_API_METADATA (the same OpenAPI snapshot as docs/studio-api-operations.json).
 *
 * Tables are built lazily: studio-api-client.js imports the transport, which
 * imports this module, so nothing here may touch the metadata at load time.
 */
import {STUDIO_API_METADATA} from './studio-api-client.js';

const own=(value,key)=>Object.prototype.hasOwnProperty.call(value??{},key);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const uuid=()=>globalThis.crypto?.randomUUID?.()||`disabelton-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;

/** Python ValueError/TypeError equivalent: the bridge answers 400 invalid_studio_arguments. */
export class AdapterValueError extends Error{constructor(message,code){super(message);this.name='AdapterValueError';if(code)this.code=code;}}
const fail=(message,code)=>{throw new AdapterValueError(message,code);};

/** A deterministic feature has no declared v1 contract; never fall back. */
export class UnmappedStudioCall extends Error{
 constructor(name,action=null,reason=null){
  const why=reason||'No declared Studio API v1 operation covers this deterministic call.';
  super(`${name}${action?'('+action+')':''}: ${why}`);
  this.name='UnmappedStudioCall';this.toolName=name;this.action=action;this.reason=why;
  this.code='studio_api_feature_unavailable';this.status=501;this.stage='api_mapping';
 }
}
export class StudioSnapshotConflict extends Error{constructor(message){super(message);this.name='StudioSnapshotConflict';this.status=409;this.code='studio_api_snapshot_conflict';this.stage='canonical_read';}}
/** Preserve a transport-returned real HTTP failure without replaying it. */
export class StudioAPIResponseError extends Error{
 constructor(response){
  const body=response?.data,error=record(body?.error)?body.error:{},headers=response?.headers||{};
  super(typeof error.message==='string'&&error.message?error.message:`Studio API returned HTTP ${response?.status}.`);
  this.name='StudioAPIResponseError';this.status=response?.status;
  this.code=error.code??'studio_api_http_error';this.stage=error.stage??'response';
  this.engineStatus=error.engineStatus??null;this.details=error.details===undefined?null:copy(error.details);
  if(typeof error.applied==='boolean')this.applied=error.applied;
  this.requestId=error.requestId||headerValue(headers,'x-request-id')||null;
  const retry=headerValue(headers,'retry-after');
  this.retryAfterSec=typeof retry==='string'&&/^\s*\d+(?:\.\d+)?\s*$/.test(retry)?Number(retry):null;
 }
}
export function headerValue(headers,name){for(const [key,value]of Object.entries(headers||{}))if(key.toLowerCase()===name)return value;return null;}

let tables=null;
function T(){
 if(tables)return tables;
 const source=STUDIO_API_METADATA.operations,OPERATIONS={};
 for(const [name,operation]of Object.entries(source)){
  const body=operation.requestBody?.content?.['application/json']?.schema||{};
  OPERATIONS[name]={...operation,body,bodyRequired:!!operation.requestBody?.required,equivalent:operation.mcpEquivalent,parameters:operation.parameters||[]};
 }
 const DIRECT_TOOLS=new Map(),PRO_ACTIONS=new Map();
 // Python: sorted(OPERATIONS.items(), key=startswith('engine_')) is stable, so
 // non-engine operations claim an annotation first, in metadata order.
 const ordered=[...Object.entries(OPERATIONS).filter(([id])=>!id.startsWith('engine_')),...Object.entries(OPERATIONS).filter(([id])=>id.startsWith('engine_'))];
 for(const [id,operation]of ordered){
  const equivalent=operation.equivalent||'';
  if(/^[a-z][a-z0-9_]+$/.test(equivalent)&&!DIRECT_TOOLS.has(equivalent))DIRECT_TOOLS.set(equivalent,id);
  const match=/^execute_pro_action\(([a-z][a-z0-9_]+)\)$/.exec(equivalent);
  if(match&&!PRO_ACTIONS.has(match[1]))PRO_ACTIONS.set(match[1],id);
 }
 for(const [name,id]of Object.entries({upload_pattern_sample:'uploadPatternSample',place_pattern_sample_on_timeline:'placePatternSampleOnTimeline',
  // FL-style per-clip audio mute (310): the resource PUT, never lane mute or a gain substitute.
  set_clip_muted:'setClipMuted',
  list_automation:'listAutomation',get_saved_plugin_state:'getSavedLanePluginState',update_automation:'updateAutomationEnvelope',
  list_plugin_catalog:'listPluginCatalog',get_catalog_plugin:'getCatalogPlugin',list_instrument_catalog:'listInstrumentCatalog',
  list_lane_plugin_parameters:'listLanePluginParameters',list_bus_plugin_parameters:'listBusPluginParameters'}))DIRECT_TOOLS.set(name,id);
 for(const [name,id]of Object.entries({
  list_patterns:'listPatterns',list_pattern_placements:'listPatternPlacements',restore_pattern_placement:'restorePatternPlacement',
  // 338: channel add/patch/delete share the update_pattern annotation; the action stays the pattern PATCH.
  update_pattern:'updatePattern',
  list_tracks:'listEngineTracks',list_buses:'engine_list_buses',get_transport:'getTransport',
  get_history:'getEngineHistory',history_undo:'undoEngineHistory',history_redo:'redoEngineHistory',
  send_midi:'sendEngineMidi',all_notes_off:'engineMidiAllNotesOff',move_clip_to_lane:'moveClipToLane',
  start_recording:'startRecording',finalize_recording:'finalizeRecording',
  add_lane_plugin:'addLanePlugin',add_bus_plugin:'addBusPlugin',delete_lane_plugin:'deleteLanePlugin',
  add_instrument_track:'engine_add_instrument_track',get_bus_plugin_live_state:'engine_get_bus_plugin_live_state',
  set_lane_plugin_parameter:'setLanePluginParameter',set_plugin_parameter:'setLanePluginParameter',
  set_plugin_bypassed:'setLanePluginBypassed',get_plugin_state:'getLanePluginState',
  rename_track:'updateLane',delete_track:'deleteLane',route_track_to_bus:'setLaneRouting'}))PRO_ACTIONS.set(name,id);
 // get_transport_clock needs no pin since Freestyle issue #18: among the typed routes only getTransportClock
 // carries that annotation now (cloud-metronome-engine.test.mjs asserts the claim after every regeneration).
 const gaps={
  get_history:'Studio API v1 does not expose the native history stack.',history_undo:'Studio API v1 does not expose native engine Undo.',history_redo:'Studio API v1 does not expose native engine Redo.',
  send_midi:'Studio API v1 does not expose immediate MIDI audition.',preview_pattern_sample:'Studio API v1 does not expose individual sampler audition.',
  create_empty_lane:'The native empty-lane creation/acknowledgement contract is absent.',load_labs:'Studio API v1 has no instrument/plugin loader.',
  add_instrument_track:'Instrument creation is a deterministic UI action and has no declared v1 equivalent.',set_metronome:'Studio API v1 has no metronome setter.',
  set_clip_gain:'ClipBatchOp has timing fields only; clip gain is not a declared v1 write.',move_clip_to_lane:'ClipBatchOp has no lane field; cross-lane clip moves are not exposed.',
  split_clip:'Native clip split needs a declared endpoint or a separately verified canonical batch plan.',copy_append_clip:'Native copy/append needs a separately verified canonical insert plan.',
  set_pattern_source_gain:'Use a complete canonical pattern PATCH; no partial source-gain endpoint exists.',set_pattern_steps:'Use a complete canonical pattern PATCH; a steps-only endpoint is not declared.',
  write_pattern_notes:'Use a complete canonical pattern PATCH; a notes-only endpoint is not declared.',load_track_plugin:'Studio API v1 does not expose plugin insertion.',
  load_bus_plugin:'Studio API v1 does not expose plugin insertion.',set_eq_band:'This generic alias has no unambiguous target. Use the declared set_track_eq_band or set_pattern_eq_band action and its typed arguments.',
  start_recording:'Studio API v1 does not expose native recording start.',finalize_recording:'Studio API v1 does not expose native take finalization.',
  browse_sounds:'Studio API v1 exposes owned library assets, not the searchable sound catalog.',list_audio_library:'Studio API v1 does not expose the audio catalog.',
  list_sound_pack_items:'Studio API v1 does not expose sound-pack contents.',get_marketplace_asset:'Studio API v1 does not expose marketplace asset detail.',
  apply_marketplace_pattern:'Studio API v1 does not expose marketplace-pattern materialization.',materialize_sound_pack_item:'Studio API v1 does not expose sound-pack item materialization.',
  list_effect_presets:'Studio API v1 does not expose the effect preset catalog.',list_vocal_chain_presets:'Studio API v1 does not expose vocal-chain preset catalog.',
  get_vocal_chain_preset:'Studio API v1 does not expose vocal-chain preset detail.',apply_vocal_chain_preset:'Studio API v1 does not expose vocal-chain preset application.',
  render_live_window:'Studio API v1 does not expose live-window rendering.',start_stream:'The legacy stream endpoint is replaced by project monitoring; no equivalent stream result exists.',
  stop_stream:'Studio API v1 does not expose legacy stream shutdown.'};
 const KNOWN_GAPS=new Map(Object.entries(gaps).filter(([name])=>!PRO_ACTIONS.has(name)&&!DIRECT_TOOLS.has(name)));
 tables={OPERATIONS,DIRECT_TOOLS,PRO_ACTIONS,KNOWN_GAPS,COMPONENTS:STUDIO_API_METADATA.components||{}};
 return tables;
}
export function operations(){return T().OPERATIONS;}
export function proActions(){return [...T().PRO_ACTIONS.keys()].sort();}

/** Upload admission and timeline placement keep one caller-retained key per
 * logical write; placement additionally needs the caller's fresh timeline ETag. */
export const RETAINED_KEY_OPERATIONS=Object.freeze(new Set(['uploadPatternSample','placePatternSampleOnTimeline']));
export const IF_MATCH_OPERATIONS=Object.freeze(new Set(['placePatternSampleOnTimeline']));
/** Only assistant/natural-language work retains MCP. */
export const AI_ONLY_TOOLS=Object.freeze(new Set(['mozart_ai_command']));
export const AI_ONLY_ACTIONS=Object.freeze(new Set(['compose','compose_song','refine_song','song_brief','mix_check','audit_arrangement','analyze_song_sections','analyze_harmony','detect_tempo']));
const LIST_COLLECTIONS={listProjects:'projects',listLibraryAssets:'assets',listLanes:'lanes',listClips:'clips',listPatterns:'patterns',listPatternPlacements:'placements',
 listBuses:'buses',listAutomation:'envelopes',listClipAutomation:'envelopes',listLaneAutomation:'envelopes',listPluginAutomation:'envelopes',
 listProjectSaves:'saves',listPatternSamples:'samples',listExports:'exports',browseCatalogSounds:'items',browseCatalogMarketplace:'assets',
 listCatalogEffectPresets:'presets',listCatalogVocalChainPresets:'presets',listCatalogPresetPackItems:'items',listPluginCatalog:'plugins',listInstrumentCatalog:'instruments'};
const LIST_KINDS=new Set(Object.values(LIST_COLLECTIONS));
const LANE_TARGET_ACTIONS=new Set(['set_track_gain','set_track_pan','set_track_muted','set_track_soloed','rename_track','delete_track','route_track_to_bus','open_plugin_editor','close_plugin_editor','release_plugin_editor','get_plugin_editor_status']);
const AUTOMATION_KEYS={default_value:'defaultValue',value_type:'valueType',expected_revision:'expectedRevision'};

function opaque(value,field){
 if(typeof value!=='string'||!value||value==='.'||value==='..'||[...value].length>128||value!==value.trim()||/[\u0000-\u001f\u007f]/.test(value))fail(`${field} must be an opaque returned resource id, not a numeric engine index.`);
 return value;
}
const regexCache=new Map();
function regex(pattern){if(regexCache.has(pattern))return regexCache.get(pattern);let re=null;try{re=new RegExp(pattern,'u');}catch{try{re=new RegExp(pattern);}catch{re=null;}}regexCache.set(pattern,re);return re;}
const sameJson=(a,b)=>a===b||JSON.stringify(a)===JSON.stringify(b);
/** Validate published JSON shapes/units without coercing engine values. */
export function schemaValue(value,schema,field,depth=0){
 schema=schema||{};
 if(depth>128)fail(`${field} exceeds the schema nesting limit.`);
 if(own(schema,'$ref')){
  const ref=schema.$ref;if(typeof ref!=='string'||!ref.startsWith('#/components/'))fail('Only published local schema references are supported.');
  let target=T().COMPONENTS;for(const part of ref.slice('#/components/'.length).split('/')){target=target?.[part.replace(/~1/g,'/').replace(/~0/g,'~')];}
  if(target===undefined)fail('Only published local schema references are supported.');
  schemaValue(value,target,field,depth+1);
 }
 for(const member of schema.allOf||[])schemaValue(value,member,field,depth+1);
 for(const keyword of ['anyOf','oneOf']){
  if(!own(schema,keyword))continue;let valid=0;
  for(const member of schema[keyword]){try{schemaValue(value,member,field,depth+1);valid++;}catch(error){if(!(error instanceof AdapterValueError))throw error;}}
  if(valid===0||keyword==='oneOf'&&valid!==1)fail(`${field} does not match its declared shape.`);
 }
 const kind=schema.type,kinds=Array.isArray(kind)?kind:kind?[kind]:[];
 const matches=item=>item==='null'&&value===null||item==='string'&&typeof value==='string'||item==='boolean'&&typeof value==='boolean'||item==='integer'&&Number.isInteger(value)||item==='number'&&finite(value)||item==='object'&&record(value)||item==='array'&&Array.isArray(value);
 if(kinds.length&&!kinds.some(matches))fail(`${field} must be a finite ${kind} of its declared type.`);
 if(own(schema,'enum')&&!schema.enum.some(choice=>sameJson(choice,value)))fail(`${field} is outside the declared choices.`);
 if(typeof value==='string'){
  const length=[...value].length;
  if(length<(schema.minLength??0)||length>(schema.maxLength??Infinity))fail(`${field} has an invalid length.`);
  if(schema.pattern){const re=regex(schema.pattern);if(re&&!re.test(value))fail(`${field} violates the declared format.`);}
 }
 if(typeof value==='number'){
  if(!Number.isFinite(value)||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity))fail(`${field} is outside the declared range.`);
  if(own(schema,'exclusiveMinimum')&&value<=schema.exclusiveMinimum||own(schema,'exclusiveMaximum')&&value>=schema.exclusiveMaximum)fail(`${field} is outside the declared exclusive range.`);
 }
 if(Array.isArray(value)){
  if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))fail(`${field} has an invalid item count.`);
  value.forEach((item,index)=>schemaValue(item,schema.items||{},`${field}[${index}]`,depth+1));
 }else if(record(value)){
  const properties=schema.properties||{};
  if((schema.required||[]).some(key=>!own(value,key)))fail(`${field} is missing a required field.`);
  const extra=own(schema,'additionalProperties')?schema.additionalProperties:true;
  for(const [key,item]of Object.entries(value)){
   if(!own(properties,key)&&extra===false)fail(`${field} has no declared ${key} argument.`);
   schemaValue(item,own(properties,key)?properties[key]:record(extra)?extra:{},`${field}.${key}`,depth+1);
  }
 }else if(value!==null&&value!==undefined&&!['string','boolean','number'].includes(typeof value))fail(`${field} must be a JSON value.`);
 return value;
}

// updatePattern (PATCH /patterns/{id}) documents a FLAT body; reads nest the
// score as pattern.pattern.{sources,events}. Every path sends the flat body.
const PATTERN_BODY_FIELDS=['name','ppq','bars','swing','sources','events'];
function documentedNoteView(body){
 const events=body.pattern?.events;if(!Array.isArray(events))return body;
 const notes=[];events.forEach((event,index)=>{if(!record(event))fail(`pattern.events[${index}] must be an object.`,'invalid_pattern_body');if(['midi','note'].includes(event.type??'midi'))notes.push(event);});
 return {...body,pattern:{...body.pattern,events:notes}};
}
/** A pattern write carrying both `bars` and a disagreeing `lengthTicks` is a 400; bars wins. */
export function singleLengthPatternBody(body){
 if(!record(body)||!record(body.pattern))return body;const pattern=body.pattern;
 if(!own(pattern,'bars')||!['lengthTicks','length_ticks'].some(key=>own(pattern,key)))return body;
 return {...body,pattern:Object.fromEntries(Object.entries(pattern).filter(([key])=>key!=='lengthTicks'&&key!=='length_ticks'))};
}
export function documentedPatternBody(body){
 if(!record(body)||!record(body.pattern))fail('updatePattern needs a pattern object.','invalid_pattern_body');
 const pattern=copy(body.pattern),nested=pattern.pattern;delete pattern.pattern;
 if(nested!==undefined&&nested!==null){
  if(!record(nested))fail('The nested pattern score must be an object.','invalid_pattern_body');
  if(own(pattern,'sources')||own(pattern,'events'))fail('A pattern body cannot carry both flat and nested sources/events.','ambiguous_pattern_body');
  pattern.sources=nested.sources;pattern.events=nested.events;
 }
 const positive=value=>finite(value)&&value>0;
 const ticks=['lengthTicks','length_ticks'].filter(key=>own(pattern,key)).map(key=>{const value=pattern[key];delete pattern[key];return value;});
 const ppq=pattern.ppq,bars=pattern.bars;
 if(own(pattern,'bars')&&!positive(bars))fail(`pattern.bars must be a positive number of bars (got ${JSON.stringify(bars)}).`,'invalid_pattern_body');
 if(positive(bars))pattern.bars=Math.max(1,Math.ceil(bars-1e-9));
 else if(positive(ppq)&&ticks.length&&positive(ticks[0]))pattern.bars=Math.max(1,Math.ceil(ticks[0]/(4*ppq)-1e-9));
 const flat=Object.fromEntries(PATTERN_BODY_FIELDS.filter(key=>own(pattern,key)).map(key=>[key,pattern[key]]));
 if(!Array.isArray(flat.sources)||!Array.isArray(flat.events))fail('updatePattern must send the complete pattern.sources and pattern.events.','incomplete_pattern_body');
 const rest=Object.fromEntries(Object.entries(body).filter(([key])=>key!=='pattern'));
 return {...rest,pattern:flat};
}

function operationRequest(operationId,argumentsValue,{contextTrack=null,key=null,ifMatch=null,responseKind=null,allPages=false}={}){
 const op=T().OPERATIONS[operationId];if(!op)fail(`Unknown Studio API operation ${operationId}.`);
 const args=copy(argumentsValue)||{};const resourceProjectId=args.project_id??null;
 const suppliedKey=own(args,'idempotency_key')?args.idempotency_key:null;delete args.idempotency_key;
 const suppliedMatch=own(args,'if_match')?args.if_match:null;delete args.if_match;
 if(key==null)key=suppliedKey;if(ifMatch==null)ifMatch=suppliedMatch;
 let path=op.path;const pathParams={},query={};let body={};
 const bodySchema=op.body||{},properties=bodySchema.properties||{};
 if(own(properties,'idempotency_key')&&suppliedKey!=null)args.idempotency_key=suppliedKey;
 const queryScope=op.parameters.some(p=>p.in==='query'&&p.name==='scope_track_id');
 if(contextTrack!=null&&queryScope){
  opaque(contextTrack,'scope_track_id');
  if(own(args,'scope_track_id')&&args.scope_track_id!==contextTrack)fail('Conflicting live session scope_track_id.');
  args.scope_track_id=contextTrack;
 }
 if(contextTrack!=null&&!queryScope&&(own(properties,'track_id')||op.parameters.some(p=>p.in==='query'&&p.name==='track_id'))){
  if(own(args,'track_id'))fail('A target lane track_id cannot replace the engine context track_id.');
  args.track_id=contextTrack;
 }
 for(const parameter of op.parameters){
  const {name,in:location}=parameter;if(location==='header')continue;
  if(!own(args,name)){if(parameter.required)fail(`${operationId} requires ${name}.`);continue;}
  const value=args[name];delete args[name];
  schemaValue(value,parameter.schema||{},name);
  if(location==='path'){
   if(['plugin_index','parameter_index','index'].includes(name)){if(!Number.isInteger(value)||value<0)fail(`${name} must be a nonnegative integer.`);}
   else opaque(value,name);
   pathParams[name]=value;if(own(properties,name))body[name]=copy(value);
   path=path.split('{'+name+'}').join(encodeURIComponent(String(value)));
  }else if(location==='query')query[name]=value;
 }
 for(const [name,value]of Object.entries(args)){
  if(!own(properties,name))fail(`${operationId} has no declared ${name} argument.`);
  if(!(operationId==='updatePattern'&&name==='pattern'))schemaValue(value,properties[name],name);
  body[name]=value;
 }
 const missing=(bodySchema.required||[]).filter(name=>!own(body,name));
 if(missing.length)fail(`${operationId} requires ${missing.join(', ')}.`);
 if(path.includes('{'))fail(`${operationId} has an unresolved resource path.`);
 const headers={};
 if(RETAINED_KEY_OPERATIONS.has(operationId)&&key==null)fail(`${operationId} requires a caller-retained Idempotency-Key.`);
 if(IF_MATCH_OPERATIONS.has(operationId)&&ifMatch==null)fail(`${operationId} requires a fresh timeline If-Match revision.`);
 if(!['GET','HEAD','OPTIONS'].includes(op.method)){
  key=key==null?uuid():key;
  if(typeof key!=='string'||key.length<8||key.length>128||/[\r\n]/.test(key))fail('Idempotency-Key must be 8–128 safe characters.');
  headers['Idempotency-Key']=key;
 }
 if(operationId==='updatePattern'&&own(body,'pattern')){body=documentedPatternBody(body);schemaValue(documentedNoteView(body),bodySchema,operationId+' body');}
 else if(operationId==='engine_update_pattern'){body=singleLengthPatternBody(body);schemaValue(body,bodySchema,operationId+' body');}
 else schemaValue(body,bodySchema,operationId+' body');
 if(ifMatch!=null){if(typeof ifMatch!=='string'||!ifMatch||/[\r\n]/.test(ifMatch))fail('If-Match must be a nonempty safe ETag.');headers['If-Match']=ifMatch;}
 return {kind:'request',operationId,method:op.method,path:'/api/v1'+path,pathParams,query,body:op.bodyRequired||Object.keys(body).length?body:null,headers,
  responseKind:responseKind||LIST_COLLECTIONS[operationId]||'raw',allPages:!!allPages,resourceProjectId,idempotencyKey:headers['Idempotency-Key']??null,ifMatch:headers['If-Match']??null};
}

function targetAlias(args,old,next){
 if(!own(args,old))return;
 if(own(args,next)&&!sameJson(args[next],args[old]))fail(`Conflicting ${old} and ${next} resource identities.`);
 args[next]=args[old];delete args[old];
}
function nativeActionArgs(action,nested,operationId=''){
 const args=copy(nested);
 if(LANE_TARGET_ACTIONS.has(action)&&!operationId.startsWith('engine_'))targetAlias(args,'track_id','lane_id');
 if(action==='rename_track'&&operationId==='updateLane')targetAlias(args,'label','name');
 if(action==='attach_clip_to_session')targetAlias(args,'db_track_id','clip_id');
 if(action==='add_lane_plugin'&&operationId==='addLanePlugin')targetAlias(args,'type','plugin_id');
 if(operationId.startsWith('engine_'))for(const field of ['track_id','clip_id','lane_id','bus_id','pattern_id','placement_id','instrument_id','source_id'])if(own(args,field))opaque(args[field],field);
 return args;
}
function batchAction(action,nested,outer,key=null,ifMatch=null){
 const args=copy(nested);const clipId=args.clip_id;delete args.clip_id;
 if(clipId==null)throw new UnmappedStudioCall('execute_pro_action',action,'A durable clip_id is required; a lane or runtime index cannot identify an audio clip.');
 opaque(clipId,'clip_id');
 const laneId=args.track_id;delete args.track_id;if(laneId!=null)opaque(laneId,'track_id');
 const permitted={shift_clip:['start_ms'],trim_clip:['start_ms','duration_sec','audio_offset_sec'],delete_clip:[]}[action];
 if(Object.keys(args).some(key=>!permitted.includes(key)&&key!=='expected'))throw new UnmappedStudioCall('execute_pro_action',action,'The legacy clip action contains fields outside the declared timing batch contract.');
 if(action!=='delete_clip'&&!permitted.some(key=>own(args,key)))fail(`${action} needs at least one timing value.`);
 if(own(args,'expected')){const expected=args.expected,timing=['start_ms','duration_sec','audio_offset_sec'];if(!record(expected)||Object.keys(expected).length!==3||!timing.every(key=>own(expected,key)))fail('A clip batch expected guard needs exactly start_ms, duration_sec and audio_offset_sec.');}
 const operation={op:action==='delete_clip'?'remove':'update',id:clipId,...args};
 const request={project_id:outer.project_id,ops:[operation]};if(outer.track_id!=null)request.track_id=outer.track_id;
 return operationRequest('applyClipBatch',request,{key,ifMatch});
}

/** Local complete schema generated from a known REST operation, never MCP. */
export function capability(action){
 const {PRO_ACTIONS,OPERATIONS,KNOWN_GAPS}=T(),operationId=PRO_ACTIONS.get(action);
 if(!operationId)throw new UnmappedStudioCall('list_pro_capabilities',action,KNOWN_GAPS.get(action));
 const operation=OPERATIONS[operationId];
 const schema=copy(operation.body)&&Object.keys(operation.body).length?copy(operation.body):{type:'object',properties:{}};
 schema.properties||={};schema.required||=[];
 const native=operationId.startsWith('engine_');
 if(!native){delete schema.properties.track_id;schema.required=schema.required.filter(key=>key!=='track_id');}
 for(const parameter of operation.parameters){
  if(parameter.in==='header'||parameter.name==='project_id')continue;let name=parameter.name;
  if(['track_id','scope_track_id','confirm'].includes(name))continue;
  if(name==='lane_id'&&LANE_TARGET_ACTIONS.has(action))name='track_id';
  schema.properties[name]=copy(parameter.schema||{});if(parameter.required)schema.required.push(name);
 }
 const rename=(from,to)=>{if(own(schema.properties,from)){const value=schema.properties[from];delete schema.properties[from];schema.properties[to]=value;}schema.required=schema.required.map(key=>key===from?to:key);};
 if(action==='rename_track')rename('name','label');
 if(action==='attach_clip_to_session')rename('clip_id','db_track_id');
 for(const [field,unit]of Object.entries({gain:'linear (1 = unity)',pan:'-1 hard left, 0 center, 1 hard right',value_norm:'normalized 0–1'}))if(own(schema.properties,field))schema.properties[field]['x-unit']=unit;
 schema.additionalProperties=false;schema.required=[...new Set(schema.required)];
 const mutates=native?operation.scope!=='daw:read':!['GET','HEAD','OPTIONS'].includes(operation.method);
 return {name:action,argumentSchema:schema,method:operation.method,mutates,family:'studio',risk:mutates?'reversible':'read',destructive:operation.method==='DELETE'||operation.confirmation==='confirm=true',
  requiresConfirmation:operation.confirmation==='confirm=true',result:'Studio API v1 operation '+operationId,apiSurface:'studio-v1'};
}

export function planCall(name,argumentsValue={},{idempotencyKey=null,ifMatch=null}={}){
 const {PRO_ACTIONS,DIRECT_TOOLS,KNOWN_GAPS,OPERATIONS}=T();
 const args=copy(argumentsValue||{});
 if(!record(args))throw new AdapterValueError('Studio API arguments must be an object.');
 if(AI_ONLY_TOOLS.has(name))return {kind:'mcp',name,arguments:args,reason:'AI-assistant feature'};
 if(name==='list_pro_capabilities'){
  if(args.action)return {kind:'local',result:capability(args.action)};
  const actions=[...PRO_ACTIONS.keys()].sort();
  return {kind:'local',result:{capabilities:actions.map(capability),capabilityCount:actions.length,apiSurface:'studio-v1'}};
 }
 if(name==='get_pro_state'){
  const projectId=args.project_id;opaque(projectId,'project_id');
  if(Object.keys(args).some(key=>key!=='project_id'&&key!=='track_id'))fail('get_pro_state accepts only project_id and optional track_id.');
  const requests={project:operationRequest('getProject',{project_id:projectId})};
  for(const [key,operation]of Object.entries({lanes:'listLanes',clips:'listClips',patterns:'listPatterns',placements:'listPatternPlacements',buses:'listBuses'}))requests[key]=operationRequest(operation,{project_id:projectId},{allPages:true});
  requests.engine=operationRequest('getEngineState',{project_id:projectId},{contextTrack:args.track_id??null});
  return {kind:'aggregate',project_id:projectId,track_id:args.track_id??null,responseKind:'pro_state',requests};
 }
 if(name==='execute_pro_action'){
  const action=args.action,nested=own(args,'arguments')?args.arguments:{};
  if(typeof action!=='string'||!record(nested))fail('An engine action needs its explicit action name and object arguments.');
  if(AI_ONLY_ACTIONS.has(action))return {kind:'mcp',name,arguments:args,reason:'AI-assistant feature'};
  if(['shift_clip','trim_clip','delete_clip'].includes(action))return batchAction(action,nested,args,idempotencyKey,ifMatch);
  let operationId=PRO_ACTIONS.get(action);
  if(!operationId)throw new UnmappedStudioCall(name,action,KNOWN_GAPS.get(action));
  if(action==='move_clip_to_lane'&&finite(nested.start_ms)&&!Number.isInteger(nested.start_ms))operationId='engine_move_clip_to_lane';
  if(action==='load_bus_plugin')operationId=own(nested,'plugin_id')?'addBusPlugin':'engine_load_bus_plugin';
  if(action==='add_instrument_track'&&own(nested,'instrument_id'))operationId='createInstrumentLane';
  const target=nativeActionArgs(action,nested,operationId);
  if(action==='finalize_recording'&&!own(target,'confirm'))target.confirm=args.confirmed_destructive===true;
  target.project_id=args.project_id;
  if(OPERATIONS[operationId]?.confirmation==='confirm=true'&&args.confirmed_destructive===true&&!own(target,'confirm'))target.confirm=true;
  if(action==='set_bus_gain'&&target.bus_id==='master'){operationId='setMasterGain';delete target.bus_id;}
  return operationRequest(operationId,target,{contextTrack:args.track_id??null,key:idempotencyKey,ifMatch,responseKind:action==='list_tracks'?'tracks_live':null,allPages:['list_patterns','list_pattern_placements'].includes(action)});
 }
 if(name==='transport_control'){
  const command=args.command;delete args.command;
  if(command==='stop'){
   return {kind:'sequence',responseKind:'transport',command,project_id:args.project_id,requests:[operationRequest('pause',args),operationRequest('seek',{...args,seconds:0,play:false})]};
  }
  const operationId={status:'getTransport',play:'play',pause:'pause',seek:'seek',seek_and_play:'seek',play_range:'playRange'}[command];
  if(!operationId)throw new UnmappedStudioCall(name,command,'No Studio API transport command matches this request.');
  if(command==='seek_and_play')args.play=true;
  const request=operationRequest(operationId,args,{key:idempotencyKey,ifMatch,responseKind:'transport'});
  request.command=command;request.project_id=argumentsValue?.project_id;return request;
 }
 let operationId;
 if(name==='get_saved_plugin_state'){
  if(args.lane_id){operationId='getSavedLanePluginState';delete args.track_id;}
  else{operationId='getSavedClipPluginState';targetAlias(args,'track_id','clip_id');}
 }else if(name==='list_automation'&&args.clip_ids!=null){
  const clipIds=args.clip_ids;delete args.clip_ids;
  if(!Array.isArray(clipIds)||!clipIds.length)fail('clip_ids must be a nonempty list of durable clip identities.');
  return {kind:'merge_list',responseKind:'envelopes',requests:clipIds.map(clipId=>operationRequest('listClipAutomation',{...args,clip_id:clipId},{allPages:true}))};
 }else operationId=DIRECT_TOOLS.get(name);
 if(!operationId)throw new UnmappedStudioCall(name,null,KNOWN_GAPS.get(name));
 if(['browse_sounds','browse_marketplace','list_preset_pack_items','list_effect_presets','list_vocal_chain_presets'].includes(name))targetAlias(args,'search','q');
 if(['create_automation','update_automation','delete_automation'].includes(name))for(const [old,next]of Object.entries(AUTOMATION_KEYS))targetAlias(args,old,next);
 const request=operationRequest(operationId,args,{key:idempotencyKey,ifMatch,allPages:['list_buses','list_automation'].includes(name)});
 if(name==='get_project')return {kind:'project',request,responseKind:'project_complete'};
 return request;
}

/** Exact transport call payload (path is its parameter object). */
export function transportPayload(request){
 if(request?.kind!=='request'||!T().OPERATIONS[request.operationId])fail('Only an explicit REST request can be sent to the transport.');
 const result={operationId:request.operationId,path:copy(request.pathParams),query:copy(request.query),body:copy(request.body)};
 if(request.idempotencyKey!=null)result.idempotencyKey=request.idempotencyKey;
 if(request.ifMatch!=null)result.ifMatch=request.ifMatch;
 return result;
}

const etagOf=headers=>headerValue(headers,'etag');
function withMetadata(request,response){
 if(record(response)&&Number.isInteger(response.status)&&own(response,'headers')&&own(response,'data')&&!(response.status>=200&&response.status<300))throw new StudioAPIResponseError(response);
 let data=copy(response?.data);
 if((data===null||data===undefined)&&response?.status>=200&&response.status<300)data={ok:true};
 if(!record(data))fail('Studio API returned no object response.');
 data._studioApi={etag:etagOf(response.headers),projectId:request.resourceProjectId??null,operationId:request.operationId??null};
 return data;
}
// getProject's ETag is "<timeline>.<document hash>" (project_etag) while lane /
// clip / pattern pages carry the bare timeline revision: one snapshot is
// consistent when the TIMELINE component matches (a metadata edit only moves
// the document hash, which does not change the timeline being read).
const timelineTag=tag=>tag==null?tag:String(tag).replace(/^W\//,'').replace(/^"|"$/g,'').replace(/-(?:gzip|zstd|br)$/,'').split('.')[0];
function consistent(expected,observed){if(expected!=null&&timelineTag(expected)!==timelineTag(observed))throw new StudioSnapshotConflict('The project changed while its REST snapshot was loading. Read a fresh snapshot before editing.');}
function snapshotEtag(results){
 const etags=results.map(value=>record(value)?value._studioApi?.etag??null:null),known=etags.filter(etag=>etag!=null);
 if(known.length&&known.length!==etags.length)throw new StudioSnapshotConflict('A canonical REST page omitted its ETag; a consistent snapshot cannot be established.');
 for(const observed of known)consistent(known[0],observed);
 // Prefer a bare timeline tag (it is what lane/clip writes compare against).
 return known.find(tag=>!String(tag).includes('.'))??known[0]??null;
}
const enginePayload=value=>record(value)?(own(value,'response')?value.response:value):value;

async function page(request,send){
 const first=withMetadata(request,await send(copy(request)));
 if(!request.allPages)return first;
 if(!Array.isArray(first.data))fail(`${request.operationId} did not return its declared data page.`);
 const result=copy(first),rows=[...first.data],seen=new Set();let pagination=first.pagination;
 for(let n=0;n<1000;n++){
  if(!record(pagination)||typeof pagination.hasMore!=='boolean')fail('Read a complete cursor page before editing canonical data.');
  if(!pagination.hasMore){
   if(pagination.nextCursor!=null)fail('Freestyle returned conflicting cursor completion metadata.');
   result.data=rows;result.pagination={...pagination,hasMore:false,nextCursor:null};result.total=rows.length;return result;
  }
  const cursor=pagination.nextCursor;if(typeof cursor!=='string'||!cursor||seen.has(cursor))fail('Freestyle returned an invalid or repeated canonical page cursor.');
  seen.add(cursor);
  const follow=copy(request);follow.query.cursor=cursor;
  const data=withMetadata(follow,await send(follow));
  consistent(first._studioApi?.etag,data._studioApi?.etag);
  if(!Array.isArray(data.data))fail('Freestyle returned an incomplete canonical data page.');
  rows.push(...data.data);pagination=data.pagination;
 }
 fail('Canonical pagination exceeded its bounded read budget.');
}
function liveCollection(value,collection){
 const native=record(value)?copy(value):{unavailable:'No native collection returned.'},rows=native[collection];
 if(native.ok===false||native.unavailable||native.error||!Array.isArray(rows))return {...native,live:false,runtime_ids_available:false,source:'studio-v1-engine-state'};
 if(collection==='tracks'){
  const ids=rows.filter(record).map(row=>row.id);
  if(ids.length!==rows.length||ids.some(id=>!Number.isInteger(id)||id<0)||new Set(ids).size!==ids.length)throw new StudioSnapshotConflict('The native engine track read has ambiguous runtime IDs.');
 }
 return {...native,live:true,runtime_ids_available:collection==='tracks',source:'studio-v1-engine-state'};
}
/** Expose known old DTO keys, preserving actual server values unchanged. */
export function adaptResponse(request,payload){
 const kind=request.responseKind||'raw';
 if(kind==='transport'){
  const native=enginePayload(payload);if(!record(native))fail('Studio transport returned no status object.');
  const status=copy(record(native.status)?native.status:native);delete status._studioApi;
  return {project_id:request.project_id||request.resourceProjectId,command:request.command,status,...(record(payload)&&own(payload,'_studioApi')?{_studioApi:copy(payload._studioApi)}:{})};
 }
 if(kind==='tracks_live')return liveCollection(enginePayload(payload),'tracks');
 if(kind==='tracks_saved'){
  if(!record(payload)||!Array.isArray(payload.data))fail('Studio lanes returned no declared data page.');
  const rows=payload.data.map(lane=>({db_track_id:lane.id,label:lane.name,kind:lane.kind,...own(lane,'volume')?{gain:lane.volume}:{},...own(lane,'pan')?{pan:lane.pan}:{},...own(lane,'muted')?{muted:lane.muted}:{},...own(lane,'solo')?{soloed:lane.solo}:{},...own(lane,'busId')?{bus_id:lane.busId}:{}}));
  return {ok:true,tracks:rows,live:false,runtime_ids_available:false,source:'studio-v1-persisted-lanes',...own(payload,'_studioApi')?{_studioApi:copy(payload._studioApi)}:{}};
 }
 if(LIST_KINDS.has(kind)&&record(payload)&&Array.isArray(payload.data)){
  const pagination=copy(payload.pagination||{}),result={ok:true,[kind]:copy(payload.data),pagination};
  if(own(pagination,'nextCursor'))result.nextCursor=pagination.nextCursor;
  if(own(payload,'total'))result.total=payload.total;
  if(own(payload,'_studioApi'))result._studioApi=copy(payload._studioApi);
  return result;
 }
 return copy(payload);
}
function rowsOf(response,collection){if(!record(response)||!Array.isArray(response[collection]))fail(`Freestyle returned no complete ${collection} collection.`);return response[collection];}
const completeScore=content=>record(content?.pattern)&&Array.isArray(content.pattern.sources)&&Array.isArray(content.pattern.events);
/** Detail reads for summary rows run concurrently (the Python bridge read them
 * one by one); every detail still has to carry the snapshot ETag. */
async function completePatterns(rows,projectId,send,expectedEtag=null){
 return Promise.all(rows.map(async row=>{
  let content=record(row)?(own(row,'data')?row.data:row):null;
  if(!completeScore(content)){
   if(!record(row)||typeof row.id!=='string')fail('The canonical pattern list contains no durable identity.');
   const detail=await page(operationRequest('getPattern',{project_id:projectId,pattern_id:row.id}),send);
   consistent(expectedEtag,detail._studioApi?.etag);
   content=enginePayload(detail);
   if(record(content)&&record(content.pattern)&&own(content.pattern,'id'))content=content.pattern;
   if(!record(content)||content.id!==row.id||!completeScore(content))throw new UnmappedStudioCall('get_pro_state',null,'Studio getPattern did not return complete canonical sources/events; editing the summary would lose notes.');
  }
  if((own(content,'projectId')?content.projectId:projectId)!==projectId)fail('Freestyle returned a canonical pattern from another project.');
  content=copy(content);delete content._studioApi;return content;
 }));
}
const PLACEMENT_FIELDS=['offsetMs','loopPhaseMs','loopDurationMs','repeatCount','durationMs','startMs','windowMs','sourceBusOverrides'];
async function completePlacements(rows,projectId,send,expectedEtag=null){
 return Promise.all(rows.map(async row=>{
  if(!record(row)||typeof row.id!=='string')fail('The placement list has no durable identity.');
  const expectedId=row.id;
  if(!PLACEMENT_FIELDS.every(key=>own(row,key))){
   const detail=await page(operationRequest('getPatternPlacement',{project_id:projectId,placement_id:row.id}),send);
   consistent(expectedEtag,detail._studioApi?.etag);
   row=enginePayload(detail);if(record(row)&&record(row.placement))row=row.placement;
   if(!record(row)||row.id!==expectedId||!PLACEMENT_FIELDS.every(key=>own(row,key)))throw new UnmappedStudioCall('get_pro_state',null,'Studio placement detail lacks canonical phase, offset or routing; editing its summary is unsafe.');
  }
  if((own(row,'projectId')?row.projectId:projectId)!==projectId)fail('Freestyle returned a placement from another project.');
  row=copy(row);delete row._studioApi;return row;
 }));
}
async function parallelReads(requests,send){
 if(Object.values(requests).some(request=>request.method!=='GET'))fail('Only independent read operations can use the snapshot pool.');
 const entries=await Promise.all(Object.entries(requests).map(async([key,request])=>[key,await executePlan(request,send)]));
 return Object.fromEntries(entries);
}

/** Execute with send(request)->{status, headers, data}. No mutation retry or MCP transport here. */
export async function executePlan(plan,send){
 const kind=plan?.kind;
 if(kind==='local')return copy(plan.result);
 if(kind==='mcp')fail('AI-only MCP plans belong to the caller; no MCP transport is available in this adapter.');
 if(kind==='request'){
  const raw=await page(plan,send);
  if(['patterns','placements'].includes(plan.responseKind)&&plan.allPages){
   const projectId=plan.resourceProjectId??plan.query?.project_id;
   if(projectId)raw.data=await (plan.responseKind==='patterns'?completePatterns:completePlacements)(raw.data,projectId,send,raw._studioApi?.etag??null);
  }
  return adaptResponse(plan,raw);
 }
 if(kind==='sequence'){let last=null;for(const request of plan.requests)last=await executePlan(request,send);return adaptResponse(plan,last);}
 if(kind==='merge_list'){const rows=[];for(const request of plan.requests)rows.push(...rowsOf(await executePlan(request,send),plan.responseKind));return {ok:true,[plan.responseKind]:rows,nextCursor:null};}
 if(kind==='project'){
  // getProject and the four collections are one parallel phase; every page must
  // still carry getProject's ETag so the snapshot stays a single revision.
  const projectId=plan.request.resourceProjectId;opaque(projectId,'project_id');
  const requests={project:plan.request};
  for(const [collection,operationId]of Object.entries({lanes:'listLanes',clips:'listClips',patterns:'listPatterns',placements:'listPatternPlacements'}))requests[collection]=operationRequest(operationId,{project_id:projectId},{allPages:true});
  const pages=await parallelReads(requests,send),project=pages.project;delete pages.project;
  if(!record(project)||project.id!==projectId)fail('Studio getProject returned no project identity.');
  const expected=project._studioApi?.etag??null;
  for(const [collection,result]of Object.entries(pages)){
   consistent(expected,result._studioApi?.etag??null);
   let rows=rowsOf(result,collection);
   if(collection==='patterns')rows=await completePatterns(rows,projectId,send,expected);
   else if(collection==='placements')rows=await completePlacements(rows,projectId,send,expected);
   project[collection]=rows;
  }
  project.truncated={...(project.truncated||{}),lanes:false,clips:false,patterns:false,placements:false};
  return project;
 }
 if(kind==='aggregate'){
  const data=await parallelReads(plan.requests,send),projectId=plan.project_id;
  const expected=snapshotEtag(['project','lanes','clips','patterns','placements'].map(key=>data[key]));
  if(!record(data.project)||data.project.id!==projectId)fail('Studio state belongs to another project.');
  const lanes=rowsOf(data.lanes,'lanes'),clips=rowsOf(data.clips,'clips');
  const [patterns,placements]=await Promise.all([completePatterns(rowsOf(data.patterns,'patterns'),projectId,send,expected),completePlacements(rowsOf(data.placements,'placements'),projectId,send,expected)]);
  const buses=rowsOf(data.buses,'buses'),engine=enginePayload(data.engine);
  if(!record(engine)||engine.projectId!==projectId)throw new StudioSnapshotConflict('The live engine state belongs to another project. Read a fresh session before continuing.');
  const transport=copy(engine.transport);
  if(!record(transport)||transport.unavailable||transport.ok===false||typeof transport.is_playing!=='boolean'||!finite(transport.position_seconds)||transport.position_seconds<0)throw new StudioSnapshotConflict('The coherent engine read did not return authoritative transport state.');
  for(const value of [engine.session,transport,engine.tracks,engine.clips,engine.buses])if(record(value)&&['projectId','project_id'].some(key=>own(value,key)&&value[key]!==projectId))throw new StudioSnapshotConflict('A live engine subread belongs to another project.');
  const epochs=[transport,engine.tracks,engine.clips,engine.buses].filter(value=>record(value)&&value.session_epoch!=null).map(value=>value.session_epoch);
  if(epochs.some(epoch=>!sameJson(epoch,epochs[0])))throw new StudioSnapshotConflict('The coherent engine state contains conflicting session epochs.');
  const liveTracks=liveCollection(engine.tracks,'tracks'),liveBuses=liveCollection(engine.buses,'buses'),liveClips=liveCollection(engine.clips,'clips');
  const canonical={...data.project,lanes,clips,patterns,placements,truncated:{...(data.project.truncated||{}),lanes:false,clips:false,patterns:false,placements:false}};
  return {...copy(engine),apiSurface:'studio-v1',studioApi:true,_studioApi:{etag:expected,projectId,operationId:'getEngineStateCanonical'},
   project:canonical,transport,patterns:{ok:true,patterns},patternPlacements:{ok:true,placements},tracks:liveTracks,clips:liveClips,buses:liveBuses,
   persistedLanes:lanes,persistedBuses:buses,nativeMixerStateAvailable:liveTracks.live===true&&liveBuses.live===true};
 }
 fail('Unknown Studio API adapter plan kind.');
}
