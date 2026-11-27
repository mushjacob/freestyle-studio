/** UI-facing cloud controller. Every sound and project mutation is handled by Freestyle. */
import {CloudSession,assertCompletePattern,cloudOperationError,hasCanonicalTruncation} from './cloud-session.js';
import {assertPreviewScheduled,previewScheduleStatus,patternPreviewPosition} from './preview-clock.js';
import {CloudMonitor} from './cloud-monitor.js';
import {PlayheadSmoother} from './playhead-smoother.js';
import {PatternPreviewArm} from './cloud-pattern-arm.js';
import {CloudSampleAudition} from './cloud-sample-audition.js';
import {MixerMeterFeed} from './mixer-meter-frame.js';
import {CloudRecorder} from './cloud-recorder.js';
import {CloudLiveIngest} from './cloud-live-ingest.js';
import {CloudTransport} from './cloud-transport.js';
import {CloudMetronomeController} from './cloud-metronome.js';
import {CloudRecordingPersistence} from './cloud-recording-persistence.js';
import {placeTake,confirmSaved} from './recording-finalize.js';
import {CloudInteractiveSession} from './cloud-interactive-session.js';
import {CloudPatternHistory} from './cloud-pattern-history.js';
import {rebaseLocalEdits,editTargetsUnchanged} from './cloud-edit-rebase.js';
import {CloudInstrumentAudition} from './cloud-instrument-audition.js';
import {assertStudioApiFeature} from './studio-api-features.js';
import {studioCompatibleRequest} from './studio-api-bridge.js';
import {StudioApiClient} from './studio-api-client.js';
import {resyncEngineSession,reloadScopeTrack} from './cloud-engine-reload.js';
import {clientLog} from './client-diagnostics.js';
import {CloudLiveControl,liveLaneGainMessage,liveLaneToggleMessage} from './cloud-live-control.js';
import {hostFetch,freestyleOrigin,freestyleHost} from './freestyle-host-transport.js';
const clone=v=>JSON.parse(JSON.stringify(v));
// Short coalescing window for saved edits; the local model is already updated.
export const EDIT_COALESCE_MS=120;
function unpack(result){const d=result.structuredContent||JSON.parse((result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')||'{}');if(result.isError||d.ok===false||d.error)throw new Error(d.error||d.message||'Cloud operation failed.');return d.response||d;}
async function api(name,args){const r=await hostFetch('/api/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})});const d=await r.json();if(!r.ok)throw new Error(d.detail||d.error);return unpack(d);}
function patternPreviewOptions({patternLoop=true,preview={}}={}){
 if(typeof patternLoop!=='boolean'||!preview||typeof preview!=='object'||Array.isArray(preview))throw new TypeError('Pattern preview options require a looping flag and an options object.');
 const allowed=new Set(['repeat_count','gain','phase_offset_sec','lead_sec','swing']);
 for(const [key,value]of Object.entries(preview))if(!allowed.has(key)||typeof value!=='number'||!Number.isFinite(value))throw new TypeError('Pattern preview options must use supported finite numeric scheduling fields.');
 const repeats=preview.repeat_count??(patternLoop?64:1);if(!Number.isInteger(repeats)||repeats<1||repeats>64)throw new RangeError('Pattern preview repeats must be an integer between one and64.');
 if(preview.gain<0||preview.lead_sec<0)throw new RangeError('Pattern preview gain and scheduling lead must be nonnegative.');
 return {...preview,repeat_count:repeats};
}
// CloudTransport returns a native status directly or the authoritative HTTP
// acknowledgement under result. Match CloudSession's declared status shapes;
// an unrelated cached clock must not decide whether this Play was applied.
function stoppedPlayReceipt(receipt){
 const result=receipt?.route==='data-channel'?receipt:receipt?.result??receipt;
 const status=result?.status&&typeof result.status==='object'?result.status:result?.ack?.status||result?.clock||result;
 return status?.is_playing===false||status?.isPlaying===false;
}
function previewFailureReceipt(error){const result=error?.result?.response??error?.result;return result&&typeof result==='object'&&['sample_errors','complete','scheduled_sample_clips','scheduled_midi_notes','scheduled_midi_messages'].some(key=>Object.hasOwn(result,key))?result:null;}
const cloudScope=engine=>({projectId:engine.projectId,contextTrackId:engine.session.trackId,loadVersion:engine.loadVersion||0,contextVersion:engine.session.contextVersion||0});
const currentCloudScope=(engine,scope)=>engine.ready&&!engine.loading&&engine.projectId===scope.projectId&&engine.session.projectId===scope.projectId&&engine.session.trackId===scope.contextTrackId&&(engine.loadVersion||0)===scope.loadVersion&&(engine.session.contextVersion||0)===scope.contextVersion;
function requireCloudScope(engine,scope){if(!scope.projectId||!scope.contextTrackId||!currentCloudScope(engine,scope))throw Object.assign(new Error('The cloud project or engine context changed during this operation.'),{name:'AbortError',code:'cloud_scope_changed'});}
function sessionTransportKnown(engine,position){
 if(position?.transportKnown===true||typeof position?.clockSource==='string'&&position.clockSource&&position.clockSource!=='none')return true;
 // Older non-REST sessions did not publish observation metadata.
 return engine.session.rawState?.studioApi!==true&&engine.project?.cloud?.rawState?.studioApi!==true&&position?.transportKnown===undefined&&position?.clockSource===undefined&&typeof position?.playing==='boolean';
}
function sessionLoopKnown(engine,position){const t=engine.session.rawState?.transport;return position?.clockSource!=='ack'&&typeof t?.loop_enabled==='boolean'&&typeof t.loop_start_sec==='number'&&Number.isFinite(t.loop_start_sec)&&t.loop_start_sec>=0&&typeof t.loop_end_sec==='number'&&Number.isFinite(t.loop_end_sec)&&t.loop_end_sec>=t.loop_start_sec;}
/** Same complete canonical proof used for default REST read/action elision.
 * Monitoring track_id is optional session scope, never an ingest destination.
 */
function verifiedDefaultMonitorContext(engine,scope){
 const saved=engine.session.rawProject,metadata=saved?._studioApi;
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||saved.id!==scope.projectId||metadata.projectId!=null&&metadata.projectId!==scope.projectId||!Array.isArray(saved.clips)||hasCanonicalTruncation(saved.clips)||saved.truncated?.clips===true||saved.clipsTruncated===true||saved.clips_truncated===true)return false;
 if(saved.clips.some(clip=>!clip||typeof clip.id!=='string'||!clip.id||clip.deleted!=null&&typeof clip.deleted!=='boolean'||clip.isBacking!=null&&typeof clip.isBacking!=='boolean'))return false;
 return saved.clips.find(clip=>!clip.deleted&&!clip.isBacking)?.id===scope.contextTrackId;
}
const unconfirmedTransport=cause=>Object.assign(new Error(`Freestyle has not confirmed the current transport state.${cause?.message?' '+cause.message:''}`,{cause}),{code:'transport_state_unconfirmed'});
export class CloudEngine{
 constructor({session=new CloudSession(),monitor=new CloudMonitor(),interactiveOptions={}}={}){this.session=session;this.monitor=monitor;this.liveControl=new CloudLiveControl({monitor,getProjectId:()=>this.projectId});this.historyPending=false;this.onPatternHistory=()=>{};this.patternHistory=new CloudPatternHistory({engine:this,onChange:state=>this.onPatternHistory(state)});this.liveIngest=new CloudLiveIngest({call:(name,args)=>this.session.call(name,args),publicContract:()=>this.session.rawState?.studioApi===true,getContext:()=>({projectId:this.projectId,trackId:this.session.trackId,loadVersion:this.loadVersion||0,contextVersion:this.session.contextVersion||0,ready:this.ready&&!this.loading})});this.recorder=new CloudRecorder({offerIngest:this.liveIngest.offerIngest,closeIngest:this.liveIngest.closeIngest});this.heldNotes=new Map();this.ready=false;this.projectId='';this.playing=false;this.beat=0;this.mode='song';this.snapshot=null;this.pending=null;this.applying=false;this.onProject=()=>{};this.onTick=()=>{};this.onError=()=>{};this.onStatus=()=>{};this.onEditSettled=()=>{};this.onEnded=()=>{};this.levels=new Map();this.meterFeed=new MixerMeterFeed();this.monitor.addEventListener('meters',e=>{const d=e.detail;this.acceptMeterFrame(d);if(d.master!=null)this.levels.set('master',Number(d.master)||0);for(const t of d.tracks||[]){if(Array.isArray(t)){this.levels.set(String(t[0]),Number(t[2])||0);if(t[1])this.levels.set(String(t[1]),Number(t[2])||0);}else this.levels.set(String(t.lane_id||t.track_id||t.id),Number(t.post_fader_peak??t.peak??t.level)||0);}for(const [id,value]of Object.entries(d.buses||{}))this.levels.set(id,Number(value)||0);});
 this.session.addEventListener('pattern-history-barrier',e=>this.patternHistory.invalidate(e.detail?.reason||'That direct pattern write is outside retained pattern history.',{force:true}));
 this.session.addEventListener('state',e=>{if(this.interactiveRefreshNeeded&&e.detail.interactiveGeneration===this.interactive?.generation&&e.detail.interactiveRevision===this.interactive?.revision)this.interactiveRefreshNeeded=false;this.playing=this.previewing?this.positionAt().playing:this.session.playing;if(!this.loading&&!this.applying&&!this.pending&&!this.interacting)this.accept(e.detail.project);});
 this.session.addEventListener('tick',e=>{const position=this.positionAt();this.playing=position.playing;if(position.beat!=null)this.beat=position.beat;this.onTick({...e.detail,...position,step:position.beat==null?-1:Math.floor(position.beat*4),mode:this.mode});if(this.interactiveRefreshNeeded)this.scheduleInteractiveRefresh();});
 this.session.addEventListener('error',e=>this.onStatus(e.detail.message));
 this.session.addEventListener('clip-batch-reload-required',e=>this.clipBatchReloadRequired(e.detail));
 this.monitor.addEventListener('error',e=>this.onStatus(e.detail.message||'Cloud audio monitor failed.'));
 this.transportControl=new CloudTransport({monitor:this.monitor,getProjectId:()=>this.projectId,onEvent:(type,detail)=>clientLog('transport-'+type,detail),fallback:(command,options,context)=>this.session.transport(command,options,{projectId:context.projectId})});
 this.transportClockInspection=null;this.transportClockRead=null;
 this.monitor.addEventListener('clock',e=>{if(!this.ready||this.loading||e.detail?.project_id!==this.projectId)return;this.session.acceptClock?.(e.detail,{generation:this.monitor.generation});});
 // 338: an engine ack of our realtime set_track_* echoes mix_revision; the mix tracker adopts it (no getEngineMix read).
 this.monitor.addEventListener('control',e=>{if(!this.ready||this.loading)return;try{const ack=this.liveControl.acknowledge(e.detail);if(ack&&ack.projectId===this.projectId)this.session.mixRevision?.noteRealtimeAck?.(ack);}catch{}});
 this.onMetronome=()=>{};
 const metronomeContext=()=>({projectId:this.projectId,trackId:this.session.trackId,epoch:{loadVersion:this.loadVersion||0,contextVersion:this.session.contextVersion||0}});
 this.metronome=new CloudMetronomeController({
  getContext:metronomeContext,
  getActualState:()=>this.ready&&this.session.projectId===this.projectId&&typeof this.session.rawState?.transport?.metronome==='boolean'?this.session.rawState.transport.metronome:null,
  guard:()=>{if(!this.ready||this.loading||this.interacting||this.session.projectId!==this.projectId)throw new Error('Finish the current edit and load a Freestyle project before changing its metronome.');},
  flush:()=>this.flush(),
  cloudCall:(name,args)=>name==='execute_pro_action'?this.session.action(args.action,args.arguments,{refresh:false,expectedContext:{projectId:args.project_id,trackId:args.track_id,contextVersion:this.session.contextVersion||0}}):this.session.call(name,args),
  // The metronome boolean of this read is taken from the read itself (session.metronomeObserved), not from
  // explicitClock: a newer pushed clock makes the read's position stale and explicitClock is then left alone.
  readActualState:async context=>{const previous=this.session.metronomeObserved;await this.session.refreshTransportClock({projectId:context.projectId,trackId:context.trackId});const seen=this.session.metronomeObserved,fresh=!!seen&&seen!==previous&&seen.projectId===context.projectId&&seen.trackId===context.trackId;return{value:fresh&&typeof seen.value==='boolean'?seen.value:null,fresh,context};},
  subscribeActualState:listener=>{const handler=e=>{if(this.ready&&!this.loading)listener({value:e.detail.metronome,fresh:e.detail.metronomeFresh===true,context:metronomeContext()});};this.session.addEventListener('transport',handler);return()=>this.session.removeEventListener('transport',handler);},
  onChange:state=>{if(typeof state.actual==='boolean'&&this.ready&&!this.loading){if(this.snapshot)this.snapshot.metronome=state.actual;if(this.project)this.project.metronome=state.actual;}this.onMetronome(state);}
 });
 this.interactive=null;this.onInteractive=()=>{};this.canInteractiveRefresh=()=>true;this.interactiveLoadVersion=0;
 const origin=interactiveOptions?.origin??freestyleOrigin(),Socket=interactiveOptions?.WebSocket??globalThis.WebSocket;
 if(interactiveOptions!==false&&origin&&typeof Socket==='function'){
  this.interactive=new CloudInteractiveSession({...interactiveOptions,origin,WebSocket:Socket,call:(name,args)=>this.session.call(name,args),getScope:()=>this.interactiveScope(),
   onClock:frame=>{if(this.ready&&!this.loading&&this.projectId===this.session.projectId)this.session.acceptInteractiveClock?.(frame,{projectId:this.projectId,trackId:this.session.trackId,generation:this.interactive.generation});},
   onPatch:()=>this.scheduleInteractiveRefresh(true),onSnapshot:()=>this.scheduleInteractiveRefresh(true),onResync:()=>this.scheduleInteractiveRefresh(true),onStatus:state=>this.onInteractive(state)});
  this.session.interactive=this.interactive;
 }
 }
 interactiveScope(){return{projectId:this.projectId,trackId:this.session.trackId,loadVersion:this.interactiveLoadVersion,contextVersion:this.session.contextVersion||0};}
 connectInteractive(){
  if(!this.interactive||!this.ready||this.loading||!this.projectId||!this.session.trackId)return Promise.resolve(null);this.interactiveLoadVersion=this.loadVersion||0;const scope=JSON.stringify(this.interactiveScope());this.interactiveConnectError=null;
  return this.interactive.connect({projectId:this.projectId,trackId:this.session.trackId}).catch(error=>{if(this.ready&&scope===JSON.stringify(this.interactiveScope())){const state=this.interactive.snapshot();this.interactiveConnectError={message:state.error||'Interactive connection failed.',code:state.errorCode||'interactive_connect_failed',stage:state.errorStage||'open-session',closeCode:state.closeCode,reason:state.reason};try{this.onInteractive({...state,connectError:structuredClone(this.interactiveConnectError)});}catch{}}throw error;});
 }
 scheduleInteractiveRefresh(changed=false){
  if(changed){this.interactiveRefreshNeeded=true;this.interactiveRefreshScope=JSON.stringify(this.interactiveScope());}
  if(!this.interactiveRefreshNeeded||this.interactiveRefreshTimer||this.interactiveRefreshing)return;
  this.interactiveRefreshTimer=setTimeout(()=>{this.interactiveRefreshTimer=null;this.refreshInteractiveState().catch(error=>{if(error?.name!=='AbortError')this.onStatus('Interactive state refresh unavailable; use Reload to inspect the project.');});},80);
 }
 interactiveIdle(){return this.ready&&!this.loading&&!this.session.closed&&!this.applying&&!this.pending&&!this.inFlight&&!this.interacting&&!this.session.actionPending&&this.canInteractiveRefresh();}
 async refreshInteractiveState(){
  if(!this.interactiveRefreshNeeded||this.interactiveRefreshing||!this.interactiveIdle())return false;
  const scope=this.interactiveRefreshScope;if(scope!==JSON.stringify(this.interactiveScope())){this.interactiveRefreshNeeded=false;return false;}
  this.interactiveRefreshing=true;
  try{await this.session.queue;if(!this.interactiveIdle()||scope!==JSON.stringify(this.interactiveScope()))return false;
   // Background priority: the proxy's background read slots, and any user call aborts it.
   if(typeof this.session.backgroundRefresh==='function')await this.session.backgroundRefresh();else await this.session.refresh();return true;}
  catch(error){
   // Preempted by a user request: still needed; the next idle tick runs it again.
   if(error?.code==='background_read_preempted'){this.interactiveRefreshNeeded=true;return false;}
   this.interactiveRefreshNeeded=false;throw error;}finally{this.interactiveRefreshing=false;}
 }
 toggleMetronome(){return this.metronome.toggle();}
 ensureTransportKnown({loop=false}={}){
  const scope=cloudScope(this),key=JSON.stringify(scope);try{requireCloudScope(this,scope);}catch(error){return Promise.reject(error);}
  const confirmed=()=>{requireCloudScope(this,scope);const position=this.session.positionAt?.();if(!sessionTransportKnown(this,position)||loop&&!sessionLoopKnown(this,position))throw unconfirmedTransport();return position;};
  try{return Promise.resolve(confirmed());}catch(error){if(error.code!=='transport_state_unconfirmed')return Promise.reject(error);}
  let read=this.transportClockRead;
  if(!read||read.key!==key){
   const record={scope:{...scope},status:'pending',error:null},request={key,record,promise:null};this.transportClockInspection=record;this.transportClockRead=request;read=request;
   request.promise=(async()=>{
    try{
     requireCloudScope(this,scope);if(typeof this.session.refreshTransportClock!=='function')throw new Error('An explicit transport-clock read is unavailable.');
     await this.session.refreshTransportClock({projectId:scope.projectId,trackId:scope.contextTrackId});requireCloudScope(this,scope);
     const position=this.session.positionAt?.();if(!sessionTransportKnown(this,position))throw unconfirmedTransport();
     record.status='confirmed';const display=this.previewing?this.positionAt():position;this.playing=display.playing;if(Number.isFinite(display.beat))this.beat=display.beat;
     this.onTick({...display,step:Number.isFinite(display.beat)?Math.floor(display.beat*4):-1,mode:this.mode});return position;
    }catch(error){
     try{requireCloudScope(this,scope);}catch(stale){record.status='stale';record.error={code:stale.code,message:stale.message};throw stale;}
     const failure=error.code==='transport_state_unconfirmed'?error:unconfirmedTransport(error);record.status='failed';record.error={code:failure.code,message:failure.message};throw failure;
    }finally{if(this.transportClockRead===request)this.transportClockRead=null;}
   })();
  }
  return read.promise.then(()=>{try{return confirmed();}catch(error){if(error.code==='transport_state_unconfirmed'){read.record.status='failed';read.record.error={code:error.code,message:error.message};}throw error;}});
 }
 accept(p){this._patternArm?.schedule('project-accepted');this._sampleAudition?.prewarmSoon();this.localBase=null;this.rebaseIds=null;this.patternHistory.observe(p);if(this.selectedPattern&&p.patterns.some(x=>x.id===this.selectedPattern))p.selectedPattern=this.selectedPattern;this.snapshot=clone(p);this.project=p;this.sampleRate=p.cloud?.rawState?.transport?.sample_rate||48000;this.metronome?.syncActual?.();this.onProject(clone(p));}
 applyPatternSplitReceipt(payload,{projectId=this.projectId,trackId=this.session.trackId,loadVersion=this.loadVersion||0,contextVersion=this.session.contextVersion||0,...scope}={}){
  if(!this.ready||this.loading||this.applying||this.pending||this.projectId!==projectId||this.session.trackId!==trackId||(this.loadVersion||0)!==loadVersion)throw new Error('The cloud project changed or has pending edits; reload its committed pattern receipt.');
  const project=this.session.applyPatternSplitReceipt(payload,{...scope,projectId,trackId,contextVersion});
  if(this.project!==project)this.accept(project);return project;
 }
 load(projectId,trackId){return this.transitionProject(()=>this.performLoad(projectId,trackId));}
 transitionProject(load){
  if(this.recordingContext||this.recorder.recording||['connecting','stopping'].includes(this.recorder.state))return Promise.reject(new Error('Stop recording and finish saving the take before changing cloud projects.'));
  this.cancelPendingPlay('The cloud project is changing.','transport_scope_changed');
  const version=(this.loadVersion||0)+1;this.loadVersion=version;
  this.loadQueue=(this.loadQueue||Promise.resolve()).catch(()=>{}).then(async()=>{
   if(version!==this.loadVersion)return null;this.loading=true;
   try{
    if(this.interacting)throw new Error('Finish the current edit before changing cloud projects.');
    // Keep the old project ready until every debounced write has settled.
    await this.flush();await this.session.queue;
    if(version!==this.loadVersion)return null;
    return await load();
   }finally{if(version===this.loadVersion){this.loading=false;this.onEditSettled();try{this.onProjectLoaded?.();}catch{}if(this.ready){this.prewarmMonitor();this.patternArm.attach();this.patternArm.schedule('project-loaded');this.sampleAudition.attach();this.connectInteractive().catch(()=>{});const saved=this.session.rawProject;if(this.session.rawState?.studioApi===true&&saved?.id===this.projectId&&saved?._studioApi?.projectId===this.projectId&&!sessionTransportKnown(this,this.session.positionAt?.()))this.ensureTransportKnown().catch(()=>{});}}}
  });
  return this.loadQueue;
 }
 async performLoad(projectId,trackId,{createTitle}={}){
  this.onStatus(createTitle!==undefined?'Creating a Freestyle cloud project…':'Loading Freestyle cloud session…');clearTimeout(this.timer);this.timer=null;
  const previous={ready:this.ready,projectId:this.projectId,playing:this.playing,previewing:this.previewing,beat:this.beat,selectedPattern:this.selectedPattern,project:this.project,snapshot:this.snapshot};
  const context={};for(const key of ['projectId','trackId','project','rawProject','rawState','playing','positionSeconds','positionObserved','closed','liveClock','interactiveClock','explicitClock','transportVersion','transportObservationVersion','loopIterations','loopEnabled','loopStartSec','loopEndSec','clockSource','transportBpm','producerLagSec','lastTransportAppliedAt','transportGuard'])context[key]=this.session[key];
  this.ready=false;this.transportControl.cancel('The cloud project is changing.','transport_scope_changed');this.session.close?.();let p;
  // First click after opening a project must sound: the monitor peer (audio + mozart-control) used to start only after
  // the whole project read; it now opens in parallel with the read and is adopted by ensureMonitorReady.
  if(createTitle===undefined)this.startMonitorEarly(projectId,trackId);
  try{p=createTitle!==undefined?await this.session.create(createTitle):await this.session.load(projectId,trackId);projectId=this.session.projectId||projectId;}
  catch(error){
   if(this.monitorEarly){this.monitorEarly=null;try{this.monitor.stop();}catch{}}
   Object.assign(this.session,context);Object.assign(this,previous);
   if(previous.ready&&!context.closed)this.session.startTicking?.();
   if(previous.project)this.onProject(clone(previous.project));
   throw error;
  }
  // Only retire the old audio connection after the replacement context is valid.
  this.releaseNotes();if(!this.earlyMonitorCurrent(projectId,this.session.trackId)){this.monitorEarly=null;this.monitor.stop();}this.transportControl.clock=null;this.transportClockRead=null;this.transportClockInspection=null;this.levels.clear();this.meterFeed.invalidate();this.previewing=false;
  this.projectId=projectId;this.ready=true;this.playing=!!this.session.playing;
  this.beat=(Number(this.session.positionSeconds)||0)*(Number(p.bpm)||120)/60;
  this.selectedPattern=p.clips[0]?.patternId||p.selectedPattern;this.accept(p);
  try{
   const response=await hostFetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,trackId:this.session.trackId})});
   if(!response.ok)throw new Error(`HTTP ${response.status}`);
   this.onStatus('Freestyle cloud project loaded');
  }catch(error){this.onStatus(`Cloud project loaded; the local project selection could not be remembered (${error.message}).`);}
  return p;
 }
 /** Inside Freestyle a new/copied/imported project opens through the app (host.openProject);
  * freestyle-embed.js follows the host's "project" event. Resolves once this view has loaded it. */
 async openViaHost(projectId,trackId=''){
  const host=freestyleHost();if(typeof host?.openProject!=='function')return null;
  try{await hostFetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,trackId})});}catch{}
  await host.openProject(projectId);
  const deadline=Date.now()+60000;
  while(!(this.projectId===projectId&&this.ready&&!this.loading)){
   if(Date.now()>deadline)throw Object.assign(new Error('Freestyle opened the project, but Vegetable Studio has not loaded it yet.'),{code:'host_open_timeout'});
   await (this.loadQueue||Promise.resolve()).catch(()=>{});await new Promise(resolve=>setTimeout(resolve,100));
  }
  return this.project;
 }
 async create(title='Vegetable Studio session'){
  if(typeof freestyleHost()?.openProject==='function'){await this.flush();const created=await this.session.create(title,{open:false});return this.openViaHost(created.projectId,created.trackId);}
  return this.transitionProject(()=>this.performLoad('','',{createTitle:title}));
 }
 async duplicate(title='Vegetable Studio session copy'){
  if(!this.ready||!this.projectId)throw new Error('Select or create a Freestyle cloud project first.');
  title=String(title).trim();if(!title)throw new Error('Give the project copy a title.');
  const sourceProjectId=this.projectId;
  const result=await this.transitionProject(async()=>{
   if(!this.ready||this.projectId!==sourceProjectId)throw Object.assign(new Error('The source cloud project changed before Save As.'),{name:'AbortError',code:'duplicate_scope_changed'});
   const version=this.loadVersion;
   this.onStatus('Copying the Freestyle cloud project…');
   // One explicit request creates one copy. Never retry an ambiguous failure:
   // the service may already have committed the new project.
   const receipt=await api('duplicate_project',{project_id:sourceProjectId,title});
   const projectId=receipt.project?.id;
   const copy=this.lastDuplicate={sourceProjectId,projectId:projectId||null,title,receipt,loaded:false};
   const failure=(message,code,cause,name='Error')=>Object.assign(new Error(message,{cause}),{name,code,sourceProjectId,duplicateProjectId:copy.projectId,duplicateReceipt:receipt});
   if(!projectId)throw failure('Freestyle returned a project-copy receipt without its project identity. Check the project list before trying Save As again.','duplicate_identity_missing');
   if(version!==this.loadVersion||this.projectId!==sourceProjectId)throw failure('The project copy was created, but a newer project selection superseded opening it.','duplicate_open_superseded',undefined,'AbortError');
   if(typeof freestyleHost()?.openProject==='function'){copy.openViaHost=true;return copy;}
   try{const project=await this.performLoad(projectId);copy.loaded=true;return project;}
   catch(error){throw failure(`The project copy was created, but could not be opened: ${error.message}`,'duplicate_load_failed',error);}
  });
  if(result===null)throw Object.assign(new Error('A newer project selection superseded Save As before a copy was requested.'),{name:'AbortError',code:'duplicate_open_superseded',sourceProjectId,duplicateProjectId:null});
  if(result===this.lastDuplicate&&result.openViaHost){
   try{const project=await this.openViaHost(result.projectId);result.loaded=true;return project;}
   catch(error){throw Object.assign(new Error(`The project copy was created, but could not be opened: ${error.message}`,{cause:error}),{code:'duplicate_load_failed',sourceProjectId,duplicateProjectId:result.projectId,duplicateReceipt:result.receipt});}
  }
  return result;
 }
 // The local model stays editable while a batch is in flight: newer edits
 // coalesce into one pending model that is rebased and sent next.
 update(p){if(this.historyPending||this.patternHistory.busy||this.patternHistory.optimisticPending)throw new Error('Wait for the current pattern history request before editing.');if(!this.ready)return;this.sendRealtimeChanges(this.pending||this.sending||this.localBase||this.snapshot,p);this.pending=clone(p);this.editSeq=(this.editSeq||0)+1;clearTimeout(this.timer);this.timer=null;if(!this.interacting&&!this.inFlight)this.scheduleIdleFlush();}
 /** Resolves true once the edits made so far are saved, false once a save of them was refused (the model is then rolled back). Never forces a flush. */
 whenSaved(seq=this.editSeq||0){if((this.savedSeq||0)>=seq)return Promise.resolve(true);if((this.failedSeq||0)>=seq)return Promise.resolve(false);return new Promise(resolve=>{(this.saveWaiters||=[]).push({seq,resolve});});}
 settleSaveWaiters(){const waiters=this.saveWaiters||[];this.saveWaiters=waiters.filter(waiter=>{const done=(this.savedSeq||0)>=waiter.seq?true:(this.failedSeq||0)>=waiter.seq?false:null;if(done===null)return true;waiter.resolve(done);return false;});}
 // Explicit callers always drain. Background (idle) flushes never split an
 // active pointer gesture: its edits stay pending and are sent as one batch,
 // so one gesture is one history entry.
 flush({idle=false}={}){clearTimeout(this.timer);this.timer=null;const next=()=>this.pending&&!(idle&&this.interacting)?this.flush({idle}):this.settleLocalModel();if(this.inFlight)return this.inFlight.then(next);if(!this.pending||!this.ready||idle&&this.interacting)return Promise.resolve(this.settleLocalModel());const seq=this.editSeq||0;this.inFlight=this.flushBatch().finally(()=>{this.inFlight=null;
  // Whatever ended this batch (including a refusal before any write), its edits are settled for whenSaved().
  if((this.savedSeq||0)<seq)this.failedSeq=Math.max(this.failedSeq||0,seq);this.settleSaveWaiters();});return this.inFlight.then(next);}
 scheduleIdleFlush(){clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;this.flush({idle:true}).catch(e=>{if(!e?.editRejectionReported)this.onError(e);});},EDIT_COALESCE_MS);}
 get interacting(){return this._interacting;}
 // Ending a gesture always schedules its held edits, even if the gesture's own
 // completion path does not call update().
 set interacting(value){const was=!!this._interacting;this._interacting=value;if(was&&!value&&this.pending&&!this.inFlight&&this.ready)this.scheduleIdleFlush();}
 /** Adopt the confirmed project once nothing is queued and no gesture holds the local model. */
 /** Exclusive cloud writes (not the queued edit flush) still block score edits. */
 get editBlocked(){return !!this.applying&&!this.flushing;}
 settleLocalModel(){if(this.localBase&&!this.pending&&!this.inFlight&&!this.interacting&&this.ready&&this.session.project)this.accept(this.session.project);}
 async flushBatch(){const seq=this.editSeq||0,local=this.pending,previousAudioBatch=this.session.lastAudioTimingBatch,previousPlaylistMove=this.session.lastPlaylistMove,requests=[];this.pending=null;let next=local;if(this.localBase){try{next=rebaseLocalEdits(local,this.localBase,this.snapshot,this.rebaseIds||{});}catch(error){/* Nothing was sent; retained history still matches the saved project. */if(this.session.project)this.accept(this.session.project);this.onEditSettled();throw error;}}let historyPlan;try{historyPlan=this.patternHistory.captureEdit(this.snapshot,next);}catch{historyPlan={kind:'unsupported',scope:this.patternHistory.context()};this.patternHistory.invalidate('The complete existing pattern could not be retained for history.');}const capture=e=>requests.push(clone(e.detail));this.session.addEventListener('action',capture);this.applying=true;this.flushing=true;this.sending=local;this.onStatus('Sending edits to Freestyle…');document.body.classList.add('cloud-pending');try{const selectionChanged=next.selectedPattern!==this.snapshot.selectedPattern;let applyBase=this.snapshot;try{await this.session.applyProject(applyBase,next,{deferRefresh:()=>!!this.pending});}catch(conflict){const retry=await this.retryAfterTimelineConflict(conflict,{base:applyBase,next,requests});if(!retry)throw conflict;applyBase=retry.base;next=retry.next;historyPlan=retry.historyPlan;await this.session.applyProject(applyBase,next,{deferRefresh:()=>!!this.pending});}this.patternHistory.record(historyPlan,this.session.project,requests);this.savedSeq=Math.max(this.savedSeq||0,seq);this.settleSaveWaiters();if(selectionChanged)this.selectedPattern=this.session.project.selectedPattern;this.snapshot=clone(this.session.project);if(!this.pending&&!this.interacting)this.accept(this.session.project);else{const ids=this.session.lastApplyIdMap||{};this.localBase=clone(local);this.rebaseIds={patterns:{...this.rebaseIds?.patterns,...ids.patterns},placements:{...this.rebaseIds?.placements,...ids.placements}};}const batch=this.session.lastAudioTimingBatch,moved=this.session.lastPlaylistMove,needsReload=batch!==previousAudioBatch&&batch?.status==='committed'&&batch.projectId===this.projectId&&batch.receipt?.engine_reload_required===true||moved!==previousPlaylistMove&&moved?.status==='confirmed'&&moved.scope?.projectId===this.projectId&&moved.engineReloadRequired===true;this.onStatus(this.session.lastLaneMixPersistence?.status==='live_only'?'Mixer changed live; Freestyle cannot save this legacy lane’s mix settings yet.':needsReload?'Saved in Freestyle; the live engine needs to reload this audio edit.':'Saved in Freestyle');document.body.classList.remove('cloud-error');}catch(e){const queued=!!this.pending;// An edit refused before any write changed nothing: history stays usable.
    // QA round 18: a refused save rolls the optimistic model back to the
    // re-read saved project and is reported once (below).
    const maybeWritten=requests.length>0||e.operationUncertain===true||e.operationCommitted===true,blockedBefore=this.patternHistory.blocked;this.pending=null;document.body.classList.add('cloud-error');let refreshed=true;await this.session.refresh().catch(()=>{refreshed=false;});if(this.session.project)this.accept(this.session.project);
    // QA round 19: a 412 is a definite refusal of that write. It never wipes the
    // whole journal: the re-read saved project becomes the baseline (each older
    // step still checks its own target before it is applied).
    const refusedByRevision=Number(e.status)===412&&e.operationUncertain!==true&&refreshed&&!!this.session.project;
    if(refusedByRevision){if(!blockedBefore)this.patternHistory.adoptAfterRefusal?.(this.session.project);}else
    // A definite refusal keeps history usable. An unknown outcome (lost
    // acknowledgement, transport failure) may still land, so it blocks older
    // history even when this read shows nothing yet; it is never resent.
    if(maybeWritten)this.patternHistory.invalidate(refreshed?'The last project edit did not confirm. Inspect or reopen the project before using older pattern history.':'The last project edit did not confirm and the project could not be re-read. Reopen it before using older pattern history.',{force:true,code:'edit_unconfirmed'});
    this.failedSeq=Math.max(this.failedSeq||0,seq);this.settleSaveWaiters();if(e.status===412&&!/reloaded/.test(e.message||''))e.message=`Freestyle changed this project elsewhere; the edit was not applied and the saved project was reloaded. ${e.message||''}`.trim();if(queued)e.message=`${e.message} Later queued edits were not sent; repeat them on the reloaded project.`;
    // Reported once here, so a caller that only awaits the flush cannot hide it.
    if(!e.editRejectionReported&&e.name!=='AbortError'){e.editRejectionReported=true;try{(this.onEditRejected||this.onError)?.(e);}catch{}}
    throw e;}finally{this.session.removeEventListener('action',capture);this.applying=false;this.flushing=false;this.sending=null;document.body.classList.remove('cloud-pending');this.onEditSettled();}}
 /** QA round 19: an edit refused with 412 before anything was written (the
  * timeline moved since this client's tag) is re-sent once on one fresh read,
  * only when every target it touches is unchanged there; otherwise null and
  * the refusal names what changed. */
 async retryAfterTimelineConflict(error,{base,next,requests}){
  if(Number(error?.status)!==412||error?.operationUncertain===true||requests.length>0||this.pending)return null;
  const blockedBefore=this.patternHistory.blocked;
  try{await this.session.refresh();}catch{return null;}
  const fresh=this.session.project;if(!fresh)return null;
  // The read is not an edit: a baseline that moved only by it does not block history.
  if(!blockedBefore&&this.patternHistory.blocked)this.patternHistory.adoptAfterRefusal?.(fresh);
  const targets=editTargetsUnchanged(base,next,fresh);
  if(!targets.ok){clientLog('edit-conflict-retry',{retried:false,targets:targets.ids.slice(0,8)});error.conflictTargets=targets.ids;error.message=`Not saved: ${targets.label} changed in Freestyle after this edit started, so it was not overwritten. ${error.message||''}`.trim();return null;}
  let rebased;try{rebased=rebaseLocalEdits(next,base,fresh,{});}catch{return null;}
  let historyPlan;try{historyPlan=this.patternHistory.captureEdit(fresh,rebased);}catch{historyPlan={kind:'unsupported',scope:this.patternHistory.context()};}
  clientLog('edit-conflict-retry',{retried:true});
  return{base:clone(fresh),next:rebased,historyPlan};
 }
 async refresh(options){await this.flush();return this.session.refresh(options);}
 /** A committed clip batch whose live mirror failed (postCommitError or
  * engine_reload_required): keep the edit, warn softly, reload the session. */
 clipBatchReloadRequired(detail){
  this.liveReloadRequired(detail);
 }
 liveReloadRequired(detail){
  if(!detail||detail.projectId!==this.projectId)return;
  // Coalesce: one engine resync per burst. Reports that arrive before its
  // reload is sent join it; one that arrives after (a later commit the reload
  // may have missed) gets exactly one trailing resync. Never a loop.
  const merge=(into,next)=>({...into,...next,divergent:[...(into?.divergent||[]),...(next.divergent||[])]});
  if(this.engineResync){if(this.engineResyncSent)this.engineResyncAgain=merge(this.engineResyncAgain,detail);else this.engineResyncPending=merge(this.engineResyncPending,detail);return;}
  this.onStatus('Resyncing engine…');this.engineResyncPending=detail;this.engineResyncSent=false;
  const run=async()=>{
   const current=this.engineResyncPending;this.engineResyncPending=null;
   if(!current||!this.ready||this.loading||current.projectId!==this.projectId)return;
   const projectId=current.projectId,loadVersion=this.loadVersion,isCurrent=()=>this.projectId===projectId&&this.loadVersion===loadVersion;
   try{
    await this.session.queue;if(!isCurrent())return;
    this.engineResyncSent=true;const outcome=await resyncEngineSession({client:this.studioApiClient||=new StudioApiClient(),projectId,trackId:reloadScopeTrack(this.session.rawProject,this.session.trackId),divergent:current.divergent,isCurrent});
    this.lastEngineResync={...outcome,projectId,at:Date.now()};clientLog('engine-resync',{mode:outcome.mode??null,status:outcome.status,ms:outcome.ms??null,attempts:outcome.attempts,reason:outcome.reason??null});
    if(outcome.status!=='resynced'||!isCurrent())return;
    // Reconcile keeps the running session (and its runtime ids); a full rebuild
    // re-instantiates it, so only that re-reads the native binding.
    await this.session.refresh(outcome.mode==='full'?{native:true}:{});if(isCurrent())this.onStatus(outcome.mode==='full'?'Resynced engine (full reload)':'Resynced engine');
   }catch(error){this.lastEngineResync={status:'failed',projectId,error:error.message||String(error),attempts:error.engineReloadAttempts??[],at:Date.now()};clientLog('engine-resync',{status:'failed',code:error.code??null,attempts:error.engineReloadAttempts??[]});if(isCurrent())this.onStatus(`The audio edit is saved; resyncing the live engine failed: ${error.message||error}`);}
  };
  this.engineResync=new Promise(resolve=>setTimeout(resolve,0)).then(run).then(async()=>{const again=this.engineResyncAgain;this.engineResyncAgain=null;if(again){this.engineResyncPending=again;await run();}}).finally(()=>{this.engineResync=null;this.engineResyncSent=false;});
 }
 async setLoopRegion({enabled,startBeat,endBeat}={}){
  if(typeof enabled!=='boolean')throw new Error('Loop enabled must be true or false.');
  const hasBounds=startBeat!==undefined||endBeat!==undefined;
  if(hasBounds&&(!Number.isFinite(startBeat)||!Number.isFinite(endBeat)||startBeat<0||endBeat<startBeat))throw new Error('Choose finite loop bounds with an end after the nonnegative start.');
  const projectId=this.projectId,trackId=this.session.trackId,loadVersion=this.loadVersion||0;
  if(!this.ready||this.loading||!projectId||!trackId||this.session.projectId!==projectId)throw new Error('Load a Freestyle cloud project before changing its loop region.');
  const version=this.loopRegionVersion=(this.loopRegionVersion||0)+1;
  const check=()=>{if(!this.ready||this.projectId!==projectId||this.session.projectId!==projectId||this.session.trackId!==trackId||(this.loadVersion||0)!==loadVersion)throw Object.assign(new Error('The cloud project changed while its loop region was being saved.'),{name:'AbortError',code:'loop_scope_changed'});if(version!==this.loopRegionVersion)throw Object.assign(new Error('A newer loop region superseded this request.'),{name:'AbortError',code:'loop_superseded'});};
  await this.flush();check();
  const bpm=Number(this.project?.bpm??this.session.positionAt?.().bpm);
  if(hasBounds&&(!Number.isFinite(bpm)||bpm<=0))throw new Error('Freestyle has not supplied a valid tempo for converting the loop region.');
  const bounds=hasBounds?{start_sec:startBeat*60/bpm,end_sec:endBeat*60/bpm}:{};
  if(hasBounds&&bounds.end_sec-bounds.start_sec<.05&&!(enabled===false&&startBeat===0&&endBeat===0))throw new Error('A loop region must be at least 50 milliseconds long.');
  const apply=async(name,args)=>{check();const result=await this.session.action(name,args,{refresh:false});check();if(result?.ok===false||result?.isError||result?.error)throw new Error(result.message||result.error||'Freestyle rejected the loop region.');return result;};
  // These are separate verified contracts: persist the project region, then
  // apply it to the live transport. Never substitute requested bounds for an
  // actual engine clock; the scoped explicit read preserves newer live clocks.
  // Issue #17: PUT /transport/loop keeps its region while off and {enabled:true} alone loops it again. The project-level
  // set_project_loop_region still needs start_sec/end_sec to enable (409 loop_region_required otherwise, reported to
  // Freestyle): it gets the region the transport kept, read from the clock, never a guessed one.
  let projectBounds=bounds;
  if(enabled&&!hasBounds){const clock=this.session.positionAt?.()||{},start=Number(clock.loopStartSec),end=Number(clock.loopEndSec);if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end-start>=.05)projectBounds={start_sec:start,end_sec:end};}
  const persisted=await apply('set_project_loop_region',{project_id:projectId,enabled,...projectBounds});
  const transport=await apply('set_transport_loop',{enabled,...bounds});
  check();await this.session.refreshTransportClock();check();
  const clock=this.session.positionAt?.()||this.positionAt(),display=this.previewing?this.positionAt():clock;this.playing=display.playing;if(display.beat!=null)this.beat=display.beat;
  if(typeof clock.loopEnabled==='boolean'&&this.snapshot)this.snapshot.loop=clock.loopEnabled;
  this.onTick({...display,step:display.beat==null?-1:Math.floor(display.beat*4),mode:this.mode});
  return {...clock,projectId,receipts:{persisted,transport}};
 }
 /** One receive connection belongs to the loaded context, not to a Play attempt. */
 /** Open the monitor peer for a project that is still loading (see performLoad). Never while a peer for that same
  * context is already up. ensureMonitorReady adopts it once the load is done; a load that ends on another context
  * track (or fails) closes it. */
 startMonitorEarly(projectId,trackId){
  this.monitorEarly=null;
  trackId=typeof trackId==='string'?trackId:'';
  if(typeof projectId!=='string'||!projectId||typeof this.monitor?.start!=='function')return false;
  const m=this.monitor;if(m.projectId===projectId&&(!trackId||m.trackId===trackId)&&(m.state==='connecting'||m.state==='connected'||m.state==='blocked'))return false;
  const startedAt=performance.now();let promise;
  try{promise=Promise.resolve(m.start(projectId,trackId,{useProjectDefault:()=>false,canRecover:()=>{try{return this.ready&&!this.loading&&this.projectId===projectId&&this.session.trackId===m.trackId&&!this.recordingContext&&!this.recorder.recording&&!['connecting','stopping'].includes(this.recorder.state)&&!this.applying&&!this.historyPending&&!globalThis.document?.hidden;}catch{return false;}}}));}
  catch{return false;}
  promise.catch(()=>{});this.monitorEarly={projectId,trackId,generation:m.generation,promise,startedAt};
  try{clientLog('monitor-early-start',{projectId});}catch{}
  return true;
 }
 /* The engine peer is project-scoped (the offer carries no track), so a peer opened before the context track was known
  * is bound to it once the project read names it. */
 earlyMonitorCurrent(projectId,trackId){
  const early=this.monitorEarly,m=this.monitor;if(!early||early.projectId!==projectId||early.generation!==m.generation||m.projectId!==projectId||!trackId)return false;
  if(m.trackId===trackId)return true;
  if(early.trackId!==''||m.trackId!=='')return false;
  m.trackId=trackId;if(m.session&&typeof m.session==='object')m.session.trackId=trackId;if(m.recoveryPolicy&&m.recoveryPolicy.generation===m.generation)m.recoveryPolicy.trackId=trackId;return true;
 }
 ensureMonitorReady({retry=false}={}){
  const scope=cloudScope(this),key=JSON.stringify(scope);try{requireCloudScope(this,scope);}catch(error){return Promise.reject(error);}
  const bound=()=>this.monitor.projectId===scope.projectId&&this.monitor.trackId===scope.contextTrackId;
  const connected=()=>this.monitor.state==='connected'||this.monitor.state==='blocked'&&this.monitor.peer?.connectionState==='connected';
  let request=this.monitorReadyRequest;
  if(request?.key===key&&request.generation===this.monitor.generation&&request.record.status==='pending')return request.promise;
  if(bound()&&connected()){if(request?.key!==key||request.generation!==this.monitor.generation||!['ready','blocked'].includes(request.record.status)){const record={scope:{...scope},status:this.monitor.state==='blocked'?'blocked':'ready',generation:this.monitor.generation,startedAt:null,readyAt:performance.now(),error:null};this.monitorReadiness=record;this.monitorReadyRequest={key,record,generation:this.monitor.generation,promise:Promise.resolve(true)};}else request.record.status=this.monitor.state==='blocked'?'blocked':'ready';return Promise.resolve(true);}
  if(request?.key===key&&request.generation===this.monitor.generation&&!retry)return request.promise;
  const record={scope:{...scope},status:'pending',generation:null,startedAt:performance.now(),readyAt:null,error:null};
  request={key,record,generation:null,promise:null};this.monitorReadyRequest=request;this.monitorReadiness=record;
  const check=()=>{requireCloudScope(this,scope);if(this.monitor.generation!==request.generation)throw Object.assign(new Error('The cloud audio connection changed while it was opening.'),{name:'AbortError',code:'monitor_generation_changed'});};
  let opening;const early=this.earlyMonitorCurrent(scope.projectId,scope.contextTrackId)?this.monitorEarly:null;this.monitorEarly=null;
  if(early)opening=early.promise;else try{opening=this.monitor.start(scope.projectId,scope.contextTrackId,{useProjectDefault:()=>{requireCloudScope(this,scope);return verifiedDefaultMonitorContext(this,scope);},canRecover:()=>{requireCloudScope(this,scope);return !this.recordingContext&&!this.recorder.recording&&!['connecting','stopping'].includes(this.recorder.state)&&!this.applying&&!this.historyPending&&!globalThis.document?.hidden;}});}catch(error){opening=Promise.reject(error);}
  request.generation=this.monitor.generation;record.generation=request.generation;
  request.promise=Promise.resolve(opening).then(started=>{
   check();if(started===false)throw new Error('The audio connection was cancelled.');
   if(!bound())throw new Error('The audio monitor opened a different project or track context. Reconnect the selected project before playing.');
   if(!connected())throw new Error(this.monitor.state==='blocked'?'Allow cloud audio playback in the browser, then press Play again.':'The audio connection is not connected.');
   record.status=this.monitor.state==='blocked'?'blocked':'ready';record.readyAt=performance.now();return true;
  }).catch(error=>{
   const stale=!currentCloudScope(this,scope)||this.monitor.generation!==request.generation;
   record.status=stale?'stale':'failed';record.error={code:error.code||'monitor_connect_failed',message:error.message};throw error;
  });
  return request.promise;
 }
 prewarmMonitor(){
  if(!this.ready||this.loading||!this.projectId||!this.session.trackId)return Promise.resolve(false);
  const opening=this.ensureMonitorReady(),record=this.monitorReadyRequest?.record;return opening.catch(error=>{if(error.name!=='AbortError'&&record&&this.monitorReadiness===record&&currentCloudScope(this,record.scope))this.onStatus(`Cloud audio is not ready: ${error.message} Press Play to reconnect.`);return false;});
 }
 cancelPendingPlay(message='Cloud playback was cancelled.',code='transport_cancelled'){
  const attempt=this.playAttempt;this.playVersion=(this.playVersion||0)+1;this.playAttempt=null;
  if(attempt){attempt.cancelled=true;attempt.cancelResume?.(message,code);this.transportControl.cancel(message,code);
   // The receive connection is shared with background prewarming and the next
   // Play. Cancelling transport intent must never abort its pending offer.
  }
  return attempt;
 }
 async play(p,mode='song',{startSeconds,patternLoop=true,preview={},patternContent=null}={}){
  // Advanced fill audition: an unsaved candidate score ({sources, events}) of the selected pattern.
  if(patternContent!==null&&(mode!=='pattern'||!patternContent||typeof patternContent!=='object'||!Array.isArray(patternContent.sources)||!Array.isArray(patternContent.events)))throw new TypeError('A pattern preview candidate needs complete sources and events.');
  if(!this.ready)throw new Error('Select or create a Freestyle cloud project first.');
  if(startSeconds!==undefined&&(!Number.isFinite(startSeconds)||startSeconds<0))throw new Error('Playback start must be a finite nonnegative position in seconds.');
  const previewOptions=mode==='pattern'?patternPreviewOptions({patternLoop,preview}):null;
  // Call in the initiating gesture, before edits or cloud signaling can await.
  // A background connection may already have its stream but be autoplay-blocked.
  let resumeError,onResumeDenied=()=>{},gestureResume=Promise.resolve();try{if(this.monitor.projectId===this.projectId&&this.monitor.trackId===this.session.trackId)gestureResume=Promise.resolve(this.monitor.resume?.()).catch(error=>{resumeError=error;onResumeDenied();});}catch(error){resumeError=error;}
  const previous=this.cancelPendingPlay('A newer Play superseded this request.','transport_superseded');this.localStopHold=null;
  const projectId=this.projectId,trackId=this.session.trackId,loadVersion=this.loadVersion||0,contextVersion=this.session.contextVersion||0,attempt={version:this.playVersion,projectId};this.playAttempt=attempt;
  attempt.audibilityEpoch=this.monitor.holdAudibility?.();
  const checkCurrent=()=>{if(!this.ready||this.projectId!==projectId||this.session.projectId!==projectId||this.session.trackId!==trackId||(this.loadVersion||0)!==loadVersion||(this.session.contextVersion||0)!==contextVersion)throw Object.assign(new Error('The cloud project changed while its audio connection was opening.'),{name:'AbortError',code:'transport_scope_changed'});if(attempt.cancelled||attempt.version!==this.playVersion)throw Object.assign(new Error('Cloud playback was cancelled.'),{name:'AbortError',code:'transport_cancelled'});};
  onResumeDenied=()=>{try{checkCurrent();if(attempt.commandDispatched)this.transportControl.cancel('Browser audio playback was denied.','audio_playback_denied');}catch{}};
  try{
  // CloudSession orders this after an already dispatched preview, before any
  // replacement preview. A late receipt may never revive the cancelled one.
  if(previous?.previewPending){await this.stopPatternPreview();checkCurrent();}
  await this.flush();checkCurrent();
  try{
   if(!trackId)throw new Error('The selected project has no playback track context. Reload the project before playing.');
   await this.ensureMonitorReady({retry:true});checkCurrent();attempt.audibilityEpoch=this.monitor.holdAudibility?.();
   if(resumeError)throw resumeError;
   if(this.monitor.state!=='connected'&&!(this.monitor.state==='blocked'&&this.monitor.peer?.connectionState==='connected'))throw new Error(this.monitor.state==='blocked'?'Allow cloud audio playback in the browser, then press Play again.':'The audio connection is not connected.');
   if(this.monitor.projectId!==projectId||this.monitor.trackId!==trackId)throw new Error('The audio monitor opened a different project or track context. Reconnect the selected project before playing.');
  }catch(error){checkCurrent();throw new Error(`Live cloud audio is unavailable: ${error.message}`,{cause:error});}
  checkCurrent();
  const current=this.project||p;this.mode=mode;
  if(mode==='pattern'){
   const chosen=current.patterns.find(x=>x.id===(this.selectedPattern||p.selectedPattern))||current.patterns.find(x=>x.id===current.selectedPattern);
   if(!chosen?.cloudRaw)throw new Error('Create a cloud pattern before previewing.');
   const dto=assertCompletePattern(chosen),generation=this.monitor.generation;
   attempt.previewPending=true;let receipt;
   const cleanup=async()=>{attempt.cleanupAttempted=true;this.previewing=false;this.playing=false;try{await this.stopPatternPreview();attempt.commandStopped=true;}catch(error){this.onStatus(`Pattern preview failed and its cleanup also failed: ${error.message}`);}};
   try{attempt.commandDispatched=true;
    // Default's instant PAT Play: one pattern_preview_start on the open control channel when this
    // exact saved pattern is pre-armed in Mozart (cloud-pattern-arm.js); otherwise the ordinary request.
    if(!patternContent)receipt=await this.patternArm.start({patternLoop,preview});
    // A Stop already covered this request id: Mozart refused it as stale.
    if(receipt?.stopped)throw Object.assign(new Error('Cloud playback was cancelled.'),{name:'AbortError',code:'transport_cancelled'});
    if(!receipt)receipt=await this.session.action('preview_pattern',{project_id:projectId,pattern:patternContent?structuredClone(patternContent):dto.pattern,bpm:current.bpm,bars:chosen.bars,ppq:dto.ppq||96,length_ticks:dto.lengthTicks||chosen.bars*384,...previewOptions,...this.previewPeer()},{refresh:false});}
   catch(error){checkCurrent();if(this.monitor.generation!==generation)throw Object.assign(new Error('The cloud audio session changed while its preview was opening.'),{name:'AbortError',code:'transport_scope_changed'});receipt=previewFailureReceipt(error);if(!receipt){await cleanup();throw error;}}
   finally{attempt.previewPending=false;}
   checkCurrent();
   if(this.monitor.generation!==generation)throw Object.assign(new Error('The cloud session changed while its pattern preview was opening.'),{name:'AbortError',code:'transport_scope_changed'});
   this.previewReceipt=receipt;
   try{assertPreviewScheduled(receipt);}catch(error){await cleanup();throw error;}
   const status=previewScheduleStatus(receipt);this.previewWarning=status.warning;
   this.previewPatternId=chosen.id;this.previewContext={generation,epoch:this.session.liveClock?.payload?.session_epoch,bpm:current.bpm};this.previewing=true;this.previewCompletionReported=false;this.previewFinalPosition=null;
   if(status.warning)this.onStatus(status.warning);
   else if(receipt.preview_program_active===true)this.onStatus('Playing the cloud pattern preview.');
   else{const repeats=Number.isFinite(Number(receipt.repeat_count))&&Number(receipt.repeat_count)>0?Number(receipt.repeat_count):1;this.onStatus(`Playing the cloud pattern preview for ${repeats} ${repeats===1?'cycle':'cycles'}.`);}

  }else{
   attempt.commandDispatched=true;const receipt=await this.transport(startSeconds===undefined?'play':'seek_and_play',startSeconds===undefined?{}:{seconds:startSeconds});checkCurrent();
   if(stoppedPlayReceipt(receipt)){attempt.commandStopped=true;this.playing=false;throw Object.assign(new Error('Freestyle confirmed the transport is stopped. Playback did not start.'),{code:'transport_not_playing'});}
  }
  // Paused/DTX streams can leave audio.play() pending until transport produces
  // samples. Prime in the gesture, dispatch first, then settle media permission.
  checkCurrent();
  try{await new Promise((resolve,reject)=>{attempt.cancelResume=(message,code)=>reject(Object.assign(new Error(message),{name:'AbortError',code}));gestureResume.then(resolve,reject);});}
  finally{attempt.cancelResume=null;}
  checkCurrent();if(resumeError)throw resumeError;
  this.monitor.restoreAudibility?.(attempt.audibilityEpoch);this.audioPauseBarrier=null;
  this.playing=true;return true;
  }catch(error){
   if(resumeError&&attempt.commandDispatched&&!attempt.commandStopped&&!attempt.cleanupAttempted){
    checkCurrent();this.monitor.silence?.();attempt.cleanupAttempted=true;let cleanupError;
    try{
     if(mode==='pattern'){await this.stopPatternPreview();checkCurrent();this.previewing=false;this.playing=false;}
     else{await this.retainAudioPause(this.transport('stop'));checkCurrent();if(this.session.positionAt?.().playing===true)throw new Error('Freestyle still reports playback running.');}
    }catch(failure){checkCurrent();cleanupError=failure;}
    const message=`Live cloud audio playback was denied: ${resumeError.message||String(resumeError)}${cleanupError?`. Stopping cloud playback was not confirmed: ${cleanupError.message}`:''}`;
    throw Object.assign(new Error(message,{cause:resumeError}),{code:'audio_playback_denied',...(cleanupError?{cleanupError}:{} )});
   }
   throw error;
  }finally{attempt.cancelResume=null;if(this.playAttempt===attempt)this.playAttempt=null;}
 }
 retainAudioPause(promise){const record={...cloudScope(this),promise:Promise.resolve(promise),done:false};this.audioPauseBarrier=record;record.promise.then(()=>{record.done=true;},()=>{});return record.promise;}
 /** Explicit audition reopens the receive sink only after a pending user pause.
  * Warm auditions during arrangement playback keep the existing gate/epoch.
  */
 prepareAudition({current=()=>true}={}){
  const scope=cloudScope(this);requireCloudScope(this,scope);const epoch=this.monitor.audibilityEpoch,barrier=this.audioPauseBarrier;
  const finish=()=>{requireCloudScope(this,scope);if(!current())return false;if(this.monitor.restoreAudibility?.(epoch)===false)return false;try{Promise.resolve(this.monitor.resume?.()).catch(error=>this.onStatus(error.message));}catch(error){this.onStatus(error.message);}return true;};
  if(barrier&&['projectId','contextTrackId','loadVersion','contextVersion'].every(key=>barrier[key]===scope[key])&&!barrier.done)return barrier.promise.then(finish);
  return finish();
 }
 async pause(){const hold=this.holdLocalStop('pause');try{this.monitor.silence?.();const pending=this.cancelPendingPlay(),version=this.playVersion;if(this.previewing||pending?.previewPending){await this.retainAudioPause(this.stopPatternPreview());if(version!==this.playVersion)return;this.previewing=false;}else{if(!this.ready)return;await this.retainAudioPause(this.transport('pause'));}if(version===this.playVersion)this.playing=false;}finally{this.releaseLocalStop(hold);}}
 // Round 10 / Studio Pro: Stop and Pause take effect locally at once (receive
 // audio faded out, displayed clock frozen) while the engine command is
 // acknowledged; the hold ends with that command, confirmed or failed.
 holdLocalStop(command){let position=null;try{position=this.positionAt();}catch{}const hold={command,at:this.session.now?.()??performance.now(),position:position?{...position,playing:false,localStop:true}:null};this.localStopHold=hold;return hold;}
 releaseLocalStop(hold){if(this.localStopHold===hold)this.localStopHold=null;}
 /** Default's pattern stop (instant control-channel stop through the newest preview id; HTTP fallback), REST stop-all only as a last resort. */
 async stopPatternPreview(){try{return await this.patternArm.stop();}catch{return this.session.action('stop_all_pattern_previews',{...this.previewPeer()}, {refresh:false});}}
 /** Issue #11: previews are kept per monitor peer. Every REST start/stop names this page's peer (client_id) so the
  * data-channel pattern_preview_stop and the peer-scoped stops cover it. Empty without a connected peer. */
 previewPeer(){const m=this.monitor,id=m?.clientId;return typeof id==='string'&&id&&m.projectId===this.projectId&&m.peer?.connectionState==='connected'?{client_id:id}:{};}
 async stop(){const hold=this.holdLocalStop('stop');try{this.monitor.silence?.();const pending=this.cancelPendingPlay(),version=this.playVersion;this.releaseNotes();if(!this.ready)return;const previewStop=this.mode==='pattern'||this.previewing||pending?.previewPending?this.stopPatternPreview():null;await this.retainAudioPause(Promise.all([this.transport('stop'),previewStop]));if(version!==this.playVersion)return;this.releaseLocalStop(hold);this.previewing=false;this.playing=false;this.beat=this.positionAt().beat;}finally{this.releaseLocalStop(hold);}}
 seek(beat){if(!this.ready)return;return this.transport('seek',{seconds:beat*60/(this.project?.bpm||120)}).catch(e=>{if(e.name!=='AbortError')this.onError(e);});}
 async transport(command,options={}){const projectId=this.projectId;const result=await this.transportControl.send(command,options);if(projectId!==this.projectId||!this.ready)throw Object.assign(new Error('The cloud project changed during transport.'),{name:'AbortError',code:'transport_scope_changed'});if(command==='stop'||command==='pause')this.localStopHold=null;if(result.route==='data-channel')this.session.applyTransportAcknowledgement?.(command,result,{...options,projectId});const position=this.positionAt();this.playing=position.playing;this.beat=position.beat;this.onTick({...position,step:Math.floor(position.beat*4),mode:this.mode});return result;}
 positionAt(at,options={}){const hold=this.localStopHold;if(hold?.position)return{...hold.position};at=this.displayClockAt(at);if(options.heardLagSec===undefined){const stats=this.monitor.stats||{},finite=(v,f)=>v!=null&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):f;const total=finite(this.session.producerLagSec,.12)+finite(stats.receiverLagSec,.03)+finite(stats.playoutLagSec,.03),live=this.session.liveClock?.payload?.live_listen,limit=1+(live?.delayed?finite(live.delay_seconds,0):0);if(total>0&&total<limit)this.heardLagSec=total;options={...options,heardLagSec:this.heardLagSec??.18};}if(this.previewing){const context=this.previewContext||{},anchor=context.generation===this.monitor.generation?this.session.liveClock:null,preview=this.previewCompletionReported&&this.previewFinalPosition?this.previewFinalPosition:patternPreviewPosition(this.previewReceipt,anchor,{at:at??this.session.now?.()??performance.now(),bpm:context.bpm||this.project?.bpm||120,heardLagSec:options.heardLagSec,expectedEpoch:context.epoch,smoothElapsed:elapsed=>this.smoothPreviewElapsed(elapsed,at,context)});this.playing=preview.playing;if(preview.previewEnded&&!this.previewCompletionReported){this.previewCompletionReported=true;this.previewFinalPosition=preview;this.onStatus(`Cloud pattern preview finished after ${preview.previewRepeatCount} ${preview.previewRepeatCount===1?'cycle':'cycles'}.`);}return{...preview,mode:'pattern',previewPatternId:this.previewPatternId,previewWarning:this.previewWarning||null};}const snapshot=this.session.positionAt?.(at,options);return snapshot?{...this.smoothSongPosition(snapshot,at),mode:this.mode,previewing:false,clockAvailable:snapshot.clockSource!=='none'}:{seconds:this.beat*60/(this.project?.bpm||120),beat:this.beat,playing:this.playing,bpm:this.project?.bpm||120,mode:this.mode};}
 /** Pre-armed native pattern preview (Default studio parity). */
 get patternArm(){return this._patternArm??=new PatternPreviewArm({engine:this});}
 /** Realtime one-shot sample audition over the control channel (Default step-tap parity). */
 get sampleAudition(){return this._sampleAudition??=new CloudSampleAudition({engine:this});}
 /** FL/Default step audition: a step switched ON plays its channel's sample now, on the data channel; REST only when it cannot. */
 auditionSampleStep(channel){
  if(!this.ready||this.loading)return Promise.resolve(false);
  const handled=this.sampleAudition.play(channel);
  return Promise.resolve(handled).then(done=>done===true?true:this.preview(channel));
 }
 /** Re-arm now (entering PAT mode, the view becoming active); a no-op before a project has loaded. */
 armPatternPreview(reason='request'){this._patternArm?.schedule(reason,{immediate:true});}
 /** Default-studio warm-up on pointer intent over the transport / rack: the
  * pointerdown is a real gesture, so unlock the receive element now (Play's own resume then has
  * nothing to wait for) and make sure the pattern is armed. Never starts audio or a connection. */
 primeTransport(reason='pointer-intent'){
  if(!this.ready||this.loading)return;
  try{const audio=this.monitor.audio;if(audio?.srcObject&&audio.paused&&this.monitor.peer?.connectionState==='connected')Promise.resolve(this.monitor.resume?.()).catch(()=>{});}catch{}
  const arm=this._patternArm;if(arm&&!arm.armed&&!arm.inFlight)arm.schedule(reason,{immediate:true});
 }
 /** The saved selected pattern as a preview_pattern request body, or null before a cloud pattern exists. */
 patternPreviewRequest({patternLoop=true,preview={}}={}){
  const current=this.project;if(!current||!this.projectId)return null;
  const chosen=current.patterns.find(x=>x.id===(this.selectedPattern||current.selectedPattern))||current.patterns.find(x=>x.id===current.selectedPattern);
  if(!chosen?.cloudRaw)return null;
  const dto=assertCompletePattern(chosen),options=patternPreviewOptions({patternLoop,preview});
  return {chosen,dto,body:{project_id:this.projectId,pattern:dto.pattern,bpm:current.bpm,bars:chosen.bars,ppq:dto.ppq||96,length_ticks:dto.lengthTicks||chosen.bars*384,...options}};
 }
 /** rAF hands over the frame START time. A clock message handled earlier in the
  * same frame is stamped later than that, which clamps the extrapolation to
  * zero for one frame (a visible step back). Read the clock at the draw. */
 displayClockAt(at){const now=this.session.now?.()??performance.now(),value=Number(at);return Number.isFinite(value)?Math.max(value,now):now;}
 /** Default's cursor slew limiter (playhead-smoother.js) over the raw song clock model. */
 smoothSongPosition(snapshot,at){
  const smoother=this.playheadSmoother??=new PlayheadSmoother();
  if(!snapshot.playing||snapshot.clockAvailable===false||snapshot.clockSource==='none'||!Number.isFinite(snapshot.seconds)){smoother.reset();return snapshot;}
  const session=this.session,live=session.liveClock,key=`song:${this.projectId}:${session.transportVersion}:${live?.generation??''}:${live?.epoch??''}`;
  const span=snapshot.loopEnabled?Number(snapshot.loopEndSec)-Number(snapshot.loopStartSec):0,bpm=Number(snapshot.bpm)||this.project?.bpm||120;
  const seconds=smoother.step(snapshot.seconds,at,{key,wrapSpan:span>0?span:0});
  return seconds===snapshot.seconds?snapshot:{...snapshot,seconds,beat:seconds*bpm/60};
 }
 /** The pattern preview's elapsed time is monotonic; smooth it, then let the cycle phase follow. */
 smoothPreviewElapsed(elapsed,at,context={}){
  const smoother=this.playheadSmoother??=new PlayheadSmoother(),receipt=this.previewReceipt||{};
  if(!(elapsed>=0)){smoother.reset();return elapsed;}
  return smoother.step(elapsed,at,{key:`preview:${context.generation??''}:${receipt.min_schedule_time_sec??receipt.engine_time_sec??''}:${receipt.preview_request_id??''}`});
 }
 getInstrumentAudition(){return this.instrumentAuditionController??=new CloudInstrumentAudition({engine:this});}
 acquireInstrumentNote(channel,pitch,velocity=.8){return this.getInstrumentAudition().acquire(channel,pitch,velocity);}
 async noteOn(channel,pitch,velocity=.8){if(!this.ready)throw new Error('Select a Freestyle project to play its instruments.');if(channel.type!=='instrument'&&!channel.instrumentType&&channel.cloudRaw?.kind!=='plugin')return this.preview(channel,pitch);return this.getInstrumentAudition().noteOn(channel,pitch,velocity);}
 async noteOff(channel,pitch){return this.instrumentAuditionController?.noteOff(channel,pitch);}
 releaseNotes(){this.instrumentAuditionController?.releaseNotes();this.heldNotes.clear();}
 /** Browser audition of a project pattern sample that has no rack channel
  * (a registered Sound Library row): the same scoped monitor + engine
  * preview_pattern_sample path as a sample channel's audition. */
 async previewSampleFile(audioFileId,{pitch=60,gain=1}={}){
  if(!this.ready)throw new Error('Select a Freestyle project to preview sounds.');
  if(typeof audioFileId!=='string'||!audioFileId||audioFileId.length>64)throw new Error('Choose a stored project sample to preview.');
  assertStudioApiFeature('sample_audition',{project:this.project});
  const scope=cloudScope(this),version=this.playVersion||0,audition=this.getInstrumentAudition();
  const check=()=>{requireCloudScope(this,scope);if((this.playVersion||0)!==version)throw Object.assign(new Error('Sample preview was cancelled.'),{name:'AbortError',code:'audition_cancelled'});};
  check();await audition.connect({projectId:scope.projectId,trackId:scope.contextTrackId,loadVersion:scope.loadVersion,contextVersion:scope.contextVersion});check();if(await this.prepareAudition({current:()=>{try{check();return true;}catch{return false;}}})===false)return false;check();
  return this.session.action('preview_pattern_sample',{audio_file_id:audioFileId,pitch,gain},{refresh:false,expectedContext:{projectId:scope.projectId,trackId:scope.contextTrackId,contextVersion:scope.contextVersion}});
 }
 async preview(channel,pitch=60){
  if(!this.ready)throw new Error('Select a Freestyle project to audition its instruments.');
  const raw=channel.cloudRaw||{},audioFileId=raw.audioFileId||raw.audio_file_id;
  if(audioFileId){
   assertStudioApiFeature('sample_audition',{project:this.project});
   const scope=cloudScope(this),version=this.playVersion||0,audition=this.getInstrumentAudition();
   const check=()=>{requireCloudScope(this,scope);const matches=(this.project?.channels||[]).filter(current=>current.id===channel.id),current=matches[0]?.cloudRaw||{};
    if((this.playVersion||0)!==version||matches.length!==1||(current.audioFileId||current.audio_file_id)!==audioFileId)throw Object.assign(new Error('Sample audition was cancelled or its source changed.'),{name:'AbortError',code:'audition_source_changed'});
   };
   check();await audition.connect({projectId:scope.projectId,trackId:scope.contextTrackId,loadVersion:scope.loadVersion,contextVersion:scope.contextVersion});check();if(await this.prepareAudition({current:()=>{try{check();return true;}catch{return false;}}})===false)return false;check();
   return this.session.action('preview_pattern_sample',{audio_file_id:audioFileId,pitch,gain:channel.volume??1},{refresh:false,expectedContext:{projectId:scope.projectId,trackId:scope.contextTrackId,contextVersion:scope.contextVersion}});
  }
  if(channel.type==='instrument'||channel.instrumentType||raw.kind==='plugin')return this.getInstrumentAudition().noteOn(channel,pitch,.8,{preview:true});
  throw new Error('Select an instrument or sample channel. Cloud instrument controls are available in the Freestyle panel.');
 }
 /** Stamp a correctly project/peer-scoped mixer_meters frame at receipt (read-only, durable IDs). */
 acceptMeterFrame(data,receivedAt=Date.now()){const monitor=this.monitor;if(!monitor?.projectId)return null;return this.meterFeed.accept(data,{projectId:monitor.projectId,generation:monitor.generation??0,receivedAt});}
 /** Last accepted meter frame while the same monitor peer and project are current; null otherwise. */
 currentMeterFrame(){const monitor=this.monitor;return monitor?.projectId?this.meterFeed.current({projectId:monitor.projectId,generation:monitor.generation??0}):null;}
 getLevel(id){if(this.levels.has(id))return this.levels.get(id);const state=this.session.rawState||{};if(id==='master')return state.buses?.buses?.find(x=>x.bus_id==='master'||x.id==='master')?.post_fader_peak||0;const c=this.project?.channels.find(c=>c.id===id);const t=state.tracks?.tracks?.find(t=>t.db_track_id===id||t.id===c?.engineTrackId);return t?.post_fader_peak??t?.output_peak??0;}
 async history(action){
  if(!['history_undo','history_redo'].includes(action))throw new Error('Choose Undo or Redo.');if(this.historyPending||this.patternHistory.busy)throw new Error('Wait for the current history request.');
  const scope=cloudScope(this),assert=()=>{requireCloudScope(this,scope);if(this.interacting)throw Object.assign(new Error('Finish the current gesture before using history.'),{name:'AbortError',code:'history_gesture_busy'});};assert();this.historyPending=true;
  // FL: an edit made just before the press (e.g. a Draw-tool click) is saved
  // first and becomes the step this press applies; say so in the diagnostics.
  const unsaved=!!(this.pending||this.inFlight),journalBefore={index:this.patternHistory.index,entries:this.patternHistory.entries.length};
  try{await this.flush();assert();if(unsaved){const journal=this.patternHistory.snapshot(),entry=this.patternHistory.entries[this.patternHistory.index-1];try{clientLog('history-pending-edit-saved',{action,before:journalBefore,index:journal.index,entries:journal.entryCount,kind:entry?.kind??null,operation:entry?.operation??null,label:entry?this.patternHistory.labelFor(entry):null,blocked:journal.blocked});}catch{}}await this.patternHistory.waitForQueue();assert();const history=this.patternHistory.snapshot();if(history.hasJournal)return await this.patternHistory[action==='history_undo'?'undo':'redo']();
  // Native Studio history does not undo Studio API edits; with nothing retained,
  // Undo/Redo is simply unavailable rather than a native step on other data.
  if(this.session.rawState?.studioApi===true)throw Object.assign(new Error(action==='history_undo'?'There is nothing to undo.':'There is nothing to redo.'),{code:'history_empty'});const result=await this.session.action(action,{project_id:scope.projectId},{expectedContext:{projectId:scope.projectId,trackId:scope.contextTrackId,contextVersion:scope.contextVersion}});assert();return result;}
  finally{this.historyPending=false;this.patternHistory.notify();}
 }
 async save(){await this.flush();return api('create_project_save',{project_id:this.projectId});}
 async exportMix(){await this.flush();const job=await this.session.exportMix();const jobId=job.jobId||job.job_id;if(!jobId)return job;this.onStatus('Freestyle is rendering the mix…');for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,2000));const state=await api('get_export_status',{project_id:this.projectId,job_id:jobId});if(state.status==='complete'||state.status==='completed')return {downloadUrl:state.export?.downloadUrl||state.downloadUrl,...state};if(['failed','error','cancelled'].includes(state.status))throw new Error(state.error||'The cloud render failed.');}return job;}
 async importSample(file,target,options={}){
  const scope=cloudScope(this);requireCloudScope(this,scope);
  const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value),id=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value),finite=value=>typeof value==='number'&&Number.isFinite(value),copy=value=>value==null?value:structuredClone(value);
  if(!file||!Number.isSafeInteger(file.size)||file.size<=0||file.size>25*1024*1024||typeof file.arrayBuffer!=='function'||typeof file.name!=='string'||!file.name||Array.from(file.name).length>160)throw new Error('Choose a named audio file of at most 25 MB (filename at most 160 characters).');
  if(!record(options)||Object.keys(options).some(key=>!['laneId','startSeconds'].includes(key))||options.laneId!==undefined&&!id(options.laneId)||options.startSeconds!==undefined&&(!finite(options.startSeconds)||options.startSeconds<0||!finite(options.startSeconds*1000)))throw new Error('Choose a durable audio lane and a finite nonnegative drop time in seconds.');
  const desired=options.startSeconds===undefined?null:Math.round(options.startSeconds*1000),canonical=this.session.rawProject||this.project?.cloud?.rawProject,lanes=Array.isArray(canonical?.lanes)?canonical.lanes:[],channels=target?(this.project?.channels||[]).filter(channel=>channel.id===target):[];
  if(channels.length>1)throw new Error('The selected import channel is ambiguous. Reload the project.');
  let laneId=options.laneId??channels[0]?.laneId;
  if(laneId!==undefined){const matches=lanes.filter(lane=>lane?.id===laneId);if(!id(laneId)||matches.length!==1||!['audio','vocal'].includes(matches[0].kind)){if(options.laneId!==undefined)throw new Error('Drop audio onto one existing persisted audio lane, or empty playlist space to create a lane.');laneId=undefined;}}
  const restMode=this.session.rawState?.studioApi===true||this.project?.cloud?.rawState?.studioApi===true,requestKey=()=>globalThis.crypto?.randomUUID?.()||`import-${Date.now()}-${Math.random().toString(36).slice(2)}`;let canonicalRead=canonical;
  const state={...scope,restMode,requestKeys:{},currentEtag:canonical?._studioApi?.projectId===scope.projectId&&typeof canonical?._studioApi?.etag==='string'?canonical._studioApi.etag:null,file,laneId:laneId??null,requestedStartSeconds:options.startSeconds??null,status:'encoding',uploadAttempted:false,uploadAcknowledged:false,uploadUncertain:false,receipt:null,uploadAcknowledgement:null,clipId:null,canonicalClip:null,placementAttempted:false,placementAcknowledgement:null,placementReceipt:null,placementPending:desired!==null,persisted:false,liveReloadPending:false,attachmentAttempted:false,attachmentAcknowledgement:null,attachmentReceipt:null,attachmentPending:true,attachmentError:null,engineLoaded:false,error:null};this.lastImport=state;
  const marker=key=>/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key),marked=value=>value===false||value===0?false:record(value)&&Object.keys(value).length>0?Object.values(value).some(marked):true;
  const complete=value=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if(marker(key)&&marked(child))throw new Error('Read the complete uploaded clip and lane data before positioning it.');complete(child);}};
  const completeCollections=project=>{for(const collection of ['clips','lanes']){const specific=[],global=[];for(const [key,value]of Object.entries(project)){if(marker(key)&&record(value)&&Object.keys(value).length){if(Object.hasOwn(value,collection))specific.push(value[collection]);}else if(new RegExp(`${collection}.*trunc|trunc.*${collection}`,'i').test(key))specific.push(value);else if(marker(key))global.push(value);}if(specific.some(marked)||!specific.length&&global.some(marked))throw new Error('The canonical audio import project is incomplete.');}};
  const projectScope=value=>{for(const key of ['project_id','projectId'])if(value?.[key]!==undefined&&value[key]!==scope.projectId)throw new Error('Freestyle returned audio import data for a different project.');};
  const check=()=>{if(currentCloudScope(this,scope))return;if(state.uploadAttempted)throw Object.assign(new Error('The audio upload may have completed in the previous cloud project. Inspect that project before importing the file again.'),{code:'audio_import_scope_changed',operationCommitted:state.uploadAcknowledged,importReceipt:copy(state.receipt),projectId:scope.projectId});requireCloudScope(this,scope);};
  const invoke=async(name,args,field)=>{check();if(restMode&&name==='execute_pro_action'&&canonicalRead?._studioApi?.projectId===scope.projectId&&Array.isArray(canonicalRead.clips)&&canonicalRead.truncated?.clips===false&&canonicalRead.clips.find(clip=>!clip.deleted&&!clip.isBacking)?.id===args.track_id){args={...args};delete args.track_id;}const callOptions={...(field?{idempotencyKey:state.requestKeys[field]??=requestKey()}:{}),...(state.currentEtag?{ifMatch:state.currentEtag}:{})};const {response,data:raw,request}=await studioCompatibleRequest(name,args,callOptions);if(field)state[field]=copy(raw);let data=raw?.structuredContent;if(data===undefined&&Array.isArray(raw?.content))try{data=JSON.parse(raw.content.filter(item=>item.type==='text').map(item=>item.text).join('\n'));}catch{throw new Error('Freestyle returned an unreadable audio import receipt.');}data=data??raw;projectScope(raw);projectScope(data);if(restMode&&name==='execute_pro_action'&&args.action==='attach_clip_to_session'&&data.resolvedArgs?.db_track_id!==undefined&&data.resolvedArgs.db_track_id!==state.clipId)throw new Error('The attachment receipt resolved a different saved audio clip.');const payload=data?.response??data;projectScope(payload);if(!response.ok||raw?.isError||data?.error||data?.ok===false||data?.success===false||payload?.error||payload?.ok===false||payload?.success===false)throw Object.assign(cloudOperationError({...raw,structuredContent:data},{status:response.status,fallback:'Freestyle could not finish this audio import request.'}),{studioRequest:copy(request),idempotencyKey:request.idempotencyKey});if(response.ok&&name==='get_project'){const tag=response.headers?.get?.('etag')??data?._studioApi?.etag;if(typeof tag==='string'&&tag&&!/[\u0000-\u001f\u007f]/.test(tag))state.currentEtag=tag;}if(!record(payload)||!Object.keys(payload).length)throw new Error('Freestyle returned no usable audio import receipt.');return copy(payload);};
  const read=async()=>{const data=await invoke('get_project',{project_id:scope.projectId});check();const project=record(data.project)?data.project:data;projectScope(project);if(project.id!==scope.projectId||!Array.isArray(project.clips)||!Array.isArray(project.lanes))throw new Error('Read the canonical audio clips and lanes before finishing this import.');completeCollections(project);complete(project.clips);complete(project.lanes);canonicalRead=project;const clips=project.clips.filter(clip=>clip?.id===state.clipId);if(clips.length!==1||!id(clips[0].laneId))throw new Error('The uploaded durable clip is not uniquely confirmed. Inspect its receipt; no upload will be repeated.');const clip=clips[0],matching=project.lanes.filter(lane=>lane.id===clip.laneId);if(matching.length!==1||!['audio','vocal'].includes(matching[0].kind)||laneId!==undefined&&clip.laneId!==laneId)throw new Error('The uploaded clip did not confirm its intended persisted audio lane.');for(const value of [state.receipt?.laneId,state.receipt?.clip?.laneId])if(value!==undefined&&value!==clip.laneId)throw new Error('The upload receipt and canonical clip disagree about their lane.');state.laneId=clip.laneId;state.canonicalClip=copy(clip);return clip;};
  try{
   const encoded=await fileBase64(file);check();const bytes=encoded.length/4*3-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);if(bytes!==file.size)throw new Error('The encoded audio size differs from its selected file.');
   state.status='uploading';state.uploadAttempted=true;let saved;
   // uploadAudio places the clip at start_ms in the same write and, with the
   // project open, attaches it to the live session (engine_attached).
   const uploadArgs={project_id:scope.projectId,filename:file.name,base64:encoded,kind:'audio',title:Array.from(file.name).slice(0,120).join(''),...(laneId!==undefined?{track_id:laneId}:{})},placeInUpload=restMode&&desired!==null&&Number.isSafeInteger(desired)&&desired<=86400000;
   try{
    try{saved=await invoke('upload_audio',placeInUpload?{...uploadArgs,start_ms:desired}:uploadArgs,'uploadAcknowledgement');state.uploadStartRequested=placeInUpload;}
    catch(error){
     // A loopback proxy still holding the previous spec refuses start_ms locally
     // (HTTP 400 validation) before anything is sent; upload once without it and
     // place the clip with the separate timing write below.
     if(!placeInUpload||error.status!==400||!(error.code==='invalid_studio_arguments'||error.stage==='validation'||error.result?.error==='invalid_studio_arguments')||!/start_ms/.test(error.message||''))throw error;
     clientLog('audio-upload-start-ms-unsupported',{projectId:scope.projectId});delete state.requestKeys.uploadAcknowledgement;state.uploadStartRequested=false;
     saved=await invoke('upload_audio',uploadArgs,'uploadAcknowledgement');
    }
    state.receipt=copy(saved);state.uploadAcknowledged=true;state.liveReloadPending=saved.engine_reload_required===true;for(const key of ['engine_attached','engine_reload_required'])if(saved[key]!==undefined&&typeof saved[key]!=='boolean')throw new Error(`Freestyle returned an invalid upload ${key} acknowledgement.`);if(saved.startMs!==undefined&&(!Number.isSafeInteger(saved.startMs)||saved.startMs<0))throw new Error('Freestyle returned an invalid upload startMs.');check();const identities=[saved.clipId,saved.clip?.id].filter(value=>value!==undefined&&value!==null);if(!identities.length||identities.some(value=>!id(value))||new Set(identities).size!==1)throw new Error('The upload returned no consistent durable clipId/clip.id. Inspect its receipt; the file will not be uploaded again.');projectScope(saved.clip);state.clipId=identities[0];}
   catch(error){state.uploadUncertain=!error.explicitRejection&&!state.uploadAcknowledged;state.status=error.explicitRejection?'upload-rejected':state.uploadAcknowledged?'upload-unconfirmed':'upload-uncertain';throw error;}
   state.status='confirming-upload';let clip=await read();check();
   if(desired!==null){if(!finite(clip.startMs)||clip.startMs<0)throw new Error('The uploaded clip has no canonical start time. Its drop placement is pending; no timing value was guessed.');if(clip.startMs!==desired){const before=copy(clip);state.status='positioning';state.placementAttempted=true;state.placementBefore=copy(before);state.placementAction='shift_clip';state.placementReceipt=await invoke('execute_pro_action',{project_id:scope.projectId,track_id:scope.contextTrackId,action:'shift_clip',arguments:{track_id:state.laneId,clip_id:state.clipId,start_ms:desired}},'placementAcknowledgement');for(const [key,value]of [['db_clip_id',state.clipId],['db_track_id',state.laneId]])if(state.placementReceipt[key]!==undefined&&state.placementReceipt[key]!==value)throw new Error('The audio placement receipt identifies a different saved lane or clip.');check();complete(state.placementReceipt);if(state.placementReceipt.engine_reload_required!==undefined&&typeof state.placementReceipt.engine_reload_required!=='boolean')throw new Error('Freestyle returned an invalid audio placement reload acknowledgement.');state.liveReloadPending||=state.placementReceipt.engine_reload_required===true;state.status='confirming-placement';clip=await read();check();const unchanged=['durationSec','audioOffsetSec','volume','muted','audioSourceId','sourceId','audioFileId'].every(key=>!Object.hasOwn(before,key)||JSON.stringify(before[key])===JSON.stringify(clip[key]))&&['audioOffsetSec','audioFullDurationSec'].every(key=>before.effects?.timing?.[key]===undefined||before.effects.timing[key]===clip.effects?.timing?.[key]);if(clip.startMs!==desired||!unchanged)throw new Error('The canonical uploaded clip did not confirm its exact drop time and retained audio window/level. Inspect it; no positioning write will be repeated.');}}
   state.status='persisted';state.persisted=true;state.placementPending=false;
   // Persistence and live attachment are separate acknowledgements. A saved take
   // must never be uploaded again because live loading or its confirmation failed.
   try{
    if(restMode&&saved.engine_attached===true&&saved.engine_reload_required!==true){
     // The upload itself attached the clip to the open session: waveform reads
     // and Pencil edits work at once, so no separate attach request is sent.
     state.attachedByUpload=true;state.engineLoaded=true;state.attachmentPending=false;state.attachmentError=null;state.liveReloadPending=false;state.status='persisted';
    }else if(restMode){
     state.status='attaching';state.attachmentAttempted=true;
     state.attachmentReceipt=await invoke('execute_pro_action',{project_id:scope.projectId,track_id:scope.contextTrackId,action:'attach_clip_to_session',arguments:{db_track_id:state.clipId}},'attachmentAcknowledgement');check();
     const receipt=state.attachmentReceipt;complete(receipt);
     for(const [key,expected]of [['db_clip_id',state.clipId],['clipId',state.clipId],['db_track_id',state.laneId],['laneId',state.laneId]])if(receipt[key]!==undefined&&receipt[key]!==expected)throw new Error('The attachment receipt identifies a different saved lane or clip.');
     const nativeTrack=receipt.mozart_track_id??receipt.track_id,nativeClip=receipt.clip_id;
     if(receipt.mozart_track_id!==undefined&&receipt.track_id!==undefined&&receipt.mozart_track_id!==receipt.track_id||!Number.isSafeInteger(nativeTrack)||nativeTrack<0||!Number.isSafeInteger(nativeClip)||nativeClip<0)throw new Error('Audio is saved; the attachment receipt has not confirmed its native track and clip identities.');
     state.liveIdentity=copy(receipt);state.engineLoaded=true;state.attachmentPending=false;state.attachmentError=null;state.liveReloadPending=false;state.status='persisted';
    }else{
    const liveIdentity=async()=>{const live=await invoke('get_pro_state',{project_id:scope.projectId,track_id:scope.contextTrackId});check();const collection=live.clips,rows=Array.isArray(collection)?collection:collection?.clips;if(!Array.isArray(rows)||record(collection)&&(collection.ok===false||collection.error)||!Array.isArray(collection)&&collection?.ok!==true)throw new Error('Read the complete live clips before confirming audio attachment.');complete(collection);if(Array.isArray(collection)){for(const [key,value]of Object.entries(live))if(marker(key)&&(!record(value)||Object.hasOwn(value,'clips'))&&marked(record(value)?value.clips:value))throw new Error('Read the complete live clips before confirming audio attachment.');}const matches=rows.filter(row=>row?.db_clip_id===state.clipId);if(matches.length>1)throw new Error('The uploaded clip has ambiguous live identities.');if(!matches.length)return null;const row=matches[0];if(!Number.isInteger(row.mozart_track_id)||row.mozart_track_id<0||!Number.isInteger(row.clip_id)||row.clip_id<0||row.db_track_id!==undefined&&row.db_track_id!==state.laneId)throw new Error('The uploaded clip has no consistent live track/clip identity.');return copy(row);};
    state.status='checking-attachment';let identity=await liveIdentity();
    if(!identity){
     state.status='discovering-attachment';const capability=await invoke('list_pro_capabilities',{action:'attach_clip_to_session'});check();const schema=capability.argumentSchema,field=schema?.properties?.db_track_id;
     if(capability.name!=='attach_clip_to_session'||capability.family!=='timeline'||capability.method!=='POST'||capability.mutates!==true||capability.destructive===true||capability.requiresConfirmation===true||schema?.type!=='object'||!record(schema.properties)||field?.type!=='string'||!Array.isArray(schema.required)||schema.required.length!==1||schema.required[0]!=='db_track_id'||Object.keys(schema).some(key=>!['type','properties','required','additionalProperties'].includes(key))||schema.additionalProperties!==false||Object.keys(field).some(key=>!['type','x-inferred'].includes(key)))throw new Error('Freestyle has not supplied the verified saved-clip attachment contract.');
     state.status='attaching';state.attachmentAttempted=true;
     try{state.attachmentReceipt=await invoke('execute_pro_action',{project_id:scope.projectId,track_id:scope.contextTrackId,action:'attach_clip_to_session',arguments:{db_track_id:state.clipId}},'attachmentAcknowledgement');check();}
     catch(error){if(error.status!==409)throw error;state.attachmentConflict=true;state.attachmentError=error.message;}
     state.status='confirming-attachment';identity=await liveIdentity();if(!identity)throw new Error('Audio is saved, but the live session has not confirmed its exact clip identity.');
     for(const [key,value]of [['track_id',identity.mozart_track_id],['clip_id',identity.clip_id]])if(state.attachmentReceipt?.[key]!==undefined&&state.attachmentReceipt[key]!==value)throw new Error('The attachment receipt and fresh live clip identity disagree.');
    }
    state.liveIdentity=identity;state.engineLoaded=true;state.attachmentPending=false;state.attachmentError=null;state.liveReloadPending=false;state.status='persisted';
    }
   }catch(error){state.attachmentPending=true;state.attachmentError=error.message;state.attachmentErrorCode=error.code??null;state.attachmentErrorStage=error.stage??null;state.attachmentUncertain=state.attachmentAttempted&&!error.explicitRejection;state.status='attachment-pending';}
   if(saved.engine_reload_required===true&&state.attachmentPending)this.liveReloadRequired({projectId:scope.projectId,warning:'Audio saved; the live session could not load it yet. Reloading the session.'});
   return{...saved,clipId:state.clipId,laneId:state.laneId,persisted:true,placementPending:false,liveReloadPending:state.liveReloadPending,engineLoaded:state.engineLoaded,attachmentPending:state.attachmentPending,attachmentError:state.attachmentError,attachmentReceipt:copy(state.attachmentReceipt),liveIdentity:copy(state.liveIdentity??null)};
  }catch(error){if(state.uploadAcknowledged&&state.placementAttempted)error.message=`Audio saved; placement is unconfirmed. ${error.message} Inspect the saved clip before moving it again; do not upload the file again.`;state.error=error.message;state.errorCode=error.code??null;state.errorStage=error.stage??null;state.engineStatus=error.engineStatus??null;if(!state.uploadAttempted)state.status='encoding-failed';else if(state.placementAttempted)state.status=state.placementReceipt?'placement-unconfirmed':error.explicitRejection?'placement-rejected':'placement-uncertain';else if(state.uploadAcknowledged)state.status='upload-unconfirmed';throw Object.assign(error,{operationAttempted:state.uploadAttempted,operationCommitted:state.uploadAcknowledged,operationUncertain:state.uploadAttempted&&!state.persisted&&!error.explicitRejection,importReceipt:copy(state.receipt),projectId:scope.projectId,audioImport:{...copy({...state,file:undefined}),file}});}
 }
 async importDawProject(file,format){if(file.size>25*1024*1024)throw new Error('Cloud DAW project imports are limited to 25 MB.');const tools=await(await hostFetch('/api/tools')).json(),schema=tools.tools.find(t=>t.name==='import_daw_project')?.inputSchema?.properties||{};const args={base64:await fileBase64(file),filename:file.name};if(schema.title)args.title=file.name.replace(/\.[^.]+$/,'');if(schema.format)args.format=format||(/\.flp$/i.test(file.name)?'flp':'logic');const r=await api('import_daw_project',args);const id=r.project?.id||r.projectId;if(id){if(typeof freestyleHost()?.openProject==='function')await this.openViaHost(id);else await this.load(id);}return r;}
 // Studio API mode mirrors Pro: durable lane_id with track_id:-1 over the open
 // ordered channel for immediate sound; the debounced REST flush still persists.
 sendStudioRealtimeChanges(old,next){if(!old)return;const scope=this.liveControl.scope();if(!scope)return;for(const c of next?.channels||[]){const before=old.channels?.find(x=>x.id===c.id);if(!before||c.patternSource||typeof c.laneId!=='string'||!c.laneId)continue;for(const message of [c.volume!==before.volume?liveLaneGainMessage(c.laneId,c.volume):null,c.mute!==before.mute?liveLaneToggleMessage(c.laneId,'mute',c.mute):null,c.solo!==before.solo?liveLaneToggleMessage(c.laneId,'solo',c.solo):null])if(message)this.liveControl.set(message,{scope});}}
 sendRealtimeChanges(old,next){if(next?.cloud?.rawState?.studioApi===true||this.session.rawState?.studioApi===true){this.sendStudioRealtimeChanges(old,next);return;}if(this.monitor.state!=='connected'||!this.monitor.sendControl||!old)return;for(const c of next.channels||[]){const before=old.channels.find(x=>x.id===c.id);if(!before||c.patternSource||c.engineTrackId==null)continue;const base={track_id:c.engineTrackId,lane_id:c.laneId};try{if(c.volume!==before.volume)this.monitor.sendControl({type:'set_track_gain',...base,gain:c.volume});if(c.mute!==before.mute)this.monitor.sendControl({type:'set_track_muted',track_id:-1,lane_id:c.laneId,muted:c.mute});if(c.solo!==before.solo)this.monitor.sendControl({type:'set_track_soloed',track_id:-1,lane_id:c.laneId,soloed:c.solo});}catch(e){this.onStatus(e.message);}}}
 async startRecording({laneId,loopTakes=null,beforeTake=null}={}){
  if(this.recordingContext||this.recorder.recording||['connecting','stopping'].includes(this.recorder.state))throw new Error('A microphone take is already being captured or saved.');
  const scope=cloudScope(this);requireCloudScope(this,scope);const context={...scope,state:'starting'};this.recordingContext=context;
  const check=()=>{requireCloudScope(this,scope);if(this.recordingContext!==context||context.cancelled)throw Object.assign(new Error('Microphone capture was cancelled before it began.'),{name:'AbortError'});};
  try{
   await this.flush();check();
   const lanes=this.session.rawProject?.lanes||this.project?.cloud?.rawProject?.lanes||[],audio=lanes.filter(lane=>['audio','vocal'].includes(lane.kind));
   const lane=laneId?audio.find(lane=>lane.id===laneId):audio.find(lane=>lane.id===scope.contextTrackId)||audio[0];
   if(!lane)throw new Error('Choose or create a saved audio lane before recording.');
   const bpm=Number(this.project?.bpm),position=this.session.positionAt?.(),start=position?.seconds;
   if(!Number.isFinite(bpm)||bpm<=0||typeof start!=='number'||!Number.isFinite(start)||start<0)throw new Error('Freestyle has not supplied an authoritative recording position and tempo.');
   Object.assign(context,{laneId:lane.id,bpm,songStartSec:start,lastSongSec:start});
   const starting=this.recorder.start(scope.projectId,scope.contextTrackId,{songStartSec:start,laneId:lane.id,songClock:()=>{if(currentCloudScope(this,scope)){const seconds=this.session.positionAt?.().seconds;if(typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>=0)context.lastSongSec=seconds;}return context.lastSongSec;},allowCaptureOnly:true,loopTakes,beforeTake:typeof beforeTake==='function'?async info=>{const held=await beforeTake(info);if(Number.isFinite(Number(held?.songStartSec))){context.songStartSec=Math.max(0,Number(held.songStartSec));context.lastSongSec=context.songStartSec;}return held;}:null});
   context.recorderGeneration=this.recorder.generation;const result=await starting;
   if(result===false)throw Object.assign(new Error('Microphone capture was cancelled before it began.'),{name:'AbortError'});
   check();context.state='recording';
   if(result.warning)this.onStatus(result.warning);return result;
  }catch(error){if(this.recordingContext===context){this.recordingContext=null;if(context.recorderGeneration!==undefined&&context.recorderGeneration===this.recorder.generation)Promise.resolve(this.recorder.cancel?.()).catch(cleanup=>this.onStatus(cleanup.message));}throw error;}
 }
 cancelRecording(){
  const context=this.recordingContext;if(!context)return Promise.resolve();
  if(context.state!=='starting')return Promise.reject(new Error('Stop and save the active take before cancelling its context.'));
  context.cancelled=true;context.state='cancelled';this.recordingContext=null;
  return context.recorderGeneration!==undefined&&context.recorderGeneration===this.recorder.generation?Promise.resolve(this.recorder.cancel()):Promise.resolve();
 }
 stopRecording({songEndSec,captureEndSec}={}){
  const context=this.recordingContext;if(!context)return Promise.reject(new Error('No captured microphone context is available.'));
  if(context.stopPromise)return context.stopPromise;
  context.state='stopping';
  context.stopPromise=(async()=>{
   try{
    const position=currentCloudScope(this,context)?this.session.positionAt?.():null;
    const nativeSave=this.session.rawState?.studioApi===true;
    const take=await this.recorder.stop({songEndSec:Number.isFinite(Number(songEndSec))?Number(songEndSec):position?.seconds,captureEndSec,keepUplink:nativeSave});
    this.lastTake={...take,persisted:false};
    if(take.projectId!==context.projectId||take.contextTrackId!==context.contextTrackId||context.recorderGeneration!==undefined&&take.generation!==context.recorderGeneration)throw Object.assign(new Error('The captured microphone take belongs to a different recording attempt. The file is retained for recovery.'),{code:'recording_take_scope_changed'});
    const captured={projectId:context.projectId,contextTrackId:context.contextTrackId,laneId:context.laneId,bpm:context.bpm,songStartSec:context.songStartSec,loadVersion:context.loadVersion,contextVersion:context.contextVersion,recorderGeneration:context.recorderGeneration};
    // Public Studio API: the take was streamed to the engine on the live-ingest uplink, so the engine
    // itself saves it as a clip (finalizeRecording). The browser-side file stays only as a recovery copy.
    if(this.session.rawState?.studioApi===true&&take.stopSent&&take.mode!=='capture-upload'){
     this.onStatus('Saving the take in Freestyle…');
     // Issue #4: wait_for "placed" answers once the clip is on its lane (about a second after take_stop); the take is
     // captured by then, so the uplink closes and the scan/store result is confirmed in the background.
     let saved;try{saved=await this.finalizeNativeTake(context,take);}finally{Promise.resolve(this.recorder.finishUplink?.(take.takeId)).catch(()=>{});}
     const savePending=saved.saved!==true;
     this.lastTake={...take,...saved,persisted:true,savePending,projectId:context.projectId};
     try{this.onTakePlaced?.({takeId:take.takeId,clipId:saved.track_id||null,laneId:saved.lane_id||context.laneId,startSec:Number(saved.start_ms)/1000,durationSec:Number(saved.duration_sec),saved:!savePending,projectId:context.projectId});}catch{}
     if(currentCloudScope(this,context))await this.session.refresh();
     if(savePending)this.confirmNativeTake(context,take,saved);
     return{persisted:true,savePending,uploaded:false,native:true,take,saved,clipId:saved.track_id||saved.clip_id||null,laneId:saved.lane_id||context.laneId,projectId:context.projectId,currentProject:currentCloudScope(this,context)};
    }
    const transaction=new CloudRecordingPersistence({context:captured,file:take.file,call:(name,args)=>this.session.call(name,args),encodeFile:fileBase64});
    context.transaction=transaction;(this.recordingTakes??=[]).push({context,take,transaction});
    this.onStatus('Uploading the microphone take to Freestyle…');const result=await transaction.persist();
    this.lastTake={...take,...result,projectId:context.projectId};
    if(result.persisted!==true)throw Object.assign(new Error('The recording was uploaded, but its saved timeline placement is still unconfirmed. The captured file and upload receipt are retained.'),{code:'recording_placement_pending',operationCommitted:result.uploaded===true,recordingPersistence:transaction.snapshot()});
    if(currentCloudScope(this,context))await this.session.refresh();
    return{...result,take,saved:result.saved||result.receipt,projectId:context.projectId,currentProject:currentCloudScope(this,context)};
   }catch(error){Promise.resolve(this.recorder.finishUplink?.(this.lastTake?.takeId)).catch(()=>{});if(this.lastTake?.file&&context.transaction)this.lastTake={...this.lastTake,persistence:context.transaction.snapshot()};throw error;}
   finally{if(this.recordingContext===context)this.recordingContext=null;}
  })();return context.stopPromise;
 }
 /** finalizeRecording (recording-finalize.js) through the generated Studio API client, with the take id sent in take_start. */
 finalizeCall(context){return args=>this.session.call('execute_pro_action',{project_id:context.projectId,track_id:context.contextTrackId,action:'finalize_recording',confirmed_destructive:true,arguments:args});}
 finalizeNativeTake(context,take,options){return placeTake(this.finalizeCall(context),take.takeId,options);}
 /** Background half of issue #4: the same take_id until saved:true. A final refusal means Freestyle removed the placed clip. */
 confirmNativeTake(context,take,placed,options){
  const started=performance.now();
  const job=confirmSaved(this.finalizeCall(context),take.takeId,options).then(body=>{
   if(this.lastTake?.takeId===take.takeId)this.lastTake={...this.lastTake,...body,savePending:false};
   const info={takeId:take.takeId,saved:true,clipId:body.track_id||placed.track_id||null,confirmMs:Math.round(performance.now()-started),projectId:context.projectId};
   this.onTakeSaved?.(info);return info;
  },async error=>{
   if(this.lastTake?.takeId===take.takeId)this.lastTake={...this.lastTake,savePending:false,saveError:error.message};
   if(currentCloudScope(this,context))await this.session.refresh().catch(()=>{});
   const info={takeId:take.takeId,saved:false,clipId:placed.track_id||null,code:error.code||null,message:error.message,projectId:context.projectId};
   this.onTakeSaved?.(info);return info;
  });
  this.takeConfirmation=job;return job;
 }
 async listenPreview(){await this.flush();return this.session.listen({lengthSec:12,startSec:this.beat*60/(this.project?.bpm||120)});}
 async pluginParameters(channel,pluginIndex=0){return api('get_plugin_state',{project_id:this.projectId,track_id:channel.laneId||this.session.trackId,lane_id:channel.laneId||channel.id,plugin_index:pluginIndex,include_parameters:true});}
 async setPluginParameter(channel,pluginIndex,index,value){return api('set_plugin_parameter',{project_id:this.projectId,track_id:channel.laneId||this.session.trackId,lane_id:channel.laneId||channel.id,plugin_index:pluginIndex,parameter_index:index,value_norm:value});}
}
async function fileBase64(file){const a=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<a.length;i+=8192)binary+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(binary);}
