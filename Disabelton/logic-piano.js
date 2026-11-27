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

/** Logic Piano Roll tool menu. `id` is the existing app tool id behind each Logic tool. */
export const LOGIC_PIANO_TOOLS=Object.freeze([
 ['select','Pointer Tool','T','↖'],['draw','Pencil Tool','P','✎'],['erase','Eraser Tool','E','⌫'],['slice','Scissors Tool','I','✂'],
 ['glue','Glue Tool','G','⊂⊃'],['mute','Mute Tool','M','⊘'],['velocity','Velocity Tool','V','▲'],['zoom','Zoom Tool','Z','⌕'],['playback','Solo Tool','S','◖'],
].map(([id,label,key,glyph])=>Object.freeze({id,label,key,glyph})));
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
