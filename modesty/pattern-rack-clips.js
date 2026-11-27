import {PatternRackController} from './pattern-rack-controller.js';
import {interceptPlacementCommits} from './pattern-rack-receipts.js';

/**
 * Headless support for pattern/MIDI clips that already exist in a project.
 * Modesty has no pattern builder, rack or piano roll (Audacity 3.2 scope);
 * these clips stay ordinary timeline clips: move/trim/delete/duplicate use
 * typed placement writes with instant receipts, ⌘C/⌘X/⌘V use typed placement
 * copies, and every edit has a typed inverse in the chronological workspace
 * Undo history. No panel, CSS or editor entry point is mounted.
 */
export class AudacityPatternClips {
  constructor(workspace,options={}){
    this.w=workspace;
    this.controller=new PatternRackController({...options,getProject:()=>workspace.getProject(),engine:workspace.engine,
      record:(entry,projectId)=>workspace.recordOwnedHistory?.('patternClips',projectId),
      forget:(entry,projectId,newerCount)=>this.forgetOwned(projectId,newerCount),
      onStatus:message=>workspace.engine?.onStatus?.(message)});
  }
  mount(){if(this.w.engine?.geometryHistory)interceptPlacementCommits(this.w.engine,this.controller);return this;}
  // Owned-history surface used by AudacityWorkspace.history().
  get past(){return this.controller.past;}
  get future(){return this.controller.future;}
  history(direction){return this.controller.history(direction);}
  uncertain(id){return this.controller.uncertain(id);}
  unverified(id){return this.controller.unverified(id);}
  forgetOwned(projectId,newerCount){
    const w=this.w;if(!w.ownedStack)return;const stack=w.ownedStack(w.ownedHistoryPast,projectId);let seen=0;
    for(let index=stack.length-1;index>=0;index--){if(stack[index]!=='patternClips')continue;if(seen===newerCount){stack.splice(index,1);return;}seen++;}
  }
  patternLane(track){return track&&track.laneId&&track.clips.some(clip=>clip.patternId)?track.laneId:'';}
  selectedPatternClip(){const clip=this.w.selected?.();return clip?.patternId&&clip.cloudRaw?.patternId?clip:null;}
  handlesClipboard(operation){
    if(operation==='paste')return this.w.lastClipboardKind==='pattern'&&!!this.controller.clipboard;
    const clip=this.selectedPatternClip(),tracks=this.w.selectedTracks||new Set();
    return !!clip&&(tracks.size===0||(tracks.size===1&&tracks.has(clip.track)));
  }
  clipboardEdit(operation){
    const clip=this.selectedPatternClip();
    if(operation==='copy'){this.controller.copy(clip);this.w.lastClipboardKind='pattern';return Promise.resolve(true);}
    if(operation==='cut'){this.w.lastClipboardKind='pattern';return this.controller.cut(clip);}
    const track=this.w.tracks.find(t=>t.index===this.w.focusedTrack),laneId=this.patternLane(track)||this.controller.clipboard?.payload?.laneId;
    return this.controller.paste({atSec:this.w.selection?.start||0,laneId});
  }
}
