import {automationValue} from './automation-ui.js';
import {amplitudeToY} from './audacity-amplitude.js';
import {channelRows} from './audacity-channel-layout.js';
import {isClippedSample,isClippedColumn,clippingColor} from './audacity-clipping.js';
let sourceWaveformSequence=0;

// View-only helpers. All durations on the UI project are beats; Freestyle's
// persisted placement offsets use milliseconds. No audio is decoded here.
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const positive=(value,fallback)=>finite(value)>0?Number(value):fallback;

export function timelineTracks(project={}) {
  const channels=(project.channels||[]).filter(c=>c.id!=='empty'&&!c.patternSource);
  const clips=[...(project.clips||[]),...(project.audioClips||[])];
  const rows=new Map();
  const ensure=(index,laneId)=>{
    if(!rows.has(index))rows.set(index,{index,laneId:laneId||null,clips:[]});
    const row=rows.get(index);if(!row.laneId&&laneId)row.laneId=laneId;return row;
  };
  (project.cloud?.timelineLaneIds||[]).forEach((laneId,index)=>{if(laneId)ensure(index,laneId);});
  for(const clip of clips){
    const index=Math.max(0,Math.floor(finite(clip.track)));
    ensure(index,clip.laneId).clips.push(clip);
  }
  for(const channel of channels){
    const laneId=channel.laneId||channel.cloudTrackId||channel.id;
    let row=[...rows.values()].find(row=>row.laneId===laneId);
    if(!row){let index=0;while(rows.has(index))index++;row=ensure(index,laneId);}
    row.channel=channel;
  }
  return [...rows.values()].sort((a,b)=>a.index-b.index).map(row=>({
    ...row,
    name:project.trackNames?.[row.index]||row.channel?.name||row.clips[0]?.laneName||`Track ${row.index+1}`,
    channel:row.channel||null,
    clips:row.clips.slice().sort((a,b)=>finite(a.start)-finite(b.start)),
  }));
}

function peakRange(peak) {
  if(Array.isArray(peak)){
    const samples=peak.map(value=>value!==null&&value!==''&&typeof value!=='boolean'?Number(value):NaN);
    if(!samples.length||!samples.every(Number.isFinite))return null;
    return [Math.min(...samples),Math.max(...samples)];
  }
  if(peak&&typeof peak==='object'){
    const valid=value=>value!==null&&value!==''&&typeof value!=='boolean'&&Number.isFinite(Number(value));
    const low=Number(peak.min),high=Number(peak.max);
    if(valid(peak.min)&&valid(peak.max))return [Math.min(low,high),Math.max(low,high)];
    return null;
  }
  if(peak===null||peak===''||!Number.isFinite(Number(peak)))return null;
  const amplitude=Math.abs(Number(peak));return [-amplitude,amplitude];
}

