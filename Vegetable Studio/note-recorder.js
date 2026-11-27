/** Pure note capture for FL's "Record Notes" (no DOM, no I/O).
 * Beats are pattern-timeline beats that only move forward. With `loop`, a note
 * starts at `beat mod patternLengthBeats` while its duration is measured on the
 * unwrapped timeline, so a note held across the loop point keeps its length.
 */
import {MIN_NOTE_DURATION} from './piano-tools.js';
export {MIN_NOTE_DURATION};
const finite=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
const clamp01=(value,fallback)=>Math.max(0,Math.min(1,finite(value,fallback)));
export class NoteRecorder{
 constructor(){this.active=false;this.reset();}
 reset(){this.startBeat=0;this.patternLengthBeats=0;this.loop=false;this.open=new Map();this.notes=[];}
 get recording(){return this.active;}
 start({startBeat=0,patternLengthBeats=0,loop=false}={}){
  this.reset();this.active=true;this.startBeat=Math.max(0,finite(startBeat,0));
  const length=finite(patternLengthBeats,0);this.patternLengthBeats=length>0?length:0;this.loop=!!loop&&this.patternLengthBeats>0;
 }
 clampBeat(beat){return Math.max(this.startBeat,finite(beat,this.startBeat));}
 noteOn(pitch,velocity,beat){
  if(!this.active)return false;const p=Math.round(finite(pitch,NaN));if(!(p>=0&&p<=127))return false;
  const queue=this.open.get(p)||[];queue.push({start:this.clampBeat(beat),velocity:clamp01(velocity,.8)});this.open.set(p,queue);return true;
 }
 /** Releases pair first-in first-out, so overlapping presses of one pitch (two keys, one pitch) each get their own note. */
 noteOff(pitch,beat){
  if(!this.active)return false;const p=Math.round(finite(pitch,NaN)),queue=this.open.get(p);if(!queue?.length)return false;
  this.finish(p,queue.shift(),this.clampBeat(beat));if(!queue.length)this.open.delete(p);return true;
 }
 finish(pitch,held,end){
  const raw=Math.max(MIN_NOTE_DURATION,end-held.start),duration=this.loop?Math.min(raw,this.patternLengthBeats):raw;
  const start=this.loop?((held.start%this.patternLengthBeats)+this.patternLengthBeats)%this.patternLengthBeats:held.start;
  this.notes.push({pitch,start,duration,velocity:held.velocity});
 }
 /** Closes still-held notes at endBeat and returns every captured note ordered by start then pitch. */
 stop(endBeat){
  if(!this.active)return[];const end=this.clampBeat(endBeat);
  for(const [pitch,queue] of this.open)for(const held of queue)this.finish(pitch,held,end);
  const notes=this.notes.sort((a,b)=>a.start-b.start||a.pitch-b.pitch);this.active=false;this.open=new Map();this.notes=[];return notes;
 }
}
/** FL's "Dump score log": every played note of the last SCORE_LOG_WINDOW_SECONDS, independent of recording. Events are {pitch,velocity,time,end?} in seconds. */
export const SCORE_LOG_WINDOW_SECONDS=300;
export function pruneScoreLog(events,now,windowSeconds=SCORE_LOG_WINDOW_SECONDS){const cutoff=finite(now,0)-windowSeconds;return events.filter(event=>finite(event.end??event.time,0)>=cutoff);}
/** Converts logged seconds to beats at bpm (earliest note at beat 0, nothing quantized). Notes still held end at `now` (default: the latest logged time). */
export function scoreLogToNotes(events,{bpm,now}={}){
 const tempo=Number(bpm);if(!(tempo>0)||!Number.isFinite(tempo))throw new RangeError('scoreLogToNotes needs a positive finite bpm.');
 const valid=(events||[]).filter(event=>{const p=Math.round(finite(event?.pitch,NaN));return p>=0&&p<=127&&Number.isFinite(Number(event.time));});if(!valid.length)return[];
 const origin=Math.min(...valid.map(event=>Number(event.time))),latest=Math.max(...valid.map(event=>Math.max(Number(event.time),finite(event.end,-Infinity)))),held=finite(now,latest),perSecond=tempo/60;
 return valid.map(event=>{const time=Number(event.time),end=event.end==null||!Number.isFinite(Number(event.end))?Math.max(held,time):Number(event.end);
  return{pitch:Math.round(Number(event.pitch)),start:(time-origin)*perSecond,duration:Math.max(MIN_NOTE_DURATION,(end-time)*perSecond),velocity:clamp01(event.velocity,.8)};
 }).sort((a,b)=>a.start-b.start||a.pitch-b.pitch);
}
