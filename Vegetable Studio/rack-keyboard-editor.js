/** FL's Channel Rack keyboard editor: each step's pitch as a small draggable bar. Pure: no DOM, no I/O. */
export const KEYBOARD_RANGE={low:36,high:84};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clampPitch=pitch=>Math.max(0,Math.min(127,Math.round(pitch)));
const stepIndex=note=>{const index=Number(note?.start)*4;return Number.isFinite(index)&&Math.abs(index-Math.round(index))<1e-6&&index>=0?Math.round(index):null;};
/** One column per visible step index: the pitch of the first note on that step, or null when no note sits there. */
export function stepPitchColumns(notes,indices){
 const byIndex=new Map();
 for(const note of notes||[]){const index=stepIndex(note);if(index!==null&&!byIndex.has(index)&&finite(Number(note.pitch)))byIndex.set(index,Number(note.pitch));}
 return indices.map(index=>({index,pitch:byIndex.has(index)?byIndex.get(index):null}));
}
/** Bar height as 0..1 of the strip. */
export const barFraction=(pitch,range=KEYBOARD_RANGE)=>Math.max(0,Math.min(1,(pitch-range.low)/(range.high-range.low)));
/** The pitch under a pointer y inside the strip (top = high). */
export function pitchFromY(y,height,range=KEYBOARD_RANGE){
 if(!finite(y)||!finite(height)||height<=0)throw new Error('The keyboard editor needs a visible strip.');
 const amount=Math.max(0,Math.min(1,1-y/height));return clampPitch(range.low+amount*(range.high-range.low));
}
/** Copy of notes with every note on that step moved to `pitch`; other notes and all other fields are untouched. */
export function setStepPitch(notes,index,pitch){
 if(!Number.isInteger(index)||index<0||!finite(pitch))throw new Error('Choose a step and a finite pitch.');
 const target=clampPitch(pitch);let changed=false;
 const next=notes.map(note=>{if(stepIndex(note)!==index||Number(note.pitch)===target)return note;changed=true;return {...note,pitch:target};});
 return changed?next:notes;
}
