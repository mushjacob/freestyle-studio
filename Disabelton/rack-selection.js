/** Local Channel Rack selection and canonical score-only clipboard plans.
 * Image-Line channelrack.htm sections 10/13; menu_edit.htm excludes automation.
 * Row identity is supplied explicitly: pattern-local source IDs do not establish
 * a global rack, and no clipboard operation creates or copies an instrument.
 */
const clone=value=>structuredClone(value);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=256;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const signature=value=>JSON.stringify(value);
const same=(a,b)=>signature(a)===signature(b);
const error=(message,code='rack_binding_required')=>Object.assign(new Error(message),{code});
function complete(value,path=new WeakSet(),depth=0){
 if(!value||typeof value!=='object')return;if(path.has(value)||depth>32)throw error('Reload complete acyclic rack score data.');path.add(value);
 for(const [key,child]of Object.entries(value)){if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&child)throw error('Reload complete canonical rack sources and score events.');complete(child,path,depth+1);}path.delete(value);
}
function rowIds(rows){if(!Array.isArray(rows))throw new TypeError('Rack selection requires explicit ordered row identities.');const ids=rows.map(row=>typeof row==='string'?row:row?.id);if(ids.some(value=>!id(value))||new Set(ids).size!==ids.length)throw new TypeError('Rack row identities must be nonempty and unique.');return ids;}
export class RackSelection{
 constructor({scope=null,rows=[]}={}){this.scope=null;this.rows=[];this.selected=new Set();this.focusId=null;this.version=0;this.drag=null;this.sync({scope,rows});}
 sync({scope,rows}){
  const ids=rowIds(rows),next=signature(scope);if(next!==this.scope){this.selected.clear();this.focusId=null;}
  if(next!==this.scope||!same(ids,this.rows)){this.version++;this.drag=null;}this.scope=next;this.rows=ids;this.selected=new Set(ids.filter(value=>this.selected.has(value)));if(!this.selected.has(this.focusId))this.focusId=ids.find(value=>this.selected.has(value))??null;return this.snapshot();
 }
 get ids(){return new Set(this.rows.filter(value=>this.selected.has(value)));}
 assertRow(value){if(!this.rows.includes(value))throw error('Select a currently bound rack row.');}
 focus(value){this.assertRow(value);this.selected=new Set([value]);this.focusId=value;return this.snapshot();}
 toggle(value){this.assertRow(value);if(this.selected.has(value))this.selected.delete(value);else this.selected.add(value);if(!this.selected.has(this.focusId))this.focusId=this.rows.find(key=>this.selected.has(key))??null;return this.snapshot();}
 all(){this.selected=new Set(this.rows);if(!this.selected.has(this.focusId))this.focusId=this.rows[0]??null;return this.snapshot();}
 clear(){this.selected.clear();this.focusId=null;return this.snapshot();}
 /** Shift+click: select the rows from the focused (anchor) row to this one; the anchor stays focused. */
 range(value){this.assertRow(value);const anchor=this.rows.includes(this.focusId)?this.focusId:value,a=this.rows.indexOf(anchor),b=this.rows.indexOf(value);this.selected=new Set(this.rows.slice(Math.min(a,b),Math.max(a,b)+1));this.focusId=anchor;return this.snapshot();}
 /** `replace` (a right-drag over channel names) starts a fresh selection at this row instead of toggling it. */
 begin(value,{button=0,replace=false}={}){if(this.drag||![0,2].includes(button))return false;this.assertRow(value);this.drag={version:this.version,selected:this.ids,focusId:this.focusId,button,visited:new Set([value])};if(button===2&&replace){this.selected=new Set([value]);this.focusId=value;}else if(button===2)this.toggle(value);else this.focus(value);return true;}
 over(value){if(!this.drag||this.drag.version!==this.version||this.drag.button!==2)return false;this.assertRow(value);if(this.drag.visited.has(value))return false;this.drag.visited.add(value);this.selected.add(value);if(!this.focusId)this.focusId=value;return true;}
 finish({cancel=false}={}){const drag=this.drag;if(!drag)return this.snapshot();this.drag=null;if(cancel&&drag.version===this.version){this.selected=drag.selected;this.focusId=drag.focusId;}return this.snapshot();}
 snapshot(){return{ids:this.ids,focusId:this.focusId,rows:this.rows.slice()};}
}
/** Visibility does not confer keyboard focus. The parent supplies actual rack
 * focus; text editing, dialogs, composition and modified paste keep their keys.
 */
