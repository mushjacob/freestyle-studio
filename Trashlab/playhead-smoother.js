/** Display-clock slew limiter: the Default studio's cursor model.
 *
 * The Default studio's cursor ticker never writes the freshly
 * extrapolated engine position straight to the cursor. The target is
 *   engineSec(anchor) + (now - anchorAt) - speakerLag
 * and the rendered cursor follows it with a slew limiter, so a new /transport
 * clock sample (a few ms of delivery noise, a jitter-buffer EWMA step) can only
 * ever move the cursor a hair per frame:
 *   - forward error > FORWARD_SNAP_SEC (0.25 s): snap (a seek / a
 *     cursor left behind),
 *   - forward error > maxForward (max(12 ms, dt*1.01)): close it quickly
 *     (max(maxForward, 20 % of the error)),
 *   - small backward error: hold (never step back), beyond maxBackward
 *     (max(2 ms, dt*0.1)) trim at that rate,
 *   - otherwise follow the target exactly.
 * Vegetable replaced its position wholesale at every clock message
 * (CloudSession.adoptTransport), which showed as visible jitter. This class
 * applies the same limiter to Vegetable's display position. It is display
 * only: transport decisions keep using the raw clock model.
 */
export const FORWARD_SNAP_SEC=.25;
export const BACKWARD_SNAP_SEC=.75;
export const MAX_FRAME_GAP_SEC=.5;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export class PlayheadSmoother{
 constructor(){this.reset();}
 reset(){this.position=null;this.at=null;this.key=null;}
 /** Seconds the cursor shows at `at` (ms, performance clock) for a raw model `target`.
  * `key` identifies a clock epoch (project, transport command, session epoch):
  * a different key snaps. `wrapSpan` > 0 marks a loop/cycle length: a drop of
  * more than half of it is a wrap, which snaps. Repeated calls for the same or
  * an older `at` return the current cursor unchanged. */
 step(target,at,{key='',wrapSpan=0}={}){
  if(!finite(target)||!finite(at)){this.reset();return target;}
  if(this.position===null||key!==this.key||at-this.at>MAX_FRAME_GAP_SEC*1000||at<this.at-1000){this.position=target;this.at=at;this.key=key;return target;}
  const elapsed=(at-this.at)/1000;
  if(elapsed<=0)return this.position;
  // Rate-locked follower: the cursor always advances by the real elapsed time
  // (it never steps back or leaps on a clock sample), and the error against
  // the engine target is absorbed by nudging that rate by at most ±5 %. Clock
  // delivery noise (±20 ms every 100 ms sample) is therefore invisible, while
  // real drift converges within a few hundred ms. Seeks / wraps still snap.
  const dt=Math.min(.1,elapsed),predicted=this.position+dt,error=target-predicted;
  let next;
  if(wrapSpan>0&&target-this.position<-wrapSpan/2)next=target;
  else if(error>FORWARD_SNAP_SEC||error<-BACKWARD_SNAP_SEC)next=target;
  else{const correction=Math.max(-.05*dt,Math.min(.05*dt,error*.15));next=predicted+correction;}
  this.position=next;this.at=at;this.key=key;return next;
 }
}
