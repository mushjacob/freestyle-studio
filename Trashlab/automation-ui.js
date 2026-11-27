/** Freestyle persisted automation envelopes shown as FL-style automation clips; playback remains on the cloud engine. */
import {clientLog} from './client-diagnostics.js';
import {hostFetch} from './freestyle-host-transport.js';
const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const curves=new Set(['linear','hold','bezier','db']);
const retryKey=()=>globalThis.crypto?.randomUUID?.()||`automation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const now=()=>globalThis.performance?.now?.()??Date.now();
/**
 * updateAutomationEnvelope / deleteAutomationEnvelope take If-Match = the plain
 * integer envelope revision (spec: "If-Match (or expectedRevision) = the revision
 * you read"). Pass it explicitly so the bridge never substitutes the project ETag.
 */
export function automationWriteOptions(name,args){
  const options={idempotencyKey:retryKey()};
  if((name==='update_automation'||name==='delete_automation')&&Number.isInteger(args?.expected_revision))options.ifMatch=String(args.expected_revision);
  return options;
}
/** details.envelope of a 409/412 revision_conflict, wherever the error wrapper nested it. */
function conflictEnvelope(error){
  if(record(error?.envelope))return error.envelope;
  const queue=[error?.result,error?.details],seen=new Set();
  while(queue.length){const value=queue.shift();if(!record(value)||seen.has(value)||seen.size>32)continue;seen.add(value);if(record(value.details)&&record(value.details.envelope))return value.details.envelope;for(const key of ['error','response','structuredContent','result','data'])queue.push(value[key]);}
  return null;
}
/** Every envelope write (including failures) is visible in the local client diagnostics ring. */
async function loggedWrite(call,name,args){
  const options=automationWriteOptions(name,args),started=now(),op=name.replace('_automation','');
  const entry={op,envelopeId:args.envelope_id??null,ifMatch:options.ifMatch??null};
  try{const result=await call(name,args,options);const data=unwrap(result);clientLog('automation-write',{...entry,envelopeId:entry.envelopeId??data?.envelope?.id??data?.envelopeId??null,revision:data?.envelope?.revision??null,status:'ok',code:null,ms:Math.round(now()-started)});return data;}
  catch(error){clientLog('automation-write',{...entry,status:error?.status??null,code:error?.code??null,message:String(error?.message||'').slice(0,240),ms:Math.round(now()-started)});throw error;}
}

/**
 * Canonical Studio point list: full-precision relative times, at most two
 * points per time (a discontinuity pair: first and last in input order),
 * caller metadata retained and supported curves including dB gain.
 */
export function normalizeAutomationPoints(points,durationSec) {
  const duration=Number(durationSec);if(!Number.isFinite(duration)||duration<0)throw new Error('Automation duration must be finite and non-negative.');
  const byTime=new Map();
  for(const point of points||[]) {
    if(!Number.isFinite(Number(point?.timeSec))||!Number.isFinite(Number(point?.value)))continue;
    const timeSec=clamp(point.timeSec,0,duration),curve=curves.has(point.curve)?point.curve:'linear';
    const clean={timeSec,value:clamp(point.value,0,1),curve,tension:curve==='bezier'?clamp(point.tension||0,-1,1):0};
    if(record(point.meta))clean.meta=copy(point.meta);
    // Only two in-range points at one exact time form a jump; a clamped
    // out-of-range point replaces instead of inventing a discontinuity.
    const exact=timeSec===Number(point.timeSec),same=byTime.get(timeSec);
    if(!same||!exact||!same.exact)byTime.set(timeSec,{exact,points:[clean]});else same.points.splice(1,1,clean);
  }
  return [...byTime.entries()].sort((a,b)=>a[0]-b[0]).flatMap(entry=>entry[1].points);
}
export function automationValue(points,timeSec) {
  if(!points?.length)return 0;
  if(timeSec<points[0].timeSec)return points[0].value;
  if(timeSec>=points.at(-1).timeSec)return points.at(-1).value;
  for(let i=1;i<points.length;i++) {
    const start=points[i-1],end=points[i];if(timeSec>=end.timeSec)continue;
    if(start.curve==='hold'||end.timeSec<=start.timeSec)return start.value;
    let position=clamp((timeSec-start.timeSec)/(end.timeSec-start.timeSec),0,1);
    if(start.curve==='bezier'){const exponent=1+Math.abs(start.tension||0)*9;position=start.tension>=0?Math.pow(position,exponent):1-Math.pow(1-position,exponent);}
    if(start.curve==='db'&&start.value>0&&end.value>0)return start.value*Math.pow(end.value/start.value,position);
    return start.value+(end.value-start.value)*position;
  }
  return points.at(-1).value;
}
export function automationTargetKey(target) {
  if(!record(target))throw new Error('Automation target is required.');
  if(target.kind==='clip_gain')return 'clip.gain';
  // 328 spec lane envelopes (createLaneAutomation): clipId 'lane:<lane_id>', one per lane per target.
  if(target.kind==='lane_volume')return 'lane.volume';
  if(target.kind==='lane_pan')return 'lane.pan';
  if(target.kind==='plugin_parameter'){const instance=String(target.pluginInstanceId||'').trim(),param=String(target.stableParamId??'').trim();if(!instance||!param)throw new Error('Plugin automation requires the plugin instance and its stable parameter id.');return `lane.plugin:${instance}.param:${param}`;}
  throw new Error(`Freestyle cannot automate ${target.kind||'this'} target.`);
}
export const envelopeKey=envelope=>`${envelope.clipId}|${envelope.targetKey||automationTargetKey(envelope.target)}`;
const LANE_KINDS=new Set(['lane_volume','lane_pan']);
/** A lane volume/pan envelope (timeline-scoped, not hosted in a clip). */
export const isLaneAutomation=value=>LANE_KINDS.has(value?.kind)||LANE_KINDS.has(value?.target?.kind)||LANE_KINDS.has(value?.targetKind)||String(value?.clipId||'').startsWith('lane:');
export const laneAutomationClipId=laneId=>`lane:${laneId}`;
/** Spec units: lane_volume gain = 4·value (0.25 = unity); lane_pan pan = 2·value − 1 (0.5 = center). */
export const laneVolumeValue=gain=>clamp((Number.isFinite(Number(gain))?Number(gain):1)/4,0,1);
export const lanePanValue=pan=>clamp(((Number.isFinite(Number(pan))?Number(pan):0)+1)/2,0,1);
/**
 * FL: a new automation clip covers the Playlist time selection (here the loop
 * region), else it starts at the playhead's bar and runs `bars` bars.
 * Returns {startSec, durationSec, startBeat, lengthBeats}.
 */
export function laneAutomationWindow({bpm=120,beatsPerBar=4,playheadBeat=0,loop=null,bars=4}={}){
  const tempo=Number(bpm)>0?Number(bpm):120,perBar=Number(beatsPerBar)>0?Number(beatsPerBar):4;
  const loopStart=Number(loop?.startSec),loopEnd=Number(loop?.endSec);
  if(loop?.enabled&&Number.isFinite(loopStart)&&Number.isFinite(loopEnd)&&loopStart>=0&&loopEnd>loopStart)return{startSec:loopStart,durationSec:loopEnd-loopStart,startBeat:loopStart*tempo/60,lengthBeats:(loopEnd-loopStart)*tempo/60};
  const startBeat=Math.max(0,Math.floor((Number(playheadBeat)||0)/perBar)*perBar),lengthBeats=perBar*Math.max(1,Number(bars)||4);
  return{startSec:startBeat*60/tempo,durationSec:lengthBeats*60/tempo,startBeat,lengthBeats};
}
export function automationWrite(envelope,points,projectId) {
  if(envelope.pointsTruncated||envelope.points_truncated)throw new Error('Freestyle returned a partial envelope. Reload all points before editing it.');
  const args={project_id:projectId,points:points.map(point=>({timeSec:point.timeSec,value:point.value,curve:point.curve||'linear',tension:point.tension||0,...(record(point.meta)?{meta:copy(point.meta)}:{})})),default_value:Number(envelope.defaultValue??.25),value_type:envelope.valueType||'continuous'};
  if(envelope.persisted&&envelope.id) {
    if(!Number.isInteger(Number(envelope.revision)))throw new Error('Reload the envelope to obtain its current revision.');
    // A lane envelope's timeline window is sent only when an edit moves it (Logic track automation extending its curve).
    const moved=envelope.windowChange&&isLaneAutomation(envelope)&&Number(envelope.windowChange.durationSec)>0&&Number(envelope.windowChange.startSec)>=0?{startSec:Number(envelope.windowChange.startSec),durationSec:Number(envelope.windowChange.durationSec)}:{};
    return{name:'update_automation',arguments:{...args,envelope_id:envelope.id,expected_revision:Number(envelope.revision),...moved}};
  }
  if(isLaneAutomation(envelope)){
    const laneId=envelope.laneId||String(envelope.clipId||'').replace(/^lane:/,''),startSec=Number(envelope.startSec??0),durationSec=Number(envelope.durationSec);
    if(!laneId||!(durationSec>0)||!(startSec>=0))throw new Error('A lane automation clip needs its lane and timeline window.');
    return{name:'create_lane_automation',arguments:{...args,lane_id:laneId,target:{kind:envelope.target?.kind||envelope.targetKind},startSec,durationSec}};
  }
  if(!envelope.clipId||!envelope.target?.kind)throw new Error('Select a canonical cloud clip and target first.');
  return{name:'create_automation',arguments:{...args,clip_id:envelope.clipId,target:copy(envelope.target)}};
}
function unwrap(result) {
  let data=result?.structuredContent;if(!data&&Array.isArray(result?.content)){try{data=JSON.parse(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));}catch{}}
  data=data??result;const response=data?.response??data;
  if(result?.isError||data?.error||data?.ok===false||response?.error||response?.ok===false){const error=new Error(response?.message||response?.error?.message||response?.error||data?.message||'Freestyle could not save automation.');error.code=response?.code||response?.error?.code||data?.code;error.status=response?.status||data?.status;error.envelope=response?.envelope||response?.error?.envelope||null;error.result=data;throw error;}
  return response;
}
async function defaultCall(name,args,options={}) {
  const response=await hostFetch('/api/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args,...(options.idempotencyKey?{idempotencyKey:options.idempotencyKey}:{}),...(options.ifMatch!==undefined?{ifMatch:options.ifMatch}:{})})});
  const data=await response.json();if(!response.ok)throw new Error(data.detail||data.error||`Cloud automation request failed (${response.status}).`);return unwrap(data);
}
function stylesheet(){if(typeof document==='undefined'||document.querySelector('link[data-vegetable-automation]')||document.querySelector('link[href$="automation-ui.css"]')||!import.meta.url.endsWith('/automation-ui.js'))return;const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./automation-ui.css',import.meta.url);link.dataset.vegetableAutomation='true';document.head.append(link);}
const conflictError=error=>error?.status===409||error?.status===412||/revision|conflict|automation_exists|already exists|precondition/i.test(`${error?.code||''} ${error?.message||''}`);

/* ---------- project geometry: envelopes live inside clips ---------- */
const clipCloudId=clip=>String(clip?.cloudId||clip?.id||'');
export function automationClipId(clip){return clip?.patternId?`pattern:${clipCloudId(clip)}`:clipCloudId(clip);}
/** The project clip an envelope belongs to, with its timeline geometry. */
export function automationHostClip(project,clipId,envelope=null) {
  const id=String(clipId||'');if(!id)return null;
  if(id.startsWith('lane:')){
    // A lane envelope is its own Playlist clip: its timeline window, on its lane's row.
    const laneId=id.slice(5),source=envelope||null,startSec=Number(source?.startSec??0),durationSec=Number(source?.durationSec);
    if(!laneId||!(durationSec>0))return null;
    const bpm=Number(project?.bpm)||120,rows=project?.cloud?.timelineLaneIds||[],row=rows.indexOf(laneId);
    const channel=(project?.channels||[]).find(item=>!item.patternSource&&String(item.laneId)===laneId)||(project?.channels||[]).find(item=>String(item.laneId)===laneId);
    const lane=(project?.cloud?.rawProject?.lanes||[]).find(item=>item?.id===laneId);
    if(row<0&&!channel&&!lane)return null;
    return{clip:{id,cloudId:id,start:Math.max(0,startSec)*bpm/60,length:durationSec*bpm/60,track:row>=0?row:Number(channel?.track)||0,name:lane?.name||channel?.name||'Track'},kind:'lane',laneId};
  }
  if(id.startsWith('pattern:')){const raw=id.slice(8),clip=(project?.clips||[]).find(item=>clipCloudId(item)===raw);return clip?{clip,kind:'pattern',laneId:project.cloud?.timelineLaneIds?.[clip.track]??null}:null;}
  const clip=(project?.audioClips||[]).find(item=>clipCloudId(item)===id);return clip?{clip,kind:'audio',laneId:clip.laneId??project.cloud?.timelineLaneIds?.[clip.track]??null}:null;
}
export const clipDurationSec=(project,clip)=>Math.max(0,Number(clip?.length)||0)*60/(Number(project?.bpm)||120);
/**
 * Freestyle stores lane gain/plugin automation inside a clip, like the Freestyle Studio's
 * "Automate …" on the selected clip. Prefer the selected clip on this lane, then
 * the earliest clip on it (or a pattern placement playing this lane's source).
 */
export function automationHostCandidates(project,laneId,{strictLane=false}={}) {
  const lane=String(laneId||'');if(!lane)return [];
  // Plugin-parameter envelopes must live on the plugin's own lane (Freestyle 422 target_not_on_lane);
  // a placement of a pattern whose source plays this instrument sits on another lane and is not a host.
  const timeline=project?.cloud?.timelineLaneIds||[],sourcePatterns=new Set((project?.channels||[]).filter(channel=>channel.patternSource&&String(channel.laneId)===lane).map(channel=>channel.patternId));
  const audio=(project?.audioClips||[]).filter(clip=>String(clip.laneId??timeline[clip.track]??'')===lane);
  const patterns=(project?.clips||[]).filter(clip=>String(clip.laneId??clip.cloudRaw?.laneId??timeline[clip.track]??'')===lane||!strictLane&&sourcePatterns.has(clip.patternId));
  return [...audio,...patterns].filter(clip=>clipCloudId(clip)).sort((a,b)=>a.start-b.start||a.track-b.track);
}
export function chooseAutomationHost(project,{laneId,selectedClipId,strictLane=false}={}) {
  const candidates=laneId?automationHostCandidates(project,laneId,{strictLane}):[...(project?.clips||[]),...(project?.audioClips||[])].sort((a,b)=>a.start-b.start);
  return candidates.find(clip=>clip.id===selectedClipId)||candidates[0]||null;
}

/* ---------- store: one optimistic, revision-guarded writer per envelope ---------- */
const listedEnvelopes=data=>data?.envelopes||data?.automation||data?.data||[];
function normalizeEnvelope(raw) {
  if(!record(raw))throw new Error('Freestyle returned no automation envelope.');
  const target=record(raw.target)?copy(raw.target):{kind:raw.targetKind||'clip_gain'};
  const envelope={...copy(raw),target,targetKey:raw.targetKey||automationTargetKey(target),points:Array.isArray(raw.points)?copy(raw.points):[],revision:Number.isInteger(Number(raw.revision))?Number(raw.revision):0,persisted:raw.persisted!==false&&!!raw.id};
  if(!envelope.clipId)throw new Error('Freestyle returned an automation envelope without its clip.');
  return envelope;
}
export class AutomationStore extends EventTarget {
  /** `studio`: the typed /api/studio client (StudioApiClient.call); lane envelopes
   * (createLaneAutomation has no MCP equivalent) are created and re-read through it. */
  constructor({call=defaultCall,getProjectId=()=>null,studio=null}={}){super();this.call=call;this.studio=studio;this.getProjectId=getProjectId;this.items=new Map();this.confirmed=new Map();this.writes=new Map();this.projectId=null;this.generation=0;this.loaded=false;this.loading=null;this.error='';this.truncated=false;}
  emit(detail={}){this.dispatchEvent(new CustomEvent('change',{detail}));}
  /** Route one envelope write: lane creation goes to createLaneAutomation; every other write keeps its declared tool. */
  async writeCall(name,args,options={}){
    if(name!=='create_lane_automation')return this.call(name,args,options);
    if(typeof this.studio?.call!=='function')throw Object.assign(new Error('Lane automation needs the Studio API client.'),{code:'studio_api_feature_unavailable',dispatched:false});
    const {project_id,lane_id,target,startSec,durationSec,points,default_value,value_type}=args;
    try{const result=await this.studio.call('createLaneAutomation',{path:{project_id,lane_id},body:{target,startSec,durationSec,points,defaultValue:default_value,valueType:value_type}},{idempotencyKey:options.idempotencyKey});return result?.data??result;}
    catch(error){const details=error?.data?.error?.details;if(record(details?.envelope))error.envelope=details.envelope;throw error;}
  }
  /** Fresh persisted envelopes of one lane (listLaneAutomation), or null when no typed client is bound. */
  async readLane(laneId){
    if(typeof this.studio?.call!=='function')return null;
    const rows=[];let cursor;
    for(let page=0;page<20;page++){const result=await this.studio.call('listLaneAutomation',{path:{project_id:this.projectId,lane_id:laneId},query:{persisted:true,...cursor?{cursor}:{}}});const data=result?.data??result;rows.push(...(data?.data||[]));cursor=data?.pagination?.hasMore?data.pagination.nextCursor:null;if(!cursor)break;}
    return rows.filter(row=>String(row?.clipId||'')===laneAutomationClipId(laneId));
  }
  /** Rebind to the open project; a different project discards every pending write result. */
  bind(projectId){const id=projectId?String(projectId):null;if(id===this.projectId)return false;this.projectId=id;this.generation++;this.items.clear();this.confirmed.clear();this.writes.clear();this.loaded=false;this.loading=null;this.error='';this.emit({reset:true});return true;}
  assertCurrent(generation,projectId){if(generation!==this.generation||projectId!==this.projectId)throw Object.assign(new Error('The cloud project changed while automation was saving.'),{code:'automation_scope_changed'});}
  list(){return [...this.items.values()];}
  persisted(){return this.list().filter(envelope=>envelope.persisted&&envelope.id&&!envelope.deleted);}
  get(key){return this.items.get(key)||null;}
  find(clipId,targetKey){return this.items.get(`${clipId}|${targetKey}`)||null;}
  busy(key){return !!this.writes.get(key);}
  async load({force=false}={}) {
    const projectId=this.getProjectId()?String(this.getProjectId()):this.projectId;if(!projectId)throw new Error('Open a Freestyle cloud project before editing automation.');
    this.bind(projectId);if(this.loading)return this.loading;if(this.loaded&&!force)return this.list();
    const generation=this.generation;
    const task=(async()=>{
      try{
        const data=unwrap(await this.call('list_automation',{project_id:projectId}));this.assertCurrent(generation,projectId);
        const fresh=new Map();for(const raw of data.envelopes||data.automation||data.data||[]){const envelope=normalizeEnvelope(raw);fresh.set(envelopeKey(envelope),envelope);}
        // A write in flight keeps its optimistic local copy until its own response reconciles it.
        for(const [key,envelope]of fresh){this.confirmed.set(key,envelope);if(!this.writes.has(key))this.items.set(key,envelope);}
        for(const key of [...this.items.keys()])if(!fresh.has(key)&&!this.writes.has(key)){this.items.delete(key);this.confirmed.delete(key);}
        this.truncated=!!data.truncated||data.pagination?.hasMore===true;this.loaded=true;this.error='';this.emit({loaded:true});return this.list();
      }catch(error){if(generation===this.generation){this.error=error.message;this.emit({error});}throw error;}
      finally{if(generation===this.generation)this.loading=null;}
    })();
    this.loading=task;return task;
  }
  /** Re-read one clip's envelopes (after a conflict) without a project refresh. */
  async reloadClip(clipId){
    const projectId=this.projectId,generation=this.generation;
    if(String(clipId).startsWith('lane:')){
      // Lane envelopes are not clip-hosted: re-read the lane, and drop a deleted one.
      const id=String(clipId),rows=await this.readLane(id.slice(5))??(listedEnvelopes(unwrap(await this.call('list_automation',{project_id:projectId})))).filter(row=>String(row?.clipId)===id);this.assertCurrent(generation,projectId);
      const fresh=new Map(rows.map(raw=>{const envelope=normalizeEnvelope(raw);return[envelopeKey(envelope),envelope];}));
      for(const [key,envelope]of fresh){this.confirmed.set(key,envelope);if(!this.writes.has(key))this.items.set(key,envelope);}
      for(const key of [...this.items.keys()])if(key.startsWith(`${id}|`)&&!fresh.has(key)&&!this.writes.has(key)){this.items.delete(key);this.confirmed.delete(key);}
      this.emit({clipId:id});return;
    }
    const data=unwrap(await this.call('list_automation',{project_id:projectId,clip_ids:[String(clipId)]}));this.assertCurrent(generation,projectId);
    for(const raw of data.envelopes||data.data||[]){const envelope=normalizeEnvelope(raw),key=envelopeKey(envelope);this.confirmed.set(key,envelope);if(!this.writes.has(key))this.items.set(key,envelope);}
    this.emit({clipId});
  }
  /** Reuse an existing envelope, otherwise persist a flat default curve. */
  async create({clipId,target,defaultValue=.25,durationSec}) {
    if(!this.loaded)await this.load();
    const targetKey=automationTargetKey(target),key=`${clipId}|${targetKey}`,existing=this.items.get(key);
    if(existing?.persisted&&existing.id)return existing;
    const duration=Math.max(.001,Number(durationSec)||Math.max(0,...(existing?.points||[]).map(point=>Number(point.timeSec)||0))||1),value=clamp(defaultValue,0,1);
    const valueType=Array.isArray(target.options)&&target.options.length?'discrete':'continuous';
    const envelope={clipId:String(clipId),projectId:this.projectId,target:copy(target),targetKey,valueType,defaultValue:value,persisted:false,revision:0,points:existing?.points?.length?existing.points:[{timeSec:0,value,curve:valueType==='continuous'?'linear':'hold',tension:0},{timeSec:duration,value,curve:valueType==='continuous'?'linear':'hold',tension:0}]};
    return this.save(envelope,envelope.points,{accept_existing:true});
  }
  /**
   * FL "Create automation clip" on a lane fader / pan (createLaneAutomation):
   * a flat curve at the control's current value over [startSec, startSec+durationSec].
   * Freestyle keeps one envelope per lane per target; an existing one is
   * returned (marked `existing`) instead of a second create.
   */
  async createLane({laneId,target,defaultValue,startSec=0,durationSec}){
    if(!this.loaded)await this.load();
    if(!isLaneAutomation(target))throw new Error('Lane automation targets lane_volume or lane_pan.');
    const clipId=laneAutomationClipId(laneId),targetKey=automationTargetKey(target),existing=this.items.get(`${clipId}|${targetKey}`);
    if(existing?.persisted&&existing.id)return{...existing,existing:true};
    const duration=Number(durationSec),start=Number(startSec);if(!(duration>0)||!(start>=0))throw new Error('A lane automation clip needs a positive timeline window.');
    const value=clamp(defaultValue??(target.kind==='lane_pan'?.5:.25),0,1),points=[{timeSec:0,value,curve:'linear',tension:0},{timeSec:duration,value,curve:'linear',tension:0}];
    const envelope={clipId,laneId:String(laneId),projectId:this.projectId,target:{kind:target.kind,...target.name?{name:target.name}:{}},targetKey,valueType:'continuous',defaultValue:value,startSec:start,durationSec:duration,persisted:false,revision:0,points};
    return this.save(envelope,points,{accept_existing:true});
  }
  /**
   * Optimistic save: the local curve is shown immediately; writes for one
   * envelope are serialized and coalesced, each carrying the revision returned
   * by the previous response. Nothing is replayed after an unknown outcome.
   */
  save(envelope,points,{accept_existing=false}={}) {
    const key=envelopeKey(envelope),base=this.items.get(key)||normalizeEnvelope({...envelope,projectId:envelope.projectId||this.projectId});
    if(base.pointsTruncated||base.points_truncated)return Promise.reject(new Error('Freestyle returned a partial envelope. Reload all points before editing it.'));
    if(base.uncertain)return Promise.reject(new Error('The previous automation save was not confirmed. Reload the cloud envelope before editing it again.'));
    if(!this.confirmed.has(key))this.confirmed.set(key,base);
    // A lane envelope may move its timeline window with this save (shown at once, sent with the points).
    const span=isLaneAutomation(base)&&Number(envelope.durationSec)>0&&Number(envelope.startSec)>=0?{startSec:Number(envelope.startSec),durationSec:Number(envelope.durationSec)}:{};
    this.items.set(key,{...base,...(envelope.target?{target:copy(envelope.target)}:{}),...span,points:copy(points),saving:true,saveError:'',conflict:false});this.emit({key,optimistic:true});
    let slot=this.writes.get(key);if(!slot){slot={pending:null,promise:null,accept_existing};this.writes.set(key,slot);}
    slot.pending=copy(points);slot.accept_existing||=accept_existing;
    if(!slot.promise)slot.promise=this.drain(key,slot).finally(()=>{if(this.writes.get(key)===slot)this.writes.delete(key);const item=this.items.get(key);if(item?.saving){this.items.set(key,{...item,saving:false});this.emit({key});}});
    return slot.promise;
  }
  async drain(key,slot) {
    const projectId=this.projectId,generation=this.generation;let saved=null;
    while(slot.pending){
      const points=slot.pending;slot.pending=null;const server=this.confirmed.get(key),local=this.items.get(key);
      const windowChange=server.persisted&&isLaneAutomation(server)&&local&&(Number(local.startSec??0)!==Number(server.startSec??0)||Number(local.durationSec)!==Number(server.durationSec))?{startSec:Number(local.startSec??0),durationSec:Number(local.durationSec)}:null;
      const write=automationWrite({...server,target:local?.target||server.target,defaultValue:local?.defaultValue??server.defaultValue,valueType:local?.valueType||server.valueType,...(windowChange?{windowChange}:{})},points,projectId);
      let data;
      try{data=await loggedWrite((...call)=>this.writeCall(...call),write.name,write.arguments);}
      catch(error){
        if(generation!==this.generation)throw error;slot.pending=null;
        if(conflictError(error)){
          const latest=conflictEnvelope(error);
          if(latest){try{const fresh=normalizeEnvelope(latest);this.confirmed.set(key,fresh);if(slot.accept_existing&&(write.name==='create_automation'||write.name==='create_lane_automation')){this.items.set(key,{...fresh,saving:false});this.emit({key});return{...fresh,existing:true};}}catch{}}
          else this.reloadClip(server.clipId).catch(()=>{});
          this.items.set(key,{...this.items.get(key),saving:false,conflict:true,saveError:'Freestyle has a newer revision of this envelope. Save again to replace it, or Reload to discard this edit.'});
        }else this.items.set(key,{...this.items.get(key),saving:false,uncertain:!(error.status>=400&&error.status<500),saveError:error.message});
        this.emit({key,error});throw error;
      }
      this.assertCurrent(generation,projectId);
      saved=normalizeEnvelope({...(data.envelope||data),projectId});this.confirmed.set(key,saved);
      // Keep a newer local edit visible; it is sent next with the returned revision.
      this.items.set(key,slot.pending?{...this.items.get(key),id:saved.id,revision:saved.revision,persisted:saved.persisted}:{...saved,saving:false});
      this.emit({key,saved});
    }
    return saved;
  }
  async remove(envelope) {
    const key=envelopeKey(envelope);await this.writes.get(key)?.promise?.catch(()=>{});
    const server=this.confirmed.get(key)||envelope,projectId=this.projectId,generation=this.generation;
    if(!server.persisted||!server.id)throw new Error('This clip has only Freestyle’s default curve; there is no automation clip to delete.');
    const data=await loggedWrite((...call)=>this.call(...call),'delete_automation',{project_id:projectId,envelope_id:server.id,expected_revision:Number(server.revision)});
    this.assertCurrent(generation,projectId);
    if(data?.deleted===false)throw new Error('Freestyle did not confirm the automation deletion.');
    this.items.delete(key);this.confirmed.delete(key);this.emit({key,deleted:true});return true;
  }
}

/** One-step FL "Create automation clip" for a lane gain or lane plugin parameter. */
export async function createAutomationFromControl({store,project,laneId,target,defaultValue,selectedClipId}) {
  if(!store)throw new Error('Automation is unavailable until the cloud project is open.');
  automationTargetKey(target);
  const strictLane=target?.kind==='plugin_parameter',host=chooseAutomationHost(project,{laneId,selectedClipId,strictLane});
  if(!host)throw new Error(strictLane?'Place a clip on this plugin’s own track first: Freestyle stores plugin automation in a clip on the plugin’s lane.':'Place a clip on this track first: Freestyle stores automation inside a timeline clip.');
  const envelope=await store.create({clipId:automationClipId(host),target,defaultValue,durationSec:clipDurationSec(project,host)});
  return{envelope,host};
}

/* ---------- Playlist: FL-style automation clips on their own tracks ---------- */
const targetName=envelope=>envelope.target?.name||({clip_gain:'Volume',lane_volume:'Volume',lane_pan:'Pan'})[envelope.target?.kind]||envelope.targetKey;
export function automationTrackRows(project,envelopes) {
  const rows=new Map();
  for(const envelope of envelopes){
    const host=automationHostClip(project,envelope.clipId,envelope);if(!host)continue;
    const laneName=(host.kind==='lane'?host.clip.name:null)||project.trackNames?.[host.clip.track]||(project.channels||[]).find(channel=>String(channel.laneId)===String(host.laneId))?.name||`Track ${host.clip.track+1}`;
    const id=`${envelope.targetKey}|${host.laneId??host.clip.track}`;let row=rows.get(id);
    if(!row){row={id,name:`${targetName(envelope)} · ${laneName}`,kind:envelope.target?.kind,order:host.clip.track,items:[]};rows.set(id,row);}
    row.items.push({envelope,host});
  }
  return [...rows.values()].sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name));
}
export function automationCurveSvg(envelope,durationSec) {
  const points=envelope.points||[],duration=Math.max(.001,Number(durationSec)||0,...points.map(point=>Number(point.timeSec)||0));
  const path=Array.from({length:97},(_,i)=>{const time=i/96*duration;return `${i?'L':'M'}${(i/96*100).toFixed(2)},${(100-automationValue(points,time)*100).toFixed(2)}`;}).join(' ');
  return `<svg class="automation-clip-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="automation-clip-fill" d="${path} L100,100 L0,100 Z"/><path class="automation-clip-line" d="${path}" vector-effect="non-scaling-stroke"/></svg>`;
}
/** Append automation tracks after the Playlist's clip tracks. Owns only its container. */
let lastAutomationOpen=-Infinity;
/**
 * FL shows a new automation clip on the first empty Playlist track near its
 * source. `freeRows` (display only, from the host's fixed-row layout) lists
 * empty, lane-less rows as {index, grid, label}; each automation row takes the
 * first free row at or after its source clip's row, else any free row. Rows
 * that find no free row fall back to the appended automation tracks.
 */
