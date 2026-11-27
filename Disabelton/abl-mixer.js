/**
 * Disabelton Live mixer: the Arrangement mixer section (#abl-arr-mixer) and the
 * Session View mixer (#abl-session-mixer).
 *
 * Each host gets its own MixerStripView created by app.js (mountMixerStrips hook)
 * with every proven Mixer callback: optimistic fader/pan/mute/solo writes, mix
 * revision guards, live mozart-control fader preview, one Undo step per gesture,
 * meter ballistics. This module adds Live's strip presentation on top
 * (onRendered) and owns only display-side extras:
 *  - coloured title; Sends knobs, one per Return (non-master bus) like Live: drag = local preview and ONE
 *    guarded setLaneSend on release (If-Match "mix-<n>", one Undo step from the reply's undo), ⌥-click /
 *    double-click resets to -inf (deleteLaneSend). REST only: no realtime send message exists
 *    (studio-api-sends.js). Right-click a knob or the Sends label: Insert Return Track (createBus);
 *  - the activator number button = the strip's mute toggle, lit orange while the
 *    track plays (Live semantics: activator off = muted); S = solo;
 *  - record arm (the shared record-enable state the Record button uses);
 *  - Live's fader taper (+6 dB … −∞) and "-inf"/"-6.0" readout.
 * Returns (buses) sit right of the tracks with letters A, B…, Main last.
 */
export const ABL_ARR_MIXER='#abl-arr-mixer',ABL_SESSION_MIXER='#abl-session-mixer';
import {SendController,sendsFromMix,createReturnBus}from './studio-api-sends.js';
import {STUDIO_API_OPERATIONS}from './studio-api-client.js';
import {ABL_KNOB_DRAG_PX,ABL_KNOB_FINE}from './abl-dev-knob.js';
export const ABL_SENDS_UNAVAILABLE='Sends are unavailable in this Freestyle API build. Route a track to a bus with its output instead.';
export const ABL_SENDS_NO_RETURNS='No Return tracks yet: right-click here and choose Insert Return Track.';
export const ablSendsSupported=(operations=STUDIO_API_OPERATIONS)=>['setLaneSend','deleteLaneSend','getEngineMix'].every(name=>Object.prototype.hasOwnProperty.call(operations||{},name));
export const ABL_FADER_MAX_DB=6,ABL_FADER_ENGINE_MAX_GAIN=4;
/** [dB at the segment's top, weight of the segment below it] — Live's volume taper (QA r8): the top 60 %
 * of the travel is linear in dB at 0.025/dB (+6 at 1.0, 0 dB at 0.85, −18 dB at 0.40), then it steepens
 * to −24 (0.32), −36 (0.20), −48 (0.11), −60 (0.05) and −∞ at the bottom. The old taper put 0 dB at 0.90
 * and −12 dB at 0.71, so a short drag fell 20 dB. */
