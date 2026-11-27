/** Pure musical-note editing. Positions and durations are quarter-note beats. */
export const MIN_NOTE_DURATION=1/96;
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function clone(value){if(value==null||typeof value!=='object')return value;if(Array.isArray(value))return value.map(clone);return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)]));}
const start=note=>Math.max(0,finite(note.start,0));
const authoredDuration=note=>{const value=Number(note.duration);return Number.isFinite(value)&&value>0?value:MIN_NOTE_DURATION;};
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
    const oldStart=start(note),oldDuration=quantizeEnds?duration(note):authoredDuration(note),oldEnd=oldStart+oldDuration;
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
  return transformNotes(notes,note=>({...note,start:start(note)+timeDelta,pitch:pitch(note)+pitchDelta,duration:authoredDuration(note)}));
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
  const reserved=new Set([...(notes||[]).map(note=>note.id),...(existingNotes||[]).map(note=>note.id)].filter(value=>value!=null).map(String));
  for(const note of [...(notes||[]),...(existingNotes||[])])if(note.cloudRaw?.id!=null)reserved.add(String(note.cloudRaw.id));
  if(ids&&typeof ids!=='function')for(const id of typeof ids==='string'?[ids]:ids)reserved.add(String(id));
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
  const spanBeats=selected.length?Math.max(...selected.map(note=>start(note)+authoredDuration(note)))-originBeat:0;
  return {type:'vegetable-notes',version:1,originBeat,basePitch,spanBeats,notes:selected.map(note=>({...note,start:start(note)-originBeat,duration:authoredDuration(note)}))};
}
export const copyNotes=copySelectedNotes;

/** Paste a relative clipboard at `at`, optionally transposing or remapping channel/source ids. */
export function pasteNotes(clipboard,{at=0,transpose=0,pitch:targetPitch,ids,idFactory,existingNotes=[],channelMap={}}={}) {
  if(clipboard?.type!=='vegetable-notes'||clipboard.version!==1||!Array.isArray(clipboard.notes))throw new TypeError('This clipboard does not contain Vegetable Studio notes.');
  const origin=Math.max(0,finite(at,0));
  const amount=targetPitch==null?finite(transpose,0):Math.round(finite(targetPitch,60))-finite(clipboard.basePitch,60)+finite(transpose,0);
  const allocate=allocator(clipboard.notes,{ids,idFactory,existingNotes});
  return transposeNotes(clipboard.notes,amount).map(note=>{
    note.start=origin+start(note);note.duration=authoredDuration(note);
    if(note.channelId!=null&&Object.hasOwn(channelMap,note.channelId))note.channelId=channelMap[note.channelId];
    if(note.sourceId!=null&&Object.hasOwn(channelMap,note.sourceId))note.sourceId=channelMap[note.sourceId];
    if(note.cloudRaw?.sourceId!=null&&Object.hasOwn(channelMap,note.cloudRaw.sourceId))note.cloudRaw.sourceId=channelMap[note.cloudRaw.sourceId];
    return replaceId(note,allocate());
  });
}

