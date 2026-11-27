/** Cloud pattern thumbnails, using native Studio sample rows and placement loop tiles. */
const num=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const positive=(value,fallback)=>num(value)>0?Number(value):fallback;
const list=value=>Array.isArray(value)?value:[];
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const dtoFor=pattern=>pattern?.cloudRaw?.data?.pattern?pattern.cloudRaw.data:pattern?.cloudRaw||{};

/** Constant-time source length shared by thumbnails and frame-rate playback cursors. */
export function patternLengthBeats(pattern){
 const dto=dtoFor(pattern),ppq=positive(dto.ppq,96),declaredBars=positive(dto.bars,positive(dto.lengthTicks??dto.length_ticks,384)/ppq/4);
 const ticks=positive(dto.lengthTicks??dto.length_ticks,declaredBars*4*ppq);
 // Since 338 a saved `bars` change also rewrites lengthTicks (live
 // 2026-11-11: bars 1→3→1 read back 1152 then 384), so the two agree.
 // `bars` stays authoritative over a lengthTicks that ends whole bars short
 // of it (rows saved before 338); longer ticks (late canonical hits) and a
 // sub-bar lengthTicks inside its bars remain exact.
 const shortTicks=Number.isInteger(dto.bars)&&dto.bars>0&&Math.ceil(ticks/(4*ppq)-1e-9)<dto.bars;
 const rawLength=shortTicks?dto.bars*4:ticks/ppq;
 return pattern?.bars!=null&&positive(pattern.bars,declaredBars)!==declaredBars?positive(pattern.bars,declaredBars)*4:rawLength;
}

/** Atomic split receipts report cycle phase separately from source trimming. */
export function patternLoopPhaseBeats(raw,{base,loop,offset,msToBeat}){
 const milliseconds=Number(raw.loopPhaseMs??raw.loop_phase_ms??0);
 if(!Number.isFinite(milliseconds)||milliseconds<0)return null;
 if(milliseconds===0)return 0;
 // Verified native receipt: untrimmed source and an unchanged constant cycle.
 // A phase combined with per-tile source trimming needs its own engine contract.
 if(offset!==0||Math.abs(loop-base)>1e-9||base<=0)return null;
 const phase=milliseconds*msToBeat;return((phase%base)+base)%base;
}

/** Beat-domain events include pending UI edits and canonical off-grid sample hits. */
export function collectPatternPreviewEvents(pattern,{sourceIds}={}){
 const dto=dtoFor(pattern),content=dto.pattern||{},sources=list(content.sources),ppq=positive(dto.ppq,96),lengthBeats=patternLengthBeats(pattern);
 const bySource=new Map(sources.map((source,index)=>[String(source.id),{...source,order:num(source.order,index)}]));
 const selected=sourceIds?new Set([...sourceIds].map(String)):null;
 const mapped=new Set(list(pattern?.cloudMappedEventIds).map(String)),events=[],seen=new Set();
 const resolve=channel=>{const id=String(pattern?.cloudSources?.[channel]??channel),source=bySource.get(id)||{};return{id,kind:source.kind==='plugin'?'midi':'sample',order:num(source.order,sources.length)};};
 const add=event=>{
  if(selected&&!selected.has(event.channelId)&&!selected.has(event.sourceId))return;
  if(!Number.isFinite(event.start)||event.start<0||event.start>=lengthBeats)return;
  const key=[event.kind,event.sourceId,event.start,event.kind==='midi'?`${event.pitch}:${event.duration}`:'hit'].join(':');
  if(seen.has(key))return;seen.add(key);events.push(event);
 };
 for(const [channel,steps]of Object.entries(pattern?.steps||{})){
  const source=resolve(channel);list(steps).forEach((active,index)=>{if(!active)return;add({kind:source.kind,sourceId:source.id,channelId:String(channel),order:source.order,start:index/4,duration:.25,pitch:60,velocity:typeof active==='number'?active:100/128});});
 }
 for(const [channel,notes]of Object.entries(pattern?.notes||{})){
  const source=resolve(channel),kind=bySource.has(source.id)?source.kind:'midi';
  for(const note of list(notes)){
   if(note.cloudRaw?.id!=null)mapped.add(String(note.cloudRaw.id));
   add({id:note.id,kind,sourceId:source.id,channelId:String(channel),order:source.order,start:num(note.start),duration:positive(note.duration,.25),pitch:clamp(num(note.pitch,60),0,127),velocity:clamp(num(note.velocity,.8),0,1)});
  }
 }
 // Grid-inexpressible canonical events still play. Mapped IDs suppress stale raw
 // copies when the UI removes or edits a note/step before its cloud write settles.
 for(const event of list(content.events)){
  if(mapped.has(String(event.id)))continue;
  const kind=String(event.type||'midi').toLowerCase();if(!['sample','midi'].includes(kind))continue;
  const sourceId=String(event.sourceId??event.source_id??''),source=bySource.get(sourceId)||{};
  add({id:event.id,kind,sourceId,channelId:sourceId,order:num(source.order,sources.length),start:num(event.startTick??event.start_tick??event.tick)/ppq,duration:positive(event.durationTick??event.duration_tick,ppq/4)/ppq,pitch:clamp(num(event.note??event.pitch,60),0,127),velocity:clamp(num(event.velocity,kind==='sample'?.9:.78),0,1)});
 }
 return{events,lengthBeats,sources};
}

