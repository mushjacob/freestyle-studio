/** Coalesce pointer samples; moving a clip paints only a compositor transform. */
export class ClipGesturePainter{
 constructor({element,initial,origin,pixelsPerBeat,rowHeight,resize=false,resizeStart=false,slip=false,paintSlip=()=>{},restoreSlip=()=>{},onPaint=null,compute,isValid=()=>true,threshold=3,raf=callback=>globalThis.requestAnimationFrame(callback),caf=id=>globalThis.cancelAnimationFrame(id)}={}){
  Object.assign(this,{element,initial:{...initial},origin:{...origin},pixelsPerBeat,rowHeight,resize,resizeStart,slip,paintSlip,restoreSlip,onPaint:typeof onPaint==='function'?onPaint:null,compute,isValid,threshold,raf,caf});
  this.point={...origin};this.frame=null;this.moved=false;this.active=true;
  this.original={transform:element.style.transform,width:element.style.width,willChange:element.style.willChange};
  element.classList.add('clip-gesture-active');element.style.willChange=slip?'auto':resizeStart?'width, transform':resize?'width':'transform';
 }
 sample(event){
  if(!this.active||!Number.isFinite(event?.clientX)||!Number.isFinite(event?.clientY))return false;
  if(event.pointerId!=null&&this.origin.pointerId!=null&&event.pointerId!==this.origin.pointerId)return false;
  if(!this.moved&&Math.hypot(event.clientX-this.origin.clientX,event.clientY-this.origin.clientY)<this.threshold)return false;
  this.moved=true;this.point={clientX:event.clientX,clientY:event.clientY};return true;
 }
 move(event){if(!this.sample(event))return;if(this.frame===null)this.frame=this.raf(()=>this.paint());}
 resolve(){return this.moved?this.compute({deltaX:this.point.clientX-this.origin.clientX,deltaY:this.point.clientY-this.origin.clientY}):{...this.initial};}
 paint(){
  this.frame=null;if(!this.active)return;if(!this.isValid()){this.finish(undefined,{cancel:true});return;}
  const next=this.resolve(),style=this.element.style;
  if(this.slip){this.paintSlip(next);this.onPaint?.(next);return;}
  if(this.resize){const width=`${next.length*this.pixelsPerBeat}px`;if(style.width!==width)style.width=width;}
  else{const transform=`translate3d(${(next.start-this.initial.start)*this.pixelsPerBeat}px,${(next.track-this.initial.track)*this.rowHeight}px,0)`;if(style.transform!==transform)style.transform=transform;}
  if(this.resizeStart){const transform=`translate3d(${(next.start-this.initial.start)*this.pixelsPerBeat}px,0,0)`;if(style.transform!==transform)style.transform=transform;}
  // The previewed geometry (start/length/offset) for content that follows the gesture, e.g. a region waveform.
  this.onPaint?.(next);
 }
 finish(event,{cancel=false}={}){
  if(!this.active)return this.result;
  if(!cancel)this.sample(event);
  cancel=cancel||!this.isValid();const state=cancel?{...this.initial}:this.resolve();
  if(this.frame!==null)this.caf(this.frame);this.frame=null;this.active=false;try{this.onPaint?.(null);}catch{}
  for(const [key,value]of Object.entries(this.original))if(this.element.style[key]!==value)this.element.style[key]=value;
  if(this.slip)this.restoreSlip();
  this.element.classList.remove('clip-gesture-active');
  this.result={state,cancelled:cancel,changed:!cancel&&(this.slip?(state.offset!==this.initial.offset||state.cloudRaw!==this.initial.cloudRaw):['start','length','track'].some(key=>state[key]!==this.initial[key]))};return this.result;
 }
}
