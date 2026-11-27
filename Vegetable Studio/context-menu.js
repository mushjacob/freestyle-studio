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
  const path=prefix+index,checked=typeof item.checked==='boolean',attrs=`${item.disabled?' disabled':''}${item.title?` title="${escapeHtml(item.title)}"`:''}${checked?` role="menuitemcheckbox" aria-checked="${item.checked}"`:''}`;
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

/** How an opened submenu must be placed to stay inside the window: the number
 * of columns it needs, how far to lift it, and whether it opens to the left.
 * Pure: `rect` is its box at one column, opened to the right at its natural top. */
export function submenuPlacement(rect,viewport,{margin=4,parentLeft=rect.left}={}){
 const room=Math.max(1,viewport.height-2*margin),columns=Math.max(1,Math.ceil(rect.height/room)),height=columns>1?Math.ceil(rect.height/columns)+28:rect.height,width=rect.width*columns+(columns-1)*3;
 const overflow=rect.top+height-(viewport.height-margin),lift=overflow>0?Math.min(overflow,Math.max(0,rect.top-margin)):0;
 const left=rect.left+width>viewport.width-margin&&parentLeft-width>=margin;
 return{columns,lift,left};
}
/** Keep an opened submenu on screen (no-op without layout, e.g. in tests). */
function fitSubmenu(menu){
 if(!menu||typeof menu.getBoundingClientRect!=='function')return;
 const view=menu.ownerDocument?.defaultView,width=view?.innerWidth,height=view?.innerHeight;if(!(width>0&&height>0))return;
 menu.classList.remove('menu-tall','menu-left');menu.style.columnCount='';menu.style.top='';
 const rect=menu.getBoundingClientRect();if(!(rect.height>0))return;
 const parent=menu.parentElement.getBoundingClientRect(),placement=submenuPlacement(rect,{width,height},{parentLeft:parent.left});
 if(placement.columns>1){menu.classList.add('menu-tall');menu.style.columnCount=String(placement.columns);}
 if(placement.left)menu.classList.add('menu-left');
 const now=menu.getBoundingClientRect(),overflow=now.bottom-(height-4);
 if(overflow>0)menu.style.top=`${-4-Math.min(overflow,Math.max(0,now.top-4))}px`;
}

/** Wire a rendered menu: actions run through `run(item)`; submenus open on
 * hover or click (click/Enter also keeps them open for keyboard and touch). */
export function bindMenu(element,items,{run,close}){
 const open=(sub,state)=>{for(const other of sub.parentElement.querySelectorAll(':scope > .menu-sub.open'))if(other!==sub){other.classList.remove('open');other.firstElementChild.setAttribute('aria-expanded','false');}sub.classList.toggle('open',state);sub.firstElementChild.setAttribute('aria-expanded',String(state));if(state)fitSubmenu(sub.querySelector(':scope > .context-submenu'));};
 for(const button of element.querySelectorAll('button[data-submenu]')){const sub=button.parentElement;button.onclick=event=>{event.stopPropagation();if(!button.disabled)open(sub,!sub.classList.contains('open'));};sub.onpointerenter=()=>{if(!button.disabled)open(sub,true);};sub.onpointerleave=()=>open(sub,false);}
 for(const button of element.querySelectorAll('button[data-action]'))button.onclick=()=>{const item=menuItemAt(items,button.dataset.action);close();if(item&&!item.disabled&&typeof item.run==='function')run(item);};
}
