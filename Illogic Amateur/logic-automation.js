/**
 * Logic Pro track automation (A) on the Illogic Tracks area.
 *
 * Freestyle keeps automation as envelopes: lane envelopes (createLaneAutomation,
 * clip id "lane:<id>", Volume/Pan over a timeline window) and clip-hosted
 * envelopes (clip gain, lane plug-in parameters) inside a region. Logic shows
 * one automation curve per track and parameter over the whole timeline: with
 * automation view on, each track header gets the parameter popup and the mode
 * button, and the curve is drawn over the track lane at absolute project time
 * (a lane envelope at its saved window, a clip envelope at its region), with a
 * flat line continuing its first/last value outside that window.
 *
 * Editing (pointer tool), each gesture ONE guarded write and ONE Undo step:
 *  - click on the lane adds a point exactly at the click time and value;
 *  - a lane envelope whose window does not reach the click is extended to it
 *    (startSec/durationSec move with the same write);
 *  - the first click on a track with no envelope creates it, covering the
 *    project with the current value as the flat line plus the clicked point
 *    (createAutomationEnvelope);
 *  - drag a point to move it; Delete removes the selected point.
 * The lane never moves the playhead (its pointer/mouse/click events stop here).
 */
import {automationHostClip,clipDurationSec,envelopeKey,normalizeAutomationPoints,automationValue,isLaneAutomation} from './automation-ui.js';
import {pointsCheck} from './automation-host-clip.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)));
const refused=message=>Object.assign(new Error(message),{dispatched:false});
const settled=error=>Object.assign(error,{dispatched:error?.dispatched??!(error?.status>=400&&error?.status<500)});

export const LOGIC_AUTOMATION_MUTE_REASON='Mute automation: Freestyle automates track Volume, Pan and plug-in parameters only.';
/** The fixed head of Logic's parameter popup. */
export const LOGIC_AUTOMATION_BASE=Object.freeze([
 Object.freeze({key:'lane.volume',label:'Volume',target:Object.freeze({kind:'lane_volume',name:'Volume'})}),
 Object.freeze({key:'lane.pan',label:'Pan',target:Object.freeze({kind:'lane_pan',name:'Pan'})}),
 Object.freeze({key:'lane.mute',label:'Mute',unavailable:LOGIC_AUTOMATION_MUTE_REASON}),
]);
export const DEFAULT_AUTOMATION_PARAMETER='lane.volume';

/** The lane a persisted envelope belongs to (lane envelopes or the host clip's lane). */
export function envelopeLaneId(project,envelope){
 const id=String(envelope?.clipId||'');if(id.startsWith('lane:'))return id.slice(5);
 return automationHostClip(project,id,envelope)?.laneId??null;
}
/** Logic label for an envelope's parameter. */
export function automationParameterLabel(envelope){
 const kind=envelope?.target?.kind;
 if(kind==='lane_volume')return 'Volume';if(kind==='lane_pan')return 'Pan';if(kind==='clip_gain')return 'Region Volume';
 return envelope?.target?.name||envelope?.targetKey||'Parameter';
}
/**
 * Parameters for one track's popup: Volume, Pan, Mute (disabled), every other
 * parameter that already has automation on this track, then plug-in
 * parameters supplied by the host (already read from the plug-in's page).
 */
