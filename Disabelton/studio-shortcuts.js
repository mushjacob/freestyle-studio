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
 const windowKey=(Object.hasOwn(windows,event.key)||['F2','F4'].includes(event.key))&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey;
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
 if(!modifier&&!alt&&!shift&&windows[key])return intent('toggle-window',{window:windows[key]});
 if(key==='F4'&&!modifier&&!alt&&!shift)return intent('next-empty-pattern');
 if(key==='F2'&&!modifier&&!alt&&!shift&&['playlist','piano','rack','mixer'].includes(editor))return intent('rename-focused',{editor});
 if((event.code==='Space'||key===' '||key==='Spacebar')&&!alt&&!shift)return intent(modifier?'transport-start-pause':'transport-start-stop');
 if(modifier){
  if(lower==='z'&&!alt)return intent(shift?'redo':'undo');
  if(lower==='z'&&alt&&!shift)return intent('undo');
  if(alt)return null;
  if(lower==='y'&&!shift)return intent('redo');
  if(lower==='s')return intent(shift?'save-as':'save');
  if(shift)return null;
  if(lower==='o')return intent('open');
  if(lower==='t')return intent('toggle-typing');
  // Image-Line pianoroll_menu.htm documents the context-specific MIDI wizard.
  if(lower==='m')return intent(editor==='piano'?'midi-import':'toggle-metronome');
  if(scoreEditors.has(editor)&&({a:'select-all',c:'copy',x:'cut',v:'paste'})[lower])return intent(({a:'select-all',c:'copy',x:'cut',v:'paste'})[lower],{editor});
  if(['playlist','piano'].includes(editor)&&lower==='b')return intent('duplicate',{editor});
  if(['playlist','piano'].includes(editor)&&lower==='d')return intent('deselect',{editor});
  return null;
 }
 // Image-Line pianoroll_menu.htm: Shift+Q quantizes starts only.
 if(editor==='piano'&&shift&&!alt&&lower==='q')return intent('quick-quantize-starts',{editor});
 // Mac keyboards label Backspace "delete": FL on macOS deletes the selection
 // with it, so the global snap toggle lives on Shift+Backspace instead (Option
 // reports AltGraph on macOS and cannot carry a shortcut reliably).
 if(['playlist','piano'].includes(editor)&&key==='Backspace'&&shift&&!alt)return intent('toggle-snap');
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
 if(scoreEditors.has(editor)&&['Backspace','Delete'].includes(key))return intent('delete-selection',{editor});
 if(key==='Escape')return intent('escape',{editor});
 // FL tool keys (P B D T S C E Z Y) select the focused Playlist/Piano roll
 // tool even while the typing keyboard is on; the remaining letters still play.
 if(!['playlist','piano'].includes(editor))return null;
 const tool=tools[lower];
 if(editor==='piano'&&lower==='s')return intent('set-tool',{editor,tool:'slide'});
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
