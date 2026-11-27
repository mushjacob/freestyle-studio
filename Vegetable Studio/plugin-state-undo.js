/** B06 undoable plugin preset apply. Pure (no DOM, no I/O): a bounded in-memory ring of lane-plugin
 *  state snapshots plus the one history step an "apply preset" records. The transport is injected:
 *  snapshot() -> getLanePluginSnapshot body, restore(target,snapshot) -> restoreLanePluginState (in place,
 *  pinned to the instance id). Snapshots live in memory only; FL's Undo does not survive a reload either. */
export const MAX_SNAPSHOT_ENTRIES=8;
export const MAX_SNAPSHOT_BYTES=16*1024*1024;
export const TOO_LARGE_REASON='state too large to snapshot';
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const reasonError=(message,extra={})=>Object.assign(new Error(message),{dispatched:false,historyNotApplied:true,...extra});
/** Parse a getLanePluginSnapshot body: {ok:true,snapshot} or {ok:false,reason} (undo disabled, apply still allowed). */
export function snapshotFromResponse(body){
 const data=record(body?.data)&&!('state' in body)?body.data:body;
 if(!record(data))return{ok:false,reason:'the plugin state could not be read'};
 if(data.state_omitted==='too_large')return{ok:false,reason:TOO_LARGE_REASON};
 if(typeof data.state!=='string'||!data.state)return{ok:false,reason:'this plugin has no state to snapshot'};
 if(typeof data.instance_id!=='string'||!data.instance_id)return{ok:false,reason:'the plugin state has no instance id'};
 if(data.native!==true&&typeof data.state_signature!=='string')return{ok:false,reason:'the plugin state was not signed'};
 return{ok:true,snapshot:{instanceId:data.instance_id,type:typeof data.type==='string'?data.type:null,state:data.state,signature:data.state_signature??null,
  params:Array.isArray(data.params)?data.params.map(item=>({index:item.index,value_norm:item.value_norm})):null,bypassed:typeof data.bypassed==='boolean'?data.bypassed:null,
  hash:typeof data.state_hash==='string'?data.state_hash:null,bytes:data.state.length}};
}
/** restoreLanePluginState body for a snapshot (the instance pin is required by the API). */
export function restoreBody(snapshot){
 return{expected_plugin_instance_id:snapshot.instanceId,...(snapshot.type?{expected_plugin_type:snapshot.type}:{}),state:snapshot.state,
  ...(snapshot.signature?{state_signature:snapshot.signature}:{}),...(snapshot.params?.length?{params:snapshot.params}:{}),...(snapshot.bypassed!==null?{bypassed:snapshot.bypassed}:{})};
}
/** One ring for every preset surface (mixer menu, Browser Presets folder): the 8-entry / 16 MiB caps are global. */
export class PluginStateUndoRing{
 constructor({maxEntries=MAX_SNAPSHOT_ENTRIES,maxBytes=MAX_SNAPSHOT_BYTES,onEvict=()=>{}}={}){this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.onEvict=onEvict;this.entries=[];}
 get bytes(){return this.entries.reduce((sum,entry)=>sum+(entry.before?.bytes||0)+(entry.after?.bytes||0),0);}
 add(entry){const item={...entry,evicted:false};this.entries.push(item);this.trim(item);return item;}
 /** Keep the redo payload (the "after" snapshot) and re-apply the caps. */
 setAfter(entry,snapshot){if(entry.evicted)return false;entry.after=snapshot;this.trim(entry);return !entry.evicted;}
 trim(keep){
  // Oldest first; the entry being written is only evicted last (a single snapshot over the cap cannot be kept).
  while(this.entries.length&&(this.entries.length>this.maxEntries||this.bytes>this.maxBytes)){
   const victim=this.entries.find(entry=>entry!==keep)||this.entries[0];this.entries.splice(this.entries.indexOf(victim),1);
   victim.evicted=true;victim.before=null;victim.after=null;try{this.onEvict(victim);}catch{}
  }
 }
}
export const sharedPluginStateRing=new PluginStateUndoRing();
/** The history step for one applied preset. `before` is the snapshot taken ahead of the apply;
 *  `transport(task)` runs task({snapshot(), restore(target,snapshot)}) in the caller's own (history-scoped) context.
 *  Undo restores `before` and keeps the state it replaced as the redo payload; Redo restores that. */
export function presetUndoStep({ring=sharedPluginStateRing,label,target,before,transport}){
 const entry=ring.add({target:{...target},before,after:null});
 const live=()=>{if(entry.evicted)throw reasonError(`${label} can no longer be undone: its saved settings were dropped to save memory.`);};
 const gone=()=>reasonError(`${target.name||'That plugin'} is no longer in this slot, so this step was not applied.`);
 const put=async(io,snapshotToApply)=>{if(snapshotToApply.instanceId!==target.instanceId)throw gone();await io.restore({...target},snapshotToApply);};
 const undo=()=>transport(async io=>{
  live();
  let current=null;try{const parsed=snapshotFromResponse(await io.snapshot({...target}));if(parsed.ok)current=parsed.snapshot;}catch{current=null;}
  if(current&&current.instanceId!==target.instanceId)throw gone();
  if(current)ring.setAfter(entry,current);else entry.after=null;
  live();await put(io,entry.before);
 });
 const redo=()=>transport(async io=>{live();if(!entry.after)throw reasonError(`${label} cannot be redone: the replaced settings could not be read.`);await put(io,entry.after);});
 return{detail:{laneId:target.laneId,op:'preset',instanceId:target.instanceId,type:target.type??null,label},undo,redo};
}
/** Read the pre-apply snapshot: {before}, or {reason} when undo must stay disabled (the apply is still allowed). */
export async function readPresetSnapshot(snapshot,target,log=()=>{}){
 try{const parsed=snapshotFromResponse(await snapshot({...target}));if(!parsed.ok)return{reason:parsed.reason};if(parsed.snapshot.instanceId!==target.instanceId)return{reason:'the slot holds another plugin'};return{before:parsed.snapshot};}
 catch(error){log('plugin-state-snapshot-failed',{message:String(error?.message||'').slice(0,160)});return{reason:'the plugin state could not be read'};}
}
/** Snapshot, apply, record ONE undo step. Returns {result, undoable, reason}; `apply` runs exactly once whatever the snapshot outcome. */
export async function applyWithUndo({ring=sharedPluginStateRing,history,label,target,snapshot,restore,apply,log=()=>{}}){
 const read=await readPresetSnapshot(snapshot,target,log);
 if(!read.before||typeof history?.beginExternalStep!=='function'){const result=await apply();return{result,undoable:false,reason:read.reason||'history is unavailable'};}
 let token=null;try{token=history.beginExternalStep({kind:'plugin_state',label});}catch(error){log('plugin-state-begin-refused',{label,message:String(error?.message||'').slice(0,160)});}
 let result;try{result=await apply();}catch(error){if(token)history.failExternalStep(token,error);throw error;}
 const step=presetUndoStep({ring,label,target,before:read.before,transport:task=>task({snapshot,restore})});
 if(token)history.finishExternalStep(token,step);else history.recordExternalStep?.({kind:'plugin_state',label,...step});
 return{result,undoable:true,reason:null};
}
