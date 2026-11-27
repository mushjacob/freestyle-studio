/** Logic Pro Region Inspector Gain for Freestyle pattern / MIDI regions (timeline
 * pattern placements), over published Studio API v1 operations only.
 *
 * Write: `setPatternPlacementGain` PUT /pattern-placements/{placement_id}/gain
 * {gain} (linear, 1 = unity; the published schema has minimum 0 and no maximum,
 * the engine action `engine_set_pattern_placement_gain` caps it at 4, so the
 * Inspector uses Logic's −∞ … +12 dB = 0–4 like audio region gain). The
 * operation declares no If-Match and answers an EngineActionResult; there is no
 * persist:false variant, so a drag previews locally and commits once.
 *
 * Read: there is no dedicated gain read. The saved placement row
 * (`getPatternPlacement`) may carry `rowGain` (PatternPlacementSnapshot field:
 * null = no row gain = unity, else an object holding the linear value). When the
 * fresh row carries no gain at all, the value this controller itself confirmed
 * in this project session is used; with neither, the edit is refused before
 * anything is sent, because Undo could not restore the previous value exactly.
 *
 * One gesture is one ordered history step (CloudPatternHistory external step).
 * Undo / Redo re-read the region and refuse (not applied) when its gain changed
 * since the step.
 */
import {gainDbText,regionWriteRejected,CLIP_GAIN_MAX} from './logic-region-gain-fade.js';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const fail=(message,code='pattern_gain_invalid',extra={})=>Object.assign(new Error(message),{code},extra);
/** A guard refusal: nothing was sent, history keeps the step. */
const refused=(message,code='pattern_gain_changed')=>fail(message,code,{dispatched:false,historyNotApplied:true});
const VALUE_EPS=1e-6,COMPARE_EPS=1e-4;
export const PATTERN_GAIN_MAX=CLIP_GAIN_MAX;
export const PATTERN_GAIN_OPERATIONS=Object.freeze(['setPatternPlacementGain','getPatternPlacement']);

/**
 * The saved linear gain carried by a placement row, or null when the row does
 * not report one. `rowGain: null` is the stored default (no row gain = unity).
 */
export function placementRowGain(row){
 if(!record(row))return null;
 if(Object.hasOwn(row,'rowGain')){
  const value=row.rowGain;
  if(value===null)return 1;
  if(finite(value)&&value>=0)return value;
  if(record(value)){for(const key of ['gain','value','linear'])if(finite(value[key])&&value[key]>=0)return value[key];}
  return null;
 }
 if(finite(row.gain)&&row.gain>=0)return row.gain;
 return null;
}

/** A pattern / MIDI region with a saved placement identity. */
export function isPatternRegion(region){return !!region&&id(region.cloudId)&&typeof region.patternId==='string'&&region.patternId.length>0;}

/**
 * Pattern region gain controller.
 * options: client() → StudioApiClient|null; scope() → {projectId}|null;
 * history() → CloudPatternHistory|null; onChange(placementId); log(event, detail).
 */
