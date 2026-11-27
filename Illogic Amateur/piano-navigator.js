import {PlaylistNavigator} from './playlist-navigator.js';
import {PIANO_KEY_WIDTH,PIANO_PITCH_COUNT} from './piano-geometry.js';

/** Attach the shared native overview gestures to real piano notes.
 * Note start/duration are beats; scale is CSS pixels per bar.
 * setView must lay out the new scale before setting viewport.scrollLeft.
 * Refresh after note, selection, pattern or scale changes; destroy on teardown.
 */
export function attachPianoNavigator({element,viewport,getScale,setView,getNotes=()=>[],getSelected=()=>null,canNavigate=()=>true,minScale=40,maxScale=896,...options}={}){
 const navigator=new PlaylistNavigator({
  ...options,element,viewport,getScale,setView,getSelected,canNavigate,
  gutter:PIANO_KEY_WIDTH,minScale,maxScale,
  getClips:()=>getNotes().map(note=>({id:note.id,start:note.start,length:note.duration,row:PIANO_PITCH_COUNT-1-note.pitch,color:note.color}))
 });
 element.classList.add('piano-navigator');
 element.setAttribute('aria-label','Piano roll horizontal zoom and scroll');
 navigator.previous.setAttribute('aria-label','Scroll piano roll left');
 navigator.next.setAttribute('aria-label','Scroll piano roll right');
 navigator.handle.setAttribute('aria-label','Piano roll note overview; arrow keys scroll, plus and minus zoom');
 navigator.leftGrip.title='Zoom piano roll; keep right edge fixed';
 navigator.rightGrip.title='Zoom piano roll; keep left edge fixed';
 const destroy=navigator.destroy.bind(navigator);
 navigator.destroy=()=>{destroy();element.classList.remove('piano-navigator');};
 return navigator;
}
