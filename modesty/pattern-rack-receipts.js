import {normalizeCloudProject,serializeCloudPlacement} from './cloud-session.js';

/**
 * Instant pattern placements: project acknowledged (or optimistic, identity-
 * known) placement rows straight into the canonical CloudSession state, the
 * same way CloudSession.applyPatternSplitReceipt displays an atomic split
 * receipt, instead of waiting for the slow full project/native refresh.
 * `placementReceiptVersion` is bumped so a refresh that started earlier keeps
 * these rows; a later background refresh reconciles with the server.
 */
const INT_FIELDS=['startMs','durationMs','loopDurationMs','repeatCount','offsetMs','loopPhaseMs','windowMs','displayOrder'];
const body=value=>value?.response??value;

/** Merge a receipt body over the request/prior row into a complete placement, or null. */
export function completePlacement(server,fallback={},projectId){
  const src=server&&typeof server==='object'?server:{},row={...fallback,...src};
  row.id=String(row.id||'');if(!row.id||!row.patternId||!row.laneId)return null;
  row.startMs=Math.max(0,Number(row.startMs)||0);row.durationMs=Number(row.durationMs);row.loopDurationMs=Number(row.loopDurationMs??row.durationMs);
  row.repeatCount=Number(row.repeatCount??1);row.offsetMs=Number(row.offsetMs??0);row.loopPhaseMs=Number(row.loopPhaseMs??0);
  if(!Object.hasOwn(row,'windowMs')||row.windowMs===undefined)row.windowMs=null;
  if(!row.sourceBusOverrides||typeof row.sourceBusOverrides!=='object'||Array.isArray(row.sourceBusOverrides))row.sourceBusOverrides={};
  if(projectId&&row.projectId==null)row.projectId=projectId;
  if(!(row.durationMs>0&&row.loopDurationMs>0&&row.repeatCount>=1&&row.offsetMs>=0&&Number.isFinite(row.loopPhaseMs)))return null;
  return row;
}
/** The placement row a typed receipt carries (create/update/restore). */
export function receiptPlacement(result){const r=body(result)||{};return r.placement&&typeof r.placement==='object'?r.placement:r.restored&&typeof r.restored==='object'?r.restored:null;}

export function canonicalRows(session){const state=session?.rawState,container=state?.patternPlacements;const rows=container?.placements??state?.placements;return Array.isArray(rows)?rows:null;}
export function canonicalRow(session,id){return canonicalRows(session)?.find(row=>String(row.id)===String(id))||null;}

/** Upsert/remove placement rows in the session's canonical state; returns false when it cannot. */
export function projectPlacements(engine,{upsert=[],remove=[]}={}){
  const s=engine?.session;if(!s||s.closed||!s.rawState||!s.rawProject||!s.project||!s.projectId)return false;
  const current=canonicalRows(s);if(!current)return false;
  const projectId=s.projectId,trackId=s.trackId,drop=new Set(remove.map(String)),up=new Map(upsert.filter(Boolean).map(row=>[String(row.id),structuredClone(row)]));
  const rows=[];for(const row of current){const id=String(row.id);if(drop.has(id))continue;if(up.has(id)){rows.push(up.get(id));up.delete(id);}else rows.push(row);}rows.push(...up.values());
  const container=s.rawState.patternPlacements,placements={...(container&&!Array.isArray(container)?container:{}),placements:rows};
  for(const key of ['count','total','totalCount','total_count'])if(placements[key]===current.length)placements[key]=rows.length;
  const nextState={...s.rawState,patternPlacements:placements};if(Array.isArray(s.rawState.placements))nextState.placements=rows;
  const lanes=Array.isArray(s.rawProject.lanes)?[...s.rawProject.lanes]:null;
  if(lanes)for(const row of rows)if(!lanes.some(lane=>lane.id===row.laneId))lanes.push({id:row.laneId,kind:'instrument',name:row.laneName||row.name||'Pattern'});
  const nextRawProject={...s.rawProject,placements:rows,...(lanes?{lanes}:{}),...(Number.isSafeInteger(s.rawProject.counts?.placements)?{counts:{...s.rawProject.counts,placements:rows.length}}:{})};
  let next;try{next=normalizeCloudProject(nextRawProject,nextState,{projectId,trackId});}catch{return false;}
  if(s.project.selectedPattern&&next.patterns.some(p=>p.id===s.project.selectedPattern))next.selectedPattern=s.project.selectedPattern;
  s.rawState=nextState;s.rawProject=nextRawProject;s.project=next;s.placementReceiptVersion=(s.placementReceiptVersion||0)+1;
  (s.receiptPlacementProjects??=new Set()).add(projectId);
  s.dispatchEvent(new CustomEvent('state',{detail:{project:next,raw:nextState,source:'pattern-placement-receipt'}}));
  return true;
}

