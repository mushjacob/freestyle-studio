/** Compact Freestyle Sound Library browser. Deterministic REST catalog dispatch. */
import {StudioApiClient} from './studio-api-client.js';
import {studioApiFeatureAvailability} from './studio-api-features.js';
import {catalogPatternSampleSelector} from './cloud-pattern-sample-registration.js';
import {LibraryPreviewPlayer} from './library-preview-player.js';
import {studioIcon} from './studio-icons.js';
import {ProjectSampleLibrary,registeredProjectSampleSource} from './project-sample-library.js';
import {clientLog} from './client-diagnostics.js';
import {hostFetch,freestyleOrigin,freestyleHost} from './freestyle-host-transport.js';
/** How a Browser row is auditioned (339 contract, browseCatalogSounds):
 *  - 'engine': only rows that are ALREADY project samples (Project samples
 *    view): auditioned in the live engine, nothing is registered.
 *  - 'splice': Splice rows: previewCatalogSpliceSound returns a short-lived,
 *    credential-free CDN URL played in the preview element.
 *  - 'direct': every other row, including Sound Library rows. Their
 *    previewUrl/audioUrl is the Studio's same-origin byte route
 *    (/api/marketplace/…, /api/audio-library/…); the embedded studio shares the
 *    Freestyle session cookie, so an <audio> element plays it directly like the
 *    Default Sound Library. Never registered in the project. */
export function libraryPreviewRoute(item){
 if(!item||typeof item!=='object')return'direct';
 const splice=item.spliceSoundId??item.splice_sound_id??(item.provider==='splice'||item.source==='splice'?item.id:null);
 if(typeof splice==='string'&&splice)return'splice';
 if(item._libraryView==='project-samples'&&typeof item.audioFileId==='string'&&item.audioFileId)return'engine';
 // Freestyle #16: a Sound Library row is previewed through previewCatalogSound (public API), not the Studio's
 // cookie-only byte route (which answers 401 to an OAuth client).
 if(!item._catalogPreview&&!item._playbackUrl&&item._libraryView==='sounds'&&item._rowKind==='sound'&&typeof item.id==='string'&&item.id)return'catalog';
 // Sound Library rows preview exactly like the Default studio's Sound Library:
 // an HTMLAudio on the same-origin /api preview route (the Freestyle session cookie authorizes it), played
 // inside the click. Nothing is registered in or uploaded to the project; that only happens when the sound
 // is added to the Playlist or the Channel Rack (addSound / the drag handlers). The old 'engine' route
 // registered every previewed row in the project sample pool first.
 return'direct';
}
const VIEW_FEATURES={sounds:'library_global_sounds',pack:'library_pack_items',audio:'library_audio_files','project-samples':'library_project_samples'};
// Relative media/links resolve against the Freestyle page that hosts this studio (stage, prod or dev).
const BASE=freestyleOrigin();
// Keep small opaque-cursor pages; never substitute own assets for global sounds.
const PAGE_SIZE=10;
const VIEWS=new Set(['sounds','packs','patterns','audio','kits','plugins','effects','project-samples']);
const ASSET_TYPES={packs:'sound_pack',patterns:'pattern',kits:'beat_kit',plugins:'plugin',effects:'audio_effect'};
const unavailableSoundReason=item=>({splice_download_required:'Download this sound through your linked Splice account before adding it. Preview remains available.',not_audio:'This catalog item is not an audio sample.',not_in_storage:'This sound is not available in Freestyle storage. Preview remains available.'}[item?.canAddReason]||'This catalog sound cannot be added. Preview remains available.');
const list=value=>Array.isArray(value)?value:[];
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;return n;};
const button=(text,title,handler,className='')=>{const b=node('button',text,className);b.type='button';b.title=title;b.addEventListener('click',handler);return b;};
const number=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const text=value=>typeof value==='string'?value.trim():'';
/** Logic Pro right-side Browsers: the Loops | Files segmented header lives in
 *  index.html (.browser-tabs, O / F). Each segment owns a small set of
 *  locations; the cloud views and their API calls are unchanged. */
const SEGMENT_SCOPES={loops:[['sounds','All Loops'],['packs','Loop Packs'],['patterns','Patterns']],files:[['project-samples','Project Audio'],['audio','Audio Files']],library:[['plugins','Plugins']]};
export function librarySegment(view){return['project-samples','audio'].includes(view)?'files':['plugins','effects','kits'].includes(view)?'library':'loops';}
const keywordLabel=value=>typeof value==='string'?value.trim():text(value?.name)||text(value?.label)||text(value?.title)||text(value?.value)||text(value?.id);
const keywordValue=value=>typeof value==='string'?value.trim():text(value?.value)||text(value?.slug)||text(value?.name)||text(value?.id);
/** Logic's Beats column: whole beats only when the published BPM and duration
 *  agree on a whole number; otherwise the real duration in seconds. */
