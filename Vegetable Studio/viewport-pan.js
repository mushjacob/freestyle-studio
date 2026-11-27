/** Middle-button drag pans a scroll viewport (FL: middle-drag scrolls the arrangement and piano roll).
 *  panDelta is pure. installMiddleDragPan wires DOM events only; it has no I/O. */
export function panDelta(start,current){
 return {x:(start?.x??0)-(current?.x??0),y:(start?.y??0)-(current?.y??0)};
}
/** Returns an uninstall function. Only button 1 (middle) starts a pan; other buttons pass through untouched. */
export function installMiddleDragPan(viewport,{onStart,onEnd}={}){
 if(!viewport)return()=>{};
 let drag=null;
 const move=event=>{
  if(!drag||event.pointerId!==drag.pointerId)return;
  const d=panDelta(drag.start,{x:event.clientX,y:event.clientY});
  viewport.scrollLeft=drag.left+d.x;
  viewport.scrollTop=drag.top+d.y;
  event.preventDefault?.();
 };
 const finish=event=>{
  if(!drag||(event&&event.pointerId!==drag.pointerId))return;
  const pointerId=drag.pointerId;
  drag=null;
  viewport.removeEventListener('pointermove',move);
  viewport.removeEventListener('pointerup',finish);
  viewport.removeEventListener('pointercancel',finish);
  try{viewport.releasePointerCapture?.(pointerId);}catch{}
  onEnd?.();
 };
 const down=event=>{
  if(event.button!==1)return;
  // Capture phase + stopPropagation: the editors' own pointerdown handlers (marquee, draw, clip drag)
  // stop propagation, so a bubbling listener never saw a middle press over a lane or a clip.
  event.preventDefault();event.stopPropagation?.();
  if(drag)finish();
  onStart?.();
  drag={pointerId:event.pointerId,start:{x:event.clientX,y:event.clientY},left:viewport.scrollLeft,top:viewport.scrollTop};
  try{viewport.setPointerCapture?.(event.pointerId);}catch{}
  viewport.addEventListener('pointermove',move);
  viewport.addEventListener('pointerup',finish);
  viewport.addEventListener('pointercancel',finish);
 };
 viewport.addEventListener('pointerdown',down,true);
 return()=>{viewport.removeEventListener('pointerdown',down,true);finish();};
}
