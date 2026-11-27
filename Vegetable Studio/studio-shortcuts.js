/** Context-aware core FL shortcuts. This module performs no project/audio I/O.
 * Primary reference: Image-Line basics_shortcuts.htm. Ctrl/Cmd+Y is a familiar
 * redo alias; native FL also documents Ctrl/Cmd+Shift+Z in several edit menus.
 */
const editors=new Set(['playlist','piano','rack','mixer']);
const scoreEditors=new Set(['playlist','piano','rack']);
const windows={F5:'playlist',F6:'rack',F7:'piano',F9:'mixer'};
const tools={p:'draw',b:'paint',d:'erase',c:'slice',e:'select',s:'slip',t:'mute',z:'zoom',y:'playback'};
const defaultTools={playlist:['draw','paint','erase','slice','select','mute','zoom','playback'],piano:['draw','paint','erase','slice','select','zoom','playback']};
const editable='input,textarea,dialog,[role="textbox"],[role="searchbox"],[contenteditable]:not([contenteditable="false"])';
const historyTextEntry='input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="color"]):not([type="file"]),textarea,dialog:not([data-modeless]),[role="textbox"],[role="searchbox"],[contenteditable]:not([contenteditable="false"])';

/** Include composed-path nodes so a text field in a shadow root keeps its keys. */
export function studioShortcutBlocked(event,{dialogOpen=false}={}){
 if(!event||event.defaultPrevented||event.isComposing||event.keyCode===229||event.key==='Process'||dialogOpen)return true;
 if(event.getModifierState?.('AltGraph'))return true;
 const path=event.composedPath?.()||[event.target];
 // Native dropdowns retain focus after selection. Bare studio function keys must still
 // reach the studio instead of invoking browser actions such as F7 caret mode.
 // All other select keys and custom combobox editors retain their own input.
 const windowKey=(Object.hasOwn(windows,event.key)||['F1','F2','F4','F8','F10','F12'].includes(event.key))&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey;
 // Pro's desktop transport keeps Space after a native pattern selector or
 // mixer fader retains focus. Text, dialogs and custom editors still own it.
 const transportSpace=(event.code==='Space'||[' ','Spacebar'].includes(event.key))&&!event.altKey&&!event.shiftKey;
 // FL: Cmd/Ctrl+Z is the project's Undo everywhere except text entry. A focused
 // fader/knob/checkbox/button or a modeless plugin window keeps no text history,
 // so it must not swallow Undo/Redo until the user clicks elsewhere.
 const historyKey=(event.ctrlKey||event.metaKey)&&String(event.key||'').toLowerCase()==='z';
 const fieldEditor=historyKey?historyTextEntry:transportSpace?'input:not([type="range"]),textarea,dialog,[role="textbox"],[role="searchbox"],[contenteditable]:not([contenteditable="false"])':editable;
 // A native <select> (Snap, pattern picker) keeps focus after a pick and has
 // no undo of its own: a playlist click that does not take focus must not
 // leave the next Cmd/Ctrl+Z silently swallowed there (QA round 9).
 const selectEditor=windowKey||transportSpace||historyKey?'[role="combobox"]:not(select)':'select,[role="combobox"]';
 return path.some(node=>node?.isContentEditable===true||node?.closest?.(fieldEditor)||node?.closest?.(selectEditor));
}

/** Rows of Image-Line basics_shortcuts.htm that have no engine operation behind
 * them: the key is still bound and answers with the reason. */
