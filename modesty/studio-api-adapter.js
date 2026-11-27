/** Compatibility DTOs for Modesty's UI over the generated Studio REST client.
 *
 * Browser port of the local bridge's studio_api_adapter.py and
 * studio_api_capabilities.py (plus the native-snapshot validators of
 * studio_api_realtime.py). Names here are local application commands, not
 * outbound MCP tool calls. Native state comes from the typed authoritative
 * Studio API engine-state read.
 */
import {StudioApiError, StudioApiPlanningError, BINARY_OPERATIONS, NON_RETRYING_OPERATIONS, MIX_OPERATIONS, mixEtag, headerOf} from './studio-api-client.js';

const own = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInteger = value => typeof value === 'number' && Number.isInteger(value);
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const clone = value => value === undefined ? undefined : structuredClone(value);
const uuid4 = () => globalThis.crypto.randomUUID();

export class StudioOperationError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message); this.name = 'StudioOperationError';
    this.code = this.error = code; this.detail = message; this.status = status; this.details = details; this.stage = null;
  }
}
export class NativeSnapshotError extends Error {
  constructor(code, message, status = 502) { super(message); this.name = 'NativeSnapshotError'; this.code = code; this.stage = 'realtime'; this.status = status; }
}

/** uuid.uuid5(uuid.NAMESPACE_URL, name) */
const NAMESPACE_URL = Uint8Array.from([0x6b, 0xa7, 0xb8, 0x11, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8]);
export async function uuid5Url(name, {hex = false} = {}) {
  const text = new TextEncoder().encode(name), input = new Uint8Array(16 + text.length);
  input.set(NAMESPACE_URL); input.set(text, 16);
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', input)).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const digits = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return hex ? digits : `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20)}`;
}

class StudioCall {
  constructor(operationId, path = {}, query = {}, body = null, headers = {}, idempotencyKey = null, ifMatch = null) {
    Object.assign(this, {operationId, path, query, body, headers, idempotencyKey, ifMatch});
  }
  kwargs() { return {path: this.path, query: this.query, body: this.body, headers: this.headers, idempotencyKey: this.idempotencyKey, ifMatch: this.ifMatch}; }
}

// Explicit primary aliases resolve the intentionally repeated MCP references
// in the published spec (list vs individual resources; specialized point edits).
export const PRIMARY = Object.freeze({
  list_automation: 'listAutomation', create_automation: 'createAutomationEnvelope',
  update_automation: 'updateAutomationEnvelope', delete_automation: 'deleteAutomationEnvelope',
  get_saved_plugin_state: 'getSavedLanePluginState', get_project: 'getProject',
  create_track: 'createLane', create_empty_lane: 'createLane', rename_track: 'updateLane',
  remove_track: 'deleteLane', set_lane_identity: 'updateLane',
  set_track_gain: 'setLaneGain', set_track_pan: 'setLanePan',
  set_track_muted: 'setLaneMute', set_track_soloed: 'setLaneSolo',
  set_bus_gain: 'setBusGain', set_bus_muted: 'setBusMute', set_bus_soloed: 'setBusSolo',
  get_transport: 'getTransport', get_transport_clock: 'getTransportClock',
  set_transport_loop: 'setLoop', list_patterns: 'listPatterns',
  list_pattern_placements: 'listPatternPlacements', get_pattern: 'getPattern',
  attach_clip_to_session: 'attachClipToSession', set_lane_plugin_parameter: 'setLanePluginParameter',
  set_project_tempo: 'setProjectTempo', live_ingest_offer: 'sendLiveIngestOffer',
  live_ingest_close: 'closeLiveIngest', get_live_status: 'getLiveIngestStatus',
  start_audio_monitor: 'startAudioMonitor', rick_webrtc_offer: 'sendMonitorOffer',
  set_plugin_bypassed: 'setLanePluginBypassed', set_plugin_parameter: 'setLanePluginParameter',
  get_pro_state: 'getEngineState', move_clip_to_lane: 'moveClipToLane',
  copy_lane_effect_chain: 'copyLaneEffectChain', move_lane_plugin: 'moveLanePlugin',
  get_plugin_state: 'listLanePluginParameters', get_bus_plugin_live_state: 'listBusPluginParameters',
  set_bus_plugin_parameter: 'setBusPluginParameter', list_plugin_catalog: 'listPluginCatalog',
  add_lane_plugin: 'addLanePlugin', add_bus_plugin: 'addBusPlugin',
  register_pattern_sample: 'registerPatternSample', materialize_sound_pack_item: 'registerPatternSample',
  // 328-op contract: both plugin deletes share the MCP equivalent. Keep the
  // established slot route; the instance route is deleteLanePluginInstance.
  delete_lane_plugin: 'deleteLanePlugin', delete_lane_plugin_instance: 'deleteLanePluginInstance',
  // 406-op contract: the new dedicated setClipGain (PUT, If-Match) shares the MCP
  // equivalent. The editor's clip-gain write keeps the route it was verified on;
  // call setClipGain by its own name to use the revision-guarded route.
  set_clip_gain: 'engine_set_clip_gain',
});
const AI_COMMANDS = new Set(['mozart_ai_command', 'get_mozart_ai_job', 'undo_last_ai_action']);
export const AI_NAMES = new Set(['mozart_ai_command', 'mozart_ai_chat_history', 'get_mozart_ai_job', 'undo_last_ai_action']);
const LIST_OUTPUTS = Object.freeze({listPatterns: 'patterns', listPatternPlacements: 'placements', listBuses: 'buses', listProjectSaves: 'saves'});
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const EDITOR_OPERATIONS = new Set(['getPluginEditorFrame', ...NON_RETRYING_OPERATIONS]);
const EDITOR_FRAME_HEADERS = [['etag', 'etag'], ['revision', 'x-editor-revision'], ['width', 'x-editor-width'], ['height', 'x-editor-height'],
  ['pluginInstanceId', 'x-editor-plugin-instance-id'], ['pluginType', 'x-editor-plugin-type'], ['contentType', 'content-type']];
// API305 move renamed clips; retested live 2026-11-09. The exact published dedicated route is still required.
const CROSS_TRACK_PASTE_ROLLOUT = true;

