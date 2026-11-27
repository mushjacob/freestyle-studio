/** In-browser replacement for Modesty's local Python bridge (server.py).
 *
 * Inside Freestyle, the host bridge serves these operations. The operations the
 * browser code used to send to the local server now go to bridgeFetch() under the `modesty-bridge:` scheme
 * (never a network URL), with the same request/response semantics, served
 * through the Freestyle host bridge (window.parent.__freestyleStudioHost):
 *
 *   old local route                      modesty-bridge: route   served by
 *   GET  /api/status                     /status                 host session summary (no OAuth)
 *   GET  /api/tools[?refresh=1]          /tools                  Studio API contract + features (live /api/v1/openapi.json on refresh)
 *   POST /api/call {name,arguments}      /call                   apiFetch /api/v1/* via the adapter; AI names via apiFetch /api/mcp
 *   POST /api/realtime/session           /realtime/session       openInteractiveSession (read-only ticket bound to the Freestyle origin)
 *   DELETE /api/realtime/session/<id>    /realtime/session/<id>  closeInteractiveSession (retained close key)
 *   POST /api/audio/start                /audio/start            host.getDawBaseUrl + host.getTurnCredentials (session already loaded by Default)
 *   POST /api/audio/offer                /audio/offer            host.dawFetch POST /rick/webrtc/offer (own clientId); 404 session_not_found -> host.ensureEngineSession() + one retry
 *   GET  /api/audio/ice                  /audio/ice              host.getTurnCredentials
 *   POST /api/audio/ingest-offer         /audio/ingest-offer     Studio API sendLiveIngestOffer
 *   POST /api/audio/editor               /audio/editor           Studio API plugin-editor lifecycle
 *   GET  /api/editor/frame               /editor/frame           Studio API getPluginEditorFrame as raw image bytes
 *   POST /api/media/prepare + /api/media/<ticket>  ->  prepareMediaUrl(): apiFetch + blob: URL
 *   /api/workspace, /api/auth/*, /api/audio/plugin-chain  ->  removed (host owns the project and the session)
 */
import vendoredSpec from './docs/studio-openapi.json' with {type:'json'};
import aiToolCatalog from './studio-ai-tools.json' with {type:'json'};
import {StudioApiClient, StudioApiResponse, StudioApiError, StudioApiPlanningError, BINARY_OPERATIONS, generateStudioManifest, sha256Hex} from './studio-api-client.js';
import {StudioApiAdapter, StudioOperationError, NativeSnapshotError, studioTools, studioFeatures, AI_NAMES} from './studio-api-adapter.js';
import {createBackingTransport} from './backing-transport.js';

export const VIEW_ID = 'modesty';
/** Bridge routes are `modesty-bridge:/<route>`: never resolvable as a same-origin /api/* request. */
export const BRIDGE_SCHEME = 'modesty-bridge:';
const MCP_PROTOCOL_VERSION = '2025-11-25';
const MAX_ERROR_BODY = 64 * 1024;
const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
const SPEC_REFRESH_TTL_MS = 30000;
// Marketplace previews, and the Sound Library stream (streamCatalogSoundPreview) that previewCatalogSound returns
// with previewRequiresAuth:true.
const MEDIA_PREVIEW_PATH = /^\/api\/(?:marketplace\/[A-Za-z0-9_\/-]+|v1\/catalog\/sounds\/[A-Za-z0-9_.:-]{1,128}\/preview\/audio)$/;
// Response headers kept from Freestyle (plugin editor frames add X-Editor-*).
const UPSTREAM_HEADERS = new Set(['etag', 'x-request-id', 'retry-after', 'content-type', 'x-editor-revision', 'x-editor-width', 'x-editor-height', 'x-editor-plugin-instance-id', 'x-editor-plugin-type']);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const own = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInteger = value => typeof value === 'number' && Number.isInteger(value);
const now = () => globalThis.performance?.now?.() ?? Date.now();
const uuid4 = () => globalThis.crypto.randomUUID();

// ------------------------------------------------------------------ host

/** The Freestyle host bridge (parent document), or a clear error outside Freestyle. */
export function studioHost({optional = false} = {}) {
  let host = null;
  try { if (globalThis.parent && globalThis.parent !== globalThis) host = globalThis.parent.__freestyleStudioHost || null; } catch {}
  if (!host) host = globalThis.__freestyleStudioHost || null; // standalone host (freestyle-standalone-host.js)
  host ||= globalThis.__freestyleStudioHost || null;
  if (!host && !optional) throw new APIError(503, 'host_unavailable', 'Modesty must run inside Freestyle Studio: the Freestyle host bridge is unavailable.');
  return host;
}

/** The Freestyle web origin (static files and same-origin API), never derived from location.* of the embedded document. */
export function freestyleOrigin() {
  const host = studioHost({optional: true});
  try { if (host?.origin) return new URL(host.origin).origin; } catch {}
  try { return new URL(globalThis.document?.baseURI || '').origin; } catch {}
  return 'https://freestyle.audio';
}

// ------------------------------------------------------------------ view lifecycle

let viewActive = true;
/** Fires 'change' {active} when the host shows or hides this view. */
export const viewActivity = new EventTarget();
export function studioViewActive() { return viewActive; }
/** document.hidden, or this view is not the active Studio view. */
export function viewHidden(doc = globalThis.document) { return !!doc?.hidden || !viewActive; }
function setViewActive(next) {
  next = next !== false;
  if (next === viewActive) return;
  viewActive = next;
  viewActivity.dispatchEvent(new CustomEvent('change', {detail: {active: next}}));
}

/**
 * Embedded lifecycle: no sign-in, no project picker. Follows the host's open
 * project and active view. Returns an unsubscribe function.
 */
export function attachHostLifecycle({onProject = () => {}, onProjectUpdated = () => {}, onActive = () => {}, onInactive = () => {}} = {}) {
  const host = studioHost();
  setViewActive(host.getActiveView?.() === VIEW_ID);
  const offs = [
    host.on?.('view', id => { const active = id === VIEW_ID; if (active === viewActive) return; setViewActive(active); try { active ? onActive() : onInactive(); } catch (error) { console.warn('[modesty] view lifecycle failed', error); } }),
    host.on?.('project', project => { try { onProject(String(project?.id || ''), project || null); } catch (error) { console.warn('[modesty] project switch failed', error); } }),
    host.on?.('project-updated', project => { try { onProjectUpdated(project || null); } catch (error) { console.warn('[modesty] project update failed', error); } }),
  ].filter(off => typeof off === 'function');
  return () => offs.forEach(off => off());
}
/** Open another project through the app (New / Duplicate / Import); the view then receives "project". */
export async function openHostProject(projectId) {
  const host = studioHost();
  if (typeof host.openProject !== 'function') throw new Error('Open this project from your Freestyle library.');
  return host.openProject(String(projectId || ''));
}
/** A host feature flag (docs/HOST_CONTRACT.md capabilities); false when absent or outside a host. */
export function hostCapability(name) { try { return studioHost({optional: true})?.capabilities?.[name] === true; } catch { return false; } }
export function hostProjectId() { return String(studioHost({optional: true})?.getProjectId?.() || ''); }

