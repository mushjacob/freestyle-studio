/** Revision-guarded, live-synced mix controls (Freestyle agent-safe mixing, 318-op contract).
 *
 * - GET  /projects/{id}/engine/mix            → mixRevision (+ ETag "mix-<n>"), changes on every mix edit from any client.
 * - Lane gain/pan/mute/solo, routing, master and bus writes carry expected_mix_revision; stale → 412 mix_revision_conflict.
 * - POST .../engine/mix:apply {changes, expected_mix_revision} → all-or-nothing, one revision step, returns undo_changes.
 * - GET  .../engine/mix:wait?if_none_match=<rev>&wait_ms≤10000 → long-poll (≤2 in flight per user).
 *
 * On a conflict the client never resends: it re-reads, shows the other person's value and posts a short notice.
 * Mute/solo toggles are not undo entries. A gain or pan gesture is heard while the control moves (sweep) and is
 * saved once when it ends (commit): one guarded write and one Edit → Undo entry ("Moved gain slider").
 * Multi-control actions go through mix:apply and their returned undo_changes are Edit → Undo / Redo steps.
 *
 * Bridge (POST /api/call, gated on /api/tools features mixRevision / mixWait):
 *   getEngineMix {project_id} → masterGain, tracks, buses, etag "mix-<n>", mixRevision
 *   applyEngineMix {project_id, changes[≤64], expected_mix_revision, idempotency_key} → mixRevision, response.undo_changes
 *   waitEngineMix {project_id, if_none_match:<n>, wait_ms≤10000} → full mix (unchanged:false) | {unchanged:true}; 3rd wait → 429 mix_wait_limit
 *   setLaneGain/Pan/Mute/Solo/Routing {project_id, lane_id, …}, setMasterGain {project_id, gain}, setBusGain/Mute/Solo {project_id, bus_id, …}
 *   + expected_mix_revision; 412 {code: mix_revision_conflict, details:{retryable:false, current, currentMixRevision}}
 */
import {FrameRequestLimiter} from './plugin-editor-http.js';
import {viewHidden,viewActivity} from './freestyle-host-transport.js';

export const MIX_OPERATIONS=Object.freeze({read:'getEngineMix',wait:'waitEngineMix',apply:'applyEngineMix'});
export const MIX_WAIT_MS=10000,MIX_WAIT_CONCURRENCY=2;
/** Separate from the plugin-editor frame cap: at most two mix long-polls per user. */
export const sharedMixWaitLimiter=new FrameRequestLimiter(MIX_WAIT_CONCURRENCY);
export const MIX_CHANGED_NOTICE='Mix changed elsewhere — updated';
/** Pacing of REST writes while a control is held (the data-channel path has its own ≈30 Hz throttle), and the
 *  window in which successive steps on one control share an undo entry. */
export const LIVE_REST_INTERVAL_MS=50,CONSOLIDATE_MS=1000;

