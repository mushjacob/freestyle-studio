/**
 * Modesty piano roll: standard-DAW note editing over the Freestyle cloud
 * pattern, with optimistic local state (PianoRollStore) and live instrument
 * audition over mozart-control (LiveInstrument). No browser audio synthesis.
 */
import * as Tools from './piano-tools.js';
import {PianoRollStore} from './piano-roll-store.js';
import {LiveInstrument,typingNote,MidiInput} from './piano-roll-live.js';

export const ROW_HEIGHT=23,TOP_PITCH=127,KEY_GUTTER=56;
const NAMES=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const BLACK=new Set([1,3,6,8,10]);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>globalThis.crypto?.randomUUID?.()||`note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const clone=value=>structuredClone(value);
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
export const noteName=pitch=>`${NAMES[pitch%12]}${Math.floor(pitch/12)-1}`;
const FIELD='input,select,textarea,[contenteditable]:not([contenteditable=false]),[role=textbox]';

export class PianoRollView{
 constructor({doc=globalThis.document,win=globalThis.window,engine,getProject,getPattern,getChannel,selection=new Set(),grid=()=>.25,barWidth=()=>112,noteLength=null,toast=()=>{},fail=error=>console.error(error),menu=null,dialog=null,textDialog=null,openClip=null,extraMenuItems=()=>[],store,live}={}){
  Object.assign(this,{doc,win,engine,getProject,getPattern,getChannel,selection,gridValue:grid,barWidthValue:barWidth,noteLengthValue:noteLength,toast,fail,menuFn:menu,dialogFn:dialog,textDialogFn:textDialog,openClip,extraMenuItems});
  this.store=store||new PianoRollStore({engine,getProject});
  this.live=live||engine?.liveInstrument||new LiveInstrument({engine});
  this.tool='draw';this.cursor=0;this.clipboard=null;this.target='';this.needsFocus=true;this.gesture=null;this.typing=false;this.typingOctave=60;this.typingHeld=new Map();this.lastVelocity=.8;this.midi=null;this.disposers=[];
 }
 $(selector){return this.doc.querySelector(selector);}
 get window(){return this.$('#piano');}
 visible(){const win=this.window;return !!win&&!win.classList.contains('hidden');}
 grid(){const value=Number(this.gridValue());return Number.isFinite(value)&&value>0?value:.25;}
 barWidth(){const value=Number(this.barWidthValue());return Number.isFinite(value)&&value>0?value:112;}
 noteLength(){const value=Number(this.noteLengthValue?.()??this.$('#note-length')?.value);return Number.isFinite(value)&&value>0?value:this.grid();}
 snap(beat,mode='round'){const grid=this.grid();return Math.max(0,Math[mode](beat/grid+1e-9)*grid);}
 context(){const pattern=this.getPattern(),channel=this.getChannel();return {pattern,channel,notes:this.store.notes(pattern,channel?.id)||[]};}

 mount(){
  const win=this.window;if(!win)return this;
  if(!win.hasAttribute('tabindex'))win.setAttribute('tabindex','-1');
  this.installStyles();this.installControls();
  const grid=this.$('#piano-grid'),keys=this.$('#piano-keys'),velocity=this.$('#velocity-grid'),ruler=this.$('#piano-ruler');
  const on=(target,type,fn,options)=>{if(!target)return;target.addEventListener(type,fn,options);this.disposers.push(()=>target.removeEventListener(type,fn,options));};
  on(grid,'pointerdown',e=>this.gridDown(e));on(grid,'pointermove',e=>this.gesture?.move?.(e));on(grid,'pointerup',e=>this.gesture?.end?.(e));on(grid,'pointercancel',e=>this.gesture?.end?.(e,true));on(grid,'lostpointercapture',e=>this.gesture?.end?.(e));
  on(grid,'contextmenu',e=>this.noteContext(e));
  on(keys,'pointerdown',e=>this.keyDown(e));on(keys,'pointermove',e=>this.gesture?.move?.(e));on(keys,'pointerup',e=>this.gesture?.end?.(e));on(keys,'pointercancel',e=>this.gesture?.end?.(e,true));on(keys,'lostpointercapture',e=>this.gesture?.end?.(e));
  on(velocity,'pointerdown',e=>this.velocityDown(e));on(velocity,'pointermove',e=>this.gesture?.move?.(e));on(velocity,'pointerup',e=>this.gesture?.end?.(e));on(velocity,'pointercancel',e=>this.gesture?.end?.(e,true));on(velocity,'lostpointercapture',e=>this.gesture?.end?.(e));
  on(ruler,'click',e=>{const bar=e.target.closest?.('[data-piano-beat]');if(bar){this.cursor=finite(bar.dataset.pianoBeat);this.paintCursor();}});
  // Window capture runs before the Audacity document-capture shortcuts.
  on(this.win,'keydown',e=>this.keydown(e),true);on(this.win,'keyup',e=>this.keyup(e),true);
  on(this.doc,'dblclick',e=>this.timelineOpen(e),true);
  on(this.win,'blur',()=>this.releaseTyping());
  this.disposers.push(this.live.install?.(this.win)||(()=>{}));
  for(const type of ['status','saved','change','rejected','uncertain','external','refreshed'])on(this.store,type,event=>this.storeEvent(type,event.detail));
  if(typeof this.win?.MutationObserver==='function'||typeof MutationObserver==='function'){
   const Observer=this.win?.MutationObserver||MutationObserver,observer=new Observer(()=>{if(!this.visible()){this.cancelGesture();this.releaseTyping();this.live.releaseAll('closed');if(this.auditioned){this.auditioned=false;this.live.allNotesOff(this.getChannel?.(),'closed');}}});
   observer.observe(win,{attributes:true,attributeFilter:['class']});this.disposers.push(()=>observer.disconnect());
  }
  return this;
 }
 dispose(){for(const fn of this.disposers.splice(0))try{fn();}catch{}this.midi?.disable();this.live.releaseAll('dispose');}
 installStyles(){
  if(this.doc.querySelector('link[data-piano-roll-css]'))return;
  const link=this.doc.createElement('link');link.rel='stylesheet';link.href='piano-roll.css';link.dataset.pianoRollCss='';this.doc.head?.append(link);
 }
 installControls(){
  const draw=this.$('#piano-draw'),erase=this.$('#piano-erase'),clear=this.$('#piano-clear'),more=this.$('#piano-more'),title=this.$('#piano-title');
  if(draw&&!this.$('#piano-select')){const select=this.doc.createElement('button');select.id='piano-select';select.title='Select notes (F1) — drag to marquee';select.textContent='⬚';draw.after(select);}
  if(title&&!this.$('#piano-save-state')){const state=this.doc.createElement('button');state.id='piano-save-state';state.type='button';state.hidden=true;title.after(state);state.onclick=()=>this.verify();}
  const tools=this.$('#piano .piano-tools');
  if(tools&&!this.$('#piano-typing')){const typing=this.doc.createElement('button');typing.id='piano-typing';typing.title='Computer keyboard plays the instrument (A–K, Z/X octave)';typing.textContent='⌨';typing.setAttribute('aria-pressed','false');tools.append(typing);typing.onclick=()=>this.setTyping(!this.typing);}
  if(draw)draw.onclick=()=>this.setTool('draw');
  if(erase)erase.onclick=()=>this.setTool('erase');
  const select=this.$('#piano-select');if(select)select.onclick=()=>this.setTool('select');
  if(clear){clear.title='Delete all notes in this channel';clear.onclick=()=>{const {notes}=this.context();if(notes.length)this.commit([], 'Clear notes');};}
  if(more)more.onclick=e=>this.menu(e);
  this.paintTools();
 }
 setTool(tool){this.tool=tool;this.paintTools();}
 paintTools(){for(const [id,tool] of [['#piano-draw','draw'],['#piano-erase','erase'],['#piano-select','select']]){const el=this.$(id);if(el){el.classList.toggle('selected',this.tool===tool);el.setAttribute('aria-pressed',String(this.tool===tool));}}const grid=this.$('#piano-grid');if(grid)grid.dataset.tool=this.tool;}
 setTyping(enabled){this.typing=!!enabled;if(!this.typing)this.releaseTyping();const button=this.$('#piano-typing');if(button){button.classList.toggle('lit',this.typing);button.setAttribute('aria-pressed',String(this.typing));}}

 /* ---------- rendering ---------- */
 render(){
  if(!this.window)return;
  this.store.reconcile(this.getProject?.());
  const {pattern,channel,notes}=this.context(),target=`${pattern?.id}:${channel?.id}`;
  if(target!==this.target){this.selection.clear();this.cursor=0;this.needsFocus=true;this.cancelGesture();this.live.releaseAll('target-changed');}
  const ids=new Set(notes.map(n=>n.id));for(const id of [...this.selection])if(!ids.has(id))this.selection.delete(id);
  const bars=this.store.bars(pattern),totalBars=Math.max(16,Math.ceil(bars)+4);
  const title=this.$('#piano-title');if(title)title.textContent=`Piano roll - ${channel?.name||''}${this.selection.size?` (${this.selection.size} selected)`:''}`;
  const ruler=this.$('#piano-ruler');if(ruler)ruler.innerHTML=Array.from({length:totalBars},(_,i)=>`<div class="ruler-bar" data-piano-beat="${i*4}">${i+1}</div>`).join('');
  const keys=this.$('#piano-keys');if(keys&&keys.childElementCount!==128)keys.innerHTML=Array.from({length:128},(_,i)=>{const pitch=TOP_PITCH-i;return `<div class="piano-key ${BLACK.has(pitch%12)?'black':''}" data-pitch="${pitch}" title="${noteName(pitch)}"><span>${pitch%12===0?'C'+(Math.floor(pitch/12)-1):''}</span></div>`;}).join('');
  const grid=this.$('#piano-grid');
  if(grid&&!this.gesture?.liveDom){
   grid.dataset.top=String(TOP_PITCH);
   grid.innerHTML=Array.from({length:128},(_,i)=>BLACK.has((TOP_PITCH-i)%12)?`<div class="piano-grid-row" style="top:${i*ROW_HEIGHT}px"></div>`:'').join('')+notes.filter(n=>n.pitch>=0&&n.pitch<=127).map(n=>this.noteHtml(n)).join('')+`<div class="piano-edit-cursor" style="left:calc(${this.cursor/4} * var(--bar))"></div>`;
   grid.style.height=`${128*ROW_HEIGHT}px`;
  }
  const velocity=this.$('#velocity-grid');if(velocity&&!this.gesture?.liveDom)velocity.innerHTML=notes.map(n=>`<div class="velocity-bar ${this.selection.has(n.id)?'selected':''}" data-velocity="${esc(n.id)}" style="left:calc(${n.start/4} * var(--bar));height:${finite(n.velocity,.8)*65}px" title="Velocity ${Math.round(finite(n.velocity,.8)*100)}%"></div>`).join('');
  const wrap=this.$('.piano-grid-wrap');if(wrap){wrap.style.width=`calc(${KEY_GUTTER}px + ${totalBars} * var(--bar))`;wrap.style.height=`${128*ROW_HEIGHT+20}px`;}
  this.target=target;
  const scroll=this.$('#piano-scroll');
  if(scroll&&this.needsFocus&&this.visible()){const high=notes.length?Math.max(...notes.map(n=>n.pitch)):72;scroll.scrollTop=Math.max(0,(TOP_PITCH-Math.min(127,high+5))*ROW_HEIGHT);this.needsFocus=false;}
  if(scroll&&!scroll.dataset.pianoSync){scroll.dataset.pianoSync='1';scroll.addEventListener('scroll',()=>{const v=this.$('#velocity-grid');if(v)v.scrollLeft=scroll.scrollLeft;});}
  this.renderStatus();
 }
 noteHtml(n){return `<div class="piano-note ${this.selection.has(n.id)?'selected':''}" data-note="${esc(n.id)}" title="${noteName(n.pitch)} · velocity ${Math.round(finite(n.velocity,.8)*100)}%" style="left:calc(${n.start/4} * var(--bar));top:${(TOP_PITCH-n.pitch)*ROW_HEIGHT+2}px;width:calc(${n.duration/4} * var(--bar));--note-velocity:${finite(n.velocity,.8)}">${noteName(n.pitch)}<div class="note-resize"></div></div>`;}
 paintCursor(){const el=this.$('#piano-grid .piano-edit-cursor');if(el)el.style.left=`calc(${this.cursor/4} * var(--bar))`;}
 paintSelection(){for(const el of this.doc.querySelectorAll('#piano-grid .piano-note'))el.classList.toggle('selected',this.selection.has(el.dataset.note));for(const el of this.doc.querySelectorAll('#velocity-grid .velocity-bar'))el.classList.toggle('selected',this.selection.has(el.dataset.velocity));const {channel}=this.context(),title=this.$('#piano-title');if(title)title.textContent=`Piano roll - ${channel?.name||''}${this.selection.size?` (${this.selection.size} selected)`:''}`;}
 renderStatus(){
  const el=this.$('#piano-save-state');if(!el)return;const {pattern}=this.context(),status=this.store.status(pattern?.id);
  const text={idle:'',saving:'Saving…',saved:'Saved',uncertain:'Save unconfirmed — Verify',error:'Not saved'}[status.state]||'';
  el.hidden=!text;el.textContent=text;el.dataset.state=status.state;el.disabled=status.state!=='uncertain';el.title=status.state==='uncertain'?`The last save has no confirmed result (${status.error||'unknown'}). Click to resend the exact original request with its original idempotency key.`:status.state==='error'?`Freestyle rejected the last piano-roll save: ${status.error}`:'';
 }
 storeEvent(type,detail){
  if(type==='rejected')this.toast(`Piano-roll edit was not saved and was rolled back: ${detail.error?.message||detail.error||'rejected'}`);
  if(type==='uncertain')this.toast('The piano-roll save did not return a result. Edits to this pattern are paused; click “Verify” to resend the exact original request.');
  if(type==='external')this.toast(detail.message);
  if((type==='change'||type==='rejected'||type==='external')&&!this.gesture)this.render();else this.renderStatus();
 }

 /* ---------- editing ---------- */
 blockedReason(){const {pattern,channel}=this.context();if(!channel||channel.id==='empty')return 'Add a cloud instrument channel before drawing notes.';return this.store.blocked(pattern);}
 commit(nextNotes,label='Edit notes'){
  const {pattern,channel}=this.context(),result=this.store.apply(pattern,channel.id,nextNotes,{label});
  if(!result.ok){this.toast(result.reason);this.render();return false;}
  this.render();return true;
 }
 selectedNotes(all=false){const {notes}=this.context();return this.selection.size?notes.filter(n=>this.selection.has(n.id)):all?notes:[];}
 transform(fn,label='Edit notes'){
  const {notes}=this.context(),targets=this.selectedNotes(true);if(!targets.length){this.toast('Draw notes in this channel first.');return false;}
  const changes=new Map(fn(clone(targets)).map(n=>[n.id,n]));return this.commit(notes.map(n=>changes.get(n.id)||n),label);
 }
 deleteSelected(){const {notes}=this.context();if(!this.selection.size)return false;const next=notes.filter(n=>!this.selection.has(n.id));this.selection.clear();return this.commit(next,'Delete notes');}
 selectAll(){for(const n of this.context().notes)this.selection.add(n.id);this.paintSelection();}
 clearSelection(){this.selection.clear();this.paintSelection();}
 copy(){const targets=this.selectedNotes(true);if(!targets.length){this.toast('Select notes to copy.');return null;}this.clipboard=Tools.copySelectedNotes(targets);this.toast(`${this.clipboard.notes.length} note${this.clipboard.notes.length===1?'':'s'} copied.`);return this.clipboard;}
 cut(){if(!this.selection.size)return false;this.copy();return this.deleteSelected();}
 paste(at=this.cursor){
  if(!this.clipboard){this.toast('Copy some piano notes first.');return false;}
  const reason=this.blockedReason();if(reason){this.toast(reason);return false;}
  const {notes}=this.context(),pasted=Tools.pasteNotes(this.clipboard,{at:this.snap(at),existingNotes:notes,idFactory:uid}).map(n=>{delete n.cloudRaw;return n;});
  this.selection.clear();pasted.forEach(n=>this.selection.add(n.id));this.cursor=this.snap(at)+this.clipboard.spanBeats;
  return this.commit([...notes,...pasted],'Paste notes');
 }
 duplicate(){
  const targets=this.selectedNotes();if(!targets.length){this.toast('Select notes to duplicate.');return false;}
  const {notes}=this.context(),span=Math.max(...targets.map(n=>n.start+n.duration))-Math.min(...targets.map(n=>n.start)),offset=Math.max(this.grid(),Math.ceil((span-1e-9)/this.grid())*this.grid());
  const copies=Tools.duplicateNotes(targets,{offset,existingNotes:notes,idFactory:uid}).map(n=>{delete n.cloudRaw;return n;});
  this.selection.clear();copies.forEach(n=>this.selection.add(n.id));return this.commit([...notes,...copies],'Duplicate notes');
 }
 quantize(options={grid:this.grid(),strength:1,quantizeEnds:false}){return this.transform(notes=>Tools.quantizeNotes(notes,options),'Quantize');}
 nudge({deltaStart=0,deltaPitch=0,deltaDuration=0}){
  if(!this.selection.size)return false;
  return this.transform(notes=>deltaDuration?Tools.resizeNotes(notes,deltaDuration,Math.min(this.grid(),...notes.map(n=>n.duration))):Tools.moveNotes(notes,{deltaStart,deltaPitch}),'Move notes');
 }
 setVelocity(value){const v=Math.max(.01,Math.min(1,Number(value)));if(!Number.isFinite(v))return false;this.lastVelocity=v;return this.transform(notes=>notes.map(n=>({...n,velocity:v})),'Velocity');}
 history(direction){
  const {pattern,channel}=this.context(),result=direction==='undo'?this.store.undo(pattern,channel?.id):this.store.redo(pattern,channel?.id);
  if(!result.ok){this.toast(result.reason);return false;}
  this.render();return true;
 }
 async verify(){const {pattern}=this.context();const result=await this.store.verify(pattern?.id);if(result.ok)this.toast('Piano-roll save confirmed by Freestyle.');else if(result.reason)this.toast(result.reason);this.render();return result;}

 /* ---------- pointer gestures ---------- */
 point(e,el=this.$('#piano-grid')){const rect=el.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;return {x,y,beat:Math.max(0,x/this.barWidth()*4),pitch:Math.max(0,Math.min(127,TOP_PITCH-Math.floor(y/ROW_HEIGHT)))};}
 capture(el,e){try{el.setPointerCapture?.(e.pointerId);}catch{}}
 focus(){try{this.window?.focus({preventScroll:true});}catch{}}
 audition(pitch,velocity=this.lastVelocity){const {channel}=this.context();const result=this.live.noteOn(channel,pitch,{velocity,source:'visual'});if(result.sent)this.auditioned=true;if(!result.sent&&result.reason==='offline')this.offlineHint();return result.sent?pitch:null;}
 release(pitch){if(pitch==null)return;const {channel}=this.context();this.live.noteOff(channel,pitch);}
 offlineHint(){const now=Date.now();if(now-(this.lastOfflineHint||0)<4000)return;this.lastOfflineHint=now;this.toast('Connecting live cloud audio… the instrument plays once the Freestyle monitor is connected.');}
 cancelGesture(){const gesture=this.gesture;if(gesture){this.gesture=null;try{gesture.cancel?.();}catch{}}}
 gridDown(e){
  if(e.button!==0||this.gesture)return;
  const grid=this.$('#piano-grid'),noteEl=e.target.closest?.('.piano-note'),reason=this.blockedReason();this.focus();
  const {notes}=this.context(),pos=this.point(e,grid);
  if(reason){if(!noteEl&&!(e.shiftKey||e.metaKey||e.ctrlKey||this.tool==='select'))this.toast(reason);}
  if(noteEl){
   const note=notes.find(n=>n.id===noteEl.dataset.note);if(!note)return;e.stopPropagation();
   if(e.shiftKey||e.metaKey||e.ctrlKey){this.selection.has(note.id)?this.selection.delete(note.id):this.selection.add(note.id);this.paintSelection();return;}
   if(reason)return;
   if(this.tool==='erase'){this.selection.delete(note.id);this.commit(notes.filter(n=>n.id!==note.id),'Delete note');return;}
   if(!this.selection.has(note.id)){this.selection.clear();this.selection.add(note.id);}
   this.cursor=note.start;this.lastVelocity=finite(note.velocity,this.lastVelocity);this.paintSelection();
   return this.beginNoteDrag(e,grid,note,e.target.closest?.('.note-resize')?'resize':'move');
  }
  if(this.tool==='select'||e.shiftKey||e.metaKey||e.ctrlKey)return this.beginMarquee(e,grid,pos);
  if(reason)return;
  if(this.tool==='erase')return this.beginErase(e,grid,pos);
  this.cursor=this.snap(pos.beat,'floor');
  return this.beginDraw(e,grid,pos);
 }
 beginNoteDrag(e,grid,anchor,mode){
  const {notes}=this.context(),group=notes.filter(n=>this.selection.has(n.id)),initial=clone(group),start={x:e.clientX,y:e.clientY},elements=new Map([...grid.querySelectorAll('.piano-note')].map(el=>[el.dataset.note,el]));
  let current=initial,sounding=this.audition(anchor.pitch,anchor.velocity),pitch=anchor.pitch;this.capture(grid,e);
  const update=ev=>{
   const free=ev.altKey,dx=(ev.clientX-start.x)/this.barWidth()*4;
   if(mode==='resize'){const end=anchor.start+anchor.duration,raw=end+dx,grid=this.grid(),target=free?raw:this.snap(raw),minimum=free?Tools.MIN_NOTE_DURATION:Math.min(grid,anchor.duration);current=Tools.resizeNotes(initial,Math.max(anchor.start+minimum,target)-end);}
   else{const raw=anchor.start+dx,deltaStart=(free?raw:this.snap(raw))-anchor.start,deltaPitch=-Math.round((ev.clientY-start.y)/ROW_HEIGHT);current=Tools.moveNotes(initial,{deltaStart,deltaPitch});}
   for(const n of current){const el=elements.get(n.id);if(el){el.style.left=`${n.start/4*this.barWidth()}px`;el.style.top=`${(TOP_PITCH-n.pitch)*ROW_HEIGHT+2}px`;el.style.width=`${n.duration/4*this.barWidth()}px`;el.firstChild&&(el.firstChild.textContent=noteName(n.pitch));}}
   const moved=current.find(n=>n.id===anchor.id);if(moved&&moved.pitch!==pitch){this.release(sounding);pitch=moved.pitch;sounding=this.audition(pitch,anchor.velocity);}
  };
  this.gesture={liveDom:true,move:update,cancel:()=>{this.release(sounding);this.render();},end:(ev,cancelled)=>{
   if(this.gesture?.liveDom!==true)return;this.gesture=null;this.release(sounding);
   const changes=new Map(current.map(n=>[n.id,n])),modified=current.some((n,i)=>n.start!==initial[i].start||n.pitch!==initial[i].pitch||n.duration!==initial[i].duration);
   if(cancelled||!modified){this.render();return;}
   this.commit(notes.map(n=>changes.get(n.id)||n),mode==='resize'?'Resize notes':'Move notes');
  }};
 }
 beginDraw(e,grid,pos){
  const {notes}=this.context(),length=this.noteLength(),note={id:uid(),pitch:pos.pitch,start:this.snap(pos.beat,'floor'),duration:length,velocity:this.lastVelocity};
  const el=this.doc.createElement('div');el.className='piano-note selected drawing';el.dataset.note=note.id;el.style.cssText=`left:${note.start/4*this.barWidth()}px;top:${(TOP_PITCH-note.pitch)*ROW_HEIGHT+2}px;width:${note.duration/4*this.barWidth()}px`;el.textContent=noteName(note.pitch);grid.append(el);
  const sounding=this.audition(note.pitch,note.velocity);this.capture(grid,e);
  this.gesture={liveDom:true,move:ev=>{const beat=this.point(ev,grid).beat,end=ev.altKey?beat:this.snap(beat,'ceil');if(end>note.start+(ev.altKey?Tools.MIN_NOTE_DURATION:this.grid())-1e-9&&beat>note.start+length){note.duration=end-note.start;el.style.width=`${note.duration/4*this.barWidth()}px`;}},
   cancel:()=>{this.release(sounding);el.remove();},
   end:(ev,cancelled)=>{if(this.gesture?.liveDom!==true)return;this.gesture=null;this.release(sounding);if(cancelled){el.remove();return;}this.selection.clear();this.selection.add(note.id);this.commit([...notes,note],'Draw note');}};
 }
 beginMarquee(e,grid,pos){
  const additive=e.shiftKey||e.metaKey||e.ctrlKey,initial=additive?new Set(this.selection):new Set(),box=this.doc.createElement('div');box.className='piano-selection-box';grid.append(box);this.capture(grid,e);
  let end=pos;this.cursor=this.snap(pos.beat,'floor');
  const paint=()=>{const left=Math.min(pos.x,end.x),top=Math.min(pos.y,end.y);box.style.cssText=`left:${left}px;top:${top}px;width:${Math.abs(end.x-pos.x)}px;height:${Math.abs(end.y-pos.y)}px`;};
  this.gesture={move:ev=>{const p=this.point(ev,grid);end={...p,x:Math.max(0,p.x),y:Math.max(0,p.y)};paint();},cancel:()=>box.remove(),end:()=>{
   this.gesture=null;box.remove();const left=Math.min(pos.x,end.x),right=Math.max(pos.x,end.x),upper=Math.min(pos.y,end.y),lower=Math.max(pos.y,end.y),bw=this.barWidth();
   this.selection.clear();initial.forEach(id=>this.selection.add(id));
   for(const n of this.context().notes){const nx=n.start/4*bw,ny=(TOP_PITCH-n.pitch)*ROW_HEIGHT;if(nx+n.duration/4*bw>=left&&nx<=right&&ny+ROW_HEIGHT>=upper&&ny<=lower)this.selection.add(n.id);}
   this.paintSelection();this.paintCursor();
  }};
 }
 beginErase(e,grid){
  const {notes}=this.context(),erased=new Set();this.capture(grid,e);
  const hit=ev=>{const p=this.point(ev,grid),bw=this.barWidth();for(const n of notes){if(n.pitch===p.pitch&&p.x>=n.start/4*bw&&p.x<=(n.start+n.duration)/4*bw&&!erased.has(n.id)){erased.add(n.id);const el=[...grid.querySelectorAll('.piano-note')].find(x=>x.dataset.note===n.id);if(el)el.hidden=true;}}};
  hit(e);this.gesture={liveDom:true,move:hit,cancel:()=>this.render(),end:(ev,cancelled)=>{if(this.gesture?.liveDom!==true)return;this.gesture=null;if(cancelled||!erased.size){this.render();return;}for(const id of erased)this.selection.delete(id);this.commit(notes.filter(n=>!erased.has(n.id)),'Erase notes');}};
 }
 keyDown(e){
  if(e.button!==0||this.gesture)return;const keys=this.$('#piano-keys'),pitch=this.point(e,keys).pitch;this.focus();this.capture(keys,e);
  let sounding=this.audition(pitch,.82),current=pitch;const el=key=>[...keys.querySelectorAll('.piano-key')].find(k=>Number(k.dataset.pitch)===key);el(pitch)?.classList.add('active');
  this.gesture={move:ev=>{const next=this.point(ev,keys).pitch;if(next===current)return;el(current)?.classList.remove('active');this.release(sounding);current=next;sounding=this.audition(current,.82);el(current)?.classList.add('active');},cancel:()=>{this.release(sounding);el(current)?.classList.remove('active');},end:()=>{this.gesture=null;this.release(sounding);el(current)?.classList.remove('active');}};
 }
 velocityDown(e){
  const bar=e.target.closest?.('.velocity-bar');if(e.button!==0||!bar||this.gesture)return;const reason=this.blockedReason();if(reason){this.toast(reason);return;}
  const {notes}=this.context(),note=notes.find(n=>n.id===bar.dataset.velocity);if(!note)return;this.focus();
  if(!this.selection.has(note.id)){this.selection.clear();this.selection.add(note.id);this.paintSelection();}
  const group=notes.filter(n=>this.selection.has(n.id)),initial=new Map(group.map(n=>[n.id,finite(n.velocity,.8)])),y=e.clientY,velocity=this.$('#velocity-grid'),bars=new Map([...velocity.querySelectorAll('.velocity-bar')].map(el=>[el.dataset.velocity,el]));let values=new Map(initial);this.capture(velocity,e);
  this.gesture={liveDom:true,move:ev=>{const delta=(y-ev.clientY)/65;values=new Map([...initial].map(([id,v])=>[id,Math.max(.01,Math.min(1,Math.round((v+delta)*1000)/1000))]));for(const [id,v] of values){const el=bars.get(id);if(el)el.style.height=`${v*65}px`;}},cancel:()=>this.render(),end:(ev,cancelled)=>{if(this.gesture?.liveDom!==true)return;this.gesture=null;if(cancelled||[...values].every(([id,v])=>v===initial.get(id))){this.render();return;}this.lastVelocity=values.get(note.id);this.commit(notes.map(n=>values.has(n.id)?{...n,velocity:values.get(n.id)}:n),'Velocity');}};
 }
 noteContext(e){const el=e.target.closest?.('.piano-note');if(!el){e.preventDefault();this.menu(e);return;}e.preventDefault();const reason=this.blockedReason();if(reason){this.toast(reason);return;}const {notes}=this.context();this.selection.delete(el.dataset.note);this.commit(notes.filter(n=>n.id!==el.dataset.note),'Delete note');}

 /* ---------- keyboard ---------- */
 owns(e){const win=this.window;if(!this.visible()||!win)return false;const active=this.doc.activeElement;return win.contains(e.target)||(!!active&&win.contains(active));}
 keydown(e){
  if(!this.owns(e)||this.doc.querySelector('dialog[open]'))return;
  if(e.target.closest?.(FIELD))return;
  const meta=e.metaKey||e.ctrlKey,key=String(e.key||'').toLowerCase(),stop=()=>{e.preventDefault();e.stopImmediatePropagation();};
  if(this.typing&&!meta&&!e.altKey){
   if(e.code==='KeyZ'||e.code==='KeyX'){stop();if(!e.repeat){this.releaseTyping();this.typingOctave=Math.max(0,Math.min(120,this.typingOctave+(e.code==='KeyZ'?-12:12)));this.toast(`Typing keyboard octave C${this.typingOctave/12-1}`);}return;}
   const note=typingNote(e.code,this.typingOctave);if(note!=null){stop();if(!e.repeat&&!this.typingHeld.has(e.code)){const sounding=this.audition(note,this.lastVelocity);if(sounding!=null)this.typingHeld.set(e.code,sounding);}return;}
  }
  if(meta&&key==='z'){stop();if(!e.repeat)this.history(e.shiftKey?'redo':'undo');return;}
  if(meta&&key==='y'){stop();if(!e.repeat)this.history('redo');return;}
  if(meta&&!e.shiftKey&&key==='a'){stop();this.selectAll();return;}
  if(meta&&e.shiftKey&&key==='a'){stop();this.clearSelection();return;}
  if(meta&&key==='c'){stop();this.copy();return;}
  if(meta&&key==='x'){stop();if(!e.repeat)this.cut();return;}
  if(meta&&key==='v'){stop();if(!e.repeat)this.paste();return;}
  if(meta&&key==='d'){stop();if(!e.repeat)this.duplicate();return;}
  if(e.altKey&&!meta&&e.code==='KeyQ'){stop();this.quantizeDialog();return;}
  if(!meta&&!e.altKey&&key==='q'){stop();if(!e.repeat)this.quantize();return;}
  if(!meta&&(key==='delete'||key==='backspace')){stop();if(!e.repeat)this.deleteSelected();return;}
  if(key==='escape'){stop();this.cancelGesture();this.clearSelection();return;}
  if(!meta&&!e.altKey&&!e.shiftKey&&['f1','f3'].includes(key)){stop();this.setTool(key==='f1'?'select':'draw');return;}
  if(['arrowleft','arrowright','arrowup','arrowdown'].includes(key)&&this.selection.size){
   stop();const step=e.altKey?Tools.MIN_NOTE_DURATION*4:this.grid();
   if(key==='arrowup'||key==='arrowdown'){const sign=key==='arrowup'?1:-1;this.nudge({deltaPitch:sign*(e.shiftKey?12:1)});return;}
   const sign=key==='arrowright'?1:-1;if(e.shiftKey)this.nudge({deltaDuration:sign*step});else this.nudge({deltaStart:sign*step});return;
  }
 }
 keyup(e){const held=this.typingHeld.get(e.code);if(held!=null){this.typingHeld.delete(e.code);this.release(held);}}
 releaseTyping(){for(const pitch of this.typingHeld.values())this.release(pitch);this.typingHeld.clear();}

 /* ---------- menus, dialogs, timeline ---------- */
 quantizeDialog(){
  if(!this.dialogFn)return this.quantize();
  const d=this.dialogFn('Piano roll — Quantize',`<p>Quantize ${this.selection.size?'selected notes':'this channel'}.</p><label>Grid</label><select id="quantize-grid"><option value=".125">1/32 note</option><option value=".25" selected>1/16 note</option><option value=".5">1/8 note</option><option value="1">1/4 note</option></select><label>Strength <span id="quantize-strength-label">100%</span></label><input id="quantize-strength" type="range" min="0" max="1" step=".05" value="1" style="width:100%"><label><input id="quantize-ends" type="checkbox"> Quantize note ends</label><button id="quantize-apply" class="primary">Quantize</button>`);
  d.querySelector('#quantize-strength').oninput=ev=>d.querySelector('#quantize-strength-label').textContent=`${Math.round(+ev.target.value*100)}%`;
  d.querySelector('#quantize-apply').onclick=()=>{this.quantize({grid:+d.querySelector('#quantize-grid').value,strength:+d.querySelector('#quantize-strength').value,quantizeEnds:d.querySelector('#quantize-ends').checked});d.close();};
  return d;
 }
 menu(e){
  if(!this.menuFn)return;const {pattern,channel}=this.context(),status=this.store.status(pattern?.id),has=this.selection.size>0;
  const extra=(()=>{try{return this.extraMenuItems()||[];}catch{return [];}})();
  this.menuFn(e,[...extra,...(extra.length?[null]:[]),
   ['Undo','⌘Z',()=>this.history('undo'),!this.store.canUndo(pattern?.id,channel?.id)],['Redo','⌘⇧Z',()=>this.history('redo'),!this.store.canRedo(pattern?.id,channel?.id)],null,
   ['Select all notes','⌘A',()=>this.selectAll()],['Clear selection','Esc',()=>this.clearSelection(),!has],null,
   ['Cut','⌘X',()=>this.cut(),!has],['Copy','⌘C',()=>this.copy()],['Paste at cursor','⌘V',()=>this.paste(),!this.clipboard],['Duplicate','⌘D',()=>this.duplicate(),!has],['Delete','Delete',()=>this.deleteSelected(),!has],null,
   ['Quantize to grid','Q',()=>this.quantize()],['Quantize…','⌥Q',()=>this.quantizeDialog()],['Transpose up an octave','⇧↑',()=>this.transform(n=>Tools.transposeNotes(n,12),'Transpose')],['Transpose down an octave','⇧↓',()=>this.transform(n=>Tools.transposeNotes(n,-12),'Transpose')],['Legato','',()=>this.transform(n=>Tools.legatoNotes(n,this.store.bars(pattern)*4),'Legato')],
   ['Set velocity…','',()=>this.textDialogFn?.('Note velocity','Velocity (1–127)',String(Math.round(this.lastVelocity*127)),v=>{const n=Number(v);if(Number.isFinite(n)&&n>=1&&n<=127)this.setVelocity(n/127);else this.toast('Enter a velocity from 1 to 127.');})],
   ['Scale velocity…','',()=>this.textDialogFn?.('Scale velocity','Velocity multiplier (0–2)','1',v=>{if(+v>=0&&+v<=2)this.transform(n=>Tools.scaleNoteVelocities(n,+v),'Velocity');})],null,
   [this.typing?'Disable computer keyboard notes':'Enable computer keyboard notes','⌨',()=>this.setTyping(!this.typing)],
   [this.midi?'Disable MIDI keyboard input':'Enable MIDI keyboard input','',()=>this.toggleMidi()],
   ['Release all sounding notes','',()=>this.live.releaseAll('panic')],
   ...(status.state==='uncertain'?[null,['Verify unconfirmed save','',()=>this.verify()]]:[]),
  ]);
 }
 async toggleMidi(){
  if(this.midi){this.midi.disable();this.midi=null;this.toast('MIDI keyboard input disabled.');return false;}
  const input=new MidiInput({navigator:this.win?.navigator,onNote:(note,on,velocity)=>{if(on)this.audition(note,velocity);else this.release(note);},onAllOff:()=>this.live.releaseAll('midi-all-off')});
  try{const count=await input.enable();this.midi=input;this.toast(count?`MIDI keyboard input enabled (${count} input${count===1?'':'s'}).`:'MIDI input enabled. Connect a MIDI keyboard to play the selected instrument.');return true;}catch(error){this.fail(error);return false;}
 }
 timelineOpen(e){
  // The selection gesture captures the pointer on the lane, so Chrome retargets
  // click/dblclick to .au-lane; hit-test the actual point as a fallback.
  const hit=e.target.closest?.('.au-midi-clip')?e.target:(Number.isFinite(e.clientX)&&this.doc.elementFromPoint?.(e.clientX,e.clientY))||e.target;
  const clip=hit?.closest?.('.au-midi-clip');if(!clip||hit.closest('.au-clip-head>span,button,input'))return;
  if(typeof this.openClip==='function'){this.openClip(clip.dataset.clip);}
 }
}
