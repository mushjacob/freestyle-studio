import {PatternRackController} from './pattern-rack-controller.js';
import {STEPS_PER_BAR,MAX_SOURCE_VOLUME} from './pattern-rack-model.js';
import {interceptPlacementCommits} from './pattern-rack-receipts.js';
import {TRACK_GUTTER_PX} from './audacity-layout.js';

/**
 * Audacity-styled Pattern Rack panel + Patterns → Timeline drag/drop.
 * Drag payloads use the Freestyle Studio MIME types:
 * `application/x-freestyle-pattern` ({id,name}) for patterns and
 * `application/x-freestyle-pattern-channel` ({kind:'sample-channel',...}) for
 * rack samples. Step clicks repaint only their button; persistence runs in
 * the controller's background queue.
 */
export const PATTERN_MIME='application/x-freestyle-pattern';
export const CHANNEL_MIME='application/x-freestyle-pattern-channel';
/** Existing Modesty library-row drag payload (library-browser.js soundRow). */
export const LIBRARY_MIME='application/vegetable-library-sound';
const HEADER_WIDTH=TRACK_GUTTER_PX;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BAR_CHOICES=[1,2,4,8,16,32,64];
const types=event=>[...(event.dataTransfer?.types||[])];
const readJson=(event,type)=>{try{return JSON.parse(event.dataTransfer?.getData(type)||'null');}catch{return null;}};
const fileBase64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',').pop());reader.onerror=()=>reject(reader.error||new Error('The audio file could not be read.'));reader.readAsDataURL(file);});

export class AudacityPatternRack {
  constructor(workspace,{controller,...options}={}){
    this.w=workspace;
    this.controller=controller||new PatternRackController({...options,getProject:()=>workspace.getProject(),engine:workspace.engine,
      record:(entry,projectId)=>workspace.recordOwnedHistory?.('patternRack',projectId),
      forget:(entry,projectId,newerCount)=>this.forgetOwned(projectId,newerCount),
      onStatus:message=>workspace.engine?.onStatus?.(message)});
    // Status-only and self-painted step changes avoid a full rack repaint.
    this.controller.addEventListener('change',event=>{const d=event.detail||{};if(d.kind==='status'||(d.optimistic&&this.painting))this.paintStatus();else this.render();});
    this.visible=false;
  }
  // Owned-history surface used by AudacityWorkspace.history().
  get past(){return this.controller.past;}
  get future(){return this.controller.future;}
  history(direction){return this.controller.history(direction);}
  uncertain(id){return this.controller.uncertain(id);}
  unverified(id){return this.controller.unverified(id);}
  forgetOwned(projectId,newerCount){
    const w=this.w;if(!w.ownedStack)return;const stack=w.ownedStack(w.ownedHistoryPast,projectId);let seen=0;
    for(let index=stack.length-1;index>=0;index--){if(stack[index]!=='patternRack')continue;if(seen===newerCount){stack.splice(index,1);return;}seen++;}
  }
  fail(error){this.w.onError?.(error);}
  run(task){return Promise.resolve().then(task).catch(error=>{this.fail(error);});}

