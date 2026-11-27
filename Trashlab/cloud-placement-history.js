/** Exact single-placement history plans. No I/O or native-history fallback.
 * Recreated placements acquire a new verified server identity. */
import {assertCompleteCanonicalData,serializeCloudPattern,serializeCloudPlacement} from './cloud-session.js';
import {projectAudioMoveHistory,audioMoveTimelineTag} from './cloud-audio-move-history.js';
import {STUDIO_API_OPERATIONS} from './studio-api-client.js';
import {withoutObservedModelState,withoutObservedSavedState} from './cloud-history-observed.js';

const clone=structuredClone,object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>Array.isArray(value)?value.map(stable):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const omit=(value,keys)=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>!keys.includes(key)));
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value),integer=value=>Number.isSafeInteger(value)&&value>=0;
const fail=message=>new Error(message),near=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*1e-12;
const fields=['patternId','laneId','name','startMs','durationMs','loopDurationMs','offsetMs','repeatCount','windowMs','busId','muted','soloed'];
const updated=['updatedAt','updated_at'],created=['createdAt','created_at'];
const readonly=['id','projectId','project_id','createdByUserId','laneName','pattern','notes',...updated,...created];
const creationKeys=new Set([...fields,...readonly,'loopPhaseMs','sourceBusOverrides','displayOrder','deleted']);
const aliases=new WeakSet();
const aliasPhasePolicies=new WeakMap();
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const joinedPattern=raw=>object(raw.pattern)&&raw.pattern.id===raw.patternId;
const writeFields=phaseWritable=>{if(typeof phaseWritable!=='boolean')throw fail('Placement phase writing needs an explicit boolean policy.');return phaseWritable?[...fields,'loopPhaseMs']:fields;};
function validatePhase(raw){const unit=raw.loopDurationMs??raw.durationMs;if(!integer(raw.loopPhaseMs)||!Number.isSafeInteger(unit)||unit<1||raw.loopPhaseMs>=unit)throw fail('Placement phase must be integer milliseconds inside its loop unit.');}
/** Local generated-schema proof only; callers must additionally select REST. */
export function placementPhaseWritable(operationId,operations=STUDIO_API_OPERATIONS){
 const method=operationId==='createPatternPlacement'?'POST':operationId==='updatePatternPlacement'?'PATCH':null,operation=operations?.[operationId],phase=operation?.requestBody?.content?.['application/json']?.schema?.properties?.placement?.properties?.loopPhaseMs;
 return !!method&&operation?.method===method&&operation.mutates===true&&phase?.type==='integer'&&phase.minimum===0&&phase.readOnly!==true&&phase['x-inferred']!==true&&!['maximum','exclusiveMaximum','exclusiveMinimum','enum','const','oneOf','anyOf','allOf','$ref'].some(key=>Object.hasOwn(phase,key))&&(phase.multipleOf===undefined||phase.multipleOf===1);
}

