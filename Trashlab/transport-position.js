/** Native FL B:S:T: 16 steps per 4/4 bar, 24 ticks per step at 96 PPQ. */
export function formatTransportPosition(beat,ppq=96){
 const position=Math.max(0,Number(beat)||0),resolution=Number.isInteger(ppq)&&ppq>=4&&ppq%4===0?ppq:96;
 const ticks=Math.floor(position*resolution+1e-6),bar=Math.floor(ticks/(resolution*4))+1,within=ticks%(resolution*4),step=Math.floor(within/(resolution/4))+1,tick=within%(resolution/4);
 return `${bar}:${String(step).padStart(2,'0')}:${String(tick).padStart(2,'0')}`;
}
