/** Native waveform view-coordinate policy; no samples, gain or DSP are changed.
 * Audacity 3.2.1, commit 969e36f4968e66375a794a938dd906a3556e0bbc:
 * src/TrackArt.cpp:GetWaveYPos/FromDB/ValueOfPixel;
 * libraries/lib-utility/MemoryX.h:DB_TO_LINEAR/LINEAR_TO_DB;
 * src/tracks/playabletrack/wavetrack/ui/WaveformVZoomHandle.cpp:DoZoom;
 * src/tracks/playabletrack/wavetrack/ui/WaveformVRulerControls.cpp:DoHandleWheelRotation/DoUpdateVRuler;
 * src/tracks/playabletrack/wavetrack/ui/WaveTrackVZoomHandle.cpp:DoRelease;
 * src/widgets/Ruler.cpp:TickSizes/UpdateLinear; src/prefs/GUIPrefs.cpp:GetRangeChoices.
 * https://github.com/audacity/audacity/tree/969e36f4968e66375a794a938dd906a3556e0bbc
 * Bounds are native DISPLAY coordinates: signed linear amplitude, or signed
 * (dB+range)/range in dB mode. They are not always raw PCM amplitude bounds.
 */
const F=Math.fround,finite=x=>typeof x==='number'&&Number.isFinite(x),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const DEFAULT_AMPLITUDE_DISPLAY=Object.freeze({min:-1,max:1,scale:'linear',dbRange:60});
export const AMPLITUDE_DB_RANGES=Object.freeze([36,48,60,72,84,96,120,145]);
export const AMPLITUDE_ZOOM_LIMIT=F(.001);
export function validateAmplitudeDisplay(display=DEFAULT_AMPLITUDE_DISPLAY){
 const result={...DEFAULT_AMPLITUDE_DISPLAY,...display};
 if(!finite(result.min)||!finite(result.max)||result.max<=result.min||!['linear','db'].includes(result.scale)||!finite(result.dbRange)||result.dbRange<=0)throw new RangeError('Choose finite ordered waveform bounds and a positive dB range.');
 result.min=F(result.min);result.max=F(result.max);result.dbRange=F(result.dbRange);if(!Number.isFinite(result.min)||!Number.isFinite(result.max)||result.max<=result.min||!Number.isFinite(result.dbRange))throw new RangeError('Waveform bounds exceed native Float32 display precision.');return result;
}
function heightValue(height,{zero=false}={}){if(!finite(height)||height<(zero?0:1))throw new RangeError('Waveform height must be a positive finite pixel dimension.');return Math.trunc(height);}
function coordinate(value,display,contour=false){
 let v=F(value);if(!Number.isFinite(v))throw new TypeError('Waveform amplitude must be finite.');
 if(display.scale==='db'){
  const sign=v>=0?1:-1;if(v!==0){const db=F(20*Math.log10(Math.abs(v)));v=F(F(db+display.dbRange)/display.dbRange);if(contour)v=F(v-.5);if(v<0)v=0;v=F(v*sign);}
 }else if(contour)v=F(v>=0?v-.5:v+.5);
 return v;
}
function fromDb(value,range){if(value===0)return 0;return F(10**((Math.abs(value)*range-range)/20)*(value>=0?1:-1));}
export function amplitudeToY(value,height,display=DEFAULT_AMPLITUDE_DISPLAY,{round=true,contour=false,clip=false}={}){
 const d=validateAmplitudeDisplay(display),h=heightValue(height,{zero:true});if(d.scale==='db'&&h===0)return 0;
 let v=coordinate(value,d,contour);if(clip)v=clamp(v,d.min,d.max);v=F(F(d.max-v)/F(d.max-d.min));const y=F(v*(h-1));return round?Math.trunc(y+.5):y;
}
export function amplitudeAtY(y,height,display=DEFAULT_AMPLITUDE_DISPLAY,{contour=false}={}){
 if(!finite(y))throw new TypeError('Waveform pointer position must be finite.');const d=validateAmplitudeDisplay(display),h=heightValue(height);let v=h===1?F(F(d.min+d.max)/2):F(d.max-F(F(Math.trunc(y)/F(h-1))*F(d.max-d.min)));
 if(contour)v=F(v>0?v+.5:v-.5);return d.scale==='db'?fromDb(v,d.dbRange):v;
}
/** Math from the ruler's guarded scale-conversion branch. Pinned3.2.1 fresh
 * tracks keep lastScaleType=-1 with no initializer found, so this branch is not
 * the effective fresh-track switch policy. The workspace preserves its bounds;
 * live/native version-specific verification remains required. */
