/**
 * Logic channel-strip aux Sends on Freestyle (Studio API 357):
 * listLaneSends / setLaneSend / deleteLaneSend, createBus / deleteBus.
 *
 * A send is a parallel copy of a lane to a non-master bus: linear level 0-2
 * (1 = 0 dB, 2 = +6 dB), pre_fader true (before the lane fader and pan) or
 * false (post). At most 16 per lane; buses have no sends (they sum to master).
 *
 * What the strip shows, newest first: this client's optimistic / just
 * confirmed send, the live engine view (getEngineMix tracks[].sends, held by
 * the MixRevisionTracker and kept fresh by its long-poll), a listLaneSends
 * read, then the saved getProject lanes[].sends. So opening the Mixer costs no
 * per-lane read on a current server.
 *
 * Every gesture (insert a send, a knob drag, Pre/Post, change bus, remove,
 * New Bus + send, delete bus) is ONE step in the global history
 * (beginExternalStep / finishExternalStep). Each write is guarded by the live
 * mix revision (expected_mix_revision / If-Match "mix-<n>"); before writing,
 * a fresh read must show the affected sends exactly as the step expects, else
 * nothing is sent (dispatched:false). A 412 rolls the optimistic view back and
 * re-reads the mix. The inverse comes from each reply's `previous`.
 */
import {isMixRevisionConflict,mixRevisionOf,mixEtag,mixValuesEqual,mixLaneSends,normalizeMixSend,normalizeMixSends,sendControl,MIX_CONFLICT_NOTICE} from './mix-revision.js';
import {logicLevelText,logicFaderGainToPosition,logicFaderPositionToGain} from './logic-fader-scale.js';

export const MAX_LANE_SENDS=16;
export const SEND_MAX_LEVEL=2;
export const SEND_UNITY_LEVEL=1;
export const SEND_UNSUPPORTED=Object.freeze({
 bus:'Sends: Freestyle buses sum to the Stereo Out only (no bus-to-bus sends).',
 master:'The Stereo Out has no sends.',
 backing:'Sends: the backing track has no lane to send from.',
 api:'Sends need a Studio API (OAuth) project with the lane send API.',
});
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=128;
const clone=value=>value==null?value:structuredClone(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);

/** Logic's send readout: "0.0", "-6.0", "-∞" (dB of the linear level). */
export function sendLevelText(level){return logicLevelText(level);}
/** Knob position 0..1 uses the channel fader taper (1 = +6 dB = level ≈ 2). */
export function sendKnobPosition(level){if(!finite(level)||level<=0)return 0;return Math.min(1,logicFaderGainToPosition(Math.min(SEND_MAX_LEVEL,level)));}
export function sendKnobLevel(position){const p=Math.max(0,Math.min(1,finite(position)?position:0));return Math.min(SEND_MAX_LEVEL,Math.round(logicFaderPositionToGain(p)*1e6)/1e6);}
export function sameSend(a,b){if(a==null||b==null)return a==null&&b==null;return mixValuesEqual({level:a.level,preFader:!!a.preFader},{level:b.level,preFader:!!b.preFader});}
/** Why a strip has no send slots (null = it can send). */
export function sendsUnavailableReason(row,{supported=true}={}){
 if(!row)return SEND_UNSUPPORTED.api;
 if(row.kind==='bus')return row.id==='master'?SEND_UNSUPPORTED.master:SEND_UNSUPPORTED.bus;
 if(row.kind!=='lane')return SEND_UNSUPPORTED.api;
 if(row.id==='backing')return SEND_UNSUPPORTED.backing;
 return supported?null:SEND_UNSUPPORTED.api;
}
/** The next free Logic bus name ("Bus N") and a durable id for it. */
export function nextBusIdentity(buses,{random=()=>Math.random().toString(36).slice(2,8)}={}){
 const names=new Set(),ids=new Set();for(const bus of buses||[]){if(identity(bus?.id))ids.add(bus.id);if(typeof bus?.name==='string')names.add(bus.name.trim().toLowerCase());}
 for(let n=1;n<=1024;n++){const name=`Bus ${n}`,id=`bus-${n}`;if(!names.has(name.toLowerCase())&&!ids.has(id))return{busId:id,name};}
 return{busId:`bus-${random()}`,name:'Bus'};
}
export function busDisplayName(buses,busId){const bus=(buses||[]).find(item=>item?.id===busId);return typeof bus?.name==='string'&&bus.name?bus.name:busId;}
/**
 * Logic's send slot menu. send: the slot's send or null (an empty slot).
 * buses: [{id,name}] (non-master); used: busIds this lane already sends to.
 * actions: {choose(busId), none(), newBus(), tap(preFader)}.
 */
