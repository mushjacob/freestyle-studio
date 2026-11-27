/** Lossless automation-write preflight; no API calls or audio processing.
 * Legacy fallback guards the previous server's timestamp, point-metadata and
 * equal-time-pair losses. Live full-precision/pairs/db/meta is activated only
 * from matching create/update tool descriptors. Conservative guards cover
 * independent rules in the Freestyle Studio's automation normalizer: placement
 * clamping, sorting, endpoint creation, normalized values, and forced
 * hold/zero tension.
 * This is not proof of every current backend normalization detail. Accepted
 * writes still require exact canonical readback before being called verified.
 *
 * All contract names are LOCAL capability identifiers, never wire arguments.
 */
export const LEGACY_AUTOMATION_CONTRACT = 'legacy';
export const ORDERED_AUTOMATION_CONTRACT = 'ordered-pairs';
export const LIVE_AUTOMATION_CONTRACT = 'full-precision-db-meta';
const pointFields = new Set(['timeSec', 'value', 'curve', 'tension']);
const curves = new Set(['linear', 'hold', 'bezier']);
const valueTypes = new Set(['continuous', 'discrete', 'boolean']);
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Discover the published preservation features from actual tool schemas and
 * descriptions. This is a local identifier, never an invented RPC argument.
 * Both create and revision-guarded update must advertise the same point shape.
 */
export function automationContractFromTools(tools){
 if(!Array.isArray(tools))return LEGACY_AUTOMATION_CONTRACT;
 const find=name=>{const matches=tools.filter(tool=>tool?.name===name);return matches.length===1?matches[0]:null;},create=find('create_automation'),update=find('update_automation');
 const studioShape=tool=>{
  const points=tool?.inputSchema?.properties?.points,item=points?.items,properties=item?.properties,time=properties?.timeSec?.description||'',curve=properties?.curve?.description||'',meta=properties?.meta?.description||'';
  return points?.type==='array'&&Number.isInteger(points.maxItems)&&points.maxItems>=4096&&item?.type==='object'&&['timeSec','value'].every(key=>item.required?.includes(key))&&properties?.timeSec?.type==='number'&&/full[ -]double precision|full[ -]precision/i.test(time)&&/two points|same[ -]time pairs/i.test(time)&&/first/i.test(time)&&/last/i.test(time)&&/input order/i.test(time)&&properties.value?.type==='number'&&properties.value.minimum===0&&properties.value.maximum===1&&properties.curve?.type==='string'&&['linear','hold','bezier','db'].every(value=>properties.curve.enum?.includes(value))&&/clip gain only/i.test(curve)&&/decibels|geometric gain/i.test(curve)&&properties.meta?.type==='object'&&/1\s*KB/i.test(meta)&&/round.trip|unchanged/i.test(meta);
 };
 if(create?.schemaSource==='studio-openapi'||update?.schemaSource==='studio-openapi'){
  return create?.schemaSource==='studio-openapi'&&update?.schemaSource==='studio-openapi'&&create.operationId==='createAutomationEnvelope'&&update.operationId==='updateAutomationEnvelope'&&studioShape(create)&&studioShape(update)&&update.inputSchema.properties.expectedRevision?.type==='integer'&&/If-Match/i.test(update.description||'')&&/expectedRevision/i.test(update.description||'')&&/412/.test(update.description||'')&&/revision_conflict/i.test(update.description||'')?LIVE_AUTOMATION_CONTRACT:LEGACY_AUTOMATION_CONTRACT;
 }
 const shape=tool=>{
  const points=tool?.inputSchema?.properties?.points,properties=points?.items?.properties;
  return points?.type==='array'&&points.maxItems===4096&&points.items?.type==='object'&&['timeSec','value'].every(key=>points.items.required?.includes(key))&&properties?.timeSec?.type==='number'&&/full[ -]double precision|full[ -]precision/i.test(properties.timeSec.description||'')&&properties.value?.type==='number'&&properties.value.minimum===0&&properties.value.maximum===1&&properties.curve?.type==='string'&&['linear','hold','bezier','db'].every(curve=>properties.curve.enum?.includes(curve))&&properties.meta?.type==='object'&&/1\s*KB/i.test(properties.meta.description||'')&&/round.trip|unchanged/i.test(properties.meta.description||'');
 };
 if(!shape(create)||!shape(update)||update.inputSchema.properties.expected_revision?.type!=='integer'||!update.inputSchema.required?.includes('expected_revision'))return LEGACY_AUTOMATION_CONTRACT;
 const description=create.description||'',updated=update.description||'';
 if(!/two points|same[ -]time pairs/i.test(description)||!/first/i.test(description)||!/last/i.test(description)||!/input order/i.test(description)||!/clip gain only/i.test(description)||!/decibels|geometric gain/i.test(description)||!/full[ -]precision|full double precision/i.test(updated)||!/same[ -]time pairs|same timeSec/i.test(updated))return LEGACY_AUTOMATION_CONTRACT;
 return LIVE_AUTOMATION_CONTRACT;
}

