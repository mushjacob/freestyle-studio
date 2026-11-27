import {pianoNoteTop} from './piano-geometry.js';
/** FL ghost channels: read-only note references from this pattern's other channels.
 * Image-Line reference: pianoroll_menu.htm > View > Helpers > Ghost channels.
 * Step hits without an explicit pitch/duration are not piano-roll notes.
 */
import {assertCompleteCanonicalData,assertCompletePattern} from './cloud-session.js';

const number=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function isPianoGhostToggle(event){
 return !!event?.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.repeat&&(event.code==='KeyV'||String(event.key).toLowerCase()==='v');
}

/** Return fresh display DTOs; channel mute/solo and rack filters do not hide scores. */
export function pianoGhostNotes(pattern,activeChannel,{enabled=true}={}){
 if(!enabled)return[];
 if(pattern?.cloudRaw)assertCompletePattern(pattern.cloudRaw);
 assertCompleteCanonicalData(pattern?.notes,'piano-roll notes');
 const active=String(activeChannel?.id??activeChannel??''),source=String(pattern?.cloudSources?.[active]??active),notes=[];
 for(const [channelId,score]of Object.entries(pattern?.notes||{})){
  if(channelId===active||String(pattern?.cloudSources?.[channelId]??channelId)===source||!Array.isArray(score))continue;
  for(const note of score){
   if(!note||!number(note.start)||Number(note.start)<0||!number(note.duration)||Number(note.duration)<=0||!number(note.pitch)||!Number.isInteger(Number(note.pitch))||Number(note.pitch)<0||Number(note.pitch)>127)continue;
   // A normalized default pitch must never turn an unpitched native step into
   // a made-up ghost note. Pending UI edits retain their explicit note geometry.
   if(note.cloudRaw&&(!number(note.cloudRaw.note??note.cloudRaw.pitch)||!number(note.cloudRaw.startTick??note.cloudRaw.start_tick)||!number(note.cloudRaw.durationTick??note.cloudRaw.duration_tick)))continue;
   notes.push({id:String(note.id??''),channelId,start:Number(note.start),duration:Number(note.duration),pitch:Number(note.pitch),muted:!!(note.muted??note.cloudRaw?.muted)});
  }
 }
 return notes;
}

/** Safe for a render path: incomplete cloud summaries produce no partial score. */
export function pianoGhostMarkup(pattern,activeChannel,options){
 let notes;try{notes=pianoGhostNotes(pattern,activeChannel,options);}catch{return'';}
 if(!notes.length)return'';
 return `<div class="piano-ghost-layer" aria-hidden="true">${notes.map(note=>`<div class="piano-ghost-note${note.muted?' muted':''}" data-ghost-channel="${escape(note.channelId)}" data-ghost-note="${escape(note.id)}" style="left:calc(${note.start/4} * var(--bar));top:${pianoNoteTop(note.pitch,options?.rowHeight)}px;width:calc(${note.duration/4} * var(--bar))"></div>`).join('')}</div>`;
}
