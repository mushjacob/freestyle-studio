/** Read-only live Mixer meter frames.
 *
 * Freestyle streams `mixer_meters` over the monitor peer's `mozart-control` and
 * `mozart-meters` data channels. Studio Pro rejects frames for another project,
 * drops out-of-order sequence numbers (unless the sequence restarted by >=1000)
 * and normalizes track tuples `[id,lane_id,peak,live]` to `{id,lane_id,peak,live}`.
 *
 * A frame accepted here is stamped at receipt with its project, peer generation
 * and time. Meter levels are keyed by durable lane / bus IDs only; numeric
 * runtime track IDs are never retained, so a meter can never become a writable
 * mixer or plugin identity.
 */
export const MIXER_METER_MAX_AGE_MS=1500;
const finitePeak=value=>{const number=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;return Number.isFinite(number)&&number>=0?number:null;};
const id=value=>typeof value==='string'&&value.trim()&&value.length<=256?value:null;
const UNKNOWN=Object.freeze({known:false,value:null,receivedAt:null,source:null});
const unknown=reason=>Object.freeze({...UNKNOWN,reason});

/** Normalize one wire frame. Returns null for anything that is not a correctly scoped meter frame. */
export function normalizeMixerMeterFrame(data,{projectId,generation=0,receivedAt=Date.now()}={}){
 if(!data||typeof data!=='object'||Array.isArray(data)||data.type!=='mixer_meters')return null;
 if(!id(projectId)||typeof data.project_id!=='string'||data.project_id!==projectId)return null;
 if(!Number.isFinite(receivedAt))return null;
 const lanes=new Map(),duplicate=new Set();
 for(const track of Array.isArray(data.tracks)?data.tracks:[]){
  const laneId=Array.isArray(track)?id(track[1]):track&&typeof track==='object'?id(track.lane_id??track.laneId):null,peak=Array.isArray(track)?finitePeak(track[2]):track&&typeof track==='object'?finitePeak(track.peak??track.post_fader_peak):null;
  if(laneId===null||peak===null)continue;
  // Two different readings for one durable lane in a single frame are ambiguous.
  if(lanes.has(laneId)){duplicate.add(laneId);continue;}
  lanes.set(laneId,peak);
 }
 for(const laneId of duplicate)lanes.delete(laneId);
 const buses=new Map();
 if(data.buses&&typeof data.buses==='object'&&!Array.isArray(data.buses))for(const [busId,value]of Object.entries(data.buses)){const peak=finitePeak(value);if(id(busId)&&peak!==null)buses.set(busId,peak);}
 const master=finitePeak(data.master);
 const seq=Number.isInteger(data.seq)&&data.seq>0?data.seq:0;
 return Object.freeze({projectId,generation,receivedAt,seq,lanes,buses,master});
}

/** Holds the last accepted frame for one monitor peer generation.
 * `stats` mirrors Studio Pro's meter-feed counters so a live
 * session can tell "no frames arrive" apart from "frames rejected". Since the
 * 328 release the monitor subscribes once per peer on mozart-meters
 * (`mixer_meters_subscribe`, persistent:true; cloud-monitor.js); frames may
 * arrive on mozart-meters or mozart-control. */
