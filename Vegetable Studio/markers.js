/** FL Playlist time + loop markers (audit L09 / P36). Pure: no DOM, no I/O.
 *
 * Freestyle stores one revisioned list per project (`getMarkers` / `setMarkers`).
 * Ticks are 96 PPQ (the timing map's timebase), so a marker keeps its musical
 * position when the tempo changes. A `loop` marker is FL's Start loop / End loop
 * pair: `tick` is the start flag, `end_tick` the end flag. Time-signature changes
 * are NOT stored here; they live in the timing map's meter list.
 */
export const MARKER_PPQ=96,MARKER_BAR_TICKS=384,MARKER_MAX=512,MARKER_NAME_MAX=64,MARKER_MAX_TICK=96*4*100000;
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const isTick=value=>Number.isInteger(value)&&value>=0&&value<=MARKER_MAX_TICK;
const byTick=(a,b)=>a.tick-b.tick||(a.id<b.id?-1:a.id>b.id?1:0);
const fail=(message,code='markers_invalid')=>Object.assign(new Error(message),{code});
export const beatToTick=beat=>Math.max(0,Math.round(Number(beat)*MARKER_PPQ)||0);
export const tickToBeat=tick=>Number(tick)/MARKER_PPQ;
/** Snap a beat position to `snapBeats` (0 = free) and convert to a tick. */
export const snapBeatToTick=(beat,snapBeats=0)=>beatToTick(snapBeats>0?Math.round(Number(beat)/snapBeats)*snapBeats:beat);
export function newMarkerId(random=()=>Math.random()){let id='';while(id.length<12)id+=Math.floor(random()*36).toString(36);return 'm'+id;}

/** Keep only well-formed markers (never throws), sorted by tick. Unknown fields are kept. */
export function normalizeMarkers(list){
 if(!Array.isArray(list))return[];
 const seen=new Set(),out=[];
 for(const item of list){
  if(!record(item)||typeof item.id!=='string'||!item.id||seen.has(item.id)||!isTick(item.tick))continue;
  const kind=item.kind==='loop'?'loop':'marker';
  if(kind==='loop'&&!(isTick(item.end_tick)&&item.end_tick>item.tick))continue;
  seen.add(item.id);out.push({...item,kind,name:typeof item.name==='string'?item.name.slice(0,MARKER_NAME_MAX):''});
 }
 return out.sort(byTick);
}
const loopOf=list=>list.find(marker=>marker.kind==='loop')||null;
export const loopMarker=loopOf;
export const timeMarkers=list=>list.filter(marker=>marker.kind==='marker');
function assertRoom(list){if(list.length>=MARKER_MAX)throw fail(`A project holds at most ${MARKER_MAX} markers.`,'markers_full');}
const cleanName=name=>String(name??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,MARKER_NAME_MAX);

