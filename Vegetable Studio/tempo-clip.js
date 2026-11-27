/**
 * FL tempo automation clip: a pure VIEW over Freestyle's revisioned timing map
 * (document.tempo = [{tick,bpm,curve,end_bpm?}], 96 PPQ). No data model of its own.
 *
 * Point model: one point per tempo segment, {tick,bpm,curve}. curve 'step' holds
 * the tempo until the next point (the map's "constant"); 'linear' ramps linearly in
 * beats to the NEXT point's bpm (the map's "linear" with end_bpm = next bpm).
 * Anything else the map can hold (a ramp that ends at a value different from the next
 * segment's start, an unknown curve, a trailing ramp) is shown read-only with a reason.
 *
 * Playlist axis: clips are anchored in SECONDS and drawn at seconds * projectBpm / 60
 * "axis beats" (cloud-session). So under tempo changes a musical bar does not sit at
 * 4 axis beats; rulerLayout() puts every bar line where the engine's tempo map plays it.
 */
export const TEMPO_PPQ=96,TEMPO_MIN=10,TEMPO_MAX=522,TEMPO_MAX_SEGMENTS=1024,TEMPO_MAX_TICK=2**31-1;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const round3=v=>Math.round(v*1000)/1000;
const clampBpm=v=>round3(Math.max(TEMPO_MIN,Math.min(TEMPO_MAX,v)));
const fail=message=>{throw Object.assign(new Error(message),{code:'tempo_clip_invalid'});};
const curveOf=c=>{const k=String(c??'constant').toLowerCase();return k==='linear'||k==='ramp'?'linear':k==='constant'||k==='step'?'step':null;};

/** Read the timing-map document into editable points. Never throws: `editable:false` carries a reason. */
export function tempoPointsFromDocument(doc){
 const raw=Array.isArray(doc?.tempo)?doc.tempo:[];
 if(!raw.length)return{points:[{tick:0,bpm:120,curve:'step'}],editable:false,reason:'The project has no tempo map to show yet.'};
 const points=[];let reason=null;
 const sorted=raw.map(s=>({...s})).sort((a,b)=>(Number(a.tick)||0)-(Number(b.tick)||0));
 sorted.forEach((s,i)=>{
  const curve=curveOf(s.curve),next=sorted[i+1],bpm=Number(s.bpm);
  if(!curve&&!reason)reason=`Tempo segment ${i+1} uses a curve (${String(s.curve)}) the tempo lane cannot draw.`;
  if(!finite(bpm)||bpm<TEMPO_MIN||bpm>TEMPO_MAX){reason||=`Tempo segment ${i+1} has no valid BPM.`;}
  let out=curve||'step';
  if(out==='linear'){
   if(!next){reason||='The last tempo segment is a ramp with no end point; the tempo lane cannot edit it.';out='step';}
   else if(finite(Number(s.end_bpm))&&s.end_bpm!=null&&Math.abs(Number(s.end_bpm)-Number(next.bpm))>1e-9)reason||=`The ramp at tick ${Number(s.tick)||0} ends at ${s.end_bpm} BPM but the next segment starts at ${next.bpm} BPM; the tempo lane cannot draw that jump.`;
  }
  points.push({tick:Math.max(0,Math.round(Number(s.tick)||0)),bpm:finite(bpm)?bpm:120,curve:out});
 });
 if(points[0].tick!==0&&!reason)reason='The tempo map does not start at tick 0.';
 return{points,editable:!reason,reason};
}

/** Points -> timing-map `tempo` list (what set_timing_map takes). The last segment never ramps. */
export function tempoPointsToSegments(points){
 if(!Array.isArray(points)||!points.length)fail('A tempo lane needs at least one point.');
 if(points.length>TEMPO_MAX_SEGMENTS)fail(`A project holds at most ${TEMPO_MAX_SEGMENTS} tempo segments.`);
 const sorted=points.map(p=>({...p})).sort((a,b)=>a.tick-b.tick);
 if(sorted[0].tick!==0)fail('The first tempo point must be at tick 0.');
 return sorted.map((p,i)=>{
  if(!Number.isInteger(p.tick)||p.tick<0||p.tick>TEMPO_MAX_TICK)fail('Tempo points must sit on whole ticks.');
  if(i&&p.tick===sorted[i-1].tick)fail(`Two tempo points sit at tick ${p.tick}.`);
  if(!finite(p.bpm)||p.bpm<TEMPO_MIN||p.bpm>TEMPO_MAX)fail(`Tempo must be ${TEMPO_MIN}–${TEMPO_MAX} BPM.`);
  const linear=p.curve==='linear'&&i<sorted.length-1;
  return{tick:p.tick,bpm:round3(p.bpm),curve:linear?'linear':'constant'};
 });
}

