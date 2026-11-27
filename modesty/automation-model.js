/** Pure automation-clip model, matching the Freestyle Studio's automation behaviour.
 *
 *  - Point normalizer: clamp to [0,duration], value 0..1, stable time sort, at
 *    most first+last point per equal time, endpoints at 0 and duration
 *    evaluated from the curve, non-continuous envelopes store hold.
 *  - Evaluator: hold, db geometric with 1e-7/4 floor, bezier exponent
 *    1+|tension|*9, linear.
 *  - Target keys `clip.gain` / `lane.plugin:<instance>.param:<stable id>`.
 *  - Value labels and the clip-gain lane display mapping (.25 = middle).
 *  - Selection keys, re-sorting moves, last index at a time.
 *  - Lane time snap of 0.01 s unless Alt; Shift locks the previous value.
 *  - Keyboard: arrows nudge 0.01 (Alt 0.001) in time/value, endpoints keep time.
 *  - Clipboard: copied keyframes paste only into the same target key and
 *    value type, after the selection by max(0.01, duration/100).
 * Full-precision times are never rounded here (no microsecond quantization).
 */
export const CURVES = Object.freeze({LINEAR:'linear', BEZIER:'bezier', HOLD:'hold', DB:'db'});
export const MAX_ENVELOPE_POINTS = 250000;
export const CLIP_GAIN_TARGET = Object.freeze({kind:'clip_gain', name:'Volume', unit:'dB'});
export const DEFAULT_GAIN = .25;
const DB_FLOOR = 1e-7 / 4, BEZIER_SPAN = 9, curveSet = new Set(Object.values(CURVES));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const unit = value => { const n = Number(value); return Number.isFinite(n) ? clamp(n, 0, 1) : 0; };
const signed = value => { const n = Number(value); return Number.isFinite(n) ? clamp(n, -1, 1) : 0; };

export function targetKey(target) {
  if (!target || typeof target !== 'object') throw new TypeError('An automation target is required.');
  if (target.kind === 'clip_gain') return 'clip.gain';
  if (target.kind === 'plugin_parameter') {
    const instance = String(target.pluginInstanceId || '').trim(), param = String(target.stableParamId ?? '').trim();
    if (!instance || !param) throw new TypeError('Plugin automation requires pluginInstanceId and stableParamId.');
    return `lane.plugin:${instance}.param:${param}`;
  }
  throw new TypeError(`Unsupported automation target kind: ${target.kind || 'missing'}.`);
}

function geometric(a, b, t) {
  if (t <= 0) return a; if (t >= 1) return b; if (a <= DB_FLOOR && b <= DB_FLOOR) return a;
  const la = Math.log(Math.max(a, DB_FLOOR)), lb = Math.log(Math.max(b, DB_FLOOR));
  return Math.exp(la + (lb - la) * t);
}

/** Value of a sorted point list at timeSec. Equal-time pairs: the later point
 * is the value from that time on (binary search picks the last at time). */
export function evaluate(points, timeSec) {
  if (!points?.length) return 0;
  const t = Number(timeSec);
  if (!Number.isFinite(t) || t < points[0].timeSec) return points[0].value;
  const last = points[points.length - 1];
  if (t >= last.timeSec) return last.value;
  let lo = 0, hi = points.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (points[mid].timeSec <= t) lo = mid; else hi = mid; }
  const a = points[lo], b = points[hi], span = b.timeSec - a.timeSec;
  if (span <= 0 || a.curve === CURVES.HOLD) return a.value;
  let f = clamp((t - a.timeSec) / span, 0, 1);
  if (a.curve === CURVES.DB) return geometric(a.value, b.value, f);
  if (a.curve === CURVES.BEZIER) { const e = 1 + Math.abs(signed(a.tension)) * BEZIER_SPAN; f = a.tension >= 0 ? Math.pow(f, e) : 1 - Math.pow(1 - f, e); }
  return a.value + (b.value - a.value) * f;
}

function normalizePoint(point, duration, valueType) {
  if (!point || typeof point !== 'object') return null;
  const time = Number(point.timeSec);
  if (!Number.isFinite(time)) return null;
  const curve = valueType === 'continuous' && curveSet.has(point.curve) ? point.curve : valueType === 'continuous' ? CURVES.LINEAR : CURVES.HOLD;
  const out = {timeSec:clamp(time, 0, duration), value:unit(point.value), curve, tension:curve === CURVES.BEZIER ? signed(point.tension) : 0};
  if (point.meta && typeof point.meta === 'object' && !Array.isArray(point.meta) && Object.keys(point.meta).length) out.meta = structuredClone(point.meta);
  return out;
}
function collapsePairs(points) {
  const out = [];
  for (let i = 0; i < points.length;) { let j = i; while (j + 1 < points.length && points[j + 1].timeSec === points[i].timeSec) j++; out.push(points[i]); if (j > i) out.push(points[j]); i = j + 1; }
  return out;
}

