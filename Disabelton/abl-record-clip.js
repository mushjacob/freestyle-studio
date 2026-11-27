/**
 * abl-record-clip.js: the growing clip of a take being recorded (Live: the clip appears at the
 * record start position and grows with a live waveform until Stop, then settles into the saved clip).
 *
 * The clip is display-only: an overlay element in the recording track's lane that follows the engine
 * position. Its waveform is the engine's own lane meter (mozart-meters), sampled into peak buckets and
 * fed to the waveform pyramid with setLive(); nothing is decoded, analysed or played in the browser.
 */
export const LIVE_BUCKETS_PER_SEC=40;
const SAMPLE_RATE=48000;

/** Append meter levels into fixed-rate peak buckets. Pure; `levels` is a plain array of 0..1 peaks. */
export function pushLiveLevel(levels,elapsedSec,level,{rate=LIVE_BUCKETS_PER_SEC}={}){
 const index=Math.max(0,Math.floor(elapsedSec*rate)),value=Math.max(0,Math.min(1,Number(level)||0));
 // A late frame fills the buckets it skipped with the last level so the wave has no holes.
 while(levels.length<index)levels.push(levels.length?levels[levels.length-1]:value);
 if(levels.length===index)levels.push(value);else if(value>levels[index])levels[index]=value;
 return levels;
}
/** setLive() payload for the collected levels: a symmetric envelope over [0, elapsed). */
export function livePeaks(levels,elapsedSec){
 const bucketCount=levels.length,frameCount=Math.max(bucketCount,Math.round(Math.max(elapsedSec,bucketCount/LIVE_BUCKETS_PER_SEC)*SAMPLE_RATE));
 const max=levels.slice(),min=levels.map(value=>-value),rms=levels.map(value=>value*.6);
 return{sampleRate:SAMPLE_RATE,frameCount,bucketCount,channels:[{min,max,rms}]};
}

export class LiveRecordingClip{
 /**
  * @param {object} o
  *  laneGrid(track) → the lane's clip container, or null
  *  pxPerBeat(), bpm(), positionSec() → engine song position (seconds) or null
  *  level() → the recording lane's current meter level 0..1, or null when the engine sends none
  *  waveforms → AblWaveforms (liveClips map + pyramid) or null
  */
 constructor({document:doc=globalThis.document,laneGrid,pxPerBeat,bpm,positionSec,level=()=>null,waveforms=null,now=()=>performance.now()}){
  Object.assign(this,{doc,laneGrid,pxPerBeat,bpm,positionSec,level,waveforms,now});this.take=null;this.frame=null;
 }
 get active(){return !!this.take;}
 start({takeId,track,startSec=0,name='Recording'}){
  this.remove();
  const id=`live:${takeId||Date.now()}`,element=this.doc.createElement('div');
  element.className='clip audio-clip abl-recording-clip';element.dataset.clip=id;element.dataset.audio='true';element.dataset.liveTake='true';
  element.innerHTML='<div class="clip-title"></div><span class="audio-waveform" style="display:contents"></span>';element.querySelector('.clip-title').textContent=name;
  this.take={id,takeId,track,startSec:Math.max(0,Number(startSec)||0),element,levels:[],startedAt:this.now(),lengthSec:0,frozen:false,lastLive:0,metered:false};
  this.waveforms?.liveClips.set(id,{id,cloudId:id,start:this.take.startSec*this.bpm()/60,length:0,offset:0});
  this.tick();return id;
 }
 /** Stop growing (Stop was pressed); the clip stays until remove(). */
 freeze(){if(this.take)this.take.frozen=true;}
 remove(){
  const take=this.take;if(!take)return;this.take=null;
  if(this.frame!==null){(this.doc.defaultView||globalThis).cancelAnimationFrame(this.frame);this.frame=null;}
  take.element.remove();this.waveforms?.liveClips.delete(take.id);try{this.waveforms?.pyramid.clearLive(take.id);this.waveforms?.pyramid.sync([...this.waveforms.pyramid.clips.keys()].filter(key=>key!==take.id));}catch{}
 }
 tick(){
  const take=this.take;if(!take)return;const view=this.doc.defaultView||globalThis;
  this.frame=view.requestAnimationFrame(()=>{this.frame=null;this.tick();});
  const bpm=this.bpm(),pxPerBeat=this.pxPerBeat();if(!(bpm>0)||!(pxPerBeat>0))return;
  if(!take.frozen){
   // Length follows the engine position; the wall clock only bridges a clock that has not started moving yet.
   const position=Number(this.positionSec()),elapsedWall=(this.now()-take.startedAt)/1000,byClock=Number.isFinite(position)?position-take.startSec:NaN;
   take.lengthSec=Math.max(take.lengthSec,Number.isFinite(byClock)&&byClock>0?byClock:Math.min(elapsedWall,.25));
   const level=this.level();if(level!=null&&Number.isFinite(Number(level))){take.metered=true;pushLiveLevel(take.levels,take.lengthSec,level);}
  }
  const grid=this.laneGrid(take.track);if(!grid)return;
  // A project re-render replaces the lane's children: put the clip back.
  if(take.element.parentElement!==grid)grid.append(take.element);
  const startBeat=take.startSec*bpm/60,lengthBeat=take.lengthSec*bpm/60;
  take.element.style.left=`${startBeat*pxPerBeat}px`;take.element.style.width=`${Math.max(2,lengthBeat*pxPerBeat)}px`;
  take.element.dataset.lengthSec=take.lengthSec.toFixed(3);take.element.dataset.metered=String(take.metered);
  const clip=this.waveforms?.liveClips.get(take.id);if(clip){clip.start=startBeat;clip.length=lengthBeat;}
  if(this.waveforms&&take.levels.length&&this.now()-take.lastLive>90&&!take.frozen){take.lastLive=this.now();try{this.waveforms.pyramid.setLive(take.id,livePeaks(take.levels,take.lengthSec));}catch{}}
 }
}
