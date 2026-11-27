/**
 * Live keeps clips on their bars when the tempo changes (Warp on). Freestyle saves a pattern placement's
 * cycle, offset, trim window and loop phase in milliseconds, so a tempo edit that keeps each clip's beat
 * position must also rescale those lengths, or a 1-bar clip saved at 124 BPM (1935 ms cycle) would loop
 * a third of a bar early at 87.5 BPM. Start positions follow from the beats when the placement is serialized.
 * Saved values are whole milliseconds, so a length that is within that rounding of a 1/96-beat grid
 * position is taken as exactly that position (1935 ms at 124 BPM is 4 beats, not 3.9990): repeated tempo
 * changes do not drift. Only saved timing (cloudRaw) is touched; the serializer rounds again for REST.
 */
const MS_FIELDS=['durationMs','duration_ms','loopDurationMs','loop_duration_ms','offsetMs','offset_ms','windowMs','window_ms','loopPhaseMs','loop_phase_ms'];
const GRID=96;

/** Beats read back from whole milliseconds at `bpm` → the 1/96-beat grid position they were rounded from, if any. */
export function wholeMsBeats(beats,bpm){
 const msPerBeat=60000/Number(bpm),snapped=Math.round(beats*GRID)/GRID;
 return Number.isFinite(beats)&&msPerBeat>0&&Math.abs(snapped-beats)*msPerBeat<=.5+1e-9?snapped:beats;
}
/** One saved length in ms at `from` BPM → the same musical length in ms at `to` BPM. */
export function followTempoMs(value,from,to){
 const fromBeat=60000/Number(from),toBeat=60000/Number(to);if(!Number.isFinite(value)||!(fromBeat>0)||!(toBeat>0))return value;
 return wholeMsBeats(value/fromBeat,from)*toBeat;
}

/** Rescales every pattern clip's saved millisecond lengths from `from` to `to` BPM (in place); returns how many clips changed. */
export function followTempoPlacements(project,from,to){
 if(!project||!(Number(from)>0)||!(Number(to)>0)||Number(from)===Number(to))return 0;let changed=0;
 for(const clip of project.clips||[]){
  const raw=clip?.cloudRaw;if(!clip.patternId||!raw||typeof raw!=='object')continue;let touched=false;
  for(const key of MS_FIELDS){const value=raw[key];if(typeof value==='number'&&Number.isFinite(value)&&value>0){raw[key]=followTempoMs(value,from,to);touched=true;}}
  // The model's start and length (beats) were read back from those whole milliseconds at the old tempo
  // (64.001 beats for bar 17 at 87.5 BPM): put them back on the grid they were placed on.
  for(const key of ['start','length']){const value=clip[key];if(typeof value==='number'&&Number.isFinite(value)&&value>0){const beats=wholeMsBeats(value,from);if(beats!==value){clip[key]=beats;touched=true;}}}
  if(touched)changed++;
 }
 return changed;
}
