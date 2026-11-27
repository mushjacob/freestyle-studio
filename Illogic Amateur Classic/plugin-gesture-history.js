/** FL: one plugin GUI gesture (a knob or fader drag, one scroll burst) is ONE
 * Undo step, whichever parameters it moved.
 *
 * The plugin's typed parameter values are captured when the gesture starts
 * (a fresh cached read when there is one, otherwise one read that never blocks
 * the drag), read back once the gesture's terminal input is confirmed, and the
 * difference becomes one step. Undo/Redo re-read the parameters first and
 * refuse (dispatched:false) when any of them no longer holds the step's side;
 * each write then goes through the controller's instance-pinned
 * compare-and-set (expected_plugin_instance_id + expected_value_norm, 409/412
 * on a mismatch). A failure part-way puts the landed writes back. Nothing is
 * ever guessed or retried.
 */
import {isPluginParameterConflict,pluginConflictValue} from './mix-revision.js';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const near=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=Math.max(1e-6,Math.abs(b)*1e-6);
/** Round 38: a gesture's "before" comes from the dialog's cached values when they were read
 * within this window (every post-gesture read-back refreshes them), so pointer-down never
 * races a parameter read on the engine (that made the REST down ~120 ms slower and its
 * frame ~330 ms later). An unconfirmed gesture invalidates the cache. */
export const PLUGIN_GESTURE_FRESH_MS=60000;
export const PLUGIN_GESTURE_SCROLL_IDLE_MS=400;
/** Channel input (mozart-editor on a write peer grant, Freestyle release 2026-11-12) has no
 * per-input receipt: the gesture's up is only 'dispatched'. The read-back waits this settle
 * (the native knob view's 250 ms), and an unchanged first read-back is read once more after it. */
export const PLUGIN_GESTURE_CHANNEL_SETTLE_MS=250;

/** The plug-in's own display text ("-24.32" + "dB" → "−24.32 dB"); '' when it reports none. */
export function formatPluginValueText(text,unit){
 let value=String(text??'').trim();if(!value)return'';value=value.replace(/^-(?=\d|\.)/,'−');
 const suffix=typeof unit==='string'?unit.trim():'';return suffix&&!value.toLowerCase().endsWith(suffix.toLowerCase())?`${value} ${suffix}`:value;
}
const shown=row=>row?.display||(finite(row?.value)?row.form==='physical'?String(Math.round(row.value*100)/100):`${Math.round(row.value*1000)/10}%`:'unknown');
/** {index,id,name,form,value,display} for every loaded, writable, non-stale parameter (value in its write form). */
export function parameterSnapshot(controller){
 const rows=[];
 for(const parameter of Array.isArray(controller?.parameters)?controller.parameters:[]){
  if(!parameter||parameter.stale===true||!Number.isInteger(parameter.index))continue;let control=null;try{control=controller.parameterControl(parameter);}catch{control=null;}
  if(!control||!finite(control.value))continue;rows.push({index:parameter.index,id:parameter.id??null,name:parameter.name||`Parameter ${parameter.index}`,form:control.form,value:control.value,display:formatPluginValueText(parameter.display,parameter.unit??control.unit)});
 }
 return rows;
}
const sameId=(a,b)=>a==null||b==null||a===b;
/** Parameters on pages the dialog never loaded, from one unpaginated state read
 * ({index,id,name,value} normalized), appended to the typed loaded rows. */
export function mergeUnloadedRows(rows,all){
 if(!Array.isArray(all))return rows;const have=new Set(rows.map(row=>row.index));
 return[...rows,...all.filter(row=>Number.isInteger(row?.index)&&!have.has(row.index)&&finite(row.value)).map(row=>({index:row.index,id:row.id??null,name:row.name||`Parameter ${row.index}`,form:'normalized',value:row.value,unloaded:true}))];
}
/** The cached baseline is only complete when every page is loaded. */
export function cachedGestureSnapshot(controller){return controller?.parameterPagination?.hasMore===true?null:parameterSnapshot(controller);}
/** One gesture read: the loaded pages (one coalesced pass) and, only when the
 * plugin has pages the dialog never loaded, ONE unpaginated state read in parallel. */