export function laneAutomationParameters({project,envelopes=[],laneId,pluginParameters=[]}){
 const lane=String(laneId||''),options=LOGIC_AUTOMATION_BASE.map(item=>({...item})),seen=new Set(options.map(item=>item.key));
 for(const envelope of envelopes){if(envelopeLaneId(project,envelope)!==lane||seen.has(envelope.targetKey))continue;seen.add(envelope.targetKey);options.push({key:envelope.targetKey,label:automationParameterLabel(envelope),target:copy(envelope.target),existing:true});}
 for(const item of pluginParameters){if(!item?.key||seen.has(item.key))continue;seen.add(item.key);options.push({...item});}
 return options;
}
/** Every envelope of `targetKey` on `laneId`, at its absolute timeline window (beats). */
export function laneEnvelopeSegments({project,envelopes=[],laneId,targetKey}){
 const lane=String(laneId||''),segments=[];
 for(const envelope of envelopes){
  if(envelope?.deleted||envelope.targetKey!==targetKey)continue;
  const host=automationHostClip(project,envelope.clipId,envelope);if(!host||String(host.laneId??'')!==lane)continue;
  const durationSec=Math.max(.05,clipDurationSec(project,host.clip),...(envelope.points||[]).map(point=>Number(point.timeSec)||0));
  segments.push({envelope,key:envelopeKey(envelope),lane:host.kind==='lane',startBeat:Number(host.clip.start)||0,lengthBeats:Math.max(1e-3,Number(host.clip.length)||0),durationSec,points:normalizeAutomationPoints(envelope.points||[],durationSec)});
 }
 return segments.sort((a,b)=>a.startBeat-b.startBeat);
}
/** The value as Logic shows it on the automation line. */
export function formatAutomationValue(kind,value){
 const v=clamp(value,0,1);
 if(kind==='lane_volume'||kind==='clip_gain'){const gain=v*4;return gain<=0?'-∞ dB':`${(20*Math.log10(gain)).toFixed(1)} dB`;}
 if(kind==='lane_pan'){const pan=Math.round((v*2-1)*64);return pan===0?'0':pan>0?`+${pan}`:String(pan);}
 return `${(v*100).toFixed(1)}%`;
}
/* ---------- pure point edits (times in seconds relative to the envelope) ---------- */
/** Add a point; returns {points, index} with the new point's index after sorting. */
export function addAutomationPoint(points,{timeSec,value},durationSec){
 const point={timeSec:clamp(timeSec,0,durationSec),value:clamp(value,0,1),curve:'linear',tension:0};
 const next=[...copy(points||[]),point].sort((a,b)=>a.timeSec-b.timeSec);
 return{points:next,index:next.indexOf(point)};
}
/** Move a point; Logic keeps a point between its neighbours in time. */
export function moveAutomationPoint(points,index,{timeSec,value},durationSec){
 const next=copy(points||[]);if(!next[index])return next;
 const before=index>0?next[index-1].timeSec:0,after=index<next.length-1?next[index+1].timeSec:durationSec;
 next[index]={...next[index],timeSec:clamp(timeSec,before,after),value:clamp(value,0,1)};return next;
}
/** Remove a point; Freestyle envelopes keep at least two points. */
export function removeAutomationPoint(points,index){
 if(!Array.isArray(points)||points.length<=2)throw new Error('An automation curve keeps at least two points.');
 if(!points[index])throw new Error('Select an automation point first.');
 return copy(points).filter((_,i)=>i!==index);
}
/** Same curve within float tolerance (server-stored values are float32-ish). */
export function sameAutomationPoints(a,b,epsilon=1e-6){
 if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
 return a.every((point,index)=>{const other=b[index];return Math.abs(Number(point.timeSec)-Number(other.timeSec))<=epsilon&&Math.abs(Number(point.value)-Number(other.value))<=epsilon&&(point.curve||'linear')===(other.curve||'linear')&&Math.abs(Number(point.tension||0)-Number(other.tension||0))<=epsilon;});
}
/**
 * Logic's first click on an empty automation lane: a start point at the current
 * value and the clicked point, whose value then HOLDS to the end of the track
 * (no trailing reset point). A click at the very start gives a flat line at the
 * clicked value. Times are relative to the envelope start.
 */
export function firstClickPoints({timeSec,value,current,durationSec}){
 const at=clamp(timeSec,0,durationSec),v=clamp(value,0,1),start=clamp(current,0,1),point=(time,val)=>({timeSec:time,value:val,curve:'linear',tension:0});
 if(at<=1e-6)return[point(0,v),point(durationSec,v)];
 return[point(0,start),point(at,v)];
}
const spanOf=envelope=>isLaneAutomation(envelope)&&Number(envelope?.durationSec)>0?{startSec:Number(envelope.startSec??0),durationSec:Number(envelope.durationSec)}:null;
const sameSpan=(a,b)=>!a||!b||Math.abs(a.startSec-b.startSec)<=1e-6&&Math.abs(a.durationSec-b.durationSec)<=1e-6;
/**
 * A lane envelope extended to reach `atSec` (absolute): the window grows to
 * [min(start, at), max(end, at, minEndSec)] and the points shift with its new start.
 * Returns {span, points} or null when the window already reaches it.
 */