export function paintAutomationTracks({host,project,store,selectedKey=null,onOpen=()=>{},onMenu=()=>{},onSelect=()=>{},freeRows=[]}) {
  if(!host)return null;stylesheet();
  host.querySelector(':scope > .automation-tracks')?.remove();
  for(const node of host.querySelectorAll('.automation-inline,.automation-row-tag'))node.remove();
  for(const node of host.querySelectorAll('.automation-host-row'))node.classList.remove('automation-host-row');
  const rows=automationTrackRows(project,store?.persisted()||[]);if(!rows.length)return null;
  const clipHtml=(row,inline)=>row.items.map(({envelope,host:clip})=>{const key=envelopeKey(envelope);return `<div class="automation-clip${inline?' automation-inline':''} ${key===selectedKey?'selected':''} ${envelope.saving?'saving':''} ${envelope.saveError?'save-error':''}" data-envelope-key="${esc(key)}" data-automation-row="${esc(row.id)}" title="${esc(`${row.name} automation · ${envelope.saveError||(envelope.saving?'Saving…':'Double-click to edit points')}`)}" style="left:calc(${clip.clip.start/4} * var(--bar));width:calc(${clip.clip.length/4} * var(--bar))"><div class="automation-clip-title">⌁ ${esc(targetName(envelope))}</div>${automationCurveSvg(envelope,clipDurationSec(project,clip.clip))}</div>`;}).join('');
  const free=[...freeRows].filter(row=>row?.grid).sort((a,b)=>a.index-b.index),overflow=[],placed=[];
  for(const row of rows){
    const source=Math.min(...row.items.map(item=>Number(item.host.clip.track)||0)),at=free.findIndex(item=>item.index>=source),slot=at>=0?free.splice(at,1)[0]:free.shift();
    if(!slot){overflow.push(row);continue;}
    slot.grid.insertAdjacentHTML('beforeend',clipHtml(row,true));slot.grid.closest('.track-lane')?.classList.add('automation-host-row');
    if(slot.label){const tag=document.createElement('span');tag.className='automation-row-tag';tag.title=row.name;tag.innerHTML=`<span class="automation-track-icon">⌁</span>${esc(row.name)}`;slot.label.append(tag);}
    placed.push({row:row.id,index:slot.index});
  }
  let container=null;
  if(overflow.length){container=document.createElement('div');container.className='automation-tracks';
  container.innerHTML=overflow.map(row=>`<div class="automation-track" data-automation-row="${esc(row.id)}"><div class="track-label automation-track-label" title="${esc(row.name)}"><span class="automation-track-icon">⌁</span>${esc(row.name)}</div><div class="automation-lane-grid">${clipHtml(row,false)}</div></div>`).join('');
  host.append(container);}
  for(const element of host.querySelectorAll('.automation-clip')){
    const envelope=()=>store.get(element.dataset.envelopeKey);
    // FL: double-click an automation clip opens its point editor. Selecting repaints the
    // Playlist, so an already-selected clip is not repainted (the second click must land
    // on the same node for the browser to deliver dblclick), and a click-count-2
    // mousedown opens it too in case a store change repainted between the clicks.
    const open=event=>{event.preventDefault();event.stopPropagation();const at=event.timeStamp||0;if(at-lastAutomationOpen<400&&at>=lastAutomationOpen)return;lastAutomationOpen=at;const item=envelope();if(item)onOpen(item);};
    element.onpointerdown=event=>{if(event.button===0){event.stopPropagation();if(element.dataset.envelopeKey!==selectedKey)onSelect(element.dataset.envelopeKey);}};
    element.onmousedown=event=>{if(event.button===0){event.stopPropagation();if(event.detail>=2)open(event);}};
    element.onclick=event=>event.stopPropagation();
    element.ondblclick=open;
    element.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();const item=envelope();if(item)onMenu(event,item);};
  }
  return{container,placed,overflow:overflow.map(row=>row.id)};
}

