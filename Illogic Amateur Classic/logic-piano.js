/** Logic Pro Piano Roll presentation and gesture rules (pure; no DOM, no writes).
 * The score itself still goes through the proven pattern edit/history path in app.js.
 * Logic labels MIDI 60 as C3 (FL labels it C5). Display only; MIDI numbers never change.
 */
const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export function logicNoteName(pitch){
 if(!Number.isInteger(pitch)||pitch<0||pitch>127)throw new RangeError('Choose a MIDI note from 0 to 127.');
 return NAMES[pitch%12]+(Math.floor(pitch/12)-2);
}

/** Logic's velocity colour scale for notes: low velocities green, mid yellow/orange, high red. */
export function logicVelocityColor(velocity){
 const v=Math.max(0,Math.min(1,Number.isFinite(velocity)?velocity:.8)),hue=Math.round(125-125*v);
 return `hsl(${hue} 72% ${Math.round(48-6*v)}%)`;
}
export const midiVelocity=velocity=>Math.max(0,Math.min(127,Math.round((Number.isFinite(velocity)?velocity:.8)*127)));

/** Time Quantize popup (quarter-note beats). Triplet values are 1/3, 1/6, 1/12, 1/24, 1/48, 1/96. */
export const LOGIC_TIME_QUANTIZE=Object.freeze([
 ['off','Off',0],['1/1','1/1 Note',4],['1/2','1/2 Note',2],['1/3','1/3 Note',4/3],['1/4','1/4 Note',1],['1/6','1/6 Note',2/3],
 ['1/8','1/8 Note',.5],['1/12','1/12 Note',1/3],['1/16','1/16 Note',.25],['1/24','1/24 Note',1/6],['1/32','1/32 Note',.125],
 ['1/48','1/48 Note',1/12],['1/64','1/64 Note',.0625],['1/96','1/96 Note',1/24],
].map(([id,label,beats])=>Object.freeze({id,label,beats,triplet:/^1\/(3|6|12|24|48|96)$/.test(id)})));
export const timeQuantizeBeats=id=>LOGIC_TIME_QUANTIZE.find(item=>item.id===id)?.beats??0;

/** Logic Time Quantize with Strength (0–100 %) and Swing (50 = straight, 100 = every
 * second grid slot pushed a half grid late). Durations are kept; notes never go below 0. */
export function quantizeLogic(notes,{grid,strength=100,swing=50}={}){
 if(!Number.isFinite(grid)||grid<=0)return (notes||[]).map(note=>({...note}));
 const amount=Math.max(0,Math.min(100,strength))/100,swingOffset=(Math.max(0,Math.min(100,swing))-50)/100*grid;
 return (notes||[]).map(note=>{
  const slot=Math.round(note.start/grid),target=slot*grid+(slot%2!==0?swingOffset:0),start=note.start+(target-note.start)*amount;
  return{...note,start:Math.max(0,Math.round(start*1e9)/1e9)};
 });
}

export const LOGIC_SCALES=Object.freeze({
 'Major (Ionian)':[0,2,4,5,7,9,11],'Natural Minor (Aeolian)':[0,2,3,5,7,8,10],'Dorian':[0,2,3,5,7,9,10],'Phrygian':[0,1,3,5,7,8,10],
 'Lydian':[0,2,4,6,7,9,11],'Mixolydian':[0,2,4,5,7,9,10],'Locrian':[0,1,3,5,6,8,10],'Harmonic Minor':[0,2,3,5,7,8,11],
 'Melodic Minor':[0,2,3,5,7,9,11],'Major Pentatonic':[0,2,4,7,9],'Minor Pentatonic':[0,3,5,7,10],'Blues':[0,3,5,6,7,10],
});
export const LOGIC_SCALE_ROOTS=Object.freeze(['Off',...NAMES]);
/** Scale Quantize: move each pitch to the nearest scale degree (ties resolve downward). */
export function scaleQuantizeNotes(notes,{root,scale='Major (Ionian)'}={}){
 const rootIndex=NAMES.indexOf(root),steps=LOGIC_SCALES[scale];
 if(rootIndex<0||!steps)return (notes||[]).map(note=>({...note}));
 const allowed=new Set(steps.map(step=>(step+rootIndex)%12));
 return (notes||[]).map(note=>{
  for(let distance=0;distance<12;distance++)for(const pitch of [note.pitch-distance,note.pitch+distance])if(pitch>=0&&pitch<=127&&allowed.has(pitch%12))return{...note,pitch};
  return{...note};
 });
}