function scalar(key,value){
 if(['patternId','laneId','busId'].includes(key)){if(!id(value))throw fail('Placement history needs an explicit '+key+'.');}
 else if(key==='name'){if(typeof value!=='string'||value.length>255)throw fail('Placement history needs a documented placement name.');}
 else if(['muted','soloed'].includes(key)){if(typeof value!=='boolean')throw fail('Placement history needs an explicit '+key+' state.');}
 else if(!integer(value)||!['startMs','offsetMs','loopPhaseMs'].includes(key)&&value<1)throw fail('Placement history cannot send '+key+' outside its integer millisecond contract.');
 return value;
}
function document(raw,{saved=true}={}){
 assertCompleteCanonicalData(raw,'placement history source');
 if(!object(raw)||saved&&!id(raw.id)||!id(raw.patternId)||!id(raw.laneId)||!id(raw.busId)||raw.deleted===true)throw fail('Reload the placement’s exact saved identity and routing before history.');
 for(const key of ['startMs','durationMs','loopDurationMs','offsetMs','repeatCount','loopPhaseMs'])if(!finite(raw[key])||raw[key]<0||['durationMs','loopDurationMs','repeatCount'].includes(key)&&raw[key]<=0)throw fail('Reload complete placement timing and phase before history.');
 if(!Object.hasOwn(raw,'windowMs')||raw.windowMs!==null&&(!finite(raw.windowMs)||raw.windowMs<=0)||!object(raw.sourceBusOverrides)||typeof raw.muted!=='boolean'||typeof raw.soloed!=='boolean')throw fail('Reload the placement’s complete window, source routing and mute state before history.');
 const savedDocument=clone(omit(raw,updated));
 // The API may join the shared pattern DTO into each placement. Its own edit
 // timestamps advance when the retained pattern inverse restores the score;
 // source content and all other joined metadata remain exact guards.
 if(object(savedDocument.pattern))savedDocument.pattern=omit(savedDocument.pattern,updated);
 // laneName is a server join that does not follow a lane move (live: a drums
 // placement PATCHed onto the Keys lane still reads laneName "Vegetable drums").
 // laneId remains the exact guard; the joined label is presentation only.
 delete savedDocument.laneName;
 // notes are derived per read from the joined pattern's midi events (ms at the
 // project tempo); the joined pattern above remains the exact score guard.
 delete savedDocument.notes;
 return savedDocument;
}
function side(raw,{saved=true}={}){return{placementId:saved?raw.id:null,canonical:clone(raw),document:document(raw,{saved}),write:Object.fromEntries(fields.filter(key=>Object.hasOwn(raw,key)).map(key=>[key,clone(raw[key])]))};}
function validatedSide(value){const next=side(value?.canonical);if(value.placementId!==next.placementId||!same(value.document,next.document)||!same(value.write,next.write))throw fail('Use an unchanged retained canonical placement history side.');return next;}
function collection(project){
 if(!Array.isArray(project?.clips))throw fail('Reload the complete Playlist before retaining placement history.');
 const ids=new Set();for(const clip of project.clips){if(!id(clip?.id)||ids.has(clip.id))throw fail('Reload unique Playlist placement identities.');ids.add(clip.id);}return project.clips;
}
export function placementHistorySide(project,placementId){
 const matches=collection(project).filter(clip=>clip.cloudId===placementId);if(matches.length!==1)throw fail('Reload one uniquely identified saved placement before history.');
 const clip=matches[0],raw=clip.cloudRaw,serialized=serializeCloudPlacement(clip,project),result=side(raw),bpm=project.bpm;
 if(['projectId','project_id'].some(key=>raw[key]!==undefined&&raw[key]!==project.cloud?.projectId))throw fail('The saved placement belongs to another project.');
 if(result.placementId!==placementId||!finite(bpm)||bpm<=0||clip.patternId!==raw.patternId&&!project.patterns?.some(pattern=>pattern.id===clip.patternId&&pattern.cloudId===raw.patternId)||clip.laneId!==raw.laneId||!near(clip.start*60000/bpm,raw.startMs)||!near(clip.length*60000/bpm,raw.windowMs??Math.max(1,raw.durationMs*raw.repeatCount-raw.offsetMs))||serialized.laneId!==raw.laneId)throw fail('The displayed placement differs from its saved source, lane or timing.');
 return result;
}
export const placementHistoryEqual=(a,b)=>!!a&&!!b&&a.placementId===b.placementId&&same(a.document,b.document);
export function placementProtectedProject(project,placementId){
 const raw=project?.cloud?.rawProject;if(!object(raw)||!Array.isArray(raw.placements))throw fail('Read the complete saved project before placement history.');
 assertCompleteCanonicalData(raw,'placement history project');
 const excluded=Array.isArray(placementId)?placementId:placementId==null?[]:[placementId];if(excluded.some(value=>!id(value))||new Set(excluded).size!==excluded.length)throw fail('Protect uniquely identified saved placements.');
 // Row order carries no saved meaning (rows have their own lane/start/
 // displayOrder): a split receipt appends its child while a fresh read lists
 // placements by start time. Compare the identified rows, not read order.
 const placements=raw.placements.filter(row=>!excluded.includes(row.id)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),protectedProject={...omit(withoutObservedSavedState(raw),['_studioApi','timelineRevision',...updated]),placements};
 if(Object.hasOwn(raw,'counts')){
  if(!object(raw.counts))throw fail('Read complete, consistent saved project counts before placement history.');
  for(const key of ['clips','lanes','patterns','placements']){
   const rows=raw[key],count=raw.counts[key];
   if(!Object.hasOwn(raw.counts,key)||!integer(count)||!Array.isArray(rows)||count!==rows.length||rows.some(row=>!object(row)||!id(row.id))||new Set(rows.map(row=>row.id)).size!==rows.length)throw fail('Read complete, consistent saved '+key+' counts before placement history.');
  }
  // The protected placement collection excludes this gesture's target. Its
  // derived count must describe that same collection, rather than treating a
  // legitimate create/delete count change as an unrelated project mutation.
  protectedProject.counts={...raw.counts,placements:placements.length};
 }
 return clone(protectedProject);
}
/** Only known, round-trippable creates can be recreated; phase is opt-in. Unwritable
 * metadata is never dropped or approximated to make a placement redoable. */
