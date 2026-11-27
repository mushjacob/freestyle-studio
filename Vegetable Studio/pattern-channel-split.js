import {clonePatternForCreate} from './rack-clone.js';
/** Pure planning for Patterns > Split by channel: one new pattern per channel that has notes or steps. */
const own=(value,key)=>!!value&&Object.prototype.hasOwnProperty.call(value,key);
const hasScore=(pattern,id)=>(pattern.notes?.[id]||[]).length>0||(pattern.steps?.[id]||[]).some(Boolean);
const nativeSourceId=(pattern,channel)=>String(own(pattern.cloudSources,channel.id)?pattern.cloudSources[channel.id]:channel.sourceId??channel.id);
const contentOf=pattern=>{const raw=pattern.cloudRaw,dto=raw?.data?.pattern?raw.data:raw||{};return dto.pattern&&typeof dto.pattern==='object'?dto.pattern:null;};

export function splitPatternByChannel(project,source,{makeId}){
 const channels=project.channels||[],ids=new Set([...Object.keys(source.notes||{}),...Object.keys(source.steps||{})]);
 const keep=channels.filter(channel=>ids.has(channel.id)&&hasScore(source,channel.id));
 return keep.map(channel=>{
  const next=clonePatternForCreate(project,source,{id:makeId(),name:`${source.name} - ${channel.name||channel.id}`});
  next.notes=own(source.notes,channel.id)?{[channel.id]:structuredClone(source.notes[channel.id])}:{};
  next.steps=own(source.steps,channel.id)?{[channel.id]:structuredClone(source.steps[channel.id])}:{};
  if(next.cloudSources)next.cloudSources=Object.fromEntries(Object.entries(next.cloudSources).filter(([id])=>id===channel.id));
  const content=contentOf(next);
  if(content&&Array.isArray(content.events)){
   const others=new Set(channels.filter(other=>other.id!==channel.id).map(other=>nativeSourceId(source,other)));others.delete(nativeSourceId(source,channel));
   content.events=content.events.filter(event=>!others.has(String(event.sourceId)));
  }
  return next;
 });
}
