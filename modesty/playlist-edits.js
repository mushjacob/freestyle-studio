import {patternLengthBeats} from './pattern-preview.js';
const number=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const positive=(value,fallback)=>number(value)>0?Number(value):fallback;
const mod=(value,length)=>((value%length)+length)%length;
const near=(a,b)=>Math.abs(a-b)<1e-7;

/** Snap movement, not authoritative source coordinates. */
export function computePlaylistGesture(clip,{deltaBeats=0,deltaTracks=0,snapBeats=.25,resize=false,maxTrack=Infinity,bpm=120}={}){
 const next={...clip},delta=snapBeats>0?Math.round(deltaBeats/snapBeats)*snapBeats:deltaBeats;
 if(resize){
  if(delta===0)return next;
  const minimum=.001*positive(bpm,120)/60;
  let maximum=Infinity;
  if(!clip.patternId)maximum=clip.offsetKnown===true&&Number.isFinite(clip.sourceLength)?Math.max(minimum,clip.sourceLength-number(clip.offset)):clip.length;
  next.length=Math.max(minimum,Math.min(maximum,clip.length+delta));
 }else{
  if(delta!==0)next.start=Math.max(0,clip.start+delta);
  if(deltaTracks!==0)next.track=Math.max(0,Math.min(maxTrack,clip.track+deltaTracks));
 }
 return next;
}

/** Preserve native cycle/offset/window mode unless the visible span is edited. */
export function placementTiming(clip,project){
 const raw=clip.cloudRaw||{},pattern=project.patterns.find(pattern=>pattern.id===clip.patternId),msPerBeat=60000/positive(project.bpm,120);
 const durationMs=positive(raw.durationMs??raw.duration_ms,patternLengthBeats(pattern)*msPerBeat),loopDurationMs=positive(raw.loopDurationMs??raw.loop_duration_ms,durationMs),offsetMs=Math.max(0,number(raw.offsetMs??raw.offset_ms)),target=positive(clip.length*msPerBeat,1);
 const originalRepeat=Math.max(1,Math.round(positive(raw.repeatCount??raw.repeat_count,1))),originalWindow=positive(raw.windowMs??raw.window_ms,null),derived=Math.max(1,durationMs*originalRepeat-offsetMs),originalSpan=originalWindow||derived;
 let repeatCount=originalRepeat,windowMs=originalWindow;
 if(!near(target,originalSpan)){
  if(originalWindow){const cycle=loopDurationMs<durationMs-.001?loopDurationMs:Math.max(50,durationMs-offsetMs);repeatCount=Math.max(1,Math.ceil(target/cycle-1e-9));windowMs=target;}
  else{repeatCount=Math.max(1,Math.ceil((offsetMs+target)/durationMs-1e-9));windowMs=near(target,durationMs*repeatCount-offsetMs)?null:target;}
 }
 return{durationMs,loopDurationMs,offsetMs,repeatCount,windowMs,loopPhaseMs:number(raw.loopPhaseMs??raw.loop_phase_ms)};
}

/** Only emulate splits whose native phase can be represented without guessing. */
export function splitPatternClip(clip,cutBeat,project,{newId=()=>crypto.randomUUID()}={}){
 const delta=cutBeat-clip.start;if(!clip.patternId||!Number.isFinite(delta)||delta<=0||delta>=clip.length)throw new Error('Place the slice inside a pattern clip.');
 const timing=placementTiming(clip,project),msPerBeat=60000/positive(project.bpm,120),cutMs=delta*msPerBeat,rightMs=(clip.length-delta)*msPerBeat;
 const tiled=timing.windowMs!==null,cycle=tiled?(timing.loopDurationMs<timing.durationMs-.001?timing.loopDurationMs:Math.max(50,timing.durationMs-timing.offsetMs)):timing.durationMs;
 const phase=mod(cutMs,cycle),boundary=near(phase,0)||near(phase,cycle);
 const exactLegacyLeft=near((cutMs+timing.offsetMs)%timing.durationMs,0);
 if(timing.loopPhaseMs!==0||tiled&&!boundary&&rightMs>cycle-phase+1e-7||!tiled&&timing.offsetMs>0&&cutMs>timing.durationMs-timing.offsetMs+1e-7&&!exactLegacyLeft)throw new Error('This repeated or offset pattern needs Freestyle’s native atomic placement split to preserve its source phase. That split is not exposed by the current MCP tools.');
 const left=structuredClone(clip),right=structuredClone(clip);left.length=delta;right.start=cutBeat;right.length=clip.length-delta;right.id=newId();delete right.cloudId;
 const offset=timing.offsetMs+(tiled?(boundary?0:phase):cutMs);
 const write=(target,offsetMs)=>{
  target.cloudRaw={...target.cloudRaw,offsetMs};
  if(Object.hasOwn(target.cloudRaw,'offset_ms'))target.cloudRaw.offset_ms=offsetMs;
  const next=placementTiming(target,project);Object.assign(target.cloudRaw,next);
  for(const [alias,key]of [['window_ms','windowMs'],['repeat_count','repeatCount']])if(Object.hasOwn(target.cloudRaw,alias))target.cloudRaw[alias]=next[key];
 };
 write(left,timing.offsetMs);write(right,offset);
 delete right.cloudRaw.id;delete right.cloudRaw.placement_id;delete right.cloudRaw.placementId;
 return[left,right];
}
