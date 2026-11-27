/** Pure horizontal viewport policy from Audacity 3.7.1; no project edits.
 * Sources (tag Audacity-3.7.1 in https://github.com/audacity/audacity):
 * src/menus/ViewMenus.cpp, src/prefs/TracksPrefs.cpp,
 * libraries/lib-viewport/Viewport.cpp, libraries/lib-screen-geometry/ZoomInfo.*
 */
export const MIN_ZOOM=.001,MAX_ZOOM=6000000,NORMAL_ZOOM=44100/512;
export const DEFAULT_ZOOM_TOGGLE=Object.freeze(['ZoomDefault','FourPixelsPerSample']);
export const ZOOM_PRESETS=Object.freeze([
 ['FitToWidth','Fit to Width'],['ZoomToSelection','Zoom to Selection'],['ZoomDefault','Zoom Default'],
 ['Minutes','Minutes'],['Seconds','Seconds'],['FifthsOfSeconds','5ths of Seconds'],['TenthsOfSeconds','10ths of Seconds'],
 ['TwentiethsOfSeconds','20ths of Seconds'],['FiftiethsOfSeconds','50ths of Seconds'],['HundredthsOfSeconds','100ths of Seconds'],
 ['FiveHundredthsOfSeconds','500ths of Seconds'],['MilliSeconds','MilliSeconds'],['Samples','Samples'],
 ['FourPixelsPerSample','4 Pixels per Sample'],['MaxZoom','Max Zoom'],
].map(([id,label],index)=>Object.freeze({id,label,index})));
const number=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`${label} must be finite.`);return value;};
export function clampZoom(value){return Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,number(value,'Zoom')));}
function context(input={}){
 const scale=clampZoom(input.scale??NORMAL_ZOOM),width=number(input.width,'Usable track width'),leftSec=number(input.leftSec??0,'Viewport start'),projectEnd=number(input.projectEnd??0,'Project end');
 const start=number(input.selection?.start??0,'Selection start'),end=number(input.selection?.end??start,'Selection end');
 if(width<=0||leftSec<0||projectEnd<0||start<0||end<start)throw new RangeError('Viewport width must be positive and project/selection times ordered and non-negative.');
 return {...input,scale,width,leftSec,projectEnd,selection:{start,end}};
}
export function projectFitZoom(input){const c=context(input);return c.projectEnd>0?clampZoom((c.width-10)/c.projectEnd):c.scale;}
export function selectionFitZoom(input){const c=context(input),duration=c.selection.end-Math.max(c.selection.start,0);return duration>0?clampZoom((c.width-1)/duration):c.scale;}
export function resolveZoomPreset(preset,input){
 const c=context(input),id=typeof preset==='number'?ZOOM_PRESETS[preset]?.id:preset;
 const fixed={ZoomDefault:NORMAL_ZOOM,Minutes:5/60,Seconds:5,FifthsOfSeconds:25,TenthsOfSeconds:50,TwentiethsOfSeconds:100,FiftiethsOfSeconds:250,HundredthsOfSeconds:500,FiveHundredthsOfSeconds:2500,MilliSeconds:5000,Samples:44100,FourPixelsPerSample:176400,MaxZoom:MAX_ZOOM};
 let result=id==='FitToWidth'?projectFitZoom(c):id==='ZoomToSelection'?selectionFitZoom(c):fixed[id]??NORMAL_ZOOM;
 // Native GetZoomOfPreset limits preset zoom-out to four times project fit.
 return clampZoom(Math.max(result,projectFitZoom(c)/4));
}
export function pickToggle(currentScale,preset1=DEFAULT_ZOOM_TOGGLE[0],preset2=DEFAULT_ZOOM_TOGGLE[1],input){
 const scale=clampZoom(currentScale),first=resolveZoomPreset(preset1,{...input,scale}),second=resolveZoomPreset(preset2,{...input,scale});
 return Math.abs(Math.log(first/scale))>Math.abs(Math.log(scale/second))?first:second;
}
function absoluteZoomLeft(c,scale){
 // Preserve the literal 3.7.1 Viewport::Zoom expression. Unlike the source's
 // temporary float variables, these calculations do not reduce time precision.
 const available=c.width/scale,onLeft=(available-c.selection.start+c.selection.end)/2;
 return onLeft>=0?c.selection.start-onLeft:c.leftSec;
}
function selectionAnchor(c){
 const end=c.leftSec+c.width/c.scale,{start:t0,end:t1}=c.selection;
 const visible=t0<end&&t1>=c.leftSec,fills=t0<c.leftSec&&t1>end;
 if(!visible||fills)return {time:c.leftSec+c.width/c.scale/2,kind:'center'};
 let time=(t0+t1)/2;
 if(time<c.leftSec)time=c.leftSec+(t1-c.leftSec)/2;
 if(time>end)time=end-(end-t0)/2;
 return {time,kind:'selection-visible'};
}
function finish(c,scale,leftSec,anchor){
 const duration=c.width/scale,lastTime=Math.max(c.projectEnd,c.selection.end);
 // UpdateScrollbarsForTracks reserves a quarter screen after the last audio
 // or selection endpoint, while retaining time already visible at the right.
 const total=Math.max(lastTime+duration/4,c.leftSec+duration);
 // Round the movement around the current origin before adding that origin
 // back. Multiplying a late absolute time first loses sample-zoom detail.
 const maximumSec=Math.max(0,total-c.width/scale),deltaPx=Math.floor(.5+(leftSec-c.leftSec)*scale);
 const nextLeft=Math.max(0,Math.min(maximumSec,c.leftSec+deltaPx/scale));
 return {scale,leftSec:nextLeft,scrollLeftPx:nextLeft*scale,anchor};
}
export function zoomViewport(input){
 const c=context(input);let scale,leftSec,anchor;
 switch(c.command){
  case 'in':{
   scale=clampZoom(c.scale*2);
   if(c.playing&&!c.paused){
    const playhead=number(c.playheadSec,'Active playback position');if(playhead<0)throw new RangeError('Playback position must be non-negative.');
    const pixel=Math.floor(.5+(playhead-c.leftSec)*scale);leftSec=pixel<0||pixel>=c.width?playhead-c.width/scale/2:c.leftSec;anchor='playhead';
   }else{const selected=selectionAnchor(c);leftSec=selected.time-c.width/scale/2;anchor=selected.kind;}
   break;
  }
  case 'out':scale=clampZoom(c.scale*.5);leftSec=c.leftSec+(c.width/c.scale-c.width/scale)/2;anchor='center';break;
  case 'normal':scale=NORMAL_ZOOM;leftSec=absoluteZoomLeft(c,scale);anchor='native-absolute';break;
  case 'toggle':{
   const presets=c.presets??DEFAULT_ZOOM_TOGGLE;if(!Array.isArray(presets)||presets.length!==2)throw new Error('Choose exactly two zoom presets.');
   scale=pickToggle(c.scale,presets[0],presets[1],c);leftSec=absoluteZoomLeft(c,scale);anchor='native-absolute';break;
  }
  case 'fit-selection':scale=selectionFitZoom(c);leftSec=c.selection.start;anchor='selection-start';break;
  case 'fit-project':scale=projectFitZoom(c);leftSec=0;anchor='project-start';break;
  case 'factor':{
   const factor=number(c.factor,'Zoom factor');if(factor<=0)throw new RangeError('Zoom factor must be positive.');
   const pixel=number(c.anchorPx??c.width/2,'Zoom anchor');scale=clampZoom(c.scale*factor);leftSec=c.leftSec+pixel/c.scale-pixel/scale;anchor='pointer';break;
  }
  default:throw new Error('Unsupported horizontal zoom command.');
 }
 return finish(c,scale,leftSec,anchor);
}
