/**
 * Pure automation point generators (no DOM, no I/O): LFO shapes, ramps and
 * staircases. Every generator returns points in the same shape the automation
 * editor presets produce: {timeSec, value, curve, tension}, times in seconds
 * from the start of the clip, values clamped to 0..1.
 */

const CURVES = new Set(['linear', 'hold', 'bezier', 'db']);
const clamp01 = value => Math.max(0, Math.min(1, Number(value)));
const finiteOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

function requireLength(length) {
  const value = Number(length);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Automation shape length must be a positive, finite number of seconds.');
  return value;
}

const point = (timeSec, value, curve = 'linear') => ({timeSec, value: clamp01(value), curve, tension: 0});

/** mulberry32, the same PRNG as seededRandom in rack-step-ops.js. */
function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bipolar wave value in -1..1 for a position `p` in one cycle (0..1). */
const WAVES = {
  sine: p => Math.sin(2 * Math.PI * p),
  triangle: p => (p < 0.5 ? -1 + 4 * p : 3 - 4 * p),
  saw: p => 2 * p - 1,
  square: p => (p < 0.5 ? 1 : -1),
};

/**
 * LFO over [0, length]. `amount` is the depth (0..1): the curve swings between
 * center - amount/2 and center + amount/2, then clamps to 0..1. `cycles` may be
 * fractional; `phase` is a fraction of one cycle. `random` holds one seeded
 * value per cycle (sample and hold).
 */
export function lfoPoints({shape = 'sine', cycles = 4, amount = 0.5, center = 0.5, length, pointsPerCycle = 16, phase = 0, seed = 1} = {}) {
  const span = requireLength(length);
  const isRandom = shape === 'random';
  if (!isRandom && !WAVES[shape]) throw new Error(`Unknown LFO shape: ${shape}`);
  const cycleCount = Math.max(0, finiteOr(cycles, 4));
  const depth = clamp01(finiteOr(amount, 0.5));
  const mid = clamp01(finiteOr(center, 0.5));
  const perCycle = Math.max(1, Math.floor(finiteOr(pointsPerCycle, 16)));
  const offset = finiteOr(phase, 0);
  const steps = Math.max(1, Math.round(cycleCount * perCycle));
  const random = isRandom ? seededRandom(seed) : null;
  const levels = new Map();
  const levelFor = cycle => {
    if (!levels.has(cycle)) levels.set(cycle, random() * 2 - 1);
    return levels.get(cycle);
  };
  const wave = x => {
    if (isRandom) return levelFor(Math.floor(x));
    return WAVES[shape](x - Math.floor(x));
  };
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const fraction = i / steps;
    const x = fraction * cycleCount + offset;
    points.push(point(fraction * span, mid + depth * 0.5 * wave(x), isRandom ? 'hold' : 'linear'));
  }
  return points;
}

/** Straight ramp from `from` to `to` across [0, length]. `curve` is a point curve name. */
export function rampPoints({from = 0, to = 1, length, curve = 'linear'} = {}) {
  const span = requireLength(length);
  const kind = CURVES.has(curve) ? curve : 'linear';
  return [point(0, finiteOr(from, 0), kind), point(span, finiteOr(to, 1))];
}

/**
 * Staircase over [0, length]: `steps` held levels that step from `from` to `to`.
 * Each level holds until the next step, and the last level holds to the end.
 */
export function stairsPoints({steps = 4, length, from = 0, to = 1} = {}) {
  const span = requireLength(length);
  const count = Math.max(1, Math.floor(finiteOr(steps, 4)));
  const start = finiteOr(from, 0), end = finiteOr(to, 1);
  const levelAt = index => (count === 1 ? start : start + (end - start) * index / (count - 1));
  const points = [];
  for (let index = 0; index < count; index++) points.push(point(index * span / count, levelAt(index), 'hold'));
  points.push(point(span, levelAt(count - 1)));
  return points;
}
