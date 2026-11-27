import {planRegionFade} from './audacity-region-fade.js';
import {canonicalEnvelopeClipId} from './audacity-envelope.js';
import {LIVE_AUTOMATION_CONTRACT} from './audacity-automation-contract.js';
const windowKey=window=>JSON.stringify(['clipId','timelineStartSec','durationSec','pointStartSec','pointEndSec','timeDomain','sourceStartSec','sourceEndSec','sourceDurationSec','offsetKnown','waveformRevision'].map(key=>window?.[key]));

/** Effect-menu adapter; uses the same exact receipt and history as inline F2. */
export class AudacityRegionFades{
 constructor(workspace){this.w=workspace;}
 capture(direction){
  const w=this.w,view=w.envelopeView,e=w.engine;
  w.assertOwnedEditsSettled?.();
  if(!['in','out'].includes(direction))throw new Error('Choose Fade In or Fade Out.');
  if(!view||view.automationContract()!==LIVE_AUTOMATION_CONTRACT)throw new Error('Connect the live full-precision gain-envelope tools before applying a region fade.');
  if(w.busy||e.loading||!view.readAvailable()||e.playing||w.paused||e.applying||e.interacting||e.recorder?.recording||w.clipGesture||w.selectionGesture?.active||view.active||w.trackLayout?.active||w.amplitudeView?.active||w.multiToolView?.active||w.loopRegion?.active||w.groupMoves?.active||w.panGesture||w.viewport?.pinDrag)throw new Error('Stop audio and finish the current gesture before applying a region fade.');
  const selected=[...w.selectedTracks],track=selected.length===1?w.tracks.find(track=>track.index===selected[0]):null,{start,end}=w.selection;
  if(!track?.laneId||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)throw new Error('Select a nonempty region in one persisted audio track.');
  const overlaps=track.clips.filter(clip=>w.seconds(clip.start)<end&&w.seconds(clip.start+clip.length)>start);
  if(overlaps.length!==1||overlaps[0].patternId||typeof overlaps[0].cloudId!=='string'||!overlaps[0].cloudId)throw new Error('Select a region within exactly one persisted audio clip. Multiple clips and pattern clips are not supported by this fade.');
  const clip=overlaps[0],window=view.resolveWindow(clip,w.getProject().bpm),timelineEnd=w.seconds(clip.start+clip.length),localStart=start===window.timelineStartSec?0:start-window.timelineStartSec,localEnd=end===timelineEnd?window.durationSec:end-window.timelineStartSec;
  if(!window.editable||!view.currentClip(clip)||clip.laneId!==track.laneId||localStart<0||localEnd>window.durationSec)throw new Error(window.reason||'Select a region wholly within the audio clip.');
  return {direction,clip,clipId:canonicalEnvelopeClipId(clip),startSec:localStart,endSec:localEnd,context:view.readContext(),binding:view.binding(clip),windowKey:windowKey(window)};
 }
 assertCurrent(captured){const view=this.w.envelopeView;if(captured.context!==view.readContext()||captured.binding!==view.binding(captured.clip)||!view.currentClip(captured.clip)||captured.windowKey!==windowKey(view.resolveWindow(captured.clip,this.w.getProject().bpm)))throw new Error('The cloud project or clip source changed while preparing the fade. No fade was applied.');}
 async fade(direction){
  const captured=this.capture(direction),w=this.w,view=w.envelopeView,controller=view.controller;w.busy=true;w.root?.ownerDocument?.body.classList.add('au-cloud-busy');let begun=false;
  try{
   await controller.saveQueue;this.assertCurrent(captured);await controller.load(captured.clip,{force:true});this.assertCurrent(captured);if(view.automationContract()!==LIVE_AUTOMATION_CONTRACT)throw new Error('The live gain-envelope contract changed before the fade.');
   const state=controller.get(captured.clip),plan=planRegionFade({...captured,envelope:state.envelope,window:state.window});
   controller.begin(captured.clip);begun=true;controller.replacePlannedPoints(plan.points);const saved=await controller.commit();begun=false;view.paint(captured.clip);w.engine.onStatus?.(`Fade ${direction==='in'?'In':'Out'} applied to the selected region.`);return saved;
  }catch(error){if(begun)controller.cancel();throw error;}
  finally{w.busy=false;w.root?.ownerDocument?.body.classList.remove('au-cloud-busy');}
 }
}
