/** Ableton Live 12 key map for Disabelton.
 *
 * `resolveAblKey(event, context)` turns a keydown into an intent ({command,…})
 * and performs no I/O. `installAblKeys` routes intents to handlers in the window
 * capture phase (ahead of the inherited FL shortcut layer) and consumes only keys
 * that resolve to a handler. Space, ⌘Z/⇧⌘Z, ⌘C/⌘X/⌘V, ⌘A, Delete and ⌘S stay
 * with the existing (proven) transport and edit layers; this map adds Live's
 * keys and blocks FL / Logic letter tools that Live does not have.
 *
 * Context: {view:'arrangement'|'session', scope:'arrangement'|'clip'|'device'|'browser'|null,
 *           typing:boolean (computer MIDI keyboard on), dialogOpen, hasSelection}.
 */
const textEntry='input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="color"]):not([type="file"]),textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"]';
const path=event=>event.composedPath?.()||[event.target];
/** Elements that handle ⌘R (rename) themselves (Layout contract). */
export const ABL_OWN_RENAME='[data-abl-rename],.abl-pad,.abl-device';
const inside=(event,selector)=>path(event).some(node=>node?.isContentEditable===true&&selector===textEntry||node?.closest?.(selector));

/** FL / Logic single-letter tools Live does not have: consumed (no-op) in the Arrangement so a
 * stray P / D / C / E / S / T / Y never switches an inherited tool. */
const BLOCKED_LETTERS=new Set(['p','d','c','e','s','t','y','x','i','k','o','f','r','g','q']);
/** Grid sizes ⌘1 / ⌘2 step through (beats; 0 = off is ⌘4). */
export const ABL_GRID_STEPS=Object.freeze([0.125,0.25,0.5,1,2,4,8]);

