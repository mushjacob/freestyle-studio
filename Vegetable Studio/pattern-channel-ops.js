/** FL Channel Rack channel edits over the 338 per-channel routes:
 * addPatternChannel (positional insert), updatePatternChannel (color, icon,
 * cutGroup, midiChannel, outputLaneId, name, … and/or position),
 * deletePatternChannel and assignPatternChannelToNewTrack
 * (:assignToNewInstrumentTrack). Every change is one guarded write with
 * If-Match = the timeline revision and one external step in the global ordered
 * history; Undo/Redo send the receipt's `undo` back.
 *
 * 339: each `undo` carries a request descriptor {method, path, body} (assign:
 * `steps`, two of them) that is sent as is (descriptorRequest maps it onto the
 * generated operation; live 2026-11-11 on an owned fixture). Older replies
 * (328/338: `op` + top-level fields, verbatim post = 400 "Unknown field: op")
 * still work through channelUndoBody, which strips the descriptor fields. */
import {StudioApiClient,STUDIO_API_OPERATIONS} from './studio-api-client.js';
import {adoptStudioWrite} from './studio-api-bridge.js';
import {hostFetch} from './freestyle-host-transport.js';

export const CHANNEL_OPERATIONS=Object.freeze(['addPatternChannel','updatePatternChannel','deletePatternChannel','assignPatternChannelToNewTrack']);
const clone=value=>value==null?value:structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128;
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const uid=()=>globalThis.crypto?.randomUUID?.()||`channel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fail=(message,fields={})=>Object.assign(new Error(message),{code:'pattern_channel_conflict',...fields});
// Not applied (nothing written): the external history step stays available.
const notApplied=(message,fields={})=>fail(message,{dispatched:false,historyNotApplied:true,operationUncertain:false,...fields});
const REJECTED=new Set([400,403,404,409,412,422,428]);

/** The generated contract has every per-channel route this module uses. */
export function patternChannelOpsSupported(operations=STUDIO_API_OPERATIONS){return CHANNEL_OPERATIONS.every(name=>operations?.[name]?.mutates===true);}

/** Documented channel colour, restricted to hex for safe CSS use (null = none). */
export function channelColor(value){return typeof value==='string'&&/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)?value.toLowerCase():null;}
/** Documented icon name (`^[a-z0-9][a-z0-9_-]{0,31}$`), or null. */
export function channelIcon(value){return typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)?value:null;}
/** FL-style channel icons (the name is what Freestyle stores; the glyph is ours). */
export const CHANNEL_ICONS=Object.freeze([
 {id:'kick',label:'Kick',glyph:'●'},{id:'snare',label:'Snare',glyph:'◎'},{id:'clap',label:'Clap',glyph:'✋'},{id:'hat',label:'Hi-hat',glyph:'△'},{id:'perc',label:'Percussion',glyph:'◆'},
 {id:'bass',label:'Bass',glyph:'♭'},{id:'keys',label:'Keys',glyph:'▥'},{id:'synth',label:'Synth',glyph:'∿'},{id:'guitar',label:'Guitar',glyph:'♪'},{id:'vocal',label:'Vocal',glyph:'♫'},{id:'fx',label:'FX',glyph:'✦'},{id:'loop',label:'Loop',glyph:'↻'}]);
export const channelIconGlyph=value=>CHANNEL_ICONS.find(icon=>icon.id===value)?.glyph??(channelIcon(value)?'■':'');
/** FL channel colour presets (Random color picks one, never the current one). */
export const CHANNEL_PALETTE=Object.freeze(['#5f8dc4','#78a85a','#c99a3f','#b85a5a','#9a6cc0','#4fa3a0','#c06c9a','#8a8f99','#d0794a','#5a6fc0','#a3b84f','#c45f7d']);
export function randomChannelColor(current,random=Math.random){const choices=CHANNEL_PALETTE.filter(color=>color!==channelColor(current));return choices[Math.min(choices.length-1,Math.floor(random()*choices.length))];}
/** FL "Cut itself": the lowest cut group no other channel of this pattern uses. */
export function freeCutGroup(sources,channelId){const used=new Set((sources||[]).filter(source=>source?.id!==channelId).map(source=>source?.cutGroup).filter(value=>Number.isInteger(value)&&value>0));for(let group=1;group<=64;group++)if(!used.has(group))return group;return null;}

/** FL Move up/down: the channel's new 0-based `position` (its final row), or null at the first/last row or for an unknown id. `direction` is 'up'|'down' (or -1|1). Same indexing as Insert above/below. */
export function moveChannelPosition(channels,channelId,direction){
 const list=Array.isArray(channels)?channels:[],index=list.findIndex(channel=>channel?.id===channelId),step=direction==='up'||direction===-1?-1:direction==='down'||direction===1?1:0;
 if(index<0||!step)return null;const next=index+step;return next<0||next>=list.length?null:next;
}
/** FL pattern length in steps: {bars, lengthTicks} with lengthTicks = steps * ppq / 4 and bars = ceil(lengthTicks / (ppq * 4)) (the write rejects any other pair). Null for a non-whole step count, a ppq that makes a step fractional, or a length outside 1..64 bars. */
export function patternLengthFromSteps(steps,ppq=96){
 if(!Number.isInteger(steps)||steps<1||!Number.isFinite(ppq)||ppq<=0)return null;
 const lengthTicks=steps*ppq/4;if(!Number.isInteger(lengthTicks))return null;
 const bars=Math.ceil(lengthTicks/(ppq*4)-1e-9);return bars<1||bars>64?null:{bars,lengthTicks};
}

const DESCRIPTOR_OPERATIONS=Object.freeze(['updatePatternChannel','addPatternChannel','deletePatternChannel','deleteLane']);
/** A 339 undo descriptor {method, path (relative to /api/v1), body} as one
 * typed request {operationId, path params, body}, or null when it carries no
 * descriptor. Only the four channel/lane routes are accepted, and only for
 * this project; anything else is refused (never guessed). */
export function descriptorRequest(descriptor,{projectId,operations=STUDIO_API_OPERATIONS}={}){
 if(!record(descriptor)||typeof descriptor.method!=='string'||typeof descriptor.path!=='string')return null;
 const method=descriptor.method.toUpperCase(),segments=descriptor.path.replace(/^\/api\/v1/,'').split('/');
 for(const operationId of DESCRIPTOR_OPERATIONS){
  const operation=operations?.[operationId];if(!operation||operation.method!==method)continue;
  const template=operation.path.split('/');if(template.length!==segments.length)continue;const params={};let match=true;
  for(let index=0;index<template.length&&match;index++){const part=template[index],named=/^\{(\w+)\}(.*)$/.exec(part);
   if(!named){match=part===segments[index];continue;}
   const suffix=named[2];if(suffix&&!segments[index].endsWith(suffix)){match=false;continue;}let value=suffix?segments[index].slice(0,-suffix.length):segments[index];try{value=decodeURIComponent(value);}catch{match=false;continue;}if(!value){match=false;continue;}params[named[1]]=value;}
  if(!match)continue;
  if(params.project_id!==projectId)throw fail('The undo request names another project. It was not sent.',{operationUncertain:true});
  const {project_id:_,...path}=params;return{operationId,path,body:record(descriptor.body)?clone(descriptor.body):{}};
 }
 throw fail(`Freestyle returned an undo request (${method} ${descriptor.path}) outside the Channel Rack routes. It was not sent.`,{operationUncertain:true});
}
/** The request body an older (pre-339) `undo` stands for (see the module note). */
export function channelUndoBody(undo,expected){
 if(!record(undo))throw fail('Freestyle returned no channel undo for this change.',{operationUncertain:true});
 if(expected&&undo.op!==undefined&&undo.op!==expected)throw fail(`Freestyle returned a ${undo.op} undo where ${expected} was expected.`,{operationUncertain:true});
 if(undo.op==='update'||expected==='update'){if(!record(undo.channel))throw fail('The channel undo has no before-values.',{operationUncertain:true});return{channel:clone(undo.channel),...Number.isSafeInteger(undo.position)?{position:undo.position}:{}};}
 if(undo.op==='add'||expected==='add'){if(!record(undo.channel)||!id(undo.channel.id))throw fail('The channel undo cannot bring the channel back exactly.',{operationUncertain:true});return{channel:clone(undo.channel),...Number.isSafeInteger(undo.position)?{position:undo.position}:{},...Array.isArray(undo.events)?{events:clone(undo.events)}:{},...Array.isArray(undo.ccEvents)?{ccEvents:clone(undo.ccEvents)}:{}};}
 if(undo.op==='unassign'||expected==='unassign'){if(!id(undo.channelId)||!id(undo.deleteLaneId))throw fail('The track assignment has no complete undo.',{operationUncertain:true});return{channelId:undo.channelId,outputLaneId:undo.outputLaneId??null,deleteLaneId:undo.deleteLaneId};}
 if(undo.op==='delete'||expected==='delete')return{};
 throw fail('Unknown channel undo.',{operationUncertain:true});
}

/** Low-res peaks (getPatternSampleWaveform) as a mirrored SVG area path. */
export function sampleWaveformPath(waveform,{width=100,height=24}={}){
 const peaks=Array.isArray(waveform?.peaks)?waveform.peaks.filter(value=>typeof value==='number'&&Number.isFinite(value)).map(value=>Math.max(0,Math.min(1,value))):[];
 if(peaks.length<2)return'';const mid=height/2,step=width/(peaks.length-1),fmt=value=>Math.round(value*100)/100;
 const top=peaks.map((peak,index)=>`${fmt(index*step)},${fmt(mid-peak*mid)}`),bottom=peaks.map((peak,index)=>`${fmt(index*step)},${fmt(mid+peak*mid)}`).reverse();
 return`M${top.join('L')}L${bottom.join('L')}Z`;
}
export function sampleWaveformSvg(waveform,{width=100,height=24,className='sample-waveform'}={}){
 const path=sampleWaveformPath(waveform,{width,height});if(!path)return'';
 return`<svg class="${className}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"></path></svg>`;
}

/** Sample peaks per audio file, read once per session. After revalidate() a
 * known entry is re-read conditionally (If-None-Match = its ETag; the 8081
 * proxy forwards it for this ETag-declaring GET) and a 304 keeps the peaks.
 * Since 339 an older sample without stored peaks is decoded on demand
 * (source:'computed', first read up to ~2 s live; later reads 'stored'), so a
 * failed read is only remembered for `missTtlMs` (a repaint never refetches
 * in a loop, and a later repaint tries again). getPatternSampleWaveform stays
 * the route: normalized, ETag-cached and persisted, unlike the engine action
 * engine_get_pattern_sample_peaks (an uncached POST, raw amplitudes). */
export class SampleWaveformCache{
 constructor({client=new StudioApiClient(),conditionalClient=etag=>new StudioApiClient({fetch:(url,init={})=>hostFetch(url,{...init,headers:{...init.headers,'If-None-Match':etag}})}),buckets=128,missTtlMs=30000,now=()=>Date.now()}={}){Object.assign(this,{client,conditionalClient,buckets,missTtlMs,now});this.entries=new Map();}
 key(projectId,audioFileId){return projectId+'\u0000'+audioFileId;}
 peek(projectId,audioFileId){const value=this.entries.get(this.key(projectId,audioFileId))?.value??null;return value?.unavailable&&this.now()-value.at>=this.missTtlMs?null:value;}
 /** Mark every entry for a conditional re-read (e.g. after a project reload). */
 revalidate(){for(const entry of this.entries.values())entry.stale=true;}
 async get(projectId,audioFileId){
  if(!id(projectId)||!id(audioFileId))return null;const key=this.key(projectId,audioFileId),cached=this.entries.get(key);
  if(cached&&!cached.stale&&!(cached.value?.unavailable&&this.now()-cached.value.at>=this.missTtlMs))return cached.promise;
  const previous=cached?.value&&!cached.value.unavailable&&cached.value.etag?cached.value:null,entry={value:previous,stale:false,promise:null};
  const client=previous?this.conditionalClient(previous.etag):this.client,params={path:{project_id:projectId,audio_file_id:audioFileId},query:{buckets:this.buckets}};
  entry.promise=client.call('getPatternSampleWaveform',params).then(result=>{
   if(result?.status===304&&previous){entry.value={...previous,revalidated:true};return entry.value;}
   const data=result?.data;if(!record(data)||data.audioFileId!==audioFileId||!Array.isArray(data.peaks)||data.peaks.length!==data.bucketCount)throw fail('Freestyle returned an invalid sample waveform.');
   entry.value={audioFileId,durationSec:data.durationSec,peaks:data.peaks.slice(),source:data.source??null,etag:result.etag??null};return entry.value;
  }).catch(error=>{
   if(previous&&error?.status!==404){entry.value=previous;return previous;}
   entry.value={audioFileId,unavailable:true,code:error?.code??(error?.status===404?'waveform_unavailable':'waveform_read_failed'),transient:error?.status!==404,at:this.now()};return entry.value;});
  this.entries.set(key,entry);return entry.promise;
 }
 clear(){this.entries.clear();}
}

/** One saved per-channel change = one external history step. */
export class PatternChannelOps{
 /**
  * @param client StudioApiClient
  * @param getScope () => {projectId,...} identity of the open project/session
  * @param read async () => void: canonical re-read adopted by the engine/UI
  * @param revision () => current saved timelineRevision (after read)
  * @param savedSources (patternId) => saved sources[] of that pattern, or null
  * @param history engine.patternHistory (beginExternalStep/finishExternalStep/failExternalStep)
  * @param flush async () => void: queued local edits saved before this step
  */
 constructor({client=new StudioApiClient(),getScope,read,adopt=null,revision,savedSources,history,flush=async()=>{},onChange=()=>{}}={}){
  Object.assign(this,{client,getScope,read,adopt,revision,savedSources,history,flush,onChange});this.busy=false;this.last=null;this.receipts=[];
 }
 assertScope(scope){if(JSON.stringify(scope)!==JSON.stringify(this.getScope()))throw Object.assign(new Error('The project changed during this Channel Rack edit.'),{name:'AbortError',code:'pattern_channel_scope_changed'});}
 channel(patternId,channelId){const sources=this.savedSources(patternId);if(!Array.isArray(sources))throw notApplied('Reload the saved pattern before editing its channels.');return sources.find(source=>source?.id===channelId)??null;}
 position(patternId,channelId){const sources=this.savedSources(patternId)||[];return sources.findIndex(source=>source?.id===channelId);}
 /** One guarded write. A refusal (4xx: nothing written) is not uncertain. */
 async send(operationId,path,body,scope,{revision:known}={}){
  const revision=known??this.revision();if(typeof revision!=='string'||!revision)throw notApplied('Read a fresh saved timeline revision before editing this channel.');
  try{
   const result=await this.client.call(operationId,{path:{project_id:scope.projectId,...path},body},{idempotencyKey:uid(),ifMatch:JSON.stringify(revision)});
   let data=result?.data;if(record(data?.response)&&data.tool!==undefined)data={...data.response,timelineRevision:data.timelineRevision??data.response.timelineRevision};
   if(!record(data)||data.ok===false)throw fail('Freestyle did not acknowledge this channel change.',{operationUncertain:true});
   this.receipts.push({operationId,data});
   // The bridge's cached tag follows this write (QA round 19: stale-tag 412s on the next /api/call write).
   const returned=typeof result?.etag==='string'&&result.etag?result.etag:typeof data.timelineRevision==='string'&&data.timelineRevision?JSON.stringify(data.timelineRevision):null;if(returned)adoptStudioWrite(scope.projectId,{base:JSON.stringify(revision),etag:returned});
   return data;
  }catch(error){if(REJECTED.has(Number(error?.status))&&error?.operationUncertain!==true)Object.assign(error,{historyNotApplied:true,dispatched:false,operationUncertain:false});throw error;}
 }
 /** Run a guarded write against the cached saved state; a 412 (the timeline
  * moved, nothing applied) re-reads once and runs the guard + write again. */
 /** After a step's writes: adopt the last receipt's saved pattern row when every
  * write of the step was a pattern-only channel write; otherwise one read. */
 async settle(){
  const receipts=this.receipts;this.receipts=[];const last=receipts.at(-1);
  if(typeof this.adopt==='function'&&receipts.length&&receipts.every(item=>['updatePatternChannel','addPatternChannel','deletePatternChannel'].includes(item.operationId))&&this.adopt(last.data)===true)return'adopted';
  await this.read();return'read';
 }
 async guarded412(scope,run){
  try{return await run();}
  catch(error){if(Number(error?.status)!==412)throw error;await this.read();this.assertScope(scope);return run();}
 }
 async step({label,detail,forward,undo,redo}){
  if(this.busy)throw notApplied('Wait for the current Channel Rack edit to finish saving.');
  this.busy=true;let token=null;
  try{
   // The flushed session state is current: its timeline revision guards the
   // write (If-Match). Only a 412 (nothing applied) costs a read and one resend.
   await this.flush();const scope=this.getScope();
   token=this.history.beginExternalStep({kind:'rack_channel',label});
   this.receipts=[];const state=await this.guarded412(scope,()=>forward(scope));this.assertScope(scope);
   if(state?.unchanged){this.history.failExternalStep(token,{operationUncertain:false});token=null;return state;}
   await this.settle();this.assertScope(scope);
   const guarded=direction=>async()=>{const now=this.getScope();this.receipts=[];const result=await this.guarded412(now,()=>(direction==='undo'?undo:redo)(state,now));await this.settle();return result;};
   this.history.finishExternalStep(token,{detail:detail?.(state)??null,undo:guarded('undo'),redo:guarded('redo')});token=null;
   this.last={label,status:'saved'};this.onChange(this.last);return state;
  }catch(error){if(token)this.history.failExternalStep(token,error);if(token)try{await this.read();}catch{}this.last={label,status:'failed',error:error.message};this.onChange(this.last);throw error;}
  finally{this.busy=false;}
 }

 /** The typed request an `undo` stands for: its 339 descriptor as is, or the
  * older shape rebuilt for `fallback` {operationId, path}. The descriptor must
  * target the expected operation and channel. */
 undoRequest(undo,expected,fallback,scope){
  const described=descriptorRequest(undo,{projectId:scope.projectId});
  if(described){
   if(described.operationId!==fallback.operationId||Object.entries(fallback.path).some(([key,value])=>described.path[key]!==value))throw fail('Freestyle returned an undo for a different channel. It was not sent.',{operationUncertain:true});
   return described;
  }
  return{...clone(fallback),body:channelUndoBody(undo,expected)};
 }
 sendRequest(request,scope,options){return this.send(request.operationId,request.path,request.body,scope,options);}

 /** Merge fields into one channel (and/or move it). Undo PATCHes the before-values back. */
 update(patternId,channelId,fields,{label='Channel settings',position}={}){
  if(!id(patternId)||!id(channelId)||!record(fields))throw fail('Choose one saved channel to edit.');
  const body={channel:clone(fields),...Number.isSafeInteger(position)?{position}:{}},keys=Object.keys(fields),target={operationId:'updatePatternChannel',path:{pattern_id:patternId,channel_id:channelId}};
  const values=source=>Object.fromEntries(keys.map(key=>[key,source?.[key]??null]));
  return this.step({label,detail:state=>({patternId,channelId,fields:keys}),
   forward:async scope=>{
    const current=this.channel(patternId,channelId);if(!current)throw notApplied('That channel is no longer in the saved pattern.');
    if(same(values(current),values(fields))&&(position===undefined||this.position(patternId,channelId)===position))return{unchanged:true};
    const data=await this.sendRequest({...target,body},scope);
    return{patternId,channelId,after:values(data.channel??fields),undoRequest:this.undoRequest(data.undo,'update',target,scope),redoRequest:{...target,body}};
   },
   undo:async(state,scope)=>{const current=this.channel(patternId,channelId);if(!current||!same(values(current),state.after))throw notApplied(`${label} was not undone: the channel changed elsewhere.`);const data=await this.sendRequest(state.undoRequest,scope);state.redoRequest=this.undoRequest(data.undo,'update',target,scope);return{channelId};},
   redo:async(state,scope)=>{const current=this.channel(patternId,channelId),before=Object.fromEntries(keys.map(key=>[key,state.undoRequest.body?.channel?.[key]??null]));if(!current||!same(values(current),before))throw notApplied(`${label} was not redone: the channel changed elsewhere.`);const data=await this.sendRequest(state.redoRequest,scope);state.undoRequest=this.undoRequest(data.undo,'update',target,scope);state.after=values(data.channel??state.after);return{channelId};}});
 }

 /** FL Insert above/below: a new channel at `position` (0-based). Undo deletes it; Redo restores the same id. */
 add(patternId,channel,{position,label='Insert channel',events}={}){
  if(!id(patternId)||!record(channel)||!['sample','plugin','instrument'].includes(channel.kind))throw fail('Choose a sample or instrument channel to insert.');
  const body={channel:clone(channel),...Number.isSafeInteger(position)&&position>=0?{position}:{},...Array.isArray(events)?{events:clone(events)}:{}},addTarget={operationId:'addPatternChannel',path:{pattern_id:patternId}};
  const deleteTarget=channelId=>({operationId:'deletePatternChannel',path:{pattern_id:patternId,channel_id:channelId}});
  return this.step({label,detail:state=>({patternId,channelId:state.channelId,position:state.position}),
   forward:async scope=>{const data=await this.sendRequest({...addTarget,body},scope);if(!id(data.channel?.id))throw fail('Freestyle added a channel without returning its id.',{operationUncertain:true});return{patternId,channelId:data.channel.id,position:data.position,deleteRequest:this.undoRequest(data.undo,'delete',deleteTarget(data.channel.id),scope),restoreRequest:null};},
   undo:async(state,scope)=>{if(!this.channel(patternId,state.channelId))throw notApplied('The inserted channel is already gone.');const data=await this.sendRequest(state.deleteRequest,scope);state.restoreRequest=this.undoRequest(data.undo,'add',addTarget,scope);return{channelId:state.channelId};},
   redo:async(state,scope)=>{if(this.channel(patternId,state.channelId))throw notApplied('The channel is already back in the pattern.');if(!state.restoreRequest)throw notApplied('Reload the retained channel before redoing.');const data=await this.sendRequest(state.restoreRequest,scope);state.deleteRequest=this.undoRequest(data.undo,'delete',deleteTarget(state.channelId),scope);return{channelId:state.channelId};}});
 }

 /** Delete one channel and its notes/steps/CC. Undo re-adds it exactly (same id, position, events and ccEvents). */
 remove(patternId,channelId,{label='Delete channel'}={}){
  if(!id(patternId)||!id(channelId))throw fail('Choose one saved channel to delete.');
  const addTarget={operationId:'addPatternChannel',path:{pattern_id:patternId}},deleteTarget={operationId:'deletePatternChannel',path:{pattern_id:patternId,channel_id:channelId}};
  return this.step({label,detail:()=>({patternId,channelId}),
   forward:async scope=>{if(!this.channel(patternId,channelId))throw notApplied('That channel is no longer in the saved pattern.');const data=await this.sendRequest({...deleteTarget,body:{}},scope);return{patternId,channelId,restoreRequest:this.undoRequest(data.undo,'add',addTarget,scope)};},
   undo:async(state,scope)=>{if(this.channel(patternId,channelId))throw notApplied('The channel is already back in the pattern.');await this.sendRequest(state.restoreRequest,scope);return{channelId};},
   redo:async(state,scope)=>{if(!this.channel(patternId,channelId))throw notApplied('The channel is already gone.');const data=await this.sendRequest({...deleteTarget,body:{}},scope);state.restoreRequest=this.undoRequest(data.undo,'add',addTarget,scope);return{channelId};}});
 }

 /** The two requests that undo an assignment: the 339 `undo.steps` as is, or
  * the older {outputLaneId, deleteLaneId} rebuilt. */
 assignUndoRequests(undo,patternId,channelId,laneId,scope){
  const patch={operationId:'updatePatternChannel',path:{pattern_id:patternId,channel_id:channelId}},lane={operationId:'deleteLane',path:{lane_id:laneId}};
  if(Array.isArray(undo?.steps)&&undo.steps.length===2){
   const [first,second]=undo.steps.map(step=>descriptorRequest(step,{projectId:scope.projectId}));
   if(!first||!second||first.operationId!=='updatePatternChannel'||first.path.pattern_id!==patternId||first.path.channel_id!==channelId||second.operationId!=='deleteLane'||second.path.lane_id!==laneId)throw fail('Freestyle returned an assignment undo for a different channel or track. It was not sent.',{operationUncertain:true});
   return[first,second];
  }
  const old=channelUndoBody(undo,'unassign');if(old.channelId!==channelId||old.deleteLaneId!==laneId)throw fail('Freestyle returned an assignment undo for a different channel or track. It was not sent.',{operationUncertain:true});
  return[{...patch,body:{channel:{outputLaneId:old.outputLaneId}}},{...lane,body:{}}];
 }

 /** FL "Assign to new instrument track": a new pattern lane (mixer track) the
  * sample channel plays through. Undo routes it back and deletes that lane;
  * Redo assigns again (Freestyle mints a new lane). */
 assignToNewTrack(patternId,channelId,{name,label='Assign to new instrument track'}={}){
  if(!id(patternId)||!id(channelId))throw fail('Choose one saved channel.');
  const body=typeof name==='string'&&name.trim()?{name:name.trim().slice(0,255)}:{};
  const assign=async(state,scope)=>{const data=await this.send('assignPatternChannelToNewTrack',{pattern_id:patternId,channel_id:channelId},body,scope);if(data.alreadyAssigned===true)return{unchanged:true,laneId:data.laneId};if(!id(data.laneId)||data.channel?.outputLaneId!==data.laneId)throw fail('Freestyle did not confirm the new instrument track routing.',{operationUncertain:true});return Object.assign(state,{patternId,channelId,laneId:data.laneId,previousOutput:null,undoRequests:this.assignUndoRequests(data.undo,patternId,channelId,data.laneId,scope),undoRouted:false});};
  return this.step({label,detail:state=>({patternId,channelId,laneId:state.laneId}),
   forward:scope=>assign({},scope),
   undo:async(state,scope)=>{const current=this.channel(patternId,channelId),[routeBack,deleteLane]=state.undoRequests,target=routeBack.body?.channel?.outputLaneId??null,routedBack=!!current&&state.undoRouted===true&&(current.outputLaneId??null)===target;
    if(!current||current.outputLaneId!==state.laneId&&!routedBack)throw notApplied('The channel is no longer routed to its new track.');
    // Resumable: after a 412 on the lane delete, the re-run skips the routing already saved.
    const routed=routedBack?{timelineRevision:undefined}:await this.sendRequest(routeBack,scope);state.undoRouted=true;
    // The lane was created empty for this channel; deleting it is the documented
    // second half of the undo, guarded by the revision that PATCH returned.
    await this.sendRequest(deleteLane,scope,{revision:typeof routed.timelineRevision==='string'&&routed.timelineRevision?routed.timelineRevision:undefined});state.undoRouted=false;state.previousOutput=target;return{channelId,laneId:state.laneId};},
   redo:async(state,scope)=>{const current=this.channel(patternId,channelId);if(!current||(current.outputLaneId??null)!==(state.previousOutput??null))throw notApplied('The channel routing changed elsewhere.');const result=await assign(state,scope);if(result.unchanged)throw notApplied('The channel already plays through its own track.');return{channelId,laneId:state.laneId};}});
 }
}
