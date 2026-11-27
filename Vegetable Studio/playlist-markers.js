/** DOM for FL time + loop markers on the Playlist ruler (editable) and the Piano roll ruler
 * (read-only). Positions come from `markers.js`; saving goes through the injected controller. */
import {addMarker,beatToTick,deleteMarker,loopRangeBeats,moveLoopFlag,moveMarker,renameMarker,setLoopEnd,setLoopStart,snapBeatToTick,tickToBeat} from './markers.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const px=(tick,scale)=>tickToBeat(tick)/4*scale;
const barText=tick=>{const beat=tickToBeat(tick),bar=Math.floor(beat/4)+1,rest=beat%4;return rest?`${bar}.${Number((rest+1).toFixed(3))}`:String(bar);};

/** Paint markers into `ruler` as one overlay (re-created on every call; safe after the ruler's own innerHTML is replaced). */
export function paintMarkers(ruler,{markers=[],scale=30,readOnly=false}={}){
 const doc=ruler.ownerDocument;let layer=ruler.querySelector(':scope > .ruler-markers');
 if(!layer){layer=doc.createElement('div');layer.className='ruler-markers';ruler.append(layer);}
 layer.classList.toggle('read-only',!!readOnly);
 const parts=[];
 for(const marker of markers){
  if(marker.kind==='loop'){
   parts.push(`<div class="marker-loop-band" style="left:${px(marker.tick,scale)}px;width:${Math.max(0,px(marker.end_tick,scale)-px(marker.tick,scale))}px"></div>`);
   parts.push(`<div class="marker-flag loop-start" data-marker-id="${esc(marker.id)}" data-flag="start" data-tick="${marker.tick}" style="left:${px(marker.tick,scale)}px" title="${esc(`Start loop (bar ${barText(marker.tick)})`)}"><span>Start loop</span></div>`);
   parts.push(`<div class="marker-flag loop-end" data-marker-id="${esc(marker.id)}" data-flag="end" data-tick="${marker.end_tick}" style="left:${px(marker.end_tick,scale)}px" title="${esc(`End loop (bar ${barText(marker.end_tick)})`)}"><span>End loop</span></div>`);
  }else parts.push(`<div class="marker-flag" data-marker-id="${esc(marker.id)}" data-flag="time" data-tick="${marker.tick}" style="left:${px(marker.tick,scale)}px${marker.color?`;--marker-color:${esc(marker.color)}`:''}" title="${esc(`${marker.name||'Marker'} (bar ${barText(marker.tick)})`)}"><span>${esc(marker.name)}</span></div>`);
 }
 layer.innerHTML=parts.join('');return layer;
}

