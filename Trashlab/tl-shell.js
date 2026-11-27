/** Trashlab shell: a web-studio layout (two pill rows, track list, timeline, bottom
 * bar with drawers) over the fork's unchanged engine, history and transport layers.
 * Presentation and routing only: every command goes through a handler the application
 * passes in (`api`) or through the Logic-fork shell it wraps (`api.logicShell`).
 */
import {logicShellHooks,gainToDb,dbToGain,VOLUME_FLOOR_DB,VOLUME_CEIL_DB} from './logic-shell.js';
import {toggleEditor,openEditor,closeEditor,toggleMusicalTyping} from './logic-editors.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const svg=(body,extra='')=>`<svg class="tl-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>`;
/** Original line icons (drawn for this app). */
export const TL_ICONS=Object.freeze({
 file:svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
 edit:svg('<path d="M4 20l1-4.500L16.500 4l3.500 3.500L8.500 19z"/>'),
 track:svg('<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="1.800" fill="currentColor"/><circle cx="15" cy="12" r="1.800" fill="currentColor"/><circle cx="7" cy="17" r="1.800" fill="currentColor"/>'),
 navigate:svg('<circle cx="12" cy="12" r="9"/><path d="m15.500 8.500-2 5-5 2 2-5z"/>'),
 record:svg('<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="3.500" fill="currentColor"/>'),
 mix:svg('<path d="M6 4v16M12 4v16M18 4v16"/><path d="M4 9h4M10 15h4M16 8h4" stroke-width="2.400"/>'),
 view:svg('<path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z"/><circle cx="12" cy="12" r="2.800"/>'),
 window:svg('<rect x="3.500" y="5" width="17" height="14" rx="2"/><path d="M3.500 9.500h17"/>'),
 freestyle:svg('<path d="M7 18.500a4.500 4.500 0 0 1-.6-8.960A6 6 0 0 1 18 10.600a4 4 0 0 1-.5 7.900z"/>'),
 help:svg('<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.600 2.600 0 1 1 3.700 2.400c-.8.400-1.200 1-1.200 1.900"/><path d="M12 17h.01" stroke-width="2.400"/>'),
 kebab:svg('<circle cx="12" cy="5.500" r="1.500" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.500" fill="currentColor" stroke="none"/><circle cx="12" cy="18.500" r="1.500" fill="currentColor" stroke="none"/>'),
 chevron:svg('<path d="m7 10 5 5 5-5"/>'),
 close:svg('<path d="M6 6l12 12M18 6 6 18"/>'),
 mic:svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3"/>'),
 keys:svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v8M12 5v8M16 5v8M3 13h18"/>'),
 drums:svg('<rect x="4" y="4" width="6.500" height="6.500" rx="1.500"/><rect x="13.500" y="4" width="6.500" height="6.500" rx="1.500"/><rect x="4" y="13.500" width="6.500" height="6.500" rx="1.500"/><rect x="13.500" y="13.500" width="6.500" height="6.500" rx="1.500" fill="currentColor"/>'),
 guitar:svg('<path d="m14 10 6.500-6.500M18.500 3.500l2 2"/><path d="M14.500 9.500c1.500 1.500 1 4-.5 4.500-1.500.5-2 1.500-2 3 0 2.500-2.500 4-5 3s-4-3-3-5.500c.6-1.500 2-2 3.500-2 1.200 0 2-.700 2.500-2 .5-1.500 3-2.500 4.500-1z"/><circle cx="9" cy="15" r="1.500"/>'),
 importFile:svg('<path d="M12 3v11m-4-4 4 4 4-4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
 sampler:svg('<path d="M3 12h2l2-6 3 12 3-9 2 5 2-2h4"/>'),
 drop:svg('<path d="M10 20V9l9-2v11"/><circle cx="7.500" cy="20" r="2.500"/><circle cx="16.500" cy="18" r="2.500"/><path d="M4 3v6M1 6h6"/>'),
 bellOff:svg('<path d="M6 16.500V11a6 6 0 0 1 12 0v5.500l1.500 2h-15z"/><path d="M10 21h4"/>')
});
const MENU_ICONS={File:'file',Edit:'edit',Track:'track',Navigate:'navigate',Record:'record',Mix:'mix',View:'view',Window:'window',Freestyle:'freestyle',Help:'help'};

/** "MM:SS.t" for a beat position (tenths, truncated: the readout never runs ahead). */
export function timeReadout(beat,bpm=120){
 const tempo=Number(bpm)>0?Number(bpm):120,tenths=Math.floor(Math.max(0,Number(beat)||0)*600/tempo+1e-6),two=value=>String(value).padStart(2,'0');
 return `${two(Math.floor(tenths/600))}:${two(Math.floor(tenths/10)%60)}.${tenths%10}`;
}
/** "+0.0 dB" / "-3.5 dB" / "-∞ dB" for a linear gain. */
export function signedDb(gain){const db=gainToDb(gain);if(!Number.isFinite(db))return '-∞ dB';const value=Math.abs(db)<.05?0:db;return `${value>=0?'+':'-'}${Math.abs(value).toFixed(1)} dB`;}
/** "May 23, 2026" for an ISO date / epoch; '' when unknown. */
export function savedDateLabel(value){
 if(value===null||value===undefined||value==='')return '';const date=new Date(typeof value==='number'&&value<1e11?value*1000:value);if(Number.isNaN(date.getTime()))return '';
 return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
/** Add Track cards. `kind` is the fork's new-track type; cards without one are not backed by the engine. */
export const ADD_TRACK_CARDS=Object.freeze([
 {id:'voice',label:'Voice/Mic',hint:'Record vocals or any microphone',icon:'mic',color:'#b400ff',kind:'vocal'},
 {id:'instruments',label:'Instruments',hint:'Play a software instrument',icon:'keys',color:'#3d8bff',kind:'instrument'},
 /* a new step pattern placed at bar 1 on a new track, opened in the Drum Machine drawer */
 {id:'drums',label:'Drum Machine',hint:'A step pattern on a new track',icon:'drums',color:'#ff8a1f',command:'drums'},
 {id:'guitar',label:'Guitar/Bass',hint:'Record a plugged-in instrument',icon:'guitar',color:'#17c964',kind:'audio'},
 {id:'import',label:'Import file',hint:'Audio or MIDI from your computer',icon:'importFile',color:'#f5c518',command:'import'},
 {id:'sampler',label:'Sampler',hint:'Play your own sounds',icon:'sampler',color:'#ff4d6d',reason:'Freestyle has no sampler track type yet.'}
]);
const SNAP_LABELS=[['0.25','1/16 note'],['0.5','1/8 note'],['1','Beat'],['4','Bar']];

/** @param {object} api application bridge (see app.js "Trashlab shell"). */
export function installTrashlabShell(api){
 const doc=api.document||globalThis.document,win=doc.defaultView||globalThis,$=selector=>doc.querySelector(selector),$$=selector=>[...doc.querySelectorAll(selector)];
 const shell=api.logicShell,disposers=[],state={notes:[],unseen:0,lastSnap:'0.25',expanded:false,savedAt:null};
 const on=(target,type,listener,options)=>{if(!target)return;target.addEventListener(type,listener,options);disposers.push(()=>target.removeEventListener(type,listener,options));};
 const safe=run=>(...args)=>{try{const result=run(...args);if(result&&typeof result.catch==='function')result.catch(api.fail);return result;}catch(error){api.fail(error);return null;}};
 const Observer=win.MutationObserver||globalThis.MutationObserver;
 const observe=(target,options,run)=>{if(!target||!Observer)return;const observer=new Observer(run);observer.observe(target,options);disposers.push(()=>observer.disconnect());};
 const contextMenu=()=>$('#context-menu'),menuOpen=()=>{const menu=contextMenu();return !!menu&&!menu.classList.contains('hidden');};
 const below=(element,{align='left',gap=8}={})=>{const rect=element.getBoundingClientRect();return{clientX:align==='right'?Math.max(8,rect.right-260):rect.left,clientY:rect.bottom+gap};};
 const project=()=>{try{return api.getProject?.()||null;}catch{return null;}};

 // ── Hamburger: the application menus as one cascading menu (hover moves between its submenus)
 const menuButton=$('#tl-menu');let appMenuNode=null,appMenuWasOpen=false;
 const appMenuShowing=()=>{const menu=contextMenu();return !!appMenuNode&&menuOpen()&&menu.firstElementChild===appMenuNode;};
 function appMenuItems(){
  const names=(api.menuOrder||['File','Edit','Track','View','Help']).filter(name=>name!=='Window');
  return names.map(name=>{let submenu=[];try{submenu=api.mainMenu(name)||[];}catch{}return{label:name,icon:TL_ICONS[MENU_ICONS[name]]||'',submenu,disabled:!submenu.length};});
 }
 function openAppMenu(){if(!menuButton)return;api.menu(below(menuButton),appMenuItems());const menu=contextMenu();appMenuNode=menu?.firstElementChild||null;menu?.classList.add('tl-app-menu');paintAppMenu();}
 // Class writes are guarded: a DOMTokenList write always queues a mutation record, even when nothing changes.
 const setClass=(element,name,value)=>{if(element&&element.classList.contains(name)!==!!value)element.classList.toggle(name,!!value);};
 function paintAppMenu(){const open=appMenuShowing();if(menuButton&&menuButton.getAttribute('aria-expanded')!==String(open))menuButton.setAttribute('aria-expanded',String(open));setClass(menuButton,'menu-open',open);if(!open)setClass(contextMenu(),'tl-app-menu',false);}
 on(menuButton,'pointerdown',()=>{appMenuWasOpen=appMenuShowing();},true);
 on(menuButton,'click',event=>{event.stopPropagation();if(appMenuWasOpen||appMenuShowing()){appMenuWasOpen=false;contextMenu()?.classList.add('hidden');paintAppMenu();return;}openAppMenu();});
 observe(contextMenu(),{attributes:true,attributeFilter:['class'],childList:true},paintAppMenu);

 // ── Project title: click to rename in place (Enter commits, Escape cancels)
 const title=$('#project-title');let titleBefore=null;
 function endTitleEdit(commit){
  if(titleBefore===null||!title)return;const before=titleBefore,next=title.textContent.replace(/\s+/g,' ').trim();titleBefore=null;title.removeAttribute('contenteditable');title.classList.remove('editing');
  if(!commit||!next||next===before){title.textContent=before;return;}
  title.textContent=next;safe(()=>api.setTitle(next))();
 }
 function beginTitleEdit(){
  if(!title||titleBefore!==null)return;if(!api.engineReady?.()){api.toast('Open a Freestyle project to rename it.');return;}
  titleBefore=title.textContent;title.setAttribute('contenteditable','plaintext-only');if(title.contentEditable!=='plaintext-only')title.setAttribute('contenteditable','true');title.classList.add('editing');title.focus();
  try{const range=doc.createRange();range.selectNodeContents(title);const selection=win.getSelection();selection.removeAllRanges();selection.addRange(range);}catch{}
 }
 on(title,'click',beginTitleEdit);
 on(title,'keydown',event=>{if(titleBefore===null){if(event.key==='Enter'||event.key===' '){event.preventDefault();beginTitleEdit();}return;}event.stopPropagation();if(event.key==='Enter'){event.preventDefault();endTitleEdit(true);title.blur();}else if(event.key==='Escape'){event.preventDefault();endTitleEdit(false);title.blur();}},true);
 on(title,'blur',()=>endTitleEdit(true));
 on(title,'paste',event=>{if(titleBefore===null)return;event.preventDefault();const text=(event.clipboardData?.getData('text/plain')||'').replace(/\s+/g,' ');try{doc.execCommand('insertText',false,text);}catch{}});

 // ── Save pill (looks disabled while there is nothing new) and "Last Saved"
 const save=$('#save'),savedDate=$('#tl-last-saved-date');
 function paintSave(){
  const current=project(),raw=current?.cloud?.rawProject,ready=!!api.engineReady?.();let dirty=false;try{dirty=!!api.isDirty?.();}catch{}
  if(save){const clean=!ready||!dirty;if(save.dataset.clean!==String(clean))save.dataset.clean=String(clean);const text=!ready?'Save: open a Freestyle project first':clean?'Saved. Click to store another project snapshot (⌘S)':'Save a project snapshot (⌘S)';if(save.title!==text)save.title=text;}
  if(savedDate){const label=savedDateLabel(api.savedAt?.()??raw?.updatedAt??raw?.updated_at??raw?.modifiedAt??null)||(ready?'Auto-saved':'Not yet');if(savedDate.textContent!==label)savedDate.textContent=label;}
 }
 // The click handler stays the application's (app.js); it records the snapshot time this pill reads.
 on(save,'click',()=>{for(const delay of [300,1200,3000])win.setTimeout(paintSave,delay);});

 // ── Time readout "00:00.0": one fixed-width cell per character, so playback never shifts the pill
 const timeValue=$('#time-value'),timeOut=$('#tl-time');let timeText='';
 function paintTime(){
  if(!timeOut)return;const current=project(),stored=timeValue?.dataset?.beat,beat=stored!==undefined&&stored!==''&&Number.isFinite(Number(stored))?Number(stored):0,text=timeReadout(beat,Number($('#tempo')?.value)||Number(current?.bpm)||120);
  if(text===timeText)return;
  if(timeOut.children.length!==text.length){timeOut.innerHTML=[...text].map(char=>`<i class="${/\d/.test(char)?'d':'p'}">${char}</i>`).join('');}
  else[...text].forEach((char,index)=>{const cell=timeOut.children[index];if(cell.textContent!==char)cell.textContent=char;});
  timeText=text;timeOut.setAttribute('aria-label',`Time ${text}`);
 }
 observe(timeValue,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['data-beat']},paintTime);
 on($('#tempo'),'input',paintTime);on($('#tempo'),'change',paintTime);

 // ── "4 / 4" and Key pills
 const signature=$('#lcd-signature'),signatureText=$('#tl-signature-text');
 const paintSignature=()=>{if(!signature||!signatureText)return;const text=String(signature.textContent||'4/4').trim().replace(/\s*\/\s*/,' / ');if(signatureText.textContent!==text)signatureText.textContent=text;};
 observe(signature,{childList:true,characterData:true,subtree:true},paintSignature);
 on($('#tl-signature'),'click',safe(()=>{if(!api.engineReady?.())return api.toast('Open a Freestyle project to edit its tempo and time signature.');return api.timing();}));
 const key=$('#lcd-key'),keyPill=$('#tl-key');
 const paintKey=()=>{if(!key||!keyPill)return;const empty=!key.textContent.trim()||key.textContent.trim()==='—';if(keyPill.dataset.empty!==String(empty))keyPill.dataset.empty=String(empty);};
 observe(key,{childList:true,characterData:true,subtree:true},paintKey);

 // ── Master volume (the saved master gain; one undo step per release)
 const volume=$('#tl-master-volume'),volumeDb=$('#tl-master-db');let volumeDragging=false;
 const fill=input=>{if(!input)return;const min=Number(input.min),max=Number(input.max),value=Number(input.value);input.style.setProperty('--tl-fill',`${max>min?Math.max(0,Math.min(100,(value-min)/(max-min)*100)):0}%`);};
 function masterGain(){let row=null;try{row=api.masterRow?.();}catch{}const gain=row?.values?.gain;return{row,enabled:!!(row?.controls?.gain?.enabled&&gain?.known),gain:gain?.known?Number(gain.value):null,reason:row?row.controls?.gain?.reason||'':'Open a Freestyle project to set the master volume.'};}
 function paintVolume(){
  if(!volume)return;const master=masterGain();
  if(volume.disabled===master.enabled)volume.disabled=!master.enabled;
  const text=master.enabled?'Master volume · double-click to reset to 0 dB':master.reason||'Master volume unavailable';if(volume.title!==text)volume.title=text;
  if(!volumeDragging&&doc.activeElement!==volume){const db=master.gain===null?0:Math.max(VOLUME_FLOOR_DB,Math.min(VOLUME_CEIL_DB,gainToDb(master.gain)));if(Number(volume.value)!==db)volume.value=String(db);fill(volume);const label=master.gain===null?'+0.0 dB':signedDb(master.gain);if(volumeDb&&volumeDb.textContent!==label)volumeDb.textContent=label;}
 }
 // Heard while it moves: every input is a live (unsaved) value, the release is the ONE saved write and Undo step.
 // While the drag lasts the app holds its live-mix repaint, so the model keeps the value the drag began with.
 let volumeBefore=null;
 const volumeBegin=()=>{if(volumeBefore!==null)return true;const master=masterGain();if(!master.enabled||master.gain===null)return false;volumeBefore=master.gain;try{api.liveMixGesture?.(true);}catch{}return true;};
 const volumeEnd=()=>{if(volumeBefore===null)return;volumeBefore=null;try{api.liveMixGesture?.(false);}catch{}};
 on(volume,'pointerdown',()=>{volumeDragging=true;});
 on(volume,'input',()=>{fill(volume);if(volumeDb)volumeDb.textContent=signedDb(dbToGain(Number(volume.value)));if(volumeBegin())try{api.liveMasterGain?.(dbToGain(Number(volume.value)));}catch{}});
 on(volume,'change',()=>{volumeDragging=false;const master=masterGain();if(!master.enabled){volumeEnd();return paintVolume();}const heard=volumeBefore!==null,before=heard?volumeBefore:master.gain,next=dbToGain(Number(volume.value));
  try{if(Math.abs(next-before)<1e-6){if(heard)try{api.liveMasterGain?.(before);}catch{}return;}safe(()=>api.setMasterGain(before,next))();}finally{volumeEnd();volume.blur();}});
 on(volume,'blur',volumeEnd);
 on(volume,'dblclick',()=>{const master=masterGain();if(!master.enabled||Math.abs(master.gain-1)<1e-6)return;volume.value='0';fill(volume);if(volumeDb)volumeDb.textContent='+0.0 dB';safe(()=>api.setMasterGain(master.gain,1))();});
 on($('#tl-volume-icon'),'click',()=>volume?.focus());
 fill(volume);

 // ── Drawers: Effects (the selected track's chain), Editor, Sounds
 const fxOpen=()=>{const mixer=$('#mixer');return !!mixer&&!mixer.classList.contains('hidden');};
 const editorOpen=()=>doc.body.classList.contains('editors-open');
 const soundsOpen=()=>!!(shell?.state?.panes?.loops||shell?.state?.panes?.browser);
 function paintDrawers(){
  for(const [selector,open]of [['#tl-fx',fxOpen()],['#tl-editor',editorOpen()],['#tl-sounds',soundsOpen()]]){const button=$(selector);if(!button)continue;if(button.getAttribute('aria-pressed')!==String(open))button.setAttribute('aria-pressed',String(open));setClass(button,'on',open);}
  setClass(doc.body,'tl-fx-open',fxOpen());setClass(doc.body,'tl-sounds-open',soundsOpen());
 }
 function toggleFx(force){const next=typeof force==='boolean'?force:!fxOpen();if(next&&editorOpen())closeEditor();api.toggleMixer(next);paintDrawers();return next;}
 function trackEffects(row){if(Number.isInteger(row))shell?.selectTrack(row);return toggleFx(true);}
 on($('#tl-fx'),'click',safe(()=>toggleFx()));
 // Editor: the audio editor for a selected audio region, the fork's choice for a pattern region, else the Piano Roll.
 on($('#tl-editor'),'click',safe(()=>{if(editorOpen()){closeEditor();return paintDrawers();}if(fxOpen())api.toggleMixer(false);let kind=null;try{kind=api.selectedRegionKind?.();}catch{}if(kind==='pattern')toggleEditor();else openEditor(kind==='audio'?'audio':'piano');paintDrawers();}));
 on($('#tl-sounds'),'click',safe(()=>{shell?.togglePane('loops');paintDrawers();}));
 on($('#collapse-browser'),'click',()=>setTimeout(paintDrawers,0));
 {const heading=$('aside.browser>.panel-heading>span');if(heading)heading.textContent='Trashlab Sounds';const search=$('#browser-search');if(search){search.placeholder='Search sounds';search.setAttribute('aria-label','Search sounds');}const collapse=$('#collapse-browser');if(collapse)collapse.title='Close Trashlab Sounds';}
 // Patterns tab: the project's patterns, draggable into a track (the list itself is drawn by the application).
 const patternsTab=$('.browser-tabs [data-browser="patterns"]');
 if(patternsTab){patternsTab.hidden=false;/* its label is CSS (tl-shell.css): the inherited icon mount owns the button's content */patternsTab.setAttribute('aria-label','Patterns');patternsTab.title='Patterns in this project: drag one into a track, click one to edit its steps';patternsTab.setAttribute('role','tab');patternsTab.setAttribute('aria-selected',String(patternsTab.classList.contains('selected')));}
 const paintSearch=()=>{const search=$('#browser-search');if(!search)return;const text=patternsTab?.classList.contains('selected')?'Search patterns':'Search sounds';if(search.placeholder!==text){search.placeholder=text;search.setAttribute('aria-label',text);}};
 for(const tab of $$('.browser-tabs [data-browser]'))on(tab,'click',()=>win.setTimeout(paintSearch,0));
 function showPatterns(){if(!soundsOpen())shell?.togglePane('loops',true);patternsTab?.click();paintDrawers();paintSearch();}
 on($('#tl-shortcuts'),'click',safe(()=>shell?.openKeyCommands()));
 on($('#tl-mastering'),'click',safe(()=>{if(!api.engineReady?.())return api.toast('Open a Freestyle project to edit the master effects.');api.selectMaster();return toggleFx(true);}));
 on($('#tl-invite'),'click',safe(()=>api.invite()));
 observe($('#mixer'),{attributes:true,attributeFilter:['class']},paintDrawers);
 observe(doc.body,{attributes:true,attributeFilter:['class']},()=>{const fx=$('#tl-fx');if(fx&&(fx.getAttribute('aria-pressed')==='true')!==fxOpen()||($('#tl-editor')?.getAttribute('aria-pressed')==='true')!==editorOpen()||($('#tl-sounds')?.getAttribute('aria-pressed')==='true')!==soundsOpen())paintDrawers();});
 // Close buttons for the drawers (the fork's panes have their own; the Effects drawer gets one here).
 const mixerBar=$('#mixer>.panel-heading');
 if(mixerBar&&!mixerBar.querySelector('.tl-drawer-close')){mixerBar.insertAdjacentHTML('afterbegin','<span class="tl-drawer-title"><b>Effects</b><small id="tl-fx-track"></small></span>');const close=doc.createElement('button');close.type='button';close.className='tl-drawer-close';close.title='Close Effects';close.setAttribute('aria-label','Close Effects');close.innerHTML=TL_ICONS.close;mixerBar.append(close);on(close,'click',safe(()=>toggleFx(false)));}
 const fxTrack=$('#tl-fx-track'),mixerTitle=$('#mixer-selected-title');
 const paintFxTrack=()=>{if(!fxTrack||!mixerTitle)return;const text=String(mixerTitle.textContent||'').replace(/^-\s*/,'');if(fxTrack.textContent!==text)fxTrack.textContent=text;};
 observe(mixerTitle,{childList:true,characterData:true,subtree:true},paintFxTrack);paintFxTrack();

 // ── Notifications: what the app reported in this session (the badge counts unread entries; none, no badge)
 const bell=$('#tl-bell'),badge=$('#tl-bell-badge'),toast=$('#toast');let notesPanel=null;
 function paintBadge(){if(!badge)return;badge.hidden=!state.unseen;badge.textContent=state.unseen>9?'9+':String(state.unseen||'');bell?.setAttribute('aria-label',state.unseen?`Notifications, ${state.unseen} unread`:'Notifications');}
 function recordNote(){if(!toast?.classList.contains('show'))return;const text=toast.textContent.trim();if(!text||state.notes[0]?.text===text&&Date.now()-state.notes[0].at<4000)return;state.notes.unshift({text,at:Date.now()});state.notes.length=Math.min(state.notes.length,30);if(notesPanel)renderNotes();else{state.unseen++;paintBadge();}}
 observe(toast,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['class']},recordNote);
 function renderNotes(){if(!notesPanel)return;const time=at=>{const date=new Date(at);return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;};notesPanel.querySelector('.tl-pop-body').innerHTML=state.notes.length?state.notes.map(note=>`<div class="tl-note"><span>${esc(note.text)}</span><time>${time(note.at)}</time></div>`).join(''):`<div class="tl-pop-empty">${TL_ICONS.bellOff}<b>You’re all caught up</b><span>Messages from this session appear here.</span></div>`;notesPanel.querySelector('[data-clear]').hidden=!state.notes.length;}
 function closeNotes(){if(!notesPanel)return;const panel=notesPanel;notesPanel=null;bell?.setAttribute('aria-expanded','false');bell?.classList.remove('on');panel.classList.add('closing');setTimeout(()=>panel.remove(),140);}
 function openNotes(){
  if(notesPanel)return closeNotes();contextMenu()?.classList.add('hidden');
  notesPanel=doc.createElement('div');notesPanel.className='tl-popover tl-notes';notesPanel.setAttribute('role','dialog');notesPanel.setAttribute('aria-label','Notifications');
  notesPanel.innerHTML='<header><b>Notifications</b><button type="button" data-clear class="tl-text-button">Clear all</button></header><div class="tl-pop-body"></div>';doc.body.append(notesPanel);
  const rect=bell.getBoundingClientRect();notesPanel.style.top=`${rect.bottom+8}px`;notesPanel.style.right=`${Math.max(8,win.innerWidth-rect.right)}px`;
  notesPanel.querySelector('[data-clear]').addEventListener('click',()=>{state.notes.length=0;renderNotes();});
  state.unseen=0;paintBadge();renderNotes();bell.setAttribute('aria-expanded','true');bell.classList.add('on');
 }
 on(bell,'click',event=>{event.stopPropagation();openNotes();});
 on(doc,'pointerdown',event=>{if(notesPanel&&!event.target.closest?.('.tl-notes,#tl-bell'))closeNotes();},true);
 on(doc,'keydown',event=>{if(event.key==='Escape'&&notesPanel){event.stopPropagation();closeNotes();bell?.focus();}},true);
 paintBadge();

 // ── Add Track: a modal of large cards wired to the fork's New Track commands
 let addDialog=null;
 function openAddTrack(){
  if(addDialog?.isConnected)return addDialog;
  const cards=ADD_TRACK_CARDS.map(card=>{const backed=!!(card.kind||card.command);return `<button type="button" class="tl-card" data-card="${card.id}" style="--tl-card:${card.color}" ${backed?'':'disabled'} title="${esc(backed?card.hint:card.reason)}"><span class="tl-card-icon">${TL_ICONS[card.icon]}</span><b>${esc(card.label)}</b><small>${esc(backed?card.hint:'Not available')}</small></button>`;}).join('');
  const d=api.dialog('New Track',`<p class="tl-add-lead">Choose what to add to your project.</p><div class="tl-card-grid">${cards}</div>`,{className:'tl-modal tl-add-track-dialog'});addDialog=d;
  d.addEventListener('close',()=>{if(addDialog===d)addDialog=null;});
  for(const button of d.querySelectorAll('.tl-card'))button.addEventListener('click',()=>{const card=ADD_TRACK_CARDS.find(item=>item.id===button.dataset.card);if(!card)return;d.close();safe(()=>{if(card.command==='import')return api.importFile();if(card.command==='drums'){const made=api.newDrumMachineTrack?.();if(made)showPatterns();return made;}return api.newTrackOfKind(card.kind);})();});
  d.addEventListener('click',event=>{if(event.target===d)d.close();});
  return d;
 }
 on($('#tl-add-track'),'click',safe(()=>openAddTrack()));
 // The fork's own "New Tracks…" entry points (menu, ⌥⌘N, double-click below the tracks) keep its New track dialog.

 // ── Musical Typing button, metronome options, Automation and Track view buttons
 const typing=$('#musical-typing'),midiButton=$('#tl-midi');
 const paintTyping=()=>{if(!midiButton)return;const open=!!typing&&!typing.classList.contains('hidden');midiButton.setAttribute('aria-pressed',String(open));midiButton.classList.toggle('on',open);};
 on(midiButton,'click',safe(()=>{toggleMusicalTyping();paintTyping();}));
 observe(typing,{attributes:true,attributeFilter:['class']},paintTyping);paintTyping();
 const metronome=$('#metronome'),metroMenu=$('#tl-metro-menu');
 const metronomeOn=()=>!!metronome&&(metronome.classList.contains('lit')||metronome.classList.contains('active')||metronome.getAttribute('aria-pressed')==='true');
 on(metroMenu,'click',event=>{event.stopPropagation();const countIn=$('#logic-count-in'),countOn=countIn?.getAttribute('aria-pressed')==='true';api.menu(below(metroMenu.closest('.tl-metro')||metroMenu),[{label:'Metronome',shortcut:'K',checked:metronomeOn(),run:()=>metronome.click()},{label:'Count-in before recording',checked:countOn,disabled:!countIn||countIn.disabled,title:countIn?.title||'Count-in is unavailable right now.',run:()=>countIn.click()},null,{label:'Tempo and time signatures…',run:()=>$('#tl-signature')?.click()}]);});
 const automationButton=$('#tl-automation');
 const paintAutomation=()=>{if(!automationButton)return;const open=!!shell?.state?.panes?.automation;automationButton.setAttribute('aria-pressed',String(open));automationButton.classList.toggle('on',open);};
 on(automationButton,'click',safe(()=>{shell?.togglePane('automation');paintAutomation();}));
 const trackView=$('#tl-track-view');
 const setRowHeight=height=>{try{const view=api.view();api.applyView({...view,rowHeight:height});}catch(error){api.fail(error);}paintExpanded();};
 on(trackView,'click',event=>{event.stopPropagation();let height=80;try{height=Math.round(api.view().rowHeight);}catch{}api.menu(below(trackView),[{label:'Compact tracks',checked:height<70,run:()=>setRowHeight(56)},{label:'Regular tracks',checked:height>=70&&height<=100,run:()=>setRowHeight(80)},{label:'Large tracks',checked:height>100,run:()=>setRowHeight(136)},null,{label:'Zoom to fit',shortcut:'Z',run:()=>$('#playlist-fit')?.click()}]);});

 // ── Ruler tools: magnet (snap on / off, right-click for the grid), zoom out / in
 const snap=$('#snap'),snapButton=$('#tl-snap');
 function paintSnap(){if(!snap||!snapButton)return;const onNow=snap.value!=='0';if(onNow)state.lastSnap=snap.value;snapButton.setAttribute('aria-pressed',String(onNow));snapButton.classList.toggle('on',onNow);const label=SNAP_LABELS.find(([value])=>value===snap.value)?.[1];snapButton.title=onNow?`Snap to grid: ${label||snap.value} · right-click for the grid size`:'Snap is off · right-click for the grid size';}
 function setSnap(value){if(!snap)return;snap.value=value;snap.dispatchEvent(new win.Event('change',{bubbles:true}));paintSnap();}
 on(snapButton,'click',()=>setSnap(snap?.value==='0'?state.lastSnap||'0.25':'0'));
 on(snapButton,'contextmenu',event=>{event.preventDefault();event.stopPropagation();api.menu(below(snapButton,{align:'right'}),[...SNAP_LABELS.map(([value,label])=>({label,checked:snap?.value===value,run:()=>setSnap(value)})),null,{label:'Snap off',checked:snap?.value==='0',run:()=>setSnap('0')}]);});
 on(snap,'change',paintSnap);
 on($('#tl-zoom-out'),'click',()=>$('#playlist-zoom-out')?.click());on($('#tl-zoom-in'),'click',()=>$('#playlist-zoom-in')?.click());
 paintSnap();

 // ── Track rows: kebab menu, expand chevron, "+ Fx" chip, L / R pan labels, slider fill, drop zone
 function decorateTracks(){
  const lanes=$('#track-lanes');if(!lanes)return;
  for(const label of lanes.querySelectorAll('.track-label.logic-track-header[data-track]')){
   if(label.classList.contains('logic-track-empty'))continue;
   const row=Number(label.dataset.track),number=label.querySelector('.logic-track-number'),volumeInput=label.querySelector('.logic-track-volume');
   if(number&&!number.dataset.tlNumber)number.dataset.tlNumber=String(row+1).padStart(2,'0');
   fill(volumeInput);
   if(label.querySelector('.tl-track-menu'))continue;
   label.insertAdjacentHTML('beforeend',`<button type="button" class="tl-track-menu" title="Track options" aria-label="Track options" aria-haspopup="menu">${TL_ICONS.kebab}</button><button type="button" class="tl-track-expand" title="Expand tracks" aria-label="Expand tracks" aria-pressed="${state.expanded}">${TL_ICONS.chevron}</button><button type="button" class="tl-track-fx" title="Effects for this track">+ Fx</button><span class="tl-pan-l" aria-hidden="true">L</span><span class="tl-pan-r" aria-hidden="true">R</span>`);
   const icon=label.querySelector('.logic-track-icon'),kind=label.dataset.trackKind;if(icon)icon.innerHTML=TL_ICONS[kind==='audio'?'mic':kind==='pattern'?'drums':'keys'];
   const stop=element=>{for(const type of ['pointerdown','dblclick'])element.addEventListener(type,event=>event.stopPropagation());};
   const menu=label.querySelector('.tl-track-menu'),expand=label.querySelector('.tl-track-expand'),fx=label.querySelector('.tl-track-fx');
   for(const element of [menu,expand,fx])stop(element);
   menu.addEventListener('click',event=>{event.stopPropagation();shell?.selectTrack(row);const rect=menu.getBoundingClientRect();label.dispatchEvent(new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.left,clientY:rect.bottom+6,button:2}));});
   expand.addEventListener('click',event=>{event.stopPropagation();toggleExpanded();});
   fx.addEventListener('click',event=>{event.stopPropagation();safe(()=>trackEffects(row))();});
   volumeInput?.addEventListener('input',()=>fill(volumeInput));
  }
  paintExpanded();paintDropZone();
 }
 function toggleExpanded(){try{const view=api.view();state.expanded=!(view.rowHeight>100);api.applyView({...view,rowHeight:state.expanded?136:80});}catch(error){api.fail(error);}paintExpanded();}
 function paintExpanded(){let tall=state.expanded;try{tall=api.view().rowHeight>100;}catch{}state.expanded=tall;setClass(doc.body,'tl-tracks-expanded',tall);for(const button of $$('#track-lanes .tl-track-expand')){button.setAttribute('aria-pressed',String(tall));button.title=tall?'Collapse tracks':'Expand tracks';}}
 function paintDropZone(){
  const lanes=$('#track-lanes');if(!lanes)return;let count=0;try{count=api.realTrackCount();}catch{}
  const target=[...lanes.querySelectorAll(':scope>.track-lane')].find(lane=>lane.querySelector('.track-label.logic-track-empty'))?.querySelector('.lane-grid');
  for(const stale of lanes.querySelectorAll('.tl-dropzone'))if(stale.parentElement!==target)stale.remove();
  if(!target||target.querySelector('.tl-dropzone'))return;
  target.insertAdjacentHTML('afterbegin',`<div class="tl-dropzone" aria-hidden="true">${TL_ICONS.drop}<span>Drop a loop or an audio/MIDI/video file</span></div>`);
  setClass(doc.body,'tl-no-tracks',!count);
 }
 const viewport=$('#arrangement-scroll');
 const paintViewport=()=>{if(viewport)doc.documentElement.style.setProperty('--tl-view-w',`${viewport.clientWidth}px`);};
 if(viewport&&win.ResizeObserver){const resize=new win.ResizeObserver(paintViewport);resize.observe(viewport);disposers.push(()=>resize.disconnect());}
 paintViewport();

 // ── Hooks: run after the fork's own track / mixer decoration
 const wrapped={};
 for(const name of ['afterTracks','mixer']){const inherited=logicShellHooks[name];wrapped[name]=inherited;logicShellHooks[name]=(...args)=>{let result;try{result=inherited?.(...args);}finally{try{decorateTracks();paintVolume();paintSave();paintDrawers();paintAutomation();}catch{}}return result;};}
 disposers.push(()=>{for(const name of Object.keys(wrapped))if(wrapped[name])logicShellHooks[name]=wrapped[name];});
 const timer=win.setInterval(()=>{paintVolume();paintSave();},1000);disposers.push(()=>win.clearInterval(timer));
 // The Inspector and the Library belong to the forked layout; this shell has neither.
 try{if(shell?.state?.panes?.inspector)shell.togglePane('inspector',false);if(shell?.state?.panes?.browser)shell.togglePane('browser',false);}catch{}
 // Opening zoom: about 77 px per bar, as wide as the reference layout shows a 4/4 bar.
 // Only with a laid-out timeline (a headless document has no width and keeps the inherited scale).
 try{const view=api.view();if(viewport?.clientWidth>0&&view&&Math.abs(view.scale-30)<.01)api.applyView({...view,scale:76.75});}catch{}
 paintTime();paintSignature();paintKey();paintVolume();paintSave();paintDrawers();decorateTracks();
 doc.body.classList.add('tl-ready');
 return{state,openAppMenu,openAddTrack,toggleFx,trackEffects,openNotes,closeNotes,decorateTracks,paintTime,paintSave,paintVolume,destroy(){for(const dispose of disposers.splice(0))try{dispose();}catch{}closeNotes();}};
}
