/** FL Channel Rack "Clone pattern" / "Clone channel" over canonical Freestyle patterns.
 *
 * Both are local model edits that the ordinary edit pipeline turns into the
 * supported `create_pattern` / `update_pattern` actions. A clone must never carry
 * the source's durable identity: a retained cloudId would make `update_pattern`
 * (or retained pattern history, which keys by cloudId) target the original.
 */
import {allocatePatternSourceChannelId} from './cloud-session.js';
import {isStepPianoNote} from './step-piano.js';

const copy=value=>structuredClone(value);
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
const setField=(object,key,value)=>Object.defineProperty(object,key,{value,writable:true,enumerable:true,configurable:true});
const defaultId=()=>globalThis.crypto?.randomUUID?.()||`clone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
/** Saved-record identity/audit fields that belong to the source pattern only. */
const PATTERN_IDENTITY_FIELDS=['id','pattern_id','patternId','createdAt','created_at','createdByUserId','created_by_user_id','updatedAt','updated_at','etag','revision'];

/** FL-style "Name #2", "Name #3" … that does not collide with existing names. */
export function cloneName(name,existing=[]){
 const base=String(name??'').replace(/\s+#\d+$/,'')||'Untitled',taken=new Set(Array.from(existing,String));
 for(let index=2;;index++){const candidate=`${base} #${index}`;if(!taken.has(candidate))return candidate;}
}

/** A new unsaved pattern with the source's complete score and opaque content metadata. */
export function clonePatternForCreate(project,source,{id=`local-${defaultId()}`,name}={}){
 if(!source||!project?.patterns?.includes(source))throw new Error('Choose an existing pattern to clone.');
 const next=copy(source);
 next.id=id;delete next.cloudId;
 next.name=name??cloneName(source.name,project.patterns.map(pattern=>pattern.name));
 if(next.cloudRaw&&typeof next.cloudRaw==='object'){
  for(const field of PATTERN_IDENTITY_FIELDS)delete next.cloudRaw[field];
  if(next.cloudRaw.data&&typeof next.cloudRaw.data==='object')for(const field of PATTERN_IDENTITY_FIELDS)delete next.cloudRaw.data[field];
 }
 return next;
}

function patternContent(pattern){const raw=pattern?.cloudRaw,dto=raw?.data?.pattern?raw.data:raw||{};return dto.pattern&&typeof dto.pattern==='object'?dto.pattern:null;}
function patternSources(pattern){const sources=patternContent(pattern)?.sources;return Array.isArray(sources)?sources:[];}
function ownerPattern(project,channel,selected){
 if(channel.patternSource){
  const matches=project.patterns.filter(pattern=>[pattern.id,pattern.cloudId].some(value=>value!=null&&String(value)===String(channel.patternId)));
  if(matches.length!==1)throw new Error('Reload this channel’s pattern before cloning it.');
  return matches[0];
 }
 if(!selected||!project.patterns.includes(selected))throw new Error('Select a pattern before cloning this channel.');
 return selected;
}
function baseSource(pattern,channel){
 const mapped=own(pattern.cloudSources,channel.id)?pattern.cloudSources[channel.id]:channel.sourceId??channel.id;
 const existing=patternSources(pattern).find(source=>String(source.id)===String(mapped));
 if(existing)return copy(existing);
 if(channel.cloudSource)return copy(channel.cloudSource);
 if(channel.audioFileId)return {kind:'sample',name:channel.name,audioFileId:channel.audioFileId,durationSec:channel.durationSec||0,samplePlaybackMode:'one-shot',rootPitch:channel.rootPitch??60,busId:'master',muted:!!channel.mute,solo:!!channel.solo,volume:Number.isFinite(Number(channel.volume))?Number(channel.volume):1,...(channel.rackId?{rackId:channel.rackId}:{})};
 if(channel.laneId&&(channel.type==='instrument'||channel.instrumentType))return {kind:'plugin',name:channel.name,laneId:channel.laneId,instrumentType:channel.instrumentType||'',busId:'master',muted:!!channel.mute,solo:!!channel.solo,volume:Number.isFinite(Number(channel.volume))?Number(channel.volume):1};
 throw new Error(`${channel.name||'This channel'} has no Freestyle sample or instrument to clone.`);
}