/** Snap a tick to a grid given in quarter-note beats (0 or invalid = whole ticks). */
export function snapTick(tick,snapBeats=0){
 const t=Math.max(0,Number(tick)||0),grid=Math.round((Number(snapBeats)||0)*TEMPO_PPQ);
 return grid>0?Math.round(t/grid)*grid:Math.round(t);
}

/** BPM at a tick on the point curve (ramps interpolate linearly in beats, steps hold). */
export function tempoValueAtTick(points,tick){
 let i=0;for(let k=0;k<points.length;k++)if(points[k].tick<=tick)i=k;
 const p=points[i],n=points[i+1];
 if(p.curve==='linear'&&n)return p.bpm+(n.bpm-p.bpm)*(tick-p.tick)/(n.tick-p.tick);
 return p.bpm;
}

/** Add a point; bpm null keeps the existing curve shape. An existing point at the tick takes the new bpm. */
export function addTempoPoint(points,{tick,bpm=null}){
 if(points.length>=TEMPO_MAX_SEGMENTS)fail(`A project holds at most ${TEMPO_MAX_SEGMENTS} tempo segments.`);
 const t=Math.round(tick);if(!Number.isInteger(t)||t<0||t>TEMPO_MAX_TICK)fail('Choose a position inside the project.');
 const value=bpm==null?round3(tempoValueAtTick(points,t)):clampBpm(bpm),existing=points.findIndex(p=>p.tick===t);
 if(existing>=0)return{points:points.map((p,i)=>i===existing?{...p,bpm:value}:{...p}),index:existing};
 const out=points.map(p=>({...p})),at=out.findIndex(p=>p.tick>t),index=at<0?out.length:at,prev=out[index-1];
 out.splice(index,0,{tick:t,bpm:value,curve:prev.curve==='linear'?'linear':'step'});
 return{points:out,index};
}

/** Move a point. The first point stays at tick 0; ticks stay strictly between the neighbours. */
export function moveTempoPoint(points,index,{tick=null,bpm=null}={}){
 const p=points[index];if(!p)fail('There is no such tempo point.');
 const out=points.map(q=>({...q}));
 if(bpm!=null)out[index].bpm=clampBpm(bpm);
 if(tick!=null&&index>0){
  const lo=out[index-1].tick+1,hi=index<out.length-1?out[index+1].tick-1:TEMPO_MAX_TICK;
  if(hi>=lo)out[index].tick=Math.max(lo,Math.min(hi,Math.round(tick)));
 }
 return out;
}

export function deleteTempoPoint(points,index){
 if(!points[index])fail('There is no such tempo point.');
 if(index===0)fail('The first tempo point is the project tempo; it cannot be deleted.');
 const out=points.filter((_,i)=>i!==index).map(p=>({...p}));
 out[out.length-1].curve='step';
 return out;
}

/** 'step' or 'linear' for the segment leaving this point. */
export function setTempoPointCurve(points,index,curve){
 if(!points[index])fail('There is no such tempo point.');
 const c=curveOf(curve);if(!c)fail('The timing map only holds steps and linear ramps.');
 if(c==='linear'&&index===points.length-1)fail('The last tempo point has no next point to ramp to.');
 return points.map((p,i)=>i===index?{...p,curve:c}:{...p});
}

/** What each gesture may do, with the reason a disabled one gives (for off(label,reason) menu items). */
export function tempoGestureAvailability(model,index=-1){
 if(!model?.editable)return{add:{ok:false,reason:model?.reason||'Tempo lane is read-only.'},move:{ok:false,reason:model?.reason},remove:{ok:false,reason:model?.reason},curve:{ok:false,reason:model?.reason}};
 const n=model.points.length,has=index>=0&&index<n;
 return{
  add:n>=TEMPO_MAX_SEGMENTS?{ok:false,reason:`A project holds at most ${TEMPO_MAX_SEGMENTS} tempo segments.`}:{ok:true},
  move:has?{ok:true}:{ok:false,reason:'Select a tempo point.'},
  remove:!has?{ok:false,reason:'Select a tempo point.'}:index===0?{ok:false,reason:'The first point is the project tempo.'}:{ok:true},
  curve:!has?{ok:false,reason:'Select a tempo point.'}:index===n-1?{ok:false,reason:'The last point has no next point to ramp to.'}:{ok:true}
 };
}

