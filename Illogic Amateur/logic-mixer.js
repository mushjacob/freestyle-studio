/**
 * Logic Pro channel-strip sections for the Illogic mixer and Inspector.
 *
 * MixerStripView (mixer-strip-view.js) owns every engine control on a strip:
 * fader, meter, pan knob, dB readout, M/S, with their revision guards,
 * optimistic updates, undo steps and meter ballistics. This module only adds
 * Logic's upper strip sections around them (Setting, EQ thumbnail, MIDI FX,
 * Input/instrument slot, Audio FX slots, Sends, Output, Group, automation
 * mode) and the coloured name plate. It renders from a plain spec and calls
 * host handlers; it never writes to Freestyle itself.
 *
 * Sends: a track strip lists its aux sends (bus name + level knob) and one
 * empty slot; the host owns every write (logic-sends.js). Bus strips have no
 * sends (Freestyle buses sum to the Stereo Out only).
 *
 * Unsupported Logic features (MIDI FX, Group, write automation modes, audio
 * Input selection) are drawn disabled with a tooltip saying why.
 */
import {sendKnobPosition,sendKnobLevel,sendLevelText,MAX_LANE_SENDS,SEND_UNITY_LEVEL} from './logic-sends.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const LOGIC_FX_MIN_SLOTS=1;
export const LOGIC_UNSUPPORTED=Object.freeze({
 midiFx:'MIDI FX: Freestyle has no MIDI effect plug-in API for lanes.',
 sends:'Sends need a Studio API (OAuth) project with Freestyle’s lane send API.',
 group:'Groups: Freestyle has no channel-strip group API.',
 input:'Input: Freestyle audio tracks have no selectable hardware input here.',
 mode:'Freestyle plays saved automation (Read). Touch, Latch and Write need live automation recording, which Freestyle does not offer.',
});
/** What an audio track's Input slot shows (the strip's stereo input; Freestyle has no input selection). */
export const LOGIC_AUDIO_INPUT_NAME='Input 1-2';
export const LOGIC_AUTOMATION_MODES=Object.freeze(['Off','Read','Touch','Latch','Write']);
const native=plugin=>/^native-/.test(String(plugin?.type_id??plugin?.typeId??plugin?.type??''));
const pluginIndex=plugin=>Number.isInteger(plugin?.index)?plugin.index:Number.isInteger(plugin?.plugin_index)?plugin.plugin_index:Number.isInteger(plugin?.position)?plugin.position:null;
/** Logic display names for Freestyle native plug-ins. */
export function logicPluginName(plugin){
 const type=String(plugin?.type_id??plugin?.typeId??plugin?.type??'');
 if(type==='native-eq')return 'Channel EQ';
 return String(plugin?.name||plugin?.label||type||'Plug-in');
}
/**
 * Split a lane's chain into Logic's instrument slot and Audio FX inserts. Only a
 * true instrument plug-in (declared kind/category "instrument", or a known
 * instrument type such as LABS) fills the instrument slot; audio effects (Free
 * Comp, EQ, any catalog "effect") always list in Audio FX in chain order.
 */
export const LOGIC_INSTRUMENT_TYPES=new Set(['labs','air_xpand_2','serum','vital','kontakt','omnisphere','keyscape','pigments','diva','massive','sylenth1','spitfire_labs']);
export function isInstrumentPlugin(plugin,instrumentTypes=LOGIC_INSTRUMENT_TYPES){
 if(!plugin||typeof plugin!=='object')return false;
 const declared=[plugin.kind,plugin.category,plugin.plugin_kind,plugin.pluginKind,plugin.role].map(value=>String(value??'').toLowerCase());
 if(declared.some(value=>value==='effect'||value==='audio_effect'||value==='fx'))return false;
 if(declared.some(value=>value==='instrument'||value==='synth'||value==='synthesizer'))return true;
 const type=String(plugin.type_id??plugin.typeId??plugin.type??'').toLowerCase();
 return !!type&&!native(plugin)&&instrumentTypes.has(type);
}
export function splitLogicChain(plugins,laneKind,{instrumentTypes}={}){
 const rows=(Array.isArray(plugins)?plugins:[]).filter(plugin=>plugin&&typeof plugin==='object').slice().sort((a,b)=>(pluginIndex(a)??Infinity)-(pluginIndex(b)??Infinity));
 const instrument=laneKind==='instrument'?rows.find(plugin=>isInstrumentPlugin(plugin,instrumentTypes))||null:null;
 return{instrument,effects:rows.filter(plugin=>plugin!==instrument)};
}
/**
 * Optimistic slots: a plug-in picked from a slot menu (or dropped on a strip) is drawn at once, greyed and
 * not clickable ("pending"), while Freestyle loads it; the real slot replaces it when the chain is read back.
 * pending: [{name, at?: slot index it will take (insert/replace), replace?: true, instrument?: true}].
 * Returns {instrument, effects} for the strip spec; inputs are never mutated.
 */