/** Native Yh event scaling and timeline loop tiles, expressed in musical beats. */
export function patternPreviewGeometry(pattern,{clip,bpm=120,width=200,height=42,sourceIds,maxEvents=50000}={}){
 const {events,lengthBeats}=collectPatternPreviewEvents(pattern,{sourceIds}),raw=clip?.cloudRaw||{},msToBeat=positive(bpm,120)/60000;
 const base=positive(raw.durationMs??raw.duration_ms,0)*msToBeat||lengthBeats;
 const loop=positive(raw.loopDurationMs??raw.loop_duration_ms,0)*msToBeat||base;
 const offset=Math.max(0,num(raw.offsetMs??raw.offset_ms))*msToBeat;
 const windowMs=positive(raw.windowMs??raw.window_ms,0);
 const windowBeats=clip?positive(clip.length,windowMs?windowMs*msToBeat:Math.max(50*msToBeat,base*positive(raw.repeatCount,1)-offset)):lengthBeats;
 const tiled=windowMs>0,cycle=clip?(tiled?loop<base-.002?loop:Math.max(50*msToBeat,base-offset):base):lengthBeats;
 const loopPhase=clip?patternLoopPhaseBeats(raw,{base,loop,offset,msToBeat}):0;
 if(loopPhase===null)return{width,height,lengthBeats,windowBeats,cycleBeats:cycle,repeats:0,shapes:[],seams:[],sampleSources:[],truncated:false,minNoteWidth:0,phaseSupported:false};
 const conversion=clip?Math.max(base,loop):lengthBeats,scale=conversion/lengthBeats;
 const repeats=clip?Math.min(128,Math.max(1,Math.ceil((windowBeats+loopPhase+(tiled?0:offset))/cycle-1e-4))):1;
 const samples=events.filter(event=>event.kind==='sample'),midi=events.filter(event=>event.kind==='midi');
 const sampleOrder=new Map();for(const event of samples)if(!sampleOrder.has(event.sourceId))sampleOrder.set(event.sourceId,event.order);
 const sampleSources=[...sampleOrder].sort((a,b)=>a[1]-b[1]).map(([id])=>id),rowIndex=new Map(sampleSources.map((id,index)=>[id,index]));
 const minPitch=midi.length?Math.min(...midi.map(event=>event.pitch)):48,maxPitch=midi.length?Math.max(...midi.map(event=>event.pitch)):72;
 // Native MIDI-only:24..76%; mixed MIDI:10..44%, sample rows below52..94%.
 // Sample-only:12..88%. Empty canonical sources do not reserve visual rows.
 const noteTop=samples.length?10:24,noteRange=samples.length?34:52,sampleTop=midi.length?noteTop+noteRange+8:12;
 const sampleRowHeight=Math.max(4,(midi.length?94:88)-sampleTop)/Math.max(1,sampleSources.length);
 const shapes=[],seams=[],rowStride=new Map(),maxPerRow=Math.max(8,Math.floor(400/Math.max(1,sampleSources.length)));
 for(const id of sampleSources)rowStride.set(id,Math.max(1,Math.ceil(samples.filter(event=>event.sourceId===id).length/maxPerRow)));
 const visible=[...midi,...sampleSources.flatMap(id=>samples.filter(event=>event.sourceId===id).sort((a,b)=>a.start-b.start).filter((_,index)=>index%rowStride.get(id)===0))];
 let truncated=false;
 for(let repeat=0;repeat<repeats;repeat++){
  const origin=repeat*cycle-offset-loopPhase,segmentStart=Math.max(0,repeat*cycle-loopPhase-(tiled?0:offset)),segmentEnd=Math.min(windowBeats,(repeat+1)*cycle-loopPhase-(tiled?0:offset));
  if(repeat>0&&segmentStart>0&&segmentStart<windowBeats)seams.push(segmentStart/windowBeats*width);
  for(const event of visible){
   const start=origin+event.start*scale,duration=event.duration*scale;
   if(event.kind==='sample'&&(start<segmentStart||start>=segmentEnd))continue;
   if(event.kind==='midi'&&(start+duration<=segmentStart||start>=segmentEnd))continue;
   if(shapes.length>=maxEvents){truncated=true;break;}
   const left=Math.max(segmentStart,start),right=Math.min(segmentEnd,start+duration);
   const y=event.kind==='sample'?sampleTop+(rowIndex.get(event.sourceId)+.5)*sampleRowHeight:noteTop+(maxPitch-event.pitch)/Math.max(1,maxPitch-minPitch)*noteRange;
   shapes.push({...event,repeat,start:Math.max(0,left),end:Math.max(0,right),x:left/windowBeats*width,y:y/100*height,width:event.kind==='sample'?0:Math.max(0,(right-left)/windowBeats*width),rowHeight:sampleRowHeight/100*height});
  }
  if(truncated)break;
 }
 return{width,height,lengthBeats,windowBeats,cycleBeats:cycle,repeats,shapes,seams,sampleSources,truncated,minNoteWidth:cycle/windowBeats*width*.02,phaseSupported:true};
}

