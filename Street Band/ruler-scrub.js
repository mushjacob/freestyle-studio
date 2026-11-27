/** FL ruler scrubbing: press on a ruler to place the song position, drag to scrub it.
 *  The visual marker updates on every move; the engine seek is coalesced (at most one in
 *  flight, ~50 ms apart) with a guaranteed final seek on release. Playback is never started
 *  or stopped here: a rolling transport simply continues from the new position. */
export class RulerScrub{
 constructor({ruler,beatAt,onMove,onSeek=()=>{},onEnd=()=>{},canStart=()=>true,interval=50,now=()=>performance.now(),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
  if(!ruler||typeof beatAt!=='function'||typeof onMove!=='function')throw new TypeError('Ruler scrub needs a ruler, a beat reader and a marker callback.');
  Object.assign(this,{ruler,beatAt,onMove,onSeek,onEnd,canStart,interval,now,setTimer,clearTimer});
  this.doc=ruler.ownerDocument||globalThis.document;this.active=null;this.timer=null;this.inflight=false;this.pending=null;this.lastSent=-Infinity;this.sent=null;this.ended=false;
  this.down=event=>{
   if(event.button!==0||event.ctrlKey||event.metaKey||this.active||!this.canStart(event))return;
   // No text selection / native drag while scrubbing.
   event.preventDefault?.();
   const beat=this.beatAt(event);if(!Number.isFinite(beat))return;
   this.active={pointerId:event.pointerId,beat};this.ended=false;this.pending=null;this.sent=null;
   try{ruler.setPointerCapture?.(event.pointerId);}catch{}
   this.doc.addEventListener('pointermove',this.move,true);this.doc.addEventListener('pointerup',this.up,true);this.doc.addEventListener('pointercancel',this.up,true);
   this.doc.defaultView?.addEventListener('blur',this.blur);
   this.onMove(beat,{phase:'start'});this.request(beat);
  };
  this.move=event=>{
   const a=this.active;if(!a||event.pointerId!==a.pointerId)return;
   event.preventDefault?.();const beat=this.beatAt(event);if(!Number.isFinite(beat)||beat===a.beat)return;
   a.beat=beat;this.onMove(beat,{phase:'move'});this.request(beat);
  };
  this.up=event=>{const a=this.active;if(!a||event.pointerId!==a.pointerId)return;if(event.type!=='pointercancel'){const beat=this.beatAt(event);if(Number.isFinite(beat))a.beat=beat;}this.finish(event.type==='pointercancel');};
  this.blur=()=>this.finish(false);
  this.select=event=>event.preventDefault?.();
  ruler.addEventListener('pointerdown',this.down);ruler.addEventListener('mousedown',this.select);ruler.addEventListener('selectstart',this.select);ruler.addEventListener('dragstart',this.select);
 }
 /** Coalesced seek request for the latest beat. */
 request(beat){
  if(this.inflight){this.pending=beat;return;}
  const wait=this.lastSent+this.interval-this.now();
  if(wait<=0){this.pending=null;this.send(beat);return;}
  this.pending=beat;if(this.timer===null)this.timer=this.setTimer(()=>{this.timer=null;if(this.pending!==null&&!this.inflight){const next=this.pending;this.pending=null;this.send(next);}},wait);
 }
 send(beat){
  this.inflight=true;this.lastSent=this.now();this.sent=beat;
  let result;try{result=this.onSeek(beat);}catch{result=null;}
  Promise.resolve(result).catch(()=>{}).then(()=>{
   this.inflight=false;
   if(this.pending!==null&&(this.active===null||this.timer===null)){const next=this.pending;this.pending=null;this.send(next);return;}
   if(!this.active)this.complete();
  });
 }
 finish(cancelled){
  const a=this.active;if(!a)return;this.active=null;
  this.doc.removeEventListener('pointermove',this.move,true);this.doc.removeEventListener('pointerup',this.up,true);this.doc.removeEventListener('pointercancel',this.up,true);this.doc.defaultView?.removeEventListener('blur',this.blur);
  try{if(this.ruler.hasPointerCapture?.(a.pointerId))this.ruler.releasePointerCapture(a.pointerId);}catch{}
  if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}
  // The marker already followed the pointer, so the engine always gets one final seek to the last position (also on cancel).
  if(this.sent!==a.beat)this.pending=a.beat;
  if(this.inflight)return;
  if(this.pending!==null){const next=this.pending;this.pending=null;this.send(next);return;}
  this.complete();
 }
 complete(){if(this.ended)return;this.ended=true;try{this.onEnd();}catch{}}
 destroy(){this.finish(true);const r=this.ruler;r.removeEventListener('pointerdown',this.down);r.removeEventListener('mousedown',this.select);r.removeEventListener('selectstart',this.select);r.removeEventListener('dragstart',this.select);if(this.timer!==null)this.clearTimer(this.timer);}
}