export async function readGestureSnapshot(controller,plugin){
 const unloaded=controller.parameterPagination?.hasMore===true&&typeof controller.readAllParameterValues==='function';
 const [,all]=await Promise.all([controller.refreshParameters(),unloaded?controller.readAllParameterValues(plugin):null]);
 return mergeUnloadedRows(parameterSnapshot(controller),all);
}
/** The parameters whose value changed between two snapshots of the same plugin. */
export function diffParameterSnapshots(before,after){
 const previous=new Map((before||[]).map(row=>[row.index,row])),changes=[];
 for(const row of after||[]){const old=previous.get(row.index);if(!old||!sameId(old.id,row.id)||old.form!==row.form||near(row.value,old.value))continue;changes.push({index:row.index,id:row.id??old.id??null,name:row.name,form:row.form,before:old.value,after:row.value,...row.unloaded||old.unloaded?{unloaded:true}:{}});}
 return changes;
}
export function gestureStepLabel(pluginName,changes){
 const plugin=pluginName||'Plugin',names=changes.map(change=>change.name);
 return `Change ${plugin} ${names.length<=2?names.join(', '):`${names[0]} and ${names.length-1} more`}`;
}
const refused=(message,extra={})=>Object.assign(new Error(message),{dispatched:false,...extra});
/** Apply one direction of a gesture step. `open()` resolves {controller,plugin}
 * with a fresh, history-scoped controller whose parameter page was just read. */
/** Round 39 speed: Undo/Redo of a normalized-only gesture is ONE guarded write per change —
 * instance-pinned (409 plugin_instance_mismatch) and compare-and-set on expected_value_norm =
 * the side it leaves (412 if someone moved it) — confirmed by the write reply itself: no
 * awaited page pre-read, slot probe or confirming read (those took ~2.3 s per step). A partial
 * failure puts back what landed (the step stays all-or-nothing). */
