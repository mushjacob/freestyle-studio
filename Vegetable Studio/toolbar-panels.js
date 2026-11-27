/** Toolbar panels that FL shows beside the time panel: the CPU / memory panel and
 *  the lit option buttons (countdown, loop recording). No audio or project I/O.
 *  Audio runs in the Freestyle cloud engine, so the panel reports what the
 *  browser can honestly measure: JS heap in MB and interface (main-thread) load. */

/** Share of the sampled time the main thread spent over its frame budget, 0..100. */
export function interfaceLoad(frameDeltas,budgetMs=1000/60){
 if(!Array.isArray(frameDeltas)||!frameDeltas.length||!(budgetMs>0))return 0;
 let total=0,over=0;
 for(const delta of frameDeltas){if(!Number.isFinite(delta)||delta<=0)continue;total+=delta;over+=Math.max(0,delta-budgetMs*1.25);}
 return total>0?Math.max(0,Math.min(100,Math.round(over/total*100))):0;
}

/** JS heap in whole megabytes, or null when the browser does not expose it. */
export function heapMegabytes(performanceLike=globalThis.performance){
 const used=performanceLike?.memory?.usedJSHeapSize;
 return Number.isFinite(used)&&used>=0?Math.round(used/1048576):null;
}

export function drawLoadGraph(canvas,history){
 const ctx=canvas?.getContext?.('2d');if(!ctx)return false;
 const {width,height}=canvas;ctx.clearRect(0,0,width,height);
 const step=width/Math.max(1,history.length-1);ctx.beginPath();ctx.moveTo(0,height);
 history.forEach((value,index)=>ctx.lineTo(index*step,height-1-Math.max(0,Math.min(100,value))/100*(height-2)));
 ctx.lineTo(width,height);ctx.closePath();ctx.fillStyle='#8fb7a655';ctx.fill();
 ctx.beginPath();history.forEach((value,index)=>{const y=height-1-Math.max(0,Math.min(100,value))/100*(height-2);if(index)ctx.lineTo(index*step,y);else ctx.moveTo(0,y);});
 ctx.strokeStyle='#c6e0db';ctx.lineWidth=1;ctx.stroke();return true;
}

/** Start the panel. Returns {stop, sample} (sample() is the testable tick). */
export function attachCpuPanel({memory,load,canvas,win=globalThis,points=46,intervalMs=500,probeMs=50}={}){
 // Load is measured as timer lateness (a busy main thread delays a 50 ms probe), not with a
 // permanent requestAnimationFrame loop, so the panel never keeps the page animating.
 const history=Array(points).fill(0),now=()=>win.performance?.now?.()??Date.now();let deltas=[],last=null,stopped=false;
 const probe=(at=now())=>{if(stopped)return;if(last!==null)deltas.push(at-last);last=at;if(deltas.length>240)deltas=deltas.slice(-240);};
 const sample=()=>{
  const hidden=win.document?.hidden===true,value=hidden?0:interfaceLoad(deltas,probeMs);deltas=[];if(hidden)last=null;
  history.push(value);history.shift();
  if(load&&load.textContent!==String(value))load.textContent=String(value);
  const mb=heapMegabytes(win.performance),text=mb===null?'–':String(mb);
  if(memory&&memory.textContent!==text)memory.textContent=text;
  try{drawLoadGraph(canvas,history);}catch{}return{load:value,memory:mb};
 };
 const probeTimer=win.setInterval?.(()=>probe(),probeMs)??null,timer=win.setInterval?.(sample,intervalMs)??null;probeTimer?.unref?.();timer?.unref?.();
 return{sample,probe,history,stop(){stopped=true;if(probeTimer!==null)win.clearInterval?.(probeTimer);if(timer!==null)win.clearInterval?.(timer);}};
}

/** A lit toolbar option button whose state lives elsewhere (localStorage-backed options). */
export function bindToolbarToggle(button,{get,set}){
 if(!button)return()=>{};
 const paint=()=>{const on=!!get();button.classList.toggle('lit',on);button.setAttribute('aria-pressed',String(on));};
 button.addEventListener('click',()=>{set(!get());paint();});paint();return paint;
}
