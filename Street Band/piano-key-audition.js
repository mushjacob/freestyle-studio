/** Held on-screen instrument keys. Owns note leases, never transport or score. */
const clone=value=>structuredClone(value);
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const scopeKey=value=>JSON.stringify(stable(value));
const validPitch=pitch=>Number.isInteger(pitch)&&pitch>=0&&pitch<=127;

export class PianoKeyAuditionGesture{
 constructor({getScope,isCurrent=()=>true,acquireNote,onChange=()=>{},onError=()=>{}}={}){
  if([getScope,isCurrent,acquireNote,onChange,onError].some(callback=>typeof callback!=='function'))throw new TypeError('Piano key audition needs scope readers and a cancellable note lease factory.');
  Object.assign(this,{getScope,isCurrent,acquireNote,onChange,onError});
  this.scope=clone(getScope());
  if(!this.scope||typeof this.scope!=='object'||Array.isArray(this.scope)||!Object.keys(this.scope).length)throw new TypeError('Piano key audition needs a captured project scope.');
  this.scopeIdentity=scopeKey(this.scope);this.voice=null;this.pitch=null;this.active=false;this.finished=false;this.status='idle';this.error=null;this.errorReported=false;
 }
 get soundingPitch(){return this.voice?.confirmed?this.voice.pitch:null;}
 get pending(){return !!this.voice&&!this.voice.confirmed;}
 snapshot(){return{active:this.active,pitch:this.pitch,soundingPitch:this.soundingPitch,pending:this.pending,status:this.status,error:this.error?.message||null};}
 notify(){try{this.onChange(this.snapshot());}catch{}}
 current(){try{return !this.finished&&this.isCurrent()===true&&scopeKey(this.getScope())===this.scopeIdentity;}catch{return false;}}
 report(error){if(this.errorReported)return;this.errorReported=true;try{this.onError(error);}catch{}}
 start(pitch){
  if(this.active||this.finished)return false;if(!this.current())return this.end('stale');
  if(!validPitch(pitch))return this.fail(new RangeError('Piano key audition needs a MIDI pitch from 0 to 127.'));
  this.active=true;this.status='active';return this.apply(pitch);
 }
 move(pitch){
  if(!this.active||this.finished)return false;if(!this.current())return this.end('stale');
  if(pitch!==null&&!validPitch(pitch))return this.fail(new RangeError('Piano key audition needs a MIDI pitch from 0 to 127, or null outside the keys.'));
  // Only actual visited keys are sounded; sparse pointer motion never invents
  // intermediate note attacks that were not delivered by the input surface.
  if(pitch===this.pitch)return true;return this.apply(pitch);
 }
 apply(pitch){
  if(!this.current())return this.end('stale');
  const previous=this.voice;this.voice=null;this.pitch=pitch;
  if(previous){try{previous.lease.release();}catch(error){return this.fail(error);}}
  if(!this.current())return this.end('stale');
  if(pitch===null){this.notify();return this.active;}
  let lease,ready;
  try{
   lease=this.acquireNote(pitch,.8);
   if(lease?.ready&&typeof lease.ready.then==='function')ready=Promise.resolve(lease.ready);
   if(!lease||typeof lease.release!=='function'||!ready)throw new TypeError('Piano key audition did not return a cancellable note lease.');
  }catch(error){ready?.catch(()=>{});try{lease?.release?.();}catch{}return this.fail(error);}
  const entry={pitch,lease,confirmed:false};
  // A synchronous cancellation during acquisition must also dispose its newly
  // returned owner; it cannot leave a late voice behind after pointer release.
  if(this.finished){ready.catch(()=>{});try{lease.release();}catch(error){this.report(error instanceof Error?error:new Error(String(error)));}return false;}
  this.voice=entry;
  ready.then(confirmed=>{
   if(this.finished||this.voice!==entry)return;
   if(!this.current()){this.end('stale');return;}
   if(confirmed!==true){this.fail(new Error('The piano key audition could not start.'));return;}
   entry.confirmed=true;this.notify();
  },error=>{
   if(this.finished||this.voice!==entry)return;
   if(!this.current()){this.end('stale');return;}
   this.fail(error);
  });
  if(!this.current())return this.end('stale');this.notify();return this.active;
 }
 fail(error){return this.end('failed',error instanceof Error?error:new Error(String(error)));}
 end(status,error=null){
  if(this.finished)return false;this.finished=true;this.active=false;this.status=status;this.error=error;
  const previous=this.voice;this.voice=null;this.pitch=null;
  if(previous){try{previous.lease.release();}catch(releaseError){this.error||=releaseError instanceof Error?releaseError:new Error(String(releaseError));this.status='failed';}}
  this.notify();if(this.error)this.report(this.error);return false;
 }
 finish(){return this.end('finished');}
 cancel(){return this.end('cancelled');}
}
