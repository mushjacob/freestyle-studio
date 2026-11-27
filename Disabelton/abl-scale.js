/**
 * Disabelton project Scale (Live 12 Scale chooser: root note + scale name) in the control bar.
 *
 * Freestyle stores one key per project: renameProject PATCH {key, scale, expected} (studio-api-engine-helpers.js
 * setProjectKey). The reply carries `undo` {key, scale}, the exact inverse, so every choice is ONE global Undo step
 * (⌘Z writes undo back with expected = the value it set; a 409 key_changed means someone changed it since and
 * nothing is written). getProject's ETag does not move on a key change, so the reply is the truth here.
 * Detect: startKeyAnalysis {track_id?} → getKeyAnalysis (Retry-After) → the detected key is set the same way
 * (one Undo step back to the previous key).
 *
 * Cross-lane API (the Clip View may highlight scale notes; it owns its own file):
 *   window.ablScale = {key, scale, pitchClasses() → [0..11]|null, contains(pitch) → bool|null, set(key, scale), detect(), onChange(fn)}
 *   event 'abl:scale-change' on document and window: detail {key, scale, pitchClasses, source}
 */
import {setProjectKey,PROJECT_KEYS,PROJECT_SCALES} from './studio-api-engine-helpers.js';

export const ABL_SCALE_INTERVALS=Object.freeze({major:Object.freeze([0,2,4,5,7,9,11]),minor:Object.freeze([0,2,3,5,7,8,10]),chromatic:Object.freeze([0,1,2,3,4,5,6,7,8,9,10,11])});
export const ABL_SCALE_LABELS=Object.freeze({major:'Major',minor:'Minor',chromatic:'Chromatic'});
const ROOTS=PROJECT_KEYS.length?PROJECT_KEYS:['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SCALES=PROJECT_SCALES.length?PROJECT_SCALES:['major','minor','chromatic'];
const keyFor=()=>globalThis.crypto?.randomUUID?.()||`scale-${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
const notApplied=error=>{if(error&&(error.status>=400&&error.status<500&&error.status!==408||error.code==='key_changed'))error.dispatched=false;return error;};

/** Pitch classes (0 = C) of a key/scale, or null when the project has no key. */
export function scalePitchClasses(key,scale){
 const root=ROOTS.indexOf(key);if(root<0)return null;const steps=ABL_SCALE_INTERVALS[scale||'major'];if(!steps)return null;
 return steps.map(step=>(root+step)%12).sort((a,b)=>a-b);
}
export function scaleLabel(key,scale){return key?`${key} ${ABL_SCALE_LABELS[scale||'major']||scale}`:'No Scale';}
/** A detected key from the analyser ("A", "a minor", "F# Major"…) as a project {key, scale}, or null. */
export function normalizeDetectedKey(analysis){
 if(!analysis)return null;let key=String(analysis.key??'').trim(),scale=String(analysis.scale??'').trim().toLowerCase();
 const m=/^([A-Ga-g])([#♯b♭]?)\s*(maj(or)?|min(or)?|m)?$/.exec(key);if(!m)return null;
 let root=m[1].toUpperCase()+(m[2]==='♯'?'#':m[2]==='♭'?'b':m[2]);const flats={Db:'C#',Eb:'D#',Gb:'F#',Ab:'G#',Bb:'A#',Cb:'B',Fb:'E'};root=flats[root]||root;if(root==='E#')root='F';if(root==='B#')root='C';
 if(!scale&&m[3])scale=/^m(in(or)?)?$/.test(m[3].toLowerCase())?'minor':'major';
 if(scale.startsWith('maj'))scale='major';else if(scale.startsWith('min'))scale='minor';
 if(!ROOTS.includes(root))return null;return{key:root,scale:SCALES.includes(scale)?scale:'major'};
}

export class AblScale{
 /** hooks: document, client(), projectId(), rawProject(), history(), menu(event, items), toast, fail, log,
  *  detectTrackId() → take/clip id for startKeyAnalysis (optional), sleep(ms) (tests). */
 constructor(hooks={}){
  this.hooks=hooks;this.document=hooks.document||globalThis.document;this.state={key:null,scale:null};this.project=null;this.listeners=new Set();this.busy=false;this.button=null;this.written=new Map();
  const self=this;
  this.api={get key(){return self.sync().key;},get scale(){return self.sync().scale;},pitchClasses:()=>{const s=self.sync();return scalePitchClasses(s.key,s.scale);},contains:pitch=>{const set=self.api.pitchClasses();return set?set.includes(((Math.round(pitch)%12)+12)%12):null;},set:(key,scale)=>self.choose(key,scale),detect:()=>self.detect(),onChange:fn=>{self.listeners.add(fn);return()=>self.listeners.delete(fn);}};
 }
 log(kind,data){try{this.hooks.log?.(kind,data);}catch{}}
 client(){try{return this.hooks.client?.()??null;}catch{return null;}}
 projectId(){try{return this.hooks.projectId?.()??null;}catch{return null;}}
 /** A newly opened project adopts its saved key; afterwards writes (their replies) are the truth. */
 sync(){
  const project=this.projectId();
  if(project!==this.project){this.project=project;if(!project)return this.state;
   // A reload of a project whose key we wrote keeps the written value (getProject's ETag does not move on a key change,
   // so a revalidated read can still carry the old key).
   const written=this.written.get(project);if(written){this.apply(written,'load');return this.state;}
   let raw=null;try{raw=this.hooks.rawProject?.()??null;}catch{}const key=ROOTS.includes(raw?.key)?raw.key:null,scale=key&&SCALES.includes(raw?.scale)?raw.scale:key?'major':null;this.apply({key,scale},'load');}
  return this.state;
 }
 apply(next,source){
  const changed=next.key!==this.state.key||next.scale!==this.state.scale;this.state={key:next.key??null,scale:next.key?next.scale??'major':null};this.paint();
  // Confirmed by a Freestyle reply (a choice, Detect, Undo/Redo): remembered for reloads of this project.
  if(['choose','detect','history'].includes(source)&&this.project)this.written.set(this.project,{...this.state});
  if(!changed&&source!=='load')return;const detail={key:this.state.key,scale:this.state.scale,pitchClasses:scalePitchClasses(this.state.key,this.state.scale),source};
  for(const fn of this.listeners)try{fn(detail);}catch{}
  const view=this.document?.defaultView,Event=view?.CustomEvent||globalThis.CustomEvent;if(Event){try{this.document.dispatchEvent(new Event('abl:scale-change',{detail}));}catch{}try{view?.dispatchEvent(new Event('abl:scale-change',{detail}));}catch{}}
 }
 /** Mount the chooser after the grid (quantization) field in the control bar's left group. */
 mount(){
  const document=this.document;if(this.button?.isConnected)return this.button;
  const anchor=document.querySelector('#abl-quantize'),bar=anchor?.parentElement||document.querySelector('.abl-bar-left');if(!bar)return null;
  const button=document.createElement('button');button.type='button';button.id='abl-scale';button.className='abl-field abl-menu-field abl-scale';button.setAttribute('aria-haspopup','menu');
  button.addEventListener('click',event=>{event.stopPropagation();this.openMenu(event);});
  if(anchor)anchor.after(button);else bar.append(button);this.button=button;this.sync();this.paint();return button;
 }
 paint(){
  const button=this.button;if(!button)return;const {key,scale}=this.state;
  button.textContent=key?`${key} ${ABL_SCALE_LABELS[scale]||scale}`:'Scale';button.classList.toggle('on',!!key);button.setAttribute('aria-pressed',String(!!key));
  button.title=`Scale: ${scaleLabel(key,scale)} · the project key Freestyle stores (root and scale; ⌘Z restores the previous key)`;button.setAttribute('aria-label',`Scale: ${scaleLabel(key,scale)}`);
  button.toggleAttribute('data-busy',this.busy);
 }
 openMenu(event){
  const state=this.sync(),ready=!!this.client()&&!!this.projectId(),why=ready?'':'Connect the Freestyle cloud project (Studio API) first.',busy=this.busy?'Wait for the current key change.':'';
  const disabled=!ready||this.busy,title=why||busy;
  const items=[
   {label:'Root Note',submenu:ROOTS.map(key=>({label:key,checked:state.key===key,disabled,title,run:()=>this.choose(key,state.scale||'major')}))},
   {label:'Scale Name',submenu:SCALES.map(scale=>({label:ABL_SCALE_LABELS[scale]||scale,checked:!!state.key&&state.scale===scale,disabled,title,run:()=>this.choose(state.key||'C',scale)}))},
   null,
   {label:'Detect Key',disabled:disabled||!this.hooks.client,title:title||'Freestyle analyses the backing (or the first audio take) and sets the detected key',run:()=>this.detect()},
   {label:'No Scale',checked:!state.key,disabled:disabled||!state.key,title,run:()=>this.choose(null,null)},
  ];
  const rect=this.button?.getBoundingClientRect?.(),at=rect?{clientX:rect.left,clientY:rect.bottom,target:this.button,preventDefault(){},stopPropagation(){}}:event;
  this.hooks.menu?.(at,items);
 }
 /** One user choice: optimistic paint, one PATCH, rollback on refusal, ONE Undo step from the reply's inverse. */
 async choose(key,scale,{source='choose',label='Set Scale'}={}){
  const before={...this.sync()};const next={key:key??null,scale:key?scale||'major':null};
  if(next.key===before.key&&next.scale===before.scale)return{changed:false};
  if(this.busy)throw Object.assign(new Error('Wait for the current key change.'),{dispatched:false});
  const client=this.client(),projectId=this.projectId();if(!client||!projectId)throw Object.assign(new Error('Connect the Freestyle cloud project (Studio API) first.'),{dispatched:false});
  this.busy=true;this.apply(next,'optimistic');
  try{
   let reply;try{reply=await setProjectKey({client,projectId,key:next.key,scale:next.scale,expected:{key:before.key,scale:before.scale},idempotencyKey:keyFor()});}
   catch(error){this.apply(before,'rollback');throw notApplied(error);}
   const confirmed={key:reply.key??null,scale:reply.key?reply.scale??next.scale:null};this.apply(confirmed,source);
   const inverse=reply.undo&&'key'in reply.undo?{key:reply.undo.key??null,scale:reply.undo.key?reply.undo.scale??'major':null}:before;
   this.log('abl-scale-set',{key:confirmed.key,scale:confirmed.scale,from:inverse});
   this.record({label,from:inverse,to:confirmed,projectId});
   return{changed:true,...confirmed,undo:inverse};
  }finally{this.busy=false;this.paint();}
 }
 /** Undo/Redo write: expected = the value this step left, so a newer change is never overwritten. */
 async write(target,expected,projectId){
  if(this.projectId()!==projectId)throw Object.assign(new Error('Open the project whose key changed first.'),{dispatched:false});
  const prior={...this.sync()};this.apply(target,'history-preview');
  try{const reply=await setProjectKey({client:this.client(),projectId,key:target.key,scale:target.scale,expected:{key:expected.key,scale:expected.scale},idempotencyKey:keyFor()});const confirmed={key:reply.key??null,scale:reply.key?reply.scale??target.scale:null};this.apply(confirmed,'history');return confirmed;}
  catch(error){this.apply(prior,'rollback');throw notApplied(error);}
 }
 record({label,from,to,projectId}){
  const history=this.hooks.history?.();if(!history?.recordExternalStep)return false;
  try{return history.recordExternalStep({kind:'project_key',label,undo:()=>this.write(from,to,projectId),redo:()=>this.write(to,from,projectId),detail:{from,to}});}catch(error){this.log('abl-scale-history-error',{message:String(error?.message||error).slice(0,160)});return false;}
 }
 /** Detect Key: startKeyAnalysis → poll getKeyAnalysis → set the detected key (one Undo step back to the previous key). */
 async detect({maxPolls=60}={}){
  const client=this.client(),projectId=this.projectId();if(!client||!projectId)throw Object.assign(new Error('Connect the Freestyle cloud project (Studio API) first.'),{dispatched:false});
  if(this.busy)throw Object.assign(new Error('Wait for the current key change.'),{dispatched:false});
  const before={...this.sync()};let trackId=null;try{trackId=this.hooks.detectTrackId?.()??null;}catch{}
  this.busy=true;this.paint();this.hooks.toast?.('Detecting the key…');
  let analysis;
  try{
   let state=(await client.call('startKeyAnalysis',{path:{project_id:projectId},body:trackId?{track_id:trackId}:{}},{idempotencyKey:keyFor()})).data||{};
   const sleep=this.hooks.sleep||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
   for(let poll=0;['pending','running'].includes(state.status)&&state.jobId&&poll<maxPolls;poll++){await sleep(1000*Math.max(1,Math.min(10,Number(state.retryAfterSec)||2)));if(this.projectId()!==projectId)return null;state=(await client.call('getKeyAnalysis',{path:{project_id:projectId,job_id:state.jobId}})).data||{};}
   this.log('abl-scale-detect',{status:state.status,analysis:state.analysis??null,trackId});
   if(state.status!=='succeeded')throw Object.assign(new Error(state.status==='failed'?`Key detection failed: ${state.error?.message||state.error?.code||'no reason given'}.`:'Key detection is still running; try Detect Key again later.'),{dispatched:true});
   analysis=normalizeDetectedKey(state.analysis);if(!analysis)throw Object.assign(new Error('Freestyle could not name a key for this project.'),{dispatched:true});
   // The analysis may already have written the project key (its project card): adopt it and keep the inverse.
   const card=state.project&&typeof state.project==='object'?state.project:null;
   if(card&&card.key===analysis.key&&(card.scale??'major')===analysis.scale){this.apply(analysis,'detect');if(before.key!==analysis.key||before.scale!==analysis.scale)this.record({label:'Detect Key',from:before,to:analysis,projectId});this.hooks.toast?.(`Detected key: ${scaleLabel(analysis.key,analysis.scale)}.`);return analysis;}
  }catch(error){throw error;}finally{this.busy=false;this.paint();}
  const result=await this.choose(analysis.key,analysis.scale,{source:'detect',label:'Detect Key'});
  this.hooks.toast?.(`Detected key: ${scaleLabel(analysis.key,analysis.scale)}${result.changed?'':' (unchanged)'}.`);return analysis;
 }
}

export function installAblScale(hooks={}){
 const scale=new AblScale(hooks),window=scale.document?.defaultView||globalThis;scale.mount();
 // The control bar may be built after this module; mount once it exists.
 if(!scale.button){const Observer=window.MutationObserver||globalThis.MutationObserver;if(Observer){const observer=new Observer(()=>{if(scale.mount())observer.disconnect();});observer.observe(scale.document.documentElement||scale.document,{childList:true,subtree:true});scale.observer=observer;}}
 window.ablScale=scale.api;return scale;
}
