/**
 * waveform-pyramid.js: multi-resolution peak cache + canvas painter.
 *
 * Why: a waveform must never blank while the user scrolls, zooms, drags or
 * trims. Peaks are cached per CLIP SOURCE (not per viewport), so every repaint
 * is synchronous from memory. Finer data is fetched in the background and
 * painted over the coarser data when it lands. This module only reads and
 * draws Freestyle's peak buckets; it never decodes or plays audio.
 *
 * Data model (per clip id):
 *   overview   one read of the whole source at <= 8192 buckets
 *   tiles      level k (k = 0, 2, 4, ...) has 2^k source frames per bucket;
 *              a tile is TILE_BUCKETS buckets, fetched as a start/end range.
 *              Level 0 is one frame per bucket (sample-level zoom).
 *
 * Use:
 *   const pyramid = new WaveformPyramid({
 *     fetchPeaks: restPeaksFetcher({apiFetch: host.apiFetch, getProjectId}),
 *     onUpdate: clipId => repaintClip(clipId),   // coalesced, one per microtask
 *   });
 *   pyramid.prefetch(clipId);                    // optional: warm the overview early
 *   const result = pyramid.paint(ctx, clipId, {
 *     x, y, width, height,                       // CSS px in the ctx's current transform
 *     startSec, endSec,                          // visible SOURCE range (or startFrame/endFrame)
 *     gain, color, rmsColor,
 *   });
 *   // result.status: 'empty' (nothing cached yet: the ONLY time a placeholder
 *   // is acceptable), 'coarse' (painted from a coarser level; finer tiles are
 *   // loading and onUpdate will fire), or 'exact'.
 *
 * Rules for integrators:
 *   - Paint from scroll/zoom/drag handlers directly (or in the same rAF). Never
 *     clear a waveform because a read is pending or failed.
 *   - Draw only the visible part of a clip into a canvas sized to the visible
 *     part (canvases wider than ~16k px fail), and pass the matching source range.
 *   - Call invalidate(clipId) only when the SOURCE audio changed (sample edit,
 *     region effect). Moves, trims, gain and zoom need no invalidation.
 *   - A growing recording has no stored peaks yet: feed it with setLive().
 */
export const OVERVIEW_BUCKETS=8192;
export const TILE_BUCKETS=4096;
const LEVEL_STEP=2;
const SCALE=32767;

const isInt=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;

function quantize(values,length){
 const out=new Int16Array(length);
 for(let index=0;index<length;index++){
  const value=Number(values[index]);
  out[index]=Number.isFinite(value)?Math.max(-SCALE,Math.min(SCALE,Math.round(value*SCALE))):0;
 }
 return out;
}

/** One contiguous run of buckets: [startFrame,endFrame) split evenly into `count` buckets. */
function block(peaks){
 const count=peaks.bucketCount;
 return{
  startFrame:peaks.startFrame,endFrame:peaks.endFrame,count,
  channels:peaks.channels.map(channel=>({min:quantize(channel.min,count),max:quantize(channel.max,count),rms:quantize(channel.rms,count)})),
 };
}

/** Validate the fetcher's answer. Throws on malformed data so bad peaks are never painted. */
export function checkPeaks(peaks){
 if(!peaks||typeof peaks!=='object')throw new Error('Waveform read returned no data.');
 const {sampleRate,channelCount,frameCount,startFrame,endFrame,bucketCount,channels}=peaks;
 if(!isInt(sampleRate,1)||!isInt(channelCount,1)||!isInt(frameCount)||!isInt(startFrame)||!isInt(endFrame)||endFrame<startFrame||endFrame>frameCount||!isInt(bucketCount))throw new Error('Waveform read returned inconsistent framing.');
 if(!Array.isArray(channels)||channels.length!==channelCount||channels.some(channel=>!channel||['min','max','rms'].some(key=>!channel[key]||channel[key].length!==bucketCount)))throw new Error('Waveform read returned incomplete channel buckets.');
 if(peaks.revision==null||peaks.revision==='')throw new Error('Waveform read returned no source revision.');
 return peaks;
}

