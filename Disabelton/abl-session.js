/** Disabelton Session View: one column per track with clip slots, a scene column
 * (Main) on the right and per-track stop buttons. Derived from the same project
 * model as the Arrangement (no extra project reads):
 *  - pattern / MIDI lanes: every distinct pattern placed on the lane is one clip
 *    (ordered by its first placement), the slot selects all of its placements;
 *  - audio lanes: every audio clip is one slot (ordered by start).
 * Launching (Freestyle #11 / #14): every pattern clip is pre-armed for the monitoring peer; ▶ on a clip launches it as
 * its track's layer and a scene ▶ launches the row's clips together at one engine time (abl-scene-launch.js,
 * cloud-pattern-arm.js). Audio clips play in the Arrangement only.
 */
import {ablLaneColors} from './abl-track-ops.js';
import {slotPlaying,scenePlaying,scenePreviews,sessionSlotId} from './abl-scene-launch.js';
/** Arrow-key navigation over the clip slots (filled and empty): the nearest slot in the arrow's direction that sits
 * in the same row (← →) or column (↑ ↓). `boxes` are the slots' rectangles; returns an index or -1. */
export function neighbourSlotIndex(boxes,currentIndex,key){
 const current=boxes?.[currentIndex];if(!current)return -1;
 const cx=current.left+current.width/2,cy=current.top+current.height/2,horizontal=key==='ArrowLeft'||key==='ArrowRight',sign=key==='ArrowRight'||key==='ArrowDown'?1:-1;let best=Infinity,found=-1;
 boxes.forEach((other,index)=>{if(index===currentIndex||!(other?.width>0))return;const dx=other.left+other.width/2-cx,dy=other.top+other.height/2-cy,along=horizontal?dx*sign:dy*sign,across=Math.abs(horizontal?dy:dx);if(along<=1||across>2)return;if(along<best){best=along;found=index;}});
 return found;
}
export const ABL_TRACK_COLORS=Object.freeze(['#c8e39c','#ebbd62','#9fd38d','#b4c7ec','#e8a99c','#cfa1e3','#f3ec8a','#cfeff1','#c3b6ea','#e0eb8e','#9ed6d0','#f6d38f','#e6b3c8','#b6dd8c']);
/** Live palette colour by track position. */
export const ablPaletteColor=index=>ABL_TRACK_COLORS[((Number(index)||0)%ABL_TRACK_COLORS.length+ABL_TRACK_COLORS.length)%ABL_TRACK_COLORS.length];
/** The track's colour: the lane colour set with Track ▸ Color (abl-track-ops.js), else the palette by position.
 * Every consumer (Session column, mixer strip, Clip View) reads it from here. */
export const ablTrackColor=index=>{let color=null;try{color=ablLaneColors.displayColor(Number(index));}catch{}return color||ablPaletteColor(index);};
export const PATTERN_MIME='application/vegetable-pattern';
/** Session audio clip → Arrangement: copied on its own lane through the existing audio clipboard path. */
export const SESSION_AUDIO_MIME='application/x-abl-session-audio';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);