const retryAfterOf = error => {
  const value = headerOf(error.headers || {}, 'retry-after');
  if (value == null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : null;
};

/** Type plugin-editor failures: 429 rate limit and the no-open-editor quirk. */
function editorError(operationId, error) {
  const upstream = error.code, status = error.status;
  const details = isObject(error.details) ? {...error.details} : (error.details == null ? {} : {upstreamDetails: error.details});
  Object.assign(details, {upstreamCode: upstream, upstreamStatus: status, operationId, retryable: NON_RETRYING_OPERATIONS.has(operationId) ? false : status === 429});
  if (status === 429) { error.code = 'editor_rate_limited'; details.retryAfterSec = retryAfterOf(error); }
  else if (upstream === 'editor_not_open' || (operationId === 'getPluginEditorFrame' && status === 400 && upstream === 'engine_invalid_arguments')) { error.code = 'editor_not_open'; error.status = 409; }
  error.details = details;
  return error;
}

// Typed engine/editor error codes (328-op contract). None is retried here; an
// unknown outcome (engine_timeout) must be verified by a read, not repeated.
export const TYPED_ERRORS = Object.freeze({
  lane_has_no_live_chain: {category: 'engine_state', action: 'reload_engine_or_sync_lane'},
  engine_divergent: {category: 'engine_state', action: 'reload_engine'},
  input_unconfirmed: {category: 'editor_input', action: 'none'},
  not_hit_testable: {category: 'editor_input', action: 'none'},
  no_editor_view: {category: 'editor_input', action: 'open_editor'},
  editor_not_open: {category: 'editor_state', action: 'open_editor'},
  plugin_instance_not_found: {category: 'plugin_state', action: 'reread_chain'},
  engine_timeout: {category: 'outcome_unknown', action: 'poll_engine_state'},
  recording_in_progress: {category: 'engine_state', action: 'wait'},
  studio_busy_on_other_project: {category: 'engine_state', action: 'wait'},
  // 338-op contract: typed 503s. Back off for Retry-After before a NEW user action.
  engine_session_contended: {category: 'engine_unavailable', action: 'backoff', backoff: true},
  engine_session_not_found: {category: 'engine_unavailable', action: 'backoff', backoff: true},
  engine_restarting: {category: 'engine_unavailable', action: 'backoff', backoff: true},
  render_busy: {category: 'engine_unavailable', action: 'backoff', backoff: true},
  restore_state_invalid: {category: 'plugin_state', action: 'reread_chain'},
});

/** Typed description of a failed in-place swap (job body or error details). */
export function engineSwapFailure(data) {
  let rolledBack = data.rolled_back;
  if (rolledBack == null && isObject(data.details)) rolledBack = data.details.rolled_back;
  let engineStatus = data.engine_status;
  if (engineStatus == null && isObject(data.details)) engineStatus = data.details.engine_status;
  const definite = rolledBack === true;
  return {typed: 'engine_swap_failed', category: 'engine_swap', engineStatus: engineStatus ?? null, rolledBack: rolledBack ?? null, definiteRejection: definite,
    committed: definite ? false : null, retryable: definite, retryKey: definite ? 'same' : null, action: definite ? 'retry_same_key' : 'reload_engine'};
}

function typedError(error) {
  if (error.code === 'engine_swap_failed') {
    const details = isObject(error.details) ? {...error.details} : {};
    Object.assign(details, engineSwapFailure({details}), {upstreamStatus: error.status});
    error.details = details;
    return error;
  }
  const kind = TYPED_ERRORS[error.code];
  if (kind) {
    const details = isObject(error.details) ? {...error.details} : (error.details == null ? {} : {upstreamDetails: error.details});
    Object.assign(details, kind, {retryable: false, typed: error.code});
    if (kind.backoff) {
      details.retryAfterSec = retryAfterOf(error);
      if (!own(details, 'engineReason')) details.engineReason = null;
      details.upstreamStatus = error.status;
    }
    error.details = details;
  }
  return error;
}

const CONFLICT_CODES = Object.freeze({mix_revision_conflict: 'currentMixRevision', plugin_parameter_conflict: 'currentValueNorm'});
const MIX_WAIT_LIMIT = 2;
const MIX_WAITS = {count: 0};

/** 412 mix_revision_conflict / plugin_parameter_conflict: typed, never retried. */
function conflictError(error) {
  const details = isObject(error.details) ? {...error.details} : {};
  const currentKey = CONFLICT_CODES[error.code];
  let current = details[currentKey];
  if (current == null && isObject(error.data)) {
    const envelope = isObject(error.data.error) ? error.data.error : {};
    current = envelope[currentKey] ?? error.data[currentKey];
  }
  Object.assign(details, {retryable: false, conflict: error.code, current: current ?? null});
  if (current != null) details[currentKey] = current;
  if (error.code === 'mix_revision_conflict' && isInteger(current)) details.currentEtag = mixEtag(current);
  error.details = details;
  return error;
}

/** Mix reads/writes return their body plus the mix ETag; a mix:wait 304 is the normal unchanged result. */
export function mixResult(operationId, response) {
  const tagValue = headerOf(response.headers || {}, 'etag');
  const tag = tagValue == null ? null : String(tagValue);
  if (response.status === 304 && operationId === 'waitEngineMix') return {unchanged: true, etag: tag, mixRevision: null};
  const data = isObject(response.data) ? clone(response.data) : {response: clone(response.data)};
  let revision = data.mixRevision;
  if (revision == null && isObject(data.response)) revision = data.response.mix_revision;
  if (revision == null && tag) { const match = /^(?:W\/)?"?mix-(\d+)"?$/.exec(tag); revision = match ? Number(match[1]) : null; }
  const result = {...data, etag: own(data, 'etag') ? data.etag : tag, mixRevision: revision ?? null};
  if (operationId === 'getEngineMix' || operationId === 'waitEngineMix') result.unchanged = response.status === 304;
  return result;
}

/** A frame read as a typed value; 304 is a normal unchanged result. */
export function editorFrameResult(response) {
  const header = name => { const value = headerOf(response.headers || {}, name); return value == null ? null : String(value); };
  const result = Object.fromEntries(EDITOR_FRAME_HEADERS.map(([key, name]) => [key, header(name)]));
  for (const key of ['width', 'height']) { const parsed = result[key] == null ? null : Number.parseInt(result[key], 10); result[key] = Number.isFinite(parsed) && /^\s*[+-]?\d+\s*$/.test(result[key]) ? parsed : null; }
  result.revision = result.revision || (result.etag ? result.etag.replace(/^"+|"+$/g, '') : null);
  const unchanged = response.status === 304;
  if (!unchanged && !(response.data instanceof Uint8Array)) throw new StudioOperationError('invalid_editor_frame', 'Freestyle returned no image bytes for the editor frame.', 502);
  return {...result, status: response.status, unchanged, bytes: unchanged ? null : response.data};
}

const snake = value => value.replace(/[A-Z]/g, (letter, index) => (index ? '_' : '') + letter).toLowerCase();

function opaque(value, label) {
  if (typeof value !== 'string' || !value || value.length > 128) throw new StudioOperationError('studio_identity_required', `A durable ${label} is required for Studio API editing.`);
  return value;
}

function schemaOf(spec, value) {
  while (isObject(value) && own(value, '$ref')) {
    const key = value.$ref;
    if (typeof key !== 'string' || !key.startsWith('#/')) throw new StudioOperationError('studio_schema_reference', 'External schema references are not supported.');
    value = spec;
    for (const part of key.slice(2).split('/')) value = value?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  return value || {};
}
const bodySchema = (spec, operation) => schemaOf(spec, operation?.requestBody?.content?.['application/json']?.schema ?? {});

// ------------------------------------------------------------- native snapshot (studio_api_realtime.py)

function completeContainer(container, name, allowUnavailable = false) {
  const marked = value => {
    if (value == null || value === false || value === 0 || value === '') return false;
    if (isObject(value)) return Object.values(value).some(marked);
    return true;
  };
  const visit = value => {
    if (isObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        const lower = String(key).toLowerCase();
        if ((lower.startsWith('_truncated') || lower === 'truncated' || lower.endsWith('truncated')) && marked(child)) throw new NativeSnapshotError('incomplete_native_snapshot', `Studio API returned truncated native ${name}.`);
        visit(child);
      }
    } else if (Array.isArray(value)) value.forEach(visit);
  };
  visit(container);
  if (isObject(container) && (container.ok === false || container.error)) throw new NativeSnapshotError('incomplete_native_snapshot', `Studio API returned no complete native ${name}.`);
  if (isObject(container) && container.unavailable) {
    if (allowUnavailable) return false;
    throw new NativeSnapshotError('native_state_unavailable', `The project live engine has no available native ${name} snapshot.`, 503);
  }
  const rows = Array.isArray(container) ? container : isObject(container) ? container[name] : null;
  if (!Array.isArray(rows)) throw new NativeSnapshotError('incomplete_native_snapshot', `Studio API returned no complete native ${name}.`);
  return true;
}

export function snapshotState(frame, projectId) {
  const value = frame.state;
  if (!isObject(value) || value.error || value.ok === false) throw new NativeSnapshotError('invalid_native_snapshot', 'Studio API returned no valid native state snapshot.');
  const session = value.session || {};
  if (!isObject(session) || ['projectId', 'project_id'].some(key => session[key] != null && session[key] !== projectId)) throw new NativeSnapshotError('foreign_native_snapshot', 'The native snapshot belongs to another project.');
  // Only authoritative audio membership must be complete for import/deletion/history guards.
  const available = ['tracks', 'clips'].map(name => completeContainer(value[name], name, true));
  if (!available.every(Boolean)) throw new NativeSnapshotError('native_state_unavailable', 'The project live engine has no available native audio snapshot.', 503);
  return clone(value);
}

// ------------------------------------------------------------- capabilities (studio_api_capabilities.py)

export function resolveSchema(spec, value, ancestors = []) {
  if (Array.isArray(value)) return value.map(item => resolveSchema(spec, item, ancestors));
  if (!isObject(value)) return value;
  if (own(value, '$ref')) {
    const ref = value.$ref;
    if (typeof ref !== 'string' || !ref.startsWith('#/') || ancestors.includes(ref)) return clone(value);
    let target = spec;
    for (const part of ref.slice(2).split('/')) target = target?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
    const rest = {...value}; delete rest.$ref;
    return resolveSchema(spec, {...target, ...rest}, [...ancestors, ref]);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveSchema(spec, child, ancestors)]));
}

