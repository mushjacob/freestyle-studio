/** In-page replacement for Street Band's local Python bridge.
 *
 * Inside Freestyle the studio talks to Freestyle through
 * `window.parent.__freestyleStudioHost` (see docs/HOST_CONTRACT.md). The UI keeps its original request
 * shapes: every `/api/*` route of the local bridge (server.py) is served
 * here by `hostFetch`, with the same JSON request/response semantics, and is
 * translated to:
 *   - Studio API v1 (`host.apiFetch('/api/v1/...')`, first-party session bearer)
 *     for `/api/studio` and every deterministic `/api/call` (studio-api-adapter.js),
 *   - MCP JSON-RPC (`host.apiFetch('/api/mcp')`) for AI-only tools,
 *   - the project's engine (`host.dawFetch('/rick/webrtc/offer')`)
 *     plus `host.getTurnCredentials()` for the monitor peer.
 * No `/api/*` request reaches the network as-is. Without a host (unit tests, a
 * standalone checkout) hostFetch delegates to globalThis.fetch unchanged.
 */
import {planCall,executePlan,transportPayload,capability as _capability,proActions,operations,
 UnmappedStudioCall,StudioSnapshotConflict,StudioAPIResponseError,AdapterValueError,
 documentedPatternBody,singleLengthPatternBody,RETAINED_KEY_OPERATIONS,IF_MATCH_OPERATIONS,AI_ONLY_ACTIONS} from './studio-api-adapter.js';
import documentedTools from './docs/tools.json' with {type:'json'};
import {createBackingTransport} from './backing-transport.js';

