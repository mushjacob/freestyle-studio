/**
 * Region waveforms on canvases painted from the WaveformPyramid peak cache.
 *
 * A region's canvas covers only the part of the region inside the scroll
 * viewport (plus a margin) and is repainted synchronously from cached peaks on
 * every scroll, zoom, drag and trim. Nothing here fetches or clears: the pyramid
 * loads finer tiles in the background and calls back to repaint.
 * This module only draws Freestyle's peak buckets; it never decodes or plays audio.
 */
export const WAVE_CANVAS_MARGIN=96;
export const WAVE_CANVAS_MAX=8192;

/** The part of a region [clipLeft, clipLeft+clipWidth) inside the viewport, in region-local CSS px. */
export function visibleWaveWindow({clipLeft,clipWidth,viewLeft,viewRight,margin=WAVE_CANVAS_MARGIN,maxWidth=WAVE_CANVAS_MAX}){
 if(![clipLeft,clipWidth,viewLeft,viewRight].every(Number.isFinite)||!(clipWidth>0)||!(viewRight>viewLeft))return null;
 const from=Math.max(0,viewLeft-margin-clipLeft),to=Math.min(clipWidth,viewRight+margin-clipLeft);
 if(!(to>from))return null;
 const x=Math.floor(from),width=Math.min(maxWidth,Math.ceil(to)-x);
 return width>0?{x,width}:null;
}

/** Source seconds shown by the window [x, x+width) of a region drawn `clipWidth` px wide. */
export function waveSourceRange({offsetBeats=0,lengthBeats,bpm,x,width,clipWidth}){
 const tempo=Number(bpm)>0?Number(bpm):120,secondsPerBeat=60/tempo,length=Number(lengthBeats);
 if(!(length>0)||!(clipWidth>0)||!(width>0))return null;
 const secondsPerPixel=length*secondsPerBeat/clipWidth,offset=Math.max(0,Number(offsetBeats)||0)*secondsPerBeat;
 return{startSec:offset+x*secondsPerPixel,endSec:offset+(x+width)*secondsPerPixel,secondsPerPixel};
}

/** A stable description of one paint; equal keys draw identical pixels. */
export function wavePaintKey({clipId,x,width,height,dpr,startSec,endSec,gain,version,color}){
 return [clipId,x,width,height,dpr,Math.round(startSec*1e6),Math.round(endSec*1e6),Math.round((gain??1)*1e4),version,color].join('|');
}

/**
 * Paint one region's canvas. `region`: {clipId, offsetBeats, lengthBeats, gain}.
 * `geometry`: {clipLeft, clipWidth, viewLeft, viewRight, height} in CSS px on one axis
 * (any shared origin). Returns the pyramid status ('empty' | 'coarse' | 'exact' | 'hidden' | 'same').
 */
export function paintRegionCanvas(canvas,pyramid,region,geometry,{bpm=120,dpr=1,color='#0d2d5c',rmsColor=null,version=0,mono=false}={}){
 const window=visibleWaveWindow(geometry);
 if(!window||!(geometry.height>0)){if(canvas.dataset.waveKey!=='hidden'){canvas.dataset.waveKey='hidden';canvas.style.display='none';}return'hidden';}
 const range=waveSourceRange({offsetBeats:region.offsetBeats,lengthBeats:region.lengthBeats,bpm,x:window.x,width:window.width,clipWidth:geometry.clipWidth});
 if(!range)return'hidden';
 const height=Math.max(1,Math.round(geometry.height)),ratio=Math.max(1,Math.min(3,dpr||1));
 const key=wavePaintKey({clipId:region.clipId,x:window.x,width:window.width,height,dpr:ratio,startSec:range.startSec,endSec:range.endSec,gain:region.gain,version,color});
 if(canvas.dataset.waveKey===key)return'same';
 const pixelWidth=Math.round(window.width*ratio),pixelHeight=Math.round(height*ratio);
 const context=canvas.getContext('2d');if(!context)return'hidden';
 // Nothing cached yet: leave whatever is drawn (never blank a waveform for a pending read).
 if(!pyramid.has(region.clipId)){pyramid.prefetch(region.clipId);canvas.dataset.waveStatus='empty';return'empty';}
 if(canvas.width!==pixelWidth)canvas.width=pixelWidth;if(canvas.height!==pixelHeight)canvas.height=pixelHeight;
 const style=canvas.style;if(style.display==='none')style.display='';
 const left=`${window.x}px`,cssWidth=`${window.width}px`;if(style.left!==left)style.left=left;if(style.width!==cssWidth)style.width=cssWidth;
 context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,window.width,height);
 const result=pyramid.paint(context,region.clipId,{x:0,y:0,width:window.width,height,startSec:range.startSec,endSec:range.endSec,gain:region.gain??1,color,rmsColor,mono});
 canvas.dataset.waveKey=key;canvas.dataset.waveStatus=result.status;
 return result.status;
}
