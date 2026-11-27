import {retainInProgress,isIdempotencyInProgress,captureWriteRequest} from './cloud-errors.js';
/** Inline gain-envelope editing. These are cloud controls and SVG geometry only. */
import {automationValue,automationWrite} from './automation-ui.js';
import {amplitudeToY,amplitudeAtY,validateAmplitudeDisplay} from './audacity-amplitude.js';
import {channelRows,channelAtY} from './audacity-channel-layout.js';
import {hasCanonicalTruncation} from './cloud-session.js';
import {LEGACY_AUTOMATION_CONTRACT,LIVE_AUTOMATION_CONTRACT,assertAutomationWritePreservesData,automationReadbackDifferences,assertAutomationJsonValue} from './audacity-automation-contract.js';

const copy=value=>structuredClone(value);
const number=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)));
// Audacity 3.2.1 WaveClip constructs Envelope(true, 1e-7, 2.0, 1.0).
// Apply native limits to edits only; retain all untouched cloud values.
export const NATIVE_ENVELOPE_MIN_GAIN=1e-7,NATIVE_ENVELOPE_MAX_GAIN=2;
const editedValue=value=>clamp(value,NATIVE_ENVELOPE_MIN_GAIN/4,NATIVE_ENVELOPE_MAX_GAIN/4);
const knownDefault=envelope=>typeof envelope.defaultValue==='number'&&Number.isFinite(envelope.defaultValue);
const missingDefault=()=>new Error('Freestyle has not exposed this envelope’s default value. Reload it before removing the last point.');
const sameSourceWindow=(a,b)=>['clipId','timelineStartSec','durationSec','pointStartSec','pointEndSec','timeDomain','sourceStartSec','sourceEndSec','sourceDurationSec','offsetKnown','waveformRevision'].every(key=>a?.[key]===b?.[key]);
const aborted=()=>Object.assign(new Error('The cloud project changed while the envelope operation was running.'),{name:'AbortError'});
const nativeCenter=(height,display,draw=false)=>{const f=Math.fround,range=f(display.max-display.min);return Math.trunc(draw?f(f(display.max/range)*Math.trunc(height)):f(f(Math.trunc(height)*display.max)/range));};
const pointStart=window=>Number.isFinite(window?.pointStartSec)?window.pointStartSec:0;
const pointEnd=window=>pointStart(window)+window.durationSec;
// Source times are nonnegative doubles. Use their neighboring representable
// values, rather than a fixed epsilon that collapses fine timeline zooms.
const adjacentSourceTime=(value,direction)=>{
 if(value===0)return direction>0?Number.MIN_VALUE:-Number.MIN_VALUE;
 const bits=new DataView(new ArrayBuffer(8));bits.setFloat64(0,value);bits.setBigUint64(0,bits.getBigUint64(0)+(direction>0?1n:-1n));return bits.getFloat64(0);
};

export function canonicalEnvelopeClipId(clip={}) {
 const id=clip.automationClipId||clip.cloudId||clip.id;
 if(typeof id!=='string'||!id)throw new Error('The clip has no canonical cloud identity.');
 if(id.startsWith('pattern:')||id.startsWith('backing:'))return id;
 if(clip.patternId)return 'pattern:'+id;
 if(clip.isBacking||clip.cloudRaw?.isBacking)return 'backing:'+id;
 return id;
}

/**
 * Project durations are beats; persisted automation points are seconds FROM
 * THIS CLIP'S START. Physical source coordinates remain separate for source
 * validation and PCM access; a trim offset must never enter an RPC point time.
 */
export function clipEnvelopeWindow(clip={},bpm=120) {
 const tempo=Number(bpm),raw=clip.cloudRaw||{};
 if(!Number.isFinite(tempo)||tempo<=0)throw new Error('The project tempo must be finite and positive.');
 const spb=60/tempo,durationSec=Math.max(0,number(clip.length)?Number(clip.length)*spb:0);
 let sourceStartSec=0,offsetKnown=false;
 if(clip.patternId){
  const offset=raw.offsetMs??raw.offset_ms;
  sourceStartSec=number(offset)?Math.max(0,Number(offset)/1000):0;
  // A pattern placement's absent offset is canonical zero in its serializer.
  offsetKnown=offset===undefined||number(offset);
 }else if(clip.offsetKnown!==false){
  if(number(clip.offset)){sourceStartSec=Math.max(0,Number(clip.offset)*spb);offsetKnown=true;}
  else if(number(raw.audioOffsetSec)){sourceStartSec=Math.max(0,Number(raw.audioOffsetSec));offsetKnown=true;}
  else if(number(raw.effects?.timing?.audioOffsetSec)){sourceStartSec=Math.max(0,Number(raw.effects.timing.audioOffsetSec));offsetKnown=true;}
 }
 const sourceEndSec=sourceStartSec+durationSec;
 const rawSourceSec=number(raw.sourceDurationSec)?raw.sourceDurationSec:raw.audioFullDurationSec;
 const sourceDurationSec=number(clip.sourceLength)?Math.max(sourceEndSec,Number(clip.sourceLength)*spb):number(rawSourceSec)?Math.max(sourceEndSec,Number(rawSourceSec)):sourceEndSec;
 return {clipId:canonicalEnvelopeClipId(clip),timelineStartSec:Math.max(0,Number(clip.start)||0)*spb,durationSec,pointStartSec:0,pointEndSec:durationSec,timeDomain:'clip-relative',sourceStartSec,sourceEndSec,sourceDurationSec,offsetKnown,editable:offsetKnown&&durationSec>0,
  reason:!offsetKnown?'Freestyle has not exposed this clip’s source offset. Reload its audio state before editing its envelope.':durationSec<=0?'The clip has no editable duration.':''};
}

