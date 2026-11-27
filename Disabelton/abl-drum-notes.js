/** Disabelton — Clip View ▸ unfolded Drum Rack note editor (Live 12: Fold off on a Drum Rack clip).
 *
 * Live shows a Drum Rack clip with Fold off in the ordinary note editor: every key row, with each pad's name on
 * its pad note's row (C1 = pad 1 …, the Drum Rack device's numbering — abl-dev-drumrack.js ablPadNote) and every
 * pad's hits as notes on that row. Freestyle stores a Drum Rack clip as per-channel STEP rows, so a note here IS
 * a lit step (channel = the pad's rack channel, index = the step); its length is one step.
 *
 * Writes (never direct to the engine) go through the hooks abl-clip-view.js passes from app.js:
 *  - rows(ids)                → complete canonical step rows of those pads (RackStepStroke's contract)
 *  - commitStroke(result,rows,label) → the rack step gesture commit (queue/registration aware), one edit
 *  - writeSteps(Map id→steps,{label}) → one exact multi-row rack step edit (a move: source off + target on)
 *  - setStepVelocity(id,index,level) is used by the Clip View's velocity lane, not here.
 * Adds and draw-mode paints run the real RackStepStroke over this grid's cells; delete / move build the rows
 * themselves (the stroke only toggles cells). Each gesture is one write → one Undo step.
 */
import {RackStepStroke} from './rack-step-stroke.js';

export const UNFOLD_STEP_PX=20,UNFOLD_ROW_PX=17;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keyOf=(id,index)=>`${id}\u0000${index}`;
const splitKey=key=>{const at=key.lastIndexOf('\u0000');return{id:key.slice(0,at),index:Number(key.slice(at+1))};};
export const stepOn=value=>value===true||typeof value==='number'&&Number.isFinite(value)&&value>0;

/** Key rows top → bottom (highest pitch first, as a piano roll): one per pitch from the highest pad note down to
 * the lowest, a row without a pad (a gap in the numbering) stays an unlabelled, non-editable key.
 * pads: [{id,name,index}] where index is the Drum Rack pad index (pitch = firstNote + index). */
export function unfoldRows(pads,{firstNote=36,noteName=()=>''}={}){
 const byPitch=new Map();for(const pad of pads||[])if(Number.isInteger(pad?.index)&&pad.index>=0)byPitch.set(firstNote+pad.index,pad);
 if(!byPitch.size)return[];
 const high=Math.max(...byPitch.keys()),low=Math.min(...byPitch.keys()),rows=[];
 for(let pitch=high;pitch>=low;pitch--){const pad=byPitch.get(pitch)||null,note=noteName(pitch-firstNote);rows.push({pitch,note,black:note.includes('#'),pad});}
 return rows;
}

/** Move hits by dIndex steps and dRow key rows. rows: Map id→complete steps; order: the key rows' pad ids top →
 * bottom (null = no pad). Returns {stepsByChannel, moved:[{id,index}]} or {reason} when the move is refused. */
export function moveDrumHits(rows,hits,{dIndex=0,dRow=0},order){
 if(!hits.length||!dIndex&&!dRow)return{reason:'unchanged'};
 const position=new Map(order.map((id,at)=>[id,at])).set(null,-1),targets=[];
 for(const hit of hits){
  const source=rows.get(hit.id);if(!source||!stepOn(source[hit.index]))return{reason:'The notes changed while they were moved. Try again.'};
  const at=position.get(hit.id),target=order[at+dRow];
  if(at==null||at<0||at+dRow<0||at+dRow>=order.length||target==null)return{reason:'There is no Drum Rack pad on that key: a note moves between pad rows only.'};
  const steps=rows.get(target);if(!steps)return{reason:'That pad has no step row to move the note into.'};
  const index=hit.index+dIndex;if(index<0||index>=steps.length)return{reason:'The note would leave the clip.'};
  targets.push({id:target,index,value:source[hit.index]});
 }
 const next=new Map(),row=id=>{if(!next.has(id))next.set(id,rows.get(id).slice());return next.get(id);};
 for(const hit of hits)row(hit.id)[hit.index]=false;
 for(const target of targets)row(target.id)[target.index]=target.value;
 for(const [id,steps]of [...next])if(steps.every((value,index)=>value===rows.get(id)[index]))next.delete(id);
 return next.size?{stepsByChannel:next,moved:targets.map(({id,index})=>({id,index}))}:{reason:'unchanged'};
}

