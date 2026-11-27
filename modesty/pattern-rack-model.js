/**
 * Pure pattern-rack data helpers. They match the Freestyle Studio's
 * pattern model:
 *  - rack sources {kind:'sample'|'plugin', volume 0..2, muted, solo},
 *    step events {id:`${channel}:${step}`, type:'sample', sourceId,
 *    tick:round(step*ppq*4/16), velocity:.9}; ppq 96, 16 steps per bar,
 *    bars clamped 1..64, lengthTicks = bars*ppq*4.
 *  - Pattern import onto the playlist:
 *    durationMs = max(250, bars*4*60000/bpm), start snapped to a 1/16 grid
 *    unless exact, loopDurationMs = durationMs, repeatCount 1, busId from the
 *    first plugin source (default master), new-row names `Name (N)`.
 * No audio is rendered here; every value becomes a typed Studio API body.
 */
export const PPQ=96;
export const STEPS_PER_BAR=16;
export const MAX_BARS=64;
export const MAX_SOURCE_VOLUME=2;

const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const clone=value=>structuredClone(value);
const text=value=>String(value??'').trim();

/** Canonical DTO from a normalized pattern, its cloudRaw or a raw DTO. */
export function patternDto(entry){
  const raw=entry?.cloudRaw??entry;
  const dto=raw?.data?.pattern?raw.data:raw;
  if(!dto||typeof dto!=='object'||!dto.pattern||!Array.isArray(dto.pattern.sources)||!Array.isArray(dto.pattern.events))
    throw new Error('Freestyle has not returned the full canonical pattern. Reload its sources and events before editing.');
  if(dto.truncated||dto._truncated||dto.pattern.truncated||dto.pattern.eventsTruncated||dto.pattern.sourcesTruncated)
    throw new Error('Freestyle returned an incomplete canonical pattern. Reload it before editing to preserve hidden events.');
  return dto;
}

export function clampBars(value){const bars=Math.round(finite(value,1));return clamp(Number.isFinite(bars)?bars:1,1,MAX_BARS);}
export function ppqOf(dto){const ppq=Math.round(finite(dto?.ppq,PPQ));return ppq>=24&&ppq<=960?ppq:PPQ;}
export function stepTicks(dto){return ppqOf(dto)*4/STEPS_PER_BAR;}
export function stepCount(dto){return clampBars(dto?.bars)*STEPS_PER_BAR;}

/** Persisted editable body: only canonical pattern fields, never server metadata. */
export function editableBody(dto){
  const ppq=ppqOf(dto),bars=clampBars(dto.bars);
  return {name:text(dto.name)||'Pattern',ppq,bars,lengthTicks:bars*ppq*4,swing:finite(dto.swing,0),pattern:{...clone(dto.pattern),version:dto.pattern.version||1,sources:clone(dto.pattern.sources),events:clone(dto.pattern.events)}};
}

export function isStepEvent(event,dto){
  if(!event||event.type!=='sample'||event.durationTick!=null||event.startTick!=null)return false;
  const tick=Number(event.tick);return Number.isFinite(tick)&&tick>=0&&Number.isInteger(Math.round(tick*1e6)/1e6/stepTicks(dto));
}

/** Rack rows, in source order. Plugin rows carry notes (piano roll), not steps. */
export function rackChannels(dto){
  const per=stepTicks(dto),count=stepCount(dto),sources=dto.pattern.sources.map((source,index)=>({source,index})).sort((a,b)=>finite(a.source.order,a.index)-finite(b.source.order,b.index)||a.index-b.index);
  return sources.map(({source})=>{
    const id=String(source.id),kind=source.kind==='plugin'?'plugin':'sample',steps=Array(count).fill(false);let notes=0;
    for(const event of dto.pattern.events){
      if(String(event.sourceId)!==id)continue;
      if(kind==='sample'&&isStepEvent(event,dto)){const step=Math.round(Number(event.tick)/per);if(step<count)steps[step]=true;}
      else if(event.type==='midi'||event.startTick!=null)notes++;
    }
    return {id,kind,name:text(source.name)||(kind==='plugin'?'Instrument':'Sample'),volume:finite(source.volume,1),muted:!!source.muted,solo:!!source.solo,audioFileId:source.audioFileId||source.audio_file_id||'',rackId:source.rackId||'',laneId:source.laneId||'',steps,notes};
  });
}