export function changeAmplitudeScale(display,scale,dbRange=display?.dbRange??60){
 const d=validateAmplitudeDisplay(display);if(!['linear','db'].includes(scale)||!finite(dbRange)||dbRange<=0)throw new RangeError('Choose a native waveform scale and positive dB range.');
 const range=AMPLITUDE_DB_RANGES.filter(value=>value<=dbRange).at(-1)??AMPLITUDE_DB_RANGES[0];
 if(d.scale===scale)return {...d,dbRange:range};
 const convert=value=>{if(value===0)return 0;const sign=value>=0?1:-1;if(scale==='linear')return F(sign*10**((Math.abs(value)*range-range)/20));return F(sign*Math.max(0,F((20*Math.log10(Math.abs(value))+range)/range)));};
 return {...d,min:convert(d.min),max:convert(d.max),scale,dbRange:range};
}

/** Direct native DoZoom command. Only the drag override consults advanced;
 * menu commands themselves remain available with the preference disabled.
 */
export function verticalZoom(display,{command,height,y,startY=y??height/2,endY=startY,fixedMousePoint=false,advanced=false}={}){
 const d=validateAmplitudeDisplay(display),h=heightValue(height);if(!finite(startY)||!finite(endY))throw new TypeError('Vertical zoom coordinates must be finite.');
 let first=Math.trunc(startY),last=Math.trunc(endY);if(last<first)[first,last]=[last,first];
 if(advanced&&Math.abs(last-first)>3)command='drag';
 let min=d.min,max=d.max;const top=d.scale==='db'?F((20*Math.log10(2)+d.dbRange)/d.dbRange):2,half=d.scale==='db'?F((20*Math.log10(.5)+d.dbRange)/d.dbRange):.5;
 const mix=p=>F(max*(1-p)+F(min*p));
 switch(command){
  case 'reset':case '1to1':min=-1;max=1;break;
  case 'div2':min=-top;max=top;break;
  case 'times2':min=-half;max=half;break;
  case 'half-wave':min=F(-.01);max=1;break;
  case 'drag':{
   const tmin=min,tmax=max,p1=F(first/F(h)),p2=F(last/F(h));
   max=F(tmax*(1-p1)+F(tmin*p1));min=F(tmax*(1-p2)+F(tmin*p2));
   if(F(max-min)<AMPLITUDE_ZOOM_LIMIT){const c=F(F(min+max)/2);min=F(c-AMPLITUDE_ZOOM_LIMIT/2);max=F(c+AMPLITUDE_ZOOM_LIMIT/2);}break;
  }
  case 'in':{
   const old=F(max-min),length=Math.max(AMPLITUDE_ZOOM_LIMIT,F(.5*old)),ratio=F(length/F(max-min)),p=F(first/F(h)),c=mix(p);
   if(fixedMousePoint){min=F(c-F(F(ratio*F(1-p))*old));max=F(c+F(F(ratio*p)*old));}
   else{min=F(c-.5*length);max=F(c+.5*length);}break;
  }
  case 'out':{
   if(min<=-1&&max>=1){min=-top;max=top;break;}
   const lower=min< -1?-top:-1,upper=max>1?top:1,p=F(first/F(h));
   if(fixedMousePoint){const old=F(max-min),c=mix(p);min=Math.min(F(upper-AMPLITUDE_ZOOM_LIMIT),Math.max(lower,F(c-F(F(2*F(1-p))*old))));max=Math.max(F(lower+AMPLITUDE_ZOOM_LIMIT),Math.min(upper,F(c+F(F(2*p)*old))));}
   else{const c=F(F(p*min)+F(F(1-p)*max)),length=F(max-min);min=Math.min(F(upper-AMPLITUDE_ZOOM_LIMIT),Math.max(lower,F(c-length)));max=Math.max(F(lower+AMPLITUDE_ZOOM_LIMIT),Math.min(upper,F(c+length)));}break;
  }
  default:throw new Error('Choose a native vertical waveform zoom command.');
 }
 return {...d,min:F(min),max:F(max)};
}

/** Mouse-release policy from WaveTrackVZoomHandle::DoRelease. Plain right
 * release opens a menu. Plain left release is inert unless advanced is enabled.
 */
export function verticalPointerAction({button=0,shiftKey=false,cmdKey=false,advanced=false,captureLost=false,startY=0,endY=startY}={}){
 if(!finite(startY)||!finite(endY))throw new TypeError('Vertical ruler pointer coordinates must be finite.');
 const result={action:'none',command:null,startY:Math.trunc(startY),endY:Math.trunc(endY),fixedMousePoint:false,advanced:!!advanced};
 if(captureLost)return result;
 if(button===2&&!shiftKey&&!cmdKey)return {...result,action:'menu'};
 if(!advanced||![0,2].includes(button))return result;
 if(shiftKey)return {...result,action:'zoom',command:button===2?'1to1':'out',startY:result.endY};
 return {...result,action:'zoom',command:'in',fixedMousePoint:true};
}