const list=value=>Array.isArray(value)?value:[];
const finite=value=>value!==null&&value!==''&&value!==undefined&&Number.isFinite(Number(value));
const unwrap=result=>{let data=result?.structuredContent??result;for(let i=0;i<4&&data?.response&&typeof data.response==='object'&&!Array.isArray(data.response);i++)data={...data,...data.response,response:undefined};return data||{};};
const uid=()=>globalThis.crypto?.randomUUID?.()||`mix-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Gains are float32 on the engine: equal within 1e-6 relative (absolute near zero). */
export function sameMixValue(a,b){if(typeof a==='boolean'||typeof b==='boolean')return a===b;if(!finite(a)||!finite(b))return a===b;const x=Number(a),y=Number(b);return Math.abs(x-y)<=1e-6*Math.max(1,Math.abs(x),Math.abs(y));}
export function mixRevisionOf(value,etag){
  const data=unwrap(value);const direct=data?.mixRevision??data?.mix_revision??data?.mix?.mixRevision??data?.revision;
  if(direct!==undefined&&direct!==null&&String(direct)!=='')return String(direct);
  const tag=String(etag??data?.etag??data?.ETag??'').replace(/^W\//,'').replace(/"/g,'');const match=/^mix-(.+)$/.exec(tag);return match?match[1]:null;
}
export const revisionTag=revision=>`"mix-${revision}"`;
export const isMixConflict=error=>error?.code==='mix_revision_conflict'||error?.details?.conflict==='mix_revision_conflict'||Number(error?.status)===412&&/mix_revision_conflict/.test(String(error?.message||''));
export const isParameterConflict=error=>error?.code==='plugin_parameter_conflict'||Number(error?.status)===412&&/plugin_parameter_conflict/.test(String(error?.message||''));

export const mixKey=(kind,id,field)=>`${kind}:${id}:${field}`;
const parseKey=key=>{const [kind,id,field]=String(key).split(':');return{kind,id,field};};

/** Tolerant reader for the engine mix body: lanes/tracks, master and buses. */
export function normalizeMix(value,etag){
  const data=unwrap(value),mix=data.mix&&typeof data.mix==='object'?{...data,...data.mix}:data,values=new Map();
  const put=(kind,id,field,raw,cast)=>{if(raw===undefined||raw===null||!id)return;values.set(mixKey(kind,id,field),cast(raw));};
  for(const row of [...list(mix.lanes),...list(mix.tracks)]){
    const id=String(row?.lane_id??row?.laneId??row?.db_track_id??row?.dbTrackId??row?.id??'');
    put('lane',id,'gain',row.gain??row.volume,Number);put('lane',id,'pan',row.pan,Number);put('lane',id,'muted',row.muted??row.mute,Boolean);put('lane',id,'soloed',row.soloed??row.solo,Boolean);put('lane',id,'bus',row.bus_id??row.busId,String);
  }
  for(const row of list(mix.buses?.buses??mix.buses)){const id=String(row?.bus_id??row?.busId??row?.id??'');if(id==='master')continue;put('bus',id,'gain',row.gain,Number);put('bus',id,'muted',row.muted,Boolean);put('bus',id,'soloed',row.soloed,Boolean);}
  const master=mix.master?.gain??mix.masterGain??mix.master_gain??list(mix.buses?.buses??mix.buses).find(row=>(row?.bus_id??row?.id)==='master')?.gain;
  put('master','master','gain',master,Number);
  return{revision:mixRevisionOf(data,etag),values};
}

/** Single-control write for one mix key, carrying the revision guard. */
export function writeFor(key,value,revision){
  const {kind,id,field}=parseKey(key),guard=revision!=null?{expected_mix_revision:Number.isFinite(Number(revision))?Number(revision):revision}:{};
  if(kind==='lane'&&field==='gain')return['setLaneGain',{lane_id:id,gain:Number(value),...guard}];
  if(kind==='lane'&&field==='pan')return['setLanePan',{lane_id:id,pan:Number(value),...guard}];
  if(kind==='lane'&&field==='muted')return['setLaneMute',{lane_id:id,muted:!!value,...guard}];
  if(kind==='lane'&&field==='soloed')return['setLaneSolo',{lane_id:id,soloed:!!value,...guard}];
  if(kind==='lane'&&field==='bus')return['setLaneRouting',{lane_id:id,bus_id:String(value),...guard}];
  if(kind==='master'&&field==='gain')return['setMasterGain',{gain:Number(value),...guard}];
  if(kind==='bus'&&field==='gain')return['setBusGain',{bus_id:id,gain:Number(value),...guard}];
  if(kind==='bus'&&field==='muted')return['setBusMute',{bus_id:id,muted:!!value,...guard}];
  if(kind==='bus'&&field==='soloed')return['setBusSolo',{bus_id:id,soloed:!!value,...guard}];
  throw new Error(`Unsupported mix control ${key}.`);
}
/** One applyEngineMix change. Bus/master pan is not supported there. */
export function applyChange(key,value){
  const {kind,id,field}=parseKey(key);
  if((kind==='bus'||kind==='master')&&field==='pan')throw new Error('mix:apply does not support bus or master pan.');
  if(kind==='lane')return{target:'lane',lane_id:id,[field==='bus'?'bus_id':field]:value};
  if(kind==='master')return{target:'master',[field]:value};
  return{target:'bus',bus_id:id,[field]:value};
}
/** Expands one applyEngineMix change (possibly several fields) into [key,value] pairs. */
export function changeEntries(change){
  const fields=['gain','pan','muted','soloed'],out=[];
  if(change?.target==='lane'||change?.lane_id!==undefined){for(const field of fields)if(change[field]!==undefined)out.push([mixKey('lane',change.lane_id,field),change[field]]);if(change.bus_id!==undefined)out.push([mixKey('lane',change.lane_id,'bus'),change.bus_id]);}
  else if(change?.target==='master'){if(change.gain!==undefined)out.push([mixKey('master','master','gain'),change.gain]);}
  else if(change?.target==='bus'||change?.bus_id!==undefined){for(const field of fields)if(change[field]!==undefined)out.push([mixKey('bus',change.bus_id,field),change[field]]);}
  return out;
}

export class MixSync extends EventTarget{
  constructor({call,action=null,projectId,contextTrackId=null,limiter=sharedMixWaitLimiter,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),sleep=(ms,signal)=>new Promise((resolve,reject)=>{const id=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(id);reject(Object.assign(new Error('aborted'),{name:'AbortError'}));},{once:true});}),debounceMs=150,waitMs=MIX_WAIT_MS,notice=null,documentRef=globalThis.document,live=null,liveIntervalMs=LIVE_REST_INTERVAL_MS,now=()=>globalThis.performance?.now?.()??Date.now()}={}){
    super();if(typeof call!=='function')throw new Error('A Freestyle call function is required for mix sync.');if(!projectId)throw new Error('Open a cloud project before syncing its mix.');
    Object.assign(this,{call,action,projectId,contextTrackId,limiter,setTimer,clearTimer,sleep,debounceMs,waitMs,notice,documentRef,live,liveIntervalMs,now});
    this.revision=null;this.server=new Map();this.local=new Map();this.dragging=new Set();this.deferred=new Set();this.timers=new Map();this.inflight=new Map();this.queued=new Set();
    // Live sweep state (one gesture per key): the value before the gesture, the latest unsent value, the REST
    // write in flight, keys whose realtime path was used / refused, and keys that moved during the gesture.
    this.dragStart=new Map();this.sweepValue=new Map();this.sweepBusy=new Map();this.sweepTimers=new Map();this.swept=new Set();this.noLive=new Set();this.touched=new Set();
    this.past=new Map();this.future=new Map();this.generation=0;this.stats={reads:0,waits:0,writes:0,conflicts:0,live:0,liveWrites:0,commits:0};
  }
  context(){return{project_id:this.projectId};}
  /** Value shown for a control: the pending local value, else the server's. */
  value(key){return this.local.has(key)?this.local.get(key):this.server.get(key);}
  adopt(mix,{source='read'}={}){
    if(mix.revision!=null)this.revision=mix.revision;const changed=[],skipped=[];
    for(const [key,value] of mix.values){
      const before=this.server.get(key);this.server.set(key,value);
      if(this.dragging.has(key)||this.timers.has(key)||this.inflight.has(key)){if(!sameMixValue(before,value)){this.deferred.add(key);skipped.push(key);}continue;}
      this.local.delete(key);if(!sameMixValue(before,value))changed.push(key);
    }
    this.dispatchEvent(new CustomEvent('change',{detail:{revision:this.revision,changed,skipped,source}}));return{changed,skipped};
  }
  async read(){this.stats.reads++;const generation=this.generation;const result=await this.call(MIX_OPERATIONS.read,this.context());if(generation!==this.generation)return null;const mix=normalizeMix(result,result?.etag);this.adopt(mix);return mix;}
  /** A gesture starts: remember the saved value (the Undo target); `fallback` is what the control showed if no mix was read yet. */
  begin(key,fallback){this.dragging.add(key);if(!this.dragStart.has(key))this.dragStart.set(key,this.server.has(key)?this.server.get(key):fallback);}
  /** Pointer released without moving the control: nothing to commit. */
  release(key){if(this.touched.has(key))return false;this.dragStart.delete(key);this.end(key);return true;}
  /** The control moved (pointer drag or one keyboard step): the engine must follow NOW, not on release.
   *  `live(key,value)` (supplied by the view) is the realtime path: it returns true when the value went out on the
   *  mozart-control data channel (lane gain), a promise for a live REST write, or false when there is none.
   *  - data channel: throttled and coalesced by LiveControl (≈30 Hz, latest value wins), no ack, not saved;
   *  - live REST (`persist:false`, the documented sweep form): one request in flight per control, the latest
   *    value goes out when it returns, at most one per liveIntervalMs;
   *  - no realtime path (lane pan through this bridge): the same pacing with the guarded saved write.
   *  Nothing is recorded in history here; commit() does that once, when the gesture ends. */
  sweep(key,value){
    this.local.set(key,value);this.touched.add(key);
    const timer=this.timers.get(key);if(timer!=null){this.clearTimer(timer);this.timers.delete(key);}
    this.sweepValue.set(key,value);this.pump(key);
  }
  pump(key){
    if(this.sweepBusy.has(key)||!this.sweepValue.has(key))return;
    const value=this.sweepValue.get(key),generation=this.generation;this.sweepValue.delete(key);
    let sent=false;if(this.live&&!this.noLive.has(key)){try{sent=this.live(key,value);}catch{sent=false;}}
    if(sent===true){this.swept.add(key);this.stats.live++;return;}
    // A refused live write (older bridge, no persist:false) is not lost: the control falls back to the paced
    // saved write for the rest of the gesture, starting with the value that was refused.
    const started=this.now(),refused=()=>{this.noLive.add(key);if(!this.sweepValue.has(key)&&this.local.has(key))this.sweepValue.set(key,this.local.get(key));};
    const task=(sent&&typeof sent.then==='function'
      ?Promise.resolve(sent).then(ok=>{if(ok===false)refused();else{this.swept.add(key);this.stats.live++;}},refused)
      :this.flush(key).then(()=>{},()=>{}))
      .then(()=>{
        if(generation!==this.generation||this.sweepBusy.get(key)!==task)return;
        const next=()=>{this.sweepTimers.delete(key);if(this.sweepBusy.get(key)===task)this.sweepBusy.delete(key);this.pump(key);},rest=this.liveIntervalMs-(this.now()-started);
        if(rest>0&&this.sweepValue.has(key))this.sweepTimers.set(key,this.setTimer(next,rest));else next();
      });
    this.sweepBusy.set(key,task);
  }
  /** Live-only REST write for one control (`persist:false`): heard at once, not saved, no revision guard. */
  async liveWrite(key,value){
    const [name,args]=writeFor(key,value,null);this.stats.liveWrites++;
    await this.call(name,{project_id:this.projectId,...args,persist:false,idempotency_key:uid()});return true;
  }
  /** The gesture ended: ONE guarded, saved write of the final value and (with a label) ONE Edit → Undo entry
   *  that restores the value the control had when the gesture began. */
  async commit(key,value,{label=null}={}){
    const before=this.dragStart.get(key),generation=this.generation;this.dragStart.delete(key);
    if(value!==undefined)this.local.set(key,value);
    for(const timers of [this.timers,this.sweepTimers]){const timer=timers.get(key);if(timer!=null){this.clearTimer(timer);timers.delete(key);}}
    this.sweepValue.delete(key);this.dragging.add(key);this.stats.commits++;
    try{
      const busy=this.sweepBusy.get(key);this.sweepBusy.delete(key);if(busy)await busy;
      while(this.inflight.has(key))try{await this.inflight.get(key);}catch{}
      if(generation!==this.generation)return null;
      // Live values may have advanced the mix revision: take the current one so the saved write is not refused
      // as a conflict with our own sweep. The held control keeps its local value through this read.
      if(this.swept.delete(key))try{await this.read();}catch{}
      if(generation!==this.generation)return null;
      let result=null,saved=true;
      if(this.local.has(key)){result=await this.flush(key);saved=!!result;}
      const final=this.server.get(key);
      if(saved&&label&&before!==undefined&&final!==undefined&&!sameMixValue(before,final))this.record(label,key,before,final);
      return result;
    }finally{
      this.noLive.delete(key);this.touched.delete(key);this.dragging.delete(key);this.deferred.delete(key);
      if(generation===this.generation)this.dispatchEvent(new CustomEvent('change',{detail:{revision:this.revision,changed:[key],skipped:[],source:'release'}}));
    }
  }
  /** One undo entry per gesture; quick successive steps on the same control (keyboard arrows) extend the last one. */
  record(label,key,before,after){
    const past=this.stack(this.past),future=this.stack(this.future),top=past.at(-1),at=this.now();
    if(top&&top.key===key&&top.label===label&&!future.length&&at-top.at<CONSOLIDATE_MS){top.redo=[applyChange(key,after)];top.at=at;top.revision=this.revision;return top;}
    const entry={label,key,at,undo:[applyChange(key,before)],redo:[applyChange(key,after)],revision:this.revision};
    past.push(entry);future.length=0;this.dispatchEvent(new CustomEvent('recorded',{detail:{label}}));return entry;
  }
  /** Releasing a control reconciles it with anything that changed elsewhere while it was held. */
  end(key){this.dragging.delete(key);if(this.deferred.delete(key)&&!this.timers.has(key)&&!this.inflight.has(key)){this.local.delete(key);this.dispatchEvent(new CustomEvent('change',{detail:{revision:this.revision,changed:[key],skipped:[],source:'release'}}));}}
  /** Optimistic local value; sliders are debounced, toggles write immediately. The final value goes with the latest revision. */
  set(key,value,{debounce=true}={}){
    this.local.set(key,value);const timer=this.timers.get(key);if(timer!=null)this.clearTimer(timer);this.timers.delete(key);
    if(!debounce)return this.flush(key);
    return new Promise(resolve=>{this.timers.set(key,this.setTimer(()=>{this.timers.delete(key);resolve(this.flush(key));},this.debounceMs));});
  }
  /** Guarded single write: typed bridge op with the revision; one attempt, never resent after a conflict. */
  async send(name,args){this.stats.writes++;return unwrap(await this.call(name,{project_id:this.projectId,...args,idempotency_key:uid()}));}
  async flush(key){
    if(this.inflight.has(key)){this.queued.add(key);return this.inflight.get(key);}
    if(!this.local.has(key))return null;
    const value=this.local.get(key),generation=this.generation;
    const task=(async()=>{
      try{
        const [name,args]=writeFor(key,value,this.revision);const result=await this.send(name,args);if(generation!==this.generation)return result;
        const revision=mixRevisionOf(result);if(revision!=null)this.revision=revision;this.server.set(key,value);
        if(!this.queued.has(key)&&!this.timers.has(key)&&sameMixValue(this.local.get(key),value))this.local.delete(key);
        if(revision==null)this.read().catch(()=>{});
        this.dispatchEvent(new CustomEvent('written',{detail:{key,value,revision:this.revision,result}}));return result;
      }catch(error){
        if(generation!==this.generation)return null;
        this.queued.delete(key);const pending=this.timers.get(key);if(pending!=null){this.clearTimer(pending);this.timers.delete(key);}
        this.local.delete(key);
        if(isMixConflict(error)){this.stats.conflicts++;this.inflight.delete(key);try{await this.read();}catch{}this.post(MIX_CHANGED_NOTICE);this.dispatchEvent(new CustomEvent('conflict',{detail:{key,attempted:value,error}}));return null;}
        this.dispatchEvent(new CustomEvent('change',{detail:{revision:this.revision,changed:[key],skipped:[],source:'rollback'}}));this.dispatchEvent(new CustomEvent('error',{detail:{key,error}}));throw error;
      }
    })();
    this.inflight.set(key,task);
    try{return await task;}finally{if(this.inflight.get(key)===task)this.inflight.delete(key);if(this.queued.delete(key)&&generation===this.generation)this.flush(key);}
  }
  post(message){try{this.notice?.(message);}catch{}this.dispatchEvent(new CustomEvent('notice',{detail:{message}}));}
  /** All-or-nothing multi-control change in one revision step; its undo_changes become one undo entry. */
  async apply(entries,{label='Mix change',record=true}={}){
    const keys=entries.map(([key])=>key),changes=entries.map(([key,value])=>applyChange(key,value)),generation=this.generation;
    for(const [key,value] of entries)this.local.set(key,value);
    this.dispatchEvent(new CustomEvent('change',{detail:{revision:this.revision,changed:keys,skipped:[],source:'optimistic'}}));
    try{
      this.stats.writes++;const result=unwrap(await this.call(MIX_OPERATIONS.apply,{project_id:this.projectId,changes,...this.revision!=null?{expected_mix_revision:Number.isFinite(Number(this.revision))?Number(this.revision):this.revision}:{},idempotency_key:uid()}));
      if(generation!==this.generation)return result;
      const revision=mixRevisionOf(result);if(revision!=null)this.revision=revision;
      for(const [key,value] of entries){this.server.set(key,value);this.local.delete(key);}
      const undo=Array.isArray(result.undo_changes)?result.undo_changes:Array.isArray(result.undoChanges)?result.undoChanges:null;
      if(record&&undo){this.stack(this.past).push({label,undo,redo:changes,revision:this.revision});this.stack(this.future).length=0;this.dispatchEvent(new CustomEvent('recorded',{detail:{label}}));}
      if(revision==null)this.read().catch(()=>{});
      return{...result,undo_changes:undo};
    }catch(error){
      for(const key of keys)this.local.delete(key);
      if(isMixConflict(error)){this.stats.conflicts++;try{await this.read();}catch{}this.post(MIX_CHANGED_NOTICE);this.dispatchEvent(new CustomEvent('conflict',{detail:{keys,error}}));return null;}
      this.dispatchEvent(new CustomEvent('change',{detail:{revision:this.revision,changed:keys,skipped:[],source:'rollback'}}));throw error;
    }
  }
  stack(map,id=this.projectId){if(!map.has(id))map.set(id,[]);return map.get(id);}
  uncertain(){return false;}unverified(){return false;}
  /** Owned-history hook for Edit → Undo / Redo: replays the stored change set through mix:apply with the revision guard. */
  async history(direction){
    const from=this.stack(direction==='undo'?this.past:this.future),to=this.stack(direction==='undo'?this.future:this.past),entry=from.at(-1);if(!entry)return false;
    const changes=direction==='undo'?entry.undo:entry.redo,entries=changes.flatMap(changeEntries);
    const result=await this.apply(entries,{label:entry.label,record:false});if(!result)throw new Error(`${MIX_CHANGED_NOTICE}. ${direction==='undo'?'Undo':'Redo'} was not applied.`);
    from.pop();to.push({...entry,...direction==='undo'?{redo:entry.redo,undo:entry.undo}:{undo:result.undo_changes||entry.undo}});return true;
  }
  /** One mix:wait long-poll loop while the project is open and the page is visible. */
  start(){
    if(this.running)return this.loop;this.running=true;this.abort=new AbortController();
    // Paused while the tab is hidden or another Studio view is active (viewHidden).
    if(this.documentRef&&!this.visibility){this.visibility=()=>{if(viewHidden(this.documentRef))this.pause();else this.resume();};this.documentRef.addEventListener('visibilitychange',this.visibility);viewActivity.addEventListener('change',this.visibility);}
    if(this.documentRef&&viewHidden(this.documentRef)){this.paused=true;this.running=false;return null;}
    const signal=this.abort.signal;this.loop=this.run(signal).finally(()=>{if(this.abort?.signal===signal)this.running=false;});return this.loop;
  }
  pause(){this.paused=true;this.running=false;this.abort?.abort();}
  resume(){if(!this.paused||this.stopped)return;this.paused=false;this.start();}
  stop(){this.stopped=true;this.generation++;this.pause();if(this.visibility){this.documentRef?.removeEventListener('visibilitychange',this.visibility);viewActivity.removeEventListener('change',this.visibility);this.visibility=null;}for(const timers of [this.timers,this.sweepTimers]){for(const id of timers.values())this.clearTimer(id);timers.clear();}this.sweepValue.clear();this.sweepBusy.clear();}
  async run(signal){
    let failures=0;
    if(this.revision==null)try{await this.read();}catch{}
    while(!signal.aborted){
      let release;
      try{
        release=await this.limiter.acquire(signal);this.stats.waits++;
        const result=await this.call(MIX_OPERATIONS.wait,{...this.context(),...this.revision!=null?{if_none_match:Number.isFinite(Number(this.revision))?Number(this.revision):this.revision}:{},wait_ms:this.waitMs},{signal});
        release();release=null;failures=0;if(signal.aborted)return;
        const data=unwrap(result),revision=mixRevisionOf(data,data?.etag);
        if(data?.unchanged===true||data?.changed===false||revision!=null&&revision===this.revision)continue;
        const mix=normalizeMix(data,data?.etag);
        if(mix.values.size)this.adopt(mix,{source:'wait'});else await this.read();
      }catch(error){
        release?.();if(error?.name==='AbortError'||signal.aborted)return;
        failures++;const retry=Number(error?.details?.retryAfterSec)*1000;try{await this.sleep(Math.min(30000,Number.isFinite(retry)&&retry>0?retry:1000*2**Math.min(failures-1,5)),signal);}catch{return;}
      }
    }
  }
}

/** Plugin parameter writes: expected_value_norm (what the UI last showed) next to the instance guard. */
export function parameterGuard(shownValue){return finite(shownValue)?{expected_value_norm:Number(shownValue)}:{};}
