/** Disabelton region / track tools over the Tracks area:
 *  - Fade tool (T ▸ A): drag over the start or end of an audio region to set its
 *    fade-in / fade-out; ⌥-click a region end removes that fade. One gesture is
 *    one history step (RegionGainFadeController).
 *  - Fade shapes drawn on audio regions; Region Inspector Gain / Fade In / Fade Out.
 *  - Track header R (Record Enable) and I (Input Monitoring) for audio tracks: R
 *    chooses the lane the control-bar Record button records into; I sends the
 *    recorder's `self_monitor` flag (as Studio Pro's take_start does).
 *    MIDI / instrument tracks arm too: ● then records played notes (computer MIDI keyboard and Web MIDI input)
 *    into the open pattern clip at the playhead (abl-clip-view.js take capture, one undo step per take).
 *  - Control-bar Count-In chooser (Live's metronome ▾ Count-In: None / 1 Bar / 2 Bars …) → startRecording
 *    count_in_beats (0–8, Studio API live-ingest takes), and the LCD key/scale from the saved project.
 * Presentation and routing only: every write goes through RegionGainFadeController
 * or an app handler.
 */
import {RegionGainFadeController,fadeOverlaySvg,gainDbText,dbToClipGain,fadeMsText} from './logic-region-gain-fade.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
/** Shown when the typed Studio client is not active: the native fallback path records without a count-in. */
export const COUNT_IN_UNAVAILABLE='Count-In applies to Freestyle live-ingest takes (Studio API startRecording count_in_beats, 0–8 beats); the browser-capture fallback records without one.';
export const RECORD_LANE_KINDS=new Set(['audio','vocal','guitar']);
/** Live arms MIDI tracks too: the take is the notes played while ● and the transport run. */
export const MIDI_RECORD_LANE_KINDS=new Set(['instrument','pattern','midi','drum','drums']);
/** Live 12's Count-In menu (bars); Freestyle's count_in_beats tops out at 8, so 4 Bars (16 beats in 4/4) is off. */
export const COUNT_IN_CHOICES=Object.freeze([{bars:0,label:'None'},{bars:1,label:'1 Bar'},{bars:2,label:'2 Bars'},{bars:4,label:'4 Bars'}]);
export function countInBeats(bars,beatsPerBar=4){const total=Math.round(Number(bars)*Number(beatsPerBar));return Number.isFinite(total)&&total>0&&total<=8?total:0;}
export function countInAvailable(bars,beatsPerBar=4){const total=Math.round(Number(bars)*Number(beatsPerBar));return bars===0||Number.isFinite(total)&&total>0&&total<=8;}
/** "C" + "minor" → "C min" (Logic LCD style); null fields → "—". */
export function projectKeyText(key,scale){
 const root=typeof key==='string'?key.trim():'';if(!root)return'—';
 const mode=typeof scale==='string'?scale.trim().toLowerCase():'';
 return `${root}${mode?' '+(mode.startsWith('maj')?'maj':mode.startsWith('min')?'min':mode):''}`;
}
/** Region duration in seconds from its saved row (never the beat view). */
export function regionDurationSec(clip){const value=Number(clip?.cloudRaw?.durationSec);return Number.isFinite(value)&&value>0?value:null;}
/** Fade length from a Fade-tool pointer position over a region rectangle. */
export function fadeFromPointer({direction,clientX,rect,durationSec}){
 if(!rect||!(rect.width>0)||!(durationSec>0))return 0;const perSec=rect.width/durationSec;
 const px=direction==='in'?clientX-rect.left:rect.left+rect.width-clientX;return Math.max(0,Math.min(durationSec,px/perSec));
}

/**
 * @param {object} api document, hooks (logicShellHooks), getProject, findClip, allClips,
 *  selectedIds, getTool, editable, toast, fail, studioClient, projectId, history,
 *  invalidateWaveform(clipId), renderInspector, laneId(row), laneKind(row), trackName(row),
 *  recording() → boolean, log.
 */
