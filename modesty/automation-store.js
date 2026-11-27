/** Optimistic automation-clip persistence and owned Undo/Redo.
 *
 * Matches the Freestyle Studio's automation behaviour:
 * every edit updates the local envelope immediately, then one serialized save
 * chain per (clip, target key) writes the COMPLETE envelope through Studio
 * API v1 REST - POST /clips/{clip}/automation when not persisted, otherwise
 * PUT /automation/{id} with expectedRevision (If-Match) - and adopts the
 * returned canonical envelope. History entries hold before/after envelope
 * snapshots; Undo of a creation deletes the envelope.
 *
 * Modesty additions required by HANDOFF invariants: the write is captured with
 * its idempotency key before dispatch; an ambiguous outcome locks the key and
 * may only be recovered by replaying the exact captured request; definite
 * rejections adopt the server's envelope; the acknowledgement must match the
 * sent points exactly (full precision, no rounding) before it is "verified".
 * Edits within debounceMs coalesce into one background write.
 */
import {captureWriteRequest,definiteCloudRejection,retainInProgress,isIdempotencyInProgress} from './cloud-errors.js';
import {assertAutomationJsonValue,assertAutomationWritePreservesData,automationReadbackDifferences,LIVE_AUTOMATION_CONTRACT} from './audacity-automation-contract.js';
import {hasCanonicalTruncation} from './cloud-session.js';
import {defaultEnvelopePoints,envelopeSnapshot,normalizeEnvelopePoints,samePoints,targetKey as keyForTarget} from './automation-model.js';
const copy=value=>value===undefined?undefined:structuredClone(value);
const entryKey=(projectId,clipId,key)=>JSON.stringify([projectId,clipId,key]);

export function unwrapAutomationResult(raw){
  assertAutomationJsonValue(raw);
  let data=raw?.structuredContent;if(!data&&Array.isArray(raw?.content)){try{data=JSON.parse(raw.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));}catch{}}
  data=data??raw;const response=data?.response??data;
  if(raw?.isError||data?.error||data?.ok===false||response?.error||response?.ok===false||isIdempotencyInProgress(raw)){const error=Object.assign(new Error(response?.message||response?.error?.message||(typeof response?.error==='string'?response.error:'')||data?.message||'Freestyle could not save automation.'),{code:response?.code||data?.code,status:response?.status||data?.status,details:response?.details||data?.details,result:raw});error.definiteRejection=definiteCloudRejection(error);throw error;}
  return response;
}
function assertComplete(data,projectId){
  if(!data||typeof data!=='object'||hasCanonicalTruncation(data)||data.complete===false||data.has_more===true||data.hasMore===true||data.nextCursor||data.next_cursor||data.truncated===true)throw new Error('Freestyle returned incomplete automation. Reload before editing.');
  const project=data.projectId??data.project_id;if(project!==undefined&&project!==projectId)throw new Error('Freestyle returned automation from a different project.');
}
export function validateEnvelope(envelope,projectId){
  assertAutomationJsonValue(envelope);assertComplete(envelope,projectId);
  if(typeof envelope.clipId!=='string'||!envelope.clipId||!envelope.target?.kind||!Array.isArray(envelope.points))throw new Error('Freestyle returned an unknown automation target or point array.');
  if(!Number.isSafeInteger(envelope.revision)||envelope.revision<0||typeof envelope.persisted!=='boolean'||envelope.persisted&&(typeof envelope.id!=='string'||!envelope.id))throw new Error('Reload automation to obtain its canonical identity and revision.');
  return {...copy(envelope),targetKey:envelope.targetKey||keyForTarget(envelope.target)};
}