/** Display a clip-relative seconds window without changing source timing or peaks. */
function waveformGeometry(clip={},width=200,height=100,bpm=120,envelope=null,{startSec=0,endSec,display,showClipping=false}={}) {
  const raw=clip.cloudRaw||{};
  if(clip.offsetKnown===false)envelope=null;
  const peaks=clip.peaks||raw.waveformPeaks||raw.waveform_peaks||raw.peaks||raw.waveform?.peaks;
  width=finite(width);height=finite(height);
  if(!Array.isArray(peaks)||!peaks.length||width<=0||height<=0)return {path:'',clippedPixels:[]};
  const secondsPerBeat=60/positive(bpm,120);
  const offset=Math.max(0,finite(clip.offset,finite(raw.audioOffsetSec,finite(raw.offsetMs)/1000)/secondsPerBeat));
  const length=Math.max(0,finite(clip.length));
  const fullLength=positive(clip.sourceLength,positive(raw.sourceDurationSec,positive(raw.audioFullDurationSec,positive(raw.waveform?.durationSec,0)))/secondsPerBeat);
  const windowStart=Math.max(0,finite(startSec)/secondsPerBeat),windowEnd=endSec==null?length:Math.min(length,finite(endSec)/secondsPerBeat);
  if((endSec!=null||windowStart>0)&&windowEnd<=windowStart)return {path:'',clippedPixels:[]};
  // Keep every supplied bucket anchored to its original source interval.
  // Cropping inside a bucket changes its displayed intersection, not the
  // bucket's duration or its measured min/max. No PCM detail is inferred.
  const domainLength=fullLength||length;
  const sourceStart=fullLength>0?offset+windowStart:windowStart;
  const sourceEnd=fullLength>0?offset+windowEnd:windowEnd;
  const domainWindow=sourceEnd-sourceStart;
  const first=domainLength>0?Math.max(0,Math.min(peaks.length,Math.floor(sourceStart/domainLength*peaks.length))):0;
  const last=domainLength>0?Math.max(0,Math.min(peaks.length,Math.ceil(sourceEnd/domainLength*peaks.length))):peaks.length;
  if(last<=first)return {path:'',clippedPixels:[]};
  const columns=Math.max(1,Math.min(Math.ceil(width),last-first));
  const center=height/2,amplitude=height*.46,path=[],clippedPixels=[];
  const rounded=value=>String(Number(value.toFixed(3)));
  for(let x=0;x<columns;x++){
    const start=first+Math.floor(x/columns*(last-first));
    const end=first+Math.floor((x+1)/columns*(last-first));
    let min=Infinity,max=-Infinity,valid=false,clipped=false;
    for(let i=start;i<end;i++){
      const range=peakRange(peaks[i]);if(!range)continue;
      const timeSec=(fullLength>0?(i+.5)/peaks.length*fullLength-offset:(i+.5)/peaks.length*length)*secondsPerBeat;
      const normalized=envelope?(envelope.points?.length?automationValue(envelope.points,timeSec):Number(envelope.defaultValue)):null;
      const gain=Number.isFinite(normalized)?Math.max(0,Math.min(4,normalized*4)):1;
      min=Math.min(min,range[0]*gain);max=Math.max(max,range[1]*gain);valid=true;if(showClipping===true&&isClippedColumn(range[0],range[1],gain))clipped=true;
    }
    if(!valid)continue;
    const left=domainLength>0?Math.max(sourceStart,start/peaks.length*domainLength):0;
    const right=domainLength>0?Math.min(sourceEnd,end/peaks.length*domainLength):0;
    const px=domainLength>0&&domainWindow>0?((left-sourceStart)+(right-sourceStart))/2/domainWindow*width:(x+.5)/columns*width;
    if(clipped){const pixel=Math.floor(px);if(pixel>=0&&pixel<width&&clippedPixels.at(-1)!==pixel)clippedPixels.push(pixel);}
    const top=display?amplitudeToY(max,height,display,{clip:true}):center-Math.min(1,max)*amplitude,bottom=display?amplitudeToY(min,height,display,{clip:true}):center-Math.max(-1,min)*amplitude;
    path.push(`M${rounded(px)} ${rounded(top)}V${rounded(bottom)}`);
  }
  return {path:path.join(''),clippedPixels};
}

/** Legacy supplied peaks retain their existing visual scope: source peaks and
 * known source envelope. No unavailable static gain or channels are guessed. */
export function waveformPath(clip={},width=200,height=100,bpm=120,envelope=null,options={}){return waveformGeometry(clip,width,height,bpm,envelope,options).path;}
function clippingPath(pixels,top,bottom){return pixels.map(pixel=>`M${pixel+.5} ${top}V${bottom}`).join('');}
function clippingMarkup(pixels,channel,top,bottom,muted){return `<path class="au-waveform-clipping" data-waveform-clipping="${channel}" data-waveform-clipping-pixels="${pixels.join(',')}" d="${clippingPath(pixels,top,bottom)}" style="fill:none;stroke:${clippingColor({muted})};stroke-width:1;vector-effect:non-scaling-stroke"/>`;}
export function waveformClippingPath(clip={},width=200,height=100,bpm=120,envelope=null,options={}){if(options.showClipping!==true)return '';return clippingPath(waveformGeometry(clip,width,height,bpm,envelope,options).clippedPixels,0,height);}
/** Legacy one-channel wrapper for callers needing clipping markup alongside the
 * existing .au-waveform path. An empty clipping path remains updatable while
 * envelopes are dragged; preference changes do not touch audio or cloud state. */
