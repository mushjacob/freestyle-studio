/** Multi-resolution peak cache for cloud source waveforms.
 *
 * Every measured tile Freestyle returns (GET …/clips/{clip_id}/waveform: per-channel
 * min/max/RMS over a source-frame range) is kept per SOURCE, keyed by project + root
 * clip id + source revision, independently of the visible window. Painting composes
 * the visible source range from the best data already held (finer data is merged
 * down, coarser data is stretched), so scroll / zoom / drag / trim repaint at once
 * and never wait for the network. Fetching uses power-of-four levels with fixed
 * aligned tiles, so a scrolled or re-zoomed view reuses the tiles it already has.
 *
 * Display data only: no audio is decoded, generated or interpolated here. A coarse
 * bucket stays a measured min/max/RMS interval; it is never turned into samples.
 */
const safe=(value,label)=>{if(!Number.isSafeInteger(value)||value<0)throw new RangeError(`${label} must be a nonnegative safe integer.`);return value;};
/** First source frame of bucket `index` (index === bucketCount gives the end). */
export function bucketBound(tile,index){return tile.bucketBoundaries?tile.bucketBoundaries[index]:tile.startFrame+Math.floor(index*(tile.endFrame-tile.startFrame)/tile.bucketCount);}
/** Index of the bucket that contains `frame` (clamped to the tile). */
export function bucketIndexAt(tile,frame){
 const count=tile.bucketCount;if(frame<=tile.startFrame)return 0;if(frame>=tile.endFrame)return count-1;
 let low=0,high=count-1;
 if(!tile.bucketBoundaries){const guess=Math.floor((frame-tile.startFrame)*count/(tile.endFrame-tile.startFrame));low=Math.max(0,guess-1);high=Math.min(count-1,guess+1);}
 while(low<high){const mid=(low+high+1)>>1;if(bucketBound(tile,mid)<=frame)low=mid;else high=mid-1;}
 return low;
}
const density=tile=>(tile.endFrame-tile.startFrame)/tile.bucketCount;
/** Power-of-four level whose buckets are no wider than `framesPerColumn`. */
export function pyramidLevel(framesPerColumn){let level=1;while(level*4<=framesPerColumn)level*=4;return level;}

