import {definiteCloudRejection,assertTerminalIdempotency} from './cloud-errors.js';
import {TRACK_GUTTER_PX} from './audacity-layout.js';
import {validateAudioFile,createCloudAudioTrack,reconcileCloudAudioImport,reconcileCloudAudioTrack} from './cloud-audio-import.js';
import {bridgeFetch} from './freestyle-host-transport.js';
const pendingPhases=new Set(['queued','awaiting-connection','awaiting-project','awaiting-gesture']);
const isFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files')||Array.from(event.dataTransfer?.items||[]).some(item=>item.kind==='file');
/** Exact duration from the file's own header (WAV/RF64 'fmt '+'data', AIFF/AIFC
 * 'COMM'); other formats use the browser's audio metadata. null when unknown. */
export function audioHeaderSeconds(buffer,fileSize){
 const view=new DataView(buffer),text=(at,n)=>at+n<=view.byteLength?String.fromCharCode(...new Uint8Array(buffer,at,n)):'';
 if(view.byteLength<12)return null;const riff=text(0,4),form=text(8,4);
 if((riff==='RIFF'||riff==='RF64')&&form==='WAVE'){let at=12,byteRate=0,dataSize=null,dataAt=null;while(at+8<=view.byteLength){const id=text(at,4),size=view.getUint32(at+4,true);if(id==='fmt '&&at+16<=view.byteLength)byteRate=view.getUint32(at+16,true);if(id==='data'){dataAt=at+8;dataSize=size;break;}at+=8+size+(size&1);}
  if(!(byteRate>0)||dataAt===null)return null;if(dataSize===0xFFFFFFFF||riff==='RF64'||dataAt+dataSize>fileSize)dataSize=Math.max(0,fileSize-dataAt);return dataSize/byteRate;}
 if(riff==='FORM'&&(form==='AIFF'||form==='AIFC')){let at=12;while(at+8<=view.byteLength){const id=text(at,4),size=view.getUint32(at+4,false);if(id==='COMM'&&at+26<=view.byteLength){const frames=view.getUint32(at+10,false),exponent=view.getUint16(at+16,false)&0x7fff,mantissa=view.getUint32(at+18,false)*2**32+view.getUint32(at+22,false),rate=mantissa*2**(exponent-16383-63);return rate>0?frames/rate:null;}at+=8+size+(size&1);}return null;}
 return null;
}
async function audioDurationSeconds(file){
 try{const head=await file.slice(0,262144).arrayBuffer(),seconds=audioHeaderSeconds(head,Number(file.size));if(Number.isFinite(seconds)&&seconds>0)return seconds;}catch{}
 const doc=globalThis.document;let url=null;try{url=(doc?.defaultView?.URL??globalThis.URL)?.createObjectURL?.(file)??null;}catch{url=null;}if(!doc||!url)return null;
 try{return await new Promise(resolve=>{const audio=doc.createElement('audio'),done=value=>{clearTimeout(timer);audio.removeAttribute('src');resolve(value);},timer=setTimeout(()=>done(null),3000);audio.preload='metadata';audio.onloadedmetadata=()=>done(Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:null);audio.onerror=()=>done(null);audio.src=url;});}catch{return null;}finally{try{(doc?.defaultView?.URL??globalThis.URL)?.revokeObjectURL?.(url);}catch{}}
}
const DEFAULT_PLACEHOLDER_SECONDS=1;
const projectTitle=file=>String(file?.name||'Modesty session').replace(/\.[^.]+$/,'').slice(0,120)||'Modesty session';

/** Native external import appends new audio tracks at0, independent of drop
 * coordinates. Pinned3.2.1 DropTarget::OnDropFiles ignores x/y and sorts names;
 * ProjectFileManager::AddImportedTracks appends the imported tracks.
 * File objects remain in memory across connection handoff and partial failures.
 */
