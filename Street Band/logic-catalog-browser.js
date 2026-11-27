/** Loops browser catalog locations: Beats, Drum Kits and Splice (Studio API 357).
 *
 * All three are typed GETs answering {data: [open rows], pagination: {limit, hasMore,
 * nextCursor}} and are paged with the opaque cursor (same filters):
 *  - searchCatalogBeats GET /catalog/beats ?q&genre&mood&artist&key&bpm_min&bpm_max
 *    &limit(1–25)&cursor — curated beats whose audio is stored. The search field is q,
 *    the Category filter genre, the Tag filter mood.
 *  - listCatalogDrumKits GET /catalog/drum-kits ?project_id&limit(1–200)&cursor — the
 *    caller's kits plus defaults (isDefault). A kit's pads/sounds (when the row lists
 *    them) become sound rows; the search field filters by name locally.
 *  - searchCatalogSpliceSounds GET /catalog/splice-sounds ?q (required)&bpm&key&genre
 *    &limit(1–200)&cursor — the caller's linked Splice account. Rows are canAdd=false
 *    (splice_download_required): previewable through previewCatalogSpliceSound (the
 *    existing 'splice' preview route), never dragged in.
 *
 * Live shapes (2026-11-16, project 191d3c7bc7f84469): beats are YouTube type beats
 * {id, title, artistTag, channelName, coverArtUrl, durationSec, bpm|null, key, scale,
 * genre|null, mood|null, youtubeId, youtubeUrl} with NO registration handle: they are
 * listed with an "Open on YouTube" link only (the Studio API publishes no op that sets
 * a YouTube backing track). Drum kits are {id, name, soundCount, isDefault, createdAt}
 * without pads, and no published op lists a kit's sounds: kits are shown with their
 * sound count and the reason. Splice answers 409 splice_reconnect_required while the
 * linked account needs reconnecting: that message is shown in the tab (no settings URL
 * is documented). `pagination` may be absent on beats: absent = no further page.
 *
 * Rows use the CloudLibraryBrowser sound-row shape, so preview, favourites, keyboard
 * selection, the Playlist drag payload and resolvePlacementSample (register once per
 * project, then place with import-style history) are the existing ones. A row is
 * draggable only when it carries a published registration selector (register handle,
 * audio_file_id, catalog_sound_id, …: catalogPatternSampleSelector); nothing is guessed
 * from a bare id or a media URL.
 */
