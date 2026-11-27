/** Logic Pro Piano Roll Functions ▸ MIDI Transform ▸ Humanize…
 *
 * Logic's Humanize transform set randomizes Position, Velocity and Length of the
 * selected notes by ±10 each (position and length in Logic ticks, 960 per quarter
 * note; velocity in MIDI steps). It is a client-side transform: the result is
 * saved through the app's existing note edit path as ONE Undo step.
 */
export const LOGIC_TICKS_PER_BEAT=960;
export const LOGIC_HUMANIZE_DEFAULTS=Object.freeze({position:10,velocity:10,length:10});
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const range=(value,max)=>Math.max(0,Math.min(max,Math.round(finite(value)?value:0)));
/** A uniformly random integer in [-amount, +amount]; `random` returns [0, 1). */
export function randomOffset(amount,random=Math.random){if(!(amount>0))return 0;return Math.min(amount,Math.floor(random()*(2*amount+1))-amount);}

/**
 * Humanize notes ({start, duration} in beats, velocity 0–1). Starts never go
 * below 0, lengths stay at least one tick, velocities stay in 1…127.
 * @param {object} options {position, velocity, length} (± ticks / ± MIDI steps), random
 */
export function humanizeNotes(notes,{position=LOGIC_HUMANIZE_DEFAULTS.position,velocity=LOGIC_HUMANIZE_DEFAULTS.velocity,length=LOGIC_HUMANIZE_DEFAULTS.length,random=Math.random}={}){
 const p=range(position,960),v=range(velocity,127),l=range(length,960),tick=1/LOGIC_TICKS_PER_BEAT,round=value=>Math.round(value*1e9)/1e9;
 return (Array.isArray(notes)?notes:[]).map(note=>{
  const next={...note};
  if(p&&finite(note.start))next.start=round(Math.max(0,note.start+randomOffset(p,random)*tick));
  if(v&&finite(note.velocity)){const midi=Math.max(1,Math.min(127,Math.round(note.velocity*127)+randomOffset(v,random)));next.velocity=Math.round(midi/127*1e6)/1e6;}
  if(l&&finite(note.duration))next.duration=round(Math.max(tick,note.duration+randomOffset(l,random)*tick));
  return next;
 });
}

/**
 * The Humanize… dialog. `dialog(title, html)` is the application's dialog helper
 * (returns the <dialog>); onApply({position, velocity, length}) runs the transform.
 */
export function openHumanizeDialog(dialog,{onApply,selection=0}={}){
 const field=(id,label,max,value,unit)=>`<label for="${id}">${label} <small>± ${unit}</small></label><input id="${id}" type="number" min="0" max="${max}" step="1" value="${value}">`;
 const d=dialog('MIDI Transform — Humanize',`<p>Randomize ${selection?`${selection} selected note${selection===1?'':'s'}`:'every note of this region'} (Logic’s Humanize: Position, Velocity and Length).</p>${field('humanize-position','Position',960,LOGIC_HUMANIZE_DEFAULTS.position,'ticks (960 per beat)')}${field('humanize-velocity','Velocity',127,LOGIC_HUMANIZE_DEFAULTS.velocity,'MIDI steps')}${field('humanize-length','Length',960,LOGIC_HUMANIZE_DEFAULTS.length,'ticks')}<button id="humanize-apply" class="primary">Operate Only</button>`);
 const read=id=>Number(d.querySelector('#'+id)?.value);
 d.querySelector('#humanize-apply').onclick=()=>{const options={position:read('humanize-position'),velocity:read('humanize-velocity'),length:read('humanize-length')};if(Object.values(options).some(value=>!Number.isFinite(value)||value<0))return;d.close();onApply?.(options);};
 return d;
}
