/** Disabelton shell (Ableton Live 12 style) layered over the inherited engine,
 * transport and history handlers. Owns presentation and routing only: every
 * edit, mix change and transport command goes through a handler app.js passes
 * in (`api`), so Play/Stop stay on the fast mozart-control path and edits stay
 * on the guarded optimistic / history paths.
 *
 *  - control bar (Tap, BPM, signature, metronome, grid, position, ▶ ■ ●, loop, draw, views)
 *  - Live application menus (File Edit Create View Options Help)
 *  - Arrangement View: right-side track headers, Live clip / track / empty-lane menus,
 *    double-click → Clip View, track click → Device View
 *  - Session View (abl-session.js), Browser (Live sidebar) and the Live key map (abl-keys.js)
 */
import {ablLayout as defaultLayout} from './abl-layout.js';
import {STUDIO_VIEWS,activeStudioView,embeddedInFreestyle,openFreestyleMozart,openFreestyleShare,switchStudioView} from './freestyle-host-actions.js';
import {installAblKeys,ABL_GRID_STEPS,ABL_KEY_HELP} from './abl-keys.js';
import {renderSession,PATTERN_MIME,neighbourSlotIndex} from './abl-session.js';
import {scenePreviews,MAX_SCENE_CLIPS,LAUNCH_QUANTIZE_CHOICES} from './abl-scene-launch.js';
import {ablCopy} from './ui-copy.js';
import {laneDuplicateAvailability} from './studio-api-engine-helpers.js';
import {deleteTrackAvailability} from './playlist-track-menu.js';
import {ABL_LIVE_PALETTE,ABL_COLOR_LIMIT_NOTE,ablLaneColors,trackSplitTargets} from './abl-track-ops.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const svg=body=>`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="square">${body}</svg>`;
export const ABL_ICONS=Object.freeze({
 browser:svg('<path d="M2 3h12v10H2zM6 3v10"/>'),
 metronome:svg('<path d="M5 14 7 2h2l2 12zM4 14h8M8 10l4-5"/>'),
 loop:svg('<path d="M3 6h9l-2-2M13 10H4l2 2"/>'),
 pencil:svg('<path d="M3 13l1-3 7-7 2 2-7 7zM10 4l2 2"/>'),
 follow:svg('<path d="M3 3l9 5-9 5z" fill="currentColor"/>'),
 session:svg('<path d="M2 3h3v2H2zM6.5 3h3v2h-3zM11 3h3v2h-3zM2 7h3v2H2zM6.5 7h3v2h-3zM11 7h3v2h-3zM2 11h3v2H2zM6.5 11h3v2h-3z" fill="currentColor" stroke="none"/>'),
 arrangement:svg('<path d="M2 3h8v2H2zM5 7h9v2H5zM2 11h6v2H2z" fill="currentColor" stroke="none"/>')
});

/** "B:SS:TT" (bar : sixteenth step 1–16 : tick) → Live "B. b. s" (bars . beats . sixteenths). */
export function livePosition(text){
 // QA r14: the count-in text ("-1.2.1", app.js countInText) is already in Live's form; it used to fall through to "-. -. -".
 const countIn=/^-(\d+)\.(\d+)\.(\d+)$/.exec(String(text||'').trim());if(countIn)return `-${Number(countIn[1])}. ${Number(countIn[2])}. ${Number(countIn[3])}`;
 const match=/^(\d+):(\d+):(\d+)$/.exec(String(text||'').trim());if(!match)return '-. -. -';
 const step=Math.max(1,Number(match[2]));return `${Number(match[1])}. ${Math.floor((step-1)/4)+1}. ${(step-1)%4+1}`;
}
/** Beats (quarter notes, 4/4) → Live position "B. b. s" (1-based) or length "B. b. s" (0-based). */
export function beatsToLive(beats,{length=false,beatsPerBar=4}={}){
 const value=Math.max(0,Number(beats)||0),sixteenths=Math.round(value*4),perBar=beatsPerBar*4,bar=Math.floor(sixteenths/perBar),beat=Math.floor(sixteenths%perBar/4),six=sixteenths%4;
 return length?`${bar}. ${beat}. ${six}`:`${bar+1}. ${beat+1}. ${six+1}`;
}
/** Parse a Live position / length ("5", "5.3", "5. 3. 2", "5 3 2") → beats; null when invalid. */
export function liveToBeats(text,{length=false,beatsPerBar=4}={}){
 const parts=String(text||'').trim().split(/[\s.,:]+/).filter(Boolean).map(Number);if(!parts.length||parts.length>3||parts.some(value=>!Number.isFinite(value)||value<0))return null;
 const [bar,beat=length?0:1,six=length?0:1]=parts,offset=length?0:1;if(!length&&(bar<1||beat<1||six<1))return null;
 const beats=(bar-offset)*beatsPerBar+(beat-offset)+(six-offset)/4;return beats>=0?beats:null;
}
/** Tap tempo: BPM from the last taps (null until two taps inside the window). */
export function tapTempo(times,{windowMs=2000,maxTaps=8}={}){
 const recent=[];for(let index=times.length-1;index>=0&&recent.length<maxTaps;index--){if(recent.length&&recent[0]-times[index]>windowMs)break;recent.unshift(times[index]);}
 if(recent.length<2)return null;const span=(recent.at(-1)-recent[0])/(recent.length-1);if(!(span>0))return null;
 return Math.max(20,Math.min(999,Math.round(60000/span*100)/100));
}
/** Live track heights: compact (title strip + tiny preview) and unfolded (notes / waveform readable). */
export const ABL_TRACK_HEIGHT=Object.freeze({folded:24,unfolded:64});
/**
 * Arrangement geometry with the track headers on the right. The grid starts at the viewport's left edge
 * (#arrangement is shifted left by the gutter) and the header column is flush with the viewport's right
 * edge, so the vertical scrollbar sits to the right of the headers at any window width. The arrangement
 * must be at least viewport + gutter wide, otherwise the sticky headers stop at its end mid-screen.
 */
export function arrangementGeometry({viewportWidth,gutter,arrangementWidth=0}){
 const view=Math.max(0,Number(viewportWidth)||0),g=Math.max(0,Number(gutter)||0),minWidth=view+g,width=Math.max(Number(arrangementWidth)||0,minWidth);
 const headerLeft=Math.max(0,Math.min(view-g,width-g-g));
 return{gridLeft:0,gridRight:headerLeft,headerLeft,headerRight:headerLeft+g,minArrangementWidth:minWidth,arrangementWidth:width,deadSpace:Math.max(0,view-(headerLeft+g))};
}
/**
 * Live's zoom-adaptive grid: the finest step (beats) whose lines are at least `minPx` apart at the
 * current zoom (`barPx` = pixels per 4/4 bar). `density` > 0 narrows (⌘1), < 0 widens (⌘2).
 */
export function adaptiveGridBeats(barPx,{density=0,minPx=14,beatsPerBar=4}={}){
 const perBeat=Math.max(0,Number(barPx)||0)/beatsPerBar;if(!(perBeat>0))return .25;
 let index=ABL_GRID_STEPS.findIndex(step=>step*perBeat>=minPx);if(index<0)index=ABL_GRID_STEPS.length-1;
 return ABL_GRID_STEPS[Math.max(0,Math.min(ABL_GRID_STEPS.length-1,index-Math.round(Number(density)||0)))];
}
const GRID_LABEL=value=>({0:'None',0.125:'1/32',0.25:'1/16',0.5:'1/8',1:'1/4',2:'1/2',4:'1 Bar',8:'2 Bars'})[value]||`${value} beats`;

/** Time ruler steps (seconds) and labels: whole seconds as m:ss, finer steps as m:ss.mmm (or with microsecond digits). */
export const TIME_RULER_STEPS=Object.freeze([.00002,.00005,.0001,.0002,.0005,.001,.002,.005,.01,.02,.05,.1,.2,.5,1,2,5,10,15,30,60,120,300,600]);
export function timeRulerLabel(seconds,step=1){
 const digits=step>=1?0:step>=.001?3:5,scale=10**digits,total=Math.round(seconds*scale),whole=Math.floor(total/scale),fraction=total-whole*scale;
 return `${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}${digits?'.'+String(fraction).padStart(digits,'0'):''}`;
}
/** Beat ruler steps (quarter notes) below one bar and their labels: bars.beats(.sixteenths(.hundredths of a sixteenth)). */
export const BEAT_RULER_STEPS=Object.freeze([.00025,.0005,.001,.0025,.005,.0125,.025,.0625,.125,.25,1,4]);
export function beatRulerLabel(beats,step=1){
 const total=Math.round(beats*4000)/4000,bar=Math.floor(total/4),inBar=total-bar*4,beat=Math.floor(inBar+1e-9),inBeat=inBar-beat,sixteenth=Math.floor(inBeat*4+1e-9),rest=Math.round((inBeat*4-sixteenth)*1000);
 if(step>=1)return `${bar+1}.${beat+1}`;
 if(step>=.25)return `${bar+1}.${beat+1}.${sixteenth+1}`;
 return `${bar+1}.${beat+1}.${sixteenth+1}.${String(rest).padStart(3,'0')}`;
}
export {ablCopy};

/**
 * @param {object} api app bridge (see app.js "Disabelton Live shell").
 */
