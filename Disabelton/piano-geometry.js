// One geometry contract for piano rendering, hit testing and gesture previews.
export const PIANO_DEFAULT_BAR_WIDTH=188;
export const PIANO_ROW_HEIGHT=17;
// Disabelton: Live 12's narrow note-editor keyboard (≈40 CSS px incl. the C-octave label column).
// Every hit test, gesture inset, grid width and CSS --piano-key-width derive from this one value.
export const PIANO_KEY_WIDTH=40;
export const PIANO_NOTE_HEIGHT=15;
export const PIANO_NOTE_INSET=1;
export const PIANO_RULER_HEIGHT=20;
export const PIANO_PITCH_COUNT=128;
// Round 24: FL's taller velocity lane (stems use most of it, under the "Control ▸ Velocity" header).
export const PIANO_VELOCITY_PANEL_HEIGHT=150;
export const PIANO_VELOCITY_RANGE=128;
const validRowHeight=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<=0)throw new RangeError('Piano row height must be a finite positive number.');return value;};
/* Fold (Live: Fold to Notes / Fold to Scale): the note editor shows only some key tracks. `foldPitches` is the list of
 * shown pitches, highest first, or null for all 128. Rendering and every hit test go through the four helpers below,
 * so one row is one shown key track whether folded or not. */
let foldPitches=null;
const validPitch=pitch=>Number.isInteger(pitch)&&pitch>=0&&pitch<PIANO_PITCH_COUNT;
export function setPianoFold(pitches){foldPitches=Array.isArray(pitches)&&pitches.some(validPitch)?[...new Set(pitches.filter(validPitch))].sort((a,b)=>b-a):null;return foldPitches;}
export const pianoFold=()=>foldPitches;
export const pianoRowCount=()=>foldPitches?foldPitches.length:PIANO_PITCH_COUNT;
/** Row index (0 = top) of a pitch. A pitch that is not shown sits between its neighbours (half a row). */
export function pianoRowOfPitch(pitch){
 if(!foldPitches)return PIANO_PITCH_COUNT-1-pitch;
 const at=foldPitches.indexOf(pitch);if(at>=0)return at;
 let index=0;while(index<foldPitches.length&&foldPitches[index]>pitch)index++;return index-.5;
}
/** Pitch of the key track under a row position (float rows from the top), clamped to the shown rows. */
export function pianoPitchOfRow(row){
 const index=Math.floor(Number(row)||0);
 if(!foldPitches)return Math.max(0,Math.min(PIANO_PITCH_COUNT-1,PIANO_PITCH_COUNT-1-index));
 return foldPitches[Math.max(0,Math.min(foldPitches.length-1,index))];
}
/** The row a point would have with all 128 key tracks shown (row-based tools work in that space). */
export function pianoUnfoldedRow(row){if(!foldPitches)return row;const value=Number(row)||0;return PIANO_PITCH_COUNT-1-pianoPitchOfRow(value)+(value-Math.floor(value));}
/** The pitch `rows` key tracks below `pitch` (negative = above): a semitone per row unfolded, the next shown key track folded. */
export function pianoPitchShift(pitch,rows){
 if(!foldPitches)return Math.max(0,Math.min(PIANO_PITCH_COUNT-1,pitch-rows));
 return pianoPitchOfRow(Math.round(pianoRowOfPitch(pitch))+rows);
}
export const pianoNoteTop=(pitch,rowHeight=PIANO_ROW_HEIGHT)=>pianoRowOfPitch(pitch)*validRowHeight(rowHeight)+PIANO_NOTE_INSET;
export function applyPianoGeometry(element,{rowHeight=PIANO_ROW_HEIGHT}={}){
 rowHeight=validRowHeight(rowHeight);
 for(const [name,value]of Object.entries({'row-height':rowHeight,'key-width':PIANO_KEY_WIDTH,'note-height':Math.max(1,rowHeight-2),'ruler-height':PIANO_RULER_HEIGHT,'velocity-panel-height':PIANO_VELOCITY_PANEL_HEIGHT}))element.style.setProperty(`--piano-${name}`,`${value}px`);
}
