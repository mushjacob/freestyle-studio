/** Saved and observed state that no retained Undo/Redo inverse writes.
 *
 * Retained placement, pattern and audio inverses never touch transport or
 * mixer values, and those values change outside the edit journal: Pro Pause
 * persists `project.cursorSec`, the metronome/loop follow the live engine, and
 * fader/pan/mute/solo writes (which also flip a lane's `mixExplicit`) use the
 * dedicated mixer paths. Treating them as authored project edits made any
 * Play/Pause, metronome toggle or fader move after a Playlist edit discard
 * the whole retained history ("The project changed outside the retained
 * pattern edit"). Everything else — lanes' identities, kinds, names, plugin
 * chains and order, tempo/timing map, opaque metadata, patterns, placements and
 * clips — remains an exact guard.
 */
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const omit=(value,keys)=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>!keys.includes(key)));
export const OBSERVED_SAVED_PROJECT_FIELDS=Object.freeze(['cursorSec','masterGain']);
export const LANE_MIX_FIELDS=Object.freeze(['volume','pan','muted','mute','solo','soloed','mixExplicit']);
export const OBSERVED_MODEL_FIELDS=Object.freeze(['metronome','master','mutedTracks']);
const CHANNEL_MIX_FIELDS=Object.freeze(['volume','pan','mute','solo']);

/** A saved project row (`rawProject`) without transport/mixer observations. */
export function withoutObservedSavedState(raw){
 if(!object(raw))return raw;const value=omit(raw,OBSERVED_SAVED_PROJECT_FIELDS);
 if(Array.isArray(raw.lanes))value.lanes=raw.lanes.map(lane=>object(lane)?omit(lane,LANE_MIX_FIELDS):lane);
 return value;
}
/** One timeline (non-pattern-source) channel without its mixer values. */
export function withoutObservedChannel(channel){
 if(!object(channel))return channel;const value=omit(channel,CHANNEL_MIX_FIELDS);
 if(object(channel.cloudRaw))value.cloudRaw=omit(channel.cloudRaw,LANE_MIX_FIELDS);
 return value;
}
/** A normalized model without transport/mixer observations. Pattern-source
 * (Channel Rack) channels keep their values: those belong to the pattern score. */
export function withoutObservedModelState(project){
 if(!object(project))return project;const value=omit(project,OBSERVED_MODEL_FIELDS);
 if(Array.isArray(project.channels))value.channels=project.channels.map(channel=>channel?.patternSource?channel:withoutObservedChannel(channel));
 return value;
}