export function rackClipboardCommand(event,{rackFocused=false,dialogOpen=false}={}){
 if(!rackFocused||dialogOpen||event?.defaultPrevented||event?.isComposing||event?.repeat||!(event?.ctrlKey||event?.metaKey)||event.altKey||event.shiftKey||event.target?.closest?.('input,select,textarea,dialog,[contenteditable]:not([contenteditable=false]),[role=textbox]'))return null;
 return{c:'copy',x:'cut',v:'paste'}[String(event.key||'').toLowerCase()]??null;
}
function canonical(pattern){
 const dto=pattern?.cloudRaw?.data?.pattern?pattern.cloudRaw.data:pattern?.cloudRaw??pattern,patternId=pattern?.cloudId??pattern?.id??dto?.id;
 complete(dto);
 if(!id(patternId)||!record(dto)||!finite(dto.ppq)||dto.ppq<=0||!finite(dto.lengthTicks)||dto.lengthTicks<=0||!finite(dto.bars)||dto.bars<=0||!record(dto.pattern)||!Array.isArray(dto.pattern.sources)||!Array.isArray(dto.pattern.events))throw error('Reload the complete persisted pattern timebase, sources and score before using the rack clipboard.');
 const sources=new Set(),events=new Set();for(const source of dto.pattern.sources){if(!record(source)||!id(source.id)||sources.has(source.id))throw error('The pattern has ambiguous source identities.');sources.add(source.id);}
 for(const event of dto.pattern.events){if(!record(event)||!id(event.id)||events.has(event.id)||typeof event.type!=='string')throw error('The pattern has incomplete or duplicate event identities.');events.add(event.id);}
 return{dto,patternId};
}
/** Binding snapshots contain the EXACT current source, including asset/window/
 * instrument identity and pattern-local controls. They are guards, never pasted.
 */
