/** Numeric editor targets require a current verified native mixer read.
 * Saved REST lanes can supply durable handles, resolved only by the server ACK.
 */
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const identity=value=>typeof value==='string'&&value.trim().length>0;
const index=value=>Number.isSafeInteger(value)&&value>=0;
const track=value=>Number.isSafeInteger(value)&&value>0;
function aliases(value,keys,valid){
 if(!value||typeof value!=='object')return null;
 const values=keys.filter(key=>own(value,key)).map(key=>value[key]);
 return values.length&&values.every(item=>valid(item)&&item===values[0])?values[0]:null;
}

/** Invalid, stale, ambiguous and saved-only observations return null. */
export function resolvePluginEditorBinding({model,projectId,laneId,plugin}={}){
 if(!identity(projectId)||!identity(laneId)||model?.projectId!==projectId||model.reads?.lanes!=='ready'||model.reads?.runtimeTracks!=='ready'||!Array.isArray(model.rows))return null;
 const rows=model.rows.filter(row=>row?.kind==='lane'&&row.id===laneId);
 if(rows.length!==1)return null;
 const row=rows[0],engineTrackId=row.runtime?.trackId;
 if(row.persisted!==true||row.verified!==true||row.rawPersisted?.id!==laneId||row.runtime?.status!=='bound'||!track(engineTrackId)||row.rawRuntime?.id!==engineTrackId||row.rawRuntime?.db_track_id!==laneId)return null;
 // A native track may not be shared by two persisted lane rows.
 if(model.rows.filter(item=>item?.kind==='lane'&&item.runtime?.trackId===engineTrackId).length!==1)return null;
 const pluginIndex=aliases(plugin,['index','plugin_index'],index),instanceId=aliases(plugin,['instance_id','instanceId'],identity);
 if(pluginIndex===null||instanceId===null||row.plugins?.status!=='ready'||row.plugins.origin!=='runtime'||!Array.isArray(row.plugins.slots))return null;
 const slots=row.plugins.slots,atIndex=slots.filter(slot=>slot?.index===pluginIndex);
 if(atIndex.length!==1||slots.filter(slot=>slot?.instanceId===instanceId).length!==1)return null;
 const slot=atIndex[0],binding=slot.binding,editor=slot.editorBinding;
 if(slot.origin!=='runtime'||slot.status!=='bound'||slot.instanceId!==instanceId||aliases(slot.raw,['index','plugin_index'],index)!==pluginIndex||aliases(slot.raw,['instance_id','instanceId'],identity)!==instanceId)return null;
 if(binding?.kind!=='lane'||binding.laneId!==laneId||binding.runtimeTrackId!==engineTrackId||binding.pluginIndex!==pluginIndex||binding.instanceId!==instanceId)return null;
 if(editor?.laneId!==laneId||editor.engineTrackId!==engineTrackId||editor.pluginIndex!==pluginIndex||editor.instanceId!==instanceId)return null;
 const nativePlugins=row.rawRuntime.plugins;
 if(!Array.isArray(nativePlugins)||nativePlugins.filter(item=>aliases(item,['index','plugin_index'],index)===pluginIndex).length!==1||nativePlugins.filter(item=>aliases(item,['instance_id','instanceId'],identity)===instanceId).length!==1)return null;
 const native=nativePlugins.find(item=>aliases(item,['index','plugin_index'],index)===pluginIndex);
 if(aliases(native,['instance_id','instanceId'],identity)!==instanceId)return null;
 return Object.freeze({laneId,engineTrackId,pluginIndex,instanceId});
}

/** Saved lane + freshly inspected plugin chain for a typed durable-lane resolver.
 * This is NOT a numeric WebRTC target; only the open acknowledgement can supply
 * that identity. Call after ensurePlugin, never from saved pluginChain guesses.
 */
export function resolveRestPluginEditorBinding({savedProject,projectId,laneId,plugin,plugins}={}){
 const incomplete=(value,seen=new WeakSet())=>{if(!value||typeof value!=='object'||seen.has(value))return false;seen.add(value);return Object.entries(value).some(([key,child])=>((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&(typeof child==='object'?Object.values(child||{}).some(Boolean):!!child))||incomplete(child,seen));};
 if(!identity(projectId)||!identity(laneId)||savedProject?.id!==projectId||!Array.isArray(savedProject.lanes)||incomplete(savedProject.lanes)||savedProject.truncated===true||savedProject._truncated===true&&savedProject.truncated?.lanes!==false||savedProject.truncated?.lanes===true||savedProject.lanesTruncated===true||savedProject.lanes_truncated===true||!Array.isArray(plugins)||incomplete(plugins))return null;
 const lanes=savedProject.lanes.filter(lane=>lane?.id===laneId);if(lanes.length!==1||!['audio','vocal','instrument','guitar'].includes(lanes[0].kind))return null;
 const instance=value=>['instance_id','instanceId'].some(key=>own(value,key))?aliases(value,['instance_id','instanceId'],identity):aliases(value,['id'],identity);
 const pluginIndex=aliases(plugin,['index','plugin_index'],index),instanceId=instance(plugin);
 if(pluginIndex===null||instanceId===null)return null;
 const slots=plugins.map(slot=>({index:aliases(slot,['index','plugin_index'],index),instance:instance(slot)}));
 if(slots.some(slot=>slot.index===null||slot.instance===null)||new Set(slots.map(slot=>slot.index)).size!==slots.length||new Set(slots.map(slot=>slot.instance)).size!==slots.length||slots.filter(slot=>slot.index===pluginIndex&&slot.instance===instanceId).length!==1)return null;
 return Object.freeze({laneId,pluginIndex,instanceId});
}
