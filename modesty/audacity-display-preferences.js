import {AMPLITUDE_DB_RANGES} from './audacity-amplitude.js';

// Pinned Audacity 3.2.1 global preferences: TracksPrefs.cpp, GUIPrefs.cpp
// and ViewMenus.cpp. The global Waveforms page is disabled in that release;
// only the supported Interface and Tracks controls are presented here.
// https://github.com/audacity/audacity/blob/969e36f4968e66375a794a938dd906a3556e0bbc/src/prefs/TracksPrefs.cpp
// https://github.com/audacity/audacity/blob/969e36f4968e66375a794a938dd906a3556e0bbc/src/prefs/GUIPrefs.cpp
// https://github.com/audacity/audacity/blob/969e36f4968e66375a794a938dd906a3556e0bbc/src/menus/ViewMenus.cpp
// PrefsDialog has OK/Cancel, optional Preview and category Help. Interface and
// Tracks inherit PrefsPanel::ShowsPreviewButton()==false; there is no Apply.
// https://github.com/audacity/audacity/blob/969e36f4968e66375a794a938dd906a3556e0bbc/src/prefs/PrefsDialog.cpp
export const DISPLAY_PREFERENCES_HELP_PAGES=Object.freeze({interface:'https://manual.audacityteam.org/man/interface_preferences.html',tracks:'https://manual.audacityteam.org/man/tracks_preferences.html'});
export const DISPLAY_PREFERENCES_KEY='modesty:display-preferences';
export const DEFAULT_DISPLAY_PREFERENCES=Object.freeze({showClipping:false,advancedVerticalZoom:false,defaultScale:'linear',defaultDbRange:60});
export const DISPLAY_DB_RANGE_CHOICES=Object.freeze([
 [36,'-36 dB (shallow range for high-amplitude editing)'],[48,'-48 dB (PCM range of 8 bit samples)'],[60,'-60 dB (PCM range of 10 bit samples)'],[72,'-72 dB (PCM range of 12 bit samples)'],[84,'-84 dB (PCM range of 14 bit samples)'],[96,'-96 dB (PCM range of 16 bit samples)'],[120,'-120 dB (approximate limit of human hearing)'],[145,'-145 dB (PCM range of 24 bit samples)'],
].map(choice=>Object.freeze(choice)));
const fields=Object.keys(DEFAULT_DISPLAY_PREFERENCES),editable=['defaultScale','defaultDbRange'];
const valid=(key,value)=>key==='showClipping'||key==='advancedVerticalZoom'?typeof value==='boolean':key==='defaultScale'?['linear','db'].includes(value):key==='defaultDbRange'&&typeof value==='number'&&AMPLITUDE_DB_RANGES.includes(value);
const same=(a,b)=>fields.every(key=>a[key]===b[key]);
const sectionId=section=>{if(section==='waveforms')return 'tracks';if(['tracks','interface'].includes(section))return section;throw new RangeError('Choose Interface or Tracks display preferences.');};
const read=(storage,key)=>{try{const data=JSON.parse(storage?.getItem(key)??'null');return data&&typeof data==='object'&&!Array.isArray(data)?data:null;}catch{return null;}};
const storageFor=w=>{try{return w.root?.ownerDocument?.defaultView?.localStorage??globalThis.localStorage;}catch{return null;}};
function stylesheet(doc){if(doc.querySelector('link[data-au-display-preferences]'))return;const link=doc.createElement('link');link.rel='stylesheet';link.href=new URL('./audacity-display-preferences.css',import.meta.url).href;link.dataset.auDisplayPreferences='true';doc.head.append(link);}

/** Browser presentation preferences only. No projects, audio or cloud tools
 * are read or changed. Returned snapshots cannot mutate stored settings. */
