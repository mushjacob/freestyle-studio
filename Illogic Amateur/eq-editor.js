/** Channel EQ band editor for Freestyle's native EQ slot and the lane EQ stage.
 *
 * Typed contract (Studio API getLaneEq / setLaneEqBand, round 13): up to 8
 * bands (0-7) of {enabled, type (16 shapes), frequency_hz 20..20000,
 * gain_db -18..18, q 0.1..18}. A native EQ insert is addressed with
 * plugin_index plus expected_plugin_instance_id / expected_plugin_type (a moved
 * slot answers 409 plugin_instance_mismatch and nothing is written). Drag ticks
 * go out with persist:false (engine only); the release writes persist:true and
 * is confirmed by a getLaneEq readback. Out-of-range values are refused by the
 * server (never clamped), so the editor clamps before sending.
 *
 * Optimistic UI: the curve follows the pointer at once; a refused write rolls
 * back to the last confirmed band. Each committed band edit is one history
 * step whose undo/redo restores the exact typed band after checking that the
 * band still holds the value the step left.
 */
import {StudioApiClient} from './studio-api-client.js';

export const EQ_BAND_TYPES=Object.freeze(['bell','proportional_q','vintage_bell','band_shelf','low_shelf','resonant_low_shelf','vintage_low_shelf','high_shelf','resonant_high_shelf','vintage_high_shelf','low_pass','resonant_low_pass','high_pass','resonant_high_pass','baxandall_bass','baxandall_treble']);
export const EQ_LIMITS=Object.freeze({bands:8,frequency:[20,20000],gain:[-18,18],q:[.1,18]});
export const EQ_OPERATIONS=Object.freeze(['getLaneEq','setLaneEqBand']);
const LABELS={bell:'Peaking',proportional_q:'Peaking (prop. Q)',vintage_bell:'Vintage peaking',band_shelf:'Band shelf',low_shelf:'Low shelf',resonant_low_shelf:'Resonant low shelf',vintage_low_shelf:'Vintage low shelf',high_shelf:'High shelf',resonant_high_shelf:'Resonant high shelf',vintage_high_shelf:'Vintage high shelf',low_pass:'Low pass',resonant_low_pass:'Resonant low pass',high_pass:'High pass',resonant_high_pass:'Resonant high pass',baxandall_bass:'Baxandall bass',baxandall_treble:'Baxandall treble'};
export const eqTypeLabel=type=>LABELS[type]||type;
const clamp=(value,[min,max])=>Math.min(max,Math.max(min,Number(value)));
const round=(value,digits)=>{const scale=10**digits;return Math.round(Number(value)*scale)/scale;};
export const eqSupported=operations=>{const set=operations instanceof Set?operations:new Set(Array.isArray(operations)?operations:Object.keys(operations||{}));return EQ_OPERATIONS.every(name=>set.has(name));};

/** One typed band, validated against the published schema. */
export function normalizeEqBand(raw){
 if(!raw||typeof raw!=='object'||!Number.isInteger(raw.band)||raw.band<0||raw.band>7||typeof raw.enabled!=='boolean'||!EQ_BAND_TYPES.includes(raw.type))throw new Error('Freestyle returned an EQ band without its typed fields.');
 for(const key of ['frequency_hz','gain_db','q'])if(typeof raw[key]!=='number'||!Number.isFinite(raw[key]))throw new Error('Freestyle returned an EQ band without its typed fields.');
 return{band:raw.band,enabled:raw.enabled,type:raw.type,frequency_hz:raw.frequency_hz,gain_db:raw.gain_db,q:raw.q};
}
/** Equal within display precision (the engine stores floats). */
export function eqBandsEqual(a,b){
 if(!a||!b)return false;const near=(x,y,tolerance)=>Math.abs(Number(x)-Number(y))<=tolerance;
 return a.band===b.band&&a.enabled===b.enabled&&a.type===b.type&&near(a.frequency_hz,b.frequency_hz,Math.max(.01,Math.abs(b.frequency_hz)*1e-4))&&near(a.gain_db,b.gain_db,.005)&&near(a.q,b.q,.0005);
}
/** Clamp and round a requested band into the writable ranges. */
export function clampEqBand(band){
 return{band:band.band,enabled:!!band.enabled,type:EQ_BAND_TYPES.includes(band.type)?band.type:'bell',frequency_hz:round(clamp(band.frequency_hz,EQ_LIMITS.frequency),2),gain_db:round(clamp(band.gain_db,EQ_LIMITS.gain),2),q:round(clamp(band.q,EQ_LIMITS.q),3)};
}
/** The EQ this editor edits in a getLaneEq answer: the native insert with that instance, or the lane EQ stage. */
export function selectEqTarget(data,{instanceId=null}={}){
 if(!data||typeof data!=='object'||!Array.isArray(data.inserts)||!data.eq)throw new Error('Freestyle did not return this lane’s typed EQ.');
 if(instanceId){
  const matches=[...data.inserts,...(Array.isArray(data.racks)?data.racks:[])].filter(item=>item?.instanceId===instanceId);
  if(matches.length!==1)throw Object.assign(new Error('This EQ instance is no longer on the lane. Refresh its plugin chain.'),{code:'eq_instance_missing'});
  const insert=matches[0];return{kind:'insert',instanceId,pluginIndex:Number.isInteger(insert.pluginIndex)?insert.pluginIndex:null,typeId:typeof insert.typeId==='string'?insert.typeId:null,bands:insert.eq.bands.map(normalizeEqBand),live:data.live===true};
 }
 return{kind:'lane',instanceId:null,pluginIndex:null,typeId:null,bands:data.eq.bands.map(normalizeEqBand),live:data.live===true};
}
/** setLaneEqBand request (generated-client shape). */
export function eqBandRequest({projectId,laneId,trackId=null,target,band,persist=true}){
 const value=clampEqBand(band),body={enabled:value.enabled,type:value.type,frequency_hz:value.frequency_hz,gain_db:value.gain_db,q:value.q,persist};
 if(target?.kind==='insert'){
  if(!Number.isInteger(target.pluginIndex))throw new Error('This EQ is not loaded in the live engine, so its bands cannot be written.');
  Object.assign(body,{plugin_index:target.pluginIndex,expected_plugin_instance_id:target.instanceId,...(target.typeId?{expected_plugin_type:target.typeId}:{})});
 }
 if(trackId)body.track_id=trackId;
 return{operationId:'setLaneEqBand',path:{project_id:projectId,lane_id:laneId,band:String(value.band)},body};
}

