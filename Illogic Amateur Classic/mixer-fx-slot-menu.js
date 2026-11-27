/**
 * FL Studio mixer insert-slot context menu (right-click on an FX slot).
 * Returns rows in app.js `menu()` format: [label, shortcut, run, disabled, title]
 * with `null` separators. Pure: the caller supplies the guarded actions.
 */
export function fxSlotMenuItems({plugin=null,slotIndex=0,loadedIndexes=[],ready=true,busy=false,recovery=false,bypassKnown=false,actions={}}={}){
 const run=name=>()=>actions[name]?.();
 if(!plugin){
  return[[`Select plugin…`,`Slot ${slotIndex+1}`,run('select'),!ready||busy||recovery,recovery?'Inspect the previous plugin operation first.':'']];
 }
 const locked=!ready||busy,blocked=locked||recovery,indexes=[...loadedIndexes].filter(Number.isInteger).sort((a,b)=>a-b),position=indexes.indexOf(plugin.index);
 const inspect=recovery?'Inspect the previous plugin operation first.':'';
 return[
  ['Replace…','',run('replace'),blocked,inspect],
  ['Open editor','',run('editor'),!ready],
  null,
  [plugin.bypassed?'Enable (un-bypass)':'Bypass','',run('bypass'),blocked||!bypassKnown,inspect||(!bypassKnown?'Read this effect’s bypass state in FX options first.':'')],
  ['Move up','',run('up'),blocked||position<=0,inspect],
  ['Move down','',run('down'),blocked||position<0||position>=indexes.length-1,inspect],
  null,
  ['Delete','',run('remove'),blocked,inspect],
 ];
}
/** Saved-chain plug-ins with no live slot index yet, placed at their saved chain position
 * (FL draws a chain in slot order; such a row is never listed below the last slot). */
export function savedSlotPlugins(plugins,indexed=new Map()){
 const out=new Map();
 for(const plugin of Array.isArray(plugins)?plugins:[]){
  if(Number.isInteger(plugin?.index)&&plugin.index>=0)continue;
  const position=[plugin?.position,plugin?.raw?.position,plugin?.chain_position].find(value=>Number.isInteger(value)&&value>=0&&value<=64);
  if(position===undefined||indexed.has(position)||out.has(position))continue;out.set(position,plugin);
 }
 return out;
}
