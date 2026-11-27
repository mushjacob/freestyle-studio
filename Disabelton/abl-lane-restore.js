/** Bring a restored instrument lane back into the running Freestyle session
 * (Undo of Delete Track, Redo of Insert Track).
 *
 * Engine request N (live 2026-11-13, LABS lane):
 *  - restoreLane saves the lane but answers liveEngine {applied:false, reason:"no_live_session"};
 *  - list_plugins then answers 409 lane_has_no_live_chain;
 *  - execute_pro_action load_lane_chain {lane_id} answers ok / track_created:true but skips the
 *    instrument (skipped:[{instance_id:"labs_…", reason:"not_a_lane_effect"}]);
 *  - reloadEngineSession {mode:"reconcile"} answers alreadyLoaded:true and changes nothing;
 *  - only reloadEngineSession {mode:"full"} (~1.2 s) brings LABS back.
 *
 * So: load_lane_chain (as the bridge maps it: execute_pro_action), read list_plugins, and only
 * when that read proves the instrument is missing run a full engine reload — never while the
 * transport is playing (wait for Stop and say so). The restore stays the confirmed history step
 * whatever happens here: this is runtime only and never throws.
 */
import {resyncEngineSession,reloadScopeTrack} from './cloud-engine-reload.js';
import {isInstrumentPlugin,LOGIC_INSTRUMENT_TYPES} from './logic-mixer.js';
import {StudioApiClient} from './studio-api-client.js';

const array=value=>Array.isArray(value)?value:[];
const body=reply=>{const outer=reply?.structuredContent??reply;return outer?.response&&typeof outer.response==='object'?outer.response:outer;};
const CHAIN_KINDS=new Set(['instrument','plugin','pattern','midi']);

export const ablRestoreReloadStatus=name=>`Reloading the live session to restore ${name?`“${name}”’s`:'this track’s'} instrument…`;
export const ablRestoreWaitStatus=name=>`${name?`“${name}”`:'The track'} is restored. Its instrument reloads into the live session when playback stops.`;

/** True when the saved lane hosts an instrument (e.g. LABS) the live session must load. */
export function laneExpectsInstrument(lane,instrumentTypes=LOGIC_INSTRUMENT_TYPES){
 return lane?.kind==='instrument'&&array(lane.pluginChain).some(plugin=>isInstrumentPlugin(plugin,instrumentTypes));
}
/** Whether a lane needs a live chain at all (instrument / plugin / pattern lanes, or any saved inserts). */
export const laneNeedsLiveChain=lane=>!!lane&&(CHAIN_KINDS.has(lane.kind)||array(lane.pluginChain).length>0);

/** list_plugins reply → true (instrument live), false (proved missing) or null (unreadable). */
export function liveInstrumentState(reply,laneId,instrumentTypes=LOGIC_INSTRUMENT_TYPES){
 const data=body(reply);if(!data||typeof data!=='object'||!Array.isArray(data.plugins))return null;
 if(data.lane_id!==undefined&&data.lane_id!==laneId)return null;
 return data.plugins.some(plugin=>isInstrumentPlugin(plugin,instrumentTypes));
}
/* Typed reply: 409 lane_has_no_live_chain (the mixer unpacker keeps only the code). */
const noLiveChain=error=>error?.code==='lane_has_no_live_chain'&&(error.status===undefined||error.status===409);

/**
 * @param {object} options
 *  laneId, lane (saved lane), name, liveEngine (restore receipt's liveEngine part)
 *  loadChain(): execute_pro_action load_lane_chain reply
 *  listPlugins(): list_plugins reply (may reject 409 lane_has_no_live_chain)
 *  reload(): full engine reload → {status:'resynced'|'stale', …}
 *  isPlaying(), isCurrent(), status(text), log(kind,data), sleep(ms), pollMs
 * @returns {Promise<{status:string,…}>} never rejects
 */
export async function restoreLaneLiveChain({laneId,lane,name=null,liveEngine=null,loadChain,listPlugins,reload,isPlaying=()=>false,isCurrent=()=>true,status=()=>{},log=()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pollMs=250,instrumentTypes=LOGIC_INSTRUMENT_TYPES}={}){
 const label=name||lane?.name||null,expects=laneExpectsInstrument(lane,instrumentTypes),result={laneId,expectsInstrument:expects};
 const done=(state,extra={})=>{Object.assign(result,{status:state},extra);log('lane-restore-chain',result);return result;};
 if(!lane||!laneNeedsLiveChain(lane))return done('not_needed');
 if(liveEngine?.applied===true&&liveEngine.chainRestored===true)return done('live');
 // 1. load_lane_chain: loads the lane's effects; on prod it skips the instrument (not_a_lane_effect).
 try{const reply=body(await loadChain());result.chainLoaded=reply?.ok===true&&(reply.lane_id===undefined||reply.lane_id===laneId);result.skipped=array(reply?.skipped).map(item=>item?.reason??null);}
 catch(error){result.chainLoaded=false;result.chainError=String(error?.message||error).slice(0,200);}
 if(!isCurrent())return done('stale');
 if(!expects)return done(result.chainLoaded?'live':'chain_failed');
 // 2. Is the instrument live now? Only a read that proves it missing triggers a reload.
 const probe=async()=>{try{return liveInstrumentState(await listPlugins(),laneId,instrumentTypes);}catch(error){if(noLiveChain(error))return false;result.readError=String(error?.code||error?.message||error).slice(0,120);return null;}};
 const live=await probe();if(!isCurrent())return done('stale');
 if(live===true)return done('live');
 if(live===null)return done('unknown');
 // 3. Full reload, never while the transport is playing.
 if(isPlaying()){status(ablRestoreWaitStatus(label));result.waitedForStop=true;while(isPlaying()){await sleep(pollMs);if(!isCurrent())return done('stale');}}
 status(ablRestoreReloadStatus(label));
 let outcome;try{outcome=await reload();}catch(error){status(`${label?`“${label}”`:'The track'} is restored, but reloading the live session failed (${error?.message||error}). Reload the project to hear its instrument.`);return done('reload_failed',{reloadError:String(error?.message||error).slice(0,200)});}
 if(outcome?.status!=='resynced'||!isCurrent())return done('stale',{reload:outcome?.status??null});
 const after=await probe();if(!isCurrent())return done('stale');
 status(after===false?`${label?`“${label}”`:'The track'} is restored, but its instrument is still not live. Reload the project to hear it.`:`Reloaded the live session: ${label?`“${label}”`:'the track'}’s instrument is back.`);
 return done(after===false?'reload_incomplete':'reloaded',{reloadMs:outcome.ms??null,liveAfter:after});
}

/** The app's full-mode reload over the existing reloadEngineSession path. */
export async function fullEngineReload(engine,{client=engine.studioApiClient||=new StudioApiClient(),isCurrent=()=>true}={}){
 const projectId=engine.projectId,outcome=await resyncEngineSession({client,projectId,trackId:reloadScopeTrack(engine.session.rawProject,engine.session.trackId),mode:'full',isCurrent});
 if(outcome.status==='resynced'&&isCurrent())await engine.session.refresh({native:true});
 return outcome;
}
