/** Retain the authenticated DELETE's signed undo; never reconstruct a placement.
 * Studio API 306: PatternPlacementSnapshot / PatternPlacement{Delete,Restore}Result.
 * Public handles and diagnostics contain no restore token. Arguments are transient
 * transport DTOs and must be redacted before retaining them in a journal/error.
 */
const retained=new WeakMap(),own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const dangerous=new Set(['__proto__','prototype','constructor']);
export const PLACEMENT_SNAPSHOT_FIELDS=Object.freeze(['id','projectId','patternId','laneId','name','startMs','durationMs','loopDurationMs','repeatCount','offsetMs','windowMs','loopPhaseMs','busId','sourceBusOverrides','displayOrder','muted','soloed','nativeEq','rowGain','automation']);
const automationFields=['id','targetKey','targetKind','target','valueType','defaultValue','points','revision'];
const fail=()=>Object.assign(new Error('Use the complete, correlated signed placement delete/restore receipt.'),{code:'placement_restore_invalid_receipt'});
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function json(value){
 const seen=new WeakSet();let nodes=0;
 const visit=(item,depth)=>{
  if(++nodes>200000||depth>40)throw fail();
  if(item===null||typeof item==='boolean'||typeof item==='string')return item;
  if(typeof item==='number'){if(!Number.isFinite(item))throw fail();return item;}
  if(typeof item!=='object'||seen.has(item)||!Array.isArray(item)&&!plain(item))throw fail();
  seen.add(item);const descriptors=Object.getOwnPropertyDescriptors(item),keys=Reflect.ownKeys(descriptors);
  if(keys.some(key=>typeof key!=='string'||dangerous.has(key)||key!=='length'&&(!descriptors[key].enumerable||!own(descriptors[key],'value'))))throw fail();
  if(Array.isArray(item)){
   if(keys.length!==item.length+1)throw fail();
   return Array.from({length:item.length},(_,index)=>{if(!own(descriptors,String(index)))throw fail();return visit(descriptors[index].value,depth+1);});
  }
  const result={};for(const key of keys){if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$|_truncated$/.test(key))&&descriptors[key].value)throw fail();result[key]=visit(descriptors[key].value,depth+1);}return result;
 };
 try{return visit(value,0);}catch{throw fail();}
}
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const equal=(a,b)=>{
 if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>own(b,key)&&equal(a[key],b[key]));
};
const identifier=(value,max=Infinity)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const revision=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\u0000-\u001f\u007f]/.test(value);
function exactKeys(value,keys){if(!plain(value)||Object.keys(value).length!==keys.length||keys.some(key=>!own(value,key)))throw fail();}
function snapshot(value,{projectId,placementId}={}){
 const before=json(value);exactKeys(before,PLACEMENT_SNAPSHOT_FIELDS);
 if(!identifier(before.id,128)||!identifier(before.projectId,128)||!identifier(before.patternId)||!identifier(before.busId)||before.laneId!==null&&!identifier(before.laneId)||before.name!==null&&typeof before.name!=='string'||projectId!==undefined&&before.projectId!==projectId||placementId!==undefined&&before.id!==placementId)throw fail();
 for(const key of ['startMs','durationMs','loopDurationMs','repeatCount','offsetMs','loopPhaseMs','displayOrder'])if(!Number.isSafeInteger(before[key]))throw fail();
 if(before.windowMs!==null&&!Number.isSafeInteger(before.windowMs)||typeof before.muted!=='boolean'||typeof before.soloed!=='boolean'||!plain(before.sourceBusOverrides)||before.nativeEq!==null&&!plain(before.nativeEq)||before.rowGain!==null&&!plain(before.rowGain)||!Array.isArray(before.automation)||before.automation.length>64)throw fail();
 for(const automation of before.automation){
  exactKeys(automation,automationFields);
  if(['id','targetKey','targetKind','valueType'].some(key=>typeof automation[key]!=='string')||!plain(automation.target)||!Array.isArray(automation.points)||typeof automation.defaultValue!=='number'||!Number.isFinite(automation.defaultValue)||!Number.isSafeInteger(automation.revision))throw fail();
 }
 return before;
}
function payload(receipt,kind){
 let value=json(receipt);if(!plain(value)||value.isError===true||value.ok===false||value.error)throw fail();
 if(own(value,'structuredContent'))value=value.structuredContent;
 if(!plain(value)||value.ok===false||value.error)throw fail();
 if(!own(value,kind)&&own(value,'response'))value=value.response;
 if(!plain(value)||value.ok===false||value.error)throw fail();return value;
}
function canonicalMatches(value,before){
 const side=json(value),canonical=plain(side)&&own(side,'canonical')?side.canonical:side;
 if(!plain(canonical)||canonical.id!==before.id||canonical.patternId!==before.patternId||canonical.deleted===true||own(canonical,'project_id')&&canonical.project_id!==before.projectId)throw fail();
 for(const key of PLACEMENT_SNAPSHOT_FIELDS)if(own(canonical,key)&&!equal(canonical[key],before[key]))throw fail();
 return canonical;
}
function secret(handle){const value=retained.get(handle);if(!value)throw fail();return value;}

