/** FL Studio labels MIDI 60 as C5. This changes display, never note numbers. */
const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export function flNoteName(pitch){
 if(!Number.isInteger(pitch)||pitch<0||pitch>127)throw new RangeError('Choose a MIDI note from 0 to 127.');
 return names[pitch%12]+Math.floor(pitch/12);
}
