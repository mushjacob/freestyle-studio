import {CloudExportController} from './audacity-export.js';
import {bridgeFetch} from './freestyle-host-transport.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mimeExtensions={'audio/wav':'.wav','audio/x-wav':'.wav','audio/wave':'.wav','audio/mpeg':'.mp3','audio/flac':'.flac','audio/x-flac':'.flac','audio/ogg':'.ogg','audio/opus':'.opus','audio/mp4':'.m4a','audio/aac':'.aac','audio/aiff':'.aiff','audio/x-aiff':'.aiff'};

export function exportFilename(value,{mimeType,url}={}){
 let name=String(value||'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim().slice(0,200)||'Untitled';
 let extension=mimeExtensions[String(mimeType||'').split(';')[0].toLowerCase()];
 if(!extension&&url){try{extension=new URL(url).pathname.match(/\.(wav|wave|mp3|flac|ogg|opus|m4a|aac|aiff?)$/i)?.[0];}catch{}}
 if(extension)name=name.replace(/\.(wav|wave|mp3|flac|ogg|opus|m4a|aac|aiff?)$/i,'')+extension.toLowerCase();
 return name;
}

export function exportAudioBlob(audio){
 if(!audio||!/^audio\/[a-z0-9.+-]+$/i.test(audio.mimeType||'')||typeof audio.data!=='string')throw new Error('Freestyle did not return an audio file.');
 const binary=atob(audio.data),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return new Blob([bytes],{type:audio.mimeType});
}

/** Native-style Export Audio flow. Its output is always rendered in Freestyle. */
export class AudacityExportDialog {
 constructor(workspace,{selectionDownloadAvailable=false,cloudCall,fetchFile=globalThis.fetch?.bind(globalThis),pollLimit=60}={}){
  this.workspace=workspace;this.selectionDownloadAvailable=selectionDownloadAvailable;this.fetchFile=fetchFile;this.pollLimit=pollLimit;this.dialog=null;
  this.controller=new CloudExportController({
   getProject:()=>{const p=workspace.getProject();return {...p,cloud:{...p.cloud,trackId:workspace.engine.session.trackId||p.cloud?.trackId}};},
   flush:async()=>{if(workspace.engine.interacting)throw new Error('Finish the current edit before exporting.');await workspace.engine.flush();},
   cloudCall:cloudCall||(async(name,args)=>{const response=await bridgeFetch('modesty-bridge:/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})});const data=await response.json();if(!response.ok)throw new Error(data.detail||data.error||'Cloud export request failed.');return data;}),
   onChange:state=>this.render(state),
  });
 }
 open(){
  if(this.dialog?.isConnected){this.dialog.focus();return this.dialog;}
  if(!this.workspace.engine.ready){this.workspace.connect();return null;}
  const project=this.workspace.getProject(),existing=this.controller.snapshot(),active=['starting','pending','uncertain'].includes(existing.status),selection=active&&existing.request?.scope==='selection'?{start:existing.request.startSec,end:existing.request.endSec}:{...this.workspace.selection},selected=Number.isFinite(selection.start)&&selection.end>selection.start;this.openedProjectId=active?existing.request.projectId:(project.cloud?.projectId||project.id);const sourceTitle=active?existing.request.title:project.title;
  this.selection=selection;
  const d=this.workspace.dialog('Export Audio',`<form class="au-export-form"><div class="au-export-fields"><label for="au-export-name">File Name:</label><input id="au-export-name" maxlength="200" value="${esc(sourceTitle||'Untitled')}" required><label for="au-export-folder">Folder:</label><input id="au-export-folder" value="Your browser’s download location" readonly><label for="au-export-format">Format:</label><select id="au-export-format" disabled><option>Cloud default</option></select></div><fieldset class="au-export-audio"><legend>Audio options</legend><label>Channels <select id="au-export-channels" disabled><option>Cloud mix</option></select></label><label>Sample Rate <select id="au-export-rate" disabled><option>Cloud default</option></select></label><label>Encoding <select id="au-export-encoding" disabled><option>Cloud default</option></select></label></fieldset><fieldset class="au-export-range"><legend>Export Range:</legend><label><input type="radio" name="export-range" value="project" checked> Entire Project</label><label title="Separate-file export requires a cloud export contract"><input type="radio" name="export-range" value="multiple" disabled> Multiple Files</label><label title="${selected?this.selectionDownloadAvailable?'Export the current timeline selection':'Freestyle does not yet return a downloadable selection render':'Select a non-empty timeline range first'}"><input type="radio" name="export-range" value="selection" ${selected&&this.selectionDownloadAvailable?'':'disabled'}> Current Selection</label><span class="au-export-selection">${selected?`${selection.start.toFixed(3)} – ${selection.end.toFixed(3)} s`: 'No time range selected'}${selected&&!this.selectionDownloadAvailable?' · Selection download needs engine support.':''}</span><label class="au-export-trim" title="Leading-silence trimming is not exposed by the cloud renderer"><input type="checkbox" disabled> Trim blank space before first clip</label></fieldset><p class="au-export-state" role="status"></p><progress class="au-export-progress" hidden></progress><div class="au-export-results" hidden><button type="button" class="au-export-download">Download audio</button><a class="au-export-direct" target="_blank" rel="noopener noreferrer" hidden>Direct download ↗</a><button type="button" class="au-export-refresh" hidden>Refresh download link</button></div><p class="au-export-download-error" role="status"></p><footer><button type="button" disabled title="Audio-file metadata export needs a cloud renderer contract">Edit Metadata…</button><span></span><button type="button" class="au-export-retry" hidden>Retry same export</button><button type="button" class="au-export-resume" hidden>Check export status</button><button type="button" class="au-export-close">Cancel</button><button type="submit" class="au-export-start primary">Export</button></footer></form>`);
  this.dialog=d;d.classList.add('au-export-dialog');
  d.querySelector('form').onsubmit=event=>{event.preventDefault();this.start();};
  d.querySelector('.au-export-close').onclick=()=>d.close();
  d.querySelector('.au-export-resume').onclick=()=>this.observe();
  d.querySelector('.au-export-retry').onclick=()=>this.retry();
  d.querySelector('.au-export-refresh').onclick=()=>this.run(()=>this.controller.poll({refreshReady:true}));
  d.querySelector('.au-export-download').onclick=()=>this.download();
  d.addEventListener('close',()=>{this.controller.cancelObservation();if(this.dialog===d)this.dialog=null;},{once:true});
  this.render(this.controller.snapshot());return d;
 }
 async run(fn){try{return await fn();}catch(error){const state=this.controller.snapshot();this.render(state);if(this.dialog?.isConnected&&state.status!=='uncertain')this.dialog.querySelector('.au-export-state').textContent=error.message;return null;}}
 async start(){
  const d=this.dialog;if(!d?.isConnected)return;
  const current=this.workspace.getProject();if((current.cloud?.projectId||current.id)!==this.openedProjectId){d.querySelector('.au-export-state').textContent='The project changed. Close and reopen Export Audio before starting another render.';return;}
  const scope=d.querySelector('[name=export-range]:checked')?.value;
  if(scope==='selection'&&!this.selectionDownloadAvailable){d.querySelector('.au-export-state').textContent='Selection download needs a downloadable result from Freestyle.';return;}
  if(!['project','selection'].includes(scope))return;
  const state=await this.run(()=>this.controller.begin({scope,...(scope==='selection'?{startSec:this.selection.start,endSec:this.selection.end}:{})}));
  if(state?.status==='pending'&&this.dialog?.isConnected)await this.observe();
 }
 async retry(){const state=await this.run(()=>this.controller.retry());if(state?.status==='pending'&&this.dialog?.isConnected)await this.observe();}
 observe(){return this.run(()=>this.controller.resume({maxPolls:this.pollLimit}));}
 render(state){
  const d=this.dialog;if(!d?.isConnected)return;
  const $=selector=>d.querySelector(selector),pending=state.status==='pending',starting=state.status==='starting',busy=pending||starting,ready=state.status==='ready',uncertain=state.status==='uncertain';
  $('.au-export-start').disabled=busy||state.status==='uncertain';$('.au-export-start').textContent=ready?'Export again':'Export';
  $('#au-export-name').disabled=busy||uncertain;for(const input of d.querySelectorAll('[name=export-range]'))input.disabled=busy||uncertain||input.value==='multiple'||input.value==='selection'&&(!this.selectionDownloadAvailable||!(this.selection.end>this.selection.start));
  $('.au-export-retry').hidden=!uncertain||state.request?.scope!=='project'||!state.request?.idempotencyKey;
  $('.au-export-progress').hidden=!busy;$('.au-export-resume').hidden=!pending||state.observing;$('.au-export-refresh').hidden=!ready||!state.jobId;
  $('.au-export-close').textContent=state.status==='idle'?'Cancel':'Close';$('.au-export-results').hidden=!ready;
  if(busy||uncertain)for(const input of d.querySelectorAll('[name=export-range]'))input.checked=input.value===state.request?.scope;
  const title=state.request?.title||this.workspace.getProject().title||'project';
  const messages={idle:'The audio will be rendered in Freestyle and downloaded by your browser.',starting:`Starting cloud export of ${title}…`,pending:state.observing?`Rendering ${title} in Freestyle…`:`The render of ${title} is still pending. Check its status to continue.`,ready:`${title} is ready to download.`,failed:state.error||'The cloud render failed.',cancelled:state.error||'The cloud render was cancelled.',unavailable:'Freestyle did not return a downloadable audio file.',uncertain:state.request?.scope==='project'&&state.request?.idempotencyKey?'The export receipt is uncertain. Retry the same export to recover its result without starting a second render.':'The export receipt is uncertain. Check the project’s exports before starting another render.'};
  $('.au-export-state').textContent=uncertain?messages.uncertain+(state.error?' '+state.error:''):state.error&&state.status!=='ready'?state.error:messages[state.status]||'Waiting for Freestyle…';
  const direct=$('.au-export-direct');direct.hidden=!state.downloadUrl;if(state.downloadUrl)direct.href=state.downloadUrl;else direct.removeAttribute('href');
  const payload=state.payload,render=payload?.export||payload?.render||{};
  const format=state.audio?.[0]?.mimeType||render.mimeType||render.mime_type||render.format;
  const channels=render.channels,sampleRate=render.sample_rate||render.sampleRate;
  if(format)$('#au-export-format').options[0].textContent=String(format);
  if(channels)$('#au-export-channels').options[0].textContent=Number(channels)===2?'Stereo':Number(channels)===1?'Mono':`${channels} channels`;
  if(sampleRate)$('#au-export-rate').options[0].textContent=`${sampleRate} Hz`;
  if(render.bit_depth||render.bitDepth)$('#au-export-encoding').options[0].textContent=`${render.bit_depth||render.bitDepth}-bit`;
 }
 async download(){
  const state=this.controller.snapshot(),d=this.dialog;if(state.status!=='ready'||!d?.isConnected)return;
  const errorText=d.querySelector('.au-export-download-error'),button=d.querySelector('.au-export-download');button.disabled=true;errorText.textContent='';
  try{
   let blob;if(state.audio.length)blob=exportAudioBlob(state.audio[0]);else{const response=await this.fetchFile(state.downloadUrl,{credentials:'omit'});if(!response.ok)throw new Error('The download link could not be read.');const type=(response.headers.get('Content-Type')||'').split(';')[0];if(type&&!type.startsWith('audio/')&&type!=='application/octet-stream')throw new Error('The download did not return an audio file.');blob=await response.blob();}
   const type=String(blob.type||'').split(';')[0].toLowerCase();if(mimeExtensions[type])d.querySelector('#au-export-format').options[0].textContent=mimeExtensions[type].slice(1).toUpperCase();
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=exportFilename(d.querySelector('#au-export-name').value,{mimeType:blob.type,url:state.downloadUrl});document.body.append(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(error){errorText.textContent=state.downloadUrl?'Your browser could not prepare a named download. Use the direct download link, or refresh the link and try again.':error.message;}
  finally{button.disabled=false;}
 }
}
