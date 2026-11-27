/** Small UI copy helpers. Counts always agree with their noun. */
export function countLabel(count,singular,plural=`${singular}s`){const n=Number(count)||0;return `${n} ${n===1?singular:plural}`;}
export function playlistCopiesSavedMessage(count){return `${countLabel(count,'Playlist copy','Playlist copies')} saved.`;}

/** Trashlab: inherited FL wording → Logic terms for user-visible toasts.
 * Playlist → Tracks area, clip → region, Channel Rack → Step Sequencer, Piano roll → Piano Roll,
 * Mixer insert → channel strip. "clipboard" and other compounds are left alone. */
const LOGIC_COPY=[
 [/\bPlaylist (clip|track|row|lane)(s?)\b/g,(_,noun,plural)=>({clip:'region',track:'track',row:'track',lane:'track'})[noun]+plural],
 [/\bthe Playlist\b/g,'the Tracks area'],[/\bThe Playlist\b/g,'The Tracks area'],[/\bPlaylist\b/g,'Tracks area'],
 [/\bChannel [Rr]ack\b/g,'Step Sequencer'],[/\bthe Rack\b/g,'the Step Sequencer'],[/\bRack\b/g,'Step Sequencer'],
 [/\bPiano roll\b/g,'Piano Roll'],[/\b[Mm]ixer insert(s?)\b/g,'channel strip$1'],
 [/\bclip(s?)\b/g,'region$1'],[/\bClip(s?)\b/g,'Region$1']
];
export function logicCopy(message){let text=String(message??'');for(const [pattern,replacement]of LOGIC_COPY)text=text.replace(pattern,replacement);return text;}