/** Vertical display range for a set of points (BPM), padded and never narrower than 40 BPM. */
export function tempoDisplayRange(points){
 const values=points.map(p=>p.bpm);let lo=Math.min(...values),hi=Math.max(...values);
 lo=Math.max(TEMPO_MIN,lo-20);hi=Math.min(TEMPO_MAX,hi+20);
 if(hi-lo<40){const mid=(lo+hi)/2;lo=Math.max(TEMPO_MIN,mid-20);hi=Math.min(TEMPO_MAX,lo+40);lo=Math.max(TEMPO_MIN,hi-40);}
 return{lo,hi};
}
export const bpmToY=(bpm,{lo,hi},height,pad=8)=>pad+(1-(bpm-lo)/(hi-lo||1))*(height-2*pad);
export const yToBpm=(y,{lo,hi},height,pad=8)=>lo+(1-(y-pad)/(height-2*pad||1))*(hi-lo);

/* ---------------- timing-map time conversion (same closed forms as the engine) ---------------- */

/** Immutable tempo/meter timeline from a timing-map document. Mirrors timing_map.py / TempoMap.h. */
export function buildTempoTimeline(doc,fallbackBpm=120){
 const ppq=TEMPO_PPQ,rawTempo=Array.isArray(doc?.tempo)&&doc.tempo.length?doc.tempo:[{tick:0,bpm:fallbackBpm,curve:'constant'}];
 const tempo=rawTempo.map(s=>({tick:Math.max(0,Number(s.tick)||0),bpm:finite(Number(s.bpm))&&Number(s.bpm)>0?Number(s.bpm):120,linear:curveOf(s.curve)==='linear',endBpm:Number(s.end_bpm)>0?Number(s.end_bpm):null})).sort((a,b)=>a.tick-b.tick);
 if(tempo[0].tick!==0)tempo.unshift({...tempo[0],tick:0,linear:false});
 const segs=[];let sec=0;
 tempo.forEach((s,i)=>{
  const next=tempo[i+1];let slope=0,endBpm=s.bpm;
  if(s.linear&&next){endBpm=s.endBpm||next.bpm;const span=(next.tick-s.tick)/ppq;slope=span>0?(endBpm-s.bpm)/span:0;}
  segs.push({beat:s.tick/ppq,bpm:s.bpm,slope,endBpm,sec});
  if(next)sec+=segSeconds(segs[i],(next.tick-s.tick)/ppq);
 });
 const pickupTicks=Math.max(0,Math.round(Number(doc?.pickup_ticks)||0));
 const meterIn=(Array.isArray(doc?.meter)&&doc.meter.length?doc.meter:[{bar:1,numerator:4,denominator:4}]).map(m=>({bar:Math.max(1,Math.round(Number(m.bar)||1)),numerator:Math.max(1,Math.round(Number(m.numerator)||4)),denominator:Math.max(1,Math.round(Number(m.denominator)||4))})).sort((a,b)=>a.bar-b.bar);
 const meters=[];
 for(const m of meterIn){
  const barBeats=m.numerator*4/m.denominator;
  if(!meters.length){meters.push({...m,bar:1,beat:pickupTicks/ppq,barBeats});continue;}
  const prev=meters.at(-1);if(m.bar<=prev.bar)continue;
  meters.push({...m,beat:prev.beat+(m.bar-prev.bar)*prev.barBeats,barBeats});
 }
 const find=(arr,key,value)=>{let lo=0,hi=arr.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(arr[mid][key]<=value)lo=mid;else hi=mid-1;}return arr[lo];};
 return{
  ppq,segs,meters,pickupTicks,
  beatsToSeconds(beat){if(!(beat>0))return beat<0?beat*60/segs[0].bpm:0;const s=find(segs,'beat',beat);return s.sec+segSeconds(s,beat-s.beat);},
  secondsToBeats(sec){if(!(sec>0))return sec<0?sec*segs[0].bpm/60:0;const s=find(segs,'sec',sec),dt=sec-s.sec;if(Math.abs(s.slope)<1e-12)return s.beat+dt*s.bpm/60;return s.beat+s.bpm/s.slope*Math.expm1(s.slope*dt/60);},
  bpmAtBeat(beat){const s=find(segs,'beat',Math.max(0,beat));return s.bpm+s.slope*Math.max(0,beat-s.beat);}
 };
}
function segSeconds(seg,beatsIn){
 if(Math.abs(seg.slope)<1e-12)return 60*beatsIn/seg.bpm;
 return 60/seg.slope*Math.log1p(seg.slope*beatsIn/seg.bpm);
}
/** Musical quarter-note beat <-> Playlist axis beat (seconds * refBpm / 60). */
export const axisOfBeat=(tl,beat,refBpm)=>tl.beatsToSeconds(beat)*refBpm/60;
export const beatOfAxis=(tl,axis,refBpm)=>tl.secondsToBeats(axis*60/refBpm);
export const tickOfAxis=(tl,axis,refBpm)=>beatOfAxis(tl,axis,refBpm)*TEMPO_PPQ;
export const axisOfTick=(tl,tick,refBpm)=>axisOfBeat(tl,tick/TEMPO_PPQ,refBpm);

