/** A clicked audio clip's cursor split. Plan on its lane without mutation,
 * then apply only its server-generated parent/child operations, even when
 * other clips overlap that cursor. Never replay a sent mutation.
 */
import {assertCompleteCanonicalData} from './cloud-session.js';
import {CloudRangeEditController,validateClipBatchOps,unwrapClipEditResult} from './cloud-range-edits.js';
const copy=value=>value==null?value:structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// WebRTC/canonical refreshes can reallocate worker track/clip IDs. Slice uses
// durable lane/take IDs, so only those ephemeral projection fields are ignored.
const sameClip=(a,b)=>{const durable=clip=>{if(!clip||typeof clip!=='object')return clip;const{cloudRuntime,engineClipId,engineTrackId,...rest}=clip;return rest;};return same(durable(a),durable(b));};
const finite=value=>typeof value==='number'&&Number.isFinite(value),id=value=>typeof value==='string'&&value.length>0&&value.length<=64;
const near=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=Math.max(1e-9,Math.abs(a)*1e-12,Math.abs(b)*1e-12);
const scopeProject=project=>project?.cloud?.projectId||project?.id;
// Round 15: the history checkpoint compares what an audio edit changes (identity,
// lane, stored window, gain, mute, source), at Freestyle's storage precision
// (whole ms, 6-decimal seconds). Volatile row metadata (updatedAt, editUrl,
// isImported, a receipt-painted vs read row, a 9.0726666… → 9.072667 re-read)
// is not an edit and must not make Undo/Redo ask for a reload.
const storedMs=value=>finite(Number(value))?Math.round(Number(value)):null,storedSec=value=>finite(Number(value))?Math.round(Number(value)*1e6)/1e6:null;
export function audioEditCheckpoint(project){
 return JSON.stringify((project?.audioClips||[]).map(clip=>{const raw=clip?.cloudRaw||{};return[clip.id,clip.cloudId,clip.laneId??raw.laneId,storedMs(raw.startMs),storedSec(raw.durationSec),storedSec(raw.audioOffsetSec??raw.effects?.timing?.audioOffsetSec),clip.offsetKnown===true,raw.volume??clip.volume??null,!!(raw.muted??clip.mute),!!raw.clipMuted,raw.audioFileId??raw.sourceId??null];}).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
}
const checkpoint=audioEditCheckpoint;
function timing(clip,bpm){
 const raw=clip?.cloudRaw;assertCompleteCanonicalData(raw,'audio slice source');
 const offset=[raw?.audioOffsetSec,raw?.effects?.timing?.audioOffsetSec].find(value=>finite(value)&&value>=0),spb=60/bpm;
 if(!id(clip?.cloudId)||clip.id!==clip.cloudId||raw?.id!==clip.cloudId||!id(clip.laneId)||raw.laneId!==clip.laneId||!finite(bpm)||bpm<=0||!finite(raw.startMs)||raw.startMs<0||!finite(raw.durationSec)||raw.durationSec<=0||clip.offsetKnown!==true||offset===undefined||!near(clip.start*spb*1000,raw.startMs)||!near(clip.length*spb,raw.durationSec)||!near(clip.offset*spb,offset))throw new Error('Reload the clicked audio clip’s exact identity, source offset and timing before slicing.');
 return{start_ms:raw.startMs,duration_sec:raw.durationSec,audio_offset_sec:offset};
}
function matches(actual,expected){return ['start_ms','duration_sec','audio_offset_sec'].every(key=>near(actual?.[key],expected?.[key]));}
// Freestyle plans and stores whole-millisecond starts and 6-decimal seconds
// (live 2026-11-10T23:24Z dry-run on a 9.072666666666667 s clip: expected
// duration 9.072667, cut 3333.33 → 3333, left 3.333 s). Plan checks allow that
// storage rounding and nothing more; the source-window intent is unchanged.
const STORED_MS=.500001,STORED_SEC=1.000001e-6;
const storedNear=(a,b,tolerance)=>finite(a)&&finite(b)&&Math.abs(a-b)<=tolerance;
function storedMatches(actual,expected){return storedNear(actual?.start_ms,expected?.start_ms,STORED_MS)&&storedNear(actual?.duration_sec,expected?.duration_sec,STORED_SEC)&&storedNear(actual?.audio_offset_sec,expected?.audio_offset_sec,STORED_SEC);}
export function selectedAudioSlicePlan(payload,{project,clip,cutMs}={}){
 assertCompleteCanonicalData(payload,'audio slice dry-run');
 if(payload?.dry_run!==true||payload.applied!==false||payload.operation!=='split'||!storedNear(payload.start_ms,cutMs,1e-6)||!storedNear(payload.end_ms,cutMs,1e-6)||!Array.isArray(payload.ops)||!Array.isArray(payload.inverse_ops))throw new Error('Freestyle returned no exact nonmutating cursor-split plan.');
 for(const key of ['project_id','projectId'])if(payload[key]!==undefined&&payload[key]!==scopeProject(project))throw new Error('The audio slice plan belongs to another project.');
 const before=timing(clip,project.bpm),selected=payload.ops.filter(op=>op.id===clip.cloudId||op.op==='insert'&&op.source_id===clip.cloudId);
 if(!selected.length)return{noop:true,ops:[],inverseOps:[],before,clipId:clip.cloudId};
 const ops=validateClipBatchOps(selected),parent=ops.filter(op=>op.op==='update'&&op.id===clip.cloudId),children=ops.filter(op=>op.op==='insert'&&op.source_id===clip.cloudId);
 if(ops.length!==2||parent.length!==1||children.length!==1)throw new Error('The clicked audio source did not produce one unambiguous parent/child split.');
 const left=parent[0],right=children[0],known=new Set((project.audioClips||[]).flatMap(clip=>[clip.id,clip.cloudId]));
 if(known.has(right.id)||!storedMatches(left.expected,before)||!storedMatches(right.expected,before)||!storedNear(left.start_ms,before.start_ms,STORED_MS)||!storedNear(left.audio_offset_sec,before.audio_offset_sec,STORED_SEC)||!storedNear(left.start_ms+left.duration_sec*1000,right.start_ms,STORED_MS)||!storedNear(left.duration_sec+right.duration_sec,before.duration_sec,2*STORED_SEC)||Math.abs(right.start_ms-cutMs)>STORED_MS||Math.abs(right.audio_offset_sec-(before.audio_offset_sec+left.duration_sec))>STORED_SEC)throw new Error('The generated audio slice changed its source window or no longer matches the canonical clicked clip.');
 const inverseOps=validateClipBatchOps(payload.inverse_ops.filter(op=>op.id===left.id||op.id===right.id)),remove=inverseOps.find(op=>op.op==='remove'&&op.id===right.id),restore=inverseOps.find(op=>op.op==='update'&&op.id===left.id);
 if(inverseOps.length!==2||!remove||!restore||!matches(remove.expected,right)||!storedMatches(restore,before)||!matches(restore.expected,left))throw new Error('Freestyle returned no exact inverse for the selected audio split.');
 return{noop:false,clipId:clip.cloudId,childId:right.id,before,left:copy(left),right:copy(right),ops,inverseOps};
}
/** Undo soft-deletes the child. Redo restores that identity from the still-live
 * parent, checking the deleted child's retained window rather than replaying
 * the insert's expected source-parent window. Prefer an exact native inverse.
 */
export function audioSliceRedoOps(plan,undoReceipt){
 const native=undoReceipt?.undo?.inverse_ops;let ops;
 // The server's own inverse may restore the soft-deleted child by id alone
 // (no source_id/expected): it is server-authored, so validate it as such.
 if(native!=null)ops=validateClipBatchOps(native,{serverAuthoredInverse:true});
 else{const removed=plan.inverseOps.find(op=>op.op==='remove'&&op.id===plan.childId);if(!removed||!matches(removed.expected,plan.right))throw new Error('The deleted audio child has no retained timing for Redo.');ops=validateClipBatchOps(plan.ops.map(op=>op.op==='insert'?{...copy(op),op:'restore',expected:copy(removed.expected)}:copy(op)));}
 const parent=ops.filter(op=>op.op==='update'&&op.id===plan.clipId),children=ops.filter(op=>op.op==='restore'&&op.id===plan.childId&&(op.source_id===plan.clipId||native!=null&&op.source_id===undefined));
 if(ops.length!==2||parent.length!==1||children.length!==1||!matches(parent[0],plan.left)||!storedMatches(parent[0].expected,plan.before)||!storedMatches(children[0],plan.right)||children[0].expected!==undefined&&!storedMatches(children[0].expected,plan.right)||native==null&&children[0].expected===undefined)throw new Error('The audio Undo receipt has no exact selected-source Redo plan. Reload and inspect it; no replacement plan will be guessed.');return ops;
}

export class AudioSliceController{
 constructor({getProject,getScope=()=>null,flush=async()=>{},cloudCall,refresh=async()=>{},onChange=()=>{},createIdempotencyKey=()=>globalThis.crypto.randomUUID()}={}){
  Object.assign(this,{getProject,getScope,flush,cloudCall,refresh,onChange,createIdempotencyKey});this.busy=false;this.controller=null;this.attempts=[];
  this.state={status:'idle',scope:null,clipId:null,cutMs:null,request:null,dryRunReceipt:null,plan:null,receipt:null,error:null,confirmed:false,inspected:false,applied:false,checkpoint:null};
 }
 capture(){const project=this.getProject();return{projectId:scopeProject(project),trackId:project?.cloud?.trackId??null,bpm:project?.bpm,epoch:copy(this.getScope())};}
 current(){try{return same(this.capture(),this.state.scope);}catch{return false;}}
 notify(){this.onChange(this.snapshot());}
 snapshot(){const inner=this.controller?.snapshot(),unchanged=this.current()&&this.state.checkpoint===checkpoint(this.getProject());let canRedo=false,redoUnavailableReason=null;if(!this.busy&&unchanged&&this.state.confirmed&&!this.state.applied&&inner?.status==='undone'){try{audioSliceRedoOps(this.state.plan,this.state.undoReceipt??inner.undoReceipt);canRedo=true;}catch(error){redoUnavailableReason=error.message;}}return copy({...this.state,busy:this.busy,detached:!!this.state.scope&&!this.current(),uncertain:inner?.status==='uncertain'||this.state.status==='uncertain',needsInspection:!!this.controller&&!this.state.inspected&&!this.state.confirmed,canUndo:!this.busy&&unchanged&&this.state.confirmed&&this.state.applied&&inner?.canUndo===true,canRedo,redoUnavailableReason,controller:inner??null,attempts:this.attempts.map(controller=>controller.snapshot())});}
 assertCurrent(){if(!this.current())throw Object.assign(new Error('The project or engine context changed during the audio slice.'),{name:'AbortError',code:'audio_slice_scope_changed'});}
 createController({mode='split',originalClip}={}){
  const controller=new CloudRangeEditController({getProject:this.getProject,getScope:()=>({epoch:this.getScope(),bpm:this.getProject()?.bpm}),cloudCall:this.cloudCall,flush:async()=>{await this.flush();this.assertCurrent();if(this.state.checkpoint!==null){if(this.state.checkpoint!==checkpoint(this.getProject()))throw new Error('Audio changed after this slice. Reload before using its retained history.');}else if(!sameClip(originalClip,(this.getProject().audioClips||[]).find(item=>item.id===this.state.clipId)))throw new Error('The clicked audio clip changed before its slice commit.');},onChange:()=>this.notify(),onCommitted:async(payload,context)=>{this.state.applied=context.operation!=='inverse';this.state.receipt=copy(payload);if(context.operation==='inverse')this.state.undoReceipt=copy(payload);else if(mode==='redo')this.state.redoReceipt=copy(payload);this.state.confirmed=false;await this.refresh(copy(payload),copy(context));this.assertCurrent();this.confirm();}});
  this.controller=controller;this.attempts.push(controller);return controller;
 }
 async split({clipId,beat}={}){
  if(this.busy||this.state.status!=='idle')throw new Error('This audio slice request cannot be repeated. Reload its retained state.');
  const project=this.getProject(),clip=copy((project?.audioClips||[]).find(item=>item.id===clipId));if(!clip)throw new Error('Select an existing audio clip.');
  const before=timing(clip,project.bpm),cutMs=beat*60000/project.bpm;if(!finite(beat)||!finite(cutMs)||cutMs<=before.start_ms||cutMs>=before.start_ms+before.duration_sec*1000)throw new Error('Choose a slice position inside the clicked audio clip.');
  this.state={...this.state,status:'planning',scope:this.capture(),clipId,cutMs};this.busy=true;this.notify();
  try{
   await this.flush();this.assertCurrent();if(!sameClip(clip,(this.getProject().audioClips||[]).find(item=>item.id===clipId)))throw new Error('The clicked audio clip changed before its slice preview.');
   const request={project_id:this.state.scope.projectId,...this.state.scope.trackId?{track_id:this.state.scope.trackId}:{},lane_ids:[clip.laneId],operation:'split',start_ms:cutMs,end_ms:cutMs,ripple:false,idempotency_key:this.createIdempotencyKey(),dry_run:true};
   this.state.request=copy(request);const payload=unwrapClipEditResult(await this.cloudCall('edit_time_range',request));this.state.dryRunReceipt=copy(payload);this.assertCurrent();
   if(!sameClip(clip,(this.getProject().audioClips||[]).find(item=>item.id===clipId)))throw new Error('The clicked audio clip changed during its slice preview.');
   const plan=selectedAudioSlicePlan(payload,{project:this.getProject(),clip,cutMs});this.state.plan=copy(plan);if(plan.noop){this.state.status='noop';this.busy=false;return this.snapshot();}
   this.createController({originalClip:clip});
   this.state.status='committing';this.notify();await this.controller.applyBatch(plan.ops,{inverseOps:plan.inverseOps});this.adoptStatus();this.busy=false;return this.snapshot();
  }catch(error){this.state.error=error.message;this.adoptStatus('planning-failed');throw error;}finally{this.busy=false;this.notify();}
 }
 confirm(){
  const project=this.getProject(),plan=this.state.plan,parent=(project.audioClips||[]).find(clip=>clip.cloudId===plan.clipId),child=(project.audioClips||[]).find(clip=>clip.cloudId===plan.childId);
  if(!parent||!storedMatches(timing(parent,project.bpm),this.state.applied?plan.left:plan.before)||(this.state.applied?(!child||!matches(timing(child,project.bpm),plan.right)):!!child))throw new Error('Freestyle acknowledged the audio slice, but canonical parent/child timing is not confirmed. Reload its state; the slice will not repeat.');
  this.state.confirmed=true;this.state.checkpoint=checkpoint(project);this.state.error=null;
 }
 adoptStatus(fallback){const inner=this.controller?.snapshot();if(!inner){if(fallback)this.state.status=fallback;return;}this.state.receipt=copy((inner.operation==='inverse'?inner.undoReceipt:inner.receipt)??this.state.receipt);this.state.status=inner.status==='committed'?(this.state.confirmed?'committed':'committed-unconfirmed'):inner.status;this.state.applied=inner.applied;this.state.error=inner.error||inner.refreshError||this.state.error;}
 async undo(){
  if(!this.snapshot().canUndo)throw new Error('Reload the unchanged audio split before undoing.');this.busy=true;this.state.confirmed=false;this.state.inspected=false;this.state.status='undoing';this.notify();
  try{await this.controller.applyInverse();this.adoptStatus();this.busy=false;return this.snapshot();}catch(error){this.state.error=error.message;this.adoptStatus();throw error;}finally{this.busy=false;this.notify();}
 }
 async redo(){
  const state=this.snapshot();if(!state.canRedo)throw new Error(state.redoUnavailableReason||'Reload the unchanged acknowledged audio Undo before redoing.');const ops=audioSliceRedoOps(this.state.plan,this.state.undoReceipt??state.controller.undoReceipt);this.busy=true;this.state.confirmed=false;this.state.inspected=false;this.state.status='redoing';const controller=this.createController({mode:'redo'});this.notify();
  try{await controller.applyBatch(ops,{inverseOps:this.state.plan.inverseOps,serverAuthoredOps:true});this.adoptStatus();this.busy=false;return this.snapshot();}catch(error){this.state.error=error.message;this.adoptStatus();throw error;}finally{this.busy=false;this.notify();}
 }
 async reload(){
  if(this.busy)throw new Error('Wait for the current audio slice request.');this.assertCurrent();this.busy=true;this.notify();
  try{await this.refresh();this.assertCurrent();this.state.inspected=true;if(this.controller?.state.applied||this.controller?.state.status==='undone'){this.confirm();this.controller.state.refreshError=null;}this.adoptStatus();this.busy=false;return this.snapshot();}catch(error){this.state.error=error.message;throw error;}finally{this.busy=false;this.notify();}
 }
}
