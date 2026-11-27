/** Cloud mixer controls. No local audio processing. */
import {studioCompatibleRequest} from './studio-api-bridge.js';
import {reconcilePluginWindows,closePluginWindowsFor} from './plugin-window-registry.js';
import {STUDIO_API_OPERATIONS,StudioApiClient} from './studio-api-client.js';
import {cloudOperationError,hasCanonicalTruncation} from './cloud-session.js';
import {pluginParameterControl,pluginParameterWriteBody} from './plugin-parameter-contract.js';
import {livePluginParameterMessage,liveControlKey} from './cloud-live-control.js';
import {clientLog} from './client-diagnostics.js';
import {isPluginParameterConflict,pluginConflictValue,PLUGIN_CONFLICT_NOTICE} from './mix-revision.js';
import {hostFetch} from './freestyle-host-transport.js';
// Freestyle's native plug-in catalog (the live list comes from the plugins API).
export const NATIVE_PLUGIN_CATALOG = Object.freeze([
  {
    "type": "valhalla_vintage_verb",
    "label": "ValhallaVintageVerb",
    "category": "Reverb",
    "kind": "effect",
    "hostGated": false
  },
  {
    "type": "fabfilter_pro_c_3",
    "label": "FabFilter Pro-C 3",
    "category": "Compressor",
    "kind": "effect",
    "hostGated": false
  },
  {
    "type": "fabfilter_pro_q_4",
    "label": "FabFilter Pro-Q 4",
    "category": "EQ",
    "kind": "effect",
    "hostGated": false
  },
  {
    "type": "fabfilter_pro_r_2",
    "label": "FabFilter Pro-R 2",
    "category": "Reverb",
    "kind": "effect",
    "hostGated": false
  },
  {
    "type": "fabfilter_twin_3",
    "label": "FabFilter Twin 3",
    "category": "Synthesizer",
    "kind": "instrument",
    "hostGated": false
  },
  {
    "type": "fabfilter_volcano_3",
    "label": "FabFilter Volcano 3",
    "category": "Filter",
    "kind": "effect",
    "hostGated": false
  },
  {
    "type": "fabfilter_timeless_3",
    "label": "FabFilter Timeless 3",
    "category": "Delay",
    "kind": "effect",
    "hostGated": false
  },
  {
    "type": "fabfilter_saturn_2",
    "label": "FabFilter Saturn 2",
    "category": "Distortion",
    "kind": "effect",
    "hostGated": false
  },
  {
    "type": "fabfilter_pro_l_2",
    "label": "FabFilter Pro-L 2",
    "category": "Limiter",
    "kind": "effect",
    "hostGated": false
  },
  {
    "type": "fabfilter_pro_mb",
    "label": "FabFilter Pro-MB",
    "category": "Multiband Dynamics",
    "kind": "effect",
    "hostGated": false
  },
  {
    "type": "fabfilter_pro_ds",
    "label": "FabFilter Pro-DS",
    "category": "De-Esser",
    "kind": "effect",
    "hostGated": false
  },
  {
    "type": "fabfilter_pro_g",
    "label": "FabFilter Pro-G",
    "category": "Gate",
    "kind": "effect",
    "hostGated": false
  },
  {
    "type": "fabfilter_micro",
    "label": "FabFilter Micro",
    "category": "Filter",
    "kind": "effect",
    "hostGated": false
  },
  {
    "type": "fabfilter_simplon",
    "label": "FabFilter Simplon",
    "category": "Filter",
    "kind": "effect",
    "hostGated": false
  },
  {
    "type": "fabfilter_one",
    "label": "FabFilter One",
    "category": "Synthesizer",
    "kind": "instrument",
    "hostGated": false
  },
  {
    "type": "xpand2",
    "label": "Xpand!2",
    "category": "AIR multitimbral workstation",
    "kind": "instrument",
    "hostGated": true
  }
].map(Object.freeze));

