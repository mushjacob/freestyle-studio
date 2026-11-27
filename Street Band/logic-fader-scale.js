/**
 * Logic Pro channel-strip fader taper (display only).
 *
 * Logic's volume fader is marked +6 at the top, then 3, 0, 3, 6 … 24 in 3 dB
 * steps (evenly spaced), then 30, 35, 40, 45, 50, 60 with slightly wider
 * spacing, and −∞ at the bottom. This module reproduces that look as a
 * piecewise-linear map between dB breakpoints (weights measured from Logic's
 * Inspector strip: 3 dB steps ≈ 10 units, −24→−30 ≈ 14, 5 dB steps ≈ 11,
 * −50→−60 ≈ 12, −60→−∞ ≈ 10). Below −60 dB the position is linear in
 * amplitude down to silence. Engine values stay exact linear gain: only the
 * fader position is mapped; dB readouts come from the gain itself.
 *
 * Positions above 1 (beyond +6 dB) continue at the 3 dB spacing so the
 * engine's gain ceiling (4 = +12.04 dB) still has a position; the visible
 * fader stops at maxPosition 1 (+6 dB), as in Logic.
 */
export const LOGIC_FADER_MAX_DB=6;
export const LOGIC_FADER_ENGINE_MAX_GAIN=4;
/** [dB at the segment's top, weight of the segment below it]. */
const SEGMENTS=Object.freeze([[6,10],[3,10],[0,10],[-3,10],[-6,10],[-9,10],[-12,10],[-15,10],[-18,10],[-21,10],[-24,14],[-30,11],[-35,11],[-40,11],[-45,11],[-50,12],[-60,10]]);
const TOTAL=SEGMENTS.reduce((sum,[,weight])=>sum+weight,0);
/** Breakpoints top→bottom: {db, position}. The last (−60 dB) sits above the −∞ segment. */
const BREAKPOINTS=(()=>{let below=TOTAL;return SEGMENTS.map(([db,weight])=>{const point={db,position:below/TOTAL};below-=weight;return point;});})();
const FLOOR=BREAKPOINTS.at(-1),FLOOR_GAIN=10**(FLOOR.db/20),STEP_PER_DB=10/3/TOTAL;
/** Positions are kept to 12 decimals so a position → gain → position round trip is exact for slider values. */
const tidy=position=>Math.round(position*1e12)/1e12;
export const LOGIC_FADER_UNITY_POSITION=tidy(BREAKPOINTS.find(point=>point.db===0).position);
export const LOGIC_FADER_EXTENDED_MAX_POSITION=tidy(1+(20*Math.log10(LOGIC_FADER_ENGINE_MAX_GAIN)-LOGIC_FADER_MAX_DB)*STEP_PER_DB);
/** Logic's printed scale marks (dB), top to bottom. */
export const LOGIC_FADER_TICKS=Object.freeze([6,3,0,-3,-6,-9,-12,-15,-18,-21,-24,-30,-35,-40,-45,-50,-60]);

function finiteIn(value,min,max,name){
 if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`${name} must be a finite number.`);
 if(value<min||value>max)throw new RangeError(`${name} must be between ${min} and ${max}.`);
 return value;
}

/** Linear gain → fader position (0 = −∞, unity ≈ .889, 1 = +6 dB, >1 only for gains above +6 dB). */
export function logicFaderGainToPosition(gain){
 finiteIn(gain,0,LOGIC_FADER_ENGINE_MAX_GAIN,'Linear gain');
 if(gain===0)return 0;
 if(gain===1)return LOGIC_FADER_UNITY_POSITION;
 if(gain===LOGIC_FADER_ENGINE_MAX_GAIN)return LOGIC_FADER_EXTENDED_MAX_POSITION;
 if(gain<=FLOOR_GAIN)return tidy(FLOOR.position*gain/FLOOR_GAIN);
 const db=20*Math.log10(gain);
 if(db>=LOGIC_FADER_MAX_DB)return tidy(1+(db-LOGIC_FADER_MAX_DB)*STEP_PER_DB);
 for(let i=1;i<BREAKPOINTS.length;i++){const top=BREAKPOINTS[i-1],bottom=BREAKPOINTS[i];if(db>=bottom.db)return tidy(bottom.position+(db-bottom.db)/(top.db-bottom.db)*(top.position-bottom.position));}
 return tidy(FLOOR.position);
}

/** Fader position → linear gain (exact inverse of logicFaderGainToPosition). */
export function logicFaderPositionToGain(position){
 finiteIn(position,0,LOGIC_FADER_EXTENDED_MAX_POSITION,'Fader position');
 if(position===0)return 0;
 if(position===LOGIC_FADER_UNITY_POSITION)return 1;
 if(position===LOGIC_FADER_EXTENDED_MAX_POSITION)return LOGIC_FADER_ENGINE_MAX_GAIN;
 if(position<=FLOOR.position)return FLOOR_GAIN*position/FLOOR.position;
 let db;
 if(position>=1)db=LOGIC_FADER_MAX_DB+(position-1)/STEP_PER_DB;
 else for(let i=1;i<BREAKPOINTS.length;i++){const top=BREAKPOINTS[i-1],bottom=BREAKPOINTS[i];if(position>=bottom.position){db=bottom.db+(position-bottom.position)/(top.position-bottom.position)*(top.db-bottom.db);break;}}
 return Math.min(LOGIC_FADER_ENGINE_MAX_GAIN,10**(db/20));
}

/** Logic's dB readout: "0.0", "-6.0", "3.5", "-∞" (no unit, as on the channel strip). */
export function logicLevelText(gain){
 if(typeof gain!=='number'||!Number.isFinite(gain)||gain<0)return '—';
 if(gain===0)return '-∞';
 const db=Math.round(20*Math.log10(gain)*10)/10;
 return Object.is(db,-0)||db===0?'0.0':db.toFixed(1);
}

/** MixerStripView levelScale: engine callbacks still receive linear gain. */
export const logicFaderLevelScale=Object.freeze({
 toPosition:logicFaderGainToPosition,
 toGain:logicFaderPositionToGain,
 maxPosition:1,
 step:.001,
 ticks:LOGIC_FADER_TICKS,
 labels:LOGIC_FADER_TICKS,
});
