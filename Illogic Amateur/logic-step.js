/** Illogic Amateur — Step Sequencer shell.
 * Lays the proven step-pattern editing (app.js renderRack and its step gesture, row menus and
 * key commands) out as the reference Step Sequencer: local bar (Edit · Functions · View, Pattern
 * Browser, pattern preview, edit-mode selector, zoom), the row-defaults bar (add row, rate,
 * direction, rotate, decrement/increment · key, scale, pattern length), row headers and the step
 * grid. Everything here goes through the callbacks app.js passes to installStepSequencer; controls
 * the engine cannot back (step rate, direction, scale, key, live record, mono, subrows) are drawn
 * disabled with the reason as their tooltip.
 */
import {DEFAULT_STEP_VELOCITY,rackGraphVelocity} from './rack-graph-editor.js';

const lit=value=>value===true||typeof value==='number'&&value>0;
/** Velocity step of the decrement / increment buttons: 8 of 127. */
export const STEP_VELOCITY_NUDGE=8/127;
export const STEP_VELOCITY_MIN=1/127;
export const STEP_ROW_HEIGHT=Object.freeze({min:44,max:84,default:49});
/** Step width of the "narrow" view (px); the "wide" view fits 16 steps to the editor's width. */
export const STEP_WIDTH_MIN=24;

/** Stored value for a lit step: the engine default stays `true`, anything else is its 0..1 velocity. */
export function stepValue(velocity){
 const value=Math.max(STEP_VELOCITY_MIN,Math.min(1,Number(velocity)));
 if(!Number.isFinite(value))return true;
 return Math.abs(value-DEFAULT_STEP_VELOCITY)<1e-9?true:Math.round(value*127)/127;
}
/** Velocity under the pointer in a step cell: the cell's bottom edge is 1/127, its top edge 127/127. */
export function velocityAtPointer(clientY,top,height){
 if(!(height>0))return DEFAULT_STEP_VELOCITY;
 return Math.max(STEP_VELOCITY_MIN,Math.min(1,1-(clientY-top)/height));
}
/** Decrement / increment: every lit step of the row moves by `delta` (clamped to 1…127); unlit steps stay off. */
export function nudgeStepVelocities(row,delta){
 return (Array.isArray(row)?row:[]).map(step=>lit(step)?stepValue(rackGraphVelocity(step)+delta):step);
}
/** One step set to a velocity (lighting it), on a copy of the row padded to hold that index. */
export function setStepVelocity(row,index,velocity){
 const next=Array.isArray(row)?row.slice():[];while(next.length<=index)next.push(false);
 next[index]=stepValue(velocity);return next;
}