// ---- Display curve (RBJ biquads at 48 kHz; display only, never sent) ----
const SAMPLE_RATE=48000;
function coefficients(band){
 const f=Math.min(band.frequency_hz,SAMPLE_RATE*.49),w0=2*Math.PI*f/SAMPLE_RATE,cos=Math.cos(w0),sin=Math.sin(w0),A=10**(band.gain_db/40);
 const shape=band.type,q=shape.startsWith('baxandall')?.5:shape.startsWith('vintage')||shape==='low_shelf'||shape==='high_shelf'?Math.min(band.q,1.2):band.q,alpha=sin/(2*Math.max(.1,q));
 if(/low_pass/.test(shape))return[(1-cos)/2,1-cos,(1-cos)/2,1+alpha,-2*cos,1-alpha];
 if(/high_pass/.test(shape))return[(1+cos)/2,-(1+cos),(1+cos)/2,1+alpha,-2*cos,1-alpha];
 if(/low_shelf|baxandall_bass/.test(shape)){const s=2*Math.sqrt(A)*alpha;return[A*((A+1)-(A-1)*cos+s),2*A*((A-1)-(A+1)*cos),A*((A+1)-(A-1)*cos-s),(A+1)+(A-1)*cos+s,-2*((A-1)+(A+1)*cos),(A+1)+(A-1)*cos-s];}
 if(/high_shelf|baxandall_treble/.test(shape)){const s=2*Math.sqrt(A)*alpha;return[A*((A+1)+(A-1)*cos+s),-2*A*((A-1)+(A+1)*cos),A*((A+1)+(A-1)*cos-s),(A+1)-(A-1)*cos+s,2*((A-1)-(A+1)*cos),(A+1)-(A-1)*cos-s];}
 return[1+alpha*A,-2*cos,1-alpha*A,1+alpha/A,-2*cos,1-alpha/A];
}
/** Response (dB) of one band at frequency f. */
export function eqBandResponse(band,frequency){
 if(!band?.enabled)return 0;const [b0,b1,b2,a0,a1,a2]=coefficients(band),w=2*Math.PI*frequency/SAMPLE_RATE,c1=Math.cos(w),s1=Math.sin(w),c2=Math.cos(2*w),s2=Math.sin(2*w);
 const nr=b0+b1*c1+b2*c2,ni=-(b1*s1+b2*s2),dr=a0+a1*c1+a2*c2,di=-(a1*s1+a2*s2),magnitude=Math.sqrt((nr*nr+ni*ni)/(dr*dr+di*di));
 return 20*Math.log10(Math.max(1e-9,magnitude));
}
export const eqResponse=(bands,frequency)=>bands.reduce((sum,band)=>sum+eqBandResponse(band,frequency),0);
/** Plot geometry: log frequency 20 Hz..20 kHz → 0..width; ±18 dB → height..0. */
export function eqGeometry(width,height){
 const span=Math.log10(20000/20),range=EQ_LIMITS.gain[1];
 return{x:f=>Math.log10(clamp(f,EQ_LIMITS.frequency)/20)/span*width,y:db=>height/2-Math.max(-range*1.5,Math.min(range*1.5,db))/range*(height/2),frequency:x=>20*10**(Math.max(0,Math.min(width,x))/width*span),gain:y=>(height/2-y)/(height/2)*range};
}
export function eqCurvePath(bands,width,height,steps=160){
 const geometry=eqGeometry(width,height);let path='';
 for(let i=0;i<=steps;i++){const x=i/steps*width,f=geometry.frequency(x);path+=(i?'L':'M')+x.toFixed(1)+' '+geometry.y(eqResponse(bands,f)).toFixed(1);}
 return path;
}

/**
 * Band state + writes. `send(request)` performs one generated-client request
 * and resolves to the JSON body (errors carry status/code). `onCommit` receives
 * {band, before, after} once per confirmed persisted edit (one history step).
 */
