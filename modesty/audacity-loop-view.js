import {snapLoopTime,snapLoopPair} from './audacity-loop-snap.js';
import {TRACK_GUTTER_PX} from './audacity-layout.js';
/** 409 loop_region_required: looping was switched on while Freestyle holds no loop region. */
export const isLoopRegionRequired=error=>[error?.code,error?.result?.error?.code,error?.details?.code,error?.data?.error?.code].includes('loop_region_required')||/loop_region_required/.test(String(error?.message||''));
/** Loop regions are independent of edit selections and use acknowledged cloud bounds. */
export class AudacityLoopRegion {
 constructor(workspace){
  this.w=workspace;this.active=null;this.pending=false;this.draft=null;this.syncSelection=false;
  const d=workspace.root.ownerDocument;
  this.move=e=>this.pointerMove(e);this.up=e=>{if(this.active?.id===e.pointerId){if(e.type!=='pointercancel')this.pointerMove(e);this.finish(e.type==='pointercancel');}};
  d.addEventListener('pointermove',this.move,true);d.addEventListener('pointerup',this.up,true);d.addEventListener('pointercancel',this.up,true);
  d.defaultView.addEventListener('blur',()=>this.cancel());
 }
 clock(){return this.w.engine.session.positionAt?.()??this.w.engine.positionAt?.()??{};}
 bounds(){const c=this.clock();return {start:Number(c.loopStartSec),end:Number(c.loopEndSec),enabled:c.loopEnabled===true};}
 context(){const e=this.w.engine;return {projectId:e.projectId,trackId:e.session.trackId,version:e.loadVersion};}
 valid(context){const e=this.w.engine,c=this.context();return e.ready&&!e.loading&&Object.keys(c).every(k=>c[k]===context[k]);}
 mount(){
  const ruler=this.w.root.querySelector('.au-ruler-time');if(!ruler)return;
  ruler.insertAdjacentHTML('beforeend','<div class="au-loop-region" role="region"><span class="au-loop-start" data-loop-edge="start"></span><span class="au-loop-end" data-loop-edge="end"></span></div>');
  ruler.onpointerdown=e=>this.pointerDown(e);ruler.onlostpointercapture=()=>this.cancel();ruler.title='Drag to define a looping region; drag inside to move it; drag an edge to resize';this.render();
 }
 render(){
  if(this.active&&!this.valid(this.active.context))this.cancel();
  const overlay=this.w.root.querySelector('.au-loop-region');if(!overlay)return;
  const r=this.draft??this.bounds(),visible=Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.end>r.start;
  const virtual=typeof this.w.timeToX==='function',width=Math.max(0,this.w.scroll.clientWidth-TRACK_GUTTER_PX),startX=virtual?this.w.timeToX(r.start):r.start*this.w.scale,endX=virtual?this.w.timeToX(r.end):r.end*this.w.scale;
  const left=virtual?Math.max(0,Math.min(width,startX)):startX,right=virtual?Math.max(0,Math.min(width,endX)):endX;
  overlay.hidden=!visible||(virtual&&(endX<0||startX>width));overlay.style.left=left+'px';overlay.style.width=Math.max(0,right-left)+'px';
  for(const [edge,x] of [['start',startX],['end',endX]]){const handle=overlay.querySelector(`[data-loop-edge=${edge}]`);if(handle)handle.style.display=virtual&&(x<0||x>width)?'none':'';}
  overlay.classList.toggle('au-loop-inactive',!r.enabled);overlay.classList.toggle('au-loop-pending',!!this.draft);
  overlay.setAttribute('aria-busy',String(this.pending));
  overlay.setAttribute('aria-label',`Loop from ${r.start.toFixed(3)} to ${r.end.toFixed(3)} seconds${this.draft?' (pending)':r.enabled?' (enabled)':' (disabled)'}`);
 }
 async apply(range,context=this.context()){
  const w=this.w;if(this.pending||w.busy||w.engine.interacting)throw new Error('Finish the current edit before changing the loop.');
  if(!this.valid(context))throw Object.assign(new Error('The cloud project changed. Select the loop again.'),{name:'AbortError'});
  if(range.start!==undefined&&(!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<range.start))throw new Error('Choose a valid loop range.');
  this.pending=true;w.busy=true;this.draft=range.start===undefined?null:range;this.render();w.engine.onStatus?.('Saving loop region…');
  try{
   await w.envelopeView?.controller.saveQueue;if(!this.valid(context))throw Object.assign(new Error('The cloud project changed.'),{name:'AbortError'});
   const result=await w.engine.setLoopRegion({enabled:range.enabled,...(range.start===undefined?{}:{startBeat:w.beat(range.start),endBeat:w.beat(range.end)})});
   if(!this.valid(context))throw Object.assign(new Error('The cloud project changed.'),{name:'AbortError'});
   const sampleRate=Number(w.engine.session.rawState?.transport?.sample_rate),tolerance=sampleRate>0?1/sampleRate+1e-9:1e-6;
   if(result?.loopEnabled!==range.enabled||range.start!==undefined&&(!Number.isFinite(result.loopStartSec)||!Number.isFinite(result.loopEndSec)||Math.abs(result.loopStartSec-range.start)>tolerance||Math.abs(result.loopEndSec-range.end)>tolerance))throw new Error('Freestyle read back a different loop region. The ruler shows its actual bounds; select the loop again.');
   w.engine.onStatus?.('Loop region saved');
   return result;
  }finally{this.pending=false;w.busy=false;this.draft=null;this.render();w.tick();}
 }
 /** Looping on/off is only the switch: Freestyle keeps the region ({enabled:false} keeps it, {enabled:true} alone
  *  loops it again). With no region the engine answers 409 loop_region_required: the selection (or the first four
  *  seconds) then becomes the region. */
 fallbackRange(){const s=this.w.selection;return {enabled:true,...(s.end>s.start?{start:s.start,end:s.end}:{start:0,end:4})};}
 async toggle(){
  const r=this.bounds();
  if(r.enabled)return this.apply({enabled:false});
  if(!(r.end>r.start))return this.apply(this.fallbackRange());
  try{return await this.apply({enabled:true});}
  catch(error){if(!isLoopRegionRequired(error))throw error;return this.apply(this.fallbackRange());}
 }
 selection(){const r=this.w.selection;if(r.end<=r.start)throw new Error('Select a time range before setting the loop.');return this.apply({enabled:true,...r});}
 clear(){return this.apply({enabled:false,start:0,end:0});}
 menuItems(){const r=this.bounds();return [
  ['Setting a loop region also makes an audio selection',this.syncSelection&&r.enabled?'✓':'',()=>{this.syncSelection=!this.syncSelection;},!r.enabled],
  ['Enable looping',r.enabled?'✓':'',()=>this.toggle()],['Clear loop','⌥⇧L',()=>this.clear()],['Set loop to selection','⇧L',()=>this.selection()]
 ];}
 rawPoint(e){
  const ruler=this.w.root.querySelector('.au-ruler-time'),viewport=this.w.scroll.getBoundingClientRect();let x=e.clientX;
  if(viewport.right-viewport.left>TRACK_GUTTER_PX)x=Math.max(viewport.left+TRACK_GUTTER_PX,Math.min(viewport.right-1,x));
  const local=x-ruler.getBoundingClientRect().left;return Math.max(0,this.w.xToTime?this.w.xToTime(local):local/this.w.scale);
 }
 snapOptions(unsnapped=false){
  const w=this.w,p=w.getProject?.(),bpm=Number(p?.bpm),seconds=b=>b*60/bpm;
  const clips=[...(p?.clips||[]),...(p?.audioClips||[])].map(c=>({start:seconds(c.start),end:seconds(c.start+c.length)}));
  const grid=Number(w.root.ownerDocument.querySelector('#au-snap-grid')?.value);
  return {pixelsPerSecond:w.scale,viewportStartSeconds:w.leftSec??w.scroll.scrollLeft/w.scale,clips,selection:w.selection,syncSelection:this.active?.syncSelection??this.syncSelection,gridSeconds:w.snap&&bpm>0&&grid>0?seconds(grid):0,unsnapped};
 }
 point(e){return snapLoopTime(this.rawPoint(e),this.snapOptions()).seconds;}
 pointerDown(e){
  const w=this.w;if(e.button!==0||!w.engine.ready||w.engine.loading||this.pending||w.busy||w.engine.interacting||w.engine.recorder?.recording||w.selectionGesture?.active||w.clipGesture||w.envelopeView?.active)return;
  e.preventDefault();e.stopPropagation();w.scroll.focus({preventScroll:true});
  const r=this.bounds(),at=this.point(e),edge=e.target.closest('[data-loop-edge]')?.dataset.loopEdge;
  const mode=edge??(r.enabled&&e.target.closest('.au-loop-region')?'move':'new');
  this.active={id:e.pointerId,x:e.clientX,at,rawAt:this.rawPoint(e),mode,range:r,beforeSelection:{...w.selection},syncSelection:this.syncSelection,context:this.context(),moved:false};
  w.engine.interacting=true;try{e.currentTarget.setPointerCapture?.(e.pointerId);}catch{}
 }
 pointerMove(e,{unsnapped=false}={}){
  const a=this.active;if(!a||a.id!==e.pointerId)return;
  if(!this.valid(a.context)){this.cancel();return;}
  if(!a.moved&&Math.abs(e.clientX-a.x)<4)return;a.moved=true;
  const raw=this.rawPoint(e),r=a.range,options=this.snapOptions(unsnapped);a.last={pointerId:e.pointerId,clientX:e.clientX};
  if(a.mode==='move'){
   const start=Math.max(0,r.start+raw-a.rawAt),result=snapLoopPair(start,start+r.end-r.start,options),shift=Math.max(0,-result.start);
   this.draft={start:result.start+shift,end:result.end+shift,enabled:true};a.snap=result;
  }else{const result=snapLoopTime(raw,options),t=result.seconds,fixed=a.mode==='start'?r.end:a.mode==='end'?r.start:a.at;this.draft={start:Math.min(fixed,t),end:Math.max(fixed,t),enabled:true};a.snap=result;}
  if(a.syncSelection){this.w.selection={start:this.draft.start,end:this.draft.end};this.w.paintSelection();}
  this.render();
 }
 escape(){if(this.active?.snap?.snapped&&this.active.last){this.pointerMove(this.active.last,{unsnapped:true});return;}this.cancel();}
 finish(cancel=false){
  const a=this.active;if(!a)return;const range=this.draft;this.active=null;this.draft=null;this.w.engine.interacting=false;
  const ruler=this.w.root.querySelector('.au-ruler-time');try{if(ruler?.hasPointerCapture?.(a.id))ruler.releasePointerCapture(a.id);}catch{}
  if(cancel&&a.syncSelection&&this.valid(a.context)){this.w.selection=a.beforeSelection;this.w.paintSelection();}
  this.render();
  if(!cancel&&a.moved&&range)this.w.run(async()=>{
   try{return await this.apply(range,a.context);}catch(error){
    if(a.syncSelection&&this.valid(a.context)&&this.w.selection.start===range.start&&this.w.selection.end===range.end){this.w.selection=a.beforeSelection;this.w.paintSelection();}
    throw error;
   }
  });
  else if(!cancel&&!a.moved){this.w.selection={start:a.at,end:a.at};this.w.paintSelection();if(!this.w.engine.playing&&!this.w.paused)this.w.seek(a.at);}
  if(this.deferredRender){this.deferredRender=false;this.w.render();}
 }
 cancel(){this.finish(true);}
}