export function withPendingSlots({instrument=null,effects=[]}={},pending=[]){
 let shownInstrument=instrument;const rows=(Array.isArray(effects)?effects:[]).slice();
 for(const item of Array.isArray(pending)?pending:[]){
  if(!item||typeof item.name!=='string'||!item.name)continue;
  if(item.instrument){shownInstrument={name:item.name,pending:true,optimistic:true};continue;}
  const indexes=rows.map(pluginIndex).filter(Number.isInteger),next=indexes.length?Math.max(...indexes)+1:shownInstrument&&Number.isInteger(pluginIndex(shownInstrument))?pluginIndex(shownInstrument)+1:0;
  if(item.replace&&Number.isInteger(item.at)){const at=rows.findIndex(plugin=>pluginIndex(plugin)===item.at);if(at>=0){rows[at]={index:item.at,name:item.name,pending:true,optimistic:true};continue;}}
  if(Number.isInteger(item.at)&&item.at>=0&&rows.some(plugin=>pluginIndex(plugin)===item.at)){
   // An insert in the middle: it takes that position on screen; the slots below keep their own (live) indexes until the read-back.
   const at=rows.findIndex(plugin=>pluginIndex(plugin)===item.at);rows.splice(at,0,{index:null,name:item.name,pending:true,optimistic:true});continue;
  }
  rows.push({index:next,name:item.name,pending:true,optimistic:true});
 }
 return{instrument:shownInstrument,effects:rows};
}
/**
 * What a drop of a dragged insert means (Logic): the same strip without ⌥ reorders; ⌥ copies (same or another strip);
 * another strip without ⌥ moves the plug-in there. `toIndex` null = the empty slot at the end of the chain.
 */
