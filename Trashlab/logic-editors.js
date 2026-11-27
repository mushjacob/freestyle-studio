/** Logic's bottom Editors pane (Piano Roll | Step Sequencer) and its public API.
 * app.js registers the implementation; the shell's key map (logic-keys.js) calls
 * openEditor / toggleEditor / toggleMusicalTyping without importing app.js.
 */
import {isStepPianoNote} from './step-piano.js';

export const LOGIC_EDITOR_TABS=Object.freeze([
 Object.freeze({id:'piano',label:'Piano Roll',window:'piano'}),
 Object.freeze({id:'step',label:'Step Sequencer',window:'rack'}),
 // Logic: the Audio Track Editor ("Track") for audio regions.
 Object.freeze({id:'audio',label:'Audio Track Editor',window:'audio-editor'}),
]);
export const editorWindowId=kind=>LOGIC_EDITOR_TABS.find(tab=>tab.id===kind)?.window||null;
export const editorKindForWindow=id=>LOGIC_EDITOR_TABS.find(tab=>tab.window===id)?.id||null;
// twoOctaves: tabs 31 + header 35 + ruler 20 + 24 rows × 17 px (PIANO_ROW_HEIGHT) + 6 px slack.
export const EDITOR_HEIGHT={min:150,default:500,collapsedReserve:160,twoOctaves:500};

/** Logic: double-clicking a Pattern region opens the Step Sequencer, a MIDI region the Piano Roll.
 * A Freestyle pattern is a "pattern region" when it has steps and no free (non-step) notes. */
export function editorForPattern(pattern){
 if(!pattern)return'piano';
 const freeNotes=Object.values(pattern.notes||{}).some(notes=>(notes||[]).some(note=>!isStepPianoNote(note)));
 const steps=Object.values(pattern.steps||{}).some(row=>(row||[]).some(Boolean));
 return steps&&!freeNotes?'step':'piano';
}
export function clampEditorHeight(height,{viewport=900}={}){
 const max=Math.max(EDITOR_HEIGHT.min,viewport-EDITOR_HEIGHT.collapsedReserve);
 return Math.round(Math.max(EDITOR_HEIGHT.min,Math.min(max,Number.isFinite(height)?height:EDITOR_HEIGHT.default)));
}
/** Logic opens the Editors at about 40 % of the window: tall enough for ~2 octaves of Piano Roll
 * (header + ruler + 24 rows) and the whole local inspector without scrolling. */
export function defaultEditorHeight(viewport=900){
 const h=Number.isFinite(viewport)&&viewport>0?viewport:900;
 return clampEditorHeight(Math.max(EDITOR_HEIGHT.twoOctaves,Math.round(h*.42)),{viewport:h});
}
export function editorTabsMarkup(active){
 return LOGIC_EDITOR_TABS.map(tab=>`<button type="button" role="tab" class="logic-editor-tab${tab.id===active?' selected':''}" data-editor-tab="${tab.id}" aria-selected="${tab.id===active}">${tab.label}</button>`).join('');
}

let api=null;
export function registerEditorsApi(next){api=next||null;}
const call=(name,...args)=>typeof api?.[name]==='function'?api[name](...args):false;
/** Show the Editors pane with 'piano' or 'step'. Returns true when shown. */
export const openEditor=(kind='piano')=>call('open',kind);
/** E: show/hide the Editors pane (keeps the last tab). */
export const toggleEditor=()=>call('toggle');
export const closeEditor=()=>call('close');
/** ⌘K: show/hide the Musical Typing window. */
export const toggleMusicalTyping=()=>call('toggleMusicalTyping');
/** Q in the Piano Roll: quantize selection with the inspector's Time Quantize settings. */
export const quantizeSelection=()=>call('quantize');
/** Logic tool ids: select (Pointer), draw (Pencil), erase, slice (Scissors), glue, mute, velocity, zoom. */
export const setEditorTool=tool=>call('setTool',tool);
export const activeEditorKind=()=>call('active')||null;
