/** Microphone recording, the way a waveform editor does it.
 *
 * Record (R) appends to the selected / focused audio track (at the end of its audio); Record New Track (⇧R) makes a
 * new track and records at the cursor. A take clip appears at once on the record track and grows while recording,
 * drawn from the captured input level; when the take stops it stays in place ("Saving…") until Freestyle's saved
 * clip replaces it. The Recording meter follows the same level.
 *
 * Audio goes microphone -> Freestyle (WebRTC uplink); the engine records and saves the take. The level shown here is
 * the browser's own input-level statistic for that uplink track. Nothing is analysed, mixed or played locally.
 */
import {meterLevelPercent} from './audacity-meter-view.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LEVEL_HZ=20;

/** Where Record puts the take: append to the chosen audio track, or a new track at the cursor. */
export function planRecordTarget({tracks=[],focusedTrack=null,selectedTracks=new Set(),cursorSec=0,seconds=value=>value,newTrack=false}={}){
 const audio=track=>!!track?.laneId&&!(track.clips||[]).some(clip=>clip.patternId)&&!['instrument','pattern','midi'].includes(String(track.channel?.type||''));
 if(newTrack)return {newTrack:true,startSec:Math.max(0,Number(cursorSec)||0)};
 const chosen=tracks.find(track=>selectedTracks.has?.(track.index)&&audio(track))??tracks.find(track=>track.index===focusedTrack&&audio(track))??null;
 if(!chosen)return {newTrack:true,startSec:Math.max(0,Number(cursorSec)||0)};
 const end=(chosen.clips||[]).reduce((max,clip)=>Math.max(max,seconds(clip.start+clip.length)),0);
 return {newTrack:false,laneId:chosen.laneId,trackIndex:chosen.index,startSec:end};
}
/** One column per pixel from level samples taken every 1/rate s: [x, level] with level the maximum inside the pixel. */
export function levelColumns(levels,{rate=LEVEL_HZ,fromSec=0,toSec,pixelsPerSecond,maxColumns=4096}={}){
 const end=Math.min(toSec??levels.length/rate,levels.length/rate),width=Math.max(0,(end-fromSec)*pixelsPerSecond),count=Math.min(maxColumns,Math.ceil(width)),columns=[];
 for(let x=0;x<count;x++){
  const a=fromSec+x/pixelsPerSecond,b=fromSec+(x+1)/pixelsPerSecond,first=Math.max(0,Math.floor(a*rate)),last=Math.min(levels.length-1,Math.max(first,Math.ceil(b*rate)-1));let level=0;
  for(let index=first;index<=last;index++)if(levels[index]>level)level=levels[index];
  columns.push([x,level]);
 }
 return columns;
}

