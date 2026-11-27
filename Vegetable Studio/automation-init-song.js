/** FL "Init song with this position" (A08). Pure plan + one undoable write; no DOM.
 *  Value at the playhead (mirrors services/automation_service.py:_evaluate) becomes the envelope's
 *  defaultValue and its time-0 point, saved through the store's updateAutomationEnvelope path. */
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
const DB_FLOOR=1e-7/4,BEZIER_SCALE=9;
function dbInterpolate(v0,v1,ratio){
 if(ratio<=0)return v0;if(ratio>=1)return v1;
 if(v0<=DB_FLOOR&&v1<=DB_FLOOR)return v0;
 const l0=Math.log(Math.max(v0,DB_FLOOR)),l1=Math.log(Math.max(v1,DB_FLOOR));return Math.exp(l0+(l1-l0)*ratio);
}
/** Envelope value at `timeSec` (envelope-relative). Right-continuous at a discontinuity pair. */
export function envelopeValueAt(points,timeSec,fallback=0){
 const rows=(Array.isArray(points)?points:[]).filter(point=>finite(point?.timeSec)&&finite(point?.value)).sort((a,b)=>a.timeSec-b.timeSec);
 if(!rows.length)return finite(fallback)?fallback:0;
 if(timeSec<rows[0].timeSec)return rows[0].value;
 const last=rows[rows.length-1];if(timeSec>=last.timeSec)return last.value;
 let low=0,high=rows.length-1;while(low+1<high){const middle=(low+high)>>1;if(rows[middle].timeSec<=timeSec)low=middle;else high=middle;}
 const left=rows[low],right=rows[high];
 if(left.curve==='hold'||right.timeSec<=left.timeSec)return left.value;
 let ratio=clamp((timeSec-left.timeSec)/(right.timeSec-left.timeSec),0,1);
 if(left.curve==='db')return dbInterpolate(left.value,right.value,ratio);
 if(left.curve==='bezier'){const tension=clamp(Number(left.tension)||0,-1,1),exponent=1+Math.abs(tension)*BEZIER_SCALE;ratio=tension>=0?ratio**exponent:1-(1-ratio)**exponent;}
 return left.value+(right.value-left.value)*ratio;
}
/** {value, points}: the new default and the point list with its time-0 point set to it. Unknown point fields (meta) are kept. */
export function initSongPlan(envelope,relativeSec){
 const points=(Array.isArray(envelope?.points)?envelope.points:[]).map(copy).sort((a,b)=>a.timeSec-b.timeSec);
 const value=clamp(envelopeValueAt(points,finite(relativeSec)?relativeSec:0,envelope?.defaultValue),0,1);
 const first=points[0],next=points.slice();
 if(first&&first.timeSec===0)next[0]={...first,value};
 else next.unshift({timeSec:0,value,curve:first?.curve||'linear',tension:first?.tension||0});
 return{value,points:next};
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
/** One undo step. `store` is the AutomationStore (save carries the revision each response returned);
 *  `history` the pattern history (begin/finishExternalStep). Returns the applied value, or null when it changes nothing. */
export async function initSongWithPosition({envelope,relativeSec,store,history=null,onStatus=()=>{},log=()=>{}}){
 if(!envelope||!envelope.persisted||!envelope.id)throw new Error('Init song with this position needs a saved automation clip.');
 const live=store.get?.(`${envelope.clipId}|${envelope.targetKey}`)||envelope;
 if(live.pointsTruncated||live.points_truncated)throw new Error('Freestyle returned a partial envelope. Reload all points before editing it.');
 const before={defaultValue:Number(live.defaultValue),points:copy(live.points||[])},plan=initSongPlan(live,relativeSec);
 if(before.defaultValue===plan.value&&same(before.points,plan.points)){onStatus('This envelope already starts at this position.');return null;}
 let token=null;if(history?.beginExternalStep)try{token=history.beginExternalStep({kind:'automation_init_song',label:'Init song with this position'});}catch(error){log('automation-init-song',{step:'begin-refused',message:String(error?.message||'').slice(0,160)});}
 try{await store.save(live,plan.points,{defaultValue:plan.value});}
 catch(error){if(token)history.failExternalStep(token,error);throw error;}
 const write=async state=>{await store.save(live,state.points,{defaultValue:state.defaultValue});};
 const step={detail:{envelopeId:live.id,targetKey:live.targetKey,defaultValue:plan.value},undo:()=>write(before),redo:()=>write({defaultValue:plan.value,points:plan.points})};
 if(token)history.finishExternalStep(token,step);else history?.recordExternalStep?.({kind:'automation_init_song',label:'Init song with this position',...step});
 onStatus(`Initialised the song at ${Math.round(plan.value*1000)/10}%.`);return plan.value;
}