/** The complete, writable point list for a clip-relative envelope. */
export function normalizeEnvelopePoints(points, {durationSec, defaultValue = 1, valueType = 'continuous', ensureBoundaries = true} = {}) {
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration < 0) throw new TypeError('durationSec must be a finite non-negative number.');
  if (!['continuous', 'discrete', 'boolean'].includes(valueType)) throw new TypeError('valueType must be continuous, discrete, or boolean.');
  if (!Array.isArray(points)) throw new TypeError('points must be an array.');
  if (points.length > MAX_ENVELOPE_POINTS) throw new RangeError(`Automation envelope exceeds ${MAX_ENVELOPE_POINTS} points.`);
  const rows = [];
  for (const point of points) { const row = normalizePoint(point, duration, valueType); if (row) rows.push(row); }
  // Array.prototype.sort is stable, so equal-time input order is retained.
  let out = collapsePairs(rows.sort((a, b) => a.timeSec - b.timeSec));
  const fallbackCurve = valueType === 'continuous' ? CURVES.LINEAR : CURVES.HOLD;
  if (!out.length) { out = [{timeSec:0, value:unit(defaultValue), curve:fallbackCurve, tension:0}]; if (duration > 0) out.push({...out[0], timeSec:duration}); return out; }
  if (ensureBoundaries) {
    if (out[0].timeSec > 0) out.unshift({timeSec:0, value:evaluate(out, 0), curve:out[0].curve, tension:out[0].tension});
    if (out[out.length - 1].timeSec < duration) out.push({timeSec:duration, value:evaluate(out, duration), curve:fallbackCurve, tension:0});
  }
  return out;
}
export const defaultEnvelopePoints = ({durationSec, defaultValue = 1, valueType = 'continuous'} = {}) => normalizeEnvelopePoints([], {durationSec, defaultValue, valueType});

/** Clip gain lanes place unity (.25) at the vertical middle. */
export const gainToDisplay = value => { const v = unit(value); return v <= .25 ? v * 2 : .5 + (v - .25) / .75 * .5; };
export const displayToGain = value => { const v = unit(value); return v <= .5 ? v / 2 : .25 + (v - .5) * 1.5; };
export const displayMapping = target => target?.kind === 'clip_gain' ? {toDisplay:gainToDisplay, fromDisplay:displayToGain} : {toDisplay:unit, fromDisplay:unit};

/** Human-readable label for an automation value. */
export function formatAutomationValue(value, target = {}, valueType = 'continuous') {
  const v = unit(value);
  if (valueType === 'boolean') return v >= .5 ? 'On' : 'Off';
  if (Array.isArray(target.options) && target.options.length) {
    let best = target.options[0], distance = Infinity;
    for (const option of target.options) { const d = Math.abs(v - Number(option.value)); if (d < distance) { best = option; distance = d; } }
    return String(best.label ?? best.value);
  }
  if (target.kind === 'clip_gain') return v <= 0 ? '-∞ dB' : `${(20 * Math.log10(v * 4)).toFixed(1)} dB`;
  return `${Math.round(v * 1e3) / 10}%${target.unit && target.unit !== '%' ? ` ${target.unit}` : ''}`;
}

/** Stable per-point selection keys (microsecond bucket + duplicate rank). */
export function pointKeys(points) {
  const keys = new Array(points.length); let previous = null, rank = 0;
  for (let i = 0; i < points.length; i++) { const bucket = Math.round(points[i].timeSec * 1e6); rank = bucket === previous ? rank + 1 : 0; previous = bucket; keys[i] = `${bucket}:${rank}`; }
  return keys;
}
export function selectedIndices(points, keys) { const out = []; if (!keys?.size) return out; pointKeys(points).forEach((key, i) => { if (keys.has(key)) out.push(i); }); return out; }
export function lastIndexAt(points, timeSec) { const bucket = Math.round(timeSec * 1e6); for (let i = points.length - 1; i >= 0; i--) if (Math.round(points[i].timeSec * 1e6) === bucket) return i; return -1; }

/** Transform some points, re-sort and re-normalize, and report where
 * the moved points ended so selection follows them. */
