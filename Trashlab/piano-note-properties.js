import {flNoteName} from './fl-note-name.js';
const clone=value=>structuredClone(value);
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const number=text=>String(text).trim()===''?NaN:Number(text);
export const pianoPitchName=flNoteName;
function resolution(ppq){if(!finite(ppq)||ppq<=0)throw new Error('Reload the pattern’s timing resolution before editing note properties.');return ppq;}

/** Four-beat bars and sixteenth-note steps, matching this piano roll’s grid.
 * Start positions use 1:01:00; durations use 0:00:00. Fractional ticks are valid.
 * Callers retain untouched canonical beat values rather than re-parsing displays.
 */
export function formatPianoTime(beats,ppq,{duration=false}={}){
 resolution(ppq);if(!finite(beats)||beats<0)throw new Error('Note timing must be finite and nonnegative.');
 const bar=Math.floor(beats/4),step=Math.floor((beats-bar*4)*4),tick=(beats-bar*4-step/4)*ppq;
 return `${bar+(duration?0:1)}:${String(step+(duration?0:1)).padStart(2,'0')}:${String(tick).padStart(2,'0')}`;
}
export function parsePianoTime(text,ppq,{duration=false}={}){
 resolution(ppq);const parts=String(text).split(':');if(parts.length!==3)throw new Error('Enter time as bar:step:tick.');
 const [bar,step,tick]=parts.map(number),origin=duration?0:1;
 if(!Number.isSafeInteger(bar)||bar<origin||!Number.isInteger(step)||step<origin||step>15+origin||!finite(tick)||tick<0||tick>=ppq/4)throw new Error(`Use ${origin}-based bars, steps ${origin}–${15+origin}, and ticks from 0 to less than ${ppq/4}.`);
 const beats=(bar-origin)*4+(step-origin)/4+tick/ppq;
 if(!finite(beats)||duration&&beats<=0||!Number.isSafeInteger(Math.floor(beats)))throw new Error('The duration must be positive and the note time within the supported range.');return beats;
}

/** Local immutable dialog preview. Only commit may mutate the authoritative score.
 * Scope must include projectId/trackId/loadVersion/contextVersion/patternId/channelId.
 * commit must recheck that scope and before at its own write boundary.
 */
