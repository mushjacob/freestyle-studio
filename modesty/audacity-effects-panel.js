/** Realtime effects side panel.
 *
 * The track's "Effects" button opens a panel docked left of the tracks with that track's effect
 * stack and, below it, the master effects. Every row has a power toggle (bypass), a name button
 * that opens the plug-in's own editor (mirrored from the Freestyle engine), a drag handle / menu
 * to reorder and remove, and an "Add effect" button with the catalog grouped by category.
 *
 * All processing runs in Freestyle: this is a control surface over the public lane / bus plug-in
 * operations (see MixerToolsController). Nothing is processed in the browser.
 */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const identity=plugin=>plugin?.instance_id||plugin?.instanceId||plugin?.id||'';
const POWER='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.5v6M4.3 3.8a5.3 5.3 0 1 0 7.4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const GRIP='<svg viewBox="0 0 8 14" width="8" height="14" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="3" r="1.1"/><circle cx="6" cy="3" r="1.1"/><circle cx="2" cy="7" r="1.1"/><circle cx="6" cy="7" r="1.1"/><circle cx="2" cy="11" r="1.1"/><circle cx="6" cy="11" r="1.1"/></g></svg>';

/** Catalog rows grouped for the Add effect menu: built-in (native) first, then categories A–Z. */
export function groupEffectCatalog(catalog=[]){
 const groups=new Map();
 for(const item of catalog){if(!item||item.kind&&item.kind!=='effect')continue;const name=item.format==='native'?'Built-in':String(item.category||'Other');if(!groups.has(name))groups.set(name,[]);groups.get(name).push(item);}
 return [...groups].map(([name,items])=>({name,items:items.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)))})).sort((a,b)=>(a.name==='Built-in'?-1:b.name==='Built-in'?1:a.name==='Other'?1:b.name==='Other'?-1:a.name.localeCompare(b.name)));
}
/** New chain order after dragging `from` onto `to`. */
export function moveIndex(count,from,to){if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=count||to>=count||from===to)return null;return to;}

