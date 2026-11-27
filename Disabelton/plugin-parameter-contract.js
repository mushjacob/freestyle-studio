/** Pure controls for Studio API v1's advertised plugin parameter write forms.
 * Physical values are never inferred from normalized values or display text.
 * Slot/instance, project and page freshness guards remain the caller's job.
 */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const forms=new Set(['value','value_norm']);
function failure(message,code='plugin_parameter_contract_invalid'){
 return Object.assign(new TypeError(message),{code,stage:'client_validation',dispatched:false});
}
function options(value,allowed){
 if(!record(value))throw failure('Plugin parameter options must be an object.');
 for(const key of Object.keys(value))if(!allowed.includes(key))throw failure('Unknown plugin parameter option: '+key);
}
function freeze(value,seen=new WeakSet()){
 if(value&&typeof value==='object'&&!seen.has(value)){seen.add(value);for(const child of Object.values(value))freeze(child,seen);Object.freeze(value);}return value;
}
function bounded(value,min,max,label){
 if(!finite(value)||value<min||value>max)throw failure(`${label} must be a finite number between ${min} and ${max}.`,'plugin_parameter_value_invalid');return value;
}
function optionalDefault(value,min,max){return value==null?null:bounded(value,min,max,'Parameter default');}

/** Choose one explicitly advertised form. `auto` prefers lane physical units.
 * Malformed preferred metadata does not silently switch to another form.
 * A caller may explicitly choose another advertised form after inspecting it.
 * `step: "any"` preserves precision when no physical step was advertised;
 * normalized host step counts do not imply a physical or normalized taper.
 */
export function pluginParameterControl(parameter,settings={}){
 options(settings,['targetKind','form']);
 const {targetKind='lane',form='auto'}=settings;
 if(!['lane','bus'].includes(targetKind)||!['auto','physical','normalized'].includes(form))throw failure('Choose a lane/bus target and an advertised parameter form.');
 if(!record(parameter)||typeof parameter.id!=='string'||!parameter.id||!Number.isInteger(parameter.index)||parameter.index<0||typeof parameter.name!=='string'||!record(parameter.range))throw failure('Read this parameter’s exact typed identity and range first.');
 if(parameter.stale===true)throw failure('Reload this stale parameter page before editing.','plugin_parameter_stale');
 if(parameter.unit!=null&&typeof parameter.unit!=='string')throw failure('The parameter unit must be its advertised string or null.');
 if(!Array.isArray(parameter.writeForms)||parameter.writeForms.some(field=>!forms.has(field)))throw failure('Read this parameter’s advertised writeForms before editing.');
 const physicalAllowed=targetKind==='lane'&&parameter.writeForms.includes('value'),normalizedAllowed=parameter.writeForms.includes('value_norm');
 const chosen=form==='auto'?(physicalAllowed?'physical':'normalized'):form;
 if(chosen==='physical'&&!physicalAllowed||chosen==='normalized'&&!normalizedAllowed)throw failure('This parameter does not advertise that write form for this target.','plugin_parameter_form_unavailable');
 let value,min,max,step='any',defaultValue;
 if(chosen==='physical'){
  ({rawMin:min,rawMax:max}=parameter.range);
  if(!finite(min)||!finite(max)||min>=max)throw failure('Physical editing requires a finite increasing rawMin/rawMax range.');
  value=bounded(parameter.physicalValue,min,max,'Physical parameter value');
  if(parameter.step!=null){if(!finite(parameter.step)||parameter.step<=0)throw failure('The physical step must be a positive finite number or null.');step=parameter.step;}
  defaultValue=optionalDefault(parameter.physicalDefault??parameter.range.rawDefault,min,max);
 }else{
  if(parameter.range.normalized!==true||parameter.range.min!==0||parameter.range.max!==1)throw failure('Normalized editing requires the explicitly normalized 0..1 range.');
  min=0;max=1;value=bounded(parameter.value,min,max,'Normalized parameter value');defaultValue=optionalDefault(parameter.default,min,max);
 }
 let source;try{source=structuredClone(parameter);}catch{throw failure('The parameter metadata must be cloneable.');}
 return freeze({id:parameter.id,index:parameter.index,name:parameter.name,targetKind,form:chosen,bodyField:chosen==='physical'?'value':'value_norm',value,min,max,step,defaultValue,unit:parameter.unit??null,valueUnit:chosen==='physical'?parameter.unit??null:'normalized',source});
}

/** Build ONLY fields documented by the parameter setter. No numeric coercion,
 * clamping, step rounding, normalized/physical conversion or metadata copying.
 * Pass the currently scoped raw parameter again, not a cached UI value.
 */
export function pluginParameterWriteBody(parameter,userValue,settings={}){
 options(settings,['targetKind','form','trackId']);
 const {trackId,...controlSettings}=settings,control=pluginParameterControl(parameter,controlSettings);
 const body={[control.bodyField]:bounded(userValue,control.min,control.max,'New parameter value')};
 if(trackId!==undefined){if(typeof trackId!=='string'||!trackId||trackId.length>64)throw failure('The optional engine context trackId must be an exact nonempty string of at most 64 characters.');body.track_id=trackId;}
 return body;
}
