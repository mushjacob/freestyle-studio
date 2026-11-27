/**
 * One persisted pattern document per pattern, shared by every editor (Pattern
 * Rack steps/channels, piano-roll notes, library sample adds).
 *
 * The Freestyle Studio writes a pattern edit as the whole document ({name,ppq,
 * bars,lengthTicks,swing,pattern:{version,sources,events}}); the OAuth
 * equivalent is Studio API v1 updatePattern
 * (PATCH /projects/{id}/patterns/{pattern_id}). Because every write replaces
 * the document, independent writers would overwrite each other. Here each
 * edit is a function applied to the single latest draft, saves are serialized
 * per pattern and coalesced, and every dispatched body is an immutable intent
 * whose idempotency key is retained before sending. A definite rejection
 * restores the last acknowledged document; an unknown outcome blocks further
 * edits on that pattern until the exact request is verified.
 *
 * Revision guard: updatePattern declares If-Match (timeline revision, 412).
 * The local Studio client attaches the latest timeline ETag it has observed
 * to every guarded write, so a pattern changed by another client is a 412
 * definite rejection here. The receipt's revision is retained per intent.
 */
import {definiteCloudRejection,isIdempotencyInProgress} from './cloud-errors.js';
import {patternDto,editableBody,ppqOf,clampBars} from './pattern-rack-model.js';