export function placementCreationBody(value,{intent=false,phaseWritable=false}={}){
 const writable=writeFields(phaseWritable);
 const raw=value?.canonical??value;document(raw,{saved:id(raw?.id)});
 if(intent&&id(raw.id)||Object.keys(raw).some(key=>!creationKeys.has(key))||!phaseWritable&&raw.loopPhaseMs!==0||Object.keys(raw.sourceBusOverrides).length||raw.displayOrder!==undefined&&(!integer(raw.displayOrder)||raw.displayOrder>1000000)||raw.deleted!==undefined&&raw.deleted!==false)throw fail('This placement has phase, routing or metadata outside the exact creation contract.');
 if(phaseWritable)validatePhase(raw);
 const body={};for(const key of writable){if(key==='windowMs'&&raw[key]===null)continue;body[key]=scalar(key,raw[key]);}
 // displayOrder (Timeline row order) is a declared createPatternPlacement field
 // since the 2026-11-11 contract: a recreation restores the saved row exactly
 // (0 is the stored default for an omitted order, so it is not sent).
 if(raw.displayOrder)body.displayOrder=raw.displayOrder;return body;
}
export function placementCreationEqual(wanted,actual,{phaseWritable=false}={}){
 try{return same(placementCreationBody(wanted,{phaseWritable}),placementCreationBody(validatedSide(actual),{phaseWritable}));}catch{return false;}
}
/** A newly created row may gain server-owned metadata. Signed restoration
 * retains that entire confirmed row; older recreation still uses its strict gate. */
