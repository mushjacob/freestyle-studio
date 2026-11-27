/** Channel rack step taps made while an earlier step write is still in flight
 * (a first-step source registration, a membership commit): the tap is painted
 * at once and replayed as a per-step delta once the write completes.
 * Pure: no DOM, no I/O. app.js owns the queue arrays and the replay.
 */

/** `steps` with every queued entry for this row applied, in queue order (the
 * last tap on a step wins). `entries` are {rowId,index,value}; `aliases` maps
 * a provisional rack row id to the channel id it became. */
export function queuedSteps(id,steps,entries=[],aliases=new Map()){
 const out=Array.isArray(steps)?steps.slice():[];
 for(const entry of entries)if(entry&&(entry.rowId===id||aliases.get(entry.rowId)===id)&&Number.isInteger(entry.index)&&entry.index>=0)out[entry.index]=entry.value;
 return out;
}

/** The per-step changes a gesture result makes against what is already shown
 * (saved steps plus the queue): one {rowId,index,value} per step that differs,
 * `false` for an off step, the step value otherwise. */
export function stepDeltas(stepsByChannel,currentOf){
 const out=[];
 for(const [id,steps]of stepsByChannel){
  const current=currentOf(id)||[];
  steps.forEach((value,index)=>{if(!!value!==!!current[index])out.push({rowId:id,index,value:value?value:false});});
 }
 return out;
}

/** Queue a gesture result behind the write in flight. Returns the deltas added
 * (none when the gesture changes nothing that is not already queued). */
export function queueStepTap(queue,stepsByChannel,currentOf){
 const deltas=stepDeltas(stepsByChannel,currentOf);
 queue.push(...deltas);
 return deltas;
}