export function sendSlotMenuItems({send=null,buses=[],used=[],count=0,max=MAX_LANE_SENDS,actions={},busy=false}={}){
 const taken=new Set(used),run=name=>(...args)=>actions[name]?.(...args),full=!send&&count>=max;
 const items=[{label:send?'Remove Send':'No Send',checked:!send,disabled:busy||!send,title:send?`Remove the send to ${busDisplayName(buses,send.busId)}`:'This slot has no send',run:run('none')},null];
 for(const bus of buses){const current=send?.busId===bus.id,other=!current&&taken.has(bus.id);items.push({label:bus.name||bus.id,checked:current,disabled:busy||current||other||full,title:current?'This send’s bus':other?`This track already sends to ${bus.name||bus.id}`:full?`A track has at most ${max} sends`:`Send to ${bus.name||bus.id}`,run:()=>actions.choose?.(bus.id)});}
 if(buses.length)items.push(null);
 items.push({label:'New Bus',disabled:busy||full,title:full?`A track has at most ${max} sends`:'Create a new bus (aux) and send to it',run:run('newBus')});
 if(send){items.push(null,{label:'Post Fader',checked:!send.preFader,disabled:busy,title:'Tap after the track’s fader and pan',run:()=>actions.tap?.(false)},{label:'Pre Fader',checked:!!send.preFader,disabled:busy,title:'Tap before the track’s fader and pan (mute/solo still silence it)',run:()=>actions.tap?.(true)});}
 return items;
}
/** The deleteBus 409 message: name the tracks that still send to it. */
export function busInUseMessage(busName,senders=[]){
 const list=senders.filter(Boolean);
 return list.length?`Remove the sends to ${busName} first (${list.join(', ')}).`:`${busName} is still in use. Remove the sends to ${busName} and route its tracks to another output first.`;
}
const refusal=(message,extra={})=>Object.assign(new Error(message),{dispatched:false,historyNotApplied:true,explicitRejection:true,...extra});
const statusOf=error=>Number(error?.status??error?.statusCode)||0;
const refusedStatus=error=>[400,403,404,409,412,422,428].includes(statusOf(error))||error?.dispatched===false;

/**
 * Sends of every lane of one project, with guarded one-step writes.
 * options: client() → StudioApiClient | null, projectId(), trackId(),
 *   mixRevision() → MixRevisionTracker | null, history() → pattern history | null,
 *   buses() → [{id,name}], lanes() → [{id,name,saved}], busy() → bool, onChange(), onBusesChanged() (async; e.g. reload buses),
 *   log(event, detail).
 */
