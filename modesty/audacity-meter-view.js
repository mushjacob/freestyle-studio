/** Read-only output-meter view over an existing engine peak receipt.
 * Audacity 3.2.1 commit 969e36f4968e66375a794a938dd906a3556e0bbc:
 * src/widgets/MeterPanel.cpp:ClipZeroToOne/ToDB (1013–1032),
 *   SetActiveStyle (1256–1294), horizontal layout (1591–1594, 1652–1655);
 * src/widgets/Ruler.cpp:TickSizes LinearDBFormat (390–456),
 *   LabelString (623–632), UpdateLinear (1070–1231);
 * libraries/lib-utility/MemoryX.h:LINEAR_TO_DB.
 * https://github.com/audacity/audacity/tree/969e36f4968e66375a794a938dd906a3556e0bbc
 *
 * This module does not compute audio peaks, RMS, hold, decay, stereo channels,
 * input monitoring, or clipping events. Those require real engine receipts.
 */

function nativeRange(dbRange) {
  if (typeof dbRange !== 'number' || !Number.isFinite(dbRange) || dbRange <= 0) {
    throw new RangeError('The meter dB range must be finite and positive.');
  }
  const range = Math.fround(dbRange);
  if (!Number.isFinite(range) || range <= 0) throw new RangeError('The meter dB range exceeds Float32 precision.');
  return range;
}

/** Native ToDB takes Float32 peak/range, computes the logarithm in double,
 * then converts the normalized result to Float32 before clamping to [0,1].
 * A peak is already a nonnegative magnitude; a nonpositive receipt is silence.
 */
export function meterLevelPercent(peak, dbRange = 60) {
  if (typeof peak !== 'number' || !Number.isFinite(peak)) throw new TypeError('The engine meter peak must be finite.');
  const value = Math.fround(peak), range = nativeRange(dbRange);
  if (!Number.isFinite(value)) throw new RangeError('The engine meter peak exceeds Float32 precision.');
  const db = value > 0 ? 20 * Math.log10(Math.abs(value)) : -999;
  const normalized = Math.fround((db + range) / range);
  return Math.max(0, Math.min(1, normalized)) * 100;
}

function linearDbTickSizes(units) {
  // Strict inequalities and the 6/12/24 dB sequence are native policy.
  for (const [limit, minor, major] of [
    [.001, .001, .005], [.01, .01, .05], [.1, .1, .5],
    [1, 1, 6], [3, 3, 12], [6, 6, 24], [12, 12, 48], [24, 24, 96],
  ]) if (units < limit) return {minor, major};
  let step = 20;
  for (;;) {
    if (units < step) return {minor:step, major:step * 5};
    step *= 5;
    if (units < step) return {minor:step, major:step * 5};
    step *= 2;
  }
}

/** Numeric candidates for the native horizontal LinearDBFormat ruler.
 * width is the drawable meter-bar pixel width; native bounds use right=width−1.
 * Native labels both endpoints before walking major then minor pixel crossings.
 * We expose that precedence so the DOM renderer can suppress colliding labels.
 * wxDC font metrics, label bounding boxes, off-limits icon pixels and the native
 * crowded-minor-label suppression require a layout renderer and are not claimed
 * to be reproduced by these numeric candidates.
 */
export function meterRulerTicks(width, dbRange = 60) {
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 0) {
    throw new RangeError('The meter ruler width must be finite and nonnegative.');
  }
  const range = nativeRange(dbRange), length = Math.trunc(width) - 1;
  if (length < 1) return {ticks:[], minor:0, major:0};
  const upp = range / length, {minor, major} = linearDbTickSizes(22 * upp);
  const ticks = new Map();
  const label = value => {
    if (value < 0 && value + minor > 0) value = 0;
    return minor >= 1 ? String(Math.floor(value + .5)) : value.toFixed(Math.max(0, Math.trunc(-Math.log10(minor))));
  };
  const add = (x, value, isMajor, priority) => {
    if (x < 0 || x > length) return;
    const previous = ticks.get(x);
    if (!previous || previous.priority < priority) ticks.set(x, {x, label:label(value), value, major:isMajor, priority});
  };
  add(0, -range, true, 100);
  add(length, 0, true, 100);
  for (const [denominator, isMajor] of [[major, true], [minor, false]]) {
    let value = -range - upp / 2, step = Math.floor(value / denominator);
    // This is native's pixel walk, including its running-double rounding.
    // A direct value-to-x rounding formula can choose a different half pixel.
    for (let pixel = 0; pixel <= length + 1; pixel++) {
      value += upp;
      const next = Math.floor(value / denominator);
      if (next > step) {
        step = next;
        add(pixel, step * denominator, isMajor, isMajor ? 50 : 10);
      }
    }
  }
  return {ticks:[...ticks.values()].sort((a, b) => a.x - b.x), minor, major};
}
