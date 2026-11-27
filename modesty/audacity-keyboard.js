/** Exact modifier matching for implemented core shortcuts. Unsupported variants
 * never fall through to the unmodified command (or the retained legacy app).
 * Navigation/piano/browser keys outside this set keep their existing owners.
 */
/** ⌘⌥ letter shortcuts: Option changes event.key on macOS (⌥K = ˚, ⌥I = ˆ, ⌥X = ≈, ⌥J = ∆, ⌥U = a dead key), so the physical key decides. */
const OPTION_CODES={KeyK:'k',KeyI:'i',KeyX:'x',KeyJ:'j',KeyU:'u'};
export function audacityShortcutKey(event){return (event.metaKey||event.ctrlKey)&&event.altKey&&OPTION_CODES[event.code]?OPTION_CODES[event.code]:String(event.key||'').toLowerCase();}
const primary=new Set(['s',',','e','z','a','n','1','2','3','f','i','t','k','d','x','c','v','u','o','w','y','l','j','[',']','f2']);
const shiftedPrimary=new Set(['s','e','z','a','n','i','f','c','x','u','k']);
/** ⌘⌥K Split Delete, ⌘⌥X Split Cut, ⌘⌥I Split New, ⌘⌥J Detach at Silences. */
const optionPrimary=new Set(['k','i','x','j']);
/** Plain keys; E is Effect > Add Realtime Effects. */
const plain=new Set([' ','p','r','z','l','x','e','[',']','a','d','tab','home','end','delete','backspace']);
const shiftedPlain=new Set([' ','z','l','r','d','tab','home','end']);
/** Native shortcuts that exist only with Shift: ⇧C close focused track, ⇧M track menu, ⇧U / ⇧S mute / solo focused track, ⇧T Timer Record. */
const shiftOnly=new Set(['c','m','u','s','t']);
const functions=new Set(['f1','f2','f3','f4','f6']);
/** null means this helper does not own the key; true/false match the exact
 * implemented combination. False suppresses legacy handlers, while the caller
 * leaves the browser's default shortcut behavior alone.
 */
export function audacityShortcutVariant(event){
 const key=audacityShortcutKey(event),meta=event.metaKey||event.ctrlKey;
 if(meta&&key==='f2')return !event.altKey&&!event.shiftKey;
 if(meta&&key==='m')return event.shiftKey&&!event.altKey?true:null;// ⌘⇧M Mix and Render to New Track (⌘M stays the system's)
 if(functions.has(key))return !meta&&!event.altKey&&!event.shiftKey;
 if(meta){
  if(key==='r')return !event.altKey&&!event.shiftKey;// ⌘R Repeat Last Effect (the caller leaves it to the browser until an effect ran)
  if(key==='u'&&event.altKey)return true;// ⌘⌥U Mute Tracks, ⌘⌥⇧U Unmute Tracks
  if(primary.has(key)){if(event.altKey)return optionPrimary.has(key)&&!event.shiftKey;return !event.shiftKey||shiftedPrimary.has(key);}
  return plain.has(key)?false:null;
 }
 if(shiftOnly.has(key))return event.shiftKey&&!event.altKey?true:null;
 if(!plain.has(key))return null;
 if(event.altKey)return key==='l'&&event.shiftKey;
 return !event.shiftKey||shiftedPlain.has(key);
}
