/**
 * Pure helpers for FL-style inline automation editing (no DOM, no I/O).
 * Points are the Studio envelope shape {timeSec, value, curve, tension, meta?}
 * with curve 'linear' | 'hold' | 'bezier' | 'db'. A bezier segment starts at
 * its first point: its tension (-1..1) bends the segment exactly as
 * automationValue() in automation-ui.js evaluates it.
 */
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n)));
const MAX_EXPONENT = 10;

/** Position (0..1) of the shaped segment value between two points. Mirrors automationValue. */
export function segmentFraction(start, p) {
  const position = clamp(p, 0, 1);
  if (start?.curve === 'hold') return 0;
  if (start?.curve === 'bezier') {
    const tension = clamp(start.tension || 0, -1, 1), exponent = 1 + Math.abs(tension) * 9;
    return tension >= 0 ? Math.pow(position, exponent) : 1 - Math.pow(1 - position, exponent);
  }
  return position;
}

/** Value of the segment start->end at relative position p (0..1). */
export function segmentValueAt(start, end, p) {
  if (start.curve === 'hold') return start.value;
  if (start.curve === 'db' && start.value > 0 && end.value > 0) return start.value * Math.pow(end.value / start.value, clamp(p, 0, 1));
  return start.value + (end.value - start.value) * segmentFraction(start, p);
}

/**
 * Tension that makes the segment pass through `value` at its time midpoint
 * (the tension handle is dragged to a value). Returns 0 for a flat segment.
 */
export function tensionFromHandleValue(startValue, endValue, value) {
  const span = Number(endValue) - Number(startValue);
  if (!(Math.abs(span) > 1e-9)) return 0;
  const f = clamp((Number(value) - Number(startValue)) / span, 1e-6, 1 - 1e-6);
  if (Math.abs(f - 0.5) < 1e-6) return 0;
  const exponent = f < 0.5 ? Math.log(f) / Math.log(0.5) : Math.log(1 - f) / Math.log(0.5);
  const magnitude = clamp((Math.min(exponent, MAX_EXPONENT) - 1) / 9, 0, 1);
  return f < 0.5 ? magnitude : -magnitude;
}

/** Whether segment `index` (point index -> index+1) has a draggable tension handle. */
export function segmentHasHandle(points, index) {
  const a = points?.[index], b = points?.[index + 1];
  if (!a || !b) return false;
  if (!(b.timeSec - a.timeSec > 1e-9)) return false;
  if (a.curve === 'hold' || a.curve === 'db') return false;
  return Math.abs(b.value - a.value) > 1e-9;
}

/** Index of the segment whose time span holds timeSec (last segment at the end), or -1. */
export function segmentIndexAt(points, timeSec) {
  if (!points || points.length < 2) return -1;
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i + 1].timeSec - points[i].timeSec <= 1e-9) continue;
    if (timeSec >= points[i].timeSec && timeSec < points[i + 1].timeSec) return i;
  }
  const last = points.length - 2;
  return points[last + 1].timeSec - points[last].timeSec > 1e-9 && timeSec >= points[last + 1].timeSec ? last : -1;
}

const point = (timeSec, value, curve = 'linear', tension = 0) => ({ timeSec, value: clamp(value, 0, 1), curve, tension });

/**
 * FL segment curve types mapped to the envelope model. Every type is
 * representable (hold / bezier tension / extra points); `reason` is set for a
 * type that cannot be applied to this particular segment.
 */
export const CURVE_TYPES = Object.freeze([
  { id: 'linear', label: 'Reset to line' },
  { id: 'single', label: 'Single curve' },
  { id: 'double', label: 'Double curve' },
  { id: 'hold', label: 'Hold' },
  { id: 'stairs', label: 'Stairs' },
  { id: 'smooth-stairs', label: 'Smooth stairs' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'wave', label: 'Wave' },
]);

/** null when `type` can be applied to segment `index`, else the reason it cannot. */
export function curveTypeUnavailable(points, index, type) {
  const a = points?.[index], b = points?.[index + 1];
  if (!a || !b) return 'Choose a segment between two points.';
  if (!CURVE_TYPES.some(item => item.id === type)) return 'Unknown curve type.';
  if (!(b.timeSec - a.timeSec > 1e-6)) return 'This segment is a jump between two points at the same time.';
  if (a.curve === 'db' && type !== 'linear') return 'This segment uses a dB gain curve; reset it to a line first.';
  return null;
}

const SINGLE_TENSION = 0.5, DOUBLE_TENSION = 0.55, STAIR_STEPS = 4, RAMP_FRACTION = 0.3, PULSE_HALF_PERIODS = 8, WAVE_CYCLES = 2, WAVE_POINTS_PER_CYCLE = 16;