export class AudacityDisplayPreferences {
 constructor(workspace,{onChange=()=>{},storage}={}){
  this.w=workspace;this.onChange=onChange;this.listeners=new Set();this.storage=storage===undefined?storageFor(workspace):storage;this.dialog=null;
  const saved=read(this.storage,DISPLAY_PREFERENCES_KEY),next={...DEFAULT_DISPLAY_PREFERENCES};for(const key of fields)if(valid(key,saved?.[key]))next[key]=saved[key];
  const legacy=read(this.storage,'modesty:amplitude'),migrate=!Object.hasOwn(saved??{},'advancedVerticalZoom')&&typeof legacy?.advanced==='boolean';if(migrate)next.advancedVerticalZoom=legacy.advanced;
  this.value=Object.freeze(next);if(migrate)this.persist();
 }
 get(){return {...this.value};}
 persist(){try{this.storage?.setItem(DISPLAY_PREFERENCES_KEY,JSON.stringify(this.value));}catch{/* Keep browser-session preferences when storage is unavailable. */}}
 set(patch={}){
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!fields.includes(key)||!valid(key,patch[key])))throw new TypeError('Choose valid waveform display preferences.');
  const previous=this.get(),next={...previous,...patch};if(same(previous,next))return this.get();this.value=Object.freeze(next);this.persist();
  for(const listener of [this.onChange,...this.listeners]){try{listener(this.get(),{...previous});}catch(error){this.w.onError?.(error);}}
  return this.get();
 }
 subscribe(listener){if(typeof listener!=='function')throw new TypeError('A display preference subscriber must be a function.');this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 open(section='waveforms'){
  section=sectionId(section);if(this.dialog?.isConnected){this.selectSection(section);return this.dialog;}
  const doc=this.w.root?.ownerDocument??globalThis.document,previousFocus=doc.activeElement;stylesheet(doc);
  const d=this.w.dialog('Preferences',`<form class="au-display-preferences-form"><p class="au-display-preferences-scope">Display preferences available in this browser.</p><div class="au-display-preferences-main"><nav class="au-display-preferences-tree" role="tree" aria-label="Preference categories"><button type="button" role="treeitem" aria-level="1" data-preference-section="interface" aria-controls="au-preferences-interface">Interface</button><button type="button" role="treeitem" aria-level="1" data-preference-section="tracks" aria-controls="au-preferences-tracks">Tracks</button></nav><section id="au-preferences-interface" class="au-display-preferences-panel" aria-labelledby="au-preferences-interface-title"><h2 id="au-preferences-interface-title">Interface</h2><fieldset><legend>Display</legend><label for="au-preferences-db-range">Meter dB range:</label><select id="au-preferences-db-range" name="defaultDbRange">${DISPLAY_DB_RANGE_CHOICES.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select><p>Used by meters and dB waveform displays.</p></fieldset></section><section id="au-preferences-tracks" class="au-display-preferences-panel" aria-labelledby="au-preferences-tracks-title"><h2 id="au-preferences-tracks-title">Tracks</h2><fieldset><legend>Display</legend><label for="au-preferences-scale">Default Waveform scale:</label><select id="au-preferences-scale" name="defaultScale"><option value="linear">Linear</option><option value="db">Logarithmic (dB)</option></select></fieldset></section></div><p class="au-display-preferences-status" role="status" aria-live="polite"></p><footer><button type="button" class="au-display-preferences-help">Help</button><button type="button" class="au-display-preferences-cancel">Cancel</button><button type="submit" class="au-display-preferences-ok primary">OK</button></footer></form>`);
  this.dialog=d;d.classList.add('au-display-preferences-dialog');this.draft=this.get();this.dirty=new Set();
  const form=d.querySelector('form'),status=d.querySelector('.au-display-preferences-status');
  const sync=()=>{for(const key of editable)d.querySelector(`[name=${key}]`).value=String(this.draft[key]);};
  const unsubscribe=this.subscribe(next=>{for(const key of editable)if(!this.dirty.has(key))this.draft[key]=next[key];sync();});
  for(const key of editable)d.querySelector(`[name=${key}]`).onchange=event=>{this.draft[key]=key==='defaultDbRange'?Number(event.target.value):event.target.value;if(this.draft[key]===this.get()[key])this.dirty.delete(key);else this.dirty.add(key);status.textContent='';sync();};
  const commit=()=>{try{const patch=Object.fromEntries([...this.dirty].map(key=>[key,this.draft[key]]));this.set(patch);this.draft=this.get();this.dirty.clear();sync();return true;}catch(error){status.textContent=error.message;return false;}};
  form.onsubmit=event=>{event.preventDefault();if(commit())d.close('ok');};d.querySelector('.au-display-preferences-cancel').onclick=()=>d.close('cancel');
  d.querySelector('.au-display-preferences-help').onclick=()=>doc.defaultView.open(DISPLAY_PREFERENCES_HELP_PAGES[this.section],'_blank','noopener,noreferrer');
  for(const button of d.querySelectorAll('[data-preference-section]'))button.onclick=()=>this.selectSection(button.dataset.preferenceSection);
  d.querySelector('[role=tree]').onkeydown=event=>{const buttons=[...d.querySelectorAll('[data-preference-section]')],index=buttons.findIndex(button=>button.dataset.preferenceSection===this.section);let next;if(event.key==='ArrowDown')next=Math.min(buttons.length-1,index+1);else if(event.key==='ArrowUp')next=Math.max(0,index-1);else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;event.preventDefault();event.stopPropagation();this.selectSection(buttons[next].dataset.preferenceSection);};
  const cancel=event=>{event.preventDefault();d.close('cancel');};d.addEventListener('cancel',cancel);
  d.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();d.close('cancel');return;}if(event.key!=='Tab')return;const focusable=[...d.querySelectorAll('button,input,select,[tabindex]')].filter(element=>!element.disabled&&element.tabIndex>=0&&!element.closest('[hidden]'));if(!focusable.length)return;const index=focusable.indexOf(doc.activeElement);if(event.shiftKey&&(index<=0)){event.preventDefault();focusable.at(-1).focus();}else if(!event.shiftKey&&(index===focusable.length-1||index<0)){event.preventDefault();focusable[0].focus();}});
  d.addEventListener('close',()=>{unsubscribe();if(this.dialog===d){this.dialog=null;this.draft=null;this.dirty=null;}if(previousFocus?.isConnected)previousFocus.focus?.();},{once:true});
  sync();this.selectSection(section);return d;
 }
 selectSection(section){
  section=sectionId(section);const d=this.dialog;if(!d?.isConnected)return;this.section=section;for(const button of d.querySelectorAll('[data-preference-section]')){const selected=button.dataset.preferenceSection===section;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
  for(const panel of d.querySelectorAll('.au-display-preferences-panel'))panel.hidden=panel.id!==`au-preferences-${section}`;d.querySelector(`[data-preference-section=${section}]`).focus();
 }
}
