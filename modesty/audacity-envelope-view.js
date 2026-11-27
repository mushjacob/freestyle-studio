import {paintLegacyWaveform} from './audacity-legacy-waveform-view.js';
import {LEGACY_AUTOMATION_CONTRACT,automationContractFromTools} from './audacity-automation-contract.js';
import {NATIVE_ENVELOPE_MIN_GAIN,NATIVE_ENVELOPE_MAX_GAIN,InlineEnvelopeController,canonicalEnvelopeClipId,clipEnvelopeWindow,waveformEnvelopeWindow,envelopeChannelsGeometry,envelopeChannelAt,envelopePointAt,envelopeHandleAt,envelopeDisplayWindow} from './audacity-envelope.js';
import {channelRows} from './audacity-channel-layout.js';
import {AudacityEnvelopeHistory} from './audacity-envelope-history-view.js';
import {TRACK_GUTTER_PX} from './audacity-layout.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const svgNS='http://www.w3.org/2000/svg';
const sourceBinding=(clip,bpm)=>JSON.stringify([canonicalEnvelopeClipId(clip),bpm,clip.start,clip.length,clip.offset,clip.offsetKnown,clip.sourceLength,clip.cloudRaw?.audioOffsetSec,clip.cloudRaw?.audioFullDurationSec,clip.cloudRaw?.effects?.timing]);
const metadataBinding=metadata=>JSON.stringify([metadata?.clipId,metadata?.revision,metadata?.sampleRate,metadata?.frameCount,metadata?.clipOffsetFrames,metadata?.clipFrameCount,metadata?.startMs]);
const envelopeBinding=(clip,bpm)=>JSON.stringify([sourceBinding(clip,bpm),clip.volume,clip.audioFileId,clip.sourceId,clip.cloudRaw??null]);

