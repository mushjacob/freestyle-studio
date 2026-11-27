/**
 * Live instrument audition for the piano roll, matching the Freestyle Studio.
 *
 * The Freestyle Studio's note sender builds
 *   {type:"midi_note",project_id,track_id?,lane_id,note,velocity,channel,on,
 *    perf_sent_ms,event_id,event_source:`group:${group||"local"}:${lane}:${ch}`}
 * (on-velocity clamped to .01–1, default .82; note-off velocity 0) and sends it
 * on the ordered `mozart-control` channel (control_route "daw").
 * Its release sends a note-off for every held note of the lane, then
 * `{type:"midi_all_notes_off",project_id,track_id?,lane_id}`. While instrument
 * input happened in the last 20 s it sends `{type:"live_hold",project_id}` once
 * per second. Sample sources audition with `sample_preview`.
 *
 * The Freestyle Studio's own HTTP fallback uses a different auth contract
 * than the published OAuth API. Modesty never sends a note-on through
 * slow REST (a late note is worse than none); only the safety release falls
 * back to the published OAuth `engineMidiAllNotesOff` operation.
 */
export const LIVE_NOTE_DEFAULT_VELOCITY=.82;
const HOLD_INTERVAL_MS=1000,HOLD_WINDOW_MS=20000;
const uid=()=>globalThis.crypto?.randomUUID?.()||`midi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const positiveInteger=value=>Number.isInteger(Number(value))&&Number(value)>0?Number(value):0;

/** Durable lane plus optional numeric runtime track, exactly as the Freestyle Studio sends them. */
export function liveInstrumentTarget(channel){
 if(!channel||typeof channel!=='object')return null;
 const source=channel.cloudSource||channel.cloudRaw||{},laneId=String(channel.laneId||source.laneId||source.lane_id||'').trim(),trackId=positiveInteger(channel.engineTrackId);
 const audioFileId=String(channel.audioFileId||source.audioFileId||source.audio_file_id||'').trim();
 const plugin=channel.type==='instrument'||!!channel.instrumentType||source.kind==='plugin';
 if(plugin&&(laneId||trackId))return {kind:'midi',laneId,trackId,key:laneId||`track:${trackId}`};
 if(audioFileId)return {kind:'sample',audioFileId,laneId,trackId,key:`sample:${audioFileId}`,rootPitch:Number.isFinite(Number(channel.rootPitch??source.rootPitch))?Number(channel.rootPitch??source.rootPitch):60,durationSec:Math.max(0,Number(channel.durationSec??source.durationSec)||0),busId:String(source.busId||'master')};
 return null;
}

export class LiveInstrument extends EventTarget{
 constructor({engine,now=()=>Date.now(),setTimer=(fn,ms)=>setInterval(fn,ms),clearTimer=id=>clearInterval(id),group='local'}={}){
  super();this.engine=engine;this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;this.group=group;
  this.held=new Map();this.lastInputAt=0;this.holdTimer=null;this.log=[];this.lastProjectId='';this.pendingRelease=new Map();
 }
 get monitor(){return this.engine?.monitor;}
 /** The physical channel must belong to the current project. */
 channelOpen(){
  const monitor=this.monitor,projectId=this.engine?.projectId;
  return !!(projectId&&monitor&&monitor.projectId===projectId&&monitor.peer?.connectionState==='connected'&&monitor.control?.readyState==='open');
 }
 status(){return this.channelOpen()?'live':this.monitor?.state==='connecting'?'connecting':'offline';}
 record(entry){this.log.push({at:this.now(),...entry});if(this.log.length>200)this.log.splice(0,this.log.length-200);this.dispatchEvent(new CustomEvent('note',{detail:entry}));}
 send(message){const result=this.monitor.sendControl(message);this.record({type:message.type,note:message.note,on:message.on,laneId:message.lane_id,route:'daw-control',seq:result?.seq});return result;}
 /** The Freestyle Studio primes the existing received-audio sink inside the user gesture. */
 primeSink(){
  const monitor=this.monitor,projectId=this.engine?.projectId;if(!monitor||!projectId)return;
  try{monitor.setOutputWanted?.(true,{projectId});if(monitor.audio?.srcObject)Promise.resolve(monitor.resume?.()).catch(()=>{});else monitor.primeOutput?.();}catch{}
 }
 touch(){
  this.lastInputAt=this.now();
  if(this.holdTimer!=null)return;
  this.holdTimer=this.setTimer(()=>{
   if(this.now()-this.lastInputAt>HOLD_WINDOW_MS||!this.channelOpen()){this.clearTimer(this.holdTimer);this.holdTimer=null;return;}
   try{this.monitor.sendControl({type:'live_hold'});}catch{}
  },HOLD_INTERVAL_MS);
 }
 scope(){const projectId=this.engine?.projectId||'';if(projectId!==this.lastProjectId){if(this.held.size)this.releaseAll('project-changed');this.lastProjectId=projectId;}return projectId;}
 /** Returns {sent,reason}. Never queues a late note. */
 noteOn(channel,pitch,{velocity=LIVE_NOTE_DEFAULT_VELOCITY,source='visual',midiChannel=1}={}){
  this.scope();const target=liveInstrumentTarget(channel),note=Math.round(Number(pitch));
  if(!target)return {sent:false,reason:'no-instrument'};
  if(!Number.isInteger(note)||note<0||note>127)return {sent:false,reason:'invalid-note'};
  if(!this.channelOpen()){try{this.engine?.warmMonitor?.();}catch{}return {sent:false,reason:'offline'};}
  this.primeSink();
  if(target.kind==='sample'){
   const message={type:'sample_preview',audio_file_id:target.audioFileId,bus_id:target.busId,duration_sec:Math.min(600,target.durationSec),gain:clamp(Number(channel.volume??.92)||0,0,2),playback_rate:clamp(2**((note-target.rootPitch)/12),.03125,32)};
   try{this.send(message);this.touch();return {sent:true,message};}catch(error){return {sent:false,reason:'send-failed',error};}
  }
  const ch=clamp(Math.round(Number(midiChannel)||1),1,16),held=this.held.get(target.key)||{target,notes:new Map()};
  if(held.notes.has(note))this.sendOff(held,note);
  const message={type:'midi_note',...target.trackId?{track_id:target.trackId}:{},lane_id:target.laneId,note,velocity:clamp(Number(velocity)||LIVE_NOTE_DEFAULT_VELOCITY,.01,1),channel:ch,on:true,perf_sent_ms:this.now(),event_id:uid(),event_source:`group:${this.group}:${target.laneId}:${ch}`};
  try{this.send(message);}catch(error){return {sent:false,reason:'send-failed',error};}
  held.target=target;held.notes.set(note,{channel:ch,source,eventId:message.event_id});this.held.set(target.key,held);this.touch();
  return {sent:true,message};
 }
 sendOff(held,note){
  const entry=held.notes.get(note);held.notes.delete(note);if(!held.notes.size)this.held.delete(held.target.key);
  const ch=entry?.channel||1,message={type:'midi_note',...held.target.trackId?{track_id:held.target.trackId}:{},lane_id:held.target.laneId,note,velocity:0,channel:ch,on:false,perf_sent_ms:this.now(),event_id:uid(),event_source:`group:${this.group}:${held.target.laneId}:${ch}`};
  if(!this.channelOpen()){this.fallbackRelease(held.target);return false;}
  try{this.send(message);return true;}catch{this.fallbackRelease(held.target);return false;}
 }
 noteOff(channel,pitch){
  const target=liveInstrumentTarget(channel),note=Math.round(Number(pitch));if(!target||target.kind!=='midi')return false;
  const held=this.held.get(target.key);if(!held?.notes.has(note))return false;
  return this.sendOff(held,note);
 }
 isHeld(channel,pitch){const target=liveInstrumentTarget(channel);return !!target&&!!this.held.get(target.key)?.notes.has(Math.round(Number(pitch)));}
 heldCount(){let count=0;for(const held of this.held.values())count+=held.notes.size;return count;}
 /** Explicit note-offs for held notes, then all-notes-off for the lane. */
 releaseLane(key,reason='release'){
  const held=this.held.get(key);if(!held)return;
  for(const note of [...held.notes.keys()])this.sendOff(held,note);
  this.held.delete(key);
  const target=held.target;
  if(!this.channelOpen()){this.fallbackRelease(target);return;}
  try{this.send({type:'midi_all_notes_off',...target.trackId?{track_id:target.trackId}:{},lane_id:target.laneId});this.record({type:'release',reason,laneId:target.laneId});}catch{this.fallbackRelease(target);}
 }
 releaseAll(reason='release'){for(const key of [...this.held.keys()])this.releaseLane(key,reason);}
 /** Release the lane even when nothing is tracked as held. */
 allNotesOff(channel,reason='all-notes-off'){
  const target=liveInstrumentTarget(channel);if(!target||target.kind!=='midi')return false;
  if(this.held.has(target.key)){this.releaseLane(target.key,reason);return true;}
  if(!this.channelOpen())return false;
  try{this.send({type:'midi_all_notes_off',...target.trackId?{track_id:target.trackId}:{},lane_id:target.laneId});this.record({type:'release',reason,laneId:target.laneId});return true;}catch{return false;}
 }
 /** Safety-only typed REST release; never a note-on. One attempt per lane. */
 fallbackRelease(target){
  const projectId=this.engine?.projectId,call=this.engine?.session?.call;
  if(!target?.trackId||!projectId||typeof call!=='function'){this.record({type:'release-unconfirmed',laneId:target?.laneId,reason:'no-runtime-instrument'});this.dispatchEvent(new CustomEvent('warning',{detail:{message:'The live cloud channel closed before a note release was confirmed. Stop the instrument in Freestyle if a note keeps sounding.'}}));return null;}
  const key=`${projectId}:${target.trackId}`;if(this.pendingRelease.has(key))return this.pendingRelease.get(key);
  const task=Promise.resolve().then(()=>call.call(this.engine.session,'engineMidiAllNotesOff',{project_id:projectId,instrument_id:String(target.trackId)})).then(result=>{this.record({type:'release-rest',laneId:target.laneId,ok:true});return result;},error=>{this.record({type:'release-rest',laneId:target.laneId,ok:false,error:error?.message});this.dispatchEvent(new CustomEvent('warning',{detail:{message:`Freestyle did not confirm the note release (${error?.message||error}).`}}));return null;}).finally(()=>this.pendingRelease.delete(key));
  this.pendingRelease.set(key,task);return task;
 }
 /** No stuck notes: release on blur, hidden page and page hide. */
 install(target=globalThis){
  const release=()=>this.releaseAll('blur'),hidden=()=>{if(target.document?.visibilityState==='hidden')this.releaseAll('hidden');};
  target.addEventListener?.('blur',release);target.addEventListener?.('pagehide',release);target.document?.addEventListener?.('visibilitychange',hidden);
  return ()=>{target.removeEventListener?.('blur',release);target.removeEventListener?.('pagehide',release);target.document?.removeEventListener?.('visibilitychange',hidden);};
 }
 dispose(){this.releaseAll('dispose');if(this.holdTimer!=null)this.clearTimer(this.holdTimer);this.holdTimer=null;}
}

/** Computer-keyboard musical typing (physical key codes, so layouts are stable). */
export const TYPING_NOTE_OFFSETS=Object.freeze({KeyA:0,KeyW:1,KeyS:2,KeyE:3,KeyD:4,KeyF:5,KeyT:6,KeyG:7,KeyY:8,KeyH:9,KeyU:10,KeyJ:11,KeyK:12,KeyO:13,KeyL:14,KeyP:15,Semicolon:16});
export function typingNote(code,octaveBase=60){const offset=TYPING_NOTE_OFFSETS[code];if(offset==null)return null;const note=octaveBase+offset;return note>=0&&note<=127?note:null;}

/** Parse one Web MIDI channel-voice message. */
export function parseMidiMessage(data){
 const bytes=data instanceof Uint8Array?data:Uint8Array.from(data||[]);if(bytes.length<2)return null;
 const status=bytes[0],kind=status>>4,channel=(status&15)+1,a=bytes[1]&127,b=(bytes[2]??0)&127;
 if(kind===9&&b>0)return {type:'on',note:a,velocity:b/127,channel};
 if(kind===8||(kind===9&&b===0))return {type:'off',note:a,channel};
 if(kind===11&&a===64)return {type:'sustain',on:b>=64,channel};
 if(kind===11&&(a===120||a===123))return {type:'all-off',channel};
 return null;
}

/** Web MIDI keyboard input with sustain handling and full release on disable. */
export class MidiInput{
 constructor({navigator:nav=globalThis.navigator,onNote,onAllOff}={}){this.navigator=nav;this.onNote=onNote;this.onAllOff=onAllOff;this.access=null;this.inputs=new Set();this.down=new Set();this.sustained=new Set();this.sustain=false;this.handler=event=>this.message(event.data);}
 get supported(){return typeof this.navigator?.requestMIDIAccess==='function';}
 async enable(){
  if(!this.supported)throw new Error('This browser does not provide Web MIDI input.');
  if(this.access)return this.inputs.size;
  this.access=await this.navigator.requestMIDIAccess({sysex:false});this.attach();
  this.access.onstatechange=()=>this.attach();return this.inputs.size;
 }
 attach(){for(const input of this.access?.inputs?.values?.()||[]){if(this.inputs.has(input))continue;input.addEventListener?input.addEventListener('midimessage',this.handler):input.onmidimessage=this.handler;this.inputs.add(input);}}
 message(data){
  const message=parseMidiMessage(data);if(!message)return;
  if(message.type==='on'){this.down.add(message.note);this.sustained.delete(message.note);this.onNote?.(message.note,true,message.velocity);}
  else if(message.type==='off'){this.down.delete(message.note);if(this.sustain)this.sustained.add(message.note);else this.onNote?.(message.note,false,0);}
  else if(message.type==='sustain'){this.sustain=message.on;if(!message.on){for(const note of this.sustained)this.onNote?.(note,false,0);this.sustained.clear();}}
  else if(message.type==='all-off'){this.down.clear();this.sustained.clear();this.onAllOff?.();}
 }
 disable(){for(const input of this.inputs){input.removeEventListener?input.removeEventListener('midimessage',this.handler):input.onmidimessage=null;}this.inputs.clear();if(this.access)this.access.onstatechange=null;this.access=null;const notes=[...this.down,...this.sustained];this.down.clear();this.sustained.clear();this.sustain=false;for(const note of new Set(notes))this.onNote?.(note,false,0);this.onAllOff?.();}
}