const knownNumber=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const geometryKeys=new Set(['id','start','duration']);
// serializeCloudPattern writes these native fields from normalized note data.
const nativeGeometryKeys=new Set(['id','tick','startTick','start_tick','durationTick','duration_tick','note','pitch','velocity']);
function assertNoteGeometry(note){
  if(!note||note.id==null||String(note.id)===''||!knownNumber(note.start)||Number(note.start)<0||!knownNumber(note.duration)||Number(note.duration)<=0||!knownNumber(note.pitch)||!Number.isInteger(Number(note.pitch))||Number(note.pitch)<0||Number(note.pitch)>127)throw new TypeError('Note slicing, chopping and gluing require complete note identities, positions, durations and MIDI pitches.');
}
function assertStaticNoteData(note){
  const populated=value=>Array.isArray(value)?value.length>0:value&&typeof value==='object'?Object.keys(value).length>0:false;
  const visit=value=>{
    if(!value||typeof value!=='object')return false;
    return Object.entries(value).some(([key,child])=>{
      if(populated(child)&&/expression|envelope|automation|pitch.?bend|controllers|modulation|^mpe$|^cc$|^points$/i.test(key))return true;
      if(Array.isArray(child)&&child.some(point=>point&&typeof point==='object'&&Object.keys(point).some(name=>/^(?:time(?:sec|ms)?|tick|offset|position)$/i.test(name))))return true;
      return visit(child);
    });
  };
  if(visit(note))throw Object.assign(new Error('This note contains per-note controller or expression data. Its time mapping must be supported before slicing, chopping or gluing it.'),{code:'note_expression_mapping_required'});
}
function minimumDuration(value){
  if(!knownNumber(value)||Number(value)<=0)throw new RangeError('The minimum note duration must be positive and finite.');
  return Number(value);
}
function insideCut(note,beat,minimum){
  const left=beat-Number(note.start),right=Number(note.start)+Number(note.duration)-beat;
  return left>=minimum-1e-10&&right>=minimum-1e-10;
}

/** Split crossing notes at an absolute beat. Left keeps its ID; only new right
 * fragments receive identities. Notes outside the cut or selection are untouched.
 */
export function sliceNotes(notes,beat,{selectedIds=null,minDuration=MIN_NOTE_DURATION,ids,idFactory,existingNotes=[]}={}){
  if(!knownNumber(beat)||Number(beat)<0)throw new RangeError('The slice position must be a non-negative finite beat.');
  const cut=Number(beat),minimum=minimumDuration(minDuration),selected=idSet(selectedIds),allocate=allocator(notes,{ids,idFactory,existingNotes});
  const result=[];let changed=false;
  for(const note of notes||[]){
    if(!isSelected(note,selected)){result.push(note);continue;}assertNoteGeometry(note);
    if(!insideCut(note,cut,minimum)){result.push(note);continue;}assertStaticNoteData(note);
    const left=clone(note),right=replaceId(clone(note),allocate());left.duration=cut-Number(note.start);right.start=cut;right.duration=Number(note.start)+Number(note.duration)-cut;
    result.push(left,right);changed=true;
  }
  return changed?result:notes||[];
}

/** Quick Chop uses snap-length fragments measured from each authored onset.
 * Off-grid starts stay off-grid. Tiny final remainders join the previous fragment.
 * Image-Line documents snap-based chopping; off-grid native parity remains to verify.
 */
export function chopNotes(notes,{grid=.25,selectedIds=null,minDuration=MIN_NOTE_DURATION,ids,idFactory,existingNotes=[]}={}){
  const minimum=minimumDuration(minDuration);
  if(!knownNumber(grid)||Number(grid)<minimum)throw new RangeError('Quick Chop needs a finite snap at least as long as the minimum note duration.');
  const spacing=Number(grid),selected=idSet(selectedIds),allocate=allocator(notes,{ids,idFactory,existingNotes}),result=[];let changed=false,fragments=0;
  for(const note of notes||[]){
    if(!isSelected(note,selected)){result.push(note);continue;}assertNoteGeometry(note);
    const length=Number(note.duration),count=Math.max(1,Math.floor((length-minimum+1e-10)/spacing)+1);
    if(count===1){result.push(note);continue;}
    if(fragments+count>50000)throw new RangeError('Quick Chop would create more than 50,000 note fragments. Choose a larger snap or a smaller selection.');
    assertStaticNoteData(note);fragments+=count;changed=true;
    for(let index=0;index<count;index++){
      const fragment=clone(note);if(index)replaceId(fragment,allocate());fragment.start=Number(note.start)+index*spacing;fragment.duration=index===count-1?length-index*spacing:spacing;result.push(fragment);
    }
  }
  return changed?result:notes||[];
}
export const quickChopNotes=chopNotes;

/** Identity/time are the only fields Glue can discard. Parameter precedence for
 * differing velocities/expression is not established by the native manual.
 */