// noteHeight (viewBox units of the 42-unit height): Playlist clips keep thin 2.5 lines; the
// Channel Rack's FL mini piano roll uses taller note bars.
export function patternPreviewSvg(pattern,{color='currentColor',noteHeight=2.5,...options}={}){
 const geometry=patternPreviewGeometry(pattern,options),fmt=n=>Number(n.toFixed(4));
 const shapes=geometry.shapes.map(shape=>shape.kind==='sample'?`<path data-preview-kind="sample" data-preview-source="${escape(shape.sourceId)}" d="M${fmt(shape.x)} ${fmt(shape.y)}h.001" stroke="${escape(color)}" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`:`<rect data-preview-kind="midi" x="${fmt(shape.x)}" y="${fmt(shape.y)}" width="${fmt(Math.max(geometry.minNoteWidth,shape.width))}" height="${fmt(Math.max(.5,Number(noteHeight)||2.5))}"/>`).join('');
 const seams=geometry.seams.map(x=>`<path d="M${fmt(x)} 0v${geometry.height}" stroke="currentColor" stroke-opacity=".18" stroke-width=".5" vector-effect="non-scaling-stroke"/>`).join('');
 return `<svg class="pattern-preview-svg" viewBox="0 0 ${geometry.width} ${geometry.height}" preserveAspectRatio="none" fill="${escape(color)}" aria-hidden="true">${seams}${shapes}</svg>`;
}
