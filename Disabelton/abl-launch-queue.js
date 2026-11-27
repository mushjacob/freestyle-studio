/**
 * abl-launch-queue.js: a clip launched before Freestyle can start it stays queued (Live: the launch button blinks)
 * and fires the moment it can. One launch is queued at a time; a newer launch replaces the queued one.
 *
 * The queue itself does no I/O. The caller supplies:
 *   blocked()        → true while a launch cannot start yet (project loading, mode switch / stop in flight)
 *   clockUnknown()   → true while the engine playback state is not confirmed
 *   confirmClock()   → Promise; asks Freestyle for the playback state (may reject; the control channel may
 *                      confirm it meanwhile, which clockUnknown() then reports)
 *   start(id)        → Promise; the actual launch
 *   exists(id)       → false when the clip's pattern is gone
 *   onChange(id|null) paint the queued state
 */
export class LaunchQueue{
 constructor({blocked=()=>false,clockUnknown=()=>false,confirmClock=async()=>{},start,exists=()=>true,onChange=()=>{},now=()=>globalThis.performance?.now?.()??Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=20000,pollMs=40,retryMs=120}={}){
  if(typeof start!=='function')throw new TypeError('LaunchQueue needs a start function.');
  Object.assign(this,{blocked,clockUnknown,confirmClock,start,exists,onChange,now,sleep,timeoutMs,pollMs,retryMs});this.token=null;
 }
 get queuedId(){return this.token?.id??null;}
 paint(){try{this.onChange(this.queuedId);}catch{}}
 /** Resolves with start()'s result, or false when a newer launch replaced this one. Rejects when it cannot start in time. */
 async launch(id){
  if(!this.exists(id))throw new Error('That clip’s pattern is no longer in the project.');
  const token={id,since:this.now()};this.token=token;this.paint();
  const current=()=>this.token===token,expired=()=>this.now()-token.since>this.timeoutMs;
  try{
   while(current()&&this.blocked()){if(expired())throw new Error('Freestyle is not ready to launch this clip yet. Try again in a moment.');await this.sleep(this.pollMs);}
   if(!current())return false;
   if(!this.exists(id))throw new Error('That clip’s pattern is no longer in the project.');
   // A failed or slow read is not the end: the engine clock also arrives on the control channel.
   while(current()&&this.clockUnknown()){let failed=false;try{await this.confirmClock();}catch{failed=true;}if(!this.clockUnknown())break;if(expired())throw new Error('Freestyle has not confirmed its playback state yet. Try again in a moment.');await this.sleep(failed?this.retryMs:this.pollMs);}
   if(!current())return false;
   return await this.start(id,{isCurrent:current,queuedMs:Math.round(this.now()-token.since)});
  }finally{if(this.token===token)this.token=null;this.paint();}
 }
}