/** Replace segment `index` with the shape of `type`. Returns a new point array (input untouched), or the input copy when unavailable. */
export function applySegmentCurve(points, index, type, options = {}) {
  const list = (points || []).map(item => ({ ...item }));
  if (curveTypeUnavailable(list, index, type)) return list;
  const a = list[index], b = list[index + 1], dt = b.timeSec - a.timeSec, s = a.value, e = b.value;
  const meta = a.meta ? { meta: a.meta } : {};
  const first = (curve, tension = 0) => ({ ...a, curve, tension: curve === 'bezier' ? tension : 0 });
  let inserted = [];
  if (type === 'linear') list[index] = first('linear');
  else if (type === 'hold') list[index] = first('hold');
  else if (type === 'single') {
    const current = a.curve === 'bezier' && Math.abs(a.tension || 0) > 1e-6 ? a.tension : SINGLE_TENSION;
    list[index] = first('bezier', clamp(options.tension ?? current, -1, 1));
  } else if (type === 'double') {
    const t = clamp(options.tension ?? DOUBLE_TENSION, 0, 1);
    list[index] = first('bezier', t);
    inserted = [point(a.timeSec + dt / 2, (s + e) / 2, 'bezier', -t)];
  } else if (type === 'stairs' || type === 'smooth-stairs') {
    const steps = Math.max(2, Math.round(options.steps || STAIR_STEPS)), smooth = type === 'smooth-stairs';
    const stepValue = i => s + (e - s) * i / steps, stepTime = i => a.timeSec + dt * i / steps;
    list[index] = { ...first('hold'), value: s };
    // Plain stairs: each level holds until the next. Smooth stairs: each level holds, then ramps linearly into the next one.
    for (let i = 0; i < steps; i++) {
      if (i > 0) inserted.push(point(stepTime(i), stepValue(i), 'hold'));
      if (smooth) inserted.push(point(stepTime(i) + dt / steps * (1 - RAMP_FRACTION), stepValue(i), 'linear'));
    }
  } else if (type === 'pulse') {
    const half = Math.max(2, Math.round(options.halfPeriods || PULSE_HALF_PERIODS)) & ~1;
    list[index] = { ...first('hold'), value: s };
    for (let k = 1; k < half; k++) inserted.push(point(a.timeSec + dt * k / half, k % 2 ? e : s, 'hold'));
  } else if (type === 'wave') {
    const cycles = Math.max(1, Math.round(options.cycles || WAVE_CYCLES)), n = cycles * WAVE_POINTS_PER_CYCLE, amplitude = clamp(options.amplitude ?? 0.1, 0, 0.5);
    list[index] = first('linear');
    for (let k = 1; k < n; k++) {
      const x = k / n;
      inserted.push(point(a.timeSec + dt * x, s + (e - s) * x + amplitude * Math.sin(2 * Math.PI * cycles * x), 'linear'));
    }
  }
  if (meta.meta) for (const item of inserted) item.meta = meta.meta;
  list.splice(index + 1, 0, ...inserted);
  return list;
}

/** Set segment `index`'s tension (the dragged handle). The start point becomes bezier; a ~0 tension goes back to linear. */
export function setSegmentTension(points, index, tension) {
  const list = (points || []).map(item => ({ ...item }));
  if (!segmentHasHandle(list, index)) return list;
  const t = clamp(tension, -1, 1);
  list[index] = Math.abs(t) < 0.005 ? { ...list[index], curve: 'linear', tension: 0 } : { ...list[index], curve: 'bezier', tension: t };
  return list;
}

/** Add a point at (timeSec, value), keeping time order. Fails (returns the copy) when two points already share that time. */
export function addPointAt(points, timeSec, value) {
  const list = (points || []).map(item => ({ ...item }));
  if (list.some(item => Math.abs(item.timeSec - timeSec) < 1e-6)) return list;
  const next = { timeSec: Math.max(0, timeSec), value: clamp(value, 0, 1), curve: 'linear', tension: 0 };
  const at = list.findIndex(item => item.timeSec > next.timeSec);
  list.splice(at < 0 ? list.length : at, 0, next);
  return list;
}

/** Move point `index` to (timeSec, value). The first and last points keep their time; others stay between their neighbours. */
export function movePoint(points, index, timeSec, value) {
  const list = (points || []).map(item => ({ ...item }));
  const current = list[index];
  if (!current) return list;
  const edge = index === 0 || index === list.length - 1, gap = 1e-4;
  const min = index > 0 ? list[index - 1].timeSec + gap : 0, max = index < list.length - 1 ? list[index + 1].timeSec - gap : current.timeSec;
  list[index] = { ...current, timeSec: edge ? current.timeSec : clamp(timeSec, min, Math.max(min, max)), value: clamp(value, 0, 1) };
  return list;
}

/** Remove point `index`; an envelope keeps at least two points. */
export function removePoint(points, index) {
  const list = (points || []).map(item => ({ ...item }));
  if (list.length <= 2 || !list[index]) return list;
  list.splice(index, 1);
  return list;
}