  mount(parent=document.body){
    const root=this.root=document.createElement('section');root.id='prack';root.className='prack hidden';root.setAttribute('role','dialog');root.setAttribute('aria-label','Pattern rack');
    root.innerHTML=`<header class="prack-head"><strong class="prack-title">Pattern Rack</strong><select class="prack-pattern" aria-label="Pattern"></select><button type="button" data-act="new" title="New pattern">New</button><button type="button" data-act="clone" title="Clone pattern">Clone</button><button type="button" data-act="rename" title="Rename pattern">Rename…</button><button type="button" data-act="delete" title="Delete pattern">Delete</button><label class="prack-bars-label">Bars <select class="prack-bars" aria-label="Pattern length in bars"></select></label><button type="button" data-act="preview" title="Preview pattern in the cloud engine">▶ Preview</button><button type="button" data-act="stop" title="Stop preview">■</button><button type="button" data-act="insert" title="Insert the pattern on the timeline at the cursor">Insert at cursor</button><span class="prack-status" role="status" aria-live="polite"></span><button type="button" data-act="retry" hidden>Retry</button><button type="button" data-act="close" aria-label="Close pattern rack">×</button></header><div class="prack-tiles" aria-label="Patterns (drag to the timeline)"></div><div class="prack-rows"></div><footer class="prack-foot"><button type="button" data-act="add-sample">+ Sample…</button><button type="button" data-act="add-instrument">+ Instrument…</button><span class="prack-hint">Drag a pattern or a sample channel onto the timeline.</span><input type="file" class="prack-file" accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a" hidden></footer>`;
    parent.append(root);
    root.addEventListener('click',event=>this.click(event));
    // Space stays the Audacity Play/Stop shortcut; it must not also activate a focused step.
    root.addEventListener('keydown',event=>{if(event.key===' '&&event.target.closest?.('button'))event.preventDefault();});
    root.addEventListener('change',event=>this.change(event));
    root.addEventListener('input',event=>{const vol=event.target.closest('.prack-vol');if(vol)vol.title=`Volume ${Math.round(Number(vol.value)*100)}%`;});
    root.addEventListener('dragstart',event=>this.dragStart(event));
    root.addEventListener('dragend',()=>{try{delete window.__freestylePatternDrag;delete window.__freestyleRackChannelDrag;}catch{}});
    root.querySelector('.prack-file').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';if(file)this.run(()=>this.upload(file));});
    const target=this.w.root||document;
    target.addEventListener('dragover',event=>this.dragOver(event),true);
    target.addEventListener('drop',event=>this.drop(event),true);
    target.addEventListener('dragleave',event=>{if(!this.w.root?.contains(event.relatedTarget))this.clearGhost(true);},true);
    // Pure pattern-clip gestures commit through typed writes + instant receipts.
    if(this.w.engine?.geometryHistory)interceptPlacementCommits(this.w.engine,this.controller);
    return this;
  }
  open(){this.visible=true;this.root?.classList.remove('hidden');this.controller.sync();this.render();}
  close(){this.visible=false;this.root?.classList.add('hidden');}
  toggle(){if(this.visible)this.close();else this.open();}
  projectChanged(){if(!this.root)return;this.controller.sync();try{this.watchWarm();this.warm();}catch{}if(this.visible)this.render();}
  selected(){this.controller.sync();return this.controller.selectedPattern;}

