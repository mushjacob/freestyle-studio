/** Rebase local edits made while an earlier batch was in flight.
 *
 * `base` is the local model that batch sent, `confirmed` the saved project it
 * produced and `local` the newer local model derived from `base`. The result is
 * `confirmed` plus only the local changes made since `base`, so the next batch
 * diff contains just those newer edits. Server identities assigned by the batch
 * (`ids.patterns`, `ids.placements`: local id -> saved id) are honoured.
 *
 * Rows are merged by id. An unchanged local row adopts its confirmed row. A
 * locally changed pattern keeps its complete local score (pattern writes replace
 * the whole score); other rows keep only their locally changed fields. A local
 * change to a row Freestyle no longer has (or renamed without a known mapping)
 * cannot be merged safely and throws `edit_rebase_conflict`: it is never
 * replayed as a new creation.
 */
const clone=value=>value==null?value:structuredClone(value);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>Array.isArray(value)?value.map(stable):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const KEYED=['patterns','clips','channels','audioClips'];
export const conflict=(message='A queued edit targets an item Freestyle replaced while saving. It was not sent; repeat it on the current project.')=>Object.assign(new Error(message),{code:'edit_rebase_conflict'});

function fieldMerge(local,base,confirmed){
 const out=clone(confirmed);
 for(const key of new Set([...Object.keys(local),...Object.keys(base)])){
  if(key==='id')continue;
  if(!same(local[key],base[key])){if(Object.hasOwn(local,key))out[key]=clone(local[key]);else delete out[key];}
 }
 return out;
}

function mergeRows(kind,local=[],base=[],confirmed=[],map={}){
 const baseById=new Map(base.map(row=>[row.id,row])),confirmedById=new Map(confirmed.map(row=>[row.id,row])),used=new Set(),out=[];
 for(const row of local){
  const before=baseById.get(row.id);
  if(!before){out.push(clone(row));continue;}
  const savedId=confirmedById.has(row.id)?row.id:map[row.id],saved=savedId==null?undefined:confirmedById.get(savedId);
  const unchanged=same(row,before);
  if(!saved){if(unchanged)continue;throw conflict();}
  used.add(saved.id);
  if(unchanged){out.push(clone(saved));continue;}
  if(kind==='patterns'){if(saved.id!==row.id)throw conflict();out.push(clone(row));continue;}
  if(saved.id!==row.id&&kind!=='clips')throw conflict();
  out.push({...fieldMerge(row,before,saved),id:saved.id});
 }
 const mappedFromBase=new Set(Object.entries(map).filter(([from])=>baseById.has(from)).map(([,to])=>to));
 for(const row of confirmed){
  if(used.has(row.id))continue;
  // Present when the batch was sent, then removed locally: stay removed.
  if(baseById.has(row.id)||mappedFromBase.has(row.id))continue;
  out.push(clone(row));
 }
 return out;
}

export function rebaseLocalEdits(local,base,confirmed,ids={}){
 if(!object(local)||!object(base)||!object(confirmed))throw conflict('Reload the project before editing again.');
 const patternMap=ids.patterns||{},clipMap=ids.placements||{},out={};
 for(const key of new Set([...Object.keys(confirmed),...Object.keys(local),...Object.keys(base)])){
  if(KEYED.includes(key)&&(Array.isArray(local[key])||Array.isArray(confirmed[key]))){out[key]=mergeRows(key,local[key]||[],base[key]||[],confirmed[key]||[],key==='patterns'?patternMap:key==='clips'?clipMap:{});continue;}
  if(key==='cloud'){if(Object.hasOwn(confirmed,key))out[key]=clone(confirmed[key]);continue;}
  const value=same(local[key],base[key])?confirmed[key]:local[key];
  if(value!==undefined||Object.hasOwn(same(local[key],base[key])?confirmed:local,key))out[key]=clone(value);
 }
 const remap=id=>Object.hasOwn(patternMap,id)?patternMap[id]:id;
 for(const clip of out.clips||[])if(clip.patternId!=null)clip.patternId=remap(clip.patternId);
 if(out.selectedPattern!=null)out.selectedPattern=remap(out.selectedPattern);
 return out;
}

/** QA round 19: may an edit refused with 412 (the timeline moved) be re-sent
 * once on a fresh read? Only when every entity the edit touches (a keyed row
 * it changes or removes, or a top-level field it changes) is still exactly as
 * the edit started from it. Server edit stamps are ignored; anything else that
 * differs means someone changed the target: no retry, a clear refusal.
 * Returns {ok:true} or {ok:false, ids, label}. */
const VOLATILE=new Set(['updatedAt','updated_at','timelineRevision']);
const stripVolatile=value=>Array.isArray(value)?value.map(stripVolatile):object(value)?Object.fromEntries(Object.entries(value).filter(([key])=>!VOLATILE.has(key)).map(([key,item])=>[key,stripVolatile(item)])):value;
export function editTargetsUnchanged(base,next,fresh){
 if(!object(base)||!object(next)||!object(fresh))return{ok:false,ids:[],label:'The project'};
 const changedIds=[];let label=null;
 for(const key of KEYED){
  const before=new Map((Array.isArray(base[key])?base[key]:[]).map(row=>[row?.id,row])),after=new Map((Array.isArray(next[key])?next[key]:[]).map(row=>[row?.id,row])),saved=new Map((Array.isArray(fresh[key])?fresh[key]:[]).map(row=>[row?.id,row]));
  for(const [id,row]of before){
   if(after.has(id)&&same(stripVolatile(after.get(id)),stripVolatile(row)))continue;
   // A row this edit changes or removes must still be exactly the one it started from.
   if(!saved.has(id)||!same(stripVolatile(saved.get(id)),stripVolatile(row))){changedIds.push(id);label??=row?.name?`“${row.name}”`:'An edited clip';}
  }
 }
 for(const key of Object.keys(next)){if(KEYED.includes(key)||['cloud','selectedPattern','loop'].includes(key))continue;if(!same(next[key],base[key])&&!same(fresh[key],base[key])){changedIds.push(key);label??='The project';}}
 return changedIds.length?{ok:false,ids:changedIds,label}:{ok:true};
}
