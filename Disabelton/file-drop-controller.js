const clone=value=>value==null?value:structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>Array.isArray(value)?value.map(stable):record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(left,right)=>JSON.stringify(stable(left))===JSON.stringify(stable(right));
const failure=(message,code='file_drop_invalid')=>Object.assign(new Error(message),{code});
const audio=new Set(['wav','mp3','m4a','aac','flac','aif','aiff','ogg','webm']),midi=new Set(['mid','midi']),project=new Set(['flp','zip','logicx']);
export function classifyDroppedFile(file){const extension=typeof file?.name==='string'?file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase():null;return audio.has(extension)?'audio':midi.has(extension)?'midi':project.has(extension)?'project':null;}
/** QA r3: seconds of a WAV / AIFF(-C) file from its header (first 256 KB), or null. Sizes the drop placeholder
 * before the upload; other formats stay null (the placeholder then shows one bar). */
export function audioHeaderSeconds(buffer){
 try{const view=new DataView(buffer),tag=at=>at+4<=view.byteLength?String.fromCharCode(view.getUint8(at),view.getUint8(at+1),view.getUint8(at+2),view.getUint8(at+3)):'';
  if(tag(0)==='RIFF'&&tag(8)==='WAVE'){let byteRate=0,at=12;while(at+8<=view.byteLength){const id=tag(at),size=view.getUint32(at+4,true);if(id==='fmt '&&at+16<=view.byteLength)byteRate=view.getUint32(at+16,true);if(id==='data')return byteRate>0?size/byteRate:null;at+=8+size+(size&1);}return null;}
  if(tag(0)==='FORM'&&['AIFF','AIFC'].includes(tag(8))){let at=12;while(at+8<=view.byteLength){const id=tag(at),size=view.getUint32(at+4);if(id==='COMM'&&at+26<=view.byteLength){const frames=view.getUint32(at+10),exp=(view.getUint16(at+16)&0x7fff)-16383,mant=view.getUint32(at+18)*2**-31+view.getUint32(at+22)*2**-63,rate=mant*2**exp;return rate>0&&Number.isFinite(rate)?frames/rate:null;}at+=8+size+(size&1);}return null;}
 }catch{}return null;
}
async function fileSeconds(file){try{if(typeof file?.slice!=='function')return null;const part=file.slice(0,256*1024),buffer=typeof part.arrayBuffer==='function'?await part.arrayBuffer():null;const seconds=buffer?audioHeaderSeconds(buffer):null;return Number.isFinite(seconds)&&seconds>0?seconds:null;}catch{return null;}}
function hasFiles(event,window){
 const transfer=event?.dataTransfer;if(!transfer)return false;
 try{if(Array.from(transfer.types||[]).includes('Files'))return true;}catch{}
 const files=transfer.files;try{return !!files&&typeof window?.FileList==='function'&&files instanceof window.FileList&&files.length>0;}catch{return false;}
}

/** Only OS file drags are consumed. onFiles receives one ordered batch and must
 * call beginWrite() immediately before its first upload, then assertCurrent()
 * before later writes/after asynchronous selection or encoding boundaries.
 * Cancel is local preparation only; dispatched uploads are never replayed or
 * represented as cancelled. No engine, network or file parsing lives here.
 */
