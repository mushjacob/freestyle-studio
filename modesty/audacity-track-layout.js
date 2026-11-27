import {DEFAULT_TRACK_HEIGHT_PX} from './audacity-layout.js';
// Display-only policies from Audacity 3.2.1, commit 969e36f4968e66375a794a938dd906a3556e0bbc.
// TrackInfo::MinimumTrackHeight: 18 + 18 + (5 + 2) + 1.
// CommonTrackView partitions this GROUP minimum across linked channels.
export const MINIMIZED_TRACK_HEIGHT=44;
export const NATIVE_FIT_HEIGHT_RESERVE=28;
export const NATIVE_FIT_RESERVE=NATIVE_FIT_HEIGHT_RESERVE;

const countOf=count=>{if(!Number.isSafeInteger(count)||count<1||count>256)throw new TypeError('Channel count must be a positive integer no greater than 256.');return count;};
const pixel=value=>{if(!Number.isFinite(value)||!Number.isSafeInteger(Math.trunc(value)))throw new TypeError('Track height must be finite safe integer pixels.');return Math.trunc(value);};
const heightsOf=state=>{
 const heights=state?.expandedHeights;
 if(!Array.isArray(heights)||!heights.length||!heights.every(height=>Number.isSafeInteger(height)&&height>=0)||!heights.some(height=>height>0))throw new TypeError('Expanded channel heights must be nonnegative integer pixels with a positive total.');
 return heights;
};
export function channelMinimumHeights(channelCount=1){
 const count=countOf(channelCount);
 return Array.from({length:count},(_,index)=>Math.floor(MINIMIZED_TRACK_HEIGHT*(index+1)/count)-Math.floor(MINIMIZED_TRACK_HEIGHT*index/count));
}
export function partitionTrackHeight(height,channelCount=1){
 const count=countOf(channelCount),total=Math.max(MINIMIZED_TRACK_HEIGHT,pixel(height));
 return Array.from({length:count},(_,index)=>Math.floor(total*(index+1)/count)-Math.floor(total*index/count));
}
export function createTrackLayout({height=DEFAULT_TRACK_HEIGHT_PX,channelCount=1,minimized=false}={}){
 return {expandedHeights:partitionTrackHeight(height,channelCount),minimized:!!minimized};
}
export function trackLayoutHeight(state){return state.minimized?MINIMIZED_TRACK_HEIGHT:heightsOf(state).reduce((sum,height)=>sum+height,0);}
export function setTrackMinimized(state,minimized){return {expandedHeights:[...heightsOf(state)],minimized:!!minimized};}

/** Bottom-border resize. Native preserves each linked channel's proportion;
 * integer conversion happens per channel, not after summing the group. A drag
 * out of minimized state starts at the minimized sizes, not the saved sizes.
 * Native's resize source implements mono/stereo; >2 generalizes the same rule.
 */
export function resizeTrackLayout(state,delta){
 const expanded=heightsOf(state),minimums=channelMinimumHeights(expanded.length),initial=state.minimized?minimums:expanded,total=initial.reduce((sum,height)=>sum+height,0),movement=pixel(delta);
 if(movement===0)return setTrackMinimized(state,state.minimized);
 // Preserve source operation order: dividing before multiplying and computing
 // the upper proportion as 1-lower/total changes integer truncation at exact
 // pixel boundaries. Algebraic rearrangements can differ by a whole pixel.
 if(initial.length===1)return {expandedHeights:[Math.max(minimums[0],initial[0]+movement)],minimized:false};
 if(initial.length===2){const proportion=initial[1]/(initial[1]+initial[0]);return {expandedHeights:[Math.max(minimums[0],Math.trunc(initial[0]+movement*(1-proportion))),Math.max(minimums[1],Math.trunc(initial[1]+movement*proportion))],minimized:false};}
 return {expandedHeights:initial.map((height,index)=>Math.max(minimums[index],Math.trunc(height+movement*height/total))),minimized:false};
}

/** Native doResizeBetween: move the linked-channel boundary while preserving
 * the combined height, clamping the lower channel first then the upper one.
 * Native implements stereo; adjacent-pair behavior for >2 is a generalization.
 */
export function resizeTrackChannelBoundary(state,boundaryIndex,delta){
 const expanded=heightsOf(state),movement=pixel(delta);
 if(!Number.isInteger(boundaryIndex)||boundaryIndex<0||boundaryIndex>=expanded.length-1)throw new RangeError('Choose an existing linked-channel boundary.');
 if(movement===0)return setTrackMinimized(state,state.minimized);
 const minima=channelMinimumHeights(expanded.length),initial=state.minimized?minima:expanded,result=[...initial],upper=initial[boundaryIndex],lower=initial[boundaryIndex+1];
 let newUpper=upper+movement,newLower=lower-movement;
 if(newLower<minima[boundaryIndex+1]){newLower=minima[boundaryIndex+1];newUpper=upper+lower-minima[boundaryIndex+1];}
 if(newUpper<minima[boundaryIndex]){newUpper=minima[boundaryIndex];newLower=upper+lower-minima[boundaryIndex];}
 result[boundaryIndex]=newUpper;result[boundaryIndex+1]=newLower;return {expandedHeights:result,minimized:false};
}

/** ViewMenus::DoZoomFitV: only nonminimized AudioTrack channels participate.
 * Fixed/unknown browser lane types are explicitly excluded, never guessed.
 * Input rows: {id,kind:'audio'|'fixed',channelCount,state,height?}.
 */
export function fitTrackLayouts(rows,viewportHeight){
 const eligible=rows.filter(row=>row.kind==='audio'&&!row.state.minimized&&Number.isSafeInteger(row.channelCount)&&row.channelCount>0&&row.channelCount<=256);
 const channelCount=eligible.reduce((sum,row)=>sum+row.channelCount,0);
 if(!channelCount)return {changed:false,channelHeight:null,layouts:new Map()};
 const eligibleSet=new Set(eligible),fixedHeight=rows.reduce((sum,row)=>sum+(eligibleSet.has(row)?0:row.height==null?trackLayoutHeight(row.state):Math.max(0,pixel(row.height))),0);
 const channelHeight=Math.max(MINIMIZED_TRACK_HEIGHT,Math.trunc((pixel(viewportHeight)-NATIVE_FIT_HEIGHT_RESERVE-fixedHeight)/channelCount));
 return {changed:true,channelHeight,layouts:new Map(eligible.map(row=>[row.id,{expandedHeights:Array(row.channelCount).fill(channelHeight),minimized:false}]))};
}
