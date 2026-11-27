/**
 * Optimistic piano-roll note state over the shared per-pattern document store.
 *
 * The Freestyle Studio persists a pattern edit by writing the whole pattern
 * document ({name,ppq,bars,lengthTicks,swing,pattern:{version,sources,events}}). Modesty uses the
 * published OAuth equivalent, Studio API v1 `PATCH .../patterns/{pattern_id}`
 * (`updatePattern`), through the existing typed adapter — never MCP.
 *
 * Notes apply locally at once. The write itself belongs to
 * PatternDocumentStore (pattern-rack-store.js): ONE serialized, coalesced,
 * retained-intent save queue per pattern, shared with the Pattern Rack, so a
 * note edit and a rack step edit on the same pattern both land in the same
 * document and never overwrite each other. A definite rejection rolls this
 * view back to its last acknowledged notes; an unknown outcome blocks edits on
 * that pattern until the exact original request (same key, same body) is
 * verified.
 */
import {serializeCloudPattern} from './cloud-session.js';
import {sharedPatternDocuments,setChannelNotes} from './pattern-rack-store.js';

const clone=value=>value==null?value:structuredClone(value);
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const scopeKey=(patternId,channelId)=>`${patternId}\u0000${channelId}`;
const fingerprint=notes=>JSON.stringify([...(notes||[])].map(n=>[String(n.id),Math.round(finite(n.pitch,60)),Math.round(finite(n.start)*96000)/96000,Math.round(finite(n.duration)*96000)/96000,Math.round(finite(n.velocity,.8)*1e4)/1e4]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0));
export const notesEqual=(a,b)=>fingerprint(a)===fingerprint(b);
export function editablePattern(pattern){return !!pattern&&pattern.id!=='empty'&&!String(pattern.id).startsWith('local-')&&!!(pattern.cloudId||pattern.cloudRaw);}

