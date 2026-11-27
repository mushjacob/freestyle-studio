/** Mixer right panel "Equalizer": the integrated three-band track EQ (low shelf,
 * mid peak, high shelf), drawn like the reference mixer EQ (fl_mixer_panel_eq.png):
 * a recessed graph in the panel grey with only a faint line at each band's frequency,
 * a faint 0 dB centre line, ONE light-grey response curve (no fill, no handles), the
 * band readouts written on the graph ("90Hz -4.2", "1.5k 5.8") and a corner mark;
 * three thin gain faders with metal caps and an orange level from 0 dB to the cap;
 * under the graph the dim "Equalizer" label and two rows of three knobs (frequency,
 * bandwidth) behind a comb glyph and a ↔ glyph.
 * Graph, faders and knobs are views of ONE band state (the LaneEqController).
 *
 * Gestures: press anywhere on the graph and drag — the band nearest the pointer moves
 * (x = frequency, y = gain, Shift finer); right-drag / Alt-drag = bandwidth; wheel =
 * bandwidth of the nearest band; double-click = reset that band; right-click = menu.
 *
 * Wired to the lane EQ STAGE through the typed Studio API (getLaneEq /
 * setLaneEqBand without plugin_index, the same contract as the native EQ window):
 * engine bands 0, 1, 2. A drag sends persist:false engine ticks (audible while
 * dragging); the release writes persist:true and is ONE history step
 * ("EQ low – Drums"). Untouched bands (Freestyle stores off/bell/1 kHz/0 dB/Q 1)
 * are shown at the defaults below and take that shape when first moved.
 * Nothing is invented: the section only renders bands after a typed getLaneEq read
 * of this lane, and `unavailable` mounts the same panel disabled with the reason.
 *
 * Geometry: mixer-eq-scale.js. Every x/y (band line, curve, readout, hit point) comes
 * from that one scale, built from the graph's real CSS size and devicePixelRatio. */
import {LaneEqController,studioEqSender,eqBandPristine,eqResponse,describeEqBand,EQ_LIMITS} from './eq-editor.js';
import {mixerEqScale,mixerEqBandLines,mixerEqGainGrid,mixerEqCurvePath,mixerEqFrequencyPos,mixerEqFrequencyAtPos,mixerEqReadout,mixerEqReadoutPlace,formatEqFrequency,formatEqGain} from './mixer-eq-scale.js';
import {knobMenuItems} from './knob-context-menu.js';

export const MIXER_EQ_BANDS=Object.freeze([
 {band:0,key:'low',label:'Low',type:'low_shelf',frequency:90,q:.7,color:'#f0864a'},
 {band:1,key:'mid',label:'Mid',type:'bell',frequency:1500,q:.7,color:'#a5d84c'},
 {band:2,key:'high',label:'High',type:'high_shelf',frequency:8000,q:.7,color:'#4db6ee'}]);
/** What Freestyle stores for a band nobody touched; "reset" writes exactly this. */
export const MIXER_EQ_PRISTINE=Object.freeze({enabled:false,type:'bell',frequency_hz:1000,gain_db:0,q:1});
/** The graph's inner size in the reference (145 × 104 css px with its 1 px frame). */
export const MIXER_EQ_GRAPH_FALLBACK=Object.freeze({width:143,height:102});
/** Radius of a band's (invisible) anchor point; the press area is MIXER_EQ_HIT_RADIUS. */
export const MIXER_EQ_HANDLE_RADIUS=2;
export const MIXER_EQ_HIT_RADIUS=11;
export const MIXER_EQ_LOAD_RETRIES=Object.freeze([1200,2500,5000]);
const Q=EQ_LIMITS.q,GAIN=EQ_LIMITS.gain,logPos=(value,[min,max])=>Math.log(value/min)/Math.log(max/min),logValue=(pos,[min,max])=>min*(max/min)**pos;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const shown=(band,spec)=>eqBandPristine(band)?{...band,type:spec.type,frequency_hz:spec.frequency,q:spec.q}:band;
const SVG_NS='http://www.w3.org/2000/svg';
/** Readout font metrics (css px): digit height above the baseline, and an estimate of a
 * glyph's advance used when the browser cannot measure the text (tests, hidden panel). */
