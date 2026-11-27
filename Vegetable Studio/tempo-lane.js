/**
 * Playlist "Tempo" lane: a thin DOM view over the timing map (see tempo-clip.js for the model).
 * It owns no state beyond the selected point and visibility. Every gesture hands the complete
 * new point list to `write(points,label)`, which is the guarded timing-map write (one revision,
 * one undo step). Pointer geometry converts through the engine's own tempo timeline.
 */
import {
  addTempoPoint,bpmToY,buildTempoTimeline,deleteTempoPoint,moveTempoPoint,setTempoPointCurve,snapTick,tempoCurveSamples,
  tempoDisplayRange,tempoGestureAvailability,tempoPointsFromDocument,tickOfAxis,axisOfTick,yToBpm,TEMPO_PPQ
} from './tempo-clip.js';
export const TEMPO_LANE_STORAGE_KEY='vegetable:tempo-lane';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function readTempoLaneVisible(storage=globalThis.localStorage){try{return storage?.getItem(TEMPO_LANE_STORAGE_KEY)==='1';}catch{return false;}}
export function saveTempoLaneVisible(visible,storage=globalThis.localStorage){try{storage?.setItem(TEMPO_LANE_STORAGE_KEY,visible?'1':'0');}catch{}}
export const tempoReadout=(tick,bpm)=>`${(Math.round(bpm*100)/100).toString()} BPM · beat ${(Math.round(tick/TEMPO_PPQ*100)/100+1).toString()}`;

