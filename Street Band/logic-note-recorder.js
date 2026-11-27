/**
 * MIDI take for software-instrument tracks (Logic: Record on a selected
 * software-instrument track captures what is played into a new MIDI region).
 * Pure bookkeeping: note-on/off with beat positions → notes relative to the
 * region start. Audio is the engine's; nothing is synthesised here.
 */
export const MIN_RECORDED_NOTE_BEATS=1/16;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const validPitch=pitch=>Number.isInteger(pitch)&&pitch>=0&&pitch<=127;

/** How far before the take start a key may go down and still count as "on the downbeat" (Logic keeps slightly early notes). */
export const EARLY_NOTE_BEATS=1/8;
/**
 * Count-in for a MIDI take (Logic: Record ▸ Count-in, ⇧K). Freestyle's count-in belongs to audio recording
 * (startRecording count_in_beats); a MIDI take has no recording call, so the count-in is a transport pre-roll:
 *  - 'preroll': play from (start − count-in beats); the take starts at `recordFromBeat` (the cloud metronome clicks if it is on);
 *  - 'wait': the take starts closer to the project start than the count-in is long, so there is nothing to pre-roll:
 *     the LCD counts the beats, then the transport starts at the take start;
 *  - 'none': Count-in is off, or the transport is already rolling (Logic counts in only from stop).
 */
export function midiCountInPlan({startBeat=0,countInBeats=0,rolling=false}={}){
 const start=Math.max(0,Number(startBeat)||0),beats=Number.isInteger(countInBeats)&&countInBeats>0&&!rolling?countInBeats:0;
 if(!beats)return{mode:'none',beats:0,playFromBeat:start,recordFromBeat:start};
 if(start-beats>=-1e-9)return{mode:'preroll',beats,playFromBeat:Math.max(0,start-beats),recordFromBeat:start};
 return{mode:'wait',beats,playFromBeat:start,recordFromBeat:start};
}
export class NoteTake{
 constructor({startBeat=0,earlyBeats=EARLY_NOTE_BEATS}={}){this.startBeat=Math.max(0,Number(startBeat)||0);this.earlyBeats=Math.max(0,Number(earlyBeats)||0);this.held=new Map();this.notes=[];this.finished=false;}
 get count(){return this.notes.length+this.held.size;}
 /** A key went down at absolute `beat` (clamped to the take start). A key played during the count-in (more than
  * `earlyBeats` before the start) is kept only if it is still held when the take starts. */
 noteOn(pitch,velocity,beat){
  if(this.finished||!validPitch(pitch)||!Number.isFinite(beat))return false;
  if(this.held.has(pitch))this.noteOff(pitch,beat);
  this.held.set(pitch,{pitch,velocity:clamp(Number(velocity)||.8,0,1),start:Math.max(this.startBeat,beat),countIn:beat<this.startBeat-this.earlyBeats});return true;
 }
 noteOff(pitch,beat){
  const open=this.held.get(pitch);if(!open||!Number.isFinite(beat))return false;this.held.delete(pitch);
  if(open.countIn&&beat<=this.startBeat)return false;// played and released inside the count-in: not part of the take
  this.notes.push({pitch:open.pitch,velocity:open.velocity,start:open.start,duration:Math.max(MIN_RECORDED_NOTE_BEATS,beat-open.start)});return true;
 }
 /** Notes so far (held keys run to `beat`), absolute beats, for the growing region. */
 preview(beat){
  const now=Number.isFinite(beat)?beat:this.startBeat;
  return [...this.notes,...[...this.held.values()].filter(open=>!open.countIn||now>this.startBeat).map(open=>({pitch:open.pitch,velocity:open.velocity,start:open.start,duration:Math.max(MIN_RECORDED_NOTE_BEATS,now-open.start)}))];
 }
 /** End the take at `beat`: held keys are released there. Returns notes in absolute beats, by start. */
 finish(beat){
  if(!this.finished){const end=Number.isFinite(beat)?Math.max(beat,this.startBeat):this.startBeat;for(const pitch of [...this.held.keys()])this.noteOff(pitch,end);this.finished=true;}
  return [...this.notes].sort((a,b)=>a.start-b.start||a.pitch-b.pitch);
 }
}

/** Region-relative Piano Roll notes ({id,start,duration,pitch,velocity}) for a region starting at `regionStart`. */
export function takeToRegionNotes(notes,{regionStart=0,uid=()=>globalThis.crypto?.randomUUID?.()||`note-${Date.now()}-${Math.random().toString(36).slice(2)}`}={}){
 return notes.map(note=>{const start=Math.max(0,note.start-regionStart),round=value=>Math.round(value*960)/960;return{id:uid(),start:round(start),duration:Math.max(MIN_RECORDED_NOTE_BEATS,round(note.duration)),pitch:note.pitch,velocity:clamp(note.velocity,0,1)};});
}
/** Whole bars needed to hold the notes (at least one). */
export function takeLengthBeats(notes,{beatsPerBar=4}={}){
 const end=notes.reduce((max,note)=>Math.max(max,note.start+note.duration),0);return Math.max(1,Math.ceil(end/beatsPerBar-1e-9))*beatsPerBar;
}
/** Paint recorded notes as bars into a region canvas (pitch range fitted, like a MIDI region thumbnail). */
export function paintTakeNotes(context,notes,{width,height,startBeat,lengthBeats,color='#5a0f0f'}){
 context.clearRect(0,0,width,height);if(!notes.length||!(lengthBeats>0)||!(width>0)||!(height>0))return 0;
 let low=127,high=0;for(const note of notes){if(note.pitch<low)low=note.pitch;if(note.pitch>high)high=note.pitch;}
 const span=Math.max(12,high-low+1),row=Math.max(2,Math.min(6,height/span));context.fillStyle=color;
 for(const note of notes){const x=(note.start-startBeat)/lengthBeats*width,w=Math.max(2,note.duration/lengthBeats*width),y=height-row-(note.pitch-low)/span*(height-row);context.fillRect(x,y,w,row);}
 return notes.length;
}
