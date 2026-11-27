/** Compact Freestyle Sound Library browser. Deterministic REST catalog dispatch. */
import {StudioApiClient,STUDIO_API_OPERATIONS} from './studio-api-client.js';
import {studioApiFeatureAvailability} from './studio-api-features.js';
import {catalogPatternSampleSelector} from './cloud-pattern-sample-registration.js';
import {LibraryPreviewPlayer} from './library-preview-player.js';
import {waveformPeaks,presetNames,findLanePlugin} from './library-waveform.js';
import {studioIcon} from './studio-icons.js';
import {ProjectSampleLibrary,registeredProjectSampleSource} from './project-sample-library.js';
import {clientLog} from './client-diagnostics.js';
import {applyWithUndo,restoreBody} from './plugin-state-undo.js';
import {hostFetch,freestyleOrigin,freestyleHost} from './freestyle-host-transport.js';
/** Browser "Recent" folder: last 20 previewed or used sounds (localStorage, try/catch everywhere). */
export const BROWSER_RECENT_KEY='vegetable:browser-recent';
export const BROWSER_RECENT_LIMIT=20;
const RECENT_FIELDS=['id','name','previewUrl','audioUrl','durationSec','_libraryView','audioFileId','materializable','canAdd','provider','source','spliceSoundId','projectId','_projectSampleScope','canReuse'];
function recentKey(entry){return `${entry._libraryView??''}\u0000${entry.id}`;}
function browserStorage(){try{return globalThis.localStorage||null;}catch{return null;}}
/** Keeps only the fields a Recent row needs to preview or re-add the sound; null for rows that cannot be recalled. */
export function recentSoundEntry(item){if(!item||typeof item!=='object'||!item.id||item._rowKind==='asset')return null;const entry={};for(const key of RECENT_FIELDS)if(item[key]!=null)entry[key]=item[key];return entry;}
/** Newest first, one entry per sound, capped at the limit. */
export function recordRecentSound(list,item,limit=BROWSER_RECENT_LIMIT){const current=Array.isArray(list)?list:[],entry=recentSoundEntry(item);if(!entry)return current.slice(0,limit);const key=recentKey(entry);return [entry,...current.filter(other=>other&&other.id&&recentKey(other)!==key)].slice(0,limit);}
export function readRecentSounds(storage=browserStorage()){try{const parsed=JSON.parse(storage?.getItem(BROWSER_RECENT_KEY)||'[]');return Array.isArray(parsed)?parsed.filter(entry=>entry&&typeof entry==='object'&&entry.id).slice(0,BROWSER_RECENT_LIMIT):[];}catch{return [];}}
export function writeRecentSounds(list,storage=browserStorage()){try{storage?.setItem(BROWSER_RECENT_KEY,JSON.stringify(list.slice(0,BROWSER_RECENT_LIMIT)));}catch{}}
/** Current project sub-folder rows. `raw` is the project object, handed back to the app's editor callbacks. */
export function automationEnvelopeRows(envelopes){const kinds={clip_gain:'Volume',lane_volume:'Volume',lane_pan:'Pan'};return(Array.isArray(envelopes)?envelopes:[]).filter(e=>e&&e.clipId!=null&&!e.deleted).map(e=>({id:`${e.clipId}|${e.targetKey??''}`,name:String(e.target?.name||kinds[e.target?.kind]||e.targetKey||'Automation'),raw:e}));}
export function currentProjectFolders(project,{channels:shown}={}){if(!project||typeof project!=='object')return{patterns:[],channels:[],automation:[]};const named=(rows,fallback)=>(Array.isArray(rows)?rows:[]).filter(row=>row&&row.id!=null).map(row=>({id:row.id,name:String(row.name||fallback),raw:row}));return{patterns:named(project.patterns,'Pattern'),channels:named(Array.isArray(shown)?shown:project.channels,'Channel'),automation:named([...(Array.isArray(project.clips)?project.clips:[]),...(Array.isArray(project.audioClips)?project.audioClips:[])],'Clip')};}
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
 constructor({container,searchInput,previewContainer=null,getRackChannels=null,getProject=()=>null,getFeatureProject=getProject,featureOperations,client=new StudioApiClient(),getRegistrationScope=null,idFactory=()=>globalThis.crypto.randomUUID(),call=defaultCall,onPatternApply,onSampleMaterialized,onPreview,onAuditionSample=null,prepareMedia,inspectMediaError=null,onImportAudio,onWriteState=()=>{},onError=()=>{},onStatus=()=>{},audioFactory,monitor=null,getMixerLane=()=>null,onPluginPresetApplied=()=>{},getPresetHistory=()=>null,getMixerEffects=()=>[],onSelectPattern=null,onSelectChannel=null,onOpenAutomation=null,onOpenMixerEffect=null,getAutomationEnvelopes=()=>[],catalogPreviews=false}={}){
  this.catalogPreviews=catalogPreviews===true;this.catalogPreviewBlockedUntil=0;
  this.container=typeof container==='string'?globalThis.document?.querySelector(container):container??globalThis.document?.querySelector('#browser-tree');
  this.searchInput=typeof searchInput==='string'?globalThis.document?.querySelector(searchInput):searchInput;
  this.previewContainer=typeof previewContainer==='string'?globalThis.document?.querySelector(previewContainer):previewContainer;this.previewLoop=false;this.previewVolume=1;
  this.getRackChannels=getRackChannels;this.getProject=getProject;this.getFeatureProject=getFeatureProject;this.featureOperations=featureOperations;this.client=client;this.getRegistrationScope=getRegistrationScope;this.idFactory=idFactory;this.registrationRecords=[];this.featureProject=null;this.unavailable=false;this.notice=null;this.onImportAudio=onImportAudio||(()=>globalThis.document?.querySelector('#import-audio')?.click());this.call=call;this.onPatternApply=onPatternApply;this.onSampleMaterialized=onSampleMaterialized;this.onPreview=onPreview;this.onAuditionSample=onAuditionSample;this.auditionedSamples=new Map();this.prepareMedia=prepareMedia;this.inspectMediaError=inspectMediaError;this.previewErrorStates=new WeakMap();this.onWriteState=onWriteState;this.onError=onError;this.onStatus=onStatus;this.audioFactory=audioFactory||(()=>new Audio());this.getMixerLane=getMixerLane;this.onPluginPresetApplied=onPluginPresetApplied;this.getPresetHistory=getPresetHistory;this.getMixerEffects=getMixerEffects;this.onSelectPattern=onSelectPattern;this.onSelectChannel=onSelectChannel;this.onOpenAutomation=onOpenAutomation;this.getAutomationEnvelopes=getAutomationEnvelopes;this.onOpenMixerEffect=onOpenMixerEffect;this.projectFoldersOpen=new Set();this.recentOpen=true;this.pluginCatalog=null;this.pluginCatalogBusy=false;this.pluginCatalogError=null;this.pluginPresetState=new Map();this.presetsOpen=false;this.presetsOpenId=null;this.presetApplying=false;this.waveToken=0;
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
   if(!item||libraryPreviewRoute(item)!=='direct'||this.usesCatalogPreview(item))return;
   const direct=libraryMediaUrl(item.previewUrl||item.audioUrl);if(!direct||this.mediaCache.has(direct)||this.mediaWarming.has(direct))return;
   this.mediaWarming.add(direct);
   Promise.resolve(this.prepareMedia?this.prepareMedia(direct,item):direct).then(async url=>{
    if(typeof url!=='string'||!url)return;
    const entry={url};this.mediaCache.set(direct,entry);
    while(this.mediaCache.size>48){const [key,old]=this.mediaCache.entries().next().value;this.mediaCache.delete(key);if(old.blobUrl)try{URL.revokeObjectURL(old.blobUrl);}catch{}}
    const duration=Number(item.durationSec);if(!(duration>0&&duration<=30)||url.startsWith('blob:'))return;
    const response=await fetch(url,{credentials:'same-origin',cache:'force-cache'});if(!response.ok)return;
    const blob=await response.blob();if(!blob.size||blob.size>16*1024*1024||!this.mediaCache.has(direct))return;
    entry.blobUrl=URL.createObjectURL(blob);entry.blob=blob;
   }).catch(()=>{}).finally(()=>this.mediaWarming.delete(direct));
  }catch{}
 }
 clearPreview(){const audio=this.audio;this.waveToken++;this.previewPlayer?.setWaveform(null);this.audio=null;this.previewPlaybackState=null;this.previewScope=null;this.previewId=undefined;this.previewName=null;this.previewHandled=null;if(audio){audio.onended=null;audio.onerror=null;try{audio.pause();audio.removeAttribute?.('src');audio.load?.();}catch{}}}
 /** Draw the previewed sound's waveform from the bytes warmPreview already downloaded (no second fetch). Streamed previews have no cached bytes and show no waveform. */
 loadPreviewWaveform(audio,blob){
  const token=++this.waveToken;if(!this.previewPlayer||!blob||typeof blob.arrayBuffer!=='function')return;
  (async()=>{
   const Context=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;if(!Context)return;
   const decoded=await new Context(1,1,44100).decodeAudioData(await blob.arrayBuffer());if(token!==this.waveToken||this.audio!==audio)return;
   const channels=[];for(let c=0;c<decoded.numberOfChannels;c++)channels.push(decoded.getChannelData(c));
   this.previewPlayer?.setWaveform(waveformPeaks(channels,480));
  })().catch(()=>{if(token===this.waveToken)this.previewPlayer?.setWaveform(null);});
 }
 /** Plugins tab "Presets" group: installed catalog plugins, each expanding to its catalog presets. */
 presetGroup(){
  const group=node('details',null,'library-preset-group');group.open=this.presetsOpen;group.append(node('summary','Presets'));
  group.addEventListener('toggle',()=>{this.presetsOpen=group.open;if(group.open&&!this.pluginCatalog&&!this.pluginCatalogBusy&&!this.pluginCatalogError)this.execute(()=>this.loadPluginCatalog());});
  const list=node('div',null,'library-preset-plugins');
  if(this.pluginCatalogBusy)list.append(node('div','Reading plugins…','library-message'));
  if(this.pluginCatalogError)list.append(node('div',this.pluginCatalogError,'library-message library-error'),button('Retry','Read the plugin catalog again',()=>this.execute(()=>this.loadPluginCatalog())));
  if(this.pluginCatalog&&!this.pluginCatalog.length)list.append(node('div','No installed plugins were returned.','library-message'));
  for(const plugin of this.pluginCatalog||[]){
   const entry=node('details',null,'library-preset-plugin'),state=this.pluginPresetState.get(plugin.id);entry.open=this.presetsOpenId===plugin.id;entry.append(node('summary',plugin.name));entry.dataset.pluginId=plugin.id;
   entry.addEventListener('toggle',()=>{if(entry.open){this.presetsOpenId=plugin.id;if(!this.pluginPresetState.get(plugin.id))this.execute(()=>this.loadPluginPresets(plugin));}else if(this.presetsOpenId===plugin.id)this.presetsOpenId=null;});
   if(state?.busy)entry.append(node('div','Reading presets…','library-message'));
   if(state?.error)entry.append(node('div',state.error,'library-message library-error'));
   if(state?.names&&!state.names.length)entry.append(node('div','This plugin has no catalog presets.','library-message'));
   for(const name of state?.names||[]){const b=button(name,`Apply preset ${name} to the selected mixer lane`,()=>this.execute(()=>this.applyPluginPreset(plugin,name)),'library-preset-row');b.disabled=this.presetApplying;entry.append(b);}
   list.append(entry);
  }
  group.append(list);return group;
 }
 async loadPluginCatalog(){
  if(this.pluginCatalogBusy)return;this.pluginCatalogBusy=true;this.pluginCatalogError=null;this.render();
  try{
   const rows=[];let cursor=null;
   for(let page=0;page<10;page++){
    const result=await this.client.call('listPluginCatalog',{query:{kind:'effect',limit:200,...(cursor?{cursor}:{})}}),data=result?.data;
    if(result?.status!==200||!Array.isArray(data?.data)||typeof data.pagination?.hasMore!=='boolean')throw new Error('The catalog did not return a complete plugin page.');
    rows.push(...data.data);if(!data.pagination.hasMore)break;cursor=data.pagination.nextCursor;if(typeof cursor!=='string'||!cursor)break;
   }
   this.pluginCatalog=rows.filter(row=>typeof row?.id==='string'&&row.id&&typeof row.name==='string'&&row.availability?.installed!==false);
  }catch(error){this.pluginCatalogError=error?.message||'Freestyle could not list plugins.';}
  finally{this.pluginCatalogBusy=false;this.render();}
 }
 async loadPluginPresets(plugin){
  if(this.pluginPresetState.get(plugin.id)?.busy)return;this.pluginPresetState.set(plugin.id,{busy:true});this.render();
  try{
   const result=await this.client.call('listCatalogPluginPresets',{query:{q:String(plugin.name).slice(0,128),limit:100}}),data=result?.data;
   if(result?.status!==200||!Array.isArray(data?.data))throw new Error('The catalog did not return plugin presets.');
   this.pluginPresetState.set(plugin.id,{names:presetNames(data.data)});
  }catch(error){this.pluginPresetState.set(plugin.id,{error:error?.message||'Freestyle could not list presets.'});}
  finally{this.render();}
 }
 /** Apply a catalog preset to the selected mixer lane when that lane has the plugin loaded; otherwise toast. */
 async applyPluginPreset(plugin,name){
  if(this.presetApplying)return false;
  const lane=this.getMixerLane?.();if(!lane?.projectId||!lane.laneId){this.onStatus('Select a mixer lane to apply a preset to.');return false;}
  const slot=findLanePlugin(lane.plugins,plugin.id);if(!slot){this.onStatus(`${plugin.name} is not loaded on ${lane.name||'the selected lane'}. Add it to the lane first.`);return false;}
  const instance=slot.instance_id??slot.instanceId,body={preset:name,expected_plugin_type:plugin.id,...(typeof instance==='string'&&instance?{expected_plugin_instance_id:instance}:{}),...(lane.trackId?{track_id:lane.trackId}:{})};
  const path={project_id:lane.projectId,lane_id:lane.laneId,plugin_index:slot.index},idempotencyKey=()=>({idempotencyKey:this.idFactory()});
  const apply=async()=>{const result=await this.client.call('applyLanePluginPreset',{path,body},idempotencyKey());if(result?.status<200||result?.status>=300)throw new Error(`Freestyle could not apply ${name}.`);return result;};
  this.presetApplying=true;this.render();
  try{
   // B06: snapshot the slot first and record one undo step whose Undo restores it in place.
   let note='';
   if(typeof instance!=='string'||!instance)await apply();
   else{
    const target={projectId:lane.projectId,laneId:lane.laneId,instanceId:instance,type:plugin.id,name:plugin.name,trackId:lane.trackId||null},history=this.getPresetHistory?.()||null;
    const live=this.slotTransport(target);
    const outcome=await applyWithUndo({history,label:`Apply preset ${name}`,target,snapshot:()=>live.snapshot(),restore:async(t,snapshot)=>{await live.restore(snapshot);await this.onPluginPresetApplied();},apply,log:clientLog});
    if(history&&!outcome.undoable)note=` Undo is unavailable: ${outcome.reason}.`;
   }
   this.onStatus(`Applied ${name} to ${plugin.name} on ${lane.name||'the lane'}.${note}`);
   await this.onPluginPresetApplied();return true;
  }finally{this.presetApplying=false;this.render();}
 }
 /** getLanePluginSnapshot / restoreLanePluginState for one lane plugin instance; the slot index is looked up live at call time. */
 slotTransport({projectId,laneId,instanceId,type,trackId}){
  const locate=async()=>{
   const result=await this.client.call('listLanePlugins',{path:{project_id:projectId,lane_id:laneId},...(trackId?{query:{track_id:trackId}}:{})}),data=result?.data,plugins=data?.response?.plugins??data?.plugins??data?.data?.plugins;
   const slot=Array.isArray(plugins)?plugins.find(item=>(item?.instance_id??item?.instanceId)===instanceId):null;
   if(!slot||!Number.isInteger(slot.index))throw Object.assign(new Error('That plugin is no longer in this lane, so this step was not applied.'),{dispatched:false,historyNotApplied:true});
   return slot.index;
  };
  const pin={expected_plugin_instance_id:instanceId,...(type?{expected_plugin_type:type}:{})};
  return{
   snapshot:async()=>{const index=await locate(),result=await this.client.call('getLanePluginSnapshot',{path:{project_id:projectId,lane_id:laneId,plugin_index:index},query:{...pin,...(trackId?{track_id:trackId}:{})}});if(result?.status!==200)throw new Error('Freestyle could not snapshot the plugin.');return result.data;},
   restore:async snapshot=>{
    const index=await locate(),result=await this.client.call('restoreLanePluginState',{path:{project_id:projectId,lane_id:laneId,plugin_index:index},body:{...restoreBody(snapshot),...(trackId?{track_id:trackId}:{})}},{idempotencyKey:this.idFactory()});
    if(result?.status<200||result?.status>=300)throw Object.assign(new Error('Freestyle could not restore the plugin settings.'),{status:result?.status});return result;
   }};
 }
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
  const names=[...this.container.querySelectorAll('.library-sound-name')].filter(button=>!button.disabled&&this.currentSound(button.closest('.library-sound-row')?.dataset.librarySoundId)),at=names.indexOf(label);if(at<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?names.length-1:Math.max(0,Math.min(names.length-1,at+(event.key==='ArrowDown'?1:-1)));const nextId=names[next].closest('.library-sound-row').dataset.librarySoundId;this.selectSound(nextId,{focus:true});
  // FL Browser: Shift+Up / Shift+Down step through the items WITH preview.
  if(event.shiftKey&&!event.repeat&&next!==at&&['ArrowUp','ArrowDown'].includes(event.key))this.previewSoundRow(this.currentSound(nextId));
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
  if(this.writeBusy)return null;this.rememberRecent(item);const registered=item?._libraryView==='project-samples';if(!item?.id||!registered&&(item.materializable===false||item.canAdd===false||item._libraryView==='audio'))throw new Error('This row cannot be materialized through the sound-pack API. Use a playable sound returned by Sounds or a sound pack.');
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
  this.rememberRecent(item);this.selectSound(item.id);const scope=this.soundScope(),generation=++this.previewGeneration;
  if(this.onPreview){const handled=await this.onPreview(item);if(generation!==this.previewGeneration||scope!==this.soundScope())return false;if(handled!==false){this.clearPreview();this.previewHandled={id:item.id,scope};this.previewPlayer?.refresh();return handled;}}
  const route=libraryPreviewRoute(item);
  if(route==='engine'&&typeof this.onAuditionSample==='function')return this.engineAudition(item,{scope,generation});
  if(route==='splice')return this.splicePreview(item,{scope,generation});
  if(route==='direct'&&this.usesCatalogPreview(item)){
   // The same row again toggles the loaded preview (pause / play) without asking Freestyle for another preview URL.
   if(this.previewId===item.id&&this.previewScope===scope&&this.audio&&!this.audio.error&&!this.previewPlaybackState?.failed){const state=this.previewPlaybackState;if(state)state.generation=generation;if(!this.audio.paused){this.audio.pause();this.render();return false;}if(state?.play)return state.play();}
   return this.catalogPreview(item,{scope,generation});
  }
  const directUrl=libraryMediaUrl(item.previewUrl||item.audioUrl);if(!directUrl)throw new Error('Freestyle did not expose a playable preview URL for this library row.');
  if(this.previewId===item.id&&this.previewScope===scope&&this.audio&&!this.audio.error&&!this.previewPlaybackState?.failed){const state=this.previewPlaybackState;if(state)state.generation=generation;if(!this.audio.paused){this.audio.pause();this.render();return false;}if(state?.play)return state.play();}
  this.audio?.pause();let url=directUrl;
  // A hover/pointerdown warm-up (warmPreview) already resolved the playable URL, and for short sounds
  // holds the bytes: start inside the click with nothing to await (Default SoundLibrary parity).
  const warmed=this.mediaCache.get(directUrl);
  if(warmed)url=warmed.blobUrl||warmed.url;
  else if(this.prepareMedia&&!item._directStorage){try{url=await this.prepareMedia(directUrl,item);}catch(error){if(generation!==this.previewGeneration||scope!==this.soundScope())return false;throw error;}}
  if(generation!==this.previewGeneration||scope!==this.soundScope())return false;
  if(typeof url!=='string'||!url.trim())throw new Error('The cloud media bridge did not return a playback URL.');
  try{const parsed=new URL(url,globalThis.location?.origin||'http://localhost');if(!['http:','https:','blob:'].includes(parsed.protocol)||url.startsWith('//'))throw new Error();}catch{throw new Error('The cloud media bridge returned an invalid playback URL.');}
  // Preserve same-origin opaque bridge paths; they are not paths on freestyle.audio.
  const audio=this.audioFactory();this.audio=audio;audio.preload='auto';audio.controls=true;this.applyPreviewVolume(audio);audio.loop=this.previewLoop;audio.src=url;this.previewId=item.id;this.previewName=item.name||'Preview';this.previewScope=scope;this.previewHandled=null;this.loadPreviewWaveform(audio,warmed?.blob);
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
 /** Issue #16: with `catalogPreviews` on, a Sound Library row (browseCatalogSounds) previews through previewCatalogSound. */
 usesCatalogPreview(item){return this.catalogPreviews===true&&item?._rowKind==='sound'&&!item._catalogPreview&&typeof item.id==='string'&&!!item.id&&Object.prototype.hasOwnProperty.call(STUDIO_API_OPERATIONS,'previewCatalogSound');}
 /** Issue #16. Sound Library row → previewCatalogSound → the preview element. previewRequiresAuth:false: the short-lived
  * storage URL is played as is (no credentials). true: previewUrl is the streamCatalogSoundPreview API path, fetched
  * once through the host's apiFetch (bearer added by the host) into an object URL for the same element. 429: the
  * Retry-After wait is honoured (no request until it passes). Nothing is decoded or processed here. */
 async catalogPreview(item,{scope,generation}){
  const started=globalThis.performance?.now?.()??Date.now(),elapsed=()=>Math.round((globalThis.performance?.now?.()??Date.now())-started),current=()=>generation===this.previewGeneration&&scope===this.soundScope();
  const now=Date.now();if(this.catalogPreviewBlockedUntil>now){const wait=Math.ceil((this.catalogPreviewBlockedUntil-now)/1000);throw Object.assign(new Error(`Freestyle limits sound previews right now. Try again in ${wait} s.`),{code:'rate_limited',status:429,retryAfterSec:wait});}
  let data;
  try{data=(await this.client.call('previewCatalogSound',{path:{item_id:item.id}})).data||{};}
  catch(error){
   if(error?.status===429){const wait=Math.max(1,Math.min(3600,Number(error.retryAfter)||30));this.catalogPreviewBlockedUntil=Date.now()+wait*1000;clientLog('library-preview-timing',{route:'catalog',status:429,retryAfterSec:wait,ms:elapsed()});throw Object.assign(new Error(`Freestyle limits sound previews right now. Try again in ${wait} s.`),{code:'rate_limited',status:429,retryAfterSec:wait,requestId:error.requestId??null});}
   clientLog('library-preview-timing',{route:'catalog',failed:true,status:error?.status??null,code:error?.code??null,ms:elapsed()});throw error;
  }
  if(!current())return false;
  const auth=data.previewRequiresAuth===true,key=libraryMediaUrl(data.previewUrl);
  if(!key||!auth&&!key.startsWith('https://'))throw new Error('Freestyle did not return a playable preview for this sound.');
  if(auth&&!this.mediaCache.has(key)){
   const host=freestyleHost();if(typeof host?.apiFetch!=='function')throw new Error('This sound needs an authorized preview stream, and no Freestyle host is connected.');
   const path=new URL(key).pathname;const response=await host.apiFetch(path,{method:'GET',headers:{Accept:'audio/*'}});
   if(response.status===429){const wait=Math.max(1,Math.min(3600,Number(response.headers?.get?.('retry-after'))||30));this.catalogPreviewBlockedUntil=Date.now()+wait*1000;throw Object.assign(new Error(`Freestyle limits sound previews right now. Try again in ${wait} s.`),{code:'rate_limited',status:429,retryAfterSec:wait});}
   if(!response.ok)throw Object.assign(new Error(`Freestyle could not stream this sound’s preview (HTTP ${response.status}).`),{status:response.status});
   const blob=await response.blob();if(!current())return false;if(!blob.size)throw new Error('Freestyle returned an empty preview for this sound.');
   const blobUrl=URL.createObjectURL(blob);this.mediaCache.set(key,{url:blobUrl,blobUrl,blob});
  }
  // A direct storage URL needs no bridge: it is played as returned (the bearer is never sent to it).
  const played=await this.preview({...item,previewUrl:key,audioUrl:key,_catalogPreview:true,_directStorage:!auth});
  clientLog('library-preview-timing',{route:'catalog',auth,clickToPlayMs:elapsed(),played:played===true});
  return played;
 }
 /** Splice row → short-lived credential-free CDN URL → the preview element. */
 async splicePreview(item,{scope,generation}){
  const started=globalThis.performance?.now?.()??Date.now(),soundId=item.spliceSoundId??item.splice_sound_id??item.id;
  const result=await this.client.call('previewCatalogSpliceSound',{path:{sound_id:soundId}});if(generation!==this.previewGeneration||scope!==this.soundScope())return false;
  const data=result?.data,url=libraryMediaUrl(data?.url??data?.previewUrl??data?.preview_url);if(!url||!url.startsWith('https://'))throw new Error('Splice did not return a playable preview URL for this sound.');
  const played=await this.preview({...item,previewUrl:url,audioUrl:url,spliceSoundId:undefined,splice_sound_id:undefined,provider:undefined,source:undefined,_splicePreview:true});
  clientLog('library-preview-timing',{route:'splice',clickToPlayMs:Math.round((globalThis.performance?.now?.()??Date.now())-started),played:played===true});
  return played;
 }
 rememberRecent(item){try{const storage=browserStorage();writeRecentSounds(recordRecentSound(readRecentSounds(storage),item),storage);}catch{}}
 /** Current project sub-folders: Patterns, Channels, Automation and Mixer effects. Each item calls the app's own select/open function. */
 projectTree(){
  const project=this.getFeatureProject?.();if(!project||typeof project.then==='function')return null;
  let shown;try{shown=this.getRackChannels?.();}catch{shown=undefined;}const folders=currentProjectFolders(project,{channels:shown});let envelopes=[];try{envelopes=automationEnvelopeRows(this.getAutomationEnvelopes?.());}catch{envelopes=[];}folders.automation=envelopes;let lanes=[];try{lanes=this.getMixerEffects?.()||[];}catch{lanes=[];}
  const openSet=this.projectFoldersOpen;
  const folder=(key,label,count,fill)=>{const group=node('details',null,`library-tree-folder library-tree-${key}`);group.open=openSet.has(key);group.dataset.treeFolder=key;group.append(node('summary',`${label} (${count})`));group.addEventListener('toggle',()=>{if(group.open)openSet.add(key);else openSet.delete(key);});fill(group);return group;};
  const items=(group,rows,pick,empty)=>{if(!rows.length)group.append(node('div',empty,'library-message'));for(const row of rows)group.append(button(row.name,`Open ${row.name}`,()=>this.execute(()=>pick(row)),'library-tree-item'));};
  const effectCount=lanes.reduce((total,lane)=>total+(lane.plugins?.length||0),0);
  const wrap=node('div',null,'library-project-tree');
  wrap.append(folder('patterns','Patterns',folders.patterns.length,group=>items(group,folders.patterns,row=>this.onSelectPattern?.(row.id),'No patterns yet.')));
  wrap.append(folder('channels','Channels',folders.channels.length,group=>items(group,folders.channels,row=>this.onSelectChannel?.(row.id),'No channels yet.')));
  wrap.append(folder('automation','Automation',folders.automation.length,group=>items(group,folders.automation,row=>this.onOpenAutomation?.(null,row.raw),'No automation envelopes yet.')));
  wrap.append(folder('effects','Mixer effects',effectCount,group=>{if(!effectCount)group.append(node('div','No mixer effects loaded.','library-message'));for(const lane of lanes){if(!lane.plugins?.length)continue;group.append(node('div',lane.name||'Lane','library-tree-lane'));for(const plugin of lane.plugins)group.append(button(plugin.name,`Open ${plugin.name} on ${lane.name||'this lane'}`,()=>this.execute(()=>this.onOpenMixerEffect?.(lane.key,plugin.position)),'library-tree-item'));}}));
  return wrap;
 }
 /** Recent folder: the last 20 previewed or used sounds. */
 recentFolder(){
  const recent=readRecentSounds();if(!recent.length)return null;
  const group=node('details',null,'library-tree-folder library-recent');group.open=this.recentOpen!==false;group.dataset.treeFolder='recent';group.append(node('summary',`Recent (${recent.length})`));
  group.addEventListener('toggle',()=>{this.recentOpen=group.open;});
  for(const item of recent)group.append(button(item.name||'Unnamed sound',`Preview ${item.name||'sound'}`,()=>this.execute(()=>this.preview(item)),'library-tree-item'));
  return group;
 }
 render(){
  if(!this.mounted||!this.container)return;
  const active=this.container.ownerDocument.activeElement,focused=active?.closest?.('.library-sound-name'),restoreId=focused&&this.container.contains(focused)&&this.soundSelectionScope===this.soundScope()?focused.closest('.library-sound-row')?.dataset.librarySoundId:null;this.syncSoundSelection();
  const shell=node('div',null,'library-shell');
  const projectFolder=button('', 'Browse samples in the current project',()=>this.execute(()=>this.open('project-samples')),'library-project-folder browser-folder');projectFolder.append(node('span',this.view==='project-samples'?'▾':'▸'),node('span','▰','folder-icon'),document.createTextNode('Current project'));projectFolder.dataset.libraryView='project-samples';const projectAvailability=this.viewFeature('project-samples');projectFolder.disabled=this.writeBusy||!projectAvailability.enabled;if(!projectAvailability.enabled)projectFolder.title=projectAvailability.reason;projectFolder.setAttribute('aria-expanded',String(this.view==='project-samples'));shell.append(projectFolder);const projectTreeNode=this.projectTree();if(projectTreeNode)shell.append(projectTreeNode);const recentNode=this.recentFolder();if(recentNode)shell.append(recentNode);
  const tabs=node('div',null,'library-tabs');for(const [view,label]of [['sounds','Sounds'],['packs','Packs'],['patterns','MIDI'],['plugins','Plugins'],['audio','Files']]){const b=button(label,`Browse cloud ${view}`,()=>this.execute(()=>this.open(view)),this.view===view||this.view==='pack'&&view==='packs'?'active':'');const availability=this.viewFeature(view);b.disabled=this.writeBusy||!availability.enabled;if(!availability.enabled){b.title=availability.reason;b.setAttribute('aria-description',availability.reason);}b.dataset.libraryView=view;tabs.append(b);}shell.append(tabs);
  const filters=node('details',null,'library-filter-panel'),summary=node('summary','Search filters');filters.append(summary);const row=node('div',null,'library-filters');for(const [key,label]of [['category','Category'],['tag','Tag']]){const input=node('input');input.placeholder=label;input.setAttribute('aria-label',`Library ${label.toLowerCase()}`);input.maxLength=64;input.disabled=this.unavailable;input.value=this[key];input.onchange=()=>this.execute(()=>this.setFilters({[key]:input.value}));row.append(input);}filters.append(row);shell.append(filters);
  const heading=node('div',null,'library-heading');if(this.view==='pack')heading.append(button('‹','Back to sound packs',()=>this.execute(()=>this.open('packs'))));heading.append(node('strong',this.pack?.name||({sounds:'All sounds',packs:'Sound packs',patterns:'Pattern library',audio:'Audio library',kits:'Beat kits',plugins:'Plugins',effects:'Effects','project-samples':'Project samples'}[this.view]||'Library')));heading.append(button('↻','Refresh cloud library',()=>this.execute(()=>this.refresh())));shell.append(heading);
  if(this.searchInput){this.searchInput.disabled=this.unavailable;this.searchInput.title=this.unavailable?this.notice||'Library view unavailable':'';}
  const count=node('div',this.busy?'Reading Freestyle…':`${this.rows.length}${this.total!=null?` / ${this.total}`:''} ${ASSET_TYPES[this.view]?'assets':'sounds'}`,'library-count');count.setAttribute('role','status');if(!this.unavailable)shell.append(count);
  if(this.notice){const notice=node('div',this.notice,'library-message library-unavailable');notice.setAttribute('role','status');if(this.unavailable){const navigation=node('div',null,'library-unavailable-navigation');for(const [view,label]of [['packs','Your packs'],['patterns','Your patterns'],['plugins','Your plugins']]){const availability=this.viewFeature(view);if(availability.enabled)navigation.append(button(label,`Browse your ${view}`,()=>this.execute(()=>this.open(view))));}navigation.append(button('Import audio','Import a local audio file',()=>this.onImportAudio()));notice.append(navigation);}shell.append(notice);}
  if(this.error){const error=node('div',this.error.message,'library-message library-error');error.append(button('Retry','Retry the library read',()=>this.execute(()=>this.refresh())));shell.append(error);}
  const items=node('div',null,'library-rows');for(const item of this.rows)items.append(item._rowKind==='asset'?this.assetRow(item):this.soundRow(item));shell.append(items);
  if(!this.rows.length&&!this.busy&&!this.error&&!this.unavailable)shell.append(node('div',this.search?'No matching cloud sounds or assets.':'No items were returned from this Freestyle library.','library-message'));
  if(this.truncated)shell.append(node('div',this.view==='project-samples'?'The project sample list is incomplete. Refresh before continuing.':'Freestyle returned a partial asset list. Global sound search still pages through all accessible sounds.','library-message'));
  if(this.nextCursor||this.nextOffset!=null){const more=button(this.busy?'Loading…':'Load more','Read the next cloud library page',()=>this.execute(()=>this.more()),'library-more');more.disabled=this.busy;shell.append(more);}
  if(this.detail)shell.append(this.assetDetail(this.detail));
  if(this.view==='plugins'&&!this.unavailable)shell.append(this.presetGroup());
  if(!this.previewPlayer&&this.audio&&this.previewId){const player=node('div',null,'library-preview');player.append(node('span',this.previewName));if(this.audio.nodeType)player.append(this.audio);shell.append(player);}
  this.container.replaceChildren(shell);this.paintSoundSelection();if(restoreId&&this.selectedSoundId===restoreId)this.selectSound(restoreId,{focus:true});
 }
 soundRow(item,{registered=false}={}){
  if(item._libraryView==='project-samples'&&!registered)return this.projectSampleRow(item);
  const row=node('div',null,'library-sound-row');row.dataset.librarySoundId=item.id;row.addEventListener('pointerenter',()=>this.warmPreview(item));row.addEventListener('pointerdown',()=>this.warmPreview(item));const addAvailability=this.addAvailability(item);row.draggable=!!item.materializable&&addAvailability.enabled;row.ondragstart=event=>{if(!item.materializable||this.writeBusy||!addAvailability.enabled){event.preventDefault();return;}writeLibraryDragData(event.dataTransfer,{id:item.id,name:item.name,_libraryView:item._libraryView,materializable:item.materializable,canAdd:item.canAdd,...(item.assetId?{assetId:item.assetId}:{}),...(item._packAssetId?{_packAssetId:item._packAssetId}:{}),...(item.audioFileId?{audioFileId:item.audioFileId}:{}),...(item.audio_file_id?{audio_file_id:item.audio_file_id}:{}),...(item.preset_pack_item_id?{preset_pack_item_id:item.preset_pack_item_id}:{}),...(item.sound_pack_item_id?{sound_pack_item_id:item.sound_pack_item_id}:{}),...(item.catalog_sound_id?{catalog_sound_id:item.catalog_sound_id}:{}),...(Object.prototype.hasOwnProperty.call(item,'register')?{register:item.register}:{})});};row.title=[item.name,item.bpm?`${item.bpm} BPM`:null,item.key,list(item.tags).join(', ')].filter(Boolean).join(' · ');
  const source=node('span',null,'library-source-icon');source.innerHTML=studioIcon('speaker');source.setAttribute('aria-hidden','true');source.title='Audio source';row.append(source);
  const playable=!!item.previewUrl||!!this.onPreview;const play=button('',`Preview ${item.name}`,()=>this.previewSoundRow(item),'library-preview-button');play.innerHTML=studioIcon(this.isPreviewPlaying(item.id)?'pause':'play');play.setAttribute('aria-label',`Preview ${item.name||'sound'}`);play.disabled=!playable;row.append(play);
  const copy=node('div',null,'library-sound-copy'),label=button(item.name||'Unnamed sound','Preview this cloud sound',()=>this.previewSoundRow(item),'library-sound-name');label.disabled=!playable;copy.append(label);const metadata=libraryRowMetadata(item);if(metadata){const subtitle=node('small',metadata,'library-sound-meta');subtitle.title=metadata;copy.append(subtitle);}row.append(copy);
  const duration=number(item.durationSec)&&Number(item.durationSec)>=0?`${Number(item.durationSec).toFixed(Number(item.durationSec)<10?2:1)}s`:'';if(duration)row.append(node('small',duration,'library-sound-duration'));
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
