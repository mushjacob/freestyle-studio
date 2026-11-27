/** Exact existing-instrument score writes using canonical pattern DTOs. */
const clone=value=>structuredClone(value),record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value),id=value=>typeof value==='string'&&value.length>0&&value.length<=256;
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const nativeDTO=pattern=>pattern?.cloudRaw?.data?.pattern?pattern.cloudRaw.data:pattern?.cloudRaw;
function complete(value){if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&child)throw new Error('Canonical MIDI import needs complete source and event data.');complete(child);}}
function patternDTO(pattern){
 const dto=nativeDTO(pattern);complete(dto);
 if(!record(dto)||!finite(dto.ppq)||dto.ppq<=0||!finite(dto.lengthTicks)||dto.lengthTicks<=0||!finite(dto.bars)||dto.bars<=0||!record(dto.pattern)||!Array.isArray(dto.pattern.sources)||!Array.isArray(dto.pattern.events))throw new Error('Reload the complete canonical pattern timebase, sources and events before importing MIDI.');
 const ids=new Set();for(const source of dto.pattern.sources){if(!record(source)||!id(String(source.id??''))||ids.has(String(source.id)))throw new Error('The canonical pattern has missing or duplicate source identities.');ids.add(String(source.id));}
 for(const event of dto.pattern.events)if(!record(event)||typeof event.type!=='string')throw new Error('The canonical pattern contains an incomplete event.');
 return dto;
}
function optionsFor(options={}){
 for(const key of Object.keys(options))if(!['replace','bars','place','placeAtMeasure'].includes(key))throw new Error(`Canonical MIDI import does not support option ${key}.`);
 if(options.replace!==undefined&&typeof options.replace!=='boolean')throw new Error('Choose an explicit replace boolean for MIDI import.');
 if(options.place!==undefined&&options.place!==false||options.placeAtMeasure!==undefined)throw new Error('Canonical MIDI import updates an existing pattern only; placement needs a separate verified cloud operation.');
 if(options.bars!==undefined&&(!finite(options.bars)||options.bars<=0))throw new Error('MIDI import length must be positive finite bars.');
 return{replace:options.replace??true,...options.bars!==undefined?{bars:options.bars}:{}};
}
export function canonicalMidiInput(notes,options={}){
 if(!Array.isArray(notes)||!notes.length)throw new Error('Choose at least one MIDI note to import.');
 const score=notes.map(note=>{
  if(!record(note)||!Number.isInteger(note.pitch)||note.pitch<0||note.pitch>127||!finite(note.start)||note.start<0||!finite(note.duration)||note.duration<=0||!finite(note.velocity)||note.velocity<0||note.velocity>1||!finite(note.start+note.duration))throw new Error('Each imported note needs MIDI pitch 0–127, finite nonnegative start, positive duration and velocity 0–1.');
  for(const key of Object.keys(note))if(!['id','pitch','start','duration','velocity'].includes(key))throw new Error(`MIDI note field ${key} has no verified canonical import mapping.`);
  return{pitch:note.pitch,start:note.start,duration:note.duration,velocity:note.velocity};
 });
 return{notes:score,options:optionsFor(options)};
}
/** Never substitutes another pattern's sourceId for the target's native map. */
export function canonicalInstrumentNoteRequest({project,pattern,channel,notes,options={},createId=()=>globalThis.crypto.randomUUID()}={}){
 const input=canonicalMidiInput(notes,options),patternId=pattern?.cloudId;
 if(!id(patternId)||pattern.id!==patternId||!project?.patterns?.some(value=>value.id===pattern.id&&value.cloudId===patternId))throw new Error('Choose a persisted canonical cloud pattern before importing MIDI.');
 const chosen=project.channels?.find(value=>value.id===channel?.id);
 if(!chosen||chosen!==channel||!['instrument','plugin'].includes(chosen.type)&&!chosen.instrumentType)throw new Error('Choose an explicit existing cloud instrument target.');
 const laneId=chosen.laneId;if(typeof laneId!=='string'||!laneId||laneId.length>64)throw new Error('The instrument has no verified durable lane binding.');
 const dto=clone(patternDTO(pattern)),sources=dto.pattern.sources;
 const owns=chosen.patternSource===true&&[pattern.id,pattern.cloudId].includes(chosen.patternId),mapped=owns&&Object.prototype.hasOwnProperty.call(pattern.cloudSources||{},chosen.id)?String(pattern.cloudSources[chosen.id]):null;
 let source;
 if(mapped!==null){source=sources.find(value=>String(value.id)===mapped);if(!source||source.kind!=='plugin'||source.laneId!==laneId)throw new Error('The current pattern instrument source no longer matches its explicit target binding.');}
 else{
  const candidates=sources.filter(value=>value.kind==='plugin'&&value.laneId===laneId);if(candidates.length>1)throw new Error('Choose a specific current-pattern instrument source; this lane has multiple source bindings.');source=candidates[0];
 }
 const usedIds=new Set([...sources.map(value=>String(value.id)),...dto.pattern.events.map(value=>String(value.id??''))]);
 const freshId=()=>{const value=createId();if(!uuid(value)||usedIds.has(value))throw new Error('MIDI import needs fresh, collision-free UUID event and source identities.');usedIds.add(value);return value;};
 let insertedSource=false;
 if(!source){
  let templates=[];
  if(chosen.patternSource===true){
   const owner=project.patterns.find(value=>[value.id,value.cloudId].includes(chosen.patternId));if(!owner)throw new Error('The chosen instrument source has no canonical owning pattern.');
   const ownerDto=patternDTO(owner),ownerId=owner.cloudSources?.[chosen.id];if(ownerId===undefined)throw new Error('The chosen instrument has no explicit source map in its owning pattern.');
   templates=ownerDto.pattern.sources.filter(value=>String(value.id)===String(ownerId)&&value.kind==='plugin'&&value.laneId===laneId);
  }else for(const owner of project.patterns){const ownerDto=patternDTO(owner);templates.push(...ownerDto.pattern.sources.filter(value=>value.kind==='plugin'&&value.laneId===laneId));}
  if(templates.length!==1)throw new Error('No unique complete canonical plugin source is bound to the chosen instrument. Add or select its verified source before importing MIDI.');
  source={...clone(templates[0]),id:freshId()};sources.push(source);insertedSource=true;
 }
 const sourceId=source.id,imported=input.notes.map(note=>{
  const startTick=note.start*dto.ppq,durationTick=note.duration*dto.ppq;if(!finite(startTick)||!finite(durationTick)||durationTick<=0||!finite(startTick+durationTick))throw new Error('The MIDI note exceeds this canonical pattern timebase.');
  return{id:freshId(),type:'midi',sourceId,note:note.pitch,startTick,durationTick,velocity:note.velocity};
 });
 const targetNote=event=>event.type==='midi'&&String(event.sourceId)===String(sourceId)&&('note'in event||'pitch'in event)&&'startTick'in event&&'durationTick'in event;
 dto.pattern.events=[...dto.pattern.events.filter(event=>!input.options.replace||!targetNote(event)),...imported];
 const endTick=imported.reduce((end,event)=>Math.max(end,event.startTick+event.durationTick),0),minimumLength=input.options.bars===undefined?dto.lengthTicks:input.options.bars*4*dto.ppq;
 if(!finite(minimumLength))throw new Error('The MIDI import pattern length exceeds its finite timebase.');
 let length=Math.max(dto.lengthTicks,minimumLength);if(endTick>length)length=Math.ceil(endTick/(4*dto.ppq))*4*dto.ppq;
 if(!finite(length))throw new Error('The MIDI import pattern length exceeds its finite timebase.');
 if(length>dto.lengthTicks){dto.lengthTicks=length;dto.bars=Math.max(dto.bars,length/(4*dto.ppq));if(Object.prototype.hasOwnProperty.call(dto,'length_ticks'))dto.length_ticks=length;}
 return{patternId,laneId,sourceId,pattern:dto,imported,insertedSource,input};
}
export function canonicalMidiWriteConfirmed(pattern,request){
 const dto=patternDTO(pattern),source=dto.pattern.sources.find(value=>String(value.id)===String(request.sourceId));
 if(!source||source.kind!=='plugin'||source.laneId!==request.laneId||dto.ppq!==request.pattern.ppq)return false;
 const targetNote=event=>event.type==='midi'&&String(event.sourceId)===String(request.sourceId)&&('note'in event||'pitch'in event)&&'startTick'in event&&'durationTick'in event,expected=request.pattern.pattern.events.filter(targetNote),actual=dto.pattern.events.filter(targetNote);
 const fields=['id','type','sourceId','note','pitch','startTick','durationTick','velocity'];
 return actual.length===expected.length&&expected.every(event=>actual.some(value=>fields.filter(key=>Object.prototype.hasOwnProperty.call(event,key)).every(key=>value[key]===event[key])));
}
