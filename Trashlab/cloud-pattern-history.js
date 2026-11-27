import {captureAudioMoveHistory,audioMoveProtectedProject,audioMoveSide,audioMoveEqual,audioMoveInverse,audioMoveArguments,audioMoveTimelineTag,projectAudioMoveHistory} from './cloud-audio-move-history.js';
import {assertCompletePattern,assertCompleteCanonicalData,serializeCloudPattern,normalizeCloudProject} from './cloud-session.js';
import {audioHistorySide,captureAudioHistory,audioHistoryArguments,audioGeometryEqual,audioHistoryFingerprint,projectAudioHistory} from './cloud-audio-history.js';
import {capturePlacementHistory,placementHistorySide,placementHistoryEqual,placementProtectedProject,placementCreationBody,placementCreationEqual,placementRestorableCreationEqual,placementHistoryArguments,placementTimelineTag,projectPlacementHistory,placementReceiptId,placementHistoryAlias,rebindPlacementHistorySide} from './cloud-placement-history.js';
import {rebindPlaylistCloneAudioSide} from './playlist-clone.js';
import {capturePlaylistMove,confirmPlaylistMove,executePlaylistMove,playlistMoveProtected} from './cloud-playlist-move.js';
import {placementRestoreArguments,validatePlacementRestore,redactPlacementRestoreSecrets} from './cloud-placement-restore.js';
import {clientLog} from './client-diagnostics.js';
import {withoutObservedModelState,withoutObservedChannel,withoutObservedSavedState} from './cloud-history-observed.js';
const signedPlacementUndo=new WeakMap();
// 338 placement batches: each journal entry's signed inverse ops (Undo) and,
// once undone, the inverse's own inverse (Redo). Never exposed in snapshots.
const placementBatchUndo=new WeakMap();
// An FL erase across pattern and audio clips (one right-drag): ONE step holding the
// placement batch's inverse and the audio clips' clips:batch inverse.
const mixedDeleteUndo=new WeakMap();
const clipBatchBody=raw=>{let data=raw?.structuredContent??raw;for(let depth=0;depth<4&&data&&typeof data==='object';depth++){if(Array.isArray(data.undo?.inverse_ops))return data;data=data.response??data.result??data.data;}return null;};
const BATCH_FIELDS=['patternId','laneId','name','startMs','durationMs','loopDurationMs','offsetMs','repeatCount','windowMs','busId','muted','soloed','loopPhaseMs','sourceBusOverrides'];
const batchRowEqual=(a,b)=>!!a&&!!b&&BATCH_FIELDS.every(key=>same(a[key]??null,b[key]??null));

const clone=value=>value==null?value:structuredClone(value);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>Array.isArray(value)?value.map(stable):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const id=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value.trim()===value;
const failure=(message,code='pattern_history_conflict',fields={})=>Object.assign(new Error(message),{code,...fields});
// History never waits indefinitely on unrelated queued work or a stalled read.
// Reads are side-effect free: a REST snapshot conflict (HTTP 409 while a
// concurrent saved write lands) is re-read a bounded number of times. Writes
// are never retried or abandoned by a timer; their receipts decide certainty.
const HISTORY_QUEUE_MS=15000,HISTORY_READ_MS=20000,HISTORY_READ_ATTEMPTS=3;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function bounded(promise,ms,message){let timer;return Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure(message,'pattern_history_timeout',{historyTransient:true})),ms);})]).finally(()=>clearTimeout(timer));}
const readConflict=error=>error?.status===409||error?.code==='studio_api_snapshot_conflict';
// A not-sent attempt that failed only on a transient read or queue wait leaves
// the saved project untouched; the entry remains available to try again.
const keepsJournal=(record,error)=>record?.attempted!==true&&error?.historyTransient===true;
// Real-browser diagnostics: reason codes and the exact differing field paths
// (small values only), never whole projects, tokens or audio.
function driftPaths(a,b,limit=25){const out=[];const small=value=>{const text=JSON.stringify(value);return text===undefined?'<missing>':text.length>80?text.slice(0,77)+'...':text;};const walk=(x,y,path)=>{if(out.length>=limit||JSON.stringify(stable(x))===JSON.stringify(stable(y)))return;if(x&&y&&typeof x==='object'&&typeof y==='object'&&Array.isArray(x)===Array.isArray(y)){for(const key of new Set([...Object.keys(x),...Object.keys(y)]))walk(x[key],y[key],path+'/'+key);return;}out.push({path,before:small(x),after:small(y)});};walk(a,b,'');return out;}
function historyLog(kind,data){try{clientLog(kind,data);}catch{}}
/** Freestyle cascades a lane's mute/solo onto that lane's pattern placements
 * (cloudRaw.muted / soloed, plus updatedAt). A mixer step declares those
 * cascades; a drift made only of them (exact lane, field and value) is the
 * step's own echo, not an outside edit. Anything else still invalidates. */
const CASCADE_TTL_MS=20000,OWNED_AUDIO_TTL_MS=60000;
/** Only the audio clip list (and the saved clip count) differs. */
function audioOnlyDrift(baseline,next){
 const strip=value=>{const copy=clone(value);if(copy?.outside)delete copy.outside.audioClips;if(copy?.savedMetadata?.counts&&typeof copy.savedMetadata.counts==='object')delete copy.savedMetadata.counts.clips;return copy;};
 try{return same(strip(baseline),strip(next));}catch{return false;}
}
function cascadeOnly(baseline,next,expectations,now=Date.now()){
 const active=(expectations||[]).filter(item=>item.until>=now);if(!active.length||!baseline||!next)return false;
 const paths=driftPaths(baseline,next,1000);if(!paths.length||paths.length>=1000)return false;
 for(const {path}of paths){
  const match=/^\/outside\/clips\/(\d+)\/cloudRaw\/(muted|soloed|solo|updatedAt|updated_at)$/.exec(path);if(!match)return false;
  const index=Number(match[1]),field=match[2],before=baseline.outside?.clips?.[index]?.cloudRaw,after=next.outside?.clips?.[index]?.cloudRaw;
  if(!object(before)||!object(after)||(before.id??null)!==(after.id??null)||before.laneId!==after.laneId)return false;
  const lane=active.filter(item=>item.laneId===after.laneId);if(!lane.length)return false;
  if(field==='updatedAt'||field==='updated_at')continue;
  const wanted=field==='muted'?'muted':'soloed';if(!lane.some(item=>item.field===wanted&&item.value===after[field]))return false;
 }
 return true;
}
/** A client guard refused BEFORE anything was sent (busy workspace, changed scope): nothing was applied.
 * Studio API errors wrap such a refusal as `cause` (dispatched:true, status 0) — look through them. */