export const fastGestureEligible=changes=>Array.isArray(changes)&&changes.length>0&&changes.every(change=>change.form==='normalized'&&!change.unloaded&&finite(change.before)&&finite(change.after));
export async function applyGestureChangesGuarded({write,changes,direction,current=null,log=()=>{}}){
 const from=direction==='undo'?'after':'before',to=direction==='undo'?'before':'after';
 // Known to be at the target already (the open dialog's confirmed value): a quiet no-op.
 const pending=changes.filter(change=>{const value=current?.(change.index);return !(finite(value)&&near(value,change[to]));});
 if(!pending.length){log('plugin-gesture-history-noop',{direction,changes:changes.length,fast:true});return{changes:changes.map(change=>({index:change.index,value:change[to]})),noop:true,fast:true};}
 const done=[];
 try{for(const change of pending){
  try{await write(change,change[to],change[from]);}
  catch(error){
   // 412 plugin_parameter_conflict: the server's compare-and-set saw another value — the same
   // refusal (and wording) the read-guarded path gives; nothing was written for this change.
   if(isPluginParameterConflict(error)){const value=pluginConflictValue(error);throw Object.assign(new Error(`${change.name} is now ${value===null?'a different value':shown({form:'normalized',value})}: it changed elsewhere, so this step was not applied.`),{dispatched:false,explicitRejection:true,status:412,code:'plugin_parameter_conflict',cause:error});}
   throw error;}
  done.push(change);}}
 catch(error){
  const status=error?.status,rejected=error?.operationUncertain!==true&&(error?.explicitRejection===true||error?.dispatched===false||Number.isInteger(status)&&status>=400&&status<500&&status!==408);
  if(!done.length){if(rejected)error.dispatched=false;else error.operationUncertain=true;throw error;}
  const undone=[];for(const change of [...done].reverse()){try{await write(change,change[from],change[to]);undone.push(change);}catch{break;}}
  if(undone.length===done.length&&rejected){error.dispatched=false;throw error;}
  throw Object.assign(error,{operationUncertain:true});
 }
 return{changes:changes.map(change=>({index:change.index,value:change[to]})),fast:true};
}
export async function applyGestureChanges({open,changes,direction,log=()=>{}}){
 const from=direction==='undo'?'after':'before',to=direction==='undo'?'before':'after';
 let controller,plugin;try{({controller,plugin}=await open());}catch(error){throw Object.assign(error,{dispatched:false});}
 for(let page=0;page<20&&changes.some(change=>!controller.parameters.some(row=>row.index===change.index))&&controller.parameterPagination?.hasMore;page++)await controller.loadMoreParameters();
 const current=new Map(parameterSnapshot(controller).map(row=>[row.index,row]));
 for(const change of changes){
  const row=current.get(change.index);
  if(!row||!sameId(change.id,row.id))throw refused(`Reload ${plugin?.name||'the plugin'} before using this step: ${change.name} is no longer on its page.`);
  if(row.form!==change.form)throw refused(change.unloaded?`${change.name} takes only a physical value; its normalized change cannot be undone from here. Reload the plugin.`:`${change.name} changed its write form; reload the plugin.`);
  // Already at the target: nothing to write for it (a quiet no-op, never a refusal).
  if(near(row.value,change[to]))continue;
  if(!near(row.value,change[from]))throw refused(`${change.name} is now ${shown(row)}: it changed elsewhere, so this step was not applied.`);
 }
 const pendingChanges=changes.filter(change=>!near(current.get(change.index).value,change[to]));
 if(!pendingChanges.length){log('plugin-gesture-history-noop',{direction,changes:changes.length});return{changes:changes.map(change=>({index:change.index,value:change[to]})),noop:true};}
 const done=[];
 const write=async(change,value)=>{await controller.parameter(plugin,change.index,value);if(controller.pluginMutation?.requiresInspection)throw Object.assign(new Error(`Freestyle did not confirm ${change.name} = ${value}. Inspect the plugin.`),{operationUncertain:true});};
 try{for(const change of pendingChanges){await write(change,change[to]);done.push(change);}}
 catch(error){
  // Refused by Freestyle (409 instance mismatch, 412 value conflict, …): nothing landed.
  const status=error?.status,rejected=error?.operationUncertain!==true&&(error?.explicitRejection===true||error?.dispatched===false||Number.isInteger(status)&&status>=400&&status<500&&status!==408);
  if(!done.length){if(rejected)error.dispatched=false;else error.operationUncertain=true;throw error;}
  // Part of the gesture landed: put it back so the step stays all-or-nothing.
  if(!rejected)error.operationUncertain=true;
  const problems=[];for(const change of done.reverse())try{await write(change,change[from]);}catch(rollback){problems.push(rollback);}
  log('plugin-gesture-history-rollback',{direction,landed:done.length,failed:problems.length});
  throw Object.assign(error,problems.length||!rejected?{operationUncertain:true,...problems.length?{rollbackFailed:true}:{}}:{dispatched:false,historyNotApplied:true,rolledBack:true});
 }
 return{changes:changes.map(change=>({index:change.index,value:change[to]}))};
}