export class PatternRegionGainController{
 constructor({client,scope,history=()=>null,onChange=()=>{},log=()=>{},operations=null}={}){
  if(typeof client!=='function'||typeof scope!=='function')throw new TypeError('PatternRegionGainController needs client and scope.');
  Object.assign(this,{client,scope,history,onChange,log,operations});this.gains=new Map();this.reads=new Set();this.busy=false;this.generation=0;
 }
 supports(){const set=this.operations;return !set||PATTERN_GAIN_OPERATIONS.every(op=>set instanceof Set?set.has(op):Object.hasOwn(set,op));}
 api(){const client=this.client();if(typeof client?.call!=='function')throw fail('Region gain needs a Studio API (OAuth) project. Reload the project.','pattern_gain_unavailable',{dispatched:false});return client;}
 context(){const scope=this.scope();if(!id(scope?.projectId))throw fail('Open a Freestyle project first.','pattern_gain_scope',{dispatched:false});return{projectId:scope.projectId};}
 assertContext(context){if(this.scope()?.projectId!==context.projectId)throw fail('The project changed before the region gain edit finished.','pattern_gain_scope',{dispatched:false});}
 reset(){this.generation++;this.gains.clear();this.reads.clear();}
 /** Known saved gain (linear) of a placement, or null. */
 gain(placementId){return this.gains.get(placementId)?.gain??null;}
 /** Why the gain is unknown (after a read), or ''. */
 reason(placementId){return this.gains.get(placementId)?.error||'';}
 notify(placementId){try{this.onChange(placementId);}catch{}}
 /** Fresh saved gain: the placement row's rowGain, else this session's confirmed value. */
 async readGain(region,context=this.context()){
  const result=await this.api().call('getPatternPlacement',{path:{project_id:context.projectId,placement_id:region.cloudId}});this.assertContext(context);
  const data=record(result?.data?.placement)?result.data.placement:result?.data;
  if(!record(data)||data.id!=null&&data.id!==region.cloudId||data.projectId!=null&&data.projectId!==context.projectId)throw fail('Freestyle returned another region.','pattern_gain_scope');
  let gain=placementRowGain(data),source='row';
  const cached=this.gains.get(region.cloudId);
  if(gain===null&&cached?.confirmed&&cached.generation===this.generation&&finite(cached.gain)){gain=cached.gain;source='confirmed';}
  if(gain===null){this.gains.set(region.cloudId,{gain:null,error:'Freestyle does not report this region’s saved gain, so a change could not be undone exactly.',generation:this.generation});throw fail('Freestyle does not report this region’s saved gain, so a change could not be undone exactly. Nothing was changed.','pattern_gain_unknown',{dispatched:false,historyNotApplied:true});}
  this.gains.set(region.cloudId,{gain,source,confirmed:cached?.confirmed===true&&source==='confirmed',generation:this.generation});
  return gain;
 }
 /** Background read for the Inspector (once per region until reset). */
 loadGain(region){
  if(!isPatternRegion(region)||this.gains.has(region.cloudId)||this.reads.has(region.cloudId))return;
  // The canonical project row is shown at once when it carries the gain.
  const known=placementRowGain(region.cloudRaw);if(known!==null)this.gains.set(region.cloudId,{gain:known,source:'project',generation:this.generation});
  let context;try{context=this.context();this.api();}catch{return;}
  const generation=this.generation;this.reads.add(region.cloudId);
  this.readGain(region,context).then(()=>this.notify(region.cloudId),()=>this.notify(region.cloudId)).finally(()=>{if(generation===this.generation)this.reads.delete(region.cloudId);});
 }
 async sendGain(region,gain,context){
  const result=await this.api().call('setPatternPlacementGain',{path:{project_id:context.projectId,placement_id:region.cloudId},body:{gain}});this.assertContext(context);
  const data=result?.data,response=record(data?.response)?data.response:null;
  if(response?.ok===false)throw fail(String(response.error||response.message||'Freestyle refused the region gain.'),'pattern_gain_refused',{status:409});
  if(!record(data))throw fail('Freestyle did not confirm the region gain.','pattern_gain_receipt',{operationUncertain:true});
  const echoed=[response?.gain,response?.after,data.resolvedArgs?.gain].find(finite);
  if(echoed!==undefined&&Math.abs(echoed-gain)>VALUE_EPS)throw fail('Freestyle confirmed a different region gain.','pattern_gain_receipt',{operationUncertain:true});
  if(data.mutated===false&&finite(response?.before)&&Math.abs(response.before-gain)>VALUE_EPS)throw fail('Freestyle did not apply the region gain.','pattern_gain_receipt',{operationUncertain:true});
  this.gains.set(region.cloudId,{gain,source:'confirmed',confirmed:true,generation:this.generation});
  this.notify(region.cloudId);
  return{gain,before:finite(response?.before)?response.before:null};
 }
 begin(label){const history=this.history();let token=null;try{token=history?.beginExternalStep?.({kind:'pattern_region_gain',label})??null;}catch{token=null;}return{history,token};}
 finish({history,token},step){if(!history)return false;if(token)return history.finishExternalStep(token,step)===true;return history.recordExternalStep?.(step)===true;}
 abandon({history,token},error){if(token)try{history.failExternalStep(token,error);}catch{}}
 /** Set the region's saved linear gain (0–4). One history step. */
 async setGain(region,gain){
  if(this.busy)throw fail('Wait for the current region gain to save.','pattern_gain_busy',{dispatched:false});
  if(!isPatternRegion(region))throw fail('Select a saved pattern or MIDI region.','pattern_gain_invalid',{dispatched:false});
  if(!finite(gain)||gain<0||gain>PATTERN_GAIN_MAX)throw fail('Region gain must be from −∞ to +12 dB.','pattern_gain_invalid',{dispatched:false});
  const context=this.context();this.busy=true;let pending=null,sent=false;
  try{
   const before=await this.readGain(region,context);
   if(Math.abs(before-gain)<=VALUE_EPS)return{changed:false,gain:before};
   const label='Region Gain';pending=this.begin(label);sent=true;
   const out=await this.sendGain(region,gain,context),after=out.gain;
   if(out.before!==null&&Math.abs(out.before-before)>COMPARE_EPS)throw fail('The region’s gain changed while it was saving.','pattern_gain_receipt',{operationUncertain:true});
   const placementId=region.cloudId,target={cloudId:placementId,patternId:region.patternId,name:region.name};
   const step=(expected,value)=>async()=>{
    const current=this.context();if(current.projectId!==context.projectId)throw refused('Reopen the region’s project to use its gain history.');
    if(this.busy)throw refused('Wait for the current region gain to save.','pattern_gain_busy');
    this.busy=true;try{
     const now=await this.readGain(target,current);
     if(Math.abs(now-expected)>COMPARE_EPS)throw refused('This region’s gain changed since that edit. History will not overwrite it.');
     return{placementId,gain:(await this.sendGain(target,value,current)).gain};
    }finally{this.busy=false;}
   };
   const journaled=this.finish(pending,{kind:'pattern_region_gain',label:`${label} ${gainDbText(after)} dB – ${region.name||'Region'}`,detail:{placementId,before,after},undo:step(after,before),redo:step(before,after)});pending=null;
   this.log('pattern-region-gain',{placementId,before,after,journaled});
   return{changed:true,gain:after,before,journaled};
  }catch(error){
   if(pending)this.abandon(pending,error);
   if(!sent&&error.dispatched===undefined)error.dispatched=false;
   if(sent&&!regionWriteRejected(error))error.operationUncertain=true;
   throw error;
  }finally{this.busy=false;}
 }
}