// ------------------------------------------------------------------ errors (server.py APIError + redaction)

export class APIError extends Error {
  constructor(status, error, detail = null, metadata = null) {
    super(detail || error);
    this.name = 'APIError';
    this.status = status; this.error = error; this.detail = detail || error;
    this.metadata = metadata ? safeErrorFields(metadata) : {};
  }
}

/** Never relay credentials, even if an upstream error echoes an input. */
export function cleanMessage(value) {
  value = String(value);
  value = value.replace(/fst_(?:at|rt|ac|sec|pat)_[A-Za-z0-9_.~-]+/g, '[redacted]');
  value = value.replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]');
  const keys = 'access_token|refresh_token|id_token|client_secret|authorization_code|credential|password';
  value = value.replace(new RegExp(`(\\b(?:${keys})\\b["']?\\s*[:=]\\s*)(["'])([\\s\\S]*?)\\2`, 'gi'), (match, prefix, quote) => prefix + quote + '[redacted]' + quote);
  value = value.replace(new RegExp(`(\\b(?:${keys})\\b["']?\\s*[:=]\\s*)[^\\r\\n"'&,}]+`, 'gi'), '$1[redacted]');
  value = value.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]');
  value = value.replace(/([?&](?:token|signature|sig|key|X-Amz-Signature)=)[^&#\s"'<>]+/gi, '$1[redacted]');
  return value.slice(0, 1600);
}
const HTML_TAG = /<\s*\/?\s*[A-Za-z][^>]*>/;
const SAFE_KEY = /^[A-Za-z0-9_.:-]{1,128}$/;
const BLOCKED_DETAIL_KEY = /token|secret|password|credential|authorization|cookie|headers|body|sdp|ticket|signature/i;

/** Keep structured conflict diagnostics without credentials or response bodies. */
function safeErrorDetails(value, depth = 0) {
  if (depth > 4) return null;
  if (value === null || value === undefined || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.length <= 1600 && !HTML_TAG.test(value) ? cleanMessage(value) : null;
  if (Array.isArray(value)) return value.slice(0, 32).map(item => safeErrorDetails(item, depth + 1));
  if (isObject(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, 32)) if (SAFE_KEY.test(key) && !BLOCKED_DETAIL_KEY.test(key)) result[key] = safeErrorDetails(item, depth + 1);
    return result;
  }
  return null;
}

/** Extract bounded diagnostics, never arbitrary upstream bodies or headers. */
export function safeErrorFields(value) {
  const fields = {};
  const message = item => {
    if (typeof item !== 'string' || !item.trim() || item.length > MAX_ERROR_BODY) return null;
    if (HTML_TAG.test(item)) return null;
    if (item.trimStart().startsWith('{')) return null;
    return cleanMessage(item.trim());
  };
  const number = (item, maximum) => {
    if (typeof item === 'boolean' || !(typeof item === 'number' || typeof item === 'string')) return null;
    if (typeof item === 'string' && (item.length > 32 || !item.trim() || !/^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(item))) return null;
    const parsed = Number(item);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
  };
  const visit = (item, depth = 0) => {
    if (depth > 4) return;
    if (typeof item === 'string' && item.trimStart().startsWith('{') && item.length <= MAX_ERROR_BODY) { try { item = JSON.parse(item); } catch { return; } }
    if (!isObject(item)) return;
    for (const key of ['message', 'error_description', 'detail']) { const text = message(item[key]); if (text) fields[key === 'detail' ? 'detail' : 'message'] = text; }
    const code = item.code ?? item.errorCode ?? item.error_code;
    if (isInteger(code) && code >= -(2 ** 31) && code < 2 ** 31) fields.code = code;
    else if (typeof code === 'string' && SAFE_KEY.test(code) && cleanMessage(code) === code) fields.code = code;
    const stage = item.stage;
    if (typeof stage === 'string' && SAFE_KEY.test(stage) && cleanMessage(stage) === stage) fields.stage = stage;
    const engineStatus = item.engineStatus;
    if (isInteger(engineStatus) && engineStatus >= 0 && engineStatus <= 599) fields.engineStatus = engineStatus;
    else if (typeof engineStatus === 'string' && SAFE_KEY.test(engineStatus) && cleanMessage(engineStatus) === engineStatus) fields.engineStatus = engineStatus;
    const requestId = item.requestId;
    if (typeof requestId === 'string' && SAFE_KEY.test(requestId) && cleanMessage(requestId) === requestId) fields.requestId = requestId;
    if (item.details !== null && typeof item.details === 'object') {
      const details = safeErrorDetails(item.details);
      if (JSON.stringify(details).length <= 8192) fields.details = details;
    }
    const error = item.error;
    if (typeof error === 'string' && !error.trimStart().startsWith('{')) {
      const text = message(error);
      if (text && !own(fields, 'message')) fields.message = text;
      if (SAFE_KEY.test(error) && cleanMessage(error) === error && !own(fields, 'code')) fields.code = error;
    }
    for (const key of ['upstreamStatus', 'status', 'statusCode', 'http_status']) {
      const status = number(item[key], 599);
      if (status !== null && status >= 400 && Number.isInteger(status)) fields.upstreamStatus = status;
    }
    for (const [output, aliases, maximum] of [['retryAfterSec', ['retryAfterSec', 'retry_after_sec', 'retry_after_seconds', 'retryAfterSeconds', 'retry_after'], 86400], ['retryAfterMs', ['retryAfterMs', 'retry_after_ms'], 86400000]]) {
      for (const key of aliases) { const delay = number(item[key], maximum); if (delay !== null) { fields[output] = delay; break; } }
    }
    if (typeof item.retryable === 'boolean') fields.retryable = item.retryable;
    if (isInteger(item.rpcCode) && item.rpcCode >= -(2 ** 31) && item.rpcCode < 2 ** 31) fields.rpcCode = item.rpcCode;
    // MCP can retain its normal result envelope even on an HTTP 4xx. Inspect only explicitly failed tool results.
    if (isObject(item.result) && item.result.isError === true) visit(item.result, depth + 1);
    if (item.isError === true) {
      visit(item.structuredContent, depth + 1);
      if (!isObject(item.structuredContent) && Array.isArray(item.content))
        for (const block of item.content.slice(0, 16)) if (isObject(block) && block.type === 'text' && typeof block.text === 'string' && block.text.trimStart().startsWith('{')) visit(block.text, depth + 1);
    }
    // Only named error containers are considered, with a fixed depth bound.
    for (const key of ['error', 'data', 'response', 'detail', 'details', 'cause', 'body', 'message', 'error_description']) visit(item[key], depth + 1);
  };
  visit(typeof value === 'string' && !value.trimStart().startsWith('{') ? {message: value} : value);
  return fields;
}

// ------------------------------------------------------------------ response + logging

/** A fetch Response stand-in: the bridge never serializes objects it hands straight back to the caller. */
class BridgeResponse {
  constructor(status, {json, blob = null, headers = {}} = {}) {
    this.status = status; this.ok = status >= 200 && status < 300; this.statusText = ''; this.type = 'basic'; this.url = '';
    this.headers = new Headers(headers);
    if (json !== undefined && !this.headers.has('Content-Type')) this.headers.set('Content-Type', 'application/json; charset=utf-8');
    this.payload = json; this.blobBody = blob; this.bodyUsed = false;
  }
  consume() { if (this.bodyUsed) return Promise.reject(new TypeError('Body has already been consumed.')); this.bodyUsed = true; return Promise.resolve(); }
  async json() { await this.consume(); if (this.payload === undefined) throw new SyntaxError('The response has no JSON body.'); return this.payload; }
  async text() { await this.consume(); if (this.blobBody) return this.blobBody.text(); return this.payload === undefined ? '' : JSON.stringify(this.payload); }
  async blob() { await this.consume(); if (this.blobBody) return this.blobBody; return new Blob(this.payload === undefined ? [] : [JSON.stringify(this.payload)], {type: 'application/json'}); }
  async arrayBuffer() { return (await this.blob()).arrayBuffer(); }
  clone() { return Object.assign(new BridgeResponse(this.status, {json: this.payload === undefined ? undefined : structuredClone(this.payload), blob: this.blobBody, headers: Object.fromEntries(this.headers)}), {}); }
}
const jsonResponse = (data, status = 200, headers = {}) => new BridgeResponse(status, {json: data, headers: {'Cache-Control': 'no-store', ...headers}});
const errorResponse = error => jsonResponse({error: error.error, ...error.metadata, detail: cleanMessage(error.detail)}, error.status);

const LOG_LIMIT = 300;
const bridgeLog = [];
/** Start time and duration of every bridge call (the Python bridge's access log). */
export function bridgeCallLog() { return bridgeLog.slice(); }
function debugEnabled() { try { return globalThis.localStorage?.getItem('modesty:debug') === '1'; } catch { return false; } }
function record(entry) {
  bridgeLog.push(entry);
  if (bridgeLog.length > LOG_LIMIT) bridgeLog.splice(0, bridgeLog.length - LOG_LIMIT);
  if (debugEnabled()) console.debug(`[modesty-bridge] ${entry.method} ${entry.path}${entry.name ? ' ' + entry.name : ''} status=${entry.status} started=${new Date(entry.startedAt).toISOString().slice(11, 23)} dur=${entry.durationMs}ms`);
}
try { Object.defineProperty(globalThis, '__modestyBridgeLog', {get: bridgeCallLog, configurable: true}); } catch {}

// ------------------------------------------------------------------ Studio API transport

function pickHeaders(headers) {
  const result = {};
  headers?.forEach?.((value, key) => { if (UPSTREAM_HEADERS.has(key.toLowerCase())) result[key] = value; });
  return result;
}
async function sessionToken(host) { try { return String(await host.getSessionToken?.() || ''); } catch { return ''; } }
const abortError = () => (typeof DOMException === 'function' ? new DOMException('The operation was aborted.', 'AbortError') : Object.assign(new Error('The operation was aborted.'), {name: 'AbortError'}));

/** apiFetch with the bridge's single 401 retry (only when the host has since replaced its session token). */
async function hostApiFetch(path, init = {}) {
  const host = studioHost();
  let token = await sessionToken(host), response;
  for (let attempt = 0; ; attempt++) {
    try { response = await host.apiFetch(path, init); }
    catch (error) {
      if (error?.name === 'AbortError' || init.signal?.aborted) throw abortError();
      throw new APIError(502, 'freestyle_unreachable', 'Could not reach Freestyle. Check your connection and try again.');
    }
    if (response.status !== 401 || attempt) return response;
    const fresh = await sessionToken(host);
    if (!fresh || fresh === token) return response;
    token = fresh;
  }
}

/** The backing track appears as a Backing audio track (backing-transport.js). */
let backingTransportCall = null;
async function studioTransport(request, options = {}) {
  backingTransportCall ??= createBackingTransport({
    raw: studioTransportRaw,
    respond: (status, data) => new StudioApiResponse(status, data, {}),
    fetchProject: async projectId => {
      const response = await hostApiFetch('/api/v1/projects/' + encodeURIComponent(projectId), {method: 'GET', headers: {Accept: 'application/json'}});
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      return {status: response.status, data, etag: response.headers.get('ETag')};
    },
    host: () => studioHost({optional: true}),
  });
  return backingTransportCall(request, options);
}
async function studioTransportRaw(request, {signal} = {}) {
  const init = {method: request.method, headers: {...request.headers}, signal};
  if (request.body !== null && request.body !== undefined) init.body = JSON.stringify(request.body);
  const response = await hostApiFetch(request.url, init);
  const headers = pickHeaders(response.headers);
  const media = String(response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (response.status >= 200 && response.status < 300 && media.startsWith('image/')) {
    // Binary editor frames pass through as bytes with their headers.
    if (media !== BINARY_OPERATIONS[request.operationId]) throw new APIError(502, 'invalid_studio_response', 'Freestyle returned an unexpected image response.');
    return new StudioApiResponse(response.status, new Uint8Array(await response.arrayBuffer()), headers);
  }
  if (response.status === 304) return new StudioApiResponse(304, null, headers);
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { throw new APIError(502, 'invalid_studio_response', 'Freestyle Studio API returned invalid JSON.'); } }
  return new StudioApiResponse(response.status, data, headers);
}

// ------------------------------------------------------------------ Studio adapter lifecycle (_ensure_studio)

const studio = {client: null, adapter: null, schemaHash: null, building: null, refresh: null, refreshedAt: 0, toolsFor: null, tools: null};

function buildStudio(spec, manifest, schemaHash) {
  const client = new StudioApiClient({transport: studioTransport, manifest});
  if (studio.client) client.inheritRetainedRequests(studio.client);
  const adapter = new StudioApiAdapter(client, {spec});
  Object.assign(studio, {client, adapter, schemaHash, tools: null, toolsFor: null});
  return adapter;
}
/** The vendored contract serves the first calls at once; ?refresh=1 adopts the live published OpenAPI. */
async function ensureStudio({refresh = false} = {}) {
  if (!refresh) {
    if (studio.adapter) return studio.adapter;
    studio.building ??= (async () => studio.adapter || buildStudio(vendoredSpec, await generateStudioManifest(vendoredSpec, {hash: false}), null))().finally(() => { studio.building = null; });
    return studio.building;
  }
  if (studio.refresh) return studio.refresh;
  if (studio.adapter && studio.schemaHash && now() - studio.refreshedAt < SPEC_REFRESH_TTL_MS) return studio.adapter;
  studio.refresh = (async () => {
    const response = await hostApiFetch('/api/v1/openapi.json', {method: 'GET', headers: {Accept: 'application/json'}});
    const text = await response.text();
    if (!response.ok) {
      let metadata = {upstreamStatus: response.status};
      if (text.length <= MAX_ERROR_BODY) { try { metadata = {...safeErrorFields(JSON.parse(text)), upstreamStatus: response.status}; } catch {} }
      throw new APIError([400, 401, 403, 404, 409, 429].includes(response.status) ? response.status : 502, 'freestyle_error', metadata.detail || metadata.message || `Freestyle returned HTTP ${response.status}.`, metadata);
    }
    // Change detection over the published bytes (no canonicalisation pass on the main thread).
    const hash = await sha256Hex(text);
    studio.refreshedAt = now();
    if (studio.adapter && hash === studio.schemaHash) return studio.adapter;
    let spec;
    try { spec = JSON.parse(text); } catch { throw new APIError(502, 'invalid_upstream_response', 'Freestyle returned invalid JSON.'); }
    // Registry discovery must not revoke an editor's existing tickets or lose
    // ownership of them. Only the request planner changes.
    return buildStudio(spec, await generateStudioManifest(spec, {hash: false}), hash);
  })().finally(() => { studio.refresh = null; });
  return studio.refresh;
}
/** Warm the live contract in parallel with the first project reads (the capability refresh then reuses it). */
export function prefetchStudioContract() { ensureStudio({refresh: true}).catch(() => {}); }

function toolList(adapter) {
  if (studio.toolsFor !== adapter || !studio.tools) { studio.tools = studioTools(adapter, aiToolCatalog.tools || []); studio.toolsFor = adapter; }
  return structuredClone(studio.tools);
}

function status() {
  const host = studioHost({optional: true});
  const user = host?.getUser?.() || null;
  const connected = !!host;
  return {connected, provider: 'Freestyle', authRequired: false, embedded: true, scopes: [], username: user?.username || null,
    toolsCount: studio.tools?.length ?? null, deterministicTransport: 'studio-api-v1', requiresPro: true};
}

async function tools(refresh) {
  const adapter = await ensureStudio({refresh});
  return {connected: true, source: 'live', transport: 'studio-api-v1', schemaSource: 'studio-openapi', schemaSha256: studio.schemaHash,
    features: studioFeatures(adapter, {pluginEditorFrame: BRIDGE_SCHEME + '/editor/frame'}), tools: toolList(adapter)};
}

// ------------------------------------------------------------------ MCP (AI assistant names only)

const mcp = {sequence: 0, initialized: null, liveTools: null};

function parseRpc(raw, contentType, requestId) {
  if (!String(contentType).includes('text/event-stream')) {
    let result;
    try { result = JSON.parse(raw); } catch { throw new APIError(502, 'invalid_upstream_response', 'Freestyle returned an invalid JSON response.'); }
    if (Array.isArray(result)) result = result.find(value => isObject(value) && value.id === requestId) ?? null;
    if (!isObject(result)) throw new APIError(502, 'invalid_upstream_response', 'Freestyle returned an invalid MCP response.');
    return result;
  }
  for (const event of raw.replaceAll('\r\n', '\n').split('\n\n')) {
    const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ +/, '')).join('\n');
    if (!data) continue;
    let result;
    try { result = JSON.parse(data); } catch { continue; }
    if (isObject(result) && result.id === requestId) return result;
  }
  throw new APIError(502, 'invalid_upstream_response', 'Freestyle sent no matching MCP response event.');
}