const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const now=()=>globalThis.performance?.now?.()??Date.now();
const round=value=>Math.round(value*1000)/1000;
const uuid=()=>globalThis.crypto?.randomUUID?.()||`illogic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const VIEW_ID='street-band';

// ---------------------------------------------------------------- host access
/** The Freestyle host bridge (contract v1), or null outside Freestyle. */
export function freestyleHost(){
 try{
  const parent=globalThis.parent&&globalThis.parent!==globalThis?globalThis.parent:null;
  const host=parent?.__freestyleStudioHost??globalThis.__freestyleStudioHost;
  return host&&host.version===1?host:null;
 }catch{return null;}
}
/** The Freestyle page origin (the embedded document's own location is not usable). */
export function freestyleOrigin(){
 const host=freestyleHost();
 try{if(host?.origin)return String(host.origin);}catch{}
 try{if(globalThis.parent&&globalThis.parent!==globalThis&&globalThis.parent.location?.origin&&globalThis.parent.location.origin!=='null')return globalThis.parent.location.origin;}catch{}
 const own=globalThis.location?.origin;
 return own&&own!=='null'?own:'https://freestyle.audio';
}
/** The backend base URL as an absolute URL ("/api" on stage/prod). */
function apiBaseUrl(){const host=freestyleHost();let base='/api';try{base=String(host?.apiBaseUrl?.()||'/api');}catch{}return new URL(base.replace(/\/$/,''),freestyleOrigin()+'/').href.replace(/\/$/,'');}
/** Origins whose `/api/...` media and links belong to this Freestyle deployment. */
export function freestyleMediaOrigins(){const set=new Set(['https://freestyle.audio',freestyleOrigin()]);try{set.add(new URL(apiBaseUrl()).origin);}catch{}return set;}
export function embedded(){return !!freestyleHost();}
function requireHost(){const host=freestyleHost();if(!host)throw new BridgeError(503,'freestyle_host_unavailable','Open Street Band from Freestyle Studio (View menu).');return host;}

// ---------------------------------------------------------------- errors
class BridgeError extends Error{
 constructor(status,error,detail,metadata={}){super(detail||error);this.status=status;this.error=error;this.detail=detail||error;this.metadata=metadata||{};}
}
const SECRET_PATTERNS=[[/fst_(?:at|rt|ac|sec|pat)_[A-Za-z0-9_.~-]+/g,'[redacted]'],[/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi,'$1[redacted]'],[/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[redacted]'],[/([?&](?:token|signature|sig|key|X-Amz-Signature)=)[^&#\s"'<>]+/gi,'$1[redacted]']];
function cleanMessage(value){let text=String(value??'');for(const [pattern,replacement]of SECRET_PATTERNS)text=text.replace(pattern,replacement);return text.slice(0,1600);}
const SAFE_DETAIL_KEYS=new Set(['currentMixRevision','expectedMixRevision','currentValueNorm','expectedValueNorm','currentInstanceId','currentPluginType','current_instance_id','current_plugin_type','expectedBars']);
const TOKEN=/^[A-Za-z0-9_.:-]{1,128}$/;
/** Bounded diagnostics from an upstream error body (server.py safe_error_fields). */
function safeErrorFields(value){
 const fields={};
 const message=item=>typeof item==='string'&&item.trim()&&item.length<=65536&&!/<\s*\/?\s*[A-Za-z][^>]*>/.test(item)&&!item.trimStart().startsWith('{')?cleanMessage(item.trim()):null;
 const number=(item,maximum)=>{if(typeof item==='boolean'||!['number','string'].includes(typeof item)||typeof item==='string'&&item.length>32)return null;const parsed=Number(item);return Number.isFinite(parsed)&&parsed>=0&&parsed<=maximum?parsed:null;};
 const visit=(item,depth=0)=>{
  if(depth>4)return;
  if(typeof item==='string'&&item.trimStart().startsWith('{')&&item.length<=65536){try{item=JSON.parse(item);}catch{return;}}
  if(!record(item))return;
  for(const key of ['message','error_description','detail']){const text=message(item[key]);if(text)fields[key==='detail'?'detail':'message']=text;}
  const code=item.code??item.errorCode??item.error_code;
  if(Number.isInteger(code)&&Math.abs(code)<2**31)fields.code=code;else if(typeof code==='string'&&TOKEN.test(code))fields.code=code;
  if(typeof item.stage==='string'&&TOKEN.test(item.stage))fields.stage=item.stage;
  if(typeof item.upstreamRequestId==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(item.upstreamRequestId))fields.upstreamRequestId=item.upstreamRequestId;
  const engine=item.engineStatus;if(Number.isInteger(engine)&&engine>=0&&engine<=599||typeof engine==='string'&&TOKEN.test(engine))fields.engineStatus=engine;
  const error=item.error;
  if(typeof error==='string'&&!error.trimStart().startsWith('{')){const text=message(error);if(text&&!fields.message)fields.message=text;if(TOKEN.test(error)&&fields.code===undefined)fields.code=error;}
  for(const key of ['upstreamStatus','status','statusCode','http_status']){const status=number(item[key],599);if(status!==null&&status>=400&&Number.isInteger(status))fields.upstreamStatus=status;}
  for(const [output,aliases,maximum]of [['retryAfterSec',['retryAfterSec','retry_after_sec','retry_after_seconds','retryAfterSeconds','retry_after'],86400],['retryAfterMs',['retryAfterMs','retry_after_ms'],86400000]])for(const key of aliases){const delay=number(item[key],maximum);if(delay!==null){fields[output]=delay;break;}}
  if(record(item.details)){const kept={};for(const [key,detail]of Object.entries(item.details)){if(!SAFE_DETAIL_KEYS.has(key))continue;if(typeof detail==='number'&&Number.isFinite(detail)||typeof detail==='string'&&TOKEN.test(detail))kept[key]=detail;}if(Object.keys(kept).length)fields.details={...(fields.details||{}),...kept};}
  if(typeof item.retryable==='boolean')fields.retryable=item.retryable;
  if(typeof item.applied==='boolean')fields.applied=item.applied;
  if(Number.isInteger(item.rpcCode))fields.rpcCode=item.rpcCode;
  for(const key of ['error','data','response','result','structuredContent','detail','details','cause','body','message','error_description'])visit(item[key],depth+1);
 };
 visit(typeof value==='string'&&!value.trimStart().startsWith('{')?{message:value}:value);
 return fields;
}

// ---------------------------------------------------------------- responses
function jsonResponse(data,status=200,headers={}){
 const body=status===204||status===304?null:JSON.stringify(data);
 return new Response(body,{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
}
function errorResponse(error,path){
 if(!(error instanceof BridgeError))error=new BridgeError(500,'internal_error','The in-page Freestyle bridge could not complete this request.',{});
 if(path==='/api/studio')return jsonResponse({error:{code:error.error,message:cleanMessage(error.detail),stage:'validation',...error.metadata}},error.status);
 return jsonResponse({error:error.error,...error.metadata,detail:cleanMessage(error.detail)},error.status);
}

// ---------------------------------------------------------------- Studio API v1 transport
const PASSTHROUGH_HEADERS=['ETag','Retry-After','X-Request-ID','X-Editor-Revision','X-Editor-Width','X-Editor-Height','X-Editor-Plugin-Instance-Id','X-Editor-Plugin-Type','X-Editor-Frame-Stale','X-Editor-Capture-Source','X-Editor-Window-Id','X-Editor-Bound-To-Instance'];
const MAX_BINARY_RESPONSE=8*1024*1024;
const ENGINE_RETRY_CODES=new Set(['engine_session_contended','engine_session_not_found','engine_restarting']);
const RENDER_RETRY_CODES=new Set(['render_busy']);
const ENGINE_RETRY_LIMIT=2,ENGINE_RETRY_DEFAULT_SECONDS=.5,ENGINE_RETRY_MAX_SECONDS=5;
const DIAGNOSTIC_RING=512;
class StudioProxyError extends Error{constructor(status,code,message,stage='validation',details={}){super(message);this.status=status;this.data={error:{code,message,stage,...details}};}}
function engineRetryDelay(headers,value){
 let seconds=null;const raw=headers['Retry-After'];
 if(typeof raw==='string'&&/^\s*\d+(?:\.\d+)?\s*$/.test(raw))seconds=Number(raw);
 if(seconds===null&&record(value?.error))for(const [key,scale]of [['retryAfterMs',1000],['retry_after_ms',1000],['retryAfterSec',1],['retry_after',1]]){const item=value.error[key];if(typeof item==='number'&&Number.isFinite(item)&&item>=0){seconds=item/scale;break;}}
 if(seconds===null)seconds=ENGINE_RETRY_DEFAULT_SECONDS;
 return Math.max(0,Math.min(ENGINE_RETRY_MAX_SECONDS,seconds));
}
/** A GET whose documented 200 response declares an ETag header. */
export function etagConditionalRead(operation){return operation?.method==='GET'&&Object.keys(operation?.responses?.['200']?.headers||{}).some(name=>name.toLowerCase()==='etag');}
function engineRetryCode(status,value){if(status!==503||!record(value?.error))return null;const code=value.error.code;return ENGINE_RETRY_CODES.has(code)||RENDER_RETRY_CODES.has(code)?code:null;}
function binaryMediaTypes(operation){return Object.keys(operation?.responses?.['200']?.content||{}).filter(kind=>/^image\/[a-z0-9.+-]+$/.test(kind)).sort();}
function serverTimingMs(value){if(typeof value!=='string'||value.length>1024)return null;let total=0,found=false;for(const match of value.matchAll(/(?:^|[;,\s])dur=([0-9]+(?:\.[0-9]+)?)/g)){total+=Number(match[1]);found=true;}return found?round(total):null;}
function parameterText(value,schema,label){
 const kind=schema?.type;
 const valid=kind===undefined||kind==='string'&&typeof value==='string'||kind==='boolean'&&typeof value==='boolean'||kind==='integer'&&Number.isInteger(value)||kind==='number'&&typeof value==='number'&&Number.isFinite(value);
 if(!valid||Array.isArray(schema?.enum)&&!schema.enum.includes(value))throw new StudioProxyError(400,'invalid_studio_parameter','Invalid '+label+'.');
 if(typeof value==='string'){if(value.length<(schema.minLength??0)||value.length>(schema.maxLength??4096))throw new StudioProxyError(400,'invalid_studio_parameter','Invalid '+label+' length.');if(schema.pattern){let re=null;try{re=new RegExp(schema.pattern);}catch{}if(re&&!re.test(value))throw new StudioProxyError(400,'invalid_studio_parameter','Invalid '+label+' format.');}}
 if(typeof value==='number'&&(!Number.isFinite(value)||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))throw new StudioProxyError(400,'invalid_studio_parameter','Invalid '+label+' range.');
 return typeof value==='boolean'?String(value):String(value);
}
const transportDiagnostics=[];let transportSequence=0;
function prepareStudio(payload){
 const allowed=new Set(['operationId','path','query','body','idempotencyKey','ifMatch','ifNoneMatch']);
 if(!record(payload)||Object.keys(payload).some(key=>!allowed.has(key)))throw new StudioProxyError(400,'invalid_studio_request','Use a documented Studio API operation.');
 const operationId=payload.operationId,operation=typeof operationId==='string'?operations()[operationId]:null;
 if(!operation)throw new StudioProxyError(400,'unknown_studio_operation','That Studio API operation is not in the current OpenAPI specification.');
 const path=payload.path??{},query=payload.query??{};
 if(!record(path)||!record(query))throw new StudioProxyError(400,'invalid_studio_parameters','Path and query parameters must be objects.');
 const known={path:new Map(),query:new Map()};for(const parameter of operation.parameters)if(known[parameter.in])known[parameter.in].set(parameter.name,parameter);
 for(const [location,supplied]of [['path',path],['query',query]]){
  if(Object.keys(supplied).some(key=>!known[location].has(key)))throw new StudioProxyError(400,'unknown_studio_parameter','An unsupported '+location+' parameter was supplied.');
  for(const [key,parameter]of known[location])if(parameter.required&&(!(key in supplied)||supplied[key]==null))throw new StudioProxyError(400,'missing_studio_parameter','A required '+location+' parameter is missing.');
 }
 let route=operation.path;
 for(const [name,value]of Object.entries(path)){
  const text=parameterText(value,known.path.get(name).schema||{},name);
  if(text==='.'||text==='..'||/[/\\%?#]/.test(text)||/[\u0000- \u007f]/.test(text))throw new StudioProxyError(400,'invalid_studio_path','Use an opaque Freestyle identifier in the API path.');
  route=route.split('{'+name+'}').join(encodeURIComponent(text));
 }
 const search=new URLSearchParams();
 for(const [name,value]of Object.entries(query))if(value!=null)search.append(name,parameterText(value,known.query.get(name).schema||{},name));
 let body=payload.body;
 if(operationId==='updatePattern'&&body!=null){try{body=documentedPatternBody(body);}catch(error){throw new StudioProxyError(400,error.code||'invalid_pattern_body',error.message);}}
 if(operationId==='engine_update_pattern'&&body!=null)body=singleLengthPatternBody(body);
 if(operation.requestBody?.required&&body==null)throw new StudioProxyError(400,'missing_studio_body','This Studio API operation needs a JSON body.');
 if(body!=null&&!operation.requestBody)throw new StudioProxyError(400,'unexpected_studio_body','This operation does not accept a request body.');
 let raw=null;
 if(body!=null){const finiteJson=item=>typeof item==='number'?Number.isFinite(item):Array.isArray(item)?item.every(finiteJson):record(item)?Object.values(item).every(finiteJson):true;if(!finiteJson(body))throw new StudioProxyError(400,'invalid_studio_body','Send finite JSON values to Studio API.');try{raw=JSON.stringify(body);}catch{throw new StudioProxyError(400,'invalid_studio_body','Send finite JSON values to Studio API.');}}
 const media=binaryMediaTypes(operation),headers={Accept:[...media,'application/json'].join(', ')};
 if(raw!==null)headers['Content-Type']='application/json';
 if(RETAINED_KEY_OPERATIONS.has(operationId)&&!('idempotencyKey' in payload))throw new StudioProxyError(428,'idempotency_key_required','This Studio write needs its retained Idempotency-Key.');
 if(IF_MATCH_OPERATIONS.has(operationId)&&payload.ifMatch==null)throw new StudioProxyError(428,'if_match_required','Read the current timeline revision before placing this sample.');
 const read=['GET','HEAD','OPTIONS'].includes(operation.method);
 if(!read){const key='idempotencyKey' in payload?payload.idempotencyKey:uuid();if(typeof key!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(key))throw new StudioProxyError(400,'invalid_idempotency_key','Use an 8–128 character write key.');headers['Idempotency-Key']=key;}
 if(payload.ifMatch!=null){const tag=payload.ifMatch;if(typeof tag!=='string'||!tag||tag.length>512||/[\u0000-\u001f\u007f]/.test(tag))throw new StudioProxyError(400,'invalid_etag','Use the ETag returned by a project read.');headers['If-Match']=tag;}
 const keyed=operation.parameters.some(parameter=>parameter.in==='header'&&String(parameter.name||'').toLowerCase()==='idempotency-key');
 if(payload.ifNoneMatch!=null){const tag=payload.ifNoneMatch;if(!etagConditionalRead(operation))throw new StudioProxyError(400,'if_none_match_unsupported','This Studio API operation does not declare an ETag for conditional reads.');if(typeof tag!=='string'||!tag||tag.length>512||/[\u0000-\u001f\u007f]/.test(tag))throw new StudioProxyError(400,'invalid_etag','Use the ETag returned by an earlier read.');headers['If-None-Match']=tag;}
 return {url:'/api/v1'+route+(search.size?'?'+search.toString():''),method:operation.method,body:raw,headers,binaryTypes:media,
  engineRetrySafe:read||keyed,renderRetrySafe:keyed&&!read&&typeof payload.idempotencyKey==='string'&&!!payload.idempotencyKey};
}
/** One allowlisted Studio API v1 request through the host (studio_api_transport.py call). */
// The backing track appears as a Backing lane + clip (backing-transport.js).
let backingTransportCall=null;
export function studioTransportCall(payload,options={}){
 backingTransportCall??=createBackingTransport({raw:studioTransportCallRaw,methodOf:id=>operations()[id]?.method,host:freestyleHost});
 return backingTransportCall(payload,options);
}
async function studioTransportCallRaw(payload,{signal}={}){
 const started=now(),sequence=++transportSequence,diagnostic={id:sequence,recordedAtUnixMs:Date.now(),attempts:[],prepareMs:0};
 try{
  const host=requireHost();
  let t=now();const prepared=prepareStudio(payload);diagnostic.prepareMs=round(now()-t);diagnostic.operationId=payload.operationId;
  let engineRetries=0;
  for(let attempt=0;attempt<2+ENGINE_RETRY_LIMIT;attempt++){
   const timing={attempt:attempt+1};diagnostic.attempts.push(timing);t=now();let response;
   try{response=await host.apiFetch(prepared.url,{method:prepared.method,headers:{...prepared.headers},...(prepared.body!==null?{body:prepared.body}:{}),cache:'no-store',redirect:'manual',...(signal?{signal}:{})});}
   catch(error){timing.transportFailed=true;timing.responseHeadersMs=round(now()-t);if(error?.name==='AbortError')throw error;throw new StudioProxyError(502,'studio_unreachable','Could not reach Freestyle Studio API.','transport');}
   timing.responseHeadersMs=round(now()-t);t=now();
   const status=response.type==='opaqueredirect'?302:response.status,headers={};
   for(const name of PASSTHROUGH_HEADERS){const value=response.headers.get(name);if(value!=null&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value))headers[name]=value;}
   const contentType=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
   timing.status=status;const upstreamMs=serverTimingMs(response.headers.get('Server-Timing'));if(upstreamMs!==null)timing.upstreamServerTimingMs=upstreamMs;
   // A session token can expire between reads; the host's next request carries the refreshed one.
   if(status===401&&attempt===0&&engineRetries===0){try{await response.body?.cancel?.();}catch{}continue;}
   if(status>=300&&status<400&&status!==304)throw new StudioProxyError(502,'studio_redirect_refused','Freestyle returned an unexpected API redirect.','response');
   if(status===200&&prepared.binaryTypes.length&&contentType!=='application/json'){
    // A documented image body (plugin editor frame) passes through byte-for-byte.
    if(!prepared.binaryTypes.includes(contentType))throw new StudioProxyError(502,'invalid_studio_response','Freestyle returned an undocumented media type.','response');
    const binary=await response.arrayBuffer();timing.bodyReadMs=round(now()-t);
    if(!binary.byteLength||binary.byteLength>MAX_BINARY_RESPONSE)throw new StudioProxyError(502,binary.byteLength?'studio_response_too_large':'invalid_studio_response','The plugin editor frame was empty or exceeded the bridge limit.','response');
    timing.binaryBytes=binary.byteLength;return {status,headers,data:null,binary,contentType,idempotencyKey:null};
   }
   const text=status===204||status===304?'':await response.text();timing.bodyReadMs=round(now()-t);
   let value=null;if(text){try{value=JSON.parse(text);}catch{throw new StudioProxyError(502,'invalid_studio_response','Freestyle Studio API returned invalid JSON.','response');}}
   if(typeof headers['X-Request-ID']==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(headers['X-Request-ID']))timing.upstreamRequestId=headers['X-Request-ID'];
   const retryCode=engineRetryCode(status,value),retrySafe=RENDER_RETRY_CODES.has(retryCode)?prepared.renderRetrySafe:prepared.engineRetrySafe;
   if(retryCode&&retrySafe&&engineRetries<ENGINE_RETRY_LIMIT){engineRetries++;const delay=engineRetryDelay(headers,value);timing.engineRetry=retryCode;timing.engineRetryDelayMs=round(delay*1000);await sleep(delay*1000);if(signal?.aborted)throw new DOMException('The Studio request was aborted.','AbortError');continue;}
   if(retryCode)timing[retrySafe?'engineRetryExhausted':'engineRetryRefused']=retryCode;
   if(record(value))for(const key of ['applied','ok','engine_reload_required','dry_run'])if(typeof value[key]==='boolean')timing[key]=value[key];
   return {status,headers,data:value,idempotencyKey:prepared.headers['Idempotency-Key']??null};
  }
  throw new StudioProxyError(502,'studio_unreachable','Freestyle Studio API kept refusing this session.','authorization');
 }finally{
  diagnostic.totalMs=round(now()-started);transportDiagnostics.push(diagnostic);if(transportDiagnostics.length>DIAGNOSTIC_RING)transportDiagnostics.shift();
 }
}
/** server.py studio_call: transport failures become the same status/data envelope. */
async function studioCall(payload,options){
 try{return await studioTransportCall(payload,options);}
 catch(error){
  if(error instanceof StudioProxyError)return {status:error.status,headers:{},data:error.data};
  if(error instanceof BridgeError)return {status:error.status,headers:{},data:{error:{code:error.metadata.code||error.error,message:error.detail,stage:error.metadata.stage||'authorization',...error.metadata}}};
  throw error;
 }
}

// ---------------------------------------------------------------- /api/call (adapter + MCP)
class Semaphore{
 constructor(size){this.size=size;this.active=0;this.waiting=[];}
 async run(task,signal){
  if(this.active>=this.size)await new Promise((resolve,reject)=>{const entry={resolve,reject};this.waiting.push(entry);signal?.addEventListener?.('abort',()=>{const index=this.waiting.indexOf(entry);if(index>=0){this.waiting.splice(index,1);reject(new DOMException('The read was aborted.','AbortError'));}},{once:true});});
  this.active++;try{return await task();}finally{this.active--;this.waiting.shift()?.resolve();}
 }
}
// One full project snapshot is five independent GETs; background refreshes have their own pool.
const READ_SLOTS=new Semaphore(6),BACKGROUND_READ_SLOTS=new Semaphore(4);
const callDiagnostics=[];let callSequence=0;
const NAME=/^[A-Za-z0-9_.-]{1,160}$/;

export async function bridgeCall(name,argumentsValue={},{idempotencyKey=null,ifMatch=null,priority=null,signal=null}={}){
 const started=now(),diagnostic={id:++callSequence,recordedAtUnixMs:Date.now(),operations:[],readSlotWaitMs:0,readSlotCount:0,...(priority==='background'?{priority:'background'}:{})};
 try{
  if(typeof name!=='string'||!NAME.test(name))throw new BridgeError(400,'invalid_tool','Provide a valid Freestyle operation name.');
  if(!record(argumentsValue))throw new BridgeError(400,'invalid_arguments','Operation arguments must be a JSON object.');
  try{
   let t=now();const plan=planCall(name,argumentsValue,{idempotencyKey,ifMatch});diagnostic.planMs=round(now()-t);diagnostic.planKind=plan.kind;
   if(plan.kind==='mcp')return await mcpCall(name,argumentsValue,{signal});
   const slots=priority==='background'?BACKGROUND_READ_SLOTS:READ_SLOTS;
   const send=async request=>{
    const item={operationId:request.operationId};const begin=now();
    try{
     const payload=transportPayload(request);
     if(request.method!=='GET')return await studioCall(payload,{signal});
     const queued=now();
     return await slots.run(()=>{diagnostic.readSlotWaitMs+=now()-queued;diagnostic.readSlotCount++;return studioCall(payload,{signal});},signal);
    }finally{item.sendMs=round(now()-begin);if(diagnostic.operations.length<128)diagnostic.operations.push(item);else diagnostic.operationsTruncated=true;}
   };
   t=now();try{return {structuredContent:await executePlan(plan,send),isError:false};}finally{diagnostic.executeMs=round(now()-t);}
  }catch(error){
   if(error instanceof UnmappedStudioCall)throw new BridgeError(error.status,error.code,error.message,{code:error.code,stage:error.stage,name:error.toolName,...(typeof error.action==='string'&&NAME.test(error.action)?{action:error.action}:{})});
   if(error instanceof StudioSnapshotConflict)throw new BridgeError(error.status,error.code,error.message,{code:error.code,stage:error.stage});
   if(error instanceof StudioAPIResponseError){
    const metadata={code:error.code,stage:error.stage,upstreamStatus:error.status};
    if(error.engineStatus!=null)metadata.engineStatus=error.engineStatus;
    if(error.details!=null)metadata.details=error.details;
    if(error.requestId!=null)metadata.upstreamRequestId=error.requestId;
    if(error.retryAfterSec!=null)metadata.retryAfterSec=error.retryAfterSec;
    if(typeof error.applied==='boolean')metadata.applied=error.applied;
    // server.py APIError(metadata) keeps only the bounded safe fields (details: the revision/instance identities).
    throw new BridgeError(error.status,error.code,error.message,safeErrorFields(metadata));
   }
   if(error instanceof AdapterValueError||error instanceof TypeError&&!(error instanceof BridgeError))throw new BridgeError(400,'invalid_studio_arguments',error.message,{stage:'validation'});
   throw error;
  }
 }finally{diagnostic.totalMs=round(now()-started);diagnostic.readSlotWaitMs=round(diagnostic.readSlotWaitMs);callDiagnostics.push(diagnostic);if(callDiagnostics.length>DIAGNOSTIC_RING)callDiagnostics.shift();}
}

let rpcSequence=0;
function parseRpc(text,contentType,requestId){
 if(!contentType.includes('text/event-stream')){
  let result;try{result=JSON.parse(text);}catch{throw new BridgeError(502,'invalid_upstream_response','Freestyle returned an invalid JSON response.');}
  if(Array.isArray(result))result=result.find(item=>record(item)&&item.id===requestId)??null;
  if(!record(result))throw new BridgeError(502,'invalid_upstream_response','Freestyle returned an invalid MCP response.');
  return result;
 }
 for(const event of text.replace(/\r\n/g,'\n').split('\n\n')){
  const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');if(!data)continue;
  try{const result=JSON.parse(data);if(record(result)&&result.id===requestId)return result;}catch{}
 }
 throw new BridgeError(502,'invalid_upstream_response','Freestyle sent no matching MCP response event.');
}
/** AI-only tools (mozart_ai_command, compose …) over the backend's MCP endpoint. */
async function mcpCall(name,args,{signal}={}){
 if(typeof name!=='string'||!NAME.test(name))throw new BridgeError(400,'invalid_tool','Provide a valid Freestyle tool name.');
 if(!record(args))throw new BridgeError(400,'invalid_arguments','Tool arguments must be a JSON object.');
 const host=requireHost(),requestId=++rpcSequence;
 const body=JSON.stringify({jsonrpc:'2.0',id:requestId,method:'tools/call',params:{name,arguments:args}});
 let response;
 for(let attempt=0;attempt<2;attempt++){
  try{response=await host.apiFetch('/api/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body,cache:'no-store',...(signal?{signal}:{})});}
  catch(error){if(error?.name==='AbortError')throw error;throw new BridgeError(502,'freestyle_unreachable','Could not reach Freestyle. Check your connection and try again.');}
  if(response.status!==401||attempt)break;
 }
 const text=await response.text();
 if(!response.ok){
  const metadata={upstreamStatus:response.status};if(text.length<=65536){try{Object.assign(metadata,safeErrorFields(JSON.parse(text)));}catch{}}metadata.upstreamStatus=response.status;
  const detail=metadata.detail||metadata.message||`Freestyle returned HTTP ${response.status}.`;
  throw new BridgeError([400,401,403,404,409,429].includes(response.status)?response.status:502,'freestyle_error',detail,metadata);
 }
 const rpc=parseRpc(text,response.headers.get('Content-Type')||'application/json',requestId);
 if(rpc.id!==requestId)throw new BridgeError(502,'invalid_upstream_response','Freestyle returned a mismatched MCP response.');
 if(rpc.error){const metadata=safeErrorFields(rpc.error);if(Number.isInteger(rpc.error?.code))metadata.rpcCode=rpc.error.code;throw new BridgeError(502,'mcp_error',metadata.detail||metadata.message||'Freestyle returned an MCP error.',metadata);}
 if(!('result' in rpc))throw new BridgeError(502,'invalid_upstream_response','Freestyle returned no MCP result.');
 return rpc.result;
}

// ---------------------------------------------------------------- tool catalog
let toolCatalog=null;
/** Local OpenAPI-backed discovery (server.py tools()): never tools/list over MCP. */
function tools(){
 if(toolCatalog)return toolCatalog;
 const actions=new Set(proActions());
 const list=(documentedTools.tools||[]).map(documented=>{
  const tool={...documented,schemaSource:'studio-api-v1'};
  if(tool.name==='execute_pro_action'){
   tool.studioApiActions=[...actions];const schema=copy(tool.inputSchema||{}),action=schema.properties?.action;
   if(Array.isArray(action?.enum))action.enum=action.enum.filter(value=>actions.has(value)||AI_ONLY_ACTIONS.has(value));
   tool.inputSchema=schema;
  }
  try{const mapped=planCall(tool.name,{});tool.studioApiAvailable=mapped.kind!=='mcp';tool.aiOnly=mapped.kind==='mcp';}
  catch(error){if(error instanceof UnmappedStudioCall){tool.studioApiAvailable=false;tool.featureDisabledReason=error.reason;}else tool.studioApiAvailable=true;}
  return tool;
 });
 toolCatalog={source:'studio-api-v1',tools:list,note:'Deterministic UI operations use Studio API v1. Missing v1 features are disabled; MCP is reserved for AI commands.'};
 return toolCatalog;
}
export function capability(action){return _capability(action);}

// ---------------------------------------------------------------- status / workspace
function status(){
 const host=freestyleHost();let user=null;try{user=host?.getUser?.()||null;}catch{}
 return {connected:!!host,embedded:true,provider:'Freestyle',authRequired:false,...(user?.username?{username:user.username}:{}),
  scopes:[],toolsCount:(documentedTools.tools||[]).length,requiresPro:true,authUrl:null,
  studioApi:{available:true,missingDeterministicCallsEnabled:false,mcpAiOnly:true}};
}
const WORKSPACE_KEY='illogic:workspace';
function readWorkspace(){try{const value=JSON.parse(globalThis.localStorage?.getItem(WORKSPACE_KEY)||'{}');return record(value)?value:{};}catch{return {};}}
/** The project is the one open in Freestyle Studio; only its last engine context track is remembered here. */
function workspaceContext(values){
 const host=freestyleHost();let hostProject='';try{hostProject=String(host?.getProjectId?.()||'');}catch{}
 const stored=readWorkspace();
 if(values===undefined){
  const projectId=hostProject||(host?'':String(stored.projectId||''));
  const tracks=record(stored.tracks)?stored.tracks:{};
  return {projectId,trackId:typeof tracks[projectId]==='string'?tracks[projectId]:''};
 }
 if(!record(values)||Object.keys(values).some(key=>key!=='projectId'&&key!=='trackId'))throw new BridgeError(400,'invalid_context','Workspace context accepts only projectId and trackId.');
 const selected={projectId:values.projectId??'',trackId:values.trackId??''};
 if(Object.values(selected).some(value=>typeof value!=='string'||value.length>256))throw new BridgeError(400,'invalid_context','Project and track IDs must be strings of at most 256 characters.');
 const tracks={...(record(stored.tracks)?stored.tracks:{})};if(selected.projectId){delete tracks[selected.projectId];tracks[selected.projectId]=selected.trackId;}
 const keys=Object.keys(tracks);for(const key of keys.slice(0,Math.max(0,keys.length-32)))delete tracks[key];
 try{globalThis.localStorage?.setItem(WORKSPACE_KEY,JSON.stringify({projectId:selected.projectId,tracks}));}catch{}
 return selected;
}

// ---------------------------------------------------------------- live audio (monitor peer)
const ID64=/^[A-Za-z0-9_-]{1,64}$/,ID256=/^[A-Za-z0-9_-]{1,256}$/;
function audioString(value,maximum,label){if(typeof value!=='string'||!value||value.length>maximum||/[\u0000-\u001f\u007f]/.test(value))throw new BridgeError(400,'invalid_audio_arguments',`Provide a valid ${label} of at most ${maximum} characters.`);return value;}
function audioContext(payload){
 const projectId=payload.project_id??payload.projectId,trackId=payload.track_id??payload.trackId??payload.context_track_id;
 if(typeof projectId!=='string'||!ID64.test(projectId)||trackId!=null&&trackId!==''&&(typeof trackId!=='string'||!ID64.test(trackId)))throw new BridgeError(400,'invalid_audio_context','Provide a valid project ID and, optionally, a track ID for cloud audio.');
 return {projectId,trackId:trackId||''};
}
function credentialsShape(credentials){
 if(!record(credentials))throw new BridgeError(502,'invalid_audio_response','Freestyle returned no TURN relay credentials.');
 const urls=typeof credentials.urls==='string'?[credentials.urls]:Array.isArray(credentials.urls)?credentials.urls.filter(url=>typeof url==='string'&&url):[];
 if(!urls.length||typeof credentials.username!=='string'||typeof credentials.credential!=='string')throw new BridgeError(502,'invalid_audio_response','Freestyle returned unusable TURN relay credentials.');
 return {urls,username:credentials.username,credential:credentials.credential,expiresAt:credentials.expiresAt,...(credentials.ttlSec!=null?{ttlSec:credentials.ttlSec}:{})};
}
async function turnCredentials({forceRefresh=false}={}){
 const host=requireHost();
 try{return credentialsShape(await host.getTurnCredentials({forceRefresh}));}
 catch(error){if(error instanceof BridgeError)throw error;throw new BridgeError(502,'cloud_audio_error',cleanMessage(error?.message||'Freestyle could not issue TURN credentials.'));}
}
async function pinnedDawBase(projectId){
 const host=requireHost();let base='';
 try{base=String(await host.getDawBaseUrl(projectId)||'').replace(/\/$/,'');}catch(error){throw new BridgeError(502,'cloud_audio_error',cleanMessage(error?.message||'Freestyle could not resolve the project engine.'));}
 try{const url=new URL(base);return url.protocol==='https:'||/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)?url.origin+url.pathname.replace(/\/$/,''):'';}catch{return '';}
}
/** /api/audio/start: the session is already open (Default studio, same engine session); report its routing and TURN. */
async function audioStart(payload){
 const {projectId,trackId}=audioContext(payload);
 const [dawBaseUrl,credentials]=await Promise.all([pinnedDawBase(projectId),turnCredentials()]);
 return {projectId,...(trackId?{trackId}:{}),session:{projectId,...(trackId?{trackId}:{}),phase:'live',...(dawBaseUrl?{dawBaseUrl}:{})},turnCredentials:credentials,nextStep:'offer'};
}
async function audioIce(){return turnCredentials();}
async function dawJson(route,body,{projectId,timeoutMs=12000,signal}={}){
 const host=requireHost();let response;
 try{response=await host.dawFetch(route,{method:'POST',body:JSON.stringify(body),...(signal?{signal}:{})},{projectId,timeoutMs});}
 catch(error){if(error?.name==='AbortError')throw error;return {status:0,data:null,error};}
 const text=await response.text().catch(()=>'');let data=null;try{data=text?JSON.parse(text):null;}catch{data=null;}
 return {status:response.status,data,text};
}
/** The engine session is gone (replaced or idled): the Default studio's recovery reloads it on the
 * project's engine host. */
async function reopenEngineSession(){
 const host=requireHost();
 if(typeof host.ensureEngineSession!=='function')throw new BridgeError(404,'engine_session_not_found','The project engine session is gone. Reopen the project in Freestyle Studio.',{code:'engine_session_not_found',stage:'engine_dispatch'});
 try{await host.ensureEngineSession({timeoutMs:45000});}catch(error){throw new BridgeError(404,'engine_session_not_found',cleanMessage(error?.message||'Freestyle could not reopen the project engine session.'),{code:'engine_session_not_found',stage:'engine_dispatch'});}
}
/** /api/audio/offer: SDP straight to the project's engine host, like the Default studio. */
async function audioOffer(payload,{signal=null}={}){
 const {projectId,trackId}=audioContext(payload);
 const offer=payload.offer??{sdp:payload.sdp,type:payload.type??'offer'};
 if(!record(offer)||(offer.type??'offer')!=='offer')throw new BridgeError(400,'invalid_audio_offer','Send an SDP offer for the cloud audio session.');
 if(typeof offer.sdp!=='string'||!offer.sdp||offer.sdp.length>65536)throw new BridgeError(400,'invalid_audio_offer','SDP must be a nonempty string of at most 65536 characters.');
 const clientId=audioString(payload.client_id??payload.clientId??`illogic-${uuid()}`,128,'client_id');
 const mode=audioString(payload.mode??'daw',40,'mode'),quality=payload.quality_profile??payload.qualityProfile;
 if(quality!=null)audioString(quality,80,'quality_profile');
 const lowLatency=payload.low_latency??payload.lowLatency;if(lowLatency!=null&&typeof lowLatency!=='boolean')throw new BridgeError(400,'invalid_audio_arguments','low_latency must be a boolean.');
 let turn=payload.turn_credentials;if(turn!==undefined&&(!record(turn)||JSON.stringify(turn).length>65536))throw new BridgeError(400,'invalid_turn_credentials','TURN credentials must be a JSON object of at most 64 KB.');
 if(payload.trickle!=null&&typeof payload.trickle!=='boolean')throw new BridgeError(400,'invalid_audio_arguments','trickle must be a boolean.');
 // Trickle ICE (sendMonitorOffer trickle:true) only through a host that declares it (host contract: check the flag).
 let trickle=false;try{trickle=payload.trickle===true&&requireHost().capabilities?.trickleIce===true;}catch{}
 const body={clientId,mode,...(lowLatency!=null?{lowLatency}:{}),...(quality?{qualityProfile:quality,quality_profile:quality}:{}),...(turn?{turn_credentials:turn}:{}),...(trickle?{trickle:true}:{}),offer:{type:'offer',sdp:offer.sdp}};
 let reopened=false;
 for(let attempt=0;;attempt++){
  if(signal?.aborted)throw new DOMException('Cloud audio connection cancelled.','AbortError');
  const result=await dawJson('/rick/webrtc/offer',body,{projectId,signal});
  if(result.status>=200&&result.status<300&&record(result.data))return result.data;
  const code=String(result.data?.code||result.data?.error?.code||(typeof result.data?.error==='string'?result.data.error:'')||'');
  if(result.status===404&&/session_not_found/i.test(code+' '+(result.text||''))&&!reopened){reopened=true;await reopenEngineSession();continue;}
  // Transient engine failures (a re-offer right after a relay drop) get a short bounded retry.
  if((result.status===0||[502,504].includes(result.status))&&attempt<2){await sleep(400*(attempt+1));continue;}
  const message=result.data?.error?.message||result.data?.message||(typeof result.data?.error==='string'?result.data.error:'')||result.error?.message||`Freestyle's audio engine answered HTTP ${result.status||'(no response)'}.`;
  const status=[400,401,403,404,409,429].includes(result.status)?result.status:502;
  throw new BridgeError(status,'cloud_audio_error',cleanMessage(message),{...(code&&TOKEN.test(code)?{code}:{}),stage:'engine_dispatch',...(result.status?{engineStatus:result.status}:{})});
 }
}
/** /api/audio/ingest-offer: the documented live-ingest action (only used without an injected offerIngest). */
async function audioIngestOffer(payload){
 const projectId=payload.project_id??payload.projectId,trackId=payload.track_id??payload.trackId;
 if(![projectId,trackId].every(value=>typeof value==='string'&&ID256.test(value)))throw new BridgeError(400,'invalid_audio_context','Provide valid project and track IDs for recording.');
 const offer=payload.offer??{sdp:payload.sdp,type:payload.type??'offer'};
 if(!record(offer)||(offer.type??'offer')!=='offer'||typeof offer.sdp!=='string'||!offer.sdp||offer.sdp.length>512*1024)throw new BridgeError(400,'invalid_audio_offer','Send an SDP offer for cloud recording.');
 const clientId=payload.clientId??`illogic-ingest-${uuid().replace(/-/g,'').slice(0,24)}`;
 if(typeof clientId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(clientId))throw new BridgeError(400,'invalid_audio_client','Provide a valid cloud recording client ID.');
 const nativePayload={clientId,offer:{type:'offer',sdp:offer.sdp}};
 if(payload.lane_id!=null){if(typeof payload.lane_id!=='string'||!ID256.test(payload.lane_id))throw new BridgeError(400,'invalid_audio_context','Provide a valid recording lane ID.');nativePayload.lane_id=payload.lane_id;}
 if(payload.delay_ms!=null){if(typeof payload.delay_ms!=='number'||!Number.isFinite(payload.delay_ms)||Math.abs(payload.delay_ms)>10000)throw new BridgeError(400,'invalid_audio_delay','Recording delay must be a finite number between -10000 and 10000 ms.');nativePayload.delay_ms=payload.delay_ms;}
 const profile=payload.profile??'regional_music';if(typeof profile!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(profile))throw new BridgeError(400,'invalid_audio_profile','Provide a valid cloud recording profile.');nativePayload.profile=profile;
 if(payload.turn_credentials!==undefined){if(!record(payload.turn_credentials)||JSON.stringify(payload.turn_credentials).length>65536)throw new BridgeError(400,'invalid_turn_credentials','TURN credentials must be a JSON object of at most 64 KB.');nativePayload.turn_credentials=payload.turn_credentials;}
 const result=await bridgeCall('execute_pro_action',{project_id:projectId,track_id:trackId,action:'live_ingest_offer',arguments:nativePayload});
 const data=result?.structuredContent??result,response=data?.response??data;
 if(data?.ok===false||data?.error||response?.ok===false||response?.error)throw new BridgeError(502,'cloud_audio_error',cleanMessage(response?.error?.message||response?.message||'Freestyle could not complete the audio operation.'));
 return response;
}
function audioEditor(payload){
 const projectId=payload.project_id??payload.projectId,trackId=payload.track_id??payload.trackId;
 if(![projectId,trackId].every(value=>typeof value==='string'&&ID256.test(value)))throw new BridgeError(400,'invalid_editor_context','Provide valid project and context track IDs for the plugin editor.');
 if(!Number.isInteger(payload.engine_track_id)||payload.engine_track_id<1)throw new BridgeError(400,'invalid_editor_track','The plugin editor requires a positive numeric engine track ID.');
 if(!Number.isInteger(payload.plugin_index)||payload.plugin_index<0||payload.plugin_index>64)throw new BridgeError(400,'invalid_editor_plugin','Plugin index must be an integer from 0 to 64.');
 if(!['mirror-open','open','close','release'].includes(payload.action))throw new BridgeError(400,'invalid_editor_action','Choose a supported plugin editor lifecycle action.');
 throw new BridgeError(501,'studio_api_feature_unavailable','Native editor mirroring is not exposed by the published Studio API v1. Use the plugin parameter controls.',{code:'studio_api_feature_unavailable',stage:'api_mapping'});
}
function audioPluginChain(payload){
 const ids=[payload.project_id??payload.projectId,payload.track_id??payload.trackId,payload.lane_id];
 if(!ids.every(value=>typeof value==='string'&&ID256.test(value)))throw new BridgeError(400,'invalid_plugin_context','Provide valid project, context track, and lane IDs.');
 if(typeof payload.instance_id!=='string'||!/^[A-Za-z0-9_.:@-]{1,512}$/.test(payload.instance_id))throw new BridgeError(400,'invalid_plugin_instance','Choose a plugin instance returned by the live engine.');
 if(!['move','remove'].includes(payload.operation))throw new BridgeError(400,'invalid_plugin_operation','Choose move or remove for this plugin instance.');
 if(payload.operation==='move'&&(!Number.isInteger(payload.to_index)||payload.to_index<0||payload.to_index>1024))throw new BridgeError(400,'invalid_plugin_position','Plugin position must be an integer from 0 to 1024.');
 throw new BridgeError(501,'studio_api_feature_unavailable','Plugin instance chain editing is not exposed by the published Studio API v1.',{code:'studio_api_feature_unavailable',stage:'api_mapping'});
}

