/** Zoom-adaptive bar ruler and grid density, shared by every bar ruler (Tracks area, Piano Roll).
 *
 * A ruler that draws one number and one tick per bar is unreadable once bars are a few pixels
 * wide, and shows too little once a bar is hundreds of pixels wide. Like a real DAW:
 *  - bar numbers step 1, 2, 4, 8, 16, 32, 64 ... bars so labels are never closer than ~45 px;
 *  - unlabelled bar ticks are drawn only while they are at least ~6 px apart;
 *  - beat ticks, then division (1/16) ticks, appear only once they are ~6 px apart, and their
 *    "bar beat" / "bar beat division" labels only once there is room for the text;
 *  - grid lines in the lanes follow the same steps.
 * Pure functions, no DOM. */
export const RULER_LABEL_MIN_PX=45,RULER_TICK_MIN_PX=6,RULER_SUB_LABEL_MIN_PX=35,RULER_GRID_MAJOR_MIN_PX=24,RULER_GRID_MID_MAX_PX=320,RULER_FINE_TICK_MIN_PX=8;
const powerOfTwoStep=(unitPx,minPx)=>{let step=1;while(step*unitPx<minPx&&step<1<<20)step*=2;return step;};

/** Density for `pxPerBar` pixels per bar.
 * @returns {{labelBars:number,tickBars:number,beatTicks:boolean,divisionTicks:boolean,beatLabels:boolean,divisionLabels:boolean,
 *   compact:boolean,grid:{majorBeats:number,midBeats:number,minorBeats:number},beatsPerBar:number,divisionsPerBeat:number,key:string}}
 *  labelBars: bars between numbered bars (1, 2, 4 ...). tickBars: bars between drawn bar ticks (<= labelBars).
 *  compact: a bar is narrower than its label, so numbers must overflow their bar cell.
 *  grid: line spacing in beats, coarse to fine; a level that would be too dense equals the next coarser one.
 *  fineDivisions: unlabelled ruler ticks per division when zoomed far in (0, 2, 4, 8 or 16).
 *  key: changes exactly when the rendered ruler markup must change. */
export function rulerScale(pxPerBar,{beatsPerBar=4,divisionsPerBeat=4,labelMinPx=RULER_LABEL_MIN_PX,tickMinPx=RULER_TICK_MIN_PX,subLabelMinPx=RULER_SUB_LABEL_MIN_PX,gridMajorMinPx=RULER_GRID_MAJOR_MIN_PX,gridMidMaxPx=RULER_GRID_MID_MAX_PX,fineTickMinPx=RULER_FINE_TICK_MIN_PX}={}){
 const bar=Number.isFinite(pxPerBar)&&pxPerBar>0?pxPerBar:1,beat=bar/beatsPerBar,division=beat/divisionsPerBeat;
 const labelBars=powerOfTwoStep(bar,labelMinPx),tickBars=Math.min(labelBars,powerOfTwoStep(bar,tickMinPx));
 const beatTicks=beat>=tickMinPx,divisionTicks=division>=tickMinPx,beatLabels=beat>=subLabelMinPx,divisionLabels=division>=subLabelMinPx;
 const majorBars=powerOfTwoStep(bar,gridMajorMinPx),majorBeats=majorBars*beatsPerBar;
 // Grid below the bar: beat, division, quarter-division. The middle level is the coarsest of them
 // that is still on screen often enough (<= gridMidMaxPx apart); the minor level is the next finer one.
 const subLevels=[1,1/divisionsPerBeat,1/divisionsPerBeat/4],subPx=beats=>beats*beat;
 let midBeats=majorBeats,minorBeats=majorBeats;
 if(majorBars>1){midBeats=minorBeats=majorBeats/2;}
 else if(beatTicks){
  let level=0;while(level<subLevels.length-1&&subPx(subLevels[level])>gridMidMaxPx)level++;
  midBeats=subLevels[level];minorBeats=level<subLevels.length-1&&subPx(subLevels[level+1])>=tickMinPx?subLevels[level+1]:midBeats;
 }
 // Ruler ticks finer than a division are not elements: a repeating background at this spacing.
 let fineDivisions=0;if(divisionLabels)for(let parts=2;parts<=16&&division/parts>=fineTickMinPx;parts*=2)fineDivisions=parts;
 return{labelBars,tickBars,beatTicks,divisionTicks,beatLabels,divisionLabels,fineDivisions,compact:labelBars>1,grid:{majorBeats,midBeats,minorBeats},beatsPerBar,divisionsPerBeat,
  key:labelBars>1?`${labelBars}.${tickBars}`:['1',+beatTicks,+divisionTicks,+beatLabels,+divisionLabels].join('.')};
}

/** What bar `index` (0-based) shows: its number, a full tick, a short tick, or nothing. */
export function rulerBarKind(index,scale){return index%scale.labelBars===0?'label':index%scale.tickBars===0?'tick':'none';}

/** Markup of one bar cell. `attribute` carries the bar's start beat for the ruler's pointer code.
 * At one label per bar the cell is exactly the classic `<div class="ruler-bar">N…</div>`; when
 * zoomed out the number is a `.ruler-num` span that may overflow its (narrow) cell. */
export function rulerBarMarkup(index,scale,{attribute='data-beat',subLabels=true,separator=' '}={}){
 const number=index+1,kind=rulerBarKind(index,scale),per=scale.beatsPerBar*scale.divisionsPerBeat;
 if(scale.compact)return`<div class="ruler-bar ruler-compact ruler-${kind}" ${attribute}="${index*scale.beatsPerBar}">${kind==='label'?`<span class="ruler-num">${number}</span>`:''}</div>`;
 let sub='';
 if(scale.beatTicks)for(let beat=1;beat<=scale.beatsPerBar;beat++)for(let division=1;division<=(scale.divisionTicks?scale.divisionsPerBeat:1);division++){
  if(beat===1&&division===1)continue;
  const onBeat=division===1,labelled=subLabels&&(onBeat?scale.beatLabels:scale.divisionLabels),text=labelled?(onBeat?[number,beat]:[number,beat,division]).join(separator):'';
  sub+=`<span class="ruler-sub ${onBeat?'ruler-beat':'ruler-division'}${labelled?'':' ruler-sub-tick'}" style="left:${((beat-1)*scale.divisionsPerBeat+division-1)/per*100}%">${text}</span>`;
 }
 return`<div class="ruler-bar ruler-label" ${attribute}="${index*scale.beatsPerBar}">${number}${sub}</div>`;
}

/** CSS lengths for the lane / editor grid backgrounds at this zoom (coarse to fine). */
export function rulerGridWidths(pxPerBar,scale=rulerScale(pxPerBar)){
 const px=beats=>`${beats*pxPerBar/scale.beatsPerBar}px`;
 return{major:px(scale.grid.majorBeats),mid:px(scale.grid.midBeats),minor:px(scale.grid.minorBeats),fine:scale.fineDivisions?px(1/scale.divisionsPerBeat/scale.fineDivisions):'0px'};
}
