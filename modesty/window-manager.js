/** Frame-coalesced workspace dragging. Pointer moves only change a compositor transform. */
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export function boundWindowPosition({left,top,width,height,boundsWidth,boundsHeight,visible=80,header=28}){
 return {left:clamp(left,Math.min(0,visible-width),Math.max(0,boundsWidth-visible)),top:clamp(top,0,Math.max(0,boundsHeight-header))};
}
export class WindowManager{
 constructor({bounds,raf=callback=>globalThis.requestAnimationFrame(callback),caf=id=>globalThis.cancelAnimationFrame(id),onDragState=()=>{}}={}){this.bounds=bounds;this.raf=raf;this.caf=caf;this.onDragState=onDragState;this.registrations=new Map();this.front=20;this.active=null;this.frames=0;this.moves=0;this.starts=0;this.lastWindow='';this.blur=()=>this.finish();globalThis.addEventListener?.('blur',this.blur);}
 get dragging(){return !!this.active;}
 raise(window){window.style.zIndex=String(++this.front);return this.front;}
 register(window,{handle=window.querySelector('.drag-handle,header,.panel-heading'),fixed=window.tagName==='DIALOG'}={}){
  if(!handle||this.registrations.has(window))return;
  const target=window.ownerDocument||handle;const activate=()=>{if(!fixed)this.raise(window);};
  const down=e=>{if(e.button!==0||e.target.closest('button,input,select,textarea,a,summary,[data-no-drag]'))return;if(this.active)this.finish();
   this.starts++;this.lastWindow=window.id||window.tagName;const rect=window.getBoundingClientRect(),bounds=fixed?{left:0,top:0,width:globalThis.innerWidth,height:globalThis.innerHeight}:this.bounds.getBoundingClientRect();
   const left=rect.left-bounds.left,top=rect.top-bounds.top;this.active={window,handle,fixed,pointerId:e.pointerId,x:e.clientX,y:e.clientY,left,top,width:rect.width,height:rect.height,bounds,position:{left,top},frame:null,moved:false};
   window.classList.remove('expanded');window.style.position=fixed?'fixed':'absolute';window.style.margin='0';window.style.right='auto';window.style.bottom='auto';window.style.left=`${left}px`;window.style.top=`${top}px`;window.style.width=`${rect.width}px`;window.style.height=`${rect.height}px`;window.style.willChange='transform';window.classList.add('window-dragging');handle.style.touchAction='none';
   e.preventDefault();e.stopPropagation();activate();handle.setPointerCapture(e.pointerId);this.onDragState(true,window);
  };
  const move=e=>{const a=this.active;if(!a||a.window!==window||a.pointerId!==e.pointerId)return;this.moves++;a.position=boundWindowPosition({left:a.left+e.clientX-a.x,top:a.top+e.clientY-a.y,width:a.width,height:a.height,boundsWidth:a.bounds.width,boundsHeight:a.bounds.height});a.moved=true;if(a.frame==null)a.frame=this.raf(()=>this.paint());};
  const up=e=>{if(this.active?.window===window&&(e.pointerId==null||e.pointerId===this.active.pointerId)){if(e.type!=='pointercancel'&&Number.isFinite(e.clientX)&&Number.isFinite(e.clientY))move(e);this.finish();}};
  window.addEventListener('pointerdown',activate,true);handle.addEventListener('pointerdown',down);target.addEventListener('pointermove',move,true);target.addEventListener('pointerup',up,true);target.addEventListener('pointercancel',up,true);
  this.registrations.set(window,{handle,target,activate,down,move,up});
 }
 paint(){const a=this.active;if(!a)return;a.frame=null;this.frames++;a.window.style.transform=`translate3d(${a.position.left-a.left}px,${a.position.top-a.top}px,0)`;}
 finish(){const a=this.active;if(!a)return;if(a.frame!=null)this.caf(a.frame);this.active=null;a.window.style.left=`${a.position.left}px`;a.window.style.top=`${a.position.top}px`;a.window.style.transform='';a.window.style.willChange='';a.window.classList.remove('window-dragging');try{if(a.handle.hasPointerCapture?.(a.pointerId))a.handle.releasePointerCapture(a.pointerId);}catch{}this.onDragState(false,a.window);}
 unregister(window){const r=this.registrations.get(window);if(!r)return;if(this.active?.window===window)this.finish();window.removeEventListener('pointerdown',r.activate,true);r.handle.removeEventListener('pointerdown',r.down);r.target.removeEventListener('pointermove',r.move,true);for(const event of ['pointerup','pointercancel'])r.target.removeEventListener(event,r.up,true);this.registrations.delete(window);}
 watchDialogs(root=document.body){const scan=node=>{if(node.nodeType!==1)return;if(node.matches?.('dialog'))this.register(node);node.querySelectorAll?.('dialog').forEach(dialog=>this.register(dialog));};scan(root);this.observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)scan(node);for(const [window]of this.registrations)if(window.tagName==='DIALOG'&&!window.isConnected)this.unregister(window);});this.observer.observe(root,{childList:true,subtree:true});}
 destroy(){this.finish();globalThis.removeEventListener?.('blur',this.blur);this.observer?.disconnect();for(const [window,r]of this.registrations){window.removeEventListener('pointerdown',r.activate,true);r.handle.removeEventListener('pointerdown',r.down);r.target.removeEventListener('pointermove',r.move,true);for(const event of ['pointerup','pointercancel'])r.target.removeEventListener(event,r.up,true);}this.registrations.clear();}
}
