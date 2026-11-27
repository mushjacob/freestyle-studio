/** Shared view-only linked-channel geometry. No channel count is inferred.
 * Audacity 3.2.1 (969e36f4968e66375a794a938dd906a3556e0bbc):
 * src/TrackPanel.cpp876–920 FindAdjustedChannelHeights allocates the available
 * content pixels by cumulative integer division of saved TrackView heights.
 * src/tracks/ui/CommonTrackView.cpp81–90 partitions the minimized GROUP minimum.
 * `height` here is the measured waveform BODY: caption/chrome/separators have
 * already been excluded by the caller, and must not be subtracted again.
 */
import {channelMinimumHeights} from './audacity-track-layout.js';
const integer=value=>Number.isSafeInteger(value)&&value>=0;
function countOf(count){if(!Number.isSafeInteger(count)||count<1||count>256)throw new TypeError('Supply the actual channel count (1–256).');return count;}

/** Returns integer {index,top,bottom,height} rows covering trunc(height).
 * Missing saved layout means equal rows for this explicit, known count.
 * An incompatible provided layout is rejected rather than silently relabelled.
 * Zero-height rows have no pointer ownership and remain valid SVG clip regions.
 */
export function channelRows(height,channelCount,layout){
 const count=countOf(channelCount);if(!Number.isFinite(height)||height<0||!Number.isSafeInteger(Math.trunc(height)))throw new TypeError('Channel body height must be finite nonnegative safe pixels.');
 const pixels=Math.trunc(height);let weights;
 if(layout==null)weights=Array(count).fill(1);
 else{
  if(!Array.isArray(layout.expandedHeights)||layout.expandedHeights.length!==count||!layout.expandedHeights.every(integer)||!layout.expandedHeights.some(value=>value>0)||layout.minimized!==undefined&&typeof layout.minimized!=='boolean')throw new TypeError('The saved channel layout does not match the actual source channels.');
  weights=layout.minimized?channelMinimumHeights(count):layout.expandedHeights;
 }
 // BigInt preserves the native integer-division policy for safe JS dimensions
 // without losing a boundary when cumulativeWeight*height exceeds 2^53.
 const total=weights.reduce((sum,value)=>sum+BigInt(value),0n);let cumulative=0n,top=0;
 return weights.map((weight,index)=>{cumulative+=BigInt(weight);const bottom=Number(cumulative*BigInt(pixels)/total),row={index,top,bottom,height:bottom-top};top=bottom;return row;});
}

/** Lower channel owns a shared boundary, as in native cell subdivision.
 * Returns the real row index, or -1 for an empty body/outside unclamped bounds.
 */
export function channelAtY(y,rows,{clamp=true}={}){
 if(!Number.isFinite(y)||!Array.isArray(rows))return -1;
 const visible=rows.filter(row=>row&&integer(row.index)&&integer(row.top)&&integer(row.bottom)&&row.bottom>row.top&&row.height===row.bottom-row.top);
 if(!visible.length)return -1;
 const row=visible.find(row=>y>=row.top&&y<row.bottom);if(row)return row.index;
 if(!clamp)return -1;
 return y<visible[0].top?visible[0].index:y>=visible.at(-1).bottom?visible.at(-1).index:-1;
}