export class PeakPyramid{
 constructor({tileBuckets=4096,maxBuckets=1_200_000,maxSources=96}={}){
  safe(tileBuckets,'Tile buckets');if(tileBuckets<1||tileBuckets>8192)throw new RangeError('Pyramid tiles hold 1–8192 buckets.');
  Object.assign(this,{tileBuckets,maxBuckets,maxSources});this.sources=new Map();this.tick=0;this.buckets=0;
 }
 key(projectId,clipId){return String(projectId)+'\n'+String(clipId);}
 source(key){return this.sources.get(key)??null;}
 has(key){return (this.sources.get(key)?.segments.length??0)>0;}
 revision(key){return this.sources.get(key)?.revision??null;}
 drop(key){const source=this.sources.get(key);if(!source)return;for(const segment of source.segments)this.buckets-=segment.tile.bucketCount;this.sources.delete(key);}
 clear(){this.sources.clear();this.buckets=0;}
 /** Keep a measured tile. A different revision / framing replaces the whole source. */
 add(key,tile){
  if(!tile||!tile.bucketCount||!Array.isArray(tile.channels)&&!tile.channels?.length)return false;
  let source=this.sources.get(key);
  if(source&&(source.revision!==String(tile.revision)||source.frameCount!==tile.frameCount||source.sampleRate!==tile.sampleRate||source.channelCount!==tile.channelCount)){this.drop(key);source=null;}
  if(!source){source={key,revision:String(tile.revision),frameCount:tile.frameCount,sampleRate:tile.sampleRate,channelCount:tile.channelCount,template:tile,segments:[],used:++this.tick};this.sources.set(key,source);}
  source.used=++this.tick;
  if(source.segments.some(row=>row.tile.startFrame===tile.startFrame&&row.tile.endFrame===tile.endFrame&&row.tile.bucketCount===tile.bucketCount))return false;
  const segment={tile,density:density(tile),used:this.tick,whole:tile.startFrame===0&&tile.endFrame===tile.frameCount};
  source.segments.push(segment);source.segments.sort((a,b)=>a.density-b.density);this.buckets+=tile.bucketCount;this.trim(key);return true;
 }
 /** Least-recently-drawn detail goes first; a source's whole-file overview goes last. */
 trim(protectedKey){
  while(this.sources.size>this.maxSources){const oldest=[...this.sources.values()].filter(row=>row.key!==protectedKey).sort((a,b)=>a.used-b.used)[0];if(!oldest)break;this.drop(oldest.key);}
  if(this.buckets<=this.maxBuckets)return;
  const rows=[];for(const source of this.sources.values())for(const segment of source.segments)if(!segment.whole)rows.push({source,segment});
  rows.sort((a,b)=>a.segment.used-b.segment.used);
  for(const {source,segment}of rows){if(this.buckets<=this.maxBuckets*.85)break;source.segments.splice(source.segments.indexOf(segment),1);this.buckets-=segment.tile.bucketCount;}
 }
 /** Same PCM under another clip id (split / paste / reload): revision, framing and the measured overview all agree. */
 findSame(projectId,tile,exceptKey){
  const prefix=String(projectId)+'\n';
  for(const source of this.sources.values()){
   if(source.key===exceptKey||!source.key.startsWith(prefix)||source.revision!==String(tile.revision)||source.frameCount!==tile.frameCount||source.sampleRate!==tile.sampleRate||source.channelCount!==tile.channelCount)continue;
   const twin=source.segments.find(row=>row.tile.startFrame===tile.startFrame&&row.tile.endFrame===tile.endFrame&&row.tile.bucketCount===tile.bucketCount)?.tile;if(!twin)continue;
   let same=true;for(let channel=0;same&&channel<tile.channelCount;channel++)for(const name of ['min','max','rms']){const a=twin.channels[channel][name],b=tile.channels[channel][name];for(let index=0;index<a.length;index++)if(a[index]!==b[index]){same=false;break;}if(!same)break;}
   if(same)return source.key.slice(prefix.length);
  }
  return null;
 }
 /** Compose [startFrame,endFrame) from held data. `columns` is the number of device columns it is drawn into.
  * Returns {tile, complete} — complete means every part is at least as fine as one bucket per column (or per frame). */
 compose(key,{startFrame,endFrame,columns}){
  const source=this.sources.get(key);if(!source||!source.segments.length)return null;
  const from=Math.max(0,Math.floor(startFrame)),to=Math.min(source.frameCount,Math.ceil(endFrame));if(!(to>from)||!(columns>0))return null;
  source.used=++this.tick;
  const need=Math.max(1,(to-from)/columns),sufficient=segment=>segment.density<=need*1.0001;
  // Coarsest sufficient data first (least work), then the finest of what is left.
  const order=[...source.segments.filter(sufficient).reverse(),...source.segments.filter(segment=>!sufficient(segment))];
  let uncovered=[[from,to]];const pieces=[];let complete=true;
  for(const segment of order){
   if(!uncovered.length)break;const tile=segment.tile,next=[];let used=false;
   for(const [a,b]of uncovered){
    const left=Math.max(a,tile.startFrame),right=Math.min(b,tile.endFrame);
    if(right<=left){next.push([a,b]);continue;}
    pieces.push({tile,a:left,b:right});used=true;if(a<left)next.push([a,left]);if(right<b)next.push([right,b]);
   }
   if(used){segment.used=this.tick;if(!sufficient(segment))complete=false;}
   uncovered=next;
  }
  if(!pieces.length)return null;if(uncovered.length)complete=false;
  pieces.sort((x,y)=>x.a-y.a);
  const channels=Array.from({length:source.channelCount},(_,channel)=>({channel,min:[],max:[],rms:[]})),bounds=[];
  let cursor=null;
  for(let index=0;index<pieces.length;index++){
   const {tile,a,b}=pieces[index];
   if(cursor!==null&&a>cursor)break; // a hole: draw the contiguous run that starts the view (callers refetch the rest)
   const first=bucketIndexAt(tile,a),last=bucketIndexAt(tile,b-1),group=Math.max(1,Math.floor(need/density(tile)+1e-6));
   for(let bucket=first;bucket<=last;bucket+=group){
    const end=Math.min(last,bucket+group-1);
    // Outer edges keep whole measured buckets; only a junction between two tiles is cut.
    let low=bucketBound(tile,bucket),high=bucketBound(tile,end+1);
    if(cursor!==null)low=Math.max(low,cursor);if(index<pieces.length-1)high=Math.min(high,b);
    if(high<=low)continue;
    if(!bounds.length)bounds.push(low);
    for(let channel=0;channel<source.channelCount;channel++){
     const values=tile.channels[channel];let min=values.min[bucket],max=values.max[bucket],rms=values.rms[bucket];
     if(end>bucket){let energy=0,weight=0;for(let item=bucket;item<=end;item++){const width=bucketBound(tile,item+1)-bucketBound(tile,item);if(values.min[item]<min)min=values.min[item];if(values.max[item]>max)max=values.max[item];energy+=values.rms[item]*values.rms[item]*width;weight+=width;}rms=weight>0?Math.sqrt(energy/weight):rms;}
     channels[channel].min.push(min);channels[channel].max.push(max);channels[channel].rms.push(rms);
    }
    bounds.push(high);cursor=high;
   }
  }
  const bucketCount=bounds.length-1;if(bucketCount<1)return null;
  if(bounds[0]>from||bounds[bucketCount]<to)complete=false;
  const template=source.template,tile={clipId:template.clipId,revision:source.revision,sampleRate:source.sampleRate,frameCount:source.frameCount,channelCount:source.channelCount,startFrame:bounds[0],endFrame:bounds[bucketCount],bucketCount,startMs:template.startMs,clipOffsetFrames:template.clipOffsetFrames,clipFrameCount:template.clipFrameCount,gain:template.gain,channels,bucketBoundaries:bounds};
  return {tile,complete,framesPerBucket:need};
 }
 /** Aligned tiles that cover [startFrame,endFrame) at the level for `columns`. Stable across scroll positions. */
 tilesFor(key,{startFrame,endFrame,columns,level}){
  const source=this.sources.get(key);if(!source)return [];
  const from=Math.max(0,Math.floor(startFrame)),to=Math.min(source.frameCount,Math.ceil(endFrame));if(!(to>from)||!(columns>0))return [];
  level??=pyramidLevel(Math.max(1,(Math.ceil(endFrame)-Math.floor(startFrame))/columns));const stride=level*this.tileBuckets,result=[];
  for(let index=Math.floor(from/stride);index*stride<to;index++){
   const start=index*stride,end=Math.min(source.frameCount,start+stride),buckets=Math.min(this.tileBuckets,Math.ceil((end-start)/level));
   result.push({id:level+':'+index,level,startFrame:start,endFrame:end,buckets,held:source.segments.some(row=>row.tile.startFrame<=start&&row.tile.endFrame>=end&&row.density<=level*1.0001)});
  }
  return result;
 }
}