export const UNAVAILABLE_SHORTCUTS=Object.freeze({
 'export-mp3':'Freestyle exports WAV only: use File ▸ Export ▸ WAV file (Ctrl+R).',
 'rack-group-selected':'Channel groups are not stored by Freestyle, so channels cannot be grouped.',
 'rack-restretch':'Freestyle stretches audio clips in the cloud: there is no manual restretch.',
 'toggle-blend':'Blend recording is not available: Freestyle note recording always adds to the pattern.',
 'toggle-wait-input':'Wait for input is not available: Freestyle recording starts with the transport (use the countdown, Ctrl+P).',
 'mixer-render-armed':'Rendering armed mixer tracks is not available: use File ▸ Export ▸ WAV file.',
 'mixer-wave-view':'The waveform meter view is not available: Freestyle streams peak meters only.',
 'mixer-save-state':'Mixer track state files are not available in Freestyle.',
 'playlist-performance-zoom':'Performance mode is not available in Freestyle.',
 'playlist-consolidate':'Consolidating clips to audio is not available: Freestyle has no bounce-in-place operation.',
 'grid-color':'The grid colour follows the theme (Options ▸ Theme).',
 'toggle-resize-left':'Resizing from the left is always on: drag a clip’s or note’s left edge.',
 'playlist-stretch-mode':'Audio clip stretch modes are not available in Freestyle.',
 'toggle-performance-mode':'Performance mode is not available in Freestyle.',
 'piano-next-property':'The event lane shows note velocity only (Freestyle notes have no other per-note lanes).',
 'piano-keyboard-view':'The Piano roll keyboard has one view mode.',
 'piano-toggle-portamento':'Portamento notes are not available: Freestyle notes have a slide flag only (S).',
 'piano-note-helpers':'Note helpers follow the scale highlighting button in the Piano roll toolbar.',
 'piano-change-color':'Note colours (MIDI channel colour groups) are not stored by Freestyle notes.',
 'piano-select-by-color':'Note colours (MIDI channel colour groups) are not stored by Freestyle notes.',
 'piano-waveform-helper':'The waveform helper view is not available in the Piano roll.',
 'piano-riff-machine':'Riff machine is not available in Vegetable Studio.',
 'piano-claw-machine':'Claw machine is not available in Vegetable Studio.',
 'piano-insert-controller-value':'There is no event controller lane to insert a value into: automate with an automation clip.',
 'piano-paste-midi-clipboard':'The system MIDI clipboard is not readable from a browser: use Ctrl+M to import a MIDI file.',
 'piano-group':'Note groups are not stored by Freestyle notes.',
 'piano-ungroup':'Note groups are not stored by Freestyle notes.',
 'piano-select-random-groups':'Note groups are not stored by Freestyle notes.'
});

