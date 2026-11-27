/** Channel level control: preview locally, commit once on final release. No DSP. */
import {setLastTweaked} from './knob-context-menu.js';
const clone=value=>value==null?value:structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>Array.isArray(value)?value.map(stable):record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const keys=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End']);
export function channelLevelText(value){return finite(value)&&value>=0?`${Number((value*100).toFixed(3))}%`:'Volume unknown';}
export class ChannelLevelKnob{
 constructor(button,{getValue,getScope,isEditable=()=>true,onCommit,onInteraction=()=>{},onStatus=()=>{},min=0,max=1.5,step=.01,reset=1,label=button?.getAttribute?.('aria-label')||'Channel volume'}={}){
  if(!button?.ownerDocument||typeof getValue!=='function'||typeof getScope!=='function'||typeof onCommit!=='function'||!finite(min)||min<0||!finite(max)||max<=min||!finite(step)||step<=0||step>max-min||!finite(reset)||reset<min||reset>max)throw TypeError('Channel level requires a button, value/scope readers, final callback and valid positive level bounds.');
  Object.assign(this,{button,getValue,getScope,isEditable,onCommit,onInteraction,onStatus,min,max,step,reset,label});this.document=button.ownerDocument;this.window=this.document.defaultView;this.listeners=[];this.gesture=null;this.pending=false;this.destroyed=false;
  try{this.renderScope=this.scope();this.renderValue=this.readValue();}catch{this.renderScope=null;this.renderValue=null;}
  button.type='button';button.setAttribute('role','slider');button.setAttribute('aria-label',label);button.setAttribute('aria-valuemin',String(min));button.setAttribute('aria-valuemax',String(max));button.setAttribute('aria-orientation','vertical');button.style.touchAction='none';
  const listen=(target,type,fn,options)=>{target?.addEventListener(type,fn,options);this.listeners.push(()=>target?.removeEventListener(type,fn,options));};
  listen(button,'pointerdown',event=>this.pointerDown(event));listen(button,'pointermove',event=>this.pointerMove(event));listen(button,'pointerup',event=>this.pointerUp(event));
  for(const type of ['pointercancel','lostpointercapture'])listen(button,type,event=>{if(this.gesture?.kind==='pointer'&&event.pointerId===this.gesture.pointerId)this.cancel();});
  listen(button,'keydown',event=>this.keyDown(event));listen(button,'keyup',event=>this.keyUp(event));listen(button,'dblclick',event=>this.doubleClick(event));listen(button,'blur',()=>this.cancel());listen(this.window,'blur',()=>this.cancel());listen(this.document,'keydown',event=>{if(event.key==='Escape'&&this.active){event.preventDefault();event.stopPropagation();this.cancel();}},true);listen(button,'click',event=>event.stopPropagation());this.sync();
 }
 get active(){return!!this.gesture;}
 scope(){const scope=clone(this.getScope());if(!record(scope)||!Object.keys(scope).length)throw Error('The channel project scope is unavailable.');return scope;}
 readValue(){const value=this.getValue();if(!finite(value)||value<this.min||value>this.max)throw Error('The channel volume is unavailable.');return value;}
 report(error){this.reportVersion=(this.reportVersion||0)+1;try{this.onStatus(error instanceof Error?error.message:String(error));}catch{}}
 editable(){try{return !this.destroyed&&!this.pending&&this.isEditable()===true;}catch{return false;}}
 connected(){return this.button.isConnected&&this.button.ownerDocument===this.document;}
 bound(){try{return this.connected()&&same(this.scope(),this.renderScope)&&this.readValue()===this.renderValue;}catch{return false;}}
 clamp(value){return Math.max(this.min,Math.min(this.max,value));}
 paint(value,{preview=false}={}){const known=finite(value)&&value>=this.min&&value<=this.max;this.button.dataset.preview=String(preview);this.button.setAttribute('aria-valuetext',channelLevelText(known?value:null));this.button.title=`${this.label} · ${channelLevelText(known?value:null)}`;if(known){this.button.setAttribute('aria-valuenow',String(value));this.button.style.setProperty('--rotation',`${(value-this.min)/(this.max-this.min)*260-130}deg`);}else{this.button.removeAttribute('aria-valuenow');this.button.style.removeProperty('--rotation');}if(preview)this.report(`${this.label} · ${channelLevelText(value)}`);}
 sync(){if(this.destroyed)return false;if(this.active){if(!this.valid()){this.cancel();return false;}return true;}this.button.disabled=!this.bound()||!this.editable();let value=null;try{value=this.readValue();}catch{}this.paint(value);return !this.button.disabled;}
 begin(kind,event){if(this.destroyed||this.active||this.pending||this.button.disabled||!this.bound()||!this.editable())return false;try{const before=this.readValue();this.gesture={kind,before,value:before,scope:this.scope(),keys:new Set(),pointerId:event?.pointerId,lastY:event?.clientY,delta:0};this.onInteraction(true);if(!this.valid()){this.cancel();return false;}return true;}catch(error){this.cancel();this.report(error);return false;}}
 valid(){const gesture=this.gesture;if(!gesture||this.button.disabled||!this.editable()||!this.connected())return false;try{return same(gesture.scope,this.scope())&&this.readValue()===gesture.before&&this.bound();}catch{return false;}}
 pointerDown(event){if(![0,1].includes(event.button)||event.isPrimary===false||event.pointerId==null||!finite(event.clientX)||!finite(event.clientY)||this.button.disabled)return;event.preventDefault();event.stopPropagation();this.button.focus();if(event.button===1||event.altKey){this.resetToDefault();return;}if(!this.begin('pointer',event))return;try{this.button.setPointerCapture?.(event.pointerId);}catch{}}
 sample(event){const gesture=this.gesture;if(!gesture||gesture.kind!=='pointer'||event.pointerId!==gesture.pointerId||!finite(event.clientX)||!finite(event.clientY))return false;if(!this.valid()){this.cancel();return false;}// Ctrl is a UI motion scale, not a claim about FL's parameter curve.
  gesture.delta+=(gesture.lastY-event.clientY)*(this.max-this.min)/150*(event.ctrlKey?.1:1);gesture.lastY=event.clientY;gesture.value=this.clamp(gesture.before+Math.round(gesture.delta/this.step)*this.step);this.paint(gesture.value,{preview:true});return true;}
 pointerMove(event){if(this.gesture?.kind!=='pointer'||event.pointerId!==this.gesture.pointerId)return;event.preventDefault();event.stopPropagation();this.sample(event);}
 pointerUp(event){if(this.gesture?.kind!=='pointer'||event.pointerId!==this.gesture.pointerId)return;event.preventDefault();event.stopPropagation();if(!finite(event.clientX)||!finite(event.clientY)){this.cancel();return;}if(this.sample(event))this.finish();}
 keyDown(event){if(!keys.has(event.key)||event.altKey||event.ctrlKey||event.metaKey||this.button.disabled)return;event.preventDefault();event.stopPropagation();if(!this.active&&!this.begin('keyboard'))return;if(this.gesture?.kind!=='keyboard')return;if(!this.valid()){this.cancel();return;}const gesture=this.gesture;gesture.keys.add(event.key);gesture.value=event.key==='Home'?this.min:event.key==='End'?this.max:this.clamp(gesture.value+(['ArrowLeft','ArrowDown'].includes(event.key)?-1:1)*this.step*(event.shiftKey?10:1));this.paint(gesture.value,{preview:true});}
 keyUp(event){if(!keys.has(event.key)||this.gesture?.kind!=='keyboard')return;event.preventDefault();event.stopPropagation();this.gesture.keys.delete(event.key);if(!this.gesture.keys.size)this.finish();}
 setValue(value){if(!finite(value)||value<this.min||value>this.max){this.report(`Enter a volume from ${this.min} to ${this.max}.`);return false;}const reportVersion=this.reportVersion||0;if(!this.begin('typed')){if((this.reportVersion||0)===reportVersion)this.report(this.pending||this.active?'Finish the current channel control change first.':'The channel control changed or is unavailable. Reopen it before editing.');return false;}this.gesture.value=value;this.paint(value,{preview:true});return this.finish();}
 resetToDefault(){return this.setValue(this.reset);}
 doubleClick(event){event.preventDefault();event.stopPropagation();return this.resetToDefault();}
 finish({cancel=false}={}){const gesture=this.gesture;if(!gesture)return null;cancel=cancel||!this.valid();this.gesture=null;try{if(gesture.kind==='pointer'&&this.button.hasPointerCapture?.(gesture.pointerId))this.button.releasePointerCapture(gesture.pointerId);}catch{}
  try{this.onInteraction(false);}catch(error){cancel=true;this.report(error);}try{if(!this.bound()||!same(gesture.scope,this.scope())||this.readValue()!==gesture.before||!this.editable())cancel=true;}catch{cancel=true;}
  const packet={before:gesture.before,value:gesture.value,scope:clone(gesture.scope)},changed=!cancel&&packet.value!==packet.before;this.sync();if(!changed)return{...packet,cancelled:cancel,changed:false};
  this.pending=true;this.button.disabled=true;this.button.setAttribute('aria-busy','true');try{setLastTweaked({kind:'channel-level',control:'volume',name:this.label,laneId:packet.scope.laneId??null,channelId:packet.scope.channelId??null});const result=this.onCommit(clone(packet));if(result&&typeof result.then==='function')Promise.resolve(result).catch(error=>this.report(error)).finally(()=>this.settled());else this.settled();}catch(error){this.report(error);this.settled();}return{...packet,cancelled:false,changed:true};
 }
 settled(){this.pending=false;this.button.removeAttribute('aria-busy');this.sync();}
 cancel(){return this.finish({cancel:true});}
 destroy(){if(this.destroyed)return;this.cancel();this.destroyed=true;for(const remove of this.listeners)remove();this.listeners=[];this.button.disabled=true;}
}
export function attachChannelLevelKnob(button,options){return new ChannelLevelKnob(button,options);}
