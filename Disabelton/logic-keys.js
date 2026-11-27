/** Logic Pro key commands and mouse semantics for Disabelton.
 *
 * `resolveLogicKey` turns a keydown into an intent ({command,...}) and never
 * performs I/O; `installLogicKeys` routes intents to application handlers in
 * the window capture phase, ahead of the inherited FL shortcut layer, and
 * consumes only keys that have a handler. Space / ⌘Space, ⌘Z, ⌘C/X/V, ⌘A,
 * Delete and Home stay with the existing (proven) transport and edit layers.
 *
 * Letter commands follow Logic's default key set: C Cycle, R Record, T Tool
 * menu, X Mixer, E Editors, P Piano Roll, Y Library, I Inspector, A Automation,
 * B Smart Controls, F Browsers, O Loops, K Metronome. They apply in the Tracks
 * area, the Mixer and the Editors pane (Q quantizes in the Piano Roll; the T menu
 * picks the focused editor's tool). Notes come only from Musical Typing (⌘K),
 * whose open window owns its keys first.
 */

/** Logic's Tool menu (T, then the tool key). `tool` is the inherited playlist
 * tool id; `unsupported` items stay visible but disabled with the reason. */
export const LOGIC_TOOLS=Object.freeze([
 {key:'t',tool:'select',label:'Pointer Tool',icon:'pointer'},
 {key:'p',tool:'draw',label:'Pencil Tool',icon:'pencil'},
 {key:'e',tool:'erase',label:'Eraser Tool',icon:'eraser'},
 {key:'x',tool:'text',label:'Text Tool',icon:'text',unsupported:'Rename regions from their context menu (Rename…).'},
 {key:'i',tool:'slice',label:'Scissors Tool',icon:'scissors'},
 {key:'g',tool:'glue',label:'Glue Tool',icon:'glue',unsupported:'Freestyle has no region join operation.'},
 {key:'s',tool:'solo',label:'Solo Tool',icon:'solo',unsupported:'Isolated region audition is not available through the cloud transport.'},
 {key:'m',tool:'mute',label:'Mute Tool',icon:'mute'},
 {key:'z',tool:'zoom',label:'Zoom Tool',icon:'zoom'},
 {key:'a',tool:'fade',label:'Fade Tool',icon:'fade'},
 {key:'u',tool:'automation',label:'Automation Select Tool',icon:'automation',unsupported:'Open automation from the region context menu.'},
 {key:'r',tool:'marquee',label:'Marquee Tool',icon:'marquee',unsupported:'Drag on empty Tracks space with the Pointer Tool to select regions.'}
]);
export const LOGIC_TOOL_BY_ID=Object.freeze(Object.fromEntries(LOGIC_TOOLS.map(item=>[item.tool,item])));
/** ⌘-click tool choices (Logic shows the same list; Pointer means "⌘ toggles the selection"). */
export const LOGIC_COMMAND_TOOLS=Object.freeze(['select','erase','slice','mute']);

const letterCommands=Object.freeze({c:'toggle-cycle',r:'record',t:'tool-menu',x:'toggle-mixer',e:'toggle-editors',p:'toggle-piano-roll',y:'toggle-library',i:'toggle-inspector',a:'toggle-automation',b:'toggle-smart-controls',f:'toggle-browser',o:'toggle-loops',k:'toggle-metronome'});
const textEntry='input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="color"]):not([type="file"]),textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"]';
const activatable='button,a[href],summary,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],[role="option"],[role="treeitem"],[role="tab"]';
const path=event=>event.composedPath?.()||[event.target];
const inside=(event,selector)=>path(event).some(node=>node?.isContentEditable===true&&selector===textEntry||node?.closest?.(selector));

/** A Mac Control-click: the platform's secondary click. Logic opens the
 * context menu, so pointer handlers must not start a selection or edit. */
export function isMacContextClick(event,platform=globalThis.navigator?.platform||''){
 return !!event&&event.button===0&&!!event.ctrlKey&&!event.metaKey&&/\bMac/i.test(String(platform));
}

