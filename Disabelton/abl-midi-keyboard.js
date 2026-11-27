/** Disabelton — Live's Computer MIDI Keyboard (M).
 * A W S E D F T G Y H U J K O L P ; ' play notes (A = C of the current octave, C3 = MIDI 60),
 * Z / X octave down / up, C / V velocity down / up (steps of 20, as in Live).
 * Notes play the selected track (getTarget: its instrument, the instrument its pattern plays, or its Drum Rack pads
 * from C1; an audio track plays nothing) through the existing owned-voice
 * audition path (TypingPianoAudition → engine.acquireInstrumentNote: control channel
 * first, REST fallback). It never writes the score.
 *
 * Public: window.ablMidiKeyboard = {enabled, octave, velocity, toggle(force), onChange(fn) → unsubscribe}.
 * The shell's control-bar indicator reads `enabled` and subscribes with onChange.
 * M is handled here (capture phase) unless an earlier handler already prevented it.
 */
import {LogicMusicalTyping,typingCode} from './logic-typing.js';
import {TypingPianoAudition} from './typing-piano.js';
import {LIVE_MIDI_KEYBOARD_VELOCITIES} from './abl-clip-model.js';
import {ABL_PAD_FIRST_NOTE} from './abl-dev-drumrack.js';

const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const textTarget=target=>!!target?.closest?.('input,select,textarea,[contenteditable=""],[contenteditable=true]');
const modified=event=>event.altKey||event.ctrlKey||event.metaKey||event.getModifierState?.('AltGraph');

/** Live: C/V step velocity through 1, 20, 40 … 120, 127; Z/X octave −2…8. */
export class LiveMidiKeyboardModel extends LogicMusicalTyping{
 control(event){
  const code=typingCode(event);
  if(!modified(event)&&!event.shiftKey&&(code==='KeyC'||code==='KeyV')){
   const next=code==='KeyC'?[...LIVE_MIDI_KEYBOARD_VELOCITIES].reverse().find(value=>value<this.velocity)??1:LIVE_MIDI_KEYBOARD_VELOCITIES.find(value=>value>this.velocity)??127;
   const changed=next!==this.velocity;this.velocity=next;if(changed)this.onChange(this);return{type:'velocity',value:next,changed};
  }
  return super.control(event);
 }
 get label(){const low=this.base;return `${NAMES[low%12]}${Math.floor(low/12)-2}`;}
}

/** A lease that plays nothing: TypingPianoAudition drops a key whose `ready` resolves false. */
const silentLease=()=>({ready:Promise.resolve(false),release(){}});

