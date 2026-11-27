/** Logic Pro region Fade tool, Region Inspector Fade In / Fade Out and Gain for
 * Freestyle audio regions, over published Studio API v1 operations only.
 *
 * Fades. Freestyle stores a region fade as its clip-gain automation envelope
 * (targetKey `clip.gain`, value 0.25 = unity, gain = 4·value). The typed engine
 * action `engine_set_clip_fade` {clip_id, direction: in|out, duration_sec}
 * MULTIPLIES a linear fade into that envelope and answers {beforeEnvelope,
 * envelope}; live probe 2026-11-12 on the owned test clip. It is used to add a
 * fade where that end has none. Changing or removing an existing fade (Logic
 * semantics: the field sets the length) writes the complete fade-only curve
 * with `updateAutomationEnvelope` (or `deleteAutomationEnvelope` back to the
 * synthesized default; `createAutomationEnvelope` when none is persisted).
 * Undo / Redo restore the exact retained curve, guarded by a fresh read.
 *
 * Gain. `engine_set_clip_gain` {track_id: lane, clip_id, gain 0–4}. Its value is
 * read back from `getClipWaveform` (`clip.gain`); the saved Clip row `volume`
 * did not change in the live probe, so it is never used as confirmation.
 *
 * One gesture is one ordered history step (CloudPatternHistory external step).
 */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const clone=value=>value==null?value:structuredClone(value);
const fail=(message,code='region_fade_invalid',extra={})=>Object.assign(new Error(message),{code},extra);
/** A guard refusal: nothing was sent, history keeps the step. */
const refused=(message,code='region_fade_changed')=>fail(message,code,{dispatched:false,historyNotApplied:true});
const ms=value=>Math.round(value*1000)/1000,us=value=>Math.round(value*1e6)/1e6;
const TIME_EPS=1e-4,VALUE_EPS=1e-6;
export const UNITY_ENVELOPE_VALUE=.25;
export const CLIP_GAIN_MAX=4;
export const REGION_FADE_OPERATIONS=Object.freeze(['engine_set_clip_fade','listClipAutomation','createAutomationEnvelope','updateAutomationEnvelope','deleteAutomationEnvelope']);
export const REGION_GAIN_OPERATIONS=Object.freeze(['engine_set_clip_gain','getClipWaveform']);

/** The clip-gain envelope among a listClipAutomation page, or null. */
export function clipGainEnvelope(rows){
 const list=Array.isArray(rows)?rows:Array.isArray(rows?.data)?rows.data:[];
 const matches=list.filter(row=>record(row)&&(row.targetKey==='clip.gain'||row.targetKind==='clip_gain'||row.target?.kind==='clip_gain'));
 if(matches.length>1)throw fail('Freestyle returned more than one region volume curve for this region.','region_fade_ambiguous');
 return matches[0]||null;
}
const sortedPoints=points=>(Array.isArray(points)?points:[]).filter(point=>record(point)&&finite(point.timeSec)&&finite(point.value)).map(point=>({timeSec:point.timeSec,value:point.value,curve:point.curve||'linear'})).sort((a,b)=>a.timeSec-b.timeSec);

/**
 * Logic's view of a region-volume curve: fade-in / fade-out lengths (seconds),
 * the level between them, and whether the curve is fade-only ("simple"): a
 * constant level with at most a linear ramp from 0 at each end.
 */
