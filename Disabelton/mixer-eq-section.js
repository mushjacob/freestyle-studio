/** FL 2026 mixer right panel "Equalizer": three bands (low shelf, mid peak, high
 * shelf) with a gain fader each plus frequency and bandwidth controls, drawn over
 * the response curve. Wired to the lane EQ STAGE through the typed Studio API
 * (getLaneEq / setLaneEqBand without plugin_index, the same contract as the native
 * EQ window): bands 0, 1, 2. A drag sends persist:false engine ticks; the release
 * writes persist:true, reads it back and is one history step ("EQ low – Drums").
 * Untouched bands (Freestyle stores off/bell/1 kHz/0 dB/Q 1) are shown at FL's
 * defaults and take that shape when first moved. Nothing is invented: the
 * section only renders after a typed getLaneEq read of this lane. */
import {LaneEqController,studioEqSender,eqBandPristine,eqCurvePath,eqGeometry,describeEqBand,EQ_LIMITS} from './eq-editor.js';

export const MIXER_EQ_BANDS=Object.freeze([
 {band:0,key:'low',label:'Low',type:'low_shelf',frequency:90,q:.7},
 {band:1,key:'mid',label:'Mid',type:'bell',frequency:1500,q:.7},
 {band:2,key:'high',label:'High',type:'high_shelf',frequency:8000,q:.7}]);
const FREQ=EQ_LIMITS.frequency,Q=EQ_LIMITS.q,logPos=(value,[min,max])=>Math.log(value/min)/Math.log(max/min),logValue=(pos,[min,max])=>min*(max/min)**pos;
const shown=(band,spec)=>eqBandPristine(band)?{...band,type:spec.type,frequency_hz:spec.frequency,q:spec.q}:band;

/** FL knob/fader feel (QA round 23: a 30 px drag jumped to +18 dB): pointer drags are
 * RELATIVE and vertical — EQ_DRAG_PX for the whole range, Shift for 5x finer — instead
 * of the native range input's absolute click-to-position. Keyboard stays native. */
