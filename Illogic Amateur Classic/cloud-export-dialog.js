import {CloudExportController} from './cloud-export.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const extensions={'audio/wav':'.wav','audio/x-wav':'.wav','audio/wave':'.wav','audio/mpeg':'.mp3','audio/flac':'.flac','audio/x-flac':'.flac','audio/ogg':'.ogg','audio/opus':'.opus','audio/mp4':'.m4a','audio/aac':'.aac','audio/aiff':'.aiff','audio/x-aiff':'.aiff'};
export function exportFilename(value,{mimeType,url}={}){
 let name=String(value||'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim().slice(0,200)||'Untitled';
 let extension=extensions[String(mimeType||'').split(';')[0].toLowerCase()];
 if(!extension&&url){try{extension=new URL(url).pathname.match(/\.(wav|wave|mp3|flac|ogg|opus|m4a|aac|aiff?)$/i)?.[0];}catch{}}
 return extension?name.replace(/\.(wav|wave|mp3|flac|ogg|opus|m4a|aac|aiff?)$/i,'')+extension.toLowerCase():name;
}
export function exportAudioBlob(audio){
 if(!audio||!/^audio\/[a-z0-9.+-]+$/i.test(audio.mimeType||'')||typeof audio.data!=='string')throw new Error('Freestyle did not return an audio file.');
 const binary=atob(audio.data),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return new Blob([bytes],{type:audio.mimeType});
}

/** FL-style export controls; every rendered byte comes from the cloud DAW. */
export class CloudExportDialog {
 constructor({getProject,engine,dialog,connect,cloudCall,fetchFile=(...args)=>fetch(...args),pollLimit=60}={}){
  Object.assign(this,{getProject,engine,createDialog:dialog,connect,fetchFile,pollLimit});this.controllers=new Map();this.dialog=null;this.controller=null;
  this.cloudCall=cloudCall||((name,args)=>engine.session.call(name,args));
 }
 scope(){const project=this.getProject();return{projectId:project.cloud?.projectId||project.id,trackId:this.engine.session.trackId,version:this.engine.loadVersion};}
 assertScope(scope=this.openedScope){const current=this.scope();if(!this.engine.ready||this.engine.loading||Object.keys(current).some(key=>current[key]!==scope[key]))throw new Error('The project changed. Close and reopen Export before starting a render.');}
 controllerFor(projectId){
  if(!this.controllers.has(projectId)){
   const controller=new CloudExportController({getProject:()=>{const project=this.getProject();return{...project,cloud:{...project.cloud,trackId:this.engine.session.trackId}};},cloudCall:(name,args)=>this.cloudCall(name,args),flush:async()=>{const scope=this.openedScope;this.assertScope(scope);if(this.engine.interacting)throw new Error('Finish the current drag before exporting.');await this.engine.flush();this.assertScope(scope);},onChange:state=>{if(this.controller===controller)this.render(state);}});
   this.controllers.set(projectId,controller);
  }
  return this.controllers.get(projectId);
 }
 open(){
  if(this.dialog?.isConnected){this.dialog.focus();return this.dialog;}
  if(!this.engine.ready){this.connect?.();return null;}
  this.openedScope=this.scope();this.controller=this.controllerFor(this.openedScope.projectId);
  const controller=this.controller,state=controller.snapshot(),title=state.request?.title||this.getProject().title||'Untitled';
  const d=this.createDialog('Export · cloud mix',`<form class="cloud-export-form"><label>File name<input class="cloud-export-name" maxlength="200" value="${esc(title)}" required></label><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px"><label>Format<input class="cloud-export-format" value="Cloud default" readonly></label><label>Sample rate<input class="cloud-export-rate" value="Cloud default" readonly></label><label>Channels<input class="cloud-export-channels" value="Cloud mix" readonly></label></div><p>Entire project · Freestyle render settings<br>Saved to your browser’s download location.</p><p class="cloud-export-state" role="status"></p><progress class="cloud-export-progress" style="width:100%;accent-color:#d8ad70" hidden></progress><p class="cloud-export-progress-label" hidden></p><div class="cloud-export-results" hidden><button type="button" class="primary cloud-export-download">Download audio</button><a class="cloud-export-direct" target="_blank" rel="noopener noreferrer" hidden>Direct download ↗</a><button type="button" class="cloud-export-refresh" hidden>Refresh download link</button></div><p class="cloud-export-download-error" role="status"></p><div style="display:flex;justify-content:flex-end;gap:5px"><button type="button" class="cloud-export-resume" hidden>Check export status</button><button type="button" class="cloud-export-close">Close</button><button type="submit" class="cloud-export-start primary">Render cloud mix</button></div></form>`);
  this.dialog=d;d.classList.add('cloud-export-dialog');
  d.querySelector('form').onsubmit=event=>{event.preventDefault();return this.start();};
  d.querySelector('.cloud-export-close').onclick=()=>d.close();
  d.querySelector('.cloud-export-resume').onclick=()=>this.observe();
  d.querySelector('.cloud-export-refresh').onclick=()=>this.run(()=>controller.poll({refreshReady:true}));
  d.querySelector('.cloud-export-download').onclick=()=>this.download();
  d.addEventListener('close',()=>{controller.cancelObservation();if(this.dialog===d)this.dialog=null;},{once:true});
  this.render(state);return d;
 }
 async run(task){const controller=this.controller,d=this.dialog;try{return await task();}catch(error){if(this.controller===controller&&this.dialog===d){this.render(controller.snapshot());if(d?.isConnected)d.querySelector('.cloud-export-state').textContent=controller.snapshot().status==='uncertain'?`The export receipt is uncertain. ${error.message} Check this project’s exports before starting another render.`:error.message;}return null;}}
 async start(){
  if(!this.dialog?.isConnected)return;
  try{this.assertScope();}catch(error){this.dialog.querySelector('.cloud-export-state').textContent=error.message;return null;}
  const controller=this.controller,d=this.dialog,state=await this.run(()=>controller.begin({scope:'project'}));
  if(state?.status==='pending'&&this.dialog===d&&this.controller===controller&&d.isConnected)return this.observe();
  return state;
 }
 observe(){const controller=this.controller;return this.run(()=>controller.resume({maxPolls:this.pollLimit}));}
 render(state){
  const d=this.dialog;if(!d?.isConnected)return;const $=selector=>d.querySelector(selector),pending=state.status==='pending',busy=pending||state.status==='starting',ready=state.status==='ready';
  $('.cloud-export-start').disabled=busy||state.status==='uncertain';$('.cloud-export-start').textContent=ready?'Render again':'Render cloud mix';$('.cloud-export-name').disabled=busy;
  $('.cloud-export-progress').hidden=!busy;$('.cloud-export-resume').hidden=!pending||state.observing;$('.cloud-export-results').hidden=!ready;$('.cloud-export-refresh').hidden=!ready||!state.jobId;
  const title=state.request?.title||this.getProject().title||'project',messages={idle:'Render the full mix in Freestyle, then download the audio file.',starting:`Starting the cloud render of ${title}…`,pending:state.observing?`Rendering ${title} in Freestyle…`:`The render of ${title} is still pending. Check its status to continue.`,ready:`${title} is ready to download.`,failed:state.error||'The cloud render failed.',cancelled:state.error||'The cloud render was cancelled.',unavailable:state.error||'Freestyle did not return downloadable audio.',uncertain:'The export receipt is uncertain. Check this project’s exports before starting another render.'};
  $('.cloud-export-state').textContent=state.status==='uncertain'?`${messages.uncertain}${state.error?' '+state.error:''}`:state.error||messages[state.status]||'Waiting for Freestyle…';
  const progress=$('.cloud-export-progress-label');progress.hidden=!busy||state.progress===null;progress.textContent=state.progress===null?'':`Cloud progress: ${state.progress}`;
  // The provider's progress units are not declared, so the bar remains indeterminate.
  const direct=$('.cloud-export-direct');direct.hidden=!state.downloadUrl;if(state.downloadUrl)direct.href=state.downloadUrl;else direct.removeAttribute('href');
  const output=state.payload?.export||state.payload?.render||{},format=state.audio?.[0]?.mimeType||output.mimeType||output.mime_type||output.format,rate=output.sampleRate||output.sample_rate,channels=output.channels;
  $('.cloud-export-format').value=format?String(format):'Cloud default';$('.cloud-export-rate').value=rate?`${rate} Hz`:'Cloud default';$('.cloud-export-channels').value=channels===2?'Stereo':channels===1?'Mono':channels?`${channels} channels`:'Cloud mix';
 }
 async download(){
  const state=this.controller.snapshot(),d=this.dialog;if(state.status!=='ready'||!d?.isConnected)return;
  const button=d.querySelector('.cloud-export-download'),error=d.querySelector('.cloud-export-download-error');button.disabled=true;error.textContent='';
  try{
   let blob;if(state.audio.length)blob=exportAudioBlob(state.audio[0]);else{const response=await this.fetchFile(state.downloadUrl,{credentials:'omit'});if(!response.ok)throw new Error('The download link could not be read.');const type=(response.headers.get('Content-Type')||'').split(';')[0].toLowerCase();if(type&&!type.startsWith('audio/')&&type!=='application/octet-stream')throw new Error('The download did not return an audio file.');blob=await response.blob();}
   if(!d.isConnected)return;
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=exportFilename(d.querySelector('.cloud-export-name').value,{mimeType:blob.type,url:state.downloadUrl});document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(cause){if(d.isConnected)error.textContent=state.downloadUrl?'The browser could not prepare a named download. Use the direct download link, or refresh the link and try again.':cause.message;}
  finally{button.disabled=false;}
 }
}
