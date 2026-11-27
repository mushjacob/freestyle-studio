/**
 * Disabelton device presets (Live's preset / hot-swap area in a device title bar).
 *
 * Sources, all read through the device's own MixerToolsController (the guarded lane-plugin path):
 *  - program-based plug-ins: listLanePluginParameters' plugin.programCount / currentProgram
 *    (controller.snapshot.program_count / current_program_index / programs) → setLanePluginProgram
 *    (controller.program, instance-checked, verified by a re-read). ⌘Z = setLanePluginProgram(previous index):
 *    an exact inverse, recorded as ONE external history step.
 *  - named presets: getCatalogPlugin.presetCatalog → listCatalogEffectPresets(kind) (controller.pluginPresets), plus
 *    listCatalogPluginPresets?q=<plug-in> rows that name this plug-in type → applyLanePluginPreset
 *    (controller.applyEffectPreset, instance-checked). Freestyle has NO inverse for a named preset
 *    (getLanePluginState returns an empty state_base64; no "previous preset" field), so it is not an Undo step;
 *    the toast says so.
 *  - chain (rack) presets: listCatalogVocalChainPresets is readable, but the published API has no apply operation
 *    (MixerToolsController.applyPreset is REST-unavailable), so nothing is offered.
 *  - LABS / Omnisphere / Splice INSTRUMENT patches (kind 'patch'), as the Freestyle Studio applies them: one ordered mozart-control
 *    message {type:'instrument_patch_apply', project_id, key:'patch:<lane_id|track_id>', seq, client_sent_ms,
 *    engine:'labs'|'omnisphere'|'splice_instrument', track_id:<engine track id>, lane_id, body:{plugin_index,
 *    directory, preset_name, patch_key, project_id, lane_id, instance_id}}; the engine answers
 *    {type:'instrument_patch_received', seq} (the Freestyle Studio waits 900 ms, else marks the channel unusable and uses HTTP) and then
 *    {type:'instrument_patch_ack', seq, ok, http_status, code, message, runtime_type…} (30 s). The choice is then saved
 *    through the published engine_set_labs_preset {instrument_id, preset} (interactive rate, reversible) — the Freestyle Studio
 *    keeps it in the project's instrumentPatches[laneId], which the public API reads back but does not write.
 *    Undo = apply the previous patch the same way (one history step).
 *    Patch LIST: there is no published full patch list for OAuth apps. The only published read is engine_search_patches (read,
 *    AI-rated, ≤25 semantic matches with family/pack/name/patch_key), which app.js queries once per lane on demand.
 *    REST save: engine_set_labs_preset answers 400 "Missing patch_key or directory/preset_name." for every body form the
 *    schema allows, so without the channel nothing can apply a patch (engine request S).
 */
const text=value=>String(value??'').trim();
const typeOf=plugin=>text(plugin?.type_id??plugin?.typeId??plugin?.type);
export const ABL_PRESET_REASONS=Object.freeze({
 none:name=>`${name||'This device'}: Freestyle reports no programs and lists no presets for it.`,
 patches:name=>`${name||'This instrument'}: no patches listed. Studio Pro reads its patch list from the engine's own catalog route (GET /instruments/labs/presets), which needs a Freestyle web sign-in and rejects this OAuth connection (401 invalid_auth); Freestyle's published search_patches returned nothing for it.`,
 patchOffline:'Connect cloud audio (▶ once) to switch patches: Studio Pro sends them over the live engine channel, its HTTP fallback is an engine route this OAuth connection cannot use, and Freestyle’s published set_labs_preset refuses every LABS patch (engine_invalid_arguments).',
 patchNoReceipt:'The live engine channel did not confirm the patch within 4 s, the saved project still shows the previous patch, and Freestyle’s published set_labs_preset refuses LABS patches, so nothing changed. Try again.',
 patchUnsaved:'Playing now, but Freestyle did not save it: the published set_labs_preset refuses LABS patches (engine_invalid_arguments), so a reload brings back the saved patch.',
 patchNoUndo:'The previous patch is not in Freestyle’s patch list, so ⌘Z cannot restore it.',
 namedUndo:'Freestyle has no inverse for a named preset, so ⌘Z cannot restore the previous sound (Undo restores program changes only).',
 chain:'Chain presets: Freestyle lists them, but the published API has no operation that applies one.',
});
/** Per-instance memory of the last named preset applied here (Freestyle reports no current preset name). */
const lastNamed=new Map();
/** QA r14: the identity ({name, directory, patch_key}) of the patch last applied per instance this page — the saved row keeps
 * only the preset NAME, so this is what lets ⌘Z re-apply a patch that the AI-rated search does not list again. */
