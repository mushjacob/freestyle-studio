/**
 * Disabelton Drum Rack device: Freestyle's pattern rack (step-sequenced channels)
 * presented as Live's 4×4 pad grid plus a chain list for the selected pad.
 *
 * Pads are the pattern's rack channels in rack order; pad 1 sits bottom-left
 * like Live (C1), banks of 16. Every action goes through the host's existing
 * rack paths (no new engine calls):
 *  hooks.selectPad(channelId)            select the rack channel (also sent as
 *                                          window 'abl:pad-select' {channelId} for the Clip View Fold rows)
 *  hooks.auditionPad(channelId) → {stop()} preview through the existing rack/instrument audition
 *  hooks.togglePadMute(channelId) / togglePadSolo(channelId)   the rack channel's own mute/solo edit
 *  hooks.padMenu(event, channelId)        the rack channel menu (Rename, Delete, Color, …)
 *  hooks.addPadSound(raw, patternId)      a dropped library sound → the rack's add-sound path
 *  hooks.openPadPlugin(channelId)         the channel's instrument window
 *  hooks.selectPattern(patternId)         show another pattern (clip) of this track in the rack
 */
import {AblKnob} from './abl-dev-knob.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const ABL_PAD_BANK=16;
export const ABL_LIBRARY_SOUND_MIME='application/vegetable-library-sound';
/** A browser device (instrument) drag: the Device View's MIME (abl-dev-view.js ABL_PLUGIN_MIME). */
export const ABL_INSTRUMENT_MIME='application/x-abl-device';
/** Grid position (row from the top, column) of pad `index` within its bank: pad 0 bottom-left. */
export function ablPadCell(index){const slot=index%ABL_PAD_BANK;return{row:3-Math.floor(slot/4),column:slot%4};}
/** MIDI note of pad 0: Live's Drum Rack maps pads from C1 (36) upwards. */
export const ABL_PAD_FIRST_NOTE=36;
/** Live's pad note label for pad `index` (C1 = MIDI 36). */
export function ablPadNote(index){const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],midi=ABL_PAD_FIRST_NOTE+index;return `${names[midi%12]}${Math.floor(midi/12)-2}`;}
export function drumRackSignature(model){return JSON.stringify(model?{p:model.patternId,n:model.patternName,s:model.selectedChannelId,e:!!model.editable,ps:(model.patterns||[]).map(item=>item.id),pads:(model.pads||[]).map(pad=>[pad.channelId,pad.name,pad.kind,!!pad.mute,!!pad.solo,pad.color||'',!!pad.hasPlugin,pad.volume??null,pad.pan??null,pad.panLaneId||''])}:null);}
/** Render the Drum Rack device body into `body`. Returns {bank, destroy}. */
export function renderDrumRack(body,model,hooks={},state={bank:0}){
 const document=body.ownerDocument,pads=model?.pads||[],banks=Math.max(1,Math.ceil((pads.length+1)/ABL_PAD_BANK)),bank=Math.min(Math.max(0,state.bank||0),banks-1);
 const selected=pads.find(pad=>pad.channelId===model?.selectedChannelId)||null;
 const cells=Array.from({length:ABL_PAD_BANK},(_,slot)=>{const index=bank*ABL_PAD_BANK+slot,pad=pads[index]||null,{row,column}=ablPadCell(slot);
  if(!pad)return `<div class="abl-pad abl-pad-empty" data-pad-slot="${index}" style="grid-row:${row+1};grid-column:${column+1}" title="${model?.editable?'Drop a sample from the browser to add a pad':'Empty pad'}"><span class="abl-pad-note">${ablPadNote(index)}</span></div>`;
  return `<div class="abl-pad${pad.channelId===model.selectedChannelId?' selected':''}${pad.mute?' muted':''}" role="button" tabindex="0" data-pad="${esc(pad.channelId)}" data-pad-slot="${index}" style="grid-row:${row+1};grid-column:${column+1}${pad.color?`;--abl-pad-color:${esc(pad.color)}`:''}" title="${esc(pad.name)} · ${ablPadNote(index)} · click to select, ▶ to play, right-click for Rename/Delete"><span class="abl-pad-name">${esc(pad.name)}</span><span class="abl-pad-buttons"><button type="button" class="abl-pad-mute${pad.mute?'':' on'}" data-pad-mute aria-pressed="${!pad.mute}" title="${pad.mute?'Unmute':'Mute'} ${esc(pad.name)}">M</button><button type="button" class="abl-pad-play" data-pad-play title="Play ${esc(pad.name)}" aria-label="Play ${esc(pad.name)}">▶</button><button type="button" class="abl-pad-solo${pad.solo?' on':''}" data-pad-solo aria-pressed="${!!pad.solo}" title="Solo ${esc(pad.name)}">S</button></span></div>`;}).join('');
 const patternPicker=(model?.patterns||[]).length>1?`<select class="abl-rack-pattern" aria-label="Pattern shown in the Drum Rack">${model.patterns.map(item=>`<option value="${esc(item.id)}"${item.id===model.patternId?' selected':''}>${esc(item.name)}</option>`).join('')}</select>`:`<span class="abl-rack-pattern-name">${esc(model?.patternName||'')}</span>`;
 const chain=selected?`<div class="abl-rack-chain-row selected" data-chain="${esc(selected.channelId)}"><span class="abl-rack-chain-name">${esc(selected.name)}</span><span class="abl-rack-chain-kind">${selected.kind==='sample'?'Sample':'Instrument'}</span>${selected.hasPlugin?`<button type="button" class="abl-rack-chain-open" data-chain-open title="Show ${esc(selected.name)}’s plug-in window">⚙</button>`:''}</div><div class="abl-rack-chain-device" aria-label="${esc(selected.name)} channel"><div class="abl-rack-chain-knob"><span>Volume</span><div data-pad-volume></div></div><div class="abl-rack-chain-knob"><span>Pan</span><div data-pad-pan></div></div></div>`:`<p class="abl-rack-chain-empty">${pads.length?'Select a pad to see its chain.':'Drop samples here to build a Drum Rack.'}</p>`;
 body.innerHTML=`<div class="abl-drum-rack"><div class="abl-rack-banks" role="group" aria-label="Pad banks">${Array.from({length:banks},(_,index)=>`<button type="button" class="abl-rack-bank${index===bank?' selected':''}" data-bank="${index}" title="Pads ${index*ABL_PAD_BANK+1}–${(index+1)*ABL_PAD_BANK}">${index+1}</button>`).join('')}</div><div class="abl-pad-grid" role="grid" aria-label="Drum Rack pads">${cells}</div><div class="abl-rack-chain"><div class="abl-rack-chain-head">${patternPicker}</div>${chain}</div></div>`;
 const fail=error=>{try{hooks.onError?.(error);}catch{}};
 const call=(name,...args)=>{try{const result=hooks[name]?.(...args);if(result&&typeof result.catch==='function')result.catch(fail);return result;}catch(error){fail(error);return null;}};
 /** Live's inline rename (⌘R): Enter/blur commits once through the rack channel rename (one Undo step), Esc cancels. */
 const startRename=(node,channelId)=>{
  const pad=pads.find(item=>item.channelId===channelId),label=node.querySelector('.abl-pad-name');if(!pad||!label||node.querySelector('.abl-pad-rename'))return;
  const input=document.createElement('input');input.className='abl-pad-rename';input.value=pad.name||'';input.maxLength=255;input.setAttribute('aria-label',`Rename ${pad.name}`);label.replaceWith(input);
  let done=false;const finish=commit=>{if(done)return;done=true;const name=input.value.trim();input.replaceWith(label);if(commit&&name&&name!==pad.name){label.textContent=name;call('renamePad',channelId,name);}};
  input.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();finish(true);}else if(event.key==='Escape'){event.preventDefault();finish(false);}});
  input.addEventListener('blur',()=>finish(true));input.addEventListener('click',event=>event.stopPropagation());input.addEventListener('pointerdown',event=>event.stopPropagation());
  try{input.focus();input.select();}catch{}
 };
 let audition=null;const stop=()=>{const held=audition;audition=null;try{held?.stop?.();}catch{}};
 const grid=body.querySelector('.abl-pad-grid');
 for(const node of body.querySelectorAll('[data-bank]'))node.onclick=event=>{event.stopPropagation();state.bank=Number(node.dataset.bank);renderDrumRack(body,model,hooks,state);};
 body.querySelector('.abl-rack-pattern')?.addEventListener('change',event=>call('selectPattern',event.target.value));
 body.querySelector('[data-chain-open]')?.addEventListener('click',event=>{event.stopPropagation();call('openPadPlugin',selected.channelId);});
 for(const node of body.querySelectorAll('.abl-pad[data-pad]')){
  const channelId=node.dataset.pad;
  node.addEventListener('click',event=>{if(event.target.closest('button'))return;event.stopPropagation();call('selectPad',channelId);});
  node.addEventListener('keydown',event=>{
   if(event.target!==node)return;
   if(event.key==='Enter'||event.key===' '){event.preventDefault();call('selectPad',channelId);}
   else if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='r'){event.preventDefault();event.stopPropagation();startRename(node,channelId);}
   else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();event.stopPropagation();call('removePad',channelId);}
  });
  node.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();
   // Live's pad menu: Rename / Delete over the rack channel's own edits; the full channel menu stays one item away.
   if(typeof hooks.menu!=='function')return call('padMenu',event,channelId);
   const editable=!!model?.editable;
   call('menu',event,[{label:'Rename',shortcut:'⌘R',disabled:!editable,title:editable?'':'Open a Freestyle project to edit its pads.',run:()=>startRename(node,channelId)},{label:'Delete',shortcut:'⌫',disabled:!editable||typeof hooks.removePad!=='function',run:()=>call('removePad',channelId)},null,{label:'Channel Options…',run:()=>call('padMenu',event,channelId)}]);});
  node.querySelector('[data-pad-mute]').onclick=event=>{event.stopPropagation();call('togglePadMute',channelId);};
  node.querySelector('[data-pad-solo]').onclick=event=>{event.stopPropagation();call('togglePadSolo',channelId);};
  const play=node.querySelector('[data-pad-play]');
  play.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();stop();try{play.setPointerCapture?.(event.pointerId);}catch{}play.classList.add('active');audition=call('auditionPad',channelId);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])play.addEventListener(type,()=>{play.classList.remove('active');stop();});
  play.addEventListener('click',event=>event.stopPropagation());
 }
 // A library sound dropped anywhere on the pads adds a pad through the rack's add-sound path.
 grid.addEventListener('dragover',event=>{if(!model?.editable||![...(event.dataTransfer?.types||[])].some(type=>type===ABL_LIBRARY_SOUND_MIME||type===ABL_INSTRUMENT_MIME))return;event.preventDefault();event.stopPropagation();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';grid.classList.add('drop-target');});
 grid.addEventListener('dragleave',event=>{if(!grid.contains(event.relatedTarget))grid.classList.remove('drop-target');});
 grid.addEventListener('drop',event=>{grid.classList.remove('drop-target');const raw=event.dataTransfer?.getData?.(ABL_LIBRARY_SOUND_MIME),device=raw?'':event.dataTransfer?.getData?.(ABL_INSTRUMENT_MIME);if(!raw&&!device)return;event.preventDefault();event.stopPropagation();if(!model?.editable)return fail(new Error('Open a Freestyle project before adding pads.'));
  // QA r6: Live drops onto a pad straight from the Device View — the host targets model.patternId (the track's current or
  // first drum clip) itself, selecting it when needed; with no clip yet (patternId null) the sound goes through the
  // rack's own add-channel path on the current pattern. One drop = one host write = one Undo step.
  if(device){let ref=device;try{ref=JSON.parse(device);}catch{ref={id:device};}const slot=Number(event.target.closest?.('[data-pad-slot]')?.dataset.padSlot);return call('addPadInstrument',ref,model.patternId,Number.isInteger(slot)?slot:null);}call('addPadSound',raw,model.patternId??null);});
 // Live's chain device for the selected pad: Volume (the rack channel volume, one saved step) and Pan (its instrument track's pan; a
 // sample channel has no pan stage in Freestyle, so that knob is disabled with the reason).
 const knobs=[];
 if(selected){
  const db=value=>value>0?`${(20*Math.log10(value)).toFixed(1)} dB`:'-inf dB';
  const volumeEl=body.querySelector('[data-pad-volume]');if(volumeEl)knobs.push(new AblKnob(volumeEl,{min:0,max:2,value:selected.volume??1,defaultValue:1,label:`${selected.name} Volume`,format:db,disabled:!model?.editable||selected.volume==null,onCommit:({after})=>call('setPadVolume',selected.channelId,after)}));
  const panEl=body.querySelector('[data-pad-pan]');if(panEl){const knob=new AblKnob(panEl,{min:-1,max:1,value:selected.pan??0,defaultValue:0,bipolar:true,label:`${selected.name} Pan`,format:value=>Math.abs(value)<.005?'C':`${Math.round(Math.abs(value)*50)}${value<0?'L':'R'}`,disabled:!selected.panLaneId||selected.pan==null,onCommit:({before,after})=>call('setPadPan',selected.panLaneId,before,after)});if(!selected.panLaneId)panEl.title='Pan: a sample pad plays through its track; pan the track in the mixer.';knobs.push(knob);}
 }
 return{bank,destroy:()=>{stop();for(const knob of knobs)knob.destroy();}};
}