export class AutomationStore{
  constructor({cloudCall,getProjectId,getContext=()=>null,prepareWrite=async()=>{},getContract=()=>LIVE_AUTOMATION_CONTRACT,debounceMs=250,onChange=()=>{},onHistory=()=>{},onError=()=>{}}={}){
    Object.assign(this,{cloudCall,getProjectId,getContext,prepareWrite,getContract,debounceMs,onChange,onHistory,onError});
    this.listeners=new Set();this.entries=new Map();this.past=new Map();this.future=new Map();this.receipts=[];this.loads=new Map();this.durations=new Map();
  }
  stack(map,id=this.getProjectId()){if(!map.has(id))map.set(id,[]);return map.get(id);}
  canonicalDuration(clipId,projectId=this.getProjectId()){return this.durations.get(JSON.stringify([projectId,clipId]));}
  entry(clipId,key,projectId=this.getProjectId()){return this.entries.get(entryKey(projectId,clipId,key))||null;}
  envelopesFor(clipId,projectId=this.getProjectId()){
    const rows=[...this.entries.values()].filter(entry=>entry.projectId===projectId&&entry.clipId===clipId&&!(entry.local.deleted&&entry.local.target?.kind!=='clip_gain'));
    return rows.sort((a,b)=>a.key==='clip.gain'?-1:b.key==='clip.gain'?1:a.key.localeCompare(b.key)).map(entry=>this.view(entry));
  }
  view(entry){return {...copy(entry.local),clipId:entry.clipId,targetKey:entry.key,durationSec:entry.durationSec,saving:entry.saving||!!entry.timer,saveError:entry.error,locked:!!entry.uncertain,status:entry.status,revision:entry.server?.revision??0,persisted:!!entry.server?.persisted&&!entry.local.deleted};}
  uncertain(id=this.getProjectId()){return [...this.entries.values()].some(entry=>entry.projectId===id&&entry.uncertain);}
  unverified(){return false;}
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  notify(entry){const view=entry?this.view(entry):null;for(const listener of [this.onChange,...this.listeners]){try{listener(view);}catch{}}}

  /** Read one clip's canonical envelopes (refresh). durationSec is the
   * clip's real placement duration in seconds (clip-relative envelope span). */
  async load(clipId,durationSec,{force=false}={}){
    const projectId=this.getProjectId(),context=this.getContext(),id=JSON.stringify([projectId,clipId]);
    if(!force&&this.loads.has(id))return this.loads.get(id);
    const task=(async()=>{
      const data=unwrapAutomationResult(await this.cloudCall('list_automation',{project_id:projectId,clip_ids:[clipId]}));
      if(this.getProjectId()!==projectId||this.getContext()!==context)throw new Error('The project changed while automation was loading.');
      const {envelopes,automation,...meta}=data,rows=envelopes??automation;assertComplete(meta,projectId);if(!Array.isArray(rows))throw new Error('Freestyle returned no canonical automation list.');
      // The clip-gain curve (synthesized when absent) always spans the canonical
      // clip duration; prefer it to a beat-converted UI length.
      const gain=rows.find(row=>row?.clipId===clipId&&row?.target?.kind==='clip_gain'),end=gain?.points?.at?.(-1)?.timeSec;
      if(Number.isFinite(end)&&end>0){durationSec=end;this.durations.set(id,end);for(const entry of this.entries.values())if(entry.projectId===projectId&&entry.clipId===clipId)entry.durationSec=end;}
      for(const row of rows){if(row?.clipId!==clipId)continue;const envelope=validateEnvelope(row,projectId),key=envelope.targetKey;let entry=this.entry(clipId,key,projectId);
        if(entry&&(entry.saving||entry.timer||entry.uncertain||!samePoints(entry.local.points,entry.server?.points??[])&&!entry.local.deleted)){entry.durationSec=durationSec;continue;}
        entry=this.adopt(projectId,clipId,key,envelope,durationSec);this.notify(entry);}
      return this.envelopesFor(clipId,projectId);
    })();
    this.loads.set(id,task);task.catch(()=>this.loads.delete(id));return task;
  }
  adopt(projectId,clipId,key,envelope,durationSec){
    let entry=this.entries.get(entryKey(projectId,clipId,key));
    if(!entry){entry={projectId,clipId,key,durationSec,server:null,local:null,saving:false,timer:null,chain:Promise.resolve(),error:'',status:'loaded',uncertain:null};this.entries.set(entryKey(projectId,clipId,key),entry);}
    if(Number.isFinite(durationSec))entry.durationSec=durationSec;entry.server=copy(envelope);entry.local={...copy(envelope),deleted:false};return entry;
  }
  normalize(entry,points){return normalizeEnvelopePoints(points,{durationSec:entry.durationSec,defaultValue:entry.local.defaultValue??.25,valueType:entry.local.valueType||'continuous'});}