/** Per plugin window: captures before/after around each GUI gesture and records one step. */
export class PluginGestureRecorder{
 constructor({read,cached=null,record,canCapture=()=>true,log=()=>{},now=()=>Date.now(),freshMs=PLUGIN_GESTURE_FRESH_MS,settleMs=PLUGIN_GESTURE_CHANNEL_SETTLE_MS,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  if(typeof read!=='function'||typeof record!=='function')throw new TypeError('The plugin gesture recorder needs read and record callbacks.');
  Object.assign(this,{read,cached,record,canCapture,log,now,freshMs,settleMs,sleep});this.gesture=null;this.lastReadAt=-Infinity;this.closed=false;this.chain=Promise.resolve();
 }
 /** Mark the cached values current (a read the dialog just did). */
 noteRead(){this.lastReadAt=this.now();}
 invalidate(){this.lastReadAt=-Infinity;}
 /** Gesture start: never awaited by the input path. */
 begin({kind='pointer',id=null,channel=false}={}){
  if(this.closed||this.gesture)return false;let capturable=false;try{capturable=this.canCapture()===true;}catch{}
  const fresh=typeof this.cached==='function'&&this.now()-this.lastReadAt<=this.freshMs;
  // A channel down lands in a few ms, long before a REST read reaches the engine, so a racing
  // read would see the gesture's own change: the cached values (older but pre-gesture) win —
  // also on the window's FIRST gesture (engine request H: the dialog's loaded parameter page is the
  // baseline; only an empty cache starts a read, in parallel, never awaited by the input).
  const stale=channel===true&&!fresh&&typeof this.cached==='function';
  let before,read=false;
  if(!capturable)before=Promise.resolve(null);
  else{let rows=null;if(fresh||stale)try{rows=this.cached();}catch{}
   if(Array.isArray(rows)&&rows.length)before=Promise.resolve(rows);
   else{read=true;before=this.readNow().catch(error=>{this.log('plugin-gesture-capture',{outcome:'error',kind,code:error?.code??null});return null;});}}
  this.gesture={kind,id,before,startedAt:this.now(),source:!capturable?'none':read?'read':fresh?'cache_or_read':stale?'cache_pre_channel':'read',...channel===true?{channel:true}:{}};return true;
 }
 async readNow(){const rows=await this.read();this.lastReadAt=this.now();return rows;}
 /** Gesture end. `ok`: the terminal input was confirmed by effect. Resolves with the recorded changes (or []). */
 end({ok=true,id=null,dispatched=false}={}){
  const gesture=this.gesture;if(!gesture||id!==null&&gesture.id!==null&&id!==gesture.id)return Promise.resolve([]);this.gesture=null;
  // One read-back at a time, in gesture order.
  const task=this.chain.then(async()=>{
   if(this.closed)return[];
   // Round 38: an unconfirmed terminal input (e.g. a gesture re-routed from a refused channel)
   // may still have changed parameters: the read-back decides. Changed → exactly one step.
   if(!ok)this.invalidate();
   const before=await gesture.before;let after;
   // Channel ('dispatched') gestures: let the engine apply the ordered up before reading back.
   if(dispatched===true&&this.settleMs>0)await this.sleep(this.settleMs);if(this.closed)return[];
   try{after=await this.readNow();}catch(error){this.log('plugin-gesture-history',{kind:gesture.kind,outcome:'read_failed',code:error?.code??null});return[];}
   if(!before){this.log('plugin-gesture-history',{kind:gesture.kind,outcome:'no_baseline'});return[];}
   let changes=diffParameterSnapshots(before,after),reread=false;
   // Still unchanged after a dispatched gesture: one more read after another settle (bounded), never more.
   if(!changes.length&&dispatched===true&&this.settleMs>0){reread=true;await this.sleep(this.settleMs);if(this.closed)return[];try{after=await this.readNow();changes=diffParameterSnapshots(before,after);}catch(error){this.log('plugin-gesture-history',{kind:gesture.kind,outcome:'read_failed',code:error?.code??null});return[];}}
   this.log('plugin-gesture-history',{kind:gesture.kind,outcome:changes.length?'changed':ok?'unchanged':'unconfirmed',changes:changes.length,source:gesture.source,confirmed:ok,ms:this.now()-gesture.startedAt,...dispatched===true?{route:'channel',reread}:{}});
   // A completed before/after comparison (as opposed to [] after a failed read): non-enumerable marker.
   Object.defineProperty(changes,'readBack',{value:true});
   if(changes.length)try{this.record(changes);}catch(error){this.log('plugin-gesture-history',{outcome:'record_failed',message:String(error?.message||'').slice(0,160)});}
   return changes;
  });
  this.chain=task.catch(()=>{});return task;
 }
 close(){this.closed=true;this.gesture=null;}
}
