/** Local receive-audio gate, matching the Freestyle Studio's five 16 ms pause-fade steps.
 * No transport, peer or media ownership belongs here. The selected listening
 * volume is supplied separately and is never changed by transport intent.
 */
export class CloudAudibility {
 constructor({apply,getVolume=()=>1,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),audible=true}={}) {
  if(typeof apply!=='function'||typeof getVolume!=='function')throw new TypeError('An audio sink and selected listening volume are required.');
  Object.assign(this,{apply,getVolume,setTimer,clearTimer});
  this.epoch=0;this.timer=null;this.audible=!!audible;this.gain=1;this.destroyed=false;
 }
 current(epoch){return !this.destroyed&&epoch===this.epoch;}
 cancelFade(){if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;}
 refresh(){
  const volume=this.getVolume();
  if(typeof volume!=='number'||!Number.isFinite(volume)||volume<0||volume>1)throw new RangeError('Selected listening volume must be a number from 0 to 1.');
  const state=Object.freeze({audible:this.audible,gain:this.gain,volume:volume*this.gain,muted:!this.audible});
  this.apply(state);return state;
 }
 /** Hold incoming audio while a new scoped Play or audition intent is pending. */
 hold(){if(this.destroyed)return this.epoch;this.cancelFade();const epoch=++this.epoch;this.audible=false;this.gain=1;this.refresh();return epoch;}
 /** Only the current intent may reopen the sink after its required barrier. */
 open(epoch){if(!this.current(epoch))return false;this.cancelFade();this.audible=true;this.gain=1;this.refresh();return true;}
 /** Silence promptly without pausing/disconnecting the shared receive stream. */
 silence(){
  this.cancelFade();const epoch=++this.epoch,startGain=this.gain;
  if(this.destroyed)return epoch;
  if(!this.audible){this.gain=1;this.refresh();return epoch;}
  let step=0;
  const tick=()=>{
   if(!this.current(epoch))return;
   this.timer=null;step++;
   if(step===5){this.audible=false;this.gain=1;this.refresh();return;}
   this.gain=startGain*(1-step/5);this.refresh();
   this.timer=this.setTimer(tick,16);
  };
  this.timer=this.setTimer(tick,16);return epoch;
 }
 /** A project/connection replacement invalidates every prior intent and timer. */
 reset({audible=true}={}){if(this.destroyed)return this.epoch;this.cancelFade();const epoch=++this.epoch;this.audible=!!audible;this.gain=1;this.refresh();return epoch;}
 destroy(){if(this.destroyed)return;this.reset({audible:false});this.destroyed=true;}
}
