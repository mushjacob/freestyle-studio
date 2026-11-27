/** Actual persisted mixer strips with scoped, final-change-only callbacks.
 * Optional levelScale maps linear gain to fader positions via
 * {toPosition,toGain,maxPosition,step}; engine payloads/getLevelBounds stay linear.
 * onTypeLevel receives {row,before,scope,bounds} for a separately scoped editor.
 * Optional getMeter(row) returns a read-only readMixerStripMeter() reading keyed by
 * durable lane/bus IDs; when supplied it replaces the static runtime-bound snapshot.
 * Optional onLevelLive({row,value,before,scope,restore}) receives at most one value
 * per animation frame during a gesture (a realtime preview, never persistence) and
 * returns truthy when it sent; an uncommitted gesture then restores `before`.
 * Optional onPanLive has the same contract for the strip's pan knob.
 */
import {mixerGainDb} from './mixer-model.js';
import {attachMixerPanKnob} from './mixer-pan-knob.js';
import {paintMixerMeter} from './mixer-meter-frame.js';
import {setLastTweaked} from './knob-context-menu.js';
import {renderMenuHtml,bindMenu} from './context-menu.js';
/** FL 2026 shows inserts 1-16 (plus Master and the "C" peak column) even when unassigned. */
export const MIXER_BANK_SIZE=16;
const PEAK_SCALE=Object.freeze(['3','0','3','6','9','12','15','18','21','24','27','30','33','36']);
const clone=value=>value==null?value:structuredClone(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>Array.isArray(value)?value.map(stable):record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const db=value=>{const amount=mixerGainDb(value);return amount===null?'—':amount===-Infinity?'−∞ dB':`${amount.toFixed(1)} dB`;};
const append=(document,parent,tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;parent.append(node);return node;};
const rowState=(row,control)=>({key:row.key,kind:row.kind,id:row.id,runtime:row.runtime,target:row.controls?.[control]?.target,control:row.controls?.[control],value:row.values?.[control],verified:row.verified,persisted:row.persisted});
// A gesture is bound to the control's identity and effective value, not to the
// read bookkeeping around it: a canonical refresh or queued save confirming the
// value already shown (optimistic -> saved) must not cancel a drag or click.
const gestureState=(row,control)=>{const {value,...state}=rowState(row,control);return {...state,known:value?.known===true,value:value?.value};};
// M/S clicks toggle the control's *current* value, so a click on a strip rendered
// before the previous click's optimistic update still counts (identity only).
const identityState=(row,control)=>{const {value,known,...state}=gestureState(row,control);return state;};
const rangeKeys=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End']);
function levelBounds(row,callback){const result=callback(row);if(!record(result)||!finite(result.min)||result.min<0||!finite(result.max)||result.max<=result.min||!finite(result.step)||result.step<=0)throw new Error('Mixer level bounds are unavailable.');return clone(result);}
function value(input){const raw=input.value;if(typeof raw!=='string'||!raw.trim())return null;const number=Number(raw);return Number.isFinite(number)?number:null;}
function tooltip(row,control){
 const state=row.values?.[control],parts=[`${row.name||row.id} ${control==='gain'?'level':control}`];
 if(state?.known)parts.push(`${state.origin==='runtime'?'Live':'Persisted'}: ${control==='gain'?db(state.value):state.value?'on':'off'}`);else parts.push('State unknown');
 if(state?.mismatch)parts.push(`Persisted ${String(state.persisted.value)} differs from live ${String(state.runtime.value)}`);
 if(row.controls?.[control]?.reason)parts.push(row.controls[control].reason);
 return parts.join(' · ');
}
export class MixerStripView{
 constructor({element,getModel,getScope,getSelectedKey=()=>null,getSelectedKeys=null,onToggleMany=null,onSelect=()=>{},onLevel=null,onLevelLive=null,onTypeLevel=null,onControlMenu=null,levelScale=null,onMute=null,onSolo=null,onPan=null,onPanLive=null,isEditable=()=>true,canEditRow=row=>row.kind==='lane',canEditMasterGain=()=>false,onInteraction=()=>{},onStatus=()=>{},getLevelBounds=()=>({min:0,max:4,step:.01}),getMeter=null,onTrace=()=>{},onStripRendered=null,onPainted=null,raf=fn=>globalThis.requestAnimationFrame(fn),caf=id=>globalThis.cancelAnimationFrame(id)}={}){
  if(!element||typeof getModel!=='function'||typeof getScope!=='function')throw new TypeError('MixerStripView requires an element, model and scope callbacks.');
  if(levelScale!==null&&(!record(levelScale)||typeof levelScale.toPosition!=='function'||typeof levelScale.toGain!=='function'||!finite(levelScale.maxPosition)||levelScale.maxPosition<=0||!finite(levelScale.step)||levelScale.step<=0))throw new TypeError('Mixer levelScale requires conversion functions and positive position bounds.');
  Object.assign(this,{onStripRendered,onPainted,onTrace,element,getModel,getScope,getSelectedKey,getSelectedKeys,onToggleMany,onSelect,onLevel,onLevelLive,onTypeLevel,onControlMenu,levelScale,onMute,onSolo,onPan,onPanLive,isEditable,canEditRow,canEditMasterGain,onInteraction,onStatus,getLevelBounds,getMeter,raf,caf});this.document=element.ownerDocument;this.window=this.document.defaultView;this.gesture=null;this.frame=null;this.destroyed=false;this.suppressed=new WeakSet();this.panKnobs=[];this.typeControls=[];this.pending=0;
  this.keyListener=event=>{if(this.gesture&&event.key==='Escape'){event.preventDefault();this.cancel();}};this.blurListener=()=>this.cancel();this.document.addEventListener('keydown',this.keyListener,true);this.window?.addEventListener('blur',this.blurListener);
 }
 get active(){return !!this.gesture||this.panKnobs.some(knob=>knob.active);}
 status(error){try{this.onStatus(error instanceof Error?error.message:String(error));}catch{}}
 scope(){const scope=clone(this.getScope());if(!record(scope)||!Object.keys(scope).length)throw new Error('The mixer project scope is unavailable.');return scope;}
 rows(){const model=this.getModel();return Array.isArray(model?.rows)?model.rows:[];}
 currentRow(key){const matches=this.rows().filter(row=>row.key===key);return matches.length===1?matches[0]:null;}
 position(gain){const result=this.levelScale?this.levelScale.toPosition(gain):gain;if(!finite(result))throw new Error('Mixer fader position is unavailable.');return result;}
 gain(input){try{const position=value(input),bounds=input._mixerUIBounds;if(position===null||!bounds||position<bounds.min||position>bounds.max)return null;const result=this.levelScale?this.levelScale.toGain(position):position;return finite(result)?result:null;}catch{return null;}}
 uiBounds(bounds,reported=null){
  if(!this.levelScale)return {min:bounds.min,max:Math.max(bounds.max,reported??bounds.max),step:bounds.step};
  const min=this.position(bounds.min),max=Math.min(this.levelScale.maxPosition,this.position(bounds.max)),current=reported===null?max:this.position(reported);
  if(max<=min)throw new Error('Mixer fader position bounds are unavailable.');return {min,max:Math.max(max,current),step:this.levelScale.step};
 }
 applyUIBounds(input,bounds){input.min=String(bounds.min);input.max=String(bounds.max);input.step=String(bounds.step);input._mixerUIBounds=clone(bounds);this.renderLevelScale(input);}
 renderLevelScale(input){
  const rail=input._mixerScale,bounds=input._mixerUIBounds;if(!rail||!bounds)return;
  const fragment=this.document.createDocumentFragment(),labels=new Set([-36,-24,-12,-6,0]);
  for(const decibels of [-60,-36,-24,-18,-12,-9,-6,-3,0,3,6,12]){
   let position;try{position=this.position(10**(decibels/20));}catch{continue;}
   if(position<bounds.min||position>bounds.max)continue;const fraction=(position-bounds.min)/(bounds.max-bounds.min),tick=append(this.document,fragment,'span',`fader-tick${labels.has(decibels)?' major':''}${decibels===0?' unity':''}`);
   tick.dataset.decibels=String(decibels);tick.style.top=`${(1-fraction)*100}%`;
   if(input._mixerScaleLabels&&labels.has(decibels))append(this.document,tick,'span','fader-tick-label',String(decibels));
  }
  rail.replaceChildren(fragment);
 }
 validUI(input,bounds=input._mixerUIBounds){return !!bounds&&Number(input.min)===bounds.min&&Number(input.max)===bounds.max&&Number(input.step)===bounds.step;}
 typeEnabled(row,scope){try{const current=this.currentRow(row.key);return typeof this.onTypeLevel==='function'&&!this.active&&!this.pending&&same(scope,this.scope())&&!!current&&same(rowState(current,'gain'),rowState(row,'gain'))&&this.enabled(current,'gain');}catch{return false;}}
 syncTypeControls(){for(const item of this.typeControls)item.display.disabled=!item.display.isConnected||!this.typeEnabled(item.row,item.scope);}
 typeLevel(row,input,display,renderScope){
  try{if(!input.isConnected||!this.typeEnabled(row,renderScope)||!this.validUI(input))return;this.select(row);if(!this.typeEnabled(row,renderScope))return;const current=this.currentRow(row.key),bounds=levelBounds(current,this.getLevelBounds),before=current.values.gain.value;if(!finite(before)||before<bounds.min||before>bounds.max)return;this.invoke(this.onTypeLevel,{row:clone(current),before,scope:this.scope(),bounds});}catch(error){this.status(error);}finally{this.syncTypeControls();}
 }
 restoreControl(row,input,display){
  let current=row;try{current=this.currentRow(row.key)||row;}catch{}
  const state=current.values?.gain,known=state?.known===true&&finite(state.value)&&state.value>=0;
  input.dataset.readState=display.dataset.readState=known?'known':'unknown';input.dataset.origin=state?.origin||'unknown';
  if(known){try{this.applyUIBounds(input,this.uiBounds(levelBounds(current,this.getLevelBounds),state.value));input.value=String(this.position(state.value));input.style.visibility='';}catch{input.style.visibility='hidden';}input.setAttribute('aria-valuetext',db(state.value));display.textContent=db(state.value);}else{input.style.visibility='hidden';input.setAttribute('aria-valuetext','Gain unknown');display.textContent='—';}
 }
 enabled(row,control){try{if(this.panKnobs.some(knob=>knob.active||knob.pending))return false;const target=row?.controls?.[control]?.target,matched=record(target)&&(row.kind==='lane'?target.kind==='lane'&&target.laneId===row.id:row.kind==='bus'&&target.kind==='bus'&&target.busId===row.id);return !this.destroyed&&(!(row?.kind==='bus'&&row.id==='master')||control==='gain'&&this.canEditMasterGain(row)===true)&&row?.values?.[control]?.known===true&&row?.controls?.[control]?.enabled===true&&matched&&this.canEditRow(row,control)===true&&this.isEditable(row,control)===true&&typeof this[control==='gain'?'onLevel':control==='mute'?'onMute':'onSolo']==='function';}catch{return false;}}
 /** FL multi-select: the primary strip plus any Ctrl/⌘- or Shift-clicked strips. */
 selectedKeys(){const primary=this.getSelectedKey(),extra=typeof this.getSelectedKeys==='function'?this.getSelectedKeys():null;return Array.isArray(extra)?extra:primary==null?[]:[primary];}
 selected(){const keys=new Set(this.selectedKeys());for(const strip of this.element.querySelectorAll('[data-mixer-row]'))strip.classList.toggle('selected',keys.has(strip.dataset.mixerRow));this.paintRoutes();if(this.onPainted)try{this.onPainted();}catch(error){this.status(error);}}
 /** FL routing arrows: ▼ on the selected strip, a lit ▲ on strips that send to it, a dim ▲ elsewhere. */
 paintRoutes(){
  const primary=this.getSelectedKey(),selected=primary!=null?this.currentRow(primary):null,target=selected?.kind==='bus'?selected.id:null,names=new Map((this.getModel()?.rows||[]).filter(row=>row.kind==='bus').map(row=>[row.id,row.name||row.id]));
  for(const strip of this.element.querySelectorAll('.mixer-strip[data-mixer-row]')){const route=strip.querySelector('.strip-route');if(!route)continue;const output=route.dataset.output??null,own=strip.dataset.mixerRow===primary,sends=!own&&target!=null&&output===target;
   route.dataset.state=own?'selected':sends?'sends':output==null?'none':'idle';route.textContent=own?'▼':route.dataset.routeKind==='master'?'':'▲';
   route.title=output==null?'':`Output: ${output==='master'?'Master':names.get(output)||output}`;}
  this.paintCables(primary);
 }
 /** FL routing cables: from the selected insert's ▼ to the ring of the strip it really
  * outputs to (a bus or the master), drawn in the strips' bottom row. Display only. */
 paintCables(primary=this.getSelectedKey()){
  const host=this.element,document=this.document;let svg=[...host.children].find(node=>node.classList?.contains('mixer-cables'))||null;
  const source=primary!=null?[...host.querySelectorAll('.mixer-strip[data-mixer-row]')].find(strip=>strip.dataset.mixerRow===primary):null,output=source?.querySelector('.strip-route')?.dataset.output??null;
  for(const route of host.querySelectorAll('.strip-route[data-target]'))delete route.dataset.target;
  const target=output==null?null:[...host.querySelectorAll('.mixer-strip[data-mixer-row]')].find(strip=>strip.dataset.mixerKind==='bus'&&strip.dataset.mixer===output);
  if(!source||!target){svg?.remove();return;}
  const targetRoute=target.querySelector('.strip-route');if(targetRoute&&targetRoute.dataset.routeKind!=='master')targetRoute.dataset.target='true';
  if(!svg){svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','mixer-cables');svg.setAttribute('aria-hidden','true');host.append(svg);}
  const point=strip=>{const route=strip.querySelector('.strip-route')||strip;return{x:strip.offsetLeft+strip.offsetWidth/2,y:strip.offsetTop+route.offsetTop+route.offsetHeight/2};},from=point(source),to=point(target),bottom=Math.max(from.y,to.y)+(host.clientHeight?Math.min(28,Math.max(0,host.scrollHeight-Math.max(from.y,to.y)-2)):24);
  svg.setAttribute('width',String(Math.max(host.scrollWidth||0,from.x,to.x)+8));svg.setAttribute('height',String(Math.max(host.scrollHeight||0,bottom+4)));
  const path=svg.querySelector('path')||svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg','path'));
  path.setAttribute('d',`M${from.x.toFixed(1)} ${(from.y+6).toFixed(1)} C${from.x.toFixed(1)} ${bottom.toFixed(1)} ${to.x.toFixed(1)} ${bottom.toFixed(1)} ${to.x.toFixed(1)} ${(to.y+8).toFixed(1)}`);
  svg.dataset.from=source.dataset.mixer;svg.dataset.to=output;
 }
 select(row,modifiers){if(this.destroyed)return;try{this.onSelect(row.key,clone(row),modifiers?.toggle||modifiers?.range?{toggle:!!modifiers.toggle,range:!!modifiers.range}:{});this.selected();}catch(error){this.status(error);}}
 /** FL: M/S on one of several selected strips applies to every selected lane, as one step. */
 groupRows(row,control){if(typeof this.onToggleMany!=='function')return null;const keys=this.selectedKeys();if(keys.length<2||!keys.includes(row.key))return null;const rows=keys.map(key=>this.currentRow(key)).filter(item=>item?.kind==='lane'&&this.enabled(item,control));return rows.length>1&&rows.some(item=>item.key===row.key)?rows:null;}
 render(){
  if(this.destroyed)return;this.cancel();for(const knob of this.panKnobs)knob.destroy();this.panKnobs=[];this.typeControls=[];const model=this.getModel(),rows=Array.isArray(model?.rows)?model.rows.slice().sort((a,b)=>Number(b.kind==='bus'&&b.id==='master')-Number(a.kind==='bus'&&a.id==='master')):[],document=this.document,fragment=document.createDocumentFragment();let renderScope=null,insertOrdinal=0;try{renderScope=this.scope();}catch{}
  if(!rows.length){const message=append(document,fragment,'div','mixer-empty','No persisted mixer lanes or buses are available.');message.setAttribute('role','status');this.element.replaceChildren(fragment);return;}
  for(const row of rows){
   const strip=append(document,fragment,'div',`mixer-strip${row.kind==='bus'&&row.id==='master'?' master':''}`);strip.dataset.mixerRow=row.key;strip.dataset.mixer=row.id;strip.dataset.mixerKind=row.kind;strip.tabIndex=0;strip.setAttribute('role','group');strip.setAttribute('aria-label',`${row.name||row.id} ${row.kind}`);
   const masterStrip=row.kind==='bus'&&row.id==='master',ordinal=masterStrip?null:++insertOrdinal,number=append(document,strip,'div','strip-number',masterStrip?'M':String(ordinal));number.title=masterStrip?'Master output':`Mixer insert ${ordinal} · ${row.kind}`;const name=append(document,strip,'div','strip-name',row.name||row.id);name.title=`${row.kind}: ${row.id}`;
   strip.addEventListener('click',event=>{if(event.target.closest('input,button'))return;this.select(row,{toggle:event.ctrlKey||event.metaKey,range:event.shiftKey});});strip.addEventListener('keydown',event=>{if(event.target===strip&&event.key==='Enter'){event.preventDefault();this.select(row);}});
   const group=append(document,strip,'div','meter-and-fader'),meter=append(document,group,'div','meter'),fill=append(document,meter,'div','meter-fill'),bound=row.runtime?.status==='bound'&&(row.kind==='bus'?typeof row.id==='string'&&row.id.length>0:row.kind==='lane'&&Number.isInteger(row.runtime.trackId)&&row.runtime.trackId>=0),meterKnown=bound&&row.meter?.known===true&&finite(row.meter.value)&&row.meter.value>=0;
   if(typeof this.getMeter==='function'){let reading=null;try{reading=this.getMeter(row);}catch{}paintMixerMeter(meter,fill,row,reading);}
   else if(meterKnown){fill.dataset.meter=row.kind==='lane'?String(row.runtime.trackId):row.id;fill.style.height=`${Math.min(1,row.meter.value)*100}%`;meter.setAttribute('aria-label',`${row.name||row.id} reported peak ${row.meter.value}`);}else{fill.style.visibility='hidden';meter.setAttribute('aria-label',`${row.name||row.id} meter unavailable`);meter.dataset.readState='unknown';}
   const track=append(document,group,'div','fader-track'),input=append(document,track,'input');input.type='range';input.setAttribute('aria-label',`${row.name||row.id} volume`);input.title=tooltip(row,'gain');let bounds;
   try{bounds=levelBounds(row,this.getLevelBounds);}catch{bounds={min:0,max:4,step:.01};}
   const known=row.values?.gain?.known===true&&finite(row.values.gain.value)&&row.values.gain.value>=0,reported=known?row.values.gain.value:null,inBounds=known&&reported>=bounds.min&&reported<=bounds.max;
   let mapped=true;try{this.applyUIBounds(input,this.uiBounds(bounds,reported));}catch{mapped=false;this.applyUIBounds(input,{min:0,max:1,step:.001});}input.dataset.readState=known?'known':'unknown';input.dataset.origin=row.values?.gain?.origin||'unknown';input._mixerRenderScope=clone(renderScope);
   input.disabled=!mapped||!inBounds||!renderScope||!this.enabled(row,'gain');if(known){if(mapped)input.value=String(this.position(reported));else input.style.visibility='hidden';input.setAttribute('aria-valuetext',db(reported));}else{input.style.visibility='hidden';input.setAttribute('aria-valuetext','Gain unknown');}input._mixerDOMBefore=value(input);
   const scaleRail=append(document,track,'span','fader-scale');scaleRail.setAttribute('aria-hidden','true');input._mixerScale=scaleRail;input._mixerScaleLabels=masterStrip;this.renderLevelScale(input);
   if(!inBounds&&known)input.title+=' · Reported gain is outside the verified control bounds.';
   const display=append(document,strip,'button','strip-db',known?db(reported):'—');display.type='button';display.dataset.readState=known?'known':'unknown';display.title=input.title;display.setAttribute('aria-label',`${row.name||row.id} level; type a value`);this.typeControls.push({display,row:clone(row),scope:clone(renderScope)});display.addEventListener('click',event=>{event.stopPropagation();this.typeLevel(row,input,display,renderScope);});input.addEventListener('contextmenu',event=>{
    // FL fader right-click is a control menu (type value, Create automation clip) when the host supplies one.
    if(typeof this.onControlMenu==='function'){event.preventDefault();event.stopPropagation();this.onControlMenu(event,{row:clone(row),control:'gain',typeLevel:typeof this.onTypeLevel==='function'?()=>this.typeLevel(row,input,display,renderScope):null});return;}
    if(typeof this.onTypeLevel!=='function')return;event.preventDefault();event.stopPropagation();this.typeLevel(row,input,display,renderScope);});
   const pan=append(document,strip,'button','small-knob mixer-pan');let panKnob;panKnob=attachMixerPanKnob(pan,row,{getCurrentRow:key=>this.currentRow(key),getScope:()=>this.scope(),isEditable:(current,control)=>!this.gesture&&!this.panKnobs.some(knob=>knob!==panKnob&&(knob.active||knob.pending))&&this.canEditRow(current,control)===true&&this.isEditable(current,control)===true,onPan:typeof this.onPan==='function'?packet=>{this.syncTypeControls();return this.onPan(packet);}:null,onPanLive:typeof this.onPanLive==='function'?packet=>this.onPanLive(packet):null,onInteraction:active=>{this.onInteraction(active);this.syncTypeControls();},onStatus:message=>this.status(message)});const syncPan=panKnob.sync.bind(panKnob);panKnob.sync=()=>{const result=syncPan();this.syncTypeControls();return result;};this.panKnobs.push(panKnob);pan.addEventListener('pointerdown',()=>{if(!pan.disabled)this.select(row);});pan.addEventListener('keydown',event=>{if(!pan.disabled&&rangeKeys.has(event.key))this.select(row);});
   const controls=append(document,strip,'div','strip-controls');
   for(const [control,text]of [['mute','M'],['solo','S']]){
    const button=append(document,controls,'button',control,text),state=row.values?.[control];button.type='button';button.title=tooltip(row,control);this.paintToggle(button,row,control,renderScope);button.classList.toggle('on',state?.known===true&&state.value===true);button.setAttribute('aria-pressed',state?.known?String(state.value):'mixed');button.dataset.readState=state?.known?'known':'unknown';this.bindToggle(button,row,control,renderScope);
    if(control==='mute'){const light=append(document,controls,'span','strip-light');light.style.opacity=state?.known?state.value?'.3':'1':'.25';light.dataset.toggle='mute';light.title=(state?.known?state.value?'Muted':'Unmuted':'Mute state unknown')+' · click: mute · right-click or Ctrl+click: solo';button.title+=' · right-click or Ctrl+click: solo';light.setAttribute('role','button');this.bindToggle(light,row,control,renderScope);}
   }
   input.addEventListener('pointerdown',event=>{event.stopPropagation();const reset=event.button===1||event.button===0&&event.altKey;if(reset){event.preventDefault();if(!this.active)this.suppressed.add(input);}if(event.button!==0&&!reset||event.isPrimary===false||event.pointerId==null||input.disabled||this.active||reset&&this.pending){event.preventDefault();return;}this.select(row);this.begin(row,input,display,{pointerId:event.pointerId,kind:'pointer',reset});});
   input.addEventListener('pointermove',event=>{if(this.gesture?.reset&&event.pointerId===this.gesture.pointerId)event.preventDefault();});
   input.addEventListener('auxclick',event=>{if(event.button===1){event.preventDefault();event.stopPropagation();}});
   input.addEventListener('input',()=>this.preview(row,input,display));
   input.addEventListener('pointerup',event=>{event.stopPropagation();if(this.gesture?.kind==='pointer'&&event.pointerId===this.gesture.pointerId){if(this.gesture.reset)event.preventDefault();this.finish({pointerId:event.pointerId});}});
   for(const name of ['pointercancel','lostpointercapture'])input.addEventListener(name,event=>{if(this.gesture?.kind==='pointer'&&event.pointerId===this.gesture.pointerId)this.cancel();});
   input.addEventListener('keydown',event=>{if(!rangeKeys.has(event.key)||event.altKey||event.ctrlKey||event.metaKey||input.disabled)return;if(!this.active)this.begin(row,input,display,{kind:'keyboard'});if(this.gesture?.kind==='keyboard')this.gesture.keys.add(event.key);});
   input.addEventListener('keyup',event=>{if(this.gesture?.kind!=='keyboard'||!rangeKeys.has(event.key))return;this.gesture.keys.delete(event.key);if(!this.gesture.keys.size)this.finish();});
   input.addEventListener('change',()=>{if(this.suppressed.has(input)){this.suppressed.delete(input);return;}if(this.gesture)return;this.immediate(row,input,display);});
   input.addEventListener('blur',()=>{if(this.gesture?.input===input)this.cancel();});
   // FL routing row: the real output of this strip (lane → bus/master; a bus → master),
   // painted against the selected strip in selected(). Display only.
   const route=append(document,strip,'div','strip-route');route.setAttribute('aria-hidden','true');const output=masterStrip?null:row.kind==='bus'?'master':row.output?.runtime?.id??row.output?.persisted?.id??null;if(output!=null)route.dataset.output=output;route.dataset.routeKind=masterStrip?'master':row.kind;if(this.onStripRendered)try{this.onStripRendered(strip,row);}catch(error){this.status(error);}
  }
  // FL 2026 strip bank: inserts up to 16 shown as inert placeholders (nothing is routed there).
  for(let ordinal=insertOrdinal+1;ordinal<=MIXER_BANK_SIZE;ordinal++){
   // FL draws an unassigned insert like any other (LED, pan knob, fader, arrow); here every part is a plain shape: no control, no target.
   const strip=append(document,fragment,'div','mixer-strip placeholder');strip.setAttribute('aria-hidden','true');strip.inert=true;strip.dataset.placeholder=String(ordinal);strip.title=`Insert ${ordinal} (unassigned)`;
   // QA round 24: the SAME elements real strips use (so brightness, knob pointer, fader cap
   // at unity and tick scale match exactly), but inert: a disabled, untabbable range shape
   // inside an inert, aria-hidden strip with no listeners and no mixer target.
   append(document,strip,'div','strip-number',String(ordinal));append(document,strip,'div','strip-name',`Insert ${ordinal}`);const group=append(document,strip,'div','meter-and-fader');append(document,group,'div','meter');const track=append(document,group,'div','fader-track'),shape=append(document,track,'input');shape.type='range';shape.disabled=true;shape.tabIndex=-1;shape.className='placeholder-fader';
   try{this.applyUIBounds(shape,this.uiBounds({min:0,max:4,step:.01},1));shape.value=String(this.position(1));}catch{shape.style.visibility='hidden';}
   const scale=append(document,track,'span','fader-scale');scale.setAttribute('aria-hidden','true');shape._mixerScale=scale;shape._mixerScaleLabels=false;try{this.renderLevelScale(shape);}catch{}
   append(document,strip,'span','placeholder-led');append(document,strip,'span','small-knob placeholder-knob');const route=append(document,strip,'div','strip-route','▲');route.dataset.state='idle';
  }
  // FL's big left "C" column: the master output peak meter with its dB scale.
  const master=rows.find(row=>row.kind==='bus'&&row.id==='master');
  if(master){const peak=document.createElement('div');peak.className='mixer-peak';peak.dataset.mixerPeak=master.key;append(document,peak,'div','strip-number','C').title='Master output peak';const meter=append(document,peak,'div','meter mixer-peak-meter'),fill=append(document,meter,'div','meter-fill'),scale=append(document,peak,'div','mixer-peak-scale');scale.setAttribute('aria-hidden','true');for(const label of PEAK_SCALE)append(document,scale,'span','',label);
   if(typeof this.getMeter==='function'){let reading=null;try{reading=this.getMeter(master);}catch{}paintMixerMeter(meter,fill,master,reading);}else{fill.style.visibility='hidden';meter.setAttribute('aria-label','Master meter unavailable');}
   fragment.prepend(peak);}
  this.element.replaceChildren(fragment);this.renderedScope=clone(renderScope);this.selected();this.paintSoloSilence(rows);this.syncTypeControls();
 }
 begin(row,input,display,{kind,pointerId=null,reset=false}={}){
  if(this.active||input.disabled||!input.isConnected)return false;
  try{
   const current=this.currentRow(row.key),bounds=levelBounds(current,this.getLevelBounds);if(!current||!same(input._mixerRenderScope,this.scope())||!this.enabled(current,'gain')||!same(gestureState(current,'gain'),gestureState(row,'gain'))||reset&&(this.pending||bounds.min>1||bounds.max<1))return false;
   this.suppressed.delete(input);this.gesture={row:clone(current),state:clone(gestureState(current,'gain')),scope:this.scope(),bounds,levelScale:this.levelScale,uiBounds:clone(input._mixerUIBounds),before:current.values.gain.value,domBefore:value(input),input,display,kind,pointerId,reset,keys:new Set()};this.syncTypeControls();this.onInteraction(true);if(!this.valid()){this.cancel();return false;}
   if(reset)this.previewReset();
   if(kind==='pointer')try{input.setPointerCapture?.(pointerId);}catch{}return true;
  }catch(error){this.cancel();this.status(error);return false;}
 }
 previewReset(){const gesture=this.gesture;if(!gesture?.reset)return;const position=this.position(1);if(position<gesture.uiBounds.min||position>gesture.uiBounds.max)throw new Error('Unity is outside this fader’s display bounds.');gesture.input.value=String(position);gesture.display.textContent=db(1);gesture.input.setAttribute('aria-valuetext',db(1));}
 valid(){
  const gesture=this.gesture;if(!gesture||!gesture.input.isConnected||gesture.input.disabled)return false;
  try{const row=this.currentRow(gesture.row.key);return this.levelScale===gesture.levelScale&&same(this.scope(),gesture.scope)&&this.enabled(row,'gain')&&same(gestureState(row,'gain'),gesture.state)&&same(levelBounds(row,this.getLevelBounds),gesture.bounds)&&this.validUI(gesture.input,gesture.uiBounds);}catch{return false;}
 }
 preview(row,input,display){
  if(this.suppressed.has(input)){this.restoreControl(row,input,display);return;}
  if(!this.gesture){
   // Accessibility/native change events can lack keyboard or pointerdown. Their
   // input preview remains local until the final change event below.
   try{if(input.disabled||!same(input._mixerRenderScope,this.scope())||!this.enabled(this.currentRow(row.key),'gain')){this.restoreControl(row,input,display);return;}}catch(error){this.restoreControl(row,input,display);this.status(error);return;}
   const amount=this.gain(input);if(!this.validUI(input)||amount===null){this.restoreControl(row,input,display);return;}display.textContent=db(amount);input.setAttribute('aria-valuetext',display.textContent);return;
  }
  if(this.gesture.input!==input)return;if(!this.valid()){this.cancel();return;}
  if(this.gesture.reset){this.previewReset();return;}
  if(this.frame===null)this.frame=this.raf(()=>{this.frame=null;if(!this.gesture)return;if(!this.valid()){this.cancel();return;}const amount=this.gain(input);if(amount!==null){display.textContent=db(amount);input.setAttribute('aria-valuetext',db(amount));this.live(this.gesture,amount);}});
 }
 finish({cancel=false,pointerId}={}){
  const gesture=this.gesture;if(!gesture||pointerId!=null&&pointerId!==gesture.pointerId)return null;
  cancel=cancel||!this.valid();if(gesture.reset&&!cancel)try{this.previewReset();}catch(error){cancel=true;this.status(error);}const position=value(gesture.input),amount=gesture.reset?1:this.gain(gesture.input);if(amount===null||amount<gesture.bounds.min||amount>gesture.bounds.max)cancel=true;
  if(this.frame!==null)this.caf(this.frame);this.frame=null;this.gesture=null;this.suppressed.add(gesture.input);
  try{if(gesture.kind==='pointer'&&gesture.input.hasPointerCapture?.(gesture.pointerId))gesture.input.releasePointerCapture(gesture.pointerId);}catch{}
  this.restoreControl(gesture.row,gesture.input,gesture.display);
  let failed=false;try{this.onInteraction(false);}catch(error){failed=true;this.status(error);}
  const result={cancelled:cancel,changed:!cancel&&!failed&&amount!==gesture.before&&position!==gesture.domBefore,row:clone(gesture.row),before:gesture.before,value:amount,scope:clone(gesture.scope),bounds:clone(gesture.bounds),...gesture.reset?{reset:true}:{}};
  try{const current=this.currentRow(gesture.row.key);if(result.changed&&(!same(this.scope(),gesture.scope)||!this.enabled(current,'gain')||!same(gestureState(current,'gain'),gesture.state)))result.changed=false,result.cancelled=true;}catch{result.changed=false;result.cancelled=true;}
  if(!result.changed&&gesture.liveSent)this.live(gesture,gesture.before,{restore:true});if(result.changed){setLastTweaked({kind:'mixer',key:gesture.row.key,id:gesture.row.id,rowKind:gesture.row.kind,control:'gain',name:gesture.row.name||gesture.row.id});this.invoke(this.onLevel,{...result,liveSent:!!gesture.liveSent});}this.syncTypeControls();return result;
 }
 /** Optional realtime preview of a drag (one call per frame); persistence stays with onLevel. */
 live(gesture,value,{restore=false}={}){if(!this.onLevelLive||!gesture||!finite(value))return;try{const sent=this.onLevelLive({row:clone(gesture.row),value,before:gesture.before,scope:clone(gesture.scope),restore});if(sent)gesture.liveSent=true;}catch(error){this.status(error);}}
 cancel(){const result=this.finish({cancel:true});for(const knob of this.panKnobs)knob.cancel();return result;}
 immediate(row,input,display){
  if(input.disabled||!input.isConnected){this.restoreControl(row,input,display);return;}try{const current=this.currentRow(row.key);if(!current||!same(input._mixerRenderScope,this.scope())||!this.enabled(current,'gain')||!same(rowState(current,'gain'),rowState(row,'gain'))){this.restoreControl(row,input,display);return;}
   const position=value(input),amount=this.validUI(input)?this.gain(input):null,bounds=levelBounds(current,this.getLevelBounds),before=current.values.gain.value;this.restoreControl(current,input,display);if(amount===null||amount<bounds.min||amount>bounds.max||amount===before||position===input._mixerDOMBefore)return;
   setLastTweaked({kind:'mixer',key:current.key,id:current.id,rowKind:current.kind,control:'gain',name:current.name||current.id});this.invoke(this.onLevel,{row:clone(current),before,value:amount,scope:this.scope(),bounds});
  }catch(error){this.restoreControl(row,input,display);this.status(error);}
 }
 paintToggle(button,row,control,renderScope=this.scope()){
  const state=row.values?.[control],enabled=!!renderScope&&this.enabled(row,control);let structural=true;try{structural=!renderScope||row?.kind==='bus'&&row?.id==='master'||state?.known!==true||row?.controls?.[control]?.enabled!==true||this.canEditRow(row,control)!==true;}catch{}
  // Only a control that cannot be edited at all is `disabled`; a transient busy state stays pressable (the press is traced, never silently swallowed).
  button.disabled=structural;button.dataset.toggle=control;button.setAttribute('aria-disabled',String(!enabled));button.classList.toggle('unavailable',!enabled);button.classList.toggle('on',state?.known===true&&state.value===true);button.setAttribute('aria-pressed',state?.known?String(state.value):'mixed');button.dataset.readState=state?.known?'known':'unknown';
 }
 /** Update every strip's M/S/LED, fader and level text in place from the current
  * model. Returns false when the strips no longer match the model (caller re-renders).
  * Keeping the DOM stable means a press can never land on a node being replaced. */
 syncControls(){
  if(this.destroyed)return false;let scope=null;try{scope=this.scope();}catch{}const model=this.getModel(),rows=Array.isArray(model?.rows)?model.rows:[],strips=[...this.element.querySelectorAll('[data-mixer-row]')];
  if(!same(scope,this.renderedScope)||strips.length!==rows.length||strips.some(strip=>!rows.some(row=>row.key===strip.dataset.mixerRow)))return false;
  for(const strip of strips){const row=rows.find(item=>item.key===strip.dataset.mixerRow);
   for(const control of ['mute','solo']){const button=strip.querySelector(`.strip-controls button.${control}`);if(button)this.paintToggle(button,row,control,scope);}
   const light=strip.querySelector('.strip-light'),mute=row.values?.mute;if(light){light.style.opacity=mute?.known?mute.value?'.3':'1':'.25';}
   const input=strip.querySelector('.fader-track input'),display=strip.querySelector('.strip-db');if(input&&display&&this.gesture?.input!==input){input.disabled=!scope||!this.enabled(row,'gain');this.restoreControl(row,input,display);input._mixerDOMBefore=value(input);}
  }
  this.paintSoloSilence(rows);
  for(const knob of this.panKnobs)try{knob.sync();}catch{}
  this.syncTypeControls();return true;
 }
 /** FL: while any insert is soloed, every other insert is silenced, so its
  * enable LED dims (the strip's own mute value is unchanged). Master never dims. */
 paintSoloSilence(rows=this.rows()){
  const soloed=row=>row?.values?.solo?.known===true&&row.values.solo.value===true,master=row=>row?.kind==='bus'&&row?.id==='master',any=rows.some(row=>!master(row)&&soloed(row));
  for(const strip of this.element.querySelectorAll('[data-mixer-row]')){const row=rows.find(item=>item.key===strip.dataset.mixerRow),silenced=any&&!!row&&!master(row)&&!soloed(row);strip.classList.toggle('solo-silenced',silenced);const light=strip.querySelector('.strip-light');if(light&&silenced)light.style.opacity='.3';}
 }
 /** FL mixer M/LED: press toggles (on pointerdown, so a re-render between
  * press and release cannot swallow the click); right-click or Ctrl/Cmd+click
  * on the mute control solos instead. FL's solo mutes every other track, so a
  * solo from the mute switch is exclusive (one mix step); Alt+click on the
  * mute switch is FL's "solo with routing" (also solos the bus this track is
  * routed to). FL has no exclusive-mute gesture. On the separate S button a
  * plain click toggles and Alt+click is exclusive. The browser menu never opens there. */
 bindToggle(node,row,control,renderScope){
  const pick=event=>control==='mute'&&(event.button===2||event.ctrlKey||event.metaKey||event.altKey)||control==='solo'?'solo':control;
  const mode=event=>control==='mute'&&pick(event)==='solo'?{exclusive:true,fromMute:true,...event.altKey===true?{routing:true}:{}}:event.altKey===true&&pick(event)==='solo'?{exclusive:true}:{};
  node.addEventListener('pointerdown',event=>{if(event.isPrimary===false||![0,2].includes(event.button))return;event.stopPropagation();event.preventDefault();this.toggle(row,pick(event),renderScope,mode(event));});
  node.addEventListener('click',event=>{event.stopPropagation();if(event.detail===0)this.toggle(row,control,renderScope);});
  node.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();});
 }
 toggle(row,control,renderScope,{exclusive=false,routing=false,fromMute=false}={}){
  const trace=reason=>{try{this.onTrace({event:'toggle',control,laneId:row?.id,reason});}catch{}};
  try{const current=this.currentRow(row.key);if(!current)return trace('row-missing');if(!same(renderScope,this.scope()))return trace('scope-changed');if(!this.enabled(current,control))return trace('disabled');if(!same(identityState(current,control),identityState(row,control)))return trace('row-changed');
   const group=!exclusive&&!fromMute?this.groupRows(current,control):null;
   if(group){const scope=this.scope(),value=!current.values[control].value;trace('dispatched-many');return this.invoke(this.onToggleMany,{rows:clone(group),anchor:clone(current),control,value,scope});}
   this.select(current);const scope=this.scope(),fresh=this.currentRow(row.key);if(!same(scope,this.scope())||!fresh||!this.enabled(fresh,control)||!same(identityState(fresh,control),identityState(current,control)))return trace('changed-on-select');
   const before=fresh.values[control].value;trace('dispatched');this.invoke(control==='mute'?this.onMute:this.onSolo,{row:clone(fresh),before,value:!before,scope,...exclusive?{exclusive:true}:{},...routing?{routing:true}:{},...fromMute?{fromMute:true}:{}});
  }catch(error){trace('error');this.status(error);}
 }
 invoke(callback,payload){try{const pending=callback(payload);if(pending&&typeof pending.then==='function'){this.pending++;this.syncTypeControls();Promise.resolve(pending).catch(error=>this.status(error)).finally(()=>{this.pending--;this.syncTypeControls();});}}catch(error){this.status(error);}}
 destroy(){if(this.destroyed)return;this.cancel();for(const knob of this.panKnobs)knob.destroy();this.panKnobs=[];this.destroyed=true;this.document.removeEventListener('keydown',this.keyListener,true);this.window?.removeEventListener('blur',this.blurListener);this.typeControls=[];this.element.replaceChildren();}
}