/** True when the legacy fixed grid (4 axis beats per bar) is already exact. */
export function isUniformGrid(doc){
 if(!doc)return true;
 const tempo=Array.isArray(doc.tempo)?doc.tempo:[],meter=Array.isArray(doc.meter)?doc.meter:[];
 const constant=tempo.length<=1&&(!tempo.length||curveOf(tempo[0].curve)==='step');
 const meterOk=meter.length===0||meter.length===1&&Number(meter[0].numerator)===4&&Number(meter[0].denominator)===4;
 return constant&&meterOk&&!(Number(doc.pickup_ticks)>0);
}

/**
 * Bar and beat positions on the Playlist axis. `bars[i]` = {number,startAxis,endAxis,startBeat,endBeat,
 * numerator,denominator,pickup,beatAxis[]} covering at least minAxisBeats. Bar 0 is the pickup.
 */
export function rulerLayout(doc,{refBpm=120,minAxisBeats=0,maxBars=4096}={}){
 const tl=buildTempoTimeline(doc,refBpm),bars=[],axis=beat=>axisOfBeat(tl,beat,refBpm);
 const addBar=(number,startBeat,barBeats,meter,pickup=false)=>{
  const endBeat=startBeat+barBeats,unit=pickup?barBeats:4/meter.denominator,beatAxis=[];
  const count=pickup?1:meter.numerator;
  for(let k=0;k<count;k++)beatAxis.push(axis(startBeat+k*unit));
  bars.push({number,startAxis:axis(startBeat),endAxis:axis(endBeat),startBeat,endBeat,numerator:meter.numerator,denominator:meter.denominator,pickup,beatAxis});
 };
 const first=tl.meters[0];
 if(tl.pickupTicks>0)addBar(0,0,tl.pickupTicks/TEMPO_PPQ,first,true);
 for(let m=0;m<tl.meters.length&&bars.length<maxBars;m++){
  const meter=tl.meters[m],last=m===tl.meters.length-1,endBar=last?Infinity:tl.meters[m+1].bar;
  for(let bar=meter.bar;bar<endBar&&bars.length<maxBars;bar++){
   const startBeat=meter.beat+(bar-meter.bar)*meter.barBeats;
   addBar(bar,startBeat,meter.barBeats,meter);
   if(last&&bars.at(-1).endAxis>=minAxisBeats)break;
  }
 }
 return{bars,totalAxis:bars.length?bars.at(-1).endAxis:0,uniform:isUniformGrid(doc)};
}

/** Sample the tempo curve for drawing: [{axis,bpm}], with a repeated axis at a step jump. */
export function tempoCurveSamples(points,tl,refBpm,{endAxis=0,samplesPerRamp=24}={}){
 const out=[],ax=tick=>axisOfTick(tl,tick,refBpm);
 points.forEach((p,i)=>{
  const n=points[i+1];
  out.push({axis:ax(p.tick),bpm:p.bpm});
  if(!n)return;
  if(p.curve==='linear'){
   for(let s=1;s<samplesPerRamp;s++){const tick=p.tick+(n.tick-p.tick)*s/samplesPerRamp;out.push({axis:ax(tick),bpm:p.bpm+(n.bpm-p.bpm)*s/samplesPerRamp});}
  }else out.push({axis:ax(n.tick),bpm:p.bpm});
 });
 const last=points.at(-1);
 if(endAxis>out.at(-1).axis)out.push({axis:endAxis,bpm:last.bpm});
 return out;
}

/** SVG for the warped Playlist grid (bar + beat lines in px) as a data URI; one image is shared by every lane. */
export function gridSvgDataUri(layout,{barWidth=30}={}){
 const px=barWidth/4,W=Math.max(1,Math.ceil(layout.totalAxis*px)),f=v=>(Math.round(v*px*100)/100).toFixed(2).replace(/\.?0+$/,'');
 let shade='',beats='',barsPath='';
 for(const bar of layout.bars){
  if(bar.number%2===1)shade+=`<rect x="${f(bar.startAxis)}" y="0" width="${f(bar.endAxis-bar.startAxis)}" height="1"/>`;
  barsPath+=`M${f(bar.startAxis)} 0V1`;
  bar.beatAxis.slice(1).forEach(a=>{beats+=`M${f(a)} 0V1`;});
 }
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="1" viewBox="0 0 ${W} 1" preserveAspectRatio="none" shape-rendering="crispEdges"><g fill="#8a969c" fill-opacity=".03">${shade}</g><path d="${beats}" stroke="#203641" stroke-width="1" fill="none"/><path d="${barsPath}" stroke="#152a34" stroke-width="1" fill="none"/></svg>`;
 return{uri:`data:image/svg+xml,${encodeURIComponent(svg)}`,width:W};
}
