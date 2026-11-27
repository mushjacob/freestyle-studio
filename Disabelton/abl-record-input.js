/** Disabelton — Live's track In/Out "Audio From" + Monitor (In / Auto / Off) for the cloud recorder.
 * Inputs come from navigator.mediaDevices.enumerateDevices() (labels appear once microphone permission exists);
 * the choice feeds CloudRecorder.setInput → getUserMedia constraints (cloud-recorder.js recordingConstraints) and the
 * engine self-monitor flag of the next take. No Web Audio monitoring: monitoring stays in the cloud engine.
 * Public: window.ablRecordInput = {state, refresh(), set({deviceId, mode, monitor}), renderInto(host), open(anchor)}.
 * The ● button's context menu (right-click) opens the chooser, and so does the Arrangement track header's context menu
 * ▸ Input… (abl-shell.js, audio tracks); the mixer lane may mount renderInto() in its In/Out section. open(anchor) takes
 * an element or a {x, y} point. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const ABL_MONITOR_LABELS=Object.freeze({in:'In',auto:'Auto',off:'Off'});
export async function listAudioInputs(mediaDevices=globalThis.navigator?.mediaDevices){
 if(!mediaDevices?.enumerateDevices)return[];let devices=[];try{devices=await mediaDevices.enumerateDevices();}catch{return[];}
 return devices.filter(device=>device.kind==='audioinput').map((device,index)=>({deviceId:device.deviceId,label:device.label||(device.deviceId==='default'?'Default input':`Input ${index+1}`)}));
}
export function installAblRecordInput({document:doc=globalThis.document,window:win=globalThis.window,recorder,mediaDevices=win?.navigator?.mediaDevices}={}){
 const state={inputs:[],deviceId:recorder?.input?.deviceId||'',mode:recorder?.input?.mode||'voice',monitor:recorder?.input?.monitor||'auto'};
 const hosts=new Set();
 const markup=()=>`<label class="abl-ri-f"><span>Audio From</span><select data-ri="device" aria-label="Audio From">${[{deviceId:'',label:'Default input'},...state.inputs.filter(item=>item.deviceId&&item.deviceId!=='default')].map(item=>`<option value="${esc(item.deviceId)}"${item.deviceId===state.deviceId?' selected':''}>${esc(item.label)}</option>`).join('')}</select></label>
<label class="abl-ri-f"><span>Source</span><select data-ri="mode" aria-label="Input type"><option value="voice"${state.mode==='voice'?' selected':''}>Microphone</option><option value="instrument"${state.mode==='instrument'?' selected':''}>Instrument (guitar / line)</option></select></label>
<div class="abl-ri-monitor" role="radiogroup" aria-label="Monitor">${Object.entries(ABL_MONITOR_LABELS).map(([key,label])=>`<button type="button" data-ri-monitor="${key}" aria-pressed="${state.monitor===key}" class="${state.monitor===key?'lit':''}" title="Monitor ${label}: ${key==='in'?'always hear the input through Freestyle':key==='auto'?'hear the input while recording':'never hear the input'}">${label}</button>`).join('')}</div>`;
 const paint=()=>{for(const host of hosts){if(!host.isConnected){hosts.delete(host);continue;}host.innerHTML=markup();}};
 const apply=()=>{recorder?.setInput?.({deviceId:state.deviceId,mode:state.mode,monitor:state.monitor});paint();};
 const bind=host=>{host.classList.add('abl-record-input');host.addEventListener('change',event=>{const which=event.target?.dataset?.ri;if(which==='device')state.deviceId=event.target.value;else if(which==='mode')state.mode=event.target.value;else return;apply();});
  host.addEventListener('click',event=>{const button=event.target.closest?.('[data-ri-monitor]');if(!button)return;event.preventDefault();state.monitor=button.dataset.riMonitor;apply();});hosts.add(host);host.innerHTML=markup();return host;};
 let popover=null;
 const api={state,
  async refresh(){state.inputs=await listAudioInputs(mediaDevices);if(state.deviceId&&!state.inputs.some(item=>item.deviceId===state.deviceId))state.deviceId='';apply();return state.inputs;},
  set(next={}){if(typeof next.deviceId==='string')state.deviceId=next.deviceId;if(next.mode==='voice'||next.mode==='instrument')state.mode=next.mode;if(next.monitor in ABL_MONITOR_LABELS)state.monitor=next.monitor;apply();return{...state};},
  renderInto(host){return host?bind(host):null;},
  open(anchor){if(!popover){popover=doc.createElement('div');popover.className='abl-record-input-popover';popover.setAttribute('role','dialog');popover.setAttribute('aria-label','Record input');bind(popover);doc.body.append(popover);doc.addEventListener('pointerdown',event=>{if(popover&&!popover.hidden&&!popover.contains(event.target))popover.hidden=true;},true);}
   const box=anchor?.getBoundingClientRect?.()||(Number.isFinite(anchor?.x)&&Number.isFinite(anchor?.y)?{left:anchor.x,bottom:anchor.y}:null);popover.hidden=false;if(box)popover.style.cssText=`position:fixed;z-index:9999;left:${Math.round(box.left)}px;top:${Math.round(box.bottom+4)}px`;api.refresh();return popover;},
  close(){if(popover)popover.hidden=true;},
 };
 doc.addEventListener('contextmenu',event=>{const button=event.target?.closest?.('#record');if(!button)return;event.preventDefault();event.stopPropagation();api.open(button);},true);
 mediaDevices?.addEventListener?.('devicechange',()=>api.refresh());
 apply();if(win)win.ablRecordInput=api;return api;
}

/** Studio API v1 live-ingest hooks for CloudRecorder.studio (cloud-recorder.js startStudio), over the typed client.
 * Ops (spec 2026-11-14): sendLiveIngestOffer, startRecording {lane_id, count_in_beats 1–8, bpm, seek_seconds,
 * start_transport}, finalizeRecording {take_id, confirm:true} (+ ?confirm=true), closeLiveIngest {clientId}.
 * Returns null when no typed client / project is available (the recorder then uses its native / capture path). */