// --------------------------------------------- generic pattern-clip gestures
const NON_CLIP_KEYS=['title','bpm','master','loop','trackNames','mutedTracks','channels','patterns','audioClips'];
const strip=project=>JSON.stringify(NON_CLIP_KEYS.map(key=>project?.[key]??null));
const clipKey=clip=>JSON.stringify([clip.start,clip.length,clip.track,clip.laneId??null,clip.name??null,clip.cloudRaw??null]);
/** Diff only pattern placements; null when anything else changed (generic path keeps it). */
export function placementDiff(before,after){
  if(!before||!after||strip(before)!==strip(after))return null;
  const old=new Map((before.clips||[]).map(c=>[c.id,c])),next=new Map((after.clips||[]).map(c=>[c.id,c]));
  const removed=[...old.values()].filter(c=>!next.has(c.id)),added=[...next.values()].filter(c=>!old.has(c.id)),changed=[...next.values()].filter(c=>old.has(c.id)&&clipKey(c)!==clipKey(old.get(c.id)));
  if(!removed.length&&!added.length&&!changed.length)return null;
  if(removed.some(c=>!c.cloudId)||changed.some(c=>!c.cloudId))return null;
  const cloudPattern=id=>(after.patterns||[]).find(p=>p.id===id&&p.cloudId&&!String(p.id).startsWith('local-'));
  if(added.some(c=>!c.patternId||!cloudPattern(c.patternId)))return null;
  const rows=[...added,...changed].map(c=>({clip:c,body:integerBody(serializeCloudPlacement(c,after))}));
  if(rows.some(r=>!r.body.laneId&&(r.clip.cloudId||old.get(r.clip.id))))return null;
  return {removed,added:rows.filter(r=>!old.has(r.clip.id)),changed:rows.filter(r=>old.has(r.clip.id))};
}
export function integerBody(placement){const out={...placement};for(const key of INT_FIELDS)if(out[key]!=null&&Number.isFinite(Number(out[key])))out[key]=Math.round(Number(out[key]));if(!out.laneId)delete out.laneId;return out;}

/**
 * Route pure pattern-placement gestures (move/trim/delete/duplicate) through
 * the controller's typed writes + instant receipts, ahead of the generic
 * CloudSession.applyProject path (which ends in a full refresh and keeps the
 * engine busy until it finishes). Everything else is delegated untouched.
 */
export function interceptPlacementCommits(engine,controller){
  const inner=engine.geometryHistory;if(!inner||inner.__patternPlacementProxy)return inner;
  const proxy=new Proxy(inner,{get(target,key){
    if(key==='__patternPlacementProxy')return true;
    if(key==='handles')return (before,after)=>target.handles(before,after)||!!placementDiff(before,after);
    if(key==='commit')return (before,after)=>{if(!target.handles(before,after)){const diff=placementDiff(before,after);if(diff)return controller.commitPlacements(diff,{before,after});}return target.commit(before,after);};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  },set(target,key,value){return Reflect.set(target,key,value);}});
  engine.geometryHistory=proxy;return proxy;
}
