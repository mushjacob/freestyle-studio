/**
 * Disabelton (Live-style) device controls: a rotary knob and an on/off switch.
 *
 * Display and gesture only. The host decides what a value means:
 *  - onInput(value) at most once per animation frame while dragging (realtime
 *    preview, e.g. the mozart-control live parameter path), never persistence;
 *  - onCommit({before, after}) once at the end of a gesture that changed the
 *    value (one write, one Undo step);
 *  - onCancel({before}) when a gesture is abandoned after previews were sent.
 * Drag is vertical (Live): 200 px covers the range, ⇧ is 10× finer. Double-click
 * resets to the default value (one gesture). Arrow keys step (one commit per key
 * release burst). Right-click / Ctrl-click calls onMenu(event).
 */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export const ABL_KNOB_DRAG_PX=200,ABL_KNOB_FINE=10;
const SWEEP=300,START=-150;// degrees: Live knobs leave a gap at the bottom.
function polar(cx,cy,r,deg){const rad=(deg-90)*Math.PI/180;return[cx+r*Math.cos(rad),cy+r*Math.sin(rad)];}
/** SVG arc path from angle a to b (degrees, 0 = up, clockwise). */
export function ablArcPath(cx,cy,r,a,b){
 if(Math.abs(b-a)<.01)return '';const [x1,y1]=polar(cx,cy,r,a),[x2,y2]=polar(cx,cy,r,b),large=Math.abs(b-a)>180?1:0,sweep=b>a?1:0;
 return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}