export class PianoRollStore extends EventTarget{
 constructor({engine,getProject,serialize=serializeCloudPattern,documents,debounceMs=60,timer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
  super();this.engine=engine;this.getProject=getProject;this.serialize=serialize;
  this.documents=documents||sharedPatternDocuments(engine,getProject,{debounceMs,timer,clearTimer});
  this.overlays=new Map();this.histories=new Map();this.projectId='';
  const on=(type,fn)=>this.documents.addEventListener(type,event=>fn(event.detail||{}));
  on('saved',({patternId,intent})=>{const overlay=this.overlay(patternId);if(!overlay)return;const snap=this.snapshotAt(overlay,intent.seq);overlay.acked=clone(snap.notes);overlay.ackedBars=snap.bars;overlay.ackedSeq=snap.seq;overlay.error=null;overlay.rawAtAck=this.canonicalPattern(overlay).pattern?.cloudRaw||null;overlay.refreshed=false;overlay.snapshots=overlay.snapshots.filter(s=>s.seq>=snap.seq);this.emit('saved',{patternId,intent});});
  on('rejected',detail=>this.rolledBack(detail));
  on('uncertain',detail=>this.emit('uncertain',detail));
  on('status',({patternId})=>this.emit('status',{patternId}));
  on('refreshed',({patternId})=>{const overlay=this.overlay(patternId);if(overlay){overlay.refreshed=true;this.emit('refreshed',{patternId});}});
  // Rack edits on the same document repaint this view live.
  on('change',({patternId,origin})=>{if(origin!=='piano'&&origin!=='rollback')this.emit('change',{patternId,origin});});
 }
 get intents(){return this.documents.intents;}
 emit(type,detail={}){this.dispatchEvent(new CustomEvent(type,{detail}));}
 scope(){
  const projectId=this.engine?.projectId||'';
  if(projectId!==this.projectId){this.overlays.clear();this.histories.clear();this.projectId=projectId;}
  this.documents.scope();return projectId;
 }
 overlay(patternId){return this.overlays.get(String(patternId))||null;}
 /** Notes displayed for this channel: local intent first, canonical otherwise. */
 notes(pattern,channelId){this.scope();const overlay=pattern&&this.overlay(pattern.id);if(overlay&&Object.hasOwn(overlay.notes,channelId))return overlay.notes[channelId];return pattern?.notes?.[channelId]||[];}
 bars(pattern){this.scope();const overlay=pattern&&this.overlay(pattern.id),doc=pattern&&this.documents.has(pattern.id)?this.documents.draft(pattern.id):null;return Math.max(1,finite(doc?.bars,finite(overlay?.bars,finite(pattern?.bars,1))));}
 status(patternId){
  const overlay=this.overlay(patternId);if(!overlay)return {state:'idle'};
  const shared=this.documents.status(patternId);
  if(shared.state==='uncertain')return shared;
  if(shared.state==='saving')return {state:'saving'};
  if(overlay.error)return {state:'error',error:overlay.error};
  return {state:'saved'};
 }
 /** Reject edits whose earlier save outcome is not known. */
 blocked(pattern){
  if(!this.engine?.ready)return 'Select a Freestyle project first.';
  if(!editablePattern(pattern))return 'Create or select a saved Freestyle pattern before editing notes.';
  this.scope();return this.documents.blocked(pattern.id);
 }
 canonicalPattern(overlay){const project=this.getProject?.();return {project,pattern:project?.patterns?.find(p=>p.id===overlay.patternId)};}
 ensure(pattern){
  const id=String(pattern.id);let overlay=this.overlays.get(id);
  if(!overlay){const notes=clone(pattern.notes||{}),bars=finite(pattern.bars,1);overlay={patternId:id,projectId:this.engine.projectId,notes:{},bars,acked:notes,ackedBars:bars,ackedSeq:0,seq:0,error:null,refreshed:false,rawAtAck:null,snapshots:[{seq:0,notes:clone(notes),bars}]};this.overlays.set(id,overlay);}
  return overlay;
 }
 snapshotAt(overlay,seq){let best=overlay.snapshots[0];for(const snap of overlay.snapshots)if(snap.seq<=seq&&snap.seq>=best.seq)best=snap;return best;}
 sourceFor(pattern,channelId,notes){
  const project=this.getProject?.()||{},sourceId=String(pattern.cloudSources?.[channelId]||channelId),doc=this.documents.draft(pattern.id);
  if(doc?.pattern.sources.some(source=>String(source.id)===sourceId))return {sourceId};
  // A channel new to this pattern: derive its canonical source exactly as the
  // existing serializer does, then let the shared document add it.
  const dto=this.serialize({...pattern,steps:{},notes:{[channelId]:notes}},project),source=dto.pattern.sources.find(row=>String(row.id)===sourceId)||dto.pattern.sources.at(-1);
  return {sourceId:String(source?.id||sourceId),source};
 }
 /** Apply a complete replacement note list for one channel. */
 apply(pattern,channelId,nextNotes,{label='Edit notes',history=true}={}){
  this.scope();const reason=this.blocked(pattern);if(reason)return {ok:false,reason};
  const before=clone(this.notes(pattern,channelId)),after=clone(nextNotes||[]);
  if(notesEqual(before,after))return {ok:true,unchanged:true};
  const overlay=this.ensure(pattern),end=Math.max(0,...after.map(n=>finite(n.start)+finite(n.duration,.25)));
  const bars=Math.min(64,Math.max(finite(overlay.bars,finite(pattern.bars,1)),Math.ceil((end-1e-9)/4)||1));
  let source;try{source=this.sourceFor(pattern,channelId,after);}catch(error){return {ok:false,reason:error.message};}
  const result=this.documents.edit(pattern.id,dto=>setChannelNotes(dto,source.sourceId,after,{bars,source:source.source}),{origin:'piano',label});
  if(!result.ok)return {ok:false,reason:result.reason};
  if(!Object.hasOwn(overlay.notes,channelId))overlay.notes[channelId]=clone(pattern.notes?.[channelId]||[]);
  overlay.notes[channelId]=after;overlay.bars=bars;overlay.seq=result.seq;overlay.error=null;overlay.refreshed=false;
  overlay.snapshots.push({seq:result.seq,notes:clone({...overlay.acked,...overlay.notes}),bars});if(overlay.snapshots.length>200)overlay.snapshots.splice(1,overlay.snapshots.length-200);
  if(history){const h=this.history(pattern.id,channelId);h.undo.push({seq:result.seq,label,before,after});if(h.undo.length>200)h.undo.shift();h.redo.length=0;}
  this.emit('change',{patternId:pattern.id,channelId});return {ok:true,seq:result.seq};
 }
 rolledBack({patternId,ackedSeq,intent,error}){
  const overlay=this.overlay(patternId);if(!overlay)return;
  const snap=this.snapshotAt(overlay,ackedSeq||0);overlay.notes=clone(snap.seq?snap.notes:{});overlay.bars=snap.bars;overlay.error=error?.message||String(error);
  for(const [key,h] of this.histories)if(key.startsWith(`${patternId}\u0000`)){h.undo=h.undo.filter(entry=>entry.seq<=(ackedSeq||0));h.redo.length=0;}
  if(!overlay.ackedSeq&&!ackedSeq)this.overlays.delete(String(patternId));
  this.emit('status',{patternId});this.emit('rejected',{patternId,intent,error});this.emit('change',{patternId});
 }
 history(patternId,channelId){const key=scopeKey(patternId,channelId);let h=this.histories.get(key);if(!h){h={undo:[],redo:[]};this.histories.set(key,h);}return h;}
 canUndo(patternId,channelId){return !!this.histories.get(scopeKey(patternId,channelId))?.undo.length;}
 canRedo(patternId,channelId){return !!this.histories.get(scopeKey(patternId,channelId))?.redo.length;}
 /** Undo/Redo are new, separately keyed writes of this channel's earlier notes only. */
 step(pattern,channelId,direction){
  this.scope();const h=this.history(pattern.id,channelId),from=direction==='undo'?h.undo:h.redo,to=direction==='undo'?h.redo:h.undo;
  if(!from.length)return {ok:false,reason:`Nothing to ${direction} in this piano roll.`};
  const entry=from[from.length-1],result=this.apply(pattern,channelId,direction==='undo'?entry.before:entry.after,{history:false});
  if(!result.ok)return result;from.pop();to.push(entry);return {...result,entry};
 }
 undo(pattern,channelId){return this.step(pattern,channelId,'undo');}
 redo(pattern,channelId){return this.step(pattern,channelId,'redo');}
 /** Explicitly verify an unknown save by replaying its exact key and body. */
 async verify(patternId){
  if(!this.documents.status(patternId)?.intent)return {ok:false,reason:'No unconfirmed piano-roll save is waiting.'};
  return this.documents.verify(patternId);
 }
 pending(){return this.documents.pending();}
 /** Drop overlays the canonical project now proves, or that a newer read replaced. */
 reconcile(project=this.getProject?.()){
  this.scope();this.documents.sync();let changed=false;
  for(const overlay of [...this.overlays.values()]){
   if(this.documents.status(overlay.patternId).state==='saving'||this.documents.status(overlay.patternId).state==='uncertain'||!overlay.ackedSeq)continue;
   const pattern=project?.patterns?.find(p=>p.id===overlay.patternId);
   if(!pattern){if(overlay.refreshed){this.overlays.delete(overlay.patternId);changed=true;}continue;}
   const matches=Object.keys(overlay.notes).every(id=>notesEqual(pattern.notes?.[id]||[],overlay.notes[id]));
   if(matches||(overlay.refreshed&&pattern.cloudRaw!==overlay.rawAtAck)){
    this.overlays.delete(overlay.patternId);changed=true;
    if(!matches)this.emit('external',{patternId:overlay.patternId,message:'Freestyle returned a different saved pattern; showing the saved version.'});
   }
  }
  return changed;
 }
}