/** basics_shortcuts.htm rows that the older rules below do not cover. Pure. */
function resolveFlTableShortcut(event,{editor,key,lower,modifier,shift,alt,typing,intent}){
 const code=String(event.code||''),plain=!modifier&&!alt&&!shift,unavailable=feature=>intent('unavailable',{feature,reason:UNAVAILABLE_SHORTCUTS[feature]});
 const digit=/^Digit(\d)$/.exec(code)?.[1]??(plain&&/^\d$/.test(key)&&!code.startsWith('Numpad')?key:null),numpad=/^Numpad(\d)$/.exec(code)?.[1]??null;
 const arrow={ArrowLeft:-1,ArrowRight:1}[key]??0,vertical={ArrowUp:-1,ArrowDown:1}[key]??0;
 // Pattern selector and transport (numeric keypad).
 if(plain&&numpad&&numpad!=='0')return intent('select-pattern-number',{number:Number(numpad)});
 if(plain&&code==='NumpadAdd')return intent('pattern-step',{direction:1});
 if(plain&&code==='NumpadSubtract')return intent('pattern-step',{direction:-1});
 if(plain&&code==='Numpad0')return{...intent('transport-fast-forward'),repeatable:true};
 if(plain&&code==='NumpadMultiply')return{...intent('transport-bar',{direction:1}),repeatable:true};
 if(plain&&code==='NumpadDivide')return{...intent('transport-bar',{direction:-1}),repeatable:true};
 if(!modifier&&alt&&!shift&&['NumpadMultiply','NumpadDivide'].includes(code))return intent('marker-jump',{editor,direction:code==='NumpadMultiply'?1:-1});
 // File.
 if(!modifier&&alt&&!shift&&digit!==null&&editor!=='piano')return intent('open-recent',{index:Number(digit)});
 if(modifier&&!alt&&!shift&&lower==='n')return intent('save-new-version');
 if(modifier&&!alt&&!shift&&lower==='r')return intent('export-wav');
 if(modifier&&!alt&&shift&&lower==='r')return unavailable('export-mp3');
 if(modifier&&!alt&&shift&&lower==='m')return intent('export-midi');
 if(modifier&&!alt&&shift&&lower==='h')return intent('arrange-windows');
 // Window navigation.
 if(plain&&key==='F11')return intent('project-info');
 if(plain&&key==='Enter'){
  const path=event.composedPath?.()||[event.target];
  if(path.some(node=>node?.closest?.('button,a[href],summary,[role="button"],[role="menuitem"],[role="option"],[role="treeitem"],[role="tab"],.context-menu')))return null;
  return intent('toggle-max-playlist');
 }
 // Record / transport toggles without an engine operation.
 if(modifier&&!alt&&!shift&&lower==='b'&&!['playlist','piano'].includes(editor))return unavailable('toggle-blend');
 if(modifier&&!alt&&!shift&&lower==='i')return unavailable(editor==='piano'?'piano-insert-controller-value':'toggle-wait-input');
 if(editor==='rack'){
  if(plain&&digit!==null&&!typing)return intent('rack-mute-channel',{index:digit==='0'?9:Number(digit)-1});
  if(modifier&&!alt&&!shift&&digit!==null)return intent('rack-solo-channel',{index:digit==='0'?9:Number(digit)-1});
  if(plain&&vertical)return{...intent('rack-select-channel',{direction:vertical}),repeatable:true};
  if(!modifier&&!alt&&shift&&vertical)return{...intent('rack-move-selection',{direction:vertical}),repeatable:true};
  if(plain&&['PageUp','PageDown'].includes(key))return intent('rack-channel-group',{direction:key==='PageUp'?1:-1});
  if(!modifier&&alt&&!shift&&code==='KeyG')return unavailable('rack-group-selected');
  if(!modifier&&alt&&!shift&&code==='KeyM')return intent('rack-toggle-mixer-selectors');
  if(!modifier&&alt&&!shift&&code==='KeyU')return intent('rack-unzip-all');
  if(!modifier&&alt&&!shift&&code==='KeyZ')return intent('rack-zip-selected');
  if(modifier&&alt&&!shift&&code==='KeyR')return unavailable('rack-restretch');
 }
 if(editor==='mixer'){
  if(plain&&lower==='s'&&!typing)return intent('mixer-solo');
  if(!modifier&&alt&&!shift&&code==='KeyS')return intent('mixer-alt-solo');
  if(!modifier&&alt&&!shift&&code==='KeyL')return intent('mixer-select-linked-channels');
  if(!modifier&&alt&&!shift&&arrow)return intent('mixer-move-track',{direction:arrow});
  if(!modifier&&alt&&!shift&&code==='KeyR')return unavailable('mixer-render-armed');
  if(!modifier&&alt&&!shift&&code==='KeyW')return unavailable('mixer-wave-view');
  if(modifier&&!alt&&!shift&&lower==='a')return intent('select-all',{editor});
  if(modifier&&!alt&&shift&&lower==='l')return intent('link-channels-from-mixer',{editor});
  if(modifier&&!alt&&shift&&lower==='s')return unavailable('mixer-save-state');
  if(modifier&&!alt&&!shift&&key==='Enter')return intent('mixer-toggle-properties');
 }
 if(editor==='playlist'||editor==='piano'){
  if(modifier&&alt&&!shift&&code==='KeyG')return unavailable('grid-color');
  if(modifier&&alt&&!shift&&key==='Home')return unavailable('toggle-resize-left');
  if(modifier&&!alt&&!shift&&arrow&&editor==='playlist')return intent('select-time',{editor,direction:arrow});
  if(modifier&&!alt&&!shift&&key==='Enter')return intent('select-time-around',{editor});
  if(!modifier&&!alt&&shift&&code==='Digit0')return intent('center-playhead',{editor});
  if(!modifier&&!alt&&shift&&['Digit1','Digit2','Digit3'].includes(code))return intent('zoom-level',{editor,level:Number(code.slice(5))});
  if(!modifier&&!alt&&shift&&code==='Digit4'&&editor==='piano')return intent('zoom-all',{editor});
  if(!modifier&&!alt&&shift&&code==='Digit5')return intent('zoom-selection',{editor});
  if(!modifier&&alt&&shift&&code==='KeyT')return intent('time-signature',{editor});
 }
 if(editor==='playlist'){
  if(plain&&!typing&&digit==='5')return intent('zoom-selection',{editor});
  if(plain&&!typing&&digit==='6')return unavailable('playlist-performance-zoom');
  if(plain&&!typing&&(digit==='7'||digit==='8'))return intent('playlist-transpose',{semitones:digit==='7'?-1:1});
  if(plain&&!typing&&digit==='9')return intent('playlist-reverse');
  if(plain&&key==='Insert')return intent('playlist-slice-at-cursor');
  if(!modifier&&alt&&!shift&&code==='KeyG')return intent('playlist-ungroup');
  if(!modifier&&alt&&code==='KeyM')return intent('playlist-mute-selection',{mute:!shift});
  if(!modifier&&alt&&!shift&&code==='KeyP')return intent('toggle-picker-panel');
  if(modifier&&alt&&code==='KeyC')return unavailable('playlist-consolidate');
  if(modifier&&!alt&&!shift&&key==='F8')return intent('project-picker');
  if(!modifier&&!alt&&shift&&code==='Digit6')return unavailable('playlist-performance-zoom');
  if(!modifier&&!alt&&shift&&code==='KeyC')return intent('playlist-select-by-source');
  if(!modifier&&!alt&&shift&&code==='KeyG')return intent('playlist-group');
  if(!modifier&&!alt&&shift&&code==='KeyM')return unavailable('playlist-stretch-mode');
  if(!modifier&&!alt&&shift&&code==='KeyQ')return intent('playlist-quick-quantize');
 }
 if(editor==='piano'){
  if(plain&&!typing&&lower==='f')return unavailable('piano-next-property');
  if(!modifier&&!alt&&shift&&code==='KeyF')return unavailable('piano-next-property');
  if(plain&&!typing&&['g','h','j','k'].includes(lower))return intent('piano-select-channel',{direction:lower==='g'||lower==='h'?-1:1,withNotes:lower==='h'||lower==='j'});
  if(!modifier&&!alt&&shift&&(code==='KeyH'||code==='KeyK'))return intent('piano-select-channel',{direction:1,withNotes:code==='KeyH'});
  if(plain&&!typing&&lower==='m')return unavailable('piano-keyboard-view');
  if(plain&&!typing&&lower==='o')return unavailable('piano-toggle-portamento');
  if(!modifier&&alt&&!shift&&code==='KeyB')return unavailable('piano-note-helpers');
  if(!modifier&&alt&&!shift&&code==='KeyC')return unavailable('piano-change-color');
  if(!modifier&&alt&&!shift&&code==='KeyE')return unavailable('piano-riff-machine');
  if(!modifier&&alt&&!shift&&code==='KeyG')return unavailable('piano-ungroup');
  if(!modifier&&alt&&!shift&&code==='KeyN')return unavailable('piano-waveform-helper');
  if(!modifier&&alt&&!shift&&code==='KeyW')return unavailable('piano-claw-machine');
  if(modifier&&!alt&&!shift&&(key==='Insert'||key==='Delete'))return intent(key==='Insert'?'piano-insert-space':'piano-delete-space',{editor});
  if(modifier&&!alt&&!shift&&arrow)return intent('select-time',{editor,direction:arrow});
  if(!modifier&&!alt&&shift&&code==='KeyC')return unavailable('piano-select-by-color');
  if(modifier&&!alt&&shift&&code==='KeyV')return unavailable('piano-paste-midi-clipboard');
  if(!modifier&&!alt&&shift&&code==='KeyG')return unavailable('piano-group');
  if(!modifier&&!alt&&shift&&code==='KeyM')return unavailable('piano-select-random-groups');
  if(!modifier&&!alt&&shift&&code==='KeyN')return intent('piano-chord-off');
  if(!modifier&&!alt&&shift&&code==='KeyR')return intent('piano-select-random');
 }
 return null;
}