const SEGMENTS=Object.freeze([[6,150],[0,450],[-18,80],[-24,120],[-36,90],[-48,60],[-60,50]]);
const TOTAL=SEGMENTS.reduce((sum,[,weight])=>sum+weight,0);
const BREAKPOINTS=(()=>{let below=TOTAL;return SEGMENTS.map(([db,weight])=>{const point={db,position:below/TOTAL};below-=weight;return point;});})();
const FLOOR=BREAKPOINTS.at(-1),FLOOR_GAIN=10**(FLOOR.db/20),STEP_PER_DB=SEGMENTS[0][1]/(SEGMENTS[0][0]-SEGMENTS[1][0])/TOTAL;
const tidy=position=>Math.round(position*1e12)/1e12;
export const ABL_FADER_UNITY_POSITION=tidy(BREAKPOINTS.find(point=>point.db===0).position);
export const ABL_FADER_EXTENDED_MAX_POSITION=tidy(1+(20*Math.log10(ABL_FADER_ENGINE_MAX_GAIN)-ABL_FADER_MAX_DB)*STEP_PER_DB);
export const ABL_FADER_TICKS=Object.freeze([6,0,-12,-24,-36,-48,-60]);
const check=(value,min,max,name)=>{if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`${name} must be a finite number.`);if(value<min||value>max)throw new RangeError(`${name} must be between ${min} and ${max}.`);return value;};
export function ablFaderGainToPosition(gain){
 check(gain,0,ABL_FADER_ENGINE_MAX_GAIN,'Linear gain');if(gain===0)return 0;if(gain===1)return ABL_FADER_UNITY_POSITION;if(gain===ABL_FADER_ENGINE_MAX_GAIN)return ABL_FADER_EXTENDED_MAX_POSITION;
 if(gain<=FLOOR_GAIN)return tidy(FLOOR.position*gain/FLOOR_GAIN);const db=20*Math.log10(gain);if(db>=ABL_FADER_MAX_DB)return tidy(1+(db-ABL_FADER_MAX_DB)*STEP_PER_DB);
 for(let i=1;i<BREAKPOINTS.length;i++){const top=BREAKPOINTS[i-1],bottom=BREAKPOINTS[i];if(db>=bottom.db)return tidy(bottom.position+(db-bottom.db)/(top.db-bottom.db)*(top.position-bottom.position));}
 return tidy(FLOOR.position);
}
export function ablFaderPositionToGain(position){
 check(position,0,ABL_FADER_EXTENDED_MAX_POSITION,'Fader position');if(position===0)return 0;if(position===ABL_FADER_UNITY_POSITION)return 1;if(position===ABL_FADER_EXTENDED_MAX_POSITION)return ABL_FADER_ENGINE_MAX_GAIN;
 if(position<=FLOOR.position)return FLOOR_GAIN*position/FLOOR.position;let db;
 if(position>=1)db=ABL_FADER_MAX_DB+(position-1)/STEP_PER_DB;else for(let i=1;i<BREAKPOINTS.length;i++){const top=BREAKPOINTS[i-1],bottom=BREAKPOINTS[i];if(position>=bottom.position){db=bottom.db+(position-bottom.position)/(top.position-bottom.position)*(top.db-bottom.db);break;}}
 return Math.min(ABL_FADER_ENGINE_MAX_GAIN,10**(db/20));
}
/** Live's volume box: "0", "-6.0", "3.5", "-inf". */
export function ablLevelText(gain){if(typeof gain!=='number'||!Number.isFinite(gain)||gain<0)return '—';if(gain===0)return '-inf';const db=Math.round(20*Math.log10(gain)*10)/10;return db===0||Object.is(db,-0)?'0':db.toFixed(1);}
/* relativeDrag: Live faders grab anywhere in the fader column and move relative to the press (no jump); ⇧ = fine. */
export const ablFaderLevelScale=Object.freeze({toPosition:ablFaderGainToPosition,toGain:ablFaderPositionToGain,maxPosition:1,step:.001,relativeDrag:true,fineFactor:.1,ticks:ABL_FADER_TICKS,labels:Object.freeze([0,-12,-24,-36,-48,-60])});
/** Activator label: track number for tracks, a letter for returns, none for Main. */
export function ablActivatorLabel(rows,row){
 if(row?.kind==='bus'&&row.id==='master')return '';
 if(row?.kind==='bus'){const buses=rows.filter(item=>item.kind==='bus'&&item.id!=='master');return String.fromCharCode(65+Math.max(0,buses.findIndex(item=>item.key===row.key))%26);}
 const lanes=rows.filter(item=>item.kind==='lane');return String(lanes.findIndex(item=>item.key===row.key)+1);
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Live strip presentation over a MixerStripView render (idempotent; controls keep their listeners). */
export function decorateAblStrips(host,rows,hooks={}){
 const document=host.ownerDocument;host.classList.add('abl-mixer');
 for(const strip of host.querySelectorAll('[data-mixer-row]')){
  const row=rows.find(item=>item.key===strip.dataset.mixerRow);if(!row)continue;const master=row.kind==='bus'&&row.id==='master',bus=row.kind==='bus'&&!master;
  strip.classList.toggle('abl-return',bus);strip.classList.toggle('abl-main',master);
  let color='';try{color=hooks.trackColor?.(row)||'';}catch{}if(color)strip.style.setProperty('--abl-track-color',color);
  const name=strip.querySelector('.strip-name');if(name){name.textContent=master?'Main':bus?`${ablActivatorLabel(rows,row)} ${row.name||row.id}`:row.name||row.id;name.title=`${name.textContent} · click to select`;}
  let sends=strip.querySelector('.abl-sends');if(!sends){sends=document.createElement('div');sends.className='abl-sends';sends.setAttribute('aria-label','Sends');name?.after(sends);}
  paintSends(sends,rows,row,hooks);
  const mute=strip.querySelector('.strip-controls button.mute');
  if(mute){const label=ablActivatorLabel(rows,row);mute.textContent=label;mute.classList.add('abl-activator');mute.hidden=master;const muted=mute.classList.contains('on');mute.setAttribute('aria-label',`${row.name||row.id} activator (${muted?'off: muted':'on'})`);mute.title=`Track Activator: ${muted?'off (muted) · click to activate':'on · click to deactivate (mute)'}`;}
  // Live's volume box: double-click types a value (the strip's existing typed-level path = one write, one Undo step);
  // a single click no longer opens the editor.
  const db=strip.querySelector('.strip-db');
  if(db&&!db.dataset.ablDb){db.dataset.ablDb='1';db.title=`${row.name||row.id} volume · double-click to type a value`;
   strip.addEventListener('click',event=>{const box=event.target.closest?.('.strip-db');if(box&&!box.dataset.ablTyping){event.stopPropagation();}},true);
   db.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();db.dataset.ablTyping='1';try{db.click();}finally{delete db.dataset.ablTyping;}});}
  if(master)paintMainActivator(strip,hooks);
  const solo=strip.querySelector('.strip-controls button.solo');if(solo){solo.classList.add('abl-solo');solo.hidden=master;solo.title=`Solo ${row.name||row.id}`;}
  const controls=strip.querySelector('.strip-controls');
  if(controls&&row.kind==='lane'){let arm=controls.querySelector('.abl-arm');if(!arm){arm=document.createElement('button');arm.type='button';arm.className='abl-arm';arm.dataset.laneId=row.id;arm.setAttribute('aria-label',`Arm ${row.name||row.id} for recording`);arm.innerHTML='<span aria-hidden="true">●</span>';arm.addEventListener('pointerdown',event=>event.stopPropagation());arm.addEventListener('click',event=>{event.stopPropagation();try{hooks.toggleArm?.(row.id);}catch(error){hooks.fail?.(error);}paintArm(arm,row.id,hooks);});controls.append(arm);}paintArm(arm,row.id,hooks);}
 }
}
/** Live send knob taper: the dial's travel is the fader taper from -inf to 0 dB (Live's send range). */
/** Send knob ↔ Freestyle's send level (linear 0..2 = -inf..+6 dB, setLaneSend): linear over the sweep like every device
 * knob's normalized value (0 dB at 12 o'clock), shown in dB. QA r12: the old dB taper over -inf..0 dB put a 35 px drag
 * at 0.0072 (-43 dB); now 35 px from -inf is 0.35 (-9.1 dB) and ⇧ gives 0.035. */
