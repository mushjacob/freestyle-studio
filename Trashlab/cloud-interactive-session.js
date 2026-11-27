/** Freestyle's documented interactive WebSocket protocol. OAuth stays behind
 * call(); only the short-lived ticket enters the first WebSocket frame.
 * This adapter never generates audio, retries a command, or applies state diffs.
 */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=64;
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const epoch=value=>typeof value==='string'&&value.length>0||Number.isSafeInteger(value)&&value>=0;
const commandId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,64}$/.test(value);
const copy=value=>value===undefined?undefined:structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const transientCodes=new Set(['rate_limited','server_busy','engine_timeout','confirmation_required','stale_revision','invalid_revision','too_many_pending','gesture_in_progress','internal_error']);
const privateTickets=new WeakMap();
function stageFor(status){return({opening:'open-session',connecting:'websocket-connect',authenticating:'authenticate',ready:'session',resyncing:'resynchronize'})[status]||'session';}
function safeDiagnostic(value,tickets=new Set()){
 if(typeof value==='string'){let text=value;for(const ticket of tickets)if(ticket)text=text.split(ticket).join('[redacted ticket]');return text.replace(/\b(Bearer\s+)\S+/gi,'$1[redacted]').replace(/\b((?:session[_ -]?ticket|resume[_ -]?ticket|ticket|access_token|refresh_token|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi,'$1[redacted]');}
 if(Array.isArray(value))return value.map(item=>safeDiagnostic(item,tickets));
 if(record(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/^(?:session_ticket|resume_ticket|access_token|refresh_token|authorization)$/i.test(key)?'[redacted]':safeDiagnostic(item,tickets)]));
 return value;
}
function failure(message,fields={}){return Object.assign(new Error(message),{name:'InteractiveSessionError',sent:false,uncertain:false,fallbackAllowed:false,...fields});}
function json(value){
 return JSON.stringify(value,(key,item)=>{if(item===undefined||typeof item==='function'||typeof item==='symbol'||typeof item==='bigint'||typeof item==='number'&&!Number.isFinite(item))throw failure('Interactive frames require finite JSON values.',{code:'invalid_json'});return item;});
}
function unpack(result){
 let data=result?.structuredContent;
 if(data===undefined&&Array.isArray(result?.content))data=JSON.parse(result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'));
 data=data??result;const body=data?.response??data;
 if(result?.isError||data?.ok===false||data?.error||body?.ok===false||body?.error)throw failure(typeof body?.error==='string'?body.error:typeof data?.error==='string'?data.error:'Freestyle refused the interactive session.',{code:body?.code??data?.code,receipt:copy(body)});
 if(!record(body))throw failure('Freestyle returned no interactive session ticket.',{code:'invalid_session_receipt'});
 return body;
}
/** The socket must be credential-free and served by this Freestyle deployment
 * (freestyle.audio, or the stage/dev page origin that hosts the studio). */
function socketUrl(value,origin){
 let url;try{url=new URL(value);}catch{throw failure('Freestyle returned an invalid WebSocket endpoint.',{code:'invalid_websocket_url'});}
 let page=null;try{page=new URL(origin);}catch{}
 const loopback=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname),sameHost=url.hostname==='freestyle.audio'?!url.port||url.port==='443':loopback?!!page&&/^(localhost|127\.0\.0\.1|\[::1\])$/.test(page.hostname):!!page&&url.hostname===page.hostname&&url.port===page.port;
 if(!(url.protocol==='wss:'||url.protocol==='ws:'&&loopback)||!sameHost||url.username||url.password||url.search||url.hash)throw failure('The interactive endpoint must be credential-free WSS on this Freestyle origin.',{code:'invalid_websocket_url'});
 return url.href;
}

export class CloudInteractiveSession{
 constructor({call,origin=globalThis.location?.origin,WebSocket=globalThis.WebSocket,getScope=()=>null,onClock=()=>{},onSnapshot=()=>{},onPatch=()=>{},onResync=()=>{},onStatus=()=>{},commandTimeoutMs=15000,connectTimeoutMs=10000,setTimeout=(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout=id=>globalThis.clearTimeout(id),createId=()=>globalThis.crypto.randomUUID()}={}){
  if(typeof call!=='function'||typeof WebSocket!=='function')throw new TypeError('CloudInteractiveSession requires call and WebSocket.');
  const parsed=new URL(origin);if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==origin||origin.length>255)throw new TypeError('Pass the browser’s exact HTTP(S) origin.');
  if(!Number.isFinite(commandTimeoutMs)||commandTimeoutMs<=0||!Number.isFinite(connectTimeoutMs)||connectTimeoutMs<=0)throw new RangeError('Interactive timeouts must be finite and positive.');
  Object.assign(this,{call,origin,WebSocket,getScope,onClock,onSnapshot,onPatch,onResync,onStatus,commandTimeoutMs,connectTimeoutMs,setTimeout,clearTimeout,createId});
  this.generation=0;this.socket=null;this.connection=null;this.pending=new Map();this.records=new Map();this.revocations=new Map();this.state={status:'idle',projectId:null,trackId:null,sessionId:null,epoch:null,revision:null,limits:null,error:null,errorCode:null,errorStage:null,closeCode:null,reason:null,lastOutcome:null,clockSequence:null};
 }
 get ready(){return this.state.status==='ready'&&this.current();}
 get revision(){return this.state.revision;}
 get sessionId(){return this.state.sessionId;}
 snapshot(){return safeDiagnostic(copy({...this.state,ready:this.ready,pending:[...this.pending.values()].map(item=>({id:item.frame.id,action:item.frame.action,status:item.status})),generation:this.generation}),privateTickets.get(this.connection));}
 notify(){try{this.onStatus(this.snapshot());}catch{}}
 callback(name,value){try{this[name](copy(value));}catch(error){this.state.error='Interactive consumer callback failed.';this.notify();}}
 current(connection=this.connection){try{return !!connection&&!connection.ended&&connection.generation===this.generation&&same(connection.scope,this.getScope());}catch{return false;}}
 assertCurrent(){if(!this.current()){this.end(failure('The interactive project or engine context changed.',{code:'interactive_scope_changed'}));throw failure('The interactive project or engine context changed.',{code:'interactive_scope_changed'});}}
 cancelStale(connection){
  if(connection.generation!==this.generation||connection.ended)return false;
  this.end(failure('The interactive project or engine context changed.',{name:'AbortError',code:'interactive_scope_changed'}));
  this.revoke(connection.sessionId);return true;
 }
 send(frame){const text=json(frame);if(new TextEncoder().encode(text).length>65536)throw failure('Interactive frames must fit within 64 KiB.',{code:'frame_too_large'});this.socket.send(text);}
 connect({projectId,trackId,sessionId}={}){
  if(!identity(projectId)||trackId!==undefined&&!identity(trackId)||sessionId!==undefined&&!identity(sessionId))return Promise.reject(failure('Open an interactive session with exact project and optional context/session identities.',{code:'invalid_identity'}));
  const scope=copy(this.getScope()),key=json({projectId,...trackId?{trackId}:{},...sessionId?{sessionId}:{},scope});
  if(record(scope)&&(scope.projectId!==undefined&&scope.projectId!==projectId||trackId!==undefined&&scope.trackId!==undefined&&scope.trackId!==trackId))return Promise.reject(failure('The requested interactive identity does not match the current context.',{code:'interactive_scope_changed'}));
  if(this.connection?.key===key&&this.current()&&['opening','connecting','authenticating','ready','resyncing'].includes(this.state.status))return this.connection.promise;
  const previous=this.state.sessionId;if(this.connection)this.end(failure('A newer interactive connection superseded this one.',{code:'interactive_superseded'}));
  if(previous&&previous!==sessionId)this.revoke(previous);
  const generation=++this.generation,connection={generation,scope,key,sessionId:null,requestedSessionId:sessionId,previousSessionId:previous,resync:null,finished:false,ended:false};this.connection=connection;
  this.state={...this.state,status:'opening',projectId,trackId:trackId??null,sessionId:null,epoch:null,revision:null,limits:null,error:null,errorCode:null,errorStage:null,closeCode:null,reason:null,clockSequence:null};
  connection.promise=new Promise((resolve,reject)=>{connection.resolve=resolve;connection.reject=reject;});this.notify();
  (async()=>{
   try{
    const receipt=unpack(await this.call('open_interactive_session',{project_id:projectId,...trackId?{track_id:trackId}:{},origin:this.origin,mode:'auto',...sessionId?{session_id:sessionId}:{}}));
    if(!identity(receipt.session_id)||typeof receipt.session_ticket!=='string'||!receipt.session_ticket)throw failure('Freestyle returned incomplete interactive session credentials.',{code:'invalid_session_receipt'});
    connection.sessionId=receipt.session_id;
    privateTickets.set(connection,new Set([receipt.session_ticket]));
    if(!this.current(connection)){if(this.connection?.requestedSessionId!==receipt.session_id)this.revoke(receipt.session_id);throw failure('The interactive session opened for a superseded context.',{name:'AbortError',code:'interactive_scope_changed'});}
    const url=socketUrl(receipt.websocket_url,this.origin);if(connection.previousSessionId!==receipt.session_id)this.records.clear();
    this.state.sessionId=receipt.session_id;this.state.limits=copy(receipt.limits??null);this.state.status='connecting';
    const socket=new this.WebSocket(url);this.socket=connection.socket=socket;let ticket=receipt.session_ticket;
    connection.timer=this.setTimeout(()=>{if(connection.generation!==this.generation||connection.ended)return;if(!this.current(connection))this.cancelStale(connection);else if(this.state.status!=='ready')this.end(failure('Interactive authentication timed out.',{code:'interactive_connect_timeout'}));},this.connectTimeoutMs);
    socket.onopen=()=>{if(!this.current(connection)){ticket=null;if(!this.cancelStale(connection))try{socket.close();}catch{}return;}try{this.state.status='authenticating';this.send({type:'auth',ticket,snapshot:false});ticket=null;this.notify();}catch(error){ticket=null;this.end(error);}};
    socket.onmessage=event=>{if(!this.current(connection)){this.cancelStale(connection);return;}this.receive(event.data,connection);};
    socket.onerror=()=>{if(this.current(connection)){this.state.error='Interactive socket connection failed.';this.state.errorCode='websocket_error';this.state.errorStage=stageFor(this.state.status);this.notify();}};
    socket.onclose=event=>{if(!this.current(connection)){this.cancelStale(connection);return;}this.end(failure('Interactive socket closed.',{code:'interactive_disconnected',closeCode:event.code,reason:event.reason}),{status:'disconnected'});};
    this.notify();
   }catch(error){
    if(connection.generation===this.generation){this.end(error,{status:'error'});if(connection.sessionId)this.revoke(connection.sessionId);}
    else if(!connection.finished){connection.finished=true;connection.reject(error);}
   }
  })();
  return connection.promise;
 }
 revoke(sessionId){if(!identity(sessionId))return Promise.resolve();if(this.revocations.has(sessionId))return this.revocations.get(sessionId);const pending=Promise.resolve().then(()=>this.call('close_interactive_session',{session_id:sessionId})).catch(()=>{});this.revocations.set(sessionId,pending);return pending;}
 receive(data,connection){
  let frame;try{if(typeof data!=='string'||new TextEncoder().encode(data).length>65536)throw new Error();frame=JSON.parse(data);if(!record(frame)||typeof frame.type!=='string')throw new Error();}catch{this.end(failure('Freestyle sent an invalid interactive frame.',{code:'invalid_server_frame'}));return;}
  if(frame.type==='welcome'){
   if(!epoch(frame.epoch)||!revision(frame.revision)){this.end(failure('The interactive welcome has no valid epoch/revision.',{code:'invalid_welcome'}));return;}
   this.state.epoch=frame.epoch;this.state.revision=frame.revision;this.state.limits=copy(frame.limits??this.state.limits);this.state.status='ready';this.state.error=this.state.errorCode=this.state.errorStage=this.state.closeCode=this.state.reason=null;this.clearTimeout(connection.timer);connection.timer=null;
   if(!connection.finished){connection.finished=true;connection.resolve(this.snapshot());}this.notify();return;
  }
  if(this.state.epoch===null){this.end(failure('Interactive data arrived before welcome.',{code:'protocol_order'}));return;}
  if(frame.type==='transport_clock'){
   if(!revision(frame.seq)||!Number.isFinite(frame.sample_frame)||frame.sample_frame<0||!Number.isFinite(frame.sample_rate)||frame.sample_rate<=0)return;
   if(this.state.clockSequence!==null&&frame.seq<=this.state.clockSequence)return;this.state.clockSequence=frame.seq;this.callback('onClock',frame);return;
  }
  if(frame.type==='snapshot'){
   if(!epoch(frame.epoch)||!revision(frame.revision)){this.end(failure('Interactive snapshot revision is invalid.',{code:'invalid_snapshot'}));return;}
   const previous=this.state.revision,oldEpoch=this.state.epoch;this.state.epoch=frame.epoch;this.state.revision=frame.revision;connection.resync=null;this.state.status='ready';this.callback('onSnapshot',frame);
   if(oldEpoch===frame.epoch&&previous>frame.revision)this.resubscribe({epoch:frame.epoch,revision:previous},connection);this.notify();return;
  }
  if(frame.type==='state_patch'||frame.type==='resync_required'){
   if(!epoch(frame.epoch)||!revision(frame.from_revision)||frame.revision!==frame.from_revision+1){this.end(failure('Interactive patch revision is invalid.',{code:'invalid_patch'}));return;}
   if(frame.epoch!==this.state.epoch||frame.from_revision>this.state.revision){this.resubscribe(frame,connection);return;}
   if(frame.revision<=this.state.revision)return;
   this.state.revision=frame.revision;
   this.callback(frame.type==='state_patch'?'onPatch':'onResync',frame);
   if(connection.resync&&connection.resync.epoch===frame.epoch&&frame.revision>=connection.resync.revision){connection.resync=null;this.state.status='ready';}this.notify();return;
  }
  if(frame.type==='ack'||frame.type==='reject'){
   const item=this.records.get(frame.id);if(!item)return;
   if(frame.type==='ack'&&frame.status==='applied'&&(!revision(frame.revision)||!Object.hasOwn(frame,'result'))||frame.type==='ack'&&frame.status==='coalesced'&&!commandId(frame.into)){this.end(failure('The interactive acknowledgement is incomplete.',{code:'invalid_ack'}));return;}
   if(revision(frame.revision)&&frame.revision>this.state.revision)this.resubscribe({epoch:this.state.epoch,revision:frame.revision},connection);
   if(item.settled){if(item.outcome?.uncertain){item.lateReceipt=copy(frame);this.state.lastOutcome=safeDiagnostic({id:frame.id,status:'late_receipt',receipt:copy(frame)},privateTickets.get(connection));this.notify();}return;}
   if(frame.type==='reject'){
    const transient=transientCodes.has(frame.code)||/_timeout$|_unavailable$|_busy$/.test(frame.code||'')||frame.retry_after_ms!==undefined;
    const uncertain=frame.code==='engine_timeout'||/_timeout$/.test(frame.code||'')||frame.code==='internal_error';
    this.settle(item,failure(typeof frame.error==='string'?frame.error:'Freestyle rejected the interactive command.',{code:frame.code||'command_rejected',sent:true,uncertain,transient,final:!transient,receipt:copy(frame)}));return;
   }
   item.status=frame.status;
   if(frame.status==='pending'||frame.status==='accepted'&&!['begin','update'].includes(item.frame.gesture?.phase)){this.notify();return;}
   if(!['applied','accepted','coalesced'].includes(frame.status)){this.end(failure('Unknown interactive acknowledgement status.',{code:'invalid_ack'}));return;}
   this.settle(item,null,{...frame,committed:frame.status==='applied'});return;
  }
  if(frame.type==='session_closed'){this.end(failure('Freestyle closed the interactive session.',{code:'session_closed',reason:frame.reason}),{status:'closed'});return;}
  if(frame.type==='renewed'){if(typeof frame.resume_ticket==='string')privateTickets.get(connection)?.add(frame.resume_ticket);this.callback('onStatus',{...this.snapshot(),event:'renewed'});}
  else if(frame.type==='pong'||frame.type==='gesture_committed')this.callback('onStatus',{...this.snapshot(),event:frame.type,receipt:safeDiagnostic(frame,privateTickets.get(connection))});
 }
 resubscribe(frame,connection){
  if(!connection.resync){connection.resync={epoch:frame.epoch,revision:frame.revision};this.state.status='resyncing';try{this.send({type:'resubscribe',epoch:this.state.epoch,since_revision:this.state.revision});}catch(error){this.end(error);return;}this.callback('onResync',{type:'client_revision_gap',epoch:this.state.epoch,revision:this.state.revision,observed_epoch:frame.epoch,observed_revision:frame.revision});}
  else if(connection.resync.epoch===frame.epoch)connection.resync.revision=Math.max(connection.resync.revision,frame.revision);
  this.notify();
 }
 command(action,args={},options={}){
  try{
   this.assertCurrent();if(!this.ready)throw failure('Interactive session is not ready.',{code:'interactive_unavailable',fallbackAllowed:true});
   if(typeof action!=='string'||!action||!record(args)||!record(options))throw failure('An interactive command requires a named action and object arguments.',{code:'invalid_command'});
   for(const key of Object.keys(options))if(!['id','base_revision','require_base','confirmed_destructive','gesture'].includes(key))throw failure('Unsupported interactive command option.',{code:'invalid_command'});
   const id=options.id??this.createId();if(!commandId(id))throw failure('Interactive command IDs must be 1–64 safe characters.',{code:'invalid_command_id'});
   if(options.base_revision!==undefined&&!revision(options.base_revision)||options.require_base!==undefined&&typeof options.require_base!=='boolean'||options.confirmed_destructive!==undefined&&typeof options.confirmed_destructive!=='boolean')throw failure('Interactive revision and confirmation options are invalid.',{code:'invalid_command'});
   if(options.gesture!==undefined&&(!record(options.gesture)||!commandId(options.gesture.id)||!['begin','update','end'].includes(options.gesture.phase)||Object.keys(options.gesture).some(key=>!['id','phase'].includes(key))))throw failure('Interactive gesture metadata is invalid.',{code:'invalid_gesture'});
   const frame={type:'command',id,action,arguments:copy(args),...options};const serialized=json(frame);if(new TextEncoder().encode(serialized).length>65536)throw failure('Interactive frames must fit within 64 KiB.',{code:'frame_too_large'});const old=this.records.get(id);
   if(old){if(!same(old.frame,frame))throw failure('An interactive command ID cannot be reused for different arguments.',{code:'command_id_conflict'});return old.promise;}
   const item={frame,status:'sent',settled:false};item.promise=new Promise((resolve,reject)=>{item.resolve=resolve;item.reject=reject;});this.records.set(id,item);this.pending.set(id,item);
   while(this.records.size>1024){const entry=[...this.records].find(([,value])=>value.settled&&!value.outcome?.uncertain);if(!entry)break;this.records.delete(entry[0]);}
   item.timer=this.setTimeout(()=>this.settle(item,failure('Interactive command acknowledgement timed out. Inspect canonical state; the command was not retried.',{code:'interactive_command_timeout',sent:true,uncertain:true})),this.commandTimeoutMs);
   try{this.send(frame);}catch(error){this.settle(item,failure('Interactive send failed; execution is uncertain.',{code:'interactive_send_failed',sent:true,uncertain:true,cause:error}));return item.promise;}
   this.notify();return item.promise;
  }catch(error){return Promise.reject(error);}
 }
 settle(item,error,result){
  if(item.settled)return;item.settled=true;this.clearTimeout(item.timer);this.pending.delete(item.frame.id);item.outcome=error?{id:item.frame.id,status:error.uncertain?'uncertain':'rejected',uncertain:error.uncertain,receipt:copy(error.receipt),code:error.code}:copy(result);this.state.lastOutcome=safeDiagnostic(copy(item.outcome),privateTickets.get(this.connection));
  if(error){this.state.error=safeDiagnostic(String(error.message||'Interactive command failed.'),privateTickets.get(this.connection)).slice(0,300);this.state.errorCode=safeDiagnostic(String(error.code||'interactive_command_failed'),privateTickets.get(this.connection)).slice(0,80);this.state.errorStage='command';}
  if(error)item.reject(error);else item.resolve(copy(result));this.notify();
 }
 end(error,{status='closed'}={}){
  const connection=this.connection;if(!connection||connection.ended)return;const errorStage=error.errorStage||stageFor(this.state.status);connection.ended=true;this.clearTimeout(connection.timer);
  if(connection.socket){connection.socket.onopen=connection.socket.onmessage=connection.socket.onclose=connection.socket.onerror=null;try{connection.socket.close();}catch{}}
  for(const item of this.pending.values())this.settle(item,failure(error.message,{code:error.code||'interactive_disconnected',sent:true,uncertain:true}));
  if(!connection.finished){connection.finished=true;connection.reject(error);}this.state.status=status;this.state.error=safeDiagnostic(String(error.message||'Interactive session failed.'),privateTickets.get(connection)).slice(0,300);this.state.errorCode=safeDiagnostic(String(error.code||'interactive_failure'),privateTickets.get(connection)).slice(0,80);this.state.errorStage=errorStage;this.state.closeCode=Number.isInteger(error.closeCode)?error.closeCode:null;this.state.reason=typeof error.reason==='string'?safeDiagnostic(error.reason,privateTickets.get(connection)).slice(0,160):null;this.socket=null;this.notify();
 }
 close(){
  const sessionId=this.state.sessionId??this.connection?.sessionId;
  if(this.socket&&this.current())try{this.send({type:'close'});}catch{}
  this.end(failure('Interactive session closed.',{code:'interactive_closed'}));++this.generation;this.connection=null;this.state.status='closed';this.notify();return this.revoke(sessionId);
 }
}
