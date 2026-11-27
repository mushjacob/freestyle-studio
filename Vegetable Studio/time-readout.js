/** FL-style LCD position readout: every digit lives in its own fixed-width cell, so
 *  digits and separators never move as values change (only the digit text does). */
export function paintTimeReadout(host,text){
 if(!host)return;
 host._tvSource=String(text);text=displayText(String(text));
 const fields=String(text).split(':'),signature=host._tvFields;
 const bar=Math.max(host._tvBar||1,fields[0].length||1);
 if(!signature||signature.length!==fields.length||host._tvBar!==bar){
  host._tvBar=bar;
  const doc=host.ownerDocument,widths=fields.map((_,index)=>index===0?bar:2);
  host.textContent='';host._tvFields=widths;host._tvCells=[];
  fields.forEach((_,index)=>{
   if(index){const sep=doc.createElement('span');sep.className='tv-s';sep.textContent=':';host.append(sep);}
   const cells=[];for(let n=0;n<widths[index];n++){const cell=doc.createElement('span');cell.className='tv-d';host.append(cell);cells.push(cell);}
   host._tvCells.push(cells);
  });
 }
 fields.forEach((field,index)=>{
  const cells=host._tvCells[index],pad=field.padStart(cells.length,' ');
  cells.forEach((cell,n)=>{const ch=pad[n]===' '?'':pad[n];if(cell.textContent!==ch)cell.textContent=ch;});
 });
}

/** Seconds -> "M:SS:CC" (minutes : seconds : centiseconds). */
export function formatMinutesSeconds(seconds){
 const total=Math.max(0,Number(seconds)||0),cs=Math.floor(total*100+1e-6),minutes=Math.floor(cs/6000);
 return `${minutes}:${String(Math.floor(cs/100)%60).padStart(2,'0')}:${String(cs%100).padStart(2,'0')}`;
}

/** Convert the bars:steps:ticks readout (16 steps/bar, 96 PPQ, 4/4) into seconds at a constant bpm. */
export function stepsTextToSeconds(text,bpm,ppq=96){
 const match=/^(\d+):(\d+):(\d+)$/.exec(String(text).trim()),tempo=Number(bpm);
 if(!match||!Number.isFinite(tempo)||tempo<=0)return null;
 const beats=(+match[1]-1)*4+(+match[2]-1)/4+(+match[3])/ppq;
 return beats*60/tempo;
}

export const TIME_DISPLAY_STORAGE_KEY='vegetable:time-display-mode';
let timeMode='steps',timeBpm=()=>NaN;
const displayText=text=>{
 if(timeMode!=='time')return text;
 const seconds=stepsTextToSeconds(text,timeBpm());
 return seconds===null?text:formatMinutesSeconds(seconds);
};
export const timeDisplayMode=()=>timeMode;

/** Click toggles bars:steps:ticks <-> minutes:seconds:centiseconds; the choice is remembered. */
export function attachTimeDisplayToggle(display,{getBpm,storage}={}){
 if(!display)return;
 if(getBpm)timeBpm=getBpm;
 let store=storage;if(store===undefined){try{store=globalThis.localStorage;}catch{store=null;}}
 try{if(store?.getItem(TIME_DISPLAY_STORAGE_KEY)==='time')timeMode='time';}catch{}
 const host=display.querySelector?.('#time-value')||display,label=display.querySelector?.('small');
 const paint=()=>{if(label)label.textContent=timeMode==='time'?'M:S:CS':'B:S:T';if(host._tvSource!==undefined)paintTimeReadout(host,host._tvSource);display.title=timeMode==='time'?'Position · minutes, seconds and centiseconds (click to switch)':display.title;};
 const set=mode=>{timeMode=mode==='time'?'time':'steps';try{store?.setItem(TIME_DISPLAY_STORAGE_KEY,timeMode);}catch{}paint();return timeMode;};
 display.addEventListener('click',()=>set(timeMode==='time'?'steps':'time'));
 paint();
 return{set,get mode(){return timeMode;}};
}
