import {resolveCoreEdit,splitBoundaryReadback} from './audacity-core-edit.js';
const id=w=>{const p=w.getProject();return p.cloud?.projectId||p.id;};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const binding=clip=>JSON.stringify(stable({id:clip.id,cloudId:clip.cloudId,patternId:clip.patternId,track:clip.track,laneId:clip.laneId,start:clip.start,length:clip.length,offset:clip.offset,offsetKnown:clip.offsetKnown,sourceLength:clip.sourceLength,sourceId:clip.sourceId,audioFileId:clip.audioFileId,source:clip.cloudRaw?.sourceId??clip.cloudRaw?.source_id,media:clip.cloudRaw?.mediaId??clip.cloudRaw?.media_id,file:clip.cloudRaw?.fileId??clip.cloudRaw?.file_id,fullDuration:clip.cloudRaw?.audioFullDurationSec,phase:clip.cloudRaw?.loopPhaseMs??clip.cloudRaw?.loop_phase_ms,sourceBusOverrides:clip.cloudRaw?.sourceBusOverrides}));
/** Core single-clip edits use the existing cloud split/commit paths. Range edits
 * remain with their atomic controller; exact numeric cursor time is preserved.
 */
export class AudacityCoreEdits{
 constructor(workspace){this.w=workspace;this.lastSplit=null;}
 resolve(operation){const w=this.w;return resolveCoreEdit({operation,selection:w.selection,selectedTracks:w.selectedTracks,selectedClip:w.selectedClip,tracks:w.tracks,bpm:w.getProject().bpm});}
 context(){const w=this.w,e=w.engine;return JSON.stringify([id(w),e.projectId,e.ready,e.loading,e.loadVersion||0,e.session?.projectId,e.session?.trackId,e.session?.contextVersion||0,e.session?.closed===true]);}
 idle(){const w=this.w;if(w.busy||w.engine.applying||w.engine.interacting||w.engine.playing||w.paused||w.engine.recorder?.recording||w.selectionGesture?.active||w.clipGesture||w.envelopeView?.active||w.trackLayout?.active||w.multiToolView?.active)throw new Error('Stop audio and finish the current edit before splitting or trimming.');if(!w.engine.ready||w.engine.loading||w.engine.session?.closed||w.engine.projectId&&w.engine.projectId!==id(w)||w.engine.session?.projectId&&w.engine.session.projectId!==id(w))throw new Error('Connect the current cloud project before editing.');}
 async split(){
  this.idle();const w=this.w,plan=this.resolve('split');
  if(plan.kind==='pattern'){
   if(!w.patternSplits)throw new Error('The cloud pattern-split controller is unavailable.');
   // The existing controller captures the durable selected placement and owns
   // its transaction/history lock. Highlight the uniquely resolved placement.
   w.selectedClip=plan.clip.id;w.paintSelection?.();return w.ownedEdit('pattern',()=>w.patternSplits.split());
  }
  const session=w.engine.session,before=structuredClone(plan.clip),context=this.context(),source=binding(plan.clip),selection=JSON.stringify([w.selection.start,w.selection.end,[...w.selectedTracks].sort((a,b)=>a-b)]),body=w.root?.ownerDocument?.body;
  w.busy=true;body?.classList.add('au-cloud-busy');
  try{
   await w.envelopeView?.controller.saveQueue;await w.engine.flush();
   if(session!==w.engine.session||context!==this.context()||selection!==JSON.stringify([w.selection.start,w.selection.end,[...w.selectedTracks].sort((a,b)=>a-b)]))throw new Error('The project, native session or selection changed while the split was waiting.');
   const current=this.resolve('split');if(current.clip.cloudId!==plan.clip.cloudId||binding(current.clip)!==source)throw new Error('The clip timing, source or routing changed while the split was waiting.');
   this.lastSplit={projectId:id(w),clipId:current.clip.cloudId,cursorSec:plan.cursorSec,status:'pending',receipt:null};
   const receipt=await w.engine.session.splitAudioClip(current.clip,current.cursorBeat);this.lastSplit.receipt=structuredClone(receipt??null);this.lastSplit.readback=context===this.context()?splitBoundaryReadback({clip:before,afterClips:w.getProject().audioClips,bpm:plan.bpm,cursorSec:plan.cursorSec}):{verified:false,reason:'The project context changed after the split acknowledgement.'};this.lastSplit.status=this.lastSplit.readback.verified?'verified':'acknowledged-unverified';return receipt;
  }catch(error){if(this.lastSplit?.status==='pending'){this.lastSplit.status='uncertain';this.lastSplit.error=error.message;}throw error;}
  finally{w.busy=false;body?.classList.remove('au-cloud-busy');}
 }
 trim(){
  this.idle();const w=this.w,plan=this.resolve('trim'),source=binding(plan.clip);
  return w.edit(()=>{
   const current=this.resolve('trim');if(binding(current.clip)!==source)throw new Error('The clip changed before trimming.');
   const clip=current.clip,delta=current.startBeat-clip.start;
   if(clip.patternId){clip.cloudRaw={...clip.cloudRaw,offsetMs:Number(clip.cloudRaw?.offsetMs??clip.cloudRaw?.offset_ms??0)+w.seconds(delta)*1000};if(Number(clip.cloudRaw?.windowMs??clip.cloudRaw?.window_ms)>0)clip.cloudRaw={...clip.cloudRaw,windowMs:w.seconds(current.endBeat-current.startBeat)*1000};}
   else if(delta)clip.offset+=delta;
   clip.start=current.startBeat;clip.length=current.endBeat-current.startBeat;
  });
 }
}
