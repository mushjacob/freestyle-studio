/**
 * Disabelton Automation Mode (A): Live's per-track envelopes in the Arrangement.
 *
 * Builds on LogicAutomationView (logic-automation.js), which already maps
 * Freestyle automation (lane Volume/Pan envelopes, clip-hosted plug-in parameter
 * and clip gain envelopes) to one curve per track and parameter, and edits it
 * with one guarded save = one Undo step per gesture (click adds a breakpoint,
 * drag moves it, Delete removes the selected one, first click creates the
 * envelope). This view adds Live's presentation and gestures:
 *  - two choosers under the track name: Device ▾ (Mixer, each plug-in) and
 *    Control ▾ (Volume, Pan, Track Activator (disabled), plug-in parameters);
 *  - a red envelope line with breakpoints over the clips;
 *  - ⇧-drag moves a breakpoint's value finely (time fixed);
 *  - ⌘-drag ignores the grid (from mouse-down on);
 *  - ⌥-drag on the line between two breakpoints curves that segment (stored as curve:'bezier' + tension on its
 *    left breakpoint, the Studio API AutomationPoint contract; one save = one Undo step);
 *  - right-click / ⌃-click on a breakpoint: Copy Value, Paste Value, Edit Value…, Reset to Default Value,
 *    Linear / Curve / Hold shape to the next breakpoint, Delete; on the line: the segment's shape, Delete Envelope.
 *
 * Shell contract (documented in docs/DISABELTON_PLAN.md):
 *  ablAutomation.toggle(force) → enabled         (A key)
 *  ablAutomation.enabled
 *  ablAutomation.renderTrack(trackEl, laneId, {header, lane, beatAt(clientX), barWidth})
 *     header: element under the track name where the choosers go;
 *     lane:   the track's timeline element (position:relative, beat 0 at its left);
 *     beatAt: clientX → absolute beat; barWidth: px per bar (sets --bar).
 *     Call it after each render of a track row while ablAutomation.enabled.
 *  window event 'abl:automation-repaint' → re-call renderTrack for visible tracks.
 * Without shell calls, paint(host) falls back to the fork's #track-lanes rows.
 */
import {LogicAutomationView,laneEnvelopeSegments,automationSegmentHtml,moveAutomationPoint,removeAutomationPoint,formatAutomationValue,LOGIC_AUTOMATION_MUTE_REASON} from './logic-automation.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)));
export const ABL_AUTO_FINE=10;
export const ABL_MIXER_DEVICE='mixer';
export const ABL_AUTO_ACTIVATOR_REASON=LOGIC_AUTOMATION_MUTE_REASON.replace('Mute automation','Track Activator automation');
/** The device an automation option belongs to: a plug-in instance, else the track's Mixer. */
export function optionDevice(option){const target=option?.target;return target?.kind==='plugin_parameter'&&target.pluginInstanceId?String(target.pluginInstanceId):ABL_MIXER_DEVICE;}
/** Live labels for the Mixer's controls. */
export function ablControlLabel(option){if(option?.key==='lane.mute')return 'Track Activator';if(option?.target?.kind==='clip_gain')return 'Clip Volume';return option?.target?.kind==='plugin_parameter'?option.target.name||option.label:option?.label;}

