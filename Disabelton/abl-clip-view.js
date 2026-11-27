/** Disabelton — Detail View ▸ Clip View (Live 12 look).
 *
 * The note editor is the fork's proven Piano Roll (#piano) and Step Sequencer (#rack):
 * this module re-hosts those sections inside the Clip View and adds Live's Clip /
 * Notes / Sample panels, header (Fold, Scale, grid), keys and gestures. Every score
 * change goes through the callbacks app.js passes in (its edit()/history path), so
 * each gesture stays ONE undo step in the global history. Nothing here talks to the
 * engine directly.
 *
 * Mount: #abl-detail-clip (shell). Until the shell creates it, a temporary host is
 * docked where the Logic editors pane was; the view moves into #abl-detail-clip as
 * soon as it exists (checked on install, on every open and on `abl:layout-ready`).
 *
 * Shared events (documented in docs/DISABELTON_PLAN.md ▸ Clip View contract):
 *  window 'abl:pad-select' {channelId, source}  — Drum Rack pad ⇄ Fold row selection
 *  window 'abl:draw-mode'  {on, source}         — Live draw mode (B) shared with the shell
 *  document 'abl:clip-open' {clipId, patternId, laneId, kind} — shell double-click (we preventDefault when shown)
 *  ablLayout.onChange — ⇧Tab / showDetail('clip') with nothing shown opens the selected pattern
 *  window 'abl:layout-ready'                    — re-check the #abl-detail-clip mount
 *  window.ablClipView = {open(), openAudio(clip), close(), kind, focused(), setGrid(id), setDrawMode(on), command(intent)}
 *  window.ablMidiKeyboard — see abl-midi-keyboard.js
 */
import {editorForPattern} from './logic-editors.js';
import {PIANO_KEY_WIDTH,PIANO_RULER_HEIGHT,PIANO_PITCH_COUNT,PIANO_VELOCITY_RANGE} from './piano-geometry.js';
import {liveNoteName,livePosition,liveLength,parseLiveBeats,LIVE_GRIDS,liveGrid,stepLiveGrid,toggleLiveTriplet,LIVE_SCALES,LIVE_NOTE_NAMES,scalePitchClasses,LIVE_NOTE_TRANSFORMS,joinNotes,stepVelocity,randomizeVelocity,rampVelocity,invertSelection,stretchNotesToMarker,rulerMarkerChange,adaptiveLiveGridId,miniNoteLayout,addIntervalNotes,sameNotes} from './abl-clip-model.js';
import {placementLoop,applyPlacementLoop,PLACEMENT_LOOP_REASONS,midiTakeNotes} from './abl-clip-model.js';
import {AblMidiKeyboard} from './abl-midi-keyboard.js';
import {createClipGainGesture} from './studio-api-engine-helpers.js';
import {ablLayout as sharedLayout} from './abl-layout.js';
import {ablTrackColor} from './abl-session.js';
import {ablPadNote,ABL_PAD_FIRST_NOTE} from './abl-dev-drumrack.js';
import {createDrumNoteEditor,unfoldRows} from './abl-drum-notes.js';
import {DEFAULT_STEP_VELOCITY} from './rack-graph-editor.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const textTarget=target=>!!target?.closest?.('input,select,textarea,[contenteditable=""],[contenteditable=true]');
const STYLE_ID='abl-clip-style';
/** Live's note-edge resize hot zones (px), per side: max(3, min(6, 30 % of the note)), keeping a middle move zone of at
 * least 4 px. A note narrower than 10 px resizes from its right edge only (≤ 40 % of it); its left part moves it.
 * QA r7: the old 4 px / ¼ zone left ~3 px on a 1/16 note at default zoom, inside the note's 1 px border, so every
 * edge grab moved. The zones are measured from the note's outer edges (border included); see routeNoteEdge.
 * Mirrored (approximately, for the cursor) in abl-clip.css. */
export const NOTE_EDGE_MIN_PX=3,NOTE_EDGE_MAX_PX=6,NOTE_EDGE_SHARE=.3,NOTE_MOVE_MIN_PX=4,NOTE_NARROW_PX=10;
export function noteEdgeZones(width){
 if(!(width>0))return{left:0,right:0};
 const edge=Math.max(NOTE_EDGE_MIN_PX,Math.min(NOTE_EDGE_MAX_PX,width*NOTE_EDGE_SHARE));
 if(width<NOTE_NARROW_PX)return{left:0,right:Math.min(edge,width*.4)};
 const zone=Math.min(edge,(width-NOTE_MOVE_MIN_PX)/2);return{left:zone,right:zone};
}
export const noteEdgeZone=width=>noteEdgeZones(width).right;
const INHERITED_HANDLE_PX=6;// style.css .piano-note .note-resize width
/** Window capture listeners registered when this module is imported — i.e. before app.js installs the
 * shell's and the inherited key maps — so the Clip View (when focused) and the computer MIDI keyboard
 * (when on) see their keys first. Unhandled keys continue to the shell (abl-keys.js) unchanged. */
const earlyKeys={keydown:new Set(),keyup:new Set()};
if(typeof globalThis.window?.addEventListener==='function')for(const type of ['keydown','keyup'])globalThis.window.addEventListener(type,event=>{for(const fn of earlyKeys[type]){try{fn(event);}catch{}if(event.defaultPrevented&&type==='keydown')break;}},true);
export const CLIP_VIEW_UNAVAILABLE=Object.freeze({
 colour:'Clip colour follows the track colour; Freestyle has no per-clip colour.',
 start:'Open the clip from the Arrangement to set where this placement starts playing (a Session clip is the pattern itself).',
 loop:'Open the clip from the Arrangement to change its loop: a Session clip is the pattern itself and always loops.',
 position:'Open the clip from the Arrangement to move its loop: a Session clip is the pattern itself.',
 signature:'Clip signatures follow the project time signature in Freestyle.',
 groove:'Grooves are not available in Freestyle.',
 fold:'Fold for melodic clips is not available yet; Drum Rack clips open folded.',
 envelopes:'Clip envelopes are not available in Freestyle (it stores no per-clip MIDI or device envelopes; an audio clip’s gain envelope is its fade). Use automation mode (A) in the Arrangement.',
 scaleMode:'Scale-aware note editing is not available in Freestyle; use Highlight Scale and Fit to Scale.',
 mpe:'MPE is not available in Freestyle.',
 transpose:'Freestyle has no audio clip transpose (pitch shift) edit.',
 warp:'Freestyle has no warp engine; audio plays at its recorded tempo.',
 audioLoop:'Audio clip looping is not available in Freestyle.',
 stepNotes:'This is a step clip: edit its steps in the grid. Note functions apply to MIDI clips.',
});

/** Smallest note row the fit zooms to (px). Below it the range is centred with its top note kept. */
export const FIT_MIN_ROW=8;
/** Live shows a clip's whole note range when it opens: centre the range in the visible rows; when it is taller
 * than the editor at the user's row height, zoom rows down (never up, never below FIT_MIN_ROW) so the lowest AND
 * highest notes are both in view; if even that cannot fit, centre with the TOP note fully visible.
 * Returns {top (scrollTop px), rowHeight}. An empty clip centres on C3 (60). */
export function fitNoteRange(pitches,{visible,rowHeight}){
 const valid=(pitches||[]).filter(pitch=>Number.isInteger(pitch)&&pitch>=0&&pitch<=127),low=valid.length?Math.min(...valid):60,high=valid.length?Math.max(...valid):60,span=high-low+1;
 let row=rowHeight;if(span*row>visible)row=Math.max(Math.min(FIT_MIN_ROW,rowHeight),Math.floor(visible/span));
 const mid=(low+high)/2,centred=(127-mid)*row+row/2-visible/2,top=span*row<=visible?centred:Math.min(centred,(127-high)*row);
 return{top:Math.max(0,Math.round(top)),rowHeight:row};
}

function clipMarkup(){
 const scaleRoots=LIVE_NOTE_NAMES.map(name=>`<option>${name}</option>`).join(''),scales=LIVE_SCALES.map(item=>`<option>${item.label}</option>`).join('');
 const grids=LIVE_GRIDS.map(grid=>`<option value="${grid.id}">${grid.label}</option>`).join('');
 return `<div class="abl-clip-panels">
 <nav class="abl-clip-tabs" aria-label="Clip View panels"><button type="button" data-panel="clip" aria-pressed="true" title="Show/hide the Clip panel">Clip</button><button type="button" class="abl-midi-only" data-panel="notes" aria-pressed="true" title="Show/hide the Notes panel">Notes</button><button type="button" class="abl-audio-only" data-panel="sample" aria-pressed="true" title="Show/hide the Sample panel">Sample</button></nav>
 <section class="abl-clip-panel abl-clip-clip" aria-label="Clip">
  <header class="abl-clip-title"><button type="button" class="abl-clip-swatch" disabled title="${esc(CLIP_VIEW_UNAVAILABLE.colour)}" aria-label="Clip colour"></button><input class="abl-clip-name" aria-label="Clip name" spellcheck="false"></header>
  <div class="abl-clip-fields">
   <label class="abl-f"><span>Start <button type="button" class="abl-set" disabled>Set</button></span><input class="abl-box" data-field="start" aria-label="Clip start"></label>
   <label class="abl-f"><span>End <button type="button" class="abl-set" disabled>Set</button></span><input class="abl-box" data-field="end" aria-label="Clip end"></label>
   <button type="button" class="abl-toggle abl-loop" data-field="loop" aria-pressed="true" disabled title="${esc(CLIP_VIEW_UNAVAILABLE.loop)}">⟲ Loop</button><button type="button" class="abl-toggle abl-extend abl-not-audio" data-action="extend" disabled title="Extend: double this Arrangement clip’s length (loop repeats)">Extend ×2</button>
   <label class="abl-f"><span>Position <button type="button" class="abl-set" disabled>Set</button></span><input class="abl-box" data-field="position" aria-label="Loop position"></label>
   <label class="abl-f"><span>Length <button type="button" class="abl-set" disabled>Set</button></span><input class="abl-box" data-field="length" aria-label="Clip length"></label>
   <label class="abl-f abl-not-audio"><span>Arr. Pos</span><input class="abl-box" data-field="arr-position" aria-label="Arrangement position" disabled></label>
   <label class="abl-f abl-f-sig"><span>Signature</span><span class="abl-sig"><input class="abl-box" data-field="sig-num" value="4" disabled title="${esc(CLIP_VIEW_UNAVAILABLE.signature)}" aria-label="Signature numerator"><input class="abl-box" data-field="sig-den" value="4" disabled title="${esc(CLIP_VIEW_UNAVAILABLE.signature)}" aria-label="Signature denominator"></span></label>
   <label class="abl-f abl-f-groove"><span>Groove</span><select class="abl-box" data-field="groove" disabled title="${esc(CLIP_VIEW_UNAVAILABLE.groove)}"><option>None</option></select></label>
   <label class="abl-f abl-f-scale abl-midi-only"><span>Scale</span><span class="abl-scale"><select class="abl-box" data-field="scale-root" aria-label="Scale root">${scaleRoots}</select><select class="abl-box" data-field="scale-name" aria-label="Scale name">${scales}</select></span></label>
  </div>
 </section>
 <section class="abl-clip-panel abl-clip-notes abl-midi-only" aria-label="Notes">
  <div class="abl-notes-grid">
   <output class="abl-notes-pitch" title="Lowest selected note">—</output>
   <button type="button" data-op="fitToScale" title="Move the selected notes to the clip scale">Fit to Scale</button>
   <button type="button" data-op="invert" title="Invert the selected notes (highest and lowest swap)">Invert</button>
   <label class="abl-num" title="Transpose the selected notes (semitones)"><input type="number" class="abl-box" data-field="transpose" value="0" min="-48" max="48" step="1" aria-label="Transpose"><span>st</span></label>
   <span class="abl-pair"><label class="abl-num" title="Interval for Add Interval (semitones)"><input type="number" class="abl-box" data-field="interval" value="12" min="-48" max="48" step="1" aria-label="Interval"><span>st</span></label><button type="button" data-op="addInterval" title="Add a copy of the selected notes at the interval">Add Interval</button></span>
   <span class="abl-pair"><button type="button" data-op="double" title="Double the length and spacing of the selected notes">×2</button><button type="button" data-op="half" title="Halve the length and spacing of the selected notes">÷2</button></span>
   <span class="abl-pair"><select class="abl-box" data-field="length-grid" aria-label="Set Length value">${grids}</select><button type="button" data-op="setLength" title="Set every selected note to this length">Set Length</button></span>
   <span class="abl-pair"><label class="abl-num" title="Humanize amount (% of the grid)"><input type="number" class="abl-box" data-field="humanize" value="10" min="0" max="100" step="1" aria-label="Humanize amount"><span>%</span></label><button type="button" data-op="humanize" title="Randomize the start times of the selected notes">Humanize</button></span>
   <span class="abl-pair"><label class="abl-num" title="Velocity randomization range (± MIDI steps)"><input type="number" class="abl-box" data-field="vel-range" value="20" min="0" max="127" step="1" aria-label="Velocity randomization range"><span>±</span></label><button type="button" data-op="randomizeVelocity" title="Randomize the velocities of the selected notes within the range (Live: Velocity ▸ Randomize)">Rand. Vel</button></span>
   <span class="abl-pair"><label class="abl-num" title="Velocity ramp: first / last velocity of the selected notes, in time order"><input type="number" class="abl-box" data-field="ramp-start" value="40" min="1" max="127" step="1" aria-label="Ramp start velocity"><span>→</span><input type="number" class="abl-box" data-field="ramp-end" value="120" min="1" max="127" step="1" aria-label="Ramp end velocity"></label><button type="button" data-op="rampVelocity" title="Ramp the velocities of the selected notes from the first value to the second (Live: Velocity ▸ Ramp)">Ramp</button></span>
   <span class="abl-pair"><button type="button" data-op="reverse" title="Reverse the order of the selected notes">Reverse</button><button type="button" data-op="legato" title="Extend each note to the next one">Legato</button></span>
   <button type="button" data-op="quantize" class="abl-wide" title="Quantize the selected note starts to the grid (⌘U)">Quantize</button>
  </div>
 </section>
 <section class="abl-clip-panel abl-clip-sample abl-audio-only" aria-label="Sample">
  <div class="abl-sample-grid">
   <label class="abl-f"><span>Gain</span><span class="abl-gain"><input class="abl-box" data-field="gain" aria-label="Clip gain (dB)"><span class="abl-gain-drag" role="slider" tabindex="-1" aria-label="Drag clip gain" title="Drag up/down: clip gain (previewed live, saved on release)">↕</span></span></label>
   <label class="abl-f"><span>Transpose</span><input class="abl-box" value="0 st" disabled title="${esc(CLIP_VIEW_UNAVAILABLE.transpose)}" aria-label="Transpose"></label>
   <button type="button" class="abl-toggle" disabled aria-pressed="false" title="${esc(CLIP_VIEW_UNAVAILABLE.warp)}">Warp</button>
   <output class="abl-sample-info"></output>
  </div>
 </section>
</div>
<div class="abl-clip-editor">
 <div class="abl-clip-editor-bar" data-no-drag>
  <button type="button" class="abl-toggle" data-action="fold" aria-pressed="false">Fold</button>
  <button type="button" class="abl-toggle abl-midi-only" data-action="scale-mode" aria-pressed="false" title="Scale: fold the note editor to the key tracks of the clip scale (set in the Clip panel)">Scale</button>
  <button type="button" class="abl-check abl-midi-only" data-action="scale" aria-pressed="false" title="Highlight the clip scale in the note editor"><span class="abl-checkbox" aria-hidden="true"></span>Highlight Scale</button>
  <span class="abl-pager abl-drum-only"><button type="button" data-action="page-prev" aria-label="Previous bar">◀</button><output class="abl-page"></output><button type="button" data-action="page-next" aria-label="Next bar">▶</button></span>
  <span class="abl-spacer"></span>
  <span class="abl-tabs abl-not-audio" role="tablist"><button type="button" role="tab" aria-selected="true" class="selected" data-tab="notes">Notes</button><button type="button" role="tab" aria-selected="false" data-tab="envelopes" disabled title="${esc(CLIP_VIEW_UNAVAILABLE.envelopes)}">Envelopes</button><button type="button" role="tab" aria-selected="false" data-tab="mpe" disabled title="${esc(CLIP_VIEW_UNAVAILABLE.mpe)}">MPE</button></span>
  <button type="button" class="abl-toggle abl-midi-only abl-lane-chance" disabled title="Chance lane: Freestyle notes carry no probability value, so there is nothing to edit here. The Velocity lane is below the notes.">Chance</button>
  <button type="button" class="abl-toggle abl-midi-only abl-preview lit" data-action="preview" aria-pressed="true" title="Preview: notes sound when you add, select or move them" aria-label="Preview"><svg viewBox="0 0 14 12" width="14" height="12" aria-hidden="true"><path d="M2 8V6a5 5 0 0 1 10 0v2" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="1" y="7" width="3" height="4" fill="currentColor"/><rect x="10" y="7" width="3" height="4" fill="currentColor"/></svg></button>
  <button type="button" class="abl-toggle abl-midi-only abl-midi-rec" data-action="midi-rec" aria-pressed="false" title="MIDI Record: while the transport plays, notes from the computer MIDI keyboard (M) are written into this clip at the playhead (one undo step per take, snapped to the grid when Snap is on)">● Rec</button>
  <button type="button" class="abl-toggle abl-not-audio" data-action="draw" aria-pressed="false" title="Draw Mode (B)">✎</button>
  <button type="button" class="abl-toggle abl-not-audio" data-action="snap" aria-pressed="true" title="Snap to Grid (⌘4)">Snap</button>
  <select class="abl-grid abl-not-audio" data-field="grid" aria-label="Grid" title="Grid: ⌘1 narrower · ⌘2 wider · ⌘3 triplet">${grids}</select>
 </div>
 <div class="abl-clip-editor-host"></div>
 <div class="abl-fold-velocity abl-drum-only" aria-label="Velocity" title="Drag a stem up/down: that step’s velocity (one edit on release; Esc cancels)"><span class="abl-fold-vel-scale" aria-hidden="true"><span>127</span><span>1</span></span><div class="abl-fold-vel-plot"></div></div>
 <div class="abl-sample-view abl-audio-only"><div class="abl-sample-wave" aria-label="Sample waveform"></div><div class="abl-sample-markers"><span class="abl-sample-marker" data-marker="start" role="slider" tabindex="-1" aria-label="Sample start marker" title="Drag: sample start (trims the clip head)" style="left:0%"></span><span class="abl-sample-marker" data-marker="end" role="slider" tabindex="-1" aria-label="Sample end marker" title="Drag: sample end (trims the clip tail)" style="left:100%"></span></div></div>
 <p class="abl-clip-empty">Drop Files and Devices Here</p>
</div>`;
}