/** Trusted source-frame metadata can fill an unknown read window without
 * changing a persisted clip or its normalized edit fields. Invalid/stale
 * placement metadata leaves the original unknown-offset guard in place. */
export function waveformEnvelopeWindow(clip,metadata,bpm=120) {
 const base=clipEnvelopeWindow(clip,bpm);if(base.offsetKnown||clip.patternId||!metadata||typeof metadata!=='object')return base;
 const sourceId=clip.cloudId||clip.id;if(metadata.clipId!==sourceId&&!(clip.isBacking&&metadata.clipId==='backing'))return base;
 const {sampleRate,frameCount,clipOffsetFrames,clipFrameCount,startMs,revision}=metadata;
 if(!Number.isSafeInteger(sampleRate)||sampleRate<=0||![frameCount,clipOffsetFrames,clipFrameCount].every(value=>Number.isSafeInteger(value)&&value>=0)||clipFrameCount<=0||clipOffsetFrames+clipFrameCount>frameCount||typeof startMs!=='number'||!Number.isFinite(startMs)||startMs<0||typeof revision!=='string'||!revision)return base;
 const tolerance=1/sampleRate+1e-9,sourceStartSec=clipOffsetFrames/sampleRate,durationSec=clipFrameCount/sampleRate;
 if(Math.abs(startMs/1000-base.timelineStartSec)>1e-6||Math.abs(durationSec-base.durationSec)>tolerance)return base;
 const declaredDuration=number(clip.sourceLength)?Number(clip.sourceLength)*60/Number(bpm):number(clip.cloudRaw?.sourceDurationSec)?Number(clip.cloudRaw.sourceDurationSec):number(clip.cloudRaw?.audioFullDurationSec)?Number(clip.cloudRaw.audioFullDurationSec):null;
 if(declaredDuration!==null&&Math.abs(declaredDuration-frameCount/sampleRate)>tolerance)return base;
 return {...base,sourceStartSec,sourceEndSec:sourceStartSec+base.durationSec,sourceDurationSec:frameCount/sampleRate,offsetKnown:true,editable:true,reason:'',waveformRevision:revision};
}

/** Gain is value*4. maxGain=1 places unity at the visible amplitude boundaries. */
export function envelopeGeometry(envelope,clip,{bpm=120,width=200,height=100,maxGain=4,samples=128,visibleStartSec,visibleEndSec,sourceWindow,display}={}) {
 const window=sourceWindow??clipEnvelopeWindow(clip,bpm);
 const view=envelopeDisplayWindow(window,{visibleStartSec,visibleEndSec});
 if(!window.offsetKnown||!envelope||!Array.isArray(envelope.points))return {window,upperPath:'',lowerPath:'',nodes:[]};
 if(!number(width)||width<=0||!number(height)||height<=0||!number(maxGain)||maxGain<=0)throw new Error('Envelope geometry dimensions and maximum gain must be positive.');
 // Audacity 3.2.1 TrackArt maps pixel 0 to the positive boundary and
 // height-1 to the negative boundary; inner controls are offset by 0.5.
 const points=envelope.points,amplitudeDisplay=validateAmplitudeDisplay(display??{min:-maxGain,max:maxGain,scale:'linear',dbRange:60});
 const valueAt=time=>points.length?automationValue(points,time):number(envelope.defaultValue)?Number(envelope.defaultValue):NaN;
 const y=(value,negative=false)=>amplitudeToY((negative?-1:1)*Number(value)*4,height,amplitudeDisplay,{round:false});
 const count=Math.max(2,Math.min(4096,Math.ceil(Number(samples)||128)));
 const upper=[],lower=[];
 for(let i=0;i<=count;i++){
  const x=i/count*width,value=valueAt(pointStart(view)+i/count*view.durationSec);
  if(!Number.isFinite(value))continue;
  upper.push(`${i?'L':'M'}${x.toFixed(3)},${y(value).toFixed(3)}`);
  lower.push(`${i?'L':'M'}${x.toFixed(3)},${y(value,true).toFixed(3)}`);
 }
 const nodes=points.flatMap((point,index)=>{
  if(!number(point.timeSec)||!number(point.value)||point.timeSec<pointStart(view)||point.timeSec>pointEnd(view)||view.durationSec<=0)return [];
  const gain=Number(point.value)*4,upperY=y(point.value),lowerY=y(point.value,true),upperPixel=amplitudeToY(gain,height,amplitudeDisplay),lowerPixel=amplitudeToY(-gain-1e-9,height,amplitudeDisplay),close=lowerPixel-upperPixel<9,center=nativeCenter(height,amplitudeDisplay,true),innerUpperY=amplitudeToY(gain,height,amplitudeDisplay,{contour:true}),innerLowerY=amplitudeToY(-gain-1e-9,height,amplitudeDisplay,{contour:true});
  return [{index,timeSec:Number(point.timeSec),value:Number(point.value),gain,x:(point.timeSec-pointStart(view))/view.durationSec*width,upperY,lowerY,upperHandleY:close?center-4:upperPixel,lowerHandleY:close?center+4:lowerPixel,innerUpperY,innerLowerY,innerVisible:innerUpperY<=innerLowerY}];
 });
 return {window,displayWindow:view,upperPath:upper.join(' '),lowerPath:lower.join(' '),nodes};
}

