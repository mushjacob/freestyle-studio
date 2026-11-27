/**
 * Disabelton Device View: native Freestyle EQ shown like Live's EQ Eight.
 *
 * A light curve panel (log frequency × ±18 dB) with the response curve and one numbered dot per
 * band, then a compact band row: band selectors 1–8 (the lit ones are on), the selected band's
 * on/off switch, filter type, and Freq / Gain / Q knobs (Live knobs, abl-dev-knob.js).
 *
 * Edits go through the lane EQ stage exactly like the other EQ editors (eq-editor.js
 * LaneEqController → typed getLaneEq / setLaneEqBand): persist:false ticks while a dot or knob is
 * dragged, ONE persist:true write on release, and ONE Undo step per gesture (history
 * begin/finish external step, undo/redo replay the exact band with applyExact). Transient guard
 * refusals while loading ("The cloud project changed…", "Wait for the current cloud operation…")
 * are retried quietly once idle — never shown as an error, never a click-to-read prompt.
 *
 * Every band is drawn at its engine frequency, as in Live (QA r5). Untouched bands (Freestyle stores
 * off/bell/1 kHz/0 dB/Q 1) all sit at 1 kHz, so stacked dots are fanned out slightly to stay grabbable;
 * a drag always starts from the engine value, and moving an untouched band turns it on.
 */
import {LaneEqController,studioEqSender,eqCurvePath,eqGeometry,eqBandPristine,describeEqBand,eqTypeLabel,EQ_LIMITS,EQ_BAND_TYPES} from './eq-editor.js';
import {AblKnob} from './abl-dev-knob.js';
import {isTransientEqError,EQ_LOAD_RETRIES,eqRetryDelay} from './mixer-eq-section.js';

export const ABL_EQ_VIEW=Object.freeze({width:240,height:92});
const FREQ=EQ_LIMITS.frequency,Q=EQ_LIMITS.q,GAIN=EQ_LIMITS.gain;
const logPos=(value,[min,max])=>Math.log(Math.max(min,Math.min(max,value))/min)/Math.log(max/min),logValue=(pos,[min,max])=>min*(max/min)**Math.max(0,Math.min(1,pos));
const round=(value,digits)=>Math.round(value*10**digits)/10**digits;
export const ablEqFrequencyText=hz=>hz>=1000?`${(hz/1000).toFixed(hz>=10000?1:2)} kHz`:`${Math.round(hz)} Hz`;
export const ablEqGainText=db=>`${db>0?'+':db<0?'−':''}${Math.abs(db).toFixed(1)} dB`;
/** The band as drawn: an untouched band sits at its spread frequency. */
/** QA r5: every band is drawn at its engine frequency, as in Live (no spread of untouched bands). */
export const ablEqShownBand=band=>band?{...band}:null;
/** Dots that would sit on top of each other (e.g. Freestyle's eight untouched bands, all at 1 kHz / 0 dB) are fanned
 * out horizontally by ABL_EQ_STACK_PX per dot, centred on the true position — display only; a drag starts from the
 * engine value. Returns band → x offset in view units. */
export const ABL_EQ_STACK_PX=9;
export function ablEqStackOffsets(points,{radius=6,step=ABL_EQ_STACK_PX}={}){
 const offsets=new Map(),groups=[];
 for(const point of points){const group=groups.find(items=>items.some(other=>Math.hypot(other.x-point.x,other.y-point.y)<radius));if(group)group.push(point);else groups.push([point]);}
 for(const group of groups){group.sort((a,b)=>a.band-b.band);group.forEach((point,i)=>offsets.set(point.band,group.length>1?(i-(group.length-1)/2)*step:0));}
 return offsets;
}
/** Patch for a dot drag: the band keeps its shape; an untouched band is turned on. */
const shapePatch=(band,patch)=>({...(eqBandPristine(band)?{enabled:true}:{}),...patch});
/** QA r4: the band row shows (and edits from) the engine's values; a knob or type edit on an untouched band
 * turns it on where the engine has it (1 kHz), it never jumps to the dot's spread position. */