async function rpc(method, params = undefined, {signal} = {}) {
  const id = ++mcp.sequence;
  const payload = {jsonrpc: '2.0', id, method, ...(params !== undefined ? {params} : {})};
  const response = await hostApiFetch('/api/mcp', {method: 'POST', signal, body: JSON.stringify(payload),
    headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': MCP_PROTOCOL_VERSION}});
  const raw = await response.text();
  if (!response.ok) {
    const metadata = {upstreamStatus: response.status};
    if (raw.length <= MAX_ERROR_BODY) { try { Object.assign(metadata, safeErrorFields(JSON.parse(raw))); } catch {} }
    metadata.upstreamStatus = response.status;
    const detail = metadata.detail || metadata.message || `Freestyle returned HTTP ${response.status}.`;
    throw new APIError([400, 401, 403, 404, 409, 429].includes(response.status) ? response.status : 502, 'freestyle_error', detail, metadata);
  }
  const result = parseRpc(raw, response.headers.get('Content-Type') || 'application/json', id);
  if (result.id !== id) throw new APIError(502, 'invalid_upstream_response', 'Freestyle returned a mismatched MCP response.');
  if (result.error) {
    const metadata = safeErrorFields(result.error);
    if (isInteger(result.error?.code)) metadata.rpcCode = result.error.code;
    throw new APIError(502, 'mcp_error', metadata.detail || metadata.message || 'Freestyle returned an MCP error.', metadata);
  }
  if (!own(result, 'result')) throw new APIError(502, 'invalid_upstream_response', 'Freestyle returned no MCP result.');
  return result.result;
}
function mcpInitialize() {
  mcp.initialized ??= rpc('initialize', {protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: {name: 'modesty', version: '1.0.0'}}).then(() => true, error => { mcp.initialized = null; throw error; });
  return mcp.initialized;
}
async function mcpTools(refresh = false) {
  await mcpInitialize();
  if (mcp.liveTools === null || refresh) {
    const items = [];
    let cursor = null;
    do {
      const result = await rpc('tools/list', cursor ? {cursor} : {});
      items.push(...(result.tools || []));
      cursor = result.nextCursor || null;
    } while (cursor);
    const docs = Object.fromEntries((aiToolCatalog.tools || []).map(tool => [tool.name, tool]));
    mcp.liveTools = items.map(tool => ({...(docs[tool.name] || {}), ...tool, schemaSource: 'live'}));
  }
  return mcp.liveTools;
}
async function mcpCall(name, args, {signal} = {}) {
  if (typeof name !== 'string' || !name || name.length > 160 || !/^[A-Za-z0-9_.-]+$/.test(name)) throw new APIError(400, 'invalid_tool', 'Provide a valid Freestyle tool name.');
  if (!isObject(args)) throw new APIError(400, 'invalid_arguments', 'Tool arguments must be a JSON object.');
  await mcpInitialize();
  if (mcp.liveTools !== null && !mcp.liveTools.some(tool => tool.name === name)) {
    // New upstream tools can appear while this document stays open.
    const discovered = await mcpTools(true);
    if (!discovered.some(tool => tool.name === name)) throw new APIError(400, 'unknown_tool', 'This tool is not advertised by the current Freestyle registry. Refresh the tool list or check its name.');
  }
  return rpc('tools/call', {name, arguments: args}, {signal});
}

// ------------------------------------------------------------------ /api/call

function translateError(error) {
  if (error instanceof APIError || error?.name === 'AbortError') return error;
  if (error instanceof StudioApiError)
    return new APIError(error.status, 'studio_api_error', error.message, {code: error.code, stage: error.stage, engineStatus: error.engineStatus, requestId: error.requestId, details: error.details, upstreamStatus: error.status});
  if (error instanceof StudioOperationError || error instanceof NativeSnapshotError) {
    const metadata = {code: error.code, stage: error.stage || 'studio_adapter'};
    if (error.details != null) metadata.details = error.details;
    return new APIError(error.status, error.code, error.message, metadata);
  }
  if (error instanceof StudioApiPlanningError) return new APIError(400, 'studio_request_invalid', error.message, {code: error.code, stage: 'studio_preflight'});
  console.error('[modesty-bridge]', error);
  return new APIError(500, 'internal_error', 'The Freestyle bridge could not complete this request.');
}

/** Studio operation by local command name: the /api/call result envelope (and its ETag). */
async function callTool(name, args, {signal} = {}) {
  if (typeof name !== 'string' || !name || name.length > 160 || !/^[A-Za-z0-9_.-]+$/.test(name)) throw new APIError(400, 'invalid_tool', 'Provide a valid Studio operation name.');
  if (!isObject(args)) throw new APIError(400, 'invalid_arguments', 'Studio arguments must be a JSON object.');
  if (AI_NAMES.has(name)) return {result: await mcpCall(name, args, {signal}), etag: null};
  const adapter = await ensureStudio();
  const ctx = {signal, etag: null};
  const data = await adapter.call(name, args, ctx);
  // Response compatibility only; no outbound MCP call occurs. The JSON text
  // block is materialised only if a consumer reads it.
  const result = {structuredContent: data, isError: false, transport: 'studio-api-v1'};
  Object.defineProperty(result, 'content', {enumerable: false, configurable: true, get: () => [{type: 'text', text: JSON.stringify(data)}]});
  const etag = ctx.etag;
  if (typeof etag === 'string' && etag && !/[\r\n]/.test(etag)) result.etag = etag;
  return {result, etag: result.etag || null};
}

// ------------------------------------------------------------------ realtime browser tickets (studio_api_realtime.py)

const browserSessions = new Map();
const opaque = (value, label) => {
  if (typeof value !== 'string' || !value || value.length > 128 || /[\x00-\x1f]/.test(value)) throw new NativeSnapshotError('invalid_realtime_context', `Provide a valid ${label}.`, 400);
  return value;
};
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** A browser origin the backend can bind a ticket to: https, or http on loopback (local dev). */
function bindableOrigin(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.username || url.password || (url.pathname && url.pathname !== '/') || url.search || url.hash) return null;
  if (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))) return url.origin;
  return null;
}
/** The validated /api/ws/mcp-session socket URL on a Freestyle host. */
export function realtimeSocketUrl(value) {
  const base = freestyleOrigin();
  let url;
  try { url = new URL(value, base); } catch { throw new NativeSnapshotError('invalid_realtime_url', 'Studio API returned an invalid realtime socket URL.'); }
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
  const allowedHosts = new Set([new URL(base).host, 'freestyle.audio']);
  try { const api = new URL(studioHost({optional: true})?.apiBaseUrl?.() || '', base); allowedHosts.add(api.host); } catch {}
  const secure = url.protocol === 'wss:' || (url.protocol === 'ws:' && LOOPBACK.has(url.hostname));
  const knownHost = allowedHosts.has(url.host) || /^[a-z0-9-]+\.freestyle\.audio$/.test(url.hostname) && (!url.port || url.port === '443');
  if (!secure || !knownHost || url.username || url.password || url.search || url.hash || url.pathname !== '/api/ws/mcp-session')
    throw new NativeSnapshotError('invalid_realtime_url', 'Studio API returned an invalid realtime socket URL.');
  return url.href;
}