/** Parse a typed automation value (the units formatAutomationValue shows) into the envelope's 0..1 scale. */
export function parseAblAutomationValue(kind,text){
 const raw=String(text??'').trim().toLowerCase();if(!raw)return null;
 if(kind==='lane_volume'||kind==='clip_gain'){if(/^-?(inf|∞)/.test(raw.replace(/\s+/g,'')))return 0;const db=parseFloat(raw);if(!Number.isFinite(db))return null;return clamp(10**(db/20)/4,0,1);}
 if(kind==='lane_pan'){if(raw==='c'||raw==='0')return .5;const match=/^([+-]?\d+(?:\.\d+)?)\s*([lr]?)$/.exec(raw)||/^([lr])\s*(\d+(?:\.\d+)?)$/.exec(raw);if(!match)return null;
  let pan=match[1]==='l'||match[1]==='r'?Number(match[2])*(match[1]==='l'?-1:1):Number(match[1])*(match[2]==='l'?-1:1);if(!Number.isFinite(pan))return null;return clamp((clamp(pan,-64,64)/64+1)/2,0,1);}
 const n=parseFloat(raw);if(!Number.isFinite(n))return null;return clamp(n/100,0,1);
}
/** The control's default (Live: Reset/double-click): the envelope's stored default, else unity volume / centre pan / the parameter default. */
export function ablAutomationDefault(option,envelope){
 const stored=Number(envelope?.defaultValue);if(envelope&&envelope.defaultValue!=null&&Number.isFinite(stored))return clamp(stored,0,1);
 const kind=option?.target?.kind||envelope?.target?.kind||'';if(kind==='lane_pan')return .5;if(kind==='lane_volume'||kind==='clip_gain')return .25;
 const spec=Number(option?.spec?.defaultValue);return Number.isFinite(spec)&&option?.spec?.defaultValue!=null?clamp(spec,0,1):null;
}
/** Set the segment shape from breakpoint `index` to the next: 'linear' | 'hold' | 'bezier' (tension −1..1). */
export function setAutomationShape(points,index,curve,tension=0){
 const next=(points||[]).map(point=>({...point}));if(!next[index])throw new Error('Select an automation breakpoint first.');
 if(!['linear','hold','bezier','db'].includes(curve))throw new Error('Unknown automation shape.');
 next[index]={...next[index],curve,tension:curve==='bezier'?clamp(tension,-1,1):0};return next;
}
/** Index of the segment (left breakpoint) containing local time t, or -1. */
export function automationSegmentAt(points,timeSec){for(let i=0;i<(points?.length||0)-1;i++)if(timeSec>=points[i].timeSec&&timeSec<=points[i+1].timeSec&&points[i+1].timeSec>points[i].timeSec)return i;return -1;}
let ablAutomationClipboard=null;

