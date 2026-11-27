/** Project an acknowledged clips:batch receipt onto the saved project, so the
 * Playlist repaints without a follow-up canonical read.
 *
 * Contract (docs/studio-api-openapi.json, applyClipBatch): the 200 body carries
 * applied, integer applied_ops, timelineRevision, and `inserted` cards
 * {clipId, laneId, sourceId, startMs, durationSec, audioOffsetSec,
 * engine_attached, op} for every insert/restore. Lane changes are not part of a
 * batch. A projection is produced only where the receipt is sufficient; any
 * doubt returns {projected:null, reason} and the caller reads canonical state.
 */
const clone=value=>structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64;
const near=(a,b,tolerance=1e-9)=>finite(a)&&finite(b)&&Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(a),Math.abs(b));
const TIMING={start_ms:'startMs',duration_sec:'durationSec',audio_offset_sec:'audioOffsetSec'};
// Saved clip row fields an insert copies from its same-audio source. Every other
// field (effects, automation, waveform, …) is unknown for the new row, so a
// source carrying one is not projected; the caller reads canonical state.
const COPIED=new Set(['name','volume','muted','clipMuted','isBacking']);
// Live (2026-11-10, project 859daf761ad34962): an inserted copy of an imported
// clip reads back isImported:false. A restore keeps its retained row as saved.
const INSERT_OVERRIDES={isImported:false};
// The server stores whole-millisecond starts and 6-decimal seconds (an insert of
// a 9.072666666666667 s window read back 9.072667; start 30000.4 → 30000).
const STORED_SECONDS=1e-6,round6=value=>Math.round(value*1e6)/1e6;
const REPLACED=new Set(['id','laneId','startMs','durationSec','audioOffsetSec','isImported']);
// Derived per-row metadata the receipt cannot state; omitted until the next read.
const DROPPED=new Set(['editUrl','updatedAt']);
const timelineRevision=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\r\n]/.test(value)?value:null;

/** Validated `inserted` cards keyed by clip id, or a reason string. */
export function insertedClipCards(payload){
 if(payload?.inserted===undefined)return new Map();
 if(!Array.isArray(payload.inserted))return 'inserted is not an array';
 const cards=new Map();
 for(const card of payload.inserted){
  if(!record(card)||!id(card.clipId)||!Number.isSafeInteger(card.startMs)||card.startMs<0||!finite(card.durationSec)||card.durationSec<=0||!finite(card.audioOffsetSec)||card.audioOffsetSec<0||typeof card.engine_attached!=='boolean')return 'an inserted card is incomplete';
  if(card.laneId!==undefined&&card.laneId!==null&&!id(card.laneId)||card.sourceId!==undefined&&card.sourceId!==null&&!id(card.sourceId)||card.op!==undefined&&!['insert','restore'].includes(card.op))return 'an inserted card is malformed';
  if(cards.has(card.clipId))return 'duplicate inserted cards';
  cards.set(card.clipId,clone(card));
 }
 return cards;
}

function rowTiming(row){return{start_ms:row.startMs,duration_sec:row.durationSec,audio_offset_sec:row.audioOffsetSec};}
// The server compares guards at its storage precision (a plan guards a
// 9.072666666666667 s row as 9.072667), so the projection does too.
function sameWindow(row,expected){const timing=rowTiming(row);return finite(timing.start_ms)&&finite(expected.start_ms)&&Math.abs(timing.start_ms-expected.start_ms)<.500001&&['duration_sec','audio_offset_sec'].every(key=>finite(timing[key])&&finite(expected[key])&&Math.abs(timing[key]-expected[key])<=STORED_SECONDS*1.000001);}

/**
 * @param rawProject complete saved project (getProject shape, clips[] rows)
 * @param ops the exact ops this batch sent
 * @param payload the acknowledged 200 body
 * @param retained Map clipId → saved row removed by an earlier projected batch
 * @returns {projected:{rawProject,removed,inserted}|null, reason}
 */
