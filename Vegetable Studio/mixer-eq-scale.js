/** Scale math of the mixer Equalizer graph. ONE object maps frequency and gain (dB) to
 * CSS pixels inside the plot; the band lines, the response curve, the on-graph readouts
 * and the drag hit points are all drawn from it, so a band at (f, dB) is on the line of f
 * and its readout sits at that band at every size and device pixel ratio.
 *
 * Frequency axis: the reference mixer EQ (captured 2025 build) is not a pure log axis: its
 * default bands 90 Hz / 1.5 kHz / 8 kHz sit at 9.2 % / 50 % / 82.4 % of the graph width,
 * which is log(f + 100 Hz) across 20 Hz–20 kHz (9.0 / 50.6 / 82.2 %). The same position
 * drives the frequency knobs (1.5 kHz points straight up). Gain: linear ±18 dB, 0 dB on
 * the centre line, the curve reaching the frame (no padding).
 * No DOM here: unit-tested in mixer-eq-scale.test.mjs. */
export const MIXER_EQ_FREQUENCY=Object.freeze([20,20000]);
export const MIXER_EQ_GAIN=Object.freeze([-18,18]);
export const MIXER_EQ_PAD=Object.freeze({x:0,y:0});
/** Hz added before the logarithm (see above). 0 = a plain log axis. */
export const MIXER_EQ_WARP=100;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

/** 0..1 position of `hz` on the frequency axis (graph x and frequency-knob turn). */
export function mixerEqFrequencyPos(hz,{frequency=MIXER_EQ_FREQUENCY,warp=MIXER_EQ_WARP}={}){
 const [fMin,fMax]=frequency;return Math.log((clamp(hz,fMin,fMax)+warp)/(fMin+warp))/Math.log((fMax+warp)/(fMin+warp));
}
/** Inverse of mixerEqFrequencyPos. */
export function mixerEqFrequencyAtPos(pos,{frequency=MIXER_EQ_FREQUENCY,warp=MIXER_EQ_WARP}={}){
 const [fMin,fMax]=frequency;return clamp((fMin+warp)*((fMax+warp)/(fMin+warp))**clamp(pos,0,1)-warp,fMin,fMax);
}

export function mixerEqScale(width,height,{padX=MIXER_EQ_PAD.x,padY=MIXER_EQ_PAD.y,dpr=1,frequency=MIXER_EQ_FREQUENCY,gain=MIXER_EQ_GAIN,warp=MIXER_EQ_WARP}={}){
 width=Math.max(1,Number(width)||1);height=Math.max(1,Number(height)||1);dpr=Number(dpr)>0?Number(dpr):1;
 // The padding never eats more than a third of a small graph.
 padX=clamp(padX,0,width/3);padY=clamp(padY,0,height/3);
 const [gMin,gMax]=gain,left=padX,right=width-padX,top=padY,bottom=height-padY,plotWidth=right-left,plotHeight=bottom-top,axis={frequency,warp};
 const x=hz=>left+mixerEqFrequencyPos(hz,axis)*plotWidth;
 // yRaw is unclamped (a summed curve may leave the ±range plot); y clamps like a band's gain.
 const yRaw=db=>top+(gMax-db)/(gMax-gMin)*plotHeight,y=db=>yRaw(clamp(db,gMin,gMax));
 const frequencyAt=px=>mixerEqFrequencyAtPos((px-left)/plotWidth,axis);
 const gainAt=px=>gMax-clamp((px-top)/plotHeight,0,1)*(gMax-gMin);
 // Where to centre a `line` CSS px wide stroke near `px` so it covers whole device pixels
 // (odd device width: a pixel centre; even: a pixel boundary). Never more than half a
 // device pixel from the exact position. Band lines AND band points use it, so a band's
 // readout and hit point are on its line exactly.
 const snap=(px,line=1)=>Math.max(1,Math.round(line*dpr))%2?(Math.floor(px*dpr)+.5)/dpr:Math.round(px*dpr)/dpr;
 return Object.freeze({width,height,dpr,left,right,top,bottom,plotWidth,plotHeight,x,y,yRaw,frequencyAt,gainAt,snap,hairline:1/dpr,
  point:(hz,db)=>({x:x(hz),y:y(db)}),
  // Device-pixel position (for a canvas backing store or a screenshot overlay check).
  device:(hz,db)=>({x:x(hz)*dpr,y:y(db)*dpr})});
}

/** Decade grid of the frequency axis (every decade `major`; 2..9 × decade minor, thinned to
 * 2 and 5 when a decade is narrower than `denseFrom` px). The mixer graph itself draws only
 * its band lines (mixerEqBandLines), like the reference; this stays for wider editors. */
