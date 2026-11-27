/** Pure Playlist clip group store: a plain {clipId: groupId} object. Persistence belongs to the caller. */
const text=value=>value===null||value===undefined||String(value)===''?null:String(value);

export const clipGroupsKey=projectId=>`vegetable:clip-groups:${text(projectId)??'none'}`;

/** Parse stored JSON defensively; anything malformed yields an empty store. */
export function parseClipGroups(raw){
 try{
  const value=typeof raw==='string'?JSON.parse(raw):raw,groups={};
  if(!value||typeof value!=='object'||Array.isArray(value))return{};
  for(const[clip,group]of Object.entries(value)){const g=text(group);if(g!==null&&typeof group!=='object')groups[clip]=g;}
  return dropSingles(groups);
 }catch{return{};}
}
export const serializeClipGroups=groups=>JSON.stringify(groups||{});

function dropSingles(groups){
 const counts=new Map();for(const g of Object.values(groups))counts.set(g,(counts.get(g)||0)+1);
 return Object.fromEntries(Object.entries(groups).filter(([,g])=>counts.get(g)>1));
}

/** Put the given clips (at least two) in one new group, leaving any group they left. */
export function groupClips(groups,ids,groupId){
 const list=[...new Set(Array.from(ids||[],text).filter(value=>value!==null))],gid=text(groupId);
 if(list.length<2||gid===null)return groups;
 const next={...groups};for(const id of list)next[id]=gid;return dropSingles(next);
}

/** Dissolve every group any of the given clips belongs to. */
export function ungroupClips(groups,ids){
 const touched=new Set(Array.from(ids||[],text).map(id=>groups?.[id]).filter(Boolean));
 if(!touched.size)return groups;
 return Object.fromEntries(Object.entries(groups).filter(([,g])=>!touched.has(g)));
}

/** Selection plus every member of every group it touches. */
export function expandGroupSelection(groups,ids){
 const list=Array.from(ids||[],text).filter(value=>value!==null),touched=new Set(list.map(id=>groups?.[id]).filter(Boolean));
 if(!touched.size)return list;
 const out=new Set(list);for(const[id,g]of Object.entries(groups))if(touched.has(g))out.add(id);return[...out];
}

export const groupOf=(groups,id)=>groups?.[text(id)]??null;

/** Forget clips that no longer exist; groups left with one clip dissolve. */
export function pruneClipGroups(groups,existingIds){
 const alive=new Set(Array.from(existingIds||[],text));
 return dropSingles(Object.fromEntries(Object.entries(groups||{}).filter(([id])=>alive.has(id))));
}
