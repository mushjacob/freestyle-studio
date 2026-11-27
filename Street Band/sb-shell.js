/** Street Band shell: the simplified single-window workstation layout (control bar, Library, Tracks
 * area, Smart Controls, Editors, Note Pad, Quick Help) layered over the inherited shell
 * (logic-shell.js) and the unchanged engine, transport and history layers.
 *
 * Presentation and routing only. Every edit, mix change and plug-in write goes through a handler the
 * application passes in (`api`, see the end of app.js); controls the engine cannot back stay disabled
 * with the reason as their tooltip.
 */
import {gainToDb,dbToGain,formatDb,VOLUME_FLOOR_DB,VOLUME_CEIL_DB,SB_TRACK_ICONS} from './logic-shell.js';
import {PATCH_CATEGORIES,FAMILY_NAMES,samePatch,patchLoadMessage} from './logic-patch-library.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const glyph=(body,view='0 0 24 24',extra='')=>`<svg class="sb-icon" viewBox="${view}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>`;
/** Original line icons for the control bar and panes. */
export const SB_ICONS=Object.freeze({
 library:glyph('<path d="M4.500 9.500 6.800 5h10.400l2.300 4.500v8a1.500 1.500 0 0 1-1.500 1.500H6a1.500 1.500 0 0 1-1.500-1.500z"/><path d="M4.500 12h4.200a3.300 3.300 0 0 0 6.600 0h4.200"/><path d="M8.500 8h7"/>'),
 help:glyph('<circle cx="12" cy="12" r="8"/><path d="M9.700 9.800a2.400 2.400 0 1 1 3.500 2.100c-.8.400-1.200.9-1.200 1.800"/><path d="M12 16.400v.1" stroke-width="2"/>'),
 smart:glyph('<circle cx="12" cy="12" r="5.200"/><path d="M12 9.200V12"/><path d="M12 3.200v1.600M12 19.200v1.600M3.200 12h1.600M19.200 12h1.600M5.800 5.800l1.100 1.100M17.100 17.100l1.100 1.100M5.800 18.200l1.100-1.100M17.100 6.900l1.100-1.100"/>'),
 editors:glyph('<path d="M5 19l1-4L16.500 4.500l3 3L9 18z"/><path d="M14.500 6.500l3 3"/>'),
 tuner:glyph('<path d="M8.500 4v6a3.500 3.500 0 0 0 7 0V4"/><path d="M12 13.500V20"/>'),
 countIn:'<span class="sb-count-digits" aria-hidden="true"><i>1</i><i>2</i><b>3</b><b>4</b></span>',
 metronome:glyph('<path d="M9.500 4.500h5l3.500 15H6z"/><path d="M7 15.500h10"/><path d="M12 15.500l2.300-7.500"/><circle cx="13.700" cy="10" r="1.100" fill="currentColor" stroke="none"/>'),
 notes:glyph('<rect x="5" y="4.500" width="14" height="15" rx="1.600"/><path d="M5 8.500h14" stroke-width="2.400"/><path d="M8 12h8M8 15h8"/>'),
 loops:glyph('<circle cx="11" cy="11" r="6.500"/><path d="M11 17.500h9.500"/>'),
 media:glyph('<rect x="3.500" y="5.500" width="17" height="13" rx="1.800"/><path d="M3.500 15l4.500-4 4 3.500 3-2.500 5.500 4.500"/><circle cx="15.500" cy="9.500" r="1.300"/>'),
 plus:glyph('<path d="M12 6v12M6 12h12" stroke-width="1.800"/>'),
 catch:glyph('<path d="M12 4v16"/><path d="M9 4h6l-3 4z" fill="currentColor"/><path d="M4 9l3 3-3 3M20 9l-3 3 3 3"/>'),
 chevron:glyph('<path d="M9 6l6 6-6 6"/>'),
 chevronDown:glyph('<path d="M6 9l6 6 6-6"/>'),
 updown:glyph('<path d="M8 10l4-4 4 4M8 14l4 4 4-4"/>'),
 search:glyph('<circle cx="10.500" cy="10.500" r="5.500"/><path d="M15 15l4.500 4.500"/>'),
 arp:glyph('<path d="M4 17h3M8.500 13h3M13 9h3M17.500 13h3" stroke-width="2.400"/>'),
 power:glyph('<path d="M12 4v7"/><path d="M7.500 6.800a6.500 6.500 0 1 0 9 0"/>'),
 mic:glyph('<rect x="9" y="3.500" width="6" height="10.500" rx="3"/><path d="M6 11.500a6 6 0 0 0 12 0M12 17.500V21M9 21h6"/>','0 0 24 24'),
 guitar:glyph('<path d="M20.500 3.500l-7.200 7.200"/><path d="M19 2.500l2.500 2.500"/><path d="M13.800 9.600c-1.200-.9-2.700-.7-3.500.4-.5.700-1.400.9-2.300 1-1.700.200-3.200 1.300-3.700 3.100-.6 2.100.5 4.400 2.600 5.100 2 .7 3.900-.2 4.700-1.900.4-.8.500-1.700 1.200-2.200 1.200-.8 1.500-2.300.7-3.500z"/><circle cx="9" cy="15.500" r="1.400"/>'),
 drummer:glyph('<ellipse cx="12" cy="10" rx="7.500" ry="3"/><path d="M4.500 10v6c0 1.700 3.400 3 7.500 3s7.500-1.300 7.500-3v-6M8 12.700v5.800M16 12.700v5.800M3 3.500l6.500 5M21 3.500l-6.500 5"/>')
});
/** Street Band mark: a white pick on an orange tile (original artwork). */
export const SB_MARK='<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1.500" y="1.500" width="29" height="29" rx="7.500" fill="#f5871f"/><path d="M16 6.200c4.600 0 8.300 1.300 8.300 4.300 0 4.600-4.900 15.300-8.300 15.300S7.700 15.100 7.700 10.500c0-3 3.700-4.300 8.300-4.300z" fill="#fff"/><path d="M12.200 12.300h7.600M12.900 15.300h6.200M13.900 18.300h4.200" stroke="#f0721c" stroke-width="1.500" stroke-linecap="round"/></svg>';

const STORE='streetband:';
const store={get(key,fallback){try{const value=globalThis.localStorage?.getItem(STORE+key);return value===null||value===undefined?fallback:JSON.parse(value);}catch{return fallback;}},set(key,value){try{globalThis.localStorage?.setItem(STORE+key,JSON.stringify(value));}catch{}}};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
/** Keyboard Sensitivity slider (0–100, Neutral = 50) ↔ Musical Typing velocity (1–127, Neutral = 100). */
export const sensitivityToVelocity=slider=>{const s=clamp(Number(slider)||0,0,100);return Math.round(s<=50?1+s/50*99:100+(s-50)/50*27);};
export const velocityToSensitivity=velocity=>{const v=clamp(Number(velocity)||100,1,127);return Math.round(v<=100?(v-1)/99*50:50+(v-100)/27*50);};
/** New Track chooser cards → the inherited New Track form's `kind` value. */
export const SB_TRACK_TYPES=Object.freeze([
 {id:'instrument',kind:'instrument',title:'Software Instrument',text:'Play sounds from the Library with Musical Typing or a MIDI keyboard.',icon:'keys',tone:'green'},
 {id:'mic',kind:'vocal',title:'Audio',sub:'Microphone',text:'Record your voice or another microphone, with your default vocal effects.',icon:'mic',tone:'blue'},
 {id:'guitar',kind:'audio',title:'Audio',sub:'Guitar or Line',text:'Record a guitar, bass or line input, or drop in audio files.',icon:'guitar',tone:'blue'},
 {id:'drummer',kind:null,title:'Drummer',text:'A virtual session drummer.',icon:'drummer',tone:'yellow',reason:'Freestyle has no virtual drummer. Create a Software Instrument track and pick a drum kit in the Library.'}
]);

/** Street Band's short region menu: the everyday commands at the top level, every other inherited
 * command that can run under "More"; groups made only of unavailable entries are left out. */