export class AudacityRecordingView{
 constructor(workspace,{createTrack=null,onError=()=>{},onTakeFailed=null,now=()=>performance.now(),raf=callback=>requestAnimationFrame(callback),cancelRaf=id=>cancelAnimationFrame(id)}={}){
  Object.assign(this,{w:workspace,createTrack,onError,onTakeFailed,now,raf,cancelRaf});this.take=null;this.timings={};this.listeners=[];
 }
 get engine(){return this.w.engine;}
 get recorder(){return this.engine.recorder;}
 get active(){return !!this.take&&this.take.phase!=='saving';}
 attach(){
  const recorder=this.recorder;if(!recorder?.addEventListener||this.attached===recorder)return this;this.detach();this.attached=recorder;
  const on=(type,fn)=>{recorder.addEventListener(type,fn);this.listeners.push(()=>recorder.removeEventListener(type,fn));};
  on('level',event=>this.level(event.detail));
  on('state',event=>this.state(event.detail));
  return this;
 }
 detach(){for(const off of this.listeners.splice(0))off();this.attached=null;}
 destroy(){this.detach();this.stopLoop();this.clear();}
 status(text){this.engine.onStatus?.(text);}
 button(){return this.w.header?.querySelector('#au-record');}
 mark(){const button=this.button(),phase=this.take?.phase;if(button){button.classList.toggle('active',phase==='arming'||phase==='recording');button.classList.toggle('au-record-arming',phase==='arming');button.setAttribute('aria-pressed',String(phase==='arming'||phase==='recording'));}}
 /** Record button / R / ⇧R / Stop. */
 async toggle({newTrack=false}={}){
  const take=this.take;
  if(take?.phase==='recording')return this.stop();
  if(take?.phase==='arming')return this.cancel();
  if(take?.phase==='saving')return this.status('The previous take is still being saved in Freestyle.');
  return this.start({newTrack});
 }
 async start({newTrack=false}={}){
  const w=this.w,engine=this.engine;if(!engine.ready)throw new Error('Open a Freestyle project before recording.');
  this.attach();const clicked=this.now();
  const plan=planRecordTarget({tracks:w.tracks,focusedTrack:w.focusedTrack,selectedTracks:w.selectedTracks,cursorSec:w.selection?.start,seconds:value=>w.seconds(value),newTrack});
  const take=this.take={phase:'arming',laneId:plan.laneId??null,startSec:plan.startSec,levels:[],clicked,duration:0,name:'Recording'};
  this.mark();this.status('Starting the microphone…');this.sync();
  try{
   if(engine.playing)await engine.stop();
   if(plan.newTrack){
    if(!this.createTrack)throw new Error('Add an audio track before recording.');
    this.status('Adding a track for the recording…');const created=await this.createTrack();if(this.take!==take)return null;
    take.laneId=created?.laneId||created;if(!take.laneId)throw new Error('Freestyle did not confirm the new recording track.');w.render?.();this.sync();
   }
   const result=await engine.startRecording({laneId:take.laneId,startSec:take.startSec});
   if(this.take!==take){if(result)try{this.recorder.cancel();}catch{}return null;}
   if(!result){this.clear();return null;}
   take.phase='recording';take.startedAt=this.now();take.mode=result.mode;take.levels.length=0;this.timings.armMs=Math.round(take.startedAt-clicked);
   take.startedTransport=result.startedTransport===true;
   this.mark();this.status(result.mode==='capture-upload'?'Recording (the take is uploaded when you stop).':'Recording…');this.startLoop();this.sync();
   // Recording from Stop rolls Freestyle's transport from the take's start: the playhead and the other tracks run with it.
   if(take.startedTransport)this.w.tick?.();
   return result;
  }catch(error){if(this.take===take)this.clear();if(error?.name!=='AbortError')throw error;return null;}
 }
 cancel(){const take=this.take;if(!take)return;try{this.recorder.cancel();}catch{}this.clear();this.status('Recording cancelled.');}
 async stop(){
  const take=this.take,engine=this.engine;if(!take||take.phase!=='recording')return null;
  take.duration=(this.now()-take.startedAt)/1000;take.phase='saving';this.stopLoop();this.mark();this.meter(0);this.paint();this.status('Saving the recorded take in Freestyle…');
  const stopped=this.now();
  try{
   const result=await engine.stopRecording();this.timings.placedMs=Math.round(this.now()-stopped);
   // Placed: the clip is on its track and already plays; Freestyle finishes scanning and storing it in the background.
   const confirming=!!result?.placed&&!result?.persisted&&typeof result?.confirmed?.then==='function';
   this.status(result?.placementPending?'Take uploaded to Freestyle; its timeline placement is waiting for engine sync.':confirming?'Take is on the track. Freestyle is finishing the save…':'Recording saved.');
   this.w.render?.();await this.settle(take,result?.clipId);this.timings.saveMs=Math.round(this.now()-stopped);
   if(confirming)this.confirm(result,stopped);
   return result;
  }catch(error){this.onTakeFailed?.(error,engine.lastTake);throw error;}
  finally{if(this.take===take)this.clear();this.w.render?.();}
 }
 /** Background confirmation of a placed take: saved:true, or a final refusal (the clip is then removed in Freestyle). */
 confirm(result,stopped=this.now()){
  const engine=this.engine;
  const done=this.confirming=result.confirmed.then(()=>{this.timings.confirmedMs=Math.round(this.now()-stopped);if(!this.take)this.status('Recording saved.');return true;},error=>{
   if(error?.name==='AbortError')return false;
   if(error?.code==='recording_take_pending'){this.status(error.message);return false;}
   // Freestyle refused the take after it was placed: the clip is gone from the project; offer the captured audio.
   this.w.render?.();this.onTakeFailed?.(error,engine.lastTake);this.onError(error);return false;
  }).finally(()=>{if(this.confirming===done)this.confirming=null;});
  return done;
 }
 /** The take stays drawn until the saved clip has its own waveform on screen (bounded), so nothing flashes empty. */
 async settle(take,clipId,{timeoutMs=10000,stepMs=150}={}){
  if(!clipId)return;const started=this.now();
  while(this.take===take&&this.now()-started<timeoutMs){
   const element=[...this.w.root.querySelectorAll('.au-clip:not(.au-recording-clip)')].find(node=>node.dataset.clip===String(clipId));
   if(element?.querySelector('.au-source-waveform'))return;
   await new Promise(resolve=>setTimeout(resolve,stepMs));
  }
 }
 clear(){this.take=null;this.stopLoop();this.mark();this.meter(0);for(const node of this.w.root?.querySelectorAll('.au-recording-clip')||[])node.remove();}
 state(detail){
  // The uplink dropped or the engine refused: never leave a phantom take on screen.
  if(detail?.state==='error'&&this.take&&this.take.phase!=='saving'){this.clear();}
 }
 level(detail){
  const level=Number(detail?.level)||0;this.meter(level);const take=this.take;if(!take||take.phase!=='recording'||!detail?.recording)return;
  const index=Math.floor(((this.now()-take.startedAt)/1000)*LEVEL_HZ);
  // One slot per 1/20 s; a late sample fills the gap with the previous value so the take has no holes.
  while(take.levels.length<index)take.levels.push(take.levels.length?take.levels[take.levels.length-1]:level);
  if(index<take.levels.length)take.levels[index]=Math.max(take.levels[index],level);else take.levels.push(level);
 }
 meter(level){const fill=this.w.header?.querySelector('#au-input-meter');if(!fill)return;let percent=0;try{percent=level>0?meterLevelPercent(level,this.w.displayPreferences?.get?.()?.meterRange??60):0;}catch{}fill.style.width=percent+'%';}
 startLoop(){this.stopLoop();const frame=()=>{this.frame=null;const take=this.take;if(!take||take.phase!=='recording')return;take.duration=(this.now()-take.startedAt)/1000;this.follow();this.paint();this.frame=this.raf(frame);};this.frame=this.raf(frame);}
 stopLoop(){if(this.frame!=null){this.cancelRaf(this.frame);this.frame=null;}}
 /** Keep the record head on screen, as the timeline scrolls while recording. */
 follow(){const w=this.w,take=this.take,head=take.startSec+take.duration,width=w.viewWidth(),right=w.leftSec+width/w.scale;if(head>right-12/w.scale||head<w.leftSec)w.setLeftSec(Math.max(0,head-width/w.scale*.75));w.timeToolbar?.updatePosition?.(head);}
 lane(){const w=this.w,track=(w.tracks||[]).find(item=>item.laneId===this.take?.laneId);return track?w.root.querySelector(`.au-lane[data-track="${track.index}"]`):null;}
 /** Called after every workspace render: the take element is re-attached to its lane. */
 sync(){if(this.take)this.paint();else for(const node of this.w.root?.querySelectorAll('.au-recording-clip')||[])node.remove();}
 paint(){
  const take=this.take,w=this.w;if(!take||!w.root)return;const lane=this.lane();
  let element=w.root.querySelector('.au-recording-clip');
  if(!lane){element?.remove();return;}
  if(!element||element.parentElement!==lane){element?.remove();element=lane.ownerDocument.createElement('div');element.className='au-clip au-recording-clip';element.setAttribute('role','status');element.innerHTML='<div class="au-clip-head"><span></span></div><div class="au-clip-body"></div>';lane.append(element);}
  const width=w.viewWidth(),viewEnd=w.leftSec+width/w.scale,start=take.startSec,end=start+Math.max(take.duration,0),left=Math.max(start,w.leftSec),right=Math.min(end,viewEnd),pixels=Math.max(2,(right-left)*w.scale);
  element.dataset.phase=take.phase;element.hidden=right<left&&take.phase!=='arming';
  element.style.left=w.timeToX(left)+'px';element.style.width=pixels+'px';
  element.querySelector('.au-clip-head span').textContent=take.phase==='arming'?'Starting…':take.phase==='saving'?'Saving take…':'Recording';
  const body=element.querySelector('.au-clip-body'),height=Math.max(8,body.clientHeight||Math.max(8,(lane.clientHeight||150)-22)),middle=height/2,columns=levelColumns(take.levels,{fromSec:Math.max(0,left-start),toSec:Math.max(0,right-start),pixelsPerSecond:w.scale});
  let path='';for(const [x,level] of columns){const half=Math.max(.5,Math.min(1,level)*middle*.92);path+=`M${x+.5} ${(middle-half).toFixed(1)}V${(middle+half).toFixed(1)}`;}
  body.innerHTML=`<svg class="au-recording-wave" viewBox="0 0 ${Math.max(1,Math.ceil(pixels))} ${height}" width="${Math.max(1,Math.ceil(pixels))}" height="${height}" preserveAspectRatio="none" aria-label="${esc(take.phase==='saving'?'Recorded take being saved':'Recording input level')}"><path d="${path}"/></svg>`;
 }
}