export function installAblClipView(api){
 const doc=api.document||globalThis.document,win=api.window||globalThis.window,$=selector=>doc.querySelector(selector);
 if(!doc.getElementById(STYLE_ID)&&doc.head){const link=doc.createElement('link');link.id=STYLE_ID;link.rel='stylesheet';link.href='abl-clip.css';doc.head.append(link);}
 const layout=()=>win.ablLayout||sharedLayout;
 const root=doc.createElement('section');root.id='abl-clip-view';root.className='abl-clip-view';root.setAttribute('aria-label','Clip View');root.hidden=true;root.dataset.kind='none';root.innerHTML=clipMarkup();
 const host=root.querySelector('.abl-clip-editor-host'),field=name=>root.querySelector(`[data-field="${name}"]`),action=name=>root.querySelector(`[data-action="${name}"]`);
 const state={kind:'none',audioClipId:null,grid:'1/16',snap:true,scaleOn:false,scaleRoot:'C',scale:'Major',drawMode:false,focused:false,opening:false,disposed:false};
 field('grid').value=state.grid;field('length-grid').value=state.grid;

 // ---- mount ----
 let tempHost=null;
 function mount(){
  const target=doc.getElementById('abl-detail-clip');
  if(target){if(root.parentElement!==target)target.append(root);if(tempHost){tempHost.remove();tempHost=null;}root.classList.remove('abl-clip-temp');return true;}
  if(!root.isConnected){tempHost=doc.createElement('div');tempHost.id='abl-clip-temp-host';tempHost.className='abl-clip-temp-host';const anchor=$('#piano')||$('#rack');(anchor?.parentElement||doc.body).append(tempHost);tempHost.append(root);root.classList.add('abl-clip-temp');}
  return false;
 }
 mount();
 for(const id of ['rack','piano']){const pane=doc.getElementById(id);if(pane){host.append(pane);pane.classList.add('abl-clip-hosted');}}
 doc.getElementById('piano')?.classList.remove('hide-velocity');
 // Fold off on a Drum Rack clip (Live): the note editor with every pad's hits on its pad-note row (abl-drum-notes.js).
 // Its writes are the rack step paths in app.js (one edit per gesture), never the per-channel piano roll.
 const drumNotes=createDrumNoteEditor({doc,win,
  api:{rows:ids=>api.drumStepRows?.(ids)||[],commitStroke:(result,rows,label)=>api.commitDrumStroke(result,rows,label),writeSteps:(next,options)=>api.writeDrumSteps(next,options),
   refusal:()=>api.drumStepRefusal?.()||null,drawMode:()=>state.drawMode,toast:text=>api.toast?.(text),fail:error=>api.fail?.(error)},
  onSelectPad:(id,{audition=false}={})=>{if(api.channel()?.id!==id)api.selectChannel(id);if(audition)auditionPad(id);win.dispatchEvent(new win.CustomEvent('abl:pad-select',{detail:{channelId:id,source:'clip'}}));},
  onChange:()=>queueSync()});
 host.append(drumNotes.el);
 function setUnfold(on){state.unfold=!!on;if(!state.unfold)drumNotes.cancel();sync();}

 // ---- current clip ----
 const project=()=>api.project();
 const audioClip=()=>state.audioClipId?api.findClip(state.audioClipId):null;
 const editorShown=kind=>{const pane=doc.getElementById(kind==='step'?'rack':'piano');return !!pane&&!pane.classList.contains('hidden');};
 // adopt: an editor shown by an inherited path is adopted without touching snap (setSnap cancels a live gesture).
 // Centring belongs to a clip being OPENED or switched. An editor adopted from an inherited path (its window, a
 // restored layout, a key that revealed it) keeps whatever scroll the app gave it.
 function setKind(kind,{adopt=false}={}){if(adopt&&kind==='midi'){state.centred=clipKey();state.pending=null;state.fitKey=null;}if(kind==='none')state.fitKey=null;state.kind=kind;root.dataset.kind=kind;root.hidden=kind==='none';if(kind!=='audio')state.audioClipId=null;if(!adopt&&(kind==='midi'||kind==='drum'))ensureGrid();sync();}
 function showLayout(){if(state.opening)return;state.opening=true;try{mount();layout()?.showDetail?.('clip');}finally{state.opening=false;}}
 /** Show the selected pattern: Drum Rack (step) clips open folded, MIDI clips in the piano editor. */
 function open({fold}={}){
  const p=api.pattern();if(!p){setKind('none');return false;}
  const step=fold??editorForPattern(p)==='step',editor=step?'step':'piano';
  if(!editorShown(editor))api.openEditor(editor);
  state.patternId=p.id;setKind(step?'drum':'midi');showLayout();return true;
 }
 // The clip on display (its pattern, and the Arrangement/Session clip it was opened from) can disappear with any
 // project change — ⌘Z of the gesture that created it, a delete, a reload. Live then clears the Clip View. Checked
 // on every sync. The shown pattern follows the selection while it exists; a clip of another pattern is forgotten.
 const patternExists=id=>(project()?.patterns||[]).some(item=>item.id===id||item.cloudId!=null&&item.cloudId===id);
 function shownClipGone(){
  if(state.kind!=='midi'&&state.kind!=='drum')return false;
  const p=api.pattern();
  if(state.patternId!=null&&!patternExists(state.patternId))return true;
  if(!p)return true;state.patternId=p.id;
  if(state.clipId!=null){const clip=api.findClip(state.clipId);if(!clip)return true;if(clip.patternId&&clip.patternId!==p.id)state.clipId=null;}
  return false;
 }
 function clearGoneClip(){state.patternId=null;state.clipId=null;state.centred=null;state.pending=null;if(editorShown('piano')||editorShown('step'))api.closeEditor?.();setKind('none');
  // The Detail View then shows the selected track's devices, as Live does with no clip to show.
  try{const shown=layout();if(shown?.detailVisible?.()&&shown.detailKind?.()==='clip')shown.showDetail?.('device');}catch{}
 }
 function openAudio(clip){
  if(!clip||clip.patternId)return false;state.audioClipId=clip.id;
  if(editorShown('piano')||editorShown('step'))api.closeEditor?.();
  setKind('audio');showLayout();api.loadGain?.(clip);loadWaveform(clip);return true;
 }
 function close(){setKind('none');}

 // ---- grid / snap / draw ----
 function applyGrid(){const grid=liveGrid(state.grid);field('grid').value=grid.id;api.setSnap(state.snap?grid.snap:'none');api.setNoteLength?.(grid.beats);root.style.setProperty('--abl-grid-beats',String(grid.beats));action('snap').setAttribute('aria-pressed',String(state.snap));action('snap').classList.toggle('lit',state.snap);}
 function setGrid(id){state.grid=liveGrid(id).id;gridApplied=true;applyGrid();api.toast?.(`Grid ${liveGrid(state.grid).label}${state.snap?'':' (snap off)'}`);}
 function setDrawMode(on,{silent=false}={}){state.drawMode=!!on;api.setTool(state.drawMode?'paint':'select');const button=action('draw');button.setAttribute('aria-pressed',String(state.drawMode));button.classList.toggle('lit',state.drawMode);root.classList.toggle('abl-draw-mode',state.drawMode);if(!silent)win.dispatchEvent(new win.CustomEvent('abl:draw-mode',{detail:{on:state.drawMode,source:'clip'}}));}
 // The Live grid takes over the inherited piano snap / pencil length when the Clip View first shows a clip.
 let gridApplied=false;const ensureGrid=()=>{if(gridApplied)return;gridApplied=true;applyGrid();};

 // ---- note transforms (one edit each, through app.js) ----
 const gridBeats=()=>liveGrid(state.grid).beats;
 // ---- Round 3: note editor view keys, neighbour selection, grid mode, ruler markers ----
 const clipNotes=()=>{const p=api.pattern(),c=api.channel();return p&&c?(p.notes?.[c.id]||[]):[];};
 let zoomBack=null;
 function zoomEditorTo(startBeat,endBeat){
  const scroller=doc.getElementById('piano-scroll');if(!scroller||!(endBeat>startBeat))return false;const keys=doc.getElementById('piano-keys'),inset=keys?.offsetWidth||0,width=Math.max(60,scroller.clientWidth-inset-12),geometry=api.pianoGeometry(),target=width/((endBeat-startBeat)/4);
  markUserView();api.zoomNotes(target/geometry.barWidth);
  const apply=()=>{scroller.scrollLeft=Math.max(0,startBeat/4*api.pianoGeometry().barWidth-4);};apply();win.requestAnimationFrame?.(()=>{apply();win.requestAnimationFrame?.(apply);});return true;
 }
 function editorZoomKey(letter){
  const scroller=doc.getElementById('piano-scroll'),p=api.pattern();if(!scroller||!p)return;
  if(letter==='w'){zoomBack=null;zoomEditorTo(0,Math.max(1,api.patternBeats(p)));return;}
  if(letter==='h'){centreNotes({force:true});return;}
  if(letter==='z'){const ids=new Set(api.selectedNoteIds()),notes=clipNotes().filter(note=>ids.has(note.id));if(!notes.length){api.toast?.('Zoom to selection: select notes first (X zooms back).');return;}
   if(!zoomBack)zoomBack={barWidth:api.pianoGeometry().barWidth,scrollLeft:scroller.scrollLeft};const start=Math.min(...notes.map(note=>note.start)),end=Math.max(...notes.map(note=>note.start+note.duration)),pad=Math.max(.125,(end-start)*.05);zoomEditorTo(Math.max(0,start-pad),end+pad);return;}
  if(letter==='x'){if(!zoomBack){zoomEditorTo(0,Math.max(1,api.patternBeats(p)));return;}const back=zoomBack;zoomBack=null;markUserView();api.zoomNotes(back.barWidth/api.pianoGeometry().barWidth);const apply=()=>{scroller.scrollLeft=back.scrollLeft;};apply();win.requestAnimationFrame?.(()=>{apply();win.requestAnimationFrame?.(apply);});}
 }
 function selectNeighbourNote(key){
  const notes=clipNotes().slice().sort((a,b)=>a.start-b.start||a.pitch-b.pitch);if(!notes.length)return;const ids=api.selectedNoteIds(),current=notes.find(note=>note.id===ids[ids.length-1])||notes.find(note=>ids.includes(note.id))||null;let next=null;
  if(!current)next=notes[0];
  else if(key==='ArrowUp'||key==='ArrowDown'){const at=notes.indexOf(current);next=notes[at+(key==='ArrowUp'?1:-1)]||null;}
  else{const same=notes.filter(note=>note.pitch===current.pitch),at=same.indexOf(current);next=same[at+(key==='ArrowRight'?1:-1)]||null;}
  if(!next)return;api.selectNotes([next.id]);auditionSelection();paintRulerMarkers();
 }
 // Grid mode: Fixed (the chosen value) or Zoom-Adaptive (the value follows the zoom; density Widest…Narrowest).
 const ADAPTIVE=[['Widest',-2],['Wide',-1],['Medium',0],['Narrow',1],['Narrowest',2]];
 function adaptiveGridId(){return adaptiveLiveGridId(api.pianoGeometry().barWidth,state.adaptiveDensity||0);}
 function applyAdaptiveGrid(){if(state.gridMode!=='adaptive'||state.kind!=='midi')return;const id=adaptiveGridId();if(id!==state.grid){state.grid=id;gridApplied=true;applyGrid();}}
 function setGridMode(mode,{density}={}){state.gridMode=mode==='adaptive'?'adaptive':'fixed';if(density!==undefined)state.adaptiveDensity=density;if(state.gridMode==='adaptive'){applyAdaptiveGrid();if(!adaptiveTimer)adaptiveTimer=win.setInterval(applyAdaptiveGrid,250);}else if(adaptiveTimer){win.clearInterval(adaptiveTimer);adaptiveTimer=null;}api.toast?.(state.gridMode==='adaptive'?`Adaptive Grid: ${ADAPTIVE.find(item=>item[1]===(state.adaptiveDensity||0))?.[0]||'Medium'}`:`Fixed Grid: ${liveGrid(state.grid).label}`);}
 let adaptiveTimer=null;
 function gridMenu(event){
  if(!api.menu)return;event.preventDefault();event.stopPropagation();const adaptive=state.gridMode==='adaptive',triplet=!!liveGrid(state.grid).triplet;
  api.menu(event,[{label:'Adaptive Grid',submenu:ADAPTIVE.map(([label,density])=>({label,checked:adaptive&&(state.adaptiveDensity||0)===density,run:()=>setGridMode('adaptive',{density})}))},{label:'Fixed Grid',submenu:LIVE_GRIDS.filter(grid=>!grid.triplet).map(grid=>({label:grid.label,checked:!adaptive&&grid.id===state.grid,run:()=>{setGridMode('fixed');setGrid(grid.id);}}))},null,{label:'Off',shortcut:'⌘4',checked:!state.snap,run:()=>{state.snap=!state.snap;gridApplied=true;applyGrid();}},{label:'Triplet Grid',shortcut:'⌘3',checked:triplet,run:()=>setGrid(toggleLiveTriplet(state.grid))},null,{label:'Narrow Grid',shortcut:'⌘1',run:()=>setGrid(stepLiveGrid(state.grid,-1))},{label:'Widen Grid',shortcut:'⌘2',run:()=>setGrid(stepLiveGrid(state.grid,1))},{label:adaptive?'Fixed Grid':'Zoom-Adaptive Grid',shortcut:'⌘5',run:()=>setGridMode(adaptive?'fixed':'adaptive')}]);
 }
 // Ruler markers (Live): clip start / end markers and the loop brace in the editor's time ruler, tied to the Clip
 // panel's Start / End / Position / Length fields (the same placement write, one undo step each); note stretch
 // markers under them while two or more notes are selected (drag = stretch the selection in time, one edit).
 let rulerLayer=null,rulerDrag=null,rulerBound=false;
 function rulerState(){const clip=placementClip(),p=api.pattern();if(!clip||!p||state.kind!=='midi')return null;try{return{clip,p,loop:placementLoop(clip,loopOptions(p))};}catch{return null;}}
 function paintRulerMarkers(){
  const ruler=doc.getElementById('piano-ruler');if(!ruler){rulerLayer?.remove();rulerLayer=null;return;}
  if(rulerDrag)return;
  if(!rulerLayer||rulerLayer.parentElement!==ruler){rulerLayer?.remove();rulerLayer=doc.createElement('div');rulerLayer.className='abl-ruler-markers';ruler.append(rulerLayer);bindRulerMarkers(rulerLayer);}
  const info=rulerState(),ids=new Set(api.selectedNoteIds()),picked=state.kind==='midi'?clipNotes().filter(note=>ids.has(note.id)):[];
  const x=beats=>`calc(${(beats/4).toFixed(6)} * var(--bar))`,parts=[];
  if(info){const {loop}=info,editable=loop.loopEditable!==false;
   parts.push(`<div class="abl-loop-brace${loop.looped?'':' off'}" data-marker="brace" style="left:${x(loop.loopStart)};width:${x(loop.loopLength)}" title="Loop brace: drag to move the loop (Position); drag an end to change Position / Length${editable?'':' — '+PLACEMENT_LOOP_REASONS.phaseSet}"><i data-marker="loop-start"></i><i data-marker="loop-end"></i></div>`);
   parts.push(`<div class="abl-clip-marker start" data-marker="start" style="left:${x(loop.start)}" title="Start marker: drag to set where the clip starts playing (Start)"></div>`);
   parts.push(`<div class="abl-clip-marker end" data-marker="end" style="left:${x(loop.end)}" title="End marker: drag to set the clip end (End)"></div>`);}
  if(picked.length>=2){const start=Math.min(...picked.map(note=>note.start)),end=Math.max(...picked.map(note=>note.start+note.duration));
   parts.push(`<div class="abl-stretch-marker" data-marker="stretch-start" style="left:${x(start)}" title="Note stretch marker: drag to stretch the selected notes (the other marker stays)"></div><div class="abl-stretch-marker" data-marker="stretch-end" style="left:${x(end)}" title="Note stretch marker: drag to stretch the selected notes (the other marker stays)"></div>`);}
  const html=parts.join('');if(rulerLayer._html!==html){rulerLayer._html=html;rulerLayer.innerHTML=html;}
 }
 function bindRulerMarkers(layer){
  // Capture phase on the window: the inherited ruler (scrub / insert marker) claims presses on the ruler before they bubble.
  if(rulerBound)return;rulerBound=true;
  win.addEventListener('pointerdown',event=>{const layer=rulerLayer;if(!layer||!layer.contains(event.target))return;
   const marker=event.target.closest?.('[data-marker]');if(!marker||event.button!==0||rulerDrag)return;const kind=marker.dataset.marker,info=rulerState();event.preventDefault();event.stopImmediatePropagation();
   const perBeat=api.pianoGeometry().barWidth/4,x0=event.clientX,pointerId=event.pointerId,snapTo=beats=>{const grid=event.altKey?0:(state.snap?gridBeats():0);return grid>0?Math.round(beats/grid)*grid:Math.round(beats*96)/96;};
   const ids=new Set(api.selectedNoteIds()),picked=clipNotes().filter(note=>ids.has(note.id)),span=picked.length?{start:Math.min(...picked.map(note=>note.start)),end:Math.max(...picked.map(note=>note.start+note.duration))}:null;
   const origin=kind==='start'?info?.loop.start:kind==='end'?info?.loop.end:kind==='brace'||kind==='loop-start'?info?.loop.loopStart:kind==='loop-end'?info?.loop.end:kind==='stretch-start'?span?.start:span?.end;if(!Number.isFinite(origin))return;
   const target=kind==='brace'?marker:kind==='loop-start'||kind==='loop-end'?marker.parentElement:marker,baseLeft=target.style.left,baseWidth=target.style.width;
   rulerDrag={kind,delta:0};layer.classList.add('dragging');try{layer.setPointerCapture?.(pointerId);}catch{}
   const preview=delta=>{const beats=value=>`calc(${(value/4).toFixed(6)} * var(--bar))`;if(kind==='loop-end'){target.style.width=beats(Math.max(.0625,info.loop.loopLength+delta));}else if(kind==='loop-start'){target.style.left=beats(Math.max(0,origin+delta));target.style.width=beats(Math.max(.0625,info.loop.loopLength-delta));}else target.style.left=beats(Math.max(0,origin+delta));};
   const move=sample=>{if(sample.pointerId!==pointerId||!rulerDrag)return;rulerDrag.delta=snapTo(origin+(sample.clientX-x0)/perBeat)-origin;preview(rulerDrag.delta);};
   const finish=commit=>sample=>{if(sample&&sample.pointerId!==pointerId)return;const drag=rulerDrag;rulerDrag=null;layer.classList.remove('dragging');for(const [type,handler]of handlers)doc.removeEventListener(type,handler,true);target.style.left=baseLeft;target.style.width=baseWidth;layer._html=null;
    if(commit&&drag&&Math.abs(drag.delta)>1e-9){const value=Math.max(0,origin+drag.delta);
     try{
      if(kind==='stretch-start'||kind==='stretch-end'){api.editNotes(targets=>{const next=stretchNotesToMarker(targets,span,kind,value);return !next||sameNotes(targets,next)?null:{changed:next};});}
      else if(info){const change=rulerMarkerChange(kind,info.loop,drag.delta);if(change)writePlacement(info.clip,info.p,change);}
     }catch(error){api.toast?.(error.message||String(error));}
    }
    sync();paintRulerMarkers();};
   const handlers=[['pointermove',move],['pointerup',finish(true)],['pointercancel',finish(false)]];for(const [type,handler]of handlers)doc.addEventListener(type,handler,true);
  },true);
 }
 function quantizeSettings(){
  const anchor=action('snap')||root,rect=anchor.getBoundingClientRect?.()||{left:0,bottom:0};
  const items=LIVE_GRIDS.map(grid=>({label:`Quantize to ${grid.label}`,checked:grid.id===state.grid,run:()=>{setGrid(grid.id);transform('quantize');}}));
  if(api.menu)api.menu({clientX:rect.left,clientY:rect.bottom+2},[{label:'Quantize Settings',disabled:true,title:'Choose the grid to quantize the selected notes to (⌘U repeats it).'},null,...items]);
  else transform('quantize');
 }
 function transform(op,options={}){
  if(state.kind!=='midi'){api.toast?.(CLIP_VIEW_UNAVAILABLE.stepNotes);return false;}
  if(op==='quantize')return api.quickQuantize();
  return api.editNotes(targets=>{
   if(!targets.length)return null;
   if(op==='addInterval')return{added:addIntervalNotes(targets,{semitones:options.semitones??12,newId:api.newId}),selectAdded:true};
   const fn=LIVE_NOTE_TRANSFORMS[op];if(!fn)return null;const next=fn(targets,options);
   return sameNotes(targets,next)?null:{changed:next};
  });
 }
 const notesOp={
  fitToScale:()=>transform('fitToScale',{root:state.scaleRoot,scale:state.scale}),
  invert:()=>transform('invert'),
  addInterval:()=>transform('addInterval',{semitones:Number(field('interval').value)||0}),
  double:()=>transform('stretch',{factor:2}),half:()=>transform('stretch',{factor:.5}),
  setLength:()=>transform('setLength',{beats:liveGrid(field('length-grid').value).beats}),
  humanize:()=>transform('humanize',{amount:Number(field('humanize').value)||0,gridBeats:gridBeats()}),
  randomizeVelocity:()=>state.kind!=='midi'?false:api.editNotes(targets=>{const next=randomizeVelocity(targets,Number(field('vel-range').value)||0);return sameNotes(targets,next)?null:{changed:next};}),
  rampVelocity:()=>state.kind!=='midi'?false:api.editNotes(targets=>{const next=rampVelocity(targets,Number(field('ramp-start').value)||1,Number(field('ramp-end').value)||127);return sameNotes(targets,next)?null:{changed:next};}),
  reverse:()=>transform('reverse'),legato:()=>transform('legato',{clipBeats:api.patternBeats(api.pattern())}),
  quantize:()=>transform('quantize'),
 };
 root.querySelector('.abl-clip-notes').addEventListener('click',event=>{const button=event.target.closest?.('button[data-op]');if(!button||button.disabled)return;event.preventDefault();try{notesOp[button.dataset.op]?.();}catch(error){api.fail(error);}});
 field('transpose').addEventListener('change',event=>{const value=Math.round(Number(event.target.value));event.target.value='0';if(value&&Number.isFinite(value))try{transform('transpose',{semitones:value});}catch(error){api.fail(error);}});

 // Live plays the transposed notes at their new pitch (↑/↓). Briefly, through the note editor's preview (the
 // engine's control-channel note audition), and only for small selections so a big chord never floods the channel.
 const AUDITION_MAX_NOTES=8;
 function auditionSelection(){
  if(!api.auditionNotes)return 0;const p=api.pattern(),c=api.channel(),ids=new Set(api.selectedNoteIds());if(!p||!c||!ids.size||ids.size>AUDITION_MAX_NOTES)return 0;
  const notes=(p.notes?.[c.id]||[]).filter(note=>ids.has(note.id)&&!note.muted);
  try{return api.auditionNotes(notes.map(note=>({pitch:note.pitch,velocity:note.velocity})));}catch(error){api.fail?.(error);return 0;}
 }
 // ---- Clip panel fields ----
 function commitBox(input){
  const name=input.dataset.field,value=input.value;
  try{
   if(state.kind==='audio'){const clip=audioClip();if(!clip)return;return commitAudioField(clip,name,value);}
   const p=api.pattern();if(!p)return;
   const placed=placementClip();if(placed)return commitPlacementField(placed,p,name,value);
   if(name==='end'||name==='length'){
    const beats=parseLiveBeats(value,{length:name==='length'});if(beats==null||beats<=0){api.toast?.('Type a length such as 2.0.0 (bars.beats.sixteenths).');return sync();}
    const total=name==='end'?beats:beats,bars=Math.min(64,Math.max(1,Math.ceil(total/4-1e-9)));
    if(Math.abs(bars*4-total)>1e-9)api.toast?.(`Freestyle patterns are whole bars: ${bars} bar${bars===1?'':'s'}.`);
    if(bars*4!==api.patternBeats(p))api.setPatternBars(p,bars);
   }
  }catch(error){api.fail(error);}finally{sync();}
 }
 // ---- Arrangement pattern placement: Live's Start / End / Loop / Position / Length on updatePatternPlacement ----
 // (abl-clip-model.js applyPlacementLoop documents the mapping). One edit() = one saved PATCH = one undo step.
 function placementClip(){
  if(state.kind!=='midi'&&state.kind!=='drum'||state.clipId==null)return null;const clip=api.findClip(state.clipId),p=api.pattern();
  return clip&&clip.patternId&&p&&clip.patternId===p.id&&clip.cloudRaw?clip:null;
 }
 const loopOptions=p=>({bpm:Number(project()?.bpm)||120,patternBeats:api.patternBeats(p)});
 function writePlacement(clip,p,change){
  let fields;try{fields=applyPlacementLoop(clip,change,loopOptions(p));}catch(error){api.toast?.(error.message);return false;}
  if(!fields)return false;const same=Math.abs((fields.length??clip.length)-clip.length)<1e-9&&(fields.start==null||Math.abs(fields.start-clip.start)<1e-9)&&['offsetMs','loopDurationMs','loopPhaseMs','windowMs','repeatCount'].every(key=>(fields.cloudRaw?.[key]??null)===(clip.cloudRaw?.[key]??null));
  if(same)return false;return (api.editPlacement||api.editAudioClip)(clip,fields);
 }
 function commitPlacementField(clip,p,name,value){
  if(name==='arr-position'){const beats=parseLiveBeats(value);if(beats==null){api.toast?.('Type a position such as 3.1.1.');return;}if(Math.abs(beats-clip.start)>1e-9)(api.editPlacement||api.editAudioClip)(clip,{start:beats});return;}
  const length=name==='length',beats=parseLiveBeats(value,{length});if(beats==null){api.toast?.(length?'Type a length such as 1.0.0 (bars.beats.sixteenths).':'Type a position such as 1.2.1.');return;}
  writePlacement(clip,p,name==='start'?{start:beats}:name==='position'?{loopStart:beats}:name==='length'?{loopLength:beats}:name==='end'?{end:beats}:{});
 }
 root.querySelector('.abl-loop').addEventListener('click',event=>{const clip=placementClip(),p=api.pattern();if(event.currentTarget.disabled||!clip||!p)return;event.preventDefault();try{writePlacement(clip,p,{looped:!placementLoop(clip,loopOptions(p)).looped});}catch(error){api.fail(error);}finally{sync();}});
 function extendClip(){const clip=placementClip(),p=api.pattern();if(!clip||!p){api.toast?.('Extend works on an Arrangement pattern clip: double-click it in the Arrangement first.');return false;}try{return writePlacement(clip,p,{extend:true});}catch(error){api.fail(error);return false;}finally{sync();}}
 action('extend').addEventListener('click',event=>{if(event.currentTarget.disabled)return;event.preventDefault();extendClip();});
 function commitAudioField(clip,name,value){
  if(name==='gain'){api.commitGain?.(clip,value)?.then?.(()=>sync());return;}
  const length=name==='length',beats=parseLiveBeats(value,{length});if(beats==null){api.toast?.('Type a position such as 1.1.1 or a length such as 2.0.0.');return sync();}
  const fields={};
  if(name==='position')fields.start=beats;
  if(name==='length'&&beats>0)fields.length=beats;
  if(name==='start'){if(clip.offsetKnown===false)return sync();const offset=beats;if(offset<0)return sync();fields.offset=offset;fields.length=Math.max(.25,clip.length-(offset-(clip.offset||0)));}
  if(name==='end'){const length=beats-(clip.offset||0);if(length>0)fields.length=length;}
  if(Object.keys(fields).length&&Object.entries(fields).some(([key,next])=>Math.abs((clip[key]??0)-next)>1e-9))api.editAudioClip(clip,fields);
  sync();
 }
 root.addEventListener('change',event=>{const input=event.target;if(input.matches?.('.abl-clip-fields input.abl-box,.abl-sample-grid input.abl-box'))commitBox(input);});
 root.addEventListener('keydown',event=>{const input=event.target;if(event.key==='Enter'&&input.matches?.('input.abl-box,input.abl-clip-name')){event.preventDefault();input.blur?.();if(input.matches('.abl-clip-name'))commitName();else if(input.dataset.field!=='transpose'&&input.dataset.field!=='interval'&&input.dataset.field!=='humanize')commitBox(input);else input.dispatchEvent(new win.Event('change',{bubbles:true}));}if(event.key==='Escape'&&input.matches?.('input')){input.blur?.();sync();}});
 const nameInput=root.querySelector('.abl-clip-name');
 function commitName(){const p=api.pattern(),value=nameInput.value.trim();if(state.kind==='audio'||!p||!value||value===p.name)return sync();api.renamePattern(p,value);sync();}
 nameInput.addEventListener('change',commitName);
 field('scale-root').addEventListener('change',event=>{state.scaleRoot=event.target.value;paintScale();});
 field('scale-name').addEventListener('change',event=>{state.scale=event.target.value;paintScale();});
 // Live 12: the clip scale follows the project Scale chooser (abl-scale.js) until the clip's own boxes are changed.
 function followProjectScale(detail){const key=detail?.key,name={major:'Major',minor:'Minor'}[String(detail?.scale||'').toLowerCase()];
  if(!key||!name||!LIVE_NOTE_NAMES.includes(key))return;state.scaleRoot=key;state.scale=name;field('scale-root').value=key;field('scale-name').value=name;paintScale();}
 try{const s=win.ablScale;if(s?.key)followProjectScale({key:s.key,scale:s.scale});}catch{}
 doc.addEventListener('abl:scale-change',event=>followProjectScale(event.detail));
 field('grid').addEventListener('change',event=>setGrid(event.target.value));
 // Live: right-click the grid chooser (or the editor's time ruler) for the grid menu: Adaptive / Fixed / Off / Triplet.
 field('grid').addEventListener('contextmenu',event=>gridMenu(event));
 // The stretch markers follow the note selection: repaint after the gesture / key that may have changed it.
 for(const type of ['pointerup','keyup'])doc.addEventListener(type,()=>{if(!root.hidden&&state.kind==='midi'&&!rulerDrag)win.setTimeout(()=>{try{paintRulerMarkers();}catch{}},0);},true);
 doc.addEventListener('contextmenu',event=>{if(event.target?.closest?.('#piano-ruler')&&!event.target.closest('[data-marker]')&&state.kind==='midi'&&!root.hidden)gridMenu(event);},true);

 // ---- Live's panel strip: Clip / Notes / Sample show or hide their panel (view only, kept per session) ----
 root.querySelector('.abl-clip-tabs').addEventListener('click',event=>{
  const button=event.target.closest?.('button[data-panel]');if(!button)return;const panel=root.querySelector(`.abl-clip-${button.dataset.panel}`);if(!panel)return;
  const shown=button.getAttribute('aria-pressed')!=='true';button.setAttribute('aria-pressed',String(shown));button.classList.toggle('lit',shown);panel.classList.toggle('abl-panel-off',!shown);
 });
 for(const button of root.querySelectorAll('.abl-clip-tabs button'))button.classList.add('lit');
 // ---- header actions ----
 root.querySelector('.abl-clip-editor-bar').addEventListener('click',event=>{
  const button=event.target.closest?.('button[data-action]');if(!button||button.disabled)return;const name=button.dataset.action;
  if(name==='draw')return setDrawMode(!state.drawMode);
  if(name==='midi-rec')return setMidiRecord(!state.midiRec);
  if(name==='preview'){/* Live's Preview switch drives the inherited note-preview toggle (one flag for keys, clicks and drawn notes) */const legacy=doc.getElementById('piano-midi-out');legacy?.click();const on=legacy?legacy.getAttribute('aria-pressed')!=='false':button.getAttribute('aria-pressed')!=='true';button.setAttribute('aria-pressed',String(on));button.classList.toggle('lit',on);return;}
  if(name==='snap'){state.snap=!state.snap;return applyGrid();}
  if(name==='scale'){state.scaleOn=!state.scaleOn;return paintScale();}
  if(name==='fold'){if(state.kind==='drum')return setUnfold(!state.unfold);if(state.kind==='midi'&&editorForPattern(api.pattern())==='step'){state.unfold=false;return open({fold:true});}/* Round 4: real Fold for instrument clips — only the key tracks that hold notes stay (Live: Fold to Notes). */return setNoteFold(state.noteFold==='notes'?null:'notes');}
  if(name==='scale-mode'&&state.kind==='midi'&&api.setNoteFold){/* Live: the Scale button folds the editor to the clip scale's key tracks */return setNoteFold(state.noteFold==='scale'?null:'scale');}
  if(name==='page-prev'||name==='page-next'){const pager=doc.getElementById('rack-step-page');if(!pager)return;const next=Math.max(0,Math.min(pager.options.length-1,Number(pager.value)+(name==='page-next'?1:-1)));if(String(next)!==pager.value){pager.value=String(next);pager.onchange?.(new win.Event('change'));}return sync();}
 });

 // ---- Scale highlight overlay (repeating every octave, behind nothing: a translucent tint) ----
 function paintScale(){
  const button=action('scale');button.setAttribute('aria-pressed',String(state.scaleOn));button.classList.toggle('lit',state.scaleOn);
  const wrap=doc.querySelector('#piano .piano-grid-wrap');if(!wrap)return;let overlay=wrap.querySelector(':scope>.abl-scale-overlay');
  const classes=state.scaleOn?scalePitchClasses(state.scaleRoot,state.scale):null;
  if(!classes){overlay?.remove();return;}
  if(!overlay){overlay=doc.createElement('div');overlay.className='abl-scale-overlay';overlay.setAttribute('aria-hidden','true');wrap.append(overlay);}
  const row=parseFloat(doc.getElementById('piano')?.style.getPropertyValue('--piano-row-height'))||17,stops=[];
  for(let i=0;i<12;i++){const pitch=127-i,on=classes.has(pitch%12)&&pitch%12!==LIVE_NOTE_NAMES.indexOf(state.scaleRoot),rootRow=pitch%12===LIVE_NOTE_NAMES.indexOf(state.scaleRoot),color=rootRow?'var(--abl-scale-root)':on?'var(--abl-scale-in)':'transparent';stops.push(`${color} ${i*row}px ${(i+1)*row}px`);}
  overlay.style.cssText=`left:${PIANO_KEY_WIDTH}px;top:${PIANO_RULER_HEIGHT}px;height:${PIANO_PITCH_COUNT*row}px;background:repeating-linear-gradient(180deg,${stops.join(',')})`;
  overlay.dataset.scale=`${state.scaleRoot} ${state.scale}`;
 }

 // ---- audio clip gain drag: unsaved engine previews while dragging, ONE saved (journaled) write on release ----
 const GAIN_DB_PER_PX=.2,GAIN_FLOOR_DB=-60,gainOf=db=>db<=GAIN_FLOOR_DB?0:Math.min(4,10**(db/20)),dbOf=gain=>gain>0?20*Math.log10(gain):GAIN_FLOOR_DB;
 let gainDrag=null;
 root.querySelector('.abl-gain-drag').addEventListener('pointerdown',event=>{
  if(event.button!==0||event.isPrimary===false||gainDrag||state.kind!=='audio')return;const clip=audioClip();if(!clip)return;event.preventDefault();event.stopPropagation();
  const context=api.gainAvailable?.(clip)?api.gainContext?.(clip):null;if(!context){api.toast?.('Clip gain needs a Studio API (OAuth) project.');return;}
  const start=Number.isFinite(api.clipGain?.(clip))?api.clipGain(clip):1,handle=event.currentTarget;let gesture;try{gesture=createClipGainGesture(context);}catch(error){api.fail(error);return;}
  gainDrag={pointerId:event.pointerId,clip,start,gain:start,y:event.clientY,gesture,context};try{handle.setPointerCapture?.(event.pointerId);}catch{}
  const box=field('gain'),show=gain=>{const db=dbOf(gain);box.value=gain<=0?'-inf dB':`${Math.abs(db)<.05?'0.0':db.toFixed(1)} dB`;};
  const end=(cancel,sample)=>{const drag=gainDrag;if(!drag||sample&&sample.pointerId!==drag.pointerId)return;gainDrag=null;handle.onpointermove=handle.onpointerup=handle.onpointercancel=handle.onlostpointercapture=null;win.removeEventListener('keydown',onEscape,true);
   const finished=drag.gesture.cancel();
   if(cancel||Math.abs(drag.gain-drag.start)<1e-6){if(Math.abs(drag.gain-drag.start)>=1e-6)Promise.resolve(finished).then(()=>{try{createClipGainGesture(drag.context).preview(drag.start);}catch{}});sync();return;}
   Promise.resolve(finished).then(()=>api.commitGain?.(drag.clip,drag.gain,{before:drag.start})).then(()=>sync(),error=>{api.fail(error);sync();});
  };
  const onEscape=key=>{if(key.key==='Escape'){key.preventDefault();key.stopImmediatePropagation();end(true);}};win.addEventListener('keydown',onEscape,true);
  handle.onpointermove=move=>{if(!gainDrag||move.pointerId!==gainDrag.pointerId)return;const db=Math.max(GAIN_FLOOR_DB,Math.min(dbOf(4),dbOf(gainDrag.start)+(gainDrag.y-move.clientY)*GAIN_DB_PER_PX)),gain=gainOf(db);if(Math.abs(gain-gainDrag.gain)<1e-9)return;gainDrag.gain=gain;show(gain);try{gainDrag.gesture.preview(gain);}catch(error){api.fail(error);end(true);}};
  handle.onpointerup=up=>end(false,up);handle.onpointercancel=handle.onlostpointercapture=sample=>end(true,sample);
 });

 // ---- audio sample view: Live's start / end markers on the waveform ----
 // The waveform shows the clip's audible window, so Start sits at 0 % and End at 100 %. Dragging Start trims the
 // head (offset + d, length − d: the end stays); dragging End trims the tail (length + d). Snapped to 1/16 (⌥: free).
 // Previewed by moving the marker; ONE edit on release (the same write as the Start / End boxes); Esc cancels.
 // End never extends past the current end: Freestyle does not expose the source length here.
 let markerDrag=null;
 root.querySelector('.abl-sample-markers').addEventListener('pointerdown',event=>{
  const marker=event.target.closest?.('.abl-sample-marker');if(!marker||event.button!==0||event.isPrimary===false||markerDrag||state.kind!=='audio')return;
  const clip=audioClip(),wave=root.querySelector('.abl-sample-wave');if(!clip||!wave)return;event.preventDefault();event.stopPropagation();
  const which=marker.dataset.marker;if(which==='start'&&clip.offsetKnown===false){api.toast?.('Freestyle has not exposed this clip’s source offset.');return;}
  const zoom=sampleZoomFor(clip),width=wave.getBoundingClientRect().width/(zoom.b-zoom.a);if(!(width>0))return;
  const pointerId=event.pointerId,x0=event.clientX,offset=clip.offset||0,length=clip.length,minimum=Math.min(.25,length);
  const compute=sample=>{const raw=(sample.clientX-x0)/width*length,d=sample.altKey?Math.round(raw*96)/96:Math.round(raw/.25)*.25;return which==='start'?Math.max(-offset,Math.min(length-minimum,d)):Math.max(minimum-length,Math.min(0,d));};
  const show=d=>{const at=(((which==='start'?0:1)+d/length)-zoom.a)/(zoom.b-zoom.a)*100;marker.style.left=d?`${at.toFixed(3)}%`:`${+at.toFixed(3)}%`;};
  markerDrag={pointerId,d:0};marker.classList.add('active');try{marker.setPointerCapture?.(pointerId);}catch{}
  const end=(commit,sample)=>{
   if(!markerDrag||sample&&sample.pointerId!==pointerId)return;if(commit&&sample&&Number.isFinite(sample.clientX))markerDrag.d=compute(sample);const d=markerDrag.d;markerDrag=null;
   marker.classList.remove('active');show(0);for(const type of ['pointermove','pointerup','pointercancel'])doc.removeEventListener(type,handlers[type],true);win.removeEventListener('keydown',onEscape,true);
   if(!commit||Math.abs(d)<1e-9)return;
   const fields=which==='start'?{offset:Math.round((offset+d)*1e9)/1e9,length:Math.round((length-d)*1e9)/1e9}:{length:Math.round((length+d)*1e9)/1e9};
   try{api.editAudioClip(clip,fields);}catch(error){api.fail?.(error);}sync();
  };
  const handlers={pointermove:sample=>{if(!markerDrag||sample.pointerId!==pointerId||!Number.isFinite(sample.clientX))return;markerDrag.d=compute(sample);show(markerDrag.d);},pointerup:sample=>end(true,sample),pointercancel:sample=>end(false,sample)};
  const onEscape=key=>{if(key.key==='Escape'){key.preventDefault();key.stopImmediatePropagation();end(false);}};
  for(const type of ['pointermove','pointerup','pointercancel'])doc.addEventListener(type,handlers[type],true);win.addEventListener('keydown',onEscape,true);
 });
 // ---- velocity lane: Live scales the stems to the lane (full velocity = the lane's height) ----
 function paintVelocityScale(){
  const lane=doc.getElementById('velocity-grid'),pane=doc.getElementById('piano');if(!lane||!pane)return;
  const height=lane.clientHeight||0,scale=height>0?Math.round(height/PIANO_VELOCITY_RANGE*1e4)/1e4:null;
  if(scale==null){pane.style.removeProperty('--abl-vel-k');return;}if(pane.style.getPropertyValue('--abl-vel-k')!==String(scale))pane.style.setProperty('--abl-vel-k',String(scale));
 }
 // ---- audio sample view: zoom (owner bug 1: down to sample level, repainted from cached peaks) ----
 // The window is a fraction [a,b] of the clip's audible range. ⌘/Ctrl-wheel or pinch zooms at the pointer, a plain
 // horizontal wheel (or ⇧-wheel) scrolls, + / − zoom at the centre, double-click (or W) shows the whole clip again.
 const sampleZoom={clipId:null,a:0,b:1};
 function sampleZoomFor(clip){if(sampleZoom.clipId!==clip?.id){sampleZoom.clipId=clip?.id??null;sampleZoom.a=0;sampleZoom.b=1;}return sampleZoom;}
 function sampleSeconds(clip){const bpm=Number(project()?.bpm)||120,spb=60/bpm;return{start:(clip.offset||0)*spb,length:Math.max(.001,clip.length*spb)};}
 function paintSample(clip){
  const target=root.querySelector('.abl-sample-wave');if(!target||!clip)return;
  const zoom=sampleZoomFor(clip),seconds=sampleSeconds(clip);
  for(const marker of root.querySelectorAll('.abl-sample-marker')){if(markerDrag)break;const at=((marker.dataset.marker==='start'?0:1)-zoom.a)/(zoom.b-zoom.a);marker.style.left=`${+(at*100).toFixed(3)}%`;marker.hidden=at<-.001||at>1.001;}
  if(!api.showWaveform)return false;
  if(target._ablMarkup!==null){target._ablMarkup=null;for(const child of [...target.children])if(child.tagName!=='CANVAS')child.remove();}
  const status=api.showWaveform(target,clip,{startSec:seconds.start+zoom.a*seconds.length,endSec:seconds.start+zoom.b*seconds.length});
  target.dataset.status=status==='empty'?'loading':'ready';return true;
 }
 function zoomSample(clip,factor,anchor=.5){
  const zoom=sampleZoomFor(clip),seconds=sampleSeconds(clip),minimum=Math.min(1,24/(seconds.length*48000)),span=Math.max(minimum,Math.min(1,(zoom.b-zoom.a)*factor)),at=zoom.a+(zoom.b-zoom.a)*anchor;
  let a=at-span*anchor;a=Math.max(0,Math.min(1-span,a));zoom.a=a;zoom.b=a+span;paintSample(clip);
 }
 function scrollSample(clip,fraction){const zoom=sampleZoomFor(clip),span=zoom.b-zoom.a,a=Math.max(0,Math.min(1-span,zoom.a+fraction*span));zoom.a=a;zoom.b=a+span;paintSample(clip);}
 {const sampleView=root.querySelector('.abl-sample-view');
  sampleView?.addEventListener('wheel',event=>{const clip=audioClip();if(!clip||state.kind!=='audio')return;event.preventDefault();const rect=sampleView.getBoundingClientRect(),anchor=rect.width>0?Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)):.5;
   if(event.ctrlKey||event.metaKey||(!event.shiftKey&&Math.abs(event.deltaY)>Math.abs(event.deltaX)&&event.altKey))zoomSample(clip,Math.exp(event.deltaY*.01),anchor);
   else if(Math.abs(event.deltaX)>Math.abs(event.deltaY)||event.shiftKey)scrollSample(clip,(Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY)/Math.max(1,rect.width));
   else zoomSample(clip,Math.exp(event.deltaY*.004),anchor);},{passive:false});
  sampleView?.addEventListener('dblclick',event=>{if(event.target.closest?.('.abl-sample-marker'))return;const clip=audioClip();if(clip){sampleZoom.a=0;sampleZoom.b=1;paintSample(clip);}});
 }
 // ---- audio sample view ----
 function loadWaveform(clip){if(api.showWaveform)return;try{const pending=api.loadWaveform?.(clip);pending?.then?.(()=>{if(audioClip()===clip)sync();},()=>{if(audioClip()===clip)sync();});}catch(error){api.toast?.(error.message);}}

 // ---- paint ----
 // Live's clip title bar takes the clip colour, which follows its track (the Arrangement's nth-lane colour).
 function paintClipColour(){
  // A pattern shown without a clip id (⇧Tab, an adopted editor, a selection change) takes the colour of its first clip.
  const shown=state.kind==='midi'||state.kind==='drum'?api.pattern():null,first=shown?(project()?.clips||[]).find(clip=>clip.patternId===shown.id):null;
  const id=state.kind==='audio'?state.audioClipId:state.clipId??first?.id??null,escape=value=>win.CSS?.escape?win.CSS.escape(String(value)):String(value).replace(/["\\]/g,'\\$&');
  const lane=id!=null?doc.querySelector(`#playlist .clip[data-clip="${escape(id)}"]`)?.closest('.track-lane'):null,colour=lane?.parentElement?ablTrackColor(Array.prototype.indexOf.call(lane.parentElement.children,lane)):null;
  if(colour)root.style.setProperty('--abl-clip-colour',colour);else root.style.removeProperty('--abl-clip-colour');
 }
 function sync(){try{paintRulerMarkers();}catch{}try{refreshNoteFold();}catch{}
  if(state.disposed)return;
  root.dataset.kind=state.kind;paintClipColour();
  const fold=action('fold'),stepPattern=state.kind!=='audio'&&state.kind!=='none'&&editorForPattern(api.pattern())==='step';
  const unfolded=state.kind==='drum'&&!!state.unfold,folded=state.kind==='drum'&&!unfolded;if(root.hasAttribute('data-unfold')!==unfolded)root.toggleAttribute('data-unfold',unfolded);
  const noteFoldable=state.kind==='midi'&&!stepPattern&&!!api.setNoteFold,noteFolded=noteFoldable&&state.noteFold==='notes';fold.setAttribute('aria-pressed',String(folded||noteFolded));fold.classList.toggle('lit',folded||noteFolded);fold.disabled=!(state.kind==='drum'||stepPattern||noteFoldable);fold.title=fold.disabled?CLIP_VIEW_UNAVAILABLE.fold:noteFoldable?(noteFolded?'Unfold: show all key tracks':'Fold: show only the key tracks that contain notes'):folded?'Unfold: show every pad’s hits in the note editor, on its pad note’s key':'Fold: one row per Drum Rack pad';
  for(const button of root.querySelectorAll('.abl-clip-notes button[data-op],.abl-clip-notes input,.abl-clip-notes select')){button.disabled=state.kind!=='midi';if(state.kind==='drum')button.title=CLIP_VIEW_UNAVAILABLE.stepNotes;}
  const set=(name,value,{disabled=false,title=''}={})=>{const input=field(name);if(!input)return;if(doc.activeElement!==input)input.value=value;input.disabled=disabled;input.title=title;};
  if(state.kind==='audio'){
   const clip=audioClip();if(!clip){setKind('none');return;}
   if(doc.activeElement!==nameInput)nameInput.value=clip.name||'Audio Clip';nameInput.readOnly=true;nameInput.title='Audio clip names come from the sample in Freestyle.';
   const offset=clip.offset||0;
   set('start',livePosition(offset),{disabled:clip.offsetKnown===false,title:clip.offsetKnown===false?'Freestyle has not exposed this clip’s source offset.':'Sample start (source offset)'});
   set('end',livePosition(offset+clip.length),{title:'Sample end'});
   set('position',livePosition(clip.start),{title:'Arrangement position'});set('length',liveLength(clip.length),{title:'Clip length'});
   const loop=root.querySelector('.abl-loop');loop.disabled=true;loop.title=CLIP_VIEW_UNAVAILABLE.audioLoop;loop.setAttribute('aria-pressed','false');
   const gain=api.clipGain?.(clip),db=Number.isFinite(gain)?(gain>0?20*Math.log10(gain):-Infinity):null;
   set('gain',db==null?'—':Number.isFinite(db)?`${Math.abs(db)<.05?'0.0':db.toFixed(1)} dB`:'-inf dB',{disabled:!api.gainAvailable?.(clip),title:api.gainAvailable?.(clip)?'Clip gain (dB): type a value and press Return':'Clip gain needs a Studio API (OAuth) project.'});
   if(paintSample(clip)){/* canvas from the peak pyramid: synchronous, never a placeholder once seen */}else{
   const wave=api.waveform?.(clip)||{status:'idle'},target=root.querySelector('.abl-sample-wave');target.dataset.status=wave.status;
   const markup=wave.status==='ready'?wave.svg:`<span class="abl-sample-label" title="${esc(wave.error||'')}">${wave.status==='loading'?'Loading waveform…':wave.status==='error'?'Waveform unavailable':'Waveform loads from Freestyle'}</span>`;if(target._ablMarkup!==markup){target._ablMarkup=markup;target.innerHTML=markup;target.querySelector('svg')?.setAttribute('preserveAspectRatio','none');}}
   // QA r6: no "not yet loaded in the live engine" note. clip.engineLoaded only says whether the REST snapshot carried runtime
   // track/clip ids for this take (cloud-session normalizeCloudAudioClip); Studio API snapshots usually omit them, so the
   // note showed on takes the engine was playing and metering. Freestyle exposes no reliable per-clip load flag.
   root.querySelector('.abl-sample-info').textContent='';
   return;
  }
  if(shownClipGone()){clearGoneClip();return;}
 nameInput.readOnly=false;nameInput.title='Clip name (Return to rename)';
  const p=api.pattern();if(!p)return;
  if(doc.activeElement!==nameInput)nameInput.value=p.name||'MIDI Clip';
  const beats=api.patternBeats(p);
  const loop=root.querySelector('.abl-loop'),extend=action('extend'),placed=placementClip();
  if(placed){
   const info=placementLoop(placed,loopOptions(p));
   set('start',livePosition(info.start),{disabled:!info.startEditable,title:info.startEditable?'Start: where this clip starts playing inside its loop':PLACEMENT_LOOP_REASONS.phase});
   const loopTitle=info.loopEditable?'':PLACEMENT_LOOP_REASONS.phaseSet;
   set('end',livePosition(info.end),{disabled:!info.loopEditable,title:loopTitle||'Loop end (inside the pattern)'});
   set('position',livePosition(info.loopStart),{disabled:!info.loopEditable,title:loopTitle||'Loop Position: where the loop starts inside the pattern'});
   set('length',liveLength(info.loopLength),{disabled:!info.loopEditable,title:loopTitle||'Loop Length: the repeating part (pattern length is set in a Session clip)'});
   set('arr-position',livePosition(placed.start),{title:'Arrangement position of this clip'});
   loop.disabled=false;loop.setAttribute('aria-pressed',String(info.looped));loop.classList.toggle('lit',info.looped);loop.title=info.looped?'Loop on: the clip repeats its loop. Click: trim the clip to one pass':'Loop off: the clip plays its loop once. Click: extend the clip by one loop repeat';
   extend.disabled=false;
  }else{
   set('start',livePosition(0),{disabled:true,title:CLIP_VIEW_UNAVAILABLE.start});set('end',livePosition(beats),{title:'Clip end (whole bars)'});
   set('position',livePosition(0),{disabled:true,title:CLIP_VIEW_UNAVAILABLE.position});set('length',liveLength(beats),{title:'Clip length (whole bars, 1–64)'});
   set('arr-position','',{disabled:true,title:CLIP_VIEW_UNAVAILABLE.position});
   loop.disabled=true;loop.title=CLIP_VIEW_UNAVAILABLE.loop;loop.setAttribute('aria-pressed','true');extend.disabled=true;extend.title='Extend works on an Arrangement pattern clip (double-click it in the Arrangement).';
  }
  const channel=api.channel(),notes=(p.notes?.[channel?.id]||[]),ids=new Set(api.selectedNoteIds()),selected=ids.size?notes.filter(note=>ids.has(note.id)):notes;
  root.querySelector('.abl-notes-pitch').textContent=selected.length?liveNoteName(Math.min(...selected.map(note=>note.pitch))):'—';
  root.querySelector('.abl-clip-title').title=channel?.name?`${p.name||'Clip'} · ${channel.name}`:'';
  const pager=doc.getElementById('rack-step-page');root.querySelector('.abl-page').textContent=pager?`Bar ${Number(pager.value)+1} / ${pager.options.length}`:'';
  if(state.scaleOn)paintScale();
  if(state.kind==='drum'){const pads=paintFold(p);if(unfolded)paintUnfold(p,pads);paintFoldVelocity(p);}
  paintMidiKeys();paintVelocityShades();paintVelocityScale();if(state.kind==='midi'&&editorShown('piano')){centreNotes();holdFit();}
 }
 // Live fits the note editor to the clip's notes each time a clip is opened (C3 for an empty clip), until the user
 // scrolls or zooms it in that open. A re-double-click of the clip already showing keeps that user scroll.
 // Only real user input counts as a user scroll (wheel, a scrollbar/navigator/keys drag, a scroll during a press in
 // the editor, PageUp/PageDown/Home/End, + / −): app scrolls — the inherited Piano Roll's first-render focus
 // (highest note + 5 at the top), a re-render, a restored view — never cancel the fit, and holdFit() undoes them.
 // Never scrolls during a gesture (a held key / drag validates its captured scroll) and never before the editor
 // has a laid-out height (a hidden Detail View would centre against 0 px and leave the view at the top, C8+):
 // in both cases the clip stays un-centred and the next sync / ResizeObserver tick centres it.
 const clipKey=()=>{const p=api.pattern(),c=api.channel();return p&&c?`${p.id}:${c.id}`:null;};
 // ---- Fold (Live: Fold to Notes / Fold to Scale) for instrument clips ----
 // 'notes': only key tracks that hold notes; 'scale': only the clip scale's key tracks (plus any note outside it).
 // The set is taken when Fold is switched on or another clip is shown; notes moved onto a hidden track add it.
 function foldPitchesFor(mode){
  const p=api.pattern(),c=api.channel(),used=p&&c?(p.notes?.[c.id]||[]).map(note=>note.pitch).filter(pitch=>Number.isInteger(pitch)):[];
  if(mode==='notes')return used.length?[...new Set(used)]:null;
  if(mode==='scale'){const classes=scalePitchClasses(state.scaleRoot,state.scale),all=[];for(let pitch=0;pitch<128;pitch++)if(classes.has(pitch%12))all.push(pitch);return [...new Set([...all,...used])];}
  return null;
 }
 function paintNoteFold(){const fold=action('fold'),scaleFold=action('scale-mode');if(state.kind==='midi'){fold?.setAttribute('aria-pressed',String(state.noteFold==='notes'));fold?.classList.toggle('lit',state.noteFold==='notes');}if(scaleFold&&state.kind==='midi'){scaleFold.setAttribute('aria-pressed',String(state.noteFold==='scale'));scaleFold.classList.toggle('lit',state.noteFold==='scale');}}
 function setNoteFold(mode){
  if(!api.setNoteFold)return false;const pitches=mode?foldPitchesFor(mode):null;
  if(mode&&!pitches){api.toast?.('Fold: this clip has no notes yet.');mode=null;}
  state.noteFold=mode||null;state.noteFoldKey=clipKey();markUserView();api.setNoteFold(pitches);paintNoteFold();
  if(!state.noteFold)centreNotes({force:true});
  return true;
 }
 /** Another clip is shown: Fold keeps its mode and takes that clip's key tracks (Drum / audio clips: unfolded). */
 function refreshNoteFold(){
  if(!api.setNoteFold)return;
  if(state.kind!=='midi'){if(api.noteFold?.())api.setNoteFold(null);return;}
  if(state.noteFold&&state.noteFoldKey!==clipKey()){const pitches=foldPitchesFor(state.noteFold);state.noteFoldKey=clipKey();if(!pitches)state.noteFold=null;api.setNoteFold(pitches);}
  else if(!state.noteFold&&api.noteFold?.())api.setNoteFold(null);
  paintNoteFold();
 }
 function centreNotes({force=false}={}){
  if(api.noteFold?.())return false;/* folded: every shown key track is a used one; nothing to centre */
  const p=api.pattern(),c=api.channel(),scroller=doc.getElementById('piano-scroll');if(!p||!c||!scroller||!api.scrollNotesTo)return false;
  const key=`${p.id}:${c.id}`;if(key===state.centred&&!force)return false;
  // A sync can run mid-render (the shell's afterTracks hook fires from renderPlaylist, before renderPiano): the
  // Piano Roll has not shown this clip yet and its first render would still reposition the view. Centre (or record
  // the deferred baseline) only once it has, i.e. after the current synchronous render finishes.
  if(typeof api.renderedNotesTarget==='function'&&api.renderedNotesTarget()!==key){if(!state.centreQueued){state.centreQueued=true;Promise.resolve().then(()=>{state.centreQueued=false;if(!state.disposed&&state.kind==='midi'&&editorShown('piano')&&api.renderedNotesTarget()===clipKey())centreNotes();});}return false;}
  // A deferred centre (shown hidden / 0 px / mid-gesture) gives up once anything else has scrolled the editor
  // since the clip was shown: a user scroll, page zoom or a restored view always wins.
  if(!force&&state.pending?.key===key&&state.userScrolled===key){state.centred=key;state.pending=null;return false;}
  const visible=(scroller.clientHeight||0)-PIANO_RULER_HEIGHT;
  if(root.hidden||api.gestureActive?.()||!(visible>0)){if(state.pending?.key!==key)state.pending={key,top:scroller.scrollTop};return false;}
  state.pending=null;
  const pitches=(p.notes?.[c.id]||[]).map(note=>note.pitch);
  state.centred=key;state.fitKey=key;
  const {top,rowHeight}=fitNoteRange(pitches,{visible,rowHeight:baseRowHeight()});
  try{const view=api.scrollNotesTo(top,rowHeight!==api.pianoGeometry().rowHeight?rowHeight:undefined);state.fittedRow=api.pianoGeometry().rowHeight;state.centredTop=view?.scrollTop??scroller.scrollTop;}catch(error){api.fail?.(error);}
  return true;
 }
 /** Keep the open's fit against app scrolls / row-height resets until the user scrolls this clip. */
 function holdFit(){
  const key=clipKey(),scroller=doc.getElementById('piano-scroll');
  if(!key||!scroller||state.fitKey!==key||state.centred!==key||state.userScrolled===key||root.hidden||state.kind!=='midi'||!editorShown('piano')||api.gestureActive?.())return false;
  if(Math.abs(scroller.scrollTop-state.centredTop)<1&&api.pianoGeometry().rowHeight===state.fittedRow)return false;
  return centreNotes({force:true});
 }
 const markUserView=()=>{const key=clipKey();if(key&&state.kind==='midi')state.userScrolled=key;};
 /** app.js asks before its inherited first-render focus scroll: the Clip View owns the scroll of a fitted open. */
 const ownsScroll=target=>!state.disposed&&target!=null&&(state.openingClip||state.fitKey===target)&&state.userScrolled!==target;
 // The row height the user chose: a height the fit set itself is never treated as the user's zoom.
 function baseRowHeight(){const row=api.pianoGeometry().rowHeight;if(state.fittedRow==null||row!==state.fittedRow)state.userRow=row;return state.userRow??row;}
 // The Detail View is resizable (shell splitter / window): a clip not yet centred (shown while hidden) centres
 // once it has a height; while the user has not scrolled since, its notes stay centred in the new height.
 function onDetailResize(){
  const scroller=doc.getElementById('piano-scroll');if(root.hidden||state.kind!=='midi'||!scroller||!editorShown('piano'))return;
  const key=clipKey();
  if(state.centred!==key)centreNotes();else if(state.fitKey===key&&state.userScrolled!==key||Math.abs(scroller.scrollTop-state.centredTop)<1&&api.pianoGeometry().rowHeight===state.fittedRow)centreNotes({force:true});
 }
 const resizeObserver=typeof win.ResizeObserver==='function'?new win.ResizeObserver(()=>{paintVelocityScale();onDetailResize();if(state.kind==='drum'&&!root.hidden){const p=api.pattern();if(p)paintFoldVelocity(p);}}):null;
 const observeSizes=()=>{for(const node of [root,doc.getElementById('abl-detail'),doc.getElementById('piano-scroll'),doc.getElementById('velocity-grid')])if(node&&!observeSizes.seen.has(node)){observeSizes.seen.add(node);resizeObserver?.observe(node);}};observeSizes.seen=new Set();
 observeSizes();
 // Drum Rack Fold rows, as Live: each pad row carries its pad note (C1 = pad 1, the Drum Rack device's numbering:
 // the pattern's sources in rack order) beside the pad name, and each lit step is a note shaded by its velocity.
 // Live's Fold shows only the Drum Rack's pads: the channels this clip uses (the Drum Rack device's pads, same
 // numbering). Project rows not in the clip (other patterns' samples, "LABS — Use in this pattern") are hidden.
 // If no row qualifies (an empty pattern), every row stays so a first sound can still be chosen.
 // QA r13: Freestyle's rack sources are PER PATTERN (getPattern.pattern.sources: "Vegetable drums" owns Kick/Clap/Hat;
 // "Pattern 1" its own Kick/Snare/Hi Hat/808), not project-global like FL's Channel Rack. So the Fold rows are exactly
 // the Drum Rack device's pads: the rows bound in this clip's pattern. Other patterns' samples ("rack-missing" rows)
 // are hidden; a sound is added as a pad through the Drum Rack device (drop on a pad), as in Live.
 const foldPadRow=row=>!row.classList.contains('rack-missing');
 function paintFold(p){
  const sources=Object.keys(p.cloudSources||{}),channels=project()?.channels||[],pads=(sources.length?channels.filter(c=>sources.includes(c.id)):channels.filter(c=>c.patternSource&&c.patternId===p.id)).map(c=>c.id);
  const rows=[...doc.querySelectorAll('#rack .rack-channel[data-channel]')],padRows=new Set(rows.filter(foldPadRow)),filter=padRows.size>0;
  // Pad numbering = the Drum Rack device's (app.js ablDrumRack): sources first, then the other bound rows in rack order.
  for(const row of padRows)if(!pads.includes(row.dataset.channel))pads.push(row.dataset.channel);
  for(const row of rows){const hide=filter&&!padRows.has(row);if(row.classList.contains('abl-fold-hidden')!==hide)row.classList.toggle('abl-fold-hidden',hide);}
  for(const row of rows){
   const id=row.dataset.channel,index=row.classList.contains('rack-missing')?-1:pads.indexOf(id),name=row.querySelector(':scope>.channel-name'),note=index>=0?ablPadNote(index):'';
   if(name&&(name.dataset.ablPadNote||'')!==note){if(note)name.dataset.ablPadNote=note;else delete name.dataset.ablPadNote;}
   // The pad's key cell is a black key for a sharp pad note (C#1, D#1 …), as Live's Fold key strip.
   if(name){const black=note.includes('#');if(black!==name.hasAttribute('data-abl-pad-black'))name.toggleAttribute('data-abl-pad-black',black);}
   const steps=p.steps?.[id]||[];
   for(const step of row.querySelectorAll('.step[data-step]')){const value=steps[Number(step.dataset.step)],level=typeof value==='number'&&Number.isFinite(value)?(value>1?value/127:value):1,text=Math.max(0,Math.min(1,level)).toFixed(3);if(step.classList.contains('on')){if(step.style.getPropertyValue('--abl-vel')!==text)step.style.setProperty('--abl-vel',text);}else if(step.style.getPropertyValue('--abl-vel'))step.style.removeProperty('--abl-vel');}
  }
  // The Fold pads (visible rows only), with their Drum Rack pad index: the unfolded note editor's key rows.
  return rows.filter(row=>!row.classList.contains('abl-fold-hidden')&&!row.classList.contains('rack-missing')).map(row=>{const id=row.dataset.channel;return{id,index:pads.indexOf(id),name:row.querySelector(':scope>.channel-name')?.textContent.trim()||channels.find(c=>c.id===id)?.name||'Pad'};}).filter(pad=>pad.index>=0);
 }
 // Fold off: every pad's steps as notes on its pad note's key (same pads and numbering as Fold / the Drum Rack).
 function paintUnfold(p,pads){
  const steps={};for(const pad of pads)steps[pad.id]=p.steps?.[pad.id]||[];
  const length=Math.max(16,Math.ceil((api.patternBeats(p)||4)*4),...Object.values(steps).map(row=>row.length));
  drumNotes.paint({patternId:p.id,rows:unfoldRows(pads,{firstNote:ABL_PAD_FIRST_NOTE,noteName:ablPadNote}),steps,length,selectedPad:api.channel()?.id||null,beatsPerBar:4});
 }
 // ---- Fold velocity lane (Live: the velocity lane stays under the Fold grid for Drum Rack clips) ----
 // One stem + circle per lit step of every pad row, at the step's column, height = velocity × lane height (the
 // selected pad's stems are drawn on top). Dragging a stem vertically sets that step's velocity (previewed in the
 // lane), written on release as ONE edit through the rack step-velocity path (api.setStepVelocity → one undo step).
 const foldLane=root.querySelector('.abl-fold-velocity'),foldPlot=foldLane.querySelector('.abl-fold-vel-plot');
 const FOLD_LANE_PX=50,FOLD_HIT_PX=8,FOLD_MIN=1/127;
 const stepLevel=value=>value===true?DEFAULT_STEP_VELOCITY:typeof value==='number'&&Number.isFinite(value)&&value>0?Math.min(1,value>1?value/127:value):0;
 let foldStems=[],foldDrag=null;
 function paintFoldVelocity(p){
  if(foldDrag)return;
  const box=foldPlot.getBoundingClientRect(),selected=api.channel()?.id,stems=[];
  if(state.unfold){for(const stem of drumNotes.stems()){const level=stepLevel(p.steps?.[stem.id]?.[stem.index]);if(level>0)stems.push({id:stem.id,index:stem.index,level,x:Math.round((stem.x-box.left)*10)/10,selected:stem.selected||stem.id===selected});}}
  else for(const row of doc.querySelectorAll('#rack .rack-channel[data-channel]')){
   if(row.classList.contains('rack-missing')||row.classList.contains('abl-fold-hidden'))continue;const id=row.dataset.channel,steps=p.steps?.[id];if(!Array.isArray(steps))continue;
   for(const step of row.querySelectorAll('.step[data-step]')){const index=Number(step.dataset.step),level=stepLevel(steps[index]);if(!(level>0))continue;const r=step.getBoundingClientRect();if(!(r.width>0))continue;stems.push({id,index,level,x:Math.round((r.left+r.width/2-box.left)*10)/10,selected:id===selected});}
  }
  stems.sort((a,b)=>a.selected-b.selected);foldStems=stems;
  const markup=stems.map(s=>`<span class="abl-fold-vel${s.selected?' selected':''}" data-channel="${esc(s.id)}" data-step="${s.index}" style="left:${s.x}px;height:${(s.level*100).toFixed(2)}%;--abl-vel:${s.level.toFixed(3)}"></span>`).join('');
  if(foldPlot._ablMarkup!==markup){foldPlot._ablMarkup=markup;foldPlot.innerHTML=markup;}
 }
 foldPlot.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.isPrimary===false||foldDrag||state.kind!=='drum'||!api.setStepVelocity||!Number.isFinite(event.clientX))return;
  const box=foldPlot.getBoundingClientRect(),x=event.clientX-box.left,distance=Math.min(Infinity,...foldStems.map(stem=>Math.abs(stem.x-x)));
  if(!(distance<=FOLD_HIT_PX))return;
  // Overlapping stems (several pads on one step): the selected pad's stem wins, then the louder one.
  const best=foldStems.filter(stem=>Math.abs(stem.x-x)<=distance+.5).sort((a,b)=>b.selected-a.selected||b.level-a.level)[0];if(!best)return;event.preventDefault();event.stopPropagation();
  const height=foldPlot.clientHeight||box.height||FOLD_LANE_PX,pointerId=event.pointerId,y0=event.clientY,node=[...foldPlot.querySelectorAll('.abl-fold-vel')].find(n=>n.dataset.channel===best.id&&Number(n.dataset.step)===best.index);
  const compute=sample=>Math.round(Math.max(FOLD_MIN,Math.min(1,best.level+(y0-sample.clientY)/height))*127)/127;
  const show=level=>{if(!node)return;node.style.height=`${(level*100).toFixed(2)}%`;node.style.setProperty('--abl-vel',level.toFixed(3));node.classList.add('active');foldLane.dataset.value=String(Math.round(level*127));};
  foldDrag={pointerId,level:best.level};try{foldPlot.setPointerCapture?.(pointerId);}catch{}
  const end=(commit,sample)=>{
   if(!foldDrag||sample&&sample.pointerId!==pointerId)return;if(commit&&sample&&Number.isFinite(sample.clientY))foldDrag.level=compute(sample);const level=foldDrag.level;foldDrag=null;
   for(const type of ['pointermove','pointerup','pointercancel'])doc.removeEventListener(type,handlers[type],true);win.removeEventListener('keydown',onEscape,true);node?.classList.remove('active');delete foldLane.dataset.value;
   if(commit&&Math.abs(level-best.level)>1e-9){try{api.setStepVelocity(best.id,best.index,level);}catch(error){api.fail?.(error);}}
   foldPlot._ablMarkup=null;sync();
  };
  const handlers={pointermove:sample=>{if(!foldDrag||sample.pointerId!==pointerId||!Number.isFinite(sample.clientY))return;foldDrag.level=compute(sample);show(foldDrag.level);},pointerup:sample=>end(true,sample),pointercancel:sample=>end(false,sample)};
  const onEscape=key=>{if(key.key==='Escape'){key.preventDefault();key.stopImmediatePropagation();end(false);}};
  for(const type of ['pointermove','pointerup','pointercancel'])doc.addEventListener(type,handlers[type],true);win.addEventListener('keydown',onEscape,true);
 });
 // Live shades each note by velocity (pale = soft, saturated = loud): expose it to CSS as --abl-vel (0–1).
 function paintVelocityShades(){
  const shades=new Map(),set=(node,text)=>{if(node.style.getPropertyValue('--abl-vel')!==text)node.style.setProperty('--abl-vel',text);};
  for(const node of doc.querySelectorAll('#piano .piano-note[data-midi-velocity]')){const text=(Math.max(0,Math.min(127,Number(node.dataset.midiVelocity)||0))/127).toFixed(3);shades.set(node.dataset.note,text);set(node,text);}
  for(const bar of doc.querySelectorAll('#piano .velocity-bar[data-velocity]')){const text=shades.get(bar.dataset.velocity);if(text)set(bar,text);}
  for(const key of doc.querySelectorAll('#piano-keys .piano-key[data-pitch]'))key.classList.toggle('abl-c',Number(key.dataset.pitch)%12===0);
 }
 let syncQueued=false;const queueSync=()=>{if(syncQueued||state.disposed)return;syncQueued=true;Promise.resolve().then(()=>{syncQueued=false;if(!root.hidden)sync();});};
 const observer=new win.MutationObserver(queueSync);
 for(const id of ['piano-grid','rack-channels','velocity-grid']){const node=doc.getElementById(id);if(node)observer.observe(node,{childList:true});}
 // E / the editors' close button hide #piano and #rack: an empty MIDI Clip View hides with them.
 // An editor shown by any inherited path (its window, a restored layout) is the Clip View's content.
 // (Also checked synchronously before each key, as observer records arrive a task later.)
 function adoptShownEditor(){if((state.kind==='midi'||state.kind==='drum')&&!editorShown('piano')&&!editorShown('step'))setKind('none');else if(state.kind==='none'&&editorShown('piano'))setKind('midi',{adopt:true});else if(state.kind==='none'&&editorShown('step'))setKind('drum',{adopt:true});}
 const paneObserver=new win.MutationObserver(adoptShownEditor);
 for(const id of ['piano','rack']){const node=doc.getElementById(id);if(node)paneObserver.observe(node,{attributes:true,attributeFilter:['class']});}

 // ---- Live gestures layered on the inherited editors ----
 const pianoGrid=()=>doc.getElementById('piano-grid');
 // Live: a note's right-edge resize hot zone (noteEdgeZones) is decided by geometry, not by which element the
 // browser hit: the inherited handle (.note-resize) sits inside the note's 1 px border, so a press on the note's
 // outermost pixels hits the body. A body press inside the zone is re-delivered to the handle (resize); a handle
 // press outside it is re-delivered to the body (move). ⌘ / ⌃ presses keep their own meaning (velocity, menu).
 function routeNoteEdge(event){
  if(state.kind!=='midi'||event.button!==0||event.isPrimary===false||!Number.isFinite(event.clientX))return false;
  const element=event.target?.closest?.('#piano .piano-note[data-note]'),grid=pianoGrid();if(!element||!grid)return false;
  const note=(api.pattern()?.notes?.[api.channel()?.id]||[]).find(item=>item.id===element.dataset.note);if(!note)return false;
  const {barWidth}=api.pianoGeometry(),width=note.duration/4*barWidth,right=grid.getBoundingClientRect().left+(note.start+note.duration)/4*barWidth;
  if(!(width>0))return false;const fromRight=right-event.clientX,zone=noteEdgeZones(width).right;
  if(event.target.classList?.contains('note-resize')){
   // Only a press the inherited 6 px strip can really receive (≤ 6 px from the end, inside the note) but outside the
   // hot zone is re-delivered; anything else is the handle's own business.
   return fromRight>zone&&fromRight<=Math.min(width,INHERITED_HANDLE_PX)?redeliver(event,element):false;
  }
  if(event.metaKey||event.ctrlKey||!(fromRight>=-.5&&fromRight<=zone))return false;
  const handle=element.querySelector(':scope > .note-resize');return handle?redeliver(event,handle):false;
 }
 /** Re-deliver a pointerdown to the element the press belongs to (same pointer, point and modifiers). */
 function redeliver(event,element){
  event.preventDefault();event.stopPropagation();
  const Ctor=win.PointerEvent||win.MouseEvent,init={bubbles:true,cancelable:true,composed:true,button:event.button,buttons:event.buttons,detail:event.detail,clientX:event.clientX,clientY:event.clientY,screenX:event.screenX,screenY:event.screenY,metaKey:event.metaKey,altKey:event.altKey,shiftKey:event.shiftKey,ctrlKey:event.ctrlKey,pointerId:event.pointerId,pointerType:event.pointerType,isPrimary:event.isPrimary!==false};
  const copy=new Ctor('pointerdown',init);
  if(copy.pointerId!==event.pointerId)Object.defineProperty(copy,'pointerId',{value:event.pointerId});
  if(event.isPrimary!==undefined&&copy.isPrimary!==event.isPrimary)Object.defineProperty(copy,'isPrimary',{value:event.isPrimary});
  element.dispatchEvent(copy);return true;
 }
 // Live grabs the nearest velocity stem: a stem is a 2 px line (its head 8 px), so a press in the lane that misses
 // the line by a few pixels — the common case with a real mouse — goes to the closest stem within STEM_HIT_PX.
 // A press on empty lane space farther from every stem does nothing.
 const STEM_HIT_PX=6;
 function grabNearestStem(event){
  if(state.kind!=='midi'||event.button!==0||event.isPrimary===false||!Number.isFinite(event.clientX))return false;
  const lane=event.target.closest?.('#piano #velocity-grid');if(!lane||event.target.closest('.velocity-bar'))return false;
  const box=lane.getBoundingClientRect();if(box.height>0&&(event.clientY<box.top||event.clientY>box.bottom))return false;
  let best=null,distance=Infinity;
  for(const bar of lane.querySelectorAll('.velocity-bar[data-velocity]')){const rect=bar.getBoundingClientRect();if(!(rect.width>0)&&!(rect.height>0))continue;const d=Math.abs(event.clientX-(rect.left+rect.width/2));if(d<distance){distance=d;best=bar;}}
  return best&&distance<=STEM_HIT_PX?redeliver(event,best):false;
 }
 // Live: dragging a note's LEFT edge (same hot zone) moves its start and keeps its end — the selected notes when
 // the grabbed note is selected. Snapped to the active grid; previewed in place; ONE edit (start + duration
 // together, one undo step) through app.js's note write path on release. Esc / pointercancel restore.
 let trim=null;
 function trimNoteStart(event){
  if(trim||state.kind!=='midi'||state.drawMode||event.button!==0||event.isPrimary===false||event.metaKey||event.altKey||event.ctrlKey||event.shiftKey)return false;
  const element=event.target.closest?.('#piano .piano-note[data-note]');if(!element||event.target.classList.contains('note-resize'))return false;
  const p=api.pattern(),c=api.channel(),grid=pianoGrid(),note=(p?.notes?.[c?.id]||[]).find(item=>item.id===element.dataset.note);if(!note||!grid||!api.editNotes)return false;
  const {barWidth}=api.pianoGeometry(),width=note.duration/4*barWidth,offset=event.clientX-(grid.getBoundingClientRect().left+note.start/4*barWidth),zone=noteEdgeZones(width).left;if(!(width>0)||!(zone>0)||!(offset>=-.5)||offset>zone)return false;
  event.preventDefault();event.stopPropagation();
  const selected=api.selectedNoteIds(),ids=selected.includes(note.id)?selected:[note.id];
  if(!(selected.length===ids.length&&ids.every(id=>selected.includes(id))))api.selectNotes?.(ids);
  const group=(api.pattern().notes[c.id]||[]).filter(item=>ids.includes(item.id)).map(item=>({...item})),snap=api.snapBeats?.(),grid0=snap>0?snap:1/96;
  const nodes=new Map(group.map(item=>[item.id,doc.querySelector(`#piano .piano-note[data-note="${win.CSS?.escape?win.CSS.escape(item.id):item.id}"]`)]));const styles=new Map([...nodes].map(([id,node])=>[id,node?.style.cssText]));
  const pointerId=event.pointerId,x0=event.clientX;let updates=new Map();
  const compute=clientX=>{
   const target=note.start+(clientX-x0)/barWidth*4,snapped=Math.round(target/grid0)*grid0,delta=snapped-note.start,next=new Map();
   for(const item of group){const end=item.start+item.duration,start=Math.round(Math.max(0,Math.min(end-Math.min(grid0,item.duration),item.start+delta))*1e9)/1e9;if(Math.abs(start-item.start)>1e-9)next.set(item.id,{start,duration:Math.round((end-start)*1e9)/1e9});}
   return next;
  };
  const paint=()=>{for(const [id,node]of nodes){if(!node)continue;node.style.cssText=styles.get(id);const update=updates.get(id);if(update){node.style.left=`calc(${update.start/4} * var(--bar))`;node.style.width=`calc(${update.duration/4} * var(--bar))`;}}};
  const move=sample=>{if(sample.pointerId!==pointerId||!Number.isFinite(sample.clientX))return;updates=compute(sample.clientX);paint();};
  const finish=(commit,sample)=>{
   if(sample&&sample.pointerId!==pointerId)return;if(!trim)return;trim=null;
   for(const type of ['pointermove','pointerup','pointercancel'])doc.removeEventListener(type,handlers[type],true);win.removeEventListener('keydown',onEscape,true);try{element.releasePointerCapture?.(pointerId);}catch{}
   if(commit&&sample&&Number.isFinite(sample.clientX))updates=compute(sample.clientX);
   if(!commit||!updates.size){updates=new Map();paint();return;}
   const final=updates;try{api.editNotes(targets=>{const changed=targets.filter(item=>final.has(item.id)).map(item=>({...item,...final.get(item.id)}));return changed.length?{changed}:null;});}catch(error){api.fail?.(error);updates=new Map();paint();}
  };
  const handlers={pointermove:move,pointerup:sample=>finish(true,sample),pointercancel:sample=>finish(false,sample)};
  const onEscape=key=>{if(key.key==='Escape'){key.preventDefault();key.stopImmediatePropagation();finish(false);}};
  trim={pointerId};try{element.setPointerCapture?.(pointerId);}catch{}
  for(const type of ['pointermove','pointerup','pointercancel'])doc.addEventListener(type,handlers[type],true);win.addEventListener('keydown',onEscape,true);
  return true;
 }
 root.addEventListener('pointerdown',event=>{
  // Live: click/drag in the note editor's ruler (scrub area) auditions the notes under the time position.
  if(event.target.closest?.('#piano-ruler')&&event.button===0&&event.isPrimary!==false&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&state.kind==='midi'){if(api.scrubRuler?.(event)){event.stopPropagation();}return;}
  if(routeNoteEdge(event)||trimNoteStart(event)||grabNearestStem(event))return;
  const note=event.target.closest?.('#piano .piano-note[data-note]');
  if(note&&event.button===0&&event.isPrimary!==false){
   // Live: ⌘-drag on a note changes its velocity (vertical drag).
   if(event.metaKey&&!event.altKey&&!event.shiftKey&&!event.ctrlKey){event.stopPropagation();api.noteVelocityDrag(event,note);return;}
   // Live Draw Mode: clicking a note deletes it (dragging erases along the stroke).
   if(state.drawMode&&!event.metaKey&&!event.altKey&&!event.shiftKey&&!event.ctrlKey&&!event.target.classList.contains('note-resize')){event.stopPropagation();api.eraseStroke(event);return;}
  }
 },true);
 // Live note context menu (Cut, Copy, Paste, Duplicate, Delete, Deactivate, Quantize, Split, Note Properties…).
 root.addEventListener('contextmenu',event=>{if(state.kind!=='midi')return;const note=event.target.closest?.('#piano .piano-note[data-note]');if(!note||!api.noteMenu)return;event.stopPropagation();try{api.noteMenu(event,note.dataset.note);}catch(error){api.fail(error);}},true);
 // Live: double-click on empty grid adds a note one grid step long; double-click a note deletes it.
 root.addEventListener('dblclick',event=>{
  const grid=pianoGrid();if(!grid||state.kind!=='midi'||state.drawMode)return;
  const note=event.target.closest?.('#piano .piano-note[data-note]');
  if(note){event.preventDefault();event.stopPropagation();api.deleteNotes([note.dataset.note]);return;}
  if(event.target!==grid)return;event.preventDefault();event.stopPropagation();
  const rect=grid.getBoundingClientRect(),{barWidth,rowHeight}=api.pianoGeometry(),beat=(event.clientX-rect.left)/barWidth*4,pitch=api.notePitchAtRow?api.notePitchAtRow((event.clientY-rect.top)/rowHeight):127-Math.floor((event.clientY-rect.top)/rowHeight),grid0=gridBeats();
  if(!Number.isFinite(beat)||beat<0||!(pitch>=0&&pitch<=127))return;
  const start=state.snap?Math.floor(beat/grid0+1e-9)*grid0:Math.round(beat*96)/96;
  api.addNote({id:api.newId(),pitch,start:Math.round(start*1e9)/1e9,duration:grid0,velocity:100/127});
 },true);
 // Fold rows audition through the devices lane's one pad-audition function (Studio Pro's sample_preview over
 // mozart-control, REST fallback inside it). Without it (devices not loaded) the inherited preview is used.
 // The returned voice is released at once: one-shot samples ignore it, instrument notes keep their minimum length.
 function auditionPad(id){
  const audition=win.ablDevices?.auditionPad;
  if(typeof audition==='function'){let voice;try{voice=audition.call(win.ablDevices,id);}catch(error){api.fail?.(error);return null;}if(voice){try{voice.stop?.();}catch{}return voice.route||'devices';}}
  api.previewChannel?.(id);return 'preview';
 }
 // Fold rows: clicking a pad name selects that pad (and auditions it), as Live's Drum Rack rows do.
 root.addEventListener('click',event=>{
  const name=event.target.closest?.('#rack .rack-channel .channel-name');if(!name||event.button!==0||state.kind!=='drum'||root.hidden)return;
  const row=name.closest('.rack-channel'),id=row?.dataset.channel;if(!id)return;
  event.preventDefault();event.stopPropagation();api.selectChannel(id);if((event.detail??1)<=1)auditionPad(id);
  win.dispatchEvent(new win.CustomEvent('abl:pad-select',{detail:{channelId:id,source:'clip'}}));
 },true);

 // ---- focus + keys ----
 // Focus = the pointer was last pressed inside the Clip View. The region matters because the Drum
 // Rack fold (#rack) is hosted here too: its own keys (⌫ clears the selected pad rows, ⌘C/⌘V…) must
 // reach the inherited rack handlers untouched.
 const onPointerDown=event=>{const target=event.target;state.focused=!root.hidden&&root.contains(target);state.region=!state.focused?null:target.closest?.('#rack')?'rack':target.closest?.('#piano')?'piano':'panel';};
 doc.addEventListener('pointerdown',onPointerDown,true);
 // User scroll intent in the note editor (see holdFit): a wheel / trackpad scroll or zoom; a press on the scroller
 // itself (its scrollbar), the keys or the navigator; any scroll while a press in the editor is held (drag autoscroll).
 let pianoPress=false;
 const onViewPress=event=>{const target=event.target;if(root.hidden||!target?.closest?.('#piano'))return;pianoPress=true;if(target.id==='piano-scroll'||target.closest('#piano-keys,.piano-navigator,#piano-navigator'))markUserView();};
 const onViewRelease=()=>{pianoPress=false;};
 root.addEventListener('pointerdown',onViewPress,true);doc.addEventListener('pointerup',onViewRelease,true);doc.addEventListener('pointercancel',onViewRelease,true);
 root.addEventListener('wheel',event=>{if(event.target?.closest?.('#piano'))markUserView();},{capture:true,passive:true});
 root.addEventListener('scroll',event=>{if(event.target?.id==='rack-channels'&&state.kind==='drum')return queueSync();if(event.target?.id!=='piano-scroll')return;if(pianoPress)markUserView();else if(state.fitKey&&state.userScrolled!==state.fitKey)queueSync();},true);
 const focusedPane=()=>{try{return win.vegetableStudio?.windows?.focusedWindow?.id||null;}catch{return null;}};
 const pianoKind=()=>state.kind==='midi'&&editorShown('piano')&&state.region!=='rack'&&focusedPane()!=='rack';
 const hasNotes=()=>api.selectedNoteIds().length>0;
 // Inherited typing layers that still own plain letters: the Logic Musical Typing window (when open) owns every
 // letter; the legacy typing piano (when lit) owns its non-tool letters. The inherited FL tool letters
 // (P D C E S T Z Y) are never notes or tools in Live: they stay consumed no-ops.
 const INHERITED_TOOL_LETTERS='pdcestzy';
 const legacyTypingKey=lower=>{const typing=api.legacyTyping?.();return typing==='window'||typing==='piano'&&!INHERITED_TOOL_LETTERS.includes(lower);};
 const onKeyDown=event=>{
  adoptShownEditor();
  // Focus: the pointer was last pressed here, or the note editor is the frontmost pane.
  if(!(state.focused||state.region==null&&focusedPane()==='piano')||root.hidden||event.defaultPrevented||event.isComposing||textTarget(event.target)||api.dialogOpen?.(event))return;
  // Live (Mac) commands are ⌘ only; Ctrl chords stay with the inherited layer (Ctrl+U chop, Ctrl+D …).
  if(event.ctrlKey&&!event.metaKey)return;
  const meta=event.metaKey,key=event.key,lower=String(key).toLowerCase();let handled=true;
  if(['PageUp','PageDown','Home','End'].includes(key)&&pianoKind())markUserView();
  // Fold off (Drum Rack notes): ⌫ deletes the selected notes; ← → move them one step, ↑ ↓ one pad row; ⌘A selects all.
  const unfoldKeys=state.kind==='drum'&&state.unfold&&state.region!=='rack'&&!drumNotes.dragging,unfoldSelected=unfoldKeys&&drumNotes.selection.length>0;
  if(unfoldSelected&&!meta&&!event.altKey&&!event.shiftKey&&(key==='Backspace'||key==='Delete')){if(!event.repeat)drumNotes.deleteSelected();}
  else if(unfoldSelected&&!meta&&!event.altKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key))drumNotes.move(key==='ArrowLeft'?{dIndex:-1}:key==='ArrowRight'?{dIndex:1}:{dRow:key==='ArrowUp'?-1:1});
  else if(unfoldKeys&&meta&&!event.altKey&&!event.shiftKey&&lower==='a')drumNotes.selectAll();
  else if(unfoldSelected&&key==='Escape'&&!meta){drumNotes.clearSelection();handled=false;}
  else if(meta&&!event.altKey&&!event.shiftKey&&key==='1')setGrid(stepLiveGrid(state.grid,-1));
  else if(meta&&!event.altKey&&!event.shiftKey&&key==='2')setGrid(stepLiveGrid(state.grid,1));
  else if(meta&&!event.altKey&&!event.shiftKey&&key==='3')setGrid(toggleLiveTriplet(state.grid));
  else if(meta&&!event.altKey&&!event.shiftKey&&key==='4'){state.snap=!state.snap;gridApplied=true;applyGrid();api.toast?.(`Snap to Grid ${state.snap?'on':'off'}`);}
  else if(meta&&!event.altKey&&!event.shiftKey&&lower==='u'&&pianoKind()){if(!event.repeat)transform('quantize');}
  // Live: ⌘⇧U Quantize Settings — choose the quantize grid, then quantize (the choice becomes the editor grid).
  else if(meta&&!event.altKey&&event.shiftKey&&lower==='u'&&pianoKind()){if(!event.repeat)quantizeSettings();}
  // Live: ⌘J joins the selected notes of each pitch into one note.
  else if(meta&&!event.altKey&&!event.shiftKey&&lower==='j'&&pianoKind()){if(!event.repeat){if(api.selectedNoteIds().length<2||!api.editNotes(targets=>joinNotes(targets)))api.toast?.('Join: select two or more notes of the same pitch.');}}
  // Live: ⌘↑ / ⌘↓ change the selection's velocity by 10 (⇧: by 1).
  else if(meta&&!event.altKey&&(key==='ArrowUp'||key==='ArrowDown')&&pianoKind()&&api.selectedNoteIds().length){api.editNotes(targets=>{const next=stepVelocity(targets,(key==='ArrowUp'?1:-1)*(event.shiftKey?1:10));return sameNotes(targets,next)?null:{changed:next};});}
  // Live: ⌘⇧A inverts the note selection.
  else if(meta&&!event.altKey&&event.shiftKey&&lower==='a'&&pianoKind()){if(!event.repeat){const ids=invertSelection(clipNotes().map(note=>note.id),api.selectedNoteIds());api.selectNotes(ids);paintRulerMarkers();}}
  // Live: ⌘5 switches the editor grid between Fixed and Zoom-Adaptive.
  else if(meta&&!event.altKey&&!event.shiftKey&&key==='5'&&pianoKind()){if(!event.repeat)setGridMode(state.gridMode==='adaptive'?'fixed':'adaptive');}
  // Live: W fits the clip to the editor width, H fits the notes to its height, Z zooms to the selected notes, X zooms back.
  else if(!meta&&!event.altKey&&!event.shiftKey&&'whzx'.includes(lower)&&lower.length===1&&pianoKind()&&!midiKeyboard?.enabled&&!legacyTypingKey(lower)){if(!event.repeat)editorZoomKey(lower);}
  // Live: ⌥↑ / ⌥↓ select the next / previous note in time, ⌥← / ⌥→ the previous / next note of the same pitch.
  else if(event.altKey&&!meta&&!event.shiftKey&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)&&pianoKind()){selectNeighbourNote(key);}
  // Live: Home / End scroll the editor to the clip start / end.
  else if(!meta&&!event.altKey&&!event.shiftKey&&(key==='Home'||key==='End')&&pianoKind()){const scroller=doc.getElementById('piano-scroll'),p=api.pattern();if(scroller&&p){markUserView();scroller.scrollLeft=key==='Home'?0:Math.max(0,api.patternBeats(p)/4*api.pianoGeometry().barWidth-scroller.clientWidth*.9);}}
  // Live: K toggles Highlight Scale.
  else if(!meta&&!event.altKey&&!event.shiftKey&&lower==='k'&&pianoKind()&&!midiKeyboard?.enabled&&!legacyTypingKey(lower)){if(!event.repeat){state.scaleOn=!state.scaleOn;paintScale();}}
  // Live: F Fold to Notes, G Fold to Scale (the Fold / Scale buttons).
  else if(!meta&&!event.altKey&&!event.shiftKey&&(lower==='f'||lower==='g')&&pianoKind()&&!midiKeyboard?.enabled&&!legacyTypingKey(lower)){if(!event.repeat)action(lower==='f'?'fold':'scale-mode')?.click();}
  // Live: ⌘E splits the selected notes (or every note) at the insert marker; ⌘V pastes at the insert marker.
  else if(meta&&!event.altKey&&!event.shiftKey&&lower==='e'&&pianoKind()){if(!event.repeat)api.splitNotes?.();}
  else if(meta&&!event.altKey&&!event.shiftKey&&lower==='v'&&pianoKind()&&api.pasteNotes){if(!event.repeat)api.pasteNotes();}
  else if(meta&&!event.altKey&&!event.shiftKey&&lower==='d'&&pianoKind()&&hasNotes()){if(!event.repeat)api.duplicateNotes();}
  else if(!meta&&!event.altKey&&!event.shiftKey&&lower==='b'){if(!event.repeat)setDrawMode(!state.drawMode);}
  // Live: + / − zoom the note editor around its centre (view-only).
  else if(!meta&&!event.altKey&&(key==='+'||key==='='&&!api.legacyTyping?.()||key==='-'||key==='_'||event.code==='NumpadAdd'||event.code==='NumpadSubtract')&&pianoKind()){markUserView();api.zoomNotes?.(key==='-'||key==='_'||event.code==='NumpadSubtract'?1/1.25:1.25);}
  // Live: Esc deselects the notes (it still reaches the inherited layer, which cancels any gesture).
  else if(key==='Escape'&&!meta&&!event.altKey&&pianoKind()){api.clearNoteSelection?.();handled=false;}
  // Live has no tool letters: only B (draw), A (automation), M (MIDI keyboard) and 0 act here. The inherited
  // FL/Logic letters (P D E S T Y C Z …) are consumed as no-ops so they never switch a hidden tool.
  else if(!meta&&!event.altKey&&!event.shiftKey&&key.length===1&&/^[a-z]$/i.test(key)&&!'abm'.includes(lower)&&pianoKind()&&!midiKeyboard?.enabled&&!legacyTypingKey(lower)){}
  else if(!meta&&!event.altKey&&!event.shiftKey&&key==='0'&&pianoKind()&&hasNotes()){if(!event.repeat)api.toggleMuteSelection?.();}
  else if(!meta&&!event.altKey&&!event.shiftKey&&(key==='Backspace'||key==='Delete')&&pianoKind()&&hasNotes()){if(!event.repeat)api.deleteNotes(api.selectedNoteIds());}
  // Fold (Drum Rack) grid: ⌘← / ⌘→ move the selected pad row's steps one step (Pro "Move steps", wrapping);
  // ⇧⌘← / ⇧⌘→ move every row. One edit (one undo step) through the rack rotate.
  else if(meta&&!event.altKey&&(key==='ArrowLeft'||key==='ArrowRight')&&state.kind==='drum'&&!state.unfold&&api.rotateSteps){api.rotateSteps(api.channel()?.id,key==='ArrowRight'?1:-1,{all:event.shiftKey});}
  else if(!meta&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)&&pianoKind()&&api.selectedNoteIds().length){
   // The active snap (Live grid via ⌘1/⌘2, or the editor's snap selector) sets the nudge; ⌥ nudges finer.
   const snap=api.snapBeats?.(),base=snap>0?snap:gridBeats(),step=event.altKey?base/4:base;
   if(key==='ArrowUp'||key==='ArrowDown'){if(transform('transpose',{semitones:(key==='ArrowUp'?1:-1)*(event.shiftKey?12:1)})&&!event.repeat)auditionSelection();}
   else if(event.shiftKey)transform('resize',{beats:key==='ArrowRight'?step:-step});
   else transform('nudge',{beats:key==='ArrowRight'?step:-step});
  }
  else handled=false;
  if(handled){event.preventDefault();event.stopImmediatePropagation();}
 };
 // Logic's Musical Typing (⌘K) is retired: the M computer MIDI keyboard replaces it. Live's ⌘K is Key Map
 // mode, which Disabelton does not offer, so the key is inert (consumed so the inherited window never opens).
 const onRetiredKey=event=>{if(event.defaultPrevented||textTarget(event.target)||api.dialogOpen?.(event))return;const lower=String(event.key).toLowerCase(),code=String(event.code||'');if((event.metaKey||event.ctrlKey)&&!event.altKey&&!event.shiftKey&&(lower==='k'||code==='KeyK')){event.preventDefault();event.stopImmediatePropagation();}};
 const earlyWindow=win===globalThis.window;if(earlyWindow){earlyKeys.keydown.add(onRetiredKey);earlyKeys.keydown.add(onKeyDown);}else{win.addEventListener('keydown',onRetiredKey,true);win.addEventListener('keydown',onKeyDown,true);}

 // ---- computer MIDI keyboard ----
 const paintMidiKeys=()=>{const held=midiKeyboard?.heldPitches()||new Set();for(const key of doc.querySelectorAll('#piano-keys .piano-key'))key.classList.toggle('abl-midi-held',held.has(Number(key.dataset.pitch)));};
 // Live: the computer keyboard plays the SELECTED TRACK (api.keyboardTarget); Drum Rack pads go through the devices
 // lane's pad audition, like the Fold rows. Piano-key clicks keep auditioning the open clip's channel (app.js).
 const midiHint=text=>{const node=doc.querySelector('#hint');if(node)node.textContent=text;};
 // ---- MIDI record take: armed (● Rec) + transport rolling → captured notes, one edit per take ----
 const takeInfo=()=>{const p=api.pattern(),placed=placementClip();return{patternBeats:api.patternBeats(p),clipStart:placed?placed.start:0,grid:state.snap?gridBeats():0,linear:!!state.takeLinear&&!!placed};};
 let takeTimer=null;
 const take={active:()=>state.midiRec&&state.kind==='midi'&&!!api.transportPlaying?.(),beat:()=>api.transportBeat?.(),
  commit:events=>{const info=takeInfo(),notes=midiTakeNotes(events,info);clearLiveTake();if(!notes.length)return;try{api.addTakeNotes?.(notes,{linear:info.linear,clipId:info.linear?state.clipId:null});api.toast?.(`Recorded ${notes.length} note${notes.length===1?'':'s'}`);}catch(error){api.fail(error);}sync();}};
 // Owner bug 5: while the take runs the notes show as they are played and the clip grows with the playhead (Live),
 // instead of appearing only when the take ends. Display only: the take is still committed as ONE edit at the end.
 let liveFrame=null,liveLayer=null,liveClip=null;
 function clearLiveTake(){if(liveFrame!==null){win.cancelAnimationFrame?.(liveFrame);liveFrame=null;}liveLayer?.remove();liveLayer=null;if(liveClip){liveClip.style.removeProperty('min-width');liveClip.classList.remove('abl-midi-recording');liveClip.querySelector(':scope > .abl-live-mini')?.remove();liveClip=null;}}
 function paintLiveTake(){
  liveFrame=null;if(!take.active()){clearLiveTake();return;}
  const grid=doc.getElementById('piano-grid'),info=takeInfo(),now=Number(take.beat());
  if(grid&&Number.isFinite(now)){
   if(!liveLayer||liveLayer.parentElement!==grid){liveLayer?.remove();liveLayer=doc.createElement('div');liveLayer.className='abl-live-take';liveLayer.setAttribute('aria-hidden','true');grid.append(liveLayer);}
   const events=midiKeyboard.takeEvents||[],shown=midiTakeNotes(events.map(event=>({...event,off:event.off??Math.max(now,event.on+.0625)})),{...info,grid:0});
   while(liveLayer.children.length>shown.length)liveLayer.lastChild.remove();
   shown.forEach((note,index)=>{let node=liveLayer.children[index];if(!node){node=doc.createElement('div');node.className='piano-note abl-live-note';liveLayer.append(node);}
    const key=doc.querySelector(`#piano-keys .piano-key[data-pitch="${note.pitch}"]`);node.hidden=!key;if(!key)return;
    node.style.left=`calc(${note.start/4} * var(--bar))`;node.style.width=`calc(${note.duration/4} * var(--bar))`;node.style.top=`${key.offsetTop}px`;node.style.height=`${key.offsetHeight}px`;});
   // The Arrangement clip grows with the playhead while a linear take runs past its end.
   const placed=info.linear?placementClip():null;
   if(placed){const element=doc.querySelector(`#playlist .clip[data-clip="${String(state.clipId).replace(/"/g,'\\"')}"]`);if(element!==liveClip){if(liveClip){liveClip.style.removeProperty('min-width');liveClip.classList.remove('abl-midi-recording');}liveClip=element;}
    if(liveClip){liveClip.classList.add('abl-midi-recording');if(now>placed.start+placed.length)liveClip.style.minWidth=`calc(${(now-placed.start)/4} * var(--bar))`;
     // Round 3: the Arrangement clip shows the take's notes as they are played (Live's miniature note display).
     let mini=liveClip.querySelector(':scope > .abl-live-mini');if(!mini){mini=doc.createElement('div');mini.className='abl-live-mini';mini.setAttribute('aria-hidden','true');liveClip.append(mini);}
     const boxes=miniNoteLayout(shown,Math.max(placed.length,now-placed.start,.25));
     while(mini.children.length>boxes.length)mini.lastChild.remove();
     boxes.forEach((box,index)=>{let bar=mini.children[index];if(!bar){bar=doc.createElement('i');mini.append(bar);}bar.style.left=`${box.left.toFixed(3)}%`;bar.style.width=`${box.width.toFixed(3)}%`;bar.style.top=`${box.top.toFixed(2)}%`;bar.style.height=`${box.height.toFixed(2)}%`;});}}
  }
  liveFrame=win.requestAnimationFrame?win.requestAnimationFrame(paintLiveTake):null;
 }
 const watchLiveTake=()=>{if(liveFrame===null&&win.requestAnimationFrame)liveFrame=win.requestAnimationFrame(paintLiveTake);};
 let liveWait=null;const watchLiveTakeSoon=()=>{if(liveWait)return;liveWait=win.setInterval(()=>{if(!state.midiRec){win.clearInterval(liveWait);liveWait=null;return;}if(take.active())watchLiveTake();},100);};
 const watchTake=()=>{if(takeTimer)return;takeTimer=win.setInterval(()=>{if(!midiKeyboard.takeEvents.length){win.clearInterval(takeTimer);takeTimer=null;return;}if(!take.active())midiKeyboard.finishTake();},120);};
 function setMidiRecord(on,{linear=false}={}){state.midiRec=!!on;if(on)state.takeLinear=!!linear;if(state.midiRec)watchLiveTakeSoon();const button=action('midi-rec');button.setAttribute('aria-pressed',String(state.midiRec));button.classList.toggle('lit',state.midiRec);if(!state.midiRec){midiKeyboard.finishTake();/* the take is committed with its own mode, then the mode resets */state.takeLinear=false;clearLiveTake();}else{if(!midiKeyboard.enabled)midiKeyboard.toggle(true);api.toast?.('MIDI Record armed: play (Space) and use the computer MIDI keyboard.');}}
 const midiKeyboard=new AblMidiKeyboard({window:win,take:{active:()=>{const on=take.active();if(on)watchTake();return on;},beat:take.beat,commit:take.commit},getChannel:api.channel,getTarget:()=>api.keyboardTarget?.()??null,auditionPad:id=>{const audition=win.ablDevices?.auditionPad;return typeof audition==='function'?audition.call(win.ablDevices,id):null;},onHint:midiHint,startVoice:api.startVoice,onError:api.fail,dialogOpen:api.dialogOpen,onPitches:paintMidiKeys,listen:!earlyWindow});
 if(earlyWindow){earlyKeys.keydown.delete(onKeyDown);earlyKeys.keydown.add(midiKeyboard.keydown);earlyKeys.keydown.add(onKeyDown);earlyKeys.keyup.add(midiKeyboard.keyup);}
 win.ablMidiKeyboard=midiKeyboard;

 // ---- shared events ----
 const onEditorShown=event=>{const kind=event.detail?.kind;if(kind==='step')setKind('drum');else if(kind==='piano')setKind('midi');showLayout();};
 const onPadSelect=event=>{const id=event.detail?.channelId;if(!id||event.detail?.source==='clip')return;api.selectChannel(id);};
 const onDetailShow=event=>{if(event.detail?.view!=='clip'||state.opening)return;if(state.kind==='none')open();else{mount();sync();}};
 const onDrawMode=event=>{if(event.detail?.source==='clip')return;setDrawMode(!!event.detail?.on,{silent:true});};
 const onLayoutReady=()=>{mount();observeSizes();};
 // Shell contract: a double-clicked Arrangement/Session clip (the shell already selected it and its pattern).
 const onClipOpen=event=>{
  const detail=event.detail||{},clip=detail.clipId!=null?api.findClip(detail.clipId):null;state.clipId=clip?detail.clipId:null;
  if(detail.kind==='audio'||clip&&!clip.patternId){if(clip&&openAudio(clip))event.preventDefault();return;}
  if(detail.laneId!=null){const p=api.pattern(),owner=api.project()?.channels?.find(c=>c.laneId===detail.laneId&&(p?.notes?.[c.id]||p?.steps?.[c.id]||p?.cloudSources?.[c.id]!=null))/* Owner bug 5: a new, empty clip has no notes yet: its notes belong to the track's own instrument channel, not to whichever channel was selected before (a take then failed with "Audio has no Freestyle sample or instrument"). */||api.project()?.channels?.find(c=>c.laneId===detail.laneId&&c.type!=='sample');if(owner&&owner.id!==api.channel()?.id)api.selectChannel(owner.id);}
  // Every open fits the clip's notes; only a re-double-click of the clip already showing, after the user scrolled
  // it in this open, keeps the user's view.
  const key=clipKey(),showing=!root.hidden&&state.kind==='midi'&&editorShown('piano')&&layout()?.detailVisible?.()!==false;
  if(!(showing&&key!=null&&state.openKey===key&&state.userScrolled===key)){state.centred=null;state.pending=null;state.userScrolled=null;state.fitKey=key;}
  state.openKey=key;state.openingClip=true;
  try{if(open())event.preventDefault();}finally{state.openingClip=false;}
 };
 doc.addEventListener('disabelton-editor-shown',onEditorShown);doc.addEventListener('abl:clip-open',onClipOpen);
 const unsubscribeLayout=layout()?.onChange?.(value=>{if(state.opening||state.disposed)return;if(value?.detail?.visible&&value.detail.kind==='clip'){mount();if(state.kind==='none')open();}})||null;
 win.addEventListener('abl:pad-select',onPadSelect);win.addEventListener('abl:detail-show',onDetailShow);win.addEventListener('abl:draw-mode',onDrawMode);win.addEventListener('abl:layout-ready',onLayoutReady);

 const view={
  root,open,openAudio,close,sync,mount,setGrid,setDrawMode,transform,ownsScroll,
  get kind(){return state.kind;},/** The Arrangement / Session clip shown (id), or null. */get clipId(){return state.clipId??null;},get unfolded(){return state.kind==='drum'&&!!state.unfold;},setFold(on){if(state.kind==='drum')setUnfold(!on);return state.kind==='drum';},get grid(){return state.grid;},get gridMode(){return state.gridMode;},get snap(){return state.snap;},get drawMode(){return state.drawMode;},
  focused:()=>state.focused&&!root.hidden,focus(){state.focused=true;},selectedNoteIds:()=>api.selectedNoteIds(),
  /** Arm + ● (app.js toggleRecord, abl-record-input.js AblMidiRecordTake): the Clip View ● Rec take on / off. */
  /** Arrangement clip menu ▸ Extend ×2 (abl-shell.js): any pattern clip, not only the open one; one edit. */
  extendClip(clip){const p=clip?.patternId?(project()?.patterns||[]).find(item=>item.id===clip.patternId):null;if(!clip||!p){api.toast?.('Extend works on a pattern (MIDI) clip.');return false;}try{return writePlacement(clip,p,{extend:true});}catch(error){api.fail(error);return false;}finally{sync();}},
  setMidiRecord(on,options){setMidiRecord(on,options);return state.midiRec;},get liveTakeNotes(){return liveLayer?liveLayer.children.length:0;},get liveClipNotes(){return liveClip?.querySelector(':scope > .abl-live-mini')?.children.length||0;},get midiRecording(){return state.midiRec;},
  /** Web MIDI input notes join the same take (they already sound through WebMidiInput; this only captures). */
  captureExternal(on,pitch,velocity,key){return on?midiKeyboard.externalOn(pitch,velocity,key):midiKeyboard.externalOff(key);},
  /** abl-keys.js clip-scope intents: grid-narrow|grid-widen|grid-triplet|grid-snap|quantize|duplicate|deactivate|toggle-draw|delete. Returns true when handled. */
  command(name){
   if(name==='toggle-draw'){setDrawMode(!state.drawMode);return true;}
   if(root.hidden)return false;
   if(name==='grid-narrow'){setGrid(stepLiveGrid(state.grid,-1));return true;}
   if(name==='grid-widen'){setGrid(stepLiveGrid(state.grid,1));return true;}
   if(name==='grid-triplet'){setGrid(toggleLiveTriplet(state.grid));return true;}
   if(name==='grid-snap'){state.snap=!state.snap;gridApplied=true;applyGrid();api.toast?.(`Snap to Grid ${state.snap?'on':'off'}`);return true;}
   if(state.kind==='drum'&&state.unfold&&name==='delete'){drumNotes.deleteSelected();return true;}
   if(!pianoKind())return false;
   if(name==='quantize'){transform('quantize');return true;}
   if(name==='duplicate'){api.duplicateNotes();return true;}
   if(name==='deactivate'){api.toggleMuteSelection?.();return true;}
   if(name==='delete'){api.deleteNotes(api.selectedNoteIds());return true;}
   if(name==='split'){api.splitNotes?.();return true;}
   /* Menu bar (abl-shell.js): Edit ▸ Quantize Settings… / Invert Selection, Options ▸ Fixed Grid — the same paths as ⇧⌘U / ⇧⌘A / ⌘5. */
   if(name==='quantize-settings'){quantizeSettings();return true;}
   if(name==='invert-selection'){const ids=invertSelection(clipNotes().map(note=>note.id),api.selectedNoteIds());api.selectNotes(ids);paintRulerMarkers();return true;}
   if(name==='grid-fixed'){setGridMode(state.gridMode==='adaptive'?'fixed':'adaptive');return true;}
   return false;
  },
  destroy(){state.disposed=true;observer.disconnect();resizeObserver?.disconnect();paneObserver.disconnect();midiKeyboard.destroy();doc.removeEventListener('pointerdown',onPointerDown,true);doc.removeEventListener('pointerup',onViewRelease,true);doc.removeEventListener('pointercancel',onViewRelease,true);earlyKeys.keydown.delete(onKeyDown);earlyKeys.keydown.delete(onRetiredKey);win.removeEventListener('keydown',onRetiredKey,true);earlyKeys.keydown.delete(midiKeyboard.keydown);earlyKeys.keyup.delete(midiKeyboard.keyup);win.removeEventListener('keydown',onKeyDown,true);doc.removeEventListener('disabelton-editor-shown',onEditorShown);doc.removeEventListener('abl:clip-open',onClipOpen);unsubscribeLayout?.();for(const [name,fn]of [['abl:pad-select',onPadSelect],['abl:detail-show',onDetailShow],['abl:draw-mode',onDrawMode],['abl:layout-ready',onLayoutReady]])win.removeEventListener(name,fn);if(win.ablMidiKeyboard===midiKeyboard)delete win.ablMidiKeyboard;},
 };
 win.ablClipView=view;
 // The editors may already be showing (restored layout): adopt that state.
 if(editorShown('piano'))setKind('midi');else if(editorShown('step'))setKind('drum');
 return view;
}
