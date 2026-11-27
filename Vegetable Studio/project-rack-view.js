/** Pure rack projection. Pattern-local source records remain authoritative;
 * shared rows are views of explicit bindings, never engine/global setters.
 */
const clone=value=>value==null?value:structuredClone(value),own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=256;
const durable=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value.trim()===value;
const bindingString=value=>typeof value==='string'&&value.length>0&&value.trim()===value;
const sourceId=value=>typeof value==='string'&&value.length>0||typeof value==='number'&&Number.isFinite(value);
const error=(message,code='rack_canonical_required')=>Object.assign(new Error(message),{code});
const compare=(a,b)=>a<b?-1:a>b?1:0;
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(record(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
const key=value=>JSON.stringify(canonical(value));
function complete(value,path=new WeakSet()){
 if(!value||typeof value!=='object')return;
 if(path.has(value))throw error('Reload complete acyclic canonical rack data.');path.add(value);
 for(const [name,child]of Object.entries(value)){
  if((/^_+truncated/i.test(name)||name==='truncated'||/Truncated$/.test(name)||/_truncated$/.test(name))&&marked(child))throw error('Reload complete canonical patterns before projecting the project rack.');
  complete(child,path);
 }path.delete(value);
}
function marked(value,seen=new WeakSet()){if(value===false||value===0||value===''||value==null)return false;if(typeof value!=='object')return true;if(seen.has(value))return true;seen.add(value);const active=Object.values(value).some(child=>marked(child,seen));seen.delete(value);return active;}
/** Two independent 64-bit hashes keep row IDs bounded for RackSelection. Full
 * canonical keys are still compared; a hash collision rejects instead of merging.
 */
function boundedId(namespace,value){
 const text=key(value),mask=(1n<<64n)-1n;let a=14695981039346656037n,b=7809847782465536322n;
 for(let index=0;index<text.length;index++){const code=BigInt(text.charCodeAt(index));a=((a^code)*1099511628211n)&mask;b=((b^code)*14029467366897019727n)&mask;}
 return`${namespace}:${a.toString(16).padStart(16,'0')}${b.toString(16).padStart(16,'0')}`;
}
const extraPluginIdentity=['pluginId','pluginKey','pluginPath','vstPath','instrumentId','pluginIndex'];
function bindingFor(source){
 if(source.kind==='plugin'){
  // The public PatternChannel names a plug-in channel by its instrument lane alone (laneId);
  // instrumentType is an older optional field and only refines the binding when it is present.
  const missing=[];if(!durable(source.laneId))missing.push('laneId');
  if(own(source,'instrumentType')&&source.instrumentType!=null&&(typeof source.instrumentType!=='string'||!source.instrumentType.trim()))missing.push('instrumentType');
  if(missing.length)return{binding:null,missing};
  const binding={kind:'plugin',laneId:source.laneId,...(typeof source.instrumentType==='string'?{instrumentType:source.instrumentType}:{})};
  // Extra explicit plugin identities are compared conservatively. This does not
  // infer dispatch semantics or a new server contract for those optional fields.
  for(const field of extraPluginIdentity)if(own(source,field))binding[field]=clone(source[field]);
  return{binding,missing:[]};
 }
 if(source.kind==='sample'){
  const missing=[];if(!bindingString(source.rackId))missing.push('rackId');if(!bindingString(source.audioFileId))missing.push('audioFileId');
  if(own(source,'sampleRange')&&source.sampleRange!==null&&!record(source.sampleRange))missing.push('sampleRange');
  if(missing.length)return{binding:null,missing};
  const binding={kind:'sample',rackId:source.rackId,audioFileId:source.audioFileId};
  for(const field of ['sourceAudioFileId','sourceTrackId','sampleRange','padOnly'])if(own(source,field))binding[field]=clone(source[field]);
  return{binding,missing:[]};
 }
 return{binding:null,missing:['supported source kind']};
}
const overrideFields=['name','color','order','volume','muted','solo','busId','rootPitch','samplePlaybackMode','sampleReleaseTauSec','viewType','drumpadPads'];
function overrides(source){return Object.fromEntries(overrideFields.filter(field=>own(source,field)).map(field=>[field,clone(source[field])]));}
function canonicalPattern(entry){
 if(!record(entry))throw error('The project contains an incomplete canonical pattern.');
 const raw=entry.cloudRaw??entry,dto=raw?.data?.pattern?raw.data:raw,patternId=entry.cloudId??entry.id??raw.id??dto.id;complete(raw);
 if(!id(patternId)||!record(dto?.pattern)||!Array.isArray(dto.pattern.sources)||!Array.isArray(dto.pattern.events))throw error('Reload each pattern’s complete sources and events before projecting its rack.');
 for(const candidate of [raw.id,dto.id])if(candidate!=null&&String(candidate)!==patternId)throw error('A rack pattern has inconsistent canonical identities.','rack_pattern_identity_conflict');
 const seen=new Set();for(const source of dto.pattern.sources){if(!record(source)||!sourceId(source.id)||typeof source.kind!=='string'||!source.kind||seen.has(String(source.id)))throw error('A pattern contains duplicate or incomplete rack source identities.','rack_membership_ambiguous');seen.add(String(source.id));}
 const eventIds=new Set();for(const event of dto.pattern.events){if(!record(event)||typeof event.type!=='string'||!event.type||!sourceId(event.id)||eventIds.has(String(event.id)))throw error('A pattern contains duplicate or incomplete canonical events.');eventIds.add(String(event.id));}
 return{entry,dto,patternId};
}
function channelFor(project,entry,patternId,nativeId){
 const mapped=record(entry.cloudSources)?Object.entries(entry.cloudSources).filter(([,value])=>String(value)===String(nativeId)).map(([name])=>name):[];
 if(mapped.length>1)throw error('One pattern source maps to multiple UI channels.','rack_membership_ambiguous');
 const channels=Array.isArray(project.channels)?project.channels:[];
 const owned=channels.filter(channel=>{const native=channel.sourceId??channel.cloudSource?.id;return channel.patternSource===true&&String(channel.patternId)===patternId&&native!=null&&String(native)===String(nativeId)&&typeof channel.id==='string'&&channel.id.length>0;});
 if(owned.length>1)throw error('One pattern source has ambiguous UI owners.','rack_membership_ambiguous');
 if(mapped.length){
  const match=channels.filter(channel=>channel.id===mapped[0]);
  if(match.length>1||match.length&&(!owned.length||match[0]!==owned[0]))throw error('A pattern’s UI source mapping belongs to a different source owner.','rack_membership_ambiguous');
  return match.length?mapped[0]:null;
 }
 return owned[0]?.id??null;
}
function addDiagnostic(target,diagnostics,code,details={}){const value={code,...details};target.diagnostics.push(value);diagnostics.push(value);}
/** Resolve only an exact canonical membership. A missing score is explicit and
 * never borrows a sibling source or creates an instrument/template implicitly.
 */
export function resolveRackMembership(row,patternId){
 if(!id(patternId)||!Array.isArray(row?.memberships))return{status:'missing',membership:null};
 const found=row.memberships.filter(member=>member.patternId===patternId);
 if(!found.length)return{status:'missing',membership:null};
 if(found.length!==1)return{status:'ambiguous',membership:null,memberships:clone(found)};
 return{status:'bound',membership:clone(found[0])};
}
export function projectRackView(project){
 const projectId=project?.cloud?.projectId??project?.id;
 if(!durable(projectId)||!Array.isArray(project?.patterns))throw error('The project rack needs an explicit project and complete canonical pattern list.');
 if(project.id!=null&&project.id!==projectId)throw error('The rack project envelope has conflicting identities.','rack_project_identity_conflict');
 complete(project.patterns);
 const patterns=project.patterns.map(canonicalPattern),patternIds=patterns.map(pattern=>pattern.patternId);
 if(new Set(patternIds).size!==patternIds.length)throw error('The rack contains duplicate canonical pattern identities.','rack_membership_ambiguous');
 const currentPatternId=patternIds.includes(project.selectedPattern)?project.selectedPattern:null,groups=new Map(),diagnostics=[],rowKeys=new Map(),memberKeys=new Map();
 function rowFor(groupKey,kind,binding){
  let row=groups.get(groupKey);if(row)return row;
  const rowId=boundedId('project-rack',[projectId,groupKey]);if(rowKeys.has(rowId)&&rowKeys.get(rowId)!==groupKey)throw error('Rack row identity collision; no bindings were merged.','rack_row_id_collision');rowKeys.set(rowId,groupKey);
  row={id:rowId,projectId,kind,binding:clone(binding),memberships:[],diagnostics:[],lane:null};groups.set(groupKey,row);return row;
 }
 for(const {entry,dto,patternId}of patterns){
  for(const source of dto.pattern.sources){
   const {binding,missing}=bindingFor(source),groupKey=key(binding?['binding',binding]:['independent-source',patternId,String(source.id)]),row=rowFor(groupKey,source.kind,binding);
   if(row.memberships.some(member=>member.patternId===patternId))throw error('A pattern has more than one source for the same explicit rack binding.','rack_membership_ambiguous');
   const membershipKey=key([projectId,patternId,String(source.id)]),membershipId=boundedId('rack-membership',membershipKey);
   if(memberKeys.has(membershipId)&&memberKeys.get(membershipId)!==membershipKey)throw error('Rack membership identity collision.','rack_row_id_collision');memberKeys.set(membershipId,membershipKey);
   const member={id:membershipId,projectId,patternId,sourceId:source.id,channelId:channelFor(project,entry,patternId,source.id),source:clone(source),events:clone(dto.pattern.events.filter(event=>event.sourceId!=null&&String(event.sourceId)===String(source.id))),overrides:overrides(source)};
   row.memberships.push(member);
   if(!binding)addDiagnostic(row,diagnostics,'rack_binding_incomplete',{rowId:row.id,patternId,sourceId:source.id,missing});
   if(member.channelId===null)addDiagnostic(row,diagnostics,'rack_ui_binding_missing',{rowId:row.id,patternId,sourceId:source.id});
  }
 }
 const rawLanes=project.cloud?.rawProject?.lanes??project.lanes;
 if(rawLanes!==undefined&&!Array.isArray(rawLanes))throw error('Reload the canonical lane list before projecting unused instruments.');
 const lanes=rawLanes??[],seenLanes=new Set();complete(lanes);
 for(const lane of lanes){
  if(!record(lane)||!durable(lane.id)||seenLanes.has(lane.id))throw error('The project contains ambiguous durable lane identities.','rack_membership_ambiguous');seenLanes.add(lane.id);
  if(lane.kind!=='instrument')continue;
  const matching=[...groups.values()].filter(row=>row.binding?.kind==='plugin'&&row.binding.laneId===lane.id);
  if(matching.length){for(const row of matching)row.lane=clone(lane);continue;}
  const {binding,missing}=bindingFor({...lane,kind:'plugin',laneId:lane.id}),groupKey=key(binding?['binding',binding]:['independent-lane',lane.id]),row=rowFor(groupKey,'plugin',binding);row.lane=clone(lane);
  if(!binding)addDiagnostic(row,diagnostics,'rack_lane_binding_incomplete',{rowId:row.id,laneId:lane.id,missing});
 }
 const rows=[...groups.values()],sameHandle=new Map();
 for(const row of rows){
  row.memberships.sort((a,b)=>compare(key([a.patternId,String(a.sourceId)]),key([b.patternId,String(b.sourceId)])));
  row.current=resolveRackMembership(row,currentPatternId);const current=row.current.membership?.source;
  row.names=[...new Set(row.memberships.map(member=>member.source.name).filter(name=>typeof name==='string'&&name.length))].sort(compare);
  row.orders=[...new Set(row.memberships.map(member=>member.source.order).filter(value=>typeof value==='number'&&Number.isFinite(value)))].sort((a,b)=>a-b);
  row.name=typeof current?.name==='string'?current.name:row.names.length===1?row.names[0]:row.memberships.length===0&&typeof row.lane?.name==='string'?row.lane.name:null;
  row.order=typeof current?.order==='number'&&Number.isFinite(current.order)?current.order:row.orders.length===1?row.orders[0]:null;
  if(row.names.length>1)addDiagnostic(row,diagnostics,'rack_names_differ',{rowId:row.id,names:row.names.slice()});
  if(row.orders.length>1)addDiagnostic(row,diagnostics,'rack_orders_differ',{rowId:row.id,orders:row.orders.slice()});
  row.overrideDifferences=overrideFields.filter(field=>new Set(row.memberships.map(member=>key([own(member.source,field),member.source[field]]))).size>1);
  if(row.overrideDifferences.length)addDiagnostic(row,diagnostics,'rack_pattern_overrides_differ',{rowId:row.id,fields:row.overrideDifferences.slice()});
  const handle=row.binding?.kind==='sample'?key(['sample',row.binding.rackId]):row.binding?.kind==='plugin'?key(['plugin',row.binding.laneId]):null;
  if(handle){if(!sameHandle.has(handle))sameHandle.set(handle,[]);sameHandle.get(handle).push(row);}
 }
 for(const conflicting of sameHandle.values())if(conflicting.length>1){const code=conflicting[0].kind==='sample'?'rack_sample_binding_conflict':'rack_plugin_binding_conflict',rowIds=conflicting.map(row=>row.id).sort(compare);for(const row of conflicting)addDiagnostic(row,diagnostics,code,{rowId:row.id,rowIds});}
 // Only consistent explicit order can serve as a project-level display hint.
 // Current-pattern name/order remain available without changing stable row IDs.
 rows.sort((a,b)=>(a.orders.length===1?a.orders[0]:Infinity)-(b.orders.length===1?b.orders[0]:Infinity)||compare(a.id,b.id));
 return{projectId,patternIds:patternIds.slice(),currentPatternId,rows,diagnostics};
}
