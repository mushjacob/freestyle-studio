/** Logic Pro key commands and mouse semantics for Street Band.
 *
 * `resolveLogicKey` turns a keydown into an intent ({command,...}) and never
 * performs I/O; `installLogicKeys` routes intents to application handlers in
 * the window capture phase, ahead of the inherited FL shortcut layer, and
 * consumes only keys that have a handler. Space / ⌘Space, ⌘Z, ⌘C/X/V, ⌘A,
 * Delete and Home stay with the existing (proven) transport and edit layers.
 * ⇧Space is Logic's Play from Selection (the plain Space layer ignores Shift).
 *
 * Letter commands follow Logic's default key set: C Cycle, R Record, T Tool
 * menu, X Mixer, E Editors, P Piano Roll, Y Library, I Inspector, A Automation,
 * B Smart Controls, F Browsers, O Loops, K Metronome. They apply in the Tracks
 * area, the Mixer and the Editors pane (Q quantizes in the Piano Roll; the T menu
 * picks the focused editor's tool). Notes come only from Musical Typing (⌘K),
 * whose open window owns its keys first.
 */
import {matchKeyCommand,scopeForEditor} from './logic-key-commands.js';

/** Logic's Tool menu (T, then the tool key), in the Tracks area's menu order. `tool` is the
 * inherited playlist tool id; `unsupported` items stay visible but disabled with the reason.
 * Tool keys follow the default key command set (logic-key-commands.js, scope X). */
export const LOGIC_TOOLS=Object.freeze([
 {key:'t',tool:'select',label:'Pointer Tool',icon:'pointer'},
 {key:'p',tool:'draw',label:'Pencil Tool',icon:'pencil'},
 {key:'e',tool:'erase',label:'Eraser Tool',icon:'eraser'},
 {key:'⇧t',tool:'text',label:'Text Tool',icon:'text',unsupported:'Rename regions with ⇧N or from their context menu (Rename…).'},
 {key:'i',tool:'slice',label:'Scissors Tool',icon:'scissors'},
 {key:'j',tool:'glue',label:'Join Tool',icon:'glue',unsupported:'Freestyle has no region join operation.'},
 {key:'s',tool:'solo',label:'Solo Tool',icon:'solo',unsupported:'Isolated region audition is not available through the cloud transport.'},
 {key:'m',tool:'mute',label:'Mute Tool',icon:'mute'},
 {key:'y',tool:'zoom',label:'Zoom Tool',icon:'zoom'},
 {key:'a',tool:'fade',label:'Fade Tool',icon:'fade'},
 {key:'u',tool:'automation',label:'Automation Select Tool',icon:'automation',unsupported:'Select automation points in the track’s automation lane (A).'},
 {key:'w',tool:'automation-curve',label:'Automation Curve Tool',icon:'automation',unsupported:'Freestyle automation has straight segments only; curves cannot be bent.'},
 {key:'r',tool:'marquee',label:'Marquee Tool',icon:'marquee',unsupported:'Drag on empty Tracks space with the Pointer Tool to select regions.'},
 {key:'x',tool:'flex',label:'Flex Tool',icon:'zoom',unsupported:'Freestyle has no Flex Time / Flex Pitch.'},
 {key:'g',tool:'gain',label:'Gain Tool',icon:'fade',unsupported:'Set region gain in the Region inspector.'}
]);
export const LOGIC_TOOL_BY_ID=Object.freeze(Object.fromEntries(LOGIC_TOOLS.map(item=>[item.tool,item])));
/** ⌘-click tool choices (Logic shows the same list; Pointer means "⌘ toggles the selection"). */
export const LOGIC_COMMAND_TOOLS=Object.freeze(['select','erase','slice','mute']);

const textEntry='input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="color"]):not([type="file"]),textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"]';
const activatable='button,a[href],summary,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],[role="option"],[role="treeitem"],[role="tab"]';
const path=event=>event.composedPath?.()||[event.target];
const inside=(event,selector)=>path(event).some(node=>node?.isContentEditable===true&&selector===textEntry||node?.closest?.(selector));

/** A Mac Control-click: the platform's secondary click. Logic opens the
 * context menu, so pointer handlers must not start a selection or edit. */
export function isMacContextClick(event,platform=globalThis.navigator?.platform||''){
 // ⌃⇧-drag is Logic's fine (unsnapped) drag, not a context click.
 return !!event&&event.button===0&&!!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&/\bMac/i.test(String(platform));
}