/** Editable Playlist-ruler markers: add, drag, rename, delete, jump, loop. */
export class PlaylistMarkerEditor{
 constructor({ruler,viewport,store,getScale,getSnap=()=>0,canEdit=()=>true,seek=()=>{},applyLoop=async()=>{},showMenu=()=>{},askName=()=>{},toast=()=>{},onError=()=>{},onChange=()=>{}}){
  Object.assign(this,{ruler,viewport,store,getScale,getSnap,canEdit,seek,applyLoop,showMenu,askName,toast,onError,onChange});this.drag=null;
  this.down=event=>{
   const flag=event.target.closest?.('.marker-flag');if(!flag||!ruler.contains(flag))return;
   event.stopPropagation();if(event.button!==0)return;event.preventDefault();
   const rect=ruler.getBoundingClientRect();
   this.drag={pointerId:event.pointerId,flag,id:flag.dataset.markerId,which:flag.dataset.flag,x:event.clientX,left:rect.left,scroll:viewport.scrollLeft,start:Number(flag.dataset.tick),moved:false,tick:Number(flag.dataset.tick)};
   try{flag.setPointerCapture?.(event.pointerId);}catch{}flag.classList.add('dragging');
  };
  this.move=event=>{
   const d=this.drag;if(!d||event.pointerId!==d.pointerId)return;
   if(Math.abs(event.clientX-d.x)>3)d.moved=true;if(!d.moved)return;
   const beat=Math.max(0,(event.clientX-d.left+viewport.scrollLeft-d.scroll)/this.getScale()*4);
   d.tick=snapBeatToTick(beat,event.altKey?0:Number(this.getSnap())||0);d.flag.style.left=`${px(d.tick,this.getScale())}px`;
  };
  this.up=event=>{
   const d=this.drag;if(!d||event.pointerId!==d.pointerId)return;this.drag=null;d.flag.classList.remove('dragging');
   try{if(d.flag.hasPointerCapture?.(d.pointerId))d.flag.releasePointerCapture(d.pointerId);}catch{}
   if(event.type==='pointercancel'){this.render();return;}
   if(!d.moved){this.click(d.id,d.which).catch(this.onError);return;}
   if(d.tick===d.start){this.render();return;}
   this.edit(list=>d.which==='time'?moveMarker(list,d.id,d.tick):d.which==='start'||d.which==='end'?moveLoopFlag(list,d.id,d.which,d.tick):list,'Move marker');
  };
  this.dblclick=event=>{const flag=event.target.closest?.('.marker-flag');if(!flag||flag.dataset.flag!=='time')return;event.preventDefault();event.stopPropagation();this.rename(flag.dataset.markerId);};
  this.context=event=>{const flag=event.target.closest?.('.marker-flag');if(!flag||!ruler.contains(flag))return;event.preventDefault();event.stopPropagation();this.flagMenu(event,flag.dataset.markerId,flag.dataset.flag);};
  ruler.addEventListener('pointerdown',this.down,true);ruler.addEventListener('dblclick',this.dblclick,true);ruler.addEventListener('contextmenu',this.context,true);
  ruler.addEventListener('pointermove',this.move);ruler.addEventListener('pointerup',this.up);ruler.addEventListener('pointercancel',this.up);
 }
 list(){return this.store.markers;}
 render(){if(this.store.ready)paintMarkers(this.ruler,{markers:this.list(),scale:this.getScale()});else this.ruler.querySelector(':scope > .ruler-markers')?.remove();}
 /** Run a pure list edit, save it, repaint. Errors are reported, never thrown to the gesture. */
 async edit(change,label){
  if(!this.canEdit()){this.render();return false;}
  try{await this.store.write(change(this.list()),{label});this.render();this.onChange();return true;}
  catch(error){this.render();this.onError(error);return false;}
 }
 /** FL Alt+T / ruler menu: a marker at `beat` (default the current position). */
 add(beat,name=''){const tick=snapBeatToTick(beat,Number(this.getSnap())||0);return this.edit(list=>addMarker(list,{tick,name}).markers,'Add marker');}
 setLoopStart(beat){const tick=snapBeatToTick(beat,Number(this.getSnap())||0);return this.edit(list=>setLoopStart(list,tick),'Set loop start');}
 setLoopEnd(beat){const tick=snapBeatToTick(beat,Number(this.getSnap())||0);return this.edit(list=>setLoopEnd(list,tick),'Set loop end');}
 rename(id){
  const marker=this.list().find(item=>item.id===id);if(!marker||marker.kind!=='marker'||!this.canEdit())return;
  this.askName('Rename marker','Marker name',marker.name,name=>this.edit(list=>renameMarker(list,id,name),'Rename marker'));
 }
 remove(id){return this.edit(list=>deleteMarker(list,id),'Delete marker');}
 /** Click: a time marker moves the playhead there; a loop flag sets the Playlist loop to the pair. */
 async click(id,which){
  const marker=this.list().find(item=>item.id===id);if(!marker)return;
  if(marker.kind==='loop'){await this.applyLoop(loopRangeBeats(marker));return;}
  this.seek(tickToBeat(marker.tick));
 }
 flagMenu(event,id,which){
  const marker=this.list().find(item=>item.id===id);if(!marker)return;
  const items=[];
  if(marker.kind==='marker'){items.push(['Rename','F2',()=>this.rename(id)],['Jump here','',()=>this.seek(tickToBeat(marker.tick))],['Delete','Del',()=>this.remove(id)]);}
  else items.push(['Loop playlist between the flags','',()=>this.applyLoop(loopRangeBeats(marker))],['Delete loop marker','Del',()=>this.remove(id)]);
  this.showMenu(event,items);
 }
 destroy(){const r=this.ruler;r.removeEventListener('pointerdown',this.down,true);r.removeEventListener('dblclick',this.dblclick,true);r.removeEventListener('contextmenu',this.context,true);r.removeEventListener('pointermove',this.move);r.removeEventListener('pointerup',this.up);r.removeEventListener('pointercancel',this.up);}
}