export function mixerEqFrequencyGrid(scale,{frequency=MIXER_EQ_FREQUENCY,denseFrom=56}={}){
 const [fMin,fMax]=frequency,decadePx=scale.plotWidth/Math.log10(fMax/fMin),steps=decadePx>=denseFrom?[1,2,3,4,5,6,7,8,9]:[1,2,5],lines=[];
 for(let decade=10**Math.floor(Math.log10(fMin));decade<=fMax;decade*=10)for(const step of steps){const hz=decade*step;if(hz<fMin-1e-9||hz>fMax+1e-9)continue;lines.push({hz,major:step===1,edge:hz===fMin||hz===fMax,x:scale.x(hz)});}
 return lines;
}
/** The faint vertical line of each band, at the band's current frequency (snapped). */
export function mixerEqBandLines(scale,frequencies){
 return frequencies.map(hz=>({hz,x:scale.snap(scale.x(hz))}));
}
/** Horizontal grid of the dB axis: 0 dB is the centre line. */
export function mixerEqGainGrid(scale,{gain=MIXER_EQ_GAIN,step=6}={}){
 const lines=[];for(let db=Math.ceil(gain[0]/step)*step;db<=gain[1]+1e-9;db+=step)lines.push({db,zero:db===0,edge:db===gain[0]||db===gain[1],y:scale.y(db)});
 return lines;
}
/** SVG path of `response(hz) → dB` across the plot. `fill` closes it on the 0 dB line. */
export function mixerEqCurvePath(scale,response,{steps=96,fill=false}={}){
 let path='';const zero=scale.y(0);
 for(let i=0;i<=steps;i++){const px=scale.left+i/steps*scale.plotWidth,py=clamp(scale.yRaw(response(scale.frequencyAt(px))),1,scale.height-1);path+=(i?'L':'M')+px.toFixed(2)+' '+py.toFixed(2);}
 return fill?`${path}L${scale.right.toFixed(2)} ${zero.toFixed(2)}L${scale.left.toFixed(2)} ${zero.toFixed(2)}Z`:path;
}
export const formatEqFrequency=hz=>hz>=10000?(hz/1000).toFixed(1)+' kHz':hz>=1000?(hz/1000).toFixed(2)+' kHz':Math.round(hz)+' Hz';
export const formatEqGain=db=>{const value=Math.round(db*10)/10;return(value>0?'+':value<0?'-':'')+Math.abs(value).toFixed(1)+' dB';};

/** The on-graph readout of a band, as the reference draws it: "90Hz -4.2", "1.5k 5.8",
 * "12k -3.0" (value, dimmer unit, gain without a plus sign). */
export function mixerEqReadout(hz,db){
 let value,unit;
 if(hz>=1000){const k=hz/1000;value=k>=10?String(Math.round(k)):(Math.round(k*10)/10).toFixed(1).replace(/\.0$/,'');unit='k';}
 else{value=String(Math.round(hz));unit='Hz';}
 const gain=Math.round(db*10)/10;
 return{value,unit,gain:(Object.is(gain,-0)?0:gain).toFixed(1)};
}
/** Where a readout `width` × `height` CSS px is drawn for a band at `point` ({x,y}, from the
 * scale): its left edge `gap` px right of the band line (left of it when it would leave the
 * graph), its baseline just above both the band point and the curve under the text; below
 * them when there is no room above. `curveY(px)` is the curve's y at a graph x. */
export function mixerEqReadoutPlace(scale,point,{width,height=9,gap=3,lift=4,curveY=null,avoid=[]}={}){
 let x=point.x+gap;if(x+width>scale.right-2)x=point.x-gap-width;x=clamp(x,scale.left+2,Math.max(scale.left+2,scale.right-2-width));
 let above=point.y,below=point.y;
 if(curveY)for(let i=0;i<=8;i++){const y=curveY(x+i/8*width);if(Number.isFinite(y)){above=Math.min(above,y);below=Math.max(below,y);}}
 const fit=y=>clamp(y,scale.top+1+height,scale.bottom-2);
 // `avoid`: readouts already placed ({x,y,width,height}, y = baseline). Never written over one.
 const hits=y=>avoid.find(box=>x<box.x+box.width+2&&box.x<x+width+2&&y-height<box.y+2&&box.y-box.height<y+2);
 const first=above-lift-height<scale.top+1?below+lift+height:above-lift,tries=[first,first===above-lift?below+lift+height:above-lift];
 for(const box of avoid)tries.push(box.y-box.height-3,box.y+height+3);
 const baseline=tries.map(fit).find(y=>!hits(y))??fit(first);
 return{x,y:baseline};
}
