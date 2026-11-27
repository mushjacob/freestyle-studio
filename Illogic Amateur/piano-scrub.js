/** Pointer-position note audition. No song transport, score edits or timers. */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clone=value=>structuredClone(value);
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const scopeKey=value=>JSON.stringify(stable(value));

export class PianoScrubGesture{
 constructor({notes,getScope,isCurrent=()=>true,acquireNote,onError=()=>{},onChange=()=>{}}={}){
  if(!Array.isArray(notes)||typeof getScope!=='function'||typeof isCurrent!=='function'||typeof acquireNote!=='function'||typeof onError!=='function'||typeof onChange!=='function')throw new TypeError('Piano scrub needs canonical notes, scope readers and an audition lease factory.');
  const ids=new Set();this.notes=Object.freeze(notes.map(note=>{
   if(!note||typeof note.id!=='string'||!note.id||ids.has(note.id)||!finite(note.start)||note.start<0||!finite(note.duration)||note.duration<=0||!finite(note.start+note.duration)||!Number.isInteger(note.pitch)||note.pitch<0||note.pitch>127||!finite(note.velocity)||note.velocity<0||note.velocity>1)throw new TypeError('Piano scrub notes need unique IDs, finite timing, MIDI pitches and normalized velocities.');
   ids.add(note.id);return Object.freeze({id:note.id,start:note.start,duration:note.duration,pitch:note.pitch,velocity:note.velocity});
  }));
  this.boundaries=Object.freeze([...new Set(this.notes.flatMap(note=>[note.start,note.start+note.duration]))].sort((a,b)=>a-b));Object.assign(this,{getScope,isCurrent,acquireNote,onError,onChange});this.scope=clone(getScope());if(!this.scope||typeof this.scope!=='object'||Array.isArray(this.scope)||!Object.keys(this.scope).length)throw new TypeError('Piano scrub needs a captured project scope.');this.scopeIdentity=scopeKey(this.scope);this.voices=new Map();this.active=false;this.finished=false;this.errorReported=false;this.error=null;this.status='idle';this.beat=null;
 }
 get pitchSet(){return new Set(this.voices.keys());}
 get soundingPitchSet(){return new Set([...this.voices.values()].filter(entry=>entry.confirmed).map(entry=>entry.pitch));}
 snapshot(){return{active:this.active,finished:this.finished,status:this.status,beat:this.beat,pitches:[...this.pitchSet].sort((a,b)=>a-b),soundingPitches:[...this.soundingPitchSet].sort((a,b)=>a-b),error:this.error?.message||null};}
 notify(){try{this.onChange(this.snapshot());}catch{}}
 current(){try{return !this.finished&&this.isCurrent()===true&&scopeKey(this.getScope())===this.scopeIdentity;}catch{return false;}}
 report(error){if(this.errorReported)return;this.errorReported=true;try{this.onError(error instanceof Error?error:new Error(String(error)));}catch{}}
 fail(error){return this.end('failed',error instanceof Error?error:new Error(String(error)));}
 /** The click itself auditions only the actual clicked note. Subsequent cursor
  * positions audition every interval containing that beat, regardless of pitch.
  */
 start(noteId,{beat}={}){
  if(this.active||this.finished)return false;if(!this.current())return this.end('stale');
  const note=noteId===null?null:this.notes.find(note=>note.id===noteId);if(noteId!==null&&!note)return false;
  const at=beat??note?.start;if(!finite(at)||at<0)return this.fail(new RangeError('The piano audition cursor needs a finite nonnegative beat.'));
  this.active=true;this.status='active';this.beat=at;return this.apply(note?[note]:this.intervals(at));
 }
 intervals(beat,{left=false}={}){return this.notes.filter(note=>left?note.start<beat&&beat<=note.start+note.duration:note.start<=beat&&beat<note.start+note.duration);}
 move(beat){
  if(!this.active||this.finished)return false;if(!this.current())return this.end('stale');if(!finite(beat)||beat<0)return this.fail(new RangeError('The piano audition cursor needs a finite nonnegative beat.'));
  const previous=this.beat,reverse=beat<previous;if(!this.apply(this.intervals(previous)))return false;
  const boundaries=this.boundaries.filter(at=>reverse?beat<at&&at<=previous:previous<at&&at<=beat);if(reverse)boundaries.reverse();
  for(const at of boundaries){this.beat=at;if(!this.apply(this.intervals(at,{left:reverse})))return false;}
  this.beat=beat;return this.apply(this.intervals(beat));
 }
 apply(notes){
  if(!this.current())return this.end('stale');const wanted=new Map();
  // Zero-velocity notes are silent. Simultaneous same-pitch intervals acquire
  // one voice at their maximum saved velocity; overlaps retain that lease until
  // the pitch is fully left, rather than retriggering it when overlaps change.
  for(const note of notes)if(note.velocity>0)wanted.set(note.pitch,Math.max(wanted.get(note.pitch)||0,note.velocity));
  for(const [pitch,entry]of [...this.voices].sort((a,b)=>a[0]-b[0]))if(!wanted.has(pitch)){this.voices.delete(pitch);try{entry.lease.release();}catch(error){return this.fail(error);}}
  for(const [pitch,velocity]of [...wanted].sort((a,b)=>a[0]-b[0])){
   if(this.voices.has(pitch))continue;if(!this.current())return this.end('stale');let lease;
   try{lease=this.acquireNote(pitch,velocity);if(!lease||typeof lease.release!=='function'||!lease.ready||typeof lease.ready.then!=='function')throw new TypeError('Piano audition did not return a cancellable voice lease.');}
   catch(error){try{lease?.release?.();}catch{}return this.fail(error);}
   const entry={pitch,velocity,lease,confirmed:false};this.voices.set(pitch,entry);
   Promise.resolve(lease.ready).then(ready=>{
    if(this.finished||this.voices.get(pitch)!==entry)return;if(!this.current()){this.end('stale');return;}if(ready!==true)this.fail(new Error('The piano audition could not start.'));else{entry.confirmed=true;this.notify();}
   },error=>{if(this.finished||this.voices.get(pitch)!==entry)return;if(!this.current()){this.end('stale');return;}this.fail(error);});
   if(!this.current())return this.end('stale');
  }
  this.notify();return this.active;
 }
 end(status,error=null){
  if(this.finished)return false;this.finished=true;this.active=false;this.status=status;this.error=error;const entries=[...this.voices.values()];this.voices.clear();for(const entry of entries){try{entry.lease.release();}catch(releaseError){this.error||=releaseError;this.status='failed';}}this.notify();if(this.error)this.report(this.error);return false;
 }
 finish(){return this.end('finished');}
 cancel(){return this.end('cancelled');}
}
