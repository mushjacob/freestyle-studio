/** FL-style value box (the red LCD boxes of FL's tool dialogs): drag up/down or
 * scroll to change the value, click to cycle, arrow keys / Home / End from the
 * keyboard. No native <select>/<input>, so pointer automation reaches it.
 *
 * A box is either a list of `options` ({value,label}) or an integer range
 * `min..max`; `wrap` makes a click past the end return to the start. */

/** Next value after moving `delta` steps (clamped, or wrapped when `wrap`). */
export function valueBoxStep({options=null,min=0,max=0,wrap=false}={},value,delta){
 if(options){const count=options.length;if(!count)return value;let index=options.findIndex(option=>option.value===value);if(index<0)index=0;const next=index+Math.trunc(delta);return options[wrap?((next%count)+count)%count:Math.max(0,Math.min(count-1,next))].value;}
 const low=Math.trunc(min),high=Math.max(low,Math.trunc(max)),span=high-low+1,next=(Math.trunc(Number(value))||0)+Math.trunc(delta);
 return wrap?low+(((next-low)%span)+span)%span:Math.max(low,Math.min(high,next));
}

/** Pixels of vertical drag per step. */
export const VALUE_BOX_DRAG_PX=6;

/** Mount a value box in `element`. Returns {get, set, update(config), destroy}. */
export function valueBox(element,{label='',value,options=null,min=0,max=0,wrap=false,format=null,onChange=()=>{}}={}){
 let config={options,min,max,wrap},current=value,drag=null;
 const text=()=>config.options?(config.options.find(option=>option.value===current)?.label??String(current)):format?format(current):String(current);
 const paint=()=>{element.textContent=text();element.setAttribute('aria-valuetext',text());if(!config.options){element.setAttribute('aria-valuenow',String(current));element.setAttribute('aria-valuemin',String(config.min));element.setAttribute('aria-valuemax',String(config.max));}};
 const set=(next,{notify=true}={})=>{if(next===current){paint();return;}current=next;paint();if(notify)onChange(current);};
 const move=delta=>set(valueBoxStep(config,current,delta));
 const name=next=>{label=next;if(label)element.setAttribute('aria-label',label);element.title=`${label}: drag up/down or scroll to change, click to cycle`;};
 element.classList.add('fl-value-box');element.tabIndex=0;element.setAttribute('role','spinbutton');name(label);
 const down=event=>{if(event.button!==0)return;event.preventDefault();drag={y:event.clientY,steps:0,moved:false,pointerId:event.pointerId};try{element.setPointerCapture?.(event.pointerId);}catch{}try{element.focus({preventScroll:true});}catch{}};
 const over=event=>{if(!drag)return;const steps=Math.trunc((drag.y-event.clientY)/VALUE_BOX_DRAG_PX);if(steps===drag.steps)return;drag.moved=true;move(steps-drag.steps);drag.steps=steps;};
 const up=()=>{const was=drag;drag=null;if(was&&!was.moved)move(1);};
 const cancel=()=>{drag=null;};
 const wheel=event=>{event.preventDefault();if(event.deltaY)move(event.deltaY<0?1:-1);};
 const key=event=>{const delta={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1,PageUp:4,PageDown:-4}[event.key];if(delta){event.preventDefault();move(delta);return;}
  if(event.key==='Home'||event.key==='End'){event.preventDefault();set(config.options?config.options[event.key==='Home'?0:config.options.length-1].value:event.key==='Home'?config.min:config.max);}
  if(event.key==='Enter'||event.key===' '){event.preventDefault();move(1);}};
 element.addEventListener('pointerdown',down);element.addEventListener('pointermove',over);element.addEventListener('pointerup',up);element.addEventListener('pointercancel',cancel);element.addEventListener('wheel',wheel,{passive:false});element.addEventListener('keydown',key);
 paint();
 return{get:()=>current,set:(next)=>set(next,{notify:false}),step:move,update({label:nextLabel,...next}={}){if(typeof nextLabel==='string'&&nextLabel!==label)name(nextLabel);config={...config,...next};if(!config.options)current=valueBoxStep(config,current,0);paint();},
  destroy(){element.removeEventListener('pointerdown',down);element.removeEventListener('pointermove',over);element.removeEventListener('pointerup',up);element.removeEventListener('pointercancel',cancel);element.removeEventListener('wheel',wheel);element.removeEventListener('keydown',key);}};
}
