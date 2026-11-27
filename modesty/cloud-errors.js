/** A 409 may mean the original idempotent write is STILL RUNNING. It is not
 * evidence of rejection, even when a compatibility layer labels it definite. */
export function isIdempotencyInProgress(value,seen=new WeakSet()){
 if(!value||typeof value!=='object'||seen.has(value))return false;seen.add(value);
 if(value.code==='idempotency_in_progress'||value.idempotencyInProgress===true)return true;
 for(const key of ['error','result','response','structuredContent','details','cause','receipt','acknowledgement'])if(isIdempotencyInProgress(value[key],seen))return true;
 if(Array.isArray(value.content))for(const item of value.content)if(item?.type==='text'&&typeof item.text==='string'){try{if(isIdempotencyInProgress(JSON.parse(item.text),seen))return true;}catch{}}
 return false;
}
export function definiteCloudRejection(error,statuses=[400,401,403,404,409,412,413,422,429]){
 return !isIdempotencyInProgress(error)&&(error?.definiteRejection===true||statuses.includes(Number(error?.status)));
}
export function retainInProgress(record,error){if(!isIdempotencyInProgress(error))return false;record.idempotencyInProgress=true;return true;}
export function assertTerminalIdempotency(record){
 if(record?.idempotencyInProgress||record?.attempts?.some(attempt=>attempt.idempotencyInProgress))throw Object.assign(new Error('The original idempotent request is still running. Retain its key and wait for its terminal receipt before another edit or reconciliation; matching saved values do not prove completion.'),{code:'idempotency_in_progress',definiteRejection:false});
}

/** Capture BEFORE dispatch. Replay must never generate a missing original key. */
export function captureWriteRequest(name,args){
 if(typeof name!=='string'||!name||!args||typeof args!=='object'||Array.isArray(args))throw new TypeError('Capture a named cloud write and its arguments.');
 const argumentsCopy=structuredClone(args),keys=[argumentsCopy.idempotency_key,argumentsCopy.idempotencyKey,argumentsCopy._studio?.idempotency_key].filter(key=>key!==undefined&&key!==null);
 if(keys.some(key=>typeof key!=='string'||!key)||new Set(keys).size>1)throw new TypeError('The original cloud write needs one consistent idempotency key.');
 argumentsCopy.idempotency_key=keys[0]??crypto.randomUUID();delete argumentsCopy.idempotencyKey;
 const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
 return freeze({name,arguments:argumentsCopy});
}

/** Explicit recovery of a server-confirmed running intent, never a retry loop. */
export async function replayKnownBusyWrite({knownBusy,request,call,assertCurrent,parse=raw=>raw}){
 const problem=(message,code='idempotency_in_progress')=>Object.assign(new Error(message),{code,definiteRejection:false});
 if(knownBusy!==true&&!isIdempotencyInProgress(knownBusy))throw problem('An ambiguous write cannot be replayed without a known-running original intent.','unconfirmed_write_outcome');
 if(!request||typeof request.name!=='string'||!request.name||!request.arguments||typeof request.arguments.idempotency_key!=='string'||!request.arguments.idempotency_key)throw problem('The original request key is missing. Keep its receipts for recovery; no new request was sent.','original_write_request_missing');
 if(typeof call!=='function'||typeof assertCurrent!=='function'||typeof parse!=='function')throw new TypeError('Recovery needs its original caller, scope guard and receipt parser.');
 assertCurrent();
 const raw=await call(request.name,structuredClone(request.arguments));
 assertCurrent();
 if(isIdempotencyInProgress(raw))throw Object.assign(problem('The original cloud write is still running; its request and key are retained.'),{status:409,result:raw});
 const receipt=await parse(raw);
 assertCurrent();
 if(isIdempotencyInProgress(receipt)||['accepted','queued','pending','running','processing','in_progress'].includes(String(receipt?.status??receipt?.state??'').toLowerCase()))throw Object.assign(problem('The original cloud write has no terminal receipt yet; keep its request and key.'),{status:409,result:raw});
 if(raw?.isError||receipt?.ok===false||receipt?.error)throw Object.assign(problem(receipt?.detail||receipt?.message||'The original cloud write did not return a successful terminal receipt.','write_recovery_rejected'),{result:raw});
 return {raw,receipt};
}