/** Native wheel steps, not browser delta pixels. Ctrl/Command zooms once by its
 * sign, Shift pans 10px per step, Shift+Command changes the discrete dB cutoff.
 */
export function verticalWheel(display,{height,y=height/2,steps,shiftKey=false,cmdKey=false}={}){
 const d=validateAmplitudeDisplay(display),h=heightValue(height);if(!finite(y)||!finite(steps))throw new TypeError('Vertical ruler wheel position and steps must be finite.');
 if(!shiftKey&&!cmdKey)return {display:d,consumed:false,changed:false};let next=d;
 if(d.scale==='db'&&shiftKey&&cmdKey){
  if(!(d.min<0&&d.max>0))return {display:d,consumed:true,changed:false};
  const index=Math.max(0,AMPLITUDE_DB_RANGES.findLastIndex(range=>range<=d.dbRange)),range=AMPLITUDE_DB_RANGES[clamp(index+(steps<0?1:-1),0,AMPLITUDE_DB_RANGES.length-1)];next={...d,dbRange:range};
  const zero=Math.trunc(F(F(d.max/F(d.max-d.min))*h));
  if(4*Math.abs(Math.trunc(y)-zero)<h){const extreme=F((20*Math.log10(2)+range)/range);next.min=Math.max(-extreme,F(F(d.min*d.dbRange)/range));next.max=Math.min(extreme,F(F(d.max*d.dbRange)/range));}
 }else if(cmdKey&&!shiftKey)next=verticalZoom(d,{command:steps<0?'out':'in',height:h,startY:Math.trunc(y),endY:Math.trunc(y),fixedMousePoint:true});
 else if(shiftKey&&!cmdKey){
  const limit=d.scale==='db'?F((20*Math.log10(2)+d.dbRange)/d.dbRange):2,range=F(d.max-d.min),delta=F(range*steps*10/h);let top=Math.min(limit,F(d.max+delta));const bottom=Math.max(-limit,F(top-range));top=Math.min(limit,F(bottom+range));next={...d,min:F(bottom),max:F(top)};
 }
 return {display:next,consumed:true,changed:next.min!==d.min||next.max!==d.max||next.dbRange!==d.dbRange};
}

/** Numeric tick candidates from native Ruler::TickSizes/UpdateLinear. Exact
 * wxDC glyph metrics, font choice, label collisions and edge-label placement
 * remain renderer concerns; this helper does not claim identical font layout.
 */
export function amplitudeRulerTicks(height,display=DEFAULT_AMPLITUDE_DISPLAY){
 const d=validateAmplitudeDisplay(display),h=heightValue(height),length=h-1;if(length<1)return {ticks:[],minor:0,major:0,digits:0};
 const isDb=d.scale==='db',top=isDb?F(-F(F(1-d.max)*d.dbRange)):d.max,bottom=isDb?F(-F(F(1-d.min)*d.dbRange)):d.min,upp=(bottom-top)/length,units=16*Math.abs(upp);
 let step=.000001,digits=6,minor,major;
 for(;;){if(units<step){minor=step;major=step*5;break;}step*=5;if(units<step){minor=step;major=step*2;break;}step*=2;digits--;if(digits< -10){minor=step;major=step*2;if(isDb)digits++;break;}}
 const labels=new Map(),format=(value)=>{let v=value;if(!isDb&&v<0&&v+minor>0)v=0;return minor>=1?String(Math.floor(v+.5)):v.toFixed(Math.max(0,digits));};
 const add=(y,value,isMajor,priority)=>{
  if(y<0||y>length)return;let labelValue=value;if(isDb&&-labelValue>d.dbRange)labelValue=-2*d.dbRange-labelValue;
  const tick={y,value:labelValue,label:format(labelValue),major:isMajor,priority};const old=labels.get(y);if(!old||old.priority<priority)labels.set(y,tick);
 };
 const at=(value,priority)=>{if(value<=Math.min(top,bottom)||value>=Math.max(top,bottom))return;const mid=Math.trunc(length*((top-value)/(top-bottom))+.5);if(mid>=0&&mid<length-5)add(mid,value,true,priority);};
 if(isDb){at(-d.dbRange,100);at(0,90);at(-2*d.dbRange,90);add(0,top,true,80);add(length,bottom,true,80);}else at(0,100);
 const sign=upp>0?1:-1;
 for(const [denominator,isMajor]of [[major,true],[minor,false]]){
  let value=top-upp/2,previous=Math.floor(sign*value/denominator);
  for(let pixel=0;pixel<=length+1;pixel++){value+=upp;const current=Math.floor(sign*value/denominator);if(current>previous){previous=current;add(pixel,sign*current*denominator,isMajor,isMajor?50:10);}}
 }
 return {ticks:[...labels.values()].sort((a,b)=>a.y-b.y),minor,major,digits};
}