const rememberedPatches=new Map();
export function presetMemoryKey(laneId,plugin){return `${laneId}|${plugin?.instance_id??plugin?.instanceId??plugin?.id??''}`;}

/** Patch-capable instrument families (Pro's WYt: omnisphere, labs, splice_instrument). */
export function patchFamily(plugin){const value=`${typeOf(plugin)} ${text(plugin?.name)} ${text(plugin?.displayName)} ${text(plugin?.runtime_type??plugin?.runtimeType)}`.toLowerCase();return /\blabs\b|spitfire labs/.test(value)?'labs':/omnisphere/.test(value)?'omnisphere':/splice[ _-]?instrument/.test(value)?'splice_instrument':null;}
/** App hooks for instrument patches: {list({plugin,laneId,family}) → [{name, directory?, patch_key?}], current(laneId) → name|null,
 *  channel() → {send(payload), on(fn) → off, nextSeq(), projectId} | null, persist({plugin,laneId,family,patch}) → receipt,
 *  engineTrackId(laneId, plugin) → number|null, log}. */
let patchHooks=null;
export function configureInstrumentPatches(hooks){patchHooks=hooks&&typeof hooks==='object'?hooks:null;return patchHooks;}
/** The patch list for one patch-capable instrument, from the published API only (see the header): the catalog's own preset
 * rows when Freestyle ever returns them, else ONE engine_search_patches read per (project, family, query), cached for the
 * page (it is AI-rated, so it is never sent on render, only when the chooser or ◀ ▶ is used). Rows: {name, directory, patch_key}. */
const patchListCache=new Map();
export function forgetPatchLists(){patchListCache.clear();}
export async function listPublishedPatches({client,projectId,plugin,family,current=''}={}){
 if(!client||!projectId||!family)return[];
 const id=typeOf(plugin);
 if(id)try{const reply=await client.call('getCatalogPlugin',{path:{plugin_id:id}});const data=reply?.data?.data??reply?.data??{},rows=data.presets??data.presetCatalog?.presets??data.patches??[];
  const named=(Array.isArray(rows)?rows:[]).map(row=>typeof row==='string'?{name:row}:row).filter(row=>text(row?.name));if(named.length)return named;}catch{}
 const query=(text(current)||(family==='labs'?'LABS':family)).slice(0,200),key=`${projectId}|${family}|${query.toLowerCase()}`;
 if(patchListCache.has(key))return patchListCache.get(key);
 const pending=(async()=>{const reply=await client.call('engine_search_patches',{path:{project_id:projectId},body:{query,plugin:family,limit:25}});
  const data=reply?.data?.data??reply?.data??{},rows=data?.response?.candidates??data?.candidates??[];
  return(Array.isArray(rows)?rows:[]).filter(row=>!row?.family||String(row.family).toLowerCase()===family).map(row=>({name:text(row?.name),directory:text(row?.pack??row?.directory),patch_key:text(row?.patch_key)})).filter(row=>row.name&&(row.patch_key||row.directory))
   .sort((a,b)=>a.directory.localeCompare(b.directory)||a.name.localeCompare(b.name));})();
 patchListCache.set(key,pending);pending.catch(()=>patchListCache.delete(key));return pending;
}
/** Pro marks a mozart-control channel that missed the 900 ms instrument_patch_received as unusable for patches (WeakSet). */
const patchDeafChannels=new WeakSet(),patchMisses=new WeakMap();// QA r16: one late receipt (after ~30 s idle) must not deafen the channel for the session
/** The patch channel over a CloudMonitor's open mozart-control (QA r13: built here so it is tested against the real
 * CloudMonitor shape). Pro's gate is only "channel open + same project"; the monitor's own write grant is honoured too.
 * Engine replies arrive as the monitor's 'control' events (CustomEvent detail = the parsed message). */