export function streetBandRegionMenu(items){
 const rest=(items||[]).filter(Boolean).map(item=>Array.isArray(item.submenu)?{...item,submenu:[...item.submenu]}:item);
 const take=test=>{const at=rest.findIndex(item=>!item.submenu&&test(String(item.label||'')));return at<0?null:rest.splice(at,1)[0];};
 const from=(group,label)=>{const parent=rest.find(item=>item.label===group&&item.submenu),at=parent?parent.submenu.findIndex(item=>item&&item.label===label):-1;return at<0?null:parent.submenu.splice(at,1)[0];};
 const SEP=Symbol('separator');
 const top=[take(l=>l==='Cut'),take(l=>l==='Copy'),take(l=>l==='Paste'),take(l=>l.startsWith('Delete')),SEP,
  from('Split','Split at Playhead'),take(l=>l.startsWith('Repeat')),take(l=>/^(Mute|Unmute)/.test(l)),take(l=>l==='Loop'),SEP,
  from('Name and Color','Rename Regions'),take(l=>l==='Open in Piano Roll'),take(l=>l==='Open in Audio File Editor'),take(l=>l==='Show Region Automation…'),from('Processing','Stem Splitter…'),take(l=>l==='Render Region Effect…'),take(l=>l==='Region Properties…')];
 const usable=item=>item&&(Array.isArray(item.submenu)?item.submenu.some(usable):typeof item.run==='function');
 const more=rest.filter(usable).map(item=>item.submenu?{...item,submenu:item.submenu.filter((entry,index,list)=>entry!==null||(index>0&&index<list.length-1))}:item);
 const out=[];for(const item of top){if(item===SEP){if(out.length&&out[out.length-1]!==null)out.push(null);}else if(item)out.push(item);}
 while(out.length&&out[out.length-1]===null)out.pop();
 return more.length?[...out,null,{label:'More',submenu:more}]:out;
}

/** Street Band's short Tracks-area (empty space) menu; the other commands that can run go under "More". */
export function streetBandTracksMenu(items){
 const rest=(items||[]).filter(Boolean).map(item=>Array.isArray(item.submenu)?{...item,submenu:[...item.submenu]}:item);
 const take=label=>{const at=rest.findIndex(item=>!item.submenu&&item.label===label);return at<0?null:rest.splice(at,1)[0];};
 const groups=[[take('Create MIDI Region'),take('Add Audio File…')],[take('Paste'),take('Select All')],[take('New Tracks…')]].map(group=>group.filter(Boolean)).filter(group=>group.length);
 const usable=item=>item&&(Array.isArray(item.submenu)?item.submenu.some(usable):typeof item.run==='function');
 const more=rest.filter(usable),out=[];
 for(const group of groups){if(out.length)out.push(null);out.push(...group.map(item=>item.label==='New Tracks…'?{...item,label:'New Track…'}:item));}
 if(!out.length)return items;
 return more.length?[...out,null,{label:'More',submenu:more}]:out;
}

/** Street Band's short track-header menu: the everyday commands on top, the rest of the commands the
 * engine can perform (enabled or, right now, disabled with their reason) under "More"; entries that can
 * never run here are left out. */
export function streetBandHeaderMenu(items){
 const usable=item=>item&&(Array.isArray(item.submenu)?item.submenu.some(usable):typeof item.run==='function');
 const rest=(items||[]).filter(Boolean),top=[],first=['New Tracks…','New Audio Track','New Software Instrument Track','Rename Track','Delete Track','Mute Track','Unmute Track','Solo Track','Unsolo Track'];
 const pick=label=>{const at=rest.findIndex(item=>!item.submenu&&item.label===label);return at<0?null:rest.splice(at,1)[0];};
 for(const label of first){const item=pick(label);if(item)top.push(label==='New Tracks…'?{...item,label:'New Track…'}:item);}
 if(!top.length)return items;
 const out=[];for(const item of top){if(out.length&&(item.label==='Rename Track'||/^(Mute|Unmute) Track$/.test(item.label)))out.push(null);out.push(item);}
 const more=rest.filter(usable).map(item=>item.submenu?{...item,submenu:item.submenu.filter(entry=>entry===null||usable(entry))}:item);
 return more.length?[...out,null,{label:'More',submenu:more}]:out;
}

/**
 * @param {object} api application bridge (see app.js "Street Band shell").
 */