export class LaneEqController extends EventTarget{
 constructor({send,projectId,laneId,trackId=null,instanceId=null,onCommit=null,onBegin=null,onFail=null,tickMs=60,now=()=>Date.now(),setTimer=(callback,ms)=>setTimeout(callback,ms),clearTimer=id=>clearTimeout(id),log=()=>{}}={}){
  super();if(typeof send!=='function'||!projectId||!laneId)throw new Error('Open a loaded lane EQ before editing its bands.');
  Object.assign(this,{send,projectId,laneId,trackId,instanceId,onCommit,onBegin,onFail,tickMs,now,setTimer,clearTimer,log});
  this.target=null;this.bands=[];this.confirmed=[];this.chain=Promise.resolve();this.drag=null;this.error=null;
 }
 emit(){this.dispatchEvent(new Event('change'));}
 band(index){return this.bands.find(item=>item.band===index)||null;}
 async read(){
  const data=await this.send({operationId:'getLaneEq',path:{project_id:this.projectId,lane_id:this.laneId},...(this.trackId?{query:{track_id:this.trackId}}:{})});
  if(data?.projectId!==this.projectId||data?.laneId!==this.laneId)throw new Error('Freestyle returned another lane’s EQ.');
  return selectEqTarget(data,{instanceId:this.instanceId});
 }
 async load(){const target=await this.read();this.target=target;this.bands=target.bands.map(band=>({...band}));this.confirmed=target.bands.map(band=>({...band}));this.error=null;this.emit();return this.bands;}
 // Writes run in order. A drag tick (persist:false) still queued when a persisted write is
 // queued behind it is skipped: the release value supersedes it, so the confirmed write and
 // its history step do not wait for stale ticks (~0.5-1 s each through the proxy).
 write(band,persist){
  const request=eqBandRequest({projectId:this.projectId,laneId:this.laneId,trackId:this.trackId,target:this.target,band,persist});
  if(persist)this.persistQueued=(this.persistQueued||0)+1;
  const task=this.chain.then(()=>{if(!persist&&this.persistQueued){this.log('eq-band-tick',{band:band.band,outcome:'superseded'});return null;}return this.send(request);}).finally(()=>{if(persist)this.persistQueued--;});
  this.chain=task.catch(()=>{});return task;
 }
 /** Optimistic local change; persist:false engine tick (throttled, latest wins). */
 preview(index,patch){
  const current=this.band(index);if(!current)throw new Error('Choose one of the returned EQ bands.');
  const next=clampEqBand({...current,...patch,band:index});Object.assign(current,next);this.emit();
  const drag=this.drag?.band===index?this.drag:(this.drag={band:index,before:{...this.confirmedBand(index)},timer:null,lastAt:-Infinity,pending:false});
  drag.pending=true;if(drag.timer!==null)return next;
  const wait=Math.max(0,drag.lastAt+this.tickMs-this.now());
  drag.timer=this.setTimer(()=>{drag.timer=null;if(!drag.pending||this.drag!==drag)return;drag.pending=false;drag.lastAt=this.now();this.write(this.band(index),false).catch(error=>this.log('eq-band-tick',{band:index,outcome:'error',code:error?.code??null}));},wait);
  return next;
 }
 confirmedBand(index){return this.confirmed.find(item=>item.band===index)||null;}
 /** Persist the band (release / field edit): write, read back, then one history step. */
 async commit(index,patch={},{history=true}={}){
  const drag=this.drag?.band===index?this.drag:null;if(drag){if(drag.timer!==null)this.clearTimer(drag.timer);this.drag=null;}
  const current=this.band(index);if(!current)throw new Error('Choose one of the returned EQ bands.');
  const before={...(drag?.before||this.confirmedBand(index))},after=clampEqBand({...current,...patch,band:index});Object.assign(current,after);this.emit();
  if(eqBandsEqual(before,after))return{changed:false,band:after};
  // The history step opens at release (optimistic), before the write: a ⌘Z
  // pressed meanwhile waits for this edit instead of missing it.
  let token=null;if(history)try{token=this.onBegin?.({band:index,before,after})??null;}catch{token=null;}
  try{const reply=await this.write(after,true);const confirmed=this.confirmFromReply(reply,after)??await this.verify(after);
   if(history)try{this.onCommit?.({band:index,before,after:confirmed,token});}catch{}
   return{changed:true,band:confirmed,before};}
  catch(error){this.rollback(index,before);this.error=error;this.emit();if(history)try{this.onFail?.({band:index,token,error});}catch{}throw error;}
 }
 async verify(expected){
  const target=await this.read(),observed=target.bands.find(item=>item.band===expected.band);
  this.target=target;const index=this.confirmed.findIndex(item=>item.band===expected.band);if(observed){if(index>=0)this.confirmed[index]={...observed};}
  if(!eqBandsEqual(observed,expected))throw Object.assign(new Error(`Freestyle reports EQ band ${expected.band+1} as ${describeEqBand(observed)}, not ${describeEqBand(expected)}.`),{code:'eq_readback_mismatch',observed});
  const local=this.band(expected.band);if(local&&!this.drag)Object.assign(local,observed);this.emit();return{...observed};
 }
 /** Adopt a band confirmed elsewhere (history undo/redo, another writer) and repaint now. */
 adopt(band){if(!band||this.drag?.band===band.band)return;const local=this.band(band.band),index=this.confirmed.findIndex(item=>item.band===band.band);if(local)Object.assign(local,band);if(index>=0)this.confirmed[index]={...band};this.emit();}
 rollback(index,band){const local=this.band(index);if(local&&band)Object.assign(local,band);this.emit();}
 /** QA round 23 speed: setLaneEqBand on the lane EQ STAGE answers with the engine's
  * band list (response.eq.bands: index, enabled, freq, gain, q, shapeNorm = type
  * index / 15; verified live). When the written band is exactly in that reply it is
  * confirmed without a getLaneEq readback. Inserts (plugin_index) keep the read. */
 confirmFromReply(reply,expected){
  if(this.target?.kind!=='lane'){this.log('history-receipt-confirm-declined',{kind:'eq_band',stage:'insert'});return null;}
  const observed=eqBandFromReply(reply,expected.band);
  if(!observed||!eqBandsEqual(observed,expected)){this.log('history-receipt-confirm-declined',{kind:'eq_band',stage:'reply',reason:observed?'mismatch':'no_bands'});return null;}
  const index=this.confirmed.findIndex(item=>item.band===expected.band);if(index>=0)this.confirmed[index]={...observed};
  const local=this.band(expected.band);if(local&&!this.drag)Object.assign(local,observed);this.emit();this.log('eq-confirmed-from-reply',{band:expected.band});return{...observed};
 }
 /** History undo/redo: band must still hold `from`; writes `to` exactly and verifies it.
  * `known`: the band as an open view last confirmed it (no pre-read needed). */
 async applyExact(from,to,{known=null,target=null}={}){
  let observed;
  if(known&&target&&eqBandsEqual(known,from)){this.target=target;observed={...known};}
  else{const read=await this.read();this.target=read;observed=read.bands.find(item=>item.band===from.band);}
  if(!eqBandsEqual(observed,from))throw Object.assign(new Error(`EQ band ${from.band+1} is now ${describeEqBand(observed)}: it changed elsewhere, so this step was not applied.`),{dispatched:false});
  const local=this.band(to.band);if(local)Object.assign(local,to);this.emit();
  try{const reply=await this.write(to,true);return this.confirmFromReply(reply,clampEqBand(to))??await this.verify(to);}catch(error){this.rollback(to.band,observed);throw error;}
 }
}
/** The engine's band from a setLaneEqBand reply (typed or engine units), or null. */
export function eqBandFromReply(reply,band){
 const layers=[reply,reply?.response,reply?.structuredContent,reply?.structuredContent?.response,reply?.data];
 for(const layer of layers){const bands=layer?.eq?.bands;if(!Array.isArray(bands))continue;const raw=bands.find(item=>(item?.band??item?.index)===band);if(!raw)return null;
  const type=typeof raw.type==='string'?raw.type:Number.isFinite(raw.shapeNorm)?EQ_BAND_TYPES[Math.round(raw.shapeNorm*(EQ_BAND_TYPES.length-1))]:null,frequency=raw.frequency_hz??raw.freq,gain=raw.gain_db??raw.gain;
  if(typeof raw.enabled!=='boolean'||!EQ_BAND_TYPES.includes(type)||![frequency,gain,raw.q].every(Number.isFinite))return null;
  return{band,enabled:raw.enabled,type,frequency_hz:frequency,gain_db:gain,q:raw.q};}
 return null;
}
export function describeEqBand(band){if(!band)return'missing';return`${band.enabled?'on':'off'} ${eqTypeLabel(band.type)} ${Math.round(band.frequency_hz)} Hz ${band.gain_db>0?'+':''}${round(band.gain_db,1)} dB Q ${round(band.q,2)}`;}

/** Response JSON from the generated client (data) for LaneEqController.send. */
export function studioEqSender(fetchImpl){
 const client=new StudioApiClient({fetch:(...args)=>fetchImpl(...args)});
 return async request=>(await client.call(request.operationId,{path:request.path,...(request.query?{query:request.query}:{}),...(request.body?{body:request.body}:{})})).data;
}

