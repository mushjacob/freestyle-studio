/**
 * FL mixer taper calibrated against FL Studio 26.1.7 native getTrackVolume
 * readings (normalized position and dB, stopped Insert 1, November 2026).
 *
 * The exponential form from FL's installed utils.VolTodB, rescaled to the
 * native unity position .8, fits the native console's 101-point validation
 * within .000003 dB using actual normalized getter positions. The provenance
 * and rounded console checkpoints are in docs/fl-fader-native-calibration.json.
 * This is an empirical fit, not a claim about FL's internal implementation.
 * Positions above 1 are an explicit extension for Freestyle's gain ceiling 4;
 * they are not positions available on the native FL mixer fader.
 */
export const FL_FADER_UNITY_POSITION=.8;
export const FL_FADER_NATIVE_MAX_POSITION=1;
export const FL_FADER_ENGINE_MAX_GAIN=4;
const EXPONENT=Math.log(11)/FL_FADER_UNITY_POSITION;
export const FL_FADER_NATIVE_MAX_GAIN=Math.expm1(EXPONENT)/10;
export const FL_FADER_NATIVE_MAX_DB=20*Math.log10(FL_FADER_NATIVE_MAX_GAIN);
export const FL_FADER_EXTENDED_MAX_POSITION=Math.log1p(10*FL_FADER_ENGINE_MAX_GAIN)/EXPONENT;

function bounded(value,maximum,name){
 if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`${name} must be a finite number.`);
 if(value<0||value>maximum)throw new RangeError(`${name} must be between 0 and ${maximum}.`);
 return value;
}

/** Convert a position to linear gain; callers choose native or extended UI bounds. */
export function flFaderPositionToGain(position){
 bounded(position,FL_FADER_EXTENDED_MAX_POSITION,'Fader position');
 if(position===0)return 0;
 if(position===FL_FADER_UNITY_POSITION)return 1;
 if(position===FL_FADER_EXTENDED_MAX_POSITION)return FL_FADER_ENGINE_MAX_GAIN;
 return Math.expm1(EXPONENT*position)/10;
}

/** Inverse taper. A gain above the native maximum deliberately returns >1. */
export function flFaderGainToPosition(gain){
 bounded(gain,FL_FADER_ENGINE_MAX_GAIN,'Linear gain');
 if(gain===0)return 0;
 if(gain===1)return FL_FADER_UNITY_POSITION;
 if(gain===FL_FADER_ENGINE_MAX_GAIN)return FL_FADER_EXTENDED_MAX_POSITION;
 return Math.log1p(10*gain)/EXPONENT;
}

/** MixerStripView's display scale; engine callbacks still receive linear gain. */
export const flFaderLevelScale=Object.freeze({
 toPosition:flFaderGainToPosition,
 toGain:flFaderPositionToGain,
 maxPosition:FL_FADER_NATIVE_MAX_POSITION,
 step:.001,
});