function findSource(dto,sourceId){const source=dto.pattern.sources.find(row=>String(row.id)===String(sourceId));if(!source)throw new Error('That rack channel is no longer in this pattern.');return source;}

/** Step toggle; returns a new DTO. */
export function toggleStep(dto,sourceId,step,on){
  const next=clone(dto),source=findSource(next,sourceId),count=stepCount(next);
  if(source.kind==='plugin')throw new Error('Instrument channels are edited in the piano roll, as in the Freestyle Studio.');
  step=Math.round(step);if(!Number.isInteger(step)||step<0||step>=count)throw new Error('Choose a step inside the pattern length.');
  const tick=Math.round(step*stepTicks(next)),hit=event=>String(event.sourceId)===String(source.id)&&isStepEvent(event,next)&&Math.round(Number(event.tick))===tick;
  const active=next.pattern.events.some(hit),want=on===undefined?!active:!!on;
  if(want===active)return next;
  if(!want){next.pattern.events=next.pattern.events.filter(event=>!hit(event));return next;}
  const base=`${source.rackId||source.id}:${step}`,ids=new Set(next.pattern.events.map(event=>String(event.id)));let id=base,n=2;while(ids.has(id))id=`${base}#${n++}`;
  next.pattern.events.push({id,type:'sample',sourceId:source.id,tick,velocity:.9});
  return next;
}

export function setSourceFields(dto,sourceId,fields){
  const next=clone(dto),source=findSource(next,sourceId);
  if('volume' in fields){const volume=Number(fields.volume);if(!Number.isFinite(volume))throw new Error('Channel volume must be a number.');source.volume=Math.round(clamp(volume,0,MAX_SOURCE_VOLUME)*1000)/1000;}
  if('muted' in fields)source.muted=!!fields.muted;
  if('solo' in fields)source.solo=!!fields.solo;
  if('name' in fields){const name=text(fields.name).slice(0,80);if(!name)throw new Error('Name the channel.');source.name=name;}
  return next;
}

export function removeSource(dto,sourceId){const next=clone(dto);findSource(next,sourceId);next.pattern.sources=next.pattern.sources.filter(row=>String(row.id)!==String(sourceId));next.pattern.events=next.pattern.events.filter(event=>String(event.sourceId)!==String(sourceId));return next;}

/** Shrinking drops step hits beyond the new end (steps are rebuilt to length); notes and other events are retained for Undo-free safety. */
export function setBars(dto,bars){
  const next=clone(dto),value=clampBars(bars),end=value*ppqOf(next)*4;
  next.bars=value;next.lengthTicks=end;next.pattern.events=next.pattern.events.filter(event=>!isStepEvent(event,next)||Number(event.tick)<end);
  return next;
}

export function renamePattern(dto,name){const value=text(name).slice(0,255);if(!value)throw new Error('Name the pattern.');return {...clone(dto),name:value};}

const nextOrder=dto=>Math.max(-1,...dto.pattern.sources.map((source,index)=>finite(source.order,index)))+1;

/** Sample source for a stored pattern sample (audioFileId required). */
export function addSampleSource(dto,sample){
  const audioFileId=text(sample?.audioFileId??sample?.audio_file_id);
  if(!audioFileId)throw new Error('Choose a stored Freestyle sample with an audioFileId.');
  const next=clone(dto),id=`sample:${audioFileId}`;
  if(next.pattern.sources.some(source=>String(source.id)===id||source.audioFileId===audioFileId))throw new Error(`${sample.name||'That sample'} is already a channel in this pattern.`);
  next.pattern.sources.push({id,rackId:text(sample.rackId)||`rack-${audioFileId.slice(0,10)}`,kind:'sample',name:text(sample.name).slice(0,80)||'Sample',audioFileId,durationSec:finite(sample.durationSec,0),samplePlaybackMode:/\bloop\b|_loop|loop_/i.test(String(sample.name||''))?'loop':'one-shot',mimeType:text(sample.mimeType),busId:'master',muted:false,solo:false,volume:1,order:nextOrder(next)});
  return next;
}