  render(){
    try{this.watchWarm();this.warm();}catch{}
    const root=this.root;if(!root||!this.visible)return;const c=this.controller,patterns=c.patterns(),id=c.selectedPattern;
    const select=root.querySelector('.prack-pattern');select.innerHTML=patterns.length?patterns.map(p=>`<option value="${esc(p.id)}" ${p.id===id?'selected':''}>${esc(p.name)}</option>`).join(''):'<option value="">No patterns</option>';select.disabled=!patterns.length;
    root.querySelector('.prack-tiles').innerHTML=patterns.map(p=>`<div class="prack-tile ${p.id===id?'selected':''}" draggable="true" data-pattern="${esc(p.id)}" title="Drag ${esc(p.name)} onto the timeline">${esc(p.name)}</div>`).join('');
    let dto=null,channels=[];try{if(id){dto=c.dto(id);channels=c.channels(id);}}catch(error){root.querySelector('.prack-rows').innerHTML=`<p class="prack-empty">${esc(error.message)}</p>`;}
    const bars=root.querySelector('.prack-bars'),current=dto?.bars||1;bars.innerHTML=[...new Set([...BAR_CHOICES,current])].sort((a,b)=>a-b).map(n=>`<option value="${n}" ${n===current?'selected':''}>${n}</option>`).join('');bars.disabled=!dto;
    for(const act of ['clone','rename','delete','preview','insert','add-sample','add-instrument'])root.querySelector(`[data-act="${act}"]`).disabled=!dto;
    if(dto)root.querySelector('.prack-rows').innerHTML=channels.length?channels.map(ch=>this.row(ch)).join(''):'<p class="prack-empty">This pattern has no channels. Add a stored sample or an instrument lane.</p>';
    else if(!patterns.length)root.querySelector('.prack-rows').innerHTML='<p class="prack-empty">Create a pattern to start building a beat.</p>';
    this.paintStatus();
  }
  row(ch){
    const steps=ch.kind==='sample'?`<div class="prack-steps" role="group" aria-label="${esc(ch.name)} steps">${ch.steps.map((on,i)=>`<button type="button" class="prack-step ${on?'on':''} ${Math.floor(i/4)%2?'odd':''} ${i%STEPS_PER_BAR===0?'bar':''}" data-step="${i}" aria-pressed="${on}" aria-label="Step ${i+1}"></button>`).join('')}</div>`:`<button type="button" class="prack-piano" data-act="piano">Piano roll · ${ch.notes} note${ch.notes===1?'':'s'}</button>`;
    return `<div class="prack-row ${ch.muted?'muted':''}" data-source="${esc(ch.id)}" data-kind="${ch.kind}"><span class="prack-grip" draggable="${ch.kind==='sample'&&!!ch.audioFileId}" title="${ch.kind==='sample'?'Drag this sample onto an audio track':'Instrument channel'}">⠿</span><button type="button" class="prack-mute ${ch.muted?'on':''}" aria-pressed="${ch.muted}" title="Mute">M</button><button type="button" class="prack-solo ${ch.solo?'on':''}" aria-pressed="${ch.solo}" title="Solo">S</button><input type="range" class="prack-vol" min="0" max="${MAX_SOURCE_VOLUME}" step="0.01" value="${ch.volume}" aria-label="${esc(ch.name)} volume" title="Volume ${Math.round(ch.volume*100)}%"><span class="prack-name" title="${esc(ch.name)}">${esc(ch.name)}</span>${steps}<button type="button" class="prack-remove" title="Remove channel" aria-label="Remove ${esc(ch.name)}">×</button></div>`;
  }
  paintStatus(){
    const status=this.controller.status(),el=this.root?.querySelector('.prack-status');if(!el)return;
    el.textContent=status.message;el.dataset.kind=status.kind;this.root.querySelector('[data-act="retry"]').hidden=status.kind!=='uncertain';
  }