const uid=()=>globalThis.crypto?.randomUUID?.()||`pattern-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const clone=value=>value==null?value:structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const body=value=>value?.response??value;

// ------------------------------------------------------------ scoped patches
const FIELDS=['name','bars','lengthTicks','swing','ppq'];
const eventKey=event=>event?.id!=null?`id:${event.id}`:`json:${JSON.stringify(event)}`;
const byKey=(rows,key)=>new Map(rows.map(row=>[key(row),row]));
/** Field/source/event-level difference; undoing it touches nothing else. */
export function diffPatch(before,after){
  const patch={fields:{},sources:{},events:{}};
  for(const key of FIELDS)if(!same(before[key],after[key]))patch.fields[key]=[clone(before[key]),clone(after[key])];
  const sourceKey=row=>String(row.id),bs=byKey(before.pattern.sources,sourceKey),as=byKey(after.pattern.sources,sourceKey);
  for(const id of new Set([...bs.keys(),...as.keys()]))if(!same(bs.get(id),as.get(id)))patch.sources[id]=[clone(bs.get(id)??null),clone(as.get(id)??null)];
  const be=byKey(before.pattern.events,eventKey),ae=byKey(after.pattern.events,eventKey);
  for(const id of new Set([...be.keys(),...ae.keys()]))if(!same(be.get(id),ae.get(id)))patch.events[id]=[clone(be.get(id)??null),clone(ae.get(id)??null)];
  return patch;
}
export function patchEmpty(patch){return !Object.keys(patch.fields).length&&!Object.keys(patch.sources).length&&!Object.keys(patch.events).length;}
/** Apply one side ('undo' → before values, 'redo' → after values) onto the current document. */
export function applyPatch(dto,patch,direction){
  const side=direction==='undo'?0:1,next=clone(dto);
  for(const [key,values]of Object.entries(patch.fields)){if(values[side]===undefined)delete next[key];else next[key]=clone(values[side]);}
  const put=(rows,key,map)=>{const out=[];const seen=new Set();for(const row of rows){const k=key(row);if(Object.hasOwn(map,k)){seen.add(k);const value=map[k][side];if(value)out.push(clone(value));}else out.push(row);}for(const [k,values]of Object.entries(map))if(!seen.has(k)&&values[side])out.push(clone(values[side]));return out;};
  next.pattern.sources=put(next.pattern.sources,row=>String(row.id),patch.sources);
  next.pattern.events=put(next.pattern.events,eventKey,patch.events);
  return next;
}

/** Piano-roll note list → this source's note events (CloudSession serializeCloudPattern note branch). */
export function setChannelNotes(dto,sourceId,notes,{bars,source}={}){
  const next=clone(dto),ppq=ppqOf(next);let src=next.pattern.sources.find(row=>String(row.id)===String(sourceId));
  if(!src){if(!source)throw Object.assign(new Error('This channel is not in the pattern. Add it in the Pattern Rack first.'),{definiteRejection:true,local:true});src=clone(source);next.pattern.sources.push(src);}
  const isNote=event=>String(event.sourceId)===String(src.id)&&['midi','sample'].includes(event.type)&&event.startTick!=null&&event.durationTick!=null;
  const events=next.pattern.events.filter(event=>!isNote(event));
  for(const note of notes||[]){
    const original=note.cloudRaw||{},tick=Math.round(finite(note.start)*ppq*1000)/1000,pitch=finite(note.pitch,60);
    const event={...original,id:original.id||note.id||uid(),type:src.kind==='sample'?'sample':'midi',sourceId:src.id,note:pitch,startTick:tick,durationTick:Math.max(1,Math.round(finite(note.duration,.25)*ppq*1000)/1000),velocity:finite(note.velocity,.8)};
    if(src.kind==='sample'){event.tick=tick;event.pitch=pitch;event.rootPitch=src.rootPitch??60;event.playbackRate=Math.max(.25,Math.min(4,Math.pow(2,(event.pitch-event.rootPitch)/12)));}
    events.push(event);
  }
  next.pattern.events=events;
  if(bars!=null){const value=Math.max(clampBars(next.bars),clampBars(bars));next.bars=value;next.lengthTicks=value*ppq*4;}
  return next;
}

// ---------------------------------------------------------------- the store
const shared=new WeakMap();
/** One store per engine, so every editor of a project shares one queue. */
export function sharedPatternDocuments(engine,getProject,options={}){
  if(!engine||typeof engine!=='object')return new PatternDocumentStore({engine,getProject,...options});
  let store=shared.get(engine);if(!store){store=new PatternDocumentStore({engine,getProject,...options});shared.set(engine,store);}
  else if(getProject&&!store.getProject)store.getProject=getProject;
  return store;
}

export class PatternDocumentStore extends EventTarget{
  constructor({engine,getProject,debounceMs=60,timer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
    super();Object.assign(this,{engine,getProject,debounceMs,timer,clearTimer});
    this.entries=new Map();this.intents=[];this.projectId='';this.sequence=0;
  }
  emit(type,detail={}){this.dispatchEvent(new CustomEvent(type,{detail}));}
  scope(){
    const projectId=this.engine?.projectId||'';
    if(projectId!==this.projectId){for(const entry of this.entries.values())if(entry.timer!=null)this.clearTimer(entry.timer);this.entries.clear();this.projectId=projectId;}
    return projectId;
  }
  canonical(patternId){const project=this.getProject?.();return (project?.patterns||[]).find(p=>p&&p.id!=='empty'&&(String(p.id)===String(patternId)||String(p.cloudId)===String(patternId))&&p.cloudRaw)||null;}
  entry(patternId,{create=true}={}){
    this.scope();const id=String(patternId||'');if(!id)return null;let entry=this.entries.get(id);
    if(!entry&&create){
      const pattern=this.canonical(id);if(!pattern)return null;
      const doc=editableBody(patternDto(pattern.cloudRaw));
      entry={patternId:id,cloudPatternId:String(pattern.cloudId||pattern.id),projectId:this.projectId,base:pattern.cloudRaw,rawAtAck:null,refreshed:false,confirmed:doc,draft:clone(doc),seq:0,ackedSeq:0,dirty:false,timer:null,inflight:null,uncertain:null,error:null,revision:null,waiters:[]};
      this.entries.set(id,entry);
    }
    return entry||null;
  }
  /** Seed a pattern just created by a typed create (before the canonical read arrives). */
  adopt(patternId,doc){this.scope();const id=String(patternId);this.entries.set(id,{patternId:id,cloudPatternId:id,projectId:this.projectId,base:null,rawAtAck:null,refreshed:false,confirmed:clone(doc),draft:clone(doc),seq:0,ackedSeq:0,dirty:false,timer:null,inflight:null,uncertain:null,error:null,revision:null,waiters:[],adopted:true});return this.entries.get(id);}
  forgetPattern(patternId){const entry=this.entries.get(String(patternId));if(entry?.timer!=null)this.clearTimer(entry.timer);this.entries.delete(String(patternId));}
  draft(patternId){return this.entry(patternId)?.draft||null;}
  has(patternId){return !!this.entry(patternId,{create:false});}
  blocked(patternId){
    if(!this.engine?.ready)return 'Select a Freestyle project first.';
    const entry=this.entry(patternId);if(!entry)return 'Create or select a saved Freestyle pattern first.';
    if(entry.uncertain)return 'The previous pattern save has no confirmed result. Verify it before editing this pattern again.';
    try{this.engine.session?.assertNoInProgressWrites?.(this.engine.projectId);}catch(error){return error.message;}
    return '';
  }
  status(patternId){
    const entry=this.entry(patternId,{create:false});if(!entry)return {state:'idle'};
    if(entry.uncertain)return {state:'uncertain',intent:entry.uncertain,error:entry.uncertain.error};
    if(entry.inflight||entry.dirty||entry.timer!=null)return {state:'saving'};
    if(entry.error)return {state:'error',error:entry.error};
    return {state:'saved',revision:entry.revision};
  }
  /** Optimistic edit of the latest draft. Returns {ok,seq,before,after}. */
  edit(patternId,mutate,{origin='editor',label='Pattern edit'}={}){
    const reason=this.blocked(patternId);if(reason)return {ok:false,reason};
    const entry=this.entry(patternId),before=clone(entry.draft);let after;
    try{after=mutate(clone(before));}catch(error){return {ok:false,reason:error.message,error};}
    if(same(before,after))return {ok:true,unchanged:true,seq:entry.seq,before,after};
    const seq=++this.sequence;entry.draft=after;entry.seq=seq;entry.error=null;entry.refreshed=false;
    this.schedule(entry);this.emit('change',{patternId:entry.patternId,origin,label,seq});
    return {ok:true,seq,before,after};
  }
  schedule(entry,delay=this.debounceMs){
    entry.dirty=true;if(entry.inflight||entry.uncertain||entry.timer!=null)return;
    entry.timer=this.timer(()=>{entry.timer=null;this.dispatch(entry);},delay);
  }
  dispatch(entry){
    if(!entry.dirty||entry.inflight||entry.uncertain)return null;
    if(this.entries.get(entry.patternId)!==entry||entry.projectId!==this.engine?.projectId)return null;
    if(this.engine.session?.projectId&&this.engine.session.projectId!==entry.projectId)return null;
    const intent={key:uid(),projectId:entry.projectId,patternId:entry.patternId,seq:entry.seq,doc:clone(entry.draft),args:{pattern_id:entry.cloudPatternId,pattern:clone(entry.draft)},status:'sending',attempts:0,createdAt:Date.now()};
    // Retain the immutable intent BEFORE the request leaves the browser.
    Object.freeze(intent.args);this.intents.push(intent);if(this.intents.length>100)this.intents.splice(0,this.intents.length-100);
    entry.dirty=false;entry.inflight=intent;this.emit('status',{patternId:entry.patternId});
    return this.send(entry,intent);
  }
  async send(entry,intent){
    intent.attempts++;intent.status='sending';
    try{
      const session=this.engine.session;let result;
      if(session?.hasInProgressWrite?.(intent.projectId)&&intent.attempts>1){const recovered=await session.verifyInProgressWrite();result=body(recovered?.recoveryReceipt)??recovered;}
      else result=await session.action('update_pattern',clone(intent.args),{refresh:false,idempotencyKey:intent.key});
      intent.revision=result?.etag||result?.timelineRevision||result?.response?.timelineRevision||null;
      this.confirm(entry,intent);
    }catch(error){
      if(this.entries.get(entry.patternId)!==entry){intent.status='orphaned';intent.error=error?.message;return;}
      // Another retained write blocked local dispatch: this request never left.
      const blockedByOther=error?.pendingWrite&&error.pendingWrite.idempotencyKey!==intent.key&&intent.attempts===1;
      if(blockedByOther||!isIdempotencyInProgress(error)&&(error?.local||definiteCloudRejection(error)))this.reject(entry,intent,error);
      else{intent.status='uncertain';intent.error=error?.message||String(error);entry.inflight=null;entry.uncertain=intent;this.emit('status',{patternId:entry.patternId});this.emit('uncertain',{patternId:entry.patternId,intent,error});}
    }
  }
  confirm(entry,intent){
    intent.status='confirmed';intent.confirmedAt=Date.now();entry.inflight=null;entry.uncertain=null;entry.confirmed=clone(intent.doc);entry.ackedSeq=intent.seq;entry.error=null;entry.revision=intent.revision||entry.revision;
    entry.rawAtAck=this.canonical(entry.patternId)?.cloudRaw||null;entry.refreshed=false;
    this.emit('saved',{patternId:entry.patternId,intent});
    if(entry.dirty){this.dispatch(entry);return;}
    this.emit('status',{patternId:entry.patternId});this.settle(entry);
    // Background canonical readback; a failed read keeps the acknowledged draft.
    const session=this.engine.session,projectId=intent.projectId;
    Promise.resolve().then(()=>session?.refresh?.()).then(()=>{if(this.entries.get(entry.patternId)===entry&&this.engine.projectId===projectId){entry.refreshed=true;this.emit('refreshed',{patternId:entry.patternId});}},error=>{intent.refreshError=error?.message;});
  }
  reject(entry,intent,error){
    if(intent){intent.status='rejected';intent.error=error?.message||String(error);}
    entry.inflight=null;entry.uncertain=null;entry.dirty=false;if(entry.timer!=null){this.clearTimer(entry.timer);entry.timer=null;}
    entry.error=error?.message||String(error);entry.draft=clone(entry.confirmed);
    const ackedSeq=entry.ackedSeq;if(!ackedSeq&&!entry.adopted)this.entries.delete(entry.patternId);
    this.emit('status',{patternId:entry.patternId});this.emit('rejected',{patternId:entry.patternId,intent,error,ackedSeq});this.emit('change',{patternId:entry.patternId,origin:'rollback'});
    this.settle(entry,error);
  }
  settle(entry,error){if(entry.inflight||entry.dirty||entry.timer!=null||entry.uncertain)return;const waiters=entry.waiters.splice(0);for(const w of waiters)error?w.reject(error):w.resolve();}
  /** Explicitly verify an unknown save by replaying its exact key and body. */
  async verify(patternId){
    const entry=this.entry(patternId,{create:false}),intent=entry?.uncertain;if(!intent)return {ok:false,reason:'No unconfirmed pattern save is waiting.'};
    if(this.engine?.projectId!==intent.projectId)return {ok:false,reason:'Return to the original project before verifying its pattern save.'};
    entry.uncertain=null;entry.inflight=intent;this.emit('status',{patternId});
    await this.send(entry,intent);return {ok:intent.status==='confirmed',status:intent.status,error:intent.error};
  }
  /** Dispatch now and wait until the latest draft is acknowledged (or rejected). */
  flush(patternId){
    const entries=patternId!=null?[this.entry(patternId,{create:false})].filter(Boolean):[...this.entries.values()];
    return Promise.all(entries.map(entry=>{
      if(entry.uncertain)return Promise.reject(new Error('A pattern save has an unconfirmed result. Verify it first.'));
      if(!entry.inflight&&!entry.dirty&&entry.timer==null)return entry.error&&entry.ackedSeq<entry.seq?Promise.reject(new Error(entry.error)):null;
      const wait=new Promise((resolve,reject)=>entry.waiters.push({resolve,reject}));
      if(entry.timer!=null){this.clearTimer(entry.timer);entry.timer=null;this.dispatch(entry);}
      return wait;
    }));
  }
  pending(){for(const entry of this.entries.values())if(entry.inflight||entry.dirty||entry.uncertain||entry.timer!=null)return true;return false;}
  /** Adopt a newer canonical read for idle documents; never a stale pre-ack read. */
  sync(){
    this.scope();let changed=false;
    for(const entry of [...this.entries.values()]){
      if(entry.inflight||entry.dirty||entry.uncertain||entry.timer!=null||entry.error)continue;
      const raw=this.canonical(entry.patternId)?.cloudRaw||null;if(!raw)continue;
      const fresh=entry.ackedSeq||entry.seq?(entry.refreshed&&raw!==entry.rawAtAck):(raw!==entry.base);
      if(fresh||entry.adopted&&!entry.seq){this.entries.delete(entry.patternId);changed=true;}
    }
    return changed;
  }
}
