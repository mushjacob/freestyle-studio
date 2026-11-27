/** FL-style "add a plug-in" menus. Pure builders: rows are app.js `menu()` rows
 *  ([label, shortcut, run, disabled, title], `null` separators, {label, submenu}).
 *
 *  FL reference: the Channel rack "+" button and the main Add menu list the
 *  instrument plug-ins directly, then "More plugins…" (the plug-in picker, F8);
 *  an empty mixer insert slot opens a drop-down of effects with "More plugins…". */
const text=value=>typeof value==='string'?value.trim():'';

/** Catalog instruments that can be added now, sorted by name. */
export function creatableInstruments(rows){
 return(Array.isArray(rows)?rows:[]).filter(row=>row&&text(row.id)&&text(row.name)&&row.creatable===true&&row.availability?.checked===true&&row.availability?.installed===true).sort((a,b)=>a.name.localeCompare(b.name));
}
/** Why a catalog instrument cannot be added (null when it can). */
export function instrumentBlockReason(row){
 if(!row||row.creatable!==true)return'This catalog instrument cannot be created.';
 if(row.availability?.checked!==true)return'Host availability is unconfirmed.';
 if(row.availability?.installed!==true)return'This instrument is not installed on the project’s engine host.';
 return null;
}

/** Channel rack "+" / main Add menu. `instruments` is null while the catalog is still loading. */
export function generatorMenuItems({instruments=null,loading=false,error=null,onAdd,onMore,onDialog,extras=[]}={}){
 const rows=[];
 if(Array.isArray(instruments)&&instruments.length)for(const row of instruments)rows.push([row.name,text(row.category),()=>onAdd(row)]);
 else rows.push([loading?'Reading instruments…':error?'Instruments unavailable':'No instruments available','',()=>{},true,loading?'Freestyle is reading the instrument catalog.':error?`Freestyle: ${error}`:'No creatable instrument is installed on this project’s Freestyle engine host.']);
 rows.push(null,['More plugins…','F8',()=>onMore()]);
 if(typeof onDialog==='function')rows.push(['Add instrument…','',()=>onDialog(),false,'Choose the instrument and a channel name']);
 if(extras.length)rows.push(null,...extras);
 return rows;
}

/** Group effects by category for the insert-slot drop-down. */
export function effectsByCategory(effects){
 const groups=new Map();
 for(const item of Array.isArray(effects)?effects:[]){
  if(!item||!text(item.name))continue;
  const category=text(item.category)||'Other';if(!groups.has(category))groups.set(category,[]);groups.get(category).push(item);
 }
 return[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([category,items])=>({category,items:items.sort((a,b)=>a.name.localeCompare(b.name))}));
}

/** Empty mixer insert slot drop-down: categories as sub-menus, then "More plugins…". */
export function effectSlotPickItems({effects=null,loading=false,error=null,slotIndex=0,disabled=false,reason='',idOf=item=>item.id,onLoad,onMore}={}){
 const rows=[[`Slot ${slotIndex+1}`,'',()=>{},true]];
 if(Array.isArray(effects)&&effects.length){
  for(const {category,items}of effectsByCategory(effects))rows.push({label:category,disabled,title:disabled?reason:'',submenu:items.map(item=>[item.name,item.hostGated?'host':'',()=>onLoad(idOf(item),item),disabled||!!item.hostGated,item.hostGated?'This effect needs host access.':reason])});
 }else rows.push([loading?'Reading effects…':error?'Effects unavailable':'No effects available','',()=>{},true,loading?'Freestyle is reading the effect catalog.':error?`Freestyle: ${error}`:'No effect is available on this project’s Freestyle engine host.']);
 rows.push(null,['More plugins…','F8',()=>onMore(),disabled,reason]);
 return rows;
}
