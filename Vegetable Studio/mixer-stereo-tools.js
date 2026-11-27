/** Strip stereo tools (FL parity X08): the selected insert's Stereo separation knob,
 * Phase invert and Swap L-R buttons. Pure view state + markup + a small binder; every
 * write goes through the mixer's own control path (onChange), never straight to the engine.
 */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp=value=>Math.max(-1,Math.min(1,value));
const plain=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
/** Engine -1..1 <-> FL's -100..+100 %. */
export const separationPercent=value=>finite(value)?Math.round(clamp(value)*100):null;
export const percentToSeparation=percent=>finite(percent)?clamp(Math.round(percent)/100):null;
export const separationText=value=>{const percent=separationPercent(value);return percent===null?'Unknown':percent===0?'0%':`${percent>0?'+':''}${percent}%`;};
export const STEREO_LABELS=Object.freeze({separation:'Stereo separation',polarity:'Phase invert',swap:'Swap L-R'});

function control(row,key){
 const state=row?.values?.[key],gate=row?.controls?.[key],known=state?.known===true&&(key==='separation'?finite(state.value)&&state.value>=-1&&state.value<=1:typeof state.value==='boolean');
 return{known,value:known?state.value:null,enabled:gate?.enabled===true&&known,reason:gate?.reason??(known?null:'Read the live mix before editing.')};
}
/** What the properties section shows for one mixer row: null when the row can never have these tools. */
export function stereoToolsView(row){
 if(!row||!row.controls)return null;
 const master=row.kind==='bus'&&row.id==='master';if(master)return null;
 const view={key:row.key,separation:control(row,'separation'),polarity:control(row,'polarity'),swap:control(row,'swap')};
 const supported=['separation','polarity','swap'].some(key=>row.controls?.[key]?.supported===true);
 view.supported=supported;
 view.reason=supported?null:row.controls?.separation?.reason??'The audio engine needs an update for stereo tools.';
 return view;
}
export function stereoToolsMarkup(row,esc=plain){
 const view=stereoToolsView(row);if(!view)return '';
 const percent=separationPercent(view.separation.value),sep=view.separation,pol=view.polarity,swp=view.swap,note=view.supported?'':`<p class="stereo-tools-note" role="note">${esc(view.reason||'Unavailable.')}</p>`;
 return `<div class="stereo-tools" data-stereo-tools="${esc(row.key)}"><div class="effects-title"><span class="effect-lane-name">Stereo</span></div>${note}`
  +`<label class="stereo-tools-row" title="${esc(sep.enabled?'Stereo separation · double-click to reset':sep.reason||'Unavailable')}"><span>${esc(STEREO_LABELS.separation)}</span><input type="range" min="-100" max="100" step="1" value="${percent??0}" data-stereo="separation" aria-valuetext="${esc(separationText(sep.value))}" ${sep.enabled?'':'disabled'}><output>${esc(separationText(sep.value))}</output></label>`
  +`<div class="stereo-tools-row stereo-tools-buttons"><button type="button" data-stereo-toggle="polarity" aria-pressed="${pol.known?String(pol.value):'mixed'}" title="${esc(pol.enabled?STEREO_LABELS.polarity:pol.reason||'Unavailable')}" ${pol.enabled?'':'disabled'}>Ø ${esc(STEREO_LABELS.polarity)}</button>`
  +`<button type="button" data-stereo-toggle="swap" aria-pressed="${swp.known?String(swp.value):'mixed'}" title="${esc(swp.enabled?STEREO_LABELS.swap:swp.reason||'Unavailable')}" ${swp.enabled?'':'disabled'}>⇄ ${esc(STEREO_LABELS.swap)}</button></div></div>`;
}
/** Wire the section inside `host` (the rendered rack). `getRow()` returns the CURRENT row at click time
 * and `onChange({row,control,before,value})` performs the mixer write (it may return a promise). */
export function bindStereoTools(host,{getRow,onChange,onError=()=>{}}={}){
 const root=host?.querySelector?.('[data-stereo-tools]');if(!root||typeof getRow!=='function'||typeof onChange!=='function')return false;
 const fire=(key,value)=>{
  const row=getRow(),view=stereoToolsView(row);if(!view||!view[key]?.enabled||row.key!==root.dataset.stereoTools)return;
  const before=view[key].value;if(before===value)return;
  try{const result=onChange({row,control:key,before,value});if(result&&typeof result.catch==='function')result.catch(onError);}catch(error){onError(error);}
 };
 const range=root.querySelector('[data-stereo="separation"]'),out=root.querySelector('output');
 if(range){
  range.addEventListener('input',()=>{const value=percentToSeparation(Number(range.value));if(out)out.textContent=separationText(value);range.setAttribute('aria-valuetext',separationText(value));});
  range.addEventListener('change',()=>{const value=percentToSeparation(Number(range.value));if(value!==null)fire('separation',value);});
  range.addEventListener('dblclick',event=>{event.preventDefault();range.value='0';if(out)out.textContent=separationText(0);fire('separation',0);});
 }
 for(const button of root.querySelectorAll('[data-stereo-toggle]'))button.addEventListener('click',event=>{
  event.preventDefault();event.stopPropagation();const key=button.dataset.stereoToggle,view=stereoToolsView(getRow());if(!view?.[key]?.enabled)return;fire(key,!view[key].value);
 });
 return true;
}