/**
 * fetchPeaks implementation on the public REST read
 * GET /api/v1/projects/{project_id}/clips/{clip_id}/waveform.
 * `apiFetch(path, init)` is the host's fetch (returns a Response).
 */
export function restPeaksFetcher({apiFetch,getProjectId,getTrackId=()=>null}){
 if(typeof apiFetch!=='function'||typeof getProjectId!=='function')throw new TypeError('restPeaksFetcher needs apiFetch and getProjectId.');
 return async function fetchPeaks({clipId,startFrame,endFrame,buckets,signal}){
  const projectId=getProjectId();
  if(!projectId)throw new Error('No project is open.');
  const query=new URLSearchParams({buckets:String(buckets)});
  if(startFrame!==undefined)query.set('start_frame',String(startFrame));
  if(endFrame!==undefined)query.set('end_frame',String(endFrame));
  const trackId=getTrackId();if(trackId)query.set('track_id',trackId);
  const response=await apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(clipId)}/waveform?${query}`,{method:'GET',signal});
  if(!response.ok){
   const error=new Error(`Waveform read failed (${response.status}).`);error.status=response.status;
   error.requestId=response.headers?.get?.('X-Request-Id')||null;throw error;
  }
  const body=await response.json(),data=body?.data??body;
  const bucketCount=data.bucket_count,start=data.start_frame??Math.min(startFrame??0,data.frame_count),end=data.end_frame??Math.min(endFrame??data.frame_count,data.frame_count);
  return checkPeaks({
   revision:data.revision??response.headers?.get?.('ETag'),
   sampleRate:data.sample_rate,channelCount:data.channel_count,frameCount:data.frame_count,
   startFrame:start,endFrame:end,bucketCount,channels:data.channels,
   placement:data.placement??data.clip??null,
  });
 };
}

export class WaveformPyramid{
 constructor({fetchPeaks,onUpdate=()=>{},maxTiles=384,concurrency=3,maxQueue=32,retryMs=1500,now=()=>Date.now()}={}){
  if(typeof fetchPeaks!=='function')throw new TypeError('WaveformPyramid needs fetchPeaks.');
  Object.assign(this,{fetchPeaks,onUpdate,maxTiles,concurrency,maxQueue,retryMs,now});
  this.clips=new Map();   // clipId -> record
  this.queue=[];          // pending jobs, newest last (served newest first)
  this.active=0;this.tileCount=0;this.useTick=0;this.pendingUpdates=new Set();this.destroyed=false;
 }

 record(clipId){
  let record=this.clips.get(clipId);
  if(!record){record={clipId,info:null,overview:null,tiles:new Map(),jobs:new Map(),live:null,epoch:0};this.clips.set(clipId,record);}
  return record;
 }
 /** {revision,sampleRate,channelCount,frameCount,placement} once the overview (or live data) is known, else null. */
 info(clipId){const record=this.clips.get(clipId);return record?.info??record?.live?.info??null;}
 has(clipId){const record=this.clips.get(clipId);return !!(record?.overview||record?.live);}

 /** Warm the whole-source overview. Safe to call repeatedly. */
 prefetch(clipId){const record=this.record(clipId);if(!record.overview)this.request(record,'overview');return this.has(clipId);}

 /**
  * Live (recording) peaks: the caller owns the growing arrays and replaces them
  * as the take grows. channels: [{min,max,rms}] of `bucketCount` buckets that
  * evenly cover [0,frameCount). Cleared by clearLive() or by invalidate().
  */
 setLive(clipId,{sampleRate,frameCount,bucketCount,channels}){
  const record=this.record(clipId),peaks=checkPeaks({revision:'live',sampleRate,channelCount:channels.length,frameCount,startFrame:0,endFrame:frameCount,bucketCount,channels});
  record.live={info:{revision:'live',sampleRate,channelCount:channels.length,frameCount,placement:null},block:block(peaks)};
  this.notify(clipId);
 }
 clearLive(clipId){const record=this.clips.get(clipId);if(record?.live){record.live=null;this.notify(clipId);}}

 /**
  * The source audio changed. Cached data stays paintable (marked stale) until
  * the new overview lands, so the clip never blanks; fine tiles are dropped.
  */
 invalidate(clipId){
  if(clipId==null){for(const id of [...this.clips.keys()])this.invalidate(id);return;}
  const record=this.clips.get(clipId);if(!record)return;
  record.epoch++;this.tileCount-=record.tiles.size;record.tiles.clear();record.jobs.clear();record.live=null;
  this.queue=this.queue.filter(job=>job.record!==record);
  if(record.overview)record.overview.stale=true;
  this.request(record,'overview');
 }
 /** Forget clips that no longer exist. */
 sync(clipIds){const keep=new Set(clipIds);for(const [id,record]of this.clips)if(!keep.has(id)){this.tileCount-=record.tiles.size;this.clips.delete(id);this.queue=this.queue.filter(job=>job.record!==record);}}
 destroy(){this.destroyed=true;this.clips.clear();this.queue.length=0;this.tileCount=0;}

 /** Tile level whose bucket is no wider than `framesPerPixel` (or null when the overview is fine enough). */
 levelFor(record,framesPerPixel){
  const info=record.info;if(!info||!record.overview)return null;
  const overviewWidth=(record.overview.endFrame-record.overview.startFrame)/Math.max(1,record.overview.count);
  if(overviewWidth<=Math.max(1,framesPerPixel))return null;
  let level=Math.max(0,Math.floor(Math.log2(Math.max(1,framesPerPixel))));level-=level%LEVEL_STEP;
  return level;
 }

 /**
  * Best cached blocks covering [startFrame,endFrame), finest first choice,
  * falling back to coarser tiles and finally the overview. Schedules reads for
  * what is missing at the wanted level. Returns {blocks, exact}.
  */
 resolve(clipId,startFrame,endFrame,framesPerPixel){
  const record=this.record(clipId);
  if(record.live)return{blocks:[{from:startFrame,to:endFrame,block:record.live.block}],exact:true,info:record.live.info};
  if(!record.overview){this.request(record,'overview');return{blocks:[],exact:false,info:null};}
  const info=record.info,from=Math.max(0,Math.floor(startFrame)),to=Math.min(info.frameCount,Math.ceil(endFrame)),blocks=[];
  let exact=!record.overview.stale;
  const want=record.overview.stale?null:this.levelFor(record,framesPerPixel);
  const overviewWidth=(record.overview.endFrame-record.overview.startFrame)/Math.max(1,record.overview.count);
  const cover=(a,b,level,wanted)=>{
   if(a>=b)return;
   if(level===null||2**level>=overviewWidth){blocks.push({from:a,to:b,block:record.overview});return;}
   const span=TILE_BUCKETS*2**level;
   for(let index=Math.floor(a/span);index*span<b;index++){
    const left=Math.max(a,index*span),right=Math.min(b,(index+1)*span),key=level+':'+index,tile=record.tiles.get(key);
    if(tile){tile.used=++this.useTick;blocks.push({from:left,to:right,block:tile});continue;}
    if(wanted){exact=false;this.request(record,key,level,index);}
    cover(left,right,level+LEVEL_STEP,false);
   }
  };
  if(from<to)cover(from,to,want,true);
  return{blocks,exact,info};
 }

 request(record,key,level,index){
  if(this.destroyed)return;
  const existing=record.jobs.get(key);
  if(existing){
   if(existing.state==='failed'&&this.now()>=existing.retryAt&&existing.attempts<4){existing.state='queued';this.queue.push(existing);this.pump();}
   else if(existing.state==='queued'){const at=this.queue.indexOf(existing);if(at>=0&&at!==this.queue.length-1){this.queue.splice(at,1);this.queue.push(existing);}}
   return;
  }
  const job={record,key,level,index,state:'queued',attempts:0,retryAt:0,epoch:record.epoch};
  record.jobs.set(key,job);this.queue.push(job);
  // The overview is never dropped; stale tile reads (scrolled past) are.
  while(this.queue.length>this.maxQueue){const at=this.queue.findIndex(item=>item.key!=='overview');if(at<0)break;const [dropped]=this.queue.splice(at,1);dropped.record.jobs.delete(dropped.key);}
  this.pump();
 }

 pump(){
  while(!this.destroyed&&this.active<this.concurrency&&this.queue.length){
   // Overviews first (they unblock first paint), then the most recently wanted tile.
   let at=this.queue.findIndex(job=>job.key==='overview');if(at<0)at=this.queue.length-1;
   const [job]=this.queue.splice(at,1);this.run(job);
  }
 }

 async run(job){
  const {record}=job;job.state='running';job.attempts++;this.active++;
  try{
   let args;
   if(job.key==='overview')args={clipId:record.clipId,buckets:OVERVIEW_BUCKETS};
   else{
    const width=2**job.level,span=TILE_BUCKETS*width,startFrame=job.index*span,endFrame=Math.min(record.info.frameCount,startFrame+span);
    args={clipId:record.clipId,startFrame,endFrame,buckets:Math.max(1,Math.ceil((endFrame-startFrame)/width))};
   }
   const peaks=checkPeaks(await this.fetchPeaks(args));
   if(this.destroyed||this.clips.get(record.clipId)!==record||job.epoch!==record.epoch)return;
   if(job.key==='overview'){
    const changed=record.info&&String(record.info.revision)!==String(peaks.revision);
    if(changed){this.tileCount-=record.tiles.size;record.tiles.clear();}
    record.info={revision:peaks.revision,sampleRate:peaks.sampleRate,channelCount:peaks.channelCount,frameCount:peaks.frameCount,placement:peaks.placement??null};
    record.overview=block(peaks);record.jobs.delete(job.key);
   }else if(String(peaks.revision)!==String(record.info.revision)){
    // The source changed under us: keep painting what we have, reload from the top.
    record.jobs.delete(job.key);this.invalidate(record.clipId);return;
   }else{
    const tile=block(peaks);tile.used=++this.useTick;
    if(!record.tiles.has(job.key))this.tileCount++;
    record.tiles.set(job.key,tile);record.jobs.delete(job.key);this.evict();
   }
   this.notify(record.clipId);
  }catch(error){
   if(job.epoch===record.epoch){job.state='failed';job.error=error;job.retryAt=this.now()+this.retryMs*job.attempts;record.lastError=error;}
  }finally{this.active--;this.pump();}
 }

 evict(){
  if(this.tileCount<=this.maxTiles)return;
  const all=[];for(const record of this.clips.values())for(const [key,tile]of record.tiles)all.push({record,key,used:tile.used});
  all.sort((a,b)=>a.used-b.used);
  for(const item of all){if(this.tileCount<=this.maxTiles*.75)break;item.record.tiles.delete(item.key);this.tileCount--;}
 }

 notify(clipId){
  if(!this.pendingUpdates.size)Promise.resolve().then(()=>{const ids=[...this.pendingUpdates];this.pendingUpdates.clear();for(const id of ids){try{this.onUpdate(id);}catch{}}});
  this.pendingUpdates.add(clipId);
 }

 /**
  * Per-pixel-column envelope for [startFrame,endFrame) at `columns` columns.
  * Returns {status, info, channels:[{min,max,rms: Float32Array(columns), known: Uint8Array}]}.
  */
 columns(clipId,{startFrame,endFrame,columns}){
  const span=endFrame-startFrame;
  if(!(span>0)||!isInt(columns,1))return{status:'empty',info:this.info(clipId),channels:[]};
  const {blocks,exact,info}=this.resolve(clipId,startFrame,endFrame,span/columns);
  if(!blocks.length||!info)return{status:'empty',info,channels:[]};
  const out=Array.from({length:info.channelCount},()=>({min:new Float32Array(columns),max:new Float32Array(columns),rms:new Float32Array(columns),known:new Uint8Array(columns)}));
  const perColumn=span/columns;
  for(const {from,to,block:data}of blocks){
   const width=(data.endFrame-data.startFrame)/Math.max(1,data.count);if(!(width>0))continue;
   const first=Math.max(0,Math.floor((from-startFrame)/perColumn)),last=Math.min(columns-1,Math.ceil((to-startFrame)/perColumn)-1);
   for(let column=first;column<=last;column++){
    const a=Math.max(from,startFrame+column*perColumn),b=Math.min(to,startFrame+(column+1)*perColumn);if(b<=a&&column!==first)continue;
    const lo=Math.max(0,Math.min(data.count-1,Math.floor((a-data.startFrame)/width))),hi=Math.max(lo,Math.min(data.count-1,Math.ceil((b-data.startFrame)/width)-1));
    for(let channel=0;channel<out.length;channel++){
     const source=data.channels[Math.min(channel,data.channels.length-1)],target=out[channel];
     let min=source.min[lo],max=source.max[lo],rms=source.rms[lo];
     for(let index=lo+1;index<=hi;index++){if(source.min[index]<min)min=source.min[index];if(source.max[index]>max)max=source.max[index];if(source.rms[index]>rms)rms=source.rms[index];}
     min/=SCALE;max/=SCALE;rms/=SCALE;
     if(target.known[column]){if(min<target.min[column])target.min[column]=min;if(max>target.max[column])target.max[column]=max;if(rms>target.rms[column])target.rms[column]=rms;}
     else{target.min[column]=min;target.max[column]=max;target.rms[column]=rms;target.known[column]=1;}
    }
   }
  }
  return{status:exact?'exact':'coarse',info,channels:out};
 }

 /**
  * Paint the visible source range into ctx. Geometry is in the ctx's current
  * user space; column density follows the ctx transform (device pixels).
  * Range: startFrame/endFrame, or startSec/endSec (needs the overview's sample rate).
  */
 paint(ctx,clipId,{x=0,y=0,width,height,startFrame,endFrame,startSec,endSec,gain=1,color='#c2cfe4',rmsColor='rgba(238,245,255,.45)',mono=false,clear=false}={}){
  const info=this.info(clipId);
  if(clear)ctx.clearRect(x,y,width,height);
  if(!info){this.prefetch(clipId);return{status:'empty',info:null};}
  if(startFrame===undefined)startFrame=(startSec??0)*info.sampleRate;
  if(endFrame===undefined)endFrame=endSec===undefined?info.frameCount:endSec*info.sampleRate;
  if(!(width>0)||!(height>0)||!(endFrame>startFrame))return{status:'empty',info};
  const scale=Math.abs(ctx.getTransform?.().a||1),columns=Math.max(1,Math.round(width*scale));
  const data=this.columns(clipId,{startFrame,endFrame,columns});
  if(data.status==='empty')return{status:'empty',info};
  const rows=mono?1:data.channels.length,rowHeight=height/rows,step=width/columns,minThickness=1/scale;
  const clamp=value=>Math.max(-1,Math.min(1,value*gain));
  const draw=(channelIndex,row,kind)=>{
   const channel=data.channels[channelIndex],center=y+(row+.5)*rowHeight,half=rowHeight*.46;
   let previousTop=null,previousBottom=null;
   for(let column=0;column<columns;column++){
    if(!channel.known[column]){previousTop=previousBottom=null;continue;}
    let top,bottom;
    if(kind==='rms'){const level=Math.min(1,Math.abs(channel.rms[column]*gain))*half;top=center-level;bottom=center+level;}
    else{
     top=center-clamp(channel.max[column])*half;bottom=center-clamp(channel.min[column])*half;
     // Join neighbouring columns so a zoomed-in wave is a continuous line.
     if(previousTop!==null){if(previousBottom<top)top=previousBottom;if(previousTop>bottom)bottom=previousTop;}
     previousTop=center-clamp(channel.max[column])*half;previousBottom=center-clamp(channel.min[column])*half;
    }
    ctx.rect(x+column*step,top,step,Math.max(minThickness,bottom-top));
   }
  };
  for(const kind of ['peak','rms']){
   if(kind==='rms'&&!rmsColor)continue;
   // RMS adds nothing once columns are narrower than a few frames.
   if(kind==='rms'&&(endFrame-startFrame)/columns<8)continue;
   ctx.beginPath();
   if(mono)for(let channel=0;channel<data.channels.length;channel++)draw(channel,0,kind);
   else for(let channel=0;channel<data.channels.length;channel++)draw(channel,channel,kind);
   ctx.fillStyle=kind==='rms'?rmsColor:color;ctx.fill();
  }
  return{status:data.status,info};
 }
}
