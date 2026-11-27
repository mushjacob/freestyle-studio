/** Pure musical-note editing. Positions and durations are quarter-note beats. */
export const MIN_NOTE_DURATION=1/96;
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function clone(value){if(value==null||typeof value!=='object')return value;if(Array.isArray(value))return value.map(clone);return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)]));}
const start=note=>Math.max(0,finite(note.start,0));
const duration=note=>Math.max(MIN_NOTE_DURATION,finite(note.duration,.25));
const pitch=note=>clamp(Math.round(finite(note.pitch,60)),0,127);
const idSet=ids=>ids==null?null:new Set(typeof ids==='string'?[ids]:ids);
const isSelected=(note,ids)=>!ids||ids.has(note.id);
const freshId=()=>globalThis.crypto?.randomUUID?.()||`note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Clone note data, including unknown cloud metadata, before applying a transform. */
export function transformNotes(notes,transform,{selectedIds=null}={}) {
  if(typeof transform!=='function')throw new TypeError('A note transform function is required.');
  const selected=idSet(selectedIds);
  return (notes||[]).map((note,index)=>{const copied=clone(note);return isSelected(note,selected)?transform(copied,index):copied;});
}
export function selectNotes(notes,selectedIds=null){const selected=idSet(selectedIds);return(notes||[]).filter(note=>isSelected(note,selected)).map(clone);}

/** Strength blends toward the grid. End quantization is independent of onset movement. */
export function quantizeNotes(notes,{grid=.25,strength=1,quantizeEnds=false}={}) {
  const spacing=Number(grid);if(!Number.isFinite(spacing)||spacing<=0)throw new RangeError('Quantize grid must be a positive finite beat duration.');
  const amount=clamp(finite(strength,1),0,1),snap=value=>Math.round(value/spacing)*spacing;
  return transformNotes(notes,note=>{
    const oldStart=start(note),oldDuration=duration(note),oldEnd=oldStart+oldDuration;
    note.start=Math.max(0,oldStart+(snap(oldStart)-oldStart)*amount);
    const end=oldEnd+(snap(oldEnd)-oldEnd)*amount;
    note.duration=quantizeEnds?Math.max(MIN_NOTE_DURATION,end-note.start):oldDuration;
    return note;
  });
}
export function transposeNotes(notes,semitones=0) {
  const amount=Math.round(finite(semitones,0));
  return transformNotes(notes,note=>({...note,pitch:clamp(pitch(note)+amount,0,127)}));
}
export function scaleNoteVelocities(notes,factor=1) {
  const amount=Math.max(0,finite(factor,1));
  return transformNotes(notes,note=>({...note,velocity:clamp(finite(note.velocity,.8)*amount,0,1)}));
}

/** Each chord extends to the next distinct onset; the last chord extends to the pattern edge. */
export function legatoNotes(notes,patternLength) {
  const onsets=[...new Set((notes||[]).map(start))].sort((a,b)=>a-b);
  const fallback=Math.max(MIN_NOTE_DURATION,...(notes||[]).map(note=>start(note)+duration(note)));
  const end=Math.max(0,finite(patternLength,fallback));
  return transformNotes(notes,note=>{
    const onset=start(note),next=onsets.find(time=>time>onset+1e-9);
    const boundary=next==null?end:Math.min(next,end);
    return {...note,start:onset,duration:Math.max(MIN_NOTE_DURATION,boundary-onset)};
  });
}

/** Clamp one shared movement delta so a chord keeps its timing and pitch intervals. */
export function moveNotes(notes,{deltaStart=0,deltaPitch=0}={}) {
  if(!notes?.length)return[];
  const earliest=Math.min(...notes.map(start)),lowest=Math.min(...notes.map(pitch)),highest=Math.max(...notes.map(pitch));
  const timeDelta=Math.max(-earliest,finite(deltaStart,0));
  const pitchDelta=clamp(Math.round(finite(deltaPitch,0)),-lowest,127-highest);
  return transformNotes(notes,note=>({...note,start:start(note)+timeDelta,pitch:pitch(note)+pitchDelta,duration:duration(note)}));
}
/** Apply a shared duration change, stopping when the shortest note reaches its minimum. */
export function resizeNotes(notes,deltaDuration,minDuration=MIN_NOTE_DURATION) {
  if(!notes?.length)return[];
  const minimum=Math.max(MIN_NOTE_DURATION,finite(minDuration,MIN_NOTE_DURATION));
  const shortest=Math.min(...notes.map(duration)),delta=Math.max(minimum-shortest,finite(deltaDuration,0));
  return transformNotes(notes,note=>({...note,duration:duration(note)+delta}));
}
/** Move a group while keeping its internal offsets intact when it reaches beat zero. */
export function shiftNotes(notes,offset=0) {return moveNotes(notes,{deltaStart:offset});}

function allocator(notes,{ids,idFactory,existingNotes=[]}={}) {
  const factory=idFactory||(typeof ids==='function'?ids:freshId);
  const reserved=new Set([...(notes||[]).map(note=>note.id),...(existingNotes||[]).map(note=>note.id)]);
  for(const note of [...(notes||[]),...(existingNotes||[])])if(note.cloudRaw?.id)reserved.add(note.cloudRaw.id);
  if(ids&&typeof ids!=='function')for(const id of typeof ids==='string'?[ids]:ids)reserved.add(id);
  return()=>{
    for(let attempt=0;attempt<64;attempt++){const candidate=String(factory()??'');if(candidate&&!reserved.has(candidate)){reserved.add(candidate);return candidate;}}
    let candidate;do{candidate=freshId();}while(reserved.has(candidate));reserved.add(candidate);return candidate;
  };
}
function replaceId(note,id) {
  note.id=id;
  // The cloud serializer prefers its event id; copied notes must not reuse an existing event.
  if(note.cloudRaw&&typeof note.cloudRaw==='object'&&!Array.isArray(note.cloudRaw))note.cloudRaw={...note.cloudRaw,id};
  return note;
}

/** Return duplicates only. `ids` reserves existing ids, or aliases an injected id factory. */
export function duplicateNotes(notes,{offset,ids,idFactory,existingNotes=[]}={}) {
  if(!notes?.length)return[];
  const span=Math.max(MIN_NOTE_DURATION,...notes.map(note=>start(note)+duration(note)))-Math.min(...notes.map(start));
  const allocate=allocator(notes,{ids,idFactory,existingNotes});
  return shiftNotes(notes,offset==null?span:offset).map(note=>replaceId(note,allocate()));
}

/** Clipboard note starts are relative to the earliest selected note; pitch remains absolute. */
export function copySelectedNotes(notes,selectedIds=null) {
  const selected=selectNotes(notes,selectedIds);
  const originBeat=selected.length?Math.min(...selected.map(start)):0;
  const basePitch=selected.length?Math.min(...selected.map(pitch)):60;
  const spanBeats=selected.length?Math.max(...selected.map(note=>start(note)+duration(note)))-originBeat:0;
  return {type:'vegetable-notes',version:1,originBeat,basePitch,spanBeats,notes:selected.map(note=>({...note,start:start(note)-originBeat,duration:duration(note)}))};
}
export const copyNotes=copySelectedNotes;

/** Paste a relative clipboard at `at`, optionally transposing or remapping channel/source ids. */
export function pasteNotes(clipboard,{at=0,transpose=0,pitch:targetPitch,ids,idFactory,existingNotes=[],channelMap={}}={}) {
  if(clipboard?.type!=='vegetable-notes'||clipboard.version!==1||!Array.isArray(clipboard.notes))throw new TypeError('This clipboard does not contain Modesty notes.');
  const origin=Math.max(0,finite(at,0));
  const amount=targetPitch==null?finite(transpose,0):Math.round(finite(targetPitch,60))-finite(clipboard.basePitch,60)+finite(transpose,0);
  const allocate=allocator(clipboard.notes,{ids,idFactory,existingNotes});
  return transposeNotes(clipboard.notes,amount).map(note=>{
    note.start=origin+start(note);note.duration=duration(note);
    if(note.channelId!=null&&Object.hasOwn(channelMap,note.channelId))note.channelId=channelMap[note.channelId];
    if(note.sourceId!=null&&Object.hasOwn(channelMap,note.sourceId))note.sourceId=channelMap[note.sourceId];
    if(note.cloudRaw?.sourceId!=null&&Object.hasOwn(channelMap,note.cloudRaw.sourceId))note.cloudRaw.sourceId=channelMap[note.cloudRaw.sourceId];
    return replaceId(note,allocate());
  });
}
