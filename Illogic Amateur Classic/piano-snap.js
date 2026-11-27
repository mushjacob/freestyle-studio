/** Local Piano roll snap, measured in quarter-note beats.
 * Native modes and step/beat units:
 * https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/pianoroll_menu.htm#PianoRoll_Snap
 * https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/toolbar_panels.htm#panel_snap
 *
 * Line rounds to the displayed grid; Cell uses the beginning of its cell.
 * FL changes that grid with zoom, but its exact zoom thresholds are not public.
 * Callers must supply their actual displayed gridBeats (currently .25), rather
 * than infer an allegedly native resolution from barWidth. Events and Markers
 * require event/marker targets and are deliberately outside this numeric API.
 */
const modes=[
 ['main','Main'],['line','Line'],['cell','Cell'],['none','(none)'],
 ['1/6-step','1/6 step'],['1/4-step','1/4 step'],['1/3-step','1/3 step'],['1/2-step','1/2 step'],['step','Step'],
 ['1/6-beat','1/6 beat'],['1/4-beat','1/4 beat'],['1/3-beat','1/3 beat'],['1/2-beat','1/2 beat'],['beat','Beat'],['bar','Bar'],
];
export const PIANO_SNAP_MODES=Object.freeze(modes.map(([id,label])=>Object.freeze({id,label})));
const fixed=new Map([['1/6-step',1/24],['1/4-step',1/16],['1/3-step',1/12],['1/2-step',1/8],['step',1/4],['1/6-beat',1/6],['1/4-beat',1/4],['1/3-beat',1/3],['1/2-beat',1/2],['beat',1]]);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const positive=(value,name)=>{if(!finite(value)||value<=0)throw new RangeError(`${name} must be positive finite quarter-note beats.`);return value;};

/** Return a grid interval in quarter-note beats, or 0 for free placement.
 * Main reads the caller's current numeric mainSnap (including 0).
 * gridBeats is the actual displayed subdivision for Line/Cell, default .25.
 * beatsPerBar is the current meter expressed in quarter notes, default 4.
 * barWidth does not affect this resolver until a measured adaptive grid exists.
 * None preserves continuous/fractional ticks; this helper does not alter PPQ.
 */
export function resolvePianoSnap(mode='main',{mainSnap,gridBeats=.25,beatsPerBar=4}={}){
 if(mode==='main'){if(!finite(mainSnap)||mainSnap<0)throw new RangeError('Main snap must be finite nonnegative quarter-note beats.');return mainSnap;}
 if(mode==='none')return 0;
 if(mode==='line'||mode==='cell')return positive(gridBeats,'Displayed grid');
 if(mode==='bar')return positive(beatsPerBar,'Bar length');
 if(fixed.has(mode))return fixed.get(mode);
 throw new RangeError(`Unsupported Piano roll snap mode: ${String(mode)}`);
}

/** Quantize an absolute nonnegative musical position. This does not change
 * authored offsets during note-group movement: callers snap deltas separately.
 * Main deliberately retains the existing global nearest-grid behavior.
 */
export function quantizePianoPosition(beat,mode='main',options={}){
 if(!finite(beat)||beat<0)throw new RangeError('Piano position must be finite nonnegative quarter-note beats.');
 const grid=resolvePianoSnap(mode,options);if(grid===0)return beat;
 const cells=beat/grid;if(!finite(cells))throw new RangeError('Piano position exceeds the supported grid range.');
 // Absorb division noise at an exact cell boundary, without a musical epsilon.
 const tolerance=Number.EPSILON*Math.max(1,Math.abs(cells))*8;
 const result=(mode==='cell'?Math.floor(cells+tolerance):Math.round(cells))*grid;
 if(!finite(result))throw new RangeError('Piano position exceeds the supported grid range.');return result;
}