export function placementRestorableCreationEqual(wanted,actual,{phaseWritable=false}={}){
 try{placementCreationBody(wanted,{phaseWritable});const after=validatedSide(actual),before=wanted.canonical??wanted;return[...fields,'loopPhaseMs','sourceBusOverrides'].every(key=>same(before[key],after.canonical[key]));}catch{return false;}
}
export function placementHistoryArguments(operation,desired,expected,{phaseWritable=false}={}){
 const writable=writeFields(phaseWritable);
 if(operation==='create')return{placement:placementCreationBody(desired,{phaseWritable})};
 const target=validatedSide(operation==='delete'?desired:expected);
 if(operation==='delete')return{placement_id:target.placementId};
 if(operation!=='update')throw fail('Placement history supports only its retained create, update or recreatable placement deletion.');
 const next=validatedSide(desired);if(next.placementId!==target.placementId||next.canonical.patternId!==target.canonical.patternId)throw fail('Placement history cannot retarget a different saved pattern or placement.');
 const changed=writable.filter(key=>!same(next.canonical[key],target.canonical[key]));
 if(!changed.length||changed.includes('patternId')||!same(omit(next.document,[...writable,'laneName']),omit(target.document,[...writable,'laneName'])))throw fail('Placement history cannot replace source phase or undocumented metadata.');
 if(phaseWritable&&changed.some(key=>['loopPhaseMs','loopDurationMs','durationMs'].includes(key)))validatePhase(next.canonical);
 // Omitting busId resets it to master in the published PATCH contract.
 const placement={busId:scalar('busId',next.canonical.busId)};
 // PATCH windowMs is integer-or-null: an explicit null clears the trim window,
 // so Undo of a first trim restores the exact originally unset window.
 for(const key of changed)placement[key]=key==='windowMs'&&next.canonical[key]===null?null:scalar(key,next.canonical[key]);
 return{placement_id:target.placementId,placement};
}
function authoredProject(project){
 // Rack-step Piano notes and their ownership tracker are editable projections.
 // Compare the exact canonical source plus serialized score, not those views.
 return{...omit(withoutObservedModelState(project),['clips','selectedPattern','cloud','loop','patterns']),patterns:project.patterns.map(pattern=>({id:pattern.id,cloudId:pattern.cloudId,raw:pattern.cloudRaw,score:serializeCloudPattern(pattern,project)}))};
}
export function capturePlacementHistory(before,next,{allowRestore=false,phaseWritable=false}={}){
 try{
  const writable=writeFields(phaseWritable);
  if(!same(authoredProject(before),authoredProject(next))||before.cloud?.projectId!==next.cloud?.projectId||before.cloud?.trackId!==next.cloud?.trackId||!same(before.cloud?.timelineLaneIds,next.cloud?.timelineLaneIds))return null;
  const a=collection(before),b=collection(next),byId=new Map(a.map(clip=>[clip.id,clip]));
  const removed=a.filter(clip=>!b.some(row=>row.id===clip.id));
  if(removed.length){
   // Match the existing PlaylistClone selection bound; replay remains an
   // individually acknowledged sequence, never an atomic backend group.
   if(removed.length>256||a.length!==b.length+removed.length||b.some(clip=>!byId.has(clip.id)||!same(clip,byId.get(clip.id))))return null;
   if(removed.length>1){const members=removed.map(clip=>{const previous=placementHistorySide(before,clip.cloudId);if(!allowRestore)placementCreationBody(previous,{phaseWritable});return{placementId:previous.placementId,logicalKey:previous.placementId,before:previous};});return{kind:'placement',operation:'delete',placementId:null,members,before:null,wanted:null,fields:[],protected:placementProtectedProject(before,members.map(member=>member.placementId))};}
   const previous=placementHistorySide(before,removed[0].cloudId);if(!allowRestore)placementCreationBody(previous,{phaseWritable});
   return{kind:'placement',operation:'delete',placementId:previous.placementId,logicalKey:previous.placementId,before:previous,wanted:null,fields:[],protected:placementProtectedProject(before,previous.placementId)};
  }
  const added=b.filter(clip=>!byId.has(clip.id));
  if(added.length){
   if(added.length>256||b.some(clip=>byId.has(clip.id)&&!same(clip,byId.get(clip.id))))return null;
   const intent=clip=>{
    if(clip.cloudId||clip.cloudRaw?.id||!Number.isInteger(clip.track)||clip.track<0||clip.cloudRaw&&(Object.keys(clip.cloudRaw).some(key=>!creationKeys.has(key))||clip.cloudRaw.displayOrder!==undefined&&!integer(clip.cloudRaw.displayOrder)))return null;
    // A new intent's displayOrder is the row it was drawn/duplicated on; the REST
    // create saves it (declared since 2026-11-11), so the confirmed row must match.
    const raw=serializeCloudPlacement(clip,next),lanes=before.cloud?.rawProject?.lanes;
    if(!Array.isArray(lanes)||lanes.filter(lane=>lane.id===raw.laneId).length!==1||!before.patterns.some(pattern=>(pattern.cloudId||pattern.id)===raw.patternId))return null;
    const wanted=side(raw,{saved:false});placementCreationBody(wanted,{phaseWritable});return wanted;
   };
   const wanted=added.map(intent);if(wanted.some(value=>!value))return null;
   if(added.length===1)return{kind:'placement',operation:'create',placementId:null,logicalKey:added[0].id,before:null,wanted:wanted[0],fields:[],protected:placementProtectedProject(before,null)};
   // FL: one Paint stroke / multi-clip Paste or Clone is ONE Undo step. Each
   // created placement is still its own acknowledged create, confirmed exactly.
   return{kind:'placement',operation:'create',placementId:null,members:added.map((clip,index)=>({placementId:null,logicalKey:clip.id,wanted:wanted[index]})),before:null,wanted:null,fields:[],protected:placementProtectedProject(before,null)};
  }
  if(a.length!==b.length)return null;let plan=null;
  for(const clip of b){
   const old=byId.get(clip.id);if(same(old,clip))continue;if(plan||!same(omit(old,['start','length','track','laneId','name','cloudRaw']),omit(clip,['start','length','track','laneId','name','cloudRaw'])))return null;
   const previous=placementHistorySide(before,old.cloudId),oldDto=serializeCloudPlacement(old,before),dto=serializeCloudPlacement(clip,next);
   if(!same(omit(old.cloudRaw,[...writable,'laneName']),omit(clip.cloudRaw,[...writable,'laneName']))||dto.patternId!==oldDto.patternId||!phaseWritable&&dto.loopPhaseMs!==oldDto.loopPhaseMs||!same(dto.sourceBusOverrides,oldDto.sourceBusOverrides))return null;
   const canonical=clone(previous.canonical),changed=writable.filter(key=>!same(dto[key],oldDto[key]));
   if(!changed.length)return null;for(const key of changed)canonical[key]=clone(dto[key]);
   if(changed.includes('laneId')){const lanes=before.cloud?.rawProject?.lanes,matches=lanes?.filter(lane=>lane.id===canonical.laneId);if(matches?.length!==1)return null;if(Object.hasOwn(canonical,'laneName'))canonical.laneName=matches[0].name??null;}
   const wanted=side(canonical);placementHistoryArguments('update',wanted,previous,{phaseWritable});placementHistoryArguments('update',previous,wanted,{phaseWritable});
   plan={kind:'placement',operation:'update',placementId:old.cloudId,logicalKey:old.cloudId,before:previous,wanted,fields:changed,protected:placementProtectedProject(before,old.cloudId)};
  }return plan;
 }catch{return null;}
}
export const placementTimelineTag=audioMoveTimelineTag;
export function projectPlacementHistory(engine,body,scope){
 if(body?.id!==scope.projectId||['projectId','project_id'].some(key=>body?.[key]!==undefined&&body[key]!==scope.projectId))throw fail('Placement history read belongs to another project.');
 const projected=projectAudioMoveHistory(engine,body,scope);
 for(const raw of body.placements){document(raw);if(['projectId','project_id'].some(key=>raw[key]!==undefined&&raw[key]!==scope.projectId)||body.lanes.filter(lane=>lane.id===raw.laneId).length!==1||body.patterns.filter(pattern=>pattern.id===raw.patternId).length!==1)throw fail('Placement history has an incomplete or foreign source/lane binding.');}
 return projected;
}
export function placementReceiptId(result,{projectId,operationId,expectedId}={}){
 if(!id(projectId)||!['createPatternPlacement','updatePatternPlacement','deletePatternPlacement'].includes(operationId)||expectedId!==undefined&&!id(expectedId))throw fail('Retain a dedicated scoped placement operation receipt.');
 if(result?.isError)throw fail('Freestyle rejected this placement operation.');
 assertCompleteCanonicalData(result,'placement operation receipt');const ids=[],seen=new Set();let value=result?.structuredContent??result,acknowledged=false;
 for(let depth=0;depth<8&&object(value)&&!seen.has(value);depth++){
  seen.add(value);if(value.ok===false||value.error||value.isError||['projectId','project_id'].some(key=>value[key]!==undefined&&value[key]!==projectId))throw fail('Freestyle did not acknowledge this project’s placement operation.');
  acknowledged||=value.ok===true;
  for(const candidate of [value.placement?.id,value.placementId,value.placement_id,value.id])if(candidate!==undefined){if(!id(candidate))throw fail('Freestyle returned an invalid placement identity.');ids.push(candidate);}
  value=value.response;
 }
 const unique=[...new Set(ids)];if(unique.length>1||unique.length===1&&expectedId!==undefined&&unique[0]!==expectedId||!unique.length&&(!acknowledged||expectedId===undefined))throw fail('Freestyle has not returned one unambiguous placement identity.');
 return unique[0]??expectedId;
}
/** A proof object prevents arbitrary string substitution across a journal. */
export function placementHistoryAlias(original,recreated,{phaseWritable=false}={}){
 const a=validatedSide(original),b=validatedSide(recreated);placementCreationBody(a,{phaseWritable});placementCreationBody(b,{phaseWritable});
 if(a.placementId===b.placementId||!same(omit(a.document,['id',...created]),omit(b.document,['id',...created])))throw fail('The recreated placement has not confirmed the original exact source, geometry and metadata.');
 const proof=freeze({fromId:a.placementId,toId:b.placementId,original:clone(a),recreated:clone(b)});aliases.add(proof);aliasPhasePolicies.set(proof,phaseWritable);return proof;
}
export function rebindPlacementHistorySide(value,alias,{phaseWritable=false}={}){
 const writable=writeFields(phaseWritable);
 if(!aliases.has(alias))throw fail('Rebind only through a verified canonical placement alias.');const original=validatedSide(value);
 if(aliasPhasePolicies.get(alias)&&!phaseWritable)throw fail('Rebind a phase-aware alias only with its explicit phase-write policy.');
 if(phaseWritable)validatePhase(original.canonical);
 // Shared pattern history may lie between creation and a later placement edit.
 // Keep that later side's joined score verbatim; it will be checked against the
 // actual source again at replay. Phase may differ only under the explicit
 // typed-write policy; source routing and opaque metadata remain protected.
 const joined=joinedPattern(original.canonical)&&joinedPattern(alias.original.canonical)?['pattern','notes']:[];
 if(original.placementId!==alias.fromId||original.canonical.patternId!==alias.original.canonical.patternId||!same(omit(original.document,['id',...writable,'laneName',...created,...joined]),omit(alias.original.document,['id',...writable,'laneName',...created,...joined])))throw fail('The journal side does not belong to this recreated placement source.');
 const raw=clone(original.canonical);raw.id=alias.toId;for(const key of created){if(Object.hasOwn(alias.recreated.canonical,key))raw[key]=clone(alias.recreated.canonical[key]);else delete raw[key];}return side(raw);
}
