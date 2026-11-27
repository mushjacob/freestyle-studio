/** FL Fruity Parametric EQ 2-style band editor for Freestyle's native EQ slot.
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

const BAND_COLORS=['#e3a35b','#d7d35a','#8fd16a','#5fd0b5','#62a8e0','#8f86e6','#d47ad2','#e07a86'];
const FREQUENCY_GRID=[[20,'20'],[50,'50'],[100,'100'],[200,'200'],[500,'500'],[1000,'1k'],[2000,'2k'],[5000,'5k'],[10000,'10k'],[20000,'20k']];
const GAIN_GRID=[18,12,6,0,-6,-12,-18];
// FL spreads untouched bands across the spectrum. Freestyle stores every untouched band as
// off/bell/1 kHz/0 dB/Q 1, so such a band is DRAWN at its spread position (the fields still
// show the stored 1000 Hz) and takes that frequency when it is first switched on or dragged.
export const EQ_DEFAULT_SPREAD=Object.freeze(Array.from({length:8},(_,index)=>Math.round(40*400**(index/7))));
export const eqBandPristine=band=>!!band&&!band.enabled&&band.type==='bell'&&band.frequency_hz===1000&&band.gain_db===0&&band.q===1;
export const eqDisplayFrequency=band=>eqBandPristine(band)?EQ_DEFAULT_SPREAD[band.band%8]:band.frequency_hz;
const nextType=type=>EQ_BAND_TYPES[(EQ_BAND_TYPES.indexOf(type)+1)%EQ_BAND_TYPES.length];
/** FL Parametric EQ 2-style view: numbered band handles (dimmed when off), log-frequency/dB grid,
 * per-band coloured curves plus the summed curve, and type/freq/gain/Q/enable fields.
 * Drag a handle: frequency/gain; Alt-drag: Q; wheel: Q; right-click: next type; double-click: on/off. */