export const ABL_SEND_MAX_LEVEL=2;
export const ablSendGainToPosition=gain=>!(gain>0)?0:Math.min(1,gain/ABL_SEND_MAX_LEVEL);
export const ablSendPositionToGain=position=>!(position>0)?0:Math.min(ABL_SEND_MAX_LEVEL,position*ABL_SEND_MAX_LEVEL);
/** The Return rows (non-master buses) in mixer order, each with its Live letter. */
export function ablReturnRows(rows){return rows.filter(item=>item.kind==='bus'&&item.id!=='master').map(item=>({row:item,letter:ablActivatorLabel(rows,item)}));}
function sendLabel(letter,bus,send){return `Send ${letter} → ${bus.name||bus.id}: ${send?ablLevelText(send.level)+(send.level>0?' dB':''):'-inf'}${send?.preFader?' (pre)':''}`;}
/** Round 4 — Live's In/Out section (View ▸ Mixer Controls ▸ In/Out) and the Main strip's Solo/Cue switch.
 * The section is shown with the I·O toggle on the Main strip (body.abl-mixer-io, remembered). Freestyle routes every
 * track to Main and has no cue bus, so the choosers state that; an audio track's "Audio From" opens the real record
 * input chooser (device + monitor mode). Idempotent per strip. */