export function slotDropAction({source,targetRowKey,toIndex=null,alt=false}={}){
 if(!source||typeof source.rowKey!=='string'||!Number.isInteger(source.index)||typeof targetRowKey!=='string')return null;
 const same=source.rowKey===targetRowKey;
 if(alt)return{kind:'copy',toIndex};
 if(!same)return{kind:'move-strip',toIndex};
 if(toIndex===null||toIndex===source.index)return null;
 return{kind:'reorder',toIndex};
}
/** The lane's native EQ insert (what the EQ thumbnail opens), or null. */
export const logicEqPlugin=plugins=>(Array.isArray(plugins)?plugins:[]).find(plugin=>String(plugin?.type_id??plugin?.typeId??plugin?.type??'')==='native-eq')||null;
const eqSvg=curve=>`<svg class="logic-eq-curve" viewBox="0 0 60 20" preserveAspectRatio="none" aria-hidden="true"><path d="${esc(curve||'M0 10 L60 10')}"/></svg>`;
function button(document,className,text,{title='',disabled=false,label=null}={}){const node=document.createElement('button');node.type='button';node.className=className;node.textContent=text;if(title)node.title=title;if(label)node.setAttribute('aria-label',label);node.disabled=!!disabled;return node;}
function section(document,parent,className){const node=document.createElement('div');node.className=className;parent.append(node);return node;}
let dragging=null;
/** The send knob being dragged ({key, level}): survives strip repaints mid-drag. */
let sendDrag=null;
export const SEND_DRAG_PIXELS=160;
const sendKey=(row,busId)=>JSON.stringify([row.key,busId]);
function paintKnob(knob,level){
 const position=sendKnobPosition(level),text=sendLevelText(level);knob.style.setProperty('--send-angle',`${Math.round(-135+270*position)}deg`);
 knob.setAttribute('aria-valuenow',String(Math.round(level*1e6)/1e6));knob.setAttribute('aria-valuetext',`${text} dB`);knob.title=`Send level ${text} dB · drag to change, Option-click for 0 dB`;
 const readout=knob.parentElement?.querySelector?.('.logic-send-value');if(readout)readout.textContent=text;
}
/** One Logic send slot: bus name (click = send menu) and its level knob. */
function sendSlot(document,row,send,call,{busy=false}={}){
 const item=document.createElement('div');item.className=`logic-send-slot filled${send.preFader?' pre':''}${send.pending?' pending':''}`;item.setAttribute('role','listitem');item.dataset.sendBus=send.busId;
 const key=sendKey(row,send.busId),shown=sendDrag?.key===key?sendDrag.level:send.level;
 const knob=document.createElement('span');knob.className='logic-send-knob';knob.setAttribute('role','slider');knob.tabIndex=busy||send.pending?-1:0;knob.dataset.sendKey=key;knob.setAttribute('aria-label',`${send.name||send.busId} send level`);knob.setAttribute('aria-valuemin','0');knob.setAttribute('aria-valuemax','2');
 const name=button(document,'logic-send-name',send.name||send.busId,{title:`${send.name||send.busId} · ${send.preFader?'Pre Fader':'Post Fader'} · click for the send menu`,disabled:!!send.pending||busy});
 const value=document.createElement('span');value.className='logic-send-value';value.setAttribute('aria-hidden','true');
 name.onclick=event=>{event.stopPropagation();call('onSendMenu',send,event);};
 item.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();if(!send.pending&&!busy)call('onSendMenu',send,event);};
 item.append(knob,name,value);paintKnob(knob,shown);
 const editable=()=>!busy&&!send.pending;
 knob.addEventListener('pointerdown',event=>{
  if(event.button!==0||!editable())return;event.preventDefault();event.stopPropagation();
  // Logic: Option-click resets the send to 0 dB.
  if(event.altKey){if(!sameLevel(send.level,SEND_UNITY_LEVEL))call('onSendLevel',send,SEND_UNITY_LEVEL,event);return;}
  const start=event.clientY,from=sendKnobPosition(send.level),view=document.defaultView||globalThis;sendDrag={key,level:send.level};item.classList.add('dragging');
  const paint=level=>{for(const node of document.querySelectorAll('.logic-send-knob'))if(node.dataset.sendKey===key){paintKnob(node,level);node.closest('.logic-send-slot')?.classList.add('dragging');}};
  const move=next=>{if(!sendDrag||sendDrag.key!==key)return;const scale=next.shiftKey?.1:1,level=sendKnobLevel(from+(start-next.clientY)/SEND_DRAG_PIXELS*scale);sendDrag.level=level;paint(level);};
  const end=(next,cancel)=>{view.removeEventListener('pointermove',move,true);view.removeEventListener('pointerup',up,true);view.removeEventListener('pointercancel',abort,true);const level=sendDrag?.key===key?sendDrag.level:send.level;sendDrag=null;for(const node of document.querySelectorAll('.logic-send-slot.dragging'))node.classList.remove('dragging');
   if(cancel||sameLevel(level,send.level)){paint(send.level);return;}call('onSendLevel',send,level,next);};
  const up=next=>end(next,false),abort=next=>end(next,true);
  view.addEventListener('pointermove',move,true);view.addEventListener('pointerup',up,true);view.addEventListener('pointercancel',abort,true);
 });
 knob.addEventListener('keydown',event=>{if(!editable())return;const step=event.key==='ArrowUp'?1:event.key==='ArrowDown'?-1:0;if(!step)return;event.preventDefault();event.stopPropagation();const db=send.level>0?20*Math.log10(send.level):-61,next=db+step<=-60?0:Math.min(2,10**((db+step)/20));if(!sameLevel(next,send.level))call('onSendLevel',send,Math.round(next*1e6)/1e6,event);});
 knob.addEventListener('dblclick',event=>{event.stopPropagation();});
 return item;
}
const sameLevel=(a,b)=>Math.abs(a-b)<=1e-6*Math.max(1,Math.abs(a),Math.abs(b));
/**
 * Logic's Sends section. spec.sends: {enabled, reason, items:[{busId,name,level,preFader,pending}],
 * busy, max, status}. Disabled (with its reason) on buses, the Stereo Out spacer aside.
 */
