/** Automation clip lanes for one timeline clip, matching the Freestyle Studio's
 * automation lane (context menu, keyboard handler) and
 * knob "Automate <param>" entry.
 *
 * Lanes are clip-relative: Freestyle automation envelopes belong to a clip
 * (`clip_gain` "Volume", or a `plugin_parameter` of a plugin on the clip's
 * lane). Edits are optimistic and persisted in the background by
 * AutomationStore; Undo/Redo is the store's owned history.
 */
import {CLIP_GAIN_TARGET,CURVES,copyPoints,displayMapping,evaluate,formatAutomationValue,lastIndexAt,normalizeEnvelopePoints,nudgePoints,pastePoints,pointKeys,selectedIndices,setCurve,snapTime,transformPoints,defaultEnvelopePoints} from './automation-model.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const LANE_HEIGHT=64,MAX_VISIBLE_POINTS=1200;
let clipboard=null; // One module clipboard shared by every lane.
export const automationClipboard={get:()=>clipboard,set:value=>{clipboard=value;}};

function stylesheet(doc){if(doc.querySelector('link[data-automation-lanes]'))return;const link=doc.createElement('link');link.rel='stylesheet';link.href=new URL('./automation-lanes.css',import.meta.url).href;link.dataset.automationLanes='true';doc.head.append(link);}

/** Plugin parameters as the Freestyle Studio targets them: pluginInstanceId,
 * pluginIndex, paramIndex and the host-stable id from the parameter list. */
export function pluginParameterTarget(plugin,parameter){
  const instance=String(plugin?.instanceId||plugin?.instance_id||plugin?.pluginKey||'').trim(),stable=String(parameter?.id??parameter?.stable_param_id??parameter?.stableParamId??'').trim();
  if(!instance||!stable||!Number.isInteger(plugin?.index)||!Number.isInteger(parameter?.index))throw new Error('This plugin parameter has no stable automation identity.');
  const target={kind:'plugin_parameter',pluginInstanceId:instance,pluginIndex:plugin.index,paramIndex:parameter.index,stableParamId:stable,name:String(parameter.name||`Parameter ${parameter.index}`).slice(0,128)};
  if(parameter.unit)target.unit=String(parameter.unit).slice(0,32);
  return target;
}