export function parseClipFades(envelope,durationSec){
 if(!finite(durationSec)||durationSec<=0)throw fail('The region needs its saved length before fades.');
 const persisted=envelope?.persisted===true,points=sortedPoints(envelope?.points),defaultValue=finite(envelope?.defaultValue)?envelope.defaultValue:UNITY_ENVELOPE_VALUE;
 const base={persisted,id:persisted&&id(envelope?.id)?envelope.id:null,revision:Number.isInteger(envelope?.revision)?envelope.revision:0,defaultValue,points,durationSec};
 if(!points.length)return{...base,fadeIn:0,fadeOut:0,level:defaultValue,simple:true};
 const level=Math.max(...points.map(point=>point.value));
 if(level<=VALUE_EPS)return{...base,fadeIn:0,fadeOut:0,level:0,simple:false};
 const at=value=>Math.abs(value-level)<=VALUE_EPS,zero=value=>Math.abs(value)<=VALUE_EPS;
 const first=points[0],last=points.at(-1),firstLevel=points.findIndex(point=>at(point.value)),lastLevel=points.length-1-[...points].reverse().findIndex(point=>at(point.value));
 const fadeIn=zero(first.value)&&first.timeSec<=TIME_EPS?us(points[firstLevel].timeSec):0;
 const fadeOut=zero(last.value)&&Math.abs(last.timeSec-durationSec)<=TIME_EPS?us(durationSec-points[lastLevel].timeSec):0;
 // Fade-only: every point is a ramp end (0 at the region edge) or on the level, all linear.
 const simple=points.every((point,index)=>point.curve==='linear'&&(at(point.value)||zero(point.value)&&(index===0&&fadeIn>0||index===points.length-1&&fadeOut>0)))&&points.slice(firstLevel,lastLevel+1).every(point=>at(point.value));
 return{...base,fadeIn,fadeOut,level,simple};
}

/** The complete fade-only curve for a region (null = the synthesized default). */
export function fadePoints({durationSec,fadeIn=0,fadeOut=0,level=UNITY_ENVELOPE_VALUE,defaultValue=UNITY_ENVELOPE_VALUE}){
 if(!finite(durationSec)||durationSec<=0||!finite(fadeIn)||!finite(fadeOut)||fadeIn<0||fadeOut<0||fadeIn+fadeOut>durationSec+TIME_EPS||!finite(level)||level<0||level>1)throw fail('Fade lengths must fit inside the region.');
 if(fadeIn<=0&&fadeOut<=0&&Math.abs(level-defaultValue)<=VALUE_EPS)return null;
 const end=Math.round(durationSec*1e6)/1e6,points=[{timeSec:0,value:fadeIn>0?0:level,curve:'linear'}];
 if(fadeIn>0&&fadeIn<end-TIME_EPS)points.push({timeSec:ms(fadeIn),value:level,curve:'linear'});
 if(fadeOut>0&&end-fadeOut>(fadeIn>0?ms(fadeIn):0)+TIME_EPS)points.push({timeSec:Math.round((end-fadeOut)*1e6)/1e6,value:level,curve:'linear'});
 points.push({timeSec:end,value:fadeOut>0?0:level,curve:'linear'});
 return points;
}
/** Curves equal within the server's stored precision. */
export function sameCurve(a,b){
 const x=sortedPoints(a),y=sortedPoints(b);
 return x.length===y.length&&x.every((point,index)=>Math.abs(point.timeSec-y[index].timeSec)<=TIME_EPS&&Math.abs(point.value-y[index].value)<=VALUE_EPS&&point.curve===y[index].curve);
}
/** The retained identity of a curve state: null = synthesized default. */
export function curveState(envelope){return envelope?.persisted===true?{points:sortedPoints(envelope.points),defaultValue:finite(envelope.defaultValue)?envelope.defaultValue:UNITY_ENVELOPE_VALUE}:null;}
export function sameCurveState(a,b){return a===null||b===null?a===b:sameCurve(a.points,b.points)&&Math.abs(a.defaultValue-b.defaultValue)<=VALUE_EPS;}

/**
 * Plan one fade length change (Logic: the Inspector field / Fade tool drag sets
 * that end's length). op: 'none' | 'engine' (engine_set_clip_fade adds a fade
 * where that end has none) | 'curve' (write the complete fade-only curve).
 */
