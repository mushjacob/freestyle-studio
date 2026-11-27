import {definiteCloudRejection,isIdempotencyInProgress} from './cloud-errors.js';
import {bridgeFetch,freestyleOrigin} from './freestyle-host-transport.js';
/** Compact Freestyle Sound Library browser. All rows and mutations come from live tools. */
// Keep cursor pages small and user-paged; preserve every returned row and handle.
const PAGE_SIZE=10;
const VIEWS=new Set(['sounds','packs','patterns','audio','kits','plugins','effects']);
const ASSET_TYPES={packs:'sound_pack',patterns:'pattern',kits:'beat_kit',plugins:'plugin',effects:'audio_effect'};
const list=value=>Array.isArray(value)?value:[];
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;return n;};
const button=(text,title,handler,className='')=>{const b=node('button',text,className);b.type='button';b.title=title;b.addEventListener('click',handler);return b;};
const number=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const REGISTRATION_PENDING=new Set(['prepared','sending','uncertain','acknowledged']);
const registrationIdentity=(item,handle)=>JSON.stringify([item.id,Object.entries(handle).sort(([a],[b])=>a.localeCompare(b))]);
const REGISTER_IDENTITIES=new Set(['track_id','audio_file_id','preset_pack_item_id','sound_pack_item_id','catalog_sound_id']);
const blockedReason=item=>typeof item?.canAddReason==='string'&&item.canAddReason.trim()?item.canAddReason:'This sound cannot be added to the sample pool.';
/** Catalog register handles are API bodies, not descriptions to reconstruct.
 * Only the published one-of identity plus an explicit optional name is sent. */