export class AutomationLanesPanel{
  constructor({store,document:doc=globalThis.document,getClip,getPosition=()=>null,getBpm=()=>120,listPlugins=()=>[],listParameters=async()=>[],undo=null,redo=null,onClose=()=>{},onError=()=>{}}={}){
    Object.assign(this,{store,doc,getClip,getPosition,getBpm,listPlugins,listParameters,undo,redo,onClose,onError});
    this.lanes=new Map();this.clip=null;this.root=null;this.frame=null;this.snap='pro';this.unsubscribe=null;
  }
  get open(){return !!this.root?.isConnected;}
  async show(clipRef){
    const clip=this.getClip(clipRef);if(!clip)throw new Error('Select a cloud clip before showing automation.');
    if(!(clip.durationSec>0))throw new Error('The clip’s placement duration is unknown. Reload the project before editing automation.');
    this.clip=clip;this.build();this.status('Reading cloud automation…');
    try{await this.store.load(clip.clipId,clip.durationSec,{force:true});if(this.clip!==clip)return this;const canonical=this.store.canonicalDuration?.(clip.clipId);if(canonical>0){clip.durationSec=canonical;this.root.querySelector('.automation-lanes-span').textContent=`${canonical.toFixed(3)} s`;}this.status('');}
    catch(error){this.status(error.message,true);this.onError(error);}
    this.renderLanes();this.startFollow();return this;
  }
  close(){this.stopFollow?.();this.unsubscribe?.();this.unsubscribe=null;this.root?.remove();this.root=null;this.lanes.clear();this.store.flushAll?.().catch(()=>{});this.onClose();}
  build(){
    const doc=this.doc;stylesheet(doc);this.root?.remove();this.lanes.clear();
    const root=doc.createElement('section');root.className='automation-lanes';root.setAttribute('aria-label','Automation lanes');root.dataset.automationShortcutScope='lanes';
    root.innerHTML=`<header class="automation-lanes-head"><strong>Automation</strong><span class="automation-lanes-clip">${esc(this.clip.name||'Clip')}</span><span class="automation-lanes-span">${this.clip.durationSec.toFixed(3)} s</span><label>Add lane <select class="automation-add" aria-label="Add automation lane"></select></label><label>Snap <select class="automation-snap-grid" aria-label="Automation snap"><option value="pro">10 ms</option><option value="0.25">¼ beat</option><option value="1">1 beat</option><option value="off">Off</option></select></label><span class="automation-lanes-status" role="status"></span><button type="button" class="automation-lanes-close" aria-label="Close automation lanes">×</button></header><div class="automation-param-picker" hidden></div><div class="automation-lanes-body"></div><p class="automation-lanes-hint">Click to add a point · drag to move (Shift locks value, Alt disables snap) · drag a segment handle to curve it · right-click for curve shapes · Delete removes · ⌘C/⌘V copy and paste keyframes · ⌘Z Undo</p>`;
    (doc.querySelector('#modesty-automation-dock')||doc.body).append(root);this.root=root;
    root.querySelector('.automation-lanes-close').onclick=()=>this.close();
    const snap=root.querySelector('.automation-snap-grid');snap.value=this.snap;snap.onchange=()=>{this.snap=snap.value;};
    this.fillAddMenu();
    this.unsubscribe?.();this.unsubscribe=this.store.subscribe(view=>{if(!view||view.clipId===this.clip?.clipId)this.renderLanes();});
  }
  fillAddMenu(){
    const select=this.root.querySelector('.automation-add'),plugins=this.listPlugins(this.clip)||[];
    select.innerHTML=`<option value="">Choose a target…</option><option value="gain">Volume (clip gain)</option><option value="pan" disabled title="Freestyle automation targets clip gain and plugin parameters only">Pan — no automation target in Freestyle</option>${plugins.map(plugin=>`<option value="plugin:${plugin.index}">${esc(plugin.name||'Plugin')} parameter…</option>`).join('')}`;
    select.onchange=()=>{const value=select.value;select.value='';if(value==='gain')this.createTarget({...CLIP_GAIN_TARGET},.25);else if(value.startsWith('plugin:'))this.pickParameter(plugins.find(plugin=>plugin.index===Number(value.slice(7))));};
  }
  async pickParameter(plugin){
    const picker=this.root.querySelector('.automation-param-picker');picker.hidden=false;picker.innerHTML=`<span>Reading ${esc(plugin?.name||'plugin')} parameters…</span>`;
    try{
      const parameters=(await this.listParameters({clip:this.clip,plugin})).filter(parameter=>parameter.automatable!==false);
      const live=parameters.plugin||plugin;
      picker.innerHTML=`<label>${esc(plugin.name||'Plugin')} <input type="search" class="automation-param-search" placeholder="Search parameters" aria-label="Search plugin parameters"></label><select class="automation-param-list" size="6" aria-label="Plugin parameter">${parameters.map((parameter,i)=>`<option value="${i}">${esc(parameter.name)}${parameter.unit?` (${esc(parameter.unit)})`:''}</option>`).join('')}</select><button type="button" class="automation-param-add">Automate</button><button type="button" class="automation-param-cancel">Cancel</button>`;
      const list=picker.querySelector('.automation-param-list'),search=picker.querySelector('.automation-param-search');
      search.oninput=()=>{const q=search.value.toLowerCase();for(const option of list.options)option.hidden=!!q&&!option.textContent.toLowerCase().includes(q);};
      picker.querySelector('.automation-param-cancel').onclick=()=>{picker.hidden=true;picker.innerHTML='';};
      const add=()=>{const parameter=parameters[Number(list.value)];if(!parameter)return;picker.hidden=true;picker.innerHTML='';const value=Number.isFinite(parameter.value)?parameter.value:Number.isFinite(parameter.default)?parameter.default:.5;this.createTarget(pluginParameterTarget({...plugin,instanceId:live.instanceId||plugin.instanceId},parameter),value);};
      picker.querySelector('.automation-param-add').onclick=add;list.ondblclick=add;
    }catch(error){picker.innerHTML=`<span class="error">${esc(error.message)}</span>`;this.onError(error);}
  }
  createTarget(target,defaultValue){
    try{const view=this.store.create(this.clip.clipId,target,{defaultValue,durationSec:this.clip.durationSec});this.renderLanes();this.lanes.get(view.targetKey)?.svg.focus({preventScroll:true});}
    catch(error){this.status(error.message,true);this.onError(error);}
  }
  status(text,error=false){const node=this.root?.querySelector('.automation-lanes-status');if(!node)return;node.textContent=text;node.classList.toggle('error',error);}
  renderLanes(){
    if(!this.root)return;const body=this.root.querySelector('.automation-lanes-body'),views=this.store.envelopesFor(this.clip.clipId),keys=new Set(views.map(view=>view.targetKey));
    for(const [key,lane] of this.lanes)if(!keys.has(key)){lane.row.remove();this.lanes.delete(key);}
    if(!views.length)body.innerHTML='<p class="automation-empty">No automation on this clip yet. Use Add lane.</p>';else body.querySelector('.automation-empty')?.remove();
    for(const view of views){let lane=this.lanes.get(view.targetKey);if(!lane){lane=new AutomationLane(this,view);this.lanes.set(view.targetKey,lane);body.append(lane.row);}else lane.update(view);}
  }
  grid(){return this.snap==='off'?'off':this.snap==='pro'?.01:{beats:Number(this.snap),bpm:this.getBpm()};}
  /** Playback following: one rAF loop moves each lane's playhead and value readout. */
  startFollow(){
    this.stopFollow?.();const native=typeof globalThis.requestAnimationFrame==='function',raf=native?fn=>globalThis.requestAnimationFrame(fn):fn=>setTimeout(fn,33),cancel=native?id=>globalThis.cancelAnimationFrame(id):id=>clearTimeout(id);
    let last;const tick=()=>{if(!this.root)return;const position=this.getPosition();if(position!==last){last=position;for(const lane of this.lanes.values())lane.follow(position);}this.frame=raf(tick);};
    this.frame=raf(tick);this.stopFollow=()=>{if(this.frame!=null)cancel(this.frame);this.frame=null;};
  }
}