function sendsSection(document,row,sends,call){
 const node=document.createElement('div');node.className='logic-sends';node.setAttribute('role','list');node.setAttribute('aria-label',`${row.name||row.id} Sends`);
 if(!sends?.enabled){node.classList.add('disabled');node.setAttribute('aria-disabled','true');node.title=sends?.reason||LOGIC_UNSUPPORTED.sends;const label=document.createElement('span');label.className='logic-send-slot empty unavailable';label.textContent='Sends';node.append(label);return node;}
 const items=Array.isArray(sends.items)?sends.items:[],max=Number.isInteger(sends.max)?sends.max:MAX_LANE_SENDS,busy=!!sends.busy;
 for(const send of items)node.append(sendSlot(document,row,send,call,{busy}));
 if(items.length<max){const empty=button(document,'logic-send-slot empty',items.length?'':'Sends',{title:sends.loading?'Reading this track’s sends…':'Send: click to send this track to a bus',disabled:busy||!!sends.loading,label:`${row.name||row.id} empty send slot`});empty.onclick=event=>{event.stopPropagation();call('onSendMenu',null,event);};node.append(empty);}
 if(sends.status){const status=document.createElement('p');status.className='logic-send-status';status.setAttribute('role','status');status.textContent=sends.status;node.append(status);}
 return node;
}
/**
 * The upper part of one Logic channel strip.
 * spec: {row, color, instrument, effects:[{index,name,bypassed,bypassKnown,pending}],
 *   busy, eq:{enabled,curve,title}, output:{name,enabled,title}, mode:'Read', slots}
 *   sends:{enabled,reason,items,busy,max,status,loading}
 * handlers: onSetting, onEq, onInstrument, onOpenPlugin, onAddPlugin, onBypass,
 *   onSlotMenu, onMove, onOutput, onMode, onSendMenu(row, send|null, event),
 *   onSendLevel(row, send, level, event) — each (row, …, event).
 */
