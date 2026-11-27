/**
 * Disabelton Device View: one plug-in's typed parameters as device controls.
 *
 * Wraps the same MixerToolsController paths the plug-in window uses (no new
 * engine calls): load = adopt the saved slot or verify the live instance, then
 * listLanePluginParameters (first page); drag = controller.liveParameter
 * (Studio Pro's realtime set_plugin_param over mozart-control, latest value per
 * frame); release = controller.queueParameter (one typed, instance-pinned write)
 * and ONE history step through the host's recordPluginParameterHistory.
 *
 * Host hooks:
 *  load(c, plugin) → Promise<controller>   (read the parameter page)
 *  record({c, plugin, index, paramId, name, form, before, after, scope, dialog}) → history step
 *  historyScope() → the journal context at gesture start
 *  refreshGui({instanceId}) → ask open plug-in windows of the instance for a fresh frame
 *  idle() → Promise resolving when no cloud edit/history step runs
 *  log(event, data), onError(error)
 */
import {formatPluginValueText} from './plugin-gesture-history.js';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
export const identity=plugin=>{const value=plugin?.instance_id??plugin?.instanceId??plugin?.id;return typeof value==='string'&&value?value:null;};
/** Parameters shown on a device's face before "Configure" (Live shows a compact set). */
export const ABL_DEVICE_FACE_PARAMETERS=16;

/* Units for a bare-number display when the parameter contract has no `unit` (QA r2: Free Comp reports display "1.995",
 * "100.950" with unit null while its GUI reads "2.00:1", "100.9 ms"). Only unambiguous names; anything else stays unitless. */
const ABL_NAME_UNITS=[[/\bratio\b/i,':1'],[/\b(attack|release|hold|look-?ahead|pre-?delay)\b/i,'ms'],[/\b(gain|threshold|trim|ceiling)\b/i,'dB']];
/** Live-style text for the plug-in's display string: a bare number gets Live precision (2 decimals below 10, 1 below 1000, else 0)
 * and its unit (contract `unit`, else ABL_NAME_UNITS); a display that already carries text ("75%", "Off", "2.00s") is kept. */
export function ablDisplayText(display,unit,name){
 const text=String(display??'').trim();if(!text)return'';
 const match=/^[+\-−]?\d+(?:\.\d+)?$/.exec(text);if(!match)return formatPluginValueText(text,unit);
 const number=Number(text.replace('−','-')),digits=Math.abs(number)<10?2:Math.abs(number)<1000?1:0;let shown=number.toFixed(digits);if(Number(shown)===0)shown=(0).toFixed(digits);
 const suffix=typeof unit==='string'&&unit.trim()?unit.trim():ABL_NAME_UNITS.find(([pattern])=>pattern.test(String(name||'')))?.[1]||'';
 shown=shown.replace(/^-/,'−');return !suffix?shown:suffix.startsWith(':')?`${shown}${suffix}`:`${shown} ${suffix}`;
}
/** Live-style value text in the plug-in's display units: the engine display when it
 * describes this value, else the physical value with its unit, else a percentage. */
