/** Pure helpers for the Browser preview waveform and plugin presets. No DOM, no I/O. */
/** Min/max peaks per bucket, mixed across channels. Returns [{min,max}] (empty for no audio). */
export function waveformPeaks(channels,buckets){
 const list=(Array.isArray(channels)?channels:[]).filter(c=>c&&typeof c.length==='number'&&c.length>0),count=Math.max(0,Math.floor(Number(buckets)||0));
 if(!list.length||!count)return[];
 const length=Math.max(...list.map(c=>c.length)),peaks=[];
 for(let b=0;b<count;b++){
  const from=Math.floor(b*length/count),to=Math.max(from+1,Math.floor((b+1)*length/count));let min=0,max=0;
  for(const c of list)for(let i=from;i<to&&i<c.length;i++){const v=c[i];if(!Number.isFinite(v))continue;if(v<min)min=v;if(v>max)max=v;}
  peaks.push({min:Math.max(-1,min),max:Math.min(1,max)});
 }
 return peaks;
}
/** Preset display/apply name from a catalog preset row (string or object). */
export function presetName(row){
 if(typeof row==='string')return row.trim();
 const name=row?.preset??row?.name;
 return typeof name==='string'?name.trim():'';
}
/** Unique, non-empty preset names in catalog order. */
export function presetNames(rows){
 const seen=new Set(),out=[];
 for(const row of Array.isArray(rows)?rows:[]){const name=presetName(row);if(name&&!seen.has(name)){seen.add(name);out.push(name);}}
 return out;
}
/** The loaded lane plugin (with a live slot index) matching a catalog plugin id, or null. */
export function findLanePlugin(plugins,pluginId){
 if(typeof pluginId!=='string'||!pluginId)return null;
 const want=pluginId.toLowerCase();
 const matches=(Array.isArray(plugins)?plugins:[]).filter(p=>{const type=p?.type_id??p?.typeId??p?.type;return typeof type==='string'&&type.toLowerCase()===want&&Number.isInteger(p.index)&&p.index>=0;});
 return matches.length?matches[0]:null;
}
