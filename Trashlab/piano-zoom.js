import {PIANO_PITCH_COUNT} from './piano-geometry.js';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** Fit a content-space beat/row rectangle into the grid's visible area.
 * Scale is pixels per four beats. Row zero is pitch127's top edge. The caller
 * retains `before` for right-click view restore; no score data is accepted.
 */
export function fitPianoZoomRectangle({before,origin,end,gridWidth,gridHeight,contentBeats}={}){
 if(!before||!['scale','rowHeight','scrollLeft','scrollTop'].every(key=>finite(before[key]))||before.scale<=0||before.rowHeight<=0||before.scrollLeft<0||before.scrollTop<0)throw new RangeError('Piano zoom requires a finite current view.');
 if(!origin||!end||![origin.beat,origin.row,end.beat,end.row,gridWidth,gridHeight].every(finite)||gridWidth<=0||gridHeight<=0)throw new RangeError('Piano zoom requires finite content coordinates and a positive grid viewport.');
 if(contentBeats!==undefined&&(!finite(contentBeats)||contentBeats<0))throw new RangeError('Piano content length must be a finite nonnegative beat count.');
 const maxBeat=contentBeats??Infinity,left=clamp(Math.min(origin.beat,end.beat),0,maxBeat),right=clamp(Math.max(origin.beat,end.beat),0,maxBeat),top=clamp(Math.min(origin.row,end.row),0,PIANO_PITCH_COUNT),bottom=clamp(Math.max(origin.row,end.row),0,PIANO_PITCH_COUNT);
 if(right<=left||bottom<=top)return null;
 const scale=clamp(gridWidth*4/(right-left),40,896),rowHeight=clamp(gridHeight/(bottom-top),6,70);
 const maxLeft=contentBeats===undefined?Infinity:Math.max(0,contentBeats*scale/4-gridWidth),maxTop=Math.max(0,PIANO_PITCH_COUNT*rowHeight-gridHeight);
 return{scale,rowHeight,scrollLeft:clamp(left*scale/4,0,maxLeft),scrollTop:clamp(top*rowHeight,0,maxTop)};
}