// ---- Channel EQ view ----
// Eight band slots laid out as a channel EQ: high-pass, low shelf, four bells, high shelf, low-pass.
// Freestyle stores every untouched band as off/bell/1 kHz/0 dB/Q 1, so such a band is DRAWN with
// its slot's shape, frequency and Q (dimmed) and takes them when it is first switched on or edited.
export const EQ_SLOTS=Object.freeze([
 {type:'high_pass',frequency:20,q:.71,color:'#4f6277'},
 {type:'low_shelf',frequency:75,q:1,color:'#d07a22'},
 {type:'bell',frequency:100,q:.6,color:'#b9c228'},
 {type:'bell',frequency:250,q:.3,color:'#4fd248'},
 {type:'bell',frequency:1040,q:.41,color:'#2dd291'},
 {type:'bell',frequency:2500,q:.2,color:'#5ea8d4'},
 {type:'high_shelf',frequency:7500,q:1,color:'#a67dd4'},
 {type:'low_pass',frequency:20000,q:.71,color:'#4f6277'}]);
const PASS_ON_COLOR='#9db4cc',OFF_COLOR='#44576c';
export const EQ_DEFAULT_SPREAD=Object.freeze(EQ_SLOTS.map(slot=>slot.frequency));
export const eqBandPristine=band=>!!band&&!band.enabled&&band.type==='bell'&&band.frequency_hz===1000&&band.gain_db===0&&band.q===1;
export const eqDisplayFrequency=band=>eqBandPristine(band)?EQ_DEFAULT_SPREAD[band.band%8]:band.frequency_hz;
/** The band as it is drawn: an untouched band shows its slot's shape. */
export const eqDisplayBand=band=>{if(!eqBandPristine(band))return band;const slot=EQ_SLOTS[band.band%8];return{...band,type:slot.type,frequency_hz:slot.frequency,q:slot.q};};
/** What an untouched band takes on its first edit. */
const adoptSlot=band=>{if(!eqBandPristine(band))return{};const slot=EQ_SLOTS[band.band%8];return{type:slot.type,frequency_hz:slot.frequency,q:slot.q};};
const nextType=type=>EQ_BAND_TYPES[(EQ_BAND_TYPES.indexOf(type)+1)%EQ_BAND_TYPES.length];
const family=type=>/high_pass/.test(type)?'hp':/low_pass/.test(type)?'lp':/low_shelf|baxandall_bass/.test(type)?'ls':/high_shelf|baxandall_treble/.test(type)?'hs':'bell';
const ICONS={
 hp:'M4 16 12.2 5.4Q13.3 4 15 4H24',
 lp:'M4 4H13Q14.7 4 15.8 5.4L24 16',
 ls:'M2 4H9.5Q11 4 12 5.3L15.6 10H26M2 16H9.5Q11 16 12 14.7L15.6 10',
 hs:'M26 4H18.5Q17 4 16 5.3L12.4 10H2M26 16H18.5Q17 16 16 14.7L12.4 10',
 bell:'M0 10H6.5Q8.6 10 10 8L12.3 4.7Q14 2.4 15.7 4.7L18 8Q19.4 10 21.5 10H28M6.5 10Q8.6 10 10 12L12.3 15.3Q14 17.6 15.7 15.3L18 12Q19.4 10 21.5 10'};
// Geometry of the graph (CSS px at View 100%), measured from the reference plug-in window.
export const EQ_VIEW=Object.freeze({width:1025,height:406,x0:37.3,x1:937.7,yZero:166.6,pxPerDb:8.16,top:30,bottom:296});
const FREQUENCY_LABELS=[[20,'20'],[30,'30'],[40,'40'],[50,'50'],[60,'60'],[80,'80'],[100,'100'],[200,'200'],[300,'300'],[400,'400'],[500,'500'],[800,'800'],[1000,'1k'],[2000,'2k'],[3000,'3k'],[4000,'4k'],[6000,'6k'],[8000,'8k'],[10000,'10k'],[20000,'20k']];
const FREQUENCY_LINES=[20,30,40,50,60,70,80,90,100,200,300,400,500,600,700,800,900,1000,2000,3000,4000,5000,6000,7000,8000,9000,10000,20000];
const SPAN=Math.log10(1000);
const plot={
 x:f=>EQ_VIEW.x0+Math.log10(clamp(f,EQ_LIMITS.frequency)/20)/SPAN*(EQ_VIEW.x1-EQ_VIEW.x0),
 y:db=>EQ_VIEW.yZero-db*EQ_VIEW.pxPerDb,
 frequency:x=>20*10**(Math.max(0,Math.min(1,(x-EQ_VIEW.x0)/(EQ_VIEW.x1-EQ_VIEW.x0)))*SPAN),
 gain:y=>(EQ_VIEW.yZero-y)/EQ_VIEW.pxPerDb};
const clipY=y=>Math.max(EQ_VIEW.top-8,Math.min(EQ_VIEW.bottom+8,y));
function responsePath(bands,{steps=180,closed=false}={}){
 let path='';
 for(let i=0;i<=steps;i++){const x=EQ_VIEW.x0+i/steps*(EQ_VIEW.x1-EQ_VIEW.x0);path+=(i?'L':'M')+x.toFixed(1)+' '+clipY(plot.y(eqResponse(bands,plot.frequency(x)))).toFixed(1);}
 return closed?`${path}L${EQ_VIEW.x1} ${EQ_VIEW.yZero}L${EQ_VIEW.x0} ${EQ_VIEW.yZero}Z`:path;
}
const formatFrequency=value=>value<100?value.toFixed(1):String(Math.round(value));
const formatGain=value=>{const rounded=round(value,1);return(rounded>0?'+':'')+rounded.toFixed(1);};
const formatQ=value=>round(value,2).toFixed(2);
export const EQ_UNSUPPORTED=Object.freeze({
 preset:'Presets: Freestyle has no preset list for the EQ, so only the current setting is shown.',
 power:'On/off: the track’s EQ stage has no bypass in Freestyle. Switch bands off with the band buttons above the graph.',
 analyzer:'Analyzer: audio is rendered in the Freestyle cloud and no spectrum data is sent to this window.',
 hq:'HQ: the Freestyle EQ has no oversampling option.',
 processing:'Processing: the Freestyle EQ always processes the whole stereo signal.',
 master:'Gain: the Freestyle EQ has no output gain. Use the channel fader.',
 slope:'Slope: Freestyle’s pass filters have a fixed slope (the curve shows 12 dB/Oct).',
 extended:'There are no extended parameters for this EQ.'});
export const EQ_VIEW_SIZES=Object.freeze([.75,1,1.25,1.5]);
/** Channel EQ view: band buttons above the graph, coloured handles with filled band curves and the summed
 * curve, and a frequency / gain / Q readout per band.
 * Handle: drag = frequency and gain, Alt-drag or wheel = Q, double-click = switch on (or reset gain to 0 dB),
 * right-click = next filter shape. Number fields: drag vertically (Shift = fine), click to type, double-click to reset.
 * options.bypass: {state()→{known,bypassed,busy}, toggle()→Promise} backs the power button (an EQ insert);
 * options.onExtended: the footer chevron (the plug-in window's Controls view). */
