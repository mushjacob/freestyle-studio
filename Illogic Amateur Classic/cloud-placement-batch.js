/** POST /projects/{id}/pattern-placements:batch (applyPatternPlacementBatch, 338).
 *
 * One Playlist gesture over several pattern clips (multi-select move, Delete,
 * Paste, ⌘B Duplicate, a Paint stroke) is ONE atomic request: every op runs in
 * one DB transaction, a refused op writes nothing, If-Match is the timeline
 * revision and the response's `undo.inverse_ops` (reverse order) POSTed back is
 * the exact Undo. That inverse's own receipt carries the Redo. This mirrors the
 * clips:batch receipts (cloud-clip-batch-receipt.js).
 *
 * The per-placement routes remain only as the fallback for a connection whose
 * contract does not have the operation (or a proxy that answers it as unknown
 * before anything is sent upstream). */
import {STUDIO_API_OPERATIONS} from './studio-api-client.js';

export const PLACEMENT_BATCH_LIMIT=256;
const OPS=new Set(['create','update','delete','restore']);
const INTEGER_FIELDS=['startMs','durationMs','loopDurationMs','offsetMs','repeatCount','loopPhaseMs'];
const STRING_FIELDS=['patternId','laneId','name','busId'];
const BOOLEAN_FIELDS=['muted','soloed'];
// displayOrder (Timeline row order, 0..1000000) is declared on batch create/update ops since the
// 2026-11-11 contract: sent so the FL Playlist row order persists (omitted = unchanged).
const PLACEMENT_FIELDS=new Set([...INTEGER_FIELDS,...STRING_FIELDS,...BOOLEAN_FIELDS,'windowMs','sourceBusOverrides','displayOrder']);
const clone=value=>value==null?value:structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64;
const fail=(message,fields={})=>Object.assign(new Error(message),{code:'placement_batch_invalid',...fields});
const revision=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\r\n]/.test(value)?value:null;

/** The generated contract has the batch route (POST, mutating, ops 1..256). */
export function placementBatchSupported(operations=STUDIO_API_OPERATIONS){
 const operation=operations?.applyPatternPlacementBatch,ops=operation?.requestBody?.content?.['application/json']?.schema?.properties?.ops;
 return operation?.method==='POST'&&operation.mutates===true&&/pattern-placements:batch$/.test(operation.path||'')&&ops?.type==='array'&&(ops.maxItems??PLACEMENT_BATCH_LIMIT)>=2;
}

/** A refusal that proves the route itself is missing (nothing was applied). A
 * 404 `not_found` is an id outside this project, i.e. a real answer. */
export function placementBatchUnavailable(error){
 if(!error||error.operationUncertain===true)return false;
 const status=Number(error.status),code=String(error.code||error.data?.error?.code||'');
 return status===405||status===501||['unknown_studio_operation','studio_api_feature_unavailable','route_not_found','unknown_operation'].includes(code)&&[400,404,501].includes(status);
}

/** Documented placement fields of one op. Millisecond fields are integers in
 * the schema, so a fractional beat position is rounded to the stored whole ms
 * (the server stores whole milliseconds anyway); `windowMs:null` is kept
 * explicitly (it clears the trim window; omission keeps the stored one). */
export function placementBatchFields(placement){
 if(!record(placement))throw fail('A placement batch op needs its placement fields.');
 const out={};
 for(const [key,value]of Object.entries(placement)){
  if(!PLACEMENT_FIELDS.has(key)||value===undefined)continue;
  if(INTEGER_FIELDS.includes(key)){if(value===null)continue;const number=Math.round(Number(value));if(!Number.isSafeInteger(number)||number<(['startMs','offsetMs','loopPhaseMs'].includes(key)?0:1))throw fail('Placement '+key+' is outside its integer millisecond contract.');out[key]=number;}
  else if(key==='displayOrder'){if(value===null)continue;const number=Math.round(Number(value));if(!Number.isSafeInteger(number)||number<0||number>1000000)throw fail('Placement displayOrder must be an integer row order from 0 to 1000000.');out.displayOrder=number;}
  else if(key==='windowMs'){if(value===null){out.windowMs=null;continue;}const number=Math.round(Number(value));if(!Number.isSafeInteger(number)||number<1)throw fail('Placement windowMs must be a positive integer or null.');out.windowMs=number;}
  else if(STRING_FIELDS.includes(key)){if(value===null)continue;if(typeof value!=='string'||key!=='name'&&!id(value)||value.length>255)throw fail('Placement '+key+' is not a documented identity.');out[key]=value;}
  else if(BOOLEAN_FIELDS.includes(key)){if(typeof value!=='boolean')throw fail('Placement '+key+' must be a boolean.');out[key]=value;}
  else if(key==='sourceBusOverrides'){if(!record(value))throw fail('sourceBusOverrides must be an object.');out[key]=clone(value);}
 }
 return out;
}