/** A linked gain envelope has a separate symmetric display in every real
 * source channel. Canonical points and source-time indexes remain shared. */
export function envelopeChannelsGeometry(envelope,clip,{channelCount=1,height=100,displays,channelLayout,...options}={}) {
 if(!Number.isSafeInteger(channelCount)||channelCount<1)throw new Error('Envelope channel count must be a positive integer.');
 if(!number(height)||height<=0)throw new Error('Envelope channel height must be positive.');
 const rowHeight=Number(height)/channelCount,window=options.sourceWindow??clipEnvelopeWindow(clip,options.bpm),displayWindow=envelopeDisplayWindow(window,options),channels=channelRows(Number(height),channelCount,channelLayout).map(({index:channel,top,height:nativeHeight})=>({channel,top,height:nativeHeight,...(nativeHeight>0?envelopeGeometry(envelope,clip,{...options,height:nativeHeight,display:displays?.[channel]??options.display}):{window,displayWindow,upperPath:'',lowerPath:'',nodes:[]})}));
 return {window:channels[0].window,displayWindow:channels[0].displayWindow,channelCount,rowHeight,channels};
}
export function envelopeChannelAt(y,height,channelCount=1,channelLayout) {
 if(!number(y)||!number(height)||height<=0||!Number.isSafeInteger(channelCount)||channelCount<1)throw new Error('Envelope channel pointer dimensions must be valid.');
 return channelAtY(Number(y),channelRows(Number(height),channelCount,channelLayout));
}

/** A viewport crops the displayed source range without changing its canonical identity or point indexes. */
export function envelopeDisplayWindow(window,{visibleStartSec,visibleEndSec}={}) {
 const start=number(visibleStartSec)?clamp(visibleStartSec,window.timelineStartSec,window.timelineStartSec+window.durationSec):window.timelineStartSec;
 const end=number(visibleEndSec)?clamp(visibleEndSec,start,window.timelineStartSec+window.durationSec):window.timelineStartSec+window.durationSec;
 const sourceStartSec=window.sourceStartSec+(start-window.timelineStartSec),pointStartSec=pointStart(window)+(start-window.timelineStartSec),durationSec=end-start;
 return {...window,timelineStartSec:start,sourceStartSec,sourceEndSec:sourceStartSec+durationSec,pointStartSec,pointEndSec:pointStartSec+durationSec,durationSec};
}

export function envelopePointAt(window,{x,y,width,height,maxGain=4,channelCount=1,channelIndex,upper,contour=false,display,channelLayout}={}) {
 if(!window?.editable)throw new Error(window?.reason||'This envelope’s source window is unavailable.');
 if(!number(width)||width<=0||!number(height)||height<=0||!number(maxGain)||maxGain<=0)throw new Error('Envelope pointer dimensions and maximum gain must be positive.');
 const selected=channelIndex===undefined?envelopeChannelAt(y,height,channelCount,channelLayout):channelIndex;
 if(!Number.isSafeInteger(channelCount)||channelCount<1||!Number.isInteger(selected)||selected<0||selected>=channelCount)throw new Error('Choose a valid envelope source channel.');
 const row=channelRows(Number(height),channelCount,channelLayout)[selected],rowTop=row.top,rowHeight=row.height,localY=clamp(Number(y)-rowTop,0,Math.max(0,rowHeight));
 if(rowHeight<=0)throw new Error('This envelope source channel has no visible pixel height.');
 const timeSec=pointStart(window)+clamp(x/width,0,1)*window.durationSec;
 const amplitudeDisplay=validateAmplitudeDisplay(display??{min:-maxGain,max:maxGain,scale:'linear',dbRange:60}),center=nativeCenter(rowHeight,amplitudeDisplay),side=upper??(amplitudeDisplay.min>=0||localY<center),signed=amplitudeAtY(localY,rowHeight,amplitudeDisplay,{contour});
 const gain=clamp(side?signed:-signed,NATIVE_ENVELOPE_MIN_GAIN,NATIVE_ENVELOPE_MAX_GAIN);
 return {timeSec,value:gain/4};
}