const READOUT_HEIGHT=9,READOUT_ADVANCE=5.6;
// The reference's two glyphs: a comb (frequency) and a double arrow (bandwidth).
const COMB_GLYPH='<svg class="mixer-eq-glyph mixer-eq-glyph-frequency" viewBox="0 0 8 6" aria-hidden="true" focusable="false"><path d="M.5 0v6M4 0v6M7.5 0v6M0 5.25h8" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';
const ARROW_GLYPH='<svg class="mixer-eq-glyph mixer-eq-glyph-width" viewBox="0 0 12 7" aria-hidden="true" focusable="false"><path d="M1 3.5h10M3.6 .9 1 3.5l2.6 2.6M8.4 .9 11 3.5 8.4 6.1" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Knob/fader feel (QA round 23: a 30 px drag jumped to +18 dB): pointer drags are
 * RELATIVE and vertical — EQ_DRAG_PX for the whole range, Shift for 5x finer — instead
 * of the native range input's absolute click-to-position. Keyboard stays native. */
export const EQ_DRAG_PX=220,EQ_FINE_FACTOR=5;
export function attachRelativeDrag(node,{onPreview,onCommit,pixels=EQ_DRAG_PX}={}){
 let drag=null;
 node.addEventListener('pointerdown',event=>{if(event.button!==0||node.disabled)return;event.preventDefault();node.focus?.({preventScroll:true});try{node.setPointerCapture?.(event.pointerId);}catch{}drag={pointerId:event.pointerId,y:event.clientY,value:Number(node.value),moved:false};node.parentElement?.classList.add('dragging');});
 node.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;event.preventDefault();const min=Number(node.min),max=Number(node.max),span=max-min,step=Number(node.step)||span/1000,per=span/(pixels*(event.shiftKey?EQ_FINE_FACTOR:1)),dy=drag.y-event.clientY;
  // Re-anchor on every move (toggling Shift never jumps); keep the unrounded value so fine drags accumulate.
  drag.value=Math.min(max,Math.max(min,drag.value+dy*per));drag.y=event.clientY;const next=Math.round(Math.round(drag.value/step)*step*1e6)/1e6;if(String(next)!==node.value){node.value=String(next);drag.moved=true;onPreview?.();}});
 const end=event=>{if(!drag||event.pointerId!==drag.pointerId)return;const moved=drag.moved;drag=null;node.parentElement?.classList.remove('dragging');try{node.releasePointerCapture?.(event.pointerId);}catch{}if(moved)onCommit?.();};
 node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);node.addEventListener('lostpointercapture',end);
 // The native click-to-position never fires a change on its own: drags are ours.
 node.addEventListener('click',event=>event.preventDefault());
}

/** "Low 120 Hz +3.0 dB" (hint bar and aria text); `q` adds the bandwidth. */
export function mixerEqHint(spec,view,{q=false}={}){return`${spec.label} ${formatEqFrequency(view.frequency_hz)} ${formatEqGain(view.gain_db)}${q?` · Q ${view.q.toFixed(2)}`:''}`;}

/** Options: `unavailable` (a reason string) mounts the panel disabled with that tooltip and no
 * engine traffic. `hintElement` is the app's hint bar. `onMenu(event,items)` opens the app's
 * context menu; `onTypeIn(title,label,value,apply)` its text dialog. */