export class MixerMeterFeed{
 constructor(){this.frame=null;this.lastSeq=0;this.generation=null;this.projectId=null;this.stats={received:0,accepted:0,rejectedShape:0,rejectedSeq:0,lastAt:null,lastSeq:null,lastLanes:0};}
 invalidate(){this.frame=null;this.lastSeq=0;this.generation=null;this.projectId=null;}
 accept(data,{projectId,generation=0,receivedAt=Date.now()}={}){
  this.stats.received++;const frame=normalizeMixerMeterFrame(data,{projectId,generation,receivedAt});if(!frame){this.stats.rejectedShape++;return null;}
  if(this.generation!==generation||this.projectId!==projectId){this.invalidate();this.generation=generation;this.projectId=projectId;}
  if(frame.seq>0){if(this.lastSeq>0&&frame.seq<=this.lastSeq&&this.lastSeq-frame.seq<1000){this.stats.rejectedSeq++;return null;}this.lastSeq=frame.seq;}
  this.frame=frame;this.stats.accepted++;this.stats.lastAt=receivedAt;this.stats.lastSeq=frame.seq;this.stats.lastLanes=frame.lanes.size;return frame;
 }
 /** The last frame, only while it still belongs to the current project and peer. */
 current({projectId,generation}={}){const frame=this.frame;return frame&&frame.projectId===projectId&&frame.generation===generation?frame:null;}
}

/** Read-only meter for one Mixer row; only persisted+verified rows (or the built-in master) of the current project with a fresh frame have a level. */
export function readMixerStripMeter(row,{projectId,frame,now=Date.now(),maxAgeMs=MIXER_METER_MAX_AGE_MS}={}){
 // The built-in master output is a fixed read-only identity; it may be observed before saved buses are read.
 const builtInMaster=row?.kind==='bus'&&row?.id==='master';
 if(!row||typeof row!=='object'||!id(row.id)||!builtInMaster&&(row.persisted!==true||row.verified!==true))return unknown('row-unverified');
 if(!frame||!id(projectId)||frame.projectId!==projectId)return unknown('no-current-frame');
 const age=now-frame.receivedAt;if(!Number.isFinite(age)||age<0||age>maxAgeMs)return unknown('stale-frame');
 let value=null,source=null;
 if(row.kind==='lane'){if(frame.lanes?.has(row.id)){value=frame.lanes.get(row.id);source='lane';}}
 else if(row.kind==='bus'){if(row.id==='master'&&frame.master!=null){value=frame.master;source='master';}else if(frame.buses?.has(row.id)){value=frame.buses.get(row.id);source='bus';}}
 if(finitePeak(value)===null)return unknown('not-in-frame');
 return Object.freeze({known:true,value,receivedAt:frame.receivedAt,source,reason:null});
}

/** Paint a meter fill. Unknown/stale meters fall to zero rather than freezing the last level.
 * A reading carrying ballistic `level`/`peak` (mixer-meter-ballistics.js) paints
 * that smoothed level plus FL's peak-hold line; a plain reading paints its value. */
export function paintMixerMeter(meter,fill,row,reading){
 const name=row?.name||row?.id||'Mixer',ballistic=Number.isFinite(reading?.level),shown=ballistic?Math.max(0,reading.level):reading?.known?reading.value:0;
 paintPeakHold(meter,ballistic&&Number.isFinite(reading.peak)?reading.peak:null);
 if(reading?.known){fill.dataset.meter=String(row.id);fill.style.visibility='';fill.style.height=ballistic&&!(shown>0)?'0%':`${Math.min(100,shown*100).toFixed(2)}%`;meter.dataset.readState='known';meter.setAttribute('aria-label',`${name} live peak ${reading.value.toFixed(3)}`);return;}
 delete fill.dataset.meter;fill.style.height=shown>0?`${Math.min(100,shown*100).toFixed(2)}%`:'0%';fill.style.visibility='';meter.dataset.readState='unknown';meter.setAttribute('aria-label',`${name} meter: no current live level`);
}
/** FL's peak-hold line; red once the held peak reaches 0 dBFS. Removed when there is no peak. */
function paintPeakHold(meter,peak){
 let line=meter.querySelector?.(':scope > .meter-peak')||null;
 if(!(peak>0)){line?.remove();return;}
 if(!line){line=meter.ownerDocument.createElement('div');line.className='meter-peak';line.setAttribute('aria-hidden','true');meter.append(line);}
 line.style.bottom=`${Math.min(100,peak*100).toFixed(2)}%`;line.classList.toggle('clip',peak>=1);
}
