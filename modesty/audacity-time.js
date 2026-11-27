/** Audacity selection/time display math. No audio processing occurs here.
 * Selection coupling follows SelectionBar::ModifySelection in Audacity's
 * au3/src/toolbars/SelectionBar.cpp. Formats follow the Selection Toolbar manual.
 * NTSC timecode follows Audacity-3.7.1's ParsedNumericConverterFormatter.cpp:
 * https://github.com/audacity/audacity/blob/Audacity-3.7.1/libraries/lib-numeric-formats/formatters/ParsedNumericConverterFormatter.cpp
 * Use the exact 30000/1001 rate represented by its decimal scaling constants.
 */
const NTSC_RATE=30000/1001,NOMINAL_NTSC_RATE=30;
export const SELECTION_MODES=[
 {id:'start-end',label:'Start and End of Selection',fields:['Start','End']},
 {id:'start-length',label:'Start and Length of Selection',fields:['Start','Length']},
 {id:'length-end',label:'Length and End of Selection',fields:['Length','End']},
 {id:'length-center',label:'Length and Center of Selection',fields:['Length','Center']},
];
export const TIME_FORMATS=[
 {id:'seconds',label:'seconds',kind:'count',rate:1,unit:'seconds',digits:6},
 {id:'seconds-ms',label:'seconds + milliseconds',kind:'seconds',rate:1000,decimals:3},
 {id:'hms',label:'hh:mm:ss',kind:'clock',rate:1},
 {id:'dhms',label:'dd:hh:mm:ss',kind:'days',rate:1},
 {id:'hms-hundredths',label:'hh:mm:ss + hundredths',kind:'clock',rate:100,decimals:2},
 {id:'hms-ms',label:'hh:mm:ss + milliseconds',kind:'clock',rate:1000,decimals:3},
 {id:'hms-samples',label:'hh:mm:ss + samples',kind:'clock',requiresSampleRate:true,unit:'samples'},
 {id:'samples',label:'samples',kind:'count',requiresSampleRate:true,unit:'samples',digits:9},
 {id:'hms-frames24',label:'hh:mm:ss + film frames (24 fps)',kind:'clock',rate:24,unit:'frames'},
 {id:'frames24',label:'film frames (24 fps)',kind:'count',rate:24,unit:'frames',digits:6},
 {id:'ntsc-drop',label:'hh:mm:ss + NTSC drop frames',kind:'ntsc-clock',rate:NTSC_RATE,ntsc:true,drop:true,unit:'frames'},
 {id:'ntsc-nondrop',label:'hh:mm:ss + NTSC non-drop frames',kind:'ntsc-clock',rate:NTSC_RATE,ntsc:true,unit:'frames'},
 {id:'ntsc-frames',label:'NTSC frames',kind:'count',rate:NTSC_RATE,ntsc:true,unit:'frames',digits:6},
 {id:'hms-frames25',label:'hh:mm:ss + PAL frames (25 fps)',kind:'clock',rate:25,unit:'frames'},
 {id:'frames25',label:'PAL frames (25 fps)',kind:'count',rate:25,unit:'frames',digits:6},
 {id:'hms-frames75',label:'hh:mm:ss + CDDA frames (75 fps)',kind:'clock',rate:75,unit:'frames'},
 {id:'frames75',label:'CDDA frames (75 fps)',kind:'count',rate:75,unit:'frames',digits:6},
];
export const UNSUPPORTED_TIME_FORMATS=[];
const aliases={hhmmss:'hms',ddhhmmss:'dhms','hhmmss-ms':'hms-ms','hhmmss-hundredths':'hms-hundredths','hhmmss-samples':'hms-samples','hhmmss-frames24':'hms-frames24','hhmmss-frames25':'hms-frames25','hhmmss-frames75':'hms-frames75'};
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
function rangeValues(range){if(!finite(range?.start)||!finite(range?.end))throw new RangeError('Selection must satisfy 0 ≤ start ≤ end.');const start=Number(range.start),end=Number(range.end);if(start<0||end<start)throw new RangeError('Selection must satisfy 0 ≤ start ≤ end.');return [start,end];}
function modeValue(mode){const value=SELECTION_MODES.find(item=>item.id===mode);if(!value)throw new Error('Unsupported selection setup.');return value;}
export function selectionValues(range,mode='start-end'){
 modeValue(mode);const [start,end]=rangeValues(range),length=end-start;
 return mode==='start-end'?[start,end]:mode==='start-length'?[start,length]:mode==='length-end'?[length,end]:[length,(start+end)/2];
}
export function editSelection(range,mode,fieldIndex,valueSeconds){
 modeValue(mode);if(fieldIndex!==0&&fieldIndex!==1)throw new RangeError('Choose selection field 0 or 1.');if(!finite(valueSeconds))throw new TypeError('Selection time must be finite.');
 let [start,end]=rangeValues(range),length=end-start,center=(start+end)/2;const value=Math.max(0,Number(valueSeconds));
 if(mode==='start-end'){if(fieldIndex===0){start=value;end=Math.max(end,start);}else{end=value;start=Math.min(start,end);}}
 else if(mode==='start-length'){if(fieldIndex===0)start=value;else length=value;end=start+length;}
 else if(mode==='length-end'){if(fieldIndex===0)length=value;else end=value;start=end-length;if(start<0){if(fieldIndex===0)end=length;start=0;}}
 else{if(fieldIndex===0)length=value;else center=value;start=center-length/2;if(start<0){if(fieldIndex===0)center=length/2;else length=center*2;start=0;}end=center+length/2;}
 return {...range,start,end};
}
function specFor(formatId,{sampleRate}={}){
 const spec=TIME_FORMATS.find(item=>item.id===(aliases[formatId]||formatId));if(!spec)throw new Error('Unsupported time format.');
 const rate=spec.requiresSampleRate?Number(sampleRate):spec.rate;
 if((!Number.isInteger(rate)&&!spec.ntsc)||rate<=0||(spec.requiresSampleRate&&!finite(sampleRate)))throw new Error('This time format needs the actual positive integer cloud sample rate.');
 return {...spec,rate};
}
function unitsFor(seconds,rate){if(!finite(seconds))throw new TypeError('Time must be finite.');const units=Math.round(Math.max(0,Number(seconds))*rate);if(!Number.isSafeInteger(units))throw new RangeError('Time exceeds the exact supported numeric range.');return units;}
function padded(value,digits=2){return String(value).padStart(digits,'0');}
function grouped(value,digits){return padded(value,digits).replace(/\B(?=(\d{3})+(?!\d))/g,',');}
function ntscLabelFrames(frames,drop){
 if(!drop)return frames;
 const tens=Math.floor(frames/17982),remainder=frames%17982;
 const label=frames+18*tens+(remainder>=1800?2*(1+Math.floor((remainder-1800)/1798)):0);
 if(!Number.isSafeInteger(label))throw new RangeError('Time exceeds the exact supported numeric range.');
 return label;
}
function invalidDropLabel(label){const seconds=Math.floor(label/30);return seconds%60===0&&Math.floor(seconds/60)%10!==0&&label%30<2;}
function ntscActualFrames(label,drop){
 if(!Number.isSafeInteger(label)||label<0)throw new RangeError('Time exceeds the exact supported numeric range.');
 if(!drop)return label;
 if(invalidDropLabel(label))throw new RangeError('NTSC drop-frame labels 00 and 01 do not exist at this minute boundary.');
 const minutes=Math.floor(label/1800);return label-2*(minutes-Math.floor(minutes/10));
}
function layout(seconds,formatId,options){
 const spec=specFor(formatId,options),units=unitsFor(seconds,spec.rate),whole=Math.floor(units/spec.rate),fraction=units%spec.rate,digits=[];let text='';
 const literal=value=>{text+=value;};
 const field=(value,step,nominalFrames)=>{const start=text.length;literal(value);let place=1;for(let i=value.length-1;i>=0;i--)if(/\d/.test(value[i])){digits.push({index:start+i,stepSeconds:step*place,...(nominalFrames===undefined?{}:{nominalFrames:nominalFrames*place})});place*=10;}};
 if(spec.kind==='count'){field(grouped(units,spec.digits),1/spec.rate);literal(' '+spec.unit);}
 else if(spec.kind==='ntsc-clock'){
  const label=ntscLabelFrames(units,spec.drop),clock=Math.floor(label/NOMINAL_NTSC_RATE);
  field(padded(Math.floor(clock/3600)),108000/spec.rate,108000);literal(' h ');
  field(padded(Math.floor(clock/60)%60),1800/spec.rate,1800);literal(' m ');field(padded(clock%60),30/spec.rate,30);literal(' s + ');
  field(padded(label%30),1/spec.rate,1);literal(' frames');
 }
 else if(spec.kind==='seconds'){field(grouped(whole,6),1);literal('.');field(padded(fraction,spec.decimals),1/spec.rate);literal(' seconds');}
 else{
  if(spec.kind==='days'){field(padded(Math.floor(whole/86400)),86400);literal(' days ');}
  field(padded(spec.kind==='days'?Math.floor(whole/3600)%24:Math.floor(whole/3600)),3600);literal(' h ');
  field(padded(Math.floor(whole/60)%60),60);literal(' m ');field(padded(whole%60),1);
  if(spec.decimals){literal('.');field(padded(fraction,spec.decimals),1/spec.rate);literal(' s');}
  else{literal(' s');if(spec.rate>1){literal(' + ');field(padded(fraction,Math.max(2,Math.ceil(Math.log10(spec.rate)))),1/spec.rate);literal(' '+spec.unit);}}
 }
 digits.sort((a,b)=>a.index-b.index);return {text,digits,seconds:units/spec.rate,spec};
}
export function formatTimeValue(seconds,formatId='hms-ms',options={}){return layout(seconds,formatId,options).text;}

