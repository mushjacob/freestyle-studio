import {retainInProgress,isIdempotencyInProgress,replayKnownBusyWrite} from './cloud-errors.js';
import {EnvelopeHistoryController,envelopeHistoryMatches} from './audacity-envelope-history.js';
import {canonicalEnvelopeClipId} from './audacity-envelope.js';
import {automationReadbackDifferences,assertAutomationJsonValue} from './audacity-automation-contract.js';
const copy=value=>structuredClone(value);
const scope=w=>w.getProject()?.cloud?.projectId||w.getProject()?.id;
const unsettled=new Set(['uncertain','unverified','mismatched']);
const windowKey=window=>JSON.stringify(['clipId','timelineStartSec','durationSec','pointStartSec','pointEndSec','timeDomain','sourceStartSec','sourceEndSec','sourceDurationSec','offsetKnown','waveformRevision'].map(key=>window?.[key]));
function terminalReceipt(raw){assertAutomationJsonValue(raw);let data=raw?.structuredContent??raw;if(data===raw&&Array.isArray(raw?.content))data=JSON.parse(raw.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));const value=data?.response??data;if(raw?.isError||value?.error||value?.ok===false||isIdempotencyInProgress(raw))throw Object.assign(new Error(typeof value?.error==='string'?value.error:value?.message||'Freestyle has not acknowledged this envelope save.'),{result:raw});return value;}
function binding(clip,bpm){const raw=clip.cloudRaw||{};return JSON.stringify([canonicalEnvelopeClipId(clip),bpm,clip.patternId,clip.laneId,clip.track,clip.start,clip.length,clip.offset,clip.offsetKnown,clip.sourceLength,clip.volume,clip.audioFileId,clip.sourceId,raw.audioFileId,raw.audio_file_id,raw.audioSourceId,raw.sourceId,raw.source_id,raw.audioOffsetSec,raw.audioFullDurationSec,raw.effects?.timing,raw.loopPhaseMs,typeof raw.audioUrl==='string'?raw.audioUrl.split('?')[0]:null]);}

/** Workspace adapter for inline F2 receipts only. The modal remains outside
 * this ownership facade. All history writes are explicit Undo/Redo requests.
 */
