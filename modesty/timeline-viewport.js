/** Native two-axis scrolling plus frame-coalesced, cursor-anchored DAW zoom. */
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export function zoomAnchor({scale,nextScale,scrollLeft,cursor,gutter=0}){const x=Math.max(gutter,cursor),beat=(scrollLeft+x-gutter)/scale;return Math.max(0,beat*nextScale+gutter-x);}
export function wheelPixels(event,pageHeight=700){const unit=event.deltaMode===1?16:event.deltaMode===2?pageHeight:1;return{x:event.deltaX*unit,y:event.deltaY*unit};}
export class TimelineViewport{
 constructor({element,getScale,setScale,gutter=0,min=28,max=896,raf=callback=>globalThis.requestAnimationFrame(callback),caf=id=>globalThis.cancelAnimationFrame(id),onZoom=()=>{},canZoom=()=>true}={}){
  Object.assign(this,{element,getScale,setScale,gutter,min,max,raf,caf,onZoom,canZoom});this.frame=null;this.pending=null;this.frames=0;
  this.wheel=e=>{const d=wheelPixels(e,element.clientHeight);if(e.ctrlKey||e.metaKey||e.altKey){e.preventDefault();if(!this.canZoom())return;const rect=element.getBoundingClientRect();this.zoomBy(Math.exp(-d.y*.004),e.clientX-rect.left);return;}if(e.shiftKey){e.preventDefault();element.scrollLeft+=Math.abs(d.x)>Math.abs(d.y)?d.x:d.y;}};
  element.addEventListener('wheel',this.wheel,{passive:false});
  // Middle-drag pans both dimensions without creating playlist clips.
  this.down=e=>{if(e.button!==1)return;e.preventDefault();const x=e.clientX,y=e.clientY,left=element.scrollLeft,top=element.scrollTop;element.setPointerCapture(e.pointerId);this.pan={pointerId:e.pointerId};element.classList.add('viewport-panning');this.move=ev=>{if(ev.pointerId!==e.pointerId)return;element.scrollLeft=left+x-ev.clientX;element.scrollTop=top+y-ev.clientY;};this.up=ev=>{if(ev.pointerId!==e.pointerId)return;this.pan=null;element.classList.remove('viewport-panning');element.removeEventListener('pointermove',this.move);element.removeEventListener('pointerup',this.up);element.removeEventListener('pointercancel',this.up);};element.addEventListener('pointermove',this.move);element.addEventListener('pointerup',this.up);element.addEventListener('pointercancel',this.up);};element.addEventListener('pointerdown',this.down);
 }
 zoomBy(factor,cursor=this.element.clientWidth/2){const base=this.pending?.scale??this.getScale();this.zoomTo(base*factor,cursor);}
 zoomTo(value,cursor=this.element.clientWidth/2){const old=this.getScale(),scale=clamp(value,this.min,this.max);if(!this.pending)this.pending={old,scrollLeft:this.element.scrollLeft,cursor,scale};else{this.pending.scale=scale;this.pending.cursor=cursor;}if(this.frame==null)this.frame=this.raf(()=>this.apply());}
 apply(){const p=this.pending;this.frame=null;this.pending=null;if(!p)return;this.frames++;const left=zoomAnchor({scale:p.old,nextScale:p.scale,scrollLeft:p.scrollLeft,cursor:p.cursor,gutter:this.gutter});this.setScale(p.scale);this.element.scrollLeft=left;this.onZoom(p.scale);}
 destroy(){if(this.frame!=null)this.caf(this.frame);this.element.removeEventListener('wheel',this.wheel);this.element.removeEventListener('pointerdown',this.down);if(this.move)this.element.removeEventListener('pointermove',this.move);if(this.up){this.element.removeEventListener('pointerup',this.up);this.element.removeEventListener('pointercancel',this.up);}}
}