/** The hand-written cases (browser fallbacks, auto-repeat, focus nuances). null leaves the key to the table below. */
function resolveSpecialKey(event,context={}){
 if(!event||event.defaultPrevented||event.isComposing||event.keyCode===229||event.key==='Process'||context.dialogOpen)return null;
 if(inside(event,textEntry))return null;
 // A focused plugin window / dialog (modal or modeless) owns its keys, as in the FL layer.
 if(inside(event,'dialog,[role="dialog"],.native-plugin-viewport'))return null;
 const key=String(event.key||''),lower=key.toLowerCase(),code=String(event.code||''),cmd=!!event.metaKey,ctrl=!!event.ctrlKey,alt=!!event.altKey,shift=!!event.shiftKey;
 const intent=(command,fields={})=>({command,repeatable:false,...fields});
 const editor=context.editor||null,tracks=editor===null||editor==='playlist'||editor==='mixer',regionScope=editor===null||editor==='playlist';
 // T opened the Tool menu: the next tool key picks; anything else closes it.
 if(context.toolMenuOpen){
  if(key==='Escape')return intent('close-tool-menu');
  {const row=matchKeyCommand(event,'X');if(row)return intent('pick-tool',{tool:row.args[0]});}
  if(['Shift','Meta','Control','Alt'].includes(key))return null;
  return intent('close-tool-menu',{passThrough:true});
 }
 // Option changes the produced character on a Mac keyboard; match the physical key.
 const letter=/^Key[A-Z]$/.test(code)?code.slice(3).toLowerCase():lower;
 if(cmd&&alt&&!ctrl&&!shift&&letter==='n')return intent('new-tracks');
 // Logic: ⌥⌘A New Audio Track, ⌥⌘S New Software Instrument Track (never the browser's / the app's ⌘S Save).
 if(cmd&&alt&&!ctrl&&!shift&&letter==='a')return intent('new-audio-track');
 if(cmd&&alt&&!ctrl&&!shift&&letter==='s')return intent('new-instrument-track');
 // ⌘J: Join (regions in the Tracks area, notes in the Piano Roll).
 if(cmd&&!ctrl&&!alt&&!shift&&letter==='j')return intent(editor==='piano'?'join-notes':'join-regions');
 // ⇧K: Count-in on / off.
 if(shift&&!cmd&&!ctrl&&!alt&&letter==='k'&&tracks)return intent('toggle-count-in');
 // File ▸ Import: ⌘I Other… (any importable file), ⇧⌘I Audio File….
 if(cmd&&!ctrl&&!alt&&letter==='i')return intent(shift?'import-audio':'import-other');
 // Track: ⌘D New Track with Duplicate Settings, ⌘⌫ Delete Track (Tracks area / Mixer).
 if(cmd&&!ctrl&&!alt&&!shift&&tracks){
  if(letter==='d')return intent('duplicate-track');
  if(key==='Backspace'&&regionScope)return intent('delete-track');
 }
 if(regionScope&&!alt&&!shift){
  // ⌘T is Logic's Split at Playhead; a browser tab reserves ⌘T, so ⌃T works too.
  if((cmd!==ctrl)&&letter==='t')return intent('split-at-playhead');
  // ⌘R repeats selected regions; with nothing selected it stays the browser's Reload (⌘⇧R always reloads).
  if(cmd&&!ctrl&&letter==='r')return context.hasSelection===false?null:intent('repeat-regions');
  if(ctrl&&!cmd&&letter==='m')return intent('mute-regions');
  if(cmd&&!ctrl&&letter==='u')return intent('locators-to-selection');
 }
 // Piano Roll: ⌘R is Logic's Edit ▸ Repeat on the selected notes, never the browser's Reload.
 if(editor==='piano'&&cmd&&!ctrl&&!alt&&!shift&&letter==='r')return intent('repeat-notes');
 if(cmd&&!ctrl&&!alt&&!shift&&regionScope){
  if(key==='ArrowLeft'||key==='ArrowRight')return intent('zoom-horizontal',{direction:key==='ArrowRight'?1:-1,repeatable:true});
  if(key==='ArrowUp'||key==='ArrowDown')return intent('zoom-vertical',{direction:key==='ArrowDown'?1:-1,repeatable:true});
 }
 if(cmd||ctrl||alt)return null;
 // Return (never the keypad's Enter, which is Play) goes to the beginning; `/` on the main keyboard is Go to Position.
 if(key==='Enter'&&!shift&&code!=='NumpadEnter'){if(inside(event,activatable))return null;return intent('go-to-start');}
 if(code.startsWith('Numpad'))return null;
 if(key==='/'&&!shift&&tracks)return intent('go-to-position');
 if(key===','||key==='.'||shift&&(key==='<'||key==='>')){
  const back=key===','||key==='<';return intent('move-bars',{bars:(back?-1:1)*(shift?8:1),repeatable:true});
 }
 // ⇧Space: Play from Selection (Tracks area, Mixer and Editors alike; a focused button never clicks).
 if(shift&&(code==='Space'||key===' '||key==='Spacebar'))return intent('play-from-selection');
 if(shift)return null;
 return null;
}
const MODIFIER_KEYS=new Set(['Shift','Meta','Control','Alt','CapsLock','Fn','AltGraph']);
/** Resolve a keydown to a Logic intent, or null to leave it to other layers.
 * Hand-written cases first, then the default key command table for the focused area:
 * a command row runs, a row Freestyle cannot do answers with its reason ('unavailable'),
 * and rows owned by the transport / edit layers (Space, ⌘Z, ⌘C…) are left alone. */