export class AblMidiKeyboard{
 /** Live plays the SELECTED TRACK. getTarget() → {kind:'instrument',channel} | {kind:'drum',pads:[channelId…]} (pad i = MIDI 36+i)
  * | {kind:'audio'|'empty',name} | null (no track selected: getChannel(), the open clip's channel, is played).
  * startVoice(channel,pitch,velocity) → owned lease {ready, release}; auditionPad(channelId) → {stop()} (the devices
  * lane's pad audition: sample_preview over mozart-control, REST fallback); onHint(text) → a quiet status line. */
 constructor({window:win=globalThis.window,take=null,getChannel,getTarget=()=>null,startVoice,auditionPad=()=>null,onHint=()=>{},onError=()=>{},dialogOpen=()=>false,onPitches=()=>{},listen=true}={}){
  if(typeof getChannel!=='function'||typeof startVoice!=='function')throw new TypeError('The computer MIDI keyboard needs getChannel and startVoice.');
  this.window=win;this.listening=listen;this.listeners=new Set();this.dialogOpen=dialogOpen;this.onPitches=onPitches;this._enabled=false;
  this.model=new LiveMidiKeyboardModel({octave:3,velocity:100,onChange:()=>this.emit()});
  const target=()=>{let value=null;try{value=getTarget();}catch(error){onError(error);}return value||{kind:'instrument',channel:getChannel()};};
  const hint=text=>{try{onHint(text);}catch{}};
  const play=(current,pitch,velocity)=>{
   if(current?.kind==='instrument')return startVoice(current.channel,pitch,velocity);
   if(current?.kind==='drum'){
    const id=current.pads?.[pitch-ABL_PAD_FIRST_NOTE];if(!id)return silentLease();
    const voice=auditionPad(id);if(!voice){hint(`${current.name||'Drum Rack'}: this pad cannot be played right now.`);return silentLease();}
    let stopped=false;return{ready:Promise.resolve(true),release(){if(stopped)return;stopped=true;try{voice.stop?.();}catch(error){onError(error);}}};
   }
   hint(current?.kind==='audio'?`“${current.name||'This track'}” is an audio track: the computer MIDI keyboard plays MIDI tracks.`:`“${current?.name||'This track'}” has no instrument to play.`);
   return silentLease();
  };
  this.audition=new TypingPianoAudition({getChannel:target,onError,startVoice:play,pitchFor:event=>this.model.pitchFor(event),velocityFor:()=>this.model.velocityFor(),keyFor:typingCode});
  this.take=take;this.takeEvents=[];this.takeHeld=new Map();
  this.keydown=event=>this.handleKeyDown(event);this.keyup=event=>this.handleKeyUp(event);this.blur=()=>this.releaseAll();
  // listen:false — the owner forwards keydown/keyup from an earlier capture listener (see abl-clip-view.js).
  if(listen){win.addEventListener('keydown',this.keydown,true);win.addEventListener('keyup',this.keyup,true);}win.addEventListener('blur',this.blur);
 }
 get enabled(){return this._enabled;}
 get octave(){return this.model.octave;}
 get velocity(){return this.model.velocity;}
 get range(){return this.model.range;}
 heldPitches(){return new Set([...this.audition.held.values()].map(entry=>entry.pitch));}
 toggle(force){const next=typeof force==='boolean'?force:!this._enabled;if(next===this._enabled)return next;this._enabled=next;if(!next)this.releaseAll();this.emit();return next;}
 onChange(fn){if(typeof fn!=='function')return()=>{};this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 emit(){const state={enabled:this._enabled,octave:this.model.octave,velocity:this.model.velocity,range:this.model.range.label,held:[...this.heldPitches()]};for(const fn of this.listeners){try{fn(state);}catch{}}try{this.window.dispatchEvent(new this.window.CustomEvent('abl:midi-keyboard',{detail:state}));}catch{}try{this.onPitches(this.heldPitches());}catch{}}
 releaseAll(){const had=this.audition.held.size;this.audition.releaseAll();if(had)this.emit();}
 handleKeyDown(event){
  if(event.defaultPrevented||event.isComposing||textTarget(event.target)||this.dialogOpen(event))return;
  const code=typingCode(event);
  if(code==='KeyM'&&!modified(event)&&!event.shiftKey){if(!event.repeat)this.toggle();event.preventDefault();event.stopImmediatePropagation();return;}
  if(!this._enabled)return;
  if(this.model.pitchFor(event)!==null){if(!event.repeat)this.captureOn(event);this.audition.keyDown(event);event.preventDefault();event.stopImmediatePropagation();this.emit();return;}
  if(this.model.owns(event)){if(!event.repeat)this.model.control(event);event.preventDefault();event.stopImmediatePropagation();}
 }
 handleKeyUp(event){this.captureOff(event);if(this.audition.keyUp(event)){event.stopImmediatePropagation();this.emit();}}
 // ---- MIDI record take (Live: armed MIDI track + record: played notes are written at the playhead) ----
 takeActive(){try{return !!this.take?.active?.();}catch{return false;}}
 takeBeat(){try{const beat=Number(this.take?.beat?.());return Number.isFinite(beat)?beat:null;}catch{return null;}}
 captureOn(event){if(!this.takeActive()){this.finishTake();return;}const pitch=this.model.pitchFor(event),on=this.takeBeat();if(pitch==null||on==null)return;const item={pitch,on,off:null,velocity:this.model.velocityFor()};const code=typingCode(event);this.takeHeld.set(code,item);this.takeEvents.push(item);}
 captureOff(event){const code=typingCode(event),item=this.takeHeld.get(code);if(!item)return;this.takeHeld.delete(code);const off=this.takeBeat();item.off=off!=null&&off>item.on?off:item.on+.25;}
 /** A note from another input (Web MIDI) joins the take; it is not auditioned here. key identifies its note-off. */
 externalOn(pitch,velocity=.8,key=`ext:${pitch}`){if(!Number.isInteger(pitch)||pitch<0||pitch>127)return false;if(!this.takeActive()){this.finishTake();return false;}const on=this.takeBeat();if(on==null)return false;const item={pitch,on,off:null,velocity:Math.max(.01,Math.min(1,Number(velocity)||.8))};this.takeHeld.set(key,item);this.takeEvents.push(item);return true;}
 externalOff(key){const item=this.takeHeld.get(key);if(!item)return false;this.takeHeld.delete(key);const off=this.takeBeat();item.off=off!=null&&off>item.on?off:item.on+.25;return true;}
 /** Ends the take: every captured note is committed in ONE call (held notes end now). Returns the events committed. */
 finishTake(){if(!this.takeEvents.length)return[];const end=this.takeBeat();for(const item of this.takeHeld.values())item.off=end!=null&&end>item.on?end:item.on+.25;this.takeHeld.clear();const events=this.takeEvents.splice(0);try{this.take?.commit?.(events);}catch(error){try{this.onTakeError?.(error);}catch{}}return events;}
 destroy(){this.releaseAll();if(this.listening){this.window.removeEventListener('keydown',this.keydown,true);this.window.removeEventListener('keyup',this.keyup,true);}this.window.removeEventListener('blur',this.blur);this.listeners.clear();}
}
