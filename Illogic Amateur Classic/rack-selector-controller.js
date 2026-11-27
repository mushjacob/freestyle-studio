import {RackSelection} from './rack-selection.js';
const clone=value=>value==null?value:structuredClone(value);
const signature=value=>JSON.stringify(value);
const rowIds=rows=>rows.map(row=>typeof row==='string'?row:row?.id);
const point=event=>({x:event.clientX,y:event.clientY});
const finitePoint=value=>Number.isFinite(value?.x)&&Number.isFinite(value?.y);
/** Segment/rectangle intersection catches LED rows skipped by sparse events. */
function crossing(from,to,rect){
 if(!finitePoint(from)||!finitePoint(to)||!['left','top','right','bottom','width','height'].every(key=>Number.isFinite(rect?.[key]))||rect.width<=0||rect.height<=0)return null;
 let first=0,last=1;
 for(const [start,end,min,max]of [[from.x,to.x,rect.left,rect.right],[from.y,to.y,rect.top,rect.bottom]]){
  const delta=end-start;if(delta===0){if(start<min||start>max)return null;continue;}
  const a=(min-start)/delta,b=(max-start)/delta;first=Math.max(first,Math.min(a,b));last=Math.min(last,Math.max(a,b));if(first>last)return null;
 }
 return first;
}
/** Local selection adapter for explicit current-pattern rack rows. It performs
 * no engine writes and does not establish a project-global rack identity.
 * getRows supplies the complete ordered IDs, including filtered-out DOM rows.
 * getScope excludes focusedRow/selectedChannel; those are local focus state.
 */