export function extendLaneWindow(envelope,points,atSec,{minEndSec=0}={}){
 const span=spanOf(envelope);if(!span)return null;const end=span.startSec+span.durationSec;
 if(atSec>=span.startSec-1e-9&&atSec<=end+1e-9&&end>=minEndSec-1e-9)return null;
 const start=Math.max(0,Math.min(span.startSec,atSec)),newEnd=Math.max(end,atSec,minEndSec),shift=span.startSec-start;
 return{span:{startSec:start,durationSec:newEnd-start},points:copy(points||[]).map(point=>({...point,timeSec:point.timeSec+shift}))};
}
/**
 * One gesture's edit: an optimistic, revision-guarded save of the whole point
 * list (and, for a lane envelope that grows, its window), recorded as ONE
 * external Undo step. Undo/Redo re-read the envelope and only write while it
 * still holds this step's curve; otherwise they refuse (nothing sent) so newer
 * edits are never overwritten.
 */
export async function saveAutomationPointEdit({store,history,envelope,points,span=null,label='Automation',log=()=>{}}){
 const key=envelopeKey(envelope),current=store.get(key)||envelope;
 if(!current?.persisted||!current.id)throw new Error('This automation is not saved in Freestyle yet; create it first.');
 const beforeSpan=spanOf(current),afterSpan=span&&beforeSpan?{startSec:Number(span.startSec),durationSec:Number(span.durationSec)}:beforeSpan;
 const durationSec=Math.max(.05,afterSpan?.durationSec||Number(envelope.durationSec)||0,...(points||[]).map(point=>Number(point.timeSec)||0));
 const before=copy(current.points||[]),after=normalizeAutomationPoints(points,durationSec);
 if(sameAutomationPoints(before,after)&&sameSpan(beforeSpan,afterSpan))return{saved:current,recorded:false,unchanged:true};
 const journal=typeof history==='function'?history():history,scope=journal?.context?.();
 const saved=await store.save({...current,...(afterSpan||{})},after);
 log('logic-automation-points',{phase:'save',key,envelopeId:saved?.id??current.id,revision:saved?.revision??null,span:afterSpan,...pointsCheck(after)});
 const reread=async()=>{try{await store.reloadClip(String(current.clipId));}catch(error){throw Object.assign(error,{dispatched:false});}return store.get(key);};
 const apply=async([expected,expectedSpan],[target,targetSpan],phase)=>{
  const live=await reread();
  if(!live?.persisted||!live.id)throw refused('That automation was deleted. History will not recreate it from a point edit.');
  const liveSpan=spanOf(live);
  if(sameAutomationPoints(live.points||[],target)&&sameSpan(liveSpan,targetSpan))return{key,noop:true};
  if(!sameAutomationPoints(live.points||[],expected)||!sameSpan(liveSpan,expectedSpan))throw refused('That automation changed after this edit. History will not overwrite the newer curve.');
  let result;try{result=await store.save({...live,...(targetSpan||{})},copy(target));}catch(error){throw settled(error);}
  log('logic-automation-points',{phase,key,envelopeId:result?.id??live.id,revision:result?.revision??null,span:targetSpan,...pointsCheck(target)});return{key,envelopeId:result?.id??live.id};
 };
 const recorded=journal?.recordExternalStep?journal.recordExternalStep({kind:'automation_points',label,scope,detail:{key,before:pointsCheck(before),after:pointsCheck(after),beforeSpan,afterSpan},undo:()=>apply([after,afterSpan],[before,beforeSpan],'undo'),redo:()=>apply([before,beforeSpan],[after,afterSpan],'redo')}):false;
 return{saved,recorded:recorded!==false};
}
/**
 * First automation for a parameter (Logic's first click on the lane): ONE write
 * creating the envelope with its points (createLaneAutomation / create clip
 * automation) and ONE Undo step. Undo deletes it only while it still holds the
 * created curve; Redo recreates exactly that curve.
 * envelope: {clipId, laneId?, target, targetKey, valueType, defaultValue, startSec?, durationSec?}
 */
