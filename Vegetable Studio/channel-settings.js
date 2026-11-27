/** FL Channel settings window (Sampler tab): pure field mapping. No DOM, no I/O.
 * Every editable field here is one the engine already reads from the pattern
 * source (sampleRange, rootPitch, samplePlaybackMode, sampleReleaseTauSec) or
 * the channel PATCH already accepts (name, color, volume, outputLaneId).
 * Fields with no engine/API support are listed in DISABLED_CONTROLS so the
 * window can show FL's layout with them disabled. */
import {flNoteName} from './fl-note-name.js';

export const NEEDS_ENGINE='Needs a Freestyle engine update';
export const MIN_RANGE_SEC=.01;
export const DEFAULT_RELEASE_SEC=.083;
export const MAX_RELEASE_SEC=2;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const round3=value=>Math.round(value*1000)/1000;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** The modes Mozart's normalizedSamplePlaybackMode / planPatternSampleClip know. */
export const SAMPLE_PLAYBACK_MODES=Object.freeze([
 {value:'one-shot',label:'One shot',hint:'Plays the whole sample; the note length never cuts it.'},
 {value:'hold',label:'Hold',hint:'Note off at the note end, then the release.'},
 {value:'gate',label:'Gate',hint:'Gated like Hold; needs a pitched note.'},
 {value:'classic',label:'Classic',hint:'Gated like Hold; needs a pitched note.'},
 {value:'loop',label:'Loop (note length)',hint:'The note length truncates the sample. The sample itself does not loop.'}
]);
/** Same normalisation as the engine: lower case; empty / oneshot / one_shot mean one-shot. */
export function normalizePlaybackMode(mode){
 const text=typeof mode==='string'?mode.toLowerCase():'';
 return !text||text==='oneshot'||text==='one_shot'?'one-shot':text;
}
export function playbackModeLabel(mode){const normal=normalizePlaybackMode(mode);return SAMPLE_PLAYBACK_MODES.find(item=>item.value===normal)?.label??normal;}
export const isKnownPlaybackMode=mode=>SAMPLE_PLAYBACK_MODES.some(item=>item.value===normalizePlaybackMode(mode));
/** Release is read for gated modes only. */
export const releaseApplies=mode=>!['one-shot','loop'].includes(normalizePlaybackMode(mode));