/** FL mixer header "Wide ▾" view menu: Wide, Compact (narrower strips) and Extra large meters. CSS classes only (fl-native-mixer.css). */
export const MIXER_LAYOUT_KEY='vegetable:mixer-layout';
export const MIXER_LAYOUTS=Object.freeze([{id:'wide',label:'Wide'},{id:'compact',label:'Compact'},{id:'xl-meters',label:'Extra large meters'}]);
export const normalizeMixerLayout=value=>MIXER_LAYOUTS.some(item=>item.id===value)?value:'wide';
export function readMixerLayout(storage=globalThis.localStorage){try{return normalizeMixerLayout(storage?.getItem(MIXER_LAYOUT_KEY));}catch{return'wide';}}
export function applyMixerLayout(layout,{mixer=globalThis.document?.querySelector('#mixer'),storage=globalThis.localStorage,persist=true}={}){
 const id=normalizeMixerLayout(layout);if(persist)try{storage?.setItem(MIXER_LAYOUT_KEY,id);}catch{}
 if(mixer){for(const item of MIXER_LAYOUTS)mixer.classList.toggle(`mixer-layout-${item.id}`,item.id===id);const label=mixer.querySelector('.mixer-view');if(label)label.textContent=`${MIXER_LAYOUTS.find(item=>item.id===id).label} ▾`;}
 return id;
}
export function installMixerLayoutMenu(doc=globalThis.document){
 const mixer=doc?.querySelector?.('#mixer'),trigger=mixer?.querySelector('.mixer-view');if(!trigger||trigger.dataset.layoutMenu)return null;
 trigger.dataset.layoutMenu='1';trigger.style.cursor='pointer';applyMixerLayout(readMixerLayout(),{mixer,persist:false});
 trigger.addEventListener('click',event=>{
  const menu=doc.querySelector('#context-menu');if(!menu)return;event.stopPropagation();
  const current=readMixerLayout(),items=MIXER_LAYOUTS.map(item=>({label:item.label,checked:item.id===current,run:()=>applyMixerLayout(item.id,{mixer})}));
  menu.removeAttribute('role');menu.innerHTML=renderMenuHtml(items);menu.classList.remove('multi-column');menu.classList.remove('hidden');
  const box=trigger.getBoundingClientRect();menu.style.left=`${Math.max(0,box.left)}px`;menu.style.top=`${box.bottom}px`;
  bindMenu(menu,items,{close:()=>menu.classList.add('hidden'),run:item=>item.run()});
 });
 return trigger;
}
if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>installMixerLayoutMenu(),{once:true});else installMixerLayoutMenu();}