/** A clip's native gain envelope is drawn over its waveform, never rendered as local audio. */
export class AudacityEnvelopeView {
 constructor(workspace,{batchSize=8,maxConcurrentReads=2}={}){
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>8||!Number.isInteger(maxConcurrentReads)||maxConcurrentReads<1||maxConcurrentReads>2)throw new Error('Envelope hydration supports 1–8 clips per read and at most two concurrent reads.');
  this.workspace=workspace;this.active=null;this.metadataWindows=new Map();this.batchSize=batchSize;this.maxConcurrentReads=maxConcurrentReads;this.readQueue=new Map();this.readActive=0;this.readFallbacks=new Set();this.readWaiters=new Set();
  this.controller=new InlineEnvelopeController({
   getProject:()=>workspace.getProject(),notifyDiagnostics:false,
   resolveWindow:(clip,bpm)=>this.resolveWindow(clip,bpm),
   getContext:()=>this.readContext(),getClipBinding:clip=>this.binding(clip),isCurrentClip:clip=>this.currentClip(clip),
   getAutomationContract:()=>this.automationContract(),
   beforeBegin:()=>{workspace.assertOwnedEditsSettled?.();this.envelopeHistory?.assertSettled();},prepareWrite:async()=>{workspace.assertOwnedEditsSettled?.();this.envelopeHistory?.assertSettled();await workspace.engine.flush();workspace.assertOwnedEditsSettled?.();this.envelopeHistory?.assertSettled();},cloudCall:(name,args)=>workspace.engine.session.call(name,args),
   onChange:(_state,clip)=>this.paint(clip),
   onSaved:(state,clip)=>{this.envelopeHistory.register(state.writeReceipt);this.paint(clip);},
  });
  this.envelopeHistory=new AudacityEnvelopeHistory(this);this.past=this.envelopeHistory.past;this.future=this.envelopeHistory.future;
 }
 history(direction){return this.envelopeHistory.history(direction);}
 uncertain(projectId){return this.envelopeHistory.uncertain(projectId);}
 unverified(projectId){return this.envelopeHistory.unverified(projectId);}
 clearFuture(projectId){return this.envelopeHistory.clearFuture(projectId);}
 reconcile(){return this.envelopeHistory.reconcile();}
 clips(){const p=this.workspace.getProject();return [...p.clips,...(p.audioClips||[])];}
 adoptAutomationCapabilities(data){this.detectedAutomationContract=data?.connected===true&&data.source==='live'&&this.readAvailable()?automationContractFromTools(data.tools):LEGACY_AUTOMATION_CONTRACT;this.automationCapabilityContext=this.readContext();return this.detectedAutomationContract;}
 automationContract(){const explicit=this.workspace.automationContract;return explicit!==undefined?(typeof explicit==='function'?explicit():explicit):this.readAvailable()&&this.automationCapabilityContext===this.readContext()?this.detectedAutomationContract??LEGACY_AUTOMATION_CONTRACT:LEGACY_AUTOMATION_CONTRACT;}
 readContext(){const w=this.workspace,e=w.engine;return JSON.stringify([this.metadataScope(),e.canonicalScope?.()??e.projectId,e.session?.projectId,e.session?.trackId,e.loadVersion||0,e.session?.contextVersion||0,e.session?.closed===true]);}
 readAvailable(){const e=this.workspace.engine,id=this.metadataScope();if(typeof e.canonicalReadable==='function')return e.canonicalReadable(id);return e.ready===true&&!e.loading&&!e.session?.closed&&(!e.projectId||e.projectId===id)&&(!e.session?.projectId||e.session.projectId===id)&&typeof e.session?.call==='function';}
 binding(clip){return envelopeBinding(clip,this.workspace.getProject().bpm);}
 currentClip(clip){if(!this.readAvailable())return false;const id=canonicalEnvelopeClipId(clip),binding=this.binding(clip);return this.clips().some(current=>canonicalEnvelopeClipId(current)===id&&this.binding(current)===binding);}
 waveformState(clip){
  if(this.metadataScope())this.controller.scope();
  if(!this.readAvailable())return this.workspace.engine?.loading?{status:'connecting',envelope:null,reason:'Loading waveform…'}:{status:'unavailable',envelope:null,reason:'Connect the live cloud project to read its gain envelope.'};
  const state=this.controller.get(clip,{diagnostics:false});if(!state||state.loading)return {status:'pending',envelope:null,reason:'Reading cloud gain envelope…'};
  if(!state.envelope||state.needsReload)return {status:'unavailable',envelope:null,reason:state.error||'The cloud gain envelope is unavailable.'};
  if(!state.window.offsetKnown)return {status:'unavailable',envelope:null,reason:'The clip source offset is unavailable.'};
  const envelope=state.envelope,points=envelope.points;let sameTime=0;const valid=points.every((point,index)=>{sameTime=index>0&&point.timeSec===points[index-1].timeSec?sameTime+1:1;return typeof point.timeSec==='number'&&Number.isFinite(point.timeSec)&&point.timeSec>=0&&typeof point.value==='number'&&Number.isFinite(point.value)&&(index===0||point.timeSec>=points[index-1].timeSec)&&sameTime<=2;});
  if(!valid||!points.length&&!(typeof envelope.defaultValue==='number'&&Number.isFinite(envelope.defaultValue)))return {status:'unavailable',envelope:null,reason:'Freestyle has not returned a complete finite gain curve or a known default.'};
  return {status:'ready',envelope,reason:''};
 }
 visibleClips(){const viewport=this.workspace.scroll?.getBoundingClientRect?.();return this.clips().filter(clip=>{if(clip.patternId||!clip.cloudId&&clip.id!=='backing'&&!clip.isBacking)return false;const el=this.element(clip);if(!el||el.style.visibility==='hidden')return false;const rect=el.getBoundingClientRect();return !(viewport?.bottom>viewport?.top&&rect.bottom>rect.top&&(rect.bottom<=viewport.top+31||rect.top>=viewport.bottom));});}
 hydrateVisible(){
  if(this.metadataScope())this.controller.scope();
  const context=this.readContext();if(this.hydrationContext!==context){this.hydrationContext=context;this.readQueue.clear();this.readFallbacks.clear();}
  if(!this.readAvailable()){this.readQueue.clear();this.settleReads();return;}
  const clips=this.visibleClips(),visible=new Set(clips.map(canonicalEnvelopeClipId));for(const id of this.readQueue.keys())if(!visible.has(id))this.readQueue.delete(id);
  for(const clip of clips){const id=canonicalEnvelopeClipId(clip),state=this.controller.get(clip,{diagnostics:false});if(!state&&!this.readQueue.has(id))this.readQueue.set(id,{clip,context,binding:this.binding(clip),individual:false,force:false});}
  this.drainReads();this.settleReads();
 }
 drainReads(){
  while(this.readActive<this.maxConcurrentReads&&this.readQueue.size&&this.readAvailable()){
   const jobs=[];for(const [id,job]of this.readQueue){if(jobs.length&&(jobs[0].individual||job.individual))break;this.readQueue.delete(id);if(job.context!==this.readContext()||job.binding!==this.binding(job.clip)||!this.currentClip(job.clip))continue;const state=this.controller.get(job.clip,{diagnostics:false});if(state?.loading||state?.saving||state&&!job.force)continue;jobs.push(job);if(job.individual||jobs.length===this.batchSize)break;}if(!jobs.length)continue;
   this.readActive++;this.controller.loadMany(jobs.map(job=>job.clip),{force:jobs.some(job=>job.force)}).catch(error=>{if(error.retryIndividual&&jobs.length>1)for(const job of jobs){const id=canonicalEnvelopeClipId(job.clip),key=JSON.stringify([job.context,id,job.binding]);if(job.context===this.readContext()&&job.binding===this.binding(job.clip)&&this.currentClip(job.clip)&&!this.readFallbacks.has(key)){this.readFallbacks.add(key);this.readQueue.set(id,{...job,individual:true,force:true});}}}).finally(()=>{this.readActive--;this.hydrateVisible();});
  }
 }
 settleReads(){if(!this.readActive&&!this.readQueue.size){for(const resolve of this.readWaiters)resolve();this.readWaiters.clear();}}
 whenHydrated(){return !this.readActive&&!this.readQueue.size?Promise.resolve():new Promise(resolve=>this.readWaiters.add(resolve));}
 metadataScope(){const p=this.workspace.getProject();return p.cloud?.projectId||p.id;}
 resolveWindow(clip,bpm){
  const base=clipEnvelopeWindow(clip,bpm);if(base.offsetKnown)return base;
  const entry=this.metadataWindows.get(canonicalEnvelopeClipId(clip)),metadata=this.workspace.waveformView?.metadata?.(clip);
  if(!entry||entry.scope!==this.metadataScope()||entry.context!==this.readContext()||entry.clipBinding!==sourceBinding(clip,bpm)||metadata&&entry.metadataBinding!==metadataBinding(metadata)||!this.clips().includes(clip))return base;
  return entry.window;
 }
 adoptWaveformMetadata(clip){
  const state=this.controller.get(clip,{diagnostics:false}),gesture=this.controller.gesture;
  if(this.active?.clip===clip||gesture?.clip===clip||state?.saving)return false;
  const bpm=this.workspace.getProject().bpm,base=clipEnvelopeWindow(clip,bpm),metadata=this.workspace.waveformView?.metadata?.(clip),resolved=waveformEnvelopeWindow(clip,metadata,bpm),key=canonicalEnvelopeClipId(clip),scope=this.metadataScope();
  if(this.adoptedMetadataScope!==scope){this.metadataWindows.clear();this.adoptedMetadataScope=scope;}
  const adopted=!base.offsetKnown&&resolved.offsetKnown&&this.clips().includes(clip);
  if(adopted)this.metadataWindows.set(key,{scope,context:this.readContext(),clipBinding:sourceBinding(clip,bpm),metadataBinding:metadataBinding(metadata),window:resolved});else this.metadataWindows.delete(key);
  this.paint(clip);this.hydrateVisible();return adopted;
 }
 displayBounds(element){const start=element?.dataset.windowStartSec,end=element?.dataset.windowEndSec;return {...(start!==undefined?{visibleStartSec:Number(start)}:{}),...(end!==undefined?{visibleEndSec:Number(end)}:{})};}
 channelCount(clip){const count=this.workspace.waveformView?.metadata?.(clip)?.channelCount,layoutCount=this.channelLayout(clip)?.expandedHeights.length;return Number.isSafeInteger(count)&&count>0?count:Number.isSafeInteger(layoutCount)&&layoutCount>0?layoutCount:1;}
 channelLayout(clip){return this.workspace.channelLayoutForClip?.(clip)??this.workspace.trackLayout?.layoutForClip?.(clip)??null;}
 displays(clip,count){return Array.from({length:count},(_,channel)=>({...this.workspace.amplitudeView?.displayForClip?.(clip,channel)??{min:-1,max:1,scale:'linear',dbRange:60}}));}
 waveformBounds(element,clip){const {visibleStartSec,visibleEndSec}=this.displayBounds(element),start=this.workspace.seconds(clip.start);return {...(visibleStartSec!==undefined?{startSec:visibleStartSec-start}:{}),...(visibleEndSec!==undefined?{endSec:visibleEndSec-start}:{})};}
 element(clip){return this.workspace.root.querySelector(`.au-clip[data-clip="${CSS.escape(String(clip.id))}"]`);}
 sync(){
  const enabled=['envelope','multi'].includes(this.workspace.tool);
  this.workspace.root.classList.toggle('au-envelope-mode',enabled);
  for(const clip of this.clips()){
   const el=this.element(clip);if(!el)continue;
   let graph=el.querySelector('.au-envelope');
   if(!graph){graph=document.createElementNS(svgNS,'svg');graph.classList.add('au-envelope');graph.setAttribute('aria-label','Clip gain envelope');graph.setAttribute('role','group');graph.setAttribute('tabindex','0');el.querySelector('.au-clip-body').append(graph);this.bind(graph,clip);}
   graph.style.display=enabled?'block':'none';
   this.paint(clip);if(enabled&&clip.patternId&&clip.id===this.workspace.selectedClip&&!this.controller.get(clip,{diagnostics:false}))this.load(clip);
  }
  this.hydrateVisible();
 }
 async load(clip,options={}){try{await this.controller.load(clip,options);this.paint(clip);}catch(error){if(error.name!=='AbortError')this.workspace.onError(error);}}
 async reload(){this.cancel();await this.controller.saveQueue;this.controller.invalidate();this.readQueue.clear();this.readFallbacks.clear();this.sync();const selected=this.clips().find(clip=>clip.id===this.workspace.selectedClip);if(selected&&this.workspace.tool==='envelope')await this.load(selected);}
 handleFocusKey(node){return node?.matches?.('[data-envelope-point]')?{index:node.dataset.envelopePoint,channel:node.closest('[data-envelope-channel]')?.dataset.envelopeChannel??'0',side:node.dataset.envelopeSide,contour:node.dataset.envelopeContour}:null;}
 focusHandle(graph,key){
  if(!graph?.isConnected)return;
  const row=key&&graph.querySelector(`[data-envelope-channel="${CSS.escape(String(key.channel))}"]`),node=row?.querySelector(`[data-envelope-point="${CSS.escape(String(key.index))}"][data-envelope-side="${key.side}"][data-envelope-contour="${key.contour}"]`);
  if(node){if(!node.hasAttribute('tabindex'))node.setAttribute('tabindex','-1');node.focus({preventScroll:true});}else graph.focus({preventScroll:true});
 }
 // A save may replace the complete workspace. Restore its handle only while
 // focus still belongs to this edit; another control gaining focus cancels it.
 focusLease(clip,graph){
  const doc=graph.ownerDocument,focused=doc.activeElement,key=this.handleFocusKey(focused),context=this.readContext(),binding=this.binding(clip);let moved=!graph.contains(focused);
  const changed=event=>{const current=this.element(clip)?.querySelector('.au-envelope');if(event.target!==doc.body&&(!current?.contains(event.target)||JSON.stringify(this.handleFocusKey(event.target))!==JSON.stringify(key)))moved=true;};doc.addEventListener('focusin',changed);
  return {restore:()=>{doc.removeEventListener('focusin',changed);const current=this.element(clip)?.querySelector('.au-envelope');if(!moved&&context===this.readContext()&&binding===this.binding(clip)&&['envelope','multi'].includes(this.workspace.tool)&&(doc.activeElement===doc.body||current?.contains(doc.activeElement)))this.focusHandle(current,key);}};
 }
 paint(clip){
  const el=this.element(clip),graph=el?.querySelector('.au-envelope');if(!graph)return;
  const focused=graph.ownerDocument.activeElement,focusKey=graph.contains(focused)?this.handleFocusKey(focused):null;
  this.workspace.waveformView?.paint(clip);
  const state=this.controller.get(clip,{diagnostics:false}),rect=graph.getBoundingClientRect(),width=Math.max(1,rect.width),height=Math.max(1,rect.height);
  graph.setAttribute('viewBox',`0 0 ${width} ${height}`);graph.setAttribute('preserveAspectRatio','none');
  graph.setAttribute('aria-busy',String(!!(state?.loading||state?.saving)));
  paintLegacyWaveform(this.workspace,clip,el,{envelope:this.waveformState(clip).envelope,display:(this.active?.graph===graph?this.active.displays:this.displays(clip,1))[0]});
  const message=!state?'Click to load envelope':state.loading?'Reading cloud envelope…':(state.error?.message||state.error)||(!state.window?.editable?state.window?.reason:'');
  if(message||!state?.envelope){graph.innerHTML=`<text class="au-envelope-message" x="10" y="22">${esc(message||'No cloud gain envelope')}</text>`;if(focusKey)this.focusHandle(graph,null);return;}
  const capture=this.active?.graph===graph?this.active:null,channelCount=capture?capture.channelCount:this.channelCount(clip),displays=capture?.displays??this.displays(clip,channelCount),channelLayout=capture?capture.channelLayout:this.channelLayout(clip),geometry=envelopeChannelsGeometry(state.envelope,clip,{bpm:this.workspace.getProject().bpm,width,height,maxGain:1,channelCount,channelLayout,displays,sourceWindow:state.window,...this.displayBounds(el)});
  graph.dataset.envelopeChannelCount=String(channelCount);
  graph.innerHTML=geometry.channels.map(row=>`<svg data-envelope-channel="${row.channel}" x="0" y="${row.top}" width="${width}" height="${row.height}" style="width:${width}px;height:${row.height}px;overflow:hidden" viewBox="0 0 ${width} ${row.height}" overflow="hidden"><path class="au-envelope-line" d="${row.upperPath}"/><path class="au-envelope-line" d="${row.lowerPath}"/>${row.nodes.map(node=>this.handles(node,channelCount,row.channel,row.height)).join('')}</svg>`).join('')+`${state.saving?'<text class="au-envelope-message" x="10" y="22">Saving envelope…</text>':state.needsReload?'<text class="au-envelope-message" x="10" y="22">Reload envelope before editing</text>':''}`;
  if(focusKey)this.focusHandle(graph,focusKey);
 }
 handles(node,channelCount,channel,height){
  const title=`${node.timeSec.toFixed(3)} s · ${node.gain>0?(20*Math.log10(node.gain)).toFixed(1)+' dB':'−∞ dB'}`;
  const visible=[['outer','upper',node.upperHandleY],['outer','lower',node.lowerHandleY],...(node.innerVisible?[['inner','upper',node.innerUpperY],['inner','lower',node.innerLowerY]]:[])].filter(([, ,y])=>y>=0&&y<=height);
  return visible.map(([contour,side,y])=>`<circle ${side==='upper'||!visible.some(([otherContour,otherSide])=>otherContour===contour&&otherSide==='upper')?`tabindex="0" role="slider" aria-label="${channelCount>1?'Channel '+(channel+1)+' ':''}${contour==='inner'?'Amplify ':''}Gain point at ${node.timeSec.toFixed(3)} seconds" aria-valuemin="${NATIVE_ENVELOPE_MIN_GAIN}" aria-valuemax="${NATIVE_ENVELOPE_MAX_GAIN}" aria-valuenow="${node.gain}"`:''} data-envelope-point="${node.index}" data-envelope-side="${side}" data-envelope-contour="${contour}" cx="${node.x}" cy="${y}" r="4"><title>${title}</title></circle>`).join('');
 }
 fromPointer(event,graph,clip,state,channel=this.active){
  const rect=graph.getBoundingClientRect(),window=state.window,displayWindow=envelopeDisplayWindow(window,this.displayBounds(this.element(clip)));
  const channelCount=channel?.channelCount??this.channelCount(clip),channelLayout=channel?channel.channelLayout:this.channelLayout(clip),channelIndex=channel?.channelIndex??envelopeChannelAt(event.clientY-rect.top,rect.height,channelCount,channelLayout),row=channel?.rowRect,display=channel?.display??this.displays(clip,channelCount)[channelIndex];
  const point=envelopePointAt(displayWindow,{x:event.clientX-rect.left,y:event.clientY-(row?.top??rect.top),width:rect.width,height:row?.height??rect.height,maxGain:1,channelCount:row?1:channelCount,channelIndex:row?0:channelIndex,channelLayout:row?undefined:channelLayout,upper:channel?.upper,contour:channel?.contour,display});
  // Capture can outlive the clip's visible intersection. Derive time directly
  // from the logical viewport so scrolling cannot reuse a stale cropped box.
  if(this.workspace.xToTime&&this.workspace.scroll){const absolute=this.workspace.xToTime(event.clientX-this.workspace.scroll.getBoundingClientRect().left-TRACK_GUTTER_PX);point.timeSec=Math.max(0,Math.min(window.durationSec,absolute-window.timelineStartSec));}
  if(this.workspace.snap){const absolute=this.workspace.seconds(clip.start)+point.timeSec,snapped=this.workspace.quantize(absolute);point.timeSec=Math.max(0,Math.min(window.durationSec,snapped-this.workspace.seconds(clip.start)));}
  return point;
 }
 beginGesture(event,graph,clip){
   if(event.button!==0||this.active||this.workspace.trackLayout?.active||this.workspace.multiToolView?.active)return;event.preventDefault();event.stopPropagation();
   const ws=this.workspace;if(ws.engine.playing||ws.paused||ws.engine.recorder?.recording){ws.onError(new Error('Stop cloud audio before editing the gain envelope.'));return;}ws.selectedClip=clip.id;ws.selectedTracks=new Set([clip.track]);ws.paintSelection();
   const state=this.controller.get(clip,{diagnostics:false});
   if(!state||state.needsReload){this.load(clip);return;}
   if(state.loading||state.saving||ws.busy||ws.engine.applying||ws.clipGesture)return;
   try{
    const channelCount=this.channelCount(clip),channelLayout=structuredClone(this.channelLayout(clip)),row=event.target.closest('[data-envelope-channel]'),rect=graph.getBoundingClientRect(),rows=channelRows(rect.height,channelCount,channelLayout),channelIndex=row?Number(row.dataset.envelopeChannel):envelopeChannelAt(event.clientY-rect.top,rect.height,channelCount,channelLayout),displays=this.displays(clip,channelCount),measured=row?.getBoundingClientRect(),rowRect={top:measured?.height>0?measured.top:rect.top+rows[channelIndex].top,height:measured?.height>0?measured.height:rows[channelIndex].height},channel={channelCount,channelIndex,channelLayout,displays,display:displays[channelIndex],rowRect};
    const node=event.target.closest('[data-envelope-point]'),handle=node?{upper:node.dataset.envelopeSide==='upper',contour:node.dataset.envelopeContour==='inner'}:envelopeHandleAt(state.envelope,envelopeDisplayWindow(state.window,this.displayBounds(this.element(clip))),{x:event.clientX-rect.left,y:event.clientY-rect.top,width:rect.width,height:rect.height,maxGain:1,...channel});Object.assign(channel,handle);
    this.controller.begin(clip);let index=node?Number(node.dataset.envelopePoint):this.controller.insert(this.fromPointer(event,graph,clip,state,channel));
    this.focusHandle(graph,{index,channel:channelIndex,side:channel.upper?'upper':'lower',contour:channel.contour?'inner':'outer'});
    const pointer=event.pointerId;this.active={clip,graph,pointer,existingPoint:!!node,...channel};ws.engine.interacting=true;graph.setPointerCapture(pointer);
    graph.onpointermove=move=>{if(move.pointerId!==pointer)return;try{index=this.controller.move(index,this.fromPointer(move,graph,clip,state));}catch(error){ws.onError(error);}};
    const finish=async cancel=>{
     if(!this.active)return;if(cancel&&!node&&graph.contains(graph.ownerDocument.activeElement))graph.focus({preventScroll:true});const focus=this.focusLease(clip,graph);graph.onpointermove=null;graph.onpointerup=null;graph.onpointercancel=null;graph.onlostpointercapture=null;this.active=null;try{if(graph.hasPointerCapture?.(pointer))graph.releasePointerCapture(pointer);}catch{}
     if(cancel){this.controller.cancel();ws.engine.interacting=false;this.adoptWaveformMetadata(clip);this.paint(clip);ws.finishDeferredRender?.();focus.restore();return;}
     ws.engine.interacting=false;
     try{await this.controller.commit();}catch(error){ws.onError(error);}finally{this.adoptWaveformMetadata(clip);this.paint(clip);ws.finishDeferredRender?.();focus.restore();}
    };
    graph.onpointerup=up=>{if(up.pointerId===pointer)finish(false);};graph.onpointercancel=()=>finish(true);graph.onlostpointercapture=()=>finish(true);
   }catch(error){ws.engine.interacting=false;this.controller.cancel();ws.onError(error);}
 }
 bind(graph,clip){
  graph.onpointerdown=event=>{if(this.workspace.tool==='multi'){event.stopPropagation();const lane=graph.closest('.au-lane'),track=this.workspace.tracks.find(track=>track.index===clip.track);if(lane&&track)this.workspace.timelinePointerDown(event,lane,track);return;}this.beginGesture(event,graph,clip);};
  graph.oncontextmenu=event=>{
   if(this.workspace.tool==='multi'){const lane=graph.closest('.au-lane'),track=this.workspace.tracks.find(track=>track.index===clip.track);if(lane&&track&&this.workspace.multiToolView?.contextMenu(event,lane,track))return;if(!track||this.workspace.multiToolView?.hit(event,lane,track).action!=='envelope')return;}
   event.preventDefault();event.stopPropagation();const node=event.target.closest('[data-envelope-point]');
   if(!node){this.workspace.menu(event,[['Reload cloud envelope','',()=>this.load(clip,{force:true})],['Precise envelope editor…','',()=>this.workspace.automation(clip)]]);return;}
   this.workspace.menu(event,[['Remove envelope point','',()=>this.remove(clip,Number(node.dataset.envelopePoint))],['Precise envelope editor…','',()=>this.workspace.automation(clip)]]);
  };
  graph.onkeydown=event=>{
   const node=event.target.closest('[data-envelope-point]');if(!node)return;
   const key=event.key;if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Delete','Backspace'].includes(key))return;
   event.preventDefault();event.stopPropagation();const index=Number(node.dataset.envelopePoint);
   if(key==='Delete'||key==='Backspace'){this.remove(clip,index);return;}
   this.workspace.run(async()=>{const focus=this.focusLease(clip,graph);try{const state=this.controller.get(clip,{diagnostics:false}),point=state.points[index];this.controller.begin(clip);this.controller.move(index,{timeSec:point.timeSec+(key==='ArrowRight'?.01:key==='ArrowLeft'?-.01:0),value:point.value+(key==='ArrowUp'?.0025:key==='ArrowDown'?-.0025:0)});await this.controller.commit();}finally{this.adoptWaveformMetadata(clip);focus.restore();}});
  };
  graph.addEventListener('pointerenter',()=>{if(['envelope','multi'].includes(this.workspace.tool)&&!this.controller.get(clip,{diagnostics:false}))this.load(clip);});
 }
 async remove(clip,index){return this.workspace.run(async()=>{this.controller.begin(clip);try{this.controller.remove(index);await this.controller.commit();}catch(error){this.controller.cancel();throw error;}finally{this.adoptWaveformMetadata(clip);}});}
 cancel(){const clip=this.active?.clip;let focus;if(this.active){const {graph,pointer,existingPoint}=this.active;if(!existingPoint&&graph.contains(graph.ownerDocument.activeElement))graph.focus({preventScroll:true});focus=this.focusLease(clip,graph);graph.onpointermove=null;graph.onpointerup=null;graph.onpointercancel=null;graph.onlostpointercapture=null;this.active=null;try{if(graph.hasPointerCapture?.(pointer))graph.releasePointerCapture(pointer);}catch{}}this.controller.cancel();this.workspace.engine.interacting=false;if(clip)this.adoptWaveformMetadata(clip);this.workspace.finishDeferredRender?.();focus?.restore();}
}
