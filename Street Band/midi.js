
import {patternLengthBeats,patternLoopPhaseBeats} from './pattern-preview.js';
const value=(n,fallback)=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n))?Number(n):fallback;
const positive=(n,fallback)=>value(n,0)>0?Number(n):fallback;
const list=n=>Array.isArray(n)?n:[];
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
const dtoFor=pattern=>pattern?.cloudRaw?.data?.pattern?pattern.cloudRaw.data:pattern?.cloudRaw||{};
function boolean(value,fallback=false){return typeof value==='boolean'?value:fallback;}
function channelFlag(channel,source,key,alias){return typeof channel?.[key]==='boolean'?channel[key]:typeof channel?.[alias]==='boolean'?channel[alias]:boolean(source?.[alias],boolean(source?.[key]));}
function patternEvents(pattern,project){
 const dto=dtoFor(pattern),content=dto.pattern||{},sources=list(content.sources),ppq=positive(dto.ppq,96),channels=list(project.channels),bySource=new Map(sources.map(source=>[String(source.id),source])),mapped=new Set(list(pattern.cloudMappedEventIds).map(String)),events=[];
 const resolve=id=>{const native=pattern.cloudSources?.[id]??id,source=bySource.get(String(native))||{},channel=channels.find(channel=>channel.id===id);return{channelId:String(id),nativeId:String(native),source,channel};};
 const rawResolve=native=>{
  const key=Object.keys(pattern.cloudSources||{}).find(key=>String(pattern.cloudSources[key])===String(native));
  const owned=channels.find(channel=>channel.patternSource&&String(channel.patternId)===String(pattern.id)&&String(channel.sourceId)===String(native));
  return resolve(key??owned?.id??native);
 };
 const representedSteps=new Map(),representedNotes=new Set();
 const add=(binding,event)=>{if(!binding.channel)return;const velocity=value(event.velocity,.8);if(velocity<=0||event.muted||channelFlag(binding.channel,binding.source,'mute','muted'))return;if(!Number.isFinite(event.start)||event.start<0||!Number.isFinite(event.duration)||event.duration<=0)return;events.push({...binding,...event,velocity:Math.min(1,velocity)});};
 for(const [id,steps]of Object.entries(pattern.steps||{})){
  const binding=resolve(id);representedSteps.set(binding.nativeId,list(steps).length);
  list(steps).forEach((active,index)=>{if(active)add(binding,{start:index/4,duration:.25,pitch:60,velocity:typeof active==='number'?active:100/128,carry:false});});
 }
 for(const [id,notes]of Object.entries(pattern.notes||{})){
  const binding=resolve(id);representedNotes.add(binding.nativeId);
  for(const note of list(notes)){
   if(note.cloudRaw?.id!=null)mapped.add(String(note.cloudRaw.id));
   add(binding,{start:value(note.start,0),duration:value(note.duration,.5),pitch:value(note.pitch,60),velocity:value(note.velocity,.8),muted:boolean(note.muted,boolean(note.mute,boolean(note.cloudRaw?.muted))),carry:true});
  }
 }
 for(const event of list(content.events)){
  if(mapped.has(String(event.id))||!['midi','sample'].includes(event.type))continue;const binding=rawResolve(event.sourceId??event.source_id),native=binding.nativeId;
  const eventStart=event.startTick??event.start_tick,eventDuration=event.durationTick??event.duration_tick,noteLike=eventStart!=null&&eventDuration!=null;
  if(!Array.isArray(pattern.cloudMappedEventIds)){
   if(noteLike&&representedNotes.has(native))continue;
   const step=value(event.tick,NaN)/ppq*4;if(event.type==='sample'&&!noteLike&&Number.isInteger(step)&&step>=0&&step<(representedSteps.get(native)||0))continue;
  }
  add(binding,{start:value(eventStart??event.tick,NaN)/ppq,duration:noteLike?value(eventDuration,NaN)/ppq:.25,pitch:value(event.note??event.pitch,60),velocity:value(event.velocity,.8),muted:boolean(event.muted),carry:noteLike||event.type==='midi'});
 }
 const solo=new Set();for(const source of sources){const binding=rawResolve(source.id);if(channelFlag(binding.channel,source,'solo','soloed'))solo.add(String(source.id));}for(const id of new Set([...Object.keys(pattern.steps||{}),...Object.keys(pattern.notes||{})])){const binding=resolve(id);if(channelFlag(binding.channel,binding.source,'solo','soloed'))solo.add(binding.nativeId);}
 return solo.size?events.filter(event=>solo.has(event.nativeId)):events;
}