export class PianoNoteProperties{
 constructor({dialog,getCurrentScope,getNotes,commit,onStatus=()=>{},onPreview=()=>{}}={}){
  Object.assign(this,{createDialog:dialog,getCurrentScope,getNotes,commit,onStatus,onPreview});this.dialog=null;this.active=null;this.busy=false;this.destroyed=false;
 }
 assertCurrent(entry=this.active){
  if(!entry||this.destroyed||!same(entry.scope,this.getCurrentScope())||!same(entry.before,this.getNotes(entry.scope)))throw new Error('The project, instrument or notes changed. Reopen Note properties.');
 }
 open({noteId,selectedIds=[],ppq}={}){
  if(this.destroyed)throw new Error('Note properties is closed.');if(this.busy)throw new Error('Wait for the current note edit.');this.cancel();resolution(ppq);
  const scope=clone(this.getCurrentScope()),before=clone(this.getNotes(scope));if(!Array.isArray(before))throw new Error('Reload the instrument’s notes before editing.');
  const selection=new Set(selectedIds),noteIds=selection.has(noteId)?[...selection]:[noteId],targets=before.filter(note=>noteIds.includes(note.id)),note=before.find(note=>note.id===noteId);
  if(!note||new Set(before.map(note=>note.id)).size!==before.length||targets.length!==noteIds.length)throw new Error('The selected notes changed. Reopen Note properties.');
  for(const target of targets)if(!finite(target.start)||target.start<0||!finite(target.duration)||target.duration<=0||!Number.isInteger(target.pitch)||target.pitch<0||target.pitch>127||target.velocity!=null&&(!finite(target.velocity)||target.velocity<0||target.velocity>1))throw new Error('Reload valid note timing, pitch and velocity before editing.');
  const group=targets.length>1,velocities=targets.map(note=>note.velocity??.8),mixed=velocities.some(value=>value!==velocities[0]),initial={start:formatPianoTime(note.start,ppq),duration:formatPianoTime(note.duration,ppq,{duration:true}),velocity:mixed?'':String(velocities[0]*100)};
  const entry={scope,before,noteIds,ppq,initial,group,anchorVelocity:(note.velocity??.8)*100,failed:false};this.active=entry;
  const levels=[['PAN','Per-note pan'],['VEL','Velocity'],['REL','Release velocity'],['MOD X','Per-note modulation X'],['MOD Y','Per-note modulation Y'],['PITCH','Fine pitch']].map(([label,title])=>`<div class="piano-properties-level"><button type="button" class="piano-properties-knob ${label==='VEL'?'piano-properties-velocity-knob':'piano-properties-unavailable'}" ${label==='VEL'?'role="slider" aria-label="Velocity" aria-valuemin="0" aria-valuemax="100" title="Velocity: drag up or down, use arrow keys, or enter a percentage below."':`disabled data-unavailable title="${title} is unavailable in this editor." aria-label="${title} unavailable"`}><span></span></button><span class="piano-properties-level-name">${label}</span></div>`).join('');
  const d=this.createDialog(`Note properties · ${pianoPitchName(note.pitch)}`,`<form class="piano-properties-form"><fieldset class="piano-properties-levels"><legend>Levels</legend><div class="piano-properties-knobs">${levels}</div><label class="piano-properties-velocity-entry">${group?'Set selected velocities (%)':'Velocity (%)'}<input name="velocity" type="number" min="0" max="100" step="any" value="${esc(initial.velocity)}" placeholder="${mixed?'Mixed':''}"></label><div class="piano-properties-flags"><button type="button" disabled data-unavailable class="piano-properties-flag" title="Slide is unavailable in this editor." aria-label="Slide unavailable">○ ◢</button><button type="button" disabled data-unavailable class="piano-properties-flag" title="Portamento is unavailable in this editor." aria-label="Portamento unavailable">○ ♩</button><span class="piano-properties-color-label">Color</span><button type="button" disabled data-unavailable class="piano-properties-color" title="Note color groups are unavailable in this editor." aria-label="Note color unavailable">—</button></div></fieldset><fieldset class="piano-properties-time" ${group?'disabled':''}><legend>Time</legend><label>Start time<input name="start" type="text" spellcheck="false" value="${esc(initial.start)}" ${group?'disabled':''}></label><label>Duration<input name="duration" type="text" spellcheck="false" value="${esc(initial.duration)}" ${group?'disabled':''}></label><p class="piano-properties-units">Bar:step:tick · ${esc(ppq)} ticks per beat · 16 steps per bar</p></fieldset>${group?`<p class="piano-properties-selection">${targets.length} selected notes · Time stays independent. Enter a velocity to set the selected notes to that value.</p>`:''}<p class="piano-properties-status" role="status">Changes are applied when you accept.</p><div class="piano-properties-actions"><button type="button" class="piano-properties-reset">Reset</button><button type="submit" class="primary piano-properties-accept">Accept</button></div></form>`);
  this.dialog=d;d.classList.add('piano-note-properties');
  for(const input of d.querySelectorAll('input'))input.addEventListener('input',()=>this.preview());
  d.querySelector('form').onsubmit=event=>{event.preventDefault();return this.apply();};d.querySelector('.piano-properties-reset').onclick=()=>this.reset();
  const knob=d.querySelector('.piano-properties-velocity-knob');knob.addEventListener('pointerdown',event=>this.startVelocityDrag(event));knob.addEventListener('keydown',event=>{const delta={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1}[event.key];if(delta===undefined&&!['Home','End'].includes(event.key)||this.busy||this.active?.failed)return;event.preventDefault();const current=number(d.querySelector('[name=velocity]').value),value=event.key==='Home'?0:event.key==='End'?100:(finite(current)?current:entry.anchorVelocity)+delta;this.setVelocity(value);});
  d.addEventListener('cancel',event=>{if(this.busy)event.preventDefault();});d.addEventListener('close',()=>{if(this.dialog===d){entry.dragCleanup?.();this.dialog=null;this.active=null;this.onPreview(null);}},{once:true});
  try{this.assertCurrent(entry);}catch(error){this.cancel();throw error;}this.renderVelocity();return d;
 }
 candidate(){
  const entry=this.active;this.assertCurrent(entry);if(entry.failed)throw new Error('This edit could not be confirmed. Reload the notes before trying again.');
  const notes=clone(entry.before),fields={};for(const name of ['start','duration','velocity']){
   if(entry.group&&name!=='velocity')continue;const text=this.dialog.querySelector(`[name=${name}]`).value;if(text===entry.initial[name])continue;
   if(name==='start'||name==='duration')fields[name]=parsePianoTime(text,entry.ppq,{duration:name==='duration'});
   else{const velocity=number(text);if(!finite(velocity)||velocity<0||velocity>100)throw new Error('Choose a velocity from 0 to 100%.');fields.velocity=velocity/100;}
  }
  for(const note of notes)if(entry.noteIds.includes(note.id))Object.assign(note,fields);return notes;
 }
 preview(){
  if(!this.active||this.busy)return null;this.renderVelocity();try{const notes=this.candidate();this.onPreview({scope:clone(this.active.scope),notes:clone(notes),noteIds:[...this.active.noteIds]});this.status(same(notes,this.active.before)?'Changes are applied when you accept.':'Review the note changes, then accept.');return notes;}
  catch(error){this.onPreview(null);this.status(error.message);return null;}
 }
 async apply(){
  if(!this.active||this.busy)return false;this.active.dragCleanup?.();let notes;try{notes=this.candidate();}catch(error){this.status(error.message);return false;}
  const entry=this.active;if(same(notes,entry.before)){this.cancel();return false;}
  this.busy=true;this.lock();this.status('Applying note properties…');
  try{this.assertCurrent(entry);const result=await this.commit({scope:clone(entry.scope),before:clone(entry.before),notes:clone(notes),noteIds:[...entry.noteIds]});if(result===false)throw new Error('The note edit was not applied.');if(this.active===entry){this.busy=false;this.cancel();}return true;}
  catch(error){entry.failed=true;const message=`${error.message||'The note edit could not be confirmed.'} Reload the notes before trying again.`;this.status(message);this.onStatus(message);return false;}
  finally{this.busy=false;this.lock();}
 }
 renderVelocity(){const knob=this.dialog?.querySelector('.piano-properties-velocity-knob');if(!knob)return;const value=number(this.dialog.querySelector('[name=velocity]').value),valid=finite(value)&&value>=0&&value<=100;knob.style.setProperty('--knob-turn',`${(valid?value:this.active.anchorVelocity)*3-150}deg`);if(valid)knob.setAttribute('aria-valuenow',String(value));else knob.removeAttribute('aria-valuenow');knob.setAttribute('aria-valuetext',valid?`${value}%`:this.active.initial.velocity===''?'Mixed velocities':'Enter a velocity from 0 to 100%');}
 setVelocity(value){if(!this.active||this.busy||this.active.failed)return;this.dialog.querySelector('[name=velocity]').value=String(Math.max(0,Math.min(100,value)));this.preview();}
 startVelocityDrag(event){
  if(event.button!==0||!this.active||this.busy||this.active.failed)return;try{this.assertCurrent();}catch(error){this.status(error.message);return;}event.preventDefault();this.active.dragCleanup?.();
  const entry=this.active,d=this.dialog,doc=d.ownerDocument,win=doc.defaultView,input=d.querySelector('[name=velocity]'),before=input.value,start=finite(number(before))?number(before):entry.anchorVelocity,y=event.clientY,id=event.pointerId;
  const move=event=>{if(event.pointerId!==id)return;if(this.active!==entry)return cleanup();try{this.assertCurrent(entry);if(event.clientY===y){input.value=before;this.preview();}else this.setVelocity(start+(y-event.clientY)*.5);}catch(error){cleanup();input.value=before;this.renderVelocity();this.onPreview(null);this.status(error.message);}};
  const up=event=>{if(event.pointerId!==id)return;move(event);cleanup();},cancel=event=>{if(event.type!=='blur'&&event.pointerId!==id)return;cleanup();if(this.active===entry){input.value=before;this.preview();}};
  const cleanup=()=>{doc.removeEventListener('pointermove',move);doc.removeEventListener('pointerup',up);doc.removeEventListener('pointercancel',cancel);win?.removeEventListener('blur',cancel);if(entry.dragCleanup===cleanup)entry.dragCleanup=null;};entry.dragCleanup=cleanup;
  doc.addEventListener('pointermove',move);doc.addEventListener('pointerup',up);doc.addEventListener('pointercancel',cancel);win?.addEventListener('blur',cancel);
 }
 reset(){if(!this.active||this.busy||this.active.failed)return false;this.active.dragCleanup?.();try{this.assertCurrent();for(const [name,value]of Object.entries(this.active.initial))this.dialog.querySelector(`[name=${name}]`).value=value;this.renderVelocity();this.onPreview(null);this.status('Original note properties restored.');return true;}catch(error){this.status(error.message);return false;}}
 status(message){const node=this.dialog?.querySelector('.piano-properties-status');if(node)node.textContent=message;}
 lock(){if(!this.dialog||!this.active)return;for(const input of this.dialog.querySelectorAll('input'))input.disabled=this.busy||this.active.failed||this.active.group&&input.name!=='velocity';for(const button of this.dialog.querySelectorAll('button'))button.disabled=button.hasAttribute('data-unavailable')||this.busy||this.active.failed&&!button.matches('header button');}
 cancel(){if(this.busy)return false;const d=this.dialog;this.active?.dragCleanup?.();this.dialog=null;this.active=null;this.onPreview(null);if(d?.isConnected)d.close();return true;}
 syncScope(){if(!this.active)return true;try{this.assertCurrent();return true;}catch(error){this.onPreview(null);if(!this.busy)this.cancel();else this.status(error.message);return false;}}
 destroy(){this.destroyed=true;if(!this.busy)this.cancel();else{this.active?.dragCleanup?.();this.onPreview(null);this.dialog?.remove();this.dialog=null;this.active=null;}}
}