export function logicStripSections(document,spec,handlers={}){
 const {row}=spec,master=row.kind==='bus'&&row.id==='master',lane=row.kind==='lane',call=(name,...args)=>{const handler=handlers[name];if(typeof handler!=='function')return;try{const result=handler(row,...args);if(result&&typeof result.catch==='function')result.catch(error=>handlers.onError?.(error));}catch(error){handlers.onError?.(error);}};
 const top=document.createElement('div');top.className='logic-strip-top';top.dataset.logicStrip=row.key;
 const setting=button(document,'logic-setting','Setting',{title:`${master?'Stereo Out':row.name||row.id} channel strip setting`});setting.onclick=event=>{event.stopPropagation();call('onSetting',event);};top.append(setting);
 // EQ thumbnail: Logic draws the curve; a click opens the Channel EQ editor.
 const eq=button(document,'logic-eq-thumb','',{title:spec.eq?.title||'Channel EQ',disabled:!spec.eq?.enabled,label:`${row.name||row.id} Channel EQ`});eq.innerHTML=`${eqSvg(spec.eq?.curve)}<span>EQ</span>`;eq.classList.toggle('active',!!spec.eq?.active);eq.onclick=event=>{event.stopPropagation();call('onEq',event);};top.append(eq);
 // Rows a strip type does not have stay as blank spacers (as in Logic) so every strip's rows line up.
 const spacer=name=>{const node=document.createElement('span');node.className=`logic-slot-spacer logic-spacer-${name}`;node.setAttribute('aria-hidden','true');top.append(node);};
 if(lane&&row.laneKind==='instrument'){const midi=button(document,'logic-slot logic-midi-fx','MIDI FX',{title:LOGIC_UNSUPPORTED.midiFx,disabled:true});top.append(midi);}else spacer('midi-fx');
 // Input / instrument slot.
 if(lane&&row.laneKind==='instrument'){
  // Logic: click the Instrument slot to open the instrument; an empty slot (and a right-click) opens the instrument menu.
  const instrument=spec.instrument,loading=!!instrument?.pending,menu=typeof handlers.onInstrumentMenu==='function';
  const slot=button(document,`logic-slot logic-instrument${instrument?' filled':''}${loading?' pending':''}`,instrument?logicPluginName(instrument):menu?'Instrument':'',{title:loading?`${logicPluginName(instrument)} (loading in Freestyle…)`:instrument?`${logicPluginName(instrument)} · click to open${menu?', right-click for the instrument menu':''}`:menu?'Instrument: click to choose an instrument':'No instrument plug-in on this track',disabled:loading||!!spec.busy||!instrument&&!menu,label:`${row.name||row.id} instrument${instrument?`: ${logicPluginName(instrument)}`:' slot (empty)'}`});
  if(loading)slot.setAttribute('aria-busy','true');
  slot.onclick=event=>{event.stopPropagation();if(instrument)call('onInstrument',instrument,event);else if(menu)call('onInstrumentMenu',null,event);};
  if(menu)slot.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();if(!loading&&!spec.busy)call('onInstrumentMenu',instrument||null,event);};
  top.append(slot);
 }else if(lane){
  // Logic: an audio strip's Input slot names its input (stereo “Input 1-2”), never a plug-in; every
  // effect of an audio track (Channel EQ, Free Comp, …) is an insert in the Audio FX area below.
  const input=button(document,'logic-slot logic-input',LOGIC_AUDIO_INPUT_NAME,{title:LOGIC_UNSUPPORTED.input,disabled:true,label:`${row.name||row.id} input: ${LOGIC_AUDIO_INPUT_NAME} (stereo)`});input.dataset.inputFormat='stereo';top.append(input);
 }
 // Bus and Stereo Out strips have no MIDI FX or Input rows in Logic: blank, never relabelled.
 else spacer('input');
 // Audio FX inserts: filled slots, then one empty slot to add.
 const fx=section(document,top,'logic-audio-fx');fx.setAttribute('role','list');fx.setAttribute('aria-label',`${row.name||row.id} Audio FX`);
 const effects=Array.isArray(spec.effects)?spec.effects:[];
 const copies=typeof handlers.onCopyPlugin==='function',dropAction=(event,toIndex)=>{const action=slotDropAction({source:dragging,targetRowKey:row.key,toIndex,/* ⌥ as it is held at the drop; an event without modifier state falls back to the drag start */alt:event.altKey===true||typeof event.altKey!=='boolean'&&!!dragging?.alt});return action&&(action.kind==='reorder'||copies&&!spec.busy&&spec.canAdd!==false)?action:null;};
 const dropTarget=(node,toIndex,{self=false}={})=>{
  node.addEventListener('dragover',event=>{if(self&&event.target!==node)return;const action=dropAction(event,toIndex);if(!action)return;event.preventDefault();try{if(event.dataTransfer)event.dataTransfer.dropEffect=action.kind==='copy'?'copy':'move';}catch{}node.classList.add('drop-target');node.dataset.dropKind=action.kind;});
  node.addEventListener('dragleave',()=>{node.classList.remove('drop-target');delete node.dataset.dropKind;});
  node.addEventListener('drop',event=>{node.classList.remove('drop-target');delete node.dataset.dropKind;if(self&&event.target!==node)return;const source=dragging,action=dropAction(event,toIndex);dragging=null;if(!source||!action)return;event.preventDefault();event.stopPropagation();
   if(action.kind==='reorder')call('onMove',source.plugin,toIndex,event);else call('onCopyPlugin',{sourceRowKey:source.rowKey,plugin:source.plugin,toIndex,move:action.kind==='move-strip'},event);});
 };
 for(const plugin of effects){
  const index=pluginIndex(plugin),item=section(document,fx,`logic-fx-slot filled${plugin.bypassed?' bypassed':''}${plugin.pending?' pending':''}`);item.setAttribute('role','listitem');item.dataset.pluginIndex=String(index??'');
  if(plugin.optimistic){item.classList.add('optimistic');item.setAttribute('aria-busy','true');}
  const name=button(document,'logic-fx-name',logicPluginName(plugin),{title:plugin.optimistic?`${logicPluginName(plugin)} (loading in Freestyle…)`:plugin.pending?`${logicPluginName(plugin)} (reading its live slot…)`:`${logicPluginName(plugin)} · click to open, drag to reorder`,disabled:!!plugin.pending||index===null});
  name.onclick=event=>{event.stopPropagation();call('onOpenPlugin',plugin,event);};
  const power=button(document,'logic-fx-power','⏻',{title:plugin.bypassKnown?`${plugin.bypassed?'Enable':'Bypass'} ${logicPluginName(plugin)}`:`${logicPluginName(plugin)}: click to read its live bypass state`,disabled:!!spec.busy||!!plugin.pending||index===null,label:`${logicPluginName(plugin)} ${plugin.bypassed?'bypassed':'on'}`});power.dataset.bypassKnown=String(!!plugin.bypassKnown);
  if(plugin.bypassKnown)power.setAttribute('aria-pressed',String(!plugin.bypassed));
  power.onclick=event=>{event.stopPropagation();call('onBypass',plugin,event);};
  const more=button(document,'logic-fx-menu','▾',{title:`${logicPluginName(plugin)} slot menu`,disabled:!!plugin.pending,label:`${logicPluginName(plugin)} slot menu`});/* Logic: the right side of a filled slot opens the plug-in pop-up menu (choose another plug-in or No Plug-in); right-click keeps the slot menu */more.onclick=event=>{event.stopPropagation();call(typeof handlers.onReplaceMenu==='function'?'onReplaceMenu':'onSlotMenu',plugin,event);};
  item.append(power,name,more);
  item.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();call('onSlotMenu',plugin,event);};
  // Drag an insert (Logic): to another slot of the same strip = reorder; ⌥-drag = copy (same or another strip);
  // to another strip without ⌥ = move it there.
  if(index!==null&&!plugin.pending&&!spec.busy){
   item.draggable=true;
   item.addEventListener('dragstart',event=>{dragging={rowKey:row.key,index,plugin,alt:!!event.altKey};item.classList.add('dragging');try{event.dataTransfer?.setData('text/x-illogic-fx',String(index));if(event.dataTransfer)event.dataTransfer.effectAllowed='copyMove';}catch{}});
   item.addEventListener('dragend',()=>{dragging=null;item.classList.remove('dragging');});
  }
  if(index!==null&&!plugin.pending)dropTarget(item,index);
 }
 const empty=button(document,'logic-fx-slot empty',effects.length?'':'Audio FX',{title:'Audio FX: click to insert a plug-in',disabled:!!spec.busy||spec.canAdd===false,label:`${row.name||row.id} empty Audio FX slot`});empty.onclick=event=>{event.stopPropagation();call('onAddPlugin',effects.length,event);};fx.append(empty);
 // The empty slot (and the free area under it) takes a dragged insert at the end of the chain.
 dropTarget(empty,null);dropTarget(fx,null,{self:true});
 // Logic: every empty position of the Audio FX section is the next free slot (insert at the end of the chain).
 fx.addEventListener('click',event=>{if(event.target!==fx||empty.disabled)return;event.stopPropagation();call('onAddPlugin',effects.length,event);});
 if(spec.status){const status=document.createElement('p');status.className='logic-fx-status';status.setAttribute('role','status');status.textContent=spec.status;fx.append(status);}
 // Sends, Output, Group, automation mode.
 if(!master)top.append(sendsSection(document,row,spec.sends,call));else spacer('sends');
 const output=button(document,'logic-slot logic-output',spec.output?.name||(master?'Output 1-2':'Stereo Out'),{title:spec.output?.title||'Output',disabled:!spec.output?.enabled});output.onclick=event=>{event.stopPropagation();call('onOutput',event);};top.append(output);
 top.append(button(document,'logic-slot logic-group','Group',{title:LOGIC_UNSUPPORTED.group,disabled:true}));
 const mode=button(document,'logic-slot logic-automation-mode',spec.mode||'Read',{title:`Automation mode: ${spec.mode||'Read'}`});mode.dataset.mode=String(spec.mode||'Read').toLowerCase();mode.onclick=event=>{event.stopPropagation();call('onMode',event);};top.append(mode);
 return top;
}
/**
 * Decorate every rendered strip (`host > [data-mixer-row]`) with its
 * Logic sections (replacing earlier ones) and the name-plate colour.
 * specFor(rowKey) returns a spec or null (strip left undecorated).
 */