export function studioRecordingHooks({client,projectId,countInBeats=()=>0,bpm=()=>null,startTransport=()=>true}={}){
 if(!client||typeof client.call!=='function'||typeof projectId!=='string'||!projectId)return null;
 const path={project_id:projectId},options=signal=>signal?{signal}:{};
 return{projectId,
  async offer(body,{signal}={}){const reply=await client.call('sendLiveIngestOffer',{path,body},options(signal));return reply?.data?.response??reply?.data??{};},
  async startRecording(body,{signal}={}){const reply=await client.call('startRecording',{path,body},options(signal));return reply?.data??{};},
  // Freestyle #4: waitFor 'placed' answers as soon as the clip is on its lane (saved:false, state:'saving').
  async finalize(takeId,{signal,waitFor=null,waitMs=null}={}){const body=takeId?{take_id:takeId,confirm:true,...waitFor==='placed'||waitFor==='saved'?{wait_for:waitFor}:{},...Number.isInteger(waitMs)&&waitMs>=0&&waitMs<=10000?{wait_ms:waitMs}:{}}:{confirm:true};const reply=await client.call('finalizeRecording',{path,query:{confirm:true},body},options(signal));return reply?.data??{};},
  async close(clientId){if(!clientId)return null;const reply=await client.call('closeLiveIngest',{path,body:{clientId}});return reply?.data??null;},
  async status(){const reply=await client.call('getRecordingStatus',{path});return reply?.data??null;},
  countInBeats,bpm,startTransport};
}

/** Live: an armed MIDI track + ● records the notes played (computer MIDI keyboard M and Web MIDI input) into the
 * clip shown in the Clip View, at the playhead, while the transport runs; ● again ends the take (ONE undo step:
 * abl-clip-view.js commits the whole take through addTakeNotes in one edit). Session slot recording is not offered:
 * Freestyle has no Session scenes / slot launch, so a take always lands in the open pattern clip. */
export class AblMidiRecordTake{
 constructor({clipView=()=>globalThis.window?.ablClipView,playing=()=>false,startTransport=async()=>{},toast=()=>{},onChange=()=>{},ensureClip=null}={}){Object.assign(this,{clipView,playing,startTransportHook:startTransport,toast,onChange,ensureClip});this.active=false;this.laneId=null;this.starting=false;}
 async start({laneId=null}={}){
  // Live: Arrangement Record on an armed MIDI track makes the clip itself. `ensureClip({laneId})` (app.js) creates a MIDI
  // clip at the insert marker on the armed track and shows it in the Clip View when no clip of that track is open.
  if(this.starting)return false;
  let made=null;if(typeof this.ensureClip==='function'){this.starting=true;this.onChange(this);try{made=await this.ensureClip({laneId});}finally{this.starting=false;this.onChange(this);}}
  const view=this.clipView();
  if(!view||view.kind!=='midi'||typeof view.setMidiRecord!=='function')throw Object.assign(new Error('MIDI recording writes into the open clip: double-click a MIDI clip on the armed track (Clip View), then press ● again.'),{code:'midi_record_no_clip'});/* only reached when the clip could not be created */
  /* A clip made for this take records linearly: notes keep their time after the clip start and the clip grows. */
  view.setMidiRecord(true,{linear:made==='created'});this.active=true;this.laneId=laneId;this.onChange(this);
  if(!this.playing())try{await this.startTransportHook();}catch(error){view.setMidiRecord(false);this.active=false;this.onChange(this);throw error;}
  this.toast('MIDI Record: play the computer MIDI keyboard (M) or a MIDI controller; ● again ends the take.');return true;
 }
 stop(){const view=this.clipView();if(view?.setMidiRecord)view.setMidiRecord(false);const was=this.active;this.active=false;this.laneId=null;this.onChange(this);return was;}
}