/** Fraction (0..1) of the range → knob angle in degrees. */
export const ablKnobAngle=fraction=>START+clamp(fraction,0,1)*SWEEP;
/** Snap to a step count (steps ≥ 2 → steps discrete positions over [min,max]). */
export function ablSnap(value,{min=0,max=1,steps=null}={}){
 const v=clamp(value,min,max);if(!Number.isInteger(steps)||steps<2)return v;
 const unit=(max-min)/(steps-1);return min+Math.round((v-min)/unit)*unit;
}
export class AblKnob{
 constructor(element,{min=0,max=1,value=null,defaultValue=null,steps=null,bipolar=false,label='',format=null,onInput=null,onCommit=null,onCancel=null,onMenu=null,onBegin=null,disabled=false,pixels=ABL_KNOB_DRAG_PX,raf=fn=>globalThis.requestAnimationFrame(fn),caf=id=>globalThis.cancelAnimationFrame(id)}={}){
  if(!element)throw new TypeError('AblKnob needs an element.');
  Object.assign(this,{element,min,max,value,defaultValue,steps,bipolar,label,format,onInput,onCommit,onCancel,onMenu,onBegin,pixels,raf,caf});
  this.document=element.ownerDocument;this.gesture=null;this.frame=null;this.destroyed=false;
  element.classList.add('abl-knob');element.tabIndex=0;element.setAttribute('role','slider');
  const ns='http://www.w3.org/2000/svg',svg=this.document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 32 32');svg.setAttribute('class','abl-knob-dial');svg.setAttribute('aria-hidden','true');
  this.track=this.document.createElementNS(ns,'path');this.track.setAttribute('class','abl-knob-track');this.track.setAttribute('d',ablArcPath(16,16,12,START,START+SWEEP));
  this.arc=this.document.createElementNS(ns,'path');this.arc.setAttribute('class','abl-knob-arc');
  this.needle=this.document.createElementNS(ns,'line');this.needle.setAttribute('class','abl-knob-needle');
  svg.append(this.track,this.arc,this.needle);
  this.text=this.document.createElement('span');this.text.className='abl-knob-value';
  element.replaceChildren(svg,this.text);
  this.listeners=[
   ['pointerdown',event=>this.pointerdown(event)],['pointermove',event=>this.pointermove(event)],['pointerup',event=>this.pointerup(event)],
   ['pointercancel',event=>{if(this.gesture?.pointerId===event.pointerId)this.cancel();}],['lostpointercapture',event=>{if(this.gesture?.pointerId===event.pointerId&&this.gesture.kind==='pointer')this.finish();}],
   ['dblclick',event=>this.reset(event)],['contextmenu',event=>{event.preventDefault();event.stopPropagation();this.menu(event);}],
   ['keydown',event=>this.keydown(event)],['keyup',event=>this.keyup(event)],['blur',()=>{if(this.gesture?.kind==='keyboard')this.finish();}],
  ];
  for(const [type,listener]of this.listeners)element.addEventListener(type,listener);
  this.setDisabled(disabled);this.paint(value);
 }
 get active(){return !!this.gesture;}
 fraction(value){return this.max>this.min&&finite(value)?(value-this.min)/(this.max-this.min):0;}
 display(value){if(!finite(value))return '—';if(typeof this.format==='function'){try{const text=this.format(value);if(typeof text==='string')return text;}catch{}}return `${Math.round(this.fraction(value)*100)}%`;}
 paint(value){
  const known=finite(value),fraction=this.fraction(value),angle=ablKnobAngle(fraction),origin=this.bipolar?ablKnobAngle(.5):START;
  this.arc.setAttribute('d',known?ablArcPath(16,16,12,Math.min(origin,angle),Math.max(origin,angle)):'');
  const [x1,y1]=polar(16,16,4,angle),[x2,y2]=polar(16,16,12,angle);this.needle.setAttribute('x1',x1.toFixed(2));this.needle.setAttribute('y1',y1.toFixed(2));this.needle.setAttribute('x2',x2.toFixed(2));this.needle.setAttribute('y2',y2.toFixed(2));
  this.needle.style.visibility=known?'':'hidden';this.text.textContent=this.display(value);
  this.element.dataset.value=known?String(value):'';this.element.setAttribute('aria-valuemin',String(this.min));this.element.setAttribute('aria-valuemax',String(this.max));
  if(known)this.element.setAttribute('aria-valuenow',String(value));else this.element.removeAttribute('aria-valuenow');
  this.element.setAttribute('aria-valuetext',this.text.textContent);if(this.label)this.element.setAttribute('aria-label',this.label);
 }
 /** Adopt a value from outside (engine read, other view). Ignored mid-gesture. */
 set(value){this.value=value;if(!this.gesture)this.paint(value);}
 setDisabled(disabled){this.disabled=!!disabled;this.element.classList.toggle('disabled',this.disabled);this.element.setAttribute('aria-disabled',String(this.disabled));if(this.disabled&&this.gesture)this.cancel();}
 menu(event){if(this.gesture)return;try{this.onMenu?.(event);}catch{}}
 begin(kind,extra={}){
  if(this.disabled||this.gesture||!finite(this.value))return false;
  this.gesture={kind,before:this.value,current:this.value,sent:false,...extra};try{this.onBegin?.();}catch{}this.element.classList.add('dragging');return true;
 }
 preview(value){
  const gesture=this.gesture;if(!gesture)return;gesture.current=ablSnap(value,this);this.paint(gesture.current);
  if(typeof this.onInput!=='function'||this.frame!==null)return;
  this.frame=this.raf(()=>{this.frame=null;const live=this.gesture;if(!live)return;try{if(this.onInput(live.current)!==false)live.sent=true;}catch{}});
 }
 finish({cancel=false}={}){
  const gesture=this.gesture;if(!gesture)return null;this.gesture=null;if(this.frame!==null){this.caf(this.frame);this.frame=null;}
  this.element.classList.remove('dragging');try{if(gesture.pointerId!=null&&this.element.hasPointerCapture?.(gesture.pointerId))this.element.releasePointerCapture(gesture.pointerId);}catch{}
  const changed=!cancel&&finite(gesture.current)&&Math.abs(gesture.current-gesture.before)>1e-9;
  if(changed){this.value=gesture.current;this.paint(this.value);try{this.onCommit?.({before:gesture.before,after:gesture.current});}catch{}}
  else{this.paint(this.value);if(gesture.sent)try{this.onCancel?.({before:gesture.before});}catch{}}
  return{changed,before:gesture.before,after:gesture.current};
 }
 cancel(){return this.finish({cancel:true});}
 pointerdown(event){
  if(event.button===2||event.ctrlKey&&event.button===0){event.preventDefault();event.stopPropagation();this.menu(event);return;}
  if(event.button!==0||event.isPrimary===false)return;event.preventDefault();event.stopPropagation();try{this.element.focus?.({preventScroll:true});}catch{}
  if(!this.begin('pointer',{pointerId:event.pointerId,startY:event.clientY,startValue:this.value,lastY:event.clientY,base:this.value,fine:!!event.shiftKey}))return;
  try{this.element.setPointerCapture?.(event.pointerId);}catch{}
 }
 pointermove(event){
  const gesture=this.gesture;if(gesture?.kind!=='pointer'||event.pointerId!==gesture.pointerId)return;event.preventDefault();
  // ⇧ toggles fine mode mid-drag without a jump: re-anchor at the current point.
  const fine=!!event.shiftKey;if(fine!==gesture.fine){gesture.base=gesture.current;gesture.startY=event.clientY;gesture.fine=fine;}
  const range=this.max-this.min,delta=(gesture.startY-event.clientY)/this.pixels*range/(fine?ABL_KNOB_FINE:1);
  this.preview(clamp(gesture.base+delta,this.min,this.max));
 }
 pointerup(event){const gesture=this.gesture;if(gesture?.kind!=='pointer'||event.pointerId!==gesture.pointerId)return;event.stopPropagation();this.finish();}
 reset(event){
  event?.preventDefault?.();event?.stopPropagation?.();if(this.gesture?.kind==='pointer')this.cancel();
  if(!finite(this.defaultValue)||!this.begin('reset'))return;this.gesture.current=ablSnap(this.defaultValue,this);this.finish();
 }
 keydown(event){
  const keys={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1,PageUp:10,PageDown:-10};if(!(event.key in keys)||event.metaKey||event.altKey||event.ctrlKey)return;
  event.preventDefault();event.stopPropagation();if(!this.gesture&&!this.begin('keyboard'))return;if(this.gesture.kind!=='keyboard')return;
  const unit=Number.isInteger(this.steps)&&this.steps>=2?(this.max-this.min)/(this.steps-1):(this.max-this.min)/(event.shiftKey?1000:100);
  this.preview(clamp(this.gesture.current+keys[event.key]*unit,this.min,this.max));
 }
 keyup(event){if(this.gesture?.kind==='keyboard'&&/^(Arrow|Page)/.test(event.key))this.finish();}
 destroy(){if(this.destroyed)return;this.cancel();this.destroyed=true;for(const [type,listener]of this.listeners)this.element.removeEventListener(type,listener);}
}
/** Live's square on/off switch for a two-step parameter. onCommit({before, after}) per click. */
export class AblSwitch{
 constructor(element,{value=null,min=0,max=1,label='',onCommit=null,onMenu=null,disabled=false}={}){
  Object.assign(this,{element,value,min,max,label,onCommit,onMenu});element.classList.add('abl-switch');element.type='button';element.textContent=label;
  this.click=event=>{event.stopPropagation();if(this.disabled||!finite(this.value))return;const before=this.value,after=this.on?this.min:this.max;this.set(after);try{this.onCommit?.({before,after});}catch{}};
  this.context=event=>{event.preventDefault();event.stopPropagation();try{this.onMenu?.(event);}catch{}};
  element.addEventListener('click',this.click);element.addEventListener('contextmenu',this.context);this.setDisabled(disabled);this.set(value);
 }
 get on(){return finite(this.value)&&this.value>(this.min+this.max)/2;}
 get active(){return false;}
 set(value){this.value=value;this.element.classList.toggle('on',this.on);this.element.setAttribute('aria-pressed',finite(value)?String(this.on):'mixed');}
 setDisabled(disabled){this.disabled=!!disabled;this.element.disabled=this.disabled;}
 cancel(){}
 destroy(){this.element.removeEventListener('click',this.click);this.element.removeEventListener('contextmenu',this.context);}
}