export function transformPoints(points, indices, transform, normalize) {
  const chosen = new Set(indices), rows = points.map((point, i) => ({point:chosen.has(i) ? transform(point, i) : point, moved:chosen.has(i)}));
  rows.sort((a, b) => a.point.timeSec - b.point.timeSec);
  const kept = [];
  for (let i = 0; i < rows.length;) { let j = i; while (j + 1 < rows.length && rows[j + 1].point.timeSec === rows[i].point.timeSec) j++; kept.push(rows[i]); if (j > i) kept.push(rows[j]); i = j + 1; }
  const next = normalize(kept.map(row => row.point));
  const shift = kept.length && next.length > kept.length && next[0].timeSec < kept[0].point.timeSec ? 1 : 0;
  const keys = pointKeys(next), moved = [];
  kept.forEach((row, i) => { if (row.moved && next[i + shift]) moved.push(i + shift); });
  return {points:next, indices:moved, keys:new Set(moved.map(i => keys[i]))};
}

/** Time snapping. grid: 'off' | seconds number | {beats, bpm}. Alt bypasses. */
export function snapTime(timeSec, grid, {altKey = false} = {}) {
  if (altKey || grid === 'off' || grid == null) return timeSec;
  const step = typeof grid === 'number' ? grid : Number(grid.beats) * 60 / (Number(grid.bpm) || 120);
  return step > 0 && Number.isFinite(step) ? Math.round(timeSec / step) * step : timeSec;
}

/** Nudge (arrow keys). Endpoints at 0/duration keep their time. */
export function nudgePoints(points, keys, {key, altKey = false}, {durationSec, normalize}) {
  const step = altKey ? .001 : .01, dt = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, dv = key === 'ArrowDown' ? -step : key === 'ArrowUp' ? step : 0;
  return transformPoints(points, selectedIndices(points, keys), point => {
    const pinned = point.timeSec === 0 || point.timeSec === durationSec;
    return {...point, timeSec:pinned ? point.timeSec : clamp(point.timeSec + dt, 0, durationSec), value:clamp(point.value + dv, 0, 1)};
  }, normalize);
}

/** Copy selected keyframes with their relative offsets (the Freestyle Studio copies one;
 * the multi-point form keeps its paste placement and target/value-type guard). */
export function copyPoints(points, keys, envelope) {
  const indices = selectedIndices(points, keys);
  if (!indices.length) return null;
  const base = points[indices[0]].timeSec;
  return {targetKey:envelope.targetKey, valueType:envelope.valueType || 'continuous', points:indices.map(i => ({...structuredClone(points[i]), offsetSec:points[i].timeSec - base}))};
}
export function pastePoints(points, keys, clipboard, envelope, {durationSec, normalize, atSec} = {}) {
  if (!clipboard?.points?.length) return null;
  if (clipboard.targetKey !== envelope.targetKey || clipboard.valueType !== (envelope.valueType || 'continuous')) return null;
  const anchorIndex = selectedIndices(points, keys).at(-1);
  const anchor = Number.isFinite(atSec) ? atSec : clamp((points[anchorIndex]?.timeSec ?? durationSec / 2) + Math.max(.01, durationSec / 100), 0, durationSec);
  const pasted = clipboard.points.map(({offsetSec, ...point}) => ({...point, timeSec:clamp(anchor + offsetSec, 0, durationSec)}));
  const next = normalize([...points, ...pasted]), nextKeys = pointKeys(next), selected = new Set();
  for (const point of pasted) { const i = lastIndexAt(next, point.timeSec); if (i >= 0) selected.add(nextKeys[i]); }
  return {points:next, keys:selected};
}

/** Apply a curve shape to the segments starting at the selected points. */
export function setCurve(points, keys, curve) {
  const chosen = new Set(selectedIndices(points, keys));
  return points.map((point, i) => chosen.has(i) ? {...point, curve, tension:curve === CURVES.BEZIER ? (point.tension || .25) : 0} : point);
}

export const envelopeSnapshot = envelope => envelope ? structuredClone({persisted:!!envelope.persisted, id:envelope.id ?? null, points:envelope.points || [], target:envelope.target, targetKey:envelope.targetKey, defaultValue:envelope.defaultValue, valueType:envelope.valueType || 'continuous'}) : null;
export function samePoints(a, b) {
  if (a === b) return true; if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((p, i) => Object.is(p.timeSec, b[i].timeSec) && Object.is(p.value, b[i].value) && (p.curve ?? 'linear') === (b[i].curve ?? 'linear') && Object.is(p.tension ?? 0, b[i].tension ?? 0) && JSON.stringify(p.meta ?? null) === JSON.stringify(b[i].meta ?? null));
}