export function libraryLengthLabel(item){
 if(!number(item?.durationSec)||Number(item.durationSec)<0)return null;const seconds=Number(item.durationSec),bpm=Number(item?.bpm),secondsText=`${seconds.toFixed(seconds<10?2:1)}s`;
 if(number(item?.bpm)&&bpm>0){const beats=seconds*bpm/60,whole=Math.round(beats);if(whole>=1&&Math.abs(beats-whole)<=.02)return{text:String(whole),beats:true,title:`${whole} beats · ${secondsText} at ${Number(bpm.toFixed(3))} BPM`};}
 return{text:secondsText,beats:false,title:secondsText};
}
/** Favourites are a per-viewer browser convenience (no engine/API state). */
function defaultFavoriteStore(){const KEY='disabelton-library-favorites';return{read(){try{const value=JSON.parse(globalThis.localStorage?.getItem(KEY)||'[]');return Array.isArray(value)?value.filter(id=>typeof id==='string').slice(-2000):[];}catch{return[];}},write(ids){try{globalThis.localStorage?.setItem(KEY,JSON.stringify(ids.slice(-2000)));}catch{}}};}
function topTags(rows,exclude){const counts=new Map();for(const row of rows)for(const tag of list(row.tags).filter(tag=>typeof tag==='string').map(text))if(tag&&!exclude.has(tag.toLowerCase()))counts.set(tag,(counts.get(tag)||0)+1);return[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,12).map(([tag])=>tag);}
function writeLibraryDragData(transfer,payload){
 transfer.effectAllowed='copy';transfer.setData('application/vegetable-library-sound',JSON.stringify(payload));
 // Standard text fallback lets native drag systems represent this item without
 // exposing a media URL. Studio destinations still require the canonical MIME.
 transfer.setData('text/plain',String(payload.name||'Sample').slice(0,255));
}
function libraryRowMetadata(item){
 const key=text(item.key),scale=text(item.scale),tonality=key&&scale&&!key.toLowerCase().includes(scale.toLowerCase())?`${key} ${scale}`:key||scale,parts=[];
 if(number(item.bpm)&&Number(item.bpm)>0)parts.push(`${Number(Number(item.bpm).toFixed(3))} BPM`);if(tonality)parts.push(tonality);
 const category=text(item.libraryCategory);if(category)parts.push(category);
 for(const tag of list(item.tags).filter(tag=>typeof tag==='string').map(text))if(tag&&!parts.some(part=>part.toLowerCase()===tag.toLowerCase()))parts.push(tag);
 return parts.join(' · ');
}
export function libraryMediaUrl(value){
 if(typeof value!=='string'||!value.trim())return null;
 try{const url=new URL(value,BASE);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
export function unpackLibraryResult(result){
 let data=result?.structuredContent;
 if(!data){try{data=JSON.parse(list(result?.content).filter(b=>b.type==='text').map(b=>b.text).join('\n'));}catch{data=result;}}
 data=data?.response??data;
 if(result?.isError||data?.error||data?.ok===false)throw new Error(typeof data?.error==='string'?data.error:data?.message||'Freestyle could not complete the library operation.');
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
 const rows=assets?list(data.assets):view==='audio'?list(data.sounds):list(data.items);
 return rows.filter(row=>row&&typeof row.id==='string'&&row.id).map(row=>({...row,_libraryView:view,_rowKind:assets?'asset':view==='audio'?'audio':'sound',previewUrl:libraryMediaUrl(row.previewUrl||row.preview_url||row.audioUrl||row.audio_url),materializable:!assets&&view!=='audio'&&row.canAdd!==false}));
}
async function defaultCall(name,args){
 const response=await hostFetch('/api/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})});const data=await response.json();
 if(!response.ok)throw new Error(data.detail||data.error||`Freestyle returned HTTP ${response.status}.`);return data;
}
/** Mount with new CloudLibraryBrowser({container,searchInput,getProject,call,...}).mount(). */
export class CloudLibraryBrowser{
 constructor({catalogPreview=false,container,searchInput,previewContainer=null,getProject=()=>null,getFeatureProject=getProject,featureOperations,client=new StudioApiClient(),getRegistrationScope=null,idFactory=()=>globalThis.crypto.randomUUID(),call=defaultCall,onPatternApply,onSampleMaterialized,onPreview,onAuditionSample=null,prepareMedia,inspectMediaError=null,onImportAudio,onWriteState=()=>{},onError=()=>{},onStatus=()=>{},audioFactory,favoriteStore=defaultFavoriteStore(),monitor=null}={}){
  this.favoriteStore=favoriteStore;let stored=[];try{stored=list(favoriteStore?.read?.());}catch{}this.favorites=new Set(stored.filter(id=>typeof id==='string'));this.favoritesOnly=false;this.keywordTags=[];
  this.container=typeof container==='string'?globalThis.document?.querySelector(container):container??globalThis.document?.querySelector('#browser-tree');
  this.searchInput=typeof searchInput==='string'?globalThis.document?.querySelector(searchInput):searchInput;
  this.previewContainer=typeof previewContainer==='string'?globalThis.document?.querySelector(previewContainer):previewContainer;this.previewLoop=false;this.previewVolume=1;
  this.getProject=getProject;this.getFeatureProject=getFeatureProject;this.featureOperations=featureOperations;this.client=client;this.getRegistrationScope=getRegistrationScope;this.idFactory=idFactory;this.registrationRecords=[];this.catalogPreview=catalogPreview===true;this.catalogPreviewUrls=new Map();this.previewRetryAt=0;this.autoPreview=(()=>{try{return globalThis.localStorage?.getItem('disabelton:browser-preview')!=='0';}catch{return true;}})();this.featureProject=null;this.unavailable=false;this.notice=null;this.onImportAudio=onImportAudio||(()=>globalThis.document?.querySelector('#import-audio')?.click());this.call=call;this.onPatternApply=onPatternApply;this.onSampleMaterialized=onSampleMaterialized;this.onPreview=onPreview;this.onAuditionSample=onAuditionSample;this.auditionedSamples=new Map();this.prepareMedia=prepareMedia;this.inspectMediaError=inspectMediaError;this.previewErrorStates=new WeakMap();this.onWriteState=onWriteState;this.onError=onError;this.onStatus=onStatus;this.audioFactory=audioFactory||(()=>new Audio());
  // Preview audio follows the toolbar monitor volume (the listening level), like every other sound in the studio.
  this.monitor=monitor;this.mediaCache=new Map();this.mediaWarming=new Set();
  if(monitor?.addEventListener){this.monitorVolumeListener=()=>{if(this.audio)this.applyPreviewVolume(this.audio);};monitor.addEventListener('volume',this.monitorVolumeListener);}
  this.view='sounds';this.pack=null;this.search='';this.category='';this.tag='';this.rows=[];this.total=null;this.nextCursor=null;this.nextOffset=null;this.assetCursors=new Set();this.categories=[];this.truncated=false;this.busy=false;this.writeBusy=false;this.generation=0;this.mounted=false;this.previewGeneration=0;this.audio=null;this.detail=null;this.error=null;this.cache=new Map();this.selectedSoundId=null;this.soundSelectionScope=null;this.previewScope=null;
  this.sampleAttachments=[];this.projectSamples=new ProjectSampleLibrary({getContext:()=>this.projectSampleContext(),list:(params,options)=>this.client.call('listPatternSamples',params,options)});
 }
 projectSampleContext(){const scope=this.getRegistrationScope?.(),p=this.getFeatureProject();if(p&&typeof p.then==='function')throw new Error('Load the current project before reading its samples.');return scope||{projectId:p?.cloud?.projectId||p?.projectId||p?.id,trackId:''};}
 mount(container=this.container){
  if(!container)throw new Error('The cloud library needs a browser container.');this.container=container;this.mounted=true;container.classList.add('cloud-library-browser');
  this.keyListener=event=>this.soundKeyDown(event);this.focusListener=event=>{const label=event.target.closest?.('.library-sound-name,.library-preview-button');if(label&&container.contains(label))this.selectSound(label.closest('.library-sound-row')?.dataset.librarySoundId);};container.addEventListener('keydown',this.keyListener);container.addEventListener('focusin',this.focusListener);
  if(this.previewContainer&&!this.previewPlayer)this.previewPlayer=new LibraryPreviewPlayer({container:this.previewContainer,getSnapshot:()=>this.previewSnapshot(),onCommand:(...args)=>{try{return this.previewCommand(...args);}catch(error){this.reportError(error);return false;}},onMediaEvent:({audio})=>{if(audio===this.audio){if(typeof audio.loop==='boolean')this.previewLoop=audio.loop;}this.paintSoundSelection();}});
  if(this.searchInput){this.search=this.searchInput.value||'';this.searchInput.maxLength=128;this.searchListener=()=>{clearTimeout(this.searchTimer);this.searchTimer=setTimeout(()=>this.execute(()=>this.setSearch(this.searchInput.value)),300);};this.searchInput.addEventListener('input',this.searchListener);}
  this.render();return this;
 }
 execute(operation){return Promise.resolve().then(operation).catch(error=>{const state=this.previewErrorStates.get(error);if(!state||state.current()&&!state.reported){if(state)state.reported=true;this.reportError(error);}return null;});}
 soundScope(){const p=this.featureProject;let context=null;if(this.getRegistrationScope){try{context=this.getRegistrationScope();}catch{context='unavailable';}}return JSON.stringify([p?.cloud?.projectId||p?.projectId||p?.id||null,context,this.view,this.pack?.id||null,this.search,this.category,this.tag]);}
 currentSound(id){const matches=this.rows.filter(item=>item._rowKind!=='asset'&&item.id===id);return matches.length===1?matches[0]:null;}
 isPreviewPlaying(id,scope=this.soundScope()){return this.previewScope===scope&&this.previewId===id&&!!this.audio&&!this.audio.paused&&(!this.previewPlayer||this.previewPlaybackState?.confirmed&&!this.previewPlaybackState?.failed&&Number.isFinite(this.audio.duration)&&this.audio.duration>0);}
 syncSoundSelection(){const scope=this.soundScope();if(this.soundSelectionScope!==scope){if(this.soundSelectionScope!==null){this.previewGeneration++;this.clearPreview();}this.soundSelectionScope=scope;this.selectedSoundId=null;}if(!this.busy&&this.selectedSoundId&&!this.currentSound(this.selectedSoundId))this.selectedSoundId=null;return scope;}
 /** Element volume = the preview slider x the toolbar monitor volume. */
 applyPreviewVolume(audio){const monitor=Number(this.monitor?.volume),level=Number.isFinite(monitor)?Math.max(0,Math.min(1,monitor)):1;audio.volume=Math.max(0,Math.min(1,this.previewVolume*level));}
 /** Stop any sound-browser audio now (another preview starting, the view being hidden). */
 stopPreview(){if(!this.audio&&!this.previewId)return;this.previewGeneration++;this.clearPreview();this.previewPlayer?.refresh();try{this.paintSoundSelection();}catch{}}
 /** Default `prefetchPreviewItem`: on hover/pointerdown resolve the playable URL and, for short sounds, keep the bytes. */
 warmPreview(item){
  try{
   if(!item||libraryPreviewRoute(item)!=='direct')return;
   const direct=libraryMediaUrl(item.previewUrl||item.audioUrl);if(!direct||this.mediaCache.has(direct)||this.mediaWarming.has(direct))return;
   this.mediaWarming.add(direct);
   Promise.resolve(this.prepareMedia?this.prepareMedia(direct,item):direct).then(async url=>{
    if(typeof url!=='string'||!url)return;
    const entry={url};this.mediaCache.set(direct,entry);
    while(this.mediaCache.size>48){const [key,old]=this.mediaCache.entries().next().value;this.mediaCache.delete(key);if(old.blobUrl)try{URL.revokeObjectURL(old.blobUrl);}catch{}}
    const duration=Number(item.durationSec);if(!(duration>0&&duration<=30)||url.startsWith('blob:'))return;
    const response=await fetch(url,{credentials:'same-origin',cache:'force-cache'});if(!response.ok)return;
    const blob=await response.blob();if(!blob.size||blob.size>16*1024*1024||!this.mediaCache.has(direct))return;
    entry.blobUrl=URL.createObjectURL(blob);
   }).catch(()=>{}).finally(()=>this.mediaWarming.delete(direct));
  }catch{}
 }
 clearPreview(){const audio=this.audio;this.audio=null;this.previewPlaybackState=null;this.previewScope=null;this.previewId=undefined;this.previewName=null;this.previewHandled=null;if(audio){audio.onended=null;audio.onerror=null;try{audio.pause();audio.removeAttribute?.('src');audio.load?.();}catch{}}}
 previewSnapshot(){
  const scope=this.syncSoundSelection(),audio=this.previewScope===scope?this.audio:null,selected=this.currentSound(this.selectedSoundId),item=audio?this.currentSound(this.previewId):selected,state=this.previewPlaybackState;
  return{scope,audio,item,title:audio?this.previewName:selected?.name||'Select a sound',selectedTitle:selected?.name||'',canPlay:!!item&&!!libraryMediaUrl(item.previewUrl||item.audioUrl),failed:!!audio&&!!state?.failed,confirmed:!!audio&&!!state?.confirmed,handled:!audio&&this.previewHandled?.scope===scope&&this.previewHandled?.id===item?.id,loop:audio?audio.loop:this.previewLoop,volume:this.previewVolume};
 }
 previewCommand(command,value,snapshot){
  const scope=this.syncSoundSelection();if(!this.mounted||snapshot.scope!==scope||snapshot.audio!==(this.previewScope===scope?this.audio:null))return false;
  const audio=this.audio;
  if(command==='play'){if(!snapshot.item||this.currentSound(snapshot.item.id)!==snapshot.item)return false;return this.previewSoundRow(snapshot.item);}
  if(command==='loop'){this.previewLoop=!this.previewLoop;if(audio)audio.loop=this.previewLoop;return true;}
  if(command==='volume'){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)return false;this.previewVolume=value;if(audio)this.applyPreviewVolume(audio);return true;}
  if(!audio)return false;
  if(command==='stop'){this.previewGeneration++;if(this.previewPlaybackState){this.previewPlaybackState.generation=this.previewGeneration;this.previewPlaybackState.confirmed=false;}audio.pause();if(Number.isFinite(audio.duration)&&audio.duration>0)audio.currentTime=0;this.paintSoundSelection();this.previewPlayer?.refresh();return true;}
  if((command==='seek'||command==='restart')&&Number.isFinite(audio.duration)&&audio.duration>0&&!audio.error&&!this.previewPlaybackState?.failed){const position=command==='restart'?0:value;if(typeof position!=='number'||!Number.isFinite(position)||position<0||position>audio.duration)return false;audio.currentTime=position;return true;}return false;
 }
 paintSoundSelection(){
  if(!this.mounted||!this.container)return;const scope=this.syncSoundSelection();
  for(const row of this.container.querySelectorAll('.library-sound-row')){const id=row.dataset.librarySoundId,unique=this.currentSound(id)!==null,selected=unique&&this.selectedSoundId===id,playing=unique&&this.isPreviewPlaying(id,scope);row.classList.toggle('selected',selected);row.classList.toggle('previewing',playing);const play=row.querySelector('.library-preview-button');if(play)play.innerHTML=studioIcon(playing?'pause':'play');const label=row.querySelector('.library-sound-name');if(selected)label?.setAttribute('aria-current','true');else label?.removeAttribute('aria-current');}
  this.previewPlayer?.refresh();
 }
 selectSound(id,{focus=false}={}){
  this.syncSoundSelection();if(!this.currentSound(id))return false;this.selectedSoundId=id;this.paintSoundSelection();
  if(focus){const row=[...this.container.querySelectorAll('.library-sound-row')].find(row=>row.dataset.librarySoundId===id),label=row?.querySelector('.library-sound-name');if(!label||label.disabled)return false;label.focus({preventScroll:true});row.scrollIntoView?.({block:'nearest'});}return true;
 }
 previewSoundRow(item){
  const scope=this.soundScope(),generation=this.generation;if(this.currentSound(item.id)!==item)return Promise.resolve(null);this.selectSound(item.id);
  return this.execute(()=>{if(!this.mounted||scope!==this.soundScope()||generation!==this.generation||this.currentSound(item.id)!==item)return null;return this.preview(item);});
 }
 soundKeyDown(event){
  if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.getModifierState?.('AltGraph'))return;
  if(event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
  const label=event.target.closest?.('.library-sound-name'),row=label?.closest('.library-sound-row');if(!label||label.disabled||!this.container.contains(label)||!this.currentSound(row?.dataset.librarySoundId))return;
  if(event.key==='Enter'){event.preventDefault();if(!event.repeat)this.previewSoundRow(this.currentSound(row.dataset.librarySoundId));return;}
  if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  const names=[...this.container.querySelectorAll('.library-sound-name')].filter(button=>!button.disabled&&this.currentSound(button.closest('.library-sound-row')?.dataset.librarySoundId)),at=names.indexOf(label);if(at<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?names.length-1:Math.max(0,Math.min(names.length-1,at+(event.key==='ArrowDown'?1:-1)));const id=names[next].closest('.library-sound-row').dataset.librarySoundId;this.selectSound(id,{focus:true});
  // Live: with the Preview switch on, moving through the list previews each sound.
  if(this.catalogPreview&&this.autoPreview&&!event.repeat&&next!==at){const item=this.currentSound(id);if(item)this.previewSoundRow(item)?.catch?.(error=>this.reportError?.(error));}
 }
 reportError(error){this.error=error instanceof Error?error:new Error(String(error));this.render();this.onError(this.error);}
 feature(feature,project=this.featureProject){return studioApiFeatureAvailability(feature,{project,operations:this.featureOperations});}
 addAvailability(item){if(item?._libraryView==='project-samples'){const availability=this.feature('library_reuse_sample');return item.canReuse===true?availability:{...availability,enabled:false,reason:item.reuseReason||'This registered sample is missing its canonical playback metadata.'};}const availability=this.feature('library_add_sound');if(item?.canAdd===false)return{...availability,enabled:false,reason:unavailableSoundReason(item)};if(!availability.enabled||!availability.restMode)return availability;try{if(catalogPatternSampleSelector(item))return availability;}catch(error){return{...availability,enabled:false,reason:error.message};}return{...availability,enabled:false,reason:'Adding this catalog sound is awaiting a Freestyle API update. Preview remains available.'};}
 viewFeature(view=this.view){return this.feature(VIEW_FEATURES[view]||'library_own_assets');}
 featureContext(){try{const value=this.getFeatureProject();return value&&typeof value.then==='function'?value.then(project=>({project}),()=>({failed:true})):{project:value};}catch{return{failed:true};}}
 quietUnavailable(availability){this.notice=availability.reason;this.error=null;this.render();return null;}
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
  if(this.view==='project-samples')return this.loadProjectSamples({append,force});
  this.projectSamples.cancel();
  const view=this.view,assetView=Object.prototype.hasOwnProperty.call(ASSET_TYPES,view),cursor=append?this.nextCursor:null;
  if(append&&assetView&&cursor===null)return this.rows;
  const generation=++this.generation,filters=this.filters();this.busy=true;this.error=null;this.notice=null;this.unavailable=false;if(!append){this.rows=[];this.nextCursor=null;this.nextOffset=null;this.assetCursors=new Set();this.truncated=false;}this.render();
  let context=this.featureContext();if(context&&typeof context.then==='function')context=await context;
  if(generation!==this.generation)return this.rows;
  if(!context.failed)this.featureProject=context.project;
  const availability=this.viewFeature(view);
  if(context.failed&&!this.featureProject||!availability.enabled){this.busy=false;this.unavailable=true;this.rows=[];this.total=null;this.nextCursor=null;this.nextOffset=null;this.notice=context.failed&&!this.featureProject?'Connect a Freestyle project to browse the library. Local audio imports remain available.':availability.reason;this.render();return this.rows;}
  let name,args;
  if(view==='pack'){name=this.featureProject?.cloud?.rawState?.studioApi===true?'list_preset_pack_items':'list_sound_pack_items';args={asset_id:this.pack.id,limit:PAGE_SIZE,...this.filters(),...(append&&this.nextCursor?{cursor:this.nextCursor}:{})};}
  else if(view==='sounds'){name='browse_sounds';args={limit:PAGE_SIZE,...this.filters(),...(append&&this.nextCursor?{cursor:this.nextCursor}:{})};}
  else if(view==='audio'){name='list_audio_library';const f=this.filters();args={limit:PAGE_SIZE,offset:append?this.nextOffset||0:0,...(f.search?{query:f.search}:{}),...(f.category?{category:f.category}:{}),...(f.tag?{tag:f.tag}:{})};}
  else{name='list_my_library_assets';args={asset_type:ASSET_TYPES[view],limit:PAGE_SIZE,...(append?{cursor}:{})};}
  const cacheKey=JSON.stringify([name,args]);
  try{
   const data=!force&&this.cache.has(cacheKey)?this.cache.get(cacheKey):await this.request(name,args);
   if(generation!==this.generation)return this.rows;
   if(assetView){
    if(!Array.isArray(data.assets)||!Object.prototype.hasOwnProperty.call(data,'nextCursor')||data.nextCursor!==null&&(typeof data.nextCursor!=='string'||!data.nextCursor.length||data.nextCursor.length>512))throw new Error('Freestyle returned an invalid library page. Expected assets and nextCursor (an opaque cursor of at most 512 characters, or null when complete). Refresh the library before continuing.');
    if(data.nextCursor!==null&&(data.nextCursor===cursor||this.assetCursors.has(data.nextCursor)))throw new Error('Freestyle returned a repeated library cursor without advancing. The remaining assets could not be read; refresh the library before continuing.');
    if(data.nextCursor!==null)this.assetCursors.add(data.nextCursor);
   }
   this.cache.set(cacheKey,data);
   let rows=normalizeLibraryRows(data,view);if(view==='pack'&&name==='list_preset_pack_items')rows=rows.map(row=>({...row,_packAssetId:args.asset_id}));
   if(assetView){const seen=new Set(append?this.rows.map(row=>row.id):[]),query=(filters.search||'').toLowerCase();rows=rows.filter(row=>{if(seen.has(row.id))return false;seen.add(row.id);return(!query||`${row.name||''} ${row.description||''} ${list(row.tags).join(' ')}`.toLowerCase().includes(query))&&(!filters.category||row.libraryCategory===filters.category||list(row.categories).includes(filters.category))&&(!filters.tag||list(row.tags).includes(filters.tag));});}
   this.rows=append?[...this.rows,...rows.filter(row=>!this.rows.some(old=>old.id===row.id))]:rows;
   this.total=data.total??data.count??data.asset?.itemCount??null;this.nextCursor=data.nextCursor||null;this.nextOffset=!assetView&&number(data.nextOffset)?Number(data.nextOffset):null;
   this.truncated=!!data._truncated||list(data.assets).some(row=>row?._truncatedItems);this.categories=list(data.categories);this.libraryUrl=libraryMediaUrl(data.libraryUrl)||null;this.busy=false;this.render();return this.rows;
  }catch(error){if(generation!==this.generation)return this.rows;this.busy=false;this.error=error;if(assetView){this.nextCursor=null;this.nextOffset=null;this.truncated=true;}this.render();throw error;}
 }
 async loadProjectSamples({append=false,force=false}={}){
  const generation=++this.generation;this.busy=true;this.error=null;this.notice=null;this.unavailable=false;this.rows=[];this.nextCursor=null;this.nextOffset=null;this.render();
  let context=this.featureContext();if(context&&typeof context.then==='function')context=await context;if(generation!==this.generation)return this.rows;if(!context.failed)this.featureProject=context.project;
  const availability=this.viewFeature();if(context.failed||!availability.enabled||!availability.restMode){this.busy=false;this.unavailable=true;this.total=null;this.notice=availability.restMode?availability.reason:'Connect a Freestyle Studio API project to browse its samples.';this.render();return this.rows;}
  try{
   let snapshot=this.projectSamples.snapshot();if(force||!snapshot.context||!append&&!snapshot.rows.length)snapshot=await this.projectSamples.load();else if(append)snapshot=await this.projectSamples.loadMore();
   if(generation!==this.generation)return this.rows;const filters=this.filters(),query=(filters.search||'').toLowerCase();this.rows=snapshot.rows.filter(item=>(!query||`${item.name||''} ${list(item.tags).join(' ')}`.toLowerCase().includes(query))&&(!filters.category||item.libraryCategory===filters.category)&&(!filters.tag||list(item.tags).includes(filters.tag))).map(item=>({...item,projectId:snapshot.context.projectId,_projectSampleScope:JSON.stringify(snapshot.context)}));this.total=snapshot.total;this.nextCursor=snapshot.nextCursor;this.truncated=snapshot.truncated;this.busy=false;this.render();return this.rows;
  }catch(error){if(generation!==this.generation)return this.rows;this.busy=false;this.error=error;this.render();throw error;}
 }
 async addRegisteredSample(item,{projectId,project,targetPatternId}){
  const scope=structuredClone(this.projectSampleContext()),key=JSON.stringify([projectId,targetPatternId,item.id]);
  const guard=()=>{if(scope.projectId!==projectId||JSON.stringify(scope)!==JSON.stringify(this.projectSampleContext()))throw new Error('The project sample context changed. Return to its original project before adding it.');};guard();
  if(item.projectId!==projectId||item._projectSampleScope!==JSON.stringify(scope))throw new Error('This project sample belongs to a previous Browser context. Refresh Current project before adding it.');
  if(this.sampleAttachments.some(record=>record.key===key&&record.attempted&&record.status!=='attached'))throw new Error('This sample has an unconfirmed attachment. Inspect the target pattern before adding it again.');
  // Re-read canonical pages before attachment; a dragged row is never authority.
  let snapshot=await this.projectSamples.load();guard();let row;
  while(!(row=snapshot.rows.find(sample=>sample.id===item.id))&&snapshot.hasMore){snapshot=await this.projectSamples.loadMore();guard();}
  if(!row||row.audioFileId!==item.audioFileId)throw new Error('This registered sample changed or was removed. Refresh Current project before adding it.');
  const current=await this.projectContext();guard();if(current.projectId!==projectId||current.project.selectedPattern!==targetPatternId)throw new Error('The target pattern changed before adding the project sample.');
  const materialized=registeredProjectSampleSource(row.raw,projectId,{createId:this.idFactory}),record={key,attempted:false,status:'preparing'};this.sampleAttachments.push(record);
  const payload={projectId,targetPatternId,item,...materialized,guard};if(typeof this.onSampleMaterialized!=='function')throw new Error('The Channel Rack is unavailable.');
  try{guard();record.attempted=true;record.status='attaching';await this.onSampleMaterialized(payload);guard();record.status='attached';this.onStatus(`${materialized.source.name} added to the Channel Rack.`);return payload;}catch(error){record.status='attachment_unconfirmed';throw error;}
 }
 async projectContext(){const project=await this.getProject();const projectId=project?.cloud?.projectId||project?.projectId||project?.id;if(!projectId||projectId==='empty')throw new Error('Load or create a Freestyle cloud project before adding library content.');return {project,projectId};}
 async registerLibrarySound(item,{projectId,project,targetPatternId,attach=true}){
  const identity={projectId,targetPatternId,itemId:item.id},prior=this.registrationRecords.findLast(row=>JSON.stringify(row.identity)===JSON.stringify(identity)&&row.attempted&&!['attached','registered_only'].includes(row.status));
  if(prior)throw new Error('This sound has an unfinished registration or attachment. Inspect the project sample pool and target pattern before adding it again.');
  const scope=this.getRegistrationScope?structuredClone(this.getRegistrationScope()):null,entry={identity,status:'preparing',attempted:false,attachmentAttempted:false,idempotencyKey:this.idFactory(),request:null,result:null,error:null};this.registrationRecords.push(entry);if(this.registrationRecords.length>32)this.registrationRecords.shift();
  const guard=()=>{if(scope){if(scope.projectId!==projectId||JSON.stringify(scope)!==JSON.stringify(this.getRegistrationScope()))throw new Error('The project engine context changed. Any registered sample remains in its original project.');return;}const current=this.getFeatureProject();if(current&&typeof current.then==='function'){Promise.resolve(current).catch(()=>{});return;}if(current){const id=current.cloud?.projectId||current.projectId||current.id;if(id!==projectId)throw new Error('The sample belongs to the previous cloud project.');}};
  try{
   guard();if(item.canAdd===false)throw new Error(unavailableSoundReason(item));const selector=catalogPatternSampleSelector;
   const claimed=selector(item),assetId=item.assetId||item._packAssetId||item.packId;let source=claimed;
   if(assetId!==undefined){
    if(typeof assetId!=='string'||!assetId||assetId.length>128)throw new Error('Read the catalog asset that owns this sound before adding it.');let cursor,found=null;const cursors=new Set();
    for(let page=0;page<8;page++){
     guard();const result=await this.client.call('listCatalogPresetPackItems',{path:{asset_id:assetId},query:{limit:100,...(item.name?{q:String(item.name).slice(0,128)}:{}),...(cursor?{cursor}:{})}});guard();const data=result.data,pagination=data?.pagination;
     if(result.status!==200||!Array.isArray(data?.data)||!pagination||typeof pagination.hasMore!=='boolean'||pagination.hasMore&&(typeof pagination.nextCursor!=='string'||!pagination.nextCursor||pagination.nextCursor.length>512)||!pagination.hasMore&&pagination.nextCursor!==null)throw new Error('The catalog did not return a complete preset-pack page.');
     const matches=data.data.filter(row=>row?.id===item.id);if(matches.length>1)throw new Error('The catalog returned an ambiguous sound identity.');if(matches.length){found=matches[0];break;}if(!pagination.hasMore)break;if(cursors.has(pagination.nextCursor))throw new Error('The catalog cursor did not advance.');cursors.add(pagination.nextCursor);cursor=pagination.nextCursor;
    }
    if(!found||found.canAdd===false||found.mediaKind&&found.mediaKind!=='audio')throw new Error('This sound could not be confirmed in its accessible preset pack. No sample was registered.');source=selector(found);if(claimed&&JSON.stringify(claimed)!==JSON.stringify(source))throw new Error('The catalog sound registration identity changed. Read the library again before adding it.');entry.catalogSource=structuredClone(found);
   }
   // Forward the published handle unchanged. Generic row.id/rackId/relativePath
   // remain presentation metadata and are never decoded into a selector.
   if(!source)throw new Error('This catalog sound has no canonical registration identity yet. Preview remains available; a Freestyle API update is required to add it.');
   const current=await this.projectContext();guard();if(current.projectId!==projectId||targetPatternId&&targetPatternId!=='empty'&&current.project.selectedPattern!==targetPatternId)throw new Error('The target pattern changed before sound registration.');
   const body={...source,...(!Object.hasOwn(source,'name')&&item.name?{name:String(item.name).slice(0,80)}:{})};entry.request={operationId:'registerPatternSample',path:{project_id:projectId},body,idempotencyKey:entry.idempotencyKey};entry.status='registering';entry.attempted=true;this.onStatus(`Adding ${item.name||'sample'} to the Freestyle sample pool…`);
   const result=await this.client.call('registerPatternSample',{path:{project_id:projectId},body},{idempotencyKey:entry.idempotencyKey});entry.result=structuredClone(result);entry.status='registered';guard();
   if(![200,201].includes(result.status)||result.data?.projectId!==projectId)throw new Error('The registered sample project was not confirmed.');const materialized=materializedSampleSource(result.data,item);if(result.data.audioFileId!==materialized.source.audioFileId)throw new Error('Registration returned inconsistent canonical audio identities.');materialized.source={...structuredClone(materialized.sample),...materialized.source,id:this.idFactory(),rackId:this.idFactory()};
   const payload={projectId,targetPatternId,item,...materialized,registrationReceipt:result.data,guard};if(!attach){entry.status='registered_only';return payload;}if(typeof this.onSampleMaterialized==='function'){entry.attachmentAttempted=true;await this.onSampleMaterialized(payload);entry.status='attached';this.onStatus(`${materialized.source.name} added to the Channel Rack.`);}else this.onStatus(`${materialized.source.name} added to the cloud sample pool.`);return payload;
  }catch(error){entry.error=error.message;entry.errorStatus=error.status??null;entry.errorCode=error.code??null;entry.status=!entry.attempted?'not_sent':entry.result?'attachment_unconfirmed':error.status>=400&&error.status<500&&error.status!==408?'rejected':'registration_unconfirmed';throw error;}
 }
 /** Browser row -> one canonical stored sample of the current project for
  * Playlist placement. Catalog rows register through their published handle
  * (no Rack attachment); project-sample rows are re-read, never trusted. */
 async resolvePlacementSample(item){
  if(this.writeBusy)throw new Error('Wait for the current library operation to finish.');
  const registered=item?._libraryView==='project-samples';if(!item?.id||!registered&&(item.materializable===false||item.canAdd===false||item._libraryView==='audio'))throw new Error('This row cannot be placed on the Playlist. Use a playable sound returned by Sounds, a sound pack or Current project.');
  this.writeBusy=true;this.error=null;
  try{this.onWriteState(true);this.render();
   const {projectId,project}=await this.projectContext();this.featureProject=project;const availability=this.addAvailability(item);if(!availability.enabled)throw new Error(availability.reason||'This sound cannot be placed.');
   if(project.cloud?.rawState?.studioApi!==true)throw new Error('Playlist sample placement needs a Freestyle Studio API project.');
   if(registered){
    const scope=structuredClone(this.projectSampleContext()),guard=()=>{if(scope.projectId!==projectId||JSON.stringify(scope)!==JSON.stringify(this.projectSampleContext()))throw new Error('The project sample context changed. Return to its original project before placing it.');};guard();
    if(item.projectId!==projectId||item._projectSampleScope!==JSON.stringify(scope))throw new Error('This project sample belongs to a previous Browser context. Refresh Current project before placing it.');
    let snapshot=await this.projectSamples.load();guard();let row;while(!(row=snapshot.rows.find(sample=>sample.id===item.id))&&snapshot.hasMore){snapshot=await this.projectSamples.loadMore();guard();}
    if(!row||row.audioFileId!==item.audioFileId||typeof row.audioFileId!=='string'||!row.audioFileId)throw new Error('This registered sample changed or was removed. Refresh Current project before placing it.');
    return{projectId,audioFileId:row.audioFileId,name:String(row.name||item.name||'Sample'),registered:false,guard};
   }
   const payload=await this.registerLibrarySound(item,{projectId,project,targetPatternId:project.selectedPattern,attach:false});
   return{projectId,audioFileId:payload.source.audioFileId,name:payload.source.name,registered:true,registrationReceipt:payload.registrationReceipt,guard:payload.guard};
  }finally{this.writeBusy=false;try{this.onWriteState(false);}finally{this.render();}}
 }
 async addSound(item){
  if(this.writeBusy)return null;const registered=item?._libraryView==='project-samples';if(!item?.id||!registered&&(item.materializable===false||item.canAdd===false||item._libraryView==='audio'))throw new Error('This row cannot be materialized through the sound-pack API. Use a playable sound returned by Sounds or a sound pack.');
  this.writeBusy=true;this.error=null;
  try{this.onWriteState(true);this.render();
   const {projectId,project}=await this.projectContext(),targetPatternId=project.selectedPattern;this.featureProject=project;const availability=this.addAvailability(item);if(!availability.enabled)return this.quietUnavailable(availability);if(registered)return await this.addRegisteredSample(item,{projectId,project,targetPatternId});if(project.cloud?.rawState?.studioApi===true)return await this.registerLibrarySound(item,{projectId,project,targetPatternId});this.onStatus(`Adding ${item.name||'sample'} to the Freestyle sample pool…`);
   const result=await this.request('materialize_sound_pack_item',{project_id:projectId,item_id:item.id,...(item.name?{name:String(item.name).slice(0,255)}:{})});
   const materialized=materializedSampleSource(result,item),current=await this.projectContext();
   if(current.projectId!==projectId){const error=new Error('The sample was added to the previous cloud project. Return to that project to add it to a pattern.');error.projectId=projectId;error.result=result;throw error;}
   const payload={projectId,targetPatternId,item,...materialized};await this.onSampleMaterialized?.(payload);this.onStatus(`${materialized.source.name} added to the cloud sample pool.`);return payload;
  }finally{this.writeBusy=false;try{this.onWriteState(false);}finally{this.render();}}
 }
 async applyPattern(asset,{mode='pattern_and_sounds',targetPatternId,channelIds}={}){
  if(this.writeBusy)return null;if(!asset?.id)throw new Error('Choose a pattern returned by Freestyle.');if(!['pattern','sounds','pattern_and_sounds'].includes(mode))throw new Error('Choose a supported pattern import mode.');if(targetPatternId==='empty'||typeof targetPatternId==='string'&&targetPatternId.startsWith('local-'))throw new Error('Save and select a persisted cloud pattern before targeting it.');
  this.writeBusy=true;this.error=null;
  try{this.onWriteState(true);this.render();const {projectId,project}=await this.projectContext();this.featureProject=project;const availability=this.feature('library_apply_pattern',project);if(!availability.enabled)return this.quietUnavailable(availability);this.onStatus(`Applying ${asset.name||'pattern'} in Freestyle…`);const args={project_id:projectId,asset_id:asset.id,mode};if(targetPatternId&&targetPatternId!=='empty')args.target_pattern_id=targetPatternId;if(channelIds?.length)args.channel_ids=channelIds.slice(0,64);
   const result=await this.request('apply_marketplace_pattern',args),payload={projectId,asset,mode,targetPatternId,result};await this.onPatternApply?.(payload);this.onStatus('Pattern applied in the cloud project.');return payload;
  }finally{this.writeBusy=false;try{this.onWriteState(false);}finally{this.render();}}
 }
 async inspectAsset(asset){let context=this.featureContext();if(context&&typeof context.then==='function')context=await context;if(!context.failed)this.featureProject=context.project;if(context.failed&&!this.featureProject)return this.quietUnavailable({reason:'Connect a Freestyle project to inspect library assets.'});const availability=this.feature('library_asset_details');if(!availability.enabled)return this.quietUnavailable(availability);const assetType=asset.assetType||ASSET_TYPES[this.view];if(!assetType)throw new Error('This row is not a marketplace asset.');const data=await this.request('get_marketplace_asset',{asset_type:assetType,asset_id:asset.id,include_payload:false});this.detail=data.asset||asset;this.render();return data;}
 async preview(item){
  this.selectSound(item.id);const scope=this.soundScope(),generation=++this.previewGeneration;
  if(this.onPreview){const handled=await this.onPreview(item);if(generation!==this.previewGeneration||scope!==this.soundScope())return false;if(handled!==false){this.clearPreview();this.previewHandled={id:item.id,scope};this.previewPlayer?.refresh();return handled;}}
  const route=libraryPreviewRoute(item);
  if(route==='engine'&&typeof this.onAuditionSample==='function')return this.engineAudition(item,{scope,generation});
  if(route==='splice')return this.splicePreview(item,{scope,generation});
  if(route==='catalog'&&this.catalogPreview)return this.catalogSoundPreview(item,{scope,generation});
  // _playbackUrl: an already prepared URL (previewCatalogSound storage URL or an authenticated blob:).
  const prepared=typeof item._playbackUrl==='string'&&/^(https:|blob:)/.test(item._playbackUrl)?item._playbackUrl:null;
  const directUrl=prepared||libraryMediaUrl(item.previewUrl||item.audioUrl);if(!directUrl)throw new Error('Freestyle did not expose a playable preview URL for this library row.');
  if(this.previewId===item.id&&this.previewScope===scope&&this.audio&&!this.audio.error&&!this.previewPlaybackState?.failed){const state=this.previewPlaybackState;if(state)state.generation=generation;if(!this.audio.paused){this.audio.pause();this.render();return false;}if(state?.play)return state.play();}
  this.audio?.pause();let url=directUrl;
  // A hover/pointerdown warm-up (warmPreview) already resolved the playable URL, and for short sounds
  // holds the bytes: start inside the click with nothing to await (Default SoundLibrary parity).
  const warmed=this.mediaCache.get(directUrl);
  if(warmed)url=warmed.blobUrl||warmed.url;
  else if(this.prepareMedia&&!prepared){try{url=await this.prepareMedia(directUrl,item);}catch(error){if(generation!==this.previewGeneration||scope!==this.soundScope())return false;throw error;}}
  if(generation!==this.previewGeneration||scope!==this.soundScope())return false;
  if(typeof url!=='string'||!url.trim())throw new Error('The cloud media bridge did not return a playback URL.');
  try{const parsed=new URL(url,globalThis.location?.origin||'http://localhost');if(!['http:','https:','blob:'].includes(parsed.protocol)||url.startsWith('//'))throw new Error();}catch{throw new Error('The cloud media bridge returned an invalid playback URL.');}
  // Preserve same-origin opaque bridge paths; they are not paths on freestyle.audio.
  const audio=this.audioFactory();this.audio=audio;audio.preload='auto';audio.controls=true;this.applyPreviewVolume(audio);audio.loop=this.previewLoop;audio.src=url;this.previewId=item.id;this.previewName=item.name||'Preview';this.previewScope=scope;this.previewHandled=null;
  // The play rejection and media error event can describe the same failed GET.
  // Share one optional diagnostic; successful previews make no extra request.
  const state={generation,failed:false,confirmed:false,current:()=>state.generation===this.previewGeneration&&scope===this.soundScope()&&this.audio===audio,reported:false,promise:null};this.previewPlaybackState=state;
  const failure=error=>{
   if(!state.current())return Promise.resolve(null);
   state.failed=true;state.confirmed=false;if(!state.promise){try{audio.pause();}catch{}}this.previewPlayer?.refresh();
   if(!state.promise)state.promise=(async()=>{let resolved=error;if(typeof this.inspectMediaError==='function'){try{const detail=await this.inspectMediaError(url,error),message=detail instanceof Error?detail.message:detail;if(typeof message==='string'&&message.trim()&&message.length<=2048)resolved=detail instanceof Error?detail:new Error(message.trim());}catch{}}
    if(!state.current())return null;this.previewErrorStates.set(resolved,state);return resolved;})();return state.promise;
  };
  audio.onended=()=>{if(state.current()){state.confirmed=false;this.render();}};audio.onerror=async()=>{const error=await failure(new Error('Freestyle could not stream this library preview. The returned media route may require native Freestyle media authorization.'));if(error&&state.current()&&!state.reported){state.reported=true;this.reportError(error);}};
  state.play=async()=>{const playingGeneration=state.generation;try{const playing=audio.play();this.previewPlayer?.refresh();await playing;if(playingGeneration!==this.previewGeneration||!state.current()){if(this.audio!==audio||state.generation===playingGeneration)audio.pause();return false;}if(state.failed)return false;state.confirmed=true;this.render();return true;}catch(error){if(playingGeneration!==this.previewGeneration||!state.current())return false;const diagnosed=await failure(new Error(`Freestyle preview playback is unavailable. ${error?.message||'Check media authorization.'}`));if(!diagnosed||!state.current())return false;throw diagnosed;}};
  return state.play();
 }
 /** Sound Library row → (registered once per project) → live-engine audition.
  * Logs click → acknowledged audition (the engine starts the one-shot on the
  * monitor stream when it acknowledges). */
 async engineAudition(item,{scope,generation}){
  const started=globalThis.performance?.now?.()??Date.now(),elapsed=()=>Math.round((globalThis.performance?.now?.()??Date.now())-started);
  const current=()=>generation===this.previewGeneration&&scope===this.soundScope();
  this.clearPreview();let audioFileId=null,registered=false,registerMs=null,projectId=null;
  try{
   const context=await this.projectContext();projectId=context.projectId;if(!current())return false;
   const key=projectId+'\u0000'+item.id;audioFileId=item._libraryView==='project-samples'?item.audioFileId:this.auditionedSamples.get(key)??null;
   if(!audioFileId){this.onStatus(`Preparing ${item.name||'sound'} for preview…`);const resolved=await this.resolvePlacementSample(item);registerMs=elapsed();audioFileId=resolved.audioFileId;registered=resolved.registered===true;this.auditionedSamples.set(key,audioFileId);if(!current())return false;}
   await this.onAuditionSample({projectId,audioFileId,item});if(!current())return false;
   this.previewHandled={id:item.id,scope};this.previewName=item.name||'Preview';this.previewPlayer?.refresh();this.render();
   clientLog('library-preview-timing',{route:'engine',clickToAuditionAckMs:elapsed(),registered,registerMs,cached:registerMs===null});
   return true;
  }catch(error){clientLog('library-preview-timing',{route:'engine',failed:true,ms:elapsed(),code:error?.code??null,status:error?.status??null});throw error;}
 }
 /** Freestyle #16: Sound Library row → previewCatalogSound → previewUrl. previewRequiresAuth:false is a short-lived
  * storage URL played with no credentials; true is the streamCatalogSoundPreview API path, fetched through the host's
  * apiFetch (it adds the bearer) into a blob: URL. 429 answers with Retry-After: the button says when to try again. */
 async catalogSoundPreview(item,{scope,generation}){
  const started=globalThis.performance?.now?.()??Date.now(),current=()=>generation===this.previewGeneration&&scope===this.soundScope();
  if(this.previewRetryAt&&Date.now()<this.previewRetryAt)throw Object.assign(new Error(`Freestyle’s preview limit is reached. Try again in ${Math.ceil((this.previewRetryAt-Date.now())/1000)} s.`),{code:'rate_limited'});
  const cached=this.catalogPreviewUrls.get(item.id);let url=cached&&cached.expiresAt>Date.now()+5000?cached.url:null,requiresAuth=cached?.requiresAuth??null,requestId=null;
  if(!url){
   let result;try{result=await this.client.call('previewCatalogSound',{path:{item_id:item.id}});}
   catch(error){
    if(error?.status===429){const wait=Number(error.retryAfter);this.previewRetryAt=Date.now()+(Number.isFinite(wait)&&wait>0?wait*1000:5000);clientLog('library-preview-timing',{route:'catalog',status:429,retryAfterSec:Number.isFinite(wait)?wait:null,requestId:error.requestId??null});throw Object.assign(new Error(`Freestyle’s preview limit is reached. Try again in ${Number.isFinite(wait)&&wait>0?Math.ceil(wait):5} s.`),{code:'rate_limited',status:429});}
    clientLog('library-preview-timing',{route:'catalog',failed:true,status:error?.status??null,code:error?.code??null,requestId:error?.requestId??null});throw error;
   }
   if(!current())return false;
   const data=result?.data||{};requiresAuth=data.previewRequiresAuth===true;requestId=result?.data?.requestId??null;
   if(typeof data.previewUrl!=='string'||!data.previewUrl)throw new Error('Freestyle did not return a preview for this sound.');
   if(requiresAuth){
    const host=freestyleHost?.();if(typeof host?.apiFetch!=='function')throw new Error('This sound needs an authorized preview stream, which needs the Freestyle host.');
    const path=data.previewUrl.replace(/^https?:\/\/[^/]+/,'');const response=await host.apiFetch(path,{method:'GET',headers:{Accept:'audio/*'}});
    if(response.status===429){const wait=Number(response.headers.get('retry-after'));this.previewRetryAt=Date.now()+(Number.isFinite(wait)&&wait>0?wait*1000:5000);throw Object.assign(new Error(`Freestyle’s preview limit is reached. Try again in ${Number.isFinite(wait)&&wait>0?Math.ceil(wait):5} s.`),{code:'rate_limited',status:429});}
    if(!response.ok)throw Object.assign(new Error(`Freestyle could not stream this preview (HTTP ${response.status}).`),{status:response.status});
    const blob=await response.blob();if(!current())return false;url=URL.createObjectURL(blob);
   }else{if(!/^https:\/\//.test(data.previewUrl))throw new Error('Freestyle returned a preview URL that is not HTTPS.');url=data.previewUrl;}
   const expiresAt=Date.parse(data.expiresAt)||Date.now()+Math.max(10,Number(data.expiresInSec)||300)*1000;
   const old=this.catalogPreviewUrls.get(item.id);if(old?.url?.startsWith('blob:'))try{URL.revokeObjectURL(old.url);}catch{}
   this.catalogPreviewUrls.set(item.id,{url,requiresAuth,expiresAt:requiresAuth?Date.now()+30*60000:expiresAt});
   while(this.catalogPreviewUrls.size>24){const [key,value]=this.catalogPreviewUrls.entries().next().value;this.catalogPreviewUrls.delete(key);if(value.url.startsWith('blob:'))try{URL.revokeObjectURL(value.url);}catch{}}
  }
  // The URL is a bearer secret: never logged.
  const played=await this.preview({...item,_playbackUrl:url,_catalogPreview:true});
  clientLog('library-preview-timing',{route:'catalog',requiresAuth,cached:!!cached,clickToPlayMs:Math.round((globalThis.performance?.now?.()??Date.now())-started),played:played===true,requestId});
  return played;
 }
 /** Live's Browser Preview (headphone) switch: on, selecting a sound previews it. */
 setAutoPreview(on){this.autoPreview=!!on;try{globalThis.localStorage?.setItem('disabelton:browser-preview',this.autoPreview?'1':'0');}catch{}return this.autoPreview;}
 /** Splice row → short-lived credential-free CDN URL → the preview element. */
 async splicePreview(item,{scope,generation}){
  const started=globalThis.performance?.now?.()??Date.now(),soundId=item.spliceSoundId??item.splice_sound_id??item.id;
  const result=await this.client.call('previewCatalogSpliceSound',{path:{sound_id:soundId}});if(generation!==this.previewGeneration||scope!==this.soundScope())return false;
  const data=result?.data,url=libraryMediaUrl(data?.url??data?.previewUrl??data?.preview_url);if(!url||!url.startsWith('https://'))throw new Error('Splice did not return a playable preview URL for this sound.');
  const played=await this.preview({...item,previewUrl:url,audioUrl:url,spliceSoundId:undefined,splice_sound_id:undefined,provider:undefined,source:undefined,_splicePreview:true});
  clientLog('library-preview-timing',{route:'splice',clickToPlayMs:Math.round((globalThis.performance?.now?.()??Date.now())-started),played:played===true});
  return played;
 }
 favoriteKey(item){return item?._libraryView==='project-samples'?`project:${item.projectId||''}:${item.id}`:`catalog:${item?.id}`;}
 isFavorite(item){return!!item?.id&&this.favorites.has(this.favoriteKey(item));}
 toggleFavorite(item){if(!item?.id)return false;const key=this.favoriteKey(item),next=!this.favorites.has(key);if(next)this.favorites.add(key);else this.favorites.delete(key);try{this.favoriteStore?.write?.([...this.favorites]);}catch{}this.render();return next;}
 setFavoritesOnly(value=!this.favoritesOnly){this.favoritesOnly=!!value;this.render();return this.favoritesOnly;}
 keywordState(){
  const categories=[],seen=new Set();for(const entry of this.categories){const label=keywordLabel(entry),value=keywordValue(entry);if(!label||!value||seen.has(value.toLowerCase()))continue;seen.add(value.toLowerCase());categories.push({label,value});if(categories.length>=18)break;}
  if(this.category&&!seen.has(this.category.toLowerCase())){categories.push({label:this.category,value:this.category});seen.add(this.category.toLowerCase());}
  if(!this.tag&&!this.busy&&this.rows.length)this.keywordTags=topTags(this.rows.filter(row=>row._rowKind!=='asset'),seen);
  const tags=this.keywordTags.filter(tag=>!seen.has(tag.toLowerCase()));if(this.tag&&!tags.includes(this.tag))tags.push(this.tag);return{categories,tags};
 }
 keywordGrid(){
  const grid=node('div',null,'logic-keyword-grid');grid.setAttribute('role','group');grid.setAttribute('aria-label','Loop keywords');const {categories,tags}=this.keywordState();
  const key=(label,pressed,title,handler,kind,value)=>{const b=button(label,title,handler,'logic-keyword');b.setAttribute('aria-pressed',String(pressed));b.dataset.libraryKeyword=kind;if(value!=null)b.dataset.keywordValue=value;if(kind!=='favorites'&&kind!=='reset')b.disabled=this.unavailable;grid.append(b);return b;};
  const reset=key('Reset',false,'Clear keyword filters',()=>{this.favoritesOnly=false;if(this.category||this.tag)return this.execute(()=>this.setFilters({category:'',tag:''}));this.render();},'reset');reset.disabled=!this.category&&!this.tag&&!this.favoritesOnly;
  key('Favorites',this.favoritesOnly,'Show only loops marked as favourites',()=>this.setFavoritesOnly(),'favorites');
  for(const {label,value}of categories)key(label,this.category===value,`Category: ${label}`,()=>this.execute(()=>this.setFilters({category:this.category===value?'':value})),'category',value);
  for(const tag of tags)key(tag,this.tag===tag,`Keyword: ${tag}`,()=>this.execute(()=>this.setFilters({tag:this.tag===tag?'':tag})),'tag',tag);
  return grid;
 }
 render(){
  if(!this.mounted||!this.container)return;
  const active=this.container.ownerDocument.activeElement,focused=active?.closest?.('.library-sound-name'),restoreId=focused&&this.container.contains(focused)&&this.soundSelectionScope===this.soundScope()?focused.closest('.library-sound-row')?.dataset.librarySoundId:null;this.syncSoundSelection();
  const segment=librarySegment(this.view),shell=node('div',null,'library-shell logic-library');shell.dataset.librarySegment=segment;
  const scope=node('div',null,'logic-browser-scope library-heading'),scopes=node('div',null,'logic-browser-scopes');scopes.setAttribute('role','group');scopes.setAttribute('aria-label',segment==='files'?'File locations':segment==='library'?'Library locations':'Loop locations');
  if(this.view==='pack')scope.append(button('‹','Back to sound packs',()=>this.execute(()=>this.open('packs')),'logic-browser-back'));
  for(const [view,label]of SEGMENT_SCOPES[segment]){const active=this.view===view||this.view==='pack'&&view==='packs',b=button(label,view==='project-samples'?'Browse samples in the current project':`Browse ${label.toLowerCase()}`,()=>this.execute(()=>this.open(view)),active?'active':'');b.setAttribute('aria-pressed',String(active));const availability=this.viewFeature(view);b.disabled=this.writeBusy||!availability.enabled;if(!availability.enabled){b.title=availability.reason;b.setAttribute('aria-description',availability.reason);}b.dataset.libraryView=view;scopes.append(b);}
  scope.append(scopes);if(segment==='files'){const favorites=button('★','Show only files marked as favourites',()=>this.setFavoritesOnly(),'logic-favorites-filter');favorites.setAttribute('aria-pressed',String(this.favoritesOnly));scope.append(favorites);}scope.append(button('↻','Refresh cloud library',()=>this.execute(()=>this.refresh()),'logic-browser-refresh'));shell.append(scope);
  if(this.view==='pack')shell.append(node('div',this.pack?.name||'Loop pack','logic-browser-crumb'));
  if(segment==='loops'&&!this.unavailable)shell.append(this.keywordGrid());
  const filters=node('details',null,'library-filter-panel'),summary=node('summary','Filters');filters.append(summary);const row=node('div',null,'library-filters');for(const [key,label]of [['category','Category'],['tag','Tag']]){const input=node('input');input.placeholder=label;input.setAttribute('aria-label',`Library ${label.toLowerCase()}`);input.maxLength=64;input.disabled=this.unavailable;input.value=this[key];input.onchange=()=>this.execute(()=>this.setFilters({[key]:input.value}));row.append(input);}filters.append(row);shell.append(filters);
  if(this.searchInput){this.searchInput.disabled=this.unavailable;this.searchInput.title=this.unavailable?this.notice||'Library view unavailable':'';}
  const count=node('div',this.busy?'Reading Freestyle…':`${this.rows.length}${this.total!=null?` / ${this.total}`:''} ${ASSET_TYPES[this.view]?'asset':'sound'}${(this.total??this.rows.length)===1?'':'s'}`,'library-count');count.setAttribute('role','status');if(!this.unavailable)shell.append(count);
  if(this.notice){const notice=node('div',this.notice,'library-message library-unavailable');notice.setAttribute('role','status');if(this.unavailable){const navigation=node('div',null,'library-unavailable-navigation');for(const [view,label]of [['packs','Your packs'],['patterns','Your patterns'],['plugins','Your plugins']]){const availability=this.viewFeature(view);if(availability.enabled)navigation.append(button(label,`Browse your ${view}`,()=>this.execute(()=>this.open(view))));}navigation.append(button('Import audio','Import a local audio file',()=>this.onImportAudio()));notice.append(navigation);}shell.append(notice);}
  if(this.error){const error=node('div',this.error.message,'library-message library-error');error.append(button('Retry','Retry the library read',()=>this.execute(()=>this.refresh())));shell.append(error);}
  const visible=this.favoritesOnly?this.rows.filter(item=>item._rowKind!=='asset'&&this.isFavorite(item)):this.rows;
  if(visible.length&&visible.some(item=>item._rowKind!=='asset')){const columns=node('div',null,'logic-browser-columns');columns.setAttribute('aria-hidden','true');columns.append(node('span','Name','logic-column-name'),node('span',segment==='loops'?'Beats':'Length','logic-column-length'),node('span','★','logic-column-favorite'));shell.append(columns);}
  const items=node('div',null,'library-rows');for(const item of visible)items.append(item._rowKind==='asset'?this.assetRow(item):this.soundRow(item));shell.append(items);
  if(this.favoritesOnly&&this.rows.length&&!visible.length&&!this.busy)shell.append(node('div','No favourites in this list. Click ☆ on a row to mark one.','library-message'));
  if(!this.rows.length&&!this.busy&&!this.error&&!this.unavailable)shell.append(node('div',this.search?'No matching cloud sounds or assets.':'No items were returned from this Freestyle library.','library-message'));
  if(this.truncated)shell.append(node('div',this.view==='project-samples'?'The project sample list is incomplete. Refresh before continuing.':'Freestyle returned a partial asset list. Global sound search still pages through all accessible sounds.','library-message'));
  if(this.nextCursor||this.nextOffset!=null){const more=button(this.busy?'Loading…':'Load more','Read the next cloud library page',()=>this.execute(()=>this.more()),'library-more');more.disabled=this.busy;shell.append(more);}
  if(this.detail)shell.append(this.assetDetail(this.detail));
  if(!this.previewPlayer&&this.audio&&this.previewId){const player=node('div',null,'library-preview');player.append(node('span',this.previewName));if(this.audio.nodeType)player.append(this.audio);shell.append(player);}
  this.container.replaceChildren(shell);this.paintSoundSelection();if(restoreId&&this.selectedSoundId===restoreId)this.selectSound(restoreId,{focus:true});
 }
 soundRow(item,{registered=false}={}){
  if(item._libraryView==='project-samples'&&!registered)return this.projectSampleRow(item);
  const row=node('div',null,'library-sound-row');row.dataset.librarySoundId=item.id;row.addEventListener('pointerenter',()=>this.warmPreview(item));row.addEventListener('pointerdown',()=>this.warmPreview(item));const addAvailability=this.addAvailability(item);row.draggable=!!item.materializable&&addAvailability.enabled;row.ondragstart=event=>{if(!item.materializable||this.writeBusy||!addAvailability.enabled){event.preventDefault();return;}writeLibraryDragData(event.dataTransfer,{id:item.id,name:item.name,_libraryView:item._libraryView,materializable:item.materializable,canAdd:item.canAdd,...(item.assetId?{assetId:item.assetId}:{}),...(item._packAssetId?{_packAssetId:item._packAssetId}:{}),...(item.audioFileId?{audioFileId:item.audioFileId}:{}),...(item.audio_file_id?{audio_file_id:item.audio_file_id}:{}),...(item.preset_pack_item_id?{preset_pack_item_id:item.preset_pack_item_id}:{}),...(item.sound_pack_item_id?{sound_pack_item_id:item.sound_pack_item_id}:{}),...(item.catalog_sound_id?{catalog_sound_id:item.catalog_sound_id}:{}),...(Object.prototype.hasOwnProperty.call(item,'register')?{register:item.register}:{})});};row.title=[item.name,item.bpm?`${item.bpm} BPM`:null,item.key,list(item.tags).join(', ')].filter(Boolean).join(' · ');
  const playable=!!item.previewUrl||!!this.onPreview;const play=button('',`Preview ${item.name}`,()=>this.previewSoundRow(item),'library-preview-button');play.innerHTML=studioIcon(this.isPreviewPlaying(item.id)?'pause':'play');play.setAttribute('aria-label',`Preview ${item.name||'sound'}`);play.disabled=!playable;row.append(play);
  const copy=node('div',null,'library-sound-copy'),label=button(item.name||'Unnamed sound',this.autoPreview?'Preview this cloud sound':'Select this cloud sound (Preview is off: ▶ previews it)',()=>this.autoPreview?this.previewSoundRow(item):this.selectSound(item.id),'library-sound-name');label.disabled=!playable;copy.append(label);const metadata=libraryRowMetadata(item);if(metadata){const subtitle=node('small',metadata,'library-sound-meta');subtitle.title=metadata;copy.append(subtitle);}row.append(copy);
  const length=node('span',null,'logic-browser-length'),lengthLabel=libraryLengthLabel(item);if(lengthLabel){const cell=node('small',lengthLabel.text,'library-sound-duration');cell.title=lengthLabel.title;if(lengthLabel.beats)cell.dataset.unit='beats';length.append(cell);}row.append(length);
  const favorite=this.isFavorite(item),star=button(favorite?'★':'☆',`${favorite?'Remove':'Mark'} ${item.name||'sound'} ${favorite?'from':'as a'} favourite`,()=>this.toggleFavorite(item),'library-favorite');star.setAttribute('aria-pressed',String(favorite));star.setAttribute('aria-label',`Favourite ${item.name||'sound'}`);row.append(star);
  if(item.materializable){const add=button('+',`Add ${item.name} to the current cloud sample pool`,()=>this.execute(()=>this.addSound(item)),'library-add');add.disabled=this.writeBusy||!addAvailability.enabled;if(!addAvailability.enabled)add.title=addAvailability.reason;row.append(add);}else if(item._rowKind==='audio')row.append(node('span','·','library-readonly'));
  return row;
 }
 projectSampleRow(item){
  const row=this.soundRow(item,{registered:true}),availability=this.addAvailability(item);row.draggable=availability.enabled&&!this.writeBusy;
  row.ondragstart=event=>{if(!availability.enabled||this.writeBusy){event.preventDefault();return;}writeLibraryDragData(event.dataTransfer,{id:item.id,name:item.name,_libraryView:'project-samples',projectId:item.projectId,audioFileId:item.audioFileId,_projectSampleScope:item._projectSampleScope,canReuse:item.canReuse});};
  const add=button('+',`Add ${item.name||'sample'} to the Channel Rack`,()=>this.execute(()=>this.addSound(item)),'library-add');add.disabled=this.writeBusy||!availability.enabled;if(!availability.enabled)add.title=availability.reason;row.append(add);return row;
 }
 assetRow(asset){
  const row=node('div',null,'library-asset-row'),assetType=asset.assetType||ASSET_TYPES[this.view],isPattern=assetType==='pattern',isPack=assetType==='sound_pack';
  const openAvailability=this.feature(isPack?'library_pack_items':'library_asset_details'),detailAvailability=this.feature('library_asset_details'),applyAvailability=this.feature('library_apply_pattern');
  const gate=(control,availability)=>{if(!availability.enabled){control.disabled=true;control.title=availability.reason;control.setAttribute('aria-description',availability.reason);}return control;};
  const source=button('',asset.name||'Cloud asset',()=>this.execute(()=>isPack?this.openPack(asset):this.inspectAsset(asset)),'library-folder-icon');source.innerHTML=studioIcon(isPattern?'piano':isPack?'document':'cloud');source.setAttribute('aria-label',asset.name||'Cloud asset');row.append(gate(source,openAvailability));
  const copy=node('div',null,'library-asset-copy');copy.append(gate(button(asset.name||'Unnamed asset',isPack?'Open this sound pack':'Inspect this asset',()=>this.execute(()=>isPack?this.openPack(asset):this.inspectAsset(asset)),'library-asset-name'),openAvailability));const metadata=libraryRowMetadata(asset);if(metadata){const subtitle=node('small',metadata,'library-asset-meta');subtitle.title=metadata;copy.append(subtitle);}row.append(copy);
  const count=asset.soundPack?.itemCount??asset.capabilities?.soundCount;if(count!=null)row.append(node('small',String(count)));
  if(isPattern){const add=button('+','Create a cloud pattern with its sounds',()=>this.execute(()=>this.applyPattern(asset)),'library-add');add.disabled=this.writeBusy||asset.capabilities?.importPattern===false;row.append(gate(add,applyAvailability));}else row.append(gate(button('i','Read asset details',()=>this.execute(()=>this.inspectAsset(asset)),'library-info'),detailAvailability));
  if(this.featureProject?.cloud?.rawState?.studioApi===true){const url=libraryMediaUrl(asset.url);if(url){const link=node('a','Open ↗','library-external');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.title='Open this asset in Freestyle';row.append(link);}}
  return row;
 }
 assetDetail(asset){
  const details=node('section',null,'library-asset-detail');const heading=node('div',null,'library-detail-heading');heading.append(node('strong',asset.name||'Asset'),button('×','Close asset details',()=>{this.detail=null;this.render();}));details.append(heading);if(asset.description)details.append(node('p',asset.description));
  if(asset.assetType==='pattern'){
   const mode=node('select');mode.setAttribute('aria-label','Pattern import mode');for(const [value,label]of [['pattern_and_sounds','Pattern + sounds'],['pattern','Pattern events only'],['sounds','Sounds only']]){const option=node('option',label);option.value=value;mode.append(option);}details.append(mode);
   const target=node('label',null,'library-current-target'),check=node('input');check.type='checkbox';target.append(check,document.createTextNode(' Use selected pattern'));details.append(target);
   const apply=button('Apply in Freestyle','Apply this asset with the selected mode',()=>this.execute(async()=>{const {project}=await this.projectContext();let id;if(check.checked){id=project.selectedPattern;if(!id||id==='empty')throw new Error('Select a persisted cloud pattern first.');}return this.applyPattern(asset,{mode:mode.value,targetPatternId:id});}),'library-apply');const availability=this.feature('library_apply_pattern');apply.disabled=this.writeBusy||asset.capabilities?.importPattern===false||!availability.enabled;if(!availability.enabled)apply.title=availability.reason;details.append(apply);
  }
  const url=libraryMediaUrl(asset.url);if(url){const link=node('a','Open in Freestyle ↗');link.href=url;link.target='_blank';link.rel='noopener noreferrer';details.append(link);}return details;
 }
 destroy(){clearTimeout(this.searchTimer);this.projectSamples.destroy();this.generation++;this.previewGeneration++;this.previewPlayer?.destroy();this.previewPlayer=null;this.clearPreview();if(this.keyListener)this.container?.removeEventListener('keydown',this.keyListener);if(this.focusListener)this.container?.removeEventListener('focusin',this.focusListener);if(this.searchInput&&this.searchListener)this.searchInput.removeEventListener('input',this.searchListener);if(this.searchInput){this.searchInput.disabled=false;this.searchInput.title='';}this.mounted=false;this.container?.classList.remove('cloud-library-browser');}
}