  /** Optimistic edit; returns the normalized points now on screen. */
  edit(clipId,key,points,{description='Edit automation',history=true}={}){
    const entry=this.entry(clipId,key);if(!entry)throw new Error('Load this clip’s automation before editing it.');
    if(entry.uncertain)throw new Error('An automation save needs verification. Use Verify before editing this lane again.');
    const before=copy(entry.local),next=this.normalize(entry,points);if(samePoints(next,entry.local.points)&&!entry.local.deleted)return next;
    entry.local={...entry.local,points:next,deleted:false};entry.error='';
    if(history)this.record(entry,before,description);
    this.schedule(entry);this.notify(entry);return copy(next);
  }
  /** Default curve at the target's current value. */
  create(clipId,target,{defaultValue=.25,durationSec,valueType}={}){
    const projectId=this.getProjectId(),key=keyForTarget(target),existing=this.entry(clipId,key,projectId);
    if(existing&&!existing.local.deleted)return this.view(existing);
    if(!(durationSec>0))throw new Error('The clip duration is unknown. Reload the project before creating automation.');
    const type=valueType||(Array.isArray(target.options)&&target.options.length?'discrete':'continuous'),value=Math.min(1,Math.max(0,Number(defaultValue)||0));
    const entry=existing||this.adopt(projectId,clipId,key,{clipId,projectId,target:copy(target),targetKey:key,persisted:false,id:null,revision:0,defaultValue:value,valueType:type,points:[]},durationSec);
    const before=copy(entry.local);
    entry.local={...entry.local,target:copy(target),defaultValue:value,valueType:type,points:defaultEnvelopePoints({durationSec:entry.durationSec,defaultValue:value,valueType:type}),deleted:false};entry.error='';
    this.record(entry,before,`Create ${target.name||'parameter'} automation`);this.schedule(entry,0);this.notify(entry);return this.view(entry);
  }
  /** Remove a lane (plugin target) or reset clip gain to its default curve. */
  remove(clipId,key){
    const entry=this.entry(clipId,key);if(!entry)return;if(entry.uncertain)throw new Error('Verify the pending automation save first.');
    const before=copy(entry.local);entry.local={...entry.local,deleted:true,points:entry.local.target?.kind==='clip_gain'?defaultEnvelopePoints({durationSec:entry.durationSec,defaultValue:entry.local.defaultValue??.25,valueType:entry.local.valueType||'continuous'}):entry.local.points};
    this.record(entry,before,`Delete ${entry.local.target?.name||'parameter'} automation`);this.schedule(entry,0);this.notify(entry);
  }
  /** History snapshot of a local state: absent = deleted, or still the
   * server-synthesized default curve that was never persisted. */
  snapshot(entry,local){
    const absent=local.deleted||!entry.server?.persisted&&samePoints(local.points,entry.server?.points??[])&&local.defaultValue===entry.server?.defaultValue;
    return {...envelopeSnapshot(local),persisted:!absent};
  }
  record(entry,beforeLocal,description){
    this.stack(this.past,entry.projectId).push({projectId:entry.projectId,clipId:entry.clipId,key:entry.key,before:this.snapshot(entry,beforeLocal),after:{...envelopeSnapshot(entry.local),persisted:!entry.local.deleted},description});
    this.stack(this.future,entry.projectId).length=0;try{this.onHistory(entry.projectId,description);}catch{}
  }
  canUndo(id=this.getProjectId()){return this.stack(this.past,id).length>0;}
  canRedo(id=this.getProjectId()){return this.stack(this.future,id).length>0;}
  /** Owned-history hook used by the workspace's chronological Undo/Redo. */
  async history(direction){
    const id=this.getProjectId(),from=this.stack(direction==='undo'?this.past:this.future,id),to=this.stack(direction==='undo'?this.future:this.past,id),item=from.at(-1);if(!item)return false;
    const entry=this.entry(item.clipId,item.key,id);if(!entry)throw new Error('The automation lane for this history step is no longer loaded.');
    if(entry.uncertain)throw new Error('Verify the pending automation save before Undo or Redo.');
    const desired=direction==='undo'?item.before:item.after;
    if(!desired.persisted)entry.local={...entry.local,deleted:true,points:entry.local.target?.kind==='clip_gain'?desired.points:entry.local.points};
    else entry.local={...entry.local,target:copy(desired.target)??entry.local.target,defaultValue:desired.defaultValue??entry.local.defaultValue,valueType:desired.valueType||entry.local.valueType,points:copy(desired.points),deleted:false};
    from.pop();to.push(item);entry.error='';this.notify(entry);
    await this.flush(entry);if(entry.error)throw new Error(entry.error);return true;
  }