export class AudacityEffectsPanel{
 constructor(workspace,{createController,openEditor,openParameters,history=null,onError=()=>{},now=()=>performance.now()}={}){
  Object.assign(this,{w:workspace,createController,openEditor,openParameters,onError,now});
  // Undo / Redo of a removed effect (lane or master) changes the chain outside a panel click: show it.
  history?.addEventListener?.('applied',()=>{if(this.open)this.render();});
  this.open=false;this.track=null;this.sections={track:null,master:null};this.status='';this.timings={};this.generation=0;
 }
 get visible(){return this.open;}
 mount(){
  if(this.el)return this;const host=this.w.root.parentElement;
  this.el=document.createElement('aside');this.el.className='au-effects-panel';this.el.hidden=true;this.el.setAttribute('aria-label','Realtime effects');
  host.insertBefore(this.el,this.w.root);
  this.el.addEventListener('click',event=>this.click(event));
  this.el.addEventListener('dragstart',event=>{const row=event.target.closest?.('.au-fx-row');if(!row)return;this.drag={section:row.dataset.section,index:Number(row.dataset.index)};event.dataTransfer?.setData('text/plain',row.dataset.index);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';row.classList.add('au-fx-dragging');});
  this.el.addEventListener('dragend',()=>{this.drag=null;for(const row of this.el.querySelectorAll('.au-fx-dragging,.au-fx-drop'))row.classList.remove('au-fx-dragging','au-fx-drop');});
  this.el.addEventListener('dragover',event=>{const row=event.target.closest?.('.au-fx-row');if(!row||!this.drag||row.dataset.section!==this.drag.section)return;event.preventDefault();for(const other of this.el.querySelectorAll('.au-fx-drop'))other.classList.remove('au-fx-drop');row.classList.add('au-fx-drop');});
  this.el.addEventListener('drop',event=>{const row=event.target.closest?.('.au-fx-row'),drag=this.drag;if(!row||!drag||row.dataset.section!==drag.section)return;event.preventDefault();this.move(drag.section,drag.index,Number(row.dataset.index));});
  return this;
 }
 destroy(){this.closeMenu();this.el?.remove();this.el=null;this.open=false;this.layout();}
 layout(){const root=this.w.root;if(!root)return;root.classList.toggle('au-with-effects',this.open);this.w.updateScrollGeometry?.();this.w.scheduleWindow?.();this.w.render?.();}
 /** Lane edits carry the instance guard, so the chain is not re-read before every write and only the lane's
  * own plug-in list is re-read after it (the full engine snapshot refresh runs in the background). */
 controller(channel){
  const controller=this.createController(channel);if(controller.target?.kind!=='lane')return controller;
  const full=controller.refresh.bind(controller);let loaded=false;
  controller.refresh=async options=>{if(!loaded){const result=await full(options);loaded=true;return result;}await controller.refreshPlugins();options?.onSlots?.(controller);return controller;};
  controller.ensurePlugin=async plugin=>{const id=identity(plugin),current=(controller.plugins||[]).find(item=>id?identity(item)===id:item.index===plugin.index);if(!current)throw new Error('This plugin slot changed in Freestyle. The list was refreshed; try again.');return current;};
  return controller;
 }
 trackTarget(track){const channel=track?.channel,laneId=track?.laneId||channel?.laneId||channel?.cloudTrackId;return laneId?{id:laneId,laneId,name:track.name}:null;}
 /** Effects button: open on that track, or close when it is already showing it. */
 toggle(track){if(this.open&&track&&this.track&&this.track.laneId===track.laneId)return this.hide();return this.show(track);}
 async show(track=this.w.tracks?.find(item=>item.index===this.w.focusedTrack)??this.w.tracks?.[0]){
  this.mount();const generation=++this.generation,was=this.open;this.open=true;this.el.hidden=false;this.track=track??null;this.status='';
  const target=this.trackTarget(track);
  try{
   this.sections.track=target?{kind:'track',controller:this.controller(target),name:track.name,loading:true}:null;
   if(!this.sections.master||this.sections.master.projectId!==this.projectId())this.sections.master={kind:'master',controller:this.controller({id:'master',kind:'bus',name:'Master'}),name:'Master',loading:true,projectId:this.projectId()};
  }catch(error){this.status=error.message;this.render();if(!was)this.layout();this.onError(error);return this;}
  this.render();if(!was)this.layout();
  const started=this.now();
  await Promise.all(['track','master'].map(async key=>{const section=this.sections[key];if(!section)return;try{if(key==='master'&&section.loaded&&!section.loading)return;await section.controller.refresh({onSlots:()=>{if(generation!==this.generation&&key==='track')return;section.loading=false;section.loaded=true;section.error=null;this.render();}});section.loading=false;section.loaded=true;}catch(error){section.loading=false;section.error=error.message;}}));
  if(generation===this.generation){this.timings.openMs=Math.round(this.now()-started);this.render();}
  return this;
 }
 hide(){if(!this.open)return this;this.generation++;this.open=false;this.closeMenu();if(this.el)this.el.hidden=true;this.layout();return this;}
 projectId(){const p=this.w.getProject?.();return p?.cloud?.projectId||p?.id||'';}
 /** Follow the focused track while the panel is open (as the native panel follows the track whose Effects button was used). */
 sync(){if(!this.open)return;if(this.sections.master&&this.sections.master.projectId!==this.projectId()){this.sections.master=null;this.show();return;}const current=this.track&&this.w.tracks?.find(item=>item.laneId===this.track.laneId);if(this.track&&!current){this.show(this.w.tracks?.[0]);return;}if(current&&current.name!==this.sections.track?.name){this.sections.track.name=current.name;this.render();}}
 section(key){return this.sections[key];}
 busy(){return !!this.running||['track','master'].some(key=>this.sections[key]?.controller?.busy);}
 rowHtml(section,plugin){
  const visual=section.visual,on=!(visual?.bypass&&visual.bypass.id===identity(plugin)?visual.bypass.value:plugin.bypassed),name=esc(plugin.name);
  return `<li class="au-fx-row${on?'':' au-fx-off'}" draggable="true" data-section="${section.kind}" data-index="${plugin.index}" data-instance="${esc(identity(plugin))}"><span class="au-fx-grip" title="Drag to reorder">${GRIP}</span><button type="button" class="au-fx-power" data-fx="power" aria-pressed="${on}" title="${on?'Disable':'Enable'} ${name}" aria-label="${on?'Disable':'Enable'} ${name}">${POWER}</button><button type="button" class="au-fx-name" data-fx="open" title="Open ${name}">${name}</button><button type="button" class="au-fx-more" data-fx="menu" title="Effect options" aria-label="${name} options" aria-haspopup="menu">▾</button></li>`;
 }
 sectionHtml(section,title){
  if(!section)return `<section class="au-fx-section"><h3>${esc(title)}</h3><p class="au-fx-empty">Select an audio track to see its effects.</p></section>`;
  const visual=section.visual;let plugins=(section.controller.plugins||[]).filter(plugin=>!(visual?.removed&&visual.removed===identity(plugin)));if(visual?.order)plugins=visual.order.map(id=>plugins.find(plugin=>identity(plugin)===id)).filter(Boolean);
  const allOff=plugins.length>0&&plugins.every(plugin=>plugin.bypassed),pending=section.pending;
  const rows=plugins.map(plugin=>this.rowHtml(section,plugin)).join('')+(pending?`<li class="au-fx-row au-fx-pending" aria-busy="true"><span class="au-fx-grip"></span><span class="au-fx-power"></span><span class="au-fx-name">${esc(pending)}</span></li>`:'');
  return `<section class="au-fx-section" data-section="${section.kind}"><header><button type="button" class="au-fx-power au-fx-all" data-fx="all" data-section="${section.kind}" aria-pressed="${!allOff}" title="${allOff?'Enable':'Bypass'} all ${esc(title)}"${plugins.length?'':' disabled'}>${POWER}</button><h3 title="${esc(title)}">${esc(title)}</h3></header>${section.error?`<p class="au-fx-error" role="alert">${esc(section.error)} <button type="button" data-fx="retry" data-section="${section.kind}">Retry</button></p>`:''}<ol class="au-fx-list">${rows||(section.loading?'<li class="au-fx-empty" aria-busy="true">Reading effects…</li>':'<li class="au-fx-empty">No effects</li>')}</ol><button type="button" class="au-fx-add" data-fx="add" data-section="${section.kind}" aria-haspopup="menu"${section.loading&&!section.loaded?' disabled':''}>Add effect</button></section>`;
 }
 render(){
  if(!this.el||!this.open)return;
  this.el.innerHTML=`<header class="au-fx-head"><strong>Realtime effects</strong><button type="button" class="au-fx-close" data-fx="close" aria-label="Close effects panel" title="Close">×</button></header><div class="au-fx-body">${this.sectionHtml(this.sections.track,this.track?.name||'Track effects')}${this.sectionHtml(this.sections.master,'Master effects')}</div><footer class="au-fx-status" role="status">${esc(this.status)}</footer>`;
 }
 setStatus(text){this.status=text;const footer=this.el?.querySelector('.au-fx-status');if(footer)footer.textContent=text;}
 async run(section,label,task){
  if(this.running||['track','master'].some(key=>this.sections[key]?.controller?.busy)){section.pending=null;this.render();this.setStatus('Wait for the current effect change to finish.');return null;}
  const started=this.now();this.running=true;this.setStatus(label);
  try{const result=await task();this.timings.lastMs=Math.round(this.now()-started);this.status=section.controller.statusMessage&&/pending|needs/.test(section.controller.statusMessage)?section.controller.statusMessage:'';return result;}
  catch(error){this.status=this.errorText(section,error);this.onError(error);try{await section.controller.refreshPlugins?.();}catch{}return null;}
  finally{this.running=false;section.pending=null;section.visual=null;this.render();}
 }
 errorText(section,error){
  const code=error?.code||error?.result?.error?.code;
  if(section.kind==='master'&&(code==='master_effects_not_supported'||Number(error?.status)===404||code==='not_found'||/Bus not found/i.test(error?.message||'')))return 'This project’s Freestyle engine does not run master effects yet.';
  if(section.kind==='master'&&code==='plugin_not_installed_on_host')return 'This effect is not installed on the project’s audio host, so it cannot go on the master output. Choose another effect.';
  return error?.message||String(error);
 }
 /** #6: the engine says whether a slot has a plug-in window to mirror (hasEditor). Built-in effects answer false and
  *  open their parameter sliders directly (no editor:open). Rows from an older backend fall back to their format. */
 static hasEditor(plugin){
  if(typeof plugin?.hasEditor==='boolean')return plugin.hasEditor;
  if(typeof plugin?.has_editor==='boolean')return plugin.has_editor;
  return String(plugin?.format||'').toLowerCase()!=='native';
 }
 /** Show the result of a click at once; the list is corrected from Freestyle when the write settles (or fails). */
 optimistic(section,visual){section.visual=visual;this.render();}
 plugin(section,row){const index=Number(row.dataset.index),instance=row.dataset.instance;return (section.controller.plugins||[]).find(plugin=>plugin.index===index&&(!instance||identity(plugin)===instance));}
 click(event){
  const button=event.target.closest?.('[data-fx]');if(!button||!this.el.contains(button))return;
  const action=button.dataset.fx,row=button.closest('.au-fx-row'),section=this.sections[row?.dataset.section||button.dataset.section];
  if(action==='close')return this.hide();
  if(!section)return;
  if(action==='retry'){section.error=null;section.loading=true;this.render();section.controller.refresh().then(()=>{section.loading=false;section.loaded=true;},error=>{section.loading=false;section.error=error.message;}).finally(()=>this.render());return;}
  if(action==='add')return this.addMenu(button,section);
  if(action==='all')return this.bypassAll(section);
  const plugin=row&&this.plugin(section,row);if(!plugin)return;
  if(action==='power'){if(this.busy())return this.setStatus('Wait for the current effect change to finish.');this.optimistic(section,{bypass:{id:identity(plugin),value:!plugin.bypassed}});return this.run(section,`${plugin.bypassed?'Enabling':'Disabling'} ${plugin.name}…`,()=>section.controller.bypass(plugin));}
  if(action==='open')return this.openPlugin(section,plugin);
  if(action==='menu')return this.rowMenu(button,section,plugin);
 }
 openPlugin(section,plugin){
  const started=this.now();
  try{
   // A slot without a plug-in window (hasEditor:false: built-in effects) opens its parameters; the engine would
   // answer editor:open with a final 409 editor_not_available. The native EQ keeps its own band editor.
   const type=String(plugin.type_id??plugin.typeId??''),nativeEq=/^native[-_]eq$/i.test(type),windowed=nativeEq||AudacityEffectsPanel.hasEditor(plugin);
   // Master slots: the hosted plug-in's own window would come from the bus editor routes; its parameters open here.
   const done=section.kind==='track'&&this.openEditor&&windowed?this.openEditor(plugin,{laneId:section.controller.target.id,index:plugin.index}):this.openParameters?.(section.kind==='master'?{id:'master',kind:'bus',name:'Master'}:this.trackTarget(this.track),plugin);
   this.timings.lastOpen={kind:section.kind,index:plugin.index,route:section.kind==='track'&&this.openEditor&&windowed?'editor':'parameters'};
   Promise.resolve(done).then(()=>{this.timings.editorMs=Math.round(this.now()-started);},error=>{this.setStatus(error?.message||String(error));this.onError(error);});
  }catch(error){this.setStatus(error.message);this.onError(error);}
 }
 async bypassAll(section){
  const plugins=section.controller.plugins||[];if(!plugins.length)return;const enable=plugins.every(plugin=>plugin.bypassed);
  await this.run(section,enable?'Enabling effects…':'Bypassing effects…',async()=>{for(const plugin of plugins.slice())if(!!plugin.bypassed===enable){const current=(section.controller.plugins||[]).find(item=>identity(item)===identity(plugin))||plugin;await section.controller.bypass(current);}});
 }
 move(sectionKey,from,to){
  const section=this.sections[sectionKey];if(!section)return null;const plugins=section.controller.plugins||[],plugin=plugins.find(item=>item.index===from),target=moveIndex(plugins.length,plugins.findIndex(item=>item.index===from),plugins.findIndex(item=>item.index===to));
  if(!plugin||target===null)return null;if(this.busy()){this.setStatus('Wait for the current effect change to finish.');return null;}{const order=plugins.map(identity),[moved]=order.splice(plugins.indexOf(plugin),1);order.splice(target,0,moved);if(order.every(Boolean))this.optimistic(section,{order});}return this.run(section,`Moving ${plugin.name}…`,()=>section.controller.move(plugin,plugins[target].index));
 }
 add(section,item){if(this.busy()){this.setStatus('Wait for the current effect change to finish.');return null;}section.pending=item.name;this.render();return this.run(section,`Adding ${item.name}…`,()=>section.controller.loadPlugin(item.id));}
 remove(section,plugin){if(this.busy()){this.setStatus('Wait for the current effect change to finish.');return null;}if(identity(plugin))this.optimistic(section,{removed:identity(plugin)});return this.run(section,`Removing ${plugin.name}…`,()=>section.controller.remove(plugin));}
 closeMenu(){this.menuEl?.remove();this.menuEl=null;if(this.menuDismiss){document.removeEventListener('pointerdown',this.menuDismiss,true);document.removeEventListener('keydown',this.menuKey,true);this.menuDismiss=null;}}
 popup(anchor,html,onPick){
  this.closeMenu();const menu=document.createElement('div');menu.className='au-fx-menu';menu.setAttribute('role','menu');menu.innerHTML=html;document.body.append(menu);this.menuEl=menu;
  const rect=anchor.getBoundingClientRect(),place=()=>{const height=menu.offsetHeight||0,width=menu.offsetWidth||0,viewH=window.innerHeight||800,viewW=window.innerWidth||1200;menu.style.left=Math.max(4,Math.min(rect.left,viewW-width-4))+'px';menu.style.top=Math.max(4,rect.bottom+height>viewH-4?Math.max(4,viewH-height-4):rect.bottom)+'px';for(const column of menu.querySelectorAll('.au-fx-groups,.au-fx-items'))column.style.maxHeight=Math.max(120,viewH-10)+'px';};place();
  menu.addEventListener('click',event=>{const item=event.target.closest?.('[data-pick],[data-group]');if(!item||item.disabled)return;if(item.dataset.group!==undefined){for(const other of menu.querySelectorAll('[data-group]'))other.classList.toggle('active',other===item);for(const list of menu.querySelectorAll('[data-items]'))list.hidden=list.dataset.items!==item.dataset.group;place();return;}const value=item.dataset.pick;this.closeMenu();onPick(value);});
  const opened=this.now();menu.addEventListener('pointermove',event=>{const item=event.target.closest?.('[data-group]');if(item&&!item.classList.contains('active')&&this.now()-opened>200)item.click();});
  this.menuDismiss=event=>{if(!menu.contains(event.target)&&event.target!==anchor)this.closeMenu();};this.menuKey=event=>{if(event.key==='Escape'){event.stopPropagation();this.closeMenu();anchor.focus?.();}};
  document.addEventListener('pointerdown',this.menuDismiss,true);document.addEventListener('keydown',this.menuKey,true);
  return menu;
 }
 rowMenu(anchor,section,plugin){
  const plugins=section.controller.plugins||[],position=plugins.findIndex(item=>item.index===plugin.index);
  this.popup(anchor,`<button role="menuitem" data-pick="open">Open…</button><button role="menuitem" data-pick="parameters">Parameters…</button><hr><button role="menuitem" data-pick="up"${position<=0?' disabled':''}>Move up</button><button role="menuitem" data-pick="down"${position<0||position>=plugins.length-1?' disabled':''}>Move down</button><hr><button role="menuitem" data-pick="remove">Remove effect</button>`,pick=>{
   if(pick==='open')this.openPlugin(section,plugin);
   else if(pick==='parameters')this.openParameters?.(section.kind==='master'?{id:'master',kind:'bus',name:'Master'}:this.trackTarget(this.track),plugin);
   else if(pick==='up')this.move(section.kind,plugin.index,plugins[position-1].index);
   else if(pick==='down')this.move(section.kind,plugin.index,plugins[position+1].index);
   else if(pick==='remove')this.remove(section,plugin);
  });
 }
 async addMenu(anchor,section){
  const controller=section.controller;
  if(!controller.catalogLoaded){this.setStatus('Reading the effect catalog…');await controller.ensureCatalog();this.setStatus(controller.catalogError||'');}
  // Buses take hosted (vst3) effects only: the published addBusPlugin refuses built-in ones.
  const groups=groupEffectCatalog(section.kind==='master'?controller.catalog.filter(item=>item.format!=='native'):controller.catalog);
  if(!groups.length){this.setStatus(controller.catalogError||'Freestyle returned no effects for this project.');return null;}
  const html=`<div class="au-fx-groups">${groups.map((group,index)=>`<button type="button" role="menuitem" data-group="${index}" class="${index===0?'active':''}" aria-haspopup="menu">${esc(group.name)}<span aria-hidden="true">▸</span></button>`).join('')}</div>${groups.map((group,index)=>`<div class="au-fx-items" data-items="${index}"${index===0?'':' hidden'}>${group.items.map(item=>`<button type="button" role="menuitem" data-pick="${esc(item.id)}"${item.hostGated?' disabled title="Not installed on the current audio host"':''}>${esc(item.name)}</button>`).join('')}</div>`).join('')}`;
  const menu=this.popup(anchor,html,id=>{const item=controller.catalog.find(row=>row.id===id);if(item)this.add(section,item);});menu.classList.add('au-fx-add-menu');return menu;
 }
}