export function mountMixerEqSection({projectId,laneId,trackId=null,laneName='Track',fetch,historyFetch=fetch,history=null,historyScope=()=>undefined,log=()=>{},onError=()=>{},unavailable=null,hintElement=null,onMenu=null,onTypeIn=null,document:doc=globalThis.document}={}){
 const view=doc.defaultView||globalThis,root=doc.createElement('section');root.className='mixer-eq';root.setAttribute('aria-label',`Equalizer – ${laneName}`);
 root.innerHTML=`<div class="mixer-eq-graph"><svg class="mixer-eq-curve" aria-hidden="true" focusable="false"><path class="mixer-eq-grid major"/><path class="mixer-eq-grid zero"/><path class="mixer-eq-line"/><g class="mixer-eq-readouts"></g><g class="mixer-eq-bands"></g><path class="mixer-eq-corner"/></svg></div><div class="mixer-eq-faders" role="group" aria-label="Band gain"></div><span class="mixer-eq-title" aria-hidden="true">Equalizer</span><div class="mixer-eq-knobs" role="group" aria-label="Band frequency and bandwidth">${COMB_GLYPH}${ARROW_GLYPH}</div><p class="mixer-eq-status" role="status"></p>`;
 const $=selector=>root.querySelector(selector),svg=$('.mixer-eq-curve'),faders=$('.mixer-eq-faders'),knobs=$('.mixer-eq-knobs'),status=$('.mixer-eq-status'),line=$('.mixer-eq-line'),bandLayer=$('.mixer-eq-bands'),readoutLayer=$('.mixer-eq-readouts');
 const scopeIds={projectId,laneId,trackId};let inFlight=0,destroyed=false,scale=null,hover=null;
 const make=(send,hooks={})=>new LaneEqController({send,...scopeIds,...hooks,log});
 // Undo/Redo: a history-scoped writer. While this section is open and idle, the band it last
 // confirmed (from a write reply or read) is the guard, so the step is ONE write confirmed by
 // its reply (QA round 23: read → write → read took 1128 ms).
 // QA round 24: the knob, fader, readout and curve show the step's band at once (optimistic);
 // a refusal puts the confirmed band back.
 const showLocal=value=>{const local=eq.band(value.band);if(!local||destroyed)return;Object.assign(local,value);eq.emit();};
 const apply=band=>async(from,to)=>{const writer=make(studioEqSender(historyFetch()));const open=!destroyed&&!eq.drag&&eq.target?.kind==='lane',known=open?eq.confirmedBand(band):null;
  if(open)showLocal({...to,band});let confirmed;
  try{confirmed=await writer.applyExact(from,to,open?{known,target:eq.target}:{});}catch(error){if(open)showLocal({...(eq.confirmedBand(band)||known||from),band});throw error;}if(!destroyed)eq.adopt(confirmed);log('mixer-eq-history',{laneId,band,to:describeEqBand(confirmed)});return{laneId,band,value:confirmed};};
 const label=band=>`EQ ${MIXER_EQ_BANDS[band]?.label.toLowerCase()||'band '+(band+1)} – ${laneName}`;
 const step=({band,before,after})=>({undo:()=>apply(band)(after,before),redo:()=>apply(band)(before,after),detail:{laneId,band,before,after,section:'mixer'}});
 const onBegin=({band})=>{inFlight++;let token=null;try{token=history?.beginExternalStep?.({kind:'eq_band',label:label(band)})??null;}catch{token=null;}return{token};};
 const onCommit=({band,before,after,token})=>{inFlight=Math.max(0,inFlight-1);if(token?.token)history.finishExternalStep(token.token,step({band,before,after}));else history?.recordExternalStep?.({kind:'eq_band',label:label(band),scope:historyScope(),...step({band,before,after})});};
 const onFail=({token,error})=>{inFlight=Math.max(0,inFlight-1);if(token?.token)history.failExternalStep(token.token,error);};
 const eq=unavailable?null:make(studioEqSender(fetch),{onBegin,onCommit,onFail});
 const bandOf=index=>eq?.band(index)||null,viewOf=spec=>{const band=bandOf(spec.band);return band?shown(band,spec):null;};

 // ---- Hint bar: our text while hovering/dragging; the previous text comes back on leave.
 const hint={shown:null,previous:null,owner:null};
 const showHint=(text,owner)=>{if(!hintElement)return;if(hint.shown===null||hintElement.textContent!==hint.shown)hint.previous=hintElement.textContent;hintElement.textContent=hint.shown=text;hint.owner=owner;};
 const clearHint=owner=>{if(!hintElement||hint.shown===null||owner!==undefined&&hint.owner!==owner)return;if(hintElement.textContent===hint.shown)hintElement.textContent=hint.previous??'';hint.shown=hint.owner=null;};

 // ---- Controls: real range inputs (keyboard, aria) under drawn fader caps and knob faces.
 const controls=new Map(),exact=new WeakMap();
 const input=(cls,min,max,stepSize,aria)=>{const node=doc.createElement('input');node.type='range';node.className=cls;node.min=String(min);node.max=String(max);node.step=String(stepSize);node.setAttribute('aria-label',aria);return node;};
 const wrap=(cls,spec,node,face)=>{const shell=doc.createElement('span');shell.className=cls;shell.dataset.band=String(spec.band);shell.append(node);shell.insertAdjacentHTML('beforeend',face);return shell;};
 for(const spec of MIXER_EQ_BANDS){
  const gain=input('mixer-eq-gain',GAIN[0],GAIN[1],.1,`${spec.label} gain`),frequency=input('mixer-eq-knob mixer-eq-frequency',0,1,.001,`${spec.label} frequency`),width=input('mixer-eq-knob mixer-eq-width',0,1,.001,`${spec.label} bandwidth`);
  gain.setAttribute('aria-orientation','vertical');
  faders.append(wrap('mixer-eq-fader',spec,gain,'<i class="mixer-eq-slot" aria-hidden="true"></i><i class="mixer-eq-level" aria-hidden="true"></i><i class="mixer-eq-cap" aria-hidden="true"></i>'));
  controls.set(spec.band,{gain,frequency,width,spec});
 }
 for(const key of ['frequency','width'])for(const spec of MIXER_EQ_BANDS)knobs.append(wrap(`mixer-eq-dial mixer-eq-dial-${key}`,spec,controls.get(spec.band)[key],'<i class="mixer-eq-dial-face" aria-hidden="true"></i>'));
 // An input the user has not moved since the last paint stands for the band's EXACT value
 // (a range input rounds to its step); only a moved input is converted back.
 const read=(node,convert)=>{const kept=exact.get(node);return kept&&kept.text===node.value?kept.value:convert(Number(node.value));};
 const write=(node,value,position)=>{node.value=String(position);exact.set(node,{text:node.value,value});};
 const patchFrom=spec=>{const c=controls.get(spec.band);return{enabled:true,type:spec.type,gain_db:read(c.gain,value=>value),frequency_hz:read(c.frequency,pos=>Math.round(mixerEqFrequencyAtPos(pos)*100)/100),q:read(c.width,pos=>Math.round(logValue(1-pos,Q)*1000)/1000)};};
 const face=node=>{const min=Number(node.min),max=Number(node.max),pos=clamp((Number(node.value)-min)/(max-min||1),0,1);node.parentElement?.style.setProperty('--pos',pos.toFixed(4));};

 // ---- Graph: per band an invisible press point (hit circle + anchor) and a text readout.
 const handles=new Map();
 for(const spec of MIXER_EQ_BANDS){
  const group=doc.createElementNS(SVG_NS,'g');group.setAttribute('class','mixer-eq-band');group.dataset.band=String(spec.band);
  const hit=doc.createElementNS(SVG_NS,'circle');hit.setAttribute('class','mixer-eq-hit');hit.setAttribute('r',String(MIXER_EQ_HIT_RADIUS));
  const handle=doc.createElementNS(SVG_NS,'circle');handle.setAttribute('class','mixer-eq-handle');handle.setAttribute('r',String(MIXER_EQ_HANDLE_RADIUS));handle.dataset.band=String(spec.band);
  group.append(hit,handle);bandLayer.append(group);
  const text=doc.createElementNS(SVG_NS,'text');text.setAttribute('class','mixer-eq-readout');text.dataset.band=String(spec.band);
  const value=doc.createElementNS(SVG_NS,'tspan'),unit=doc.createElementNS(SVG_NS,'tspan'),gain=doc.createElementNS(SVG_NS,'tspan');value.setAttribute('class','mixer-eq-readout-value');unit.setAttribute('class','mixer-eq-readout-unit');gain.setAttribute('class','mixer-eq-readout-value');
  text.append(value,unit,gain);readoutLayer.append(text);
  handles.set(spec.band,{group,hit,handle,text,value,unit,gain});
 }
 // CSS px per client px: 1 unless an ancestor is zoomed/transformed.
 const zoom=()=>{const rect=svg.getBoundingClientRect?.(),width=svg.clientWidth;return rect?.width&&width?rect.width/width:1;};
 const layout=()=>{
  const width=svg.clientWidth||MIXER_EQ_GRAPH_FALLBACK.width,height=svg.clientHeight||MIXER_EQ_GRAPH_FALLBACK.height,dpr=view.devicePixelRatio||1;
  if(scale&&scale.width===width&&scale.height===height&&scale.dpr===dpr)return false;
  scale=mixerEqScale(width,height,{dpr});svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  // 0 dB centre line, and the reference's small resize mark in the bottom-right corner.
  $('.mixer-eq-grid.zero').setAttribute('d',mixerEqGainGrid(scale).filter(item=>item.zero).map(item=>`M${scale.left} ${scale.snap(item.y,.5)}H${scale.right}`).join(''));
  const r=scale.right,b=scale.bottom;$('.mixer-eq-corner').setAttribute('d',`M${r} ${b-9}V${b}H${r-9}Z`);
  return true;
 };
 /** Where a band sits (CSS px in the graph): the SAME scale and snap as its line. */
 const handlePoint=band=>{const spec=MIXER_EQ_BANDS.find(item=>item.band===band),value=spec&&viewOf(spec);if(!value||!scale)return null;return{x:scale.snap(scale.x(value.frequency_hz)),y:scale.snap(scale.y(value.gain_db)),frequency_hz:value.frequency_hz,gain_db:value.gain_db};};
 const readouts=new Map();
 const text=(spec,value,band)=>`${spec.label}: ${value.gain_db>0?'+':''}${value.gain_db.toFixed(1)} dB · ${value.frequency_hz>=1000?(value.frequency_hz/1000).toFixed(2)+' kHz':Math.round(value.frequency_hz)+' Hz'} · Q ${value.q.toFixed(2)}${band.enabled?'':' (off)'}`;
 const measure=(node,chars)=>{let width=0;try{width=node.getComputedTextLength?.()||0;}catch{width=0;}return width>0?width:chars*READOUT_ADVANCE;};
 const paint=()=>{
  layout();const ready=!!eq&&MIXER_EQ_BANDS.some(spec=>bandOf(spec.band));root.classList.toggle('unavailable',!!unavailable);root.classList.toggle('loading',!unavailable&&!ready);
  // The summed response of every enabled engine band (bands 3–7 too, if the full EQ set them).
  const active=eq?eq.bands.filter(band=>band.enabled):[],response=hz=>eqResponse(active,hz),curveY=px=>clamp(scale.yRaw(response(scale.frequencyAt(px))),1,scale.height-1);
  const lines=[],placed=[];
  for(const spec of MIXER_EQ_BANDS){
   const c=controls.get(spec.band),band=bandOf(spec.band),nodes=[c.gain,c.frequency,c.width],part=handles.get(spec.band);
   for(const node of nodes)node.disabled=!band||destroyed;
   // No band (no EQ stage, or not read yet): neutral positions, nothing to grab, no readout.
   if(!band){write(c.gain,0,0);write(c.frequency,spec.frequency,mixerEqFrequencyPos(spec.frequency));write(c.width,spec.q,1-logPos(spec.q,Q));for(const node of nodes){node.title=unavailable||'Reading this track’s equalizer…';face(node);}part.group.setAttribute('visibility','hidden');part.text.setAttribute('visibility','hidden');lines.push(spec.frequency);readouts.delete(spec.band);continue;}
   const value=shown(band,spec);lines.push(value.frequency_hz);
   if(eq.drag?.band!==spec.band){write(c.gain,value.gain_db,value.gain_db);write(c.frequency,value.frequency_hz,mixerEqFrequencyPos(value.frequency_hz));write(c.width,value.q,1-logPos(value.q,Q));}
   const title=text(spec,value,band);for(const node of nodes){node.title=title;face(node);}
   c.gain.setAttribute('aria-valuetext',formatEqGain(value.gain_db));c.frequency.setAttribute('aria-valuetext',formatEqFrequency(value.frequency_hz));c.width.setAttribute('aria-valuetext',`Q ${value.q.toFixed(2)}`);
   const point=handlePoint(spec.band);part.group.setAttribute('visibility','visible');
   for(const circle of [part.hit,part.handle]){circle.setAttribute('cx',String(point.x));circle.setAttribute('cy',String(point.y));}
   part.group.classList.toggle('off',!band.enabled);part.handle.setAttribute('aria-label',`${spec.label} band`);
   // Readout: a band that changes the sound, or the band under the pointer / being dragged.
   const focused=hover===spec.band||drag?.band===spec.band,showReadout=band.enabled&&Math.abs(value.gain_db)>=.05||focused;
   part.text.setAttribute('visibility',showReadout?'visible':'hidden');part.text.classList.toggle('active',focused);
   if(showReadout){const words=mixerEqReadout(value.frequency_hz,value.gain_db);part.value.textContent=words.value;part.unit.textContent=words.unit;part.gain.textContent=' '+words.gain;
    const width=measure(part.text,words.value.length+words.unit.length+1+words.gain.length),place=mixerEqReadoutPlace(scale,point,{width,height:READOUT_HEIGHT,curveY,avoid:placed});placed.push({...place,width,height:READOUT_HEIGHT});
    part.text.setAttribute('x',String(Math.round(place.x*scale.dpr)/scale.dpr));part.text.setAttribute('y',String(Math.round(place.y*scale.dpr)/scale.dpr));readouts.set(spec.band,place);}
   else readouts.delete(spec.band);
  }
  // A faint line at each band's frequency (the reference draws no other grid).
  $('.mixer-eq-grid.major').setAttribute('d',mixerEqBandLines(scale,lines).map(item=>`M${item.x} ${scale.top}V${scale.bottom}`).join(''));
  try{line.setAttribute('d',mixerEqCurvePath(scale,response));}catch{}
 };
 const fail=error=>{status.textContent=error.message;onError(error);};
 const commit=(spec,patch)=>eq.commit(spec.band,patch).then(()=>{status.textContent='';},fail);
 const preview=(spec,patch)=>{try{eq.preview(spec.band,patch);}catch(error){onError(error);}};
 const hintFor=(spec,options)=>{const value=viewOf(spec);return value?mixerEqHint(spec,value,options):null;};

 // Wheel (no release event): preview each notch, commit once the wheel rests.
 const wheelTimers=new Map();
 const wheelCommit=spec=>{view.clearTimeout(wheelTimers.get(spec.band));wheelTimers.set(spec.band,view.setTimeout(()=>{wheelTimers.delete(spec.band);if(!destroyed&&bandOf(spec.band))commit(spec,patchFrom(spec));},320));};
 const nudge=(spec,node,event)=>{if(node.disabled||!event.deltaY)return;event.preventDefault();const min=Number(node.min),max=Number(node.max),stepSize=Number(node.step),amount=(max-min)/(event.shiftKey?200:40)*(event.deltaY<0?1:-1),next=clamp(Math.round((Number(node.value)+amount)/stepSize)*stepSize,min,max);
  if(String(Math.round(next*1e6)/1e6)===node.value)return;node.value=String(Math.round(next*1e6)/1e6);preview(spec,patchFrom(spec));wheelCommit(spec);};

 // ---- Graph gestures. A press picks the band whose point is under the pointer, else the
 // nearest band; drag = frequency (x) and gain (y), Shift finer; right-drag or Alt-drag =
 // bandwidth; wheel = bandwidth; double-click or right-click ▸ Reset = default band.
 const resetBand=spec=>{if(bandOf(spec.band))commit(spec,{...MIXER_EQ_PRISTINE});};
 const typeIn=(spec,key)=>{const value=viewOf(spec);if(!value||!onTypeIn)return;const fields={gain:[`${spec.label} gain`,'Gain (dB) · −18 to 18',String(Math.round(value.gain_db*10)/10),number=>({gain_db:clamp(number,GAIN[0],GAIN[1])})],frequency:[`${spec.label} frequency`,'Frequency (Hz) · 20 to 20000',String(Math.round(value.frequency_hz)),number=>({frequency_hz:clamp(number,EQ_LIMITS.frequency[0],EQ_LIMITS.frequency[1])})],width:[`${spec.label} bandwidth`,'Q · 0.1 (wide) to 18 (narrow)',String(Math.round(value.q*100)/100),number=>({q:clamp(number,Q[0],Q[1])})]}[key];
  onTypeIn(fields[0],fields[1],fields[2],entered=>{const number=Number(String(entered).replace(',','.'));if(!Number.isFinite(number)){fail(new Error('Type a number.'));return;}if(bandOf(spec.band))commit(spec,{...patchFrom(spec),...fields[3](number)});});};
 /** Graph-local CSS px of a pointer event. */
 const local=event=>{const rect=svg.getBoundingClientRect?.(),k=zoom();return rect?{x:(event.clientX-rect.left)/k,y:(event.clientY-rect.top)/k}:{x:0,y:0};};
 /** The band a pointer event is about: the point under it, else the nearest (x counts more). */
 const bandAt=event=>{const over=event.target?.closest?.('.mixer-eq-band');if(over)return MIXER_EQ_BANDS.find(spec=>spec.band===Number(over.dataset.band))||null;
  if(!scale)return null;const at=local(event);let best=null;for(const spec of MIXER_EQ_BANDS){const point=handlePoint(spec.band);if(!point)continue;const distance=Math.hypot(point.x-at.x,(point.y-at.y)/3);if(!best||distance<best.distance)best={spec,distance};}return best?.spec||null;};
 const setHover=band=>{if(hover===band)return;hover=band;paint();};
 let drag=null;
 svg.addEventListener('pointerdown',event=>{
  if(drag||!eq||event.button!==0&&event.button!==2)return;const spec=bandAt(event),value=spec&&viewOf(spec);if(!value)return;event.preventDefault();event.stopPropagation();try{svg.setPointerCapture?.(event.pointerId);}catch{}
  const c=controls.get(spec.band);drag={band:spec.band,spec,pointerId:event.pointerId,mode:event.button===2||event.altKey?'width':'move',button:event.button,x:event.clientX,y:event.clientY,px:scale.x(value.frequency_hz),py:scale.y(value.gain_db),width:Number(c.width.value),moved:false};
  handles.get(spec.band).group.classList.add('dragging');root.classList.add('dragging');paint();});
 svg.addEventListener('pointermove',event=>{
  if(!drag){if(event.buttons)return;const spec=bandAt(event);if(spec){setHover(spec.band);const message=hintFor(spec);if(message)showHint(message,handles.get(spec.band).group);}return;}
  if(event.pointerId!==drag.pointerId)return;event.preventDefault();const spec=drag.spec,c=controls.get(spec.band),k=zoom()*(event.shiftKey?EQ_FINE_FACTOR:1),dx=(event.clientX-drag.x)/k,dy=(event.clientY-drag.y)/k;if(!dx&&!dy)return;drag.x=event.clientX;drag.y=event.clientY;drag.moved=true;
  if(drag.mode==='width'){drag.width=clamp(drag.width-dy/(EQ_DRAG_PX/2),0,1);c.width.value=String(Math.round(drag.width*1000)/1000);preview(spec,patchFrom(spec));}
  else{drag.px=clamp(drag.px+dx,scale.left,scale.right);drag.py=clamp(drag.py+dy,scale.top,scale.bottom);
   const frequency=Math.round(scale.frequencyAt(drag.px)*100)/100,gain=Math.round(clamp(scale.gainAt(drag.py),GAIN[0],GAIN[1])*10)/10;
   // Horizontal-only or vertical-only motion leaves the other axis exactly as it was.
   const patch=patchFrom(spec);if(dx){patch.frequency_hz=frequency;write(c.frequency,frequency,mixerEqFrequencyPos(frequency));}if(dy){patch.gain_db=gain;write(c.gain,gain,gain);}
   preview(spec,patch);}
  const message=hintFor(spec,{q:drag.mode==='width'});if(message)showHint(message,handles.get(spec.band).group);});
 const end=event=>{if(!drag||event.pointerId!==drag.pointerId)return;const ended=drag,spec=ended.spec;drag=null;handles.get(spec.band).group.classList.remove('dragging');root.classList.remove('dragging');try{svg.releasePointerCapture?.(event.pointerId);}catch{}
  if(ended.moved)commit(spec,patchFrom(spec));
  else if(ended.button===2&&event.type==='pointerup'&&onMenu)onMenu(event,[['Type in frequency…','',()=>typeIn(spec,'frequency'),!onTypeIn],['Type in gain…','',()=>typeIn(spec,'gain'),!onTypeIn],['Type in bandwidth…','',()=>typeIn(spec,'width'),!onTypeIn],null,[`Reset ${spec.label.toLowerCase()} band`,'Double-click',()=>resetBand(spec)]]);
  if(!destroyed)paint();};
 // lostpointercapture: the panel was re-rendered (or the capture taken) mid-drag; the edit so far is committed.
 svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);svg.addEventListener('lostpointercapture',end);
 svg.addEventListener('dblclick',event=>{const spec=bandAt(event);if(!spec)return;event.preventDefault();resetBand(spec);});
 for(const spec of MIXER_EQ_BANDS){const {group}=handles.get(spec.band);
  group.addEventListener('pointerenter',()=>{if(!drag){const message=hintFor(spec);if(message)showHint(message,group);}});
  group.addEventListener('pointerleave',()=>{if(!drag)clearHint(group);});}
 // Wheel anywhere on the graph changes the bandwidth of the band under / nearest the pointer.
 svg.addEventListener('wheel',event=>{if(!scale||!eq)return;const spec=bandAt(event);if(!spec)return;nudge(spec,controls.get(spec.band).width,event);const message=hintFor(spec,{q:true});if(message)showHint(message,handles.get(spec.band).group);},{passive:false});
 svg.addEventListener('pointerleave',()=>{if(drag)return;for(const {group} of handles.values())clearHint(group);clearHint(svg);setHover(null);});
 svg.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();});

 // ---- Faders and knobs
 const defaults={gain:()=>({gain_db:0}),frequency:spec=>({frequency_hz:spec.frequency}),width:spec=>({q:spec.q})};
 for(const spec of MIXER_EQ_BANDS){const c=controls.get(spec.band);for(const key of ['gain','frequency','width']){
  const node=c[key],options={q:key==='width'},reset=()=>{if(bandOf(spec.band))commit(spec,{...patchFrom(spec),...defaults[key](spec)});},hintNow=()=>{const message=hintFor(spec,options);if(message)showHint(message,node);};
  // Alt+click / middle-click resets the control (before the relative drag sees the press).
  node.addEventListener('pointerdown',event=>{if(node.disabled||!(event.button===1||event.button===0&&event.altKey))return;event.preventDefault();event.stopImmediatePropagation();reset();});
  attachRelativeDrag(node,{onPreview:()=>node.dispatchEvent(new (view.Event||Event)('input')),onCommit:()=>node.dispatchEvent(new (view.Event||Event)('change'))});
  node.addEventListener('input',()=>{face(node);preview(spec,patchFrom(spec));hintNow();});
  node.addEventListener('change',()=>{commit(spec,patchFrom(spec));});
  node.addEventListener('dblclick',event=>{event.preventDefault();reset();});
  node.addEventListener('wheel',event=>{nudge(spec,node,event);hintNow();},{passive:false});
  node.addEventListener('pointerenter',()=>{hintNow();setHover(spec.band);});node.addEventListener('focus',()=>{hintNow();setHover(spec.band);});
  node.addEventListener('pointerleave',()=>{clearHint(node);setHover(null);});node.addEventListener('blur',()=>{clearHint(node);setHover(null);});
  node.addEventListener('contextmenu',event=>{event.preventDefault();if(node.disabled||!onMenu)return;onMenu(event,knobMenuItems({reset:{run:reset,shortcut:'Alt+click'},typeIn:onTypeIn?{run:()=>typeIn(spec,key)}:null}));});
 }}
 const repaint=()=>{if(!destroyed)paint();};
 eq?.addEventListener('change',repaint);
 // The graph follows its real size (mixer resize, zoom, devicePixelRatio change).
 let observer=null;if(typeof view.ResizeObserver==='function'){observer=new view.ResizeObserver(()=>{if(!destroyed&&layout()!==false)paint();});try{observer.observe(svg);}catch{observer=null;}}
 if(unavailable){root.title=unavailable;root.setAttribute('aria-disabled','true');root.setAttribute('aria-description',unavailable);}
 paint();
 // A refused first read (the app is busy opening the project, a transient network error) is
 // shown as it is and read again a few times; the controls stay disabled until a read succeeds.
 let retries=0,retryTimer=null;
 const load=()=>eq.load().then(()=>{status.textContent=eq.target?.live===false?'Saved EQ (lane not in the live session)':'';root.removeAttribute('title');paint();},error=>{status.textContent=error.message;root.title=error.message;log('mixer-eq-load-error',{laneId,code:error?.code??null,status:error?.status??null,retry:retries});paint();
  if(!destroyed&&retries<MIXER_EQ_LOAD_RETRIES.length)retryTimer=view.setTimeout(()=>{retryTimer=null;if(!destroyed&&!eq.bands.length)load();},MIXER_EQ_LOAD_RETRIES[retries++]);});
 const ready=eq?load():Promise.resolve();
 return{element:root,controller:eq,ready,laneId:eq?laneId:null,unavailable:unavailable||null,
  /** The scale in use, each band's point and its readout's anchor (CSS px in the graph): for layout checks. */
  geometry:()=>({scale,handles:MIXER_EQ_BANDS.map(spec=>({band:spec.band,...(handlePoint(spec.band)||{})})),readouts:MIXER_EQ_BANDS.map(spec=>({band:spec.band,...(readouts.get(spec.band)||{})}))}),
  busy:()=>inFlight>0||!!eq?.drag||wheelTimers.size>0,reload:()=>!eq||inFlight||eq.drag||wheelTimers.size?Promise.resolve():eq.load().then(paint,()=>{}),
  destroy(){
   // A wheel edit still waiting for its rest timer is committed now, not dropped.
   for(const band of wheelTimers.keys()){const spec=MIXER_EQ_BANDS.find(item=>item.band===band);if(spec&&bandOf(band))eq.commit(band,patchFrom(spec)).catch(onError);}
   destroyed=true;if(retryTimer!==null)view.clearTimeout(retryTimer);eq?.removeEventListener('change',repaint);observer?.disconnect();for(const timer of wheelTimers.values())view.clearTimeout(timer);wheelTimers.clear();clearHint();root.remove();}};
}