export function monitorPatchChannel(monitor,projectId){
 const control=monitor?.control,id=String(projectId||'');
 if(!monitor||!id||!control||control.readyState!=='open'||typeof control.send!=='function'||patchDeafChannels.has(control))return null;
 if(String(monitor.projectId||'')!==id||['closed','failed'].includes(monitor.peer?.connectionState)||monitor.channelWritesAllowed?.()===false)return null;
 return{projectId:id,target:control,nextSeq:()=>monitor.sequence=(Number(monitor.sequence)||0)+1,send:payload=>control.send(JSON.stringify(payload)),
  on:fn=>{const listener=event=>fn(event.detail);monitor.addEventListener('control',listener);return()=>monitor.removeEventListener('control',listener);}};
}
/** One instrument_patch_apply over mozart-control (Pro's message, received/ack handshake). Resolves the ack, or null when
 * the channel is unavailable / did not confirm receipt within receivedMs (the caller then saves over REST only). */
export function sendInstrumentPatch(channel,{family,trackId,laneId,body},{receivedMs=900,lateMs=4000,ackMs=30000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(!channel||typeof channel.send!=='function'||typeof channel.on!=='function')return Promise.resolve(null);
 const seq=channel.nextSeq(),projectId=channel.projectId;
 return new Promise(resolve=>{let done=false,timer=null,received=false;const off=channel.on(message=>{if(!message||Number(message.seq)!==seq||String(message.project_id||projectId)!==String(projectId))return;if(message.type==='instrument_patch_received'){received=true;clearTimer(timer);timer=setTimer(()=>finish(null),ackMs);}else if(message.type==='instrument_patch_ack'){received=true;finish(message);}});
  const target=channel.target&&typeof channel.target==='object'?channel.target:null;
  const finish=value=>{if(done)return;done=true;clearTimer(timer);try{off?.();}catch{}if(target){if(received)patchMisses.delete(target);else{const misses=(patchMisses.get(target)||0)+1;patchMisses.set(target,misses);if(misses>=2)patchDeafChannels.add(target);}}resolve(value);};
  // Pro waits 900 ms for the receipt; a receipt or ack that arrives within a short grace after that is still honoured (r16:
  // after ~30 s idle the engine confirmed late, the patch applied, and treating it as "nothing changed" desynced history).
  timer=setTimer(()=>{if(!received)timer=setTimer(()=>{if(!received)finish(null);},Math.max(0,lateMs-receivedMs));},receivedMs);
  try{channel.send({type:'instrument_patch_apply',project_id:projectId,key:`patch:${laneId||trackId}`,seq,client_sent_ms:Date.now(),engine:family,track_id:Number(trackId)||0,lane_id:String(laneId||''),body});}catch{finish(null);}
 });
}
/** Apply one patch: the channel first (instant sound, Pro), then the saved choice over REST. */
export async function applyInstrumentPatch({plugin,laneId,family,patch,hooks=patchHooks}={}){
 if(!hooks)throw new Error('Instrument patches are not available yet.');
 const name=text(patch?.name);if(!name)throw new Error('Choose a patch Freestyle listed for this instrument.');
 const trackId=hooks.engineTrackId?.(laneId,plugin)??null,body={plugin_index:Number.isInteger(plugin?.index)?plugin.index:0,directory:text(patch.directory??patch.directory_id),preset_name:name,patch_key:text(patch.patch_key??patch.patchKey),project_id:hooks.projectId?.()||'',lane_id:laneId||'',instance_id:text(plugin?.instance_id??plugin?.instanceId)};
 // QA r13: the published API has no numeric engine track for a lane, so trackId is usually null in Studio-API mode. Pro
 // sends anyway (track_id: Number(mozartTrackId)||0, key patch:<lane_id>): the engine resolves the lane by lane_id.
 let ack=null,channel=hooks.channel?.()||null;
 // QA r19: within ~10 s of a reload the live channel is still being set up; wait for it (bounded) rather than failing.
 if(!channel&&hooks.channelConnecting?.()){try{hooks.status?.(`${text(plugin?.displayName??plugin?.name)||'Instrument'}: waiting for cloud audio to connect…`);}catch{}const started=Date.now();while(!channel&&Date.now()-started<(hooks.connectWaitMs??12000)&&hooks.channelConnecting?.()){await new Promise(resolve=>setTimeout(resolve,250));channel=hooks.channel?.()||null;}}
 if(channel&&(laneId||trackId!=null))ack=await sendInstrumentPatch(channel,{family,trackId,laneId,body});
 if(ack&&(ack.ok===false||Number(ack.http_status)>=400))throw Object.assign(new Error(ack.message||`The engine refused the patch (${ack.code||ack.http_status}).`),{code:ack.code||'instrument_patch_refused',dispatched:true,transient:true});
 let saved=null,saveError=null,savedRow=null;
 // QA r14: an acked channel apply IS saved by Freestyle (lanes[].pluginChain[i].preset changed and survived a reload), so the
 // saved row is read back; the published set_labs_preset (which refuses LABS patches) is only tried when that row shows
 // another patch. Without a readable row the ack is trusted, as Studio Pro does.
 // QA r16: no receipt is not proof nothing changed: read the saved row and accept the switch when it names the new patch.
 if(!ack&&channel&&typeof hooks.savedPreset==='function'){let row=null;try{row=await hooks.savedPreset({plugin,laneId,family,patch,pluginIndex:body.plugin_index});}catch{row=null;}if(typeof row==='string'&&row.trim().toLowerCase()===name.toLowerCase())ack={ok:true,confirmedBy:'saved_row'};}
 if(ack&&typeof hooks.savedPreset==='function'){try{savedRow=await hooks.savedPreset({plugin,laneId,family,patch,pluginIndex:body.plugin_index});}catch{savedRow=null;}}
 const rowSaved=ack&&typeof savedRow==='string'&&savedRow.trim().toLowerCase()===name.toLowerCase();
 if(rowSaved)saved={source:'saved_row',preset:savedRow};
 else{try{saved=await hooks.persist?.({plugin,laneId,family,patch,trackId})??null;}catch(error){saveError=error;}}
 // The ack is trusted when no saved row could be read (null); a row naming another patch keeps the refusal visible.
 if(saveError&&ack&&typeof savedRow!=='string'){saved={source:'ack'};saveError=null;}
 if(!saveError)rememberedPatches.set(presetMemoryKey(laneId,plugin),{name,directory:body.directory,patch_key:body.patch_key});
 hooks.log?.('abl-instrument-patch',{laneId,family,route:ack?'channel':'rest',channel:channel?(ack?'acked':'no-receipt'):'unavailable',trackId:trackId??null,name,saved:!saveError,savedBy:saveError?null:saved?.source||'rest',savedRow:typeof savedRow==='string'?savedRow:null,code:saveError?.code||saveError?.payload?.error?.code||null});
 // No live channel and the published save refused it: nothing changed anywhere, so say exactly why (a transient toast).
 if(!ack&&saveError)throw Object.assign(new Error(channel?ABL_PRESET_REASONS.patchNoReceipt:ABL_PRESET_REASONS.patchOffline),{code:'instrument_patch_unavailable',dispatched:false,cause:saveError,transient:true});
 lastNamed.set(presetMemoryKey(laneId,plugin),name);return{route:ack?'channel':'rest',ack,saved,unsaved:!!saveError};
}

/** {name, directory, patch_key} for a saved patch NAME: a patch applied on this instance this page, else the single exact
 * (case-insensitive) name match of one more published search ("<family> <name>"); null when it stays ambiguous/unknown. */
async function resolvePatchIdentity({plugin,laneId,family,name}){
 const lower=text(name).toLowerCase();if(!lower)return null;
 const own=rememberedPatches.get(presetMemoryKey(laneId,plugin));if(own&&own.name.toLowerCase()===lower&&(own.patch_key||own.directory))return{...own};
 let rows=[];try{rows=(await patchHooks?.list?.({plugin,laneId,family,current:`${family==='labs'?'LABS':family} ${text(name)}`}))||[];}catch{rows=[];}
 const exact=new Map();for(const row of rows){const rowName=text(row?.name??row?.preset_name);if(rowName.toLowerCase()!==lower)continue;const identity={name:rowName,directory:text(row?.directory??row?.directory_id),patch_key:text(row?.patch_key??row?.patchKey)};if(identity.patch_key||identity.directory)exact.set(`${identity.directory}|${identity.patch_key}`,identity);}
 return exact.size===1?[...exact.values()][0]:null;
}
/** The choices for one loaded device: {kind:'program'|'preset'|'patch'|'none', items:[{label,value}], current, reason}. */
export async function readPresetChoices({controller,plugin,laneId,client=null,log=()=>{}}={}){
 const name=text(plugin?.displayName||plugin?.name)||typeOf(plugin)||'Device';
 const family=patchHooks?patchFamily(plugin):null;
 if(family)try{
  const saved=text(patchHooks.current?.(laneId,plugin))||text(plugin?.preset??plugin?.presetName??plugin?.preset_name);
  const rows=(await patchHooks.list?.({plugin,laneId,family,current:saved}))||[],seen=new Set(),items=[];
  for(const row of rows){const name=text(row?.name??row?.preset_name),label=name&&text(row?.directory)?`${text(row.directory)}/${name}`:name;if(!label||seen.has(label))continue;seen.add(label);items.push({value:label,label,patch:{name,directory:row?.directory??row?.directory_id??'',patch_key:row?.patch_key??row?.patchKey??''}});}
  if(items.length){const remembered=lastNamed.get(presetMemoryKey(laneId,plugin))||saved,lower=String(remembered||'').toLowerCase();
   const match=()=>items.find(item=>item.value===remembered)??items.find(item=>item.patch.name===remembered)??items.find(item=>lower&&item.patch.name.toLowerCase()===lower);
   // QA r14: the saved patch ("Percussion") was not among the 25 AI-rated matches, so ⌘Z had no previous patch to apply.
   // Resolve its identity from this page's own applies, else from ONE more exact-name search; never guess a directory.
   if(remembered&&!match()){const identity=await resolvePatchIdentity({plugin,laneId,family,name:remembered});if(identity){const label=identity.directory?`${identity.directory}/${identity.name}`:identity.name;if(!seen.has(label)){seen.add(label);items.unshift({value:label,label,patch:identity,saved:true});}}}
   return{kind:'patch',family,items,current:match()?.value??null,reason:null};}
 }catch(error){log('abl-device-patches',{family,message:String(error?.message||error).slice(0,160)});}
 const snapshot=controller?.snapshot||{},count=Number(snapshot.program_count);
 if(Number.isInteger(count)&&count>0&&count<=4096){
  const programs=Array.isArray(snapshot.programs)?snapshot.programs:[];
  const items=Array.from({length:count},(_,index)=>({value:index,label:text(programs.find(row=>row?.index===index)?.name)||(index===snapshot.current_program_index&&text(snapshot.current_program_name))||`Program ${index+1}`}));
  return{kind:'program',items,current:Number.isInteger(snapshot.current_program_index)?snapshot.current_program_index:null,reason:null};
 }
 const names=[];
 try{if(typeof controller?.pluginPresets==='function'){await controller.pluginPresets(plugin);for(const value of controller.effectPresetNames||[])if(!names.includes(value))names.push(value);}}
 catch(error){log('abl-device-presets-catalog',{type:typeOf(plugin),message:String(error?.message||error).slice(0,160)});}
 // Marketplace presets that name this plug-in type (rows are opaque objects: match only an explicit type field).
 if(client&&typeOf(plugin))try{
  const reply=await client.call('listCatalogPluginPresets',{query:{q:name.slice(0,128),limit:50}});const rows=Array.isArray(reply?.data?.data)?reply.data.data:[];
  for(const row of rows){const owner=text(row?.pluginId??row?.plugin_id??row?.typeId??row?.type_id??row?.plugin?.id);const label=text(row?.name??row?.title);if(label&&owner.toLowerCase()===typeOf(plugin).toLowerCase()&&!names.includes(label))names.push(label);}
  if(names.length&&controller?.effectPresetNames instanceof Set)for(const value of names)controller.effectPresetNames.add(value);
 }catch(error){log('abl-device-presets-marketplace',{message:String(error?.message||error).slice(0,160)});}
 if(names.length){const remembered=lastNamed.get(presetMemoryKey(laneId,plugin));return{kind:'preset',items:names.map(value=>({value,label:value})),current:names.includes(remembered)?remembered:null,reason:null};}
 return{kind:'none',items:[],current:null,reason:plugin?.instrument?ABL_PRESET_REASONS.patches(name):ABL_PRESET_REASONS.none(name)};
}

/** The neighbour for Pro's ↑/↓ previous / next sound; null at either end or with nothing to step. */
export function neighbourChoice(choices,direction){
 const items=choices?.items||[];if(!items.length)return null;
 const at=items.findIndex(item=>item.value===choices.current);
 const next=at<0?(direction>0?0:items.length-1):at+direction;
 return next>=0&&next<items.length?items[next]:null;
}

/** Apply one choice through the controller. Program changes return an exact {undo, redo} pair; presets return none. */
export async function applyPresetChoice({controller,plugin,laneId,choices,value,reload}={}){
 if(choices?.kind==='program'){
  const from=choices.current;if(!Number.isInteger(value))throw new Error('Choose a program reported by this plug-in.');
  if(from===value)return{changed:false};
  await controller.program(plugin,value);
  if(controller.pluginMutation?.requiresInspection)throw Object.assign(new Error('Freestyle did not confirm the program change. Inspect the plug-in before editing again.'),{dispatched:true});
  const step=to=>async()=>{const fresh=await reload();const now=fresh?.snapshot?.current_program_index;const expected=to===from?value:from;
   if(Number.isInteger(now)&&now!==expected&&now!==to)throw Object.assign(new Error('The program changed elsewhere, so this step was not applied.'),{dispatched:false});
   if(now!==to)await fresh.program(plugin,to);return{laneId,pluginIndex:plugin.index,program:to};};
  return{changed:true,undo:Number.isInteger(from)?step(from):null,redo:step(value),from,to:value};
 }
 if(choices?.kind==='patch'){
  const item=choices.items.find(entry=>entry.value===value);if(!item)throw new Error('Choose a patch Freestyle listed for this instrument.');
  const from=choices.current;if(from===value)return{changed:false};const before=choices.items.find(entry=>entry.value===from)||null;
  const step=target=>async()=>{const receipt=await applyInstrumentPatch({plugin,laneId,family:choices.family,patch:target.patch});choices.current=target.value;return{laneId,pluginIndex:plugin?.index,patch:target.value,route:receipt.route};};
  const receipt=await applyInstrumentPatch({plugin,laneId,family:choices.family,patch:item.patch});choices.current=value;
  return{changed:true,undo:before?step(before):null,redo:step(item),from,to:value,route:receipt.route,unsaved:receipt.unsaved};
 }
 if(choices?.kind==='preset'){
  if(!choices.items.some(item=>item.value===value))throw new Error('Choose a preset Freestyle returned for this plug-in.');
  await controller.applyEffectPreset(plugin,value);lastNamed.set(presetMemoryKey(laneId,plugin),value);return{changed:true,undo:null,redo:null,preset:value};
 }
 throw new Error(choices?.reason||'This device has no presets.');
}
export function forgetPresetMemory(){lastNamed.clear();rememberedPatches.clear();}