export const EQ_DRAG_PX=220,EQ_FINE_FACTOR=5;
export function attachRelativeDrag(node,{onPreview,onCommit,pixels=EQ_DRAG_PX}={}){
 let drag=null;
 node.addEventListener('pointerdown',event=>{if(event.button!==0||node.disabled)return;event.preventDefault();node.focus?.({preventScroll:true});try{node.setPointerCapture?.(event.pointerId);}catch{}drag={pointerId:event.pointerId,y:event.clientY,value:Number(node.value),moved:false};});
 node.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;event.preventDefault();const min=Number(node.min),max=Number(node.max),span=max-min,step=Number(node.step)||span/1000,per=span/(pixels*(event.shiftKey?EQ_FINE_FACTOR:1)),dy=drag.y-event.clientY;
  // Re-anchor on every move (toggling Shift never jumps); keep the unrounded value so fine drags accumulate.
  drag.value=Math.min(max,Math.max(min,drag.value+dy*per));drag.y=event.clientY;const next=Math.round(Math.round(drag.value/step)*step*1e6)/1e6;if(String(next)!==node.value){node.value=String(next);drag.moved=true;onPreview?.();}});
 const end=event=>{if(!drag||event.pointerId!==drag.pointerId)return;const moved=drag.moved;drag=null;try{node.releasePointerCapture?.(event.pointerId);}catch{}if(moved)onCommit?.();};
 node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);node.addEventListener('lostpointercapture',end);
 // The native click-to-position never fires a change on its own: drags are ours.
 node.addEventListener('click',event=>event.preventDefault());
}
/** Guard refusals that clear by themselves (an edit/Undo is running, or the project moved while a snapshot loaded). */
export const isTransientEqError=error=>/current cloud operation|operation to finish|cloud project changed|project changed while|fresh snapshot/i.test(String(error?.message||error));
export const EQ_LOAD_RETRIES=6;
export const eqRetryDelay=attempt=>Math.min(4000,300*2**Math.max(0,attempt));
export function mountMixerEqSection({projectId,laneId,trackId=null,laneName='Track',fetch,historyFetch=fetch,history=null,historyScope=()=>undefined,log=()=>{},onError=()=>{},idle=null,document:doc=globalThis.document}={}){
 const root=doc.createElement('section');root.className='mixer-eq';root.setAttribute('aria-label',`Equalizer – ${laneName}`);
 root.innerHTML='<svg class="mixer-eq-curve" viewBox="0 0 170 82" aria-hidden="true"><path class="mixer-eq-grid" d="M0 41H170M57 0V82M113 0V82"/><path class="mixer-eq-line" d="M0 41H170"/></svg><div class="mixer-eq-faders"></div><div class="mixer-eq-label">Equalizer</div><div class="mixer-eq-knobs"></div><p class="mixer-eq-status" role="status"></p>';
 const faders=root.querySelector('.mixer-eq-faders'),knobs=root.querySelector('.mixer-eq-knobs'),status=root.querySelector('.mixer-eq-status'),line=root.querySelector('.mixer-eq-line');
 const scope={projectId,laneId,trackId};let inFlight=0,destroyed=false;
 const make=(send,hooks={})=>new LaneEqController({send,...scope,...hooks,log});
 // Undo/Redo: a history-scoped writer. While this section is open and idle, the band it last
 // confirmed (from a write reply or read) is the guard, so the step is ONE write confirmed by
 // its reply (QA round 23: read → write → read took 1128 ms).
 // QA round 24: the knob, fader, handle and curve show the step's band at once (optimistic);
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
 const eq=make(studioEqSender(fetch),{onBegin,onCommit,onFail});
 const controls=new Map();
 const input=(cls,min,max,step,aria)=>{const node=doc.createElement('input');node.type='range';node.className=cls;node.min=String(min);node.max=String(max);node.step=String(step);node.setAttribute('aria-label',aria);return node;};
 for(const spec of MIXER_EQ_BANDS){
  const gain=input('mixer-eq-gain',EQ_LIMITS.gain[0],EQ_LIMITS.gain[1],.1,`${spec.label} gain`),frequency=input('mixer-eq-knob mixer-eq-frequency',0,1,.001,`${spec.label} frequency`),width=input('mixer-eq-knob mixer-eq-width',0,1,.001,`${spec.label} bandwidth`);
  gain.setAttribute('orient','vertical');faders.append(gain);knobs.append(frequency);controls.set(spec.band,{gain,frequency,width,spec});
 }
 for(const spec of MIXER_EQ_BANDS)knobs.append(controls.get(spec.band).width);
 const patchFrom=(spec,control)=>{const c=controls.get(spec.band);return{enabled:true,type:spec.type,gain_db:Number(c.gain.value),frequency_hz:Math.round(logValue(Number(c.frequency.value),FREQ)*100)/100,q:Math.round(logValue(1-Number(c.width.value),Q)*1000)/1000};};
 const paint=()=>{
  for(const spec of MIXER_EQ_BANDS){const c=controls.get(spec.band),band=eq.band(spec.band);const ready=!!band;for(const node of [c.gain,c.frequency,c.width])node.disabled=!ready||destroyed;if(!band)continue;
   const view=shown(band,spec);if(eq.drag?.band!==spec.band){c.gain.value=String(view.gain_db);c.frequency.value=String(logPos(view.frequency_hz,FREQ));c.width.value=String(1-logPos(view.q,Q));}
   const text=`${spec.label}: ${view.gain_db>0?'+':''}${view.gain_db.toFixed(1)} dB · ${view.frequency_hz>=1000?(view.frequency_hz/1000).toFixed(2)+' kHz':Math.round(view.frequency_hz)+' Hz'} · Q ${view.q.toFixed(2)}${band.enabled?'':' (off)'}`;for(const node of [c.gain,c.frequency,c.width])node.title=text;c.gain.setAttribute('aria-valuetext',text);}
  try{line.setAttribute('d',eqCurvePath(eq.bands.filter(band=>band.enabled),170,82));}catch{}
 };
 // FL graph handles: one point per band on the curve; drag = frequency (x) and gain (y),
 // relative, Shift finer; release commits the same band the faders/knobs write.
 const svg=root.querySelector('.mixer-eq-curve'),geometry=eqGeometry(170,82),handles=new Map(),SVG_NS='http://www.w3.org/2000/svg';
 for(const spec of MIXER_EQ_BANDS){
  const handle=doc.createElementNS(SVG_NS,'circle');handle.setAttribute('class','mixer-eq-handle');handle.setAttribute('r','4.5');handle.dataset.band=String(spec.band);handle.setAttribute('tabindex','-1');svg.append(handle);handles.set(spec.band,handle);
  let drag=null;
  handle.addEventListener('pointerdown',event=>{if(event.button!==0||!eq.band(spec.band))return;event.preventDefault();event.stopPropagation();try{handle.setPointerCapture?.(event.pointerId);}catch{}const c=controls.get(spec.band);drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,fx:geometry.x(logValue(Number(c.frequency.value),FREQ)),gy:geometry.y(Number(c.gain.value)),moved:false};});
  handle.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;event.preventDefault();const rect=svg.getBoundingClientRect?.(),sx=rect?.width?170/rect.width:1,sy=rect?.height?82/rect.height:1,fine=event.shiftKey?EQ_FINE_FACTOR:1;
   drag.fx=Math.min(170,Math.max(0,drag.fx+(event.clientX-drag.x)*sx/fine));drag.gy=Math.min(82,Math.max(0,drag.gy+(event.clientY-drag.y)*sy/fine));drag.x=event.clientX;drag.y=event.clientY;
   const c=controls.get(spec.band);c.frequency.value=String(logPos(geometry.frequency(drag.fx),FREQ));c.gain.value=String(Math.round(Math.min(EQ_LIMITS.gain[1],Math.max(EQ_LIMITS.gain[0],geometry.gain(drag.gy)))*10)/10);drag.moved=true;
   try{eq.preview(spec.band,patchFrom(spec,c.gain));}catch(error){onError(error);}});
  const end=event=>{if(!drag||event.pointerId!==drag.pointerId)return;const moved=drag.moved;drag=null;try{handle.releasePointerCapture?.(event.pointerId);}catch{}if(moved)eq.commit(spec.band,patchFrom(spec,controls.get(spec.band).gain)).then(()=>{status.textContent='';},error=>{status.textContent=error.message;onError(error);});};
  handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
 }
 const paintHandles=()=>{for(const spec of MIXER_EQ_BANDS){const handle=handles.get(spec.band),band=eq.band(spec.band);if(!band){handle.setAttribute('visibility','hidden');continue;}const view=shown(band,spec);handle.setAttribute('visibility','visible');handle.setAttribute('cx',geometry.x(view.frequency_hz).toFixed(1));handle.setAttribute('cy',geometry.y(view.gain_db).toFixed(1));handle.classList.toggle('off',!band.enabled);handle.setAttribute('aria-label',`${spec.label} band`);}};
 eq.addEventListener('change',paintHandles);
 eq.addEventListener('change',paint);
 for(const spec of MIXER_EQ_BANDS){const c=controls.get(spec.band);for(const node of [c.gain,c.frequency,c.width]){
  attachRelativeDrag(node,{onPreview:()=>node.dispatchEvent(new (doc.defaultView?.Event||Event)('input')),onCommit:()=>node.dispatchEvent(new (doc.defaultView?.Event||Event)('change'))});
  node.addEventListener('input',()=>{try{eq.preview(spec.band,patchFrom(spec,node));}catch(error){onError(error);}});
  node.addEventListener('change',()=>{eq.commit(spec.band,patchFrom(spec,node)).then(()=>{status.textContent='';},error=>{status.textContent=error.message;onError(error);});});
  node.addEventListener('dblclick',()=>{c.gain.value='0';eq.commit(spec.band,{...patchFrom(spec,node),gain_db:0}).catch(error=>{status.textContent=error.message;});});
 }}
 paint();paintHandles();
 // Disabelton QA r3: "The cloud project changed…" (startup) and "Wait for the current cloud operation…" (during an
 // insert) are transient guard refusals. They are retried quietly with backoff once the app is idle; the section never
 // shows them nor asks for a click. Only a real failure (or one still refused after the retries) is shown.
 const loadQuietly=async()=>{
  for(let attempt=0;;attempt++){
   try{return await eq.load();}
   catch(error){if(destroyed||!isTransientEqError(error)||attempt>=EQ_LOAD_RETRIES)throw error;
    status.textContent='Reading the EQ…';log('mixer-eq-load-retry',{laneId,attempt:attempt+1,message:String(error?.message||error).slice(0,120)});
    await new Promise(resolve=>setTimeout(resolve,eqRetryDelay(attempt)));try{await idle?.();}catch{}if(destroyed)throw error;}
  }
 };
 const ready=loadQuietly().then(()=>{status.textContent=eq.target?.live===false?'Saved EQ (lane not in the live session)':'';paint();},error=>{if(destroyed)return;status.textContent=error.message;log('mixer-eq-load-error',{laneId,code:error?.code??null,status:error?.status??null,message:String(error?.message||error).slice(0,120)});paint();});
 return{element:root,controller:eq,ready,laneId,busy:()=>inFlight>0||!!eq.drag,reload:()=>inFlight||eq.drag?Promise.resolve():loadQuietly().then(()=>{status.textContent='';paint();},()=>{}),destroy(){destroyed=true;eq.removeEventListener('change',paint);eq.removeEventListener('change',paintHandles);root.remove();}};
}
