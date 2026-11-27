/** FL-style popup menu rendering shared by every context menu.
 *
 * Items are either the legacy tuple `[label, shortcut, run, disabled, title]`,
 * `null` (separator), `MENU_COLUMN` (start the next column, as FL's long
 * channel menu does) or an object
 * `{label, shortcut, run, disabled, title, checked, submenu:[...items]}`.
 * A legacy flat list renders exactly as before (one button per item, in order,
 * `data-action` = index) so existing callers and their tests are unchanged. */
export const MENU_COLUMN=Object.freeze({column:true});

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);

export function menuItem(item){
 if(!item||item===MENU_COLUMN||item.column)return item;
 if(Array.isArray(item))return{label:item[0],shortcut:item[1]??'',run:item[2],disabled:!!item[3],title:item[4]||''};
 return{shortcut:'',title:'',...item,disabled:!!item.disabled};
}

/** The item at a dotted `data-action` path ("3", "12.0"). */
export function menuItemAt(items,path){
 let list=items,item=null;
 for(const part of String(path).split('.')){item=menuItem(list?.[Number(part)]);if(!item)return null;list=item.submenu;}
 return item;
}

function renderList(items,prefix,indices=[...items.keys()]){
 return indices.map(index=>{
  const raw=items[index],item=menuItem(raw);if(!item)return'<hr>';if(item===MENU_COLUMN||item.column)return'';
  const path=prefix+index,checked=typeof item.checked==='boolean',attrs=`${item.disabled?' aria-disabled="true"':''}${item.title?` title="${escapeHtml(item.title)}"`:''}${checked?` role="menuitemcheckbox" aria-checked="${item.checked}"`:''}`;
  const check=checked?`<span class="menu-check" aria-hidden="true">${item.checked?'✓':''}</span>`:'';
  if(Array.isArray(item.submenu))return`<div class="menu-sub"><button type="button" data-submenu="${path}" aria-haspopup="menu" aria-expanded="false"${attrs}>${escapeHtml(item.label)}<small class="menu-arrow">▸</small>${check}</button><div class="context-menu context-submenu" role="menu">${renderList(item.submenu,path+'.')}</div></div>`;
  return`<button data-action="${path}"${attrs}>${escapeHtml(item.label)}<small>${escapeHtml(item.shortcut)}</small>${check}</button>`;
 }).join('');
}

/** HTML for a menu; column markers split it into side-by-side columns. */
export function renderMenuHtml(items){
 const columns=[[]];items.forEach((item,index)=>{if(item===MENU_COLUMN||item?.column)columns.push([]);else columns.at(-1).push(index);});
 if(columns.length===1)return renderList(items,'');
 return`<div class="menu-columns">${columns.map(indices=>`<div class="menu-column">${renderList(items,'',indices)}</div>`).join('')}</div>`;
}

/** Logic opens a hovered submenu after a short delay; a click or → opens it at once. */
export const SUBMENU_HOVER_DELAY_MS=180;
/** The menu level (root or `.context-submenu`) a button belongs to, and that level's own buttons. */
const levelOf=(root,button)=>button.parentElement?.closest('.context-submenu')||root;
const levelItems=(root,level)=>[...level.querySelectorAll('button')].filter(button=>levelOf(root,button)===level);
/** Open or close one submenu; opening closes its siblings, closing closes everything inside it. */
export function setSubmenuOpen(root,sub,state){
 const mark=(node,open)=>{node.classList.toggle('open',open);node.firstElementChild?.setAttribute('aria-expanded',String(open));};
 if(state)for(const button of levelItems(root,levelOf(root,sub.firstElementChild)))if(button.parentElement!==sub&&button.parentElement.classList.contains('open'))setSubmenuOpen(root,button.parentElement,false);
 if(!state)for(const inner of sub.querySelectorAll('.menu-sub.open'))mark(inner,false);
 mark(sub,state);
}
/** Highlight one item of its level (keyboard focus follows when asked). */
function highlight(root,button,{focus=false}={}){
 for(const other of levelItems(root,levelOf(root,button)))other.classList.toggle('menu-active',other===button);
 if(focus)try{button.focus({preventScroll:true});}catch{}
}
function openWithFirst(root,button){
 setSubmenuOpen(root,button.parentElement,true);
 const first=levelItems(root,button.nextElementSibling).find(item=>!item.disabled);if(first)highlight(root,first,{focus:true});
}

