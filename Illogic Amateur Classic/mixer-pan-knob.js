/** Scoped pan gesture: local preview and one final cloud callback, no audio DSP. */
const clone=value=>value==null?value:structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>Array.isArray(value)?value.map(stable):record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp=value=>Math.max(-1,Math.min(1,value));
const keys=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End']);
const state=row=>row&&({key:row.key,id:row.id,kind:row.kind,runtime:row.runtime,verified:row.verified,persisted:row.persisted,control:row.controls?.pan,value:row.values?.pan});
export function mixerPanText(value){if(!finite(value)||value< -1||value>1)return'Pan unknown';if(value===0)return'Center';return`${Number((Math.abs(value)*100).toFixed(3))}% ${value<0?'left':'right'}`;}
export class MixerPanKnob{
 /** Optional onPanLive({row,value,before,scope,restore}) hears every sampled value of a pointer
  * drag (the caller throttles) so the pan is audible while dragging; a cancelled drag that was
  * heard sends the original value back with restore:true. Saving stays with onPan on release.
  * Keyboard steps commit on key-up at once, so they send no separate live value. */
 constructor(button,row,{getCurrentRow=()=>row,getScope,isEditable=()=>true,onPan=null,onPanLive=null,onInteraction=()=>{},onStatus=()=>{}}={}){
  if(!button?.ownerDocument||typeof getScope!=='function'||typeof getCurrentRow!=='function')throw new TypeError('Pan requires a button, actual row and current project scope.');
  Object.assign(this,{button,row:clone(row),getCurrentRow,getScope,isEditable,onPan,onPanLive:typeof onPanLive==='function'?onPanLive:null,onInteraction,onStatus});this.document=button.ownerDocument;this.window=this.document.defaultView;this.destroyed=false;this.gesture=null;this.pending=false;this.listeners=[];
  button.type='button';button.classList.add('mixer-pan');button.setAttribute('role','slider');button.setAttribute('aria-valuemin','-1');button.setAttribute('aria-valuemax','1');button.setAttribute('aria-orientation','horizontal');button.style.touchAction='none';
  try{this.renderScope=this.scope();}catch{this.renderScope=null;}
  const listen=(target,type,fn,options)=>{target?.addEventListener(type,fn,options);this.listeners.push(()=>target?.removeEventListener(type,fn,options));};
  listen(button,'pointerdown',event=>this.pointerDown(event));listen(button,'pointermove',event=>this.pointerMove(event));listen(button,'pointerup',event=>this.pointerUp(event));
  for(const type of ['pointercancel','lostpointercapture'])listen(button,type,event=>{if(this.gesture?.kind==='pointer'&&event.pointerId===this.gesture.pointerId)this.cancel();});
  listen(button,'keydown',event=>this.keyDown(event));listen(button,'keyup',event=>this.keyUp(event));listen(button,'blur',()=>this.cancel());listen(this.window,'blur',()=>this.cancel());listen(this.document,'keydown',event=>{if(event.key==='Escape'&&this.active){event.preventDefault();event.stopPropagation();this.cancel();}},true);listen(button,'click',event=>event.stopPropagation());this.sync();
 }
 get active(){return !!this.gesture;}
 scope(){const value=clone(this.getScope());if(!record(value)||!Object.keys(value).length)throw Error('The mixer project scope is unavailable.');return value;}
 currentRow(){const row=this.getCurrentRow(this.row.key);return row?.key===this.row.key&&row.kind===this.row.kind&&row.id===this.row.id?row:null;}
 report(error){try{this.onStatus(error instanceof Error?error.message:String(error));}catch{}}
 enabled(row){try{const control=row?.controls?.pan,target=control?.target,value=row?.values?.pan;// Lane pan (saved) and, since 338, bus/master pan (live only, not saved with the project).
  const bound=row?.kind==='lane'?target?.kind==='lane'&&target.laneId===row.id:row?.kind==='bus'&&target?.kind==='bus'&&target.busId===row.id;
  return !this.destroyed&&!this.pending&&typeof row?.id==='string'&&!!row.id&&control?.enabled===true&&control?.supported!==false&&bound&&value?.known===true&&finite(value.value)&&value.value>= -1&&value.value<=1&&typeof this.onPan==='function'&&this.isEditable(row,'pan')===true;}catch{return false;}}
 paint(row,value){const known=finite(value)&&value>= -1&&value<=1;this.button.dataset.readState=known?'known':'unknown';this.button.dataset.origin=row?.values?.pan?.origin||'unknown';this.button.setAttribute('aria-label',`${row?.name||this.row.name||this.row.id} pan`);this.button.setAttribute('aria-valuetext',mixerPanText(value));if(known){this.button.setAttribute('aria-valuenow',String(value));this.button.style.setProperty('--rotation',`${value*125}deg`);}else{this.button.removeAttribute('aria-valuenow');this.button.style.removeProperty('--rotation');}this.button.title=`${row?.name||this.row.name||this.row.id} pan · ${mixerPanText(value)}${row?.controls?.pan?.liveOnly?' · live only, not saved with the project':''}${row?.controls?.pan?.reason?' · '+row.controls.pan.reason:''}`;}
 sync(){if(this.destroyed)return false;if(this.active&&!this.valid()){this.cancel();return false;}if(this.active)return true;let row=null,scoped=false;try{row=this.currentRow();const sameScope=same(this.scope(),this.renderScope);
  // Re-bind between gestures: the same strip (key/kind/id, same project scope) whose live or saved pan
  // changed — e.g. the first live bus/master pan arriving — adopts the current row without a re-render.
  // A change DURING a gesture still cancels it (valid() compares the gesture's captured state).
  if(sameScope&&row&&!this.pending&&!same(state(row),state(this.row)))this.row=clone(row);
  scoped=sameScope&&same(state(row),state(this.row));}catch{}this.button.disabled=!scoped||!this.enabled(row);const value=row?.values?.pan;this.paint(row,value?.known===true?value.value:null);return !this.button.disabled;}
 begin(kind,event){
  if(this.destroyed||this.active||this.pending||this.button.disabled||!this.button.isConnected)return false;
  try{const row=this.currentRow(),scope=this.scope();if(!row||!same(scope,this.renderScope)||!same(state(row),state(this.row))||!this.enabled(row))return false;
   this.gesture={kind,row:clone(row),state:clone(state(row)),scope,before:row.values.pan.value,value:row.values.pan.value,keys:new Set(),pointerId:event?.pointerId,origin:{x:event?.clientX,y:event?.clientY}};this.onInteraction(true);if(!this.valid()){this.cancel();return false;}return true;
  }catch(error){this.cancel();this.report(error);return false;}
 }
 valid(){const g=this.gesture;if(!g||this.destroyed||!this.button.isConnected||this.button.disabled)return false;try{const current=this.currentRow();return same(g.scope,this.scope())&&same(g.state,state(current))&&this.enabled(current);}catch{return false;}}
 pointerDown(event){if(event.button!==0||event.isPrimary===false||event.pointerId==null||!finite(event.clientX)||!finite(event.clientY)||this.button.disabled)return;event.preventDefault();event.stopPropagation();this.button.focus();if(!this.begin('pointer',event))return;try{this.button.setPointerCapture?.(event.pointerId);}catch{}}
 sample(event){const g=this.gesture;if(!g||g.kind!=='pointer'||event.pointerId!==g.pointerId||!finite(event.clientX)||!finite(event.clientY))return false;if(!this.valid()){this.cancel();return false;}g.value=clamp(g.before+(event.clientX-g.origin.x+g.origin.y-event.clientY)*2/150);this.paint(g.row,g.value);this.live(g,g.value);return true;}
 live(gesture,value,{restore=false}={}){if(!this.onPanLive||!gesture||!finite(value)||!restore&&value===gesture.liveValue)return;try{gesture.liveValue=value;if(this.onPanLive({row:clone(gesture.row),value,before:gesture.before,scope:clone(gesture.scope),restore}))gesture.liveSent=true;}catch(error){this.report(error);}}
 pointerMove(event){if(this.gesture?.kind!=='pointer'||event.pointerId!==this.gesture.pointerId)return;event.preventDefault();event.stopPropagation();this.sample(event);}
 pointerUp(event){if(this.gesture?.kind!=='pointer'||event.pointerId!==this.gesture.pointerId)return;event.preventDefault();event.stopPropagation();if(this.sample(event))this.finish();}
 keyDown(event){if(!keys.has(event.key)||event.altKey||event.ctrlKey||event.metaKey||this.button.disabled)return;event.preventDefault();event.stopPropagation();if(!this.active&&!this.begin('keyboard'))return;if(this.gesture?.kind!=='keyboard'||!this.valid()){this.cancel();return;}const g=this.gesture;g.keys.add(event.key);g.value=event.key==='Home'?-1:event.key==='End'?1:clamp(g.value+(['ArrowLeft','ArrowDown'].includes(event.key)?-1:1)*(event.shiftKey ? .1 : .01));this.paint(g.row,g.value);}
 keyUp(event){if(!keys.has(event.key)||this.gesture?.kind!=='keyboard')return;event.preventDefault();event.stopPropagation();this.gesture.keys.delete(event.key);if(!this.gesture.keys.size)this.finish();}
 finish({cancel=false}={}){
  const g=this.gesture;if(!g)return null;cancel=cancel||!this.valid();this.gesture=null;try{if(g.kind==='pointer'&&this.button.hasPointerCapture?.(g.pointerId))this.button.releasePointerCapture(g.pointerId);}catch{}
  try{this.onInteraction(false);}catch(error){cancel=true;this.report(error);}let current;try{current=this.currentRow();if(!same(g.scope,this.scope())||!same(g.state,state(current))||!this.enabled(current))cancel=true;}catch{cancel=true;}
  this.sync();const packet={cancelled:cancel,changed:!cancel&&g.value!==g.before,row:clone(g.row),before:g.before,value:g.value,scope:clone(g.scope),bounds:{min:-1,max:1,step:.01}};
  if(!packet.changed&&g.liveSent)this.live(g,g.before,{restore:true});
  if(packet.changed){this.pending=true;this.button.disabled=true;try{const result=this.onPan(clone(packet));if(result&&typeof result.then==='function')Promise.resolve(result).catch(error=>this.report(error)).finally(()=>{this.pending=false;this.sync();});else{this.pending=false;this.sync();}}catch(error){this.pending=false;this.report(error);this.sync();}}
  return packet;
 }
 cancel(){return this.finish({cancel:true});}
 destroy(){if(this.destroyed)return;this.cancel();this.destroyed=true;for(const remove of this.listeners)remove();this.listeners=[];this.button.disabled=true;}
}
export function attachMixerPanKnob(button,row,options){return new MixerPanKnob(button,row,options);}