function reject(reason, detail) {
  throw Object.assign(new Error(`${detail} The automation contract cannot establish a lossless write for this envelope.`), {
    code:'AUTOMATION_LOSSY_WRITE', reason,
  });
}

function assertJsonValue(value, ancestors = new Set()) {
  if (Object.is(value, -0)) reject('unserializable_metadata', 'A negative-zero number would become positive zero in JSON.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return;
  if (!value || typeof value !== 'object' || ancestors.has(value)) reject('unserializable_metadata', 'Point metadata is not losslessly representable in JSON.');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject('unserializable_metadata', 'Point metadata must contain plain JSON objects.');
  const next = new Set(ancestors); next.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) reject('unserializable_metadata', 'Point metadata arrays must have the standard JSON array prototype.');
    if (Reflect.ownKeys(value).some(key => key !== 'length' && !(typeof key === 'string' && Number.isInteger(Number(key)) && Number(key) >= 0 && Number(key) < value.length && String(Number(key)) === key))) reject('unserializable_metadata', 'Extra array metadata would be discarded during serialization.');
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor) reject('unserializable_metadata', 'Sparse point metadata arrays would change during serialization.');
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject('unserializable_metadata', 'Point metadata arrays must contain ordinary JSON data entries.');
      assertJsonValue(descriptor.value, next);
    }
    return;
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject('unserializable_metadata', 'Point metadata has fields that JSON would discard or reinterpret.');
    assertJsonValue(descriptor.value, next);
  }
}

/** Validate raw canonical JSON before any clone can materialize accessors or
 * erase unsupported fields. This permits fine times, metadata and ordered
 * pairs for read-only display; it does not authorize a legacy write.
 */
export function assertAutomationJsonValue(value) {
  assertJsonValue(value);
  return true;
}

/** Returns true, or throws an Error carrying code and a stable reason.
 * window.durationSec must be the real placement duration used by the
 * server, never the last point time, visible source end, or guessed source
 * duration. The announced prospective contract relaxes ONLY timestamp
 * precision, extra JSON point fields and at most two equal-time points.
 * Neither mode assumes endpoint insertion, clamping, sorting or forced-curve
 * normalization has changed. Hidden source points outside placement duration
 * remain readable, but cannot be submitted losslessly under either contract.
 * No input object or ordering is changed.
 */
