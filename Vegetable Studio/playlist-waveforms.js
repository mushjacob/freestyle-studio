/** Playlist audio-clip waveforms painted on canvas from the shared peak pyramid
 *  (waveform-pyramid.js). A waveform that has been seen once is never replaced by
 *  a placeholder: scroll, zoom, move, trim and slip repaint synchronously from
 *  cached peaks; finer tiles land later and repaint through the pyramid's onUpdate.
 *  This module only draws peak buckets. It never decodes or plays audio. */
export const WAVE_TITLE_PX=14;
const finite=value=>typeof value==='number'&&Number.isFinite(value);

/** Which part of a clip to draw. All x values are playlist content px (beat 0 = 0).
 *  Returns null when the clip does not intersect the (margin-extended) viewport. */
export function waveformCanvasPlan({startBeat,lengthBeats,offsetSec=0,pixelsPerBeat,bpm,viewLeftPx,viewRightPx,marginPx=240,maxWidthPx=8192}){
 if(![startBeat,lengthBeats,offsetSec,pixelsPerBeat,bpm,viewLeftPx,viewRightPx].every(finite)||lengthBeats<=0||pixelsPerBeat<=0||bpm<=0||offsetSec<0)return null;
 const clipLeft=startBeat*pixelsPerBeat,clipRight=clipLeft+lengthBeats*pixelsPerBeat;
 let left=Math.max(clipLeft,viewLeftPx-marginPx),right=Math.min(clipRight,viewRightPx+marginPx);
 if(!(right>left))return null;
 if(right-left>maxWidthPx)right=left+maxWidthPx;
 const secondsPerPx=60/bpm/pixelsPerBeat;
 return{left:left-clipLeft,width:right-left,startSec:offsetSec+(left-clipLeft)*secondsPerPx,endSec:offsetSec+(right-clipLeft)*secondsPerPx};
}

/** The source offset of a clip in seconds: the model's beats offset when known,
 *  else the placement Freestyle reported with the peaks, else 0. */
export function clipOffsetSeconds(clip,bpm,info){
 if(clip?.offsetKnown!==false&&finite(clip?.offset)&&clip.offset>=0&&bpm>0)return clip.offset*60/bpm;
 const placement=info?.placement,frames=placement?.audio_offset_frames??placement?.audioOffsetFrames;
 return finite(frames)&&info?.sampleRate>0?frames/info.sampleRate:0;
}

export const audioWaveMarkup=()=>'<span class="audio-waveform" style="display:contents"><canvas class="audio-wave-canvas" aria-hidden="true"></canvas><div class="audio-clip-label" title="Waveform loads from Freestyle when this clip is visible.">CLOUD AUDIO</div></span>';

export class PlaylistWaveformPainter{
 constructor({pyramid,getView,getBpm,devicePixelRatio=()=>globalThis.devicePixelRatio||1,color='#dbe6f4',rmsColor='rgba(255,255,255,.34)'}={}){
  if(!pyramid||typeof getView!=='function'||typeof getBpm!=='function')throw new TypeError('PlaylistWaveformPainter needs pyramid, getView and getBpm.');
  Object.assign(this,{pyramid,getView,getBpm,devicePixelRatio,color,rmsColor});this.paints=0;
 }
 /** Paint one clip element now. `geometry` overrides {start,length,offset} during a gesture. */
 paint(element,clip,geometry=null){
  const canvas=element?.querySelector?.('canvas.audio-wave-canvas'),id=clip?.liveWaveformId||clip?.cloudId;
  if(!canvas||!id)return'none';
  const view=this.getView(),bpm=this.getBpm(),info=this.pyramid.info(id),shape={...clip,...(geometry||{})};
  const plan=waveformCanvasPlan({startBeat:shape.start,lengthBeats:shape.length,offsetSec:clip.liveWaveformId?0:clipOffsetSeconds(shape,bpm,info),pixelsPerBeat:view.pixelsPerBeat,bpm,viewLeftPx:view.leftPx,viewRightPx:view.rightPx});
  const label=element.querySelector('.audio-clip-label');
  if(!plan){canvas.dataset.waveformStatus=this.pyramid.has(id)?'offscreen':'idle';return canvas.dataset.waveformStatus;}
  if(!info){this.pyramid.prefetch(id);canvas.dataset.waveformStatus='empty';if(label)label.hidden=false;return'empty';}
  const ratio=Math.max(1,Math.min(3,this.devicePixelRatio())),height=Math.max(8,(element.clientHeight||view.rowHeight||56)-WAVE_TITLE_PX-2);
  const pixelWidth=Math.max(1,Math.round(plan.width*ratio)),pixelHeight=Math.max(1,Math.round(height*ratio));
  const style=canvas.style,left=`${plan.left}px`,width=`${plan.width}px`,cssHeight=`${height}px`;
  if(style.left!==left)style.left=left;if(style.width!==width)style.width=width;if(style.height!==cssHeight)style.height=cssHeight;
  // Setting width/height clears the bitmap; the repaint below happens in the same task, so nothing blank is ever shown.
  if(canvas.width!==pixelWidth)canvas.width=pixelWidth;if(canvas.height!==pixelHeight)canvas.height=pixelHeight;
  const gain=finite(shape.volume)&&shape.volume>=0?shape.volume:1,context=canvas.getContext?.('2d')||null,ctx=context&&['setTransform','clearRect','rect','fill','beginPath'].every(name=>typeof context[name]==='function')?context:null;
  let status;
  if(ctx){ctx.setTransform(ratio,0,0,ratio,0,0);status=this.pyramid.paint(ctx,id,{x:0,y:0,width:plan.width,height,startSec:plan.startSec,endSec:plan.endSec,gain,color:this.color,rmsColor:this.rmsColor,clear:true}).status;}
  else{const rate=info.sampleRate;status=this.pyramid.columns(id,{startFrame:plan.startSec*rate,endFrame:plan.endSec*rate,columns:pixelWidth}).status;}
  canvas.dataset.waveformStatus=status;canvas.dataset.waveformRevision=String(info.revision??'');
  canvas.dataset.waveformRange=`${plan.startSec.toFixed(6)}:${plan.endSec.toFixed(6)}`;
  // The placeholder is allowed only while nothing at all is cached for this clip.
  if(label)label.hidden=status!=='empty';
  this.paints++;return status;
 }
}
