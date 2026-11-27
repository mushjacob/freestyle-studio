/**
 * Disabelton device catalog: the Freestyle plug-in catalog (Studio API listPluginCatalog, paged) for the Device
 * View "+" menu and the Browser's Plug-ins, grouped the Live way:
 *  - Audio Effects: Freestyle's native effects (format "native");
 *  - Instruments:   native instruments (Freestyle has none today; the group is kept for parity);
 *  - Plug-ins:      every third-party VST3/AU entry, instruments and effects, as Live lists them.
 *
 * One instance per project and session (window.ablDevices.catalog). It never blocks the UI: `ensure()` starts
 * the first page in the background, `more()` reads the next page on demand (scrolling to the end of the menu,
 * or a search with too few hits while pages remain). Subscribers repaint on every page.
 *
 * readPage({cursor,limit}) → {plugins|data:[...], pagination:{hasMore,nextCursor}} (host hook).
 */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const ABL_CATALOG_GROUPS=Object.freeze(['Instruments','Audio Effects','Plug-ins']);
export const ABL_CATALOG_PAGE_BUDGET=100;
/** A search that needs another catalog page waits this long after the last keystroke. */
export const ABL_MENU_TYPING_DEBOUNCE_MS=150;
/** Live's Browser category for one catalog entry. */
export function ablCatalogGroup(entry){const native=entry?.format==='native';if(!native)return 'Plug-ins';return entry?.kind==='instrument'?'Instruments':'Audio Effects';}
/** Validated, de-duplicated entry or null. installed:false = not on this Freestyle host (shown disabled). */
export function ablCatalogEntry(raw){
 if(!raw||typeof raw.id!=='string'||!raw.id||typeof raw.name!=='string'||!raw.name)return null;
 const kind=raw.kind==='instrument'?'instrument':raw.kind==='effect'?'effect':null;if(!kind)return null;
 const installed=raw.availability?.installed;
 return{id:raw.id,name:raw.name,kind,format:String(raw.format||''),category:typeof raw.category==='string'?raw.category:'',group:ablCatalogGroup({...raw,kind}),checked:raw.availability?.checked===true,installed:installed===true?true:installed===false?false:null,hostGated:installed===false};
}
/** Entries matching `query` (name/category/format words, case-insensitive), grouped in Live order. */
export function ablGroupCatalog(entries,query=''){
 const words=String(query||'').toLowerCase().split(/\s+/).filter(Boolean),hit=entry=>words.every(word=>`${entry.name} ${entry.category} ${entry.format} ${entry.kind}`.toLowerCase().includes(word));
 return ABL_CATALOG_GROUPS.map(group=>({group,entries:entries.filter(entry=>entry.group===group&&hit(entry)).sort((a,b)=>a.name.localeCompare(b.name))})).filter(item=>item.entries.length);
}

export class AblPluginCatalog extends EventTarget{
 constructor({readPage,pageSize=200,scope=''}={}){super();this.readPage=readPage;this.pageSize=pageSize;this.scope=String(scope);this.entries=[];this.ids=new Set();this.cursors=new Set();this.nextCursor=null;this.hasMore=true;this.started=false;this.loading=null;this.error='';this.pages=0;}
 emit(){this.dispatchEvent(new Event('change'));}
 /** Start reading (once per session); returns the in-flight page or the entries already cached. */
 ensure(){if(!this.started)return this.more();return this.loading||Promise.resolve(this.entries);}
 /** Read the next page, if any. Concurrent calls share one request. */
 more(){
  if(this.loading)return this.loading;if(this.started&&!this.hasMore)return Promise.resolve(this.entries);
  if(this.pages>=ABL_CATALOG_PAGE_BUDGET){this.hasMore=false;this.error='The plug-in catalog exceeded its page budget.';this.emit();return Promise.resolve(this.entries);}
  this.started=true;this.error='';const cursor=this.nextCursor;
  this.loading=(async()=>{
   try{
    const data=await this.readPage({cursor,limit:this.pageSize}),rows=data?.data??data?.plugins,pagination=data?.pagination;
    if(!Array.isArray(rows)||typeof pagination?.hasMore!=='boolean')throw new Error('Freestyle returned an incomplete plug-in catalog page.');
    for(const raw of rows){const entry=ablCatalogEntry(raw);if(entry&&!this.ids.has(entry.id)){this.ids.add(entry.id);this.entries.push(entry);}}
    this.pages++;
    if(pagination.hasMore){const next=pagination.nextCursor;if(typeof next!=='string'||!next||next===cursor||this.cursors.has(next))throw new Error('Freestyle returned an invalid or repeated catalog cursor.');this.cursors.add(next);this.nextCursor=next;this.hasMore=true;}
    else{this.nextCursor=null;this.hasMore=false;}
   }catch(error){this.error=String(error?.message||error);this.hasMore=false;}
   finally{this.loading=null;this.emit();}
   return this.entries;
  })();
  this.emit();return this.loading;
 }
 find(id){return this.entries.find(entry=>entry.id===id)||null;}
 groups(query=''){return ablGroupCatalog(this.entries,query);}
}