export function installStreetBandShell(api){
 const doc=api.document||globalThis.document,win=doc.defaultView||globalThis,$=selector=>doc.querySelector(selector),$$=selector=>[...doc.querySelectorAll(selector)];
 const state={panes:{library:store.get('pane:library',true),smart:store.get('pane:smart',false),notes:false,help:false},scope:'track',view:'controls',disposers:[],params:new Map(),eq:null,eqKey:null,knobs:[],smartKey:null,library:{laneId:null,family:undefined,query:'',category:null,results:null,searching:false,error:null,seq:0,painted:''}};
 const on=(target,type,listener,options)=>{if(!target)return;target.addEventListener(type,listener,options);state.disposers.push(()=>target.removeEventListener(type,listener,options));};
 const safe=run=>(...args)=>{try{const result=run(...args);if(result&&typeof result.catch==='function')result.catch(api.fail);return result;}catch(error){api.fail(error);return null;}};
 const Observer=win.MutationObserver||globalThis.MutationObserver;
 const body=doc.body,desktop=$('#desktop'),layout=$('.main-layout');
 body.classList.add('street-band');
 const el=(tag,className,html)=>{const node=doc.createElement(tag);if(className)node.className=className;if(html!==undefined)node.innerHTML=html;return node;};
 const logic=()=>api.logicShell;
 const setClass=(node,name,on)=>{if(node.classList.contains(name)!==on)node.classList.toggle(name,on);};

 // ── Control bar: icons, title-row status, count-in + metronome pair, master volume
 const setIcon=(selector,html)=>{for(const node of $$(selector))if(!node.querySelector('.sb-icon,.sb-count-digits'))node.innerHTML=html;};
 setIcon('[data-sb-pane="library"]',SB_ICONS.library);setIcon('[data-sb-pane="help"]',SB_ICONS.help);setIcon('[data-sb-pane="smart"]',SB_ICONS.smart);setIcon('[data-sb-pane="editors"]',SB_ICONS.editors);setIcon('[data-sb-pane="notes"]',SB_ICONS.notes);
 setIcon('#sb-tuner',SB_ICONS.tuner);setIcon('#sb-catch',SB_ICONS.catch);
 for(const [selector,html]of [['[data-logic-pane="loops"]',SB_ICONS.loops],['[data-logic-pane="browser"]',SB_ICONS.media],['#new-track',SB_ICONS.plus],['#metronome',SB_ICONS.metronome]]){const node=$(selector);if(node){node.innerHTML=html;node.classList.add('sb-bar-button');}}
 const hint=$('#hint'),titlebar=$('.logic-titlebar'),session=$('.session-status');
 if(hint&&titlebar&&session&&hint.parentElement!==titlebar){hint.classList.add('sb-status-line');titlebar.insertBefore(hint,session);}
 const projectTitle=$('#project-title');if(projectTitle&&!$('.sb-title-suffix')){const suffix=el('span','sb-title-suffix');suffix.textContent=' - Tracks';projectTitle.after(suffix);}
 function placeCountIn(){const button=$('#logic-count-in'),slot=$('#sb-count-in-slot');if(!button||!slot)return;if(button.parentElement!==slot){slot.append(button);}if(!button.querySelector('.sb-count-digits')){button.innerHTML=SB_ICONS.countIn;button.classList.add('sb-bar-button');}}
 placeCountIn();
 const menuButton=$('#main-menu [data-menu="Street Band"]');menuButton?.classList.add('sb-app-menu');

 // ── Pane state
 function paintPanes(){
  // Only real changes touch the DOM: the body class observer below must never be fed by its own repaint.
  for(const name of ['library','smart','notes','help'])setClass(body,'sb-show-'+name,!!state.panes[name]);
  const editors=!!api.editorVisible?.();
  for(const button of $$('[data-sb-pane]')){const name=button.dataset.sbPane,lit=name==='editors'?editors:!!state.panes[name];setClass(button,'lit',lit);if(button.getAttribute('aria-pressed')!==String(lit))button.setAttribute('aria-pressed',String(lit));}
  for(const [selector,name]of [['#sb-smart','smart'],['#sb-notes','notes'],['#sb-quick-help','help']]){const node=$(selector);if(node&&node.hidden!==!state.panes[name])node.hidden=!state.panes[name];}
 }
 const shown=name=>name==='editors'?!!api.editorVisible?.():name==='loops'?!!logic()?.state?.panes?.loops:name==='media'?!!logic()?.state?.panes?.browser:!!state.panes[name];
 function openEditor(kind){
  const region=api.selectedRegion?.(),pick=kind||(region&&!region.patternId?'audio':'piano');
  if(state.panes.smart){state.panes.smart=false;store.set('pane:smart',false);}
  const result=api.openEditor(pick);paintPanes();return result;
 }
 function toggle(name,force){
  if(name==='editors'){const next=typeof force==='boolean'?force:!api.editorVisible();if(next)openEditor();else{api.closeEditor();paintPanes();}return next;}
  if(name==='loops'||name==='media'){const pane=name==='media'?'browser':'loops',next=typeof force==='boolean'?force:!logic().state.panes[pane];if(next&&state.panes.notes)state.panes.notes=false;logic().togglePane(pane,next);paintPanes();return next;}
  const next=typeof force==='boolean'?force:!state.panes[name];state.panes[name]=next;
  if(name==='smart'){if(next&&api.editorVisible())api.closeEditor();store.set('pane:smart',next);}
  if(name==='library')store.set('pane:library',next);
  if(name==='notes'&&next){const panes=logic()?.state?.panes;if(panes?.loops)logic().togglePane('loops',false);if(panes?.browser)logic().togglePane('browser',false);loadNotes();}
  paintPanes();
  if(name==='smart'&&next)renderSmart(true);if(name==='library'&&next)paintLibrary(true);
  if(name==='notes'&&next)$('#sb-notes textarea')?.focus?.();
  return next;
 }
 for(const button of $$('[data-sb-pane]'))on(button,'click',()=>{if(!button.disabled)toggle(button.dataset.sbPane);});
 // The inherited right-hand browser buttons close the Note Pad (one right pane at a time).
 for(const button of $$('[data-logic-pane="loops"],[data-logic-pane="browser"]'))on(button,'click',()=>{if(state.panes.notes){state.panes.notes=false;paintPanes();}});

 // ── Library (left): the selected software-instrument track's patches
 const library=el('aside','sb-library');library.id='sb-library';library.setAttribute('aria-label','Library');
 library.innerHTML=`<header class="sb-lib-head"><b>Library</b><button type="button" class="sb-lib-scope" aria-haspopup="menu" title="Sounds shown in the Library">All Sounds${SB_ICONS.updown}</button></header><div class="sb-lib-hero"><div class="sb-lib-icon" aria-hidden="true"></div><div class="sb-lib-name"></div><div class="sb-lib-sub"></div></div><form class="sb-lib-search" role="search"><span aria-hidden="true">${SB_ICONS.search}</span><input type="search" name="q" placeholder="Search Sounds" aria-label="Search Sounds" autocomplete="off"></form><div class="sb-lib-columns"><div class="sb-lib-cats" role="listbox" aria-label="Categories"></div><div class="sb-lib-patches" aria-label="Patches"></div></div><footer class="sb-lib-foot"><button type="button" class="sb-push" data-lib="revert" disabled title="Revert: use Edit ▸ Undo (⌘Z) to go back to the previous patch.">Revert</button><span></span><button type="button" class="sb-push" data-lib="delete" disabled title="Delete: Freestyle’s catalogue patches cannot be deleted.">Delete</button><button type="button" class="sb-push" data-lib="save" disabled title="Save…: Freestyle cannot store user patches yet.">Save…</button></footer>`;
 layout?.prepend(library);
 const lib=state.library,libSel=selector=>library.querySelector(selector);
 const patchController=()=>{try{return api.patches?.()||null;}catch{return null;}};
 function libraryInfo(){
  const row=api.selectedRow?.(),laneId=Number.isInteger(row)?api.laneId(row):null,kind=Number.isInteger(row)?api.laneKind(row):null,controller=patchController();
  let info=null;try{info=controller?controller.instrument(laneId):null;}catch{info=null;}
  return{row,laneId,kind,controller,info,name:Number.isInteger(row)?api.trackName(row):''};
 }
 function paintLibrary(force=false){
  if(!state.panes.library&&!force)return;
  const {laneId,kind,controller,info,name}=libraryInfo(),ok=!!info?.ok,family=ok?info.family:null,busy=controller?.busy||null;
  if(family!==lib.family){lib.results=null;lib.error=null;lib.category=null;lib.searching=false;lib.seq++;}
  lib.laneId=laneId;lib.family=family;
  const tone=kind==='audio'||kind==='vocal'||kind==='guitar'?'blue':kind?'green':'dim',icon=tone==='blue'?SB_TRACK_ICONS.audio:SB_TRACK_ICONS.keys;
  const title=ok?(info.preset||FAMILY_NAMES[family]||name):name||'No Track Selected',sub=ok?`${FAMILY_NAMES[family]||''}${info.preset&&name?` · ${name}`:''}`:'';
  const cats=PATCH_CATEGORIES.map(([label,q])=>`<button type="button" role="option" class="sb-lib-row${lib.category===q?' selected':''}" data-cat="${esc(q)}" aria-selected="${lib.category===q}"${busy?' disabled':''}><span>${esc(label)}</span>${SB_ICONS.chevron}</button>`).join('');
  let list;
  if(!ok)list=`<p class="sb-lib-empty" role="status">${esc(info?.reason||(api.ready?.()?'Select a software instrument track to browse its sounds.':'Open a Freestyle project, then select a software instrument track to browse its sounds.'))}</p>`;
  else if(lib.searching)list=`<p class="sb-lib-empty" role="status">Searching ${esc(FAMILY_NAMES[family])} sounds…</p>`;
  else if(lib.error)list=`<p class="sb-lib-empty sb-lib-error" role="alert">${esc(lib.error)}</p>`;
  else if(!lib.results)list=`<p class="sb-lib-empty">Choose a category or search. Freestyle searches its ${esc(FAMILY_NAMES[family])} catalogue when you ask (each search uses Freestyle AI quota).</p>`;
  else if(!lib.results.length)list=`<p class="sb-lib-empty" role="status">No ${esc(FAMILY_NAMES[family])} sounds found.</p>`;
  else list=`<div role="listbox" aria-label="Patches">${lib.results.map((row,index)=>{const current=samePatch(info.preset,row.name),loading=busy&&busy.name===row.name;return`<button type="button" role="option" class="sb-lib-row${current?' selected':''}${loading?' loading':''}" aria-selected="${current}" data-patch="${index}" title="${esc([row.pack,row.category,(row.tags||[]).join(', ')].filter(Boolean).join(' · ')||row.name)}"${busy?' disabled':''}><span>${esc(row.name)}</span></button>`;}).join('')}</div>`;
  const key=JSON.stringify([tone,title,sub,cats,list,ok,!!busy]);if(key===lib.painted&&!force)return;lib.painted=key;
  const iconHost=libSel('.sb-lib-icon');iconHost.innerHTML=icon;iconHost.dataset.tone=tone;
  libSel('.sb-lib-name').textContent=title;libSel('.sb-lib-sub').textContent=busy?`Loading “${busy.name}”…`:sub;
  const active=doc.activeElement,focusPatch=active&&library.contains(active)?active.dataset?.patch??null:null;
  libSel('.sb-lib-cats').innerHTML=cats;libSel('.sb-lib-patches').innerHTML=list;
  const input=libSel('input[name="q"]');input.disabled=!ok||!!busy;input.title=ok?'':'Select a software instrument track first.';
  if(focusPatch!=null)libSel(`[data-patch="${focusPatch}"]`)?.focus?.();
 }
 async function librarySearch(query,category=null){
  const {laneId,controller,info}=libraryInfo();if(!controller||!info?.ok){lib.category=category;paintLibrary(true);return;}
  paintLibrary(true);const seq=++lib.seq;if(!category)lib.query=query;lib.category=category;lib.searching=true;lib.error=null;paintLibrary(true);
  try{const rows=await controller.search({laneId,query});if(seq!==lib.seq)return;lib.results=rows;}
  catch(error){if(seq!==lib.seq)return;lib.results=null;lib.error=error?.message||'Freestyle could not search its sounds.';}
  finally{if(seq===lib.seq){lib.searching=false;paintLibrary(true);}}
 }
 async function libraryLoad(index){
  const row=lib.results?.[index],{laneId,controller}=libraryInfo();if(!row||!controller)return;
  try{const result=await controller.load({laneId,patch:row});api.toast(patchLoadMessage(result));}catch(error){api.fail(error);}finally{paintLibrary(true);}
 }
 on(library,'submit',event=>{event.preventDefault();const q=String(libSel('input[name="q"]')?.value||'').trim();if(q)librarySearch(q);});
 on(library,'click',event=>{const target=event.target?.closest?.('button');if(!target||target.disabled||!library.contains(target))return;
  if(target.dataset.cat)librarySearch(target.dataset.cat,target.dataset.cat);else if(target.dataset.patch!=null)libraryLoad(Number(target.dataset.patch));
  else if(target.classList.contains('sb-lib-scope')){event.stopPropagation();const rect=target.getBoundingClientRect();api.menu({clientX:rect.left,clientY:rect.bottom+3},[{label:'All Sounds',checked:true,run:()=>{}},null,{label:'Sound Packs',disabled:true,title:'Freestyle streams one catalogue per instrument; there are no downloadable sound packs.'}]);}});
 // Typing in the search field must not reach the Tracks-area key commands (Space, Y, B, …).
 on(library,'keydown',event=>{
  if(event.target?.name==='q'){if(event.key!=='Escape')event.stopPropagation();return;}
  const option=event.target?.closest?.('.sb-lib-row');if(!option||!['ArrowDown','ArrowUp'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();const rows=[...option.parentElement.querySelectorAll('.sb-lib-row')],next=rows[rows.indexOf(option)+(event.key==='ArrowDown'?1:-1)];next?.focus?.();
 });

 // ── Smart Controls (bottom): Track | Master · Compare · Controls | EQ
 const smart=el('section','sb-smart');smart.id='sb-smart';smart.setAttribute('aria-label','Smart Controls');smart.hidden=true;
 smart.innerHTML=`<div class="sb-smart-bar"><div class="sb-seg" role="tablist" aria-label="Smart Controls target"><button type="button" role="tab" data-sb-scope="track" aria-selected="true" class="selected">Track</button><button type="button" role="tab" data-sb-scope="master" aria-selected="false">Master</button></div><button type="button" class="sb-push sb-compare" disabled title="Compare: Freestyle keeps one setting per track, so there is no saved setting to compare with. Use Undo (⌘Z) to hear the previous value.">Compare</button><div class="sb-seg sb-seg-view" role="tablist" aria-label="Smart Controls view"><button type="button" role="tab" data-sb-view="controls" aria-selected="true" class="selected">Controls</button><button type="button" role="tab" data-sb-view="eq" aria-selected="false">EQ</button></div><button type="button" class="sb-push sb-arp" disabled aria-label="Arpeggiator" title="Arpeggiator: Freestyle has no arpeggiator MIDI effect.">${SB_ICONS.arp}</button></div><div class="sb-smart-body"><aside class="sb-smart-inspector" aria-label="Track settings"></aside><div class="sb-smart-main"></div></div>`;
 desktop?.append(smart);
 const smartInspector=smart.querySelector('.sb-smart-inspector'),smartMain=smart.querySelector('.sb-smart-main');
 function mixerValues(row){
  let mixer=null;try{mixer=row==='master'?api.masterRow():api.trackMixerRow(row);}catch{}
  const gain=mixer?.values?.gain,pan=mixer?.values?.pan,none=api.ready?.()?'This track is not saved in Freestyle yet.':'Open a Freestyle project first.';
  return{mixer,gainKnown:!!(mixer?.controls?.gain?.enabled&&gain?.known),gain:gain?.known?Number(gain.value):null,gainReason:mixer?mixer.controls?.gain?.reason||'Volume is unavailable.':none,panKnown:!!(mixer?.controls?.pan?.enabled&&pan?.known),pan:pan?.known?Number(pan.value):null,panReason:mixer?mixer.controls?.pan?.reason||'Pan is unavailable.':none};
 }
 /** While a volume or pan control is dragged the app holds its live-mix repaint, so the model keeps the pre-drag value until release. */
 const liveGesture=active=>{try{api.liveMixGesture?.(active);}catch{}};
 /** A skeuomorphic rotary control. `read()` → current value or null; drag = live, release = commit. */
 function makeKnob({label,min=0,max=1,def=null,step=0,read,enabled=()=>true,reason=()=>'',format=value=>String(Math.round(value*100)/100),onInput=null,onLive=null,onCommit}){
  const cell=el('div','sb-knob-cell'),name=el('span','sb-knob-label'),knob=el('div','sb-knob','<span class="sb-knob-ticks"></span><span class="sb-knob-ring"></span><span class="sb-knob-cap"><i></i></span>');
  name.textContent=label;knob.setAttribute('role','slider');knob.setAttribute('aria-label',label);knob.setAttribute('aria-valuemin',String(min));knob.setAttribute('aria-valuemax',String(max));cell.append(name,knob);
  let value=min,dragging=false,keyTimer=null,keyStart=null;
  const quant=next=>{let out=clamp(next,min,max);if(step>0)out=Math.round((out-min)/step)*step+min;return clamp(out,min,max);};
  const show=next=>{value=next;const ratio=max>min?(next-min)/(max-min):0;knob.style.setProperty('--sb-angle',`${-135+ratio*270}deg`);knob.setAttribute('aria-valuenow',String(Math.round(next*1000)/1000));knob.setAttribute('aria-valuetext',format(next));};
  const paint=()=>{if(dragging||keyTimer!==null)return;const ok=!!enabled(),current=read();knob.classList.toggle('disabled',!ok||!Number.isFinite(current));knob.setAttribute('aria-disabled',String(!ok||!Number.isFinite(current)));knob.tabIndex=ok&&Number.isFinite(current)?0:-1;show(Number.isFinite(current)?clamp(current,min,max):(def??min));cell.title=ok&&Number.isFinite(current)?`${label}: ${format(value)}`:`${label}: ${reason()||'unavailable'}`;};
  const usable=()=>knob.getAttribute('aria-disabled')!=='true';
  const commit=(before,after)=>{if(Math.abs(after-before)<1e-9)return;try{const result=onCommit(before,after);if(result&&typeof result.then==='function')result.then(()=>paint(),error=>{api.fail(error);paint();});}catch(error){api.fail(error);paint();}};
  knob.addEventListener('pointerdown',event=>{if(event.button!==0||!usable())return;event.preventDefault();knob.focus?.({preventScroll:true});const start=value;let originY=event.clientY,current=value,heard=false;dragging=true;knob.classList.add('dragging');try{knob.setPointerCapture?.(event.pointerId);}catch{}
   // Mixer knobs (onLive): the value is heard while the pointer moves; the app holds its live-mix repaint for the gesture, and the release is the one saved write.
   if(onLive)liveGesture(true);
   const move=next=>{const span=(max-min)/(next.shiftKey?900:180);current=clamp(current+(originY-next.clientY)*span,min,max);originY=next.clientY;const shownValue=quant(current);show(shownValue);cell.title=`${label}: ${format(shownValue)}`;try{onInput?.(shownValue);}catch{}if(onLive)try{heard=onLive(shownValue)||heard;}catch{}};
   const up=()=>{knob.removeEventListener('pointermove',move);knob.removeEventListener('pointerup',up);knob.removeEventListener('pointercancel',up);dragging=false;knob.classList.remove('dragging');const end=quant(current);try{if(heard&&Math.abs(end-start)<1e-9)try{onLive(start);}catch{}commit(start,end);}finally{if(onLive)liveGesture(false);}};
   knob.addEventListener('pointermove',move);knob.addEventListener('pointerup',up);knob.addEventListener('pointercancel',up);});
  knob.addEventListener('dblclick',event=>{event.stopPropagation();if(!usable()||def===null)return;const before=value;show(def);commit(before,def);});
  knob.addEventListener('keydown',event=>{const dir=event.key==='ArrowUp'||event.key==='ArrowRight'?1:event.key==='ArrowDown'||event.key==='ArrowLeft'?-1:0;if(!dir||!usable())return;event.preventDefault();event.stopPropagation();if(keyTimer===null)keyStart=value;else clearTimeout(keyTimer);const next=quant(value+dir*(step>0?step:(max-min)/(event.shiftKey?200:50)));show(next);try{onInput?.(next);}catch{}keyTimer=setTimeout(()=>{keyTimer=null;commit(keyStart,value);},350);});
  paint();return{element:cell,paint};
 }
 const panel=(title,knobs,{note='',wide=false}={})=>{const node=el('section','sb-panel'+(wide?' sb-panel-wide':''));node.setAttribute('aria-label',title);const head=el('h4','sb-panel-title');head.textContent=title;const grid=el('div','sb-panel-knobs');for(const knob of knobs){grid.append(knob.element);state.knobs.push(knob);}node.append(head,grid);if(note){const text=el('p','sb-panel-note');text.textContent=note;node.append(text);}return node;};
 const dbFormat=value=>value<=VOLUME_FLOOR_DB?'-∞ dB':`${value>0?'+':''}${value.toFixed(1)} dB`;
 const panFormat=value=>{const amount=Math.round(value*64);return amount===0?'Centre':amount<0?`${-amount} L`:`${amount} R`;};
 function volumeKnob(row,label='VOLUME'){
  return makeKnob({label,min:VOLUME_FLOOR_DB,max:VOLUME_CEIL_DB,def:0,step:.1,format:dbFormat,read:()=>{const values=mixerValues(row);return values.gain===null?null:clamp(gainToDb(values.gain),VOLUME_FLOOR_DB,VOLUME_CEIL_DB);},enabled:()=>mixerValues(row).gainKnown,reason:()=>mixerValues(row).gainReason,
   onLive:db=>row==='master'?api.liveMasterGain?.(dbToGain(db)):api.liveTrackControl?.(row,'gain',dbToGain(db)),
   onCommit:(before,after)=>{const current=mixerValues(row);if(!current.gainKnown)return null;return row==='master'?api.setMasterGain(current.gain,dbToGain(after)):api.setTrackControl(row,'gain',current.gain,dbToGain(after));}});
 }
 function panKnob(row){
  return makeKnob({label:'PAN',min:-1,max:1,def:0,format:panFormat,read:()=>mixerValues(row).pan,enabled:()=>mixerValues(row).panKnown,reason:()=>mixerValues(row).panReason,onLive:value=>api.liveTrackControl?.(row,'pan',Math.round(value*1000)/1000),onCommit:(before,after)=>{const current=mixerValues(row);if(!current.panKnown)return null;return api.setTrackControl(row,'pan',current.pan,Math.round(after*1000)/1000);}});
 }
 const instanceOf=plugin=>plugin?.instance_id??plugin?.instanceId??plugin?.id??null;
 const paramKey=(row,plugin)=>`${api.projectId?.()}|${row==='master'?'master':api.laneId(row)}|${instanceOf(plugin)}|${plugin?.index}`;
 function chainFor(row){try{return(row==='master'?api.masterChain():api.chain(row))||{instrument:null,effects:[]};}catch{return{instrument:null,effects:[]};}}
 function pluginPanel(row,plugin){
  const key=paramKey(row,plugin),entry=state.params.get(key),name=api.pluginName(plugin)||'Plug-in';
  if(entry?.status==='ready'){
   const rows=entry.controller.parameters.map(parameter=>({parameter,control:entry.controller.parameterControl(parameter)})).filter(item=>item.control&&Number.isFinite(item.control.value)&&Number(item.control.max)>Number(item.control.min)).slice(0,8);
   if(!rows.length)return panelMessage(name,'This plug-in reports no adjustable parameters to Freestyle.',row,plugin);
   const knobs=rows.map(({parameter,control})=>{const index=parameter.index,unit=control.form==='physical'&&control.unit?' '+control.unit:'';
    const live=()=>{const fresh=entry.controller.parameters.find(item=>item.index===index),held=entry.controller.parameterWriteValue?.(index),now=fresh?entry.controller.parameterControl(fresh):null;return held!==undefined?Number(held):now?Number(now.value):null;};
    return makeKnob({label:String(parameter.name||`Param ${index+1}`).toUpperCase().slice(0,14),min:Number(control.min),max:Number(control.max),step:typeof control.step==='number'?control.step:0,def:Number.isFinite(Number(parameter.default))?clamp(Number(parameter.default),Number(control.min),Number(control.max)):null,format:value=>`${Math.round(value*1000)/1000}${unit}`,read:live,enabled:()=>parameter.stale!==true,reason:()=>'Reload the plug-in controls.',
     onInput:value=>{try{entry.controller.liveParameter(plugin,index,value);}catch{}},onCommit:(before,after)=>api.writeParameter({controller:entry.controller,c:entry.c,plugin,index,before,value:after,repaint:()=>paintKnobs()})});});
   return panel(name.toUpperCase(),knobs,{wide:rows.length>4});
  }
  return panelMessage(name,entry?.status==='loading'?'Reading this plug-in’s controls from Freestyle…':entry?.status==='error'?entry.message:'',row,plugin,entry?.status!=='loading');
 }
 function panelMessage(name,message,row,plugin,canLoad=false){
  const node=el('section','sb-panel sb-panel-plugin');node.setAttribute('aria-label',name);const head=el('h4','sb-panel-title');head.textContent=name.toUpperCase();node.append(head);
  const box=el('div','sb-panel-actions');if(message){const text=el('p','sb-panel-note');text.textContent=message;box.append(text);}
  if(canLoad&&row!=='master'){const load=el('button','sb-push sb-face-button');load.type='button';load.textContent='Show Controls';load.title='Read this plug-in’s parameters from Freestyle and show the first eight as knobs.';load.addEventListener('click',()=>loadPlugin(row,plugin));box.append(load);}
  const open=el('button','sb-push sb-face-button');open.type='button';open.textContent='Open Plug-in';open.title='Open the plug-in window.';open.addEventListener('click',safe(()=>api.openPlugin(row,plugin)));box.append(open);node.append(box);return node;
 }
 async function loadPlugin(row,plugin){
  const key=paramKey(row,plugin);if(state.params.get(key)?.status==='loading')return;state.params.set(key,{status:'loading'});renderSmart(true);
  try{const loaded=await api.loadParameters(row,plugin);state.params.set(key,{status:'ready',...loaded});}catch(error){state.params.set(key,{status:'error',message:error?.message||'Freestyle could not read this plug-in.'});}
  renderSmart(true);
 }
 function paintKnobs(){for(const knob of state.knobs)try{knob.paint();}catch{}}
 function destroyEq(){try{state.eq?.destroy?.();}catch{}state.eq=null;state.eqKey=null;}
 function renderSmart(force=false){
  if(!state.panes.smart)return;
  const selected=api.selectedRow?.(),master=state.scope==='master',row=master?'master':selected,hasRow=master||Number.isInteger(selected),laneId=master?'master':hasRow?api.laneId(selected):null,kind=master?'master':hasRow?api.laneKind(selected):null,chain=hasRow?chainFor(row):{instrument:null,effects:[]};
  const plugins=[chain.instrument,...(chain.effects||[])].filter(Boolean),signature=plugins.map(plugin=>`${instanceOf(plugin)}:${plugin.index}:${state.params.get(paramKey(row,plugin))?.status||''}:${plugin.bypassed===true}`).join(',');
  const key=JSON.stringify([state.scope,state.view,laneId,kind,signature,api.projectId?.()||null,hasRow?api.trackName?.(selected):null]);
  if(key===state.smartKey&&!force){paintKnobs();return;}state.smartKey=key;
  for(const button of smart.querySelectorAll('[data-sb-scope]')){const active=button.dataset.sbScope===state.scope;button.classList.toggle('selected',active);button.setAttribute('aria-selected',String(active));}
  for(const button of smart.querySelectorAll('[data-sb-view]')){const active=button.dataset.sbView===state.view;button.classList.toggle('selected',active);button.setAttribute('aria-selected',String(active));}
  renderSmartInspector({master,row,hasRow,kind,plugins});
  state.knobs=[];
  if(state.view==='eq'){
   const reason=master?'The master output has no EQ stage. Add an EQ plug-in to the output from Plug-ins.':!hasRow?(api.ready?.()?'Select a track to see its EQ.':'Open a Freestyle project to use the EQ.'):api.eqReason(selected);
   if(reason){destroyEq();smartMain.replaceChildren(message(reason,'sb-eq-placeholder'));return;}
   const eqKey=`${api.projectId?.()}|${laneId}`;
   if(state.eqKey!==eqKey||!state.eq?.element?.isConnected){destroyEq();try{state.eq=api.mountEq(selected);state.eqKey=eqKey;smartMain.replaceChildren(state.eq.element);}catch(error){smartMain.replaceChildren(message(error?.message||'The EQ is unavailable for this track.','sb-eq-placeholder'));}}
   return;
  }
  destroyEq();
  const face=el('div','sb-face');
  if(!hasRow){face.append(panel('TRACK',[makeKnob({label:'VOLUME',read:()=>null,enabled:()=>false,reason:()=>api.ready?.()?'Select a track first.':'Open a Freestyle project first.',onCommit:()=>null}),makeKnob({label:'PAN',min:-1,max:1,def:0,read:()=>null,enabled:()=>false,reason:()=>api.ready?.()?'Select a track first.':'Open a Freestyle project first.',onCommit:()=>null})]));}
  else if(master)face.append(panel('MASTER',[volumeKnob('master')]));
  else face.append(panel(String(api.trackName(selected)||'TRACK').toUpperCase().slice(0,22),[volumeKnob(selected),panKnob(selected)]));
  for(const plugin of plugins.slice(0,3))face.append(pluginPanel(row,plugin));
  if(plugins.length>3){const more=el('p','sb-face-more');more.textContent=`${plugins.length-3} more plug-in${plugins.length-3===1?'':'s'} in Plug-ins`;face.append(more);}
  smartMain.replaceChildren(face);
 }
 const message=(text,className='')=>{const node=el('p','sb-smart-message'+(className?' '+className:''));node.setAttribute('role','status');node.textContent=text;return node;};
 function renderSmartInspector({master,row,hasRow,kind,plugins}){
  const open=key=>store.get('insp:'+key,key!=='plugins')?' open':'',audio=kind==='audio'||kind==='vocal'||kind==='guitar';
  const velocity=Number(api.typingVelocity?.())||100,slider=velocityToSensitivity(velocity);
  const first=master?'':audio?`<details class="sb-insp" data-section="recording"${open('recording')}><summary><span>Recording Settings</span>${SB_ICONS.chevron}</summary><div class="sb-insp-body"><p>Audio is recorded from this browser’s microphone when you press Record (R). Input monitoring, the noise gate and input selection are not available for cloud tracks.</p></div></details>`
   :`<details class="sb-insp" data-section="sensitivity"${open('sensitivity')}><summary><span>Keyboard Sensitivity</span>${SB_ICONS.chevron}</summary><div class="sb-insp-body"><div class="sb-sens"><input type="range" class="sb-sens-slider" min="0" max="100" step="1" value="${slider}" aria-label="Keyboard Sensitivity" title="Velocity ${velocity} for notes played with Musical Typing (⌘K)"><div class="sb-sens-scale" aria-hidden="true"><span>Less</span><span>Neutral</span><span>More</span></div></div><p>Drag the slider to adjust the velocity level of notes you play.</p></div></details>`;
  const rows=plugins.map((plugin,index)=>`<li><button type="button" class="sb-plugin-row" data-plugin="${index}" title="Open ${esc(api.pluginName(plugin))}"><i class="sb-plugin-led${plugin.bypassed===true?' off':''}" aria-hidden="true"></i><span>${esc(api.pluginName(plugin))}</span>${SB_ICONS.chevron}</button></li>`).join('');
  const none=!hasRow?(api.ready?.()?'Select a track to see its plug-ins.':'Open a Freestyle project to see a track’s plug-ins.'):plugins.length?'':'No plug-ins on this '+(master?'output':'track')+' yet.';
  smartInspector.innerHTML=`${first}<details class="sb-insp" data-section="plugins"${open('plugins')}><summary><span>Plug-ins</span>${SB_ICONS.chevron}</summary><div class="sb-insp-body">${rows?`<ul class="sb-plugin-list">${rows}</ul>`:`<p>${esc(none)}</p>`}<button type="button" class="sb-push sb-add-plugin"${hasRow&&!master&&api.ready?.()?'':' disabled'} title="${hasRow&&!master?'Add, reorder, bypass or remove this track’s plug-ins.':master?'Select a track to edit plug-ins; the output’s plug-ins open from the list above.':'Select a track first.'}">Edit Plug-ins…</button></div></details>`;
  for(const details of smartInspector.querySelectorAll('details'))details.addEventListener('toggle',()=>store.set('insp:'+details.dataset.section,details.open));
  const sens=smartInspector.querySelector('.sb-sens-slider');
  if(sens)sens.addEventListener('input',()=>{const next=sensitivityToVelocity(sens.value);try{api.setTypingVelocity(next);}catch{}sens.title=`Velocity ${next} for notes played with Musical Typing (⌘K)`;});
  for(const button of smartInspector.querySelectorAll('[data-plugin]'))button.addEventListener('click',safe(()=>api.openPlugin(row,plugins[Number(button.dataset.plugin)])));
  smartInspector.querySelector('.sb-add-plugin')?.addEventListener('click',safe(()=>api.addPlugin()));
 }
 on(smart,'click',event=>{const button=event.target?.closest?.('[data-sb-scope],[data-sb-view]');if(!button||button.disabled)return;if(button.dataset.sbScope)state.scope=button.dataset.sbScope;else state.view=button.dataset.sbView;renderSmart(true);});
 on(smart,'keydown',event=>{if(event.target?.matches?.('input[type="number"],input[type="search"],select'))event.stopPropagation();});
 function showMaster(){state.scope='master';state.view='controls';toggle('smart',true);renderSmart(true);}

 // ── Note Pad (right): kept in this browser, per project
 const notes=el('aside','sb-notes');notes.id='sb-notes';notes.setAttribute('aria-label','Note Pad');notes.hidden=true;
 notes.innerHTML='<header class="sb-notes-head"><b>Note Pad</b><button type="button" class="sb-notes-close" aria-label="Close Note Pad" title="Close the Note Pad">×</button></header><textarea aria-label="Project notes" placeholder="Write notes or lyrics for this project…" spellcheck="true"></textarea><footer class="sb-notes-foot">Notes are kept in this browser only. Freestyle projects have no notes field, so they are not saved with the project or shared.</footer>';
 layout?.append(notes);
 const notesArea=notes.querySelector('textarea'),notesKey=()=>'notes:'+(api.projectId?.()||'no-project');
 let notesLoadedFor=null;
 function loadNotes(){const key=notesKey();if(notesLoadedFor===key)return;notesLoadedFor=key;notesArea.value=store.get(key,'');}
 on(notesArea,'input',()=>{if(notesLoadedFor)store.set(notesLoadedFor,notesArea.value);});
 on(notesArea,'keydown',event=>{if(event.key!=='Escape')event.stopPropagation();});
 on(notes.querySelector('.sb-notes-close'),'click',()=>toggle('notes',false));

 // ── Quick Help: a short description of whatever is under the pointer
 const help=el('div','sb-quick-help');help.id='sb-quick-help';help.setAttribute('role','status');help.hidden=true;help.innerHTML='<b>Quick Help</b><p>Move the pointer over a control to see what it does.</p>';
 body.append(help);
 let helpTarget=null;
 on(doc,'pointermove',event=>{
  if(!state.panes.help)return;const target=event.target?.closest?.('[title],[aria-label]');if(!target||target===helpTarget||help.contains(target))return;helpTarget=target;
  const label=target.getAttribute('aria-label')||'',title=target.getAttribute('title')||'',head=label||title.split(/[·:(]/)[0].trim()||'Quick Help',text=title&&title!==head?title:label?`${label}.`:'';
  help.querySelector('b').textContent=head.slice(0,60);help.querySelector('p').textContent=text||'No further description.';
 },{passive:true,capture:true});

 // ── Tracks area: catch button, ruler density, zoom slider placement
 const catchButton=$('#sb-catch');
 function paintCatch(){if(!catchButton)return;let enabled=true;try{enabled=!!api.catchEnabled();}catch{}setClass(catchButton,'lit',enabled);if(catchButton.getAttribute('aria-pressed')!==String(enabled))catchButton.setAttribute('aria-pressed',String(enabled));}
 on(catchButton,'click',()=>{safe(()=>api.toggleCatch())();paintCatch();});
 const zoomLabel=$('#logic-zoom-h')?.closest?.('label');if(zoomLabel){zoomLabel.classList.add('sb-zoom');zoomLabel.title='Horizontal zoom (⌘← / ⌘→)';$('#playlist')?.append(zoomLabel);}

 // ── Loop Browser: Loops | Patterns. Patterns lists this project's patterns; a row is dragged into the Tracks area.
 const loopTabs=el('div','sb-seg sb-loop-tabs','<button type="button" role="tab" data-sb-loops="favorites" aria-selected="true" class="selected" title="Loops from the Freestyle sound library">Loops</button><button type="button" role="tab" data-sb-loops="patterns" aria-selected="false" title="Patterns in this project: drag one into the Tracks area">Patterns</button>');
 loopTabs.setAttribute('role','tablist');loopTabs.setAttribute('aria-label','Loop Browser view');
 {const tabs=$('aside.browser .browser-tabs');if(tabs)tabs.after(loopTabs);}
 on(loopTabs,'click',event=>{const tab=event.target?.closest?.('[data-sb-loops]')?.dataset.sbLoops;if(!tab)return;const source=$(`aside.browser .browser-tabs [data-browser="${tab}"]`);if(source&&!source.classList.contains('selected'))source.click();paintLoopTabs();});
 function paintLoopTabs(){
  const patterns=!!$('aside.browser .browser-tabs [data-browser="patterns"]')?.classList.contains('selected');
  for(const button of loopTabs.querySelectorAll('[data-sb-loops]')){const selected=(button.dataset.sbLoops==='patterns')===patterns;setClass(button,'selected',selected);if(button.getAttribute('aria-selected')!==String(selected))button.setAttribute('aria-selected',String(selected));}
  const search=$('#browser-search'),placeholder=patterns&&body.classList.contains('logic-show-loops')?'Search Patterns':'Search Loops';if(search&&body.classList.contains('logic-show-loops')&&search.placeholder!==placeholder)search.placeholder=placeholder;
 }

 // ── Master volume (control bar): the saved master output gain
 const master=$('#sb-master-volume');
 function paintMaster(){
  if(!master)return;const values=mixerValues('master');master.disabled=!values.gainKnown;const label=master.closest('label');
  const db=values.gain===null?0:clamp(gainToDb(values.gain),VOLUME_FLOOR_DB,VOLUME_CEIL_DB);if(doc.activeElement!==master)master.value=String(db);
  master.style.setProperty('--sb-fill',`${(Number(master.value)-VOLUME_FLOOR_DB)/(VOLUME_CEIL_DB-VOLUME_FLOOR_DB)*100}%`);
  const text=values.gainKnown?`Master volume ${formatDb(values.gain)} dB`:`Master volume: ${values.gainReason}`;master.title=text;if(label)label.title=text;
 }
 // Heard while it moves (live sweep, never saved); the release is the one saved write and one Undo step.
 let masterBefore=null;
 const masterBegin=()=>{if(masterBefore!==null)return true;const values=mixerValues('master');if(!values.gainKnown)return false;masterBefore=values.gain;liveGesture(true);return true;};
 const masterEnd=()=>{if(masterBefore===null)return;masterBefore=null;liveGesture(false);};
 on(master,'input',()=>{master.style.setProperty('--sb-fill',`${(Number(master.value)-VOLUME_FLOOR_DB)/(VOLUME_CEIL_DB-VOLUME_FLOOR_DB)*100}%`);if(masterBegin())try{api.liveMasterGain?.(dbToGain(Number(master.value)));}catch{}});
 on(master,'change',()=>{if(!masterBegin())return paintMaster();const before=masterBefore;try{safe(()=>api.setMasterGain(before,dbToGain(Number(master.value))))();}finally{masterEnd();}master.blur?.();});
 on(master,'blur',masterEnd);
 /** Track volume pills show their level as a fill, like the master pill. */
 function paintPills(){for(const input of $$('#track-lanes input.sb-pill')){const min=Number(input.min),max=Number(input.max);input.style.setProperty('--sb-fill',`${(Number(input.value)-min)/(max-min)*100}%`);}}
 on($('#track-lanes'),'input',event=>{const input=event.target;if(input?.classList?.contains('sb-pill'))input.style.setProperty('--sb-fill',`${(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100}%`);});

 // ── Editors pane: Region | Notes tabs over the inherited Piano Roll inspector
 const pianoInspector=$('#piano-inspector');
 if(pianoInspector&&!pianoInspector.querySelector('.sb-editor-tabs')){
  const tabs=el('div','sb-seg sb-editor-tabs','<button type="button" role="tab" data-sb-editor-tab="region" aria-selected="false">Region</button><button type="button" role="tab" data-sb-editor-tab="notes" aria-selected="true" class="selected">Notes</button>');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Editor inspector');
  const region=el('section','logic-inspector-group sb-editor-region','<h4>Transpose</h4><div class="sb-transpose" role="group" aria-label="Transpose the selected notes"><button type="button" class="sb-push" data-transpose="-12" title="Down an octave (⌥⇧↓)">−12</button><button type="button" class="sb-push" data-transpose="-1" title="Down a semitone (⌥↓)">−1</button><button type="button" class="sb-push" data-transpose="1" title="Up a semitone (⌥↑)">+1</button><button type="button" class="sb-push" data-transpose="12" title="Up an octave (⌥⇧↑)">+12</button></div><p class="sb-editor-note">Transposes the selected notes (⌘A selects every note in the region).</p>');
  const header=pianoInspector.querySelector('.logic-region-header');(header||pianoInspector.firstElementChild)?.after(tabs);tabs.after(region);
  const setTab=name=>{pianoInspector.dataset.sbTab=name;for(const button of tabs.querySelectorAll('button')){const active=button.dataset.sbEditorTab===name;button.classList.toggle('selected',active);button.setAttribute('aria-selected',String(active));}};
  setTab('notes');
  tabs.addEventListener('click',event=>{const button=event.target?.closest?.('[data-sb-editor-tab]');if(button)setTab(button.dataset.sbEditorTab);});
  region.addEventListener('click',event=>{const button=event.target?.closest?.('[data-transpose]');if(button)safe(()=>api.logicCommand?.('transpose-notes',[button.dataset.transpose]))();});
 }

 // ── Local menu strips (Piano Roll Edit / Functions / View): menu-bar tracking like the main menu bar
 let stripOpener=null;
 const contextMenu=$('#context-menu'),menuVisible=()=>!!contextMenu&&!contextMenu.classList.contains('hidden');
 const stripButton=target=>target?.closest?.('.logic-local-menus button[aria-haspopup="menu"]');
 on(doc,'click',event=>{const button=stripButton(event.target);if(!button)return;if(stripOpener===button&&menuVisible()){event.preventDefault();event.stopImmediatePropagation();contextMenu.classList.add('hidden');return;}stripOpener=button;win.setTimeout?.(paintStrip,0);},true);
 on(doc,'pointerover',event=>{const button=stripButton(event.target);if(!button||!stripOpener||button===stripOpener||!menuVisible()||button.parentElement!==stripOpener.parentElement)return;button.click();},true);
 function paintStrip(){const open=menuVisible();for(const button of $$('.logic-local-menus button[aria-haspopup="menu"]')){const lit=open&&button===stripOpener;button.classList.toggle('menu-open',lit);button.setAttribute('aria-expanded',String(lit));}if(!open)stripOpener=null;}
 if(Observer&&contextMenu){const observer=new Observer(paintStrip);observer.observe(contextMenu,{attributes:true,attributeFilter:['class']});state.disposers.push(()=>observer.disconnect());}

 // ── New Track chooser: track type cards over the inherited New Track form
 function decorateNewTrack(dialog){
  if(!dialog||dialog.dataset.sbDecorated)return;const form=dialog.querySelector('form.lane-create-form'),select=form?.querySelector('select[name="kind"]');if(!form||!select)return;dialog.dataset.sbDecorated='1';dialog.classList.add('sb-sheet','sb-new-track');
  const header=dialog.querySelector('header');if(header?.firstChild?.nodeType===3)header.firstChild.textContent='Choose a track type';
  const cards=el('div','sb-track-cards');cards.setAttribute('role','radiogroup');cards.setAttribute('aria-label','Track type');
  cards.innerHTML=SB_TRACK_TYPES.map(type=>`<button type="button" role="radio" class="sb-track-card" data-card="${type.id}" data-tone="${type.tone}" aria-checked="false"><span class="sb-card-art">${type.icon==='keys'?SB_TRACK_ICONS.keys:SB_ICONS[type.icon]}</span><b>${esc(type.title)}</b>${type.sub?`<small>${esc(type.sub)}</small>`:'<small>&nbsp;</small>'}</button>`).join('');
  const blurb=el('p','sb-track-blurb');form.prepend(cards,blurb);
  const close=form.querySelector('.lane-create-close');if(close)close.textContent='Cancel';
  const submit=form.querySelector('.lane-create-submit');if(submit)submit.textContent='Create';
  let picked=SB_TRACK_TYPES.find(type=>type.kind===select.value)?.id||'guitar';
  const sync=()=>{for(const card of cards.querySelectorAll('[data-card]')){const type=SB_TRACK_TYPES.find(item=>item.id===card.dataset.card),option=type.kind?[...select.options].find(item=>item.value===type.kind):null,disabled=!!(!type.kind||!option||option.disabled||select.disabled);if(card.disabled!==disabled)card.disabled=disabled;card.title=!type.kind?type.reason:option?.disabled?option.title||'Unavailable for this project.':type.text;const active=type.id===picked&&type.kind===select.value;card.classList.toggle('selected',active);card.setAttribute('aria-checked',String(active));}
   const current=SB_TRACK_TYPES.find(type=>type.id===picked);blurb.textContent=current?.text||'';};
  cards.addEventListener('click',event=>{const card=event.target?.closest?.('[data-card]');if(!card||card.disabled)return;const type=SB_TRACK_TYPES.find(item=>item.id===card.dataset.card);if(!type?.kind)return;picked=type.id;select.value=type.kind;select.dispatchEvent(new (win.Event||Event)('input',{bubbles:true}));sync();});
  select.addEventListener('input',()=>{if(SB_TRACK_TYPES.find(type=>type.id===picked)?.kind!==select.value)picked=SB_TRACK_TYPES.find(type=>type.kind===select.value)?.id||picked;sync();});
  // The inherited form enables / disables its own fields as it works; the cards follow (their own changes are ignored).
  if(Observer){const observer=new Observer(records=>{if(records.some(record=>!cards.contains(record.target)))sync();});observer.observe(form,{attributes:true,subtree:true,attributeFilter:['disabled']});dialog.addEventListener('close',()=>observer.disconnect(),{once:true});}
  sync();
 }
 if(Observer){const observer=new Observer(records=>{for(const record of records)for(const node of record.addedNodes){if(node.nodeType!==1)continue;if(node.matches?.('dialog')){win.setTimeout?.(()=>decorateNewTrack(node.classList.contains('lane-create-dialog')?node:null),0);}}placeCountIn();});observer.observe(body,{childList:true});state.disposers.push(()=>observer.disconnect());}

 // ── About
 function about(){return api.dialog('About Street Band',`<div class="sb-about"><div class="sb-about-mark">${SB_MARK}</div><h3>Street Band</h3><p class="sb-about-version">A simple music studio for the Freestyle cloud DAW</p><p>Record, arrange and mix in one window: Library, Tracks, Smart Controls and Editors. All audio is rendered and played by Freestyle in the cloud; this page sends your edits and plays the stream.</p><p class="sb-about-small">Street Band is an independent interface for Freestyle and is not affiliated with any other music application.</p></div>`,{className:'sb-about-dialog'});}

 // ── Commands routed from the key map and the menus
 const commands={
  'toggle-library':()=>toggle('library'),'toggle-smart':()=>toggle('smart'),'toggle-editors':()=>toggle('editors'),'toggle-loops':()=>toggle('loops'),'toggle-browser':()=>toggle('media'),
  'toggle-piano-roll':()=>{if(api.editorVisible()&&$('#piano')&&!$('#piano').classList.contains('hidden')){api.closeEditor();paintPanes();}else openEditor('piano');},
  'toggle-inspector':()=>api.toast('Street Band has no Inspector; the selected track’s settings are in Smart Controls (B).'),
  'toggle-mixer':()=>api.toast('Street Band has no Mixer window; use the track header’s volume and pan, or Smart Controls (B).')
 };
 if(api.hooks){api.hooks.commands=commands;api.hooks.regionMenuLayout=items=>streetBandRegionMenu(items);api.hooks.tracksMenuLayout=items=>streetBandTracksMenu(items);api.hooks.headerMenuLayout=items=>streetBandHeaderMenu(items);
  for(const name of ['afterTracks','mixer','selection']){const previous=api.hooks[name];api.hooks[name]=(...args)=>{let result;try{result=previous?.(...args);}finally{schedule();}return result;};}}
 on(win,'keydown',event=>{
  if(event.defaultPrevented||event.target?.closest?.('input,textarea,select,[contenteditable="true"],dialog'))return;
  if(event.altKey&&event.metaKey&&!event.ctrlKey&&event.code==='KeyP'){event.preventDefault();event.stopPropagation();toggle('notes');}
  else if(event.shiftKey&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&event.key==='?'){event.preventDefault();event.stopPropagation();toggle('help');}
 },true);

 // ── Repaint scheduling: selection, mixer and project changes
 let scheduled=false;
 function refresh(){scheduled=false;paintPanes();paintCatch();paintLoopTabs();paintMaster();paintPills();placeCountIn();if(state.panes.library)paintLibrary();if(state.panes.smart)renderSmart();if(state.panes.notes)loadNotes();}
 function schedule(){if(scheduled)return;scheduled=true;Promise.resolve().then(refresh);}
 if(Observer){
  const lanes=$('#track-lanes');if(lanes){const observer=new Observer(schedule);observer.observe(lanes,{attributes:true,attributeFilter:['class'],subtree:true,childList:true});state.disposers.push(()=>observer.disconnect());}
  // Opening an editor another way (double-click a region, P, the Window menu) takes the bottom pane from Smart Controls.
  let bodyClasses=body.className;
  // Street Band shows neither the Step Sequencer nor a Mixer window. When an inherited path opens one in a real
  // window (a step pattern double-clicked, a "show the Mixer" hint), the Piano Roll opens instead / the Mixer closes.
  const laidOut=()=>doc.documentElement.clientWidth>0;
  const redirect=()=>{if(!laidOut())return;try{const rack=$('#rack');if(body.classList.contains('editors-open')&&rack&&!rack.classList.contains('hidden'))api.openEditor('piano');if(body.classList.contains('mixer-open'))api.closeMixer?.();}catch(error){api.log?.('street-band-redirect',{message:String(error?.message||error).slice(0,160)});}};
  const observer=new Observer(()=>{if(body.className===bodyClasses)return;bodyClasses=body.className;redirect();if(body.classList.contains('editors-open')&&state.panes.smart){state.panes.smart=false;store.set('pane:smart',false);}schedule();});observer.observe(body,{attributes:true,attributeFilter:['class']});state.disposers.push(()=>observer.disconnect());
 }
 try{const off=patchController()?.onChange?.(schedule);if(typeof off==='function')state.disposers.push(off);}catch{}
 on(win,'resize',schedule);

 // First run in a real window: track rows and bars at the reference proportions.
 try{if(doc.documentElement.clientWidth>0&&!store.get('view:init',false)&&api.view){store.set('view:init',true);const tall=(win.innerHeight||0)>=900;api.applyView?.({...api.view(),scale:48,rowHeight:tall?128:96});}}catch{}
 if(state.panes.smart&&api.editorVisible?.())state.panes.smart=false;
 // A narrow window opens on the Tracks area; the Library (an overlay at that width) opens on demand.
 if((win.innerWidth||0)>0&&win.innerWidth<980)state.panes.library=false;
 refresh();

 return{state,toggle,shown,openEditor,showMaster,about,patches:patchController,renderSmart:()=>renderSmart(true),paintLibrary:()=>paintLibrary(true),librarySearch,loadPlugin,decorateNewTrack,
  command(name){const run=commands[name];if(!run)return false;run();return true;},
  destroy(){destroyEq();for(const dispose of state.disposers.splice(0))try{dispose();}catch{}library.remove();smart.remove();notes.remove();help.remove();body.classList.remove('street-band','sb-show-library','sb-show-smart','sb-show-notes','sb-show-help');if(api.hooks){delete api.hooks.commands;delete api.hooks.regionMenuLayout;delete api.hooks.tracksMenuLayout;delete api.hooks.headerMenuLayout;}}};
}
