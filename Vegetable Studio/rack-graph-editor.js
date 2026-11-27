const clone=value=>structuredClone(value);
const fingerprint=value=>value&&typeof value==='object'?[Array.isArray(value)?'array':'object',...(Array.isArray(value)?[value.length]:[]),Object.keys(value).sort().map(key=>[key,fingerprint(value[key])])]:[typeof value,value];
const same=(a,b)=>JSON.stringify(fingerprint(a))===JSON.stringify(fingerprint(b));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp=value=>Math.max(0,Math.min(1,value));
// FL's default step velocity: 100 of 128.
export const DEFAULT_STEP_VELOCITY=100/128;
export const rackGraphVelocity=step=>step===true?DEFAULT_STEP_VELOCITY:typeof step==='number'?step:0;
const active=step=>step===true||typeof step==='number'&&step>0;
const equivalent=(a,b)=>Math.abs(a-b)<=Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b))*32;
function validate(steps,indices){
 if(!Array.isArray(steps)||!Array.isArray(indices)||new Set(indices).size!==indices.length)throw new Error('Load complete step data and visible graph columns before editing.');
 for(let index=0;index<steps.length;index++)if(!Object.hasOwn(steps,index)||typeof steps[index]!=='boolean'&&!(finite(steps[index])&&steps[index]>=0&&steps[index]<=1))throw new Error('Load complete canonical step values before editing.');
 if(Object.keys(steps).some(key=>/truncat/i.test(key)&&steps[key]))throw new Error('Load complete step data before editing.');
 for(const index of indices)if(!Number.isInteger(index)||index<0||index>=steps.length)throw new Error('Graph columns need exact visible step indexes.');
}
/** Set only existing active columns. false/0 and unseen steps are never activated. */
export function rackGraphSet(steps,index,value,{reset=false}={}){
 if(!active(steps[index]))return;
 const current=rackGraphVelocity(steps[index]),target=reset?DEFAULT_STEP_VELOCITY:clamp(value);
 if(!finite(target))throw new Error('Choose a finite step velocity.');
 if(equivalent(current,target))return;
 steps[index]=reset?true:target;
}
export function rackGraphScale(before,indices,anchor,value){
 validate(before,indices);const result=clone(before),base=rackGraphVelocity(before[anchor]);if(!active(before[anchor])||base<=0)return result;
 for(const index of indices)if(active(before[index]))rackGraphSet(result,index,rackGraphVelocity(before[index])*clamp(value)/base);return result;
}
export function rackGraphRamp(before,indices,from,to){
 validate(before,indices);const result=clone(before),first=indices.indexOf(from.index),last=indices.indexOf(to.index);if(first<0||last<0)return result;
 for(let column=Math.min(first,last);column<=Math.max(first,last);column++){const amount=first===last?1:(column-first)/(last-first);rackGraphSet(result,indices[column],from.value+(to.value-from.value)*amount);}return result;
}

/** Integrated Channel Rack Graph Editor. Full source/project/load/page identity
 * belongs in getContext; getSteps returns the COMPLETE selected source array.
 * commit rechecks context+before at its own write boundary. Only velocity has a
 * verified step representation; other native target tabs remain unavailable.
 */
