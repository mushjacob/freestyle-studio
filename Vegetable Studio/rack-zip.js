/** FL's zipped Channel Rack rows: view state only, kept per project in localStorage. Pure: no DOM, no I/O. */
export const rackZipKey=projectId=>`vegetable:rack-zipped:${projectId??'local'}`;
/** Parse a stored value into an array of unique row ids. Anything malformed is an empty list. */
export function parseZipped(raw){
 let value;try{value=typeof raw==='string'?JSON.parse(raw):raw;}catch{return [];}
 if(!Array.isArray(value))return [];
 return [...new Set(value.filter(id=>typeof id==='string'&&id.length>0&&id.length<=256))];
}
export const serializeZipped=ids=>JSON.stringify([...new Set(ids)]);
/** Zip the selected rows. Only ids that are real rack rows are kept; already zipped rows stay zipped. */
export function zipRows(zipped,selected,rowIds){
 const real=new Set(rowIds),next=new Set([...zipped].filter(id=>real.has(id)));
 for(const id of selected)if(real.has(id))next.add(id);
 return [...next];
}
export const unzipAll=()=>[];
export const isZipped=(zipped,id)=>new Set(zipped).has(id);
