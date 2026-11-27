/** Playlist row binding hints for lanes the client just created by dropping
 * onto an empty (lane-less) Playlist row. FL places a drop on the hovered row;
 * the Studio API only returns a new lane id, so the row layout (cloud-session
 * timelineLaneIds) should consume these hints when it assigns rows:
 *   import {laneRowHints} from './playlist-row-hints.js';
 *   for(const [laneId,row] of laneRowHints(projectId)) ...  // place laneId at row if free
 * Hints are presentation only: never written to the engine. They persist per
 * project in localStorage (best effort) so a reload keeps the row. */
const KEY='disabelton:playlistRowHints.v1',MAX=256,listeners=new Set();
let memory=null;
const valid=value=>typeof value==='string'&&value.length>0&&value.length<=128;
function load(){if(memory)return memory;memory={};try{const raw=JSON.parse(globalThis.localStorage?.getItem(KEY)||'{}');if(raw&&typeof raw==='object')for(const [project,rows]of Object.entries(raw))if(valid(project)&&rows&&typeof rows==='object')memory[project]=Object.fromEntries(Object.entries(rows).filter(([lane,row])=>valid(lane)&&Number.isSafeInteger(row)&&row>=0&&row<4096));}catch{}return memory;}
function save(){try{globalThis.localStorage?.setItem(KEY,JSON.stringify(memory));}catch{}}
/** Bind a newly created lane to the Playlist row it was dropped on.
 * `insert`: the row is occupied by another lane (e.g. an empty instrument
 * track, which cannot host audio), so the new lane is inserted ABOVE it (FL
 * Insert track); other hinted lanes at or below that row shift down one. */
export function setLaneRowHint(projectId,laneId,row,{insert=false}={}){
 if(!valid(projectId)||!valid(laneId)||!Number.isSafeInteger(row)||row<0||row>=4096)return false;
 const all=load(),rows=all[projectId]||(all[projectId]={});
 if(insert){for(const [lane,taken]of Object.entries(rows))if(lane!==laneId&&taken>=row&&taken<4095)rows[lane]=taken+1;}
 else for(const [lane,taken]of Object.entries(rows))if(taken===row&&lane!==laneId)delete rows[lane];
 rows[laneId]=row;const keys=Object.keys(rows);if(keys.length>MAX)for(const lane of keys.slice(0,keys.length-MAX))delete rows[lane];
 save();for(const listener of listeners)try{listener({projectId,laneId,row,insert:!!insert});}catch{}return true;
}
/** Replace every hint of one project (Undo of a canonical row reorder). */
export function replaceLaneRowHints(projectId,hints){
 if(!valid(projectId))return false;const all=load(),next={};for(const [lane,row]of hints instanceof Map?hints:Object.entries(hints||{}))if(valid(lane)&&Number.isSafeInteger(row)&&row>=0&&row<4096)next[lane]=row;
 if(Object.keys(next).length)all[projectId]=next;else delete all[projectId];save();for(const listener of listeners)try{listener({projectId,laneId:null,row:null});}catch{}return true;
}
export function clearLaneRowHint(projectId,laneId){const rows=load()[projectId];if(!rows||!Object.hasOwn(rows,laneId))return false;delete rows[laneId];save();for(const listener of listeners)try{listener({projectId,laneId,row:null});}catch{}return true;}
/** Map laneId -> preferred row for one project. */
export function laneRowHints(projectId){return new Map(Object.entries(load()[projectId]||{}));}
export function onLaneRowHint(listener){listeners.add(listener);return()=>listeners.delete(listener);}
/** Apply hints to a row array (index -> laneId). A hinted lane moves to its
 * row; when that row is free it simply fills it, and when another lane holds
 * it the hinted lane is inserted there (FL Insert track): only the lanes
 * between that row and the next free row shift down one, so rows further down
 * keep their place. Lanes never disappear or duplicate. Pure helper used by
 * the cloud-session row layout. */
export function applyLaneRowHints(rows,hints){
 const next=[...rows];if(!(hints instanceof Map)||!hints.size)return next;
 for(const [laneId,row]of [...hints].sort((a,b)=>a[1]-b[1])){
  const at=next.indexOf(laneId);if(at<0||at===row)continue;next[at]=undefined;
  if(!next[row]){next[row]=laneId;continue;}
  next.splice(row,0,laneId);let hole=-1;for(let index=row+1;index<next.length;index++)if(!next[index]){hole=index;break;}if(hole>=0)next.splice(hole,1);
 }
 while(next.length&&!next[next.length-1])next.pop();
 return next;
}
/** Test-only reset. */
export function resetLaneRowHintsForTest(){memory={};listeners.clear();}