/** Uncapped musical placement compilation; no thumbnail deduplication or draw budget. */
export function compileProjectEvents(project,mode='song'){
 const patterns=list(project.patterns),selected=patterns.find(pattern=>pattern.id===project.selectedPattern)||patterns[0],bpm=positive(project.bpm,128),msToBeat=bpm/60000;
 const clips=mode==='pattern'?(selected?[{patternId:selected.id,start:0,length:patternLengthBeats(selected)}]:[]):list(project.clips),mutedTracks=new Set(project.mutedTracks||[]),events=[];
 const soloPlacements=mode==='song'&&clips.some(clip=>boolean(clip.soloed,boolean(clip.solo,boolean(clip.cloudRaw?.soloed))));
 const globalSolos=list(project.channels).filter(channel=>!channel.patternSource&&boolean(channel.solo,boolean(channel.soloed))),globalSoloIds=new Set(globalSolos.flatMap(channel=>[channel.id,channel.laneId].filter(id=>id!=null).map(String)));
 let length=mode==='pattern'&&selected?patternLengthBeats(selected):4;const sourcePpqs=new Set();
 for(const clip of clips){
  const pattern=patterns.find(pattern=>pattern.id===clip.patternId);if(!pattern)continue;const raw=clip.cloudRaw||{},start=value(clip.start,0),patternLength=patternLengthBeats(pattern);if(start<0||!Number.isFinite(start)||!Number.isFinite(patternLength)||patternLength<=0)throw new Error('MIDI export needs complete positive pattern and placement timing.');
  const base=positive(raw.durationMs??raw.duration_ms,0)*msToBeat||patternLength,loop=positive(raw.loopDurationMs??raw.loop_duration_ms,0)*msToBeat||base;
  const offset=own(raw,'offsetMs')||own(raw,'offset_ms')?Math.max(0,value(raw.offsetMs??raw.offset_ms,0))*msToBeat:Math.max(0,value(clip.offset,0));
  const windowMs=positive(raw.windowMs??raw.window_ms,0),clipLength=positive(clip.length,windowMs?windowMs*msToBeat:base*positive(raw.repeatCount??raw.repeat_count,1)-offset);if(!Number.isFinite(clipLength)||clipLength<=0)throw new Error('MIDI export needs a non-empty placement window.');
  length=Math.max(length,start+clipLength);const muted=boolean(clip.muted,boolean(clip.mute,boolean(raw.muted))),solo=boolean(clip.soloed,boolean(clip.solo,boolean(raw.soloed)));
  if(mode==='song'&&(muted||mutedTracks.has(clip.track)||soloPlacements&&!solo))continue;
  const cycle=windowMs>0?(loop<base-.002?loop:Math.max(50*msToBeat,base-offset)):base,phase=patternLoopPhaseBeats(raw,{base,loop,offset,msToBeat});
  if(phase===null)throw new Error('MIDI export needs the engine phase contract for this offset/loop combination. No unphased MIDI file was created.');
  const ppq=dtoFor(pattern).ppq??pattern.midiPpqn??pattern.ppq;if(ppq!=null)sourcePpqs.add(ppq);
  const scale=Math.max(base,loop)/patternLength,repeats=Math.max(1,Math.ceil((clipLength+phase+(windowMs?0:offset))/cycle)),sourceEvents=patternEvents(pattern,project),lane=clip.laneId??raw.laneId??raw.lane_id??project.cloud?.timelineLaneIds?.[clip.track];
  if(!Number.isSafeInteger(repeats)||cycle<=0||!Number.isFinite(cycle))throw new Error('The MIDI placement repeat span exceeds the supported integer range.');
  const laneChannel=list(project.channels).find(channel=>!channel.patternSource&&lane!=null&&String(channel.laneId??channel.id)===String(lane));if(channelFlag(laneChannel,null,'mute','muted'))continue;
  for(let repeat=0;repeat<repeats;repeat++){
   const origin=repeat*cycle-offset-phase,segmentStart=Math.max(0,repeat*cycle-phase-(windowMs?0:offset)),segmentEnd=Math.min(clipLength,(repeat+1)*cycle-phase-(windowMs?0:offset));if(segmentEnd<=segmentStart)continue;
   for(const event of sourceEvents){
    if(event.start>=patternLength)continue;
    if(globalSoloIds.size&&!globalSoloIds.has(event.channelId)&&!globalSoloIds.has(String(event.source.laneId))&&!globalSoloIds.has(String(lane)))continue;
    const sourceLane=list(project.channels).find(channel=>!channel.patternSource&&event.source.laneId!=null&&String(channel.laneId??channel.id)===String(event.source.laneId));if(channelFlag(sourceLane,null,'mute','muted'))continue;
    const at=origin+event.start*scale,duration=event.duration*scale;
    if(event.carry?at+duration<=segmentStart||at>=segmentEnd:at<segmentStart||at>=segmentEnd)continue;
    const left=Math.max(segmentStart,at),right=Math.min(segmentEnd,at+duration);if(right<=left)continue;
    events.push({channelId:event.channelId,pitch:Math.max(0,Math.min(127,event.pitch)),velocity:event.velocity,beat:start+left,duration:right-left,sourceOffset:Math.max(0,left-at),clipRemaining:clipLength-left,track:clip.track});
   }
  }
 }
 events.sort((a,b)=>a.beat-b.beat);return{events,length,sourcePpqs:[...sourcePpqs]};
}

