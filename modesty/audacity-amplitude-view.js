import {DEFAULT_AMPLITUDE_DISPLAY,validateAmplitudeDisplay,amplitudeToY,amplitudeRulerTicks,verticalZoom,verticalWheel,verticalPointerAction} from './audacity-amplitude.js';
import {paintLegacyWaveform} from './audacity-legacy-waveform-view.js';
import {channelRows} from './audacity-channel-layout.js';
import {describeWaveformTrack} from './audacity-track-layout-view.js';
import {DEFAULT_TRACK_HEIGHT_PX} from './audacity-layout.js';
const copy=value=>({...value});
const signature=value=>JSON.stringify(value);
const abort=()=>Object.assign(new Error('The waveform ruler context changed.'),{name:'AbortError'});

/** Waveform display state only. No cloud commands, gain writes or sample reads.
 * Zoom/scale applies to linked channels together, as native DoZoom does.
 */
export class AudacityAmplitudeView {
 constructor(workspace){
  this.w=workspace;this.projects=new Map();this.advanced=false;this.active=null;
  const doc=workspace.root?.ownerDocument;
  if(workspace.displayPreferences)this.advanced=workspace.displayPreferences.get().advancedVerticalZoom;else try{const saved=JSON.parse(doc?.defaultView.localStorage.getItem('modesty:amplitude')||'null');if(typeof saved?.advanced==='boolean')this.advanced=saved.advanced;}catch{}
  doc?.addEventListener('pointermove',event=>this.move(event),true);
  doc?.addEventListener('pointerup',event=>this.finish(event),true);
  doc?.addEventListener('pointercancel',event=>{if(this.active?.pointerId===event.pointerId)this.cancel();},true);
  doc?.defaultView.addEventListener('blur',()=>this.cancel());
 }
 projectId(){const p=this.w.getProject();return p.cloud?.projectId||p.id;}
 scope(){const e=this.w.engine;return signature([this.projectId(),e?.projectId,e?.loadVersion||0,e?.session?.contextVersion||0]);}
 laneKey(track){return track.laneId||this.w.getProject().cloud?.timelineLaneIds?.[track.track??track.index]||'track:'+(track.track??track.index);}
 displays(){const id=this.projectId();if(!this.projects.has(id))this.projects.set(id,new Map());return this.projects.get(id);}
 defaultDisplay(){const prefs=this.w.displayPreferences?.get?.();return {...DEFAULT_AMPLITUDE_DISPLAY,...(prefs?{scale:prefs.defaultScale,dbRange:prefs.defaultDbRange}:{})};}
 displayForClip(clip,channel=0){const active=this.w.envelopeView?.active;if(active?.clip&&active.displays?.[channel]&&this.laneKey(active.clip)===this.laneKey(clip))return copy(active.displays[channel]);return copy(this.displays().get(this.laneKey(clip))||this.defaultDisplay());}
 preferencesChanged(next,previous){
  if(this.active)this.cancel(false);this.advanced=next.advancedVerticalZoom;
  // Pinned3.2.1 updates each field only when it equals the OLD global value.
  // Custom bounds do not create an override. Its fresh-track lastScaleType=-1
  // sentinel leaves bounds conversion unreachable; preserve those bounds here.
  for(const tracks of this.projects.values())for(const [key,display]of tracks)tracks.set(key,{...display,scale:display.scale===previous.defaultScale?next.defaultScale:display.scale,dbRange:display.dbRange===previous.defaultDbRange?next.defaultDbRange:display.dbRange});
  if(this.blocked()){this.w.deferredRender=true;return;}this.sync();for(const track of this.w.tracks)this.refresh(track);
 }
 displayForTrack(track){return this.displayForClip(track);}
 track(row){return this.w.tracks.find(track=>String(track.index)===row.dataset.track);}
 layout(track){
  if(!track||['instrument','pattern'].includes(track.channel?.type)||track.clips.some(clip=>clip.patternId))return {count:0,reason:'Waveform rulers are available on audio lanes.'};
  const counts=track.clips.map(clip=>this.w.waveformView?.metadata?.(clip)?.channelCount).filter(count=>Number.isSafeInteger(count)&&count>0);
  if(new Set(counts).size>1)return {count:0,reason:'The track contains different channel layouts.'};
  const description=describeWaveformTrack(this.w,track);return description.kind==='audio'?{count:description.channelCount}:{count:0,reason:'The track’s source channel layout is unavailable.'};
 }
 channelLayout(track){return this.w.channelLayoutForClip?.(track)??this.w.trackLayout?.layoutForClip?.(track)??null;}
 blocked(){const w=this.w;return !!(w.busy||w.trackLayout?.active||w.multiToolView?.active||w.clipGesture||w.selectionGesture?.active||w.envelopeView?.active||w.loopRegion?.active||w.viewport?.pinDrag||w.panGesture);}
 setDisplay(track,display){
  if(this.blocked()||this.active)throw new Error('Finish the current edit or gesture before changing the waveform scale.');
  const next=validateAmplitudeDisplay(display);this.displays().set(this.laneKey(track),next);this.refresh(track);return copy(next);
 }
 command(track,command,{height=100,y=height/2,...options}={}){return this.setDisplay(track,verticalZoom(this.displayForTrack(track),{command,height,y,...options}));}
 setScale(track,scale){
  if(!['linear','db'].includes(scale))throw new Error('Choose Linear or dB waveform scale.');
  // The pinned reference starts lastScaleType at -1 without initializing it in
  // its ruler, so switching scale retains the stored display-coordinate bounds.
  return this.setDisplay(track,{...this.displayForTrack(track),scale});
 }
 setAdvanced(enabled){if(this.active||this.blocked())return;if(this.w.displayPreferences)return this.w.displayPreferences.set({advancedVerticalZoom:!!enabled});this.advanced=!!enabled;try{this.w.root.ownerDocument.defaultView.localStorage.setItem('modesty:amplitude',JSON.stringify({advanced:this.advanced}));}catch{}this.sync();}
 rowFor(track){return [...this.w.root.querySelectorAll('.au-track')].find(row=>String(track.index)===row.dataset.track);}
 geometry(row){
  const rail=row.querySelector('.au-amplitude'),lane=row.querySelector('.au-lane'),body=lane.querySelector('.au-clip-body'),railRect=rail.getBoundingClientRect(),bodyRect=body?.getBoundingClientRect();
  const top=bodyRect?.height>0?bodyRect.top-railRect.top:26,height=bodyRect?.height>0?bodyRect.height:Math.max(1,(Number.parseFloat(row.style.height)||DEFAULT_TRACK_HEIGHT_PX)-36);
  return {top,height,laneTop:bodyRect?.height>0?bodyRect.top-lane.getBoundingClientRect().top:26};
 }
 bind(row){
  const rail=row.querySelector('.au-amplitude');if(!rail||rail.dataset.amplitudeBound)return;rail.dataset.amplitudeBound='true';
  rail.onpointerdown=event=>this.begin(event,row);
  rail.onpointermove=event=>{if(this.advanced&&!this.active)rail.style.cursor=event.buttons&2?'default':event.shiftKey?'zoom-out':'zoom-in';};
  rail.onpointerleave=()=>{if(!this.active)rail.style.cursor='';};
  rail.onlostpointercapture=event=>{if(this.active?.pointerId===event.pointerId)this.cancel();};
  rail.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();if(!this.active){const cmd=this.commandKey(event);if(event.shiftKey||cmd){if(this.advanced&&!this.blocked()){const target=event.target.closest('[data-amplitude-channel]');if(target){const rect=target.getBoundingClientRect(),action=verticalPointerAction({button:2,shiftKey:event.shiftKey,cmdKey:cmd,advanced:true,startY:event.clientY-rect.top,endY:event.clientY-rect.top});if(action.action==='zoom')this.w.run(()=>this.command(this.track(row),action.command,{height:rect.height||Number(target.dataset.height),...action,y:action.startY}));}}return;}this.showMenu(event,row);}};
  rail.addEventListener('wheel',event=>this.wheel(event,row),{passive:false});
  rail.onkeydown=event=>{if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey){event.preventDefault();event.stopPropagation();this.showMenu(null,row,event.target.closest('[data-amplitude-channel]'));}};
 }
 commandKey(event){const platform=this.w.root.ownerDocument.defaultView.navigator.platform;return !!(event.metaKey||!/^Mac/.test(platform)&&event.ctrlKey);}
 sync(){
  if(this.active&&!this.valid(this.active))this.cancel(false);
  for(const row of this.w.root.querySelectorAll('.au-track')){this.bind(row);if(this.active?.row!==row)this.renderTrack(row);}
 }
 renderTrack(row){
  const track=this.track(row),rail=row.querySelector('.au-amplitude'),zero=row.querySelector('.au-zero');if(!track||!rail)return;
  const layout=this.layout(track),geometry=this.geometry(row),display=this.displayForTrack(track),channelLayout=this.channelLayout(track),key=signature([this.scope(),this.laneKey(track),layout.count,channelLayout,geometry,display,this.advanced]);
  if(rail.dataset.amplitudeRenderKey===key)return;rail.dataset.amplitudeRenderKey=key;
  rail.title=layout.reason||(this.advanced?'Click to vertically zoom in. Shift-click to zoom out. Drag to specify a zoom region.':'Right-click for menu.');
  rail.classList.toggle('au-amplitude-advanced',this.advanced&&layout.count>0);rail.style.cursor='';rail.replaceChildren();if(zero)zero.replaceChildren();
  if(!layout.count){rail.setAttribute('aria-label',layout.reason);return;}
  rail.setAttribute('aria-label','Waveform amplitude');
  const doc=row.ownerDocument,container=doc.createElement('div');container.className='au-amplitude-display';container.style.top=geometry.top+'px';container.style.height=geometry.height+'px';rail.append(container);
  for(const {index:channel,top,height}of channelRows(geometry.height,layout.count,channelLayout)){
   if(height<1)continue;
   const area=doc.createElement('div');area.className='au-amplitude-channel';area.dataset.amplitudeChannel=String(channel);area.dataset.height=String(height);area.style.top=top+'px';area.style.height=height+'px';area.tabIndex=0;area.setAttribute('role','group');area.setAttribute('aria-label',`${track.name||'Audio'}${layout.count>1?' channel '+(channel+1):''} amplitude ruler, ${display.scale==='db'?'dB':'linear'} scale`);
   const candidates=amplitudeRulerTicks(height,display).ticks,labels=[];
   for(const tick of [...candidates].sort((a,b)=>b.priority-a.priority||a.y-b.y)){const labelTop=Math.max(0,Math.min(height-10,tick.y-5));if(height>=10&&!labels.some(label=>Math.abs(label.labelTop-labelTop)<12))labels.push({...tick,labelTop});}
   const labelByY=new Map(labels.map(tick=>[tick.y,tick]));
   for(const tick of candidates){const mark=doc.createElement('span');mark.className='au-amplitude-tick'+(tick.major?' au-amplitude-major':'');mark.style.top=tick.y+'px';if(labelByY.has(tick.y)){const label=doc.createElement('span');label.textContent=tick.label;label.style.top=(labelByY.get(tick.y).labelTop-tick.y)+'px';mark.append(label);}area.append(mark);}
   container.append(area);const y=amplitudeToY(0,height,display);if(zero&&y>=0&&y<height){const line=doc.createElement('span');line.className='au-zero-line';line.style.top=(geometry.laneTop+top+y)+'px';zero.append(line);}
  }
 }
 metadataChanged(clip){const track=this.w.tracks.find(track=>track.index===clip.track);if(track){const row=this.rowFor(track);if(row&&this.active?.row!==row)this.renderTrack(row);}}
 refresh(track){const row=this.rowFor(track);if(!row)return;this.renderTrack(row);
  for(const clip of track.clips){this.w.waveformView?.paint(clip);const element=[...row.querySelectorAll('.au-clip')].find(el=>el.dataset.clip===String(clip.id));paintLegacyWaveform(this.w,clip,element);this.w.envelopeView?.paint(clip);}

 }
 showMenu(event,row,target){
  const track=this.track(row),layout=this.layout(track);if(!layout.count||this.blocked()||this.active)return;
  target??=event?.target.closest('[data-amplitude-channel]')||row.querySelector('[data-amplitude-channel]');if(!target)return;
  const rect=target.getBoundingClientRect(),height=rect.height||Number(target.dataset.height),y=event?event.clientY-rect.top:height/2,scope=this.scope(),lane=this.laneKey(track),display=this.displayForTrack(track),channelLayout=signature(this.channelLayout(track));
  const guarded=fn=>()=>this.w.run(()=>{const current=this.track(row);if(!row.isConnected||this.scope()!==scope||!current||this.laneKey(current)!==lane||this.layout(current).count!==layout.count||signature(this.channelLayout(current))!==channelLayout)throw abort();return fn(current);});
  const command=(name,label)=>[label,'',guarded(current=>this.command(current,name,{height,y}))];
  const items=[['Linear',display.scale==='linear'?'✓':'',guarded(current=>this.setScale(current,'linear'))],['dB',display.scale==='db'?'✓':'',guarded(current=>this.setScale(current,'db'))],null,command('reset','Zoom Reset'),command('div2','Zoom x1/2'),command('times2','Zoom x2'),null,command('in','Zoom In'),command('out','Zoom Out')];
  if(event)this.w.menu(event,items);else this.w.menuAt(target,items);
 }
 begin(event,row){
  const target=event.target.closest('[data-amplitude-channel]');if(event.button!==0||!target||!this.advanced||this.blocked()||this.active)return;
  event.preventDefault();event.stopPropagation();const track=this.track(row),rect=target.getBoundingClientRect(),height=rect.height||Number(target.dataset.height);if(!track||!height)return;
  const start=event.clientY-rect.top;this.active={pointerId:event.pointerId,row,target,trackIndex:track.index,lane:this.laneKey(track),scope:this.scope(),count:this.layout(track).count,channelLayout:signature(this.channelLayout(track)),rowHeight:row.style.height,height,top:rect.top,start,end:start,display:this.displayForTrack(track)};
  try{target.setPointerCapture?.(event.pointerId);}catch{}
 }
 valid(active){const track=this.track(active.row),rect=active.target.getBoundingClientRect(),height=rect.height||Number(active.target.dataset.height);return !!(active.target.isConnected&&this.scope()===active.scope&&track&&this.laneKey(track)===active.lane&&this.layout(track).count===active.count&&signature(this.channelLayout(track))===active.channelLayout&&active.row.style.height===active.rowHeight&&height===active.height&&rect.top===active.top&&!this.blocked());}
 move(event){const active=this.active;if(!active||active.pointerId!==event.pointerId)return;if(!this.valid(active)){this.cancel();return;}active.end=event.clientY-active.top;this.preview(active);}
 preview(active){let box=active.target.querySelector('.au-amplitude-drag');if(!box){box=active.target.ownerDocument.createElement('span');box.className='au-amplitude-drag';active.target.append(box);}box.style.top=Math.min(active.start,active.end)+'px';box.style.height=Math.abs(active.end-active.start)+'px';box.hidden=Math.abs(active.end-active.start)<=3;}
 finish(event){const active=this.active;if(!active||active.pointerId!==event.pointerId)return;if(!this.valid(active)){this.cancel();return;}
  active.end=event.clientY-active.top;const action=verticalPointerAction({button:event.button??0,shiftKey:event.shiftKey,cmdKey:this.commandKey(event),advanced:this.advanced,startY:active.start,endY:active.end});
  const track=this.track(active.row);this.clear();if(action.action==='zoom')this.w.run(()=>this.setDisplay(track,verticalZoom(active.display,{height:active.height,...action})));this.w.finishDeferredRender?.();
 }
 clear(){const active=this.active;if(!active)return;this.active=null;active.target.querySelector('.au-amplitude-drag')?.remove();try{if(active.target.hasPointerCapture?.(active.pointerId))active.target.releasePointerCapture(active.pointerId);}catch{}}
 cancel(repaint=true){if(!this.active)return;this.clear();if(repaint)this.w.finishDeferredRender?.();}
 deferRender(){if(!this.active)return false;if(!this.valid(this.active)){this.cancel(false);return false;}this.w.deferredRender=true;return true;}
 wheel(event,row){
  if(!event.shiftKey&&!this.commandKey(event))return;const target=event.target.closest('[data-amplitude-channel]');if(!target)return;event.preventDefault();event.stopPropagation();if(this.active||this.blocked())return;
  const track=this.track(row),rect=target.getBoundingClientRect(),height=rect.height||Number(target.dataset.height),steps=-event.deltaY/(event.deltaMode===1?3:event.deltaMode===2?1:100);if(!track||!height||!steps)return;
  this.w.run(()=>{const result=verticalWheel(this.displayForTrack(track),{height,y:event.clientY-rect.top,steps,shiftKey:event.shiftKey,cmdKey:this.commandKey(event)});if(result.changed)this.setDisplay(track,result.display);});
 }
}