export function decorateLogicStrips(host,specFor,handlers={}){
 if(!host)return 0;const document=host.ownerDocument;let count=0;
 for(const strip of host.querySelectorAll(':scope > [data-mixer-row]')){
  strip.querySelector(':scope > .logic-strip-top')?.remove();
  let spec=null;try{spec=specFor(strip.dataset.mixerRow);}catch(error){handlers.onError?.(error);}
  if(!spec)continue;
  strip.classList.add('logic-channel-strip');strip.style.setProperty('--strip-color',spec.color||'#6e7a8a');
  strip.prepend(logicStripSections(document,spec,handlers));count++;
 }
 return count;
}
/** Logic's automation-mode popup items: only Read is available on Freestyle. */
export function logicAutomationModeItems(current='Read'){
 return LOGIC_AUTOMATION_MODES.map(mode=>({mode,checked:mode===current,disabled:mode!=='Read',title:mode==='Read'?'Play saved automation':LOGIC_UNSUPPORTED.mode}));
}
/**
 * Logic's insert-slot plug-in menu: a compact popup anchored at the slot with a
 * search field and Category ▸ Plug-in submenus (a flat filtered list while
 * searching). Choosing an item closes the menu and calls onPick(entry).
 * entries: [{id, name, category, disabled?, title?}]; setEntries() fills it
 * after an asynchronous catalog read; Escape or a click outside closes it.
 */