export function installRegionTools(api){
 const doc=api.document||globalThis.document,$=selector=>doc.querySelector(selector),$$=selector=>[...doc.querySelectorAll(selector)];
 const disposers=[],on=(target,type,listener,options)=>{if(!target)return;target.addEventListener(type,listener,options);disposers.push(()=>target.removeEventListener(type,listener,options));};
 const toast=message=>api.toast?.(message),fail=error=>api.fail?.(error);
 const controller=api.controller||new RegionGainFadeController({client:()=>api.studioClient?.()||null,scope:()=>{const projectId=api.projectId?.();return projectId?{projectId}:null;},history:()=>api.history?.()||null,log:(event,detail)=>api.log?.(event,detail),
  onChange:(clipId,kind)=>{if(kind==='gain')api.invalidateWaveform?.(clipId);paintFades();if(!inspectorFocused())api.renderInspector?.();}});
 let projectKey=null;const recordState={armed:null,armedKind:null,monitor:new Set(),countInBars:0};
 const inspectorFocused=()=>!!doc.activeElement?.closest?.('#logic-inspector [data-region-edit]');
 const clipFor=element=>api.findClip?.(element?.dataset?.clip)||null;
 const audio=clip=>!!clip&&!clip.patternId&&typeof clip.cloudId==='string';
 const fadeClip=clip=>({cloudId:clip.cloudId,laneId:clip.laneId,name:clip.name,durationSec:regionDurationSec(clip)});
 function syncProject(){const id=api.projectId?.()||null;if(id!==projectKey){projectKey=id;controller.reset();recordState.armed=null;recordState.armedKind=null;}}

 // ── Fade shapes on audio regions
 const preview=new Map();
 function paintFades(){
  syncProject();
  for(const element of $$('#track-lanes .clip.audio-clip[data-clip]')){
   const clip=clipFor(element);if(!audio(clip))continue;const durationSec=regionDurationSec(clip);if(!durationSec)continue;
   if(controller.status(clip.cloudId)==='idle'&&api.studioClient?.())controller.load(fadeClip(clip));
   const fades=preview.get(clip.cloudId)||controller.fades(clip.cloudId),markup=fades?fadeOverlaySvg({fadeIn:fades.fadeIn,fadeOut:fades.fadeOut,durationSec}):'';
   let overlay=element.querySelector(':scope>.logic-fade-host');
   if(!markup){overlay?.remove();continue;}
   if(!overlay){overlay=doc.createElement('div');overlay.className='logic-fade-host';overlay.setAttribute('aria-hidden','true');element.append(overlay);}
   if(overlay.innerHTML!==markup)overlay.innerHTML=markup;
   element.dataset.fadeIn=fadeMsText(fades.fadeIn);element.dataset.fadeOut=fadeMsText(fades.fadeOut);
  }
 }

 // ── Fade tool gesture (Logic: drag across a region's start or end; ⌥-click deletes that fade)
 on($('#track-lanes'),'pointerdown',event=>{
  if(api.getTool?.()!=='fade'||event.button!==0||event.ctrlKey||event.metaKey)return;
  const element=event.target?.closest?.('.clip[data-clip]');if(!element||element.closest('.automation-clip'))return;
  event.preventDefault();event.stopPropagation();
  const clip=clipFor(element);if(!audio(clip))return toast('The Fade tool works on audio regions.');
  if(!api.editable?.())return toast('Wait for the current cloud operation to finish.');
  const durationSec=regionDurationSec(clip);if(!durationSec)return toast('Reload the region’s saved length before fading it.');
  if(!api.studioClient?.())return toast('Region fades need a Studio API (OAuth) project. Reload the project.');
  const rect=element.getBoundingClientRect(),direction=event.clientX<rect.left+rect.width/2?'in':'out',startX=event.clientX,remove=event.altKey,known=controller.fades(clip.cloudId)||{fadeIn:0,fadeOut:0};
  let seconds=null,moved=false;
  const move=next=>{if(Math.abs(next.clientX-startX)>2)moved=true;if(!moved||remove)return;seconds=fadeFromPointer({direction,clientX:next.clientX,rect,durationSec});const other=direction==='in'?known.fadeOut:known.fadeIn;seconds=Math.min(seconds,Math.max(0,durationSec-other));preview.set(clip.cloudId,{...known,[direction==='in'?'fadeIn':'fadeOut']:seconds});paintFades();};
  const done=next=>{doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',done,true);doc.removeEventListener('pointercancel',cancel,true);
   if(next?.clientX!=null)move(next);
   const target=remove&&!moved?0:moved?seconds:null;if(target===null){preview.delete(clip.cloudId);paintFades();return;}
   commitFade(clip,direction,target).finally(()=>{preview.delete(clip.cloudId);paintFades();});};
  const cancel=()=>{doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',done,true);doc.removeEventListener('pointercancel',cancel,true);preview.delete(clip.cloudId);paintFades();};
  doc.addEventListener('pointermove',move,true);doc.addEventListener('pointerup',done,true);doc.addEventListener('pointercancel',cancel,true);
 },true);
 async function commitFade(clip,direction,seconds){
  try{const result=await controller.setFade(fadeClip(clip),{direction,seconds});if(result.changed)toast(`${result.label}: ${fadeMsText(direction==='in'?result.state.fadeIn:result.state.fadeOut)} ms`);return result;}
  catch(error){fail(error);return null;}
 }
 /** text: dB text, or a finite linear gain (0–4) from a drag. options.before: the gain before a preview drag. */
 async function commitGain(clip,text,options={}){
  let gain;try{gain=typeof text==='number'?text:dbToClipGain(text);}catch(error){fail(error);api.renderInspector?.();return null;}
  try{const result=await controller.setGain(fadeClip(clip),gain,{before:options.before});if(result.changed)toast(`Region Gain ${gainDbText(result.gain)} dB`);return result;}
  catch(error){fail(error);api.renderInspector?.();return null;}
 }

 // ── Region Inspector rows (audio regions)
 api.hooks.regionRows=region=>{
  if(!audio(region))return'';const fades=controller.fades(region.cloudId),gain=controller.gain(region.cloudId),studio=!!api.studioClient?.(),why=studio?'':'Region gain and fades need a Studio API (OAuth) project.';
  // Read once per region (a failed read stays failed until the region or project changes: no re-render loop).
  if(studio){if(controller.status(region.cloudId)==='idle')controller.load(fadeClip(region));if(gain===null)controller.loadGain(fadeClip(region));}
  const row=(label,input,unit,title)=>`<label class="logic-insp-row logic-insp-edit" title="${esc(title)}"><span>${esc(label)}</span><span class="logic-insp-value">${input}<small>${esc(unit)}</small></span></label>`;
  const disabled=studio?'':' disabled';
  return row('Gain',`<input type="text" inputmode="decimal" data-region-edit="gain" aria-label="Region gain in dB" value="${esc(gain===null?'…':gainDbText(gain))}"${disabled}>`,'dB',why||'Region gain (−∞ … +12 dB). Return applies; ⌘Z undoes.')
   +row('Fade In',`<input type="number" min="0" step="1" data-region-edit="fade-in" aria-label="Fade in length in milliseconds" value="${esc(fades?fadeMsText(fades.fadeIn):'')}" placeholder="…"${disabled}>`,'ms',why||'Fade-in length. Or drag the region start with the Fade tool (T ▸ A).')
   +row('Fade Out',`<input type="number" min="0" step="1" data-region-edit="fade-out" aria-label="Fade out length in milliseconds" value="${esc(fades?fadeMsText(fades.fadeOut):'')}" placeholder="…"${disabled}>`,'ms',why||'Fade-out length. Or drag the region end with the Fade tool (T ▸ A).');
 };
 api.hooks.bindRegionRows=(host,region)=>{
  const current=()=>api.findClip?.(region.id)||null;
  host.querySelector('[data-region-edit="gain"]')?.addEventListener('change',event=>{const clip=current();if(audio(clip))commitGain(clip,event.target.value);});
  for(const [selector,direction]of [['fade-in','in'],['fade-out','out']])host.querySelector(`[data-region-edit="${selector}"]`)?.addEventListener('change',event=>{const clip=current(),value=Number(event.target.value);if(!audio(clip))return;if(!Number.isFinite(value)||value<0){toast('Type a fade length of 0 ms or more.');api.renderInspector?.();return;}commitFade(clip,direction,value/1000).then(()=>api.renderInspector?.());});
  for(const input of host.querySelectorAll('[data-region-edit]'))input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();input.blur();}event.stopPropagation();});
 };

 // ── Record Enable (R) and Input Monitoring (I) on audio track headers
 function paintTrackRecord(){
  syncProject();const recording=!!api.recording?.();
  for(const label of $$('#track-lanes .track-label.logic-track-header[data-track]')){
   const row=Number(label.dataset.track),laneId=api.laneId?.(row),kind=api.laneKind?.(row),r=label.querySelector('.logic-track-r'),i=label.querySelector('.logic-track-i'),audioTrack=!!laneId&&RECORD_LANE_KINDS.has(kind),midiTrack=!!laneId&&MIDI_RECORD_LANE_KINDS.has(kind),recordable=audioTrack||midiTrack;
   if(recordState.armed===laneId&&!recordable)recordState.armed=null;
   for(const [button,on,title,enabled]of [[r,recordState.armed===laneId,!recordable?'Record Enable: this track cannot record':recording?'Record Enable: wait until the current take is saved':midiTrack?'Record Enable: the Record button (F9) records notes from the computer MIDI keyboard and MIDI input into this track’s open clip':'Record Enable: the Record button (F9) records the microphone into this track',recordable],[i,recordState.monitor.has(laneId),audioTrack?'Input Monitoring: hear the microphone through the Freestyle cloud engine while recording this track':'Input Monitoring: only audio tracks monitor input',audioTrack]]){
    if(!button)continue;button.disabled=!enabled||recording&&button===r;button.title=title;button.classList.toggle('on',!!on&&enabled);button.setAttribute('aria-pressed',String(!!on&&enabled));
   }
   if(label.dataset.logicRecordBound)continue;label.dataset.logicRecordBound='1';
   r?.addEventListener('click',event=>{event.stopPropagation();const lane=api.laneId?.(Number(label.dataset.track));if(!lane)return;arm(recordState.armed===lane?null:lane,api.laneKind?.(Number(label.dataset.track)));paintTrackRecord();toast(recordState.armed?`Record enabled: ${api.trackName?.(Number(label.dataset.track))||'track'}`:'Record disabled');});
   i?.addEventListener('click',event=>{event.stopPropagation();const lane=api.laneId?.(Number(label.dataset.track));if(!lane||!RECORD_LANE_KINDS.has(api.laneKind?.(Number(label.dataset.track))))return;if(recordState.monitor.has(lane))recordState.monitor.delete(lane);else recordState.monitor.add(lane);paintTrackRecord();toast(recordState.monitor.has(lane)?'Input Monitoring on (applies when this track records)':'Input Monitoring off');});
  }
 }
 /** Arm one lane (Live's exclusive arm) with its kind, or disarm (null). */
 function arm(laneId,kind=null){recordState.armed=laneId||null;recordState.armedKind=laneId?(kind??null):null;}
 /** The recorder target for the control-bar Record button: {laneId?, selfMonitor, midi, countInBeats}. */
 function recordTarget(){syncProject();const laneId=recordState.armed,beats=countInBeats(recordState.countInBars,api.beatsPerBar?.()||4);if(!laneId)return beats?{countInBeats:beats}:{};const midi=MIDI_RECORD_LANE_KINDS.has(recordState.armedKind);return{laneId,selfMonitor:!midi&&recordState.monitor.has(laneId),...midi?{midi:true}:{},...beats?{countInBeats:beats}:{}};}

 // ── Control bar: Live's metronome ▾ Count-In chooser and the LCD key
 const metronome=$('#metronome');
 function paintCountIn(){const button=$('#logic-count-in');if(!button)return;const choice=COUNT_IN_CHOICES.find(item=>item.bars===recordState.countInBars)||COUNT_IN_CHOICES[0],beats=countInBeats(choice.bars,api.beatsPerBar?.()||4);button.textContent='▾';button.title=`Count-In: ${choice.label}${beats?` (${beats} beats before the take)`:''}. ${COUNT_IN_UNAVAILABLE}`;button.setAttribute('aria-label',`Count-In: ${choice.label}`);button.setAttribute('aria-pressed',String(beats>0));button.classList.toggle('lit',beats>0);button.dataset.countIn=String(choice.bars);}
 function setCountIn(bars){if(!COUNT_IN_CHOICES.some(item=>item.bars===bars)||!countInAvailable(bars,api.beatsPerBar?.()||4))return false;recordState.countInBars=bars;paintCountIn();return true;}
 function countInMenu(event){event?.preventDefault?.();const perBar=api.beatsPerBar?.()||4;const items=COUNT_IN_CHOICES.map(choice=>({label:`Count-In: ${choice.label}`,checked:recordState.countInBars===choice.bars,disabled:!countInAvailable(choice.bars,perBar),title:countInAvailable(choice.bars,perBar)?'':`Freestyle counts in at most 8 beats (${choice.label} = ${choice.bars*perBar}).`,run:()=>{setCountIn(choice.bars);toast(`Count-In: ${choice.label}`);}}));if(typeof api.menu==='function')api.menu(event,items);else{const index=COUNT_IN_CHOICES.findIndex(item=>item.bars===recordState.countInBars),next=COUNT_IN_CHOICES.slice(index+1).concat(COUNT_IN_CHOICES.slice(0,index+1)).find(item=>countInAvailable(item.bars,perBar));setCountIn(next.bars);}}
 if(metronome&&!$('#logic-count-in')){const button=doc.createElement('button');button.type='button';button.id='logic-count-in';button.className='tool-square logic-count-in abl-metronome-menu';button.setAttribute('aria-haspopup','menu');metronome.after(button);on(button,'click',countInMenu);on(metronome,'contextmenu',countInMenu);}
 paintCountIn();
 function paintKey(){const el=$('#lcd-key');if(!el)return;const raw=api.getProject?.()?.cloud?.rawProject,text=projectKeyText(raw?.key,raw?.scale);if(el.textContent!==text)el.textContent=text;el.title=text==='—'?'Key: this Freestyle project stores no key signature. Studio API v1 has no key setter, and key detection is an AI-assistant feature.':`Key: ${text} (saved with the project; Studio API v1 has no key setter)`;}

 // ── Hooks after the application's own renders
 const wrap=name=>{const previous=api.hooks[name];api.hooks[name]=(...args)=>{try{previous?.(...args);}finally{try{paintFades();paintTrackRecord();paintKey();}catch(error){api.log?.('region-tools-paint',{message:String(error?.message||error).slice(0,160)});}}};disposers.push(()=>{api.hooks[name]=previous;});};
 wrap('afterTracks');wrap('mixer');
 paintFades();paintTrackRecord();paintKey();
 return{controller,paintFades,paintTrackRecord,paintKey,recordTarget,recordState,arm,setCountIn,countInMenu,paintCountIn,commitFade,commitGain,destroy(){for(const dispose of disposers.splice(0))dispose();delete api.hooks.regionRows;delete api.hooks.bindRegionRows;}};
}