/** Validate and prepare an FL "Clone channel" without mutating the project.
 * The clone is a new pattern source in the owner pattern (the selected pattern
 * for an instrument-lane row) that uses the same sample or instrument lane, with
 * a copy of that pattern's steps and authored notes under fresh event IDs. */
export function planChannelClone(project,channelId,{pattern:selected,uid=defaultId}={}){
 const channel=project?.channels?.find(item=>item.id===channelId);
 if(!channel)throw new Error('Choose an existing channel to clone.');
 const owner=ownerPattern(project,channel,selected),source=baseSource(owner,channel);
 const reservedSources=new Set();
 for(const pattern of project.patterns){for(const item of patternSources(pattern))reservedSources.add(String(item.id));for(const value of Object.values(pattern.cloudSources||{}))reservedSources.add(String(value));}
 let sourceId;do sourceId=`${source.kind==='plugin'?'plugin':'sample'}-clone:${uid()}`;while(reservedSources.has(sourceId));
 const reservedChannels=new Set(project.channels.map(item=>String(item.id)));
 for(const pattern of project.patterns)for(const key of [...Object.keys(pattern.steps||{}),...Object.keys(pattern.notes||{})])reservedChannels.add(String(key));
 const id=allocatePatternSourceChannelId(owner.id,sourceId,reservedChannels);
 const name=cloneName(channel.name,project.channels.map(item=>item.name));
 const order=Math.max(-1,...patternSources(owner).map(item=>Number(item.order)).filter(Number.isFinite))+1;
 // Like a newly registered Rack sample, a cloned sample row gets fresh source and rack identities.
 const nextSource={...source,id:sourceId,name,order,...(source.kind==='sample'?{rackId:`rack-clone:${uid()}`}:{})};
 const steps=Array.isArray(owner.steps?.[channel.id])?copy(owner.steps[channel.id]):Array(16).fill(false);
 const notes=(Array.isArray(owner.notes?.[channel.id])?owner.notes[channel.id]:[]).filter(note=>!isStepPianoNote(note)).map(note=>{
  const next=copy(note),noteId=uid();next.id=noteId;
  if(next.cloudRaw&&typeof next.cloudRaw==='object')next.cloudRaw={...next.cloudRaw,id:noteId,sourceId};
  return next;
 });
 // Canonical events the Rack/Piano views do not map (CC automation, protected
 // zero-velocity hits) are retained raw by the serializer; copy them too.
 const mappedSource=own(owner.cloudSources,channel.id)?owner.cloudSources[channel.id]:channel.sourceId??channel.id,mappedEvents=new Set((owner.cloudMappedEventIds||[]).map(String));
 const rawEvents=(patternContent(owner)?.events||[]).filter(event=>event&&String(event.sourceId)===String(mappedSource)&&!mappedEvents.has(String(event.id))).map(event=>({...copy(event),id:uid(),sourceId}));
 const cloned={...copy(channel),id,name,cloudName:name,patternSource:true,patternId:owner.id,sourceId,cloudSource:nextSource,cloudRaw:copy(nextSource)};
 delete cloned.engineTrackId;if(nextSource.rackId)cloned.rackId=nextSource.rackId;
 return {channelId,ownerId:owner.id,channel:cloned,steps,notes,rawEvents};
}

/** Apply a prepared clone inside the ordinary edit callback. */
export function applyChannelClone(project,plan){
 const owner=project.patterns.find(pattern=>pattern.id===plan.ownerId),index=project.channels.findIndex(channel=>channel.id===plan.channelId);
 if(!owner||index<0)throw new Error('The project changed before the channel clone.');
 owner.cloudSources||={};owner.steps||={};owner.notes||={};
 setField(owner.cloudSources,plan.channel.id,plan.channel.sourceId);setField(owner.steps,plan.channel.id,copy(plan.steps));setField(owner.notes,plan.channel.id,copy(plan.notes));
 if(plan.rawEvents?.length){const content=patternContent(owner);if(!Array.isArray(content?.events))throw new Error('Reload the full canonical pattern before cloning this channel.');content.events.push(...copy(plan.rawEvents));}
 project.channels.splice(index+1,0,copy(plan.channel));
 return project.channels[index+1];
}

/** Remove a Rack channel's score from every pattern, including sparse ones. */
export function removeChannelScore(project,channelId){
 for(const pattern of project.patterns||[])for(const field of ['steps','notes','cloudSources'])if(pattern[field]&&typeof pattern[field]==='object')delete pattern[field][channelId];
}