  click(event){
    const c=this.controller,id=c.selectedPattern,step=event.target.closest('.prack-step'),row=event.target.closest('.prack-row'),source=row?.dataset.source;
    try{
      if(step&&row){
        // Optimistic repaint of only this cell; the save runs in the background.
        this.painting=true;let changed;try{changed=c.toggleStep(id,source,Number(step.dataset.step));}finally{this.painting=false;}
        if(changed){const on=!step.classList.contains('on');step.classList.toggle('on',on);step.setAttribute('aria-pressed',String(on));this.paintStatus();
          // A step that is switched on sounds its sample at once (engine audition over the live control channel).
          if(on)this.audition(c.channels(id).find(x=>x.id===source));}
        return;
      }
      if(event.target.closest('.prack-mute')&&row){const ch=c.channels(id).find(x=>x.id===source);c.setChannel(id,source,{muted:!ch.muted});return;}
      if(event.target.closest('.prack-solo')&&row){const ch=c.channels(id).find(x=>x.id===source);c.setChannel(id,source,{solo:!ch.solo});return;}
      if(event.target.closest('.prack-remove')&&row){c.removeChannel(id,source);return;}
      const tile=event.target.closest('.prack-tile');if(tile){c.selectedPattern=tile.dataset.pattern;this.render();return;}
      const act=event.target.closest('[data-act]')?.dataset.act;if(!act)return;
      const actions={
        new:()=>this.run(()=>c.createPattern()),
        clone:()=>this.run(()=>c.clonePattern(id)),
        rename:()=>this.w.textDialog?.('Rename pattern','Pattern name',c.dto(id).name,name=>{try{c.rename(id,name);}catch(error){this.fail(error);}}),
        delete:()=>this.run(()=>c.deletePattern(id)),
        preview:()=>this.run(()=>c.preview(id)),
        stop:()=>this.run(()=>c.stopPreview()),
        insert:()=>this.run(()=>this.insertAtCursor()),
        retry:()=>this.run(()=>c.retryPending()),
        close:()=>this.close(),
        piano:()=>this.w.showWindow?.('piano',false),
        'add-sample':()=>this.run(()=>this.sampleMenu(event)),
        'add-instrument':()=>this.instrumentMenu(event),
      };
      actions[act]?.();
    }catch(error){this.fail(error);}
  }
  change(event){
    const c=this.controller,id=c.selectedPattern;
    try{
      if(event.target.matches('.prack-pattern')){c.selectedPattern=event.target.value;this.render();return;}
      if(event.target.matches('.prack-bars')){c.setBars(id,Number(event.target.value));return;}
      if(event.target.matches('.prack-vol')){const source=event.target.closest('.prack-row')?.dataset.source;c.setChannel(id,source,{volume:Number(event.target.value)});}
    }catch(error){this.fail(error);this.render();}
  }
  async sampleMenu(event){
    const c=this.controller,id=c.selectedPattern,samples=await c.listSamples(),present=new Set(c.dto(id).pattern.sources.map(s=>s.audioFileId).filter(Boolean));
    const items=samples.filter(s=>!present.has(s.audioFileId)).map(s=>[s.name||'Sample','',()=>c.addSample(id,s)]);
    this.w.menu?.(event,[...items,...items.length?[null]:[],['Upload audio file…','',()=>this.root.querySelector('.prack-file').click()]]);
  }
  instrumentLanes(){return (this.w.getProject()?.channels||[]).filter(ch=>ch.type==='instrument'&&!ch.patternSource&&(ch.laneId||ch.cloudTrackId)).map(ch=>({laneId:ch.laneId||ch.cloudTrackId,name:ch.name,instrumentType:ch.instrumentType||ch.cloudRaw?.instrumentType||ch.plugins?.[0]?.type}));}
  instrumentMenu(event){
    const c=this.controller,id=c.selectedPattern,lanes=this.instrumentLanes();
    if(!lanes.length)throw new Error('Add an instrument track (Tracks → Add instrument…) before adding it to a pattern.');
    this.w.menu?.(event,lanes.map(lane=>[lane.name||'Instrument','',()=>c.addInstrument(id,lane)]));
  }
  async upload(file){
    if(file.size>25*1024*1024)throw new Error('Freestyle pattern samples are limited to 25 MB.');
    const name=file.name.replace(/\.[^.]+$/,'').slice(0,80);
    return this.controller.uploadSample(this.controller.selectedPattern,{base64:await fileBase64(file),filename:file.name,name});
  }

