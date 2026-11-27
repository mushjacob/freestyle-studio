/**
 * Logic-style recording region: while a take is captured, a red region sits on
 * the record-enabled track from the punch-in position and grows with the
 * playhead, drawing the microphone level as it arrives. After Stop it stays
 * ("saving") until Freestyle's saved clip replaces it.
 *
 * Levels come from the microphone uplink's WebRTC statistics (media-source
 * audioLevel); nothing is decoded, analysed or played locally.
 */
export const RECORDING_LEVEL_HZ=20;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** Level history at a fixed rate; time is seconds since the take began. */
export class RecordingLevels{
 constructor({rate=RECORDING_LEVEL_HZ,max=rate*60*30}={}){this.rate=rate;this.max=max;this.values=[];}
 /** Record `level` (0..1) at `seconds`; gaps repeat the last value so the envelope stays continuous. */
 push(seconds,level){
  if(!(seconds>=0)||!Number.isFinite(seconds))return this.values.length;
  const index=Math.min(this.max-1,Math.floor(seconds*this.rate)),value=clamp(Number(level)||0,0,1),last=this.values.length?this.values[this.values.length-1]:0;
  while(this.values.length<index)this.values.push(last);
  if(this.values.length===index)this.values.push(value);else this.values[index]=Math.max(this.values[index],value);
  return this.values.length;
 }
 get duration(){return this.values.length/this.rate;}
 /** Peak per pixel column for [0,seconds) drawn `columns` wide. */
 columns(seconds,columns){
  const out=new Float32Array(Math.max(0,columns));if(!(seconds>0)||!columns)return out;
  for(let column=0;column<columns;column++){
   const from=Math.floor(column/columns*seconds*this.rate),to=Math.max(from+1,Math.ceil((column+1)/columns*seconds*this.rate));let peak=0;
   for(let index=from;index<to&&index<this.values.length;index++)if(this.values[index]>peak)peak=this.values[index];
   out[column]=peak;
  }
  return out;
 }
}

/** Geometry of the growing region in beats. */
export function recordingRegionBeats({startSec,nowSec,bpm,minBeats=1/16}){
 const tempo=Number(bpm)>0?Number(bpm):120,start=Math.max(0,Number(startSec)||0),now=Math.max(start,Number.isFinite(nowSec)?nowSec:start);
 return{start:start*tempo/60,length:Math.max(minBeats,(now-start)*tempo/60)};
}

/** Draw the level envelope (mirrored, like a mono waveform) into a canvas context. */
export function paintRecordingLevels(context,levels,{width,height,seconds,color='#5a0f0f'}){
 context.clearRect(0,0,width,height);if(!(width>0)||!(height>0))return 0;
 const columns=Math.max(1,Math.round(width)),values=levels.columns(seconds,columns),center=height/2,half=height*.46;let drawn=0;
 context.fillStyle=color;context.beginPath();
 for(let column=0;column<columns;column++){
  // audioLevel is linear 0..1; a square root keeps quiet input visible, as a waveform overview would.
  const amplitude=Math.sqrt(values[column])*half,size=Math.max(1,amplitude*2);
  context.rect(column,center-size/2,1,size);if(amplitude>0)drawn++;
 }
 context.fill();return drawn;
}

/**
 * DOM controller. `host()` returns the lane element for a track row (a positioned
 * box whose x axis is beats × pixelsPerBeat); the region re-attaches itself after
 * the Tracks area re-renders (call mount()).
 */
export class RecordingRegionView{
 constructor({host,pixelsPerBeat,document:doc=globalThis.document,name='Recording'}={}){
  if(typeof host!=='function'||typeof pixelsPerBeat!=='function')throw new TypeError('RecordingRegionView needs host and pixelsPerBeat.');
  Object.assign(this,{host,pixelsPerBeat,doc,name});this.levels=new RecordingLevels();this.state='idle';this.element=null;this.take=null;
 }
 get active(){return this.state!=='idle';}
 /** `painter(context,{width,height,seconds})` replaces the level envelope (a MIDI take draws its notes). */
 begin({row,startSec,bpm,name=this.name,painter=null}){this.levels=new RecordingLevels();this.take={row,startSec,bpm,nowSec:startSec,name,painter:typeof painter==='function'?painter:null};this.state='recording';this.mount();this.paint();return this;}
 /** Advance to the song position `nowSec`, recording the level heard since the last call. */
 update({nowSec,level}){
  if(this.state!=='recording'||!this.take)return;
  if(Number.isFinite(nowSec)&&nowSec>this.take.nowSec)this.take.nowSec=nowSec;
  if(level!==null&&level!==undefined)this.levels.push(Math.max(0,this.take.nowSec-this.take.startSec),level);
  this.paint();
 }
 /** Stop growing; keep the region until the saved clip arrives (end()). */
 saving(){if(this.state==='recording'){this.state='saving';this.paint();}}
 end(){this.state='idle';this.take=null;this.element?.remove();this.element=null;}
 mount(){
  if(!this.active||!this.take)return null;
  const lane=this.host(this.take.row);if(!lane)return null;
  if(!this.element||!this.element.isConnected||this.element.parentElement!==lane){
   this.element?.remove();
   const element=this.doc.createElement('div');element.className='clip audio-clip logic-recording-region';element.setAttribute('aria-label','Recording');
   element.innerHTML='<div class="clip-title"></div><canvas class="logic-recording-canvas" aria-hidden="true"></canvas>';
   lane.append(element);this.element=element;
  }
  return this.element;
 }
 /** Display only: a paint failure must never disturb the take. */
 paint(){try{this.draw();}catch{}}
 draw(){
  const element=this.mount();if(!element)return;
  const {start,length}=recordingRegionBeats(this.take),scale=this.pixelsPerBeat(),width=Math.max(2,length*scale);
  element.style.left=`${start*scale}px`;element.style.width=`${width}px`;element.dataset.recordingState=this.state;
  const title=element.querySelector('.clip-title'),text=this.state==='saving'?`${this.take.name} · saving…`:this.take.name;if(title.textContent!==text)title.textContent=text;
  const canvas=element.querySelector('canvas'),context=canvas.getContext?.('2d');if(!context)return;
  const cssWidth=Math.min(8192,Math.ceil(width)),cssHeight=Math.max(8,(element.clientHeight||60)-15);
  if(canvas.width!==cssWidth)canvas.width=cssWidth;if(canvas.height!==cssHeight)canvas.height=cssHeight;
  canvas.style.width=`${cssWidth}px`;canvas.style.height=`${cssHeight}px`;
  const seconds=Math.max(1/RECORDING_LEVEL_HZ,this.take.nowSec-this.take.startSec);
  if(this.take.painter)this.take.painter(context,{width:cssWidth,height:cssHeight,seconds});else paintRecordingLevels(context,this.levels,{width:cssWidth,height:cssHeight,seconds});
 }
}
