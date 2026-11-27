/** Export dialog choices -> exportMix arguments (O02). Pure: no DOM, no I/O.
 *  Defaults send nothing, so an untouched dialog is today's request exactly. */
export const EXPORT_FORMATS=Object.freeze({
 wav:{label:'WAV',extension:'.wav',bitDepths:[16,24,32],defaultBitDepth:32,lossy:false},
 flac:{label:'FLAC',extension:'.flac',bitDepths:[16,24],defaultBitDepth:24,lossy:false},
 mp3:{label:'MP3',extension:'.mp3',bitrates:[96,128,160,192,224,256,320],defaultBitrate:256,lossy:true},
 ogg:{label:'OGG Vorbis',extension:'.ogg',lossy:true}
});
export const EXPORT_SAMPLE_RATES=Object.freeze([0,22050,32000,44100,48000,88200,96000,192000]);
export const EXPORT_TAIL_RANGE=Object.freeze({min:0,max:10,default:1});
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));

export function bitDepthLabel(depth){return depth===32?'32-bit float':`${depth}-bit`;}
export function sampleRateLabel(rate){return rate?`${rate} Hz`:'Engine default';}

/** Containers the live engine can encode: its `features.export_formats` (from getEngineMix).
 *  An engine that does not report the list is WAV-only. */
export function availableExportFormats(reported){
 const known=Array.isArray(reported)?reported.filter(id=>typeof id==='string'&&Object.hasOwn(EXPORT_FORMATS,id)):[];
 return new Set(['wav',...known]);
}
export const FORMAT_UNAVAILABLE_REASON='Not available on this Freestyle engine';
/** Engines report `features.stem_export` (getEngineMix) when exportMix can split the mixer tracks. */
export function stemExportAvailable(features){return features===true||features?.stem_export===true;}
export const STEM_UNAVAILABLE_REASON='Splitting mixer tracks needs a Freestyle engine update';

/** `choices`: {format, bitDepth, mp3BitrateKbps, sampleRate (0 = engine), range:'song'|'loop', loop:{startSec,endSec}|null, tailSec, splitStems}.
 *  Returns the arguments to merge into export_mix, or throws a user-readable Error. */
export function exportOptionArguments(choices={}){
 const format=String(choices.format||'wav').toLowerCase(),info=EXPORT_FORMATS[format];
 if(!info)throw new Error('Choose WAV, MP3, FLAC or OGG.');
 const args={};
 if(format!=='wav')args.format=format;
 if(info.bitDepths){
  const depth=finite(choices.bitDepth)?Number(choices.bitDepth):info.defaultBitDepth;
  if(!info.bitDepths.includes(depth))throw new Error(`${info.label} supports ${info.bitDepths.map(bitDepthLabel).join(' or ')}.`);
  if(depth!==32)args.bit_depth=depth;
 }
 if(format==='mp3'){
  const rate=finite(choices.mp3BitrateKbps)?Number(choices.mp3BitrateKbps):info.defaultBitrate;
  if(!info.bitrates.includes(rate))throw new Error('Choose an MP3 bitrate between 96 and 320 kbps.');
  args.mp3_bitrate_kbps=rate;
 }
 if(finite(choices.sampleRate)&&Number(choices.sampleRate)!==0){
  const rate=Number(choices.sampleRate);
  if(!Number.isInteger(rate)||rate<8000||rate>192000)throw new Error('Choose a sample rate between 8000 and 192000 Hz.');
  args.sample_rate=rate;
 }
 if(choices.range==='loop'){
  const loop=choices.loop;
  if(!loop||!finite(loop.startSec)||!finite(loop.endSec)||Number(loop.startSec)<0||Number(loop.endSec)<=Number(loop.startSec))throw new Error('Turn on a loop region before exporting the loop selection.');
  args.range={start_sec:Number(loop.startSec),end_sec:Number(loop.endSec)};
 }else if(choices.range!==undefined&&choices.range!=='song')throw new Error('Choose Song or Loop selection.');
 if(choices.splitStems===true)args.stems=true;
 if(finite(choices.tailSec)){
  const tail=Number(choices.tailSec);
  if(tail<EXPORT_TAIL_RANGE.min||tail>EXPORT_TAIL_RANGE.max)throw new Error(`The tail must be between ${EXPORT_TAIL_RANGE.min} and ${EXPORT_TAIL_RANGE.max} seconds.`);
  if(tail!==EXPORT_TAIL_RANGE.default)args.tail_sec=tail;
 }
 return args;
}
/** Suggested file extension for the chosen format (the server's reply decides the real one). */
export function exportExtension(format){return (EXPORT_FORMATS[String(format||'wav').toLowerCase()]||EXPORT_FORMATS.wav).extension;}

/** Freestyle's export job progress is a percent (0-100); anything else is shown bare rather than guessed at. */
export function exportProgressLabel(progress,stemJob=false){
 if(progress===null||progress===undefined||!Number.isFinite(Number(progress)))return'';
 const value=Number(progress),percent=value>=0&&value<=100;
 return stemJob?`Rendering stems: ${value}%`:percent?`Cloud progress: ${value}%`:`Cloud progress: ${value}`;
}