// ---------------------------------------------------------------- media
const MEDIA_PREVIEW_PATH=/^\/api\/marketplace\/[A-Za-z0-9_\/-]+$/;
// The Default Sound Library's own preview routes: a signed-in
// session streams them to an <audio> element; the Browser previews them directly, nothing is imported.
const MEDIA_LIBRARY_ROW_PATH=/^\/api\/(?:audio-library(?:\/backings)?\/[A-Za-z0-9_-]{1,128}|marketplace\/(?:pattern_library|sound_pack)\/items\/[A-Za-z0-9_-]{1,128}|marketplace\/beat_kit\/assets\/[A-Za-z0-9_-]{1,128}\/pads\/\d{1,3})\/preview$/;
const MEDIA_SIGNED_LISTEN_PATH=/^\/api\/mcp\/listen\/[0-9a-f]{32}\/audio$/;
const MAX_MEDIA_BYTES=32*1024*1024,mediaObjectUrls=new Map();
/** The same-origin URL of a Freestyle `/api/...` path, or null when the API is cross-origin. */
function sameOriginApiUrl(path){
 const base=apiBaseUrl();
 try{const api=new URL(base);if(api.origin!==freestyleOrigin())return null;return api.origin+api.pathname.replace(/\/$/,'')+path.replace(/^\/api(?=\/)/,'')+'';}catch{return null;}
}
/** /api/media/prepare: library previews and signed listen renders become directly playable URLs.
 * Same-origin media authenticates with the Freestyle session cookie (HttpOnly, minted at
 * login); a cross-origin API base falls back to an authenticated fetch and a blob: URL. */
