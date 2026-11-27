/** Frame-coalesced workspace dragging. Pointer moves only change a compositor transform. */
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export function boundWindowPosition({left,top,width,height,boundsWidth,boundsHeight,visible=80,header=28}){
 return {left:clamp(left,Math.min(0,visible-width),Math.max(0,boundsWidth-visible)),top:clamp(top,0,Math.max(0,boundsHeight-header))};
}
export class WindowManager{
 constructor({bounds,raf=callback=>globalThis.requestAnimationFrame(callback),caf=id=>globalThis.cancelAnimationFrame(id),onDragState=()=>{}}={}){this.bounds=bounds;this.raf=raf;this.caf=caf;this.onDragState=onDragState;this.registrations=new Map();this.focusOrder=[];this.front=20;this.active=null;this.pending=null;this.frames=0;this.moves=0;this.starts=0;this.lastWindow='';this.blur=()=>this.finish();globalThis.addEventListener?.('blur',this.blur);}
 get dragging(){return !!this.active;}
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
  const move=e=>{let a=this.active||this.pending;if(!a||a.window!==window||a.pointerId!==e.pointerId||!Number.isFinite(e.clientX)||!Number.isFinite(e.clientY))return;
   if(!this.active){
    if(Math.hypot(e.clientX-a.x,e.clientY-a.y)<=3)return;
    const rect=window.getBoundingClientRect(),bounds=fixed?{left:0,top:0,width:globalThis.innerWidth,height:globalThis.innerHeight}:this.bounds.getBoundingClientRect(),left=rect.left-bounds.left,top=rect.top-bounds.top;
    a=this.active={...a,autoHeight:fixed&&!window.style.height,left,top,width:rect.width,height:rect.height,bounds,position:{left,top},frame:null,moved:false,touchAction:handle.style.touchAction};this.pending=null;this.starts++;this.lastWindow=window.id||window.tagName;
    window.classList.remove('expanded');window.style.position=fixed?'fixed':'absolute';window.style.margin='0';window.style.right='auto';window.style.bottom='auto';window.style.left=`${left}px`;window.style.top=`${top}px`;window.style.width=`${rect.width}px`;window.style.height=`${rect.height}px`;window.style.willChange='transform';window.classList.add('window-dragging');handle.style.touchAction='none';
    handle.setPointerCapture(e.pointerId);this.onDragState(true,window);
   }
   e.preventDefault();e.stopPropagation();this.moves++;a.position=boundWindowPosition({left:a.left+e.clientX-a.x,top:a.top+e.clientY-a.y,width:a.width,height:a.height,boundsWidth:a.bounds.width,boundsHeight:a.bounds.height});a.moved=true;if(a.frame==null)a.frame=this.raf(()=>this.paint());
  };
  const up=e=>{const a=this.active||this.pending;if(a?.window===window&&(e.pointerId==null||e.pointerId===a.pointerId)){if(e.type!=='pointercancel'&&Number.isFinite(e.clientX)&&Number.isFinite(e.clientY))move(e);this.finish();}};
  window.addEventListener('pointerdown',activate,true);window.addEventListener('focusin',activate,true);handle.addEventListener('pointerdown',down);target.addEventListener('pointermove',move,true);target.addEventListener('pointerup',up,true);target.addEventListener('pointercancel',up,true);
  this.registrations.set(window,{handle,target,activate,down,move,up});if(!fixed)this.focusOrder.push(window);
 }
 paint(){const a=this.active;if(!a)return;a.frame=null;this.frames++;a.window.style.transform=`translate3d(${a.position.left-a.left}px,${a.position.top-a.top}px,0)`;}
 finish(){const a=this.active;this.pending=null;if(!a)return;if(a.frame!=null)this.caf(a.frame);this.active=null;a.window.style.left=`${a.position.left}px`;a.window.style.top=`${a.position.top}px`;a.window.style.transform='';a.window.style.willChange='';if(a.autoHeight)a.window.style.height='';a.window.classList.remove('window-dragging');a.handle.style.touchAction=a.touchAction??'';try{if(a.handle.hasPointerCapture?.(a.pointerId))a.handle.releasePointerCapture(a.pointerId);}catch{}this.onDragState(false,a.window);}
 unregister(window){const r=this.registrations.get(window);if(!r)return;if(this.active?.window===window||this.pending?.window===window)this.finish();window.removeEventListener('pointerdown',r.activate,true);window.removeEventListener('focusin',r.activate,true);r.handle.removeEventListener('pointerdown',r.down);r.target.removeEventListener('pointermove',r.move,true);for(const event of ['pointerup','pointercancel'])r.target.removeEventListener(event,r.up,true);this.registrations.delete(window);this.focusOrder=this.focusOrder.filter(entry=>entry!==window);}
 watchDialogs(root=document.body){const scan=node=>{if(node.nodeType!==1)return;if(node.matches?.('dialog'))this.register(node);node.querySelectorAll?.('dialog').forEach(dialog=>this.register(dialog));};scan(root);this.observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)scan(node);for(const [window]of this.registrations)if(window.tagName==='DIALOG'&&!window.isConnected)this.unregister(window);});this.observer.observe(root,{childList:true,subtree:true});}
 destroy(){this.finish();globalThis.removeEventListener?.('blur',this.blur);this.observer?.disconnect();for(const [window,r]of this.registrations){window.removeEventListener('pointerdown',r.activate,true);window.removeEventListener('focusin',r.activate,true);r.handle.removeEventListener('pointerdown',r.down);r.target.removeEventListener('pointermove',r.move,true);for(const event of ['pointerup','pointercancel'])r.target.removeEventListener(event,r.up,true);}this.registrations.clear();this.focusOrder=[];}
}