const valuePatch=(band,patch)=>({...(eqBandPristine(band)?{enabled:true}:{}),...patch});
/** Live EQ Eight's filter types → the Freestyle lane EQ shape (Notch has no Freestyle shape: listed, disabled). */
export const ABL_EQ_LIVE_TYPES=Object.freeze([
 {id:'low_cut',name:'Low Cut',type:'high_pass',glyph:'M1 10C4 10 5 3 8 3H15'},
 {id:'low_shelf',name:'Low Shelf',type:'low_shelf',glyph:'M1 3H5L9 7H15'},
 {id:'bell',name:'Bell',type:'bell',glyph:'M1 8H4Q7.5 -1 11 8H15'},
 {id:'notch',name:'Notch',type:null,glyph:'M1 3H5L8 10L11 3H15'},
 {id:'high_shelf',name:'High Shelf',type:'high_shelf',glyph:'M1 7H6L10 3H15'},
 {id:'high_cut',name:'High Cut',type:'low_pass',glyph:'M1 3H7C10 3 11 10 15 10'},
]);
export const ABL_EQ_NOTCH_REASON='The Freestyle EQ has no notch shape';
/** Name + glyph for an engine shape: Live's name where one maps, otherwise the Freestyle shape's own name. */
export function ablEqTypeInfo(type){const live=ABL_EQ_LIVE_TYPES.find(item=>item.type===type);return live?{name:live.name,glyph:live.glyph,live:true}:{name:eqTypeLabel(type),glyph:/low_pass/.test(type)?ABL_EQ_LIVE_TYPES[5].glyph:/high_pass/.test(type)?ABL_EQ_LIVE_TYPES[0].glyph:/low_shelf|bass/.test(type)?ABL_EQ_LIVE_TYPES[1].glyph:/high_shelf|treble/.test(type)?ABL_EQ_LIVE_TYPES[4].glyph:ABL_EQ_LIVE_TYPES[2].glyph,live:false};}
/** Live's frequency axis labels. */
export const ABL_EQ_AXIS=Object.freeze([[100,'100'],[1000,'1k'],[10000,'10k']]);
const glyphSvg=d=>`<svg class="abl-eq8-glyph" viewBox="0 0 16 12" aria-hidden="true"><path d="${d}"/></svg>`;

