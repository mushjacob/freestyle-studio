/** UI-facing cloud controller. Every sound and project mutation is handled by Freestyle. */
import {CloudSession,assertCompletePattern} from './cloud-session.js';
import {assertPreviewScheduled,patternPreviewPosition,patternPreviewOptions} from './preview-clock.js';
import {CloudMonitor} from './cloud-monitor.js';
import {CloudRecorder} from './cloud-recorder.js';
import {CloudTransport} from './cloud-transport.js';
import {importCloudAudio} from './cloud-audio-import.js';
import {LiveInstrument} from './piano-roll-live.js';
import {bridgeFetch,openHostProject} from './freestyle-host-transport.js';
const clone=v=>JSON.parse(JSON.stringify(v));
/** 409 recording_take_pending: the take is still being captured / saved; finalize again with the same take id. */
const isTakePending=error=>(error?.code||error?.result?.error?.code||error?.details?.code)==='recording_take_pending'||/recording_take_pending|still being saved/.test(error?.message||'');
function unpack(result){const d=result.structuredContent||JSON.parse((result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')||'{}');if(result.isError||d.ok===false||d.error)throw new Error(d.error||d.message||'Cloud operation failed.');return d.response||d;}
async function api(name,args){const r=await bridgeFetch('modesty-bridge:/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})});const d=await r.json();if(!r.ok)throw new Error(d.detail||d.error);return unpack(d);}
export class CloudEngine{
 constructor({session=new CloudSession(),monitor=new CloudMonitor(),realtime=null}={}){this.session=session;this.monitor=monitor;this.realtime=realtime;this.realtimeContext=null;this.recorder=new CloudRecorder();this.heldNotes=new Map();this.ready=false;this.projectId='';this.playing=false;this.beat=0;this.mode='song';this.snapshot=null;this.pending=null;this.applying=false;this.onProject=()=>{};this.onTick=()=>{};this.onError=()=>{};this.onStatus=()=>{};this.onEnded=()=>{};this.levels=new Map();this.monitor.addEventListener('meters',e=>{const d=e.detail;if(d.master!=null)this.levels.set('master',Number(d.master)||0);for(const t of d.tracks||[]){if(Array.isArray(t)){this.levels.set(String(t[0]),Number(t[2])||0);if(t[1])this.levels.set(String(t[1]),Number(t[2])||0);}else this.levels.set(String(t.lane_id||t.track_id||t.id),Number(t.post_fader_peak??t.peak??t.level)||0);}for(const [id,value]of Object.entries(d.buses||{}))this.levels.set(id,Number(value)||0);});
 this.session.addEventListener('state',e=>{this.playing=this.previewing?this.positionAt().playing:this.session.playing;if(!this.loading&&!this.applying&&!this.pending&&!this.interacting)this.accept(e.detail.project);});
 this.session.addEventListener('tick',e=>{const position=this.positionAt();this.playing=position.playing;if(position.beat!=null)this.beat=position.beat;this.onTick({...e.detail,...position,step:position.beat==null?-1:Math.floor(position.beat*4),mode:this.mode});});
 this.session.addEventListener('error',e=>this.onStatus(e.detail.message));
 this.monitor.addEventListener('error',e=>this.onStatus(e.detail.message||'Cloud audio monitor failed.'));
 this.monitor.addEventListener('connected',e=>{if(this.monitorReconnecting){this.monitorReconnecting=false;if(!e.detail?.projectId||e.detail.projectId===this.projectId)this.onStatus('Freestyle audio reconnected.');}this.hydrateMonitorSource(e.detail).catch(error=>this.onError(error));if(this.ready&&!this.loading&&e.detail?.projectId===this.projectId)this.startRealtime();});
 this.monitor.addEventListener('reconnecting',e=>{this.monitorReconnecting=true;if(!e.detail?.projectId||e.detail.projectId===this.projectId)this.onStatus('Reconnecting Freestyle audio…');});
 this.transportControl=new CloudTransport({monitor:this.monitor,restOnly:false,fallbackRoute:'studio-api',getProjectId:()=>this.projectId,getTrackId:()=>this.transportContextTrackId(),fallback:(command,options,context)=>this.session.transport(command,options,{projectId:context.projectId,...(context.trackId&&context.trackId!==this.session.trackId?{trackId:context.trackId}:{}),signal:context.signal})});
 this.monitor.addEventListener('clock',e=>{if(!this.ready||this.loading||e.detail?.project_id!==this.projectId||this.realtimeClockFresh())return;this.session.acceptClock?.(e.detail,{generation:this.monitor.generation});});
 if(this.realtime){this.realtime.addEventListener('clock',e=>{const context=this.realtimeContext;if(!this.realtimeContextCurrent(context)||context.clientGeneration!==this.realtime.generation||e.detail?.project_id!==context.projectId)return;this.session.acceptClock?.(e.detail,{generation:'studio:'+this.realtime.clockGeneration});});this.realtime.addEventListener('warning',e=>{if(this.realtimeContextCurrent(this.realtimeContext))this.noteRealtime(e.detail||{},e.detail?.message||'Realtime push is unavailable; transport reads remain available.');});}

 }
 accept(p){if(this.selectedPattern&&p.patterns.some(x=>x.id===this.selectedPattern))p.selectedPattern=this.selectedPattern;this.snapshot=clone(p);this.project=p;this.sampleRate=p.cloud?.rawState?.transport?.sample_rate||48000;this.onProject(clone(p));if(this.ready&&!this.loading){if(this.realtime)this.startRealtime();this.warmMonitor();}}
 realtimeScope(){return {projectId:this.projectId,editTrackId:this.session.trackId||'',sourceTrackId:this.session.clockContextTrackId?.()||this.monitorContextTrackId()||undefined,loadVersion:this.loadVersion||0,contextVersion:this.session.contextVersion||0};}
 realtimeContextCurrent(context){if(!context||!this.ready||this.loading||this.session.closed||this.session.projectId&&this.session.projectId!==context.projectId)return false;const current=this.realtimeScope();return ['projectId','editTrackId','sourceTrackId','loadVersion','contextVersion'].every(key=>Object.is(current[key],context[key]));}
 realtimeClockFresh(){return !!(this.realtime&&this.realtimeContextCurrent(this.realtimeContext)&&this.realtimeContext.clientGeneration===this.realtime.generation&&this.realtime.hasFreshClock?.());}
 /** A realtime-push problem. The per-user interactive-session cap (other tabs / apps of the same account hold the
  *  sessions) is not an error of this project — playback, editing and the monitor clock keep working — so it is kept
  *  for Diagnostics instead of the status line. Anything else is shown. */
 noteRealtime(problem,message){const text=String(problem?.message||''),sessionCap=problem?.code==='too_many_sessions'||/interactive sessions may be open|too_many_sessions/i.test(text);this.realtimeNotice={at:Date.now(),code:problem?.code||(sessionCap?'too_many_sessions':null),message,quiet:sessionCap};if(!sessionCap)this.onStatus(message);return sessionCap;}
 startRealtime(){
  if(!this.realtime||!this.ready||this.loading||!this.projectId||this.session.closed)return null;
  // The upstream engine session serves its bootstrap requests one after
  // another: a realtime session opened while the silent peer is still
  // negotiating delays POST /monitor/offer. Open it once the peer settles.
  const warm=this.monitorWarmup||this.initialMonitorWarmup;
  if(warm&&!warm.settled&&warm.projectId===this.projectId){if(!this.realtimeDeferred){const deferred=this.realtimeDeferred={warm};let timer;Promise.race([warm.promise,new Promise(resolve=>{timer=setTimeout(resolve,20000);})]).catch(()=>{}).finally(()=>{clearTimeout(timer);if(this.realtimeDeferred===deferred){this.realtimeDeferred=null;this.startRealtime();}});}return null;}
  const scope=this.realtimeScope(),existing=this.realtimeContext;if(existing&&this.realtimeContextCurrent(existing)&&existing.clientGeneration===this.realtime.generation&&['connecting','connected'].includes(this.realtime.state))return existing.promise;
  this.realtimeNotice=null;const context=this.realtimeContext={...scope,clientGeneration:null,promise:null};let pending;try{pending=this.realtime.start(scope.projectId,{...(scope.editTrackId?{trackId:scope.editTrackId}:{})});context.clientGeneration=this.realtime.generation;}catch(error){this.realtimeContext=null;this.onStatus('Realtime push is unavailable; transport reads remain available.');return null;}
  context.promise=Promise.resolve(pending).catch(error=>{if(this.realtimeContext===context&&this.realtimeContextCurrent(context)&&error.name!=='AbortError')this.noteRealtime(error,'Realtime push is unavailable: '+error.message+'; transport reads remain available.');return false;});return context.promise;
 }
 stopRealtime(){this.realtimeContext=null;this.realtimeDeferred=null;if(!this.realtime)return Promise.resolve();try{return Promise.resolve(this.realtime.stop()).catch(()=>{});}catch{return Promise.resolve();}}
 applyPatternSplitReceipt(payload,{projectId=this.projectId,trackId=this.session.trackId,loadVersion=this.loadVersion||0,contextVersion=this.session.contextVersion||0,...scope}={}){
  if(!this.ready||this.loading||this.applying||this.pending||this.projectId!==projectId||this.session.trackId!==trackId||(this.loadVersion||0)!==loadVersion)throw new Error('The cloud project changed or has pending edits; reload its committed pattern receipt.');
  const project=this.session.applyPatternSplitReceipt(payload,{...scope,projectId,trackId,contextVersion});
  if(this.project!==project)this.accept(project);return project;
 }
 load(projectId,trackId){return this.transitionProject(()=>this.performLoad(projectId,trackId));}
 transitionProject(load){
  this.cancelInitialMonitorWarmup();
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
   }finally{if(version===this.loadVersion){this.loading=false;if(this.ready){this.startRealtime();this.warmMonitor();}}}
  });
  return this.loadQueue;
 }
 async performLoad(projectId,trackId,{createTitle}={}){
  this.onStatus(createTitle!==undefined?'Creating a Freestyle cloud project…':'Loading Freestyle cloud session…');this.realtime?.subscribeClock?.(false);clearTimeout(this.timer);this.timer=null;
  const version=this.loadVersion||0;let earlyWarm=null,painted=false;this.provisionalProjectId=null;
  const previous={ready:this.ready,projectId:this.projectId,playing:this.playing,previewing:this.previewing,beat:this.beat,selectedPattern:this.selectedPattern,project:this.project,snapshot:this.snapshot};
  const context={};for(const key of ['projectId','trackId','project','rawProject','rawState','playing','positionSeconds','positionObserved','closed','liveClock','explicitClock','transportObservationVersion','loopIterations','loopEnabled','loopStartSec','loopEndSec','clockSource','transportBpm','playRange','producerLagSec','lastTransportAppliedAt','transportGuard'])context[key]=this.session[key];
  this.ready=false;this.transportControl.cancel('The cloud project is changing.','transport_scope_changed');this.session.close?.();let p;
  const onCanonicalAudio=context=>{
   if(previous.ready||earlyWarm||version!==(this.loadVersion||0)||this.monitor.active||!['idle','error','disconnected'].includes(this.monitor.state)||typeof this.monitor.start!=='function')return;
   earlyWarm=this.beginInitialMonitorWarmup(context,version);
  };
  try{const onCanonicalProject=canonical=>{if(version!==(this.loadVersion||0)||this.ready)return;painted=true;this.provisionalProjectId=canonical.cloud?.projectId||canonical.id;this.onProject(clone(canonical));this.onStatus('Project shown — connecting the Freestyle engine… Editing and playback unlock when it is ready.');};
  p=createTitle!==undefined?await this.session.create(createTitle):await this.session.load(projectId,trackId,{onCanonicalAudio,onCanonicalProject});projectId=this.session.projectId||projectId;if(version!==(this.loadVersion||0))throw Object.assign(new Error('A newer cloud load superseded this startup.'),{name:'AbortError',code:'cloud_load_scope_changed'});}
  catch(error){
   this.cancelInitialMonitorWarmup(earlyWarm);
   Object.assign(this.session,context);Object.assign(this,previous);
   if(previous.ready&&!context.closed){this.session.startTicking?.();this.realtime?.subscribeClock?.(true);}
   this.provisionalProjectId=null;
   if(previous.project)this.onProject(clone(previous.project));
   // A provisional first paint never outlives a failed or superseded load.
   else if(painted&&version===(this.loadVersion||0))this.onProject({version:2,title:'Connect a Freestyle project',bpm:120,master:1,metronome:false,loop:true,selectedPattern:'empty',channels:[],patterns:[],clips:[],audioClips:[]});
   throw error;
  }
  // Only retire the old audio connection after the replacement context is valid.
  const keepEarly=earlyWarm&&!earlyWarm.cancelled&&earlyWarm.generation===this.monitor.generation&&earlyWarm.projectId===projectId&&this.session.clockContextTrackId?.({fallback:false})===earlyWarm.trackId&&this.monitor.projectId===projectId;
  this.releaseNotes();if(keepEarly){earlyWarm.adopted=true;this.initialMonitorWarmup=null;this.monitorWarmup=earlyWarm;}else{this.cancelInitialMonitorWarmup(earlyWarm);this.monitor.stop();this.monitorWarmup=null;}this.stopRealtime();this.levels.clear();this.previewing=false;
  this.projectId=projectId;this.ready=true;this.rangePlayback=null;this.pausedRange=null;this.playing=!!this.session.playing;
  this.beat=(Number(this.session.positionSeconds)||0)*(Number(p.bpm)||120)/60;
  this.selectedPattern=p.clips[0]?.patternId||p.selectedPattern;this.accept(p);
  // The open project is owned by the Freestyle host; nothing is remembered locally.
  this.onStatus(p.cloud?.nativeUnavailable?'Saved project loaded; live audio needs verification':'Freestyle cloud project loaded');
  return p;
 }
 /** Persisted (native-independent) reads may run for the painted canonical
  * project while the native engine is still connecting; edits/playback may not. */
 canonicalReadable(projectId){const s=this.session;if(!projectId||!s||s.closed||typeof s.call!=='function'||(s.projectId&&s.projectId!==projectId))return false;if(this.ready&&!this.loading)return !this.projectId||this.projectId===projectId;return !!this.loading&&this.provisionalProjectId===projectId;}
 canonicalScope(){return this.loading&&this.provisionalProjectId?this.provisionalProjectId:this.projectId;}
 connecting(){return !!this.loading&&!!this.provisionalProjectId;}
 /** Inside Freestyle a new project is opened through the app (host.openProject); this view follows its "project" event. */
 async create(title='Modesty session'){const data=await api('create_project',{title});const id=data?.project?.id||data?.projectId||data?.id;if(typeof id!=='string'||!id)throw new Error('Freestyle did not return the new project id.');await openHostProject(id);return data;}
 monitorContextTrackId(){const audioClips=(this.project?.audioClips||[]).filter(clip=>typeof clip.cloudId==='string'&&clip.cloudId&&clip.cloudId!=='backing');return (audioClips.find(clip=>clip.cloudId===this.session.trackId||clip.laneId===this.session.trackId)||audioClips[0])?.cloudId||this.session.trackId;}
 transportContextTrackId(){return this.monitor.projectId===this.projectId&&this.monitor.state!=='idle'&&this.monitor.trackId?this.monitor.trackId:this.monitorContextTrackId();}
 async startMonitor(){if(!this.ready||!this.projectId)throw new Error('Select or create a Freestyle cloud project first.');return this.monitor.start(this.projectId,this.monitorContextTrackId());}
 beginInitialMonitorWarmup(context,loadVersion){
  const {projectId,trackId,editTrackId,contextVersion}=context;
  if(this.ready||!this.loading||this.session.closed||this.session.projectId!==projectId||this.session.trackId!==editTrackId||this.session.contextVersion!==contextVersion||loadVersion!==(this.loadVersion||0))return null;
  const key=JSON.stringify([projectId,trackId,loadVersion,contextVersion]),job={key,projectId,trackId,loadVersion,contextVersion,generation:null,settled:false,promise:null,cancelled:false,adopted:false};this.initialMonitorWarmup=job;
  const current=()=>!job.cancelled&&loadVersion===(this.loadVersion||0)&&!this.session.closed&&this.session.projectId===projectId&&this.session.contextVersion===contextVersion&&this.monitor.generation===job.generation;
  this.monitor.setOutputWanted?.(false,{projectId});
  let opening;try{opening=this.monitor.start(projectId,trackId);job.generation=this.monitor.generation;}catch(error){job.error=error.message;job.settled=true;job.promise=Promise.resolve(false);return job;}
  job.promise=Promise.resolve(opening).then(value=>current()&&value!==false).catch(error=>{if(current())job.error=error.message;return false;}).finally(()=>{job.settled=true;});return job;
 }
 cancelInitialMonitorWarmup(job=this.initialMonitorWarmup){
  if(!job||job.adopted||job.cancelled)return;job.cancelled=true;if(this.initialMonitorWarmup===job)this.initialMonitorWarmup=null;
  if(job.generation===this.monitor.generation&&job.projectId===this.monitor.projectId){this.monitor.setOutputWanted?.(false,{projectId:job.projectId});this.monitor.stop();}
 }
 /** The Freestyle Studio opens its receive/control peer during project loading, before
  * Play. Warm only a validated loaded source; this never starts transport or
  * changes the editing lane. A blocked autoplay sink retains its live peer. */
 warmMonitor(){
  if(!this.ready||this.loading||this.session.closed||typeof this.monitor.start!=='function')return null;
  const projectId=this.projectId,trackId=this.monitorContextTrackId(),clip=this.project?.audioClips?.find(clip=>clip.cloudId===trackId);
  // Inside Freestyle the offer goes straight to the project's Mozart session
  // (already loaded by the Default studio), so no loaded context clip is needed.
  const embedded=(()=>{try{return !!(globalThis.parent?.__freestyleStudioHost||globalThis.__freestyleStudioHost);}catch{return false;}})();
  if(!projectId||this.session.projectId&&this.session.projectId!==projectId||!embedded&&(!clip||clip.engineLoaded!==true))return null;
  const key=JSON.stringify([projectId,trackId,this.loadVersion||0,this.session.contextVersion||0]);
  if(this.monitorWarmup?.key===key)return this.monitorWarmup.promise;
  // The receive clip is independent of the editor lane. Keep a usable peer
  // when a selection moves; reconnect only after its source/context retires.
  if(this.monitor.projectId===projectId&&['connected','blocked','connecting'].includes(this.monitor.state)&&this.project.audioClips.some(row=>row.cloudId===this.monitor.trackId&&row.engineLoaded===true))return this.monitor.opening?.promise??Promise.resolve(this.monitor.state==='connected');
  if(this.monitor.matchesRequestedContext?.(projectId,trackId)&&['connected','blocked','connecting'].includes(this.monitor.state))return this.monitor.opening?.promise??Promise.resolve(this.monitor.state==='connected');
  const job=this.monitorWarmup={key,projectId,trackId,generation:null,settled:false,promise:null},current=()=>this.monitorWarmup===job&&this.ready&&!this.loading&&this.projectId===projectId&&key===JSON.stringify([this.projectId,this.monitorContextTrackId(),this.loadVersion||0,this.session.contextVersion||0]);
  this.monitor.setOutputWanted?.(false,{projectId});
  let opening;try{opening=this.monitor.start(projectId,trackId);job.generation=this.monitor.generation;}catch(error){job.error=error.message;job.settled=true;job.promise=Promise.resolve(false);return job.promise;}
  job.promise=Promise.resolve(opening).then(result=>current()&&result!==false).catch(error=>{if(current())job.error=error.message;return false;}).finally(()=>{job.settled=true;});return job.promise;
 }
 silenceMonitorSink(){this.monitor.setOutputWanted?.(false,{projectId:this.projectId});if(this.monitor.projectId!==this.projectId)return;try{this.monitor.audio?.pause();}catch{}}
 async hydrateMonitorSource(detail){
  const s=this.session,projectId=this.projectId;
  if(!this.ready||this.loading||this.interacting||this.applying||this.pending||s.closed||s.projectId!==projectId||detail?.projectId!==projectId||!detail.trackId)return false;
  const clip=this.project?.audioClips?.find(row=>row.cloudId===detail.trackId);
  // A media connection chooses a source clip, independently of the editor's
  // lane context. It does not reload an already attached native audio clip.
  if(!clip||clip.engineLoaded===true)return false;
  const context=JSON.stringify([projectId,s.trackId,this.loadVersion||0,s.contextVersion||0,this.monitor.generation||0]);
  const current=()=>this.ready&&!this.loading&&!s.closed&&s.projectId===projectId&&context===JSON.stringify([this.projectId,s.trackId,this.loadVersion||0,s.contextVersion||0,this.monitor.generation||0]);
  if(this.monitorHydration?.context===context)return this.monitorHydration.promise;
  const job={context,promise:null};this.monitorHydration=job;
  job.promise=(async()=>{try{await this.refresh();return current();}catch(error){if(current())throw error;return false;}finally{if(this.monitorHydration===job)this.monitorHydration=null;}})();
  return job.promise;
 }
 async duplicate(title='Modesty session copy'){
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
   try{const project=await this.performLoad(projectId);copy.loaded=true;return project;}
   catch(error){throw failure(`The project copy was created, but could not be opened: ${error.message}`,'duplicate_load_failed',error);}
  });
  if(result===null)throw Object.assign(new Error('A newer project selection superseded Save As before a copy was requested.'),{name:'AbortError',code:'duplicate_open_superseded',sourceProjectId,duplicateProjectId:null});
  return result;
 }
 update(p){if(!this.ready)return;this.pending=clone(p);clearTimeout(this.timer);this.timer=null;if(!this.interacting)this.timer=setTimeout(()=>this.flush().catch(e=>this.onError(e)),450);}
 flush(){try{this.session.assertNoInProgressWrites?.();}catch(error){return Promise.reject(error);}clearTimeout(this.timer);this.timer=null;if(this.inFlight)return this.inFlight.then(()=>this.pending?this.flush():undefined);if(!this.pending||!this.ready)return Promise.resolve();this.inFlight=this.flushBatch().finally(()=>{this.inFlight=null;});return this.inFlight.then(()=>this.pending?this.flush():undefined);}
 async flushBatch(){const next=this.pending;this.pending=null;this.applying=true;this.onStatus('Sending edits to Freestyle…');document.body.classList.add('cloud-pending');try{const selectionChanged=next.selectedPattern!==this.snapshot.selectedPattern;if(this.geometryHistory?.handles(this.snapshot,next))await this.geometryHistory.commit(this.snapshot,next);else await this.session.applyProject(this.snapshot,next);if(selectionChanged)this.selectedPattern=this.session.project.selectedPattern;this.snapshot=clone(this.session.project);if(!this.pending)this.accept(this.session.project);this.onStatus('Saved in Freestyle');document.body.classList.remove('cloud-error');}catch(e){const queued=!!this.pending;this.pending=null;if(queued)this.queuedRollback=(this.queuedRollback||0)+1;document.body.classList.add('cloud-error');await this.session.refresh().catch(()=>{});if(this.session.project)this.accept(this.session.project);if(queued){this.onStatus('Freestyle rejected an edit; it and the edits queued after it were rolled back to the saved state.');try{e.message+=' Edits queued after it were rolled back.';}catch{}}throw e;}finally{this.applying=false;document.body.classList.remove('cloud-pending');}}
 async refresh(){await this.flush();return this.session.refresh();}
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
  const apply=async(name,args)=>{check();this.rangePlayback=null;this.pausedRange=null;const result=await this.session.action(name,args,{refresh:false});check();if(result?.ok===false||result?.isError||result?.error)throw new Error(result.message||result.error||'Freestyle rejected the loop region.');return result;};
  // Studio's typed loop route owns the live region. Read the actual clock
  // after acknowledgement rather than synthesizing the requested bounds.
  const transport=await apply('set_transport_loop',{enabled,...bounds});
  check();await this.session.refreshTransportClock();check();
  const clock=this.session.positionAt?.()||this.positionAt(),display=this.previewing?this.positionAt():clock;this.playing=display.playing;if(display.beat!=null)this.beat=display.beat;
  if(typeof clock.loopEnabled==='boolean'&&this.snapshot)this.snapshot.loop=clock.loopEnabled;
  this.onTick({...display,step:display.beat==null?-1:Math.floor(display.beat*4),mode:this.mode});
  return {...clock,projectId,receipts:{transport}};
 }
 cancelPendingPlay(message='Cloud playback was cancelled.',code='transport_cancelled',{preserveMonitor=false}={}){
  const attempt=this.playAttempt;this.playVersion=(this.playVersion||0)+1;this.playAttempt=null;
  if(attempt){attempt.cancelled=true;attempt.cancelController?.abort();this.transportControl.cancel(message,code);
   // A pending offer belongs to this attempt. Ordinary Stop must retain a
   // working monitor so the next Play does not renegotiate cloud audio.
   if(!preserveMonitor&&!attempt.monitorSharedWarmup&&attempt.monitorStarting&&this.monitor.state!=='connected'&&this.monitor.generation===attempt.monitorGeneration)this.monitor.stop();
  }
  return attempt;
 }
 async play(p,mode='song',{startSeconds,endSeconds,preview}={}){
  // A Play pressed while the project is still loading starts once it is ready.
  if(this.loading&&this.loadQueue){try{await this.loadQueue;}catch{}p=this.project||p;}
  if(!this.ready)throw new Error(this.loading?'Connecting the Freestyle engine… Playback starts once the live session is ready.':'Select or create a Freestyle cloud project first.');
  if(startSeconds!==undefined&&(!Number.isFinite(startSeconds)||startSeconds<0))throw new Error('Playback start must be a finite nonnegative position in seconds.');
  if(endSeconds!==undefined&&(!Number.isFinite(endSeconds)||startSeconds===undefined||endSeconds<=startSeconds||mode==='pattern'))throw new Error('Selection playback needs ordered finite song start/end seconds.');
  const resumed=this.pausedRange;
  if(startSeconds===undefined&&endSeconds===undefined&&mode==='song'&&resumed){
   if(resumed.projectId!==this.projectId||resumed.trackId!==this.session.trackId||resumed.contextVersion!==(this.session.contextVersion||0))throw Object.assign(new Error('The paused selection belongs to another cloud session.'),{name:'AbortError'});
   const clock=this.positionAt();if(clock.clockAvailable===false||!['live','http','ack'].includes(clock.clockSource)||!Number.isFinite(clock.seconds))throw new Error('Wait for the authoritative paused position before resuming the selection.');
   if(clock.seconds<0||clock.seconds>=resumed.endSec)throw new Error('The paused position is outside the original selection. Stop or choose a new playback start.');
   startSeconds=resumed.pendingStart?Math.max(resumed.startSec,clock.seconds):clock.seconds;endSeconds=resumed.endSec;
  }
  this.pausedRange=null;this.rangePlayback=null;
  const previewOptions=mode==='pattern'?patternPreviewOptions(preview):{};
  if(mode!=='pattern'&&preview!==undefined)throw new Error('Pattern preview options require pattern playback.');
  const preserveMonitor=this.monitor.matchesRequestedContext?.(this.projectId,this.monitorContextTrackId())===true;
  const previous=this.cancelPendingPlay('A newer Play superseded this request.','transport_superseded',{preserveMonitor});
  const projectId=this.projectId,attempt={version:this.playVersion,projectId,cancelController:new AbortController(),...(endSeconds!==undefined?{range:{startSec:startSeconds,endSec:endSeconds}}:{})};this.playAttempt=attempt;
  const checkCurrent=()=>{if(!this.ready||this.projectId!==projectId)throw Object.assign(new Error('The cloud project changed while its audio connection was opening.'),{name:'AbortError',code:'transport_scope_changed'});if(attempt.cancelled||attempt.version!==this.playVersion)throw Object.assign(new Error('Cloud playback was cancelled.'),{name:'AbortError',code:'transport_cancelled'});};
  this.monitor.setOutputWanted?.(true,{projectId});this.monitor.primeOutput?.();
  // Resume an already negotiated sink in the actual Play gesture, before an
  // asynchronous save barrier can consume browser activation. No new offer.
  const retainSink=promise=>{attempt.sinkResume=Promise.resolve(promise).then(value=>attempt.sinkResult={value},error=>attempt.sinkResult={error});};
  if(this.monitor.matchesRequestedContext?.(projectId,this.monitorContextTrackId())&&this.monitor.peer?.connectionState==='connected'&&typeof this.monitor.start==='function'){
   try{retainSink(this.monitor.start(projectId,this.monitorContextTrackId()));}catch(error){attempt.sinkResult={error};attempt.sinkResume=Promise.resolve(attempt.sinkResult);}
  }
  try{
  // CloudSession orders this after an already dispatched preview, before any
  // replacement preview. A late receipt may never revive the cancelled one.
  if(previous?.previewPending){await this.session.action('stop_all_pattern_previews',{}, {refresh:false});checkCurrent();}
  await this.flush();checkCurrent();
  try{
   if(attempt.sinkResult?.error)throw attempt.sinkResult.error;
   const peerReady=()=>this.monitor.state==='connected'||attempt.sinkResume&&this.monitor.peer?.connectionState==='connected'&&this.monitor.state==='blocked'&&!attempt.sinkResult?.error;
   if(!peerReady()){
    const monitorTrackId=this.monitorContextTrackId();
    const warm=this.monitorWarmup;attempt.monitorSharedWarmup=!!(warm&&!warm.settled&&warm.projectId===projectId&&warm.trackId===monitorTrackId&&warm.generation===this.monitor.generation);
    attempt.monitorStarting=true;const opening=this.monitor.start(projectId,monitorTrackId);attempt.monitorGeneration=this.monitor.generation;
    let started;try{started=await opening;}finally{attempt.monitorStarting=false;}checkCurrent();
    if(started===false&&this.monitor.state!=='blocked')throw new Error('The audio connection was cancelled.');
   }
   if(!attempt.sinkResume&&this.monitor.playPermission?.promise)retainSink(this.monitor.playPermission.promise);
   if(attempt.sinkResult?.error)throw attempt.sinkResult.error;
   if(!peerReady())throw new Error(this.monitor.state==='blocked'?'Allow cloud audio playback in the browser, then press Play again.':'The audio connection is not connected.');
  }catch(error){checkCurrent();throw new Error(`Live cloud audio is unavailable: ${error.message}`,{cause:error});}
  checkCurrent();
  const current=this.project||p;this.mode=mode;
  if(mode==='pattern'){
   const chosen=current.patterns.find(x=>x.id===(this.selectedPattern||p.selectedPattern))||current.patterns.find(x=>x.id===current.selectedPattern);
   if(!chosen?.cloudRaw)throw new Error('Create a cloud pattern before previewing.');
   const dto=assertCompletePattern(chosen),generation=this.monitor.generation;
   attempt.previewPending=true;let receipt;
   try{receipt=await this.session.action('preview_pattern',{project_id:projectId,pattern:dto.pattern,bpm:current.bpm,bars:chosen.bars,ppq:dto.ppq||96,length_ticks:dto.lengthTicks||chosen.bars*384,...previewOptions});}catch(error){const rejected=error.result?.response??error.result;if(rejected&&typeof rejected==='object'&&['sample_errors','complete','scheduled_sample_clips'].some(key=>Object.hasOwn(rejected,key)))receipt=rejected;else throw error;}finally{attempt.previewPending=false;}
   if(attempt.cancelled||attempt.version!==this.playVersion)throw Object.assign(new Error('Cloud playback was cancelled.'),{name:'AbortError',code:'transport_cancelled'});
   if(this.projectId!==projectId||!this.ready||this.monitor.generation!==generation)throw Object.assign(new Error('The cloud session changed while its pattern preview was opening.'),{name:'AbortError'});
   this.previewReceipt=receipt;
   try{assertPreviewScheduled(receipt);}catch(error){this.previewing=false;this.playing=false;try{await this.session.action('stop_all_pattern_previews',{}, {refresh:false});}catch(cleanup){this.onStatus(`Pattern preview failed and its cleanup also failed: ${cleanup.message}`);}throw error;}
   this.previewPatternId=chosen.id;this.previewContext={generation,epoch:this.session.liveClock?.payload?.session_epoch,bpm:current.bpm,finiteRepeats:previewOptions.repeat_count!==undefined};this.previewing=true;

  }else {attempt.songTransportDispatched=true;if(endSeconds!==undefined)attempt.rangeDispatched=true;await this.transport(endSeconds!==undefined?'play_range':startSeconds===undefined?'play':'seek_and_play',endSeconds!==undefined?{startSec:startSeconds,endSec:endSeconds}:startSeconds===undefined?{}:{seconds:startSeconds});}
  // A receive element may have a track but no frames until native Play. The Freestyle Studio
  // primes it in the gesture without gating the native command on play().
  // Still require the permission result before reporting this Play complete.
  if(attempt.sinkResume){
   const resumed=await new Promise((resolve,reject)=>{const signal=attempt.cancelController.signal,abort=()=>{signal.removeEventListener('abort',abort);reject(Object.assign(new Error('Cloud playback was cancelled.'),{name:'AbortError',code:'transport_cancelled'}));};if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});attempt.sinkResume.then(result=>{signal.removeEventListener('abort',abort);resolve(result);});});checkCurrent();
   if(resumed.error||resumed.value===false)throw new Error(`Live cloud audio is unavailable: ${resumed.error?.message||'Browser audio playback was cancelled.'}`,{cause:resumed.error});
  }
  if(attempt.cancelled||attempt.version!==this.playVersion||projectId!==this.projectId||!this.ready)throw Object.assign(new Error('Cloud playback was cancelled.'),{name:'AbortError',code:'transport_cancelled'});
  if(endSeconds!==undefined){this.playing=this.positionAt().playing;this.rangePlayback=this.playing?{projectId,trackId:this.session.trackId,contextVersion:this.session.contextVersion||0,startSec:startSeconds,endSec:endSeconds}:null;}else this.playing=true;return true;
  }catch(error){
   // A rejected start must not leave a live monitor's native transport rolling.
   // Never let cleanup for an older attempt stop a replacement Play/project.
   if(mode==='song'&&attempt.songTransportDispatched&&!attempt.cancelled&&attempt.version===this.playVersion&&projectId===this.projectId&&this.ready&&error.name!=='AbortError'){
    this.silenceMonitorSink();
    try{await this.transport('stop');if(attempt.version===this.playVersion&&projectId===this.projectId){this.playing=false;this.rangePlayback=null;}}
    catch(cleanup){error.cleanupError=cleanup;if(attempt.version===this.playVersion&&projectId===this.projectId)this.monitor.stop();}
    if(attempt.cancelled||attempt.version!==this.playVersion||projectId!==this.projectId||!this.ready)throw Object.assign(new Error('A newer playback or project superseded the failed start.',{cause:error}),{name:'AbortError',code:'transport_superseded'});
   }
   throw error;
  }finally{if(this.playAttempt===attempt)this.playAttempt=null;}
 }
 async pause(){
  this.silenceMonitorSink();
  const range=this.rangePlayback,pending=this.cancelPendingPlay(),version=this.playVersion;this.rangePlayback=null;this.pausedRange=null;
  if(this.previewing||pending?.previewPending){await this.session.action('stop_all_pattern_previews',{}, {refresh:false});if(version!==this.playVersion)return;this.previewing=false;}
  else{if(!this.ready)return;await this.transport('pause');}
  if(version===this.playVersion){
   this.playing=false;const clock=this.positionAt(),candidate=range??(pending?.range?{...pending.range,projectId:pending.projectId,trackId:this.session.trackId,contextVersion:this.session.contextVersion||0,pendingStart:!pending.rangeDispatched}:null);
   if(candidate&&Number.isFinite(clock.seconds)&&clock.seconds>=0&&clock.seconds<candidate.endSec)this.pausedRange=candidate;
  }
 }
 async stop(){this.silenceMonitorSink();this.rangePlayback=null;this.pausedRange=null;const pending=this.cancelPendingPlay(),version=this.playVersion;this.releaseNotes();if(!this.ready)return;const previewStop=this.mode==='pattern'||this.previewing||pending?.previewPending?this.session.action('stop_all_pattern_previews',{}, {refresh:false}):null;await Promise.all([this.transport('stop'),previewStop]);if(version!==this.playVersion)return;this.previewing=false;this.playing=false;this.beat=this.positionAt().beat;}
 seek(beat){this.rangePlayback=null;this.pausedRange=null;if(!this.ready)return;return this.transport('seek',{seconds:beat*60/(this.project?.bpm||120)}).catch(e=>{if(e.name!=='AbortError')this.onError(e);});}
 async transport(command,options={}){const projectId=this.projectId;if(!['stop','pause'].includes(command))this.session.assertNoInProgressWrites?.(projectId);const result=await this.transportControl.send(command,options);if(projectId!==this.projectId||!this.ready)throw Object.assign(new Error('The cloud project changed during transport.'),{name:'AbortError',code:'transport_scope_changed'});if(result.route==='data-channel')this.session.applyTransportAcknowledgement?.(command,result,{...options,projectId});const position=this.positionAt();this.playing=position.playing;this.beat=position.beat;this.onTick({...position,step:Math.floor(position.beat*4),mode:this.mode});return result;}
 positionAt(at,options={}){if(options.heardLagSec===undefined){const stats=this.monitor.stats||{},finite=(v,f)=>v!=null&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):f;const total=finite(this.session.producerLagSec,.12)+finite(stats.receiverLagSec,.03)+finite(stats.playoutLagSec,.03),live=this.session.liveClock?.payload?.live_listen,limit=1+(live?.delayed?finite(live.delay_seconds,0):0);if(total>0&&total<limit)this.heardLagSec=total;options={...options,heardLagSec:this.heardLagSec??.18};}if(this.previewing){const context=this.previewContext||{},anchor=context.generation===this.monitor.generation?this.session.liveClock:null,preview=patternPreviewPosition(this.previewReceipt,anchor,{at:at??this.session.now?.()??performance.now(),bpm:context.bpm||this.project?.bpm||120,heardLagSec:options.heardLagSec,expectedEpoch:context.epoch,finiteRepeats:context.finiteRepeats});this.playing=preview.playing;return{...preview,mode:'pattern',previewPatternId:this.previewPatternId};}const snapshot=this.session.positionAt?.(at,options);return snapshot?{...snapshot,mode:this.mode,previewing:false,clockAvailable:snapshot.clockSource!=='none'}:{seconds:this.beat*60/(this.project?.bpm||120),beat:this.beat,playing:this.playing,bpm:this.project?.bpm||120,mode:this.mode};}
 /** Live notes: midi_note over the ordered mozart-control channel (see piano-roll-live.js). */
 get liveInstrument(){return this._liveInstrument??=new LiveInstrument({engine:this});}
 async noteOn(channel,pitch,velocity=.82){if(!this.ready)throw new Error('Select a Freestyle project to play its instruments.');const result=this.liveInstrument.noteOn(channel,pitch,{velocity,source:'typing'});if(result.sent)return result.message;if(result.reason==='no-instrument')return this.preview(channel,pitch);if(result.reason==='offline')throw Object.assign(new Error('Connect live cloud audio to play this instrument.'),{code:'live_channel_unavailable'});throw result.error||new Error('The live note could not be sent.');}
 midiUnavailable(){return Object.assign(new Error('Live instrument MIDI is not enabled in this audio editor.'),{code:'studio_midi_unavailable'});}
 async noteOff(channel,pitch){this._liveInstrument?.noteOff(channel,pitch);}
 releaseNotes(){this._liveInstrument?.releaseAll('stop');}
 async preview(channel,pitch=60){if(!this.ready)throw new Error('Select a Freestyle project to audition its instruments.');const raw=channel.cloudRaw||{};if(raw.audioFileId||raw.audio_file_id){await this.session.action('preview_pattern_sample',{audio_file_id:raw.audioFileId||raw.audio_file_id,pitch,gain:channel.volume??1},{refresh:false});return;}throw this.midiUnavailable();}

 getLevel(id){if(this.levels.has(id))return this.levels.get(id);const state=this.session.rawState||{};if(id==='master')return state.buses?.buses?.find(x=>x.bus_id==='master'||x.id==='master')?.post_fader_peak||0;const c=this.project?.channels.find(c=>c.id===id);const t=state.tracks?.tracks?.find(t=>t.db_track_id===id||t.id===c?.engineTrackId);return t?.post_fader_peak??t?.output_peak??0;}
 async history(action){await this.flush();const direction={history_undo:'undo',history_redo:'redo',undo:'undo',redo:'redo'}[action];if(direction&&await this.geometryHistory?.history(direction))return true;throw new Error('There is no local cloud edit to '+(direction||'undo')+'.');}
 async save(){await this.flush();return api('create_project_save',{project_id:this.projectId});}
 async exportMix(){await this.flush();const job=await this.session.exportMix();const jobId=job.jobId||job.job_id;if(!jobId)return job;this.onStatus('Freestyle is rendering the mix…');for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,2000));const state=await api('get_export_status',{project_id:this.projectId,job_id:jobId});if(state.status==='complete'||state.status==='completed')return {downloadUrl:state.export?.downloadUrl||state.downloadUrl,...state};if(['failed','error','cancelled'].includes(state.status))throw new Error(state.error||'The cloud render failed.');}return job;}
 async importSample(file,target,options={}){const channel=target?this.project?.channels.find(channel=>channel.id===target||channel.laneId===target||channel.cloudTrackId===target):null;return importCloudAudio(this,file,{...options,laneId:target?(channel?.laneId||channel?.cloudTrackId||target):options.laneId});}
 async importDawProject(file,format){if(file.size>25*1024*1024)throw new Error('Cloud DAW project imports are limited to 25 MB.');const tools=await(await bridgeFetch('modesty-bridge:/tools')).json(),schema=tools.tools.find(t=>t.name==='import_daw_project')?.inputSchema?.properties||{};const args={base64:await fileBase64(file),filename:file.name};if(schema.title)args.title=file.name.replace(/\.[^.]+$/,'');if(schema.format)args.format=format||(/\.flp$/i.test(file.name)?'flp':'logic');const r=await api('import_daw_project',args);const id=r.project?.id||r.projectId;if(id)await openHostProject(id);return r;}

 /** Record like the Freestyle Studio: microphone uplink, engine arm (startRecording), take_start; the take is the
  *  engine's own recording and is saved by finalizeRecording. `laneId` is the record track, `startSec` where it lands. */
 async startRecording({laneId=this.session.trackId,startSec}={}){
  await this.flush();const projectId=this.projectId,start=Number.isFinite(startSec)?Math.max(0,startSec):this.beat*60/(this.project?.bpm||120);
  this.recordArm=null;this.recordRollsTransport=false;
  // A background "is the previous take saved yet?" call also ends the caller's arm: let it settle before arming.
  const armCall=()=>this.session.call('startRecording',{project_id:projectId,lane_id:laneId}),pendingConfirm=this.takeConfirmCall;
  const arm=(pendingConfirm?Promise.resolve(pendingConfirm).catch(()=>{}).then(armCall):armCall()).then(value=>({value:value?.response??value}),error=>({error}));
  const beforeTake=async()=>{const result=await arm;if(result.error){const code=result.error.code;if(code==='recording_in_progress')throw result.error;/* older backend without the arm: the captured take is uploaded on stop */this.recordArm=null;return null;}this.recordArm={projectId,laneId,startSec:start};return {songStartSec:start};};
  // Record from Stop: take_start on a stopped engine rolls the transport from song_start_sec (take_started carries
  // started_transport:true). The take then follows the engine clock, not this browser's wall clock.
  const wallClock=()=>start+(performance.now()-(this.recorder.startedAt||performance.now()))/1000;
  const songClock=()=>{if(!this.recordRollsTransport)return wallClock();const clock=this.session.positionAt?.();return clock?.playing&&Number.isFinite(clock.seconds)&&clock.seconds>=start-.25?clock.seconds:wallClock();};
  const result=await this.recorder.start(projectId,this.session.trackId,{songStartSec:start,laneId,songClock,allowCaptureOnly:true,beforeTake});
  if(result&&result.warning)this.onStatus(result.warning);
  if(result&&result.started_transport===true){this.recordRollsTransport=true;this.session.refreshTransportClock?.().catch(()=>{});}
  return result&&{...result,laneId,songStartSec:start,startedTransport:result.started_transport===true};
 }
 /** Save the engine take (retrying while it is still being written); the saved clip then comes from the project. */
 /** finalizeRecording for one take. `waitFor:'placed'` answers as soon as the clip is on its lane (saved:false,
  *  state:'saving', with the clip's track_id / lane_id / start_ms / duration_sec); `'saved'` answers once the take is
  *  scanned and stored. 409 recording_take_pending is the "still saving" signal and is retried with the same take id. */
 async finalizeTake(take,{attempts=8,waitFor='saved',waitMs=8000,quiet=false}={}){
  let last;
  for(let attempt=0;attempt<attempts;attempt++){
   try{
    const call=this.session.call('finalizeRecording',{project_id:take.projectId??this.projectId,take_id:take.takeId,confirm:true,wait_ms:waitMs,...(waitFor==='placed'?{wait_for:'placed'}:{})});
    if(waitFor!=='placed'){this.takeConfirmCall=call;const clear=()=>{if(this.takeConfirmCall===call)this.takeConfirmCall=null;};call.then(clear,clear);}
    const raw=await call,receipt=raw?.response??raw;if(receipt?.saved===false&&!receipt?.track_id)throw Object.assign(new Error('Freestyle did not save this take.'),{code:'recording_take_rejected'});return receipt;
   }
   catch(error){last=error;if(!isTakePending(error))throw error;if(!quiet)this.onStatus('Saving the recorded take in Freestyle…');}
  }
  throw last||new Error('Freestyle is still saving this take. It will appear when the project refreshes.');
 }
 /** After a placed take: ask again (same take id) until Freestyle reports saved:true. Never runs while another take is
  *  armed or recording, because finalizeRecording also ends the caller's arm. A final refusal removes the clip. */
 async confirmTake(take,{firstDelayMs=2500,stepMs=1500,timeoutMs=120000,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const started=performance.now(),projectId=take.projectId??this.projectId;await sleep(firstDelayMs);
  for(;;){
   if(this.projectId!==projectId)throw Object.assign(new Error('The cloud project changed before the take was confirmed.'),{name:'AbortError',code:'take_scope_changed'});
   if(performance.now()-started>timeoutMs)throw Object.assign(new Error('Freestyle is still saving this take; it stays on the track and is confirmed when the project next refreshes.'),{code:'recording_take_pending'});
   if(this.recordArm||['connecting','recording','stopping'].includes(this.recorder.state)){await sleep(stepMs);continue;}
   try{const receipt=await this.finalizeTake(take,{attempts:1,waitMs:4000,quiet:true});if(receipt?.saved===true||receipt?.state==='saved')return receipt;}
   catch(error){if(!isTakePending(error))throw error;}
   await sleep(stepMs);
  }
 }
 async stopRecording(){
  const arm=this.recordArm,recordedOn=this.recorder.mode,rolled=this.recordRollsTransport,elapsed=(performance.now()-(this.recorder.startedAt||performance.now()))/1000;
  const clock=rolled?this.session.positionAt?.():null,start=this.recorder.songStartSec||0,songEndSec=clock?.playing&&Number.isFinite(clock.seconds)&&clock.seconds>start?clock.seconds:start+elapsed;
  const native=!!arm&&recordedOn==='native-ingest';
  const take=await this.recorder.stop({songEndSec,deferRelease:native});this.lastTake=take;this.recordArm=null;this.recordRollsTransport=false;
  // The transport the take started is stopped with it (Stop ends the recording and the playback, like a tape deck).
  // The engine refuses to pause a transport while the take is still armed (409 recording_in_progress), so the stop is
  // sent once finalize has ended the arm (or at once when there is no engine take to finalize).
  const stopTransport=()=>rolled?this.stop().catch(error=>{if(error?.name!=='AbortError')this.onError(error);}):null;
  if(native&&take.stopSent){
   this.onStatus('Saving the recorded take in Freestyle…');
   const scoped={...take,projectId:arm.projectId};let receipt,transportStopped=null;
   try{receipt=await this.finalizeTake(scoped,{waitFor:'placed'});}finally{take.release?.();transportStopped=stopTransport();}
   const clipId=receipt?.track_id||receipt?.trackId||receipt?.clipId,saved=receipt?.saved===true||receipt?.state==='saved';
   this.lastTake={...take,receipt,clipId,persisted:saved,placed:true,placementPending:false};
   // The placed clip is in the canonical project at once: show it from a project-only read, then re-read the slow
   // engine snapshot in the background.
   try{await this.flush();await this.session.refresh({cachedNative:true});}catch{await this.refresh();}
   transportStopped?.catch?.(()=>{});this.backgroundRefresh=this.refresh().catch(()=>{});
   // Placed, not yet stored: the clip already plays; the scan + store are confirmed in the background.
   const confirmed=saved?Promise.resolve(receipt):this.confirmTake(scoped,this.takeConfirmTiming).then(final=>{if(this.lastTake?.takeId===take.takeId)this.lastTake={...this.lastTake,receipt:final,persisted:true};return final;},async error=>{if(error?.code==='recording_take_rejected'||error?.code==='recording_take_silent')await this.refresh().catch(()=>{});throw error;});
   confirmed.catch(()=>{});
   return {take,saved:receipt,clipId,persisted:saved,placed:true,placementPending:false,startMs:receipt?.start_ms,durationSec:receipt?.duration_sec,confirmed};
  }
  await stopTransport();
  return this.uploadTake(take);
 }
 /** Fallback when the engine arm / finalize is unavailable: upload the browser-captured take. */
 async uploadTake(take){const oldIds=new Set((this.session.rawProject?.clips||[]).map(c=>c.id));this.onStatus('Uploading the microphone take to Freestyle…');const saved=await this.importSample(take.file,this.session.trackId);await this.refresh();const candidates=(this.session.rawProject?.clips||[]).filter(c=>!oldIds.has(c.id));const receiptId=saved.clipId||saved.clip?.id||saved.trackId;const clip=(this.session.rawProject?.clips||[]).find(c=>c.id===receiptId)||candidates.find(c=>c.title===take.file.name||c.name===take.file.name)||(candidates.length===1?candidates[0]:null);if(!receiptId&&!clip?.id)throw new Error('Freestyle returned no saved clip identity. The captured take remains available in memory; inspect the cloud project before retrying.');const normalized=this.session.project?.audioClips?.find(c=>c.id===(clip?.id||receiptId));let placementPending=false;if(take.songStartSec>0&&clip?.id){if(normalized?.engineLoaded){await this.session.action('shift_clip',{track_id:normalized.engineTrackId||clip.id,clip_id:clip.id,start_ms:Math.round(take.songStartSec*1000)});}else placementPending=true;}this.lastTake={...take,receipt:saved,clipId:receiptId||clip.id,persisted:true,placementPending};return {take,saved,persisted:true,placementPending};}
 async listenPreview(){await this.flush();return this.session.listen({lengthSec:12,startSec:this.beat*60/(this.project?.bpm||120)});}
 async pluginParameters(channel,pluginIndex=0){return api('get_plugin_state',{project_id:this.projectId,track_id:channel.laneId||this.session.trackId,lane_id:channel.laneId||channel.id,plugin_index:pluginIndex,include_parameters:true});}
 async setPluginParameter(channel,pluginIndex,index,value){return api('set_plugin_parameter',{project_id:this.projectId,track_id:channel.laneId||this.session.trackId,lane_id:channel.laneId||channel.id,plugin_index:pluginIndex,parameter_index:index,value_norm:value});}
}
async function fileBase64(file){const a=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<a.length;i+=8192)binary+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(binary);}