  // ------------------------------------------------------ step audition
  /** Play one rack sample in the engine. Fast path: `sample_preview` on the monitor's control channel (no HTTP
   *  round trip); otherwise the published preview_pattern_sample action while the peer is (re)connected. */
  audition(channel,{gain}={}){
    const e=this.w.engine,monitor=e?.monitor,audioFileId=channel?.audioFileId;if(!e?.ready||!audioFileId||channel.muted)return {sent:false,reason:'no-sample'};
    const projectId=e.projectId,level=Math.max(0,Math.min(2,Number(gain??channel.volume??1)||0)),started=performance.now();
    try{monitor?.setOutputWanted?.(true,{projectId});monitor?.primeOutput?.();const sink=monitor?.audio;if(sink&&sink.paused&&sink.srcObject)Promise.resolve(sink.play()).catch(()=>{});}catch{}
    try{
      monitor.sendControl({type:'sample_preview',audio_file_id:audioFileId,bus_id:'master',duration_sec:Math.min(600,Number(channel.durationSec)||30),gain:level,playback_rate:1});
      this.lastAudition={path:'channel',audioFileId,at:started};return {sent:true,path:'channel'};
    }catch{
      try{e.warmMonitor?.();}catch{}
      const request=e.session?.action?.('preview_pattern_sample',{audio_file_id:audioFileId,gain:level},{refresh:false});Promise.resolve(request).catch(error=>this.fail(error));
      this.lastAudition={path:'rest',audioFileId,at:started};return {sent:true,path:'rest'};
    }
  }
  /** Pre-warm on project open so the first step click sounds at once: engine session + monitor peer (the engine
   *  warms them at load; asked again here), the output sink, and each rack sample loaded in the engine by a
   *  silent audition (gain 0). Once per project and sample. */
  warm(){
    const e=this.w.engine,monitor=e?.monitor;if(!e?.ready||e.loading)return 0;const projectId=e.projectId;
    if(this.warmProject!==projectId){this.warmProject=projectId;this.warmed=new Set();}
    try{e.warmMonitor?.();}catch{}
    if(monitor?.peer?.connectionState!=='connected'||monitor?.control?.readyState!=='open')return 0;
    let sent=0;
    for(const pattern of this.controller.patterns())for(const channel of this.controller.channels(pattern.id)){
      const id=channel.audioFileId;if(!id||this.warmed.has(id)||this.warmed.size>=48)continue;
      try{monitor.sendControl({type:'sample_preview',audio_file_id:id,bus_id:'master',duration_sec:.05,gain:0,playback_rate:1});this.warmed.add(id);sent++;}catch{return sent;}
    }
    return sent;
  }
  watchWarm(){
    const monitor=this.w.engine?.monitor;if(this.warmWatching===monitor||!monitor?.addEventListener)return;this.warmWatching=monitor;
    monitor.addEventListener('connected',()=>{try{this.warm();}catch{}});
  }
  // ------------------------------------------------------ timeline transfer
  trackAt(event){
    const el=event.target?.closest?.('.au-track[data-track]')||document.elementFromPoint?.(event.clientX,event.clientY)?.closest?.('.au-track[data-track]');
    const index=el?Number(el.dataset.track):NaN;return Number.isFinite(index)?this.w.tracks.find(t=>t.index===index)||null:null;
  }
  timeAt(event){const rect=this.w.timeline?.getBoundingClientRect?.()||{left:0};return Math.max(0,this.w.xToTime(event.clientX-rect.left-HEADER_WIDTH));}
  patternLane(track){return track&&track.laneId&&track.clips.some(clip=>clip.patternId)?track.laneId:'';}
  audioLane(track){return track&&track.laneId&&!track.clips.some(clip=>clip.patternId)&&!['instrument','pattern','midi'].includes(track.channel?.type)?track.laneId:'';}
  dragStart(event){
    const tile=event.target.closest?.('.prack-tile'),grip=event.target.closest?.('.prack-grip');
    if(tile){const pattern=this.controller.patterns().find(p=>p.id===tile.dataset.pattern);if(!pattern)return;event.dataTransfer.setData(PATTERN_MIME,JSON.stringify({id:pattern.id,name:pattern.name}));event.dataTransfer.effectAllowed='copy';try{window.__freestylePatternDrag={id:pattern.id,name:pattern.name};}catch{}return;}
    if(grip){
      const source=grip.closest('.prack-row')?.dataset.source,ch=this.controller.channels(this.controller.selectedPattern).find(x=>x.id===source);
      if(!ch?.audioFileId){event.preventDefault();return;}
      const payload={kind:'sample-channel',audioFileId:ch.audioFileId,name:ch.name,rackChannelId:ch.rackId||ch.id};
      event.dataTransfer.setData(CHANNEL_MIME,JSON.stringify(payload));event.dataTransfer.effectAllowed='copy';try{window.__freestyleRackChannelDrag=payload;}catch{}
    }
  }
  dragOver(event){
    const list=types(event);if(!list.includes(PATTERN_MIME)&&!list.includes(CHANNEL_MIME)&&!list.includes(LIBRARY_MIME))return;
    event.preventDefault();event.stopPropagation();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
    this.showGhost(event,list.includes(PATTERN_MIME)?'pattern':'sample');
  }
  async drop(event){
    const list=types(event);if(!list.includes(PATTERN_MIME)&&!list.includes(CHANNEL_MIME)&&!list.includes(LIBRARY_MIME))return;
    event.preventDefault();event.stopPropagation();
    const track=this.trackAt(event),atSec=this.timeAt(event);this.showGhost(event,null,true);
    try{
      if(list.includes(PATTERN_MIME)){const data=readJson(event,PATTERN_MIME);if(!data?.id)return;const laneId=this.patternLane(track);await this.controller.importPattern(data.id,{atSec,laneId,exact:!!event.altKey,newRow:!laneId});}
      else if(list.includes(CHANNEL_MIME)){const data=readJson(event,CHANNEL_MIME);if(data?.kind!=='sample-channel')return;await this.controller.placeSample(data,{atSec,laneId:this.audioLane(track),rackChannelId:data.rackChannelId});}
      else{const data=readJson(event,LIBRARY_MIME);if(!data?.id||data.materializable===false)throw new Error('This library sound cannot be added to a project.');await this.controller.placeLibrarySound(data,{atSec,laneId:this.audioLane(track)});}
    }catch(error){this.fail(error);}finally{this.clearGhost(true);}
  }
  showGhost(event,kind,pending=false){
    if(!this.w.root)return;let ghost=this.ghost;if(!ghost){ghost=this.ghost=document.createElement('div');ghost.className='prack-ghost';ghost.setAttribute('aria-hidden','true');this.w.root.append(ghost);}
    const rootRect=this.w.root.getBoundingClientRect?.()||{left:0,top:0},row=this.trackAt(event)!=null?(event.target?.closest?.('.au-track')||null):null,rowRect=row?.getBoundingClientRect?.();
    ghost.style.left=`${Math.max(0,event.clientX-rootRect.left)}px`;ghost.style.top=`${Math.max(0,(rowRect?rowRect.top:event.clientY)-rootRect.top)}px`;
    if(kind)ghost.dataset.kind=kind;ghost.classList.toggle('pending',pending);ghost.textContent=pending?'Placing…':kind==='pattern'?(row?'Place pattern':'New pattern track'):'Place sample';
  }
  clearGhost(force){if(this.ghost&&(force||!this.ghost.classList.contains('pending'))){this.ghost.remove();this.ghost=null;}}