export const ABL_MIXER_IO_KEY='disabelton:abl:mixer-io';
export function ablInOutModel(row){
 const audio=row?.kind==='lane'&&['audio','vocal','guitar'].includes(row.laneKind),lane=row?.kind==='lane',master=row?.kind==='bus'&&row.id==='master';
 return{
  from:master?null:{label:lane?(audio?'Ext. In':'All Ins'):'—',title:lane?(audio?'Audio From: the recording input (click to choose the device and monitor mode)':'MIDI From: the computer MIDI keyboard (M) and every MIDI input'):'A Return receives the track sends.',enabled:audio},
  to:{label:master?'1/2':'Main',title:master?'Main output: the Freestyle cloud stream (one stereo output).':'Audio To: Main. Freestyle routes every track and Return to Main; other destinations are not available.',enabled:false},
 };
}
export function paintInOut(sends,row){
 const document=sends.ownerDocument,strip=sends.parentElement;if(!strip||!row)return;
 const model=ablInOutModel(row),signature=JSON.stringify([row.kind,row.id,model.from?.label,model.to.label]);
 let box=strip.querySelector(':scope > .abl-io');
 if(!box){box=document.createElement('div');box.className='abl-io';strip.insertBefore(box,sends);}
 if(box.dataset.ablIo!==signature){box.dataset.ablIo=signature;
  box.innerHTML=`<span class="abl-io-label">In/Out</span>${model.from?`<button type="button" class="abl-io-chooser" data-io="from" ${model.from.enabled?'':'disabled'} title="${esc(model.from.title)}">${esc(model.from.label)}</button>`:''}<button type="button" class="abl-io-chooser" data-io="to" disabled title="${esc(model.to.title)}">${esc(model.to.label)}</button>`;
  box.querySelector('[data-io="from"]:not(:disabled)')?.addEventListener('click',event=>{const view=document.defaultView,chooser=view?.ablRecordInput;if(chooser?.open){const rect=event.currentTarget.getBoundingClientRect();chooser.open({x:rect.left,y:rect.bottom});}});}
 if(row.kind==='bus'&&row.id==='master'){
  let sections=strip.querySelector(':scope > .abl-mixer-sections');
  if(!sections){sections=document.createElement('div');sections.className='abl-mixer-sections';
   sections.innerHTML='<button type="button" class="abl-section-toggle" data-section="io" aria-pressed="false" title="Show/Hide In/Out (⌥⌘I)">I·O</button><button type="button" class="abl-solo-cue" disabled title="Solo/Cue switch: Freestyle has one output and no cue bus, so the Solo buttons always solo.">Solo</button>';
   strip.append(sections);
   const toggle=sections.querySelector('[data-section="io"]'),paint=()=>{const on=document.body.classList.contains('abl-mixer-io');toggle.setAttribute('aria-pressed',String(on));toggle.classList.toggle('lit',on);};
   toggle.addEventListener('click',()=>{const on=!document.body.classList.contains('abl-mixer-io');document.body.classList.toggle('abl-mixer-io',on);try{document.defaultView?.localStorage?.setItem(ABL_MIXER_IO_KEY,on?'1':'0');}catch{}for(const other of document.querySelectorAll('.abl-section-toggle[data-section="io"]')){other.setAttribute('aria-pressed',String(on));other.classList.toggle('lit',on);}});
   try{if(document.defaultView?.localStorage?.getItem(ABL_MIXER_IO_KEY)==='1')document.body.classList.add('abl-mixer-io');}catch{}
   paint();}
 }
}
/** Sends knobs for one strip (idempotent): one per Return for a track, none on Returns / Main (no bus→bus). */
export function paintSends(sends,rows,row,hooks={}){
 const document=sends.ownerDocument,returns=row.kind==='lane'?ablReturnRows(rows):[],controller=hooks.sends||null,supported=!!controller&&(hooks.sendsSupported?.()??ablSendsSupported());
 paintInOut(sends,row);
 const signature=JSON.stringify([row.kind,supported,returns.map(item=>[item.row.id,item.letter,item.row.name])]);
 if(sends.dataset.ablSends!==signature){sends.dataset.ablSends=signature;sends.innerHTML='<span class="abl-sends-label">Sends</span>';
  if(row.kind==='lane'&&!returns.length)for(const letter of ['A','B']){const knob=document.createElement('span');knob.className='abl-send-knob';knob.setAttribute('role','slider');knob.setAttribute('aria-disabled','true');knob.setAttribute('aria-label',`Send ${letter}`);knob.title=supported?ABL_SENDS_NO_RETURNS:ABL_SENDS_UNAVAILABLE;knob.innerHTML=`<span class="abl-send-dial"></span><span class="abl-send-letter">${letter}</span>`;sends.append(knob);}
  for(const {row:bus,letter}of returns){const knob=document.createElement('span');knob.className='abl-send-knob';knob.dataset.busId=bus.id;knob.dataset.laneId=row.id;knob.dataset.letter=letter;knob.setAttribute('role','slider');knob.setAttribute('aria-valuemin','0');knob.setAttribute('aria-valuemax','1');knob.tabIndex=supported?0:-1;
   knob.innerHTML=`<span class="abl-send-dial"></span><span class="abl-send-letter">${esc(letter)}</span>`;if(supported)bindSendKnob(knob,hooks);sends.append(knob);}
  if(!sends.dataset.ablSendsMenu){sends.dataset.ablSendsMenu='1';sends.addEventListener('contextmenu',event=>{if(!event.target.closest?.('.abl-send-knob,.abl-sends-label'))return;event.preventDefault();event.stopPropagation();const knob=event.target.closest('.abl-send-knob[data-bus-id]');
   const items=[...knob?[{label:'Reset Send (-inf)',run:()=>resetSend(knob,hooks)}]:[],{label:'Insert Return Track',...hooks.insertReturnTrack?{run:()=>hooks.insertReturnTrack()}:{disabled:true,title:ABL_SENDS_UNAVAILABLE}}];try{hooks.menu?.(event,items);}catch(error){hooks.fail?.(error);}});}}
 for(const knob of sends.querySelectorAll('.abl-send-knob[data-bus-id]')){const bus=returns.find(item=>item.row.id===knob.dataset.busId);if(!bus)continue;
  if(!supported){knob.setAttribute('aria-disabled','true');knob.title=ABL_SENDS_UNAVAILABLE;continue;}
  if(knob.dataset.dragging)continue;let send=null;try{send=controller.current(row.id,bus.row.id);}catch{}paintKnob(knob,send?send.level:0,sendLabel(bus.letter,bus.row,send),controller.known?.()!==false);}
}
function paintKnob(knob,level,title,known=true){const position=ablSendGainToPosition(level);knob.style.setProperty('--abl-send-position',String(Math.round(position*1000)/1000));knob.classList.toggle('on',level>0);knob.classList.toggle('pending',!known);
 knob.setAttribute('aria-disabled','false');knob.setAttribute('aria-valuenow',String(Math.round(position*1000)/1000));knob.setAttribute('aria-valuetext',level>0?ablLevelText(level)+' dB':'-inf');knob.setAttribute('aria-label',title);knob.title=`${title} · drag to change, ⌥-click or double-click to reset`;}
