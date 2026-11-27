/** Logic's Musical Typing window (⌘K): A S D F G H J K L ; ' are white keys,
 * W E T Y U O P black keys, Z/X octave down/up, C/V velocity down/up.
 * Audition only (existing owned-voice path); it never writes the score.
 */
export const LOGIC_TYPING_KEYS=Object.freeze({
 KeyA:0,KeyW:1,KeyS:2,KeyE:3,KeyD:4,KeyF:5,KeyT:6,KeyG:7,KeyY:8,KeyH:9,KeyU:10,KeyJ:11,
 KeyK:12,KeyO:13,KeyL:14,KeyP:15,Semicolon:16,Quote:17,
});
const LETTERS=Object.freeze({a:'KeyA',w:'KeyW',s:'KeyS',e:'KeyE',d:'KeyD',f:'KeyF',t:'KeyT',g:'KeyG',y:'KeyY',h:'KeyH',u:'KeyU',j:'KeyJ',k:'KeyK',o:'KeyO',l:'KeyL',p:'KeyP',';':'Semicolon',"'":'Quote',z:'KeyZ',x:'KeyX',c:'KeyC',v:'KeyV'});
export const typingCode=event=>event?.code&&event.code!=='Unidentified'?event.code:LETTERS[String(event?.key||'').toLowerCase()]??null;
const modified=event=>!event||event.defaultPrevented||event.isComposing||event.keyCode===229||event.altKey||event.ctrlKey||event.metaKey||event.getModifierState?.('AltGraph');
const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export class LogicMusicalTyping{
 /** octave is Logic's octave number of the A key (C3 = MIDI 60). velocity is MIDI 1–127. */
 constructor({octave=3,velocity=100,onChange=()=>{}}={}){this.octave=octave;this.velocity=velocity;this.onChange=onChange;}
 get base(){return (this.octave+2)*12;}
 get range(){const low=this.base,high=Math.min(127,low+17);return{low,high,label:`${NAMES[low%12]}${Math.floor(low/12)-2}–${NAMES[high%12]}${Math.floor(high/12)-2}`};}
 pitchFor(event){
  if(modified(event)||event.shiftKey)return null;const code=typingCode(event);
  if(!Object.hasOwn(LOGIC_TYPING_KEYS,code))return null;const pitch=this.base+LOGIC_TYPING_KEYS[code];return pitch>=0&&pitch<=127?pitch:null;
 }
 velocityFor(){return this.velocity/127;}
 /** Z/X/C/V control keys. Returns the change or null when the key is not a control. */
 control(event){
  if(modified(event)||event.shiftKey)return null;const code=typingCode(event);
  if(code==='KeyZ'||code==='KeyX'){const next=Math.max(-2,Math.min(8,this.octave+(code==='KeyZ'?-1:1)));if(next===this.octave)return{type:'octave',value:next,changed:false};this.octave=next;this.onChange(this);return{type:'octave',value:next,changed:true};}
  if(code==='KeyC'||code==='KeyV'){const next=Math.max(1,Math.min(127,this.velocity+(code==='KeyC'?-10:10)));const changed=next!==this.velocity;this.velocity=next;if(changed)this.onChange(this);return{type:'velocity',value:next,changed};}
  return null;
 }
 /** True when this key belongs to the Musical Typing surface (note or control key). */
 owns(event){return this.pitchFor(event)!==null||(!modified(event)&&!event.shiftKey&&['KeyZ','KeyX','KeyC','KeyV'].includes(typingCode(event)));}
}

const WHITE=[['KeyA','A'],['KeyS','S'],['KeyD','D'],['KeyF','F'],['KeyG','G'],['KeyH','H'],['KeyJ','J'],['KeyK','K'],['KeyL','L'],['Semicolon',';'],['Quote',"'"]];
const BLACK=[['KeyW','W',0],['KeyE','E',1],['KeyT','T',3],['KeyY','Y',4],['KeyU','U',5],['KeyO','O',7],['KeyP','P',8]];
/** Window body markup: octave bar, keys labelled with their computer key and note. */
export function musicalTypingMarkup(typing,held=new Set()){
 const name=pitch=>`${NAMES[pitch%12]}${Math.floor(pitch/12)-2}`,base=typing.base;
 const white=WHITE.map(([code,label])=>{const pitch=base+LOGIC_TYPING_KEYS[code];return `<div class="mt-key mt-white${held.has(code)?' down':''}" data-code="${code}" data-pitch="${pitch}"><b>${label}</b><span>${pitch%12===0?name(pitch):''}</span></div>`;}).join('');
 const black=BLACK.map(([code,label,slot])=>`<div class="mt-key mt-black${held.has(code)?' down':''}" data-code="${code}" data-pitch="${base+LOGIC_TYPING_KEYS[code]}" style="--slot:${slot}"><b>${label}</b></div>`).join('');
 const octaves=Array.from({length:11},(_,i)=>`<i class="${i-2===typing.octave?'on':''}"></i>`).join('');
 return `<div class="mt-octaves" title="Octave range ${typing.range.label}">${octaves}</div><div class="mt-controls"><span class="mt-control"><b>Z</b><b>X</b> Octave <em>${typing.range.label}</em></span><span class="mt-control"><b>C</b><b>V</b> Velocity <em>${typing.velocity}</em></span></div><div class="mt-keys">${white}${black}</div>`;
}
