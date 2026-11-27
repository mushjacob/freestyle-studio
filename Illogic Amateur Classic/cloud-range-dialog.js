import {CloudRangeEditController} from './cloud-range-edits.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=64;
const projectId=project=>project?.cloud?.projectId||project?.id;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=value=>value==null?value:structuredClone(value);
export function audioRangeLanes(project){
 const lanes=new Map(),raw=project?.cloud?.rawProject?.lanes||[];
 for(const lane of raw)if(validId(lane.id)&&['audio','vocal'].includes(lane.kind))lanes.set(lane.id,{id:lane.id,name:lane.name||'Audio lane'});
 for(const clip of project?.audioClips||[]){
  const laneId=clip.laneId||clip.cloudRaw?.laneId||clip.cloudRaw?.lane_id,known=raw.find(lane=>lane.id===laneId);
  if(!validId(laneId)||known&&!['audio','vocal'].includes(known.kind))continue;
  if(!lanes.has(laneId))lanes.set(laneId,{id:laneId,name:project.trackNames?.[clip.track]||clip.name||'Audio lane'});
 }
 return [...lanes.values()];
}
export function audioRangeDefaults(project,{selectedIds=[],clock={}}={}){
 const lanes=audioRangeLanes(project),allowed=new Set(lanes.map(lane=>lane.id)),selected=new Set(selectedIds),clips=(project.audioClips||[]).filter(clip=>selected.has(clip.id)),usable=clips.filter(clip=>finite(clip.start)&&finite(clip.length)&&clip.start>=0&&clip.length>0);
 let startBeat=0,endBeat=4;
 if(clock.loopEnabled&&finite(clock.loopStartSec)&&finite(clock.loopEndSec)&&clock.loopStartSec>=0&&clock.loopEndSec>clock.loopStartSec&&finite(project.bpm)&&project.bpm>0){startBeat=clock.loopStartSec*project.bpm/60;endBeat=clock.loopEndSec*project.bpm/60;}
 else if(usable.length){startBeat=Math.min(...usable.map(clip=>clip.start));endBeat=Math.max(...usable.map(clip=>clip.start+clip.length));}
 const selectedLanes=[...new Set(clips.map(clip=>clip.laneId||clip.cloudRaw?.laneId||clip.cloudRaw?.lane_id).filter(lane=>allowed.has(lane)))];
 return{startBar:1+startBeat/4,endBar:1+endBeat/4,laneIds:selectedLanes.length?selectedLanes:lanes.map(lane=>lane.id)};
}
export function audioRangeFromBars({startBar,endBar,bpm,laneIds,operation,ripple=false}){
 // Split is a cursor at the start bar: Freestyle requires end_ms === start_ms.
 if(operation==='split'){if(!finite(startBar)||startBar<1||!finite(bpm)||bpm<=0)throw new Error('Choose a split bar with a valid project tempo.');const startMs=Math.round((startBar-1)*4*60000/bpm);if(!Number.isSafeInteger(startMs))throw new Error('The split position must be a whole millisecond.');return{laneIds:[...laneIds],operation,startMs,endMs:startMs,ripple:false};}
 if(!finite(startBar)||startBar<1||!finite(endBar)||endBar<=startBar||!finite(bpm)||bpm<=0)throw new Error('Choose an end bar after the start bar, with a valid project tempo.');
 const startMs=Math.round((startBar-1)*4*60000/bpm),endMs=Math.round((endBar-1)*4*60000/bpm);
 if(!Number.isSafeInteger(startMs)||!Number.isSafeInteger(endMs)||endMs<=startMs)throw new Error('The audio range must span at least one whole millisecond.');
 return{laneIds:[...laneIds],operation,startMs,endMs,ripple:operation==='delete'&&ripple===true};
}
function checkpoint(project){return JSON.stringify((project?.audioClips||[]).map(clip=>({id:clip.id,cloudId:clip.cloudId,laneId:clip.laneId,start:clip.start,length:clip.length,offset:clip.offset,offsetKnown:clip.offsetKnown,volume:clip.volume,mute:clip.mute,raw:clip.cloudRaw})).sort((a,b)=>String(a.id).localeCompare(String(b.id))));}