export function studioTools(adapter, aiDescriptors = []) {
  const spec = adapter.spec, result = [], aliases = {...adapter.aliases};
  const native = adapter.operations.getEngineState;
  if (native && String(native[0]).toUpperCase() === 'GET' && native[1] === '/projects/{project_id}/engine/state') aliases.get_pro_state = 'getEngineState';
  for (const name of Object.keys(aliases).sort()) {
    const operationId = aliases[name];
    if (AI_NAMES.has(name) || ['mozartAiCommand', 'getMozartAiJob', 'undoLastAiAction'].includes(operationId)) continue;
    if (!own(adapter.operations, operationId)) continue;
    const [method, , operation] = adapter.operations[operationId];
    const body = resolveSchema(spec, operation?.requestBody?.content?.['application/json']?.schema ?? {});
    const properties = clone(body.properties || {}), required = [...(body.required || [])];
    for (const raw of operation.parameters || []) {
      const parameter = resolveSchema(spec, raw);
      if (parameter.in === 'header') continue;
      properties[parameter.name] = clone(parameter.schema || {});
      if (parameter.required) required.push(parameter.name);
    }
    properties.idempotency_key = {type: 'string', minLength: 8, maxLength: 128, description: 'Retained identity for this user operation; sent as Idempotency-Key.'};
    properties.if_match = {type: 'string', description: 'Captured resource ETag; a stale edit returns HTTP 412.'};
    // The local controller uses snake-case names; the adapter maps them to the documented JSON names.
    if (['create_automation', 'update_automation', 'delete_automation'].includes(name))
      for (const [wire, local] of [['defaultValue', 'default_value'], ['valueType', 'value_type']]) if (own(properties, wire)) properties[local] = clone(properties[wire]);
    result.push({name, title: operation.summary || name, description: operation.description || '',
      inputSchema: {type: 'object', properties, required: [...new Set(required)], additionalProperties: false},
      annotations: {readOnlyHint: method === 'get', destructiveHint: method === 'delete', idempotentHint: method === 'get'},
      schemaSource: 'studio-openapi', operationId, transport: 'studio-api-v1', parameters: clone(operation.parameters || [])});
  }
  if (!result.some(tool => tool.name === 'get_pro_state'))
    result.push({name: 'get_pro_state', title: 'Read native session snapshot', description: 'Authoritative native tracks, clips, readiness and transport through a REST-ticket-backed read-only realtime session.', schemaSource: 'studio-openapi-realtime', transport: 'studio-api-v1', inputSchema: {type: 'object', properties: {project_id: {type: 'string'}, track_id: {type: 'string'}}, required: ['project_id']}, annotations: {readOnlyHint: true}});
  for (const tool of aiDescriptors) if (AI_NAMES.has(tool?.name)) result.push({...clone(tool), schemaSource: 'mcp-ai', transport: 'mcp-ai'});
  return result;
}

