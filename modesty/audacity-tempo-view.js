import {AudacityTempoController} from './audacity-tempo.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=p=>p?.cloud?.projectId||p?.id;
const number=value=>{if(String(value??'').trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;};
const precise=n=>Number(n.toFixed(6));

export class AudacityTempoDialog {
 constructor(workspace,options={}){
  this.workspace=workspace;
  this.controller=options.controller||new AudacityTempoController({getProject:()=>workspace.getProject(),getClip:()=>workspace.selected(),getSelection:()=>workspace.selection,getSelectedTracks:()=>workspace.selectedTracks,
   flush:async()=>{if(workspace.busy||workspace.engine.interacting||workspace.clipGesture||workspace.envelopeView?.active)throw new Error('Finish the current cloud edit before changing tempo.');await workspace.envelopeView?.controller.saveQueue;await workspace.engine.flush();},
   cloudCall:(name,args)=>workspace.engine.session.call(name,args),refresh:async(receipt)=>{const full=receipt&&Math.abs(workspace.selection.start-receipt.startSec)<1e-6&&Math.abs(workspace.selection.end-receipt.endSec)<1e-6;await workspace.engine.refresh();const clip=workspace.selected();if(full&&id(workspace.getProject())===receipt.projectId&&(clip?.cloudId||clip?.id)===receipt.trackId){workspace.selection={start:workspace.seconds(clip.start),end:workspace.seconds(clip.start+clip.length)};workspace.paintSelection();}},onChange:()=>this.render()});
 }
 open(){
  if(this.dialog?.isConnected)return this.dialog;
  if(!this.workspace.engine.ready)return this.workspace.connect();
  const clip=this.workspace.selected();if(!clip||clip.patternId)throw new Error('Select one audio clip to change its tempo.');
  const start=this.workspace.seconds(clip.start),end=this.workspace.seconds(clip.start+clip.length),selection=this.workspace.selection;
  if(this.workspace.selectedTracks.size>1||selection.end>selection.start&&(Math.abs(selection.start-start)>1e-6||Math.abs(selection.end-end)>1e-6))throw new Error('This cloud renderer processes the whole audio clip. Selected-range tempo changes need an engine range-effect contract.');
  this.openedProjectId=id(this.workspace.getProject());this.openedClipId=clip.cloudId||clip.id;this.sourceLength=end-start;this.localError='';
  const applied=clip.cloudRaw?.effects?.tempo?.applied,source=number(applied?.sourceBpm),target=number(applied?.targetBpm);
  const previous=this.controller.snapshot().receipt,same=previous?.projectId===this.openedProjectId&&previous?.trackId===this.openedClipId,from=same?previous.sourceBpm:source,to=same?previous.targetBpm:target;
  this.values={sourceBpm:from??null,targetBpm:to??null,percent:from&&to?(to/from-1)*100:0};this.invalidField=null;
  const d=this.dialog=this.workspace.dialog('Change Tempo',`<form class="au-tempo-form"><p class="au-tempo-target">${esc(this.workspace.clipName(clip))} · Whole audio clip</p><div class="au-tempo-percent"><label for="au-tempo-percent">Percent Change:</label><input id="au-tempo-percent" type="number" step="any" value="0"><input id="au-tempo-slider" aria-label="Percent change" type="range" min="-80" max="200" step="any" value="0" disabled></div><fieldset><legend>Beats per minute</legend><div class="au-tempo-pair"><label for="au-tempo-from">from</label><input id="au-tempo-from" type="number" min="20" max="400" step="any" placeholder="Source BPM" required><label for="au-tempo-to">to</label><input id="au-tempo-to" type="number" min="20" max="400" step="any" placeholder="Target BPM" required></div><p class="au-tempo-hint">Enter the original source tempo. Both tempos must be between 20 and 400 BPM.</p></fieldset><fieldset><legend>Length (seconds)</legend><div class="au-tempo-pair"><label for="au-tempo-length-from">from</label><input id="au-tempo-length-from" type="number" readonly><label for="au-tempo-length-to">to</label><input id="au-tempo-length-to" type="number" min="0" step="any" disabled></div><p class="au-tempo-hint">The new length is an estimate. Freestyle reports the rendered duration when processing finishes.</p></fieldset><label class="au-tempo-quality" title="The cloud renderer does not expose Audacity’s algorithm selection"><input type="checkbox" disabled> Use high quality stretching (slow)</label><p class="au-tempo-status" role="status" aria-live="polite"></p><progress class="au-tempo-progress" hidden></progress><footer><button type="button" class="au-tempo-revert" hidden>Restore original</button><button type="button" disabled title="A separate cloud preview render is not available">Preview</button><span></span><button type="button" class="au-tempo-resume" hidden>Check status</button><button type="button" class="au-tempo-close">Cancel</button><button type="submit" class="au-tempo-apply primary">Apply</button></footer></form>`);
  d.classList.add('au-tempo-dialog');d.querySelector('form').onsubmit=e=>{e.preventDefault();this.apply();};
  const bindings={'au-tempo-from':'source','au-tempo-to':'target','au-tempo-percent':'percent','au-tempo-slider':'percent','au-tempo-length-to':'length'};
  for(const [field,kind] of Object.entries(bindings))d.querySelector('#'+field).oninput=()=>this.link(kind,d.querySelector('#'+field).value);
  d.querySelector('.au-tempo-close').onclick=()=>d.close();d.querySelector('.au-tempo-resume').onclick=()=>this.observe();d.querySelector('.au-tempo-revert').onclick=()=>this.revert();
  d.addEventListener('close',()=>{this.controller.stopObservation();if(this.dialog===d)this.dialog=null;});
  this.updateFields();this.render();return d;
 }
 link(kind,value){
  const n=number(value),v=this.values;if(n===null){this.invalidField=kind;if(kind==='source')v.sourceBpm=null;else if(kind==='target')v.targetBpm=null;else if(kind==='percent'){v.percent=null;v.targetBpm=null;}this.updateFields(kind);this.render();return;}this.invalidField=null;
  if(kind==='source'){v.sourceBpm=n;v.targetBpm=n*(1+(v.percent??0)/100);v.percent=v.percent??0;}
  else if(kind==='target'){v.targetBpm=n;if(v.sourceBpm)v.percent=(n/v.sourceBpm-1)*100;}
  else if(kind==='percent'){v.percent=n;v.targetBpm=v.sourceBpm?v.sourceBpm*(1+n/100):null;}
  else if(kind==='length'&&n>0&&v.sourceBpm){v.targetBpm=v.sourceBpm*this.sourceLength/n;v.percent=(v.targetBpm/v.sourceBpm-1)*100;}
  this.localError='';this.updateFields(kind);this.render();
 }
 updateFields(active){
  const d=this.dialog;if(!d)return;const v=this.values;
  const set=(selector,value,kind)=>{if(kind!==active)d.querySelector(selector).value=value===null?'':precise(value);};
  set('#au-tempo-from',v.sourceBpm,'source');set('#au-tempo-to',v.targetBpm,'target');set('#au-tempo-percent',v.percent,'percent');
  d.querySelector('#au-tempo-length-from').value=precise(this.sourceLength);
  const length=v.sourceBpm&&v.targetBpm>0?this.sourceLength*v.sourceBpm/v.targetBpm:null;set('#au-tempo-length-to',length,'length');
  const slider=d.querySelector('#au-tempo-slider');if(v.sourceBpm>0){slider.min=(20/v.sourceBpm-1)*100;slider.max=(400/v.sourceBpm-1)*100;}slider.value=v.percent;
 }
 async apply(){
  if(id(this.workspace.getProject())!==this.openedProjectId||(this.workspace.selected()?.cloudId||this.workspace.selected()?.id)!==this.openedClipId)return this.showError('The selected cloud clip changed. Close and reopen this dialog.');
  try{this.localError='';await this.controller.apply({sourceBpm:this.values.sourceBpm,targetBpm:this.values.targetBpm});if(this.dialog?.isConnected&&this.controller.snapshot().canResume)await this.observe();}catch(error){this.showError(error.message);}
 }
 async observe(){try{await this.controller.resume();this.render();}catch(error){this.showError(error.message);}}
 async revert(){try{this.localError='';await this.controller.revert();if(this.dialog?.isConnected&&this.controller.snapshot().canResume)await this.observe();this.render();}catch(error){this.showError(error.message);}}
 showError(message){this.localError=message;this.render();}
 render(){
  const d=this.dialog;if(!d?.isConnected)return;const s=this.controller.snapshot({projectId:this.openedProjectId,clipId:this.openedClipId});
  const busy=['starting','submitting','applying','reverting','refreshing'].includes(s.phase)||s.observing,unresolved=busy||!!s.canResume||['uncertain','unknown'].includes(s.phase),valid=!this.invalidField&&this.values.sourceBpm>=20&&this.values.sourceBpm<=400&&this.values.targetBpm>=20&&this.values.targetBpm<=400;
  d.querySelector('.au-tempo-status').textContent=this.localError||s.error||(s.canResume?'The cloud render is still processing. Closing this dialog stops checking; it does not cancel the render.':s.phase==='reverted'?'Original audio restored.':s.result?`Cloud tempo operation completed.${Number.isFinite(s.result.track?.durationSec)?' Rendered length: '+s.result.track.durationSec.toFixed(3)+' s.':''}`:busy?'Processing in Freestyle…':'');
  d.querySelectorAll('input:not([readonly])').forEach(input=>{if(input.type!=='checkbox')input.disabled=unresolved;});
  d.querySelector('#au-tempo-slider').disabled=unresolved||!this.values.sourceBpm;d.querySelector('#au-tempo-length-to').disabled=unresolved||!this.values.sourceBpm;
  d.querySelector('.au-tempo-apply').disabled=unresolved||!valid;d.querySelector('.au-tempo-resume').hidden=!s.canResume;d.querySelector('.au-tempo-resume').disabled=busy;d.querySelector('.au-tempo-revert').hidden=!s.canRevert;d.querySelector('.au-tempo-revert').disabled=unresolved;
  d.querySelector('.au-tempo-progress').hidden=!busy;d.querySelector('.au-tempo-close').textContent=s.receipt?'Close':'Cancel';
 }
}