export function rackSourceBinding({pattern,rowId,sourceId}){
 const {dto,patternId}=canonical(pattern);if(!id(rowId)||!id(sourceId))throw error('Choose an explicit row and current-pattern source.');
 const source=dto.pattern.sources.find(value=>value.id===sourceId);if(!source||!['sample','plugin'].includes(source.kind))throw error('The rack row has no explicit current-pattern sample or plugin binding.');
 if(source.kind==='plugin'&&!id(source.laneId)||source.kind==='sample'&&!id(source.audioFileId))throw error('The source is missing its durable instrument lane or sample asset identity.');
 return{rowId,patternId,sourceId,source:clone(source)};
}
function bindingsFor(pattern,bindings){
 const {dto,patternId}=canonical(pattern);if(!Array.isArray(bindings)||!bindings.length)throw error('Select at least one explicitly bound rack channel.');const rows=new Set(),sources=new Set();
 for(const binding of bindings){if(!record(binding)||binding.patternId!==patternId||rows.has(binding.rowId)||sources.has(binding.sourceId))throw error('Rack selection has ambiguous or foreign pattern bindings.');const actual=rackSourceBinding({pattern,rowId:binding.rowId,sourceId:binding.sourceId});if(!same(actual,binding))throw error('The rack source binding changed; select its current canonical identity again.');rows.add(binding.rowId);sources.add(binding.sourceId);}
 return{dto,patternId,bindings:clone(bindings),sourceIds:sources};
}
function scoreEvent(event){
 if(!['midi','sample'].includes(event.type))return false;
 const timing=['tick','startTick','durationTick'];for(const key of timing)if(own(event,key)&&(!finite(event[key])||event[key]<0||key==='durationTick'&&event[key]<=0))throw error('A selected score event has unavailable canonical timing.');
 if(!own(event,'tick')&&!own(event,'startTick')||event.type==='midi'&&(!own(event,'startTick')||!own(event,'durationTick')))throw error('A selected score event needs an explicit canonical onset and duration mapping.');
 if(event.type==='midi'&&!own(event,'note')&&!own(event,'pitch')||['note','pitch'].some(key=>own(event,key)&&(!Number.isInteger(event[key])||event[key]<0||event[key]>127)))throw error('A selected MIDI or pitched sample event has no valid canonical pitch.');
 if(own(event,'durationTick')&&!finite((event.startTick??event.tick)+event.durationTick))throw error('A selected score event exceeds the finite timebase.');
 if(own(event,'velocity')&&(!finite(event.velocity)||event.velocity<0||event.velocity>1))throw error('A selected score event has an invalid velocity.');
 return true;
}
function clipboardValue(clipboard){
 complete(clipboard);if(!record(clipboard)||clipboard.type!=='vegetable-rack-score'||clipboard.version!==1||!id(clipboard.projectId)||!id(clipboard.patternId)||!finite(clipboard.ppq)||clipboard.ppq<=0||!finite(clipboard.lengthTicks)||clipboard.lengthTicks<=0||!Array.isArray(clipboard.entries)||!clipboard.entries.length)throw error('This clipboard does not contain a complete canonical rack score.');
 const rows=new Set(),sources=new Set();for(const entry of clipboard.entries){if(!record(entry)||!record(entry.binding)||!id(entry.binding.rowId)||!id(entry.binding.sourceId)||entry.binding.patternId!==clipboard.patternId||rows.has(entry.binding.rowId)||sources.has(entry.binding.sourceId)||!Array.isArray(entry.events)||!record(entry.binding.source)||entry.binding.source.id!==entry.binding.sourceId||!['sample','plugin'].includes(entry.binding.source.kind))throw error('The rack clipboard has ambiguous source entries.');rows.add(entry.binding.rowId);sources.add(entry.binding.sourceId);const ids=new Set();for(const event of entry.events){if(!record(event)||!id(event.id)||ids.has(event.id)||event.sourceId!==entry.binding.sourceId||!scoreEvent(event))throw error('The rack clipboard has incomplete or ambiguous score events.');ids.add(event.id);}}
 return clipboard;
}
export function copyRackScore({projectId,pattern,bindings}){
 if(!id(projectId))throw error('Capture the source project before copying rack data.');const {dto,patternId,bindings:validated,sourceIds}=bindingsFor(pattern,bindings);
 for(const event of dto.pattern.events)if(sourceIds.has(event.sourceId))scoreEvent(event);
 return{type:'vegetable-rack-score',version:1,projectId,patternId,ppq:dto.ppq,lengthTicks:dto.lengthTicks,bars:dto.bars,entries:validated.map(binding=>({binding,events:clone(dto.pattern.events.filter(event=>event.sourceId===binding.sourceId&&scoreEvent(event)))}))};
}
export function cutRackScore(options){
 const clipboard=copyRackScore(options),{dto,patternId}=canonical(options.pattern),sources=new Set(clipboard.entries.map(entry=>entry.binding.sourceId)),events=dto.pattern.events.filter(event=>!sources.has(event.sourceId)||!scoreEvent(event)),next=clone(dto);next.pattern.events=clone(events);
 return{projectId:options.projectId,patternId,pattern:next,clipboard,changed:events.length!==dto.pattern.events.length,expected:clone(dto),scope:clone(options.scope),sourceIds:[...sources]};
}
function opaqueTime(value,root=true){
 if(!value||typeof value!=='object')return false;
 for(const [key,child]of Object.entries(value)){
  if(root&&['tick','startTick','durationTick'].includes(key))continue;
  if(/(?:tick|time|offset|duration|position|expression|envelope|points|curve)/i.test(key))return true;
  if(opaqueTime(child,false))return true;
 }
 return false;
}
function remapEvent(event,entry,target,ratio,allocate){
 if(entry.binding.source.kind!==target.source.kind)throw error('Cross-kind rack paste needs a verified sample/MIDI event conversion.','rack_event_conversion_required');
 const next=clone(event);
 if(ratio!==1&&opaqueTime(next))throw error('This score contains additional time or expression metadata; an exact cross-PPQ mapping is required.','rack_timebase_mapping_required');
 // Unknown embedded instrument/sample identities cannot follow a score into a
 // different asset. Explicit sourceId is the only automatic identity remap.
 const sourceIdentity=entry.binding.source.kind==='plugin'?entry.binding.source.laneId:entry.binding.source.audioFileId,targetIdentity=target.source.kind==='plugin'?target.source.laneId:target.source.audioFileId;
 if(sourceIdentity!==targetIdentity){
  const inspect=value=>{if(!value||typeof value!=='object')return false;return Object.entries(value).some(([key,child])=>/^(?:audioFileId|sourceAudioFileId|rackId|laneId|instrumentId|instrumentType|pluginId|rootPitch|playbackRate)$/.test(key)||inspect(child));};
  if(inspect(Object.fromEntries(Object.entries(next).filter(([key])=>key!=='sourceId'))))throw error('This note embeds instrument-specific playback identity; an explicit target mapping is required.','rack_event_binding_required');
 }
 next.id=allocate();next.sourceId=target.sourceId;
 for(const key of ['tick','startTick','durationTick'])if(own(next,key)){next[key]*=ratio;if(!finite(next[key]))throw error('The pasted score exceeds the target timebase.','rack_timebase_mapping_required');}
 return next;
}
/** Explicit mappings are [{entryRowId,target: rackSourceBinding(...)}]. No name,
 * asset, sourceId or row-index matching is performed. No missing source is made.
 */
