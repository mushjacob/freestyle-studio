/** Mixer sends (FL route arrows and send knobs) on Freestyle's aux-sends API: pure view state, no DOM, no I/O.
 * A send is a parallel copy of one lane (not the backing) into one bus, in addition to the lane's output
 * route: linear level 0..2 (6 decimals), tapped pre- or post-fader. The live list is `tracks[].sends`
 * [{bus_id, level, pre_fader}] of the engine mix (getEngineMix); a lane is `db_track_id`.
 * Lane-to-lane routes, bus sources and sidechain are not in this engine: they are off-items, never faked.
 */
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=64;
export const SEND_DEFAULT_LEVEL=1;
export const SEND_MAX_LEVEL=2;
export const MAX_SENDS_PER_LANE=16;
export const SEND_LABELS=Object.freeze({route:'Route to this track',unroute:'Remove the send to this track',level:'Send level',pre:'Pre-fader',post:'Post-fader',exclusive:'Route to this track only',sidechain:'Sidechain to this track'});
export const SEND_REASONS=Object.freeze({
 engine:'The audio engine needs an update for sends.',
 busy:'Finish the current edit before changing a send.',
 source:'Select a lane to route from. Only lanes can send; the backing and buses cannot.',
 destination:'Sends go to a bus. Lane-to-lane routes are not supported in this engine.',
 limit:`A lane can have at most ${MAX_SENDS_PER_LANE} sends.`,
 exclusive:'A send always adds to the lane output route; routing to one track only needs the output route dialog.',
 sidechain:'Sidechain routing is not supported in this engine.',
});
/** Engines that report sends put a `sends` array on their mix tracks. */
export const sendsSupported=mix=>record(mix)&&Array.isArray(mix.tracks)&&mix.tracks.some(track=>record(track)&&Array.isArray(track.sends));
export const roundLevel=level=>Math.round(level*1e6)/1e6;
function sendOf(laneId,row){
 if(!record(row)||!identity(row.bus_id??row.busId)||!finite(row.level)||row.level<0||row.level>SEND_MAX_LEVEL)return null;
 return{laneId,busId:row.bus_id??row.busId,level:roundLevel(row.level),preFader:(row.pre_fader??row.preFader)===true};
}
/** Valid live sends of a getEngineMix body: [{laneId,busId,level,preFader}]. */
export function liveSends(mix){
 if(!record(mix)||!Array.isArray(mix.tracks))return[];
 const out=[],seen=new Set();
 for(const track of mix.tracks){
  if(!record(track)||!identity(track.db_track_id)||!Array.isArray(track.sends))continue;
  for(const row of track.sends){const send=sendOf(track.db_track_id,row),key=send&&`${send.laneId}\u0000${send.busId}`;if(send&&!seen.has(key)){seen.add(key);out.push(send);}}
 }
 return out;
}
/** The send API's LaneSend card {busId,level,preFader} (or null) as a live send of `laneId`. */
export const sendFromCard=(laneId,card)=>card==null?null:sendOf(laneId,card);
export const toWire=send=>({bus_id:send.busId,level:send.level,pre_fader:send.preFader});
export const findSend=(sends,laneId,busId)=>sends.find(send=>send.laneId===laneId&&send.busId===busId)??null;
export const sendsFrom=(sends,laneId)=>sends.filter(send=>send.laneId===laneId);
/** Held list after one acknowledged write. ops: {type:'put',send} | {type:'remove',laneId,busId}. */
export function sendsAfter(sends,op){
 if(op.type==='put')return[...sends.filter(send=>!(send.laneId===op.send.laneId&&send.busId===op.send.busId)),op.send];
 if(op.type==='remove')return sends.filter(send=>!(send.laneId===op.laneId&&send.busId===op.busId));
 return sends;
}
export const levelPercent=level=>finite(level)?Math.round(Math.max(0,Math.min(SEND_MAX_LEVEL,level))*100):0;
export const percentToLevel=percent=>finite(percent)?roundLevel(Math.max(0,Math.min(SEND_MAX_LEVEL*100,Math.round(percent)))/100):null;
export const levelText=level=>`${levelPercent(level)}%`;
const isBacking=row=>row.id==='backing'||row.laneKind==='backing';
const isMaster=row=>row.kind==='bus'&&row.id==='master';
/**
 * What the route arrow at the bottom of `destination` shows while `source` is the selected strip.
 * null: nothing to draw (no selection, or the master, which every strip already reaches).
 * Otherwise {visible, state:'routed'|'off'|'self', enabled, reason, level, preFader, count}.
 * `source` / `destination` are mixer rows ({kind,id,laneKind}).
 */
export function sendRouteView({source,destination,sends=[],supported=false,editable=true}={}){
 if(!source||!destination||isMaster(destination))return null;
 if(source.kind===destination.kind&&source.id===destination.id)return{visible:false,state:'self',enabled:false,reason:null,level:null,preFader:false,count:0};
 const existing=source.kind==='lane'&&destination.kind==='bus'?findSend(sends,source.id,destination.id):null,count=source.kind==='lane'?sendsFrom(sends,source.id).length:0;
 const state=existing?'routed':'off',base={visible:true,state,level:existing?.level??null,preFader:existing?.preFader===true,count},blocked=reason=>({...base,enabled:false,reason});
 if(!supported)return blocked(SEND_REASONS.engine);
 if(source.kind!=='lane'||isBacking(source))return blocked(SEND_REASONS.source);
 if(destination.kind!=='bus')return blocked(SEND_REASONS.destination);
 if(!editable)return blocked(SEND_REASONS.busy);
 if(!existing&&count>=MAX_SENDS_PER_LANE)return blocked(SEND_REASONS.limit);
 return{...base,enabled:true,reason:null};
}
/** Name + percent + tap for the arrow's tooltip. */
export function sendRouteTitle(view,{sourceName='this track',destinationName='this track'}={}){
 if(!view?.visible)return '';
 if(!view.enabled)return view.reason||'Unavailable';
 return view.state==='routed'?`${SEND_LABELS.unroute}: ${sourceName} → ${destinationName} · ${levelText(view.level)} · ${view.preFader?'pre':'post'}-fader`:`${SEND_LABELS.route}: ${sourceName} → ${destinationName}`;
}
/** Right-click menu of a route arrow: [{id,label,checked?,disabled?,reason?}] (the app maps it to menu items; `off` items carry their reason). */
export function sendMenuModel(view){
 const live=view?.enabled===true,routed=view?.state==='routed',off=(id,label,reason)=>({id,label,disabled:true,reason});
 return[
  routed?{id:'unroute',label:SEND_LABELS.unroute,disabled:!live,reason:live?null:view?.reason??null}:{id:'route',label:SEND_LABELS.route,disabled:!live,reason:live?null:view?.reason??null},
  ...routed?[{id:'post',label:SEND_LABELS.post,checked:view.preFader!==true,disabled:!live},{id:'pre',label:SEND_LABELS.pre,checked:view.preFader===true,disabled:!live},{id:'reset',label:`${SEND_LABELS.level}: reset to 100%`,disabled:!live||levelPercent(view.level)===100}]:[],
  off('exclusive',SEND_LABELS.exclusive,SEND_REASONS.exclusive),
  off('sidechain',SEND_LABELS.sidechain,SEND_REASONS.sidechain),
 ];
}