export async function prepareFreestyleMedia(url){
 if(typeof url!=='string'||url.length>2048)throw new BridgeError(400,'invalid_media_url','Choose an audio preview URL returned by Freestyle.');
 let parsed;try{parsed=new URL(url,freestyleOrigin()+'/');}catch{throw new BridgeError(400,'invalid_media_url','Choose an audio preview URL returned by Freestyle.');}
 if(!freestyleMediaOrigins().has(parsed.origin))return url;
 const clean=parsed.protocol!=='javascript:'&&!parsed.username&&!parsed.password&&!parsed.hash&&!/[\u0000- \u007f]/.test(url);
 let signed=false,library=false;
 if(clean&&MEDIA_SIGNED_LISTEN_PATH.test(parsed.pathname)){const keys=[...parsed.searchParams.keys()];signed=keys.length===1&&keys[0]==='token'&&/^[A-Za-z0-9_.-]{1,1800}$/.test(parsed.searchParams.get('token')||'');}
 if(clean&&!parsed.search&&(MEDIA_PREVIEW_PATH.test(parsed.pathname)||MEDIA_LIBRARY_ROW_PATH.test(parsed.pathname)))library=true;
 if(!signed&&!library)throw new BridgeError(400,'invalid_media_url','Only Freestyle library previews and signed listen audio routes are supported.');
 const relative=parsed.pathname+parsed.search,direct=sameOriginApiUrl(relative);
 if(direct)return direct;
 if(mediaObjectUrls.has(relative))return mediaObjectUrls.get(relative);
 const host=requireHost();const response=await host.apiFetch(relative,{method:'GET',headers:{Accept:'audio/*'},redirect:'error'});
 if(!response.ok)throw new BridgeError([400,401,403,404,416,429].includes(response.status)?response.status:502,'media_upstream_error','Freestyle rejected the audio preview request.');
 const type=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
 if(!type.startsWith('audio/'))throw new BridgeError(502,'media_not_audio','Freestyle did not return an audio media response.');
 const blob=await response.blob();if(blob.size>MAX_MEDIA_BYTES)throw new BridgeError(413,'media_too_large','Audio preview exceeds the 32 MB preview limit.');
 const objectUrl=URL.createObjectURL(blob);mediaObjectUrls.set(relative,objectUrl);
 while(mediaObjectUrls.size>32){const [key,value]=mediaObjectUrls.entries().next().value;mediaObjectUrls.delete(key);URL.revokeObjectURL(value);}
 return objectUrl;
}
async function prepareMedia(payload){return {playbackUrl:await prepareFreestyleMedia(payload?.url),expiresInSec:300};}