export function studioFeatures(adapter, {pluginEditorFrame = 'modesty-bridge:/editor/frame'} = {}) {
  const spec = adapter.spec || {}, ops = adapter.operations;
  const [nativeMethod, nativePath] = ops.getEngineState || [];
  const nativeRest = String(nativeMethod).toUpperCase() === 'GET' && nativePath === '/projects/{project_id}/engine/state';
  const [moveMethod, movePath, move] = ops.moveClipToLane || [null, null, {}];
  const moveBody = resolveSchema(spec, move?.requestBody?.content?.['application/json']?.schema ?? {});
  const moveRest = String(moveMethod).toUpperCase() === 'POST' && movePath === '/projects/{project_id}/clips/{clip_id}:move-to-lane'
    && moveBody.properties?.lane_id?.type === 'string' && (moveBody.required || []).includes('lane_id');
  const [waveformMethod, waveformPath, waveform] = ops.getClipWaveform || [null, null, {}];
  const independent = String(waveformMethod).toUpperCase() === 'GET' && waveformPath === '/projects/{project_id}/clips/{clip_id}/waveform';
  const bucketParameter = (waveform?.parameters || []).find(parameter => parameter?.name === 'buckets');
  const limit = bucketParameter ? (bucketParameter.schema?.maximum ?? null) : 100;
  const regionMode = resolveSchema(spec, ops.applyRegionEffect?.[2]?.requestBody?.content?.['application/json']?.schema ?? {}).properties?.mode?.enum || [];
  const addLane = ops.addLanePlugin ? resolveSchema(spec, ops.addLanePlugin[2]?.requestBody?.content?.['application/json']?.schema ?? {}).properties || {} : {};
  return {crossTrackPaste: CROSS_TRACK_PASTE_ROLLOUT === true && moveRest,
    waveformMaxBuckets: limit, waveformIndependentOfNative: independent, nativeState: nativeRest ? 'studio-api-v1' : 'rest-ticket-realtime',
    deterministicTransport: 'studio-api-v1',
    // Plugin editor mirror: raw JPEG frames via the bridged frame route; input via the
    // editor data channel or /api/call (sent once, never retried).
    pluginEditorFrame: own(ops, 'getPluginEditorFrame') ? pluginEditorFrame : null,
    pluginEditorInput: ['sendPluginEditorPointer', 'sendPluginEditorScroll', 'sendPluginEditorKeys'].every(op => own(ops, op)),
    // Agent-safe mixing (318-op contract).
    mixRevision: ['getEngineMix', 'applyEngineMix'].every(op => own(ops, op)),
    mixWait: own(ops, 'waitEngineMix'),
    // 328-op contract.
    laneEq: ['getLaneEq', 'setLaneEqBand'].every(op => own(ops, op)),
    pluginDeleteByInstance: own(ops, 'deleteLanePluginInstance'),
    engineReload: own(ops, 'reloadEngineSession'),
    // 338-op contract.
    regionEffectInPlace: regionMode.includes('in_place'),
    pluginRestore: own(ops, 'addLanePlugin') && own(addLane, 'state'),
    busPan: own(ops, 'setBusPan'), masterPan: own(ops, 'setMasterPan')};
}

// ------------------------------------------------------------- adapter