export function pasteRackScore({projectId,pattern,clipboard,mappings,replace=true,createId=()=>globalThis.crypto.randomUUID(),existingIds=[],scope}){
 if(!id(projectId)||typeof replace!=='boolean')throw error('Capture the target project and an explicit score replacement mode.');clipboardValue(clipboard);
 if(clipboard.projectId!==projectId)throw error('The rack clipboard belongs to a different project; copy from the current project before pasting.','rack_clipboard_scope_changed');
 if(!Array.isArray(mappings)||mappings.length!==clipboard.entries.length)throw error('Map every copied row explicitly to one existing target source.');
 const rowIds=new Set();for(const mapping of mappings){if(!record(mapping)||!id(mapping.entryRowId)||rowIds.has(mapping.entryRowId)||!clipboard.entries.some(entry=>entry.binding.rowId===mapping.entryRowId))throw error('The clipboard row mapping is missing or ambiguous.');rowIds.add(mapping.entryRowId);}
 const {dto,patternId,bindings:targets}=bindingsFor(pattern,mappings.map(mapping=>mapping.target)),targetIds=new Set(targets.map(binding=>binding.sourceId));
 const reserved=new Set([...existingIds,...dto.pattern.sources.map(source=>source.id),...dto.pattern.events.map(event=>event.id),...clipboard.entries.flatMap(entry=>[entry.binding.sourceId,...entry.events.map(event=>event.id)])]);
 const allocate=()=>{for(let i=0;i<64;i++){const value=createId();if(id(value)&&!reserved.has(value)){reserved.add(value);return value;}}throw error('Pasted notes require unused canonical event identities.');};
 const ratio=dto.ppq/clipboard.ppq,imported=[];
 for(let i=0;i<mappings.length;i++){const entry=clipboard.entries.find(value=>value.binding.rowId===mappings[i].entryRowId);for(const event of entry.events)imported.push(remapEvent(event,entry,targets[i],ratio,allocate));}
 const next=clone(dto),kept=dto.pattern.events.filter(event=>!replace||!targetIds.has(event.sourceId)||!scoreEvent(event));next.pattern.events=clone(kept).concat(imported);
 // A long score must remain audible rather than being silently cut at a shorter
 // destination pattern. Preserve exact existing length; extend by whole bars.
 const barTicks=dto.ppq*4,requiredBars=imported.reduce((maximum,event)=>{const onset=event.startTick??event.tick??0;return Math.max(maximum,own(event,'durationTick')?Math.ceil((onset+event.durationTick)/barTicks):Math.floor(onset/barTicks)+1);},0),length=Math.max(dto.lengthTicks,requiredBars*barTicks);
 if(!finite(length))throw error('The pasted score exceeds the finite pattern length.','rack_timebase_mapping_required');
 if(length>dto.lengthTicks){next.lengthTicks=length;next.bars=Math.max(dto.bars,length/barTicks);if(own(next,'length_ticks'))next.length_ticks=length;}
 return{projectId,patternId,pattern:next,changed:imported.length>0||kept.length!==dto.pattern.events.length,expected:clone(dto),scope:clone(scope),sourceIds:[...targetIds],imported};
}
/** Recheck immediately before dispatch; callers additionally fence async receipts
 * by project/load/context generation. Clipboard data itself survives pattern
 * switching within the same project, as native copy/paste requires.
 */
export function rackScorePlanIsCurrent({projectId,pattern,plan,scope}){try{const current=canonical(pattern);return record(plan)&&plan.projectId===projectId&&plan.patternId===current.patternId&&same(plan.expected,current.dto)&&same(plan.scope,scope);}catch{return false;}}
