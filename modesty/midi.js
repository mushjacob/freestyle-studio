
const value = (n,fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;
function compileProjectEvents(project, mode = 'song') {
  const patterns = project.patterns || [];
  const selected = patterns.find(p => p.id === project.selectedPattern) || patterns[0];
  const clips = mode === 'pattern'
    ? selected ? [{ patternId: selected.id, start: 0, length: (selected.bars || 1) * 4 }] : []
    : project.clips || [];
  const mutedTracks = new Set(project.mutedTracks || []);
  const events = [];
  let length = mode === 'pattern' ? (selected?.bars || 1) * 4 : 4;
  for (const clip of clips) {
    const pattern = patterns.find(p => p.id === clip.patternId);
    if (!pattern) continue;
    const start = Math.max(0, value(clip.start, 0));
    const patternLength = Math.max(1, value(pattern.bars, 1)) * 4;
    const clipLength = Math.max(.25, value(clip.length, patternLength));
    const offset = Math.max(0, value(clip.offset, 0));
    length = Math.max(length, start + clipLength);
    if (mode === 'song' && (clip.mute || mutedTracks.has(clip.track))) continue;
    const add = (event, position, duration, carry = true) => {
      if (position >= patternLength) return;
      // Include a note that began before a sliced clip and continues across its left edge.
      const earliest = carry ? Math.max(0, Math.floor((offset - position - duration) / patternLength) + 1) : Math.max(0, Math.floor(offset / patternLength));
      for (let cycle = earliest; cycle * patternLength + position < offset + clipLength; cycle++) {
        const noteStart = cycle * patternLength + position;
        if (noteStart < offset && (!carry || noteStart + duration <= offset)) continue;
        const localBeat = Math.max(0, noteStart - offset);
        const sourceOffset = Math.max(0, offset - noteStart);
        events.push({...event,beat:start + localBeat,duration:Math.max(.001,Math.min(duration-sourceOffset,clipLength-localBeat)),sourceOffset,clipRemaining:clipLength-localBeat,track:clip.track});
      }
    };
    for (const [channelId, steps] of Object.entries(pattern.steps || {})) {
      steps.forEach((active, step) => {
        if (active) add({channelId,pitch:60,velocity:typeof active === 'number' ? active : .85},step/4,.25,false);
      });
    }
    for (const [channelId, notes] of Object.entries(pattern.notes || {})) {
      for (const note of notes) add({channelId,pitch:clamp(value(note.pitch,60),0,127),velocity:clamp(value(note.velocity,.8),0,1)},Math.max(0,value(note.start,0)),Math.max(.001,value(note.duration,.5)));
    }
  }
  events.sort((a,b) => a.beat-b.beat);
  return {events,length};
}

const PPQN = 480;
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
  value = Math.max(0, Math.min(0x0fffffff, Math.round(value)));
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

/** Write a standard format-1 MIDI file, using 480 ticks per quarter note. */
export function encodeMidi(project, mode = 'song') {
  const {events,length} = compileProjectEvents(project, mode);
  const bpm = clamp(project.bpm || 128, 20, 999);
  const microseconds = Math.round(60000000 / bpm);
  const conductor = trackChunk([
    {tick:0,order:-3,data:meta(3,textEncoder.encode(project.title || 'Modesty'))},
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
    const port = Math.floor(index/15);
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
      const duration = Math.max(1,Math.round(event.duration*PPQN));
      if ((event.velocity ?? .8) <= 0) continue;
      const velocity = Math.max(1,Math.round(clamp(event.velocity ?? .8,0,1)*127));
      data.push({tick,order:1,data:[0x90|midiChannel,pitch,velocity]}, {tick:tick+duration,order:0,data:[0x80|midiChannel,pitch,0]});
    }
    chunks.push(trackChunk(data,Math.round(length*PPQN)));
  }
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
  const bpm=clamp(Math.round(60000000/initialUs*1000)/1000,20,999);
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
    notes[channel.id].push({id:`note-${notes[channel.id].length+1}`,pitch:note.pitch,start,duration:Math.max(1/PPQN,end-start),velocity:note.velocity});
  }
  const bars=Math.max(1,Math.ceil((lastBeat-1e-7)/4)),length=bars*4;
  const title=tracks.find(track=>track.name)?.name || 'Imported MIDI';
  return {title,bpm,master:.8,loop:true,selectedPattern:'midi-pattern',channels,patterns:[{id:'midi-pattern',name:title,bars,steps:{},notes}],clips:[{id:'midi-clip',patternId:'midi-pattern',track:0,start:0,length}]};
}
