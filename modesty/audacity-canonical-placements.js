import {assertCompleteCanonicalData} from './cloud-session.js';
import {assertAutomationJsonValue} from './audacity-automation-contract.js';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const id=value=>typeof value==='string'&&value.length>0;
const sameProject=(row,projectId)=>['projectId','project_id'].every(field=>row[field]===undefined||row[field]===projectId);
const invalid=detail=>{throw new Error('Contradictory complete canonical placement checkpoint: '+detail+'.');};
/** get_project may already carry the full placement list. Only explicit
 * nontruncation plus an exact safe-integer count proves completeness. Missing
 * proof returns null so callers retain the authoritative list fallback.
 * Explicit complete claims that contradict their data fail before a mutation.
 * No DTO is normalized, copied, sorted, rounded or stripped here.
 */
export function completeCanonicalPlacements(project,projectId){
 if(!project||typeof project!=='object'||Array.isArray(project))return null;
 const complete=project.truncated===false||project.truncated?.placements===false;
 if(!complete||!Array.isArray(project.placements)||project.counts?.placements===undefined||project.id===undefined||!Array.isArray(project.lanes))return null;
 assertAutomationJsonValue(project);assertCompleteCanonicalData(project,'canonical project placement checkpoint');
 if(!id(projectId)||project.id!==projectId||!sameProject(project,projectId))invalid('project identity differs');
 const count=project.counts.placements;if(!Number.isSafeInteger(count)||count<0)invalid('placement count is not a nonnegative safe integer');
 if(count!==project.placements.length)invalid('placement count differs from the complete array');
 const lanes=new Set();for(const lane of project.lanes){if(!lane||!id(lane.id)||lanes.has(lane.id)||!sameProject(lane,projectId))invalid('canonical lane identity is missing, duplicated or foreign');lanes.add(lane.id);}
 const ids=new Set();for(const row of project.placements){
  if(!row||!id(row.id)||ids.has(row.id)||!id(row.patternId)||!id(row.laneId)||!lanes.has(row.laneId)||!sameProject(row,projectId))invalid('placement identity is missing, duplicated or outside the project lanes');ids.add(row.id);
 }
 for(const row of project.placements){
  // A complete list may still consist of summary DTOs. Missing fields require
  // the existing canonical read, rather than fabricated defaults.
  if(!['startMs','durationMs','loopDurationMs','repeatCount','offsetMs','loopPhaseMs','windowMs','sourceBusOverrides'].every(field=>Object.hasOwn(row,field)))return null;
  if(!['startMs','durationMs','loopDurationMs','repeatCount','offsetMs','loopPhaseMs'].every(field=>finite(row[field]))||row.startMs<0||row.durationMs<=0||row.loopDurationMs<=0||row.repeatCount<1||row.offsetMs<0||row.loopPhaseMs<0||row.windowMs!==null&&(!finite(row.windowMs)||row.windowMs<=0)||!row.sourceBusOverrides||typeof row.sourceBusOverrides!=='object'||Array.isArray(row.sourceBusOverrides))invalid('placement timing or source routing is invalid');
 }
 return project.placements;
}