export class AutomationLane{
  constructor(panel,view){
    this.panel=panel;this.view=view;this.points=view.points;this.selection=new Set();this.drag=null;this.lastDown=null;this.pending=null;this.frame=null;
    const doc=panel.doc,row=doc.createElement('div');row.className='automation-lane-row';row.dataset.targetKey=view.targetKey;
    row.innerHTML=`<div class="automation-lane-label"><strong></strong><output class="automation-lane-value" aria-live="off"></output><span class="automation-lane-save"></span><button type="button" class="automation-lane-verify" hidden>Verify</button><button type="button" class="automation-lane-remove" title="Remove this automation lane">Remove</button></div><svg class="automation-lane-svg" tabindex="0" role="application" preserveAspectRatio="none" height="${LANE_HEIGHT}"></svg>`;
    this.row=row;this.svg=row.querySelector('svg');
    row.querySelector('.automation-lane-remove').onclick=()=>this.guard(()=>{this.panel.store.remove(this.panel.clip.clipId,this.view.targetKey);this.panel.renderLanes();});
    row.querySelector('.automation-lane-verify').onclick=()=>this.panel.store.verify(this.panel.clip.clipId,this.view.targetKey).catch(error=>this.panel.onError(error));
    this.svg.addEventListener('pointerdown',event=>this.pointerDown(event));
    this.svg.addEventListener('pointermove',event=>this.pointerMove(event));
    this.svg.addEventListener('pointerup',event=>this.pointerUp(event));
    this.svg.addEventListener('pointercancel',event=>this.pointerUp(event,true));
    this.svg.addEventListener('contextmenu',event=>this.contextMenu(event));
    this.svg.addEventListener('keydown',event=>this.keyDown(event));
    this.update(view);
  }
  get duration(){return this.panel.clip.durationSec;}
  get mapping(){return displayMapping(this.view.target);}
  get valueType(){return this.view.valueType||'continuous';}
  get defaultValue(){return this.view.target?.kind==='clip_gain'?.25:clamp(Number(this.view.defaultValue)||0,0,1);}
  normalize=points=>normalizeEnvelopePoints(points,{durationSec:this.duration,defaultValue:this.view.defaultValue??.25,valueType:this.valueType});
  guard(fn){try{return fn();}catch(error){this.panel.status(error.message,true);this.panel.onError(error);}}
  update(view){
    this.view=view;if(!this.drag)this.points=view.points;
    this.row.querySelector('strong').textContent=view.target?.name||'Parameter';
    this.row.classList.toggle('is-saving',!!view.saving);this.row.classList.toggle('has-error',!!view.saveError);
    this.row.querySelector('.automation-lane-save').textContent=view.locked?'Unconfirmed':view.saving?'Saving…':view.saveError?view.saveError:view.status==='verified'?'Saved':'';
    this.row.querySelector('.automation-lane-verify').hidden=!view.locked;
    this.render();
  }
  size(){const rect=this.svg.getBoundingClientRect?.()||{};return{width:rect.width>0?rect.width:800,height:rect.height>0?rect.height:LANE_HEIGHT,left:rect.left||0,top:rect.top||0};}
  x(time,width){return time/Math.max(this.duration,1e-4)*width;}
  y(value,height){return (1-this.mapping.toDisplay(value))*height;}
  render(){
    const {width,height}=this.size(),points=this.points,keys=pointKeys(points),steps=Math.max(2,Math.min(2000,Math.ceil(width)+1));
    this.svg.setAttribute('viewBox',`0 0 ${Math.max(1,width)} ${height}`);
    let path='';for(let i=0;i<steps;i++){const px=width*i/(steps-1),time=px/width*this.duration;path+=`${i?'L':'M'}${px.toFixed(2)},${this.y(evaluate(points,time),height).toFixed(2)}`;}
    let html=`<rect class="automation-lane-hit" x="0" y="0" width="${width}" height="${height}"></rect>`;
    if(this.view.target?.kind==='clip_gain')html+=`<line class="automation-lane-unity" x1="0" x2="${width}" y1="${height/2}" y2="${height/2}"></line>`;
    html+=`<path class="automation-lane-path" d="${path}"></path>`;
    if(points.length<=MAX_VISIBLE_POINTS){
      if(this.valueType==='continuous')for(let i=0;i<points.length-1;i++){const mid=(points[i].timeSec+points[i+1].timeSec)/2;if(points[i+1].timeSec<=points[i].timeSec)continue;html+=`<circle class="automation-curve-handle${points[i].curve===CURVES.BEZIER?' is-curved':''}" data-curve="${i}" cx="${this.x(mid,width)}" cy="${this.y(evaluate(points,mid),height)}" r="4"></circle>`;}
      points.forEach((point,i)=>{html+=`<circle class="automation-point${this.selection.has(keys[i])?' is-selected':''}" data-point="${i}" cx="${this.x(point.timeSec,width)}" cy="${this.y(point.value,height)}" r="5"><title>${esc(formatAutomationValue(point.value,this.view.target,this.valueType))} · ${point.timeSec.toFixed(3)}s</title></circle>`;});
    }
    html+=`<line class="automation-lane-playhead" x1="-10" x2="-10" y1="0" y2="${height}"></line>`;
    this.svg.innerHTML=html;this.playhead=this.svg.querySelector('.automation-lane-playhead');this.follow(this.panel.getPosition());
  }
  follow(position){
    const clip=this.panel.clip,output=this.row.querySelector('.automation-lane-value');
    const local=Number.isFinite(position)?position-clip.timelineStartSec:NaN,inside=local>=0&&local<=this.duration;
    if(this.playhead){const x=inside?this.x(local,this.size().width):-10;this.playhead.setAttribute('x1',x);this.playhead.setAttribute('x2',x);}
    output.textContent=formatAutomationValue(evaluate(this.points,inside?local:0),this.view.target,this.valueType);
  }
  position(event,{snap=true}={}){
    const {width,height,left,top}=this.size(),px=clamp(event.clientX-left,0,width),py=clamp(event.clientY-top,0,height);
    let time=px/width*this.duration;if(snap)time=snapTime(time,this.panel.grid(),{altKey:event.altKey});
    return {timeSec:clamp(time,0,this.duration),value:this.mapping.fromDisplay(1-py/height),x:px,y:py,height};
  }
  editable(){if(this.view.locked)throw new Error('Verify the unconfirmed automation save before editing this lane.');}
  commit(points,description){this.guard(()=>{this.points=this.panel.store.edit(this.panel.clip.clipId,this.view.targetKey,points,{description:`${description} ${this.view.target?.name||'parameter'} automation`});this.render();});}
  pointerDown(event){
    if(event.button!==0)return;event.preventDefault();event.stopPropagation();
    try{this.editable();}catch(error){this.panel.status(error.message,true);return;}
    this.svg.focus?.({preventScroll:true});
    const point=event.target.closest?.('[data-point]'),curve=event.target.closest?.('[data-curve]');
    if(curve&&this.valueType==='continuous'){this.drag={kind:'curve',index:Number(curve.dataset.curve),pointerId:event.pointerId,base:this.points};this.capture(event);return;}
    if(point){this.pointDown(event,Number(point.dataset.point));return;}
    const at=this.position(event),inserted={timeSec:at.timeSec,value:at.value,curve:this.valueType==='continuous'?CURVES.LINEAR:CURVES.HOLD,tension:0},next=this.normalize([...this.points,inserted]),index=lastIndexAt(next,inserted.timeSec);
    this.points=next;if(index>=0)this.pointDown(event,index,{inserted:true});
  }
  pointDown(event,index,{inserted=false}={}){
    const points=this.points,point=points[index];if(!point)return;const keys=pointKeys(points),key=keys[index],now=performance.now();
    if(!inserted){const last=this.lastDown;this.lastDown={key,time:now};
      if(last&&last.key===key&&now-last.time<400){this.lastDown=null;this.selection=new Set([key]);this.commit(points.map((p,i)=>i===index?{...p,value:this.defaultValue}:p),'Reset keyframe of');return;}
      if(event.shiftKey&&this.selection.size){const chosen=selectedIndices(points,this.selection),lo=Math.min(...chosen,index),hi=Math.max(...chosen,index);this.selection=new Set(keys.slice(lo,hi+1));this.render();return;}}
    const toggle=event.metaKey||event.ctrlKey;let selection;
    if(toggle){selection=new Set(this.selection);if(selection.has(key)&&!inserted)selection.delete(key);else selection.add(key);}else selection=this.selection.has(key)?new Set(this.selection):new Set([key]);
    this.selection=selection;if(toggle&&!selection.has(key)){this.render();return;}
    const group=selection.size>1?selectedIndices(points,selection):null;
    this.drag={kind:'point',base:points,index,original:point,group:group&&group.length>1?group:null,anchorValue:index>0?points[index-1].value:point.value,lockTime:point.timeSec===0||point.timeSec===this.duration,inserted,pointerId:event.pointerId,moved:inserted};
    this.capture(event);this.render();
  }
  capture(event){try{this.svg.setPointerCapture?.(event.pointerId);}catch{}}
  pointerMove(event){
    if(!this.drag||event.pointerId!==this.drag.pointerId)return;event.preventDefault();
    this.pending=this.position(event);this.pending.shiftKey=event.shiftKey;
    if(this.frame==null){const raf=globalThis.requestAnimationFrame||(fn=>setTimeout(fn,16));this.frame=raf(()=>{this.frame=null;this.apply();});}
  }
  apply(){
    const drag=this.drag,at=this.pending;this.pending=null;if(!drag||!at)return;
    if(drag.kind==='point'){
      const {base,original}=drag;let transform,indices;
      if(drag.group){const dt=drag.lockTime?0:at.timeSec-original.timeSec,dv=at.shiftKey?0:at.value-original.value;indices=drag.group;transform=p=>{const pinned=p.timeSec===0||p.timeSec===this.duration;return{...p,timeSec:pinned?p.timeSec:clamp(p.timeSec+dt,0,this.duration),value:clamp(p.value+dv,0,1)};};}
      else{indices=[drag.index];transform=p=>({...p,timeSec:drag.lockTime?original.timeSec:at.timeSec,value:at.shiftKey?drag.anchorValue:at.value});}
      const result=transformPoints(base,indices,transform,this.normalize);this.points=result.points;this.selection=result.keys;drag.moved=true;
      this.panel.status(`${formatAutomationValue(transform(original).value,this.view.target,this.valueType)} · ${transform(original).timeSec.toFixed(3)} s`);
    }else if(drag.kind==='curve'){
      const a=this.points[drag.index],b=this.points[drag.index+1],raw=clamp((at.height/2-at.y)/(at.height/2),-1,1),rising=(b?.value??0)>=(a?.value??0),tension=clamp(rising?-raw:raw,-1,1);
      this.points=this.points.map((p,i)=>i===drag.index?{...p,curve:CURVES.BEZIER,tension}:p);drag.moved=true;
    }
    this.render();
  }
  pointerUp(event,cancel=false){
    const drag=this.drag;if(!drag||event.pointerId!==drag.pointerId)return;event.preventDefault?.();
    if(this.pending)this.apply();this.drag=null;try{this.svg.releasePointerCapture?.(event.pointerId);}catch{}
    if(cancel){this.points=this.view.points;this.render();return;}
    if(!drag.moved){this.render();return;}
    this.commit(this.points,drag.kind==='curve'?'Adjust':drag.inserted?'Add keyframe to':'Move keyframe'+(drag.group?'s':'')+' of');this.panel.status('');
  }
  deleteSelected(){if(!this.selection.size)return;const keys=pointKeys(this.points),next=this.points.filter((_,i)=>!this.selection.has(keys[i]));this.selection=new Set();this.commit(next,'Delete keyframes of');}
  shape(curve){if(!this.selection.size)return;this.commit(setCurve(this.points,this.selection,curve),curve===CURVES.HOLD?'Hold':curve===CURVES.BEZIER?'Curve':curve===CURVES.DB?'dB-curve':'Linearize');}
  reset(){this.selection=new Set();this.commit(defaultEnvelopePoints({durationSec:this.duration,defaultValue:this.view.defaultValue??.25,valueType:this.valueType}),'Reset');}
  copy(){const copied=copyPoints(this.points,this.selection,this.view);if(copied)automationClipboard.set(copied);return !!copied;}
  paste(){const result=pastePoints(this.points,this.selection,automationClipboard.get(),this.view,{durationSec:this.duration,normalize:this.normalize});if(!result){this.panel.status('The copied keyframes belong to a different automation target.',true);return false;}this.selection=result.keys;this.commit(result.points,'Paste keyframes into');return true;}
  keyDown(event){
    const meta=event.metaKey||event.ctrlKey,key=String(event.key);
    const handled=()=>{event.preventDefault();event.stopPropagation();};
    if(meta&&key.toLowerCase()==='z')return; // Workspace chronological Undo/Redo.
    try{
      if(key==='Delete'||key==='Backspace'){handled();this.editable();this.deleteSelected();return;}
      if(meta&&key.toLowerCase()==='c'){handled();this.copy();return;}
      if(meta&&key.toLowerCase()==='v'){handled();this.editable();this.paste();return;}
      if(meta&&key.toLowerCase()==='a'){handled();this.selection=new Set(pointKeys(this.points));this.render();return;}
      if(key==='Escape'){handled();if(this.drag){this.drag=null;this.points=this.view.points;}this.selection=new Set();this.render();return;}
      if(key.startsWith('Arrow')&&this.selection.size){handled();this.editable();const result=nudgePoints(this.points,this.selection,{key,altKey:event.altKey},{durationSec:this.duration,normalize:this.normalize});this.selection=result.keys;this.commit(result.points,'Nudge keyframes of');}
    }catch(error){this.panel.status(error.message,true);}
  }
  contextMenu(event){
    event.preventDefault();event.stopPropagation();this.panel.doc.querySelector('.automation-menu')?.remove();
    const node=event.target.closest?.('[data-point]'),at=this.position(event,{snap:false}),keys=pointKeys(this.points);
    if(node){const key=keys[Number(node.dataset.point)];if(!this.selection.has(key))this.selection=new Set([key]);}
    else if(!this.selection.size){let i=0;while(i<this.points.length&&this.points[i].timeSec<at.timeSec)i++;const before=Math.max(0,Math.min(this.points.length-1,i-1));if(this.points[before])this.selection=new Set([keys[before]]);}
    this.render();
    const gain=this.view.target?.kind==='clip_gain',count=this.selection.size,items=node?[[count>1?`Delete ${count} keyframes`:'Delete keyframe',()=>this.deleteSelected()],['Linear to next',()=>this.shape(CURVES.LINEAR)],['Curve to next',()=>this.shape(CURVES.BEZIER)],['Hold to next',()=>this.shape(CURVES.HOLD)],...(gain?[['dB to next',()=>this.shape(CURVES.DB)]]:[]),['Copy keyframe'+(count>1?'s':''),()=>this.copy()],['Reset to default',()=>this.reset()]]:[['Insert keyframe',()=>this.commit([...this.points,{timeSec:at.timeSec,value:at.value,curve:this.valueType==='continuous'?CURVES.LINEAR:CURVES.HOLD,tension:0}],'Add keyframe to')],['Make linear',()=>this.shape(CURVES.LINEAR)],['Add curve',()=>this.shape(CURVES.BEZIER)],['Copy keyframe',()=>this.copy(),!count],['Paste keyframes',()=>this.paste(),!automationClipboard.get()],['Reset to default',()=>this.reset()]];
    const menu=this.panel.doc.createElement('div');menu.className='automation-menu';menu.setAttribute('role','menu');Object.assign(menu.style,{left:`${event.clientX}px`,top:`${event.clientY}px`});
    for(const [label,action,disabled] of items){const button=this.panel.doc.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.textContent=label;button.disabled=!!disabled;button.onclick=()=>{menu.remove();try{this.editable();action();}catch(error){this.panel.status(error.message,true);}};menu.append(button);}
    const dismiss=e=>{if(!menu.contains(e.target)){menu.remove();this.panel.doc.removeEventListener('pointerdown',dismiss,true);}};this.panel.doc.addEventListener('pointerdown',dismiss,true);
    this.panel.doc.body.append(menu);
  }
}