export class TempoLane{
 constructor({host,getDoc,getRefBpm,getBarWidth,getLaneHeight=()=>80,getSnapBeats=()=>0,canEdit=()=>true,write,menu,toast=()=>{},fail=()=>{},onVisibleChange=()=>{},document:doc=globalThis.document}={}){
  Object.assign(this,{host,getDoc,getRefBpm,getBarWidth,getLaneHeight,getSnapBeats,canEdit,write,menu,toast,fail,onVisibleChange,doc});
  this.visible=false;this.selected=-1;this.drag=null;this.busy=false;this.grid=null;
 }
 setVisible(visible){this.visible=!!visible;saveTempoLaneVisible(this.visible);this.onVisibleChange(this.visible);this.paint();if(this.visible)this.host?.querySelector?.('.tempo-track')?.scrollIntoView?.({block:'nearest'});}
 model(){const doc=this.getDoc();return doc?{doc,...tempoPointsFromDocument(doc)}:null;}
 paint(){
  const host=this.host;if(!host)return;
  host.querySelector(':scope > .tempo-track')?.remove();this.grid=null;this.drag=null;
  if(!this.visible)return;
  const model=this.model(),row=this.doc.createElement('div');row.className='tempo-track';
  const label=`<div class="track-label tempo-track-label" title="Tempo automation clip (project timing map)">Tempo<small>${model?esc(model.editable?'click to add · drag to move':'read-only'):'reading…'}</small><button class="tempo-close" title="Hide the Tempo lane" aria-label="Hide the Tempo lane">×</button></div>`;
  row.innerHTML=`${label}<div class="tempo-lane-grid" tabindex="0" aria-label="Tempo automation clip. Click to add a point, drag to move, Delete to remove."></div>`;
  host.append(row);
  row.querySelector('.tempo-close').onclick=()=>this.setVisible(false);
  row.oncontextmenu=event=>{event.stopPropagation();event.preventDefault();};
  const grid=this.grid=row.querySelector('.tempo-lane-grid');
  if(!model){grid.innerHTML='<span class="tempo-note">Reading the project timing map…</span>';return;}
  this.draw(model);
  grid.oncontextmenu=event=>this.contextMenu(event);
  grid.onpointerdown=event=>this.pointerDown(event);
  grid.onpointermove=event=>this.pointerMove(event);
  grid.onpointerup=event=>this.pointerUp(event);
  grid.onpointercancel=()=>this.cancelDrag();
  grid.onkeydown=event=>{if((event.key==='Delete'||event.key==='Backspace')&&this.selected>=0){event.preventDefault();event.stopPropagation();this.remove(this.selected);}else if(event.key==='Escape'&&this.drag){event.stopPropagation();this.cancelDrag();}};
 }
 /** (Re)draw curve and handles for `model.points` (or the in-flight drag points). */
 draw(model,points=model.points,range=this.drag?.range||tempoDisplayRange(points)){
  const grid=this.grid;if(!grid)return;
  const height=Math.max(28,this.getLaneHeight()-3),refBpm=this.getRefBpm(),bar=this.getBarWidth(),px=bar/4,tl=buildTempoTimeline(model.doc,refBpm);
  const width=Math.max(grid.clientWidth||0,1200),x=tick=>axisOfTick(tl,tick,refBpm)*px;
  const samples=tempoCurveSamples(points,tl,refBpm,{endAxis:width/px,samplesPerRamp:24});
  const y=bpm=>bpmToY(bpm,range,height);
  const path=samples.map((s,i)=>`${i?'L':'M'}${(s.axis*px).toFixed(2)},${y(s.bpm).toFixed(2)}`).join('');
  const handles=points.map((p,i)=>`<div class="tempo-point ${i===this.selected?'selected':''} ${p.curve==='linear'?'ramp':''}" data-index="${i}" style="left:${x(p.tick).toFixed(2)}px;top:${y(p.bpm).toFixed(2)}px" title="${esc(tempoReadout(p.tick,p.bpm))}"></div>`).join('');
  const ticks=[range.hi,(range.hi+range.lo)/2,range.lo].map(v=>`<span class="tempo-scale" style="top:${y(v).toFixed(1)}px">${Math.round(v)}</span>`).join('');
  grid.innerHTML=`<svg class="tempo-curve" width="${width}" height="${height}" aria-hidden="true"><path class="tempo-curve-fill" d="${path}L${(width).toFixed(2)},${height}L0,${height}Z"/><path class="tempo-curve-line" d="${path}"/></svg>${ticks}${handles}<div class="tempo-readout" hidden></div>`;
  this.lastGeometry={tl,refBpm,px,height,range};
 }
 gridOrigin(){const rect=this.grid.getBoundingClientRect();return{left:rect.left+(this.grid.clientLeft||0),top:rect.top+(this.grid.clientTop||0)};}
 pointerFor(event){
  const g=this.lastGeometry,o=this.gridOrigin(),axis=Math.max(0,(event.clientX-o.left)/g.px),localY=event.clientY-o.top;
  const tick=snapTick(tickOfAxis(g.tl,axis,g.refBpm),event.altKey?0:this.getSnapBeats()),bpm=yToBpm(localY,g.range,g.height);
  return{tick,bpm:Math.round(bpm*100)/100};
 }
 pointerDown(event){
  if(event.button!==0||event.target.closest?.('.tempo-close'))return;
  const model=this.model();if(!model||this.busy)return;
  event.preventDefault();event.stopPropagation();this.grid.focus?.({preventScroll:true});
  const handle=event.target.closest?.('.tempo-point'),index=handle?Number(handle.dataset.index):-1;
  if(!model.editable){this.toast(model.reason||'The tempo lane is read-only for this map.');return;}
  if(index>=0){
   this.selected=index;
   this.drag={id:event.pointerId,index,model,range:tempoDisplayRange(model.points),points:model.points,moved:false,startX:event.clientX,startY:event.clientY};
   try{this.grid.setPointerCapture(event.pointerId);}catch{}
   this.draw(model,model.points,this.drag.range);return;
  }
  const avail=tempoGestureAvailability(model,-1).add;if(!avail.ok){this.toast(avail.reason);return;}
  if(!this.canEdit())return;
  const {tick,bpm}=this.pointerFor(event);
  try{const {points,index:at}=addTempoPoint(model.points,{tick,bpm});this.selected=at;this.commit(points,'Add tempo point');}catch(error){this.fail(error);}
 }
 pointerMove(event){
  const d=this.drag;if(!d||event.pointerId!==d.id)return;
  if(!d.moved&&Math.hypot(event.clientX-d.startX,event.clientY-d.startY)<3)return;
  d.moved=true;
  const {tick,bpm}=this.pointerFor(event);
  d.points=moveTempoPoint(d.model.points,d.index,{tick,bpm});
  this.draw(d.model,d.points,d.range);
  const p=d.points[d.index],readout=this.grid.querySelector('.tempo-readout'),el=this.grid.querySelector(`.tempo-point[data-index="${d.index}"]`);
  if(readout&&el){readout.hidden=false;readout.textContent=tempoReadout(p.tick,p.bpm);readout.style.left=`${el.offsetLeft+10}px`;readout.style.top=`${Math.max(0,el.offsetTop-18)}px`;}
 }
 pointerUp(event){
  const d=this.drag;if(!d||event.pointerId!==d.id)return;
  try{this.grid.releasePointerCapture(event.pointerId);}catch{}
  this.drag=null;
  if(!d.moved){this.draw(d.model);return;}
  if(!this.canEdit()){this.draw(d.model);return;}
  const same=JSON.stringify(d.points)===JSON.stringify(d.model.points);
  if(same){this.draw(d.model);return;}
  this.commit(d.points,'Move tempo point');
 }
 cancelDrag(){const d=this.drag;this.drag=null;if(d)this.draw(d.model);}
 async commit(points,label){
  if(this.busy)return;this.busy=true;
  try{await this.write(points,label);}catch(error){this.fail(error);}finally{this.busy=false;this.paint();}
 }
 remove(index){const model=this.model();if(!model)return;const a=tempoGestureAvailability(model,index).remove;if(!a.ok){this.toast(a.reason);return;}if(!this.canEdit())return;try{this.selected=-1;this.commit(deleteTempoPoint(model.points,index),'Delete tempo point');}catch(error){this.fail(error);}}
 setCurve(index,curve){const model=this.model();if(!model)return;if(!this.canEdit())return;try{this.commit(setTempoPointCurve(model.points,index,curve),curve==='linear'?'Ramp tempo':'Hold tempo');}catch(error){this.fail(error);}}
 contextMenu(event){
  event.preventDefault();event.stopPropagation();
  const model=this.model();if(!model)return;
  const handle=event.target.closest?.('.tempo-point'),index=handle?Number(handle.dataset.index):-1,a=tempoGestureAvailability(model,index);
  if(index>=0)this.selected=index;
  const reasoned=(label,gate,run,extra={})=>({label,run,disabled:!gate.ok,title:gate.ok?'':gate.reason,...extra});
  const p=model.points[index],items=[];
  if(index>=0){
   items.push(reasoned('Delete point',a.remove,()=>this.remove(index)));
   items.push(reasoned('Hold tempo to next point',a.curve,()=>this.setCurve(index,'step'),{shortcut:p?.curve==='step'?'✓':''}));
   items.push(reasoned('Ramp tempo to next point',a.curve,()=>this.setCurve(index,'linear'),{shortcut:p?.curve==='linear'?'✓':''}));
   items.push(null);
  }else{
   const at=this.pointerFor(event);
   items.push(reasoned('Add point here',a.add,()=>{if(!this.canEdit())return;const {points,index:i}=addTempoPoint(model.points,at);this.selected=i;return this.commit(points,'Add tempo point');}));
   items.push(null);
  }
  items.push({label:'Hide Tempo lane',run:()=>this.setVisible(false)});
  this.menu(event,items.filter((item,i,all)=>item||(i>0&&i<all.length-1)));
 }
}