  schedule(entry,delay=this.debounceMs){
    if(entry.timer)clearTimeout(entry.timer);
    entry.timer=setTimeout(()=>{entry.timer=null;this.flush(entry).catch(()=>{});},delay);
  }
  /** Flush now (also used by tests, Undo and window close). */
  flush(entry){
    if(entry.timer){clearTimeout(entry.timer);entry.timer=null;}
    const run=()=>this.write(entry);entry.chain=entry.chain.then(run,run);return entry.chain;
  }
  async flushAll(){await Promise.all([...this.entries.values()].map(entry=>entry.timer?this.flush(entry):entry.chain.catch(()=>{})));}
  request(entry){
    const local=entry.local,server=entry.server,projectId=entry.projectId;
    if(local.deleted){
      if(!server?.persisted)return null;
      return {name:'delete_automation',arguments:{project_id:projectId,envelope_id:server.id,expected_revision:server.revision,confirm:true,idempotency_key:crypto.randomUUID()}};
    }
    if(server?.persisted&&samePoints(local.points,server.points)&&local.defaultValue===server.defaultValue&&(local.valueType||'continuous')===(server.valueType||'continuous'))return null;
    if(!server?.persisted&&local.target?.kind==='clip_gain'&&samePoints(local.points,server?.points??[])&&local.defaultValue===server?.defaultValue)return null;
    assertAutomationWritePreservesData({points:local.points,envelope:{...local,valueType:local.valueType||'continuous'},window:{durationSec:entry.durationSec},contract:this.getContract()});
    const args={project_id:projectId,points:copy(local.points),value_type:local.valueType||'continuous',idempotency_key:crypto.randomUUID()};
    if(typeof local.defaultValue==='number'&&Number.isFinite(local.defaultValue))args.default_value=local.defaultValue;
    if(server?.persisted)return {name:'update_automation',arguments:{...args,envelope_id:server.id,expected_revision:server.revision}};
    return {name:'create_automation',arguments:{...args,clip_id:entry.clipId,target:copy(local.target)}};
  }
  async write(entry){
    if(entry.uncertain)return;
    const projectId=entry.projectId,context=this.getContext();
    if(this.getProjectId()!==projectId)return;
    let generated;
    try{generated=this.request(entry);}catch(error){entry.error=error.message;entry.status='blocked';this.revert(entry);this.notify(entry);this.onError(error);return;}
    if(!generated){entry.status=entry.server?.persisted?'verified':'loaded';this.notify(entry);return;}
    entry.saving=true;entry.status='sending';this.notify(entry);
    let receipt;
    try{
      await this.prepareWrite();
      if(this.getProjectId()!==projectId||this.getContext()!==context)throw Object.assign(new Error('The project changed before the automation save was sent.'),{notSent:true});
      generated=this.request(entry);if(!generated){entry.saving=false;entry.status='verified';this.notify(entry);return;}
      const write=captureWriteRequest(generated.name,generated.arguments),sent=copy(entry.local);
      receipt={write,sent,raw:null,status:'sending',clipId:entry.clipId,key:entry.key,projectId};this.receipts.push(receipt);
      await this.dispatch(entry,receipt);
    }catch(error){if(error.notSent){entry.error=error.message;entry.status='blocked';}else this.failed(entry,receipt,error);this.notify(entry);this.onError(error);}
    finally{entry.saving=false;this.notify(entry);}
    // Edits made while this write was in flight are sent next, in order.
    try{if(!entry.uncertain&&!['rejected','blocked'].includes(entry.status)&&!entry.timer&&this.request(entry))this.schedule(entry,0);}catch{}
  }
  async dispatch(entry,receipt){
    const {write}=receipt;
    const raw=await this.cloudCall(write.name,copy(write.arguments));receipt.raw=copy(raw);const data=unwrapAutomationResult(raw);receipt.status='acknowledged';
    if(write.name==='delete_automation'){
      // Clip gain falls back to its synthesized default; a plugin lane is gone
      // but its entry stays so Redo can recreate it.
      entry.server={...entry.server,persisted:false,id:null,revision:0,points:entry.local.target?.kind==='clip_gain'?copy(entry.local.points):[]};
      receipt.status='verified';entry.status='verified';entry.error='';entry.uncertain=null;return;
    }
    const saved=validateEnvelope(data.envelope||data,entry.projectId);
    const differences=automationReadbackDifferences({points:write.arguments.points,default_value:write.arguments.default_value,value_type:write.arguments.value_type,...(write.arguments.clip_id?{clip_id:write.arguments.clip_id}:{})},saved);
    if(saved.clipId!==entry.clipId||saved.persisted!==true||saved.targetKey!==entry.key||write.name==='update_automation'&&(saved.id!==write.arguments.envelope_id||saved.revision<=write.arguments.expected_revision))differences.push('identity');
    const newer=!samePoints(entry.local.points,receipt.sent.points)||entry.local.deleted!==receipt.sent.deleted;
    entry.server=saved;entry.uncertain=null;
    if(differences.length){receipt.status='mismatched';receipt.differences=differences;entry.status='mismatched';entry.error=`Freestyle saved different automation data (${differences.join(', ')}). The canonical envelope is shown; the write was not retried.`;if(!newer)entry.local={...copy(saved),deleted:false};return;}
    receipt.status='verified';entry.status='verified';entry.error='';
    if(!newer)entry.local={...copy(saved),deleted:false};else entry.local={...entry.local,id:saved.id};
  }
  failed(entry,receipt,error){
    if(receipt)receipt.error={message:error.message,code:error.code,status:error.status};
    const conflict=error.details?.envelope??error.result?.details?.envelope;
    if(receipt&&definiteCloudRejection(error)&&!isIdempotencyInProgress(error)){
      receipt.status='rejected';
      if(conflict){try{const envelope=validateEnvelope(conflict,entry.projectId);if(error.code==='automation_exists'&&envelope.targetKey===entry.key){entry.server=envelope;entry.error='';entry.status='adopted';return;}entry.server=envelope;}catch{}}
      entry.error=error.code==='revision_conflict'?'This automation changed elsewhere; the latest saved curve is shown and your edit was not saved.':error.message;entry.status='rejected';this.revert(entry);return;
    }
    // Unknown outcome: retain the exact intent; never resend with a new key.
    if(receipt){receipt.status='uncertain';retainInProgress(receipt,error);entry.uncertain=receipt;}
    entry.status='uncertain';entry.error=`${error.message} The save outcome is unknown; Verify replays the same request.`;
  }
  revert(entry){if(entry.server)entry.local={...copy(entry.server),deleted:false};}
  /** Explicit recovery: replay the exact captured request (same key). */
  async verify(clipId,key){
    const entry=this.entry(clipId,key);const receipt=entry?.uncertain;if(!receipt)return false;
    entry.saving=true;this.notify(entry);
    try{await this.dispatch(entry,receipt);return true;}
    catch(error){if(definiteCloudRejection(error)&&!isIdempotencyInProgress(error)){entry.uncertain=null;this.failed(entry,receipt,error);return false;}entry.error=`${error.message} Still unverified; the same request will be replayed by Verify.`;throw error;}
    finally{entry.saving=false;this.notify(entry);}
  }
}
