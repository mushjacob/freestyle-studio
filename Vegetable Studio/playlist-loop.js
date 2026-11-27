const number=value=>Number.isFinite(Number(value))?Number(value):0;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Options > Loop playback: turning the loop On needs bounds (Off clears the live clock's), so reuse the clock's, else the last loop region seen. */
export function loopToggleRange(clock,bpm,remembered=null){
 const bounds=(start,end)=>Number.isFinite(start)&&Number.isFinite(end)&&end>start?{startBeat:start,endBeat:end}:null;
 const current=Number.isFinite(bpm)&&bpm>0?bounds(number(clock?.loopStartSec)*bpm/60,number(clock?.loopEndSec)*bpm/60):null;
 if(clock?.loopEnabled===true)return{enabled:false,remember:current};
 // Issue #17: switching the loop off keeps its region, and {enabled:true} alone loops that region again.
 if(current)return{enabled:true,remember:current};
 // No region on the transport: re-send the last one seen; with none, Freestyle answers 409 loop_region_required.
 return remembered?{enabled:true,...remembered,remember:remembered}:{enabled:true,remember:null,needsRegion:true};
}

/** FL ruler gestures edit the cloud loop; the transport clock supplies its bounds. */
export class PlaylistLoopRegion {
 constructor({ruler,viewport,engine,getProject,getScale,getSnap=()=>.25,dialog,onChanged=()=>{},onError=()=>{},onGestureEnd=()=>{},onRulerClick=null,now=()=>performance.now(),raf=fn=>requestAnimationFrame(fn),caf=id=>cancelAnimationFrame(id)}){
  Object.assign(this,{ruler,viewport,engine,getProject,getScale,getSnap,dialog,onChanged,onError,onGestureEnd,onRulerClick,now,raf,caf});this.document=ruler.ownerDocument;this.window=this.document.defaultView;this.draft=null;this.active=null;this.frame=null;ruler.title='Right-drag to set a loop; right-click for loop controls';this.busy=false;this.suppressUntil=0;
  this.down=event=>{
   if(event.button!==2||this.busy||engine.interacting)return;
   event.preventDefault();const rect=ruler.getBoundingClientRect(),scale=getScale(),scroll=viewport.scrollLeft;
   const beat=this.snap((event.clientX-rect.left)/scale*4,event.altKey);
   this.active={pointerId:event.pointerId,x:event.clientX,left:rect.left,scroll,scale,beat,context:this.context()};this.draft={startBeat:beat,endBeat:beat};engine.interacting=true;
   ruler.setPointerCapture?.(event.pointerId);this.render();
  };
  this.move=event=>{
   const a=this.active;if(!a||event.pointerId!==a.pointerId)return;
   const beat=this.snap((event.clientX-a.left+viewport.scrollLeft-a.scroll)/a.scale*4,event.altKey);
   this.draft={startBeat:Math.min(a.beat,beat),endBeat:Math.max(a.beat,beat)};a.moved=Math.abs(event.clientX-a.x)>3;
   if(this.frame===null)this.frame=this.raf(()=>{this.frame=null;this.render();});
  };
  this.up=event=>{if(this.active&&event.pointerId===this.active.pointerId){if(event.type!=='pointercancel')this.move(event);this.upEvent=event;this.finish(event.type==='pointercancel');}};
  this.blur=()=>this.finish(true);
  this.contextMenu=event=>{event.preventDefault();if(this.active||this.now()<this.suppressUntil)return;this.open();};
  ruler.addEventListener('pointerdown',this.down);ruler.addEventListener('contextmenu',this.contextMenu);this.document.addEventListener('pointermove',this.move,true);this.document.addEventListener('pointerup',this.up,true);this.document.addEventListener('pointercancel',this.up,true);this.window.addEventListener('blur',this.blur);
 }
 context(){return{projectId:this.engine.projectId,trackId:this.engine.session.trackId,version:this.engine.loadVersion};}
 assertContext(context){if(!this.engine.ready)throw new Error('Open a cloud project before setting its loop.');const current=this.context();if(this.engine.loading||Object.keys(current).some(key=>current[key]!==context[key]))throw Object.assign(new Error('The cloud project changed. Select the loop again.'),{name:'AbortError'});}
 snap(beat,free=false){const step=free?0:Math.max(0,number(this.getSnap()));return Math.max(0,step?Math.round(beat/step)*step:beat);}
 finish(cancel=false){
  const a=this.active;if(!a)return;
  this.active=null;this.suppressUntil=this.now()+500;if(this.frame!==null)this.caf(this.frame);this.frame=null;
  try{if(this.ruler.hasPointerCapture?.(a.pointerId))this.ruler.releasePointerCapture(a.pointerId);}catch{}
  this.engine.interacting=false;this.onGestureEnd();
  const range=this.draft;
  if(cancel){this.draft=null;this.render();return;}
  if(!a.moved||range.endBeat<=range.startBeat){this.draft=null;this.render();if(this.onRulerClick)this.onRulerClick({event:this.upEvent,beat:a.beat});else this.open();return;}
  this.apply({enabled:true,...range},a.context).catch(this.onError);
 }
 render(clock=this.engine.session.positionAt?.()||{}){
  let overlay=this.ruler.querySelector('.playlist-loop-region');if(!overlay){overlay=this.document.createElement('div');overlay.className='playlist-loop-region';overlay.setAttribute('role','region');this.ruler.append(overlay);}
  const bpm=number(clock.bpm)||number(this.getProject().bpm)||120;
  const range=this.draft||{startBeat:number(clock.loopStartSec)*bpm/60,endBeat:number(clock.loopEndSec)*bpm/60};
  const visible=!!this.draft||clock.loopEnabled&&range.endBeat>range.startBeat;
  overlay.style.display=visible?'block':'none';overlay.classList.toggle('pending',!!this.draft);
  overlay.style.transform=`translate3d(${range.startBeat/4*this.getScale()}px,0,0)`;overlay.style.width=`${Math.max(0,range.endBeat-range.startBeat)/4*this.getScale()}px`;
  overlay.dataset.startBeat=String(range.startBeat);overlay.dataset.endBeat=String(range.endBeat);overlay.setAttribute('aria-label',`Loop from bar ${1+range.startBeat/4} to ${1+range.endBeat/4}${this.draft?' (pending)':''}`);
 }
 async apply(range,context=this.context()){
  if(this.busy)throw new Error('Wait for the current loop change to finish.');this.assertContext(context);this.busy=true;this.draft=range.enabled&&Number.isFinite(range.startBeat)&&Number.isFinite(range.endBeat)?{startBeat:range.startBeat,endBeat:range.endBeat}:null;this.render();
  try{const result=await this.engine.setLoopRegion(range);this.assertContext(context);this.draft=null;this.onChanged(result);this.render();return result;}
  finally{this.busy=false;this.draft=null;if(!this.active)this.render();}
 }
 open(){
  if(this.openDialog?.isConnected)return this.openDialog;
  const context=this.context(),clock=this.engine.session.positionAt?.()||{},bpm=number(clock.bpm)||number(this.getProject().bpm)||120;
  const start=number(clock.loopStartSec)*bpm/60,currentEnd=number(clock.loopEndSec)*bpm/60,end=currentEnd>start?currentEnd:start+4;
  const d=this.openDialog=this.dialog('Playlist loop',`<form class="playlist-loop-form"><label>Start bar<input name="start" type="number" min="1" step=".0625" value="${esc(1+start/4)}" required></label><label>End bar (exclusive)<input name="end" type="number" min="1" step=".0625" value="${esc(1+end/4)}" required></label><p role="status" class="playlist-loop-status">Right-drag the playlist ruler to select a loop.</p><button class="primary" type="submit">Set loop</button><button type="button" class="loop-arrangement">Loop arrangement</button><button type="button" class="loop-disable">Disable loop</button></form>`);
  const run=async range=>{const controls=[...d.querySelectorAll('.playlist-loop-form input,.playlist-loop-form button')];controls.forEach(control=>control.disabled=true);d.querySelector('.playlist-loop-status').textContent='Saving the loop in Freestyle…';try{await this.apply(range,context);if(d.isConnected)d.close();}catch(error){if(d.isConnected){d.querySelector('.playlist-loop-status').textContent=error.message;controls.forEach(control=>control.disabled=false);}}};
  d.querySelector('form').onsubmit=event=>{event.preventDefault();const startBeat=(Number(d.querySelector('[name=start]').value)-1)*4,endBeat=(Number(d.querySelector('[name=end]').value)-1)*4;if(!Number.isFinite(startBeat)||!Number.isFinite(endBeat)||startBeat<0||endBeat<=startBeat){d.querySelector('.playlist-loop-status').textContent='The loop end must be after its start.';return;}return run({enabled:true,startBeat,endBeat});};
  d.querySelector('.loop-arrangement').onclick=()=>{const p=this.getProject(),endBeat=Math.max(4,...[...(p.clips||[]),...(p.audioClips||[])].map(clip=>number(clip.start)+number(clip.length)));return run({enabled:true,startBeat:0,endBeat});};
  d.querySelector('.loop-disable').onclick=()=>run({enabled:false,startBeat:0,endBeat:0});return d;
 }
 destroy(){this.finish(true);if(this.frame!==null)this.caf(this.frame);this.ruler.removeEventListener('pointerdown',this.down);this.ruler.removeEventListener('contextmenu',this.contextMenu);this.document.removeEventListener('pointermove',this.move,true);this.document.removeEventListener('pointerup',this.up,true);this.document.removeEventListener('pointercancel',this.up,true);this.window.removeEventListener('blur',this.blur);}
}
