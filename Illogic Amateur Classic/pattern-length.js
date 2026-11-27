import {patternLengthBeats} from './pattern-preview.js';

/** Explicit length edits update the native DTO as well as its local view. */
export function setPatternLengthBars(pattern,bars){
 if(!Number.isFinite(bars)||bars<=0)throw new Error('Pattern length must be a positive number of bars.');
 const raw=pattern.cloudRaw,dto=raw?.data?.pattern?raw.data:raw;
 pattern.bars=bars;
 if(dto&&typeof dto==='object'){
  const ppq=Number(dto.ppq)>0&&Number.isFinite(Number(dto.ppq))?Number(dto.ppq):96;
  dto.bars=bars;dto.lengthTicks=bars*4*ppq;
  if(Object.hasOwn(dto,'length_ticks'))dto.length_ticks=dto.lengthTicks;
 }
 return pattern;
}

/** Note edits preserve exact source length until an endpoint extends past it. */
export function growPatternForNotes(pattern,notes){
 const current=patternLengthBeats(pattern);let end=current;
 for(const note of notes||[]){const start=Number(note.start),duration=Number(note.duration);if(Number.isFinite(start)&&start>=0&&Number.isFinite(duration)&&duration>0)end=Math.max(end,start+duration);}
 if(end<=current+1e-9)return false;
 setPatternLengthBars(pattern,Math.ceil(end/4));return true;
}