export function resolveAblKey(event,context={}){
 if(!event||event.defaultPrevented||event.isComposing||event.keyCode===229||event.key==='Process'||context.dialogOpen)return null;
 if(inside(event,textEntry))return null;
 if(inside(event,'dialog,[role="dialog"],.native-plugin-viewport'))return null;
 const key=String(event.key||''),code=String(event.code||''),lower=key.toLowerCase(),cmd=!!event.metaKey,ctrl=!!event.ctrlKey,alt=!!event.altKey,shift=!!event.shiftKey;
 // Option changes the character on a Mac keyboard: match the physical key.
 const letter=/^Key[A-Z]$/.test(code)?code.slice(3).toLowerCase():lower,digit=/^Digit[0-9]$/.test(code)?code.slice(5):/^[0-9]$/.test(key)?key:null;
 const intent=(command,fields={})=>({command,repeatable:false,...fields});
 const scope=context.scope||null,clipScope=scope==='clip',deviceScope=scope==='device';
 // View keys work everywhere outside text entry.
 if(key==='Tab'&&!cmd&&!ctrl&&!alt)return intent(shift?'toggle-detail-kind':'toggle-view');
 if(cmd&&alt&&!ctrl&&!shift){
  if(letter==='b')return intent('toggle-browser');
  if(letter==='l')return intent('toggle-detail');
  if(letter==='m')return intent('toggle-arrangement-mixer');
  if(letter==='t')return intent('insert-return-track');
  if(letter==='p')return intent('toggle-detail-kind');
  // Live: ⌥⌘I shows or hides the mixer's In/Out section.
  if(letter==='i')return intent('toggle-in-out');
  // Live 12: ⌥⌘3 / ⌥⌘4 show or hide the Clip / Device View, ⌥⌘5 the Browser.
  if(digit==='3')return intent('toggle-clip-view');
  if(digit==='4')return intent('toggle-device-view');
  if(digit==='5')return intent('toggle-browser');
  // Live 12 View menu: ⌥⌘Z Undo History, ⌥⌘E Expand Clip View.
  if(letter==='z')return intent('undo-history');
  if(letter==='e')return intent('expand-clip-view');
  return null;
 }
 // Live: ⌥⇧F Follow (scroll the display with playback); ⌥U unfold / fold all tracks.
 if(alt&&shift&&!cmd&&!ctrl&&letter==='f')return intent('toggle-follow');
 // Live 12: ⌥⇧M Navigate ▸ Mixer; ⌥⇧1 View ▸ MIDI Note Editor (⌥⇧2 Envelope / ⌥⇧3 Expression Editor are not available).
 if(alt&&shift&&!cmd&&!ctrl&&letter==='m')return intent('focus-mixer');
 if(alt&&shift&&!cmd&&!ctrl&&digit==='1')return intent('show-note-editor');
 if(alt&&shift&&!cmd&&!ctrl&&(digit==='2'||digit==='3'))return intent('unavailable',{what:digit==='2'?'Envelope Editor':'Expression Editor',why:digit==='2'?'clip envelopes are not available in Freestyle.':'MPE is not available in Freestyle.'});
 // Live 12 Navigate: ⌥0 Control Bar, ⌥1 Session, ⌥2 Arrangement, ⌥3 Clip View, ⌥4 Device View, ⌥5 Browser.
 if(alt&&!shift&&!cmd&&!ctrl&&digit==='0')return intent('focus-control-bar');
 if(alt&&!shift&&!cmd&&!ctrl&&digit&&'12345'.includes(digit))return intent(['focus-session','focus-arrangement','focus-clip-view','focus-device-view','focus-browser'][Number(digit)-1]);
 if(alt&&!shift&&!cmd&&!ctrl&&letter==='u'&&(scope===null||scope==='arrangement'))return intent('fold-all-tracks');
 if(key==='F12'&&!cmd&&!ctrl&&!alt&&!shift)return intent('toggle-detail-kind');
 // Live: F1…F8 switch the Track Activator of tracks 1…8, from anywhere outside text entry (a track that does not
 // exist leaves the key alone).
 if(/^F[1-8]$/.test(key)&&!cmd&&!ctrl&&!alt&&!shift&&Number(key.slice(1))<=(Number(context.trackCount)||0))return intent('track-activator',{track:Number(key.slice(1))-1});
 // Live keys with no Freestyle equivalent answer with the reason instead of doing nothing.
 if(key==='F10'&&!cmd&&!ctrl&&!alt&&!shift)return intent('unavailable',{what:'Back to Arrangement',why:'there is no Session playback to override the Arrangement.'});
 if(key==='F9'&&shift&&!cmd&&!ctrl&&!alt)return intent('unavailable',{what:'Arm Arrangement Recording',why:'press F9 to record; Freestyle has no separate arrangement-record arm.'});

 if(key==='F9'&&!cmd&&!ctrl&&!alt&&!shift)return intent('record');
 // ⇧Space: Continue Play from the stop position (Pro's Play/Pause path).
 if((code==='Space'||key===' ')&&shift&&!cmd&&!ctrl&&!alt)return intent('continue-play');
 // Live 12 Playback: ⌥Space Play From Insert Marker; ⇧⌘Space Move Insert Marker To Playhead; ⇧⌘F9 Record to Session.
 if(code==='Space'&&alt&&!shift&&!cmd&&!ctrl)return intent('play-from-marker');
 if(code==='Space'&&shift&&cmd&&!ctrl&&!alt)return intent('marker-to-playhead');
 if(key==='F9'&&shift&&cmd&&!ctrl&&!alt)return intent('unavailable',{what:'Record to Session',why:'Freestyle has no Session clip slots to record into.'});
 // ⌘ on macOS; ⌃T / ⇧⌃T also insert tracks because a browser tab reserves ⌘T.
 if(ctrl&&!cmd&&!alt&&letter==='t')return intent(shift?'insert-midi-track':'insert-audio-track');
 const mod=cmd&&!ctrl;
 if(mod&&!alt){
  if(shift){
   if(letter==='t')return intent('insert-midi-track');
   if(letter==='m')return intent('insert-midi-clip');
   if(letter==='r')return intent('export-audio');
   if(letter==='i'&&!clipScope)return intent('unavailable',{what:'Capture and Insert Scene',why:'Freestyle stores no scenes (a scene is the row of clips the tracks list); scenes launch from the Main column.'});
   // Live: ⇧⌘A Invert Selection, ⇧⌘L Select Loop (the Clip View inverts its own note selection).
   if(letter==='a'&&scope==='arrangement')return intent('invert-selection');
   if(letter==='l'&&scope==='arrangement')return intent('select-loop');
   return null;
  }
  if(key==='Backspace'||key==='Delete')return clipScope?null:intent('delete-track');
  // Live: ⌘X / ⌘C / ⌘V right after a track header click (track focus, no clip selected) cut / copy / paste the track.
  // ⌘V only while a track is on the track clipboard; otherwise these keys stay with the clip edit layer.
  if((letter==='x'||letter==='c'||(letter==='v'&&context.trackClipboard))&&context.trackFocus&&context.trackSelected&&context.clipSelection===false&&!clipScope&&!deviceScope&&scope!=='browser')return intent(letter==='x'?'track-cut':letter==='c'?'track-copy':'track-paste');
  if(letter==='t')return intent('insert-audio-track');
  if(letter==='i'&&!clipScope)return intent('unavailable',{what:'Insert Silence',why:'Freestyle has no ripple (time) edits.'});
  if(letter==='b'&&!clipScope&&!deviceScope)return intent('unavailable',{what:'Bounce to New Track',why:'use File ▸ Export Audio/Video; Freestyle has no bounce-in-place.'});
  if(letter==='f')return intent('focus-browser-search');
  if(letter==='l')return clipScope?null:intent('loop-selection');
  if(letter==='g')return intent('group-tracks');
  if(letter==='j')return intent('consolidate');
  if(letter==='e')return intent('split',{scope});
  if(letter==='d')return intent('duplicate',{scope});
  // ⌘R renames the focused thing: an element that owns its rename (Drum Rack pad, device box, anything
  // marked [data-abl-rename]) handles the key itself; otherwise the shell renames the clip / track.
  if(letter==='r')return inside(event,ABL_OWN_RENAME)?null:context.hasSelection===false&&!clipScope?null:intent('rename',{scope});
  if(letter==='u')return intent('quantize',{scope});
  if(digit==='1')return intent('grid-narrow',{scope});
  if(digit==='2')return intent('grid-widen',{scope});
  if(digit==='3')return intent('grid-triplet',{scope});
  if(digit==='4')return intent('grid-snap',{scope});
  // Live: ⌘5 Fixed Grid (the Clip View switches its own editor grid).
  if(digit==='5'&&!clipScope)return intent('grid-fixed',{scope});
  return null;
 }
 if(cmd||ctrl||alt)return null;
 // Live: Delete with a track (and no clips) selected deletes the track; clips stay with the edit layer.
 if((key==='Backspace'||key==='Delete')&&!shift&&scope==='arrangement'&&context.trackSelected&&context.clipSelection===false&&context.trackFocus)return intent('delete-track');
 // The computer MIDI keyboard owns letters while it is on (Live: A W S E D … play notes).
 // Live: while the computer MIDI keyboard is on, single-letter shortcuts still work with Shift (⇧S solos the track).
 const single=!context.typing?!shift:shift;
 if(single&&key.length===1&&!deviceScope&&scope!=='browser'&&!context.legacyTyping){
  if(letter==='o')return intent('toggle-metronome');
  if(!clipScope){
   // Live: S solos, C arms and U folds the selected track.
   if(context.trackSelected){
    if(letter==='s')return intent('solo-track');
    if(letter==='c')return intent('arm-track');
    if(letter==='u')return intent('fold-track');
   }
   if(letter==='x')return intent('zoom-back');
   if(letter==='w')return intent('zoom-fit-width');
   if(letter==='h')return intent('zoom-fit-height');
  }
 }
 if(context.typing&&key.length===1&&lower!=='m'&&lower!=='0'&&key!==' ')return null;
 if(!clipScope&&(key==='+'||key==='='||code==='NumpadAdd'))return{...intent('zoom-in'),repeatable:true};
 if(!clipScope&&(key==='-'||key==='_'||code==='NumpadSubtract'))return{...intent('zoom-out'),repeatable:true};
 if(shift)return null;
 if(deviceScope&&key.length===1&&!['a','b','m'].includes(lower))return null;
 if(lower==='a')return intent('toggle-automation');
 if(lower==='b')return intent('toggle-draw');
 if(lower==='m')return intent('toggle-computer-keyboard');
 if(lower==='z'&&!clipScope)return intent('zoom-to-selection');
 if(key==='0')return intent('deactivate',{scope});
 if(!clipScope&&key.length===1&&BLOCKED_LETTERS.has(lower)&&(scope===null||scope==='arrangement'))return intent('blocked-letter',{letter:lower});
 return null;
}