/** Logic's bar/beat/division/tick position (all 1-based; 960 PPQ, so 240 ticks per 1/16). */
export function logicPosition(beat,{beatsPerBar=4,division=.25,ppq=960}={}){
 const b=Math.max(0,Number.isFinite(beat)?beat:0),ticksPerDivision=Math.round(division*ppq),totalTicks=Math.floor(b*ppq+1e-6),barTicks=beatsPerBar*ppq;
 const bar=Math.floor(totalTicks/barTicks),inBar=totalTicks-bar*barTicks,beatIndex=Math.floor(inBar/ppq),inBeat=inBar-beatIndex*ppq,div=Math.floor(inBeat/ticksPerDivision),tick=inBeat-div*ticksPerDivision;
 return{bar:bar+1,beat:beatIndex+1,division:div+1,tick:tick+1};
}
/** The Piano Roll header readout, e.g. "D#2  1 4 2 161". */
export function logicPositionReadout(pitch,beat,options){
 const p=logicPosition(beat,options);return `${Number.isInteger(pitch)&&pitch>=0&&pitch<=127?logicNoteName(pitch):'—'}  ${p.bar} ${p.beat} ${p.division} ${p.tick}`;
}

/** Collapse Mode (Logic Piano Roll header button): only the pitch rows that contain notes are shown, highest first.
 * One row model serves rendering, hit testing and gestures. With Collapse Mode off, or with no notes to collapse to,
 * every MIDI pitch 127…0 has a row. `shift` moves a pitch by whole rows, so drags land only on shown pitches. */
export function pianoRowModel(notes,{collapsed=false}={}){
 const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
 const used=collapsed?[...new Set((notes||[]).map(note=>note?.pitch).filter(pitch=>Number.isInteger(pitch)&&pitch>=0&&pitch<=127))].sort((a,b)=>b-a):[];
 if(!used.length){
  const pitchAt=row=>clamp(127-Math.floor(Number.isFinite(row)?row:0),0,127);
  return Object.freeze({collapsed:false,requested:!!collapsed,count:128,pitches:null,has:pitch=>Number.isInteger(pitch)&&pitch>=0&&pitch<=127,rowOf:pitch=>127-pitch,pitchAt,shift:(pitch,rows)=>clamp(pitch-Math.round(rows),0,127)});
 }
 const index=new Map(used.map((pitch,row)=>[pitch,row]));
 /* A pitch without a row (a note being previewed elsewhere) sits on the nearest shown row. */
 const rowOf=pitch=>{if(index.has(pitch))return index.get(pitch);let best=0;for(let row=1;row<used.length;row++)if(Math.abs(used[row]-pitch)<Math.abs(used[best]-pitch))best=row;return best;};
 const pitchAt=row=>used[clamp(Math.floor(Number.isFinite(row)?row:0),0,used.length-1)];
 return Object.freeze({collapsed:true,requested:true,count:used.length,pitches:Object.freeze(used),has:pitch=>index.has(pitch),rowOf,pitchAt,shift:(pitch,rows)=>used[clamp(rowOf(pitch)+Math.round(rows),0,used.length-1)]});
}
/** A group move by whole rows that keeps the group's shape: the row delta is clamped so no note leaves the shown rows. */
export function shiftPitchesByRows(notes,rows,model){
 const list=notes||[];if(!list.length)return[];
 const at=list.map(note=>model.rowOf(note.pitch)),delta=Math.max(-Math.min(...at),Math.min(model.count-1-Math.max(...at),Math.round(Number.isFinite(rows)?rows:0)));
 return list.map((note,i)=>({...note,pitch:model.pitchAt(at[i]+delta)}));
}
/** ⇧-drag in Logic limits a drag to one direction: the axis with the larger travel wins, the other delta is zero. */
export function constrainDragAxis({deltaX=0,deltaY=0}={},constrain=true){
 if(!constrain)return{deltaX,deltaY,axis:null};
 return Math.abs(deltaX)>=Math.abs(deltaY)?{deltaX,deltaY:0,axis:'x'}:{deltaX:0,deltaY,axis:'y'};
}