export function refusedBeforeSend(error){for(let item=error,depth=0;item&&depth<4;item=item.cause,depth++)if(item.dispatched===false||item.historyNotApplied===true)return true;return false;}
const creationLabels=Object.freeze({audio_import:'audio import',lane_create:'track creation'});
/** Creation sources with their own history label (the step kind stays the proven creation kind). */
const creationSources=Object.freeze({recording:'Record'});
function creationLabel(kind){if(!Object.hasOwn(creationLabels,kind))throw failure('Choose a supported retained creation history kind.');return creationLabels[kind];}
const identity=pattern=>pattern?.cloudId??pattern?.id;
// FL hint-bar labels name what the step did, not just its storage kind.
const plural=(count,one,many)=>count===1?one:many;
const patternEvents=side=>{const value=side?.serialized??side;const rows=value?.pattern?.events??value?.events;return Array.isArray(rows)?rows:[];};
/** "Add note", "Move notes", "Resize note", "Change velocity", "Delete steps"… for one pattern score edit. */
export function patternEditLabel(before,after){
 const a=new Map(patternEvents(before).map(event=>[event.id,event])),b=new Map(patternEvents(after).map(event=>[event.id,event]));
 const added=[...b.keys()].filter(key=>!a.has(key)),removed=[...a.keys()].filter(key=>!b.has(key)),changed=[...b.keys()].filter(key=>a.has(key)&&!same(a.get(key),b.get(key)));
 const touched=[...added.map(key=>b.get(key)),...removed.map(key=>a.get(key)),...changed.map(key=>b.get(key))];if(!touched.length){const length=side=>{const value=side?.serialized??side;return[value?.bars,value?.lengthTicks];};return same(length(before),length(after))?'Pattern edit':'Pattern length';}
 const steps=touched.every(event=>event?.type==='sample'),noun=count=>steps?plural(count,'step','steps'):plural(count,'note','notes');
 if(added.length&&!removed.length&&!changed.length)return`Add ${noun(added.length)}`;
 // Rack: clearing a channel (Backspace) and removing lit steps read the same,
 // whatever the count, matching the rack clipboard's "Delete steps" (round 10).
 if(removed.length&&!added.length&&!changed.length)return steps?'Delete steps':`Delete ${noun(removed.length)}`;
 if(!added.length&&!removed.length){const fields=new Set();for(const key of changed){const x=a.get(key),y=b.get(key);for(const field of new Set([...Object.keys(x),...Object.keys(y)]))if(!same(x[field],y[field]))fields.add(field);}
  const only=list=>[...fields].every(field=>list.includes(field));
  if(only(['velocity']))return'Change velocity';
  // FL Mute (T) / Slide (S) tools: the PatternNote muted / slide flags.
  if(only(['muted'])){const on=changed.every(key=>b.get(key).muted===true);return`${on?'Mute':'Unmute'} ${noun(changed.length)}`;}
  if(only(['slide'])){const on=changed.every(key=>b.get(key).slide===true);return`${on?'Slide':'Unslide'} ${noun(changed.length)}`;}
  if(only(['durationTick','duration','durationTicks','lengthTick']))return`Resize ${noun(changed.length)}`;
  if(only(['startTick','tick','note','pitch','start']))return`Move ${noun(changed.length)}`;}
 if(added.length===removed.length&&!changed.length)return`Move ${noun(added.length)}`;
 return steps?'Edit steps':'Edit notes';
}
const SIZE_FIELDS=['durationMs','windowMs','offsetMs','repeatCount','loopDurationMs','loopPhaseMs'];
/** "Move pattern clip" / "Resize pattern clip" / "Mute pattern clip" for one placement update. */
export function placementEditLabel(before,after){
 const x=before?.canonical??before,y=after?.canonical??after;if(!x||!y)return'Edit pattern clip';const diff=field=>!same(x[field],y[field]);
 if(SIZE_FIELDS.some(diff))return'Resize pattern clip';if(diff('startMs')||diff('laneId'))return'Move pattern clip';if(diff('muted'))return y.muted?'Mute pattern clip':'Unmute pattern clip';return'Edit pattern clip';
}
/** The saved name of one lane (track) in a normalized project. */
const savedLaneName=(project,laneId)=>{const lanes=(project?.cloud?.rawProject?.lanes||[]).filter(lane=>lane?.id===laneId);return lanes.length===1&&typeof lanes[0].name==='string'?lanes[0].name:undefined;};
function target(project,patternId){const matches=(project?.patterns||[]).filter(pattern=>identity(pattern)===patternId);if(matches.length!==1)throw failure('Reload the uniquely identified saved pattern before using its history.');return matches[0];}
function side(project,patternId){const pattern=target(project,patternId),canonical=clone(assertCompletePattern(pattern));if(canonical.id!==undefined&&canonical.id!==patternId)throw failure('The canonical pattern identifies a different saved pattern.');const serialized=serializeCloudPattern(pattern,project);return{serialized:clone(serialized),canonical,payload:{...canonical,...clone(serialized),pattern:clone(canonical.pattern)}};}
// Model.loop follows observed transport state. The saved loop region remains
// protected in rawProject metadata; clock observations are not authored edits.
function historyChannel(channel,project){
 const {engineTrackId,...retained}=channel,state=project.cloud?.rawState;
 if(state?.studioApi!==true)return retained;
 const lanes=(project.cloud?.rawProject?.lanes||[]).filter(lane=>lane.id===channel.id&&lane.id===channel.laneId&&lane.id===channel.cloudRaw?.id);
 if(lanes.length!==1)return retained;
 const lane=lanes[0],rows=Array.isArray(state.tracks?.tracks)?state.tracks.tracks:[],tracks=state.nativeMixerStateAvailable===true&&state.tracks?.live===true&&state.tracks?.runtime_ids_available===true?rows.filter(track=>Number.isSafeInteger(track?.id)&&track.id>=0&&rows.filter(other=>other.id===track.id).length===1):[],matches=tracks.filter(track=>track.db_track_id!=null&&String(track.db_track_id)===String(lane.id)),live=matches.length===1?matches[0]:{},projection=live.plugins||lane.pluginChain,expected=Array.isArray(projection)?projection:[];
 // normalizeCloudProject overlays native plugin inventory on this view field.
 // Ignore only that exact derived projection. Saved chains remain in cloudRaw;
 // a local plugins override remains present and changes the fingerprint.
 if(same(channel.plugins,expected)){const {plugins,...saved}=retained;return saved;}
 return retained;
}
// Playlist rows are presentation: a row-layout change (for example a client
// row hint for a just-created lane) renumbers rows without changing any saved
// data. Compare each clip's row and each row name by the lane on that row.
function rowLane(project,track){const laneId=project.cloud?.timelineLaneIds?.[track];return typeof laneId==='string'&&laneId?'lane:'+laneId:track;}
function rowIndependent(project,clip){if(!clip||typeof clip!=='object')return clip;const value={...clip};for(const key of ['track','cloudTrackIndex'])if(Object.hasOwn(value,key))value[key]=rowLane(project,value[key]);return value;}
// A placement read joins its pattern DTO and derives `notes` (ms, from that
// pattern's midi events) on every read; neither is placement state. Write
// receipts never carry the derived notes, so a projected receipt and the next
// real read differ only there (QA round 20). The pattern itself is fingerprinted
// exactly under `patterns`; the placement's own fields remain exact guards.
function withoutPatternJoin(clip){const raw=clip?.cloudRaw;if(!raw||typeof raw!=='object'||Array.isArray(raw)||!clip.patternId||!(Object.hasOwn(raw,'notes')||Object.hasOwn(raw,'pattern')))return clip;const {notes,pattern,...own}=raw;return{...clip,cloudRaw:own};}
// Saved reads list rows in the server's order (e.g. by start time) while an
// acknowledged receipt appends its new row: array order is not an edit.
const byIdentity=rows=>[...rows].sort((a,b)=>{const x=String(a?.cloudId??a?.id??''),y=String(b?.cloudId??b?.id??'');return x<y?-1:x>y?1:0;});
function outside(project){const {patterns,channels,cloud,selectedPattern,loop,clips,trackNames,...rest}=withoutObservedModelState(project);return{...rest,...clips!==undefined?{clips:byIdentity(clips).map(clip=>rowIndependent(project,withoutPatternJoin(clip)))}:{},...trackNames!==undefined?{trackNames:Object.fromEntries(Object.entries(trackNames||{}).map(([row,name])=>[String(rowLane(project,Number(row))),name]))}:{},audioClips:byIdentity(project.audioClips||[]).map(clip=>rowIndependent(project,audioHistoryFingerprint(clip))),channels:(project.channels||[]).filter(channel=>!channel.patternSource).map(channel=>withoutObservedChannel(historyChannel(channel,project)))};}
function fingerprint(project){return{outside:outside(project),savedMetadata:Object.fromEntries(Object.entries(withoutObservedSavedState(project.cloud?.rawProject)||{}).filter(([key])=>!['patterns','placements','clips','lanes','_studioApi','timelineRevision','updatedAt','updated_at'].includes(key))),patterns:(project.patterns||[]).filter(pattern=>pattern.id!=='empty').map(pattern=>({id:identity(pattern),serialized:serializeCloudPattern(pattern,project),metadata:Object.fromEntries(Object.entries(assertCompletePattern(pattern)).filter(([key])=>key!=='pattern'))}))};}
function resultBody(result){let value=result?.structuredContent;if(value===undefined&&Array.isArray(result?.content))value=JSON.parse(result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'));value=value??result;for(let depth=0;depth<8;depth++){if(!object(value)||result?.isError||value.ok===false||value.success===false||value.error)throw failure(typeof value?.error==='string'?value.error:'Freestyle returned no successful pattern history result.','pattern_history_read_failed');if(!object(value.response))return value;value=value.response;}throw failure('Pattern history response nesting exceeds its limit.');}
function readPatterns(result,scope){const body=resultBody(result);for(const key of ['project_id','projectId'])if(body[key]!==undefined&&body[key]!==scope.projectId)throw failure('The pattern read belongs to a different project.');assertCompleteCanonicalData(body,'pattern history read');if(!Array.isArray(body.patterns))throw failure('Freestyle did not return the complete saved pattern list.');const seen=new Set();for(const pattern of body.patterns){const raw=assertCompletePattern(pattern),key=pattern.id??raw.id??pattern.pattern_id;if(!id(key)||seen.has(key))throw failure('The saved pattern list has missing or duplicate identities.');seen.add(key);}return body;}
function equivalentNewIds(wanted,sent,before){const existing=new Set(before.pattern.events.map(event=>event.id));const view=dto=>({...dto,pattern:{...dto.pattern,events:dto.pattern.events.map(event=>existing.has(event.id)?event:{...event,id:null})}});return same(view(wanted),view(sent));}

/** Existing-pattern score, bounded placements and single-clip timing history. Each inverse is one saved action;
 * this is not a transaction or a replacement for project-wide engine history.
 */
export class CloudPatternHistory{
 constructor({engine,onChange=()=>{},onSelectPattern=null}={}){if(!engine?.session)throw new TypeError('Pattern history needs a cloud engine.');Object.assign(this,{engine,onChange,onSelectPattern});this.entries=[];this.index=0;this.records=[];this.operation=null;this.scope=null;this.baseline=null;this.blocked=null;this.sequence=0;this.externalEntries=new Map();this.queueTimeoutMs=HISTORY_QUEUE_MS;this.readTimeoutMs=HISTORY_READ_MS;this.reserved=[];this.reserveSequence=0;this.heldRender=null;this.lastApplied=null;this.externalPending=null;}
 get busy(){return !!this.operation;}
 /** A project/context change: reserved previews belong to the old scope; the new project renders itself. */
 dropReservations(){if(this.reserved.length)historyLog('history-optimistic-rollback',{reason:'scope_changed',steps:this.reserved.length});this.reserved=[];if(this.heldRender){this.engine.onProject=this.heldRender;this.heldRender=null;}}
 context(){const e=this.engine,s=e.session;return{projectId:e.projectId,trackId:s.trackId,loadVersion:e.loadVersion||0,contextVersion:s.contextVersion||0};}
 capture(){const scope=this.context();this.assert(scope);return scope;}
 assert(scope){const e=this.engine;if(!e.ready||e.loading||e.interacting||e.pending||e.applying||!id(scope.projectId)||!id(scope.trackId)||e.session.closed||e.session.projectId!==scope.projectId||!same(scope,this.context()))throw failure('Finish the current edit and load the same cloud project before using pattern history.','pattern_history_scope_changed',{name:'AbortError'});}
 selected(){const project=this.engine.project;return identity((project?.patterns||[]).find(pattern=>pattern.id===(this.engine.selectedPattern||project.selectedPattern)));}
 /** True while the project still holds the pattern a step edited (selection does not matter). */
 hasPattern(patternId){return (this.engine.project?.patterns||[]).some(pattern=>identity(pattern)===patternId);}
 /** Logic's Undo is global: a pattern step applies whatever is selected. When its
  * pattern is not the selected one it is selected first, and the host
  * (onSelectPattern) shows it in its editor, as Logic shows the edited region.
  * Returns false only when the pattern is no longer in the project. */
 focusPattern(patternId){
  if(this.selected()===patternId)return true;const project=this.engine.project,target=(project?.patterns||[]).find(pattern=>identity(pattern)===patternId);if(!target)return false;
  this.engine.selectedPattern=target.id;project.selectedPattern=target.id;historyLog('history-select-pattern',{patternId});
  try{this.onSelectPattern?.(target.id,patternId);}catch{}
  return true;
 }
 snapshot(){const current=same(this.scope,this.context()),undo=current?this.entries[this.index-1]:null,redo=current?this.entries[this.index]:null;return clone({busy:this.busy,scope:this.scope,canUndo:!!undo&&!this.busy&&!this.blocked&&(['audio','audio_move','placement','playlist_clone','playlist_move','audio_import','lane_create','external_step'].includes(undo.kind)||this.hasPattern(undo.patternId)),canRedo:!!redo&&!this.busy&&!this.blocked&&(['audio','audio_move','placement','playlist_clone','playlist_move','audio_import','lane_create','external_step'].includes(redo.kind)||this.hasPattern(redo.patternId)),hasJournal:current&&(this.entries.length>0||!!this.blocked),blocked:current?this.blocked:null,undoPatternId:undo?.patternId??null,redoPatternId:redo?.patternId??null,undoClipId:undo?.clipId??null,redoClipId:redo?.clipId??null,undoPlacementId:undo?.placementId??null,redoPlacementId:redo?.placementId??null,undoKind:undo?.kind??null,redoKind:redo?.kind??null,receipt:this.records.filter(record=>same(record.scope,this.context())).at(-1)??null,entryCount:current?this.entries.length:0,index:current?this.index:0});}
 notify(){try{this.onChange(this.snapshot());}catch{}}
 invalidate(reason='Other project edits are outside this pattern history.',{force=false,code='history_invalidated',paths}={}){if(force||this.entries.length||this.blocked||this.operation){historyLog('history-invalidate',{code,reason,force,entries:this.entries.length,index:this.index,busy:this.busy,...paths?{paths}:{}});this.blocked=reason;this.notify();}}
 /** True when the fresh project differs from the retained baseline; logs the paths. */
 drifted(project){let next;try{next=fingerprint(project);}catch(error){historyLog('history-drift',{code:'fingerprint_failed',error:error.message});return true;}if(same(next,this.baseline))return false;if(cascadeOnly(this.baseline,next,this.cascades)){historyLog('history-cascade-adopted',{where:'drift',paths:driftPaths(this.baseline,next).length});this.baseline=clone(next);return false;}historyLog('history-drift',{code:'baseline_mismatch',operation:this.operation?.record?.kind??null,direction:this.operation?.record?.direction??null,paths:driftPaths(this.baseline,next)});return true;}
 /** Another history owner (Playlist clipboard Paste/Cut/⌘B, audio Slice, and
  * their own Undo/Redo) saves an audio-clip change it retains and undoes
  * itself. While its write and adoption run, drift confined to the audio clips
  * (and the saved clip count) is that owner's step, not an outside edit, so
  * older pattern steps stay usable. Anything else still invalidates. */
 beginOwnedAudioChange(){const token={until:Date.now()+OWNED_AUDIO_TTL_MS};(this.ownedAudio||=new Set()).add(token);return token;}
 endOwnedAudioChange(token){try{if(this.engine.project)this.observe(this.engine.project);}finally{this.ownedAudio?.delete(token);}}
 ownsAudioChange(){const now=Date.now();for(const token of this.ownedAudio||[])if(token.until<now)this.ownedAudio.delete(token);return !!this.ownedAudio?.size;}
 observe(project){const scope=this.context();let next;try{next=fingerprint(project);}catch{this.invalidate('Reload the complete canonical pattern before using history.');return;}if(!same(scope,this.scope)){this.dropReservations();this.entries=[];this.index=0;this.blocked=null;this.scope=clone(scope);this.baseline=clone(next);this.notify();return;}if(this.busy||this.externalPending)return;if(this.baseline&&!same(this.baseline,next)&&cascadeOnly(this.baseline,next,this.cascades)){historyLog('history-cascade-adopted',{where:'observe',paths:driftPaths(this.baseline,next).length});this.baseline=clone(next);return;}if(this.baseline&&!same(this.baseline,next)&&this.ownsAudioChange()&&audioOnlyDrift(this.baseline,next)){historyLog('history-owned-audio-adopted',{paths:driftPaths(this.baseline,next).length});this.baseline=clone(next);return;}if(this.baseline&&!same(this.baseline,next))this.invalidate('The project changed outside the retained pattern edit. Reopen the project before using older history.',{code:'observed_project_changed',paths:driftPaths(this.baseline,next)});this.baseline=clone(next);}
 /** Expect Freestyle's placement echo of a lane mute/solo ([{laneId,field:'muted'|'soloed',value}]) for a short while. */
 expectCascade(list){const now=Date.now(),items=(Array.isArray(list)?list:[]).filter(item=>typeof item?.laneId==='string'&&['muted','soloed'].includes(item.field)&&typeof item.value==='boolean');this.cascades=[...(this.cascades||[]).filter(item=>item.until>=now&&!items.some(next=>next.laneId===item.laneId&&next.field===item.field)),...items.map(item=>({laneId:item.laneId,field:item.field,value:item.value,until:now+CASCADE_TTL_MS}))];}
 /** The app names the gesture behind its next saved edit (Paste, Clone…; a
  * Channel Rack Fill/Rotate names its pattern step with kind 'pattern'). */
 hintLabel(label,{kind='placement'}={}){this.labelHint=typeof label==='string'&&label?{label,kind,at:Date.now()}:null;}
 captureEdit(before,next){const plan=this.classifyEdit(before,next),hint=this.labelHint;this.labelHint=null;if(hint&&plan&&plan.kind===hint.kind&&Date.now()-hint.at<30000)plan.label=hint.label;if(plan?.kind==='unsupported'){try{plan.paths=driftPaths(fingerprint(before),fingerprint(next));}catch{}historyLog('history-unsupported-edit',{reason:plan.reason||null,paths:plan.paths||[],clips:[before.clips?.length,next.clips?.length],audioClips:[before.audioClips?.length,next.audioClips?.length]});}return plan;}
 classifyEdit(before,next){
  const scope=this.context(),base=fingerprint(before),after=fingerprint(next);if(!same(scope,this.scope))this.observe(before);
  if(same(base,after))return{kind:'selection',scope};
  // FL Rename track: one Playlist/Mixer track name and nothing else.
  if(same(base.patterns,after.patterns)&&same(base.savedMetadata,after.savedMetadata)&&same({...base.outside,trackNames:undefined},{...after.outside,trackNames:undefined})){
   const names=[base.outside.trackNames||{},after.outside.trackNames||{}],keys=[...new Set([...Object.keys(names[0]),...Object.keys(names[1])])].filter(key=>names[0][key]!==names[1][key]);
   if(keys.length===1&&String(keys[0]).startsWith('lane:')&&typeof names[1][keys[0]]==='string'&&names[1][keys[0]]){const laneId=String(keys[0]).slice(5),previous=savedLaneName(before,laneId);if(id(laneId)&&previous!==undefined)return{kind:'lane_rename',scope:clone(scope),laneId,before:previous,after:names[1][keys[0]]};}
  }
  const a=base.patterns,b=after.patterns;if(same(a,b)&&same({...base.outside,clips:undefined,audioClips:undefined},{...after.outside,clips:undefined,audioClips:undefined})){const move=capturePlaylistMove(before,next);if(move)return{...move,scope:clone(scope)};const mixed=this.captureMixedDelete(before,next);if(mixed)return{...mixed,scope:clone(scope)};}
  if(same(a,b)&&same({...base.outside,clips:undefined},{...after.outside,clips:undefined})){const restoreSupported=this.engine.session.supportsPlacementRestore?.()===true,phaseWritable=this.engine.session.supportsPlacementPhase?.(next.clips.length===before.clips.length?'update':'create')===true,placement=capturePlacementHistory(before,next,{allowRestore:restoreSupported,phaseWritable});if(placement)return{...placement,restoreSupported,phaseWritable,scope:clone(scope)};const removed=before.clips.filter(clip=>!next.clips.some(row=>row.id===clip.id));if(removed.length&&before.clips.length===next.clips.length+removed.length){try{for(const clip of removed)placementCreationBody(placementHistorySide(before,clip.cloudId));}catch(error){return{kind:'unsupported',scope:clone(scope),reason:'Undo is unavailable for this placement deletion: '+error.message};}}}
  if(same(a,b)&&same({...base.outside,audioClips:undefined},{...after.outside,audioClips:undefined})){const audio=captureAudioHistory(before,next)||captureAudioMoveHistory(before,next);if(audio)return{...audio,scope:clone(scope)};return{kind:'unsupported',scope};}if(!same(base.outside,after.outside)||!same(a.map(row=>row.id),b.map(row=>row.id)))return{kind:'unsupported',scope};
  const changed=b.filter((row,index)=>!same(row.serialized,a[index].serialized));if(changed.length!==1||!id(changed[0].id))return{kind:'unsupported',scope};
  const patternId=changed[0].id;return{kind:'pattern',scope:clone(scope),patternId,before:side(before,patternId),wanted:clone(changed[0].serialized)};
 }
 /** FL erase across pattern and audio clips: only deletions of saved clips of both
  * kinds, nothing else changed. */
 captureMixedDelete(before,next){
  const removedPlacements=(before.clips||[]).filter(clip=>!(next.clips||[]).some(row=>row.id===clip.id)),removedAudio=(before.audioClips||[]).filter(clip=>!(next.audioClips||[]).some(row=>row.id===clip.id));
  // QA round 20: deleting audio clips alone (no pattern clips) is the same step
  // without a placement half; it was "unsupported" and dropped the whole history.
  if(!removedAudio.length||removedPlacements.length&&this.engine.session.supportsPlacementBatch?.()!==true||[...removedPlacements,...removedAudio].some(clip=>!id(clip.cloudId)))return null;
  if((next.clips||[]).some(clip=>!before.clips.some(row=>row.id===clip.id))||(next.audioClips||[]).some(clip=>!before.audioClips.some(row=>row.id===clip.id)))return null;
  // Everything that remains is exactly as it was.
  const trimmed={...before,clips:before.clips.filter(clip=>next.clips.some(row=>row.id===clip.id)),audioClips:before.audioClips.filter(clip=>next.audioClips.some(row=>row.id===clip.id))};
  try{if(!same(fingerprint(trimmed),fingerprint(next)))return null;}catch{return null;}
  return{kind:'mixed_delete',label:removedPlacements.length||removedAudio.length>1?'Delete clips':'Delete audio clip',members:removedPlacements.map(clip=>({placementId:clip.cloudId,before:placementHistorySide(before,clip.cloudId)})),audio:removedAudio.map(clip=>({clipId:clip.cloudId,laneId:clip.laneId,canonical:clone(clip.cloudRaw)}))};
 }
 recordMixedDelete(plan,project,requests){
  try{
   const batch=requests.filter(request=>request.name==='apply_pattern_placement_batch'),deletes=requests.filter(request=>request.name==='delete_clip');
   const withPlacements=plan.members.length>0;
   if(batch.length!==(withPlacements?1:0)||deletes.length!==plan.audio.length||requests.length!==batch.length+deletes.length)throw failure('A clip erase needs one placement batch (when it erased pattern clips) and one confirmed audio removal per clip.');
   const ids=plan.members.map(member=>member.placementId),ops=withPlacements?batch[0].args?.ops:[];if(!Array.isArray(ops)||ops.length!==ids.length||ops.some((op,index)=>op.op!=='delete'||op.placementId!==ids[index]))throw failure('The placement batch did not delete exactly the erased pattern clips.');
   const audioUndo=[];for(const request of [...deletes].reverse()){const body=clipBatchBody(request.result),clipId=request.args?.clip_id;if(!body||!plan.audio.some(item=>item.clipId===clipId)||body.undo.inverse_ops.some(op=>op?.id!==clipId))throw failure('An audio clip removal has no exact server-authored inverse.');audioUndo.push(...clone(body.undo.inverse_ops));}
   if(project.clips.some(clip=>ids.includes(clip.cloudId))||project.audioClips.some(clip=>plan.audio.some(item=>item.clipId===clip.cloudId)))throw failure('The saved project has not confirmed the erase.');
   const placementUndo=withPlacements?this.engine.session.placementBatchInverse(batch[0].result):[];
   if(this.records.some(record=>same(record.scope,plan.scope)&&record.status==='uncertain'))throw failure('Inspect the uncertain history request before retaining newer edits.');
   if(this.blocked){this.entries=[];this.index=0;}this.entries=this.entries.slice(0,this.index);
   const entry={kind:'mixed_delete',label:plan.label,members:clone(plan.members),audio:clone(plan.audio)};mixedDeleteUndo.set(entry,{undo:{placements:placementUndo,audio:audioUndo},redo:null});
   this.entries.push(entry);if(this.entries.length>100)this.entries.shift();this.index=this.entries.length;this.scope=clone(plan.scope);this.baseline=fingerprint(project);this.blocked=null;historyLog('history-mixed-delete-recorded',{placements:ids.length,audio:plan.audio.length,index:this.index});this.notify();
  }catch(error){this.invalidate(error.message,{force:true,code:'record_unconfirmed:mixed_delete'});this.baseline=fingerprint(project);}
 }
 /** QA round 20: FL pastes a mixed pattern+audio selection as ONE step. The
  * engine saved the pasted pattern clips as the newest journal entry; the
  * clipboard then saved the audio clips (clips:batch, with its inverse). That
  * entry becomes, in place (its identity keeps the app's step order), a mixed
  * step: Undo deletes the pasted placements (one placement batch, whose receipt
  * signs their restore) and removes the pasted audio (its inverse); Redo restores
  * the same identities. Returns false (nothing changed) unless all of it is exact. */
 composeMixedPaste({entry,placementIds,audioIds,audioUndo,project,label='Paste clips'}){
  try{
   if(this.blocked||this.busy||!entry||entry!==this.entries[this.index-1]||entry.kind!=='placement'||entry.operation!=='create')return false;
   if(this.engine.session.supportsPlacementBatch?.()!==true)return false;
   if(!Array.isArray(placementIds)||!placementIds.length||!placementIds.every(id)||new Set(placementIds).size!==placementIds.length)return false;
   if(!Array.isArray(audioIds)||!audioIds.length||!audioIds.every(id)||new Set(audioIds).size!==audioIds.length||!Array.isArray(audioUndo)||!audioUndo.length)return false;
   if(audioUndo.some(op=>op?.op!=='remove'||!audioIds.includes(op.id))||!audioIds.every(clipId=>audioUndo.some(op=>op.id===clipId)))return false;
   if(!placementIds.every(placementId=>(project.clips||[]).some(clip=>clip.cloudId===placementId))||!audioIds.every(clipId=>(project.audioClips||[]).some(clip=>clip.cloudId===clipId)))return false;
   for(const key of Object.keys(entry))delete entry[key];
   Object.assign(entry,{kind:'mixed_paste',label,members:placementIds.map(placementId=>({placementId,canonical:clone(project.clips.find(clip=>clip.cloudId===placementId)?.cloudRaw??null)})),audio:audioIds.map(clipId=>({clipId,canonical:clone(project.audioClips.find(clip=>clip.cloudId===clipId)?.cloudRaw??null)}))});
   mixedDeleteUndo.set(entry,{undo:{placements:placementIds.map(placementId=>({op:'delete',placementId})),audio:clone(audioUndo)},redo:null});
   this.baseline=fingerprint(project);historyLog('history-mixed-paste-recorded',{placements:placementIds.length,audio:audioIds.length,index:this.index});this.notify();return true;
  }catch{return false;}
 }
 /** QA round 21: an audio-only Paste / ⌘B is one journal step (the audio-only
  * mixed-erase path): Undo sends the clips:batch inverse that removes the pasted
  * clips; Redo restores the same ids from that receipt. False = not retained. */
 recordAudioPaste({audioIds,audioUndo,project,label}){
  try{
   // REST projects only: the journal step needs the server-authored clips:batch inverse and typed reads.
   if(this.busy||this.engine.session.rawState?.studioApi!==true||!Array.isArray(audioIds)||!audioIds.length||!audioIds.every(id)||new Set(audioIds).size!==audioIds.length||!Array.isArray(audioUndo)||!audioUndo.length)return false;
   if(audioUndo.some(op=>op?.op!=='remove'||!audioIds.includes(op.id))||!audioIds.every(clipId=>audioUndo.some(op=>op.id===clipId))||!audioIds.every(clipId=>(project.audioClips||[]).some(clip=>clip.cloudId===clipId)))return false;
   const scope=this.context();if(!scope?.projectId)return false;
   if(this.records.some(record=>same(record.scope,scope)&&record.status==='uncertain'))return false;
   if(this.blocked){this.entries=[];this.index=0;}this.entries=this.entries.slice(0,this.index);
   const entry={kind:'mixed_paste',label:label||(audioIds.length===1?'Paste audio clip':'Paste clips'),members:[],audio:audioIds.map(clipId=>({clipId,canonical:clone(project.audioClips.find(clip=>clip.cloudId===clipId)?.cloudRaw??null)}))};mixedDeleteUndo.set(entry,{undo:{placements:[],audio:clone(audioUndo)},redo:null});
   this.entries.push(entry);if(this.entries.length>100)this.entries.shift();this.index=this.entries.length;this.scope=clone(scope);this.baseline=fingerprint(project);this.blocked=null;historyLog('history-mixed-paste-recorded',{placements:0,audio:audioIds.length,index:this.index});this.notify();return true;
  }catch{return false;}
 }
 /** Undo/Redo of a mixed erase: the placement batch inverse, then the audio clips:batch
  * inverse. A refusal of the second puts the first back, so the step is all-or-nothing. */
 async applyMixedDelete(direction,entry,scope){
  const state=mixedDeleteUndo.get(entry),ops=state?.[direction];
  const record={sequence:++this.sequence,scope:clone(scope),kind:entry.kind,direction,status:'reading',attempted:false,error:null},operation={scope,record};this.records.push(record);this.operation=operation;this.notify();
  const key=()=>globalThis.crypto?.randomUUID?.()||`mixed-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // QA round 19: the audio half is guarded by the revision the placement half returned,
  // never by the bridge's older cached read tag (that was a 412 that rolled the step back).
  const sendAudio=async(audioOps,revision)=>{const raw=await this.engine.session.call('apply_clip_batch',{project_id:scope.projectId,...scope.trackId?{track_id:scope.trackId}:{},ops:clone(audioOps)},{idempotencyKey:key(),...typeof revision==='string'&&revision?{ifMatch:JSON.stringify(revision)}:{}});const body=clipBatchBody(raw);if(!body)throw Object.assign(failure('Freestyle returned no clips:batch inverse for the audio clips.'),{operationUncertain:true});lastAudioBody=body;return clone(body.undo.inverse_ops);};let lastAudioBody=null;
  try{
   const audioOnly=entry.members.length===0;
   if(!Array.isArray(ops?.placements)||!ops.placements.length&&!audioOnly||!Array.isArray(ops.audio)||!ops.audio.length)throw failure('Reload the retained clip erase history.');
   await this.settleQueue(scope);
   // QA round 21: an audio-only step (Paste/⌘B/erase of audio clips) is guarded by the
   // current saved snapshot when it is exactly the journal's baseline, painted from the
   // clips:batch receipt, and read only when either is not certain (FL: instant).
   const count=project=>project.clips.filter(clip=>entry.members.some(member=>member.placementId===clip.cloudId)).length+project.audioClips.filter(clip=>entry.audio.some(item=>item.clipId===clip.cloudId)).length;
   const current=this.engine.session.project,expectedPresent=((direction==='undo')===(entry.kind==='mixed_delete'))?0:entry.members.length+entry.audio.length;
   let fresh=null;if(current?.audioClips&&current?.clips&&this.engine.session.rawState?.studioApi===true&&!this.engine.pending&&!this.engine.inFlight){try{if(count(current)===expectedPresent&&!this.drifted(current))fresh=current;}catch{}}
   if(!fresh)fresh=await this.readPlacement(scope);this.assert(scope);
   const restoring=(direction==='undo')===(entry.kind==='mixed_delete'),present=fresh.clips.filter(clip=>entry.members.some(member=>member.placementId===clip.cloudId)).length+fresh.audioClips.filter(clip=>entry.audio.some(item=>item.clipId===clip.cloudId)).length,total=entry.members.length+entry.audio.length;
   if(restoring?present!==0:present!==total)throw failure('A clip changed after this erase. History will not overwrite newer data.');
   if(this.drifted(fresh))throw failure('The canonical project changed after this edit. History will not overwrite newer data.');
   record.status='sending';record.attempted=true;this.notify();
   if(audioOnly){
    // Audio clips only: one atomic clips:batch guarded by the fresh timeline revision.
    let audioInverse;try{audioInverse=await sendAudio(ops.audio,this.engine.session.rawProject?.timelineRevision);}
    catch(error){if([400,403,404,409,412,422,428].includes(Number(error?.status))&&(error?.explicitRejection===true||error?.operationUncertain!==true)){await this.readPlacement(scope).catch(()=>{});throw Object.assign(error,{dispatched:false,historyNotApplied:true,operationUncertain:false});}throw error;}
    record.status='confirming';this.notify();let confirmed=null;
    try{const painted=this.engine.session.applyClipBatchReceipt?.(lastAudioBody,{ops:clone(ops.audio),projectId:scope.projectId,trackId:scope.trackId,contextVersion:scope.contextVersion||0});if(painted){this.engine.accept(painted);confirmed=painted;}}catch{confirmed=null;}
    if(!confirmed)confirmed=await this.readPlacement(scope);this.assert(scope);
    const after=confirmed.audioClips.filter(clip=>entry.audio.some(item=>item.clipId===clip.cloudId)).length;
    if(restoring?after!==total:after!==0)throw Object.assign(failure('Freestyle acknowledged the clip history, but the saved Playlist has not confirmed it.'),{operationUncertain:true});
    state[direction==='undo'?'redo':'undo']={placements:[],audio:audioInverse};
    this.index+=direction==='undo'?-1:1;this.baseline=fingerprint(confirmed);record.status='confirmed';return{receipt:clone(record)};
   }
   let placed;try{placed=await this.engine.session.applyPlacementBatch(ops.placements,{expectedContext:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:scope.contextVersion},ifMatch:placementTimelineTag(this.engine.session.rawProject),idempotencyKey:key()});}
   catch(error){if([400,403,404,409,412,422,428].includes(Number(error?.status))&&(error?.explicitRejection===true||error?.operationUncertain!==true)){error.dispatched=false;error.operationUncertain=false;}throw error;}this.assert(scope);
   const placementInverse=this.engine.session.placementBatchInverse(placed);let audioInverse;
   try{audioInverse=await sendAudio(ops.audio,placed?.timelineRevision);}
   catch(error){
    // clips:batch is atomic: a 4xx refusal (explicit, or not marked uncertain) wrote nothing.
    const refused=[400,403,404,409,412,422,428].includes(Number(error?.status))&&(error?.explicitRejection===true||error?.operationUncertain!==true);
    if(!refused)throw error;
    // The audio part was refused: put the pattern part back so nothing of this step stays applied.
    // The rollback's own receipt replaces this direction's placement ops (a re-deleted
    // placement has a new signed restore token), so the step stays retryable.
    try{await this.readPlacement(scope);const rolled=await this.engine.session.applyPlacementBatch(placementInverse,{expectedContext:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:scope.contextVersion},ifMatch:placementTimelineTag(this.engine.session.rawProject),idempotencyKey:key()});state[direction]={...state[direction],placements:this.engine.session.placementBatchInverse(rolled)};}catch{throw Object.assign(error,{operationUncertain:true});}
    await this.readPlacement(scope);throw Object.assign(error,{dispatched:false,historyNotApplied:true});
   }
   record.status='confirming';this.notify();
   // QA round 21 speed: both receipts (placement batch cards + clips:batch) paint the confirmed rows; any doubt reads.
   let confirmed=null;try{const s=this.engine.session,context={projectId:scope.projectId,trackId:scope.trackId,contextVersion:scope.contextVersion||0};if(s.projectSavedWrites?.([{name:'apply_pattern_placement_batch',args:{ops:clone(ops.placements)},result:placed}],placed?.timelineRevision,context,{requireReturnedRows:true})){
     // The placement receipt's revision is the ETag the audio half was sent on (the bridge adopted it too).
     if(s.rawProject?._studioApi&&typeof placed?.timelineRevision==='string')s.rawProject={...s.rawProject,_studioApi:{...s.rawProject._studioApi,etag:JSON.stringify(placed.timelineRevision)}};
     const painted=s.applyClipBatchReceipt?.(lastAudioBody,{ops:clone(ops.audio),...context});if(painted){this.engine.accept(painted);confirmed=painted;historyLog('history-confirmed-from-receipt',{kind:entry.kind,direction});}else historyLog('history-receipt-confirm-declined',{kind:entry.kind,stage:'audio',reason:s.lastClipBatchProjection?.reason??null});}else historyLog('history-receipt-confirm-declined',{kind:entry.kind,stage:'placements'});}catch(error){confirmed=null;historyLog('history-receipt-confirm-declined',{kind:entry.kind,stage:'error',reason:String(error?.message||error).slice(0,200)});}
   if(!confirmed)confirmed=await this.readPlacement(scope);this.assert(scope);
   const after=confirmed.clips.filter(clip=>entry.members.some(member=>member.placementId===clip.cloudId)).length+confirmed.audioClips.filter(clip=>entry.audio.some(item=>item.clipId===clip.cloudId)).length;
   if(restoring?after!==total:after!==0)throw Object.assign(failure('Freestyle acknowledged the erase history, but the saved Playlist has not confirmed it.'),{operationUncertain:true});
   state[direction==='undo'?'redo':'undo']={placements:placementInverse,audio:audioInverse};
   this.index+=direction==='undo'?-1:1;this.baseline=fingerprint(confirmed);record.status='confirmed';return{receipt:clone(record)};
  }catch(error){
   const notApplied=error?.dispatched===false||error?.historyNotApplied===true||!record.attempted;record.status=notApplied?'not_applied':'uncertain';record.error=error.message;
   if(same(scope,this.context())&&record.status==='uncertain')this.blocked='A clip erase history request is uncertain. Reopen the project to inspect it; it will not be repeated.';
   throw Object.assign(error,{patternHistoryReceipt:clone(record),operationUncertain:record.status==='uncertain'});
  }finally{if(this.operation===operation)this.operation=null;this.notify();}
 }
 record(plan,project,requests=[]){
  if(!same(plan.scope,this.context()))return this.invalidate('The project changed while the edit was being saved.');
  if(plan.kind==='selection'){this.observe(project);return;}
  if(plan.kind==='mixed_delete')return this.recordMixedDelete(plan,project,requests);
  if(plan.kind==='playlist_move'){
   try{const receipt=this.engine.session.lastPlaylistMove;if(receipt?.status!=='confirmed'||!same(receipt.scope,{projectId:plan.scope.projectId,trackId:plan.scope.trackId,contextVersion:plan.scope.contextVersion})||!same(receipt.plan.members,plan.members)||(receipt.batched===true?requests.length!==1||requests[0].name!=='apply_pattern_placement_batch'||requests[0].studioApi?.operationId!=='applyPatternPlacementBatch':requests.length!==plan.members.length))throw failure('The selected move has no complete retained sequence of confirmed receipts.');const members=confirmPlaylistMove(plan,project);for(let index=0;index<members.length;index++)if(members[index].kind==='audio'){members[index].undoInverse=clone(receipt.steps[index].inverse);members[index].redoInverse=null;}
    if(this.records.some(record=>same(record.scope,plan.scope)&&record.status==='uncertain'))throw failure('Inspect the uncertain history request before retaining newer moves.');
    if(this.blocked){this.entries=[];this.index=0;}this.entries=this.entries.slice(0,this.index);this.entries.push({kind:'playlist_move',members});if(this.entries.length>100)this.entries.shift();this.index=this.entries.length;this.scope=clone(plan.scope);this.baseline=fingerprint(project);this.blocked=null;this.notify();return;
   }catch(error){this.invalidate(error.message,{force:true,code:'record_unconfirmed:'+plan.kind,paths:[{path:'/requests',before:'',after:JSON.stringify(requests.map(request=>request.name)).slice(0,200)}]});return;}
  }
  if(!['pattern','audio','audio_move','placement','lane_rename'].includes(plan.kind)){let unchanged=false;try{unchanged=!!this.baseline&&same(fingerprint(project),this.baseline);}catch{}
   // A refused/failed edit that left the saved project unchanged never blocks history.
   if(unchanged){historyLog('history-unretained-edit',{code:'unsupported_edit_not_saved',reason:plan.reason||null,paths:plan.paths||[]});this.notify();return;}
   this.invalidate(plan.reason||'That edit is outside retained single-pattern, supported placement and single-audio-clip Undo/Redo.',{force:true,code:'unsupported_edit',paths:plan.paths});this.baseline=fingerprint(project);return;}
  let after,inverse,restoreHandles,createdMembers=null,batchInverse=null;try{
   const batchRequest=plan.kind==='placement'&&requests.length===1&&requests[0].name==='apply_pattern_placement_batch'&&requests[0].studioApi?.operationId==='applyPatternPlacementBatch'?requests[0]:null;
   if(batchRequest){
    // One atomic batch: its undo.inverse_ops is this step's exact Undo.
    const ops=batchRequest.args?.ops,result=batchRequest.result;if(!plan.members||!Array.isArray(ops)||ops.length!==plan.members.length||!Array.isArray(result?.results)||result.results.length!==ops.length)throw failure('Placement batch history needs one acknowledged op per retained placement.');
    if(plan.operation==='create'){
     if(ops.some(op=>op.op!=='create'))throw failure('A placement creation batch may only create.');const ids=result.createdIds;if(!Array.isArray(ids)||ids.length!==plan.members.length||new Set(ids).size!==ids.length)throw failure('Freestyle returned duplicate or missing created placement identities.');
     const sides=ids.map(placementId=>placementHistorySide(project,placementId)),free=new Set(sides.keys());
     createdMembers=plan.members.map(member=>{const index=[...free].find(index=>batchRowEqual(member.wanted.canonical,sides[index].canonical)||placementRestorableCreationEqual(member.wanted,sides[index],{phaseWritable:plan.phaseWritable===true}));if(index===undefined)throw failure('A created placement did not confirm its exact saved source and timing.');free.delete(index);return{placementId:ids[index],logicalKey:member.logicalKey,before:sides[index]};});
     if(!same(placementProtectedProject(project,ids),plan.protected))throw failure('The placement group creation changed unrelated saved project data.');
    }else{
     const ids=plan.members.map(member=>member.placementId);if(ops.some((op,index)=>op.op!=='delete'||op.placementId!==ids[index]))throw failure('Group history needs one acknowledged deletion per retained placement.');
     if(project.clips.some(clip=>ids.includes(clip.cloudId))||!same(placementProtectedProject(project,ids),plan.protected))throw failure('The complete project has not confirmed exactly the retained placement group deletion.');
    }
    batchInverse=this.engine.session.placementBatchInverse(result);after=null;
   }else if(plan.kind==='placement'){
    if(plan.members&&plan.operation==='create'){
     // One acknowledged create per member; match each confirmed row to its intent.
     if(requests.length!==plan.members.length||requests.some(request=>request.name!=='create_pattern_placement'||request.studioApi?.operationId!=='createPatternPlacement'))throw failure('Group creation history needs one dedicated acknowledged create per placement.');
     const ids=requests.map(request=>placementReceiptId(request.result,{projectId:plan.scope.projectId,operationId:'createPatternPlacement'}));if(new Set(ids).size!==ids.length)throw failure('Freestyle returned duplicate created placement identities.');
     const sides=ids.map(placementId=>placementHistorySide(project,placementId)),free=new Set(sides.keys());
     createdMembers=plan.members.map(member=>{const index=[...free].find(index=>plan.restoreSupported?placementRestorableCreationEqual(member.wanted,sides[index],{phaseWritable:plan.phaseWritable===true}):placementCreationEqual(member.wanted,sides[index],{phaseWritable:plan.phaseWritable===true}));if(index===undefined)throw failure('A created placement did not confirm its exact saved source and timing.');free.delete(index);return{placementId:ids[index],logicalKey:member.logicalKey,before:sides[index]};});
     if(!same(placementProtectedProject(project,ids),plan.protected))throw failure('The placement group creation changed unrelated saved project data.');after=null;
    }else if(plan.members){
     const ids=plan.members.map(member=>member.placementId);if(requests.length!==ids.length||requests.some((request,index)=>request.name!=='delete_pattern_placement'||request.studioApi?.operationId!=='deletePatternPlacement'||request.args.placement_id!==ids[index]||placementReceiptId(request.result,{projectId:plan.scope.projectId,operationId:'deletePatternPlacement',expectedId:ids[index]})!==ids[index]))throw failure('Group history needs one dedicated acknowledged deletion per retained placement.');
     if(project.clips.some(clip=>ids.includes(clip.cloudId))||!same(placementProtectedProject(project,ids),plan.protected))throw failure('The complete project has not confirmed exactly the retained placement group deletion.');after=null;if(plan.restoreSupported)restoreHandles=requests.map((request,index)=>this.engine.session.placementDeleteUndo(request.result,ids[index]));
    }else{
    const action={create:'create_pattern_placement',update:'update_pattern_placement',delete:'delete_pattern_placement'}[plan.operation],operationId={create:'createPatternPlacement',update:'updatePatternPlacement',delete:'deletePatternPlacement'}[plan.operation];
    if(requests.length!==1||requests[0].name!==action||requests[0].studioApi?.operationId!==operationId)throw failure('Placement history needs one dedicated acknowledged saved operation.');
    const request=requests[0],placementId=placementReceiptId(request.result,{projectId:plan.scope.projectId,operationId,...plan.operation!=='create'?{expectedId:plan.placementId}:{}});after=plan.operation==='delete'?null:placementHistorySide(project,placementId);
    if(!same(placementProtectedProject(project,placementId),plan.protected))throw failure('The placement edit changed unrelated saved project data.');
    if(plan.operation==='delete'){
     if(request.args.placement_id!==plan.placementId||project.clips.some(clip=>clip.cloudId===placementId))throw failure('The saved project has not confirmed removal of the retained placement.');if(plan.restoreSupported)restoreHandles=[this.engine.session.placementDeleteUndo(request.result,placementId)];
    }else if(plan.operation==='create'){
     if(!same(placementCreationBody({...request.args.placement,...(plan.phaseWritable!==true&&!Object.hasOwn(request.args.placement,'loopPhaseMs')?{loopPhaseMs:0}:{})},{intent:true,phaseWritable:plan.phaseWritable===true}),placementCreationBody(plan.wanted,{phaseWritable:plan.phaseWritable===true}))||!(plan.restoreSupported?placementRestorableCreationEqual(plan.wanted,after,{phaseWritable:plan.phaseWritable===true}):placementCreationEqual(plan.wanted,after,{phaseWritable:plan.phaseWritable===true})))throw failure('The created placement did not confirm its exact saved source and timing.');
    }else if(request.args.placement_id!==plan.placementId||!same(placementHistoryArguments('update',plan.wanted,plan.before,{phaseWritable:plan.phaseWritable===true}).placement,Object.fromEntries(Object.keys(placementHistoryArguments('update',plan.wanted,plan.before,{phaseWritable:plan.phaseWritable===true}).placement).map(key=>[key,request.args.placement?.[key]])))||!placementHistoryEqual(after,plan.wanted))throw failure('The saved placement did not confirm its exact retained update.');
    }
   }else if(plan.kind==='lane_rename'){
    const writes=requests.filter(request=>request.name==='rename_track');
    if(requests.length!==1||writes.length!==1||writes[0].args?.track_id!==plan.laneId||writes[0].args?.label!==plan.after)throw failure('Track rename history needs one acknowledged rename of that track.');
    if(savedLaneName(project,plan.laneId)!==plan.after)throw failure('The saved project has not confirmed the new track name.');after=plan.after;
   }else if(plan.kind==='audio_move'){
    after=audioMoveSide(project,plan.clipId);const writes=requests.filter(request=>request.name==='move_clip_to_lane');
    if(writes.length!==1||requests.length!==1||writes[0].args.clip_id!==plan.clipId||writes[0].args.lane_id!==plan.wanted.laneId||writes[0].args.start_ms!==plan.wanted.geometry.start_ms||!audioMoveEqual(after,plan.wanted)||!same(audioMoveProtectedProject(project,plan.clipId),plan.protected))throw failure('The saved lane move did not confirm one exact clip move with unchanged source metadata.');
    inverse=audioMoveInverse(writes[0].result,plan.before,after,{projectId:plan.scope.projectId,operationId:writes[0].studioApi?.operationId});
   }else if(plan.kind==='audio'){
    after=audioHistorySide(project,plan.clipId);const writes=requests.filter(request=>['shift_clip','trim_clip'].includes(request.name));
    if(!writes.length||writes.length>2||requests.some(request=>!['shift_clip','trim_clip'].includes(request.name))||writes.some(request=>request.args.track_id!==plan.laneId||request.args.clip_id!==plan.clipId)||!audioGeometryEqual(after.geometry,plan.wanted)||!same(after.metadata,plan.before.metadata))throw failure('The saved audio clip did not confirm its exact timing edit and unchanged source metadata.');if(audioGeometryEqual(after.geometry,plan.before.geometry)){this.baseline=fingerprint(project);return;}
   }else{
    const updates=requests.filter(request=>request.name==='update_pattern'&&request.args.pattern_id===plan.patternId);after=side(project,plan.patternId);if(updates.length!==1||!equivalentNewIds(plan.wanted,updates[0].args.pattern,plan.before.serialized)||!same(after.serialized,updates[0].args.pattern))throw failure('The saved pattern did not confirm its exact edit payload.');
   }
  }catch(error){this.invalidate(error.message,{force:true,code:'record_unconfirmed:'+plan.kind,paths:[{path:'/requests',before:'',after:JSON.stringify(requests.map(request=>request.name)).slice(0,200)}]});return;}
  if(this.records.some(record=>same(record.scope,plan.scope)&&record.status==='uncertain')){this.invalidate('A pattern history request is uncertain. Reopen the project before making another history request.');return;}
  if(this.blocked){this.entries=[];this.index=0;}this.entries=this.entries.slice(0,this.index);
  const placementIdentity=plan.kind==='placement'?(createdMembers?{operation:'create',placementId:null,members:createdMembers}:plan.members?{operation:'delete',placementId:null,members:plan.members.map(member=>({...clone(member),logicalKey:this.entries.findLast(entry=>entry.kind==='placement'&&entry.placementId===member.placementId)?.logicalKey??member.logicalKey}))}:{operation:plan.operation,placementId:after?.placementId??plan.placementId,logicalKey:this.entries.findLast(entry=>entry.kind==='placement'&&entry.placementId===(after?.placementId??plan.placementId))?.logicalKey??plan.logicalKey}):null;
  const entry={kind:plan.kind,...placementIdentity??(['audio','audio_move'].includes(plan.kind)?{clipId:plan.clipId,laneId:plan.laneId}:plan.kind==='lane_rename'?{laneId:plan.laneId}:{patternId:plan.patternId}),before:clone(plan.before),after,...plan.label?{label:plan.label}:{},...plan.restoreSupported?{restoreSupported:true}:{},...plan.phaseWritable?{phaseWritable:true}:{},...inverse?{undoInverse:inverse,redoInverse:null}:{}};if(batchInverse){entry.batch=true;delete entry.restoreSupported;placementBatchUndo.set(entry,{undoOps:batchInverse,redoOps:null});}this.entries.push(entry);if(restoreHandles)signedPlacementUndo.set(entry,restoreHandles);if(this.entries.length>100)this.entries.shift();this.index=this.entries.length;this.scope=clone(plan.scope);this.baseline=fingerprint(project);this.blocked=null;this.notify();
 }
 /** QA round 19: after a 412 refusal (or the one read before its retry) the
  * re-read saved project is the new baseline. The journal is kept: every older
  * step still verifies its own target against Freestyle before it is applied. */
 adoptAfterRefusal(project){
  if(this.busy)return false;let next;try{next=fingerprint(project);}catch{return false;}
  const wasBlocked=this.blocked;if(wasBlocked&&!/changed outside|did not confirm/.test(wasBlocked))return false;
  this.baseline=clone(next);this.blocked=null;historyLog('history-refusal-adopted',{entries:this.entries.length,index:this.index,unblocked:!!wasBlocked});this.notify();return true;
 }
 /** Bounded wait for unrelated queued session work; nothing is sent on timeout. */
 // A long wait here is an earlier queued session request, not this step's own write (round 11: one 13.3 s Undo).
 waitForQueue(){const started=Date.now();return bounded(this.engine.session.queue,this.queueTimeoutMs,'Freestyle is still finishing an earlier request. History was not sent; try again in a moment.').finally(()=>{const ms=Date.now()-started;if(ms>=1000)historyLog('history-queue-wait',{ms});});}
 async settleQueue(scope){await this.waitForQueue();this.assert(scope);}
 async readProject(scope){
  for(let attempt=1;;attempt++){
   this.assert(scope);
   try{return resultBody(await bounded(this.engine.session.call('get_project',{project_id:scope.projectId}),this.readTimeoutMs,'Freestyle did not return the saved project in time. History will not guess; try again.'));}
   catch(error){if(readConflict(error)){if(attempt<HISTORY_READ_ATTEMPTS){await pause(150*attempt);continue;}error.historyTransient=true;}throw error;}
  }
 }
 async read(scope){
  this.assert(scope);const e=this.engine,s=e.session,result=await bounded(s.call('execute_pro_action',{project_id:scope.projectId,track_id:scope.trackId,action:'list_patterns',arguments:{}}),this.readTimeoutMs,'Freestyle did not return the saved patterns in time. History will not guess; try again.');this.assert(scope);const body=readPatterns(result,scope);
  const rawProject={...s.rawProject,patterns:clone(body.patterns)},rawState={...s.rawState,patterns:clone(body)},project=normalizeCloudProject(rawProject,rawState,{projectId:scope.projectId,trackId:scope.trackId});this.assert(scope);
  s.rawProject=rawProject;s.rawState=rawState;s.project=project;e.accept(project);return project;
 }
 async readAudio(scope){
  this.assert(scope);const e=this.engine,s=e.session,body=await this.readProject(scope);this.assert(scope);const projected=projectAudioHistory(e,body,scope);this.assert(scope);s.rawProject=projected.rawProject;s.rawState=projected.rawState;s.project=projected.project;e.accept(projected.project);return projected.project;
 }
 async readMove(scope){
  this.assert(scope);const e=this.engine,s=e.session,body=await this.readProject(scope);this.assert(scope);const projected=projectAudioMoveHistory(e,body,scope);this.assert(scope);s.rawProject=projected.rawProject;s.rawState=projected.rawState;s.project=projected.project;e.accept(projected.project);return projected.project;
 }
 async readPlacement(scope){
  this.assert(scope);const e=this.engine,s=e.session,body=await this.readProject(scope);this.assert(scope);const projected=projectPlacementHistory(e,body,scope);this.assert(scope);s.rawProject=projected.rawProject;s.rawState=projected.rawState;s.project=projected.project;e.accept(projected.project);return projected.project;
 }
 async applyPlacement(direction,entry,scope){
  const expected=entry[direction==='undo'?'after':'before'],desired=entry[direction==='undo'?'before':'after'],op=entry.operation==='create'?(direction==='undo'?'delete':'create'):entry.operation==='delete'?(direction==='undo'?'create':'delete'):'update',action={create:'create_pattern_placement',delete:'delete_pattern_placement',update:'update_pattern_placement'}[op],operationId={create:'createPatternPlacement',delete:'deletePatternPlacement',update:'updatePatternPlacement'}[op];
  const record={sequence:++this.sequence,scope:clone(scope),kind:'placement',placementId:entry.placementId,logicalKey:entry.logicalKey,direction,status:'reading',attempted:false,request:null,receipt:null,error:null,idempotencyKey:globalThis.crypto?.randomUUID?.()||`placement-history-${Date.now()}-${Math.random().toString(36).slice(2)}`},operation={scope,record};this.records.push(record);this.operation=operation;this.notify();
  try{
   await this.settleQueue(scope);const fresh=await this.readPlacement(scope),present=fresh.clips.some(clip=>clip.cloudId===entry.placementId),actual=present?placementHistorySide(fresh,entry.placementId):null;this.assert(scope);
   if(this.drifted(fresh)||(expected?!placementHistoryEqual(actual,expected):actual!==null))throw failure('The canonical placement or project changed after this edit. History will not overwrite newer data.');
   const protectedBefore=placementProtectedProject(fresh,entry.placementId),args=placementHistoryArguments(op,op==='delete'?actual:desired,actual,{phaseWritable:entry.phaseWritable===true}),ifMatch=placementTimelineTag(this.engine.session.rawProject),eventRows=[],capture=event=>{if(event.detail?.name===action)eventRows.push(clone(event.detail));};
   if(Object.hasOwn(args.placement||{},'loopPhaseMs')&&this.engine.session.supportsPlacementPhase?.(op==='create'?'create':'update')!==true)throw failure('The generated REST contract no longer permits this retained phase write.');
   record.request={project_id:scope.projectId,track_id:scope.trackId,action,arguments:clone(args),ifMatch,idempotencyKey:record.idempotencyKey};record.status='sending';record.attempted=true;this.notify();this.engine.session.addEventListener('action',capture);
   try{record.receipt=clone(resultBody(await this.engine.session.action(action,args,{refresh:false,confirmedDestructive:op==='delete',expectedContext:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:scope.contextVersion},ifMatch,idempotencyKey:record.idempotencyKey})));}
   finally{this.engine.session.removeEventListener('action',capture);}
   this.assert(scope);if(eventRows.length!==1||eventRows[0].studioApi?.operationId!==operationId)throw failure('The placement inverse did not return one dedicated operation receipt.');
   const returnedId=placementReceiptId(record.receipt,{projectId:scope.projectId,operationId,...op==='create'?{}:{expectedId:entry.placementId}});if(op==='create'&&fresh.clips.some(clip=>clip.cloudId===returnedId))throw failure('Freestyle did not allocate a fresh recreated placement identity.');
   record.status='confirming';this.notify();const confirmed=await this.readPlacement(scope),after=op==='delete'?null:placementHistorySide(confirmed,returnedId);this.assert(scope);
   if(!same(placementProtectedProject(confirmed,returnedId),protectedBefore)||op==='delete'&&confirmed.clips.some(clip=>clip.cloudId===entry.placementId)||op==='update'&&!placementHistoryEqual(after,desired)||op==='create'&&!placementCreationEqual(desired,after,{phaseWritable:entry.phaseWritable===true}))throw failure('The acknowledged placement inverse has not confirmed its exact source, phase, routing and protected project data.');
   if(op==='create'){
    const alias=placementHistoryAlias(entry.operation==='delete'?entry.before:entry.after,after,{phaseWritable:entry.phaseWritable===true});this.rebindCloneAliases([{kind:'placement',proof:alias,phaseWritable:entry.phaseWritable===true}]);record.reboundFrom=alias.fromId;record.placementId=returnedId;
   }
   entry[direction==='undo'?'before':'after']=after;this.index+=direction==='undo'?-1:1;
   if(after){const expectedSide=direction==='undo'?'after':'before',step=direction==='undo'?-1:1;for(let index=direction==='undo'?this.index-1:this.index;index>=0&&index<this.entries.length;index+=step){const adjacent=this.entries[index];if(adjacent.kind!=='placement'||adjacent.logicalKey!==entry.logicalKey)continue;if(placementHistoryEqual(adjacent[expectedSide],after))adjacent[expectedSide]=clone(after);break;}}
   this.baseline=fingerprint(confirmed);record.status='confirmed';return{receipt:clone(record)};
  }catch(error){record.error=error.message;const rejected=!record.receipt&&[400,403,404,409,412,422,428].includes(error.status)&&error.operationUncertain!==true;record.status=!record.attempted?'not_sent':rejected?'rejected':'uncertain';if(same(scope,this.context())&&!keepsJournal(record,error))this.blocked=record.status==='uncertain'?'A placement history request is uncertain. Inspect the project; it will not be repeated.':error.message;throw Object.assign(error,{patternHistoryReceipt:clone(record),operationUncertain:record.status==='uncertain'});}
  finally{if(this.operation===operation)this.operation=null;this.notify();}
 }
 async applyPlacementRestored(direction,entry,scope){
  const deleting=entry.operation==='create'?direction==='undo':direction==='redo',action=deleting?'delete_pattern_placement':'restore_pattern_placement',operationId=deleting?'deletePatternPlacement':'restorePatternPlacement';
  const members=entry.members||[{placementId:entry.placementId,before:entry.operation==='create'?entry.after:entry.before}],handles=signedPlacementUndo.get(entry)||[],record={sequence:++this.sequence,scope:clone(scope),kind:'placement',group:members.length>1,exactRestore:true,direction,status:'reading',attempted:false,steps:[],completedCount:0,error:null},operation={scope,record};this.records.push(record);this.operation=operation;this.notify();let activeHandle;
  try{
   if(!this.engine.session.supportsPlacementRestore?.())throw failure('The advertised signed placement restore contract is no longer available.');
   await this.settleQueue(scope);let project=await this.readPlacement(scope);this.assert(scope);
   if(this.drifted(project))throw failure('The canonical project changed after this retained placement edit.');
   for(let index=0;index<members.length;index++){const member=members[index],present=project.clips.some(c=>c.cloudId===member.placementId);if(deleting?!present||!placementHistoryEqual(placementHistorySide(project,member.placementId),member.before):present)throw failure('The exact retained placement changed before signed history.');if(!deleting&&placementRestoreArguments(handles[index]).placement_id!==member.placementId)throw failure('The retained signed undo belongs to another placement.');}
   const ids=members.map(m=>m.placementId),protectedBefore=placementProtectedProject(project,ids),confirmedSides=new Map(),restoreHandles=[];
   // Writes chain on each receipt's timeline revision (If-Match), and ONE
   // canonical read confirms the whole group afterwards (not one per member).
   let ifMatch=placementTimelineTag(this.engine.session.rawProject);
   for(let index=0;index<members.length;index++){
    this.assert(scope);const member=members[index];activeHandle=handles[index];const args=deleting?{placement_id:member.placementId}:placementRestoreArguments(activeHandle),step={placementId:member.placementId,status:'sending',request:{project_id:scope.projectId,track_id:scope.trackId,action,arguments:redactPlacementRestoreSecrets(args,activeHandle),ifMatch,idempotencyKey:globalThis.crypto?.randomUUID?.()||`placement-restore-${Date.now()}-${Math.random().toString(36).slice(2)}`},receipt:null},events=[],capture=e=>{if(e.detail?.name===action)events.push(clone(e.detail));};record.steps.push(step);record.attempted=true;record.status='sending';this.notify();this.engine.session.addEventListener('action',capture);let revision;
    try{step.receipt=redactPlacementRestoreSecrets(resultBody(await this.engine.session.action(action,args,{refresh:false,confirmedDestructive:deleting,expectedContext:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:scope.contextVersion},ifMatch:step.request.ifMatch,idempotencyKey:step.request.idempotencyKey,placementRestoreHandle:activeHandle,onTimelineRevision:value=>{revision=value;}})),activeHandle);step.status='acknowledged';record.completedCount++;}finally{this.engine.session.removeEventListener('action',capture);}
    this.assert(scope);if(events.length!==1||events[0].studioApi?.operationId!==operationId)throw failure('Each signed history step needs its dedicated operation acknowledgement.');
    if(deleting){placementReceiptId(step.receipt,{projectId:scope.projectId,operationId,expectedId:member.placementId});handles[index]=this.engine.session.placementDeleteUndo(step.receipt,member.placementId);signedPlacementUndo.set(entry,handles);}else{validatePlacementRestore(activeHandle,step.receipt);restoreHandles[index]=activeHandle;}
    if(revision!==undefined)ifMatch=JSON.stringify(revision);else{project=await this.readPlacement(scope);this.assert(scope);ifMatch=placementTimelineTag(this.engine.session.rawProject);}
    this.notify();
   }
   activeHandle=undefined;record.status='confirming';this.notify();project=await this.readPlacement(scope);this.assert(scope);
   for(let index=0;index<members.length;index++){const member=members[index],present=project.clips.some(c=>c.cloudId===member.placementId);if(deleting){if(present)throw failure('A retained placement changed during signed deletion.');continue;}if(!present)throw failure('A retained placement changed during signed restoration.');const side=placementHistorySide(project,member.placementId);activeHandle=restoreHandles[index];validatePlacementRestore(activeHandle,record.steps[index].receipt,side);activeHandle=undefined;if(!placementHistoryEqual(side,member.before))throw failure('The signed restore changed retained placement metadata.');confirmedSides.set(member.placementId,side);}
   if(!same(placementProtectedProject(project,ids),protectedBefore))throw failure('Signed placement history changed unrelated saved project data.');for(const step of record.steps)step.status='confirmed';this.notify();
   if(!deleting){if(entry.members)for(const member of entry.members)member.before=clone(confirmedSides.get(member.placementId));else entry[direction==='undo'?'before':'after']=clone(confirmedSides.get(entry.placementId));}
   this.index+=direction==='undo'?-1:1;this.baseline=fingerprint(project);record.status='confirmed';return{receipt:clone(record)};
  }catch(rawError){const safe=redactPlacementRestoreSecrets(rawError,activeHandle),error=Object.assign(new Error(safe.message||'The signed placement history operation failed.'),safe);record.error=error.message;const step=record.steps.at(-1),rejected=!step?.receipt&&[400,403,404,409,412,422,428].includes(error.status)&&error.operationUncertain!==true;if(step&&step.status!=='confirmed'){step.status=rejected?'rejected':'unconfirmed';step.error=error.message;}record.status=!record.attempted?'not_sent':rejected&&record.completedCount===0?'rejected':'uncertain';record.partial=record.completedCount>0&&record.completedCount<members.length;if(same(scope,this.context())&&!keepsJournal(record,error))this.blocked=record.status==='uncertain'?'Signed placement history is partially saved or uncertain. Inspect its retained receipts; it will not be repeated.':error.message;throw Object.assign(error,{patternHistoryReceipt:clone(record),operationUncertain:record.status==='uncertain'});}
  finally{if(this.operation===operation)this.operation=null;this.notify();}
 }
 async applyPlacementGroup(direction,entry,scope){
  // A deletion group is restored by Undo; a creation group (Paint stroke,
  // multi-clip Paste) is recreated by Redo. Each member is its own guarded write.
  const restoring=entry.operation==='create'?direction==='redo':direction==='undo',action=restoring?'create_pattern_placement':'delete_pattern_placement',operationId=restoring?'createPatternPlacement':'deletePatternPlacement',members=clone(entry.members);
  const record={sequence:++this.sequence,scope:clone(scope),kind:'placement',group:true,direction,status:'reading',attempted:false,steps:[],completedCount:0,error:null},operation={scope,record};this.records.push(record);this.operation=operation;this.notify();
  try{
   await this.settleQueue(scope);let project=await this.readPlacement(scope);this.assert(scope);
   if(this.drifted(project))throw failure('The project changed after the retained placement group. Undo newer edits before this group.');
   for(const member of members){const present=project.clips.some(clip=>clip.cloudId===member.placementId);if(restoring?present:!present||!placementHistoryEqual(placementHistorySide(project,member.placementId),member.before))throw failure('The exact retained placement group changed before history.');placementCreationBody(member.before,{phaseWritable:entry.phaseWritable===true});}
   const originalIds=members.map(member=>member.placementId),protectedBefore=placementProtectedProject(project,originalIds),initialIds=new Set(project.clips.map(clip=>clip.cloudId)),restored=[],returnedIds=[];
   // One guarded write per member, chained by the timeline revision each receipt
   // returns (If-Match: any foreign change between members is a 412 and nothing
   // more is sent), then ONE canonical read confirms the whole group. Re-reading
   // the full project after every member made a 7-clip Paint Undo take ~6 s.
   let ifMatch=placementTimelineTag(this.engine.session.rawProject);
   for(const member of members){
    this.assert(scope);if(restoring&&entry.phaseWritable&&this.engine.session.supportsPlacementPhase?.('create')!==true)throw failure('The generated REST contract no longer permits this retained phase creation.');const args=placementHistoryArguments(restoring?'create':'delete',member.before,undefined,{phaseWritable:entry.phaseWritable===true}),step={placementId:member.placementId,status:'sending',request:{project_id:scope.projectId,track_id:scope.trackId,action,arguments:clone(args),ifMatch,idempotencyKey:globalThis.crypto?.randomUUID?.()||`placement-group-${Date.now()}-${Math.random().toString(36).slice(2)}`},receipt:null};record.steps.push(step);record.attempted=true;record.status='sending';this.notify();
    const events=[],capture=event=>{if(event.detail?.name===action)events.push(clone(event.detail));};this.engine.session.addEventListener('action',capture);let revision;
    try{step.receipt=clone(resultBody(await this.engine.session.action(action,args,{refresh:false,confirmedDestructive:!restoring,expectedContext:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:scope.contextVersion},ifMatch:step.request.ifMatch,idempotencyKey:step.request.idempotencyKey,onTimelineRevision:value=>{revision=value;}})));step.status='acknowledged';record.completedCount++;}
    finally{this.engine.session.removeEventListener('action',capture);}
    this.assert(scope);if(events.length!==1||events[0].studioApi?.operationId!==operationId)throw failure('Each placement group step needs its dedicated operation acknowledgement.');
    const returnedId=placementReceiptId(step.receipt,{projectId:scope.projectId,operationId,...restoring?{}:{expectedId:member.placementId}});if(restoring&&(initialIds.has(returnedId)||returnedIds.includes(returnedId)))throw failure('Freestyle did not allocate a fresh placement group identity.');step.returnedId=returnedId;returnedIds.push(returnedId);
    // A receipt without a revision cannot chain the next guarded write: read it.
    if(revision!==undefined)ifMatch=JSON.stringify(revision);else{project=await this.readPlacement(scope);this.assert(scope);ifMatch=placementTimelineTag(this.engine.session.rawProject);}
    this.notify();
   }
   record.status='confirming';this.notify();project=await this.readPlacement(scope);this.assert(scope);
   if(restoring){for(let index=0;index<members.length;index++){const member=members[index],side=placementHistorySide(project,returnedIds[index]);if(!placementCreationEqual(member.before,side,{phaseWritable:entry.phaseWritable===true}))throw failure('The recreated group member has different source, timing or routing.');restored.push({side,alias:placementHistoryAlias(member.before,side,{phaseWritable:entry.phaseWritable===true})});}}
   else if(members.some(member=>project.clips.some(clip=>clip.cloudId===member.placementId)))throw failure('A retained group member is still present after its deletion.');
   if(!same(placementProtectedProject(project,restoring?restored.map(item=>item.side.placementId):originalIds),protectedBefore))throw failure('The placement group history changed unrelated saved project data.');
   for(const step of record.steps)step.status='confirmed';this.notify();
   if(restoring){for(const item of restored)this.rebindCloneAliases([{kind:'placement',proof:item.alias,phaseWritable:entry.phaseWritable===true}]);for(let index=0;index<entry.members.length;index++){entry.members[index].placementId=restored[index].side.placementId;entry.members[index].before=clone(restored[index].side);}record.rebound=restored.map(item=>({fromId:item.alias.fromId,toId:item.alias.toId}));}
   this.index+=direction==='undo'?-1:1;this.baseline=fingerprint(project);record.status='confirmed';return{receipt:clone(record)};
  }catch(error){record.error=error.message;const step=record.steps.at(-1),rejected=!step?.receipt&&[400,403,404,409,412,422,428].includes(error.status)&&error.operationUncertain!==true;if(step&&step.status!=='confirmed'){step.status=rejected?'rejected':'unconfirmed';step.error=error.message;}record.status=!record.attempted?'not_sent':rejected&&record.completedCount===0?'rejected':'uncertain';record.partial=record.completedCount>0&&record.completedCount<members.length;if(same(scope,this.context())&&!keepsJournal(record,error))this.blocked=record.status==='uncertain'?'Placement group history is partially saved or uncertain. Inspect its retained step receipts; it will not be repeated.':error.message;throw Object.assign(error,{patternHistoryReceipt:clone(record),operationUncertain:record.status==='uncertain'});}
  finally{if(this.operation===operation)this.operation=null;this.notify();}
 }
 async applyPlaylistMove(direction,entry,scope){
  const record={sequence:++this.sequence,scope:clone(scope),kind:'playlist_move',direction},operation={scope,record};this.records.push(record);this.operation=operation;this.notify();
  try{
   await this.settleQueue(scope);
   const members=entry.members.map(member=>({...clone(member),before:clone(member[direction==='undo'?'after':'before']),after:clone(member[direction==='undo'?'before':'after']),...(member.kind==='audio'?{inverse:clone(member[direction==='undo'?'undoInverse':'redoInverse'])}:{})})),plan={members,checkpoint:playlistMoveProtected(this.engine.project),protected:playlistMoveProtected(this.engine.project,members)};let first=true;
   const project=await executePlaylistMove({session:this.engine.session,plan,scope:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:scope.contextVersion},record,assert:()=>this.assert(scope),onChange:()=>this.notify(),read:async()=>{const fresh=await this.readPlacement(scope);if(first){first=false;if(this.drifted(fresh))throw failure('The project changed outside the retained selected move.');}return fresh;}});
   // Confirmed from the batch receipt (no read): the engine adopts the projected saved project, as a read would.
   if(record.confirmedFromReceipt)this.engine.accept(project);
   for(let index=0;index<entry.members.length;index++){entry.members[index][direction==='undo'?'before':'after']=clone(record.members[index].after);if(entry.members[index].kind==='audio')entry.members[index][direction==='undo'?'redoInverse':'undoInverse']=clone(record.steps[index].inverse);}
   this.index+=direction==='undo'?-1:1;this.baseline=fingerprint(project);return{receipt:clone(record)};
  }catch(error){if(same(scope,this.context())&&!keepsJournal(record,error))this.blocked=record.status==='uncertain'?'The selected Playlist move is partially saved or uncertain. Inspect its retained receipts; it will not be repeated.':error.message;throw Object.assign(error,{patternHistoryReceipt:clone(record)});}
  finally{if(this.operation===operation)this.operation=null;this.notify();}
 }
 async applyMove(direction,entry,scope){
  const expected=entry[direction==='undo'?'after':'before'],desired=entry[direction==='undo'?'before':'after'],inverse=entry[direction==='undo'?'undoInverse':'redoInverse'];
  const record={sequence:++this.sequence,scope:clone(scope),kind:'audio_move',clipId:entry.clipId,direction,status:'reading',attempted:false,request:null,receipt:null,error:null,idempotencyKey:globalThis.crypto?.randomUUID?.()||`move-history-${Date.now()}-${Math.random().toString(36).slice(2)}`},operation={scope,record};this.records.push(record);this.operation=operation;this.notify();
  try{
   await this.settleQueue(scope);const fresh=await this.readMove(scope),actual=audioMoveSide(fresh,entry.clipId),protectedBefore=audioMoveProtectedProject(fresh,entry.clipId);this.assert(scope);
   if(this.drifted(fresh)||!audioMoveEqual(actual,expected))throw failure('The canonical audio clip or project changed after this move. History will not overwrite newer data.');
   const args=audioMoveArguments(inverse,actual),ifMatch=audioMoveTimelineTag(this.engine.session.rawProject),eventRows=[],capture=event=>{if(event.detail?.name==='move_clip_to_lane')eventRows.push(clone(event.detail));};
   if(args.lane_id!==desired.laneId||args.start_ms!==desired.geometry.start_ms)throw failure('The retained server inverse does not restore this move history side.');
   record.request={project_id:scope.projectId,track_id:scope.trackId,action:'move_clip_to_lane',arguments:clone(args),ifMatch,idempotencyKey:record.idempotencyKey};record.status='sending';record.attempted=true;this.notify();
   this.engine.session.addEventListener('action',capture);
   try{record.receipt=clone(resultBody(await this.engine.session.action('move_clip_to_lane',args,{refresh:false,expectedContext:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:scope.contextVersion},ifMatch,idempotencyKey:record.idempotencyKey})));}
   finally{this.engine.session.removeEventListener('action',capture);}
   this.assert(scope);record.status='confirming';this.notify();const confirmed=await this.readMove(scope),after=audioMoveSide(confirmed,entry.clipId);this.assert(scope);
   if(!audioMoveEqual(after,desired)||!same(audioMoveProtectedProject(confirmed,entry.clipId),protectedBefore))throw failure('The acknowledged lane move has not confirmed the exact saved lane, timing and source metadata.');
   if(eventRows.length!==1)throw failure('The lane move did not return one dedicated REST operation receipt.');
   const nextInverse=audioMoveInverse(record.receipt,actual,after,{projectId:scope.projectId,operationId:eventRows[0].studioApi?.operationId});
   entry[direction==='undo'?'redoInverse':'undoInverse']=nextInverse;entry[direction==='undo'?'before':'after']=after;this.index+=direction==='undo'?-1:1;this.baseline=fingerprint(confirmed);record.status='confirmed';record.engineReloadRequired=record.receipt.engine_reload_required;return{receipt:clone(record)};
  }catch(error){record.error=error.message;const rejected=[400,403,404,409,412,422,428].includes(error.status)&&error.operationUncertain!==true;record.status=!record.attempted?'not_sent':rejected?'rejected':'uncertain';if(same(scope,this.context())&&!keepsJournal(record,error))this.blocked=record.status==='uncertain'?'A lane move history request is uncertain. Inspect the project; it will not be repeated.':error.message;throw Object.assign(error,{patternHistoryReceipt:clone(record),operationUncertain:record.status==='uncertain'});}
  finally{if(this.operation===operation)this.operation=null;this.notify();}
 }
 beginPlaylistClone(controller){
  if(this.busy)throw failure('Wait for the current history operation.');const scope=this.capture();if(this.records.some(record=>record.kind==='playlist_clone'&&record.status==='uncertain'&&same(record.scope,scope)))throw failure('A Playlist clone is uncertain. Reopen the project and inspect its retained copies before cloning again.');this.observe(this.engine.project);const token={scope:clone(scope),controller,before:fingerprint(this.engine.project)};this.operation={scope,external:token};this.notify();return token;
 }
 finishPlaylistClone(token){
  if(this.operation?.external!==token)throw failure('The retained clone history operation changed.');this.assert(token.scope);const state=token.controller.snapshot();if(state.status!=='committed')throw failure('Confirm every saved clone before publishing its history.');if(this.blocked){this.entries=[];this.index=0;}this.entries=this.entries.slice(0,this.index);const externalId=++this.sequence;this.externalEntries.set(externalId,token.controller);this.entries.push({kind:'playlist_clone',externalId});if(this.entries.length>100)this.entries.shift();this.index=this.entries.length;this.scope=clone(token.scope);this.baseline=fingerprint(this.engine.project);this.blocked=null;this.operation=null;this.notify();
 }
 failPlaylistClone(token,error){if(this.operation?.external!==token)return;const state=token.controller.snapshot();if(same(token.scope,this.context())){this.baseline=fingerprint(this.engine.project);if(state.attempted)this.blocked='A Playlist clone is partially saved or uncertain. Inspect its retained copies before using older history.';}this.records.push({kind:'playlist_clone',scope:clone(token.scope),status:state.attempted?'uncertain':'not_sent',error:error.message,receipt:state});this.operation=null;this.notify();}
 // These controllers own canonical create/delete/restore proofs. This journal
 // owns their ordering with existing edits and their in-progress refreshes.
 // A recorded take reuses the audio-import proofs (clips:batch remove / server restore) but is its own
 // history step kind for the user: source 'recording', label “Record” (Undo Record / Redo Record).
 beginAudioImport(controller,{source=null}={}){return this.beginExternalCreation(controller,'audio_import',{source});}
 beginRecording(controller){return this.beginAudioImport(controller,{source:'recording'});}
 beginLaneCreate(controller){return this.beginExternalCreation(controller,'lane_create');}
 beginExternalCreation(controller,kind,{source=null}={}){
  const label=creationLabel(kind);
  if(this.busy)throw failure('Wait for the current history operation.','pattern_history_busy');
  if(!controller||['snapshot','fresh','undo','redo'].some(method=>typeof controller[method]!=='function')||controller.busy)throw failure(`Prepare an idle ${label} history controller.`);
  const scope=this.capture(),state=controller.snapshot();this.assertExternalCreationScope(state,scope,label);
  if(state.status!=='idle'||state.knownNotApplied!==true)throw failure(`Prepare a new ${label} controller before creating.`);
  if(this.records.some(record=>record.status==='uncertain'&&same(record.scope,scope)))throw failure('A retained history request is uncertain. Inspect the saved project before creating again.');
  this.observe(this.engine.project);const token={kind,scope:clone(scope),controller,before:fingerprint(this.engine.project),...Object.hasOwn(creationSources,source??'')?{source,label:creationSources[source]}:{}};this.operation={scope,external:token};this.notify();return token;
 }
 assertExternalCreationScope(state,scope,label){
  if(!state?.scope||Object.keys(scope).some(key=>state.scope[key]!==scope[key]))throw failure(`The ${label} belongs to a different cloud project context.`,'pattern_history_scope_changed',{name:'AbortError'});
 }
 finishAudioImport(token){return this.finishExternalCreation(token,'audio_import');}
 finishLaneCreate(token){return this.finishExternalCreation(token,'lane_create');}
 finishExternalCreation(token,kind){
  const label=creationLabel(kind);
  if(this.operation?.external!==token||token.kind!==kind)throw failure(`The retained ${label} history operation changed.`);
  this.assert(token.scope);const state=token.controller.snapshot();this.assertExternalCreationScope(state,token.scope,label);
  if(token.controller.busy||state.status!=='committed')throw failure(`Confirm the saved ${label} before publishing its history.`);
  if(this.blocked){this.entries=[];this.index=0;}this.entries=this.entries.slice(0,this.index);const externalId=++this.sequence;this.externalEntries.set(externalId,token.controller);this.entries.push({kind,externalId,...token.label?{label:token.label,source:token.source}:{}});if(this.entries.length>100)this.entries.shift();this.index=this.entries.length;this.scope=clone(token.scope);this.baseline=fingerprint(this.engine.project);this.blocked=null;this.operation=null;this.notify();
 }
 failAudioImport(token,error){return this.failExternalCreation(token,error,'audio_import');}
 failLaneCreate(token,error){return this.failExternalCreation(token,error,'lane_create');}
 failExternalCreation(token,error,kind){
  const label=creationLabel(kind);
  if(this.operation?.external!==token||token.kind!==kind)return;
  const state=token.controller.snapshot(),sameContext=same(token.scope,this.context());let unchanged=false;
  if(sameContext)try{unchanged=same(token.before,fingerprint(this.engine.project));}catch{}
  const notApplied=state.knownNotApplied===true&&unchanged;
  if(sameContext&&!notApplied)this.blocked=`The ${label} is saved or uncertain. Inspect its retained outcome before using older history.`;
  this.records.push({kind,scope:clone(token.scope),status:notApplied?'not_applied':'uncertain',error:error?.message||state.error||`${label} did not confirm.`,receipt:clone(state)});this.operation=null;this.notify();
 }
 applyAudioImport(direction,entry,scope){return this.applyExternalCreation(direction,entry,scope);}
 applyLaneCreate(direction,entry,scope){return this.applyExternalCreation(direction,entry,scope);}
 async applyExternalCreation(direction,entry,scope){
  const kind=entry.kind,label=creationLabel(kind);
  const controller=this.externalEntries.get(entry.externalId);if(!controller)throw failure(`Reload the retained ${label} history.`);
  const record={kind,scope:clone(scope),direction,status:'reading'},operation={scope,record};this.operation=operation;this.records.push(record);this.notify();
  try{
   await this.settleQueue(scope);this.assertExternalCreationScope(controller.snapshot(),scope,label);
   if(controller.busy)throw failure(`Wait for the current ${label} operation.`);
   if(controller.snapshot().status!==(direction==='undo'?'committed':'undone'))throw failure(`The retained ${label} is not ready for this history operation.`);
   // QA round 21 speed: this one read is also the controller's before-state (it used to read again).
   const before=await controller.fresh();this.assert(scope);this.assertExternalCreationScope(controller.snapshot(),scope,label);
   if(this.drifted(this.engine.project))throw failure(`The project changed outside retained history. Undo newer edits before its ${label}.`);
   controller.freshBefore=before;
   record.status='sending';this.notify();const result=await controller[direction]();this.assert(scope);const state=controller.snapshot();this.assertExternalCreationScope(state,scope,label);
   if(controller.busy||state.status!==(direction==='undo'?'undone':'committed'))throw failure(`The ${label} history operation has not confirmed its saved outcome.`,kind+'_history_unconfirmed',{operationUncertain:true});
   this.index+=direction==='undo'?-1:1;this.baseline=fingerprint(this.engine.project);record.status='confirmed';record.receipt=clone(result);return{receipt:clone(record)};
  }catch(error){
   const state=controller.snapshot();record.status=error.operationUncertain===true||state.status==='uncertain'||record.status==='sending'&&state.knownNotApplied!==true?'uncertain':'not_applied';record.error=error.message;record.receipt=clone(state);if(same(scope,this.context())&&!keepsJournal(record,error))this.blocked=record.status==='uncertain'?`The ${label} history request is uncertain. Inspect its retained outcome; it will not be repeated.`:error.message;
   throw Object.assign(error,{patternHistoryReceipt:clone(record),operationUncertain:record.status==='uncertain'});
  }finally{if(this.operation===operation)this.operation=null;this.notify();}
 }
 /** An edit owned by another controller that CREATES saved entities (lanes,
  * placements, automation envelopes) and refreshes the open project while it
  * saves. FL never loses history: begin before the first write, so those
  * refreshes are expected rather than "changed outside history"; finish
  * records the whole edit as ONE external step on top of every older step;
  * fail keeps the journal intact when the saved project is unchanged (only a
  * partial or uncertain outcome blocks older steps, which could otherwise
  * overwrite it). History presses wait (nothing is blocked) meanwhile. */
 beginExternalStep({kind,label='edit'}={}){
  if(typeof kind!=='string'||!kind)throw failure('An external history step needs its kind.');
  if(this.busy||this.reserved.length||this.externalPending)throw failure('Wait for the current history operation.','pattern_history_busy');
  const scope=this.context();this.observe(this.engine.project);let before=null;try{before=fingerprint(this.engine.project);}catch{}
  const token={kind,label,scope:clone(scope),before};this.externalPending=token;historyLog('history-external-begin',{kind,label,index:this.index,entries:this.entries.length});this.notify();return token;
 }
 finishExternalStep(token,step={}){
  if(!token||this.externalPending!==token){historyLog('history-external-dropped',{kind:token?.kind??null,reason:'not_pending'});return false;}
  this.externalPending=null;if(!same(token.scope,this.context())){historyLog('history-external-dropped',{kind:token.kind,reason:'scope_changed'});this.notify();return false;}
  return this.recordExternalStep({kind:token.kind,label:token.label,...step,scope:token.scope});
 }
 failExternalStep(token,error){
  if(!token||this.externalPending!==token)return;this.externalPending=null;
  if(same(token.scope,this.context())){let unchanged=false;try{unchanged=!!token.before&&same(token.before,fingerprint(this.engine.project));}catch{}
   if(!unchanged||error?.operationUncertain===true&&!refusedBeforeSend(error))this.invalidate(`The ${token.label} is partially saved or uncertain. Inspect it before using older history.`,{force:true,code:'external_step_unconfirmed:'+token.kind});
   else historyLog('history-external-not-applied',{kind:token.kind,error:String(error?.message||'').slice(0,200)});}
  this.notify();
 }
 /** A score edit saved by another writer (Channel Rack Cut/Delete/Paste: one
  * canonical update_pattern) recorded as an ordinary single-pattern step, so
  * Undo/Redo, instant previews and the exact sources/events restore are the
  * same as a step toggle's. Begin before the write (its refresh is then this
  * step, never "changed outside"); finish after the writer confirmed it. */
 beginPatternStep({patternId,label}={}){
  if(!id(patternId))throw failure('A pattern history step needs its saved pattern.');
  const token=this.beginExternalStep({kind:'pattern_score',label});
  try{token.patternId=patternId;token.patternBefore=side(this.engine.project,patternId);}catch(error){this.externalPending=null;this.notify();throw error;}
  return token;
 }
 finishPatternStep(token){
  if(!token||this.externalPending!==token||!token.patternBefore){historyLog('history-external-dropped',{kind:token?.kind??null,reason:'not_pending'});return false;}
  this.externalPending=null;const current=this.context();
  if(!same(token.scope,current)){historyLog('history-external-dropped',{kind:token.kind,reason:'scope_changed'});this.notify();return false;}
  let after,next;try{after=side(this.engine.project,token.patternId);next=fingerprint(this.engine.project);}catch(error){this.invalidate('Reload the complete canonical pattern before using history.',{force:true,code:'external_step_unconfirmed:'+token.kind});return false;}
  // Only this pattern's score (and the placements' embedded copies of it) may differ.
  const others=fp=>({...fp,patterns:fp.patterns.filter(row=>row.id!==token.patternId),outside:{...fp.outside,clips:(fp.outside.clips||[]).map(clip=>{const raw=clip?.cloudRaw;if(!object(raw)||!object(raw.pattern)||(raw.patternId??raw.pattern_id??raw.pattern.id)!==token.patternId)return clip;const {pattern,...rest}=raw;return{...clip,cloudRaw:rest};})}});
  if(!token.before||!same(others(token.before),others(next))){this.invalidate(`The ${token.label} changed more than its pattern score. Inspect it before using older history.`,{force:true,code:'external_step_unconfirmed:'+token.kind,paths:token.before?driftPaths(others(token.before),others(next)):undefined});this.baseline=next;return false;}
  if(same(after.serialized,token.patternBefore.serialized)&&same(after.canonical,token.patternBefore.canonical)){historyLog('history-external-not-applied',{kind:token.kind,reason:'unchanged'});this.baseline=next;this.notify();return false;}
  if(this.records.some(record=>same(record.scope,current)&&record.status==='uncertain')){this.invalidate('A pattern history request is uncertain. Reopen the project before making another history request.');this.baseline=next;return false;}
  if(this.blocked){this.entries=[];this.index=0;}this.entries=this.entries.slice(0,this.index);
  this.entries.push({kind:'pattern',patternId:token.patternId,before:clone(token.patternBefore),after:clone(after),...token.label?{label:token.label}:{}});if(this.entries.length>100)this.entries.shift();this.index=this.entries.length;this.scope=clone(current);this.baseline=next;this.blocked=null;
  historyLog('history-external-recorded',{kind:token.kind,label:token.label,detail:{patternId:token.patternId},index:this.index,entries:this.entries.length});this.notify();return true;
 }
 /** FL: a new edit owned by another history (audio clipboard, slice, clip
  * mute) clears this journal's redo tail too: one global order of steps. */
 /** FL: a pattern length change (Patterns > Length, a Piano note past the
  * end) and the resize of the Playlist clips that follow that length are ONE
  * step. The resize is saved right after the pattern step by another writer;
  * it attaches to that same journal entry (no new entry, so the app's ordered
  * history line still sees one step). Undo restores the clips, then the
  * pattern; Redo the pattern, then the clips. */
 beginFollow(patternId){
  const entry=this.entries[this.index-1];
  if(this.busy||this.reserved.length||this.externalPending||this.blocked||this.index!==this.entries.length||entry?.kind!=='pattern'||entry.patternId!==patternId||entry.follow)return null;
  let before=null;try{before=fingerprint(this.engine.project);}catch{}
  const token={kind:'pattern_follow',label:this.labelFor(entry),scope:clone(this.context()),entry,before};this.externalPending=token;historyLog('history-follow-begin',{patternId,index:this.index});this.notify();return token;
 }
 finishFollow(token,{undo,redo,detail=null}={}){
  if(!token||this.externalPending!==token||typeof undo!=='function'||typeof redo!=='function'){historyLog('history-external-dropped',{kind:'pattern_follow',reason:'not_pending'});return false;}
  this.externalPending=null;
  if(!same(token.scope,this.context())||this.entries[this.index-1]!==token.entry){historyLog('history-external-dropped',{kind:'pattern_follow',reason:'scope_or_entry_changed'});this.notify();return false;}
  if(!this.adoptFollowDrift()){this.notify();return false;}
  token.entry.follow={undo,redo,detail:clone(detail)};historyLog('history-follow-attached',{patternId:token.entry.patternId,label:token.label,detail});this.notify();return true;
 }
 failFollow(token,error){return this.failExternalStep(token,error);}
 /** After a follow write: only placement rows may differ from the baseline. */
 adoptFollowDrift({strict=true}={}){
  let next;try{next=fingerprint(this.engine.project);}catch{this.invalidate('Reload the complete canonical pattern before using history.',{force:true,code:'follow_unconfirmed'});return false;}
  const others=fp=>({...fp,outside:{...fp.outside,clips:undefined},savedMetadata:{...fp.savedMetadata,counts:undefined}});
  if(this.baseline&&!same(others(this.baseline),others(next))){if(!strict)return false;this.invalidate('The project changed while the pattern clips followed the pattern length. Reopen the project before using older history.',{force:true,code:'follow_unconfirmed',paths:driftPaths(this.baseline,next)});return false;}
  this.baseline=next;return true;
 }
 async applyPatternWithFollow(direction,entry,scope){
  const runFollow=async side=>{const operation={scope,record:{kind:'pattern_follow',direction:side}};this.operation=operation;try{return await entry.follow[side]();}finally{if(this.operation===operation)this.operation=null;}};
  const pattern=async()=>{this.followApplying=true;try{return await this.applyStep(direction);}finally{this.followApplying=false;}};
  if(direction==='undo'){
   // Clips first: a refused (unchanged) clip restore refuses the whole step.
   try{await runFollow('undo');}catch(error){if(error?.dispatched!==false&&error?.historyNotApplied!==true){this.blocked='Restoring the pattern clips’ length is uncertain. Reopen the project to inspect it; it will not be repeated.';this.notify();}throw error;}
   if(!this.adoptFollowDrift({strict:false})){
    // Something besides the clips changed: put the clips back and refuse, like the pattern step would.
    const refusal=failure('The canonical pattern changed after this edit. Its history will not overwrite newer data.');
    try{await runFollow('redo');}catch{this.blocked='The pattern clips were restored, but the step was refused. Reopen the project to inspect it.';this.notify();throw refusal;}
    this.blocked=refusal.message;this.notify();throw refusal;
   }
   try{return await pattern();}catch(error){
    // The pattern step did not land: put the clips back so the step stays whole.
    if(error?.operationUncertain!==true){try{await runFollow('redo');if(this.adoptFollowDrift()){this.notify();throw error;}}catch(rollback){if(rollback!==error){this.blocked='The pattern clips were restored, but the pattern length was not. Reopen the project to inspect it.';this.notify();}}}
    throw error;
   }
  }
  const result=await pattern();
  try{await runFollow('redo');}catch(error){
   // The pattern is redone; a refused clip fit (the clip changed since) leaves
   // that clip as it is. Anything uncertain stops older history.
   if(error?.dispatched!==false&&error?.historyNotApplied!==true){this.blocked='Fitting the pattern clips is uncertain. Reopen the project to inspect it; it will not be repeated.';this.notify();throw error;}
   historyLog('history-follow-refused',{direction,error:String(error?.message||'').slice(0,200)});
  }
  this.adoptFollowDrift();this.notify();return result;
 }
 dropRedo(reason='new_step'){if(this.busy||this.reserved.length||this.index>=this.entries.length)return false;const dropped=this.entries.length-this.index;this.entries=this.entries.slice(0,this.index);historyLog('history-redo-dropped',{reason,dropped,index:this.index});this.notify();return true;}
 /** A completed edit owned by another controller (e.g. one Mixer gesture),
  * ordered in this journal with pattern/placement steps. `undo`/`redo` perform
  * one guarded saved write each and must refuse (dispatched:false) when the
  * saved value is no longer the side they expect; they never retry.
  * Optional instant (FL) previews: `previewModel(direction,raw)` mutates a
  * clone of the saved rows into the step's expected result and returns true;
  * `previewUi(direction)` updates non-model UI and returns its revert.
  * `cascade` {before,after}: the placement mute/solo echo of each direction. */
 recordExternalStep({kind,label='edit',scope,undo,redo,detail=null,previewModel=null,previewUi=null,cascade=null}={}){
  if(typeof undo!=='function'||typeof redo!=='function'||typeof kind!=='string'||!kind)throw failure('An external history step needs its kind and guarded Undo/Redo.');
  const current=this.context();if(scope&&!same(scope,current)){historyLog('history-external-dropped',{kind,reason:'scope_changed'});return false;}
  if(this.busy||this.reserved.length||this.externalPending){historyLog('history-external-dropped',{kind,reason:'history_busy'});return false;}
  if(!same(this.scope,current))this.observe(this.engine.project);
  {const uncertain=this.records.find(record=>same(record.scope,current)&&record.status==='uncertain');if(uncertain){historyLog('history-external-dropped',{kind,reason:'uncertain_record',record:{kind:uncertain.kind??null,stepKind:uncertain.stepKind??null,direction:uncertain.direction??null,error:String(uncertain.error||'').slice(0,160)}});return false;}}
  if(this.blocked){this.entries=[];this.index=0;}this.entries=this.entries.slice(0,this.index);const externalId=++this.sequence;this.externalEntries.set(externalId,{kind,label,undo,redo,detail:clone(detail),previewModel:typeof previewModel==='function'?previewModel:null,previewUi:typeof previewUi==='function'?previewUi:null,cascade:cascade&&typeof cascade==='object'?clone(cascade):null});if(cascade?.after)this.expectCascade(cascade.after);
  this.entries.push({kind:'external_step',stepKind:kind,externalId});if(this.entries.length>100)this.entries.shift();this.index=this.entries.length;this.scope=clone(current);try{this.baseline=fingerprint(this.engine.project);}catch{}this.blocked=null;
  historyLog('history-external-recorded',{kind,label,detail,index:this.index,entries:this.entries.length});this.notify();return true;
 }
 /** Rename track Undo/Redo: one guarded updateLane name write, confirmed by a fresh read. */
 async applyLaneRename(direction,entry,scope){
  const expected=entry[direction==='undo'?'after':'before'],desired=entry[direction==='undo'?'before':'after'];
  const record={sequence:++this.sequence,scope:clone(scope),kind:'lane_rename',laneId:entry.laneId,direction,status:'reading',attempted:false,request:null,receipt:null,error:null,idempotencyKey:globalThis.crypto?.randomUUID?.()||`rename-history-${Date.now()}-${Math.random().toString(36).slice(2)}`},operation={scope,record};this.records.push(record);this.operation=operation;this.notify();
  try{
   await this.settleQueue(scope);const fresh=await this.readPlacement(scope);this.assert(scope);
   if(this.drifted(fresh)||savedLaneName(fresh,entry.laneId)!==expected)throw failure('The track name changed after this rename. History will not overwrite newer data.');
   const raw=this.engine.session.rawProject,ifMatch=typeof raw?._studioApi?.etag==='string'&&raw._studioApi.etag?raw._studioApi.etag:placementTimelineTag(raw);
   record.request={project_id:scope.projectId,action:'rename_track',arguments:{track_id:entry.laneId,label:desired},ifMatch,idempotencyKey:record.idempotencyKey};record.status='sending';record.attempted=true;this.notify();
   record.receipt=clone(resultBody(await this.engine.session.action('rename_track',{track_id:entry.laneId,label:desired},{refresh:false,expectedContext:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:scope.contextVersion},ifMatch,idempotencyKey:record.idempotencyKey})));this.assert(scope);
   record.status='confirming';this.notify();const confirmed=await this.readPlacement(scope);this.assert(scope);
   if(savedLaneName(confirmed,entry.laneId)!==desired)throw failure('Freestyle acknowledged the rename, but the saved track name has not confirmed it.');
   this.index+=direction==='undo'?-1:1;this.baseline=fingerprint(confirmed);record.status='confirmed';return{receipt:clone(record)};
  }catch(error){record.error=error.message;record.status=record.attempted?'uncertain':'not_sent';if(record.attempted&&same(scope,this.context()))this.blocked='A track rename history request is uncertain. Reopen the project to inspect it; it will not be repeated.';throw Object.assign(error,{patternHistoryReceipt:clone(record),operationUncertain:record.attempted});}
  finally{if(this.operation===operation)this.operation=null;this.notify();}
 }
 /** Undo/Redo of a placement batch step: POST its retained inverse ops as one
  * atomic batch (If-Match = the timeline revision just read), confirm the
  * complete saved Playlist, then retain that receipt's inverse for the other
  * direction. A refusal (412, 400, nothing written) keeps the journal. */
 async applyPlacementBatchStep(direction,entry,scope){
  const state=placementBatchUndo.get(entry),ops=state?.[direction==='undo'?'undoOps':'redoOps'];
  const record={sequence:++this.sequence,scope:clone(scope),kind:'placement',batch:true,operation:entry.operation,direction,status:'reading',attempted:false,error:null,idempotencyKey:globalThis.crypto?.randomUUID?.()||`placement-batch-history-${Date.now()}-${Math.random().toString(36).slice(2)}`},operation={scope,record};this.records.push(record);this.operation=operation;this.notify();
  try{
   if(!Array.isArray(ops)||!ops.length||!Array.isArray(entry.members)||ops.length!==entry.members.length)throw failure('Reload the retained placement batch history.');
   const ids=new Set(entry.members.map(member=>member.placementId));if(ops.some(op=>!ids.has(op.placementId)))throw failure('The retained placement batch no longer names this step’s placements.');
   await this.settleQueue(scope);const fresh=await this.readPlacement(scope);this.assert(scope);
   const restoring=entry.operation==='create'?direction==='redo':direction==='undo';
   for(const member of entry.members){const present=fresh.clips.some(clip=>clip.cloudId===member.placementId);if(restoring?present:!present||!batchRowEqual(placementHistorySide(fresh,member.placementId).canonical,member.before.canonical))throw failure('A pattern clip changed after this edit. History will not overwrite newer data.');}
   if(this.drifted(fresh))throw failure('The canonical project changed after this edit. History will not overwrite newer data.');
   const protectedBefore=placementProtectedProject(fresh,[...ids]);
   record.status='sending';record.attempted=true;this.notify();
   const result=await this.engine.session.applyPlacementBatch(ops,{expectedContext:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:scope.contextVersion},ifMatch:placementTimelineTag(this.engine.session.rawProject),idempotencyKey:record.idempotencyKey});this.assert(scope);
   const inverse=this.engine.session.placementBatchInverse(result);record.receipt={results:clone(result.results),timelineRevision:result.timelineRevision};
   record.status='confirming';this.notify();const confirmed=await this.readPlacement(scope);this.assert(scope);
   for(const member of entry.members){const present=confirmed.clips.some(clip=>clip.cloudId===member.placementId);if(restoring?!present||!batchRowEqual(placementHistorySide(confirmed,member.placementId).canonical,member.before.canonical):present)throw failure('Freestyle acknowledged the placement batch, but the saved Playlist has not confirmed it.');}
   if(!same(placementProtectedProject(confirmed,[...ids]),protectedBefore))throw failure('The placement batch changed unrelated saved project data.');
   if(restoring)for(const member of entry.members)member.before=placementHistorySide(confirmed,member.placementId);
   state[direction==='undo'?'redoOps':'undoOps']=inverse;
   this.index+=direction==='undo'?-1:1;this.baseline=fingerprint(confirmed);record.status='confirmed';return{receipt:clone(record)};
  }catch(error){
   // The batch is atomic: an explicit refusal wrote nothing, so the step stays
   // available. Anything after dispatch without an answer is uncertain.
   const rejected=record.attempted&&[400,403,404,409,412,422,428].includes(Number(error?.status))&&error?.operationUncertain!==true&&record.status==='sending';
   if(rejected||error?.dispatched===false){record.attempted=false;}record.error=error.message;record.status=record.attempted?'uncertain':'not_applied';
   if(same(scope,this.context())&&record.status==='uncertain')this.blocked='A placement batch history request is uncertain. Reopen the project to inspect it; it will not be repeated.';
   throw Object.assign(error,{patternHistoryReceipt:clone(record),operationUncertain:record.status==='uncertain'});
  }finally{if(this.operation===operation)this.operation=null;this.notify();}
 }
 async applyExternalStep(direction,entry,scope){
  const step=this.externalEntries.get(entry.externalId);if(!step)throw failure('Reload the retained '+(entry.stepKind||'external')+' history.');
  const record={sequence:++this.sequence,scope:clone(scope),kind:'external_step',stepKind:step.kind,direction,status:'reading',attempted:false,error:null},operation={scope,record};this.records.push(record);this.operation=operation;this.notify();
  try{
   await this.settleQueue(scope);record.status='sending';record.attempted=true;this.notify();
   if(step.cascade)this.expectCascade(step.cascade[direction==='undo'?'before':'after']);record.receipt=clone(await step[direction]());this.assert(scope);
   this.index+=direction==='undo'?-1:1;try{this.baseline=fingerprint(this.engine.project);}catch{}record.status='confirmed';return{receipt:clone(record)};
  }catch(error){
   // A refused guard (value changed elsewhere) or an unsent write left nothing
   // applied; anything else after dispatch is uncertain and never repeated.
   const notApplied=refusedBeforeSend(error)||!record.attempted;record.status=notApplied?'not_applied':'uncertain';record.error=error.message;if(notApplied)record.attempted=false;
   // A refused guard or unsent write changed nothing: keep the journal so the
   // step can be retried once the value matches, and older steps stay intact.
   if(same(scope,this.context())&&record.status==='uncertain')this.blocked=record.status==='uncertain'?'A '+step.label+' history request is uncertain. Inspect it; it will not be repeated.':error.message;
   throw Object.assign(error,{patternHistoryReceipt:clone(record),operationUncertain:record.status==='uncertain'});
  }finally{if(this.operation===operation)this.operation=null;this.notify();}
 }
 rebindCloneAliases(aliases){
  for(const alias of aliases||[]){for(const controller of this.externalEntries.values())if(typeof controller.snapshot==='function'&&same(controller.snapshot().scope,this.context()))controller.rebindAliases?.([alias]);for(const entry of this.entries){
   if(alias.kind==='placement'&&entry.kind==='placement'&&entry.placementId===alias.proof.fromId){entry.placementId=alias.proof.toId;if(entry.before)entry.before=rebindPlacementHistorySide(entry.before,alias.proof,{phaseWritable:alias.phaseWritable===true});if(entry.after)entry.after=rebindPlacementHistorySide(entry.after,alias.proof,{phaseWritable:alias.phaseWritable===true});}
   if(alias.kind==='placement'&&entry.kind==='placement')for(const member of entry.members||[])if(member.placementId===alias.proof.fromId){member.placementId=alias.proof.toId;member.before=rebindPlacementHistorySide(member.before,alias.proof,{phaseWritable:alias.phaseWritable===true});}
   if(entry.kind==='playlist_move')for(const member of entry.members){if(alias.kind==='placement'&&member.kind==='placement'&&member.id===alias.proof.fromId){member.id=alias.proof.toId;member.before=rebindPlacementHistorySide(member.before,alias.proof,{phaseWritable:alias.phaseWritable===true});member.after=rebindPlacementHistorySide(member.after,alias.proof,{phaseWritable:alias.phaseWritable===true});}if(alias.kind==='audio'&&member.kind==='audio'&&member.id===alias.fromId){member.id=alias.toId;member.before=rebindPlaylistCloneAudioSide(member.before,alias);member.after=rebindPlaylistCloneAudioSide(member.after,alias);for(const key of ['undoInverse','redoInverse'])if(member[key]?.clip_id===alias.fromId)member[key].clip_id=alias.toId;}}
   if(alias.kind==='audio'&&['audio','audio_move'].includes(entry.kind)&&entry.clipId===alias.fromId){entry.clipId=alias.toId;if(entry.before)entry.before=rebindPlaylistCloneAudioSide(entry.before,alias);if(entry.after)entry.after=rebindPlaylistCloneAudioSide(entry.after,alias);for(const key of ['undoInverse','redoInverse'])if(entry[key]?.clip_id===alias.fromId)entry[key].clip_id=alias.toId;}
  }}
 }
 async applyPlaylistClone(direction,entry,scope){
  const controller=this.externalEntries.get(entry.externalId);if(!controller)throw failure('Reload the retained Playlist clone history.');const record={kind:'playlist_clone',scope:clone(scope),direction,status:'reading'},operation={scope,record};this.operation=operation;this.records.push(record);this.notify();
  try{await this.settleQueue(scope);await controller.fresh();this.assert(scope);if(this.drifted(this.engine.project))throw failure('The project changed outside retained history. Undo newer edits before its clone.');record.status='sending';const result=await controller[direction]();this.assert(scope);if(direction==='redo')this.rebindCloneAliases(controller.historyAliases);this.index+=direction==='undo'?-1:1;this.baseline=fingerprint(this.engine.project);record.status='confirmed';record.receipt=result;return{receipt:clone(record)};}
  catch(error){record.status=controller.snapshot().status==='uncertain'?'uncertain':'not_sent';record.error=error.message;record.receipt=controller.snapshot();if(same(scope,this.context())&&!keepsJournal(record,error))this.blocked=error.message;throw Object.assign(error,{patternHistoryReceipt:clone(record),operationUncertain:record.status==='uncertain'});}
  finally{if(this.operation===operation)this.operation=null;this.notify();}
 }
 undo(){return this.apply('undo');}
 redo(){return this.apply('redo');}
 /** FL applies Undo/Redo instantly: a presentation-only model with this step's
  * inverse applied to `base` (the last confirmed saved rows, or the model left
  * by the previous still-unconfirmed step of a rapid ⌘Z chain). Guards, reads
  * and writes still use server truth; the confirmed read replaces it, and a
  * refusal or failure re-renders the confirmed model (visible rollback).
  * Returns {project,raw,state} or null when this step has no model preview. */
 previewModel(direction,entry,base){
  const s=this.engine.session,raw0=base?.raw,state0=base?.state;if(!entry||!object(raw0)||!object(state0)||!Array.isArray(raw0.placements)||!Array.isArray(raw0.clips)||!Array.isArray(raw0.patterns))return null;
  const raw=clone(raw0),want=direction==='undo'?'before':'after',drop=direction==='undo'?'after':'before';
  const putPlacement=row=>{if(!object(row)||!id(row.id))throw failure('preview');const index=raw.placements.findIndex(item=>item.id===row.id);if(index>=0)raw.placements[index]=clone(row);else raw.placements.push(clone(row));};
  const removePlacement=placementId=>{raw.placements=raw.placements.filter(item=>item.id!==placementId);};
  const putClip=row=>{const index=raw.clips.findIndex(item=>item.id===row?.id);if(index<0)throw failure('preview');raw.clips[index]=clone(row);};
  try{
   if(entry.kind==='placement'){
    if(entry.members){const restoring=entry.operation==='create'?direction==='redo':direction==='undo';for(const member of entry.members)restoring?putPlacement(member.before.canonical):removePlacement(member.placementId);}
    else if(entry.operation==='update')putPlacement(entry[want].canonical);
    else{const restoring=entry.operation==='delete'?direction==='undo':direction==='redo',side=entry.operation==='delete'?entry.before:entry.after;if(restoring){if(!side)return null;putPlacement(side.canonical);}else removePlacement(entry.placementId??entry[drop]?.placementId);}
   }else if(entry.kind==='playlist_move'){for(const member of entry.members){const side=member[want];if(member.kind==='placement')putPlacement(side.canonical);else putClip(side.canonical);}}
   else if(['audio','audio_move'].includes(entry.kind))putClip(entry[want].canonical);
   // QA round 21 speed: a mixed / audio-only erase or paste paints at once (FL), from the rows it retained.
   else if(entry.kind==='audio_import'){
    // The imported clip leaves (Undo) or returns (Redo) at once; its owned lane follows with the confirmed model.
    const controller=this.externalEntries.get(entry.externalId),clipId=controller?.state?.clipId;if(!id(clipId)||!object(controller.clip)||controller.clip.id!==clipId)return null;
    if(direction==='undo')raw.clips=raw.clips.filter(row=>row.id!==clipId);else{if(raw.clips.some(row=>row.id===clipId))return null;raw.clips.push(clone(controller.clip));}
    if(raw.counts&&Number.isFinite(raw.counts.clips))raw.counts={...raw.counts,clips:raw.clips.length};
   }
   else if(entry.kind==='mixed_delete'||entry.kind==='mixed_paste'){
    const restoring=(direction==='undo')===(entry.kind==='mixed_delete');
    for(const member of entry.members){if(restoring){const row=member.before?.canonical??member.canonical;if(!object(row))return null;putPlacement(row);}else removePlacement(member.placementId);}
    for(const item of entry.audio){if(restoring){if(!object(item.canonical)||item.canonical.id!==item.clipId||raw.clips.some(row=>row.id===item.clipId))return null;raw.clips.push(clone(item.canonical));}else raw.clips=raw.clips.filter(row=>row.id!==item.clipId);}
    if(raw.counts&&Number.isFinite(raw.counts.clips))raw.counts={...raw.counts,clips:raw.clips.length};
   }
   else if(entry.kind==='lane_rename'){const lane=(raw.lanes||[]).find(row=>row?.id===entry.laneId);if(!lane||typeof entry[want]!=='string')return null;lane.name=entry[want];}
   else if(entry.kind==='pattern'){const canonical=entry[want]?.canonical,index=raw.patterns.findIndex(row=>(row.id??row.pattern_id)===entry.patternId);if(!object(canonical)||index<0)return null;raw.patterns[index]=clone(canonical);}
   // An external step may describe its saved-row inverse (e.g. a pattern clip
   // moved back off a created lane, which disappears again).
   else if(entry.kind==='external_step'){const step=this.externalEntries.get(entry.externalId);if(typeof step?.previewModel!=='function'||step.previewModel(direction,raw)!==true)return null;}
   else return null;
  }catch{return null;}
  raw.counts&&(raw.counts={...raw.counts,placements:raw.placements.length,...Array.isArray(raw.lanes)&&Number.isFinite(raw.counts.lanes)?{lanes:raw.lanes.length}:{}});
  const state={...state0},mirror=(field,rows,key)=>{const value=state[field];if(Array.isArray(value))state[field]=rows;else if(object(value)&&Array.isArray(value[key]))state[field]={...value,[key]:rows};};
  mirror('patterns',raw.patterns,'patterns');mirror('patternPlacements',raw.placements,'placements');mirror('placements',raw.placements,'placements');mirror('clips',raw.clips,'clips');if(object(state.project))state.project=raw;
  try{const project=normalizeCloudProject(raw,state,{projectId:this.engine.projectId,trackId:s.trackId});const selected=this.engine.selectedPattern;if(selected&&project.patterns.some(pattern=>pattern.id===selected))project.selectedPattern=selected;return{project,raw,state};}catch{return null;}
 }
 previewFor(direction,entry){const s=this.engine.session;return this.previewModel(direction,entry,{raw:s.rawProject,state:s.rawState})?.project??null;}
 /** FL hint-bar label of a journal step ("Undo: <label>"). */
 labelFor(entry){
  if(!entry)return'edit';
  if(entry.kind==='external_step')return this.externalEntries.get(entry.externalId)?.label||'edit';
  if(typeof entry.label==='string'&&entry.label)return entry.label;
  if(entry.kind==='placement')return entry.members?(entry.operation==='create'?'Add pattern clips':'Delete pattern clips'):entry.operation==='update'?placementEditLabel(entry.before,entry.after):{create:'Add pattern clip',delete:'Delete pattern clip'}[entry.operation]||'Pattern clip edit';
  if(entry.kind==='pattern')return patternEditLabel(entry.before,entry.after);
  if(entry.kind==='playlist_move'){const members=entry.members||[],kinds=new Set(members.map(member=>member.kind));return members.length===1?(kinds.has('audio')?'Move audio clip':'Move pattern clip'):kinds.size===1&&kinds.has('placement')?'Move pattern clips':'Move clips';}
  return{lane_rename:'Rename track',pattern:'Pattern edit',audio:'Edit audio clip',audio_move:'Move audio clip',playlist_move:'Playlist move',playlist_clone:'Clone pattern clip',audio_import:'Audio import',lane_create:'Add track'}[entry.kind]||'edit';
 }
 /** Journal index once every reserved (shown, not yet confirmed) step lands. */
 virtualIndex(){return this.reserved.reduce((index,token)=>index+(token.direction==='undo'?-1:1),this.index);}
 get optimisticPending(){return this.reserved.length>0;}
 /** FL hint-bar label while history saves run: the exact step being saved
  * now (the oldest reserved press; later presses showed their own label when
  * pressed), else the step that the running (or next) press applies. */
 pendingLabel(direction){const token=this.reserved[0];if(token)return{direction:token.direction,label:token.label};const entry=this.entries[direction==='undo'?this.index-1:this.index];return entry&&same(this.scope,this.context())?{direction,label:this.labelFor(entry)}:null;}
 /** The step the next press would apply, after the steps already reserved. */
 nextEntry(direction){const index=this.virtualIndex();return this.entries[direction==='undo'?index-1:index]??null;}
 /** Rapid ⌘Z/⌘⇧Z: show this press's step immediately, chained on the
  * optimistic model of the presses before it. The guarded saved write runs
  * later, strictly in order, through `apply`. Returns the reservation or null
  * (nothing retained to apply, history blocked, or another request running). */
 reserve(direction){
  if(!['undo','redo'].includes(direction)||this.blocked||!same(this.scope,this.context()))return null;
  if(!this.reserved.length&&this.busy||this.externalPending)return null;
  const entry=this.nextEntry(direction);if(!entry)return null;
  if(entry.kind==='pattern'&&!this.focusPattern(entry.patternId))return null;
  const s=this.engine.session,base=this.reserved.at(-1)?.base||{raw:s.rawProject,state:s.rawState};
  const token={id:++this.reserveSequence,direction,entry,label:this.labelFor(entry),base,project:null,revert:null,consumed:false};
  try{const model=this.previewModel(direction,entry,base);if(model){token.base={raw:model.raw,state:model.state};token.project=model.project;}}catch{}
  if(entry.kind==='external_step'){const step=this.externalEntries.get(entry.externalId);if(typeof step?.previewUi==='function')try{const revert=step.previewUi(direction);if(typeof revert==='function')token.revert=revert;}catch{}}
  this.reserved.push(token);
  token.areas=this.previewAreas(entry);if(token.project){this.holdRender();this.showPreview(token.project,token.areas);}
  historyLog('history-optimistic',{direction,kind:entry.kind,stepKind:entry.stepKind??null,depth:this.reserved.length,model:!!token.project,ui:!!token.revert});
  return token;
 }
 /** Drop every reserved step (failure, cancellation, mismatch): undo their UI
  * previews newest first and show Freestyle's confirmed model again. */
 rollbackReserved(reason='rolled_back'){
  const tokens=this.reserved.splice(0);for(const token of [...tokens].reverse())if(token.revert)try{token.revert();}catch{}
  if(tokens.length)historyLog('history-optimistic-rollback',{reason,steps:tokens.length,directions:tokens.map(token=>token.direction)});
  this.releaseRender();return tokens.length;
 }
 /** After a step confirms, rebuild the still-reserved previews on top of the
  * confirmed rows (steps without a model preview now show their saved effect). */
 rebaseReserved(){
  const s=this.engine.session;let base={raw:s.rawProject,state:s.rawState},last=null;
  for(const token of this.reserved){let model=null;try{model=this.previewModel(token.direction,token.entry,base);}catch{}if(model){token.base={raw:model.raw,state:model.state};token.project=model.project;last=model.project;}else token.base=base;base=token.base;}
  if(this.heldRender){if(last)this.showPreview(last,[...new Set(['playlist',...this.reserved.flatMap(token=>token.areas||[])])]);else this.showConfirmed();}
 }
 holdRender(){if(this.heldRender)return;this.heldRender=this.engine.onProject;this.engine.onProject=()=>{};}
 releaseRender(){if(!this.heldRender)return;this.engine.onProject=this.heldRender;this.heldRender=null;this.showConfirmed();}
 /** UI areas a step's preview can change; the confirmed model still renders everything once the chain settles. */
 previewAreas(entry){return entry?.kind==='pattern'?['playlist','patterns','rack','piano']:entry?.kind==='external_step'?['playlist','mixer']:['playlist'];}
 /** Previews repaint only the affected areas when the app offers that (FL: instant); else the full project render. */
 showPreview(project,areas=null){try{const light=this.engine.onProjectPreview;if(areas&&typeof light==='function')light(clone(project),areas);else (this.heldRender||this.engine.onProject)?.(clone(project));}catch{}}
 showConfirmed(){try{if(this.engine.project)(this.heldRender||this.engine.onProject)?.(clone(this.engine.project));}catch{}}
 async apply(direction){
  const started=Date.now(),entry=this.entries[direction==='undo'?this.index-1:this.index];historyLog('history-apply-start',{direction,kind:entry?.kind??null,operation:entry?.operation??null,index:this.index,entries:this.entries.length,blocked:this.blocked,reserved:this.reserved.length});
  if(this.externalPending){this.rollbackReserved('external_step_saving');throw failure(`Wait for the ${this.externalPending.label} to finish saving.`,'pattern_history_busy');}
  let token=this.reserved[0]??null;
  if(token&&(token.consumed||token.direction!==direction||token.entry!==entry)){this.rollbackReserved('reservation_mismatch');token=null;}
  if(!token&&!this.busy&&!this.blocked&&same(this.scope,this.context()))token=this.reserve(direction);
  if(token)token.consumed=true;const previewScope=clone(this.context()),label=token?.label??this.labelFor(entry);
  try{
   const result=await this.applyStep(direction);
   if(token&&this.reserved[0]===token){this.reserved.shift();token.revert=null;if(this.reserved.length)this.rebaseReserved();else this.releaseRender();}
   // FL: Redo of a paste re-selects the restored clips (same ids).
   this.lastApplied={direction,label,kind:entry?.kind??null,...entry?.kind==='mixed_paste'&&direction==='redo'?{selectIds:[...(entry.members||[]).map(member=>member.placementId),...(entry.audio||[]).map(item=>item.clipId)]}:{}};
   historyLog('history-apply-done',{direction,kind:entry?.kind??null,ms:Date.now()-started,index:this.index,optimistic:!!(token?.project||token?.revert),queued:this.reserved.length});return result;
  }catch(error){
   // Refused or rejected: show confirmed truth again for this step and every
   // later reserved step. Uncertain: one fresh read first, then show whatever
   // Freestyle actually saved.
   const steps=this.reserved.length;
   if(this.heldRender&&error?.operationUncertain===true&&same(previewScope,this.context())){const blocked=this.blocked,baseline=this.baseline;try{await this.engine.session.refresh();}catch{}if(blocked){this.blocked=blocked;this.baseline=baseline;this.notify();}}
   this.rollbackReserved('step_failed');if(steps>1)error.rolledBackSteps=steps;
   historyLog('history-apply-failed',{direction,kind:entry?.kind??null,ms:Date.now()-started,code:error.code??null,status:error.status??null,error:String(error.message||error).slice(0,300),receipt:error.patternHistoryReceipt?.status??null,blocked:this.blocked,rolledBack:steps});throw error;}
 }
 /** Confirmed session canonical state usable as a REST pattern step's base, or null. */
 /** QA round 21 speed: the confirmed session state stands in for the pre-read of an
  * audio timing step when it is exactly this journal's baseline and the clip is the
  * retained side; the write then carries If-Match and the exact `expected` window. */
 cachedAudioBase(scope,entry,expected){
  try{
   const e=this.engine,s=e.session,project=s.project,raw=s.rawProject;
   if(!project||!raw||raw.id!==scope.projectId||s.rawState?.studioApi!==true||e.pending||e.inFlight||e.applying||(s.mutationsInFlight||0)>0||(s.actionPending||0)>0)return null;
   placementTimelineTag(raw);if(!same(fingerprint(project),this.baseline))return null;
   const actual=audioHistorySide(project,entry.clipId);return audioGeometryEqual(actual.geometry,expected.geometry)&&same(actual.metadata,expected.metadata)?project:null;
  }catch{return null;}
 }
 cachedPatternBase(scope,entry,expected){
  try{
   const e=this.engine,s=e.session,project=s.project,raw=s.rawProject;
   if(!project||!raw||raw.id!==scope.projectId||e.pending||e.inFlight||e.applying||(s.mutationsInFlight||0)>0||(s.actionPending||0)>0)return null;
   placementTimelineTag(raw);if(!same(fingerprint(project),this.baseline))return null;
   const actual=side(project,entry.patternId);return same(actual.serialized,expected.serialized)&&same(actual.canonical,expected.canonical)?project:null;
  }catch{return null;}
 }
 async applyStep(direction){
  if(!['undo','redo'].includes(direction))throw failure('Choose Undo or Redo.');if(this.busy)throw failure('Wait for the current history request.','pattern_history_busy');const scope=this.capture();
  if(!same(this.scope,scope)||this.blocked)throw failure(this.blocked||'There is no retained edit history in this project.');const entry=this.entries[direction==='undo'?this.index-1:this.index];if(!entry)throw failure('There is no retained edit to '+direction+'.');if(entry.kind==='pattern'&&entry.follow&&!this.followApplying)return this.applyPatternWithFollow(direction,entry,scope);if(entry.kind==='external_step')return this.applyExternalStep(direction,entry,scope);if(entry.kind==='lane_rename')return this.applyLaneRename(direction,entry,scope);if(entry.kind==='audio_import')return this.applyAudioImport(direction,entry,scope);if(entry.kind==='lane_create')return this.applyLaneCreate(direction,entry,scope);if(entry.kind==='playlist_clone')return this.applyPlaylistClone(direction,entry,scope);if(entry.kind==='playlist_move')return this.applyPlaylistMove(direction,entry,scope);if(entry.kind==='audio_move')return this.applyMove(direction,entry,scope);if(entry.kind==='placement'&&entry.batch)return this.applyPlacementBatchStep(direction,entry,scope);if(entry.kind==='mixed_delete'||entry.kind==='mixed_paste')return this.applyMixedDelete(direction,entry,scope);if(entry.kind==='placement')return entry.restoreSupported&&entry.operation!=='update'?this.applyPlacementRestored(direction,entry,scope):entry.members?this.applyPlacementGroup(direction,entry,scope):this.applyPlacement(direction,entry,scope);const audio=entry.kind==='audio';if(!audio&&!this.focusPattern(entry.patternId))throw failure('The edited pattern is no longer in this project. Its '+direction+' will not apply.','pattern_history_missing_pattern');
  const restPattern=!audio&&this.engine.session.rawState?.studioApi===true;
  const expected=entry[direction==='undo'?'after':'before'],desired=entry[direction==='undo'?'before':'after'],action=audio?'trim_clip':'update_pattern',record={sequence:++this.sequence,scope:clone(scope),kind:entry.kind,...audio?{clipId:entry.clipId,laneId:entry.laneId}:{patternId:entry.patternId},direction,status:'reading',attempted:false,request:null,receipt:null,error:null,...restPattern?{idempotencyKey:globalThis.crypto?.randomUUID?.()||`pattern-history-${Date.now()}-${Math.random().toString(36).slice(2)}`}:{}} ,operation={scope,record};this.records.push(record);this.operation=operation;this.notify();
  const read=()=>audio?this.readAudio(scope):restPattern?this.readPlacement(scope):this.read(scope),readSide=project=>audio?audioHistorySide(project,entry.clipId):side(project,entry.patternId);
  try{
   // Round 10: a REST pattern step whose confirmed session state is still this
   // journal's baseline skips the pre-read. Its If-Match (that state's timeline
   // revision) makes Freestyle refuse with 412 if anything changed meanwhile;
   // only then is the full read + verification done (nothing was applied).
   const restAudio=audio&&this.engine.session.rawState?.studioApi===true;
   await this.settleQueue(scope);let fresh=restPattern?this.cachedPatternBase(scope,entry,expected):restAudio?this.cachedAudioBase(scope,entry,expected):null;const cachedBase=!!fresh;if(!fresh)fresh=await read();const actual=readSide(fresh);this.assert(scope);
   const matched=audio?audioGeometryEqual(actual.geometry,expected.geometry)&&same(actual.metadata,expected.metadata):same(actual.serialized,expected.serialized)&&same(actual.canonical,expected.canonical);
   if(this.drifted(fresh)||!matched)throw failure('The canonical '+(audio?'audio clip':'pattern')+' changed after this edit. Its history will not overwrite newer data.');
   let args;if(audio){record.status='discovering';this.notify();const capability=await this.engine.session.call('list_pro_capabilities',{action:'trim_clip'});this.assert(scope);args=audioHistoryArguments(capability,desired);if(restAudio&&cachedBase)args.expected={start_ms:expected.geometry.start_ms,duration_sec:expected.geometry.duration_sec,audio_offset_sec:expected.geometry.audio_offset_sec};}else args={pattern_id:entry.patternId,pattern:clone(desired.payload)};
   const headers=restPattern?{ifMatch:placementTimelineTag(this.engine.session.rawProject),idempotencyKey:record.idempotencyKey}:restAudio&&cachedBase?{ifMatch:placementTimelineTag(this.engine.session.rawProject)}:{};
   record.request={project_id:scope.projectId,track_id:scope.trackId,action,arguments:clone(args),...headers};record.status='sending';this.notify();record.attempted=true;let revision;const send=options=>this.engine.session.action(action,args,{refresh:false,expectedContext:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:scope.contextVersion},...options,...restPattern?{onTimelineRevision:value=>{revision=value;}}:{}});
   let sent;try{sent=await send(headers);}catch(error){
    // 412 = precondition failed, nothing applied: verify fresh saved state, then send once against it.
    if(!cachedBase||![412,...restAudio?[409]:[]].includes(Number(error?.status)))throw error;this.assert(scope);historyLog('history-cached-base-stale',{kind:entry.kind,code:error.code??null});record.attempted=false;record.status='reading';this.notify();
    fresh=await read();const current=readSide(fresh);this.assert(scope);if(this.drifted(fresh)||(audio?!audioGeometryEqual(current.geometry,expected.geometry)||!same(current.metadata,expected.metadata):!same(current.serialized,expected.serialized)||!same(current.canonical,expected.canonical)))throw failure('The canonical '+(audio?'audio clip':'pattern')+' changed after this edit. Its history will not overwrite newer data.');
    if(audio)delete args.expected;
    record.idempotencyKey=globalThis.crypto?.randomUUID?.()||`pattern-history-${Date.now()}-${Math.random().toString(36).slice(2)}`;const retry={ifMatch:placementTimelineTag(this.engine.session.rawProject),...restPattern?{idempotencyKey:record.idempotencyKey}:{}};record.request={...record.request,...retry};record.status='sending';record.attempted=true;this.notify();sent=await send(retry);
   }
   record.receipt=clone(resultBody(sent));this.assert(scope);
   if(audio){const resolved=record.receipt.resolved;for(const [key,value]of [['db_clip_id',entry.clipId],['db_track_id',entry.laneId]])if(resolved?.[key]!==undefined&&resolved[key]!==value)throw failure('Freestyle acknowledged audio history for a different saved identity.');}
   // The confirming read stays complete: placement rows embed their pattern,
   // so a patterns-only read would leave the next step's baseline stale.
   if(restPattern&&revision!==undefined)record.timelineRevision=revision;
   record.status='confirming';this.notify();
   // QA round 21 speed: an acknowledged audio timing receipt paints the confirmed row (no read); any doubt reads.
   let confirmed=null;if(restAudio){try{if(this.engine.session.projectClipTimingWrites?.([{name:action,args,result:sent}],{projectId:scope.projectId,trackId:scope.trackId,contextVersion:scope.contextVersion||0})){confirmed=this.engine.session.project;this.engine.accept(confirmed);historyLog('history-confirmed-from-receipt',{kind:entry.kind,direction});}}catch{confirmed=null;}}
   if(!confirmed)confirmed=await read();const after=readSide(confirmed);this.assert(scope);if(audio?!audioGeometryEqual(after.geometry,desired.geometry)||!same(after.metadata,desired.metadata):!same(after.serialized,desired.serialized))throw failure('Freestyle acknowledged history, but its complete saved '+(audio?'audio clip':'pattern')+' has not confirmed it.');
   entry[direction==='undo'?'before':'after']=after;this.index+=direction==='undo'?-1:1;const expectedSide=direction==='undo'?'after':'before',step=direction==='undo'?-1:1;
   for(let index=direction==='undo'?this.index-1:this.index;index>=0&&index<this.entries.length;index+=step){const adjacent=this.entries[index];if(adjacent.kind!==entry.kind||(audio?adjacent.clipId!==entry.clipId:adjacent.patternId!==entry.patternId))continue;const matches=audio?audioGeometryEqual(adjacent[expectedSide].geometry,after.geometry)&&same(adjacent[expectedSide].metadata,after.metadata):same(adjacent[expectedSide].serialized,after.serialized);if(matches)adjacent[expectedSide]=clone(after);break;}
   this.baseline=fingerprint(confirmed);record.status='confirmed';return{receipt:clone(record)};
  }catch(error){record.error=error.message;record.status=record.attempted?'uncertain':'not_sent';if(same(scope,this.context())&&!keepsJournal(record,error))this.blocked=record.attempted?'A history request is uncertain. Reopen the project to inspect it; it will not be repeated.':error.message;throw Object.assign(error,{patternHistoryReceipt:clone(record),operationUncertain:record.attempted});}
  finally{if(this.operation===operation)this.operation=null;this.notify();}
 }
}