function sendFailure(error,hooks){if(error?.code==='mix_revision_conflict'||error?.code==='send_busy'){try{hooks.toast?.(error.message);}catch{}return;}try{hooks.fail?.(error);}catch{}}
function resetSend(knob,hooks){const controller=hooks.sends;if(!controller)return;const letter=knob.dataset.letter;
 return controller.commit({laneId:knob.dataset.laneId,busId:knob.dataset.busId,reset:true,label:`Reset Send ${letter}`}).catch(error=>sendFailure(error,hooks)).finally(()=>hooks.repaintSends?.());}
/** Live knob drag, the same as every device knob (abl-dev-knob.js): vertical, relative to the press, ABL_KNOB_DRAG_PX for the
 * full sweep, ⇧ = ABL_KNOB_FINE× finer (re-anchored when ⇧ changes mid-drag); a dB value box follows; one write on release. */
function bindSendKnob(knob,hooks){
 let drag=null;const controller=()=>hooks.sends;
 knob.addEventListener('pointerdown',event=>{event.stopPropagation();if(event.button!==0)return;event.preventDefault();
  if(event.altKey){resetSend(knob,hooks);return;}
  let send=null;try{send=controller()?.current(knob.dataset.laneId,knob.dataset.busId);}catch{}
  const start=ablSendGainToPosition(send?.level??0);drag={pointerId:event.pointerId,y:event.clientY,start,base:start,fine:!!event.shiftKey,position:null};knob.dataset.dragging='1';try{knob.setPointerCapture?.(event.pointerId);}catch{}});
 knob.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;event.preventDefault();
  const fine=!!event.shiftKey;if(fine!==drag.fine){drag.base=drag.position??drag.base;drag.y=event.clientY;drag.fine=fine;}
  drag.position=Math.max(0,Math.min(1,drag.base+(drag.y-event.clientY)/(ABL_KNOB_DRAG_PX*(fine?ABL_KNOB_FINE:1))));const gain=ablSendPositionToGain(drag.position);
  const text=gain>0?ablLevelText(gain)+' dB':'-inf';paintKnob(knob,gain,`Send ${knob.dataset.letter}: ${text}`);knob.dataset.value=text;});
 const end=event=>{if(!drag||event.pointerId!==drag.pointerId)return;const done=drag;drag=null;delete knob.dataset.dragging;delete knob.dataset.value;try{knob.releasePointerCapture?.(event.pointerId);}catch{}
  if(done.position===null||Math.abs(done.position-done.start)<1e-4){hooks.repaintSends?.();return;}
  const level=Math.round(ablSendPositionToGain(done.position)*1e6)/1e6;
  controller()?.commit({laneId:knob.dataset.laneId,busId:knob.dataset.busId,level,label:`Send ${knob.dataset.letter}`}).catch(error=>sendFailure(error,hooks)).finally(()=>hooks.repaintSends?.());};
 knob.addEventListener('pointerup',end);knob.addEventListener('pointercancel',end);
 knob.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();resetSend(knob,hooks);});
 knob.addEventListener('click',event=>event.stopPropagation());
}
/** The Main activator: Studio Pro's "Mute master volume" (master volume to 0 and back to its level, one Undo step).
 * hooks.mainActivator (or the shell's) = {state()→{enabled,muted,reason}, toggle()}. */