export function projectClipBatchReceipt(rawProject,ops,payload,{retained=new Map()}={}){
 const no=reason=>({projected:null,reason});
 if(!record(rawProject)||!Array.isArray(rawProject.clips)||rawProject.truncated?.clips===true)return no('no complete saved clip list');
 if(!Array.isArray(ops)||!ops.length)return no('no ops');
 if(!record(payload)||payload.applied!==true)return no('not applied');
 if(payload.replay===true)return no('replay');
 if(payload.applied_ops!==ops.length)return no('applied_ops differs from the sent ops');
 if(payload.projectId!==undefined&&payload.projectId!==rawProject.id)return no('another project');
 const revision=timelineRevision(payload.timelineRevision);if(!revision)return no('no timeline revision');
 const cards=insertedClipCards(payload);if(typeof cards==='string')return no(cards);
 const rows=rawProject.clips.map(clone),index=new Map();
 for(const row of rows){if(!record(row)||!id(row.id)||index.has(row.id))return no('ambiguous saved clips');index.set(row.id,row);}
 const removed=[],inserted=[],touched=new Set(),used=new Set();
 for(const op of ops){
  if(!record(op)||!id(op.id)||touched.has(op.id))return no('ambiguous op');touched.add(op.id);
  if(op.op==='update'||op.op==='remove'){
   const row=index.get(op.id);if(!row)return no('an updated clip is not in the saved list');
   if(!['startMs','durationSec','audioOffsetSec'].every(key=>finite(row[key])))return no('a saved clip has incomplete timing');
   if(op.expected!==undefined&&!sameWindow(row,op.expected))return no('a saved clip differs from the guard');
   if(op.op==='remove'){index.delete(op.id);removed.push(clone(row));continue;}
   if(op.start_ms!==undefined&&!Number.isSafeInteger(op.start_ms))return no('a fractional start may be rounded by the server');
   for(const [field,key] of Object.entries(TIMING))if(op[field]!==undefined){if(!finite(op[field]))return no('invalid op timing');if(field!=='start_ms'&&Math.abs(round6(op[field])-op[field])>1e-12)return no('a sub-microsecond value may be rounded by the server');row[key]=op[field];}
   continue;
  }
  if(op.op!=='insert'&&op.op!=='restore')return no('unsupported op');
  const card=cards.get(op.id);if(!card)return no('an inserted clip has no card');used.add(op.id);
  if(card.op!==undefined&&card.op!==op.op)return no('the card reports another op');
  if(index.has(op.id))return no('the inserted clip is already listed');
  for(const field of Object.keys(TIMING))if(op[field]===undefined)return no('an insert has incomplete timing');
  // The card is the stored window; it may only differ from the sent op by the server's storage rounding.
  if(Math.abs(card.startMs-op.start_ms)>=1||Math.abs(card.durationSec-op.duration_sec)>STORED_SECONDS||Math.abs(card.audioOffsetSec-op.audio_offset_sec)>STORED_SECONDS)return no('the card differs from the sent timing');
  const sourceId=op.source_id??null;if(card.sourceId!=null&&sourceId!==null&&card.sourceId!==sourceId)return no('the card reports another source');
  const source=op.op==='restore'&&retained.get(op.id)||(sourceId?index.get(sourceId)??rows.find(row=>row.id===sourceId):null);
  if(!record(source))return no('no saved source row for the inserted clip');
  for(const key of Object.keys(source))if(!COPIED.has(key)&&!REPLACED.has(key)&&!DROPPED.has(key))return no('the source carries '+key);
  const laneId=card.laneId??source.laneId;if(!id(laneId)||laneId!==source.laneId)return no('lane changes are not projected');
  const fromRetained=op.op==='restore'&&retained.has(op.id),row={};for(const key of COPIED)if(Object.hasOwn(source,key))row[key]=clone(source[key]);
  if(fromRetained){if(Object.hasOwn(source,'isImported'))row.isImported=source.isImported;}else Object.assign(row,INSERT_OVERRIDES);
  Object.assign(row,{id:card.clipId,laneId,startMs:card.startMs,durationSec:card.durationSec,audioOffsetSec:card.audioOffsetSec});
  index.set(row.id,row);inserted.push({row:clone(row),engineAttached:card.engine_attached});
 }
 if(used.size!==cards.size)return no('cards for clips this batch did not send');
 const nextRows=[...index.values()];
 const counts=record(rawProject.counts)&&finite(rawProject.counts.clips)?{counts:{...rawProject.counts,clips:nextRows.length}}:{};
 return{projected:{rawProject:{...clone(rawProject),...counts,clips:nextRows,timelineRevision:revision},removed,inserted,timelineRevision:revision},reason:null};
}
