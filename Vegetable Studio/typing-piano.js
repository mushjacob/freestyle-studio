/** FL's untransposed Layout Piano, from the installed 2026 typing template.
 * Physical KeyboardEvent.code follows its documented QWERTY key sequence.
 * Q = MIDI60 (FL C5); Z = MIDI48 (FL C4). Display never transposes MIDI.
 * FREE/LOCK positions intentionally have no note. No octave controls inferred.
 */
export const FL_PIANO_TYPING_LAYOUT=Object.freeze({
 Digit2:61,Digit3:63,Digit5:66,Digit6:68,Digit7:70,Digit9:73,Digit0:75,Equal:78,
 KeyQ:60,KeyW:62,KeyE:64,KeyR:65,KeyT:67,KeyY:69,KeyU:71,KeyI:72,KeyO:74,KeyP:76,BracketLeft:77,BracketRight:79,
 KeyS:49,KeyD:51,KeyG:54,KeyH:56,KeyJ:58,KeyL:61,Semicolon:63,
 KeyZ:48,KeyX:50,KeyC:52,KeyV:53,KeyB:55,KeyN:57,KeyM:59,Comma:60,Period:62,Slash:64,
});
// Running native FL reports typing-key note velocity100 (MIDI0..127).
export const FL_PIANO_TYPING_VELOCITY=100/127;
const fallback=Object.freeze(Object.fromEntries(Object.keys(FL_PIANO_TYPING_LAYOUT).map(code=>[code.startsWith('Key')?code.slice(3).toLowerCase():code.startsWith('Digit')?code.slice(5):({Equal:'=',BracketLeft:'[',BracketRight:']',Semicolon:';',Comma:',',Period:'.',Slash:'/'})[code],code])));
function physicalKey(event){return event?.code&&event.code!=='Unidentified'?event.code:fallback[String(event?.key||'').toLowerCase()]??null;}
export function typingPianoPitch(event){
 if(!event||event.defaultPrevented||event.isComposing||event.keyCode===229||event.key==='Process'||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.getModifierState?.('AltGraph'))return null;
 const code=physicalKey(event);return Object.hasOwn(FL_PIANO_TYPING_LAYOUT,code)?FL_PIANO_TYPING_LAYOUT[code]:null;
}

/** Every physical key owns its voice, including duplicate pitches. The caller
 * supplies existing engine leases; this class never writes a score/transport.
 */
export class TypingPianoAudition{
 constructor({getChannel,startVoice,onError=()=>{}}={}){if(typeof getChannel!=='function'||typeof startVoice!=='function'||typeof onError!=='function')throw TypeError('Typing audition needs channel and owned voice callbacks.');Object.assign(this,{getChannel,startVoice,onError});this.held=new Map();}
 report(error){try{this.onError(error);}catch{}}
 releaseEntry(entry){if(entry.released)return;entry.released=true;try{if(typeof entry.voice?.release==='function')entry.voice.release();}catch(error){this.report(error);}}
 keyDown(event){
  const pitch=typingPianoPitch(event);if(pitch===null)return false;const key=physicalKey(event);
  if(event.repeat||this.held.has(key))return true;
  const entry={key,pitch,voice:null,released:false};this.held.set(key,entry);
  try{entry.voice=this.startVoice(this.getChannel(),pitch,FL_PIANO_TYPING_VELOCITY);if(!entry.voice||typeof entry.voice.release!=='function'||!entry.voice.ready||typeof entry.voice.ready.then!=='function')throw TypeError('Typing audition needs an owned voice lease.');
   Promise.resolve(entry.voice.ready).then(ready=>{if(ready===false&&this.held.get(key)===entry){this.held.delete(key);this.releaseEntry(entry);}},error=>{if(this.held.get(key)!==entry)return;this.held.delete(key);this.releaseEntry(entry);this.report(error);});
  }catch(error){if(this.held.get(key)===entry)this.held.delete(key);this.releaseEntry(entry);this.report(error);}return true;
 }
 keyUp(event){const key=physicalKey(event),entry=this.held.get(key);if(!entry)return false;this.held.delete(key);this.releaseEntry(entry);return true;}
 releaseAll(){for(const entry of this.held.values())this.releaseEntry(entry);this.held.clear();}
}
