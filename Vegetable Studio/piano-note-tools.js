/** Pure piano roll note tools (strum, flam, flip, articulate, limit, randomize, arpeggiate, scales). Beats are quarter notes. */
import {transformNotes,MIN_NOTE_DURATION} from './piano-tools.js';
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const startOf=note=>Math.max(0,finite(note.start,0));
const durationOf=note=>Math.max(MIN_NOTE_DURATION,finite(note.duration,.25));
const pitchOf=note=>clamp(Math.round(finite(note.pitch,60)),0,127);
const velocityOf=note=>clamp(finite(note.velocity,.8),0,1);
const freshId=()=>globalThis.crypto?.randomUUID?.()||`note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const mulberry32=seed=>{let state=(Number(seed)>>>0)||1;return()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};};
const cloneNotes=notes=>transformNotes(notes,note=>note);
const EPS=1e-6;
/** Group note indexes by shared start (within 1e-6), in time order. */
function chords(notes){
  const order=notes.map((note,index)=>index).sort((a,b)=>startOf(notes[a])-startOf(notes[b])||a-b),groups=[];
  for(const index of order){const last=groups[groups.length-1];if(last&&Math.abs(startOf(notes[index])-last.start)<=EPS)last.indexes.push(index);else groups.push({start:startOf(notes[index]),indexes:[index]});}
  return groups;
}

export const SCALES=Object.freeze({
  major:{label:'Major',intervals:[0,2,4,5,7,9,11]},
  minor:{label:'Minor',intervals:[0,2,3,5,7,8,10]},
  harmonic_minor:{label:'Harmonic minor',intervals:[0,2,3,5,7,8,11]},
  melodic_minor:{label:'Melodic minor',intervals:[0,2,3,5,7,9,11]},
  dorian:{label:'Dorian',intervals:[0,2,3,5,7,9,10]},
  phrygian:{label:'Phrygian',intervals:[0,1,3,5,7,8,10]},
  lydian:{label:'Lydian',intervals:[0,2,4,6,7,9,11]},
  mixolydian:{label:'Mixolydian',intervals:[0,2,4,5,7,9,10]},
  locrian:{label:'Locrian',intervals:[0,1,3,5,6,8,10]},
  major_pentatonic:{label:'Major pentatonic',intervals:[0,2,4,7,9]},
  minor_pentatonic:{label:'Minor pentatonic',intervals:[0,3,5,7,10]},
  blues:{label:'Blues',intervals:[0,3,5,6,7,10]},
  chromatic:{label:'Chromatic',intervals:[0,1,2,3,4,5,6,7,8,9,10,11]}
});
function scaleIntervals(scale){const def=typeof scale==='string'?SCALES[scale]:scale;const list=Array.isArray(def)?def:def?.intervals;return Array.isArray(list)&&list.length?list:SCALES.chromatic.intervals;}
export function scalePitchClasses({root=0,scale='major'}={}){const base=((Math.round(finite(root,0))%12)+12)%12;return[...new Set(scaleIntervals(scale).map(i=>(((base+Math.round(i))%12)+12)%12))].sort((a,b)=>a-b);}
export function inScale(pitch,{root=0,scale='major'}={}){return scalePitchClasses({root,scale}).includes((((Math.round(finite(pitch,60)))%12)+12)%12);}
/** Nearest in-scale pitch; ties round down. */
export function snapToScale(pitch,{root=0,scale='major'}={}){
  const p=clamp(Math.round(finite(pitch,60)),0,127),classes=new Set(scalePitchClasses({root,scale}));
  for(let d=0;d<=12;d++){if(p-d>=0&&classes.has((p-d)%12))return p-d;if(p+d<=127&&classes.has((p+d)%12))return p+d;}
  return p;
}

export function strumNotes(notes,{time=.0625,tension=0,direction='up'}={}){
  const out=cloneNotes(notes||[]),amount=Math.max(0,finite(time,.0625)),t=clamp(finite(tension,0),-1,1);
  const curve=x=>t===0?x:t>0?Math.pow(x,1+t*3):1-Math.pow(1-x,1-t*3);
  for(const group of chords(out)){
    const n=group.indexes.length;if(n<2)continue;
    const sorted=[...group.indexes].sort((a,b)=>pitchOf(out[a])-pitchOf(out[b])||a-b);
    if(direction==='down')sorted.reverse();
    sorted.forEach((index,k)=>{const note=out[index],offset=amount*curve(k/(n-1));note.start=startOf(note)+offset;note.duration=Math.max(MIN_NOTE_DURATION,durationOf(note)-offset);});
  }
  return out;
}

export function flamNotes(notes,{time=.03125,velocity=.6,count=1,selectedIds=null}={}){
  const out=cloneNotes(notes||[]),graces=[],gap=Math.max(MIN_NOTE_DURATION,finite(time,.03125)),total=Math.max(0,Math.floor(finite(count,1)));
  const selected=selectedIds==null?null:new Set(typeof selectedIds==='string'?[selectedIds]:selectedIds);
  for(const note of out){
    if(selected&&!selected.has(note.id))continue;
    for(let i=1;i<=total;i++){const at=startOf(note)-gap*i;if(at<-1e-9)continue;graces.push({...transformNotes([note],n=>n)[0],id:freshId(),start:Math.max(0,at),duration:gap,velocity:clamp(velocityOf(note)*finite(velocity,.6),0,1)});}
  }
  return[...out,...graces];
}

export function flipNotes(notes,{axis='horizontal',pivotPitch=null}={}){
  const list=notes||[];if(!list.length)return[];
  if(axis==='vertical'){
    const pitches=list.map(pitchOf),pivot=pivotPitch==null?(Math.min(...pitches)+Math.max(...pitches))/2:finite(pivotPitch,60);
    return transformNotes(list,note=>({...note,pitch:clamp(Math.round(2*pivot-pitchOf(note)),0,127)}));
  }
  const minStart=Math.min(...list.map(startOf)),maxEnd=Math.max(...list.map(n=>startOf(n)+durationOf(n)));
  return transformNotes(list,note=>({...note,start:Math.max(0,minStart+(maxEnd-(startOf(note)+durationOf(note)))),duration:durationOf(note)}));
}

export function articulateNotes(notes,{length=1,velocity=1,lengthCurve=0,velocityCurve=0}={}){
  const out=cloneNotes(notes||[]),order=out.map((n,i)=>i).sort((a,b)=>startOf(out[a])-startOf(out[b])||a-b),last=order.length-1;
  const weight=(curve,t)=>{const c=clamp(finite(curve,0),-1,1);return c>=0?(1-c)+c*t:(1+c)-c*(1-t);};
  order.forEach((index,rank)=>{
    const note=out[index],t=last>0?rank/last:1;
    const lf=1+(Math.max(0,finite(length,1))-1)*weight(lengthCurve,t),vf=1+(Math.max(0,finite(velocity,1))-1)*weight(velocityCurve,t);
    note.duration=Math.max(MIN_NOTE_DURATION,durationOf(note)*lf);note.velocity=clamp(velocityOf(note)*vf,0,1);
  });
  return out;
}

export function limitNotes(notes,{low=0,high=127,scale=null}={}){
  let lo=clamp(Math.round(finite(low,0)),0,127),hi=clamp(Math.round(finite(high,127)),0,127);if(lo>hi)[lo,hi]=[hi,lo];
  const classes=scale?new Set(scalePitchClasses(scale)):null;
  return transformNotes(notes||[],note=>{
    let p=pitchOf(note);
    if(hi-lo<12)p=clamp(p,lo,hi);else{while(p>hi)p-=12;while(p<lo)p+=12;}
    if(classes){
      let best=null;
      for(let d=0;d<=12&&best==null;d++){if(p-d>=lo&&classes.has((p-d)%12))best=p-d;else if(p+d<=hi&&classes.has((p+d)%12))best=p+d;}
      if(best!=null)p=best;
    }
    return{...note,pitch:p};
  });
}

export function randomizeNotes({start=0,length=4,step=.25,density=.5,low=48,high=72,scale=null,velocityMin=.5,velocityMax=1,durationSteps=[1],seed=1}={}){
  const random=mulberry32(seed),stepSize=Math.max(MIN_NOTE_DURATION,finite(step,.25)),steps=Math.floor(Math.max(0,finite(length,4))/stepSize+1e-9);
  let lo=clamp(Math.round(finite(low,48)),0,127),hi=clamp(Math.round(finite(high,72)),0,127);if(lo>hi)[lo,hi]=[hi,lo];
  const classes=scale?new Set(scalePitchClasses(scale)):null,pool=[];for(let p=lo;p<=hi;p++)if(!classes||classes.has(p%12))pool.push(p);
  if(!pool.length)return[];
  let vMin=clamp(finite(velocityMin,.5),0,1),vMax=clamp(finite(velocityMax,1),0,1);if(vMin>vMax)[vMin,vMax]=[vMax,vMin];
  const lengths=(Array.isArray(durationSteps)&&durationSteps.length?durationSteps:[1]).map(v=>Math.max(1e-6,finite(v,1))),prob=clamp(finite(density,.5),0,1),origin=Math.max(0,finite(start,0)),notes=[];
  for(let i=0;i<steps;i++){
    if(random()>=prob)continue;
    const pitch=pool[Math.min(pool.length-1,Math.floor(random()*pool.length))],velocity=vMin+(vMax-vMin)*random(),span=lengths[Math.min(lengths.length-1,Math.floor(random()*lengths.length))];
    notes.push({id:freshId(),start:origin+i*stepSize,duration:Math.max(MIN_NOTE_DURATION,span*stepSize),pitch,velocity:clamp(velocity,0,1)});
  }
  return notes;
}

export function arpeggiateNotes(notes,{step=.25,gate=.9,pattern='up',octaves=1,seed=1}={}){
  const out=cloneNotes(notes||[]),stepSize=Math.max(MIN_NOTE_DURATION,finite(step,.25)),length=Math.max(MIN_NOTE_DURATION,stepSize*Math.max(0,finite(gate,.9))),octaveCount=Math.max(1,Math.floor(finite(octaves,1))),random=mulberry32(seed),result=[];
  for(const group of chords(out)){
    if(group.indexes.length<2){for(const i of group.indexes)result.push(out[i]);continue;}
    const members=[...group.indexes].sort((a,b)=>pitchOf(out[a])-pitchOf(out[b])||a-b).map(i=>out[i]),pitches=[];
    for(let o=0;o<octaveCount;o++)for(const note of members){const p=pitchOf(note)+12*o;if(p<=127)pitches.push({pitch:p,note});}
    const end=Math.max(...members.map(n=>startOf(n)+durationOf(n))),count=Math.max(1,Math.ceil((end-group.start)/stepSize-1e-9));
    let sequence;
    if(pattern==='down')sequence=[...pitches].reverse();
    else if(pattern==='updown')sequence=pitches.length>2?[...pitches,...pitches.slice(1,-1).reverse()]:[...pitches];
    else sequence=pitches;
    for(let i=0;i<count;i++){
      const entry=pattern==='random'?pitches[Math.min(pitches.length-1,Math.floor(random()*pitches.length))]:sequence[i%sequence.length];
      const at=group.start+i*stepSize;if(at>=end-1e-9)break;
      result.push({...transformNotes([entry.note],n=>n)[0],id:freshId(),start:at,duration:length,pitch:entry.pitch});
    }
  }
  return result;
}

const withId=(note,id)=>{note.id=id;if(note.cloudRaw&&typeof note.cloudRaw==='object'&&!Array.isArray(note.cloudRaw))note.cloudRaw={...note.cloudRaw,id};return note;};
/** FL Chop: each note is cut into `step`-long cells counted from its own onset; `x` cells sound, any other character is a rest.
 * The pattern repeats along the note. The first sounding fragment keeps the note's id. A note that would end up with no
 * fragment, or a pattern with no `x`, leaves the notes unchanged. `selectedIds` limits the notes chopped. */
export function chopNotesByPattern(notes,{step=.25,pattern='x',selectedIds=null}={}){
  const cells=[...String(pattern??'x').toLowerCase().replace(/\s+/g,'')],size=Math.max(MIN_NOTE_DURATION,finite(step,.25)),selected=selectedIds==null?null:new Set(typeof selectedIds==='string'?[selectedIds]:selectedIds);
  if(!cells.includes('x'))return cloneNotes(notes||[]);
  const result=[];let fragments=0;
  for(const note of cloneNotes(notes||[])){
    if(selected&&!selected.has(note.id)){result.push(note);continue;}
    const onset=startOf(note),length=durationOf(note),count=Math.max(1,Math.ceil((length-MIN_NOTE_DURATION+EPS)/size)),made=[];
    for(let i=0;i<count;i++){
      if(cells[i%cells.length]!=='x')continue;
      const at=i*size,span=Math.min(size,length-at);if(span<MIN_NOTE_DURATION-EPS)continue;
      made.push({...transformNotes([note],n=>n)[0],start:onset+at,duration:Math.max(MIN_NOTE_DURATION,span)});
    }
    if(!made.length){result.push(note);continue;}
    if(fragments+made.length>50000)throw new RangeError('Chop would create more than 50,000 note fragments. Choose a longer time or a smaller selection.');
    fragments+=made.length;made.forEach((fragment,index)=>result.push(index?withId(fragment,freshId()):fragment));
  }
  return result;
}

/** FL velocity LFO across the notes' time span (earliest start to latest end). `cycles` waves fit the span,
 * `amount` (0–1) is the swing and `center` (0–1) the middle velocity; the wave is sampled at each note's start. */
export const LFO_SHAPES=Object.freeze(['sine','triangle','saw','square']);
export function velocityLfo(notes,{shape='sine',cycles=1,amount=.5,center=.5}={}){
  const list=notes||[];if(!list.length)return[];
  const first=Math.min(...list.map(startOf)),span=Math.max(...list.map(n=>startOf(n)+durationOf(n)))-first,count=Math.max(0,finite(cycles,1)),swing=clamp(finite(amount,.5),0,1),mid=clamp(finite(center,.5),0,1);
  const wave={sine:x=>Math.sin(2*Math.PI*x),triangle:x=>{const f=x-Math.floor(x);return f<.25?4*f:f<.75?2-4*f:4*f-4;},saw:x=>{const f=x-Math.floor(x);return f<.5?2*f:2*f-2;},square:x=>x-Math.floor(x)<.5?1:-1}[shape]||(x=>Math.sin(2*Math.PI*x));
  return transformNotes(list,note=>({...note,velocity:clamp(mid+swing*wave(span>0?(startOf(note)-first)/span*count:0),0,1)}));
}

export const CHORD_TYPES=Object.freeze({major:{label:'Major',intervals:[0,4,7]},minor:{label:'Minor',intervals:[0,3,7]},'7':{label:'Dominant 7',intervals:[0,4,7,10]},maj7:{label:'Major 7',intervals:[0,4,7,11]},m7:{label:'Minor 7',intervals:[0,3,7,10]},sus2:{label:'Sus2',intervals:[0,2,7]},sus4:{label:'Sus4',intervals:[0,5,7]},dim:{label:'Diminished',intervals:[0,3,6]},aug:{label:'Augmented',intervals:[0,4,8]},add9:{label:'Add9',intervals:[0,4,7,14]}});
/** MIDI pitches (ascending, 0–127 only) of a chord on `root`. Each inversion moves the lowest note up an octave. */
export function chordPitches(root,{type='major',inversion=0}={}){
  const def=CHORD_TYPES[type];if(!def)throw new RangeError(`Unknown chord type: ${type}`);
  const base=clamp(Math.round(finite(root,60)),0,127);let pitches=def.intervals.map(i=>base+i);
  for(let k=Math.max(0,Math.min(8,Math.floor(finite(inversion,0))));k>0;k--){const [low,...rest]=pitches;pitches=[...rest,low+12];}
  return pitches.filter(p=>p>=0&&p<=127);
}
/** Turn each note into a chord rooted on its pitch: the note keeps its id and the other chord tones are new notes. */
export function chordNotes(notes,{type='major',inversion=0,selectedIds=null}={}){
  const selected=selectedIds==null?null:new Set(typeof selectedIds==='string'?[selectedIds]:selectedIds),result=[];
  for(const note of cloneNotes(notes||[])){
    if(selected&&!selected.has(note.id)){result.push(note);continue;}
    const tones=chordPitches(pitchOf(note),{type,inversion});
    if(!tones.length){result.push(note);continue;}
    tones.forEach((p,index)=>result.push(index?withId({...transformNotes([note],n=>n)[0],pitch:p},freshId()):{...note,pitch:p}));
  }
  return result;
}
/** Diatonic triads from a degree string such as `1-5-6-4` (separators `-`, `,` or space; degrees above the scale size wrap an octave up).
 * `length` is the total beats the progression fills, split equally; `octave` places the root (MIDI note 12*(octave+1)+root). */
export function chordProgression({root=0,scale='major',degrees='1-5-6-4',length=4,start=0,octave=3,velocity=.8}={}){
  const steps=scaleIntervals(scale),n=steps.length,degs=String(degrees??'').split(/[\s,\-]+/).map(Number).filter(d=>Number.isInteger(d)&&d>=1);
  if(!degs.length)return[];
  const base=12*(Math.round(finite(octave,3))+1)+((Math.round(finite(root,0))%12)+12)%12,each=Math.max(0,finite(length,4))/degs.length,origin=Math.max(0,finite(start,0)),notes=[];
  const degreePitch=index=>base+steps[((index%n)+n)%n]+12*Math.floor(index/n);
  degs.forEach((degree,slot)=>{for(const offset of [0,2,4]){const p=degreePitch(degree-1+offset);if(p>=0&&p<=127)notes.push({id:freshId(),start:origin+slot*each,duration:Math.max(MIN_NOTE_DURATION,each),pitch:p,velocity:clamp(finite(velocity,.8),0,1)});}});
  return notes;
}
