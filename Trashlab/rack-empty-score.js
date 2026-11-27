/** Choose a source configuration for an empty score, never another score's
 * identity or events. Project rack projection remains the binding authority.
 */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.length>0&&value.trim()===value;
const sourceId=value=>text(value)||typeof value==='number'&&Number.isFinite(value);
const clone=value=>structuredClone(value);
const fail=message=>{throw Object.assign(new Error(message),{code:'rack_empty_score_unavailable'});};
const pluginIdentity=['pluginId','pluginKey','pluginPath','vstPath','instrumentId','pluginIndex'];
const sampleIdentity=['sourceAudioFileId','sourceTrackId','sampleRange','padOnly'];
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function canonical(value,path=new Set()){
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(!value||typeof value!=='object'||path.has(value)||!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype)fail('Reload complete canonical channel settings before adding its score.');
 path.add(value);const result=Array.isArray(value)?value.map(item=>canonical(item,path)):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key],path)]));path.delete(value);return result;
}
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function bindingOf(source){
 if(!record(source))fail('This channel needs its original instrument binding before it can be used.');
 let fields;
 if(source.kind==='plugin'){
  if(!text(source.laneId)||source.laneId.length>64||typeof source.instrumentType!=='string'||!source.instrumentType.trim())fail('This channel needs an explicit instrument lane and instrument type.');
  fields=['kind','laneId','instrumentType',...pluginIdentity.filter(key=>own(source,key))];
 }else if(source.kind==='sample'){
  if(!text(source.rackId)||!text(source.audioFileId)||own(source,'sampleRange')&&source.sampleRange!==null&&!record(source.sampleRange))fail('This channel needs its original sample and rack binding.');
  fields=['kind','rackId','audioFileId',...sampleIdentity.filter(key=>own(source,key))];
 }else fail('This channel has no supported explicit instrument binding.');
 return Object.fromEntries(fields.map(key=>[key,clone(source[key])]));
}
function template(row){
 const model=row?.model??row;
 if(!record(model)||!record(model.binding)||!Array.isArray(model.memberships))fail('This channel needs its original instrument binding before it can be used.');
 if(model.current&&model.current.status!=='missing')fail('This channel already has a score or an ambiguous membership in this pattern.');
 if(!Array.isArray(model.diagnostics??[]))fail('Reload the channel binding diagnostics before adding its score.');
 if((model.diagnostics??[]).some(item=>/binding_(?:conflict|incomplete)$/.test(item?.code??'')||item?.code==='rack_membership_ambiguous'))fail('Reload this channel: its instrument binding is incomplete or conflicting.');
 const binding=bindingOf(model.binding);if(!equal(binding,model.binding))fail('Reload this channel: its explicit binding contains unsupported identity fields.');
 if(!model.memberships.length){
  if(binding.kind!=='plugin')fail('Choose channel settings from the channel menu before adding this sample score.');
  if(model.name!=null&&typeof model.name!=='string')fail('Reload the channel name before adding its score.');
  return{...clone(binding),...model.name?{name:model.name}:{}};
 }
 let chosen;const patterns=new Set();
 for(const member of model.memberships){
  if(!record(member)||!text(member.patternId)||patterns.has(member.patternId)||!record(member.source)||!sourceId(member.source.id)||!sourceId(member.sourceId)||String(member.sourceId)!==String(member.source.id)||model.projectId!=null&&member.projectId!=null&&member.projectId!==model.projectId)fail('Reload complete, unambiguous channel memberships before adding its score.');
  patterns.add(member.patternId);if(!equal(bindingOf(member.source),binding))fail('Reload this channel: its source and instrument binding disagree.');
  const {id,...configuration}=member.source;canonical(configuration);
  if(chosen&&!equal(chosen,configuration))fail('Choose channel settings from the channel menu: this channel has different settings in other patterns.');
  chosen=configuration;
 }
 return clone(chosen);
}
/** Detached source configuration without an id; never selects between
 * differing per-pattern overrides, including unknown nested metadata. */
export function emptyRackSourceTemplate(row){try{return{source:template(row)};}catch(error){return{reason:error.message};}}
/** Build a fresh empty-score source. Caller attaches it to a cloned canonical
 * pattern and owns scope/revision guards, event creation and persistence. */
export function emptyRackSource(row,{id}={}){
 if(!text(id)||id.length>256||/[\u0000-\u001f\u007f]/.test(id))fail('A new channel score needs a fresh nonempty source identity.');
 const source=template(row),model=row?.model??row;
 if(model.memberships.some(member=>String(member.source.id)===id))fail('A new channel score must not reuse another pattern’s source identity.');
 return{...source,id};
}