/** Where the menu goes: below the slot (left-aligned), flipped above / shifted left to stay on screen. */
export function logicMenuPosition(rect,{width=240,height=360,viewWidth=1200,viewHeight=800,margin=4}={}){
 const r=rect&&Number.isFinite(rect.left)&&(rect.width>0||rect.height>0)?rect:null;if(!r)return null;
 const below=r.bottom+2,above=r.top-2-height,left=Math.max(margin,Math.min(r.left,viewWidth-width-margin));
 const top=below+height<=viewHeight-margin?below:above>=margin?above:Math.max(margin,viewHeight-height-margin);
 return{left,top,flipped:top<r.top};
}
export function openLogicPluginMenu(document,{anchor,rect:anchorRect=null,entries=null,onPick,onClose,title='Audio FX'}={}){
 document.querySelector('.logic-plugin-menu')?.dispatchEvent(new (document.defaultView?.Event||Event)('logic-close'));
 const menu=document.createElement('div');menu.className='logic-plugin-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label',title);
 const search=document.createElement('input');search.type='search';search.className='logic-plugin-menu-search';search.placeholder='Search';search.setAttribute('aria-label','Search plug-ins');
 const list=document.createElement('div');list.className='logic-plugin-menu-list';menu.append(search,list);
 let rows=null,closed=false,openCategory=null;
 const close=()=>{if(closed)return;closed=true;menu.remove();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keys,true);try{onClose?.();}catch{}};
 const pick=entry=>{if(entry.disabled)return;close();onPick?.(entry);};
 const item=(entry,label=entry.name)=>{const button=document.createElement('button');button.type='button';button.className='logic-plugin-menu-item';button.setAttribute('role','menuitem');button.textContent=label;button.dataset.pluginId=entry.id;button.disabled=!!entry.disabled;if(entry.title)button.title=entry.title;button.onclick=event=>{event.stopPropagation();pick(entry);};return button;};
 const paint=()=>{
  list.replaceChildren();
  if(!rows){const note=document.createElement('p');note.className='logic-plugin-menu-note';note.textContent='Loading plug-ins…';list.append(note);return;}
  const query=search.value.trim().toLowerCase();
  if(query){const found=rows.filter(entry=>`${entry.name} ${entry.category||''}`.toLowerCase().includes(query));if(!found.length){const note=document.createElement('p');note.className='logic-plugin-menu-note';note.textContent='No matching plug-ins';list.append(note);}for(const entry of found)list.append(item(entry,`${entry.name}${entry.category?` — ${entry.category}`:''}`));return;}
  const groups=new Map();for(const entry of rows){const name=entry.category||'Other';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(entry);}
  for(const [name,members]of [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
   const group=document.createElement('div');group.className='logic-plugin-menu-group';group.classList.toggle('open',openCategory===name);
   const head=document.createElement('button');head.type='button';head.className='logic-plugin-menu-category';head.setAttribute('aria-haspopup','menu');head.setAttribute('aria-expanded',String(openCategory===name));head.textContent=name;
   const sub=document.createElement('div');sub.className='logic-plugin-menu-sub';sub.setAttribute('role','menu');for(const entry of members.sort((a,b)=>a.name.localeCompare(b.name)))sub.append(item(entry));
   const show=()=>{openCategory=name;for(const other of list.querySelectorAll('.logic-plugin-menu-group'))other.classList.toggle('open',other===group);for(const other of list.querySelectorAll('.logic-plugin-menu-category'))other.setAttribute('aria-expanded',String(other===head));};
   head.onclick=event=>{event.stopPropagation();show();};group.onpointerenter=show;group.append(head,sub);list.append(group);
  }
 };
 const outside=event=>{if(!menu.contains(event.target))close();};
 const keys=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}else if(event.key==='Enter'&&document.activeElement===search){const first=list.querySelector('.logic-plugin-menu-item:not(:disabled)');if(first){event.preventDefault();first.click();}}};
 search.oninput=()=>paint();menu.addEventListener('logic-close',close);
 document.body.append(menu);
 // Anchor at the slot (a rectangle read before any repaint, else the live anchor), like Logic's insert menu.
 const view=document.defaultView,live=anchor?.isConnected!==false?anchor?.getBoundingClientRect?.():null,menuHeight=Math.min(360,Math.round((view?.innerHeight||800)*.7));
 const place=logicMenuPosition(anchorRect||live,{height:menuHeight,viewWidth:view?.innerWidth||1200,viewHeight:view?.innerHeight||800})||{left:Math.max(4,((view?.innerWidth||1200)-240)/2),top:Math.max(4,((view?.innerHeight||800)-menuHeight)/2)};
 menu.style.position='fixed';menu.style.left=`${Math.round(place.left)}px`;menu.style.top=`${Math.round(place.top)}px`;menu.dataset.placement=place.flipped?'above':'below';
 document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keys,true);
 rows=Array.isArray(entries)?entries:null;paint();try{search.focus({preventScroll:true});}catch{}
 return{element:menu,close,setEntries(next){if(closed)return;rows=Array.isArray(next)?next:[];paint();},get closed(){return closed;}};
}
/**
 * Logic's channel strip Setting menu items: Copy / Paste Channel Strip Setting.
 * Freestyle copies a strip as its effects chain (`copyLaneEffectChain`, audio
 * tracks only); the paste opens the reviewed chain copy for the destination.
 * copied: {projectId, laneId, name} | null. Returns context-menu items (run ids).
 */