export class AudacityImportView{
 constructor(workspace,{getConnection=async()=>{const response=await bridgeFetch('modesty-bridge:/status');if(!response.ok)throw new Error('Could not check the Freestyle connection.');return response.json();},onImported}={}){
  this.w=workspace;this.getConnection=getConnection;this.onImported=onImported;this.records=[];this.active=null;this.drainPromise=null;this.bound=null;this.nextId=0;this.nextBatch=0;
 }
 mount(){this.bind();return this;}
 context(){const e=this.w.engine;return JSON.stringify([e.projectId,e.session?.projectId,e.session?.trackId,e.loadVersion??0,e.session?.contextVersion??0,e.session?.closed===true]);}
 blocked(){const w=this.w;return !!(w.busy||w.engine.loading||w.engine.applying||w.engine.interacting||w.clipGesture||w.selectionGesture?.active||w.envelopeView?.active||w.trackLayout?.active||w.amplitudeView?.active||w.multiToolView?.active||w.loopRegion?.active||w.panGesture||w.viewport?.pinDrag);}
 status(message){this.w.engine.onStatus?.(message);}
 bind(root=this.w.root){
  if(this.bound===root)return this;if(this.bound)this.destroy();this.bound=root;
  this.dragOver=event=>{if(!isFiles(event))return;event.preventDefault();event.stopPropagation();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';root.classList.add('au-file-drop');};
  this.dragLeave=event=>{if(!root.contains(event.relatedTarget))root.classList.remove('au-file-drop');};
  this.drop=event=>{if(!isFiles(event)&&!event.dataTransfer?.files?.length)return;event.preventDefault();event.stopImmediatePropagation();root.classList.remove('au-file-drop');let target={};try{target=this.dropTarget(event);}catch{}this.importFiles(event.dataTransfer.files,{source:'drop',...target}).catch(error=>this.w.onError(error));};
  this.resumeGesture=()=>{if(this.resumeScheduled)return;this.resumeScheduled=true;queueMicrotask(()=>{this.resumeScheduled=false;if(this.bound&&!this.blocked()&&this.records.some(record=>record.phase==='awaiting-gesture'))this.resumePending().catch(error=>this.w.onError(error));});};
  const doc=root.ownerDocument;doc.addEventListener('pointerup',this.resumeGesture,true);doc.addEventListener('pointercancel',this.resumeGesture,true);doc.defaultView.addEventListener('blur',this.resumeGesture);root.addEventListener('dragenter',this.dragOver);root.addEventListener('dragover',this.dragOver);root.addEventListener('dragleave',this.dragLeave);root.addEventListener('drop',this.drop,true);return this;
 }
 open(){
  if(!this.input){const input=this.w.root.ownerDocument.createElement('input');input.type='file';input.multiple=true;input.accept='audio/*,.wav,.wave,.mp3,.flac,.ogg,.oga,.opus,.m4a,.aac,.aif,.aiff,.webm,.mp4';input.hidden=true;input.setAttribute('aria-label','Import audio files');input.onchange=()=>{const files=Array.from(input.files||[]);input.value='';if(files.length)this.importFiles(files,{source:'picker'}).catch(error=>this.w.onError(error));};this.w.root.ownerDocument.body.append(input);this.input=input;}
  this.input.click();return this.input;
 }
 /** The drop target: {atSec: drop time, laneId when dropped on a lane, newTrack otherwise}.
  * A single file dropped on an existing ordinary audio track is uploaded into
  * that lane at the drop time; empty-space and multi-file drops append new
  * tracks at the drop time. Picker imports keep Audacity's time zero. */
 dropTarget(event){
  const w=this.w,rows=[...w.root.querySelectorAll('.au-track')],row=rows.find(r=>{const b=r.getBoundingClientRect();return event.clientY>=b.top&&event.clientY<b.bottom;}),lane=(row||w.root).querySelector('.au-lane');
  let startSec=0;if(Number.isFinite(event.clientX)){const timeline=w.timeline?.getBoundingClientRect?.(),useTimeline=timeline&&Number.isFinite(timeline.left)&&(timeline.width>0||timeline.right>timeline.left),x=useTimeline?event.clientX-timeline.left-TRACK_GUTTER_PX:lane?event.clientX-lane.getBoundingClientRect().left:NaN,t=w.xToTime?.(x);if(Number.isFinite(t))startSec=Math.max(0,Math.round(t*1000)/1000);}
  const track=row?w.tracks?.find(t=>t.index===Number(row.dataset.track)):null,audio=track&&typeof track.laneId==='string'&&track.laneId&&track.channel?.type==='audio'&&!track.channel?.patternSource;
  return {startSec,laneId:audio?track.laneId:null,row:row||null};
 }
 /** A dropped clip shows at its persisted ACK; the live-engine attach (the
  * existing guarded recovery path, never a re-upload) runs in the background. */
 async attachInBackground(job){
  await Promise.resolve();const w=this.w,e=w.engine,record=job.result?.importRecord;if(!record)return;
  for(let i=0;i<50&&(e.audioImportActive||this.active);i++)await new Promise(resolve=>setTimeout(resolve,100));
  const present=()=>(w.getProject().audioClips||[]).some(clip=>(clip.cloudId||clip.id)===job.result.clipId);
  try{// Server-attached uploads only need a read-only confirmation; attach is the fallback.
   if(job.result?.engineAttached===true){await reconcileCloudAudioImport(e,record,{retryAttach:false});if(record.phase!=='complete')await reconcileCloudAudioImport(e,record,{retryAttach:true});}else await reconcileCloudAudioImport(e,record,{retryAttach:true});job.attachVerified=true;w.geometryHistory.adoptDropNative?.(job.result.clipId);if(present())e.onStatus?.('Imported '+job.file.name+' is live.');}
  catch(error){job.attachError=error.message;const message='The dropped audio is saved and placed, but the live engine has not loaded it yet ('+error.message+'). Use Verify to retry its attachment; playback of that clip may be silent.';e.onStatus?.(message);w.onWarning?.(message);(this.warnings??=[]).push(message);}
 }
 placeholder(job,row){
  const w=this.w,doc=w.root.ownerDocument,lane=(row||w.root).querySelector('.au-lane')||w.root,el=doc.createElement('div');el.className='au-drop-placeholder';el.setAttribute('role','status');el.dataset.importJob=String(job.id);
  el.textContent='Uploading '+job.file.name+'…';const left=Math.max(0,w.timeToX?.(job.startSec)??0);Object.assign(el.style,{position:'absolute',left:left+'px',top:row?'2px':'auto',bottom:row?'2px':'0',minWidth:'3px',width:Math.max(3,(job.estimatedSec||DEFAULT_PLACEHOLDER_SECONDS)*(w.scale||1))+'px',pointerEvents:'none',opacity:'.7',border:'1px dashed currentColor',font:'11px sans-serif',padding:'2px 4px',overflow:'hidden',whiteSpace:'nowrap',zIndex:'5'});
  if(typeof getComputedStyle==='function'&&getComputedStyle(lane).position==='static')lane.style.position='relative';lane.append(el);job.placeholder=el;return el;
 }
 async importFiles(files,{source='picker',startSec=0,laneId=null,row=null}={}){
  const selected=Array.from(files||[]);if(!selected.length)return Promise.resolve([]);if(selected.length>32)throw new Error('Import up to 32 audio files at a time.');selected.forEach(validateAudioFile);
  this.w.assertOwnedEditsSettled?.();
  const e=this.w.engine,projectId=e.ready?e.projectId:null,context=e.ready?this.context():null;
  const batch=++this.nextBatch,jobs=selected.map((file,index)=>({file,index})).sort((a,b)=>a.file.name.toLocaleLowerCase().localeCompare(b.file.name.toLocaleLowerCase())||a.index-b.index).map(({file})=>({id:++this.nextId,batch,kind:'file',file,source,phase:'queued',projectId,context,startSec:Number.isFinite(startSec)&&startSec>0?startSec:0,...(laneId&&selected.length===1?{targetLaneId:laneId}:{})}));this.records.push(...jobs);if(source==='drop')for(const job of jobs){job.estimatedSec=null;try{this.placeholder(job,job.targetLaneId?row:null);}catch{}job.durationTask=audioDurationSeconds(job.file).catch(()=>null).then(seconds=>{job.estimatedSec=seconds;if(seconds&&job.placeholder)job.placeholder.style.width=Math.max(3,seconds*(this.w.scale||1))+'px';return seconds;});}
  return this.resumePending().then(()=>jobs);
 }
 async addTrack(){this.w.assertOwnedEditsSettled?.();const e=this.w.engine;if(e.playing||this.w.paused||e.recorder?.recording)throw new Error('Stop cloud audio before adding an audio track.');const job={id:++this.nextId,batch:++this.nextBatch,kind:'track',phase:'queued',projectId:e.ready?e.projectId:null,context:e.ready?this.context():null};this.records.push(job);await this.resumePending();return job;}
 hasPending(){return this.records.some(record=>pendingPhases.has(record.phase));}
 async reconcileSaved(id=this.records.findLast(record=>record.importRecord)?.id,{retryAttach=false}={}){
  if(retryAttach)this.w.assertOwnedEditsSettled?.({except:this.w.importHistory?.owns(this.records.find(record=>record.id===id))?'import':undefined});
  if(this.blocked()||this.active)throw new Error('Finish the current edit before resuming saved audio.');const job=this.records.find(record=>record.id===id),record=job?.importRecord||job?.result?.importRecord;if(!record)throw new Error('No saved audio import receipt is available.');
  const w=this.w,context=this.context();this.active=job;w.busy=true;w.root.ownerDocument.body.classList.add('au-cloud-busy');
  try{await w.importHistory?.resumeJob(job);job.result=await reconcileCloudAudioImport(w.engine,record,{retryAttach,retryPlacement:retryAttach,assertCurrent:()=>{if(context!==this.context())throw new Error('The project changed during saved-audio recovery.');}});job.phase=record.phase;if(record.liveVerified){const entry=w.importHistory?.batch(job);if(entry){entry.idempotencyInProgress=false;if(job.historyAttempt)job.historyAttempt.idempotencyInProgress=false;}const clip=w.engine.project.audioClips.find(clip=>(clip.cloudId||clip.id)===record.clipId);w.selectedClip=clip.id;w.selectedTracks=new Set([clip.track]);w.focusedTrack=clip.track;if(retryAttach&&job.batch)for(const sibling of this.records)if(sibling.batch===job.batch&&sibling.projectId===record.projectId&&pendingPhases.has(sibling.phase))sibling.context=context;w.render?.();await w.importHistory?.captureJob(job);this.finishHistoryBatch(job);}return job;}
  catch(error){job.error=error;job.phase=record.phase;await w.importHistory?.interrupt(job,error);throw error;}finally{this.active=null;w.busy=false;w.root.ownerDocument.body.classList.remove('au-cloud-busy');w.lanePan?.sync?.();this.renderRecovery();if(retryAttach&&job.phase==='complete'&&job.batch)queueMicrotask(()=>{if(this.bound&&!this.blocked()&&this.records.some(sibling=>sibling.batch===job.batch&&pendingPhases.has(sibling.phase)))this.resumePending().catch(error=>w.onError(error));});}
 }
 async reconcileTrack(job){
  if(this.blocked()||this.active)throw new Error('Finish the current edit before verifying the new track.');const w=this.w,proof=job.trackAttempt??job.error?.trackAttempt;if(!proof)throw new Error('The new track has no retained creation request.');
  this.active=job;w.busy=true;try{w.importHistory.assertContext(w.importHistory.batch(job).context);job.result=await reconcileCloudAudioTrack(w.engine,proof,{assertCurrent:()=>{if(job.context!==this.context())throw new Error('The project changed during track recovery.');}});
   const entry=w.importHistory.batch(job);entry.idempotencyInProgress=false;job.historyAttempt.idempotencyInProgress=false;job.historyAttempt.status='acknowledged';await w.importHistory.captureJob(job);job.phase='complete';this.finishHistoryBatch(job);w.render?.();return job;
  }finally{this.active=null;w.busy=false;w.lanePan?.sync?.();}
 }
 renderRecovery(){
  const job=this.records.findLast(record=>['saved-unverified','uncertain'].includes(record.phase)&&record.importRecord);if(!job){this.recovery?.remove();this.recovery=null;return;}
  if(!this.recovery){const box=this.w.root.ownerDocument.createElement('aside');box.className='au-import-recovery';box.setAttribute('role','status');box.style.cssText='position:absolute;bottom:8px;left:'+(TRACK_GUTTER_PX+5)+'px;z-index:25;padding:8px;background:#f7f7f9;color:#17181b;border:1px solid #aaa';const text=box.ownerDocument.createElement('span'),button=box.ownerDocument.createElement('button');box.append(text,button);this.w.root.append(box);this.recovery=box;}
  const acknowledged=job.importRecord.acknowledged===true&&!!job.importRecord.receipts?.upload;this.recovery.firstElementChild.textContent=job.file.name+(acknowledged?' is saved; live audio needs verification. ':' has an unconfirmed upload result; keep its retained request for verification. ');const button=this.recovery.lastElementChild;button.textContent=acknowledged?'Resume saved audio':'Verify import result';button.disabled=!!this.active;button.onclick=()=>this.reconcileSaved(job.id,{retryAttach:true}).catch(error=>this.w.onError(error));
 }
 /** A terminal refusal of a fresh Add Track is not an unknown mutation.
  * Release only its empty barrier after exact canonical no-change proof. Saved
  * or running writes keep their original receipt and never enter this path. */
 async releaseRejectedImport(job,error){
  const proof=error.importRecord,history=this.w.importHistory,entry=history?.batch?.(job),attempt=job.historyAttempt;
  if(job.kind!=='file'||proof?.planningRejected!==true||proof.acknowledged||proof.persisted||proof.clipId||proof.writeAttempts?.length!==1||proof.writeAttempts[0].stage!=='upload'||proof.writeAttempts[0].status!=='rejected'||proof.writeAttempts[0].providerDispatched!==false||!entry||entry.context.projectId!==proof.projectId||entry.registered||entry.laneIds.length||entry.steps.length||entry.after||entry.attempts.length!==1||entry.attempts[0]!==attempt||history.pending.get(entry.context.projectId)!==entry)return false;
  try{assertTerminalIdempotency(proof);assertTerminalIdempotency(entry);history.assertContext(entry.context);const actual=await history.controller.readCurrent(entry.context);history.controller.assertState(actual,entry.initial);history.assertContext(entry.context);assertTerminalIdempotency(proof);attempt.status='rejected';attempt.error=error.message;attempt.importRecord=proof;entry.status='rejected';entry.rejectedReadback=actual;history.pending.delete(entry.context.projectId);history.batches.delete(job.batch);job.historyRejected=true;return true;}catch(verificationError){proof.verificationError=verificationError.message;return false;}
 }
 async releaseRejectedTrack(job,error){
  const proof=error.trackAttempt,history=this.w.importHistory,entry=history?.batch?.(job),attempt=job.historyAttempt;
  if(job.kind!=='track'||proof?.action!=='create_empty_lane'||proof.status!=='rejected'||proof.dispatched!==true||proof.acknowledged!==false||!definiteCloudRejection(error)||!entry||entry.context.projectId!==proof.projectId||entry.registered||entry.laneIds.length||entry.steps.length||entry.after||entry.attempts.length!==1||entry.attempts[0]!==attempt||history.pending.get(entry.context.projectId)!==entry)return false;
  try{
   assertTerminalIdempotency(proof);assertTerminalIdempotency(entry);history.assertContext(entry.context);
   const actual=await history.controller.readCurrent(entry.context);history.controller.assertState(actual,entry.initial);history.assertContext(entry.context);assertTerminalIdempotency(entry);
   attempt.status='rejected';attempt.error=error.message;attempt.trackAttempt=structuredClone(proof);entry.status='rejected';entry.rejectedReadback=actual;history.pending.delete(entry.context.projectId);history.batches.delete(job.batch);job.historyRejected=true;return true;
  }catch(verificationError){proof.verificationError=verificationError.message;return false;}
 }
 finishHistoryBatch(job){if(this.records.filter(record=>record.batch===job.batch).every(record=>record.phase==='complete'||record.historyNotDispatched===true))this.w.importHistory?.finishBatch(job);}
 whenIdle(){return this.drainPromise||Promise.resolve();}
 async prepareProject(job){
  const e=this.w.engine;
  if(!e.ready){
   let connection;try{connection=await this.getConnection();}catch(error){job.phase='awaiting-connection';this.status('The connection check failed; the selected audio files remain in this tab.');this.w.onError(error);return false;}
   if(!connection.connected){job.phase='awaiting-connection';this.status('Connect Freestyle to import; your selected audio files are retained in this tab.');this.w.connect?.();return false;}
   if(!e.ready){if(e.loading||e.projectId){job.phase='awaiting-project';this.status('Load the selected Freestyle project to continue the retained import.');this.w.connect?.();return false;}
    job.phase='creating-project';this.w.importHistory?.beforeCreate(job);job.creationDispatched=true;await e.create(projectTitle(job.file));if(!e.ready||!e.projectId)throw new Error('Freestyle has not confirmed the newly created project.');job.createdProject=true;job.createdLaneId=e.session.trackId;}
  }
  if(job.projectId&&job.projectId!==e.projectId||job.context&&job.context!==this.context())throw new Error('The project changed after these files were selected. The files remain retained; import them explicitly into the intended project.');
  job.projectId=e.projectId;job.context=this.context();if(job.batch)for(const sibling of this.records)if(sibling.batch===job.batch&&!sibling.context){sibling.projectId=job.projectId;sibling.context=job.context;}return true;
 }
 resumePending(){
  if(this.drainPromise)return this.drainPromise;
  this.drainPromise=this.drain().finally(()=>{this.drainPromise=null;});return this.drainPromise;
 }
 async drain(){
  const w=this.w,e=w.engine;let imported=false;
  for(const job of this.records){
   if(!pendingPhases.has(job.phase))continue;
   try{w.assertOwnedEditsSettled?.({except:w.importHistory?.owns(job)?'import':undefined});}catch{job.phase='awaiting-gesture';this.status('Verify or recover the pending cloud edit to import the retained audio files.');break;}
   if(this.blocked()||e.playing||w.paused||e.playAttempt||e.recorder?.recording){job.phase='awaiting-gesture';this.status('Finish the current edit to import the retained audio files.');break;}
   this.active=job;w.busy=true;w.root.ownerDocument.body.classList.add('au-cloud-busy');
   try{
    if(!await this.prepareProject(job))break;
    const assertCurrent=()=>{if(job.context!==this.context())throw Object.assign(new Error('The project changed before the imported audio was applied.'),{name:'AbortError'});};
    this.status(job.kind==='track'?'Preparing new audio track…':'Preparing import of '+job.file.name+'…');
    if(job.targetLaneId){job.dropBefore=await w.clipboard.read(w.clipboard.context());assertCurrent();}else await w.importHistory?.beforeMutation(job);job.phase='importing';
    if(job.kind==='track'){
     if(job.createdProject){const channel=e.project?.channels.find(channel=>(channel.laneId||channel.id)===job.createdLaneId);if(!channel)throw new Error('The new project has not exposed its audio lane.');job.result={laneId:job.createdLaneId,channel};}
     else job.result=await createCloudAudioTrack(e,{name:'Audio '+(w.tracks.length+1),assertCurrent});
     const track=w.tracks.find(track=>track.laneId===job.result.laneId);if(track){w.selectedTracks=new Set([track.index]);w.focusedTrack=track.index;w.selectedClip=null;}
    }else{
     this.status('Importing '+job.file.name+'…');job.result=await e.importSample(job.file,job.targetLaneId||job.createdLaneId||undefined,{startSec:job.startSec||0,assertCurrent,...(job.targetLaneId?{deferAttach:true}:{})});assertCurrent();const clip=e.project?.audioClips?.find(clip=>(clip.cloudId||clip.id)===job.result.clipId);if(!clip)throw new Error('The imported audio has not reached the visible project.');w.selectedTracks=new Set([clip.track]);w.focusedTrack=clip.track;w.selectedClip=clip.id;imported=true;
    }
    this.status(job.kind==='track'?'Verifying new audio track…':'Verifying imported audio…');if(job.targetLaneId){const after=await w.clipboard.read(w.clipboard.context());assertCurrent();w.geometryHistory.registerDropImport({context:w.clipboard.context(),before:job.dropBefore,after,clipId:job.result.clipId,nativeDeferred:job.result.attachDeferred===true});job.phase='complete';if(job.result.attachDeferred)job.attachTask=this.attachInBackground(job);}else{await w.importHistory?.captureJob(job);job.phase='complete';this.finishHistoryBatch(job);}this.status(job.kind==='track'?'Audio track added.':'Imported '+job.file.name+' into the live timeline.');this.onImported?.(job);w.render?.();
   }catch(error){if(!job.targetLaneId&&!await this.releaseRejectedImport(job,error)&&!await this.releaseRejectedTrack(job,error))await w.importHistory?.interrupt(job,error);job.error=error;job.trackAttempt=error.trackAttempt;job.importRecord=error.importRecord;job.phase=error.importRecord?.phase||((job.creationDispatched||error.trackReceipt)?'uncertain':'failed');w.onError(error);if(job.historyNotDispatched===true){this.finishHistoryBatch(job);continue;}break;}
   finally{job.placeholder?.remove();job.placeholder=null;this.active=null;w.busy=false;w.root.ownerDocument.body.classList.remove('au-cloud-busy');w.lanePan?.sync?.();this.renderRecovery();}
  }
  if(imported&&!this.records.at(-1)?.targetLaneId)w.fit?.(false);
 }
 destroy(){if(this.bound){const doc=this.bound.ownerDocument;doc.removeEventListener('pointerup',this.resumeGesture,true);doc.removeEventListener('pointercancel',this.resumeGesture,true);doc.defaultView.removeEventListener('blur',this.resumeGesture);this.bound.removeEventListener('dragenter',this.dragOver);this.bound.removeEventListener('dragover',this.dragOver);this.bound.removeEventListener('dragleave',this.dragLeave);this.bound.removeEventListener('drop',this.drop,true);this.bound.classList.remove('au-file-drop');this.bound=null;}this.input?.remove();this.input=null;this.recovery?.remove();this.recovery=null;}
}