/** Logic Piano Roll tool menu, in Logic's order (Quick Help TOO_004…034): Pointer, Pencil, Eraser, Finger, Scissors, Join,
 * Mute, Quantize, Velocity, Zoom, Automation Select, Automation Curve, Brush. Keys are the default key command set's tool
 * keys (T, then the key). `id` is the app tool id behind each tool; `unsupported` tools stay listed, disabled with the reason.
 * The Solo (audition) tool is not in Logic's Piano Roll menu and sits last. */
export const LOGIC_PIANO_TOOLS=Object.freeze([
 ['select','Pointer Tool','T','↖'],['draw','Pencil Tool','P','✎'],['erase','Eraser Tool','E','⌫'],['finger','Finger Tool','F','☞'],['slice','Scissors Tool','I','✂'],
 ['glue','Join Tool','J','⊂⊃'],['mute','Mute Tool','M','⊘'],['quantize','Quantize Tool','Q','▦'],['velocity','Velocity Tool','V','▲'],['zoom','Zoom Tool','Y','⌕'],
 ['automation','Automation Select Tool','U','◇','The Piano Roll has no automation lane to select points in; use Track Automation (A).'],
 ['automation-curve','Automation Curve Tool','W','∿','Freestyle automation has straight segments only; curves cannot be bent.'],
 ['paint','Brush Tool','B','▤'],['playback','Solo Tool','S','◖'],
].map(([id,label,key,glyph,unsupported])=>Object.freeze({id,label,key,glyph,...(unsupported?{unsupported}:{})})));
export const logicPianoTool=id=>LOGIC_PIANO_TOOLS.find(tool=>tool.id===id)||null;
/** The tool a click uses: ⌘ selects the ⌘-click tool, as in Logic. */
export function logicEffectiveTool(event,{tool='select',commandTool='draw'}={}){return event?.metaKey&&!event.ctrlKey?commandTool:tool;}

/** Logic's Piano Roll context menu (right-click / Ctrl-click). Items carry ids the app runs. */
export function logicPianoContextMenu({onNote=false,selection=0,clipboard=false,editable=true,quantize='1/16 Note'}={}){
 const none=!selection,why='Select one or more notes first.';
 return[
  {id:'cut',label:'Cut',shortcut:'⌘X',disabled:!editable||none,reason:why},
  {id:'copy',label:'Copy',shortcut:'⌘C',disabled:none,reason:why},
  {id:'paste',label:'Paste',shortcut:'⌘V',disabled:!editable||!clipboard,reason:'Copy notes first.'},
  {id:'delete',label:'Delete',shortcut:'⌫',disabled:!editable||none,reason:why},
  null,
  {id:'select-all',label:'Select All',shortcut:'⌘A'},
  {id:'deselect',label:'Deselect All',shortcut:'⇧⌘A',disabled:none},
  null,
  {id:'quantize',label:`Quantize (${quantize})`,shortcut:'Q',disabled:!editable||(!onNote&&none),reason:why},
  {id:'scale-quantize',label:'Scale Quantize',disabled:!editable||(!onNote&&none),reason:why},
  {id:'transpose-up',label:'Transpose +1 Octave',disabled:!editable||none,reason:why},
  {id:'transpose-down',label:'Transpose −1 Octave',disabled:!editable||none,reason:why},
  null,
  {id:'mute',label:'Mute Notes On/Off',shortcut:'⌃M',disabled:!editable||none,reason:why},
  {id:'legato',label:'Note Overlap Correction (Legato)',disabled:!editable||none,reason:why},
  {id:'glue',label:'Glue Selected Notes',disabled:!editable||selection<2,reason:'Select touching notes first.'},
  {id:'properties',label:'Note Properties…',disabled:!editable||none,reason:why},
 ];
}
