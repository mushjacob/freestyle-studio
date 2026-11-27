/** Read and draw Freestyle's source-PCM buckets. This module never decodes or plays audio. */
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
// MCP's generic result budget currently shortens numeric arrays beyond 100
// entries. Keep interactive reads at 64; direct complete DTOs may still carry
// the published 8192 buckets, and narrow ranges retain one frame per bucket.
export const CLIP_WAVEFORM_READ_BUCKETS=64;
const marked=value=>value===false||value===0||value===''||value==null?false:typeof value==='object'?Object.values(value).some(marked):true;
function readBuckets(value=CLIP_WAVEFORM_READ_BUCKETS){if(!integer(value,1)||value>8192)throw new RangeError('Waveform buckets must be an integer from 1 to 8192.');return Math.min(CLIP_WAVEFORM_READ_BUCKETS,value);}
function complete(value){
 if(!value||typeof value!=='object')return;
 for(const [key,child]of Object.entries(value)){
  if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&marked(child))throw new Error('Freestyle returned truncated waveform data.');
  complete(child);
 }
}
function identity(data,request){for(const [fields,expected]of [[['project_id','projectId'],request.project_id],[['clip_id','clipId'],request.clip_id]]){const values=fields.filter(key=>data?.[key]!=null).map(key=>data[key]);if(values.some(value=>typeof value!=='string'||!value)||values.some(value=>value!==values[0])||expected!==undefined&&values.some(value=>value!==expected))throw new Error('Freestyle returned a waveform for a different project or clip.');}}
function unwrap(value,request){
 if(value?.isError)throw new Error(value.structuredContent?.error||'Freestyle rejected the waveform read.');
 identity(value,request);
 let data=value?.structuredContent??value;
 if(data===value&&Array.isArray(value?.content)){
  try{data=JSON.parse(value.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{throw new Error('Freestyle returned no waveform data.');}
 }
 identity(data,request);data=data?.response??data;
 if(data?.ok===false||data?.error)throw new Error(typeof data.error==='string'?data.error:data.message||'Freestyle rejected the waveform read.');
 complete(data);return data;
}
export function clipWaveformRequest({projectId,trackId},clip,{buckets=CLIP_WAVEFORM_READ_BUCKETS,startFrame,endFrame}={}){
 const clipId=clip?.cloudId??(clip?.id==='backing'?'backing':null);
 if(typeof projectId!=='string'||!projectId||projectId.length>64||typeof clipId!=='string'||!clipId||clipId.length>64)throw new Error('A waveform read needs the cloud project and durable audio clip identity.');
 if(!integer(buckets,1)||buckets>8192)throw new RangeError('Waveform buckets must be an integer from 1 to 8192.');
 const args={project_id:projectId,clip_id:clipId,buckets};
 if(trackId){if(typeof trackId!=='string'||trackId.length>64)throw new Error('The waveform context track identity is invalid.');args.track_id=trackId;}
 for(const [key,value]of [['start_frame',startFrame],['end_frame',endFrame]])if(value!==undefined){if(!integer(value))throw new RangeError('Waveform ranges use nonnegative integer source frames.');args[key]=value;}
 if(startFrame!==undefined&&endFrame!==undefined&&endFrame<=startFrame)throw new RangeError('The waveform source-frame range must have positive length.');
 return args;
}
/** Exact documented fields; a bounded summary or missing placement is not a waveform. */
export function normalizeClipWaveform(result,request={}){
 const data=unwrap(result,request);
 if(!data||typeof data!=='object'||!integer(data.sample_rate,1)||!integer(data.channel_count,1)||!integer(data.frame_count)||!integer(data.bucket_count)||data.bucket_count>8192||!Array.isArray(data.channels)||data.channels.length!==data.channel_count)throw new Error('Freestyle returned incomplete waveform framing.');
 if(!(typeof data.revision==='string'&&data.revision||finite(data.revision)))throw new Error('Freestyle returned no waveform source revision.');
 // Authenticated production returns these fields under clip; older complete
 // DTOs expose placement or root fields. Conflicting containers are refused.
 const placement=data.placement??data.clip??data;
 if(!placement||!finite(placement.start_ms)||placement.start_ms<0||!integer(placement.audio_offset_frames)||!integer(placement.duration_frames)||!finite(placement.gain)||placement.gain<0)throw new Error('Freestyle returned incomplete waveform placement.');
 for(const container of [data.placement,data.clip])if(container&&['start_ms','audio_offset_frames','duration_frames','gain'].some(key=>container[key]!==placement[key]))throw new Error('Freestyle returned conflicting waveform placements.');
 identity(data,request);
 const start=data.start_frame??Math.min(request.start_frame??0,data.frame_count),end=data.end_frame??Math.min(request.end_frame??data.frame_count,data.frame_count);
 if(!integer(start)||!integer(end)||start>end||end>data.frame_count||data.bucket_count!==Math.min(request.buckets??data.bucket_count,end-start))throw new Error('Freestyle returned inconsistent waveform source-frame bounds.');
 if(request.start_frame!==undefined&&start!==Math.min(request.start_frame,data.frame_count)||request.end_frame!==undefined&&end!==Math.min(request.end_frame,data.frame_count))throw new Error('Freestyle returned a different waveform source-frame range.');
 const channels=data.channels.map(channel=>{
  if(!channel||!['min','max','rms'].every(key=>Array.isArray(channel[key])&&channel[key].length===data.bucket_count))throw new Error('Freestyle returned incomplete waveform channel buckets.');
  for(let index=0;index<data.bucket_count;index++){
   const min=channel.min[index],max=channel.max[index],rms=channel.rms[index];
   if(![min,max,rms].every(finite)||min < -1||max>1||min>max||rms<0||rms>1)throw new Error('Freestyle returned invalid signed PCM waveform buckets.');
  }
  return{min:[...channel.min],max:[...channel.max],rms:[...channel.rms]};
 });
 return{sampleRate:data.sample_rate,channelCount:data.channel_count,frameCount:data.frame_count,bucketCount:data.bucket_count,startFrame:start,endFrame:end,revision:data.revision,placement:{startMs:placement.start_ms,audioOffsetFrames:placement.audio_offset_frames,durationFrames:placement.duration_frames,gain:placement.gain},channels};
}
/** The raw take without its timeline position or save timestamps: equal only for a pure move. */
const POSITION_FIELDS=new Set(['startMs','start_ms','startSec','start_sec','laneId','lane_id','trackId','track_id','mozart_track_id','updatedAt','updated_at','revision','etag']);
function rawShape(clip){const raw=clip.cloudRaw;if(!raw||typeof raw!=='object')return JSON.stringify(raw??null);return JSON.stringify(Object.fromEntries(Object.entries(raw).filter(([key])=>!POSITION_FIELDS.has(key))));}
function clipVersion(clip){return JSON.stringify([clip.cloudId,clip.start,clip.length,clip.offset,clip.offsetKnown,clip.volume,clip.cloudRaw??null]);}
function scope(context){return JSON.stringify([context.projectId,context.trackId??'',context.version??0]);}
/** QA r8: a read sent while an Undo's write is still running returns the
 * previously saved window. True when the read's placement differs from the
 * clip's saved geometry (only checked where the clip carries it). */
export function waveformGeometryDiffers(clip,waveform){
 const raw=clip?.cloudRaw,placement=waveform?.placement,rate=waveform?.sampleRate;if(!raw||typeof raw!=='object'||!placement||!finite(rate)||rate<=0)return false;
 const offset=[raw.audioOffsetSec,raw.effects?.timing?.audioOffsetSec].find(finite);
 if(finite(raw.startMs)&&finite(placement.startMs)&&Math.abs(raw.startMs-placement.startMs)>1)return true;
 if(finite(raw.durationSec)&&finite(placement.durationFrames)&&Math.abs(raw.durationSec*rate-placement.durationFrames)>2)return true;
 return finite(offset)&&finite(placement.audioOffsetFrames)&&Math.abs(offset*rate-placement.audioOffsetFrames)>2;
}
const GEOMETRY_REREADS=3;
/** Reads are deduplicated and scoped. Failures stay explicit until invalidate/retry. */
export class ClipWaveformController{
 constructor({call,getContext,onChange=()=>{}}={}){if(typeof call!=='function'||typeof getContext!=='function')throw new TypeError('ClipWaveformController needs call and getContext.');Object.assign(this,{call,getContext,onChange});this.records=new Map();this.sources=new Map();this.shapes=new Map();this.rereads=new Map();this.generation=0;this.destroyed=false;this.readQueue=Promise.resolve();}
 sourceKey(clip){return JSON.stringify([scope(this.getContext()),clipVersion(clip)]);}
 key(clip,options={}){return JSON.stringify([this.sourceKey(clip),readBuckets(options.buckets),options.startFrame,options.endFrame,options.clipStartSec,options.clipEndSec]);}
 peek(clip,options={}){return this.records.get(this.key(clip,options))?.state??{status:'idle',waveform:null,error:null};}
 /** A move changes only a region's timeline position: the same source window, gain and visible
  * clip-relative range draw identically. The last ready drawing for that shape bridges the moved
  * region until its own (exact, unconditional) read lands, so it never flashes "loading". */
 shapeKey(clip,options={}){return JSON.stringify([scope(this.getContext()),clip.cloudId,clip.length,clip.offset,clip.offsetKnown,clip.volume,readBuckets(options.buckets),options.startFrame,options.endFrame,options.clipStartSec,options.clipEndSec]);}
 peekMoved(clip,options={}){const entry=this.shapes.get(this.shapeKey(clip,options));if(!entry||entry.raw!==rawShape(clip)||entry.start===clip.start&&entry.track===clip.track)return null;return{status:'ready',waveform:entry.waveform,error:null,provisional:true};}
 load(clip,options={}){
  if(this.destroyed)return Promise.reject(new Error('The waveform reader is closed.'));
  for(const value of [options.clipStartSec,options.clipEndSec])if(value!==undefined&&(!finite(value)||value<0))throw new RangeError('The visible clip window must use nonnegative seconds.');
  if(options.clipStartSec!==undefined&&options.clipEndSec!==undefined&&options.clipEndSec<=options.clipStartSec)throw new RangeError('The visible clip window must have positive length.');
  const context={...this.getContext()},request=clipWaveformRequest(context,clip,{...options,buckets:readBuckets(options.buckets)}),key=this.key(clip,options),sourceKey=this.sourceKey(clip),existing=this.records.get(key);
  if(existing&&!options.force)return existing.promise;
  const generation=this.generation,record={clipId:request.clip_id,sourceKey,state:{status:'loading',waveform:null,error:null}};
  const siblings=[...this.records].filter(([,value])=>value.sourceKey===sourceKey);for(const [oldKey]of siblings.slice(0,Math.max(0,siblings.length-5)))this.records.delete(oldKey);
  this.records.set(key,record);
  const current=()=>!this.destroyed&&generation===this.generation&&scope(context)===scope(this.getContext())&&this.records.get(key)===record;
  // Background waveform work must leave upstream GET capacity for user actions.
  // Keep metadata + range together; queued stale jobs skip before any dispatch.
  record.promise=this.readQueue.then(async()=>{
   if(!current())return{status:'stale',waveform:null,error:null};
   let waveform=options.force?null:this.sources.get(sourceKey)?.waveform;
   if(!waveform||options.startFrame!==undefined||options.endFrame!==undefined)waveform=normalizeClipWaveform(await this.call('get_clip_waveform',request),request);
   if(!current())return{status:'stale',waveform:null,error:null};
   // The saved geometry changed while this read was in flight: drop it and re-request (bounded).
   if(waveformGeometryDiffers(clip,waveform)){const count=(this.rereads.get(key)||0)+1;if(count<=GEOMETRY_REREADS){this.rereads.set(key,count);while(this.rereads.size>256)this.rereads.delete(this.rereads.keys().next().value);this.records.delete(key);this.sources.delete(sourceKey);queueMicrotask(()=>{try{this.onChange(request.clip_id,{status:'idle',waveform:null,error:null,reread:count});}catch{}});return{status:'stale',waveform:null,error:null,reread:count};}}
   else this.rereads.delete(key);
   // The first read obtains authoritative frame metadata. Then fetch only the
   // audible source window at the requested resolution, rather than stretching
   // a whole-file thumbnail over a trimmed clip.
   if(options.startFrame===undefined&&options.endFrame===undefined){
    const offset=waveform.placement.audioOffsetFrames,clipEnd=Math.min(waveform.frameCount,offset+waveform.placement.durationFrames),start=Math.min(clipEnd,offset+Math.floor((options.clipStartSec??0)*waveform.sampleRate)),end=Math.min(clipEnd,options.clipEndSec===undefined?clipEnd:offset+Math.ceil(options.clipEndSec*waveform.sampleRate));
    if(start<end&&(start!==waveform.startFrame||end!==waveform.endFrame||waveform.bucketCount!==Math.min(request.buckets,end-start))){
     const rangeRequest={...request,start_frame:start,end_frame:end};
     const next=normalizeClipWaveform(await this.call('get_clip_waveform',rangeRequest),rangeRequest);
     if(!current())return{status:'stale',waveform:null,error:null};
     if(next.revision!==waveform.revision||JSON.stringify(next.placement)!==JSON.stringify(waveform.placement))throw new Error('The waveform source or placement changed during its range read. Reload the clip waveform.');
     waveform=next;
    }
   }
   if(!current())return{status:'stale',waveform:null,error:null};
   this.sources.set(sourceKey,{clipId:request.clip_id,waveform});record.state={status:'ready',waveform,error:null};{const shape=this.shapeKey(clip,options);this.shapes.delete(shape);this.shapes.set(shape,{waveform,start:clip.start,track:clip.track,raw:rawShape(clip)});while(this.shapes.size>64)this.shapes.delete(this.shapes.keys().next().value);}this.onChange(request.clip_id,record.state);return record.state;
  }).catch(error=>{
   if(!current())return{status:'stale',waveform:null,error:null};
   record.state={status:'error',waveform:null,error:error.message};this.onChange(request.clip_id,record.state);return record.state;
  });
  // Invalidation keeps this chain: an already-dispatched read still owns its
  // slot until it settles. Even a throwing observer must not freeze later jobs.
  this.readQueue=record.promise.then(()=>undefined,()=>undefined);return record.promise;
 }
 sync(clips){const keys=new Set(clips.map(clip=>this.sourceKey(clip)));for(const [key,record]of this.records)if(!keys.has(record.sourceKey))this.records.delete(key);for(const key of this.sources.keys())if(!keys.has(key))this.sources.delete(key);}
 invalidate(clipId){if(clipId==null){this.generation++;this.records.clear();this.sources.clear();this.shapes.clear();return;}for(const key of [...this.shapes.keys()])if(JSON.parse(key)[1]===clipId)this.shapes.delete(key);for(const [key,record]of this.records)if(record.clipId===clipId)this.records.delete(key);for(const [key,record]of this.sources)if(record.clipId===clipId)this.sources.delete(key);}
 /** In-place sample edits keep the clip's geometry, so the cache key cannot tell
  * source versions apart. Remember this clip's ready waveforms by their source
  * revision (at most 4 per clip) so an Undo can show the older one at once. */
 rememberRevision(clipId){
  const saved=this.revisionCache||(this.revisionCache=new Map()),byRevision=saved.get(clipId)||new Map();
  for(const [key,record]of this.records){const waveform=record.state?.waveform;if(record.clipId!==clipId||record.state?.status!=='ready'||!waveform?.revision)continue;const entry=byRevision.get(waveform.revision)||{records:new Map(),sources:new Map()};entry.records.set(key,{sourceKey:record.sourceKey,state:record.state});byRevision.delete(waveform.revision);byRevision.set(waveform.revision,entry);}
  for(const [key,source]of this.sources){if(source.clipId!==clipId||!source.waveform?.revision)continue;const entry=byRevision.get(source.waveform.revision)||{records:new Map(),sources:new Map()};entry.sources.set(key,source);if(!byRevision.has(source.waveform.revision))byRevision.set(source.waveform.revision,entry);}
  while(byRevision.size>4)byRevision.delete(byRevision.keys().next().value);
  if(byRevision.size)saved.set(clipId,byRevision);return [...byRevision.keys()];
 }
 /** Show `revision` for this clip now: true when it was remembered (painted from
  * memory), else the clip's cache is dropped so the next render reads it. */
 showRevision(clipId,revision){
  const entry=this.revisionCache?.get(clipId)?.get(revision);this.invalidate(clipId);if(!entry)return false;
  for(const [key,value]of entry.records)this.records.set(key,{clipId,sourceKey:value.sourceKey,state:value.state,promise:Promise.resolve(value.state)});
  for(const [key,value]of entry.sources)this.sources.set(key,value);
  try{this.onChange(clipId,[...entry.records.values()][0]?.state??{status:'ready'});}catch{}return entry.records.size>0;
 }
 destroy(){this.destroyed=true;this.invalidate();}
}
/** Bucket positions are source frames; each channel retains its own signed envelope. */
export function clipWaveformSvg(waveform,{width=200,height=42,startFrame=waveform?.placement.audioOffsetFrames,endFrame=startFrame+(waveform?.placement.durationFrames??0),gain=waveform?.placement.gain}={}){
 if(!waveform||!finite(width)||width<=0||!finite(height)||height<=0||!integer(startFrame)||!integer(endFrame)||endFrame<=startFrame||!finite(gain)||gain<0)return'';
 const sourceSpan=waveform.endFrame-waveform.startFrame,visible=endFrame-startFrame,rowHeight=height/waveform.channelCount,half=rowHeight*.43,paths=[];
 const number=value=>Number(value.toFixed(4));
 for(let channel=0;channel<waveform.channelCount;channel++){
  const center=(channel+.5)*rowHeight,values=waveform.channels[channel];let envelope='',rms='';
  for(let index=0;index<waveform.bucketCount;index++){
   const left=waveform.startFrame+Math.floor(index*sourceSpan/waveform.bucketCount),right=waveform.startFrame+Math.floor((index+1)*sourceSpan/waveform.bucketCount);
   if(right<=startFrame||left>=endFrame)continue;
   const x=number(((Math.max(left,startFrame)+Math.min(right,endFrame))/2-startFrame)/visible*width),top=number(center-clamp(values.max[index]*gain,-1,1)*half),bottom=number(center-clamp(values.min[index]*gain,-1,1)*half),level=clamp(values.rms[index]*gain,0,1)*half;
   envelope+=`M${x} ${top}V${bottom}`;rms+=`M${x} ${number(center-level)}V${number(center+level)}`;
  }
  const bucketWidth=width*sourceSpan/visible/Math.max(1,waveform.bucketCount);
  paths.push(`<path data-waveform-channel="${channel}" d="${envelope}" stroke="#c2cfe4" stroke-width="${number(Math.max(.6,bucketWidth))}" fill="none"/><path data-waveform-rms="${channel}" d="${rms}" stroke="#eef5ff" stroke-opacity=".45" stroke-width=".6" fill="none"/>`);
 }
 return`<svg data-cloud-waveform="true" data-waveform-revision="${String(waveform.revision).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${paths.join('')}</svg>`;
}
