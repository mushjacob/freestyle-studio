/**
 * Shared live lane-plugin inventory (Studio API listLanePlugins) for one project load.
 *
 * The Freestyle Studio warms the project's engine session right after opening it
 * (one deduplicated, nonblocking load per project), so the first plugin window
 * has live data. The OAuth Studio API has no session
 * load call; its engine inventory read is listLanePlugins, which measured
 * 30–45 s upstream on this project (0.5 s when warm). This cache warms that
 * read in the background after load and lets the plugin window and mixer tools
 * reuse one in-flight or fresh result instead of starting their own.
 *
 * Scope: project, context track, engine load version, lane and the saved lane
 * pluginChain fingerprint. A different scope never reuses an entry. Display
 * reads may use a fresh entry; edits keep re-reading the live chain.
 */
const stable=value=>JSON.stringify(value,(key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(name=>[name,item[name]])):item);
export function pluginInventoryKey({projectId,trackId,loadVersion,laneId,chain}={}){
  if(!projectId||!laneId)return null;
  return stable([String(projectId),String(trackId??''),Number(loadVersion)||0,String(laneId),Array.isArray(chain)?chain:null]);
}
export class PluginInventoryCache {
  constructor({ttlMs=120000,now=()=>Date.now()}={}){this.ttlMs=ttlMs;this.now=now;this.entries=new Map();this.inflight=new Map();this.generation=0;this.stats={reads:0,shared:0,hits:0};}
  /** A fresh settled result for exactly this scope, or null. */
  peek(scope){const key=pluginInventoryKey(scope),entry=key&&this.entries.get(key);if(!entry)return null;if(this.now()-entry.atMs>this.ttlMs){this.entries.delete(key);return null;}return entry;}
  pending(scope){const key=pluginInventoryKey(scope);return key?this.inflight.get(key)||null:null;}
  /**
   * Read through the cache. `fresh` skips a settled entry (edits/refresh) but
   * still joins an identical in-flight read started after the last invalidation.
   */
  read(scope,loader,{fresh=false}={}){
    const key=pluginInventoryKey(scope);if(!key)return Promise.resolve().then(loader);
    if(!fresh){const entry=this.peek(scope);if(entry){this.stats.hits++;return Promise.resolve(structuredClone(entry.result));}}
    const running=this.inflight.get(key);if(running){this.stats.shared++;return running.then(result=>structuredClone(result));}
    const generation=this.generation;this.stats.reads++;
    const promise=Promise.resolve().then(loader).then(result=>{if(generation===this.generation&&this.inflight.get(key)===promise)this.entries.set(key,{result:structuredClone(result),atMs:this.now()});return result;}).finally(()=>{if(this.inflight.get(key)===promise)this.inflight.delete(key);});
    this.inflight.set(key,promise);return promise.then(result=>structuredClone(result));
  }
  /** Forget one lane (after a plugin mutation) or everything (project/load change). */
  invalidate({projectId,laneId}={}){
    // Any invalidation stops every in-flight read from storing its (possibly pre-edit) result.
    this.generation++;
    if(!projectId){this.entries.clear();this.inflight.clear();return;}
    for(const map of [this.entries,this.inflight])for(const key of [...map.keys()]){const [project,,,lane]=JSON.parse(key);if(project===String(projectId)&&(laneId==null||lane===String(laneId)))map.delete(key);}
  }
  /**
   * Nonblocking warm-up: one read at a time (the bridge has four shared GET
   * slots that the project poll also uses), stopping when `isCurrent` fails.
   */
  prewarm(scopes,loader,{isCurrent=()=>true,onResult=()=>{}}={}){
    const generation=this.generation;let chain=Promise.resolve();
    for(const scope of scopes)chain=chain.then(()=>{if(generation!==this.generation||!isCurrent(scope)||this.peek(scope)||this.pending(scope))return;const started=this.now();return this.read(scope,()=>loader(scope)).then(()=>onResult({scope,ok:true,ms:this.now()-started}),error=>onResult({scope,ok:false,ms:this.now()-started,error}));});
    return chain;
  }
}
/** Lanes worth warming: saved chains holding a non-native (instrument/VST) plugin, i.e. the windows users open from the Channel Rack. */
export function prewarmLaneScopes(rawProject,{projectId,trackId,loadVersion,limit=4}={}){
  const lanes=Array.isArray(rawProject?.lanes)?rawProject.lanes:[];
  return lanes.filter(lane=>typeof lane?.id==='string'&&lane.id&&Array.isArray(lane.pluginChain)&&lane.pluginChain.some(plugin=>typeof plugin?.type==='string'&&!/^native-/.test(plugin.type))).slice(0,limit).map(lane=>({projectId,trackId,loadVersion,laneId:lane.id,chain:lane.pluginChain}));
}
