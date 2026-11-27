/**
 * FL "Create automation clip" on a plugin whose lane holds no clip.
 *
 * Freestyle stores every envelope inside a clip (createAutomationEnvelope is
 * POST /clips/{clip_id}/automation) and a plugin_parameter target must live in
 * a clip on the plugin's own lane (422 target_not_on_lane). There is no
 * lane-scoped envelope route, so the compliant FL equivalent is: place the
 * lane's source pattern on that lane at the playhead (bar-snapped), create the
 * envelope inside that placement, and journal both as ONE Undo step. If the
 * envelope create fails, the placement just made is deleted and no history
 * step is recorded.
 */
import {clientLog} from './client-diagnostics.js';
import {patternLengthBeats} from './pattern-preview.js';
import {automationTargetKey,isLaneAutomation,laneAutomationClipId} from './automation-ui.js';

const now=()=>globalThis.performance?.now?.()??Date.now();
const writeKey=()=>globalThis.crypto?.randomUUID?.()||`automation-host-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const refused=message=>Object.assign(new Error(message),{dispatched:false});
/** A lane envelope's timeline window (its own Playlist clip); empty for clip-hosted envelopes. */
const laneWindow=envelope=>isLaneAutomation(envelope)?{laneId:envelope.laneId??String(envelope.clipId).slice(5),startSec:Number(envelope.startSec??0),durationSec:Number(envelope.durationSec)}:{};
const sameWindow=(a,b)=>!isLaneAutomation(b)||Number(a?.startSec??0)===Number(b.startSec)&&Number(a?.durationSec)===Number(b.durationSec);
/** QA check of an envelope's exact points: count plus an FNV-1a hash of (time, value, curve, tension). */
export function pointsCheck(points){const text=JSON.stringify((points||[]).map(point=>[Number(point.timeSec),Number(point.value),point.curve||'linear',Number(point.tension||0)]));let hash=0x811c9dc5;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,0x01000193)>>>0;}return{points:(points||[]).length,pointsHash:hash.toString(16).padStart(8,'0')};}

/** The new host placement for `laneId` at the bar holding `beat`, or null when no pattern plays this lane's instrument. */
export function automationHostPlan(project,laneId,beat=0){
  const lane=String(laneId||'');if(!lane||!project)return null;
  const channel=(project.channels||[]).find(item=>item.patternSource&&String(item.laneId)===lane&&item.patternId!=null);
  const pattern=channel&&(project.patterns||[]).find(item=>String(item.id)===String(channel.patternId)||item.cloudId!=null&&String(item.cloudId)===String(channel.patternId));
  if(!pattern)return null;
  const patternId=String(pattern.cloudId||pattern.id),bpm=Number(project.bpm)>0?Number(project.bpm):120,perBar=Number(project.beatsPerBar)>0?Number(project.beatsPerBar):4;
  const lengthBeats=Math.max(1e-3,Number(patternLengthBeats(pattern))||perBar),startBeat=Math.max(0,Math.floor((Number(beat)||0)/perBar)*perBar);
  const startMs=Math.round(startBeat*60000/bpm),durationMs=Math.max(1,Math.round(lengthBeats*60000/bpm));
  const laneName=(project.channels||[]).find(item=>!item.patternSource&&String(item.laneId)===lane)?.name||channel.name||'this track';
  return{laneId:lane,laneName,patternId,name:pattern.name||'Pattern',bar:startBeat/perBar+1,startMs,durationMs,
    placement:{patternId,laneId:lane,name:pattern.name||'Pattern',startMs,durationMs,loopDurationMs:durationMs,repeatCount:1,offsetMs:0,busId:'master',muted:false,soloed:false}};
}

/**
 * session: CloudSession (action); readRaw(): a fresh canonical project read
 * that does NOT replace the open project; refresh(): reload the open project;
 * store: AutomationStore; history: CloudPatternHistory (recordExternalStep) or
 * a getter for it. Reads during the create and its rollback do not refresh the
 * open project, so a rolled-back attempt leaves the Undo journal untouched.
 */
export function automationHostClips({session,readRaw,refresh=async()=>{},store,history,log=clientLog}){
  const savedRaw=readRaw;
  const placementId=made=>{const row=made?.placement??made;return[row?.id,made?.placementId,made?.placement_id].find(value=>typeof value==='string'&&value.length)||null;};
  async function place(placement){
    const raw=await savedRaw(),made=await session.action('create_pattern_placement',{placement},{refresh:false,ifMatch:raw?.timelineRevision!=null?JSON.stringify(raw.timelineRevision):undefined,idempotencyKey:writeKey()});
    const id=placementId(made);if(!id)throw Object.assign(new Error('Freestyle created the automation clip’s pattern placement without returning its id. Reload the project to inspect it.'),{operationUncertain:true});
    const after=await savedRaw();if(!after?.placements?.some(row=>row.id===id))throw Object.assign(new Error('Freestyle has not confirmed the new pattern clip for the automation.'),{operationUncertain:true});
    return id;
  }
  async function remove(id){
    const raw=await savedRaw();if(!raw?.placements?.some(row=>row.id===id))return false;
    await session.action('delete_pattern_placement',{placement_id:id},{refresh:false,retainDeleteUndo:false,ifMatch:raw.timelineRevision!=null?JSON.stringify(raw.timelineRevision):undefined,idempotencyKey:writeKey()});
    const after=await savedRaw();if(after?.placements?.some(row=>row.id===id))throw Object.assign(new Error('Freestyle has not confirmed the pattern clip removal.'),{operationUncertain:true});
    return true;
  }
  /** Placement then envelope; on envelope failure the placement is deleted again. Returns {placementId, envelope}. */
  async function placeWithEnvelope(plan,{target,defaultValue},phase){
    const started=now(),base={phase,laneId:plan.laneId,patternId:plan.patternId,startMs:plan.startMs,durationMs:plan.durationMs};
    log('automation-host-clip',{...base,step:'place'});
    let id;try{id=await place(plan.placement);}catch(error){log('automation-host-clip',{...base,step:'place-error',message:error.message,status:error.status??null,code:error.code??null,ms:Math.round(now()-started)});throw error;}
    let envelope;
    try{envelope=await store.create({clipId:`pattern:${id}`,target,defaultValue,durationSec:plan.durationMs/1000});if(!envelope?.persisted||!envelope.id)throw new Error('Freestyle did not return a saved automation clip (no envelope id).');}
    catch(error){
      log('automation-host-clip',{...base,step:'rollback',placementId:id,message:error.message,status:error.status??null,code:error.code??null});
      try{await remove(id);}catch(rollbackError){log('automation-host-clip',{...base,step:'rollback-error',placementId:id,message:rollbackError.message});throw Object.assign(new Error(`${error.message} The pattern clip made for it could not be removed (${rollbackError.message}); reload the project to inspect it.`),{cause:error,operationUncertain:true});}
      throw Object.assign(new Error(`${error.message} The pattern clip made for it was removed again; nothing was created.`),{cause:error,status:error.status,code:error.code,historyNotApplied:true,dispatched:false});
    }
    log('automation-host-clip',{...base,step:'created',placementId:id,envelopeId:envelope.id,revision:envelope.revision??null,ms:Math.round(now()-started)});
    return{placementId:id,envelope};
  }
  // Host pattern clips this module created for "Create automation clip"
  // (placement id → that creation's live state and plan). FL deletes such a
  // clip with its only automation; a pre-existing host clip is never removed.
  const owned=new Map();
  // History envelope aliases (target, retired envelope id) → {id, revision} of
  // the envelope an Undo/Redo re-created in its place (same chain pattern as
  // mixer-tools' plugin instance aliases). Steps keep the id they saw and
  // resolve it here, so create → delete → Undo → Undo still finds the clip.
  const envelopeAliases=new Map(),aliasKey=(targetKey,id)=>JSON.stringify([String(targetKey),String(id)]);
  const resolveEnvelope=(targetKey,ref)=>{let current=ref;for(let hop=0;hop<64&&current?.id;hop++){const next=envelopeAliases.get(aliasKey(targetKey,current.id));if(!next||next.id===current.id)break;current=next;}return current;};
  const aliasEnvelope=(targetKey,from,to)=>{if(from&&to?.id&&String(from)!==String(to.id)){envelopeAliases.set(aliasKey(targetKey,from),{id:to.id,revision:to.revision});log('automation-envelope-alias',{targetKey,from,to:to.id});}};
  const notSent=error=>Object.assign(error,{dispatched:false});
  // A definite 4xx refusal changed nothing; any other failure after a write is uncertain.
  const settled=error=>error?.status>=400&&error?.status<500&&!error?.uncertain?notSent(error):Object.assign(error,{operationUncertain:true});
  const hostSaved=(raw,clipId)=>clipId.startsWith('lane:')?!!raw?.lanes?.some(row=>row.id===clipId.slice(5)):clipId.startsWith('pattern:')?!!raw?.placements?.some(row=>row.id===clipId.slice(8)):!!raw?.clips?.some(row=>row.id===clipId);
  return{
    plan:automationHostPlan,
    /**
     * FL Delete on an automation clip: removes the envelope (its host clip
     * stays) as ONE Undo step. Undo recreates the envelope with the exact
     * target, default and points it had; Redo deletes it again. Each guarded
     * write refuses (nothing sent) when the saved state no longer matches.
     */
    async remove({envelope}){
      if(!envelope?.persisted||!envelope.id)throw new Error('This clip has only Freestyle’s default curve; there is no automation clip to delete.');
      const targetKey=envelope.targetKey||automationTargetKey(envelope.target),saved=store.find(String(envelope.clipId),targetKey)||envelope;
      const snapshot={targetKey,target:structuredClone(saved.target),valueType:saved.valueType,defaultValue:saved.defaultValue,points:structuredClone(saved.points||[]),...laneWindow(saved)},check=pointsCheck(snapshot.points);
      // The clip being deleted: an auto-created host goes with its only automation.
      let hostId=String(envelope.clipId).startsWith('pattern:')?String(envelope.clipId).slice(8):null,withHost=false;const fixedClip=String(envelope.clipId);
      const clipId=()=>withHost?`pattern:${hostId}`:fixedClip;
      const ownsHost=async()=>{const owner=hostId&&owned.get(hostId);if(!owner)return false;const raw=await savedRaw(),row=raw?.placements?.find(item=>item.id===hostId);
        if(!row||row.laneId!==owner.plan.laneId||row.startMs!==owner.plan.startMs||row.durationMs!==owner.plan.durationMs)return false;
        try{await store.reloadClip(clipId());}catch{return false;}return !store.list().some(item=>item.clipId===`pattern:${hostId}`&&item.persisted&&item.targetKey!==targetKey);};
      const removeHost=async()=>{await remove(hostId);await refresh();};
      const journal=typeof history==='function'?history():history;let pending=null;
      if(journal?.beginExternalStep)try{pending=journal.beginExternalStep({kind:'automation_delete',label:'Delete automation clip'});}catch(error){log('automation-delete',{step:'begin-refused',message:error.message});}
      let envelopeRemoved=false;
      try{withHost=await ownsHost();await store.remove(envelope);envelopeRemoved=true;if(withHost)await removeHost();}
      catch(error){if(pending)journal.failExternalStep(pending,envelopeRemoved?Object.assign(error,{operationUncertain:true}):error);throw error;}
      log('automation-delete',{phase:'delete',clipId:fixedClip,targetKey,envelopeId:envelope.id,hostRemoved:withHost,placementId:withHost?hostId:null,...check});
      let deletedId=envelope.id;
      const current=async()=>{try{await store.reloadClip(clipId());}catch(error){throw notSent(error);}return store.find(clipId(),targetKey);};
      const saveEnvelope=async id=>{let made;try{made=await store.save({clipId:id,target:structuredClone(snapshot.target),targetKey,valueType:snapshot.valueType,defaultValue:snapshot.defaultValue,persisted:false,revision:0,points:structuredClone(snapshot.points),...laneWindow(snapshot)},structuredClone(snapshot.points));}catch(error){throw settled(error);}
        if(!made?.persisted||!made.id)throw Object.assign(new Error('Freestyle did not confirm the restored automation clip.'),{operationUncertain:true});
        const restored=pointsCheck(made.points||[]);if(restored.pointsHash!==check.pointsHash||!sameWindow(made,snapshot))throw Object.assign(new Error('Freestyle restored the automation clip with different points. Inspect it; nothing will be repeated.'),{operationUncertain:true});return made;};
      const undo=async()=>{
        const raw=await savedRaw().catch(error=>{throw notSent(error);});let made;
        if(withHost){
          const owner=owned.get(hostId);if(!owner||raw?.placements?.some(row=>row.id===hostId))throw refused('The automation clip’s pattern clip already exists again. Undo will not duplicate it.');
          let id;try{id=await place(owner.plan.placement);}catch(error){throw error.operationUncertain?error:settled(error);}
          try{made=await saveEnvelope(`pattern:${id}`);}catch(error){try{await remove(id);}catch(rollback){throw Object.assign(new Error(`${error.message} The recreated pattern clip could not be removed (${rollback.message}); reload the project to inspect it.`),{operationUncertain:true});}throw Object.assign(error,{operationUncertain:false,dispatched:false});}
          // The creation step below now owns the recreated host clip.
          owned.delete(hostId);owner.state.placementId=id;owner.state.envelope=made;owned.set(id,owner);hostId=id;await refresh();
        }else{
          if(!hostSaved(raw,clipId()))throw refused('The automation clip’s host clip was moved or removed. Undo will not recreate it elsewhere.');
          if((await current())?.persisted)throw refused('That parameter already has an automation clip in this clip. Undo will not overwrite it.');
          made=await saveEnvelope(clipId());
        }
        aliasEnvelope(targetKey,deletedId,made);
        log('automation-delete',{phase:'undo',clipId:clipId(),targetKey,envelopeId:made.id,hostRecreated:withHost,placementId:withHost?hostId:null,...pointsCheck(made.points||[])});return{envelopeId:made.id,clipId:clipId(),targetKey};
      };
      const redo=async()=>{
        const existing=await current();if(!existing?.persisted||!existing.id)throw refused('The automation clip is no longer saved. Redo has nothing to delete.');
        const host=withHost&&await ownsHost();if(withHost&&!host)throw refused('The automation clip’s pattern clip changed after Undo. Redo will not delete it.');
        try{await store.remove(existing);}catch(error){throw settled(error);}
        deletedId=existing.id;
        if(withHost)try{await removeHost();}catch(error){throw Object.assign(error,{operationUncertain:true});}
        log('automation-delete',{phase:'redo',clipId:clipId(),targetKey,envelopeId:existing.id,hostRemoved:withHost,...pointsCheck(existing.points||[])});return{envelopeId:existing.id,clipId:clipId(),targetKey};
      };
      const detail={clipId:fixedClip,targetKey,envelopeId:envelope.id,hostRemoved:withHost,...check};
      const recorded=pending?journal.finishExternalStep(pending,{detail,undo,redo}):journal?.recordExternalStep?journal.recordExternalStep({kind:'automation_delete',label:'Delete automation clip',detail,undo,redo}):false;
      log('automation-delete',{phase:'history',recorded:recorded!==false,clipId:fixedClip,targetKey,hostRemoved:withHost});
      return{deleted:true,recorded:recorded!==false,hostRemoved:withHost};
    },
    /**
     * FL "Create automation clip" on a lane fader / pan: one createLaneAutomation
     * envelope over the timeline window, journaled as ONE Undo step. Undo deletes
     * it only while it is still exactly what was created (revision + points +
     * window); Redo recreates that exact envelope. An already existing lane
     * envelope (one per lane per target) is returned and nothing is journaled.
     */
    async createLane({laneId,target,defaultValue,startSec,durationSec}){
      const targetKey=automationTargetKey(target),clipId=laneAutomationClipId(laneId),journal=typeof history==='function'?history():history,scope=journal?.context?.();
      let pending=null;if(journal?.beginExternalStep)try{pending=journal.beginExternalStep({kind:'automation_create',label:'Create automation clip'});}catch(error){log('automation-lane',{phase:'history',step:'begin-refused',message:error.message});}
      let envelope;
      try{envelope=await store.createLane({laneId,target,defaultValue,startSec,durationSec});if(!envelope?.persisted||!envelope.id)throw new Error('Freestyle did not return a saved lane automation clip (no envelope id).');}
      catch(error){if(pending)journal.failExternalStep(pending,error);log('automation-lane',{phase:'create',step:'error',laneId,targetKey,message:error.message,status:error.status??null,code:error.code??null});throw error;}
      if(envelope.existing){if(pending)journal.failExternalStep(pending,Object.assign(new Error('existing'),{dispatched:false,historyNotApplied:true}));log('automation-lane',{phase:'create',step:'existing',laneId,targetKey,envelopeId:envelope.id});return{envelope,existing:true};}
      const snapshot={target:structuredClone(envelope.target),valueType:envelope.valueType,defaultValue:envelope.defaultValue,points:structuredClone(envelope.points||[]),...laneWindow(envelope)},check=pointsCheck(snapshot.points);
      let saved={id:envelope.id,revision:envelope.revision};
      log('automation-lane',{phase:'create',laneId,targetKey,envelopeId:envelope.id,revision:envelope.revision,startSec:snapshot.startSec,durationSec:snapshot.durationSec,...check});
      const current=async()=>{try{await store.reloadClip(clipId);}catch(error){throw Object.assign(error,{dispatched:false});}return store.find(clipId,targetKey);};
      const undo=async()=>{
        const live=await current();saved=resolveEnvelope(targetKey,saved);
        if(!live?.persisted||live.id!==saved.id)throw refused('The lane automation clip was already removed or replaced. Undo will not delete another one.');
        if(live.revision!==saved.revision||pointsCheck(live.points||[]).pointsHash!==check.pointsHash||!sameWindow(live,snapshot))throw refused('The lane automation clip was edited after it was created. Undo will not delete the newer edit.');
        try{await store.remove(live);}catch(error){throw settled(error);}
        log('automation-lane',{phase:'undo',laneId,targetKey,envelopeId:live.id});return{envelopeId:live.id,clipId,targetKey};
      };
      const redo=async()=>{
        if((await current())?.persisted)throw refused('This track already has that automation clip again. Redo will not overwrite it.');
        let made;try{made=await store.save({clipId,targetKey,persisted:false,revision:0,...structuredClone(snapshot)},structuredClone(snapshot.points));}catch(error){throw settled(error);}
        if(!made?.persisted||!made.id)throw Object.assign(new Error('Freestyle did not confirm the recreated lane automation clip.'),{operationUncertain:true});
        if(pointsCheck(made.points||[]).pointsHash!==check.pointsHash||!sameWindow(made,snapshot))throw Object.assign(new Error('Freestyle recreated the lane automation clip differently. Inspect it; nothing will be repeated.'),{operationUncertain:true});
        saved={id:made.id,revision:made.revision};log('automation-lane',{phase:'redo',laneId,targetKey,envelopeId:made.id});return{envelopeId:made.id,clipId,targetKey};
      };
      const detail={laneId,clipId,targetKey,envelopeId:envelope.id,startSec:snapshot.startSec,durationSec:snapshot.durationSec,...check};
      const recorded=pending?journal.finishExternalStep(pending,{detail,undo,redo}):journal?.recordExternalStep?journal.recordExternalStep({kind:'automation_create',label:'Create automation clip',scope,detail,undo,redo}):false;
      return{envelope,recorded:recorded!==false};
    },
    async create({project,laneId,target,defaultValue,beat=0}){
      const plan=automationHostPlan(project,laneId,beat);if(!plan)throw new Error('No pattern plays this plugin’s instrument, so there is no clip to hold its automation. Add a pattern for it first.');
      const journal=typeof history==='function'?history():history,scope=journal?.context?.(),targetKey=automationTargetKey(target);
      // One external creation step: the refresh that shows the new clip is part
      // of this edit, never "changed outside history" (older steps are kept).
      let pending=null;if(journal?.beginExternalStep)try{pending=journal.beginExternalStep({kind:'automation_create',label:'Create automation clip'});}catch(error){log('automation-host-clip',{phase:'history',step:'begin-refused',message:error.message});}
      let state;try{state=await placeWithEnvelope(plan,{target,defaultValue},'create');await refresh();}
      catch(error){if(pending)journal.failExternalStep(pending,state?{message:error.message,operationUncertain:true}:error);throw error;}
      const clipId=()=>`pattern:${state.placementId}`;
      const undo=async()=>{
        const raw=await savedRaw().catch(error=>{throw Object.assign(error,{dispatched:false});}),row=raw?.placements?.find(item=>item.id===state.placementId);
        if(!row||row.laneId!==plan.laneId||row.startMs!==plan.startMs)throw refused('The automation clip’s pattern clip was moved or removed. Undo will not overwrite newer data.');
        try{await store.reloadClip(clipId());}catch(error){throw Object.assign(error,{dispatched:false});}
        const envelope=store.find(clipId(),targetKey),envelopeId=envelope?.id||null;
        if(envelope?.persisted&&envelope.id)await store.remove(envelope);
        await remove(state.placementId);owned.delete(state.placementId);await refresh();log('automation-host-clip',{phase:'undo',laneId:plan.laneId,placementId:state.placementId,envelopeId});
        return{placementId:state.placementId,envelopeId};
      };
      const redo=async()=>{
        const raw=await savedRaw().catch(error=>{throw Object.assign(error,{dispatched:false});});
        if(raw?.placements?.some(item=>item.id===state.placementId))throw refused('The automation clip’s pattern clip is still saved. Redo will not duplicate it.');
        const next=await placeWithEnvelope(plan,{target,defaultValue},'redo');Object.assign(state,next);owned.set(state.placementId,{state,plan});await refresh();
        return{placementId:state.placementId,envelopeId:state.envelope.id};
      };
      owned.set(state.placementId,{state,plan});
      const detail={laneId:plan.laneId,patternId:plan.patternId,startMs:plan.startMs,placementId:state.placementId,envelopeId:state.envelope.id,targetKey};
      const recorded=pending?journal.finishExternalStep(pending,{detail,undo,redo}):journal?.recordExternalStep?journal.recordExternalStep({kind:'automation_create',label:'Create automation clip',scope,detail,undo,redo}):false;
      log('automation-host-clip',{phase:'history',recorded:recorded!==false,placementId:state.placementId,envelopeId:state.envelope.id});
      return{envelope:state.envelope,placementId:state.placementId,plan,host:{name:`${plan.name} (new clip on ${plan.laneName}, bar ${plan.bar})`}};
    },
  };
}