const creating=new WeakMap();
/** True while a create for this envelope key is being saved in this store. */
export function automationCreatePending(store,key){return !!creating.get(store)?.has(key);}
export async function createAutomationEnvelope({store,history,envelope,points,label='Create Automation',log=()=>{}}){
 // One create per envelope at a time: a second click while the first is saving
 // must never write a second create (two Undo steps for one curve).
 const key=envelopeKey(envelope),keys=creating.get(store)||new Set();
 if(keys.has(key))throw refused('That automation is still being created.');
 keys.add(key);creating.set(store,keys);
 try{return await createAutomationOnce({store,history,envelope,points,label,log,key});}finally{keys.delete(key);}
}
async function createAutomationOnce({store,history,envelope,points,label,log,key}){
 if(!store.loaded)await store.load();
 const existing=store.get(key);if(existing?.persisted&&existing.id)throw new Error('That parameter already has automation here.');
 const durationSec=Math.max(.05,Number(envelope.durationSec)||0,...(points||[]).map(point=>Number(point.timeSec)||0)),clean=normalizeAutomationPoints(points,durationSec);
 const journal=typeof history==='function'?history():history,scope=journal?.context?.();
 const fresh=()=>({...copy(envelope),persisted:false,revision:0,id:undefined,points:copy(clean)});
 const made=await store.save(fresh(),copy(clean));
 if(!made?.persisted||!made.id)throw Object.assign(new Error('Freestyle did not return the saved automation (no envelope id).'),{operationUncertain:true});
 let saved={id:made.id,points:copy(made.points||clean)};
 log('logic-automation-create',{phase:'create',key,envelopeId:made.id,revision:made.revision??null,...pointsCheck(clean)});
 const reread=async()=>{try{await store.reloadClip(String(envelope.clipId));}catch(error){throw Object.assign(error,{dispatched:false});}return store.get(key);};
 const undo=async()=>{
  const live=await reread();
  // Already gone: the end state this Undo wants. It counts as applied (nothing sent), so history moves past it.
  if(!live?.persisted||!live.id){log('logic-automation-create',{phase:'undo',key,envelopeId:saved.id,noop:'already_removed'});return{key,noop:true,alreadyRemoved:true};}
  if(live.id!==saved.id||!sameAutomationPoints(live.points||[],saved.points))throw refused('That automation was edited after it was created. Undo will not delete the newer curve.');
  try{await store.remove(live);}catch(error){throw settled(error);}
  log('logic-automation-create',{phase:'undo',key,envelopeId:live.id});return{key,envelopeId:live.id};
 };
 const redo=async()=>{
  const live=await reread();
  if(live?.persisted&&live.id){
   // Already exactly the created curve: applied. Anything else is newer data Redo will not overwrite.
   if(sameAutomationPoints(live.points||[],clean)){saved={id:live.id,points:copy(live.points||clean)};log('logic-automation-create',{phase:'redo',key,envelopeId:live.id,noop:'already_present'});return{key,envelopeId:live.id,noop:true};}
   throw refused('That automation exists again. Redo will not overwrite it.');
  }
  let again;try{again=await store.save(fresh(),copy(clean));}catch(error){throw settled(error);}
  if(!again?.persisted||!again.id)throw Object.assign(new Error('Freestyle did not confirm the recreated automation.'),{operationUncertain:true});
  saved={id:again.id,points:copy(again.points||clean)};log('logic-automation-create',{phase:'redo',key,envelopeId:again.id});return{key,envelopeId:again.id};
 };
 const recorded=journal?.recordExternalStep?journal.recordExternalStep({kind:'automation_create',label,scope,detail:{key,...pointsCheck(clean)},undo,redo}):false;
 return{envelope:made,recorded:recorded!==false};
}
/* ---------- rendering ---------- */
function curvePath(points,durationSec,steps=160){
 if(!points.length)return '';
 return Array.from({length:steps+1},(_,i)=>{const time=i/steps*durationSec;return `${i?'L':'M'}${(i/steps*1000).toFixed(1)},${(100-automationValue(points,time)*100).toFixed(2)}`;}).join(' ');
}
/** Markup for one envelope segment over the lane (absolute window). */
export function automationSegmentHtml(segment,{selectedPoint=null,kind=''}={}){
 const {envelope,key,startBeat,lengthBeats,durationSec,points}=segment,path=curvePath(points,durationSec);
 const nodes=points.map((point,index)=>`<span class="logic-auto-point${selectedPoint===index?' selected':''}" data-point="${index}" style="left:${(point.timeSec/durationSec*100).toFixed(3)}%;top:${((1-point.value)*100).toFixed(3)}%" title="${esc(formatAutomationValue(kind,point.value))}"></span>`).join('');
 return `<div class="logic-auto-segment${envelope.saving?' saving':''}${envelope.saveError?' save-error':''}" data-envelope-key="${esc(key)}" style="left:calc(${startBeat/4} * var(--bar));width:calc(${lengthBeats/4} * var(--bar))" title="${esc(envelope.saveError||'Click to add a point · drag a point to move it · Delete removes the selected point')}"><svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><path class="logic-auto-line" d="${path}" vector-effect="non-scaling-stroke"/></svg>${nodes}</div>`;
}
/** Logic draws the curve across the whole track: flat lines before the first and after the last envelope. */
function extensionsHtml(segments){
 if(!segments.length)return '';const first=segments[0],last=segments.at(-1),firstValue=first.points[0]?.value,lastValue=last.points.at(-1)?.value;
 const line=(style,value)=>Number.isFinite(value)?`<span class="logic-auto-extend" aria-hidden="true" style="${style};top:${((1-value)*100).toFixed(3)}%"></span>`:'';
 return line(`left:0;width:calc(${first.startBeat/4} * var(--bar))`,firstValue)+line(`left:calc(${(last.startBeat+last.lengthBeats)/4} * var(--bar));right:0`,lastValue);
}
/**
 * Logic automation view controller. Host callbacks:
 *  getProject(), getStore(), getLaneIds() → timeline lane ids by row,
 *  beatAt(clientX, grid) → absolute beat, snapBeat(beat) → snapped beat,
 *  getProjectEndSec(), getPluginParameters(laneId), getPluginMenu(laneId, pick),
 *  onChooseParameter(laneId, option), onCreate(laneId, option, {timeSec, beat, value}),
 *  onCommit({envelope, points, label, span}), onMode(laneId, event), menu(event, items),
 *  onStatus(text), onRepaint().
 */