import {STUDIO_API_OPERATIONS} from './studio-api-client.js';
import {catalogPatternSampleSelector} from './cloud-pattern-sample-registration.js';
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'?value.trim():'';
const number=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const BASE='https://freestyle.audio';
const YOUTUBE_HOSTS=new Set(['www.youtube.com','youtube.com','m.youtube.com','music.youtube.com','youtu.be']);
/** A YouTube watch link (https, YouTube host) or null. */
export function youtubeLink(row){
 const direct=typeof row?.youtubeUrl==='string'?row.youtubeUrl:null;
 if(direct){try{const url=new URL(direct);if(url.protocol==='https:'&&YOUTUBE_HOSTS.has(url.hostname)&&!url.username&&!url.password)return url.href;}catch{}}
 const id=typeof row?.youtubeId==='string'&&/^[A-Za-z0-9_-]{6,20}$/.test(row.youtubeId)?row.youtubeId:null;return id?`https://www.youtube.com/watch?v=${id}`:null;
}
const httpsImage=value=>{if(typeof value!=='string')return null;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
export const KIT_SOUNDS_UNAVAILABLE='Freestyle’s Studio API lists drum kits but not the sounds inside them, so kit pads cannot be previewed or dragged in here yet. Use the kit in Freestyle’s drum pad.';
export const SPLICE_RECONNECT_CODE='splice_reconnect_required';
const media=value=>{if(typeof value!=='string'||!value.trim())return null;try{const url=new URL(value,BASE);return['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}};

export const CATALOG_VIEWS=Object.freeze({
 beats:Object.freeze({operationId:'searchCatalogBeats',label:'Beats',pageSize:25,title:'Browse Freestyle’s curated beats'}),
 'drum-kits':Object.freeze({operationId:'listCatalogDrumKits',label:'Drum Kits',pageSize:50,title:'Browse your drum kits and the default kits'}),
 splice:Object.freeze({operationId:'searchCatalogSpliceSounds',label:'Splice',pageSize:25,title:'Search Splice through your linked account (preview only)'})
});
export const CATALOG_SCOPES=Object.freeze(Object.entries(CATALOG_VIEWS).map(([view,definition])=>Object.freeze([view,definition.label])));
export const isCatalogView=view=>Object.prototype.hasOwnProperty.call(CATALOG_VIEWS,view);
export function catalogViewAvailability(view,{project,operations=STUDIO_API_OPERATIONS}={}){
 const definition=CATALOG_VIEWS[view],restMode=project?.cloud?.rawState?.studioApi===true;
 if(!definition)return{feature:'catalog_'+view,enabled:false,restMode,reason:'Unknown catalog location.'};
 if(!restMode)return{feature:'catalog_'+view,label:definition.label,enabled:false,restMode,reason:`${definition.label} needs a Freestyle Studio API (OAuth) project.`};
 if(!operations||!Object.prototype.hasOwnProperty.call(operations,definition.operationId))return{feature:'catalog_'+view,label:definition.label,enabled:false,restMode,reason:`${definition.label} is awaiting a Freestyle API update.`};
 return{feature:'catalog_'+view,label:definition.label,enabled:true,restMode,reason:null};
}
const clip=(value,max)=>Array.from(String(value||'').trim()).slice(0,max).join('');
/** The typed query for one page (null = nothing to ask: Splice needs search text). */
export function catalogQuery(view,{search='',category='',tag='',cursor=null,projectId=null}={}){
 const definition=CATALOG_VIEWS[view];if(!definition)throw new Error(`Unknown catalog location: ${view}`);
 const query={limit:definition.pageSize};if(typeof cursor==='string'&&cursor&&cursor.length<=512)query.cursor=cursor;
 if(view==='beats'){const q=clip(search,120),genre=clip(category,64),mood=clip(tag,64);if(q)query.q=q;if(genre)query.genre=genre;if(mood)query.mood=mood;}
 else if(view==='splice'){const q=clip(search,200);if(!q)return null;query.q=q;const genre=clip(category,64);if(genre)query.genre=genre;}
 else if(typeof projectId==='string'&&projectId&&projectId.length<=64)query.project_id=projectId;
 return query;
}
const selectorOf=row=>{try{return catalogPatternSampleSelector(row);}catch{return null;}};
const tagsOf=(...values)=>[...new Set(values.flat().filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))].slice(0,12);
function soundRow(row,view,{id,name,extra={}}={}){
 const preview=media(row.previewUrl??row.preview_url??row.audioUrl??row.audio_url??row.streamUrl??row.stream_url);
 const canAdd=row.canAdd===false?false:row.canAdd;
 const base={...row,...extra,id,name,_libraryView:view,_rowKind:'sound',previewUrl:preview,durationSec:number(row.durationSec??row.duration_sec??row.duration)?Number(row.durationSec??row.duration_sec??row.duration):undefined,bpm:number(row.bpm)?Number(row.bpm):row.bpm,key:text(row.key)||text(row.musicalKey)||undefined,tags:tagsOf(Array.isArray(row.tags)?row.tags:[],row.genre,row.mood,Array.isArray(row.genres)?row.genres:[],Array.isArray(row.moods)?row.moods:[])};
 base.canAdd=canAdd;base.materializable=canAdd!==false&&selectorOf(base)!==null;return base;
}
const SOUND_LISTS=['pads','sounds','samples','slots','items'];
/** {data, pagination} → library rows for one catalog location. */
export function normalizeCatalogRows(view,data){
 if(!record(data)||!Array.isArray(data.data))throw new Error('Freestyle returned an unreadable catalog page. Refresh the browser before continuing.');
 const rows=[];
 for(const row of data.data){
  if(!record(row))continue;const rowId=row.id??row.beatId??row.soundId??row.kitId;if(typeof rowId!=='string'&&typeof rowId!=='number')continue;const id=String(rowId);
  if(view==='beats'){const artist=text(row.artistTag)||text(row.channelName)||text(row.artist)||text(row.producer)||undefined;rows.push(soundRow(row,view,{id,name:text(row.title)||text(row.name)||'Beat',extra:{artist,libraryCategory:artist,externalUrl:youtubeLink(row),externalLabel:'YouTube ↗',coverUrl:httpsImage(row.coverArtUrl)}}));}
  else if(view==='splice'){const sound=soundRow({...row,canAdd:false,canAddReason:row.canAddReason||'splice_download_required'},view,{id,name:text(row.name)||text(row.filename)||text(row.title)||'Splice sound',extra:{spliceSoundId:text(row.spliceSoundId)||text(row.splice_sound_id)||id,provider:'splice'}});rows.push(sound);}
  else{
   const kitName=text(row.name)||text(row.title)||'Drum kit',list=SOUND_LISTS.map(key=>row[key]).find(Array.isArray);
   if(list&&list.length){list.forEach((pad,index)=>{if(!record(pad))return;const padId=pad.id??pad.padId??pad.slot??index;rows.push(soundRow(pad,view,{id:`${id}:${padId}`,name:`${kitName} · ${text(pad.name)||text(pad.label)||text(pad.title)||`Pad ${index+1}`}`,extra:{_kitId:id,_kitName:kitName,libraryCategory:row.isDefault===true?'Default kit':'My kit'}}));});}
   else{const count=Number(row.soundCount);rows.push({...soundRow(row,view,{id,name:kitName,extra:{_kitId:id,_kitOnly:true,soundCount:Number.isFinite(count)?count:undefined,libraryCategory:[row.isDefault===true?'Default kit':'My kit',Number.isFinite(count)?`${count} sound${count===1?'':'s'}`:''].filter(Boolean).join(' · ')}}),materializable:false,previewUrl:null});}
  }
 }
 return rows;
}
/** Pagination → the next cursor (null when complete); refuses a page that does not advance. */
export function catalogNextCursor(data,{cursor=null,seen=new Set()}={}){
 const page=data?.pagination;if(page===undefined||page===null)return null;// live beats omit it: one page
 if(!record(page)||typeof page.hasMore!=='boolean')throw new Error('Freestyle returned a catalog page without its pagination. Refresh the browser before continuing.');
 if(!page.hasMore)return null;const next=page.nextCursor;
 if(typeof next!=='string'||!next||next.length>512)throw new Error('Freestyle said more results exist but returned no usable cursor. Refresh the browser before continuing.');
 if(next===cursor||seen.has(next))throw new Error('Freestyle returned a repeated catalog cursor without advancing. Refresh the browser before continuing.');
 return next;
}
/** CloudLibraryBrowser.load() for a catalog location (same state fields, generation guard and cache). */
export async function loadCatalogView(browser,{append=false,force=false}={}){
 browser.projectSamples?.cancel?.();
 const view=browser.view,definition=CATALOG_VIEWS[view],cursor=append?browser.nextCursor:null;if(append&&!cursor)return browser.rows;
 const generation=++browser.generation;browser.busy=true;browser.error=null;browser.notice=null;browser.unavailable=false;
 if(!append){browser.rows=[];browser.nextCursor=null;browser.nextOffset=null;browser.assetCursors=new Set();browser.truncated=false;browser.categories=[];}browser.render();
 let context=browser.featureContext();if(context&&typeof context.then==='function')context=await context;if(generation!==browser.generation)return browser.rows;
 if(!context.failed)browser.featureProject=context.project;const availability=browser.viewFeature(view);
 if(context.failed&&!browser.featureProject||!availability.enabled){browser.busy=false;browser.unavailable=true;browser.rows=[];browser.total=null;browser.notice=context.failed&&!browser.featureProject?'Connect a Freestyle project to browse the library. Local audio imports remain available.':availability.reason;browser.render();return browser.rows;}
 const project=browser.featureProject,projectId=project?.cloud?.projectId||project?.projectId||project?.id||null;
 const query=catalogQuery(view,{search:browser.search,category:browser.category,tag:browser.tag,cursor,projectId});
 if(!query){browser.busy=false;browser.rows=[];browser.total=null;browser.notice='Type in the search field to search Splice. Splice sounds can be previewed here; download them in Splice before adding them.';browser.render();return browser.rows;}
 const cacheKey=JSON.stringify(['catalog',definition.operationId,query]);
 try{
  const data=!force&&browser.cache.has(cacheKey)?browser.cache.get(cacheKey):(await browser.client.call(definition.operationId,{query}))?.data;
  if(generation!==browser.generation)return browser.rows;
  const next=catalogNextCursor(data,{cursor,seen:browser.assetCursors});if(next)browser.assetCursors.add(next);browser.cache.set(cacheKey,data);
  let rows=normalizeCatalogRows(view,data);
  if(view==='drum-kits'){const needle=text(browser.search).toLowerCase();if(needle)rows=rows.filter(row=>`${row.name} ${row._kitName||''}`.toLowerCase().includes(needle));}
  browser.rows=append?[...browser.rows,...rows.filter(row=>!browser.rows.some(old=>old.id===row.id))]:rows;
  browser.total=null;browser.nextCursor=next;browser.nextOffset=null;browser.busy=false;if(view==='drum-kits'&&rows.length&&rows.every(row=>row._kitOnly))browser.notice=KIT_SOUNDS_UNAVAILABLE;browser.render();return browser.rows;
 }catch(error){if(generation!==browser.generation)return browser.rows;browser.busy=false;
  if(view==='splice'&&(error?.code===SPLICE_RECONNECT_CODE||error?.data?.error?.code===SPLICE_RECONNECT_CODE)){browser.rows=[];browser.nextCursor=null;browser.notice=`${error?.data?.error?.message||error?.message||'Connect your Splice account again to continue.'} Reconnect Splice in Freestyle, then search again.`;browser.render();return browser.rows;}browser.error=error instanceof Error?error:new Error(String(error));browser.nextCursor=null;browser.render();throw browser.error;}
}
