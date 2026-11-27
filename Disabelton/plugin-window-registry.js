/**
 * Open plugin windows keyed by their exact lane plugin instance. A plugin
 * window is only meaningful while that instance is still in its lane's chain:
 * after a chain read shows it gone (removed, replaced), the window is closed so
 * it stops GUI polling and can no longer sit over other editors swallowing
 * clicks with a misleading engine error.
 */
const windows=new Set();
const identity=plugin=>{const value=plugin?.instance_id??plugin?.instanceId??plugin?.id;return typeof value==='string'&&value?value:null;};

export function registerPluginWindow({dialog,projectId,laneId,instanceId,onStale=null,refresh=null}={}){
 if(!dialog||typeof projectId!=='string'||!projectId||typeof laneId!=='string'||!laneId||typeof instanceId!=='string'||!instanceId)return()=>{};
 const entry={dialog,projectId,laneId,instanceId,onStale,refresh};windows.add(entry);
 const unregister=()=>windows.delete(entry);dialog.addEventListener?.('close',unregister,{once:true});return unregister;
}

/** `plugins` must be the lane's complete, freshly read chain. Returns the number of windows closed. */
export function reconcilePluginWindows({projectId,laneId,plugins,reason='removed'}={}){
 if(!Array.isArray(plugins))return 0;
 const present=new Set(plugins.map(identity).filter(Boolean));let closed=0;
 for(const entry of [...windows]){
  if(entry.projectId!==projectId||entry.laneId!==laneId||present.has(entry.instanceId))continue;
  windows.delete(entry);closed++;
  try{entry.onStale?.({reason,instanceId:entry.instanceId,laneId});}catch{}
  try{if(entry.dialog.open!==false)entry.dialog.close?.();}catch{}
 }
 return closed;
}

/** A confirmed removal of one exact instance (e.g. its delete receipt): close only its windows. */
export function closePluginWindowsFor({projectId,laneId,instanceId,reason='removed'}={}){
 if(typeof instanceId!=='string'||!instanceId)return 0;let closed=0;
 for(const entry of [...windows]){
  if(entry.projectId!==projectId||entry.laneId!==laneId||entry.instanceId!==instanceId)continue;
  windows.delete(entry);closed++;
  try{entry.onStale?.({reason,instanceId,laneId});}catch{}
  try{if(entry.dialog.open!==false)entry.dialog.close?.();}catch{}
 }
 return closed;
}

/** A parameter of this exact instance changed outside its window (e.g. an automation edit):
 * every open window of it redraws (a fresh GUI frame). Returns how many were asked. */
export function refreshPluginWindows({projectId,instanceId,laneId=null}={}){
 if(typeof instanceId!=='string'||!instanceId)return 0;let refreshed=0;
 for(const entry of windows){if(entry.instanceId!==instanceId||projectId&&entry.projectId!==projectId||laneId&&entry.laneId!==laneId||typeof entry.refresh!=='function'||entry.dialog.open===false)continue;try{entry.refresh();refreshed++;}catch{}}
 return refreshed;
}

export function openPluginWindowCount(){return windows.size;}
