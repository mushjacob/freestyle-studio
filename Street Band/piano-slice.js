import {sliceNotes,MIN_NOTE_DURATION} from './piano-tools.js';
const finite=value=>typeof value==='number'&&Number.isFinite(value),point=value=>value&&finite(value.beat)&&finite(value.row),clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
/** Slice a straight gesture through note rows. Each crossed row uses the line's
 * intersection at its center (or the reached endpoint inside that row), snapped
 * in beats. Recompute from the original score, never from preview fragments.
 * idForNote keeps each right fragment stable across provisional frames.
 */
export function slicePianoLine(notes,{from,to,snapBeats=.25,minDuration=MIN_NOTE_DURATION,idForNote}={}){
 if(!Array.isArray(notes)||!point(from)||!point(to)||!finite(snapBeats)||snapBeats<0||!finite(minDuration)||minDuration<=0)throw new TypeError('Piano slicing needs a complete score, finite line and nonnegative snap.');
 const dy=to.row-from.row,low=Math.min(from.row,to.row),high=Math.max(from.row,to.row),result=[],cuts=[],reserved=new Set(notes.flatMap(note=>[String(note?.id??''),String(note?.cloudRaw?.id??'')]));
 for(const note of notes){
  if(!note||note.id==null||!finite(note.start)||note.start<0||!finite(note.duration)||note.duration<=0||!Number.isInteger(note.pitch)||note.pitch<0||note.pitch>127)throw new TypeError('Load complete canonical note identities and timing before slicing.');
  const row=127-note.pitch;if(high<row||low>=row+1){result.push(note);continue;}
  const intersection=clamp(row+.5,low,high),beat=dy===0?to.beat:from.beat+(to.beat-from.beat)*(intersection-from.row)/dy,cut=snapBeats>0?Math.round(beat/snapBeats)*snapBeats:beat;
  if(cut<0||cut-note.start<minDuration-1e-10||note.start+note.duration-cut<minDuration-1e-10){result.push(note);continue;}
  const requested=idForNote?idForNote(note.id):globalThis.crypto?.randomUUID?.()||`note-${Date.now()}-${Math.random().toString(36).slice(2)}`,child=requested==null?'':String(requested);if(!child||reserved.has(child))throw new Error('Each sliced note needs an unused child event identity.');reserved.add(child);
  const fragments=sliceNotes([note],cut,{minDuration,idFactory:()=>child});if(fragments.length!==2){result.push(note);continue;}result.push(...fragments);cuts.push({noteId:note.id,childId:fragments[1].id,beat:cut});
 }
 return{notes:cuts.length?result:notes,cuts,from:{...from},to:{...to}};
}