export const CHANNEL_STRIP_AUDIO_KINDS=Object.freeze(['audio','vocal','guitar']);
export function channelStripSettingItems({projectId=null,laneId=null,laneKind=null,name='',copied=null,ready=true}={}){
 const audio=CHANNEL_STRIP_AUDIO_KINDS.includes(laneKind),lane=typeof laneId==='string'&&!!laneId;
 const copyReason=!ready?'Connect a Freestyle project first.':!lane?'Select a track’s channel strip.':!audio?'Freestyle copies channel strip settings (effects chains) between audio tracks only.':'';
 const sameProject=!!copied&&copied.projectId===projectId;
 const pasteReason=copyReason||(!sameProject?'Copy an audio track’s channel strip setting first.':copied.laneId===laneId?'Choose another audio track to paste onto.':'');
 return[
  {id:'copy-strip',label:'Copy Channel Strip Setting',disabled:!!copyReason,title:copyReason||`Copy ${name||'this track'}’s effects chain`},
  {id:'paste-strip',label:sameProject&&!pasteReason?`Paste Channel Strip Setting (${copied.name||'track'})`:'Paste Channel Strip Setting',disabled:!!pasteReason,title:pasteReason||`Replace ${name||'this track'}’s effects with ${copied.name||'the copied track'}’s (reviewed before saving)`}
 ];
}