const mainActivatorOf=hooks=>hooks.mainActivator||globalThis.window?.vegetableStudio?.ablShell?.mainActivator||null;
export function paintMainActivator(strip,hooks={}){
 const controls=strip.querySelector('.strip-controls');const activator=mainActivatorOf(hooks);if(!controls)return null;
 let button=controls.querySelector('.abl-main-activator');
 if(!activator){button?.remove();return null;}
 if(!button){button=strip.ownerDocument.createElement('button');button.type='button';button.className='abl-activator abl-main-activator';button.textContent='';
  button.addEventListener('pointerdown',event=>event.stopPropagation());
  button.addEventListener('click',event=>{event.stopPropagation();const current=mainActivatorOf(hooks);if(!current)return;let result;try{result=current.toggle();}catch(error){try{hooks.fail?.(error);}catch{}return;}Promise.resolve(result).catch(error=>{try{hooks.fail?.(error);}catch{}}).finally(()=>paintMainActivator(strip,hooks));});
  controls.prepend(button);}
 let state={enabled:false,muted:false,reason:'Main gain is unavailable.'};try{state=activator.state()||state;}catch{}
 button.disabled=!state.enabled;button.classList.toggle('on',!!state.muted);button.setAttribute('aria-pressed',String(!state.muted));
 button.setAttribute('aria-label',`Main activator (${state.muted?'off: muted':'on'})`);button.title=state.enabled?`Main Activator: ${state.muted?'off (volume at −∞) · click to restore the level':'on · click to mute the Main output (volume to −∞)'}`:state.reason||'Main gain is unavailable.';
 return button;
}
export function paintArm(arm,laneId,hooks={}){let state={available:false,armed:false,reason:'Record arm is unavailable.'};try{state=hooks.armState?.(laneId)||state;}catch{}arm.disabled=!state.available;arm.classList.toggle('on',!!state.armed&&!!state.available);arm.setAttribute('aria-pressed',String(!!state.armed&&!!state.available));arm.title=state.available?(state.armed?'Arm Recording: on (the Record button records into this track)':'Arm Recording'):state.reason||'Only audio tracks record';}
/**
 * Mounts Live strips into the Arrangement and Session mixer hosts as soon as they
 * exist (re-mounting when the shell replaces a host). hooks: mountStrips(element,
 * {stripClass, idAttribute, onRendered, levelScale, formatLevel}) → {view, render, destroy},
 * trackColor(row), armState(laneId), toggleArm(laneId), fail(error).
 */
