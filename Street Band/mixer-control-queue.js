/** Optimistic, latest-value-wins persistence for Mixer fader/M/S controls.
 *
 * FL Studio (and Studio Pro's lane-sync entries) toggle instantly and never
 * drop a click: each control key keeps the user's `desired` value and the last
 * `confirmed` saved value. One write is in flight at a time (the Studio API
 * mixer is single-operation); when it settles, a newer desired value is written
 * next, and a value equal to what is already saved is never re-sent. Until a
 * key settles, `optimistic()` exposes the desired value so the view follows the
 * user immediately regardless of network latency.
 *
 * `persist(target,control,value,scope)` performs one typed write and resolves
 * when it is confirmed; a `studio_mixer_busy` rejection (another mixer request
 * or an active gesture) is retried, never reported. Any other failure drops the
 * optimistic value (the view returns to saved state) and is reported once.
 */
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const MIXER_QUEUE_BUSY_RETRY_MS=120;

export class MixerControlQueue{
 constructor({persist,isCurrent=()=>true,onChange=()=>{},onError=()=>{},onIdle=()=>{},retryMs=MIXER_QUEUE_BUSY_RETRY_MS,maxBusyRetries=500,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  if(typeof persist!=='function')throw new TypeError('Mixer control queue needs a persist function.');
  Object.assign(this,{persist,isCurrent,onChange,onError,onIdle,retryMs,maxBusyRetries,wait});this.entries=new Map();this.held=new Map();this.running=null;
 }
 static key(target,control){return JSON.stringify([target?.kind,target?.id,control]);}
 get busy(){return this.entries.size>0;}
 /** Record the user's latest value. Resolves when that value (or a newer one for the same key) is saved. */
 set(target,control,value,{scope=null,before}={}){
  const key=MixerControlQueue.key(target,control);let entry=this.entries.get(key);
  if(entry&&!same(entry.scope,scope)){this.settle(entry,Object.assign(new Error('The mixer context changed before this control was saved.'),{code:'studio_mixer_scope_changed'}));entry=null;}
  this.held.delete(key);
  if(!entry){entry={key,target:{kind:target.kind,id:target.id},control,scope,confirmed:before,desired:value,waiters:[],busyRetries:0};this.entries.set(key,entry);}else entry.desired=value;
  const promise=new Promise((resolve,reject)=>entry.waiters.push({resolve,reject}));promise.catch(()=>{});
  this.changed();this.pump();return promise;
 }
 optimistic(target,control){const key=MixerControlQueue.key(target,control),entry=this.entries.get(key);if(entry)return{value:entry.desired,inFlight:entry.inFlight===true};return this.held.has(key)?{value:this.held.get(key),inFlight:false,saved:true}:null;}
 /** Saved values stay visible until the host has re-read canonical state once (one deferred refresh, outside the write). */
 releaseHeld(){if(!this.held.size||this.busy)return false;this.held.clear();this.changed();return true;}
 get holding(){return this.held.size>0;}
 clear(){this.held.clear();for(const entry of [...this.entries.values()])this.settle(entry,Object.assign(new Error('The mixer was reset.'),{code:'studio_mixer_scope_changed'}));this.changed();}
 changed(){try{this.onChange();}catch{}}
 settle(entry,failure=null){if(this.entries.get(entry.key)===entry){this.entries.delete(entry.key);if(!failure&&entry.saved)this.held.set(entry.key,entry.confirmed);}for(const waiter of entry.waiters.splice(0))failure?waiter.reject(failure):waiter.resolve({value:entry.confirmed});}
 next(){for(const entry of this.entries.values()){if(!same(entry.desired,entry.confirmed))return entry;this.settle(entry);this.changed();return this.next();}return null;}
 pump(){if(this.running)return this.running;this.running=(async()=>{try{
  for(let entry=this.next();entry;entry=this.next()){
   if(!this.isCurrent(entry.scope)){this.settle(entry,Object.assign(new Error('The mixer context changed before this control was saved.'),{code:'studio_mixer_scope_changed'}));this.changed();continue;}
   const value=entry.desired;entry.inFlight=true;
   try{await this.persist(entry.target,entry.control,value,entry.scope);entry.confirmed=value;entry.saved=true;entry.busyRetries=0;entry.inFlight=false;}
   catch(failure){
    entry.inFlight=false;
    if(failure?.code==='studio_mixer_busy'&&entry.busyRetries++<this.maxBusyRetries){await this.wait(this.retryMs);continue;}
    this.settle(entry,failure);this.changed();try{this.onError(failure,{target:entry.target,control:entry.control,value});}catch{}continue;
   }
   if(same(entry.desired,entry.confirmed)){this.settle(entry);this.changed();}
  }
 }finally{this.running=null;if(!this.entries.size)try{this.onIdle();}catch{}}})();return this.running;}
}