/** Explicit audio-only range operations; generic engine history is not assumed. */
export class CloudRangeDialog{
 constructor({getProject,cloudCall,dialog,getScope=()=>null,getSelectedIds=()=>[],getClock=()=>({}),getEditRevision=()=>0,flush=async()=>{},refresh=async()=>{},guard=()=>{},onBusyChange=()=>{},onStatus=()=>{},createIdempotencyKey}={}){
  Object.assign(this,{getProject,cloudCall,createDialog:dialog,getScope,getSelectedIds,getClock,getEditRevision,flush,refresh,guard,onBusyChange,onStatus,createIdempotencyKey});this.dialog=null;this.active=null;this.records=new Map();this.reading=false;
 }
 get busy(){if(this.reading||this.active?.controller.inFlight)return true;for(const head of this.records.values())for(let entry=head;entry;entry=entry.previous)if(entry.controller.inFlight)return true;return false;}
 capture(){return{projectId:projectId(this.getProject()),trackId:this.getProject()?.cloud?.trackId??null,epoch:clone(this.getScope()),bpm:this.getProject()?.bpm};}
 current(entry){return !!entry&&same(this.capture(),entry.scope);}
 notify(){this.onBusyChange(this.busy);this.render();}
 assertReady(entry){this.guard();if(entry&&!this.current(entry))throw new Error('The cloud project, tempo or engine context changed. Reopen Audio time range.');}
 createEntry(){
  const entry={scope:this.capture(),revision:this.getEditRevision(),checkpoint:null,syncError:null,uiError:null,planned:null,controller:null};
  entry.controller=new CloudRangeEditController({getProject:this.getProject,getScope:()=>({context:this.getScope(),bpm:this.getProject()?.bpm}),cloudCall:this.cloudCall,createIdempotencyKey:this.createIdempotencyKey,flush:async()=>{this.assertReady(entry);await this.flush();this.assertReady(entry);},onChange:()=>this.notify(),onCommitted:async(payload,context)=>{
   entry.uiError=null;if(context.operation!=='inverse')this.record(entry);await this.refreshCanonical(entry);this.onStatus(payload.engine_reload_required?'The audio edit was saved. The live engine still needs to reload it.':context.operation==='inverse'?'Audio range undone in Freestyle.':'Audio range applied in Freestyle.');
  }});
  return entry;
 }
 record(entry){const previous=this.records.get(entry.scope.projectId);if(previous===entry)return;if(!entry.recorded){entry.previous=previous||null;entry.recorded=true;}this.records.set(entry.scope.projectId,entry);}
 historyEntry(){let entry=this.records.get(projectId(this.getProject()));while(entry&&!entry.controller.uncertain&&!entry.controller.state.applied)entry=entry.previous;return entry||null;}
 hasReceipt(){return this.records.has(projectId(this.getProject()));}
 blocksHistory(){return !!this.historyEntry();}
 canUndo(entry=this.historyEntry()){return !!entry&&!this.busy&&this.current(entry)&&entry.revision===this.getEditRevision()&&entry.checkpoint!==null&&entry.checkpoint===checkpoint(this.getProject())&&entry.controller.snapshot().canUndo;}
 open(){
  if(this.dialog?.isConnected){this.dialog.focus();return this.dialog;}
  if(this.busy)throw new Error('Wait for the current audio range request to finish.');this.assertReady();
  const project=this.getProject(),lanes=audioRangeLanes(project);if(!lanes.length)throw new Error('This project has no persisted audio lanes. Import audio before editing an audio time range.');
  const previous=this.historyEntry();this.active=previous?.controller.uncertain?previous:this.createEntry();const entry=this.active,defaults=audioRangeDefaults(project,{selectedIds:this.getSelectedIds(),clock:this.getClock()}),format=value=>String(Math.round(value*1e8)/1e8);
  const d=this.createDialog('Audio time range',`<form class="cloud-range-form"><p class="cloud-range-description">Edit audio clips on the selected lanes. Pattern placements are excluded.</p><div class="cloud-range-bounds"><label>Start bar<input name="start" type="number" min="1" step="any" required value="${format(defaults.startBar)}"></label><label>End bar (exclusive)<input name="end" type="number" min="1" step="any" required value="${format(defaults.endBar)}"></label></div><label>Operation<select name="operation"><option value="split">Split at start bar</option><option value="delete">Delete audio in range</option><option value="trim_to_selection">Trim audio to range</option></select></label><label class="cloud-range-ripple"><input name="ripple" type="checkbox" disabled>Close the deleted gap (ripple)</label><fieldset class="cloud-range-lanes"><legend>Audio lanes</legend>${lanes.map(lane=>`<label><input type="checkbox" name="lane" value="${esc(lane.id)}" ${defaults.laneIds.includes(lane.id)?'checked':''}>${esc(lane.name)}</label>`).join('')}</fieldset><p class="cloud-range-status" role="status">Review the audio edit before applying it.</p><div class="cloud-range-actions"><button type="button" class="cloud-range-reload">Reload audio state</button><button type="button" class="cloud-range-undo">Undo audio range</button><button type="button" class="cloud-range-preview">Preview edit</button><button type="submit" class="primary cloud-range-apply" disabled>Apply audio edit</button><button type="button" class="cloud-range-close">Close</button></div></form>`);this.dialog=d;d.classList.add('cloud-range-dialog');
  d.querySelector('form').onsubmit=event=>{event.preventDefault();return this.commit();};d.querySelector('.cloud-range-preview').onclick=()=>this.preview();d.querySelector('.cloud-range-undo').onclick=()=>this.attempt(()=>this.undoLast());d.querySelector('.cloud-range-reload').onclick=()=>this.attempt(()=>this.reload(this.active));d.querySelector('.cloud-range-close').onclick=()=>{if(!this.busy)d.close();};
  for(const input of d.querySelectorAll('input,select')){input.addEventListener('input',()=>this.resetPlan());input.addEventListener('change',()=>this.resetPlan());}
  d.addEventListener('cancel',event=>{if(this.busy)event.preventDefault();});d.addEventListener('close',()=>{if(this.dialog===d)this.dialog=null;},{once:true});this.render();return d;
 }
 options(){
  const d=this.dialog,lanes=[...d.querySelectorAll('[name=lane]:checked')].map(input=>input.value),allowed=new Set(audioRangeLanes(this.getProject()).map(lane=>lane.id));if(!lanes.length||lanes.some(lane=>!allowed.has(lane)))throw new Error('Select at least one persisted audio lane.');
  return audioRangeFromBars({startBar:Number(d.querySelector('[name=start]').value),endBar:Number(d.querySelector('[name=end]').value),bpm:this.active.scope.bpm,laneIds:lanes,operation:d.querySelector('[name=operation]').value,ripple:d.querySelector('[name=ripple]').checked});
 }
 resetPlan(){
  if(this.busy||!this.active||!this.current(this.active)||['committed','undone','uncertain'].includes(this.active.controller.state.status))return;
  const operation=this.dialog.querySelector('[name=operation]').value,ripple=this.dialog.querySelector('[name=ripple]');if(operation!=='delete')ripple.checked=false;
  this.active=this.createEntry();this.render();
 }
 async attempt(task){try{return await task();}catch(error){if(this.active)this.active.uiError=error.message;this.onStatus(error.message);this.render();return null;}}
 async preview(){return this.attempt(async()=>{
  if(this.busy)throw new Error('Wait for the current audio range request.');const entry=this.active;this.assertReady(entry);const options=this.options();entry.uiError=null;entry.planned=null;const state=await entry.controller.dryRunRange(options);if(this.active===entry&&this.current(entry))entry.planned=clone(options);this.render();return state;
 });}
 async commit(){return this.attempt(async()=>{
  if(this.busy)throw new Error('Wait for the current audio range request.');const entry=this.active;this.assertReady(entry);const options=this.options();if(entry.controller.state.status!=='planned'||!entry.planned||!same(options,entry.planned))throw new Error('Review this exact audio edit before applying it.');entry.uiError=null;
  // Keep the controller identity even when a write returns no readable receipt.
  try{return await entry.controller.commitRange();}finally{if(entry.controller.state.applied||entry.controller.uncertain)this.record(entry);this.render();}
 });}
 async refreshCanonical(entry){
  try{await this.refresh();if(!this.current(entry))throw new Error('The cloud project changed during the audio state reload.');if(entry.revision!==this.getEditRevision())throw new Error('Newer edits changed this audio checkpoint.');entry.checkpoint=checkpoint(this.getProject());entry.syncError=null;}
  catch(error){entry.syncError=error.message;throw error;}
 }
 async reload(entry=this.active){
  if(this.busy)throw new Error('Wait for the current audio range request.');this.assertReady(entry);this.reading=true;this.notify();try{await this.flush();this.assertReady(entry);await this.refreshCanonical(entry);entry.uiError=null;this.onStatus(entry.controller.uncertain?'Audio state reloaded. The previous edit remains uncertain and will not be retried.':'Audio state reloaded from Freestyle.');return this.getProject();}finally{this.reading=false;this.notify();}
 }
 async reloadLast(){const entry=this.historyEntry()||this.records.get(projectId(this.getProject()));if(!entry)throw new Error('There is no audio range receipt to reload.');return this.reload(entry);}
 async undoLast(){
  if(this.busy)throw new Error('Wait for the current audio range request.');const entry=this.historyEntry();this.assertReady(entry);if(!this.canUndo(entry))throw new Error('Reload the unchanged audio range state before undoing. Newer edits or a changed project cannot use this inverse.');entry.uiError=null;const result=await entry.controller.applyInverse();this.render();return result;
 }
 render(){
  const d=this.dialog,entry=this.active;if(!d?.isConnected||!entry)return;const state=entry.controller.snapshot(),busy=this.busy,current=this.current(entry),finished=['committed','undone','uncertain'].includes(state.status),locked=busy||finished||!current;
  for(const input of d.querySelectorAll('input,select'))input.disabled=locked;
  d.querySelector('[name=ripple]').disabled=locked||d.querySelector('[name=operation]').value!=='delete';d.querySelector('[name=end]').disabled=locked||d.querySelector('[name=operation]').value==='split';d.querySelector('.cloud-range-preview').disabled=locked;d.querySelector('.cloud-range-apply').disabled=locked||state.status!=='planned'||!entry.planned;d.querySelector('.cloud-range-undo').disabled=!this.canUndo();d.querySelector('.cloud-range-reload').disabled=busy||!current;d.querySelector('.cloud-range-close').disabled=busy;const close=d.querySelector('header button');if(close)close.disabled=busy;
  const messages={idle:'Review the audio edit before applying it.',planning:'Reading the edit preview from Freestyle…',planned:'Edit preview ready. Apply edits this audio range.',committing:'Applying the audio range in Freestyle…',undoing:'Undoing the audio range in Freestyle…',committed:state.payload?.engine_reload_required?'The audio edit was saved. The live engine still needs to reload it.':'Audio range applied in Freestyle.',undone:state.payload?.engine_reload_required?'The audio undo was saved. The live engine still needs to reload it.':'Audio range undone in Freestyle.',conflict:'Audio changed. Reload and review the edit again.',uncertain:'The audio edit result is uncertain. Reload audio state; the edit will not be retried.'};
  d.querySelector('.cloud-range-status').textContent=!current?'The project or tempo changed. Close and reopen Audio time range.':state.status==='uncertain'?messages.uncertain:state.status==='conflict'?messages.conflict:entry.syncError?`The edit is saved. Audio state reload failed: ${entry.syncError}. Use Reload audio state; Apply will not repeat the edit.`:entry.uiError||state.error||messages[state.status]||'Waiting for Freestyle…';
 }
}