/** Return an intent, never execute it. Editing/toggle intents are edge-triggered;
 * view-only Page-key zoom explicitly permits keyboard auto-repeat.
 * Playlist Slip requires explicit availableTools support. Piano S is FL's
 * Slide tool and Piano T its Mute tool (Freestyle note `slide` / `muted`
 * flags); the Playlist keeps T = Mute and S = Slip. Tool keys win over the typing keyboard
 * only in a focused Playlist or Piano roll.
 */
export function resolveStudioShortcut(event,context={}){
 if(studioShortcutBlocked(event,context))return null;
 const editor=editors.has(context.editor)?context.editor:null,key=String(event.key||''),lower=key.toLowerCase(),modifier=!!(event.ctrlKey||event.metaKey),shift=!!event.shiftKey,alt=!!event.altKey;
 const intent=(command,fields={})=>({command,...fields,repeatable:false});
 const flIntent=resolveFlTableShortcut(event,{editor,key,lower,modifier,shift,alt,typing:context.typingEnabled===true,intent});
 if(flIntent)return flIntent;
 if(!modifier&&!alt&&!shift&&windows[key])return intent('toggle-window',{window:windows[key]});
 // FL: L is the PAT/SONG switch, but with the typing keyboard on it plays a note.
 if(!modifier&&!alt&&!shift&&lower==='l'&&context.typingEnabled!==true)return intent('toggle-song-pattern');
 // FL: R toggles recording (a typing-keyboard note while that is on, like L).
 if(!modifier&&!alt&&!shift&&lower==='r'&&context.typingEnabled!==true)return intent('toggle-record');
 if(!modifier&&!alt&&!shift&&key==='F8')return intent('plugin-picker');
 if(!modifier&&alt&&!shift&&key==='F8')return intent('toggle-browser');
 if(!modifier&&!alt&&!shift&&key==='F12')return intent('close-all-windows');
 // FL: Alt+F12 closes plug-in windows, F10 opens MIDI settings, Shift+F8 the plug-in database, Ctrl/Cmd+Ins / +Del insert / delete Playlist space.
 if(!modifier&&alt&&!shift&&key==='F12')return intent('close-plugin-windows');
 if(!modifier&&!alt&&!shift&&key==='F10')return intent('midi-settings');
 if(!modifier&&!alt&&!shift&&key==='F1')return intent('help');
 if(!modifier&&!alt&&shift&&key==='F8')return intent('browse-plugins');
 if(modifier&&!alt&&!shift&&editor==='playlist'&&key==='Insert')return intent('insert-space',{editor});
 if(modifier&&!alt&&!shift&&editor==='playlist'&&key==='Delete')return intent('delete-space',{editor});
 // FL Pattern selector: F4 = next empty pattern with the naming dialog, Ctrl+F4 = without, Shift+F4 = first empty.
 if(key==='F4'&&!modifier&&!alt&&!shift)return intent('next-empty-pattern',{naming:true});
 if(key==='F4'&&modifier&&!alt&&!shift)return intent('next-empty-pattern',{naming:false});
 if(key==='F4'&&!modifier&&!alt&&shift)return intent('first-empty-pattern');
 // FL Channel rack: Alt+C clone, Alt+Del delete the selected channel; Ctrl+Enter focuses the Playlist.
 if(editor==='rack'&&!modifier&&alt&&!shift&&(event.code==='KeyC'||lower==='c'))return intent('clone-channel',{editor});
 if(editor==='rack'&&!modifier&&alt&&!shift&&key==='Delete')return intent('delete-channel',{editor});
 if(editor==='rack'&&modifier&&!alt&&!shift&&key==='Enter')return intent('focus-playlist');
 // FL Playlist: Shift+I inverts the selection, Shift+4 shows the whole song.
 if(editor==='playlist'&&!modifier&&!alt&&shift&&(event.code==='KeyI'||lower==='i'))return intent('playlist-invert-selection',{editor});
 if(editor==='playlist'&&!modifier&&!alt&&shift&&event.code==='Digit4')return intent('playlist-zoom-all',{editor});
 if(key==='F2'&&!modifier&&!alt&&!shift&&['playlist','piano','rack','mixer'].includes(editor))return intent('rename-focused',{editor});
 if((event.code==='Space'||key===' '||key==='Spacebar')&&!alt&&!shift)return intent(modifier?'transport-start-pause':'transport-start-stop');
 if(modifier){
  if(lower==='z'&&!alt)return intent(shift?'redo':'undo');
  if(lower==='z'&&alt&&!shift)return intent('undo');
  // FL: Ctrl+Alt+Left/Right jumps the playhead to the previous/next Playlist marker.
  if(alt&&!shift&&event.ctrlKey&&!event.metaKey&&['ArrowLeft','ArrowRight'].includes(key)&&['playlist','piano'].includes(editor))return intent('marker-jump',{editor,direction:key==='ArrowLeft'?-1:1});
  // Image-Line pianoroll_menu.htm: Quick quantize is Ctrl+Alt+Q (Cmd+Opt+Q on macOS).
  if(alt&&!shift&&(event.code==='KeyQ'||lower==='q')&&editor==='piano')return intent('quantize-quick',{editor});
  if(alt)return null;
  // Quick legato is Ctrl/Cmd+L in the Piano roll.
  if(lower==='l'&&!shift&&editor==='piano')return intent('piano-quick-legato',{editor});
  if(lower==='l'&&!shift&&['rack','mixer'].includes(editor))return intent('link-channels-to-mixer',{editor});
  if(lower==='y'&&!shift)return intent('redo');
  if(lower==='s')return intent(shift?'save-as':'save');
  if(shift&&lower==='c'&&editor==='rack')return intent('clone-channel',{editor});
  if(shift)return null;
  if(lower==='o')return intent('open');
  if(lower==='t')return intent('toggle-typing');
  // FL: Ctrl+H stops all sound (panic).
  if(lower==='h'&&!shift)return intent('panic');
  // Image-Line basics_shortcuts.htm: Ctrl+E toggles step editing, Ctrl+P the recording countdown.
  if(lower==='e')return intent('toggle-step-edit');
  if(lower==='p')return intent('toggle-countdown');
  // Image-Line pianoroll_menu.htm documents the context-specific MIDI wizard.
  if(lower==='m')return intent(editor==='piano'?'midi-import':'toggle-metronome');
  if(scoreEditors.has(editor)&&({a:'select-all',c:'copy',x:'cut',v:'paste'})[lower])return intent(({a:'select-all',c:'copy',x:'cut',v:'paste'})[lower],{editor});
  if(['playlist','piano'].includes(editor)&&lower==='b')return intent('duplicate',{editor});
  if(['playlist','piano'].includes(editor)&&lower==='d')return intent('deselect',{editor});
  return null;
 }
 // Image-Line pianoroll_menu.htm: Shift+Q quantizes starts only.
 if(editor==='piano'&&shift&&!alt&&lower==='q')return intent('quick-quantize-starts',{editor});
 // Image-Line basics_shortcuts.htm: Backspace toggles Line/None snap; Del deletes.
 // A Mac keyboard's "delete" key IS Backspace, so on macOS plain Backspace deletes
 // the selection of the focused editor (like Del) and toggles snap only when
 // nothing is selected. Shift+Backspace always toggles snap, on every platform.
 if(key==='Backspace'&&!alt&&!shift&&context.mac===true&&context.hasSelection===true&&scoreEditors.has(editor))return intent('delete-selection',{editor});
 if(key==='Backspace'&&!alt)return intent('toggle-snap');
 // FL: Alt+T adds a time marker at the song position.
 if(!modifier&&alt&&!shift&&(event.code==='KeyT'||lower==='t')&&['playlist','piano'].includes(editor))return intent('add-marker',{editor});
 if(editor==='rack'&&alt&&!shift&&['ArrowUp','ArrowDown'].includes(key))return intent('move-channel',{editor,direction:key==='ArrowUp'?-1:1});
 if(alt||shift)return null;
 if(['playlist','piano'].includes(editor)&&['PageUp','PageDown'].includes(key)){
  const path=event.composedPath?.()||[event.target];
  if(path.some(node=>node?.closest?.('.browser,nav,[role="navigation"],[role="listbox"],[role="option"],[role="tree"],[role="treeitem"],[role="slider"],[role="scrollbar"]')))return null;
  return{...intent('zoom-editor',{editor,direction:key==='PageUp'?1:-1}),repeatable:true};
 }
 if(editor==='playlist'&&key==='Home'){
  const path=event.composedPath?.()||[event.target];
  if(path.some(node=>node?.closest?.('.browser,[role="listbox"],[role="tree"],[role="treeitem"],[role="slider"]')))return null;
  return intent('playlist-home');
 }
 if(scoreEditors.has(editor)&&key==='Delete')return intent('delete-selection',{editor});
 if(key==='Escape')return intent('escape',{editor});
 // FL tool keys (P B D T S C E Z Y) select the focused Playlist/Piano roll
 // tool even while the typing keyboard is on; the remaining letters still play.
 if(!['playlist','piano'].includes(editor))return null;
 const tool=tools[lower];
 // FL: S toggles the slide flag of the selected notes (no Slide tool); N is the Paint drum tool.
 if(editor==='piano'&&lower==='s')return intent('piano-toggle-slide',{editor});
 if(editor==='piano'&&lower==='n')return intent('set-tool',{editor,tool:'paintdrum'});
 if(editor==='piano'&&lower==='i')return intent('piano-interpolate',{editor});
 // Piano T is FL's Mute tool (note `muted` flag), independent of the Playlist's tool set.
 if(editor==='piano'&&tool==='mute')return intent('set-tool',{editor,tool});
 if(!tool)return null;
 const configured=context.availableTools,available=configured instanceof Set||Array.isArray(configured)?configured:configured?.[editor]??defaultTools[editor];
 if(!(available instanceof Set?available.has(tool):available?.includes(tool)))return null;
 return intent('set-tool',{editor,tool});
}