export function librarySampleRegistration(item){
 if(!item||typeof item.id!=='string'||!item.id)throw new Error('Choose a sound returned by Freestyle.');
 if(item.canAdd===false)throw new Error(blockedReason(item));
 if(item.canAdd!==undefined&&typeof item.canAdd!=='boolean')throw new Error('Freestyle returned an invalid sound availability flag.');
 let handle;
 if(Object.hasOwn(item,'register'))handle=item.register;
 else if(typeof item.catalog_sound_id==='string')handle={catalog_sound_id:item.catalog_sound_id};
 else if(/^cover-sound-[A-Za-z0-9_-]+$/.test(item.id))handle={catalog_sound_id:item.id};
 if(!handle||typeof handle!=='object'||Array.isArray(handle)||Object.keys(handle).some(key=>!REGISTER_IDENTITIES.has(key)&&key!=='name'))throw new Error('Freestyle did not provide a supported registration handle for this sound.');
 const identities=Object.keys(handle).filter(key=>REGISTER_IDENTITIES.has(key));
 if(identities.length!==1)throw new Error('This sound needs exactly one registration identity.');
 const identity=handle[identities[0]];
 if(typeof identity!=='string'||!identity||identity.length>64||/\s|[\x00-\x1f\x7f]/.test(identity))throw new Error('Freestyle returned an invalid sound registration identity.');
 if(Object.hasOwn(handle,'name')&&(typeof handle.name!=='string'||handle.name.length>80))throw new Error('The sound registration name must contain at most 80 characters.');
 return {...handle};
}
/** 429 rate_limited from a preview (mint or stream): a readable error carrying retryAfterSec, else null. */
export function previewLimitError(error){
 if(Number(error?.status??error?.upstreamStatus)!==429&&error?.code!=='rate_limited')return null;
 const raw=[error?.retryAfterSec,error?.result?.retryAfterSec,error?.details?.retryAfterSec,error?.result?.error?.details?.retryAfterSec,error?.metadata?.retryAfterSec].find(number),seconds=Math.max(1,Math.ceil(Number(raw??30)));
 return Object.assign(new Error(`Freestyle is limiting sound previews right now. Try again in ${seconds} s.`),{status:429,code:'rate_limited',retryAfterSec:seconds});
}
export function libraryMediaUrl(value){
 if(typeof value!=='string'||!value.trim())return null;
 try{const url=new URL(value,freestyleOrigin());return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
export function unpackLibraryResult(result){
 let data=result?.structuredContent;
 if(!data){try{data=JSON.parse(list(result?.content).filter(b=>b.type==='text').map(b=>b.text).join('\n'));}catch{data=result;}}
 data=data?.response??data;
 if(result?.isError||data?.error||data?.ok===false)throw Object.assign(new Error(typeof data?.error==='string'?data.error:data?.error?.message||data?.message||'Freestyle could not complete the library operation.'),{result,code:data?.code??data?.error?.code,...(number(data?.status??data?.statusCode)?{status:Number(data.status??data.statusCode)}:{})});
 return data||{};
}
/** Source shape matches the native sample materializer and pattern source serializer. */
export function materializedSampleSource(result,item={}){
 const data=unpackLibraryResult(result),sample=data.sample || ((data.audioFileId||data.audio_file_id)?data:null);
 if(!sample||typeof sample!=='object')throw new Error('Freestyle did not return a materialized sample. Refresh the project sample pool before trying again.');
 const explicit=sample.source||data.source;
 const audioFileId=sample.audioFileId||sample.audio_file_id||explicit?.audioFileId;
 if(typeof audioFileId!=='string'||!audioFileId.trim())throw new Error('The materialized sample has no explicit audioFileId. It remains in the project sample pool; a canonical sample identity is needed to add it to the channel rack.');
 const source={...(explicit?.kind==='sample'?explicit:{}),id:explicit?.id||sample.sourceId||sample.source_id||`sample:${audioFileId}`,kind:'sample',name:String(sample.name||explicit?.name||item.name||'Sample'),audioFileId,samplePlaybackMode:sample.samplePlaybackMode||sample.sample_playback_mode||'one-shot',busId:sample.busId||'master',muted:false,solo:false,volume:1};
 const url=sample.audioUrl||sample.audio_url||sample.previewUrl||sample.preview_url;
 if(typeof url==='string')source.audioUrl=url;
 const duration=sample.durationSec??sample.duration_sec;if(number(duration))source.durationSec=Number(duration);
 const mime=sample.mimeType||sample.mime_type;if(typeof mime==='string')source.mimeType=mime;
 if(number(sample.rootPitch??sample.root_pitch))source.rootPitch=Number(sample.rootPitch??sample.root_pitch);
 if(sample.rackId||sample.rack_id)source.rackId=sample.rackId||sample.rack_id;
 return {sample,source,result:data};
}
export function normalizeLibraryRows(data,view){
 const assets=Object.prototype.hasOwnProperty.call(ASSET_TYPES,view);
 const rows=assets?list(data.assets??data.data):view==='audio'?list(data.sounds??data.data):list(data.items??data.data);
 return rows.filter(row=>row&&typeof row.id==='string'&&row.id).map(row=>{
  let materializable=false,reason=row.canAddReason;
  if(!assets&&view!=='audio'){try{librarySampleRegistration(row);materializable=true;}catch(error){reason=typeof reason==='string'&&reason.trim()?reason:error.message;}}
  return {...row,...(reason?{canAddReason:reason}:{}),_libraryView:view,_rowKind:assets?'asset':view==='audio'?'audio':'sound',previewUrl:libraryMediaUrl(row.previewUrl||row.preview_url||row.audioUrl||row.audio_url),materializable};
 });
}
async function defaultCall(name,args){
 const response=await bridgeFetch('modesty-bridge:/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})});const data=await response.json();
 if(!response.ok)throw Object.assign(new Error(data.detail||data.error?.message||data.message||(typeof data.error==='string'?data.error:`Freestyle returned HTTP ${response.status}.`)),{status:response.status,code:data.code??data.error?.code,result:data});return data;
}
/** Mount with new CloudLibraryBrowser({container,searchInput,getProject,call,...}).mount(). */
export class CloudLibraryBrowser{
 constructor({container,searchInput,getProject=()=>null,call=defaultCall,onPatternApply,onSampleMaterialized,onPreview,prepareMedia,onWriteState=()=>{},onError=()=>{},onStatus=()=>{},audioFactory}={}){
  this.container=typeof container==='string'?globalThis.document?.querySelector(container):container??globalThis.document?.querySelector('#browser-tree');
  this.searchInput=typeof searchInput==='string'?globalThis.document?.querySelector(searchInput):searchInput;
  this.getProject=getProject;this.call=call;this.onPatternApply=onPatternApply;this.onSampleMaterialized=onSampleMaterialized;this.onPreview=onPreview;this.prepareMedia=prepareMedia;this.onWriteState=onWriteState;this.onError=onError;this.onStatus=onStatus;this.audioFactory=audioFactory||(()=>new Audio());
  this.view='sounds';this.pack=null;this.search='';this.category='';this.tag='';this.rows=[];this.total=null;this.nextCursor=null;this.nextOffset=null;this.categories=[];this.truncated=false;this.busy=false;this.writeBusy=false;this.generation=0;this.mounted=false;this.previewGeneration=0;this.audio=null;this.detail=null;this.error=null;this.cache=new Map();this.registrationRecord=null;
 }
 mount(container=this.container){
  if(!container)throw new Error('The cloud library needs a browser container.');this.container=container;this.mounted=true;container.classList.add('cloud-library-browser');
  if(this.searchInput){this.search=this.searchInput.value||'';this.searchInput.maxLength=128;this.searchListener=()=>{clearTimeout(this.searchTimer);this.searchTimer=setTimeout(()=>this.execute(()=>this.setSearch(this.searchInput.value)),300);};this.searchInput.addEventListener('input',this.searchListener);}
  this.render();return this;
 }
 execute(operation){return Promise.resolve().then(operation).catch(error=>{this.reportError(error);return null;});}
 reportError(error){this.error=error instanceof Error?error:new Error(String(error));this.render();this.onError(this.error);}
 async request(name,args){return unpackLibraryResult(await this.call(name,args));}
 filters(){const args={};if(this.search.trim())args.search=this.search.trim().slice(0,128);if(this.category.trim())args.category=this.category.trim().slice(0,64);if(this.tag.trim())args.tag=this.tag.trim().slice(0,64);return args;}
 async open(view='sounds'){
  if(!VIEWS.has(view))throw new Error(`Unknown cloud library view: ${view}`);this.view=view;this.pack=null;this.detail=null;return this.load();
 }
 async openPack(asset){if(!asset?.id)throw new Error('Choose a sound pack returned by Freestyle.');this.pack=asset;this.view='pack';this.detail=null;this.search='';if(this.searchInput)this.searchInput.value='';return this.load();}
 async setSearch(value){this.search=String(value||'').slice(0,128);if(this.searchInput&&this.searchInput.value!==this.search)this.searchInput.value=this.search;return this.load();}
 async setFilters({category=this.category,tag=this.tag}={}){this.category=String(category||'').slice(0,64);this.tag=String(tag||'').slice(0,64);return this.load();}
 async refresh(){this.cache.clear();return this.load({force:true});}
 async more(){if(this.busy||(!this.nextCursor&&this.nextOffset==null))return this.rows;return this.load({append:true});}
 async load({append=false,force=false}={}){
  const generation=++this.generation,view=this.view;this.busy=true;this.error=null;if(!append){this.rows=[];this.nextCursor=null;this.nextOffset=null;}this.render();
  let name,args;
  if(view==='pack'){name='list_sound_pack_items';args={asset_id:this.pack.id,limit:PAGE_SIZE,...this.filters(),...(append&&this.nextCursor?{cursor:this.nextCursor}:{})};}
  else if(view==='sounds'){name='browse_sounds';args={limit:PAGE_SIZE,...this.filters(),...(append&&this.nextCursor?{cursor:this.nextCursor}:{})};}
  else if(view==='audio'){name='list_audio_library';const f=this.filters();args={limit:PAGE_SIZE,offset:append?this.nextOffset||0:0,...(f.search?{query:f.search}:{}),...(f.category?{category:f.category}:{}),...(f.tag?{tag:f.tag}:{})};}
  else{name='list_my_library_assets';args={asset_type:ASSET_TYPES[view],limit:PAGE_SIZE,...(append&&this.nextCursor?{cursor:this.nextCursor}:{})};}
  const cacheKey=JSON.stringify([name,args]);
  try{
   const data=!force&&this.cache.has(cacheKey)?this.cache.get(cacheKey):await this.request(name,args);this.cache.set(cacheKey,data);
   if(generation!==this.generation)return this.rows;
   let rows=normalizeLibraryRows(data,view);
   if(ASSET_TYPES[view]){const query=this.search.trim().toLowerCase();rows=rows.filter(row=>(!query||`${row.name||''} ${row.description||''} ${list(row.tags).join(' ')}`.toLowerCase().includes(query))&&(!this.category||row.libraryCategory===this.category||list(row.categories).includes(this.category))&&(!this.tag||list(row.tags).includes(this.tag)));}
   this.rows=append?[...this.rows,...rows.filter(row=>!this.rows.some(old=>old.id===row.id))]:rows;
   this.total=data.total??data.count??data.asset?.itemCount??null;this.nextCursor=data.nextCursor||data.pagination?.nextCursor||null;this.nextOffset=number(data.nextOffset)?Number(data.nextOffset):null;
   this.truncated=!!data._truncated||list(data.assets).some(row=>row?._truncatedItems);this.categories=list(data.categories);this.libraryUrl=libraryMediaUrl(data.libraryUrl)||null;this.busy=false;this.render();return this.rows;
  }catch(error){if(generation===this.generation){this.busy=false;this.error=error;this.render();}throw error;}
 }
 async projectContext(){const project=await this.getProject();const projectId=project?.cloud?.projectId||project?.projectId||project?.id;if(!projectId||projectId==='empty')throw new Error('Load or create a Freestyle cloud project before adding library content.');return {project,projectId};}
 pendingRegistration(){const record=this.registrationRecord;return record&&REGISTRATION_PENDING.has(record.status)?record:null;}
 sameRegistration(record,item,handle){return record.identity===registrationIdentity(item,handle);}
 async addSound(item){
  if(this.writeBusy)return null;if(item?.materializable===false||item?._libraryView==='audio')throw new Error(blockedReason(item));const registration=librarySampleRegistration(item),retained=this.pendingRegistration();
  if(retained&&!this.sameRegistration(retained,item,registration))throw new Error('Retry or finish the pending library addition before adding a different sound.');
  this.writeBusy=true;this.error=null;
  try{this.onWriteState(true);this.render();
   const {projectId,project}=await this.projectContext();
   if(retained&&retained.projectId!==projectId)throw new Error('Return to the pending library addition’s original project before retrying it.');
   let record=retained;
   if(!record){const idempotencyKey=crypto.randomUUID();record={projectId,itemId:item.id,item:structuredClone(item),identity:registrationIdentity(item,registration),targetPatternId:project.selectedPattern,idempotencyKey,arguments:{project_id:projectId,...registration,idempotency_key:idempotencyKey},status:'prepared',acknowledged:false,result:null,deliveryAttempts:0};this.registrationRecord=record;}
   this.onStatus(record.acknowledged?`Finishing ${item.name||'sample'} in the Freestyle sample pool…`:`Adding ${item.name||'sample'} to the Freestyle sample pool…`);
   if(!record.acknowledged){
    record.status='sending';
    try{const result=await this.request('register_pattern_sample',structuredClone(record.arguments));record.result=structuredClone(result);record.acknowledged=true;record.idempotencyInProgress=false;record.status='acknowledged';record.error=null;}
    catch(error){record.error=error.message;record.idempotencyInProgress=record.idempotencyInProgress||isIdempotencyInProgress(error);record.status=!record.idempotencyInProgress&&definiteCloudRejection(error)?'rejected':'uncertain';throw error;}
   }
   const result=record.result;
   if(result.projectId!==undefined&&result.projectId!==projectId)throw new Error('The registration receipt belongs to another project. Its saved receipt is retained.');
   const materialized=record.materialized??=(materializedSampleSource(result,record.item)),current=await this.projectContext();
   if(current.projectId!==projectId){const error=new Error('The sample was added to the previous cloud project. Return to that project to finish adding it to a pattern.');error.projectId=projectId;error.result=result;throw error;}
   const payload={projectId,targetPatternId:record.targetPatternId,item:record.item,...materialized};record.payload=payload;record.deliveryAttempts++;
   try{await this.onSampleMaterialized?.(payload);}catch(error){record.error=error.message;throw error;}
   record.status='completed';record.error=null;this.onStatus(`${materialized.source.name} added to the cloud sample pool.`);return payload;
  }finally{this.writeBusy=false;try{this.onWriteState(false);}finally{this.render();}}
 }
 async applyPattern(asset,{mode='pattern_and_sounds',targetPatternId,channelIds}={}){
  if(this.writeBusy)return null;if(!asset?.id)throw new Error('Choose a pattern returned by Freestyle.');if(!['pattern','sounds','pattern_and_sounds'].includes(mode))throw new Error('Choose a supported pattern import mode.');if(targetPatternId==='empty'||typeof targetPatternId==='string'&&targetPatternId.startsWith('local-'))throw new Error('Save and select a persisted cloud pattern before targeting it.');
  this.writeBusy=true;this.error=null;
  try{this.onWriteState(true);this.render();const {projectId}=await this.projectContext();this.onStatus(`Applying ${asset.name||'pattern'} in Freestyle…`);const args={project_id:projectId,asset_id:asset.id,mode};if(targetPatternId&&targetPatternId!=='empty')args.target_pattern_id=targetPatternId;if(channelIds?.length)args.channel_ids=channelIds.slice(0,64);
   const result=await this.request('apply_marketplace_pattern',args),payload={projectId,asset,mode,targetPatternId,result};await this.onPatternApply?.(payload);this.onStatus('Pattern applied in the cloud project.');return payload;
  }finally{this.writeBusy=false;try{this.onWriteState(false);}finally{this.render();}}
 }
 async inspectAsset(asset){const assetType=asset.assetType||ASSET_TYPES[this.view];if(!assetType)throw new Error('This row is not a marketplace asset.');const data=await this.request('get_marketplace_asset',{asset_type:assetType,asset_id:asset.id,include_payload:false});this.detail=data.asset||asset;this.render();return data;}
 /** previewCatalogSound: {url, requiresAuth} for one Sound Library row, or null when the route is unavailable (the row's
  *  own previewUrl is then used). A 429 is reported with its Retry-After and blocks repeat clicks until it passes. */
 async catalogPreview(item){
  if(this.previewUnsupported)return null;
  const wait=Math.ceil(((this.previewBlockedUntil||0)-Date.now())/1000);if(wait>0)throw previewLimitError({status:429,retryAfterSec:wait});
  let data;
  try{data=unpackLibraryResult(await this.call('previewCatalogSound',{item_id:item.id}));}
  catch(error){
   const limited=previewLimitError(error);if(limited){this.previewBlockedUntil=Date.now()+limited.retryAfterSec*1000;throw limited;}
   if(['studio_operation_unsupported','invalid_operation','unknown_tool'].includes(error?.code)){this.previewUnsupported=true;return null;}
   if(error?.code==='preview_unavailable')throw new Error('Freestyle has no playable audio for this sound yet.');
   // Any other failure (the route unreachable, an unexpected answer): the row's own preview link still plays.
   this.lastPreviewError=error;if(item.previewUrl||item.audioUrl)return null;
   throw error;
  }
  const requiresAuth=data.previewRequiresAuth===true,url=requiresAuth?String(data.previewUrl||''):libraryMediaUrl(data.previewUrl);
  if(!url)throw new Error('Freestyle did not return a preview URL for this sound.');
  this.lastPreview={itemId:item.id,requiresAuth,expiresInSec:data.expiresInSec??null};
  return {url:requiresAuth?libraryMediaUrl(url):url,requiresAuth};
 }
 async preview(item){
  const generation=++this.previewGeneration;
  if(this.onPreview){const handled=await this.onPreview(item);if(generation!==this.previewGeneration)return false;if(handled!==false)return handled;}
  if(this.previewId===item.id&&this.audio&&!this.audio.paused){this.audio.pause();this.render();return false;}
  // #16: Sound Library rows are auditioned through previewCatalogSound (works for any sound the user can browse).
  const catalog=item._rowKind==='sound'?await this.catalogPreview(item):null;if(generation!==this.previewGeneration)return false;
  const directUrl=catalog?.url??libraryMediaUrl(item.previewUrl||item.audioUrl);if(!directUrl)throw new Error('Freestyle did not expose a playable preview URL for this library row.');
  this.audio?.pause();let url=directUrl;
  // previewRequiresAuth:false is a short-lived storage URL fetched with no credentials; previewRequiresAuth:true is the
  // API stream, read through the host's apiFetch (the bearer stays in the host) into a blob: URL.
  if(this.prepareMedia&&(!catalog||catalog.requiresAuth)){try{url=await this.prepareMedia(directUrl,item);}catch(error){if(generation!==this.previewGeneration)return false;throw previewLimitError(error)||error;}}
  else if(catalog?.requiresAuth)throw new Error('This sound streams through Freestyle with your sign-in; the media bridge is unavailable.');
  if(generation!==this.previewGeneration)return false;
  if(typeof url!=='string'||!url.trim())throw new Error('The cloud media bridge did not return a playback URL.');
  // Embedded in a sandboxed frame: resolve against the document base, never location.*; authorized previews arrive as blob: URLs.
  try{const parsed=new URL(url,globalThis.document?.baseURI||freestyleOrigin());if(!['http:','https:','blob:'].includes(parsed.protocol)||url.startsWith('//'))throw new Error();}catch{throw new Error('The cloud media bridge returned an invalid playback URL.');}
  const audio=this.audioFactory();this.audio=audio;audio.preload='none';audio.controls=true;audio.src=url;this.previewId=item.id;this.previewName=item.name||'Preview';
  audio.onended=()=>this.render();audio.onerror=()=>this.reportError(new Error('Freestyle could not stream this library preview. The returned media route may require native Freestyle media authorization.'));
  try{await audio.play();if(generation!==this.previewGeneration){audio.pause();return false;}this.render();return true;}catch(error){if(generation!==this.previewGeneration)return false;throw new Error(`Freestyle preview playback is unavailable. ${error.message||'Check media authorization.'}`);}
 }
 render(){
  if(!this.mounted||!this.container)return;
  const shell=node('div',null,'library-shell');
  const tabs=node('div',null,'library-tabs');for(const [view,label]of [['sounds','Sounds'],['packs','Packs'],['patterns','MIDI'],['audio','Files']]){const b=button(label,`Browse cloud ${view}`,()=>this.execute(()=>this.open(view)),this.view===view||this.view==='pack'&&view==='packs'?'active':'');b.disabled=this.writeBusy;tabs.append(b);}shell.append(tabs);
  const filters=node('details',null,'library-filter-panel'),summary=node('summary','Search filters');filters.append(summary);const row=node('div',null,'library-filters');for(const [key,label]of [['category','Category'],['tag','Tag']]){const input=node('input');input.placeholder=label;input.setAttribute('aria-label',`Library ${label.toLowerCase()}`);input.maxLength=64;input.value=this[key];input.onchange=()=>this.execute(()=>this.setFilters({[key]:input.value}));row.append(input);}filters.append(row);shell.append(filters);
  const heading=node('div',null,'library-heading');if(this.view==='pack')heading.append(button('‹','Back to sound packs',()=>this.execute(()=>this.open('packs'))));heading.append(node('strong',this.pack?.name||({sounds:'All sounds',packs:'Sound packs',patterns:'Pattern library',audio:'Audio library',kits:'Beat kits',plugins:'Plugins',effects:'Effects'}[this.view]||'Library')));heading.append(button('↻','Refresh cloud library',()=>this.execute(()=>this.refresh())));shell.append(heading);
  const count=node('div',this.busy?'Reading Freestyle…':`${this.rows.length}${this.total!=null?` / ${this.total}`:''} ${ASSET_TYPES[this.view]?'assets':'sounds'}`,'library-count');count.setAttribute('role','status');shell.append(count);
  if(this.error){const error=node('div',this.error.message,'library-message library-error');error.append(button('Retry','Retry the library read',()=>this.execute(()=>this.refresh())));shell.append(error);}
  const items=node('div',null,'library-rows');for(const item of this.rows)items.append(item._rowKind==='asset'?this.assetRow(item):this.soundRow(item));shell.append(items);
  if(!this.rows.length&&!this.busy&&!this.error)shell.append(node('div',this.search?'No matching cloud sounds or assets.':'No items were returned from this Freestyle library.','library-message'));
  if(this.truncated)shell.append(node('div','Freestyle returned a partial asset list. Global sound search still pages through all accessible sounds.','library-message'));
  if(this.nextCursor||this.nextOffset!=null){const more=button(this.busy?'Loading…':'Load more','Read the next cloud library page',()=>this.execute(()=>this.more()),'library-more');more.disabled=this.busy;shell.append(more);}
  if(this.detail)shell.append(this.assetDetail(this.detail));
  if(this.audio&&this.previewId){const player=node('div',null,'library-preview');player.append(node('span',this.previewName));if(this.audio.nodeType)player.append(this.audio);shell.append(player);}
  this.container.replaceChildren(shell);
 }
 soundRow(item){
  const pending=this.pendingRegistration(),same=!!pending&&item.materializable&&this.sameRegistration(pending,item,librarySampleRegistration(item)),registrationBlocked=!!pending&&!same;const row=node('div',null,'library-sound-row');row.draggable=!!item.materializable&&!registrationBlocked;row.ondragstart=event=>{if(!item.materializable||this.writeBusy||registrationBlocked){event.preventDefault();return;}event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('application/vegetable-library-sound',JSON.stringify({id:item.id,name:item.name,_libraryView:item._libraryView,materializable:item.materializable,canAdd:item.canAdd,register:librarySampleRegistration(item)}));};row.title=[item.name,item.bpm?`${item.bpm} BPM`:null,item.key,list(item.tags).join(', ')].filter(Boolean).join(' · ');
  const playable=!!item.previewUrl||!!this.onPreview;const play=button(this.previewId===item.id&&this.audio&&!this.audio.paused?'Ⅱ':'▷',`Preview ${item.name}`,()=>this.execute(()=>this.preview(item)),'library-preview-button');play.disabled=!playable;row.append(play);
  const label=button(item.name||'Unnamed sound','Preview this cloud sound',()=>this.execute(()=>this.preview(item)),'library-sound-name');label.disabled=!playable;row.append(label);
  const duration=number(item.durationSec)?`${Number(item.durationSec).toFixed(Number(item.durationSec)<10?2:1)}s`:item.bpm?`${item.bpm}`:'';if(duration)row.append(node('small',duration));
  if(item._rowKind!=='audio'){const add=button(same?'Retry':'+',!item.materializable?blockedReason(item):registrationBlocked?'Retry or finish the pending library addition first.':same?'Retry the retained library addition.':`Add ${item.name} to the current cloud sample pool`,()=>this.execute(()=>this.addSound(item)),'library-add');add.disabled=this.writeBusy||!item.materializable||registrationBlocked;row.append(add);if(!item.materializable)row.append(node('span',blockedReason(item),'library-can-add-reason'));}else{row.append(node('span','·','library-readonly'));if(item.canAdd===false&&item.canAddReason)row.append(node('span',blockedReason(item),'library-can-add-reason'));}
  return row;
 }
 assetRow(asset){
  const row=node('div',null,'library-asset-row'),assetType=asset.assetType||ASSET_TYPES[this.view],isPattern=assetType==='pattern',isPack=assetType==='sound_pack';
  row.append(button(isPattern?'♬':'▸',asset.name||'Cloud asset',()=>this.execute(()=>isPack?this.openPack(asset):this.inspectAsset(asset)),'library-folder-icon'));
  row.append(button(asset.name||'Unnamed asset',isPack?'Open this sound pack':'Inspect this asset',()=>this.execute(()=>isPack?this.openPack(asset):this.inspectAsset(asset)),'library-asset-name'));
  const count=asset.soundPack?.itemCount??asset.capabilities?.soundCount;if(count!=null)row.append(node('small',String(count)));
  if(isPattern){const add=button('+','Create a cloud pattern with its sounds',()=>this.execute(()=>this.applyPattern(asset)),'library-add');add.disabled=this.writeBusy||asset.capabilities?.importPattern===false;row.append(add);}else row.append(button('i','Read asset details',()=>this.execute(()=>this.inspectAsset(asset)),'library-info'));
  return row;
 }
 assetDetail(asset){
  const details=node('section',null,'library-asset-detail');const heading=node('div',null,'library-detail-heading');heading.append(node('strong',asset.name||'Asset'),button('×','Close asset details',()=>{this.detail=null;this.render();}));details.append(heading);if(asset.description)details.append(node('p',asset.description));
  if(asset.assetType==='pattern'){
   const mode=node('select');mode.setAttribute('aria-label','Pattern import mode');for(const [value,label]of [['pattern_and_sounds','Pattern + sounds'],['pattern','Pattern events only'],['sounds','Sounds only']]){const option=node('option',label);option.value=value;mode.append(option);}details.append(mode);
   const target=node('label',null,'library-current-target'),check=node('input');check.type='checkbox';target.append(check,document.createTextNode(' Use selected pattern'));details.append(target);
   const apply=button('Apply in Freestyle','Apply this asset with the selected mode',()=>this.execute(async()=>{const {project}=await this.projectContext();let id;if(check.checked){id=project.selectedPattern;if(!id||id==='empty')throw new Error('Select a persisted cloud pattern first.');}return this.applyPattern(asset,{mode:mode.value,targetPatternId:id});}),'library-apply');apply.disabled=this.writeBusy||asset.capabilities?.importPattern===false;details.append(apply);
  }
  const url=libraryMediaUrl(asset.url);if(url){const link=node('a','Open in Freestyle ↗');link.href=url;link.target='_blank';link.rel='noopener noreferrer';details.append(link);}return details;
 }
 destroy(){clearTimeout(this.searchTimer);this.generation++;this.previewGeneration++;this.audio?.pause();if(this.searchInput&&this.searchListener)this.searchInput.removeEventListener('input',this.searchListener);this.mounted=false;this.container?.classList.remove('cloud-library-browser');}
}