export function retainPlacementDeleteUndo(receipt,options={}){
 const context=json(options);if(!plain(context)||Object.keys(context).some(key=>!['projectId','placementId','beforeSide'].includes(key)))throw fail();
 const {projectId,placementId,beforeSide}=context;
 if(!identifier(projectId,128)||!identifier(placementId,128))throw fail();
 const result=payload(receipt,'undo'),undo=result.undo;
 if(!plain(undo)||undo.op!=='restore'||undo.placementId!==placementId||!own(undo,'timelineRevision')||!revision(undo.timelineRevision)||typeof undo.restoreToken!=='string'||undo.restoreToken.length<1||Array.from(undo.restoreToken).length>1024)throw fail();
 if(own(result,'timelineRevision')&&(!revision(result.timelineRevision)||result.timelineRevision!==undo.timelineRevision)||own(result,'projectId')&&result.projectId!==projectId||own(result,'placementId')&&result.placementId!==placementId)throw fail();
 if(plain(result.response))for(const [key,expected]of [['projectId',projectId],['project_id',projectId],['placementId',placementId],['placement_id',placementId]])if(own(result.response,key)&&result.response[key]!==expected)throw fail();
 const before=snapshot(undo.before,{projectId,placementId});if(beforeSide!==undefined)canonicalMatches(beforeSide,before);
 const handle=Object.freeze({projectId,placementId,timelineRevision:undo.timelineRevision});
 retained.set(handle,{before:freeze(before),restoreToken:undo.restoreToken});return handle;
}
/** Explicit transient transport arguments. Never put this object in diagnostics. */
export function placementRestoreArguments(handle,options={}){
 const context=json(options);if(!plain(context)||Object.keys(context).some(key=>key!=='trackId'))throw fail();const {trackId}=context;
 const value=secret(handle);if(trackId!==undefined&&!identifier(trackId,64))throw fail();
 return{placement_id:handle.placementId,before:json(value.before),restoreToken:value.restoreToken,...trackId!==undefined?{track_id:trackId}:{}};
}
export function validatePlacementRestore(handle,receipt,canonicalSide){
 const value=secret(handle),result=payload(receipt,'restored');
 if(result.placementId!==handle.placementId||own(result,'projectId')&&result.projectId!==handle.projectId||!own(result,'timelineRevision')||!revision(result.timelineRevision))throw fail();
 const restored=snapshot(result.restored,{projectId:handle.projectId,placementId:handle.placementId});
 if(!equal(restored,value.before))throw fail();canonicalMatches(result.placement,restored);if(canonicalSide!==undefined)canonicalMatches(canonicalSide,restored);
 return result;
}

/** Diagnostics-only clone. It handles Error/request/body data without getters,
 * removes token-key variants, and masks known secret occurrences in messages.
 */
export function redactPlacementRestoreSecrets(value,handle){
 const secrets=new Set(),seed=retained.get(handle);if(seed)secrets.add(seed.restoreToken);
 const sensitive=key=>/token/i.test(key.replace(/[^a-z0-9]/gi,''))||/^(authorization|credential|password|clientsecret)$/i.test(key.replace(/[^a-z0-9]/gi,''));
 const parsed=new Map();let count=0;const seen=new WeakSet();
 const collect=(item,depth)=>{
  if(++count>200000||depth>40||item===null)return;
  if(typeof item==='string'&&item.length<=1048576&&/"[^"\r\n]*token[^"\r\n]*"\s*:/i.test(item))try{const data=JSON.parse(item);parsed.set(item,data);collect(data,depth+1);}catch{};
  if(!item||typeof item!=='object'||seen.has(item))return;seen.add(item);
  let descriptors;try{descriptors=Object.getOwnPropertyDescriptors(item);}catch{return;}
  for(const [key,descriptor]of Object.entries(descriptors)){if(!own(descriptor,'value'))continue;const child=descriptor.value;if(sensitive(key)&&typeof child==='string'&&child.length)secrets.add(child);else collect(child,depth+1);}
 };
 collect(value,0);const visited=new WeakSet();count=0;
 const clone=(item,depth)=>{
  if(++count>200000||depth>40)return'[unavailable]';
  if(typeof item==='string'){
   if(parsed.has(item))return JSON.stringify(clone(parsed.get(item),depth+1));
   if([...secrets].some(token=>item.includes(token)))return'[redacted]';
   return /"[^"\r\n]*token[^"\r\n]*"\s*:/i.test(item)?'[redacted]':item;
  }
  if(item===null||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return item;
  if(!item||typeof item!=='object')return'[unavailable]';if(visited.has(item))return'[circular]';visited.add(item);
  let descriptors;try{descriptors=Object.getOwnPropertyDescriptors(item);}catch{return'[unavailable]';}const result=Array.isArray(item)?[]:{};
  for(const [key,descriptor]of Object.entries(descriptors)){if(key==='length'&&Array.isArray(item)||dangerous.has(key)||sensitive(key))continue;result[key]=own(descriptor,'value')?clone(descriptor.value,depth+1):'[unavailable]';}
  return result;
 };
 return clone(value,0);
}
