import {definiteCloudRejection,isIdempotencyInProgress} from './cloud-errors.js';
import {assertPreviewScheduled} from './preview-clock.js';
import {toggleStep,setSourceFields,removeSource,setBars,renamePattern,addSampleSource,addInstrumentSource,nextPatternName,copyName,emptyPatternBody,placementPayload,placementState,placementCopy,rackChannels} from './pattern-rack-model.js';
import {sharedPatternDocuments,diffPatch,applyPatch,patchEmpty} from './pattern-rack-store.js';
import {projectPlacements,completePlacement,receiptPlacement,canonicalRow} from './pattern-rack-receipts.js';

/**
 * Pattern rack + pattern-placement controller (DOM free).
 *
 * Matches the Freestyle Studio's split of responsibilities: pattern edits are
 * optimistic and owned by the builder (Undo is delegated to the builder),
 * while placement history uses typed inverse writes — an edit re-PATCHes the
 * before/after state, a delete restores with the delete response's
 * {before, restoreToken}, a copy deletes the created placement. Every persisted write is a typed Studio API v1 call
 * through CloudSession.action (no MCP fallback). Non-definite failures retain
 * the exact request and idempotency key for an explicit retry.
 *
 * Pattern documents live in the shared PatternDocumentStore (one save queue
 * per pattern, also used by the piano roll); rack Undo entries are scoped
 * field/source/event patches, so undoing a step never reverts piano notes.
 * Placement writes are projected into the canonical session state from their
 * receipts immediately (identity-known edits optimistically, before the
 * request), and a background refresh reconciles later without blocking edits.
 */