export class FileDropController{
 constructor({element,overlayHost=element,getScope,isEditable=()=>true,resolveTarget=()=>null,onFiles,onStatus=()=>{},onChange=()=>{}}={}){
  if(!element?.addEventListener||!overlayHost?.append||typeof getScope!=='function'||typeof onFiles!=='function')throw new TypeError('FileDropController needs a DOM element, scope and ordered-file callback.');
  Object.assign(this,{element,overlayHost,getScope,isEditable,resolveTarget,onFiles,onStatus,onChange});this.document=element.ownerDocument;this.window=this.document.defaultView;this.operation=null;this.sequence=0;this.depth=0;this.dragging=false;this.previewTarget=null;this.state={status:'idle',message:'',files:[],scope:null,target:null,error:null,writeStarted:false};this.destroyed=false;
  this.overlay=this.document.createElement('div');this.overlay.className='file-drop-overlay';this.overlay.hidden=true;this.overlay.setAttribute('role','status');this.overlay.setAttribute('aria-live','polite');this.overlay.setAttribute('aria-atomic','true');this.overlay.style.cssText='position:absolute;inset:12px;z-index:3000;pointer-events:none;display:flex;align-items:center;justify-content:center;gap:12px;padding:20px;background:#162129ee;color:#eef2f0;border:2px dashed #91af9d;border-radius:8px;text-align:center;';
  this.message=this.document.createElement('span');this.overlay.append(this.message);this.cancelButton=this.document.createElement('button');this.cancelButton.type='button';this.cancelButton.textContent='Cancel';this.cancelButton.style.pointerEvents='auto';this.cancelButton.onclick=()=>this.busy?this.cancel():this.dismiss();this.overlay.append(this.cancelButton);overlayHost.append(this.overlay);
  this.listeners={dragenter:event=>this.enter(event),dragover:event=>this.over(event),dragleave:event=>this.leave(event),drop:event=>{void this.drop(event);}};
  for(const [name,listener]of Object.entries(this.listeners))element.addEventListener(name,listener,true);
  this.keyListener=event=>{if(event.key==='Escape'&&(this.dragging||this.busy)&&!this.operation?.writeStarted){event.preventDefault();if(!this.cancel())this.clearDrag();}};this.document.addEventListener('keydown',this.keyListener,true);this.paint();
 }
 get busy(){return !!this.operation;}
 snapshot(){return{...clone(this.state),previewTarget:clone(this.previewTarget),busy:this.busy,dragging:this.dragging,cancellable:!!this.operation&&!this.operation.writeStarted&&!this.operation.controller.signal.aborted};}
 notify(){const snapshot=this.snapshot();this.paint(snapshot);if(!this.destroyed)try{this.onChange(clone(snapshot));}catch{}return snapshot;}
 status(message){if(!this.destroyed)try{this.onStatus(message);}catch{}}
 paint(snapshot=this.snapshot()){
  if(this.destroyed)return;const visible=this.dragging||this.busy||snapshot.status==='error';this.overlay.hidden=!visible;this.overlay.style.display=visible?'flex':'none';this.overlay.dataset.state=this.busy?snapshot.writeStarted?'writing':'pending':this.dragging?'dragging':snapshot.status;this.overlay.dataset.targetAccepted=String(snapshot.previewTarget?.accepted!==false);this.overlay.setAttribute('aria-busy',String(this.busy));this.message.textContent=this.dragging&&!this.busy?snapshot.previewTarget?.message||'Drop audio, MIDI or a DAW project here':snapshot.message;this.cancelButton.hidden=!this.busy&&snapshot.status!=='error';this.cancelButton.disabled=this.busy&&!snapshot.cancellable;this.cancelButton.textContent=this.busy?'Cancel':'Dismiss';this.cancelButton.setAttribute('aria-label',this.busy?'Cancel before uploading files':'Dismiss file import error');
 }
 consume(event){event.preventDefault();event.stopPropagation();}
 editable(){try{return !this.destroyed&&this.isEditable()===true;}catch{return false;}}
 preview(event){
  if(this.busy)return;if(!this.editable()){this.previewTarget={accepted:false,message:'Finish the current operation and select an editable cloud project before importing files.'};return;}
  try{const files=Array.from(event.dataTransfer.files||[]);this.previewTarget=clone(this.resolveTarget(event,{phase:'preview',entries:files.map(file=>({file,kind:classifyDroppedFile(file)}))}));}catch(error){this.previewTarget={accepted:false,message:error.message||'Choose a file import destination.'};}
 }
 enter(event){if(!hasFiles(event,this.window))return;this.consume(event);this.depth++;this.dragging=true;this.preview(event);this.notify();}
 over(event){if(!hasFiles(event,this.window))return;this.consume(event);this.dragging=true;this.preview(event);try{event.dataTransfer.dropEffect=this.editable()&&!this.busy&&this.previewTarget?.accepted!==false?'copy':'none';}catch{}this.notify();}
 leave(event){if(!this.dragging)return;if(event.relatedTarget&&this.element.contains(event.relatedTarget))return;this.depth=Math.max(0,this.depth-1);if(!this.depth){this.dragging=false;this.previewTarget=null;this.notify();}}
 clearDrag(){this.depth=0;this.dragging=false;this.previewTarget=null;this.notify();}
 capture(){if(!this.editable())throw failure('Finish the current operation and select an editable cloud project before importing files.','file_drop_not_editable');const scope=clone(this.getScope());if(!record(scope)||!Object.keys(scope).length)throw failure('The file import project context is unavailable.','file_drop_scope_changed');return scope;}
 assertCurrent(operation){
  if(this.destroyed||this.operation!==operation||operation.controller.signal.aborted)throw failure('File import preparation was cancelled.','file_drop_cancelled');
  if(!same(operation.scope,this.capture()))throw failure('The project or import context changed. Drop the files again in the intended project.','file_drop_scope_changed');
 }
 beginWrite(operation){this.assertCurrent(operation);if(!operation.writeStarted){operation.writeStarted=true;this.state.writeStarted=true;this.state.status='writing';this.state.message=`Importing ${operation.files.length} file${operation.files.length===1?'':'s'}…`;this.notify();}return true;}
 adoptScope(operation,nextScope){
  if(this.destroyed||this.operation!==operation||operation.controller.signal.aborted||!operation.writeStarted)throw failure('Only an active dispatched project import may adopt its verified new context.','file_drop_scope_changed');
  const current=this.capture();if(!record(nextScope)||!same(nextScope,current))throw failure('The imported project does not match the current file-drop context.','file_drop_scope_changed');operation.scope=clone(current);this.state.scope=clone(current);this.notify();return clone(current);
 }
 drop(event){
  if(!hasFiles(event,this.window))return Promise.resolve(null);this.consume(event);this.depth=0;this.dragging=false;this.previewTarget=null;
  if(this.busy){this.status('Wait for the current file import to finish.');this.notify();return Promise.resolve(this.snapshot());}
  let files,scope,target;
  try{
   scope=this.capture();files=Array.from(event.dataTransfer.files||[]);if(!files.length)throw failure('The drop contained no readable files. Drop files rather than a folder.');
   for(const file of files)if(!classifyDroppedFile(file))throw failure(`Unsupported file: ${String(file?.name||'unnamed file')}. Drop WAV, MP3, M4A, AAC, FLAC, AIFF, OGG, WebM, MIDI, FLP, ZIP or Logic project files.`,'file_drop_unsupported');
   target=clone(this.resolveTarget(event,{phase:'drop',entries:files.map(file=>({file,kind:classifyDroppedFile(file)}))}));if(!same(scope,this.capture()))throw failure('The project changed while locating this file drop.','file_drop_scope_changed');if(target?.accepted===false)throw failure(target.message||'Drop these files onto a supported import destination.','file_drop_target_invalid');
  }catch(error){this.state={status:'error',message:error.message,files:[],scope:null,target:clone(target??null),error:{message:error.message,code:error.code||'file_drop_invalid'},writeStarted:false};this.status(error.message);return Promise.resolve(this.notify());}
  const operation={id:++this.sequence,files:files.slice(),scope:clone(scope),target:clone(target),controller:new AbortController(),writeStarted:false,promise:null};this.operation=operation;this.state={status:'pending',message:`Preparing ${files.length} file${files.length===1?'':'s'}…`,files:files.map(file=>({name:file.name,kind:classifyDroppedFile(file),size:file.size??null})),scope:clone(scope),target:clone(target),error:null,writeStarted:false};
  // The placeholder takes the file's real length as soon as its header is read (independent of the import).
  files.forEach((file,index)=>{if(classifyDroppedFile(file)==='audio')fileSeconds(file).then(seconds=>{const entry=this.state?.files?.[index];if(seconds==null||this.operation!==operation||!entry||entry.name!==file.name)return;entry.seconds=seconds;this.notify();});});
  operation.promise=Promise.resolve().then(async()=>{
   try{this.assertCurrent(operation);const context=Object.freeze({scope:clone(scope),target:clone(target),entries:Object.freeze(files.map(file=>Object.freeze({file,kind:classifyDroppedFile(file)}))),signal:operation.controller.signal,assertCurrent:()=>this.assertCurrent(operation),beginWrite:()=>this.beginWrite(operation),adoptScope:next=>this.adoptScope(operation,next)});const result=await this.onFiles(Object.freeze(files.slice()),context);this.assertCurrent(operation);this.state.status='completed';this.state.message='File import finished.';return{status:'completed',result};}
   catch(error){const cancelled=!operation.writeStarted&&(operation.controller.signal.aborted||error.code==='file_drop_cancelled');this.state.status=cancelled?'cancelled':'error';this.state.message=cancelled?'File import cancelled before uploading.':error.message||String(error);this.state.error=cancelled?null:{message:this.state.message,code:error.code||'file_drop_failed'};if(!cancelled)this.status(this.state.message);return{status:this.state.status,error:this.state.error};}
   finally{if(this.operation===operation)this.operation=null;this.notify();}
  });this.notify();return operation.promise;
 }
 cancel(){const operation=this.operation;if(!operation||operation.writeStarted)return false;operation.controller.abort();this.state.status='cancelled';this.state.message='File import cancelled before uploading.';this.notify();return true;}
 dismiss(){if(this.busy)return false;this.state={status:'idle',message:'',files:[],scope:null,target:null,error:null,writeStarted:false};this.clearDrag();return true;}
 destroy(){if(this.destroyed)return;this.destroyed=true;if(this.operation&&!this.operation.writeStarted)this.operation.controller.abort();for(const [name,listener]of Object.entries(this.listeners))this.element.removeEventListener(name,listener,true);this.document.removeEventListener('keydown',this.keyListener,true);this.overlay.remove();}
}
