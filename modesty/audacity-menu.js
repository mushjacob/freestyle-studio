/** Cascading menus for the menu bar, track / clip menus and context menus.
 *
 * items: [label, shortcut, run, disabled, submenu, reason] or null for a separator. `submenu` is an item list (or a function
 * returning one); such a row opens to the side on hover, click or →. `reason` is the tooltip of a disabled row (why it is unavailable). Keyboard: ↑ ↓ Home End move, → opens a submenu,
 * ← / Esc close one level, Enter / Space run; at the top level ← and → ask the opener (the menu bar) for the neighbour.
 * Shortcut text is right-aligned. The root element is the page's existing #context-menu; submenus are its children.
 */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current=null;
export function closeMenu(){const menu=current;if(!menu)return;current=null;menu.close();}
export function menuIsOpen(){return !!current;}

export function openMenu(root,point,items,{onError=()=>{},onEdge=null,onClose=null,focus=true}={}){
 closeMenu();
 const doc=root.ownerDocument,view=doc.defaultView,levels=[];let closed=false;
 const subOf=item=>item&&item[4]?(typeof item[4]==='function'?item[4]():item[4]):null;
 const rowsOf=level=>[...level.el.querySelectorAll(':scope > button')];
 const usable=button=>button&&!button.disabled;
 const place=(el,x,y,{besideLeft=null}={})=>{
  el.style.left='0px';el.style.top='0px';const width=el.offsetWidth||240,height=el.offsetHeight||0,vw=view.innerWidth||1280,vh=view.innerHeight||800;
  let left=x;if(left+width>vw-4)left=besideLeft!==null?Math.max(4,besideLeft-width):Math.max(4,vw-width-4);
  el.style.left=Math.max(4,left)+'px';el.style.top=Math.max(4,Math.min(y,vh-height-8))+'px';el.style.maxHeight=Math.max(120,vh-12)+'px';
 };
 const render=(el,list)=>{el.innerHTML=list.map((item,index)=>item?`<button type="button" role="${!item[4]&&item[1]==='✓'?'menuitemcheckbox" aria-checked="true" data-checked="':'menuitem'}" data-action="${index}" tabindex="-1"${item[3]?' disabled aria-disabled="true"':''}${item[3]&&item[5]?` title="${esc(item[5])}"`:''}${item[4]?' aria-haspopup="menu" aria-expanded="false"':''}><span class="au-menu-label">${esc(item[0])}</span><small>${item[4]?'▸':esc(item[1])}</small></button>`:'<hr role="separator">').join('');};
 const closeFrom=depth=>{while(levels.length>depth){const level=levels.pop();if(level.el!==root)level.el.remove();level.parentButton?.setAttribute('aria-expanded','false');level.parentButton?.classList.remove('au-menu-open');}};
 const highlight=(level,button)=>{for(const row of rowsOf(level))row.classList.toggle('au-menu-active',row===button);level.active=button||null;if(button&&focus)try{button.focus({preventScroll:true});}catch{}};
 const openSub=(level,button,{select=false}={})=>{
  const depth=levels.indexOf(level),item=level.items[Number(button.dataset.action)],list=subOf(item);if(!list)return null;
  if(levels[depth+1]?.parentButton===button){if(select)highlight(levels[depth+1],rowsOf(levels[depth+1]).find(usable));return levels[depth+1];}
  closeFrom(depth+1);
  const el=doc.createElement('div');el.className='context-menu au-submenu';el.setAttribute('role','menu');root.append(el);render(el,list);
  const rect=button.getBoundingClientRect(),parent=level.el.getBoundingClientRect();place(el,parent.right-2,rect.top-4,{besideLeft:parent.left+2});
  const next={el,items:list,parentButton:button,active:null};levels.push(next);button.setAttribute('aria-expanded','true');button.classList.add('au-menu-open');bind(next);
  if(select)highlight(next,rowsOf(next).find(usable));return next;
 };
 const run=(level,button)=>{
  if(!usable(button))return;const item=level.items[Number(button.dataset.action)];if(subOf(item)){openSub(level,button,{select:true});return;}
  close();Promise.resolve().then(()=>item[2]?.()).catch(onError);
 };
 const bind=level=>{
  level.el.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||button.parentElement!==level.el)return;event.stopPropagation();run(level,button);});
  level.el.addEventListener('pointermove',event=>{const button=event.target.closest('button');if(!button||button.parentElement!==level.el||level.active===button)return;const depth=levels.indexOf(level);if(depth<0)return;highlight(level,usable(button)?button:null);if(usable(button)&&button.hasAttribute('aria-haspopup'))openSub(level,button);else closeFrom(depth+1);});
 };
 const move=(level,delta,{edge=null}={})=>{const rows=rowsOf(level).filter(usable);if(!rows.length)return;let index=rows.indexOf(level.active);index=edge==='first'?0:edge==='last'?rows.length-1:index<0?(delta>0?0:rows.length-1):(index+delta+rows.length)%rows.length;highlight(level,rows[index]);};
 const key=event=>{
  if(closed)return;const level=levels.at(-1),name=event.key;
  const handled=()=>{event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();};
  if(name==='Escape'){handled();if(levels.length>1){const parent=level.parentButton;closeFrom(levels.length-1);highlight(levels.at(-1),parent);}else close();return;}
  if(name==='ArrowDown'){handled();move(level,1);return;}
  if(name==='ArrowUp'){handled();move(level,-1);return;}
  if(name==='Home'){handled();move(level,0,{edge:'first'});return;}
  if(name==='End'){handled();move(level,0,{edge:'last'});return;}
  if(name==='ArrowRight'){handled();if(level.active?.hasAttribute('aria-haspopup'))openSub(level,level.active,{select:true});else if(onEdge){onEdge('right');}return;}
  if(name==='ArrowLeft'){handled();if(levels.length>1){const parent=level.parentButton;closeFrom(levels.length-1);highlight(levels.at(-1),parent);}else if(onEdge){onEdge('left');}return;}
  if(name==='Enter'||name===' '){handled();if(level.active)run(level,level.active);return;}
  if(name==='Tab'){handled();close();return;}
  // Typing a letter jumps to the next entry that starts with it.
  if(name.length===1&&!event.metaKey&&!event.ctrlKey&&!event.altKey){const rows=rowsOf(level).filter(usable),start=rows.indexOf(level.active),match=[...rows.slice(start+1),...rows.slice(0,start+1)].find(row=>row.textContent.trim().toLowerCase().startsWith(name.toLowerCase()));handled();if(match)highlight(level,match);}
 };
 const outside=event=>{if(closed||root.contains(event.target)||event.target.closest?.('[data-au-menu]'))return;close();};
 function close(){if(closed)return;closed=true;closeFrom(1);root.classList.add('hidden');root.classList.remove('au-menu-root');doc.removeEventListener('keydown',key,true);doc.removeEventListener('pointerdown',outside,true);if(current===api)current=null;onClose?.();}
 render(root,items);root.setAttribute('role','menu');root.classList.remove('hidden');root.classList.add('au-menu-root');place(root,point.clientX,point.clientY);
 const top={el:root,items,parentButton:null,active:null};levels.push(top);
 // The root element is reused for every menu: its listeners are replaced, not stacked.
 root.onclick=event=>{const button=event.target.closest('button');if(!button||button.parentElement!==root)return;event.stopPropagation();run(top,button);};
 root.onpointermove=event=>{const button=event.target.closest('button');if(!button||button.parentElement!==root||top.active===button)return;highlight(top,usable(button)?button:null);if(usable(button)&&button.hasAttribute('aria-haspopup'))openSub(top,button);else closeFrom(1);};
 doc.addEventListener('keydown',key,true);doc.addEventListener('pointerdown',outside,true);
 const api={close,levels,root,highlightFirst:()=>highlight(top,rowsOf(top).find(usable))};current=api;return api;
}
