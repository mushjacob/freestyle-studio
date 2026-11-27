/** FL-style magnetic window snapping and edge resizing (pure geometry, no DOM). */
export const SNAP_THRESHOLD=10;
export const RESIZE_EDGE=5;
export const RESIZE_CORNER=12;
const finite=value=>typeof value==='number'&&Number.isFinite(value);

/** Which resize zone a point (relative to the window's top-left) is in, or ''. */
export function resizeZone(x,y,width,height,{edge=RESIZE_EDGE,corner=RESIZE_CORNER}={}){
 if(!finite(x)||!finite(y)||x<0||y<0||x>width||y>height)return '';
 let w=x<edge,e=x>width-edge,n=y<edge,s=y>height-edge;
 // Corners: an edge band extends into a square corner handle.
 if(w||e){if(y<corner)n=true;else if(y>height-corner)s=true;}
 if(n||s){if(x<corner)w=true;else if(x>width-corner)e=true;}
 return `${n?'n':s?'s':''}${w?'w':e?'e':''}`;
}
export const resizeCursor=zone=>({n:'ns-resize',s:'ns-resize',e:'ew-resize',w:'ew-resize',ne:'nesw-resize',sw:'nesw-resize',nw:'nwse-resize',se:'nwse-resize'}[zone]||'');

const overlaps=(aStart,aEnd,bStart,bEnd,slack)=>aStart<=bEnd+slack&&bStart<=aEnd+slack;

/** Candidate vertical lines (x) and horizontal lines (y) a window edge may snap to. */
export function snapTargets({bounds,others=[],against}){
 const xs=[{at:0,from:0,to:bounds.height},{at:bounds.width,from:0,to:bounds.height}],ys=[{at:0,from:0,to:bounds.width},{at:bounds.height,from:0,to:bounds.width}];
 for(const o of others){
  if(!o||!finite(o.left)||!finite(o.top)||!finite(o.width)||!finite(o.height))continue;
  const right=o.left+o.width,bottom=o.top+o.height;
  xs.push({at:o.left,from:o.top,to:bottom},{at:right,from:o.top,to:bottom});
  ys.push({at:o.top,from:o.left,to:right},{at:bottom,from:o.left,to:right});
 }
 return {xs,ys,against};
}

function best(value,lines,threshold,rangeStart,rangeEnd){
 let delta=null,distance=threshold+1;
 for(const line of lines){
  // Only snap to a neighbour that is next to us along the other axis (FL magnetism is local).
  if(!overlaps(rangeStart,rangeEnd,line.from,line.to,threshold))continue;
  const d=line.at-value,abs=Math.abs(d);
  if(abs<distance){distance=abs;delta=d;}
 }
 return distance<=threshold?delta:null;
}

/** Snap a moving window: outer edges align with / abut other windows and the desktop. */
export function snapMove(rect,{bounds,others,threshold=SNAP_THRESHOLD}){
 const {xs,ys}=snapTargets({bounds,others}),right=rect.left+rect.width,bottom=rect.top+rect.height;
 const left=best(rect.left,xs,threshold,rect.top,bottom),rightD=best(right,xs,threshold,rect.top,bottom);
 const top=best(rect.top,ys,threshold,rect.left,right),bottomD=best(bottom,ys,threshold,rect.left,right);
 const dx=left===null?rightD:rightD===null?left:Math.abs(left)<=Math.abs(rightD)?left:rightD;
 const dy=top===null?bottomD:bottomD===null?top:Math.abs(top)<=Math.abs(bottomD)?top:bottomD;
 return {left:rect.left+(dx||0),top:rect.top+(dy||0),width:rect.width,height:rect.height,snappedX:dx!==null,snappedY:dy!==null};
}

/**
 * Resize from `zone` (n/s/e/w/ne/nw/se/sw). Only the dragged edges move and
 * only they snap. Min/max sizes are honoured, and the opposite edge stays put.
 */
export function resizeRect(start,{zone,dx,dy,min={width:120,height:80},max={width:Infinity,height:Infinity},bounds,others=[],threshold=SNAP_THRESHOLD,snap=true}){
 let left=start.left,top=start.top,right=start.left+start.width,bottom=start.top+start.height;
 const {xs,ys}=snapTargets({bounds,others});
 if(zone.includes('w'))left+=dx;if(zone.includes('e'))right+=dx;if(zone.includes('n'))top+=dy;if(zone.includes('s'))bottom+=dy;
 if(snap){
  if(zone.includes('w')){const d=best(left,xs,threshold,top,bottom);if(d!==null)left+=d;}
  if(zone.includes('e')){const d=best(right,xs,threshold,top,bottom);if(d!==null)right+=d;}
  if(zone.includes('n')){const d=best(top,ys,threshold,left,right);if(d!==null)top+=d;}
  if(zone.includes('s')){const d=best(bottom,ys,threshold,left,right);if(d!==null)bottom+=d;}
 }
 const clampSize=(a,b,fixedIsStart,lo,hi)=>{const size=Math.max(lo,Math.min(hi,b-a));return fixedIsStart?[a,a+size]:[b-size,b];};
 if(zone.includes('w')||zone.includes('e')){[left,right]=clampSize(left,right,!zone.includes('w'),min.width,max.width);}
 if(zone.includes('n')||zone.includes('s')){[top,bottom]=clampSize(top,bottom,!zone.includes('n'),min.height,max.height);}
 return {left,top,width:right-left,height:bottom-top};
}
