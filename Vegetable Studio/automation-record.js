/**
 * Pure logic for FL-style live automation recording (no DOM, no I/O).
 * A recording session collects {key, spec, timeSec, value} samples while the
 * transport plays; on stop each target's samples are thinned to at most
 * MAX_POINTS_PER_SECOND with collinear points dropped, then merged into the
 * target envelope's points.
 */
export const MAX_POINTS_PER_SECOND = 30;
export const COLLINEAR_EPSILON = 0.002;
const clamp01 = n => Math.max(0, Math.min(1, Number(n)));

/** Drop NaN, sort by time, keep the last sample when two share a time. */
function cleanSamples(samples) {
  const rows = (samples || []).filter(item => Number.isFinite(Number(item?.timeSec)) && Number.isFinite(Number(item?.value)))
    .map((item, order) => ({ timeSec: Number(item.timeSec), value: clamp01(item.value), order }));
  rows.sort((a, b) => a.timeSec - b.timeSec || a.order - b.order);
  const out = [];
  for (const row of rows) {
    if (out.length && Math.abs(out.at(-1).timeSec - row.timeSec) < 1e-9) out[out.length - 1] = row;
    else out.push(row);
  }
  return out.map(({ timeSec, value }) => ({ timeSec, value }));
}

/** Keep the last sample of each 1/maxPerSecond bucket, always keeping the very first and last samples. */
export function limitRate(samples, maxPerSecond = MAX_POINTS_PER_SECOND) {
  const rows = cleanSamples(samples);
  if (rows.length <= 2 || !(maxPerSecond > 0)) return rows;
  const out = [rows[0]];
  let bucket = Math.floor(rows[0].timeSec * maxPerSecond + 1e-9), pending = null;
  for (let i = 1; i < rows.length; i++) {
    const b = Math.floor(rows[i].timeSec * maxPerSecond + 1e-9);
    if (b !== bucket) { if (pending) out.push(pending); bucket = b; }
    pending = rows[i];
  }
  if (pending && out.at(-1) !== pending) out.push(pending);
  return out;
}

/** Remove points that lie on the straight line between their kept neighbours (within epsilon). */
export function dropCollinear(samples, epsilon = COLLINEAR_EPSILON) {
  const rows = cleanSamples(samples);
  if (rows.length <= 2) return rows;
  const out = [rows[0]];
  for (let i = 1; i < rows.length - 1; i++) {
    const a = out.at(-1), b = rows[i], c = rows[i + 1], span = c.timeSec - a.timeSec;
    const expected = span > 0 ? a.value + (c.value - a.value) * (b.timeSec - a.timeSec) / span : a.value;
    if (Math.abs(b.value - expected) > epsilon) out.push(b);
  }
  out.push(rows.at(-1));
  return out;
}

/** Rate limit then collinear drop. */
export function thinSamples(samples, { maxPerSecond = MAX_POINTS_PER_SECOND, epsilon = COLLINEAR_EPSILON } = {}) {
  return dropCollinear(limitRate(samples, maxPerSecond), epsilon);
}

/** Linear value of a point list at t (flat outside), enough to anchor a jump at the edges of a recorded range. */
function valueAt(points, t) {
  if (!points.length) return null;
  if (t <= points[0].timeSec) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (t < b.timeSec) {
      if (a.curve === 'hold' || b.timeSec - a.timeSec <= 0) return a.value;
      return a.value + (b.value - a.value) * (t - a.timeSec) / (b.timeSec - a.timeSec);
    }
  }
  return points.at(-1).value;
}

/**
 * Merge recorded samples (times relative to the envelope start, already inside
 * 0..durationSec) into `existing` points. The recorded range replaces whatever
 * the envelope held inside it; a vertical jump pair keeps the old value up to
 * the range edges. Returns Studio points {timeSec,value,curve,tension}.
 */