/** Native blank-space clicks choose the nearer outer/inner contour. Both the
 * source channel and the upper/lower side are captured for the whole drag. */
export function envelopeHandleAt(envelope,window,options){
 const {y,height,channelCount=1,channelLayout,channelIndex=envelopeChannelAt(y,height,channelCount,channelLayout)}=options,row=channelRows(Number(height),channelCount,channelLayout)[channelIndex],rowTop=row?.top,rowHeight=row?.height,localY=Math.trunc(Number(y)-rowTop);
 const point=envelopePointAt(window,{...options,channelIndex}),value=envelope.points.length?automationValue(envelope.points,point.timeSec):envelope.defaultValue,gain=Number(value)*4;
 const display=validateAmplitudeDisplay(options.display??{min:-(options.maxGain??4),max:options.maxGain??4,scale:'linear',dbRange:60}),center=nativeCenter(rowHeight,display),innerTop=amplitudeToY(gain,rowHeight,display,{contour:true}),innerBottom=amplitudeToY(-gain-1e-9,rowHeight,display,{contour:true}),outerTop=amplitudeToY(gain,rowHeight,display),outerBottom=amplitudeToY(-gain,rowHeight,display);
 return {upper:display.min>=0||localY<center,contour:innerTop<=innerBottom&&localY>Math.trunc((outerTop+innerTop)/2)&&localY<Math.trunc((outerBottom+innerBottom)/2)};
}

function unwrap(result) {
 let data=result?.structuredContent;
 if(data===undefined&&Array.isArray(result?.content)){
  try{data=JSON.parse(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));}catch{throw new Error('Freestyle returned an unreadable automation response.');}
 }
 data=data??result;const response=data?.response??data;
 if(result?.isError||data?.error||data?.ok===false||response?.error||response?.ok===false||isIdempotencyInProgress(result)){
  const detail=response?.error??data?.error??response?.message??data?.message;
  throw Object.assign(new Error(typeof detail==='string'?detail:detail?.message||'Freestyle could not complete the envelope operation.'),{result});
 }
 return response;
}

function canonicalEnvelope(value,clipId,projectId) {
 try{assertAutomationJsonValue(value);}catch(cause){throw new Error('Freestyle returned invalid canonical points or envelope metadata: '+cause.message,{cause});}
 const envelope=copy(value),points=envelope.points;
 envelope.clipId=envelope.clipId??envelope.clip_id;
 if(envelope.clipId!==clipId||envelope.target?.kind!=='clip_gain')throw new Error('Freestyle returned a gain envelope for a different clip.');
 if((envelope.projectId??envelope.project_id)!==undefined&&(envelope.projectId??envelope.project_id)!==projectId)throw new Error('Freestyle returned a gain envelope for a different cloud project.');
 if(!Array.isArray(points))throw new Error('Freestyle did not return the envelope’s canonical points.');
 if(hasCanonicalTruncation(envelope)||envelope.complete===false)throw new Error('Freestyle returned a partial envelope. Reload all points before editing it.');
 if(points.some(point=>!number(point.timeSec)||!number(point.value)||Number(point.timeSec)<0))throw new Error('Freestyle returned invalid envelope points.');
 return envelope;
}

/**
 * Every gesture begins from a complete server envelope and writes all its
 * points. Invisible source points are retained, including after clip trims.
 * List reads and saved revisions are scoped to the current cloud project.
 */