/**
 * Logic menu keyboard while a menu is open (the caller swallows every key):
 * ↑/↓ (Home/End) move the highlight over enabled items, → opens the highlighted
 * submenu with its first item, ← closes the innermost submenu, Return/Space
 * activates, Esc closes. `adjacent(±1)` moves to the neighbouring menu-bar
 * menu when ←/→ have nothing to open or close.
 */
export function menuKeyDown(root,event,{close,adjacent}={}){
 let level=root;
 for(;;){const parent=levelItems(root,level).find(button=>button.hasAttribute('data-submenu')&&button.parentElement.classList.contains('open'));if(!parent)break;level=parent.nextElementSibling;}
 const items=levelItems(root,level),enabled=items.filter(button=>!button.disabled),current=items.find(button=>button.classList.contains('menu-active'))||items.find(button=>button===root.ownerDocument?.activeElement)||null;
 const key=event.key;
 if(key==='Escape'){close?.();return;}
 if(['ArrowDown','ArrowUp','Home','End'].includes(key)){
  if(!enabled.length)return;const index=enabled.indexOf(current),down=key==='ArrowDown';
  const next=key==='Home'?enabled[0]:key==='End'?enabled.at(-1):index<0?(down?enabled[0]:enabled.at(-1)):enabled[(index+(down?1:-1)+enabled.length)%enabled.length];
  for(const button of items)if(button!==next&&button.hasAttribute('data-submenu')&&button.parentElement.classList.contains('open'))setSubmenuOpen(root,button.parentElement,false);
  highlight(root,next,{focus:true});return;
 }
 const parent=current&&!current.disabled&&current.hasAttribute('data-submenu')?current:null;
 if(key==='ArrowRight'){if(parent)openWithFirst(root,parent);else adjacent?.(1);return;}
 if(key==='ArrowLeft'){if(level!==root){const owner=level.previousElementSibling;setSubmenuOpen(root,level.parentElement,false);highlight(root,owner,{focus:true});}else adjacent?.(-1);return;}
 if(key==='Enter'||key===' '){if(parent)openWithFirst(root,parent);else if(current&&!current.disabled)current.click();}
}

/** Wire a rendered menu: actions run through `run(item)`; submenus open after a
 * short hover, or at once on click (a click never closes an open submenu). */
export function bindMenu(element,items,{run,close}){
 /* QA r8: Chrome shows no tooltip (and dispatches no hover) on a [disabled] button, so a
    disabled item never said why. Unavailable items are aria-disabled: hoverable (title and
    status hint show the reason) and non-actionable; `.disabled` still reads true for callers. */
 for(const button of element.querySelectorAll('button[aria-disabled="true"]'))if(!Object.hasOwn(button,'disabled'))Object.defineProperty(button,'disabled',{configurable:true,get:()=>button.getAttribute('aria-disabled')==='true',set:value=>{if(value)button.setAttribute('aria-disabled','true');else button.removeAttribute('aria-disabled');}});
 let hoverTimer=null;const later=fn=>{clearTimeout(hoverTimer);hoverTimer=fn?setTimeout(fn,SUBMENU_HOVER_DELAY_MS):null;};
 for(const button of element.querySelectorAll('button[data-submenu]')){const sub=button.parentElement;button.onclick=event=>{event.stopPropagation();later(null);if(!button.disabled){setSubmenuOpen(element,sub,true);highlight(element,button);}};sub.onpointerenter=()=>{if(!button.disabled)later(()=>{if(sub.isConnected)setSubmenuOpen(element,sub,true);});};sub.onpointerleave=()=>{later(null);setSubmenuOpen(element,sub,false);};}
 for(const button of element.querySelectorAll('button[data-action]'))button.onclick=()=>{later(null);const item=menuItemAt(items,button.dataset.action);if(item?.disabled||button.disabled)return;close();if(item&&!item.disabled&&typeof item.run==='function')run(item);};
 element.onpointerover=event=>{const button=event.target?.closest?.('button');if(button&&element.contains(button)&&!button.disabled&&!button.classList.contains('menu-active'))highlight(element,button,{focus:element.contains(element.ownerDocument?.activeElement)});};
}