// ---------------------------------------------------------------- diagnostics
const CLIENT_LOG=[],CLIENT_LOG_CAPACITY=5000,CLIENT_LOG_STATS={posts:0,received:0,ignored:0};
function recordClientLog(payload){
 const entries=Array.isArray(payload?.entries)?payload.entries:[payload];CLIENT_LOG_STATS.posts++;CLIENT_LOG_STATS.ignored+=Math.max(0,entries.length-50);
 for(const entry of entries.slice(0,50)){if(!record(entry)){CLIENT_LOG_STATS.ignored++;continue;}CLIENT_LOG.push({serverReceivedMs:Date.now(),...Object.fromEntries(Object.entries(entry).slice(0,20))});CLIENT_LOG_STATS.received++;if(CLIENT_LOG.length>CLIENT_LOG_CAPACITY)CLIENT_LOG.shift();}
}
export function bridgeDiagnostics(){
 return {calls:copy(callDiagnostics),transport:copy(transportDiagnostics),client:{entries:copy(CLIENT_LOG),stats:{...CLIENT_LOG_STATS,capacity:CLIENT_LOG_CAPACITY,stored:CLIENT_LOG.length}},units:'milliseconds',
  boundaries:{responseHeadersMs:'host.apiFetch through response headers',readSlotWaitMs:'Sum of GET semaphore waits; parallel waits can overlap',executeMs:'Entire adapter execution, including all reads and transport; parallel totals are not additive'}};
}

