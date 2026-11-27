import {CloudExportController} from './cloud-export.js';
import {availableExportFormats,exportProgressLabel,stemExportAvailable,STEM_UNAVAILABLE_REASON,FORMAT_UNAVAILABLE_REASON,EXPORT_FORMATS,EXPORT_SAMPLE_RATES,EXPORT_TAIL_RANGE,bitDepthLabel,sampleRateLabel,exportExtension} from './cloud-export-options.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const extensions={'audio/wav':'.wav','audio/x-wav':'.wav','audio/wave':'.wav','audio/mpeg':'.mp3','audio/flac':'.flac','audio/x-flac':'.flac','audio/ogg':'.ogg','audio/opus':'.opus','audio/mp4':'.m4a','audio/aac':'.aac','audio/aiff':'.aiff','audio/x-aiff':'.aiff'};
export function exportFilename(value,{mimeType,url,fallbackExtension}={}){
 let name=String(value||'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim().slice(0,200)||'Untitled';
 let extension=extensions[String(mimeType||'').split(';')[0].toLowerCase()];
 if(!extension&&(!mimeType||mimeType==='application/octet-stream')&&!url&&fallbackExtension)extension=fallbackExtension;
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
 constructor({getProject,engine,dialog,connect,cloudCall,getLoop=()=>null,getFormats=()=>undefined,getFeatures=()=>undefined,fetchFile=(...args)=>fetch(...args),pollLimit=60}={}){
  Object.assign(this,{getProject,engine,createDialog:dialog,connect,getLoop,getFormats,getFeatures,fetchFile,pollLimit});this.controllers=new Map();this.dialog=null;this.controller=null;
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
  const d=this.createDialog('Export · cloud mix',`<form class="cloud-export-form"><label>File name<input class="cloud-export-name" maxlength="200" value="${esc(title)}" required></label><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px"><label>Format<select class="cloud-export-format">${Object.entries(EXPORT_FORMATS).map(([id,f])=>`<option value="${id}">${esc(f.label)}</option>`).join('')}</select></label><label class="cloud-export-depth-label">Bit depth<select class="cloud-export-depth"></select></label><label class="cloud-export-bitrate-label" hidden>Bitrate<select class="cloud-export-bitrate">${EXPORT_FORMATS.mp3.bitrates.map(k=>`<option value="${k}"${k===EXPORT_FORMATS.mp3.defaultBitrate?' selected':''}>${k} kbps</option>`).join('')}</select></label><label>Sample rate<select class="cloud-export-rate">${EXPORT_SAMPLE_RATES.map(r=>`<option value="${r}">${esc(sampleRateLabel(r))}</option>`).join('')}</select></label></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label>Range<select class="cloud-export-range"><option value="song">Song</option><option value="loop">Loop selection</option></select></label><label>Tail (seconds)<input class="cloud-export-tail" type="number" min="${EXPORT_TAIL_RANGE.min}" max="${EXPORT_TAIL_RANGE.max}" step="0.1" value="${EXPORT_TAIL_RANGE.default}"></label></div><label class="cloud-export-split" style="display:flex;align-items:center;gap:8px"><input type="checkbox" class="cloud-export-stems"> Split mixer tracks</label><p class="cloud-export-summary"></p><p class="cloud-export-state" role="status"></p><progress class="cloud-export-progress" style="width:100%;accent-color:#d8ad70" hidden></progress><p class="cloud-export-progress-label" hidden></p><ol class="cloud-export-stem-list" hidden style="margin:6px 0;padding-left:22px"></ol><div class="cloud-export-results" hidden><button type="button" class="primary cloud-export-download">Download audio</button><a class="cloud-export-direct" target="_blank" rel="noopener noreferrer" hidden>Direct download ↗</a><button type="button" class="cloud-export-refresh" hidden>Refresh download link</button></div><p class="cloud-export-download-error" role="status"></p><div style="display:flex;justify-content:flex-end;gap:5px"><button type="button" class="cloud-export-resume" hidden>Check export status</button><button type="button" class="cloud-export-close">Close</button><button type="submit" class="cloud-export-start primary">Render cloud mix</button></div></form>`);
  this.dialog=d;d.classList.add('cloud-export-dialog');
  d.querySelector('form').onsubmit=event=>{event.preventDefault();return this.start();};
  d.querySelector('.cloud-export-close').onclick=()=>d.close();
  for(const sel of ['.cloud-export-format','.cloud-export-depth','.cloud-export-bitrate','.cloud-export-rate','.cloud-export-range','.cloud-export-tail','.cloud-export-stems'])d.querySelector(sel).addEventListener('change',()=>this.syncControls());
  this.syncControls();
  d.querySelector('.cloud-export-resume').onclick=()=>this.observe();
  d.querySelector('.cloud-export-refresh').onclick=()=>this.run(()=>controller.poll({refreshReady:true}));
  d.querySelector('.cloud-export-download').onclick=()=>this.download();
  d.addEventListener('close',()=>{controller.cancelObservation();if(this.dialog===d)this.dialog=null;},{once:true});
  this.render(state);return d;
 }
 async run(task){const controller=this.controller,d=this.dialog;try{return await task();}catch(error){if(this.controller===controller&&this.dialog===d){this.render(controller.snapshot());if(d?.isConnected)d.querySelector('.cloud-export-state').textContent=controller.snapshot().status==='uncertain'?`The export receipt is uncertain. ${error.message} Check this project’s exports before starting another render.`:error.message;}return null;}}
 choices(){
  const d=this.dialog,$=selector=>d.querySelector(selector),loop=this.getLoop?.()||null;
  return {format:$('.cloud-export-format').value,bitDepth:$('.cloud-export-depth').value,mp3BitrateKbps:$('.cloud-export-bitrate').value,sampleRate:$('.cloud-export-rate').value,range:$('.cloud-export-range').value,loop,tailSec:$('.cloud-export-tail').value,splitStems:$('.cloud-export-stems').checked};
 }
 syncControls(){
  const d=this.dialog;if(!d?.isConnected)return;const $=selector=>d.querySelector(selector);
  const available=availableExportFormats(this.getFormats?.());for(const option of $('.cloud-export-format').options){option.disabled=!available.has(option.value);option.title=option.disabled?FORMAT_UNAVAILABLE_REASON:'';}
  if(!available.has($('.cloud-export-format').value))$('.cloud-export-format').value='wav';
  const info=EXPORT_FORMATS[$('.cloud-export-format').value]||EXPORT_FORMATS.wav,depth=$('.cloud-export-depth');
  const keep=Number(depth.value);depth.innerHTML=(info.bitDepths||[]).map(v=>`<option value="${v}">${esc(bitDepthLabel(v))}</option>`).join('');
  depth.value=String((info.bitDepths||[]).includes(keep)?keep:info.defaultBitDepth);
  $('.cloud-export-depth-label').hidden=!info.bitDepths;$('.cloud-export-bitrate-label').hidden=$('.cloud-export-format').value!=='mp3';
  const loop=this.getLoop?.()||null,loopOption=$('.cloud-export-range').querySelector('option[value=loop]');loopOption.disabled=!loop;if(!loop&&$('.cloud-export-range').value==='loop')$('.cloud-export-range').value='song';
  const range=$('.cloud-export-range').value==='loop'&&loop?`${loop.startSec.toFixed(2)}s to ${loop.endSec.toFixed(2)}s`:'Entire song';
  const split=$('.cloud-export-stems'),splitOk=stemExportAvailable(this.getFeatures?.());split.disabled=!splitOk;split.title=splitOk?'':STEM_UNAVAILABLE_REASON;if(!splitOk)split.checked=false;
  $('.cloud-export-summary').textContent=split.checked?`${range} · one file per mixer track (muted tracks are skipped), with a download link for each.`:`${range} · saved to your browser’s download location.`;
 }
 async start(){
  if(!this.dialog?.isConnected)return;
  try{this.assertScope();}catch(error){this.dialog.querySelector('.cloud-export-state').textContent=error.message;return null;}
  const controller=this.controller,d=this.dialog,state=await this.run(()=>{const choices=this.choices(),loop=choices.range==='loop'?choices.loop:null;return controller.begin(loop?{scope:'selection',startSec:loop.startSec,endSec:loop.endSec,choices}:{scope:'project',choices});});
  if(state?.status==='pending'&&this.dialog===d&&this.controller===controller&&d.isConnected)return this.observe();
  return state;
 }
 observe(){const controller=this.controller,stems=controller.snapshot().request?.options?.stems===true;return this.run(()=>controller.resume(stems?{maxPolls:this.pollLimit*10,timeoutMs:15*60*1000}:{maxPolls:this.pollLimit}));}
 render(state){
  const d=this.dialog;if(!d?.isConnected)return;const $=selector=>d.querySelector(selector),pending=state.status==='pending',busy=pending||state.status==='starting',ready=state.status==='ready';
  $('.cloud-export-start').disabled=busy||state.status==='uncertain';$('.cloud-export-start').textContent=ready?'Render again':'Render cloud mix';$('.cloud-export-name').disabled=busy;
  const stemJob=state.request?.options?.stems===true,stemOk=stemExportAvailable(this.getFeatures?.());$('.cloud-export-stems').disabled=busy||!stemOk;
  $('.cloud-export-progress').hidden=!busy;$('.cloud-export-resume').hidden=!pending||state.observing;$('.cloud-export-results').hidden=!ready;$('.cloud-export-refresh').hidden=!ready||!state.jobId;
  const title=state.request?.title||this.getProject().title||'project',messages={idle:'Render the full mix in Freestyle, then download the audio file.',starting:`Starting the cloud render of ${title}…`,pending:state.observing?`Rendering ${title} in Freestyle…`:`The render of ${title} is still pending. Check its status to continue.`,ready:`${title} is ready to download.`,failed:state.error||'The cloud render failed.',cancelled:state.error||'The cloud render was cancelled.',unavailable:state.error||'Freestyle did not return downloadable audio.',uncertain:'The export receipt is uncertain. Check this project’s exports before starting another render.'};
  $('.cloud-export-state').textContent=state.status==='uncertain'?`${messages.uncertain}${state.error?' '+state.error:''}`:state.error||messages[state.status]||'Waiting for Freestyle…';
  const progress=$('.cloud-export-progress-label'),bar=$('.cloud-export-progress');progress.hidden=!busy||state.progress===null;progress.textContent=exportProgressLabel(state.progress,stemJob);
  // Freestyle reports a 0-100 percent for every export job; the bar fills for stems and plain renders alike.
  if(state.progress!==null&&state.progress>=0&&state.progress<=100){bar.max=100;bar.value=state.progress;}else bar.removeAttribute('value');
  const list=$('.cloud-export-stem-list');list.replaceChildren();list.hidden=!stemJob||!state.stems?.length;
  for(const stem of state.stems||[]){const item=document.createElement('li'),label=document.createElement('span');label.textContent=`${stem.number} ${stem.label||'Track'} · ${stem.downloadUrl?'ready':stem.state}${stem.bytes?` · ${(stem.bytes/1048576).toFixed(1)} MB`:''} `;item.append(label);if(stem.downloadUrl){const link=document.createElement('a');link.href=stem.downloadUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Download';item.append(link);}list.append(item);}
  $('.cloud-export-download').textContent=stemJob?'Download all stems':'Download audio';$('.cloud-export-direct').hidden=stemJob||!state.downloadUrl;
  const direct=$('.cloud-export-direct');if(state.downloadUrl)direct.href=state.downloadUrl;else direct.removeAttribute('href');
  const output=state.payload?.export||{},summary=$('.cloud-export-summary');
  if(state.status==='ready'&&stemJob)summary.textContent=`${state.stems.length} stems ready · links expire in one hour.`;
  else if(state.status==='ready'&&(output.filename||output.bytes))summary.textContent=`${output.filename||'Export'}${output.bytes?` · ${(output.bytes/1048576).toFixed(1)} MB`:''}`;
  for(const selector of ['.cloud-export-format','.cloud-export-depth','.cloud-export-bitrate','.cloud-export-rate','.cloud-export-range','.cloud-export-tail'])$(selector).disabled=busy;
 }
 async download(){
  const state=this.controller.snapshot(),d=this.dialog;if(state.status!=='ready'||!d?.isConnected)return;
  if(state.request?.options?.stems){for(const stem of state.stems){if(!stem.downloadUrl||!d.isConnected)continue;const link=document.createElement('a');link.href=stem.downloadUrl;link.download=stem.fileName||`${stem.number}-${stem.label||'track'}`;link.rel='noopener noreferrer';document.body.append(link);link.click();link.remove();await new Promise(resolve=>setTimeout(resolve,400));}return;}
  const button=d.querySelector('.cloud-export-download'),error=d.querySelector('.cloud-export-download-error');button.disabled=true;error.textContent='';
  try{
   let blob;if(state.audio.length)blob=exportAudioBlob(state.audio[0]);else{const response=await this.fetchFile(state.downloadUrl,{credentials:'omit'});if(!response.ok)throw new Error('The download link could not be read.');const type=(response.headers.get('Content-Type')||'').split(';')[0].toLowerCase();if(type&&!type.startsWith('audio/')&&type!=='application/octet-stream')throw new Error('The download did not return an audio file.');blob=await response.blob();}
   if(!d.isConnected)return;
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=exportFilename(d.querySelector('.cloud-export-name').value,{mimeType:blob.type,url:state.downloadUrl,fallbackExtension:exportExtension(state.payload?.options?.format||state.request?.options?.format)});document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(cause){if(d.isConnected)error.textContent=state.downloadUrl?'The browser could not prepare a named download. Use the direct download link, or refresh the link and try again.':cause.message;}
  finally{button.disabled=false;}
 }
}
