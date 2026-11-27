/** Realtime one-shot sample audition (the Default studio's Pattern Builder step-tap).
 *
 * Switching a step cell ON (not while a pattern or the song is playing) sends ONE
 * `sample_preview` message on the open `mozart-control` data channel
 * (`{audio_file_id, bus_id, duration_sec, gain, playback_rate, [sampleRange]}`);
 * HTTP is only the cold/failure fallback. Project samples are warmed once with a
 * silent (`gain:0`) preview so the first tap is already registered; a
 * `sample_preview_result` with ok:false means that asset must use HTTP.
 */
import {freestyleHost} from './freestyle-host-transport.js';
import {clientLog} from './client-diagnostics.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const PREWARM_RETRY_MS=15000,PREWARM_MAX_SAMPLES=64;
export class CloudSampleAudition{
 constructor({engine}){this.engine=engine;this.warm=new Map();this.queue=Promise.resolve();this.timer=null;this.attached=false;this.log=[];}
 attach(){
  if(this.attached)return;this.attached=true;const monitor=this.engine.monitor;
  monitor.addEventListener('control',event=>{const data=event.detail;if(data?.type!=='sample_preview_result')return;const id=String(data.audio_file_id||data.audioFileId||'');if(!id)return;const entry=this.entry(id);entry.ready=!!data.ok;entry.engineFailed=!data.ok;});
  monitor.addEventListener('state',event=>{if(event.detail?.state==='connected')this.prewarmSoon(0);/* at once: the first pad tap may be waiting */});
  this.prewarmSoon();
 }
 key(){const e=this.engine;return `${e.projectId}:${e.session.liveClock?.payload?.session_epoch??''}`;}
 entry(audioFileId){const key=this.key();let entry=this.warm.get(audioFileId);if(!entry||entry.key!==key){entry={key,ready:false,engineFailed:false,failedAt:0,pending:false};this.warm.set(audioFileId,entry);}return entry;}
 /** The rack channel's stored sample, or null (instruments and unsaved sources have no engine copy). */
 source(channel){
  const raw=channel?.cloudRaw||{},audioFileId=raw.audioFileId||raw.audio_file_id;
  if(typeof audioFileId!=='string'||!audioFileId||audioFileId.length>64)return null;
  const busId=raw.busId||raw.bus_id||channel.busId||'master';
  return {audioFileId,busId:String(busId),sampleRange:raw.sampleRange||raw.sample_range||null,loop:(raw.samplePlaybackMode||raw.sample_playback_mode)==='loop'};
 }
 /** Open peer + control channel of THIS project, and the engine did not report this asset as broken. */
 realtimeReady(source){
  const e=this.engine,m=e.monitor;
  return !!(e.ready&&!e.loading&&e.projectId&&m.projectId===e.projectId&&m.peer?.connectionState==='connected'&&m.control?.readyState==='open'&&!this.entry(source.audioFileId).engineFailed);
 }
 /** True when the tap was handled on the data channel (or is waiting on a pause barrier);
  * false when the caller must use the ordinary REST audition. */
 play(channel,{velocity=.9}={}){
  const e=this.engine,source=this.source(channel);if(!source||!this.realtimeReady(source))return false;
  const projectId=e.projectId,started=performance.now();
  const send=()=>{
   if(e.projectId!==projectId||!this.realtimeReady(source))return false;
   const message={type:'sample_preview',audio_file_id:source.audioFileId,bus_id:source.busId,...source.sampleRange?{sampleRange:source.sampleRange}:{},duration_sec:0,gain:clamp((Number(velocity)||.9)*(Number.isFinite(Number(channel.volume))?Number(channel.volume):1)*.92,0,2),playback_rate:1};
   try{e.monitor.sendControl(message);}catch{return false;}
   this.log=[...this.log.slice(-49),{at:Date.now(),audioFileId:source.audioFileId,dispatchMs:Math.round(performance.now()-started)}];
   clientLog('sample-step-audition',{route:'realtime',dispatchMs:Math.round(performance.now()-started)});return true;
  };
  // Reopen the receive sink for this explicit audition (Default: onPrepareAudio + __fsResumeRickSink).
  let ready=true;try{ready=e.prepareAudition({current:()=>e.projectId===projectId});}catch{return false;}
  if(ready&&typeof ready.then==='function')return ready.then(opened=>opened===false?true:send()||e.preview(channel).then(()=>true),()=>false);
  if(ready===false)return true;
  return send();
 }
 /** Silent `gain:0` registration of every project sample, one request at a time. */
 prewarmSoon(delay=400){clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;this.prewarm();},delay);}
 prewarm(){
  const e=this.engine,m=e.monitor,host=freestyleHost();
  if(!host?.dawFetch||!e.ready||e.loading||!e.projectId||m.projectId!==e.projectId||m.suspended===true||m.peer?.connectionState!=='connected')return;
  const seen=new Set(),projectId=e.projectId;
  for(const channel of e.project?.channels||[]){
   const source=this.source(channel);if(!source||seen.has(source.audioFileId)||seen.size>=PREWARM_MAX_SAMPLES)continue;seen.add(source.audioFileId);
   const entry=this.entry(source.audioFileId);if(entry.ready||entry.pending||entry.engineFailed||Date.now()-entry.failedAt<PREWARM_RETRY_MS)continue;
   // Freestyle #9 (documented): a gain-0 sample_preview on mozart-control is the supported warm-up. It is silent,
   // loads a sample that was not loaded and answers sample_preview_result only then (handled in attach()).
   if(m.control?.readyState==='open'&&m.channelWritesAllowed?.()!==false){
    try{m.sendControl({type:'sample_preview',audio_file_id:source.audioFileId,bus_id:source.busId,gain:0,duration_sec:0,playback_rate:1});entry.ready=true;clientLog('sample-prewarm',{route:'realtime'});continue;}catch{/* REST below */}
   }
   entry.pending=true;
   this.queue=this.queue.then(async()=>{
    if(e.projectId!==projectId||this.warm.get(source.audioFileId)!==entry)return;
    try{
     const response=await host.dawFetch('/pattern-samples/preview',{method:'POST',body:JSON.stringify({project_id:projectId,audio_file_id:source.audioFileId,bus_id:source.busId,duration_sec:.001,gain:0,lead_sec:0})},{projectId,timeoutMs:15000});
     entry.ready=response.ok;if(!response.ok)entry.failedAt=Date.now();else{try{const data=await response.json();entry.ready=data?.ok!==false;}catch{}}
    }catch{entry.failedAt=Date.now();}
    finally{entry.pending=false;}
   });
  }
 }
}