/** Issue a read-only, origin-bound single-use ticket for this document's own socket. */
async function createBrowserTicket(projectId, trackId = null) {
  projectId = opaque(projectId, 'project id');
  if (trackId != null) trackId = opaque(trackId, 'track id');
  const origin = bindableOrigin(freestyleOrigin());
  if (!origin) throw new NativeSnapshotError('invalid_realtime_origin', 'This Freestyle origin cannot bind a realtime ticket.', 400);
  while (browserSessions.size >= 128) {
    const old = [...browserSessions].find(([, value]) => value.closed)?.[0];
    if (old === undefined) throw new NativeSnapshotError('too_many_realtime_sessions', 'Close an existing editor realtime session first.', 429);
    browserSessions.delete(old);
  }
  const adapter = await ensureStudio();
  const body = {mode: 'read', origin, ...(trackId ? {track_id: trackId} : {})};
  const opened = (await adapter.client.call('openInteractiveSession', {path: {project_id: projectId}, body})).data;
  if (!isObject(opened)) throw new NativeSnapshotError('invalid_realtime_session', 'Studio API returned no realtime session object.');
  const sessionId = opaque(opened.session_id, 'browser session id');
  browserSessions.set(sessionId, {projectId, closeKey: uuid4(), closed: false});
  try {
    const url = realtimeSocketUrl(opened.websocket_url);
    const ticket = opened.session_ticket;
    if ((opened.mode ?? 'read') !== 'read' || typeof ticket !== 'string' || !ticket || ticket.length > 16384) throw new NativeSnapshotError('invalid_realtime_session', 'Studio API returned no read-only browser ticket.');
    const safe = {};
    for (const key of ['session_id', 'session_ticket', 'ticket_expires_at', 'expires_at', 'revision', 'sample_rate', 'mode']) if (own(opened, key)) safe[key] = structuredClone(opened[key]);
    return {...safe, project_id: projectId, websocket_url: url, mode: 'read'};
  } catch (error) {
    await closeBrowserTicket(sessionId).catch(() => {});
    throw error;
  }
}
async function closeBrowserTicket(sessionId) {
  sessionId = opaque(sessionId, 'browser session id');
  const owned = browserSessions.get(sessionId);
  if (!owned) throw new NativeSnapshotError('foreign_realtime_session', 'This editor did not open that browser session.', 403);
  if (owned.closed) return {...structuredClone(owned.result), already_closed: true};
  const adapter = await ensureStudio();
  const result = (await adapter.client.call('closeInteractiveSession', {path: {session_id: sessionId}, idempotencyKey: owned.closeKey})).data;
  if (!isObject(result)) throw new NativeSnapshotError('invalid_realtime_session', 'Studio API returned no realtime session object.');
  const safe = {};
  for (const key of ['session_id', 'status', 'already_closed']) if (own(result, key)) safe[key] = structuredClone(result[key]);
  Object.assign(owned, {closed: true, result: structuredClone(safe)});
  return safe;
}

