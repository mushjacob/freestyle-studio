/** Logic Library (Y): instrument patches for the selected software-instrument track.
 *
 * Transport: the same local `/api/call` route the Freestyle Cloud Engine panel uses
 * (cloud-panel.js cloudCall → studio-api-bridge studioCompatibleRequest). server.py
 * plans `execute_pro_action {action, arguments}` through studio_api_adapter.PRO_ACTIONS,
 * so these reach the published Studio API engine actions (never an invented route):
 *  - search_patches → POST /projects/{id}/engine/actions/search_patches
 *    body {query, plugin?, limit?} (required: query; rate "ai", read). Rows are the
 *    candidates' {name, family, patch_key, pack, category, tags}.
 *  - set_patch → POST /projects/{id}/engine/actions/set_patch
 *    body {track, family, patch_key} copied from one candidate (rate "ai", "Undoable"
 *    engine-side). `track` is the track NAME (as the compose actions address tracks), so a
 *    patch is only loaded on a uniquely named track.
 * cloud-session.js lists both in MCP_ONLY_ACTIONS; that set only steers the legacy
 * interactive route, and under the Studio API the proxy maps them to the REST ops above.
 *
 * Not used: set_labs_preset (refuses every body the schema allows: "Missing patch_key or
 * directory/preset_name", engine request G), load_omnisphere / load_labs (swap the generator, not
 * a patch; load_labs answers persisted:false), set_lane_plugin_program (numeric programs of
 * program-based plug-ins; LABS refuses it), listCatalogPluginPresets (marketplace effect
 * presets, not instrument patches).
 *
 * Undo: Freestyle's own engine history is not used (it would undo whatever is on top of the
 * engine stack). A load is ONE external step in the global history (CloudPatternHistory):
 * Undo = set_patch with the previous patch, Redo = set_patch with the loaded one, each
 * guarded by the saved slot preset (lanes[].pluginChain[].preset) and confirmed by a fresh
 * read. The saved row keeps only the patch NAME, so the previous patch's {family,
 * patch_key} must be resolved first: a patch seen in this page's searches/loads, else one
 * exact-name search. When it stays unknown the load still runs but is labelled not undoable
 * and older history is closed (the project changed outside the journal).
 */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):'';
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const uid=()=>globalThis.crypto?.randomUUID?.()||`patch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fail=(message,code,extra={})=>Object.assign(new Error(message),{code},extra);
const refused=(message,code='instrument_patch_refused')=>fail(message,code,{dispatched:false,historyNotApplied:true});

export const PATCH_ACTIONS=Object.freeze({search:'search_patches',load:'set_patch'});
export const PATCH_SEARCH_LIMIT=25;
/** A catalog read must not carry the cached project ETag (the bridge would add it as If-Match). */
const SEARCH_OPTIONS=Object.freeze({ifMatch:null});
/** Instrument families with a Freestyle patch catalog (search_patches: LABS, Omnisphere, Splice INSTRUMENT, Xpand!2). */
export const PATCH_FAMILIES=Object.freeze(['labs','omnisphere','splice_instrument','xpand']);
export const FAMILY_NAMES=Object.freeze({labs:'LABS',omnisphere:'Omnisphere',splice_instrument:'Splice INSTRUMENT',xpand:'Xpand!2'});
/** Logic Library categories → a search_patches query (searched only when clicked: the action is AI-rated). */
export const PATCH_CATEGORIES=Object.freeze([['Bass','bass'],['Drums & Percussion','drums percussion'],['Guitar','guitar'],['Mallet','mallet bells'],['Orchestral','orchestral strings'],['Piano','piano'],['Electric Piano','electric piano'],['Organ','organ'],['Synthesizer','synth lead'],['Pads','pad'],['Vocal & Choir','choir vocal'],['Textures','texture atmosphere']]);

/** 'labs' | 'omnisphere' | 'splice_instrument' | 'xpand' | null for a plug-in type / candidate family. */
export function patchFamily(value){
 const s=(record(value)?[value.type,value.type_id,value.typeId,value.name,value.displayName,value.family,value.plugin]:[value]).map(text).join(' ').toLowerCase();
 if(!s)return null;
 if(/omnisphere/.test(s))return'omnisphere';if(/splice/.test(s))return'splice_instrument';if(/xpand/.test(s))return'xpand';if(/\blabs\b|spitfire[ _-]?labs|^labs|_labs\b/.test(s))return'labs';return null;
}
/** Same patch: exact (case-insensitive), or the saved short name ("Subdued" for "Intimate Grand Piano - Subdued"). */
export function samePatch(saved,wanted){
 const a=text(saved).toLowerCase(),b=text(wanted).toLowerCase();if(!a||!b)return false;return a===b||b.endsWith(' - '+a);
}
const chainOf=lane=>(Array.isArray(lane?.pluginChain)?lane.pluginChain:[]).filter(record).slice().sort((a,b)=>Number(a.position)-Number(b.position));
/** The saved instrument slot of one lane: {ok, lane, laneId, name, slot, family, preset} or {ok:false, reason}. */
export function laneInstrument(raw,laneId){
 const lanes=(Array.isArray(raw?.lanes)?raw.lanes:[]).filter(lane=>lane?.id===laneId);
 if(!id(laneId)||lanes.length!==1)return{ok:false,reason:'Select a saved track to browse its patches.'};
 const lane=lanes[0],name=text(lane.name);
 if(lane.kind!=='instrument')return{ok:false,lane,laneId,name,reason:`“${name||'This track'}” is not a software instrument track. Select an instrument track to browse patches.`};
 if(!Array.isArray(lane.pluginChain))return{ok:false,lane,laneId,name,reason:'Freestyle has not reported this track’s instrument. Reload the project.'};
 const slots=chainOf(lane).filter(plugin=>patchFamily(plugin));
 if(slots.length!==1){const first=chainOf(lane)[0];return{ok:false,lane,laneId,name,reason:slots.length?'This track has more than one patch instrument. Freestyle cannot tell which one a patch is for.':`${text(first?.name)||text(first?.type)||'This instrument'} has no Freestyle patch catalog (LABS, Omnisphere, Splice INSTRUMENT and Xpand!2 do).`};}
 const slot=slots[0];return{ok:true,lane,laneId,name,slot,family:patchFamily(slot),preset:text(slot.preset)||null,pluginKey:text(slot.pluginKey)||null};
}
/** Candidate rows of a search_patches answer: [{name, family, familyKey, patchKey, pack, category, tags, pick}]. */
export function patchCandidates(answer){
 let rows=null;const queue=[answer];for(let n=0;n<16&&queue.length&&!rows;n++){const value=queue.shift();if(Array.isArray(value)){rows=value;break;}if(!record(value))continue;for(const key of ['candidates','patches','results'])if(Array.isArray(value[key])){rows=value[key];break;}for(const key of ['response','structuredContent','data','result'])if(value[key]!==undefined)queue.push(value[key]);}
 const seen=new Set(),out=[];
 for(const row of Array.isArray(rows)?rows:[]){
  if(!record(row))continue;const name=text(row.name??row.patch_name??row.preset_name??row.preset),family=text(row.family??row.plugin),patchKey=typeof(row.patch_key??row.patchKey)==='string'?(row.patch_key??row.patchKey):'',familyKey=patchFamily(family);
  if(!name||!family||!patchKey||!familyKey||patchKey.length>512||seen.has(familyKey+'\u0000'+patchKey))continue;seen.add(familyKey+'\u0000'+patchKey);
  out.push({name,family,familyKey,patchKey,pack:text(row.pack??row.directory??row.library),category:text(row.category),tags:Array.isArray(row.tags)?row.tags.map(text).filter(Boolean).slice(0,8):[],pick:Number.isInteger(row.pick)?row.pick:null});
 }
 return out;
}

/**
 * options: session() → CloudSession (call / action / rawProject / projectId / trackId);
 * scope() → {projectId}|null; refresh() re-reads the canonical project; prepare() flushes
 * pending edits; editable() → bool; history() → CloudPatternHistory|null; log(event, detail).
 */
export class PatchLibraryController{
 constructor({session,scope,refresh,prepare=null,editable=()=>true,history=()=>null,log=()=>{}}={}){
  if(typeof session!=='function'||typeof scope!=='function'||typeof refresh!=='function')throw new TypeError('PatchLibraryController needs session, scope and refresh.');
  Object.assign(this,{session,scope,refresh,prepare,editable,history,log});this.busy=null;this.searches=new Map();this.identities=new Map();this.listeners=new Set();
 }
 onChange(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 notify(){for(const listener of this.listeners)try{listener();}catch{}}
 context(){const scope=this.scope(),session=this.session();if(!id(scope?.projectId)||!session||session.projectId!==scope.projectId)throw refused('Open a Freestyle project first.','instrument_patch_scope');return{projectId:scope.projectId};}
 assertContext(context){if(this.scope()?.projectId!==context.projectId||this.session()?.projectId!==context.projectId)throw fail('The project changed before the patch was loaded.','instrument_patch_scope',{operationUncertain:true});}
 instrument(laneId){return laneInstrument(this.session()?.rawProject,laneId);}
 rememberAll(projectId,rows){for(const row of rows){const key=`${projectId}|${row.familyKey}|${row.name.toLowerCase()}`,known=this.identities.get(key);this.identities.set(key,known&&known!=='ambiguous'&&known.patchKey!==row.patchKey?'ambiguous':known==='ambiguous'?known:row);}}
 /** One search_patches read (cached per project, family and query for this page). */
 search({laneId,query}={}){
  const q=text(query).slice(0,200);if(!q)return Promise.reject(refused('Type what the patch should sound like.','instrument_patch_query'));
  let context,info;try{context=this.context();info=this.instrument(laneId);}catch(error){return Promise.reject(error);}
  if(!info.ok)return Promise.reject(refused(info.reason,'instrument_patch_target'));
  const key=`${context.projectId}|${info.family}|${q.toLowerCase()}`;if(this.searches.has(key))return this.searches.get(key);
  const pending=(async()=>{
   const session=this.session();
   const answer=await session.call('execute_pro_action',{project_id:context.projectId,...id(session.trackId)?{track_id:session.trackId}:{},action:PATCH_ACTIONS.search,arguments:{query:q,plugin:info.family,limit:PATCH_SEARCH_LIMIT}},SEARCH_OPTIONS);
   this.assertContext(context);const rows=patchCandidates(answer).filter(row=>row.familyKey===info.family);
   this.rememberAll(context.projectId,rows);this.log('patch-search',{family:info.family,query:q,count:rows.length});return rows;
  })();
  this.searches.set(key,pending);pending.catch(()=>this.searches.delete(key));return pending;
 }
 /** {name, family, familyKey, patchKey} of a saved patch name, or null when it cannot be identified exactly. */
 async resolve(context,family,name){
  const saved=text(name);if(!saved)return null;const lower=saved.toLowerCase(),key=`${context.projectId}|${family}|${lower}`;
  const known=this.identities.get(key);if(record(known))return known;if(known==='ambiguous')return null;
  const matches=new Map();const collect=rows=>{for(const row of rows)if(row.familyKey===family&&samePatch(saved,row.name))matches.set(row.patchKey,row);};
  for(const [identityKey,row]of this.identities)if(identityKey.startsWith(`${context.projectId}|${family}|`)&&record(row))collect([row]);
  if(!matches.size)try{const session=this.session();collect(patchCandidates(await session.call('execute_pro_action',{project_id:context.projectId,...id(session.trackId)?{track_id:session.trackId}:{},action:PATCH_ACTIONS.search,arguments:{query:saved,plugin:family,limit:PATCH_SEARCH_LIMIT}},SEARCH_OPTIONS)));this.assertContext(context);}
  catch(error){if(error?.code==='instrument_patch_scope')throw error;this.log('patch-resolve',{family,message:String(error?.message||error).slice(0,160)});return null;}
  return matches.size===1?[...matches.values()][0]:null;
 }
 /** The track argument of set_patch: the lane's name, only when no other track has it. */
 trackRef(info){
  const name=text(info.lane?.name),lanes=Array.isArray(this.session()?.rawProject?.lanes)?this.session().rawProject.lanes:[];
  if(!name)throw refused('Name this track first: Freestyle addresses patches by track name.','instrument_patch_track');
  const same=lanes.filter(lane=>text(lane?.name).toLowerCase()===name.toLowerCase()).length;
  if(same!==1)throw refused(`Rename one of the ${same} tracks named “${name}”: Freestyle addresses patches by track name.`,'instrument_patch_track');
  return name;
 }
 /** One set_patch (never resent), then a fresh read must show the patch in the instrument slot. */
 async write(context,laneId,patch){
  const before=this.instrument(laneId);if(!before.ok)throw refused(before.reason,'instrument_patch_target');
  if(before.family!==patch.familyKey)throw refused(`“${patch.name}” is a ${FAMILY_NAMES[patch.familyKey]||patch.family} patch; this track plays ${FAMILY_NAMES[before.family]}.`,'instrument_patch_family');
  const track=this.trackRef(before),session=this.session();let receipt;
  try{receipt=await session.action(PATCH_ACTIONS.load,{track,family:patch.family,patch_key:patch.patchKey},{refresh:false,idempotencyKey:uid(),expectedContext:{projectId:context.projectId,trackId:session.trackId,contextVersion:session.contextVersion||0}});}
  // An explicit 4xx refusal wrote nothing; anything else after dispatch is uncertain and never resent.
  catch(error){const status=Number(error?.status);if(error?.operationUncertain!==true&&(error?.dispatched===false||Number.isInteger(status)&&status>=400&&status<500&&status!==408))error.historyNotApplied=true;else error.operationUncertain=true;throw error;}
  this.assertContext(context);
  try{await this.refresh();}catch(error){throw Object.assign(error,{operationUncertain:true});}
  this.assertContext(context);const after=this.instrument(laneId);
  if(!after.ok||!samePatch(after.preset,patch.name))throw fail(`Freestyle acknowledged “${patch.name}”, but the saved track shows ${after.ok&&after.preset?`“${after.preset}”`:'another patch'}. Inspect the track before loading again.`,'instrument_patch_unconfirmed',{operationUncertain:true,receipt});
  this.identities.set(`${context.projectId}|${patch.familyKey}|${patch.name.toLowerCase()}`,patch);
  return{preset:after.preset,receipt};
 }
 /** Load one candidate on a lane. One undo step when the previous patch can be identified. */
 async load({laneId,patch}={}){
  if(this.busy)throw refused('Wait for the current patch to load.','instrument_patch_busy');
  if(!record(patch)||!text(patch.name)||!text(patch.patchKey)||!patchFamily(patch.familyKey||patch.family))throw refused('Choose a patch Freestyle listed for this instrument.','instrument_patch_choice');
  patch={...patch,familyKey:patchFamily(patch.familyKey||patch.family)};
  const context=this.context();if(!this.editable())throw refused('Finish the current edit before loading a patch.','instrument_patch_busy');
  this.busy={laneId,name:patch.name};this.notify();let token=null,history=null,sent=false;
  try{
   await this.prepare?.();this.assertContext(context);
   const info=this.instrument(laneId);if(!info.ok)throw refused(info.reason,'instrument_patch_target');
   if(info.family!==patch.familyKey)throw refused(`“${patch.name}” is a ${FAMILY_NAMES[patch.familyKey]} patch; this track plays ${FAMILY_NAMES[info.family]}.`,'instrument_patch_family');
   this.trackRef(info);
   if(samePatch(info.preset,patch.name))return{changed:false,preset:info.preset};
   const previous=info.preset?await this.resolve(context,info.family,info.preset):null;this.assertContext(context);
   history=this.history();
   if(previous&&history?.beginExternalStep){try{token=history.beginExternalStep({kind:'instrument_patch',label:'Load Patch'});}catch(error){throw Object.assign(error,{dispatched:false});}}
   sent=true;const result=await this.write(context,laneId,patch);
   const trackName=info.name||'track',label=`Load Patch “${patch.name}”`,detail={laneId,family:info.family,before:info.preset,after:result.preset};
   let journaled=false;
   if(token){
    const step=(from,to)=>async()=>{
     const now=this.context();if(now.projectId!==context.projectId)throw refused('Reopen the project to use its patch history.','instrument_patch_scope');
     await this.prepare?.();await this.refresh();this.assertContext(now);
     const current=this.instrument(laneId);
     if(!current.ok||!samePatch(current.preset,from.name))throw refused(`The patch on “${trackName}” changed after this step${current.ok&&current.preset?` (now “${current.preset}”)`:''}. History will not overwrite it.`,'instrument_patch_changed');
     const done=await this.write(now,laneId,to);this.notify();return{laneId,patch:done.preset};
    };
    journaled=history.finishExternalStep(token,{label,detail,undo:step(patch,previous),redo:step(previous,patch)})===true;token=null;
   }else if(history?.invalidate){
    history.invalidate(`Loaded patch “${patch.name}” on “${trackName}”: Freestyle cannot identify the previous patch${info.preset?` “${info.preset}”`:''}, so this is not undoable. Older steps are unavailable.`,{code:'instrument_patch_not_undoable'});
   }
   this.log('patch-load',{laneId,family:info.family,before:info.preset,after:result.preset,undoable:!!previous,journaled});
   return{changed:true,before:info.preset,after:result.preset,undoable:!!previous,journaled,label,trackName};
  }catch(error){
   if(token)try{history.failExternalStep(token,error);}catch{}
   if(!sent&&error.dispatched===undefined)error.dispatched=false;
   throw error;
  }finally{this.busy=null;this.notify();}
 }
}

/** Status line for a finished load. */
export function patchLoadMessage(result){
 if(!result?.changed)return`“${result?.preset||'This patch'}” is already loaded.`;
 return result.undoable?`Loaded “${result.after}” on “${result.trackName}”.`:`Loaded “${result.after}” on “${result.trackName}”. Not undoable: Freestyle cannot identify the previous patch${result.before?` “${result.before}”`:''}.`;
}

/** Library pane markup (pure; tests render it without a DOM). */
export function patchLibraryHtml({info=null,results=null,query='',category=null,searching=false,busy=null,error=null}={}){
 const head=info?.ok?`<div class="lpl-head"><b class="lpl-track" title="${esc(info.name)}">${esc(info.name||'Track')}</b><span class="lpl-current" title="Loaded patch">${esc(FAMILY_NAMES[info.family])}${info.preset?` · ${esc(info.preset)}`:''}</span></div>`:`<div class="lpl-head"><b class="lpl-track">Library</b></div>`;
 if(!info?.ok)return`${head}<p class="lpl-empty" role="status">${esc(info?.reason||'Select a software instrument track to browse its patches.')}</p>`;
 const categories=PATCH_CATEGORIES.map(([label,q])=>`<button type="button" class="lpl-category${category===q?' selected':''}" data-patch-category="${esc(q)}" aria-pressed="${category===q}"${busy?' disabled':''}>${esc(label)}<span aria-hidden="true">›</span></button>`).join('');
 let list;
 if(searching)list=`<p class="lpl-empty" role="status">Searching ${esc(FAMILY_NAMES[info.family])} patches…</p>`;
 else if(error)list=`<p class="lpl-empty lpl-error" role="alert">${esc(error)}</p>`;
 else if(!results)list=`<p class="lpl-empty">Choose a category or search. Freestyle searches its ${esc(FAMILY_NAMES[info.family])} catalog when you ask (each search uses Freestyle AI quota).</p>`;
 else if(!results.length)list=`<p class="lpl-empty" role="status">No ${esc(FAMILY_NAMES[info.family])} patches found.</p>`;
 else list=`<div class="lpl-patches" role="listbox" aria-label="Patches">${results.map((row,index)=>{const current=samePatch(info.preset,row.name),loading=busy&&busy.name===row.name;return`<button type="button" class="lpl-patch${current?' current':''}${loading?' loading':''}" role="option" aria-selected="${current}" data-patch-index="${index}" title="${esc([row.pack,row.category,row.tags.join(', ')].filter(Boolean).join(' · ')||row.name)}"${busy?' disabled':''}><span class="lpl-patch-name">${esc(row.name)}</span>${row.pack?`<small>${esc(row.pack)}</small>`:''}</button>`;}).join('')}</div>`;
 return`${head}<form class="lpl-search" role="search"><input type="search" name="q" value="${esc(query)}" placeholder="Search ${esc(FAMILY_NAMES[info.family])} patches" aria-label="Search patches" autocomplete="off"${busy?' disabled':''}></form><div class="lpl-columns"><div class="lpl-categories" aria-label="Categories">${categories}</div>${list}</div>${busy?`<p class="lpl-status" role="status">Loading “${esc(busy.name)}”…</p>`:''}`;
}

/**
 * Mounts the patch library in the Library pane (aside.browser while body.logic-show-library).
 * options: document, controller, selectedLaneId() → laneId|null, toast(text), fail(error).
 */
export function installPatchLibrary({document:doc=globalThis.document,controller,selectedLaneId,toast=()=>{},fail=()=>{}}={}){
 if(!doc||!controller||typeof selectedLaneId!=='function')throw new TypeError('installPatchLibrary needs document, controller and selectedLaneId.');
 if(!doc.querySelector('link[data-logic-patch-library]')&&doc.head){const link=doc.createElement('link');link.rel='stylesheet';link.href='logic-patch-library.css';link.dataset.logicPatchLibrary='';doc.head.append(link);}
 const aside=doc.querySelector('aside.browser');let host=doc.getElementById('logic-patch-library');
 if(!host){host=doc.createElement('section');host.id='logic-patch-library';host.className='logic-patch-library';host.setAttribute('aria-label','Patch Library');const heading=aside?.querySelector(':scope>.panel-heading');if(heading)heading.after(host);else(aside||doc.body).append(host);}
 const view={laneId:null,query:'',category:null,results:null,searching:false,error:null,searchSeq:0};let painted='',scheduled=false;
 const open=()=>doc.body?.classList.contains('logic-show-library');
 function paint(force=false){
  scheduled=false;if(!open()&&!force)return;
  let laneId=null;try{laneId=selectedLaneId();}catch{}
  const info=controller.instrument(laneId),family=info.ok?info.family:null;
  // Results stay while the selected tracks play the same instrument (Logic keeps the Library's place).
  if(family!==view.family){view.results=null;view.error=null;view.category=null;view.searching=false;view.searchSeq++;}
  view.laneId=laneId;view.family=family;
  const html=patchLibraryHtml({info,results:view.results,query:view.query,category:view.category,searching:view.searching,busy:controller.busy,error:view.error});
  if(html===painted&&!force)return;const focused=doc.activeElement&&host.contains(doc.activeElement)?doc.activeElement.name==='q'?'q':doc.activeElement.dataset?.patchIndex??null:null;
  host.innerHTML=html;painted=html;
  if(focused==='q')host.querySelector('input[name="q"]')?.focus();else if(focused!=null)host.querySelector(`[data-patch-index="${focused}"]`)?.focus();
 }
 const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>paint());};
 async function runSearch(query,category=null){
  const laneId=view.laneId,seq=++view.searchSeq;view.query=category?view.query:query;view.category=category;view.searching=true;view.error=null;paint(true);
  try{const rows=await controller.search({laneId,query});if(seq!==view.searchSeq)return;view.results=rows;}
  catch(error){if(seq!==view.searchSeq)return;view.results=null;view.error=error?.message||'Freestyle could not search its patches.';}
  finally{if(seq===view.searchSeq){view.searching=false;paint(true);}}
 }
 async function load(index){
  const row=view.results?.[index];if(!row)return;
  try{const result=await controller.load({laneId:view.laneId,patch:row});toast(patchLoadMessage(result));}catch(error){fail(error);}finally{paint(true);}
 }
 host.addEventListener('submit',event=>{event.preventDefault();const q=text(host.querySelector('input[name="q"]')?.value);if(q)runSearch(q);});
 host.addEventListener('click',event=>{const target=event.target?.closest?.('button');if(!target||target.disabled||!host.contains(target))return;if(target.dataset.patchCategory)runSearch(target.dataset.patchCategory,target.dataset.patchCategory);else if(target.dataset.patchIndex!=null)load(Number(target.dataset.patchIndex));});
 // Typing in the search field must not reach the Tracks-area key commands (Space, Y, T, …).
 host.addEventListener('keydown',event=>{
  if(event.target?.name==='q'){if(event.key!=='Escape')event.stopPropagation();return;}
  const option=event.target?.closest?.('[data-patch-index]');if(!option||!['ArrowDown','ArrowUp'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();const next=host.querySelector(`[data-patch-index="${Number(option.dataset.patchIndex)+(event.key==='ArrowDown'?1:-1)}"]`);next?.focus();
 });
 host.addEventListener('input',event=>{if(event.target?.name==='q')view.query=event.target.value;});
 const Observer=doc.defaultView?.MutationObserver||globalThis.MutationObserver,observers=[];
 if(Observer){const body=new Observer(schedule);body.observe(doc.body,{attributes:true,attributeFilter:['class']});observers.push(body);const lanes=doc.getElementById('track-lanes');if(lanes){const tracks=new Observer(schedule);tracks.observe(lanes,{attributes:true,attributeFilter:['class'],subtree:true,childList:true});observers.push(tracks);}}
 const off=controller.onChange(schedule);
 paint();
 return{host,view,paint:()=>paint(true),search:runSearch,load,destroy(){off();for(const observer of observers)observer.disconnect();host.remove();}};
}
