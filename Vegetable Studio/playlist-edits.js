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

/* Whole-millisecond placement timing.
 * The Studio API stores a placement's start, cycle, offset, window and loop phase as integer
 * milliseconds. The UI works in beats, so at a tempo whose beat is not a whole number of
 * milliseconds (124 BPM: one bar is 1935.48 ms) every beat position converts to a fraction.
 * Only the batch transport rounded; the preflight and the history capture saw the fractions
 * and refused the edit ("phase must be integer milliseconds inside its loop unit"). */
const finiteNumber=value=>typeof value==='number'&&Number.isFinite(value);
/** Nearest whole millisecond, never below `minimum`. Non-numbers pass through unchanged so
 * the strict validators downstream still refuse them. */
export function wholeMs(value,minimum=0){return finiteNumber(value)?Math.max(minimum,Math.round(value)):value;}
/** A loop phase as a whole millisecond inside [0, unit). A phase inside its cycle that rounds
 * onto the cycle's end is the start of the next one (0). Negative, oversized or non-numeric
 * phases are returned as they are: invalid requests, not rounding artefacts. */
export function wholePhaseMs(phase,unit){
 if(!finiteNumber(phase))return phase;
 const rounded=Math.round(phase);
 if(finiteNumber(unit)&&rounded===wholeMs(unit,1)&&phase<unit)return 0;
 return rounded===0?0:rounded;
}
/** One serialized placement with whole-millisecond timing; `windowMs:null` (no trim window)
 * is kept. Returns a new object, other fields untouched. */
export function wholePlacementMs(placement){
 const out={...placement},unit=out.loopDurationMs??out.durationMs;
 if('startMs' in out)out.startMs=wholeMs(out.startMs,0);
 if('offsetMs' in out)out.offsetMs=wholeMs(out.offsetMs,0);
 if('loopPhaseMs' in out)out.loopPhaseMs=wholePhaseMs(out.loopPhaseMs,unit);
 if('durationMs' in out)out.durationMs=wholeMs(out.durationMs,1);
 if('loopDurationMs' in out&&out.loopDurationMs!=null)out.loopDurationMs=wholeMs(out.loopDurationMs,1);
 if('windowMs' in out&&out.windowMs!=null)out.windowMs=wholeMs(out.windowMs,1);
 return out;
}
/** Whole pattern cycles an untiled placement spans when its target length is a whole number
 * of cycles up to the rounding of the stored cycle, else null.
 * A saved cycle is the pattern length rounded to a whole millisecond (1935 for a 1935.48 ms
 * bar). Two bars ask for 3870.97 ms, 0.97 ms more than two stored cycles: without this that
 * became three repeats cut by a window 1 ms into the third. Null too when the stored cycle
 * is not this tempo's rounded pattern length (exact tempos keep their exact arithmetic). */
export function wholeCyclesWithinRounding({targetMs,durationMs,offsetMs=0,exactCycleMs}={}){
 if(![targetMs,durationMs,offsetMs,exactCycleMs].every(finiteNumber)||durationMs<=0)return null;
 const slack=Math.abs(durationMs-exactCycleMs);if(slack<=1e-7||slack>.5)return null;
 const cycles=Math.round((offsetMs+targetMs)/durationMs);if(cycles<1)return null;
 return Math.abs(durationMs*cycles-offsetMs-targetMs)<=cycles*slack+1e-6?cycles:null;
}

/** Preserve native cycle/offset/window mode unless the visible span is edited. */
export function placementTiming(clip,project){
 const raw=clip.cloudRaw||{},pattern=project.patterns.find(pattern=>pattern.id===clip.patternId),msPerBeat=60000/positive(project.bpm,120);
 const durationMs=positive(raw.durationMs??raw.duration_ms,patternLengthBeats(pattern)*msPerBeat),loopDurationMs=positive(raw.loopDurationMs??raw.loop_duration_ms,durationMs),offsetMs=Math.max(0,number(raw.offsetMs??raw.offset_ms)),target=positive(clip.length*msPerBeat,1);
 const originalRepeat=Math.max(1,Math.round(positive(raw.repeatCount??raw.repeat_count,1))),originalWindow=positive(raw.windowMs??raw.window_ms,null),derived=Math.max(1,durationMs*originalRepeat-offsetMs),originalSpan=originalWindow||derived;
 let repeatCount=originalRepeat,windowMs=originalWindow;
 if(!near(target,originalSpan)){
  if(originalWindow){const cycle=loopDurationMs<durationMs-.001?loopDurationMs:Math.max(50,durationMs-offsetMs);repeatCount=Math.max(1,Math.ceil(target/cycle-1e-9));windowMs=target;}
  else{
   // A saved cycle is whole milliseconds (1935 for a 1935.48 ms bar at 124 BPM): a span of whole
   // bars is whole cycles, not one more repeat cut by a window a millisecond into it.
   const cycles=wholeCyclesWithinRounding({targetMs:target,durationMs,offsetMs,exactCycleMs:pattern?patternLengthBeats(pattern)*msPerBeat:NaN});
   if(cycles){repeatCount=cycles;windowMs=null;}
   else{repeatCount=Math.max(1,Math.ceil((offsetMs+target)/durationMs-1e-9));windowMs=near(target,durationMs*repeatCount-offsetMs)?null:target;}
  }
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