export class EqEditorView{
 constructor({controller,onError=()=>{},document:doc=globalThis.document,bypass=null,onExtended=null,name='Channel EQ'}={}){
  Object.assign(this,{controller,onError,document:doc,bypass,onExtended,name,width:EQ_VIEW.width,height:EQ_VIEW.height});
  this.selected=0;this.active=false;this.view=1;this.couple=true;
 }
 mount(container){
  const doc=container.ownerDocument||this.document,ns='http://www.w3.org/2000/svg',W=EQ_VIEW.width,H=EQ_VIEW.height;this.container=container;
  const win=doc.defaultView||globalThis;this.win=win;
  container.innerHTML=`<div class="eq-editor ceq"><div class="ceq-header"><button type="button" class="ceq-power" aria-label="${this.name} on/off"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.200V11.600M7.6 6.900A7 7 0 1 0 16.4 6.9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></button><span class="ceq-popup ceq-preset" title="${EQ_UNSUPPORTED.preset}"><select class="eq-preset" aria-label="Preset" disabled><option>Default Preset</option></select></span><span class="ceq-header-spacer"></span><label class="ceq-view-label">View:<span class="ceq-popup ceq-popup-stepper"><select class="eq-view" aria-label="View size" title="Window size">${EQ_VIEW_SIZES.map(size=>`<option value="${size}"${size===1?' selected':''}>${Math.round(size*100)}%</option>`).join('')}</select></span></label></div><div class="ceq-graph"><svg class="eq-plot" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="EQ curve"></svg><div class="ceq-icons" role="group" aria-label="Bands on/off"></div><div class="ceq-readouts"></div><div class="ceq-bottom"><button type="button" class="ceq-toggle ceq-analyzer" aria-pressed="false" aria-disabled="true" title="${EQ_UNSUPPORTED.analyzer}">Analyzer<sup>POST</sup></button><button type="button" class="ceq-toggle ceq-couple" aria-pressed="true" title="Gain-Q Couple: while you drag a bell band’s handle, raising or cutting its gain also narrows or widens its Q. The coupled Q is written to Freestyle like any Q edit.">Q-Couple</button><button type="button" class="ceq-toggle ceq-hq" aria-pressed="false" aria-disabled="true" title="${EQ_UNSUPPORTED.hq}">HQ</button><label class="ceq-processing" title="${EQ_UNSUPPORTED.processing}">Processing:<span class="ceq-popup ceq-popup-stepper"><select aria-label="Processing" disabled><option>Stereo</option></select></span></label><p class="eq-status" role="status" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></p><span class="ceq-shape"><label>Band <select class="eq-band" aria-label="EQ band"></select></label><span class="ceq-popup ceq-popup-stepper"><select class="eq-type" aria-label="Band shape" title="Filter shape of the selected band (right-click a handle for the next shape)"></select></span></span></div></div><div class="ceq-footer"><button type="button" class="ceq-disclosure" aria-label="Controls view"><svg viewBox="0 0 10 14" aria-hidden="true"><path d="M2.5 1.5 8 7 2.5 12.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button><span class="ceq-name"></span></div></div>`;
  const $=selector=>container.querySelector(selector);this.root=$('.eq-editor');this.svg=$('.eq-plot');this.status=$('.eq-status');$('.ceq-name').textContent=this.name;
  const el=(name,attrs={},text)=>{const node=doc.createElementNS(ns,name);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));if(text!=null)node.textContent=text;return node;};
  // --- header ---
  this.power=$('.ceq-power');this.power.onclick=()=>{if(this.power.disabled||!this.bypass?.toggle)return;this.power.disabled=true;Promise.resolve().then(()=>this.bypass.toggle()).catch(error=>this.onError(error)).finally(()=>this.paintPower());};
  $('.eq-view').onchange=()=>this.setView(Number($('.eq-view').value));
  const disclosure=$('.ceq-disclosure');if(typeof this.onExtended==='function'){disclosure.title='Controls view (the plug-in’s parameter list)';disclosure.onclick=()=>this.safe(()=>this.onExtended());}else{disclosure.disabled=true;disclosure.title=EQ_UNSUPPORTED.extended;}
  const couple=$('.ceq-couple');couple.onclick=()=>{this.couple=!this.couple;couple.setAttribute('aria-pressed',String(this.couple));};
  // --- selected-band shape ---
  $('.eq-type').innerHTML=EQ_BAND_TYPES.map(type=>`<option value="${type}">${eqTypeLabel(type)}</option>`).join('');
  $('.eq-band').innerHTML=this.controller.bands.map(band=>`<option value="${band.band}">${band.band+1}</option>`).join('');
  $('.eq-band').onchange=()=>{this.select(Number($('.eq-band').value));this.render();};
  $('.eq-type').onchange=()=>{const band=this.controller.band(this.selected);if(band)this.commit({...adoptSlot(band),type:$('.eq-type').value});};
  // --- graph: backdrop, grid, scales ---
  const defs=el('defs'),id='ceq'+Math.random().toString(36).slice(2,8);
  const glow=el('radialGradient',{id:id+'g',cx:'50%',cy:'42%',r:'62%'});for(const [offset,color]of [[0,'#1c3048'],[.45,'#192c41'],[.75,'#132132'],[.92,'#0c151f'],[1,'#080e16']])glow.append(el('stop',{offset,'stop-color':color}));
  const fade=el('linearGradient',{id:id+'f',x1:0,y1:0,x2:0,y2:1});for(const [offset,opacity]of [[0,0],[.68,0],[.8,.82],[.9,1],[1,1]])fade.append(el('stop',{offset,'stop-color':'#06101b','stop-opacity':opacity}));
  const dots=el('pattern',{id:id+'d',width:3,height:3,patternUnits:'userSpaceOnUse'});dots.append(el('rect',{x:0,y:0,width:1,height:1,fill:'#0a121c','fill-opacity':.5}));
  const clip=el('clipPath',{id:id+'c'});clip.append(el('rect',{x:EQ_VIEW.x0,y:EQ_VIEW.top-6,width:EQ_VIEW.x1-EQ_VIEW.x0,height:EQ_VIEW.bottom-EQ_VIEW.top+12}));
  defs.append(glow,fade,dots,clip);
  const backdrop=el('g',{class:'eq-backdrop','pointer-events':'none'});backdrop.append(el('rect',{width:W,height:H,fill:`url(#${id}g)`}),el('rect',{x:EQ_VIEW.x0,y:44,width:EQ_VIEW.x1-EQ_VIEW.x0,height:246,fill:`url(#${id}d)`}),el('rect',{width:W,height:H,fill:`url(#${id}f)`}));
  const grid=el('g',{class:'eq-grid','pointer-events':'none'});
  for(const f of FREQUENCY_LINES){const x=plot.x(f).toFixed(1),major=f===100||f===1000||f===10000;grid.append(el('path',{class:major?'eq-grid-major':'eq-grid-minor',d:`M${x} 40V292`}));}
  for(const db of [15,10,5,-5,-10,-15]){const y=plot.y(db).toFixed(1);grid.append(el('path',{class:db%10?'eq-grid-minor':'eq-grid-major',d:`M${EQ_VIEW.x0} ${y}H${EQ_VIEW.x1}`}));}
  grid.append(el('path',{class:'eq-zero',d:`M${EQ_VIEW.x0} ${EQ_VIEW.yZero}H${EQ_VIEW.x1}`}));
  for(const [f,label]of FREQUENCY_LABELS){const x=plot.x(f);grid.append(el('text',{class:'eq-axis',x:f===20?x+5:f===20000?x+1:x,y:EQ_VIEW.yZero+15,'text-anchor':f===20000?'end':'middle'},label));}
  // Left: the analyzer's level scale (0..60); right: band gain in dB.
  for(let level=0;level<=60;level+=5)grid.append(el('text',{class:'eq-scale eq-scale-left',x:23,y:plot.y(15-level/2)+4,'text-anchor':'end'},String(level)));
  for(const db of [15,10,5,0,-5,-10,-15])grid.append(el('text',{class:'eq-scale eq-scale-right',x:965,y:plot.y(db)+4,'text-anchor':'end'},String(Math.abs(db))));
  for(const x of [19,960])grid.append(el('path',{class:'eq-sign',d:`M${x-4} 24.500H${x+4}M${x} 20.500V28.5`}),el('path',{class:'eq-sign',d:`M${x-3} 299.500H${x+3}`}));
  // Master gain (no engine parameter behind it: drawn disabled).
  const master=el('g',{class:'eq-master','aria-disabled':'true'});master.append(el('title',{},EQ_UNSUPPORTED.master),el('rect',{x:972,y:36,width:44,height:330,fill:'transparent'}),el('path',{class:'eq-master-track',d:`M992 ${plot.y(15)}V${plot.y(-15)}`}));
  for(const db of [15,0,-15]){const y=plot.y(db).toFixed(1);master.append(el('path',{class:'eq-master-tick',d:`M977 ${y}h4M1003 ${y}h4`}));}
  master.append(el('circle',{class:'eq-master-thumb',cx:992,cy:EQ_VIEW.yZero,r:8}),el('path',{class:'eq-master-mark',d:`M992 ${EQ_VIEW.yZero-3}v6`}),el('text',{class:'eq-master-label',x:992,y:316,'text-anchor':'middle'},'Gain'),(()=>{const value=el('text',{class:'eq-master-value',x:992,y:340,'text-anchor':'middle'},'0.0');value.append(el('tspan',{dx:3},'dB'));return value;})());
  this.bandCurves=this.controller.bands.map(band=>el('path',{class:'eq-band-curve','clip-path':`url(#${id}c)`,'pointer-events':'none',fill:EQ_SLOTS[band.band%8].color,'fill-opacity':.2,stroke:EQ_SLOTS[band.band%8].color,'stroke-width':1}));
  this.curve=el('path',{class:'eq-sum-curve','clip-path':`url(#${id}c)`,'pointer-events':'none',fill:'none'});
  this.svg.append(defs,backdrop,grid,master,...this.bandCurves,this.curve);this.nodes=[];
  // --- per band: icon, handle, readout ---
  const icons=$('.ceq-icons'),readouts=$('.ceq-readouts');this.columns=[];
  for(const band of this.controller.bands){
   const index=band.band,slot=EQ_SLOTS[index%8];
   const node=el('g',{'data-eq-band':index,class:'eq-handle',tabindex:-1}),halo=el('circle',{class:'eq-handle-halo',r:13,fill:slot.color}),circle=el('circle',{class:'eq-handle-dot',r:6.5,fill:slot.color});node.append(halo,circle);this.svg.append(node);this.nodes.push({index,node,circle});this.attachNode(node,index);
   const icon=doc.createElement('label');icon.className='ceq-icon';icon.dataset.band=String(index);icon.style.left=`${(73.5+118*(index%8))/W*100}%`;
   icon.innerHTML=`<input type="checkbox" class="eq-enabled" aria-label="Band ${index+1} on"><svg viewBox="0 0 28 20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
   const check=icon.querySelector('input');check.onchange=()=>{this.select(index);const current=this.controller.band(index);this.commit({...adoptSlot(current),enabled:check.checked});};
   icon.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();this.cycleType(index);});icons.append(icon);
   const column=doc.createElement('div');column.className='ceq-column';column.dataset.band=String(index);column.style.left=`${(73.5+118*(index%8))/W*100}%`;
   column.innerHTML='<span class="ceq-field"><input class="eq-frequency" type="text" inputmode="decimal" spellcheck="false" autocomplete="off"><i>Hz</i></span><span class="ceq-field ceq-field-gain"><input class="eq-gain" type="text" inputmode="decimal" spellcheck="false" autocomplete="off"><i>dB</i></span><span class="ceq-field ceq-field-slope" hidden><b>12</b><i>dB/Oct</i></span><span class="ceq-field"><input class="eq-q" type="text" inputmode="decimal" spellcheck="false" autocomplete="off"></span>';
   const fields={frequency:column.querySelector('.eq-frequency'),gain:column.querySelector('.eq-gain'),q:column.querySelector('.eq-q')};
   fields.frequency.setAttribute('aria-label',`Band ${index+1} frequency (Hz)`);fields.gain.setAttribute('aria-label',`Band ${index+1} gain (dB)`);fields.q.setAttribute('aria-label',`Band ${index+1} Q`);column.querySelector('.ceq-field-slope').title=EQ_UNSUPPORTED.slope;
   this.attachField(fields.frequency,index,'frequency_hz');this.attachField(fields.gain,index,'gain_db');this.attachField(fields.q,index,'q');
   readouts.append(column);this.columns.push({index,icon,check,path:icon.querySelector('path'),column,fields,gainRow:column.querySelector('.ceq-field-gain'),slopeRow:column.querySelector('.ceq-field-slope')});
  }
  this.onResize=()=>this.layout();win.addEventListener?.('resize',this.onResize);
  this.onChange=()=>{if(this.note&&this.note!=='Sending to Freestyle…')this.note=null;this.render();};this.controller.addEventListener('change',this.onChange);
  this.layout();this.paintPower();this.render();return this;
 }
 /** View size: the whole editor is zoomed (it also shrinks to fit a narrow window); pointer input maps from the on-screen rectangle. */
 setView(value){this.view=EQ_VIEW_SIZES.includes(value)?value:1;const select=this.container?.querySelector('.eq-view');if(select)select.value=String(this.view);this.layout();}
 layout(){
  if(!this.container)return;const W=EQ_VIEW.width,available=Math.max(320,(Number(this.win?.innerWidth)||W+40)-14),width=Math.min(W*this.view,available);
  // Pinned size: nothing in the editor (status text, fields) can widen its window while dragging.
  this.container.setAttribute('style',`width:min(${Math.round(W*this.view)}px,calc(100vw - 14px));max-width:100%;overflow:hidden`);
  // The window may cap the panel further (max-width): zoom to the width the panel really got.
  // offsetWidth, not the bounding rectangle: the window's opening animation scales the rectangle.
  const got=Number(this.container.offsetWidth)||0;this.root.style.zoom=String(Math.floor((got>0?Math.min(got,width):width)/W*1000)/1000);
 }
 paintPower(){
  if(!this.power)return;
  if(!this.bypass){this.power.disabled=true;this.power.classList.add('on');this.power.setAttribute('aria-pressed','true');this.power.title=EQ_UNSUPPORTED.power;return;}
  let state={};try{state=this.bypass.state?.()||{};}catch{}
  this.power.disabled=!state.known||!!state.busy||typeof this.bypass.toggle!=='function';this.power.classList.toggle('on',!state.known||!state.bypassed);this.power.setAttribute('aria-pressed',state.known?String(!state.bypassed):'mixed');
  this.power.title=state.known?`${state.bypassed?'Turn on':'Bypass'} ${this.name}`:'Bypass state not read yet (open the strip’s slot menu to read it)';
  this.root?.classList.toggle('bypassed',!!state.known&&!!state.bypassed);
 }
 select(index){this.selected=index;this.active=true;}
 point(event){const rect=this.svg.getBoundingClientRect?.();if(!rect||!(rect.width>0))return null;return{x:(event.clientX-rect.left)/rect.width*EQ_VIEW.width,y:(event.clientY-rect.top)/rect.height*EQ_VIEW.height};}
 cycleType(index){const band=this.controller.band(index);if(!band)return;this.select(index);const shown=eqDisplayBand(band);this.commit({...adoptSlot(band),type:nextType(shown.type),enabled:true});}
 attachNode(node,index){
  node.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();this.select(index);try{node.setPointerCapture?.(event.pointerId);}catch{}const band=this.controller.band(index);if(band&&!band.enabled)this.safe(()=>this.controller.preview(index,{enabled:true,...adoptSlot(band)}));const now=this.controller.band(index);this.dragging={index,pointerId:event.pointerId,startY:event.clientY,startQ:now?.q??1,coupleGain:now?.gain_db??0,coupleQ:now?.q??1};node.classList.add('dragging');this.render();});
  node.addEventListener('pointermove',event=>{
   const drag=this.dragging;if(drag?.index!==index||event.pointerId!==drag.pointerId)return;const band=this.controller.band(index);if(!band)return;
   // Alt-drag: Q (up = narrower).
   if(event.altKey){this.safe(()=>this.controller.preview(index,{q:drag.startQ*2**((drag.startY-event.clientY)/60)}));drag.coupleQ=this.controller.band(index).q;drag.coupleGain=this.controller.band(index).gain_db;return;}
   const point=this.point(event);if(!point)return;const pass=/pass/.test(band.type);drag.startY=event.clientY;drag.startQ=band.q;
   const patch={frequency_hz:plot.frequency(point.x)};
   if(!pass){patch.gain_db=clamp(plot.gain(point.y),EQ_LIMITS.gain);
    // Gain-Q Couple: more boost or cut = proportionally narrower bell (Q follows |gain| from where the drag began).
    if(this.couple&&family(band.type)==='bell')patch.q=drag.coupleQ*(1+Math.abs(patch.gain_db)/12)/(1+Math.abs(drag.coupleGain)/12);}
   this.safe(()=>this.controller.preview(index,patch));
  });
  const end=event=>{if(this.dragging?.index!==index||event.pointerId!==this.dragging.pointerId)return;this.dragging=null;node.classList.remove('dragging');try{node.releasePointerCapture?.(event.pointerId);}catch{}this.commit({});};
  node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);
  node.addEventListener('wheel',event=>{event.preventDefault();const band=this.controller.band(index);if(!band)return;this.select(index);this.safe(()=>this.controller.preview(index,{...adoptSlot(band),q:eqDisplayBand(band).q*(event.deltaY<0?1.1:1/1.1)}));clearTimeout(this.wheelTimer);this.wheelTimer=setTimeout(()=>this.commit({}),250);},{passive:false});
  // Double-click: an off band switches on where it is drawn; an on band's gain resets to 0 dB.
  node.addEventListener('dblclick',event=>{event.preventDefault();const band=this.controller.band(index);if(!band)return;this.select(index);if(!band.enabled)this.commit({enabled:true,...adoptSlot(band)});else if(band.gain_db!==0)this.commit({gain_db:0});});
  // Right-click steps to the next filter shape; the browser menu never opens here.
  node.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();this.cycleType(index);});
 }
 /** A readout: vertical drag changes it (Shift = fine), a plain click edits it as text, double-click resets it. */
 attachField(input,index,key){
  const range=key==='frequency_hz'?EQ_LIMITS.frequency:key==='gain_db'?EQ_LIMITS.gain:EQ_LIMITS.q;
  const parse=()=>{if(!String(input.value).trim())return null;const value=Number(String(input.value).replace(/[^0-9eE+.\-]/g,''));return Number.isFinite(value)?clamp(value,range):null;};
  input.onchange=()=>{const value=parse();this.select(index);if(value===null){this.render();return;}const band=this.controller.band(index);this.commit({...(key==='frequency_hz'?{}:adoptSlot(band)),...(key==='frequency_hz'&&eqBandPristine(band)?{type:EQ_SLOTS[index%8].type,q:EQ_SLOTS[index%8].q}:{}),[key]:value});};
  let drag=null;
  input.addEventListener('pointerdown',event=>{if(event.button!==0||this.document.activeElement===input)return;event.preventDefault();try{input.setPointerCapture?.(event.pointerId);}catch{}const band=eqDisplayBand(this.controller.band(index));drag={pointerId:event.pointerId,y:event.clientY,value:band?band[key]:0,moved:false};});
  input.addEventListener('pointermove',event=>{
   if(!drag||event.pointerId!==drag.pointerId)return;const dy=drag.y-event.clientY;if(!drag.moved&&Math.abs(dy)<3)return;
   const fine=event.shiftKey?.2:1,band=this.controller.band(index);if(!band)return;if(!drag.moved){drag.moved=true;this.select(index);input.classList.add('dragging');}
   drag.value=clamp(key==='gain_db'?drag.value+dy*.1*fine:drag.value*2**(dy*fine/(key==='q'?60:48)),range);drag.y=event.clientY;
   this.safe(()=>this.controller.preview(index,{...adoptSlot(band),[key]:drag.value}));
  });
  const end=event=>{if(!drag||event.pointerId!==drag.pointerId)return;const moved=drag.moved;drag=null;input.classList.remove('dragging');try{input.releasePointerCapture?.(event.pointerId);}catch{}if(moved)this.commit({});else{this.select(index);input.focus?.();input.select?.();this.render();}};
  input.addEventListener('pointerup',end);input.addEventListener('pointercancel',end);
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();input.blur?.();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();input.value=input.dataset.before??input.value;input.blur?.();this.render();}
   else if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();const band=this.controller.band(index);if(!band)return;const shown=eqDisplayBand(band),up=event.key==='ArrowUp'?1:-1;this.select(index);this.commit({...adoptSlot(band),[key]:clamp(key==='gain_db'?shown[key]+up*.5:shown[key]*2**(up/12),range)});}});
  input.addEventListener('focus',()=>{input.dataset.before=input.value;input.style.width='7ch';});input.addEventListener('blur',()=>this.render());
  input.addEventListener('dblclick',event=>{event.preventDefault();const band=this.controller.band(index);if(!band||eqBandPristine(band))return;const slot=EQ_SLOTS[index%8];input.blur?.();this.select(index);this.commit({[key]:key==='frequency_hz'?slot.frequency:key==='gain_db'?0:slot.q});});
 }
 safe(task){try{return task();}catch(error){this.onError(error);}}
 // The summary line always follows the band state (Undo/Redo, outside changes); a note
 // (sending, or the last refusal) shows until the next change.
 commit(patch){const index=this.selected;this.note='Sending to Freestyle…';this.paintStatus();return this.controller.commit(index,patch).then(()=>{this.note=null;this.render();},error=>{this.note=error.message;this.paintStatus();this.onError(error);});}
 paintStatus(){if(!this.status)return;const band=this.controller.band(this.selected),shown=band&&eqDisplayBand(band);this.status.textContent=this.note??(band?`Band ${this.selected+1}: ${eqBandPristine(band)?`default (off) ${eqTypeLabel(shown.type)} ${shown.frequency_hz} Hz`:describeEqBand(band)}`:'');this.status.title=this.status.textContent;this.status.classList.toggle('error',!!this.note&&this.note!=='Sending to Freestyle…');}
 render(){
  if(!this.svg)return;const bands=this.controller.bands;
  this.curve.setAttribute('d',responsePath(bands));
  this.paintStatus();
  this.bandCurves.forEach((path,i)=>{const band=bands[i];if(band?.enabled){path.setAttribute('d',responsePath([band],{steps:120,closed:true}));path.style.display='';}else{path.removeAttribute('d');path.style.display='none';}path.classList.toggle('selected',this.active&&band?.band===this.selected);});
  const focused=this.container.ownerDocument?.activeElement;
  for(const {index,node,circle}of this.nodes){const band=bands.find(item=>item.band===index);node.style.display=band?'':'none';if(!band)continue;const shown=eqDisplayBand(band),selected=this.active&&index===this.selected;
   node.setAttribute('transform',`translate(${plot.x(shown.frequency_hz).toFixed(1)} ${clipY(plot.y(/pass/.test(shown.type)?0:band.gain_db)).toFixed(1)})`);
   const pass=/pass/.test(shown.type),color=pass?PASS_ON_COLOR:EQ_SLOTS[index%8].color;circle.setAttribute('fill',color);node.firstChild.setAttribute('fill',color);
   node.classList.toggle('selected',selected);node.classList.toggle('off',!band.enabled);
   node.setAttribute('opacity',band.enabled?(index===this.selected?'1':'.9'):(index===this.selected?'.7':'.4'));node.setAttribute('aria-label',`Band ${index+1} ${describeEqBand(band)}`);}
  for(const {index,icon,check,path,column,fields,gainRow,slopeRow}of this.columns){const band=bands.find(item=>item.band===index);if(!band)continue;
   const shown=eqDisplayBand(band),pristine=eqBandPristine(band),pass=/pass/.test(shown.type),color=band.enabled?(pass?PASS_ON_COLOR:EQ_SLOTS[index%8].color):OFF_COLOR,selected=this.active&&index===this.selected;
   check.checked=band.enabled;path.setAttribute('d',ICONS[family(shown.type)]);icon.style.color=band.enabled?(pass?'#8fa6bf':EQ_SLOTS[index%8].color):'#4f6277';icon.classList.toggle('on',band.enabled);icon.classList.toggle('selected',selected);
   icon.title=`Band ${index+1}: ${eqTypeLabel(shown.type)} — ${band.enabled?'on':'off'} (click to switch ${band.enabled?'off':'on'}, right-click for the next shape)`;
   column.style.color=color;column.classList.toggle('off',!band.enabled);column.classList.toggle('selected',selected);gainRow.hidden=pass;slopeRow.hidden=!pass;
   for(const [input,value]of [[fields.frequency,formatFrequency(shown.frequency_hz)],[fields.gain,formatGain(band.gain_db)],[fields.q,formatQ(shown.q)]]){if(focused!==input||!input.value)input.value=value;if(focused!==input)input.style.width=`${Math.max(1,input.value.length)}ch`;else input.style.width='7ch';
    // An untouched band shows the values its handle is drawn at, greyed as a default.
    input.style.opacity=pristine?'.55':'';input.title=pristine?'Default — this band has not been edited yet':'Drag up or down to change · click to type · double-click to reset';}}
  const band=bands.find(item=>item.band===this.selected),$=selector=>this.container.querySelector(selector);if(!band)return;
  $('.eq-band').value=String(this.selected);$('.eq-type').value=eqDisplayBand(band).type;
  this.root.dataset.bandDefault=String(eqBandPristine(band));
 }
 destroy(){if(this.onChange)this.controller.removeEventListener('change',this.onChange);if(this.onResize)this.win?.removeEventListener?.('resize',this.onResize);clearTimeout(this.wheelTimer);}
}