/** Resolve a keydown to a Logic intent, or null to leave it to other layers. */
export function resolveLogicKey(event,context={}){
 if(!event||event.defaultPrevented||event.isComposing||event.keyCode===229||event.key==='Process'||context.dialogOpen)return null;
 if(inside(event,textEntry))return null;
 // A focused plugin window / dialog (modal or modeless) owns its keys, as in the FL layer.
 if(inside(event,'dialog,[role="dialog"],.native-plugin-viewport'))return null;
 // Edit ▸ Undo History (⌥Z) by the physical Z key: some browsers report Mac Option as AltGraph, which otherwise defers the key.
 if(event.altKey&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&event.code==='KeyZ'&&!context.toolMenuOpen)return{command:'undo-history',repeatable:false};
 if(event.getModifierState?.('AltGraph'))return null;
 const key=String(event.key||''),lower=key.toLowerCase(),code=String(event.code||''),cmd=!!event.metaKey,ctrl=!!event.ctrlKey,alt=!!event.altKey,shift=!!event.shiftKey;
 const intent=(command,fields={})=>({command,repeatable:false,...fields});
 const editor=context.editor||null,tracks=editor===null||editor==='playlist'||editor==='mixer',regionScope=editor===null||editor==='playlist';
 // T opened the Tool menu: the next tool key picks; anything else closes it.
 if(context.toolMenuOpen){
  if(key==='Escape')return intent('close-tool-menu');
  if(!cmd&&!ctrl&&!alt&&!shift){const item=LOGIC_TOOLS.find(tool=>tool.key===lower);if(item)return intent('pick-tool',{tool:item.tool});}
  if(['Shift','Meta','Control','Alt'].includes(key))return null;
  return intent('close-tool-menu',{passThrough:true});
 }
 // Option changes the produced character on a Mac keyboard; match the physical key.
 const letter=/^Key[A-Z]$/.test(code)?code.slice(3).toLowerCase():lower;
 if(cmd&&alt&&!ctrl&&!shift&&letter==='n')return intent('new-tracks');
 // File: ⌘B Bounce (the Piano Roll keeps its own ⌘B), ⌘I Import MIDI File, ⇧⌘I Import Audio File.
 if(cmd&&!ctrl&&!alt&&!shift&&letter==='b'&&editor!=='piano')return intent('bounce');
 if(cmd&&!ctrl&&!alt&&letter==='i')return intent(shift?'import-audio':'import-midi');
 // Edit: ⌥Z Undo History (also matched above by its physical key).
 if(alt&&!cmd&&!ctrl&&!shift&&letter==='z')return intent('undo-history');
 // Track: ⌘D New Track with Duplicate Settings, ⌘⌫ Delete Track (Tracks area / Mixer).
 if(cmd&&!ctrl&&!alt&&!shift&&tracks){
  if(letter==='d')return intent('duplicate-track');
  if(key==='Backspace'&&regionScope)return intent('delete-track');
 }
 if((cmd||ctrl)&&!alt&&!shift&&letter==='k'&&editor!=='rack')return intent('toggle-musical-typing');
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
 if(cmd&&!ctrl&&!alt&&regionScope){
  if(key==='ArrowLeft'||key==='ArrowRight')return intent('zoom-horizontal',{direction:key==='ArrowRight'?1:-1,repeatable:true});
  if(key==='ArrowUp'||key==='ArrowDown')return intent('zoom-vertical',{direction:key==='ArrowDown'?1:-1,repeatable:true});
 }
 if(cmd||ctrl||alt)return null;
 if(key==='Enter'&&!shift){if(inside(event,activatable))return null;return intent('go-to-start');}
 if(key===','||key==='.'||shift&&(key==='<'||key==='>')){
  const back=key===','||key==='<';return intent('move-bars',{bars:(back?-1:1)*(shift?8:1),repeatable:true});
 }
 if(shift)return null;
 // The legacy typing piano (off by default) keeps letters in a focused editor.
 if(!tracks&&context.typingEnabled)return null;
 if(key.length!==1)return null;
 if(editor==='piano'&&lower==='q')return intent('quantize');
 const command=letterCommands[lower];
 return command?intent(command):null;
}

/** Route Logic intents to handlers (window capture phase, before the FL layer).
 * Only intents with a handler are consumed; auto-repeat runs repeatable ones. */
export function installLogicKeys(target=globalThis.window,{getContext=()=>({}),handlers={}}={}){
 const listener=event=>{
  let action;try{action=resolveLogicKey(event,getContext(event));}catch{return;}
  const handler=action&&handlers[action.command];if(typeof handler!=='function')return;
  if(!action.passThrough){event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();}
  if(event.repeat&&!action.repeatable)return;
  handler(action,event);
 };
 target.addEventListener('keydown',listener,true);
 return()=>target.removeEventListener('keydown',listener,true);
}