function glueSignature(note){
  const stable=(value,keys)=>{
    if(Array.isArray(value))return value.map(item=>stable(item));
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).filter(key=>!keys?.has(key)).sort().map(key=>[key,stable(value[key],key==='cloudRaw'?nativeGeometryKeys:undefined)]));
    return value;
  };
  return JSON.stringify(stable(note,geometryKeys));
}
export function glueNotes(notes,{selectedIds=null,tolerance=1e-9}={}){
  if(!knownNumber(tolerance)||Number(tolerance)<0||Number(tolerance)>1e-6)throw new RangeError('Glue tolerance must be between zero and one millionth of a beat.');
  const selected=idSet(selectedIds),groups=new Map(),replacements=new Map(),removed=new Set();
  for(const [index,note]of (notes||[]).entries()){
    if(!isSelected(note,selected))continue;assertNoteGeometry(note);
    const voice=JSON.stringify([Number(note.pitch),note.channelId??null,note.sourceId??null,note.cloudRaw?.sourceId??note.cloudRaw?.source_id??null]);
    if(!groups.has(voice))groups.set(voice,[]);groups.get(voice).push({index,note});
  }
  for(const entries of groups.values()){
    entries.sort((a,b)=>Number(a.note.start)-Number(b.note.start)||a.index-b.index);
    // The official menu promises contiguous/touching notes only. Overlapping
    // runs stay unchanged until native overlap/parameter behavior is verified.
    const eligible=[];let run=[],runEnd=0;
    const keepRun=()=>{if(run.length===1)eligible.push(run[0]);};
    for(const entry of entries){
      const onset=Number(entry.note.start),finish=onset+Number(entry.note.duration);
      if(run.length&&onset<runEnd-Number(tolerance)){run.push(entry);runEnd=Math.max(runEnd,finish);}
      else{keepRun();run=[entry];runEnd=finish;}
    }
    keepRun();
    let anchor=null,end=0;
    for(const entry of eligible){
      const onset=Number(entry.note.start),finish=onset+Number(entry.note.duration);
      if(!anchor||onset>end+Number(tolerance)){anchor=entry;end=finish;continue;}
      if(glueSignature(anchor.note)!==glueSignature(entry.note))throw Object.assign(new Error('Touching notes have different velocities or other note parameters. Their native Glue parameter precedence must be verified before combining them.'),{code:'note_glue_parameter_mapping_required'});
      assertStaticNoteData(anchor.note);assertStaticNoteData(entry.note);
      end=Math.max(end,finish);const joined=replacements.get(anchor.index)||clone(anchor.note);joined.duration=end-Number(joined.start);replacements.set(anchor.index,joined);removed.add(entry.index);
    }
  }
  if(!removed.size)return notes||[];
  return notes.flatMap((note,index)=>removed.has(index)?[]:[replacements.get(index)||note]);
}

/** FL note flags (Freestyle PatternNote `muted` / `slide`): set one flag on the
 * selected notes (or the given ids). `value` false clears it; the serializer
 * then omits a flag that was never stored, so a toggle back restores exactly. */
export const NOTE_FLAGS=Object.freeze(['muted','slide']);
export function setNoteFlag(notes,flag,value,{selectedIds=null}={}){
  if(!NOTE_FLAGS.includes(flag))throw new TypeError(`Unknown note flag: ${flag}`);
  return transformNotes(notes,note=>({...note,[flag]:value===true}),{selectedIds});
}
/** FL Mute / Slide tool click: the clicked note's opposite state applies to the
 * whole selection when the note is selected, else to that note only. */
export function toggleNoteFlag(notes,flag,noteId,selectedIds=null){
  const clicked=(notes||[]).find(note=>note.id===noteId);if(!clicked)return notes;
  const selection=idSet(selectedIds),ids=selection?.has(noteId)?selection:new Set([noteId]);
  return setNoteFlag(notes,flag,clicked[flag]!==true,{selectedIds:ids});
}