/** Route intents to handlers (window capture phase). Only intents with a handler are consumed. */
export function installAblKeys(target=globalThis.window,{getContext=()=>({}),handlers={}}={}){
 const listener=event=>{
  let action;try{action=resolveAblKey(event,getContext(event));}catch{return;}
  const handler=action&&handlers[action.command];if(action&&Array.isArray(globalThis.__ablKeyLog))globalThis.__ablKeyLog.push(action.command);if(typeof handler!=='function')return;
  event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();
  if(event.repeat&&!action.repeatable)return;
  try{const result=handler(action,event);if(result&&typeof result.catch==='function')result.catch(()=>{});}catch{}
 };
 target.addEventListener('keydown',listener,true);
 return()=>target.removeEventListener('keydown',listener,true);
}

/** Live's key list for Help ▸ Key Commands. */
export const ABL_KEY_HELP=Object.freeze([
 ['Play / Stop','Space'],['Continue Playback','⇧ Space'],['Play From Insert Marker','⌥ Space'],['Move Insert Marker To Playhead','⇧ ⌘ Space'],['Record to Arrangement','F9'],
 ['Undo History','⌥ ⌘ Z'],['Expand Clip View','⌥ ⌘ E'],['MIDI Note Editor','⌥ ⇧ 1'],['Navigate: Control Bar / Session / Arrangement / Clip / Device / Browser','⌥ 0 … ⌥ 5'],['Navigate: Mixer','⌥ ⇧ M'],
 ['Invert Selection / Select Loop','⇧ ⌘ A / ⇧ ⌘ L'],['Fixed Grid','⌘ 5'],['Clip View: Fold to Notes / Fold to Scale / Highlight Scales','F / G / K'],
 ['Session / Arrangement View','Tab'],['Clip / Device View','⇧ Tab'],['Show/Hide Browser','⌥ ⌘ B'],['Show/Hide Detail View','⌥ ⌘ L'],['Arrangement Mixer','⌥ ⌘ M'],
 ['Show/Hide Clip View / Device View','⌥ ⌘ 3 / ⌥ ⌘ 4'],['Follow (scroll display with playback)','⌥ ⇧ F'],['Metronome','O'],['Move Insert Marker to Beginning','Home'],
 ['Solo / Arm Selected Track','S / C'],['Track Activator 1…8','F1 … F8'],['Fit Arrangement Height','H'],['Fold / Unfold Selected Track (all tracks)','U (⌥ U)'],['Zoom Back from Selection / Fit Arrangement Width','X / W'],
 ['Session: select neighbouring clip / launch / stop','↑ ↓ ← → / ↵ / ⌘ ↵'],['Clip View: join notes / quantize settings / velocity ±','⌘ J / ⇧ ⌘ U / ⌘ ↑ ↓'],
 ['Automation Mode','A'],['Draw Mode','B'],['Computer MIDI Keyboard (single letters then need ⇧)','M'],
 ['Undo / Redo','⌘ Z / ⇧ ⌘ Z'],['Cut / Copy / Paste (clips, or the selected track)','⌘ X / ⌘ C / ⌘ V'],['Duplicate','⌘ D'],['Delete (clips, or the selected track)','⌫ / ⌘ ⌫'],['Select All','⌘ A'],
 ['Split (clips, or the selected track at the insert marker)','⌘ E'],['Rename','⌘ R'],['Loop Selection','⌘ L'],['Deactivate Clip / Track','0'],
 ['Insert Audio Track','⌘ T (⌃ T in a browser tab)'],['Insert MIDI Track','⇧ ⌘ T (⇧ ⌃ T in a browser tab)'],['Insert MIDI Clip','⇧ ⌘ M'],
 ['Narrow / Widen Grid','⌘ 1 / ⌘ 2'],['Triplet Grid','⌘ 3'],['Snap to Grid','⌘ 4'],['Zoom In / Out','+ / −'],['Zoom to Selection','Z'],
 ['Search in Browser','⌘ F'],['Export Audio/Video','⇧ ⌘ R'],['Save Live Set','⌘ S'],['Copy clip while dragging','⌥ drag']
]);
