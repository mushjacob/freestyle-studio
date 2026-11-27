// Pure helpers for the Piano roll's scale highlighting. No DOM, no I/O.
import {SCALES,inScale,snapToScale} from './piano-note-tools.js';

export const PIANO_SCALE_STORAGE_KEY='vegetable:piano-scale';
export const PIANO_SCALE_NONE='none';
export const PIANO_SCALE_ROOTS=Object.freeze(['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']);

/** A clean `{root, scale}` choice; anything unknown becomes "None". */
export function normalizeScaleChoice(raw){
  const root=Number.isFinite(Number(raw?.root))?((Math.round(Number(raw.root))%12)+12)%12:0;
  const scale=typeof raw?.scale==='string'&&Object.prototype.hasOwnProperty.call(SCALES,raw.scale)?raw.scale:PIANO_SCALE_NONE;
  return{root,scale};
}
export function scaleActive(choice){return normalizeScaleChoice(choice).scale!==PIANO_SCALE_NONE;}
export function parseScaleChoice(text){try{return normalizeScaleChoice(JSON.parse(text));}catch{return normalizeScaleChoice(null);}}
export function serializeScaleChoice(choice){return JSON.stringify(normalizeScaleChoice(choice));}

/** CSS classes for a piano row: `in-scale`, plus `scale-root` on the root pitch class. */
export function rowClassesForPitch(pitch,choice){
  const {root,scale}=normalizeScaleChoice(choice);
  if(scale===PIANO_SCALE_NONE||!Number.isFinite(Number(pitch)))return'';
  if(!inScale(pitch,{root,scale}))return'';
  return((((Math.round(Number(pitch))%12)+12)%12)===root)?'in-scale scale-root':'in-scale';
}

/** Nearest in-scale pitch for a newly drawn note; unchanged with no scale or when bypassed (Alt). */
export function snapPitchToChoice(pitch,choice,{bypass=false}={}){
  const {root,scale}=normalizeScaleChoice(choice);
  if(bypass||scale===PIANO_SCALE_NONE)return pitch;
  return snapToScale(pitch,{root,scale});
}
