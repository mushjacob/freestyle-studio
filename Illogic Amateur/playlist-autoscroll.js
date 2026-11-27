import {PLAYLIST_GUTTER} from './playlist-geometry.js';
/** Scroll a captured playlist gesture at its visible grid edges, without editing data. */
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function edgeScrollVelocity(position,start,end,{edge=36,speed=720}={}){
 if(!Number.isFinite(position)||end<=start)return 0;
 const band=Math.min(edge,(end-start)/2);
 if(position<start+band)return-speed*clamp((start+band-position)/band,0,1);
 if(position>end-band)return speed*clamp((position-end+band)/band,0,1);
 return 0;
}
export class PlaylistAutoScroll{
 constructor({viewport,pointerId,getInsets=()=>({left:PLAYLIST_GUTTER,top:24}),onScroll=()=>{},isValid=()=>true,raf=fn=>globalThis.requestAnimationFrame(fn),caf=id=>globalThis.cancelAnimationFrame(id)}={}){
  Object.assign(this,{viewport,pointerId,getInsets,onScroll,isValid,raf,caf});this.frame=null;this.point=null;this.enabled=false;this.destroyed=false;this.lastAt=null;this.observed={left:viewport.scrollLeft,top:viewport.scrollTop};
  this.scroll=()=>{this.notify();this.schedule();};viewport.addEventListener('scroll',this.scroll,{passive:true});
 }
 update(event,{enabled=true}={}){
  if(this.destroyed||event?.pointerId!=null&&event.pointerId!==this.pointerId||!Number.isFinite(event?.clientX)||!Number.isFinite(event?.clientY))return;
  this.point={x:event.clientX,y:event.clientY};this.enabled=enabled;this.schedule();
 }
 velocity(){
  const v=this.viewport;if(!this.enabled||!this.point||!this.isValid())return{x:0,y:0};const rect=v.getBoundingClientRect(),insets=this.getInsets(),left=rect.left+(v.clientLeft||0),top=rect.top+(v.clientTop||0);
  const x=edgeScrollVelocity(this.point.x,left+(insets.left||0),left+v.clientWidth),y=edgeScrollVelocity(this.point.y,top+(insets.top||0),top+v.clientHeight);
  return{x:x<0?v.scrollLeft>0?x:0:v.scrollLeft<Math.max(0,v.scrollWidth-v.clientWidth)?x:0,y:y<0?v.scrollTop>0?y:0:v.scrollTop<Math.max(0,v.scrollHeight-v.clientHeight)?y:0};
 }
 schedule(){
  if(this.destroyed)return;const velocity=this.velocity();if(velocity.x||velocity.y){if(this.frame===null)this.frame=this.raf(at=>this.tick(at));}
  else{if(this.frame!==null)this.caf(this.frame);this.frame=null;this.lastAt=null;}
 }
 notify(){const next={left:this.viewport.scrollLeft,top:this.viewport.scrollTop};if(next.left===this.observed.left&&next.top===this.observed.top)return;const previous=this.observed;this.observed=next;this.onScroll({left:next.left,top:next.top,deltaX:next.left-previous.left,deltaY:next.top-previous.top});}
 tick(at){
  this.frame=null;if(this.destroyed)return;if(!this.isValid()){this.destroy();return;}const velocity=this.velocity(),elapsed=this.lastAt===null?1000/60:clamp(Number.isFinite(at-this.lastAt)?at-this.lastAt:1000/60,0,50);this.lastAt=at;
  const v=this.viewport;v.scrollLeft=clamp(v.scrollLeft+velocity.x*elapsed/1000,0,Math.max(0,v.scrollWidth-v.clientWidth));v.scrollTop=clamp(v.scrollTop+velocity.y*elapsed/1000,0,Math.max(0,v.scrollHeight-v.clientHeight));this.notify();this.schedule();
 }
 destroy(){if(this.destroyed)return;this.destroyed=true;if(this.frame!==null)this.caf(this.frame);this.frame=null;this.point=null;this.viewport.removeEventListener('scroll',this.scroll);}
}
