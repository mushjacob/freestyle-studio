import {createClipWaveformTransport} from './cloud-waveform.js';
import {planZeroCrossingWindow,selectAtZeroCrossings} from './audacity-zero-crossing.js';
const clone=value=>structuredClone(value);
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const signature=value=>JSON.stringify(stable(value));
const clipId=clip=>clip?.cloudId||(clip?.id==='backing'?'backing':null);
const sourceSignature=clip=>signature(clip);
const changed=message=>Object.assign(new Error(message),{name:'AbortError'});
const opaque=value=>typeof value==='string'&&value.length>0&&value.length<=64;

/** Native zero-crossing selection over cloud supplied one-frame PCM buckets.
 * This performs reads and local selection changes only. Resource limits are
 * configurable client safeguards, not limits of native Audacity behavior.
 */
export class AudacityZeroCrossings{
 constructor(workspace,{maxSourceClips=64,maxReadCalls=256,maxConcurrent=2,maxSamples=2000000}={}){
  for(const [key,value]of Object.entries({maxSourceClips,maxReadCalls,maxConcurrent,maxSamples}))if(!integer(value,1))throw new RangeError(`${key} must be a positive integer.`);
  Object.assign(this,{w:workspace,maxSourceClips,maxReadCalls,maxConcurrent,maxSamples});this.pending=null;
 }
 projectId(){const p=this.w.getProject();return p.cloud?.projectId||p.id;}
 context(){const w=this.w,e=w.engine,s=e.session;return {projectId:this.projectId(),engineProjectId:e.projectId,sessionProjectId:s?.projectId,trackId:s?.trackId||undefined,loadVersion:e.loadVersion||0,contextVersion:s?.contextVersion||0,capabilityContext:w.capabilityContext??null,capabilityGeneration:w.capabilityGeneration??0};}
 projectRate(){const p=this.w.getProject(),raw=p.cloud?.rawState,session=this.w.engine.session?.rawState,projectRate=raw?.transport?.sample_rate??raw?.sample_rate,sessionRate=session?.transport?.sample_rate,rate=projectRate??sessionRate;if(!integer(rate,1))throw new Error('At Zero Crossings needs the actual cloud project sample rate.');if(projectRate!==undefined&&sessionRate!==undefined&&projectRate!==sessionRate)throw new Error('The visible project and native session sample rates are not synchronized. Refresh the project.');return rate;}
 assertIdle(){const w=this.w,e=w.engine;if(w.busy||e.interacting||e.applying||e.pending||w.clipGesture||w.selectionGesture?.active||w.envelopeView?.active||w.loopRegion?.active||w.viewport?.pinDrag)throw new Error('Finish the current cloud edit or gesture before selecting at zero crossings.');}
 capture(){
  const w=this.w,p=w.getProject(),e=w.engine,s=e.session;this.assertIdle();
  if(w.capabilityContext!=null&&typeof w.cloudContext==='function'&&w.capabilityContext!==w.cloudContext())throw new Error('Refresh the current cloud waveform tool capability before selecting at zero crossings.');
  if(w.waveformSupported!==true||!e.ready||e.loading||s?.closed||typeof s?.call!=='function')throw new Error('At Zero Crossings needs the supported live cloud waveform reader.');
  const context=this.context();if(!opaque(context.projectId)||e.projectId&&e.projectId!==context.projectId||s.projectId&&s.projectId!==context.projectId)throw new Error('Load the current cloud project before selecting at zero crossings.');
  const rate=this.projectRate(),selection=clone(w.selection);if(!Number.isFinite(selection.start)||!Number.isFinite(selection.end)||selection.start<0||selection.end<selection.start)throw new Error('Choose an ordered nonnegative time selection.');
  const indexes=[...w.selectedTracks].sort((a,b)=>a-b),tracks=w.tracks.filter(track=>indexes.includes(track.index));
  if(!indexes.length||tracks.length!==indexes.length||tracks.some(track=>!opaque(track.laneId)))throw new Error('Select persisted audio lanes before selecting at zero crossings.');
  const canonical=new Map((p.audioClips||[]).map(clip=>[String(clip.id),clip]));
  const lanes=tracks.map(track=>{
   if(['instrument','pattern'].includes(track.channel?.type)||track.clips.some(clip=>clip.patternId))throw new Error('At Zero Crossings supports selected audio lanes only. Deselect pattern or mixed lanes.');
   if(!track.clips.length)throw new Error('The selected audio lane has no source metadata to establish its native channel layout.');
   const clips=track.clips.map(clip=>{const current=canonical.get(String(clip.id));if(!current||clipId(current)!==clipId(clip)||!opaque(clipId(current))||current.track!==track.index||current.laneId&&current.laneId!==track.laneId||!Number.isFinite(current.start)||!Number.isFinite(current.length)||current.start<0||current.length<=0)throw new Error('The selected lane contains unknown or unpersisted audio source timing.');return {clip:current,id:clipId(current),signature:sourceSignature(current)};});
   return {index:track.index,laneId:track.laneId,type:track.channel?.type,clips};
  });
  const sources=lanes.flatMap(lane=>lane.clips);if(sources.length>this.maxSourceClips)throw new Error(`This cloud zero-crossing command is limited to ${this.maxSourceClips} source clips per read. Select fewer audio lanes.`);
  if(new Set(lanes.map(lane=>lane.laneId)).size!==lanes.length||new Set(sources.map(source=>source.id)).size!==sources.length)throw new Error('The selected audio lanes have ambiguous canonical source identities.');
  return {context,projectRate:rate,selection,selectionKey:signature(selection),indexes,bpm:p.bpm,lanes,sources,readCalls:0,sampleCount:0,active:true};
 }
 assertCurrent(captured){
  const w=this.w,e=w.engine,p=w.getProject();
  if(!captured.active||w.waveformSupported!==true||!e.ready||e.loading||e.session?.closed||signature(this.context())!==signature(captured.context)||this.projectRate()!==captured.projectRate||p.bpm!==captured.bpm||signature(w.selection)!==captured.selectionKey||signature([...w.selectedTracks].sort((a,b)=>a-b))!==signature(captured.indexes))throw changed('The project, native session, waveform capability, sample rate or selection changed during its zero-crossing read.');
  this.assertIdle();const tracks=w.tracks,canonical=new Map((p.audioClips||[]).map(clip=>[String(clip.id),clip]));
  for(const lane of captured.lanes){const actual=tracks.find(track=>track.index===lane.index);if(!actual||actual.laneId!==lane.laneId||actual.channel?.type!==lane.type||actual.clips.length!==lane.clips.length||actual.clips.some(clip=>clip.patternId))throw changed('The selected lane layout changed during its zero-crossing read.');
   for(const source of lane.clips){const current=canonical.get(String(source.clip.id));if(!current||clipId(current)!==source.id||sourceSignature(current)!==source.signature||!actual.clips.some(clip=>String(clip.id)===String(source.clip.id)))throw changed('An audio source changed during its zero-crossing read.');}
  }
 }
 async mapBounded(items,fn){
  const results=new Array(items.length);let next=0,failure=null;const workers=Array.from({length:Math.min(this.maxConcurrent,items.length)},async()=>{
   while(!failure&&next<items.length){const index=next++;try{results[index]=await fn(items[index],index);}catch(error){failure??=error;}}
  });await Promise.all(workers);if(failure)throw failure;return results;
 }
 async read(captured,input){
  this.assertCurrent(captured);if(captured.readCalls>=this.maxReadCalls)throw new Error(`This zero-crossing selection exceeded its ${this.maxReadCalls}-read client resource limit.`);captured.readCalls++;
  const fetch=createClipWaveformTransport((name,args)=>this.w.engine.session.call(name,args),{getSourceOnly:()=>this.w.waveformIndependentOfNative===true});const tile=await fetch({projectId:captured.context.projectId,...(captured.context.trackId?{trackId:captured.context.trackId}:{}),...input});this.assertCurrent(captured);const source=captured.sources.find(row=>row.id===input.clipId);if(!source)throw changed('The zero-crossing read has no captured canonical source.');return this.w.waveformView?.placement?.(source.clip,tile)??tile;
 }
 checkMetadata(source,tile){
  const w=this.w,clip=source.clip;if(tile?.clipId!==source.id||typeof tile.revision!=='string'||!tile.revision||!integer(tile.sampleRate,1)||!integer(tile.channelCount,1)||!integer(tile.frameCount)||!integer(tile.clipOffsetFrames)||!integer(tile.clipFrameCount,1)||tile.clipOffsetFrames+tile.clipFrameCount>tile.frameCount||!Number.isFinite(tile.startMs)||tile.startMs<0||!Number.isFinite(tile.gain)||tile.gain<0)throw new Error('The cloud source waveform metadata is incomplete.');
  // Native WaveClip placement and trims use nearest-sample rounding. Compare
  // those integer windows exactly: a one-frame stale trim must not pass under
  // a broad duration tolerance, while legitimate fractional-frame times remain
  // equivalent when they resolve to the same actual native source frame.
  const nativeFrame=seconds=>planZeroCrossingWindow(seconds,tile.sampleRate).centerSample;
  if(nativeFrame(tile.startMs/1000)!==nativeFrame(w.seconds(clip.start))||tile.clipFrameCount!==nativeFrame(w.seconds(clip.length))||clip.offsetKnown===true&&tile.clipOffsetFrames!==nativeFrame(w.seconds(clip.offset)))throw new Error('The cloud source waveform placement differs from the selected clip. Refresh the project.');
  return tile;
 }
 metadataEqual(a,b){return ['clipId','revision','sampleRate','channelCount','frameCount','clipOffsetFrames','clipFrameCount','startMs','gain'].every(key=>a[key]===b[key]);}
 async loadMetadata(captured){
  await this.mapBounded(captured.sources,async source=>{this.assertCurrent(captured);const known=this.w.waveformView?.metadata?.(source.clip),tile=known??await this.read(captured,{clipId:source.id,buckets:1});source.metadata=this.checkMetadata(source,tile);});this.assertCurrent(captured);
  for(const lane of captured.lanes){const first=lane.clips[0].metadata;lane.sampleRate=first.sampleRate;lane.channelCount=first.channelCount;
   if(lane.clips.some(source=>source.metadata.sampleRate!==lane.sampleRate||source.metadata.channelCount!==lane.channelCount))throw new Error('One selected lane contains different native sample rates or channel layouts. Its native waveform layout is not exposed.');
   for(const source of lane.clips){source.timelineStart=planZeroCrossingWindow(source.metadata.startMs/1000,lane.sampleRate).centerSample;source.timelineEnd=source.timelineStart+source.metadata.clipFrameCount;}
  }
 }
 async endpoint(captured,timeSec){
  const jobs=[],tracks=[];
  for(const lane of captured.lanes){
   const plan=planZeroCrossingWindow(timeSec,lane.sampleRate);captured.sampleCount+=plan.windowSize*lane.channelCount;if(captured.sampleCount>this.maxSamples)throw new Error(`This zero-crossing selection exceeded its ${this.maxSamples}-sample client resource limit.`);
   const channels=Array.from({length:lane.channelCount},()=>new Float64Array(plan.windowSize).fill(2));tracks.push(...channels.map(samples=>({sampleRate:lane.sampleRate,samples})));
   const intervals=lane.clips.map(source=>({source,start:Math.max(plan.startSample,source.timelineStart),end:Math.min(plan.endSample,source.timelineEnd)})).filter(part=>part.end>part.start).sort((a,b)=>a.start-b.start);
   for(let i=1;i<intervals.length;i++)if(intervals[i].start<intervals[i-1].end)throw new Error('The selected endpoint has overlapping audio sources. A native mixed waveform is required before choosing its zero crossing.');
   for(const part of intervals){
    for(let start=part.start;start<part.end;start+=8192){const end=Math.min(part.end,start+8192),sourceStart=part.source.metadata.clipOffsetFrames+start-part.source.timelineStart; jobs.push({lane,channels,plan,source:part.source,start,end,startFrame:sourceStart,endFrame:sourceStart+end-start});}
   }
  }
  await this.mapBounded(jobs,async job=>{
   const metadata=job.source.metadata,tile=await this.read(captured,{clipId:job.source.id,revision:metadata.revision,startFrame:job.startFrame,endFrame:job.endFrame,buckets:job.endFrame-job.startFrame});
   if(!this.metadataEqual(metadata,tile)||tile.bucketCount!==tile.endFrame-tile.startFrame)throw new Error('The source changed or the cloud reader did not return one actual PCM frame per bucket.');
   for(let channel=0;channel<job.lane.channelCount;channel++){const values=tile.channels[channel];for(let i=0;i<tile.bucketCount;i++){if(values.min[i]!==values.max[i])throw new Error('The cloud reader returned aggregate peaks instead of actual signed PCM samples.');job.channels[channel][job.start-job.plan.startSample+i]=values.min[i];}}
  });this.assertCurrent(captured);return tracks;
 }
 adjust(){
  if(this.pending)return this.pending;let captured;try{captured=this.capture();}catch(error){return Promise.reject(error);}
  const operation=Promise.resolve().then(async()=>{
   await this.loadMetadata(captured);const startTracks=await this.endpoint(captured,captured.selection.start),endTracks=captured.selection.end===captured.selection.start?undefined:await this.endpoint(captured,captured.selection.end);this.assertCurrent(captured);
   const result=selectAtZeroCrossings(captured.selection,{projectRate:captured.projectRate,startTracks,endTracks}),selection={...captured.selection,...result.selection};
   if(!Number.isFinite(selection.start)||!Number.isFinite(selection.end)||selection.start<0||selection.end<selection.start)throw new Error('The native zero-crossing result lies outside this workspace’s nonnegative time selection. The original selection was retained.');
   this.assertCurrent(captured);if(result.changed){this.w.selection=selection;this.w.paintSelection();}return {...result,selection,readCalls:captured.readCalls};
  }).finally(()=>{captured.active=false;if(this.pending===operation)this.pending=null;});this.pending=operation;return operation;
 }
}