export function ablParameterText(parameter,control,value){
 const display=String(parameter?.display??'').trim(),reported=control?.value;
 if(!finite(value))return display?ablDisplayText(display,parameter?.unit??control?.unit,parameter?.name):'—';
 const same=finite(reported)&&Math.abs(reported-value)<1e-9;
 if(same&&display)return ablDisplayText(display,parameter?.unit??control?.unit,parameter?.name);
 if(control?.form==='physical'){const rounded=Math.abs(value)>=100?Math.round(value):Math.round(value*100)/100;return `${rounded}${control.unit?` ${control.unit}`:''}`;}
 return `${Math.round(value*1000)/10} %`;
}
/** Which Live control draws a parameter: switch (2 steps), stepped knob, or knob. */
export function ablControlKind(parameter,control){
 const steps=Number(parameter?.steps);
 if(Number.isInteger(steps)&&steps===2)return 'switch';
 if(Number.isInteger(steps)&&steps>2&&steps<=64)return 'stepped';
 if(control?.form==='physical'&&control.step!=='any'&&finite(control.step)&&control.step>0&&(control.max-control.min)/control.step===1)return 'switch';
 return 'knob';
}
export class DeviceParamSession extends EventTarget{
 constructor({channel,plugin,load,record,historyScope=()=>undefined,refreshGui=()=>{},idle=async()=>{},log=()=>{},onError=()=>{}}={}){
  super();if(typeof load!=='function')throw new TypeError('DeviceParamSession needs a load hook.');
  Object.assign(this,{channel,plugin,loadHook:load,record,historyScope,refreshGui,idle,log,onError});
  this.controller=null;this.state='idle';this.error=null;this.closed=false;this.loading=null;this.gestureBefore=new Map();this.external=new Map();this.refreshTimer=null;
 }
 get instanceId(){return identity(this.plugin);}
 changed(){if(!this.closed)this.dispatchEvent(new Event('change'));}
 async load({force=false}={}){
  if(this.closed)return null;if(this.loading&&!force)return this.loading;if(this.state==='ready'&&!force)return this.controller;
  this.state='loading';this.error=null;this.changed();const started=Date.now();
  const run=(async()=>{try{const controller=await this.loadHook(this.channel,this.plugin);if(this.closed)return null;this.controller=controller;this.state='ready';this.external.clear();this.log('abl-device-params',{laneId:controller?.target?.id??null,pluginIndex:this.plugin?.index,loaded:controller?.parameters?.length??0,ms:Date.now()-started});return controller;}
   catch(error){if(this.closed)return null;this.state='error';this.error=error?.message||String(error);this.log('abl-device-params-error',{pluginIndex:this.plugin?.index,message:String(this.error).slice(0,160)});return null;}
   finally{if(this.loading===run)this.loading=null;this.changed();}})();
  this.loading=run;return run;
 }
 /** [{parameter, control, value, text, kind}] for the loaded page (stale/unwritable rows omitted). */
 rows(){
  const controller=this.controller;if(!controller||this.state!=='ready')return[];
  return controller.parameters.map(parameter=>{const control=controller.parameterControl(parameter);if(!control)return null;const value=this.value(parameter.index,control);return{parameter,control,value,text:ablParameterText(parameter,control,value),kind:ablControlKind(parameter,control)};}).filter(Boolean);
 }
 /** Shown value: an in-flight write, an Undo/Redo preview, a value another view just reported, else the confirmed value. */
 value(index,control){
  const controller=this.controller,held=controller?.parameterWriteValue?.(index)??controller?.historyPreviewValues?.get(index);
  if(held!==undefined)return held;const outside=this.external.get(index);return outside!==undefined&&control?.form==='normalized'?outside:control?.value;
 }
 confirmed(index){const row=this.controller?.parameters?.find(item=>item.index===index);return row?this.controller.parameterControl(row)?.value:undefined;}
 /** Realtime preview of a drag (one call per frame): the live mozart-control path. */
 live(index,value){
  const controller=this.controller;if(!controller||this.state!=='ready')return false;
  if(!this.gestureBefore.has(index))this.gestureBefore.set(index,this.confirmed(index));
  try{return ['sent','queued'].includes(controller.liveParameter(this.plugin,index,value));}catch{return false;}
 }
 /** A finished gesture: one queued typed write and ONE Undo step. */
 async commit(index,requested,{before:shownBefore}={}){
  const controller=this.controller;if(!controller||this.state!=='ready')throw new Error('Wait for the device parameters to load.');
  const row=controller.parameters.find(item=>item.index===index),control=row?controller.parameterControl(row):null;if(!row||!control)throw new Error('This parameter is no longer on the device page. Reload the device.');
  const before=this.gestureBefore.has(index)?this.gestureBefore.get(index):this.confirmed(index)??shownBefore;this.gestureBefore.delete(index);this.external.delete(index);
  if(controller.parameterWriteValue(index)===requested)return null;
  const started=Date.now(),scope=this.historyScope();
  try{controller.liveParameter(this.plugin,index,requested,{flush:true});}catch{}
  const pending=controller.queueParameter(this.plugin,index,requested);this.changed();
  try{
   await pending;if(this.closed)return null;this.refreshGui({instanceId:this.instanceId});
   const after=this.confirmed(index),unconfirmed=!!controller.pluginMutation?.requiresInspection;
   this.log('abl-device-param-write',{laneId:controller.target?.id??null,pluginIndex:this.plugin.index,index,paramId:row.id,form:control.form,before:before??null,requested,reported:after??null,unconfirmed,ms:Date.now()-started});
   if(unconfirmed)throw new Error(`Freestyle accepted ${row.name} but reports ${after??'an unknown value'} instead of ${requested}. Inspect the plug-in before editing again.`);
   if(finite(before)&&finite(after)&&Math.abs(before-after)>1e-9)this.record?.({c:this.channel,plugin:this.plugin,index,paramId:row.id,name:row.name,form:control.form,before,after,scope,dialog:this.historyView()});
   return{before,after};
  }finally{this.changed();}
 }
 /** Abandoned drag after live previews: put the engine back on the confirmed value. */
 restore(index){const before=this.gestureBefore.get(index);this.gestureBefore.delete(index);if(finite(before))try{this.controller?.liveParameter(this.plugin,index,before,{flush:true});}catch{}this.changed();}
 /** The plug-in-window shape recordPluginParameterHistory drives (instant Undo preview + repaint). */
 historyView(){return{controller:this.controller,isOpen:()=>!this.closed&&this.state==='ready',repaint:()=>this.changed(),refreshGui:()=>this.refreshGui({instanceId:this.instanceId})};}
 /** Another view (the plug-in window's GUI or its parameter page) reported values: show them now, confirm with one coalesced read. */
 adoptExternal(rows){
  if(this.closed||!Array.isArray(rows))return;let any=false;
  const controller=this.controller;if(!controller||this.state!=='ready')return;
  for(const row of rows){const index=row?.index,value=row?.normalized;if(!Number.isInteger(index)||!finite(value)&&!finite(row?.value)||this.gestureBefore.has(index))continue;
   const own=controller.parameters.find(item=>item.index===index),control=own?controller.parameterControl(own):null;if(!control)continue;
   // A physical-form value (e.g. an Undo of a dB knob) cannot be shown as-is: confirm it with the coalesced re-read.
   if(control.form!=='normalized'){if(finite(row?.value)&&Math.abs(control.value-row.value)>1e-9)any=true;continue;}if(!finite(value))continue;
   if(Math.abs(this.value(index,control)-value)<1e-9)continue;this.external.set(index,value);any=true;}
  if(any){this.changed();this.scheduleRefresh();}
 }
 scheduleRefresh(ms=150){
  if(this.closed||!this.controller)return;clearTimeout(this.refreshTimer);
  this.refreshTimer=setTimeout(async()=>{this.refreshTimer=null;if(this.closed||!this.controller||this.gestureBefore.size||this.controller.parameterWriting)return;try{await this.controller.refreshParameters({whenIdle:this.idle});this.external.clear();}catch(error){this.log('abl-device-params-refresh-error',{message:String(error?.message||error).slice(0,160)});}this.changed();},ms);
 }
 close(){this.closed=true;clearTimeout(this.refreshTimer);clearTimeout(this.autoRetry);this.autoRetry=null;this.refreshTimer=null;}
}