export function installAblShell(api){
 const doc=api.document||globalThis.document,view=doc.defaultView||globalThis,$=selector=>doc.querySelector(selector),$$=selector=>[...doc.querySelectorAll(selector)];
 const layout=api.layout||defaultLayout,logic=api.logicShell||null,hooks=api.hooks||{};
 const disposers=[];const on=(target,type,listener,options)=>{if(!target)return;target.addEventListener(type,listener,options);disposers.push(()=>target.removeEventListener(type,listener,options));};
 const safe=run=>(...args)=>{try{const result=run(...args);if(result&&typeof result.catch==='function')result.catch(api.fail);return result;}catch(error){api.fail(error);return null;}};
 const toast=message=>api.toast(message);
 const ops=api.trackOps||null;
 let ownTrack=null;
 // The selected track is the Logic shell's (one source of truth for Inspector strips, track commands and the Mixer).
 const state={get selectedTrack(){const row=logic?.state?logic.state.selectedTrack:ownTrack;return Number.isInteger(row)?row:null;},set selectedTrack(row){ownTrack=row;if(logic?.state)logic.state.selectedTrack=row;},taps:[],tapTimer:null,sessionDirty:true,disposers};
 layout.mount?.();doc.body.classList.add('abl-headers-right','abl-live');
 // Geometry: the grid starts at the viewport's left edge (headers on the right).
 try{if(api.timelineViewport)api.timelineViewport.gutter=0;}catch{}
 try{if(api.playlistLayout)api.playlistLayout.headerSide='right';}catch{}
 // Logic key map off; Live's on.
 try{logic?.disableKeys?.();}catch{}

 // ── Icons
 const icon=(selector,name)=>{const el=$(selector);if(el&&!el.querySelector('svg'))el.insertAdjacentHTML('afterbegin',ABL_ICONS[name]);};
 for(const [selector,name]of [['#abl-browser-toggle','browser'],['#metronome','metronome'],['#logic-cycle','loop'],['#abl-draw','pencil'],['#abl-follow','follow'],['#abl-view-session','session'],['#abl-view-arrangement','arrangement']])icon(selector,name);
 const metronome=$('#metronome');if(metronome&&metronome.firstChild?.nodeType===3)metronome.firstChild.remove();

 // ── Status bar: the hint line lives at the bottom-left, as Live's status bar.
 const hint=$('#hint'),statusHint=$('#abl-status-hint');
 if(hint&&statusHint&&hint.parentElement!==statusHint.parentElement){statusHint.replaceWith(hint);hint.classList.add('abl-status-hint');}
 const wording=element=>{if(!element)return;const Observer=view.MutationObserver||globalThis.MutationObserver;if(!Observer)return;const observer=new Observer(()=>{const next=ablCopy(element.textContent);if(next!==element.textContent)element.textContent=next;});observer.observe(element,{childList:true,characterData:true,subtree:true});disposers.push(()=>observer.disconnect());};
 wording($('#status-message'));
 // Inherited dialogs (Rename Region…, region properties) speak Live: title and labels through ablCopy.
 function liveDialogCopy(dialog){
  const Walker=view.NodeFilter||globalThis.NodeFilter,walker=doc.createTreeWalker?.(dialog,Walker?.SHOW_TEXT??4);if(!walker)return;
  const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  for(const node of nodes){if(node.parentElement?.closest?.('input,textarea,select,option,[contenteditable],pre,code,output,samp,[data-raw-copy]'))continue;const raw=node.nodeValue,trimmed=raw.trim();if(!trimmed)continue;const next=ablCopy(trimmed);if(next!==trimmed)node.nodeValue=raw.replace(trimmed,next);}
 }
 {const Observer=view.MutationObserver||globalThis.MutationObserver;if(Observer&&doc.body){const observer=new Observer(records=>{for(const record of records)for(const node of record.addedNodes)if(node.tagName==='DIALOG')liveDialogCopy(node);});observer.observe(doc.body,{childList:true});disposers.push(()=>observer.disconnect());}}
 // One Live info line: the hint hides while it repeats the status message.
 const dedupeStatus=()=>{const hintEl=$('#hint'),message=$('#status-message');if(!hintEl)return;const same=!!message&&hintEl.textContent.trim()!==''&&ablCopy(hintEl.textContent.trim())===ablCopy(message.textContent.trim());hintEl.classList.toggle('abl-dup',same);};
 {const Observer=view.MutationObserver||globalThis.MutationObserver;if(Observer){const observer=new Observer(dedupeStatus);for(const element of [$('#hint'),$('#status-message')])if(element)observer.observe(element,{childList:true,characterData:true,subtree:true});disposers.push(()=>observer.disconnect());}dedupeStatus();}

 // ── Layout buttons
 on($('#abl-browser-toggle'),'click',()=>layout.toggleBrowser());
 on($('#abl-view-arrangement'),'click',()=>layout.setView('arrangement'));
 on($('#abl-view-session'),'click',()=>layout.setView('session'));
 // Live: dragging a Session clip over the Arrangement selector switches to the Arrangement.
 on($('#abl-view-arrangement'),'dragenter',event=>{if([...(event.dataTransfer?.types||[])].includes(PATTERN_MIME))layout.setView('arrangement');});

 // ── Control bar: tempo (drag / scroll / type / Tap)
 const tempo=$('#tempo');
 const commitTempo=value=>{if(!tempo)return;const next=Math.max(20,Math.min(999,Math.round(Number(value)*100)/100));if(!Number.isFinite(next))return;tempo.value=String(next);tempo.dispatchEvent(new (view.Event||Event)('change',{bubbles:true}));};
 if(tempo){
  on(tempo,'pointerdown',event=>{
   if(event.button!==0||doc.activeElement===tempo)return;event.preventDefault();const startY=event.clientY,start=Number(tempo.value)||120;let moved=false;tempo.setPointerCapture?.(event.pointerId);
   const move=next=>{const dy=startY-next.clientY;if(!moved&&Math.abs(dy)<3)return;moved=true;const step=next.shiftKey?.01:.5;tempo.value=String(Math.max(20,Math.min(999,Math.round((start+dy*step)*100)/100)));};
   const up=()=>{tempo.removeEventListener('pointermove',move);tempo.removeEventListener('pointerup',up);tempo.removeEventListener('pointercancel',cancel);if(moved){if(Number(tempo.value)!==start)commitTempo(tempo.value);}else{tempo.focus();tempo.select?.();}};
   const cancel=()=>{tempo.removeEventListener('pointermove',move);tempo.removeEventListener('pointerup',up);tempo.removeEventListener('pointercancel',cancel);tempo.value=String(start);};
   tempo.addEventListener('pointermove',move);tempo.addEventListener('pointerup',up);tempo.addEventListener('pointercancel',cancel);
  });
  let wheelTimer=null;
  on(tempo,'wheel',event=>{event.preventDefault();const base=Number(tempo.value)||120,step=event.shiftKey?.01:1;tempo.value=String(Math.max(20,Math.min(999,Math.round((base+(event.deltaY<0?step:-step))*100)/100)));clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>commitTempo(tempo.value),350);},{passive:false});
  on(tempo,'keydown',event=>{if(event.key==='Enter'||event.key==='Escape'){event.stopPropagation();tempo.blur();}});
 }
 on($('#abl-tap'),'click',()=>{const now=globalThis.performance?.now?.()??Date.now();state.taps=[...state.taps.filter(time=>now-time<2000),now];const bpm=tapTempo(state.taps);if(bpm===null)return toast('Tap Tempo: keep tapping.');if(tempo)tempo.value=String(bpm);clearTimeout(state.tapTimer);if(state.taps.length>=4)state.tapTimer=setTimeout(()=>commitTempo(bpm),400);});
 on($('#abl-signature'),'click',safe(()=>api.timing()));
 // Grid / quantization menu over the inherited #snap value.
 const snap=$('#snap'),quant=$('#abl-quantize');
 const gridValue=()=>Number(snap?.value)||0;
 function setGrid(value){if(!snap)return;const text=String(value);if(![...snap.options].some(option=>option.value===text)){const option=doc.createElement('option');option.value=text;option.textContent=GRID_LABEL(value);snap.append(option);}snap.value=text;snap.dispatchEvent(new (view.Event||Event)('change',{bubbles:true}));paintGrid();}
 function paintGrid(){if(quant){const value=gridValue();quant.textContent=value?GRID_LABEL(value):'None';quant.title=`Grid: ${value?GRID_LABEL(value):'off'} (⌘1 narrower · ⌘2 wider · ⌘4 snap on/off)`;}}
 on(snap,'change',paintGrid);
 // Live's control-bar quantization menu: Global (clip / scene launch) Quantization first, then the Arrangement grid.
 on(quant,'click',event=>{event.stopPropagation();const rect=quant.getBoundingClientRect(),current=gridValue(),launch=api.launchQuantize?.();
  const launchItems=api.setLaunchQuantize?[...LAUNCH_QUANTIZE_CHOICES.map(choice=>({label:`Launch: ${choice.label}`,checked:choice.value===launch,title:'Global Launch Quantization: when a launched Session clip or scene starts',run:()=>api.setLaunchQuantize(choice.value)})),null]:[];
  api.menu({clientX:rect.left,clientY:rect.bottom+2},[...launchItems,...[0,...ABL_GRID_STEPS].map(value=>({label:GRID_LABEL(value),checked:value===current,run:()=>{setMainSnap(value);setGrid(value);}}))]);});
 // The Clip View note editor keeps its own grid (Live). While #snap holds the Arrangement's zoom-adaptive step
 // (data-abl-adaptive = that value), the piano's "Main" snap reads data-abl-main-snap instead: the last grid
 // set any other way (control-bar menu, the inherited select, the initial value).
 function setMainSnap(value){if(snap)snap.dataset.ablMainSnap=String(Number(value)||0);}
 if(snap&&snap.dataset.ablMainSnap===undefined)setMainSnap(gridValue());
 on(snap,'change',()=>{if(snap.value!==snap.dataset.ablAdaptive){delete snap.dataset.ablAdaptive;setMainSnap(gridValue());}});
 paintGrid();
 // Live's zoom-adaptive grid: the visible minor lines and every snap (insert marker, paste, new clips,
 // moves) use the same step. ⌘1/⌘2 narrow/widen it relative to the zoom; ⌘4 toggles snap.
 const grid={density:0,snap:true,fixed:null};
 const barPx=()=>{const raw=doc.documentElement?.style?.getPropertyValue?.('--bar')||view.getComputedStyle?.(doc.documentElement)?.getPropertyValue?.('--bar');const px=parseFloat(raw);return px>0?px:Number(api.barWidth?.())||0;};
 function visibleGrid(){return grid.fixed??adaptiveGridBeats(barPx(),{density:grid.density});}
 /* Zoomed out past the widest grid step (2 bars), the DRAWN lines keep doubling (4, 8, 16 … bars) so they never smear;
    a narrowed or fixed grid keeps its lines down to 6 px. The snap step itself is unchanged. */
 const shownGridPx=(step,px)=>{const least=grid.fixed==null&&grid.density<=0?14:6;let shown=step*px/4;while(shown>0&&shown<least)shown*=2;return shown;};
 function syncGrid(){const step=visibleGrid(),px=barPx();if(px>0)doc.documentElement?.style?.setProperty('--abl-grid-px',`${shownGridPx(step,px)}px`);const want=grid.snap?step:0;if(snap)snap.dataset.ablAdaptive=String(want);if(gridValue()!==want)setGrid(want);else paintGrid();}
 const gridCommands={
  'grid-narrow':()=>{if(grid.fixed!=null){const index=ABL_GRID_STEPS.indexOf(grid.fixed);grid.fixed=ABL_GRID_STEPS[Math.max(0,index-1)];}else grid.density=Math.min(3,grid.density+1);grid.snap=true;syncGrid();toast(`Grid ${GRID_LABEL(visibleGrid())}`);},
  'grid-widen':()=>{if(grid.fixed!=null){const index=ABL_GRID_STEPS.indexOf(grid.fixed);grid.fixed=ABL_GRID_STEPS[Math.min(ABL_GRID_STEPS.length-1,index+1)];}else grid.density=Math.max(-3,grid.density-1);grid.snap=true;syncGrid();toast(`Grid ${GRID_LABEL(visibleGrid())}`);},
  'grid-triplet':()=>toast('Triplet grid: Freestyle positions are stored on a straight 96 PPQ grid; triplet snapping is not available.'),
  'grid-snap':()=>{grid.snap=!grid.snap;syncGrid();toast(grid.snap?'Snap to Grid on':'Snap to Grid off');},
  // Live ⌘5: Fixed Grid pins the current step; off returns to the zoom-adaptive grid.
  'grid-fixed':()=>{grid.fixed=grid.fixed!=null?null:visibleGrid();grid.snap=true;syncGrid();toast(grid.fixed!=null?`Fixed Grid ${GRID_LABEL(grid.fixed)}`:'Adaptive Grid');}
 };
 // The menu's fixed values pin the grid (Live "Fixed Grid"); "None" turns snap off.
 on(snap,'change',()=>{const value=gridValue();if(value===0)grid.snap=false;else if(value!==visibleGrid()){grid.fixed=value;grid.snap=true;}});
 {const Observer=view.MutationObserver||globalThis.MutationObserver;if(Observer&&doc.documentElement){let last='';const observer=new Observer(()=>{const px=String(barPx());if(px!==last){last=px;syncGrid();}});observer.observe(doc.documentElement,{attributes:true,attributeFilter:['style']});disposers.push(()=>observer.disconnect());}}
 syncGrid();

 // ── Position display (bars.beats.sixteenths, live during playback)
 const timeValue=$('#time-value'),position=$('#abl-position');
 function currentClockBeat(){let beat=null;try{beat=Number(api.clock?.()?.beat);}catch{}return Number.isFinite(beat)&&beat>=0?beat:null;}
 const heldStopBeat=()=>{if(state.heldStopBeat==null)return null;let active=false;try{active=!!api.transportActive?.();}catch{}return active?null:state.heldStopBeat;};
 // QA r14: a running count-in wins over the held stop point (the warm path showed a stale 13.3.3 for the whole count-in).
 const countingIn=()=>/^-\d+\.\d+\.\d+$/.test(String(timeValue?.textContent||'').trim());
 function paintPosition(){if(position){const held=countingIn()?null:heldStopBeat();let next=held!=null?beatsToLive(held):livePosition(timeValue?.textContent);/* Owner bug 7: Live's Arrangement Position never goes blank. While the engine clock is unknown (project loading, a save in flight) the display keeps the last position (1. 1. 1 before the first one). */if(next==='-. -. -')next=/\d/.test(position.textContent)?position.textContent:'1. 1. 1';if(position.textContent!==next)position.textContent=next;}try{followStep();}catch{}paintSignature();paintLoopBoxes();paintDraw();
  // QA r3: the held line is repainted with every position paint (renders, zoom, a late stop), not only while the stop settles.
  paintHeldPlayhead();}
 if(timeValue){const Observer=view.MutationObserver||globalThis.MutationObserver;if(Observer){const observer=new Observer(paintPosition);observer.observe(timeValue,{childList:true,characterData:true,subtree:true});disposers.push(()=>observer.disconnect());}}
 function paintSignature(){const el=$('#lcd-signature');if(!el)return;let text='4/4';try{const map=api.getProject()?.cloud?.rawProject?.timingMap,first=Array.isArray(map?.timeSignatures)?map.timeSignatures[0]:null,num=Number(first?.numerator??first?.beatsPerBar),den=Number(first?.denominator??first?.beatUnit);if(num>0&&den>0)text=`${num}/${den}`;}catch{}if(el.textContent!==text)el.textContent=text;}

 // ── Transport: Stop (second click → start), Play in Session preview mode plays the Arrangement
 // Live: the first Stop keeps the position (Freestyle's transport stop rewinds, so the shell holds the
 // stop point for the display and ⇧Space); Stop while stopped returns to the start.
 // The held point is shown by #abl-position and by a held playhead line (the app hides #song-playhead and shows the
 // insert marker once stopped); both are repainted until the stop settles, then stay until Play / a second Stop.
 let heldLine=null,heldTimer=null;
 function paintHeldPlayhead(){
  const beat=heldStopBeat(),host=$('#song-playhead')?.parentElement;
  if(beat==null||!host){heldLine?.remove();heldLine=null;return;}
  if(!heldLine||heldLine.parentElement!==host){heldLine?.remove();heldLine=doc.createElement('div');heldLine.className='abl-held-playhead';heldLine.setAttribute('aria-hidden','true');host.append(heldLine);}
  const px=beat/4*(Number(api.barWidth?.())||30);heldLine.style.transform=`translate3d(${px}px,0,0)`;heldLine.dataset.beat=String(beat);
 }
 function holdStop(){
  const beat=currentClockBeat();state.heldStopBeat=beat;clearTimeout(heldTimer);if(beat==null)return;
  let tries=0;const settle=()=>{paintPosition();paintHeldPlayhead();let active=false;try{active=!!api.transportActive?.();}catch{}if(active&&++tries<200)heldTimer=setTimeout(settle,50);};heldTimer=setTimeout(settle,0);
 }
 function releaseHold(){state.heldStopBeat=null;clearTimeout(heldTimer);paintHeldPlayhead();}
 disposers.push(()=>{clearTimeout(heldTimer);heldLine?.remove();});
 on($('#stop'),'click',event=>{if(api.transportActive?.()){holdStop();return;}releaseHold();event.stopImmediatePropagation();event.preventDefault();safe(()=>api.goToStart())();paintPosition();},true);
 // Space while rolling is Live's Stop (keeps the position); Space while stopped plays. After a Session pattern
 // preview, Play / Space play the Arrangement again (Live's transport plays the Arrangement).
 // QA r3: a Space typed in a text field (device search "free comp") is text, never transport.
 const typingIn=event=>(event.composedPath?.()||[event.target]).some(node=>node?.isContentEditable===true||node?.matches?.('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]),textarea,select,[role="textbox"],[role="searchbox"],[role="combobox"]'));
 on(view,'keydown',event=>{if(typingIn(event))return;if((event.code==='Space'||event.key===' ')&&!event.shiftKey&&!event.altKey&&!event.metaKey&&!event.ctrlKey&&!event.repeat){let active=false;try{active=!!api.transportActive?.();}catch{}if(active)holdStop();else{releaseHold();try{api.ensureArrangementMode?.();}catch{}}}},true);
 on($('#play'),'click',()=>{releaseHold();try{api.ensureArrangementMode?.();}catch{}},true);
 const record=$('#record');if(record&&!record.title.includes('F9'))record.dataset.ablTitle='1';
 // QA r14: ● from a stopped transport records from the insert marker (app.js recordStartSec), so the held stop point
 // gives way to it on the display, as Play's does.
 on(record,'click',()=>{let active=false;try{active=!!api.transportActive?.();}catch{}if(!active){releaseHold();paintPosition();}},true);

 // ── Loop switch + loop start / length
 const loopStart=$('#abl-loop-start'),loopLength=$('#abl-loop-length');
 function loopState(){let clock={};try{clock=api.clock()||{};}catch{}const bpm=Number(clock.bpm)||Number(api.getProject()?.bpm)||120,known=typeof clock.loopEnabled==='boolean'&&Number.isFinite(Number(clock.loopEndSec));const start=(Number(clock.loopStartSec)||0)*bpm/60,end=(Number(clock.loopEndSec)||0)*bpm/60;return{known,enabled:!!clock.loopEnabled,start,end:Math.max(start,end)};}
 function paintLoopBoxes(){const loop=loopState();for(const [input,text]of [[loopStart,loop.known?beatsToLive(loop.start):'-. -. -'],[loopLength,loop.known?beatsToLive(loop.end-loop.start,{length:true}):'-. -. -']])if(input&&doc.activeElement!==input&&input.value!==text)input.value=text;}
 function applyLoop(startBeat,lengthBeats){const loop=loopState();if(!loop.known)return toast('Freestyle has not supplied the loop yet.');if(!(lengthBeats>0))return toast('Loop length must be longer than zero.');if(!api.playlistLoop)return toast('Loop editing is unavailable.');return api.playlistLoop.apply({enabled:loop.enabled,startBeat,endBeat:startBeat+lengthBeats});}
 for(const [input,kind]of [[loopStart,'start'],[loopLength,'length']]){
  if(!input)continue;
  const commit=()=>{const loop=loopState(),beats=liveToBeats(input.value,{length:kind==='length'});if(beats===null){paintLoopBoxes();return toast('Type a position as bars . beats . sixteenths (e.g. 5. 1. 1).');}const start=kind==='start'?beats:loop.start,length=kind==='length'?beats:loop.end-loop.start;if(Math.abs(start-loop.start)<1e-6&&Math.abs(length-(loop.end-loop.start))<1e-6)return;safe(()=>applyLoop(start,length))();};
  on(input,'keydown',event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();input.blur();}else if(event.key==='Escape'){event.preventDefault();paintLoopBoxes();input.blur();}});
  on(input,'change',commit);
  on(input,'wheel',event=>{event.preventDefault();const loop=loopState();if(!loop.known)return;const delta=(event.deltaY<0?1:-1)*4;const start=kind==='start'?Math.max(0,loop.start+delta):loop.start,length=kind==='length'?Math.max(4,loop.end-loop.start+delta):loop.end-loop.start;safe(()=>applyLoop(start,length))();},{passive:false});
  on(input,'focus',()=>input.select?.());
 }

 // ── Follow (Live: the display scrolls with the song position; ⌥⇧F). While the transport runs and Follow is on, the
 // Arrangement pages forward when the playhead leaves the visible grid (and back when it is left of it). A manual
 // scroll or an edit gesture pauses following until the playhead is visible again, as Live does.
 const follow=$('#abl-follow');
 let followOn=true;try{followOn=globalThis.localStorage?.getItem('disabelton:abl:follow')!=='0';}catch{}
 function paintFollow(){if(!follow)return;follow.setAttribute('aria-pressed',String(followOn));follow.classList.toggle('lit',followOn);}
 function toggleFollow(force){followOn=typeof force==='boolean'?force:!followOn;try{globalThis.localStorage?.setItem('disabelton:abl:follow',followOn?'1':'0');}catch{}paintFollow();followPaused=false;toast(followOn?'Follow on':'Follow off');}
 let followPaused=false,followFrame=null,followScrolling=false;
 function followStep(){
  followFrame=null;let active=false;try{active=!!api.transportActive?.();}catch{}
  if(followOn&&active&&layout.currentView()==='arrangement'){
   const viewport=$('#arrangement-scroll'),playhead=$('#song-playhead');
   if(viewport&&playhead){const box=viewport.getBoundingClientRect(),gutter=Number(api.playlistLayout?.headerSide==='right'?viewport.querySelector('.track-label')?.getBoundingClientRect().width:0)||0,left=box.left,right=box.right-gutter,x=playhead.getBoundingClientRect().left,visible=x>=left&&x<=right;
    if(followPaused){if(visible)followPaused=false;}
    else if(!visible&&right>left){followScrolling=true;viewport.scrollLeft+=x>right?x-left-Math.min(40,(right-left)*.05):x-left-(right-left)*.5;followScrolling=false;}}
  }
 }
 if(follow){on(follow,'click',()=>toggleFollow());paintFollow();/* no frame loop of its own: paintPosition() calls followStep on every clock tick */
  for(const type of ['wheel','pointerdown'])on($('#arrangement-scroll'),type,()=>{let active=false;try{active=!!api.transportActive?.();}catch{}if(active&&followOn)followPaused=true;},{passive:true});}

 // ── Draw mode (B)
 const draw=$('#abl-draw');
 function paintDraw(){if(!draw)return;const active=api.getTool?.()==='draw';draw.classList.toggle('lit',active);draw.setAttribute('aria-pressed',String(active));}
 function toggleDraw(){const next=api.getTool?.()==='draw'?'select':'draw';api.setTool(next);paintDraw();toast(next==='draw'?'Draw Mode on':'Draw Mode off');}
 on(draw,'click',toggleDraw);

 // ── Computer MIDI Keyboard indicator (Live's keyboard button by Key/MIDI): bound to window.ablMidiKeyboard.
 let midiKeys=$('#abl-midi-kbd');
 if(!midiKeys){const anchor=$('#abl-midi-map')||$('#abl-key-map');if(anchor){midiKeys=doc.createElement('button');midiKeys.type='button';midiKeys.id='abl-midi-kbd';midiKeys.className='abl-btn abl-icon-btn abl-midi-kbd';midiKeys.setAttribute('aria-label','Computer MIDI Keyboard');midiKeys.innerHTML='<svg viewBox="0 0 16 10" width="16" height="10" aria-hidden="true"><rect x=".5" y=".5" width="15" height="9" fill="none" stroke="currentColor"/><path d="M4 .5v6M8 .5v6M12 .5v6" stroke="currentColor"/><path d="M2.5 .5h3v4h-3zM6.5 .5h3v4h-3zM10.5 .5h3v4h-3z" fill="currentColor" opacity=".7"/></svg>';anchor.after(midiKeys);}}
 function paintMidiKeys(state=null){if(!midiKeys)return;const kbd=view.ablMidiKeyboard,available=!!kbd&&typeof kbd.toggle==='function',on=available&&!!(state?state.enabled:kbd.enabled);
  midiKeys.classList.toggle('lit',on);midiKeys.setAttribute('aria-pressed',String(on));if(available)midiKeys.removeAttribute('aria-disabled');else midiKeys.setAttribute('aria-disabled','true');
  midiKeys.title=available?`Computer MIDI Keyboard: ${on?'on':'off'} (M)`:'Computer MIDI Keyboard (M) · loading…';}
 on(midiKeys,'click',()=>{const kbd=view.ablMidiKeyboard;if(!kbd?.toggle)return;const next=kbd.toggle();paintMidiKeys({enabled:!!next});try{midiKeys.blur();}catch{}});
 on(view,'abl:midi-keyboard',event=>paintMidiKeys(event.detail||null));
 // The Clip View publishes window.ablMidiKeyboard after the shell mounts: repaint once it appears (bounded).
 {let tries=0,retry=null;const wait=()=>{retry=null;paintMidiKeys();if(!view.ablMidiKeyboard&&++tries<40&&view.setTimeout)retry=view.setTimeout(wait,tries<4?0:250);};wait();queueMicrotask(()=>{if(view.ablMidiKeyboard)paintMidiKeys();});on(doc,'abl:view',()=>paintMidiKeys());disposers.push(()=>{if(retry!==null)view.clearTimeout?.(retry);});}

 // ── Track selection → Device View; clip double-click → Clip View
 function laneIdOf(row){try{return api.laneId(row)||null;}catch{return null;}}
 /* QA r10: the status-bar track chip showed "Engine context" while Keys part was selected. A clip click selects its
    track through the Logic shell's hook (shared state.selectedTrack) before ours ran, so our "changed?" check never
    repainted the chip. The chip now always paints from the one shared selection, after every selection, track
    render (rename/undo) and mixer render. */
 function paintTrackChip(){const status=$('#abl-status-track');if(!status)return;const row=state.selectedTrack;let name='';try{name=Number.isInteger(row)&&laneIdOf(row)?String(api.trackName(row)||''):'';}catch{}if(status.textContent!==name)status.textContent=name;}
 function selectTrack(row,{showDevice=true}={}){
  if(!Number.isInteger(row))return;state.selectedTrack=row;try{logic?.selectTrack?.(row);}catch{}
  paintTrackChip();
  doc.dispatchEvent(new (view.CustomEvent||CustomEvent)('abl:track-select',{detail:{track:row,laneId:laneIdOf(row)}}));
  if(showDevice&&layout.detailKind()!=='device'||showDevice&&!layout.detailVisible())layout.showDetail('device');
  if(layout.currentView()==='session')paintSessionSelection();
 }
 // Delete removes the selected track only right after its header was clicked (Live's track focus).
 // QA r5: opening Edit ▸ (menu bar / menu items) keeps the track focus, so Edit ▸ Delete can delete the focused track.
 // QA r6: a clip click selects its track, which focuses the header (focusin) — that must not turn the clip click into
 // track focus (Edit ▸ Delete then offered "Delete track" with Cut / Copy greyed). Focus follows the last pointer press.
 let pressedHeader=null;
 const trackFocus=event=>{if(event.target?.closest?.('#main-menu,#context-menu'))return;const header=!!event.target?.closest?.('#track-lanes .track-label[data-track]:not(.logic-track-empty),#abl-session-grid .abl-session-head');
  if(event.type==='pointerdown')pressedHeader=header;else if(event.type==='focusin'&&header&&pressedHeader===false)return;state.trackFocus=header;};
 for(const type of ['pointerdown','click','focusin'])on(doc,type,trackFocus,true);
 on($('#track-lanes'),'pointerdown',event=>{const label=event.target?.closest?.('.track-label[data-track]');if(!label||event.button!==0||label.classList.contains('logic-track-empty')||event.target.closest('button,input,.logic-knob'))return;selectTrack(Number(label.dataset.track));});
 // Live: a click in empty track space sets the insert marker at the clicked time (⌘E split / ⌘V paste use it)
 // and selects that track. The app's own marquee / time selection still runs; nothing is seeked or edited.
 on($('#track-lanes'),'pointerdown',event=>{
  if(event.button!==0||event.ctrlKey||event.metaKey)return;const grid=event.target?.closest?.('.lane-grid[data-track]');if(!grid||event.target.closest('.clip,.automation-clip,.track-label'))return;
  if((api.getTool?.()||'select')!=='select')return;const row=Number(grid.dataset.track),rect=grid.getBoundingClientRect?.();if(!rect)return;
  const raw=Math.max(0,(event.clientX-rect.left)/(api.barWidth?.()||30)*4),beat=event.altKey?raw:(api.snapBeat?.(raw)??raw);
  try{api.setInsertMarker?.(beat);}catch(error){api.fail(error);}if(!api.transportActive?.())releaseHold();
  if(Number.isInteger(row)&&laneIdOf(row))selectTrack(row);
 },true);
 // QA r6: Live also sets the insert marker when a clip is clicked (⌘E splits there). Only a click (no drag) moves it,
 // so a clip move / trim never shifts the marker; the clip's own selection runs unchanged.
 let clipClick=null;
 on($('#track-lanes'),'pointerdown',event=>{
  clipClick=null;if(event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||(api.getTool?.()||'select')!=='select')return;
  const clip=event.target?.closest?.('.clip'),grid=clip?.closest?.('.lane-grid[data-track]');if(!grid||clip.closest('.automation-clip'))return;
  clipClick={x:event.clientX,y:event.clientY,grid};
 },true);
 on(doc,'pointerup',event=>{
  const click=clipClick;clipClick=null;if(!click||Math.abs(event.clientX-click.x)>3||Math.abs(event.clientY-click.y)>3)return;
  const rect=click.grid.getBoundingClientRect?.();if(!rect)return;const raw=Math.max(0,(click.x-rect.left)/(api.barWidth?.()||30)*4),beat=api.snapBeat?.(raw)??raw;
  try{api.setInsertMarker?.(beat);}catch(error){api.fail(error);}
 },true);
 function openClip(clip,{from='arrangement'}={}){
  if(!clip)return;api.selectRegions([clip.id]);if(Number.isInteger(clip.track))state.selectedTrack=clip.track;
  if(clip.patternId)safe(()=>api.selectPattern?.(clip.patternId))();
  const event=new (view.CustomEvent||CustomEvent)('abl:clip-open',{cancelable:true,detail:{clipId:clip.id,patternId:clip.patternId||null,track:clip.track,laneId:laneIdOf(clip.track),kind:clip.patternId?'midi':'audio',from}});
  layout.showDetail('clip');
  const handled=!doc.dispatchEvent(event);
  if(!handled)safe(()=>api.openLegacyClipEditor?.(clip))();
  return handled;
 }
 on($('#track-lanes'),'dblclick',event=>{const element=event.target?.closest?.('.clip[data-clip]');if(!element||element.closest('.automation-clip'))return;if(event.target.closest('.clip-resize,.clip-trim-start'))return;event.stopPropagation();event.preventDefault();openClip(api.findClip(element.dataset.clip));},true);
 layout.onChange(change=>{
  if(change.reason==='view'){if(change.view==='session')renderSessionNow();doc.dispatchEvent(new (view.CustomEvent||CustomEvent)('abl:view',{detail:{view:change.view}}));}
  // ⌥⌘M shows the Live strips in #abl-arr-mixer (devices lane); the Logic mixer dock never opens for it.
  if(change.reason==='arr-mixer'){if(change.arrMixer){try{const mixer=view.ablDevices?.mixer;mixer?.attach?.();mixer?.render?.();}catch{}}const dock=$('#mixer');if(dock&&!dock.classList.contains('hidden'))safe(()=>api.toggleLegacyMixer?.(false))();}
  measureArrangement();
 });

 // ── Live context menus
 const sep=null;
 // Live inserts tracks at once (⌘T audio, ⇧⌘T MIDI); the New track dialog stays for the other kinds / fallback.
 // Live inserts the track instantly: a placeholder row ("Audio" / "MIDI") paints before the cloud create and
 // is replaced by the real lane on confirm; a refusal removes it with a "Not saved…" message.
 const insertNow=kind=>{
  if(typeof api.insertTrackNow!=='function')return api.insertTrack(kind);
  if(state.pendingTrack)return toast('Wait for the track being inserted.');
  const token={kind,name:kind==='instrument'?'MIDI':'Audio',rows:realTrackRows()};state.pendingTrack=token;decorateArrangement();
  const settle=receipt=>{if(state.pendingTrack!==token)return receipt;state.pendingTrack=null;decorateArrangement();return receipt;};
  // A synchronous throw is the shared track-create guard refusing (pending edit / loading): nothing was sent, so it
  // reports through api.fail like the New track dialog's guard, not as a "Not saved" create failure.
  let result;try{result=api.insertTrackNow(kind);}catch(error){settle(undefined);api.fail(error);return null;}
  if(result&&typeof result.then==='function')return result.then(settle,error=>{settle(null);toast(`Not saved: ${error?.message||'the track was not inserted.'}`);return null;});
  settle(undefined);return result;
 };
 // A Chrome tab keeps ⌘T / ⇧⌘T (new tab / reopen tab) before the page sees them; ⌃T / ⇧⌃T always work.
 const tabKeyNote='⌘T works in the Disabelton app window (installed or --app); in a browser tab use ⌃T, Chrome keeps ⌘T for tabs.';
 const insertTrackItems=()=>[{label:'Insert Audio Track',shortcut:'⌘T / ⌃T',title:tabKeyNote,run:safe(()=>insertNow('audio'))},{label:'Insert MIDI Track',shortcut:'⇧⌘T / ⇧⌃T',title:tabKeyNote,run:safe(()=>insertNow('instrument'))}];
 function clipMenu(event,clip,{prefix=null}={}){
  event?.preventDefault?.();if(!clip)return;if(event?.ctrlKey&&event?.altKey)return;/* ⌃⌥ drag is the zoom gesture */
  if(!api.selectedIds().has(clip.id))api.selectRegions([clip.id]);
  const project=api.getProject(),count=api.selectedIds().size||1,guard=run=>()=>{if(api.getProject()!==project||api.findClip(clip.id)!==clip)return toast('The clip changed; reopen its menu.');return safe(run)();},muted=api.regionMuted(clip),editable=api.editable?.()!==false;
  const items=[
   ['Cut','⌘X',guard(()=>api.clipboard('cut'))],['Copy','⌘C',guard(()=>api.clipboard('copy'))],['Paste','⌘V',guard(()=>api.clipboard('paste'))],['Duplicate','⌘D',guard(()=>api.repeat())],['Delete','⌫',guard(()=>api.deleteSelected())],sep,
   {label:'Split',shortcut:'⌘E',run:guard(()=>logic?.splitAtPlayhead?.(clip.id)),title:'Splits at the insert marker'},{label:'Consolidate',shortcut:'⌘J',disabled:true,title:'Freestyle has no clip consolidate (render-in-place) operation.'},sep,
   {label:'Rename',shortcut:'⌘R',run:guard(()=>api.renameRegion(clip)),disabled:!clip.patternId,title:clip.patternId?'':'Freestyle does not store names for audio clips.'},
   {label:'Clip Color',disabled:true,title:'Clips take their track’s colour; Freestyle stores no per-clip colour.'},sep,
   {label:muted===true?(count>1?'Activate Clips':'Activate Clip'):(count>1?'Deactivate Clips':'Deactivate Clip'),shortcut:'0',run:guard(()=>api.toggleRegionMute([...api.selectedIds()])),disabled:muted===null,title:muted===null?'Reload the saved clip mute first.':''},sep,
   ['Show in Clip View','',guard(()=>openClip(clip))],
   ...(clip.patternId?[{label:'Extend ×2',run:guard(()=>api.extendClip?.(clip)),disabled:typeof api.extendClip!=='function',title:'Doubles the clip length; its loop repeats (Studio Pro Extend)'}]:[]),
   ...(clip.patternId?[['Make Unique','',guard(()=>api.makeUnique(clip))]]:[['Edit Sample…','',guard(()=>api.openSampleEditor(clip))],...(view.ablStems?.clipMenuItems?.(clip,guard)||[{label:'Separate Stems to New Audio Tracks',disabled:true,title:'Stem separation is still loading (abl-stems.js).'}]),['Clip Effects…','',guard(()=>api.regionEffect(clip))],['Reload Waveform','',guard(()=>api.reloadWaveform(clip))]]),
   ['Show Automation…','',guard(()=>api.openAutomation(clip))]
  ];
  const shown=editable?items:items.map(item=>Array.isArray(item)?[item[0],item[1],item[2],!['Copy','Show in Clip View'].includes(item[0])]:item);
  api.menu(event,prefix?.length?[...prefix,sep,...shown]:shown);
 }
 function emptyLaneMenu(event){
  event?.preventDefault?.();if(event?.ctrlKey&&event?.altKey)return;const lane=event?.target?.closest?.('.lane-grid[data-track]'),row=lane?Number(lane.dataset.track):null,laneId=Number.isInteger(row)?laneIdOf(row):null,kind=Number.isInteger(row)?api.laneKind(row):null;
  const rect=lane?.getBoundingClientRect?.(),beat=rect?api.snapBeat(Math.max(0,(event.clientX-rect.left)/api.barWidth()*4)):0,midi=!!laneId&&kind!=='audio';
  api.menu(event,[['Paste','⌘V',safe(()=>api.clipboard('paste'))],{label:'Insert MIDI Clip',shortcut:'⇧⌘M',run:safe(()=>api.createRegionAt(row,beat,'midi')),disabled:!midi,title:midi?'An empty MIDI clip (new pattern) at this position':'Insert a MIDI clip on a MIDI track.'},sep,['Select All','⌘A',()=>api.selectRegions(api.allClips().map(clip=>clip.id))],sep,...insertTrackItems(),sep,['Import Audio File…','',safe(()=>api.importAudio())]]);
 }
 /** Live track header menu over the guarded track entries (their disabled reasons are kept). */
 const TRACK_LABELS={rename:()=>'Rename',insert:()=>'Insert Track Here',duplicate:()=>'Duplicate',delete:()=>'Delete','move-up':()=>'Move Track Up','move-down':()=>'Move Track Down',mute:item=>item.muted===true?'Activate Track':'Deactivate Track',solo:item=>item.solo===true?'Unsolo':'Solo'};
 const TRACK_KEYS={rename:'⌘R',duplicate:'⌘D',delete:'⌫',mute:'0'};
 function duplicateAvailability(row){const laneId=laneIdOf(row);if(!laneId)return{enabled:false,reason:'This row has no saved track yet.'};try{return laneDuplicateAvailability(api.getProject()?.cloud?.rawProject,laneId);}catch{return null;}}
 /** QA r6: Delete Track's refusal (an instrument played from another track) is known before it is offered. */
 function deleteAvailability(row){const laneId=laneIdOf(row);if(!laneId)return{enabled:false,reason:'This row has no saved track yet.'};try{return deleteTrackAvailability(api.getProject()?.cloud?.rawProject,laneId);}catch{return{enabled:true,reason:''};}}
 /** The track Edit ▸ Cut/Copy/Paste act on: a header-focused selected track with no clip selection (Live). */
 function trackClipboardTarget(selection){return ops&&!selection&&state.trackFocus&&Number.isInteger(state.selectedTrack)&&laneIdOf(state.selectedTrack)?state.selectedTrack:null;}
 /** Live ⌘E with no clip selected: split the selected track's clips at the insert marker (the same per-clip split path). */
 function trackSplitClips(row){try{return trackSplitTargets(api.allClips(),row,api.playheadBeat());}catch{return[];}}
 async function splitSelectedTrack(row){if(!ops)return null;if(!trackSplitClips(row).length)return toast('Split: put the insert marker inside a clip on the selected track.');if(!api.editable?.()&&api.editable)return toast('Wait for the current cloud operation to finish.');return ops.splitTrack(row,api.playheadBeat(),{clips:api.allClips(),split:(clip,beat)=>api.split(clip,beat),findClip:id=>api.findClip(id)});}
 /** File ▸ Save Version…: name + render the mix (Studio Pro Save History: a named snapshot with its WAV). */
 function openSaveVersion(){
  const stamp=new Date(),pad=value=>String(value).padStart(2,'0'),name=`Version ${stamp.getFullYear()}-${pad(stamp.getMonth()+1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}.${pad(stamp.getMinutes())}`;
  const d=api.dialog('Save Version',`<form class="abl-save-version"><label>Version name<input name="name" required maxlength="255" value="${esc(name)}"></label><label class="abl-check"><input type="checkbox" name="render" checked> Render the mix (a WAV you can download from File ▸ Open Recent / Revert to)</label><p class="abl-save-status" role="status"></p><button type="submit" class="primary">Save</button><button type="button" class="cancel">Cancel</button></form>`);
  const form=d?.querySelector?.('form');if(!form)return d;const input=form.querySelector('input[name="name"]');input?.select?.();form.querySelector('.cancel').onclick=()=>d.close();
  let busy=false;form.onsubmit=event=>{event.preventDefault();if(busy)return;const value=input.value.trim();if(!value){form.querySelector('.abl-save-status').textContent='Name the version.';return;}busy=true;form.querySelector('.abl-save-status').textContent='Saving…';
   Promise.resolve().then(()=>api.saveVersion(value,{render:!!form.querySelector('input[name="render"]').checked})).then(()=>{if(d.open!==false)d.close();},error=>{busy=false;form.querySelector('.abl-save-status').textContent=String(error?.message||error);api.fail(error);});};
  return d;
 }
 /** Live track menu Cut / Copy / Paste (Studio Pro "Cut track ⌘X / Copy track ⌘C / Paste ⌘V"), with the engine's refusal reasons. */
 function trackClipboardItems(row){
  if(!ops)return[];const name=api.trackName?.(row)||`Track ${row+1}`;let cut,copy,paste,clip=null;
  try{cut=ops.cutAvailability(row);copy=ops.copyAvailability(row);paste=ops.pasteAvailability();clip=ops.clipboard;}catch(error){return[];}
  return[{label:'Cut',shortcut:cut.enabled?'⌘X':'',run:safe(()=>commands['track-cut'](row)),disabled:!cut.enabled,title:cut.enabled?`Cut track “${name}” (Paste brings it back below the selected track)`:cut.reason},
   {label:'Copy',shortcut:copy.enabled?'⌘C':'',run:safe(()=>commands['track-copy'](row)),disabled:!copy.enabled,title:copy.enabled?`Copy track “${name}”`:copy.reason},
   {label:'Paste',shortcut:paste.enabled?'⌘V':'',run:safe(()=>commands['track-paste'](row)),disabled:!paste.enabled,title:paste.enabled?`Paste track “${clip?.name||'Track'}” below “${name}”`:paste.reason}];
 }
 // ── Track colour: Live's swatch grid (Studio Pro "Change color…"), one updateLane {color} per pick.
 let colorPicker=null;
 function closeColorPicker(){if(!colorPicker)return;const {box,off}=colorPicker;colorPicker=null;try{off();}catch{}box.remove();}
 function openColorPicker(row,at=null){
  closeColorPicker();if(!ops||!laneIdOf(row))return toast('Track Color: select a saved track first.');
  const current=ops.displayColor(row),box=doc.createElement('div');box.className='abl-color-picker';box.setAttribute('role','dialog');box.setAttribute('aria-label',`Track colour: ${api.trackName?.(row)||`Track ${row+1}`}`);box.dataset.track=String(row);
  box.innerHTML=`<div class="abl-color-grid" role="group" aria-label="Track colors">${ABL_LIVE_PALETTE.map(color=>`<button type="button" class="abl-color-swatch${color===current?' is-current':''}" data-color="${color}" style="background:${color}" aria-label="Set color ${color}" title="${color}"></button>`).join('')}</div><p class="abl-color-note">${esc(ABL_COLOR_LIMIT_NOTE)}</p>`;
  const x=Number(at?.x)||0,y=Number(at?.y)||0;box.style.left=`${Math.max(0,Math.min(x,(view.innerWidth||1200)-300))}px`;box.style.top=`${Math.max(0,Math.min(y,(view.innerHeight||800)-160))}px`;doc.body.append(box);
  box.addEventListener('click',event=>{const swatch=event.target?.closest?.('.abl-color-swatch');if(!swatch)return;event.preventDefault();event.stopPropagation();closeColorPicker();safe(()=>ops.setTrackColor(row,swatch.dataset.color))();});
  const outside=event=>{if(colorPicker&&!colorPicker.box.contains(event.target))closeColorPicker();},escape=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeColorPicker();}};
  doc.addEventListener('pointerdown',outside,true);doc.addEventListener('keydown',escape,true);
  colorPicker={box,row,off:()=>{doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('keydown',escape,true);}};
  box.querySelector('.abl-color-swatch.is-current,.abl-color-swatch')?.focus?.();return box;
 }
 function trackMenuItems(row,anchor=null){
  let entries=[];try{entries=api.trackMenuEntries?.(row)||[];}catch(error){api.fail(error);}
  // Release 2026-11-12: audio / vocal / guitar lanes duplicate; instrument / pattern lanes show the engine's 409 reason.
  const duplicate=duplicateAvailability(row);
  entries=entries.map(item=>item?.id==='duplicate'&&duplicate&&!(item.disabled&&/Wait for/.test(item.reason||''))?{...item,disabled:!duplicate.enabled,reason:duplicate.enabled?'':duplicate.reason}:item);
  const live=entries.map(item=>item?{label:(TRACK_LABELS[item.id]||(()=>item.label))(item),shortcut:item.disabled?'':TRACK_KEYS[item.id]||'',run:safe(()=>item.run?.()),disabled:!!item.disabled||typeof item.run!=='function',title:item.reason||''}:null);
  // Round 4: Live's order — edit commands first, then Freeze / Flatten, then the Insert Track commands, then colours.
  return[...trackClipboardItems(row),sep,...live,sep,{label:'Freeze Track',disabled:true,title:'Freestyle renders every track in the cloud; there is no freeze.'},{label:'Flatten',disabled:true,title:'Freestyle has no flatten (render in place) operation.'},sep,...insertTrackItems(),{label:'Insert Return Track',shortcut:'⌥⌘T',run:safe(()=>api.insertReturnTrack()),title:'Creates a Freestyle bus (send / return)'},sep,ops?{label:'Track Color…',run:()=>openColorPicker(row,anchor),disabled:!laneIdOf(row),title:laneIdOf(row)?'Live colour palette (updateLane color; ⌘Z restores)':'This row has no saved track yet.'}:{label:'Track Color…',disabled:true,title:'Open a Freestyle project to colour tracks.'},sep,{label:'Show Devices',run:()=>layout.showDetail('device')},(()=>{/* Live track In/Out "Audio From" + Monitor (abl-record-input.js) */const kind=api.laneKind?.(row),audio=['audio','vocal','guitar'].includes(kind),chooser=view.ablRecordInput;return{label:'Input…',run:safe(()=>chooser.open(anchor)),disabled:!audio||!chooser,title:!chooser?'The record input chooser is still loading.':audio?'Audio From / Monitor for recording (also: right-click ●)':'MIDI tracks record the computer MIDI keyboard (M) and MIDI input.'};})()];
 }
 function trackMenu(event,row){
  event?.preventDefault?.();if(!Number.isInteger(row))return;selectTrack(row,{showDevice:false});
  const items=trackMenuItems(row,{x:event?.clientX,y:event?.clientY}).filter(item=>item!==undefined).filter((item,index,list)=>!(item===null&&(index===0||list[index-1]===null)));
  api.menu(event,items);
 }
 hooks.regionMenu=clipMenu;hooks.tracksMenu=emptyLaneMenu;
 on($('#arrangement-scroll'),'contextmenu',event=>{const label=event.target?.closest?.('.track-label[data-track]');if(!label||label.classList.contains('automation-track-label'))return;event.preventDefault();event.stopPropagation();trackMenu(event,Number(label.dataset.track));},true);

 // ── Arrangement chrome: header corner, drop zone, activator state, viewport width
 const timeline=$('#playlist .playlist-timeline');
 if(timeline&&!$('#abl-arr-corner')){const corner=doc.createElement('div');corner.id='abl-arr-corner';corner.innerHTML='<button type="button" disabled title="Locators (Set) are not stored in Freestyle projects">Set</button><span class="abl-corner-hint">Tracks</span>';timeline.append(corner);}
 function measureArrangement(){const scroll=$('#arrangement-scroll');if(!scroll)return;const width=scroll.clientWidth||scroll.getBoundingClientRect?.().width||0;if(!(width>0))return;const gutter=parseFloat(view.getComputedStyle?.(doc.documentElement)?.getPropertyValue('--playlist-gutter'))||300,geometry=arrangementGeometry({viewportWidth:width,gutter});const root=doc.documentElement.style;root.setProperty('--abl-arr-viewport-w',`${width}px`);root.setProperty('--abl-arr-min-w',`${geometry.minArrangementWidth}px`);}
 // Fold triangle (Live): a click folds / unfolds that one track (compact ~24 px ↔ notes / waveform visible);
 // ⌥-click folds or unfolds every track. Unfolded rows override --lane on their .track-lane and publish the
 // per-row heights through playlistLayout.setLaneHeights, which every row ↔ y hit test (draw, drop, marquee,
 // moves) already reads; with nothing unfolded the list is cleared and the app's single row height applies.
 const folds={open:new Set()};
 const foldKey=row=>{const id=laneIdOf(row);return id?`lane:${id}`:`row:${row}`;};
 function baseRowHeight(){let height=ABL_TRACK_HEIGHT.folded;try{height=Number(api.view?.()?.rowHeight)||height;}catch{}return height;}
 function paintFold(){
  const base=baseRowHeight(),open=Math.max(base,ABL_TRACK_HEIGHT.unfolded),lanes=$$('#track-lanes > .track-lane'),heights=[];let any=false;
  lanes.forEach((lane,row)=>{const label=lane.querySelector('.track-label[data-track]'),index=label?Number(label.dataset.track):row,unfolded=Number.isInteger(index)&&folds.open.has(foldKey(index));any||=unfolded;
   lane.classList.toggle('abl-unfolded',unfolded);if(unfolded)lane.style.setProperty('--lane',`${open}px`);else lane.style.removeProperty('--lane');heights.push(unfolded?open:base);
   const button=lane.querySelector('.abl-fold');if(button){button.textContent=unfolded?'▼':'▶';button.setAttribute('aria-expanded',String(unfolded));button.setAttribute('aria-label',unfolded?'Fold track (⌥: all tracks)':'Unfold track (⌥: all tracks)');}});
  try{api.playlistLayout?.setLaneHeights?.(any?heights:null);}catch{}
  doc.body.classList.toggle('abl-tracks-unfolded',any&&lanes.length>0&&lanes.every(lane=>lane.classList.contains('abl-unfolded')||lane.classList.contains('logic-empty-row')||!!lane.querySelector('.logic-track-empty')));
 }
 function toggleFold(row,{all=false}={}){
  const rows=$$('#track-lanes .track-label[data-track]').filter(label=>!label.classList.contains('logic-track-empty')).map(label=>Number(label.dataset.track)).filter(Number.isInteger);
  if(all){const open=rows.some(index=>!folds.open.has(foldKey(index)));folds.open.clear();if(open)for(const index of rows)folds.open.add(foldKey(index));}
  else if(Number.isInteger(row)){const key=foldKey(row);if(folds.open.has(key))folds.open.delete(key);else folds.open.add(key);}
  paintFold();
 }
 on($('#track-lanes'),'click',event=>{const button=event.target?.closest?.('.abl-fold');if(!button)return;event.preventDefault();event.stopPropagation();const label=button.closest('.track-label[data-track]')||button.closest('.track-lane')?.querySelector('.track-label[data-track]');safe(()=>toggleFold(label?Number(label.dataset.track):null,{all:event.altKey}))();},true);
 on(view,'resize',measureArrangement);
 // Drop placeholder (app.js showPendingPlaylistClip): Live draws the importing clip in the target track's
 // colour, at the length the placement will have, keeping the clip's name. Only a real import (Browser /
 // file drop) adds a secondary "Importing…" status; a paste/duplicate ghost (data-pending-kind="paste") is not an import.
 // QA r3: the OS-file import placeholder (logic-shell #logic-import-ghost) takes the target row's track colour
 // (the free row's colour = the next track's, for a new lane) instead of the green fallback.
 function colourImportGhost(element){
  try{const top=element.getBoundingClientRect().top+2,lanes=[...doc.querySelectorAll('#track-lanes > .track-lane')],lane=lanes.find(row=>{const box=row.getBoundingClientRect();return top>=box.top&&top<box.bottom;})||lanes.find(row=>row.classList.contains('abl-drop-zone'));const color=lane&&view.getComputedStyle?.(lane)?.getPropertyValue('--abl-track')?.trim();if(color)element.style.setProperty('--abl-track',color);}catch{}
  element.classList.add('abl-import-ghost');
 }
 function decoratePendingClip(element){
  if(element.dataset.ablPending)return;element.dataset.ablPending='1';element.classList.add('abl-pending-clip');
  try{const top=element.getBoundingClientRect().top+2,lane=[...doc.querySelectorAll('#track-lanes .track-lane')].find(row=>{const box=row.getBoundingClientRect();return top>=box.top&&top<box.bottom;});const color=lane&&view.getComputedStyle?.(lane)?.getPropertyValue('--abl-track')?.trim();if(color)element.style.setProperty('--abl-track',color);}catch{}
  const title=element.querySelector('.clip-title');if(title){const name=title.textContent.replace(/\s*·\s*placing…$/,'');title.textContent=name;title.title=name;
   if(element.dataset.pendingKind!=='paste'){const status=doc.createElement('span');status.className='abl-pending-status';status.textContent='Importing…';title.append(status);}}
 }
 {const Observer=view.MutationObserver||globalThis.MutationObserver,host=$('#arrangement');if(Observer&&host){const observer=new Observer(records=>{for(const record of records)for(const node of record.addedNodes){if(node.classList?.contains('playlist-pending-clip'))decoratePendingClip(node);else if(node.id==='logic-import-ghost')colourImportGhost(node);}});observer.observe(host,{childList:true});disposers.push(()=>observer.disconnect());}}
 try{const RO=view.ResizeObserver||globalThis.ResizeObserver;if(RO){const observer=new RO(()=>measureArrangement());observer.observe($('#arrangement-scroll'));disposers.push(()=>observer.disconnect());}}catch{}
 // Live: a Main track row closes the Arrangement track list (after the free rows here, see below).
 // Freestyle's master has no clips; the row names it. Return rows appear only once
 // Freestyle reports return (bus) tracks in the Arrangement model, which it does not yet.
 function paintMainRow(){
  const host=$('#track-lanes');if(!host)return;let row=host.querySelector(':scope > .abl-main-row');
  const lanes=$$('#track-lanes > .track-lane'),firstEmpty=lanes.find(lane=>lane.classList.contains('logic-empty-row')||!!lane.querySelector('.logic-track-empty'));
  if(!row){row=doc.createElement('div');row.className='abl-main-row';row.innerHTML='<div class="abl-main-row-label" title="Main: the master output. Its volume / pan strip is in the Mixer (⌥⌘M).">Main</div>';}
  // Appended after every row: row ↔ y hit tests, drop rows and the nth-child track colours stay exactly as before.
  void firstEmpty;if(host.lastElementChild!==row)host.append(row);
  paintBusRows(host,row);
 }
 // Live 12: the Return tracks and Main sit under the tracks with their own header (colour name cell, activator, S,
 // volume). They mirror the Mixer's Return / Main strips: activator and S click the strip's own switch (one saved,
 // undoable write there), a double-click on the volume box opens the strip's typed level. Labels are drawn from
 // data-label so the rows' textContent stays the bare name.
 const busRowFrame={id:0};
 function busStrips(){return $$('#abl-session-mixer .abl-mixer-strip[data-mixer-row]');}
 function paintBusRow(row,strip,main){
  const name=main?'Main':strip?.querySelector('.strip-name')?.textContent?.trim()||'Return';
  let label=row.querySelector('.abl-main-row-label');if(!label){label=doc.createElement('div');label.className='abl-main-row-label';row.append(label);}
  let cell=label.querySelector('.abl-bus-name');
  if(!cell){label.textContent='';cell=doc.createElement('span');cell.className='abl-bus-name';const controls=doc.createElement('span');controls.className='abl-bus-controls';
   controls.innerHTML=`<button type="button" class="abl-bus-activator" data-label=""></button>${main?'':'<button type="button" class="abl-bus-solo" data-label="S" aria-label="Solo"></button>'}<span class="abl-bus-volume" data-label="" role="button" tabindex="-1"></span>`;
   label.append(cell,controls);
   controls.addEventListener('click',event=>{const target=event.target.closest?.('button');if(!target)return;event.stopPropagation();const live=busStrips().find(item=>item.dataset.mixerRow===row.dataset.mixerRow);const button=live?.querySelector(target.classList.contains('abl-bus-solo')?'.strip-controls .solo':main?'.abl-main-activator':'.strip-controls .abl-activator:not(.abl-main-activator)');if(button&&!button.disabled)button.click();else api.toast?.('Open the Mixer (⌥⌘M) to change this Return.');});
   controls.addEventListener('dblclick',event=>{if(!event.target.closest?.('.abl-bus-volume'))return;event.stopPropagation();const live=busStrips().find(item=>item.dataset.mixerRow===row.dataset.mixerRow);live?.querySelector('.strip-db')?.dispatchEvent(new (view.MouseEvent||MouseEvent)('dblclick',{bubbles:true}));});}
  cell.textContent=name;label.title=`${name}: drag its fader in the Mixer (⌥⌘M); double-click the volume box to type a level.`;
  if(strip){const color=strip.style.getPropertyValue('--abl-track-color');if(color&&!main)row.style.setProperty('--abl-track-color',color);}
  const activator=label.querySelector('.abl-bus-activator'),solo=label.querySelector('.abl-bus-solo'),volume=label.querySelector('.abl-bus-volume');
  const source=main?strip?.querySelector('.abl-main-activator'):strip?.querySelector('.strip-controls .abl-activator:not(.abl-main-activator)');
  const muted=main?source?.getAttribute('aria-pressed')==='false':!!source?.classList.contains('on');
  activator.dataset.label=main?'':source?.textContent?.trim()||'';activator.classList.toggle('off',muted);activator.setAttribute('aria-pressed',String(!muted));activator.setAttribute('aria-label',`${name} activator`);activator.disabled=!source||source.disabled;
  if(solo){const on=!!strip?.querySelector('.strip-controls .solo.on');solo.classList.toggle('on',on);solo.setAttribute('aria-pressed',String(on));solo.disabled=!strip?.querySelector('.strip-controls .solo:not([disabled])');}
  volume.dataset.label=strip?.querySelector('.strip-db')?.textContent?.trim()||'';volume.setAttribute('aria-label',`${name} volume ${volume.dataset.label} dB`);
 }
 function paintBusRows(host,mainRow){
  const strips=busStrips(),returns=strips.filter(strip=>strip.classList.contains('abl-return')),keys=returns.map(strip=>strip.dataset.mixerRow);
  for(const old of [...host.children].filter(child=>child.classList.contains('abl-return-row')))if(!keys.includes(old.dataset.mixerRow))old.remove();
  const rows=returns.map(strip=>{let row=[...host.children].find(child=>child.classList.contains('abl-return-row')&&child.dataset.mixerRow===strip.dataset.mixerRow);
   if(!row){row=doc.createElement('div');row.className='abl-return-row';row.dataset.mixerRow=strip.dataset.mixerRow;}
   paintBusRow(row,strip,false);return row;});
  // Keep the DOM order Returns (mixer order) → Main, touching it only when it differs.
  for(let index=rows.length-1;index>=0;index--){const row=rows[index],next=rows[index+1]||mainRow;if(row.parentElement!==host||row.nextElementSibling!==next)host.insertBefore(row,next);}
  const main=strips.find(strip=>strip.classList.contains('abl-main'));if(main)mainRow.dataset.mixerRow=main.dataset.mixerRow;paintBusRow(mainRow,main,true);
  const mixer=$('#abl-session-mixer');if(mixer&&!mixer.__ablBusRows&&view.MutationObserver){mixer.__ablBusRows=new view.MutationObserver(()=>{if(busRowFrame.id)return;busRowFrame.id=(view.requestAnimationFrame||setTimeout)(()=>{busRowFrame.id=0;paintMainRow();});});mixer.__ablBusRows.observe(mixer,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-pressed','disabled'],characterData:true});}
 }
 // Live's bottom time ruler (0:00, 0:15 …) under the Arrangement, aligned with the grid and its scroll.
 let timeRuler=null,timeRulerFrame=0,beatRuler=null;
 function paintTimeRuler(){
  const scroll=$('#arrangement-scroll'),parent=scroll?.parentElement,grid=doc.querySelector('#track-lanes .lane-grid');if(!scroll||!parent)return;
  if(!timeRuler||timeRuler.parentElement!==parent){timeRuler?.remove();timeRuler=doc.createElement('div');timeRuler.className='abl-time-ruler';timeRuler.setAttribute('aria-hidden','true');scroll.after(timeRuler);}
  const bar=Number(api.barWidth?.())||30;let bpm=120;try{bpm=Number(api.clock?.()?.bpm)||Number(api.getProject?.()?.bpm)||120;}catch{}
  const pxPerSec=bar/4*bpm/60,box=timeRuler.getBoundingClientRect?.(),left=(grid?.getBoundingClientRect?.().left??0)-(box?.left??0),width=box?.width||scroll.clientWidth||0;
  // Round 2: at high zoom (down to sample level) the ruler keeps its labels: sub-second steps, shown as m:ss.mmm (Live: min:sec:ms).
  const step=TIME_RULER_STEPS.find(sec=>sec*pxPerSec>=64)||600,firstIndex=Math.max(0,Math.floor(-left/pxPerSec/step)),labels=[];
  for(let index=firstIndex;labels.length<400;index++){const sec=index*step,x=left+sec*pxPerSec;if(x>width)break;if(x>=-80)labels.push(`<span style="left:${Math.round(x)}px">${timeRulerLabel(sec,step)}</span>`);}
  const html=labels.join('');if(timeRuler._html!==html){timeRuler._html=html;timeRuler.innerHTML=html;}
  // Beat-time ruler: the bar numbers come from the inherited ruler (one per bar). Once a bar is wider than a few
  // hundred pixels the subdivisions get their own labels (bars.beats.sixteenths), so the ruler is never empty.
  const top=$('#timeline-ruler'),topBox=top?.getBoundingClientRect?.(),parentBox=parent.getBoundingClientRect?.();
  if(top&&topBox&&parentBox){
   if(!beatRuler||beatRuler.parentElement!==parent){beatRuler?.remove();beatRuler=doc.createElement('div');beatRuler.className='abl-beat-ruler';beatRuler.setAttribute('aria-hidden','true');parent.append(beatRuler);}
   const gridLeft=grid?.getBoundingClientRect?.().left??topBox.left,viewLeft=Math.max(box?.left??parentBox.left,parentBox.left),pxPerBeat=bar/4,labelsTop=[];
   beatRuler.style.top=`${Math.round(topBox.top-parentBox.top)}px`;beatRuler.style.left=`${Math.round(viewLeft-parentBox.left)}px`;beatRuler.style.width=`${Math.round(width)}px`;beatRuler.style.height=`${Math.round(topBox.height)}px`;
   const beatStep=BEAT_RULER_STEPS.find(beats=>beats*pxPerBeat>=72);
   if(beatStep&&beatStep<4){const offset=gridLeft-viewLeft,first=Math.max(0,Math.floor(-offset/pxPerBeat/beatStep));
    for(let index=first;labelsTop.length<200;index++){const beats=index*beatStep,x=offset+beats*pxPerBeat;if(x>width)break;if(x<-90||bar>width*.6&&x<56||Math.abs(beats/4-Math.round(beats/4))<1e-9&&x>=0)continue;/* bar starts are the inherited numbers */labelsTop.push(`<span style="left:${Math.round(x)}px">${beatRulerLabel(beats,beatStep)}</span>`);}
    // A bar number that scrolled off the left edge stays readable at the edge.
    if(bar>width*.6){const current=Math.max(0,-offset/pxPerBeat);labelsTop.unshift(`<span class="abl-beat-ruler-edge" style="left:0px">${beatRulerLabel(Math.floor(current/beatStep)*beatStep,beatStep)}</span>`);}}
   const topHtml=labelsTop.join('');if(beatRuler._html!==topHtml){beatRuler._html=topHtml;beatRuler.innerHTML=topHtml;}
  }
 }
 const queueTimeRuler=()=>{if(timeRulerFrame)return;timeRulerFrame=(view.requestAnimationFrame||setTimeout)(()=>{timeRulerFrame=0;paintTimeRuler();});};
 on($('#arrangement-scroll'),'scroll',queueTimeRuler);
 /* QA r6: the ruler lagged one zoom step (a zoom at scroll 0 fires no scroll). Every zoom path (keys, menu, wheel,
    navigator) sets --bar on :root, so repaint whenever that value changes. */
 {let lastBar=doc.documentElement.style.getPropertyValue('--bar');const Observer=view.MutationObserver||globalThis.MutationObserver;if(Observer){const observer=new Observer(()=>{const bar=doc.documentElement.style.getPropertyValue('--bar');if(bar===lastBar)return;lastBar=bar;queueTimeRuler();});observer.observe(doc.documentElement,{attributes:true,attributeFilter:['style']});disposers.push(()=>observer.disconnect());}}
 disposers.push(()=>timeRuler?.remove());
 function realTrackRows(){return [...doc.querySelectorAll('#track-lanes > .track-lane')].filter(lane=>!(lane.classList.contains('logic-empty-row')||lane.querySelector('.logic-track-empty'))).length;}
 function decorateArrangement(){
  // QA r5: the render that adds the real lane drops the placeholder (no "saving…" duplicate row below it while the
  // create's reply is still settling): the placeholder only paints while no new real row has appeared.
  const pendingTrack=state.pendingTrack&&!(realTrackRows()>state.pendingTrack.rows)?state.pendingTrack:null;
  let first=true,laneIndex=-1;for(const lane of $$('#track-lanes > .track-lane')){laneIndex++;
   // Track Color: a lane colour overrides the nth-child palette colour (header, clips, title strip).
   {let color=null;try{color=ablLaneColors.displayColor(laneIndex);}catch{}if(color)lane.style.setProperty('--abl-track',color);else lane.style.removeProperty('--abl-track');lane.toggleAttribute('data-abl-color',!!color);}const empty=lane.classList.contains('logic-empty-row')||!!lane.querySelector('.logic-track-empty');lane.classList.toggle('abl-drop-zone',empty&&first);
   // QA r3: ⌘T / ⇧⌘T paint the new track at once in the first free row (its nth-child colour = the next track colour).
   const pending=empty&&first&&pendingTrack;lane.classList.toggle('abl-pending-track',!!pending);const label=lane.querySelector('.track-label');let tag=label?.querySelector('.abl-pending-track-name');
   if(pending&&label){if(!tag){tag=doc.createElement('span');tag.className='abl-pending-track-name';label.append(tag);}tag.textContent=pending.name;label.title=`${pending.name} · saving in Freestyle…`;}else if(tag){tag.remove();label.removeAttribute('title');}
   if(empty)first=false;}
  paintMainRow();paintTimeRuler();
  for(const button of $$('#track-lanes .abl-activator'))button.setAttribute('aria-pressed',String(!button.classList.contains('off')));
  for(const label of $$('#track-lanes .track-label[data-track]'))label.classList.toggle('abl-selected',Number(label.dataset.track)===state.selectedTrack);
  measureArrangement();paintFold();
 }

 // ── Session View
 function sessionApi(){return{
  selectSlot:(slot,track)=>{slotGesture={dragging:false,deferred:false};api.selectRegions(slot.clipIds);selectTrack(track,{showDevice:false});paintSessionSelection();},
  openSlot:slot=>{const clip=api.findClip(slot.clipIds[0]);if(!clip){if(slot.unplaced)toast(`“${slot.name}” is not placed in the Arrangement yet: drag it into the Arrangement to place and edit it.`);return;}openClip(clip,{from:'session'});},
  // Live's clip-slot menu starts with the launch commands, then the clip commands.
  slotMenu:(event,slot,track)=>{const clip=api.findClip(slot.clipIds[0]);if(!clip)return;api.selectRegions(slot.clipIds);const engine=api.engineState?.()||{},playing=!!engine.previewing&&engine.previewPatternId===slot.patternId||[...(engine.layers?.values?.()||[])].some(layer=>layer.patternId===slot.patternId);clipMenu(event,clip,{prefix:[{label:playing?'Stop Clip':'Launch Clip',shortcut:'↵',disabled:slot.type!=='pattern',title:slot.type!=='pattern'?'Audio clips play in the Arrangement; Freestyle launches pattern (MIDI) clips only.':'',run:safe(()=>api.launchClip&&Number.isInteger(Number(track))?api.launchClip(slot.patternId,Number(track)):api.launchPattern(slot.patternId))},{label:'Stop All Clips',shortcut:'⌘↵',run:safe(()=>api.stopTransport?.())}]});},
  launch:(slot,track)=>safe(()=>api.launchClip?api.launchClip(slot.patternId,Number(track)):api.launchPattern(slot.patternId))(),
  // Freestyle #14: scene ▶ starts the row's clips together; a track's ■ stops its slot; Stop All Clips stops all.
  launchScene:(scene,model)=>{const plan=scenePreviews(model,scene);if(plan.overflow)toast(`Freestyle launches at most ${MAX_SCENE_CLIPS} clips at once: ${plan.overflow} clip${plan.overflow===1?' was':'s were'} left out.`);if(plan.skippedAudio&&plan.previews.length)toast('Audio clips of this scene stay silent: Freestyle launches pattern (MIDI) clips only.');return safe(()=>api.launchScene?.({index:scene,previews:plan.previews}))();},
  selectMain:()=>{try{view.ablDevices?.showLane?.('master');layout.showDetail?.('device');}catch(error){api.fail(error);}},
  stopTrack:track=>safe(()=>api.stopSessionTrack?api.stopSessionTrack(track.track):api.stopTransport())(),
  stopAll:()=>Promise.resolve(safe(()=>api.stopTransport())()).finally(()=>renderSessionNow()),
  // Live: a double-clicked empty slot gets a new MIDI clip that opens in the Clip View.
  // QA r3: Freestyle stores no Session scenes; a column lists the track's clips in Arrangement order with no
  // gaps, so a clip created from row N > next free row lands in the next free row, and the toast says why.
  // QA r5: the placeholder (painted by the dblclick in the landing slot) is kept in every render via
  // state.sessionPending until the confirmed clip fills that slot, then dropped in the same render (no gap).
  createClip:(track,scene,{landing=track.slots.length}={})=>{const next=landing;if(Number.isInteger(scene)&&scene!==next)toast(`New clip goes in slot ${next+1}: Freestyle has no Session scenes, so a track’s clips stack in Arrangement order without empty slots between them.`);
   const pending={track:track.track,scene:next,name:'MIDI Clip'};state.sessionPending=pending;const settle=()=>{if(state.sessionPending!==pending)return;state.sessionPending=null;if(layout.currentView()==='session')renderSessionNow();else state.sessionDirty=true;};
   let made;try{made=safe(()=>api.createRegionAt(track.track,Math.ceil(track.end/4-1e-9)*4,'midi'))();}catch(error){settle();throw error;}Promise.resolve(made).then(result=>{settle();const clip=result?.clipId?api.findClip(result.clipId):null;if(clip)openClip(clip);},error=>{settle();api.fail(error);});return made;},
  // A MIDI clip dropped on a track column (from Browser ▸ Clips or another track's slot): one placement after the
  // track's last clip, so it shows as the track's next slot (the same rule as a new clip above).
  dropPattern:(patternId,track)=>{if(!api.placePattern)return false;const name=(()=>{try{return api.getProject()?.patterns?.find(item=>item.id===patternId)?.name||'MIDI clip';}catch{return 'MIDI clip';}})();
   if(!(track?.midi&&track.laneId)){toast('MIDI clips go on MIDI tracks: drop it on a MIDI track column.');return false;}
   if(track.slots.some(slot=>slot.patternId===patternId&&!slot.unplaced)){toast(`“${name}” is already a clip of ${track.name}.`);return false;}
   if(api.editable&&!api.editable()){toast('Wait for the current cloud operation to finish.');return false;}
   selectTrack(track.track,{showDevice:false});return safe(()=>api.placePattern(patternId,track.track,Math.ceil(track.end/4-1e-9)*4))();},
  selectTrack:track=>selectTrack(track),trackMenu:(event,track)=>trackMenu(event,track),renameTrack:track=>safe(()=>api.renameTrack(track))(),
  stop:()=>safe(()=>api.stopTransport())(),dragStart:()=>{if(slotGesture)slotGesture.dragging=true;else slotGesture={dragging:true,deferred:false};},dragEnd:()=>endSlotGesture()
 };}
 // QA r9: a Session slot drag starts from the pressed element. Chrome cancels the native drag when that element is
 // replaced between pointerdown and dragstart or during the drag, so a grid render requested while a slot is pressed
 // or dragged waits until the press ends (pointerup / pointercancel without a drag) or the drag ends (dragend / drop).
 let slotGesture=null;
 function endSlotGesture(){const gesture=slotGesture;slotGesture=null;if(gesture?.deferred){if(layout.currentView()==='session')renderSessionNow();else state.sessionDirty=true;}}
 for(const type of ['pointerup','pointercancel'])on(doc,type,()=>{if(slotGesture&&!slotGesture.dragging)view.setTimeout?(view.setTimeout(()=>{if(slotGesture&&!slotGesture.dragging)endSlotGesture();},0)):endSlotGesture();},true);
 for(const type of ['dragend','drop'])on(doc,type,()=>{if(slotGesture?.dragging)endSlotGesture();},true);
 function renderSessionNow(){
  if(slotGesture){slotGesture.deferred=true;return;}
  state.sessionDirty=false;const host=$('#abl-session-grid');if(!host)return;let project;try{project=api.getProject();}catch{return;}if(!project)return;
  const engine=api.engineState?.()||{};
  try{state.sessionRows=sessionFillRows();const model=renderSession(host,project,sessionApi(),{selectedIds:api.selectedIds(),selectedTrack:state.selectedTrack,previewPatternId:engine.previewPatternId,previewing:!!engine.previewing,layers:engine.layers||null,sceneLaunch:!!api.sceneLaunchAvailable?.(),minScenes:state.sessionRows,pending:state.sessionPending||null});paintQueuedLaunch();
   // Freestyle #11: keep the visible pattern clips armed (scene order, the engine keeps 16 per peer).
   if(model?.tracks&&api.armSessionClips){const ids=[];for(let scene=0;scene<model.scenes;scene++)for(const track of model.tracks){const slot=track.slots[scene];if(slot?.patternId)ids.push(slot.patternId);}api.armSessionClips(ids);}
  }catch(error){api.fail(error);}
 }
 // Live fills the clip-slot grid down to the mixer: as many slot rows as the visible height holds (head 20 px,
 // stop row 22 px, 23 px per slot; at least 8 scenes). Re-rendered when that count changes (resize, mixer, Detail View).
 function sessionFillRows(){const scroll=$('#abl-session-grid')?.closest?.('.abl-session-scroll')||$('#abl-session-grid')?.parentElement,height=Number(scroll?.clientHeight)||0;return Math.max(8,Math.floor((height-20-22)/23));}
 try{const RO=view.ResizeObserver||globalThis.ResizeObserver,scroll=$('#abl-session-grid')?.closest?.('.abl-session-scroll');if(RO&&scroll){const observer=new RO(()=>{if(layout.currentView()==='session'&&sessionFillRows()!==state.sessionRows)renderSessionNow();});observer.observe(scroll);disposers.push(()=>observer.disconnect());}}catch{}
 // Live: a clip waiting to launch blinks its launch button until it starts.
 on(doc,'abl:launch-queued',event=>{state.queuedPattern=event.detail?.patternId??null;paintQueuedLaunch();});
 on(doc,'abl:session-layers',()=>{if(layout.currentView()==='session')renderSessionNow();else state.sessionDirty=true;});
 function paintQueuedLaunch(){const cursor=state.sessionCursor;for(const slot of $$('#abl-session-grid .abl-slot')){slot.classList.toggle('abl-queued',!!state.queuedPattern&&slot.dataset.pattern===state.queuedPattern);slot.classList.toggle('abl-cursor',!!cursor&&slot.dataset.track===cursor.track&&slot.dataset.scene===cursor.scene);}}
 function paintSessionSelection(){paintQueuedLaunch();const ids=api.selectedIds();for(const slot of $$('#abl-session-grid .abl-slot.filled')){const track=Number(slot.dataset.track),clips=api.allClips().filter(clip=>clip.track===track&&(slot.dataset.pattern?clip.patternId===slot.dataset.pattern:`a:${clip.id}`===slot.dataset.slot));slot.classList.toggle('selected',clips.some(clip=>ids.has(clip.id)));}for(const column of $$('#abl-session-grid .abl-session-track'))column.classList.toggle('selected',Number(column.dataset.track)===state.selectedTrack);}

 // ── Hooks the application calls after its renders
 const previous={afterTracks:hooks.afterTracks,selection:hooks.selection,mixer:hooks.mixer};
 // Live always has a selected track: auto-select the first one on load so the Device View is never empty.
 let autoSelecting=false;
 function ensureSelectedTrack(){if(autoSelecting)return;const row=state.selectedTrack;if(Number.isInteger(row)&&laneIdOf(row))return;if(!laneIdOf(0))return;autoSelecting=true;try{selectTrack(0,{showDevice:false});}catch(error){api.fail?.(error);}finally{autoSelecting=false;}}
 // QA r3: every project render (including Undo/Redo) re-syncs a showing Clip View, whose sync closes a clip that is gone.
 hooks.afterTracks=()=>{previous.afterTracks?.();decorateArrangement();paintPosition();ensureSelectedTrack();paintTrackChip();try{const clipView=view.ablClipView;if(clipView&&clipView.kind!=='none'&&typeof clipView.sync==='function')clipView.sync();}catch{}if(layout.currentView()==='session')renderSessionNow();else state.sessionDirty=true;};
 hooks.selection=()=>{previous.selection?.();try{const ids=api.selectedIds(),clip=api.allClips().find(item=>ids.has(item.id));if(clip&&Number.isInteger(clip.track)&&clip.track!==state.selectedTrack)state.selectedTrack=clip.track;}catch{}paintTrackChip();if(layout.currentView()==='session')paintSessionSelection();};
 hooks.mixer=()=>{previous.mixer?.();decorateArrangement();paintTrackChip();};

 // ── Application menus (Live: File Edit Create View Options Help)
 const menus=api.menuItems||null,legacy={};
 if(menus){for(const name of Object.keys(menus)){legacy[name]=menus[name];delete menus[name];}}
 const pick=(name)=>{try{return legacy[name]?.()||[];}catch{return[];}};
 const findItem=(items,label)=>items.find(item=>item&&(Array.isArray(item)?item[0]===label:item.label===label))||null;
 const relabel=(item,label,shortcut)=>!item?null:Array.isArray(item)?[label,shortcut??item[1],item[2],item[3],item[4]]:{...item,label,...(shortcut!==undefined?{shortcut}:{})};
 const findIn=(items,prefix)=>items.find(item=>item&&String(Array.isArray(item)?item[0]:item.label).startsWith(prefix))||null;
 const sub=(label,items,extra={})=>({label,submenu:items.filter((item,index,list)=>item!==undefined&&!(item===null&&(index===0||list[index-1]===null))),...extra});
 const compact=items=>items.filter(item=>item!==undefined).filter((item,index,list)=>!(item===null&&(index===0||index===list.length-1||list[index-1]===null)));
 /** Edit ▸ Rename: the selected clip / track; with the Mixer focused, the shared Rename Track entry (strips, buses, Main guard). */
 const renameItem=selection=>{const shared=findItem(pick('Track'),'Rename Track');if(!selection&&shared&&api.activeEditor?.()==='mixer')return relabel(shared,'Rename','⌘R');return['Rename','⌘R',safe(()=>commands.rename({scope:scope()})),!selection&&!Number.isInteger(state.selectedTrack)];};
 /* The menu bar is Live 12's (File Edit Create Playback View Navigate Options Help): the same entries, order, separators,
    submenus and shortcuts. An entry with no Freestyle operation stays in place, disabled, with its reason as the hover
    title. Entries only Disabelton has follow in ONE trailing group at the end of the fitting menu, never mixed in. */
 const off=(label,shortcut,title)=>({label,shortcut:shortcut||'',disabled:true,title});
 const labelOf=item=>Array.isArray(item)?item[0]:item?.label;
 const pressed=button=>!!button&&(button.getAttribute?.('aria-pressed')==='true'||!!button.classList?.contains?.('lit'));
 const selectedRow=()=>Number.isInteger(state.selectedTrack)&&laneIdOf(state.selectedTrack)?state.selectedTrack:null;
 /** The Clip View shows a MIDI clip's note editor (its Fold / Scale / Preview buttons and note commands are usable). */
 const clipMidi=()=>{const clip=view.ablClipView;return !!clip&&clip.kind==='midi'&&layout.detailVisible()&&layout.detailKind()==='clip';};
 const clipButton=name=>{if(!clipMidi())return null;const button=view.ablClipView.root?.querySelector?.(`[data-action="${name}"]`);return button&&!button.disabled?button:null;};
 const NEED_MIDI_CLIP='Show a MIDI clip in the Clip View first (double-click the clip).';
 const clipToggle=(label,shortcut,name)=>{const button=clipButton(name);return button?{label,shortcut,checked:pressed(button),run:()=>button.click()}:off(label,shortcut,NEED_MIDI_CLIP);};
 const clipCommand=(label,shortcut,name)=>clipMidi()?{label,shortcut,run:safe(()=>view.ablClipView.command(name))}:off(label,shortcut,NEED_MIDI_CLIP);
 /** Create ▸ Import Audio/MIDI File...: Freestyle imports audio and MIDI through two pickers. */
 function openImportChooser(){const d=api.dialog('Import Audio/MIDI File','<p>Choose the kind of file to import.</p><p><button type="button" data-abl-import="audio" class="primary">Audio File…</button> <button type="button" data-abl-import="midi">MIDI File…</button></p>');for(const button of d.querySelectorAll('[data-abl-import]'))button.onclick=()=>{const kind=button.dataset.ablImport;d.close();safe(()=>kind==='midi'?api.importMidi():api.importAudio())();};return d;}
 const liveMenus={
  File:()=>{const file=pick('File'),find=label=>findItem(file,label);const bounceItem=find('Bounce')?.submenu?.[0],exportMidi=find('Export')?.submenu||[];
   return compact([relabel(find('New…'),'New Live Set','⌘N'),relabel(find('Open…'),'Open Live Set...','⌘O'),off('Open Recent Set','','Freestyle keeps no recent list: Open Live Set... lists your projects.'),off('Close Window','⌘W','Disabelton has one window: close the browser tab.'),null,
    off('Install Pack...','','Freestyle libraries are in the Browser; there are no Pack files.'),off('Add Folder to Browser...','','The Browser lists the Freestyle cloud library.'),null,
    off('Manage Files','','Freestyle keeps every file of a project in the cloud project.'),sub('Open Live Set Backups',[off('Show Backups in Browser','','Saved versions of this project are under File ▸ Revert to.'),off('Reveal Backups in Finder','','Saved versions are kept in the Freestyle cloud project, not in a folder.')]),null,
    relabel(find('Save'),'Save Live Set','⌘S'),relabel(find('Save As…'),'Save Live Set As...','⇧⌘S'),off('Save a Copy...','','Use Save Live Set As... — a Freestyle copy is always a new project.'),off('Collect All and Save','','Freestyle keeps every sample in the cloud project already.'),off('Save Live Set As Template...','','Freestyle has no project templates.'),off('Save Live Set As Default Set...','','Freestyle has no default-set file; new projects start empty.'),null,
    bounceItem?relabel(bounceItem,'Export Audio/Video...','⇧⌘R'):off('Export Audio/Video...','⇧⌘R','Export is not available right now.'),exportMidi[0]?relabel(exportMidi[0],'Export MIDI Clip...'):off('Export MIDI Clip...','','MIDI export is not available right now.'),
    null,/* Disabelton only */...(embeddedInFreestyle()?[['Share Project…','',()=>openFreestyleShare()]]:[]),api.saveVersion?{label:'Save Version…',run:safe(()=>openSaveVersion()),title:'A named Freestyle save (with its mix render, as Studio Pro’s Save History)'}:undefined,find('Revert to')||undefined,find('Import')||undefined,exportMidi[1]?relabel(exportMidi[1],'Export Project as MIDI File…'):undefined,relabel(find('Project Settings…'),'Set Info…')||undefined,find('Share')||undefined]);},
  Edit:()=>{const edit=pick('Edit'),find=label=>findItem(edit,label),selection=api.selectedIds().size>0;
   const live=item=>item&&relabel(item,ablCopy(Array.isArray(item)?item[0]:item.label));/* "Undo Clone pattern clip" → "Undo Duplicate Clip" */
   const row=selectedRow(),noRipple='Freestyle has no ripple (time) edits',noMarkerKeys='Drag the clip’s start, end and loop markers in the Clip View ruler.',noBounce='Freestyle has no freeze or bounce-in-place: use File ▸ Export Audio/Video...',noRecordQuantize='Freestyle records MIDI as played: quantize the take afterwards (⌘U).';
   const clipboardItems=trackClipboardTarget(selection)!==null?trackClipboardItems(trackClipboardTarget(selection)):[['Cut','⌘X',safe(()=>api.clipboard('cut')),!selection],['Copy','⌘C',safe(()=>api.clipboard('copy')),!selection],['Paste','⌘V',safe(()=>api.clipboard('paste'))]];
   /* Live: right after a track header click (track focus, as the ⌫ key), Edit ▸ Delete deletes that track. */
   const deleteItem=(()=>{const trackRow=state.trackFocus&&row!==null?row:null;const blocked=trackRow!==null?deleteAvailability(trackRow):null;return trackRow!==null?{label:'Delete',shortcut:blocked.enabled?'⌫':'',run:safe(()=>api.deleteTrack(trackRow)),disabled:!blocked.enabled,title:blocked.enabled?`Delete track “${api.trackName(trackRow)}”`:blocked.reason}:['Delete','⌫',safe(()=>api.deleteSelected()),!selection];})();
   const splitItem=!selection&&Number.isInteger(state.selectedTrack)&&ops?{label:'Split',shortcut:'⌘E',run:safe(()=>splitSelectedTrack(state.selectedTrack)),disabled:!trackSplitClips(state.selectedTrack).length,title:trackSplitClips(state.selectedTrack).length?`Split the clips of “${api.trackName?.(state.selectedTrack)||'this track'}” at the insert marker`:'Put the insert marker inside a clip on the selected track.'}:['Split','⌘E',safe(()=>logic?.splitAtPlayhead?.()),!selection];
   const trackSwitch=(selector,on,offLabel,key,command)=>({label:pressed(headerButton(row,selector))?on:offLabel,shortcut:key,run:()=>commands[command](),disabled:row===null,title:row===null?'Select a track first (click its header).':''});
   return compact([live(find('Undo'))||['Undo','⌘Z',()=>api.undo()],live(find('Redo'))||['Redo','⇧⌘Z',()=>api.redo()],null,
    ...clipboardItems,['Duplicate','⌘D',safe(()=>api.repeat()),!selection],deleteItem,null,
    {label:'Deactivate/Activate',shortcut:'0',run:safe(()=>commands.deactivate({scope:'arrangement'})),disabled:!selection&&row===null,title:!selection&&row===null?'Select clips or a track first.':'Deactivates or activates the selected clips (or the selected track)'},null,
    ['Select All','⌘A',()=>api.selectRegions(api.allClips().map(clip=>clip.id))],{label:'Invert Selection',shortcut:'⇧⌘A',run:()=>commands['invert-selection']()},{label:'Select Loop',shortcut:'⇧⌘L',run:()=>commands['select-loop']()},['Loop Selection','⌘L',safe(()=>commands['loop-selection']()),!selection],sub('Clip Markers',[off('Set Start Marker','⌘F9',noMarkerKeys),off('Set Loop Start','⌘F10',noMarkerKeys),off('Set Loop End','⌘F11',noMarkerKeys),off('Set End Marker','⌘F12',noMarkerKeys)]),null,
    off('Group','⌘G','Freestyle has no track groups.'),off('Ungroup','⇧⌘G','Freestyle has no track groups.'),null,
    off('Compare: Switch to B','P','Freestyle devices have no A/B compare states.'),off('Compare: Copy A to B','','Freestyle devices have no A/B compare states.'),null,
    off('Cut Time','⇧⌘X',`${noRipple}: move the clips after the range instead.`),off('Copy Time','⇧⌘C',`${noRipple}: copy the clips with ⌘C.`),off('Paste Time','⇧⌘V',`${noRipple}.`),off('Duplicate Time','⇧⌘D',`${noRipple}: duplicate the clips with ⌘D.`),off('Delete Time','⇧⌘⌫',`${noRipple}: delete the clips and move the rest.`),null,
    off('Apply Transformation/Generator','⌘↵','Use the note transforms in the Clip View (Edit ▸ MIDI Transform below).'),null,
    renameItem(selection),off('Edit Info Text','','Freestyle stores no info text for clips, tracks or devices.'),null,
    trackSwitch('.abl-solo','Unsolo Track','Solo Track','S','solo-track'),trackSwitch('.abl-arm','Disarm Track','Arm Track','C','arm-track'),null,
    off('Freeze Track','⌥⇧⌘F',noBounce),off('Bounce Track in Place','',noBounce),off('Bounce to New Track','⌘B',noBounce),off('Paste Bounced Audio','⌥⌘V',noBounce),null,
    splitItem,off('Consolidate','⌘J','Freestyle has no consolidate operation.'),off('Fit to Time Range','⌥⌘J','Freestyle has no time-range fit for notes.'),null,
    {label:'Quantize',shortcut:'⌘U',run:safe(()=>commands.quantize({scope:scope()})),title:'Quantize the notes of the clip shown in the Clip View'},clipCommand('Quantize Settings...','⇧⌘U','quantize-settings'),off('Extract Groove(s)','','Freestyle has no grooves.'),sub('Record Quantization',['No Quantization','Quarter-Note Quantization','Eighth-Note Quantization','Eighth-Note Triplets Quantization','Eighth-Note and Triplets Quantization','Sixteenth-Note Quantization','Sixteenth-Note Triplets Quantization','Sixteenth-Note and Triplets Quantization','Thirty-Second Note Quantization'].map((label,index)=>({label,checked:index===0,disabled:true,title:noRecordQuantize}))),null,
    off('Simplify Envelope','','Freestyle has no envelope simplify operation.'),null,
    off('Emoji & Symbols','⌃⌘Space','A macOS panel: press ⌃⌘Space while typing in a text field.'),
    null,/* Disabelton only */find('Audio Time Range…')||undefined,find('MIDI Transform')||undefined,find('Cloud Edit Recovery')||undefined]);},
  Create:()=>{const audioClip=selectedClips().find(clip=>!clip.patternId)||null,noScenes='Scenes launch (▶ in the Main column), but Freestyle stores no scenes: a scene is the row of clips the tracks list, so there is no empty scene to insert, capture or consolidate into.',noConvert='Freestyle has no audio-to-MIDI conversion.',stemsLabel='Separate Stems to New Audio Tracks';
   let stems=null;try{stems=audioClip?view.ablStems?.clipMenuItems?.(audioClip)?.[0]||null:null;}catch{}
   return compact([...insertTrackItems(),{label:'Insert Return Track',shortcut:'⌥⌘T',run:safe(()=>api.insertReturnTrack()),title:'Creates a Freestyle bus (send / return)'},off('Insert Take Lane','⌥⇧T','Take lanes are not available on Freestyle.'),null,
    off('Insert Scene','⌘I',noScenes),off('Capture and Insert Scene','⇧⌘I',noScenes),off('Consolidate Time to New Scene','',noScenes),null,
    ['Insert Empty MIDI Clip','⇧⌘M',safe(()=>commands['insert-midi-clip']())],off('Capture MIDI','','Freestyle keeps no buffer of unrecorded MIDI: arm the track and record.'),null,
    off('Create Fade','⌥⌘F','Freestyle has no one-step fade for a time selection.'),null,
    off('Slice to New MIDI Track','',noConvert),off('Convert Harmony to New MIDI Track','',noConvert),off('Convert Melody to New MIDI Track','',noConvert),off('Convert Drums to New MIDI Track','',noConvert),Array.isArray(stems?.submenu)?{label:stemsLabel,submenu:stems.submenu}:off(stemsLabel,'',stems?.title||'Select an audio clip first.'),null,
    off('Delete Locator','','Freestyle projects have no locators.'),{label:'Add Time Signature Change',run:safe(()=>api.timing()),title:'Opens Tempo & Time Signatures: Freestyle edits the whole tempo / signature map in one dialog'},null,
    {label:'Import Audio/MIDI File...',run:()=>openImportChooser()},
    null,/* Disabelton only */{label:'Insert Vocal Track',run:safe(()=>api.insertTrack('vocal')),title:'A Freestyle vocal lane (an audio track with Freestyle’s vocal chain)'}]);},
  /* Live 12 (the installed 12.4 build lists Playback> and Navigate> commands): transport and focus commands as menus,
     mapped onto the existing actions. */
  Playback:()=>{let active=false;try{active=!!api.transportActive?.();}catch{}const cycle=findItem(pick('Navigate'),'Cycle'),metronome=findItem(pick('Record'),'Metronome Click'),noSetting='Freestyle has no setting for this.';
   return compact([{label:active?'Stop':'Play',shortcut:'Space',run:()=>$(active?'#stop':'#play')?.click()},{label:'Continue Playback',shortcut:'⇧Space',run:safe(()=>commands['continue-play']?.())},{label:'Play From Insert Marker',shortcut:'⌥Space',run:()=>commands['play-from-marker']()},{label:'Return Play Position to 1.1.1',shortcut:'',run:safe(()=>api.goToStart?.()),title:'Also the Home key'},{label:'Move Insert Marker To Playhead',shortcut:'⇧⌘Space',run:()=>commands['marker-to-playhead']()},
    sub('Options',[{label:'Follow',shortcut:'⌥⇧F',checked:followOn,run:()=>toggleFollow()},off('Start Transport With Record','',noSetting),off('Start Transport With Tap Tempo','',noSetting),off('Link Start Stop Sync','','Link is not available on Freestyle.')]),null,
    {label:'Record to Arrangement',shortcut:'F9',run:()=>$('#record')?.click()},off('Arm Recording to Arrangement','⇧F9','Press F9 to record: Freestyle has no separate arrangement-record arm.'),off('Record to Session','⇧⌘F9','Freestyle has no Session clip slots to record into.'),null,
    metronome?relabel(metronome,'Metronome','O'):{label:'Metronome',shortcut:'O',run:()=>$('#metronome')?.click()},off('Hear Metronome Only While Recording','',noSetting),null,
    off('Back to Arrangement','F10','There is no Session playback to override the Arrangement.'),
    null,/* Disabelton only */cycle?relabel(cycle,'Loop Switch',cycle.shortcut==='C'?'':cycle.shortcut):undefined,['Set Loop…','',safe(()=>api.playlistLoop?.open?.())]]);},
  Navigate:()=>{const current=layout.currentView(),noFocus='Pane-to-pane keyboard focus is not available: use Tab / ⇧Tab inside a pane.';
   return compact([{label:'Control Bar',shortcut:'⌥0',run:()=>commands['focus-control-bar']()},{label:'Session View',shortcut:'⌥1',checked:current==='session',run:()=>layout.setView('session')},{label:'Arrangement View',shortcut:'⌥2',checked:current==='arrangement',run:()=>layout.setView('arrangement')},{label:'Clip View',shortcut:'⌥3',run:()=>layout.showDetail('clip')},{label:'Device View',shortcut:'⌥4',run:()=>layout.showDetail('device')},{label:'Browser',shortcut:'⌥5',run:safe(()=>{layout.toggleBrowser(true);commands['focus-browser-search']?.();})},off('Groove Pool','⌥6','Freestyle has no grooves.'),off('Learn View','⌥7','Disabelton has no built-in lessons: see Help ▸ Key Commands.'),off('Tuning','','Freestyle has no tuning systems.'),null,
    {label:'Mixer',shortcut:'⌥⇧M',run:()=>commands['focus-mixer']()},off('Clip Panels','⌥⇧P',noFocus),null,
    off('Previous','',noFocus),off('Next','',noFocus),off('Previous Neighbor','⌥⇧Tab',noFocus),off('Next Neighbor','⌥Tab',noFocus),null,
    off('Browser History Back','⌘[','The Browser keeps no navigation history.'),off('Browser History Forward','⌘]','The Browser keeps no navigation history.'),null,
    off('Use Tab Key to Move Focus','','Tab switches between the Arrangement and Session View.'),off('Wrap Keyboard Navigation','',noFocus)]);},
  View:()=>{const detail=layout.detailVisible(),kind=layout.detailKind(),row=selectedRow(),undoHistory=findItem(pick('Edit'),'Undo History…'),io=$('.abl-section-toggle[data-section="io"]'),unfolded=!!headerButton(row,'.abl-fold')?.closest?.('.track-lane')?.classList?.contains?.('abl-unfolded');
   const browserZoom='Use the browser’s own zoom: ⌘+ / ⌘− / ⌘0.',noPacks='Freestyle libraries are in the Browser; there are no Packs.',panels='The Clip View panels have one fixed arrangement.',alwaysShown='Always shown: this section cannot be hidden.',noSection='The mixer has no such section on Freestyle.';
   const inOut=(shortcut,title)=>({label:'In/Out',shortcut,checked:pressed(io),run:()=>commands['toggle-in-out'](),title});
   return compact([{label:'Full Screen',shortcut:'⌃⌘F',checked:!!doc.fullscreenElement,run:()=>commands['full-screen']()},off('Second Window','⇧⌘W','Disabelton has one window.'),sub('Zoom',[off('Zoom In','⌘+',browserZoom),off('Zoom Out','⌘-',browserZoom),off('Reset Zoom to 100%','⌥⌘0',browserZoom)]),null,
    off('Info','?','Hover a control: its description shows in the status bar.'),off('Learn View','⌥⌘7','Disabelton has no built-in lessons: see Help ▸ Key Commands.'),off('Pack Overview','',noPacks),off('File Manager','','Freestyle keeps every file of a project in the cloud project.'),undoHistory?relabel(undoHistory,'Undo History','⌥⌘Z'):off('Undo History','⌥⌘Z','Undo History is not available right now.'),null,
    {label:'Toggle Arrangement/Session View',shortcut:'Tab',run:()=>layout.toggleView()},null,
    {label:'Clip View',shortcut:'⌥⌘3',checked:detail&&kind==='clip',run:()=>commands['toggle-clip-view']()},{label:'Device View',shortcut:'⌥⌘4',checked:detail&&kind==='device',run:()=>commands['toggle-device-view']()},{label:'Toggle Clip/Device View',shortcut:'⇧Tab',run:()=>layout.toggleDetailKind()},{label:'Expand Clip View',shortcut:'⌥⌘E',checked:state.detailExpandBack!=null,run:()=>commands['expand-clip-view']()},{label:`${detail?'Hide':'Show'} ${kind==='clip'?'Clip':'Device'} View`,shortcut:'⌥⌘L',run:()=>layout.toggleDetail()},null,
    {label:'Arrange Clip View Panels Automatically',checked:true,disabled:true,title:panels},off('Arrange Clip View Panels Horizontally','',panels),off('Arrange Clip View Panels Vertically','',panels),null,
    {label:'MIDI Note Editor',shortcut:'⌥⇧1',run:()=>commands['show-note-editor']()},off('Envelope Editor','⌥⇧2','Clip envelopes are not available in Freestyle.'),off('Expression Editor','⌥⇧3','MPE is not available in Freestyle.'),null,
    {label:'Browser',shortcut:'⌥⌘5',checked:layout.browserVisible(),run:()=>layout.toggleBrowser()},off('Groove Pool','⌥⌘6','Freestyle has no grooves.'),off('Tuning','','Freestyle has no tuning systems.'),off('Full-Height Browser','','The Browser has one fixed height.'),null,
    ['Search in Browser','⌘F',safe(()=>commands['focus-browser-search']?.())],off('Show Similar Files','⇧⌘F','The Freestyle library has no similarity search.'),off('Show Filter View','⌥⌘G','The Freestyle library has no filter view.'),null,
    off('Plug-In Windows','⌥⌘P','Open a plug-in’s window from its device in the Device View.'),off('Video Window','⇧⌥⌘V','Freestyle projects have no video.'),null,
    off('Show the Max for Live Window','⇧⌥⌘M','Max for Live is not available.'),null,
    {label:'Mixer',shortcut:'⌥⌘M',checked:layout.arrangementMixerVisible(),run:()=>commands['toggle-arrangement-mixer']()},sub('Mixer Controls',[inOut('','Shows or hides the In/Out section of the mixer strips'),{label:'Sends',checked:true,disabled:true,title:alwaysShown},{label:'Volume',checked:true,disabled:true,title:alwaysShown},null,off('Track Options','',noSection),off('Crossfader','','Freestyle has no crossfader.'),off('Performance Impact','',noSection),null,{label:'Return Tracks',checked:true,disabled:true,title:alwaysShown}]),sub('Arrangement Track Controls',[inOut('⌥⌘I','Track headers have no In/Out section: this shows or hides it on the mixer strips'),{label:'Volume',checked:true,disabled:true,title:alwaysShown},off('Track Options','','Track headers have no such section on Freestyle.'),null,off('Return Tracks','⌥⌘R','Return tracks cannot be hidden.')]),null,
    off('Overview','⌥⌘O','The overview strip above the Arrangement is always shown (click to jump, drag to scroll).'),off('Scene Tempo and Time Signature','','Freestyle has no Session scenes.'),null,
    {label:'Automation Mode',shortcut:'A',run:safe(()=>api.toggleAutomation())},{label:'Expand All Tracks',shortcut:'⌥U',run:()=>commands['fold-all-tracks'](),title:'Unfolds or folds every track'},{label:`${unfolded?'Fold':'Unfold'} Selected Track`,shortcut:'U',run:()=>commands['fold-track'](),disabled:row===null,title:row===null?'Select a track first (click its header).':''},null,
    clipToggle('Fold to Notes','F','fold'),clipToggle('Fold to Scale','G','scale-mode'),null,
    ['Zoom In Time','+',()=>api.zoomBy(1.25)],['Zoom Out Time','-',()=>api.zoomBy(.8)],['Zoom to Time Selection','Z',safe(()=>commands['zoom-to-selection']())],['Zoom Back from Time Selection','X',safe(()=>commands['zoom-back']())],
    null,/* Disabelton only */['Fit Arrangement Width','W',()=>api.zoomToFit()],['Fit Arrangement Height','H',()=>commands['zoom-fit-height']()],...(embeddedInFreestyle()?[sub('Studio View',STUDIO_VIEWS.map(([id,label])=>({label,checked:activeStudioView()===id,run:()=>switchStudioView(id)})))]:[])]);},
  Options:()=>{const record=pick('Record'),find=label=>findItem(record,label),mix=pick('Mix'),freestyle=pick('Freestyle'),snapValue=gridValue();
   const noSpeech='Disabelton has no built-in speech: use the system screen reader.',noSetting='Freestyle has no setting for this.',noFrames='The time ruler shows minutes and seconds only.',tripletReason='Freestyle positions are stored on a straight 96 PPQ grid: the Arrangement has no triplet grid (the Clip View note editor has one).';
   return compact([sub('Accessibility',['Speak Menu Commands','Speak Minimum and Maximum Sliders Values','Speak Time in Seconds','Speak Parameter States','Speak Extended MIDI Note Description'].map(label=>off(label,'',noSpeech))),null,
    off('Edit MIDI Map','⌘M','MIDI mapping is not available on Freestyle.'),off('Edit Key Map','⌘K','Key mapping is not available on Freestyle.'),{label:'Computer MIDI Keyboard',shortcut:'M',checked:!!api.typingEnabled?.(),run:safe(()=>commands['toggle-computer-keyboard']())},clipToggle('MIDI Note Editor Preview','','preview'),off('Browser File Preview','',noSetting),null,
    off('External Sync','','Freestyle has no external sync.'),off('Delay Compensation','',noSetting),off('Reduced Latency When Monitoring','',noSetting),null,
    sub('Time Ruler Format',[{label:'Time',checked:true,disabled:true,title:noFrames},off('24 fps (Film)','',noFrames),off('25 fps (PAL)','',noFrames),off('30 fps','',noFrames),off('29.97 fps (Drop Frame / NTSC-TV)','',noFrames),off('29.97 fps (Non-Drop / NTSC)','',noFrames)]),null,
    {label:'Narrow Grid',shortcut:'⌘1',run:()=>gridCommands['grid-narrow']()},{label:'Widen Grid',shortcut:'⌘2',run:()=>gridCommands['grid-widen']()},clipMidi()?{label:'Triplet Grid',shortcut:'⌘3',run:safe(()=>view.ablClipView.command('grid-triplet')),title:'The triplet grid of the Clip View note editor'}:off('Triplet Grid','⌘3',tripletReason),{label:'Snap to Grid',shortcut:'⌘4',checked:snapValue>0,run:()=>gridCommands['grid-snap']()},off('Snap Automation to Grid','',noSetting),{label:'Fixed Grid',shortcut:'⌘5',checked:grid.fixed!=null,run:()=>gridCommands['grid-fixed']()},null,
    {label:'Draw Mode',shortcut:'B',checked:api.getTool?.()==='draw',run:toggleDraw},off('Step Input Mode','⇧⌘B','Freestyle has no step input: draw the notes or record them.'),null,
    clipToggle('Highlight Scales','K','scale'),off('Chase MIDI Notes','',noSetting),off('MIDI Envelope Auto-Reset','',noSetting),off('Retune Set On Loading Tuning Systems','','Freestyle has no tuning systems.'),null,
    {label:'Solo Switches',checked:true,disabled:true,title:'Freestyle has one output and no cue bus, so the Solo buttons always solo.'},off('Cue Switches','','Freestyle has one output and no cue bus.'),off('Solo in Place','',noSetting),null,
    off('Lock Envelopes','',noSetting),{label:'MIDI Arrangement Overdub',checked:true,disabled:true,title:'A MIDI take always adds its notes to the clip; replacing notes while recording is not available on Freestyle.'},null,
    off('Max for Live Developer Mode','','Max for Live is not available.'),null,
    {label:'Audio Engine On',shortcut:'⇧⌥⌘E',checked:true,disabled:true,title:'The Freestyle cloud engine cannot be switched off from here.'},
    null,/* Disabelton only */find('MIDI Keyboard Input')||undefined,sub('Grid',[0,...ABL_GRID_STEPS].map(value=>({label:GRID_LABEL(value),checked:value===snapValue,run:()=>setGrid(value)}))),findIn(pick('View'),'Use both mouse buttons')||undefined,sub('Mixer',mix.filter(item=>!item||!/^Show (Mixer|Track Automation)$/.test(labelOf(item)))),sub('Freestyle',[...(embeddedInFreestyle()?[['Mozart AI…','',()=>openFreestyleMozart()],null]:[]),...freestyle])]);},
  Help:()=>{const help=pick('Help'),isDocs=item=>/documentation/i.test(labelOf(item)||''),docs=help.find(item=>item&&isDocs(item))||null,noPacks='Freestyle libraries are in the Browser; there are no Packs.';
   return compact([off('Learn View','','Disabelton has no built-in lessons: see Key Commands below.'),off('Pack Overview','',noPacks),null,
    off('Load Demo Set','','There is no demo project.'),docs?relabel(docs,'Read the Disabelton Manual...',''):off('Read the Disabelton Manual...','','The manual is not available right now.'),{label:'Learn Disabelton at freestyle.audio...',run:()=>{view.open?.('https://freestyle.audio/docs/','_blank');}},null,
    off('Join the User Forum...','','There is no user forum.'),off('Get Support','','Support goes through Freestyle: see the manual.'),off('User Account and Licenses...','','Your Freestyle account is managed at freestyle.audio.'),null,
    off('Check for Updates...','','A browser app: reload the page to get the latest version.'),
    null,/* Disabelton only */['Key Commands','',()=>openHelp()],...help.filter(item=>!item||!(/shortcuts/i.test(labelOf(item))||isDocs(item)))]);}
 };
 /* Live's Edit and View menus are taller than a laptop window (macOS scrolls them): a menu that does not fit the
    window continues in the next column; the column break takes the place of a separator. */
 const MENU_ROW_PX=20,MENU_RULE_PX=5;
 const columnize=items=>{const room=Math.max(260,(Number(view.innerHeight)||800)-64),out=[...items],height=item=>item===null?MENU_RULE_PX:MENU_ROW_PX;let used=0,rule=-1;
  for(let index=0;index<out.length;index++){used+=height(out[index]);if(out[index]===null)rule=index;if(used>room&&rule>=0){out[rule]={column:true};used=0;for(let after=rule+1;after<=index;after++)used+=height(out[after]);rule=-1;}}
  return out;};
 /* QA r7: a disabled menu item names its reason in its hover title too (not only in the status hint). */
 const DISABLED_REASONS={Cut:'Select a clip to cut.',Copy:'Select a clip to copy.',Duplicate:'Select a clip to duplicate.',Delete:'Select a clip, or click a track header, to delete it.',Split:'Select a clip and put the insert marker inside it.','Loop Selection':'Select a clip to loop its time range.',Rename:'Select a clip or a track to rename.'};
 const titled=items=>items.map(item=>{if(!item)return item;if(Array.isArray(item)){if(!item[3]||item[4])return item;const copy=[...item];copy[4]=DISABLED_REASONS[item[0]]||`${item[0]} is not available right now.`;return copy;}const out=item.submenu?{...item,submenu:titled(item.submenu)}:item;return out.disabled&&!out.title?{...out,title:DISABLED_REASONS[out.label]||`${out.label} is not available right now.`}:out;});
 {const order=['File','Edit','Create','Playback','View','Navigate','Options','Help'],sorted={};for(const name of order)if(liveMenus[name])sorted[name]=liveMenus[name];for(const name of Object.keys(liveMenus)){if(!sorted[name])sorted[name]=liveMenus[name];delete liveMenus[name];}Object.assign(liveMenus,sorted);}
 for(const name of Object.keys(liveMenus)){const build=liveMenus[name];liveMenus[name]=(...args)=>columnize(titled(build(...args)));}
 if(menus){Object.assign(menus,liveMenus);const nav=$('#main-menu');if(nav){nav.innerHTML=Object.keys(liveMenus).map(name=>`<button type="button" data-menu="${name}" aria-haspopup="menu" aria-expanded="false">${name}</button>`).join('');/* click/hover tracking is delegated on #main-menu in app.js */}}

 // ── Help
 function openHelp(){const d=api.dialog('Disabelton · Key Commands',`<p>An Ableton Live–style workstation for the Freestyle cloud DAW. All audio is rendered and played in the cloud.</p><div class="shortcuts">${ABL_KEY_HELP.map(([label,key])=>`<span>${esc(label)}</span><kbd>${esc(key)}</kbd>`).join('')}</div><p>Right-click a clip, track header or empty track space for its menu. Freestyle-specific tools live in Options ▸ Freestyle.</p>`);return d;}
 const help=$('#help');if(help)help.onclick=()=>openHelp();

 // ── Live key map
 const scope=event=>{const target=event?.target||doc.activeElement;if(target?.closest?.('#abl-detail-clip,#piano,#rack'))return 'clip';if(target?.closest?.('#abl-detail-device,#abl-arr-mixer,#abl-session-mixer,#mixer'))return 'device';if(target?.closest?.('aside.browser'))return 'browser';const editor=api.activeEditor?.();if(editor==='piano'||editor==='rack')return 'clip';if(editor==='mixer')return 'device';return editor==='playlist'||editor===null||editor===undefined?'arrangement':null;};
 function selectedClips(){const ids=api.selectedIds();return api.allClips().filter(clip=>ids.has(clip.id));}
 const commands={
  'toggle-follow':()=>toggleFollow(),
  'toggle-in-out':()=>{const toggle=$('.abl-section-toggle[data-section="io"]');if(toggle)toggle.click();else toast('In/Out: open the mixer first (Session View, or ⌥⌘M in the Arrangement).');},
  'focus-session':()=>layout.setView('session'),'focus-arrangement':()=>layout.setView('arrangement'),'focus-clip-view':()=>layout.showDetail('clip'),'focus-device-view':()=>layout.showDetail('device'),'focus-browser':safe(()=>{layout.toggleBrowser(true);commands['focus-browser-search']?.();}),
  'toggle-clip-view':()=>layout.detailVisible()&&layout.detailKind()==='clip'?layout.toggleDetail(false):layout.showDetail('clip'),
  'toggle-device-view':()=>layout.detailVisible()&&layout.detailKind()==='device'?layout.toggleDetail(false):layout.showDetail('device'),
  'toggle-metronome':()=>{$('#metronome')?.click();},
  'track-activator':action=>{const button=headerButton(action?.track,'.abl-activator');if(button)button.click();},
  unavailable:action=>toast(`${action?.what||'This command'} is not available: ${action?.why||'Freestyle has no equivalent.'}`),
  // Live H: Optimize Arrangement Height — every track shown at the height that fills the view (fold all when they do not fit).
  'zoom-fit-height':()=>{const lanes=$$('#track-lanes .track-lane').filter(lane=>lane.querySelector('.track-label[data-track]')&&!lane.querySelector('.logic-track-empty')),viewport=$('#arrangement-scroll');if(!lanes.length||!viewport)return;const unfolded=lanes.filter(lane=>lane.classList.contains('abl-unfolded')).length,total=lanes.reduce((sum,lane)=>sum+lane.getBoundingClientRect().height,0),fits=total<=viewport.clientHeight;const wantUnfold=unfolded===0&&lanes.length*68<=viewport.clientHeight;if((unfolded>0&&!fits)||wantUnfold)headerButton(Number(lanes[0].querySelector('.track-label[data-track]').dataset.track),'.abl-fold')?.dispatchEvent(new (view.MouseEvent||MouseEvent)('click',{bubbles:true,cancelable:true,altKey:true}));viewport.scrollTop=0;},
  'solo-track':()=>{const button=headerButton(state.selectedTrack,'.abl-solo');if(button)button.click();else toast('Solo: select a track first.');},
  'arm-track':()=>{const button=headerButton(state.selectedTrack,'.abl-arm');if(button)button.click();else toast('Arm: select a track first.');},
  'fold-track':()=>{const button=headerButton(state.selectedTrack,'.abl-fold');if(button)button.click();else toast('Fold: select a track first.');},
  'fold-all-tracks':()=>{const button=headerButton(Number.isInteger(state.selectedTrack)?state.selectedTrack:0,'.abl-fold');button?.dispatchEvent(new (view.MouseEvent||MouseEvent)('click',{bubbles:true,cancelable:true,altKey:true}));},
  'zoom-back':safe(()=>{const previous=state.zoomBack;state.zoomBack=null;return previous&&api.applyView?api.applyView(previous):api.zoomToFit();}),
  'zoom-fit-width':safe(()=>api.zoomToFit()),
  'toggle-view':()=>layout.toggleView(),'toggle-detail-kind':()=>layout.toggleDetailKind(),'toggle-detail':()=>layout.toggleDetail(),'toggle-browser':()=>layout.toggleBrowser(),
  'toggle-arrangement-mixer':()=>{if(layout.currentView()!=='arrangement')layout.setView('arrangement');return layout.toggleArrangementMixer();},
  'insert-return-track':safe(()=>api.insertReturnTrack()),record:safe(()=>api.record()),
  // ⇧Space: continue from the stop point (seek_and_play over the transport channel), not from the insert marker.
  'continue-play':safe(()=>{let active=false;try{active=!!api.transportActive?.();}catch{}const beat=active?null:heldStopBeat()??currentClockBeat();state.heldStopBeat=null;return api.continuePlay(beat??undefined);}),
  'insert-audio-track':safe(()=>insertNow('audio')),'insert-midi-track':safe(()=>insertNow('instrument')),
  'insert-midi-clip':safe(()=>{const row=Number.isInteger(state.selectedTrack)?state.selectedTrack:selectedClips()[0]?.track;if(!Number.isInteger(row)||!laneIdOf(row))return toast('Insert MIDI Clip: select a MIDI track first.');if(api.laneKind(row)==='audio')return toast('Insert MIDI Clip: select a MIDI track (this is an audio track).');return api.createRegionAt(row,api.snapBeat(api.playheadBeat()),'midi');}),
  'focus-browser-search':()=>{layout.toggleBrowser(true);const search=$('#browser-search');search?.focus();search?.select?.();},
  'loop-selection':safe(()=>{const clips=selectedClips();if(!clips.length)return toast('Loop Selection: select clips first (⌘L).');return api.setLocators(Math.min(...clips.map(clip=>clip.start)),Math.max(...clips.map(clip=>clip.start+clip.length)));}),
  'export-audio':safe(()=>api.bounce()),
  'group-tracks':()=>toast('Group Tracks: Freestyle has no track groups.'),'consolidate':()=>toast('Consolidate: Freestyle has no consolidate (render-in-place) operation.'),
  split:safe(action=>action?.scope==='clip'?toast('Split notes: use the Clip View tools.'):!selectedClips().length&&Number.isInteger(state.selectedTrack)&&ops?splitSelectedTrack(state.selectedTrack):logic?.splitAtPlayhead?.()),
  /* Live track Cut / Copy / Paste (track header focus, or the track menu): Studio Pro's Cut track / Copy track / Paste. */
  'track-cut':safe(row=>{const track=Number.isInteger(row)?row:state.selectedTrack;if(!Number.isInteger(track)||!ops)return toast('Cut: select a track first.');const gate=ops.cutAvailability(track);if(!gate.enabled)return toast(gate.reason);return ops.cutTrack(track).then(clip=>{toast(`Cut track “${clip.name}”. Paste (⌘V) puts it back below the selected track.`);return clip;});}),
  'track-copy':safe(row=>{const track=Number.isInteger(row)?row:state.selectedTrack;if(!Number.isInteger(track)||!ops)return toast('Copy: select a track first.');const gate=ops.copyAvailability(track);if(!gate.enabled)return toast(gate.reason);const clip=ops.copyTrack(track);toast(`Copied track “${clip.name}”.`);return clip;}),
  'track-paste':safe(row=>{const track=Number.isInteger(row)?row:state.selectedTrack;if(!ops)return null;const gate=ops.pasteAvailability();if(!gate.enabled)return toast(gate.reason);return ops.pasteTrack(Number.isInteger(track)?track:null).then(result=>{toast('Track pasted.');return result;});}),
  duplicate:safe(action=>action?.scope==='clip'?api.repeatNotes?.():selectedClips().length?api.repeat():Number.isInteger(state.selectedTrack)?(duplicateAvailability(state.selectedTrack)?.enabled===false?toast(duplicateAvailability(state.selectedTrack).reason):api.duplicateTrack(state.selectedTrack)):toast('Duplicate: select clips or a track (⌘D).')),
  rename:safe(action=>{/* Live: ⌘R acts on the selected device while the Device View has the focus. Freestyle stores no name for a plug-in instance. */if(action?.scope==='device'&&$('#abl-detail-device .abl-device.selected'))return toast('Rename: Freestyle has no name field for a plug-in device. (Click outside the device to rename the track.)');if(action?.scope==='clip')return toast('Rename: right-click the clip in the Arrangement.');const clips=selectedClips();if(clips.length)return api.renameRegion(clips[0]);if(Number.isInteger(state.selectedTrack))return api.renameTrack(state.selectedTrack);return toast('Rename: select a clip or track (⌘R).');}),
  quantize:safe(()=>api.quantize?.()),
  'grid-narrow':gridCommands['grid-narrow'],'grid-widen':gridCommands['grid-widen'],'grid-triplet':gridCommands['grid-triplet'],'grid-snap':gridCommands['grid-snap'],'grid-fixed':gridCommands['grid-fixed'],
  /* Live 12 menu-bar commands (Playback / Edit / View / Navigate) with their keys in abl-keys.js. */
  // ⌥Space: play from the insert marker (a running transport stops first, then restarts there).
  'play-from-marker':safe(async()=>{let active=false;try{active=!!api.transportActive?.();}catch{}if(active&&await api.stopTransport?.()===false)return null;state.heldStopBeat=null;const beat=Number(api.insertMarkerBeat?.());return api.continuePlay(Number.isFinite(beat)?beat:undefined);}),
  // ⇧⌘Space: the insert marker jumps to the play position (the held stop point while stopped).
  'marker-to-playhead':safe(()=>{const beat=heldStopBeat()??currentClockBeat();if(beat==null)return toast('Move Insert Marker To Playhead: the play position is not known yet.');return api.setInsertMarker(beat);}),
  // ⇧⌘A: every clip that was not selected becomes the selection.
  'invert-selection':safe(()=>{const ids=api.selectedIds();return api.selectRegions(api.allClips().filter(clip=>!ids.has(clip.id)).map(clip=>clip.id));}),
  // ⇧⌘L: select the clips inside the Arrangement loop (Freestyle reports the loop in seconds; a tempo map has no single beat length).
  'select-loop':safe(()=>{let clock={},project=null;try{clock=api.clock?.()||{};project=api.getProject();}catch{}const bpm=Number(project?.bpm),start=Number(clock.loopStartSec),end=Number(clock.loopEndSec);if(!(end>start)||!Number.isFinite(start))return toast('Select Loop: set a loop first (⌘L loops the selection).');if(!(bpm>0)||project?.cloud?.rawProject?.timingMap?.isConstantTempo===false)return toast('Select Loop is not available in a project with tempo changes.');const from=start*bpm/60-1e-6,to=end*bpm/60+1e-6,clips=api.allClips().filter(clip=>clip.start+clip.length>from+2e-6&&clip.start<to-2e-6);if(!clips.length)return toast('Select Loop: no clips inside the loop.');return api.selectRegions(clips.map(clip=>clip.id));}),
  'full-screen':()=>{try{const result=doc.fullscreenElement?doc.exitFullscreen?.():doc.documentElement?.requestFullscreen?.();if(result&&typeof result.catch==='function')result.catch(()=>toast('Full Screen was refused by the browser.'));}catch{toast('Full Screen is not available in this browser.');}},
  // ⌥⌘E: the Clip View takes the tallest Detail View height; again restores the previous height.
  'expand-clip-view':()=>{if(state.detailExpandBack!=null&&layout.detailVisible()){layout.setDetailHeight(state.detailExpandBack);state.detailExpandBack=null;return;}const height=Number(layout.state?.()?.detail?.height)||null;layout.showDetail('clip');state.detailExpandBack=height;layout.setDetailHeight(4000);},
  'focus-control-bar':()=>{try{($('#play')||$('#abl-position'))?.focus?.({preventScroll:true});}catch{}},
  'focus-mixer':()=>{if(layout.currentView()==='arrangement'&&!layout.arrangementMixerVisible())commands['toggle-arrangement-mixer']();},
  'show-note-editor':()=>layout.showDetail('clip'),
  'undo-history':safe(()=>{const item=findItem(pick('Edit'),'Undo History…'),run=Array.isArray(item)?item[2]:item?.run;return typeof run==='function'?run():toast('Undo History is not available.');}),
  'zoom-in':()=>api.zoomBy(1.25),'zoom-out':()=>api.zoomBy(.8),
  'zoom-to-selection':safe(()=>{try{if(!state.zoomBack&&api.view)state.zoomBack=api.view();}catch{}const clips=selectedClips();if(!clips.length)return api.zoomToFit();return api.zoomToRange?.(Math.min(...clips.map(clip=>clip.start)),Math.max(...clips.map(clip=>clip.start+clip.length)));}),
  'toggle-automation':safe(()=>api.toggleAutomation()),'toggle-draw':()=>toggleDraw(),
  'toggle-computer-keyboard':safe(()=>api.toggleComputerKeyboard()),
  deactivate:safe(action=>{if(action?.scope==='clip')return null;const ids=[...api.selectedIds()];if(ids.length)return api.toggleRegionMute(ids);if(Number.isInteger(state.selectedTrack)&&laneIdOf(state.selectedTrack))return api.toggleTrackMute(state.selectedTrack);return toast('Deactivate: select clips or a track (0).');}),
  'delete-track':safe(()=>{const row=state.selectedTrack;if(!Number.isInteger(row)||!laneIdOf(row))return toast('Delete Track: select a track first (click its header).');const gate=deleteAvailability(row);if(!gate.enabled)return toast(gate.reason);return api.deleteTrack(row);}),
  'blocked-letter':()=>{}
 };
 function realTrackCount(){let count=0;try{while(count<64&&laneIdOf(count))count++;}catch{}return count;}
 function headerButton(row,selector){return Number.isInteger(row)?$(`#track-lanes .track-label[data-track="${row}"] ${selector}`):null;}
 /** Clip / devices modules may take over a command: ablKeys.setHandler('toggle-computer-keyboard', fn). */
 const handlers={...commands};
 disposers.push(installAblKeys(view,{getContext:event=>({view:layout.currentView(),scope:scope(event),typing:view.ablMidiKeyboard?!!view.ablMidiKeyboard.enabled:!!api.typingEnabled?.(),/* the inherited Musical Typing window owns its letters: Live's single-letter keys stand down */legacyTyping:!!api.typingEnabled?.(),dialogOpen:api.dialogOpen?.(event),hasSelection:api.selectedIds().size>0||Number.isInteger(state.selectedTrack),clipSelection:api.selectedIds().size>0,trackSelected:Number.isInteger(state.selectedTrack),trackFocus:!!state.trackFocus,trackClipboard:!!ops?.clipboard,trackCount:realTrackCount()}),handlers}));
 const keysApi={setHandler(command,fn){if(typeof fn==='function')handlers[command]=fn;else handlers[command]=commands[command];},commands:Object.keys(commands)};
 view.ablKeys=keysApi;

 // ── Session View keys (Live): arrow keys select the neighbouring clip, Enter launches the selected clip (a second
 // Enter on the playing clip stops it), ⌘Enter stops. Scenes launch from the Main column (Freestyle #14).
 on(doc,'keydown',event=>{
  if(layout.currentView()!=='session'||event.defaultPrevented||event.altKey||event.isComposing)return;
  const target=event.target;if(target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),dialog,#context-menu,aside.browser,#abl-detail'))return;
  const key=event.key;if(!['Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key))return;
  const slots=$$('#abl-session-grid .abl-slot');if(!slots.length)return;
  // The cursor is the selected clip, or an empty slot reached with the arrow keys (Live highlights empty slots too).
  const selected=slots.find(slot=>slot.classList.contains('abl-cursor'))||slots.find(slot=>slot.classList.contains('selected'))||null;
  if(key==='Enter'){if(event.metaKey||event.ctrlKey){event.preventDefault();safe(()=>api.stopTransport?.())();return;}if(!selected||event.shiftKey)return;event.preventDefault();event.stopPropagation();
   // Live: launching an empty slot stops the track's clip (its Stop button).
   if(selected.classList.contains('filled'))selected.querySelector('.abl-launch')?.click();else safe(()=>api.stopTransport?.())();return;}
  if(event.metaKey||event.ctrlKey||event.shiftKey)return;
  event.preventDefault();event.stopPropagation();
  let next=selected?null:slots.find(slot=>slot.classList.contains('filled'))||slots[0];
  if(selected){const index=neighbourSlotIndex(slots.map(slot=>slot.getBoundingClientRect()),slots.indexOf(selected),key);next=index>=0?slots[index]:null;}
  if(!next)return;
  state.sessionCursor={track:next.dataset.track,scene:next.dataset.scene};
  if(next.classList.contains('filled'))next.dispatchEvent(new (view.PointerEvent||view.MouseEvent||MouseEvent)('pointerdown',{bubbles:true,cancelable:true,button:0}));
  else{try{api.selectRegions([]);}catch{}const row=Number(next.dataset.track);if(Number.isInteger(row))selectTrack(row,{showDevice:false});}
  paintQueuedLaunch();try{next.scrollIntoView?.({block:'nearest',inline:'nearest'});}catch{}
 });
 on($('#abl-session-grid'),'pointerdown',event=>{const slot=event.target?.closest?.('.abl-slot');if(slot){state.sessionCursor={track:slot.dataset.track,scene:slot.dataset.scene};paintQueuedLaunch();/* the Session takes the keys (arrows / Enter) from whichever pane had them */const active=doc.activeElement,session=$('#abl-session');if(session&&active&&active!==doc.body&&!session.contains(active)&&!active.matches?.('input,textarea,select')){try{active.blur?.();if(!session.hasAttribute('tabindex'))session.tabIndex=-1;session.focus({preventScroll:true});}catch{}}}},true);

 // ── Browser (Live sidebar over the inherited library views)
 installBrowser();
 function installBrowser(){
  const aside=$('aside.browser');if(!aside||aside.querySelector('.abl-browser'))return;
  const wrap=doc.createElement('div');wrap.className='abl-browser';
  const side=doc.createElement('nav');side.className='abl-browser-side';side.setAttribute('aria-label','Browser categories');
  const entries=[['Collections'],['favorites-collection','Favorites',null,'Collections are not stored for Freestyle libraries yet.'],['Library'],['sounds','Sounds','favorites'],['drums','Drums','kits'],['instruments','Instruments','plugins']/* listed from the device catalog below (DEVICE_GROUPS) */,['audio-effects','Audio Effects','effects'],['midi-effects','MIDI Effects',null,'Freestyle has no MIDI effect devices.'],['plug-ins','Plug-Ins','plugins'],['clips','Clips','patterns'],['samples','Samples','audio'],['Places'],['user-library','User Library','packs'],['current-project','Current Project','all']];
  side.innerHTML=entries.map(([id,label,tab,reason])=>label===undefined?`<h4>${esc(id)}</h4>`:`<button type="button" data-abl-browser="${id}" ${tab?`data-browser-target="${tab}"`:'disabled'} title="${esc(reason||label)}">${esc(label)}</button>`).join('');
  const content=doc.createElement('div');content.className='abl-browser-content';
  const title=doc.createElement('div');title.className='abl-browser-title';title.id='abl-browser-title';
  const search=aside.querySelector('.browser-search'),tree=$('#browser-tree'),footer=aside.querySelector('.browser-footer');
  if(search){const input=search.querySelector('input');if(input)input.placeholder='Search (⌘F)';content.append(search);}
  content.append(title);if(tree)content.append(tree);if(footer)content.append(footer);
  // Live's Browser Preview switch (headphones): on, selecting a sound previews it (previewCatalogSound, Freestyle #16).
  {const toggle=doc.createElement('button');toggle.type='button';toggle.className='abl-btn abl-icon-btn abl-preview-switch';toggle.innerHTML='<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2 7V6a4 4 0 0 1 8 0v1M2 7h1.6v3H2zM8.4 7H10v3H8.4z" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
   const paint=()=>{let on=true;try{on=view.disabelton?.browserPreview?.()!==false;}catch{}toggle.setAttribute('aria-pressed',String(on));toggle.classList.toggle('on',on);toggle.title=`Preview: ${on?'on':'off'} · selecting a sound ${on?'plays':'does not play'} it`;toggle.setAttribute('aria-label','Preview');};
   toggle.addEventListener('click',()=>{const next=toggle.getAttribute('aria-pressed')!=='true';try{view.disabelton?.setBrowserPreview?.(next);}catch{}paint();});paint();(footer||content).append(toggle);}
  wrap.append(side,content);aside.append(wrap);
  const searchInput=search?.querySelector('input');
  // Breadcrumb / filter-chip row: category › search text (Live's filter view header).
  const paintCrumbs=()=>{const current=side.querySelector('button.selected');const query=String(searchInput?.value||'').trim();title.innerHTML=`<span class="abl-crumb">${esc(current?.textContent||'')}</span>${query?`<span class="abl-crumb" title="Search filter">“${esc(query)}”</span>`:''}`;};
  if(searchInput)searchInput.addEventListener('input',paintCrumbs);
  // QA r7: Audio Effects (native) and Plug-ins (VST3/AU) list the devices' paged Freestyle catalog
  // (window.ablDevices.catalog); the library's own "effects"/"plugins" asset views were empty (0 / 0 assets).
  /* Owner bug 2: Instruments lists the catalog's instruments (Freestyle's are hosted plug-ins, so they also stay under Plug-ins);
     the library's "plugins" asset view it used to open is empty (0 / 0 assets). */
  const DEVICE_GROUPS={instruments:'Instruments','audio-effects':'Audio Effects','plug-ins':'Plug-ins'},DEVICE_MIME='application/x-abl-device';
  const deviceEntries=(source,group,query)=>{const groups=source.groups(query);return group==='Instruments'?groups.flatMap(item=>item.entries).filter(entry=>entry.kind==='instrument').sort((a,b)=>String(a.name).localeCompare(String(b.name))):groups.find(item=>item.group===group)?.entries||[];};
  const deviceList=doc.createElement('div');deviceList.className='abl-browser-list abl-device-list';deviceList.setAttribute('role','listbox');deviceList.hidden=true;/* QA r10: the list sat after the preview footer, which then showed as an empty band above the first device. It goes in the tree's place. */if(footer?.parentNode===content)content.insertBefore(deviceList,footer);else content.append(deviceList);
  let boundCatalog=null,paintedDevices='',retryTimer=null;const paging=new WeakSet();
  const onCatalog=()=>{if(DEVICE_GROUPS[state.browserCategory])paintDevices();};
  const deviceCatalog=()=>{let source=null;try{source=view.ablDevices?.catalog||null;}catch{}if(source!==boundCatalog){boundCatalog?.removeEventListener?.('change',onCatalog);boundCatalog=source;source?.addEventListener?.('change',onCatalog);}return source;};
  disposers.push(()=>{boundCatalog?.removeEventListener?.('change',onCatalog);if(retryTimer!==null)view.clearTimeout?.(retryTimer);});
  const pageAll=source=>{if(paging.has(source)||source.started&&!source.hasMore)return;paging.add(source);(async()=>{try{await source.ensure();while(source.hasMore&&!source.error)await source.more();}catch{}finally{paging.delete(source);}})();};
  function paintDevices(){
   const group=DEVICE_GROUPS[state.browserCategory];if(!group)return;const source=deviceCatalog();let markup;
   if(!source){markup=`<div class="abl-browser-note" role="status">Connect to Freestyle to list ${esc(group)}.</div>`;if(retryTimer===null)retryTimer=view.setTimeout?.(()=>{retryTimer=null;paintDevices();},1000)??null;}
   else{
    pageAll(source);const entries=deviceEntries(source,group,searchInput?.value||'');
    // QA r12: after a reload the first catalog (empty project scope) is replaced once the project opens; its 'change'
    // never fires for the new instance, so the list sat on "Loading…". While loading, re-check the source every second.
    if((source.loading||!source.started)&&retryTimer===null)retryTimer=view.setTimeout?.(()=>{retryTimer=null;paintDevices();},1000)??null;
    const status=source.loading||!source.started?'Loading Freestyle devices…':source.error?source.error:entries.length?'':String(searchInput?.value||'').trim()?`No matching ${group}`:`Freestyle lists no ${group}.`;
    markup=entries.map(entry=>{const why=entry.hostGated?'Not installed on this Freestyle host':`${entry.name}${entry.format?` · ${entry.format.toUpperCase()}`:''} — double-click to add it to the selected track, or drag it onto a track or the Device View`;/* QA r8: Chrome does not reliably start an HTML5 drag from a <button draggable>; rows are divs like the sample rows. */return `<div role="option" tabindex="-1" class="abl-device-row" data-catalog-id="${esc(entry.id)}" data-kind="${esc(entry.kind)}" draggable="${entry.hostGated?'false':'true'}"${entry.hostGated?' aria-disabled="true"':''} title="${esc(why)}">${esc(entry.name)}</div>`;}).join('')+(status?`<div class="abl-browser-note" role="status">${esc(status)}</div>`:'');
   }
   if(markup!==paintedDevices){paintedDevices=markup;deviceList.innerHTML=markup;}
  }
  // The press on a row belongs to the row's native drag: no ancestor (splitter, window, list) may claim it.
  for(const type of ['pointerdown','mousedown'])on(deviceList,type,event=>{if(event.button===0&&event.target?.closest?.('.abl-device-row[draggable="true"]'))event.stopPropagation();});
  on(deviceList,'dragstart',event=>{const row=event.target?.closest?.('.abl-device-row');const entry=row&&boundCatalog?.find?.(row.dataset.catalogId);if(!entry||entry.hostGated||!event.dataTransfer){event.preventDefault?.();return;}
   const item={id:entry.id,type:entry.id,name:entry.name,kind:entry.kind,category:state.browserCategory};try{event.dataTransfer.setData(DEVICE_MIME,JSON.stringify(item));event.dataTransfer.setData('text/plain',entry.name);event.dataTransfer.effectAllowed='copy';}catch{}});
  // Live: double-click (or Enter) loads the device onto the selected track; ↑ / ↓ move the selection.
  const pickRow=row=>{for(const other of deviceList.querySelectorAll('.abl-device-row.selected'))other.classList.remove('selected');row?.classList.add('selected');row?.setAttribute('aria-selected','true');};
  const loadRow=row=>{const entry=row&&boundCatalog?.find?.(row.dataset.catalogId);if(!entry)return;if(entry.hostGated)return toast(`${entry.name} is not installed on this Freestyle host.`);loadDeviceOnTrack(state.selectedTrack,{id:entry.id,type:entry.id,name:entry.name,kind:entry.kind,category:state.browserCategory});};
  on(deviceList,'click',event=>{const row=event.target?.closest?.('.abl-device-row');if(row){pickRow(row);try{row.focus({preventScroll:true});}catch{}}});
  on(deviceList,'dblclick',event=>{const row=event.target?.closest?.('.abl-device-row');if(row){event.preventDefault();pickRow(row);loadRow(row);}});
  on(deviceList,'keydown',event=>{const row=event.target?.closest?.('.abl-device-row');if(!row)return;if(event.key==='Enter'){event.preventDefault();event.stopPropagation();loadRow(row);}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopPropagation();let next=row;do{next=event.key==='ArrowDown'?next.nextElementSibling:next.previousElementSibling;}while(next&&!next.classList.contains('abl-device-row'));if(next){pickRow(next);next.focus();}}});
  if(searchInput)on(searchInput,'input',()=>paintDevices());
  const showDevices=active=>{deviceList.hidden=!active;if(tree)tree.style.display=active?'none':'';};
  const select=(id,{silent=false}={})=>{const button=side.querySelector(`[data-abl-browser="${id}"]`);if(!button||button.disabled)return;for(const other of side.querySelectorAll('button'))other.classList.toggle('selected',other===button);state.browserCategory=id;paintCrumbs();try{globalThis.localStorage?.setItem('disabelton:abl:browser',id);}catch{}if(DEVICE_GROUPS[id]){showDevices(true);paintedDevices='';paintDevices();return;}showDevices(false);const tab=button.dataset.browserTarget;safe(()=>api.openBrowserTab(tab))();};
  for(const button of side.querySelectorAll('button[data-abl-browser]'))button.addEventListener('click',()=>select(button.dataset.ablBrowser));
  let initial='sounds';try{initial=globalThis.localStorage?.getItem('disabelton:abl:browser')||'sounds';}catch{}
  select(side.querySelector(`[data-abl-browser="${initial}"]:not(:disabled)`)?initial:'sounds',{silent:true});
 }

 // Browser device rows (Instruments / Audio Effects / Plug-ins) drag onto tracks and the drop zone.
 const DEVICE_CATEGORIES={instruments:'instrument','audio-effects':'audio-effect','plug-ins':'plugin'};
 const deviceRow=target=>{const kind=DEVICE_CATEGORIES[state.browserCategory];if(!kind)return null;const row=target?.closest?.('aside.browser #browser-tree :is(.browser-item[data-library],[data-plugin-id],.library-asset-row,.library-sound-row)');if(!row||row.closest('.browser-folder'))return null;return{row,kind};};
 const browserTree=()=>$('aside.browser #browser-tree');
 on(doc,'pointerdown',event=>{const found=deviceRow(event.target);if(found&&!found.row.draggable){found.row.draggable=true;found.row.dataset.ablDevice='1';}},true);
 on(doc,'dragstart',event=>{if(!browserTree()?.contains(event.target))return;const found=deviceRow(event.target);if(!found||!event.dataTransfer)return;const row=found.row,id=row.dataset.pluginId||row.dataset.library||row.dataset.librarySoundId||row.dataset.libraryAssetId||'',name=(row.getAttribute('title')||row.textContent||'').trim();if(!id&&!name)return;const item={id,name,type:id||name,kind:found.kind,category:state.browserCategory};try{event.dataTransfer.setData('application/x-abl-device',JSON.stringify(item));event.dataTransfer.setData('text/plain',name);event.dataTransfer.effectAllowed='copy';}catch{}},true);
 /* QA r6: after a Browser drag the dragged row kept keyboard focus. Live hands focus back to the Arrangement once a
    drag ends (dropped or cancelled), so letter keys (A, Z, B…) reach the arrangement; text fields are never robbed. */
 const returnFocus=()=>{const active=doc.activeElement,aside=$('aside.browser');if(!active||!aside?.contains(active)||active.matches?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;const target=layout.currentView?.()==='session'?$('#abl-session'):$('#playlist');try{active.blur?.();target?.focus?.({preventScroll:true});}catch{}};
 on(doc,'dragend',event=>{if($('aside.browser')?.contains(event.target))returnFocus();},true);
 on(doc,'drop',()=>queueMicrotask(returnFocus),true);
 // Device drops (Browser instruments / effects) onto a track: the devices lane loads them.
 on($('#track-lanes'),'dragover',event=>{if([...(event.dataTransfer?.types||[])].includes('application/x-abl-device')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
 on($('#track-lanes'),'drop',event=>{
  const raw=event.dataTransfer?.getData?.('application/x-abl-device');if(!raw)return;event.preventDefault();event.stopPropagation();
  let item=null;try{item=JSON.parse(raw);}catch{return toast('That device could not be read.');}
  const lane=event.target?.closest?.('.track-lane'),row=Number(lane?.querySelector('.track-label[data-track]')?.dataset.track),laneId=Number.isInteger(row)?laneIdOf(row):null;
  // QA r10: Live selects the track a device is dropped on (header or lane) and shows its Device View, so the
  // placeholder and the confirmed device appear on that track — not on the previously selected one.
  if(laneId)selectTrack(row);
  loadDeviceOnTrack(row,item,{select:false});
 });
 /** Browser device → track (drop, double-click or Enter): the devices lane loads it; the Device View shows that track. */
 function loadDeviceOnTrack(row,item,{select=true}={}){
  const laneId=Number.isInteger(row)?laneIdOf(row):null;if(select&&laneId)selectTrack(row);
  const accepted=!doc.dispatchEvent(new (view.CustomEvent||CustomEvent)('abl:device-drop',{cancelable:true,detail:{track:Number.isInteger(row)?row:null,laneId,item}}));
  if(!accepted)toast(!view.ablDevices?.addPlugin?'Devices are still loading: add the device again in a moment.':laneId?`${item?.name||'This device'} cannot be added to this track.`:'Select a track first (Freestyle creates tracks from Create ▸ Insert MIDI Track / Insert Audio Track).');
  return accepted;
 }

 paintPosition();decorateArrangement();
 return{state,layout,commands,trackOps:ops,mainActivator:api.mainActivator||null,openColorPicker,closeColorPicker,openSaveVersion,splitSelectedTrack,handlers,insertMarker:()=>api.insertMarkerBeat?.()??null,selectTrack,openClip,clipMenu,trackMenu,trackMenuItems,emptyLaneMenu,renderSession:renderSessionNow,openHelp,setGrid,
  destroy(){for(const dispose of disposers.splice(0))try{dispose();}catch{}}};
}