const body=value=>value?.response??value;
const clone=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const uid=()=>globalThis.crypto?.randomUUID?.()||`prack-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const PLACEMENT_ACTIONS=new Set(['create_pattern_placement','update_pattern_placement','delete_pattern_placement']);
const idOf=result=>{const r=body(result)||{};return String(r.placement?.id||r.pattern?.id||r.placementId||r.patternId||r.pattern_id||r.placement_id||r.id||'');};
const restoreOf=result=>{const r=body(result)||{},undo=r.undo||r.response?.undo||result?.undo?.restoreToken&&result.undo||(r.before&&r.restoreToken?r:null);return undo?.before&&undo?.restoreToken?{before:undo.before,restoreToken:undo.restoreToken}:null;};

const timingOf=(result,request)=>{const r=body(result)||{},clip=r.clip||{},start=Number(clip.startMs??r.startMs??request.startMs),duration=Number(clip.durationSec??r.durationSec),offset=Number(clip.audioOffsetSec??clip.audio_offset_sec??0);return Number.isFinite(start)&&duration>0&&offset>=0?{start_ms:start,duration_sec:duration,audio_offset_sec:offset}:null;};

export class PatternRackController extends EventTarget {
  constructor({getProject,engine,documents,record=()=>{},forget=()=>{},onStatus=()=>{},saveDelayMs=120,reconcileDelayMs=2500,timers=globalThis}={}){
    super();
    Object.assign(this,{getProject,engine,record,forget,onStatus,saveDelayMs,reconcileDelayMs,timers});
    this.documents=documents||sharedPatternDocuments(engine,getProject,{debounceMs:saveDelayMs,timer:(fn,ms)=>timers.setTimeout(fn,ms),clearTimer:id=>timers.clearTimeout(id)});
    this.local=new Map();this.past=new Map();this.future=new Map();
    this.mine=new WeakSet();this.batch=null;this.pendingWrite=null;this.uncertainProjects=new Set();this.clipboard=null;this.selectedPattern='';
    this.listener=event=>this.observeAction(event.detail);
    engine?.session?.addEventListener?.('action',this.listener);
    const on=(type,fn)=>this.documents.addEventListener(type,event=>fn(event.detail||{}));
    on('change',({patternId,origin})=>this.changed({patternId,origin,optimistic:origin==='rack'}));
    for(const type of ['status','saved','uncertain','refreshed'])on(type,({patternId})=>this.changed({patternId,kind:'status'}));
    on('rejected',({patternId,ackedSeq,error})=>{this.discardUnsaved(patternId,ackedSeq);this.onStatus(`Freestyle rejected the pattern edit; it was reverted. ${error?.message||''}`.trim());this.changed({patternId});});
  }
  destroy(){this.engine?.session?.removeEventListener?.('action',this.listener);this.timers.clearTimeout(this.reconcileTimer);}
  changed(detail={}){this.dispatchEvent(new CustomEvent('change',{detail}));}
  get session(){return this.engine.session;}
  projectId(){const p=this.getProject();return p?.cloud?.projectId||this.engine.projectId||p?.id||'';}
  assertReady(){
    const e=this.engine,id=this.projectId();
    if(!e?.ready||e.loading||!id||id==='empty'||(e.projectId&&e.projectId!==id))throw new Error('Open a Freestyle cloud project before editing patterns.');
    if(this.pendingWrite)throw new Error('A pattern write has an uncertain receipt. Retry it with its original request before another edit.');
    e.session?.assertNoInProgressWrites?.();return id;
  }
  stack(map,id=this.projectId()){if(!map.has(id))map.set(id,[]);return map.get(id);}

  // ---------------------------------------------------------------- patterns
  patterns(){
    const project=this.getProject()||{},name=(id,fallback)=>this.documents.has(id)?this.documents.draft(id).name:fallback;
    const rows=(project.patterns||[]).filter(p=>p&&p.id!=='empty'&&p.cloudRaw).map(p=>{const id=String(p.cloudId||p.id);return {id,name:name(id,p.name)};});
    for(const [id,entry]of this.local){if(entry.projectId===this.projectId()&&!rows.some(row=>row.id===id))rows.push({id,name:name(id,entry.body.name)});}
    return rows;
  }
  sourcePattern(id){const project=this.getProject()||{};return (project.patterns||[]).find(p=>String(p.cloudId||p.id)===String(id)&&p.cloudRaw);}
  dto(id){
    id=String(id||'');if(!id)throw new Error('Create or choose a pattern first.');
    if(!this.documents.has(id)&&!this.sourcePattern(id)&&this.local.has(id))this.documents.adopt(id,this.local.get(id).body);
    const doc=this.documents.draft(id);if(!doc)throw new Error('That pattern is not in the open cloud project.');return doc;
  }
  channels(id){return rackChannels(this.dto(id));}
  /** Adopt newer canonical reads (never a stale pre-save read) and prune local creations. */
  sync(){
    const id=this.projectId();this.documents.sync();
    for(const [key,entry]of this.local){if(entry.projectId!==id||this.sourcePattern(key))this.local.delete(key);}
    if(this.selectedPattern&&!this.patterns().some(p=>p.id===this.selectedPattern))this.selectedPattern='';
    if(!this.selectedPattern)this.selectedPattern=this.patterns()[0]?.id||'';
  }
  uncertainPattern(){for(const pattern of this.patterns())if(this.documents.status(pattern.id).state==='uncertain')return pattern.id;return '';}
  status(){
    if(this.pendingWrite)return {kind:'uncertain',message:this.pendingWrite.message};
    const pending=this.uncertainPattern();if(pending)return {kind:'uncertain',message:`Pattern save unconfirmed (${this.documents.status(pending).error||'unknown result'}). Retry sends the original request.`};
    const s=this.selectedPattern?this.documents.status(this.selectedPattern):{state:'idle'};
    if(s.state==='error')return {kind:'error',message:s.error};
    if(s.state==='saving'||this.documents.pending())return {kind:'saving',message:'Saving pattern…'};
    return {kind:'saved',message:'Saved in Freestyle'};
  }

  /** Optimistic edit of the shared document; a scoped patch becomes the Undo entry. */
  edit(patternId,mutate,label='Pattern edit'){
    const projectId=this.assertReady();this.dto(patternId);
    const result=this.documents.edit(patternId,mutate,{origin:'rack',label});
    if(!result.ok){if(result.error)throw result.error;throw new Error(result.reason);}
    if(result.unchanged)return false;
    const patch=diffPatch(result.before,result.after);if(patchEmpty(patch))return false;
    this.push(projectId,{type:'pattern',patternId:String(patternId),patch,seq:result.seq,label});return true;
  }
  toggleStep(patternId,sourceId,step,on){return this.edit(patternId,dto=>toggleStep(dto,sourceId,step,on),'Toggle step');}
  setChannel(patternId,sourceId,fields){return this.edit(patternId,dto=>setSourceFields(dto,sourceId,fields),'Channel setting');}
  removeChannel(patternId,sourceId){return this.edit(patternId,dto=>removeSource(dto,sourceId),'Remove channel');}
  setBars(patternId,bars){return this.edit(patternId,dto=>setBars(dto,bars),'Pattern length');}
  rename(patternId,name){return this.edit(patternId,dto=>renamePattern(dto,name),'Rename pattern');}
  addSample(patternId,sample){return this.edit(patternId,dto=>addSampleSource(dto,sample),'Add sample channel');}
  addInstrument(patternId,lane){return this.edit(patternId,dto=>addInstrumentSource(dto,lane),'Add instrument channel');}

  /** Complete every scheduled pattern save (Play, placement and history barriers). */
  flush(patternId){return this.documents.flush(patternId);}
  hasUnsaved(){return this.documents.pending();}
  /** Drop rack Undo entries the server never accepted (shared rollback). */
  discardUnsaved(patternId,ackedSeq=0){
    for(const projectId of [this.projectId()]){
      const past=this.stack(this.past,projectId);
      for(let index=past.length-1;index>=0;index--){const entry=past[index];if(entry.type!=='pattern'||entry.patternId!==String(patternId)||entry.seq<=ackedSeq)continue;past.splice(index,1);this.forget(entry,projectId,past.length-index);}
    }
  }
  /** Background canonical reconcile; never blocks edits and retries while busy. */
  scheduleReconcile(){
    this.timers.clearTimeout(this.reconcileTimer);
    this.reconcileTimer=this.timers.setTimeout(()=>{const e=this.engine;if(e.applying||e.pending||e.interacting||this.documents.pending())return this.scheduleReconcile();Promise.resolve(this.session?.refresh?.()).then(()=>{this.sync();this.changed();},error=>this.onStatus(`Saved; the background project refresh failed: ${error.message}`));},this.reconcileDelayMs);
  }

  /**
   * One typed write. A non-definite failure retains the exact request + key;
   * retryPending() replays that same intent and never invents a new key.
   */
  async write(name,args,{label=name,destructive=false,key=uid(),onResult}={}){
    const projectId=this.projectId(),request={name,args:clone(args),key,destructive,label,projectId};
    const payload=clone(args);this.mine.add(payload);
    try{const result=await this.session.action(name,payload,{refresh:false,idempotencyKey:key,confirmedDestructive:destructive});onResult?.(result);return result;}
    catch(error){
      if(!definiteCloudRejection(error)||isIdempotencyInProgress(error)){this.pendingWrite={...request,onResult,message:`${label}: the cloud receipt is uncertain (${error.message}). Retry sends the original request.`};this.uncertainProjects.add(projectId);this.changed();}
      throw error;
    }
  }
  async retryPending(){
    const record=this.pendingWrite;
    if(!record){const pattern=this.uncertainPattern();if(!pattern)return null;const result=await this.documents.verify(pattern);this.changed();if(!result.ok)throw new Error(result.error||result.reason||'The pattern save is still unconfirmed.');return result;}
    if(record.projectId!==this.projectId())throw new Error('Return to the pending write’s original project before retrying it.');
    const payload=clone(record.args);this.mine.add(payload);
    // An idempotency_in_progress receipt is retained by CloudSession itself;
    // its verifier replays that exact request/key. Otherwise replay ours.
    const replay=async()=>{if(this.session.hasInProgressWrite?.()){const recovered=await this.session.verifyInProgressWrite();return body(recovered?.recoveryReceipt)??recovered;}return this.session.action(record.name,payload,{refresh:false,idempotencyKey:record.key,confirmedDestructive:record.destructive});};
    let result;try{result=await replay();}
    catch(error){if(definiteCloudRejection(error)&&!isIdempotencyInProgress(error)){this.pendingWrite=null;this.uncertainProjects.delete(record.projectId);this.changed();}throw error;}
    this.pendingWrite=null;this.uncertainProjects.delete(record.projectId);
    record.onResult?.(result);this.scheduleReconcile();this.changed();return result;
  }

  async createPattern(name){
    const projectId=this.assertReady(),body=emptyPatternBody(name||nextPatternName(this.patterns()));
    return this.createFrom(projectId,body,'New pattern');
  }
  async clonePattern(patternId){
    const projectId=this.assertReady();await this.flush(patternId);const source=this.dto(patternId);
    const body={...clone(source),name:copyName(source.name,this.patterns())};return this.createFrom(projectId,body,'Clone pattern');
  }
  async createFrom(projectId,dto,label){
    let id='';const result=await this.write('create_pattern',{pattern:dto},{label,onResult:r=>{id=idOf(r);}});id=id||idOf(result);
    if(!id)throw new Error('Freestyle created the pattern without returning its id. Refresh the project before editing it.');
    this.local.set(id,{projectId,body:clone(dto)});this.documents.adopt(id,dto);this.selectedPattern=id;
    this.push(projectId,{type:'pattern-create',patternId:id,body:clone(dto),label});this.scheduleReconcile();this.changed({patternId:id});return id;
  }
  placementsOf(patternId){return (this.getProject()?.clips||[]).filter(c=>String(c.patternId)===String(patternId)||String(c.cloudRaw?.patternId)===String(patternId));}
  async deletePattern(patternId){
    const projectId=this.assertReady();
    if(this.placementsOf(patternId).length)throw new Error('Delete this pattern’s timeline clips first. Freestyle soft-deletes a pattern only after its placements are removed.');
    await this.flush(patternId);const dto=clone(this.dto(patternId));
    await this.write('delete_pattern',{pattern_id:patternId},{label:'Delete pattern',destructive:true});
    this.documents.forgetPattern(patternId);this.local.delete(String(patternId));if(this.selectedPattern===String(patternId))this.selectedPattern='';
    this.push(projectId,{type:'pattern-delete',patternId:String(patternId),body:dto,label:'Delete pattern'});this.scheduleReconcile();this.changed();return true;
  }
  async listSamples(){
    const projectId=this.assertReady(),seen=new Map();
    for(const pattern of this.patterns()){try{for(const source of this.dto(pattern.id).pattern.sources)if(source.kind==='sample'&&source.audioFileId&&!seen.has(source.audioFileId))seen.set(source.audioFileId,{audioFileId:source.audioFileId,name:source.name,durationSec:source.durationSec,mimeType:source.mimeType,rackId:source.rackId});}catch{}}
    try{const result=body(await this.session.call('list_pattern_samples',{project_id:projectId}));for(const row of result?.data||result?.samples||[]){const id=row.audioFileId||row.audio_file_id;if(id&&!seen.has(id))seen.set(id,{audioFileId:id,name:row.name,durationSec:row.durationSec,mimeType:row.mimeType});}}
    catch(error){this.onStatus(`The project sample pool could not be listed: ${error.message}`);}
    return [...seen.values()];
  }
  /** Studio API uploadPatternSample: stored sample, no lane/take/clip. */
  async uploadSample(patternId,{base64,filename,name}){
    this.assertReady();if(!base64)throw new Error('Choose an audio file.');
    const result=body(await this.write('upload_pattern_sample',{base64,...filename?{filename:String(filename).slice(0,160)}:{},...name?{name:String(name).slice(0,80)}:{}},{label:`Uploading ${name||filename||'sample'}`}));
    const audioFileId=result?.audioFileId||result?.sample?.audioFileId;if(!audioFileId)throw new Error('Freestyle stored the sample without returning its audioFileId.');
    const sample={...(result.sample||{}),audioFileId,name:result.sample?.name||name||filename};
    if(patternId)this.addSample(patternId,sample);return sample;
  }

  async preview(patternId,{repeatCount=4}={}){
    const projectId=this.assertReady(),dto=this.dto(patternId),project=this.getProject();
    const e=this.engine;e.monitor?.setOutputWanted?.(true,{projectId});e.monitor?.primeOutput?.();
    if(e.monitor&&e.monitor.state!=='connected'){
      // No live peer yet: use the established engine pattern-play path, which
      // negotiates the existing sink, after persisting this draft.
      await this.flush(patternId);await e.refresh?.();e.selectedPattern=String(patternId);
      return e.play(this.getProject(),'pattern',{preview:{repeat_count:repeatCount}});
    }
    this.previewing=String(patternId);this.changed();
    // Studio API previewPattern auditions unsaved step edits in the live engine.
    try{const receipt=await this.session.action('preview_pattern',{project_id:projectId,pattern:clone(dto.pattern),bpm:Number(project.bpm)||120,bars:dto.bars,ppq:dto.ppq,length_ticks:dto.lengthTicks,repeat_count:repeatCount},{refresh:false});return assertPreviewScheduled(receipt);}
    catch(error){this.previewing='';this.changed();throw error;}
  }
  async stopPreview(){this.previewing='';this.changed();return this.session.action('stop_all_pattern_previews',{}, {refresh:false});}

  // --------------------------------------------------------------- placements
  /** Display rows from receipts now; reconcile with a background refresh later. */
  project(change){const ok=projectPlacements(this.engine,change);this.scheduleReconcile();return ok;}
  async createPlacement(payload,label){
    let id='',result=null;await this.write('create_pattern_placement',{placement:payload},{label,onResult:r=>{id=idOf(r);result=r;}});
    if(!id)throw new Error('Freestyle created the pattern clip without returning its id. Refresh before editing it.');
    const row=completePlacement(receiptPlacement(result),{...payload,id},this.projectId());
    if(!row||!this.project({upsert:[row]}))this.projectionMissed=true;return id;
  }
  async patchPlacement(placementId,state,label='Pattern clip edit'){
    const before=canonicalRow(this.session,placementId),optimistic=before&&completePlacement({...before,...state},before,this.projectId());
    if(optimistic)this.project({upsert:[optimistic]});
    let result;try{result=await this.write('update_pattern_placement',{placement_id:placementId,placement:clone(state)},{label});}
    catch(error){if(before&&definiteCloudRejection(error))this.project({upsert:[before]});throw error;}
    const row=completePlacement(receiptPlacement(result),{...(before||{}),...state,id:placementId},this.projectId());
    if(!row||!this.project({upsert:[row]}))this.projectionMissed=true;return result;
  }
  async removePlacement(placementId,label='Remove pattern clip'){
    const before=canonicalRow(this.session,placementId);if(before)this.project({remove:[placementId]});
    let restore=null;
    try{await this.write('delete_pattern_placement',{placement_id:placementId},{label,destructive:true,onResult:r=>{restore=restoreOf(r);}});}
    catch(error){if(before&&definiteCloudRejection(error))this.project({upsert:[before]});throw error;}
    if(!before)this.projectionMissed=true;return restore;
  }
  async restorePlacement(placementId,restore,label='Restore pattern clip'){
    const optimistic=completePlacement(restore.before,{id:placementId},this.projectId());if(optimistic)this.project({upsert:[optimistic]});
    let result;try{result=await this.write('restore_pattern_placement',{placement_id:placementId,before:restore.before,restoreToken:restore.restoreToken},{label});}
    catch(error){if(optimistic&&definiteCloudRejection(error))this.project({remove:[placementId]});throw error;}
    const row=completePlacement(receiptPlacement(result),optimistic||{id:placementId},this.projectId());
    if(!row||!this.project({upsert:[row]}))this.projectionMissed=true;return result;
  }
  /** A receipt could not be projected (no canonical container): fall back to a canonical read. */
  async settleProjection(){if(!this.projectionMissed)return;this.projectionMissed=false;await this.session?.refresh?.();}

  rowFor(laneId){return (this.getProject()?.clips||[]).find(c=>(c.cloudRaw?.laneId||c.laneId)===laneId);}
  maxDisplayOrder(){return Math.max(-1,...(this.getProject()?.clips||[]).map(c=>Number(c.cloudRaw?.displayOrder)).filter(Number.isFinite));}
  /** Pattern → Playlist (drag `application/x-freestyle-pattern` / import). */
  async importPattern(patternId,{atSec=0,laneId='',exact=false,newRow=!laneId}={}){
    const projectId=this.assertReady();await this.flush(patternId);
    if(this.local.has(String(patternId))&&!this.sourcePattern(patternId))await this.session?.refresh?.();
    const dto=this.dto(patternId),project=this.getProject(),siblings=this.placementsOf(patternId).map(c=>c.cloudRaw||c);
    const row=laneId?this.rowFor(laneId):null;
    const payload=placementPayload(dto,{patternId,atSec,bpm:project.bpm,laneId,exact,name:newRow&&siblings.length?copyName(dto.name,siblings):dto.name,displayOrder:row?Number(row.cloudRaw?.displayOrder)||0:this.maxDisplayOrder()+1});
    const placementId=await this.createPlacement(payload,`Placing ${payload.name}`);
    this.push(projectId,{type:'placement-create',placementId,payload,label:`Insert ${payload.name}`});
    await this.settleProjection();this.changed();return placementId;
  }
  /** Rack/library sample → Playlist via Studio API placeOnTimeline (stored audioFileId, no new take). */
  async placeSample(sample,{atSec=0,laneId='',rackChannelId=''}={}){
    const projectId=this.assertReady(),audioFileId=String(sample?.audioFileId||'');
    if(!audioFileId)throw new Error('This channel has no stored Freestyle sample to place.');
    const request={audio_file_id:audioFileId,startMs:Math.max(0,Math.round(Number(atSec)*1000)||0),name:String(sample.name||'Sample').trim().slice(0,60)||'Sample',...laneId?{laneId}:{},...rackChannelId?{rackChannelId:String(rackChannelId).slice(0,255)}:{}};
    const raw=await this.write('place_pattern_sample_on_timeline',request,{label:`Placing ${request.name}`}),result=body(raw);
    const undo=result?.undo;if(!undo?.clipId)throw new Error('Freestyle placed the sample without returning its Undo receipt. Refresh before editing it.');
    this.push(projectId,{type:'sample-place',request,undo,timing:timingOf(raw,request),label:`Place ${request.name}`});
    this.onStatus(result.engine_attached===false||result.engine_reload_required?`${request.name} is saved on the timeline; reload the session before expecting it to play.`:`${request.name} placed on the timeline.`);
    this.scheduleReconcile();this.changed();return result;
  }

  /** Library sound → Playlist: the Freestyle Studio registers a catalog row as a stored pattern
   * sample (no bytes re-uploaded), then places that audioFileId. */
  async placeLibrarySound(item,options={}){
    this.assertReady();const handle=item?.register,ids=['track_id','audio_file_id','preset_pack_item_id','sound_pack_item_id','catalog_sound_id'];
    if(!handle||typeof handle!=='object'||Array.isArray(handle)||Object.keys(handle).some(key=>!ids.includes(key)&&key!=='name')||Object.keys(handle).filter(key=>ids.includes(key)).length!==1)throw new Error('This library sound has no supported Freestyle registration handle.');
    const registered=body(await this.write('register_pattern_sample',{...handle,...!handle.name&&item.name?{name:String(item.name).slice(0,80)}:{}},{label:`Adding ${item.name||'sound'} to the sample pool`}));
    const audioFileId=registered?.audioFileId||registered?.sample?.audioFileId||registered?.audio_file_id;
    if(!audioFileId)throw new Error('Freestyle registered the sound without returning its audioFileId.');
    return this.placeSample({audioFileId,name:registered.sample?.name||item.name},options);
  }
  /** Copy/Cut/Paste of pattern clips. */
  copy(clip){const raw=clip?.cloudRaw;if(!clip?.patternId||!raw?.patternId)throw new Error('Select a saved pattern clip to copy.');this.clipboard={projectId:this.projectId(),payload:placementCopy(raw)};this.onStatus(`Copied ${raw.name||'pattern clip'}.`);return true;}
  async cut(clip){this.copy(clip);return this.deletePlacement(clip);}
  async paste({atSec=0,laneId}={}){
    const projectId=this.assertReady();const copied=this.clipboard;if(!copied)throw new Error('Copy a pattern clip first.');
    if(copied.projectId!==projectId)throw new Error('Paste pattern clips into the project they were copied from.');
    const payload={...clone(copied.payload),startMs:Math.max(0,Math.round(Number(atSec)*1000))};if(laneId)payload.laneId=laneId;
    if(payload.windowMs==null)delete payload.windowMs;
    const placementId=await this.createPlacement(payload,`Pasting ${payload.name||'pattern clip'}`);
    this.push(projectId,{type:'placement-create',placementId,payload,label:`Paste ${payload.name||'pattern clip'}`});await this.settleProjection();this.changed();return placementId;
  }
  async deletePlacement(clip){
    const projectId=this.assertReady(),placementId=String(clip?.cloudId||clip?.cloudRaw?.id||'');if(!placementId)throw new Error('This pattern clip has no persisted id.');
    await this.engine.flush?.();const restore=await this.removePlacement(placementId,'Delete pattern clip');
    this.push(projectId,{type:'placement-delete',placementId,restore,label:`Delete ${clip.cloudRaw?.name||'pattern clip'}`});await this.settleProjection();this.changed();return true;
  }

  /**
   * Pure pattern-clip gestures intercepted from the engine flush
   * (pattern-rack-receipts interceptPlacementCommits): typed writes, instant
   * receipt projection, one grouped Undo entry, no blocking full refresh.
   */
  async commitPlacements(diff){
    const projectId=this.projectId(),entries=[];
    try{
      for(const clip of diff.removed){const placementId=String(clip.cloudId);const restore=await this.removePlacement(placementId,'Delete pattern clip');entries.push({type:'placement-delete',placementId,restore});}
      for(const {clip,body:placement}of diff.changed){
        const placementId=String(clip.cloudId),beforeRow=canonicalRow(this.session,placementId)||clip.cloudRaw;if(!beforeRow)throw new Error('The pattern clip has no canonical state. Refresh before editing it.');
        const before=placementState(beforeRow),after=placementState({...beforeRow,...placement});if(same(before,after))continue;
        await this.patchPlacement(placementId,after,'Pattern clip edit');entries.push({type:'placement-update',placementId,before,after});
      }
      for(const {body:placement}of diff.added){const placementId=await this.createPlacement(placement,'Pattern clip copy');entries.push({type:'placement-create',placementId,payload:placement});}
    }finally{
      if(entries.length)this.push(projectId,entries.length===1?{...entries[0],label:'Pattern clip edit'}:{type:'group',entries,label:'Pattern clip edit'});
      await this.settleProjection().catch(()=>{});this.changed();
    }
    return true;
  }

  /** Other generic placement writes (mixed edits through CloudSession.applyProject)
   * are still recorded as typed inverses so Undo never falls to the audio stack. */
  observeAction(detail){
    if(!detail||!PLACEMENT_ACTIONS.has(detail.name)||this.mine.has(detail.args)||this.replaying)return;
    const projectId=this.projectId(),args=detail.args||{},result=detail.result;let entry=null;
    if(detail.name==='update_pattern_placement'){
      const id=String(args.placement_id||''),before=this.canonicalPlacement(id);if(!id||!before)return;
      const after={...placementState(before),...placementState({...before,...args.placement})};entry={type:'placement-update',placementId:id,before:placementState(before),after};
      if(same(entry.before,entry.after))return;
    }else if(detail.name==='create_pattern_placement'){const id=idOf(result);if(!id)return;entry={type:'placement-create',placementId:id,payload:clone(args.placement||{})};}
    else{const id=String(args.placement_id||'');if(!id)return;entry={type:'placement-delete',placementId:id,restore:restoreOf(result)};}
    if(!this.batch){
      const batch=this.batch={projectId,entries:[]},flight=this.engine.inFlight;
      const finish=()=>{if(this.batch===batch)this.batch=null;if(!batch.entries.length)return;this.push(batch.projectId,batch.entries.length===1?{...batch.entries[0],label:'Pattern clip edit'}:{type:'group',entries:batch.entries,label:'Pattern clip edit'});this.changed();};
      Promise.resolve(flight).catch(()=>{}).finally(()=>this.timers.setTimeout(finish,0));
    }
    this.batch.entries.push(entry);
  }
  canonicalPlacement(id){
    const fromProject=project=>(project?.clips||[]).find(c=>String(c.cloudId||c.cloudRaw?.id)===id)?.cloudRaw;
    return canonicalRow(this.session,id)||fromProject(this.engine.session?.project)||fromProject(this.engine.snapshot)||null;
  }

  // ------------------------------------------------------------------ history
  push(projectId,entry){entry.context={projectId};this.stack(this.past,projectId).push(entry);this.stack(this.future,projectId).length=0;this.record(entry,projectId);}
  can(direction){return !!this.stack(direction==='undo'?this.past:this.future).at(-1);}
  uncertain(id=this.projectId()){return this.uncertainProjects.has(id)||(id===this.projectId()&&!!this.uncertainPattern());}
  unverified(){return false;}
  async history(direction){
    const projectId=this.projectId(),from=this.stack(direction==='undo'?this.past:this.future,projectId),to=this.stack(direction==='undo'?this.future:this.past,projectId),entry=from.at(-1);
    if(!entry)return false;if(this.pendingWrite||this.uncertainPattern())throw new Error('Retry the uncertain pattern write before Undo or Redo.');
    await this.flush();if(this.projectId()!==projectId)throw new Error('The cloud project changed while pattern history was waiting.');
    this.replaying=true;
    try{await this.apply(entry,direction);await this.settleProjection();}finally{this.replaying=false;}
    from.pop();to.push(entry);this.onStatus(`${direction==='undo'?'Undid':'Redid'} ${entry.label||'pattern edit'} in Freestyle`);
    this.changed();return true;
  }
  async apply(entry,direction){
    const undo=direction==='undo';
    switch(entry.type){
      case 'group':{const entries=undo?[...entry.entries].reverse():entry.entries;for(const child of entries)await this.apply(child,direction);return;}
      case 'pattern':{
        this.dto(entry.patternId);const result=this.documents.edit(entry.patternId,dto=>applyPatch(dto,entry.patch,direction),{origin:'rack-history',label:entry.label});
        if(!result.ok)throw new Error(result.reason);await this.documents.flush(entry.patternId);return;
      }
      case 'pattern-create':case 'pattern-delete':{
        const remove=(entry.type==='pattern-create')===undo;
        if(remove){if(this.placementsOf(entry.patternId).length)throw new Error('Delete this pattern’s timeline clips before undoing its creation.');await this.write('delete_pattern',{pattern_id:entry.patternId},{label:'Delete pattern',destructive:true});this.documents.forgetPattern(entry.patternId);this.local.delete(entry.patternId);}
        else{await this.write('restore_pattern',{pattern_id:entry.patternId},{label:'Restore pattern'});this.local.set(entry.patternId,{projectId:entry.context.projectId,body:clone(entry.body)});this.documents.adopt(entry.patternId,entry.body);this.selectedPattern=entry.patternId;}
        this.scheduleReconcile();return;
      }
      case 'placement-update':return void await this.patchPlacement(entry.placementId,clone(undo?entry.before:entry.after));
      case 'placement-create':case 'placement-delete':{
        const remove=(entry.type==='placement-create')===undo;
        if(remove){entry.restore=await this.removePlacement(entry.placementId);return;}
        if(!entry.restore&&entry.payload){entry.placementId=await this.createPlacement(clone(entry.payload),'Recreate pattern clip');return;} // redo of a copy
        if(!entry.restore)throw new Error('Freestyle did not return a restore token for that pattern clip; it cannot be restored with its original id.');
        await this.restorePlacement(entry.placementId,entry.restore);entry.restore=null;return;
      }
      case 'sample-place':{
        // Studio API clips:batch remove/restore keep the SAME clip id (the
        // geometry history uses this for drop imports); a lane created by the
        // placement is soft-deleted and restored with lanes/{id}:restore.
        const id=entry.undo.clipId,timing=entry.timing;
        if(undo){
          await this.write('apply_clip_batch',{ops:[{op:'remove',id,...timing?{expected:timing}:{}}]},{label:'Remove placed sample',destructive:true});
          if(entry.undo.createdLane&&entry.undo.laneId){const r=body(await this.write('remove_track',{lane_id:entry.undo.laneId},{label:'Remove created lane',destructive:true}));entry.deletedClipIds=Array.isArray(r?.deletedClipIds)?r.deletedClipIds:[];}
          this.scheduleReconcile();return;
        }
        if(!timing){const result=body(await this.write('place_pattern_sample_on_timeline',entry.request,{label:'Place sample'}));if(!result?.undo?.clipId)throw new Error('Freestyle re-placed the sample without an Undo receipt.');entry.undo=result.undo;this.scheduleReconcile();return;}
        if(entry.undo.createdLane&&entry.undo.laneId)await this.write('restore_lane',{lane_id:entry.undo.laneId,clip_ids:entry.deletedClipIds||[]},{label:'Restore lane'});
        await this.write('apply_clip_batch',{ops:[{op:'restore',id,...timing}]},{label:'Restore placed sample'});this.scheduleReconcile();return;
      }
      default:throw new Error('Unknown pattern history entry.');
    }
  }
}