export class LaneSendsController{
 constructor({client=()=>null,projectId=()=>null,trackId=()=>null,mixRevision=()=>null,history=()=>null,buses=()=>[],lanes=()=>[],busy=()=>false,onChange=()=>{},onBusesChanged=async()=>{},log=()=>{},listConcurrency=4}={}){
  Object.assign(this,{client,projectId,trackId,mixRevision,history,buses,lanes,busy,onChange,onBusesChanged,log,listConcurrency});
  this.project=null;this.overlays=new Map();this.listed=new Map();this.listing=new Map();this.writing=0;this.status=null;
 }
 sync(){const id=this.projectId();if(id!==this.project){this.project=id;this.overlays.clear();this.listed.clear();this.listing.clear();this.status=null;}return id;}
 notify(){try{this.onChange();}catch{}}
 tracker(){const tracker=this.mixRevision();return tracker&&tracker.projectId===this.project?tracker:null;}
 /** The base (non-optimistic) sends of a lane: live > listed > saved. */
 base(laneId,saved){
  const tracker=this.tracker(),live=tracker?.mix?mixLaneSends(tracker.mix,laneId):{known:false};
  if(live.known)return{sends:live.sends,source:'live',revision:tracker.revision};
  if(this.listed.has(laneId))return{sends:this.listed.get(laneId),source:'listed',revision:null};
  const persisted=normalizeMixSends(saved);return persisted?{sends:persisted,source:'saved',revision:null}:null;
 }
 /** {known, sends:[{busId,level,preFader,pending}], source} for a lane strip. */
 sendsFor(laneId,{saved}={}){
  this.sync();const base=this.base(laneId,saved),overlay=this.overlays.get(laneId);
  if(overlay)for(const [busId,entry]of overlay){
   // A confirmed send gives way once the live view caught up with (or moved past) it.
   if(!entry.pending&&base?.source==='live'&&entry.revision!=null&&base.revision!=null&&base.revision>=entry.revision)overlay.delete(busId);
   else if(!entry.pending&&base&&base.source!=='live'&&sameSend(base.sends.find(send=>send.busId===busId)??null,entry.value))overlay.delete(busId);
  }
  if(overlay&&!overlay.size)this.overlays.delete(laneId);
  if(!base&&!this.overlays.has(laneId))return{known:false,sends:[],source:null};
  const list=(base?.sends||[]).map(send=>({...send})),current=this.overlays.get(laneId);
  if(current)for(const [busId,entry]of current){const at=list.findIndex(send=>send.busId===busId);if(entry.value===null){if(at>=0)list.splice(at,1);continue;}const row={busId,level:entry.value.level,preFader:entry.value.preFader,...entry.pending?{pending:true}:{}};if(at>=0)list[at]=row;else list.push(row);}
  return{known:true,sends:list,source:base?.source??'local'};
 }
 /** True once per change of any lane's shown sends (live mix updates repaint the Sends rows). */
 signatureChanged(){let next='';try{next=JSON.stringify((this.lanes()||[]).map(lane=>[lane.id,this.sendsFor(lane.id,{saved:lane.saved}).sends]));}catch{return false;}if(next===this.signature)return false;this.signature=next;return true;}
 /** Fallback for servers whose project/mix reads omit sends: one listLaneSends per unknown lane, a few at a time, once per project load. */
 async ensureListed(lanes){
  const projectId=this.sync(),client=this.client();if(!projectId||!client)return 0;
  const todo=(lanes||[]).filter(lane=>identity(lane?.id)&&lane.id!=='backing'&&!this.listed.has(lane.id)&&!this.listing.has(lane.id)&&!this.base(lane.id,lane.saved));
  let index=0,read=0;const worker=async()=>{while(index<todo.length){const lane=todo[index++];const promise=client.call('listLaneSends',{path:{project_id:projectId,lane_id:lane.id}});this.listing.set(lane.id,promise);try{const result=await promise;if(this.project!==projectId)return;const sends=normalizeMixSends(result?.data?.sends);if(sends&&(result.data.laneId==null||result.data.laneId===lane.id)){this.listed.set(lane.id,sends);read++;}}catch(error){this.log('lane-sends-list-error',{laneId:lane.id,status:statusOf(error),code:error?.code??null});}finally{if(this.listing.get(lane.id)===promise)this.listing.delete(lane.id);}}};
  await Promise.all(Array.from({length:Math.min(this.listConcurrency,todo.length)},worker));if(read)this.notify();return read;
 }
 /** Fresh sends of one lane for a guard, with the mix revision to send. */
 async readCurrent(laneId){
  const tracker=this.tracker(),projectId=this.project;
  if(tracker?.available?.(projectId)){const fresh=await tracker.refresh({source:'guard'});const live=mixLaneSends(fresh.mix,laneId);if(live.known)return{sends:live.sends,revision:fresh.revision};}
  const result=await this.client().call('listLaneSends',{path:{project_id:projectId,lane_id:laneId}}),sends=normalizeMixSends(result?.data?.sends);
  if(!sends)throw refusal('Freestyle did not return this track’s sends. Reload the mixer.');this.listed.set(laneId,sends);
  return{sends,revision:tracker?.available?.(projectId)?tracker.revision:null};
 }
 async freshRevision(){const tracker=this.tracker();if(!tracker?.available?.(this.project))return null;try{return (await tracker.refresh({source:'guard'})).revision;}catch{return tracker.revision;}}
 note(laneId,busId,value,{pending,revision=null}){let overlay=this.overlays.get(laneId);if(!overlay)this.overlays.set(laneId,overlay=new Map());overlay.set(busId,{value:value?{level:value.level,preFader:!!value.preFader}:null,pending,revision});}
 clear(laneId,busIds){const overlay=this.overlays.get(laneId);if(!overlay)return;for(const busId of busIds)overlay.delete(busId);if(!overlay.size)this.overlays.delete(laneId);}
 /** One send write; returns the reply data and the revision it produced. */
 async write(laneId,busId,value,expected){
  const client=this.client(),projectId=this.project,trackId=this.trackId(),path={project_id:projectId,lane_id:laneId,bus_id:busId};
  const result=value?await client.call('setLaneSend',{path,body:{level:Math.max(0,Math.min(SEND_MAX_LEVEL,value.level)),pre_fader:!!value.preFader,...expected!=null?{expected_mix_revision:expected}:{},...identity(trackId)&&trackId.length<=64?{track_id:trackId}:{}}})
   :await client.call('deleteLaneSend',{path},expected!=null?{ifMatch:mixEtag(expected)}:{});
  const data=result?.data;if(!record(data)||data.ok===false)throw Object.assign(new Error('Freestyle did not confirm the send.'),{operationUncertain:true});
  const revision=mixRevisionOf(data,{etag:result.etag});
  this.tracker()?.noteWrite?.(result,[{target:{kind:'lane',id:laneId},control:sendControl(busId),value:value?{level:data.send?.level??value.level,preFader:data.send?.preFader??!!value.preFader}:null}],{expected});
  return{data,revision,previous:data.previous===null?null:normalizeMixSend(data.previous)};
 }
 /**
  * Move the lane's sends from `from` to `to` ({busId: send|null}); optional
  * bus creation (forward) or deletion (backward) around it. Guarded: refused
  * (dispatched:false) unless a fresh read shows exactly `from`. A failure after
  * a partial write puts the written sends back; if that fails too the result
  * is uncertain. Returns the server's `previous` of each written send.
  */
 async transition(laneId,from,to,{createBus=null,deleteBus=null}={}){
  const buses=[...new Set([...Object.keys(from),...Object.keys(to)])];
  const current=await this.readCurrent(laneId),now=new Map(current.sends.map(send=>[send.busId,send]));
  for(const busId of buses){const have=now.get(busId)??null;if(!sameSend(have,from[busId]??null))throw refusal(`The send to ${busDisplayName(this.buses(),busId)} changed elsewhere — your change wasn’t applied.`,{code:'send_changed',mixRevisionConflict:false});}
  const count=now.size+buses.filter(busId=>!now.has(busId)&&to[busId]).length-buses.filter(busId=>now.has(busId)&&!to[busId]).length;
  if(count>MAX_LANE_SENDS)throw refusal(`A track has at most ${MAX_LANE_SENDS} sends.`,{code:'too_many_sends'});
  let revision=current.revision;const done=[],previous={};let createdBus=false;
  try{
   if(createBus){await this.client().call('createBus',{path:{project_id:this.project},body:{bus_id:createBus.bus_id,...createBus.name?{name:createBus.name}:{}}});createdBus=true;try{await this.onBusesChanged();}catch{}revision=await this.freshRevision();}
   // Removals first (frees a slot under the 16-send limit), then sets.
   const ops=[...buses.filter(busId=>!to[busId]&&from[busId]),...buses.filter(busId=>to[busId]&&!sameSend(from[busId]??null,to[busId]))];
   for(const busId of ops){const reply=await this.write(laneId,busId,to[busId]||null,revision);done.push(busId);previous[busId]=reply.previous;revision=reply.revision??await this.freshRevision();}
   if(deleteBus){await this.deleteBusRequest(deleteBus);try{await this.onBusesChanged();}catch{}}
   return{previous,revision};
  }catch(error){
   if(!done.length&&!createdBus){if(refusedStatus(error))Object.assign(error,{dispatched:false,historyNotApplied:true});throw error;}
   // Put back what this transition already wrote.
   try{
    let back=await this.freshRevision();
    for(const busId of done.reverse()){const reply=await this.write(laneId,busId,from[busId]||null,back);back=reply.revision??await this.freshRevision();}
    if(createdBus){await this.deleteBusRequest(createBus.bus_id);try{await this.onBusesChanged();}catch{}}
    throw Object.assign(error,{dispatched:false,historyNotApplied:true,rolledBack:true});
   }catch(rollback){if(rollback===error)throw error;throw Object.assign(error,{operationUncertain:true,rollbackError:String(rollback?.message||rollback).slice(0,200)});}
  }
 }
 async deleteBusRequest(busId){
  try{return await this.client().call('deleteBus',{path:{project_id:this.project,bus_id:busId}});}
  catch(error){if(statusOf(error)===409){const name=busDisplayName(this.buses(),busId);throw Object.assign(error,{message:busInUseMessage(name,this.senders(busId)),dispatched:false,historyNotApplied:true,busInUse:true});}throw error;}
 }
 /** Names of lanes known to send to busId (for the deleteBus 409 message). */
 senders(busId){const names=[];for(const lane of this.lanes()||[]){const read=this.sendsFor(lane.id,{saved:lane.saved});if(read.sends.some(send=>send.busId===busId))names.push(lane.name||lane.id);}return names;}
 assertReady(){
  if(!this.sync()||!this.client())throw refusal(SEND_UNSUPPORTED.api);
  if(this.writing||this.busy())throw refusal('Wait for the current mixer change to save.',{code:'send_busy'});
 }
 /** One gesture = one history step. step: {laneId, before, after, createBus?}. */
 async commit(step,{label='Send'}={}){
  this.assertReady();const history=this.history();let pending=null;
  if(history?.beginExternalStep){try{pending=history.beginExternalStep({kind:'mixer_send',label});}catch(error){throw refusal(error?.message||'Wait for the current history operation.',{code:error?.code||'history_busy'});}}
  const busIds=[...new Set([...Object.keys(step.before),...Object.keys(step.after)])];
  this.writing++;for(const busId of busIds)this.note(step.laneId,busId,step.after[busId]??null,{pending:true});this.status=null;this.notify();
  try{
   const result=await this.transition(step.laneId,step.before,step.after,{createBus:step.createBus||null});
   // The inverse is what the server says was there before each write.
   for(const [busId,value]of Object.entries(result.previous))step.before[busId]=value;
   for(const busId of busIds)this.note(step.laneId,busId,step.after[busId]??null,{pending:false,revision:result.revision});
   if(pending){history.finishExternalStep(pending,{undo:()=>this.replay(step,'undo'),redo:()=>this.replay(step,'redo'),detail:{laneId:step.laneId,buses:busIds,label}});pending=null;}
   this.log('lane-send',{laneId:step.laneId,buses:busIds,label,revision:result.revision});return result;
  }catch(error){
   this.clear(step.laneId,busIds);if(pending){history.failExternalStep(pending,error?.operationUncertain?error:Object.assign(error,{historyNotApplied:error?.historyNotApplied??refusedStatus(error)}));pending=null;}
   await this.settleFailure(error);throw error;
  }finally{this.writing--;this.notify();}
 }
 /** Undo / Redo of a committed step: the same guarded transition. */
 async replay(step,direction){
  if(!this.sync()||!this.client())throw refusal(SEND_UNSUPPORTED.api);
  const undo=direction==='undo',from=undo?step.after:step.before,to=undo?step.before:step.after,busIds=[...new Set([...Object.keys(from),...Object.keys(to)])];
  this.writing++;for(const busId of busIds)this.note(step.laneId,busId,to[busId]??null,{pending:true});this.notify();
  try{
   const result=await this.transition(step.laneId,from,to,undo?{deleteBus:step.createBus?.bus_id||null}:{createBus:step.createBus||null});
   for(const busId of busIds)this.note(step.laneId,busId,to[busId]??null,{pending:false,revision:result.revision});return{status:'confirmed',revision:result.revision};
  }catch(error){this.clear(step.laneId,busIds);await this.settleFailure(error);throw error;}
  finally{this.writing--;this.notify();}
 }
 async settleFailure(error){
  if(isMixRevisionConflict(error)){Object.assign(error,{dispatched:false,historyNotApplied:true});if(!/changed elsewhere/.test(error.message||''))error.message=MIX_CONFLICT_NOTICE;try{await this.tracker()?.resolveConflict?.(error);}catch{}}
  this.status=error?.message||String(error);
 }
 // ---- Gestures ------------------------------------------------------------
 current(laneId,saved,busId){return this.sendsFor(laneId,{saved}).sends.find(send=>send.busId===busId)||null;}
 /** Insert a send (empty slot → bus) at 0 dB post fader, or move a send to another bus keeping its level and tap. */
 async chooseBus(laneId,{saved,fromBusId=null,busId}){
  const old=fromBusId?this.current(laneId,saved,fromBusId):null;if(fromBusId===busId)return null;
  if(this.current(laneId,saved,busId))throw refusal(`This track already sends to ${busDisplayName(this.buses(),busId)}.`);
  const value=old?{level:old.level,preFader:old.preFader}:{level:SEND_UNITY_LEVEL,preFader:false};
  const before={[busId]:null},after={[busId]:value};if(old){before[fromBusId]={level:old.level,preFader:old.preFader};after[fromBusId]=null;}
  return this.commit({laneId,before,after},{label:old?'Change Send Bus':'Add Send'});
 }
 async setLevel(laneId,{saved,busId,level}){const old=this.current(laneId,saved,busId);if(!old)throw refusal('This send is no longer on the track.');const next=Math.max(0,Math.min(SEND_MAX_LEVEL,level));if(mixValuesEqual(old.level,next))return null;return this.commit({laneId,before:{[busId]:{level:old.level,preFader:old.preFader}},after:{[busId]:{level:next,preFader:old.preFader}}},{label:'Send Level'});}
 async setTap(laneId,{saved,busId,preFader}){const old=this.current(laneId,saved,busId);if(!old)throw refusal('This send is no longer on the track.');if(old.preFader===!!preFader)return null;return this.commit({laneId,before:{[busId]:{level:old.level,preFader:old.preFader}},after:{[busId]:{level:old.level,preFader:!!preFader}}},{label:preFader?'Send Pre Fader':'Send Post Fader'});}
 async remove(laneId,{saved,busId}){const old=this.current(laneId,saved,busId);if(!old)return null;return this.commit({laneId,before:{[busId]:{level:old.level,preFader:old.preFader}},after:{[busId]:null}},{label:'Remove Send'});}
 /** Logic "New Bus": createBus + send to it (or move this slot's send to it) as one step. */
 async newBus(laneId,{saved,fromBusId=null}={}){
  this.assertReady();const old=fromBusId?this.current(laneId,saved,fromBusId):null,identityFor=nextBusIdentity(this.buses());
  const value=old?{level:old.level,preFader:old.preFader}:{level:SEND_UNITY_LEVEL,preFader:false},before={[identityFor.busId]:null},after={[identityFor.busId]:value};
  if(old){before[fromBusId]={level:old.level,preFader:old.preFader};after[fromBusId]=null;}
  return this.commit({laneId,before,after,createBus:{bus_id:identityFor.busId,name:identityFor.name}},{label:'New Bus'});
 }
 /** Replace every send of a lane with `sends` (Paste Channel Strip): one step. */
 async replaceAll(laneId,{saved,sends}){
  const now=this.sendsFor(laneId,{saved});if(!now.known)throw refusal('This track’s sends are not loaded yet.');
  const target=normalizeMixSends(sends);if(!target)throw refusal('The copied sends are invalid.');if(target.length>MAX_LANE_SENDS)throw refusal(`A track has at most ${MAX_LANE_SENDS} sends.`);
  const before={},after={};for(const send of now.sends){before[send.busId]={level:send.level,preFader:send.preFader};after[send.busId]=null;}
  for(const send of target){if(!(send.busId in before))before[send.busId]=null;after[send.busId]={level:send.level,preFader:send.preFader};}
  for(const busId of Object.keys(after))if(sameSend(before[busId],after[busId])){delete before[busId];delete after[busId];}
  if(!Object.keys(after).length)return null;
  return this.commit({laneId,before,after},{label:'Paste Channel Strip Sends'});
 }
 /**
  * Delete a bus (one history step; Undo re-creates it with its saved name,
  * level, mute/solo, order and plug-in chain). 409 while any lane still sends
  * or routes to it: "Remove the sends to Bus N first".
  */
 async deleteBus({busId,restore={}}){
  this.assertReady();const name=busDisplayName(this.buses(),busId),senders=this.senders(busId);
  if(senders.length)throw refusal(busInUseMessage(name,senders),{busInUse:true});
  const history=this.history();let pending=null;
  if(history?.beginExternalStep){try{pending=history.beginExternalStep({kind:'mixer_bus_delete',label:'Delete Bus'});}catch(error){throw refusal(error?.message||'Wait for the current history operation.');}}
  const body={bus_id:busId};for(const key of ['name','gain','muted','soloed','display_order','plugin_chain'])if(restore[key]!==undefined&&restore[key]!==null)body[key]=clone(restore[key]);
  const create=async()=>{await this.client().call('createBus',{path:{project_id:this.project},body:clone(body)});try{await this.onBusesChanged();}catch{}return{status:'confirmed'};};
  const remove=async()=>{try{await this.deleteBusRequest(busId);}catch(error){if(refusedStatus(error))Object.assign(error,{dispatched:false,historyNotApplied:true});throw error;}try{await this.onBusesChanged();}catch{}return{status:'confirmed'};};
  this.writing++;this.notify();
  try{await remove();if(pending){history.finishExternalStep(pending,{undo:create,redo:remove,detail:{busId,name}});pending=null;}this.log('bus-delete',{busId});return{deleted:busId};}
  catch(error){if(pending){history.failExternalStep(pending,error);pending=null;}this.status=error.message;throw error;}
  finally{this.writing--;this.notify();}
 }
}
