import {openHostProject} from './freestyle-host-transport.js';
import {ProjectSaveController} from './audacity-project-save.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const projectId=p=>p?.cloud?.projectId||p?.id;

export class AudacityProjectSaveDialog {
 constructor(workspace,options={}){
  this.workspace=workspace;
  this.controller=options.controller||new ProjectSaveController({
   getProject:()=>workspace.getProject(),
   flush:async()=>{await workspace.envelopeView?.controller.saveQueue;await workspace.engine.flush();},
   isInteracting:()=>!!(workspace.engine.interacting||workspace.clipGesture||workspace.envelopeView?.active),
   isBusy:()=>!!workspace.busy,
   cloudCall:(name,args)=>workspace.engine.session.call(name,args),
   // Inside Freestyle the open project belongs to the host Studio: open the copy through the app (the view follows its "project" event).
   openProject:id=>openHostProject(id),
   onChange:()=>this.render()
  });
 }
 async save(){
  if(!this.workspace.engine.ready)return this.workspace.connect();
  const result=await this.controller.save();
  this.workspace.engine.onStatus('Project snapshot saved in Freestyle');
  return result;
 }
 open(mode='duplicate'){
  if(!this.workspace.engine.ready)return this.workspace.connect();
  if(this.dialog?.isConnected)return this.dialog;
  this.mode=mode;this.draft=false;this.localError='';
  const p=this.workspace.getProject();this.openedProjectId=projectId(p);
  const title=mode==='duplicate'?'Save Project As':'Save Project';
  const d=this.dialog=this.workspace.dialog(title,`<form class="au-project-save-form"><p class="au-project-save-intro">${mode==='duplicate'?'Save a complete copy of this project.':'Save a named snapshot of this project.'}</p><div class="au-project-save-fields"><label for="au-save-name">${mode==='duplicate'?'Save As:':'Name:'}</label><input id="au-save-name" required maxlength="255" value="${esc((p.title||p.name||'Untitled')+(mode==='duplicate'?' copy':''))}"><label for="au-save-where">Where:</label><select id="au-save-where" disabled><option>Freestyle cloud library</option></select><label for="au-save-type">Project type:</label><select id="au-save-type" disabled><option>${mode==='duplicate'?'Freestyle project':'Freestyle project snapshot'}</option></select></div><p class="au-project-save-state" role="status" aria-live="polite"></p><div class="au-project-save-receipt" hidden></div><footer class="au-project-save-footer"><button type="button" class="au-save-another" hidden>Save another copy</button><button type="button" class="au-save-open primary" hidden>Open saved copy</button><button type="button" class="au-save-close">Cancel</button><button type="submit" class="au-save-submit primary">Save</button></footer></form>`);
  d.classList.add('au-project-save-dialog');
  d.querySelector('form').onsubmit=e=>{e.preventDefault();this.submit();};
  d.querySelector('.au-save-close').onclick=()=>d.close();
  d.querySelector('.au-save-open').onclick=()=>this.openCopy();
  d.querySelector('.au-save-another').onclick=()=>{this.draft=true;this.render();d.querySelector('#au-save-name').focus();d.querySelector('#au-save-name').select();};
  d.addEventListener('close',()=>{if(this.dialog===d)this.dialog=null;});
  this.render();d.querySelector('#au-save-name').select();return d;
 }
 async submit(){
  const d=this.dialog;if(!d)return;
  const field=d.querySelector('#au-save-name'),name=field.value.trim();
  if(!name){field.setCustomValidity('Enter a project name.');field.reportValidity();return;}field.setCustomValidity('');
  if(projectId(this.workspace.getProject())!==this.openedProjectId){this.showError('The project changed. Close this dialog and reopen it for the current project.');return;}
  this.draft=false;this.localError='';
  try{if(this.mode==='duplicate')await this.controller.duplicate({title:name});else await this.controller.save({name});}
  catch(error){this.localError=error.message;}
  this.render();
 }
 async openCopy(){
  try{await this.controller.openCopy();this.dialog?.close();}
  catch(error){this.showError(error.message);}
 }
 showError(message){this.localError=message;this.render();}
 render(){
  const d=this.dialog;if(!d?.isConnected)return;
  const s=this.controller.snapshot(),busy=['saving','duplicating','opening'].includes(s.status),uncertain=s.status==='uncertain';
  const completed=!this.draft&&((this.mode==='duplicate'&&s.copyProjectId&&s.operation==='duplicate')||(this.mode==='snapshot'&&s.status==='saved'&&s.operation==='save'));
  const state=d.querySelector('.au-project-save-state');
  state.textContent=this.localError||s.error||(busy?(s.status==='opening'?'Opening saved copy…':'Saving to Freestyle…'):completed?(this.mode==='duplicate'?'Project copy saved in Freestyle.':'Project snapshot saved in Freestyle.'):'');
  if(uncertain)state.textContent+=' Check your Freestyle library before saving again; the request may have completed.';
  state.classList.toggle('au-save-error',!!(this.localError||s.error||uncertain));
  d.querySelector('#au-save-name').disabled=busy||uncertain||!!completed;
  const submit=d.querySelector('.au-save-submit');submit.disabled=busy||uncertain||!!completed;submit.hidden=!!completed;
  const open=d.querySelector('.au-save-open');open.hidden=!(completed&&this.mode==='duplicate');open.disabled=busy;
  const another=d.querySelector('.au-save-another');another.hidden=!completed;another.disabled=busy;another.textContent=this.mode==='duplicate'?'Save another copy':'Save another snapshot';
  if(completed)d.querySelector('#au-save-name').value=s.request?.title??s.request?.name??s.copyTitle??s.source?.title??'Untitled';
  d.querySelector('.au-save-close').textContent=busy||completed||uncertain?'Close':'Cancel';
  const receipt=d.querySelector('.au-project-save-receipt');receipt.hidden=!completed;
  receipt.textContent=completed?`Saved as: ${s.copyTitle||s.request?.title||s.request?.name||s.source?.title||'Cloud snapshot'}`:'';
 }
}