export class AudacityEnvelopeHistory{
 constructor(view){
  this.view=view;this.w=view.workspace;
  this.controller=new EnvelopeHistoryController({captureContext:()=>this.context(),assertContext:context=>this.assertContext(context),getClip:id=>this.clip(id),getBinding:clip=>binding(clip,this.w.getProject().bpm),resolveWindow:clip=>view.resolveWindow(clip,this.w.getProject().bpm),read:clip=>view.controller.read(clip,view.controller.scope()),cloudCall:(name,args)=>this.w.engine.session.call(name,args),prepareWrite:()=>this.w.engine.flush(),getContract:()=>view.automationContract()});
  this.past=this.controller.past;this.future=this.controller.future;
 }
 context(){const w=this.w,e=w.engine;return {projectId:scope(w),engineProjectId:e.projectId??null,sessionProjectId:e.session?.projectId??null,trackId:e.session?.trackId??null,loadVersion:e.loadVersion??0,contextVersion:e.session?.contextVersion??0};}
 assertContext(context){if(!this.view.readAvailable()||JSON.stringify(context)!==JSON.stringify(this.context()))throw new Error('The cloud project/session context changed since this envelope edit.');}
 clip(id){return this.view.clips().find(clip=>canonicalEnvelopeClipId(clip)===id);}
 directReceipts(id=scope(this.w)){return this.view.controller.writeReceipts.filter(receipt=>receipt.projectId===id&&unsettled.has(receipt.status));}
 uncertain(id=scope(this.w)){return this.controller.uncertain(id)||this.directReceipts(id).some(receipt=>receipt.status==='uncertain');}
 unverified(id=scope(this.w)){return this.controller.unverified(id)||this.directReceipts(id).some(receipt=>receipt.status!=='uncertain');}
 clearFuture(id=scope(this.w)){this.controller.clearFuture(id);}
 register(receipt){const {entry,added}=this.controller.register(receipt);if(added)this.w.registerEnvelopeHistory?.(entry);return entry;}
 assertSettled(){if(this.uncertain()||this.unverified())throw new Error('Verify the previous envelope save or history receipt before another gain edit.');}
 async lock(fn){const w=this.w,e=w.engine;if(w.busy||e.interacting||e.applying||e.playing||w.paused||e.recorder?.recording||w.clipGesture||w.selectionGesture?.active||this.view.active||w.loopRegion?.active||w.trackLayout?.active||w.amplitudeView?.active||w.multiToolView?.active||w.groupMoves?.active||w.panGesture||w.viewport?.pinDrag)throw new Error('Stop audio and finish the current edit before restoring a gain envelope.');w.busy=true;w.root?.ownerDocument?.body.classList.add('au-cloud-busy');try{await this.view.controller.saveQueue;return await fn();}finally{w.busy=false;w.root?.ownerDocument?.body.classList.remove('au-cloud-busy');}}
 async refresh(clipId,record){
  try{const clip=this.clip(clipId);if(clip){await this.view.controller.load(clip,{force:true});this.view.paint(clip);}this.w.engine.onStatus?.('Envelope history saved and verified.');}
  catch(error){if(record)record.refreshError=error.message;this.w.onError(new Error('Envelope history was verified, but refreshing its visible gain envelope failed: '+error.message));}
 }
 async history(direction){return this.lock(async()=>{this.assertSettled();const record=await this.controller.history(direction);if(!record)return false;await this.refresh(record.entry.clipId,record);return true;});}
 async reconcile(){return this.lock(async()=>{
  const id=scope(this.w);
  if(this.controller.pending.has(id)){const result=await this.controller.reconcile({beforeFinish:record=>this.w.envelopeHistoryReconciled?.(record)});if(result.applied)await this.refresh(result.record.entry.clipId,result.record);return result;}
  const receipt=this.directReceipts(id).at(-1);if(!receipt)throw new Error('There is no unverified inline envelope receipt to check.');if(!receipt.before)throw new Error('This older envelope receipt has no exact before snapshot for owned history.');const clip=this.clip(receipt.clipId),assertCurrent=()=>{if(!clip||receipt.context!==this.view.readContext()||receipt.clipBinding!==this.view.binding(clip)||windowKey(receipt.window)!==windowKey(this.view.resolveWindow(clip,this.w.getProject().bpm)))throw new Error('The original envelope save context or clip source changed.');};assertCurrent();
  if(receipt.idempotencyInProgress){try{const recovered=await replayKnownBusyWrite({knownBusy:true,request:receipt.request,call:(name,args)=>this.w.engine.session.call(name,args),assertCurrent,parse:terminalReceipt});receipt.acknowledgement=copy(recovered.raw);receipt.terminalAcknowledged=true;receipt.idempotencyInProgress=false;receipt.status='unverified';}catch(error){retainInProgress(receipt,error);receipt.reason=error.message;throw error;}}
  const saved=await this.view.controller.read(clip,this.view.controller.scope());if(receipt.context!==this.view.readContext()||receipt.clipBinding!==this.view.binding(clip))throw new Error('The envelope context changed during verification.');assertAutomationJsonValue(saved);receipt.reconciledReadback=copy(saved);
  if(saved.persisted&&typeof saved.id==='string'&&saved.id&&Number.isSafeInteger(saved.revision)&&!automationReadbackDifferences(receipt.request,saved).length){receipt.status='verified';receipt.after=copy(saved);receipt.readback=copy(saved);this.register(receipt);await this.refresh(receipt.clipId,receipt);return {record:receipt,applied:true};}
  if(!receipt.terminalAcknowledged&&envelopeHistoryMatches(saved,receipt.before)){receipt.status='not-applied';await this.refresh(receipt.clipId,receipt);return {record:receipt,applied:false};}
  throw new Error('The saved envelope matches neither the original state nor the requested edit. No mutation was retried.');
 });}
}