// ------------------------------------------------------------------ audio (monitor, ingest, editor lifecycle)

function audioString(value, maximum, label) {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) throw new APIError(400, 'invalid_audio_arguments', `Provide a valid ${label} of at most ${maximum} characters.`);
  return value;
}
function audioContext(payload) {
  const args = {project_id: payload.project_id ?? payload.projectId};
  const trackId = payload.track_id ?? payload.trackId;
  if (trackId !== undefined && trackId !== null && trackId !== '') args.track_id = trackId;
  for (const value of Object.values(args)) if (typeof value !== 'string' || !ID.test(value)) throw new APIError(400, 'invalid_audio_context', 'Provide a valid project ID and, optionally, a track ID for cloud audio.');
  const deviceId = payload.device_id ?? payload.deviceId;
  if (deviceId !== undefined && deviceId !== null) { audioString(deviceId, 128, 'device ID'); args.device_id = deviceId; }
  return args;
}
function turnCredentialsArgument(payload) {
  if (!own(payload, 'turn_credentials')) return undefined;
  const credentials = payload.turn_credentials;
  let size = 65537;
  try { size = JSON.stringify(credentials).length; } catch {}
  if (!isObject(credentials) || size > 65536) throw new APIError(400, 'invalid_turn_credentials', 'TURN credentials must be a JSON object of at most 64 KB.');
  return credentials;
}