export function assertAutomationWritePreservesData({points, envelope = {}, window, contract = LEGACY_AUTOMATION_CONTRACT} = {}) {
  if (![LEGACY_AUTOMATION_CONTRACT, ORDERED_AUTOMATION_CONTRACT,LIVE_AUTOMATION_CONTRACT].includes(contract)) reject('unknown_contract', 'The automation preservation contract is unknown.');
  if (!Array.isArray(points)) reject('invalid_points', 'The complete canonical point array is unavailable.');
  if (points.length > 4096) reject('point_limit', 'The automation point count exceeds the published 4096-point limit.');
  const legacy = contract === LEGACY_AUTOMATION_CONTRACT;
  const live = contract === LIVE_AUTOMATION_CONTRACT;
  const valueType = envelope?.valueType;
  if (valueType !== undefined && !valueTypes.has(valueType)) reject('unknown_value_type', 'The envelope value-type normalization is unknown.');
  if (!window || !finite(window.durationSec) || window.durationSec < 0) reject('unknown_duration', 'The server placement duration has not been established.');
  // Validate the outer point array as well as each point before iteration can
  // invoke an accessor or serialization can discard an extra array property.
  assertJsonValue(points);
  let previous = -Infinity, equalCount = 0;
  const quantized = new Set();
  for (const point of points) {
    if (!point || typeof point !== 'object' || Array.isArray(point)) reject('invalid_point', 'Each canonical point must be a JSON data object.');
    const timeDescriptor = Object.getOwnPropertyDescriptor(point, 'timeSec'), valueDescriptor = Object.getOwnPropertyDescriptor(point, 'value');
    if (!timeDescriptor || !valueDescriptor || !Object.hasOwn(timeDescriptor, 'value') || !Object.hasOwn(valueDescriptor, 'value') || !finite(timeDescriptor.value) || timeDescriptor.value < 0 || !finite(valueDescriptor.value)) reject('invalid_point', 'Each canonical point needs finite nonnegative source time and finite value in ordinary data fields.');
    if (point.value < 0 || point.value > 1) reject('value_clamping', 'A normalized point value has unestablished preservation outside 0..1.');
    assertJsonValue(point);
    if (point.timeSec < previous) reject('sorting', 'Canonical point order is not stable.');
    equalCount = point.timeSec === previous ? equalCount + 1 : 1;
    if (legacy && equalCount > 1) reject('duplicate_time', 'Equal-time points cannot be preserved by the legacy equal-time contract.');
    if (!legacy && equalCount > 2) reject('too_many_equal_times', 'More than two equal-time points could be pruned to a discontinuity pair.');
    previous = point.timeSec;
    const curve = Object.hasOwn(point, 'curve') ? point.curve : 'linear', tension = Object.hasOwn(point, 'tension') ? point.tension : 0;
    if (!curves.has(curve)&&!(live&&curve==='db'&&envelope.target?.kind==='clip_gain')) reject('curve_normalization', 'The point curve has no established preservation semantics for this target.');
    if (!finite(tension) || tension < -1 || tension > 1) reject('tension_normalization', 'The point tension has unestablished normalization semantics.');
    if (point.timeSec > window.durationSec) reject('time_clamping', 'A source-relative point falls outside the known legacy placement-duration normalization window.');
    if (valueType === undefined && (curve !== 'hold' || tension !== 0)) reject('unknown_value_type', 'The current envelope value type is unknown, so curve normalization cannot be established.');
    if (valueType !== undefined && valueType !== 'continuous' && curve !== 'hold') reject('forced_hold', 'Discrete or boolean curves may be normalized to hold.');
    if (curve !== 'bezier' && tension !== 0) reject('tension_normalization', 'Non-bezier point tension may be cleared.');
    if(live){
      if(Reflect.ownKeys(point).some(key=>!pointFields.has(key)&&key!=='meta'))reject('point_metadata','Only the published meta object has established round-trip preservation.');
      if(Object.hasOwn(point,'meta')){
        if(!point.meta||typeof point.meta!=='object'||Array.isArray(point.meta))reject('point_metadata','Point meta must be a JSON object.');
        if(new TextEncoder().encode(JSON.stringify(point.meta)).length>1024)reject('metadata_limit','Point meta exceeds the published 1 KB JSON limit.');
      }
    }
    if (legacy) {
      if (Reflect.ownKeys(point).some(key => !pointFields.has(key))) reject('point_metadata', 'The legacy server discards additional canonical point metadata.');
      // A grid-membership test, not a claim about backend tie-breaking or its
      // precise multiply/divide sequence; exact readback is still required.
      const rounded = Math.round(point.timeSec * 1e6) / 1e6;
      if (!Number.isFinite(rounded)) reject('time_precision', 'The source timestamp exceeds the legacy time precision.');
      if (quantized.has(rounded)) reject('quantization_collision', 'Distinct source timestamps collide at legacy microsecond precision.');
      quantized.add(rounded);
      if (rounded !== point.timeSec) reject('time_precision', 'The legacy server rounds source timestamps to microseconds.');
    }
  }
  if (!points.some(point => point.timeSec === 0) || !points.some(point => point.timeSec === window.durationSec)) reject('endpoint_addition', 'The server may insert a zero or placement-duration endpoint.');
  return true;
}

function exactValue(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((value, index) => Object.hasOwn(b, index) && exactValue(value, b[index]));
  }
  const aKeys = Object.keys(a).sort(), bKeys = Object.keys(b).sort();
  return aKeys.length === bKeys.length && aKeys.every((key, index) => key === bKeys[index] && exactValue(a[key], b[key]));
}

/** Compare the actual create/update request against a canonical readback.
 * Accepts automationWrite's {name,arguments} or its arguments object directly.
 * Canonical response fields are points/defaultValue/valueType/target/clipId/id;
 * absence, extra point metadata and sub-microsecond changes all matter.
 * A revision increase is not inferred and does not prove data preservation.
 */
export function automationReadbackDifferences(write, saved) {
  const args = write?.arguments ?? write;
  if (!args || typeof args !== 'object' || !saved || typeof saved !== 'object' || Array.isArray(saved)) return ['readback'];
  const differences = [];
  for (const [request, response] of [
    ['points','points'], ['default_value','defaultValue'], ['value_type','valueType'],
    ['target','target'], ['clip_id','clipId'], ['envelope_id','id'],
  ]) {
    if (Object.hasOwn(args, request) && !exactValue(args[request], saved[response])) differences.push(request);
  }
  return differences;
}

/** Canonical-field convenience wrapper. Pass only defaults/value type actually
 * written; unknown optional fields must be omitted rather than guessed.
 */
export function assertAutomationReadbackPreservesData({points, envelope = {}, readback} = {}) {
  const write = {points};
  if (Object.hasOwn(envelope, 'defaultValue') && envelope.defaultValue !== undefined) write.default_value = envelope.defaultValue;
  if (Object.hasOwn(envelope, 'valueType') && envelope.valueType !== undefined) write.value_type = envelope.valueType;
  const differences = automationReadbackDifferences(write, readback);
  if (differences.length) throw Object.assign(new Error(`The automation write returned different canonical ${differences.join(', ')}. Reload and inspect the saved receipt before editing again.`), {
    code:'AUTOMATION_READBACK_MISMATCH', reason:'canonical_mismatch', differences,
  });
  return true;
}