export function mergeRecordedPoints({ existing = [], samples = [], durationSec, epsilon = COLLINEAR_EPSILON } = {}) {
  const duration = Number(durationSec);
  const recorded = thinSamples(samples.filter(item => item.timeSec >= -1e-9 && (!(duration > 0) || item.timeSec <= duration + 1e-9)), { epsilon })
    .map(item => ({ timeSec: Math.max(0, item.timeSec), value: item.value, curve: 'linear', tension: 0 }));
  const old = [...existing].sort((a, b) => a.timeSec - b.timeSec);
  if (!recorded.length) return old.map(item => ({ ...item }));
  const t0 = recorded[0].timeSec, t1 = recorded.at(-1).timeSec;
  const before = old.filter(item => item.timeSec < t0 - 1e-9), after = old.filter(item => item.timeSec > t1 + 1e-9);
  const out = before.map(item => ({ ...item }));
  if (recorded.length > 1 && old.length) {
    const startValue = valueAt(old, t0);
    if (before.length && Math.abs(startValue - recorded[0].value) > epsilon) out.push({ timeSec: t0, value: clamp01(startValue), curve: 'linear', tension: 0 });
  }
  out.push(...recorded);
  if (recorded.length > 1 && old.length) {
    const endValue = valueAt(old, t1);
    if (after.length && Math.abs(endValue - recorded.at(-1).value) > epsilon) out.push({ timeSec: t1, value: clamp01(endValue), curve: 'linear', tension: 0 });
  }
  out.push(...after.map(item => ({ ...item })));
  // An envelope always spans its clip: pin the ends with the nearest value when the range is interior and the old curve had no end point.
  if (out[0].timeSec > 1e-9) out.unshift({ timeSec: 0, value: out[0].value, curve: 'linear', tension: 0 });
  if (duration > 0 && out.at(-1).timeSec < duration - 1e-9) out.push({ timeSec: duration, value: out.at(-1).value, curve: 'linear', tension: 0 });
  // The envelope model keeps at most two points per time.
  const result = [];
  for (const item of out) {
    const same = result.filter(p => Math.abs(p.timeSec - item.timeSec) < 1e-9);
    if (same.length >= 2) result[result.lastIndexOf(same.at(-1))] = item; else result.push(item);
  }
  return result;
}

/** Collects per-target samples for one recording take. */
export class AutomationRecordBuffer {
  constructor() { this.targets = new Map(); this.specs = new Map(); }
  /** Remember the automation target (spec) a live control key writes to. */
  registerSpec(key, spec) { if (key && spec) this.specs.set(String(key), spec); }
  add(key, timeSec, value, spec = null) {
    const k = String(key);
    if (spec) this.specs.set(k, spec);
    if (!Number.isFinite(Number(timeSec)) || !Number.isFinite(Number(value))) return false;
    let row = this.targets.get(k);
    if (!row) { row = []; this.targets.set(k, row); }
    row.push({ timeSec: Number(timeSec), value: clamp01(value) });
    return true;
  }
  get size() { return this.targets.size; }
  /** [{key, spec, samples}] for targets that have a spec and samples; samples are thinned. */
  finish(options = {}) {
    const out = [];
    for (const [key, samples] of this.targets) {
      const spec = this.specs.get(key);
      if (!spec || !samples.length) continue;
      out.push({ key, spec, samples: thinSamples(samples, options), rawCount: samples.length });
    }
    return out;
  }
}

/** Map a realtime control message to {key, value 0..1, spec?}; null for controls that are not automated. */
export function liveMessageSample(message, { laneVolume = gain => clamp01(gain / 4) } = {}) {
  if (!message || typeof message !== 'object') return null;
  if (message.type === 'set_track_gain' && typeof message.lane_id === 'string' && Number.isFinite(message.gain)) {
    return { key: `gain:${message.lane_id}`, value: laneVolume(message.gain), spec: { lane: true, laneId: message.lane_id, target: { kind: 'lane_volume', name: 'Volume' }, label: 'Volume' } };
  }
  if (message.type === 'set_plugin_param' && Number.isFinite(message.value_norm)) {
    return { key: `plugin:${message.lane_id}:${message.plugin_index}:${message.parameter_index}`, value: clamp01(message.value_norm), spec: null };
  }
  return null;
}
