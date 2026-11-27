/** Native EQ band editor for lane `native-eq` slots (328-op contract).
 *
 * Read:  getLaneEq {project_id, lane_id} → {live, eq, inserts[{instanceId, pluginIndex, typeId, eq:{bands[8]}}], racks, types[16]}
 *        bands: {band, enabled, type, type_index, frequency_hz, gain_db, q}. The slot's insert is matched by instance id.
 * Write: setLaneEqBand {project_id, lane_id, band 0–7, enabled, frequency_hz 20–20000, gain_db ±18, q 0.1–18, type,
 *        plugin_index, expected_plugin_instance_id, expected_plugin_type, persist}. persist:false is an engine-only drag
 *        tick; the final value goes with persist:true. A slot mismatch is 409 plugin_instance_mismatch and nothing is written.
 * Band values are only ever taken from what Freestyle returns; nothing is invented. Older backends without getLaneEq
 * fall back to the slot/engine-state read (readNativeEq) and set_track_eq_band.
 */
import {EditorError,describeEditorError} from './remote-plugin.js';

export const EQ_LIMITS=Object.freeze({frequency:Object.freeze([20,20000]),gain_db:Object.freeze([-18,18]),q:Object.freeze([.1,18])});
export const EQ_TYPES=Object.freeze(['bell','proportional_q','vintage_bell','band_shelf','low_shelf','resonant_low_shelf','vintage_low_shelf','high_shelf','resonant_high_shelf','vintage_high_shelf','low_pass','resonant_low_pass','high_pass','resonant_high_pass','baxandall_bass','baxandall_treble']);
const list=value=>Array.isArray(value)?value:[];
const norm=value=>String(value??'').trim().toLowerCase();
const finite=value=>value!==null&&value!==''&&value!==undefined&&Number.isFinite(Number(value));
const clamp=(value,[min,max])=>Math.max(min,Math.min(max,Number(value)));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unpack=result=>{let data=result?.structuredContent??result;for(let i=0;i<4&&data?.response&&typeof data.response==='object'&&!Array.isArray(data.response);i++)data={...data,...data.response,response:undefined};if(result?.isError||data?.ok===false||data?.error)throw Object.assign(new EditorError(data?.detail||data?.error?.message||(typeof data?.error==='string'?data.error:'')||data?.message||'Freestyle rejected the EQ request.',{code:data?.code??data?.error?.code??'eq_request_failed',stage:'native-eq',status:data?.status??data?.error?.status??null}),{result});return data||{};};
const uid=()=>globalThis.crypto?.randomUUID?.()||`eq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const typeLabel=type=>String(type||'').replaceAll('_',' ');

export function isNativeEqPlugin(plugin){const type=norm(plugin?.type_id??plugin?.typeId??plugin?.type),instance=norm(plugin?.instance_id??plugin?.instanceId??plugin?.pluginKey);return type==='native-eq'||type==='native_eq'||(!type&&/^native_eq(?:_|$)/.test(instance));}

/** One band in UI units, or null when a required value is absent (never filled with a guess). */
export function normalizeEqBand(raw,position){
  if(!raw||typeof raw!=='object')return null;
  const band=[raw.band,raw.index,raw.band_index,raw.bandIndex].find(Number.isInteger)??position;
  const frequency=[raw.frequency_hz,raw.frequency,raw.freq,raw.freq_hz].find(finite),gain=[raw.gain_db,raw.gain,raw.gainDb].find(finite),q=[raw.q,raw.Q].find(finite);
  if(!Number.isInteger(band)||band<0||frequency===undefined||gain===undefined||q===undefined||typeof raw.enabled!=='boolean')return null;
  const type=typeof raw.type==='string'&&raw.type?raw.type:typeof raw.shape==='string'&&raw.shape?raw.shape:null;
  return{band,enabled:raw.enabled,frequency:clamp(frequency,EQ_LIMITS.frequency),gain_db:clamp(gain,EQ_LIMITS.gain_db),q:clamp(q,EQ_LIMITS.q),type,...finite(raw.shapeNorm)?{shapeNorm:Number(raw.shapeNorm)}:{}};
}
const bandsOf=eq=>Array.isArray(eq?.bands)?eq.bands:Array.isArray(eq)?eq:null;
/** Finds `eq.bands` in a slot/lane/track read (an insert matched by instance id wins). */
export function findEqBands(value,{instanceId}={}){
  if(!value||typeof value!=='object')return null;
  const instance=norm(instanceId);
  const inserts=[...list(value.inserts),...list(value.racks),...list(value.plugins)];
  if(instance){const insert=inserts.find(item=>norm(item?.instance_id??item?.instanceId)===instance);const bands=bandsOf(insert?.eq)??bandsOf(insert?.native_eq)??bandsOf(insert?.state?.eq)??bandsOf(insert?.bands);if(bands)return bands;}
  for(const candidate of [value.eq,value.native_eq,value.nativeEq,value.state?.eq,value.snapshot?.eq,value.plugin?.eq,value.state?.native_eq,value.snapshot?.native_eq]){const bands=bandsOf(candidate);if(bands)return bands;}
  return Array.isArray(value.bands)?value.bands:null;
}

/** Typed read: the slot's insert (by instance id) from getLaneEq. */
export async function readLaneEq({call,projectId,contextTrackId,laneId,instanceId,pluginIndex}){
  const data=unpack(await call('getLaneEq',{project_id:projectId,lane_id:laneId,...contextTrackId?{track_id:contextTrackId}:{}}));
  if(data.projectId!==undefined&&data.projectId!==projectId||data.laneId!==undefined&&data.laneId!==laneId)throw new EditorError('The EQ read belongs to another lane.',{code:'eq_target_mismatch',stage:'native-eq:read'});
  const inserts=list(data.inserts),instance=norm(instanceId);
  const insert=instance?inserts.find(row=>norm(row?.instanceId??row?.instance_id)===instance):inserts.find(row=>row?.pluginIndex===pluginIndex);
  if(!insert)throw new EditorError('This EQ is no longer on the lane. Refresh the plug-in chain.',{code:'plugin_instance_not_found',stage:'native-eq:read'});
  const parsed=list(insert.eq?.bands).map((band,position)=>normalizeEqBand(band,position));
  return{bands:parsed.filter(Boolean),unreadable:parsed.filter(band=>!band).length,types:list(data.types).filter(type=>typeof type==='string'&&type).length?list(data.types).filter(type=>typeof type==='string'&&type):[...EQ_TYPES],live:data.live!==false,pluginIndex:Number.isInteger(insert.pluginIndex)?insert.pluginIndex:null,instanceId:String(insert.instanceId??insert.instance_id??''),source:'getLaneEq'};
}

/** Legacy read (pre-328): the slot's own state first, then the lane's live track in the engine snapshot. */
export async function readNativeEq({call,projectId,contextTrackId,laneId,pluginIndex,instanceId,cachedState=null}){
  const context={project_id:projectId,...contextTrackId?{track_id:contextTrackId}:{}},sources=[];
  const accept=(raw,source)=>{const bands=findEqBands(raw,{instanceId});if(!bands)return null;const parsed=bands.map((band,position)=>normalizeEqBand(band,position));return{bands:parsed.filter(Boolean),unreadable:parsed.filter(band=>!band).length,source};};
  try{const slot=unpack(await call('getLanePluginState',{...context,lane_id:laneId,plugin_index:pluginIndex,include_parameters:false}));sources.push('slot');const found=accept(slot,'slot');if(found?.bands.length)return found;}catch(error){sources.push(`slot:${error.code||error.status||'error'}`);}
  const fromState=state=>{const data=unpack(state),tracks=list(data?.tracks?.tracks??data?.tracks).filter(track=>String(track?.db_track_id??'')===String(laneId));return tracks.length===1?accept(tracks[0],'engine-state'):null;};
  if(cachedState){const found=fromState(cachedState);if(found?.bands.length)return{...found,source:'engine-state-cached'};}
  try{const found=fromState(await call('get_pro_state',context));sources.push('engine-state');if(found?.bands.length)return found;}catch(error){sources.push(`engine-state:${error.code||error.status||'error'}`);}
  throw new EditorError('Freestyle did not return this native EQ’s band values, so the bands cannot be edited safely.',{code:'eq_bands_unreadable',stage:'native-eq:read',details:{sources}});
}
/** getLaneEq missing on an older backend (not a typed engine refusal). */
const unsupported=error=>error?.code==='studio_operation_unsupported'||error?.code==='not_found'||Number(error?.status)===404&&!['plugin_instance_not_found','lane_has_no_live_chain'].includes(error?.code);

/* Curve (Audacity Filter Curve EQ style): RBJ biquad magnitude per enabled band at 48 kHz, summed in dB. */
const FS=48000;
function biquad(kind,f0,gainDb,q){
  const A=10**(gainDb/40),w0=2*Math.PI*Math.min(f0,FS*.49)/FS,cos=Math.cos(w0),sin=Math.sin(w0),alpha=sin/(2*Math.max(.05,q)),sq=2*Math.sqrt(A)*alpha;
  switch(kind){
    case'lowshelf':return[A*((A+1)-(A-1)*cos+sq),2*A*((A-1)-(A+1)*cos),A*((A+1)-(A-1)*cos-sq),(A+1)+(A-1)*cos+sq,-2*((A-1)+(A+1)*cos),(A+1)+(A-1)*cos-sq];
    case'highshelf':return[A*((A+1)+(A-1)*cos+sq),-2*A*((A-1)+(A+1)*cos),A*((A+1)+(A-1)*cos-sq),(A+1)-(A-1)*cos+sq,2*((A-1)-(A+1)*cos),(A+1)-(A-1)*cos-sq];
    case'lowpass':return[(1-cos)/2,1-cos,(1-cos)/2,1+alpha,-2*cos,1-alpha];
    case'highpass':return[(1+cos)/2,-(1+cos),(1+cos)/2,1+alpha,-2*cos,1-alpha];
    default:return[1+alpha*A,-2*cos,1-alpha*A,1+alpha/A,-2*cos,1-alpha/A];
  }
}
const kindOf=type=>/low_shelf|baxandall_bass/.test(type)?'lowshelf':/high_shelf|baxandall_treble/.test(type)?'highshelf':/low_pass/.test(type)?'lowpass':/high_pass/.test(type)?'highpass':'peak';
/** Approximate response in dB at `frequency` for the given bands (type families mapped to RBJ shapes). */
export function eqResponseDb(bands,frequency){
  let total=0;const w=2*Math.PI*frequency/FS,c1=Math.cos(w),s1=Math.sin(w),c2=Math.cos(2*w),s2=Math.sin(2*w);
  for(const band of bands){if(!band?.enabled)continue;const kind=kindOf(band.type||'bell'),[b0,b1,b2,a0,a1,a2]=biquad(kind,band.frequency,kind==='lowpass'||kind==='highpass'?0:band.gain_db,/baxandall/.test(band.type||'')?.5:band.q);
    const nr=b0+b1*c1+b2*c2,ni=-(b1*s1+b2*s2),dr=a0+a1*c1+a2*c2,di=-(a1*s1+a2*s2);total+=10*Math.log10(Math.max(1e-12,(nr*nr+ni*ni)/Math.max(1e-12,dr*dr+di*di)));}
  return total;
}
export function eqCurvePath(bands,{width=560,height=150,range=18,points=180}={}){
  const x=f=>Math.log(f/20)/Math.log(1000)*width,y=db=>height/2-Math.max(-range*1.5,Math.min(range*1.5,db))/range*(height/2);
  let d='';for(let i=0;i<=points;i++){const f=20*1000**(i/points);d+=`${i?'L':'M'}${x(f).toFixed(1)},${y(eqResponseDb(bands,f)).toFixed(1)}`;}return d;
}

const same=(a,b)=>!!a&&!!b&&a.enabled===b.enabled&&Math.abs(a.frequency-b.frequency)<1e-6&&Math.abs(a.gain_db-b.gain_db)<1e-6&&Math.abs(a.q-b.q)<1e-6&&(a.type??null)===(b.type??null);
const freqToSlider=frequency=>Math.round(1000*Math.log(frequency/20)/Math.log(1000));
const sliderToFreq=value=>Math.round(20*1000**(Number(value)/1000)*10)/10;
const rejected=error=>[409,412].includes(Number(error?.status))||/plugin_instance_mismatch|plugin_instance_not_found|lane_has_no_live_chain|precondition|conflict/.test(String(error?.code||''));

export class NativeEqEditor extends EventTarget{
  constructor({call,action=null,projectId,contextTrackId,laneId,pluginIndex,instanceId,cachedState=null,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),now=()=>globalThis.performance?.now?.()??Date.now(),tickMs=80,typed=null}={}){
    super();if(typeof call!=='function')throw new Error('A Freestyle call function is required for the native EQ.');
    if(!projectId||!laneId||!Number.isInteger(pluginIndex))throw new Error('Choose a saved lane EQ slot.');
    Object.assign(this,{call,action,projectId,contextTrackId:contextTrackId||null,laneId,pluginIndex,instanceId:instanceId||'',cachedState,setTimer,clearTimer,now,tickMs});
    this.typed=typed;this.types=[...EQ_TYPES];this.acked=new Map();this.shown=new Map();this.dragging=new Set();this.tickTimers=new Map();this.inflight=new Map();this.queuedFinal=new Set();this.lastTickAt=new Map();
    this.history=[];this.future=[];this.generation=0;this.statusText='';this.readable=false;
  }
  setStatus(text,error=false){this.statusText=text;this.statusError=error;if(this.statusElement){this.statusElement.textContent=text;this.statusElement.classList.toggle('error',error);}this.dispatchEvent(new CustomEvent('status',{detail:{text,error}}));}
  pending(){return this.inflight.size>0||this.tickTimers.size>0||this.dragging.size>0||this.queuedFinal.size>0;}
  async read(){
    if(this.typed!==false){
      try{const result=await readLaneEq({call:this.call,projectId:this.projectId,contextTrackId:this.contextTrackId,laneId:this.laneId,instanceId:this.instanceId,pluginIndex:this.pluginIndex});this.typed=true;return result;}
      catch(error){if(this.typed===true||!unsupported(error))throw error;this.typed=false;}
    }
    return readNativeEq({call:this.call,projectId:this.projectId,contextTrackId:this.contextTrackId,laneId:this.laneId,pluginIndex:this.pluginIndex,instanceId:this.instanceId,cachedState:typeof this.cachedState==='function'?this.cachedState():this.cachedState});
  }
  adopt(result,{keepPending=true}={}){
    this.acked=new Map(result.bands.map(band=>[band.band,band]));
    for(const band of result.bands)if(!keepPending||!this.dragging.has(band.band)&&!this.inflight.has(band.band)&&!this.queuedFinal.has(band.band))this.shown.set(band.band,{...band});
    if(result.types)this.types=result.types;if(Number.isInteger(result.pluginIndex))this.pluginIndex=result.pluginIndex;this.live=result.live;this.readable=true;this.source=result.source;
  }
  async load(){
    const generation=this.generation;this.setStatus('Reading EQ bands…');
    try{
      const result=await this.read();if(generation!==this.generation)return null;
      this.shown=new Map();this.adopt(result,{keepPending:false});
      this.setStatus(`${result.bands.length} bands${result.live===false?' · saved state (lane not live)':''}${result.unreadable?` · ${result.unreadable} unreadable band${result.unreadable===1?'':'s'} hidden`:''}`);this.paint();return result;
    }catch(error){if(generation===this.generation){this.readable=false;this.setStatus(eqErrorText(error),true);this.paint();}throw error;}
  }
  /** Optimistic edit. While a slider is held, engine-only ticks (persist:false) are coalesced; release sends the final value with persist:true. */
  set(band,field,value,{commit=false}={}){
    const current=this.shown.get(band);if(!this.readable||!current)throw new EditorError('Read the EQ bands before editing them.',{code:'eq_bands_unreadable',stage:'native-eq:write'});
    let next;
    if(field==='enabled')next={...current,enabled:!!value};
    else if(field==='type'){if(!this.types.includes(value))throw new EditorError('Choose a published EQ band type.',{code:'eq_type_unsupported',stage:'native-eq:write'});next={...current,type:value};}
    else if(field==='frequency'||field==='gain_db'||field==='q'){if(!finite(value))throw new EditorError('Enter a finite EQ value.',{code:'eq_value_invalid',stage:'native-eq:write'});next={...current,[field]:clamp(value,EQ_LIMITS[field])};}
    else throw new EditorError('Unsupported EQ band field.',{code:'eq_field_unsupported',stage:'native-eq:write'});
    this.shown.set(band,next);this.paint(band);
    if(commit||field==='enabled'||field==='type'){this.dragging.delete(band);return this.commit(band);}
    this.dragging.add(band);
    // While held, the first move ticks at once; later moves are coalesced to one in-flight tick per tickMs.
    if(!this.inflight.has(band)&&!this.tickTimers.has(band)&&this.now()-(this.lastTickAt.get(band)??-Infinity)>=this.tickMs){this.sendTick(band);return null;}
    this.scheduleTick(band);return null;
  }
  scheduleTick(band){
    if(this.tickTimers.has(band))return;
    const wait=Math.max(0,(this.lastTickAt.get(band)??-Infinity)+this.tickMs-this.now());
    this.tickTimers.set(band,this.setTimer(()=>{this.tickTimers.delete(band);if(this.inflight.has(band)){this.scheduleTick(band);return;}this.sendTick(band);},wait));
  }
  async sendTick(band){
    if(!this.dragging.has(band)||!this.typed)return;this.lastTickAt.set(band,this.now());
    const values={...this.shown.get(band)},task=this.write(band,values,{persist:false}).catch(error=>{if(rejected(error))this.fail(band,error);});
    this.inflight.set(band,task);try{await task;}finally{if(this.inflight.get(band)===task)this.inflight.delete(band);}
  }
  /** Release: stop ticks and send the final band once (after any tick in flight). */
  async commit(band){
    this.dragging.delete(band);const timer=this.tickTimers.get(band);if(timer!=null){this.clearTimer(timer);this.tickTimers.delete(band);}
    if(this.queuedFinal.has(band))return this.finalTask?.get(band);
    this.queuedFinal.add(band);this.finalTask??=new Map();
    const run=(async()=>{
      while(this.inflight.has(band))await this.inflight.get(band);
      this.queuedFinal.delete(band);
      const target={...this.shown.get(band)},before=this.acked.get(band),generation=this.generation;if(same(target,before))return null;
      this.setStatus(`Applying band ${band+1}…`);
      const task=(async()=>{
        try{
          const result=await this.write(band,target,{persist:true});if(generation!==this.generation)return result;
          this.acked.set(band,target);this.history.push({band,before,after:target});if(this.history.length>50)this.history.shift();this.future.length=0;
          this.lastReceipt=result;this.setStatus(result.engine_applied===false||result.engine_reload_required===true?`Band ${band+1} saved; live processing not confirmed yet.`:`Band ${band+1} applied`);
          this.dispatchEvent(new CustomEvent('applied',{detail:{band,values:target,result}}));
          await this.refresh();return result;
        }catch(error){if(generation===this.generation)this.fail(band,error);return null;}
      })();
      this.inflight.set(band,task);try{return await task;}finally{if(this.inflight.get(band)===task)this.inflight.delete(band);this.paintUndo();}
    })();
    this.finalTask.set(band,run);return run;
  }
  /** Re-read after a write so the editor shows the engine's actual bands. */
  async refresh(){if(!this.typed)return null;try{const result=await this.read();this.adopt(result);this.paint();return result;}catch{return null;}}
  fail(band,error){
    this.dragging.delete(band);const timer=this.tickTimers.get(band);if(timer!=null){this.clearTimer(timer);this.tickTimers.delete(band);}this.queuedFinal.delete(band);
    if(this.acked.has(band))this.shown.set(band,{...this.acked.get(band)});this.setStatus(`Band ${band+1} was not changed: ${eqErrorText(error)}`,true);this.paint(band);this.dispatchEvent(new CustomEvent('error',{detail:error}));
    if(/plugin_instance_mismatch|plugin_instance_not_found/.test(String(error?.code)))this.refresh();
  }
  async write(band,values,{persist}){
    if(this.typed){
      return unpack(await this.call('setLaneEqBand',{project_id:this.projectId,lane_id:this.laneId,...this.contextTrackId?{track_id:this.contextTrackId}:{},band,enabled:values.enabled,frequency_hz:values.frequency,gain_db:values.gain_db,q:values.q,...values.type?{type:values.type}:{},plugin_index:this.pluginIndex,...this.instanceId?{expected_plugin_instance_id:this.instanceId}:{},expected_plugin_type:'native-eq',persist,idempotency_key:uid()}));
    }
    const args={track_id:this.laneId,...this.contextTrackId?{scope_track_id:this.contextTrackId}:{},band,enabled:values.enabled,frequency:values.frequency,gain_db:values.gain_db,q:values.q,...values.type?{type:values.type}:{}};
    return unpack(this.action?await this.action('set_track_eq_band',args,{refresh:false}):await this.call('execute_pro_action',{project_id:this.projectId,...this.contextTrackId?{track_id:this.contextTrackId}:{},action:'set_track_eq_band',arguments:args,idempotency_key:uid()}));
  }
  canUndo(){return this.history.length>0&&!this.pending();}
  canRedo(){return this.future.length>0&&!this.pending();}
  /** Undo/redo write the acknowledged neighbouring band values (persist:true), refusing if the band moved since. */
  async undo(){return this.step('undo');}
  async redo(){return this.step('redo');}
  async step(direction){
    const stack=direction==='undo'?this.history:this.future,entry=stack.at(-1);if(!entry||this.pending())return null;
    const expected=direction==='undo'?entry.after:entry.before,target=direction==='undo'?entry.before:entry.after;
    if(!same(this.acked.get(entry.band),expected))throw new EditorError('This EQ band changed since that edit; undo would overwrite a newer value.',{code:'eq_undo_conflict',stage:'native-eq:undo'});
    stack.pop();this.shown.set(entry.band,{...target});this.paint(entry.band);
    try{const result=await this.write(entry.band,target,{persist:true});this.acked.set(entry.band,{...target});(direction==='undo'?this.future:this.history).push(entry);this.setStatus(`Band ${entry.band+1} ${direction==='undo'?'restored':'reapplied'}`);await this.refresh();this.paintUndo();return result;}
    catch(error){stack.push(entry);this.fail(entry.band,error);throw error;}
  }
  destroy(){this.generation++;for(const id of this.tickTimers.values())this.clearTimer(id);this.tickTimers.clear();this.dragging.clear();this.queuedFinal.clear();}
  mount(container){
    container.replaceChildren();this.container=container;container.classList.add('native-eq-editor');
    container.innerHTML='<div class="native-eq-toolbar"><strong>Native EQ</strong><span class="native-eq-status" role="status"></span><button type="button" class="native-eq-undo" disabled>Undo</button><button type="button" class="native-eq-redo" disabled>Redo</button></div><svg class="native-eq-curve" viewBox="0 0 560 150" preserveAspectRatio="none" role="img" aria-label="EQ response curve"></svg><div class="native-eq-bands" role="group" aria-label="Native EQ bands"></div>';
    this.statusElement=container.querySelector('.native-eq-status');this.bandsElement=container.querySelector('.native-eq-bands');this.curveElement=container.querySelector('.native-eq-curve');this.setStatus(this.statusText,this.statusError);
    container.querySelector('.native-eq-undo').onclick=()=>this.undo().catch(error=>this.setStatus(eqErrorText(error),true));
    container.querySelector('.native-eq-redo').onclick=()=>this.redo().catch(error=>this.setStatus(eqErrorText(error),true));
    this.bindCurveDrag();
    this.paint();
  }
  paintUndo(){const undo=this.container?.querySelector('.native-eq-undo'),redo=this.container?.querySelector('.native-eq-redo');if(undo)undo.disabled=!this.canUndo();if(redo)redo.disabled=!this.canRedo();}
  /** Audacity Filter Curve style: dB grid (±18), log frequency grid, 0 dB line and the summed response. */
  /** Audacity Filter Curve style: drag a band handle on the curve (x = frequency, y = gain); release saves it. */
  bindCurveDrag(){
    const svg=this.curveElement;if(!svg)return;
    const toBand=(event)=>{const rect=svg.getBoundingClientRect(),px=(Number(event.clientX)-(rect.left||0))/Math.max(1,rect.width||560)*560,py=(Number(event.clientY)-(rect.top||0))/Math.max(1,rect.height||150)*150;
      return{frequency:Math.round(clamp(20*1000**(px/560),EQ_LIMITS.frequency)*10)/10,gain_db:Math.round(clamp((75-py)/75*18,EQ_LIMITS.gain_db)*10)/10};};
    svg.onpointerdown=event=>{const handle=event.target?.closest?.('[data-handle]');if(!handle)return;const band=Number(handle.dataset.handle);if(!this.shown.has(band))return;event.preventDefault();try{svg.setPointerCapture?.(event.pointerId);}catch{}this.curveDrag={band,pointerId:event.pointerId};};
    svg.onpointermove=event=>{const drag=this.curveDrag;if(!drag||event.pointerId!==drag.pointerId)return;event.preventDefault();const next=toBand(event),current=this.shown.get(drag.band),gainless=/_pass$/.test(current.type||'');
      this.shown.set(drag.band,{...current,frequency:next.frequency,...gainless?{}:{gain_db:next.gain_db}});try{this.set(drag.band,'frequency',next.frequency);}catch(error){this.setStatus(eqErrorText(error),true);}};
    const end=event=>{const drag=this.curveDrag;if(!drag||event.pointerId!==drag.pointerId)return;this.curveDrag=null;try{if(svg.hasPointerCapture?.(event.pointerId))svg.releasePointerCapture(event.pointerId);}catch{}this.commit(drag.band);};
    svg.onpointerup=end;svg.onpointercancel=end;
  }
  paintCurve(){
    const svg=this.curveElement;if(!svg)return;const bands=[...this.shown.values()],x=f=>Math.log(f/20)/Math.log(1000)*560,y=db=>75-db/18*75;
    const grid=[...[-12,-6,0,6,12].map(db=>`<line class="${db?'grid':'zero'}" x1="0" x2="560" y1="${y(db)}" y2="${y(db)}"/><text x="2" y="${y(db)-2}">${db>0?'+':''}${db} dB</text>`),...[50,100,200,500,1000,2000,5000,10000].map(f=>`<line class="grid" x1="${x(f).toFixed(1)}" x2="${x(f).toFixed(1)}" y1="0" y2="150"/><text x="${x(f)+2}" y="146">${f>=1000?f/1000+'k':f}</text>`)].join('');
    const markers=bands.filter(band=>band.enabled).map(band=>`<circle data-handle="${band.band}" cx="${x(band.frequency).toFixed(1)}" cy="${y(Math.max(-18,Math.min(18,eqResponseDb([band],band.frequency)))).toFixed(1)}" r="6"><title>Band ${band.band+1}: drag to change frequency and gain</title></circle>`).join('');
    svg.innerHTML=`${grid}<path class="curve" d="${eqCurvePath(bands)}"/>${markers}`;
  }
  paint(onlyBand){
    if(!this.bandsElement)return;
    this.paintUndo();this.paintCurve();
    if(onlyBand!==undefined){const row=this.bandsElement.querySelector(`[data-band="${onlyBand}"]`),band=this.shown.get(onlyBand);if(row&&band){this.fillRow(row,band);return;}}
    if(!this.readable){this.bandsElement.innerHTML='<p class="native-eq-empty">Band values are not available from Freestyle, so editing is disabled to avoid overwriting the current EQ.</p>';return;}
    const bands=[...this.shown.values()].sort((a,b)=>a.band-b.band),types=this.types;
    this.bandsElement.innerHTML=bands.map(band=>`<div class="native-eq-band" data-band="${band.band}"><label class="native-eq-on"><input type="checkbox" data-field="enabled" aria-label="Band ${band.band+1} enabled"> ${band.band+1}</label><select data-field="type" aria-label="Band ${band.band+1} type">${types.map(type=>`<option value="${esc(type)}">${esc(typeLabel(type))}</option>`).join('')}</select><label>Hz<input type="range" min="0" max="1000" step="1" data-slider="frequency" aria-label="Band ${band.band+1} frequency"><input type="number" min="20" max="20000" step="0.1" data-field="frequency" aria-label="Band ${band.band+1} frequency in hertz"></label><label>dB<input type="range" min="-18" max="18" step="0.1" data-slider="gain_db" aria-label="Band ${band.band+1} gain"><input type="number" min="-18" max="18" step="0.1" data-field="gain_db" aria-label="Band ${band.band+1} gain in decibels"></label><label>Q<input type="range" min="0" max="1000" step="1" data-slider="q" aria-label="Band ${band.band+1} Q"><input type="number" min="0.1" max="18" step="0.01" data-field="q" aria-label="Band ${band.band+1} Q value"></label></div>`).join('')||'<p class="native-eq-empty">This EQ reports no bands.</p>';
    for(const row of this.bandsElement.querySelectorAll('[data-band]')){
      const band=Number(row.dataset.band);this.fillRow(row,this.shown.get(band));
      const report=error=>this.setStatus(eqErrorText(error),true);
      row.querySelector('[data-field="enabled"]').onchange=event=>{try{this.set(band,'enabled',event.target.checked);}catch(error){report(error);}};
      row.querySelector('[data-field="type"]').onchange=event=>{try{this.set(band,'type',event.target.value);}catch(error){report(error);}};
      const sliders={frequency:value=>sliderToFreq(value),gain_db:value=>Number(value),q:value=>Math.round(.1*180**(Number(value)/1000)*100)/100};
      for(const [field,map] of Object.entries(sliders)){const slider=row.querySelector(`[data-slider="${field}"]`);slider.oninput=()=>{try{this.set(band,field,map(slider.value));}catch(error){report(error);}};slider.onchange=()=>{this.commit(band);};}
      for(const input of row.querySelectorAll('input[type=number]'))input.onchange=event=>{try{this.set(band,event.target.dataset.field,event.target.value,{commit:true});}catch(error){report(error);}};
    }
  }
  fillRow(row,band){
    const active=globalThis.document?.activeElement;const put=(selector,value)=>{const input=row.querySelector(selector);if(input&&input!==active){if(input.type==='checkbox')input.checked=!!value;else input.value=String(value);}};
    put('[data-field="enabled"]',band.enabled);if(band.type)put('[data-field="type"]',band.type);put('[data-slider="frequency"]',freqToSlider(band.frequency));put('[data-field="frequency"]',band.frequency);put('[data-slider="gain_db"]',band.gain_db);put('[data-field="gain_db"]',band.gain_db);put('[data-slider="q"]',Math.round(1000*Math.log(band.q/.1)/Math.log(180)));put('[data-field="q"]',band.q);
    row.classList.toggle('disabled',!band.enabled);
  }
}

/** Typed EQ errors as user-facing text with code/stage. */
export function eqErrorText(error){
  if(error?.code==='lane_has_no_live_chain')return describeEditorError(Object.assign(new EditorError('This lane has no live plug-in chain yet (it is not synced into the live session). Reload the project or play the lane once, then reopen the EQ.',{code:error.code,stage:error.stage||'native-eq',status:error.status}),{}),'EQ');
  if(error?.code==='plugin_instance_mismatch')return describeEditorError(Object.assign(new EditorError(`The plug-in in this slot changed${error.details?.currentPluginType?` (now ${error.details.currentPluginType})`:''}; nothing was written.`,{code:error.code,stage:error.stage,status:error.status}),{}),'EQ');
  return describeEditorError(error,'EQ');
}
