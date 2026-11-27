import {assertAutomationJsonValue,assertAutomationWritePreservesData,LIVE_AUTOMATION_CONTRACT} from './audacity-automation-contract.js';
const clone=value=>structuredClone(value);
const unity=.25;
const control=(timeSec,value)=>({timeSec,value,curve:'linear',tension:0});
const edited=(point,value)=>({...clone(point),value,curve:'linear',tension:0});

/** Cloud gain automation subset: a linear-amplitude fade within a single
 * unity-gain region. This is nondestructive automation, not rendered DSP.
 */
export function planRegionFade({envelope,window,startSec,endSec,direction}={}){
 if(!['in','out'].includes(direction))throw new Error('Choose Fade In or Fade Out.');
 if(!Number.isFinite(startSec)||!Number.isFinite(endSec)||startSec<0||endSec<=startSec||!Number.isFinite(window?.durationSec)||endSec>window.durationSec)throw new Error('Select a nonempty region within one audio clip.');
 assertAutomationJsonValue(envelope);
 if(envelope?.target?.kind!=='clip_gain'||envelope.valueType!=='continuous'||!Array.isArray(envelope.points))throw new Error('Region fades require a canonical continuous clip-gain envelope.');
 assertAutomationWritePreservesData({points:envelope.points,envelope,window,contract:LIVE_AUTOMATION_CONTRACT});
 const atStart=envelope.points.filter(point=>point.timeSec===startSec),atEnd=envelope.points.filter(point=>point.timeSec===endSec),nonUnity=()=>{throw new Error('The selected region already has non-unity gain shaping. Choose an unchanged region; no fade was applied.');};
 if(atStart.length&&atStart.at(-1).value!==unity||atEnd.length&&atEnd[0].value!==unity||envelope.points.some(point=>point.timeSec>startSec&&point.timeSec<endSec&&point.value!==unity))nonUnity();
 for(let index=0;index+1<envelope.points.length;index++){
  const left=envelope.points[index],right=envelope.points[index+1];if(left.timeSec===right.timeSec||Math.max(startSec,left.timeSec)>=Math.min(endSec,right.timeSec))continue;
  if(left.value!==unity||left.curve!=='hold'&&right.value!==unity)nonUnity();
 }
 const points=envelope.points,left=points.filter(point=>point.timeSec<startSec).map(clone),right=points.filter(point=>point.timeSec>endSec).map(clone),from=direction==='in'?0:unity,to=direction==='in'?unity:0;
 let start,end;
 if(startSec===0)start=atStart.length?atStart.map(point=>edited(point,from)):[control(0,from)];
 else start=[atStart.length?clone(atStart[0]):control(startSec,unity),atStart.length===2?edited(atStart[1],from):control(startSec,from)];
 if(endSec===window.durationSec)end=atEnd.length?atEnd.map(point=>edited(point,to)):[control(endSec,to)];
 else{const previous=points.findLast(point=>point.timeSec<endSec),outside=atEnd.length?clone(atEnd.at(-1)):{...control(endSec,unity),curve:previous.curve??'linear',tension:previous.tension??0};end=[atEnd.length===2?edited(atEnd[0],to):control(endSec,to),outside];}
 const result=[...left,...start,...end,...right];
 assertAutomationWritePreservesData({points:result,envelope,window,contract:LIVE_AUTOMATION_CONTRACT});
 return {direction,startSec,endSec,points:result};
}
