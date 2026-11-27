import {NativeEqEditor,isNativeEqPlugin} from './plugin-editor-native-eq.js';
import {isInstanceMismatch} from './plugin-editor-http.js';
import {isParameterConflict,parameterGuard,mixKey,MIX_CHANGED_NOTICE} from './mix-sync.js';
import {bridgeFetch} from './freestyle-host-transport.js';
/** Cloud mixer controls. No local audio processing. */
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
/** Published lane-plugin write guards: the engine refuses with 409 plugin_instance_mismatch instead of writing. */
const instanceGuard=plugin=>{const instance=plugin?.instance_id||plugin?.instanceId,type=plugin?.type_id||plugin?.typeId;return{...instance?{expected_plugin_instance_id:instance}:{},...type?{expected_plugin_type:type}:{}};};
export function unpackMixerResult(result) {
  let data=result?.structuredContent;
  if(data===undefined&&Array.isArray(result?.content)){
    try{data=JSON.parse(result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'));}catch{}
  }
  data??=result;
  for(let i=0;i<5;i++){
    if(result?.isError||data?.error||data?.ok===false){
      const error=new Error(data?.detail||data?.error?.message||data?.error||data?.message||'Freestyle could not complete the mixer operation.');
      error.code=data?.code??data?.error?.code;error.status=data?.status??data?.error?.status;error.result=result;error.retryAfterSec=data?.retryAfterSec;throw error;
    }
    if(data?.response&&typeof data.response==='object'){const outer={...data},inner=data.response;delete outer.response;data={...outer,...inner};}else break;
  }
  return data||{};
}
async function defaultCall(name,args){
  const response=await bridgeFetch('modesty-bridge:/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.detail||data.error?.message||data.error||`Freestyle request failed (${response.status}).`),{status:response.status,code:data.code??data.error?.code,result:data});
  return unpackMixerResult(data);
}
export function normalizeLoadedPlugins(value){
  return list(value).map(plugin=>({...plugin,index:Number.isInteger(plugin.index)?plugin.index:Number.isInteger(plugin.plugin_index)?plugin.plugin_index:null,name:plugin.name||plugin.label||plugin.plugin_name||plugin.type_id||'Cloud plugin',bypassed:plugin.bypassed===true})).sort((a,b)=>(a.index??Infinity)-(b.index??Infinity));
}
export function normalizePluginParameters(raw){
  const snapshot=raw?.snapshot||raw?.state||raw?.plugin||raw||{};
  const source=Array.isArray(raw?.data)?raw.data:snapshot.parameters||[],entries=Array.isArray(source)?source:Object.entries(source).map(([key,value])=>typeof value==='object'?{index:Number(key),...value}:{index:Number(key),value});
  return entries.flatMap(parameter=>{
    const index=parameter.index??parameter.parameter_index??parameter.parameterIndex;if(!Number.isInteger(index)||index<0)return[];
    const declared=Array.isArray(parameter.writeForms),range=parameter.range||{};
    let normalized=[parameter.value_norm,parameter.normalized_value,parameter.normalizedValue,parameter.valueNormalized,parameter.normalized].find(value=>finite(value)&&Number(value)>=0&&Number(value)<=1);
    const min=parameter.min??parameter.minimum,max=parameter.max??parameter.maximum;
    if(normalized===undefined&&finite(parameter.value)&&Number(parameter.value)>=0&&Number(parameter.value)<=1&&(declared||range.normalized===true||!finite(min)&&!finite(max)&&!parameter.unit||Number(min)===0&&Number(max)===1))normalized=parameter.value;
    const physicalValue=finite(parameter.physicalValue)?Number(parameter.physicalValue):null,physicalMin=range.rawMin??min,physicalMax=range.rawMax??max;
    const forms=declared?parameter.writeForms.filter(form=>['value_norm','value'].includes(form)):normalized===undefined?[]:['value_norm'];
    const display=physicalValue!==null?`${physicalValue}${parameter.unit?' '+parameter.unit:''}`:parameter.display_value??parameter.displayValue??parameter.text??parameter.display??'';
    return[{...parameter,index,name:parameter.name||parameter.label||`Parameter ${index}`,normalized:normalized===undefined?null:Number(normalized),physicalValue,physicalMin:finite(physicalMin)?Number(physicalMin):null,physicalMax:finite(physicalMax)?Number(physicalMax):null,writeForms:[...new Set(forms)],display}];
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

export class MixerToolsController {
  constructor({project,channel,call=defaultCall,action,onChanged,onError,onWarning=null,mixSync=null,liveControl=null,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),fetch:fetchImpl=(...args)=>bridgeFetch(...args)}={}){
    this.project=project;this.projectId=project?.cloud?.projectId||project?.id;this.contextTrackId=project?.cloud?.trackId;
    if(!this.projectId||!this.contextTrackId)throw new Error('Load a Freestyle project before opening its mixer tools.');
    this.sleep=sleep;this.onWarning=onWarning;this.mix=mixSync;this.liveControl=liveControl;this.call=async(name,args)=>unpackMixerResult(await call(name,args));this.action=action;this.onChanged=onChanged;this.onError=onError;this.fetch=fetchImpl;
    this.state=project.cloud.rawState||{};this.channel=channel;this.target=channel?.id==='master'||channel?.type==='bus'||channel?.kind==='bus'||!channel?{kind:'bus',id:channel?.busId||channel?.bus_id||channel?.id||'master'}:{kind:'lane',id:channel?.laneId||channel?.cloudTrackId||(!channel?.patternSource?channel?.id:'')};
    this.plugins=[];this.parameters=[];this.catalog=[];this.catalogLoaded=false;this.statusMessage='';this.pendingLive=false;this.selectedIndex=null;this.busy=false;this.tab='slots';
  }
  context(){return{project_id:this.projectId,track_id:this.contextTrackId};}
  targets(){
    const lanes=list(this.project.cloud.rawProject?.lanes).map(lane=>({kind:'lane',id:String(lane.id),name:lane.name||'Cloud lane',raw:lane}));
    const buses=list(this.state.buses?.buses||this.state.buses).map(bus=>({kind:'bus',id:String(bus.bus_id||bus.id),name:bus.label||bus.name||'Cloud bus',raw:bus}));
    return [...lanes,...buses];
  }
  get targetInfo(){return this.targets().find(target=>target.kind===this.target.kind&&target.id===this.target.id);}
  get runtimeTrack(){return list(this.state.tracks?.tracks||this.state.tracks).find(track=>String(track.db_track_id)===this.target.id);}
  /** Catalog is only needed by Add plugin: load it once in the background. */
  ensureCatalog(){if(this.catalogLoaded)return Promise.resolve(this.catalog);this.catalogPromise??=this.loadCatalog().catch(error=>{this.catalog=[];this.catalogError=error.message;return[];}).finally(()=>{this.catalogPromise=null;});return this.catalogPromise;}
  /** Engine state, lane chain and catalog are read concurrently; `onSlots` fires as soon as the slot list is known. */
  async refresh({onSlots}={}){
    const selected=identity(this.plugins.find(plugin=>plugin.index===this.selectedIndex));
    const state=this.call('get_pro_state',this.context()).then(value=>{this.state=value;return value;});state.catch(()=>{});
    this.ensureCatalog();
    // Lane slots come from the lane's own plugin list; bus slots need the engine state.
    const master=this.target.kind==='bus'&&this.target.id==='master'&&this.busListSupported!==false;
    if(this.target.kind!=='lane'&&!master)await state;
    if(!master&&!this.targetInfo){await state;if(!this.targetInfo){this.plugins=[];this.parameters=[];this.selectedIndex=null;onSlots?.(this);return this;}}
    await this.refreshPlugins();
    if(selected){const plugin=this.plugins.find(item=>identity(item)===selected);this.selectedIndex=plugin?.index??null;}
    else if(!this.plugins.some(plugin=>plugin.index===this.selectedIndex))this.selectedIndex=null;
    onSlots?.(this);
    await Promise.all([state,this.selectedIndex!==null?this.readPlugin(this.selectedIndex):null]);
    return this;
  }
  async setTarget(kind,id){if(this.busy)throw new Error('Wait for the current cloud mixer edit to finish.');this.target={kind,id};this.selectedIndex=null;this.parameters=[];this.snapshot=null;this.effectPresetNames=null;await this.refreshPlugins();return this;}
  async refreshPlugins(){
    if(this.target.kind==='lane'&&this.target.id){
      const result=await this.call('list_plugins',{...this.context(),lane_id:this.target.id});this.plugins=normalizeLoadedPlugins(result.plugins);
    }else{
      // Master insert chain (#3): listBusPlugins gives index, instance_id, bypassed, format and hasEditor.
      // Other buses (and a backend without the route) keep the live bus metadata from the engine state.
      if(this.target.id==='master'&&this.busListSupported!==false){
        try{const result=await this.call('listBusPlugins',{...this.context(),bus_id:'master'});this.busInfo={live:result.live!==false,masterEffectsSupported:result.masterEffectsSupported!==false,chainLatencySamples:result.chainLatencySamples??null};this.plugins=normalizeLoadedPlugins(result.plugins);return this.plugins;}
        catch(error){if(error.code!=='studio_operation_unsupported'&&error.code!=='invalid_operation')throw error;this.busListSupported=false;}
      }
      this.plugins=normalizeLoadedPlugins(this.targetInfo?.raw?.plugins);
    }
    return this.plugins;
  }
  async loadCatalog(){
    if(this.catalogLoaded)return this.catalog;const catalog=[],seen=new Set();let cursor;
    for(let page=0;page<100;page++){
      const data=await this.call('list_plugin_catalog',{project_id:this.projectId,kind:'effect',limit:200,...cursor?{cursor}:{}});
      if(!Array.isArray(data.data)||!data.pagination||typeof data.pagination.hasMore!=='boolean')throw new Error('Freestyle returned no complete typed plug-in catalog.');
      for(const item of data.data){if(typeof item.id!=='string'||!item.id||seen.has('id:'+item.id)||typeof item.name!=='string'||!['native','vst3'].includes(item.format))throw new Error('The plug-in catalog contains missing or ambiguous identities.');seen.add('id:'+item.id);catalog.push({...item,hostGated:item.availability?.installed===false});}
      if(!data.pagination.hasMore){this.catalog=catalog;this.catalogLoaded=true;this.catalogError=null;return catalog;}const next=data.pagination.nextCursor;if(typeof next!=='string'||!next||seen.has('cursor:'+next))throw new Error('The plug-in catalog cursor is incomplete or repeated.');seen.add('cursor:'+next);cursor=next;
    }throw new Error('The plug-in catalog exceeded its supported page limit.');
  }
  async readPlugin(index){
    const plugin=this.plugins.find(item=>item.index===index);if(!plugin)throw new Error('Select a plugin with a live slot index.');this.selectedIndex=index;
    // The native EQ exposes no host parameters; its bands are read and written by the band editor.
    if(this.target.kind==='lane'&&isNativeEqPlugin(plugin)){this.parameters=[];this.snapshot={};return{plugin,snapshot:this.snapshot,parameters:this.parameters};}
    let first,parameters=[],cursor;const seen=new Set();
    for(let page=0;page<100;page++){
      const args={...this.context(),plugin_index:index,limit:200,...cursor?{cursor}:{}};
      const data=this.target.kind==='lane'?await this.call('get_plugin_state',{...args,lane_id:this.target.id}):await this.call('get_bus_plugin_live_state',{...args,bus_id:this.target.id});
      if(data.projectId!==undefined&&data.projectId!==this.projectId||data.laneId!==undefined&&this.target.kind==='lane'&&data.laneId!==this.target.id||data.busId!==undefined&&this.target.kind==='bus'&&data.busId!==this.target.id)throw new Error('Parameter discovery belongs to another mixer target.');
      if(data.plugin?.instanceId&&data.plugin.instanceId!==identity(plugin)||data.plugin?.index!==undefined&&data.plugin.index!==index)throw new Error('This plugin slot changed during parameter discovery. Refresh and select it again.');
      first??=data;parameters.push(...normalizePluginParameters(data));if(!data.pagination?.hasMore)break;const next=data.pagination.nextCursor;if(typeof next!=='string'||!next||seen.has(next))throw new Error('The plugin parameter cursor is incomplete or repeated.');seen.add(next);cursor=next;if(page===99)throw new Error('The plugin parameter list exceeded its page limit.');
    }
    if(new Set(parameters.map(p=>p.index)).size!==parameters.length)throw new Error('The plugin parameter list contains duplicate indexes.');
    this.snapshot=first.snapshot||first.state||first.plugin||first;this.snapshot={...this.snapshot,program_count:this.snapshot.program_count??this.snapshot.programCount,current_program_index:this.snapshot.current_program_index??this.snapshot.currentProgram?.index};this.parameters=parameters;
    return{plugin,snapshot:this.snapshot,parameters:this.parameters};
  }
  physicalWritable(plugin,parameter){const format=String(this.snapshot?.format??plugin?.format??'').toLowerCase(),type=String(this.snapshot?.typeId??plugin?.typeId??plugin?.type_id??'');return this.target.kind==='lane'&&(format==='native'||/^native[-_:]/i.test(type))&&parameter.writeForms.includes('value');}
  async ensurePlugin(plugin){
    const originalIdentity=identity(plugin);
    if(this.target.kind==='bus'&&!(this.target.id==='master'&&this.busListSupported!==false)){this.state=await this.call('get_pro_state',this.context());}
    await this.refreshPlugins();
    const current=plugin.index===null?this.plugins.find(item=>identity(item)===originalIdentity):this.plugins.find(item=>item.index===plugin.index);
    if(!current||!originalIdentity||identity(current)!==originalIdentity)throw new Error('This plugin slot changed in Freestyle. Refresh and select the plugin again before editing it.');
    return current;
  }
  async invokeAction(name,args,{destructive=false}={}){
    if(this.action)return unpackMixerResult(await this.action(name,args,{refresh:false,confirmedDestructive:destructive}));
    const request={...this.context(),action:name,arguments:structuredClone(args),idempotency_key:crypto.randomUUID(),...(destructive?{confirmed_destructive:true}:{})};this.lastWrite={name:'execute_pro_action',request:structuredClone(request)};return this.call('execute_pro_action',request);
  }
  /** After a structural lane edit, confirm in the background that the saved chain (what a session rebuild restores)
   *  matches the live engine chain; warn when it does not. Saves may lag the ACK, so a mismatch is re-read a few times. */
  async verifySavedChain(laneId,{attempts=3,delayMs=1500,receipt=null}={}){
    const token=this.chainCheck=(this.chainCheck||0)+1;this.chainWarning=null;
    // A by-instance delete that reports saved:true only needs the saved chain to no longer list that instance.
    // The session action path returns only the engine response: {instance_id, saved_chain_updated, restore:{type,…}}.
    const removed=receipt?.removed??(receipt?.saved_chain_updated===true&&receipt?.instance_id?{instanceId:receipt.instance_id,saved:true,typeId:receipt.restore?.type??receipt.restore?.typeId??null}:null);
    if(removed?.saved===true&&removed.instanceId){
      try{const project=await this.call('get_project',{project_id:this.projectId});if(token!==this.chainCheck)return null;const lane=list(project.lanes).find(item=>String(item.id)===laneId);
        const still=list(lane?.pluginChain).some(row=>String(row.pluginKey||'')===String(removed.instanceId));
        if(!still)return{matched:true,removed};
        this.chainWarning=`Freestyle reported ${removed.typeId||'the plug-in'} removed from the saved chain, but the project still lists it. It may come back when the session reloads.`;this.statusMessage=this.chainWarning;this.onWarning?.(this.chainWarning,{removed});return{matched:false,removed};
      }catch{return null;}
    }
    const summary=rows=>rows.map(row=>`${row.name||row.type}${row.bypassed?' (bypassed)':''}`).join(', ')||'empty';
    for(let attempt=0;attempt<attempts;attempt++){
      if(attempt)await this.sleep(delayMs);if(token!==this.chainCheck)return null;
      let saved,live;
      try{
        const [project,chain]=await Promise.all([this.call('get_project',{project_id:this.projectId}),this.call('list_plugins',{...this.context(),lane_id:laneId})]);
        const lane=list(project.lanes).find(item=>String(item.id)===laneId);if(!lane||!Array.isArray(lane.pluginChain))return null;
        saved=[...lane.pluginChain].sort((a,b)=>a.position-b.position).map(row=>({key:String(row.pluginKey||''),type:String(row.type||''),name:row.name,bypassed:!!row.bypassed}));
        live=normalizeLoadedPlugins(chain.plugins).map(row=>({key:String(identity(row)),type:String(row.type_id||row.typeId||''),name:row.name,bypassed:!!row.bypassed}));
      }catch{return null;}
      const same=saved.length===live.length&&saved.every((row,index)=>(row.key&&live[index].key?row.key===live[index].key:row.type===live[index].type)&&row.bypassed===live[index].bypassed);
      if(same){this.chainWarning=null;return{matched:true,saved,live};}
      if(attempt===attempts-1){
        this.chainWarning=`The saved plug-in chain does not match the live engine (saved: ${summary(saved)}; live: ${summary(live)}). The saved chain is what Freestyle restores when the session reloads.`;
        this.statusMessage=this.chainWarning;this.onWarning?.(this.chainWarning,{saved,live});return{matched:false,saved,live};
      }
    }
    return null;
  }
  async changed(task,{structural=false}={}){
    if(this.busy)throw new Error('Wait for the current cloud mixer edit to finish.');
    if(this.pendingLive)throw new Error('The saved mixer change still needs live verification before another mixer edit.');
    this.busy=true;
    try{const result=unpackMixerResult(await task());this.lastReceipt=result;if(this.target.kind==='lane'&&structural)this.verifySavedChain(this.target.id,{receipt:result});this.pendingLive=result.engine_applied===false||result.engine_reload_required===true;this.statusMessage=this.pendingLive?'Mixer change saved; live processing is pending verification.'+(result.engine_reload_required?' Engine reload required.':''):'Cloud mixer updated';try{await this.onChanged?.(result);await this.refresh();}catch(error){this.statusMessage+=' State refresh needs verification: '+error.message;this.onError?.(error);}return result;}
    catch(error){
      if(isParameterConflict(error)){
        // Nothing was written: show the value someone else set and never resend.
        const details=error.details||error.result?.details||{};error.message=`This control was changed elsewhere${Number.isFinite(Number(details.currentValueNorm))?` (now ${Math.round(Number(details.currentValueNorm)*1000)/10}%)`:''}; showing the current value. Your change was not applied.`;
        if(this.selectedIndex!==null)try{await this.readPlugin(this.selectedIndex);}catch{}
      }
      if(isInstanceMismatch(error)){
        // Nothing was written. Refresh the slot identities and tell the user; never re-send.
        const details=error.details||error.result?.details||{},current=details.currentPluginType||details.currentInstanceId;
        error.message=`The plug-in in this slot changed${current?` (now ${current})`:''}. The slot list was refreshed; nothing was changed.`;
        this.selectedIndex=null;this.parameters=[];this.snapshot=null;try{await this.refreshPlugins();}catch{}
      }
      this.onError?.(error);throw error;
    }finally{this.busy=false;}
  }
  bypass(plugin){return this.changed(async()=>{const current=await this.ensurePlugin(plugin);return this.target.kind==='lane'?this.invokeAction('set_plugin_bypassed',{lane_id:this.target.id,plugin_index:current.index,bypassed:!current.bypassed,...instanceGuard(current)}):this.invokeAction('set_bus_plugin_bypassed',{bus_id:this.target.id,plugin_index:current.index,bypassed:!current.bypassed});},{structural:true});}
  parameter(plugin,index,value,{form='value_norm'}={}){
    const parameter=this.parameters.find(item=>item.index===index);if(!parameter)return Promise.reject(new Error('Read this plugin’s actual parameter list before changing a parameter.'));
    if(!['number','string'].includes(typeof value)||!finite(value))return Promise.reject(new Error('Provide a finite plugin parameter value.'));value=Number(value);
    if(!['value_norm','value'].includes(form)||!parameter.writeForms.includes(form))return Promise.reject(new Error('This parameter does not advertise that write form.'));
    if(form==='value_norm'&&(value<0||value>1))return Promise.reject(new Error('Plugin normalized values must be from 0 to 1.'));
    if(form==='value'&&(!this.physicalWritable(plugin,parameter)||parameter.physicalMin!==null&&value<parameter.physicalMin||parameter.physicalMax!==null&&value>parameter.physicalMax))return Promise.reject(new Error('Choose a supported native physical value within its reported range.'));
    return this.changed(async()=>{const current=await this.ensurePlugin(plugin),values={parameter_index:index,[form]:value};return this.target.kind==='lane'?this.invokeAction('set_plugin_parameter',{lane_id:this.target.id,plugin_index:current.index,...values,...form==='value_norm'?parameterGuard(parameter.normalized):{},...instanceGuard(current)}):this.invokeAction('set_bus_plugin_parameter',{bus_id:this.target.id,plugin_index:current.index,...values});});
  }
  program(plugin,index){
    const count=Number(this.snapshot?.program_count);
    if(!Number.isInteger(index)||index<0||!Number.isInteger(count)||index>=count)return Promise.reject(new Error('Choose a program index reported by this plugin.'));
    if(this.target.kind!=='lane')return Promise.reject(new Error('Freestyle has not exposed a bus plugin program setter.'));
    return this.changed(async()=>{const current=await this.ensurePlugin(plugin);return this.invokeAction('set_lane_plugin_program',{lane_id:this.target.id,plugin_index:current.index,program:index,...instanceGuard(current)});});
  }
  loadPlugin(pluginId){
    const entry=this.catalog.find(item=>item.id===pluginId);if(!this.catalogLoaded||!entry||entry.hostGated)return Promise.reject(new Error('Choose an available plugin id from the current Freestyle catalog.'));
    return this.changed(async()=>{try{return this.target.kind==='lane'?await this.invokeAction('add_lane_plugin',{lane_id:this.target.id,plugin_id:entry.id},{destructive:true}):await this.invokeAction('add_bus_plugin',{bus_id:this.target.id,plugin_id:entry.id},{destructive:true});}catch(error){if(this.target.kind==='bus'&&error.code==='plugin_not_installed_on_host')error.message='This plugin is not installed on the current audio host. Choose another catalog plugin.';throw error;}},{structural:true});
  }
  copyChain(sourceLaneId){
    if(this.target.kind!=='lane')return Promise.reject(new Error('Choose an audio lane as the effect-chain destination.'));
    const audioLane=item=>item?.kind==='lane'&&!['instrument','pattern','midi','bus'].includes(String(item.raw?.kind??item.raw?.type??'').toLowerCase());
    if(sourceLaneId===this.target.id||!this.targets().some(item=>item.id===sourceLaneId&&audioLane(item))||!audioLane(this.targetInfo))return Promise.reject(new Error('Choose another saved audio lane as the effect-chain source.'));
    const destination=this.target.id;
    return this.changed(async()=>{let receipt;try{receipt=await this.invokeAction('copy_lane_effect_chain',{lane_id:destination,source_lane_id:sourceLaneId});}catch(error){if(error.code==='lane_not_audio')error.message='Choose audio tracks for both the source and destination effect chains.';throw error;}if(receipt.projectId!==this.projectId||receipt.laneId!==destination||receipt.sourceLaneId!==sourceLaneId||typeof receipt.engine_applied!=='boolean'||typeof receipt.engine_reload_required!=='boolean')throw new Error('The effect-chain copy returned an incomplete or foreign acknowledgement.');return receipt;},{structural:true});
  }
  move(plugin,toIndex){
    if(!Number.isInteger(toIndex)||!this.plugins.some(item=>item.index===toIndex))return Promise.reject(new Error('Choose an existing chain slot.'));
    return this.changed(async()=>{const current=await this.ensurePlugin(plugin);if(this.target.kind==='lane')return this.invokeAction('move_lane_plugin',{lane_id:this.target.id,plugin_index:current.index,to_index:toIndex,expected_plugin_instance_id:identity(current)});return this.invokeAction('move_bus_plugin',{bus_id:this.target.id,plugin_index:current.index,to_index:toIndex});},{structural:true});
  }
  remove(plugin){return this.changed(async()=>{const current=await this.ensurePlugin(plugin);if(this.target.kind==='lane'){
    // 328: deleteLanePluginInstance removes the live slot and the saved-chain row together ({removed:{live,saved}}).
    // Older backends fall back to the instance-addressed engine action. The saved chain is verified afterwards.
    // The full receipt is needed: removed.restore.addLanePlugin carries the live state and parameters, while the
    // engine's inner response (all that session.action returns) may hold saved state and no parameters.
    try{const receipt=await this.call('deleteLanePluginInstance',{...this.context(),lane_id:this.target.id,instance_id:identity(current),idempotency_key:crypto.randomUUID()});this.recordRemoval(receipt,current);return receipt;}
    catch(error){if(error.code!=='studio_operation_unsupported')throw error;return this.invokeAction('engine_delete_lane_plugin',{lane_id:this.target.id,instance_id:identity(current),confirm:true},{destructive:true});}}
    // #3: deleteBusPlugin returns `removed` and an `undo` addBusPlugin request (same settings, same slot): one ⌘Z step.
    if(this.target.id==='master'&&this.busListSupported!==false){const receipt=await this.call('deleteBusPlugin',{...this.context(),bus_id:this.target.id,plugin_index:current.index,idempotency_key:crypto.randomUUID()});this.recordBusRemoval(receipt,current);return receipt;}
    return this.invokeAction('delete_bus_plugin',{bus_id:this.target.id,plugin_index:current.index},{destructive:true});},{structural:true});}
  /** Undo / Redo entry for a removed master-bus plug-in, from the delete receipt's undo request. */
  recordBusRemoval(receipt,plugin){
    const body=busRemovalUndoBody(receipt,plugin);if(!body)return null;
    const busId=this.target.id,call=this.call,context=this.context(),refresh=async response=>{try{await this.refreshPlugins();}catch{}this.onChanged?.(response);};
    const entry={projectId:this.projectId,busId,label:`Remove ${plugin?.name||'master effect'}`,undoBody:body,instanceId:String(body.instance_id||identity(plugin)||''),
      async undo(){const response=await call('addBusPlugin',{...context,bus_id:busId,...entry.undoBody,idempotency_key:crypto.randomUUID()});const restored=restoredInstanceId(response);if(restored)entry.instanceId=String(restored);await refresh(response);return response;},
      async redo(){const chain=await call('listBusPlugins',{...context,bus_id:busId}),slot=normalizeLoadedPlugins(chain.plugins).find(item=>String(identity(item))===entry.instanceId);if(!slot)throw new Error('The restored master effect is no longer in the chain.');
        const response=await call('deleteBusPlugin',{...context,bus_id:busId,plugin_index:slot.index,idempotency_key:crypto.randomUUID()});const next=busRemovalUndoBody(response,slot);if(next)entry.undoBody=next;await refresh(response);return response;}};
    pluginChainHistory.record(entry);return entry;
  }
  /** 338: the delete receipt carries removed.restore and a ready-made addLanePlugin body; record it as one ⌘Z step. */
  recordRemoval(receipt,plugin){
    const body=removalUndoBody(receipt,plugin);if(!body)return null;
    const laneId=this.target.id,call=this.invokeAction.bind(this),fullCall=this.call,context=this.context(),refresh=async response=>{this.adoptChain(response);try{await this.refreshPlugins();}catch{}this.onChanged?.(response);};
    const entry={projectId:this.projectId,laneId,label:`Remove ${plugin?.name||receipt?.removed?.typeId||'plug-in'}`,undoBody:body,instanceId:String(receipt?.removed?.instanceId||receipt?.instance_id||body.instance_id||identity(plugin)||''),
      async undo(){const response=unpackMixerResult(await call('addLanePlugin',{lane_id:laneId,...entry.undoBody},{destructive:true}));const restored=restoredInstanceId(response)||entry.undoBody.instance_id||entry.instanceId;if(restored)entry.instanceId=restored;await refresh(response);return response;},
      async redo(){const response=await fullCall('deleteLanePluginInstance',{...context,lane_id:laneId,instance_id:entry.instanceId,idempotency_key:crypto.randomUUID()});const next=removalUndoBody(response,{instance_id:entry.instanceId});if(next)entry.undoBody=next;await refresh(response);return response;}};
    pluginChainHistory.record(entry);return entry;
  }
  /** Saved positions are renumbered 0..n-1 by the engine: adopt the returned chain order when the receipt carries it. */
  adoptChain(response){const rows=response?.plugins??response?.chain?.plugins??response?.lane?.plugins;if(Array.isArray(rows)&&this.target.kind==='lane')this.plugins=normalizeLoadedPlugins(rows);}
  route(busId){
    if(this.target.kind!=='lane')return Promise.reject(new Error('Select a lane before changing its output.'));
    if(!this.targets().some(target=>target.kind==='bus'&&target.id===busId))return Promise.reject(new Error('Choose a bus returned by the cloud mixer.'));
    // Shared mix revision: setLaneRouting {lane_id, bus_id, expected_mix_revision}; a 412 re-reads and is never resent.
    if(this.mix)return this.mixWrite(mixKey('lane',this.target.id,'bus'),busId);
    if(!Number.isInteger(this.runtimeTrack?.id))return Promise.reject(new Error('Select a lane loaded in the live engine before changing its output.'));
    return this.changed(()=>this.invokeAction('route_track_to_bus',{track_id:this.runtimeTrack.id,bus_id:busId}));
  }
  /** Mix key of the selected bus target (the master bus is the master mix target). */
  busKey(field){return this.target.id==='master'?mixKey('master','master',field):mixKey('bus',this.target.id,field);}
  mixValue(key,fallback){const value=this.mix?.value(key);return value===undefined?fallback:value;}
  /** Guarded mix write through the shared MixSync (same revision, same wait loop as the track panel). */
  /** End of a bus fader gesture: one guarded, saved write of the final level. */
  async busCommit(field,value){
    if(this.target.kind!=='bus'||field!=='gain')throw new Error('Choose a bus to change its level.');
    if(!this.mix)throw new Error('Live mix sync is not available for this project.');
    const conflicts=this.mix.stats.conflicts,result=await this.mix.commit(this.busKey(field),Number(value));
    this.statusMessage=this.mix.stats.conflicts>conflicts?MIX_CHANGED_NOTICE:'Cloud mixer updated';return result;
  }
  /** A lane plug-in parameter while its slider moves: `set_plugin_param` on the mozart-control data channel
   *  (live, no ack, not saved). parameter() saves the final value when the slider is released. Bus plug-ins
   *  have no data-channel message, so they change on release only. */
  liveParameter(plugin,index,value){
    if(!this.liveControl||this.target.kind!=='lane'||!Number.isInteger(plugin?.index)||!Number.isFinite(Number(value)))return false;
    const parameter=this.parameters.find(item=>item.index===index);if(!parameter?.writeForms.includes('value_norm'))return false;
    return this.liveControl.parameter({laneId:this.target.id,pluginIndex:plugin.index,parameterIndex:index,valueNorm:Number(value),type:plugin.type_id||plugin.typeId||''});
  }
  async mixWrite(key,value,{debounce=false}={}){
    if(!this.mix)throw new Error('Live mix sync is not available for this project.');
    if(this.busy)throw new Error('Wait for the current cloud mixer edit to finish.');
    const conflicts=this.mix.stats.conflicts,result=await this.mix.set(key,value,{debounce});
    this.statusMessage=this.mix.stats.conflicts>conflicts?MIX_CHANGED_NOTICE:'Cloud mixer updated';return result;
  }
  busControl(field,value,options){
    if(this.target.kind!=='bus')return Promise.reject(new Error('Choose a bus to change its level.'));
    if(this.target.id==='master'&&field!=='gain')return Promise.reject(new Error('The master bus has no mute or solo.'));
    return this.mixWrite(this.busKey(field),field==='gain'?Number(value):!!value,options);
  }
  async chainPresets(){const data=await this.call('list_vocal_chain_presets',{source:'library',limit:100});this.presets=list(data.presets);this.presetsTruncated=!!data.truncated||!!data._truncated;return this.presets;}
  async inspectPreset(id){if(!this.presets?.some(preset=>preset.id===id))throw new Error('Choose a preset returned by Freestyle.');return this.call('get_vocal_chain_preset',{preset_id:id});}
  applyPreset(id){
    if(this.target.kind!=='lane')return Promise.reject(new Error('Chain presets apply to cloud lanes. Choose a lane first.'));
    if(!this.presets?.some(preset=>preset.id===id))return Promise.reject(new Error('Choose a preset returned by Freestyle.'));
    return this.changed(()=>this.call('apply_vocal_chain_preset',{project_id:this.projectId,lane_id:this.target.id,preset_id:id}),{structural:true});
  }
  async effectPresets(kind,query=''){if(!['nectar','autotune','filter'].includes(kind))throw new Error('Choose a supported preset catalog.');const data=await this.call('list_effect_presets',{kind,query,limit:400});this.effectPresetNames=new Set(list(data.presets).map(preset=>typeof preset==='string'?preset:preset.name).filter(Boolean));return data;}
  applyEffectPreset(plugin,name){
    if(this.target.kind!=='lane'||!this.effectPresetNames?.has(name))return Promise.reject(new Error('Choose a preset returned for the selected lane plugin.'));
    return this.changed(async()=>{const current=await this.ensurePlugin(plugin);return this.call('apply_plugin_preset',{...this.context(),lane_id:this.target.id,plugin_index:current.index,preset:name,...instanceGuard(current)});},{structural:true});
  }
  async savedState(){return this.target.kind==='lane'?this.call('get_saved_plugin_state',{project_id:this.projectId,lane_id:this.target.id}):this.call('get_bus_plugin_state',{project_id:this.projectId,bus_id:this.target.id});}
}

/** addLanePlugin body that restores a removed instance: the receipt's ready-made body, else built from removed.restore. */
export function removalUndoBody(receipt,plugin={}){
  const data=receipt||{},removed=data.removed||{},ready=[removed.restore?.addLanePlugin,data.removed?.restore?.add_lane_plugin,data.undo?.body,data.undo?.addLanePlugin,data.undo?.add_lane_plugin,removed.undo?.body,removed.undo,data.undo_body,data.undoBody,data.undo].find(value=>value&&typeof value==='object'&&!Array.isArray(value)&&(value.plugin_id||value.pluginId));
  if(ready){const body={...ready};if(body.pluginId&&!body.plugin_id){body.plugin_id=body.pluginId;delete body.pluginId;}delete body.lane_id;delete body.project_id;return body;}
  // session.action returns only the engine `response`, whose restore is snake_case ({type, instance_id, state, state_signature, …}).
  const restore=removed.restore&&typeof removed.restore==='object'?removed.restore:data.restore&&typeof data.restore==='object'?data.restore:null;if(!restore)return null;
  const pluginId=removed.typeId||restore.typeId||restore.type_id||restore.type||plugin.type_id||plugin.typeId;if(!pluginId)return null;
  const signature=restore.state_signature??restore.stateSignature;
  return{plugin_id:pluginId,instance_id:String(removed.instanceId||restore.instance_id||restore.instanceId||data.instance_id||identity(plugin)||''),...restore.state!==undefined?{state:restore.state}:{},...signature!==undefined?{state_signature:signature}:{},...restore.parameters!==undefined?{parameters:restore.parameters}:{},...restore.bypass!==undefined||restore.bypassed!==undefined?{bypassed:!!(restore.bypassed??restore.bypass)}:{},...Number.isInteger(restore.position)?{position:restore.position}:{}};
}
/** addBusPlugin body that puts a deleted master/bus slot back: the receipt's `undo` request, else removed.restore. */
export function busRemovalUndoBody(receipt,plugin={}){
  const data=receipt||{},removed=data.removed||{},undo=data.undo;
  const ready=[undo?.body,undo?.addBusPlugin,undo?.request?.body,removed.restore?.addBusPlugin,removed.restore?.add_bus_plugin,undo].find(value=>value&&typeof value==='object'&&!Array.isArray(value)&&(value.plugin_id||value.pluginId));
  let body=ready?{...ready}:null;
  if(!body){const restore=removed.restore&&typeof removed.restore==='object'?removed.restore:null,pluginId=removed.typeId||restore?.typeId||restore?.type_id||restore?.type||plugin.type_id||plugin.typeId;if(!pluginId)return null;
    const signature=restore?.stateSignature??restore?.state_signature;
    body={plugin_id:pluginId,instance_id:String(removed.instanceId||restore?.instanceId||restore?.instance_id||identity(plugin)||''),...restore?.state!==undefined&&signature!==undefined?{state:restore.state,state_signature:signature}:{},...(removed.bypassed??restore?.bypassed)!==undefined?{bypassed:!!(removed.bypassed??restore?.bypassed)}:{},...Number.isInteger(removed.slot??removed.index??restore?.position)?{position:removed.slot??removed.index??restore.position}:{}};}
  if(body.pluginId&&!body.plugin_id){body.plugin_id=body.pluginId;delete body.pluginId;}
  for(const key of ['bus_id','project_id','parameters'])delete body[key];if(!body.instance_id)delete body.instance_id;
  return body;
}
const restoredInstanceId=response=>response?.added?.instanceId??response?.added?.instance_id??response?.plugin?.instance_id??response?.plugin?.instanceId??response?.instance_id??response?.instanceId??null;
/** Owned Edit → Undo / Redo history for plug-in chain edits (shared by every mixer dialog of the page). */
export class PluginChainHistory extends EventTarget{
  constructor(){super();this.past=new Map();this.future=new Map();}
  stack(map,id){if(!map.has(id))map.set(id,[]);return map.get(id);}
  record(entry){this.stack(this.past,entry.projectId).push(entry);this.stack(this.future,entry.projectId).length=0;this.dispatchEvent(new CustomEvent('recorded',{detail:{projectId:entry.projectId,label:entry.label}}));}
  uncertain(){return false;}unverified(){return false;}
  /** Called by the workspace's owned history (kind 'plugins') or the mixer dialog's ⌘Z when no workspace owns it. */
  async history(direction,projectId=this.activeProject){
    const from=this.stack(direction==='undo'?this.past:this.future,projectId),to=this.stack(direction==='undo'?this.future:this.past,projectId),entry=from.at(-1);if(!entry)return false;
    await entry[direction]();from.pop();to.push(entry);this.dispatchEvent(new CustomEvent('applied',{detail:{direction,entry}}));return true;
  }
  canUndo(projectId){return!!this.past.get(projectId)?.length;}
  canRedo(projectId){return!!this.future.get(projectId)?.length;}
}
export const pluginChainHistory=new PluginChainHistory();

/** Typed engine refusals as plain guidance (328 codes). */
export function mixerErrorText(error){
  if(error?.code==='lane_has_no_live_chain')return'This track’s effects are not in the live session yet (lane_has_no_live_chain). Play the track or reload the project, then open Effects again.';
  if(error?.code==='plugin_instance_not_found')return'That plug-in is no longer on this track, live or saved (plugin_instance_not_found). Refresh the slot list.';
  return error?.message||String(error);
}
function stylesheet(){if(document.querySelector('link[data-mixer-tools]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./mixer-tools.css',import.meta.url).href;link.dataset.mixerTools='';document.head.append(link);}
export async function openMixerTools(options){
  stylesheet();const controller=new MixerToolsController(options),dialog=document.createElement('dialog');dialog.className='mixer-tools studio-dialog';dialog.setAttribute('aria-label','Cloud mixer plugin tools');
  dialog.innerHTML='<header><span class="mix-indicator"></span><strong>Mixer · Cloud plugin tools</strong><button class="mix-close" aria-label="Close mixer tools">×</button></header><div class="mix-toolbar"><label>Insert <select class="mix-target" aria-label="Mixer lane or bus"></select></label><button class="mix-refresh">↻ Refresh</button><span class="mix-cloud-label">FREESTYLE ENGINE</span></div><div class="mix-main"><aside class="mix-slots"></aside><section class="mix-details"><nav class="mix-tabs"><button data-tab="slots">Parameters</button><button data-tab="catalog">Add plugin</button><button data-tab="presets">Chain presets</button><button data-tab="routing">Routing</button></nav><div class="mix-content"></div></section></div><footer class="mix-status" role="status">Reading the cloud mixer…</footer>';
  document.body.append(dialog);dialog.showModal();dialog.controller=controller;
  const $=selector=>dialog.querySelector(selector),status=(message,error=false)=>{$('.mix-status').textContent=message;$('.mix-status').classList.toggle('error',error);};
  // ⌘Z / ⌘⇧Z in the dialog run the workspace history (plug-in removal is an owned step there).
  // Listen on the document while open: a re-render can drop focus to <body>, outside the dialog.
  const historyKeys=event=>{
    if(!dialog.isConnected||!dialog.open)return;
    if(!(event.metaKey||event.ctrlKey)||String(event.key).toLowerCase()!=='z'||event.target?.closest?.('input[type=text],input[type=search],input[type=number],textarea,select'))return;
    event.preventDefault();event.stopPropagation();const direction=event.shiftKey?'redo':'undo';
    run(async()=>{const done=options.history?await options.history(direction):await pluginChainHistory.history(direction,controller.projectId);if(done===false)throw new Error(`Nothing to ${direction}.`);controller.statusMessage=direction==='undo'?'Undone':'Redone';await controller.refresh();});
  };
  document.addEventListener('keydown',historyKeys,true);dialog.addEventListener('close',()=>document.removeEventListener('keydown',historyKeys,true),{once:true});
  // Mixer controls follow the shared mix wait loop (no second loop); listeners go away with the dialog.
  const mixChanged=event=>{if(!dialog.isConnected||controller.tab!=='routing')return;const changed=event.detail?.changed||[];const routing=$('.mix-route'),gain=$('.mix-bus-gain');
    if(routing&&controller.target.kind==='lane'&&changed.includes(mixKey('lane',controller.target.id,'bus'))){const value=controller.mixValue(mixKey('lane',controller.target.id,'bus'));if(value)routing.value=value;}
    if(controller.target.kind==='bus'){const key=controller.busKey('gain');if(gain&&changed.includes(key)&&!controller.mix.dragging.has(key))gain.value=String(controller.mixValue(key));
      for(const [field,selector] of [['muted','.mix-bus-mute'],['soloed','.mix-bus-solo']]){const button=$(selector);if(button&&changed.includes(controller.busKey(field)))button.setAttribute('aria-pressed',String(!!controller.mixValue(controller.busKey(field))));}}};
  const mixNotice=event=>{if(dialog.isConnected)status(event.detail.message,true);};
  if(controller.mix){controller.mix.addEventListener('change',mixChanged);controller.mix.addEventListener('notice',mixNotice);dialog.addEventListener('close',()=>{controller.mix.removeEventListener('change',mixChanged);controller.mix.removeEventListener('notice',mixNotice);},{once:true});}
  controller.onWarning=(message,detail)=>{if(dialog.isConnected)status(message,true);options.onWarning?.(message,detail);};
  let viewGeneration=0;
  const run=async task=>{dialog.classList.add('mix-working');$('.mix-target').disabled=true;status('Sending to Freestyle…');try{await task();if(dialog.isConnected){render();status(controller.statusMessage||'Cloud mixer updated');}}catch(error){status(`${mixerErrorText(error)}${error.retryAfterSec?` Try again in ${error.retryAfterSec} seconds.`:''}`,true);}finally{dialog.classList.remove('mix-working');$('.mix-target').disabled=false;}};
  $('.mix-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{viewGeneration++;dialog.nativeEq?.destroy();dialog.remove();},{once:true});$('.mix-refresh').onclick=()=>run(()=>controller.refresh());
  $('.mix-target').onchange=event=>{const value=event.target.value,index=value.indexOf(':');run(()=>controller.setTarget(value.slice(0,index),value.slice(index+1)));};
  for(const button of dialog.querySelectorAll('[data-tab]'))button.onclick=()=>{controller.tab=button.dataset.tab;renderContent();};
  function render(){
    if(!dialog.isConnected)return;
    const target=$('.mix-target');target.innerHTML=controller.targets().map(item=>`<option value="${esc(`${item.kind}:${item.id}`)}">${esc(item.name)}${item.kind==='bus'?' · BUS':''}</option>`).join('');
    const value=`${controller.target.kind}:${controller.target.id}`;
    if([...target.options].some(option=>option.value===value))target.value=value;else{const option=new Option('Choose a cloud lane or bus','');option.disabled=true;option.selected=true;target.prepend(option);}
    renderSlots();renderContent();
  }
  // Opens the remote native GUI with a fresh lane/instance identity; the editor window resolves the live handle itself.
  function openEditor(plugin){if(!plugin||controller.target.kind!=='lane'||plugin.hasEditor===false&&!isNativeEqPlugin(plugin))return;Promise.resolve(options.openEditor({laneId:controller.target.id,pluginIndex:plugin.index,instanceId:identity(plugin),type:plugin.type_id||plugin.typeId||'',name:plugin.name})).catch(error=>{status(error.message,true);options.onError?.(error);});}
  function renderSlots(){
    const rows=controller.plugins.map((plugin,position)=>`<div class="mix-slot ${controller.selectedIndex===plugin.index?'selected':''}"><button class="mix-led ${plugin.bypassed?'off':''}" data-bypass="${position}" title="${plugin.bypassed?'Enable':'Bypass'} ${esc(plugin.name)}" aria-label="${plugin.bypassed?'Enable':'Bypass'} ${esc(plugin.name)}" ${plugin.index==null||!identity(plugin)?'disabled':''}></button><button class="mix-slot-name" data-select="${position}" ${plugin.index==null?'disabled':''}><small>${plugin.index==null?'?':plugin.index+1}</small>${esc(plugin.name)}</button><div class="mix-slot-order"><button data-up="${position}" title="Move up" ${position===0||!identity(plugin)?'disabled':''}>▴</button><button data-down="${position}" title="Move down" ${position===controller.plugins.length-1||!identity(plugin)?'disabled':''}>▾</button></div>${options.openEditor&&controller.target.kind==='lane'&&!isNativeEqPlugin(plugin)&&plugin.hasEditor!==false?`<button class="mix-editor" data-editor="${position}" title="Open the ${esc(plugin.name)} editor" aria-label="Open the ${esc(plugin.name)} editor" ${plugin.index==null?'disabled':''}>GUI</button>`:''}<button class="mix-remove" data-remove="${position}" title="Remove ${esc(plugin.name)}" aria-label="Remove ${esc(plugin.name)}" ${!identity(plugin)?'disabled':''}>×</button></div>`);
    for(let i=rows.length;i<Math.max(8,controller.plugins.length);i++)rows.push(`<button class="mix-empty-slot" data-add><small>${i+1}</small>Empty slot</button>`);
    $('.mix-slots').innerHTML=`<div class="mix-slot-heading">EFFECT SLOTS <small>${controller.plugins.length}</small></div>${rows.join('')}`;
    $('.mix-slots').querySelectorAll('[data-select]').forEach(button=>button.onclick=()=>{const plugin=controller.plugins[+button.dataset.select];controller.tab='slots';run(()=>controller.readPlugin(plugin.index));});
    $('.mix-slots').querySelectorAll('[data-bypass]').forEach(button=>button.onclick=()=>run(()=>controller.bypass(controller.plugins[+button.dataset.bypass])));
    $('.mix-slots').querySelectorAll('[data-up]').forEach(button=>button.onclick=()=>{const p=+button.dataset.up;run(()=>controller.move(controller.plugins[p],controller.plugins[p-1].index));});
    $('.mix-slots').querySelectorAll('[data-down]').forEach(button=>button.onclick=()=>{const p=+button.dataset.down;run(()=>controller.move(controller.plugins[p],controller.plugins[p+1].index));});
    $('.mix-slots').querySelectorAll('[data-editor]').forEach(button=>button.onclick=()=>openEditor(controller.plugins[+button.dataset.editor]));
    $('.mix-slots').querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>run(()=>controller.remove(controller.plugins[+button.dataset.remove])));
    $('.mix-slots').querySelectorAll('[data-add]').forEach(button=>button.onclick=()=>{controller.tab='catalog';renderContent();});
  }
  async function renderContent(){
    const generation=++viewGeneration,content=$('.mix-content');dialog.nativeEq?.destroy();dialog.nativeEq=null;
    dialog.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('selected',button.dataset.tab===controller.tab));
    if(!controller.targetInfo){content.innerHTML='<p class="mix-empty">Choose a persisted cloud lane or bus to edit its plugin chain.</p>';return;}
    if(controller.tab==='catalog'&&!controller.catalogLoaded&&!controller.catalogError){content.innerHTML='<h3>Add a cloud plugin</h3><p class="mix-empty">Reading the Freestyle plug-in catalog…</p>';controller.ensureCatalog().then(()=>{if(generation===viewGeneration&&dialog.isConnected&&controller.tab==='catalog')renderContent();});return;}
    if(controller.tab==='catalog'){
      content.innerHTML='<h3>Add a cloud plugin</h3><input class="mix-search" placeholder="Find a plugin…" aria-label="Search cloud plugins"><p class="mix-note">Loaded plugins are available in this session. Catalog plugins are checked by Freestyle on the current audio host when loaded.</p><div class="mix-catalog"></div>';
      const catalog=content.querySelector('.mix-catalog'),paint=()=>{const query=content.querySelector('.mix-search').value.toLowerCase();catalog.innerHTML=controller.catalog.filter(item=>`${item.name} ${item.category}`.toLowerCase().includes(query)).map(item=>`<button class="mix-catalog-item" data-plugin-id="${esc(item.id)}" ${item.hostGated?'disabled':''}><span>${esc(item.name)}<small>${esc(item.category||item.kind||'Plugin')}</small></span><b>${item.hostGated?'NOT ON HOST':'＋ LOAD'}</b></button>`).join('')||'<p class="mix-empty">No matching catalog plugins.</p>';catalog.querySelectorAll('[data-plugin-id]').forEach(button=>button.onclick=()=>run(()=>controller.loadPlugin(button.dataset.pluginId)));};content.querySelector('.mix-search').oninput=paint;paint();return;
    }
    if(controller.tab==='routing'){
      const buses=controller.targets().filter(item=>item.kind==='bus'),runtime=controller.runtimeTrack;
      content.innerHTML=`<h3>Output routing</h3><p class="mix-note">${controller.target.kind==='lane'?'Send this lane to a cloud mixer bus.':'Bus output routing is managed by Freestyle.'}</p><label>Output bus<select class="mix-route" ${controller.target.kind!=='lane'||!runtime?'disabled':''}>${buses.map(bus=>`<option value="${esc(bus.id)}">${esc(bus.name)}</option>`).join('')}</select></label><button class="mix-route-apply primary" ${controller.target.kind!=='lane'||!runtime||!buses.length?'disabled':''}>Route lane</button>${controller.target.kind==='lane'&&!runtime?'<p class="mix-note">This persisted lane is not loaded in the live engine yet.</p>':''}<div class="mix-bus-list">${buses.map(bus=>`<div><span>${esc(bus.name)}</span><small>${list(bus.raw.plugins).length} plugins</small></div>`).join('')}</div>`;
      const select=content.querySelector('.mix-route');const routed=controller.target.kind==='lane'?controller.mixValue(mixKey('lane',controller.target.id,'bus'),runtime?.bus_id):null;if(routed)select.value=routed;content.querySelector('.mix-route-apply').onclick=()=>run(()=>controller.route(select.value));
      if(controller.mix){select.disabled=controller.target.kind!=='lane'||!buses.length;content.querySelector('.mix-route-apply').disabled=select.disabled;for(const note of content.querySelectorAll('.mix-note'))if(/not loaded in the live engine/.test(note.textContent))note.remove();}
      if(controller.target.kind==='bus'&&controller.mix){
        const raw=controller.targetInfo?.raw||{},master=controller.target.id==='master',gainKey=controller.busKey('gain');
        const panel=document.createElement('div');panel.className='mix-bus-controls';
        panel.innerHTML=`<label>Bus level<input class="mix-bus-gain" type="range" min="0" max="${master?2:4}" step="0.01" value="${controller.mixValue(gainKey,raw.gain??1)}" aria-label="${esc(controller.targetInfo?.name||'Bus')} level"></label>${master?'':`<button class="mix-bus-mute" aria-pressed="${!!controller.mixValue(controller.busKey('muted'),raw.muted)}">Mute</button><button class="mix-bus-solo" aria-pressed="${!!controller.mixValue(controller.busKey('soloed'),raw.soloed)}">Solo</button>`}`;
        content.querySelector('h3').after(panel);
        // Heard while the fader moves (MixSync.sweep → live path), saved once on release (MixSync.commit).
        const gain=panel.querySelector('.mix-bus-gain'),savedGain=()=>Number(controller.mixValue(gainKey,raw.gain??1));gain.onpointerdown=()=>controller.mix.begin(gainKey,savedGain());
        gain.onpointerup=gain.onpointercancel=()=>{if(controller.mix.release(gainKey))return;setTimeout(()=>{if(controller.mix.dragStart.has(gainKey))run(()=>controller.busCommit('gain',gain.value));},0);};
        gain.oninput=()=>{if(controller.busy)return;if(!controller.mix.dragStart.has(gainKey))controller.mix.begin(gainKey,savedGain());controller.mix.sweep(gainKey,Number(gain.value));};
        gain.onchange=()=>run(()=>controller.busCommit('gain',gain.value));
        for(const field of ['muted','soloed']){const button=panel.querySelector(field==='muted'?'.mix-bus-mute':'.mix-bus-solo');if(button)button.onclick=()=>run(()=>controller.busControl(field,button.getAttribute('aria-pressed')!=='true'));}
      }
      return;
    }
    if(controller.tab==='presets'){
      if(controller.target.kind!=='lane'){content.innerHTML='<p class="mix-empty">Choose a lane to browse and apply complete chain presets.</p>';return;}
      content.innerHTML='<h3>Chain presets</h3><p class="mix-note">Applying a preset replaces the selected lane’s processing chain.</p><div class="mix-preset-list">Loading your cloud preset library…</div><div class="mix-preset-preview"></div>';
      const sources=controller.targets().filter(item=>item.kind==='lane'&&item.id!==controller.target.id&&!['instrument','pattern','midi','bus'].includes(String(item.raw?.kind??item.raw?.type??'').toLowerCase()));if(sources.length){const copy=document.createElement('div');copy.className='mix-copy-chain';copy.innerHTML=`<label>Copy effects from <select aria-label="Effect chain source">${sources.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></label><button>Replace this lane’s effect chain</button>`;content.prepend(copy);copy.querySelector('button').onclick=()=>run(()=>controller.copyChain(copy.querySelector('select').value));}
      try{const presets=await controller.chainPresets();if(generation!==viewGeneration||!dialog.isConnected)return;const container=content.querySelector('.mix-preset-list');container.innerHTML=presets.map(preset=>`<button data-preset="${esc(preset.id)}"><span>${esc(preset.name)}</span><small>${esc(preset.chainKind||'Chain')}</small></button>`).join('')||'<p class="mix-empty">No chain presets returned.</p>';for(const button of container.querySelectorAll('[data-preset]'))button.onclick=async()=>{const preview=content.querySelector('.mix-preset-preview');preview.textContent='Reading the selected preset…';try{const result=await controller.inspectPreset(button.dataset.preset);if(generation!==viewGeneration)return;preview.innerHTML=`<strong>${esc(result.preset?.name||button.textContent)}</strong><p>${list(result.chain?.plugins).map(plugin=>esc(plugin.name||plugin.label||plugin.type||'Plugin')).join(' → ')||'Cloud processing chain'}</p><button class="primary mix-apply-preset">Apply to ${esc(controller.targetInfo?.name)}</button>`;preview.querySelector('button').onclick=()=>run(()=>controller.applyPreset(button.dataset.preset));}catch(error){preview.textContent=error.message;}};
      }catch(error){if(generation===viewGeneration)content.querySelector('.mix-preset-list').textContent=error.message;}return;
    }
    const plugin=controller.plugins.find(item=>item.index===controller.selectedIndex);
    if(!plugin){content.innerHTML='<h3>Plugin parameters</h3><p class="mix-empty">Select a loaded slot to read its parameters and programs from Freestyle.</p><p class="mix-note">Plugin load, processing and audio rendering run in the cloud.</p>';return;}
    content.innerHTML=`<h3>${esc(plugin.name)}</h3><div class="mix-plugin-meta">SLOT ${plugin.index+1} <span>${esc(plugin.format||'CLOUD PLUGIN')}</span>${options.openEditor&&controller.target.kind==='lane'&&!isNativeEqPlugin(plugin)&&plugin.hasEditor!==false?' <button class="mix-open-editor primary">Open plugin editor</button>':''}</div><div class="mix-parameters"></div><div class="mix-program"></div><div class="mix-effect-presets"></div><button class="mix-snapshot">Read saved chain state</button><span class="mix-snapshot-status"></span>`;
    const editorButton=content.querySelector('.mix-open-editor');if(editorButton)editorButton.onclick=()=>openEditor(plugin);
    if(controller.target.kind==='lane'&&isNativeEqPlugin(plugin)){
      const editor=new NativeEqEditor({call:controller.call,action:controller.action?(name,args,opts)=>controller.action(name,args,opts):null,projectId:controller.projectId,contextTrackId:controller.contextTrackId,laneId:controller.target.id,pluginIndex:plugin.index,instanceId:identity(plugin),cachedState:()=>controller.state});
      dialog.nativeEq?.destroy();dialog.nativeEq=editor;editor.mount(content.querySelector('.mix-parameters'));editor.load().catch(error=>options.onError?.(error));
      content.querySelector('.mix-snapshot').onclick=async()=>{const target=content.querySelector('.mix-snapshot-status');target.textContent=' Reading…';try{const result=await controller.savedState();target.textContent=` ${list(result.plugins||result.snapshots).length} saved plugin snapshots`;}catch(error){target.textContent=` ${error.message}`;}};
      return;
    }
    const parameters=content.querySelector('.mix-parameters');parameters.innerHTML=controller.parameters.length?controller.parameters.map(parameter=>{const physical=controller.physicalWritable(plugin,parameter),writable=parameter.writeForms.includes('value_norm');return `<label class="mix-parameter"><span>${esc(parameter.name)}<small>${esc(parameter.display||parameter.unit||'')}</small></span><input type="range" min="0" max="1" step="0.001" data-param="${parameter.index}" value="${parameter.normalized??0}" ${parameter.normalized===null||!writable?'disabled':''} aria-label="${esc(parameter.name)} normalized slider">${physical?`<input class="mix-param-value" type="number" ${parameter.physicalMin===null?'':`min="${parameter.physicalMin}"`} ${parameter.physicalMax===null?'':`max="${parameter.physicalMax}"`} step="${finite(parameter.step)&&Number(parameter.step)>0?Number(parameter.step):'any'}" data-physical="${parameter.index}" value="${parameter.physicalValue??''}" aria-label="${esc(parameter.name)} ${esc(parameter.unit||'physical value')}">`:`<input class="mix-param-value" type="number" min="0" max="1" step="0.001" data-value="${parameter.index}" value="${parameter.normalized??''}" ${!writable?'disabled':''} placeholder="0…1" aria-label="${esc(parameter.name)} normalized value">`}</label>`;}).join(''):'<p class="mix-empty">No writable parameters were returned for this plugin.</p>';
    parameters.querySelectorAll('[data-param]').forEach(input=>{input.oninput=()=>{const numeric=parameters.querySelector(`[data-value="${input.dataset.param}"]`);if(numeric)numeric.value=input.value;controller.liveParameter(plugin,+input.dataset.param,+input.value);};input.onchange=()=>{controller.liveControl?.flush(controller.liveControl.parameterKey({laneId:controller.target.id,pluginIndex:plugin.index,parameterIndex:+input.dataset.param}));run(()=>controller.parameter(plugin,+input.dataset.param,+input.value));};});parameters.querySelectorAll('[data-value]').forEach(input=>input.onchange=()=>run(()=>controller.parameter(plugin,+input.dataset.value,input.value)));parameters.querySelectorAll('[data-physical]').forEach(input=>input.onchange=()=>run(()=>controller.parameter(plugin,+input.dataset.physical,input.value,{form:'value'})));
    const count=controller.snapshot?.program_count;if(controller.target.kind==='lane'&&Number.isInteger(count)&&count>0&&count<=4096){const programs=list(controller.snapshot.programs);content.querySelector('.mix-program').innerHTML=`<label>Program<select class="mix-program-select">${Array.from({length:count},(_,index)=>`<option value="${index}">${esc(programs.find(program=>program.index===index)?.name||`Program ${index+1}`)}</option>`).join('')}</select></label>`;const select=content.querySelector('.mix-program-select');select.value=controller.snapshot.current_program_index;select.onchange=()=>run(()=>controller.program(plugin,+select.value));}
    if(controller.target.kind==='lane'&&/nectar/i.test(plugin.name)){content.querySelector('.mix-effect-presets').innerHTML='<button class="mix-effect-browse">Browse Nectar presets</button><div class="mix-effect-results"></div>';content.querySelector('.mix-effect-browse').onclick=async()=>{const box=content.querySelector('.mix-effect-results');box.textContent='Reading the Nectar catalog…';try{const result=await controller.effectPresets('nectar');if(generation!==viewGeneration)return;box.innerHTML=`<select>${[...controller.effectPresetNames].map(name=>`<option>${esc(name)}</option>`).join('')}</select><button>Apply plugin preset</button>${result.truncated?'<small>Catalog limited by Freestyle.</small>':''}`;box.querySelector('button').onclick=()=>run(()=>controller.applyEffectPreset(plugin,box.querySelector('select').value));}catch(error){box.textContent=error.message;}};}
    content.querySelector('.mix-snapshot').onclick=async()=>{const target=content.querySelector('.mix-snapshot-status');target.textContent=' Reading…';try{const result=await controller.savedState();target.textContent=` ${list(result.plugins||result.snapshots).length} saved plugin snapshots`;}catch(error){target.textContent=` ${error.message}`;}};
  }
  try{let painted=false;await controller.refresh({onSlots:()=>{painted=true;render();status('Cloud mixer ready');}});render();if(!painted)status('Cloud mixer ready');}catch(error){render();status(mixerErrorText(error),true);options.onError?.(error);}
  return dialog;
}