/** Pure model: {tracks:[{track,laneId,name,kind,slots:[…]}], scenes}. */
export function sessionModel(project,{minScenes=8}={}){
 const laneIds=Array.isArray(project?.cloud?.timelineLaneIds)?project.cloud.timelineLaneIds:[],lanes=Array.isArray(project?.cloud?.rawProject?.lanes)?project.cloud.rawProject.lanes:[];
 const clips=Array.isArray(project?.clips)?project.clips:[],audio=Array.isArray(project?.audioClips)?project.audioClips:[],patterns=Array.isArray(project?.patterns)?project.patterns:[];
 const rawPatterns=Array.isArray(project?.cloud?.rawProject?.patterns)?project.cloud.rawProject.patterns:[],placedPatterns=new Set([...clips.map(clip=>clip.patternId),...(Array.isArray(project?.cloud?.rawProject?.placements)?project.cloud.rawProject.placements:[]).map(row=>row?.patternId)].filter(Boolean));
 const count=Math.max(laneIds.length,...clips.map(clip=>Number(clip.track)+1).filter(Number.isFinite),...audio.map(clip=>Number(clip.track)+1).filter(Number.isFinite),0);
 const tracks=[];
 for(let track=0;track<count;track++){
  const laneId=laneIds[track]||null,lane=laneId?lanes.find(item=>item.id===laneId):null,kind=lane?.kind||(audio.some(clip=>clip.track===track)?'audio':clips.some(clip=>clip.track===track)?'instrument':'audio');
  const slots=[],byPattern=new Map();
  for(const clip of clips.filter(item=>item.track===track&&item.patternId).sort((a,b)=>a.start-b.start||String(a.id).localeCompare(String(b.id)))){
   let slot=byPattern.get(clip.patternId);
   if(!slot){const pattern=patterns.find(item=>item.id===clip.patternId);slot={type:'pattern',key:'p:'+clip.patternId,patternId:clip.patternId,name:pattern?.name||clip.name||'Clip',clipIds:[],start:clip.start,length:clip.length,muted:false};byPattern.set(clip.patternId,slot);slots.push(slot);}
   slot.clipIds.push(clip.id);if(clip.cloudRaw?.muted)slot.muted=true;
  }
  for(const clip of audio.filter(item=>item.track===track).sort((a,b)=>a.start-b.start||String(a.id).localeCompare(String(b.id))))slots.push({type:'audio',key:'a:'+clip.id,patternId:null,name:clip.name||'Audio',clipIds:[clip.id],start:clip.start,length:clip.length,muted:false});
  slots.sort((a,b)=>a.start-b.start);
  // QA r7: a pattern that plays this track's instrument but has no Arrangement placement is still one of the track's
  // clips (the Delete Track reason names it as a Session clip). List it after the placed clips so the user can find it.
  if(laneId)for(const rawPattern of rawPatterns){if(!rawPattern?.id||placedPatterns.has(rawPattern.id)||!(Array.isArray(rawPattern.pattern?.sources)&&rawPattern.pattern.sources.some(source=>source?.laneId===laneId)))continue;const pattern=patterns.find(item=>item.id===rawPattern.id);slots.push({type:'pattern',key:'u:'+rawPattern.id,patternId:rawPattern.id,name:pattern?.name||rawPattern.name||'MIDI clip',clipIds:[],start:Number.MAX_SAFE_INTEGER,length:0,muted:false,unplaced:true});}
  const end=Math.max(0,...clips.filter(item=>item.track===track).map(item=>item.start+item.length),...audio.filter(item=>item.track===track).map(item=>item.start+item.length));
  tracks.push({track,laneId,name:project?.trackNames?.[track]||lane?.name||`Track ${track+1}`,kind,midi:kind!=='audio',slots,end});
 }
 const scenes=Math.max(minScenes,...tracks.map(item=>item.slots.length+1));
 return{tracks,scenes};
}

/** Render the Session grid into `host` and bind its gestures to `api`. */
/** Placeholder markup for a slot whose MIDI clip is being saved (QA r5: re-rendered on every grid render until the
 * confirmed clip fills that slot, so intermediate project reads never make it flicker off). */