/** Repaint one mount's .selected strip from the app's selected row (MixerStripView.selected), never throwing. */
function paintSelected(handle){try{const view=handle?.view;if(view&&!view.destroyed&&typeof view.selected==='function')view.selected();}catch{}}
export class AblMixer{
 constructor(hooks={}){
  this.hooks=hooks;this.document=hooks.document||globalThis.document;this.mounts=new Map();this.destroyed=false;
  // Aux sends: the app's live mix tracker (getEngineMix tracks[].sends + mixRevision) when it is on this project,
  // else our own getEngineMix read; writes and their Undo steps go through the shared engine tools.
  const win=this.document.defaultView||globalThis,projectId=()=>{const value=String(hooks.projectId?.()||'').split('|')[0];return value||null;};
  const tools=()=>win.ablEngineTools||globalThis.ablEngineTools||null;
  this.sends=hooks.sendController||new SendController({client:()=>hooks.studioClient?.()??tools()?.studioClient?.()??null,projectId,
   mix:()=>{const tracker=win.vegetableStudio?.mixRevision;return tracker?.mix&&tracker.projectId&&tracker.projectId===projectId()?sendsFromMix(tracker.mix):null;},
   recordStep:step=>hooks.recordStep?hooks.recordStep(step):tools()?.recordStep?.(step),onChange:()=>this.paintSends(),log:(kind,data)=>{try{hooks.log?.(kind,data);}catch{}}});
  this.sendHooks={sends:this.sends,repaintSends:()=>this.paintSends(),insertReturnTrack:()=>this.insertReturnTrack()};this.sendsReadFor=null;
  const Observer=this.document.defaultView?.MutationObserver||globalThis.MutationObserver;
  if(Observer){this.observer=new Observer(()=>this.attach());this.observer.observe(this.document.documentElement||this.document,{childList:true,subtree:true});}
  this.attach();
  // The shell's selected track (abl:track-select) is the selected strip, in both mixers.
  this.onTrackSelect=()=>{const run=()=>{if(!this.destroyed)this.paintSelection();};(globalThis.queueMicrotask||(fn=>Promise.resolve().then(fn)))(run);};
  this.document.addEventListener('abl:track-select',this.onTrackSelect);
 }
 paintSelection(){for(const {handle}of this.mounts.values())paintSelected(handle);}
 attach(){
  if(this.destroyed||!this.hooks.ready?.())return;
  for(const selector of [ABL_ARR_MIXER,ABL_SESSION_MIXER]){
   const host=this.document.querySelector(selector),mounted=this.mounts.get(selector);
   if(mounted&&(mounted.host!==host||!host?.isConnected)){try{mounted.handle.destroy();}catch{}this.mounts.delete(selector);}
   if(!host||this.mounts.has(selector))continue;
   try{
    // Live: a right-click on the activator opens a menu, never FL's "solo from the mute switch".
    host.addEventListener('pointerdown',event=>{if(event.target.closest?.('.abl-activator')&&(event.button===2||event.ctrlKey)){event.stopPropagation();event.preventDefault();}},true);
    host.addEventListener('contextmenu',event=>{if(event.target.closest?.('.abl-activator,.abl-solo,.abl-arm'))event.preventDefault();},true);
    // QA r6: a click on a strip (its title) is Live's track selection: after the strip view's own select (bubbling, so it
    // runs after the strip's listener) the shell selects that track (status bar, Device View, abl:track-select), and every
    // mount repaints its highlight — the Session strip selected the mixer row only and no strip lit.
    host.addEventListener('click',event=>{const strip=event.target.closest?.('[data-mixer-row]');if(!strip||event.button!==0||event.target.closest?.('input,button,.strip-db,.mixer-pan,.abl-sends'))return;
     let key=null;try{key=JSON.parse(strip.dataset.mixerRow);}catch{}if(Array.isArray(key)&&key[0]==='lane'&&key[1])try{this.hooks.selectTrackLane?.(String(key[1]));}catch(error){try{this.hooks.fail?.(error);}catch{}}
     this.paintSelection();(globalThis.queueMicrotask||(fn=>Promise.resolve().then(fn)))(()=>{if(!this.destroyed)this.paintSelection();});});
    // QA r5: the in-place sync (no full render) kept the old .selected strip; every decorate pass repaints the
    // selection from the app's selected row, so the highlight follows the shell's selected track.
    let handle=null;
    handle=this.hooks.mountStrips(host,{stripClass:'abl-mixer-strip',idAttribute:selector===ABL_ARR_MIXER?'ablArrMixer':'ablSessionMixer',levelScale:ablFaderLevelScale,formatLevel:ablLevelText,onRendered:(element,rows)=>{this.rows=rows;decorateAblStrips(element,rows,{...this.hooks,...this.sendHooks});this.loadSends();if(handle)paintSelected(handle);}});
    this.mounts.set(selector,{host,handle});
   }catch(error){try{this.hooks.log?.('abl-mixer-mount-error',{selector,message:String(error?.message||error).slice(0,160)});}catch{}}
  }
 }
 /** Read the live sends once per opened project when the mix tracker has none (repaints when it lands). */
 loadSends(){const id=String(this.hooks.projectId?.()||'');if(!id||this.sendsReadFor===id||!ablSendsSupported()||this.sends.known())return;this.sendsReadFor=id;
  Promise.resolve().then(()=>this.sends.refresh()).catch(error=>{this.sendsReadFor=null;try{this.hooks.log?.('abl-send-read-error',{message:String(error?.message||error).slice(0,160)});}catch{}});}
 paintSends(){if(this.destroyed)return;for(const {host}of this.mounts.values())for(const sends of host.querySelectorAll('.abl-sends')){const strip=sends.closest('[data-mixer-row]'),row=this.rows?.find(item=>item.key===strip?.dataset.mixerRow);if(row)try{paintSends(sends,this.rows,row,{...this.hooks,...this.sendHooks});}catch{}}}
 /** Live's Insert Return Track (⌥⌘T): one createBus (next free bus id, "<Letter>-Return"); Undo deletes it. */
 async insertReturnTrack(){
  const win=this.document.defaultView||globalThis,refresh=()=>this.hooks.refresh?this.hooks.refresh():win.vegetableStudio?.engine?.refresh?.();
  const client=this.sends.client(),projectId=this.sends.projectId(),buses=(this.rows||[]).filter(row=>row.kind==='bus').map(row=>({busId:row.id}));
  const created=await createReturnBus({client,projectId,buses});const {deleteReturnBus}=await import('./studio-api-sends.js');
  const step={kind:'mixer_return',label:'Insert Return Track',undo:async()=>{await deleteReturnBus({client:this.sends.client(),projectId,busId:created.busId});await refresh();return{status:'confirmed'};},
   redo:async()=>{await createReturnBus({client:this.sends.client(),projectId,buses:buses.filter(bus=>bus.busId!==created.busId)});await refresh();return{status:'confirmed'};},detail:{busId:created.busId,name:created.name}};
  const tools=(this.document.defaultView||globalThis).ablEngineTools;(this.hooks.recordStep||tools?.recordStep)?.(step);try{await refresh();}catch{}try{this.hooks.toast?.(`${created.name} inserted.`);}catch{}return created;}
 /** Repaint arm buttons (record-enable changes outside the mixer). */
 paintArms(){for(const {host}of this.mounts.values())for(const arm of host.querySelectorAll('.abl-arm')){const laneId=arm.dataset.laneId;if(laneId)paintArm(arm,laneId,this.hooks);}}
 render(){for(const {handle}of this.mounts.values())try{handle.render();}catch{}}
 destroy(){this.destroyed=true;this.document.removeEventListener('abl:track-select',this.onTrackSelect);this.observer?.disconnect();for(const {handle}of this.mounts.values())try{handle.destroy();}catch{}this.mounts.clear();}
}