export function waveformSvg(clip={},width=200,height=100,bpm=120,envelope=null,options={}){const geometry=waveformGeometry(clip,width,height,bpm,envelope,options);if(!geometry.path)return '';return `<svg class="au-waveform" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="overflow:hidden"><path stroke-linecap="round" d="${geometry.path}"/>${options.showClipping===true?clippingMarkup(geometry.clippedPixels,0,0,height,options.clippingMuted===true):''}</svg>`;}

export function formatTime(seconds=0) {
  const milliseconds=Math.max(0,Math.round(finite(seconds)*1000));
  const hours=Math.floor(milliseconds/3600000),minutes=Math.floor(milliseconds/60000)%60;
  const secs=Math.floor(milliseconds/1000)%60,millis=milliseconds%1000;
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}.${String(millis).padStart(3,'0')}`;
}


/** Draw the engine's actual source-frame buckets in independent channel rows.
 * Bucket intervals retain the documented proportional floor boundaries. This
 * is display geometry only: coarse min/max data never becomes invented PCM.
 */
export function sourceWaveformSvg(tile,{width=200,height=100,startFrame=tile?.clipOffsetFrames,endFrame=startFrame+(tile?.clipFrameCount??0),envelope=null,amplitudeDisplays,displayForChannel,channelLayout,showClipping=false,clippingMuted=false,fillWide=false}={}){
 if(!tile||![width,height,startFrame,endFrame].every(Number.isFinite)||width<=0||height<=0||endFrame<=startFrame||!tile.channelCount||!tile.bucketCount)return '';
 const rows=channelRows(height,tile.channelCount,channelLayout),span=tile.endFrame-tile.startFrame,visible=endFrame-startFrame,rowHeight=height/tile.channelCount,round=value=>String(Number(value.toFixed(4))),paths=[],clipPaths=[],renderId=++sourceWaveformSequence;
 // One source frame has one signed PCM value. Only that exact framing, with
 // matching supplied min/max, permits a sample curve; aggregated buckets must
 // remain measured extrema/RMS and cannot be interpolated into fake samples.
 const sampleDetail=tile.bucketCount===span&&tile.channels.every(values=>values.min.every((value,index)=>value===values.max[index]));
 const envelopeGain=frame=>{const clipTime=(frame-tile.clipOffsetFrames)/tile.sampleRate,normalized=envelope?(envelope.points?.length?automationValue(envelope.points,clipTime):Number(envelope.defaultValue)):null;return tile.gain*(Number.isFinite(normalized)?Math.max(0,Math.min(4,normalized*4)):1);};
 for(let channel=0;channel<tile.channelCount;channel++){
  const {top:rowTop,bottom:rowBottom,height:nativeHeight}=rows[channel],center=channelLayout?rowTop+nativeHeight/2:(channel+.5)*rowHeight,half=(channelLayout?nativeHeight:rowHeight)*.44,values=tile.channels[channel],display=displayForChannel?.(channel)??amplitudeDisplays?.[channel],id=`au-waveform-${renderId}-channel-${channel}`;
  clipPaths.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><rect x="0" y="${rowTop}" width="${width}" height="${nativeHeight}"/></clipPath>`);
  const projectY=value=>display?rowTop+amplitudeToY(value,nativeHeight,display):center-Math.max(-1,Math.min(1,value))*half;
  const projectColumnY=value=>display?rowTop+amplitudeToY(value,nativeHeight,display,{clip:true}):projectY(value);
  const clippedPixels=[];
  const mark=(pixel,deduplicate)=>{if(pixel>=0&&pixel<width&&(!deduplicate||clippedPixels.at(-1)!==pixel))clippedPixels.push(pixel);};
  const markers=()=>showClipping===true?clippingMarkup(clippedPixels,channel,rowTop,rowBottom,clippingMuted===true):'';
  const row=content=>`<g data-waveform-row="${channel}" clip-path="url(#${id})">${content}</g>`;
  if(nativeHeight<=0){paths.push(row(''));continue;}
  if(sampleDetail){
   const clipFirst=tile.clipOffsetFrames,clipEnd=clipFirst+tile.clipFrameCount,showPoints=width/visible>=3;let curve='',points='',count=0,lastPoint='';
   for(let index=0;index<tile.bucketCount;index++){
    const frame=tile.startFrame+index;if(frame<clipFirst||frame>=clipEnd||frame<Math.floor(startFrame)-1||frame>Math.ceil(endFrame))continue;
    // A sample exists at frame/sampleRate, not at its bucket midpoint. Include
    // supplied neighboring samples for the line entering a fractional view;
    // SVG viewport clipping hides their actual offscreen coordinates.
    const x=(frame-startFrame)/visible*width,gain=envelopeGain(frame),y=projectY(values.min[index]*gain),point=`${round(x)} ${round(y)}`;
    if(showClipping===true&&isClippedSample(values.min[index],gain))mark(Math.floor(x+.5),false);
    curve+=(count?'L':'M')+point;lastPoint=point;count++;
    if(showPoints&&frame>=startFrame&&frame<endFrame)points+=`<circle class="au-waveform-sample" data-waveform-sample-channel="${channel}" data-source-frame="${frame}" cx="${round(x)}" cy="${round(y)}" r="2" stroke="none"/>`;
   }
   // A single real sample still needs a visible stroke when no next sample is
   // available. A round cap makes its zero-length segment a one-pixel mark.
   if(count===1)curve+='L'+lastPoint;
   paths.push(row(`<path data-waveform-channel="${channel}" data-waveform-samples="true" stroke-linecap="round" d="${curve}"/>${points}${markers()}`));continue;
  }
  let minmax='',rms='';
  for(let index=0;index<tile.bucketCount;index++){
   const first=tile.bucketBoundaries?.[index]??tile.startFrame+Math.floor(index*span/tile.bucketCount),last=tile.bucketBoundaries?.[index+1]??tile.startFrame+Math.floor((index+1)*span/tile.bucketCount);
   if(last<=startFrame||first>=endFrame||last<=tile.clipOffsetFrames||first>=tile.clipOffsetFrames+tile.clipFrameCount)continue;
   const left=Math.max(first,startFrame,tile.clipOffsetFrames),right=Math.min(last,endFrame,tile.clipOffsetFrames+tile.clipFrameCount),mid=(left+right)/2,x=(mid-startFrame)/visible*width,gain=envelopeGain(mid),top=projectColumnY(values.max[index]*gain),bottom=projectColumnY(values.min[index]*gain),level=values.rms[index]*gain;
   // Native DrawMinMaxRMS keeps the RMS pen inside the actual projected
   // extrema, one pixel in from each end. A positive-only/DC bucket cannot
   // acquire a fictitious negative half merely because RMS is unsigned.
   let rmsBottom=Math.min(projectColumnY(-level),bottom-1),rmsTop=Math.max(projectColumnY(level),top+1);if(rmsTop>rmsBottom)rmsTop=rmsBottom;
   if(showClipping===true&&isClippedColumn(values.min[index],values.max[index],gain))mark(Math.floor(x),true);
   // A bucket wider than a pixel (coarser cached peaks stretched under a deeper zoom) fills its whole measured
   // interval with the same extrema, one column per pixel; it is never thinned to a single stick.
   const spanPx=(right-left)/visible*width;
   if(fillWide&&spanPx>1.5){const from=(left-startFrame)/visible*width,columns=Math.min(Math.ceil(width)+1,Math.ceil(spanPx));for(let column=0;column<columns;column++){const cx=Math.min(from+column+.5,from+spanPx);minmax+=`M${round(cx)} ${round(top)}V${round(bottom)}`;if(rmsBottom!==rmsTop)rms+=`M${round(cx)} ${round(rmsTop)}V${round(rmsBottom)}`;}}
   else{minmax+=`M${round(x)} ${round(top)}V${round(bottom)}`;if(rmsBottom!==rmsTop)rms+=`M${round(x)} ${round(rmsTop)}V${round(rmsBottom)}`;}
  }
  paths.push(row(`<path data-waveform-channel="${channel}" stroke-linecap="round" d="${minmax}"/><path class="au-waveform-rms" data-waveform-rms="${channel}" d="${rms}"/>${markers()}`));
 }
 const revision=String(tile.revision).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return `<svg class="au-source-waveform" data-cloud-waveform="true" data-waveform-revision="${revision}" data-waveform-buckets="${tile.bucketCount}" data-waveform-detail="${sampleDetail?'samples':'extrema'}" style="overflow:hidden" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="${tile.channelCount} channel cloud source waveform"><defs>${clipPaths.join('')}</defs>${paths.join('')}</svg>`;
}
