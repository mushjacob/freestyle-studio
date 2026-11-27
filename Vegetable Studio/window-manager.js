/** Frame-coalesced workspace dragging. Pointer moves only change a compositor transform.
 *  FL behaviour: edge/corner resizing, magnetic snapping to neighbours/desktop, Tab cycling, remembered frames. */
import {snapMove,resizeRect,resizeZone,resizeCursor} from './window-snap.js';
const FRAME_STORAGE_KEY='vegetable:window-frames:v1';
export const LAYOUT_STORAGE_KEY='vegetable:window-layouts';
const plainObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
/** Saved window layouts: `{name: {windowId: {left,top,width,height}}}`. Storage is injected. */
export function readWindowLayouts(storage=globalThis.localStorage){try{const parsed=JSON.parse(storage?.getItem(LAYOUT_STORAGE_KEY)||'{}');if(!plainObject(parsed))return {};const out={};for(const [name,frames] of Object.entries(parsed))if(plainObject(frames))out[name]=frames;return out;}catch{return {};}}
export function saveWindowLayout(name,frames,storage=globalThis.localStorage){const key=String(name??'').trim();if(!key||!plainObject(frames))return null;const layouts=readWindowLayouts(storage);layouts[key]=JSON.parse(JSON.stringify(frames));try{storage?.setItem(LAYOUT_STORAGE_KEY,JSON.stringify(layouts));}catch{}return layouts;}
export function deleteWindowLayout(name,storage=globalThis.localStorage){const layouts=readWindowLayouts(storage);if(!Object.hasOwn(layouts,name))return layouts;delete layouts[name];try{storage?.setItem(LAYOUT_STORAGE_KEY,JSON.stringify(layouts));}catch{}return layouts;}
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export function boundWindowPosition({left,top,width,height,boundsWidth,boundsHeight,visible=80,header=28}){
 return {left:clamp(left,Math.min(0,visible-width),Math.max(0,boundsWidth-visible)),top:clamp(top,0,Math.max(0,boundsHeight-header))};
}
export class WindowManager{
 constructor({bounds,raf=callback=>globalThis.requestAnimationFrame(callback),caf=id=>globalThis.cancelAnimationFrame(id),onDragState=()=>{},onActivate=null,storage=undefined}={}){this.onActivate=onActivate;this.storage=storage;this.resizing=null;this.bounds=bounds;this.raf=raf;this.caf=caf;this.onDragState=onDragState;this.registrations=new Map();this.focusOrder=[];this.front=20;this.active=null;this.pending=null;this.frames=0;this.moves=0;this.starts=0;this.lastWindow='';this.blur=()=>this.finish();globalThis.addEventListener?.('blur',this.blur);}
 get dragging(){return !!this.active||!!this.resizing;}
 /** FL Tab / Shift+Tab: bring the next (previous) open window to the front. Stable
  *  registration order, starting after the current front window, so repeated presses visit every window. */
 cycle(direction=1){
  const list=[...this.registrations.keys()].filter(window=>this.visible(window));if(!list.length)return null;
  const current=this.frontWindow,index=list.indexOf(current),step=direction<0?-1:1;
  const target=list[index<0?(step>0?0:list.length-1):(index+step+list.length)%list.length];
  if(list.length===1&&target===current)return target;
  if(typeof this.onActivate==='function')this.onActivate(target);else this.raise(target);
  try{if(!target.hasAttribute?.('tabindex'))target.tabIndex=-1;target.focus?.({preventScroll:true});}catch{}
  return target;
 }
 frameStore(){try{return this.storage===undefined?globalThis.localStorage:this.storage;}catch{return null;}}
 savedFrames(){try{const parsed=JSON.parse(this.frameStore()?.getItem(FRAME_STORAGE_KEY)||'{}');return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};}catch{return {};}}
 saveFrame(window){
  if(!window?.id||window.tagName==='DIALOG'||window.classList.contains('expanded'))return;
  const left=Number.parseFloat(window.style.left),top=Number.parseFloat(window.style.top),width=Number.parseFloat(window.style.width),height=Number.parseFloat(window.style.height);
  if(![left,top,width,height].every(Number.isFinite))return;
  try{const frames=this.savedFrames();frames[window.id]={left,top,width,height};this.frameStore()?.setItem(FRAME_STORAGE_KEY,JSON.stringify(frames));}catch{}
 }
 /** Restore remembered frames (positions and sizes) for the given window ids. */
 restoreFrames(ids){
  const frames=this.savedFrames(),area=this.bounds?.getBoundingClientRect?.()||{width:0,height:0};
  for(const [window]of this.registrations){
   const frame=frames[window.id];if(!ids.includes(window.id)||window.tagName==='DIALOG'||!frame||![frame.left,frame.top,frame.width,frame.height].every(Number.isFinite)||frame.width<80||frame.height<60)continue;
   const min=this.minSize(window),width=Math.max(min.width,area.width>0?Math.min(frame.width,area.width):frame.width),height=Math.max(min.height,area.height>0?Math.min(frame.height,area.height):frame.height);
   const position=area.width>0?boundWindowPosition({left:frame.left,top:frame.top,width,height,boundsWidth:area.width,boundsHeight:area.height}):{left:frame.left,top:frame.top};
   this.applyFrame(window,{left:position.left,top:position.top,width,height});
  }
 }
 /** Frames of every registered, non-dialog, non-maximized window, in layout px (offset metrics ignore CSS zoom). Saved frames fill gaps. */
 currentFrames(){
  const frames={...this.savedFrames()};
  for(const [window] of this.registrations){
   if(!window.id||window.tagName==='DIALOG'||window.classList.contains('expanded'))continue;
   const s=window.style,inline=[s.left,s.top,s.width,s.height].map(Number.parseFloat);
   const box=inline.every(Number.isFinite)?inline:[window.offsetLeft,window.offsetTop,window.offsetWidth,window.offsetHeight];
   if(box.every(Number.isFinite)&&box[2]>=80&&box[3]>=60)frames[window.id]={left:box[0],top:box[1],width:box[2],height:box[3]};
  }
  return frames;
 }
 /** Apply a saved layout through the same restore path as remembered frames, and remember it as the current frames. */
 applyLayout(frames){
  if(!plainObject(frames))return [];
  try{this.frameStore()?.setItem(FRAME_STORAGE_KEY,JSON.stringify({...this.savedFrames(),...frames}));}catch{}
  const ids=[...this.registrations.keys()].map(window=>window.id).filter(id=>id&&plainObject(frames[id]));
  for(const [window] of this.registrations)if(ids.includes(window.id))window.classList.remove('expanded');
  this.restoreFrames(ids);return ids;
 }
 applyFrame(window,{left,top,width,height}){const s=window.style;s.position='absolute';s.margin='0';s.right='auto';s.bottom='auto';s.maxWidth='none';s.maxHeight='none';s.left=`${left}px`;s.top=`${top}px`;s.width=`${width}px`;s.height=`${height}px`;}
 minSize(window){let style=null;try{style=globalThis.getComputedStyle?.(window);}catch{}const w=Number.parseFloat(style?.minWidth),h=Number.parseFloat(style?.minHeight);return {width:Number.isFinite(w)&&w>0?w:160,height:Number.isFinite(h)&&h>0?h:100};}
 /** Frames (relative to the desktop) of every other open, non-maximized workspace window: snap targets. */
 snapOthers(window,area){
  const others=[];
  for(const [other,r]of this.registrations){
   if(other===window||other.tagName==='DIALOG'||!this.visible(other)||other.classList.contains('expanded'))continue;
   const rect=other.getBoundingClientRect?.();if(!rect)continue;
   others.push({left:rect.left-area.left,top:rect.top-area.top,width:rect.width,height:rect.height});
  }
  return others;
 }
 /** Pointer-down on a window border/corner starts an FL-style resize. Returns true when it did. */
 beginResize(window,e){
  if(!e||e.button!==0||window.tagName==='DIALOG'||window.classList.contains('expanded')||this.active||this.resizing)return false;
  const rect=window.getBoundingClientRect?.();if(!rect)return false;
  const zone=resizeZone(e.clientX-rect.left,e.clientY-rect.top,rect.width,rect.height);if(!zone)return false;
  if(this.pending)this.finish();
  const area=this.bounds.getBoundingClientRect(),start={left:rect.left-area.left,top:rect.top-area.top,width:rect.width,height:rect.height};
  this.resizing={window,zone,pointerId:e.pointerId,x:e.clientX,y:e.clientY,start,area,min:this.minSize(window),others:this.snapOthers(window,area),rect:start,frame:null,touchAction:window.style.touchAction};
  if(window.dataset?.wmEdge){window.classList.remove(`wm-hover-${window.dataset.wmEdge}`);delete window.dataset.wmEdge;}
  this.applyFrame(window,start);window.style.transform='';window.style.touchAction='none';window.classList.add('window-resizing',`wm-hover-${zone}`);
  e.preventDefault?.();e.stopPropagation?.();
  try{window.setPointerCapture?.(e.pointerId);}catch{}
  this.onDragState(true,window);return true;
 }
 moveResize(e){
  const r=this.resizing;if(!r||e.pointerId!==r.pointerId||!Number.isFinite(e.clientX)||!Number.isFinite(e.clientY))return false;
  e.preventDefault?.();e.stopPropagation?.();
  const {start,area,zone}=r,right=start.left+start.width,bottom=start.top+start.height;let dx=e.clientX-r.x,dy=e.clientY-r.y;
  // Never push a dragged edge outside the desktop (an edge already outside may only move back in).
  if(zone.includes('w'))dx=Math.max(dx,Math.min(0,-start.left));if(zone.includes('e'))dx=Math.min(dx,Math.max(0,area.width-right));
  if(zone.includes('n'))dy=Math.max(dy,Math.min(0,-start.top));if(zone.includes('s'))dy=Math.min(dy,Math.max(0,area.height-bottom));
  r.rect=resizeRect(start,{zone,dx,dy,min:r.min,bounds:{width:area.width,height:area.height},others:r.others,snap:!e.altKey});
  if(r.frame==null)r.frame=this.raf(()=>this.paintResize());return true;
 }
 paintResize(){const r=this.resizing;if(!r)return;r.frame=null;this.frames++;this.applyFrame(r.window,r.rect);}
 finishResize(){
  const r=this.resizing;if(!r)return;if(r.frame!=null)this.caf(r.frame);this.resizing=null;
  this.applyFrame(r.window,r.rect);r.window.classList.remove('window-resizing',`wm-hover-${r.zone}`);if(r.window.dataset)delete r.window.dataset.wmEdge;r.window.style.touchAction=r.touchAction??'';
  try{if(r.window.hasPointerCapture?.(r.pointerId))r.window.releasePointerCapture(r.pointerId);}catch{}
  this.saveFrame(r.window);this.onDragState(false,r.window);
  try{globalThis.dispatchEvent?.(new Event('resize'));}catch{}
 }
 hoverEdge(window,e){
  if(e&&(this.active||this.resizing||this.pending||e.buttons))return;
  let zone='';if(e&&window.tagName!=='DIALOG'&&!window.classList.contains('expanded')){const rect=window.getBoundingClientRect?.();if(rect)zone=resizeZone(e.clientX-rect.left,e.clientY-rect.top,rect.width,rect.height);}
  const current=window.dataset?.wmEdge||'';if(zone===current)return;
  if(current)window.classList.remove(`wm-hover-${current}`);if(zone)window.classList.add(`wm-hover-${zone}`);
  if(window.dataset){if(zone)window.dataset.wmEdge=zone;else delete window.dataset.wmEdge;}
 }
 get focusedWindow(){return [...this.focusOrder].reverse().find(window=>window.isConnected!==false&&!window.classList.contains('hidden'))||null;}
 /** Effective stacking order for a visible registered workspace window (or open
  * modeless dialog). Inline z-index wins; otherwise the computed CSS z-index. */
 stackLevel(window){const inline=Number.parseInt(window?.style?.zIndex,10);if(Number.isFinite(inline))return inline;let computed;try{computed=Number.parseInt(globalThis.getComputedStyle?.(window)?.zIndex,10);}catch{}return Number.isFinite(computed)?computed:0;}
 visible(window){return !!window&&window.isConnected!==false&&!window.classList.contains('hidden')&&(window.tagName!=='DIALOG'||window.open===true&&window.hasAttribute?.('data-modeless'));}
 /** The visually front-most window: highest stack level, ties broken by the
  * most recent activation. Modal dialogs never count; modeless ones do. */
 get frontWindow(){let best=null,bestLevel=-Infinity,bestOrder=-1;for(const [window]of this.registrations){if(!this.visible(window))continue;const level=this.stackLevel(window),order=this.focusOrder.indexOf(window);if(level>bestLevel||level===bestLevel&&order>bestOrder){best=window;bestLevel=level;bestOrder=order;}}return best;}
 isFront(window){return this.visible(window)&&this.frontWindow===window;}
 /** FL F5/F6/F7/F9 and toolbar window buttons: a hidden window opens, an open
  * window behind another comes to the front, and only the front window closes.
  * Pure decision: 'show' | 'raise' | 'hide'. */
 toggleAction(window){return !this.visible(window)?'show':this.isFront(window)?'hide':'raise';}
 raise(window){window.style.zIndex=String(++this.front);if(this.registrations.has(window)&&window.tagName!=='DIALOG'){this.focusOrder=this.focusOrder.filter(entry=>entry!==window);this.focusOrder.push(window);}return this.front;}
 register(window,{handle=window.querySelector('.drag-handle,header,.panel-heading'),fixed=window.tagName==='DIALOG'}={}){
  if(!handle||this.registrations.has(window))return;
  const target=window.ownerDocument||handle;const activate=event=>{if(!fixed||window.hasAttribute?.('data-modeless'))this.raise(window);if(!fixed&&event?.type==='pointerdown'&&target.activeElement?.closest?.('dialog[data-modeless]')&&!event.target?.closest?.('button,input,select,textarea,a,[contenteditable]')){if(!window.hasAttribute?.('tabindex'))window.tabIndex=-1;window.focus?.({preventScroll:true});}};
  const down=e=>{if(e.button!==0||e.target.closest('button,input,select,textarea,a,summary,[data-no-drag]'))return;if(this.active||this.pending)this.finish();
   // A title click must preserve its frame (including maximized state), and
   // must remain a click so a later title dblclick can toggle maximization.
   this.pending={window,handle,fixed,pointerId:e.pointerId,x:e.clientX,y:e.clientY};activate();
  };
  const move=e=>{if(this.resizing?.window===window){this.moveResize(e);return;}let a=this.active||this.pending;if(!a||a.window!==window||a.pointerId!==e.pointerId||!Number.isFinite(e.clientX)||!Number.isFinite(e.clientY))return;
   if(!this.active){
    if(Math.hypot(e.clientX-a.x,e.clientY-a.y)<=3)return;
    const rect=window.getBoundingClientRect(),bounds=fixed?{left:0,top:0,width:globalThis.innerWidth,height:globalThis.innerHeight}:this.bounds.getBoundingClientRect(),left=rect.left-bounds.left,top=rect.top-bounds.top;
    a=this.active={...a,others:fixed?[]:this.snapOthers(window,bounds),autoHeight:fixed&&!window.style.height,left,top,width:rect.width,height:rect.height,bounds,position:{left,top},frame:null,moved:false,touchAction:handle.style.touchAction};this.pending=null;this.starts++;this.lastWindow=window.id||window.tagName;
    window.classList.remove('expanded');window.style.position=fixed?'fixed':'absolute';window.style.margin='0';window.style.right='auto';window.style.bottom='auto';window.style.left=`${left}px`;window.style.top=`${top}px`;window.style.width=`${rect.width}px`;window.style.height=`${rect.height}px`;window.style.willChange='transform';window.classList.add('window-dragging');handle.style.touchAction='none';
    handle.setPointerCapture(e.pointerId);this.onDragState(true,window);
   }
   e.preventDefault();e.stopPropagation();this.moves++;a.position=boundWindowPosition({left:a.left+e.clientX-a.x,top:a.top+e.clientY-a.y,width:a.width,height:a.height,boundsWidth:a.bounds.width,boundsHeight:a.bounds.height});if(!fixed&&!e.altKey&&a.others){const snapped=snapMove({left:a.position.left,top:a.position.top,width:a.width,height:a.height},{bounds:{width:a.bounds.width,height:a.bounds.height},others:a.others});a.position=boundWindowPosition({left:snapped.left,top:snapped.top,width:a.width,height:a.height,boundsWidth:a.bounds.width,boundsHeight:a.bounds.height});}a.moved=true;if(a.frame==null)a.frame=this.raf(()=>this.paint());
  };
  const up=e=>{const r=this.resizing;if(r?.window===window&&(e.pointerId==null||e.pointerId===r.pointerId)){if(e.type!=='pointercancel')this.moveResize(e);this.finishResize();return;}const a=this.active||this.pending;if(a?.window===window&&(e.pointerId==null||e.pointerId===a.pointerId)){if(e.type!=='pointercancel'&&Number.isFinite(e.clientX)&&Number.isFinite(e.clientY))move(e);this.finish();}};
  const pointerActivate=event=>{if(!fixed&&event?.type==='pointerdown'&&this.beginResize(window,event)){activate(event);return;}activate(event);};
  const hover=event=>this.hoverEdge(window,event),leave=()=>this.hoverEdge(window,null);
  window.addEventListener('pointerdown',pointerActivate,true);window.addEventListener('focusin',activate,true);handle.addEventListener('pointerdown',down);target.addEventListener('pointermove',move,true);target.addEventListener('pointerup',up,true);target.addEventListener('pointercancel',up,true);
  if(!fixed){window.addEventListener('pointermove',hover);window.addEventListener('pointerleave',leave);}
  this.registrations.set(window,{handle,target,activate:pointerActivate,focusActivate:activate,down,move,up,hover,leave});if(!fixed)this.focusOrder.push(window);
 }
 paint(){const a=this.active;if(!a)return;a.frame=null;this.frames++;a.window.style.transform=`translate3d(${a.position.left-a.left}px,${a.position.top-a.top}px,0)`;}
 finish(){this.finishResize();const a=this.active;this.pending=null;if(!a)return;if(a.frame!=null)this.caf(a.frame);this.active=null;a.window.style.left=`${a.position.left}px`;a.window.style.top=`${a.position.top}px`;a.window.style.transform='';a.window.style.willChange='';if(a.autoHeight)a.window.style.height='';a.window.classList.remove('window-dragging');if(a.moved&&!a.fixed)this.saveFrame(a.window);a.handle.style.touchAction=a.touchAction??'';try{if(a.handle.hasPointerCapture?.(a.pointerId))a.handle.releasePointerCapture(a.pointerId);}catch{}this.onDragState(false,a.window);}
 unregister(window){const r=this.registrations.get(window);if(!r)return;if(this.active?.window===window||this.pending?.window===window)this.finish();window.removeEventListener('pointerdown',r.activate,true);window.removeEventListener('focusin',r.focusActivate,true);r.hover&&window.removeEventListener('pointermove',r.hover);r.leave&&window.removeEventListener('pointerleave',r.leave);r.handle.removeEventListener('pointerdown',r.down);r.target.removeEventListener('pointermove',r.move,true);for(const event of ['pointerup','pointercancel'])r.target.removeEventListener(event,r.up,true);this.registrations.delete(window);this.focusOrder=this.focusOrder.filter(entry=>entry!==window);}
 watchDialogs(root=document.body){const scan=node=>{if(node.nodeType!==1)return;if(node.matches?.('dialog'))this.register(node);node.querySelectorAll?.('dialog').forEach(dialog=>this.register(dialog));};scan(root);this.observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)scan(node);for(const [window]of this.registrations)if(window.tagName==='DIALOG'&&!window.isConnected)this.unregister(window);});this.observer.observe(root,{childList:true,subtree:true});}
 destroy(){this.finish();globalThis.removeEventListener?.('blur',this.blur);this.observer?.disconnect();for(const [window,r]of this.registrations){window.removeEventListener('pointerdown',r.activate,true);window.removeEventListener('focusin',r.focusActivate,true);r.hover&&window.removeEventListener('pointermove',r.hover);r.leave&&window.removeEventListener('pointerleave',r.leave);r.handle.removeEventListener('pointerdown',r.down);r.target.removeEventListener('pointermove',r.move,true);for(const event of ['pointerup','pointercancel'])r.target.removeEventListener(event,r.up,true);}this.registrations.clear();this.focusOrder=[];}
}