/** Plugin source bound to an existing instrument lane. */
export function addInstrumentSource(dto,lane){
  const laneId=text(lane?.laneId??lane?.id);if(!laneId)throw new Error('Choose a persisted instrument lane.');
  const next=clone(dto),id=`plugin:${laneId}`;
  if(next.pattern.sources.some(source=>String(source.id)===id))throw new Error(`${lane.name||'That instrument'} is already a channel in this pattern.`);
  next.pattern.sources.push({id,kind:'plugin',name:text(lane.name).slice(0,80)||'Instrument',laneId,instrumentType:text(lane.instrumentType||lane.type).toLowerCase()||'labs',busId:lane.busId||'master',muted:false,solo:false,volume:1,order:nextOrder(next)});
  return next;
}

/** Next "Pattern N" name. */
export function nextPatternName(patterns=[]){let n=0;for(const pattern of patterns){const match=/^\s*Pattern\s+(\d+)\s*$/i.exec(String(pattern?.name||''));if(match)n=Math.max(n,Number(match[1])||0);}return `Pattern ${Math.max(n,patterns.length)+1}`;}

const baseName=name=>text(name).replace(/ \(\d+\)$/,'')||'Pattern';
/** `Name (N)` after the highest existing copy number. */
export function copyName(name,existing=[]){
  const base=baseName(name);let highest=1;
  for(const row of existing){const value=text(row?.name??row);if(value===base)continue;const match=new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')} \\((\\d+)\\)$`).exec(value);if(match)highest=Math.max(highest,Number(match[1]));}
  return `${base} (${highest+1})`;
}

export function emptyPatternBody(name){return {name:text(name)||'Pattern 1',ppq:PPQ,bars:1,lengthTicks:PPQ*4,swing:0,pattern:{version:1,sources:[],events:[]}};}

export function patternDurationMs(dto,bpm){const tempo=clamp(finite(bpm,120)||120,20,400);return Math.max(250,Math.round(clampBars(dto?.bars)*4*(60/tempo)*1000));}

/** Imported pattern starts snap to a 1/16 grid unless the drop is exact. */
export function snapStartMs(atSec,bpm,{exact=false,firstBeatMs=0}={}){
  const ms=Math.max(0,Math.round(finite(atSec)*1000));if(exact)return ms;
  const grid=Math.max(1,60000/(finite(bpm,120)||120)/4);return Math.max(0,Math.round(Math.round((ms-firstBeatMs)/grid)*grid+firstBeatMs));
}

/** Body for importing a pattern onto the playlist. */
export function placementPayload(dto,{patternId,atSec,bpm,laneId='',name,exact=false,displayOrder=0,offsetMs=0}={}){
  const id=text(patternId??dto?.id);if(!id)throw new Error('Save the pattern before placing it.');
  const durationMs=patternDurationMs(dto,bpm),offset=Math.min(Math.max(0,Math.round(finite(offsetMs))),Math.max(0,durationMs-50));
  const busId=dto?.pattern?.sources?.find(source=>source?.kind==='plugin'||source?.kind==='instrument')?.busId||'master';
  const payload={patternId:id,name:text(name)||text(dto?.name)||'Pattern',startMs:snapStartMs(atSec,bpm,{exact}),durationMs,loopDurationMs:durationMs,repeatCount:1,displayOrder:Math.max(0,Math.round(finite(displayOrder))),busId};
  if(text(laneId))payload.laneId=text(laneId);if(offset>0)payload.offsetMs=offset;
  return payload;
}

/** Fields an inverse placement PATCH restores. windowMs:null clears a trim (Studio API). */
export const PLACEMENT_FIELDS=['patternId','laneId','busId','name','startMs','durationMs','repeatCount','offsetMs','windowMs','loopDurationMs','loopPhaseMs','muted','soloed'];
export function placementState(row){
  if(!row||typeof row!=='object')throw new Error('The pattern placement has no canonical state.');
  const out={};
  for(const key of PLACEMENT_FIELDS){
    let value=row[key]??row[key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())];
    if(key==='windowMs'){const n=Number(value);out.windowMs=Number.isFinite(n)&&n>0?Math.round(n):null;continue;}
    if(value===undefined||value===null||value==='')continue;
    if(['startMs','durationMs','repeatCount','offsetMs','loopDurationMs','loopPhaseMs'].includes(key)){const n=Math.round(Number(value));if(!Number.isFinite(n))continue;value=n;}
    out[key]=value;
  }
  return out;
}

/** Clipboard payload: everything but identity and start. */
export function placementCopy(row){const state=placementState(row);delete state.startMs;if(state.windowMs===null)delete state.windowMs;return state;}
