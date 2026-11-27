/** Freestyle source-frame waveform reads. No audio is decoded or generated. */
const finite=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`${label} must be finite.`);return value;};
const integer=(value,label,min=0)=>{finite(value,label);if(!Number.isSafeInteger(value)||value<min)throw new RangeError(`${label} must be a safe integer ≥ ${min}.`);return value;};
const identity=(value,label)=>{if(typeof value!=='string'||!value.length||value.length>64)throw new TypeError(`${label} must be a nonempty opaque string of at most 64 characters.`);return value;};
const revisionId=value=>{if(typeof value==='string'&&value.length)return value;if(typeof value==='number'&&Number.isFinite(value))return String(value);throw new TypeError('Freestyle returned no waveform source revision.');};
const abortError=()=>Object.assign(new Error('The waveform request no longer belongs to the current project or clip revision.'),{name:'AbortError'});
/** A failed read may be replayed only for a concrete transient transport
 * failure. Geometry, source conflicts and malformed numeric data never retry. */
export function isTransientWaveformReadError(error){
 if(!error||error.name==='AbortError')return false;
 let result=error.result?.structuredContent??error.result;
 if(Array.isArray(result?.content)){try{result=JSON.parse(result.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{return false;}}
 const body=result?.response??result,codes=[error.code,body?.code,body?.error?.code],stages=[error.stage,body?.stage];
 if(codes.some(code=>typeof code==='string'&&(/revision|conflict|malformed|truncat|invalid|format|schema/.test(code)))||stages.some(stage=>['validation','schema','input'].includes(stage)))return false;
 const statuses=[error.status,error.upstreamStatus,body?.upstreamStatus,body?.upstream_status,body?.error?.upstreamStatus];
 if(statuses.some(status=>[502,503,504].includes(Number(status))))return true;
 if(codes.some(code=>['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','ERR_NETWORK','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(code)))return true;
 // These are the browser Fetch API's typed network failures, not arbitrary
 // application errors whose wording happens to mention an HTTP status.
 return error.name==='NetworkError'||error.name==='TypeError'&&['Failed to fetch','NetworkError when attempting to fetch resource.','Load failed'].includes(error.message);
}
function waveformRetryDelay(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted){reject(abortError());return;}let timer;const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(abortError());};timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});}

/** Visible source frames; exclusive end. At sample zoom, request one actual
 * source frame per bucket. Bucket boundaries follow the published proportional
 * floor rule, rather than an assumed fixed frames-per-bucket size. */
export function planWaveformWindow({clipStartSec,clipOffsetFrames,clipFrameCount,sourceFrameCount,sampleRate,leftSec,width,pixelsPerSecond,maxBuckets=8192}={}){
 finite(clipStartSec,'Clip start');finite(leftSec,'Viewport start');finite(width,'Viewport width');finite(pixelsPerSecond,'Timeline scale');integer(sampleRate,'Sample rate',1);integer(clipOffsetFrames,'Clip source offset');integer(clipFrameCount,'Clip frame count');integer(sourceFrameCount,'Source frame count');integer(maxBuckets,'Bucket limit',1);
 if(clipStartSec<0||leftSec<0||width<=0||pixelsPerSecond<=0||maxBuckets>8192)throw new RangeError('Choose valid nonnegative times, positive viewport dimensions and at most 8192 buckets.');
 if(clipOffsetFrames+clipFrameCount>sourceFrameCount)throw new RangeError('The clip window exceeds its source frame count.');
 const relativeStart=leftSec-clipStartSec,relativeEnd=relativeStart+width/pixelsPerSecond;
 const localStart=Math.max(0,Math.min(clipFrameCount,Math.floor(relativeStart*sampleRate))),localEnd=Math.max(0,Math.min(clipFrameCount,Math.ceil(relativeEnd*sampleRate)));
 if(localEnd<=localStart)return null;
 const span=localEnd-localStart,buckets=Math.max(1,Math.min(maxBuckets,Math.ceil(width),span));
 return {startFrame:clipOffsetFrames+localStart,endFrame:clipOffsetFrames+localEnd,buckets,bucketCount:buckets};
}
function requestShape(input){
 const result={clipId:identity(input?.clipId,'Clip identity'),buckets:integer(input.buckets??1024,'Waveform buckets',1)};if(result.buckets>8192)throw new RangeError('Waveform buckets cannot exceed 8192.');
 if(input.revision!==undefined)result.revision=revisionId(input.revision);if(input.trackId!==undefined)result.trackId=identity(input.trackId,'Context track identity');
 for(const key of ['startFrame','endFrame'])if(input[key]!==undefined)result[key]=integer(input[key],key);
 if(result.startFrame!==undefined&&result.endFrame!==undefined&&result.endFrame<=result.startFrame)throw new RangeError('A waveform source range must be nonempty.');return result;
}
export function clipWaveformRequest(input){
 const projectId=identity(input?.projectId,'Project identity'),request=requestShape(input),args={project_id:projectId,clip_id:request.clipId,buckets:request.buckets};
 if(request.trackId!==undefined)args.track_id=request.trackId;if(request.startFrame!==undefined)args.start_frame=request.startFrame;if(request.endFrame!==undefined)args.end_frame=request.endFrame;return args;
}
function complete(value,seen=new WeakSet()){
 if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);
 for(const [key,child]of Object.entries(value)){
  if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&child!==false&&child!==0&&child!==''&&child!=null)throw new Error('Freestyle returned truncated waveform data.');complete(child,seen);
 }
}
function unwrap(value){
 let data=value?.structuredContent??value;
 if(data===value&&Array.isArray(value?.content)){try{data=JSON.parse(value.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{throw new Error('Freestyle returned no waveform data.');}}
 data=data?.response??data;if(value?.isError||data?.ok===false||data?.error){const error=new Error(typeof data?.error==='string'?data.error:data?.message||'Freestyle rejected the waveform read.');error.result=value?.structuredContent??value;for(const key of ['code','stage','upstreamStatus','status'])if(data?.[key]!==undefined)error[key]=data[key];throw error;}complete(data);return data;
}
/** Normalize only published fields. The documented placement fields are kept
 * together in the live clip record, the earlier placement record, or at the response root. No source
 * URL, PCM, or undocumented offset aliases are guessed. */
export function normalizeClipWaveform(value,input){
 const request=requestShape(input),data=unwrap(value);if(!data||typeof data!=='object')throw new Error('Freestyle returned no waveform data.');
 if(data.project_id!==undefined&&data.project_id!==input.projectId||data.projectId!==undefined&&data.projectId!==input.projectId||data.clip_id!==undefined&&data.clip_id!==request.clipId)throw new Error('Freestyle returned a waveform for a different project or clip.');
 const placement=data.clip??data.placement??data,frameCount=integer(data.frame_count,'Source frame count');
 const startFrame=data.start_frame??Math.min(request.startFrame??0,frameCount),endFrame=data.end_frame??Math.min(request.endFrame??frameCount,frameCount);
 return validateWaveformTile({clipId:request.clipId,revision:revisionId(data.revision),sampleRate:data.sample_rate,channelCount:data.channel_count,frameCount,bucketCount:data.bucket_count,startFrame,endFrame,startMs:placement?.start_ms,clipOffsetFrames:placement?.audio_offset_frames,clipFrameCount:placement?.duration_frames,gain:placement?.gain,channels:data.channels?.map((channel,index)=>({channel:index,min:channel.min,max:channel.max,rms:channel.rms}))},request);
}
/** Legacy MCP responses budget arrays at100 values. Studio API v1 explicitly
 * advertises full reads up to8192; the caller must opt into that live contract. */
export const WAVEFORM_READ_BUCKET_LIMIT=100;
export function planWaveformReads({startFrame,endFrame,buckets},limit=WAVEFORM_READ_BUCKET_LIMIT){
 integer(startFrame,'First frame');integer(endFrame,'End frame');integer(buckets,'Waveform buckets',1);integer(limit,'Read bucket limit',1);if(endFrame<=startFrame||limit>8192)throw new RangeError('Choose a nonempty source interval and1–8192 buckets per read.');
 const span=endFrame-startFrame,count=Math.min(buckets,span),reads=[];
 for(let first=0;first<count;first+=limit){const last=Math.min(count,first+limit);reads.push({startFrame:startFrame+Math.floor(first*span/count),endFrame:startFrame+Math.floor(last*span/count),buckets:last-first});}return reads;
}
/* Freestyle 328 retries a cold waveform read once server-side: one client retry is enough. */
export function createClipWaveformTransport(call,{maxConcurrent=2,maxAttempts=2,retryDelaysMs=[250,750],retryDelay=waveformRetryDelay,readBucketLimit=WAVEFORM_READ_BUCKET_LIMIT,getReadBucketLimit=()=>readBucketLimit,getSourceOnly=()=>false}={}){
 if(typeof call!=='function')throw new TypeError('Provide a cloud tool caller.');integer(readBucketLimit,'Waveform read bucket limit',WAVEFORM_READ_BUCKET_LIMIT);if(readBucketLimit>8192||typeof getReadBucketLimit!=='function'||typeof getSourceOnly!=='function')throw new RangeError('Waveform read limits need an explicit100–8192 bucket contract.');integer(maxConcurrent,'Concurrent waveform reads',1);if(maxConcurrent>2)throw new RangeError('At most two waveform reads may run concurrently.');
 integer(maxAttempts,'Waveform read attempts',1);if(maxAttempts>3||typeof retryDelay!=='function'||!Array.isArray(retryDelaysMs)||retryDelaysMs.length<maxAttempts-1||retryDelaysMs.some(ms=>typeof ms!=='number'||!Number.isFinite(ms)||ms<0||ms>2000))throw new RangeError('Waveform retries allow at most three attempts with 0–2000 ms backoffs.');
 const check=input=>{if(input.signal?.aborted||typeof input.isCurrent==='function'&&!input.isCurrent())throw abortError();};
 const perform=async input=>{for(let attempt=0;attempt<maxAttempts;attempt++){check(input);try{const raw=await call('get_clip_waveform',clipWaveformRequest(input),input);check(input);return normalizeClipWaveform(raw,input);}catch(error){check(input);if(attempt+1===maxAttempts||!isTransientWaveformReadError(error))throw error;await retryDelay(retryDelaysMs[attempt],input.signal);}}};
 let active=0;const queue=[];
 const drain=()=>{while(active<maxConcurrent&&queue.length){const job=queue.shift();if(job.input.signal?.aborted){job.reject(abortError());continue;}active++;Promise.resolve().then(()=>perform(job.input)).then(job.resolve,job.reject).finally(()=>{active--;drain();});}};
 const read=input=>new Promise((resolve,reject)=>{queue.push({input,resolve,reject});drain();});
 return async input=>{
  if(input.signal?.aborted)throw abortError();const sourceOnly=getSourceOnly()===true,request=requestShape(input),limit=integer(getReadBucketLimit(),'Waveform read bucket limit',WAVEFORM_READ_BUCKET_LIMIT);if(limit>8192)throw new RangeError('Waveform read limits cannot exceed8192 buckets.');if(request.buckets<=limit)return read(input);
  let metadata=null,startFrame=request.startFrame,endFrame=request.endFrame;
  if(startFrame===undefined||endFrame===undefined){metadata=await read({...input,buckets:1});startFrame??=metadata.startFrame;endFrame??=metadata.endFrame;}
  const reads=planWaveformReads({startFrame,endFrame,buckets:request.buckets},limit),controller=new AbortController(),cancel=()=>controller.abort();input.signal?.addEventListener('abort',cancel,{once:true});if(input.signal?.aborted)cancel();let chunks;
  try{chunks=await Promise.all(reads.map(part=>read({...input,...part,signal:controller.signal,...(metadata?{revision:metadata.revision}:{})})));}catch(error){controller.abort();throw error;}finally{input.signal?.removeEventListener('abort',cancel);}
  if(input.signal?.aborted)throw abortError();const first=chunks[0],keys=['clipId','revision','sampleRate','frameCount','channelCount',...(sourceOnly?[]:['startMs']),'clipOffsetFrames','clipFrameCount','gain'];
  if(chunks.some(chunk=>keys.some(key=>chunk[key]!==first[key]))||metadata&&keys.some(key=>first[key]!==metadata[key]))throw new Error('The waveform source or placement changed between bounded reads.');
  const boundaries=[first.startFrame],channels=Array.from({length:first.channelCount},(_,channel)=>({channel,min:[],max:[],rms:[]}));
  for(const chunk of chunks){const span=chunk.endFrame-chunk.startFrame;for(let index=1;index<=chunk.bucketCount;index++)boundaries.push(chunk.startFrame+Math.floor(index*span/chunk.bucketCount));for(let channel=0;channel<channels.length;channel++)for(const key of ['min','max','rms'])channels[channel][key].push(...chunk.channels[channel][key]);}
  // A child read has its own exact proportional-floor grid. Keep those actual
  // frame boundaries; concatenating coarse arrays under a fictitious uniform
  // global grid would shift some measured buckets by a source frame.
  return validateWaveformTile({...first,startFrame,endFrame,bucketCount:boundaries.length-1,bucketBoundaries:boundaries,channels},request);
 };
}

/** Each channel contains engine supplied signed PCM min/max and RMS buckets,
 * pre clip-gain/effects. Copies become immutable before entering the cache. */
export function validateWaveformTile(input,request){
 const expected=requestShape(request);if(!input||typeof input!=='object')throw new TypeError('Freestyle returned no waveform tile.');
 if(input.clipId!==expected.clipId)throw new Error('The waveform clip identity does not match its requested source.');const revision=revisionId(input.revision);if(expected.revision!==undefined&&revision!==expected.revision)throw new Error('The waveform source revision changed. Reload its metadata.');
 const sampleRate=integer(input.sampleRate,'Sample rate',1),frameCount=integer(input.frameCount,'Source frame count'),channelCount=integer(input.channelCount,'Channel count',1),startFrame=integer(input.startFrame,'First frame'),endFrame=integer(input.endFrame,'End frame'),bucketCount=integer(input.bucketCount,'Bucket count'),startMs=finite(input.startMs,'Clip placement'),clipOffsetFrames=integer(input.clipOffsetFrames,'Clip source offset'),clipFrameCount=integer(input.clipFrameCount,'Clip frame count'),gain=finite(input.gain,'Clip gain');
 if(startMs<0||gain<0||startFrame>endFrame||endFrame>frameCount||clipOffsetFrames+clipFrameCount>frameCount)throw new RangeError('Waveform framing or placement exceeds the source.');
 if(startFrame!==Math.min(expected.startFrame??0,frameCount)||endFrame!==Math.min(expected.endFrame??frameCount,frameCount)||bucketCount!==Math.min(expected.buckets,endFrame-startFrame)||bucketCount>8192)throw new Error('The waveform source range or bucket detail differs from the request.');
 if(!Array.isArray(input.channels)||input.channels.length!==channelCount)throw new TypeError('Waveform data needs complete channel buckets.');
 let bucketBoundaries;if(input.bucketBoundaries!==undefined){const values=input.bucketBoundaries;if(!Array.isArray(values)||values.length!==bucketCount+1||values[0]!==startFrame||values.at(-1)!==endFrame||values.some((value,index)=>!Number.isSafeInteger(value)||index>0&&value<=values[index-1]))throw new Error('Waveform bucket boundaries must exactly cover their measured source frames.');bucketBoundaries=Object.freeze([...values]);}
 const channels=input.channels.map((raw,channel)=>{
  if(raw?.channel!==channel)throw new Error('Waveform channel indexes must follow source channel order.');const copy={channel};
  for(const key of ['min','max','rms']){const values=raw[key];if(!Array.isArray(values)||values.length!==bucketCount)throw new Error(`Waveform ${key} bucket count does not match its source range.`);copy[key]=Object.freeze(values.map(value=>finite(value,`Waveform ${key}`)));}
  for(let index=0;index<bucketCount;index++)if(copy.min[index]<-1||copy.max[index]>1||copy.min[index]>copy.max[index]||copy.rms[index]<0||copy.rms[index]>1)throw new RangeError('Waveform buckets must contain actual signed PCM min/max and nonnegative RMS in [-1,1].');return Object.freeze(copy);
 });
 return Object.freeze({clipId:expected.clipId,revision,sampleRate,frameCount,channelCount,startFrame,endFrame,bucketCount,startMs,clipOffsetFrames,clipFrameCount,gain,channels:Object.freeze(channels),...(bucketBoundaries?{bucketBoundaries}:{})});
}
/** Coverage is conservative: no coarse thumbnail can stand in for fine PCM.
 * Exact ranges/bucket counts are used by the UI; this helper permits a finer
 * containing tile only if every source bucket is no wider than requested. */
export function waveformTileCovers(tile,request){
 const span=request.endFrame-request.startFrame,count=Math.min(request.buckets,span),maxFrames=count>0?Math.ceil(span/count):0;
 return !!tile&&tile.clipId===request.clipId&&(request.revision===undefined||tile.revision===String(request.revision))&&tile.startFrame<=request.startFrame&&tile.endFrame>=request.endFrame&&tile.bucketCount>0&&(tile.bucketBoundaries?tile.bucketBoundaries.slice(1).every((frame,index)=>frame-tile.bucketBoundaries[index]<=maxFrames):Math.ceil((tile.endFrame-tile.startFrame)/tile.bucketCount)<=maxFrames);
}
export function waveformBucket(tile,channel,index){
 integer(index,'Bucket index');const values=tile?.channels?.[channel];if(!values||index>=tile.bucketCount)return null;const span=tile.endFrame-tile.startFrame;
 return {startFrame:tile.bucketBoundaries?.[index]??tile.startFrame+Math.floor(index*span/tile.bucketCount),endFrame:tile.bucketBoundaries?.[index+1]??tile.startFrame+Math.floor((index+1)*span/tile.bucketCount),min:values.min[index],max:values.max[index],rms:values.rms[index]};
}
export class WaveformTiles{
 constructor({fetchWaveform,maxCacheEntries=64}={}){if(typeof fetchWaveform!=='function')throw new TypeError('Provide a cloud waveform transport adapter.');integer(maxCacheEntries,'Cache size',1);Object.assign(this,{fetchWaveform,maxCacheEntries});this.cache=new Map();this.pending=new Map();this.revisions=new Map();this.generation=0;this.projectId=null;}
 setProject(projectId){identity(projectId,'Project identity');if(this.projectId===projectId)return;this.generation++;this.projectId=projectId;for(const entry of this.pending.values())entry.controller.abort();this.pending.clear();this.revisions.clear();this.cache.clear();}
 invalidateClip(clipId,revision){identity(clipId,'Clip identity');if(revision!==undefined)revision=revisionId(revision);for(const [key,entry]of this.pending)if(entry.request.clipId===clipId&&(revision===undefined||entry.request.revision!==revision)){entry.controller.abort();this.pending.delete(key);}for(const [key,tile]of this.cache)if(tile.clipId===clipId&&(revision===undefined||tile.revision!==revision))this.cache.delete(key);if(revision===undefined)this.revisions.delete(clipId);else this.revisions.set(clipId,revision);}
 cancelRanges(clipId){identity(clipId,'Clip identity');for(const [key,entry]of this.pending)if(entry.request.clipId===clipId&&(entry.request.startFrame!==undefined||entry.request.endFrame!==undefined)){entry.controller.abort();this.pending.delete(key);}}
 request(input){
  if(!this.projectId)return Promise.reject(new Error('Select the cloud project before reading waveforms.'));let request;try{request=requestShape(input);}catch(error){return Promise.reject(error);}
  if(request.revision!==undefined&&this.revisions.get(request.clipId)!==request.revision)this.invalidateClip(request.clipId,request.revision);
  const projectId=this.projectId,generation=this.generation,key=JSON.stringify([projectId,request.trackId??null,request.clipId,request.revision??null,request.startFrame??null,request.endFrame??null,request.buckets]);
  const cached=this.cache.get(key);if(cached){this.cache.delete(key);this.cache.set(key,cached);return Promise.resolve(cached);}if(this.pending.has(key))return this.pending.get(key).promise;
  const controller=new AbortController(),entry={request,controller,promise:null},current=()=>this.projectId===projectId&&this.generation===generation&&(request.revision===undefined||this.revisions.get(request.clipId)===request.revision)&&!controller.signal.aborted;
  let onAbort;const aborted=new Promise((_,reject)=>{onAbort=()=>reject(abortError());controller.signal.addEventListener('abort',onAbort,{once:true});});
  const fetched=Promise.resolve().then(()=>{if(!current())throw abortError();return this.fetchWaveform({projectId,...request,signal:controller.signal});});
  entry.promise=Promise.race([fetched,aborted]).then(raw=>{if(!current())throw abortError();const tile=validateWaveformTile(raw,request);this.revisions.set(request.clipId,tile.revision);this.cache.set(key,tile);while(this.cache.size>this.maxCacheEntries)this.cache.delete(this.cache.keys().next().value);return tile;}).catch(error=>{if(!current())throw abortError();throw error;}).finally(()=>{controller.signal.removeEventListener('abort',onAbort);if(this.pending.get(key)===entry)this.pending.delete(key);});this.pending.set(key,entry);return entry.promise;
 }
 clear(){this.generation++;for(const entry of this.pending.values())entry.controller.abort();this.pending.clear();this.cache.clear();this.revisions.clear();}
}
