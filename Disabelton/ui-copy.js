/** Small UI copy helpers. Counts always agree with their noun. */
export function countLabel(count,singular,plural=`${singular}s`){const n=Number(count)||0;return `${n} ${n===1?singular:plural}`;}
export function playlistCopiesSavedMessage(count){return `${countLabel(count,'Playlist copy','Playlist copies')} saved.`;}
/** QA r7: Live-like clipboard toasts ("Pasted 1 clip", "Cut 3 clips") instead of "clips pasted.". */
export function clipClipboardMessage(action,count){const verb=action==='cut'?'Cut':action==='duplicate'?'Duplicated':'Pasted';return `${verb} ${countLabel(Math.max(1,Number(count)||0),'clip')}`;}

/** Disabelton: inherited FL / Logic wording → Ableton Live terms for user-visible toasts and
 * status text (idempotent). Playlist / Tracks area → Arrangement, region → clip, Channel Rack /
 * Step Sequencer → Drum Rack, Piano roll → Clip View, Mixer insert → track, Stereo Out → Main.
 * "clipboard" and other compounds are left alone. */
const LOGIC_COPY=[
 [/^Rename (Region|Clip|Track|Pattern|Channel)$/,'Rename'],
 // History labels (cloud-pattern-history kinds): ⌥-drag / ⌘D copies are Live's "Duplicate Clip" for audio and MIDI clips alike.
 [/\bClone (pattern|audio) clips?\b/gi,'Duplicate Clip'],[/\bPlaylist move\b/g,'Move Clip'],
 [/\bPlaylist (clip|track|row|lane)(s?)\b/g,(_,noun,plural)=>({clip:'clip',track:'track',row:'track',lane:'track'})[noun]+plural],
 [/\bthe (Playlist|Tracks area)\b/g,'the Arrangement'],[/\bThe (Playlist|Tracks area)\b/g,'The Arrangement'],[/\b(Playlist|Tracks area)\b/g,'Arrangement'],
 [/\bChannel [Rr]ack\b/g,'Drum Rack'],[/\bthe Step Sequencer\b/g,'the Drum Rack'],[/\bStep Sequencer\b/g,'Drum Rack'],[/\bthe Rack\b/g,'the Drum Rack'],[/(?<!Drum )\bRack\b/g,'Drum Rack'],
 [/\bPiano [Rr]oll\b/g,'Clip View'],[/\b[Mm]ixer insert(s?)\b/g,'track$1'],
 [/\bregion(s?)\b/g,'clip$1'],[/\bRegion(s?)\b/g,'Clip$1'],[/\bStereo Out\b/g,'Main']
];
export function logicCopy(message){let text=String(message??'');for(const [pattern,replacement]of LOGIC_COPY)text=text.replace(pattern,replacement);return text;}
export const ablCopy=logicCopy;
