/** Hardware MIDI keyboard input (Web MIDI API). FL behaviour: every connected
 * input plays the currently selected Channel Rack channel through the caller's
 * owned live-voice leases (CloudInstrumentAudition). This module never writes
 * the score or transport and never synthesizes audio locally.
 *
 * - Access is requested only by enable(), which the caller invokes from a user
 *   gesture (menu/toggle). Denial and unsupported browsers are reported states.
 * - Note On velocity 0 is Note Off. CC64 (sustain) holds released keys until
 *   the pedal lifts. CC120/CC123 (all sound/notes off) release every voice.
 * - Hot-plug: inputs are (re)bound on statechange; a disconnected input's
 *   voices are released.
 * - A channel switch releases every voice before the next note sounds.
 * - Other CC messages go to the optional onControlChange(channel,cc,value) callback (Link to controller).
 */
export const MIDI_INPUT_STATES=Object.freeze(['off','unsupported','requesting','on','denied','error']);
/** Per-device enable flags (Options ▸ MIDI settings…). Stored as {deviceId:boolean}; a device with no entry is enabled. */
export const MIDI_DEVICES_KEY='vegetable:midi-devices';
export function readMidiDevicePrefs(storage=globalThis.localStorage){try{const value=JSON.parse(storage?.getItem(MIDI_DEVICES_KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return{};}}
export function writeMidiDevicePref(id,enabled,storage=globalThis.localStorage){const prefs=readMidiDevicePrefs(storage);prefs[String(id)]=enabled!==false;try{storage?.setItem(MIDI_DEVICES_KEY,JSON.stringify(prefs));}catch{}return prefs;}
export const midiDeviceEnabled=(id,storage=globalThis.localStorage)=>readMidiDevicePrefs(storage)[String(id)]!==false;
const NOTE_OFF=0x80,NOTE_ON=0x90,CONTROL=0xb0,SUSTAIN=64,ALL_SOUND_OFF=120,ALL_NOTES_OFF=123;

export class WebMidiInput{
 constructor({requestAccess=globalThis.navigator?.requestMIDIAccess?options=>globalThis.navigator.requestMIDIAccess(options):null,getChannel,startVoice,onChange=()=>{},onError=()=>{},sustain=true,isInputEnabled=midiDeviceEnabled,onControlChange=null}={}){
  if(typeof getChannel!=='function'||typeof startVoice!=='function')throw TypeError('MIDI input needs channel and owned voice callbacks.');
  Object.assign(this,{requestAccess,getChannel,startVoice,onChange,onError,isInputEnabled,onControlChange,sustainEnabled:sustain!==false});
  this.state=typeof requestAccess==='function'?'off':'unsupported';this.access=null;this.inputs=new Map();this.voices=new Map();this.sustained=new Set();this.pedal=new Set();this.request=null;this.generation=0;this.error=null;
  this.onStateChange=event=>this.refreshInputs(event);
 }
 get supported(){return typeof this.requestAccess==='function';}
 get enabled(){return this.state==='on';}
 /** Distinct sounding pitches, for Piano roll key highlighting. */
 pitches(){return new Set([...this.voices.values()].map(voice=>voice.pitch));}
 /** Every connected input with its enable flag, for the MIDI settings dialog. */
 allInputs(){if(!this.access)return[];const list=[];for(const input of this.access.inputs.values())if(input&&input.state!=='disconnected')list.push({id:input.id,name:input.name||input.id,enabled:this.deviceEnabled(input.id)});return list;}
 deviceEnabled(id){try{return this.isInputEnabled(id)!==false;}catch{return true;}}
 inputNames(){return[...this.inputs.values()].map(input=>input.name||input.id);}
 report(error){try{this.onError(error);}catch{}}
 notify(){try{this.onChange(this.snapshot());}catch(error){this.report(error);}}
 snapshot(){return{state:this.state,inputs:this.inputNames(),pitches:this.pitches(),error:this.error};}
 setState(state,error=null){this.state=state;this.error=error?String(error.message||error):null;this.notify();}
 /** Call from a user gesture. Resolves to the resulting state. */
 async enable(){
  if(!this.supported){this.setState('unsupported');return this.state;}
  if(this.state==='on')return this.state;if(this.request)return this.request;
  const generation=++this.generation;this.setState('requesting');
  this.request=(async()=>{
   try{const access=await this.requestAccess({sysex:false});if(generation!==this.generation)return this.state;
    if(!access?.inputs||typeof access.inputs.values!=='function')throw new Error('This browser returned no MIDI input list.');
    this.access=access;if(typeof access.addEventListener==='function')access.addEventListener('statechange',this.onStateChange);else access.onstatechange=this.onStateChange;
    this.state='on';this.error=null;this.refreshInputs();return this.state;
   }catch(error){if(generation!==this.generation)return this.state;const denied=error?.name==='SecurityError'||error?.name==='NotAllowedError';this.setState(denied?'denied':'error',denied?'MIDI access was blocked. Allow MIDI devices for this site in the browser settings.':error);this.report(Object.assign(new Error(this.error),{name:error?.name||'Error'}));return this.state;}
   finally{if(generation===this.generation)this.request=null;}
  })();
  return this.request;
 }
 disable(){
  this.generation++;this.request=null;this.releaseAll();for(const input of this.inputs.values())this.unbind(input);this.inputs.clear();
  const access=this.access;this.access=null;if(access){if(typeof access.removeEventListener==='function')access.removeEventListener('statechange',this.onStateChange);else if(access.onstatechange===this.onStateChange)access.onstatechange=null;}
  this.setState(this.supported?'off':'unsupported');
 }
 toggle(){return this.enabled||this.state==='requesting'?(this.disable(),Promise.resolve(this.state)):this.enable();}
 bind(input){if(input.__vegetableMidiHandler)return;const handler=event=>this.message(event?.data,input.id);input.__vegetableMidiHandler=handler;if(typeof input.addEventListener==='function')input.addEventListener('midimessage',handler);else input.onmidimessage=handler;}
 unbind(input){const handler=input.__vegetableMidiHandler;if(!handler)return;if(typeof input.removeEventListener==='function')input.removeEventListener('midimessage',handler);else if(input.onmidimessage===handler)input.onmidimessage=null;delete input.__vegetableMidiHandler;}
 refreshInputs(){
  if(!this.access||this.state!=='on')return;const live=new Map();
  for(const input of this.access.inputs.values())if(input&&input.state!=='disconnected'&&this.deviceEnabled(input.id))live.set(input.id,input);
  for(const [id,input]of this.inputs)if(live.get(id)!==input){this.unbind(input);this.releaseInput(id);this.inputs.delete(id);}
  for(const [id,input]of live){this.inputs.set(id,input);this.bind(input);}
  this.notify();
 }
 /** Raw MIDI bytes from one input. Returns true when the message was used. */
 message(data,inputId='default'){
  if(this.state!=='on'||!data||data.length<1||!this.deviceEnabled(inputId))return false;const status=data[0]&0xf0,channel=data[0]&0x0f,a=data[1]??0,b=data[2]??0;
  if(status===NOTE_ON&&b>0)return this.noteOn(inputId,channel,a,b);
  if(status===NOTE_OFF||status===NOTE_ON)return this.noteOff(inputId,channel,a);
  if(status===CONTROL){if(a===SUSTAIN&&this.sustainEnabled){this.setPedal(inputId,channel,b>=64);return true;}if(a===ALL_SOUND_OFF||a===ALL_NOTES_OFF){this.releaseInput(inputId,channel);return true;}if(a!==SUSTAIN&&typeof this.onControlChange==='function'){try{return this.onControlChange(channel,a,b)!==false;}catch(error){this.report(error);return true;}}}
  return false;
 }
 key(inputId,channel,pitch){return`${inputId}\u0000${channel}\u0000${pitch}`;}
 noteOn(inputId,channel,pitch,velocity){
  if(!Number.isInteger(pitch)||pitch<0||pitch>127)return false;
  let target;try{target=this.getChannel();}catch(error){this.report(error);return false;}if(!target)return false;
  for(const voice of this.voices.values())if(voice.channelId!==target.id){this.releaseAll({keepPedal:true});break;}
  const key=this.key(inputId,channel,pitch);if(this.voices.has(key))this.releaseVoice(key);
  const voice={key,inputId,channel,pitch,channelId:target.id,lease:null,released:false};this.voices.set(key,voice);
  try{voice.lease=this.startVoice(target,pitch,Math.max(1,Math.min(127,velocity))/127);
   if(!voice.lease||typeof voice.lease.release!=='function'||typeof voice.lease.ready?.then!=='function')throw TypeError('MIDI input needs an owned voice lease.');
   voice.lease.ready.then(ready=>{if(ready===false&&this.voices.get(key)===voice)this.releaseVoice(key);},error=>{if(this.voices.get(key)!==voice)return;this.releaseVoice(key);this.report(error);});
  }catch(error){if(this.voices.get(key)===voice)this.releaseVoice(key);this.report(error);return true;}
  this.notify();return true;
 }
 noteOff(inputId,channel,pitch){const key=this.key(inputId,channel,pitch);if(!this.voices.has(key))return false;if(this.pedal.has(`${inputId}\u0000${channel}`)){this.sustained.add(key);return true;}this.releaseVoice(key);this.notify();return true;}
 setPedal(inputId,channel,down){const id=`${inputId}\u0000${channel}`;if(down){this.pedal.add(id);return;}this.pedal.delete(id);const prefix=id+'\u0000';let changed=false;for(const key of [...this.sustained])if(key.startsWith(prefix)){this.sustained.delete(key);this.releaseVoice(key);changed=true;}if(changed)this.notify();}
 releaseVoice(key){const voice=this.voices.get(key);this.voices.delete(key);this.sustained.delete(key);if(!voice||voice.released)return;voice.released=true;try{voice.lease?.release();}catch(error){this.report(error);}}
 releaseInput(inputId,channel=null){const prefix=channel==null?`${inputId}\u0000`:`${inputId}\u0000${channel}\u0000`;let changed=false;for(const key of [...this.voices.keys()])if(key.startsWith(prefix)){this.releaseVoice(key);changed=true;}for(const id of [...this.pedal])if((id+'\u0000').startsWith(prefix)||channel==null&&id.startsWith(prefix))this.pedal.delete(id);if(changed)this.notify();}
 /** All notes off: channel switch, window blur, peer/generation change. */
 releaseAll({keepPedal=false}={}){const had=this.voices.size>0;for(const key of [...this.voices.keys()])this.releaseVoice(key);this.sustained.clear();if(!keepPedal)this.pedal.clear();if(had)this.notify();}
}
