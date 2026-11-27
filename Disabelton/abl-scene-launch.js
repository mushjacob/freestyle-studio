/** Disabelton Session scene launch (Freestyle #14): pure helpers shared by the Session grid and the shell.
 *
 * A scene is one row of the Session grid. Launching it arms every pattern clip in that row (previewPattern
 * arm_only, one armed_signature per clip, cloud-pattern-arm.js) and starts them all with ONE
 * pattern_preview_launch at a single engine time. Each track is one launch slot (slot_id), so launching another
 * clip on a track replaces that track's clip at the launch time and a track's Stop button stops only that slot.
 */
export const MAX_SCENE_CLIPS=8;
/** Live's Global Launch Quantization, limited to what the engine offers (quantize none | beat | bar). */
export const LAUNCH_QUANTIZE_CHOICES=Object.freeze([
 Object.freeze({value:'none',label:'None'}),
 Object.freeze({value:'bar',label:'1 Bar'}),
 Object.freeze({value:'beat',label:'1/4'}),
]);
export const DEFAULT_LAUNCH_QUANTIZE='bar';
export const launchQuantizeLabel=value=>LAUNCH_QUANTIZE_CHOICES.find(item=>item.value===value)?.label||'1 Bar';
export const normalizeLaunchQuantize=value=>LAUNCH_QUANTIZE_CHOICES.some(item=>item.value===value)?value:DEFAULT_LAUNCH_QUANTIZE;
/** The engine slot id of a Session track: letters, digits, - and _ only (^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$). */
export function sessionSlotId(track){
 const raw=String(track?.laneId||`track-${Number(track?.track)||0}`).replace(/[^A-Za-z0-9_-]/g,'-').replace(/^[^A-Za-z0-9]+/,'');
 return `t-${raw||'0'}`.slice(0,128);
}
/** What a scene launch starts: the pattern clip in row `scene` of every track (audio clips cannot be launched).
 * Returns {previews:[{patternId, slotId, track, name}], skippedAudio, overflow}. */
export function scenePreviews(model,scene){
 const previews=[];let skippedAudio=0,overflow=0;
 for(const track of model?.tracks||[]){
  const slot=track.slots?.[scene];if(!slot)continue;
  if(slot.type!=='pattern'||!slot.patternId){skippedAudio++;continue;}
  if(previews.length>=MAX_SCENE_CLIPS){overflow++;continue;}
  previews.push({patternId:slot.patternId,slotId:sessionSlotId(track),track:track.track,name:slot.name});
 }
 return{previews,skippedAudio,overflow};
}
/** True when `slot` (on `track`) is the clip playing in its track's launch slot. */
export function slotPlaying(layers,track,slot){
 if(!layers||!slot?.patternId)return false;const layer=layers.get?.(sessionSlotId(track));
 return !!layer&&layer.patternId===slot.patternId;
}
/** A scene is playing when every launchable clip of it plays in its track. */
export function scenePlaying(layers,model,scene){
 const {previews}=scenePreviews(model,scene);if(!previews.length||!layers?.size)return false;
 return previews.every(item=>layers.get(item.slotId)?.patternId===item.patternId);
}
