import {attachChannelLevelKnob} from './channel-level-knob.js';

/** FL's toolbar listening level is independent of the saved Mixer master. */
export function mountMonitorVolumeControl(button,{monitor,onStatus=()=>{}}={}){
 if(!monitor||typeof monitor.setVolume!=='function'||typeof monitor.addEventListener!=='function'||typeof monitor.removeEventListener!=='function')throw new TypeError('Monitor volume requires a CloudMonitor.');
 let knob=null,destroyed=false,rebindQueued=false;
 const previousDescription=button.getAttribute('aria-description');
 button.setAttribute('aria-description','Local listening volume only. Does not change the mixer master or exported audio.');
 const bind=()=>{
  if(destroyed)return;
  knob?.destroy();
  knob=attachChannelLevelKnob(button,{
   getValue:()=>monitor.volume,getScope:()=>({kind:'monitor'}),isEditable:()=>!destroyed,
   min:0,max:1,step:.01,reset:1,label:'Monitor volume',onStatus,
   onCommit:({value})=>monitor.setVolume(value),
  });
 };
 const changed=()=>{
  if(destroyed)return;
  // An external level change invalidates a drag immediately. Rebinding waits
  // until an in-progress final-release callback has finished using its knob.
  knob?.cancel();
  if(rebindQueued)return;
  rebindQueued=true;
  queueMicrotask(()=>{rebindQueued=false;bind();});
 };
 bind();monitor.addEventListener('volume',changed);
 return function destroy(){
  if(destroyed)return;
  destroyed=true;monitor.removeEventListener('volume',changed);knob?.destroy();knob=null;
  if(previousDescription===null)button.removeAttribute('aria-description');else button.setAttribute('aria-description',previousDescription);
 };
}
