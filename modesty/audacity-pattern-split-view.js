import {PatternSplitController} from './pattern-split.js';
import {assertCompleteCanonicalData} from './cloud-session.js';

const scope=w=>w.getProject()?.cloud?.projectId||w.getProject()?.id;
const body=result=>result?.response??result;
const transient=new Set(['updatedAt','updated_at','createdAt','created_at','revision','cursorSec','cursor_sec','projectUrl','studioUrl','editUrl','audioUrl','audio_url','downloadUrl']);
function stable(value){if(Array.isArray(value))return value.map(stable);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.keys(value).filter(key=>!transient.has(key)).sort().map(key=>[key,stable(value[key])]));}

/** Native split receipts have a separate history from the engine's old undo stack.
 * Only an unchanged, complete cloud checkpoint may be restored here. Mixed
 * histories require an engine history contract rather than an unrelated undo.
 */
export class AudacityPatternSplits {
 constructor(workspace){this.workspace=workspace;this.past=new Map();this.future=new Map();this.pending=new Map();}
 stack(map,id=scope(this.workspace)){if(!map.has(id))map.set(id,[]);return map.get(id);}
 captureContext(projectId=scope(this.workspace)){const engine=this.workspace.engine;return {projectId,trackId:engine.session.trackId,loadVersion:engine.loadVersion||0,contextVersion:engine.session.contextVersion||0};}
 assertContext(captured){const w=this.workspace,engine=w.engine;if(scope(w)!==captured.projectId||engine.loading||engine.projectId&&engine.projectId!==captured.projectId||engine.session.projectId&&engine.session.projectId!==captured.projectId||engine.session.trackId!==captured.trackId||(engine.loadVersion||0)!==captured.loadVersion||(engine.session.contextVersion||0)!==captured.contextVersion)throw new Error('The cloud project context changed while its pattern split was pending. Reload its committed receipt before continuing.');}
 async lock(fn){const w=this.workspace;if(w.busy||w.engine.interacting||w.clipGesture||w.selectionGesture?.active||w.envelopeView?.active)throw new Error('Finish the current edit before splitting or restoring a pattern.');w.busy=true;document.body.classList.add('au-cloud-busy');try{return await fn();}finally{w.busy=false;document.body.classList.remove('au-cloud-busy');}}
 async checkpoint(projectId,captured=this.captureContext(projectId)){
  const w=this.workspace,session=w.engine.session;this.assertContext(captured);
  const [project,placements,automation]=await Promise.all([
   session.call('get_project',{project_id:projectId}),
   session.call('execute_pro_action',{project_id:projectId,track_id:captured.trackId,action:'list_pattern_placements',arguments:{}}),
   session.call('list_automation',{project_id:projectId})
  ]);
  this.assertContext(captured);
  const p=body(project),rows=body(placements),envelopes=body(automation);
  for(const data of [p,rows,envelopes])assertCompleteCanonicalData(data,'pattern split history checkpoint');
  if(!Array.isArray(rows.placements)||!Array.isArray(envelopes.envelopes))throw new Error('Freestyle did not return a complete placement and automation checkpoint.');
  const normalized=w.getProject();
  const curves=envelopes.envelopes.map(({id,updatedAt,revision,...curve})=>curve).sort((a,b)=>String(a.clipId).localeCompare(String(b.clipId))||String(a.targetKey).localeCompare(String(b.targetKey)));
  const editableProject={...(p.project??p)};delete editableProject.timelineRevision;
  return JSON.stringify(stable({project:editableProject,placements:rows.placements.slice().sort((a,b)=>a.id.localeCompare(b.id)),automation:curves,mix:{master:normalized.master,channels:normalized.channels,bpm:normalized.bpm,loop:normalized.loop}}));
 }
 uncertain(projectId){return [this.pending.get(projectId),...this.stack(this.past,projectId).map(entry=>entry.controller),...this.stack(this.future,projectId).map(entry=>entry.controller)].some(controller=>controller?.snapshot().status==='uncertain');}
 async split(){return this.lock(async()=>{
  const w=this.workspace,projectId=scope(w),captured=this.captureContext(projectId);
  if(this.uncertain(projectId))throw new Error('A previous split has an uncertain receipt. Inspect its cloud placements before another split.');
  const controller=new PatternSplitController({getProject:()=>w.getProject(),getPlacement:()=>w.selected(),getCursorSec:()=>w.selection.start,
   flush:async()=>{await w.envelopeView?.controller.saveQueue;await w.engine.flush();this.assertContext(captured);},cloudCall:(name,args)=>{this.assertContext(captured);return w.engine.session.call(name,args);},
   refresh:async(receiptScope,payload)=>{this.assertContext(captured);w.engine.applyPatternSplitReceipt(payload,{...captured,placementId:receiptScope.placementId,childId:receiptScope.childId,operation:receiptScope.operation});await w.envelopeView?.reload();},isInteracting:()=>!!w.engine.interacting});
  this.pending.set(projectId,controller);
  try{
   await controller.split();const entry={controller,context:captured,checkpoint:null};this.stack(this.past,projectId).push(entry);this.stack(this.future,projectId).length=0;
   try{entry.checkpoint=await this.checkpoint(projectId,captured);}catch(error){w.engine.onStatus('Pattern split completed; its history checkpoint is unavailable: '+error.message);return controller.snapshot();}
   w.engine.onStatus('Pattern split completed in Freestyle');return controller.snapshot();
  }finally{if(controller.snapshot().status!=='uncertain')this.pending.delete(projectId);}
 });}
 async history(direction){
  const w=this.workspace,projectId=scope(w),from=direction==='undo'?this.past:this.future,to=direction==='undo'?this.future:this.past,stack=this.stack(from,projectId),entry=stack.at(-1);
  if(this.uncertain(projectId))throw new Error('The pattern split receipt is uncertain. Check cloud state before applying undo or redo.');
  if(!entry)return false;
  return this.lock(async()=>{
   await w.envelopeView?.controller.saveQueue;await w.engine.flush();this.assertContext(entry.context);
   if(!entry.checkpoint||await this.checkpoint(projectId,entry.context)!==entry.checkpoint)throw new Error('Other cloud edits have changed this split checkpoint. Combining pattern-split receipts with the separate engine undo history needs a unified history contract.');
   await entry.controller[direction]();stack.pop();this.stack(to,projectId).push(entry);
   try{entry.checkpoint=await this.checkpoint(projectId,entry.context);}catch(error){entry.checkpoint=null;w.engine.onStatus('Pattern history operation completed; its next checkpoint is unavailable: '+error.message);return true;}
   w.engine.onStatus(direction==='undo'?'Pattern split undone in Freestyle':'Pattern split redone in Freestyle');return true;
  });
 }
 can(direction){const entry=this.stack(direction==='undo'?this.past:this.future).at(-1);if(!entry?.checkpoint||this.workspace.busy||this.uncertain(scope(this.workspace)))return false;try{this.assertContext(entry.context);return true;}catch{return false;}}
}