/** Clamp a drag delta so every hit stays inside the clip (time) and on a pad row (pitch); null when none fits. */
export function clampDrumMove(hits,{dIndex,dRow},order,lengthOf){
 if(!hits.length)return{dIndex:0,dRow:0};
 let low=-Infinity,high=Infinity;for(const hit of hits){low=Math.max(low,-hit.index);high=Math.min(high,lengthOf(hit.id)-1-hit.index);}
 const index=Math.max(low,Math.min(high,dIndex)),fits=d=>hits.every(hit=>{const at=order.indexOf(hit.id);return at>=0&&order[at+d]!=null;});
 // Vertical: the nearest row delta toward the pointer that keeps every hit on a pad row.
 let row=0;if(dRow){const sign=Math.sign(dRow);for(let d=dRow;d!==0;d-=sign)if(fits(d)){row=d;break;}}
 return{dIndex:index,dRow:row};
}

export function createDrumNoteEditor({doc,win,api,onSelectPad=()=>{},onChange=()=>{}}){
 const el=doc.createElement('div');el.className='abl-unfold';el.setAttribute('role','grid');el.setAttribute('aria-label','Drum Rack notes (Fold off)');
 el.innerHTML='<div class="abl-unfold-keys" aria-label="Drum Rack pads by note"></div><div class="abl-unfold-scroll"><div class="abl-unfold-grid"><div class="abl-unfold-rows"></div><div class="abl-unfold-notes"></div></div></div><p class="abl-unfold-empty" hidden>Drop samples on the Drum Rack’s pads to add pads.</p>';
 const keys=el.querySelector('.abl-unfold-keys'),scroll=el.querySelector('.abl-unfold-scroll'),grid=el.querySelector('.abl-unfold-grid'),rowsLayer=el.querySelector('.abl-unfold-rows'),notesLayer=el.querySelector('.abl-unfold-notes'),empty=el.querySelector('.abl-unfold-empty');
 const state={model:null,selection:new Set(),patternId:null,drag:null,stroke:null,signature:null};
 const status=text=>{try{api.toast?.(text);}catch{}};
 const order=()=>(state.model?.rows||[]).map(row=>row.pad?.id??null);
 const padIds=()=>order().filter(id=>id!=null);
 const steps=id=>state.model?.steps?.[id]||[];
 const length=()=>Math.max(1,state.model?.length||16);
 /** Cell under a client point: {row, index, id} (id null on a gap row / outside). */
 function cellAt(x,y){const box=grid.getBoundingClientRect(),index=Math.floor((x-box.left)/UNFOLD_STEP_PX),row=Math.floor((y-box.top)/UNFOLD_ROW_PX),rows=state.model?.rows||[];if(!(row>=0&&row<rows.length&&index>=0&&index<length()))return null;return{row,index,id:rows[row].pad?.id??null};}
 function cells(){const box=grid.getBoundingClientRect(),out=[];(state.model?.rows||[]).forEach((row,r)=>{if(!row.pad)return;const n=steps(row.pad.id).length||length();for(let index=0;index<n;index++){const left=box.left+index*UNFOLD_STEP_PX,top=box.top+r*UNFOLD_ROW_PX;out.push({channelId:row.pad.id,index,left,right:left+UNFOLD_STEP_PX,top,bottom:top+UNFOLD_ROW_PX});}});return out;}
 const level=value=>value===true?100/128:typeof value==='number'?Math.min(1,value>1?value/127:value):0;
 function noteMarkup(stepsOf){
  const out=[];(state.model?.rows||[]).forEach((row,r)=>{if(!row.pad)return;const id=row.pad.id;stepsOf(id).forEach((value,index)=>{if(!stepOn(value))return;const selected=state.selection.has(keyOf(id,index));
   out.push(`<span class="abl-unfold-note${selected?' selected':''}" role="gridcell" aria-selected="${selected}" data-channel="${esc(id)}" data-step="${index}" data-pitch="${row.pitch}" title="${esc(row.pad.name)} · ${esc(row.note)} · step ${index+1}" style="left:${index*UNFOLD_STEP_PX}px;top:${r*UNFOLD_ROW_PX}px;width:${UNFOLD_STEP_PX-1}px;height:${UNFOLD_ROW_PX-1}px;--abl-vel:${level(value).toFixed(3)}"></span>`);});});
  return out.join('');
 }
 function paintNotes(stepsOf=steps){const markup=noteMarkup(stepsOf);if(notesLayer._ablMarkup!==markup){notesLayer._ablMarkup=markup;notesLayer.innerHTML=markup;}}
 /** model: {patternId, rows (unfoldRows), steps: id→array, length, selectedPad, beatsPerBar} */
 function paint(model){
  if(state.drag||state.stroke)return;
  if(model.patternId!==state.patternId){state.patternId=model.patternId;state.selection.clear();}
  state.model=model;const rows=model.rows||[];
  // Selection keeps only notes that still exist.
  for(const key of [...state.selection]){const {id,index}=splitKey(key);if(!stepOn((model.steps?.[id]||[])[index])||!rows.some(row=>row.pad?.id===id))state.selection.delete(key);}
  empty.hidden=rows.length>0;
  const signature=JSON.stringify([rows.map(row=>[row.pitch,row.note,row.pad?.id||'',row.pad?.name||'']),model.selectedPad||'',length(),model.beatsPerBar||4]);
  if(signature!==state.signature){state.signature=signature;
   keys.innerHTML=rows.map(row=>`<div class="abl-unfold-key${row.black?' black':''}${row.pad?'':' abl-unfold-nopad'}${row.pad&&row.pad.id===model.selectedPad?' selected':''}" data-pitch="${row.pitch}"${row.pad?` data-channel="${esc(row.pad.id)}" role="button" tabindex="-1" title="${esc(row.pad.name)} · ${esc(row.note)} · click to select and play the pad"`:''} style="height:${UNFOLD_ROW_PX}px"><span class="abl-unfold-pad">${row.pad?esc(row.pad.name):''}</span><span class="abl-unfold-note-name">${esc(row.note)}</span></div>`).join('');
   rowsLayer.innerHTML=rows.map((row,r)=>`<div class="abl-unfold-row${row.black?' black':''}${row.pad?'':' abl-unfold-nopad'}" data-pitch="${row.pitch}" style="top:${r*UNFOLD_ROW_PX}px;height:${UNFOLD_ROW_PX}px"></div>`).join('');
   grid.style.width=`${length()*UNFOLD_STEP_PX}px`;grid.style.height=`${rows.length*UNFOLD_ROW_PX}px`;grid.style.setProperty('--abl-unfold-bar',`${(model.beatsPerBar||4)*4*UNFOLD_STEP_PX}px`);
  }
  paintNotes();
 }
 const selectedHits=()=>[...state.selection].map(splitKey);
 function select(keysToSelect,{add=false}={}){if(!add)state.selection.clear();for(const key of keysToSelect)state.selection.add(key);notesLayer._ablMarkup=null;paintNotes();onChange();}
 function refusal(){const reason=api.refusal?.();if(reason){status(reason);return true;}return false;}
 /** Write a move/delete as one exact rack step edit; the selection follows the moved notes. */
 function write(next,label,selectAfter){
  if(refusal())return false;let applied=false;
  try{applied=api.writeSteps(next,{label});}catch(error){api.fail?.(error);return false;}
  if(applied&&selectAfter){state.selection=new Set(selectAfter.map(hit=>keyOf(hit.id,hit.index)));}
  notesLayer._ablMarkup=null;onChange();return applied;
 }
 function completeRows(ids){return new Map((api.rows(ids)||[]).map(row=>[row.channelId,row.steps]));}
 function deleteSelected(){
  const hits=selectedHits();if(!hits.length)return false;const rows=completeRows([...new Set(hits.map(hit=>hit.id))]),next=new Map();
  for(const hit of hits){const row=rows.get(hit.id);if(!row||!stepOn(row[hit.index]))continue;if(!next.has(hit.id))next.set(hit.id,row.slice());next.get(hit.id)[hit.index]=false;}
  if(!next.size)return false;state.selection.clear();return write(next,hits.length===1?'Delete Note':'Delete Notes',[]);
 }
 function move(delta,{label='Move Notes'}={}){
  const hits=selectedHits();if(!hits.length)return false;const rows=completeRows(padIds());
  const result=moveDrumHits(rows,hits,delta,order());if(result.reason){if(result.reason!=='unchanged')status(result.reason);return false;}
  return write(result.stepsByChannel,hits.length===1?'Move Note':label,result.moved);
 }
 /** One RackStepStroke over this grid (draw-mode paint, or a double-click add): its result is the rack commit. */
 function startStroke(event,mode,label){
  if(refusal())return false;const ids=padIds();let rows;
  try{rows=api.rows(ids);state.stroke=new RackStepStroke({rows,cells:cells(),mode,raf:fn=>win.requestAnimationFrame(fn),caf:id=>win.cancelAnimationFrame(id),
   paint:snapshot=>paintNotes(id=>snapshot.stepsByChannel.get(id)||steps(id)),restore:()=>{notesLayer._ablMarkup=null;}});}
  catch(error){state.stroke=null;status(error.message);return false;}
  const stroke=state.stroke,pointerId=event.pointerId,initial=rows;stroke.addPoint({x:event.clientX,y:event.clientY});
  const finish=(sample,cancel)=>{
   if(state.stroke!==stroke||sample&&sample.pointerId!==pointerId)return;for(const [type,fn]of Object.entries(handlers))doc.removeEventListener(type,fn,true);
   const result=stroke.finish(sample&&Number.isFinite(sample.clientX)?{x:sample.clientX,y:sample.clientY}:null,{cancel});state.stroke=null;paintNotes();
   if(result.changed){const added=[];for(const [id,row]of result.stepsByChannel)row.forEach((value,index)=>{if(value&&!stepOn(initial.find(r=>r.channelId===id).steps[index]))added.push(keyOf(id,index));});
    let applied=false;try{applied=api.commitStroke(result,initial,label);}catch(error){api.fail?.(error);}if(applied!==false&&added.length)state.selection=new Set(added);}
   notesLayer._ablMarkup=null;onChange();
  };
  const handlers={pointermove:sample=>{if(sample.pointerId===pointerId&&state.stroke===stroke)stroke.addPoint({x:sample.clientX,y:sample.clientY});},pointerup:sample=>finish(sample,false),pointercancel:sample=>finish(sample,true)};
  for(const [type,fn]of Object.entries(handlers))doc.addEventListener(type,fn,true);
  if(mode!=='toggle'||event.type==='dblclick')finish({pointerId,clientX:event.clientX,clientY:event.clientY},false);
  return true;
 }
 // ---- pointer: select / move a note; draw mode paints; double-click adds (empty) or deletes (a note) ----
 grid.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.isPrimary===false||state.drag||state.stroke||!Number.isFinite(event.clientX))return;
  const cell=cellAt(event.clientX,event.clientY);if(!cell)return;event.preventDefault();event.stopPropagation();
  if(cell.id==null){status('There is no Drum Rack pad on this key.');return;}
  const on=stepOn(steps(cell.id)[cell.index]),key=keyOf(cell.id,cell.index);
  if(api.drawMode?.()){startStroke(event,'toggle',on?'Erase Notes':'Draw Notes');return;}
  if(!on){if(!event.shiftKey&&state.selection.size)select([]);return;}
  if(event.shiftKey){if(state.selection.has(key))state.selection.delete(key);else state.selection.add(key);notesLayer._ablMarkup=null;paintNotes();onChange();return;}
  if(!state.selection.has(key))select([key]);onSelectPad(cell.id);
  const hits=selectedHits(),x0=event.clientX,y0=event.clientY,pointerId=event.pointerId,nodes=[...notesLayer.querySelectorAll('.abl-unfold-note.selected')];
  const lengthOf=id=>steps(id).length||length();
  state.drag={pointerId,delta:{dIndex:0,dRow:0}};try{grid.setPointerCapture?.(pointerId);}catch{}
  const compute=sample=>clampDrumMove(hits,{dIndex:Math.round((sample.clientX-x0)/UNFOLD_STEP_PX),dRow:Math.round((sample.clientY-y0)/UNFOLD_ROW_PX)},order(),lengthOf);
  const show=delta=>{for(const node of nodes){node.style.transform=delta.dIndex||delta.dRow?`translate(${delta.dIndex*UNFOLD_STEP_PX}px,${delta.dRow*UNFOLD_ROW_PX}px)`:'';node.classList.toggle('moving',!!(delta.dIndex||delta.dRow));}};
  const end=(sample,commit)=>{
   const drag=state.drag;if(!drag||sample&&sample.pointerId!==pointerId)return;for(const [type,fn]of Object.entries(handlers))doc.removeEventListener(type,fn,true);win.removeEventListener('keydown',onEscape,true);
   if(commit&&sample&&Number.isFinite(sample.clientX))drag.delta=compute(sample);state.drag=null;show({dIndex:0,dRow:0});
   if(commit&&(drag.delta.dIndex||drag.delta.dRow))move(drag.delta);else{notesLayer._ablMarkup=null;onChange();}
  };
  const handlers={pointermove:sample=>{if(!state.drag||sample.pointerId!==pointerId||!Number.isFinite(sample.clientX))return;state.drag.delta=compute(sample);show(state.drag.delta);},pointerup:sample=>end(sample,true),pointercancel:sample=>end(sample,false)};
  const onEscape=key=>{if(key.key==='Escape'){key.preventDefault();key.stopImmediatePropagation();end(null,false);}};
  for(const [type,fn]of Object.entries(handlers))doc.addEventListener(type,fn,true);win.addEventListener('keydown',onEscape,true);
 });
 grid.addEventListener('dblclick',event=>{
  if(event.button!==0||state.drag||state.stroke||api.drawMode?.())return;const cell=cellAt(event.clientX,event.clientY);if(!cell||cell.id==null)return;event.preventDefault();event.stopPropagation();
  if(stepOn(steps(cell.id)[cell.index])){state.selection=new Set([keyOf(cell.id,cell.index)]);deleteSelected();return;}
  startStroke({pointerId:event.pointerId??-1,clientX:event.clientX,clientY:event.clientY,type:'dblclick'},'on','Add Note');
 });
 keys.addEventListener('click',event=>{const key=event.target.closest?.('.abl-unfold-key[data-channel]');if(!key)return;event.preventDefault();event.stopPropagation();onSelectPad(key.dataset.channel,{audition:(event.detail??1)<=1});});
 // The keys strip scrolls with the grid vertically.
 scroll.addEventListener('scroll',()=>{keys.style.transform=`translateY(${-scroll.scrollTop}px)`;});
 return{
  el,paint,deleteSelected,move,
  get dragging(){return !!state.drag||!!state.stroke;},
  get selection(){return selectedHits();},
  selectAll(){select((state.model?.rows||[]).flatMap(row=>row.pad?steps(row.pad.id).map((value,index)=>stepOn(value)?keyOf(row.pad.id,index):null).filter(Boolean):[]));return true;},
  clearSelection(){if(!state.selection.size)return false;select([]);return true;},
  /** Velocity-lane stems for the unfolded notes: x = the note's centre in client px (the grid scrolls with its box). */
  stems(){const left=grid.getBoundingClientRect().left;return[...notesLayer.querySelectorAll('.abl-unfold-note')].map(node=>({id:node.dataset.channel,index:Number(node.dataset.step),x:left+Number(node.dataset.step)*UNFOLD_STEP_PX+UNFOLD_STEP_PX/2,selected:node.classList.contains('selected')}));},
  cancel(){if(state.drag){state.drag=null;notesLayer._ablMarkup=null;}if(state.stroke){state.stroke.finish(null,{cancel:true});state.stroke=null;}},
 };
}
