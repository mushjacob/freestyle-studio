/** Per-slot wet/dry mix knob (FL parity X04): the small Mix control on each mixer effect slot.
 * Pure view state + markup + a small binder. Every write goes through the mixer's own
 * effect-slot path (onCommit -> MixerToolsController.slotMix, undoable), never straight to the engine.
 * Engine values are 0..1 (default 1 = fully wet); FL shows 0..100 %.
 */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp=value=>Math.max(0,Math.min(1,value));
const plain=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const SLOT_MIX_UNSUPPORTED='The audio engine needs an update for the slot mix knob.';
export const SLOT_MIX_UNREAD='Read this effect’s mix in FX options before changing it.';
export const slotMixPercent=value=>finite(value)?Math.round(clamp(value)*100):null;
export const percentToSlotMix=percent=>finite(percent)?clamp(Math.round(percent)/100):null;
export const slotMixText=value=>{const percent=slotMixPercent(value);return percent===null?'Mix unknown':`Mix ${percent}%`;};
/** Whether the engine reports per-slot mix (features.slot_mix of the live mix). */
export const slotMixSupported=liveMix=>liveMix?.features?.slot_mix===true;
/** One slot's knob state. `feature` = engine capability, `busy` = a slot write/read is running. */
export function slotMixState(plugin,{feature=false,busy=false,ready=true,recovery=false}={}){
 const known=finite(plugin?.mix)&&plugin.mix>=0&&plugin.mix<=1,value=known?plugin.mix:null;
 const reason=!feature?SLOT_MIX_UNSUPPORTED:recovery?'Inspect the previous plugin operation before changing the mix.':!known?SLOT_MIX_UNREAD:null;
 return{supported:feature,known,value,enabled:feature&&known&&!recovery&&ready&&!busy,reason,percent:slotMixPercent(value)};
}
export function slotMixMarkup(index,state,esc=plain){
 const title=state.enabled?`${slotMixText(state.value)} · double-click to reset`:state.reason||'Unavailable';
 return `<input type="range" class="slot-mix-knob" min="0" max="100" step="1" value="${state.percent??100}" data-slot-mix="${esc(index)}" aria-label="Slot ${esc(index+1)} mix" aria-valuetext="${esc(slotMixText(state.value))}" title="${esc(title)}" ${state.enabled?'':'disabled'}>`;
}
/** Wire the knobs inside `host`. `getPlugin(index)` returns the CURRENT slot at gesture time and
 * `onCommit({index,plugin,before,value})` performs the undoable write (it may return a promise).
 * While dragging, `onLive({index,plugin,value})` streams the value (persist:false) at most once per animation
 * frame and never overlaps itself; on release `onCommit` persists and records the one undo step, after the
 * last live write has settled. `raf` is injectable for tests. */
export function bindSlotMix(host,{getPlugin,getState,onLive=null,onCommit,onError=()=>{},raf=globalThis.requestAnimationFrame?.bind(globalThis)||(fn=>setTimeout(fn,16)),caf=globalThis.cancelAnimationFrame?.bind(globalThis)||clearTimeout}={}){
 if(!host||typeof getPlugin!=='function'||typeof getState!=='function'||typeof onCommit!=='function')return false;
 for(const knob of host.querySelectorAll?.('[data-slot-mix]')||[]){
  const index=Number(knob.dataset.slotMix);
  let frame=null,pending=null,inflight=null;
  const current=()=>{const plugin=getPlugin(index),state=plugin?getState(plugin):null;return plugin&&state?.enabled?{plugin,state}:null;};
  const flush=()=>{
   frame=null;if(pending===null||inflight||typeof onLive!=='function')return;
   const found=current();const value=pending;pending=null;if(!found)return;
   try{const result=onLive({index,plugin:found.plugin,value});inflight=Promise.resolve(result).catch(()=>{}).then(()=>{inflight=null;if(pending!==null&&frame===null)frame=raf(flush);});}catch{inflight=null;}
  };
  const fire=async value=>{
   if(frame!==null){caf(frame);frame=null;}pending=null;
   if(inflight)await inflight;
   const found=current();if(!found)return;
   const before=found.state.value;if(value===null||Math.abs(before-value)<1e-6){
    // Dragged away and back: the engine heard the stream, so put the saved value back.
    if(value!==null&&typeof onLive==='function'&&streamed)try{await onLive({index,plugin:found.plugin,value:before});}catch{}
    streamed=false;return;
   }
   streamed=false;
   try{await onCommit({index,plugin:found.plugin,before,value});}catch(error){onError(error);}
  };
  let streamed=false;
  // --mix (0..1) turns the drawn knob pointer (styles only; the value stays the input's).
  const turn=()=>knob.style?.setProperty?.('--mix',String(Math.min(1,Math.max(0,Number(knob.value)/100))));turn();
  knob.addEventListener('input',turn);
  knob.addEventListener('input',()=>{const value=percentToSlotMix(Number(knob.value));knob.setAttribute('aria-valuetext',slotMixText(value));knob.title=`${slotMixText(value)} · double-click to reset`;if(value!==null&&typeof onLive==='function'){pending=value;streamed=true;if(frame===null&&!inflight)frame=raf(flush);}});
  knob.addEventListener('change',()=>fire(percentToSlotMix(Number(knob.value))));
  knob.addEventListener('dblclick',event=>{event.preventDefault();knob.value='100';turn();fire(1);});
  knob.addEventListener('contextmenu',event=>{if(knob.disabled)return;event.preventDefault();knob.value='100';turn();fire(1);});
  knob.addEventListener('click',event=>event.stopPropagation());
 }
 return true;
}