export class AblAutomationView extends LogicAutomationView{
 constructor(options={}){super(options);this.devices=new Map();this.tracks=new Map();this.geometries=new WeakMap();}
 toggle(force){const on=super.toggle(force);try{this.document?.defaultView?.dispatchEvent(new (this.document.defaultView.CustomEvent||CustomEvent)('abl:automation-repaint',{detail:{enabled:on}}));}catch{}return on;}
 /** Plug-in devices on the track: [{key: instanceId, label}] (host hook getDevices). */
 pluginDevices(laneId){try{return this.options.getDevices?.(laneId)||[];}catch{return[];}}
 device(laneId){const chosen=this.devices.get(String(laneId));if(chosen)return chosen;const options=this.options_(laneId),current=options.find(item=>item.key===this.parameter(laneId));return optionDevice(current);}
 controls(laneId,device=this.device(laneId)){return this.options_(laneId).filter(option=>optionDevice(option)===device).map(option=>option.key==='lane.mute'?{...option,unavailable:ABL_AUTO_ACTIVATOR_REASON}:option);}
 deviceLabel(laneId,device){if(device===ABL_MIXER_DEVICE)return 'Mixer';return this.pluginDevices(laneId).find(item=>item.key===device)?.label||'Device';}
 chooseDevice(laneId,device){
  this.devices.set(String(laneId),device);const first=this.controls(laneId,device).find(option=>!option.unavailable);
  if(first){this.setParameter(laneId,first.key);this.repaintTracks();return;}
  if(device!==ABL_MIXER_DEVICE){this.status('Reading the device’s parameters…');Promise.resolve(this.options.loadDevice?.(laneId,device)).then(()=>{const option=this.controls(laneId,device).find(item=>!item.unavailable);if(option&&this.devices.get(String(laneId))===device)this.setParameter(laneId,option.key);else if(!option)this.status(`${this.deviceLabel(laneId,device)} reports no automatable parameters.`);this.repaintTracks();},error=>this.status(error?.message||String(error)));}
  this.repaintTracks();
 }
 deviceMenu(event,laneId){
  const current=this.device(laneId),items=[{key:ABL_MIXER_DEVICE,label:'Mixer'},...this.pluginDevices(laneId)];
  this.options.menu?.(event,items.map(item=>({label:item.label,checked:item.key===current,run:()=>this.chooseDevice(laneId,item.key)})));
 }
 controlMenu(event,laneId){
  const current=this.parameter(laneId),controls=this.controls(laneId);
  if(!controls.length){this.options.menu?.(event,[{label:'Reading parameters…',disabled:true}]);this.chooseDevice(laneId,this.device(laneId));return;}
  this.options.menu?.(event,controls.map(option=>({label:ablControlLabel(option),checked:option.key===current,disabled:!!option.unavailable,title:option.unavailable||'',run:()=>{this.setParameter(laneId,option.key);this.repaintTracks();}})));
 }
 /** Shell hook: draw this track's choosers and envelope (or clear them when automation mode is off). */
 renderTrack(trackEl,laneId,geometry={}){
  const header=geometry.header||trackEl?.querySelector?.('.abl-track-header,.track-label'),lane=geometry.lane||trackEl?.querySelector?.('.abl-track-lane,.lane-grid');
  const box=this.valueBoxState&&String(this.valueBoxState.laneId)===String(laneId)?this.valueBoxState:null;
  if(box&&lane?.contains(box.input)){box.moving=true;try{box.input.remove();}finally{box.moving=false;}}
  for(const node of [...(header?.querySelectorAll(':scope > .abl-auto-choosers')||[]),...(lane?.querySelectorAll(':scope > .abl-auto-overlay')||[])])node.remove();
  try{return this.renderTrackBody(trackEl,laneId,geometry,header,lane);}finally{if(box&&!box.done&&!box.place())box.close();}
 }
 renderTrackBody(trackEl,laneId,geometry,header,lane){
  trackEl?.classList?.toggle('abl-auto-track',this.enabled&&!!laneId);
  if(!laneId){this.tracks.delete(String(laneId));return;}
  this.tracks.set(String(laneId),{trackEl,laneId,geometry:{...geometry,header,lane}});
  if(!this.enabled||!lane)return;
  const document=lane.ownerDocument,project=this.options.getProject?.();if(!project)return;
  const controls=this.controls(laneId),key=this.parameter(laneId),option=controls.find(item=>item.key===key)||this.options_(laneId).find(item=>item.key===key)||controls[0];
  if(header){const box=document.createElement('div');box.className='abl-auto-choosers';box.dataset.laneId=laneId;
   const device=document.createElement('button');device.type='button';device.className='abl-auto-device';device.textContent=this.deviceLabel(laneId,this.device(laneId));device.title='Automation device';device.setAttribute('aria-haspopup','menu');device.onclick=event=>{event.stopPropagation();this.deviceMenu(event,laneId);};
   const control=document.createElement('button');control.type='button';control.className='abl-auto-control';control.textContent=option?ablControlLabel(option):'None';control.title='Automation control';control.setAttribute('aria-haspopup','menu');control.onclick=event=>{event.stopPropagation();this.controlMenu(event,laneId);};
   for(const node of [device,control,box])for(const type of ['pointerdown','mousedown','dblclick'])node.addEventListener(type,event=>event.stopPropagation());
   box.append(device,control);header.append(box);}
  if(!option)return;
  const overlay=document.createElement('div');overlay.className='abl-auto-overlay';overlay.dataset.laneId=laneId;overlay.dataset.parameter=option.key;if(Number.isFinite(geometry.barWidth))overlay.style.setProperty('--bar',`${geometry.barWidth}px`);
  const kind=option.target?.kind||'',segments=option.unavailable?[]:laneEnvelopeSegments({project,envelopes:this.envelopes(),laneId,targetKey:option.key});
  overlay.innerHTML=(segments.length||option.unavailable?'':this.flatLine(laneId,option))+this.extensions(segments)+segments.map(segment=>automationSegmentHtml(segment,{kind,selectedPoint:this.selection?.key===segment.key?this.selection.index:null})).join('')+(segments.length?'':`<span class="abl-auto-empty">${esc(option.unavailable||`Click to add ${ablControlLabel(option)} automation`)}</span>`);
  this.geometries.set(overlay,geometry);
  // Live: right-click (and ⌃-click, the macOS secondary click) opens the menu; ⌘ + mouse-down is a no-snap drag (QA r7).
  overlay.onpointerdown=event=>{if(event.button===2||event.button===0&&event.ctrlKey&&!event.metaKey){event.preventDefault();event.stopPropagation();this.contextMenu(event,{laneId,option,segments,overlay});return;}this.pointerdown(event,{laneId,option,segments,overlay,grid:lane});};
  overlay.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();});
  for(const type of ['mousedown','click','dblclick'])overlay.addEventListener(type,event=>event.stopPropagation());
  lane.append(overlay);
  // Live shows hints in the status bar, never over the clips (the in-lane hint is hidden by CSS).
  const hint=overlay.querySelector('.abl-auto-empty')?.textContent?.trim();
  if(hint){overlay.title=hint;const bar=()=>document.querySelector('#abl-status-hint');overlay.addEventListener('pointerenter',()=>{const node=bar();if(node){node.dataset.ablAutoHint='1';node.textContent=hint;}});overlay.addEventListener('pointerleave',()=>{const node=bar();if(node?.dataset.ablAutoHint){delete node.dataset.ablAutoHint;node.textContent='';}});}
 }
 /** QA r6: Live draws the envelope as a flat line at the control's current value as soon as the control is chosen, before
  * any breakpoint exists. Value (0..1, the envelope's own scale) from hooks.currentValue(laneId, option), else the plug-in
  * parameter's read value (option.spec.defaultValue). Display only: the first click still creates the envelope. */
 currentValue(laneId,option){
  let value=null;try{value=this.options.currentValue?.(laneId,option);}catch{value=null;}
  if(!Number.isFinite(Number(value))||value===null)value=option?.spec?.defaultValue;
  return value===null||value===undefined||!Number.isFinite(Number(value))?null:clamp(value,0,1);
 }
 flatLine(laneId,option){
  const value=this.currentValue(laneId,option);if(value===null)return '';
  return `<span class="abl-auto-extend abl-auto-flat" data-value="${value}" aria-hidden="true" title="${esc(`${ablControlLabel(option)}: ${formatAutomationValue(option.target?.kind||'',value)}`)}" style="left:0;right:0;top:${((1-value)*100).toFixed(3)}%"></span>`;
 }
 /** Snap an absolute beat to the visible grid (hooks.snapBeat), unless `bypass` (⌘ held, as in Live). */
 snapBeat(beat,bypass){if(bypass||typeof this.options.snapBeat!=='function')return beat;const snapped=Number(this.options.snapBeat(beat));return Number.isFinite(snapped)?Math.max(0,snapped):beat;}
 extensions(segments){
  if(!segments.length)return '';const first=segments[0],last=segments.at(-1),line=(style,value)=>Number.isFinite(value)?`<span class="abl-auto-extend" aria-hidden="true" style="${style};top:${((1-value)*100).toFixed(3)}%"></span>`:'';
  return line(`left:0;width:calc(${first.startBeat/4} * var(--bar))`,first.points[0]?.value)+line(`left:calc(${(last.startBeat+last.lengthBeats)/4} * var(--bar));right:0`,last.points.at(-1)?.value);
 }
 /** Fallback: the fork's Tracks area rows (header = .track-label, lane = .lane-grid). */
 paint(host){
  if(!host)return;host.classList.toggle('abl-automation-view',this.enabled);const laneIds=this.options.getLaneIds?.()||[];
  for(const grid of host.querySelectorAll('.lane-grid[data-track]')){const row=grid.closest('.track-lane')||grid.parentElement,laneId=laneIds[Number(grid.dataset.track)];if(!laneId)continue;this.renderTrack(row,laneId,{header:row?.querySelector('.track-label'),lane:grid});}
  this.repaintTracks({skip:host});
 }
 /** Re-render every shell-registered track that is still on screen. */
 repaintTracks({skip=null}={}){for(const [key,entry]of this.tracks){if(!entry.trackEl?.isConnected&&!entry.geometry.lane?.isConnected){this.tracks.delete(key);continue;}if(skip&&skip.contains?.(entry.geometry.lane))continue;this.renderTrack(entry.trackEl,entry.laneId,entry.geometry);}}
 clickAt(event,overlay,grid){
  const geometry=this.geometries.get(overlay);if(typeof geometry?.beatAt!=='function')return super.clickAt(event,overlay,grid);
  let beat=Number(geometry.beatAt(event.clientX));if(!Number.isFinite(beat))beat=0;beat=Math.max(0,beat);
  beat=this.snapBeat(beat,!!(event.altKey||event.metaKey));
  return{beat,timeSec:beat*60/this.bpm(),value:1-this.frac(event,overlay).y};
 }
 /** Live: ⌥-drag on the envelope line (not on a breakpoint) bends the segment under the pointer. */
 pointerdown(event,context){
  if(event.button===0&&event.altKey&&!event.metaKey&&!event.target?.closest?.('[data-point]')&&!context.option.unavailable){
   const at=this.clickAt(event,context.overlay,context.grid),inside=context.segments.find(item=>at.beat>=item.startBeat-1e-9&&at.beat<=item.startBeat+item.lengthBeats+1e-9);
   if(inside){const local=at.timeSec-inside.startBeat*60/this.bpm(),index=automationSegmentAt(inside.points,local);
    if(index>=0){event.preventDefault();event.stopPropagation();const element=[...context.overlay.querySelectorAll('.logic-auto-segment')].find(item=>item.dataset.envelopeKey===inside.key);if(element){this.curveSegment(event,{segment:inside,element,index,option:context.option});return;}}}
  }
  return super.pointerdown(event,context);
 }
 curveSegment(event,{segment,element,index,option}){
  const left=segment.points[index],right=segment.points[index+1],rising=right.value>=left.value,start=left.curve==='bezier'?Number(left.tension)||0:0,height=element.getBoundingClientRect().height||100;
  this.selection={key:segment.key,index};const kind=option.target?.kind||'';
  this.gesture={segment,element,points:segment.points,index,added:false,moved:false,pointerId:event.pointerId,kind,curve:true};
  try{element.setPointerCapture?.(event.pointerId);}catch{}
  const y0=event.clientY;
  const move=moveEvent=>{const gesture=this.gesture;if(!gesture||moveEvent.pointerId!==gesture.pointerId)return;moveEvent.preventDefault();
   // Dragging up bows the segment up: a rising segment then starts fast (tension < 0), a falling one starts slow.
   const up=(y0-moveEvent.clientY)/height*2,tension=clamp(start+(rising?-up:up),-1,1);
   gesture.points=setAutomationShape(segment.points,index,Math.abs(tension)<.01?'linear':'bezier',tension);gesture.moved=true;this.preview();this.status(`Curve ${Math.round(tension*100)}%`);};
  const detach=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',end);element.removeEventListener('pointercancel',cancel);};
  const end=upEvent=>{const gesture=this.gesture;if(!gesture||upEvent.pointerId!==gesture.pointerId)return;upEvent.stopPropagation();detach();this.gesture=null;if(gesture.moved)this.commit({envelope:{...segment.envelope,durationSec:segment.durationSec},points:gesture.points,label:`Curve ${ablControlLabel(option)} Automation`});else this.repaint();};
  const cancel=cancelEvent=>{if(!this.gesture||cancelEvent.pointerId!==this.gesture.pointerId)return;detach();this.gesture=null;this.repaint();};
  element.addEventListener('pointermove',move);element.addEventListener('pointerup',end);element.addEventListener('pointercancel',cancel);
 }
 /** Live drag: free move; ⇧ = fine value change with the time held. */
 dragPoint(event,{segment,element,index,added,option}){
  this.selection={key:segment.key,index};const startPoint=segment.points[index]||{timeSec:0,value:0};
  this.gesture={segment,element,points:segment.points,index,added,moved:false,pointerId:event.pointerId,label:`${added?'Add':'Move'} ${ablControlLabel(option)} Automation Point`,kind:option.target?.kind||'',anchor:{y:event.clientY,value:startPoint.value,fine:false},noSnap:!!event.metaKey};
  try{element.setPointerCapture?.(event.pointerId);}catch{}this.preview();
  const move=moveEvent=>{const gesture=this.gesture;if(!gesture||moveEvent.pointerId!==gesture.pointerId)return;moveEvent.preventDefault();
   const fine=!!moveEvent.shiftKey,current=gesture.points[gesture.index]||startPoint;
   if(fine!==gesture.anchor.fine)gesture.anchor={y:moveEvent.clientY,value:current.value,fine};
   let target;if(fine){const height=element.getBoundingClientRect().height||100;target={timeSec:current.timeSec,value:clamp(gesture.anchor.value+(gesture.anchor.y-moveEvent.clientY)/height/ABL_AUTO_FINE,0,1)};}
   else{const pos=this.frac(moveEvent,element),bpm=Number(this.bpm())||120,start=Number(segment.startBeat)||0;let timeSec=pos.x*segment.durationSec;
    // QA r6: the breakpoint's time snaps to the visible grid (absolute beats, like the click that adds it); ⌘ bypasses
    // snap — held now, or held at mouse-down (QA r7: a ⌘ + mouse-down drag stays snap-free).
    if(!moveEvent.metaKey&&!gesture.noSnap)timeSec=(this.snapBeat(start+timeSec*bpm/60,false)-start)*60/bpm;
    target={timeSec:clamp(timeSec,0,segment.durationSec),value:1-pos.y};}
   gesture.points=moveAutomationPoint(gesture.points,gesture.index,target,segment.durationSec);gesture.moved=true;this.preview();this.status(`${ablControlLabel(option)}: ${formatAutomationValue(gesture.kind,target.value)}`);};
  const detach=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',end);element.removeEventListener('pointercancel',cancel);};
  const end=upEvent=>{const gesture=this.gesture;if(!gesture||upEvent.pointerId!==gesture.pointerId)return;upEvent.stopPropagation();detach();this.gesture=null;if(gesture.added||gesture.moved)this.commit({envelope:{...gesture.segment.envelope,durationSec:gesture.segment.durationSec},points:gesture.points,label:gesture.label});};
  const cancel=cancelEvent=>{if(!this.gesture||cancelEvent.pointerId!==this.gesture.pointerId)return;detach();this.gesture=null;this.repaint();};
  element.addEventListener('pointermove',move);element.addEventListener('pointerup',end);element.addEventListener('pointercancel',cancel);
 }
 /** The breakpoint element currently on screen for {laneId,key,index} (a repaint replaces the overlay, so an element
  * captured when the menu opened is detached by the time a menu item runs). */
 liveBreakpoint({laneId,key,index}={}){
  const lane=this.tracks.get(String(laneId))?.geometry?.lane;if(!lane?.isConnected)return null;
  const segment=[...lane.querySelectorAll(':scope > .abl-auto-overlay .logic-auto-segment')].find(item=>item.dataset.envelopeKey===key);
  return segment?.querySelector(`:scope > [data-point="${Number(index)}"]`)||null;
 }
 /** Live's inline value box on a breakpoint (never the browser's prompt()): type, Enter/Tab commits, Esc or clicking away
  * cancels. QA r13: it lives INSIDE the visible envelope segment at the breakpoint's own left/top (not position:fixed at a
  * rect read from a node the menu's repaint had already detached — that put it off-screen at (-34,-22) while it kept the
  * keyboard, swallowing ⌘Z until Esc). A repaint while it is open moves the same box into the new segment. */
 valueBox(target,{label,text,commit}){
  const doc=this.document||target?.ownerDocument;if(!doc)return null;
  this.valueBoxState?.close();doc.querySelector('.abl-auto-value-box')?.remove();
  const where=target?.nodeType===1?{laneId:target.closest?.('.abl-auto-overlay')?.dataset.laneId,key:target.closest?.('.logic-auto-segment')?.dataset.envelopeKey,index:Number(target.dataset.point)}:target;
  if(!this.liveBreakpoint(where)){this.status(`${label}: the breakpoint is no longer on screen. Right-click it again.`);return null;}
  const input=doc.createElement('input');
  input.type='text';input.className='abl-auto-value-box';input.value=text;input.setAttribute('aria-label',`${label} value`);input.spellcheck=false;input.autocomplete='off';
  const state={...where,input,done:false,moving:false};
  state.place=()=>{const node=this.liveBreakpoint(state);if(!node)return false;const segment=node.parentElement,top=parseFloat(node.style.top)||0;
   // Above the breakpoint, or below it when the breakpoint sits near the lane's top edge.
   Object.assign(input.style,{position:'absolute',left:node.style.left,top:node.style.top,width:'68px',zIndex:'5',transform:top<30?'translate(-50%,8px)':'translate(-50%,calc(-100% - 6px))',display:'block',visibility:'visible'});
   if(input.parentElement!==segment){const refocus=state.focused;state.moving=true;try{segment.append(input);if(refocus)input.focus({preventScroll:true});}finally{state.moving=false;}}
   return true;};
  state.close=()=>{if(state.done)return false;state.done=true;if(this.valueBoxState===state)this.valueBoxState=null;input.remove();return true;};
  input.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();const value=input.value;if(state.close())commit(value);}else if(event.key==='Escape'){event.preventDefault();state.close();}});
  input.addEventListener('focus',()=>{state.focused=true;});
  input.addEventListener('blur',()=>{if(state.moving)return;state.focused=false;state.close();});
  for(const type of ['pointerdown','mousedown','click','dblclick','contextmenu'])input.addEventListener(type,event=>event.stopPropagation());
  this.valueBoxState=state;state.place();try{input.focus({preventScroll:true});input.select();}catch{}
  if(doc.activeElement!==input){state.close();return null;}
  return input;
 }
 /** Right-click / ⌃-click: breakpoint menu (values, shape, Delete); on the line the segment's shape and Delete Envelope. */
 contextMenu(event,{laneId,option,segments,overlay}){
  const node=event.target.closest?.('[data-point]'),element=event.target.closest?.('.logic-auto-segment'),segment=element?segments.find(item=>item.key===element.dataset.envelopeKey):null;
  const kind=option.target?.kind||'',label=ablControlLabel(option),items=[];
  const save=(points,what)=>this.commit({envelope:{...segment.envelope,durationSec:segment.durationSec},points,label:`${what} ${label} Automation`});
  const shapeItems=index=>{const point=segment.points[index],last=index>=segment.points.length-1,current=point?.curve||'linear',run=(curve,tension)=>()=>{try{save(setAutomationShape(segment.points,index,curve,tension),curve==='hold'?'Hold':curve==='bezier'?'Curve':'Linear');}catch(error){this.status(error.message);}};
   const why=last?'The last breakpoint has no segment after it.':'';
   return[{label:'Linear',checked:current==='linear'||current==='db',disabled:last,title:why,run:run('linear',0)},{label:'Curve',checked:current==='bezier',disabled:last,title:why||'Bend the segment to the next breakpoint (⌥-drag the line to adjust)',run:run('bezier',current==='bezier'?point.tension:.5)},{label:'Hold (Step)',checked:current==='hold',disabled:last,title:why||'Keep this value until the next breakpoint',run:run('hold',0)}];};
  if(node&&segment){const index=Number(node.dataset.point),point=segment.points[index];this.selection={key:segment.key,index};
   const setValue=(value,what)=>{if(value==null||!Number.isFinite(value)){this.status(`Type a ${label} value such as ${formatAutomationValue(kind,point.value)}.`);return;}const next=segment.points.map((item,i)=>i===index?{...item,value:clamp(value,0,1)}:{...item});if(Math.abs(next[index].value-point.value)<1e-9)return;save(next,what);};
   const fallback=ablAutomationDefault(option,segment.envelope);
   items.push({label:'Copy Value',run:()=>{ablAutomationClipboard={kind,value:point.value};try{this.document?.defaultView?.navigator?.clipboard?.writeText?.(formatAutomationValue(kind,point.value))?.catch?.(()=>{});}catch{}this.status(`Copied ${formatAutomationValue(kind,point.value)}`);}},
    {label:'Paste Value',disabled:!ablAutomationClipboard||ablAutomationClipboard.kind!==kind,title:ablAutomationClipboard&&ablAutomationClipboard.kind!==kind?'The copied value is for another kind of control.':'',run:()=>setValue(ablAutomationClipboard?.value,'Paste Value')},
    {label:'Edit Value…',run:()=>this.valueBox({laneId,key:segment.key,index},{label,text:formatAutomationValue(kind,point.value),commit:text=>setValue(parseAblAutomationValue(kind,text),'Edit Value')})},
    {label:'Reset to Default Value',disabled:fallback==null,title:fallback==null?'Freestyle reports no default for this control.':formatAutomationValue(kind,fallback),run:()=>setValue(fallback,'Reset')},
    null,...shapeItems(index),null,
    {label:'Delete',shortcut:'⌫',disabled:segment.points.length<=2,title:segment.points.length<=2?'An envelope keeps at least two breakpoints; delete the envelope instead.':'',run:()=>{let next;try{next=removeAutomationPoint(segment.points,index);}catch(error){this.status(error.message);return;}this.selection=null;this.commit({envelope:{...segment.envelope,durationSec:segment.durationSec},points:next,label:`Delete ${label} Automation Point`});}});}
  else if(segment){const at=this.clickAt(event,overlay,this.geometries.get(overlay)?.lane),local=at.timeSec-segment.startBeat*60/this.bpm(),index=automationSegmentAt(segment.points,local);if(index>=0)items.push(...shapeItems(index),null);}
  const envelope=segment?.envelope||segments[0]?.envelope||null;
  items.push({label:'Delete Envelope',disabled:!envelope||typeof this.options.onDeleteEnvelope!=='function',run:()=>Promise.resolve(this.options.onDeleteEnvelope?.(envelope)).catch(error=>this.status(error?.message||String(error))).finally(()=>this.repaint())});
  items.push(null,{label:`Show ${label} Value`,disabled:true,title:segment?formatAutomationValue(kind,node?segment.points[Number(node.dataset.point)]?.value:segment.points[0]?.value):''});
  void laneId;this.options.menu?.(event,items);this.repaintTracks();
 }
}
