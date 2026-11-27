import {selectionNavigate,trackFocusNavigate,clipNavigate} from './audacity-navigation.js';
import {hasViewportClock} from './audacity-viewport-view.js';
import {TRACK_GUTTER_PX} from './audacity-layout.js';

/** Keyboard commands operate on the same selection and global edit line as the mouse. */
export class AudacityNavigation {
 constructor(workspace,{now=()=>performance.now()}={}){this.workspace=workspace;this.now=now;this.lastAdjustment=-Infinity;}
 revealTime(seconds){const w=this.workspace,left=w.leftSec??w.scroll.scrollLeft/w.scale,width=w.scroll.clientWidth-TRACK_GUTTER_PX;let next=left;if(seconds<left)next=Math.max(0,seconds);else if(width>0&&seconds>left+width/w.scale)next=Math.max(0,seconds-width/w.scale/2);if(next!==left){if(w.setLeftSec)w.setLeftSec(next);else w.scroll.scrollLeft=next*w.scale;}}
 resolveClip(){const w=this.workspace,p=w.getProject(),clips=[...p.clips,...(p.audioClips||[])],selected=w.selectedTracks;const matches=clips.filter(c=>selected.has(c.track)&&w.selection.start>=w.seconds(c.start)&&w.selection.end<=w.seconds(c.start+c.length));w.selectedClip=matches.length===1?matches[0].id:null;}
 select(command,direction='right'){
  const w=this.workspace,p=w.getProject(),clock=w.engine.positionAt?.(),clockAvailable=w.viewport?.clockAvailable(clock)??(!!w.engine.ready&&!w.engine.loading&&(!w.engine.projectId||w.engine.projectId===(p.cloud?.projectId||p.id))&&hasViewportClock(clock)),playing=clockAvailable?(clock?.playing??w.engine.playing):w.engine.playing,clips=[...p.clips,...(p.audioClips||[])].filter(c=>w.selectedTracks.has(c.track)),time=this.now();
  const grid=w.snap?Number(document.querySelector('#au-snap-grid')?.value)*60/p.bpm:0;
  const result=selectionNavigate(w.selection,{command,direction,pixelsPerSecond:w.scale,projectEnd:w.duration(),screenEnd:(w.leftSec??w.scroll.scrollLeft/w.scale)+Math.max(0,w.scroll.clientWidth-TRACK_GUTTER_PX)/w.scale,sinceLastAdjustmentMs:time-this.lastAdjustment,playing,playbackSeconds:clockAvailable?clock.seconds:undefined,
   ...(clips.length?{trackStart:Math.min(...clips.map(c=>w.seconds(c.start))),trackEnd:Math.max(...clips.map(c=>w.seconds(c.start+c.length)))}:{}),
   ...(grid>0?{snapTime:t=>Math.max(0,Math.round(t/grid)*grid),snapStep:(t,sign,minStep)=>{const steps=Math.max(1,Math.ceil(minStep/grid));return Math.max(0,(sign>0?Math.floor((t+1e-10)/grid)+steps:Math.ceil((t-1e-10)/grid)-steps)*grid);}}:{})});
  if(['move','extend','contract'].includes(command))this.lastAdjustment=time;
  if(result.seek){if(result.targetSeconds===null)throw new Error('The cloud playback clock is unavailable. Wait for a verified clock before seeking.');w.seek(result.targetSeconds);return result;}
  if(result.changed){w.selection=result.selection;this.resolveClip();w.paintSelection();if(!playing&&!w.paused)w.seek(w.selection.start);}
  if(result.targetSeconds!==null)this.revealTime(result.targetSeconds);return result;
 }
 focus(command,direction='down'){
  const w=this.workspace,result=trackFocusNavigate({focusedTrack:w.focusedTrack,selectedTracks:w.selectedTracks},{command,direction,trackIndexes:w.tracks.map(t=>t.index)});
  if(!result.changed)return result;w.focusedTrack=result.focusedTrack;w.selectedTracks=new Set(result.selectedTracks);const clip=w.selected();if(clip&&!w.selectedTracks.has(clip.track))w.selectedClip=null;w.paintSelection();
  const row=[...w.root.querySelectorAll('.au-track')].find(row=>Number(row.dataset.track)===result.focusedTrack);if(row){const r=row.getBoundingClientRect(),bounds=w.scroll.getBoundingClientRect();if(r.top<bounds.top+31)w.scroll.scrollTop-=bounds.top+31-r.top;else if(r.bottom>bounds.bottom)w.scroll.scrollTop+=r.bottom-bounds.bottom;}
  return result;
 }
 clip(command,direction){
  const w=this.workspace,p=w.getProject(),result=clipNavigate(w.selection,{command,direction,clips:[...p.clips,...(p.audioClips||[])],bpm:p.bpm,selectedTracks:[...w.selectedTracks]});
  if(result.changed){w.selection=result.selection;w.selectedClip=result.matches.find(c=>c.clipId===result.clipId&&w.selectedTracks.has(c.track))?.clipId??null;w.paintSelection();if(!w.engine.playing&&!w.paused)w.seek(w.selection.start);}
  if(result.targetSeconds!==null)this.revealTime(result.targetSeconds);return result;
 }
 handle(e){
  const key=e.key.toLowerCase(),meta=e.metaKey||e.ctrlKey,punctuation=e.code==='Comma'?',':e.code==='Period'?'.':key;let fn;
  if(['arrowleft','arrowright'].includes(key)&&!e.altKey&&(!meta||e.shiftKey))fn=()=>this.select(meta?'contract':e.shiftKey?'extend':'move',key==='arrowleft'?'left':'right');
  else if(['arrowup','arrowdown'].includes(key)&&!meta&&!e.altKey)fn=()=>this.focus(e.shiftKey?'extend':'move',key==='arrowup'?'up':'down');
  else if(key==='enter'&&!meta&&!e.altKey&&!e.shiftKey)fn=()=>this.focus('toggle');
  else if((punctuation===','||punctuation==='.')&&e.altKey&&!meta&&!e.shiftKey)fn=()=>this.clip('clip',punctuation===','?'left':'right');
  else if((punctuation===','||punctuation==='.')&&!meta&&!e.altKey)fn=()=>this.select(e.shiftKey?'jump-long':'jump-short',punctuation===','?'left':'right');
  else if((key==='j'||key==='k')&&!meta&&!e.altKey)fn=()=>this.select((e.shiftKey?'extend-track-':'track-')+(key==='j'?'start':'end'));
  if(!fn)return false;e.preventDefault();e.stopImmediatePropagation();this.workspace.run(fn);return true;
 }
}
