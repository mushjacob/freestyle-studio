/** Pure playlist selection and movement in beat/row coordinates. */
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const id=value=>value===null||value===undefined||String(value)===''?null:String(value);
const ids=value=>new Set((typeof value==='string'||typeof value==='number'?[value]:Array.from(value||[])).map(id).filter(value=>value!==null));
const list=value=>Array.isArray(value)?value:[];
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const projectId=project=>id(project?.cloud?.projectId??project?.id);
const projectClips=project=>[...list(project?.clips),...list(project?.audioClips)];

export function playlistClipBounds(clip){
 if(!finite(clip?.start)||Number(clip.start)<0||!finite(clip?.length)||Number(clip.length)<=0||!Number.isInteger(clip?.track)||clip.track<0)return null;
 return{left:Number(clip.start),right:Number(clip.start)+Number(clip.length),top:clip.track,bottom:clip.track+1};
}
function rectangle(value){
 if(!value||!['left','right','top','bottom'].every(key=>finite(value[key])))throw new TypeError('A playlist rectangle needs finite left, right, top and bottom coordinates.');
 return{left:Math.min(value.left,value.right),right:Math.max(value.left,value.right),top:Math.min(value.top,value.bottom),bottom:Math.max(value.top,value.bottom)};
}

/** Supply boundsFor when the caller already has clip rectangles in pixels. */
export function playlistClipIdsInRect(clips,rect,{boundsFor=playlistClipBounds,touches=false}={}){
 const box=rectangle(rect),found=new Set();if(box.left===box.right||box.top===box.bottom)return found;
 for(const clip of clips){
  const key=id(clip?.id),raw=boundsFor(clip);if(key===null||!raw)continue;const bounds=rectangle(raw);
  if(touches?bounds.left<=box.right&&bounds.right>=box.left&&bounds.top<=box.bottom&&bounds.bottom>=box.top:bounds.left<box.right&&bounds.right>box.left&&bounds.top<box.bottom&&bounds.bottom>box.top)found.add(key);
 }
 return found;
}
export function applyPlaylistSelection(selected,hits,{mode='replace'}={}){
 const current=ids(selected),incoming=ids(hits),next=mode==='replace'?incoming:new Set(current);
 if(mode==='add')for(const key of incoming)next.add(key);
 else if(mode==='toggle')for(const key of incoming)next.has(key)?next.delete(key):next.add(key);
 else if(mode!=='replace')throw new Error('Choose replace, add or toggle selection.');
 return selected instanceof Set&&selected.size===next.size&&[...selected].every(key=>next.has(key))?selected:next;
}
export function prunePlaylistSelection(selected,clips){
 const available=new Set(clips.map(clip=>id(clip?.id)).filter(key=>key!==null));
 return applyPlaylistSelection(selected,[...ids(selected)].filter(key=>available.has(key)));
}

/**
 * Compute from the gesture's original array every time; never accumulate deltas.
 * Source offsets, phase, lengths and all native metadata remain untouched.
 */
export function movePlaylistSelection(clips,selected,{deltaBeats=0,deltaTracks=0,snapBeats=.25,maxTrack=Infinity,cancel=false}={}){
 const unchanged=()=>({clips,changed:false,deltaBeats:0,deltaTracks:0});if(cancel)return unchanged();
 if(!finite(deltaBeats)||!finite(deltaTracks)||!finite(snapBeats)||Number(snapBeats)<0||maxTrack!==Infinity&&(!Number.isInteger(maxTrack)||maxTrack<0))throw new RangeError('Group movement needs finite deltas, non-negative snap and a valid maximum row.');
 const selectedIds=ids(selected),group=clips.filter(clip=>selectedIds.has(id(clip?.id)));if(!group.length)return unchanged();
 for(const clip of group)if(!playlistClipBounds(clip))throw new Error('A selected clip has unavailable canonical timing.');
 let beats=Number(snapBeats)>0?Math.round(Number(deltaBeats)/Number(snapBeats))*Number(snapBeats):Number(deltaBeats),tracks=Math.round(Number(deltaTracks));
 if(beats===0&&tracks===0)return unchanged();
 const firstBeat=Math.min(...group.map(clip=>Number(clip.start))),firstTrack=Math.min(...group.map(clip=>clip.track)),lastTrack=Math.max(...group.map(clip=>clip.track));
 beats=Math.max(-firstBeat,beats);
 if(tracks!==0){if(lastTrack>maxTrack)throw new RangeError('The maximum playlist row must include every selected clip.');tracks=clamp(tracks,-firstTrack,maxTrack-lastTrack);}
 if(beats===0&&tracks===0)return unchanged();
 let changed=false;const next=clips.map(clip=>{
  if(!selectedIds.has(id(clip?.id)))return clip;
  const start=beats===0?clip.start:Number(clip.start)+beats,track=tracks===0?clip.track:clip.track+tracks;
  if(start===clip.start&&track===clip.track)return clip;changed=true;return{...clip,start,track};
 });
 return changed?{clips:next,changed:true,deltaBeats:beats===0?0:beats,deltaTracks:tracks===0?0:tracks}:unchanged();
}

/** Selection belongs to one cloud project and only surviving clip identities. */
export class PlaylistSelection{
 constructor(project){this.projectId=null;this.clips=[];this.selected=new Set();if(project)this.sync(project);}
 get ids(){return new Set(this.selected);}
 has(value){return this.selected.has(id(value));}
 sync(project){
  const scope=projectId(project);this.clips=projectClips(project);
  this.selected=scope===this.projectId?prunePlaylistSelection(this.selected,this.clips):new Set();this.projectId=scope;return this.snapshot();
 }
 select(values,options){this.selected=prunePlaylistSelection(applyPlaylistSelection(this.selected,values,options),this.clips);return this.ids;}
 selectRect(rect,options){return this.select(playlistClipIdsInRect(this.clips,rect,options),options);}
 clear(){this.selected=new Set();return this.ids;}
 snapshot(){return{projectId:this.projectId,ids:[...this.selected]};}
 move(options){return movePlaylistSelection(this.clips,this.selected,options);}
}
