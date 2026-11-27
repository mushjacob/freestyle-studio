/** Disabelton Clip View — pure Live 12 note-editor rules (no DOM, no writes).
 * Every score change still goes through app.js's proven pattern edit/history path;
 * these helpers only compute the next notes ({id, pitch, start, duration, velocity}
 * with start/duration in quarter-note beats, velocity 0–1). Live labels MIDI 60 as C3.
 */
import {legatoNotes,transposeNotes,MIN_NOTE_DURATION} from './piano-tools.js';
import {scaleQuantizeNotes,LOGIC_SCALES} from './logic-piano.js';
import {humanizeNotes,LOGIC_TICKS_PER_BEAT} from './logic-midi-transform.js';

const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const LIVE_NOTE_NAMES=Object.freeze([...NAMES]);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const round=value=>Math.round(value*1e9)/1e9;
const clampPitch=pitch=>Math.max(0,Math.min(127,Math.round(pitch)));

/** Live note name, C3 = MIDI 60. */
export function liveNoteName(pitch){return Number.isInteger(pitch)&&pitch>=0&&pitch<=127?NAMES[pitch%12]+(Math.floor(pitch/12)-2):'';}
/** Parse "C3", "f#2", "Db-1" → MIDI, or null. */
export function parseLiveNoteName(text){
 const match=/^\s*([A-Ga-g])\s*([#b♯♭]?)\s*(-?\d+)\s*$/.exec(String(text||''));if(!match)return null;
 const base={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[match[1].toUpperCase()],accidental=match[2]==='#'||match[2]==='♯'?1:match[2]==='b'||match[2]==='♭'?-1:0;
 const pitch=(Number(match[3])+2)*12+base+accidental;return pitch>=0&&pitch<=127?pitch:null;
}

/** Live's position box: bars.beats.sixteenths, 1-based ("1.3.4"). */
export function livePosition(beats,{beatsPerBar=4}={}){
 const sixteenths=Math.max(0,Math.round((finite(beats)?beats:0)*4+1e-6)),perBar=beatsPerBar*4;
 return `${Math.floor(sixteenths/perBar)+1}.${Math.floor(sixteenths%perBar/4)+1}.${sixteenths%4+1}`;
}
/** Live's length box: bars.beats.sixteenths, 0-based ("8.0.0"). */
export function liveLength(beats,{beatsPerBar=4}={}){
 const sixteenths=Math.max(0,Math.round((finite(beats)?beats:0)*4+1e-6)),perBar=beatsPerBar*4;
 return `${Math.floor(sixteenths/perBar)}.${Math.floor(sixteenths%perBar/4)}.${sixteenths%4}`;
}
/** Parse a typed position ("3", "3.2", "3.2.4", 1-based) or length ("2", "2.1", 0-based) into beats. */
export function parseLiveBeats(text,{length=false,beatsPerBar=4}={}){
 const parts=String(text??'').trim().split(/[.\s:]+/).filter(Boolean).map(Number);
 if(!parts.length||parts.length>3||parts.some(value=>!Number.isFinite(value)||value<0))return null;
 const [bar,beat=length?0:1,sixteenth=length?0:1]=parts,offset=length?0:1;
 if(!length&&(bar<1||beat<1||sixteenth<1))return null;
 return round((bar-offset)*beatsPerBar+(beat-offset)+(sixteenth-offset)/4);
}

/** Live's fixed note-editor grid (⌘1 narrower, ⌘2 wider, ⌘3 triplet, ⌘4 snap).
 * Only values the inherited piano snap engine can express are offered: Live's
 * 1/2 and 1/4T need a snap mode Freestyle's piano code does not have yet. */
export const LIVE_GRIDS=Object.freeze([
 {id:'1/64',label:'1/64',beats:1/16,snap:'1/4-step',triplet:false},
 {id:'1/32',label:'1/32',beats:1/8,snap:'1/2-step',triplet:false},
 {id:'1/16',label:'1/16',beats:1/4,snap:'step',triplet:false},
 {id:'1/8',label:'1/8',beats:1/2,snap:'1/2-beat',triplet:false},
 {id:'1/4',label:'1/4',beats:1,snap:'beat',triplet:false},
 {id:'1 Bar',label:'1 Bar',beats:4,snap:'bar',triplet:false},
 {id:'1/64T',label:'1/64T',beats:1/24,snap:'1/6-step',triplet:true},
 {id:'1/32T',label:'1/32T',beats:1/12,snap:'1/3-step',triplet:true},
 {id:'1/16T',label:'1/16T',beats:1/6,snap:'1/6-beat',triplet:true},
 {id:'1/8T',label:'1/8T',beats:1/3,snap:'1/3-beat',triplet:true},
].map(Object.freeze));
export const liveGrid=id=>LIVE_GRIDS.find(grid=>grid.id===id)||LIVE_GRIDS.find(grid=>grid.id==='1/16');
/** ⌘1 (direction -1) / ⌘2 (+1) within the current straight or triplet family. */
export function stepLiveGrid(id,direction){
 const current=liveGrid(id),family=LIVE_GRIDS.filter(grid=>grid.triplet===current.triplet).sort((a,b)=>a.beats-b.beats),index=family.indexOf(current);
 return family[Math.max(0,Math.min(family.length-1,index+(direction<0?-1:1)))].id;
}
/** ⌘3: toggle triplet; the nearest grid of the other family. */
export function toggleLiveTriplet(id){
 const current=liveGrid(id),family=LIVE_GRIDS.filter(grid=>grid.triplet!==current.triplet),target=current.beats*(current.triplet?3/2:2/3);
 return family.reduce((best,grid)=>Math.abs(Math.log(grid.beats/target))<Math.abs(Math.log(best.beats/target))?grid:best).id;
}

/** Live 12 clip scales → the inherited scale table. */
export const LIVE_SCALES=Object.freeze([
 ['Major','Major (Ionian)'],['Minor','Natural Minor (Aeolian)'],['Dorian','Dorian'],['Mixolydian','Mixolydian'],['Lydian','Lydian'],['Phrygian','Phrygian'],['Locrian','Locrian'],
 ['Harmonic Minor','Harmonic Minor'],['Melodic Minor','Melodic Minor'],['Major Pentatonic','Major Pentatonic'],['Minor Pentatonic','Minor Pentatonic'],['Blues','Blues'],
].map(([label,key])=>Object.freeze({label,key})));
export function scalePitchClasses(root,scale){
 const rootIndex=NAMES.indexOf(root),steps=LOGIC_SCALES[LIVE_SCALES.find(item=>item.label===scale)?.key];
 return rootIndex<0||!steps?null:new Set(steps.map(step=>(step+rootIndex)%12));
}

const span=notes=>({start:Math.min(...notes.map(note=>note.start)),end:Math.max(...notes.map(note=>note.start+note.duration)),low:Math.min(...notes.map(note=>note.pitch)),high:Math.max(...notes.map(note=>note.pitch))});

/** Notes panel transforms. Each returns the transformed copies of `notes` (same ids). */
export const LIVE_NOTE_TRANSFORMS=Object.freeze({
 transpose:(notes,{semitones=0}={})=>transposeNotes(notes,semitones),
 /** Fit to Scale: every pitch moves to the nearest note of the clip scale. */
 fitToScale:(notes,{root,scale}={})=>scaleQuantizeNotes(notes,{root,scale:LIVE_SCALES.find(item=>item.label===scale)?.key}),
 /** Invert: the selection's highest and lowest notes swap; intervals mirror. */
 invert:notes=>{if(!notes.length)return[];const {low,high}=span(notes);return notes.map(note=>({...note,pitch:clampPitch(high+low-note.pitch)}));},
 /** ×2 / ÷2: positions and lengths stretch from the selection's first onset. */
 stretch:(notes,{factor=2}={})=>{if(!notes.length)return[];const {start}=span(notes);return notes.map(note=>({...note,start:round(Math.max(0,start+(note.start-start)*factor)),duration:round(Math.max(MIN_NOTE_DURATION,note.duration*factor))}));},
 /** Set Length: every note takes one length (Live: the grid value). */
 setLength:(notes,{beats=.25}={})=>notes.map(note=>({...note,duration:round(Math.max(MIN_NOTE_DURATION,beats))})),
 /** Reverse: note order mirrors inside the selection's time span; pitches and lengths stay. */
 reverse:notes=>{if(!notes.length)return[];const {start,end}=span(notes);return notes.map(note=>({...note,start:round(Math.max(0,start+end-(note.start+note.duration)))}));},
 /** Legato: each note lasts until the next onset (the last one to the clip end). */
 legato:(notes,{clipBeats}={})=>legatoNotes(notes,clipBeats),
 /** Humanize: random start offsets of ±amount % of the grid (Live 12 Notes ▸ Humanize). */
 humanize:(notes,{amount=10,gridBeats=.25,random=Math.random}={})=>humanizeNotes(notes,{position:Math.round(Math.max(0,Math.min(100,amount))/100*gridBeats*LOGIC_TICKS_PER_BEAT),velocity:0,length:0,random}),
 /** Nudge (←/→) and ⇧←/→ resize by one grid step. */
 nudge:(notes,{beats=.25}={})=>{if(!notes.length)return[];const shift=Math.max(beats,-span(notes).start);return notes.map(note=>({...note,start:round(note.start+shift)}));},
 resize:(notes,{beats=.25,minDuration=MIN_NOTE_DURATION}={})=>notes.map(note=>({...note,duration:round(Math.max(minDuration,note.duration+beats))})),
});
/** Join (⌘J): notes of the same pitch in the selection become one note from the first onset to the last end.
 * Returns {changed:[the surviving notes], removed:[ids]} or null when nothing can be joined. */
export function joinNotes(notes){
 const groups=new Map();for(const note of notes||[]){if(!groups.has(note.pitch))groups.set(note.pitch,[]);groups.get(note.pitch).push(note);}
 const changed=[],removed=[];
 for(const group of groups.values()){if(group.length<2)continue;group.sort((a,b)=>a.start-b.start);const first=group[0],end=Math.max(...group.map(note=>note.start+note.duration));
  changed.push({...first,duration:round(end-first.start),velocity:first.velocity});for(const note of group.slice(1))removed.push(note.id);}
 return changed.length?{changed,removed}:null;
}
/** ⌘↑ / ⌘↓: selection velocity ±10 (⇧: ±1), in MIDI steps of 1/127, clamped to 1…127. */
export function stepVelocity(notes,steps){return (notes||[]).map(note=>({...note,velocity:Math.max(1/127,Math.min(1,(Math.round((Number(note.velocity)||0)*127)+steps)/127))}));}
/** Add Interval: copies of the notes `semitones` away (new ids from `newId`); out-of-range copies are dropped. */
/** Velocity ▸ Randomize: each velocity moves by up to ±range MIDI steps (clamped to 1…127). */
export function randomizeVelocity(notes,range,random=Math.random){const span=Math.max(0,Math.min(127,Math.round(Number(range)||0)));return (notes||[]).map(note=>{const midi=Math.round((Number(note.velocity)||0)*127)+Math.round((random()*2-1)*span);return{...note,velocity:Math.max(1,Math.min(127,midi))/127};});}
/** Velocity ▸ Ramp: velocities run linearly from `from` to `to` (MIDI 1…127) across the notes in time order. */
export function rampVelocity(notes,from,to){
 const list=notes||[],clamp=value=>Math.max(1,Math.min(127,Math.round(Number(value)||1))),a=clamp(from),b=clamp(to),order=list.map((note,index)=>({index,start:note.start,pitch:note.pitch})).sort((x,y)=>x.start-y.start||x.pitch-y.pitch),rank=new Map(order.map((item,position)=>[item.index,position])),last=Math.max(1,list.length-1);
 return list.map((note,index)=>({...note,velocity:Math.round(a+(b-a)*(list.length>1?rank.get(index)/last:0))/127}));
}
/** Note stretch markers: dragging one marker to `value` (beats) stretches the notes between the markers; the other
 * marker stays. span = {start,end} of the selection before the drag. Returns the stretched notes, or null. */
export function stretchNotesToMarker(notes,span,kind,value,{minDuration=.0625}={}){
 if(!notes?.length||!span||!(span.end>span.start)||!finite(value))return null;
 const fixed=kind==='stretch-start'?span.end:span.start,oldSpan=span.end-span.start,newSpan=Math.abs(value-fixed);if(!(newSpan>minDuration))return null;
 const factor=newSpan/oldSpan,anchor=kind==='stretch-start'?Math.min(value,fixed):Math.min(fixed,value);
 return notes.map(note=>({...note,start:Math.max(0,round(anchor+(note.start-span.start)*factor)),duration:Math.max(minDuration,round(note.duration*factor))}));
}
/** Ruler markers → the Clip panel change they stand for (the same placement write as typing the field). */
export function rulerMarkerChange(kind,loop,delta){
 if(!loop||!finite(delta))return null;
 if(kind==='start')return{start:Math.max(0,loop.start+delta)};
 if(kind==='end')return{end:Math.max(0,loop.end+delta)};
 if(kind==='loop-end')return{loopLength:Math.max(.0625,loop.loopLength+delta)};
 if(kind==='loop-start'||kind==='brace')return{loopStart:Math.max(0,loop.loopStart+delta)};
 return null;
}
/** Zoom-adaptive editor grid: the finest straight grid whose lines are at least `minPx` apart at this zoom, shifted
 * by `density` (−2 Widest … +2 Narrowest). */
export function adaptiveLiveGridId(barWidth,density=0,{minPx=18}={}){
 const straight=LIVE_GRIDS.filter(grid=>!grid.triplet).slice().sort((a,b)=>a.beats-b.beats),perBeat=Math.max(0,Number(barWidth)||0)/4;
 let index=straight.findIndex(grid=>grid.beats*perBeat>=minPx);if(index<0)index=straight.length-1;
 return straight[Math.max(0,Math.min(straight.length-1,index-Math.round(Number(density)||0)))].id;
}
/** Miniature notes of a take inside its Arrangement clip: percentages of the clip box. */
export function miniNoteLayout(notes,total){
 const list=notes||[],span=Math.max(.25,Number(total)||0),pitches=list.map(note=>note.pitch),low=Math.min(...pitches,127)-1,high=Math.max(...pitches,0)+1,range=Math.max(4,high-low+1);
 return list.map(note=>({left:note.start/span*100,width:Math.max(.4,note.duration/span*100),top:(high-note.pitch)/range*100,height:Math.max(8,100/range)}));
}
/** A linear take grew its pattern to `beats`: the clip plays ONE pass of it (cycle = the pattern, repeat 1). */
export function linearTakePlacement(clip,beats,bpm){
 const length=Math.max(Number(clip?.length)||0,Number(beats)||0),ms=Math.round(length*60000/(Number(bpm)>0?Number(bpm):120));
 return{length,cloudRaw:clip?.cloudRaw&&typeof clip.cloudRaw==='object'?{...clip.cloudRaw,durationMs:ms,loopDurationMs:ms,repeatCount:1,windowMs:null,offsetMs:0,loopPhaseMs:0}:clip?.cloudRaw};
}
/** ⌘⇧A: the notes that were not selected become the selection. */
export function invertSelection(allIds,selectedIds){const selected=new Set(selectedIds||[]);return (allIds||[]).filter(id=>!selected.has(id));}
export function addIntervalNotes(notes,{semitones=12,newId}={}){
 if(typeof newId!=='function')throw new TypeError('Add Interval needs an id factory.');
 return notes.map(note=>({note,pitch:note.pitch+Math.round(semitones)})).filter(({pitch})=>pitch>=0&&pitch<=127).map(({note,pitch})=>{const copy={...note,id:newId(),pitch};delete copy.cloudRaw;delete copy._stepPiano;return copy;});
}
/** True when two note lists are identical in the fields a transform may change. */
export function sameNotes(a,b){return a.length===b.length&&a.every((note,index)=>['pitch','start','duration','velocity'].every(key=>Math.abs((note[key]??0)-(b[index][key]??0))<1e-9));}


/** Live steps computer-keyboard velocity in twenties with the 1 and 127 ends (C down, V up). */
export const LIVE_MIDI_KEYBOARD_VELOCITIES=Object.freeze([1,20,40,60,80,100,120,127]);

// ---- Clip panel loop fields for an Arrangement pattern placement (Live 12 Start / End / Loop / Position / Length) ----
// Freestyle placement timing (updatePatternPlacement; same model as playlist-trim.js / playlist-edits placementTiming):
//  durationMs = one pass of the pattern source; offsetMs = source offset; loopDurationMs = loop unit;
//  loopPhaseMs = start phase inside the loop unit; repeatCount = cycles; windowMs = audible window (right trim).
//  Untiled (windowMs null): the source loops whole (cycle = durationMs) and offsetMs only displaces the start.
//  Tiled (windowMs set): each tile plays [offset, offset+cycle), cycle = loopDurationMs < durationMs ? loopDurationMs : durationMs − offsetMs.
// Live view: Loop Position = start of the loop region, Loop Length = cycle, Start = where playback begins,
// End = loop end. A phase combined with a moved/shortened loop has no verified engine contract
// (pattern-preview.js patternLoopPhaseBeats), so Start only moves when the loop is the whole pattern.
const msNum=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
export const PLACEMENT_LOOP_REASONS=Object.freeze({
 phase:'Freestyle plays a start offset only inside a whole-pattern loop. Set Loop Position to 1.1.1 and Loop Length to the pattern length first.',
 phaseSet:'Set Start back to the loop start before moving or shortening the loop (Freestyle has no phase-with-moved-loop contract).',
 identity:'This clip has no saved Freestyle placement timing yet.',
});
export function placementLoop(clip,{bpm=120,patternBeats=4}={}){
 const raw=clip?.cloudRaw||{},msPerBeat=60000/(bpm>0?bpm:120),D=Math.max(1,msNum(raw.durationMs??raw.duration_ms,patternBeats*msPerBeat));
 const off=Math.max(0,msNum(raw.offsetMs??raw.offset_ms,0)),L=Math.max(1,msNum(raw.loopDurationMs??raw.loop_duration_ms,D)),phase=Math.max(0,msNum(raw.loopPhaseMs??raw.loop_phase_ms,0));
 const win=raw.windowMs??raw.window_ms,tiled=win!=null&&Number.isFinite(Number(win));
 const cycle=tiled?(L<D-.001?L:Math.max(50,D-off)):D,loopStart=tiled?off:0,start=tiled?off+phase:off+phase;
 const b=ms=>Math.round(ms/msPerBeat*1e6)/1e6,length=finite(clip?.length)?clip.length:b(cycle);
 const pass=b(loopStart+cycle-start);
 return{msPerBeat,durationMs:D,offsetMs:off,loopDurationMs:L,loopPhaseMs:phase,tiled,cycleMs:cycle,
  start:b(start),loopStart:b(loopStart),loopLength:b(cycle),end:b(loopStart+cycle),patternLength:b(D),length,looped:length>pass+1e-6,passLength:pass,
  startEditable:(tiled?off===0&&Math.abs(cycle-D)<1:true)&&!(!tiled&&off>0&&phase>0),loopEditable:phase===0||Math.abs(phase)<1};
}
/** Returns {start?, length, cloudRaw} for edit(); throws {code,message} when Freestyle cannot express the change.
 * change: {start} | {loopStart} | {loopLength} | {end} | {looped:boolean} | {extend:true} (beats). */
export function applyPlacementLoop(clip,change,{bpm=120,patternBeats=4}={}){
 const fail=(message,code='placement_loop_unavailable')=>{throw Object.assign(new Error(message),{code});};
 if(!clip?.patternId||!clip.cloudRaw)fail(PLACEMENT_LOOP_REASONS.identity,'placement_identity');
 const now=placementLoop(clip,{bpm,patternBeats}),k=now.msPerBeat,D=now.durationMs,raw=clip.cloudRaw,whole=ms=>Math.round(ms);
 const windowOf=(lengthBeats)=>Math.max(1,whole(lengthBeats*k));
 const tile=({off,cycle,phase,length})=>{
  off=whole(off);cycle=whole(cycle);phase=whole(phase);const win=windowOf(length);
  if(off<0||off>=D-1)fail('Loop Position must stay inside the pattern.');if(cycle<50)fail('Loop Length must be at least 50 ms.');if(off+cycle>D+1)fail('The loop cannot end after the pattern end; lengthen the pattern first.');
  const loopDurationMs=cycle<D-1?cycle:whole(D);const effective=loopDurationMs<D-.001?loopDurationMs:Math.max(50,D-off);
  const repeatCount=Math.max(1,Math.ceil((win+phase)/effective-1e-9));
  // Whole-pattern loop over whole passes: keep Freestyle's untiled form (windowMs null), as the right-edge drag does.
  const untiled=off===0&&phase===0&&loopDurationMs===whole(D)&&Math.abs(win/D-Math.round(win/D))<1e-6;
  const next={...raw,offsetMs:off,loopDurationMs,loopPhaseMs:phase,windowMs:untiled?null:win,repeatCount:untiled?Math.max(1,Math.round(win/D)):repeatCount};
  for(const[alias,key]of [['offset_ms','offsetMs'],['loop_duration_ms','loopDurationMs'],['loop_phase_ms','loopPhaseMs'],['window_ms','windowMs'],['repeat_count','repeatCount']])if(Object.hasOwn(raw,alias))next[alias]=next[key];
  return{length:Math.round(win/k*1e9)/1e9,cloudRaw:next};
 };
 const cur={off:now.loopStart*k,cycle:now.cycleMs,phase:now.loopPhaseMs,length:now.length};
 if('extend' in change){
  // Pro's clip menu Extend: total = 2 × the current length, cycle unchanged (repeats). The arrangement right-edge drag
  // writes the same timing (playlist-edits placementTiming), so this is that resize at twice the length.
  return tile({...cur,length:now.length*2});
 }
 if('looped' in change){
  if(change.looped===now.looped)return null;
  return tile({...cur,length:change.looped?now.passLength+now.loopLength:now.passLength});
 }
 if('start' in change){
  if(!now.startEditable)fail(PLACEMENT_LOOP_REASONS.phase,'placement_phase_unsupported');
  const s=whole(change.start*k);if(s<0||s>=D)fail('Start must lie inside the pattern.');
  // Live keeps the clip end when its start moves inside the loop; Freestyle keeps the window length.
  return tile({off:0,cycle:D,phase:s,length:now.length});
 }
 if(now.loopPhaseMs>=1)fail(PLACEMENT_LOOP_REASONS.phaseSet,'placement_phase_unsupported');
 if('loopStart' in change){const off=change.loopStart*k;return tile({off,cycle:Math.min(now.cycleMs,D-off),phase:0,length:now.length});}
 if('loopLength' in change){const cycle=change.loopLength*k;if(!(cycle>0))fail('Type a loop length such as 1.0.0.');return tile({off:cur.off,cycle,phase:0,length:now.length});}
 if('end' in change){const cycle=change.end*k-cur.off;if(!(cycle>0))fail('End must be after the loop position.');return tile({off:cur.off,cycle,phase:0,length:now.length});}
 return null;
}

// ---- MIDI recording (computer keyboard / MIDI input → notes at the playhead) ----
/** One take: notes captured between note-on / note-off at transport beats, wrapped into the pattern cycle
 * (a looping pattern clip) and optionally quantized to the grid. Returns notes {pitch,start,duration,velocity}. */
/** `linear` (Arrangement record into a new clip): notes keep their position after the clip start and are not folded into the pattern length. */
export function midiTakeNotes(events,{patternBeats=4,clipStart=0,grid=0,minDuration=.0625,linear=false}={}){
 const out=[];for(const event of events||[]){
  if(!finite(event.on)||!Number.isInteger(event.pitch)||event.pitch<0||event.pitch>127)continue;
  const off=finite(event.off)&&event.off>event.on?event.off:event.on+minDuration;
  let start=event.on-clipStart,duration=off-event.on;if(start<-1e-9)continue;
  if(grid>0){start=Math.round(start/grid)*grid;duration=Math.max(grid,Math.round(duration/grid)*grid);}
  if(linear)duration=Math.max(minDuration,duration);
  else{start=((start%patternBeats)+patternBeats)%patternBeats;if(patternBeats-start<1e-9)start=0;
  duration=Math.max(minDuration,Math.min(duration,patternBeats-start));}
  out.push({pitch:event.pitch,start:round(start),duration:round(duration),velocity:Math.max(.01,Math.min(1,finite(event.velocity)?event.velocity:.8))});
 }
 return out;
}
