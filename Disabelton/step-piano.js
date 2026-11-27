/** Editable Piano views of sample Rack steps. View markers never reach Freestyle.
 * FL's default step pitch is MIDI 60 (displayed C5), with unity sample playback.
 * Opening the Piano leaves the original unpitched event, including absent fields,
 * unchanged. Only an authored pitch/time/length edit becomes a pitched event.
 */
const clone=value=>value==null||typeof value!=='object'?value:Array.isArray(value)?value.map(clone):Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)]));
const velocity=step=>typeof step==='number'?step:100/128;
const freshId=()=>globalThis.crypto?.randomUUID?.()||`step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const rawPattern=pattern=>{const raw=pattern.cloudRaw||{};return raw.data?.pattern?raw.data:raw;};
const states=pattern=>pattern.cloudStepPiano||[];
/** FL: a sample step toggled off and on again in this page session keeps its saved
 * event (id, pan, pitch…). Keyed pattern|source|tick; bounded. Shared by the
 * serializer (which retires) and the Piano step projection (which reuses the id). */
export const RETIRED_SAMPLE_STEPS=new Map();
export const retiredStepKey=(pattern,sourceId,tick)=>`${pattern?.cloudId||pattern?.id}|${sourceId}|${tick}`;
export function retireSampleStep(key,event){RETIRED_SAMPLE_STEPS.delete(key);RETIRED_SAMPLE_STEPS.set(key,clone(event));while(RETIRED_SAMPLE_STEPS.size>2048)RETIRED_SAMPLE_STEPS.delete(RETIRED_SAMPLE_STEPS.keys().next().value);}
/** The retired event for this cell, unless an event with its id is already saved. */
export function retiredSampleStep(key,events=[]){const event=RETIRED_SAMPLE_STEPS.get(key);return event&&!events.some(item=>String(item?.id)===String(event.id))?clone(event):null;}
export const isStepPianoNote=note=>!!note?._stepPiano&&String(note.id)===String(note._stepPiano.id);
function convert(note){
 const marker=note._stepPiano;if(!marker)return;
 // A Rack hit is untransposed even when the sample source has a different root.
 // Supply that baseline to the existing pitched serializer, retaining tuning and
 // unknown event metadata; it computes any deliberately authored transposition.
 note.cloudRaw={...(note.cloudRaw||{}),id:note.id,note:60,pitch:60,playbackRate:note.cloudRaw?.playbackRate??1};
 delete note._stepPiano;
}
/** Reconcile edits before serialization or submitting an ordinary retained edit. */
export function reconcileStepPiano(pattern){
 for(const state of states(pattern)){
  const notes=pattern.notes?.[state.channelId]||[],steps=pattern.steps?.[state.channelId]||[],retained=[];
  for(const entry of state.entries){
   const note=notes.find(note=>String(note.id)===String(entry.id)&&isStepPianoNote(note)&&String(note._stepPiano.sourceId)===String(state.sourceId));
   const active=steps[entry.index],rackChanged=active!==entry.step;
   if(!note){if(!rackChanged)steps[entry.index]=false;continue;}
   const geometryChanged=Number(note.start)!==entry.index/4||Number(note.duration)!==.25||Number(note.pitch)!==60;
   const velocityChanged=Number(note.velocity)!==entry.velocity;
   if(geometryChanged){
    if(rackChanged)throw new Error('This Rack step and its Piano note changed together. Reload the current pattern before editing it.');
    steps[entry.index]=false;convert(note);continue;
   }
   if(rackChanged){
    if(!active){notes.splice(notes.indexOf(note),1);continue;}
    note.velocity=velocity(active);
   }else if(velocityChanged){
    if(!Number.isFinite(Number(note.velocity))||Number(note.velocity)<0||Number(note.velocity)>1)throw new RangeError('Step velocity must be between zero and one.');
    // Zero is an authored silent note, not the Rack's inactive sentinel.
    if(Number(note.velocity)===0){steps[entry.index]=false;convert(note);continue;}
    steps[entry.index]=Number(note.velocity);
   }
   entry.step=steps[entry.index];entry.velocity=Number(note.velocity);retained.push(entry);
  }
  state.entries=retained;
 }
 // Shift-clone, paste and slicing rebind the note ID. Such copies own a new
 // pitched event and must never clear or replace the original Rack cell.
 const owned=new Set(states(pattern).flatMap(state=>state.entries.map(entry=>JSON.stringify([state.channelId,String(entry.id)]))));
 for(const [channelId,notes]of Object.entries(pattern.notes||{}))for(const note of notes)if(note._stepPiano&&!owned.has(JSON.stringify([channelId,String(note.id)])))convert(note);
 return pattern;
}
/** Project a sample channel, keeping its ordinary notes array editable by all tools. */
export function projectStepPiano(pattern,channel){
 if(!channel||channel.type==='instrument')return pattern.notes?.[channel?.id]||[];
 const raw=rawPattern(pattern),content=raw.pattern||{},sourceId=pattern.cloudSources?.[channel.id]??channel.sourceId;
 const source=(content.sources||[]).find(source=>String(source.id)===String(sourceId));
 if(source?.kind!=='sample')return pattern.notes?.[channel.id]||[];
 reconcileStepPiano(pattern);
 const notes=pattern.notes[channel.id]||(pattern.notes[channel.id]=[]),steps=pattern.steps[channel.id]||[],ppq=Number(raw.ppq)||96;
 if(!pattern.cloudStepPiano)pattern.cloudStepPiano=[];
 let state=states(pattern).find(state=>state.channelId===channel.id&&String(state.sourceId)===String(sourceId));
 if(!state){state={channelId:channel.id,sourceId,entries:[]};pattern.cloudStepPiano.push(state);}
 const events=content.events||[];
 steps.forEach((active,index)=>{
  if(!active||state.entries.some(entry=>entry.index===index))return;
  const originals=events.filter(event=>!notes.some(note=>!isStepPianoNote(note)&&String(note.id)===String(event.id))&&event.type==='sample'&&String(event.sourceId)===String(sourceId)&&event.durationTick==null&&event.tick!=null&&Number(event.tick)===index*ppq/4);
  // A single Rack cell cannot assign ownership of multiple canonical hits.
  // Keep those untouched raw rather than silently collapsing their identities.
  if(originals.length>1)return;
  const original=originals[0]??retiredSampleStep(retiredStepKey(pattern,sourceId,index*ppq/4),events)??undefined,id=String(original?.id??freshId());
  if(notes.some(note=>String(note.id)===id))throw new Error('A Rack step and Piano note share an event identity. Reload the canonical pattern.');
  const note={id,pitch:60,start:index/4,duration:.25,velocity:velocity(active),...(original?{cloudRaw:clone(original)}:{}),_stepPiano:{id,index,sourceId}};
  notes.push(note);state.entries.push({id,index,step:active,velocity:note.velocity});
 });
 return notes;
}
export function syncProjectStepPiano(project){
 for(const pattern of project.patterns||[]){reconcileStepPiano(pattern);for(const channel of project.channels||[])if(Object.hasOwn(pattern.cloudSources||{},channel.id))projectStepPiano(pattern,channel);}
 return project;
}
/** Serialization reconciles a copy: inspecting a proposed edit cannot alter UI. */
export function resolvedStepPianoPattern(pattern){return states(pattern).length||Object.values(pattern.notes||{}).some(notes=>notes.some(note=>note._stepPiano))?reconcileStepPiano(clone(pattern)):pattern;}
export function stepPianoEventId(pattern,channelId,index){return states(pattern).find(state=>state.channelId===channelId)?.entries.find(entry=>entry.index===index)?.id;}
