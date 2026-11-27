import {engineNotLoaded} from './cloud-waveform-recovery.js';
import {WaveformTiles,createClipWaveformTransport,planWaveformWindow,WAVEFORM_READ_BUCKET_LIMIT,isTransientWaveformReadError,waveformTileCovers} from './cloud-waveform.js';
import {sourceWaveformSvg} from './audacity-timeline.js';
import {PeakPyramid} from './waveform-pyramid.js';
import {DEFAULT_TRACK_HEIGHT_PX} from './audacity-layout.js';
/** Encoder tail on recorded takes saved before Freestyle #5 (1024 frames); new takes have none. */
export const LEGACY_TAKE_TAIL_FRAMES=1024;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clipIdentity=clip=>clip?.cloudId||(clip?.id==='backing'?'backing':null);
const fingerprint=clip=>JSON.stringify([clipIdentity(clip),clip.start,clip.length,clip.offset,clip.offsetKnown,clip.engineLoaded,clip.volume,clip.cloudRaw??null]);
const abortError=()=>Object.assign(new Error('The cloud waveform view changed.'),{name:'AbortError'});
/** Read-only waveform presentation, gated by discovered production capability. */
export class AudacityWaveformView{
 constructor(workspace,{isSupported=()=>workspace.waveformSupported===true,onMetadata=()=>{},maxConcurrent=2,waveformReadOptions={}}={}){
  this.w=workspace;this.isSupported=isSupported;this.onMetadata=onMetadata;this.maxConcurrent=maxConcurrent;this.records=new Map();this.queue=[];this.activeReads=0;this.generation=0;this.aliases=new Map();this.retired=new Map();this.readsStarted=0;this.pyramid=new PeakPyramid();this.pyramidReads=new Map();this.watchWriteFlags();
  const readOptions={...waveformReadOptions};if(!Object.hasOwn(readOptions,'readBucketLimit')&&!Object.hasOwn(readOptions,'getReadBucketLimit'))readOptions.getReadBucketLimit=()=>workspace.waveformReadBucketLimit??WAVEFORM_READ_BUCKET_LIMIT;const transport=createClipWaveformTransport((name,args)=>workspace.engine.session.call(name,args),{...readOptions,getSourceOnly:()=>this.independent()});
  this.transport=transport;this.tiles=new WaveformTiles({fetchWaveform:input=>{const scope=this.scope(),generation=this.generation,version=this.records.get(input.clipId)?.version,isCurrent=()=>generation===this.generation&&this.available()&&this.scope()===scope&&this.scopeKey===scope&&this.records.get(input.clipId)?.version===version&&(this.w.getProject().audioClips||[]).some(clip=>clipIdentity(clip)===input.clipId&&this.version(clip)===version);return this.enqueue(()=>transport({...input,isCurrent}),input.signal);}});
  this.retries=new Map();this.retryClick=event=>{const button=event.target.closest?.('[data-waveform-retry]');if(!button||!workspace.root.contains(button))return;event.preventDefault();event.stopImmediatePropagation();const element=button.closest('.au-clip'),clip=(workspace.getProject().audioClips||[]).find(clip=>String(clip.id)===element?.dataset.clip&&clipIdentity(clip)===button.dataset.waveformRetry);if(clip)this.retry(clip).catch(error=>{if(error.name!=='AbortError')workspace.onError?.(error);});};workspace.root.addEventListener('click',this.retryClick,true);
 }
 context(){const w=this.w,p=w.getProject();return {projectId:p.cloud?.projectId||p.id,trackId:w.engine.session?.trackId,loadVersion:w.engine.loadVersion??0,contextVersion:w.engine.session?.contextVersion??0};}
 independent(){return this.w.waveformIndependentOfNative===true;}
 canReadClip(clip){return clip.engineLoaded!==false||this.independent();}
 /** Independent (source-frame) reads: the record is the SOURCE PCM, keyed by
  * root source clip id; placement comes from the canonical clip at render
  * time, so move/trim/split/paste and their Undo never invalidate it. */
 sourceOf(id){let root=id;for(let i=0;i<16&&this.aliases.has(root);i++)root=this.aliases.get(root);return root;}
 aliasSource(clipId,sourceClipId){if(typeof clipId!=='string'||typeof sourceClipId!=='string'||clipId===sourceClipId)return;const root=this.sourceOf(sourceClipId);if(root!==clipId)this.aliases.set(clipId,root);}
 version(clip){return this.independent()?JSON.stringify(['source',clipIdentity(clip),this.sourceOf(clipIdentity(clip))]):JSON.stringify([this.w.getProject().bpm,this.independent(),fingerprint(clip)]);} scope(){return JSON.stringify(this.context());}
 clippingMuted(clip){const p=this.w.getProject(),tracks=this.w.tracks||[],own=tracks.find(track=>track.index===clip.track),solo=track=>typeof this.w.trackSolo==='function'?this.w.trackSolo(track):!!track.channel?.solo||!!(track.clips?.length&&track.clips.every(item=>item.cloudRaw?.soloed||item.cloudRaw?.solo)),anySolo=tracks.some(solo),ownSolo=own?solo(own):false,muted=!!own?.channel?.mute||(p.mutedTracks||[]).includes(clip.track);return (anySolo||muted)&&!ownSolo;}
 available(){const w=this.w,p=w.getProject(),id=p.cloud?.projectId||p.id;return !this.destroyed&&this.isSupported()&&(typeof w.engine.canonicalReadable==='function'?w.engine.canonicalReadable(id):w.engine.ready&&!w.engine.loading&&(!w.engine.projectId||w.engine.projectId===id))&&typeof w.engine.session?.call==='function';}
 adopt(){const context=this.context(),scope=JSON.stringify(context);if(this.scopeKey!==scope){this.generation++;this.scopeKey=scope;this.records.clear();this.tiles.clear();if(context.projectId)this.tiles.setProject(context.projectId);}return context;}
 enqueue(run,signal){return new Promise((resolve,reject)=>{this.queue.push({run,signal,resolve,reject});this.drain();});}
 /** Waveform reads never compete with edits: none starts while a write is in
  * flight or queued; an already running read finishes. Hard bound: two. */
 /** Resume paused reads the moment a write ends (no polling latency). */
 watchWriteFlags(){const resume=()=>queueMicrotask(()=>{if(!this.destroyed&&this.queue.length)this.drain();});const watch=(target,name)=>{if(!target||typeof target!=='object')return;const own=Object.getOwnPropertyDescriptor(target,name);if(own&&(own.get||own.configurable===false))return;let value=target[name];try{Object.defineProperty(target,name,{configurable:true,enumerable:true,get:()=>value,set:next=>{value=next;if(!next)resume();}});}catch{}};watch(this.w,'busy');watch(this.w.engine,'applying');watch(this.w.engine,'inFlight');this.queueWatch=queue=>{if(queue&&queue!==this.watchedQueue){this.unwatchQueue?.();this.watchedQueue=queue;this.unwatchQueue=queue.onChange?.(depth=>{if(!depth)resume();});}};}
 writesBusy(){this.queueWatch?.(this.w.editQueue);const w=this.w,e=w.engine||{};return !!(e.applying||e.inFlight||e.pending||w.busy||w.editQueue?.busy||w.geometryHistory?.active||w.importView?.active);}
 drain(){if(this.queue.length&&this.writesBusy()){if(!this.resumeTimer)this.resumeTimer=setTimeout(()=>{this.resumeTimer=null;this.drain();},this.resumePollMs??100);return;}
  while(this.activeReads<this.maxConcurrent&&this.queue.length){if(this.writesBusy()){this.drain();return;}this.readsStarted++;const job=this.queue.shift();if(job.signal?.aborted){job.reject(abortError());continue;}this.activeReads++;Promise.resolve().then(job.run).then(job.resolve,job.reject).finally(()=>{this.activeReads--;this.drain();});}}
 record(clip){const id=clipIdentity(clip);if(!id)return null;const version=this.version(clip);let record=this.records.get(id);if(record?.version!==version&&this.retired.get(id)?.version===version){record=this.retired.get(id);this.retired.delete(id);this.records.set(id,record);}if(record?.version!==version){this.tiles.invalidateClip(id);record={id,version,metadata:null,metaPromise:null,error:null,windows:new Map()};this.records.set(id,record);}return record;}
 metadata(clip){if(!this.available()||this.scope()!==this.scopeKey)return null;const record=this.records.get(clipIdentity(clip));return record?.version===this.version(clip)?this.currentMeta(record,clip):null;}
 currentMeta(record,clip){return record.source?this.placement(clip,record.source):record.metadata;}
 current(record,clip,generation){return generation===this.generation&&this.available()&&this.scope()===this.scopeKey&&this.records.get(record.id)===record&&this.version(clip)===record.version&&(this.w.getProject().audioClips||[]).some(current=>clipIdentity(current)===record.id&&this.version(current)===record.version);}
 /** Source-frame REST reads may echo an old timeline start. Keep cached PCM
  * untouched; only the view projection uses its current canonical placement. */
 placement(clip,tile){
  if(!this.independent())return tile;const startMs=this.w.seconds(clip.start)*1000;if(!Number.isFinite(startMs)||startMs<0)throw new Error('The canonical waveform timeline placement is unavailable.');
  const rate=tile.sampleRate,offset=clip.offsetKnown===true?Math.round(this.w.seconds(clip.offset)*rate):tile.clipOffsetFrames,frames=Math.round(this.w.seconds(clip.length)*rate),gain=typeof clip.volume==='number'&&Number.isFinite(clip.volume)?clip.volume:tile.gain;
  // A recorded take's saved length can exceed its decoded source by a codec tail: the window never runs past the source.
  const safeOffset=Number.isSafeInteger(offset)&&offset>=0&&offset<tile.frameCount?offset:tile.clipOffsetFrames;
  return Object.freeze({...tile,startMs,clipOffsetFrames:safeOffset,clipFrameCount:Number.isSafeInteger(frames)&&frames>0?Math.max(1,Math.min(frames,tile.frameCount-safeOffset)):tile.clipFrameCount,gain,reportedStartMs:tile.startMs});
 }
 async bootstrap(record,clip,generation){
  if(record.source)return this.currentMeta(record,clip);if(record.metadata)return record.metadata;if(record.metaPromise)return record.metaPromise;if(record.error)throw record.error;
  const root=this.independent()?this.sourceOf(record.id):record.id,rootRecord=root!==record.id?(this.records.get(root)??this.retired.get(root)):null;if(rootRecord?.source){record.source=rootRecord.source;record.metadata=this.placement(clip,rootRecord.source);this.onMetadata(clip,record.metadata);return record.metadata;}
  const trackId=record.id==='backing'?this.context().trackId:record.id;record.metaPromise=this.tiles.request({clipId:record.id,...(trackId?{trackId}:{}),buckets:this.overviewBuckets()}).then(sourceTile=>{
   if(!this.current(record,clip,generation))throw abortError();const tile=this.placement(clip,sourceTile);
   const start=this.w.seconds(clip.start),duration=this.w.seconds(clip.length),tolerance=1/tile.sampleRate+1e-9;
   if(Math.abs(tile.startMs/1000-start)>1e-6||Math.abs(sourceTile.clipFrameCount/tile.sampleRate-duration)>tolerance&&!this.sourceTail(sourceTile,duration)||clip.offsetKnown===true&&Math.abs(this.w.seconds(clip.offset)-sourceTile.clipOffsetFrames/tile.sampleRate)>tolerance||this.independent()&&typeof clip.volume==='number'&&Number.isFinite(clip.volume)&&Math.abs(clip.volume-sourceTile.gain)>1e-7)throw new Error('The cloud waveform placement differs from the current clip. Refresh the project before loading it.');
   if(this.independent()){record.source=sourceTile;this.adoptSource(record,sourceTile);}record.metadata=tile;record.resolveReady?.(tile);this.onMetadata(clip,tile);this.paint(clip);return tile;
  }).catch(error=>{if(this.current(record,clip,generation)&&error.name!=='AbortError'){record.error=error;record.rejectReady?.(error);if(engineNotLoaded(error))this.w.waveformRecovery?.wait(clip);}throw error;});return record.metaPromise;
 }
 coveringTile(want,records){for(const candidate of records){if(!candidate)continue;for(const state of candidate.windows.values()){const tile=state.status==='ready'?state.source:null;if(tile&&waveformTileCovers(tile,{...want,clipId:tile.clipId}))return tile;}}return null;}
 descriptorKey(options){return JSON.stringify([options.startSec,options.endSec,Math.ceil(options.width)]);}
 plan(metadata,options){return planWaveformWindow({clipStartSec:0,clipOffsetFrames:metadata.clipOffsetFrames,clipFrameCount:metadata.clipFrameCount,sourceFrameCount:metadata.frameCount,sampleRate:metadata.sampleRate,leftSec:options.startSec,width:options.width,pixelsPerSecond:options.width/(options.endSec-options.startSec)});}
 load(clip,options){
  this.adopt();const record=this.record(clip);if(!record||!this.canReadClip(clip))return Promise.resolve(null);const key=this.descriptorKey(options),existing=record.windows.get(key);if(record.desiredKey!==key){const previous=record.windows.get(record.desiredKey);if(previous?.status==='loading')previous.status='stale';record.desiredKey=key;this.tiles.cancelRanges(record.id);}if(existing&&existing.status!=='stale'){if(existing.status==='ready'&&existing.source)existing.tile=this.placement(clip,existing.source);return existing.promise;}
  const generation=this.generation,state={status:'loading',tile:null,error:null,promise:null};record.windows.set(key,state);
  while(record.windows.size>6){const old=[...record.windows].find(([oldKey,value])=>oldKey!==key&&value.status!=='loading');if(!old)break;record.windows.delete(old[0]);}
  state.promise=Promise.resolve().then(async()=>{
   if(!this.current(record,clip,generation)||record.desiredKey!==key)throw abortError();const metadata=await this.bootstrap(record,clip,generation);if(!this.current(record,clip,generation)||record.desiredKey!==key)throw abortError();const plan=this.plan(metadata,options);if(!plan){state.status='empty';return state;}
   const root=this.independent()?this.sourceOf(record.id):record.id,want={clipId:metadata.clipId??root,revision:metadata.revision,startFrame:plan.startFrame,endFrame:plan.endFrame,buckets:plan.buckets},covering=null;
   const readId=this.independent()&&root!==record.id&&(this.w.getProject().audioClips||[]).some(row=>clipIdentity(row)===root)?root:record.id,trackId=readId==='backing'?this.context().trackId:readId,sourceTile=this.independent()?await this.pyramidWindow(record,metadata,plan,readId,()=>this.current(record,clip,generation)&&record.desiredKey===key):await this.tiles.request({clipId:readId,revision:metadata.revision,...(trackId?{trackId}:{}),startFrame:plan.startFrame,endFrame:plan.endFrame,buckets:plan.buckets});
   if(!this.current(record,clip,generation)||record.desiredKey!==key)throw abortError();const tile=this.placement(clip,sourceTile);if(tile.sampleRate!==metadata.sampleRate||tile.frameCount!==metadata.frameCount||String(tile.revision)!==String(metadata.revision)||!this.independent()&&(tile.clipOffsetFrames!==metadata.clipOffsetFrames||tile.clipFrameCount!==metadata.clipFrameCount||tile.startMs!==metadata.startMs||tile.gain!==metadata.gain))throw new Error('The cloud waveform source or placement changed during its range read. Reload it.');
   state.status='ready';state.tile=tile;state.source=this.independent()?sourceTile:null;record.fallback=null;this.paint(clip);return state;
  }).catch(error=>{if(this.current(record,clip,generation)&&record.desiredKey===key&&error.name!=='AbortError'){state.status='error';state.error=error;if(engineNotLoaded(error))this.w.waveformRecovery?.wait(clip);this.paint(clip);}else state.status='stale';return state;}).finally(()=>{while(record.windows.size>6){const old=[...record.windows].find(([oldKey,value])=>oldKey!==record.desiredKey&&value.status!=='loading');if(!old)break;record.windows.delete(old[0]);}});return state.promise;
 }
 coveringReadyWindow(record,clip,options){
  let best=null,bestDensity=-1;
  for(const row of record?.windows?.values?.()||[]){
   if(row?.status!=='ready'||!(row.tile||row.source||row.optimistic))continue;
   let tile;try{tile=row.optimistic?this.placement(clip,row.optimistic):row.source?this.placement(clip,row.source):row.tile;}catch{continue;}
   if(!tile||!Number.isFinite(tile.sampleRate))continue;
   const start=tile.clipOffsetFrames+options.startSec*tile.sampleRate,end=tile.clipOffsetFrames+options.endSec*tile.sampleRate;
   if(tile.startFrame>start+1||tile.endFrame<end-1)continue;
   const density=tile.bucketCount/Math.max(1,tile.endFrame-tile.startFrame);
   if(density>bestDensity){best=row;bestDensity=density;}
  }
  return best;
 }
 html(clip,options){
  if(!this.available()||clip.patternId||!clipIdentity(clip))return null;if(!this.canReadClip(clip))return this.unavailableHtml(clip,'Loading audio in cloud engine…');let record=this.scope()===this.scopeKey?this.records.get(clipIdentity(clip)):null;const current=record?.version===this.version(clip);let state=current?record.windows.get(this.descriptorKey(options)):null;
  // A refreshed source keeps its previous (or drawn) body until the new one is ready: never blank.
  if(current&&record.fallback&&state?.status!=='ready'){const fallback=record.fallback,previous=fallback.windows.get(this.descriptorKey(options))??[...fallback.windows.values()].find(row=>row.status==='ready');if(previous?.status==='ready'){record=fallback;state=previous;}else if(fallback.metadata){record=fallback;state=null;}}
  // Zooming / scrolling: while the new window loads, keep drawing the sharpest
  // already-loaded tile that covers the view (Audacity never blanks a track;
  // it rescales what it has and sharpens when the detail arrives).
  // Only while the window is missing or loading: an error or an empty range must still show.
  // (Independent source reads compose the view from the peak pyramid instead: finest held data per region.)
  if(current&&(!state||state.status==='loading')&&!(this.independent()&&this.pyramid.has(this.pyramidKey(clipIdentity(clip))))){const cover=this.coveringReadyWindow(record,clip,options);if(cover)state=cover;}
  // The bootstrap is real bounded full-source data, useful immediately while
  // exact viewport chunks load. It remains separate from every ready window:
  // no sample hit-test or precise read can consume this provisional overview.
  const composed=this.composedView(clip,options,state,current?record:null);
  const detailFailure=state?.status==='error'&&state.error&&isTransientWaveformReadError(state.error),overview=current&&record.metadata&&!record.error&&(!state?.error||detailFailure)&&state?.status!=='empty'&&state?.status!=='ready'&&record.metadata.bucketCount<record.metadata.endFrame-record.metadata.startFrame&&!composed;// metadata is the cached source; placement is applied below
  if(state?.status==='ready'||overview||composed){
   const envelopeView=this.w.envelopeView,hasWaveformState=typeof envelopeView?.waveformState==='function',envelopeState=hasWaveformState?envelopeView.waveformState(clip):null;
   // Source PCM is pre-envelope. Drawing it as unity while its independent
   // gain-curve read is pending would show a false amplitude and overload flag.
   // Keep the exact frame tile cached; envelope completion only repaints it.
   // A pending gain curve never hides the source waveform (split/move/paste keep painting from cached PCM);
   // it paints provisionally (no clipping marks) and repaints when the curve arrives. Only an error replaces it.
   const envelopePending=hasWaveformState&&envelopeState?.status==='pending';
   if(hasWaveformState&&!envelopePending&&(envelopeState?.status!=='ready'||!envelopeState.envelope)){
    const message=envelopeState?.status==='pending'?'Loading cloud gain envelope…':'Cloud waveform unavailable: '+(envelopeState?.reason||'The cloud gain envelope is unavailable.');
    return this.unavailableHtml(clip,message,envelopeState?.status!=='pending');
   }
   const tile=composed?this.placement(clip,composed.tile):overview?this.currentMeta(record,clip):state.optimistic?this.placement(clip,state.optimistic):state.source?this.placement(clip,state.source):state.tile,startFrame=tile.clipOffsetFrames+options.startSec*tile.sampleRate,endFrame=tile.clipOffsetFrames+options.endSec*tile.sampleRate,envelope=hasWaveformState?(envelopePending?null:envelopeState.envelope):envelopeView?.controller?.get?.(clip)?.envelope,visualOptions=this.w.waveformOptions?.(clip);
   const svg=sourceWaveformSvg(tile,{width:options.width,height:options.height,startFrame,endFrame,envelope,displayForChannel:channel=>this.w.amplitudeView?.displayForClip(clip,channel),channelLayout:this.channelLayout(clip)??options.channelLayout,showClipping:!overview&&!(composed&&!composed.complete)&&!envelopePending&&(visualOptions?.showClipping??(this.w.displayPreferences?.get?.()?.showClipping===true)),clippingMuted:visualOptions?.clippingMuted??this.clippingMuted(clip),fillWide:!!composed||state?.status==='ready'&&this.independent()});
   const badge=clip.engineLoaded===false?'<span class="au-waveform-unavailable au-waveform-live-pending" role="status">Saved audio; live playback needs verification</span>':'';
   let marked=envelopePending?svg.replace('<svg ','<svg data-envelope-pending="true" aria-busy="true" '):svg;
   // Cached peaks are drawn as they are (stretched if coarser) while finer tiles load: no placeholder ever replaces them.
   if(composed)return marked.replace('<svg ',`<svg data-waveform-cached="${composed.complete?'complete':'coarse'}" `)+(detailFailure?this.unavailableHtml(clip,'Detailed waveform unavailable — Retry. Showing the cached waveform.',true):'')+badge;
   return (overview?marked.replace('<svg ',`<svg data-waveform-overview="true" aria-busy="${detailFailure?'false':'true'}" `)+this.unavailableHtml(clip,detailFailure?'Detailed waveform unavailable — Retry. Showing the verified overview.':'Loading detailed waveform…',!!detailFailure):marked)+badge;
  }
  const error=state?.error??record?.error;if(error&&this.w.waveformRecovery?.pending(clip,error))return this.unavailableHtml(clip,'Loading cloud waveform…');return this.unavailableHtml(clip,error?'Cloud waveform unavailable: '+error.message:state?.status==='empty'?'No source frames in view':'Loading cloud waveform…',!!error);
 }
 unavailableHtml(clip,message,retry=false){return `<span class="au-waveform-unavailable" role="status">${retry?`<button type="button" class="au-waveform-retry" data-waveform-retry="${esc(clipIdentity(clip))}" aria-label="Retry waveform and gain envelope"${this.retries.has(JSON.stringify([this.scope(),clipIdentity(clip)]))?' disabled':''}>Retry</button> `:''}${esc(message)}</span>`;}
 retryBlocked(){const w=this.w;return !!(w.busy||w.engine.applying||w.engine.interacting||w.engine.session?.closed||w.clipGesture||w.selectionGesture?.active||w.envelopeView?.active||w.trackLayout?.active||w.amplitudeView?.active||w.multiToolView?.active||w.loopRegion?.active||w.panGesture||w.viewport?.pinDrag);}
 /** Explicit read-only retry. Wait for an existing envelope save before
  * invalidating this clip; neither another clip nor an audio write is retried.
  */
 retry(clip){
  const scope=this.scope(),id=clipIdentity(clip),version=this.version(clip),key=JSON.stringify([scope,id]);if(this.retries.has(key))return this.retries.get(key);
  const current=()=>{if(!this.available()||this.scope()!==scope||this.retryBlocked())throw abortError();const resolved=(this.w.getProject().audioClips||[]).find(candidate=>clipIdentity(candidate)===id&&String(candidate.id)===String(clip.id)&&this.version(candidate)===version);if(!resolved)throw abortError();return resolved;};
  try{current();}catch(error){return Promise.reject(error);}
  const task=(async()=>{await this.w.envelopeView?.controller?.saveQueue;const resolved=current(),element=this.element(resolved);if(!element)return null;const options=this.options(resolved,element);if(![options.startSec,options.endSec,options.width,options.height].every(Number.isFinite)||options.endSec<=options.startSec||options.width<=0)return null;
   this.adopt();this.tiles.invalidateClip(id);this.records.delete(id);const waveform=this.load(resolved,options),envelope=typeof this.w.envelopeView?.load==='function'?this.w.envelopeView.load(resolved,{force:true}):Promise.resolve();const results=await Promise.allSettled([waveform,envelope]);current();for(const result of results)if(result.status==='rejected')throw result.reason;this.paint(resolved);return results[0].value;
  })();
  const pending=task.finally(()=>{if(this.retries.get(key)===pending)this.retries.delete(key);if(this.scope()===scope&&this.available())this.paint(clip);});this.retries.set(key,pending);this.paint(clip);return pending;
 }
 destroy(){this.destroyed=true;this.tiles.clear();this.records.clear();this.w.root.removeEventListener('click',this.retryClick,true);}
 /** Takes recorded before Freestyle's #5 fix were saved exactly 1024 frames (one encoder block, ~21 ms at 48 kHz)
  *  longer than their PCM, and those rows were not corrected. New takes store their true length and match exactly,
  *  so only that legacy block is accepted (no general tolerance), and only when the clip runs to the source end. */
 sourceTail(tile,durationSec){const extra=Math.round(durationSec*tile.sampleRate-tile.clipFrameCount);return this.independent()&&Math.abs(extra-LEGACY_TAKE_TAIL_FRAMES)<=1&&tile.clipOffsetFrames+tile.clipFrameCount===tile.frameCount;}
 /** Peak pyramid (independent source reads only): every measured tile is kept per source and revision. */
 overviewBuckets(){return this.independent()?Math.max(WAVEFORM_READ_BUCKET_LIMIT,Math.min(2048,this.w.waveformReadBucketLimit??WAVEFORM_READ_BUCKET_LIMIT)):WAVEFORM_READ_BUCKET_LIMIT;}
 pyramidKey(id){const p=this.w.getProject();return this.pyramid.key(p.cloud?.projectId||p.id,this.sourceOf(id));}
 adoptSource(record,sourceTile){
  const p=this.w.getProject(),projectId=p.cloud?.projectId||p.id;
  // The same PCM under another clip id (a split / pasted / reloaded piece) shares the tiles already held.
  if(this.sourceOf(record.id)===record.id){const twin=this.pyramid.findSame(projectId,sourceTile,this.pyramid.key(projectId,record.id));if(twin&&twin!==record.id)this.aliasSource(record.id,twin);}
  this.pyramid.add(this.pyramidKey(record.id),sourceTile);
 }
 /** Synchronous view of the visible range from held peaks; null when nothing is held or a real state must show. */
 composedView(clip,options,state,record){
  if(!this.independent()||state?.status==='ready'||state?.status==='empty'||record?.error)return null;
  if(state?.status==='error'&&!(state.error&&isTransientWaveformReadError(state.error)))return null;
  const key=this.pyramidKey(clipIdentity(clip)),source=this.pyramid.source(key);if(!source?.segments.length)return null;
  try{const placed=this.placement(clip,source.template);return this.pyramid.compose(key,{startFrame:placed.clipOffsetFrames+options.startSec*placed.sampleRate,endFrame:placed.clipOffsetFrames+options.endSec*placed.sampleRate,columns:Math.max(1,Math.ceil(options.width))});}catch{return null;}
 }
 paintSource(key){for(const clip of this.w.getProject().audioClips||[]){const id=clipIdentity(clip);if(id&&this.pyramidKey(id)===key)this.paint(clip);}}
 /** Exact window from the pyramid. Missing detail is read as aligned level tiles (reused by any later scroll or zoom);
  * each arriving tile repaints at once. A tile nobody wants any more is dropped before it is sent; a sent one is kept. */
 async pyramidWindow(record,metadata,plan,readId,live){
  const key=this.pyramidKey(record.id),want={startFrame:plan.startFrame,endFrame:plan.endFrame,columns:plan.buckets};
  this.pyramid.tileBuckets=Math.max(WAVEFORM_READ_BUCKET_LIMIT,Math.min(4096,this.w.waveformReadBucketLimit??WAVEFORM_READ_BUCKET_LIMIT));
  if(this.pyramid.revision(key)!==String(metadata.revision)&&record.source)this.pyramid.add(key,record.source);
  let composed=this.pyramid.compose(key,want);
  if(!composed?.complete){
   const span=plan.endFrame-plan.startFrame,visible=this.pyramid.tilesFor(key,want),level=visible[0]?.level,around=level?this.pyramid.tilesFor(key,{startFrame:Math.max(0,plan.startFrame-(span>>1)),endFrame:plan.endFrame+(span>>1),columns:plan.buckets,level}).filter(tile=>!visible.some(row=>row.id===tile.id)):[];
   record.wanted=new Set([...visible,...around].map(tile=>tile.id));
   const reads=visible.filter(tile=>!tile.held).map(tile=>this.pyramidRead(key,readId,metadata.revision,tile));
   for(const tile of around)if(!tile.held)this.pyramidRead(key,readId,metadata.revision,tile).catch(()=>{});
   await Promise.all(reads);if(!live())throw abortError();
   composed=this.pyramid.compose(key,want);
  }else record.wanted=null;
  if(!composed)throw new Error('The cloud waveform source is unavailable. Retry.');
  return Object.freeze({...composed.tile,clipId:record.source?.clipId??composed.tile.clipId});
 }
 pyramidRead(key,readId,revision,tile){
  const id=key+'\n'+tile.id,existing=this.pyramidReads.get(id);if(existing)return existing;
  const context=this.context(),projectId=context.projectId,trackId=readId==='backing'?context.trackId:readId,wanted=()=>[...this.records.values()].some(row=>row.wanted?.has(tile.id)&&this.pyramidKey(row.id)===key),held=()=>this.pyramid.revision(key)===String(revision);
  const promise=this.enqueue(()=>{if(this.destroyed||!wanted()||!held())throw abortError();return this.transport({projectId,clipId:readId,revision:String(revision),...(trackId?{trackId}:{}),startFrame:tile.startFrame,endFrame:tile.endFrame,buckets:tile.buckets,isCurrent:()=>!this.destroyed&&held()});})
   .then(measured=>{if(!this.destroyed&&held()){this.pyramid.add(key,measured);this.paintSource(key);}return measured;},error=>{/* The source changed under us: held peaks are no longer this clip's audio. */if(/source revision changed/.test(error?.message||'')&&held())this.pyramid.drop(key);throw error;}).finally(()=>{if(this.pyramidReads.get(id)===promise)this.pyramidReads.delete(id);});
  this.pyramidReads.set(id,promise);return promise;
 }
 channelLayout(clip){
  const view=this.w.envelopeView,capture=view?.active,held=capture?.clip;
  if(held&&Object.hasOwn(capture,'channelLayout')&&(held.cloudId||held.id)===(clip.cloudId||clip.id)&&held.track===clip.track&&(held.laneId??null)===(clip.laneId??null)&&(typeof view.binding!=='function'||view.binding(held)===view.binding(clip)))return capture.channelLayout;
  return this.w.channelLayoutForClip?.(clip)??this.w.trackLayout?.layoutForClip?.(clip);
 }
 element(clip){return this.w.root.querySelector(`.au-clip[data-clip="${CSS.escape(String(clip.id))}"]`);}
 options(clip,element){const start=this.w.seconds(clip.start),startSec=Number(element.dataset.windowStartSec)-start,endSec=Number(element.dataset.windowEndSec)-start,width=Number.parseFloat(element.style.width),measuredHeight=element.querySelector('.au-clip-body')?.getBoundingClientRect?.().height,height=Number.isFinite(measuredHeight)&&measuredHeight>0?measuredHeight:Math.max(1,Number.parseFloat(element.closest('.au-track')?.style.height||String(DEFAULT_TRACK_HEIGHT_PX))-42);return {startSec,endSec,width,height,channelLayout:this.channelLayout(clip)};}
 paint(clip){
  const element=this.element(clip);if(!element)return;const options=this.options(clip,element);if(![options.startSec,options.endSec,options.width,options.height].every(Number.isFinite)||options.endSec<=options.startSec)return;const html=this.html(clip,options);if(html===null)return;const body=element.querySelector('.au-clip-body');for(const node of body.querySelectorAll('.au-waveform,.au-source-waveform,.au-waveform-unavailable'))node.remove();body.insertAdjacentHTML('afterbegin',html);
 }
 sync(){
  if(!this.available())return;this.adopt();const clips=this.w.getProject().audioClips||[],byId=new Map(clips.map(clip=>[String(clip.id),clip])),viewport=this.w.scroll.getBoundingClientRect();
  for(const element of this.w.root.querySelectorAll('.au-clip')){
   const clip=byId.get(element.dataset.clip);if(!clip||!clipIdentity(clip))continue;const rect=element.getBoundingClientRect();if(viewport.bottom>viewport.top&&rect.bottom>rect.top&&(rect.bottom<=viewport.top+31||rect.top>=viewport.bottom))continue;
   const options=this.options(clip,element);if(![options.startSec,options.endSec,options.width,options.height].every(Number.isFinite)||options.startSec<0||options.endSec<=options.startSec||options.width<=0)continue;this.load(clip,options);this.paint(clip);
  }
  for(const [id,record]of this.records)if(!clips.some(clip=>clipIdentity(clip)===id)){this.records.delete(id);if(this.independent()&&record.source){this.retired.set(id,record);while(this.retired.size>32)this.retired.delete(this.retired.keys().next().value);}else this.tiles.invalidateClip(id);}
 }
 /** Source changed by a sample edit (Pencil commit/Undo/Redo): refetch ONLY that
  * source in the background. Each affected clip keeps its previous (or drawn)
  * body on screen until the new PCM arrives; other clips are untouched. */
 refreshSource(clipId,{revision}={}){
  const root=this.sourceOf(clipId),ids=new Set([clipId,root,...[...this.aliases].filter(([,source])=>this.sourceOf(source)===root).map(([id])=>id)]);let ready=null;
  for(const id of ids){this.retired.delete(id);this.tiles.invalidateClip(id);const old=this.records.get(id);if(!old)continue;let resolveReady,rejectReady;const promise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});promise.catch(()=>{});const next={id,version:old.version,metadata:null,metaPromise:null,error:null,windows:new Map(),fallback:old.fallback??old,expectedRevision:revision,resolveReady,rejectReady,ready:promise};this.records.set(id,next);if(id===clipId)ready=promise;}
  this.sync();return ready??Promise.resolve(null);
 }
 /** Show the drawn samples on the current window while the write is in flight. */
 holdOptimistic(clip,tile,{matchWindow=false}={}){
  // matchWindow: only overlay a ready window (current or the refetch's fallback)
  // with the same source frames and bucket grid, so a zoomed/scrolled view is never misdrawn.
  const record=this.records.get(clipIdentity(clip));if(!record||!tile)return null;const same=state=>{const shown=state.optimistic??state.source??state.tile;return !!shown&&shown.startFrame===tile.startFrame&&shown.endFrame===tile.endFrame&&shown.bucketCount===tile.bucketCount;};
  const states=matchWindow?[record,record.fallback].filter(Boolean).flatMap(row=>[...row.windows.values()]).filter(state=>state.status==='ready'&&same(state)):[record.windows.get(record.desiredKey)].filter(state=>state?.status==='ready');
  if(!states.length)return null;const previous=states.map(state=>[state,state.optimistic]);for(const state of states)state.optimistic=tile;this.paint(clip);
  return ()=>{for(const [state,value]of previous){if(value===undefined)delete state.optimistic;else state.optimistic=value;}this.paint(clip);};
 }
 clearOptimistic(clip){const record=this.records.get(clipIdentity(clip));for(const row of [record,record?.fallback])for(const state of row?.windows?.values?.()??[])delete state.optimistic;this.paint(clip);}
 /** Explicit source change (Pencil, region effect): drop that source's PCM and every alias of it. */
 reload(clipId){if(clipId===undefined){this.tiles.clear();this.records.clear();this.retired.clear();this.aliases.clear();}else{const root=this.sourceOf(clipId),ids=new Set([clipId,root,...[...this.aliases].filter(([,source])=>this.sourceOf(source)===root).map(([id])=>id)]);for(const id of ids){this.tiles.invalidateClip(id);this.records.delete(id);this.retired.delete(id);}this.aliases.delete(clipId);}this.sync();}
}