const ROW_KINDS=Object.freeze([
 // Row colours as the reference assigns them to kit pieces: kicks pink, snares / rims / claps orange, …
 Object.freeze({kind:'kick',test:/kick|\bbd\b|bass ?drum|\b808\b|\bsub\b/i,color:'#f552d2'}),
 Object.freeze({kind:'snare',test:/snare|\bsd\b|\brim|clap|snap|side ?stick/i,color:'#ff9a06'}),
 Object.freeze({kind:'hat',test:/hat|\bhh\b|cymbal|ride|crash|splash|shaker|tamb/i,color:'#f4d83a'}),
 Object.freeze({kind:'tom',test:/\btom|conga|bongo|timbale|taiko/i,color:'#56d364'}),
 Object.freeze({kind:'perc',test:/perc|cowbell|clave|wood|block|bell|tri|agogo|guiro|cabasa|stick|fx|noise/i,color:'#48c6ef'}),
]);
const ROW_CYCLE=Object.freeze(['#f552d2','#ff9a06','#f4d83a','#56d364','#48c6ef','#b98cff']);
/** Kit piece for a row name ('kick' | 'snare' | 'hat' | 'tom' | 'perc'), 'keys' for an instrument row, else 'pad'. */
export function stepRowKind(name,type=''){
 const text=String(name||'');for(const entry of ROW_KINDS)if(entry.test.test(text))return entry.kind;
 return ['instrument','plugin'].includes(type)?'keys':'pad';
}
/** Row colour: the channel's own colour when it has one, else by kit piece, else a cycle by row index. */
export function stepRowColor(name,index=0,explicit=''){
 if(typeof explicit==='string'&&/^#[0-9a-f]{3,8}$/i.test(explicit.trim()))return explicit.trim();
 const text=String(name||'');for(const entry of ROW_KINDS)if(entry.test.test(text))return entry.color;
 return ROW_CYCLE[((Number(index)||0)%ROW_CYCLE.length+ROW_CYCLE.length)%ROW_CYCLE.length];
}

// ── Icons (drawn here; 1.25 px strokes in currentColor on a 20 × 16 or 22 × 22 box)
const svg=(box,body,extra='')=>`<svg viewBox="0 0 ${box}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>`;
const ICONS={
 browser:svg('20 16','<rect x="4.5" y="2.5" width="9" height="9" rx="1.5"/><path d="M7 5.5h4M7 8.5h4"/><path d="M7 13.5h7.5a1 1 0 0 0 1-1V5" opacity=".9"/><path d="M9.2 9.6v1.9M12.4 9.6v1.9M6 11.5h8" opacity="0"/>'),
 inspector:svg('20 16','<rect x="3.5" y="2.5" width="13" height="4.6" rx="2.3"/><circle cx="13.6" cy="4.8" r="1.2" fill="currentColor" stroke="none"/><rect x="3.5" y="8.9" width="13" height="4.6" rx="2.3"/><circle cx="6.4" cy="11.2" r="1.2" fill="currentColor" stroke="none"/>'),
 learn:svg('24 16','<path d="M2.5 5.5 5 8l-2.5 2.5"/><circle cx="14" cy="8" r="5.5"/><circle cx="11.4" cy="8.6" r=".8" fill="currentColor" stroke="none"/><circle cx="12.4" cy="6" r=".8" fill="currentColor" stroke="none"/><circle cx="15.6" cy="6" r=".8" fill="currentColor" stroke="none"/><circle cx="16.6" cy="8.6" r=".8" fill="currentColor" stroke="none"/><path d="M13 12.6v-1.3h2v1.3"/>'),
 preview:svg('24 16','<circle cx="10" cy="8" r="5.5"/><circle cx="7.4" cy="8.6" r=".8" fill="currentColor" stroke="none"/><circle cx="8.4" cy="6" r=".8" fill="currentColor" stroke="none"/><circle cx="11.6" cy="6" r=".8" fill="currentColor" stroke="none"/><circle cx="12.6" cy="8.6" r=".8" fill="currentColor" stroke="none"/><path d="M9 12.6v-1.3h2v1.3"/><path d="M19 5.5 21.5 8 19 10.5"/>'),
 mono:svg('20 16','<path d="M7.8 1.8l4.4 4.4M12.2 1.8 7.8 6.2"/><rect x="7.6" y="9.4" width="4.8" height="4.8" rx=".8"/>'),
 liverec:svg('24 16','<path d="M2.5 5.5 5 8l-2.5 2.5"/><circle cx="14" cy="8" r="5.5"/><path d="M12.2 10.8V5.2h2.1a1.7 1.7 0 0 1 0 3.4h-2.1M14.3 8.6l1.6 2.2"/>'),
 speaker:svg('20 16','<path d="M4 6.2h2.4L10.5 3v10L6.4 9.8H4z" fill="currentColor"/><path d="M13.4 7.2v1.6" stroke-width="1.6"/>'),
 autozoom:svg('20 16','<path d="M5 2h10M5 14h10"/><path d="M10 4.4v7.2M7.6 6.6 10 4.3l2.4 2.3M7.6 9.4 10 11.7l2.4-2.3"/>'),
 vzoom:svg('10 16','<path d="M5 2.6v10.8M2.4 5.2 5 2.5l2.6 2.7M2.4 10.8 5 13.5l2.6-2.7"/>'),
 hzoom:svg('16 16','<path d="M2.6 8h10.8M5.2 5.4 2.5 8l2.7 2.6M10.8 5.4 13.5 8l-2.7 2.6"/>'),
 narrow:svg('20 16','<rect x="6.5" y="2.5" width="7" height="11" rx="1.4"/>'),
 wide:svg('20 16','<rect x="3.5" y="3.5" width="13" height="9" rx="1.4"/>'),
 plus:svg('14 14','<path d="M7 2.5v9M2.5 7h9"/>',' class="ss-plus"'),
 chevron:svg('8 8','<path d="M1.5 2.8 4 5.3l2.5-2.5"/>',' class="ss-chevron"'),
 updown:svg('8 12','<path d="M1.6 4.6 4 2.2l2.4 2.4M1.6 7.4 4 9.8l2.4-2.4"/>',' class="ss-updown"'),
 disclosure:svg('8 10','<path d="M2.4 1.6 5.8 5 2.4 8.4"/>'),
 arrow:svg('16 10','<path d="M2 5h11M9.6 1.8 12.9 5 9.6 8.2"/>'),
 rotateLeft:svg('14 12','<path d="M5 3.2v5.6L1.6 6z" fill="currentColor" stroke="none"/><rect x="7" y="2.5" width="4.6" height="7" rx="1"/>'),
 rotateRight:svg('14 12','<rect x="2.4" y="2.5" width="4.6" height="7" rx="1"/><path d="M9 3.2v5.6L12.4 6z" fill="currentColor" stroke="none"/>'),
 down:svg('12 10','<path d="M2 3.2 6 7.2l4-4"/>'),
 up:svg('12 10','<path d="M2 6.8 6 2.8l4 4"/>'),
 // Row icons (22 × 22, in the row colour)
 kick:svg('22 22','<circle cx="11" cy="9.2" r="7.2" fill="currentColor" fill-opacity=".92"/><path d="M11 9.4v7.4" stroke="var(--ss-icon-ink,#2a2a2a)" stroke-width="1.5"/><circle cx="11" cy="9.6" r="1.5" fill="var(--ss-icon-ink,#2a2a2a)" stroke="none"/><path d="M6.4 15.4 4.6 20M15.6 15.4l1.8 4.6M9.4 16.6h3.2v3.2H9.4z" fill="currentColor"/>'),
 snare:svg('22 22','<ellipse cx="11" cy="7" rx="7.6" ry="2.8" fill="currentColor" fill-opacity=".9"/><path d="M3.4 7v8c0 1.6 3.4 2.8 7.6 2.8s7.6-1.2 7.6-2.8V7"/><path d="M6.4 10v6.6M11 10.4v7.2M15.6 10v6.6" opacity=".9"/><path d="M3.4 12c0 1.6 3.4 2.8 7.6 2.8s7.6-1.2 7.6-2.8" opacity=".9"/>'),
 hat:svg('22 22','<path d="M2.6 8.6c2.2-1.7 5.2-2.6 8.4-2.6s6.2.9 8.4 2.6c-2.2 1-5.2 1.5-8.4 1.5s-6.200-.5-8.400-1.500z" fill="currentColor" fill-opacity=".9"/><path d="M2.6 11.800c2.2 1 5.2 1.5 8.4 1.5s6.200-.5 8.400-1.500"/><path d="M11 3v3M11 13.4V20M7.600 20h6.800"/>'),
 tom:svg('22 22','<ellipse cx="11" cy="6.4" rx="6.6" ry="2.4" fill="currentColor" fill-opacity=".9"/><path d="M4.400 6.400v9.200c0 1.300 3 2.400 6.600 2.400s6.600-1.100 6.600-2.400V6.400"/><path d="M7.200 9.200v8M14.800 9.200v8" opacity=".9"/>'),
 perc:svg('22 22','<path d="M5 5.500h12l-1.600 11.500H6.600z" fill="currentColor" fill-opacity=".25"/><path d="M5 5.500h12l-1.600 11.500H6.600z"/><ellipse cx="11" cy="5.500" rx="6" ry="1.800" fill="currentColor" fill-opacity=".9"/>'),
 pad:svg('22 22','<rect x="3.500" y="3.500" width="15" height="15" rx="3" fill="currentColor" fill-opacity=".25"/><rect x="3.500" y="3.500" width="15" height="15" rx="3"/><rect x="7" y="7" width="3.400" height="3.400" rx=".8" fill="currentColor" stroke="none"/><rect x="11.600" y="7" width="3.400" height="3.400" rx=".8" fill="currentColor" stroke="none"/><rect x="7" y="11.600" width="3.400" height="3.400" rx=".8" fill="currentColor" stroke="none"/><rect x="11.600" y="11.600" width="3.400" height="3.400" rx=".8" fill="currentColor" stroke="none"/>'),
 keys:svg('22 22','<rect x="3" y="5" width="16" height="12" rx="1.800" fill="currentColor" fill-opacity=".22"/><rect x="3" y="5" width="16" height="12" rx="1.800"/><path d="M7 5v12M11 5v12M15 5v12"/><path d="M8.300 5v6.500h1.400V5M12.300 5v6.500h1.400V5" fill="currentColor"/>'),
};
export const stepIconMarkup=name=>ICONS[name]||'';

const NO=Object.freeze({
 rate:'Freestyle step patterns use 1/16 steps; other step rates are not available from the engine',
 direction:'Playback direction: Freestyle plays step patterns forward only',
 key:'Pattern key: step rows trigger sounds, not scale notes, so there is no pattern key to set',
 scale:'Scale: step rows trigger sounds, not scale notes, so scale quantize is not available',
 subrows:'Subrows are not available: use Velocity / Value to edit step velocities in the row',
 inspector:'The local inspector is not available: row settings are in each row’s menu (the arrows beside its name)',
 learn:'Learn (add rows by playing MIDI notes) is not available: add rows with +',
 mono:'Mono Mode is not available: rows are always polyphonic',
 liveRecord:'Live Record is not available: record steps with R on the track instead',
 mode:'This edit mode is not available: Freestyle step patterns store step on/off and velocity',
});

let api=null;const state={rowHeight:STEP_ROW_HEIGHT.default,width:100,autoZoom:false,sound:true,cursor:null,drag:null};
const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const store={get(key){try{return localStorage.getItem('illogic:step-'+key);}catch{return null;}},set(key,value){try{localStorage.setItem('illogic:step-'+key,String(value));}catch{}}};
const velocityMode=()=>!!api?.velocityMode?.();
const stepRowId=row=>row?.dataset?.channel||null;
const isStepRow=row=>!!row?.querySelector?.('.step:not(:disabled)');
const focusedRow=()=>$('#rack-channels .rack-channel.selected');

function fillIcons(root=document){for(const node of root.querySelectorAll('[data-ss-icon]'))if(!node.firstElementChild||node.dataset.ssIconDone!==node.dataset.ssIcon){const label=[...node.childNodes].filter(child=>child.nodeType===3).map(child=>child.textContent).join('').trim();node.innerHTML=(ICONS[node.dataset.ssIcon]||'')+(label?`<span>${label}</span>`:'');node.dataset.ssIconDone=node.dataset.ssIcon;}}
function pressed(node,on){if(!node)return;node.setAttribute('aria-pressed',String(!!on));node.classList.toggle('lit',!!on);}

// ── Zoom (row height, step width) — view state only, remembered per browser
function applyZoom(){
 const rack=$('#rack'),rows=$('#rack-channels');if(!rack||!rows)return;
 let height=state.rowHeight;
 if(state.autoZoom){const count=rows.querySelectorAll('.rack-channel').length,space=rows.clientHeight;if(count&&space>0)height=Math.max(STEP_ROW_HEIGHT.min,Math.min(STEP_ROW_HEIGHT.max,Math.floor(space/count)));}
 rack.style.setProperty('--ss-row-h',`${height}px`);
 // 100 = fit 16 steps to the grid width; lower values cap each step's width down to STEP_WIDTH_MIN.
 if(state.width>=100)rack.style.removeProperty('--ss-step-max');else rack.style.setProperty('--ss-step-max',`${Math.round(STEP_WIDTH_MIN+(96-STEP_WIDTH_MIN)*state.width/100)}px`);
 const v=$('#step-vzoom'),h=$('#step-hzoom');if(v&&document.activeElement!==v)v.value=String(height);if(h&&document.activeElement!==h)h.value=String(state.width);
 pressed($('#step-auto-zoom'),state.autoZoom);pressed($('#step-width-narrow'),state.width<=0);pressed($('#step-width-wide'),state.width>=100);
}
function setRowHeight(value,{auto=false}={}){state.autoZoom=auto;if(!auto){state.rowHeight=Math.max(STEP_ROW_HEIGHT.min,Math.min(STEP_ROW_HEIGHT.max,Math.round(Number(value))||STEP_ROW_HEIGHT.default));store.set('row-height',state.rowHeight);}store.set('auto-zoom',auto?'1':'0');applyZoom();}
function setStepWidth(value){state.width=Math.max(0,Math.min(100,Math.round(Number(value))));store.set('width',state.width);applyZoom();}

// ── Menus
function rowTargets(row){const id=stepRowId(row);return row&&isStepRow(row)&&id?[id]:[];}
function allStepRows(){return $$('#rack-channels .rack-channel').filter(isStepRow).map(stepRowId).filter(Boolean);}
function nudge(ids,delta){
 if(!velocityMode()){api.toast('Switch the edit mode to Velocity / Value to change step velocities.');return false;}
 if(!ids.length){api.toast('Select a step row first.');return false;}
 return api.stepOperation(ids,delta<0?'Decrement Velocity':'Increment Velocity',row=>nudgeStepVelocities(row,delta));
}
function setEditMode(velocity){if(velocityMode()===!!velocity)return;const button=$('#rack-graph-toggle');if(button.disabled)return api.toast(button.dataset.ssWhy||'Select a step row first.');api.toggleVelocity();sync();}
function setFilter(value){const select=$('#channel-filter');if(!select||select.value===value)return;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}
function localMenu(event,kind){
 const bounds=event.currentTarget.getBoundingClientRect(),at={clientX:bounds.left,clientY:bounds.bottom+2},row=focusedRow(),rowIds=rowTargets(row),hasRow=!!rowIds.length,needRow=hasRow?'':'Select a step row first.',velocity=velocityMode(),needVelocity=velocity?needRow:'Switch the edit mode to Velocity / Value first.';
 const key=(label,shortcut,name,args=[],{disabled=false,title=''}={})=>({label,shortcut,disabled,title,run:()=>api.keyCommand(name,args)}),off=(label,title,shortcut='')=>({label,shortcut,disabled:true,title});
 const filter=$('#channel-filter')?.value||'All',browser=!$('#step-pattern-list')?.hidden,canUndo=api.historyAvailable('undo'),canRedo=api.historyAvailable('redo');
 const items={
  edit:[{label:'Undo',shortcut:'⌘Z',disabled:!canUndo,title:canUndo?'':'There is nothing to undo.',run:()=>api.undo()},{label:'Redo',shortcut:'⇧⌘Z',disabled:!canRedo,title:canRedo?'':'There is nothing to redo.',run:()=>api.redo()},null,
   key('Copy Row','⌃C','step-copy-row',[],{disabled:!hasRow,title:needRow}),key('Paste Row','⌃V','step-paste-row'),off('Paste Row Settings','Row settings are not copied separately; Paste Row (⌃V) pastes the steps.','⌃⌥⇧V'),null,
   key('Clear Row','⌃⌘⌫','step-clear-row',[],{disabled:!hasRow,title:needRow}),key('Clear Pattern','⌃⇧⌘⌫','step-clear-pattern'),key('Delete Row','⌘⌫','step-delete-row',[],{disabled:!row,title:row?'':'Select a row first.'}),null,
   key('Rename Row…','⇧↩','step-rename-row',[],{disabled:!row,title:row?'':'Select a row first.'})],
  functions:[key('Rotate Row Left','⌥⌘←','step-rotate-row',[-1],{disabled:!hasRow,title:needRow}),key('Rotate Row Right','⌥⌘→','step-rotate-row',[1],{disabled:!hasRow,title:needRow}),key('Rotate Pattern Left','⌃⌥⌘←','step-rotate-pattern',[-1]),key('Rotate Pattern Right','⌃⌥⌘→','step-rotate-pattern',[1]),null,
   {label:'Fill Every 4 Steps',disabled:!hasRow,title:needRow,run:()=>$('#rack-fill').click()},{label:'Increment Row Velocity',disabled:!hasRow||!velocity,title:needVelocity,run:()=>nudge(rowIds,STEP_VELOCITY_NUDGE)},{label:'Decrement Row Velocity',disabled:!hasRow||!velocity,title:needVelocity,run:()=>nudge(rowIds,-STEP_VELOCITY_NUDGE)},off('Randomize Row Values','Randomize is not available for Freestyle step rows.'),null,
   key('Mute Row','⌃⇧M','step-mute-row'),key('Solo Row','⌃⇧S','step-solo-row'),null,
   {label:'New Pattern',run:()=>api.patterns.add()},{label:'Rename Pattern…',run:()=>api.patterns.rename()},{label:'Duplicate Pattern',run:()=>api.patterns.duplicate()},{label:'Pattern Length…',run:()=>api.patterns.length()}],
  view:[{label:'Step On/Off',shortcut:'⌃⌥S',checked:!velocity,run:()=>setEditMode(false)},{label:'Velocity / Value',shortcut:'⌃⌥V',checked:velocity,run:()=>setEditMode(true)},off('Gate, Tie, Note, Octave, Note Repeat, Chance…',NO.mode),null,
   ...['All','Drums','Instruments','Unused instruments'].map(value=>({label:value==='All'?'Show All Rows':`Show ${value} Only`,checked:filter===value,run:()=>setFilter(value)})),null,
   {label:'Pattern Browser',checked:browser,run:()=>$('#rack-menu').click()},{label:'Vertical Auto Zoom',checked:state.autoZoom,run:()=>setRowHeight(state.rowHeight,{auto:!state.autoZoom})},{label:'Narrow Steps',checked:state.width<=0,run:()=>setStepWidth(0)},{label:'Wide Steps',checked:state.width>=100,run:()=>setStepWidth(100)},null,
   {label:'Preview Sounds',checked:state.sound,run:()=>setSound(!state.sound)},{label:'Open Row in Piano Roll',disabled:!row,title:row?'':'Select a row first.',run:()=>api.openPiano(stepRowId(row))}],
 };
 api.menu(at,items[kind]);
}
function modeMenu(event){
 const bounds=event.currentTarget.closest('.logic-step-mode').getBoundingClientRect(),velocity=velocityMode();
 api.menu({clientX:bounds.left,clientY:bounds.bottom+2},[{label:'On/Off',checked:!velocity,run:()=>setEditMode(false)},{label:'Velocity / Value',checked:velocity,run:()=>setEditMode(true)},null,...['Gate','Tie','Note','Octave','Loop Start/End','Note Repeat','Chance','Start Offset','Step Rate','Skip'].map(label=>({label,disabled:true,title:NO.mode}))]);
}
function setSound(on){state.sound=!!on;store.set('sound',on?'1':'0');const rack=$('#rack');if(rack)rack.dataset.stepSound=on?'on':'off';pressed($('#step-sound-preview'),on);}

// ── Velocity / Value: drag inside a step sets its velocity (and lights it); one saved edit per gesture
function paintStep(cell,value){const on=lit(value);cell.classList.toggle('on',on);cell.setAttribute('aria-pressed',String(on));if(on)cell.style.setProperty('--vel',String(Math.round(rackGraphVelocity(value)*1000)/1000));else cell.style.removeProperty('--vel');}
function velocityDown(event){
 if(!api||event.button!==0||event.isPrimary===false||!velocityMode()||state.drag)return;
 const cell=event.target.closest?.('.step:not(:disabled)'),row=cell?.closest('.rack-channel'),id=stepRowId(row);if(!cell||!id)return;
 // The capture phase keeps the On/Off paint gesture (the cell's own pointerdown) out of this mode.
 event.preventDefault();event.stopPropagation();
 if(!api.editable()){api.toast('Finish the current edit first.');return;}
 const stored=api.rowSteps(id),before=Array.isArray(stored)?stored.slice():[];
 state.drag={pointerId:event.pointerId,id,row,before,steps:before.slice(),changed:false};setCursor(row,Number(cell.dataset.step));
 const surface=$('#rack-channels');try{surface.setPointerCapture?.(event.pointerId);}catch{}
 velocityMove(event);
}
function velocityMove(event){
 const drag=state.drag;if(!drag||event.pointerId!==drag.pointerId)return;
 // Cells of the drag's own row under the pointer's x; y maps to the value even when the pointer leaves the row.
 const cells=[...drag.row.querySelectorAll('.step:not(:disabled)')],cell=cells.find(node=>{const b=node.getBoundingClientRect();return event.clientX>=b.left&&event.clientX<b.right;});if(!cell)return;
 const bounds=cell.getBoundingClientRect(),index=Number(cell.dataset.step),value=stepValue(velocityAtPointer(event.clientY,bounds.top,bounds.height));
 if(drag.steps[index]===value)return;drag.steps=setStepVelocity(drag.steps,index,value);drag.changed=true;paintStep(cell,value);cell.title=`Velocity ${Math.round(rackGraphVelocity(value)*127)}`;
}
function velocityUp(event,cancel=false){
 const drag=state.drag;if(!drag||event.pointerId!==drag.pointerId)return;state.drag=null;
 try{$('#rack-channels').releasePointerCapture?.(event.pointerId);}catch{}
 if(cancel||!drag.changed){for(const cell of drag.row.querySelectorAll('.step[data-step]'))if(drag.changed)paintStep(cell,drag.before[Number(cell.dataset.step)]);return;}
 const next=drag.steps;Promise.resolve(api.stepOperation([drag.id],'Step Velocity',()=>next.slice())).then(saved=>{if(saved===false)sync();},()=>sync());
}
function setCursor(row,step){state.cursor=row&&Number.isInteger(step)?{row:row.dataset.rackRow||row.dataset.channel,step}:null;paintCursor();}
function paintCursor(){for(const cell of $$('#rack-channels .step.cursor'))cell.classList.remove('cursor');if(!state.cursor)return;const row=$$('#rack-channels .rack-channel').find(node=>(node.dataset.rackRow||node.dataset.channel)===state.cursor.row);row?.querySelector(`.step[data-step="${state.cursor.step}"]`)?.classList.add('cursor');}

// ── Rows
const rowButton=(className,icon,label,title,disabled=false)=>`<button type="button" class="ss-x ${className}" aria-label="${label}" title="${title}"${disabled?' disabled':''}>${ICONS[icon]||icon}</button>`;
function decorateRow(row,index){
 const name=row.querySelector('.channel-name');if(!name)return;
 if(row.querySelector('.ss-disclosure'))return refreshRow(row);
 const missing=row.classList.contains('rack-missing'),stepRow=isStepRow(row),id=stepRowId(row),label=name.textContent.trim(),channel=missing?null:api.channelById(id),kind=stepRowKind(label,channel?.type||(row.querySelector('.note-preview')?'instrument':'')),color=stepRowColor(label,index,name.dataset.channelColor||'');
 row.style.setProperty('--row-color',color);row.dataset.ssKind=kind;row.classList.toggle('ss-step-row',stepRow);
 const why=stepRow?'':missing?'Use this row in the pattern first.':'This row has notes: edit it in the Piano Roll.',velocity=velocityMode(),needVelocity=stepRow&&!velocity?'Switch the edit mode to Velocity / Value to change this row’s step velocities.':why;
 if(!name.querySelector('.ss-chooser'))name.insertAdjacentHTML('beforeend',`<span class="ss-chooser" role="button" aria-label="Row menu" title="Row menu: sound, colour, step operations">${ICONS.updown}</span>`);
 row.insertAdjacentHTML('afterbegin',rowButton('ss-disclosure','disclosure','Subrows',NO.subrows,true)+`<span class="ss-x ss-icon" aria-hidden="true">${ICONS[kind]||ICONS.pad}</span>`);
 row.insertAdjacentHTML('beforeend',`<span class="ss-x ss-mode" title="This row’s edit mode">${stepRow?velocity?'Velocity':'On/Off':missing?'Unused':'Notes'}</span>`
  +`<button type="button" class="ss-x ss-stepper ss-rate" disabled title="${NO.rate}">/16${ICONS.updown}</button><button type="button" class="ss-x ss-stepper ss-dir" disabled aria-label="Playback direction" title="${NO.direction}">${ICONS.arrow}${ICONS.updown}</button>`
  +rowButton('ss-pair-a ss-rot-l','rotateLeft','Rotate row left',why||'Rotate this row’s steps one step to the left (⌥⌘←)',!stepRow)+rowButton('ss-pair-b ss-rot-r','rotateRight','Rotate row right',why||'Rotate this row’s steps one step to the right (⌥⌘→)',!stepRow)
  +rowButton('ss-pair-a ss-dec','down','Decrement',needVelocity||'Decrement: lower the velocity of this row’s steps',!stepRow||!velocity)+rowButton('ss-pair-b ss-inc','up','Increment',needVelocity||'Increment: raise the velocity of this row’s steps',!stepRow||!velocity));
 const on=(selector,run)=>{const node=row.querySelector(selector);if(node)node.onclick=event=>{event.stopPropagation();run(event);};};
 on('.ss-rot-l',()=>api.rotate([id],-1));on('.ss-rot-r',()=>api.rotate([id],1));on('.ss-dec',()=>nudge([id],-STEP_VELOCITY_NUDGE));on('.ss-inc',()=>nudge([id],STEP_VELOCITY_NUDGE));
 const steps=stepRow?api.rowSteps(id):null;
 for(const cell of row.querySelectorAll('.step[data-step]')){const value=steps?.[Number(cell.dataset.step)];if(lit(value)){cell.style.setProperty('--vel',String(Math.round(rackGraphVelocity(value)*1000)/1000));if(velocity)cell.title=`${label} · step ${Number(cell.dataset.step)+1} · velocity ${Math.round(rackGraphVelocity(value)*127)}`;}}
}
/** A row that already has its furniture: only what the edit mode changes (label, decrement / increment, step tooltips). */
function refreshRow(row){
 const stepRow=isStepRow(row),velocity=velocityMode(),mode=row.querySelector('.ss-mode');if(!stepRow)return;
 if(mode)mode.textContent=velocity?'Velocity':'On/Off';
 for(const [selector,title]of [['.ss-dec','Decrement: lower the velocity of this row’s steps'],['.ss-inc','Increment: raise the velocity of this row’s steps']]){const button=row.querySelector(selector);if(button){button.disabled=!velocity;button.title=velocity?title:'Switch the edit mode to Velocity / Value to change this row’s step velocities.';}}
}

/** Called after every rack render (and on mode / view changes): row furniture, header state, zoom. */
export function syncStepSequencer(){if(api)sync();}
function sync(){
 const rack=$('#rack');if(!rack)return;const velocity=velocityMode();
 rack.dataset.stepMode=velocity?'velocity':'onoff';
 $$('#rack-channels .rack-channel').forEach(decorateRow);paintCursor();
 // Segmented edit-mode control. app.js disables the Velocity segment while no step row is selected.
 const toggle=$('#rack-graph-toggle'),onoff=$('#step-mode-onoff');
 if(toggle){toggle.classList.toggle('selected',velocity);toggle.classList.remove('lit');toggle.dataset.ssWhy=toggle.disabled?'Select a sample (step) row to edit step velocities.':'';toggle.title=toggle.disabled?toggle.dataset.ssWhy:'Edit mode: Velocity / Value — drag up or down inside a step to set its velocity (⌃⌥V)';}
 if(onoff){onoff.classList.toggle('selected',!velocity);onoff.setAttribute('aria-pressed',String(!velocity));}
 for(const [selector,why]of [['#step-decrement','Decrement: lower the velocity of every step in the pattern'],['#step-increment','Increment: raise the velocity of every step in the pattern']]){const button=$(selector);if(button){button.disabled=!velocity;button.title=velocity?why:'Switch the edit mode to Velocity / Value to change step velocities.';}}
 // The page field (Bar 1, Bar 2, …) only matters for patterns longer than 16 steps.
 const pager=$('#rack-step-page'),field=pager?.closest('.logic-step-page');if(field)field.hidden=pager.options.length<2;
 pressed($('#step-pattern-preview'),api.playbackMode()==='pattern');pressed($('#rack-menu'),!$('#step-pattern-list')?.hidden);
 const body=$('#rack-channels');if(body)rack.style.setProperty('--ss-body-top',`${body.offsetTop}px`);
 applyZoom();
}

/** Wire the Step Sequencer shell. `next` is app.js's narrow surface (see the call site). */
export function installStepSequencer(next){
 api=next;const rack=$('#rack');if(!rack)return null;
 fillIcons(rack);
 state.rowHeight=Math.max(STEP_ROW_HEIGHT.min,Math.min(STEP_ROW_HEIGHT.max,Number(store.get('row-height'))||STEP_ROW_HEIGHT.default));state.autoZoom=store.get('auto-zoom')==='1';
 {const width=store.get('width');state.width=width===null||!Number.isFinite(Number(width))?100:Math.max(0,Math.min(100,Number(width)));}
 setSound(store.get('sound')!=='0');
 for(const kind of ['edit','functions','view']){const button=$('#step-menu-'+kind);if(button)button.onclick=event=>localMenu(event,kind);}
 const click=(selector,run)=>{const node=$(selector);if(node)node.onclick=run;};
 click('#step-mode-onoff',()=>setEditMode(false));click('#step-mode-menu',modeMenu);
 // #rack-graph-toggle keeps app.js's handler (it owns the velocity state); repaint the segment after it.
 $('#rack-graph-toggle')?.addEventListener('click',()=>queueMicrotask(sync));
 click('#step-pattern-preview',()=>{$('#mode')?.click();});
 click('#step-sound-preview',()=>setSound(!state.sound));
 click('#step-auto-zoom',()=>setRowHeight(state.rowHeight,{auto:!state.autoZoom}));
 click('#step-width-narrow',()=>setStepWidth(0));click('#step-width-wide',()=>setStepWidth(100));
 const v=$('#step-vzoom'),h=$('#step-hzoom');if(v){v.min=String(STEP_ROW_HEIGHT.min);v.max=String(STEP_ROW_HEIGHT.max);v.oninput=()=>setRowHeight(v.value);}if(h)h.oninput=()=>setStepWidth(h.value);
 click('#step-rotate-left',()=>api.keyCommand('step-rotate-pattern',[-1]));click('#step-rotate-right',()=>api.keyCommand('step-rotate-pattern',[1]));
 click('#step-decrement',()=>nudge(allStepRows(),-STEP_VELOCITY_NUDGE));click('#step-increment',()=>nudge(allStepRows(),STEP_VELOCITY_NUDGE));
 const rows=$('#rack-channels');
 rows.addEventListener('pointerdown',velocityDown,true);rows.addEventListener('pointermove',velocityMove);rows.addEventListener('pointerup',event=>velocityUp(event));rows.addEventListener('pointercancel',event=>velocityUp(event,true));
 // Step cursor (the outlined step) follows the last step pressed in either mode.
 rows.addEventListener('pointerdown',event=>{const cell=event.target.closest?.('.step'),row=cell?.closest('.rack-channel');if(cell&&row)setCursor(row,Number(cell.dataset.step));},true);
 // The arrows beside a row name open that row's menu instead of selecting the row.
 rows.addEventListener('click',event=>{const chooser=event.target.closest?.('.ss-chooser'),row=chooser?.closest('.rack-channel');if(!row)return;event.preventDefault();event.stopPropagation();const bounds=chooser.getBoundingClientRect();api.rowMenu({clientX:bounds.left,clientY:bounds.bottom+2,preventDefault(){},stopPropagation(){}},row);},true);
 // Pattern preview follows the transport's Pattern / Song mode wherever it is switched.
 const mode=$('#mode');if(mode&&typeof MutationObserver==='function')new MutationObserver(()=>pressed($('#step-pattern-preview'),api.playbackMode()==='pattern')).observe(mode,{attributes:true,attributeFilter:['class']});
 if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(state.autoZoom)applyZoom();}).observe(rows);
 sync();
 return{sync,state,setEditMode,setRowHeight,setStepWidth,setSound};
}
