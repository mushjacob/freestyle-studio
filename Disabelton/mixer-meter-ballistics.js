/** FL-style peak-meter ballistics for the Mixer strips and the master meter.
 *
 * Display only: the engine's `mixer_meters` peaks are the input; nothing here
 * is ever written back. FL's mixer meters rise instantly (attack), fall at a
 * steady decibel rate (release), and show a peak-hold line that waits before
 * it falls. When transport stops they fall to zero instead of freezing.
 */
export const METER_BALLISTICS=Object.freeze({
 /** Release while audio plays, in dB per second. */
 releaseDbPerSec:30,
 /** Faster release once transport has stopped, so meters settle to zero promptly. */
 stoppedReleaseDbPerSec:60,
 /** How long the peak-hold line stays before it falls. */
 peakHoldMs:1000,
 /** Below this linear level (−60 dBFS) a meter reads as exactly zero. */
 floor:.001,
});
const fall=(value,dbPerSec,seconds)=>value*Math.pow(10,-dbPerSec*seconds/20);
const level=value=>{const number=Number(value);return Number.isFinite(number)&&number>0?number:0;};

export class MeterBallistics{
 constructor(options={}){this.options={...METER_BALLISTICS,...options};this.state=new Map();}
 /** Advance one meter to `now` (ms) toward the latest peak `target`.
  * `playing:false` (transport stopped) ignores the target and releases to zero. */
 step(key,target,now,{playing=true}={}){
  const {releaseDbPerSec,stoppedReleaseDbPerSec,peakHoldMs,floor}=this.options,time=Number(now);
  let state=this.state.get(key);
  if(!state){state={level:0,peak:0,peakAt:-Infinity,at:time};this.state.set(key,state);}
  const seconds=Number.isFinite(time-state.at)?Math.max(0,(time-state.at)/1000):0;state.at=Math.max(state.at,time);
  const rate=playing?releaseDbPerSec:stoppedReleaseDbPerSec,input=playing?level(target):0,decayed=fall(state.level,rate,seconds);
  // Attack is instant; release follows the decibel rate.
  state.level=input>=decayed?input:decayed;if(state.level<floor)state.level=0;
  if(state.level>=state.peak){state.peak=state.level;state.peakAt=time;}
  else if(time-state.peakAt>peakHoldMs){
   // Hold, then fall from where the hold ended at the same rate (never below the bar).
   const heldFor=Math.min(seconds,Math.max(0,(time-state.peakAt-peakHoldMs)/1000));
   state.peak=Math.max(state.level,fall(state.peak,rate,heldFor));if(state.peak<floor)state.peak=0;
  }
  if(!playing&&state.level===0)state.peak=0;
  return{level:state.level,peak:state.peak,active:state.level>0||state.peak>0};
 }
 get(key){const state=this.state.get(key);return state?{level:state.level,peak:state.peak,active:state.level>0||state.peak>0}:{level:0,peak:0,active:false};}
 /** Forget every meter (project or peer change). */
 reset(){this.state.clear();}
 get active(){for(const state of this.state.values())if(state.level>0||state.peak>0)return true;return false;}
}
