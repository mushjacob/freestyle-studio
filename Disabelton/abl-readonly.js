/**
 * Read-only live session (release 2026-11-14 monitor states).
 *
 * sendMonitorOffer answers peerGrant=read when the account has no daw:write / editor role on
 * the project, and a transport_ack / editor refusal reports project_control_forbidden when the
 * grant was revoked (OAuth revoked, role removed). Both are the same `readonly` state on
 * CloudMonitor (`monitor.readOnly`). Play / transport writes, MIDI note input and plug-in editor
 * input all need that write role on REST as well (OpenAPI: editor + daw:write), so the UI says
 * so once, in the control bar, and disables those controls with the reason (Live-like: an
 * unavailable control is greyed with a tooltip), instead of letting every press fail.
 * Audio, clock, meters and editor frames keep working (they are read access).
 */
export const READ_ONLY_REASONS=Object.freeze({
 peer_grant_read:'Read-only: Freestyle gave this session listen-only access (no edit permission on this project). Playback control, MIDI input and plug-in input are disabled.',
 project_control_forbidden:'Read-only: Freestyle refused live control for this session (access was revoked or the editor role removed). Playback control, MIDI input and plug-in input are disabled.',
});
/** The reason text for a monitor, or null when it can take input. */
export function readOnlyReason(monitor){
 if(!monitor||monitor.readOnly!==true)return null;
 if(monitor.controlForbidden)return READ_ONLY_REASONS.project_control_forbidden;
 return READ_ONLY_REASONS.peer_grant_read;
}
/** Control-bar indicator + disabled controls. `controls()` → the elements to disable
 * (transport / record / MIDI). Restores each element's own title and disabled state on clear.
 * `repaint` re-applies after the app's own painters (they set disabled/title themselves). */
export class AblReadOnlyIndicator{
 constructor({monitor,document:doc=globalThis.document,host=()=>doc?.querySelector?.('.abl-transport'),controls=()=>[],onChange=()=>{}}={}){
  Object.assign(this,{monitor,document:doc,host,controls,onChange});this.reason=null;this.saved=new Map();this.badge=null;
  this.listener=()=>this.update();
  for(const type of ['readonly','grant'])monitor?.addEventListener?.(type,this.listener);
  this.update();
 }
 get active(){return !!this.reason;}
 update(){
  const next=readOnlyReason(this.monitor),changed=next!==this.reason;this.reason=next;this.paint();
  if(changed){try{this.onChange(next);}catch{}}
  return next;
 }
 paint(){
  const doc=this.document;if(!doc)return;
  if(this.reason){
   if(!this.badge){const host=this.host();if(host){const badge=doc.createElement('span');badge.id='abl-readonly';badge.className='abl-readonly';badge.setAttribute('role','status');badge.textContent='Read-only';host.append?.(badge);this.badge=badge;}}
   if(this.badge){this.badge.title=this.reason;this.badge.setAttribute('aria-label',this.reason);}
   for(const element of this.controls()){if(!element)continue;if(!this.saved.has(element))this.saved.set(element,{title:element.getAttribute('title'),disabled:!!element.disabled});element.disabled=true;element.title=this.reason;element.setAttribute('aria-disabled','true');element.dataset.readOnly='1';}
  }else{
   this.badge?.remove?.();this.badge=null;
   for(const [element,state] of this.saved){element.disabled=state.disabled;if(state.title==null)element.removeAttribute('title');else element.title=state.title;element.removeAttribute('aria-disabled');delete element.dataset.readOnly;}
   this.saved.clear();
  }
 }
 /** Re-apply after the app's own painters touched the controls. */
 repaint(){if(this.reason)this.paint();}
 dispose(){for(const type of ['readonly','grant'])this.monitor?.removeEventListener?.(type,this.listener);}
}
