/** FL-style live recording clip: while a microphone take records, a clip sits on the
 *  record track at the take's start and grows with a live waveform; when the take is
 *  saved it gives way to the real clip. This is display only: levels come from the
 *  uplink's own WebRTC statistics (media-source audioLevel), never from decoding or
 *  processing audio in the browser. */
export const LIVE_RATE=1000;               // virtual "frames" per second of the live peak block
export const LEVEL_INTERVAL_MS=50;

/** Append one level (0..1) and return the live peak block for WaveformPyramid.setLive(). */
export function pushLevel(levels,level){
 const value=Number.isFinite(level)?Math.max(0,Math.min(1,level)):0;levels.push(value);return value;
}
export function livePeaks(levels,elapsedMs){
 const count=Math.max(1,levels.length),min=new Array(count),max=new Array(count),rms=new Array(count);
 for(let index=0;index<count;index++){const value=levels[index]??0,peak=Math.min(1,value*1.6);max[index]=peak;min[index]=-peak;rms[index]=value;}
 return{sampleRate:LIVE_RATE,frameCount:Math.max(count,Math.round(elapsedMs)),bucketCount:count,channels:[{min,max,rms}]};
}
/** Clip geometry in beats for a take that started at `startSec` and has run `elapsedMs`. */
export function liveClipGeometry({startSec,elapsedMs,bpm}){
 const beatsPerSecond=(Number(bpm)>0?Number(bpm):120)/60;
 return{start:Math.max(0,Number(startSec)||0)*beatsPerSecond,length:Math.max(.05,elapsedMs/1000*beatsPerSecond)};
}
/** Read the microphone level from a sender peer's statistics (null when unavailable). */
export async function uplinkLevel(peer){
 if(!peer||typeof peer.getStats!=='function')return null;
 try{for(const report of (await peer.getStats()).values())if(report.type==='media-source'&&report.kind==='audio'&&Number.isFinite(report.audioLevel))return report.audioLevel;}catch{}
 return null;
}

export class LiveRecordingClip{
 constructor({pyramid,painter,getLaneGrid,getPeer,getBpm,audioWaveMarkup,now=()=>performance.now(),raf=fn=>requestAnimationFrame(fn),caf=id=>cancelAnimationFrame(id),setInterval:every=(fn,ms)=>setInterval(fn,ms),clearInterval:stopEvery=id=>clearInterval(id),document:doc=globalThis.document}={}){
  if(!pyramid||!painter||typeof getLaneGrid!=='function')throw new TypeError('LiveRecordingClip needs pyramid, painter and getLaneGrid.');
  Object.assign(this,{pyramid,painter,getLaneGrid,getPeer,getBpm,audioWaveMarkup,now,raf,caf,every,stopEvery,doc});this.take=null;
 }
 get active(){return !!this.take;}
 start({takeId,laneId,startSec=0,name='Recording'}={}){
  this.remove();
  const take={id:`live:${takeId||Date.now()}`,laneId,startSec,name,startedAt:this.now(),levels:[],frozenMs:null,element:null,frame:null,timer:null};this.take=take;
  take.timer=this.every(async()=>{if(this.take!==take||take.frozenMs!==null)return;const level=await uplinkLevel(this.getPeer?.());if(this.take!==take||take.frozenMs!==null)return;pushLevel(take.levels,level??0);},LEVEL_INTERVAL_MS);
  const tick=()=>{if(this.take!==take)return;this.paint();take.frame=this.raf(tick);};take.frame=this.raf(tick);this.paint();return take.id;
 }
 elapsedMs(){const take=this.take;return take?(take.frozenMs??Math.max(0,this.now()-take.startedAt)):0;}
 clip(){const take=this.take;if(!take)return null;return{id:take.id,liveWaveformId:take.id,name:take.name,volume:1,offset:0,offsetKnown:true,...liveClipGeometry({startSec:take.startSec,elapsedMs:this.elapsedMs(),bpm:this.getBpm?.()})};}
 /** Draw (or re-attach after a playlist re-render) the growing clip. */
 paint(){
  const take=this.take;if(!take)return false;const grid=this.getLaneGrid(take.laneId);if(!grid)return false;
  if(!take.element||!take.element.isConnected||take.element.parentElement!==grid){
   const element=this.doc.createElement('div');element.className='clip audio-clip recording-clip';element.dataset.liveRecording=take.id;element.setAttribute('aria-label','Recording in progress');
   element.innerHTML=`<div class="clip-title">● ${take.name}</div>${this.audioWaveMarkup?this.audioWaveMarkup():'<canvas class="audio-wave-canvas"></canvas>'}`;
   grid.append(element);take.element=element;
  }
  const clip=this.clip(),style=take.element.style,left=`calc(${clip.start/4} * var(--bar))`,width=`calc(${clip.length/4} * var(--bar))`;
  if(style.left!==left)style.left=left;if(style.width!==width)style.width=width;
  if(take.levels.length){this.pyramid.setLive(take.id,livePeaks(take.levels,this.elapsedMs()));this.painter.paint(take.element,clip);}
  return true;
 }
 /** Issue #4: finalize (wait_for "placed") put the take's clip on its lane: show it at the engine's start and length
  *  at once (it already plays in the engine) until the next project read draws the saved row. */
 place({startSec,durationSec,clipId=null}={}){
  const take=this.take;if(!take||!(Number(durationSec)>0))return false;
  if(Number.isFinite(Number(startSec))&&Number(startSec)>=0)take.startSec=Number(startSec);take.frozenMs=Number(durationSec)*1000;take.placedClipId=clipId;
  const element=take.element;if(element){element.classList.remove('recording-clip-saving');element.classList.add('recording-clip-placed');element.dataset.placedClip=clipId||'';const title=element.querySelector('.clip-title');if(title)title.textContent=take.name;}
  this.paint();return true;
 }
 /** Stop growing (take_stop sent); the clip stays until remove(). */
 freeze(){const take=this.take;if(!take||take.frozenMs!==null)return;take.frozenMs=Math.max(0,this.now()-take.startedAt);take.element?.classList.add('recording-clip-saving');this.paint();}
 remove(){
  const take=this.take;if(!take)return;this.take=null;
  if(take.frame!=null)this.caf(take.frame);if(take.timer!=null)this.stopEvery(take.timer);
  take.element?.remove();try{this.pyramid.clearLive?.(take.id);this.pyramid.sync?.([...this.pyramid.clips.keys()].filter(id=>id!==take.id));}catch{}
 }
}