export class InlineEnvelopeController {
 constructor({cloudCall,getProject,resolveWindow=clipEnvelopeWindow,getContext=()=>null,getClipBinding=()=>null,isCurrentClip=()=>true,getAutomationContract=()=>LEGACY_AUTOMATION_CONTRACT,beforeBegin=()=>{},prepareWrite=async()=>{},notifyDiagnostics=true,onChange=()=>{},onError=()=>{},onSaved=()=>{}}={}) {
  if(typeof cloudCall!=='function'||typeof getProject!=='function'||typeof resolveWindow!=='function')throw new TypeError('InlineEnvelopeController requires cloudCall, getProject and resolveWindow callbacks.');
  if(typeof getAutomationContract!=='function')throw new TypeError('The automation contract must be provided by an explicit callback.');
  Object.assign(this,{cloudCall,getProject,resolveWindow,getContext,getClipBinding,isCurrentClip,getAutomationContract,beforeBegin,prepareWrite,notifyDiagnostics,onChange,onError,onSaved});this.cache=new Map();this.projectId=null;this.generation=0;this.gesture=null;this.saveQueue=Promise.resolve();this.writeReceipts=[];
 }
 receipts(){return copy(this.writeReceipts);}
 invalidate(){if([...this.cache.values()].some(entry=>entry.saving))throw new Error('Wait for envelope saves before reloading.');this.cancel();this.generation++;this.cache.clear();}
 scope(){
  const project=this.getProject(),id=project?.cloud?.projectId||project?.id,context=this.getContext();
  if(!id)throw new Error('Open a Freestyle cloud project before editing envelopes.');
  if(this.projectId!==id||this.contextKey!==context){this.projectId=id;this.contextKey=context;this.generation++;this.cache.clear();this.gesture=null;}
  return {project,id,context,generation:this.generation};
 }
 current(scope){const now=this.scope();return now.id===scope.id&&now.generation===scope.generation;}
 key(clip,scope=this.scope()){return `${scope.id}\u0000${canonicalEnvelopeClipId(clip)}`;}
 snapshot(entry,clip,{diagnostics=true}={}){return {key:entry.key,projectId:entry.projectId,clipId:entry.clipId,envelope:entry.envelope?{...copy(entry.envelope),points:copy(entry.points)}:null,points:copy(entry.points),window:this.gesture?.entry===entry?this.gesture.window:entry.saving&&entry.writeWindow?entry.writeWindow:this.resolveWindow(clip,this.getProject().bpm),loading:entry.loading,saving:entry.saving,dirty:entry.dirty,needsReload:entry.needsReload,error:entry.error||'',...(diagnostics?{writeReceipt:copy(entry.writeReceipt??null),blockedWrite:copy(entry.blockedWrite??null)}:{})};}
 notify(entry,clip){const state=this.snapshot(entry,clip,{diagnostics:this.notifyDiagnostics});this.onChange(state,clip);return state;}
 entry(clip,scope=this.scope()){const key=this.key(clip,scope),entry=this.cache.get(key);if(entry&&(entry.binding!==this.getClipBinding(clip)||!this.isCurrentClip(clip))){this.cache.delete(key);return null;}return entry;}
 get(clip,options={}){const entry=this.entry(clip);return entry?this.snapshot(entry,clip,options):null;}
 async readMany(clips,scope){
  const ids=clips.map(canonicalEnvelopeClipId),data=unwrap(await this.cloudCall('list_automation',{project_id:scope.id,clip_ids:ids}));if(!this.current(scope))throw aborted();
  if((data.projectId??data.project_id)!==undefined&&(data.projectId??data.project_id)!==scope.id)throw new Error('Freestyle returned automation for a different cloud project.');
  const rows=data.envelopes??data.automation,{envelopes,automation,...metadata}=data;
  if(!Array.isArray(rows)||hasCanonicalTruncation(metadata)||data.complete===false||data.has_more===true||data.hasMore===true||data.nextCursor||data.next_cursor||rows.some(row=>!row?.target?.kind&&hasCanonicalTruncation(row)))throw Object.assign(new Error('Freestyle returned an incomplete automation list.'),{retryIndividual:true});
  const result=new Map();for(const id of ids){const matches=rows.filter(row=>(row?.clipId??row?.clip_id)===id&&row?.target?.kind==='clip_gain');if(matches.length!==1)throw Object.assign(new Error('Freestyle did not return exactly one canonical gain envelope for each requested clip.'),{retryIndividual:true});try{result.set(id,canonicalEnvelope(matches[0],id,scope.id));}catch(error){error.retryIndividual=true;throw error;}}
  return result;
 }
 async read(clip,scope){
  const binding=this.getClipBinding(clip),rows=await this.readMany([clip],scope);if(binding!==this.getClipBinding(clip)||!this.isCurrentClip(clip))throw aborted();return rows.get(canonicalEnvelopeClipId(clip));
 }
 async load(clip,options={}){return (await this.loadMany([clip],options))[0];}
 async loadMany(clips,{force=false}={}){
  if(!Array.isArray(clips)||clips.length>128)throw new Error('Request at most 128 canonical clip envelopes in one read.');const scope=this.scope(),owners=[],pending=new Map();
  for(const clip of clips){canonicalEnvelopeClipId(clip);const entry=this.entry(clip,scope);if(entry?.saving)throw new Error('Wait for this envelope’s cloud save to finish.');if(this.gesture?.entry===entry&&entry&&(force||!entry.envelope||entry.needsReload))throw new Error('Finish or cancel the envelope gesture before reloading.');}
  for(const clip of clips){const id=canonicalEnvelopeClipId(clip);if(pending.has(id))continue;let entry=this.entry(clip,scope);
   if(entry?.pending&&!force){pending.set(id,entry.pending);continue;}if(entry?.saving)throw new Error('Wait for this envelope’s cloud save to finish.');
   if(entry?.envelope&&!force&&!entry.needsReload){pending.set(id,Promise.resolve(this.snapshot(entry,clip)));continue;}if(this.gesture?.entry===entry&&entry)throw new Error('Finish or cancel the envelope gesture before reloading.');
   const key=this.key(clip,scope);if(!entry){entry={key,projectId:scope.id,clipId:id,binding:this.getClipBinding(clip),envelope:null,points:[],loading:false,saving:false,dirty:false,needsReload:false,error:'',loadVersion:0};this.cache.set(key,entry);}owners.push({entry,clip,version:++entry.loadVersion});entry.loading=true;entry.error='';pending.set(id,null);
  }
  if(owners.length){const batch=Promise.resolve().then(()=>this.readMany(owners.map(owner=>owner.clip),scope));
   for(const {entry,clip,version}of owners){const ownsEntry=()=>this.current(scope)&&version===entry.loadVersion&&this.cache.get(entry.key)===entry,valid=()=>ownsEntry()&&entry.binding===this.getClipBinding(clip)&&this.isCurrentClip(clip);
    entry.pending=(async()=>{try{const rows=await batch;if(!valid())throw aborted();const envelope=rows.get(entry.clipId);entry.envelope=envelope;entry.points=copy(envelope.points);entry.needsReload=false;entry.dirty=false;entry.loading=false;return this.snapshot(entry,clip);}catch(error){if(valid()){entry.needsReload=true;entry.error=error.message;this.onError(error);}else if(ownsEntry())this.cache.delete(entry.key);throw error;}finally{if(ownsEntry()){entry.loading=false;entry.pending=null;this.notify(entry,clip);}}})();pending.set(entry.clipId,entry.pending);this.notify(entry,clip);
   }
  }
  return Promise.all(clips.map(clip=>pending.get(canonicalEnvelopeClipId(clip))));
 }
 begin(clip){
  this.beforeBegin();
  const scope=this.scope(),entry=this.entry(clip,scope),window=this.resolveWindow(clip,scope.project.bpm);
  if(this.gesture)throw new Error('Finish the current envelope gesture first.');
  if(!entry?.envelope||entry.loading||entry.saving||entry.needsReload)throw new Error('Reload the complete cloud envelope before editing.');
  if(!window.editable)throw new Error(window.reason);
  if(entry.envelope.pointsTruncated||entry.envelope.points_truncated)throw new Error('A partial envelope cannot be edited.');
  const live=this.getAutomationContract()===LIVE_AUTOMATION_CONTRACT;let sameTime=0;
  if(entry.points.some((point,index)=>{sameTime=index>0&&point.timeSec===entry.points[index-1].timeSec?sameTime+1:1;return index>0&&(Number(point.timeSec)<Number(entry.points[index-1].timeSec)||!live&&point.timeSec===entry.points[index-1].timeSec)||sameTime>2;}))throw new Error(live?'Reload a canonical envelope with nondecreasing source times and at most two points per time.':'Reload a canonical envelope with strictly increasing source point times before editing.');
  this.gesture={entry,clip,scope,window,original:copy(entry.points)};entry.dirty=false;entry.error='';return this.snapshot(entry,clip);
 }
 active(){const gesture=this.gesture;if(!gesture)throw new Error('Begin an envelope gesture before editing points.');if(!this.current(gesture.scope)||gesture.entry.binding!==this.getClipBinding(gesture.clip)||!this.isCurrentClip(gesture.clip))throw aborted();return gesture;}
 position(point,gesture){
  if(!number(point?.timeSec)||!number(point?.value))throw new Error('Envelope points need finite time and value.');
  return {timeSec:clamp(point.timeSec,pointStart(gesture.window),pointEnd(gesture.window)),value:editedValue(point.value)};
 }
 insert(point){
  const gesture=this.active(),position=this.position(point,gesture),entry=gesture.entry;
  const meta=Object.getOwnPropertyDescriptor(point,'meta');let metadata={};if(meta){if(!Object.hasOwn(meta,'value')||!meta.enumerable)throw new Error('Envelope point meta must be ordinary JSON data.');assertAutomationJsonValue(meta.value);metadata={meta:copy(meta.value)};}
  this.seedNativeInterpolation(gesture);
  // Native InsertOrReplace affects the exact timestamp only. Never normalize
  // the complete server curve: hidden points can be less than 1 us apart.
  let index=entry.points.findIndex(p=>p.timeSec===position.timeSec);const points=entry.points.slice();
  if(index>=0)points[index]={...points[index],...position,...metadata,...(point.curve!==undefined?{curve:point.curve}:{}),...(point.tension!==undefined?{tension:point.tension}:{})};
  else{index=points.findIndex(p=>p.timeSec>position.timeSec);if(index<0)index=points.length;points.splice(index,0,{...position,...metadata,curve:point.curve??(this.nativeDb(entry)?'db':'linear'),tension:point.tension??0});}
  entry.points=points;entry.dirty=true;this.notify(entry,gesture.clip);return index;
 }
 move(index,point){
  const gesture=this.active(),entry=gesture.entry,old=entry.points[index];if(!old)throw new Error('The envelope point no longer exists.');
  if(old.timeSec<pointStart(gesture.window)||old.timeSec>pointEnd(gesture.window))throw new Error('Points outside the clip-relative envelope window cannot be moved here.');
  const live=this.getAutomationContract()===LIVE_AUTOMATION_CONTRACT,position=this.position(point,gesture);let lower=Math.max(pointStart(gesture.window),index>0?(live?Number(entry.points[index-1].timeSec):adjacentSourceTime(Number(entry.points[index-1].timeSec),1)):0),upper=Math.min(pointEnd(gesture.window),index+1<entry.points.length?(live?Number(entry.points[index+1].timeSec):adjacentSourceTime(Number(entry.points[index+1].timeSec),-1)):Infinity);
  if(live){if(entry.points.filter((other,i)=>i!==index&&other.timeSec===lower).length>=2)lower=adjacentSourceTime(lower,1);if(entry.points.filter((other,i)=>i!==index&&other.timeSec===upper).length>=2)upper=adjacentSourceTime(upper,-1);}
  if(!Number.isFinite(lower)||!Number.isFinite(upper)||lower>upper)throw new Error('There is no distinct source time available between these envelope points.');
  this.seedNativeInterpolation(gesture);position.timeSec=clamp(position.timeSec,lower,upper);const points=entry.points.slice();points[index]={...points[index],...position};entry.points=points;entry.dirty=true;this.notify(entry,gesture.clip);return index;
 }
 nativeDb(entry){return this.getAutomationContract()===LIVE_AUTOMATION_CONTRACT&&entry.envelope.target?.kind==='clip_gain';}
 seedNativeInterpolation(gesture){const entry=gesture.entry;if(this.nativeDb(entry)&&entry.envelope.persisted===false&&knownDefault(entry.envelope)&&entry.points.every(point=>point.value===entry.envelope.defaultValue&&['linear','db'].includes(point.curve??'linear')))entry.points=entry.points.map(point=>({...point,curve:'db'}));}
 // Effect plans use exact normalized API values (including true zero), rather
 // than the native cursor's edited-point gain floor. Commit retains every
 // existing preservation, revision, source and authoritative-readback guard.
 replacePlannedPoints(points){const gesture=this.active();assertAutomationJsonValue(points);if(!Array.isArray(points))throw new Error('An envelope effect plan requires canonical points.');assertAutomationWritePreservesData({points,envelope:gesture.entry.envelope,window:gesture.window,contract:this.getAutomationContract()});gesture.entry.points=copy(points);gesture.entry.dirty=true;this.notify(gesture.entry,gesture.clip);}
 remove(index){
  const gesture=this.active(),entry=gesture.entry,point=entry.points[index];if(!point)throw new Error('The envelope point no longer exists.');
  if(point.timeSec<pointStart(gesture.window)||point.timeSec>pointEnd(gesture.window))throw new Error('Points outside the clip-relative envelope window cannot be removed here.');
  // Native one/zero-point drafts are represented faithfully. Commit preflight
  // still blocks endpoint removal while the supported server contracts add
  // endpoints; never substitute a fabricated point to bypass that guard.
  if(entry.points.length===1&&!knownDefault(entry.envelope))throw missingDefault();
  entry.points=entry.points.filter((_,i)=>i!==index);entry.dirty=true;this.notify(entry,gesture.clip);
 }
 cancel(){const gesture=this.gesture;if(!gesture)return;this.gesture=null;if(!this.current(gesture.scope))return;gesture.entry.points=copy(gesture.original);gesture.entry.dirty=false;this.notify(gesture.entry,gesture.clip);}
 commit(){
  const gesture=this.active(),entry=gesture.entry;this.gesture=null;
  if(!entry.dirty)return Promise.resolve(this.snapshot(entry,gesture.clip));
  if(entry.points.length===0&&!knownDefault(entry.envelope)){entry.points=copy(gesture.original);entry.dirty=false;this.notify(entry,gesture.clip);return Promise.reject(missingDefault());}
  if(entry.points.length>4096){entry.points=copy(gesture.original);entry.dirty=false;this.notify(entry,gesture.clip);return Promise.reject(new Error('Freestyle accepts at most 4096 automation points.'));}
  let contract;
  try{contract=this.getAutomationContract()??LEGACY_AUTOMATION_CONTRACT;assertAutomationWritePreservesData({points:entry.points,envelope:entry.envelope,window:gesture.window,contract});}
  catch(error){entry.points=copy(gesture.original);entry.dirty=false;entry.error=error.message;entry.blockedWrite={contract:contract??LEGACY_AUTOMATION_CONTRACT,reason:error.reason??error.message};this.notify(entry,gesture.clip);return Promise.reject(error);}
  const points=copy(entry.points),base=copy(entry.envelope);
  entry.blockedWrite=null;entry.writeWindow=gesture.window;entry.saving=true;this.notify(entry,gesture.clip);
  const stillOwned=()=>this.current(gesture.scope)&&this.cache.get(entry.key)===entry&&entry.binding===this.getClipBinding(gesture.clip)&&this.isCurrentClip(gesture.clip)&&sameSourceWindow(this.resolveWindow(gesture.clip,this.getProject().bpm),gesture.window);
  const task=async()=>{
   let confirmed=false,dispatched=false;
   try{
    if(!stillOwned())throw aborted();
    await this.prepareWrite();if(!stillOwned())throw aborted();
    if((this.getAutomationContract()??LEGACY_AUTOMATION_CONTRACT)!==contract)throw Object.assign(new Error('The verified automation contract changed while the edit was waiting. Reload before saving.'),{code:'AUTOMATION_LOSSY_WRITE',reason:'contract_changed'});
    assertAutomationWritePreservesData({points,envelope:base,window:gesture.window,contract});
    const generated=automationWrite(base,points,gesture.scope.id);generated.arguments.points=copy(points);if(!knownDefault(base))delete generated.arguments.default_value;if(base.valueType===undefined)delete generated.arguments.value_type;const write=captureWriteRequest(generated.name,generated.arguments);
    entry.writeReceipt={status:'sending',contract,projectId:gesture.scope.id,clipId:entry.clipId,context:gesture.scope.context,clipBinding:entry.binding,window:copy(gesture.window),before:copy(base),after:null,request:write,acknowledgement:null,terminalAcknowledged:false,readback:null};this.writeReceipts.push(entry.writeReceipt);dispatched=true;const acknowledgement=await this.cloudCall(write.name,write.arguments);entry.writeReceipt.acknowledgement=copy(acknowledgement);unwrap(acknowledgement);entry.writeReceipt.terminalAcknowledged=true;entry.writeReceipt.status='acknowledged';
    if(!stillOwned())throw aborted();
    // A new list supplies the authoritative revision, including server point
    // normalization. A write acknowledgement alone never becomes a guessed id.
    const saved=await this.read(gesture.clip,gesture.scope);entry.writeReceipt.readback=copy(saved);if(!stillOwned())throw aborted();entry.envelope=saved;entry.points=copy(saved.points);entry.dirty=false;entry.needsReload=false;entry.error='';
    const differences=automationReadbackDifferences(write,saved);if(saved.persisted!==true||typeof saved.id!=='string'||!saved.id||!Number.isSafeInteger(saved.revision))differences.push('persisted_identity');
    if(differences.length){const error=Object.assign(new Error(`Freestyle's authoritative automation readback changed the requested ${differences.join(', ')}. Exact data was not preserved; the original request and saved readback are retained.`),{code:'AUTOMATION_READBACK_MISMATCH',reason:'canonical_mismatch',differences});entry.writeReceipt.status='mismatched';entry.writeReceipt.reason=error.reason;entry.writeReceipt.differences=differences;entry.error=error.message;entry.needsReload=true;throw error;}
    entry.writeReceipt.after=copy(saved);entry.writeReceipt.status='verified';
    confirmed=true;const state={...this.snapshot(entry,gesture.clip),saving:false};await this.onSaved(state,gesture.clip);return state;
   }catch(error){
    if(error.code==='AUTOMATION_READBACK_MISMATCH'){this.onError(error);throw error;}
    if(confirmed){const refreshError=new Error(`Envelope saved, but refreshing the project failed: ${error.message}`,{cause:error});if(this.current(gesture.scope)){entry.error=refreshError.message;this.onError(refreshError);}throw refreshError;}
    if(!dispatched){entry.points=copy(gesture.original);entry.dirty=false;entry.error=error.message;entry.blockedWrite={contract,reason:error.reason??error.message,points};throw error;}
    if(!entry.writeReceipt.terminalAcknowledged)retainInProgress(entry.writeReceipt,error);entry.writeReceipt.status=entry.writeReceipt.terminalAcknowledged?'unverified':'uncertain';entry.writeReceipt.reason=error.message;
    if(stillOwned()){
     entry.points=copy(base.points);entry.envelope=base;entry.dirty=false;entry.needsReload=true;entry.error=error.message;
     // A failed write can be ambiguous (e.g. connection lost after commit).
     // Read, never retry a mutation, to reconcile it when possible.
     if(!entry.writeReceipt.idempotencyInProgress)try{const actual=await this.read(gesture.clip,gesture.scope);entry.envelope=actual;entry.points=copy(actual.points);entry.needsReload=false;entry.writeReceipt.reconciledReadback=copy(actual);}catch{}
     this.onError(error);
    }else{entry.error=error.message;entry.dirty=false;entry.needsReload=true;if(this.cache.get(entry.key)===entry)this.cache.delete(entry.key);}
    throw error;
   }finally{entry.saving=false;delete entry.writeWindow;if(this.current(gesture.scope))this.notify(entry,gesture.clip);}
  };
  const result=this.saveQueue.then(task,task);this.saveQueue=result.catch(()=>{});return result;
 }
}