export function mountAblEqEight({projectId,laneId,trackId=null,laneName='Track',fetch,historyFetch=fetch,history=null,historyScope=()=>undefined,log=()=>{},onError=()=>{},idle=null,document:doc=globalThis.document,raf}={}){
 const {width:W,height:H}=ABL_EQ_VIEW,geometry=eqGeometry(W,H),SVG='http://www.w3.org/2000/svg';
 const root=doc.createElement('section');root.className='abl-eq8';root.setAttribute('aria-label',`EQ Eight – ${laneName}`);
 const grid=[50,100,200,500,1000,2000,5000,10000].map(f=>`M${geometry.x(f).toFixed(1)} 0V${H}`).join('')+[-12,-6,6,12].map(db=>`M0 ${geometry.y(db).toFixed(1)}H${W}`).join('');
 const axis=ABL_EQ_AXIS.map(([hz,text])=>`<span class="abl-eq8-axis-label" data-hz="${hz}" style="left:${(geometry.x(hz)/W*100).toFixed(2)}%">${text}</span>`).join('');
 root.innerHTML=`<div class="abl-eq8-plot"><svg class="abl-eq8-display" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="group" aria-label="EQ curve"><path class="abl-eq8-grid" d="${grid}"/><path class="abl-eq8-zero" d="M0 ${H/2}H${W}"/><path class="abl-eq8-fill"/><path class="abl-eq8-curve"/><g class="abl-eq8-dots"></g></svg><div class="abl-eq8-axis" aria-hidden="true">${axis}</div></div>`
  +'<div class="abl-eq8-row"><div class="abl-eq8-bands" role="radiogroup" aria-label="Band"></div><button type="button" class="abl-eq8-on" aria-pressed="false" title="Band on/off">On</button><span class="abl-eq8-type-box"><button type="button" class="abl-eq8-type" aria-haspopup="listbox" aria-expanded="false" aria-label="Filter type"></button></span><div class="abl-eq8-knob" data-knob="frequency"></div><div class="abl-eq8-knob" data-knob="gain"></div><div class="abl-eq8-knob" data-knob="q"></div></div><p class="abl-eq8-status" role="status"></p>';
 const svg=root.querySelector('svg'),curve=root.querySelector('.abl-eq8-curve'),fill=root.querySelector('.abl-eq8-fill'),dots=root.querySelector('.abl-eq8-dots'),bandsBox=root.querySelector('.abl-eq8-bands'),onButton=root.querySelector('.abl-eq8-on'),typeSelect=root.querySelector('.abl-eq8-type'),status=root.querySelector('.abl-eq8-status');
 let destroyed=false,inFlight=0,selected=0,typeMenu=null;
 const scope={projectId,laneId,trackId},make=(send,hooks={})=>new LaneEqController({send,...scope,...hooks,log});
 // Undo/Redo: the same history contract as the mixer EQ section (one guarded write per step, optimistic repaint).
 const showLocal=value=>{const local=eq.band(value.band);if(!local||destroyed)return;Object.assign(local,value);eq.emit();};
 const apply=band=>async(from,to)=>{const writer=make(studioEqSender(historyFetch()));const open=!destroyed&&!eq.drag&&eq.target?.kind==='lane',known=open?eq.confirmedBand(band):null;
  if(open)showLocal({...to,band});let confirmed;
  try{confirmed=await writer.applyExact(from,to,open?{known,target:eq.target}:{});}catch(error){if(open)showLocal({...(eq.confirmedBand(band)||known||from),band});throw error;}
  if(!destroyed)eq.adopt(confirmed);log('abl-eq8-history',{laneId,band,to:describeEqBand(confirmed)});return{laneId,band,value:confirmed};};
 const label=band=>`EQ band ${band+1} – ${laneName}`;
 const step=({band,before,after})=>({undo:()=>apply(band)(after,before),redo:()=>apply(band)(before,after),detail:{laneId,band,before,after,section:'device'}});
 const onBegin=({band})=>{inFlight++;let token=null;try{token=history?.beginExternalStep?.({kind:'eq_band',label:label(band)})??null;}catch{token=null;}return{token};};
 const onCommit=({band,before,after,token})=>{inFlight=Math.max(0,inFlight-1);if(token?.token)history.finishExternalStep(token.token,step({band,before,after}));else history?.recordExternalStep?.({kind:'eq_band',label:label(band),scope:historyScope(),...step({band,before,after})});};
 const onFail=({token,error})=>{inFlight=Math.max(0,inFlight-1);if(token?.token)history.failExternalStep(token.token,error);};
 const eq=make(studioEqSender(fetch),{onBegin,onCommit,onFail});
 const commit=(band,patch)=>eq.commit(band,patch).then(()=>{if(!destroyed)status.textContent='';},error=>{if(destroyed)return;status.textContent=error.message;onError(error);});
 const preview=(band,patch)=>{try{eq.preview(band,patch);}catch(error){onError(error);}};
 /** A gesture abandoned after previews: put the engine back on the confirmed band (live tick only, no history). */
 const cancel=band=>{const drag=eq.drag?.band===band?eq.drag:null;if(!drag)return;if(drag.timer!=null)clearTimeout(drag.timer);eq.drag=null;const before=eq.confirmedBand(band);if(!before)return;eq.rollback(band,before);eq.write(before,false).catch(()=>{});};

 // Band selectors and the selected band's knobs.
 const selectors=Array.from({length:EQ_LIMITS.bands},(_,band)=>{const button=doc.createElement('button');button.type='button';button.className='abl-eq8-band';button.dataset.band=String(band);button.textContent=String(band+1);button.setAttribute('role','radio');button.addEventListener('click',()=>select(band));bandsBox.append(button);return button;});
 const knobOptions=raf?{raf,caf:()=>{}}:{};
 const knobs={
  frequency:new AblKnob(root.querySelector('[data-knob="frequency"]'),{...knobOptions,min:0,max:1,label:'Frequency',defaultValue:logPos(1000,FREQ),format:pos=>ablEqFrequencyText(round(logValue(pos,FREQ),2)),onInput:pos=>preview(selected,valuePatch(eq.band(selected),{frequency_hz:round(logValue(pos,FREQ),2)})),onCommit:({after})=>commit(selected,valuePatch(eq.band(selected),{frequency_hz:round(logValue(after,FREQ),2)})),onCancel:()=>cancel(selected)}),
  gain:new AblKnob(root.querySelector('[data-knob="gain"]'),{...knobOptions,min:GAIN[0],max:GAIN[1],bipolar:true,label:'Gain',defaultValue:0,format:ablEqGainText,onInput:db=>preview(selected,valuePatch(eq.band(selected),{gain_db:round(db,1)})),onCommit:({after})=>commit(selected,valuePatch(eq.band(selected),{gain_db:round(after,1)})),onCancel:()=>cancel(selected)}),
  q:new AblKnob(root.querySelector('[data-knob="q"]'),{...knobOptions,min:0,max:1,label:'Q',defaultValue:logPos(.71,Q),format:pos=>`Q ${logValue(pos,Q).toFixed(2)}`,onInput:pos=>preview(selected,valuePatch(eq.band(selected),{q:round(logValue(pos,Q),3)})),onCommit:({after})=>commit(selected,valuePatch(eq.band(selected),{q:round(logValue(after,Q),3)})),onCancel:()=>cancel(selected)}),
 };
 for(const [key,knob]of Object.entries(knobs)){const caption=doc.createElement('span');caption.className='abl-eq8-knob-label';caption.textContent=key==='frequency'?'Freq':key==='gain'?'Gain':'Q';knob.element.prepend(caption);}
 onButton.addEventListener('click',()=>{const band=eq.band(selected);if(!band||eq.drag)return;commit(selected,{enabled:!band.enabled});});
 // Filter type: Live's chooser (glyph + name), not a native <select> (QA r4: rendered as "– · ·").
 const closeTypeMenu=()=>{if(!typeMenu)return;typeMenu.remove();typeMenu=null;typeSelect.setAttribute('aria-expanded','false');doc.removeEventListener('pointerdown',outsideTypeMenu,true);};
 const outsideTypeMenu=event=>{if(typeMenu&&!typeMenu.contains(event.target)&&!typeSelect.contains(event.target))closeTypeMenu();};
 const pickType=type=>{closeTypeMenu();const band=eq.band(selected);if(!band||eq.drag||!EQ_BAND_TYPES.includes(type)||band.type===type)return;commit(selected,valuePatch(band,{type}));};
 typeSelect.addEventListener('click',()=>{
  if(typeMenu){closeTypeMenu();return;}const band=eq.band(selected);if(!band||typeSelect.disabled)return;
  typeMenu=doc.createElement('div');typeMenu.className='abl-eq8-type-menu';typeMenu.setAttribute('role','listbox');typeMenu.setAttribute('aria-label','Filter type');
  typeMenu.innerHTML=ABL_EQ_LIVE_TYPES.map(item=>`<button type="button" role="option" class="abl-eq8-type-option" data-live-type="${item.id}"${item.type?` data-type="${item.type}"`:` disabled aria-disabled="true" title="${ABL_EQ_NOTCH_REASON}"`} aria-selected="${item.type===band.type}">${glyphSvg(item.glyph)}<span>${item.name}</span></button>`).join('');
  typeMenu.addEventListener('click',event=>{const option=event.target.closest?.('.abl-eq8-type-option');if(option&&!option.disabled)pickType(option.dataset.type);});
  typeMenu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeTypeMenu();typeSelect.focus?.();}});
  typeSelect.parentElement.append(typeMenu);typeSelect.setAttribute('aria-expanded','true');doc.addEventListener('pointerdown',outsideTypeMenu,true);
  (typeMenu.querySelector('[aria-selected="true"]')||typeMenu.querySelector('.abl-eq8-type-option:not([disabled])'))?.focus?.();
 });
 function select(band){selected=band;paint();}

 // Curve dots: drag = frequency (x) and gain (y), relative like Live, ⇧ finer; release commits once.
 const dotNodes=Array.from({length:EQ_LIMITS.bands},(_,band)=>{
  const g=doc.createElementNS(SVG,'g');g.setAttribute('class','abl-eq8-dot');g.dataset.band=String(band);
  const circle=doc.createElementNS(SVG,'circle');circle.setAttribute('r','6');const text=doc.createElementNS(SVG,'text');text.setAttribute('text-anchor','middle');text.setAttribute('dy','3');text.textContent=String(band+1);g.append(circle,text);dots.append(g);
  let drag=null;
  g.addEventListener('pointerdown',event=>{const current=eq.band(band);if(event.button!==0||!current)return;event.preventDefault();event.stopPropagation();select(band);try{g.setPointerCapture?.(event.pointerId);}catch{}const shown=ablEqShownBand(current);drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,fx:geometry.x(shown.frequency_hz),gy:geometry.y(shown.gain_db),moved:false};});
  g.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;event.preventDefault();const rect=svg.getBoundingClientRect?.(),sx=rect?.width?W/rect.width:1,sy=rect?.height?H/rect.height:1,fine=event.shiftKey?5:1;
   drag.fx=Math.min(W,Math.max(0,drag.fx+(event.clientX-drag.x)*sx/fine));drag.gy=Math.min(H,Math.max(0,drag.gy+(event.clientY-drag.y)*sy/fine));drag.x=event.clientX;drag.y=event.clientY;drag.moved=true;
   preview(band,shapePatch(eq.band(band),drag.patch=dotPatch(drag)));});
  const end=event=>{if(!drag||event.pointerId!==drag.pointerId)return;const done=drag;drag=null;try{g.releasePointerCapture?.(event.pointerId);}catch{}if(done.moved)commit(band,shapePatch(eq.band(band),done.patch||dotPatch(done)));};
  g.addEventListener('pointerup',end);g.addEventListener('pointercancel',event=>{if(!drag||event.pointerId!==drag.pointerId)return;drag=null;cancel(band);});
  g.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();const current=eq.band(band);if(current&&!eq.drag)commit(band,{enabled:!current.enabled});});
  return g;
 });
 const dotPatch=drag=>({frequency_hz:round(Math.min(FREQ[1],Math.max(FREQ[0],geometry.frequency(drag.fx))),2),gain_db:round(Math.min(GAIN[1],Math.max(GAIN[0],geometry.gain(drag.gy))),1)});

 function paint(){
  if(destroyed)return;const ready=eq.bands.length>0;root.classList.toggle('loading',!ready);
  const active=eq.bands.filter(band=>band.enabled);try{const path=eqCurvePath(active,W,H);curve.setAttribute('d',path);fill.setAttribute('d',`${path}L${W} ${H/2}L0 ${H/2}Z`);}catch{}
  const dotY=value=>Math.min(H-6,Math.max(6,geometry.y(value.gain_db)));
  const stack=ablEqStackOffsets(eq.bands.map(value=>({band:value.band,x:geometry.x(value.frequency_hz),y:dotY(value)})));
  for(let band=0;band<dotNodes.length;band++){
   const node=dotNodes[band],value=ablEqShownBand(eq.band(band));if(!value){node.setAttribute('visibility','hidden');continue;}
   const x=Math.min(W-6,Math.max(6,geometry.x(value.frequency_hz)+(stack.get(band)||0)));node.dataset.frequency=String(value.frequency_hz);node.classList.toggle('stacked',!!stack.get(band));
   node.setAttribute('visibility','visible');node.setAttribute('transform',`translate(${x.toFixed(1)} ${dotY(value).toFixed(1)})`);
   node.classList.toggle('off',!value.enabled);node.classList.toggle('selected',band===selected);
   const button=selectors[band];button.classList.toggle('on',!!value.enabled);button.classList.toggle('selected',band===selected);button.setAttribute('aria-checked',String(band===selected));button.title=`Band ${band+1}: ${describeEqBand(eq.band(band))}`;
  }
  // The band row shows the engine's values (QA r4: an untouched band read "40 Hz" while the engine has 1 kHz).
  const band=eq.band(selected),enabled=!!band&&!destroyed;
  for(const knob of Object.values(knobs))knob.setDisabled(!enabled);onButton.disabled=!enabled;typeSelect.disabled=!enabled;
  if(!band){for(const knob of Object.values(knobs))knob.set(null);typeSelect.textContent='';closeTypeMenu();return;}
  onButton.classList.toggle('on',!!band.enabled);onButton.setAttribute('aria-pressed',String(!!band.enabled));
  if(typeSelect.dataset.type!==band.type){const info=ablEqTypeInfo(band.type);typeSelect.dataset.type=band.type;typeSelect.innerHTML=`${glyphSvg(info.glyph)}<span class="abl-eq8-type-name">${info.name}</span><span class="abl-eq8-type-arrow" aria-hidden="true">▾</span>`;typeSelect.title=`Filter type: ${info.name}`;}
  knobs.frequency.set(logPos(band.frequency_hz,FREQ));knobs.gain.set(band.gain_db);knobs.q.set(logPos(band.q,Q));
  root.dataset.selectedBand=String(selected);
 }
 eq.addEventListener('change',paint);
 const loadQuietly=async()=>{
  for(let attempt=0;;attempt++){
   try{return await eq.load();}
   catch(error){if(destroyed||!isTransientEqError(error)||attempt>=EQ_LOAD_RETRIES)throw error;
    status.textContent='Reading the EQ…';log('mixer-eq-load-retry',{laneId,attempt:attempt+1,view:'device',message:String(error?.message||error).slice(0,120)});
    await new Promise(resolve=>setTimeout(resolve,eqRetryDelay(attempt)));try{await idle?.();}catch{}if(destroyed)throw error;}
  }
 };
 status.textContent='Reading the EQ…';paint();
 // Select the first band that is on (Live opens on the band you last used; we have no such memory).
 const ready=loadQuietly().then(()=>{if(destroyed)return;const first=eq.bands.find(band=>band.enabled);if(first)selected=first.band;status.textContent=eq.target?.live===false?'Saved EQ (lane not in the live session)':'';paint();},error=>{if(destroyed)return;status.textContent=error.message;log('mixer-eq-load-error',{laneId,view:'device',code:error?.code??null,status:error?.status??null,message:String(error?.message||error).slice(0,120)});paint();});
 return{element:root,controller:eq,ready,laneId,select,get selected(){return selected;},busy:()=>inFlight>0||!!eq.drag||Object.values(knobs).some(knob=>knob.active),gesturing:()=>!!eq.drag||Object.values(knobs).some(knob=>knob.active),
  reload:()=>inFlight||eq.drag?Promise.resolve():loadQuietly().then(()=>{status.textContent='';paint();},()=>{}),
  destroy(){destroyed=true;closeTypeMenu();eq.removeEventListener('change',paint);for(const knob of Object.values(knobs))knob.destroy();root.remove();}};
}
