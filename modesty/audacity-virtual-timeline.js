/** Logical time coordinates are independent of the browser's bounded scrollbar. */
export const MAX_SCROLL_PIXELS=1000000;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function timeToViewportX(seconds,leftSec,scale){return (seconds-leftSec)*scale;}
export function viewportXToTime(x,leftSec,scale){return leftSec+x/scale;}

/** contentWidth excludes the sticky track-header gutter. Keep the complete
 * visible interval reachable even when following playback beyond project end. */
export function virtualScrollGeometry({duration=0,leftSec=0,scale,width,maxPixels=MAX_SCROLL_PIXELS}={}){
 if(![duration,leftSec,scale,width,maxPixels].every(finite)||duration<0||leftSec<0||scale<=0||width<=0||maxPixels<=0)throw new RangeError('Virtual timeline dimensions must be finite and positive.');
 const visibleSec=width/scale,totalSec=Math.max(duration,leftSec+visibleSec),maxLeftSec=Math.max(0,totalSec-visibleSec);
 const contentWidth=Math.max(width,Math.min(maxPixels,totalSec*scale)),maxScrollPx=Math.max(0,contentWidth-width);
 const geometry={contentWidth,maxScrollPx,maxLeftSec,visibleSec,totalSec};
 return {...geometry,scrollLeft:timeToScrollPixel(leftSec,geometry)};
}
export function timeToScrollPixel(seconds,{maxScrollPx,maxLeftSec}){return maxLeftSec>0?clamp(seconds,0,maxLeftSec)/maxLeftSec*maxScrollPx:0;}
export function scrollPixelToTime(pixel,{maxScrollPx,maxLeftSec}){return maxScrollPx>0?clamp(pixel,0,maxScrollPx)/maxScrollPx*maxLeftSec:0;}

/** Native page/pinned policy, rounding only viewport-local differences.
 * A late project can have trillions of logical pixels; never subtract two
 * already-rounded absolute pixel positions. No transport action is emitted. */
export function logicalPlaybackScroll({seconds,clockAvailable=false,playing=false,paused=false,recording=false,leftSec,viewportWidth,pixelsPerSecond,autoScroll=true,continuousScrolling=false,pinnedFraction=.5}={}){
 const mode=continuousScrolling?'pinned':autoScroll?'page':'off';
 const unchanged=reason=>({leftSec:null,changed:false,mode,reason});
 if(!(playing||paused||recording))return unchanged('inactive');
 if(!clockAvailable||!finite(seconds)||seconds<0)return unchanged('clock-unavailable');
 if(!finite(leftSec)||leftSec<0||!finite(viewportWidth)||viewportWidth<1||!finite(pixelsPerSecond)||pixelsPerSecond<=0)return unchanged('invalid-viewport');
 const width=Math.floor(viewportWidth),pixel=timeToViewportX(seconds,leftSec,pixelsPerSecond);
 let next,reason;
 if(continuousScrolling){
  const fraction=finite(pinnedFraction)?clamp(pinnedFraction,0,1):.5;
  const delta=Math.trunc(Math.floor(.5+pixel)-width*fraction);
  next=Math.max(0,leftSec+delta/pixelsPerSecond);reason='pinned';
 }else{
  if(!autoScroll)return unchanged('disabled');
  if(paused)return unchanged('paused');
  if(pixel>=0&&pixel<width)return unchanged('visible');
  const backwards=pixel<0;
  next=Math.max(0,leftSec+(Math.floor(.5+pixel)-(backwards?width:0))/pixelsPerSecond);
  reason=backwards?'page-backward':'page-forward';
 }
 if(next===leftSec)return unchanged('unchanged');
 return {leftSec:next,changed:true,mode,reason};
}