export class LogicAutomationView{
 constructor(options={}){
  this.options=options;this.enabled=false;this.parameters=new Map();this.selection=null;this.gesture=null;this.creating=new Map();
  this.document=options.document||globalThis.document;
  this.keyListener=event=>this.keydown(event);this.document?.addEventListener?.('keydown',this.keyListener,true);
 }
 parameter(laneId){return this.parameters.get(String(laneId))||DEFAULT_AUTOMATION_PARAMETER;}
 setParameter(laneId,key){this.parameters.set(String(laneId),key);this.selection=null;}
 toggle(force){this.enabled=typeof force==='boolean'?force:!this.enabled;if(!this.enabled)this.selection=null;return this.enabled;}
 status(text){try{this.options.onStatus?.(text);}catch{}}
 envelopes(){const store=this.options.getStore?.();return store?.persisted?.()||[];}
 bpm(){return Number(this.options.getProject?.()?.bpm)||120;}
 options_(laneId){const project=this.options.getProject?.();let plugin=[];try{plugin=this.options.getPluginParameters?.(laneId)||[];}catch{}return laneAutomationParameters({project,envelopes:this.envelopes(),laneId,pluginParameters:plugin});}
 /** Paint (or clear) automation headers and curves on every lane-bound track row under host. */
 paint(host){
  if(!host)return;const document=host.ownerDocument;
  for(const node of host.querySelectorAll('.logic-auto-header,.logic-auto-overlay'))node.remove();
  for(const node of host.querySelectorAll('.logic-auto-row'))node.classList.remove('logic-auto-row');
  host.classList.toggle('logic-automation-view',this.enabled);if(!this.enabled)return;
  const project=this.options.getProject?.();if(!project)return;const laneIds=this.options.getLaneIds?.()||[],envelopes=this.envelopes();
  for(const grid of host.querySelectorAll('.lane-grid[data-track]')){
   const laneId=laneIds[Number(grid.dataset.track)];if(!laneId)continue;
   const options=this.options_(laneId),key=this.parameter(laneId),option=options.find(item=>item.key===key)||options[0];
   const row=grid.closest('.track-lane'),label=row?.querySelector('.track-label');row?.classList.add('logic-auto-row');
   if(label){const header=document.createElement('div');header.className='logic-auto-header';header.dataset.laneId=laneId;
    const popup=document.createElement('button');popup.type='button';popup.className='logic-auto-param';popup.textContent=option.label;popup.title=`Automation parameter: ${option.label}`;popup.setAttribute('aria-haspopup','menu');
    popup.onclick=event=>{event.stopPropagation();this.parameterMenu(event,laneId);};
    const mode=document.createElement('button');mode.type='button';mode.className='logic-auto-mode';mode.textContent='Read';mode.dataset.mode='read';mode.title='Automation mode: Read';
    mode.onclick=event=>{event.stopPropagation();this.options.onMode?.(laneId,event);};
    for(const node of [popup,mode,header])for(const type of ['pointerdown','mousedown','dblclick'])node.addEventListener(type,event=>event.stopPropagation());
    header.append(popup,mode);label.append(header);}
   const overlay=document.createElement('div');overlay.className='logic-auto-overlay';overlay.dataset.laneId=laneId;overlay.dataset.parameter=option.key;
   const kind=option.target?.kind||'',segments=option.unavailable?[]:laneEnvelopeSegments({project,envelopes,laneId,targetKey:option.key});
   overlay.innerHTML=extensionsHtml(segments)+segments.map(segment=>automationSegmentHtml(segment,{kind,selectedPoint:this.selection?.key===segment.key?this.selection.index:null})).join('')+(segments.length?'':`<span class="logic-auto-empty">${esc(option.unavailable||`Click to add ${option.label} automation`)}</span>`);
   overlay.onpointerdown=event=>this.pointerdown(event,{laneId,option,segments,overlay,grid});
   // The automation lane owns its clicks: they never reach the Tracks area (no playhead move, no marquee).
   for(const type of ['mousedown','click','dblclick','contextmenu'])overlay.addEventListener(type,event=>{event.stopPropagation();if(type==='contextmenu')event.preventDefault();});
   grid.append(overlay);
  }
 }
 parameterMenu(event,laneId){
  const current=this.parameter(laneId),options=this.options_(laneId),pick=option=>()=>{this.setParameter(laneId,option.key);this.options.onChooseParameter?.(laneId,option);};
  const items=options.map(option=>({label:option.label,checked:option.key===current,disabled:!!option.unavailable,title:option.unavailable||'',run:pick(option)}));
  let more=[];try{more=this.options.getPluginMenu?.(laneId,pick)||[];}catch{}
  this.options.menu?.(event,more.length?[...items,null,...more]:items);
 }
 frac(event,element){const rect=element.getBoundingClientRect();return{x:rect.width>0?clamp((event.clientX-rect.left)/rect.width,0,1):0,y:rect.height>0?clamp((event.clientY-rect.top)/rect.height,0,1):0};}
 /** The absolute click position: beat (snapped unless Alt) and value from the lane's height. */
 clickAt(event,overlay,grid){
  let beat=Number(this.options.beatAt?.(event.clientX,grid));if(!Number.isFinite(beat))beat=0;beat=Math.max(0,beat);
  if(!event.altKey&&typeof this.options.snapBeat==='function'){const snapped=Number(this.options.snapBeat(beat));if(Number.isFinite(snapped))beat=Math.max(0,snapped);}
  return{beat,timeSec:beat*60/this.bpm(),value:1-this.frac(event,overlay).y};
 }
 pointerdown(event,{laneId,option,segments,overlay,grid}){
  if(event.button!==0||event.isPrimary===false)return;event.preventDefault();event.stopPropagation();
  if(option.unavailable){this.status(option.unavailable);return;}
  const node=event.target.closest?.('[data-point]'),element=node?.closest('.logic-auto-segment');
  if(node&&element){const segment=segments.find(item=>item.key===element.dataset.envelopeKey);if(segment)this.dragPoint(event,{segment,element,index:Number(node.dataset.point),added:false,option});return;}
  const at=this.clickAt(event,overlay,grid),kind=option.target?.kind||'';
  const inside=segments.find(item=>at.beat>=item.startBeat-1e-9&&at.beat<=item.startBeat+item.lengthBeats+1e-9);
  if(inside){
   const element=[...overlay.querySelectorAll('.logic-auto-segment')].find(item=>item.dataset.envelopeKey===inside.key);
   const local=at.timeSec-inside.startBeat*60/this.bpm(),result=addAutomationPoint(inside.points,{timeSec:local,value:at.value},inside.durationSec);
   this.selection={key:inside.key,index:result.index};
   if(element)this.dragPoint(event,{segment:{...inside,points:result.points},element,index:result.index,added:true,option});
   else this.commit({envelope:inside.envelope,points:result.points,label:`Add ${option.label} Automation Point`});
   return;
  }
  // Logic: one curve per track. A lane envelope grows to the click in the same write.
  const laneSegment=segments.find(item=>item.lane);
  if(laneSegment){
   const grown=extendLaneWindow(laneSegment.envelope,laneSegment.points,at.timeSec,{minEndSec:Number(this.options.getProjectEndSec?.())||0});
   if(grown){const local=at.timeSec-grown.span.startSec,result=addAutomationPoint(grown.points,{timeSec:local,value:at.value},grown.span.durationSec);this.selection={key:laneSegment.key,index:result.index};this.commit({envelope:{...laneSegment.envelope,durationSec:grown.span.durationSec},points:result.points,span:grown.span,label:`Add ${option.label} Automation Point`});return;}
  }
  // No envelope reaches the click: the host creates one (lane: the whole project; region parameters: the clicked region).
  // Logic: clicking an empty lane creates the curve with a point; another click adds a point. While the
  // create is saving, a further click on the same lane/parameter waits for the curve and then adds its
  // point (its own Undo step); the second click of a double-click lands on the created point and adds nothing.
  this.selection=null;void kind;
  const createKey=`${laneId}|${option.key}`,pending=this.creating.get(createKey);
  if(pending){pending.then(created=>{if(created)this.addQueuedPoint(laneId,option,at);},()=>{});return;}
  const run=Promise.resolve().then(()=>this.options.onCreate?.(laneId,option,at)).then(()=>true,error=>{this.status(error?.message||String(error));return false;}).finally(()=>{if(this.creating.get(createKey)===run)this.creating.delete(createKey);});
  this.creating.set(createKey,run);
 }
 /** A click queued behind a create: add its point to the curve now saved (nothing when it already holds that point). */
 addQueuedPoint(laneId,option,at){
  const segments=laneEnvelopeSegments({project:this.options.getProject?.(),envelopes:this.envelopes(),laneId,targetKey:option.key}),bpm=this.bpm();
  const inside=segments.find(item=>at.beat>=item.startBeat-1e-9&&at.beat<=item.startBeat+item.lengthBeats+1e-9);
  if(inside){
   const local=at.timeSec-inside.startBeat*60/bpm;
   if(inside.points.some(point=>Math.abs(point.timeSec-local)<=1e-3))return false;
   const result=addAutomationPoint(inside.points,{timeSec:local,value:at.value},inside.durationSec);this.selection={key:inside.key,index:result.index};
   this.commit({envelope:{...inside.envelope,durationSec:inside.durationSec},points:result.points,label:`Add ${option.label} Automation Point`});return true;
  }
  const laneSegment=segments.find(item=>item.lane),grown=laneSegment&&extendLaneWindow(laneSegment.envelope,laneSegment.points,at.timeSec,{minEndSec:Number(this.options.getProjectEndSec?.())||0});
  if(!grown)return false;
  const result=addAutomationPoint(grown.points,{timeSec:at.timeSec-grown.span.startSec,value:at.value},grown.span.durationSec);this.selection={key:laneSegment.key,index:result.index};
  this.commit({envelope:{...laneSegment.envelope,durationSec:grown.span.durationSec},points:result.points,span:grown.span,label:`Add ${option.label} Automation Point`});return true;
 }
 dragPoint(event,{segment,element,index,added,option}){
  this.selection={key:segment.key,index};
  this.gesture={segment,element,points:segment.points,index,added,moved:false,pointerId:event.pointerId,label:`${added?'Add':'Move'} ${option.label} Automation Point`,kind:option.target?.kind||''};
  try{element.setPointerCapture?.(event.pointerId);}catch{}
  this.preview();
  const move=moveEvent=>{const gesture=this.gesture;if(!gesture||moveEvent.pointerId!==gesture.pointerId)return;moveEvent.preventDefault();const pos=this.frac(moveEvent,element),target={timeSec:pos.x*segment.durationSec,value:1-pos.y};gesture.points=moveAutomationPoint(gesture.points,gesture.index,target,segment.durationSec);gesture.moved=true;this.preview();this.status(`${option.label}: ${formatAutomationValue(gesture.kind,target.value)}`);};
  const detach=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',end);element.removeEventListener('pointercancel',cancel);};
  const end=upEvent=>{const gesture=this.gesture;if(!gesture||upEvent.pointerId!==gesture.pointerId)return;upEvent.stopPropagation();detach();this.gesture=null;if(gesture.added||gesture.moved)this.commit({envelope:{...gesture.segment.envelope,durationSec:gesture.segment.durationSec},points:gesture.points,label:gesture.label});};
  const cancel=cancelEvent=>{if(!this.gesture||cancelEvent.pointerId!==this.gesture.pointerId)return;detach();this.gesture=null;this.repaint();};
  element.addEventListener('pointermove',move);element.addEventListener('pointerup',end);element.addEventListener('pointercancel',cancel);
 }
 /** Redraw the dragged segment in place (no save until release). */
 preview(){
  const gesture=this.gesture;if(!gesture)return;const {segment,element,points,index}=gesture;
  const html=automationSegmentHtml({...segment,points},{selectedPoint:index,kind:gesture.kind}),holder=element.ownerDocument.createElement('div');holder.innerHTML=html;const fresh=holder.firstElementChild;
  element.replaceChildren(...fresh.childNodes);
 }
 repaint(){try{this.options.onRepaint?.();}catch{}}
 commit(packet){
  // Sent at the release (the store paints the optimistic curve at once); a refusal is reported and repainted.
  let pending;try{pending=this.options.onCommit?.(packet);}catch(error){pending=Promise.reject(error);}
  Promise.resolve(pending).catch(error=>{this.status(error?.message||String(error));}).finally(()=>this.repaint());
 }
 keydown(event){
  if(!this.enabled||!this.selection||this.gesture||!['Delete','Backspace'].includes(event.key)||event.metaKey||event.ctrlKey||event.altKey)return;
  const target=event.target;if(target?.closest?.('input,textarea,select,[contenteditable="true"],dialog'))return;
  const store=this.options.getStore?.(),envelope=store?.get?.(this.selection.key);if(!envelope){this.selection=null;return;}
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();
  const project=this.options.getProject?.(),host=automationHostClip(project,envelope.clipId,envelope),durationSec=Math.max(.05,host?clipDurationSec(project,host.clip):0,...(envelope.points||[]).map(point=>Number(point.timeSec)||0)),points=normalizeAutomationPoints(envelope.points||[],durationSec);
  let next;try{next=removeAutomationPoint(points,this.selection.index);}catch(error){this.status(error.message);return;}
  this.selection=null;this.commit({envelope:{...envelope,durationSec},points:next,label:`Delete ${automationParameterLabel(envelope)} Automation Point`});
 }
 destroy(){this.document?.removeEventListener?.('keydown',this.keyListener,true);}
}