/** Add a time marker (FL Alt+T). A blank name becomes "Marker N". Returns {markers,marker}. */
export function addMarker(list,{tick,name='',id=newMarkerId(),color}={}){
 if(!isTick(tick))throw fail('Choose a marker position at or after the start.');
 const current=normalizeMarkers(list);assertRoom(current);if(current.some(marker=>marker.id===id))throw fail('That marker id already exists.');
 const used=new Set(current.map(marker=>marker.name));let n=timeMarkers(current).length+1;while(used.has(`Marker ${n}`))n++;
 const marker={id,tick,kind:'marker',name:cleanName(name)||`Marker ${n}`,...color?{color}:{}};
 return{markers:[...current,marker].sort(byTick),marker};
}
const replace=(list,id,change)=>{
 const current=normalizeMarkers(list),index=current.findIndex(marker=>marker.id===id);if(index<0)throw fail('That marker no longer exists.','marker_missing');
 const next={...current[index],...change(current[index])};current[index]=next;return current.sort(byTick);
};
export function renameMarker(list,id,name){return replace(list,id,()=>({name:cleanName(name)}));}
export function recolorMarker(list,id,color){return replace(list,id,()=>({color}));}
/** Move a marker (a loop marker keeps its length). */
export function moveMarker(list,id,tick){
 if(!isTick(tick))throw fail('Choose a marker position at or after the start.');
 return replace(list,id,marker=>marker.kind==='loop'?{tick,end_tick:tick+(marker.end_tick-marker.tick)}:{tick});
}
/** Move one flag of the loop pair: which = 'start' | 'end'. The other flag stays; the range never inverts. */
export function moveLoopFlag(list,id,which,tick){
 return replace(list,id,marker=>{
  if(marker.kind!=='loop')throw fail('Only a loop marker has start and end flags.');
  if(which==='start')return{tick:Math.min(tick,marker.end_tick-1)};
  return{end_tick:Math.max(tick,marker.tick+1)};
 });
}
export function deleteMarker(list,id){
 const current=normalizeMarkers(list);if(!current.some(marker=>marker.id===id))throw fail('That marker no longer exists.','marker_missing');
 return current.filter(marker=>marker.id!==id);
}
/** FL "Start loop" at tick: one loop marker per project; the end is kept when still after the start, else one bar later. */
export function setLoopStart(list,tick,{id=newMarkerId()}={}){
 if(!isTick(tick))throw fail('Choose a loop position at or after the start.');
 const current=normalizeMarkers(list),loop=loopOf(current);
 if(!loop){assertRoom(current);return[...current,{id,tick,kind:'loop',name:'Loop',end_tick:tick+MARKER_BAR_TICKS}].sort(byTick);}
 return replace(current,loop.id,marker=>({tick,end_tick:marker.end_tick>tick?marker.end_tick:tick+MARKER_BAR_TICKS}));
}
/** FL "End loop" at tick: the start is kept when still before the end, else one bar earlier (never before 0). */
export function setLoopEnd(list,tick,{id=newMarkerId()}={}){
 if(!isTick(tick)||tick<1)throw fail('Choose a loop end after the start of the song.');
 const current=normalizeMarkers(list),loop=loopOf(current);
 if(!loop){assertRoom(current);return[...current,{id,tick:Math.max(0,tick-MARKER_BAR_TICKS),kind:'loop',name:'Loop',end_tick:tick}].sort(byTick);}
 return replace(current,loop.id,marker=>({end_tick:tick,tick:marker.tick<tick?marker.tick:Math.max(0,tick-MARKER_BAR_TICKS)}));
}
/** The loop marker as the Playlist loop range in beats (what PlaylistLoopRegion.apply takes). */
export function loopRangeBeats(marker){return marker&&marker.kind==='loop'?{enabled:true,startBeat:tickToBeat(marker.tick),endBeat:tickToBeat(marker.end_tick)}:null;}

/** Marker stops for Ctrl+Alt+Left/Right: every time marker plus a loop marker's two flags. */
export function markerStops(list){
 const ticks=new Set();for(const marker of normalizeMarkers(list)){ticks.add(marker.tick);if(marker.kind==='loop')ticks.add(marker.end_tick);}
 return[...ticks].sort((a,b)=>a-b);
}
/** The next (direction 1) or previous (-1) stop strictly beyond `tick`, or null. A half-tick margin absorbs float positions. */
export function jumpTarget(list,tick,direction){
 const stops=markerStops(list),margin=.5;
 if(direction<0){for(let i=stops.length-1;i>=0;i--)if(stops[i]<tick-margin)return stops[i];return null;}
 return stops.find(stop=>stop>tick+margin)??null;
}
export const sameMarkers=(a,b)=>JSON.stringify(normalizeMarkers(a))===JSON.stringify(normalizeMarkers(b));

/** Retained Undo/Redo for marker edits: each entry holds the whole list before and after. An
 * entry only applies while the saved list still equals what the entry recorded, so an edit made
 * by another editor is never overwritten silently. */
export class MarkersHistory{
 constructor({limit=100}={}){this.limit=limit;this.entries=[];this.cursor=0;this.busy=false;}
 record({projectId,before,after,label}){
  if(sameMarkers(before,after))return null;
  const entry={projectId,before:normalizeMarkers(before),after:normalizeMarkers(after),label:String(label||'Edit markers')};
  this.entries.length=this.cursor;this.entries.push(entry);if(this.entries.length>this.limit)this.entries.shift();this.cursor=this.entries.length;return entry;
 }
 forget(){this.entries=[];this.cursor=0;}
 canUndo(projectId){return this.cursor>0&&this.entries[this.cursor-1].projectId===projectId;}
 canRedo(projectId){return this.cursor<this.entries.length&&this.entries[this.cursor].projectId===projectId;}
 /** Apply one step through `write(list)` after checking `current()` still equals the entry's expected side. */
 async step(direction,{projectId,current,write}){
  const redo=direction==='redo';if(!(redo?this.canRedo(projectId):this.canUndo(projectId)))return null;
  const entry=this.entries[redo?this.cursor:this.cursor-1];
  if(!sameMarkers(current(),redo?entry.before:entry.after))throw fail('The markers changed elsewhere, so this step can no longer be applied.','markers_changed_elsewhere');
  this.busy=true;try{await write(redo?entry.after:entry.before);}finally{this.busy=false;}
  this.cursor+=redo?1:-1;return entry;
 }
}