const MAX_PPQN=32767;
const gcd=(a,b)=>{while(b){const next=a%b;a=b;b=next;}return a;};
const lcm=(a,b)=>a/gcd(a,b)*b;
const exactTick=(beat,ppq)=>{const tick=beat*ppq,rounded=Math.round(tick);return Number.isSafeInteger(rounded)&&rounded>=0&&Math.abs(tick-rounded)<=Number.EPSILON*Math.max(1,Math.abs(tick))*32;};
/** Select a representable SMF grid, never expand a short note to an arbitrary tick. */
export function midiPpqn(project,{events,length,sourcePpqs}){
 const declared=[project.midi?.division,...(sourcePpqs??list(project.patterns).map(pattern=>dtoFor(pattern).ppq??pattern.midiPpqn??pattern.ppq))].filter(value=>value!=null).map(Number);
 if(declared.some(value=>!Number.isFinite(value)||value<=0))throw new Error('A source MIDI PPQ is invalid.');
 let base=1;for(const value of declared){const next=Number.isInteger(value)?lcm(base,value):Infinity;if(!Number.isSafeInteger(next)||next>MAX_PPQN){base=1;break;}base=next;}const legacy=lcm(base,480);if(legacy<=MAX_PPQN)base=legacy;
 const values=[length,...events.flatMap(event=>[event.beat,event.beat+event.duration])],fractions=[...new Set(values.map(value=>value-Math.floor(value)))];
 const maximum=values.reduce((result,value)=>Math.max(result,Math.abs(value)),0);
 const usable=ppq=>fractions.every(value=>Math.abs(value*ppq-Math.round(value*ppq))<=Math.max(1e-7,Number.EPSILON*Math.max(1,maximum*ppq)*32))&&values.every(value=>exactTick(value,ppq))&&events.every(event=>Math.round((event.beat+event.duration)*ppq)>Math.round(event.beat*ppq));
 for(let ppq=base;ppq<=MAX_PPQN;ppq+=base)if(usable(ppq))return ppq;
 // Declared grids can be mutually incommensurate even when the actual played
 // notes share a smaller exact grid. Preserve every boundary, not unused ticks.
 for(let ppq=1;ppq<=MAX_PPQN;ppq++)if(ppq%base!==0&&usable(ppq))return ppq;
 throw new Error('These MIDI note boundaries cannot be represented exactly within the standard 32767-PPQ limit. No timing was silently rounded.');
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');
const colours = ['#d39d70','#bfc972','#7bbdaa','#a0a3cd','#cc8b9d','#87b5c9'];
const drumNotes = {kick:36,clap:39,snare:38,hat:42,hihat:42,openhat:46};
const defaultPrograms = {keys:0,piano:0,bass:33,'808':38,pad:89,synth:81};
const instrument = program => {
  if (program < 8) return {type:'keys',name:['Piano','Bright piano','Electric grand','Honky-tonk','Electric piano','Electric piano 2','Harpsichord','Clavinet'][program]};
  if (program >= 32 && program <= 39) return {type:'bass',name:'Bass'};
  if (program >= 88 && program <= 95) return {type:'pad',name:'Pad'};
  if (program >= 80 && program <= 87) return {type:'synth',name:'Lead'};
  if (program >= 16 && program <= 23) return {type:'synth',name:'Organ'};
  if (program >= 24 && program <= 31) return {type:'keys',name:'Guitar'};
  if (program >= 40 && program <= 55) return {type:'pad',name:'Strings'};
  if (program >= 56 && program <= 79) return {type:'synth',name:'Wind'};
  return {type:'keys',name:'Instrument'};
};
const drumType = pitch => pitch === 35 || pitch === 36 ? 'kick' : pitch === 39 ? 'clap' : pitch === 42 || pitch === 44 ? 'hat' : pitch === 46 ? 'openhat' : 'snare';
const uint16 = value => [(value >>> 8) & 255,value & 255];
const uint32 = value => [(value >>> 24) & 255,(value >>> 16) & 255,(value >>> 8) & 255,value & 255];
function variable(value) {
  if(!Number.isSafeInteger(value)||value<0||value>0x0fffffff)throw new Error('A MIDI event gap exceeds the standard variable-length timing range.');
  const bytes = [value & 127];
  while ((value >>>= 7)) bytes.unshift((value & 127) | 128);
  return bytes;
}
function meta(kind, data) { return [255,kind,...variable(data.length),...data]; }
function chunk(name, bytes) { return [...textEncoder.encode(name),...uint32(bytes.length),...bytes]; }
function trackChunk(events, lastTick = 0) {
  events.sort((a,b) => a.tick - b.tick || (a.order || 0) - (b.order || 0));
  const bytes = []; let tick = 0;
  for (const event of events) {
    bytes.push(...variable(event.tick - tick),...event.data); tick = event.tick;
  }
  bytes.push(...variable(Math.max(0,lastTick-tick)),255,47,0);
  // Avoid spreading entire long performances into a function call.
  return new Uint8Array([...textEncoder.encode('MTrk'),...uint32(bytes.length),...bytes]);
}

/** Write a format-1 MIDI file on a source-compatible, exactly representable grid. */
export function encodeMidi(project, mode = 'song') {
  const compiled=compileProjectEvents(project,mode),{events,length}=compiled,PPQN=midiPpqn(project,compiled);
  const bpm=project.bpm==null?128:Number(project.bpm),microseconds=Math.round(60000000/bpm);
  if(!Number.isFinite(bpm)||bpm<=0||microseconds<1||microseconds>0xffffff)throw new Error('The project tempo is outside the standard MIDI tempo range.');
  const conductor = trackChunk([
    {tick:0,order:-3,data:meta(3,textEncoder.encode(project.title || 'Street Band'))},
    {tick:0,order:-2,data:meta(81,[(microseconds>>>16)&255,(microseconds>>>8)&255,microseconds&255])},
    {tick:0,order:-1,data:meta(88,[4,2,24,8])},
  ],Math.round(length*PPQN));
  const chunks = [conductor]; let melodicIndex = 0;
  for (const channel of project.channels || []) {
    const channelEvents = events.filter(event=>event.channelId===channel.id);
    if (!channelEvents.length) continue;
    const percussion = Object.hasOwn(drumNotes,channel.type);
    const index = melodicIndex++;
    const midiChannel = percussion ? 9 : index % 15 >= 9 ? index % 15 + 1 : index % 15;
    const port = Math.floor(index/15);if(port>127)throw new Error('The MIDI arrangement exceeds the standard MIDI-port range.');
    const program = clamp(channel.midiProgram ?? defaultPrograms[channel.type] ?? 0,0,127);
    const data = [
      {tick:0,order:-5,data:meta(3,textEncoder.encode(channel.name || 'Instrument'))},
      {tick:0,order:-4,data:meta(33,[port&127])},
      {tick:0,order:-3,data:[0xc0|midiChannel,program]},
      {tick:0,order:-2,data:[0xb0|midiChannel,7,Math.round(clamp(channel.volume ?? .8,0,1)*127)]},
      {tick:0,order:-1,data:[0xb0|midiChannel,10,Math.round((clamp(channel.pan ?? 0,-1,1)+1)*63.5)]},
    ];
    for (const event of channelEvents) {
      const pitch = Math.round(percussion && !channel.midiPercussion ? drumNotes[channel.type] : clamp(event.pitch,0,127));
      const tick = Math.round(event.beat*PPQN);
      const endTick=Math.round((event.beat+event.duration)*PPQN),duration=endTick-tick;
      if(duration<=0)throw new Error('A MIDI note cannot be represented without expanding its timing.');
      if ((event.velocity ?? .8) <= 0) continue;
      const velocity = Math.max(1,Math.round(clamp(event.velocity ?? .8,0,1)*127));
      data.push({tick,order:1,data:[0x90|midiChannel,pitch,velocity]}, {tick:tick+duration,order:0,data:[0x80|midiChannel,pitch,0]});
    }
    chunks.push(trackChunk(data,Math.round(length*PPQN)));
  }
  if(chunks.length>65535)throw new Error('The arrangement exceeds the standard MIDI track count.');
  const header = new Uint8Array(chunk('MThd',[...uint16(1),...uint16(chunks.length),...uint16(PPQN)]));
  return new Blob([header,...chunks],{type:'audio/midi'});
}

class Reader {
  constructor(bytes) {this.bytes=bytes;this.position=0;}
  ensure(count) {if(this.position+count>this.bytes.length) throw new Error('The MIDI file is truncated.');}
  byte() {this.ensure(1);return this.bytes[this.position++];}
  number(count) {let result=0;for(let i=0;i<count;i++) result=result*256+this.byte();return result;}
  slice(count) {this.ensure(count);const bytes=this.bytes.subarray(this.position,this.position+count);this.position+=count;return bytes;}
  variable() {let result=0;for(let i=0;i<4;i++){const n=this.byte();result=(result<<7)|(n&127);if(!(n&128))return result;}throw new Error('The MIDI file contains an invalid variable-length integer.');}
  data() {const n=this.byte();if(n>127)throw new Error('The MIDI file contains an invalid event.');return n;}
}

/** Import standard format-0/1 MIDI into editable notes and a full-length pattern. */
export function decodeMidi(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > 64*1024*1024) throw new Error('MIDI files larger than 64 MB are not supported.');
  const reader = new Reader(bytes);
  if(textDecoder.decode(reader.slice(4))!=='MThd') throw new Error('This is not a standard MIDI file.');
  const headerSize=reader.number(4);
  if(headerSize<6)throw new Error('The MIDI header is invalid.');
  const format=reader.number(2), trackCount=reader.number(2), division=reader.number(2);
  if(format>1)throw new Error('Format-2 MIDI contains independent songs; please export format 0 or 1.');
  if(division&0x8000)throw new Error('SMPTE MIDI timing is not supported; please export musical PPQN timing.');
  if(!division || !trackCount || trackCount>4096)throw new Error('The MIDI timing or track count is invalid.');
  reader.slice(headerSize-6);
  const tempos=[]; const tracks=[]; const allNotes=[];
  let noteCount=0, fileEndTick=0;
  for(let trackIndex=0;trackIndex<trackCount;) {
    const name=textDecoder.decode(reader.slice(4)); const size=reader.number(4);
    const content=reader.slice(size); if(name!=='MTrk')continue;
    const track={index:trackIndex++,name:'',notes:[],lastTick:0}; tracks.push(track);
    const data=new Reader(content), programs=new Array(16).fill(0), volumes=new Array(16).fill(.8), pans=new Array(16).fill(0), pedals=new Array(16).fill(false);
    const active=new Map(), deferred=Array.from({length:16},()=>[]);
    let tick=0,running=0,port=0;
    const finish=(note,endTick)=>{note.end=Math.max(note.start+1,endTick);track.notes.push(note);allNotes.push(note);};
    const release=(channel,pitch)=>{
      const key=channel*128+pitch, stack=active.get(key);
      if(!stack?.length)return;
      const note=stack.shift();if(!stack.length)active.delete(key);
      if(pedals[channel])deferred[channel].push(note);else finish(note,tick);
    };
    while(data.position<data.bytes.length) {
      tick+=data.variable(); track.lastTick=tick;
      let status=data.byte();
      if(status<128) {
        if(!running)throw new Error('The MIDI file uses running status before any channel event.');
        data.position--;status=running;
      }
      if(status===255) {
        const kind=data.byte(), payload=data.slice(data.variable());
        if(kind===3)track.name=textDecoder.decode(payload).replaceAll('\0','').trim();
        if(kind===81 && payload.length===3) {
          const us=payload[0]*65536+payload[1]*256+payload[2];if(us>0)tempos.push({tick,us});
        }
        if(kind===33 && payload.length)port=payload[0];
        if(kind===47)break;
        continue;
      }
      if(status===240 || status===247) {data.slice(data.variable());running=0;continue;}
      if(status>=240)throw new Error('The MIDI file contains an unsupported system event.');
      running=status;
      const channel=status&15,kind=status>>4,a=data.data(),b=kind===12||kind===13?0:data.data();
      if(kind===9 && b>0) {
        if(++noteCount>1000000)throw new Error('The MIDI file has too many notes.');
        const note={trackIndex:track.index,channel,port,program:programs[channel],pitch:a,velocity:b/127,start:tick,volume:volumes[channel],pan:pans[channel]};
        const key=channel*128+a; if(!active.has(key))active.set(key,[]);active.get(key).push(note);
      } else if(kind===8 || (kind===9 && b===0)) release(channel,a);
      else if(kind===12)programs[channel]=a;
      else if(kind===11) {
        if(a===7)volumes[channel]=b/127;
        if(a===10)pans[channel]=(b-64)/64;
        if(a===64) {
          const sustain=b>=64;
          if(pedals[channel]&&!sustain) {for(const note of deferred[channel])finish(note,tick);deferred[channel]=[];}
          pedals[channel]=sustain;
        }
        if(a===120||a===123) {
          for(const [key,notes] of active)if(Math.floor(key/128)===channel){for(const note of notes)finish(note,tick);active.delete(key);}
          for(const note of deferred[channel])finish(note,tick);deferred[channel]=[];
        }
      }
    }
    for(const notes of active.values())for(const note of notes)finish(note,Math.max(tick,note.start+division/4));
    for(const notes of deferred)for(const note of notes)finish(note,Math.max(tick,note.start+division/4));
    fileEndTick=Math.max(fileEndTick,tick);
  }
  tempos.sort((a,b)=>a.tick-b.tick);
  let initialUs=500000;
  for(const tempo of tempos)if(tempo.tick===0)initialUs=tempo.us;
  const bpm=60000000/initialUs;
  const segments=[{tick:0,seconds:0,us:initialUs}];
  for(const tempo of tempos) {
    const previous=segments.at(-1);
    const seconds=previous.seconds+(tempo.tick-previous.tick)/division*previous.us/1e6;
    if(tempo.tick===previous.tick)segments[segments.length-1]={...tempo,seconds};else segments.push({...tempo,seconds});
  }
  const toBeat=tick=>{
    let low=0,high=segments.length-1;
    while(low<high){const mid=Math.ceil((low+high)/2);if(segments[mid].tick<=tick)low=mid;else high=mid-1;}
    const segment=segments[low];
    return (segment.seconds+(tick-segment.tick)/division*segment.us/1e6)*bpm/60;
  };
  const channels=[],groups=new Map(),notes={}; let lastBeat=toBeat(fileEndTick);
  for(const note of allNotes.sort((a,b)=>a.start-b.start || a.pitch-b.pitch)) {
    const percussion=note.channel===9, type=percussion?drumType(note.pitch):instrument(note.program).type;
    const key=`${note.trackIndex}:${note.port}:${note.channel}:${note.program}:${percussion?type:''}`;
    let channel=groups.get(key);
    if(!channel) {
      const track=tracks[note.trackIndex], label=percussion?type[0].toUpperCase()+type.slice(1):instrument(note.program).name;
      const name=track.name ? percussion?`${track.name} · ${label}`:track.name : label;
      channel={id:`midi-${channels.length+1}`,name,type,volume:note.volume,pan:note.pan,mute:false,solo:false,color:colours[channels.length%colours.length],midiProgram:note.program,midiPercussion:percussion,effects:{cutoff:20000,reverb:0,delay:0,drive:0}};
      channels.push(channel);groups.set(key,channel);notes[channel.id]=[];
    }
    const start=toBeat(note.start),end=toBeat(note.end);lastBeat=Math.max(lastBeat,end);
    notes[channel.id].push({id:`note-${notes[channel.id].length+1}`,pitch:note.pitch,start,duration:end-start,velocity:note.velocity});
  }
  const bars=Math.max(1,Math.ceil((lastBeat-1e-7)/4)),length=bars*4;
  const title=tracks.find(track=>track.name)?.name || 'Imported MIDI';
  return {title,bpm,midi:{division},master:.8,loop:true,selectedPattern:'midi-pattern',channels,patterns:[{id:'midi-pattern',name:title,bars,midiPpqn:division,steps:{},notes}],clips:[{id:'midi-clip',patternId:'midi-pattern',track:0,start:0,length}]};
}