export function resolveLogicKey(event,context={}){
 const special=resolveSpecialKey(event,context);if(special)return special;
 // A focused plug-in window (its header, not the plug-in's own editor surface or a text field) keeps the plug-in keys:
 // V shows / hides all plug-in windows, [ and ] step to the previous / next setting.
 if(event&&!event.defaultPrevented&&!event.isComposing&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&inside(event,'dialog.logic-plugin-window')&&!inside(event,'.native-plugin-viewport')&&!inside(event,textEntry)){
  const row=['KeyV','BracketLeft','BracketRight'].includes(String(event.code||''))||['v','[',']'].includes(String(event.key||'').toLowerCase())?matchKeyCommand(event,'G'):null;
  if(row?.kind==='command')return{command:row.command,args:row.args,row,repeatable:false};
 }
 if(!event||event.defaultPrevented||event.isComposing||event.keyCode===229||event.key==='Process'||context.dialogOpen||context.toolMenuOpen||context.menuOpen)return null;
 if(MODIFIER_KEYS.has(String(event.key||''))||inside(event,textEntry)||inside(event,'dialog,[role="dialog"],.native-plugin-viewport'))return null;
 const plain=!event.metaKey&&!event.ctrlKey&&!event.altKey,editor=context.editor||null,tracks=editor===null||editor==='playlist'||editor==='mixer';
 // The legacy typing piano (off by default) keeps unmodified keys in a focused editor.
 // (Its note keys are printable characters; Page / Home / End / Return / Tab keep their commands.)
 if(plain&&!event.shiftKey&&!tracks&&context.typingEnabled&&String(event.key||'').length===1)return null;
 // Return on a focused button, menu item or tab activates it.
 if(plain&&(event.key==='Enter'||event.key===' ')&&inside(event,activatable))return null;
 // Tab keeps moving keyboard focus inside menus, lists and panels with focusable controls.
 if(event.key==='Tab'&&inside(event,'[role="menu"],[role="listbox"],[role="tree"],.context-menu,.browser,.logic-inspector,.logic-insp-strips'))return null;
 // A focused fader, knob, checkbox or pop-up keeps its own navigation keys.
 if(plain&&/^(Arrow|Home$|End$|Page)/.test(String(event.key||''))&&inside(event,'input,select,[role="slider"],[role="scrollbar"],[role="listbox"],[role="tree"],[role="option"],[role="treeitem"],.logic-knob'))return null;
 // A focused browser / navigation list scrolls with its own Page keys.
 if(plain&&/^Page/.test(String(event.key||''))&&inside(event,'.browser,nav,[role="navigation"]'))return null;
 // Outside macOS the Control key is the command key (Ctrl+Z, Ctrl+C…): it is matched as ⌘, never as Logic's ⌃ commands.
 const mac=typeof context.mac==='boolean'?context.mac:/\bMac|iPhone|iPad/i.test(String(globalThis.navigator?.platform||''));
 const keyEvent=!mac&&event.ctrlKey&&!event.metaKey?{code:event.code,key:event.key,ctrlKey:false,metaKey:true,altKey:event.altKey,shiftKey:event.shiftKey}:event;
 const row=matchKeyCommand(keyEvent,scopeForEditor(editor));if(!row||row.kind==='native')return null;
 // ⌘R with nothing selected stays the browser's Reload.
 if(row.command==='repeat-regions'&&context.hasSelection===false)return null;
 if(row.kind==='unavailable')return{command:'unavailable',row,repeatable:false};
 return{command:row.command,args:row.args,row,repeatable:REPEATABLE.has(row.command),...argFields(row)};
}
const REPEATABLE=new Set(['nudge-notes','transpose-notes','move-bars','zoom-horizontal','zoom-vertical','nudge','nudge-length','nudge-note-length','select-region','select-track','select-strip','step-move','page','transpose-regions','step-transpose','waveform-zoom']);
/** Named fields the existing handlers read (bars, direction, tool). */
function argFields(row){const value=Number(row.args[0]);return row.command==='move-bars'?{bars:value}:row.command==='zoom-horizontal'||row.command==='zoom-vertical'?{direction:value}:row.command==='pick-tool'?{tool:row.args[0]}:{};}

/** Route Logic intents to handlers (window capture phase, before the FL layer).
 * Only intents with a handler are consumed; auto-repeat runs repeatable ones. */
export function installLogicKeys(target=globalThis.window,{getContext=()=>({}),handlers={}}={}){
 // A Space this layer consumed (⇧Space) must not also click a focused button on keyup.
 let spaceConsumed=false;const space=event=>event?.code==='Space'||[' ','Spacebar'].includes(event?.key);
 const listener=event=>{
  if(space(event))spaceConsumed=false;
  let action;try{action=resolveLogicKey(event,getContext(event));}catch{return;}
  const handler=action&&handlers[action.command];if(typeof handler!=='function')return;
  if(!action.passThrough){event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();if(space(event))spaceConsumed=true;}
  if(event.repeat&&!action.repeatable)return;
  handler(action,event);
 };
 const keyup=event=>{if(!space(event)||!spaceConsumed)return;spaceConsumed=false;event.preventDefault();};
 target.addEventListener('keydown',listener,true);target.addEventListener('keyup',keyup,true);
 return()=>{target.removeEventListener('keydown',listener,true);target.removeEventListener('keyup',keyup,true);};
}
