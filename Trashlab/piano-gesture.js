import {MIN_NOTE_DURATION} from './piano-tools.js';

const clone=value=>structuredClone(value);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const snap=(value,grid)=>Number.isFinite(grid)&&grid>0?Math.round(value/grid)*grid:value;

/** Snap the gesture delta, retaining every note's original fractional onset/length. */
export function movePianoGesture(notes,{deltaBeats=0,deltaPitch=0,snapBeats=.25,resize=false,minDuration=MIN_NOTE_DURATION}={}){
 if(!notes.length)return[];
 if(!Number.isFinite(deltaBeats)||!Number.isFinite(deltaPitch)||!Number.isFinite(minDuration)||minDuration<=0||notes.some(note=>!Number.isFinite(note.start)||note.start<0||!Number.isFinite(note.duration)||note.duration<=0||!Number.isInteger(note.pitch)||note.pitch<0||note.pitch>127))throw new RangeError('Piano gestures require canonical note timing, MIDI pitches and finite deltas.');
 const delta=snap(deltaBeats,Number(snapBeats));
 if(resize){const amount=Math.max(minDuration-Math.min(...notes.map(note=>note.duration)),delta);return notes.map(note=>({...clone(note),duration:note.duration+amount}));}
 const time=Math.max(-Math.min(...notes.map(note=>note.start)),delta),pitch=clamp(Math.round(deltaPitch),-Math.min(...notes.map(note=>note.pitch)),127-Math.max(...notes.map(note=>note.pitch)));
 return notes.map(note=>({...clone(note),start:note.start+time,pitch:note.pitch+pitch}));
}
/** Preserve relative velocities while the shared adjustment reaches a boundary. */
export function velocityPianoGesture(notes,delta){
 if(!notes.length)return[];
 if(!Number.isFinite(delta)||notes.some(note=>!Number.isFinite(note.velocity)||note.velocity<0||note.velocity>1))throw new RangeError('Velocity gestures require canonical values between zero and one and a finite delta.');
 const amount=clamp(delta,-Math.min(...notes.map(note=>note.velocity)),1-Math.max(...notes.map(note=>note.velocity)));
 return notes.map(note=>({...clone(note),velocity:note.velocity+amount}));
}

/** Provisional frame painting without mutating canonical notes or dispatching cloud edits. */
export class PianoGesture{
 constructor({initial,origin,compute,paint=()=>{},restore=()=>{},isValid=()=>true,changed=(a,b)=>JSON.stringify(a)!==JSON.stringify(b),threshold=1.5,raf=fn=>requestAnimationFrame(fn),caf=id=>cancelAnimationFrame(id)}={}){
  Object.assign(this,{initial:clone(initial),origin:{...origin},compute,paintState:paint,restore,isValid,changedState:changed,threshold,raf,caf});
  this.point={...origin};this.moved=false;this.frame=null;this.active=true;
 }
 matches(event){return event?.pointerId==null||this.origin.pointerId==null||event.pointerId===this.origin.pointerId;}
 sample(event){
  if(!this.active||!this.matches(event)||!Number.isFinite(event?.clientX)||!Number.isFinite(event?.clientY))return false;
  if(!this.moved&&Math.hypot(event.clientX-this.origin.clientX,event.clientY-this.origin.clientY)<this.threshold)return false;
  this.moved=true;this.point={clientX:event.clientX,clientY:event.clientY};return true;
 }
 resolve(){return this.moved?this.compute({deltaX:this.point.clientX-this.origin.clientX,deltaY:this.point.clientY-this.origin.clientY},this.initial):clone(this.initial);}
 move(event){if(!this.sample(event))return;if(this.frame===null)this.frame=this.raf(()=>{this.frame=null;if(!this.active)return;if(!this.isValid()){this.finish(undefined,{cancel:true});return;}this.paintState(this.resolve());});}
 finish(event,{cancel=false}={}){
  if(!this.matches(event))return null;
  if(!this.active)return this.result;
  if(!cancel)this.sample(event);
  cancel=cancel||!this.isValid();const state=cancel?clone(this.initial):this.resolve();
  if(this.frame!==null)this.caf(this.frame);this.frame=null;this.active=false;this.restore();
  return this.result={state,cancelled:cancel,changed:!cancel&&this.changedState(this.initial,state)};
 }
}
