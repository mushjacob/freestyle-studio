/** Read-only waveform overload indicators, not Analyze > Find Clipping.
 * Audacity 3.2.1 commit 969e36f4968e66375a794a938dd906a3556e0bbc:
 * libraries/lib-utility/MemoryX.h: MAX_AUDIO (line 546);
 * src/tracks/playabletrack/wavetrack/ui/WaveformView.cpp:
 *   DrawMinMaxRMS (lines 370–388, 468–478),
 *   DrawIndividualSamples (lines 536–544, 595–603);
 * libraries/lib-theme/AllThemeResources.h: clrClipped/clrMuteClipped.
 * https://github.com/audacity/audacity/tree/969e36f4968e66375a794a938dd906a3556e0bbc
 *
 * Native cache/sample values are Float32, envelope values are double. The
 * threshold is applied to their product before any vertical view transform;
 * it does not depend on linear/dB scale, zoom, sample points, RMS, track gain
 * or pan. Callers draw full channel-height lines at the overloaded columns.
 * This module computes display flags only and never modifies source audio.
 */
export const NATIVE_CLIPPING_THRESHOLD = 1 - 1 / (1 << 15);
export const NATIVE_CLIPPING_COLORS = Object.freeze({normal:'#ff0000',muted:'#888890'});

function sampleValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('A clipping display sample must be finite.');
  }
  const result = Math.fround(value);
  if (!Number.isFinite(result)) throw new RangeError('A clipping display sample exceeds Float32 precision.');
  return result;
}

function envelopeValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError('A clipping display envelope multiplier must be finite and nonnegative.');
  }
  return value;
}

/** Sample-detail drawing uses the envelope evaluated at the sample time. */
export function isClippedSample(sample, envelope = 1) {
  const value = sampleValue(sample) * envelopeValue(envelope);
  return value <= -NATIVE_CLIPPING_THRESHOLD || value >= NATIVE_CLIPPING_THRESHOLD;
}

/** Extrema drawing uses one envelope value per displayed pixel column.
 * This tests actual extrema, not an RMS value or interpolation between them.
 */
export function isClippedColumn(min, max, envelope = 1) {
  const lower = sampleValue(min), upper = sampleValue(max), multiplier = envelopeValue(envelope);
  if (lower > upper) throw new RangeError('Waveform extrema must be ordered.');
  return lower * multiplier <= -NATIVE_CLIPPING_THRESHOLD || upper * multiplier >= NATIVE_CLIPPING_THRESHOLD;
}

/** Default theme colors; a theme may supply different native pen colors.
 * Native muted means (anyTrackSolo || trackMute) && !trackSolo.
 */
export function clippingColor({muted = false} = {}) {
  return muted ? NATIVE_CLIPPING_COLORS.muted : NATIVE_CLIPPING_COLORS.normal;
}