/** Root note: an integer MIDI note 0..127 (default 60); FL names 60 as C5. */
export function clampRootPitch(value,fallback=60){const n=Number(value);return Number.isFinite(n)?clamp(Math.round(n),0,127):fallback;}
export function rootNoteName(pitch){return flNoteName(clampRootPitch(pitch));}
export const ROOT_NOTES=Object.freeze(Array.from({length:128},(_,pitch)=>({pitch,name:flNoteName(pitch)})));
/** "C5", "c#4", "Db3" or "60" -> MIDI note, or null when it is not a note in 0..127. */
export function parseRootNote(text){
 const value=String(text??'').trim();if(!value)return null;
 if(/^-?\d+(\.\d+)?$/.test(value)){const n=Number(value);return Number.isInteger(n)&&n>=0&&n<=127?n:null;}
 const match=/^([a-gA-G])([#b]?)(-?\d+)$/.exec(value);if(!match)return null;
 const base={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[match[1].toUpperCase()],shift=match[2]==='#'?1:match[2]==='b'?-1:0,pitch=base+shift+12*Number(match[3]);
 return Number.isInteger(pitch)&&pitch>=0&&pitch<=127?pitch:null;
}

/** Release time (seconds), 0..2. */
export function clampRelease(value,fallback=DEFAULT_RELEASE_SEC){const n=Number(value);return Number.isFinite(n)?round3(clamp(n,0,MAX_RELEASE_SEC)):fallback;}
export function releaseOf(source){return finite(source?.sampleReleaseTauSec)?clampRelease(source.sampleReleaseTauSec):DEFAULT_RELEASE_SEC;}

/** The sample's full length in seconds: the stored peaks' length, else the source's. */
export function fullDuration(source,waveform){
 for(const value of [waveform?.durationSec,source?.durationSec])if(finite(value)&&value>0)return value;
 return null;
}
/** Start/end markers (seconds) for a source; no sampleRange = the whole sample. */
export function markerRange(source,full){
 if(!finite(full)||full<=0)return null;
 const range=source?.sampleRange;
 if(range&&typeof range==='object'&&finite(range.offsetSec)&&finite(range.durationSec)&&range.durationSec>0){
  const start=clamp(range.offsetSec,0,full-MIN_RANGE_SEC),end=clamp(range.offsetSec+range.durationSec,start+MIN_RANGE_SEC,full);
  return{startSec:round3(start),endSec:round3(Math.min(end,full)),fullSec:full};
 }
 return{startSec:0,endSec:full,fullSec:full};
}
/** Move one marker to `sec`, keeping 0 <= start < end <= full with a minimum length. */
export function moveMarker(range,which,sec,minSec=MIN_RANGE_SEC){
 if(!range||!finite(sec)||(which!=='start'&&which!=='end'))return range;
 const {startSec,endSec,fullSec}=range,min=Math.min(minSec,fullSec);
 return which==='start'?{startSec:round3(clamp(sec,0,endSec-min)),endSec,fullSec}:{startSec,endSec:round3(clamp(sec,startSec+min,fullSec)),fullSec};
}
/** Seconds under pixel x of a waveform `width` wide. */
export function secondsAtX(x,width,full){return!finite(x)||!finite(width)||width<=0||!finite(full)?0:clamp(x/width,0,1)*full;}
/** Nearest marker to pixel x (an exact tie picks the end). */
export function nearestMarker(range,x,width){
 if(!range||!(width>0))return null;
 const start=range.startSec/range.fullSec*width,end=range.endSec/range.fullSec*width;
 return Math.abs(x-start)<Math.abs(x-end)?'start':'end';
}
/** `sampleRange` field for a marker pair; null (clears it) when it covers the whole sample. */
export function sampleRangeField(range){
 if(!range)return null;
 const start=round3(range.startSec),end=round3(range.endSec);
 if(start<=0&&end>=round3(range.fullSec))return null;
 return{offsetSec:start,durationSec:round3(end-start)};
}
export const sameRange=(a,b)=>!!a&&!!b&&a.startSec===b.startSec&&a.endSec===b.endSec;

/** One saved edit per control. `value` is the control's value; null when it is not valid. */
export function fieldsFor(control,value,{full=null,source=null}={}){
 switch(control){
  case'name':{const text=typeof value==='string'?value.trim():'';return text&&text.length<=255?{name:text}:null;}
  case'color':return value===null?{color:null}:/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(value))?{color:String(value).toLowerCase()}:null;
  case'volume':return finite(value)&&value>=0&&value<=2?{volume:value}:null;
  case'outputLaneId':return value===null||(typeof value==='string'&&value&&value.length<=64)?{outputLaneId:value}:null;
  case'range':{const field=sampleRangeField(value);return value&&finite(value.fullSec)?{sampleRange:field}:null;}
  case'rootPitch':{const n=Number(value);return Number.isInteger(n)&&n>=0&&n<=127?{rootPitch:n}:null;}
  case'samplePlaybackMode':return isKnownPlaybackMode(value)?{samplePlaybackMode:normalizePlaybackMode(value)}:null;
  case'sampleReleaseTauSec':{const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=MAX_RELEASE_SEC?{sampleReleaseTauSec:round3(n)}:null;}
  default:return null;
 }
}
/** History step label per control (one undo step each). */
export const STEP_LABELS=Object.freeze({name:'Rename channel',color:'Change color',volume:'Channel volume',outputLaneId:'Route to mixer track',range:'Sample start/end',rootPitch:'Root note',samplePlaybackMode:'Sample playback mode',sampleReleaseTauSec:'Sample release'});

/** Every value the window shows for one channel. */
export function settingsModel(channel,waveform=null){
 const source=channel?.cloudSource??null,full=fullDuration(source,waveform),mode=normalizePlaybackMode(source?.samplePlaybackMode);
 return{
  name:channel?.name??'',color:typeof source?.color==='string'?source.color:null,volume:finite(channel?.volume)?channel.volume:1,pan:finite(channel?.pan)?channel.pan:0,
  outputLaneId:source?.outputLaneId??null,range:markerRange(source,full),full,
  rootPitch:clampRootPitch(source?.rootPitch),mode,modeKnown:isKnownPlaybackMode(source?.samplePlaybackMode),release:releaseOf(source),releaseEnabled:releaseApplies(mode)
 };
}

/** FL layout controls the engine/API cannot save yet: shown disabled. */
export const DISABLED_CONTROLS=Object.freeze({
 pan:{label:'Pan',reason:'Channel pan is not a saved channel field. '+NEEDS_ENGINE},
 smp:[
  {id:'reverse',label:'Reverse',type:'check'},
  {id:'loop',label:'Loop',type:'check'},
  {id:'normalize',label:'Normalize',type:'check'},
  {id:'stretchMode',label:'Time stretching',type:'select',options:['Resample']},
  {id:'stretchPitch',label:'Pitch',type:'number',unit:'cents'},
  {id:'stretchMul',label:'Multiplier',type:'number',unit:'x'}
 ],
 ins:[
  {id:'polyphony',label:'Polyphony',type:'number'},
  {id:'mono',label:'Mono',type:'check'},
  {id:'envDelay',label:'Delay',type:'number',group:'Volume envelope'},
  {id:'envAttack',label:'Attack',type:'number',group:'Volume envelope'},
  {id:'envHold',label:'Hold',type:'number',group:'Volume envelope'},
  {id:'envDecay',label:'Decay',type:'number',group:'Volume envelope'},
  {id:'envSustain',label:'Sustain',type:'number',group:'Volume envelope'},
  {id:'envRelease',label:'Release',type:'number',group:'Volume envelope'},
  {id:'filterType',label:'Type',type:'select',options:['Low pass'],group:'Filter'},
  {id:'filterCutoff',label:'Cutoff',type:'number',group:'Filter'},
  {id:'filterResonance',label:'Resonance',type:'number',group:'Filter'}
 ]
});
