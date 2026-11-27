// Native Playlist header width shared by rendering, navigation and pointer insets.
export const PLAYLIST_GUTTER=100;
/** FL drop placement: a drop lands on the grid cell under the pointer (floor to
 * snap), never the nearest/next line. Shared by pattern, Browser-sample and OS
 * file drops. `left` is the client x of beat 0 for the hovered lane grid. */
export function playlistDropBeat({clientX,left,barWidth,snap=0}={}){
 const raw=(Number(clientX)-Number(left))/Number(barWidth)*4;if(!Number.isFinite(raw)||!(Number(barWidth)>0))return 0;
 const beat=Math.max(0,raw),grid=Number(snap);
 return Number.isFinite(grid)&&grid>0?Math.floor(beat/grid+1e-9)*grid:beat;
}
/** One shared drag hotspot for every Playlist drag source (pattern picker
 * tiles, Browser Patterns/samples, Rack channel names): the drag image's left
 * edge sits at the pointer, so the clip's start cell is the cell under the
 * pointer, exactly what playlistDropBeat places. Without this the browser
 * keeps the grab offset and the image's left edge reads one or more cells
 * earlier than the drop. Records the grab offset for drop diagnostics. */
let lastDragSource=null;
export function playlistDragSource(){return lastDragSource;}
export function installPlaylistDragHotspot(doc=globalThis.document,{mimes=[],sourceSelector='[draggable="true"],.pattern-tile,[data-library],.library-sound-row,.channel-name',describe=()=>null}={}){
 const wanted=new Set(mimes);
 const start=event=>{const transfer=event.dataTransfer,types=[...(transfer?.types||[])];const mime=types.find(type=>wanted.has(type));if(!mime){lastDragSource=null;return;}
  const element=event.target?.closest?.(sourceSelector)||event.target;const rect=element?.getBoundingClientRect?.();
  const grabX=rect&&Number.isFinite(event.clientX)?event.clientX-rect.left:null,grabY=rect&&Number.isFinite(event.clientY)?Math.max(0,Math.min(rect.height,event.clientY-rect.top)):0;
  let hotspot=false;try{if(rect&&typeof transfer.setDragImage==='function'){transfer.setDragImage(element,0,grabY);hotspot=true;}}catch{}
  lastDragSource={mime,source:describe(element,mime)||element?.className||element?.localName||'unknown',grabOffsetX:grabX==null?null:Math.round(grabX),hotspotAtLeftEdge:hotspot,startedAt:Date.now()};
 };
 doc.addEventListener('dragstart',start);return()=>doc.removeEventListener('dragstart',start);
}
/** Small JSON-safe record of a Playlist drop decision for client diagnostics. */
export function playlistDropRecord({source,clientX,left,barWidth,snap,track=null,laneId=null,createLane=false}={}){
 const raw=(Number(clientX)-Number(left))/Number(barWidth)*4,beat=playlistDropBeat({clientX,left,barWidth,snap}),drag=lastDragSource;
 const round=value=>Number.isFinite(value)?Math.round(value*1e6)/1e6:null;
 return{source,pointerX:round(Number(clientX)),gridLeft:round(Number(left)),pxPerBeat:round(Number(barWidth)/4),rawBeat:round(raw),snap:Number(snap)||0,snappedBeat:round(beat),track,laneId,createLane,drag:drag?{mime:drag.mime,source:drag.source,grabOffsetX:drag.grabOffsetX,hotspotAtLeftEdge:drag.hotspotAtLeftEdge}:null};
}
/** Clip rendering: a clip at `start` beats is absolutely positioned inside its
 * lane grid at left = start/4 * barWidth from the grid's padding edge. */
export function playlistClipLeft(start,barWidth){return Number(start)/4*Number(barWidth);}
/** Client x of beat 0 for a lane grid: the containing-block origin its clips
 * use (border-box left + left border), i.e. the exact inverse of clip layout. */
export function playlistGridOrigin(grid){const rect=grid?.getBoundingClientRect?.();if(!rect)return null;return rect.left+(Number(grid.clientLeft)||0);}
/** Geometry probe for diagnostics: compares the grid origin with the ruler's
 * bar-1 line and with where an existing clip actually rendered. */
export function playlistGeometryProbe({grid,ruler,barWidth,clip}={}){
 const round=value=>Number.isFinite(value)?Math.round(value*100)/100:null,origin=playlistGridOrigin(grid),rect=grid?.getBoundingClientRect?.();
 const bar1=ruler?.querySelector?.('.ruler-bar')?.getBoundingClientRect?.()?.left;
 let clipDelta=null;const clipOrigin=clip?.grid?playlistGridOrigin(clip.grid):origin;if(clip?.element&&Number.isFinite(clip.start)&&clipOrigin!=null){clipDelta=round(clip.element.getBoundingClientRect().left-(clipOrigin+playlistClipLeft(clip.start,barWidth)));}
 return{gridRectLeft:round(rect?.left),gridClientLeft:Number(grid?.clientLeft)||0,gridOrigin:round(origin),rulerBar1Left:round(bar1),rulerMinusGrid:round(Number.isFinite(bar1)&&origin!=null?bar1-origin:NaN),clipRenderedMinusFormula:clipDelta};
}