/**
 * Searchable "+" menu. Shows whatever is cached at once, starts/continues paging in the background, loads the next
 * page when the list is scrolled to its end or a search has fewer than `minHits` hits while pages remain.
 * entryState(entry) → {disabled, title} lets the host refuse entries (not installed, instrument on this track…).
 * Returns {element, close(), repaint()}.
 */
export function openAblDeviceMenu(document,{anchor=null,rect=null,catalog,title='Add Device',entryState=()=>({}),onPick,onClose=null,minHits=8,log=()=>{}}={}){
 const view=document.defaultView;
 for(const old of document.querySelectorAll('.abl-device-menu'))old.__ablClose?.();
 const menu=document.createElement('div');menu.className='abl-device-menu';menu.setAttribute('role','dialog');menu.setAttribute('aria-label',title);
 menu.innerHTML=`<div class="abl-device-menu-title">${esc(title)}</div><input class="abl-device-menu-search" type="search" placeholder="Search (⌘F)" aria-label="Search devices" autocomplete="off"><div class="abl-device-menu-list" role="listbox"></div><div class="abl-device-menu-status" aria-live="polite"></div>`;
 const search=menu.querySelector('input'),list=menu.querySelector('.abl-device-menu-list'),status=menu.querySelector('.abl-device-menu-status');
 const box=rect||anchor?.getBoundingClientRect?.()||null;
 // QA r4: the search <input> is created once and never replaced or re-focused; typing only re-filters the list.
 // A keystroke that leaves the result unchanged (e.g. the Space in "free comp") does not touch the list DOM, and
 // the catalog page a too-short result asks for is debounced while the user is typing (one read after a pause,
 // not one per character), so a fast typist never races a page load and repaint.
 let closed=false,painted='',moreTimer=null,typedAt=-Infinity;const now=()=>view?.performance?.now?.()??Date.now();
 const wantMore=hits=>{
  if(closed||hits>=minHits||!catalog.hasMore||catalog.loading||catalog.error)return;
  const quiet=ABL_MENU_TYPING_DEBOUNCE_MS-(now()-typedAt);if(quiet<=0){catalog.more();return;}
  if(moreTimer===null)moreTimer=(view||globalThis).setTimeout(()=>{moreTimer=null;if(!closed)repaint();},quiet);
 };
 const repaint=()=>{
  if(closed)return;const query=search.value,groups=catalog.groups(query),hits=groups.reduce((sum,item)=>sum+item.entries.length,0);
  const key=JSON.stringify(groups.map(({group,entries})=>[group,entries.map(entry=>{const state=entryState(entry)||{};return[entry.id,!!state.disabled,state.title||''];})]));
  if(key!==painted){painted=key;list.innerHTML=groups.map(({group,entries})=>`<div class="abl-device-menu-group" data-group="${esc(group)}"><div class="abl-device-menu-heading">${esc(group)}</div>${entries.map(entry=>{const state=entryState(entry)||{},disabled=!!(state.disabled||entry.hostGated),why=entry.hostGated?'Not installed on this Freestyle host':state.title||'';return `<button type="button" role="option" class="abl-device-menu-item" data-catalog-id="${esc(entry.id)}" data-kind="${entry.kind}"${disabled?' disabled aria-disabled="true"':''}${why?` title="${esc(why)}"`:''}><span>${esc(entry.name)}</span><small>${esc(entry.group==='Plug-ins'?(entry.kind==='instrument'?'Instrument':entry.category||'Effect'):entry.category&&entry.category!=='Native'?entry.category:'')}</small></button>`;}).join('')}</div>`).join('');}
  const text=catalog.loading?'Loading more…':catalog.error?catalog.error:catalog.hasMore?'Scroll for more':hits?'':catalog.started?'No matching devices':'';
  if(status.textContent!==text)status.textContent=text;
  wantMore(hits);
 };
 const pick=button=>{if(!button||button.disabled)return;const entry=catalog.find(button.dataset.catalogId);if(!entry)return;close();onPick?.(entry);};
 const onChange=()=>repaint();catalog.addEventListener('change',onChange);
 list.addEventListener('click',event=>{event.stopPropagation();pick(event.target.closest?.('.abl-device-menu-item'));});
 list.addEventListener('scroll',()=>{if(catalog.hasMore&&!catalog.loading&&list.scrollTop+list.clientHeight>=list.scrollHeight-24)catalog.more();});
 search.addEventListener('input',()=>{typedAt=now();repaint();});
 search.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();pick(list.querySelector('.abl-device-menu-item:not([disabled])'));}else if(event.key==='ArrowDown'){event.preventDefault();list.querySelector('.abl-device-menu-item:not([disabled])')?.focus();}});
 list.addEventListener('keydown',event=>{const items=[...list.querySelectorAll('.abl-device-menu-item:not([disabled])')],at=items.indexOf(document.activeElement);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();items[Math.max(0,Math.min(items.length-1,at+(event.key==='ArrowDown'?1:-1)))]?.focus();}else if(event.key==='Escape'){event.preventDefault();close();}});
 const outside=event=>{if(!menu.contains(event.target))close();};
 // QA r5: typed in one go, everything from the Space on was lost (paused typing kept it). The field is guarded on
 // three sides: (1) the whole catalog is paged in from the moment the menu opens, so no page read starts mid-word;
 // (2) if anything but the user's own click moves focus out of the open menu, the caret goes straight back to the
 // field (the next key lands there) and the thief is logged; (3) a key a foreign handler consumed is logged.
 const describe=node=>node?node===document.body?'body':`${String(node.tagName||'').toLowerCase()}${node.id?'#'+node.id:''}${typeof node.className==='string'&&node.className?'.'+node.className.trim().split(/\s+/).slice(0,2).join('.'):''}`:'none';
 let userPointer=false;const onPointer=event=>{userPointer=!menu.contains(event.target);};
 search.addEventListener('focusout',event=>{
  if(closed||userPointer||event.relatedTarget&&menu.contains(event.relatedTarget))return;
  (view||globalThis).setTimeout(()=>{if(closed||userPointer)return;const active=document.activeElement;if(active&&menu.contains(active))return;
   log('abl-device-menu-refocus',{stolenBy:describe(active||event.relatedTarget),query:search.value.length});try{search.focus({preventScroll:true});}catch{}},0);
 });
 const consumed=event=>{if(!closed&&event.target===search&&event.defaultPrevented&&!['Escape','Enter','ArrowDown'].includes(event.key))log('abl-device-menu-key-consumed',{key:event.key,code:event.code});};
 const onResize=()=>place();
 function place(){
  if(!box)return;const vw=view?.innerWidth||1024,vh=view?.innerHeight||768,gap=6,want=420,width=menu.offsetWidth||260;
  const below=vh-(box.bottom??box.top??0)-2-gap,above=(box.top??0)-2-gap,up=below<220&&above>below,room=Math.max(120,Math.min(want,up?above:below));
  menu.style.maxHeight=`${Math.round(room)}px`;menu.style.left=`${Math.round(Math.max(gap,Math.min((box.left||0),vw-width-gap)))}px`;
  if(up){menu.style.top='';menu.style.bottom=`${Math.round(vh-(box.top??0)+2)}px`;}else{menu.style.bottom='';menu.style.top=`${Math.round(Math.min((box.bottom??box.top??0)+2,vh-room-gap))}px`;}
  menu.dataset.placement=up?'above':'below';
 }
 function close(){if(closed)return;closed=true;if(moreTimer!==null){(view||globalThis).clearTimeout(moreTimer);moreTimer=null;}catalog.removeEventListener('change',onChange);document.removeEventListener('pointerdown',outside,true);document.removeEventListener('pointerdown',onPointer,true);view?.removeEventListener?.('keydown',consumed);view?.removeEventListener?.('resize',onResize);menu.remove();onClose?.();}
 menu.__ablClose=close;document.body.appendChild(menu);document.addEventListener('pointerdown',outside,true);document.addEventListener('pointerdown',onPointer,true);view?.addEventListener?.('keydown',consumed);view?.addEventListener?.('resize',onResize);place();
 repaint();
 // Page the whole catalog in now (bounded by the catalog's page budget), never one page per keystroke.
 (async()=>{try{await catalog.ensure();while(!closed&&catalog.hasMore&&!catalog.error)await catalog.more();}catch{}})();
 try{search.focus();}catch{}
 return{element:menu,close,repaint};
}