export function planClipFade(state,{direction,seconds}){
 if(direction!=='in'&&direction!=='out')throw fail('Choose a fade in or a fade out.');
 if(!finite(seconds)||seconds<0)throw fail('A fade length must be zero or more seconds.');
 const other=direction==='in'?state.fadeOut:state.fadeIn,current=direction==='in'?state.fadeIn:state.fadeOut;
 const length=ms(Math.min(seconds,Math.max(0,state.durationSec-other)));
 if(Math.abs(length-current)<5e-4)return{op:'none',direction,seconds:current};
 if(current<=0&&length>0)return{op:'engine',direction,seconds:length,expected:fadePoints({durationSec:state.durationSec,fadeIn:direction==='in'?length:state.fadeIn,fadeOut:direction==='out'?length:state.fadeOut,level:state.level,defaultValue:state.defaultValue})};
 if(!state.simple)throw fail('This region has drawn Region Volume automation. Change its fade in the automation view (A).','region_fade_custom_curve');
 const points=fadePoints({durationSec:state.durationSec,fadeIn:direction==='in'?length:state.fadeIn,fadeOut:direction==='out'?length:state.fadeOut,level:state.level,defaultValue:state.defaultValue});
 return{op:'curve',direction,seconds:length,target:points?{points,defaultValue:state.defaultValue}:null};
}

/** Linear gain → Logic's dB text (-∞ … +12.0). */
export function gainDbText(gain){if(!finite(gain)||gain<=0)return'-∞';const db=20*Math.log10(gain);return Math.abs(db)<.05?'0.0':(db>0?'+':'')+db.toFixed(1);}
/** dB entry → linear clip gain, clamped to Freestyle's 0–4 (−∞ … +12.04 dB). */
export function dbToClipGain(db){const value=typeof db==='string'?(/^\s*-?\s*(inf|∞)/i.test(db)?-Infinity:Number(db.replace(/dB/i,'').trim())):Number(db);if(Number.isNaN(value))throw fail('Type a gain in dB, e.g. -3.0.','region_gain_invalid');if(value<=-96)return 0;return Math.round(Math.min(CLIP_GAIN_MAX,10**(value/20))*1e6)/1e6;}
export function fadeMsText(seconds){return finite(seconds)?String(Math.round(seconds*1000)):'—';}

/** SVG overlay (percent geometry) drawing Logic's fade shapes over an audio region. */
export function fadeOverlaySvg({fadeIn=0,fadeOut=0,durationSec}){
 if(!finite(durationSec)||durationSec<=0||!(fadeIn>0||fadeOut>0))return'';
 const pct=value=>Math.max(0,Math.min(100,value/durationSec*100)).toFixed(3),parts=[];
 if(fadeIn>0)parts.push(`<path class="logic-fade-in" d="M0 100 L${pct(fadeIn)} 0 L0 0 Z"/><path class="logic-fade-line" d="M0 100 L${pct(fadeIn)} 0"/>`);
 if(fadeOut>0)parts.push(`<path class="logic-fade-out" d="M100 100 L${pct(durationSec-fadeOut)} 0 L100 0 Z"/><path class="logic-fade-line" d="M${pct(durationSec-fadeOut)} 0 L100 100"/>`);
 return `<svg class="logic-fade-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${parts.join('')}</svg>`;
}

/** Engine / REST failure that provably changed nothing (explicit 4xx). */
export function regionWriteRejected(error){
 if(error?.dispatched===false||error?.historyNotApplied===true)return true;
 if(error?.operationUncertain===true)return false;
 const status=error?.status;return Number.isInteger(status)&&status>=400&&status<500&&status!==408;
}

/**
 * Region fade / gain controller.
 * options: client() → StudioApiClient|null; scope() → {projectId}|null;
 * history() → CloudPatternHistory|null; onChange(clipId, kind); log(event, detail).
 */