const list=value=>Array.isArray(value)?value:[];
const finite=value=>value!==null&&value!==''&&value!==undefined&&Number.isFinite(Number(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const identity=plugin=>plugin?.instance_id||plugin?.instanceId||plugin?.id||'';
/** Instance preconditions for lane plugin parameter/bypass/preset/program
 * writes: the API refuses another instance with 409 plugin_instance_mismatch. */
/** setLanePluginParameter reply → {acknowledged, value}: acknowledged when the engine took the instance-pinned
 * compare-and-set (ok / mutated, no error/refusal); value is a reported applied value in the write form, if any. */
export function parameterWriteReply(raw,{form='normalized'}={}){
  const body=raw?.structuredContent??raw,response=record(body?.response)?body.response:{},none={acknowledged:false,value:null};
  if(!record(body)||body.error||response.error||response.ok===false||body.ok===false||response.applied===false)return none;
  const acknowledged=body.mutated===true||response.ok===true||body.ok===true;if(!acknowledged)return none;
  const pick=(...values)=>values.find(value=>typeof value==='number'&&Number.isFinite(value))??null;
  const value=form==='physical'?pick(response.physicalValue,response.physical_value,body.physicalValue):pick(response.value_norm,response.valueNorm,response.normalized,body.valueNorm,body.value_norm);
  return{acknowledged:true,value};
}
/** Release 2026-11-14: a hosted setLanePluginParameter reply's editorFrameWoken — true only when the engine
 * says it woke the editor-frame stream (subscribers repaint at once). Absent/false/any other shape → false,
 * so the GUI keeps its resubscribe + fresh-capture workaround. */
export function parameterEditorFrameWoken(raw){
  const body=raw?.structuredContent??raw;if(!record(body))return false;const response=record(body.response)?body.response:{};
  return body.editorFrameWoken===true||response.editorFrameWoken===true;
}
export function expectedPluginFields(plugin){const instance=identity(plugin),type=plugin?.type_id??plugin?.typeId??plugin?.type;return{...(typeof instance==='string'&&instance?{expected_plugin_instance_id:instance}:{}),...(typeof type==='string'&&type?{expected_plugin_type:type}:{})};}
const INSTANCE_CHECKED_WRITES=new Set(['parameter','bypass','preset','program']);
function mismatchDetails(error){
  const found={};const visit=(value,depth)=>{if(!value||typeof value!=='object'||depth>6)return;for(const [key,child]of Object.entries(value)){if(['currentInstanceId','current_instance_id'].includes(key)&&typeof child==='string')found.instance??=child;else if(['currentPluginType','current_plugin_type'].includes(key)&&typeof child==='string')found.type??=child;else if(child&&typeof child==='object')visit(child,depth+1);}};
  visit({error:error?.details,result:error?.result,data:error?.data},0);return found;
}
/** A read the engine could not serve yet (session still loading/dispatch failure); GET retries are safe. */
export function transientEngineRead(error){
  const status=Number(error?.status||error?.upstreamStatus||0),code=String(error?.code||'');
  return status>=500||status===429||['engine_error','engine_unavailable','engine_busy','engine_not_ready','target_not_loaded','session_loading'].includes(code)||error?.stage==='engine_dispatch'||/live engine couldn.t apply|try again in a moment/i.test(String(error?.message||''));
}
export const PARAMETER_READ_RETRY_MS=[800,1600,3200];
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const partial=value=>{if(!value||typeof value!=='object')return false;for(const [key,child]of Object.entries(value)){if((/^_+truncated/i.test(key)||key==='truncated')&&child!==false&&child!==0&&child!=null&&(typeof child!=='object'||Object.values(child).some(Boolean)))return true;if(partial(child))return true;}return false;};
const unavailable=feature=>Object.assign(new Error(`${feature} is waiting for its Studio API operation. Existing loaded-plugin parameters and bypass remain available.`),{code:'studio_operation_unavailable',dispatched:false});
export function unpackMixerResult(result) {
  let data=result?.structuredContent;
  if(data===undefined&&Array.isArray(result?.content)){
    try{data=JSON.parse(result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'));}catch{}
  }
  data??=result;
  // 339: an envelope's stale:true (listLanePlugins answered from the last known chain) survives unwrapping.
  let stale=false;
  for(let i=0;i<5;i++){
    if(result?.isError||data?.error||data?.ok===false){
      const error=new Error(data?.detail||data?.error?.message||data?.error||data?.message||'Freestyle could not complete the mixer operation.');
      error.code=data?.code;error.retryAfterSec=data?.retryAfterSec;throw error;
    }
    if(data?.stale===true)stale=true;
    if(data?.response&&typeof data.response==='object')data=data.response;else break;
  }
  return stale&&data&&typeof data==='object'&&!Array.isArray(data)&&data.stale!==true?{...data,stale:true}:data||{};
}
async function defaultCall(name,args,options={}){
  const {response,data,request}=await studioCompatibleRequest(name,args,options);
  if(!response.ok)throw Object.assign(cloudOperationError(data,{status:response.status,fallback:`Freestyle request failed (${response.status}).`}),{studioRequest:request,idempotencyKey:request.idempotencyKey});
  return unpackMixerResult(data);
}
/** Expected chain after one slot edit (display only): remove / insert / move / bypass / swap, slots renumbered 0..n. */
export function chainTransform(plugins,{op,id,type,name,index,to,bypassed}={}){
  const rows=normalizeLoadedPlugins(plugins).filter(plugin=>Number.isInteger(plugin.index)).map(plugin=>({...plugin}));const at=rows.findIndex(plugin=>identity(plugin)===id);
  if(op==='remove'){if(at<0)return null;rows.splice(at,1);}
  else if(op==='insert'){rows.splice(Math.max(0,Math.min(Number.isInteger(index)?index:rows.length,rows.length)),0,{instance_id:`pending-${type}`,type_id:type,name:name||type,bypassed:bypassed===true,pending:true});}
  else if(op==='move'){if(at<0||!Number.isInteger(to))return null;const [moved]=rows.splice(at,1);rows.splice(Math.max(0,Math.min(to,rows.length)),0,moved);}
  else if(op==='bypass'){if(at<0)return null;rows[at].bypassed=bypassed===true;}
  else if(op==='swap'){if(at<0)return null;rows[at]={instance_id:`pending-${type}`,type_id:type,name:name||type,bypassed:false,pending:true};}
  else return null;
  return rows.map((plugin,position)=>({...plugin,index:position}));
}
export function normalizeLoadedPlugins(value){
  return list(value).map(plugin=>({...plugin,index:Number.isInteger(plugin.index)?plugin.index:Number.isInteger(plugin.plugin_index)?plugin.plugin_index:null,name:plugin.name||plugin.label||plugin.plugin_name||plugin.type_id||'Cloud plugin',bypassed:plugin.bypassed===true})).sort((a,b)=>(a.index??Infinity)-(b.index??Infinity));
}
export function normalizePluginParameters(raw){
  const snapshot=raw?.snapshot||raw?.state||raw?.plugin||raw||{};
  const source=snapshot.parameters||[],entries=Array.isArray(source)?source:Object.entries(source).map(([key,value])=>typeof value==='object'?{index:Number(key),...value}:{index:Number(key),value});
  return entries.flatMap(parameter=>{
    const index=parameter.index??parameter.parameter_index??parameter.parameterIndex;
    if(!Number.isInteger(index)||index<0)return[];
    let normalized=[parameter.value_norm,parameter.normalized_value,parameter.normalizedValue,parameter.valueNormalized,parameter.normalized].find(value=>finite(value)&&Number(value)>=0&&Number(value)<=1);
    const min=parameter.min??parameter.minimum,max=parameter.max??parameter.maximum,range=parameter.range,contractNormalized=parameter.contractNormalized===true||range?.normalized===true,physicalLabel=[parameter.unit,parameter.label].some(value=>typeof value==='string'&&value.trim()),physicalText=[parameter.text,parameter.display_value,parameter.displayValue,parameter.display].some(value=>typeof value==='string'&&/[A-Za-z%]/.test(value));
    if(normalized===undefined&&contractNormalized&&finite(parameter.value)&&Number(parameter.value)>=0&&Number(parameter.value)<=1&&(range?.min==null||range.min===0)&&(range?.max==null||range.max===1))normalized=parameter.value;
    if(normalized===undefined&&parameter.contractNormalized!==false&&range?.normalized!==false&&finite(parameter.value)&&Number(parameter.value)>=0&&Number(parameter.value)<=1&&!physicalLabel&&!physicalText&&(!finite(min)&&!finite(max)||Number(min)===0&&Number(max)===1))normalized=parameter.value;
    return[{...parameter,index,name:parameter.name||parameter.label||`Parameter ${index}`,normalized:normalized===undefined?null:Number(normalized),display:parameter.display_value??parameter.displayValue??parameter.text??parameter.display??''}];
  });
}
export function pluginCatalog(state={}){
  const entries=new Map(NATIVE_PLUGIN_CATALOG.map(item=>[item.type,{...item,path:item.type,name:item.label,availability:'studio'}]));
  const tracks=list(state.tracks?.tracks||state.tracks),buses=list(state.buses?.buses||state.buses);
  for(const plugin of [...tracks,...buses].flatMap(item=>list(item.plugins))){
    const path=plugin.path||plugin.plugin_path;if(typeof path!=='string'||!path)continue;
    entries.set(path,{...entries.get(path),path,name:plugin.name||plugin.label||entries.get(path)?.name||'Loaded cloud plugin',category:entries.get(path)?.category||'Loaded in this session',availability:'loaded',kind:entries.get(path)?.kind||'plugin',hostGated:false});
  }
  return [...entries.values()].sort((a,b)=>(a.availability==='loaded'?0:1)-(b.availability==='loaded'?0:1)||a.name.localeCompare(b.name));
}

const copyChainJournal=new Map(),pluginMutationJournal=new Map();
// History instance aliases (project, lane, retired instance id) → re-created instance id.
const instanceAliases=new Map(),catalogCache=new Map(),afterWrites=new WeakMap();
const copyKey=(projectId,laneId)=>JSON.stringify([projectId,laneId]);
const copyAudioLane=lane=>['audio','vocal','guitar'].includes(lane?.kind);
const copyData=value=>value==null?value:structuredClone(value);
// A request Freestyle refused (4xx other than 408 / idempotency_in_progress)
// applied nothing. Lost responses, 408 and 5xx stay uncertain.
function definiteRejection(error){
 const status=error?.status;if(error?.operationUncertain===true||error?.code==='idempotency_in_progress'||status===408||status>=500)return false;
 return Number.isInteger(status)&&status>=400&&status<500||error?.explicitRejection===true;
}
// Round 13: pattern lanes have live mixer tracks too. Whether a lane has a live
// effect chain is data: listLanePlugins / addLanePlugin answer a fast 409
// lane_has_no_live_chain for a lane without one, and the server message says
// why. No lane kind or engine-mix inference. (target_not_loaded keeps meaning
// "not in the live session right now": an add is still sent and may load it.)
export const noLiveChain=error=>error?.status===409&&error?.code==='lane_has_no_live_chain';
const savedLaneChain=(saved,laneId)=>{const lane=list(saved?.lanes).find(item=>item?.id===laneId);return Array.isArray(lane?.pluginChain)?lane.pluginChain:null;};
export function noLiveChainMessage(target,detail,{added=false}={}){
 const name=target?.name?`“${target.name}”`:'This lane',reason=typeof detail==='string'&&detail.trim()?` ${detail.trim().replace(/\.?$/,'.')}`:'';
 return `${name} has no live mixer track in Freestyle yet, so it has no effect chain.${reason}${added?' No effect was added.':' Effects can’t be loaded on it until it does.'}`;
}
/** The single-call instance delete: removes the live slot and its saved-chain row (or a saved-only row) together. */
export function lanePluginInstanceDeleteRequest({projectId,laneId,instanceId,trackId}={}){
 for(const [value,label]of [[projectId,'project'],[laneId,'lane'],[instanceId,'plugin instance']])if(typeof value!=='string'||!value)throw new Error(`Select the exact ${label} before removing a plugin.`);
 return{operationId:'deleteLanePluginInstance',path:{project_id:projectId,lane_id:laneId,instance_id:instanceId},...(typeof trackId==='string'&&trackId?{query:{track_id:trackId}}:{})};
}
// 339: the documented instance_id pattern admits a lane default's fixed id (native_eq_default).
const RESTORE_INSTANCE=/^[A-Za-z0-9_-]{8,64}$/;
// The addLanePlugin body fields a delete's ready-made undo body may carry.
export const RESTORE_BODY_FIELDS=Object.freeze(['plugin_id','instance_id','position','bypassed','state','state_signature','parameters','preset']);
/** A lane plug-in delete answers removed.restore with a ready addLanePlugin undo
 * body. 339: that body (plugin_id, instance_id incl. native_eq_default, position,
 * bypassed, state + state_signature, parameters replayed after the state) is
 * forwarded UNCHANGED. Older replies without it are rebuilt from removed.restore;
 * a reply without removed.restore returns null (Undo then re-adds the type at its
 * slot with its bypass, without its settings). */
export function lanePluginRestoreArguments(result,fallbackType=null){
 const body=result?.structuredContent??result,removed=record(body?.removed)?body.removed:record(body?.response?.removed)?body.response.removed:null,restore=record(removed?.restore)?removed.restore:null;
 if(!restore)return null;const ready=record(restore.addLanePlugin)?restore.addLanePlugin:{};
 if(typeof ready.plugin_id==='string'&&ready.plugin_id)return Object.fromEntries(Object.entries(copyData(ready)).filter(([key,value])=>RESTORE_BODY_FIELDS.includes(key)&&value!==null&&value!==undefined));
 const pluginId=restore.typeId??removed.typeId??fallbackType,instance=restore.instanceId,position=restore.position,bypassed=restore.bypassed;
 // A hosted plug-in's state is accepted only with the signature the SAME delete returned
 // (400 restore_state_invalid otherwise): state and signature always travel as one pair,
 // from the ready-made body when it carries both, else from removed.restore. A native
 // effect's state is checked structurally (addLanePlugin has no params/native_eq fields).
 const pair={state:restore.state,signature:restore.stateSignature};
 if(typeof pluginId!=='string'||!pluginId)return null;
 const args={plugin_id:pluginId};
 // instance_id is re-used so automation and history references keep resolving.
 if(typeof instance==='string'&&RESTORE_INSTANCE.test(instance))args.instance_id=instance;
 if(Number.isInteger(position)&&position>=0&&position<=64)args.position=position;
 if(typeof bypassed==='boolean')args.bypassed=bypassed;
 if(typeof pair.state==='string'&&pair.state){args.state=pair.state;if(typeof pair.signature==='string'&&pair.signature)args.state_signature=pair.signature;}
 if(record(restore.parameters)&&Object.keys(restore.parameters).length)args.parameters=copyData(restore.parameters);
 return args;
}
/** Saved chain rows whose instance the live chain does not hold (FL "missing plugin"). */
export function savedOnlyChainRows(savedChain,livePlugins){
 if(!Array.isArray(savedChain)||!Array.isArray(livePlugins))return[];
 const live=new Set(livePlugins.map(identity).filter(Boolean));
 return savedChain.filter(row=>record(row)&&typeof row.pluginKey==='string'&&row.pluginKey&&!live.has(row.pluginKey)).map(row=>({pluginKey:row.pluginKey,type:typeof row.type==='string'?row.type:null,name:typeof row.name==='string'&&row.name?row.name:typeof row.type==='string'?row.type:'Missing plugin',position:Number.isInteger(row.position)?row.position:null,savedOnly:true}));
}
const stable=value=>JSON.stringify((function sorted(item){return Array.isArray(item)?item.map(sorted):record(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,sorted(item[key])])):item;})(value));
const nativeCopySignature=plugins=>plugins.map(plugin=>{const output={};for(const key of ['name','type_id','path','format','bypassed'])if(Object.hasOwn(plugin,key))output[key]=plugin[key];return output;});
const nativeCopyMatches=(before,after)=>before.length===after.length&&before.every((plugin,index)=>{const other=after[index];return (typeof plugin.type_id==='string'&&plugin.type_id||typeof plugin.path==='string'&&plugin.path)&&Object.entries(plugin).every(([key,value])=>other[key]===value);});
// Only an exact, complete canonical default take may omit engine context.
// Keep durable lane and nested effect-instance targets explicit.
function verifiedDefaultContext(saved,projectId,trackId){
 const metadata=saved?._studioApi;
 if(!record(metadata)||saved.id!==projectId||metadata.projectId!=null&&metadata.projectId!==projectId||!Array.isArray(saved.clips)||hasCanonicalTruncation(saved.clips)||saved.truncated?.clips===true||saved.clipsTruncated===true||saved.clips_truncated===true)return false;
 if(saved.clips.some(clip=>!clip||typeof clip.id!=='string'||!clip.id||clip.deleted!=null&&typeof clip.deleted!=='boolean'||clip.isBacking!=null&&typeof clip.isBacking!=='boolean'))return false;
 return saved.clips.find(clip=>!clip.deleted&&!clip.isBacking)?.id===trackId&&saved.clips.filter(clip=>clip.id===trackId).length===1;
}
const pluginType=plugin=>plugin?.type_id??plugin?.typeId??plugin?.type;
const loadedOrder=plugins=>plugins.map(plugin=>({instance:identity(plugin),type:pluginType(plugin)}));
function savedOrder(plugins){
 if(!Array.isArray(plugins)||hasCanonicalTruncation(plugins))throw new Error('Read the complete saved plugin order before moving a slot.');
 // 338: Freestyle renumbers saved positions densely (0..n-1) after every delete,
 // so colliding positions are an ambiguous chain again, never silently reordered.
 const keys=new Set(),positions=new Set();
 return plugins.map(plugin=>{
  const key=plugin?.instance_id??plugin?.instanceId??plugin?.pluginKey,position=plugin?.position??plugin?.chain_position??plugin?.index??plugin?.plugin_index,type=pluginType(plugin);
  if(!record(plugin)||typeof key!=='string'||!key||keys.has(key)||!Number.isInteger(position)||position<0||position>64||positions.has(position)||typeof type!=='string'||!type)throw new Error('The saved plugin order has ambiguous identities, types or chain positions.');
  keys.add(key);positions.add(position);return {key,type,position,...plugin.instance_id!=null||plugin.instanceId!=null?{instance:plugin.instance_id??plugin.instanceId}:{}};
 }).sort((a,b)=>a.position-b.position).map(({position,...plugin})=>plugin);
}
const reordered=(rows,from,to)=>{const next=copyData(rows),[moved]=next.splice(from,1);next.splice(to,0,moved);return next;};

export class MixerToolsController {
  constructor({project,channel,call=defaultCall,action,onChanged,onError,liveControl=null,history=null,historyController=null,onChainChanged=null,chainPreview=null,assertScope=()=>{},assertCurrent=null,copyJournal=copyChainJournal,operations=STUDIO_API_OPERATIONS,mutationJournal=pluginMutationJournal,fetch:fetchImpl=(...args)=>hostFetch(...args),inventory=null,liveLaneIds=null}={}){
    this.history=history&&typeof history.beginExternalStep==='function'?history:null;this.historyController=typeof historyController==='function'?historyController:null;this.historyDepth=0;this.onChainChanged=typeof onChainChanged==='function'?onChainChanged:null;this.chainPreview=typeof chainPreview==='function'?chainPreview:null;
    this.project=project;this.liveLaneIds=typeof liveLaneIds==='function'?liveLaneIds:null;this.inventory=inventory&&typeof inventory.scope==='function'&&inventory.cache?inventory:null;this.projectId=project?.cloud?.projectId||project?.id;this.contextTrackId=project?.cloud?.trackId;
    if(!this.projectId||!this.contextTrackId)throw new Error('Load a Freestyle project before opening its mixer tools.');
    this.assertScope=assertScope;this.assertCurrent=typeof assertCurrent==='function'?assertCurrent:null;this.rawCall=async(name,args,options)=>{this.assertScope();const result=await call(name,args,options);this.assertScope();return result;};this.call=async(name,args,options)=>unpackMixerResult(await this.rawCall(name,args,options));this.action=action;this.onChanged=onChanged;this.onError=onError;this.fetch=fetchImpl;this.liveControl=liveControl;this.parameterWrites={pending:new Map(),inflight:new Map(),chain:Promise.resolve()};
    this.state=project.cloud.rawState||{};this.channel=channel;this.target=channel?.id==='master'||channel?.type==='bus'||channel?.kind==='bus'||!channel?{kind:'bus',id:channel?.busId||channel?.bus_id||channel?.id||'master'}:{kind:'lane',id:channel?.laneId||channel?.cloudTrackId||(!channel?.patternSource?channel?.id:'')};
    this.operations=new Set(operations instanceof Set?operations:Object.keys(operations));this.mutationJournal=mutationJournal;this.pluginMutation=mutationJournal.get(copyKey(this.projectId,this.target.id))||null;this.catalogLoaded=false;this.copyJournal=copyJournal;this.copySources=null;this.copyReview=null;this.copyReceipt=copyJournal.get(copyKey(this.projectId,this.target.id))||null;
    this.parameterRetryMs=PARAMETER_READ_RETRY_MS;this.plugins=[];this.parameters=[];this.catalog=pluginCatalog(this.state);this.selectedIndex=null;this.readGeneration=0;this.parameterGeneration=0;this.parameterState=null;this.parameterPending=null;this.pluginListGeneration=0;this.busy=false;this.tab='slots';
  }
  get isRestMode(){return this.project?.cloud?.rawState?.studioApi===true;}
  /** Lane ids the live engine mix lists, or null when no live mix is known (diagnostics only). */
  liveIds(){let ids=null;try{ids=this.liveLaneIds?.();}catch{ids=null;}return ids instanceof Set&&ids.size>0?ids:null;}
  /** Data-driven: true only after Freestyle answered 409 lane_has_no_live_chain for this lane. */
  get liveChainMissing(){return this.isRestMode&&this.target.kind==='lane'&&this.notLiveTarget===this.target.id;}
  get noLiveChainNotice(){return this.liveChainMissing?noLiveChainMessage(this.targetInfo,this.noLiveChainDetail):'';}
  /** Saved-chain rows with no live instance, once this lane's live chain was read. */
  savedOnlyPlugins(){if(!this.isRestMode||this.target.kind!=='lane'||this.liveChainRead!==this.target.id)return[];return savedOnlyChainRows(savedLaneChain(this.savedProject,this.target.id),this.plugins);}
  markNoLiveChain(laneId,error){this.notLiveTarget=laneId;this.noLiveChainDetail=typeof error?.message==='string'?error.message:null;if(this.liveChainRead===laneId)this.liveChainRead=null;clientLog('plugin-lane-no-live-chain',{laneId,code:error?.code??null});}
  get canLoadPlugin(){return !this.isRestMode||this.operations.has('listPluginCatalog')&&this.operations.has(this.target.kind==='lane'?'addLanePlugin':'addBusPlugin');}
  get canCopyChain(){return this.isRestMode&&this.target.kind==='lane'&&copyAudioLane(this.targetInfo?.raw);}
  get canMovePlugin(){return !this.isRestMode||(this.target.kind==='lane'?['moveLanePlugin','listLanePlugins','getSavedLanePluginState'].every(name=>this.operations.has(name)):this.operations.has('moveBusPlugin'));}
  get canRemovePlugin(){return !this.isRestMode||this.operations.has(this.target.kind==='lane'?'deleteLanePluginInstance':'deleteBusPlugin');}
  get canEditLaneTopology(){return this.canMovePlugin&&this.canRemovePlugin;}
  context(){const args={project_id:this.projectId,track_id:this.contextTrackId};if(this.isRestMode&&verifiedDefaultContext(this.savedProject||this.project.cloud.rawProject,this.projectId,this.contextTrackId))delete args.track_id;return args;}
  targets(){
    const lanes=list((this.savedProject||this.project.cloud.rawProject)?.lanes).map(lane=>({kind:'lane',id:String(lane.id),name:lane.name||'Cloud lane',raw:lane}));
    const buses=list(this.state.buses?.buses||this.state.buses).map(bus=>({kind:'bus',id:String(bus.bus_id||bus.id),name:bus.label||bus.name||'Cloud bus',raw:bus}));
    return [...lanes,...buses];
  }
  get targetInfo(){return this.targets().find(target=>target.kind===this.target.kind&&target.id===this.target.id);}
  get runtimeTrack(){if(this.isRestMode)return undefined;const matches=list(this.state.tracks?.tracks||this.state.tracks).filter(track=>track.db_track_id!=null&&String(track.db_track_id)===this.target.id);return matches.length===1?matches[0]:undefined;}
  async restLane(target,current){
    const saved=await this.call('get_project',{project_id:this.projectId});current();
    const lanes=saved?.lanes,lanesPartial=saved?.truncated?.lanes===true||saved?.lanesTruncated===true||saved?.lanes_truncated===true;
    if(saved?.id!==this.projectId||!Array.isArray(lanes)||lanesPartial||partial(lanes)||saved._truncated===true&&saved?.truncated?.lanes!==false||saved.truncated===true)throw new Error('Read the complete saved Studio API lanes before editing effects.');
    const matches=lanes.filter(lane=>lane?.id===target.id);if(matches.length!==1)throw new Error('The selected saved Studio API lane is missing or ambiguous.');
    this.savedProject=saved;return matches[0];
  }
  /**
   * Live lane plugin inventory. Display reads (`cached`) may reuse the shared
   * prewarmed/in-flight result for the same load and saved chain; every other
   * read (edits, explicit Refresh) goes to Freestyle and refreshes the cache.
   */
  listLanePlugins(laneId,{cached=false}={}){
    // 339: listLanePlugins answers within 250 ms; when it had to answer from the
    // engine's last known chain it says stale:true (top level or in the response).
    const args={...this.context(),lane_id:laneId},load=()=>this.call('list_plugins',args),cache=this.inventory?.cache;
    if(!this.isRestMode||!cache)return load();
    const lane=list(this.savedProject?.lanes||this.project?.cloud?.rawProject?.lanes).find(item=>item?.id===laneId);
    return cache.read({...this.inventory.scope(),laneId,chain:lane?.pluginChain},load,{fresh:!cached}).then(result=>{this.assertScope();return result;});
  }
  async refresh({readParameters=true,cached=false}={}){
    const selected=identity(this.plugins.find(plugin=>plugin.index===this.selectedIndex)),target={...this.target},generation=++this.readGeneration;
    if(readParameters||!this.isRestMode)this.invalidateParameters();
    const current=()=>{if(generation!==this.readGeneration||target.kind!==this.target.kind||target.id!==this.target.id)throw Object.assign(new Error('A newer plugin selection superseded this mixer refresh.'),{code:'plugin_read_superseded'});};
    if(!this.isRestMode){const state=await this.call('get_pro_state',this.context());current();this.state=state;}if(!this.isRestMode)this.catalog=pluginCatalog(this.state);
    if(this.isRestMode){await this.refreshPlugins({cached});current();}
    if(!this.targetInfo){this.plugins=[];this.invalidateParameters();this.selectedIndex=null;return this;}
    if(!this.isRestMode){await this.refreshPlugins();current();}
    if(selected){const plugin=this.plugins.find(item=>identity(item)===selected);this.selectedIndex=plugin?.index??null;}
    else if(!this.plugins.some(plugin=>plugin.index===this.selectedIndex))this.selectedIndex=null;
    if(this.selectedIndex!==null&&readParameters)await this.readPlugin(this.selectedIndex);
    return this;
  }
  async setTarget(kind,id){if(this.busy)throw new Error('Wait for the current cloud mixer edit to finish.');this.target={kind,id};this.catalogLoaded=false;this.pluginMutation=this.mutationJournal.get(copyKey(this.projectId,id))||null;this.copySources=null;this.copyReview=null;this.copyReceipt=this.copyJournal.get(copyKey(this.projectId,id))||null;this.readGeneration++;this.invalidateParameters();this.selectedIndex=null;this.plugins=[];this.parameters=[];this.snapshot=null;this.effectPresetNames=null;await this.refreshPlugins();return this;}
  async refreshPlugins({cached=false,staleReread=false}={}){
    const target={...this.target},generation=++this.pluginListGeneration;
    const current=()=>{if(generation!==this.pluginListGeneration||target.kind!==this.target.kind||target.id!==this.target.id)throw Object.assign(new Error('A newer mixer target superseded this plugin list. Read the current target again.'),{code:'plugin_read_superseded'});};
    let plugins,rawPlugins;
    if(target.kind==='lane'&&target.id){
      // The saved lane (revision) and the live list are independent reads: run them together.
      const savedRead=this.isRestMode?this.restLane(target,current).then(()=>null,error=>error):null;
      const listed=this.listLanePlugins(target.id,{cached}).then(value=>({value}),error=>({error}));
      if(savedRead){const error=await savedRead;if(error){await listed;throw error;}}
      let result;const answer=await listed;
      if(answer.error){const error=answer.error;if(!this.isRestMode||!noLiveChain(error))throw error;current();this.markNoLiveChain(target.id,error);result={lane_id:target.id,plugins:[],noLiveChain:true};}else result=answer.value;
      current();
      if(this.isRestMode&&!result.noLiveChain){
        if(result.lane_id!==target.id||result.projectId!=null&&result.projectId!==this.projectId||result.project_id!=null&&result.project_id!==this.projectId||!Array.isArray(result.plugins)||partial(result))throw new Error('Studio API did not return this lane’s complete plugin chain.');
        const indexes=new Set(),instances=new Set();for(const plugin of result.plugins){const index=plugin?.index??plugin?.plugin_index,instance=identity(plugin);if(!record(plugin)||!Number.isInteger(index)||index<0||index>64||indexes.has(index)||typeof instance!=='string'||!instance||instances.has(instance))throw new Error('Studio API returned ambiguous plugin slot identities.');indexes.add(index);instances.add(instance);}
      }
      rawPlugins=result.plugins;plugins=normalizeLoadedPlugins(rawPlugins);
      // A successful list is the live chain (round 13: pattern lanes are hosted too).
      // A stale list is shown like any other; ONE background re-read follows (never a loop).
      this.pluginListStale=result.stale===true;if(this.pluginListStale&&!staleReread)setTimeout(()=>{if(target.kind===this.target.kind&&target.id===this.target.id)this.refreshPlugins({staleReread:true}).then(()=>{try{this.onChainChanged?.({laneId:target.id,plugins:copyData(this.plugins),savedOnly:this.savedOnlyPlugins?.()??null});}catch{}try{this.onStaleReread?.();}catch{}}).catch(()=>{});},0);
      if(this.isRestMode&&!result.noLiveChain){this.liveChainRead=target.id;if(this.notLiveTarget===target.id){this.notLiveTarget=null;this.noLiveChainDetail=null;}reconcilePluginWindows({projectId:this.projectId,laneId:target.id,plugins:rawPlugins});}
    }else{
      if(this.isRestMode){if(!this.operations.has('engine_list_buses'))throw unavailable('Live bus plugin inspection');const state=await this.invokeAction('list_buses',{});current();const buses=Array.isArray(state.buses)?state.buses:Array.isArray(state)?state:null;if(!buses||partial(state))throw new Error('Read the complete live mixer buses before editing their plugins.');const matches=buses.filter(bus=>String(bus.bus_id??bus.id)===target.id);if(matches.length!==1||!Array.isArray(matches[0].plugins))throw new Error('This bus has no unique live plugin chain.');const seen=new Set(),instances=new Set();for(const plugin of matches[0].plugins){const index=plugin.index??plugin.plugin_index,id=identity(plugin);if(!Number.isInteger(index)||index<0||index>64||seen.has(index)||!id||instances.has(id))throw new Error('The bus plugin chain has ambiguous slot identities.');seen.add(index);instances.add(id);}this.state={...this.state,buses:{ok:true,live:true,buses}};rawPlugins=matches[0].plugins;plugins=normalizeLoadedPlugins(rawPlugins);
      }else{
      // Bus plugin indexes and identities must come from the live bus metadata.
      rawPlugins=this.targetInfo?.raw?.plugins;plugins=normalizeLoadedPlugins(rawPlugins);
      }
    }
    current();
    this.savedSlotIndex=null;this.knownBypassIndexes=new Set(list(rawPlugins).filter(plugin=>typeof plugin.bypassed==='boolean').map(plugin=>plugin.index??plugin.plugin_index));this.plugins=plugins;if(this.parameterState?.scope){const scope=this.parameterState.scope,current=plugins.filter(plugin=>plugin.index===scope.index);if(scope.target.kind!==this.target.kind||scope.target.id!==this.target.id||current.length!==1||identity(current[0])!==scope.instance)this.invalidateParameters('The selected plugin changed. Read its parameters again.');}return this.plugins;
  }
  get parameterPagination(){
    const state=this.parameterState,total=Number.isInteger(state?.summary?.parameterCount)&&state.summary.parameterCount>=0?state.summary.parameterCount:null;
    return{loaded:this.parameters.length,total:this.isRestMode?total:this.parameters.length,hasMore:!!state?.hasMore,nextCursor:state?.nextCursor??null,busy:!!this.parameterPending||state?.status==='loading',invalid:!!state?.invalid,error:state?.error??null,stale:this.parameters.filter(parameter=>parameter.stale).length,complete:!this.isRestMode||!!state&&state.status==='ready'&&!state.invalid&&!this.parameterPending&&!state.hasMore&&!state.pages.some(page=>page.stale)};
  }
  invalidateParameters(message=null){this.parameterGeneration++;this.parameterPending=null;this.parameters=[];this.snapshot=null;this.parameterState=message?{scope:null,summary:null,pages:[],hasMore:false,nextCursor:null,status:'invalid',invalid:true,error:message}:null;}
  /** display: true checks only that the page still belongs to this open
   * project/plugin (assertCurrent). Showing the loaded controls must not depend
   * on the workspace being idle; every read and write keeps the full guard. */
  assertParameterScope(state,{display=false}={}){
    if(display&&this.assertCurrent)this.assertCurrent();else this.assertScope();const scope=state?.scope,current=this.plugins.filter(plugin=>plugin.index===scope?.index);
    if(!scope||this.parameterState!==state||state.invalid||scope.generation!==this.parameterGeneration||scope.projectId!==this.projectId||scope.contextTrackId!==this.contextTrackId||scope.target.kind!==this.target.kind||scope.target.id!==this.target.id||this.selectedIndex!==scope.index||current.length!==1||identity(current[0])!==scope.instance)throw Object.assign(new Error('The selected plugin changed while its parameter page was loading. Read the current plugin again.'),{code:'plugin_read_superseded'});
  }
  parameterFailure(state,error){if(this.parameterState===state){state.invalid=true;state.status='invalid';state.error=error.message;state.hasMore=false;state.nextCursor=null;this.parameters=[];this.snapshot=null;}}
  async fetchParameterPage(state,cursor){
    this.assertParameterScope(state);const scope=state.scope,operation=scope.target.kind==='lane'?'list_lane_plugin_parameters':'list_bus_plugin_parameters';
    const args={project_id:scope.projectId,track_id:scope.contextTrackId,...(scope.target.kind==='lane'?{lane_id:scope.target.id}:{bus_id:scope.target.id}),plugin_index:scope.index,limit:200,...(cursor?{cursor}:{})},log={target:scope.target.kind,targetId:scope.target.id,pluginIndex:scope.index,instance:scope.instance,cursor:!!cursor};
    // The first read after a project/engine load can fail transiently ("The live engine couldn't apply that"); retry this GET a few times.
    let data;for(let attempt=0;;attempt++){const started=Date.now();try{data=await this.call(operation,args);clientLog('plugin-param-page',{...log,attempt,ms:Date.now()-started,rows:Array.isArray(data?.data)?data.data.length:null,total:data?.plugin?.parameterCount??null,hasMore:data?.pagination?.hasMore??null,summaryInstance:data?.plugin?.instanceId??null});break;}
      catch(error){const retry=attempt<this.parameterRetryMs.length&&transientEngineRead(error);clientLog('plugin-param-page-error',{...log,attempt,ms:Date.now()-started,status:error?.status??null,code:error?.code??null,stage:error?.stage??null,message:String(error?.message||'').slice(0,200),retry});if(!retry)throw error;
        const wait=Math.min(5000,Number.isFinite(Number(error?.retryAfterSec))&&Number(error.retryAfterSec)>0?Number(error.retryAfterSec)*1000:this.parameterRetryMs[attempt]);await new Promise(resolve=>setTimeout(resolve,wait));this.assertParameterScope(state);}}
    this.assertParameterScope(state);const summary=data.plugin;
    if(data.projectId!==scope.projectId||(scope.target.kind==='lane'?data.laneId!==scope.target.id:data.busId!==scope.target.id)||!record(summary)||summary.index!==scope.index||typeof summary.name!=='string'||!Array.isArray(data.data)||data.data.length>200||typeof data.pagination?.hasMore!=='boolean'||partial(data))throw new Error('Studio API did not return this exact plugin’s bounded parameter page.');
    if(scope.savedSlot&&summary.instanceId!==scope.instance)throw new Error('The saved plugin slot no longer holds this instance. Refresh the plugin chain.');
    if(summary.instanceId!=null&&summary.instanceId!==scope.instance)throw new Error('The selected plugin instance changed while its parameters were loading.');
    if(state.summary&&['index','instanceId','typeId','parameterCount'].some(key=>stable(state.summary[key])!==stable(summary[key])))throw new Error('The selected plugin changed between parameter pages.');
    const seen=new Set(),ids=new Set(),rows=data.data.map(parameter=>{if(!record(parameter)||typeof parameter.id!=='string'||!parameter.id||!Number.isInteger(parameter.index)||parameter.index<0||seen.has(parameter.index)||ids.has(parameter.id)||!record(parameter.range))throw new Error('Studio API returned an ambiguous or incomplete typed plugin parameter.');seen.add(parameter.index);ids.add(parameter.id);return{...copyData(parameter),contractNormalized:parameter.range.normalized===true};});
    const hasMore=data.pagination.hasMore,nextCursor=data.pagination.nextCursor;
    if(hasMore&&(typeof nextCursor!=='string'||!nextCursor||nextCursor.length>512||nextCursor===cursor||!rows.length)||!hasMore&&nextCursor!=null)throw new Error('Studio API returned an invalid parameter continuation.');
    return{cursor:cursor??null,nextCursor:nextCursor??null,hasMore,summary:copyData(summary),rows,stale:false};
  }
  adoptParameterPages(state){
    this.assertParameterScope(state);const seen=new Set(),ids=new Set(),rows=[];
    for(const page of state.pages)for(const row of page.rows){if(seen.has(row.index)||ids.has(row.id))throw new Error('Studio API repeated a parameter across pages. Read the plugin again.');seen.add(row.index);ids.add(row.id);rows.push({...copyData(row),stale:!!page.stale});}
    const last=state.pages.at(-1),total=state.summary?.parameterCount;if(Number.isInteger(total)&&(rows.length>total||!last.hasMore&&rows.length!==total))throw new Error('Studio API returned an incomplete parameter count.');
    state.hasMore=last.hasMore;state.nextCursor=last.nextCursor;state.status='ready';this.parameters=normalizePluginParameters({parameters:rows});
    const summary=state.summary;this.snapshot={...copyData(summary),plugin_loaded:true,plugin_index:summary.index,parameter_count:summary.parameterCount??null,parameters_loaded:rows.length,parameters_complete:!state.hasMore&&!state.pages.some(page=>page.stale),parameters:rows,...(Number.isInteger(summary.programCount)?{program_count:summary.programCount}:{}),...(Number.isInteger(summary.currentProgram?.index)?{current_program_index:summary.currentProgram.index}:{})};
    return{plugin:this.plugins.find(plugin=>plugin.index===state.scope.index),snapshot:this.snapshot,parameters:this.parameters,pagination:this.parameterPagination};
  }
  loadMoreParameters(){
    if(this.parameterPending?.kind==='more')return this.parameterPending.promise;
    const state=this.parameterState;if(this.parameterPending||state?.status==='loading'||this.busy)return Promise.reject(new Error('Wait for the current parameter request.'));if(!state||state.invalid)return Promise.reject(new Error('Read the selected plugin before loading more parameters.'));
    try{this.assertParameterScope(state);}catch(error){return Promise.reject(error);}if(!state.hasMore)return Promise.resolve({parameters:this.parameters,pagination:this.parameterPagination});
    const cursor=state.nextCursor;if(state.pages.length>=100||state.pages.some(page=>page.cursor===cursor))return Promise.reject(new Error('Read a new parameter list before continuing this cursor.'));
    const pending={kind:'more',promise:null};pending.promise=(async()=>{try{const page=await this.fetchParameterPage(state,cursor);if(page.hasMore&&state.pages.some(existing=>existing.cursor===page.nextCursor))throw new Error('Studio API repeated a parameter continuation.');state.summary=page.summary;state.pages.push(page);const result=this.adoptParameterPages(state);return{...result,pagination:{...result.pagination,busy:false}};}catch(error){this.parameterFailure(state,error);throw error;}finally{if(this.parameterPending===pending)this.parameterPending=null;}})();this.parameterPending=pending;return pending.promise;
  }
  async refreshParameterPage(index){
    const state=this.parameterState;this.assertParameterScope(state);const page=state.pages.find(page=>page.rows.some(row=>row.index===index));if(!page)throw new Error('Read the parameter’s page before editing it.');
    for(const current of state.pages)current.stale=true;this.adoptParameterPages(state);const pending={kind:'reload',promise:null};pending.promise=(async()=>{try{const fresh=await this.fetchParameterPage(state,page.cursor);if(stable(fresh.rows.map(row=>[row.index,row.id]))!==stable(page.rows.map(row=>[row.index,row.id])))throw new Error('The parameter identities changed after the edit. Read the plugin again.');state.summary=fresh.summary;state.pages=state.pages.map(current=>current===page||current.cursor===page.cursor?fresh:{...current,stale:true});const result=this.adoptParameterPages(state);return{...result,pagination:{...result.pagination,busy:false}};}catch(error){this.parameterFailure(state,error);throw error;}finally{if(this.parameterPending===pending)this.parameterPending=null;}})();this.parameterPending=pending;return pending.promise;
  }
  /** Re-read EVERY loaded parameter page, coalesced: one pass in flight; any
   * request made meanwhile runs exactly one more pass afterwards, and only the
   * newest pass is adopted. Rapid ⌘Z/⌘⇧Z therefore end on the values of the
   * latest confirmed step, never on an "Inspect" (stale) list. `whenIdle`
   * (the newest caller's) is awaited before each pass: the window's reads are
   * refused while a history step still runs, so a pass starts only after it. */
  refreshParameters({whenIdle=null}={}){
    const queue=this.parameterRefresh||=(this.parameterRefresh={running:null,again:false,waiters:[],sequence:0,whenIdle:null});if(typeof whenIdle==='function')queue.whenIdle=whenIdle;
    const promise=new Promise((resolve,reject)=>queue.waiters.push({resolve,reject}));promise.catch(()=>{});
    if(queue.running){queue.again=true;return promise;}
    const run=async()=>{
     for(;;){
      queue.again=false;const waiters=queue.waiters.splice(0),pass=++queue.sequence;let result,failure;
      try{if(queue.whenIdle)await queue.whenIdle();if(queue.again){queue.waiters.unshift(...waiters);continue;}result=await this.refreshAllPages(pass);}catch(error){failure=error;}
      if(queue.again&&!failure){queue.waiters.unshift(...waiters);continue;}
      for(const waiter of waiters)failure?waiter.reject(failure):waiter.resolve(result);
      if(!queue.again)return;
     }
    };
    queue.running=run().finally(()=>{queue.running=null;});return promise;
  }
  async refreshAllPages(pass){
    const state=this.parameterState;this.assertParameterScope(state);if(!state.pages.length)throw new Error('Read the plugin’s parameters first.');
    // A single-parameter write in flight owns the page; wait for it instead of racing it.
    if(this.parameterPending)await this.parameterPending.promise.catch(()=>{});this.assertParameterScope(state);
    const pages=[];for(const page of state.pages){const fresh=await this.fetchParameterPage(state,page.cursor);if(stable(fresh.rows.map(row=>[row.index,row.id]))!==stable(page.rows.map(row=>[row.index,row.id])))throw new Error('The parameter identities changed. Read the plugin again.');pages.push(fresh);}
    this.assertParameterScope(state);if(pass!==this.parameterRefresh?.sequence)return{parameters:this.parameters,pagination:this.parameterPagination,superseded:true};
    state.summary=pages.at(-1).summary;state.pages=pages;const result=this.adoptParameterPages(state);return{...result,pagination:{...result.pagination,busy:false}};
  }
  /** One unpaginated read (getLanePluginState) of every parameter's normalized
   * value, pinned to this instance: covers pages the dialog never loaded. */
  async readAllParameterValues(plugin){
    if(this.target.kind!=='lane')throw new Error('Plugin state reads are lane-scoped.');
    const data=await this.call('get_plugin_state',{...this.context(),lane_id:this.target.id,plugin_index:plugin.index,include_parameters:true}),body=data?.snapshot||data?.state||data;
    const instance=body?.instance_id??body?.instanceId??data?.instance_id??data?.instanceId;if(typeof instance==='string'&&instance&&instance!==identity(plugin))throw Object.assign(new Error('This plugin slot now holds a different plugin.'),{code:'plugin_instance_mismatch'});
    return normalizePluginParameters(data).filter(row=>finite(row.normalized)).map(row=>({index:row.index,id:row.stable_param_id??row.id??null,name:row.name,value:Number(row.normalized)}));
  }
  async readPlugin(index){
    const matches=this.plugins.filter(item=>item.index===index),plugin=matches[0];if(matches.length!==1)throw new Error('Select a plugin with one unique live slot index.');
    const target={...this.target},generation=++this.readGeneration,instance=identity(plugin);this.invalidateParameters();this.selectedIndex=index;
    if(this.isRestMode){
      if(!this.operations.has(target.kind==='lane'?'listLanePluginParameters':'listBusPluginParameters'))throw unavailable('Typed plugin parameter discovery');
      const state={scope:{projectId:this.projectId,contextTrackId:this.contextTrackId,target,index,instance,generation:this.parameterGeneration,...(this.savedSlotIndex===index?{savedSlot:true}:{})},summary:null,pages:[],status:'loading',hasMore:false,nextCursor:null,invalid:false,error:null};this.parameterState=state;
      try{const page=await this.fetchParameterPage(state,null);state.summary=page.summary;state.pages=[page];return this.adoptParameterPages(state);}catch(error){this.parameterFailure(state,error);throw error;}
    }
    const data=target.kind==='lane'?await this.call('get_plugin_state',{...this.context(),lane_id:target.id,plugin_index:index,include_parameters:true}):plugin,current=this.plugins.filter(item=>item.index===index);
    if(generation!==this.readGeneration||target.kind!==this.target.kind||target.id!==this.target.id||current.length!==1||identity(current[0])!==instance)throw Object.assign(new Error('The selected plugin changed while its parameters were being read. Select the current plugin again.'),{code:'plugin_read_superseded'});
    this.snapshot=data.snapshot||data.state||data.plugin||data;this.parameters=normalizePluginParameters(data);return{plugin,snapshot:this.snapshot,parameters:this.parameters};
  }
  /** True when a settled shared inventory exists for this lane's current load and saved chain. */
  hasFreshInventory(laneId=this.target.id){const cache=this.inventory?.cache;if(!this.isRestMode||!cache)return false;const lane=list(this.savedProject?.lanes||this.project?.cloud?.rawProject?.lanes).find(item=>item?.id===laneId);return !!cache.peek({...this.inventory.scope(),laneId,chain:lane?.pluginChain});}
  /**
   * Read-only fast path when no live inventory is cached: adopt one saved-chain
   * slot so its typed parameter page can load (~1 s) instead of waiting for
   * listLanePlugins (~30 s measured). The page summary must echo this exact
   * index and instance id or nothing is shown; edits still call ensurePlugin.
   */
  adoptSavedSlot(plugin){
    if(!this.isRestMode||this.target.kind!=='lane'||this.plugins.length||plugin?.savedChain!==true||!Number.isInteger(plugin.index)||plugin.index<0||!identity(plugin))return false;
    this.plugins=normalizeLoadedPlugins([plugin]);this.savedSlotIndex=plugin.index;return true;
  }
  /**
   * Read-only: adopt the slot from a chain the app already confirmed (a write
   * receipt or its own just-made read) instead of re-reading the chain. Same
   * guard as adoptSavedSlot: the parameter page summary must echo this index
   * and instance id; a confirmed chain without this exact slot throws (no
   * read). Edits still call ensurePlugin/verifySlot.
   */
  adoptConfirmedSlot(plugin,chain){
    if(!this.isRestMode||this.target.kind!=='lane'||this.plugins.length||!Number.isInteger(plugin?.index)||plugin.index<0||!identity(plugin))return false;
    // The confirmed chain no longer holds this slot (e.g. a queued read for a just-deleted device): fail without a read.
    const match=list(chain).filter(item=>item?.index===plugin.index);if(match.length!==1||identity(match[0])!==identity(plugin))throw Object.assign(new Error('This plugin slot changed in Freestyle. Refresh and select the plugin again before editing it.'),{code:'plugin_read_superseded'});
    this.plugins=normalizeLoadedPlugins([match[0]]);this.savedSlotIndex=plugin.index;return true;
  }
  /**
   * Fast slot identity guard for REST lane edits and the native editor open: a
   * fresh saved-lane read (revision for If-Match) plus a 1-row typed parameter
   * page whose plugin summary must report this exact slot index and instance id.
   * Measured ~0.3 s + ~0.8 s, versus ~30 s for listLanePlugins. The Studio API's
   * parameter write and editor open accept no expected-instance precondition
   * (only moveLanePlugin does), so this read is the guard; see the Engine/API request issues.
   */
  async verifySlot(plugin){
    if(!this.isRestMode||this.target.kind!=='lane'||!this.operations.has('listLanePluginParameters'))return this.ensurePlugin(plugin);
    const index=plugin?.index,instance=identity(plugin),target={...this.target};
    if(!Number.isInteger(index)||index<0||!instance)throw new Error('Select a plugin with an exact live slot and instance before editing it.');
    const changed=()=>new Error('This plugin slot changed in Freestyle. Refresh and select the plugin again before editing it.');
    await this.restLane(target,()=>{if(target.kind!==this.target.kind||target.id!==this.target.id)throw changed();});
    let data;for(let attempt=0;;attempt++){try{data=await this.call('list_lane_plugin_parameters',{...this.context(),lane_id:target.id,plugin_index:index,limit:1});break;}catch(error){const retry=attempt<this.parameterRetryMs.length&&transientEngineRead(error);clientLog('plugin-slot-probe-error',{laneId:target.id,pluginIndex:index,attempt,status:error?.status??null,code:error?.code??null,message:String(error?.message||'').slice(0,200),retry});if(!retry)throw error;await new Promise(resolve=>setTimeout(resolve,this.parameterRetryMs[attempt]));if(target.id!==this.target.id)throw changed();}}
    const summary=data?.plugin;clientLog('plugin-slot-probe',{laneId:target.id,pluginIndex:index,expected:instance,reported:summary?.instanceId??null,match:summary?.instanceId===instance});
    if(target.id!==this.target.id||data?.projectId!==this.projectId||data?.laneId!==target.id||!record(summary)||summary.index!==index)throw new Error('Studio API did not confirm this exact plugin slot.');
    if(summary.instanceId!==instance||typeof plugin.type_id==='string'&&summary.typeId!=null&&summary.typeId!==plugin.type_id)throw changed();
    const current=this.plugins.filter(item=>item.index===index);
    if(!current.length)this.plugins=normalizeLoadedPlugins([...this.plugins,plugin]);else if(current.length!==1||identity(current[0])!==instance)throw changed();
    return this.plugins.find(item=>item.index===index);
  }
  /** `cached` is for read-only opening (parameter discovery); edits always verify the live slot. */
  async ensurePlugin(plugin,{cached=false}={}){
    const originalIdentity=identity(plugin);
    if(this.target.kind==='bus'&&!this.isRestMode){this.state=await this.call('get_pro_state',this.context());}
    await this.refreshPlugins({cached});
    const candidates=this.plugins.filter(item=>plugin.index===null?identity(item)===originalIdentity:item.index===plugin.index),current=candidates[0];
    if(candidates.length!==1||!current||!originalIdentity||identity(current)!==originalIdentity)throw new Error('This plugin slot changed in Freestyle. Refresh and select the plugin again before editing it.');
    return current;
  }
  async invokeAction(name,args,{destructive=false,...requestOptions}={}){
    if(this.action&&!this.isRestMode)return unpackMixerResult(await this.action(name,args,{refresh:false,confirmedDestructive:destructive}));
    return this.call('execute_pro_action',{...this.context(),action:name,arguments:args,...(destructive?{confirmed_destructive:true}:{})},requestOptions);
  }
  async copyProject(){
    const project=await this.call('get_project',{project_id:this.projectId}),lanes=project?.lanes;
    if(project?.id!==this.projectId||!Array.isArray(lanes)||partial(lanes)||project.truncated?.lanes!==false&&partial(project))throw new Error('Read the complete saved tracks before copying a chain.');
    const ids=new Set();for(const lane of lanes){if(typeof lane?.id!=='string'||!lane.id||lane.id.length>64||ids.has(lane.id))throw new Error('Saved track identities are missing or ambiguous.');ids.add(lane.id);}
    const etag=project._studioApi?.etag;if(typeof etag!=='string'||!etag||/[\u0000-\u001f\u007f]/.test(etag))throw new Error('Read a fresh project revision before copying its chain.');
    this.savedProject=project;return project;
  }
  async copySaved(laneId){
    const state=await this.call('get_saved_plugin_state',{project_id:this.projectId,lane_id:laneId});
    if(state?.projectId!==this.projectId||state.laneId!==laneId||!Array.isArray(state.plugins)||partial(state)||state.plugins.some(plugin=>!record(plugin)))throw new Error('Read the complete saved plugin chain for this exact track.');
    return copyData(state.plugins);
  }
  async copyNative(laneId){
    const state=await this.call('list_plugins',{...this.context(),lane_id:laneId});
    if(state?.lane_id!==laneId||!Array.isArray(state.plugins)||partial(state))throw new Error('Read this track’s complete loaded plugin chain.');
    const slots=new Set(),instances=new Set();for(const plugin of state.plugins){const index=plugin?.index??plugin?.plugin_index,instance=identity(plugin);if(!record(plugin)||!Number.isInteger(index)||index<0||index>64||slots.has(index)||typeof instance!=='string'||!instance||instances.has(instance))throw new Error('The loaded plugin chain has ambiguous slot identities.');slots.add(index);instances.add(instance);}
    return copyData(state.plugins).sort((a,b)=>(a.index??a.plugin_index)-(b.index??b.plugin_index));
  }
  async copyDestinationNative(laneId){
    try{return await this.copyNative(laneId);}catch(error){if(error.status===409&&error.code==='target_not_loaded')return null;throw error;}
  }
  async copySnapshot(sourceId,destinationId){
    const project=await this.copyProject(),source=project.lanes.filter(lane=>lane.id===sourceId),destination=project.lanes.filter(lane=>lane.id===destinationId);
    if(sourceId===destinationId||source.length!==1||destination.length!==1||![source[0],destination[0]].every(copyAudioLane))throw new Error('Choose two different persisted audio tracks for the chain copy.');
    if(!Array.isArray(source[0].pluginChain)||!Array.isArray(destination[0].pluginChain)||partial(source[0].pluginChain)||partial(destination[0].pluginChain))throw new Error('Read both complete saved track chains before copying.');
    const [sourceSaved,destinationSaved,sourceNative,destinationNative]=await Promise.all([this.copySaved(sourceId),this.copySaved(destinationId),this.copyNative(sourceId),this.copyDestinationNative(destinationId)]);
    const fresh=await this.copyProject();if(project._studioApi.etag!==fresh._studioApi.etag||stable(project.lanes)!==stable(fresh.lanes))throw Object.assign(new Error('The tracks changed while their chains were loading. Read a new review.'),{code:'chain_review_changed'});
    return{projectId:this.projectId,sourceId,destinationId,sourceName:source[0].name||sourceId,destinationName:destination[0].name||destinationId,etag:fresh._studioApi.etag,sourceChain:copyData(source[0].pluginChain),destinationChain:copyData(destination[0].pluginChain),sourceSaved,destinationSaved,sourceNative,destinationNative};
  }
  async readCopySources(){
    if(this.pluginMutation?.requiresInspection)throw new Error('Inspect the previous plugin operation before copying this chain.');if(!this.canCopyChain)throw unavailable('Copying a track chain');if(this.busy)throw new Error('Wait for the current mixer request.');this.busy=true;
    try{const target=this.target.id,project=await this.copyProject();if(this.target.kind!=='lane'||this.target.id!==target)throw new Error('The destination track changed.');if(project.lanes.filter(lane=>lane.id===target).length!==1)throw new Error('Choose one persisted destination track.');this.copySources=project.lanes.filter(lane=>lane.id!==target&&copyAudioLane(lane)).map(lane=>({id:lane.id,name:lane.name||lane.id}));return copyData(this.copySources);}finally{this.busy=false;}
  }
  async prepareChainCopy(sourceId){
    if(this.pluginMutation?.requiresInspection)throw new Error('Inspect the previous plugin operation before copying this chain.');if(!this.canCopyChain)throw unavailable('Copying a track chain');if(this.busy)throw new Error('Wait for the current mixer request.');if(this.copyReceipt?.requiresInspection)throw new Error('Inspect the previous chain copy before preparing another one.');this.busy=true;this.copyReview=null;
    try{const target=this.target.id;let review;for(let attempt=0;attempt<2;attempt++){try{review=await this.copySnapshot(sourceId,target);break;}catch(error){if(attempt!==0||error.code!=='chain_review_changed')throw error;}}if(this.target.kind!=='lane'||this.target.id!==target)throw new Error('The destination track changed.');this.copyReview=review;return copyData(review);}finally{this.busy=false;}
  }
  async inspectChainCopy(){
    const receipt=this.copyReceipt;if(!receipt)throw new Error('There is no chain copy to inspect.');if(receipt.inFlight)throw new Error('Wait for the current chain copy acknowledgement before inspecting it.');if(this.busy)throw new Error('Wait for the current mixer request.');this.busy=true;
    try{return await this.inspectChainCopyRecord(receipt,{explicit:true});}finally{this.busy=false;}
  }
  async inspectChainCopyRecord(receipt,{explicit=false}={}){
    this.assertScope();if(receipt.projectId!==this.projectId)throw new Error('Reopen the original project to inspect its chain copy.');
    const project=await this.copyProject();if(project.lanes.filter(lane=>lane.id===receipt.destinationId).length!==1)throw new Error('The copied destination track is missing or ambiguous.');
    const [saved,native]=await Promise.all([this.copySaved(receipt.destinationId),this.copyDestinationNative(receipt.destinationId)]);this.assertScope();
    receipt.observedSaved=copyData(saved);receipt.observedNative=copyData(native);receipt.savedConfirmed=stable(saved)===stable(receipt.review.sourceSaved)&&stable(project.lanes.find(lane=>lane.id===receipt.destinationId).pluginChain)===stable(receipt.review.sourceChain);
    // Matching slot metadata cannot prove copied parameter state when the server
    // explicitly says the live chain was not swapped. Never silently reload it.
    receipt.nativeConfirmed=receipt.engineReloadRequired!==true&&receipt.engineApplied!==false&&Array.isArray(native)&&nativeCopyMatches(nativeCopySignature(receipt.review.sourceNative),nativeCopySignature(native));
    const savedAwaitingReload=receipt.acknowledged&&receipt.savedConfirmed&&receipt.engineReloadRequired===true;
    receipt.requiresInspection=!(receipt.savedConfirmed&&receipt.nativeConfirmed)&&!savedAwaitingReload&&!explicit;receipt.inspected=true;
    receipt.status=savedAwaitingReload?'saved_reload_required':receipt.savedConfirmed&&receipt.nativeConfirmed?(receipt.acknowledged?'saved_and_loaded':'matching_state_observed'):receipt.savedConfirmed?'saved_native_pending':'inspected_unconfirmed';this.copyJournal.set(copyKey(this.projectId,receipt.destinationId),receipt);
    if(this.target.kind==='lane'&&this.target.id===receipt.destinationId){this.plugins=normalizeLoadedPlugins(native);this.parameters=[];this.snapshot=null;this.selectedIndex=null;}
    return copyData(receipt);
  }
  async copyChain(){
    if(this.pluginMutation?.requiresInspection)throw new Error('Inspect the previous plugin operation before copying this chain.');if(!this.canCopyChain)throw unavailable('Copying a track chain');if(this.busy)throw new Error('Wait for the current mixer request.');if(this.copyReceipt?.requiresInspection)throw new Error('Inspect the previous chain copy before sending another one.');
    const review=copyData(this.copyReview);if(!review||review.destinationId!==this.target.id)throw new Error('Read and review the source chain before copying it.');this.busy=true;let receipt,sent=false;
    try{
      const fresh=await this.copySnapshot(review.sourceId,review.destinationId);if(stable(fresh)!==stable(review)){this.copyReview=null;throw new Error('A reviewed track or chain changed. Read a new review before copying.');}
      receipt={projectId:this.projectId,sourceId:review.sourceId,destinationId:review.destinationId,review,idempotencyKey:globalThis.crypto?.randomUUID?.()||`copy-chain-${Date.now()}-${Math.random().toString(36).slice(2)}`,ifMatch:fresh.etag,status:'sending',inFlight:true,acknowledged:false,requiresInspection:true,savedConfirmed:false,nativeConfirmed:false};this.copyReceipt=receipt;this.copyJournal.set(copyKey(this.projectId,review.destinationId),receipt);this.copyReview=null;
      sent=true;receipt.result=copyData(await this.call('copy_lane_effect_chain',{project_id:this.projectId,lane_id:review.destinationId,source_lane_id:review.sourceId},{idempotencyKey:receipt.idempotencyKey,ifMatch:receipt.ifMatch}));
      const result=receipt.result;if(result?.ok!==true||result.projectId!==this.projectId||result.laneId!==review.destinationId||result.sourceLaneId!==review.sourceId)throw new Error('The chain copy returned no complete matching acknowledgement. Inspect the saved and loaded chain.');
      if(('engine_applied' in result||'engine_reload_required' in result)&&(typeof result.engine_applied!=='boolean'||typeof result.engine_reload_required!=='boolean'||result.engine_applied&&result.engine_reload_required))throw new Error('The chain copy returned conflicting live-engine status. Inspect the saved and loaded chain.');
      receipt.engineApplied=result.engine_applied;receipt.engineReloadRequired=result.engine_reload_required;receipt.engineSkipped=Array.isArray(result.engine_skipped)?copyData(result.engine_skipped):[];receipt.acknowledged=true;receipt.status='acknowledged';
      await this.inspectChainCopyRecord(receipt);await this.onChanged?.(copyData(receipt.result));return copyData(receipt);
    }catch(error){if(receipt){receipt.error=error.message;receipt.errorCode=error.code;receipt.errorStatus=error.status;receipt.errorStage=error.stage;receipt.engineStatus=error.engineStatus;receipt.status=receipt.acknowledged?'confirmation_pending':[409,412].includes(error.status)?'conflict':error.explicitRejection?'rejected':'uncertain';receipt.requiresInspection=sent;this.copyJournal.set(copyKey(this.projectId,receipt.destinationId),receipt);}this.onError?.(error);throw error;}finally{if(receipt)receipt.inFlight=false;this.busy=false;}
  }
  async changed(task,{refreshChain=true,notify=true}={}){
    if(this.target.kind==='lane')this.inventory?.cache.invalidate({projectId:this.projectId,laneId:this.target.id});
    if(this.busy)throw new Error('Wait for the current cloud mixer edit to finish.');if(this.pluginMutation?.requiresInspection)throw new Error('Inspect the previous plugin operation before changing this chain.');
    this.busy=true;
    try{const result=unpackMixerResult(await task());if(this.target.kind==='lane')this.inventory?.cache.invalidate({projectId:this.projectId,laneId:this.target.id});const reread=typeof refreshChain==='function'?refreshChain(result):refreshChain;
      // The project refresh and the chain re-read are independent: run them together.
      await Promise.all([notify?this.onChanged?.(result):null,reread||!this.isRestMode?this.refresh({readParameters:!this.isRestMode}):null]);return result;}
    catch(error){this.onError?.(error);throw error;}finally{this.busy=false;}
  }
  bypassNow(plugin,{expectedBypassed}={}){
    const check=current=>{if(typeof expectedBypassed==='boolean'&&current.bypassed!==expectedBypassed)throw new Error('This effect’s bypass state changed. Refresh the Mixer before toggling it.');return current;};
    if(this.isRestMode){let desired;return this.pluginOperation('bypass',async()=>{const current=check(await this.ensurePlugin(plugin));desired=!current.bypassed;if(this.target.kind==='bus')await this.restProjectRevision();return this.target.kind==='lane'?{name:'set_plugin_bypassed',args:{...this.context(),lane_id:this.target.id,plugin_index:current.index,bypassed:desired,...expectedPluginFields(current)}}:{name:'execute_pro_action',args:{...this.context(),action:'set_bus_plugin_bypassed',arguments:{bus_id:this.target.id,plugin_index:current.index,bypassed:desired}}};},()=>this.plugins.some(current=>identity(current)===identity(plugin)&&current.bypassed===desired));}
    return this.changed(async()=>{const current=check(await this.ensurePlugin(plugin));return this.target.kind==='lane'?this.call('set_plugin_bypassed',{...this.context(),lane_id:this.target.id,plugin_index:current.index,bypassed:!current.bypassed}):this.invokeAction('set_bus_plugin_bypassed',{bus_id:this.target.id,plugin_index:current.index,bypassed:!current.bypassed});});
  }
  /** A descriptor is available only for the current, validated parameter row.
   * REST lanes use their advertised write form; buses/legacy stay normalized. */
  parameterControl(parameter){
    try{
      if(!record(parameter)||parameter.stale)return null;
      const matches=this.parameters.filter(row=>row.index===parameter.index);if(matches.length!==1||stable(matches[0])!==stable(parameter))return null;
      if(this.isRestMode)this.assertParameterScope(this.parameterState,{display:true});
      if(this.isRestMode&&this.target.kind==='lane')return pluginParameterControl(matches[0],{targetKind:'lane'});
      const value=matches[0].normalized;if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)return null;
      return {form:'normalized',bodyField:'value_norm',value,min:0,max:1,step:.001,unit:parameter.unit??null,valueUnit:'normalized'};
    }catch{return null;}
  }
  parameter(plugin,index,value){
    const parameterState=this.parameterState;
    if(this.isRestMode){try{this.assertParameterScope(parameterState);if(parameterState.scope.instance!==identity(plugin)||parameterState.scope.index!==plugin.index)throw new Error('Read the parameters of this exact plugin instance before editing.');}catch(error){return Promise.reject(error);}}
    if(this.parameterPending||parameterState?.status==='loading')return Promise.reject(new Error('Wait for the current parameter page.'));
    const rows=this.parameters.filter(parameter=>parameter.index===index),parameter=rows.length===1?rows[0]:null,control=this.parameterControl(parameter),typedLane=this.isRestMode&&this.target.kind==='lane';
    if(!control)return Promise.reject(new Error('Read this plugin’s actual parameter list with a verified normalized value or advertised physical write form before changing a parameter.'));
    if(typedLane){try{pluginParameterWriteBody(parameter,value,{targetKind:'lane',form:control.form});}catch(error){return Promise.reject(error);}}
    else if(!finite(value)||Number(value)<0||Number(value)>1)return Promise.reject(new Error('Plugin parameters use normalized values from 0 to 1.'));
    const amount=typedLane?value:Number(value),captured=copyData(parameter);
    if(this.isRestMode)return this.pluginOperation('parameter',async()=>{
      // No slot pre-read for a lane write: it is pinned to the exact instance
      // (expected_plugin_instance_id / _type → 409 plugin_instance_mismatch) and
      // is a compare-and-set on expected_value_norm (412), atomically on the
      // engine. Only a slot without a known instance or saved revision is probed.
      // The instance is confirmed when the saved revision is known OR the loaded parameter page's summary echoed this
      // exact slot index + instance id (Device View / plug-in window): then no snapshot read and no 1-row probe (QA r2:
      // those two pre-reads were 306 + 567 ms of a 2187 ms knob save). The write itself stays instance-pinned.
      const pageConfirmed=parameterState?.summary?.instanceId===identity(plugin)&&parameterState?.scope?.index===plugin.index;
      const cached=typedLane&&identity(plugin)&&(typeof this.savedProject?._studioApi?.etag==='string'||pageConfirmed)?this.plugins.filter(item=>item.index===plugin.index&&identity(item)===identity(plugin)):[];
      const current=cached.length===1?cached[0]:await this.verifySlot(plugin);this.assertParameterScope(parameterState);const fresh=this.parameters.find(row=>row.index===index);
      if(!fresh||stable(fresh)!==stable(captured)||!this.parameterControl(fresh))throw new Error('The parameter value or write contract changed. Read this plugin again.');
      if(this.target.kind==='bus')await this.restProjectRevision();
      // Compare-and-set: the last known valueNorm (our own realtime value when
      // this gesture streamed one) — 412 plugin_parameter_conflict otherwise.
      if(typedLane){const context=this.context(),body=pluginParameterWriteBody(fresh,amount,{targetKind:'lane',form:control.form,...context.track_id?{trackId:context.track_id}:{}}),expectedNorm=this.expectedParameterNorm(current,index,fresh);return{name:'set_plugin_parameter',args:{project_id:this.projectId,lane_id:this.target.id,plugin_index:current.index,parameter_index:index,...body,...expectedPluginFields(current),...expectedNorm!==null?{expected_value_norm:expectedNorm}:{}}};}
      return {name:'execute_pro_action',args:{...this.context(),action:'set_bus_plugin_parameter',arguments:{bus_id:this.target.id,plugin_index:current.index,parameter_index:index,value_norm:amount}}};
    },async receipt=>{
      if(!this.plugins.some(current=>identity(current)===identity(plugin)&&current.index===plugin.index))return false;
      (this.parameterFrameWoken??=new Map()).set(this.parameterKey(plugin,index),parameterEditorFrameWoken(receipt?.result));
      // Confirm from the write reply: an acknowledged instance-pinned compare-and-set (200, ok/mutated, no differing
      // reported value) is the applied value — adopted in place, no page re-read (that was 777 ms of every save).
      // Only a continuous normalized write: physical-unit and stepped values can be clamped/quantized by the engine, so
      // those still confirm from the read-back (an acknowledgement alone never confirms them).
      const continuous=control.form==='normalized'&&!(Number.isInteger(Number(captured.steps))&&Number(captured.steps)>1);
      const fromReply=continuous?parameterWriteReply(receipt?.result,{form:'normalized'}):{acknowledged:false,value:null};
      if(fromReply.acknowledged&&(fromReply.value===null||Math.abs(fromReply.value-amount)<=1e-6)){this.adoptWrittenParameter(index,amount,typedLane?control.form:'normalized');clientLog('plugin-parameter-confirmed-from-reply',{laneId:this.target?.id??null,index});return true;}
      // Otherwise one instance-checked page read confirms what the engine reports.
      await this.refreshParameterPage(index);
      const current=this.parameters.find(row=>row.index===index);if(!current||current.stale||current.id!==captured.id)return false;
      if(typedLane){try{pluginParameterControl(current,{targetKind:'lane',form:control.form});}catch{return false;}}
      const reported=typedLane&&control.form==='physical'?current.physicalValue:current.normalized;return typeof reported==='number'&&Number.isFinite(reported)&&Math.abs(reported-amount)<=1e-6;
    }).then(result=>{this.liveParameterValues?.delete(this.parameterKey(plugin,index));return result;},async error=>{this.liveParameterValues?.delete(this.parameterKey(plugin,index));this.parameterFrameWoken?.delete(this.parameterKey(plugin,index));
      // Playbook: a revision 412 (not the value compare-and-set, which means someone else moved the knob) gets one
      // fresh read and ONE retry, only when the slot still holds this exact instance; otherwise a clear refusal.
      if(typedLane&&error?.status===412&&!isPluginParameterConflict(error)&&!this.parameterRetrying){
        this.parameterRetrying=true;let same=false;
        try{const target={...this.target};await this.restLane(target,()=>{if(target.id!==this.target.id)throw new Error('superseded');});const saved=list(savedLaneChain(this.savedProject,target.id)),slot=saved.filter((row,position)=>(Number.isInteger(row?.position)?row.position:position)===plugin.index);same=slot.length===1&&(slot[0].pluginKey??slot[0].instance_id??slot[0].instanceId)===identity(plugin);}catch{same=false;}
        if(same){clientLog('plugin-parameter-retry',{laneId:this.target.id,index,status:412});try{return await this.parameter(plugin,index,value);}finally{this.parameterRetrying=false;}}
        this.parameterRetrying=false;
      }
      throw this.adoptParameterConflict(error,index);});
    return this.changed(async()=>{const current=await this.ensurePlugin(plugin);return this.target.kind==='lane'?this.call('set_plugin_parameter',{...this.context(),lane_id:this.target.id,plugin_index:current.index,parameter_index:index,value_norm:amount}):this.invokeAction('set_bus_plugin_parameter',{bus_id:this.target.id,plugin_index:current.index,parameter_index:index,value_norm:amount});});
  }
  parameterKey(plugin,index){return `${identity(plugin)}:${plugin?.index}:${index}`;}
  /** The last write reply's editorFrameWoken for this parameter (read once): true lets the GUI skip its stale-frame workaround. */
  takeEditorFrameWoken(plugin,index){const map=this.parameterFrameWoken,key=this.parameterKey(plugin,index);if(!map?.has(key))return false;const woken=map.get(key)===true;map.delete(key);return woken;}
  /** A write confirmed by its reply: the loaded row takes the written value; its display text (the old value's) is dropped. */
  adoptWrittenParameter(index,amount,form){
    for(const row of this.parameters.filter(row=>row.index===index)){
      if(form==='physical'){row.physicalValue=amount;}
      else{if(typeof row.value==='number'&&row.normalized!==null&&Object.is(row.value,row.normalized))row.value=amount;row.normalized=amount;if(Object.hasOwn(row,'value_norm'))row.value_norm=amount;}
      if(Object.hasOwn(row,'display'))row.display=null;
    }
  }
  /** expected_value_norm for a lane write: the value this client streamed live
   * for the parameter during the gesture, else the freshly read valueNorm. */
  expectedParameterNorm(plugin,index,fresh){
    const live=this.liveParameterValues?.get(this.parameterKey(plugin,index)),read=fresh?.normalized;
    const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
    return valid(live)?live:valid(read)?read:null;
  }
  /** 412 plugin_parameter_conflict: someone turned the knob. Adopt the server
   * value in place (the knob repaints from it); the write is never retried. */
  adoptParameterConflict(error,index){
    if(!isPluginParameterConflict(error))return error;
    const value=pluginConflictValue(error);
    for(const row of this.parameters.filter(row=>row.index===index)){if(value===null)continue;if(typeof row.value==='number'&&row.normalized!==null&&Object.is(row.value,row.normalized))row.value=value;row.normalized=value;if(Object.hasOwn(row,'value_norm'))row.value_norm=value;}
    if(this.pluginMutation&&this.pluginMutation.kind==='parameter'){this.pluginMutation.requiresInspection=false;this.pluginMutation.status='conflict';}
    if(value===null)this.refreshParameterPage?.(index).catch(()=>{});
    clientLog('plugin-parameter-conflict',{laneId:this.target?.id??null,index,currentValueNorm:value});
    return Object.assign(error,{message:PLUGIN_CONFLICT_NOTICE,pluginParameterConflict:true,currentValueNorm:value,historyNotApplied:true,explicitRejection:true,operationUncertain:false});
  }
  /** Studio Pro's realtime knob path: `set_plugin_param` over the open ordered
   * mozart-control channel, latest value per parameter, throttled by liveControl.
   * Only current lane plugins with a normalized write form and an exact instance
   * ID qualify (native physical-unit controls have no verified value_norm taper).
   * A stale instance is dropped at send time. Never persistence or an ACK. */
  liveParameter(plugin,index,value,{flush=false}={}){
    const live=this.liveControl,instance=plugin?.instance_id||plugin?.instanceId;
    if(!live||this.target.kind!=='lane'||typeof instance!=='string'||!instance)return'unavailable';
    let message;
    try{
      this.assertScope();if(this.isRestMode&&(this.parameterState?.scope?.instance!==instance||this.parameterState.scope.index!==plugin.index))return'unavailable';
      const rows=this.parameters.filter(row=>row.index===index),control=rows.length===1?this.parameterControl(rows[0]):null;if(control?.form!=='normalized')return'unavailable';
      message=livePluginParameterMessage({laneId:this.target.id,pluginIndex:plugin.index,parameterIndex:index,valueNorm:Number(value),pluginType:plugin.type_id??plugin.type??plugin.plugin_type??'',instanceId:instance});
    }catch{return'unavailable';}
    if(!message)return'unavailable';const laneId=this.target.id;
    const valid=()=>{try{this.assertScope();}catch{return false;}return this.target.kind==='lane'&&this.target.id===laneId&&this.plugins.some(current=>(current.instance_id||current.instanceId)===instance&&current.index===plugin.index);};
    const result=live.set(message,{valid}),sent=flush&&result==='queued'?live.flush(liveControlKey(message)):result;
    if(['sent','queued'].includes(sent)){(this.liveParameterValues??=new Map()).set(this.parameterKey(plugin,index),Number(value));}
    return sent;
  }
  get parameterWriting(){return this.parameterWrites.pending.size+this.parameterWrites.inflight.size>0;}
  parameterWriteValue(index){for(const map of [this.parameterWrites.pending,this.parameterWrites.inflight])for(const entry of map.values())if(entry.index===index)return entry.value;return undefined;}
  /** Persist the latest released value per parameter with one typed REST write
   * at a time. Other parameters stay editable; a repeated identical value while
   * its write is in flight is the same request, never a duplicate mutation. */
  queueParameter(plugin,index,value){
    const {pending,inflight}=this.parameterWrites,key=`${identity(plugin)}:${plugin?.index}:${index}`,running=inflight.get(key);
    let entry=pending.get(key);if(entry){entry.value=value;return entry.promise;}
    if(running&&Object.is(running.value,value))return running.promise;
    entry={key,plugin,index,value};entry.promise=new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject;});pending.set(key,entry);
    this.parameterWrites.chain=this.parameterWrites.chain.then(async()=>{
      if(pending.get(key)!==entry)return;pending.delete(key);inflight.set(key,entry);
      try{entry.resolve(await this.parameter(entry.plugin,entry.index,entry.value));}catch(error){entry.reject(error);}finally{if(inflight.get(key)===entry)inflight.delete(key);}
    });
    return entry.promise;
  }
  program(plugin,index){
    const count=Number(this.snapshot?.program_count);
    if(!Number.isInteger(index)||index<0||!Number.isInteger(count)||index>=count)return Promise.reject(new Error('Choose a program index reported by this plugin.'));
    if(this.target.kind!=='lane')return Promise.reject(new Error('Freestyle has not exposed a bus plugin program setter.'));
    if(this.isRestMode)return this.pluginOperation('program',async()=>{const current=await this.ensurePlugin(plugin);return{name:'execute_pro_action',args:{...this.context(),action:'set_lane_plugin_program',arguments:{lane_id:this.target.id,plugin_index:current.index,program:index,...expectedPluginFields(current)}}};},async()=>{await this.readPlugin(plugin.index);return this.snapshot?.current_program_index===index;});
    return this.changed(async()=>{const current=await this.ensurePlugin(plugin);return this.invokeAction('set_lane_plugin_program',{lane_id:this.target.id,plugin_index:current.index,program:index});});
  }
  async paged(name,args){
    const rows=[],seen=new Set();let cursor;
    for(let page=0;page<100;page++){const data=await this.call(name,{...args,...(cursor?{cursor}:{})});const collection={list_plugin_catalog:'plugins',list_vocal_chain_presets:'presets',list_effect_presets:'presets'}[name],pageRows=data.data??data[collection];if(!Array.isArray(pageRows)||typeof data.pagination?.hasMore!=='boolean')throw new Error('Read a complete catalog page before selecting an item.');rows.push(...pageRows);if(!data.pagination.hasMore){if(data.pagination.nextCursor!=null)throw new Error('The catalog returned conflicting completion metadata.');return rows;}const next=data.pagination.nextCursor;if(typeof next!=='string'||!next||next.length>512||seen.has(next))throw new Error('The catalog returned an invalid or repeated cursor.');seen.add(next);cursor=next;}throw new Error('The catalog exceeded its bounded page budget.');
  }
  async readCatalog({checkHost=true,cached=false}={}){
    // History steps re-add a known catalog id: a catalog read in the last 5 min is enough (it took up to 1.5 s live).
    const cacheKey=JSON.stringify([this.projectId,this.target.kind,checkHost]),hit=cached?catalogCache.get(cacheKey):null;if(hit&&Date.now()-hit.at<300000){this.catalog=copyData(hit.catalog);this.catalogLoaded=true;return this.catalog;}
    if(!this.isRestMode){this.catalog=pluginCatalog(this.state);return this.catalog;}if(!this.canLoadPlugin)throw unavailable('Plugin catalog');
    const rows=await this.paged('list_plugin_catalog',{kind:'effect',limit:200,...(checkHost?{project_id:this.projectId,include_presets:true}:{})}),ids=new Set();
    this.catalog=rows.map(entry=>{if(typeof entry.id!=='string'||!entry.id||ids.has(entry.id)||entry.kind!=='effect'||!['native','vst3'].includes(entry.format)||typeof entry.name!=='string'||typeof entry.availability?.checked!=='boolean'||![true,false,null].includes(entry.availability.installed))throw new Error('The catalog returned an ambiguous plugin identity or availability.');ids.add(entry.id);return{...entry,hostGated:entry.availability.installed===false||this.target.kind==='bus'&&entry.format!=='vst3'};});this.catalogLoaded=true;catalogCache.set(cacheKey,{at:Date.now(),catalog:copyData(this.catalog)});return this.catalog;
  }
  async pluginOperation(kind,prepare,verify){
    if(this.pluginMutation?.requiresInspection)throw new Error('Inspect the previous plugin operation before submitting another one.');let receipt;
    // A parameter write leaves the chain as is; its verify re-reads the instance-checked parameter page.
    try{let requestLocal=null;const result=await this.changed(async()=>{const request=await prepare();requestLocal=typeof request.local==='function'?request.local:null;const etag=this.savedProject?._studioApi?.etag;/* a lane parameter write is instance-pinned + compare-and-set; without a saved revision the bridge adds the project ETag it holds */if(!request.studio&&!(kind==='parameter'&&this.target.kind==='lane')&&(typeof etag!=='string'||!etag))throw new Error('Read the current project revision before changing its plugin chain.');receipt={kind,target:{...this.target},projectId:this.projectId,before:copyData(this.plugins),contextTrackId:this.contextTrackId,...request.review?{review:copyData(request.review)}:{},idempotencyKey:globalThis.crypto?.randomUUID?.()||`plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`,ifMatch:etag,status:'sending',inFlight:true,requiresInspection:true,acknowledged:false,request:copyData({...request,local:undefined,afterWrite:undefined}),...this.target.kind==='lane'?{savedChainBefore:copyData(savedLaneChain(this.savedProject,this.target.id))}:{}};this.pluginMutation=receipt;this.mutationJournal.set(copyKey(this.projectId,this.target.id),receipt);const raw=request.studio?await this.studioCall(request.studio,{idempotencyKey:receipt.idempotencyKey}):await this.rawCall(request.name,request.args,{idempotencyKey:receipt.idempotencyKey,ifMatch:receipt.ifMatch});receipt.result=copyData(raw);if(typeof request.afterWrite==='function')try{const pending=request.afterWrite(raw?.structuredContent??raw);if(pending)afterWrites.set(receipt,pending);}catch{}const payload=unpackMixerResult(raw);if(!record(payload)||!Object.keys(payload).length)throw new Error('Freestyle returned no usable plugin operation receipt.');receipt.acknowledged=true;this.acknowledgedWrites=(this.acknowledgedWrites||0)+1;return payload;},{refreshChain:kind==='parameter'?false:payload=>{let local=false;try{local=receipt?.request&&typeof requestLocal==='function'&&requestLocal(payload,receipt.result?.structuredContent??receipt.result)===true;}catch{local=false;}if(local){receipt.confirmedFromResponse=true;clientLog('plugin-chain-confirmed-from-response',{kind,laneId:this.target.id});}return !local;},notify:kind!=='parameter'});const confirmed=verify?await verify(receipt):true;if(kind!=='move')receipt.nativeConfirmed=confirmed;receipt.status=confirmed?'acknowledged_refreshed':'unconfirmed';receipt.requiresInspection=!confirmed;return result;}
    catch(error){const missingBusPlugin=kind==='add'&&this.target.kind==='bus'&&!receipt?.acknowledged&&error.status===409&&error.code==='plugin_not_installed_on_host',instanceMismatch=INSTANCE_CHECKED_WRITES.has(kind)&&!receipt?.acknowledged&&error.status===409&&error.code==='plugin_instance_mismatch';if(instanceMismatch){const current=mismatchDetails(error);error.explicitRejection=true;error.pluginInstanceMismatch=true;error.currentInstanceId=current.instance??null;error.currentPluginType=current.type??null;error.message=`This plugin slot now holds a different plugin${current.type?` (${current.type})`:''}, so Freestyle refused the change. The plugin chain was refreshed; select the plugin again.`;clientLog('plugin-instance-mismatch',{kind,laneId:this.target.id,currentPluginType:current.type??null});this.invalidateParameters?.();this.refreshPlugins().catch(()=>{});}if(missingBusPlugin){error.explicitRejection=true;error.message='This plugin is not installed on the current engine host. Choose another available plugin. '+error.message;const catalogId=receipt?.request?.args?.arguments?.plugin_id,entry=this.catalog.find(item=>item.id===catalogId);if(entry){entry.hostGated=true;entry.availability={...entry.availability,checked:true,installed:false};}}const rejected=!receipt?.acknowledged&&definiteRejection(error);if(rejected&&kind==='add'&&this.target.kind==='lane'&&noLiveChain(error)){this.markNoLiveChain(this.target.id,error);error.message=noLiveChainMessage(this.targetInfo,error.message,{added:true});error.laneNotLive=true;}else if(rejected&&kind==='add'&&this.target.kind==='lane'&&error.code==='target_not_loaded'){error.message=`${error.message||`${this.targetInfo?.name?`“${this.targetInfo.name}”`:'This lane'} is not in the live session right now.`} No effect was added.`;error.laneNotLive=true;}if(receipt){receipt.error=error.message;receipt.errorCode=error.code;receipt.errorStage=error.stage;receipt.errorStatus=error.status;receipt.status=receipt.acknowledged?'confirmation_pending':rejected?'rejected':'uncertain';
      // Freestyle refused the request (4xx, nothing applied): there is nothing to
      // inspect, so later adds stay available. Only a lost/unknown outcome or an
      // acknowledged-but-unconfirmed write blocks the next edit until Inspect.
      receipt.requiresInspection=receipt.acknowledged||!rejected;if(rejected)clientLog('plugin-operation-rejected',{kind,target:this.target.kind,status:error.status??null,code:error.code??null});if(rejected&&error.status===412&&!(kind==='parameter'&&this.target.kind==='lane'))this.refreshPlugins().catch(()=>{});/* a lane parameter 412 does its own single fresh read (parameter()) */}throw error;}finally{if(receipt)receipt.inFlight=false;}
  }
  async inspectPluginOperation(){if(this.busy)throw new Error('Wait for the current plugin request.');if(!this.pluginMutation)throw new Error('There is no plugin operation to inspect.');if(this.pluginMutation.inFlight)throw new Error('Wait for the current plugin acknowledgement before inspecting it.');this.busy=true;try{const receipt=this.pluginMutation;let unreadable=null;try{await this.refresh();if(receipt.target?.kind==='lane'&&receipt.target.id===this.target.id&&this.liveChainMissing)unreadable={status:409,code:'lane_has_no_live_chain'};}catch(error){unreadable=error;}if(unreadable){const error=unreadable;
      // No live chain exists for this lane, so nothing can be loaded there: the
      // saved chain re-read just before the live read is the whole outcome.
      const saved=receipt.target?.kind==='lane'&&receipt.target.id===this.target.id&&error.status===409&&['target_not_loaded','lane_has_no_live_chain'].includes(error.code)?savedLaneChain(this.savedProject,receipt.target.id):null;
      if(!saved||!Array.isArray(receipt.savedChainBefore))throw error;
      this.plugins=[];this.notLiveTarget=receipt.target.id;receipt.liveChainAvailable=false;receipt.observedPlugins=[];receipt.observedSavedChain=copyData(saved);receipt.savedChanged=stable(saved)!==stable(receipt.savedChainBefore);receipt.status=receipt.savedChanged?'inspected_saved_not_loaded':'inspected_not_applied';receipt.requiresInspection=false;return copyData(receipt);
    }
    this.pluginMutation.observedPlugins=copyData(this.plugins);if(this.pluginMutation.kind==='move')await this.verifyLaneMove(this.pluginMutation);this.pluginMutation.status='inspected';this.pluginMutation.requiresInspection=false;return copyData(this.pluginMutation);}finally{this.busy=false;}}
  loadPluginNow(id,restore=null){
    if(!this.canLoadPlugin)return Promise.reject(unavailable('Loading a new plugin'));
    // 338 addLanePlugin: position (insert slot), bypassed, instance_id and saved state (undo of a delete).
    const extra=this.isRestMode&&this.target.kind==='lane'&&record(restore)?Object.fromEntries(RESTORE_BODY_FIELDS.filter(key=>key!=='plugin_id').filter(key=>restore[key]!==undefined).map(key=>[key,restore[key]])):{};
    if(this.isRestMode&&!this.catalogLoaded)return Promise.reject(new Error('Read the plugin catalog before adding a plugin.'));
    const entry=this.catalog.find(item=>(this.isRestMode?item.id:item.path)===id);
    if(!entry||entry.hostGated)return Promise.reject(new Error('Choose an available plugin from the returned catalog.'));
    if(this.isRestMode)return this.pluginOperation('add',async()=>{try{await this.refreshPlugins();}catch(error){if(this.target.kind!=='lane'||error.status!==409||error.code!=='target_not_loaded')throw error;this.plugins=[];}if(this.liveChainMissing)throw Object.assign(new Error(noLiveChainMessage(this.targetInfo,this.noLiveChainDetail,{added:true})),{code:'lane_has_no_live_chain',status:409,explicitRejection:true,laneNotLive:true,dispatched:false});if(this.target.kind==='bus')await this.restProjectRevision();const laneId=this.target.id,local=this.target.kind!=='lane'?null:(payload,raw)=>{
      // addLanePlugin answers 201 with the stamped instanceId and its live pluginIndex (it persists the chain row).
      const instance=raw?.instanceId??payload?.instanceId??payload?.instance_id,index=raw?.pluginIndex??payload?.pluginIndex??payload?.plugin_index;if(typeof instance!=='string'||!instance||!Number.isInteger(index)||index<0||this.plugins.some(plugin=>identity(plugin)===instance))return false;
      if(typeof extra.instance_id==='string'&&instance!==extra.instance_id)return false;
      const rows=[...this.plugins.map(plugin=>({...plugin}))];for(const plugin of rows)if(plugin.index>=index)plugin.index++;const reported=raw?.response?.bypassed??payload?.bypassed;rows.push({index,instance_id:instance,type_id:entry.id,name:entry.name||entry.id,bypassed:typeof reported==='boolean'?reported:false});this.plugins=normalizeLoadedPlugins(rows);
      const lane=list(this.savedProject?.lanes).find(item=>item?.id===laneId);if(lane&&Array.isArray(lane.pluginChain)){const chain=lane.pluginChain.map(row=>({...row}));chain.splice(Math.min(index,chain.length),0,{pluginKey:instance,type:entry.id,name:entry.name||entry.id,position:index});lane.pluginChain=chain.map((row,position)=>({...row,position}));}
      this.liveChainRead=laneId;return true;
    };return{name:'execute_pro_action',args:{...this.context(),action:this.target.kind==='lane'?'add_lane_plugin':'load_bus_plugin',arguments:{...(this.target.kind==='lane'?{lane_id:this.target.id}:{bus_id:this.target.id}),plugin_id:entry.id,...extra}},...(local?{local}:{})};},receipt=>{const body=receipt.result?.structuredContent??receipt.result,instance=body.instanceId??body.response?.instance_id??body.response?.instanceId,added=this.plugins.filter(plugin=>!receipt.before.some(before=>identity(before)===identity(plugin))&&(plugin.type_id===entry.id||plugin.catalog_id===entry.id));return typeof instance==='string'?added.some(plugin=>identity(plugin)===instance):added.length===1;});
    if(this.target.kind==='lane'&&!Number.isInteger(this.runtimeTrack?.id))return Promise.reject(new Error('This lane is not loaded in the live engine yet. Load the lane in Freestyle before adding a plugin.'));
    return this.changed(()=>this.target.kind==='lane'?this.invokeAction('load_track_plugin',{track_id:this.runtimeTrack.id,path:entry.path},{destructive:true}):this.invokeAction('load_bus_plugin',{bus_id:this.target.id,path:entry.path},{destructive:true}));
  }
  async restProjectRevision(){const saved=await this.call('get_project',{project_id:this.projectId});if(saved?.id!==this.projectId||typeof saved._studioApi?.etag!=='string')throw new Error('Read the current project revision before editing this bus.');this.savedProject=saved;return saved;}
  async nativeChain(operation,plugin,toIndex){
    if(this.isRestMode)throw unavailable('Changing lane plugin order');
    const current=await this.ensurePlugin(plugin);
    const response=await this.fetch('/api/audio/plugin-chain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...this.context(),lane_id:this.target.id,instance_id:identity(current),operation,...(operation==='move'?{to_index:toIndex}:{})})});
    const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.detail||result.error||`Cloud plugin edit failed (${response.status}).`);return unpackMixerResult(result);
  }
  assertLaneMoveScope(scope){
    this.assertScope();if(this.projectId!==scope.projectId||this.contextTrackId!==scope.contextTrackId||this.target.kind!=='lane'||this.target.id!==scope.laneId)throw new Error('The mixer lane or session scope changed before its plugin order was confirmed.');
  }
  /** move_lane_plugin answers {order:[instance ids], persisted_rows}: the live order and the saved rows
   * it wrote. When that order is exactly the expected one, it confirms the move without re-reading. */
  moveLocal(scope,review){
    return(payload,raw)=>{
      const order=raw?.order??payload?.order,rows=raw?.persisted_rows??payload?.persisted_rows,expected=review.expectedNative.map(item=>item.instance);
      if(!Array.isArray(order)||rows!==order.length||stable(order)!==stable(expected))return false;
      const byId=new Map(this.plugins.map(plugin=>[identity(plugin),plugin]));if(order.some(id=>!byId.has(id)))return false;
      this.plugins=normalizeLoadedPlugins(order.map((id,index)=>({...byId.get(id),index})));
      const lane=list(this.savedProject?.lanes).find(item=>item?.id===scope.laneId);if(lane&&Array.isArray(lane.pluginChain)){const rowsById=new Map(lane.pluginChain.map(row=>[row?.pluginKey,row]));if(order.every(id=>rowsById.has(id)))lane.pluginChain=order.map((id,position)=>({...rowsById.get(id),position}));}
      this.liveChainRead=scope.laneId;return true;
    };
  }
  savedStateRead(scope){return this.call('get_saved_plugin_state',{project_id:scope.projectId,lane_id:scope.laneId}).then(value=>({value}),error=>({error}));}
  async laneMoveSaved(scope,{reuse=false,state:prefetched=null}={}){
    this.assertLaneMoveScope(scope);
    // reuse: the chain refresh after the write has just re-read this saved lane (its pluginChain is the
    // order), so only the saved-state read is needed, not a second saved-lane round trip.
    const reused=reuse?list(this.savedProject?.lanes).filter(item=>item?.id===scope.laneId):[];
    // The saved lane and the saved plug-in state are independent reads: run them together.
    const statePending=prefetched||this.savedStateRead(scope);
    let lane;try{lane=reused.length===1?reused[0]:await this.restLane({kind:'lane',id:scope.laneId},()=>this.assertLaneMoveScope(scope));}catch(error){await statePending;throw error;}
    if(!Array.isArray(lane.pluginChain)||hasCanonicalTruncation(lane.pluginChain))throw new Error('Read this lane’s complete persisted processing chain before moving a slot.');
    const answer=await statePending;if(answer.error)throw answer.error;const state=answer.value;this.assertLaneMoveScope(scope);
    if(state.projectId!==scope.projectId||state.laneId!==scope.laneId||hasCanonicalTruncation(state)||!Array.isArray(state.plugins))throw new Error('Read the saved plugin snapshots for this exact project and lane.');
    // Snapshot blobs and persisted topology are separate resources. In particular,
    // native effects can have no saved snapshot blob while their lane pluginChain
    // still records every durable instance and processing position.
    return {scope:{projectId:state.projectId,laneId:state.laneId,...Object.hasOwn(state,'trackId')?{trackId:state.trackId}:{}},topologyScope:{projectId:scope.projectId,laneId:scope.laneId},plugins:copyData(lane.pluginChain),snapshots:copyData(state.plugins),order:savedOrder(lane.pluginChain)};
  }
  async verifyLaneMove(receipt){
    if(receipt.confirmedFromResponse){receipt.observedPlugins=copyData(this.plugins);receipt.nativeConfirmed=stable(loadedOrder(this.plugins))===stable(receipt.review.expectedNative);receipt.savedConfirmed=receipt.nativeConfirmed;receipt.confirmation='write_response';return receipt.nativeConfirmed;}
    const review=receipt.review;if(!review)throw new Error('The plugin move has no captured order to inspect.');this.assertLaneMoveScope(review.scope);
    // refresh() has just read this exact loaded chain. The canonical saved lane
    // independently confirms processing order; snapshot blobs do not define it.
    receipt.observedPlugins=copyData(this.plugins);receipt.nativeConfirmed=stable(loadedOrder(this.plugins))===stable(review.expectedNative);
    const prefetched=afterWrites.get(receipt)||null;afterWrites.delete(receipt);const saved=await this.laneMoveSaved(review.scope,{reuse:!receipt.inspecting,state:prefetched});receipt.observedSaved=saved;receipt.savedConfirmed=stable(saved.order)===stable(review.expectedSaved);receipt.savedScope=copyData(saved.scope);
    this.assertLaneMoveScope(review.scope);return receipt.nativeConfirmed&&receipt.savedConfirmed;
  }
  /** History move by instance id: the saved order and the live chain are read together and must
   * correspond; the slot is resolved from that live read (no separate lookup read). */
  moveInstance(instanceId,toIndex,what){
    const scope={projectId:this.projectId,contextTrackId:this.contextTrackId,laneId:this.target.id};
    return this.pluginOperation('move',async()=>{
      this.assertLaneMoveScope(scope);const [saved]=await Promise.all([this.laneMoveSaved(scope),this.refreshPlugins()]);this.assertLaneMoveScope(scope);
      const before=copyData(this.plugins),current=before.find(item=>identity(item)===instanceId),target=before.filter(item=>item.index===toIndex);
      if(!current)throw Object.assign(new Error(`${what||'That plugin'} is no longer in this chain, so this step was not applied.`),{dispatched:false,explicitRejection:true});
      if(target.length!==1)throw Object.assign(new Error('That chain slot no longer exists, so this step was not applied.'),{dispatched:false,explicitRejection:true});
      if(current.index===toIndex)throw Object.assign(new Error('Already in that slot.'),{code:'plugin_move_noop',dispatched:false,explicitRejection:true});
      if(saved.order.length!==before.length||saved.order.some((row,index)=>row.type!==pluginType(before[index])||row.instance!=null&&row.instance!==identity(before[index])))throw new Error('The saved and loaded plugin identities do not describe the same ordered lane chain.');
      const from=before.findIndex(item=>item.index===current.index),to=before.findIndex(item=>item.index===toIndex),review={scope,beforeSaved:saved,expectedNative:reordered(loadedOrder(before),from,to),expectedSaved:reordered(saved.order,from,to)};
      return {name:'execute_pro_action',args:{...this.context(),action:'move_lane_plugin',arguments:{lane_id:scope.laneId,plugin_index:current.index,to_index:toIndex,expected_plugin_instance_id:identity(current),expected_plugin_type:current.type_id}},review,local:this.moveLocal(scope,review),afterWrite:raw=>Array.isArray(raw?.order)?null:this.savedStateRead(scope)};
    },receipt=>this.verifyLaneMove(receipt));
  }
  moveLane(plugin,toIndex,destination){
    const scope={projectId:this.projectId,contextTrackId:this.contextTrackId,laneId:this.target.id};
    return this.pluginOperation('move',async()=>{
      this.assertLaneMoveScope(scope);const current=await this.ensurePlugin(plugin);this.assertLaneMoveScope(scope);
      if(typeof current.type_id!=='string'||!current.type_id||current.type_id!==plugin.type_id)throw new Error('The plugin slot’s catalog type changed. Refresh before moving it.');
      const before=copyData(this.plugins),target=before.filter(item=>item.index===toIndex);
      if(target.length!==1||identity(target[0])!==identity(destination)||pluginType(target[0])!==pluginType(destination))throw new Error('The destination plugin slot changed. Refresh before moving it.');
      const saved=await this.laneMoveSaved(scope);await this.refreshPlugins();this.assertLaneMoveScope(scope);
      if(stable(loadedOrder(this.plugins))!==stable(loadedOrder(before))||this.plugins.some((item,index)=>item.index!==before[index].index))throw new Error('The loaded plugin chain changed while its saved order was read. Refresh before moving it.');
      if(saved.order.length!==before.length||saved.order.some((row,index)=>row.type!==pluginType(before[index])||row.instance!=null&&row.instance!==identity(before[index])))throw new Error('The saved and loaded plugin identities do not describe the same ordered lane chain.');
      const from=before.findIndex(item=>item.index===current.index),to=before.findIndex(item=>item.index===toIndex),review={scope,beforeSaved:saved,expectedNative:reordered(loadedOrder(before),from,to),expectedSaved:reordered(saved.order,from,to)};
      return {name:'execute_pro_action',args:{...this.context(),action:'move_lane_plugin',arguments:{lane_id:scope.laneId,plugin_index:current.index,to_index:toIndex,expected_plugin_instance_id:identity(current),expected_plugin_type:current.type_id}},review,local:this.moveLocal(scope,review),afterWrite:raw=>Array.isArray(raw?.order)?null:this.savedStateRead(scope)};
    },receipt=>this.verifyLaneMove(receipt));
  }
  moveNow(plugin,toIndex){
    if(!this.canMovePlugin)return Promise.reject(unavailable('Moving a lane plugin'));
    if(!Number.isInteger(toIndex)||toIndex<0||toIndex>64||!this.plugins.some(item=>item.index===toIndex))return Promise.reject(new Error('Choose an existing chain slot.'));
    if(this.isRestMode&&this.target.kind==='lane'){if(plugin.index===toIndex)return Promise.resolve({ok:true,unchanged:true});return this.moveLane(copyData(plugin),toIndex,copyData(this.plugins.find(item=>item.index===toIndex)));}
    return this.changed(async()=>{if(this.target.kind==='lane')return this.nativeChain('move',plugin,toIndex);const current=await this.ensurePlugin(plugin);return this.invokeAction('move_bus_plugin',{bus_id:this.target.id,plugin_index:current.index,to_index:toIndex});});
  }
  /**
   * FL "Replace": add the chosen catalog effect, move it into the old slot, then
   * remove the old instance. Three separate confirmed edits; each refuses on a
   * changed slot, and a failure part-way reports exactly what was left.
   */
  async replacePluginNow(old,id){
    if(!this.canLoadPlugin||!this.canMovePlugin||!this.canRemovePlugin)throw unavailable('Replacing a plugin');
    const oldId=identity(old);if(!oldId)throw new Error('Select the exact plugin instance to replace.');
    await this.refreshPlugins();if(!this.plugins.some(item=>identity(item)===oldId))throw new Error(`${old.name||'That plugin'} is no longer in this chain. Refresh the mixer.`);
    const before=new Set(this.plugins.map(identity));await this.loadPlugin(id);
    if(this.pluginMutation?.requiresInspection)throw new Error('Freestyle did not confirm the new plugin. Inspect it before replacing the old one.');
    const added=this.plugins.filter(item=>!before.has(identity(item)));if(added.length!==1)throw new Error('The new plugin was added, but its slot could not be identified. The old plugin was kept.');
    try{
      const slot=this.plugins.find(item=>identity(item)===oldId);if(!slot)return{added:added[0],replaced:false};
      await this.move(added[0],slot.index);
      const current=this.plugins.find(item=>identity(item)===oldId);if(current)await this.remove(current);
      return{added:this.plugins.find(item=>identity(item)===identity(added[0]))||added[0],replaced:true};
    }catch(error){error.message=`${added[0].name||'The new plugin'} was added, but replacing ${old.name||'the old plugin'} did not finish: ${error.message}`;throw error;}
  }
  removeNow(plugin){
    if(!this.canRemovePlugin)return Promise.reject(unavailable('Removing a plugin'));
    // Lanes: one deleteLanePluginInstance by the exact instance id unloads the live slot and
    // removes its saved-chain row together (round 13), so no index probe or saved-chain follow-up.
    if(this.isRestMode&&this.target.kind==='lane')return this.removeLaneInstance(identity(plugin),{live:true});
    if(this.isRestMode)return this.pluginOperation('remove',async()=>{const current=await this.ensurePlugin(plugin);await this.restProjectRevision();return{name:'execute_pro_action',args:{...this.context(),action:'delete_bus_plugin',arguments:{bus_id:this.target.id,plugin_index:current.index}}};},()=>!this.plugins.some(current=>identity(current)===identity(plugin)));
    return this.changed(async()=>{if(this.target.kind==='lane')return this.nativeChain('remove',plugin);const current=await this.ensurePlugin(plugin);return this.invokeAction('delete_bus_plugin',{bus_id:this.target.id,plugin_index:current.index},{destructive:true});});
  }
  // ---- FL mixer-slot history: insert, delete, replace, move and bypass are each one Undo step ----
  // The step opens before the write (beginExternalStep), so the chain refresh it causes is this
  // step and never "changed outside history"; a refused write fails it, an unconfirmed one too.
  historyEnabled(){return !!this.history&&!!this.historyController&&this.isRestMode&&this.target.kind==='lane'&&this.historyDepth===0;}
  async historic(label,task,makeStep){
    if(!this.historyEnabled())return task();
    const history=this.history;let token=null;this.historyDepth++;
    try{token=history.beginExternalStep({kind:'plugin_chain',label});}catch{token=null;}
    try{
      const result=await task();let step=null;
      if(!this.pluginMutation?.requiresInspection)try{step=makeStep(result);}catch(error){clientLog('plugin-history-step-error',{label,message:String(error?.message||'').slice(0,160)});}
      if(token){if(step)history.finishExternalStep(token,step);else history.failExternalStep(token,Object.assign(new Error(`${label} was not confirmed.`),{operationUncertain:true}));}
      else if(step)history.recordExternalStep?.({kind:'plugin_chain',label,...step});
      return result;
    }catch(error){if(token)history.failExternalStep(token,error);throw error;}
    finally{this.historyDepth--;}
  }
  /** A fresh, history-scoped controller on this lane with its live chain read. */
  async historyTarget({read=true}={}){const controller=this.historyController();if(controller.target.kind!=='lane'||controller.target.id!==this.target.id)throw Object.assign(new Error('The mixer lane changed; this step was not applied.'),{dispatched:false});if(read)await controller.refreshPlugins();return controller;}
  static async addAt(controller,type,index,bypassed,restore=null){
    if(!controller.catalogLoaded)await controller.readCatalog({checkHost:false,cached:true});
    // loadPluginNow reads the chain itself; the new slot is named by the add receipt's instance id.
    // 338: one add carries the slot, the bypass and (undo of a delete) the server's saved state + instance id.
    const args=record(restore)&&restore.plugin_id===type?{...restore}:{};if(Number.isInteger(index)&&args.position===undefined)args.position=index;if(args.bypassed===undefined)args.bypassed=bypassed===true;
    await controller.loadPluginNow(type,args);
    if(controller.pluginMutation?.requiresInspection)throw Object.assign(new Error('Freestyle did not confirm the restored plugin. Inspect the mixer.'),{dispatched:true});
    const body=controller.pluginMutation?.result?.structuredContent??controller.pluginMutation?.result,instance=body?.instanceId??body?.response?.instance_id,before=new Set(list(controller.pluginMutation?.before).map(identity));
    const added=typeof instance==='string'?controller.plugins.filter(plugin=>identity(plugin)===instance):controller.plugins.filter(plugin=>!before.has(identity(plugin)));if(added.length!==1)throw Object.assign(new Error('The restored plugin’s slot could not be identified.'),{dispatched:true});
    const id=identity(added[0]);
    // Tolerance for an older Freestyle that ignores position / bypassed on add: one move, one bypass.
    if(Number.isInteger(index)&&added[0].index!==index&&controller.plugins.some(plugin=>plugin.index===index))await MixerToolsController.moveTo(controller,id,index);
    const current=controller.plugins.find(plugin=>identity(plugin)===id)||added[0];
    if(bypassed&&!current.bypassed)await controller.bypassNow(current,{expectedBypassed:false});
    return id;
  }
  static async moveTo(controller,id,index,what){try{await controller.moveInstance(id,index,what);}catch(error){if(error?.code!=='plugin_move_noop')throw error;}}
  /** Delete by instance id without a lookup read; Freestyle refuses an unknown id, which is a refused (not applied) step. */
  static async removeById(controller,id,what){
    try{await controller.removeNow({instance_id:id,name:what});}
    catch(error){if(error?.status===409||error?.code==='plugin_instance_not_found')throw Object.assign(error,{dispatched:false,message:`${what||'That plugin'} is no longer in this chain, so this step was not applied.`});throw error;}
  }
  /** Optimistic FX-rack repaint at the ⌘Z/⌘⇧Z keypress (history previewUi): the expected chain, reverted if the step fails. */
  preview(op){const laneId=this.target.id;return()=>{try{return this.chainPreview?.({laneId,transform:plugins=>chainTransform(plugins,{...op,id:op.id?this.resolveInstance(op.id):undefined})})??null;}catch{return null;}};}
  static current(controller,id,what){const plugin=controller.plugins.find(item=>identity(item)===id);if(!plugin)throw Object.assign(new Error(`${what||'That plugin'} is no longer in this chain, so this step was not applied.`),{dispatched:false});return plugin;}
  /** Undo/redo that re-creates a plug-in gets a NEW instance id from Freestyle. Every history
   * entry keeps the id it saw; resolve() follows the alias chain old → … → current, so a later
   * step (in either direction) still targets the re-created instance. */
  aliasKey(id){return JSON.stringify([this.projectId,this.target.id,id]);}
  resolveInstance(id){let current=id;for(let hop=0;hop<64;hop++){const next=instanceAliases.get(this.aliasKey(current));if(!next||next===current)return current;current=next;}return current;}
  aliasInstance(from,to){if(typeof from==='string'&&typeof to==='string'&&from!==to){instanceAliases.set(this.aliasKey(from),to);clientLog('plugin-instance-alias',{laneId:this.target.id,from,to});}}
  async historyRun(task,{read=true}={}){const controller=await this.historyTarget({read});let ok=false;const acked=controller.acknowledgedWrites||0;try{const result=await task(controller);ok=true;return result;}
    catch(error){
      // FL: a definite refusal (4xx, nothing applied) of the step's FIRST write leaves the
      // project exactly as before: the step is kept and every other step stays usable.
      // Only an unknown outcome (lost reply, 5xx) or a refusal after an earlier write
      // landed may block the journal.
      if(error&&error.dispatched!==false&&(controller.acknowledgedWrites||0)===acked&&definiteRejection(error)){error.dispatched=false;error.historyNotApplied=true;if(error.code==='restore_state_invalid')error.message=`Freestyle refused to restore this effect’s saved settings (${error.message}). Nothing changed; the step is kept.`;}
      throw error;
    }finally{try{controller.onChainChanged?.({laneId:controller.target.id,plugins:ok&&controller.liveChainRead===controller.target.id?copyData(controller.plugins):null,savedOnly:ok?controller.savedOnlyPlugins():null});}catch{}}}
  loadPlugin(id){
    const entry=this.catalog.find(item=>(this.isRestMode?item.id:item.path)===id),name=entry?.name||'effect';
    return this.historic(`Add ${name}`,()=>this.loadPluginNow(id),()=>{
      // The receipt's own chain read (taken inside the operation) and returned instance id name the added slot.
      const receipt=this.pluginMutation,body=receipt?.result?.structuredContent??receipt?.result,instance=body?.instanceId??body?.response?.instance_id??body?.response?.instanceId,before=new Set(list(receipt?.before).map(identity));
      const added=typeof instance==='string'?this.plugins.filter(plugin=>identity(plugin)===instance):this.plugins.filter(plugin=>!before.has(identity(plugin)));if(added.length!==1)return null;
      const original=identity(added[0]),index=added[0].index;let restore=null;
      return{detail:{laneId:this.target.id,op:'add',type:id,index,instanceId:original},
        previewUi:direction=>this.preview(direction==='undo'?{op:'remove',id:original}:{op:'insert',type:id,name,index})(),
        // Redo brings the plug-in back as Undo removed it (its saved state and instance id, when Freestyle returned them).
        undo:()=>this.historyRun(async controller=>{const current=this.resolveInstance(original);await MixerToolsController.removeById(controller,current,name);restore=lanePluginRestoreArguments(controller.pluginMutation?.result,id);return{removed:current};},{read:false}),
        redo:()=>this.historyRun(async controller=>{const created=await MixerToolsController.addAt(controller,id,index,false,restore);this.aliasInstance(this.resolveInstance(original),created);return{added:created};},{read:false})};
    });
  }
  remove(plugin){
    const original=identity(plugin),type=pluginType(plugin),index=plugin?.index,bypassed=plugin?.bypassed===true,name=plugin?.name||'effect';
    return this.historic(`Delete ${name}`,()=>this.removeNow(plugin),()=>{
      if(typeof type!=='string'||!type)return null;
      // 338: Undo sends the delete's own removed.restore body (addLanePlugin with
      // the original slot, bypass, saved state and instance id), so the effect
      // comes back exactly as it was. An older response without it: the same
      // type at the same slot with its bypass, default settings.
      let restore=lanePluginRestoreArguments(this.pluginMutation?.result,type);
      return{detail:{laneId:this.target.id,op:'delete',type,index,bypassed,instanceId:original,restoresState:!!restore?.state},
        previewUi:direction=>this.preview(direction==='undo'?{op:'insert',type,name,index:restore?.position??index,bypassed:restore?.bypassed??bypassed}:{op:'remove',id:original})(),
        undo:()=>this.historyRun(async controller=>{const created=await MixerToolsController.addAt(controller,type,restore?.position??index,restore?.bypassed??bypassed,restore);this.aliasInstance(this.resolveInstance(original),created);return{added:created,restoredState:controller.pluginMutation?.result?.restoredState===true};},{read:false}),
        redo:()=>this.historyRun(async controller=>{const current=this.resolveInstance(original);await MixerToolsController.removeById(controller,current,name);restore=lanePluginRestoreArguments(controller.pluginMutation?.result,type)??restore;return{removed:current};},{read:false})};
    });
  }
  move(plugin,toIndex){
    const original=identity(plugin),from=plugin?.index,name=plugin?.name||'effect';
    return this.historic(`Move ${name}`,()=>this.moveNow(plugin,toIndex),result=>{
      if(result?.unchanged||!Number.isInteger(from))return null;
      const go=to=>this.historyRun(async controller=>{const current=this.resolveInstance(original);await MixerToolsController.moveTo(controller,current,to,name);return{moved:current,to};},{read:false});
      return{detail:{laneId:this.target.id,op:'move',from,to:toIndex,instanceId:original},previewUi:direction=>this.preview({op:'move',id:original,to:direction==='undo'?from:toIndex})(),undo:()=>go(from),redo:()=>go(toIndex)};
    });
  }
  bypass(plugin,options={}){
    const original=identity(plugin),name=plugin?.name||'effect',before=plugin?.bypassed===true;
    return this.historic(`${before?'Enable':'Bypass'} ${name}`,()=>this.bypassNow(plugin,options),()=>{
      const go=from=>this.historyRun(async controller=>{await controller.bypassNow(MixerToolsController.current(controller,this.resolveInstance(original),name),{expectedBypassed:from});return{bypassed:!from};});
      return{detail:{laneId:this.target.id,op:'bypass',bypassed:!before,instanceId:original},previewUi:direction=>this.preview({op:'bypass',id:original,bypassed:direction==='undo'?before:!before})(),undo:()=>go(!before),redo:()=>go(before)};
    });
  }
  replacePlugin(old,id){
    const oldOriginal=identity(old),oldType=pluginType(old),index=old?.index,bypassed=old?.bypassed===true;
    return this.historic(`Replace ${old?.name||'effect'}`,()=>this.replacePluginNow(old,id),result=>{
      if(!result?.replaced||typeof oldType!=='string')return null;const addedOriginal=identity(result.added);
      // The replaced plug-in's delete receipt (the last operation) carries its restore body.
      let restoreOld=lanePluginRestoreArguments(this.pluginMutation?.result,oldType),restoreNew=null;
      const newName=result.added?.name||id,oldName=old?.name||oldType;
      return{detail:{laneId:this.target.id,op:'replace',from:oldType,to:id,index,instanceId:addedOriginal,replacedInstanceId:oldOriginal},
        previewUi:direction=>this.preview(direction==='undo'?{op:'swap',id:addedOriginal,type:oldType,name:oldName}:{op:'swap',id:oldOriginal,type:id,name:newName})(),
        undo:()=>this.historyRun(async controller=>{await controller.removeNow(MixerToolsController.current(controller,this.resolveInstance(addedOriginal)));restoreNew=lanePluginRestoreArguments(controller.pluginMutation?.result,id)??restoreNew;const created=await MixerToolsController.addAt(controller,oldType,restoreOld?.position??index,restoreOld?.bypassed??bypassed,restoreOld);this.aliasInstance(this.resolveInstance(oldOriginal),created);return{restored:created};}),
        redo:()=>this.historyRun(async controller=>{await controller.removeNow(MixerToolsController.current(controller,this.resolveInstance(oldOriginal)));restoreOld=lanePluginRestoreArguments(controller.pluginMutation?.result,oldType)??restoreOld;const created=await MixerToolsController.addAt(controller,id,restoreNew?.position??index,restoreNew?.bypassed??false,restoreNew);this.aliasInstance(this.resolveInstance(addedOriginal),created);return{added:created};})};
    });
  }
  removeSavedOnly(row){
    // A saved-only row has no live plug-in to restore, so its removal is a step whose Undo is refused.
    return this.historic(`Remove missing ${row?.name||'plugin'}`,()=>this.removeSavedOnlyNow(row),()=>({detail:{laneId:this.target.id,op:'remove_missing',pluginKey:row?.pluginKey},undo:async()=>{throw Object.assign(new Error('A removed missing plugin cannot be restored: it was never loaded.'),{dispatched:false});},redo:async()=>({})}));
  }
  /** FL "missing plugin" slot → Remove: the saved-only row goes in the same single call. */
  removeSavedOnlyNow(row){
    if(!this.isRestMode||this.target.kind!=='lane')return Promise.reject(new Error('Missing-plugin rows belong to a saved lane chain.'));
    if(!this.canRemovePlugin)return Promise.reject(unavailable('Removing a plugin'));
    const key=row?.pluginKey;if(typeof key!=='string'||!key)return Promise.reject(new Error('Select the exact missing plugin row to remove.'));
    return this.removeLaneInstance(key,{live:false});
  }
  removeLaneInstance(instanceId,{live}){
    if(typeof instanceId!=='string'||!instanceId)return Promise.reject(new Error('Select the exact plugin instance to remove.'));
    const laneId=this.target.id;
    return this.pluginOperation('remove',async()=>{
      // A live instance is removed by id (Freestyle refuses an unknown one): no pre-read. A
      // saved-only row is checked against a fresh saved chain first.
      if(!live)await this.restLane({kind:'lane',id:laneId},()=>{if(this.target.kind!=='lane'||this.target.id!==laneId)throw new Error('The selected mixer lane changed.');});
      const saved=list(savedLaneChain(this.savedProject,laneId)).some(row=>row?.pluginKey===instanceId);
      if(!live&&!saved)throw Object.assign(new Error('That missing plugin row is no longer in the saved chain. The chain was refreshed.'),{explicitRejection:true,dispatched:false});
      const track=this.context().track_id;
      const local=(payload,raw)=>{
        // removed:{instanceId,live,saved} is Freestyle's own receipt for both chains (top level of the action result).
        const removed=raw?.removed??payload?.removed;if(removed?.instanceId!==instanceId||removed.saved!==true&&saved||live&&removed.live!==true)return false;
        this.plugins=normalizeLoadedPlugins(this.plugins.filter(plugin=>identity(plugin)!==instanceId).map((plugin,index)=>({...plugin,index})));
        // FL: the removed plug-in's window closes (the receipt is the chain read; no refresh follows).
        // Only that exact instance's windows: this controller may not have read the whole chain.
        closePluginWindowsFor({projectId:this.projectId,laneId,instanceId,reason:'removed'});
        // Mirrors Freestyle's own dense renumbering of the saved positions (338).
        const lane=list(this.savedProject?.lanes).find(item=>item?.id===laneId);if(lane&&Array.isArray(lane.pluginChain))lane.pluginChain=lane.pluginChain.filter(row=>row?.pluginKey!==instanceId).map((row,position)=>({...row,position}));
        this.liveChainRead=laneId;return true;
      };
      return{studio:lanePluginInstanceDeleteRequest({projectId:this.projectId,laneId,instanceId,trackId:track}),review:{instanceId,live,saved},local};
    },()=>!this.plugins.some(current=>identity(current)===instanceId)&&!list(savedLaneChain(this.savedProject,laneId)).some(row=>row?.pluginKey===instanceId));
  }
  /** One generated-client request through the same-origin /api/studio proxy (no MCP alias exists for it). */
  async studioCall(request,{idempotencyKey}={}){
    this.assertScope();const client=new StudioApiClient({fetch:(...args)=>this.fetch(...args)});
    let result;try{result=await client.call(request.operationId,{path:request.path,...(request.query?{query:request.query}:{})},{idempotencyKey});}
    catch(error){if(error?.status)error.explicitRejection=error.status>=400&&error.status<500&&error.status!==408&&error.code!=='idempotency_in_progress';throw error;}
    this.assertScope();const data=result.data;
    // DELETE 200 declares no body schema: the HTTP 200 is the acknowledgement.
    return record(data)&&Object.keys(data).length?structuredClone(data):{ok:true,httpStatus:result.status,operationId:request.operationId};
  }
  route(busId){
    if(this.target.kind!=='lane'||!this.isRestMode&&!Number.isInteger(this.runtimeTrack?.id))return Promise.reject(new Error('Select a lane loaded in the live engine before changing its output.'));
    if(!this.targets().some(target=>target.kind==='bus'&&target.id===busId))return Promise.reject(new Error('Choose a bus returned by the cloud mixer.'));
    if(this.isRestMode)return this.changed(async()=>{const target={...this.target};await this.restLane(target,()=>{if(target.kind!==this.target.kind||target.id!==this.target.id)throw new Error('The selected mixer lane changed.');});return this.call('set_lane_routing',{project_id:this.projectId,lane_id:target.id,bus_id:busId});});
    return this.changed(()=>this.invokeAction('route_track_to_bus',{track_id:this.runtimeTrack.id,bus_id:busId}));
  }
  async chainPresets(){if(this.isRestMode){if(!this.operations.has('listCatalogVocalChainPresets')||!this.operations.has('getCatalogVocalChainPreset'))throw unavailable('Browsing chain presets');this.presets=await this.paged('list_vocal_chain_presets',{source:'library',song_project_id:this.projectId,limit:200});this.presetsTruncated=false;return this.presets;}const data=await this.call('list_vocal_chain_presets',{source:'library',limit:100});this.presets=list(data.presets);this.presetsTruncated=!!data.truncated||!!data._truncated;return this.presets;}
  async inspectPreset(id){if(!this.presets?.some(preset=>preset.id===id))throw new Error('Choose a preset returned by Freestyle.');return this.call('get_vocal_chain_preset',{preset_id:id});}
  applyPreset(id){
    if(this.isRestMode)return Promise.reject(unavailable('Applying a complete chain preset'));
    if(this.target.kind!=='lane')return Promise.reject(new Error('Chain presets apply to cloud lanes. Choose a lane first.'));
    if(!this.presets?.some(preset=>preset.id===id))return Promise.reject(new Error('Choose a preset returned by Freestyle.'));
    return this.changed(()=>this.call('apply_vocal_chain_preset',{project_id:this.projectId,lane_id:this.target.id,preset_id:id}));
  }
  async effectPresets(kind,query=''){if(this.isRestMode){if(!this.operations.has('listCatalogEffectPresets'))throw unavailable('Browsing effect presets');if(!['nectar','autotune','filter'].includes(kind))throw new Error('Choose a supported preset catalog.');const presets=await this.paged('list_effect_presets',{kind,...(query?{q:query}:{}),limit:200});this.effectPresetNames=new Set(presets.map(preset=>typeof preset==='string'?preset:preset.name).filter(name=>typeof name==='string'&&name));return{presets,truncated:false};}if(!['nectar','autotune','filter'].includes(kind))throw new Error('Choose a supported preset catalog.');const data=await this.call('list_effect_presets',{kind,query,limit:400});this.effectPresetNames=new Set(list(data.presets).map(preset=>typeof preset==='string'?preset:preset.name).filter(Boolean));return data;}
  async pluginPresets(plugin){const current=await this.ensurePlugin(plugin);if(!this.isRestMode)return this.effectPresets('nectar');if(typeof current.type_id!=='string'||!current.type_id)throw new Error('Read this plugin’s catalog type before browsing its presets.');const entry=await this.call('get_catalog_plugin',{plugin_id:current.type_id});if(entry.id!==current.type_id||!['nectar','autotune','filter'].includes(entry.presetCatalog))throw new Error('This plugin has no returned named-preset catalog.');const result=await this.effectPresets(entry.presetCatalog);this.effectPresetOwner={laneId:this.target.id,instance:identity(current)};return result;}
  applyEffectPreset(plugin,name){
    if(this.target.kind!=='lane'||!this.effectPresetNames?.has(name))return Promise.reject(new Error('Choose a preset returned for the selected lane plugin.'));
    if(this.isRestMode){if(this.effectPresetOwner?.laneId!==this.target.id||this.effectPresetOwner.instance!==identity(plugin))return Promise.reject(new Error('Browse the presets of this exact plugin before applying one.'));return this.pluginOperation('preset',async()=>{const current=await this.ensurePlugin(plugin);return{name:'apply_plugin_preset',args:{...this.context(),lane_id:this.target.id,plugin_index:current.index,preset:name,...expectedPluginFields(current)}};},async()=>{await this.readPlugin(plugin.index);return this.snapshot?.plugin_loaded===true;});}
    return this.changed(async()=>{const current=await this.ensurePlugin(plugin);return this.call('apply_plugin_preset',{...this.context(),lane_id:this.target.id,plugin_index:current.index,preset:name});});
  }
  async savedState(){return this.target.kind==='lane'?this.call('get_saved_plugin_state',{project_id:this.projectId,lane_id:this.target.id}):this.call('get_bus_plugin_state',{project_id:this.projectId,bus_id:this.target.id});}
}