export const sessionPendingSlot=(track,scene,name='MIDI Clip')=>`<div class="abl-slot filled abl-slot-pending" aria-busy="true" data-scene="${scene}" data-track="${track}" title="Saving the new clip in Freestyle…"><span class="abl-slot-name">${esc(name)}</span></div>`;
export function renderSession(host,project,api,{selectedIds=new Set(),selectedTrack=null,previewPatternId=null,previewing=false,previewTrack=null,layers=null,minScenes=8,pending=null,sceneLaunch=false}={}){
 if(!host)return null;
 const model=sessionModel(project,{minScenes}),doc=host.ownerDocument;
 if(!model.tracks.length){host.__ablSession=null;host.innerHTML='<div class="abl-session-empty">No tracks yet. Insert an Audio Track (⌘T) or MIDI Track (⇧⌘T), or drop files here.</div>';return model;}
 const launchTitle=slot=>slot.type==='pattern'?(sceneLaunch?'Launch Clip: starts this clip on its track at the next launch quantization step (control bar); the other tracks keep playing.':'Launch: ▶ plays this pattern clip.'):'Freestyle cannot launch audio clips from the Session View; play the Arrangement (Space).';
 // A single preview (pattern Play) belongs to one track (previewTrack: the clip that was launched, when known).
 const singlePlaying=(item,slot)=>previewing&&!!slot.patternId&&slot.patternId===previewPatternId&&(previewTrack==null||previewTrack===item.track);
 const columns=model.tracks.map(item=>{
  const color=ablTrackColor(item.track),rows=[];
  for(let scene=0;scene<model.scenes;scene++){
   const slot=item.slots[scene];
   if(slot){const playing=singlePlaying(item,slot)||slotPlaying(layers,item,slot);
    rows.push(`<div class="abl-slot filled${playing?' playing':''}${slot.muted?' muted':''}" data-scene="${scene}" data-slot="${esc(slot.key)}" data-track="${item.track}" ${slot.patternId?`data-pattern="${esc(slot.patternId)}" `:`data-audio-clip="${esc(slot.clipIds[0])}" `}draggable="true" title="${esc(slot.name)}${slot.unplaced?' · not placed in the Arrangement · drag into the Arrangement to place it':slot.patternId?' · drag into the Arrangement to place it · double-click to edit':' · drag into the Arrangement (same track) to copy it · double-click to edit'}"><button type="button" class="abl-launch" ${slot.type==='audio'?'disabled ':''}title="${esc(launchTitle(slot))}" aria-label="Launch ${esc(slot.name)}">${playing?'■':'▶'}</button><span class="abl-slot-name">${esc(slot.name)}</span></div>`);}
   else if(pending&&pending.track===item.track&&pending.scene===scene)rows.push(sessionPendingSlot(item.track,scene,pending.name));
   else rows.push(`<div class="abl-slot empty${item.midi&&item.laneId?' creatable':''}" data-scene="${scene}" data-track="${item.track}" title="${item.midi&&item.laneId?'Double-click to insert a MIDI clip (a new empty pattern placed after this track’s last clip), or drop a clip from the Browser’s Clips list or another track here':'Empty clip slot'}"></div>`);
  }
  const trackPlaying=!!layers?.get?.(sessionSlotId(item))||item.slots.some(slot=>singlePlaying(item,slot));
  return `<div class="abl-session-track" data-track="${item.track}" style="--abl-track:${color}"><div class="abl-session-head" title="${esc(item.name)}">${esc(item.name)}</div>${rows.join('')}<div class="abl-session-stop-row"><button type="button" class="abl-track-stop${trackPlaying?' active':''}" title="${sceneLaunch?'Stop the clip playing on this track':'Stop: stops playback'}" aria-label="Stop ${esc(item.name)}"></button></div></div>`;
 }).join('');
 const scenes=Array.from({length:model.scenes},(_,scene)=>{
  const {previews}=scenePreviews(model,scene),usable=sceneLaunch&&previews.length>0,playing=usable&&scenePlaying(layers,model,scene);
  const title=!sceneLaunch?'Scene launch needs the live audio connection':usable?`Launch Scene ${scene+1}: starts its ${previews.length} clip${previews.length===1?'':'s'} together at the next launch quantization step`:'This scene has no MIDI clips to launch';
  return `<div class="abl-scene${usable?' launchable':''}${playing?' playing':''}" data-scene="${scene}" title="${esc(title)}"><button type="button" class="abl-launch abl-scene-launch" ${usable?'':'disabled '}aria-label="Launch Scene ${scene+1}">▶</button>${scene+1}</div>`;}).join('');
 const markup=`${columns}<div class="abl-session-spacer"></div><div class="abl-session-scenes"><div class="abl-session-head">Main</div>${scenes}<div class="abl-session-stop-row"><button type="button" class="abl-stop-all" title="Stop All Clips" aria-label="Stop All Clips"></button></div></div>`;
 // QA r9: Chrome cancels an HTML5 drag whose source element is replaced between the press and dragstart (or during the
 // drag). A render whose markup is unchanged (selection, a project read that changed nothing the grid shows) keeps every
 // element and only repaints the selection classes in place; listeners resolve the slot from the latest model.
 const live=host.__ablSession;
 if(live&&live.markup===markup&&host.firstElementChild){live.model=model;live.api=api;paintSessionSelected(host,model,selectedIds,selectedTrack);return model;}
 const current={markup,model,api};host.__ablSession=current;
 host.innerHTML=markup;
 const slotFor=element=>{const track=current.model.tracks.find(item=>item.track===Number(element.dataset.track));return track?.slots.find(slot=>slot.key===element.dataset.slot)||null;};
 const trackFor=element=>current.model.tracks.find(item=>item.track===Number(element.dataset.track))||null;
 for(const element of host.querySelectorAll('.abl-slot.filled')){
  if(!slotFor(element))continue;const track=Number(element.dataset.track),bound=fn=>event=>{const slot=slotFor(element);if(slot)fn(event,slot,current.api);};
  element.addEventListener('pointerdown',bound((event,slot,api)=>{if(event.button!==0||event.target.closest('.abl-launch'))return;api.selectSlot?.(slot,track,event);}));
  element.addEventListener('dblclick',bound((event,slot,api)=>{if(event.target.closest('.abl-launch'))return;event.preventDefault();api.openSlot?.(slot,track);}));
  element.addEventListener('contextmenu',bound((event,slot,api)=>{event.preventDefault();event.stopPropagation();api.slotMenu?.(event,slot,track);}));
  element.querySelector('.abl-launch')?.addEventListener('click',bound((event,slot,api)=>{event.stopPropagation();if(slot.type==='pattern')api.launch?.(slot,track);}));
  element.addEventListener('dragstart',bound((event,slot,api)=>{try{event.dataTransfer.effectAllowed='copy';if(slot.patternId)event.dataTransfer.setData(PATTERN_MIME,slot.patternId);else event.dataTransfer.setData(SESSION_AUDIO_MIME,JSON.stringify({clipId:slot.clipIds[0],track}));event.dataTransfer.setData('text/plain',slot.name);}catch{}api.dragStart?.(slot,track,event);}));
  element.addEventListener('dragend',event=>current.api.dragEnd?.(event));
 }
 for(const element of host.querySelectorAll('.abl-slot.empty')){
  element.addEventListener('dblclick',event=>{const track=trackFor(element),api=current.api;event.preventDefault();if(!(track?.midi&&track.laneId))return;
   // QA r4: Live shows the new clip in the slot at once. Paint a placeholder in the slot the clip lands in (clips stack, so
   // the first empty one), keep it until the save renders the real clip, and remove it if nothing was created.
   // QA r5: painted synchronously here; the shell keeps it in every later render (`pending`) until the confirmed clip replaces it.
   const landing=track.slots.length,target=host.querySelector(`.abl-slot.empty[data-track="${track.track}"][data-scene="${landing}"]`)||element,saved=target.innerHTML;
   target.classList.remove('empty');target.classList.add('filled','abl-slot-pending');target.setAttribute('aria-busy','true');target.title='Saving the new clip in Freestyle…';target.innerHTML='<span class="abl-slot-name">MIDI Clip</span>';
   const revert=()=>{if(!target.isConnected||!target.classList.contains('abl-slot-pending'))return;target.classList.remove('filled','abl-slot-pending');target.classList.add('empty');target.removeAttribute('aria-busy');target.innerHTML=saved;};
   let made;try{made=api.createClip?.(track,Number(element.dataset.scene),{landing});}catch{revert();return;}Promise.resolve(made).then(result=>{if(!result)revert();},revert);});
  element.addEventListener('pointerdown',event=>{const track=trackFor(element);if(event.button===0&&track)current.api.selectTrack?.(track.track);});
 }
 // Main (master) header: selects the Main track, whose effects show in the Device View (Freestyle #3).
 // Drop a MIDI clip (a Browser ▸ Clips entry or another track's Session clip) on a track column: it becomes that
 // track's next clip slot (api.dropPattern places it in the Arrangement after the track's last clip; Freestyle
 // stores no Session scenes). The landing slot is outlined while the drag is over the column.
 for(const column of host.querySelectorAll('.abl-session-track')){
  const landing=()=>{const track=trackFor(column);return track?host.querySelector(`.abl-slot.empty[data-track="${track.track}"][data-scene="${track.slots.length}"]`):null;};
  const clear=()=>{for(const slot of column.querySelectorAll('.abl-slot-drop'))slot.classList.remove('abl-slot-drop');};
  const carries=event=>[...(event.dataTransfer?.types||[])].includes(PATTERN_MIME)&&typeof current.api.dropPattern==='function';
  column.addEventListener('dragover',event=>{if(!carries(event))return;event.preventDefault();try{event.dataTransfer.dropEffect='copy';}catch{}const slot=landing();if(slot&&!slot.classList.contains('abl-slot-drop')){clear();slot.classList.add('abl-slot-drop');}});
  column.addEventListener('dragleave',event=>{if(!column.contains(event.relatedTarget))clear();});
  column.addEventListener('drop',event=>{if(!carries(event))return;event.preventDefault();clear();const track=trackFor(column),patternId=event.dataTransfer.getData(PATTERN_MIME);if(track&&patternId)current.api.dropPattern(patternId,track,event);});
 }
 const mainHead=host.querySelector('.abl-session-scenes > .abl-session-head');mainHead?.addEventListener('pointerdown',event=>{if(event.button===0)current.api.selectMain?.();});
 for(const element of host.querySelectorAll('.abl-session-head')){const column=element.closest('.abl-session-track');if(!column)continue;element.addEventListener('pointerdown',event=>{if(event.button===0)current.api.selectTrack?.(Number(column.dataset.track));});element.addEventListener('contextmenu',event=>{event.preventDefault();current.api.trackMenu?.(event,Number(column.dataset.track));});element.addEventListener('dblclick',()=>current.api.renameTrack?.(Number(column.dataset.track)));}
 // Live: the track Stop button stops that track's clip; Stop All Clips stops everything.
 for(const button of host.querySelectorAll('.abl-track-stop'))button.addEventListener('click',()=>{const column=button.closest('.abl-session-track'),track=trackFor(column);if(current.api.stopTrack&&track)current.api.stopTrack(track);else current.api.stop?.();});
 for(const button of host.querySelectorAll('.abl-stop-all'))button.addEventListener('click',()=>(current.api.stopAll||current.api.stop)?.());
 for(const button of host.querySelectorAll('.abl-scene-launch'))button.addEventListener('click',event=>{event.stopPropagation();const scene=Number(button.closest('.abl-scene')?.dataset.scene);if(Number.isInteger(scene))current.api.launchScene?.(scene,current.model);});
 paintSessionSelected(host,model,selectedIds,selectedTrack);
 void doc;return model;
}
/** Selection is painted in place (class toggles only), never by replacing slot elements. */
export function paintSessionSelected(host,model,selectedIds=new Set(),selectedTrack=null){
 if(!host)return;
 for(const element of host.querySelectorAll('.abl-slot.filled[data-slot]')){const track=model?.tracks?.find(item=>item.track===Number(element.dataset.track)),slot=track?.slots.find(item=>item.key===element.dataset.slot);element.classList.toggle('selected',!!slot&&slot.clipIds.some(id=>selectedIds.has(id)));}
 for(const column of host.querySelectorAll('.abl-session-track'))column.classList.toggle('selected',Number(column.dataset.track)===selectedTrack);
}
