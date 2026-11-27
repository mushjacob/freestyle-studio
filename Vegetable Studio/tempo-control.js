/** FL-style tempo field behaviour: drag, wheel, tap. Pure helpers plus a thin DOM attach. */
export const TEMPO_MIN=10,TEMPO_MAX=522;
const clampTempo=value=>Math.round(Math.max(TEMPO_MIN,Math.min(TEMPO_MAX,value))*1000)/1000;

/** Dragging down lowers the tempo by 1 BPM per 4 px; Shift (fine) uses 0.01 BPM per 4 px. */
export function dragTempo(startBpm,deltaY,{fine=false}={}){
 const start=Number(startBpm),delta=Number(deltaY);
 if(!Number.isFinite(start))return TEMPO_MIN;
 if(!Number.isFinite(delta))return clampTempo(start);
 return clampTempo(start-delta/4*(fine?.01:1));
}

/** BPM from the average of the last 4 tap intervals, or null (under 2 taps or a gap over 2 s). */
export function tapTempo(timestampsMs){
 const taps=(Array.isArray(timestampsMs)?timestampsMs:[]).map(Number).filter(Number.isFinite);
 if(taps.length<2)return null;
 const recent=taps.slice(-5),gaps=[];
 for(let i=1;i<recent.length;i++)gaps.push(recent[i]-recent[i-1]);
 if(gaps.some(gap=>gap>2000||gap<=0))return null;
 const average=gaps.reduce((sum,gap)=>sum+gap,0)/gaps.length;
 return clampTempo(60000/average);
}

/** Wire the tempo field. setBpm must commit through the existing tempo-change path, once per gesture. */
export function attachTempoControl(input,{getBpm,setBpm,enabled=()=>!input.disabled,tapButton=null,now=()=>Date.now(),onContextMenu=null}={}){
 if(!input)return()=>{};
 let drag=null,taps=[];
 const on=(target,type,handler,options)=>{target.addEventListener(type,handler,options);return()=>target.removeEventListener(type,handler,options);};
 const off=[];
 off.push(on(input,'pointerdown',event=>{
  if(event.button!==0||!enabled()||document.activeElement===input)return;
  event.preventDefault();
  drag={id:event.pointerId,y:event.clientY,start:Number(getBpm()),value:null};
  try{input.setPointerCapture(event.pointerId);}catch{}
 }));
 off.push(on(input,'pointermove',event=>{
  if(!drag||event.pointerId!==drag.id)return;
  drag.value=dragTempo(drag.start,event.clientY-drag.y,{fine:event.shiftKey});
  input.value=String(drag.value);
 }));
 const finish=event=>{
  if(!drag||event.pointerId!==drag.id)return;
  const {value,start}=drag;drag=null;
  try{input.releasePointerCapture(event.pointerId);}catch{}
  if(value!==null&&value!==start)setBpm(value);else input.value=String(start);
 };
 off.push(on(input,'pointerup',finish));
 off.push(on(input,'pointercancel',event=>{if(drag&&event.pointerId===drag.id){input.value=String(drag.start);drag=null;}}));
 off.push(on(input,'wheel',event=>{
  if(!enabled())return;
  event.preventDefault();
  const step=(event.shiftKey?.01:1)*(event.deltaY<0?1:-1),current=Number(getBpm());
  if(Number.isFinite(current)&&event.deltaY!==0)setBpm(clampTempo(current+step));
 },{passive:false}));
 const focusField=event=>{if(event.type==='contextmenu'&&onContextMenu){event.preventDefault();onContextMenu(event);return;}if(!enabled())return;if(event.type==='contextmenu')event.preventDefault();input.focus();input.select?.();};
 off.push(on(input,'contextmenu',focusField));
 off.push(on(input,'dblclick',focusField));
 if(tapButton)off.push(on(tapButton,'click',()=>{
  if(!enabled())return;
  const t=now();
  if(taps.length&&t-taps[taps.length-1]>2000)taps=[];
  taps.push(t);taps=taps.slice(-5);
  const bpm=tapTempo(taps);
  if(bpm!==null)setBpm(bpm);
 }));
 return()=>off.forEach(fn=>fn());
}