/** Monitoring/ingest/editor commands through the Studio API, unwrapped to the compatibility DTO. */
async function audioTool(name, args, {signal} = {}) {
  const {result} = await callTool(name, args, {signal});
  let data = isObject(result) ? result.structuredContent : null;
  if (!isObject(data)) {
    const text = Array.isArray(result?.content) ? result.content.filter(block => isObject(block) && block.type === 'text').map(block => block.text || '').join('\n') : '';
    try { data = JSON.parse(text); }
    catch {
      if (result?.isError) throw new APIError(502, 'cloud_audio_error', cleanMessage(text || 'The audio tool failed.'));
      throw new APIError(502, 'invalid_audio_response', 'Freestyle returned no JSON object for the audio tool.');
    }
  }
  if (!isObject(data)) throw new APIError(502, 'invalid_audio_response', 'Freestyle returned no JSON object for the audio tool.');
  const response = own(data, 'response') ? data.response : data;
  if (!isObject(response)) throw new APIError(502, 'invalid_audio_response', 'Freestyle returned an invalid audio response object.');
  if (result.isError || data.ok === false || data.error || response.ok === false || response.error) {
    const error = response.error || data.error || {};
    const message = (isObject(error) ? error.message : error) || response.message || data.message || 'Freestyle could not complete the audio operation.';
    const rawStatus = (isObject(error) ? error.status : null) || response.statusCode || data.statusCode;
    const code = (isObject(error) ? error.code : null) || response.code || data.code;
    const mapped = {unauthorized: 401, authorization_required: 401, forbidden: 403, insufficient_scope: 403, not_found: 404, project_not_found: 404, rate_limited: 429, invalid_arguments: 400, invalid_params: 400};
    const statusCode = [400, 401, 403, 404, 409, 429].includes(rawStatus) ? rawStatus : mapped[code] || 502;
    throw new APIError(statusCode, 'cloud_audio_error', cleanMessage(message));
  }
  return response;
}

function safeEngineOrigin(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { return ''; }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  if (!secure || !url.hostname || url.username || url.password) return '';
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}
function turnExpiryMs(credentials) {
  const raw = credentials?.expiresAt;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
/** Host TURN credentials for the engine origin; refreshed when they are about to expire. */
async function hostTurnCredentials({forceRefresh = false} = {}) {
  const host = studioHost();
  let credentials = await host.getTurnCredentials({forceRefresh});
  const expiry = turnExpiryMs(credentials);
  if (!forceRefresh && expiry !== null && expiry - Date.now() < 90000) credentials = await host.getTurnCredentials({forceRefresh: true});
  if (!isObject(credentials)) throw new APIError(502, 'invalid_audio_response', 'Freestyle returned no TURN credentials.');
  return credentials;
}

/** The engine session is already loaded by the Default studio on the same engine session: no engine request here. */
async function audioStart(payload) {
  const args = audioContext(payload);
  const host = studioHost();
  const [dawBaseUrl, turnCredentials] = await Promise.all([host.getDawBaseUrl(args.project_id), hostTurnCredentials().catch(() => null)]);
  const origin = safeEngineOrigin(dawBaseUrl);
  if (!origin) throw new APIError(502, 'invalid_audio_route', 'Freestyle returned no usable engine origin for this project.');
  const session = {projectId: args.project_id, ...(args.track_id ? {trackId: args.track_id} : {}), phase: 'host-session', dawBaseUrl: origin};
  return {projectId: args.project_id, ...(args.track_id ? {trackId: args.track_id} : {}), session, turnCredentials};
}

async function audioIce() { return hostTurnCredentials(); }

async function mozartError(response, fallback) {
  const raw = await response.text().catch(() => '');
  let metadata = {upstreamStatus: response.status};
  if (raw.length <= MAX_ERROR_BODY) { try { metadata = {...safeErrorFields(JSON.parse(raw)), upstreamStatus: response.status}; } catch { if (raw && !HTML_TAG.test(raw)) metadata.message = cleanMessage(raw.slice(0, 300)); } }
  const retryAfter = Number(response.headers.get('Retry-After'));
  if (Number.isFinite(retryAfter) && !own(metadata, 'retryAfterSec')) metadata.retryAfterSec = retryAfter;
  const status = [400, 401, 403, 404, 409, 429].includes(response.status) ? response.status : response.status === 503 ? 503 : 502;
  return Object.assign(new APIError(status, 'cloud_audio_error', metadata.detail || metadata.message || fallback, metadata), {raw});
}

/** Monitor offer DIRECT to the project's engine (Default studio's request shape), same device, own clientId. */
async function audioOffer(payload, {signal} = {}) {
  const args = audioContext(payload);
  const offer = own(payload, 'offer') ? payload.offer : {sdp: payload.sdp, type: payload.type ?? 'offer'};
  if (!isObject(offer) || (offer.type ?? 'offer') !== 'offer') throw new APIError(400, 'invalid_audio_offer', 'Send an SDP offer for the cloud audio session.');
  const sdp = offer.sdp;
  if (typeof sdp !== 'string' || !sdp || sdp.length > 65536) throw new APIError(400, 'invalid_audio_offer', 'SDP must be a nonempty string of at most 65536 characters.');
  const options = {};
  for (const [snake, camel, maximum] of [['client_id', 'clientId', 128], ['mode', 'mode', 40], ['quality_profile', 'qualityProfile', 80]]) {
    const value = payload[snake] ?? payload[camel];
    if (value !== undefined && value !== null) options[snake] = audioString(value, maximum, snake);
  }
  const lowLatency = payload.low_latency ?? payload.lowLatency;
  if (lowLatency !== undefined && lowLatency !== null && typeof lowLatency !== 'boolean') throw new APIError(400, 'invalid_audio_arguments', 'low_latency must be a boolean.');
  const turn = turnCredentialsArgument(payload);
  const clientId = options.client_id || `modesty-${uuid4()}`;
  if (payload.trickle !== undefined && typeof payload.trickle !== 'boolean') throw new APIError(400, 'invalid_audio_arguments', 'trickle must be a boolean.');
  const body = {clientId, mode: options.mode || 'daw', lowLatency: lowLatency !== false, ...(payload.trickle === true ? {trickle: true} : {}),
    ...(options.quality_profile ? {qualityProfile: options.quality_profile, quality_profile: options.quality_profile} : {}),
    ...(turn ? {turn_credentials: turn} : {}), offer: {sdp, type: 'offer'}};
  const host = studioHost();
  const send = async () => {
    let response;
    try { response = await host.dawFetch('/rick/webrtc/offer', {method: 'POST', body: JSON.stringify(body), signal}, {projectId: args.project_id, timeoutMs: 15000}); }
    catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw abortError();
      throw new APIError(502, 'cloud_audio_unreachable', 'Could not reach the Freestyle audio engine for this project.');
    }
    if (response.ok) {
      const data = await response.json().catch(() => null);
      if (!isObject(data)) throw new APIError(502, 'invalid_audio_response', 'The Freestyle audio engine returned no WebRTC answer.');
      return {data};
    }
    return {error: await mozartError(response, `The Freestyle audio engine refused the audio offer (${response.status}).`)};
  };
  let attempt = await send();
  if (attempt.data) return attempt.data;
  // Only when the engine says the session is missing: the host runs the Default
  // studio's recovery (the host reopens the engine session), then offer again once.
  // Never POST /api/v1/projects/{id}/monitor from the view (it may bind another engine).
  if (attempt.error.status === 404 && /session_not_found/i.test(attempt.error.raw || attempt.error.message)) {
    if (typeof host.ensureEngineSession !== 'function') throw attempt.error;
    try { await host.ensureEngineSession({timeoutMs: 45000}); }
    catch (error) { if (signal?.aborted) throw abortError(); throw new APIError(503, 'engine_session_not_found', `The Freestyle engine lost this project's session and could not reload it: ${cleanMessage(error?.message || error)}`); }
    if (signal?.aborted) throw abortError();
    attempt = await send();
    if (attempt.data) return attempt.data;
  }
  throw attempt.error;
}

