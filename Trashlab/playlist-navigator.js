import {PLAYLIST_GUTTER} from './playlist-geometry.js';
/** FL-style playlist overview. All horizontal values are CSS px or bars; DTO times are beats.
 * setView must synchronously apply scale/layout before assigning scrollLeft.
 * Call refresh() after clip/selection changes. destroy() releases every listener/capture/frame.
 */
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const SVG='http://www.w3.org/2000/svg';
export function navigatorGeometry({scrollWidth,clientWidth,scale,scrollLeft=0,gutter=PLAYLIST_GUTTER,width}){
 const visible=Math.max(1,clientWidth-gutter),domain=Math.max(visible,scrollWidth-gutter)/scale;
 const span=Math.min(domain,visible/scale),left=clamp(scrollLeft/scale,0,Math.max(0,domain-span));
 return {visible,domain,span,left,right:left+span,x:left/domain*width,handleWidth:span/domain*width,width,scale};
}
export function navigatorDragView(snapshot,kind,dx,{minScale=4,maxScale=896}={}){
 const {domain,visible,width,left,right,scale}=snapshot;
 const delta=dx/Math.max(1,width)*domain,minSpan=visible/maxScale,maxSpan=Math.min(domain,visible/minScale);
 if(kind==='left'){
  const next=clamp(left+delta,Math.max(0,right-maxSpan),right-minSpan),nextScale=clamp(visible/(right-next),minScale,maxScale);
  return {scale:nextScale,scrollLeft:Math.max(0,right*nextScale-visible)};
 }
 if(kind==='right'){
  const next=clamp(right+delta,left+minSpan,Math.min(domain,left+maxSpan)),nextScale=clamp(visible/(next-left),minScale,maxScale);
  return {scale:nextScale,scrollLeft:Math.max(0,left*nextScale)};
 }
 return {scale,scrollLeft:clamp(left+delta,0,Math.max(0,domain-snapshot.span))*scale};
}
export class PlaylistNavigator {
 constructor({element,viewport,getScale,setView,getClips=()=>[],getSelected=()=>null,canNavigate=()=>true,gutter=PLAYLIST_GUTTER,minScale=4,maxScale=896,beatsPerBar=4,raf=fn=>globalThis.requestAnimationFrame(fn),caf=id=>globalThis.cancelAnimationFrame(id),ResizeObserver:Observer=globalThis.ResizeObserver}={}){
  if(!element||!viewport||typeof getScale!=='function'||typeof setView!=='function')throw new TypeError('PlaylistNavigator requires element, viewport, getScale and setView');
  Object.assign(this,{element,viewport,getScale,setView,getClips,getSelected,canNavigate,gutter,minScale,maxScale,beatsPerBar,raf,caf});
  this.frame=null;this.pending=null;this.gesture=null;this.destroyed=false;this.listeners=[];
  const d=element.ownerDocument;this.document=d;this.window=d.defaultView;
  element.classList.add('playlist-navigator');element.setAttribute('aria-label','Playlist horizontal zoom and scroll');
  this.previous=d.createElement('button');this.previous.type='button';this.previous.className='playlist-navigator-arrow';this.previous.textContent='‹';this.previous.setAttribute('aria-label','Scroll playlist left');
  this.next=this.previous.cloneNode(true);this.next.textContent='›';this.next.setAttribute('aria-label','Scroll playlist right');
  this.track=d.createElement('div');this.track.className='playlist-navigator-track';
  this.handle=d.createElement('div');this.handle.className='playlist-navigator-handle';this.handle.tabIndex=0;this.handle.setAttribute('role','scrollbar');this.handle.setAttribute('aria-orientation','horizontal');this.handle.setAttribute('aria-label','Playlist overview; arrow keys scroll, plus and minus zoom');
  this.preview=d.createElementNS(SVG,'svg');this.preview.classList.add('playlist-navigator-preview');this.preview.setAttribute('aria-hidden','true');this.preview.setAttribute('preserveAspectRatio','none');
  this.leftGrip=d.createElement('div');this.leftGrip.className='playlist-navigator-grip left';this.leftGrip.dataset.edge='left';this.leftGrip.title='Drag to zoom; keep right edge fixed';
  this.rightGrip=this.leftGrip.cloneNode(true);this.rightGrip.className='playlist-navigator-grip right';this.rightGrip.dataset.edge='right';this.rightGrip.title='Drag to zoom; keep left edge fixed';
  this.handle.append(this.preview,this.leftGrip,this.rightGrip);this.track.append(this.handle);element.append(this.previous,this.track,this.next);
  this.listen(this.previous,'click',e=>this.step(-1,e.shiftKey));this.listen(this.next,'click',e=>this.step(1,e.shiftKey));
  this.listen(this.track,'pointerdown',e=>this.pointerDown(e));
  this.listen(this.track,'contextmenu',e=>e.preventDefault());
  this.listen(this.handle,'keydown',e=>this.keyDown(e));
  this.listen(element,'wheel',e=>this.wheel(e),{passive:false});
  this.listen(viewport,'scroll',()=>this.refresh());
  this.listen(this.window,'resize',()=>this.refresh());
  this.listen(this.window,'blur',()=>this.cancelGesture());
  this.observer=Observer?new Observer(()=>this.refresh()):null;this.observer?.observe(element);this.observer?.observe(viewport);
  this.refresh();
 }
 listen(target,type,fn,options){target.addEventListener(type,fn,options);this.listeners.push(()=>target.removeEventListener(type,fn,options));}
 geometry(){return navigatorGeometry({scrollWidth:this.viewport.scrollWidth,clientWidth:this.viewport.clientWidth,scale:Math.max(.0001,finite(this.getScale(),30)),scrollLeft:this.viewport.scrollLeft,gutter:this.gutter,width:Math.max(1,this.track.getBoundingClientRect().width||this.track.clientWidth)});}
 refresh(){if(this.destroyed)return;const g=this.geometry();if(this.gesture){g.domain=this.gesture.snapshot.domain;g.left=this.viewport.scrollLeft/g.scale;g.span=g.visible/g.scale;g.right=g.left+g.span;g.x=g.left/g.domain*g.width;g.handleWidth=g.span/g.domain*g.width;}this.render(g);}
 render(g){
  this.lastGeometry=g;this.handle.style.left=`${g.x}px`;this.handle.style.width=`${Math.max(0,g.handleWidth)}px`;
  this.handle.setAttribute('aria-valuemin','0');this.handle.setAttribute('aria-valuemax',String(Math.max(0,g.domain-g.span)));this.handle.setAttribute('aria-valuenow',String(g.left));this.handle.setAttribute('aria-valuetext',`Bar ${(g.left+1).toFixed(1)}, ${g.scale.toFixed(1)} pixels per bar`);
  this.previous.disabled=g.left<=1e-7;this.next.disabled=g.right>=g.domain-1e-7;
  const selected=this.getSelected(),isSelected=id=>selected instanceof Set?selected.has(id):Array.isArray(selected)?selected.includes(id):selected?.id===id||selected===id;
  const clips=this.getClips().map(c=>({id:c.id,start:finite(c.start)/this.beatsPerBar,length:Math.max(0,finite(c.length))/this.beatsPerBar,row:Math.max(0,Math.floor(finite(c.track??c.row))),color:c.color})).filter(c=>c.length>0);
  const rows=Math.max(1,...clips.map(c=>c.row+1));this.preview.setAttribute('viewBox',`${g.left} 0 ${Math.max(.0001,g.span)} ${rows}`);
  const fragment=this.document.createDocumentFragment();
  for(const c of clips){if(c.start+c.length<g.left||c.start>g.right)continue;const rect=this.document.createElementNS(SVG,'rect');rect.setAttribute('x',String(c.start));rect.setAttribute('y',String(c.row+.12));rect.setAttribute('width',String(c.length));rect.setAttribute('height','.76');rect.setAttribute('fill',isSelected(c.id)?'#ef7779':/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(c.color||'')?c.color:'#aec4c5');rect.dataset.navigatorClip=String(c.id??'');if(isSelected(c.id))rect.classList.add('selected');fragment.append(rect);}
  this.preview.replaceChildren(fragment);
 }
 queue(action){this.pending=action;if(this.frame==null)this.frame=this.raf(()=>{this.frame=null;const next=this.pending;this.pending=null;next?.();});}
 flush(){if(this.frame!=null){this.caf(this.frame);this.frame=null;}const next=this.pending;this.pending=null;next?.();}
 commit(view){if(this.destroyed||!this.canNavigate())return;this.setView(view);this.refresh();}
 step(direction,page=false){this.flush();const g=this.geometry(),distance=page?g.visible*.9:g.scale;this.commit({scale:g.scale,scrollLeft:clamp(this.viewport.scrollLeft+direction*distance,0,Math.max(0,this.viewport.scrollWidth-this.viewport.clientWidth))});}
 pointerDown(e){
  if(this.destroyed||this.gesture||!this.canNavigate()||![0,2].includes(e.button))return;e.preventDefault();this.flush();
  const snapshot=this.geometry(),right=e.button===2,inside=this.handle.contains(e.target),edge=e.target.closest?.('[data-edge]')?.dataset.edge;
  if(!inside&&!right){this.step(e.clientX<this.track.getBoundingClientRect().left+snapshot.x?-1:1,true);this.handle.focus({preventScroll:true});return;}
  this.handle.focus({preventScroll:true});this.gesture={pointerId:e.pointerId,x:e.clientX,y:e.clientY,top:this.viewport.scrollTop,snapshot,kind:right?'both':edge||'pan'};
  this.element.classList.add('dragging');try{this.track.setPointerCapture(e.pointerId);}catch{}
  this.move=e=>{if(e.pointerId!==this.gesture?.pointerId)return;e.preventDefault();const sample={x:e.clientX,y:e.clientY};this.queue(()=>this.applySample(sample));};
  this.up=e=>{if(e.pointerId!==this.gesture?.pointerId)return;e.preventDefault();this.pending=null;if(this.frame!=null){this.caf(this.frame);this.frame=null;}this.applySample({x:e.clientX,y:e.clientY});this.endGesture();};
  this.cancel=e=>{if(e.pointerId===this.gesture?.pointerId)this.cancelGesture();};
  this.document.addEventListener('pointermove',this.move);this.document.addEventListener('pointerup',this.up);this.document.addEventListener('pointercancel',this.cancel);this.track.addEventListener('lostpointercapture',this.cancel);
 }
 applySample({x,y}){const g=this.gesture;if(!g)return;if(!this.canNavigate()){this.cancelGesture();return;}const view=navigatorDragView(g.snapshot,g.kind,x-g.x,{minScale:this.minScale,maxScale:this.maxScale});this.commit(view);if(g.kind==='both')this.viewport.scrollTop=clamp(g.top+y-g.y,0,Math.max(0,this.viewport.scrollHeight-this.viewport.clientHeight));}
 endGesture(){const g=this.gesture;if(!g)return;this.gesture=null;this.document.removeEventListener('pointermove',this.move);this.document.removeEventListener('pointerup',this.up);this.document.removeEventListener('pointercancel',this.cancel);this.track.removeEventListener('lostpointercapture',this.cancel);try{if(this.track.hasPointerCapture?.(g.pointerId))this.track.releasePointerCapture(g.pointerId);}catch{}this.element.classList.remove('dragging');this.refresh();}
 cancelGesture(){if(!this.gesture)return;if(this.frame!=null)this.caf(this.frame);this.frame=null;this.pending=null;this.endGesture();}
 zoom(factor,cursorFraction=.5){
  if(this.destroyed||!this.canNavigate())return;
  const base=this.pendingView??{scale:this.getScale(),scrollLeft:this.viewport.scrollLeft},visible=Math.max(1,this.viewport.clientWidth-this.gutter),scale=clamp(base.scale*factor,this.minScale,this.maxScale),anchor=clamp(cursorFraction,0,1)*visible;
  this.pendingView={scale,scrollLeft:Math.max(0,(base.scrollLeft+anchor)/base.scale*scale-anchor)};
  this.queue(()=>{const view=this.pendingView;this.pendingView=null;if(view)this.commit(view);});
 }
 wheel(e){if(!e.ctrlKey&&!e.metaKey&&!e.altKey)return;e.preventDefault();if(this.gesture)return;const unit=e.deltaMode===1?16:e.deltaMode===2?this.viewport.clientHeight:1,rect=this.track.getBoundingClientRect(),g=this.geometry(),fraction=(e.clientX-rect.left-g.x)/Math.max(1,g.handleWidth);this.zoom(Math.exp(-e.deltaY*unit*.004),fraction);}
 keyDown(e){if(this.gesture){if(e.key==='Escape'){e.preventDefault();this.cancelGesture();}return;}if(!this.canNavigate())return;const action={ArrowLeft:()=>this.step(-1,e.shiftKey),ArrowRight:()=>this.step(1,e.shiftKey),PageUp:()=>this.step(-1,true),PageDown:()=>this.step(1,true),Home:()=>{this.flush();this.commit({scale:this.getScale(),scrollLeft:0});},End:()=>{this.flush();this.commit({scale:this.getScale(),scrollLeft:Math.max(0,this.viewport.scrollWidth-this.viewport.clientWidth)});},'+':()=>this.zoom(1.25),'=':()=>this.zoom(1.25),'-':()=>this.zoom(.8),Escape:()=>this.cancelGesture()}[e.key];if(action){e.preventDefault();action();}}
 destroy(){if(this.destroyed)return;this.cancelGesture();if(this.frame!=null)this.caf(this.frame);this.pending=null;this.pendingView=null;this.frame=null;this.listeners.splice(0).forEach(remove=>remove());this.observer?.disconnect();this.element.replaceChildren();this.element.classList.remove('playlist-navigator','dragging');this.element.removeAttribute('aria-label');this.destroyed=true;}
}