/* ---------- point editor ---------- */
/** cloudCall(name, arguments, options) may return a raw MCP result or already-unwrapped JSON. */
export async function openAutomationEditor({project,cloudCall=defaultCall,onChanged=()=>{},clipId,envelopeKey:preferredKey,store,remove:removeEnvelope=null}={}) {
  const projectId=project?.cloud?.projectId||project?.id;if(!projectId)throw new Error('Open a Freestyle cloud project before editing automation.');
  stylesheet();
  store||=new AutomationStore({call:cloudCall,getProjectId:()=>projectId});
  const dialog=document.createElement('dialog');dialog.className='vegetable-automation';
  dialog.innerHTML=`<header><span class="automation-icon">⌁</span><strong>Automation clip</strong><span class="automation-cloud">FREESTYLE ENGINE</span><button class="automation-close" aria-label="Close automation editor">×</button></header><div class="automation-body"><div class="automation-top"><label>Clip / parameter<select class="automation-select" aria-label="Automation clip and parameter"></select></label><label>Snap<select class="automation-snap"><option value=".25">¼ beat</option><option value="1">1 beat</option><option value="0">Off</option></select></label><button class="automation-reload" title="Read the current cloud revision">↻ Reload</button></div><div class="automation-detail"></div><div class="automation-graph-wrap"><svg class="automation-graph" viewBox="0 0 800 270" role="img" aria-label="Editable automation envelope. Click to add points, drag to move, right-click or Delete to remove." tabindex="0"></svg></div><div class="automation-point"><label>Time <input class="automation-time" type="number" min="0" step="0.001"> s</label><label>Value <input class="automation-value" type="number" min="0" max="1" step="0.001"></label><label>Curve <select class="automation-curve"><option>linear</option><option>hold</option><option>bezier</option><option value="db">dB (gain)</option></select></label><label>Tension <input class="automation-tension" type="range" min="-1" max="1" step="0.01"></label><button class="automation-remove">Remove point</button></div><div class="automation-presets"><span>PRESETS</span><button data-preset="unity">Unity</button><button data-preset="fade-in">Fade in</button><button data-preset="fade-out">Fade out</button><button data-preset="duck">Duck</button></div><p class="automation-status" role="status">Reading cloud automation…</p><footer><label class="automation-autosave"><input type="checkbox" checked> Save each edit</label><span>Point times are relative to this clip.</span><button class="automation-delete" title="Delete this automation clip from Freestyle">Delete automation clip</button><button class="automation-save primary">Save envelope</button></footer></div>`;
  document.body.append(dialog);dialog.showModal();
  const $=selector=>dialog.querySelector(selector),graph=$('.automation-graph'),select=$('.automation-select'),status=$('.automation-status');
  let envelopes=[],current=null,points=[],selected=0,duration=4,dirty=false,busy=false,closed=false,loadGeneration=0,saveGeneration=0;
  const gain=()=>current?.target?.kind==='clip_gain'||current?.target?.kind==='lane_volume',pan=()=>current?.target?.kind==='lane_pan';
  const formatValue=value=>pan()?(Math.abs(value-.5)<.0005?'Centered':`${Math.round(Math.abs(value*2-1)*100)}% ${value<.5?'left':'right'}`):gain()?value<=0?'−∞ dB':`${(20*Math.log10(value*4)).toFixed(1)} dB`:`${(value*100).toFixed(1)}%`;
  const clipName=id=>{
    if(id.startsWith('lane:')){const host=automationHostClip(project,id,store.list().find(item=>item.clipId===id));return `Track ${host?.clip?.name||id.slice(5,13)}`;}
    if(id.startsWith('pattern:')){const raw=id.slice(8),clip=project.clips?.find(clip=>String(clip.cloudId||clip.id)===raw),pattern=project.patterns?.find(pattern=>pattern.id===clip?.patternId);return pattern?.name||clip?.name||`Pattern placement ${raw.slice(0,8)}`;}
    const clip=project.audioClips?.find(clip=>String(clip.cloudId||clip.id)===id)||project.cloud?.rawProject?.clips?.find(clip=>String(clip.id)===id);
    return clip?.name||clip?.title||(id.startsWith('backing:')?'Backing track':`Audio clip ${id.slice(0,8)}`);
  };
  const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
  const autosave=()=>$('.automation-autosave input').checked;
  function choose(envelope){
    current=copy(envelope);const host=automationHostClip(project,envelope.clipId,envelope);
    duration=Math.max(.05,host?clipDurationSec(project,host.clip):0,...(envelope.points||[]).map(point=>Number(point.timeSec)||0));
    points=normalizeAutomationPoints(envelope.points||[],duration);if(!points.length)points=[{timeSec:0,value:Number(envelope.defaultValue??.25),curve:'linear',tension:0},{timeSec:duration,value:Number(envelope.defaultValue??.25),curve:'linear',tension:0}];selected=0;dirty=false;
    if(envelope.saveError)message(envelope.saveError,true);else message(envelope.persisted?'Saved automation clip.':'Freestyle default curve. Edit it to create an automation clip.');
    render();
  }
  function render(){
    const disabled=busy||!current||current.pointsTruncated;
    select.disabled=busy;$('.automation-reload').disabled=busy;
    for(const input of dialog.querySelectorAll('.automation-point input,.automation-point select,.automation-presets button,.automation-save,.automation-remove'))input.disabled=disabled;
    $('.automation-delete').disabled=busy||!current?.persisted||!current?.id;
    $('.automation-save').textContent=busy?'Saving…':'Save envelope';graph.classList.toggle('disabled',!!disabled);
    if(!current){graph.innerHTML='';return;}
    $('.automation-detail').textContent=`${current.target?.name||'Volume'} · ${duration.toFixed(3)} s · ${points.length} point${points.length===1?'':'s'} · ${current.persisted?`Saved revision ${current.revision}`:'Default curve'}`;
    const x=time=>50+time/duration*730,y=value=>20+(1-value)*220;
    let content='';
    for(let step=0;step<=8;step++){const time=duration*step/8;content+=`<line x1="${x(time)}" y1="20" x2="${x(time)}" y2="240" class="automation-grid"/><text x="${x(time)}" y="258" text-anchor="middle">${time.toFixed(time<10?2:1)}s</text>`;}
    for(const value of [0,.25,.5,.75,1])content+=`<line x1="50" y1="${y(value)}" x2="780" y2="${y(value)}" class="${gain()&&value===.25?'automation-unity':'automation-grid'}"/><text x="43" y="${y(value)+4}" text-anchor="end">${gain()?value===0?'−∞':`${Math.round(20*Math.log10(value*4))}dB`:`${Math.round(value*100)}%`}</text>`;
    const path=Array.from({length:257},(_,i)=>{const time=i/256*duration;return `${i?'L':'M'}${x(time).toFixed(2)},${y(automationValue(points,time)).toFixed(2)}`;}).join(' ');
    content+=`<path class="automation-fill" d="${path} L780,240 L50,240 Z"/><path class="automation-line" d="${path}"/>`;
    points.forEach((point,index)=>content+=`<circle data-point="${index}" class="automation-node ${index===selected?'selected':''}" cx="${x(point.timeSec)}" cy="${y(point.value)}" r="${index===selected?5.5:4.5}"><title>${point.timeSec.toFixed(3)}s · ${esc(formatValue(point.value))}</title></circle>`);
    graph.innerHTML=content;
    const point=points[selected];if(point){$('.automation-time').value=point.timeSec.toFixed(3);$('.automation-time').max=duration;$('.automation-value').value=point.value.toFixed(3);$('.automation-curve').value=point.curve;$('.automation-tension').value=point.tension||0;$('.automation-tension').disabled=disabled||point.curve!=='bezier';}
  }
  function fillSelect(preferred){
    envelopes=store.list().filter(envelope=>!envelope.deleted);
    select.innerHTML=envelopes.map((envelope,index)=>`<option value="${index}">${esc(clipName(envelope.clipId))} — ${esc(envelope.target?.name||envelope.targetKey||'Volume')}${envelope.persisted?' ⌁':''}</option>`).join('');
    const requested=clipId?String(clipId):'';
    let index=envelopes.findIndex(envelope=>envelopeKey(envelope)===preferred);if(index<0&&requested)index=envelopes.findIndex(envelope=>envelope.clipId===requested||envelope.clipId===`pattern:${requested}`);if(index<0)index=0;
    if(envelopes.length){select.value=String(index);choose(envelopes[index]);}else{current=null;render();message('This cloud project has no audio clips or pattern placements. Place a pattern or import audio first.');}
  }
  async function reload(preferred,{force=true}={}){
    const generation=++loadGeneration;busy=true;render();message('Reading cloud automation…');
    try{await store.load({force});if(closed||generation!==loadGeneration)return;busy=false;fillSelect(preferred||(current&&envelopeKey(current)));if(store.truncated)message('Freestyle returned a limited set of envelopes. Select a listed clip to edit it.');}
    catch(error){if(generation!==loadGeneration)return;busy=false;render();message(error.message,true);}
  }
  /** Revision-guarded save reconciled from the response; no project refresh. */
  async function save(){
    if(!current||current.pointsTruncated)return;const generation=++saveGeneration,clean=normalizeAutomationPoints(points,duration),key=envelopeKey(current);
    message('Saving envelope in Freestyle…');
    try{const saved=await store.save(current,clean);if(closed)return;if(saved&&generation===saveGeneration&&envelopeKey(current)===key){current={...current,...saved};dirty=false;render();message('Envelope saved in Freestyle.');}fillSelectKeep(key);await onChanged(saved);}
    catch(error){if(closed||!current||envelopeKey(current)!==key)return;const item=store.get(key);if(item?.uncertain)$('.automation-autosave input').checked=false;render();message(item?.saveError||error.message,true);}
  }
  const fillSelectKeep=key=>{const index=store.list().filter(envelope=>!envelope.deleted).findIndex(envelope=>envelopeKey(envelope)===key);envelopes=store.list().filter(envelope=>!envelope.deleted);select.innerHTML=envelopes.map((envelope,i)=>`<option value="${i}">${esc(clipName(envelope.clipId))} — ${esc(envelope.target?.name||envelope.targetKey||'Volume')}${envelope.persisted?' ⌁':''}</option>`).join('');if(index>=0)select.value=String(index);};
  const markDirty=()=>{dirty=true;render();if(autosave())save();else message('Unsaved envelope changes');};
  select.onchange=()=>{choose(envelopes[Number(select.value)]);};
  $('.automation-reload').onclick=()=>reload();
  const fromPointer=event=>{const rect=graph.getBoundingClientRect(),svgX=(event.clientX-rect.left)/rect.width*800,svgY=(event.clientY-rect.top)/rect.height*270;let time=clamp((svgX-50)/730,0,1)*duration;const snap=Number($('.automation-snap').value)*60/(Number(project.bpm)||120);if(snap>0)time=Math.round(time/snap)*snap;return{timeSec:clamp(time,0,duration),value:clamp(1-(svgY-20)/220,0,1)};};
  graph.onpointerdown=event=>{
    if(event.button!==0||busy||!current||current.pointsTruncated)return;event.preventDefault();graph.focus?.();
    const node=event.target.closest('[data-point]');let changed=false;
    if(node)selected=Number(node.dataset.point);else{const position=fromPointer(event);points.push({...position,curve:'linear',tension:0});selected=points.length-1;changed=true;}
    graph.setPointerCapture?.(event.pointerId);render();
    graph.onpointermove=move=>{const position=fromPointer(move);points[selected]={...points[selected],...position};changed=true;message(`${position.timeSec.toFixed(3)} s · ${formatValue(position.value)}`);render();};
    graph.onpointerup=graph.onpointercancel=()=>{graph.onpointermove=null;graph.onpointerup=graph.onpointercancel=null;const chosen=points[selected];points=normalizeAutomationPoints(points,duration);selected=Math.max(0,points.findIndex(point=>Math.abs(point.timeSec-chosen.timeSec)<.00001));if(changed)markDirty();else render();};
  };
  const remove=()=>{if(points.length<=2){message('Keep at least two points in the envelope.');return;}points.splice(selected,1);selected=Math.min(selected,points.length-1);markDirty();};
  graph.oncontextmenu=event=>{event.preventDefault();const node=event.target.closest('[data-point]');if(node&&!busy){selected=Number(node.dataset.point);remove();}};
  graph.onkeydown=event=>{if((event.key==='Delete'||event.key==='Backspace')&&current&&!busy){event.preventDefault();event.stopPropagation();remove();}};
  $('.automation-remove').onclick=remove;
  for(const [selector,field]of [['.automation-time','timeSec'],['.automation-value','value'],['.automation-curve','curve'],['.automation-tension','tension']])$(selector).onchange=event=>{if(!points[selected])return;points[selected][field]=field==='curve'?event.target.value:Number(event.target.value);const chosen=points[selected];points=normalizeAutomationPoints(points,duration);selected=Math.max(0,points.findIndex(point=>point.timeSec===clamp(chosen.timeSec,0,duration)));markDirty();};
  for(const button of dialog.querySelectorAll('[data-preset]'))button.onclick=()=>{
    const base=gain() ? .25 : pan() ? .5 : Number(current.defaultValue??.5),point=(timeSec,value)=>({timeSec,value,curve:'linear',tension:0});
    const fade=Math.min(duration/2,60/(project.bpm||120));
    points=button.dataset.preset==='fade-in'?[point(0,0),point(fade,base),point(duration,base)]:button.dataset.preset==='fade-out'?[point(0,base),point(duration-fade,base),point(duration,0)]:button.dataset.preset==='duck'?[point(0,base*.15),point(Math.min(duration,.25*60/(project.bpm||120)),base*.15),point(Math.min(duration,60/(project.bpm||120)),base),point(duration,base)]:[point(0,base),point(duration,base)];
    points=normalizeAutomationPoints(points,duration);selected=0;markDirty();
  };
  $('.automation-save').onclick=()=>save();
  $('.automation-delete').onclick=async()=>{
    if(!current?.persisted||busy)return;
    // FL: a journaled delete is one Undo step, so it needs no confirmation.
    if(!removeEnvelope&&typeof globalThis.confirm==='function'&&globalThis.confirm('Delete this automation clip from Freestyle?')===false)return;
    busy=true;render();message('Deleting automation clip…');const key=envelopeKey(current);
    try{await (removeEnvelope?removeEnvelope(current):store.remove(current));if(closed)return;busy=false;await onChanged(null);message('Automation clip deleted.');await reload(key,{force:false});}
    catch(error){busy=false;render();message(error.message,true);}
  };
  $('.automation-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{closed=true;loadGeneration++;dialog.remove();},{once:true});
  dialog.store=store;
  await reload(preferredKey,{force:!store.loaded});return dialog;
}
