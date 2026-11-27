/** Scope-bound live instrument audition. Current native Studio supports MIDI
 * addressed by durable lane_id without a numeric worker track_id.
 *
 * QA round 29 (Studio Pro parity): note-on/off go over the
 * open mozart-control channel (`midi_note`); when that channel is not open the same
 * note goes through the documented REST route (sendEngineMidi = execute_pro_action
 * send_midi) addressed by the lane id — Freestyle resolves it to the engine track
 * itself (verified live: instrument_id "<lane id>" → track_id 17), so no worker id is
 * guessed. Each note logs `piano-audition` with its route, send time and ack time.
 */
import {clientLog} from './client-diagnostics.js';
export const AUDITION_ACK_WAIT_MS=1500,AUDITION_SIGNAL_WINDOW_MS=1500,AUDITION_SIGNAL_THRESHOLD=.001;
const clone=value=>structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=64;
const abort=message=>Object.assign(new Error(message),{name:'AbortError',code:'audition_scope_changed'});
export class CloudInstrumentAudition{
 constructor({engine,heldNotes=engine?.heldNotes,setTimeout:later=(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout:cancel=id=>globalThis.clearTimeout(id),connectionTimeoutMs=5000}={}){if(!engine?.monitor||!engine.session||!(heldNotes instanceof Map))throw new Error('Instrument audition needs a cloud engine and held-note map.');Object.assign(this,{engine,heldNotes,later,cancel,connectionTimeoutMs});this.connection=null;this.orphans=new Map();const m=engine.monitor,reopen=()=>{try{this.flushOrphans();}catch(error){engine.onStatus?.(error.message);}};if(typeof m.addEventListener==='function'){for(const type of ['connected','state'])m.addEventListener(type,reopen);m.addEventListener('control',event=>{try{this.acknowledge(event.detail);}catch{}});m.addEventListener('meters',event=>{try{this.meterFrame(event.detail);}catch{}});}}
 /** A voice that sounded on a replaced peer/control generation may still be
  * held by the persistent engine worker. Remember its lane and pitch so the
  * next open control channel for the same project sends that pitch's NoteOff.
  * Per-pitch NoteOff is idempotent; a lane-wide all-off could cut voices held
  * by another owner. A different project or a replaced plugin instance (whose
  * voices died with it) is never targeted. */
 orphan(note){const projectId=note.scope?.projectId,laneId=note.binding?.laneId;if(!validId(projectId)||!validId(laneId)||projectId!==this.engine.projectId||!this.bindingCurrent(note.binding))return;const key=JSON.stringify([projectId,laneId]);let entry=this.orphans.get(key);if(!entry){entry={projectId,laneId,pitches:new Set()};this.orphans.set(key,entry);}entry.pitches.add(note.pitch);this.flushOrphans();}
 flushOrphans(){if(!this.orphans.size)return 0;const m=this.engine.monitor;for(const [key,entry]of this.orphans)if(entry.projectId!==this.engine.projectId)this.orphans.delete(key);if(!m.projectId||m.peer?.connectionState!=='connected')return 0;const control=m.control;if(control?.readyState!=='open'){if(control?.readyState==='connecting'&&typeof control.addEventListener==='function'&&!control.__vegetableOrphanFlush){control.__vegetableOrphanFlush=true;control.addEventListener('open',()=>{try{this.flushOrphans();}catch(error){this.engine.onStatus?.(error.message);}},{once:true});}return 0;}
  let sent=0;for(const [key,entry]of this.orphans){if(entry.projectId!==m.projectId)continue;this.orphans.delete(key);const live=new Set([...this.heldNotes.values()].filter(note=>note.sent&&note.binding.laneId===entry.laneId&&this.sameWire(note)).map(note=>note.pitch));
   for(const pitch of entry.pitches)if(!live.has(pitch)){m.sendMidi({laneId:entry.laneId,note:pitch,velocity:0,on:false});sent++;}}return sent;}

 scope(){const e=this.engine,s=e.session,scope={projectId:e.projectId,trackId:s.trackId,loadVersion:e.loadVersion||0,contextVersion:s.contextVersion||0};if(!e.ready||e.loading||s.closed||s.projectId!==scope.projectId||!validId(scope.projectId)||!validId(scope.trackId))throw abort('Load a ready Freestyle project before auditioning its instruments.');return scope;}
 current(scope){try{return same(scope,this.scope());}catch{return false;}}
 binding(channel){const e=this.engine,candidates=(e.project?.channels||[]).filter(c=>c.id===channel?.id);if(candidates.length!==1)throw abort('The selected cloud instrument changed. Select its current channel before auditioning.');const c=candidates[0],raw=c.cloudSource||c.cloudRaw||{},laneId=c.laneId||raw.laneId;if(!validId(laneId)||c.type!=='instrument'&&!c.instrumentType&&raw.kind!=='plugin')throw new Error('Freestyle has not supplied this instrument’s durable lane identity.');const expectedRaw=channel?.cloudSource||channel?.cloudRaw||{},expectedLane=channel?.laneId||expectedRaw.laneId;if(expectedLane&&expectedLane!==laneId||channel?.patternId!=null&&channel.patternId!==c.patternId||channel?.sourceId!=null&&channel.sourceId!==c.sourceId||channel?.instrumentType!=null&&channel.instrumentType!==c.instrumentType)throw abort('The requested instrument source binding changed. Select its current channel.');const lane=e.project?.cloud?.rawProject?.lanes?.find(lane=>lane.id===laneId),slot=lane?.pluginChain?.filter(plugin=>plugin.position===0),instance=slot?.length===1&&typeof slot[0].pluginKey==='string'?slot[0].pluginKey:null;return{id:c.id,laneId,patternSource:!!c.patternSource,patternId:c.patternId??null,sourceId:c.sourceId??raw.id??null,instrumentType:c.instrumentType??raw.instrumentType??null,instance};}
 bindingCurrent(binding){try{const current=this.binding({id:binding.id});return['id','laneId','patternSource','patternId','sourceId','instrumentType'].every(key=>current[key]===binding[key])&&(!binding.instance||binding.instance===current.instance);}catch{return false;}}
 wire(scope){const m=this.engine.monitor;return m.projectId===scope.projectId&&m.trackId===scope.trackId&&m.peer?.connectionState==='connected'&&m.control?.readyState==='open';}
 wireSnapshot(){const m=this.engine.monitor;return{generation:m.generation,peer:m.peer,control:m.control};}
 sameWire(note){const m=this.engine.monitor;return this.current(note.scope)&&this.bindingCurrent(note.binding)&&this.wire(note.scope)&&m.generation===note.wire?.generation&&m.peer===note.wire?.peer&&m.control===note.wire?.control;}
 waitForControl(scope){const m=this.engine.monitor;if(this.wire(scope))return Promise.resolve();if(!this.current(scope)||m.projectId!==scope.projectId||m.trackId!==scope.trackId||m.peer?.connectionState!=='connected')return Promise.reject(abort('The audio monitor opened in a different project or take context.'));const channel=m.control,generation=m.generation,peer=m.peer;if(channel?.readyState!=='connecting'||!channel.addEventListener)return Promise.reject(new Error('The cloud instrument control channel did not open.'));
  return new Promise((resolve,reject)=>{let timer;const finish=error=>{this.cancel(timer);for(const type of ['open','close','error'])channel.removeEventListener(type,handlers[type]);error?reject(error):resolve();},handlers={open:()=>{if(!this.current(scope)||m.control!==channel||m.peer!==peer||m.generation!==generation||!this.wire(scope))finish(abort('The audio monitor changed before instrument controls opened.'));else finish();},close:()=>finish(new Error('The instrument control channel closed before auditioning.')),error:()=>finish(new Error('The instrument control channel could not open.'))};for(const type of Object.keys(handlers))channel.addEventListener(type,handlers[type]);timer=this.later(()=>finish(new Error('The instrument control channel did not open in time.')),this.connectionTimeoutMs);});
 }
 waitForSharedConnection(scope){const m=this.engine.monitor,generation=m.generation;return new Promise((resolve,reject)=>{let timer,done=false;const finish=error=>{if(done)return;done=true;this.cancel(timer);for(const type of ['state','connected','error'])m.removeEventListener(type,check);error?reject(error):resolve();},check=()=>{if(!this.current(scope)||m.generation!==generation||m.projectId!==scope.projectId||m.trackId!==scope.trackId)return finish(abort('The shared monitor connection changed before auditioning.'));if(m.peer?.connectionState==='connected')return finish();if(['error','disconnected','idle'].includes(m.state))finish(new Error('The shared cloud audio monitor did not connect.'));};for(const type of ['state','connected','error'])m.addEventListener(type,check);timer=this.later(()=>finish(new Error('The shared cloud audio monitor did not connect in time.')),this.connectionTimeoutMs);check();});}
 connect(scope){if(this.wire(scope))return Promise.resolve();if(this.connection&&same(this.connection.scope,scope))return this.connection.promise;const m=this.engine.monitor;let resolve,reject;const attempt={scope:clone(scope),promise:new Promise((yes,no)=>{resolve=yes;reject=no;})};this.connection=attempt;
  const complete=async result=>{if(result===false)throw abort('The cloud audio monitor connection was superseded.');if(!this.current(scope))throw abort('The cloud project changed while instrument monitoring connected.');await this.waitForControl(scope);if(!this.current(scope)||!this.wire(scope))throw abort('The instrument monitor binding changed before auditioning.');};
  try{const existing=m.state==='connecting'&&m.projectId===scope.projectId&&m.trackId===scope.trackId&&typeof m.addEventListener==='function',opening=typeof this.engine.ensureMonitorReady==='function'?this.engine.ensureMonitorReady({retry:true}):existing?this.waitForSharedConnection(scope):m.start(scope.projectId,scope.trackId);Promise.resolve(opening).then(complete).then(resolve,reject).finally(()=>{if(this.connection===attempt)this.connection=null;});}catch(error){if(this.connection===attempt)this.connection=null;reject(error);}return attempt.promise;
 }
 key(binding,pitch){return JSON.stringify([binding.laneId,pitch]);}
 active(note){return!note.cancelled&&this.heldNotes.get(note.key)===note&&this.current(note.scope)&&this.bindingCurrent(note.binding)&&(note.selection==null||note.selection===(this.engine.selectedPattern??null));}
 armPreview(note){const owner=note.legacy;if(!note.sent||!owner?.preview||owner.cancelled||owner.timer!=null)return;owner.timer=this.later(()=>{try{this.releaseOwner(note,owner);}catch(error){this.engine.onStatus?.(error.message);}},250);}
 send(note){if(!this.active(note))return false;if(!this.wire(note.scope))throw new Error('Connect the current instrument control channel before auditioning.');const deliver=()=>{if(!this.active(note)||!this.wire(note.scope))return false;const m=this.engine.monitor;this.flushOrphans();if(m.state==='blocked'&&m.resume)Promise.resolve(m.resume()).catch(error=>this.engine.onStatus?.(error.message));note.wire=this.wireSnapshot();const started=this.now();const payload=m.sendMidi({laneId:note.binding.laneId,note:note.pitch,velocity:note.velocity,on:true,ack:true});this.watchSignal(note,started);note.sent=true;note.route='control';this.trackAck(payload,{note,on:true,started});this.holdLive();this.armPreview(note);return true;},prepared=this.engine.prepareAudition?.({current:()=>this.active(note)&&this.wire(note.scope)});return prepared?.then?prepared.then(ready=>ready===false?false:deliver()):prepared===false?false:deliver();}
 voice(channel,pitch,velocity){if(!Number.isInteger(pitch)||pitch<0||pitch>127||typeof velocity!=='number'||!Number.isFinite(velocity)||velocity<0||velocity>1)throw new Error('Audition needs a MIDI pitch and velocity between zero and one.');const scope=this.scope(),binding=this.binding(channel),key=this.key(binding,pitch);let note=this.heldNotes.get(key);if(note&&(!this.active(note)||note.sent&&!this.sameWire(note))){this.release(note);note=null;}if(!note){note={key,scope,binding,pitch,velocity,selection:this.engine.selectedPattern??null,sent:false,cancelled:false,owners:new Set(),legacy:null,promise:null};this.heldNotes.set(key,note);}return note;}
 /** Pro parity: no open control channel → the same note over REST now (and the peer is
  * brought up in the background for the next notes), instead of waiting up to 5 s. */
 restAvailable(note){return this.engine.session?.rawState?.studioApi===true&&typeof this.engine.session.call==='function'&&validId(note?.binding?.laneId)&&this.current(note.scope);}
 async restSend(note,on){
  const laneId=note.binding.laneId,started=this.now(),scope=note.scope;let ok=false,error=null,result=null;if(on)this.watchSignal(note,started);
  try{result=await this.engine.session.call('execute_pro_action',{project_id:scope.projectId,track_id:scope.trackId,action:'send_midi',arguments:{instrument_id:laneId,lane_id:laneId,note:note.pitch,velocity:on?note.velocity:0,action:on?'note_on':'note_off'}});
   const events=result?.response?.events??result?.events??result?.structuredContent?.response?.events;ok=Array.isArray(events)?events.length>0&&events.every(item=>item?.ok!==false):result?.ok!==false;}
  catch(caught){error=caught;}
  this.log({route:'rest',on,laneId,note:note.pitch,velocity:on?note.velocity:0,sentMs:0,ackMs:this.now()-started,acknowledged:ok&&!error,trackId:result?.response?.events?.[0]?.track_id??null,error:error?String(error.message||error).slice(0,160):null});
  if(error)throw error;if(!ok)throw new Error('Freestyle did not queue the instrument note.');return true;
 }
 /** Pro's dispatcher (fallbackWhenNotReady:false): a note made while the peer connects is
  * buffered and sent in real time once the channel opens; only a channel that cannot be
  * used (connect/send failure) falls back to HTTP for this note. */
 restFallback(note,error){
  if(!this.restAvailable(note)||!this.active(note))return Promise.reject(error);
  this.log({route:'rest-fallback',reason:String(error?.message||error||'channel unavailable').slice(0,160),laneId:note.binding.laneId,note:note.pitch});
  // If HTTP fails too, the user sees the original (channel) reason, with the HTTP failure as its cause.
  note.route='rest';note.sent=true;return this.restSend(note,true).then(()=>this.active(note),failure=>{note.sent=false;throw error instanceof Error?Object.assign(error,{restFallbackError:failure}):failure;});
 }
 start(note){if(note.promise)return;const failed=error=>{if(note.cancelled||!this.active(note))return false;note.error=error;this.release(note);throw error;};
  // Open channel: the note goes out synchronously (no added latency); a send failure falls back to HTTP.
  if(this.wire(note.scope)&&this.restAvailable(note)){let sent;try{sent=Promise.resolve(this.send(note)).catch(error=>this.restFallback(note,error));}catch(error){sent=this.restFallback(note,error);}note.promise=sent.catch(failed).finally(()=>{if(!note.sent)this.release(note);});return;}
  if(!this.wire(note.scope)&&this.restAvailable(note)){note.promise=this.connect(note.scope).then(()=>this.send(note),error=>this.restFallback(note,error)).catch(failed).finally(()=>{if(!note.sent)this.release(note);});return;}
  if(this.wire(note.scope)){try{note.promise=Promise.resolve(this.send(note)).catch(failed).finally(()=>{if(!note.sent)this.release(note);});}catch(error){try{note.promise=Promise.resolve(failed(error));}catch(failure){note.promise=Promise.reject(failure);}}}else note.promise=this.connect(note.scope).then(()=>this.send(note)).catch(failed).finally(()=>{if(!note.sent)this.release(note);});}
 own(note,{preview=false,legacy=false}={}){const owner={cancelled:false,released:false,preview,timer:null};note.owners.add(owner);if(legacy)note.legacy=owner;this.start(note);this.armPreview(note);owner.ready=note.promise.then(sent=>!owner.cancelled&&this.active(note)&&sent,error=>{if(owner.released||owner.cancelled&&note.error!==error)return false;throw error;});return owner;}
 /** Independent ownership of one live voice. Releasing this handle can never
  * release another caller's keyboard, pulse or scrub ownership. */
 acquire(channel,pitch,velocity=.8){const note=this.voice(channel,pitch,velocity),owner=this.own(note);return Object.freeze({ready:owner.ready,release:()=>this.releaseOwner(note,owner)});}
 noteOn(channel,pitch,velocity=.8,{preview=false}={}){try{const note=this.voice(channel,pitch,velocity);if(note.legacy){const owner=note.legacy;if(!preview&&owner.preview){owner.preview=false;this.cancel(owner.timer);owner.timer=null;}return owner.ready;}return this.own(note,{preview,legacy:true}).ready;}catch(error){return Promise.reject(error);}}
 releaseOwner(note,owner){if(!owner||owner.cancelled||!note.owners.has(owner))return false;owner.cancelled=owner.released=true;this.cancel(owner.timer);owner.timer=null;note.owners.delete(owner);if(note.legacy===owner)note.legacy=null;if(!note.owners.size)this.release(note);return true;}
 discardOwners(note){for(const owner of note.owners){owner.cancelled=true;this.cancel(owner.timer);owner.timer=null;}note.owners.clear();note.legacy=null;}
 release(note){if(!note||this.heldNotes.get(note.key)!==note)return false;note.cancelled=true;this.discardOwners(note);this.heldNotes.delete(note.key);if(!note.sent)return false;
  // A REST note-on is paired with a REST note-off (always: a held voice must stop).
  if(note.route==='rest'){Promise.resolve(note.promise).catch(()=>{}).finally(()=>this.restSend(note,false).catch(error=>this.engine.onStatus?.(error.message)));return true;}
  if(!this.sameWire(note)){this.orphan(note);return false;}const started=this.now(),payload=this.engine.monitor.sendMidi({laneId:note.binding.laneId,note:note.pitch,velocity:0,on:false});this.trackAck(payload,{note,on:false,started});return true;}
 now(){return globalThis.performance?.now?.()??Date.now();}
 /** Ack-wait and live_hold timers are diagnostics/keep-alive, separate from the audition's own timing (and never keep a process alive). */
 diagnosticTimer(fn,ms){const id=globalThis.setTimeout(fn,ms);id?.unref?.();return id;}
 log(entry){try{clientLog('piano-audition',entry);}catch{}try{this.onAudition?.(entry);}catch{}}
 /** A control-channel note is sent at once; its ack is the engine's echo of the same
  * event_id on mozart-control (Pro mirrors remote midi_note events by event_id). No
  * echo within AUDITION_ACK_WAIT_MS logs the send with ackMs null — never a fake ack. */
 trackAck(payload,{note,on,started}){
  const id=payload?.event_id,requested=payload?.ack===true,entry={route:'control',on,laneId:note.binding.laneId,note:note.pitch,velocity:on?note.velocity:0,sentMs:Math.max(0,this.now()-started),eventId:id??null,ackRequested:requested};
  // Only a note sent with ack:true is acknowledged (Pro: note-on only); the rest log at once.
  if(!id||!requested){this.log({...entry,ackMs:null,acknowledged:false});return;}
  const seen=this.ackStats?{...this.ackStats}:null;
  (this.pendingAcks??=new Map()).set(id,{entry,started,timer:this.diagnosticTimer(()=>{if(this.pendingAcks.delete(id))this.log({...entry,ackMs:null,acknowledged:false,...this.ackEvidence(seen)});},AUDITION_ACK_WAIT_MS)});
 }
 /** The engine acknowledges live MIDI in engine_clock.midi_acks [{event_id, position_samples}]
  * (Studio Pro's live-MIDI ack path); a direct echo carrying the event_id also counts. */
 /** Audibility proof (QA round 30): after a note-on, watch the auditioned lane's meter in the
  * engine's mixer_meters frames ([engine_id, lane_id, peak, live]) for AUDITION_SIGNAL_WINDOW_MS
  * and log one `lane-meter-signal` (source audition) with the peak and send → first-signal time. */
 watchSignal(note,started){
  const laneId=note?.binding?.laneId;if(!validId(laneId))return;const watches=this.signalWatches??=new Map();const previous=watches.get(laneId);if(previous)this.finishSignal(laneId);
  const watch={laneId,note:note.pitch,started,peak:0,frames:0,firstSignalMs:null,playing:!!this.engine.playing,timer:null};watch.timer=this.diagnosticTimer(()=>this.finishSignal(laneId),AUDITION_SIGNAL_WINDOW_MS);watches.set(laneId,watch);
 }
 meterFrame(frame){
  if(!this.signalWatches?.size||!Array.isArray(frame?.tracks))return;const now=this.now();
  for(const entry of frame.tracks){const laneId=Array.isArray(entry)?entry[1]:entry?.lane_id,peak=Number(Array.isArray(entry)?entry[2]:entry?.peak),watch=laneId?this.signalWatches.get(laneId):null;if(!watch||!Number.isFinite(peak))continue;
   watch.frames++;watch.peak=Math.max(watch.peak,peak);if(watch.firstSignalMs===null&&peak>=AUDITION_SIGNAL_THRESHOLD)watch.firstSignalMs=Math.round(now-watch.started);}
 }
 finishSignal(laneId){
  const watch=this.signalWatches?.get(laneId);if(!watch)return;this.signalWatches.delete(laneId);globalThis.clearTimeout(watch.timer);
  try{clientLog('lane-meter-signal',{source:'audition',laneId,note:watch.note,peak:Math.round(watch.peak*1000)/1000,signal:watch.peak>=AUDITION_SIGNAL_THRESHOLD,firstSignalMs:watch.firstSignalMs,frames:watch.frames,windowMs:AUDITION_SIGNAL_WINDOW_MS,playing:watch.playing,reason:watch.frames?null:'no-meter-frames-for-lane'});}catch{}
  try{this.onSignal?.(watch);}catch{}
 }
 /** What came back on mozart-control while a note waited (QA round 30 evidence):
  * engine_clock messages, how many carried midi_acks, and a sample of their keys/ids. */
 countAckTraffic(message){
  if(message?.type!=='engine_clock')return;const stats=this.ackStats??={clocks:0,withAcks:0,acks:0,lastAckKeys:null,lastAckIds:[]};stats.clocks++;
  if(Array.isArray(message.midi_acks)&&message.midi_acks.length){stats.withAcks++;stats.acks+=message.midi_acks.length;stats.lastAckKeys=Object.keys(message.midi_acks[0]||{}).slice(0,8);stats.lastAckIds=message.midi_acks.slice(0,3).map(ack=>String(ack?.event_id??ack?.eventId??ack?.id??'')).filter(Boolean);}
 }
 ackEvidence(before){const now=this.ackStats||{clocks:0,withAcks:0,acks:0,lastAckKeys:null,lastAckIds:[]},base=before||{clocks:0,withAcks:0,acks:0};return{clocksWhileWaiting:now.clocks-base.clocks,clocksWithMidiAcks:now.withAcks-base.withAcks,midiAcksSeen:now.acks-base.acks,lastAckKeys:now.lastAckKeys,lastAckIds:now.lastAckIds};}
 acknowledge(message){
  try{this.countAckTraffic(message);}catch{}
  if(!this.pendingAcks?.size||!message||typeof message!=='object')return false;
  const acks=message.type==='engine_clock'&&Array.isArray(message.midi_acks)?message.midi_acks:message.event_id?[message]:[];let resolved=false;
  for(const ack of acks){const id=ack?.event_id,pending=id?this.pendingAcks.get(id):null;if(!pending)continue;this.pendingAcks.delete(id);globalThis.clearTimeout(pending.timer);resolved=true;
   this.log({...pending.entry,ackMs:this.now()-pending.started,acknowledged:true,ackType:String(message.type||''),...Number.isFinite(ack.position_samples)?{positionSamples:ack.position_samples}:{}});}
  return resolved;
 }
 /** Pro keeps the live engine hot while the keyboard is in use: live_hold every second for 20 s after the last note. */
 holdLive(){this.lastNoteAt=Date.now();if(this.holdTimer!=null)return;const tick=()=>{this.holdTimer=null;const m=this.engine.monitor;if(Date.now()-this.lastNoteAt>20000||!m?.projectId||m.control?.readyState!=='open')return;try{m.sendControl?.({type:'live_hold',project_id:m.projectId});}catch{}this.holdTimer=this.diagnosticTimer(tick,1000);};this.holdTimer=this.diagnosticTimer(tick,1000);}
 noteOff(channel,pitch){const laneId=channel?.laneId||channel?.cloudSource?.laneId||channel?.cloudRaw?.laneId;if(!validId(laneId))return false;const note=this.heldNotes.get(JSON.stringify([laneId,pitch]));return note?this.releaseOwner(note,note.legacy):false;}
 releaseNotes(){const notes=[...this.heldNotes.values()],lanes=new Map();for(const note of notes){note.cancelled=true;this.discardOwners(note);if(note.sent&&this.sameWire(note))lanes.set(note.binding.laneId,note);}this.heldNotes.clear();for(const note of notes)if(note.sent&&!lanes.has(note.binding.laneId)&&!this.sameWire(note)){try{this.orphan(note);}catch(error){this.engine.onStatus?.(error.message);}}for(const note of lanes.values()){try{if(this.engine.monitor.allNotesOff)this.engine.monitor.allNotesOff({laneId:note.binding.laneId});else for(const held of notes)if(held.binding.laneId===note.binding.laneId&&held.sent&&this.sameWire(held))this.engine.monitor.sendMidi({laneId:held.binding.laneId,note:held.pitch,velocity:0,on:false});}catch(error){this.engine.onStatus?.(error.message);}}}
}
