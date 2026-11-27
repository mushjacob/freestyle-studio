/** Generated-schema Studio API v1 client for deterministic Modesty operations.
 *
 * Browser port of the local bridge's studio_api_client.py. The operation registry
 * is generated from the published OpenAPI document (generateStudioManifest).
 * Authentication is owned by the injected transport (the Freestyle host bridge's
 * apiFetch): credentials never enter request plans, receipts or cache data.
 * There is no MCP fallback and no automatic write retry, including after a
 * revision conflict. Retain a planned request and send() it again to retry the
 * exact same intent (same Idempotency-Key and If-Match).
 */

export const BASE_URL = '/api/v1';
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Operations whose 200 body is binary. The transport returns bytes as data; a
// 304 is a normal "unchanged" result with no body and is never cached here.
export const BINARY_OPERATIONS = Object.freeze({getPluginEditorFrame: 'image/jpeg'});
// Live editor input: each event is sent once. It is neither retained for replay
// nor resendable (a duplicate pointer phase could double-click a native GUI).
export const NON_RETRYING_OPERATIONS = new Set(['sendPluginEditorPointer', 'sendPluginEditorScroll', 'sendPluginEditorKeys']);
// Live mix revision domain (ETag "mix-<n>" / body expected_mix_revision). A mix
// guard is sent only when the caller passes one; a cached mix ETag is never
// attached implicitly, because anyone (a Studio fader) may move the mix.
export const MIX_OPERATIONS = new Set(['getEngineMix', 'waitEngineMix', 'applyEngineMix', 'setLaneGain', 'setLanePan', 'setLaneMute',
  'setLaneSolo', 'setLaneRouting', 'setMasterGain', 'setBusGain', 'setBusMute', 'setBusSolo', 'setBusPan', 'setMasterPan']);
// Writes outside the timeline domain that still bump the project's timeline
// revision without returning it as a timeline ETag.
const TIMELINE_SIDE_EFFECT_OPERATIONS = new Set(['editClipSamples', 'undoClipSampleEdit', 'addAudioFromUrl', 'updateLane']);
// Long-poll reads whose 304 means "unchanged" (no cached body is substituted).
const UNCHANGED_304_OPERATIONS = new Set(['waitEngineMix']);
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const own = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInteger = value => typeof value === 'number' && Number.isInteger(value);
const clone = value => value === undefined ? undefined : structuredClone(value);
const codePoints = value => [...value].length;
const uuid4 = () => globalThis.crypto.randomUUID();

/** Python json.dumps(sort_keys=True, separators=(",", ":"), allow_nan=False). */
export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new StudioApiPlanningError('The request must be finite JSON.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  throw new StudioApiPlanningError('The request must be finite JSON.');
}

/** expected_mix_revision n <-> If-Match "mix-<n>". */
export function mixEtag(revision) {
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) throw new StudioApiPlanningError('A mix revision is a nonnegative integer.');
  return `"mix-${revision}"`;
}

/** A request was refused locally, before any network dispatch. */
export class StudioApiPlanningError extends Error {
  constructor(message, code = 'studio_request_planning_error') { super(message); this.name = 'StudioApiPlanningError'; this.code = code; }
}

export class StudioApiResponse {
  constructor(status, data, headers = {}, fromCache = false) { this.status = status; this.data = data; this.headers = headers || {}; this.fromCache = fromCache; }
  header(name, fallback = null) { return headerOf(this.headers, name) ?? fallback; }
}

/** The API's error envelope, real HTTP status and original request. */
export class StudioApiError extends Error {
  constructor(response, request) {
    const data = isObject(response.data) ? response.data : {};
    const error = isObject(data.error) ? data.error : {};
    const message = error.message || `Freestyle Studio API returned HTTP ${response.status}.`;
    super(message);
    this.name = 'StudioApiError';
    this.status = response.status;
    this.code = error.code || `studio_http_${response.status}`;
    this.stage = error.stage ?? null;
    this.engineStatus = this.engine_status = error.engineStatus ?? null;
    this.details = clone(error.details) ?? null;
    this.requestId = this.request_id = error.requestId || response.header('X-Request-Id');
    this.headers = {...response.headers};
    this.data = clone(response.data);
    this.request = request;
  }
  envelope() {
    const error = {code: this.code, message: this.message};
    for (const [name, value] of [['stage', this.stage], ['engineStatus', this.engineStatus], ['details', this.details], ['requestId', this.requestId]]) if (value != null) error[name] = clone(value);
    return {error};
  }
}

