/** Does a plug-in slot have an editor window to mirror? (#6, release 2026-11-18)
 *
 * listLanePlugins / listBusPlugins rows and catalog entries carry `hasEditor`; built-in (native) effects report
 * `hasEditor:false` and their editor routes answer a final 409 editor_not_available. A row from an older read
 * without the field falls back to the documented rule: `format: "native"` (or a `native-*` type) has no editor.
 * Returns true, false, or null when nothing says (the editor request then decides).
 */
export function pluginHasEditor(plugin){
 if(!plugin||typeof plugin!=='object')return null;
 for(const key of ['hasEditor','has_editor'])if(typeof plugin[key]==='boolean')return plugin[key];
 const format=String(plugin.format??'').toLowerCase(),type=String(plugin.type_id??plugin.typeId??plugin.type??plugin.plugin_id??plugin.pluginId??'').toLowerCase();
 if(format==='native'||type.startsWith('native-')||type.startsWith('native:'))return false;
 if(format==='vst3'||format==='au'||format==='clap')return true;
 return null;
}
/** A final "this slot has no editor" answer from an editor route (never retried, never "reopen the project"). */
export function editorNotAvailable(error){return Number(error?.status)===409&&(error?.code==='editor_not_available'||error?.data?.error?.code==='editor_not_available');}
export const NO_EDITOR_MESSAGE='This built-in effect has no editor window; its controls are shown instead.';
