import {CloudRegionEffects,regionEffectPreviewUrl,regionEffectRenderPending} from './cloud-region-effects.js';
const clone=value=>value==null?value:structuredClone(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const projectId=project=>project?.cloud?.projectId||project?.id;
const label=value=>String(value).replaceAll('_',' ');
export const ALREADY_RENDERING='Already rendering… Freestyle is still working on this Apply; it was not sent again.';

/** Audio clip menu entry point. All processing and preview rendering is remote. */
export class CloudRegionEffectsDialog{
 constructor({getProject,cloudCall,dialog,getScope=()=>null,getEditRevision=()=>0,flush=async()=>{},refresh=async()=>{},guard=()=>{},prepareMedia=async url=>url,onBusyChange=()=>{},onStatus=()=>{},audioFactory=()=>new Audio(),setTimeout=globalThis.setTimeout,clearTimeout=globalThis.clearTimeout,history=null,sourceView=null,log=()=>{}}={}){
  this.sourceView=sourceView;this.log=log;
  // history: the app's single ordered Undo/Redo journal; each apply becomes one of its steps.
  Object.assign(this,{getProject,cloudCall,createDialog:dialog,getScope,getEditRevision,flush,refresh,guard,prepareMedia,onBusyChange,onStatus,audioFactory,setTimeout,clearTimeout,history});this.records=[];this.active=null;this.dialog=null;this.audio=null;this.previewGeneration=0;this.pollTimer=null;this.pollCount=0;this.destroyed=false;
 }
 get busy(){return this.records.some(entry=>entry.projectId===projectId(this.getProject())&&entry.controller.busy);}
 createEntry(clipId){
  const entry={clipId,projectId:projectId(this.getProject()),error:null,controller:null};
  entry.controller=new CloudRegionEffects({getProject:this.getProject,cloudCall:this.cloudCall,getScope:this.getScope,getEditRevision:this.getEditRevision,flush:this.flush,refresh:this.refresh,guard:this.guard,history:typeof this.history==='function'?this.history():this.history,sourceView:this.sourceView,log:this.log,onChange:()=>{this.onBusyChange(this.busy);this.render();}});this.records.push(entry);return entry;
 }
 // A journaled apply is undone through the global history; only an unjournaled
 // receipt, an uncertain result or a running job is still owned here.
 historyEntry(){return[...this.records].reverse().find(entry=>entry.projectId===projectId(this.getProject())&&(entry.controller.uncertain||entry.controller.state.jobId||entry.controller.state.applied&&!entry.controller.journaled));}
 blocksHistory(){return !!this.historyEntry();}
 canUndo(){return this.historyEntry()?.controller.snapshot().canUndo===true;}
 async undoLast(){const entry=this.historyEntry();if(!entry)throw new Error('There is no region effect to undo.');const result=await entry.controller.undo();this.onStatus(result.undoReceipt?.engine_reload_required?'Region effect undone; live engine reload pending.':'Region effect undone in Freestyle.');this.render();return result;}
 open({clipId,startMs,endMs}={}){
  this.guard();if(this.destroyed)throw new Error('The region-effect view is closed.');if(this.dialog?.isConnected){this.dialog.focus();return this.dialog;}
  const unresolved=this.historyEntry();
  if(unresolved&&(unresolved.controller.uncertain||unresolved.controller.state.jobId))this.active=unresolved;
  else{
   const clips=(this.getProject()?.audioClips||[]).filter(clip=>clip.cloudId===clipId||clip.id===clipId),clip=clips[0];if(clips.length!==1||!clip.cloudId||clip.cloudRaw?.id!==clip.cloudId)throw new Error('Choose one persisted audio clip for region effects.');
   this.active=this.createEntry(clip.cloudId);this.active.defaults={startMs:startMs??clip.cloudRaw.startMs,endMs:endMs??clip.cloudRaw.startMs+clip.cloudRaw.durationSec*1000};
  }
  this.pollCount=0;const entry=this.active,defaults=entry.defaults||{startMs:entry.controller.state.request?.start_ms??0,endMs:entry.controller.state.request?.end_ms??0};
  const d=this.createDialog('Audio region effects',`<form class="region-effect-form"><p>Render an effect into part of this audio clip. Audio outside the region stays unchanged.</p><div class="region-effect-bounds"><label>Start (timeline seconds)<input name="start" type="number" min="0" step="any" required value="${esc(defaults.startMs/1000)}"></label><label>End (exclusive, seconds)<input name="end" type="number" min="0" step="any" required value="${esc(defaults.endMs/1000)}"></label></div><label>Effect<select name="effect" disabled><option>Loading effects…</option></select></label><p class="region-effect-description"></p><fieldset class="region-effect-params"><legend>Parameters</legend></fieldset><div class="region-effect-bounds"><label>Edge crossfade (ms)<input name="crossfade" type="number" min="0" max="100" step="any" value="0"></label><label>Preview context (ms)<input name="context" type="number" min="0" max="2000" step="any" value="0"></label></div><label><input name="clipping" type="checkbox">Allow output that clips</label><p class="region-effect-status" role="status">Reading Freestyle effects…</p><div class="region-effect-player"></div><div class="region-effect-actions"><button type="button" class="region-effect-preview">Preview</button><button type="submit" class="primary region-effect-apply">Apply effect</button><button type="button" class="region-effect-check" hidden>Check progress</button><button type="button" class="region-effect-undo">Undo effect</button><button type="button" class="region-effect-reload">Reload audio</button><button type="button" class="region-effect-close">Close</button></div></form>`);
  this.dialog=d;d.classList.add('cloud-region-effects-dialog');
  d.querySelector('form').onsubmit=event=>{event.preventDefault();return this.attempt(()=>this.apply());};d.querySelector('.region-effect-preview').onclick=()=>this.attempt(()=>this.preview());d.querySelector('.region-effect-check').onclick=()=>this.attempt(()=>this.poll());d.querySelector('.region-effect-undo').onclick=()=>this.attempt(()=>this.undoLast());d.querySelector('.region-effect-reload').onclick=()=>this.attempt(()=>entry.controller.inspect());d.querySelector('.region-effect-close').onclick=()=>{if(!entry.controller.inFlight)d.close();};
  d.querySelector('[name=effect]').onchange=()=>{this.stopPreview();this.renderParams();};for(const input of d.querySelectorAll('input'))input.addEventListener('input',()=>this.stopPreview());
  d.addEventListener('cancel',event=>{if(entry.controller.inFlight)event.preventDefault();});d.addEventListener('close',()=>{this.stopPreview();this.clearPoll();if(this.dialog===d)this.dialog=null;},{once:true});
  entry.controller.loadCatalog().then(catalog=>{if(this.dialog!==d||this.active!==entry)return;const select=d.querySelector('[name=effect]');select.innerHTML=catalog.effects.map(effect=>`<option value="${esc(effect.id)}">${esc(effect.label)}</option>`).join('');select.value=entry.controller.state.request?.effect||catalog.effects[0].id;this.renderParams();this.render();this.schedulePoll();}).catch(error=>{entry.error=error.message;this.render();});this.render();return d;
 }
 renderParams(){
  const d=this.dialog,entry=this.active;if(!d?.isConnected||!entry?.controller.catalog)return;const effect=entry.controller.catalog.effects.find(effect=>effect.id===d.querySelector('[name=effect]').value);if(!effect)return;
  d.querySelector('.region-effect-description').textContent=effect.description||'';const fields=d.querySelector('.region-effect-params');fields.innerHTML='<legend>Parameters</legend>';
  for(const [name,schema]of Object.entries(effect.params)){
   const wrapper=d.ownerDocument.createElement('label');wrapper.append(`${label(name)}${schema.unit?` (${schema.unit})`:''}`);let input;
   if(schema.enum){input=d.ownerDocument.createElement('select');for(const value of schema.enum){const option=d.ownerDocument.createElement('option');option.value=String(value);option.textContent=label(value);input.append(option);}input.value=String(schema.default??schema.enum[0]);}
   else{input=d.ownerDocument.createElement('input');input.type=schema.type==='boolean'?'checkbox':schema.type==='string'?'text':'number';if(schema.type==='boolean')input.checked=schema.default===true;else{input.value=String(schema.default??'');if(schema.minimum!=null)input.min=String(schema.minimum);if(schema.maximum!=null)input.max=String(schema.maximum);input.step=schema.type==='integer'?'1':'any';if(typeof schema.default==='number'&&(schema.default<schema.minimum||schema.default>schema.maximum)){input.value='';input.placeholder='Whole selection';}}}
   input.dataset.param=name;input.dataset.type=schema.type;input.oninput=()=>{input.dataset.dirty='true';this.stopPreview();};input.onchange=()=>{input.dataset.dirty='true';this.stopPreview();};wrapper.append(input);fields.append(wrapper);
  }
  fields.hidden=!Object.keys(effect.params).length;
 }
 options(){
  const d=this.dialog,params={};for(const input of d.querySelectorAll('[data-param][data-dirty=true]'))params[input.dataset.param]=input.dataset.type==='boolean'?input.checked:['number','integer'].includes(input.dataset.type)?Number(input.value):input.value;
  return{effect:d.querySelector('[name=effect]').value,startMs:Number(d.querySelector('[name=start]').value)*1000,endMs:Number(d.querySelector('[name=end]').value)*1000,crossfadeMs:Number(d.querySelector('[name=crossfade]').value),contextMs:Number(d.querySelector('[name=context]').value),allowClipping:d.querySelector('[name=clipping]').checked,params};
 }
 async attempt(run){try{return await run();}catch(error){if(this.active)this.active.error=error.message;this.onStatus(error.message);this.render();return false;}}
 async preview(){
  const entry=this.active,d=this.dialog,generation=++this.previewGeneration,scope=entry.controller.capture();entry.error=null;this.audio?.pause();const payload=await entry.controller.preview(entry.clipId,this.options());if(this.destroyed||this.active!==entry||this.dialog!==d||!d?.isConnected||generation!==this.previewGeneration)return false;entry.controller.assertCurrent(scope);
  const url=await this.prepareMedia(regionEffectPreviewUrl(payload));if(this.active!==entry||this.dialog!==d||generation!==this.previewGeneration)return false;
  entry.controller.assertCurrent(scope);if(typeof url!=='string'||!url)throw new Error('The region preview bridge returned no playback URL.');let parsed;try{parsed=new URL(url,globalThis.location?.origin||'http://localhost');}catch{throw new Error('The region preview bridge returned an invalid playback URL.');}if(!['http:','https:'].includes(parsed.protocol)||url.startsWith('//')||parsed.username||parsed.password)throw new Error('The region preview bridge returned an unsafe playback URL.');const audio=this.audioFactory();this.audio=audio;audio.preload='none';audio.controls=true;audio.src=url;audio.onerror=()=>{entry.error='The region preview could not be streamed. Render another preview or check media authorization.';this.render();};if(audio.nodeType)d.querySelector('.region-effect-player').replaceChildren(audio);
  await audio.play();if(generation!==this.previewGeneration){audio.pause();return false;}this.render();return clone(payload);
 }
 async apply(){const entry=this.active;
  // QA19: a second Apply while this render runs sends nothing, and says so.
  if(entry.controller.busy&&['applying','pending'].includes(entry.controller.state.status)){entry.notice=ALREADY_RENDERING;this.onStatus(ALREADY_RENDERING);this.render();return entry.controller.snapshot();}
  entry.error=null;this.stopPreview();const state=await entry.controller.apply(entry.clipId,this.options());this.render();this.schedulePoll();if(state.status==='applied')this.onStatus(state.receipt?.engine_reload_required?'Region effect saved; live engine reload pending.':'Region effect applied in Freestyle.');return state;}
 clearPoll(){if(this.pollTimer!=null)this.clearTimeout(this.pollTimer);this.pollTimer=null;}
 schedulePoll(){this.clearPoll();const entry=this.active;if(!this.dialog?.isConnected||!entry?.controller.state.jobId||entry.controller.uncertain||this.pollCount>=20)return;this.pollTimer=this.setTimeout(()=>{this.pollTimer=null;this.pollCount++;this.attempt(()=>this.poll());},1000);}
 async poll(){const state=await this.active.controller.poll();this.render();if(state.status==='pending')this.schedulePoll();else this.onStatus(state.receipt?.engine_reload_required?'Region effect saved; live engine reload pending.':'Region effect applied in Freestyle.');return state;}
 stopPreview(){this.previewGeneration++;this.audio?.pause();this.audio=null;this.dialog?.querySelector('.region-effect-player')?.replaceChildren();}
 render(){
  const d=this.dialog,entry=this.active;if(!d?.isConnected||!entry)return;const state=entry.controller.snapshot(),pending=state.status==='pending',finished=state.applied||['undone','conflict'].includes(state.status)||state.uncertain,readBusy=entry.controller.inFlight,locked=state.busy||finished;
  for(const input of d.querySelectorAll('input,select'))input.disabled=locked||!entry.controller.catalog;
  d.querySelector('.region-effect-preview').disabled=locked||!entry.controller.catalog;const otherRender=regionEffectRenderPending(entry.controller),applyButton=d.querySelector('.region-effect-apply');
  // While this entry renders, Apply stays clickable (aria-disabled) so a second click explains itself.
  const ownRender=state.busy&&!finished&&['applying','pending'].includes(state.status);if(!ownRender)entry.notice=null;
  applyButton.disabled=ownRender?false:locked||!entry.controller.catalog||otherRender;applyButton.setAttribute('aria-disabled',String(ownRender));applyButton.title=ownRender?ALREADY_RENDERING:otherRender?'Another region effect is still rendering in Freestyle (one render at a time).':'';
  d.querySelector('.region-effect-check').hidden=!state.jobId;d.querySelector('.region-effect-check').disabled=readBusy||state.uncertain;const undoButton=d.querySelector('.region-effect-undo');undoButton.disabled=state.journaled||!this.canUndo();undoButton.title=state.journaled?'Use Edit → Undo (⌘Z): this effect is a step of the project history.':'';d.querySelector('.region-effect-reload').disabled=state.busy||!state.scope;d.querySelector('.region-effect-close').disabled=readBusy;const headerClose=d.querySelector('header button');if(headerClose)headerClose.disabled=readBusy;
  const messages={idle:'Choose a region of up to 120 seconds. Preview and apply use Freestyle’s rendering quota.',previewing:'Rendering preview in Freestyle…',previewed:state.preview?.measured?.would_clip?'Preview ready. This effect would clip; reduce its level before applying.':'Preview ready. Applying replaces only the selected region.',applying:'Applying effect in Freestyle…',pending:'Freestyle is rendering this region. Check progress to read the existing job.',applied:`${state.mode==='in_place'?state.receipt?.engine_swapped===true?'Effect rendered into this clip; the engine now plays the new audio.':'Effect rendered into this clip.':'Effect applied.'}${state.receipt?.engine_reload_required&&state.receipt?.engine_swapped!==true?' The live engine still needs to reload the processed audio.':''} ${state.journaled?'Edit → Undo (⌘Z) restores the original audio.':'Undo restores the original audio region.'}`,undoing:'Undoing the effect in Freestyle…',undone:state.undoReceipt?.engine_reload_required?'Effect undone. Live engine reload pending.':'Effect undone in Freestyle.',conflict:'The clip changed. Close this panel and reopen its current audio before applying again.',uncertain:'The apply result is uncertain. Reload audio; this mutation will not be repeated.'};
  d.querySelector('.region-effect-status').textContent=entry.notice||entry.error||state.error||state.refreshError&&`Effect receipt retained. Audio reload failed: ${state.refreshError}. Use Reload audio.`||(otherRender&&['idle','previewed','failed','undone'].includes(state.status)?'Another region effect is still rendering in Freestyle. Apply unlocks when it finishes.':null)||messages[state.status]||'Waiting for Freestyle…';if(pending)d.querySelector('.region-effect-status').dataset.jobId=state.jobId;
 }
 destroy(){this.destroyed=true;this.clearPoll();this.stopPreview();this.dialog?.close();this.dialog=null;for(const entry of this.records)entry.controller.destroy();}
}
