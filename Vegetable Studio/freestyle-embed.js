/** Embedded lifecycle inside Freestyle Studio (docs/HOST_CONTRACT.md).
 *
 * - Boot: open the project that Freestyle Studio has open (no sign-in, no picker).
 * - host "project": follow it. host "project-updated": refresh on next activation.
 * - host "view": when another view is active, stop playback (unless the host
 *   declares continuousTransport: then only a take is finished), fade the monitor
 *   out and stop the 50 ms tick / transport poll / meter painting / idle
 *   refreshes; keep the monitor peer and the interactive socket open so
 *   switching back is instant. On activation: restart the loops, re-check the
 *   peer and re-read the project.
 * The engine session itself is loaded by the Default studio ; nothing here reloads it.
 */
import {freestyleHost,hostFetch,VIEW_ID} from './freestyle-host-transport.js';

const noop=()=>{};
export function startEmbeddedStudio({engine,stop=noop,pause=stop,releaseInput=noop,onLoaded=noop,onStatus=noop,onError=noop,repaint=noop,log=noop}={}){
 const host=freestyleHost();
 if(!host){onStatus({hint:'Open Vegetable Studio from Freestyle Studio (View menu).',status:'Not inside Freestyle',session:'FREESTYLE STUDIO ONLY'});return null;}
 const session=engine.session,root=globalThis.document?.documentElement;
 let active=false,dirty=false,loading=null,wanted='';
 const state={get active(){return active;},get projectId(){return wanted;}};

 // Loops that cost CPU while hidden: the session's 50 ms tick and transport poll.
 const startTicking=session.startTicking.bind(session);
 session.startTicking=function(){
  if(active)return startTicking();
  clearTimeout(this.pollTimer);clearInterval(this.tickTimer);this.pollTimer=null;this.tickTimer=null;this.tickingDeferred=true;
 };
 const pauseTicking=()=>{clearTimeout(session.pollTimer);clearInterval(session.tickTimer);session.pollTimer=null;session.tickTimer=null;session.tickingDeferred=true;};
 // Interactive patches arriving while hidden stay pending (interactiveRefreshNeeded) until activation.
 const canRefresh=engine.canInteractiveRefresh||(()=>true);
 engine.canInteractiveRefresh=()=>active&&canRefresh();

 async function rememberedTrack(projectId){
  try{const response=await hostFetch('/api/workspace');const context=response.ok?await response.json():null;return context?.projectId===projectId&&typeof context.trackId==='string'?context.trackId:'';}catch{return '';}
 }
 function load(projectId){
  if(wanted!==projectId)loading=null;
  wanted=projectId;
  if(!projectId){onStatus({hint:'Open a project in Freestyle Studio to use Vegetable Studio.',status:'No Freestyle project open',session:'NO PROJECT'});return Promise.resolve(null);}
  if(wanted===projectId&&loading)return loading;
  if(engine.projectId===projectId&&engine.ready&&!engine.loading)return Promise.resolve(engine.project);
  const run=(async()=>{
   if(engine.playing||engine.previewing||engine.playAttempt||engine.recorder?.recording||engine.recordingContext)await Promise.resolve(stop()).catch(()=>{});
   if(wanted!==projectId)return null;
   const trackId=await rememberedTrack(projectId);
   if(wanted!==projectId)return null;
   try{await engine.load(projectId,trackId);}
   catch(error){
    // A remembered context track that no longer exists: open the project default instead.
    if(!trackId||wanted!==projectId||engine.projectId===projectId&&engine.ready)throw error;
    log('embedded-load-retry',{reason:String(error?.message||error).slice(0,160)});
    await engine.load(projectId,'');
   }
   if(wanted===projectId&&engine.projectId===projectId)onLoaded();
   return engine.project;
  })();
  loading=run;run.catch(error=>{if(wanted===projectId&&error?.name!=='AbortError')onError(error);}).finally(()=>{if(loading===run)loading=null;});
  return run;
 }
 function deactivate(){
  const was=active;active=false;if(root)root.dataset.vegetableActive='false';
  // continuousTransport: the next view picks up the rolling engine where it is, so a hidden view
  // leaves playback alone. A take is still finished here (its recorder lives in this document).
  const keepRolling=(()=>{try{return host.capabilities?.continuousTransport===true;}catch{return false;}})();
  const taking=engine.recorder?.recording||engine.recordingContext;
  try{if(taking||!keepRolling&&(engine.playing||engine.previewing||engine.playAttempt))Promise.resolve(pause()).catch(()=>{});}catch{}
  try{releaseInput();}catch{}try{engine.releaseNotes?.();}catch{}
  try{engine.monitor.silence?.();}catch{}
  engine.monitor.suspended=true;pauseTicking();
  if(was)log('embedded-view',{active:false});
 }
 function activate(){
  if(active)return;active=true;if(root)root.dataset.vegetableActive='true';engine.monitor.suspended=false;
  log('embedded-view',{active:true});
  let hostProject='';try{hostProject=String(host.getProjectId()||'');}catch{}
  if(hostProject!==wanted||hostProject&&engine.projectId!==hostProject&&!engine.loading){load(hostProject);return;}
  if(session.project&&!session.closed&&session.tickingDeferred){session.tickingDeferred=false;startTicking();}
  if(!engine.ready||engine.loading){repaint();return;}
  // Peer health: reconnect a peer that dropped while hidden; otherwise just resample its stats.
  const monitor=engine.monitor,peer=monitor.peer;
  if(!peer||peer.connectionState!=='connected'||monitor.control?.readyState!=='open')engine.prewarmMonitor?.();
  else{monitor.collectStats?.().catch?.(()=>{});engine.armPatternPreview?.('view-active');}
  // The Default studio may have edited and moved the transport while this view was hidden.
  const reads=[session.backgroundRefresh?session.backgroundRefresh():engine.refresh()];
  if(typeof session.refreshTransportClock==='function')reads.push(session.refreshTransportClock());
  dirty=false;
  Promise.allSettled(reads).then(results=>{
   for(const result of results)if(result.status==='rejected'&&result.reason?.name!=='AbortError'&&result.reason?.code!=='background_read_preempted')log('embedded-refresh-failed',{message:String(result.reason?.message||result.reason).slice(0,200)});
   if(engine.interactiveRefreshNeeded)engine.scheduleInteractiveRefresh?.();
   repaint();
  });
  repaint();
 }
 const view=id=>String(id||'default')===VIEW_ID?activate():deactivate();
 const unsubscribe=[
  host.on('project',next=>{const id=String(next?.id||'');if(id!==wanted)load(id);}),
  host.on('project-updated',()=>{if(!active)dirty=true;}),
  host.on('view',view),
 ];
 let initial='default';try{initial=host.getActiveView();}catch{}
 // Booted in the background (warm view) or as the active view.
 if(String(initial)!==VIEW_ID){active=true;deactivate();}else{active=true;if(root)root.dataset.vegetableActive='true';engine.monitor.suspended=false;}
 let projectId='';try{projectId=String(host.getProjectId()||'');}catch{}
 load(projectId);
 globalThis.addEventListener?.('pagehide',()=>{for(const off of unsubscribe)try{off?.();}catch{}},{once:true});
 return Object.assign(state,{load,activate,deactivate,get dirty(){return dirty;}});
}