export class RackSelectorController{
 constructor({getElement,getRows,getScope,getFocusedRow=()=>null,onFocus=()=>{},onChange=()=>{},onMenu=()=>{},isEditable=()=>true,onError=()=>{}}={}){
  if(![getElement,getRows,getScope,getFocusedRow,onFocus,onChange,onMenu,isEditable,onError].every(callback=>typeof callback==='function'))throw new TypeError('Rack selectors require explicit host, ordered rows, scope and callbacks.');
  Object.assign(this,{getElement,getRows,getScope,getFocusedRow,onFocus,onChange,onMenu,isEditable,onError});this.selection=new RackSelection();this.element=null;this.gesture=null;this.scopeKey=undefined;this.rowsKey=undefined;this.destroyed=false;this.keyActivation=null;this.menuGuard=0;this.clickGuard=null;
  this.down=event=>this.start(event);
  // The browser's own menu never opens for an LED, while Ctrl is held (macOS
  // Ctrl+click is the selection add, not a right-click), or for the
  // contextmenu that a right press on a channel name produces (the channel
  // menu opens on a right click without drag, from the pointer gesture).
  this.menu=event=>{const guarded=this.name(event.target)&&this.menuGuard>Date.now();if(guarded)this.menuGuard=0;if(this.led(event.target)||guarded||event.ctrlKey&&this.element?.contains(event.target)){event.preventDefault();event.stopPropagation();}};
  this.click=event=>{if(this.clickGuard&&this.name(event.target)){const guard=this.clickGuard;this.clickGuard=null;if(guard.until>Date.now()&&guard.id===this.nameRowId(event.target)&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.stopPropagation();return;}}const led=this.led(event.target);if(!led)return;event.preventDefault();event.stopPropagation();const id=this.rowId(led);if(this.keyActivation===id){this.keyActivation=null;return;}if(event.detail===0&&!this.gesture&&this.allowed())this.focus(id);};
  this.double=event=>{if(!this.led(event.target))return;event.preventDefault();event.stopPropagation();this.selectAll();};
  this.key=event=>this.keyboard(event);this.lost=event=>{if(this.gesture&&event.pointerId===this.gesture.pointerId)this.cancel();};this.sync();
 }
 get ids(){return this.selection.ids;}
 get active(){return!!this.gesture;}
 allowed(){try{return!this.destroyed&&!!this.isEditable();}catch(error){this.report(error);return false;}}
 report(error){try{this.onError(error);}catch{}}
 led(target){const led=target?.closest?.('.channel-selected');return led&&this.element?.contains(led)?led:null;}
 rowId(led){return led?.dataset.rowId||led?.dataset.channel||led?.closest('.rack-channel')?.dataset.channel||null;}
 /** A channel-name button inside the rack, or null. */
 name(target){const name=target?.closest?.('.channel-name');return name&&this.element?.contains(name)?name:null;}
 /** The rack row id of an element inside a row (data-rack-row first: it is the selection identity). */
 nameRowId(element){const row=element?.closest?.('.rack-channel');return row?.dataset.rackRow||row?.dataset.channel||null;}
 bind(element){
  if(this.element===element)return;
  for(const [type,handler]of [['pointerdown',this.down],['contextmenu',this.menu],['click',this.click],['dblclick',this.double],['keydown',this.key],['lostpointercapture',this.lost]])this.element?.removeEventListener(type,handler,true);
  this.element=element;
  for(const [type,handler]of [['pointerdown',this.down],['contextmenu',this.menu],['click',this.click],['dblclick',this.double],['keydown',this.key],['lostpointercapture',this.lost]])this.element?.addEventListener(type,handler,true);
 }
 paint(){
  const ids=this.ids;
  for(const led of this.element?.querySelectorAll('.channel-selected')||[]){const selected=ids.has(this.rowId(led));led.setAttribute('aria-pressed',String(selected));led.classList.toggle('selected',selected);}
 }
 publish({focus=false}={}){
  this.paint();const snapshot=this.selection.snapshot();
  if(this.publishing)return snapshot;this.publishing=true;
  try{
  if(focus&&snapshot.focusId!==null)try{this.onFocus(snapshot.focusId);}catch(error){this.report(error);}
  try{this.onChange(this.selection.snapshot());}catch(error){this.report(error);}
  }finally{this.publishing=false;}
  return this.selection.snapshot();
 }
 focusDOM(id){for(const led of this.element?.querySelectorAll('.channel-selected')||[])if(this.rowId(led)===id){try{led.focus({preventScroll:true});}catch{}break;}}
 sync(){
  if(this.destroyed)return this.selection.snapshot();
  const scope=clone(this.getScope()),rows=rowIds(this.getRows()),nextScope=signature(scope),nextRows=signature(rows),element=this.getElement(),scopeChanged=nextScope!==this.scopeKey,rowsChanged=nextRows!==this.rowsKey;
  let restoreFocus=false;
  if(this.gesture&&(scopeChanged||rowsChanged||element!==this.element||!this.allowed())){
   restoreFocus=!scopeChanged&&this.gesture.button===0;this.cleanup();this.selection.finish({cancel:!scopeChanged});
  }
  this.selection.sync({scope,rows});this.scopeKey=nextScope;this.rowsKey=nextRows;this.bind(element);
  if(scopeChanged){this.keyActivation=null;const focused=this.getFocusedRow();if(rows.includes(focused))this.selection.focus(focused);}
  return this.publish({focus:restoreFocus});
 }
 current(){
  if(!this.gesture||!this.allowed())return false;
  return signature(this.getScope())===this.gesture.scopeKey&&signature(rowIds(this.getRows()))===this.gesture.rowsKey&&this.getElement()===this.element;
 }
 focus(id){
  if(!this.allowed()||!this.selection.rows.includes(id))return false;
  const scope=this.scopeKey,changed=this.selection.focusId!==id||this.ids.size!==1||!this.ids.has(id)||this.getFocusedRow()!==id;this.selection.focus(id);this.publish({focus:changed});if(scope===this.scopeKey)this.focusDOM(id);return true;
 }
 start(event){
  const name=!this.led(event.target)&&this.name(event.target);if(name)return this.startName(event,name);
  const led=this.led(event.target);if(!led||![0,2].includes(event.button))return false;
  event.preventDefault();event.stopPropagation();this.keyActivation=null;if(this.gesture||!this.allowed())return false;
  const scope=this.scopeKey;this.sync();const id=this.rowId(led);if(scope!==this.scopeKey||!this.element?.contains(led)||!this.selection.rows.includes(id)||!finitePoint(point(event)))return false;
  // Shift+click selects the range from the focused row; Ctrl/Cmd+click toggles
  // like FL's right-click (and can sweep on), leaving the rest selected.
  if(event.button===0&&event.shiftKey&&!event.altKey){this.selection.finish();this.selection.range(id);this.publish();this.focusDOM(id);return true;}
  const button=event.button===0&&(event.ctrlKey||event.metaKey)?2:event.button;if(!this.selection.begin(id,{button}))return false;
  const document=this.element.ownerDocument,window=document.defaultView,entry={pointerId:event.pointerId,button,scopeKey:this.scopeKey,rowsKey:this.rowsKey,point:point(event),document,window,capture:this.element};this.gesture=entry;
  entry.move=next=>this.move(next);entry.up=next=>this.finish(next);entry.cancel=next=>{if(next.pointerId===entry.pointerId)this.cancel();};entry.escape=next=>{if(next.key==='Escape'){next.preventDefault();next.stopPropagation();this.cancel();}};entry.blur=()=>this.cancel();
  document.addEventListener('pointermove',entry.move,true);document.addEventListener('pointerup',entry.up,true);document.addEventListener('pointercancel',entry.cancel,true);document.addEventListener('keydown',entry.escape,true);window?.addEventListener('blur',entry.blur);
  try{entry.capture.setPointerCapture?.(entry.pointerId);}catch{}
  try{led.focus({preventScroll:true});}catch{}
  // onFocus may synchronously rebuild LED children and call sync(). Context and
  // document listeners already exist; unchanged row/scope sync keeps this drag.
  this.publish({focus:button===0});if(this.gesture===entry)this.focusDOM(id);return true;
 }
 /**
  * FL channel names: Ctrl/Cmd+click toggles that channel in the selection;
  * a right-drag across names selects the swept channels; a right click
  * without drag opens the channel menu (onMenu) at the release point. The
  * native contextmenu of that press is suppressed (macOS fires it on press).
  */
 startName(event,name){
  const modified=event.button===0&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey;if(event.button!==2&&!modified)return false;
  if(this.gesture||!this.allowed())return false;
  const scope=this.scopeKey;this.sync();const id=this.nameRowId(name);if(scope!==this.scopeKey||!this.element?.contains(name)||!this.selection.rows.includes(id)||!finitePoint(point(event)))return false;
  event.preventDefault();event.stopPropagation();this.keyActivation=null;if(event.button===2)this.menuGuard=Date.now()+1500;
  if(modified){this.clickGuard={id,until:Date.now()+1500};this.selection.finish();this.selection.toggle(id);this.publish();return true;}
  const document=this.element.ownerDocument,window=document.defaultView,entry={pointerId:event.pointerId,button:2,surface:'name',startId:id,dragged:false,scopeKey:this.scopeKey,rowsKey:this.rowsKey,point:point(event),document,window,capture:this.element};this.gesture=entry;
  entry.move=next=>this.move(next);entry.up=next=>this.finish(next);entry.cancel=next=>{if(next.pointerId===entry.pointerId)this.cancel();};entry.escape=next=>{if(next.key==='Escape'){next.preventDefault();next.stopPropagation();this.cancel();}};entry.blur=()=>this.cancel();
  document.addEventListener('pointermove',entry.move,true);document.addEventListener('pointerup',entry.up,true);document.addEventListener('pointercancel',entry.cancel,true);document.addEventListener('keydown',entry.escape,true);window?.addEventListener('blur',entry.blur);
  try{entry.capture.setPointerCapture?.(entry.pointerId);}catch{}
  return true;
 }
 sweep(to){
  if(this.gesture.button!==2||!finitePoint(to))return false;const from=this.gesture.point,hits=[],names=this.gesture.surface==='name';
  // Names sweep whole rows (the drag crosses the name column, not the LEDs).
  for(const target of this.element.querySelectorAll(names?'.rack-channel':'.channel-selected')){const id=names?this.nameRowId(target):this.rowId(target);if(!this.selection.rows.includes(id))continue;const at=crossing(from,to,target.getBoundingClientRect());if(at!==null)hits.push({id,at});}
  hits.sort((a,b)=>a.at-b.at);
  let changed=false;
  if(names&&!this.gesture.dragged){if(!hits.some(hit=>hit.id!==this.gesture.startId)){this.gesture.point=to;return false;}this.gesture.dragged=true;this.selection.begin(this.gesture.startId,{button:2,replace:true});changed=true;}
  for(const {id}of hits)changed=this.selection.over(id)||changed;this.gesture.point=to;return changed;
 }
 move(event){
  if(!this.gesture||event.pointerId!==this.gesture.pointerId)return false;
  if(!this.current()){this.sync();if(this.gesture)this.cancel();return false;}
  event.preventDefault();event.stopPropagation();if(this.sweep(point(event)))this.publish();return true;
 }
 cleanup(){
  const entry=this.gesture;if(!entry)return;this.gesture=null;const{document,window}=entry;
  document.removeEventListener('pointermove',entry.move,true);document.removeEventListener('pointerup',entry.up,true);document.removeEventListener('pointercancel',entry.cancel,true);document.removeEventListener('keydown',entry.escape,true);window?.removeEventListener('blur',entry.blur);
  try{entry.capture.releasePointerCapture?.(entry.pointerId);}catch{}
 }
 finish(event){
  if(!this.gesture||event.pointerId!==this.gesture.pointerId)return false;
  if(!this.current()){this.sync();if(this.gesture)this.cancel();return false;}
  event.preventDefault();event.stopPropagation();this.sweep(point(event));const entry=this.gesture;this.cleanup();
  if(entry.surface==='name'&&!entry.dragged){try{this.onMenu(entry.startId,event);}catch(error){this.report(error);}return true;}
  this.selection.finish();this.publish();return true;
 }
 cancel(){if(!this.gesture)return false;if(signature(this.getScope())!==this.gesture.scopeKey||signature(rowIds(this.getRows()))!==this.gesture.rowsKey||this.getElement()!==this.element){this.sync();return true;}const focus=this.gesture.button===0;this.cleanup();this.selection.finish({cancel:true});this.publish({focus});return true;}
 selectAll(){if(!this.allowed())return false;this.sync();this.cleanup();this.selection.finish();this.selection.all();this.publish();return true;}
 keyboard(event){
  const led=this.led(event.target);if(!led||event.defaultPrevented||event.repeat||event.isComposing||event.altKey||!['Enter',' ','Spacebar'].includes(event.key)||!this.allowed())return false;
  event.preventDefault();event.stopPropagation();this.cancel();this.sync();const id=this.rowId(led);if(!this.selection.rows.includes(id))return false;this.keyActivation=id;
  if(event.ctrlKey||event.metaKey){this.selection.toggle(id);this.publish();}else this.focus(id);return true;
 }
 destroy(){if(this.destroyed)return;this.cancel();this.destroyed=true;this.bind(null);this.keyActivation=null;}
}
