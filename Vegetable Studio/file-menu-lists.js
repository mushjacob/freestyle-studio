/** Pure helpers for the File menu's cloud lists (no DOM, no I/O). */
const rowsOf=result=>{
 const data=result?.structuredContent??result?.response??result;
 if(Array.isArray(data))return data;
 for(const key of ['projects','saves','items','data'])if(Array.isArray(data?.[key]))return data[key];
 if(Array.isArray(data?.data?.projects))return data.data.projects;
 return [];
};
const stamp=row=>{const time=Date.parse(row?.updated_at??row?.updatedAt??row?.createdAt??row?.created_at??'');return Number.isFinite(time)?time:0;};
const byNewest=rows=>rows.map((row,index)=>({row,index})).sort((a,b)=>stamp(b.row)-stamp(a.row)||a.index-b.index).map(item=>item.row);

/** The `limit` most recently updated projects as `{id,title}`, optionally skipping the open one. */
export function recentProjects(result,{limit=8,exclude=null}={}){
 return byNewest(rowsOf(result).filter(row=>row&&typeof row.id==='string'&&row.id&&row.id!==exclude))
  .slice(0,limit).map(row=>({id:row.id,title:String(row.title||row.name||'Untitled').slice(0,80)}));
}

/** Project saves, newest first, as `{id,label}`. */
export function projectSaveChoices(result,{limit=12}={}){
 return byNewest(rowsOf(result).filter(row=>row&&typeof row.id==='string'&&row.id))
  .slice(0,limit).map(row=>{
   const when=stamp(row),date=when?new Date(when).toLocaleString():'';
   return{id:row.id,label:[row.name,date].filter(Boolean).join(' · ')||row.id};
  });
}