// ---------------------------------------------------------------- router
async function readJson(init){
 const body=init?.body;if(body==null||body==='')return {};
 if(typeof body!=='string')throw new BridgeError(415,'invalid_content_type','Send API requests as application/json.');
 if(body.length>36*1024*1024)throw new BridgeError(413,'request_too_large','Request body exceeds the size limit.');
 let value;try{value=JSON.parse(body);}catch{throw new BridgeError(400,'invalid_json','Request body must be valid JSON.');}
 if(!record(value))throw new BridgeError(400,'invalid_request','Request body must be a JSON object.');
 return value;
}
function headerOf(init,name){const headers=init?.headers;if(!headers)return null;if(typeof headers.get==='function')return headers.get(name);for(const [key,value]of Object.entries(headers))if(key.toLowerCase()===name.toLowerCase())return value;return null;}
async function route(path,query,method,init){
 const signal=init?.signal||null;
 if(method==='GET'||method==='HEAD'){
  if(path==='/api/status')return jsonResponse(status());
  if(path==='/api/tools')return jsonResponse({connected:embedded(),...tools()});
  if(path==='/api/workspace')return jsonResponse(workspaceContext());
  if(path==='/api/audio/ice')return jsonResponse(await audioIce(query));
  if(path==='/api/diagnostics/studio'){const d=bridgeDiagnostics();return jsonResponse({calls:d.calls,transport:d.transport,units:d.units,boundaries:d.boundaries});}
  if(path==='/api/diagnostics/client')return jsonResponse(bridgeDiagnostics().client);
  if(path.startsWith('/api/media/'))throw new BridgeError(404,'media_ticket_expired','This audio preview ticket is invalid or expired. Prepare the preview again.');
  if(path.startsWith('/api/auth/'))throw new BridgeError(410,'embedded_session','Freestyle Studio already signed you in; there is no separate connection.');
  throw new BridgeError(404,'not_found','Unknown API endpoint.');
 }
 if(method!=='POST')throw new BridgeError(405,'method_not_allowed','Unsupported method.');
 const payload=await readJson(init);
 switch(path){
  case '/api/workspace':return jsonResponse(workspaceContext(payload));
  case '/api/diagnostics/client':recordClientLog(payload);return jsonResponse({ok:true});
  case '/api/studio':{
   let request=payload;const conditional=headerOf(init,'If-None-Match');
   if(typeof conditional==='string'&&conditional&&!('ifNoneMatch' in request)&&etagConditionalRead(operations()[request.operationId]))request={...request,ifNoneMatch:conditional};
   const result=await studioCall(request,{signal});
   const headers={};for(const [key,value]of Object.entries(result.headers||{}))if(PASSTHROUGH_HEADERS.includes(key))headers[key]=value;
   if(result.binary)return new Response(result.binary,{status:result.status,headers:{'Content-Type':result.contentType,'Cache-Control':'no-store',...headers}});
   return jsonResponse(result.data,result.status,headers);
  }
  case '/api/audio/start':return jsonResponse(await audioStart(payload));
  case '/api/audio/offer':return jsonResponse(await audioOffer(payload,{signal}));
  case '/api/audio/ingest-offer':return jsonResponse(await audioIngestOffer(payload));
  case '/api/audio/editor':return jsonResponse(audioEditor(payload));
  case '/api/audio/plugin-chain':return jsonResponse(audioPluginChain(payload));
  case '/api/media/prepare':return jsonResponse(await prepareMedia(payload));
  case '/api/call':return jsonResponse(await bridgeCall(payload.name,payload.arguments??{},{idempotencyKey:payload.idempotencyKey??null,ifMatch:payload.ifMatch??null,priority:payload.priority==='background'?'background':null,signal}));
 }
 if(path.startsWith('/api/auth/'))throw new BridgeError(410,'embedded_session','Freestyle Studio already signed you in; there is no separate connection.');
 throw new BridgeError(404,'not_found','Unknown API endpoint.');
}
/** fetch()-compatible entry point for the studio's former local-bridge routes.
 * `/api/...` paths are answered in-page (via the host); anything else is a
 * plain fetch. Without a Freestyle host, everything is a plain fetch. */
export async function hostFetch(input,init={}){
 const raw=typeof input==='string'?input:input instanceof URL?input.href:input?.url;
 if(typeof raw!=='string'||!raw.startsWith('/api/')||!freestyleHost())return globalThis.fetch(input,init);
 const url=new URL(raw,'http://bridge.invalid'),path=decodeURIComponent(url.pathname),method=String(init?.method||'GET').toUpperCase();
 try{return await route(path,url.searchParams,method,init);}
 catch(error){
  if(error?.name==='AbortError')throw error;
  if(!(error instanceof BridgeError))console.warn('[illogic] bridge route failed',path,error);
  return errorResponse(error,path);
 }
}