export class RegionGainFadeController{
 constructor({client,scope,history=()=>null,onChange=()=>{},log=()=>{},operations=null}={}){
  if(typeof client!=='function'||typeof scope!=='function')throw new TypeError('RegionGainFadeController needs client and scope.');
  Object.assign(this,{client,scope,history,onChange,log});this.operations=operations;this.envelopes=new Map();this.gains=new Map();this.busy=false;this.generation=0;
 }
 supports(kind){const ops=kind==='gain'?REGION_GAIN_OPERATIONS:REGION_FADE_OPERATIONS,set=this.operations;return !set||ops.every(op=>set instanceof Set?set.has(op):Object.hasOwn(set,op));}
 api(){const client=this.client();if(typeof client?.call!=='function')throw fail('Region fades and gain need a Studio API (OAuth) project. Reload the project.','region_fade_unavailable',{dispatched:false});return client;}
 context(){const scope=this.scope();if(!id(scope?.projectId))throw fail('Open a Freestyle project first.','region_fade_scope',{dispatched:false});return{projectId:scope.projectId};}
 assertContext(context){const now=this.scope();if(now?.projectId!==context.projectId)throw fail('The project changed before the region edit finished.','region_fade_scope',{dispatched:false});}
 reset(){this.generation++;this.envelopes.clear();this.gains.clear();}
 /** Cached fade state of an audio clip ({fadeIn, fadeOut, ...}) or null until read. */
 fades(clipId){return this.envelopes.get(clipId)?.state??null;}
 status(clipId){return this.envelopes.get(clipId)?.status??'idle';}
 gain(clipId){return this.gains.get(clipId)?.gain??null;}
 key(clip){return JSON.stringify([clip.cloudId,clip.durationSec]);}
 /** Read the region's clip-gain envelope (deduplicated per clip and length). */
 load(clip,{force=false}={}){
  if(!id(clip?.cloudId)||!finite(clip.durationSec)||clip.durationSec<=0)return Promise.resolve(null);
  const existing=this.envelopes.get(clip.cloudId);if(existing&&!force&&existing.key===this.key(clip)&&existing.status!=='error')return existing.promise;
  const entry={key:this.key(clip),status:'loading',state:existing?.state??null,generation:this.generation};this.envelopes.set(clip.cloudId,entry);
  // Background curve reads run one at a time so user reads keep the proxy's GET slots.
  const read=(this.readQueue||Promise.resolve()).then(()=>this.envelopes.get(clip.cloudId)===entry&&entry.generation===this.generation?this.read(clip):null);this.readQueue=read.then(()=>undefined,()=>undefined);
  entry.promise=read.then(state=>{if(this.envelopes.get(clip.cloudId)!==entry||entry.generation!==this.generation)return state;entry.status='ready';entry.state=state;this.notify(clip.cloudId,'fade');return state;},error=>{if(this.envelopes.get(clip.cloudId)===entry){entry.status='error';entry.error=error.message;this.notify(clip.cloudId,'fade');}return null;});
  return entry.promise;
 }
 async read(clip,context=this.context()){
  const result=await this.api().call('listClipAutomation',{path:{project_id:context.projectId,clip_id:clip.cloudId},query:{target_kind:'clip_gain'}});
  this.assertContext(context);const envelope=clipGainEnvelope(result?.data);
  if(envelope&&(envelope.projectId!=null&&envelope.projectId!==context.projectId||envelope.clipId!=null&&envelope.clipId!==clip.cloudId))throw fail('Freestyle returned another region’s volume curve.','region_fade_scope');
  const state=parseClipFades(envelope,clip.durationSec);state.envelope=clone(envelope);return state;
 }
 notify(clipId,kind){try{this.onChange(clipId,kind);}catch{}}
 adopt(clip,envelope){const state=parseClipFades(envelope,clip.durationSec);state.envelope=clone(envelope);this.envelopes.set(clip.cloudId,{key:this.key(clip),status:'ready',state,generation:this.generation,promise:Promise.resolve(state)});this.notify(clip.cloudId,'fade');return state;}
 begin(kind,label){const history=this.history();let token=null;try{token=history?.beginExternalStep?.({kind,label})??null;}catch{token=null;}return{history,token};}
 finish({history,token},step){if(!history)return false;if(token)return history.finishExternalStep(token,step)===true;return history.recordExternalStep?.(step)===true;}
 abandon({history,token},error){if(token)try{history.failExternalStep(token,error);}catch{}}
 /** Write one curve state (null = default) when the region's current curve still equals `expected`. */
 async writeCurve(clip,{expected,target},context){
  const client=this.api(),fresh=await this.read(clip,context),current=curveState(fresh.envelope);
  if(!sameCurveState(current,expected))throw refused('This region’s fade changed since that edit. History will not overwrite it.');
  if(sameCurveState(current,target)){this.adopt(clip,fresh.envelope);return fresh;}
  const path={project_id:context.projectId};let envelope;
  if(target===null){const result=await client.call('deleteAutomationEnvelope',{path:{...path,envelope_id:fresh.id},body:{expectedRevision:fresh.revision}});this.assertContext(context);if(result?.data?.deleted!==true)throw fail('Freestyle did not confirm the fade removal.','region_fade_receipt',{operationUncertain:true});return this.adopt(clip,null);}
  else if(fresh.persisted){const result=await client.call('updateAutomationEnvelope',{path:{...path,envelope_id:fresh.id},body:{expectedRevision:fresh.revision,defaultValue:target.defaultValue,points:target.points}});envelope=result?.data?.envelope;}
  else{const result=await client.call('createAutomationEnvelope',{path:{...path,clip_id:clip.cloudId},body:{target:{kind:'clip_gain'},valueType:'continuous',defaultValue:target.defaultValue,points:target.points}});envelope=result?.data?.envelope;}
  this.assertContext(context);
  if(target!==null&&(!record(envelope)||envelope.persisted!==true||!sameCurve(envelope.points,target.points)))throw fail('Freestyle did not confirm the requested fade curve.','region_fade_receipt',{operationUncertain:true});
  return this.adopt(clip,target===null?null:envelope);
 }
 /** Set one fade end's length in seconds (0 removes it). One history step. */
 async setFade(clip,{direction,seconds}){
  if(this.busy)throw fail('Wait for the current region fade to save.','region_fade_busy',{dispatched:false});
  if(!id(clip?.cloudId)||!id(clip?.laneId)||clip.patternId)throw fail('Fades apply to saved audio regions.','region_fade_invalid',{dispatched:false});
  const context=this.context();this.busy=true;let pending=null,sent=false;
  try{
   const before=await this.read(clip,context),plan=planClipFade(before,{direction,seconds});
   if(plan.op==='none'){this.adopt(clip,before.envelope);return{changed:false,state:before};}
   const label=`${plan.seconds>0?'Fade':'Remove Fade'} ${direction==='in'?'In':'Out'}`;pending=this.begin('region_fade',label);
   const expected=curveState(before.envelope);let state;sent=true;
   if(plan.op==='engine'){
    const result=await this.api().call('engine_set_clip_fade',{path:{project_id:context.projectId},body:{clip_id:clip.cloudId,direction,duration_sec:plan.seconds}});this.assertContext(context);
    const response=result?.data?.response,envelope=response?.envelope;
    if(response?.ok!==true||!record(envelope)||envelope.persisted!==true||envelope.clipId!==clip.cloudId)throw fail('Freestyle did not confirm the fade.','region_fade_receipt',{operationUncertain:true});
    if(!sameCurveState(curveState(response.beforeEnvelope),expected))throw fail('The region’s volume curve changed while the fade was saving.','region_fade_receipt',{operationUncertain:true});
    state=this.adopt(clip,envelope);
   }else state=await this.writeCurve(clip,{expected,target:plan.target},context);
   const after=curveState(state.envelope),target=clip.cloudId,name=clip.name||'Region';
   const step=direction=>async()=>{const current=this.context();if(current.projectId!==context.projectId)throw refused('Reopen the region’s project to use its fade history.');const from=direction==='undo'?after:expected,to=direction==='undo'?expected:after;const result=await this.writeCurve({...clip,cloudId:target},{expected:from,target:to},current);return{clipId:target,direction,fadeIn:result.fadeIn,fadeOut:result.fadeOut};};
   const journaled=this.finish(pending,{kind:'region_fade',label:`${label} – ${name}`,scope:undefined,detail:{clipId:target,direction,seconds:plan.seconds},undo:step('undo'),redo:step('redo')});pending=null;
   this.log('region-fade',{clipId:target,direction,seconds:plan.seconds,op:plan.op,journaled});
   return{changed:true,state,journaled,label};
  }catch(error){
   if(pending)this.abandon(pending,error);
   if(!sent&&error.dispatched===undefined)error.dispatched=false;
   if(sent&&!regionWriteRejected(error))error.operationUncertain=true;
   throw error;
  }finally{this.busy=false;}
 }
 /** Live clip gain from the engine (getClipWaveform clip.gain). */
 async readGain(clip,context=this.context()){
  const result=await this.api().call('getClipWaveform',{path:{project_id:context.projectId,clip_id:clip.cloudId},query:{buckets:1}});this.assertContext(context);
  const data=result?.data,placement=data?.clip??data?.placement;
  if(data?.clip_id!=null&&data.clip_id!==clip.cloudId||!finite(placement?.gain)||placement.gain<0)throw fail('Freestyle returned no live gain for this region.','region_gain_receipt');
  this.gains.set(clip.cloudId,{gain:placement.gain,generation:this.generation});return placement.gain;
 }
 loadGain(clip){if(!id(clip?.cloudId)||this.gains.has(clip.cloudId)||this.gainReads?.has(clip.cloudId))return;(this.gainReads||=new Set()).add(clip.cloudId);this.readGain(clip).then(()=>this.notify(clip.cloudId,'gain'),error=>{if(!this.gains.has(clip.cloudId))this.gains.set(clip.cloudId,{gain:null,error:error.message,generation:this.generation});}).finally(()=>this.gainReads.delete(clip.cloudId));}
 async sendGain(clip,gain,context){
  const result=await this.api().call('engine_set_clip_gain',{path:{project_id:context.projectId},body:{track_id:clip.laneId,clip_id:clip.cloudId,gain}});this.assertContext(context);
  const response=result?.data?.response;if(response?.ok!==true||!finite(response.gain)||Math.abs(response.gain-gain)>VALUE_EPS)throw fail('Freestyle did not confirm the region gain.','region_gain_receipt',{operationUncertain:true});
  const observed=await this.readGain(clip,context);if(Math.abs(observed-gain)>1e-4)throw fail('Freestyle acknowledged the region gain, but the engine still reports another value.','region_gain_receipt',{operationUncertain:true});
  this.notify(clip.cloudId,'gain');return observed;
 }
 /** Set the region's linear gain (0–4). One history step. */
 /** `before` (optional): the gain read before a live preview drag, so the history step undoes to the
  * value the user started from rather than the unsaved preview the engine now reports. */
 async setGain(clip,gain,{before:known}={}){
  if(this.busy)throw fail('Wait for the current region edit to save.','region_fade_busy',{dispatched:false});
  if(!id(clip?.cloudId)||!id(clip?.laneId)||clip.patternId)throw fail('Gain applies to saved audio regions.','region_gain_invalid',{dispatched:false});
  if(!finite(gain)||gain<0||gain>CLIP_GAIN_MAX)throw fail('Region gain must be from −∞ to +12 dB.','region_gain_invalid',{dispatched:false});
  const context=this.context();this.busy=true;let pending=null,sent=false;
  try{
   const read=await this.readGain(clip,context),before=finite(known)?known:read;if(Math.abs(before-gain)<=VALUE_EPS&&Math.abs(read-gain)<=VALUE_EPS)return{changed:false,gain:before};
   const label='Region Gain';pending=this.begin('region_gain',label);sent=true;const after=await this.sendGain(clip,gain,context);
   const step=(from,to)=>async()=>{const current=this.context();if(current.projectId!==context.projectId)throw refused('Reopen the region’s project to use its gain history.');const now=await this.readGain(clip,current);if(Math.abs(now-from)>1e-4)throw refused('This region’s gain changed since that edit. History will not overwrite it.','region_gain_changed');return{clipId:clip.cloudId,gain:await this.sendGain(clip,to,current)};};
   const journaled=this.finish(pending,{kind:'region_gain',label:`${label} ${gainDbText(after)} dB – ${clip.name||'Region'}`,detail:{clipId:clip.cloudId,before,after},undo:step(after,before),redo:step(before,after)});pending=null;
   this.log('region-gain',{clipId:clip.cloudId,before,after,journaled});
   return{changed:true,gain:after,before,journaled};
  }catch(error){
   if(pending)this.abandon(pending,error);
   if(!sent&&error.dispatched===undefined)error.dispatched=false;
   if(sent&&!regionWriteRejected(error))error.operationUncertain=true;
   throw error;
  }finally{this.busy=false;}
 }
}