export class EqEditorView{
 constructor({controller,onError=()=>{},document:doc=globalThis.document,width=560,height=220}={}){Object.assign(this,{controller,onError,document:doc,width,height});this.selected=0;}
 mount(container){
  const doc=container.ownerDocument||this.document,ns='http://www.w3.org/2000/svg',W=this.width,H=this.height;this.container=container;
  // Pinned size: nothing in the editor (status text, fields) can widen its window while dragging.
  container.setAttribute('style',`width:min(${W+2}px,90vw);max-width:100%;overflow:hidden`);
  container.innerHTML=`<div class="eq-editor" style="display:grid;grid-template-columns:minmax(0,1fr);gap:6px;font:12px Arial;color:#cfd8d8;width:100%;min-width:0"><svg class="eq-plot" viewBox="0 0 ${W} ${H}" style="display:block;overflow:hidden;width:100%;aspect-ratio:${W}/${H};background:#1d2427;border:1px solid #3a4549;touch-action:none;user-select:none" role="img" aria-label="EQ curve"></svg><div class="eq-fields" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><label>Band <select class="eq-band" aria-label="EQ band"></select></label><label><input type="checkbox" class="eq-enabled"> On</label><label>Type <select class="eq-type" aria-label="Band type"></select></label><label>Freq <input class="eq-frequency" type="number" min="20" max="20000" step="1" style="width:72px" aria-label="Frequency (Hz)"> Hz</label><label>Gain <input class="eq-gain" type="number" min="-18" max="18" step="0.1" style="width:56px" aria-label="Gain (dB)"> dB</label><label>Q <input class="eq-q" type="number" min="0.1" max="18" step="0.01" style="width:56px" aria-label="Q"></label></div><p class="eq-status" role="status" style="margin:0;height:1.3em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></p></div>`;
  const $=selector=>container.querySelector(selector);this.svg=$('.eq-plot');this.status=$('.eq-status');
  $('.eq-type').innerHTML=EQ_BAND_TYPES.map(type=>`<option value="${type}">${eqTypeLabel(type)}</option>`).join('');
  $('.eq-band').innerHTML=this.controller.bands.map(band=>`<option value="${band.band}">${band.band+1}</option>`).join('');
  $('.eq-band').onchange=()=>{this.selected=Number($('.eq-band').value);this.render();};
  const field=(selector,key,parse)=>{$(selector).onchange=()=>{const band=this.controller.band(this.selected),spread=key!=='frequency_hz'&&eqBandPristine(band)?{frequency_hz:eqDisplayFrequency(band)}:{};this.commit({...spread,[key]:parse($(selector))});};};
  field('.eq-enabled','enabled',input=>input.checked);field('.eq-type','type',input=>input.value);field('.eq-frequency','frequency_hz',input=>Number(input.value));field('.eq-gain','gain_db',input=>Number(input.value));field('.eq-q','q',input=>Number(input.value));
  const g=eqGeometry(W,H),el=(name,attrs={},text)=>{const node=doc.createElementNS(ns,name);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));if(text!=null)node.textContent=text;return node;};
  const grid=el('g',{class:'eq-grid','font-size':9,fill:'#7d8b8c'});
  for(const [f,label]of FREQUENCY_GRID){const x=g.x(f).toFixed(1);grid.append(el('path',{d:`M${x} 0V${H}`,stroke:'#2e3839'}),el('text',{x:Math.min(W-14,Number(x)+2),y:H-3},label));}
  for(const db of GAIN_GRID){const y=g.y(db).toFixed(1);grid.append(el('path',{d:`M0 ${y}H${W}`,stroke:db===0?'#4a5759':'#2e3839'}),el('text',{x:2,y:Number(y)-2},`${db>0?'+':''}${db}`));}
  this.bandCurves=this.controller.bands.map(band=>el('path',{fill:'none',stroke:BAND_COLORS[band.band%8],'stroke-width':1,opacity:.55}));
  this.curve=el('path',{fill:'none',stroke:'#e9eef0','stroke-width':2});
  this.svg.append(grid,...this.bandCurves,this.curve);this.nodes=[];
  for(const band of this.controller.bands){const index=band.band,node=el('g',{'data-eq-band':index,style:'cursor:grab'}),circle=el('circle',{r:8,stroke:BAND_COLORS[index%8],'stroke-width':2}),label=el('text',{'text-anchor':'middle','dominant-baseline':'central','font-size':9,'font-weight':'bold','pointer-events':'none'},String(index+1));node.append(circle,label);this.svg.append(node);this.nodes.push({index,node,circle,label});this.attachNode(node,index);}
  this.onChange=()=>{if(this.note&&this.note!=='Sending to Freestyle…')this.note=null;this.render();};this.controller.addEventListener('change',this.onChange);this.render();return this;
 }
 point(event){const rect=this.svg.getBoundingClientRect?.();if(!rect||!(rect.width>0))return null;return{x:(event.clientX-rect.left)/rect.width*this.width,y:(event.clientY-rect.top)/rect.height*this.height};}
 attachNode(node,index){
  node.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();this.selected=index;try{node.setPointerCapture?.(event.pointerId);}catch{}const band=this.controller.band(index);if(band&&!band.enabled)this.safe(()=>this.controller.preview(index,{enabled:true,...(eqBandPristine(band)?{frequency_hz:eqDisplayFrequency(band)}:{})}));this.dragging={index,pointerId:event.pointerId,startY:event.clientY,startQ:band?.q??1};this.render();});
  node.addEventListener('pointermove',event=>{
   const drag=this.dragging;if(drag?.index!==index||event.pointerId!==drag.pointerId)return;const band=this.controller.band(index);if(!band)return;
   // Alt-drag: Q (up = narrower), like FL.
   if(event.altKey){this.safe(()=>this.controller.preview(index,{q:drag.startQ*2**((drag.startY-event.clientY)/60)}));return;}
   const point=this.point(event);if(!point)return;const g=eqGeometry(this.width,this.height),pass=/pass/.test(band.type);drag.startY=event.clientY;drag.startQ=band.q;
   this.safe(()=>this.controller.preview(index,{frequency_hz:g.frequency(point.x),...(pass?{}:{gain_db:g.gain(point.y)})}));
  });
  const end=event=>{if(this.dragging?.index!==index||event.pointerId!==this.dragging.pointerId)return;this.dragging=null;try{node.releasePointerCapture?.(event.pointerId);}catch{}this.commit({});};
  node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);
  node.addEventListener('wheel',event=>{event.preventDefault();const band=this.controller.band(index);if(!band)return;this.selected=index;this.safe(()=>this.controller.preview(index,{q:band.q*(event.deltaY<0?1.1:1/1.1)}));clearTimeout(this.wheelTimer);this.wheelTimer=setTimeout(()=>this.commit({}),250);},{passive:false});
  node.addEventListener('dblclick',event=>{event.preventDefault();const band=this.controller.band(index);if(band){this.selected=index;this.commit({enabled:!band.enabled,...(eqBandPristine(band)?{frequency_hz:eqDisplayFrequency(band)}:{})});}});
  // Right-click cycles the band type (FL); the browser menu never opens here.
  node.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();const band=this.controller.band(index);if(band){this.selected=index;this.commit({type:nextType(band.type),enabled:true,...(eqBandPristine(band)?{frequency_hz:eqDisplayFrequency(band)}:{})});}});
 }
 safe(task){try{return task();}catch(error){this.onError(error);}}
 // The summary line always follows the band state (Undo/Redo, outside changes); a note
 // (sending, or the last refusal) shows until the next change.
 commit(patch){const index=this.selected;this.note='Sending to Freestyle…';this.paintStatus();return this.controller.commit(index,patch).then(()=>{this.note=null;this.render();},error=>{this.note=error.message;this.paintStatus();this.onError(error);});}
 paintStatus(){if(!this.status)return;const band=this.controller.band(this.selected);this.status.textContent=this.note??(band?`Band ${this.selected+1}: ${eqBandPristine(band)?`default (off) ${eqTypeLabel(band.type)} ${eqDisplayFrequency(band)} Hz`:describeEqBand(band)}`:'');this.status.title=this.status.textContent;}
 render(){
  if(!this.svg)return;const bands=this.controller.bands,g=eqGeometry(this.width,this.height);
  this.curve.setAttribute('d',eqCurvePath(bands,this.width,this.height));
  this.paintStatus();
  this.bandCurves.forEach((path,i)=>{const band=bands[i];if(band?.enabled){path.setAttribute('d',eqCurvePath([band],this.width,this.height,80));path.style.display='';}else path.style.display='none';});
  for(const {index,node,circle,label}of this.nodes){const band=bands.find(item=>item.band===index);node.style.display=band?'':'none';if(!band)continue;
   node.setAttribute('transform',`translate(${g.x(eqDisplayFrequency(band)).toFixed(1)} ${g.y(/pass/.test(band.type)?0:band.gain_db).toFixed(1)})`);
   const color=BAND_COLORS[index%8];circle.setAttribute('fill',band.enabled?color:'#1d2427');label.setAttribute('fill',band.enabled?'#14191b':color);
   node.setAttribute('opacity',band.enabled?(index===this.selected?'1':'.9'):(index===this.selected?'.7':'.4'));node.setAttribute('aria-label',`Band ${index+1} ${describeEqBand(band)}`);}
  const band=bands.find(item=>item.band===this.selected),$=selector=>this.container.querySelector(selector);if(!band)return;
  $('.eq-band').value=String(this.selected);$('.eq-enabled').checked=band.enabled;$('.eq-type').value=band.type;
  // An untouched band shows the frequency its handle is drawn at, greyed as a default.
  const pristine=eqBandPristine(band);
  for(const [selector,value]of [['.eq-frequency',Math.round(eqDisplayFrequency(band))],['.eq-gain',round(band.gain_db,1)],['.eq-q',round(band.q,2)]]){const input=$(selector);if(this.container.ownerDocument?.activeElement!==input)input.value=String(value);input.style.opacity=pristine?'.55':'';input.title=pristine?'Default — this band has not been edited yet':'';}
  this.container.querySelector('.eq-editor').dataset.bandDefault=String(pristine);
 }
 destroy(){if(this.onChange)this.controller.removeEventListener('change',this.onChange);clearTimeout(this.wheelTimer);}
}
