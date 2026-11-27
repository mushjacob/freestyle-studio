/** FL Studio Channel Rack channel-menu step operations (Image-Line manual,
 * channelrack.htm "Right-Click, Channel Operations Menu" and
 * stepsequencer_advancedfilltool.htm). Pure functions over one channel's step
 * row: `false` is an empty cell, `true` or a 0..1 velocity is a lit step. Every
 * result keeps the row length and only lights cells inside the pattern's step
 * grid, so a saved score never gains off-grid or out-of-pattern hits. */

const lit=value=>value===true||(typeof value==='number'&&value>0);
const whole=(value,min,max)=>Math.min(max,Math.max(min,Math.trunc(Number(value))||0));

/** Cells the pattern plays: its step count, at least one. */
export function patternStepCount(lengthBeats){return Math.max(1,Math.ceil((Number(lengthBeats)||0)*4-1e-9));}

/** Row length used for a whole-row write (the existing FL Fill extent): never
 * shorter than one bar, the pattern or the stored row. */
export function rackRowLength(current,lengthBeats){return Math.max(16,Array.isArray(current)?current.length:0,patternStepCount(lengthBeats));}

/** Fill each N steps: steps 1, N+1, 2N+1… lit across the pattern (FL
 * replaces the row); stored cells past the pattern length are cleared. */
export function fillEachSteps(current,every,lengthBeats){
 const n=whole(every,1,4096),length=rackRowLength(current,lengthBeats),span=patternStepCount(lengthBeats);
 return Array.from({length},(_,index)=>index<span&&index%n===0);
}

/** Rotate left/right (Shift+Ctrl+Left/Right): move the step data one step
 * (the rack's snap unit), wrapping inside the pattern's steps. Velocities move
 * with their steps; cells past the pattern length are left as stored. */
export function rotateSteps(current,delta,lengthBeats){
 const row=Array.isArray(current)?current.slice():[],span=Math.min(row.length,patternStepCount(lengthBeats));if(span<2)return row;
 const shift=((Math.trunc(delta)%span)+span)%span;if(!shift)return row;
 const head=row.slice(0,span);for(let index=0;index<span;index++)row[(index+shift)%span]=head[index];
 return row;
}

/** Evenly spaced onsets (Bjorklund/Euclidean): `count` hits over `length` steps, first hit on step 1. */
export function euclideanPattern(length,count){
 const n=whole(length,0,4096),k=whole(count,0,n);
 return Array.from({length:n},(_,index)=>k>0&&(index*k)%n<k);
}

/** "Fill every" pattern of the Advanced Fill tool: one hit each `every` steps. */
export function everyPattern(length,every){const n=whole(length,0,4096),e=whole(every,1,4096);return Array.from({length:n},(_,index)=>index%e===0);}

/** Advanced fill: the sequence (Manual / Fill every / Euclidean, its length,
 * interval or step count, and rotation) tiled over the pattern's steps; the
 * rest of the row is cleared. Generated cells are plain `true` steps (default
 * velocity), like FL's fill; Manual cells keep their own values. */
export function advancedFillSteps(current,{mode='every',sequenceLength=16,stepCount=4,rotate=0,manual=[]}={},lengthBeats){
 const length=rackRowLength(current,lengthBeats),span=patternStepCount(lengthBeats),size=whole(sequenceLength,1,span);
 let sequence=mode==='manual'?Array.from({length:size},(_,index)=>lit(manual?.[index])?manual[index]:false):mode==='euclidean'?euclideanPattern(size,stepCount):everyPattern(size,stepCount);
 sequence=rotateSteps(sequence,rotate,size/4);
 return Array.from({length},(_,index)=>index<span&&sequence[index%size]);
}

/** Deterministic PRNG (mulberry32) for the Advanced Fill dice. */
export function seededRandom(seed){let state=(Number(seed)>>>0)||1;return()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

/** Dice: "Randomize steps within the parameters of the current settings" —
 * keeps the mode and sequence length, draws a step count and rotation. */
export function randomizeAdvancedFill(settings,seed){
 const random=seededRandom(seed),size=Math.max(1,whole(settings?.sequenceLength,1,4096)),mode=settings?.mode==='every'?'every':'euclidean';
 const stepCount=mode==='euclidean'?1+Math.floor(random()*size):1+Math.floor(random()*Math.min(size,8));
 return{...settings,mode,sequenceLength:size,stepCount,rotate:Math.floor(random()*size)};
}

/** The Advanced Fill wheel: node centres for `count` steps, step 1 at 12 o'clock, clockwise. */
export function wheelPoints(count,radius,center=radius){const n=Math.max(1,Math.trunc(count)||1);return Array.from({length:n},(_,index)=>{const angle=index/n*2*Math.PI;return{x:center+radius*Math.sin(angle),y:center-radius*Math.cos(angle)};});}

/** Wheel step nearest a pointer offset (dx, dy) from the centre. */
export function wheelStepAt(dx,dy,count){const n=Math.max(1,Math.trunc(count)||1),angle=(Math.atan2(dx,-dy)+2*Math.PI)%(2*Math.PI);return Math.round(angle/(2*Math.PI)*n)%n;}

/** Dragging a node from one wheel step to another rotates by the difference (shortest way round). */
export function wheelRotation(from,to,count){const n=Math.max(1,Math.trunc(count)||1);let delta=((to-from)%n+n)%n;if(delta>n/2)delta-=n;return delta;}

/** True when two rows store the same steps (velocities compared exactly). */
export function sameSteps(a,b){if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;return a.every((value,index)=>(value===true?true:lit(value)?value:false)===(b[index]===true?true:lit(b[index])?b[index]:false));}

/** FL rack keyboard: Shift+Ctrl(+Cmd on macOS)+Left/Right rotate the selected channels. */
export function rackRotateCommand(event,{rackFocused=false,dialogOpen=false}={}){
 if(!rackFocused||dialogOpen||event?.defaultPrevented||event?.isComposing||!(event?.ctrlKey||event?.metaKey)||!event.shiftKey||event.altKey||event.target?.closest?.('input,select,textarea,dialog,[contenteditable]:not([contenteditable=false]),[role=textbox]'))return null;
 return{ArrowLeft:-1,ArrowRight:1}[event.key]??null;
}
