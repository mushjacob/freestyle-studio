/** FL Channel settings window (Sampler tab) for sample channels. DOM and wiring
 * only: field logic lives in channel-settings.js. Every change goes through the
 * injected `update(channel, fields, label)` (the app's updateRackChannel, one
 * undo step each). `sync()` repaints from the current project, so edits made
 * elsewhere (rack menu, undo, another editor) show up here. */
import {sampleWaveformSvg} from './pattern-channel-ops.js';
import {ROOT_NOTES,SAMPLE_PLAYBACK_MODES,DISABLED_CONTROLS,NEEDS_ENGINE,STEP_LABELS,settingsModel,fieldsFor,moveMarker,nearestMarker,secondsAtX,sameRange,releaseApplies,rootNoteName,playbackModeLabel} from './channel-settings.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const seconds=value=>`${(Math.round(value*1000)/1000).toFixed(3)} s`;
const disabledControl=control=>{
 const id=`cs-off-${control.id}`,label=`<label for="${id}">${esc(control.label)}</label>`,attrs=`id="${id}" disabled title="${NEEDS_ENGINE}" aria-label="${esc(control.label)}. ${NEEDS_ENGINE}"`;
 const input=control.type==='check'?`<input type="checkbox" ${attrs}>`:control.type==='select'?`<select ${attrs}>${control.options.map(option=>`<option>${esc(option)}</option>`).join('')}</select>`:`<input type="number" ${attrs}>`;
 return`<div class="cs-field cs-unsupported" title="${NEEDS_ENGINE}">${label}${input}${control.unit?`<small>${esc(control.unit)}</small>`:''}</div>`;
};
const groupedDisabled=list=>{const groups=new Map();for(const control of list){const key=control.group||'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(control);}return[...groups].map(([name,items])=>`<fieldset class="cs-group">${name?`<legend>${esc(name)}</legend>`:''}${items.map(disabledControl).join('')}</fieldset>`).join('');};

export class ChannelSettingsView{
 /** deps: openWindow(title,html)->dialog, getChannel(id), getProjectId(), waveforms{get}, lanes()->[{id,name}], update(channel,fields,label)->Promise|any,
  *  editable(channel)->bool, makeVolumeKnob(button,channel)->knob, mixerNumber(channel)->string, onOpen(), notify(message) */
 constructor(deps){this.deps=deps;this.dialog=null;this.channelId=null;this.waveform=null;this.drag=null;this.knob=null;this.tab='smp';this.token=0;}
 get isOpen(){return!!this.dialog?.isConnected&&this.dialog.open;}
 open(channelId){
  const channel=this.deps.getChannel(channelId);if(!channel||channel.type!=='sample')return false;
  if(this.isOpen&&this.channelId===channelId){this.deps.raise?.(this.dialog);return true;}
  this.close();this.channelId=channelId;this.waveform=null;this.tab='smp';
  const lanes=this.deps.lanes();
  const html=`<div class="channel-settings" data-channel="${esc(channelId)}">
   <div class="cs-header">
    <input class="cs-name" type="text" maxlength="255" aria-label="Channel name" spellcheck="false">
    <input class="cs-color" type="color" aria-label="Channel color" title="Channel color">
    <div class="cs-knobs"><span class="cs-knob-box"><button class="small-knob pan" disabled title="${esc(DISABLED_CONTROLS.pan.reason)}" aria-label="Pan. ${NEEDS_ENGINE}"></button><small>PAN</small></span>
    <span class="cs-knob-box"><button class="small-knob volume" aria-label="Channel volume"></button><small>VOL</small></span></div>
    <label class="cs-track">Mixer track <select class="cs-route" aria-label="Route to mixer track"><option value="">Pattern clip’s track</option>${lanes.map(lane=>`<option value="${esc(lane.id)}">${esc(lane.name||'Track')}</option>`).join('')}</select><output class="cs-track-number"></output></label>
   </div>
   <div class="cs-tabs" role="tablist"><button type="button" role="tab" data-tab="smp" aria-selected="true">Sampler</button><button type="button" role="tab" data-tab="ins" aria-selected="false" title="Envelopes, filter and polyphony. ${NEEDS_ENGINE}">Instrument</button></div>
   <div class="cs-panel" data-panel="smp">
    <div class="cs-wave" tabindex="0" aria-label="Sample waveform with start and end markers"><div class="cs-wave-svg"></div><div class="cs-shade cs-shade-start"></div><div class="cs-shade cs-shade-end"></div><div class="cs-marker cs-marker-start" data-marker="start" title="Sample start"></div><div class="cs-marker cs-marker-end" data-marker="end" title="Sample end"></div><div class="cs-wave-note"></div></div>
    <div class="cs-readout"><span>Start <output class="cs-start"></output></span><span>End <output class="cs-end"></output></span><span>Length <output class="cs-length"></output></span></div>
    <div class="cs-fields">
     <div class="cs-field"><label>Root note <select class="cs-root" aria-label="Set from note">${ROOT_NOTES.map(note=>`<option value="${note.pitch}">${esc(note.name)} (${note.pitch})</option>`).join('')}</select></label></div>
     <div class="cs-field"><label>Playback mode <select class="cs-mode">${SAMPLE_PLAYBACK_MODES.map(mode=>`<option value="${esc(mode.value)}" title="${esc(mode.hint)}">${esc(mode.label)}</option>`).join('')}</select></label></div>
     <div class="cs-field"><label>Release <input class="cs-release" type="range" min="0" max="2" step="0.001"></label><output class="cs-release-out"></output></div>
    </div>
    <div class="cs-fields cs-extra">${DISABLED_CONTROLS.smp.map(disabledControl).join('')}</div>
   </div>
   <div class="cs-panel" data-panel="ins" hidden>${groupedDisabled(DISABLED_CONTROLS.ins)}</div>
   <p class="cs-status" role="status"></p>
  </div>`;
  const dialog=this.dialog=this.deps.openWindow('Channel settings',html);dialog.classList.add('channel-settings-window');
  dialog.addEventListener('close',()=>{if(this.dialog===dialog)this.teardown();});
  this.bind();this.deps.onOpen?.();this.load();this.paint();return true;
 }
 close(){const dialog=this.dialog;this.teardown();if(dialog?.open)dialog.close();}
 teardown(){this.cancelDrag();this.knob?.destroy?.();this.knob=null;this.knobChannel=null;this.dialog=null;this.channelId=null;this.token++;}
 $(selector){return this.dialog?.querySelector(selector)??null;}
 channel(){return this.channelId==null?null:this.deps.getChannel(this.channelId);}
 /** Fields the user may save right now. */
 editable(channel){try{return this.deps.editable(channel)===true;}catch{return false;}}
 status(message){const out=this.$('.cs-status');if(out)out.textContent=message||'';}
 async save(control,value,context){
  const channel=this.channel();if(!channel)return false;
  const fields=fieldsFor(control,value,{full:context?.full,source:channel.cloudSource});
  if(!fields){this.status('That value cannot be saved.');this.paint();return false;}
  if(!this.editable(channel)){this.status('Channel settings need a saved Freestyle pattern.');this.paint();return false;}
  this.status('');
  try{await this.deps.update(channel,fields,STEP_LABELS[control]);}catch(error){this.status(error?.message||'The change was not saved.');}
  this.paint();return true;
 }
 load(){
  const channel=this.channel(),audioFileId=channel?.audioFileId,token=++this.token;if(!channel||!audioFileId)return;
  Promise.resolve(this.deps.waveforms.get(this.deps.getProjectId(),audioFileId)).then(waveform=>{if(token!==this.token||!this.isOpen)return;this.waveform=waveform;this.paintWave();this.paint();},()=>{if(token!==this.token||!this.isOpen)return;this.waveform={unavailable:true};this.paintWave();});
 }
 bind(){
  const dialog=this.dialog,on=(selector,type,fn)=>this.$(selector)?.addEventListener(type,fn);
  on('.cs-name','change',event=>this.save('name',event.target.value));
  on('.cs-color','change',event=>this.save('color',event.target.value));
  on('.cs-route','change',event=>this.save('outputLaneId',event.target.value||null));
  on('.cs-root','change',event=>this.save('rootPitch',Number(event.target.value)));
  on('.cs-mode','change',event=>this.save('samplePlaybackMode',event.target.value));
  on('.cs-release','input',event=>{const out=this.$('.cs-release-out');if(out)out.textContent=seconds(Number(event.target.value));});
  on('.cs-release','change',event=>this.save('sampleReleaseTauSec',Number(event.target.value)));
  for(const tab of dialog.querySelectorAll('.cs-tabs [data-tab]'))tab.addEventListener('click',()=>{this.tab=tab.dataset.tab;this.paintTabs();});
  const wave=this.$('.cs-wave');
  wave.addEventListener('pointerdown',event=>this.dragStart(event));wave.addEventListener('pointermove',event=>this.dragMove(event));
  wave.addEventListener('pointerup',event=>this.dragEnd(event,true));wave.addEventListener('pointercancel',event=>this.dragEnd(event,false));
  wave.addEventListener('keydown',event=>this.nudge(event));
  this.bindKnob();
 }
 /** The volume knob is bound to one channel object; a project reload replaces it, so rebind. */
 bindKnob(){
  const button=this.$('.small-knob.volume'),channel=this.channel();if(!button||!channel||this.knobChannel===channel)return;
  this.knob?.destroy?.();this.knobChannel=channel;this.knob=this.deps.makeVolumeKnob(button,channel);
 }
 /** Pointer geometry: x within the waveform box. */
 localX(event){const rect=this.$('.cs-wave').getBoundingClientRect();return{x:event.clientX-rect.left,width:rect.width};}
 model(){const channel=this.channel();return channel?settingsModel(channel,this.waveform):null;}
 dragStart(event){
  const model=this.model();if(event.button!==0||!model?.range||!this.editable(this.channel()))return;
  const {x,width}=this.localX(event),which=event.target.dataset?.marker||nearestMarker(model.range,x,width);if(!which)return;
  event.preventDefault();this.$('.cs-wave').setPointerCapture?.(event.pointerId);
  this.drag={which,pointerId:event.pointerId,before:model.range,range:moveMarker(model.range,which,secondsAtX(x,width,model.full))};this.paintMarkers(this.drag.range);
 }
 dragMove(event){
  const drag=this.drag;if(!drag||event.pointerId!==drag.pointerId)return;
  const {x,width}=this.localX(event);drag.range=moveMarker(drag.before,drag.which,secondsAtX(x,width,drag.before.fullSec));this.paintMarkers(drag.range);
 }
 dragEnd(event,commit){
  const drag=this.drag;if(!drag||event.pointerId!==drag.pointerId)return;this.drag=null;
  try{this.$('.cs-wave')?.releasePointerCapture?.(event.pointerId);}catch{}
  if(commit&&!sameRange(drag.range,drag.before))this.save('range',drag.range);else this.paint();
 }
 cancelDrag(){if(this.drag){this.drag=null;}}
 /** Arrow keys move the nearest-focus marker (start with Left/Right, end with Shift). One step per key press. */
 nudge(event){
  const model=this.model();if(!model?.range||!['ArrowLeft','ArrowRight'].includes(event.key)||!this.editable(this.channel()))return;
  event.preventDefault();const which=event.shiftKey?'end':'start',step=(event.altKey?.001:.01)*(event.key==='ArrowLeft'?-1:1);
  const next=moveMarker(model.range,which,(which==='start'?model.range.startSec:model.range.endSec)+step);if(!sameRange(next,model.range))this.save('range',next);
 }
 paintTabs(){
  for(const tab of this.dialog?.querySelectorAll('.cs-tabs [data-tab]')??[])tab.setAttribute('aria-selected',String(tab.dataset.tab===this.tab));
  for(const panel of this.dialog?.querySelectorAll('.cs-panel')??[])panel.hidden=panel.dataset.panel!==this.tab;
 }
 paintWave(){
  const holder=this.$('.cs-wave-svg'),note=this.$('.cs-wave-note');if(!holder)return;
  if(!this.waveform){holder.innerHTML='';if(note)note.textContent='Reading the sample waveform…';return;}
  if(this.waveform.unavailable){holder.innerHTML='';if(note)note.textContent='Freestyle could not decode a waveform for this sample.';return;}
  holder.innerHTML=sampleWaveformSvg(this.waveform,{width:480,height:96});if(note)note.textContent='';
 }
 paintMarkers(range){
  const wave=this.$('.cs-wave');if(!wave||!range)return;const pct=value=>`${(value/range.fullSec*100).toFixed(3)}%`;
  wave.style.setProperty('--cs-start',pct(range.startSec));wave.style.setProperty('--cs-end',pct(range.endSec));
  const set=(selector,text)=>{const out=this.$(selector);if(out)out.textContent=text;};
  set('.cs-start',seconds(range.startSec));set('.cs-end',seconds(range.endSec));set('.cs-length',seconds(range.endSec-range.startSec));
 }
 /** Repaint every control from the current channel (skips a field the user is editing). */
 paint(){
  const dialog=this.dialog;if(!dialog)return;const channel=this.channel();
  if(!channel||channel.type!=='sample'){this.close();return;}
  const model=settingsModel(channel,this.waveform),editable=this.editable(channel),active=dialog.ownerDocument.activeElement;
  const setValue=(selector,value)=>{const el=this.$(selector);if(el&&el!==active&&el.value!==String(value))el.value=String(value);return el;};
  setValue('.cs-name',model.name);setValue('.cs-color',model.color||'#5f8dc4');
  const route=setValue('.cs-route',model.outputLaneId??'');if(route&&model.outputLaneId&&route.value!==model.outputLaneId)route.value='';
  const root=setValue('.cs-root',model.rootPitch);if(root)root.title=`Root note ${rootNoteName(model.rootPitch)}`;
  const mode=this.$('.cs-mode');if(mode){let option=[...mode.options].find(item=>item.value===model.mode);if(!option){option=new Option(playbackModeLabel(model.mode)+' (engine value)',model.mode);mode.add(option);}if(mode!==active)mode.value=model.mode;}
  const release=setValue('.cs-release',model.release),out=this.$('.cs-release-out');if(out)out.textContent=seconds(model.release);
  if(release){release.disabled=!editable||!releaseApplies(model.mode);release.title=releaseApplies(model.mode)?'Release time after the note ends (0 to 2 s).':'Release applies to the Hold, Gate and Classic modes.';}
  for(const selector of ['.cs-name','.cs-color','.cs-route','.cs-root','.cs-mode'])this.$(selector).disabled=!editable;
  const number=this.$('.cs-track-number');if(number)number.textContent=this.deps.mixerNumber?.(channel)??'';
  if(!this.drag)this.paintMarkers(model.range);
  this.$('.cs-wave').classList.toggle('disabled',!model.range||!editable);this.paintTabs();if(!this.knob?.active){this.bindKnob();this.knob?.sync?.();}
  const header=dialog.querySelector('header');if(header?.firstChild&&header.firstChild.nodeType===3)header.firstChild.textContent=`Channel settings · ${model.name}`;
 }
 /** Called after any project repaint. */
 sync(){if(!this.isOpen){if(this.dialog)this.teardown();return;}const channel=this.channel();if(!channel){this.close();return;}
  this.paint();}
}