/** Optional routing adapter. Unsupported intents stay available to other
 * handlers. Supported auto-repeat events are consumed without dispatching.
 * Async errors remain owned by the supplied application callback.
 */
export function handleStudioShortcut(event,context,handlers={}){
 const action=resolveStudioShortcut(event,context),handler=action&&handlers[action.command];
 if(typeof handler!=='function')return false;
 event.preventDefault?.();
 if(!event.repeat||action.repeatable)handler(action,event);
 return true;
}

/** FL: Space is always transport. A toolbar/panel button that kept focus after
 * a click (PAT/SONG, window buttons, tools) must not also activate on Space or
 * Enter. Browsers click a focused button on Space keyup, so a Space whose
 * keydown the studio consumed has its keyup default suppressed, and pointer
 * clicks release focus from toolbar controls. Text fields, dialogs and
 * keyboard-initiated activation (detail 0) keep their native behavior.
 */
const keyControl='button,[role="button"],[role="switch"],[role="menuitem"],summary,input[type="checkbox"],input[type="radio"]';
const isSpaceKey=event=>event?.code==='Space'||[' ','Spacebar'].includes(event?.key);
export function installTransportKeyGuard(doc=globalThis.document,{chrome='.toolbar,.panel-heading,.window-buttons,.playlist-tools,.piano-tools,.rack-bottom'}={}){
 const view=doc?.defaultView||globalThis;let consumed=false;
 const control=event=>(event.composedPath?.()||[event.target]).find(node=>node?.matches?.(keyControl))||null;
 const inChrome=node=>!!node?.closest?.(chrome)&&!node.closest('dialog,[role="dialog"],.context-menu');
 // Window bubble phase runs after every document-level studio handler.
 const keydown=event=>{if(isSpaceKey(event))consumed=event.defaultPrevented===true;};
 const keyup=event=>{if(!isSpaceKey(event))return;const handled=consumed;consumed=false;const node=control(event);if(node&&(handled||inChrome(node)))event.preventDefault();};
 const click=event=>{if(!(event.detail>0))return;const node=control(event);if(node&&inChrome(node)&&doc.activeElement===node)node.blur?.();};
 view.addEventListener('keydown',keydown);doc.addEventListener('keyup',keyup,true);view.addEventListener('click',click);
 return()=>{view.removeEventListener('keydown',keydown);doc.removeEventListener('keyup',keyup,true);view.removeEventListener('click',click);};
}