export class RackGraphEditor{
 constructor({element,getContext,getSteps,commit,onPreview=()=>{},onStatus=()=>{},onInteraction=()=>{},isEditable=()=>true,raf=fn=>globalThis.requestAnimationFrame(fn),caf=id=>globalThis.cancelAnimationFrame(id)}={}){
  if(!element||typeof getContext!=='function'||typeof getSteps!=='function'||typeof commit!=='function')throw new Error('Graph editor needs a host, complete steps and a scoped commit.');
  Object.assign(this,{element,getContext,getSteps,commit,onPreview,onStatus,onInteraction,isEditable,raf,caf});this.gesture=null;this.writing=false;this.frame=null;this.indices=[];this.visible=false;this.destroyed=false;this.uncertain=null;
  element.classList.add('rack-graph-editor');element.hidden=true;element.innerHTML='<div class="rack-graph-label"></div><div class="rack-graph-columns" role="group" aria-label="Step velocity graph"></div><div class="rack-graph-tabs" role="tablist" aria-label="Graph target"></div><div class="rack-graph-status" role="status"></div>';
  this.plot=element.querySelector('.rack-graph-columns');const tabs=element.querySelector('.rack-graph-tabs');for(const [name,title]of [['Note','Note pitch'],['Velocity','Velocity'],['Release','Release velocity'],['Fine','Fine pitch'],['Pan','Pan'],['Mod X','Modulation X'],['Mod Y','Modulation Y'],['Shift','Step time shift'],['Rep','Step repeat']]){const button=element.ownerDocument.createElement('button');button.type='button';button.textContent=name;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(name==='Velocity'));button.disabled=name!=='Velocity';button.title=name==='Velocity'?'Step velocity':`${title} is unavailable in this editor.`;tabs.append(button);}
  this.down=event=>this.start(event);this.menu=event=>event.preventDefault();this.plot.addEventListener('pointerdown',this.down);this.plot.addEventListener('contextmenu',this.menu);
 }
 get active(){return !!this.gesture;}
 get busy(){return this.active||this.writing;}
 render({indices=this.indices,label=''}={}){
  if(this.destroyed)return;this.cancel();const steps=this.getSteps(this.getContext());validate(steps,indices);this.indices=[...indices];this.element.querySelector('.rack-graph-label').textContent=label;this.paint(steps);return this.element;
 }
 show(options){if(options)this.render(options);if(this.destroyed)return false;this.visible=true;this.element.hidden=false;return true;}
 hide(){this.cancel();this.visible=false;this.element.hidden=true;}
 toggle(options){if(this.visible){this.hide();return false;}return this.show(options);}
 paint(steps){
  const doc=this.element.ownerDocument;this.plot.style.setProperty('--graph-columns',String(Math.max(1,this.indices.length)));this.plot.replaceChildren(...this.indices.map(index=>{const column=doc.createElement('div');column.className=`rack-graph-column ${active(steps[index])?'active':'inactive'}`;column.dataset.step=String(index);column.setAttribute('aria-label',`Step ${index+1} ${active(steps[index])?`${rackGraphVelocity(steps[index])*100}% velocity`:'inactive'}`);const bar=doc.createElement('span');bar.className='rack-graph-bar';bar.style.height=`${rackGraphVelocity(steps[index])*100}%`;column.append(bar);return column;}));
 }
 rect(){const {left,top,width,height}=this.plot.getBoundingClientRect();if(![left,top,width,height].every(finite)||width<=0||height<=0)throw new Error('The graph needs a visible editing area.');return{left,top,width,height};}
 current(entry=this.gesture){try{return !!entry&&!this.destroyed&&this.visible&&this.isEditable()&&same(entry.context,this.getContext())&&same(entry.before,this.getSteps(entry.context))&&same(entry.rect,this.rect())&&same(entry.indices,this.indices);}catch{return false;}}
 point(event,entry){if(!finite(event.clientX)||!finite(event.clientY))throw new Error('The graph pointer position is invalid.');const column=Math.max(0,Math.min(entry.indices.length-1,Math.floor((event.clientX-entry.rect.left)/entry.rect.width*entry.indices.length)));return{column,index:entry.indices[column],value:clamp(1-(event.clientY-entry.rect.top)/entry.rect.height)};}
 start(event){
  if(this.destroyed||!this.visible||this.busy||!this.indices.length||![0,2].includes(event.button)||event.isPrimary===false||event.pointerId==null||!this.isEditable())return false;
  try{const context=clone(this.getContext()),before=clone(this.getSteps(context));validate(before,this.indices);if(this.uncertain&&same(this.uncertain,{context,before}))throw new Error('Reload the step data before trying this edit again.');const rect=this.rect();if(event.clientX<rect.left||event.clientX>=rect.left+rect.width||event.clientY<rect.top||event.clientY>rect.top+rect.height)return false;
   const entry={context,before,steps:clone(before),indices:[...this.indices],rect,pointerId:event.pointerId,mode:event.altKey?'reset':event.ctrlKey?'scale':event.button===2?'ramp':'draw',previous:null,anchor:null,error:null};entry.anchor=this.point(event,entry);this.gesture=entry;event.preventDefault();this.onInteraction(true);if(!this.current(entry)){this.cancel();return false;}
   const doc=this.element.ownerDocument,win=doc.defaultView;entry.move=event=>this.move(event);entry.up=event=>this.finish(event);entry.cancel=event=>{if(event.pointerId===entry.pointerId)this.cancel();};entry.key=event=>{if(event.key==='Escape'){event.preventDefault();this.cancel();}};entry.blur=()=>this.cancel();doc.addEventListener('pointermove',entry.move);doc.addEventListener('pointerup',entry.up);doc.addEventListener('pointercancel',entry.cancel);doc.addEventListener('keydown',entry.key);win?.addEventListener('blur',entry.blur);this.move(event);return true;
  }catch(error){this.cancel();this.onStatus(error.message);return false;}
 }
 move(event,{schedule=true}={}){
  const entry=this.gesture;if(!entry||event.pointerId!==entry.pointerId)return false;
  try{if(!this.current(entry)){this.cancel();return false;}const point=this.point(event,entry);
   if(entry.mode==='scale')entry.steps=rackGraphScale(entry.before,entry.indices,entry.anchor.index,point.value);
   else if(entry.mode==='ramp')entry.steps=rackGraphRamp(entry.before,entry.indices,entry.anchor,point);
   else{const previous=entry.previous||point;for(let column=Math.min(previous.column,point.column);column<=Math.max(previous.column,point.column);column++){const amount=previous.column===point.column?1:(column-previous.column)/(point.column-previous.column);rackGraphSet(entry.steps,entry.indices[column],previous.value+(point.value-previous.value)*amount,{reset:entry.mode==='reset'});}}
   entry.previous=point;entry.error=null;for(const index of entry.indices)if(active(entry.before[index])&&entry.steps[index]===0)entry.error='Active zero-velocity steps are unavailable. Raise the velocity before finishing this edit.';
   if(schedule&&this.frame===null)this.frame=this.raf(()=>{this.frame=null;if(!this.current(entry)){this.cancel();return;}try{this.paint(entry.steps);this.onPreview(entry.error?null:this.packet(entry));this.status(entry.error||'Release to apply step velocity.');}catch(error){this.cancel();this.onStatus(error.message);}});return true;
  }catch(error){this.cancel();this.onStatus(error.message);return false;}
 }
 packet(entry){return{context:clone(entry.context),before:clone(entry.before),steps:clone(entry.steps),indices:[...entry.indices]};}
 cleanup(entry){if(this.frame!==null)this.caf(this.frame);this.frame=null;const doc=this.element.ownerDocument;doc.removeEventListener('pointermove',entry.move);doc.removeEventListener('pointerup',entry.up);doc.removeEventListener('pointercancel',entry.cancel);doc.removeEventListener('keydown',entry.key);doc.defaultView?.removeEventListener('blur',entry.blur);this.gesture=null;let failure=null;for(const callback of [()=>this.onInteraction(false),()=>this.onPreview(null)])try{callback();}catch(error){failure??=error;}return failure;}
 async finish(event){
  const entry=this.gesture;if(!entry||event.pointerId!==entry.pointerId)return false;if(!this.move(event,{schedule:false})||this.gesture!==entry)return false;
  const valid=this.current(entry),cleanupError=this.cleanup(entry);try{this.paint(this.getSteps(this.getContext()));}catch(error){this.status('Reload the current step data.');this.onStatus(error.message);return false;}if(cleanupError){this.onStatus(cleanupError.message);return false;}if(!valid||entry.error){this.status(entry.error||'The graph context changed.');return false;}if(same(entry.before,entry.steps)){this.status('');return false;}
  const packet=this.packet(entry);this.writing=true;try{if(this.destroyed||!this.isEditable()||!same(entry.context,this.getContext())||!same(entry.before,this.getSteps(entry.context)))throw new Error('The project, channel or step data changed.');const result=await this.commit(packet);if(result===false)throw new Error('The step edit was not applied.');if(!this.destroyed&&same(entry.context,this.getContext())){this.paint(this.getSteps(entry.context));this.status('');}return true;}
  catch(error){this.uncertain={context:clone(entry.context),before:clone(entry.before)};if(!this.destroyed)this.status(`${error.message} Reload the step data before trying again.`);this.onStatus(error.message);return false;}finally{this.writing=false;}
 }
 cancel(){const entry=this.gesture;if(!entry)return false;const error=this.cleanup(entry);if(!this.destroyed){try{this.paint(this.getSteps(this.getContext()));}catch{}this.status('');}if(error)this.onStatus(error.message);return true;}
 syncContext(){if(!this.gesture)return true;try{if(this.current())return true;}catch{}this.cancel();return false;}
 status(message){const node=this.element.querySelector('.rack-graph-status');if(node)node.textContent=message;}
 destroy(){this.cancel();this.destroyed=true;this.plot.removeEventListener('pointerdown',this.down);this.plot.removeEventListener('contextmenu',this.menu);this.element.replaceChildren();}
}
