/** Which plug-in window a slot gets (GitHub issues #6, #19, #3).
 *  - #6: native effects report `hasEditor:false` (listLanePlugins, listBusPlugins, catalog); their window opens on the
 *    parameter view at once, and an editor request on them answers a final 409 editor_not_available.
 *  - #19: editor routes use the same plugin_index as listLanePlugins; on an instrument lane index 0 is the instrument.
 *  - #3: master slots have editor routes (openBusPluginEditor …) with the same index as listBusPlugins.
 *  Pure, no I/O. */
const text=value=>typeof value==='string'&&value.trim()?value:null;
/** {gui:boolean, reason} for a slot row. `hasEditor` undefined (older read) leaves the GUI to the engine's answer. */
export function editorAvailability(plugin,catalogEntry=null){
 // A slot row read before the engine reported it can lack hasEditor: the catalog entry of the same type answers then.
 const sameType=catalogEntry&&String(catalogEntry.id??'')===String(plugin?.type_id??plugin?.typeId??plugin?.plugin_id??'');
 const flag=plugin?.hasEditor??plugin?.has_editor??(sameType?catalogEntry.hasEditor:undefined);
 if(flag===false)return{gui:false,reason:'This built-in effect has no editor window in Freestyle: its parameters are shown instead.'};
 return{gui:true,reason:null};
}
/** A final "no editor" answer from an editor route (never retried, never "reopen the project"). */
export function editorNotAvailable(error){return error?.status===409&&String(error?.code||error?.data?.error?.code||'')==='editor_not_available';}
/** The live master slot for `plugin` in a listBusPlugins(master) reply, or a reason it cannot open. */
export function masterEditorBinding(reply,plugin){
 const rows=Array.isArray(reply?.plugins)?reply.plugins:null,instance=text(plugin?.instance_id??plugin?.instanceId??plugin?.id);
 if(!rows)return{error:'Read the Master effect chain again before opening its editor.'};
 if(reply.masterEffectsSupported===false)return{error:'This project’s engine does not run Master effects yet.'};
 const row=rows.find(item=>(item?.index??item?.plugin_index)===plugin?.index);
 if(!row)return{error:'This Master effect is no longer in the chain.'};
 const live=text(row.instance_id??row.instanceId);
 if(instance&&live&&live!==instance)return{error:'The Master slot now holds another effect. Reopen it from the Mixer.'};
 const available=editorAvailability(row);if(!available.gui)return{error:available.reason,noEditor:true};
 return{binding:{busId:'master',pluginIndex:plugin.index,instanceId:live||instance,pluginType:text(row.type_id??row.typeId)}};
}