async function audioIngestOffer(payload, {signal} = {}) {
  const args = audioContext(payload);
  const offer = own(payload, 'offer') ? payload.offer : {sdp: payload.sdp, type: payload.type ?? 'offer'};
  if (!isObject(offer) || (offer.type ?? 'offer') !== 'offer') throw new APIError(400, 'invalid_audio_offer', 'Send an SDP offer for cloud recording.');
  const sdp = offer.sdp;
  if (typeof sdp !== 'string' || !sdp || sdp.length > 512 * 1024) throw new APIError(400, 'invalid_audio_offer', 'SDP must be a nonempty string of at most 512 KB.');
  args.offer = {type: 'offer', sdp};
  const clientId = payload.clientId ?? payload.client_id ?? `modesty-ingest-${uuid4().replaceAll('-', '').slice(0, 24)}`;
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(clientId)) throw new APIError(400, 'invalid_audio_client', 'Provide a valid cloud recording client ID.');
  args.clientId = clientId;
  const laneId = payload.lane_id ?? payload.laneId;
  if (laneId !== undefined && laneId !== null) {
    if (typeof laneId !== 'string' || !ID.test(laneId)) throw new APIError(400, 'invalid_audio_context', 'Provide a valid recording lane ID.');
    args.lane_id = laneId;
  }
  const delayMs = payload.delay_ms;
  if (delayMs !== undefined && delayMs !== null) {
    if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < -10000 || delayMs > 10000) throw new APIError(400, 'invalid_audio_delay', 'Recording delay must be finite and between -10000 and 10000 ms.');
    args.delay_ms = delayMs;
  }
  const profile = payload.profile ?? 'regional_music';
  if (typeof profile !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(profile)) throw new APIError(400, 'invalid_audio_profile', 'Provide a valid cloud recording profile.');
  args.profile = profile;
  const turn = turnCredentialsArgument(payload);
  if (turn !== undefined) args.turn_credentials = turn;
  if (payload.idempotency_key !== undefined && payload.idempotency_key !== null) args.idempotency_key = payload.idempotency_key;
  // Resolved to POST /api/v1/.../live-ingest/offer.
  return audioTool('live_ingest_offer', args, {signal});
}

const EDITOR_ACTIONS = Object.freeze({'mirror-open': 'open_plugin_editor', open: 'open_plugin_editor', close: 'close_plugin_editor', release: 'release_plugin_editor', status: 'get_plugin_editor_status'});
async function audioEditor(payload, {signal} = {}) {
  const args = audioContext(payload);
  const laneId = payload.lane_id ?? payload.laneId;
  if (typeof laneId !== 'string' || !ID.test(laneId)) throw new APIError(400, 'invalid_editor_lane', 'The plugin editor requires its persisted lane ID.');
  const pluginIndex = payload.plugin_index;
  if (!isInteger(pluginIndex) || pluginIndex < 0 || pluginIndex > 64) throw new APIError(400, 'invalid_editor_plugin', 'Plugin index must be an integer from 0 to 64.');
  const action = payload.action;
  if (!own(EDITOR_ACTIONS, action)) throw new APIError(400, 'invalid_editor_action', 'Choose a supported plugin editor lifecycle action.');
  const options = own(payload, 'arguments') ? payload.arguments : {};
  if (!isObject(options) || Object.keys(options).some(key => key !== 'visible') || (own(options, 'visible') && typeof options.visible !== 'boolean')) throw new APIError(400, 'invalid_editor_arguments', 'Plugin editor arguments accept only a boolean visible field.');
  Object.assign(args, {lane_id: laneId, plugin_index: pluginIndex});
  if (payload.idempotency_key !== undefined && payload.idempotency_key !== null) args.idempotency_key = payload.idempotency_key;
  // Studio's open endpoint itself starts mirroring; numeric engine handles are
  // only used by the frame/input channel, not lifecycle routing.
  return audioTool(EDITOR_ACTIONS[action], args, {signal});
}

async function editorFrame(query, {signal} = {}) {
  const one = name => { const values = query.getAll(name); return values.length ? values[values.length - 1] : null; };
  const args = {};
  for (const name of ['project_id', 'lane_id']) {
    const value = one(name);
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new APIError(400, 'invalid_editor_context', 'Provide valid project and persisted lane IDs.');
    args[name] = value;
  }
  for (const [name, low, high, required] of [['plugin_index', 0, 64, true], ['max_width', 64, 1280, false], ['wait_ms', 0, 500, false]]) {
    const value = one(name);
    if (value === null && !required) continue;
    if (value === null || !/^\d{1,5}$/.test(value) || Number(value) < low || Number(value) > high) throw new APIError(400, 'invalid_editor_arguments', `${name} must be an integer from ${low} to ${high}.`);
    args[name] = Number(value);
  }
  for (const name of ['if_revision', 'expected_plugin_instance_id']) {
    const value = one(name);
    if (value !== null) { audioString(value, 128, name); args[name] = value; }
  }
  const adapter = await ensureStudio();
  const frame = await adapter.editorFrame(args, {signal});
  const headers = {'Cache-Control': 'no-store'};
  for (const [name, key] of [['ETag', 'etag'], ['X-Editor-Revision', 'revision'], ['X-Editor-Width', 'width'], ['X-Editor-Height', 'height'], ['X-Editor-Plugin-Instance-Id', 'pluginInstanceId'], ['X-Editor-Plugin-Type', 'pluginType']]) {
    const value = frame[key];
    if (value !== null && value !== undefined && !/[\r\n]/.test(String(value))) headers[name] = String(value);
  }
  if (frame.status === 304) return new BridgeResponse(304, {headers});
  const type = frame.contentType || 'image/jpeg';
  headers['Content-Type'] = type;
  return new BridgeResponse(frame.status, {blob: new Blob([frame.bytes], {type}), headers});
}

