// One geometry contract for piano rendering, hit testing and gesture previews.
export const PIANO_DEFAULT_BAR_WIDTH=188;
export const PIANO_ROW_HEIGHT=17;
// Round 25: FL 2026's keyboard, measured on fl-piano.png (146 Retina px = 73 CSS px).
export const PIANO_KEY_WIDTH=73;
export const PIANO_NOTE_HEIGHT=15;
export const PIANO_NOTE_INSET=1;
export const PIANO_RULER_HEIGHT=20;
export const PIANO_PITCH_COUNT=128;
// Round 24: FL's taller velocity lane (stems use most of it, under the "Control ▸ Velocity" header).
export const PIANO_VELOCITY_PANEL_HEIGHT=150;
export const PIANO_VELOCITY_RANGE=128;
const validRowHeight=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<=0)throw new RangeError('Piano row height must be a finite positive number.');return value;};
export const pianoNoteTop=(pitch,rowHeight=PIANO_ROW_HEIGHT)=>(PIANO_PITCH_COUNT-1-pitch)*validRowHeight(rowHeight)+PIANO_NOTE_INSET;
export function applyPianoGeometry(element,{rowHeight=PIANO_ROW_HEIGHT}={}){
 rowHeight=validRowHeight(rowHeight);
 for(const [name,value]of Object.entries({'row-height':rowHeight,'key-width':PIANO_KEY_WIDTH,'note-height':Math.max(1,rowHeight-2),'ruler-height':PIANO_RULER_HEIGHT,'velocity-panel-height':PIANO_VELOCITY_PANEL_HEIGHT}))element.style.setProperty(`--piano-${name}`,`${value}px`);
}
