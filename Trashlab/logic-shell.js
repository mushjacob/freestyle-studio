/** Trashlab shell: Logic Pro–style control bar, Tracks-area local menus,
 * tool pickers, track headers, Inspector, Library / Browser panes and the Logic
 * key map, layered over the inherited (proven) engine, transport and history
 * handlers. This module owns presentation and routing only: every edit, mix
 * change and transport command goes through a handler the application passes
 * in (`api`), which keeps the fast mozart-control transport path unchanged.
 */
import {LOGIC_TOOLS,LOGIC_TOOL_BY_ID,LOGIC_COMMAND_TOOLS,installLogicKeys,isMacContextClick} from './logic-keys.js';
import {openEditor,toggleEditor,closeEditor,toggleMusicalTyping,activeEditorKind,quantizeSelection,setEditorTool} from './logic-editors.js';
import {regionMenuItems,tracksBackgroundMenuItems,targetRegions,playheadInside} from './logic-context-menu.js';
import {LOGIC_KEY_COMMANDS,KEY_COMMAND_SCOPES,unavailableMessage} from './logic-key-commands.js';
import {LOGIC_PIANO_TOOLS} from './logic-piano.js';

/** Render-time hooks app.js calls; filled in by installLogicShell. */
export const logicShellHooks={};

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const svg=(body,view='0 0 24 24')=>`<svg class="logic-icon" viewBox="${view}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
/** Original line icons (no Apple artwork). */
export const LOGIC_ICONS=Object.freeze({
 pointer:svg('<path d="M6 3l11 9-5 1 3 6-2.4 1-3-6L6 17z" fill="currentColor" stroke="none"/>'),
 pencil:svg('<path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4"/>'),
 eraser:svg('<path d="M3 16l9-9 6 6-6 6H7zM8 20h13M9 10l6 6"/>'),
 text:svg('<path d="M5 6h14M12 6v13"/>'),
 scissors:svg('<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M8 15L18 3M16 15L6 3"/>'),
 glue:svg('<path d="M9 3h6v4H9zM8 7h8l-1 13H9z"/>'),
 solo:svg('<path d="M5 10h4l5-4v12l-5-4H5zM17 9a4 4 0 0 1 0 6"/>'),
 mute:svg('<path d="M4 10h4l5-4v12l-5-4H4zM16 9l5 6m0-6-5 6"/>'),
 zoom:svg('<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6M7 10h6M10 7v6"/>'),
 fade:svg('<path d="M3 19C9 19 13 5 21 5M3 5h18"/>'),
 automation:svg('<path d="M3 17l5-8 4 5 4-9 5 7"/><circle cx="8" cy="9" r="1.5"/><circle cx="16" cy="5" r="1.5"/>'),
 marquee:svg('<path d="M4 4h16v16H4z" stroke-dasharray="3 2"/><path d="M12 4v16"/>'),
 library:svg('<path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1L23 19l-3.5 1z"/>'),
 inspector:svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
 smart:svg('<circle cx="7" cy="12" r="3"/><circle cx="17" cy="12" r="3"/><path d="M7 4v5M17 4v5M7 15v5M17 15v5"/>'),
 mixer:svg('<path d="M6 3v18M12 3v18M18 3v18"/><path d="M4 14h4M10 8h4M16 16h4" stroke-width="2.6"/>'),
 editors:svg('<path d="M3 4h18v16H3zM3 9h18M7 13h4M13 16h5"/>'),
 rack:svg('<path d="M3 5h18v14H3zM3 12h18M8 5v14M13 5v14M18 5v14"/>'),
 list:svg('<path d="M8 6h13M8 12h13M8 18h13M4 6h.5M4 12h.5M4 18h.5"/>'),
 notes:svg('<path d="M5 3h11l3 3v15H5zM8 9h8M8 13h8M8 17h5"/>'),
 loops:svg('<path d="M4 12a6 6 0 0 1 10-4.5L17 10M20 12a6 6 0 0 1-10 4.5L7 14M17 5v5h-5M7 19v-5h5"/>'),
 browser:svg('<path d="M3 6h7l2 2h9v11H3z"/>'),
 start:svg('<path d="M6 5v14" stroke-width="2.2"/><path d="M19 5L8 12l11 7z" fill="currentColor"/>'),
 rewind:svg('<path d="M12 6 4 12l8 6zM21 6l-8 6 8 6z" fill="currentColor" stroke="none"/>'),
 forward:svg('<path d="M12 6l8 6-8 6zM3 6l8 6-8 6z" fill="currentColor" stroke="none"/>'),
 cycle:svg('<path d="M4 12a6 6 0 0 1 6-6h8m0 0-3-3m3 3-3 3M20 12a6 6 0 0 1-6 6H6m0 0 3 3m-3-3 3-3" stroke-width="2"/>'),
 metronome:svg('<path d="M8 21l3-17h2l3 17zM6 21h12M12 15l6-8"/>'),
 typing:svg('<path d="M2 7h20v11H2zM6 11h1M10 11h1M14 11h1M18 11h1M7 15h10"/>'),
 save:svg('<path d="M5 3h12l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7"/>'),
 export:svg('<path d="M4 15v6h16v-6M12 3v13m-5-5 5 5 5-5"/>'),
 help:svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>'),
 undo:svg('<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>'),
 redo:svg('<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>'),
 plus:svg('<path d="M12 5v14M5 12h14" stroke-width="2"/>'),
 audioTrack:svg('<path d="M4 12h1M7 8v8M10 5v14M13 9v6M16 7v10M19 11v2" stroke-width="2"/>'),
 instrumentTrack:svg('<path d="M3 5h18v14H3z"/><path d="M7 5v8M11 5v8M15 5v8M19 5v8" stroke-width="2.4"/><path d="M5 13v6M9 13v6M13 13v6M17 13v6"/>'),
 patternTrack:svg('<path d="M3 5h18v14H3z"/><path d="M6 9h2v2H6zM11 9h2v2h-2zM16 13h2v2h-2zM6 13h2v2H6z" fill="currentColor" stroke="none"/>'),
 caret:svg('<path d="M7 10l5 5 5-5"/>')
});
/** Simple original mark: an amber "i" in a rounded square (not Apple's Logic logo). */
export const ILLOGIC_MARK='<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill="#2b2b2b" stroke="#e1b33b" stroke-width="2"/><circle cx="16" cy="9" r="2.6" fill="#e1b33b"/><path d="M12 14h5v9h3" fill="none" stroke="#e1b33b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Linear gain ↔ dB for the track volume sliders (Logic: −∞ … +6 dB). */
export const VOLUME_FLOOR_DB=-60,VOLUME_CEIL_DB=6;
export function gainToDb(gain){const value=Number(gain);return value>0?20*Math.log10(value):-Infinity;}
export function dbToGain(db){const value=Number(db);return value<=VOLUME_FLOOR_DB?0:10**(value/20);}
export function formatDb(gain){const db=gainToDb(gain);return Number.isFinite(db)?(Math.abs(db)<.05?'0.0':db.toFixed(1)):'-∞';}
/** "1:03:12" (bar:step:tick) → {bar, beat}; null when unknown. */
/** Logic LCD readout for a beat position: bar, beat, division (1/16) and tick (240 per division, all 1-based) plus elapsed time. */
export function lcdReadout(beat,{bpm=120,beatsPerBar=4}={}){
 const position=Math.max(0,Number(beat)||0),per=beatsPerBar>0?beatsPerBar:4,units=Math.floor(position*960+1e-6),barUnits=per*960,within=units%barUnits,inBeat=within%960;
 const tempo=Number(bpm)>0?Number(bpm):120,ms=Math.floor(position*60000/tempo+1e-6),two=value=>String(value).padStart(2,'0');
 return{bar:Math.floor(units/barUnits)+1,beat:Math.floor(within/960)+1,div:Math.floor(inBeat/240)+1,tick:inBeat%240+1,time:`${two(Math.floor(ms/3600000))}:${two(Math.floor(ms/60000)%60)}:${two(Math.floor(ms/1000)%60)}.${String(ms%1000).padStart(3,'0')}`};
}
export const LCD_MODES=[['beats-project','Beats & Project'],['beats-time','Beats & Time'],['beats','Beats'],['time','Time'],['custom','Custom']];
export function lcdPosition(text){const match=/^(\d+):(\d+):(\d+)$/.exec(String(text||'').trim());if(!match)return null;const step=Number(match[2]);return{bar:Number(match[1]),beat:Math.floor((Math.max(1,step)-1)/4)+1};}

/** Logic track header markup for one Tracks-area row (values are filled by the shell). */
export function logicTrackHeaderHtml({track,name,kind='audio',ledOff=false,empty=false}){
 // Empty Tracks space below the last track: no header controls (the hidden LED keeps the inherited binding).
 if(empty)return `<div class="track-label logic-track-header logic-track-empty" data-track="${track}" data-track-kind="empty" aria-hidden="true"><span class="track-enable" hidden></span></div>`;
 const label=esc(name),icon=kind==='audio'?LOGIC_ICONS.audioTrack:kind==='pattern'?LOGIC_ICONS.patternTrack:LOGIC_ICONS.instrumentTrack;
 return `<div class="track-label logic-track-header" title="Double-click the name to rename" data-track="${track}" data-track-kind="${esc(kind)}"><span class="logic-track-number">${track+1}</span><span class="logic-track-icon">${icon}</span><span class="logic-track-main"><span class="logic-track-name">${label}</span><span class="logic-track-buttons"><button type="button" class="track-enable logic-track-m ${ledOff?'off':''}" title="Mute track" aria-label="Mute track">M</button><button type="button" class="logic-track-s" title="Solo track" aria-label="Solo track">S</button><button type="button" class="logic-track-r" disabled title="Record Enable: Freestyle records from the control bar Record button, not per track" aria-label="Record enable">R</button><button type="button" class="logic-track-i" disabled title="Input Monitoring is not available for cloud tracks" aria-label="Input monitoring">I</button><input type="range" class="logic-track-volume" min="${VOLUME_FLOOR_DB}" max="${VOLUME_CEIL_DB}" step="0.1" value="0" aria-label="Track volume" disabled><span class="logic-knob logic-track-pan" role="slider" tabindex="-1" aria-label="Track pan" aria-valuemin="-64" aria-valuemax="63" aria-valuenow="0" aria-disabled="true"></span></span></span></div>`;
}

const PANES=['inspector','library','browser','loops','automation'];
const store={get(key,fallback){try{const value=globalThis.localStorage?.getItem('illogic:'+key);return value===null||value===undefined?fallback:JSON.parse(value);}catch{return fallback;}},set(key,value){try{globalThis.localStorage?.setItem('illogic:'+key,JSON.stringify(value));}catch{}}};

/**
 * @param {object} api application bridge (see app.js "Trashlab shell").
 */
export function installLogicShell(api){
 const doc=api.document||globalThis.document,$=selector=>doc.querySelector(selector),$$=selector=>[...doc.querySelectorAll(selector)];
 const state={toolMenuOpen:false,commandTool:store.get('commandTool','select'),selectedTrack:null,pointer:{clientX:240,clientY:160},panes:{inspector:store.get('pane:inspector',true),library:false,browser:store.get('pane:browser',true),loops:false,automation:false},disposers:[]};
 if(!LOGIC_COMMAND_TOOLS.includes(state.commandTool))state.commandTool='select';
 const on=(target,type,listener,options)=>{if(!target)return;target.addEventListener(type,listener,options);state.disposers.push(()=>target.removeEventListener(type,listener,options));};
 const safe=run=>(...args)=>{try{const result=run(...args);if(result&&typeof result.catch==='function')result.catch(api.fail);return result;}catch(error){api.fail(error);return null;}};
 const menuAt=(event,items)=>{api.menu(event,items);};
 const anchor=element=>{const rect=element.getBoundingClientRect();return{clientX:rect.left,clientY:rect.bottom+3};};

 // ── Panes: Inspector (I), Library (Y), Browser (F) / Loops (O), Automation (A)
 function paintPanes(){
  const body=doc.body;for(const pane of PANES)body.classList.toggle('logic-show-'+pane,!!state.panes[pane]);
  body.classList.toggle('logic-show-right-browser',!!(state.panes.browser||state.panes.loops));
  for(const button of $$('[data-logic-pane]')){const pane=button.dataset.logicPane;if(!PANES.includes(pane))continue;const lit=!!state.panes[pane];button.classList.toggle('lit',lit);button.setAttribute('aria-pressed',String(lit));}
 }
 function selectBrowserTab(tab){const button=$(`.browser-tabs [data-browser="${tab}"]`);if(button&&!button.classList.contains('selected'))button.click();}
 function togglePane(pane,force){
  const next=typeof force==='boolean'?force:!state.panes[pane];
  if(pane==='library'){state.panes.library=next;if(next){state.panes.browser=false;state.panes.loops=false;selectBrowserTab('plugins');}}
  else if(pane==='browser'||pane==='loops'){const other=pane==='browser'?'loops':'browser';state.panes[pane]=next;if(next){state.panes[other]=false;state.panes.library=false;selectBrowserTab(pane==='loops'?'favorites':'all');}}
  else state.panes[pane]=next;
  store.set('pane:inspector',state.panes.inspector);store.set('pane:browser',state.panes.browser);
  paintPanes();if(pane==='inspector'&&next)renderInspector();
  if(pane==='automation'){const shown=api.toggleAutomation?.(next);if(typeof shown==='boolean'){state.panes.automation=shown;paintPanes();}}
  return next;
 }
 for(const button of $$('[data-logic-pane]'))on(button,'click',()=>{if(button.disabled)return;togglePane(button.dataset.logicPane);});
 const browser=$('aside.browser'),collapse=$('#collapse-browser');
 if(collapse){collapse.title='Close the browser';collapse.onclick=()=>{state.panes.browser=state.panes.loops=state.panes.library=false;paintPanes();};}
 if(browser){const heading=browser.querySelector('.panel-heading>span');if(heading)heading.textContent='Browser';}
 paintPanes();

 // ── Window title row: "<project> - Tracks" centred; the status/hint line moves beside the LCD
 const hint=$('#hint'),statusSlot=$('.logic-bar-right');
 if(hint&&statusSlot&&!hint.classList.contains('logic-status-line')){hint.classList.add('logic-status-line');statusSlot.prepend(hint);}
 // The status line speaks Logic (region, Tracks area, Step Sequencer) whatever layer wrote it.
 if(hint&&api.logicCopy){const Observer=doc.defaultView?.MutationObserver||globalThis.MutationObserver;if(Observer){const observer=new Observer(()=>{const next=api.logicCopy(hint.textContent);if(next!==hint.textContent)hint.textContent=next;});observer.observe(hint,{childList:true,characterData:true,subtree:true});state.disposers.push(()=>observer.disconnect());}}
 // ── Control bar: Go to Beginning, Cycle, LCD
 const icon=(selector,name)=>{const el=$(selector);if(el&&!el.querySelector('.logic-icon'))el.insertAdjacentHTML('afterbegin',LOGIC_ICONS[name]);};
 for(const [selector,name]of [['#logic-go-start','start'],['#logic-rewind','rewind'],['#logic-forward','forward'],['#logic-cycle','cycle'],['[data-logic-pane="library"]','library'],['[data-logic-pane="inspector"]','inspector'],['[data-logic-pane="smart"]','smart'],['[data-logic-pane="list"]','list'],['[data-logic-pane="notes"]','notes'],['[data-logic-pane="loops"]','loops'],['[data-logic-pane="browser"]','browser'],['#new-track','plus']])icon(selector,name);
 on($('#logic-go-start'),'click',safe(()=>api.goToStart()));
 /* Cycle (C or the button) lights at the press and shows the requested state while Freestyle confirms; a refused
  * change puts it back on the confirmed state. */
 function toggleCycleNow(){const clock=safeClock();if(typeof clock.loopEnabled==='boolean'&&state.cyclePending===undefined){state.cyclePending=!clock.loopEnabled;paintCycle();}let result;try{result=api.toggleCycle();}catch(error){state.cyclePending=undefined;paintCycle();throw error;}return Promise.resolve(result).finally(()=>{state.cyclePending=undefined;paintCycle();});}
 on($('#logic-cycle'),'click',safe(()=>toggleCycleNow()));
 function paintCycle(){const clock=safeClock(),button=$('#logic-cycle');if(!button)return;const known=typeof clock.loopEnabled==='boolean',shown=typeof state.cyclePending==='boolean'?state.cyclePending:known&&clock.loopEnabled;button.classList.toggle('lit',shown);button.setAttribute('aria-pressed',String(shown));button.setAttribute('aria-busy',String(typeof state.cyclePending==='boolean'));button.title=known?'Cycle (C)':'Cycle (C) · waiting for Freestyle’s loop state';}
 function safeClock(){try{return api.clock()||{};}catch{return{};}}
 function paintLcd(){
  const raw=$('#time-value'),project=api.getProject?.(),signature=$('#lcd-signature');
  const map=project?.cloud?.rawProject?.timingMap,first=Array.isArray(map?.timeSignatures)?map.timeSignatures[0]:null,num=Number(first?.numerator??first?.beatsPerBar),den=Number(first?.denominator??first?.beatUnit);
  // The app publishes the playhead beat on #time-value (data-beat); the text form is the fallback.
  const stored=Number(raw?.dataset?.beat),fallback=lcdPosition(raw?.textContent),beat=Number.isFinite(stored)&&raw?.dataset?.beat!==undefined&&raw.dataset.beat!==''?stored:fallback?(fallback.bar-1)*4+(fallback.beat-1):0;
  const tempo=Number($('#tempo')?.value)||Number(project?.bpm)||120,readout=lcdReadout(beat,{bpm:tempo,beatsPerBar:4});
  for(const [id,value]of [['#lcd-bar',readout.bar],['#lcd-beat',readout.beat],['#lcd-div',readout.div],['#lcd-tick',readout.tick],['#lcd-time',readout.time]]){const el=$(id),text=String(value);if(el&&el.textContent!==text)el.textContent=text;}
  if(signature){const text=num>0&&den>0?`${num}/${den}`:'4/4';if(signature.textContent!==text)signature.textContent=text;}
  paintCycle();
 }
 // LCD display mode (Logic: click the LCD's right edge): Beats & Project, Beats & Time, Beats, Time, Custom.
 function setLcdMode(mode){const lcd=$('#time-display');if(!lcd)return;const known=LCD_MODES.some(([id])=>id===mode)?mode:'custom';lcd.dataset.lcdMode=known;store.set('lcd:mode',known);}
 setLcdMode(store.get('lcd:mode','custom'));
 on($('#lcd-mode'),'click',event=>{event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect(),current=$('#time-display')?.dataset.lcdMode;menuAt({clientX:rect.left,clientY:rect.bottom+4},LCD_MODES.map(([id,label])=>({label,checked:id===current,run:()=>setLcdMode(id)})));});
 const timeValue=$('#time-value');
 if(timeValue){const Observer=doc.defaultView?.MutationObserver||globalThis.MutationObserver;if(Observer){const observer=new Observer(paintLcd);observer.observe(timeValue,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['data-beat']});const tempoInput=$('#tempo');on(tempoInput,'input',paintLcd);on(tempoInput,'change',paintLcd);state.disposers.push(()=>observer.disconnect());}}
 paintLcd();

 // ── Tool pickers (left-click tool, ⌘-click tool) and the T tool menu
 const currentTool=()=>api.getTool?.()||'select';
 function setTool(tool){const item=LOGIC_TOOL_BY_ID[tool];if(!item||item.unsupported)return false;api.setTool(tool);paintTools();api.toast(`${item.label} selected`);return true;}
 function toolItems(selected,pick,{commandTool=false}={}){
  return LOGIC_TOOLS.filter(item=>!commandTool||LOGIC_COMMAND_TOOLS.includes(item.tool)||item.unsupported).map(item=>({label:item.label,shortcut:commandTool?'':item.key.toUpperCase(),checked:item.tool===selected,disabled:!!item.unsupported||commandTool&&!LOGIC_COMMAND_TOOLS.includes(item.tool),title:item.unsupported||'',run:()=>pick(item.tool)}));
 }
 function paintTools(){
  const left=$('#logic-left-tool'),cmd=$('#logic-cmd-tool'),tool=LOGIC_TOOL_BY_ID[currentTool()]||LOGIC_TOOL_BY_ID.select,command=LOGIC_TOOL_BY_ID[state.commandTool];
  if(left){left.innerHTML=LOGIC_ICONS[tool.icon]+LOGIC_ICONS.caret;left.title=`Left-click Tool: ${tool.label}`;left.dataset.logicTool=tool.tool;}
  if(cmd){cmd.innerHTML=LOGIC_ICONS[command.icon]+LOGIC_ICONS.caret;cmd.title=`Command-click Tool: ${command.label}`;cmd.dataset.logicTool=command.tool;}
 }
 on($('#logic-left-tool'),'click',event=>{event.stopPropagation();menuAt(anchor(event.currentTarget),toolItems(currentTool(),setTool));});
 on($('#logic-cmd-tool'),'click',event=>{event.stopPropagation();menuAt(anchor(event.currentTarget),toolItems(state.commandTool,tool=>{state.commandTool=tool;store.set('commandTool',tool);paintTools();api.toast(`Command-click Tool: ${LOGIC_TOOL_BY_ID[tool].label}`);},{commandTool:true}));});
 function openToolMenu(){
  state.toolMenuOpen=true;state.toolMenuEditor=editorFocused();const point=state.pointer;menuAt({clientX:point.clientX,clientY:point.clientY},state.toolMenuEditor?editorToolItems():toolItems(currentTool(),tool=>{state.toolMenuOpen=false;setTool(tool);}));
  const menu=$('#context-menu');menu?.classList.add('logic-tool-menu');
  const Observer=doc.defaultView?.MutationObserver||globalThis.MutationObserver;if(menu&&Observer){const observer=new Observer(()=>{if(menu.classList.contains('hidden')){state.toolMenuOpen=false;menu.classList.remove('logic-tool-menu');observer.disconnect();}});observer.observe(menu,{attributes:true,attributeFilter:['class']});}
 }
 /** T in a focused Piano Roll / Step Sequencer picks that editor's tool (logic-editors API). */
 function editorFocused(){const editor=api.activeEditor();return editor==='piano'||editor==='rack';}
 function editorToolItems(){if(api.activeEditor()==='rack')return LOGIC_TOOLS.map(item=>({label:item.label,shortcut:item.key.toUpperCase(),disabled:true,title:'Steps are edited with the pointer; the Step Sequencer has no tool menu.',run:()=>{}}));const current=$('#piano')?.dataset.pianoTool||'select';return LOGIC_PIANO_TOOLS.map(item=>({label:item.label,shortcut:item.key,checked:item.id===current,disabled:!!item.unsupported,title:item.unsupported||'',run:()=>{state.toolMenuOpen=false;pickTool(item.id);}}));}
 function pickTool(tool){if(state.toolMenuEditor){state.toolMenuEditor=false;if(setEditorTool(tool)===false){const item=LOGIC_PIANO_TOOLS.find(entry=>entry.id===tool||entry.id===({brush:'paint',solo:'playback'})[tool]);api.toast(item?.unsupported?`${item.label}: ${item.unsupported}`:`${LOGIC_TOOL_BY_ID[tool]?.label||'This tool'} is not available in this editor.`);}return;}if(setTool(tool)===false){const item=LOGIC_TOOL_BY_ID[tool];api.toast(item?.unsupported?`${item.label}: ${item.unsupported}`:'This tool is not available in the Tracks area.');}}
 function closeToolMenu(){state.toolMenuOpen=false;const menu=$('#context-menu');menu?.classList.add('hidden');menu?.classList.remove('logic-tool-menu');}
 on(doc,'pointermove',event=>{state.pointer={clientX:event.clientX,clientY:event.clientY};},{passive:true,capture:true});
 paintTools();

 // ⌘-click tool on regions: Eraser deletes, Scissors splits, Mute toggles mute.
 on($('#track-lanes'),'pointerdown',event=>{
  if(event.button!==0||!event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||state.commandTool==='select')return;
  const element=event.target?.closest?.('.clip[data-clip]');if(!element||element.closest('.automation-clip'))return;
  const clip=api.findClip(element.dataset.clip);if(!clip)return;event.preventDefault();event.stopPropagation();
  if(!api.editable())return api.toast('Wait for the current cloud operation to finish.');
  if(state.commandTool==='erase'){api.selectRegions([clip.id]);safe(()=>api.deleteSelected())();}
  else if(state.commandTool==='slice'){const rect=element.getBoundingClientRect(),beat=api.snapBeat(clip.start+(event.clientX-rect.left)/api.barWidth()*4);if(playheadInside(clip,beat))safe(()=>api.split(clip,beat))();}
  else if(state.commandTool==='mute')safe(()=>api.toggleRegionMute([clip.id]))();
 },true);

 // ── Region + Tracks-area context menus (Logic: right-click / Control-click opens a menu, never erases)
 function regionCommands(clip){
  const project=api.getProject(),guard=run=>()=>{if(api.getProject()!==project||api.findClip(clip.id)!==clip)return api.toast('The region changed; reopen its menu.');return safe(run)();};
  return{command:api.command?(name,args)=>guard(()=>api.command(name,args))():undefined,cut:guard(()=>api.clipboard('cut')),copy:guard(()=>api.clipboard('copy')),paste:guard(()=>api.clipboard('paste')),delete:guard(()=>api.deleteSelected()),split:guard(()=>splitAtPlayhead(clip.id)),repeat:guard(()=>api.repeat()),mute:guard(()=>api.toggleRegionMute([...api.selectedIds()])),rename:guard(()=>api.renameRegion(clip)),'piano-roll':guard(()=>api.openPianoRoll(clip)),'sample-editor':guard(()=>api.openSampleEditor(clip)),'make-unique':guard(()=>api.makeUnique(clip)),'region-effect':guard(()=>api.regionEffect(clip)),'stem-splitter':api.stemSplitter?guard(()=>api.stemSplitter(clip)):undefined,'add-to-step-sequencer':guard(()=>api.addToStepSequencer(clip)),automation:guard(()=>api.openAutomation(clip)),'reload-waveform':guard(()=>api.reloadWaveform(clip)),properties:guard(()=>api.regionProperties(clip))};
 }
 function regionMenu(event,clip){
  event?.preventDefault?.();if(!clip)return;
  if(event?.ctrlKey&&event?.altKey)return;/* Ctrl+Option drag is Logic's zoom gesture */
  if(!api.selectedIds().has(clip.id))api.selectRegions([clip.id]);
  const selection=api.selectedIds().size||1;
  menuAt(event,regionMenuItems({region:clip,playhead:api.playheadBeat(),selection,muted:api.regionMuted(clip),editable:api.editable(),stemSplitter:api.stemSplitterState?.()??null,run:regionCommands(clip)}));
 }
 function tracksMenu(event){
  event?.preventDefault?.();if(event?.ctrlKey&&event?.altKey)return;
  const lane=event?.target?.closest?.('.lane-grid[data-track]'),row=lane?Number(lane.dataset.track):null,place=lane?regionPlace(event,lane):null,trackKind=lane?(lane.closest('.track-lane')?.querySelector('.track-label')?.dataset.trackKind||null):null;
  const create=kind=>safe(()=>api.createRegionAt(row,place,kind));
  const run={'create-midi':create('midi'),'create-pattern':create('pattern'),paste:safe(()=>api.clipboard('paste')),'select-all':()=>api.selectRegions(api.allClips().map(clip=>clip.id)),'new-tracks':safe(()=>api.newTracks()),'import-audio':safe(()=>api.importAudio()),'toggle-cycle':safe(()=>api.toggleCycle()),
   command:api.command?(name,args)=>safe(()=>api.command(name,args))():undefined,'new-audio':api.newTrackOfKind?safe(()=>api.newTrackOfKind('audio')):undefined,'new-instrument':api.newTrackOfKind?safe(()=>api.newTrackOfKind('instrument')):undefined};
  menuAt(event,tracksBackgroundMenuItems({editable:api.editable(),hasRegions:api.allClips().length>0,trackKind:trackKind==='pattern'?'instrument':trackKind,run:api.createRegionAt?run:{...run,'create-midi':undefined,'create-pattern':undefined}}));
 }
 /** The snapped beat under a pointer on a lane grid. */
 function regionPlace(event,lane){const rect=lane.getBoundingClientRect();return api.snapBeat(Math.max(0,(event.clientX-rect.left)/api.barWidth()*4));}
 // Logic: double-clicking empty space on a software instrument track with the Pointer creates an empty MIDI region.
 on($('#track-lanes'),'dblclick',event=>{const lane=event.target;if(!lane?.matches?.('.lane-grid[data-track]')||api.getTool()!=='select'||!api.createRegionAt)return;const kind=lane.closest('.track-lane')?.querySelector('.track-label')?.dataset.trackKind;if(kind!=='instrument'&&kind!=='pattern')return;event.preventDefault();safe(()=>api.createRegionAt(Number(lane.dataset.track),regionPlace(event,lane),'midi'))();});
 logicShellHooks.regionMenu=regionMenu;logicShellHooks.tracksMenu=tracksMenu;logicShellHooks.isContextClick=event=>isMacContextClick(event);

 // ── Region commands shared by keys, menus and the local menu bar
 async function splitAtPlayhead(clickedId=null){
  const beat=api.playheadBeat(),targets=targetRegions(api.allClips(),{selectedIds:api.selectedIds(),clickedId}).filter(clip=>playheadInside(clip,beat));
  if(!targets.length)return api.toast('Split at Playhead: place the playhead inside a selected region.');
  if(!api.editable())return api.toast('Wait for the current cloud operation to finish.');
  for(const clip of targets){const current=api.findClip(clip.id);if(current&&playheadInside(current,beat))await api.split(current,beat);}
 }
 function muteSelection(){const ids=[...api.selectedIds()];if(!ids.length)return api.toast('Select regions to mute (⌃M).');return api.toggleRegionMute(ids);}
 function repeatSelection(){if(!api.selectedIds().size)return api.toast('Select regions to repeat (⌘R).');return api.repeat();}
 function locatorsToSelection(rounded=false){
  const selected=api.allClips().filter(clip=>api.selectedIds().has(clip.id));if(!selected.length)return api.toast('Select regions to set the locators (⌘U).');
  const start=Math.min(...selected.map(clip=>clip.start)),end=Math.max(...selected.map(clip=>clip.start+clip.length));return rounded?api.setLocators(Math.floor(start/4+1e-6)*4,Math.max(4,Math.ceil(end/4-1e-6)*4)):api.setLocators(start,end);
 }
 on($('#logic-rewind'),'click',event=>safe(()=>moveBars(event.shiftKey?-8:-1))());on($('#logic-forward'),'click',event=>safe(()=>moveBars(event.shiftKey?8:1))());
 /** New Tracks dialog with the track type preselected (⌥⌘A audio, ⌥⌘S software instrument). */
 function newTrackOfKind(kind){api.newTracks();setTimeout(()=>{const select=doc.querySelector('dialog[open] select[name="kind"]');if(!select)return;const option=[...select.options].find(item=>item.value===kind||new RegExp(kind,'i').test(item.textContent));if(option&&select.value!==option.value){select.value=option.value;select.dispatchEvent(new (doc.defaultView?.Event||Event)('change',{bubbles:true}));}},80);}
 function moveBars(bars){const beat=api.playheadBeat(),bar=Math.floor(beat/4+1e-6),within=beat-bar*4>1e-6;return api.jumpTo(Math.max(0,(bar+bars+(bars<0&&within?1:0))*4));}

 // ── Tracks-area local menu bar: Edit / Functions / View
 const checked=(label,shortcut,value,run,extra={})=>({label,shortcut,checked:!!value,run,...extra});
 const localMenus={
  // Logic's Tracks-area local menus. Edit is the application Edit menu; entries Freestyle cannot do stay listed, disabled with the reason.
  edit:()=>api.mainMenu?api.mainMenu('TracksEdit'):[['Undo','⌘Z',()=>api.undo()],['Redo','⇧⌘Z',()=>api.redo()]],
  functions:()=>{const none=!api.selectedIds().size,why=none?'Select one or more regions first.':'',off=(label,title,shortcut='')=>({label,shortcut,disabled:true,title}),key=(label,shortcut,name)=>({label,shortcut,run:()=>api.command(name,[]),disabled:none,title:why});
   return[key('Name Regions by Track Name','⌥⇧N','name-regions-by-track'),key('Name Tracks by Region Name','⌥⇧⌘N','name-track-by-region'),off('Color Regions by Track Color','Freestyle regions and tracks have no colour field.','⌥⇧C'),off('Color Tracks by Region Color','Freestyle regions and tracks have no colour field.','⌥⇧⌘C'),null,
    off('Remove Silence from Audio Region…','Freestyle has no strip-silence operation.','⌃X'),off('Normalize Region Gain…','Set region gain in the Region inspector; there is no normalise analysis.','⌃⌥G'),null,
    off('MIDI Transform','Open the region in the Piano Roll (P): Functions ▸ MIDI Transform.'),off('Copy MIDI Events…','Copy notes in the Piano Roll (⌘C).'),{label:'Delete MIDI Events',submenu:[off('Duplicates','Delete notes in the Piano Roll.'),off('Inside Locators','Delete notes in the Piano Roll.'),off('Outside Locators','Delete notes in the Piano Roll.'),off('Outside Region Boundaries','Delete notes in the Piano Roll.'),off('Unselected Within Selection','Delete notes in the Piano Roll.')]},null,
    off('Lock SMPTE Position','Freestyle has no SMPTE position lock.','⌘PgDn'),off('Unlock SMPTE Position','Freestyle has no SMPTE position lock.','⌘PgUp'),null,
    {label:'Folder',submenu:[off('Pack Folder','Freestyle has no track stacks or folders.','⌃⌥⇧F'),off('Unpack Folder to New Tracks','Freestyle has no track stacks or folders.'),off('Unpack Folder to Existing Tracks','Freestyle has no track stacks or folders.')]}];},
  view:()=>{const off=(label,title,shortcut='')=>({label,shortcut,disabled:true,title});
   return[off('Secondary Ruler','The ruler shows bars and beats only.','⌃⌥⇧R'),off('Marquee Ruler','There is no Marquee tool.'),checked('Catch Playhead','`',api.catchEnabled?.(),()=>api.command('toggle-catch',[])),off('Scroll in Play','The playhead moves over a still Tracks area.','⌃`'),off('Alignment Guides','There are no alignment guides.','⌥⌘G'),null,
    off('Configure Track Header…','Track headers always show number, icon, name, M S R I, volume and pan.','⌥T'),off('Show Flex Pitch/Time','Freestyle has no Flex Time / Flex Pitch.','F'),off('Show Colors','Freestyle regions and tracks have no colour field.','⌥C'),null,
    // Not Logic entries (kept last)
    ['Zoom to Fit','Z',()=>api.zoomToFit()],['Zoom In','⌘→',()=>api.zoomBy(1.25)],['Zoom Out','⌘←',()=>api.zoomBy(.8)]];}
 };
 for(const button of $$('[data-logic-menu]'))on(button,'click',event=>{event.stopPropagation();const build=localMenus[button.dataset.logicMenu];if(build)menuAt(anchor(button),build().map(item=>Array.isArray(item)?[item[0],item[1],safe(item[2]),item[3]]:item&&item.run?{...item,run:safe(item.run)}:item));});
 const drag=$('#logic-drag');if(drag){drag.onchange=()=>{drag.value='overlap';drag.blur();};}
 const snap=$('#snap');if(snap)on(snap,'change',()=>snap.blur());

 // ── Zoom sliders (horizontal = bar width, vertical = track height)
 const hZoom=$('#logic-zoom-h'),vZoom=$('#logic-zoom-v');
 const scaleRange=()=>({min:Math.log(api.minScale?.()||4),max:Math.log(api.maxScale?.()||1200)});
 function paintZoom(){try{const view=api.view(),range=scaleRange();if(hZoom&&doc.activeElement!==hZoom)hZoom.value=String(Math.round((Math.log(view.scale)-range.min)/(range.max-range.min)*100));if(vZoom&&doc.activeElement!==vZoom)vZoom.value=String(Math.round(view.rowHeight));}catch{}}
 on(hZoom,'input',()=>{const range=scaleRange(),scale=Math.exp(range.min+(range.max-range.min)*Number(hZoom.value)/100),view=api.view();if(scale>0&&view.scale>0)api.zoomBy(scale/view.scale,0);});
 on(vZoom,'input',()=>{const view=api.view();api.applyView({...view,rowHeight:Number(vZoom.value)});});

 // ── Track headers (Logic: number, icon, name, M S R I, volume, pan; click selects)
 const trackRow=element=>Number(element?.closest?.('.track-label[data-track]')?.dataset.track);
 function selectTrack(row){if(!Number.isInteger(row))return;state.selectedTrack=row;const laneId=api.laneId(row);if(laneId)api.selectMixerLane?.(laneId);paintTrackSelection();renderInspector();}
 // Logic selects a track on mouse-down: one capture-phase listener reads the row from the pressed header,
 // so the selection is in place before any later handler, render or key command (⌘D, ⌘⌫) runs.
 on($('#track-lanes'),'pointerdown',event=>{const label=event.target?.closest?.('.track-label[data-track]');if(!label||event.button!==0||!label.classList.contains('logic-track-header')||label.classList.contains('logic-track-empty')||event.target.closest('button,input,.logic-knob'))return;selectTrack(Number(label.dataset.track));},true);
 function paintTrackSelection(){for(const label of $$('#track-lanes .track-label[data-track]')){const selected=Number(label.dataset.track)===state.selectedTrack;label.classList.toggle('logic-track-selected',selected);label.closest('.track-lane')?.classList.toggle('logic-track-selected',selected);}}
 function mixerValues(row){
  let mixer=null;try{mixer=api.trackMixerRow(row);}catch{}
  const gain=mixer?.values?.gain,pan=mixer?.values?.pan,solo=mixer?.values?.solo;
  return{mixer,gainKnown:!!(mixer?.controls?.gain?.enabled&&gain?.known),gain:gain?.known?Number(gain.value):null,gainReason:mixer?mixer.controls?.gain?.reason||'':'This row has no saved track yet.',panKnown:!!(mixer?.controls?.pan?.enabled&&pan?.known),pan:pan?.known?Number(pan.value):null,panReason:mixer?mixer.controls?.pan?.reason||'':'This row has no saved track yet.',soloKnown:!!(mixer?.controls?.solo?.enabled&&solo?.known),solo:solo?.known?!!solo.value:null,soloReason:mixer?mixer.controls?.solo?.reason||'':'This row has no saved track yet.'};
 }
 function paintKnob(knob,pan,enabled,reason){if(!knob)return;const value=Number.isFinite(pan)?pan:0;knob.style.setProperty('--pan-angle',`${value*135}deg`);knob.setAttribute('aria-valuenow',String(Math.round(value*64)));knob.setAttribute('aria-disabled',String(!enabled));knob.title=enabled?`Pan ${Math.round(value*64)}`:reason||'Pan unavailable';knob.classList.toggle('disabled',!enabled);}
 /** While a header control is dragged the app holds its live-mix repaint, so the model keeps the pre-drag value until release. */
 const liveGesture=active=>{try{api.liveMixGesture?.(active);}catch{}};
 /** A volume slider that is heard while it moves: `live(gain)` on every input (the app throttles and
  * coalesces), then ONE `commit(before,gain)` on release (one saved write, one Undo step). */
 function bindLiveRange(input,{read,live,commit}){
  if(!input)return;let before=null;
  const begin=()=>{if(before!==null)return true;const start=read();if(!Number.isFinite(start))return false;before=start;liveGesture(true);return true;};
  const end=()=>{if(before===null)return;before=null;liveGesture(false);};
  input.addEventListener('input',()=>{if(begin())try{live?.(dbToGain(Number(input.value)));}catch{}});
  input.addEventListener('change',()=>{if(!begin())return;const start=before;try{commit(start,dbToGain(Number(input.value)));}finally{end();}});
  input.addEventListener('blur',end);
 }
 function bindKnob(knob,{read,commit,live=null}){
  if(!knob||knob.dataset.logicBound)return;knob.dataset.logicBound='1';
  knob.addEventListener('pointerdown',event=>{if(event.button!==0||knob.getAttribute('aria-disabled')==='true')return;event.preventDefault();event.stopPropagation();const start=read();if(!Number.isFinite(start))return;const originY=event.clientY;let value=start,heard=false;knob.setPointerCapture?.(event.pointerId);liveGesture(true);
   const move=next=>{value=Math.max(-1,Math.min(1,start+(originY-next.clientY)/100));knob.style.setProperty('--pan-angle',`${value*135}deg`);if(live)try{heard=live(Math.round(value*1000)/1000)||heard;}catch{}};
   const up=()=>{knob.removeEventListener('pointermove',move);knob.removeEventListener('pointerup',up);knob.removeEventListener('pointercancel',up);try{if(Math.abs(value-start)>1e-4)commit(start,value);else if(heard)try{live(start);}catch{}}finally{liveGesture(false);}};
   knob.addEventListener('pointermove',move);knob.addEventListener('pointerup',up);knob.addEventListener('pointercancel',up);});
  knob.addEventListener('dblclick',event=>{event.stopPropagation();const start=read();if(knob.getAttribute('aria-disabled')!=='true'&&Number.isFinite(start)&&start!==0)commit(start,0);});
 }
 /** Logic: drag a track header up or down to reorder tracks (one Undo step via
  * api.moveTrack → reorderLanes). The drop boundary is shown on the header
  * under the pointer; Escape or a release in place cancels. */
 function trackDropBoundary(clientY){
  const labels=$$('#track-lanes .track-label[data-track]').filter(label=>!label.classList.contains('logic-track-empty'));let last=null;
  for(const label of labels){const rect=label.getBoundingClientRect(),index=Number(label.dataset.track);if(clientY<rect.top+rect.height/2)return{to:index,label,edge:'above'};last={to:index+1,label,edge:'below'};}
  return last;
 }
 function clearTrackDrop(){for(const label of $$('#track-lanes .logic-drop-above,#track-lanes .logic-drop-below,#track-lanes .logic-track-dragging'))label.classList.remove('logic-drop-above','logic-drop-below','logic-track-dragging');}
 function startTrackDrag(event,label,row){
  if(event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||event.target.closest?.('button,input,.logic-knob,[contenteditable="true"]')||!api.moveTrack)return;
  const originY=event.clientY;let dragging=false,drop=null;
  const move=next=>{
   if(!dragging){if(Math.abs(next.clientY-originY)<5)return;dragging=true;label.classList.add('logic-track-dragging');doc.body.classList.add('logic-track-reordering');}
   next.preventDefault?.();clearTrackDrop();label.classList.add('logic-track-dragging');drop=trackDropBoundary(next.clientY);
   if(drop&&drop.to!==row&&drop.to!==row+1)drop.label.classList.add(drop.edge==='above'?'logic-drop-above':'logic-drop-below');
  };
  const finish=(next,cancel=false)=>{
   doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',abort,true);doc.removeEventListener('keydown',key,true);
   clearTrackDrop();doc.body.classList.remove('logic-track-reordering');
   if(!dragging||cancel)return;next?.preventDefault?.();drop=trackDropBoundary(next.clientY);
   if(drop&&drop.to!==row&&drop.to!==row+1)safe(()=>api.moveTrack(row,drop.to))();
  };
  const up=next=>finish(next),abort=()=>finish(null,true),key=next=>{if(next.key==='Escape'){next.preventDefault();next.stopPropagation();finish(null,true);}};
  doc.addEventListener('pointermove',move,true);doc.addEventListener('pointerup',up,true);doc.addEventListener('pointercancel',abort,true);doc.addEventListener('keydown',key,true);
 }
 function decorateTracks(){
  for(const label of $$('#track-lanes .track-label[data-track]')){
   if(!label.classList.contains('logic-track-header')||label.classList.contains('logic-track-pending'))continue;// a track still being created has no controls yet
   if(label.classList.contains('logic-track-empty')){const lane=label.closest('.track-lane');lane?.classList.add('logic-empty-row');const grid=lane?.querySelector('.lane-grid');if(grid&&!grid.dataset.logicBound){grid.dataset.logicBound='1';grid.addEventListener('dblclick',event=>{if(event.target===grid)safe(()=>api.newTracks())();});}continue;}
   const row=Number(label.dataset.track),values=mixerValues(row),volume=label.querySelector('.logic-track-volume'),solo=label.querySelector('.logic-track-s'),pan=label.querySelector('.logic-track-pan');
   if(volume){volume.disabled=!values.gainKnown;volume.title=values.gainKnown?`Volume ${formatDb(values.gain)} dB`:values.gainReason||'Volume unavailable';if(doc.activeElement!==volume&&values.gain!==null)volume.value=String(Math.max(VOLUME_FLOOR_DB,Math.min(VOLUME_CEIL_DB,gainToDb(values.gain))));}
   if(solo){solo.disabled=!values.soloKnown;solo.classList.toggle('on',values.solo===true);solo.setAttribute('aria-pressed',String(values.solo===true));solo.title=values.soloKnown?'Solo track':values.soloReason||'Solo unavailable';}
   paintKnob(pan,values.pan,values.panKnown,values.panReason);
   if(label.dataset.logicBound)continue;label.dataset.logicBound='1';
   label.addEventListener('pointerdown',event=>startTrackDrag(event,label,row));
   for(const control of label.querySelectorAll('button,input,.logic-knob'))control.addEventListener('dblclick',event=>event.stopPropagation());
   solo?.addEventListener('click',event=>{event.stopPropagation();safe(()=>api.toggleTrackSolo(row))();});
   volume?.addEventListener('pointerdown',event=>event.stopPropagation());
   bindLiveRange(volume,{read:()=>{const current=mixerValues(row);return current.gainKnown?current.gain:NaN;},live:gain=>api.liveTrackControl?.(row,'gain',gain),commit:(before,gain)=>safe(()=>api.setTrackControl(row,'gain',before,gain))()});
   bindKnob(pan,{read:()=>mixerValues(row).pan,live:value=>api.liveTrackControl?.(row,'pan',value),commit:(before,value)=>safe(()=>api.setTrackControl(row,'pan',before,Math.round(value*1000)/1000))()});
  }
  paintTrackSelection();
 }

 // ── Inspector: Region, Track and two channel strips (selected track + Stereo Out)
 let inspectorQueued=false;
 function queueInspector(){if(inspectorQueued)return;inspectorQueued=true;Promise.resolve().then(()=>{inspectorQueued=false;renderInspector();});}
 function stripHtml({key,name,gain,gainKnown,gainReason,pan,panKnown,panReason,mute,solo,muteKnown,soloKnown,master=false}){
  const db=gain===null?VOLUME_FLOOR_DB:Math.max(VOLUME_FLOOR_DB,Math.min(VOLUME_CEIL_DB,gainToDb(gain)));
  return `<div class="logic-strip" data-strip="${esc(key)}">${master?'<div class="logic-strip-slot" title="Stereo Out has no copyable channel strip setting">Setting</div>':'<button type="button" class="logic-strip-slot logic-strip-setting" title="Channel Strip Setting: copy or paste this track’s effects">Setting</button>'}<div class="logic-strip-slot eq" title="Open the Mixer (X) for EQ and effect slots">EQ</div><div class="logic-strip-slot" title="Open the Mixer (X) for Audio FX">Audio FX</div><div class="logic-strip-slot output">${master?'Output':'Stereo Out'}</div><span class="logic-knob logic-strip-pan ${panKnown?'':'disabled'}" role="slider" aria-label="${esc(name)} pan" aria-disabled="${!panKnown}" title="${esc(panKnown?'Pan':panReason||'Pan unavailable')}" style="--pan-angle:${(Number.isFinite(pan)?pan:0)*135}deg"></span><output class="logic-strip-db">${gain===null?'—':formatDb(gain)}</output><input type="range" class="logic-strip-fader" orient="vertical" min="${VOLUME_FLOOR_DB}" max="${VOLUME_CEIL_DB}" step="0.1" value="${db}" aria-label="${esc(name)} volume" ${gainKnown?'':'disabled'} title="${esc(gainKnown?'Volume':gainReason||'Volume unavailable')}"><div class="logic-strip-ms">${master?'':`<button type="button" class="logic-strip-m ${mute?'on':''}" ${muteKnown?'':'disabled'} title="Mute">M</button><button type="button" class="logic-strip-s ${solo?'on':''}" ${soloKnown?'':'disabled'} title="Solo">S</button>`}</div><div class="logic-strip-name">${esc(name)}</div></div>`;
 }
 function renderInspector(){
  const host=$('#logic-inspector');if(!host||!state.panes.inspector)return;
  let project;try{project=api.getProject();}catch{return;}if(!project)return;
  const ids=api.selectedIds(),regions=api.allClips().filter(clip=>ids.has(clip.id)),region=regions[0]||null;
  if(region&&Number.isInteger(region.track)&&state.selectedTrack===null)state.selectedTrack=region.track;
  const row=state.selectedTrack??0,trackName=api.trackName(row),values=mixerValues(row),laneKind=api.laneKind(row);
  const pattern=region?.patternId?project.patterns?.find(item=>item.id===region.patternId):null,muted=region?api.regionMuted(region):null;
  const field=(label,value,title='')=>`<div class="logic-insp-row" ${title?`title="${esc(title)}"`:''}><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  const regionHtml=region?`${field('Name',region.name??pattern?.name??'Region')}${field('Type',region.patternId?'Pattern / MIDI region':'Audio region')}${field('Mute',muted===null?'Unknown':muted?'On':'Off')}${field('Loop','Off','Freestyle has no region loop flag; drag the right edge to repeat.')}${field('Quantize',region.patternId?'Off':'—','Quantize notes in the Piano Roll (Q).')}${field('Transpose','—','Not stored on Freestyle regions.')}${field('Velocity','—','Edit note velocities in the Piano Roll.')}${field('Position',`${Math.floor(region.start/4)+1} ${Math.floor(region.start%4)+1}`)}${field('Length',`${Math.floor(region.length/4)} ${Math.round(region.length%4*100)/100}`)}${regions.length>1?field('Selected',`${regions.length} regions`):''}${logicShellHooks.regionRows?logicShellHooks.regionRows(region)||'':''}<div class="logic-insp-actions">${region.patternId?'<button type="button" data-insp="rename">Rename…</button>':''}<button type="button" data-insp="mute">${muted?'Unmute':'Mute'}</button></div>`:'<p class="logic-insp-empty">No regions selected</p>';
  const trackHtml=`${field('Name',trackName)}${field('Type',laneKind==='audio'?'Audio':laneKind==='instrument'?'Software Instrument':laneKind||'Track')}${field('Volume',values.gain===null?'—':formatDb(values.gain)+' dB')}${field('Pan',values.pan===null?'—':String(Math.round(values.pan*64)))}`;
  const open=key=>store.get('insp:'+key,true)?' open':'';
  if(!host.querySelector(':scope>.logic-insp-info'))host.innerHTML='<div class="logic-insp-info"></div><div class="logic-insp-strips"></div>';
  const info=host.querySelector(':scope>.logic-insp-info'),stripsHost=host.querySelector(':scope>.logic-insp-strips');
  info.innerHTML=`<details class="logic-insp-section" data-section="region"${open('region')}><summary>Region: <b>${esc(region?(region.name??pattern?.name??'Region'):'—')}</b></summary>${regionHtml}</details><details class="logic-insp-section" data-section="track"${open('track')}><summary>Track: <b>${esc(trackName)}</b></summary>${trackHtml}</details>`;
  for(const details of info.querySelectorAll('details'))details.addEventListener('toggle',()=>store.set('insp:'+details.dataset.section,details.open));
  info.querySelector('[data-insp="rename"]')?.addEventListener('click',safe(()=>api.renameRegion(region)));
  info.querySelector('[data-insp="mute"]')?.addEventListener('click',safe(()=>api.toggleRegionMute(regions.map(item=>item.id))));
  if(region)logicShellHooks.bindRegionRows?.(info,region);
  renderInspectorStrips(stripsHost,row,trackName,values);
 }
 /** Channel strips: the Mixer's own Logic strips (selected track + Stereo Out) when the
  * mixer exposes them, else a compact strip pair bound to the same mixer actions. */
 function renderInspectorStrips(host,row,trackName,values){
  if(api.mountInspectorStrips&&!state.stripsFailed){
   try{if(!state.strips||!state.strips.view?.element?.isConnected){state.strips?.destroy?.();host.innerHTML='';state.strips=api.mountInspectorStrips(host,{getLaneId:()=>api.laneId(state.selectedTrack??0)});state.stripsRow=row;}
    else if(state.stripsRow!==row){state.stripsRow=row;state.strips.render();}
    return;}catch{state.strips=null;state.stripsFailed=!api.mixerReady?.();}
  }
  let master=null;try{master=api.masterRow();}catch{}
  const masterGain=master?.values?.gain;
  host.innerHTML=stripHtml({key:'track',name:trackName,gain:values.gain,gainKnown:values.gainKnown,gainReason:values.gainReason,pan:values.pan,panKnown:values.panKnown,panReason:values.panReason,mute:values.mixer?.values?.mute?.value===true,solo:values.solo===true,muteKnown:!!(values.mixer?.controls?.mute?.enabled&&values.mixer?.values?.mute?.known),soloKnown:values.soloKnown})+stripHtml({key:'master',name:'Stereo Out',master:true,gain:masterGain?.known?Number(masterGain.value):null,gainKnown:!!(master?.controls?.gain?.enabled&&masterGain?.known),gainReason:master?.controls?.gain?.reason||'Master gain unavailable',pan:null,panKnown:false,panReason:'Stereo Out pan is live-only; use the Mixer (X).'});
  const trackStrip=host.querySelector('[data-strip="track"]'),masterStrip=host.querySelector('[data-strip="master"]');
  bindLiveRange(trackStrip?.querySelector('.logic-strip-fader'),{read:()=>{const current=mixerValues(row);return current.gainKnown?current.gain:NaN;},live:gain=>api.liveTrackControl?.(row,'gain',gain),commit:(before,gain)=>safe(()=>api.setTrackControl(row,'gain',before,gain))()});
  trackStrip?.querySelector('.logic-strip-setting')?.addEventListener('click',event=>{event.stopPropagation();safe(()=>api.channelStripSetting?api.channelStripSetting(api.laneId(row),event):api.toast('Open the Mixer (X) for channel strip settings.'))();});
  trackStrip?.querySelector('.logic-strip-m')?.addEventListener('click',safe(()=>api.toggleTrackMute(row)));
  trackStrip?.querySelector('.logic-strip-s')?.addEventListener('click',safe(()=>api.toggleTrackSolo(row)));
  bindKnob(trackStrip?.querySelector('.logic-strip-pan'),{read:()=>mixerValues(row).pan,live:value=>api.liveTrackControl?.(row,'pan',value),commit:(before,value)=>safe(()=>api.setTrackControl(row,'pan',before,Math.round(value*1000)/1000))()});
  masterStrip?.querySelector('.logic-strip-fader')?.addEventListener('change',event=>{const current=api.masterRow();const before=current?.values?.gain;if(before?.known)safe(()=>api.setMasterGain(Number(before.value),dbToGain(Number(event.target.value))))();});
 }

 // ── OS file import: a placeholder region at the drop spot (progress + Cancel) instead of a window-wide dim.
 function paintImportGhost(snapshot){
  const host=$('#arrangement');let ghost=$('#logic-import-ghost');
  const target=snapshot?.target,active=!!snapshot?.busy&&target?.zone==='playlist'&&Number.isFinite(target.beat);
  doc.body.classList.toggle('logic-file-import',!!snapshot?.busy);
  if(!active||!host){ghost?.remove();return;}
  const rect=api.trackRect(Number.isInteger(target.track)?target.track:0);if(!rect){ghost?.remove();return;}
  if(!ghost){ghost=doc.createElement('div');ghost.id='logic-import-ghost';ghost.className='clip audio-clip logic-import-ghost';ghost.setAttribute('role','status');ghost.innerHTML='<div class="clip-title"></div><div class="logic-import-progress" aria-hidden="true"></div><button type="button" class="logic-import-cancel">Cancel</button>';ghost.querySelector('button').addEventListener('click',event=>{event.stopPropagation();safe(()=>api.cancelFileDrop())();});host.append(ghost);}
  const files=(snapshot.files||[]).map(file=>file?.name||file).filter(Boolean),beats=8;
  ghost.style.cssText=`left:${rect.left+target.beat*api.barWidth()/4}px;top:${rect.top+1}px;width:${Math.max(40,beats*api.barWidth()/4)}px;height:${Math.max(16,rect.height-3)}px`;
  ghost.dataset.state=snapshot.writeStarted?'writing':'pending';
  ghost.querySelector('.clip-title').textContent=`${files[0]||'Audio'}${files.length>1?` +${files.length-1}`:''} · ${snapshot.writeStarted?'importing…':'preparing…'}`;
  const cancel=ghost.querySelector('button');cancel.disabled=!snapshot.cancellable;cancel.title=snapshot.cancellable?'Cancel before uploading':'Already uploading; Freestyle finishes this import (Undo removes it).';
 }
 logicShellHooks.fileDrop=paintImportGhost;

 // ── Hooks the application calls after its own renders
 logicShellHooks.afterTracks=()=>{decorateTracks();paintZoom();paintTools();paintCycle();queueInspector();};
 // Logic: selecting a region selects its track, so the Inspector Track section and strips follow it.
 // Only a NEW region selection (or a press on a region) moves the track selection: a later repaint of the
 // same region selection (refresh, waveform, mixer render) must not undo a track-header click, or ⌘D /
 // ⌘⌫ right after the click would act on the previously selected track.
 let regionSelectionKey=null;
 const regionKey=ids=>[...ids].map(String).sort().join('\u0000');
 const regionPress=event=>{if(event.target?.closest?.('.clip[data-clip]'))regionSelectionKey=null;};
 on($('#track-lanes'),'pointerdown',regionPress,true);on($('#track-lanes'),'contextmenu',regionPress,true);
 logicShellHooks.selection=()=>{try{const ids=api.selectedIds(),key=regionKey(ids),changed=key!==regionSelectionKey;regionSelectionKey=key;const region=changed?api.allClips().find(clip=>ids.has(clip.id)):null;if(region&&Number.isInteger(region.track)&&region.track!==state.selectedTrack){selectTrack(region.track);return;}}catch{}queueInspector();};
 logicShellHooks.mixer=()=>{decorateTracks();queueInspector();};

 // Control-bar view buttons toggle like Logic (no FL raise-before-close): Mixer, Editors, Step Sequencer.
 const viewButton=selector=>$(`.logic-view-buttons ${selector}`);
 const mixerButton=viewButton('[data-window="mixer"]');if(mixerButton)mixerButton.onclick=()=>toggleMixerPane();
 const editorsButton=viewButton('[data-window="piano"]');if(editorsButton)editorsButton.onclick=()=>toggleEditor();
 const stepButton=viewButton('[data-window="rack"]');if(stepButton)stepButton.onclick=()=>activeEditorKind()==='step'?closeEditor():openEditor('step');
 // ── Logic key commands
 /** X shows or hides the Mixer outright (Logic), never just raises it. */
 function toggleMixerPane(){const visible=api.windowVisible('mixer');return api.toggleMixer?api.toggleMixer(!visible):(visible?null:api.showWindow('mixer'));}
 const handlers={
  'toggle-cycle':safe(()=>toggleCycleNow()),record:safe(()=>api.record()),'tool-menu':()=>openToolMenu(),'pick-tool':action=>{closeToolMenu();pickTool(action.tool);},'quantize':()=>quantizeSelection(),'close-tool-menu':()=>closeToolMenu(),
  'mute-track':safe(()=>{const row=state.selectedTrack;if(!Number.isInteger(row))return api.toast('Select a track to mute it (M).');return api.toggleTrackMute(row);}),
  'solo-track':safe(()=>{const row=state.selectedTrack;if(!Number.isInteger(row))return api.toast('Select a track to solo it (S).');return api.toggleTrackSolo(row);}),
  'zoom-to-fit':safe(()=>api.zoomToFit?.()),
  'toggle-plugin-windows':()=>{const windows=[...doc.querySelectorAll('dialog.logic-plugin-window')];if(!windows.length)return api.toast('No plug-in windows are open (V shows or hides them).');const hide=windows.some(item=>item.style.visibility!=='hidden');for(const item of windows)item.style.visibility=hide?'hidden':'';},
  'new-audio-track':safe(()=>newTrackOfKind('audio')),'new-instrument-track':safe(()=>newTrackOfKind('instrument')),
  'join-regions':()=>api.toast('Join (⌘J): Freestyle has no region join operation yet.'),'join-notes':safe(()=>api.joinNotes?api.joinNotes():api.toast('Select two or more notes to join (⌘J).')),
  'toggle-count-in':()=>{const button=$('#logic-count-in');if(button&&!button.disabled)button.click();else api.toast('Count-in is unavailable right now.');},
  'go-to-position':safe(()=>api.goToPosition?api.goToPosition():api.toast('Go to Position is unavailable.')),
  'toggle-mixer':()=>toggleMixerPane(),'toggle-editors':()=>toggleEditor(),'toggle-piano-roll':()=>activeEditorKind()==='piano'?closeEditor():openEditor('piano'),
  'toggle-library':()=>togglePane('library'),'toggle-inspector':()=>togglePane('inspector'),'toggle-automation':()=>togglePane('automation'),'toggle-browser':()=>togglePane('browser'),'toggle-loops':()=>togglePane('loops'),
  'toggle-metronome':safe(()=>api.toggleMetronome()),'toggle-musical-typing':()=>toggleMusicalTyping(),
  'new-tracks':safe(()=>api.newTracks()),'repeat-notes':safe(()=>api.repeatNotes?api.repeatNotes():api.toast('Select notes to repeat (⌘R).')),'split-at-playhead':safe(()=>splitAtPlayhead()),'repeat-regions':safe(repeatSelection),'mute-regions':safe(muteSelection),'locators-to-selection':safe(action=>locatorsToSelection(action?.args?.[0]==='rounded')),'play-from-selection':safe(()=>api.playFromSelection?api.playFromSelection():api.toast('Play from Selection is unavailable.')),
  // ⌘← / ⌘→ zoom the focused editor (the Piano Roll when it has the focus, else the Tracks area).
  'zoom-horizontal':action=>{if(api.activeEditor()==='piano'&&api.zoomPiano)return api.zoomPiano(action.direction>0?1.25:.8);return api.zoomBy(action.direction>0?1.25:.8);},'zoom-vertical':action=>{if(api.activeEditor()==='piano')return api.toast('The Piano Roll has one row height; ⌘↑ / ⌘↓ zoom the Tracks area rows.');const view=api.view();api.applyView({...view,rowHeight:view.rowHeight*(action.direction>0?1.25:.8)});},
  'go-to-start':safe(()=>api.goToStart()),'move-bars':safe(action=>moveBars(action.bars)),
  bounce:safe(()=>api.bounce()),'import-midi':safe(()=>api.importMidi()),'import-other':safe(()=>api.importOther?api.importOther():api.importMidi()),'import-audio':safe(()=>api.importAudio()),'undo-history':safe(()=>api.undoHistory?api.undoHistory():api.showHistory()),
  'duplicate-track':safe(()=>withSelectedTrack('New Track with Duplicate Settings (⌘D)',row=>api.duplicateTrack(row))),'delete-track':safe(()=>withSelectedTrack('Delete Track (⌘⌫)',row=>api.deleteTrack(row)))
 };
 // Default key command table: rows Freestyle cannot do answer with their reason; region / track selection keys.
 handlers.unavailable=action=>api.toast(unavailableMessage(action.row));
 handlers.help=()=>openHelp();handlers['key-commands']=()=>openKeyCommands();handlers['tempo-list']=safe(()=>api.timing());
 const orderedRegions=()=>[...api.allClips()].sort((a,b)=>a.start-b.start||a.track-b.track);
 handlers['select-region']=action=>{const all=orderedRegions(),step=Number(action.args[0]);if(!all.length)return api.toast('There are no regions to select.');const ids=api.selectedIds(),row=state.selectedTrack,onTrack=Number.isInteger(row)?all.filter(clip=>clip.track===row):all,pool=onTrack.length?onTrack:all,indexes=pool.map((clip,index)=>ids.has(clip.id)?index:-1).filter(index=>index>=0),next=indexes.length?(step>0?Math.max(...indexes)+1:Math.min(...indexes)-1):(step>0?0:pool.length-1);if(next<0||next>=pool.length)return;api.selectRegions([pool[next].id]);};
 handlers['extend-region']=action=>{const all=orderedRegions(),step=Number(action.args[0]),ids=new Set(api.selectedIds()),indexes=all.map((clip,index)=>ids.has(clip.id)?index:-1).filter(index=>index>=0);if(!all.length)return;const next=indexes.length?(step>0?Math.max(...indexes)+1:Math.min(...indexes)-1):(step>0?0:all.length-1);if(next<0||next>=all.length)return;ids.add(all[next].id);api.selectRegions([...ids]);};
 handlers['select-track']=action=>{const rows=$$('#track-lanes .track-label[data-track]').filter(label=>!label.classList.contains('logic-track-empty')).map(label=>Number(label.dataset.track));if(!rows.length)return;const at=rows.indexOf(state.selectedTrack),next=rows[Math.max(0,Math.min(rows.length-1,(at<0?(Number(action.args[0])>0?-1:rows.length):at)+Number(action.args[0])))];selectTrack(next);$(`#track-lanes .track-label[data-track="${next}"]`)?.scrollIntoView?.({block:'nearest'});};
 handlers['tool-step']=action=>{if(editorFocused()){const tools=LOGIC_PIANO_TOOLS.filter(item=>!item.unsupported),at=tools.findIndex(item=>item.id===($('#piano')?.dataset.pianoTool||'select')),next=tools[(at+Number(action.args[0])+tools.length)%tools.length];setEditorTool(next.id);return api.toast(`${next.label} selected`);}const tools=LOGIC_TOOLS.filter(item=>!item.unsupported),at=tools.findIndex(item=>item.tool===currentTool());setTool(tools[(at+Number(action.args[0])+tools.length)%tools.length].tool);};
 /** Every other table command is an application command (app.js logicKeyCommand). */
 const routed=new Proxy(handlers,{get:(target,name)=>target[name]||(typeof name==='string'&&api.command?safe(action=>api.command(name,action?.args||[])):undefined)});
 /** Track commands act on the selected track (click its header, or select one of its regions). */
 function withSelectedTrack(label,run){const row=state.selectedTrack;if(!Number.isInteger(row)||!api.laneId(row))return api.toast(`${label}: select a track first.`);return run(row);}
 state.disposers.push(installLogicKeys(doc.defaultView||globalThis,{getContext:event=>({hasSelection:api.selectedIds().size>0,editor:api.activeEditor(),dialogOpen:api.dialogOpen(event),toolMenuOpen:state.toolMenuOpen,/* an open menu or pop-up owns the keyboard (arrow / Home / End / letter navigation) */menuOpen:!state.toolMenuOpen&&!!$('#context-menu')&&!$('#context-menu').classList.contains('hidden'),typingEnabled:api.typingEnabled?.()}),handlers:routed}));

 // ── Help (Logic key commands)
 const help=$('#help');if(help)help.onclick=()=>openHelp();
 function openHelp(){
  const rows=[['Play / Stop','Space'],['Play / Pause','⌘ Space'],['Play from Selection','⇧ Space'],['Send All Notes Off','double-click Stop'],['Go to Beginning','Return'],['Rewind / Forward one bar',', / .'],['Cycle on / off','C'],['Record','R'],['Tool menu (then T P E I J M Y A)','T'],['Mixer','X'],['Editors / Piano Roll','E / P'],['Browser (Library)','B'],['Inspector','I'],['Track Automation','A'],['Loop Browser','O'],['Audio Track Editor','W'],['All key commands…','⌥ K'],['Metronome Click','K'],['Musical Typing','⌘ K'],['New Tracks…','⌥ ⌘ N'],['Split at Playhead','⌘ T (or ⌃ T in a browser tab)'],['Repeat Regions','⌘ R'],['Mute Regions','⌃ M'],['Set Locators by Regions','⌘ U'],['Copy region while dragging','⌥ drag'],['Zoom horizontally / vertically','⌘ ← → / ⌘ ↑ ↓'],['Zoom to a dragged area','⌃ ⌥ drag'],['Undo / Redo','⌘ Z / ⇧ ⌘ Z'],['Cut / Copy / Paste','⌘ X / ⌘ C / ⌘ V'],['Select All','⌘ A'],['Delete','⌫'],['Save','⌘ S'],['Bounce Project or Section…','⌘ B'],['Import Audio File… / MIDI File…','⇧ ⌘ I / ⌘ I'],['Undo History…','⌃ ⌥ ⌘ Z'],['New Track with Duplicate Settings','⌘ D'],['Delete Track','⌘ ⌫'],['Reorder tracks','drag a track header']];
  const d=api.dialog('Trashlab',`<p>A web studio for the Freestyle cloud DAW. All audio is rendered and played in the cloud.</p><div class="shortcuts">${rows.map(([label,key])=>`<span>${esc(label)}</span><kbd>${esc(key)}</kbd>`).join('')}</div><p>Right-click (or Control-click) a region or track for its menu. The Eraser tool or Delete removes regions. Freestyle-specific tools live in the Freestyle menu.</p><button type="button" data-help="engine">Freestyle tools</button>`);
  d.querySelector('[data-help="engine"]')?.addEventListener('click',()=>{d.close();safe(()=>api.openCloudPanel())();});
  return d;
 }

 /** ⌥K: every default key command, where it applies and what it does here. */
 function openKeyCommands(){
  const status=row=>row.kind==='unavailable'?`Not available: ${row.reason}`:row.kind==='native'?'Works':'Works',scopes=row=>[...row.scope].map(letter=>KEY_COMMAND_SCOPES[letter]||letter).join(', ');
  const d=api.dialog('Key Commands',`<p>Default key commands. Commands Freestyle cannot perform are still bound and answer with the reason. Keys marked ⓑ are taken by a normal browser tab.</p><input type="search" class="logic-keycmd-search" placeholder="Search commands or keys" aria-label="Search key commands"><div class="logic-keycmd-list" role="table">${LOGIC_KEY_COMMANDS.map(row=>`<div class="logic-keycmd-row${row.kind==='unavailable'?' off':''}" role="row" data-search="${esc((row.name+' '+row.keys+' '+scopes(row)).toLowerCase())}"><span role="cell">${esc(row.name)}</span><kbd role="cell">${esc(row.keys.replace(/^kp/,'keypad '))}${row.reserved?' ⓑ':''}</kbd><small role="cell">${esc(scopes(row))}</small><small role="cell">${esc(status(row))}</small></div>`).join('')}</div>`,{className:'logic-keycmd-dialog'});
  const search=d.querySelector('.logic-keycmd-search');search?.addEventListener('input',()=>{const query=search.value.trim().toLowerCase();for(const row of d.querySelectorAll('.logic-keycmd-row'))row.hidden=!!query&&!row.dataset.search.includes(query);});
  return d;
 }
 return{state,togglePane,openKeyCommands,openToolMenu,closeToolMenu,renderInspector,decorateTracks,selectTrack,splitAtPlayhead,regionMenu,tracksMenu,openHelp,destroy(){for(const dispose of state.disposers.splice(0))try{dispose();}catch{}for(const key of Object.keys(logicShellHooks))delete logicShellHooks[key];}};
}
