/** FL Browser "Plugin database": Generators and Effects listed in the Browser; a row is dragged onto the
 *  Channel rack (generator: new channel) or onto a mixer track / insert slot (effect). Double-click adds it
 *  the same way. Display + drag payload only; the caller performs the cloud operation. */
export const PLUGIN_DRAG_TYPE='application/vegetable-plugin';
export function pluginDragPayload(kind,row){
 if(!['generator','effect'].includes(kind)||!row||typeof(row.id??row.path)!=='string'||typeof row.name!=='string')return null;
 return JSON.stringify({kind,id:row.id??row.path,name:row.name});
}
export function parsePluginDrag(text){
 try{const value=JSON.parse(text);if(['generator','effect'].includes(value?.kind)&&typeof value.id==='string'&&value.id&&typeof value.name==='string')return{kind:value.kind,id:value.id,name:value.name};}catch{}
 return null;
}
/** Rows for the two folders, sorted by name; unavailable entries are kept but flagged. */
export function pluginDatabaseRows({instruments=null,effects=null,blockReason=()=>null}={}){
 const byName=(a,b)=>a.name.localeCompare(b.name);
 return{
  generators:Array.isArray(instruments)?instruments.filter(row=>row&&typeof row.name==='string').map(row=>({kind:'generator',id:row.id,name:row.name,category:row.category||'',reason:blockReason(row)})).sort(byName):null,
  effects:Array.isArray(effects)?effects.filter(row=>row&&typeof row.name==='string').map(row=>({kind:'effect',id:row.id??row.path,name:row.name,category:row.category||'',reason:row.hostGated?'This effect needs host access.':null})).sort(byName):null,
 };
}
export function mountPluginDatabase({root,getRows,onOpen=()=>{},onActivate=()=>{},document:doc=root?.ownerDocument||globalThis.document}={}){
 if(!root)return null;
 const box=doc.createElement('details');box.className='plugin-database';
 const build=()=>{
  const rows=getRows(),folder=(title,items)=>`<details class="plugin-database-folder" open><summary>${title}${items?` (${items.length})`:''}</summary>${items?items.map(item=>`<div class="plugin-database-row${item.reason?' unavailable':''}" role="button" tabindex="0" draggable="${item.reason?'false':'true'}" data-plugin-kind="${item.kind}" data-plugin-id="${String(item.id).replace(/"/g,'&quot;')}" title="${(item.reason||(item.kind==='generator'?'Drag onto the Channel rack (or double-click) to add a channel':'Drag onto a mixer track or insert slot (or double-click) to add it to the selected track')).replace(/"/g,'&quot;')}"><span>${item.name.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</span><small>${(item.category||'').replace(/[&<>]/g,'')}</small></div>`).join(''):'<p class="plugin-database-empty">Reading the Freestyle catalog…</p>'}</details>`;
  const open=box.open;box.innerHTML=`<summary>Plugin database</summary>${folder('Generators',rows.generators)}${folder('Effects',rows.effects)}`;box.open=open;
  for(const node of box.querySelectorAll('.plugin-database-row')){
   const find=()=>{const all=getRows(),list=node.dataset.pluginKind==='generator'?all.generators:all.effects;return(list||[]).find(item=>String(item.id)===node.dataset.pluginId)||null;};
   node.addEventListener('dragstart',event=>{const row=find(),payload=row&&!row.reason?pluginDragPayload(row.kind,row):null;if(!payload){event.preventDefault();return;}event.dataTransfer.setData(PLUGIN_DRAG_TYPE,payload);event.dataTransfer.setData('text/plain',row.name);event.dataTransfer.effectAllowed='copy';});
   node.addEventListener('dblclick',()=>{const row=find();if(row&&!row.reason)onActivate(row);});
   node.addEventListener('keydown',event=>{if(event.key==='Enter'){const row=find();if(row&&!row.reason)onActivate(row);}});
  }
 };
 box.addEventListener('toggle',()=>{if(box.open){onOpen();build();}});
 const attach=()=>{if(box.parentElement!==root)root.append(box);};
 build();attach();
 const Observer=doc.defaultView?.MutationObserver||globalThis.MutationObserver;let observer=null;
 if(Observer){observer=new Observer(()=>{if(box.parentElement!==root)attach();});observer.observe(root,{childList:true});}
 return{element:box,refresh:build,destroy(){observer?.disconnect();box.remove();}};
}
/** Accept plug-in drags on `element`; `accepts(kind)` filters, `onDrop(payload,event)` performs it. */
export function acceptPluginDrops(element,{accepts=()=>true,onDrop}={}){
 if(!element)return;
 const has=event=>[...(event.dataTransfer?.types||[])].includes(PLUGIN_DRAG_TYPE);
 element.addEventListener('dragover',event=>{if(!has(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy';element.classList.add('plugin-drop-target');});
 element.addEventListener('dragleave',()=>element.classList.remove('plugin-drop-target'));
 element.addEventListener('drop',event=>{element.classList.remove('plugin-drop-target');if(!has(event))return;const payload=parsePluginDrag(event.dataTransfer.getData(PLUGIN_DRAG_TYPE));if(!payload||!accepts(payload.kind))return;event.preventDefault();event.stopPropagation();onDrop(payload,event);});
}