function clockSeconds(text,days=false,allowFraction=false){
 const normalized=text.trim().toLowerCase().replace(/\s*(?:days?|h|m|s)\s*/g,':').replace(/:+$/,'').replace(/\s/g,'');
 const parts=normalized.split(':');if(parts.length!==(days?4:3)||parts.some((part,index)=>!(index===parts.length-1&&allowFraction?/^\d+(?:\.\d+)?$/:/^\d+$/).test(part)))throw new Error('Enter a complete hours, minutes and seconds value.');
 const values=parts.map(Number),seconds=values.at(-1),minutes=values.at(-2),hours=values.at(-3),day=days?values[0]:0;
 if(seconds>=60||minutes>=60||(days&&hours>=24))throw new RangeError('Clock fields exceed their minute, hour, or day boundaries.');
 return day*86400+hours*3600+minutes*60+seconds;
}
export function parseTimeValue(text,formatId='hms-ms',options={}){
 const spec=specFor(formatId,options);if(typeof text!=='string'||!text.trim())throw new Error('Enter a time value.');let seconds;
 if(spec.kind==='count'||spec.kind==='seconds'){
  const value=text.trim().toLowerCase().replace(/\s*(?:seconds?|samples?|frames?)\s*$/,'').replaceAll(',','').trim();
  if(!(spec.kind==='count'&&spec.rate!==1?/^\d+$/:/^\d+(?:\.\d+)?$/).test(value))throw new Error('Enter a non-negative numeric time value.');
  seconds=Number(value)/(spec.kind==='count'?spec.rate:1);
 }else if(spec.kind==='ntsc-clock'){
  const parts=text.split('+');if(parts.length!==2)throw new Error('Enter clock time plus an integer frame count.');
  const fraction=parts[1].trim().toLowerCase().replace(/\s*frames?\s*$/,'').trim();
  if(!/^\d+$/.test(fraction)||Number(fraction)>=30)throw new RangeError('The NTSC frame remainder must be between 00 and 29.');
  const label=clockSeconds(parts[0])*30+Number(fraction);seconds=ntscActualFrames(label,spec.drop)/spec.rate;
 }else if(spec.rate>1&&!spec.decimals){
  const parts=text.split('+');if(parts.length!==2)throw new Error('Enter clock time plus an integer sample or frame count.');
  const fraction=parts[1].trim().toLowerCase().replace(/\s*(?:samples?|frames?)\s*$/,'').replaceAll(',','').trim();
  if(!/^\d+$/.test(fraction)||Number(fraction)>=spec.rate)throw new RangeError('The sample or frame remainder must fit within one second.');
  seconds=clockSeconds(parts[0],false,false)+Number(fraction)/spec.rate;
 }else seconds=clockSeconds(text,spec.kind==='days',!!spec.decimals);
 return unitsFor(seconds,spec.rate)/spec.rate;
}
function chosenDigit(text,caret,formatId,options){
 const seconds=parseTimeValue(text,formatId,options),formatted=layout(seconds,formatId,options),positions=[...text.matchAll(/\d/g)].map(match=>match.index);
 if(!positions.length)throw new Error('Select a time digit to edit.');
 const index=positions.findIndex(position=>position>=Math.max(0,Number(caret)||0)),chosen=index<0?positions.length-1:index;
 // Counting from the right also handles omitted leading zeros in typed input.
 const offset=positions.length-1-chosen,digit=formatted.digits[Math.max(0,formatted.digits.length-1-offset)];
 return {...digit,seconds,formatted};
}
function ntscDigitSeconds(digit,delta){
 const spec=digit.formatted.spec,label=ntscLabelFrames(unitsFor(digit.seconds,spec.rate),spec.drop);
 let next=Math.max(0,label+Math.round(delta*digit.nominalFrames));
 if(!Number.isSafeInteger(next))throw new RangeError('Time exceeds the exact supported numeric range.');
 // Like the native digit editor, carry in label space and skip missing labels
 // in the direction of the edit. No actual audio frames are removed.
 if(spec.drop&&invalidDropLabel(next))next=delta>=0?next-next%30+2:next-next%30-1;
 return ntscActualFrames(next,spec.drop)/spec.rate;
}
export function digitStepSeconds(text,caret,formatId='hms-ms',options={}){const digit=chosenDigit(text,caret,formatId,options);return digit.nominalFrames===undefined?digit.stepSeconds:ntscDigitSeconds(digit,1)-digit.seconds;}
export function stepTimeDigit(text,caret,delta,formatId='hms-ms',options={}){
 if(!finite(delta))throw new TypeError('The digit adjustment must be finite.');
 const digit=chosenDigit(text,caret,formatId,options),seconds=digit.nominalFrames===undefined?Math.max(0,digit.seconds+Number(delta)*digit.stepSeconds):ntscDigitSeconds(digit,Number(delta)),next=layout(seconds,formatId,options);
 const oldFromRight=digit.formatted.digits.length-1-digit.formatted.digits.findIndex(item=>item.index===digit.index),nextDigit=next.digits[Math.max(0,next.digits.length-1-oldFromRight)];
 return {text:next.text,caret:nextDigit.index,seconds:next.seconds};
}