  /** Command: insert the selected pattern exactly at the Audacity edit cursor
   * (the same import the Freestyle Studio performs; the cursor already
   * honours the Snap setting). */
  insertAtCursor(patternId=this.selected()){
    if(!patternId)throw new Error('Create or choose a pattern in the Pattern Rack first.');
    const track=this.w.tracks.find(t=>t.index===this.w.focusedTrack),laneId=this.patternLane(track);
    return this.controller.importPattern(patternId,{atSec:this.w.selection?.start||0,laneId,exact:true,newRow:!laneId});
  }

  // ------------------------------------------------------ clipboard routing
  selectedPatternClip(){const clip=this.w.selected?.();return clip?.patternId&&clip.cloudRaw?.patternId?clip:null;}
  handlesClipboard(operation){
    if(operation==='paste')return this.w.lastClipboardKind==='pattern'&&!!this.controller.clipboard;
    const clip=this.selectedPatternClip(),tracks=this.w.selectedTracks||new Set();
    return !!clip&&(tracks.size===0||(tracks.size===1&&tracks.has(clip.track)));
  }
  clipboardEdit(operation){
    const clip=this.selectedPatternClip();
    if(operation==='copy'){this.controller.copy(clip);this.w.lastClipboardKind='pattern';return Promise.resolve(true);}
    if(operation==='cut'){this.w.lastClipboardKind='pattern';return this.controller.cut(clip);}
    const track=this.w.tracks.find(t=>t.index===this.w.focusedTrack),laneId=this.patternLane(track)||this.controller.clipboard?.payload?.laneId;
    return this.controller.paste({atSec:this.w.selection?.start||0,laneId});
  }
}