export const createPlacementOp=placement=>({op:'create',placement:placementBatchFields(placement)});
export const updatePlacementOp=(placementId,placement)=>({op:'update',placementId,placement:placementBatchFields(placement)});
export const deletePlacementOp=placementId=>({op:'delete',placementId});

/** Shape check before sending: 1..256 documented ops, each placement touched once. */
export function validatePlacementBatchOps(ops){
 if(!Array.isArray(ops)||ops.length<1||ops.length>PLACEMENT_BATCH_LIMIT)throw fail(`A placement batch carries 1 to ${PLACEMENT_BATCH_LIMIT} ops.`);
 const touched=new Set();
 for(const [index,op]of ops.entries()){
  if(!record(op)||!OPS.has(op.op)||Object.keys(op).some(key=>!['op','placement','placementId','before','restoreToken'].includes(key)))throw fail('Placement batch op '+index+' is not documented.',{opIndex:index});
  if(op.op==='create'){if(op.placementId!==undefined||!record(op.placement)||!id(op.placement.patternId)||!id(op.placement.laneId))throw fail('A create op needs its pattern and lane.',{opIndex:index});continue;}
  if(!id(op.placementId)||touched.has(op.placementId))throw fail('Each update/delete/restore op names one placement once.',{opIndex:index});touched.add(op.placementId);
  if(op.op==='update'&&!record(op.placement))throw fail('An update op needs its placement fields.',{opIndex:index});
  if(op.op==='restore'&&(!record(op.before)||typeof op.restoreToken!=='string'||!op.restoreToken))throw fail('A restore op needs its signed before and restoreToken.',{opIndex:index});
 }
 return ops;
}

/** Validated 200 receipt: per-op results in order, the inverse ops, the
 * created ids and the new timeline revision. Any doubt is an error (the write
 * is then treated as uncertain by the caller; it is never resent). */
export function placementBatchReceipt(data,ops,{projectId}={}){
 const body=record(data?.data)&&data.data.results?data.data:data;
 if(!record(body)||body.ok!==true)throw fail('Freestyle did not acknowledge the placement batch.',{operationUncertain:true});
 if(body.projectId!==undefined&&projectId!==undefined&&body.projectId!==projectId)throw fail('The placement batch receipt belongs to another project.',{operationUncertain:true});
 if(!Array.isArray(body.results)||body.results.length!==ops.length)throw fail('The placement batch receipt does not list one result per op.',{operationUncertain:true});
 const createdIds=[];
 for(const [index,result]of body.results.entries()){
  const op=ops[index];
  if(!record(result)||result.index!==index||result.op!==op.op||!id(result.placementId))throw fail('A placement batch result does not match its op.',{operationUncertain:true});
  if(op.op==='create')createdIds.push(result.placementId);else if(result.placementId!==op.placementId)throw fail('A placement batch result names another placement.',{operationUncertain:true});
 }
 if(new Set(createdIds).size!==createdIds.length)throw fail('The placement batch created duplicate identities.',{operationUncertain:true});
 const inverse=body.undo?.inverse_ops;
 if(!Array.isArray(inverse)||inverse.length!==ops.length)throw fail('The placement batch receipt has no complete undo.inverse_ops.',{operationUncertain:true});
 try{validatePlacementBatchOps(inverse);}catch(error){throw fail('The placement batch inverse is not a documented batch: '+error.message,{operationUncertain:true});}
 if(!Array.isArray(body.placements)||!Array.isArray(body.deletedIds))throw fail('The placement batch receipt is incomplete.',{operationUncertain:true});
 const timelineRevision=revision(body.timelineRevision);if(!timelineRevision)throw fail('The placement batch receipt has no timeline revision.',{operationUncertain:true});
 const deleted=ops.filter(op=>op.op==='delete').map(op=>op.placementId);
 if(deleted.some(placementId=>!body.deletedIds.includes(placementId)))throw fail('The placement batch did not confirm every deletion.',{operationUncertain:true});
 return{results:clone(body.results),createdIds,deletedIds:clone(body.deletedIds),placements:clone(body.placements),inverseOps:clone(inverse),timelineRevision,createdLaneIds:clone(body.createdLaneIds||[])};
}

/** Secrets never leave the receipt holder: restore tokens are redacted in logs. */
export function redactPlacementBatchOps(ops){return(ops||[]).map(op=>op?.restoreToken?{...op,restoreToken:'[signed restore token]'}:op);}

/** FL hint-bar label for a batch's forward ops. */
export function placementBatchLabel(ops,hint){
 if(typeof hint==='string'&&hint)return hint;const kinds=new Set((ops||[]).map(op=>op.op)),plural=(ops||[]).length===1?'clip':'clips';
 if(kinds.size===1&&kinds.has('create'))return'Add pattern '+plural;if(kinds.size===1&&kinds.has('delete'))return'Delete pattern '+plural;if(kinds.size===1&&kinds.has('update'))return'Move pattern '+plural;return'Edit pattern clips';
}
