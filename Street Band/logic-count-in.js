/** Logic control-bar Count-in over Freestyle Studio API startRecording.
 *
 * Every API take is armed with POST /projects/{id}/recording:start after the
 * live-ingest uplink is open and before take_start (startRecording sequence in
 * docs/studio-api-openapi.json). count_in_beats (0–8) is the Studio count-in: the
 * metronome clicks that many beats and the reply returns AT the recording boundary
 * with response.count_in {…, recording_start_position_seconds, transport_started};
 * seek_seconds parks the stopped transport first, start_transport rolls it on the
 * boundary and bpm (20–400) is the count-in tempo. 0 = armed at once.
 *
 * Logic’s Count-in is a bar count (None / 1 Bar / 2 Bars here): beats =
 * bars × beats-per-bar, clamped to Freestyle’s 8.
 *
 * History: prod answered 502 clean_media_activation_required until the
 * 2026-11 release (“recording works on prod”); RECORDING_API_BLOCKED is now false.
 * A runtime 502 with that code still disables Count-in and API takes for the
 * session; the Record button then falls back to browser capture + upload.
 */
const fail=(message,code='count_in_invalid',extra={})=>Object.assign(new Error(message),{code},extra);
export const RECORDING_API_UNAVAILABLE='Freestyle API recording is temporarily unavailable (clean_media_activation_required)';
/** Re-blocked at runtime when startRecording answers 502 clean_media_activation_required. */
export const RECORDING_API_BLOCKED=false;
export const COUNT_IN_OPERATION='startRecording';
export const COUNT_IN_BEATS_MAX=8;
export const COUNT_IN_BAR_CHOICES=Object.freeze([0,1,2]);
const beatsPerBar=signature=>{const top=Number(String(signature??'').split('/')[0]);return Number.isInteger(top)&&top>0?top:4;};
/** Logic’s count-in bars → count_in_beats: bars × beats-per-bar, clamped to 0–8. */
export function countInBeats(signature='4/4',bars=1){const count=Number.isInteger(bars)&&bars>0?bars:0;return Math.min(COUNT_IN_BEATS_MAX,count*beatsPerBar(signature));}
export function countInLabel(bars){return bars===0?'None':bars===1?'1 Bar':`${bars} Bars`;}
/** The documented startRecording body. beats 0 arms at once (no count-in fields). */
export function countInRecordingBody({laneId,beats=0,seekSeconds,bpm}){
 if(typeof laneId!=='string'||!laneId)throw fail('Record-enable an audio track first.');
 if(!Number.isInteger(beats)||beats<0||beats>COUNT_IN_BEATS_MAX)throw fail('Count-in must be 0–8 beats.');
 const body={lane_id:laneId,count_in_beats:beats};
 if(beats>0){
  body.start_transport=true;
  if(Number.isFinite(seekSeconds)&&seekSeconds>=0)body.seek_seconds=Math.round(seekSeconds*1e6)/1e6;
  if(Number.isFinite(bpm)&&bpm>=20&&bpm<=400)body.bpm=bpm;
 }
 return body;
}
const blockedError=error=>[error,error?.cause].some(item=>Number(item?.status)===502&&(item?.data?.error?.code==='clean_media_activation_required'||item?.code==='clean_media_activation_required'));
const finite=value=>typeof value==='number'&&Number.isFinite(value);