function headerOf(headers, name) {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) if (key.toLowerCase() === lower) return value;
  return null;
}
function setHeader(headers, name, value) {
  if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) throw new StudioApiPlanningError(`${name} must be a nonempty single-line header.`);
  for (const key of Object.keys(headers)) if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
  headers[name] = value;
}
function etagValue(value) {
  if (typeof value === 'boolean' || !(typeof value === 'string' || isInteger(value))) throw new StudioApiPlanningError('A revision must be an integer or an opaque ETag.');
  value = String(value);
  if (!value || /[\r\n]/.test(value)) throw new StudioApiPlanningError('A revision must be a nonempty single-line ETag.');
  return value === '*' || value.startsWith('"') || value.startsWith('W/"') ? value : `"${value.replaceAll('"', '\\"')}"`;
}
function revisionValue(value) {
  value = String(value);
  if (value.startsWith('W/')) value = value.slice(2);
  return value.startsWith('"') && value.endsWith('"') && value.length >= 2 ? value.slice(1, -1) : value;
}
/** Python urllib.parse.quote(value, safe=""). */
const quotePath = value => encodeURIComponent(String(value)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const domainKey = domain => domain == null ? '' : JSON.stringify(domain);
const sameDomain = (a, b) => domainKey(a) === domainKey(b);
const regexCache = new Map();
function patternMatches(pattern, value) {
  let regex = regexCache.get(pattern);
  if (regex === undefined) { try { regex = new RegExp(pattern, 'u'); } catch { try { regex = new RegExp(pattern); } catch { regex = null; } } regexCache.set(pattern, regex); }
  return regex ? regex.test(value) : true;
}

/** tools/generate_studio_api_client.py: the dependency-free operation manifest. */
export async function generateStudioManifest(document, {hash = true} = {}) {
  if (!String(document?.openapi || '').startsWith('3.1.')) throw new Error('Expected the published OpenAPI 3.1 document.');
  const operations = {};
  for (const [path, item] of Object.entries(document.paths || {})) {
    const inherited = item.parameters || [];
    for (const [method, source] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;
      const operationId = source.operationId;
      if (typeof operationId !== 'string' || own(operations, operationId)) throw new Error('Each operation needs a unique operationId.');
      operations[operationId] = {...source, method: method.toUpperCase(), path, parameters: [...inherited, ...(source.parameters || [])]};
    }
  }
  if (!Object.keys(operations).length) throw new Error('The document contains no operations.');
  return {generated_from: 'https://freestyle.audio/api/v1/openapi.json', openapi: document.openapi, api_version: document.info?.version ?? null,
    schema_sha256: hash ? await sha256Hex(canonicalJson(document)) : null, components: document.components || {}, operations};
}
export async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export class StudioApiRequest {
  constructor({operationId, method, url, headers, body = null, revisionDomain = null, cacheEpoch = 0, serial = 0}) {
    Object.assign(this, {operationId, operation_id: operationId, method, url, headers: Object.freeze({...headers}), body, revisionDomain, cacheEpoch, serial});
    Object.freeze(this);
  }
}
const copyRequest = request => new StudioApiRequest({...request, headers: {...request.headers}, body: clone(request.body), revisionDomain: request.revisionDomain ? [...request.revisionDomain] : null});

/**
 * Plan spec-defined requests and call an injected asynchronous transport.
 * transport(request, {signal}) resolves to StudioApiResponse(status, parsedJson|bytes, headers).
 * Nothing automatically retries a 4xx/5xx or a transport exception. At most
 * 4096 write intents are retained per client lifecycle; capacity rejects new
 * intents rather than forgetting unresolved or previously completed keys.
 */
export class StudioApiClient {
  constructor({transport = null, baseUrl = BASE_URL, manifest, writePlanLimit = 4096} = {}) {
    if (!manifest) throw new Error('A generated Studio API manifest is required.');
    if (/[?#]/.test(baseUrl) || /\/\/[^/]*@/.test(baseUrl)) throw new Error('Use an API base URL without credentials, query or fragment.');
    if (!Number.isInteger(writePlanLimit) || writePlanLimit < 1) throw new Error('Use a positive retained write-plan limit.');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.manifest = manifest;
    this.operations = manifest.operations;
    this.components = manifest.components || {};
    this.transport = transport;
    this.etags = new Map();
    this.cache = new Map();
    this.epochs = new Map();
    this.pendingWrites = new Map();
    this.observationSerial = new Map();
    this.serial = 0;
    this.writePlanLimit = writePlanLimit;
    this.writePlans = new Map();
    this.sentInputs = new Map();
    this.timelineStaleProjects = new Set();
  }

  /** Share the intent ledger across a schema refresh, before publication.
   * The browser bridge also shares the observed revisions (ETags, epochs and
   * conditional-read cache): they describe server resources, not the schema,
   * and a read still in flight on the previous planner must not lose its ETag. */
  inheritRetainedRequests(previous, {shareRevisions = true} = {}) {
    if (!(previous instanceof StudioApiClient) || this.baseUrl !== previous.baseUrl) throw new StudioApiPlanningError('Retained requests require the same Studio API endpoint.');
    if (this.writePlans.size && this.writePlans !== previous.writePlans) throw new StudioApiPlanningError('A nonempty retained request ledger cannot be replaced.');
    this.writePlans = previous.writePlans;
    this.writePlanLimit = previous.writePlanLimit;
    this.sentInputs = previous.sentInputs;
    this.timelineStaleProjects = previous.timelineStaleProjects;
    if (shareRevisions) {
      this.etags = previous.etags; this.cache = previous.cache; this.epochs = previous.epochs;
      this.pendingWrites = previous.pendingWrites; this.observationSerial = previous.observationSerial;
      this.serial = Math.max(this.serial, previous.serial);
      previous.successor = this;
    }
    return this;
  }

  operation(operationId) {
    if (!own(this.operations, operationId)) throw new StudioApiPlanningError(`Unknown Studio API operation: ${operationId}`);
    return this.operations[operationId];
  }

  resolveRef(schema) {
    if (!isObject(schema) || !own(schema, '$ref')) return schema;
    const ref = schema.$ref;
    if (typeof ref !== 'string' || !ref.startsWith('#/components/')) throw new StudioApiPlanningError('Only bundled OpenAPI component references are supported.');
    let value = {components: this.components};
    for (const key of ref.slice(2).split('/')) {
      const part = key.replaceAll('~1', '/').replaceAll('~0', '~');
      if (!isObject(value) || !own(value, part)) throw new StudioApiPlanningError(`Unresolved generated schema reference: ${ref}`);
      value = value[part];
    }
    const rest = {...schema}; delete rest.$ref;
    return {...value, ...rest};
  }

  /** Validate published scalar/shape bounds without adding schema guesses. */
  validate(value, schema, label = 'value', depth = 0) {
    if (depth > 64) throw new StudioApiPlanningError(`${label} is too deeply nested.`);
    schema = this.resolveRef(schema);
    if (schema === true || (isObject(schema) && !Object.keys(schema).length)) return;
    if (schema === false) throw new StudioApiPlanningError(`${label} is not allowed.`);
    if (!isObject(schema)) return;
    for (const branch of schema.allOf || []) this.validate(value, branch, label, depth + 1);
    for (const kind of ['anyOf', 'oneOf']) {
      if (!own(schema, kind)) continue;
      let matches = 0;
      for (const branch of schema[kind]) { try { this.validate(value, branch, label, depth + 1); matches++; } catch (error) { if (!(error instanceof StudioApiPlanningError)) throw error; } }
      if (!matches || (kind === 'oneOf' && matches !== 1)) throw new StudioApiPlanningError(`${label} does not match its published schema.`);
    }
    let types = schema.type;
    types = typeof types === 'string' ? [types] : types;
    const tests = {null: () => value === null, string: () => typeof value === 'string', boolean: () => typeof value === 'boolean',
      integer: () => isInteger(value), number: () => typeof value === 'number' && Number.isFinite(value), object: () => isObject(value), array: () => Array.isArray(value)};
    if (Array.isArray(types) && types.length && !types.some(kind => (tests[kind] || (() => true))())) throw new StudioApiPlanningError(`${label} has the wrong type.`);
    if (own(schema, 'enum') && !schema.enum.some(item => canonicalEquals(item, value))) throw new StudioApiPlanningError(`${label} is not a supported value.`);
    if (own(schema, 'const') && !canonicalEquals(schema.const, value)) throw new StudioApiPlanningError(`${label} does not match its required value.`);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new StudioApiPlanningError(`${label} must be finite.`);
      for (const [key, failed] of [['minimum', bound => value < bound], ['maximum', bound => value > bound], ['exclusiveMinimum', bound => value <= bound], ['exclusiveMaximum', bound => value >= bound]])
        if (own(schema, key) && typeof schema[key] === 'number' && failed(schema[key])) throw new StudioApiPlanningError(`${label} exceeds its published ${key}.`);
    }
    if (typeof value === 'string') {
      const length = codePoints(value);
      if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) throw new StudioApiPlanningError(`${label} exceeds its published string length.`);
      if (own(schema, 'pattern') && !patternMatches(schema.pattern, value)) throw new StudioApiPlanningError(`${label} does not match its published format.`);
    }
    if (Array.isArray(value)) {
      if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) throw new StudioApiPlanningError(`${label} exceeds its published item count.`);
      value.forEach((item, index) => this.validate(item, schema.items ?? {}, `${label}[${index}]`, depth + 1));
    }
    if (isObject(value)) {
      const keys = Object.keys(value);
      if (keys.length < (schema.minProperties ?? 0) || keys.length > (schema.maxProperties ?? Infinity)) throw new StudioApiPlanningError(`${label} exceeds its published property count.`);
      const missing = (schema.required || []).filter(key => !own(value, key)).sort();
      if (missing.length) throw new StudioApiPlanningError(`${label} is missing ${missing.join(', ')}.`);
      const properties = schema.properties || {};
      for (const [key, item] of Object.entries(value)) this.validate(item, own(properties, key) ? properties[key] : (own(schema, 'additionalProperties') ? schema.additionalProperties : true), `${label}.${key}`, depth + 1);
    }
  }

  revisionDomain(operationId, path, body = null) {
    const operation = this.operation(operationId);
    const project = path?.project_id;
    if (!project) return null;
    if (['getClipWaveform', 'editClipSamples', 'undoClipSampleEdit'].includes(operationId)) return ['source', project, path.clip_id ?? null];
    if (MIX_OPERATIONS.has(operationId)) return ['mix', project];
    if (operationId === 'updateLane' && isObject(body) && body.expected_mix_revision != null) return ['mix', project];
    if (operation.path.includes('/automation/{envelope_id}')) return ['envelope', project, path.envelope_id ?? null];
    if (['getTimingMap', 'setTimingMap', 'undoTimingMap', 'setProjectTempo'].includes(operationId)) return ['timing', project];
    if (['seek', 'setLoop'].includes(operationId)) return isObject(body) && ['tick', 'start_tick', 'end_tick', 'timing_map_revision'].some(key => own(body, key)) ? ['timing', project] : null;
    if ((operation.parameters || []).some(parameter => ['If-Match', 'If-None-Match'].includes(this.resolveRef(parameter)?.name))) return ['timeline', project];
    return null;
  }

  etagFor(operationId, {path = {}, body = null} = {}) { return this.etags.get(domainKey(this.revisionDomain(operationId, path, body))) ?? null; }
  seedEtag(operationId, value, {path = {}, body = null} = {}) {
    const domain = this.revisionDomain(operationId, path, body);
    if (domain == null) throw new StudioApiPlanningError('This operation has no published revision domain.');
    this.etags.set(domainKey(domain), etagValue(value));
  }

  plan(operationId, {path = {}, query = {}, body = null, headers = {}, idempotencyKey = null, ifMatch = null, useEtag = true, requireRevision = false} = {}) {
    const operation = this.operation(operationId);
    path = clone(path || {}); query = clone(query || {}); headers = {...(headers || {})}; body = clone(body ?? null);
    // A waveform ETag identifies source PCM, while this body also contains
    // timeline placement. It cannot validate a cached whole representation.
    if (operationId === 'getClipWaveform') {
      useEtag = false;
      for (const key of Object.keys(headers)) if (key.toLowerCase() === 'if-none-match') delete headers[key];
    }
    for (const [name, value] of Object.entries({...headers})) {
      if (!TOKEN.test(name)) throw new StudioApiPlanningError('Use a valid HTTP header name.');
      setHeader(headers, name, value);
    }
    const definitions = new Map();
    for (const raw of operation.parameters || []) { const parameter = this.resolveRef(raw); definitions.set(`${parameter.in}\u0000${parameter.name}`, parameter); }
    for (const [location, values] of [['path', path], ['query', query]]) {
      for (const name of Object.keys(values)) if (!definitions.has(`${location}\u0000${name}`)) throw new StudioApiPlanningError(`Unknown ${location} parameter ${name} for ${operationId}.`);
      for (const parameter of definitions.values()) {
        if (parameter.in !== location) continue;
        const name = parameter.name;
        if (!own(values, name) || values[name] == null) {
          if (parameter.required) throw new StudioApiPlanningError(`Missing ${location} parameter ${name}.`);
          delete values[name];
          continue;
        }
        this.validate(values[name], parameter.schema ?? {}, `${location} parameter ${name}`);
      }
    }
    let uri = operation.path;
    for (const [name, value] of Object.entries(path)) uri = uri.replaceAll(`{${name}}`, quotePath(value));
    if (/[{}]/.test(uri)) throw new StudioApiPlanningError('The operation has unresolved path parameters.');
    const serialized = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== null && typeof item === 'object') throw new StudioApiPlanningError(`${name} needs scalar query values.`);
        serialized.append(name, item === true ? 'true' : item === false ? 'false' : String(item));
      }
    }
    const search = serialized.toString();
    const url = this.baseUrl + uri + (search ? '?' + search : '');
    let requestBody = operation.requestBody;
    if (requestBody) {
      requestBody = this.resolveRef(requestBody);
      if (body == null && requestBody.required) throw new StudioApiPlanningError(`${operationId} requires its JSON body (use {} for an empty body).`);
      if (body != null) {
        const content = requestBody.content || {};
        if (!own(content, 'application/json')) throw new StudioApiPlanningError('This generated client supports the published JSON request body only.');
        this.validate(body, content['application/json'].schema ?? {}, 'request body');
      }
    } else if (body != null) throw new StudioApiPlanningError(`${operationId} does not accept a request body.`);
    if (body != null) {
      canonicalJson(body); // finite JSON or a planning error
      if (headerOf(headers, 'Content-Type') == null) headers['Content-Type'] = 'application/json';
    }
    if (headerOf(headers, 'Accept') == null) headers.Accept = BINARY_OPERATIONS[operationId] || 'application/json';
    const method = operation.method;
    let domain = this.revisionDomain(operationId, path, body);
    if (idempotencyKey != null) {
      const existing = headerOf(headers, 'Idempotency-Key');
      if (existing != null && existing !== idempotencyKey) throw new StudioApiPlanningError('Conflicting Idempotency-Key values describe different intents.');
      setHeader(headers, 'Idempotency-Key', idempotencyKey);
    }
    if (MUTATIONS.has(method) && headerOf(headers, 'Idempotency-Key') == null) headers['Idempotency-Key'] = uuid4();
    let expected = null;
    if (isObject(body)) {
      const kind = domain?.[0];
      const keys = kind === 'envelope' ? ['expectedRevision'] : kind === 'timing' ? ['timing_map_revision', 'expected_revision'] : kind === 'source' ? ['expected_revision'] : kind === 'mix' ? ['expected_mix_revision'] : [];
      for (const key of keys) if (body[key] != null) { expected = key === 'expected_mix_revision' ? mixEtag(body[key]) : etagValue(body[key]); break; }
    }
    const headerMatch = headerOf(headers, 'If-Match');
    if (ifMatch != null && headerMatch != null && revisionValue(etagValue(ifMatch)) !== revisionValue(etagValue(headerMatch))) throw new StudioApiPlanningError('Conflicting If-Match preconditions.');
    let explicit = ifMatch != null ? ifMatch : headerMatch;
    if (operationId === 'updateLane' && explicit != null && revisionValue(etagValue(explicit)).startsWith('mix-')) domain = ['mix', path.project_id];
    if (explicit != null) {
      explicit = etagValue(explicit);
      if (expected != null && revisionValue(explicit) !== revisionValue(expected)) throw new StudioApiPlanningError("If-Match and the body's expected revision disagree.");
    }
    const key = domainKey(domain);
    const cached = this.cache.get(url);
    const tag = domain ? this.etags.get(key) ?? null : null;
    let root = this; while (root.successor) root = root.successor;
    const serial = root.serial = Math.max(root.serial, this.serial) + 1; this.serial = serial;
    const epoch = this.epochs.get(key) ?? 0;
    if (definitions.has('header\u0000If-Match')) {
      const selected = explicit || expected || (useEtag && !(domain && domain[0] === 'mix') ? tag : null);
      if (selected != null) setHeader(headers, 'If-Match', selected);
      else if (requireRevision || ['editClipSamples', 'undoClipSampleEdit'].includes(operationId)) throw new StudioApiPlanningError(`Read the resource revision before ${operationId}.`);
    } else if (explicit != null) throw new StudioApiPlanningError(`${operationId} does not declare an If-Match precondition.`);
    if (useEtag && method === 'GET' && cached && definitions.has('header\u0000If-None-Match') && headerOf(headers, 'If-None-Match') == null) setHeader(headers, 'If-None-Match', cached.etag);
    for (const parameter of definitions.values()) {
      if (parameter.in !== 'header') continue;
      const value = headerOf(headers, parameter.name);
      if (value == null && parameter.required) throw new StudioApiPlanningError(`Missing header ${parameter.name}.`);
      if (value != null) this.validate(value, parameter.schema ?? {}, 'header ' + parameter.name);
    }
    return new StudioApiRequest({operationId, method, url, headers, body, revisionDomain: domain, cacheEpoch: epoch, serial});
  }

  static projectOf(request) {
    const match = /\/projects\/([^/?]+)/.exec(request.url);
    return match ? decodeURIComponent(match[1]) : null;
  }

  /** True after a write bumped the timeline without returning its revision. */
  timelineStale(projectId) { return this.timelineStaleProjects.has(projectId); }

  /** Keep the cached timeline ETag truthful after a successful write. */
  settleTimeline(request, domain, adopted, data) {
    const timelineWrite = domain != null && domain[0] === 'timeline';
    if (!timelineWrite && !TIMELINE_SIDE_EFFECT_OPERATIONS.has(request.operationId)) return;
    const project = domain != null ? domain[1] : StudioApiClient.projectOf(request);
    if (!project) return;
    const key = domainKey(['timeline', project]);
    if (timelineWrite && adopted) return;
    if (!timelineWrite) {
      // Fence in-flight timeline reads planned before this write.
      this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
      this.invalidateDomain(key);
    }
    const revision = isObject(data) ? (data.timelineRevision ?? data.timeline_revision) : null;
    if (typeof revision === 'string' && revision && !revision.startsWith('mix-') && !/[\r\n]/.test(revision)) {
      this.etags.set(key, etagValue(revision));
      this.timelineStaleProjects.delete(project);
    } else {
      this.etags.delete(key);
      this.invalidateDomain(key);
      this.timelineStaleProjects.add(project);
    }
  }

  invalidateDomain(key) { for (const [url, value] of [...this.cache]) if (value.domain === key) this.cache.delete(url); }

  async send(request, {signal} = {}) {
    if (!(request instanceof StudioApiRequest)) throw new TypeError('Send a retained StudioApiRequest.');
    if (typeof this.transport !== 'function') throw new Error('Inject a Studio API transport before calling operations.');
    if (NON_RETRYING_OPERATIONS.has(request.operationId)) {
      const key = headerOf(request.headers, 'Idempotency-Key');
      if (this.sentInputs.has(key)) throw new StudioApiPlanningError('Live editor input is sent once and never retried.', 'editor_input_not_retryable');
      this.sentInputs.set(key, null);
      while (this.sentInputs.size > 8192) this.sentInputs.delete(this.sentInputs.keys().next().value);
    }
    const mutation = MUTATIONS.has(request.method);
    const domain = request.revisionDomain, key = domainKey(domain);
    let writeEpoch = null;
    if (mutation && domain != null) {
      writeEpoch = (this.epochs.get(key) ?? 0) + 1;
      this.epochs.set(key, writeEpoch);
      this.pendingWrites.set(key, (this.pendingWrites.get(key) ?? 0) + 1);
      this.invalidateDomain(key);
    }
    try {
      const response = await this.transport(request, {signal});
      if (!(response instanceof StudioApiResponse)) throw new TypeError('The Studio API transport must return StudioApiResponse.');
      if (response.status >= 400) {
        if (response.status === 412 && domain != null) { this.etags.delete(key); this.invalidateDomain(key); }
        throw new StudioApiError(response, request);
      }
      if (response.status === 304 && (own(BINARY_OPERATIONS, request.operationId) || UNCHANGED_304_OPERATIONS.has(request.operationId))) return new StudioApiResponse(304, null, {...response.headers});
      if (response.status === 304) {
        // Also fence requests planned before a timeline edit: source-only 304 cannot prove clip geometry.
        if (request.operationId === 'getClipWaveform') throw new StudioApiPlanningError('A source-only waveform 304 cannot verify placement; re-read unconditionally.');
        const cached = this.cache.get(request.url);
        if (!cached) throw new StudioApiPlanningError('A 304 response has no matching cached representation; re-read unconditionally.');
        if (cached.epoch !== (this.epochs.get(key) ?? 0)) throw new StudioApiPlanningError('The cached representation changed while its conditional read was pending.');
        return new StudioApiResponse(304, clone(cached.data), {...cached.headers, ...response.headers}, true);
      }
      if (!(response.status >= 200 && response.status < 300)) throw new StudioApiError(response, request);
      const tag = response.header('ETag');
      const currentEpoch = this.epochs.get(key) ?? 0;
      const adopt = domain != null && (mutation ? writeEpoch === currentEpoch : request.cacheEpoch === currentEpoch && !(this.pendingWrites.get(key) ?? 0))
        && request.serial >= (this.observationSerial.get(key) ?? 0);
      // A mix ETag ("mix-<n>") never becomes another domain's revision.
      const adopted = !!(adopt && tag && (domain[0] === 'mix') === revisionValue(tag).startsWith('mix-'));
      if (adopted) {
        this.etags.set(key, tag);
        this.observationSerial.set(key, request.serial);
        if (domain[0] === 'timeline') this.timelineStaleProjects.delete(domain[1]);
      }
      if (mutation) this.settleTimeline(request, domain, adopted, response.data);
      if (request.method === 'GET' && request.operationId !== 'getClipWaveform' && !own(BINARY_OPERATIONS, request.operationId)
          && !UNCHANGED_304_OPERATIONS.has(request.operationId) && tag && (domain == null || adopt))
        this.cache.set(request.url, {data: clone(response.data), headers: {...response.headers}, etag: tag, domain: key, epoch: currentEpoch});
      return response;
    } finally {
      if (mutation && domain != null) this.pendingWrites.set(key, Math.max(0, (this.pendingWrites.get(key) ?? 1) - 1));
    }
  }

  callPlan(operationId, {path = null, query = null, body = null, headers = null, idempotencyKey = null, ifMatch = null, useEtag = true, requireRevision = false} = {}) {
    if (NON_RETRYING_OPERATIONS.has(operationId)) {
      // Fresh key per event, no retained intent; a reused caller key is refused at send().
      const filtered = Object.fromEntries(Object.entries(headers || {}).filter(([key]) => !['authorization', 'idempotency-key'].includes(String(key).toLowerCase())));
      return this.plan(operationId, {path, query, body, headers: filtered, idempotencyKey, useEtag: false});
    }
    if (!MUTATIONS.has(this.operation(operationId).method)) return this.plan(operationId, {path, query, body, headers, idempotencyKey, ifMatch, useEtag, requireRevision});
    const explicitHeaders = {};
    for (const [name, value] of Object.entries(headers || {})) {
      // Authentication belongs to the injected runtime transport, never the retained intent.
      if (name.toLowerCase() !== 'authorization') setHeader(explicitHeaders, name.toLowerCase(), value);
    }
    const supplied = explicitHeaders['idempotency-key'] ?? null;
    delete explicitHeaders['idempotency-key'];
    if (supplied != null && idempotencyKey != null && supplied !== idempotencyKey) throw new StudioApiPlanningError('Conflicting Idempotency-Key values describe different intents.');
    const key = idempotencyKey != null ? idempotencyKey : supplied || uuid4();
    setHeader({}, 'Idempotency-Key', key);
    const intent = {operation: operationId, path: path || {}, query: query || {}, body, headers: explicitHeaders, if_match: ifMatch, use_etag: useEtag, require_revision: requireRevision};
    let fingerprint;
    try { fingerprint = canonicalJson(intent); } catch { throw new StudioApiPlanningError('The retained request must be finite JSON.'); }
    const retained = this.writePlans.get(key);
    if (retained) {
      if (retained.fingerprint !== fingerprint) throw new StudioApiPlanningError('This idempotency key already belongs to a different request.', 'retained_request_mismatch');
      return copyRequest(retained.request);
    }
    if (this.writePlans.size >= this.writePlanLimit) throw new StudioApiPlanningError('The retained request capacity is full; existing intents remain recoverable.', 'retained_request_capacity');
    const request = this.plan(operationId, {path, query, body, headers: explicitHeaders, idempotencyKey: key, ifMatch, useEtag, requireRevision});
    this.writePlans.set(key, {fingerprint, request: copyRequest(request)});
    return request;
  }

  call(operationId, options = {}) {
    const {signal, ...rest} = options;
    let request;
    try { request = this.callPlan(operationId, rest); } catch (error) { return Promise.reject(error); }
    return this.send(request, {signal});
  }

  /** Yield intact pages with stable filters and a bounded opaque cursor. */
  async *iterPages(operationId, {path = null, query = null, maxPages = 1000} = {}) {
    query = clone(query || {});
    const seen = new Set();
    let firstEtag = null;
    for (let page = 0; page < maxPages; page++) {
      const response = await this.call(operationId, {path, query});
      const data = response.data;
      if (!isObject(data) || !Array.isArray(data.data) || !isObject(data.pagination)) throw new StudioApiPlanningError('The list operation did not return its documented page envelope.');
      const tag = response.header('ETag');
      if (firstEtag == null) firstEtag = tag;
      else if (tag && firstEtag !== tag) throw new StudioApiPlanningError('The paged resource changed revision between pages; re-read before editing.');
      yield response;
      const cursor = data.pagination.nextCursor ?? null, more = data.pagination.hasMore;
      if (typeof more !== 'boolean' || (cursor == null) === more) throw new StudioApiPlanningError('The list operation returned inconsistent pagination metadata.');
      if (cursor == null) return;
      if (typeof cursor !== 'string' || !cursor || seen.has(cursor)) throw new StudioApiPlanningError('The list operation returned an invalid or repeated cursor.');
      seen.add(cursor);
      query.cursor = cursor;
    }
    throw new StudioApiPlanningError('The list exceeded its bounded page count.');
  }
}

function canonicalEquals(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  try { return canonicalJson(a) === canonicalJson(b); } catch { return false; }
}

export {headerOf, etagValue, revisionValue, domainKey, sameDomain};
