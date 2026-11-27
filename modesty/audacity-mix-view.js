/** Audacity track-panel mix controls (gain, pan, Mute, Solo) and the playback level, revision-guarded and
 *  live-synced through MixSync. The gain and pan sliders are heard while they move and saved once on release
 *  as one Edit → Undo entry ("Moved gain slider" / "Moved pan slider"); Mute/Solo toggles are not undo entries.
 *  The Simple solo mode solos the clicked track exclusively (Shift-click adds/removes one track). The exclusive
 *  solo touches several lanes, so it is one mix:apply step and one Edit → Undo entry.
 */
import {MixSync,mixKey,sameMixValue} from './mix-sync.js';
import {panText} from './audacity-lane-pan-view.js';
import {bridgeFetch} from './freestyle-host-transport.js';
import {LiveControl} from './live-control.js';

const gainTitle=value=>Number(value)>0?(20*Math.log10(Number(value))).toFixed(1)+' dB':'−∞ dB';
const projectIdOf=w=>w.getProject().cloud?.projectId||w.getProject().id;

export class AudacityMixView{
  constructor(workspace,{factory=options=>new MixSync(options),features=null}={}){this.w=workspace;this.factory=factory;this.sync=null;this.featureSource=features;if(features&&typeof features==='object')this.featureValue=features;}
  /** The live mix:wait loop is gated on /api/tools features.mixWait (mixRevision gates the guards server-side). */
  features(){this.featureRequest??=(this.featureSource?Promise.resolve(typeof this.featureSource==='function'?this.featureSource():this.featureSource):bridgeFetch('modesty-bridge:/tools').then(response=>response.ok?response.json():{}).then(data=>data?.features||{})).catch(()=>({})).then(features=>{this.featureValue=features||{};return this.featureValue;});return this.featureRequest;}
  get past(){return this.sync?.past??new Map();}
  get future(){return this.sync?.future??new Map();}
  uncertain(){return false;}
  unverified(){return false;}
  /** One MixSync (and one mix:wait loop) per open project; replaced on project switch. */
  ensure(){
    const w=this.w,e=w.engine,projectId=projectIdOf(w);
    if(!e?.ready||!projectId||!e.session?.call){if(this.sync&&this.sync.projectId!==projectId){this.sync.stop();this.sync=null;}return null;}
    if(this.sync?.projectId===projectId)return this.sync;
    this.sync?.stop();
    const session=e.session,sync=this.factory({call:(name,args,options)=>session.call(name,args,options),action:(name,args,options)=>session.action(name,args,options),projectId,contextTrackId:session.trackId||null,notice:message=>e.onStatus?.(message),live:(key,value)=>this.liveSend(sync,key,value)});
    sync.addEventListener('change',event=>this.paint(event.detail.changed));
    sync.addEventListener('written',event=>this.paint([event.detail.key]));
    sync.addEventListener('recorded',()=>w.recordOwnedHistory?.('mix'));
    this.sync=sync;this.features().then(features=>{if(this.sync===sync&&features?.mixWait===true)sync.start();else if(this.sync===sync&&features?.mixRevision===true)sync.read().catch(()=>{});});return sync;
  }
  /** The realtime path for one control while it is held (see MixSync.sweep):
   *  - lane gain  → `set_track_gain` on the monitor peer's mozart-control data channel (documented, no ack, not saved);
   *                 without an open channel → live REST setLaneGain {persist:false};
   *  - master / bus level → live REST setMasterGain / setBusGain {persist:false} (no data-channel message exists);
   *  - lane pan   → live REST setLanePan {persist:false} (no data-channel message exists).
   *  A bridge that refuses a live write makes MixSync pace the guarded saved write for that gesture instead. */
  get liveControl(){return this.liveControlValue??=new LiveControl({monitor:()=>this.w.engine?.monitor,projectId:()=>this.sync?.projectId??null});}
  liveSend(sync,key,value){
    const [kind,id,field]=key.split(':');if(!Number.isFinite(Number(value)))return false;
    if(kind==='lane'&&field==='gain'&&this.liveControl.gain(id,Number(value)))return true;
    if(field==='gain'||kind==='lane'&&field==='pan')return sync.liveWrite(key,Number(value));
    return false;
  }
  /** Pointer up. A press that never moved the slider holds nothing. A drag normally ends with the browser's
   *  `change` event (→ commit); when the slider was dragged back to where it started there is no `change`, so the
   *  gesture is committed here, after the event that would have carried it. */
  released(key,input,options={}){
    const sync=this.sync;if(!sync||sync.release(key))return;
    setTimeout(()=>{if(this.sync!==sync||!sync.dragStart.has(key))return;const [kind,id,field]=key.split(':');if(kind==='lane'&&field==='gain')this.liveControl.flush(`gain:${id}`);this.w.run(()=>sync.commit(key,Number(input.value),options));},0);
  }
  async history(direction){return this.sync?this.sync.history(direction):false;}
  trackFor(laneId){return this.w.tracks.find(track=>track.laneId===laneId);}
  /** Adopt a server or optimistic value into the project model and the engine snapshot, so the legacy
   *  project diff never re-sends it, then repaint the control. */
  paint(keys=[]){
    const w=this.w,sync=this.sync;if(!sync)return;const project=w.getProject(),snapshot=w.engine?.snapshot;
    for(const key of keys){
      const [kind,id,field]=key.split(':'),value=sync.value(key);if(value===undefined)continue;
      if(kind==='master'){for(const target of [project,snapshot])if(target)target.master=Number(value);const input=w.header?.querySelector?.('#au-playback-level')||globalThis.document?.querySelector('#au-playback-level');if(input&&!sync.dragging.has(key))input.value=String(value);continue;}
      if(kind!=='lane')continue;
      const prop={gain:'volume',pan:'pan',muted:'mute',soloed:'solo'}[field];if(!prop)continue;
      for(const target of [project,snapshot]){const channel=target?.channels?.find(row=>row.laneId===id||row.id===id);if(channel)channel[prop]=field==='gain'||field==='pan'?Number(value):!!value;}
      const track=this.trackFor(id),row=track&&w.root?.querySelector(`.au-track[data-track="${track.index}"]`);if(!row||sync.dragging.has(key))continue;
      if(field==='gain'){const input=row.querySelector('[data-action=gain]');if(input){input.value=String(value);input.title=gainTitle(value);}}
      else if(field==='pan'){const input=row.querySelector('[data-action=pan]');if(input){input.value=String(value);const text=panText(Number(value));input.title=text+'; double-click to center';input.setAttribute('aria-valuetext',text);}}
      else{const button=row.querySelector(`[data-action=${field==='muted'?'mute':'solo'}]`);if(button){button.classList.toggle('active',!!value);button.setAttribute('aria-pressed',String(!!value));}}
    }
  }
  current(key,fallback){const value=this.sync?.value(key);return value===undefined?fallback:value;}
  /** Synchronous gate: the guarded mix path is used once /api/tools has advertised mixRevision; until then (or on
   *  an older backend) the controls keep their previous verified write paths. */
  live(){return this.featureValue?.mixRevision===true?this.ensure():null;}
  bindTrack(row,track){
    const w=this.w,laneId=track.laneId,c=track.channel;if(!laneId)return;
    // Heard while the slider moves (sweep → realtime path), saved once on release (commit → one Undo entry).
    const slider=(action,field,title,legacy,label)=>{
      const input=row.querySelector(`[data-action=${action}]`);if(!input)return;const key=mixKey('lane',laneId,field);
      const saved=()=>{const channel=w.getProject().channels?.find(item=>item.laneId===laneId||item.id===laneId)??c;return Number(channel?.[field==='gain'?'volume':'pan']??(field==='gain'?1:0));};
      input.onpointerdown=()=>this.live()?.begin(key,saved());
      input.onpointerup=input.onpointercancel=()=>this.released(key,input,{label});
      input.oninput=()=>{const value=Number(input.value);title(input,value);const sync=this.live();if(!sync)return;if(!sync.dragStart.has(key))sync.begin(key,saved());sync.sweep(key,value);};
      input.onchange=()=>{const sync=this.live();if(!sync)return w.run(()=>legacy(Number(input.value)));const value=Number(input.value);if(field==='gain')this.liveControl.flush(`gain:${laneId}`);w.run(()=>sync.commit(key,value,{label}));};
      return input;
    };
    slider('gain','gain',(input,value)=>{input.title=gainTitle(value);},value=>w.action('set_track_gain',{track_id:laneId,gain:value}),'Moved gain slider');
    const pan=slider('pan','pan',(input,value)=>{const text=panText(value);input.title=text+'; double-click to center';input.setAttribute('aria-valuetext',text);},value=>w.lanePan.set(laneId,value),'Moved pan slider');
    if(pan)pan.ondblclick=event=>{event.preventDefault();event.stopPropagation();pan.value='0';pan.oninput();pan.onchange();};
    const muted=()=>!!c?.mute||(w.getProject().mutedTracks||[]).includes(track.index);
    const mute=row.querySelector('[data-action=mute]');
    if(mute)mute.onclick=()=>{const sync=this.live();if(!sync)return w.run(()=>w.action('set_track_muted',{track_id:laneId,muted:!muted()}));const key=mixKey('lane',laneId,'muted'),next=!this.current(key,muted());this.paintOptimistic(key,next);w.run(()=>sync.set(key,next,{debounce:false}));};
    const solo=row.querySelector('[data-action=solo]');
    if(solo)solo.onclick=event=>{const sync=this.live();if(!sync)return w.run(()=>w.action('set_track_soloed',{track_id:laneId,soloed:!w.trackSolo(track)}));w.run(()=>this.solo(track,{additive:!!event?.shiftKey}));};
  }
  paintOptimistic(key,value){this.sync?.local.set(key,value);this.paint([key]);}
  /** Tracks > Mute/Unmute and Tracks > Pan: one all-or-nothing mix step (one revision, one Undo entry) for several lanes. */
  async setMany(field,value,tracks,label){
    const sync=this.live(),entries=tracks.filter(track=>track?.laneId).map(track=>[mixKey('lane',track.laneId,field),value]).filter(([key])=>!sync||!Object.is(sync.value(key),value));
    if(!sync)throw new Error('The live mixer is not connected yet. Use the track controls, or try again in a moment.');
    if(!entries.length)return null;
    const result=await sync.apply(entries,{label});this.paint(entries.map(([key])=>key));return result;
  }
  /** Audacity "Simple" solo: exclusive unless Shift is held; several lanes change in one mix:apply step. */
  solo(track,{additive=false}={}){
    const sync=this.ensure(),w=this.w,key=mixKey('lane',track.laneId,'soloed'),next=!this.current(key,w.trackSolo?.(track)??!!track.channel?.solo);
    const others=w.tracks.filter(row=>row.laneId&&row.laneId!==track.laneId&&this.current(mixKey('lane',row.laneId,'soloed'),w.trackSolo?.(row)??!!row.channel?.solo));
    if(additive||!next||!others.length){this.paintOptimistic(key,next);return sync.set(key,next,{debounce:false});}
    return sync.apply([[key,true],...others.map(row=>[mixKey('lane',row.laneId,'soloed'),false])],{label:`Solo ${track.name||'track'}`});
  }
  bindMaster(input){
    if(!input)return;const key=mixKey('master','master','gain');
    // Playback level: live while it moves (setMasterGain persist:false), saved once on release. Like the
    // playback volume it is modeled on, it is not an Edit → Undo entry.
    const saved=()=>Number(this.w.getProject().master??1);
    input.onpointerdown=()=>this.live()?.begin(key,saved());
    input.onpointerup=input.onpointercancel=()=>this.released(key,input);
    input.oninput=()=>{const sync=this.live();if(!sync)return;if(!sync.dragStart.has(key))sync.begin(key,saved());sync.sweep(key,Number(input.value));};
    input.onchange=()=>{const sync=this.live();if(!sync)return this.w.run(()=>this.w.edit(()=>this.w.getProject().master=Number(input.value)));this.w.run(()=>sync.commit(key,Number(input.value)));};
  }
  stop(){this.sync?.stop();this.sync=null;}
}
export {sameMixValue};