/** options: client() → StudioApiClient|null; scope() → {projectId}|null; log; storage. */
export class CountInController{
 constructor({client,scope,log=()=>{},blocked=RECORDING_API_BLOCKED,storage=null}={}){
  Object.assign(this,{client,scope,log,storage});this.blockedReason=blocked?RECORDING_API_UNAVAILABLE:null;
  let saved=null;try{saved=storage?.getItem?.('illogic.countIn');}catch{}
  // Legacy '1'/'0' (boolean toggle) maps to 1 bar / off.
  const bars=Number(saved);this.bars=COUNT_IN_BAR_CHOICES.includes(bars)?bars:0;
  let last=null;try{last=Number(storage?.getItem?.('illogic.countInBars.last'));}catch{}this.lastBars=COUNT_IN_BAR_CHOICES.includes(last)&&last>0?last:Math.max(1,this.bars);
 }
 get wanted(){return this.bars>0;}
 /** {enabled (the toggle can be used), on (count-in applies to the next take), bars, reason}. */
 state(){const studio=typeof this.client?.()?.call==='function';const reason=this.blockedReason||(studio?null:'Count-in needs a Studio API (OAuth) project.');return{enabled:!reason,on:!reason&&this.bars>0,bars:reason?0:this.bars,reason};}
 /** API takes (startRecording) are available: Studio project and not runtime-blocked. */
 apiAvailable(){return !this.blockedReason&&typeof this.client?.()?.call==='function';}
 save(){try{this.storage?.setItem?.('illogic.countIn',String(this.bars));if(this.bars>0)this.storage?.setItem?.('illogic.countInBars.last',String(this.bars));}catch{}}
 /** Control-bar button: on (last bar count, default 1 Bar) ⇄ off. */
 toggle(){const state=this.state();if(!state.enabled)throw fail(state.reason,'count_in_unavailable',{dispatched:false});this.bars=this.bars>0?0:this.lastBars;if(this.bars>0)this.lastBars=this.bars;this.save();return this.state();}
 /** None / 1 Bar / 2 Bars (the button’s menu). */
 setBars(bars){if(!COUNT_IN_BAR_CHOICES.includes(bars))throw fail('Count-in is None, 1 Bar or 2 Bars.');const state=this.state();if(!state.enabled)throw fail(state.reason,'count_in_unavailable',{dispatched:false});this.bars=bars;if(bars>0)this.lastBars=bars;this.save();return this.state();}
 beats(signature){return this.state().on?countInBeats(signature,this.bars):0;}
 /** Recorder `arm` hook: startRecording (count-in when on) and return at the boundary.
  * start(body) performs the call on the captured target (StudioLiveIngest.startRecording).
  * Returns {songStartSec, takeStart, transportStarted, countIn, beats} or {captureOnly}. */
 async arm({laneId,songStartSec,bpm,signature,start,onCountIn=()=>{}}={}){
  if(typeof start!=='function')throw fail('Recording start needs its captured Studio target.','count_in_scope',{dispatched:false});
  if(this.blockedReason)return{captureOnly:true,warning:`${this.blockedReason}. This take is captured by the browser and uploaded when stopped.`};
  const beats=this.beats(signature),body=countInRecordingBody({laneId,beats,seekSeconds:songStartSec,bpm});
  if(beats>0)try{onCountIn({phase:'start',beats,bpm:body.bpm??bpm,bars:this.bars});}catch{}
  let response;
  try{response=await start(body);}
  catch(error){
   if(blockedError(error)){this.blockedReason=RECORDING_API_UNAVAILABLE;this.log('count-in-blocked',{status:502});throw Object.assign(fail(RECORDING_API_UNAVAILABLE,'clean_media_activation_required'),{status:502,historyNotApplied:true,cause:error});}
   throw error;
  }finally{if(beats>0)try{onCountIn({phase:'end',beats});}catch{}}
  const countIn=response?.count_in??null,boundary=countIn?.recording_start_position_seconds;
  this.log('recording-armed',{beats,laneId});
  return{beats,countIn,songStartSec:finite(boundary)&&boundary>=0?boundary:songStartSec,takeStart:response?.audio?.take_start??null,transportStarted:beats>0&&countIn?.transport_started!==false,response};
 }
 /** Former direct count-in call (kept for callers): arms with the given beats. */
 async start({laneId,beats,seekSeconds,bpm}){
  const state=this.state();if(!state.on)throw fail(state.reason||'Count-in is off.','count_in_unavailable',{dispatched:false});
  const scope=this.scope?.();if(typeof scope?.projectId!=='string'||!scope.projectId)throw fail('Open a Freestyle project first.','count_in_scope',{dispatched:false});
  const body=countInRecordingBody({laneId,beats,seekSeconds,bpm});
  try{
   const result=await this.client().call(COUNT_IN_OPERATION,{path:{project_id:scope.projectId},body});
   const response=result?.data?.response??result?.data??{};this.log('count-in',{beats,laneId});
   return{countIn:response.count_in??response.countIn??null,response};
  }catch(error){
   if(blockedError(error)){this.blockedReason=RECORDING_API_UNAVAILABLE;this.log('count-in-blocked',{status:502});throw Object.assign(fail(RECORDING_API_UNAVAILABLE,'clean_media_activation_required'),{status:502,historyNotApplied:true});}
   throw error;
  }
 }
}

/** LCD count-in display: “COUNT-IN 4 … 1” over the Logic LCD while the engine clicks. */
export function countInLcd(doc=globalThis.document,{setInterval:every=(fn,ms)=>setInterval(fn,ms),clearInterval:clear=id=>clearInterval(id)}={}){
 let timer=null,node=null;
 const host=()=>doc?.getElementById?.('time-display');
 const end=()=>{if(timer!==null)clear(timer);timer=null;node?.remove?.();node=null;host()?.classList?.remove?.('logic-count-in-active');};
 return{
  show({beats,bpm}={}){
   end();const parent=host();if(!parent||!Number.isInteger(beats)||beats<1)return;
   node=doc.createElement('div');node.id='lcd-count-in';node.className='logic-lcd-count-in';node.setAttribute('role','status');node.setAttribute('aria-live','polite');
   node.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:.5em;background:rgba(20,24,28,.92);color:#ffcf4a;font:600 13px/1 system-ui;letter-spacing:.08em;pointer-events:none;z-index:2';
   if(!parent.style.position)parent.style.position='relative';parent.classList.add('logic-count-in-active');parent.appendChild(node);
   let left=beats;const paint=()=>{node.textContent=`COUNT-IN ${Math.max(1,left)}`;};paint();
   const beatMs=Number.isFinite(bpm)&&bpm>0?60000/bpm:500;timer=every(()=>{left--;if(left<1){clear(timer);timer=null;return;}paint();},beatMs);
  },
  end,
  handle(info={}){if(info.phase==='start')this.show(info);else end();},
 };
}