// ------------------------------------------------------------------ library media previews

const preparedMedia = [];
/**
 * A playable URL for a Freestyle library preview. The authorized preview
 * route is read with the session (apiFetch) into a blob: URL; any other URL is
 * returned unchanged.
 */
export async function prepareMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new APIError(400, 'invalid_media_url', 'Choose an audio preview URL returned by the Freestyle library.');
  let url;
  try { url = new URL(value, freestyleOrigin()); } catch { throw new APIError(400, 'invalid_media_url', 'Choose an audio preview URL returned by the Freestyle library.'); }
  const freestyle = new Set([freestyleOrigin(), 'https://freestyle.audio']);
  if (!freestyle.has(url.origin)) return value;
  if (url.username || url.password || url.search || url.hash || !MEDIA_PREVIEW_PATH.test(url.pathname)) throw new APIError(400, 'invalid_media_url', 'Only the observed Freestyle library audio preview routes are supported.');
  const startedAt = Date.now(), started = now();
  let response;
  try {
    response = await hostApiFetch(url.pathname, {method: 'GET', headers: {Accept: 'audio/*'}, redirect: 'error'});
    if (!response.ok) {
      let detail = 'Freestyle rejected the audio preview request.';
      try { const error = await response.json(); let candidate = error.error_description || error.detail || error.error; if (isObject(candidate)) candidate = candidate.message; if (typeof candidate === 'string') detail = cleanMessage(candidate); } catch {}
      const retryAfter = Number(response.headers.get('Retry-After'));
      throw Object.assign(new APIError([400, 401, 403, 404, 416, 429].includes(response.status) ? response.status : 502, 'media_upstream_error', detail), Number.isFinite(retryAfter) && retryAfter >= 0 ? {retryAfterSec: retryAfter} : {});
    }
    const type = String(response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('audio/')) throw new APIError(502, 'media_not_audio', 'Freestyle did not return an audio media response. HTML and error documents cannot be served as previews.');
    const length = response.headers.get('Content-Length');
    if (length !== null && (!/^\d{1,12}$/.test(length) || Number(length) > MAX_MEDIA_BYTES)) throw new APIError(413, 'media_too_large', 'Audio preview exceeds the 32 MB preview limit.');
    const blob = await response.blob();
    if (blob.size > MAX_MEDIA_BYTES) throw new APIError(413, 'media_too_large', 'Audio preview exceeds the 32 MB preview limit.');
    const objectUrl = URL.createObjectURL(blob.type ? blob : new Blob([blob], {type}));
    preparedMedia.push(objectUrl);
    while (preparedMedia.length > 4) URL.revokeObjectURL(preparedMedia.shift());
    return objectUrl;
  } finally {
    record({method: 'GET', path: 'media-preview', name: null, status: response?.status ?? 'error', startedAt, durationMs: Math.round(now() - started)});
  }
}

// ------------------------------------------------------------------ dispatcher

function parseBody(init) {
  const raw = init?.body;
  if (raw === undefined || raw === null || raw === '') return {};
  let payload;
  if (typeof raw === 'string') { try { payload = JSON.parse(raw); } catch { throw new APIError(400, 'invalid_json', 'Request body must be valid JSON.'); } }
  else payload = raw;
  if (!isObject(payload)) throw new APIError(400, 'invalid_request', 'Request body must be a JSON object.');
  return payload;
}

async function route(method, path, query, init) {
  const signal = init?.signal || undefined;
  if (method === 'GET' || method === 'HEAD') {
    if (path === '/status') return jsonResponse(status());
    if (path === '/tools') {
      const result = await tools(query.getAll('refresh').join(',') === '1');
      return jsonResponse(result);
    }
    if (path === '/audio/ice') return jsonResponse(await audioIce());
    if (path === '/editor/frame') return editorFrame(query, {signal});
    throw new APIError(404, 'not_found', 'Unknown API endpoint.');
  }
  if (method === 'DELETE') {
    const match = /^\/realtime\/session\/([A-Za-z0-9_-]{1,128})$/.exec(path);
    if (!match) throw new APIError(404, 'not_found', 'Unknown API endpoint.');
    return jsonResponse(await closeBrowserTicket(match[1]));
  }
  if (method === 'POST') {
    const payload = parseBody(init);
    if (path === '/call') {
      const {result, etag} = await callTool(payload.name, own(payload, 'arguments') ? payload.arguments : {}, {signal});
      // The upstream ETag is forwarded as the response ETag header and also as result.etag.
      return jsonResponse(result, 200, etag ? {ETag: etag} : {});
    }
    if (path === '/realtime/session') return jsonResponse(await createBrowserTicket(payload.project_id, payload.track_id ?? null));
    if (path === '/audio/start') return jsonResponse(await audioStart(payload));
    if (path === '/audio/offer') return jsonResponse(await audioOffer(payload, {signal}));
    if (path === '/audio/ingest-offer') return jsonResponse(await audioIngestOffer(payload, {signal}));
    if (path === '/audio/editor') return jsonResponse(await audioEditor(payload, {signal}));
    throw new APIError(404, 'not_found', 'Unknown API endpoint.');
  }
  throw new APIError(405, 'method_not_allowed', 'Unsupported method.');
}

/**
 * fetch-shaped entry point for the former local-server routes. Resolves with a
 * Response-like object (ok, status, headers, json(), text(), blob()); rejects
 * only on abort, exactly like fetch.
 */
export async function bridgeFetch(input, init = {}) {
  const raw = typeof input === 'string' ? input : String(input?.url ?? input);
  const method = String(init?.method || 'GET').toUpperCase();
  if (init?.signal?.aborted) throw abortError();
  const startedAt = Date.now(), started = now();
  let url = null, path = raw, name = null, response;
  try { url = new URL(raw); if (url.protocol === BRIDGE_SCHEME) path = decodeURIComponent(url.pathname); else url = null; } catch { url = null; }
  try {
    // Only bridge routes are served: a network URL here is a routing bug, never a silent backend call.
    if (!url) throw new APIError(404, 'not_found', 'Unknown bridge route.');
    if (path === '/call' && method === 'POST' && typeof init?.body === 'string') { try { name = JSON.parse(init.body)?.name ?? null; } catch {} }
    else if (path === '/audio/editor' && typeof init?.body === 'string') { try { name = JSON.parse(init.body)?.action ?? null; } catch {} }
    response = await route(method, path, url.searchParams, init);
    return response;
  } catch (error) {
    if (error?.name === 'AbortError' || init?.signal?.aborted) { response = {status: 'aborted'}; throw abortError(); }
    response = errorResponse(translateError(error));
    return response;
  } finally {
    record({method, path: path.startsWith('/realtime/session/') ? '/realtime/session/[id]' : path, name: typeof name === 'string' && name.length <= 80 ? name : null, status: response?.status ?? 'error', startedAt, durationMs: Math.round(now() - started)});
  }
}