function copyReceiptMessage(receipt){return receipt.status==='saved_reload_required'?'Chain saved. Reload the session to hear the copied chain.'+(receipt.engineSkipped.length?' '+receipt.engineSkipped.length+(receipt.engineSkipped.length===1?' plugin could not be instantiated.':' plugins could not be instantiated.'):''):receipt.status==='saved_and_loaded'?'Chain saved; matching plugins loaded.':receipt.status==='matching_state_observed'?'Matching saved and loaded chains observed. The copy was not acknowledged.':receipt.savedConfirmed&&!receipt.nativeConfirmed?'Chain saved; loaded plugins are not confirmed. Inspect before another copy.':receipt.requiresInspection?'The previous copy needs inspection before another copy.':'Copy inspection complete; the saved or loaded chain is unconfirmed.';}
/**
 * Logic Mix ▸ Paste Channel Strip Setting: a compact review sheet over the same
 * reviewed copy-chain path as the Copy Channel Strip tab (prepareChainCopy reads,
 * copyChain re-verifies the review and sends one copy_lane_effect_chain write with
 * its receipt journal). Cancel / Esc close without writing; Esc is ignored mid-send.
 */
export async function openPasteChannelStripSheet(options){
  const sourceId=typeof options.copySourceId==='string'&&options.copySourceId?options.copySourceId:null,controller=new MixerToolsController(options),dialog=document.createElement('dialog');
  dialog.className='studio-dialog logic-paste-strip';dialog.setAttribute('aria-label','Paste Channel Strip Setting');dialog.controller=controller;dialog.dataset.state='reading';
  dialog.innerHTML='<header><strong>Paste Channel Strip Setting</strong></header><div class="lps-body"><p class="lps-route">Reading the copied channel strip…</p><ol class="lps-plugins"></ol><p class="lps-replace"></p><p class="lps-status" role="status"></p></div><footer><button type="button" class="lps-inspect" hidden>Inspect Copy</button><span class="lps-spacer"></span><button type="button" class="lps-cancel">Cancel</button><button type="button" class="lps-paste primary" disabled>Paste</button></footer>';
  document.body.append(dialog);dialog.showModal();
  const $=selector=>dialog.querySelector(selector),status=(message,error=false)=>{const node=$('.lps-status');node.textContent=message;node.classList.toggle('error',error);};
  let sending=false,pasted=false;
  const close=()=>{if(sending||!dialog.isConnected)return;if(dialog.open)dialog.close();dialog.remove();},inspectable=()=>{$('.lps-inspect').hidden=!controller.copyReceipt?.requiresInspection||!!controller.copyReceipt?.inFlight;};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}});
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});$('.lps-cancel').onclick=close;
  const show=review=>{
    const names=review.sourceNative.map(plugin=>plugin.name||plugin.type_id||plugin.path||'Plug-in'),existing=review.destinationNative?review.destinationNative.length:review.destinationChain.length;
    $('.lps-route').innerHTML=`From <strong>${esc(review.sourceName)}</strong> → <strong>${esc(review.destinationName)}</strong>`;
    $('.lps-plugins').innerHTML=names.map(name=>`<li>${esc(name)}</li>`).join('');$('.lps-plugins').hidden=!names.length;
    $('.lps-replace').textContent=`${names.length?'':'The copied channel strip has no plug-ins; pasting clears the destination. '}${existing} existing plug-in${existing===1?'':'s'} will be replaced.${review.destinationNative?'':' The destination is not loaded; its saved chain is replaced.'}`;
    dialog.dataset.state='review';$('.lps-paste').disabled=false;$('.lps-paste').focus?.();
  };
  const prepare=async()=>{
    $('.lps-paste').disabled=true;dialog.dataset.state='reading';
    try{if(!sourceId)throw new Error('Copy an audio track’s channel strip setting first.');const review=await controller.prepareChainCopy(sourceId);if(dialog.isConnected)show(review);}
    catch(error){if(dialog.isConnected){dialog.dataset.state='error';$('.lps-route').textContent='The channel strip setting cannot be pasted.';status(error.message,true);inspectable();}}
  };
  $('.lps-paste').onclick=async()=>{
    if(sending||pasted||dialog.dataset.state!=='review')return;sending=true;pasted=true;$('.lps-paste').disabled=true;$('.lps-cancel').disabled=true;dialog.dataset.state='sending';status('Pasting…');
    try{const receipt=await controller.copyChain();sending=false;if(receipt.status==='saved_and_loaded'){dialog.dataset.state='done';options.onPasted?.(receipt);close();return;}dialog.dataset.state='done';status(copyReceiptMessage(receipt),!!receipt.requiresInspection);}
    catch(error){dialog.dataset.state='error';status(`${error.message}${error.retryAfterSec?` Try again in ${error.retryAfterSec} seconds.`:''}`,true);}
    finally{sending=false;if(dialog.isConnected){$('.lps-cancel').disabled=false;$('.lps-cancel').textContent='Close';inspectable();}}
  };
  $('.lps-inspect').onclick=async()=>{
    $('.lps-inspect').disabled=true;try{const receipt=await controller.inspectChainCopy();status(copyReceiptMessage(receipt),!!receipt.requiresInspection);if(!pasted&&!receipt.requiresInspection)await prepare();}
    catch(error){status(error.message,true);}finally{if(dialog.isConnected){$('.lps-inspect').disabled=false;inspectable();}}
  };
  await prepare();return dialog;
}
function stylesheet(){if(document.querySelector('link[data-mixer-tools]')||document.querySelector('link[href$="mixer-tools.css"]')||!import.meta.url.endsWith('/mixer-tools.js'))return;const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./mixer-tools.css',import.meta.url).href;link.dataset.mixerTools='';document.head.append(link);}
export async function openMixerTools(options){
  stylesheet();const picker=options.initialTab==='catalog',controller=new MixerToolsController(options),dialog=document.createElement('dialog');controller.tab=picker?'catalog':options.initialTab==='copy'?'copy':'slots';dialog.className='mixer-tools studio-dialog'+(picker?' mix-picker':' logic-strip-tools');dialog.setAttribute('aria-label','Channel Strip');
  dialog.innerHTML='<header><span class="mix-indicator"></span><strong>Channel Strip</strong><button class="mix-close" aria-label="Close channel strip">×</button></header><div class="mix-toolbar"><label>Channel <select class="mix-target" aria-label="Track or bus channel strip"></select></label><button class="mix-refresh">Refresh</button><button class="mix-inspect-operation" hidden>Inspect plug-in operation</button></div><div class="mix-main"><aside class="mix-slots"></aside><section class="mix-details"><nav class="mix-tabs"><button data-tab="slots">Plug-in Parameters</button><button data-tab="catalog">Insert Plug-in</button><button data-tab="presets">Patches</button><button data-tab="routing">Output</button><button data-tab="copy">Copy Channel Strip</button></nav><div class="mix-content"></div></section></div><footer class="mix-status" role="status">Reading the cloud mixer…</footer>';
  document.body.append(dialog);dialog.showModal();dialog.controller=controller;
  const $=selector=>dialog.querySelector(selector),status=(message,error=false)=>{$('.mix-status').textContent=message;$('.mix-status').classList.toggle('error',error);};
  // Logic Paste Channel Strip Setting: open on Copy with the copied track's chain read for review (once).
  let autoCopySource=typeof options.copySourceId==='string'&&options.copySourceId?options.copySourceId:null;
  let viewGeneration=0,catalogQuery='',catalogCategory='',replacing=options.replacePlugin&&controller.target.kind==='lane'?{laneId:controller.target.id,plugin:options.replacePlugin}:null;
  // Recovery is a real header action in the picker, never inside hidden chrome.
  if(picker)$('header').insertBefore($('.mix-inspect-operation'),$('.mix-close'));
  function syncPicker(){
    const active=picker&&controller.tab==='catalog',hide=(node,value)=>{node.hidden=value;node.classList.toggle('hidden',value);};
    dialog.dataset.pickerActive=String(active);hide($('.mix-toolbar'),active);hide($('.mix-slots'),active);hide($('.mix-tabs'),active);
    const heading=$('header strong');heading.classList.toggle('mix-picker-heading',active);heading.textContent=active?`${replacing?`Replace ${replacing.plugin?.name||'effect'}`:'Effects'}${controller.targetInfo?.name?' · '+controller.targetInfo.name:''}`:`${controller.targetInfo?.name||'Channel'} — Channel Strip`;
    dialog.setAttribute('aria-label',heading.textContent);hide($('.mix-inspect-operation'),!controller.pluginMutation?.requiresInspection);
  }
  syncPicker();if(picker){const content=$('.mix-content');content.textContent='Loading effects…';content.dataset.catalogState='loading';content.style.overflow='auto';content.setAttribute('aria-busy','true');}
  const run=async task=>{dialog.classList.add('mix-working');$('.mix-target').disabled=true;status('Sending to Freestyle…');try{await task();if(dialog.isConnected){const rendered=await render();if(!rendered?.error)status(controller.pluginMutation?.requiresInspection?'Plugin confirmation pending. Inspect before another edit.':controller.tab==='copy'?'Chain copy state updated':'Cloud mixer updated',!!controller.pluginMutation?.requiresInspection);}}catch(error){if(dialog.isConnected)render();status(`${error.message}${error.retryAfterSec?` Try again in ${error.retryAfterSec} seconds.`:''}`,true);}finally{dialog.classList.remove('mix-working');$('.mix-target').disabled=false;}};
  $('.mix-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{viewGeneration++;dialog.remove();},{once:true});$('.mix-refresh').onclick=()=>run(()=>controller.refresh());$('.mix-inspect-operation').onclick=()=>run(()=>controller.inspectPluginOperation());
  $('.mix-target').onchange=event=>{const value=event.target.value,index=value.indexOf(':');run(()=>controller.setTarget(value.slice(0,index),value.slice(index+1)));};
  for(const button of dialog.querySelectorAll('[data-tab]'))button.onclick=()=>{controller.tab=button.dataset.tab;return renderContent({focusCatalog:controller.tab==='catalog'});};
  function render({focusCatalog=false,contentError=null}={}){
    if(!dialog.isConnected)return;syncPicker();
    const target=$('.mix-target');target.innerHTML=controller.targets().map(item=>`<option value="${esc(`${item.kind}:${item.id}`)}">${esc(item.name)}${item.kind==='bus'?' · BUS':''}</option>`).join('');
    const value=`${controller.target.kind}:${controller.target.id}`;
    if([...target.options].some(option=>option.value===value))target.value=value;else{const option=document.createElement('option');option.textContent='Choose a cloud lane or bus';option.value='';option.disabled=true;option.selected=true;target.prepend(option);}
    renderSlots();if(contentError){const content=$('.mix-content');content.textContent=contentError;content.dataset.catalogState='error';content.style.overflow=picker?'auto':'';content.setAttribute('aria-busy','false');dialog.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('selected',button.dataset.tab===controller.tab));return{error:contentError};}return renderContent({focusCatalog});
  }
  function renderSlots(){
    const rows=controller.plugins.map((plugin,position)=>`<div class="mix-slot ${controller.selectedIndex===plugin.index?'selected':''}"><button class="mix-led ${plugin.bypassed?'off':''}" data-bypass="${position}" title="${plugin.bypassed?'Enable':'Bypass'} ${esc(plugin.name)}" aria-label="${plugin.bypassed?'Enable':'Bypass'} ${esc(plugin.name)}" ${plugin.index==null||!identity(plugin)?'disabled':''}></button><button class="mix-slot-name" data-select="${position}" ${plugin.index==null?'disabled':''}><small>${plugin.index==null?'?':plugin.index+1}</small>${esc(plugin.name)}</button><div class="mix-slot-order"><button data-up="${position}" title="Move up" ${position===0||!identity(plugin)||!controller.canMovePlugin?'disabled':''}>▴</button><button data-down="${position}" title="Move down" ${position===controller.plugins.length-1||!identity(plugin)||!controller.canMovePlugin?'disabled':''}>▾</button></div><button class="mix-remove" data-remove="${position}" title="Remove ${esc(plugin.name)}" aria-label="Remove ${esc(plugin.name)}" ${!identity(plugin)||!controller.canRemovePlugin?'disabled':''}>×</button></div>`);
    for(let i=rows.length;i<Math.max(8,controller.plugins.length);i++)rows.push(`<button class="mix-empty-slot" data-add title="${controller.canLoadPlugin?'Insert a plug-in in the next free Audio FX slot':'Plug-in loading awaits its Studio API operation'}" ${controller.canLoadPlugin?'':'disabled'} aria-label="Empty Audio FX slot ${i+1}"><small>${i+1}</small><span class="mix-empty-label"></span></button>`);
    $('.mix-slots').innerHTML=`<div class="mix-slot-heading">Audio FX <small>${controller.plugins.length}</small></div>${rows.join('')}`;
    $('.mix-slots').querySelectorAll('[data-select]').forEach(button=>button.onclick=()=>{const plugin=controller.plugins[+button.dataset.select];controller.tab='slots';run(()=>controller.readPlugin(plugin.index));});
    $('.mix-slots').querySelectorAll('[data-bypass]').forEach(button=>button.onclick=()=>run(()=>controller.bypass(controller.plugins[+button.dataset.bypass])));
    $('.mix-slots').querySelectorAll('[data-up]').forEach(button=>button.onclick=()=>{const p=+button.dataset.up;run(()=>controller.move(controller.plugins[p],controller.plugins[p-1].index));});
    $('.mix-slots').querySelectorAll('[data-down]').forEach(button=>button.onclick=()=>{const p=+button.dataset.down;run(()=>controller.move(controller.plugins[p],controller.plugins[p+1].index));});
    $('.mix-slots').querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>run(()=>controller.remove(controller.plugins[+button.dataset.remove])));
    $('.mix-slots').querySelectorAll('[data-add]').forEach(button=>button.onclick=()=>{controller.tab='catalog';return renderContent({focusCatalog:true});});
  }
  async function renderContent({focusCatalog=false}={}){
    const generation=++viewGeneration,content=$('.mix-content');syncPicker();content.style.overflow=picker&&controller.tab==='catalog'?'auto':'';content.dataset.catalogState=controller.tab==='catalog'?'loading':'';content.setAttribute('aria-busy',String(controller.tab==='catalog'));
    dialog.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('selected',button.dataset.tab===controller.tab));
    if(!controller.targetInfo&&!(picker&&controller.isRestMode&&controller.tab==='catalog')){content.dataset.catalogState='error';content.setAttribute('aria-busy','false');const message='Choose a persisted cloud lane or bus to edit its plugin chain.';content.innerHTML='<p class="mix-empty">'+message+'</p>';if(controller.tab==='catalog'){status(message,true);return{error:message};}return;}
    if(controller.tab==='copy'){
      if(!controller.canCopyChain){content.innerHTML='<h3>Copy Channel Strip</h3><p class="mix-note">Select a saved audio track to copy another audio track’s chain onto it.</p>';return;}
      if(!controller.copySources){content.innerHTML='<h3>Copy Channel Strip</h3><p>Reading saved tracks…</p>';try{await controller.readCopySources();if(generation!==viewGeneration||!dialog.isConnected)return;}catch(error){if(generation===viewGeneration)content.textContent=error.message;return;}}
      const review=controller.copyReview,receipt=controller.copyReceipt,destination=controller.targetInfo?.name||controller.target.id;
      content.innerHTML=`<h3>Copy Channel Strip</h3><p>Copying is supported between audio tracks. The complete returned chain will replace the chain on <strong>${esc(destination)}</strong>. Review every listed plugin before copying.</p><label>Copy from track<select class="mix-copy-source"><option value="">Choose source track</option>${controller.copySources.map(source=>`<option value="${esc(source.id)}">${esc(source.name)}</option>`).join('')}</select></label><button class="mix-copy-review">Read source chain</button><div class="mix-copy-summary">${review?`<p>From <strong>${esc(review.sourceName)}</strong> → replace <strong>${esc(review.destinationName)}</strong></p><ol>${review.sourceNative.map(plugin=>`<li>${esc(plugin.name||plugin.type_id||plugin.path||'Plugin')}</li>`).join('')}</ol>${review.sourceNative.length?'':'<p>The source chain is empty. Copying it clears the destination chain.</p>'}<p>${review.destinationNative?review.destinationNative.length+' existing destination plugins will be replaced.':'The destination is not loaded. Its '+review.destinationChain.length+' saved chain entries will be replaced.'}</p><button class="mix-copy-apply primary">Paste Channel Strip Setting</button>`:''}</div>${receipt?`<p class="mix-copy-receipt">${copyReceiptMessage(receipt)}</p><button class="mix-copy-inspect">Inspect copy</button>`:''}`;
      const select=content.querySelector('.mix-copy-source');if(review)select.value=review.sourceId;select.onchange=()=>{controller.copyReview=null;content.querySelector('.mix-copy-summary').textContent='Read the selected source chain before copying it.';};content.querySelector('.mix-copy-review').disabled=!!receipt?.requiresInspection;content.querySelector('.mix-copy-review').onclick=()=>run(()=>controller.prepareChainCopy(select.value));content.querySelector('.mix-copy-apply')?.addEventListener('click',()=>run(()=>controller.copyChain()));content.querySelector('.mix-copy-inspect')?.addEventListener('click',()=>run(()=>controller.inspectChainCopy()));
      if(autoCopySource&&!review&&!receipt?.requiresInspection&&controller.copySources.some(source=>source.id===autoCopySource)){const source=autoCopySource;autoCopySource=null;select.value=source;run(()=>controller.prepareChainCopy(source));}
      return;
    }
    if(controller.tab==='catalog'){
      if(!controller.canLoadPlugin){content.dataset.catalogState='error';content.setAttribute('aria-busy','false');const message='Plugin loading is waiting for its Studio API operation. Select an existing loaded slot to edit its parameters or bypass.';content.innerHTML='<h3>Add a cloud plugin</h3><p class="mix-note">'+message+'</p>';status(message,true);return{error:message};}
      if(controller.isRestMode&&!controller.catalogLoaded){content.innerHTML='<p>Reading the plugin catalog…</p>';try{await controller.readCatalog({checkHost:!picker});if(generation!==viewGeneration||!dialog.isConnected)return;}catch(error){if(generation===viewGeneration&&dialog.isConnected){content.textContent=error.message;content.dataset.catalogState='error';content.setAttribute('aria-busy','false');status(error.message,true);}return{error:error.message};}}
      content.innerHTML=`<div class="mix-catalog-controls"><h3>${picker?'Effects':'Add a cloud plugin'}</h3><input class="mix-search" placeholder="Find a plugin…" aria-label="Search cloud plugins"><output class="mix-catalog-count" aria-live="polite"></output></div><div class="mix-catalog" role="group" aria-label="Available effects"></div><nav class="mix-categories" role="group" aria-label="Effect categories"></nav>`;
      const catalog=content.querySelector('.mix-catalog'),search=content.querySelector('.mix-search'),categoryBar=content.querySelector('.mix-categories'),count=content.querySelector('.mix-catalog-count'),categoryOf=item=>typeof item.category==='string'?item.category.trim():'',categories=[...new Set(controller.catalog.map(categoryOf).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
      if(catalogCategory&&!categories.includes(catalogCategory))catalogCategory='';search.value=catalogQuery;
      categoryBar.innerHTML=[['','All'],...categories.map(category=>[category,category])].map(([category,label])=>`<button type="button" data-category="${esc(category)}" aria-pressed="${category===catalogCategory}" tabindex="${category===catalogCategory?0:-1}">${esc(label)}</button>`).join('');
      const paint=()=>{
        const query=catalogQuery.toLocaleLowerCase(),rows=controller.catalog.filter(item=>(!catalogCategory||categoryOf(item)===catalogCategory)&&`${item.id||''} ${item.name} ${item.category||''}`.toLocaleLowerCase().includes(query)),recovery=!!controller.pluginMutation?.requiresInspection,notLive=controller.liveChainMissing,blockedTitle=recovery?'Inspect the previous plugin operation before adding another effect':notLive?controller.noLiveChainNotice:'';
        count.textContent=`${rows.length} of ${controller.catalog.length} effects`;catalog.scrollTop=0;
        content.querySelector('.mix-catalog-notice')?.remove();if(notLive&&!recovery){const notice=document.createElement('p');notice.className='mix-note mix-catalog-notice';notice.setAttribute('role','note');notice.textContent=blockedTitle;catalog.before(notice);}
        catalog.innerHTML=rows.map(item=>`<button class="mix-catalog-item" data-path="${esc(controller.isRestMode?item.id:item.path)}" ${item.hostGated||recovery||notLive?'disabled':''} ${blockedTitle?`title="${esc(blockedTitle)}"`:''}><span class="mix-catalog-name">${esc(item.name)}<small>${esc(categoryOf(item)||item.kind||'Plugin')}</small></span><b>${item.availability==='loaded'?'IN SESSION':item.hostGated?'HOST ACCESS':'＋ LOAD'}</b></button>`).join('')||'<p class="mix-empty">No matching catalog plugins.</p>';
        catalog.querySelectorAll('[data-path]').forEach(button=>button.onclick=()=>run(()=>{if(replacing&&controller.target.kind==='lane'&&controller.target.id===replacing.laneId){const target=replacing.plugin;replacing=null;return controller.replacePlugin(target,button.dataset.path);}return controller.loadPlugin(button.dataset.path);}));
        for(const button of categoryBar.querySelectorAll('[data-category]')){const selected=button.dataset.category===catalogCategory;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));button.tabIndex=selected?0:-1;}
      };
      const chooseCategory=button=>{catalogCategory=button.dataset.category;paint();};
      const reveal=button=>{button?.focus({preventScroll:true});button?.scrollIntoView?.({block:'nearest',inline:'nearest'});};
      const navigationAllowed=event=>!event.defaultPrevented&&!event.isComposing&&event.keyCode!==229&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&generation===viewGeneration&&dialog.isConnected;
      // The native FL picker uses horizontal arrows for categories and vertical
      // arrows for successive plugins, independently of the gallery's wrapping.
      const pickerKey=(event,origin=event.target)=>{
        if(!picker||!navigationAllowed(event)||origin?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
        const categories=[...categoryBar.querySelectorAll('[data-category]')],cards=[...catalog.querySelectorAll('[data-path]:not(:disabled)')],card=origin?.closest?.('[data-path]'),category=origin?.closest?.('[data-category]');
        if(['ArrowLeft','ArrowRight'].includes(event.key)){
          const index=categories.findIndex(button=>button.dataset.category===(category?.dataset.category??catalogCategory)),next=categories[(index+(event.key==='ArrowRight'?1:categories.length-1))%categories.length];
          if(next){event.preventDefault();chooseCategory(next);reveal(next);}return;
        }
        if(['ArrowUp','ArrowDown'].includes(event.key)){
          event.preventDefault();if(!cards.length)return;const index=cards.indexOf(card),next=index<0?(event.key==='ArrowDown'?cards[0]:cards.at(-1)):cards[Math.max(0,Math.min(cards.length-1,index+(event.key==='ArrowDown'?1:-1)))];reveal(next);return;
        }
        if(card&&['Home','End'].includes(event.key)){event.preventDefault();reveal(event.key==='Home'?cards[0]:cards.at(-1));}
      };
      content.onkeydown=pickerKey;
      for(const button of categoryBar.querySelectorAll('[data-category]')){
        button.onclick=()=>chooseCategory(button);button.onkeydown=event=>{if(!navigationAllowed(event))return;if(picker&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){pickerKey(event,button);return;}const buttons=[...categoryBar.querySelectorAll('[data-category]')],index=buttons.indexOf(button),next=event.key==='Home'?buttons[0]:event.key==='End'?buttons.at(-1):['ArrowRight','ArrowDown'].includes(event.key)?buttons[(index+1)%buttons.length]:['ArrowLeft','ArrowUp'].includes(event.key)?buttons[(index+buttons.length-1)%buttons.length]:null;if(next){event.preventDefault();chooseCategory(next);reveal(next);}};
      }
      search.oninput=()=>{catalogQuery=search.value;paint();};search.onkeydown=event=>{if(navigationAllowed(event)&&event.key==='ArrowDown'){const first=catalog.querySelector('button:not(:disabled)');if(first){event.preventDefault();reveal(first);}}};paint();
      content.dataset.catalogState='ready';content.style.overflow='';content.setAttribute('aria-busy','false');if(focusCatalog&&generation===viewGeneration&&dialog.isConnected)search.focus({preventScroll:true});return;
    }
    if(controller.tab==='routing'){
      if(typeof options.onRoute==='function'){content.innerHTML='<h3>Output</h3><p class="mix-note">Choose the lane and output in the Mixer routing window.</p><button class="mix-route-review primary">Open mixer routing</button>';content.querySelector('button').onclick=()=>{const laneId=controller.target.kind==='lane'?controller.target.id:undefined;try{options.assertScope?.();dialog.close();options.onRoute({laneId});}catch(error){status(error.message,true);}};return;}
      const buses=controller.targets().filter(item=>item.kind==='bus'),runtime=controller.runtimeTrack;
      content.innerHTML=`<h3>Output</h3><p class="mix-note">${controller.target.kind==='lane'?'Send this lane to a cloud mixer bus.':'Bus output routing is managed by Freestyle.'}</p><label>Output bus<select class="mix-route" ${controller.target.kind!=='lane'||!(controller.isRestMode?controller.targetInfo:runtime)?'disabled':''}>${buses.map(bus=>`<option value="${esc(bus.id)}">${esc(bus.name)}</option>`).join('')}</select></label><button class="mix-route-apply primary" ${controller.target.kind!=='lane'||!(controller.isRestMode?controller.targetInfo:runtime)||!buses.length?'disabled':''}>Route lane</button>${controller.target.kind==='lane'&&!controller.isRestMode&&!runtime?'<p class="mix-note">This persisted lane is not loaded in the live engine yet.</p>':''}<div class="mix-bus-list">${buses.map(bus=>`<div><span>${esc(bus.name)}</span><small>${list(bus.raw.plugins).length} plugin${list(bus.raw.plugins).length===1?'':'s'}</small></div>`).join('')}</div>`;
      const select=content.querySelector('.mix-route');if(runtime?.bus_id)select.value=runtime.bus_id;else if(controller.isRestMode&&controller.targetInfo?.raw?.busId)select.value=controller.targetInfo.raw.busId;content.querySelector('.mix-route-apply').onclick=()=>run(()=>controller.route(select.value));return;
    }
    if(controller.tab==='presets'){
      if(controller.target.kind!=='lane'){content.innerHTML='<p class="mix-empty">Choose a lane to browse and apply complete chain presets.</p>';return;}
      content.innerHTML='<h3>Patches</h3><p class="mix-note">Applying a preset replaces the selected lane’s processing chain.</p><div class="mix-preset-list">Loading your cloud preset library…</div><div class="mix-preset-preview"></div>';
      try{const presets=await controller.chainPresets();if(generation!==viewGeneration||!dialog.isConnected)return;const container=content.querySelector('.mix-preset-list');container.innerHTML=presets.map(preset=>`<button data-preset="${esc(preset.id)}"><span>${esc(preset.name)}</span><small>${esc(preset.chainKind||'Chain')}</small></button>`).join('')||'<p class="mix-empty">No chain presets returned.</p>';for(const button of container.querySelectorAll('[data-preset]'))button.onclick=async()=>{const preview=content.querySelector('.mix-preset-preview');preview.textContent='Reading the selected preset…';try{const result=await controller.inspectPreset(button.dataset.preset);if(generation!==viewGeneration)return;preview.innerHTML=`<strong>${esc(result.preset?.name||button.textContent)}</strong><p>${list(result.chain?.plugins).map(plugin=>esc(plugin.name||plugin.label||plugin.type||'Plugin')).join(' → ')||'Cloud processing chain'}</p><button class="primary mix-apply-preset" ${controller.isRestMode?'disabled title="Applying complete chain presets awaits its API operation"':''}>Apply to ${esc(controller.targetInfo?.name)}</button>`;preview.querySelector('button').onclick=()=>run(()=>controller.applyPreset(button.dataset.preset));}catch(error){preview.textContent=error.message;}};
      }catch(error){if(generation===viewGeneration)content.querySelector('.mix-preset-list').textContent=error.message;}return;
    }
    const plugin=controller.plugins.find(item=>item.index===controller.selectedIndex);
    if(!plugin){content.innerHTML='<h3>Plug-in Parameters</h3><p class="mix-empty">Select a loaded slot to read its parameters and programs from Freestyle.</p><p class="mix-note">Plugin load, processing and audio rendering run in the cloud.</p>';return;}
    content.innerHTML=`<h3>${esc(plugin.name)}</h3><div class="mix-plugin-meta">SLOT ${plugin.index+1} <span>${esc(plugin.format||'CLOUD PLUGIN')}</span></div><div class="mix-parameters"></div><div class="mix-program"></div><div class="mix-effect-presets"></div><button class="mix-snapshot">Read saved chain state</button><span class="mix-snapshot-status"></span>`;
    const parameters=content.querySelector('.mix-parameters');parameters.innerHTML=controller.parameters.length?controller.parameters.map(parameter=>{
      const control=controller.parameterControl(parameter),min=control?.min??0,max=control?.max??1,step=control?.step??'any',amount=control?.value??'',unit=control?.valueUnit||parameter.unit||'value';
      return `<label class="mix-parameter"><span>${esc(parameter.name)}<small>${esc(parameter.display||parameter.unit||'')} · #${parameter.index}</small></span><input type="range" min="${min}" max="${max}" step="${step}" data-param="${parameter.index}" value="${amount}" ${control?'':'disabled'} aria-label="${esc(parameter.name)}"><input class="mix-param-value" type="number" min="${min}" max="${max}" step="${step}" data-value="${parameter.index}" value="${amount}" ${control?'':'disabled'} aria-label="${esc(parameter.name)} ${esc(unit)} value"></label>`;
    }).join(''):'<p class="mix-empty">No editable parameter contracts were returned for this plugin. Its original cloud editor may provide additional controls.</p>';
    if(controller.isRestMode){const pagination=controller.parameterPagination,more=document.createElement('div');more.className='mix-parameter-pagination';more.innerHTML=`<p>${pagination.loaded} of ${pagination.total??'unknown'} parameters loaded${pagination.stale?' · Reload to refresh other loaded controls.':''}${pagination.invalid?' · '+esc(pagination.error||'Read this plugin again.'):''}</p>${pagination.hasMore?`<button class="mix-parameter-more" ${pagination.busy?'disabled':''}>${pagination.busy?'Loading…':'Load more parameters'}</button>`:''}`;parameters.after(more);const button=more.querySelector('button');if(button)button.onclick=()=>{button.disabled=true;button.textContent='Loading…';return run(()=>controller.loadMoreParameters());};}
    parameters.querySelectorAll('[data-param]').forEach(input=>{input.oninput=()=>{parameters.querySelector(`[data-value="${input.dataset.param}"]`).value=input.value;controller.liveParameter(plugin,+input.dataset.param,input.valueAsNumber);};input.onchange=()=>{const amount=input.valueAsNumber;controller.liveParameter(plugin,+input.dataset.param,amount,{flush:true});return run(()=>controller.queueParameter(plugin,+input.dataset.param,amount));};});parameters.querySelectorAll('[data-value]').forEach(input=>input.onchange=()=>{const amount=input.valueAsNumber;controller.liveParameter(plugin,+input.dataset.value,amount,{flush:true});return run(()=>controller.queueParameter(plugin,+input.dataset.value,amount));});
    const count=controller.snapshot?.program_count;if(controller.target.kind==='lane'&&Number.isInteger(count)&&count>0&&count<=4096){const programs=list(controller.snapshot.programs);content.querySelector('.mix-program').innerHTML=`<label>Program<select class="mix-program-select">${Array.from({length:count},(_,index)=>`<option value="${index}">${esc(programs.find(program=>program.index===index)?.name||`Program ${index+1}`)}</option>`).join('')}</select></label>`;const select=content.querySelector('.mix-program-select');select.value=controller.snapshot.current_program_index;select.onchange=()=>run(()=>controller.program(plugin,+select.value));}
    if(controller.target.kind==='lane'&&(controller.isRestMode?typeof plugin.type_id==='string':/nectar/i.test(plugin.name))){content.querySelector('.mix-effect-presets').innerHTML='<button class="mix-effect-browse">Browse plugin presets</button><div class="mix-effect-results"></div>';content.querySelector('.mix-effect-browse').onclick=async()=>{const box=content.querySelector('.mix-effect-results');box.textContent='Reading the Nectar catalog…';try{const result=await controller.pluginPresets(plugin);if(generation!==viewGeneration)return;box.innerHTML=`<select>${[...controller.effectPresetNames].map(name=>`<option>${esc(name)}</option>`).join('')}</select><button>Apply plugin preset</button>${result.truncated?'<small>Catalog limited by Freestyle.</small>':''}`;box.querySelector('button').onclick=()=>run(()=>controller.applyEffectPreset(plugin,box.querySelector('select').value));}catch(error){box.textContent=error.message;}};}
    content.querySelector('.mix-snapshot').onclick=async()=>{const target=content.querySelector('.mix-snapshot-status');target.textContent=' Reading…';try{const result=await controller.savedState();target.textContent=` ${list(result.plugins||result.snapshots).length} saved plugin snapshots`;}catch(error){target.textContent=` ${error.message}`;}};
  }
  // 339: list_plugins answers within 250 ms (stale:true when it used the engine's
  // last known chain; the controller re-reads once in the background and this
  // window repaints). The saved chain stays the read-only placeholder meanwhile.
  controller.onStaleReread=()=>{if(dialog.isConnected)try{render();}catch{}};
  async function refreshWithProgress(){
    const started=Date.now(),lane=controller.target.kind==='lane'?list(controller.project?.cloud?.rawProject?.lanes).find(item=>item?.id===controller.target.id):null,saved=list(lane?.pluginChain);
    const content=$('.mix-content');
    if(controller.target.kind==='lane'){content.innerHTML=`<h3>${esc(lane?.name||'Lane')} · loaded plugins</h3>${saved.length?`<ol class="mix-saved-chain">${saved.map(plugin=>`<li>${esc(plugin?.name||plugin?.type||'Cloud plugin')}</li>`).join('')}</ol><p class="mix-note">Saved chain shown while the Freestyle engine reports the live slots.</p>`:'<p class="mix-note">Reading the live plugin slots from the Freestyle engine.</p>'}`;content.setAttribute('aria-busy','true');}
    const tick=()=>{const seconds=Math.round((Date.now()-started)/1000);if(dialog.isConnected&&seconds>=2)status(`Waiting for the Freestyle engine to list this ${controller.target.kind}’s plugins… ${seconds}s`);};
    const timer=setInterval(tick,1000);
    try{return await controller.refresh({cached:true});}finally{clearInterval(timer);content.removeAttribute('aria-busy');}
  }
  try{
    // Browsing the REST catalog requires no loaded native chain or host scan.
    // loadPlugin still reads the exact current target/chain and revision before
    // its catalog-ID insertion; the engine remains responsible for host loading.
    if(!(picker&&controller.isRestMode))await refreshWithProgress();
    const rendered=await render({focusCatalog:controller.tab==='catalog'});const notLiveNotice=controller.liveChainMissing;if(!rendered?.error)status(notLiveNotice?controller.noLiveChainNotice:picker&&controller.isRestMode?'Effects ready':'Cloud mixer ready',notLiveNotice);
    // The REST picker opens without a cold chain read: an add answered 409
    // lane_has_no_live_chain (data, not lane kind) switches on the specific notice.
  }catch(error){render({contentError:error.message});status(error.message,true);options.onError?.(error);}
  return dialog;
}