export class StudioApiAdapter {
  constructor(client, {spec}) {
    if (!spec) throw new Error('The Studio OpenAPI document is required.');
    this.client = client; this.spec = spec; this.operations = {}; this.aliases = {...PRIMARY};
    const alias = (name, operationId, path) => {
      const current = this.aliases[name];
      if (own(PRIMARY, name)) return;
      // Generated engine gateways repeat dedicated MCP equivalents but have
      // different inferred schemas. Keep dedicated resource routes authoritative.
      const previous = current ? this.operations[current] : null;
      if (current === undefined || (previous && previous[1].includes('/engine/actions/') && !path.includes('/engine/actions/'))) this.aliases[name] = operationId;
    };
    for (const [path, methods] of Object.entries(spec.paths || {})) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!METHODS.has(method)) continue;
        const op = operation.operationId;
        this.operations[op] = [method, path, operation];
        alias(op, op, path);
        alias(snake(op), op, path);
        const equivalent = operation['x-freestyle-mcp-equivalent'] || '';
        if (/^[a-z][a-z0-9_]+$/.test(equivalent)) alias(equivalent, op, path);
        for (const match of String(equivalent).matchAll(/execute_pro_action\(([a-z0-9_]+)\)/g)) alias(match[1], op, path);
      }
    }
  }

  arguments_(name, argumentsValue) {
    if (!isObject(argumentsValue)) throw new StudioOperationError('invalid_arguments', 'Studio UI arguments must be an object.');
    const args = clone(argumentsValue);
    if (name === 'execute_pro_action') {
      name = args.action ?? null; delete args.action;
      const nested = own(args, 'arguments') ? args.arguments : {}; delete args.arguments;
      if (!isObject(nested)) throw new StudioOperationError('invalid_arguments', 'Action arguments must be an object.');
      delete args.confirmed_destructive;
      if (own(nested, 'project_id') && args.project_id != null && nested.project_id !== args.project_id) throw new StudioOperationError('studio_scope_mismatch', 'The action belongs to another project than its captured editor context.');
      Object.assign(args, nested);
    }
    if (typeof name !== 'string') throw new StudioOperationError('invalid_operation', 'Choose a Studio UI operation.');
    return [name, args];
  }

  request(operationId, argumentsValue) {
    const [, , operation] = this.operations[operationId];
    const args = clone(argumentsValue);
    const metadata = own(args, '_studio') ? args._studio : {}; delete args._studio;
    if (!isObject(metadata)) throw new StudioOperationError('invalid_arguments', 'Studio transport metadata must be an object.');
    const pop = (key, fallback = null) => { if (!own(args, key)) return fallback; const value = args[key]; delete args[key]; return value; };
    const idem = metadata.idempotency_key || pop('idempotency_key', pop('idempotencyKey'));
    const match = metadata.if_match || pop('if_match', pop('ifMatch'));
    const path = {}, query = {}, headers = {};
    for (const raw of operation.parameters || []) {
      const parameter = schemaOf(this.spec, raw), key = parameter.name, where = parameter.in;
      if (where === 'path') {
        const value = pop(key);
        const schema = schemaOf(this.spec, parameter.schema || {});
        if (schema.type === 'integer') {
          if (!isInteger(value)) throw new StudioOperationError('studio_identity_required', `An integer ${key} is required.`);
          path[key] = value;
        } else path[key] = opaque(value, key);
      } else if (where === 'query' && own(args, key)) query[key] = pop(key);
      else if (where === 'header' && own(args, key)) headers[key] = pop(key);
    }
    const properties = bodySchema(this.spec, operation).properties || {};
    const body = own(operation, 'requestBody') ? Object.fromEntries(Object.entries(args).filter(([key]) => own(properties, key))) : null;
    return new StudioCall(operationId, path, query, body, headers, idem ?? null, match ?? null);
  }

  async resolve(name, argumentsValue) {
    let args;
    [name, args] = this.arguments_(name, argumentsValue);
    if (AI_COMMANDS.has(name)) throw new StudioOperationError('ai_operation_requires_mcp', 'AI assistant commands use MCP, not the deterministic Studio adapter.');
    if (name === 'get_pro_state') {
      if (!own(this.operations, 'getEngineState')) throw new StudioOperationError('studio_operation_unsupported', 'The typed engine-state REST read is not published in this contract.', 503);
      if (args.track_id != null) {
        if (args.scope_track_id != null && args.scope_track_id !== args.track_id) throw new StudioOperationError('studio_scope_mismatch', 'The engine-state read has conflicting audio contexts.');
        args.scope_track_id = args.track_id; delete args.track_id;
      }
      return [this.request('getEngineState', args)];
    }
    if (name === 'transport_control') {
      let command = own(args, 'action') ? args.action : args.command; delete args.action; delete args.command;
      if (command === 'status') return [this.request('getTransport', args)];
      if (['play', 'pause', 'seek', 'play_range', 'seek_and_play'].includes(command)) {
        const operation = {play: 'play', pause: 'pause', seek: 'seek', play_range: 'playRange', seek_and_play: 'seek'}[command];
        if (command === 'seek_and_play') args.play = true;
        return [this.request(operation, args)];
      }
      if (command === 'stop') {
        // There is no stop endpoint: pause then seek to the start, without
        // replaying either write after an ambiguous acknowledgement.
        const meta = own(args, '_studio') ? args._studio : {}; delete args._studio;
        let base = meta.idempotency_key || (own(args, 'idempotency_key') ? args.idempotency_key : null); delete args.idempotency_key;
        base ||= uuid4();
        const [pauseKey, seekKey] = await Promise.all([uuid5Url(base + ':pause'), uuid5Url(base + ':seek')]);
        return [this.request('pause', {...args, _studio: {...meta, idempotency_key: pauseKey}}),
          this.request('seek', {...args, seconds: 0, play: false, _studio: {...meta, idempotency_key: seekKey}})];
      }
      throw new StudioOperationError('studio_operation_unsupported', 'This transport command has no documented Studio API route.');
    }
    if (['shift_clip', 'trim_clip', 'delete_clip', 'copy_append_clip', 'split_clip'].includes(name)) {
      const clipId = (own(args, 'clip_id') ? args.clip_id : null) || args.track_id; delete args.clip_id;
      opaque(clipId, 'clip id');
      if (name === 'split_clip') throw new StudioOperationError('studio_split_requires_lane', 'Use the atomic time-range split with durable selected lane ids.');
      let op = {op: name === 'delete_clip' ? 'remove' : 'update', id: clipId};
      if (name === 'copy_append_clip') {
        const retainedKey = args.idempotency_key || args.idempotencyKey || args._studio?.idempotency_key;
        let child = own(args, 'child_id') ? args.child_id : null; delete args.child_id;
        if (child == null) child = retainedKey ? await uuid5Url(`modesty-copy:${pyStr(args.project_id)}:${clipId}:${retainedKey}`, {hex: true}) : uuid4().replaceAll('-', '');
        op = {op: 'insert', id: child, source_id: clipId};
      }
      for (const field of ['start_ms', 'duration_sec', 'audio_offset_sec', 'expected']) if (own(args, field)) { op[field] = args[field]; delete args[field]; }
      if (name === 'copy_append_clip' && !['start_ms', 'duration_sec', 'audio_offset_sec'].every(field => own(op, field))) throw new StudioOperationError('studio_copy_requires_source_geometry', 'Copy needs the captured source duration and offset for an atomic Studio clip insert.');
      return [this.request('applyClipBatch', {...args, ops: [op]})];
    }
    if (name === 'move_clip_to_lane') {
      const operation = Object.entries(this.operations).find(([, [, path]]) => path === '/projects/{project_id}/clips/{clip_id}:move-to-lane')?.[0];
      if (operation) return [this.request(operation, args)];
      throw new StudioOperationError('studio_operation_pending', 'The documented move-to-lane REST route has not appeared in the live OpenAPI contract yet. No MCP fallback was used.', 503);
    }
    if (name === 'set_clip_appearance') throw new StudioOperationError('studio_operation_unsupported', 'Studio API v1 does not publish this audio-clip field mutation. No MCP fallback was used.');
    if (name === 'set_bus_gain' && args.bus_id === 'master') { delete args.bus_id; return [this.request('setMasterGain', args)]; }
    let op = this.aliases[name];
    if (!op) throw new StudioOperationError('studio_operation_unsupported', `No documented Studio API route for '${name}'. No MCP fallback was used.`);
    if (op === 'browseCatalogSounds' && own(args, 'search')) {
      const search = args.search; delete args.search;
      if (own(args, 'q') && args.q !== search) throw new StudioOperationError('invalid_arguments', 'The sound search has conflicting search and q filters.');
      args.q = search;
    }
    if (op === 'setLanePluginParameter' || op === 'setBusPluginParameter') {
      const forms = ['value_norm', 'value'].filter(key => own(args, key));
      if (forms.length !== 1) throw new StudioOperationError('invalid_parameter_form', 'Send exactly one parameter value: value_norm or value.');
      const properties = bodySchema(this.spec, this.operations[op][2]).properties || {};
      if (!own(properties, forms[0])) throw new StudioOperationError('unsupported_parameter_form', 'This published parameter endpoint accepts normalized value_norm only.');
    }
    if (op === 'addLanePlugin' || op === 'addBusPlugin') {
      if (['path', 'vst_path', 'plugin_path'].some(key => own(args, key))) throw new StudioOperationError('catalog_plugin_required', 'Add plug-ins using an id from the live plug-in catalog.');
      const pluginId = opaque(args.plugin_id, 'catalog plugin id');
      if (/[/\\]/.test(pluginId) || [...pluginId].some(c => c.charCodeAt(0) < 32)) throw new StudioOperationError('catalog_plugin_required', 'Host file paths cannot identify a catalog plug-in.');
    }
    if ((op === 'setLaneEqBand' || op === 'setPatternPlacementEqBand') && own(args, 'band')) {
      let band = args.band;
      if (typeof band === 'string' && /^\d+$/.test(band)) band = Number.parseInt(band, 10);
      if (!isInteger(band) || band < 0 || band > 7) throw new StudioOperationError('invalid_eq_band', 'EQ band must be an integer from 0 to 7.');
      args.band = String(band);
    }
    if (op === 'moveLanePlugin' && own(args, 'instance_id')) {
      const instanceId = args.instance_id; delete args.instance_id;
      if ((own(args, 'expected_plugin_instance_id') ? args.expected_plugin_instance_id : instanceId) !== instanceId) throw new StudioOperationError('studio_scope_mismatch', 'The captured plug-in instance guards disagree.');
      args.expected_plugin_instance_id = instanceId;
    }
    if (op === 'registerPatternSample') {
      const selectors = ['track_id', 'audio_file_id', 'preset_pack_item_id', 'sound_pack_item_id', 'catalog_sound_id'];
      const handle = own(args, 'register') ? args.register : null; delete args.register;
      if (handle != null) {
        if (!isObject(handle) || Object.keys(handle).length !== 1 || !Object.keys(handle).every(key => selectors.includes(key))) throw new StudioOperationError('invalid_sample_source', "Use the catalog row's one-source registration handle.");
        for (const [key, value] of Object.entries(handle)) {
          if (own(args, key) && args[key] !== value) throw new StudioOperationError('invalid_sample_source', 'The selected sample registration handles disagree.');
          args[key] = value;
        }
      }
      const present = selectors.filter(key => own(args, key));
      if (present.length !== 1) throw new StudioOperationError('invalid_sample_source', "Use the catalog row's register handle or one explicit persisted audio or catalog source.");
      opaque(args[present[0]], 'sample source id');
    }
    // Legacy UI field names are translated only where the REST convention is explicit.
    if (op === 'createLane' || op === 'updateLane') {
      if (!own(args, 'name')) args.name = args.label ?? null;
      if (args.name == null) delete args.name;
    }
    if (op === 'getSavedLanePluginState' && (args.clip_id || (args.track_id && !args.lane_id))) {
      op = 'getSavedClipPluginState';
      if (!own(args, 'clip_id')) args.clip_id = args.track_id ?? null;
    }
    if (this.operations[op][1].includes('{lane_id}') && !own(args, 'lane_id')) args.lane_id = args.track_id ?? null;
    if (op === 'attachClipToSession' && !own(args, 'clip_id')) args.clip_id = args.db_track_id ?? null;
    if (['createAutomationEnvelope', 'updateAutomationEnvelope', 'deleteAutomationEnvelope'].includes(op))
      for (const [old, wire] of [['default_value', 'defaultValue'], ['value_type', 'valueType'], ['expected_revision', 'expectedRevision']]) if (own(args, old)) { args[wire] = args[old]; delete args[old]; }
    // setLanePan persist=false is the public sweep form ("persist=false while sweeping, then a final call
    // without it"): it passes through like setLaneGain / setMasterGain, but only as a real boolean.
    if (op === 'setLanePan' && own(args, 'persist') && typeof args.persist !== 'boolean') throw new StudioOperationError('invalid_arguments', 'Lane pan persist must be true or false.');
    if (op === 'setLoop') for (const [old, wire] of [['loop_enabled', 'enabled'], ['loop_start_sec', 'start_sec'], ['loop_end_sec', 'end_sec']]) if (own(args, old)) { args[wire] = args[old]; delete args[old]; }
    if ((op === 'getSavedLanePluginState' || op === 'getSavedClipPluginState') && (args.clip_id || (args.track_id && !args.lane_id))) {
      op = 'getSavedClipPluginState';
      if (!own(args, 'clip_id')) args.clip_id = args.track_id ?? null;
    }
    return [this.request(op, args)];
  }

  async editorFrame(argumentsValue, ctx = {}) {
    const calls = await this.resolve('getPluginEditorFrame', argumentsValue);
    return editorFrameResult(await this.execute(calls[0], ctx));
  }

  async execute(call, ctx = {}) {
    ctx.etag = null;
    const response = await this.executeInner(call, ctx);
    const tag = headerOf(response?.headers || {}, 'etag');
    ctx.etag = tag == null ? null : String(tag);
    const data = response?.data;
    if ((call.operationId === 'applyRegionEffect' || call.operationId === 'getRegionEffectJob') && isObject(data)
        && data.status === 'failed' && data.code === 'engine_swap_failed' && !own(data, 'typedError'))
      // A failed job is a 200 job resource: add the typed description without altering any published field.
      response.data = {...data, typedError: engineSwapFailure(data)};
    if (call.operationId === 'applyRegionEffect' && isObject(data) && data.mode === 'in_place' && data.status === 'done'
        && typeof data.revision === 'string' && data.revision && isObject(call.path) && call.path.clip_id) {
      // In-place writes a new source version of the same clip; its undo is
      // sample-edits:undo with If-Match = revision.
      try { this.client.seedEtag('undoClipSampleEdit', data.revision, {path: {project_id: call.path.project_id, clip_id: call.path.clip_id}}); } catch {}
    }
    return response;
  }

  /** A write bumped the timeline without returning its revision: read the project once before the next guarded timeline write. */
  async refreshStaleTimeline(call, ctx) {
    const project = isObject(call.path) ? call.path.project_id : null;
    if (!project || !this.client.timelineStale(project) || call.ifMatch != null) return;
    if (Object.keys(call.headers || {}).some(key => key.toLowerCase() === 'if-match')) return;
    if (!['post', 'put', 'patch', 'delete'].includes(this.operations[call.operationId][0])) return;
    const domain = this.client.revisionDomain(call.operationId, call.path, call.body);
    if (!domain || domain[0] !== 'timeline' || domain[1] !== project) return;
    if (isObject(call.body) && call.body.expected_revision != null) return;
    await this.client.call('getProject', {path: {project_id: project}, useEtag: false, signal: ctx.signal});
  }

  async executeInner(call, ctx) {
    const signal = ctx.signal;
    if (call.operationId === 'waitEngineMix') {
      if (MIX_WAITS.count >= MIX_WAIT_LIMIT) throw new StudioOperationError('mix_wait_limit', 'At most two mix waits may be in flight; reuse the pending wait.', 429);
      MIX_WAITS.count++;
      try { return await this.client.call(call.operationId, {...call.kwargs(), signal}); }
      finally { MIX_WAITS.count--; }
    }
    if (EDITOR_OPERATIONS.has(call.operationId)) {
      let response;
      try { response = await this.client.call(call.operationId, {...call.kwargs(), signal}); }
      catch (error) { if (error instanceof StudioApiError) throw typedError(editorError(call.operationId, error)); throw error; }
      // Live input is confirmed by effect: ok:false is a typed, non-retried result.
      const data = response.data;
      if (NON_RETRYING_OPERATIONS.has(call.operationId) && isObject(data) && data.ok === false) {
        const code = typeof data.code === 'string' ? data.code : 'input_unconfirmed';
        const details = {...(TYPED_ERRORS[code] || TYPED_ERRORS.input_unconfirmed), retryable: false, typed: code, delivered: true, operationId: call.operationId, result: clone(data)};
        throw new StudioOperationError(code, data.message || 'The plugin editor did not confirm this input.', 409, details);
      }
      return response;
    }
    const kwargs = {...call.kwargs(), signal};
    // Source ETags do not validate placement-bearing waveform bodies.
    if (call.operationId === 'getClipWaveform') kwargs.useEtag = false;
    if (call.operationId === 'moveClipToLane') {
      const expected = call.body?.expected;
      if (!isObject(expected) || !['lane_id', 'start_ms'].some(key => own(expected, key))) kwargs.requireRevision = true;
    }
    await this.refreshStaleTimeline(call, ctx);
    try { return await this.client.call(call.operationId, kwargs); }
    catch (error) {
      if (!(error instanceof StudioApiError)) throw error;
      if (error.status === 412 && own(CONFLICT_CODES, error.code)) throw conflictError(error);
      throw typedError(error);
    }
  }

  static nativeState(value, projectId) {
    if (!isObject(value) || value.projectId !== projectId) throw new StudioOperationError('foreign_native_snapshot', 'The engine state belongs to another project.', 502);
    let state;
    try { state = snapshotState({state: value}, projectId); }
    catch (error) { if (error instanceof NativeSnapshotError) throw new StudioOperationError(error.code, error.message, error.status); throw error; }
    const tracks = Array.isArray(state.tracks) ? state.tracks : state.tracks.tracks;
    const clips = Array.isArray(state.clips) ? state.clips : state.clips.clips;
    const runtimeTracks = new Map(), durableTracks = new Set(), clipIds = new Set(), durableClips = new Set();
    const nonNegativeInt = value => isInteger(value) && value >= 0;
    for (const row of tracks) {
      if (!isObject(row) || !nonNegativeInt(row.id) || runtimeTracks.has(row.id)) throw new StudioOperationError('incomplete_native_snapshot', 'The engine returned invalid or duplicate native tracks.', 502);
      // Inside Freestyle the engine session also mounts the
      // backing slot with db_track_id "" (not persisted) beside the backing lane.
      const durable = row.db_track_id === '' ? null : (row.db_track_id ?? null);
      if (durable != null && (typeof durable !== 'string' || !durable || durableTracks.has(durable))) throw new StudioOperationError('incomplete_native_snapshot', 'The engine returned ambiguous persisted track membership.', 502);
      if (durable != null) durableTracks.add(durable);
      for (const key of ['projectId', 'project_id']) if (row[key] != null && row[key] !== projectId) throw new StudioOperationError('foreign_native_snapshot', 'The engine track belongs to another project.', 502);
      runtimeTracks.set(row.id, durable);
    }
    for (const row of clips) {
      if (!isObject(row) || !nonNegativeInt(row.clip_id) || clipIds.has(row.clip_id) || !isInteger(row.mozart_track_id) || !runtimeTracks.has(row.mozart_track_id))
        throw new StudioOperationError('incomplete_native_snapshot', 'The engine returned invalid native clip membership.', 502);
      clipIds.add(row.clip_id);
      const lane = row.db_track_id === '' ? null : (row.db_track_id ?? null);
      if (lane != null && lane !== runtimeTracks.get(row.mozart_track_id)) throw new StudioOperationError('incomplete_native_snapshot', 'The engine clip and track lane membership disagree.', 502);
      const durable = row.db_clip_id === '' ? null : (row.db_clip_id ?? null);
      if (durable != null && (typeof durable !== 'string' || !durable || durableClips.has(durable))) throw new StudioOperationError('incomplete_native_snapshot', 'The engine returned ambiguous persisted clip membership.', 502);
      if (durable != null) durableClips.add(durable);
      for (const key of ['projectId', 'project_id']) if (row[key] != null && row[key] !== projectId) throw new StudioOperationError('foreign_native_snapshot', 'The engine audio belongs to another project.', 502);
    }
    return state;
  }

  static etagOf(response) { const value = headerOf(response?.headers || {}, 'etag'); return value == null ? null : String(value); }

  async pages(operationId, args, expectedEtag = null, ctx = {}) {
    const rows = [], seen = new Set();
    let cursor = args.cursor ?? null;
    const limitParameter = (this.operations[operationId][2].parameters || []).find(parameter => parameter.in === 'query' && parameter.name === 'limit');
    const limitSchema = limitParameter ? schemaOf(this.spec, limitParameter.schema || {}) : {};
    const limit = Math.min(200, limitSchema.maximum ?? 200);
    for (;;) {
      const pageArgs = {...args, limit};
      if (cursor) pageArgs.cursor = cursor;
      const response = await this.execute(this.request(operationId, pageArgs), ctx);
      const current = StudioApiAdapter.etagOf(response);
      if (expectedEtag != null && current != null && current !== expectedEtag) throw new StudioOperationError('studio_revision_changed', 'The project changed while its pages were read. Refresh it before editing.', 412);
      expectedEtag = expectedEtag || current;
      const data = response.data;
      if (!isObject(data) || !Array.isArray(data.data) || !isObject(data.pagination)) throw new StudioOperationError('studio_incomplete_page', 'Studio returned no complete resource page.', 502);
      rows.push(...clone(data.data));
      const pagination = data.pagination;
      cursor = pagination.nextCursor ?? null;
      const more = pagination.hasMore;
      if (more === false || (more == null && cursor == null)) {
        if (cursor) throw new StudioOperationError('studio_incomplete_page', 'Studio returned contradictory pagination.', 502);
        return [rows, expectedEtag];
      }
      if (typeof cursor !== 'string' || !cursor || seen.has(cursor)) throw new StudioOperationError('studio_incomplete_page', 'Studio returned no advancing resource cursor.', 502);
      seen.add(cursor);
    }
  }

  async project(args, ctx = {}) {
    const response = await this.execute(this.request('getProject', args), ctx);
    const project = clone(response.data);
    let etag = StudioApiAdapter.etagOf(response);
    if (!isObject(project) || project.id !== args.project_id) throw new StudioOperationError('studio_foreign_project', 'Studio returned another project.', 502);
    const counts = project.counts ?? {}, flags = project.truncated ?? {};
    const pending = [];
    for (const [field, op] of [['lanes', 'listLanes'], ['clips', 'listClips'], ['patterns', 'listPatterns'], ['placements', 'listPatternPlacements']]) {
      const values = project[field];
      const missing = !Array.isArray(values);
      const truncated = flags === true || (isObject(flags) && !!flags[field]);
      const mismatch = isObject(counts) && isInteger(counts[field]) && (missing || values.length !== counts[field]);
      if (missing || truncated || mismatch) pending.push([field, op]);
    }
    // Independent page reads of one revision run in parallel (each is pinned to the project ETag).
    const results = await Promise.all(pending.map(([, op]) => this.pages(op, {project_id: args.project_id}, etag, ctx)));
    pending.forEach(([field], index) => {
      const [values, pageEtag] = results[index];
      etag = etag || pageEtag;
      project[field] = values;
      if (isObject(project.counts)) project.counts[field] = values.length;
      if (isObject(project.truncated)) project.truncated[field] = false;
    });
    return project;
  }

  capability(action) {
    const op = this.aliases[action];
    if (!op) throw new StudioOperationError('studio_operation_unsupported', 'No published Studio schema for this action.');
    const [method, , operation] = this.operations[op];
    const schema = bodySchema(this.spec, operation);
    let properties = clone(schema.properties || {});
    let required = [...(schema.required || [])];
    for (const parameter of operation.parameters || []) {
      if (parameter.in === 'path' && parameter.name !== 'project_id') { properties[parameter.name] = clone(parameter.schema); required.push(parameter.name); }
    }
    if (op === 'setLanePan') {
      properties = {track_id: {type: 'string'}, pan: {type: 'number', minimum: -1, maximum: 1, 'x-unit': '-1 hard left, 0 center, 1 hard right'}, persist: {type: 'boolean', default: true}};
      required = ['track_id', 'pan'];
    }
    const argumentSchema = {type: 'object', properties, required: [...new Set(required)], additionalProperties: false};
    if (op === 'setLanePluginParameter' || op === 'setBusPluginParameter') {
      if (own(properties, 'value_norm')) properties.value_norm['x-unit'] = 'normalized (0..1)';
      if (own(properties, 'value')) { properties.value['x-unit'] = 'physical (parameter discovery unit)'; argumentSchema.oneOf = [{required: ['value_norm']}, {required: ['value']}]; }
    }
    return {name: action, description: operation.description ?? operation.summary ?? '', argumentSchema, mutates: method !== 'get', destructive: method === 'delete',
      requiresConfirmation: operation['x-freestyle-confirmation'] === 'confirm=true', schemaSource: 'studio-openapi', operationId: op};
  }

  /** Returns the compatibility DTO; ctx.etag carries the last Studio response ETag (forwarded by /api/call). */
  async call(name, argumentsValue, ctx = {}) {
    let args;
    [name, args] = this.arguments_(name, argumentsValue);
    if (name === 'get_pro_state') {
      const projectId = opaque(args.project_id, 'project id');
      const calls = await this.resolve(name, args);
      return StudioApiAdapter.nativeState((await this.execute(calls[0], ctx)).data, projectId);
    }
    if (name === 'list_pro_capabilities') {
      if (args.action) return this.capability(args.action);
      return {actions: Object.keys(PRIMARY).sort().filter(alias => own(this.aliases, alias)).map(alias => this.capability(alias))};
    }
    if (name === 'get_project') return this.project(args, ctx);
    if (name === 'copy_append_clip' || name === 'split_clip') {
      const project = await this.project({project_id: args.project_id ?? null}, ctx);
      const identity = args.clip_id || args.track_id;
      let candidates = (project.clips || []).filter(clip => clip.id === identity);
      if (!candidates.length && !own(args, 'clip_id')) candidates = (project.clips || []).filter(clip => clip.laneId === identity);
      if (candidates.length !== 1) throw new StudioOperationError('studio_source_ambiguous', 'Choose one durable source clip before copying or splitting.');
      const source = candidates[0];
      if (name === 'split_clip') {
        const cut = args.split_ms;
        if (!isNumber(cut)) throw new StudioOperationError('invalid_arguments', 'Split needs its exact timeline position in milliseconds.');
        const overlaps = project.clips.filter(row => row.laneId === source.laneId && isNumber(row.durationSec) && (row.startMs ?? 0) < cut && cut < (row.startMs ?? 0) + row.durationSec * 1000);
        if (overlaps.length !== 1 || overlaps[0].id !== source.id) throw new StudioOperationError('studio_split_ambiguous', 'This split intersects more than its captured source clip.');
        const request = this.request('editTimeRange', {...args, operation: 'split', lane_ids: [source.laneId], start_ms: cut, end_ms: cut});
        return (await this.execute(request, ctx)).data;
      }
      args.clip_id = source.id;
      for (const [key, field] of [['duration_sec', 'durationSec'], ['audio_offset_sec', 'audioOffsetSec']]) {
        if (own(args, key)) continue;
        const value = source[field];
        if (!isNumber(value)) throw new StudioOperationError('studio_source_geometry_required', "The source clip's stored timing is incomplete.");
        args[key] = value;
      }
      if (!own(args, 'expected')) args.expected = {start_ms: source.startMs, duration_sec: source.durationSec, audio_offset_sec: source.audioOffsetSec};
    }
    if (name === 'list_automation') {
      const ids = own(args, 'clip_ids') ? args.clip_ids : null; delete args.clip_ids;
      if (ids != null && !Array.isArray(ids)) throw new StudioOperationError('invalid_arguments', 'clip_ids must be an array.');
      const filters = ids != null ? ids.map(value => ({...args, clip_id: value})) : [args];
      const rows = [], seen = new Set();
      for (const values of filters) {
        const [page] = await this.pages('listAutomation', values, null, ctx);
        for (const row of page) {
          const key = row.id || JSON.stringify([row.clipId ?? null, row.targetKey ?? null, row.target ?? null]);
          if (!seen.has(key)) { seen.add(key); rows.push(row); }
        }
      }
      return {projectId: args.project_id ?? null, envelopes: rows, truncated: false};
    }
    const calls = await this.resolve(name, args);
    if (calls.length === 1 && own(BINARY_OPERATIONS, calls[0].operationId)) {
      // JSON bridge form (/api/call): bytes as base64. /api/editor/frame serves raw bytes.
      const frame = editorFrameResult(await this.execute(calls[0], ctx));
      const bytes = frame.bytes; delete frame.bytes;
      return {...frame, base64: bytes != null ? bytesToBase64(bytes) : null};
    }
    if (calls.length === 1 && MIX_OPERATIONS.has(calls[0].operationId)) return mixResult(calls[0].operationId, await this.execute(calls[0], ctx));
    if (calls.length === 1 && own(LIST_OUTPUTS, calls[0].operationId)) {
      const operation = calls[0].operationId;
      const [rows] = await this.pages(operation, args, null, ctx);
      return {[LIST_OUTPUTS[operation]]: rows, truncated: false};
    }
    let result = null;
    for (const call of calls) {
      const response = await this.execute(call, ctx);
      result = response.data;
      // Surface a pattern-document write's new revision (ETag) so retained pattern intents record what they produced.
      const tag = StudioApiAdapter.etagOf(response);
      if (tag && isObject(result) && !own(result, 'etag') && (call.operationId === 'updatePattern' || call.operationId === 'createPattern')) result = {...result, etag: tag};
    }
    const last = calls[calls.length - 1].operationId;
    if (last === 'listProjects' || last === 'listLibraryAssets') {
      const key = last === 'listProjects' ? 'projects' : 'assets';
      if (isObject(result) && Array.isArray(result.data)) {
        const pagination = result.pagination || {};
        return {[key]: result.data, nextCursor: pagination.nextCursor ?? null, total: pagination.total ?? null, hasMore: pagination.hasMore ?? false};
      }
    }
    if (last === 'createLane' && isObject(result)) {
      const lane = own(result, 'track') ? result.track : (result.lane ?? {});
      if (isObject(lane) && lane.id) result = {...result, laneId: lane.id};
    }
    return result;
  }
}

/** Python str() for the identities used in deterministic keys. */
const pyStr = value => value === null || value === undefined ? 'None' : value === true ? 'True' : value === false ? 'False' : String(value);

export function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export {StudioApiPlanningError};
