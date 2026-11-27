/** Street Band region / track tools over the Tracks area:
 *  - Fade tool (T ▸ A): drag over the start or end of an audio region to set its
 *    fade-in / fade-out; ⌥-click a region end removes that fade. One gesture is
 *    one history step (RegionGainFadeController).
 *  - Fade shapes drawn on audio regions; Region Inspector Gain / Fade In / Fade Out.
 *  - Track header R (Record Enable) and I (Input Monitoring) for audio tracks: R
 *    chooses the lane the control-bar Record button records into; I sends the
 *    recorder's `self_monitor` flag (as Studio Pro's take_start does).
 *  - Control-bar Count-in toggle (startRecording count_in_beats; disabled while
 *    Freestyle API recording answers 502 clean_media_activation_required) and
 *    the editable LCD key (click: Logic key popup; one undo step).
 *  - Region Inspector Gain drag: live persist:false ticks, one saved commit.
 *  - Pattern / MIDI region Inspector Gain (setPatternPlacementGain): a drag
 *    previews the value locally and commits once; one history step.
 *  - Stem Splitter… dialog, job progress on the region, Analyze Key… dialog.
 * Presentation and routing only: every write goes through RegionGainFadeController,
 * StemSplitController, ProjectKeyController, CountInController or an app handler.
 */
import {RegionGainFadeController,fadeOverlaySvg,gainDbText,dbToClipGain,fadeMsText,CLIP_GAIN_MAX} from './logic-region-gain-fade.js';
import {PatternRegionGainController,isPatternRegion} from './logic-pattern-region-gain.js';
import {StemSplitController,stemSplitterDialogHtml,stemSplitterChoice,stemProgressHtml,stemName} from './logic-stem-splitter.js';
import {ProjectKeyController,keyPopupHtml,keyAnalysisText,keyName} from './logic-project-key.js';
import {CountInController,RECORDING_API_UNAVAILABLE,countInBeats} from './logic-count-in.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
/** Count-in tooltip while Freestyle API recording is blocked (live probe 2026-11-12: 502 clean_media_activation_required). */
export const COUNT_IN_UNAVAILABLE=RECORDING_API_UNAVAILABLE;
/** Region Inspector Gain drag: dB per pixel of vertical movement (⇧ = fine). */
export const GAIN_DRAG_DB_PER_PX=.2;
/** Linear gain after dragging `dy` pixels (up = louder) from `startGain`, clamped to −∞ … +12 dB (0–4). */
export function gainAfterDrag(startGain,dy,{fine=false}={}){
 const startDb=startGain>0?20*Math.log10(startGain):-96,db=startDb-dy*GAIN_DRAG_DB_PER_PX*(fine?.1:1);
 if(db<=-96)return 0;return Math.round(Math.min(CLIP_GAIN_MAX,10**(db/20))*1e6)/1e6;
}
export const RECORD_LANE_KINDS=new Set(['audio','vocal']);
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
 const studioClient=()=>api.studioClient?.()||null,scope=()=>{const projectId=api.projectId?.();return projectId?{projectId}:null;},log=(event,detail)=>api.log?.(event,detail),refresh=()=>api.refresh?.();
 const controller=api.controller||new RegionGainFadeController({client:studioClient,scope,history:()=>api.history?.()||null,log,
  revision:()=>api.projectRevision?.()??null,adoptRevision:(projectId,tags)=>api.adoptRevision?.(projectId,tags),refresh,
  onChange:(clipId,kind)=>{if(kind==='gain')api.invalidateWaveform?.(clipId);paintFades();if(!inspectorFocused())api.renderInspector?.();}});
 const patternGain=api.patternGain||new PatternRegionGainController({client:studioClient,scope,history:()=>api.history?.()||null,log,onChange:()=>{if(!inspectorFocused())api.renderInspector?.();}});
 const stems=api.stems||new StemSplitController({client:studioClient,scope,history:()=>api.history?.()||null,refresh,log,onChange:()=>paintStems()});
 const projectKeys=api.projectKeys||new ProjectKeyController({client:studioClient,scope,history:()=>api.history?.()||null,refresh,log});
 const countIn=api.countIn||new CountInController({client:studioClient,scope,log,storage:(()=>{try{return doc.defaultView?.localStorage||null;}catch{return null;}})()});
 let projectKey=null;const recordState={armed:null,monitor:new Set()};
 const inspectorFocused=()=>!!doc.activeElement?.closest?.('#logic-inspector [data-region-edit]');
 const clipFor=element=>api.findClip?.(element?.dataset?.clip)||null;
 const audio=clip=>!!clip&&!clip.patternId&&typeof clip.cloudId==='string';
 const fadeClip=clip=>({cloudId:clip.cloudId,laneId:clip.laneId,name:clip.name,durationSec:regionDurationSec(clip)});
 function syncProject(){const id=api.projectId?.()||null;if(id!==projectKey){projectKey=id;controller.reset();patternGain.reset();if(!stems.busy)stems.reset();recordState.armed=null;}}

 // ── Stem Splitter (region menu): dialog, job progress on the region, one undo step
 function paintStems(){
  for(const element of $$('#track-lanes .clip.audio-clip[data-clip]')){
   const clip=clipFor(element),markup=audio(clip)?stemProgressHtml(stems.job(clip.cloudId)):'';let host=element.querySelector(':scope>.logic-stem-host');
   if(!markup){host?.remove();element.classList.remove('logic-stem-running');continue;}
   if(!host){host=doc.createElement('div');host.className='logic-stem-host';element.append(host);}
   if(host.innerHTML!==markup)host.innerHTML=markup;element.classList.add('logic-stem-running');
  }
 }
 function openStemSplitter(clip){
  if(!audio(clip))return toast('Stem Splitter works on audio regions.');
  if(!studioClient())return toast('Stem Splitter needs a Studio API (OAuth) project. Reload the project.');
  if(stems.busy)return toast('Wait for the current Stem Splitter job to finish.');
  if(typeof api.dialog!=='function')return toast('Stem Splitter is unavailable in this window.');
  const d=api.dialog('Stem Splitter',stemSplitterDialogHtml({name:clip.name||'Region'}),{className:'logic-stem-dialog'}),form=d.querySelector('.logic-stem-form');
  d.querySelector('[data-stem-cancel]')?.addEventListener('click',()=>d.close());
  form?.addEventListener('submit',event=>{event.preventDefault();const choice=stemSplitterChoice(form);if(!choice)return toast('Choose the stems to split.');d.close();runStemSplit(clip,choice);});
  return d;
 }
 async function runStemSplit(clip,choice){
  try{const result=await stems.split({cloudId:clip.cloudId,laneId:clip.laneId,name:clip.name,patternId:clip.patternId},choice);
   const kept=result.keepOriginal,names=result.lanes.map(lane=>lane.name||stemName(lane.stem)).join(', ');
   if(result.deduplicated){toast(`Stem Splitter: this region was already split (${names||'stems'} are on their own tracks). Nothing new was added.`);return result;}
   toast(kept?.error?`Stem Splitter: ${names} added, but ${kept.error.replace(/[.]$/,'')}. Check the track and region mutes (Undo removes the stems).`:`Stem Splitter: ${names} (original muted)`);return result;}
  catch(error){fail(error);return null;}
  finally{paintStems();}
 }

 // ── Project key: LCD popup (Logic) and Freestyle ▸ Analyze Key…
 let keyPopup=null;
 function closeKeyPopup(){keyPopup?.remove();keyPopup=null;}
 function savedKey(){const raw=api.getProject?.()?.cloud?.rawProject;return{key:raw?.key??null,scale:raw?.scale??null};}
 async function commitKey(key,scale){
  closeKeyPopup();
  try{const result=await projectKeys.setKey(key,scale);if(result.changed)toast(`Project Key: ${keyName(result.key,result.scale)}`);paintKey();return result;}
  catch(error){fail(error);paintKey();return null;}
 }
 function openKeyPopup(){
  if(keyPopup){closeKeyPopup();return null;}
  const el=$('#lcd-key');if(!el)return null;
  if(!studioClient())return toast('The project key needs a Studio API (OAuth) project. Reload the project.');
  const current=savedKey();let scale=current.scale==='minor'?'minor':'major';
  keyPopup=doc.createElement('div');keyPopup.innerHTML=keyPopupHtml(current);keyPopup=keyPopup.firstElementChild;doc.body.append(keyPopup);
  const rect=el.getBoundingClientRect?.();if(rect){keyPopup.style.position='fixed';keyPopup.style.left=`${Math.max(4,rect.left)}px`;keyPopup.style.top=`${rect.bottom+4}px`;}
  for(const button of keyPopup.querySelectorAll('[data-scale]'))button.addEventListener('click',()=>{scale=button.dataset.scale;for(const other of keyPopup.querySelectorAll('[data-scale]')){other.classList.toggle('on',other===button);other.setAttribute('aria-pressed',String(other===button));}if(current.key)commitKey(current.key,scale);});
  for(const button of keyPopup.querySelectorAll('[data-key]'))button.addEventListener('click',()=>commitKey(button.dataset.key,scale));
  keyPopup.querySelector('[data-key-none]')?.addEventListener('click',()=>commitKey(null,null));
  keyPopup.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeKeyPopup();}});
  setTimeout(()=>{const outside=event=>{if(!keyPopup||keyPopup.contains(event.target)||event.target===el){return;}closeKeyPopup();doc.removeEventListener('pointerdown',outside,true);};doc.addEventListener('pointerdown',outside,true);},0);
  return keyPopup;
 }
 on($('#lcd-key'),'click',event=>{event.preventDefault();event.stopPropagation();openKeyPopup();});
 /** Freestyle ▸ Analyze Key…: detect (selected audio region, else the backing), then offer Set Project Key. */
 function analyzeKey(){
  if(!studioClient())return toast('Key analysis needs a Studio API (OAuth) project. Reload the project.');
  if(typeof api.dialog!=='function')return null;
  const selected=[...(api.selectedIds?.()||[])].map(item=>api.findClip?.(item)).find(audio)||null,source=selected?`region “${selected.name||'Region'}”`:'backing track';
  const d=api.dialog('Analyze Key',`<div class="logic-key-analysis"><p data-key-status>Analyzing the ${esc(source)}…</p><progress data-key-progress></progress><div class="logic-stem-actions"><button type="button" data-key-close>Close</button><button type="button" class="primary" data-key-apply disabled>Set Project Key</button></div></div>`);
  const status=d.querySelector('[data-key-status]'),progress=d.querySelector('[data-key-progress]'),apply=d.querySelector('[data-key-apply]');
  d.querySelector('[data-key-close]')?.addEventListener('click',()=>d.close());
  projectKeys.analyze({trackId:selected?.cloudId||null,onProgress:job=>{if(status)status.textContent=`Analyzing the ${source}… (${job.status})`;}}).then(result=>{
   progress?.remove();if(status)status.textContent=keyAnalysisText(result);
   if(result.writable&&apply){apply.disabled=false;apply.textContent=`Set Project Key to ${keyName(result.writable.key,result.writable.scale)}`;apply.addEventListener('click',()=>{d.close();commitKey(result.writable.key,result.writable.scale);});}
  },error=>{progress?.remove();if(status)status.textContent=error.message;});
  return d;
 }

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
 async function commitGain(clip,text,exact=null){
  let gain;try{gain=Number.isFinite(exact)?exact:dbToClipGain(text);}catch(error){fail(error);api.renderInspector?.();return null;}
  try{const result=await controller.setGain(fadeClip(clip),gain);if(result.changed)toast(`Region Gain ${gainDbText(result.gain)} dB`);return result;}
  catch(error){fail(error);api.renderInspector?.();return null;}
 }

 async function commitPatternGain(region,text,exact=null){
  let gain;try{gain=Number.isFinite(exact)?exact:dbToClipGain(text);}catch(error){fail(error);api.renderInspector?.();return null;}
  try{const result=await patternGain.setGain(region,gain);if(result.changed)toast(`Region Gain ${gainDbText(result.gain)} dB`);return result;}
  catch(error){fail(error);api.renderInspector?.();return null;}
 }
 const gainRow=(label,input,unit,title)=>`<label class="logic-insp-row logic-insp-edit" title="${esc(title)}"><span>${esc(label)}</span><span class="logic-insp-value">${input}<small>${esc(unit)}</small></span></label>`;
 /** Pattern / MIDI region Gain row (setPatternPlacementGain). */
 function patternRows(region){
  const studio=!!api.studioClient?.();if(studio)patternGain.loadGain(region);
  const gain=patternGain.gain(region.cloudId),reason=studio?patternGain.reason(region.cloudId):'Region gain needs a Studio API (OAuth) project.',disabled=!studio||gain===null&&!!reason?' disabled':'';
  return gainRow('Gain',`<input type="text" inputmode="decimal" data-region-edit="pattern-gain" aria-label="Region gain in dB" value="${esc(gain===null?(reason?'—':'…'):gainDbText(gain))}"${disabled}>`,'dB',reason||'Region gain (−∞ … +12 dB) of this pattern region. Drag up/down (⇧ fine) or type; release / Return saves; ⌘Z undoes.');
 }
 function bindPatternRows(host,region){
  const current=()=>{const clip=api.findClip?.(region.id)||null;return isPatternRegion(clip)?clip:null;};
  const input=host.querySelector('[data-region-edit="pattern-gain"]');if(!input)return;
  input.addEventListener('change',event=>{if(input.dataset.dragging)return;const clip=current();if(clip)commitPatternGain(clip,event.target.value);});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();input.blur();}event.stopPropagation();});
  // No engine-only placement gain exists: the drag shows the value, release saves once.
  input.addEventListener('pointerdown',event=>{
   if(event.button!==0||input.disabled||doc.activeElement===input)return;const clip=current(),start=patternGain.gain(clip?.cloudId);if(!clip||start===null)return;
   const startY=event.clientY;let moved=false,value=start;
   const move=next=>{const dy=next.clientY-startY;if(!moved&&Math.abs(dy)<3)return;if(!moved){moved=true;input.dataset.dragging='1';}next.preventDefault?.();value=gainAfterDrag(start,dy,{fine:!!next.shiftKey});input.value=gainDbText(value);};
   const stop=()=>{doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',cancel,true);doc.removeEventListener('keydown',escape,true);};
   const up=()=>{stop();if(!moved)return;event.preventDefault?.();delete input.dataset.dragging;input.blur?.();commitPatternGain(clip,gainDbText(value),value);};
   const cancel=()=>{stop();if(!moved)return;delete input.dataset.dragging;input.value=gainDbText(start);};
   const escape=next=>{if(next.key==='Escape'){next.preventDefault();next.stopPropagation();cancel();}};
   doc.addEventListener('pointermove',move,true);doc.addEventListener('pointerup',up,true);doc.addEventListener('pointercancel',cancel,true);doc.addEventListener('keydown',escape,true);
  });
 }

 // ── Region Inspector rows (audio regions; pattern / MIDI regions get Gain only)
 api.hooks.regionRows=region=>{
  if(isPatternRegion(region))return patternRows(region);
  if(!audio(region))return'';const fades=controller.fades(region.cloudId),gain=controller.gain(region.cloudId),studio=!!api.studioClient?.(),why=studio?'':'Region gain and fades need a Studio API (OAuth) project.';
  // Read once per region (a failed read stays failed until the region or project changes: no re-render loop).
  if(studio){if(controller.status(region.cloudId)==='idle')controller.load(fadeClip(region));if(gain===null)controller.loadGain(fadeClip(region));}
  const row=(label,input,unit,title)=>`<label class="logic-insp-row logic-insp-edit" title="${esc(title)}"><span>${esc(label)}</span><span class="logic-insp-value">${input}<small>${esc(unit)}</small></span></label>`;
  const disabled=studio?'':' disabled';
  return row('Gain',`<input type="text" inputmode="decimal" data-region-edit="gain" aria-label="Region gain in dB" value="${esc(gain===null?'…':gainDbText(gain))}"${disabled}>`,'dB',why||'Region gain (−∞ … +12 dB), saved with the region. Drag up/down (⇧ fine) or type; release / Return saves; ⌘Z undoes.')
   +row('Fade In',`<input type="number" min="0" step="1" data-region-edit="fade-in" aria-label="Fade in length in milliseconds" value="${esc(fades?fadeMsText(fades.fadeIn):'')}" placeholder="…"${disabled}>`,'ms',why||'Fade-in length. Or drag the region start with the Fade tool (T ▸ A).')
   +row('Fade Out',`<input type="number" min="0" step="1" data-region-edit="fade-out" aria-label="Fade out length in milliseconds" value="${esc(fades?fadeMsText(fades.fadeOut):'')}" placeholder="…"${disabled}>`,'ms',why||'Fade-out length. Or drag the region end with the Fade tool (T ▸ A).');
 };
 api.hooks.bindRegionRows=(host,region)=>{
  if(isPatternRegion(region))return bindPatternRows(host,region);
  const current=()=>api.findClip?.(region.id)||null;
  const gainInput=host.querySelector('[data-region-edit="gain"]');
  gainInput?.addEventListener('change',event=>{if(gainInput.dataset.dragging)return;const clip=current();if(audio(clip))commitGain(clip,event.target.value);});
  // Logic value field: drag up/down changes the gain live (engine only), release saves once.
  gainInput?.addEventListener('pointerdown',event=>{
   if(event.button!==0||gainInput.disabled||doc.activeElement===gainInput)return;const clip=current(),start=controller.gain(clip?.cloudId);if(!audio(clip)||start===null)return;
   const startY=event.clientY;let moved=false,value=start;
   const move=next=>{const dy=next.clientY-startY;if(!moved&&Math.abs(dy)<3)return;if(!moved){moved=true;gainInput.dataset.dragging='1';}next.preventDefault?.();value=gainAfterDrag(start,dy,{fine:!!next.shiftKey});gainInput.value=gainDbText(value);controller.previewGain(fadeClip(clip),value);};
   const stop=()=>{doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',cancel,true);doc.removeEventListener('keydown',escape,true);};
   const up=()=>{stop();if(!moved)return;event.preventDefault?.();delete gainInput.dataset.dragging;gainInput.blur?.();commitGain(clip,gainDbText(value),value);};
   const cancel=()=>{stop();if(!moved)return;delete gainInput.dataset.dragging;gainInput.value=gainDbText(start);controller.cancelLive(fadeClip(clip)).catch(()=>{});};
   const escape=next=>{if(next.key==='Escape'){next.preventDefault();next.stopPropagation();cancel();}};
   doc.addEventListener('pointermove',move,true);doc.addEventListener('pointerup',up,true);doc.addEventListener('pointercancel',cancel,true);doc.addEventListener('keydown',escape,true);
  });
  for(const [selector,direction]of [['fade-in','in'],['fade-out','out']])host.querySelector(`[data-region-edit="${selector}"]`)?.addEventListener('change',event=>{const clip=current(),value=Number(event.target.value);if(!audio(clip))return;if(!Number.isFinite(value)||value<0){toast('Type a fade length of 0 ms or more.');api.renderInspector?.();return;}commitFade(clip,direction,value/1000).then(()=>api.renderInspector?.());});
  for(const input of host.querySelectorAll('[data-region-edit]'))input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();input.blur();}event.stopPropagation();});
 };

 // ── Record Enable (R) and Input Monitoring (I) on audio track headers
 function paintTrackRecord(){
  syncProject();const recording=!!api.recording?.();
  for(const label of $$('#track-lanes .track-label.logic-track-header[data-track]')){
   const row=Number(label.dataset.track),laneId=api.laneId?.(row),kind=api.laneKind?.(row),r=label.querySelector('.logic-track-r'),i=label.querySelector('.logic-track-i'),recordable=!!laneId&&RECORD_LANE_KINDS.has(kind);
   if(recordState.armed===laneId&&!recordable)recordState.armed=null;
   for(const [button,on,title]of [[r,recordState.armed===laneId,recordable?(recording?'Record Enable: wait until the current take is saved':'Record Enable: the Record button (R) records the microphone into this track'):'Record Enable: only audio tracks record'],[i,recordState.monitor.has(laneId),recordable?'Input Monitoring: hear the microphone through the Freestyle cloud engine while recording this track':'Input Monitoring: only audio tracks monitor input']]){
    if(!button)continue;button.disabled=!recordable||recording&&button===r;button.title=title;button.classList.toggle('on',!!on&&recordable);button.setAttribute('aria-pressed',String(!!on&&recordable));
   }
   if(label.dataset.logicRecordBound)continue;label.dataset.logicRecordBound='1';
   r?.addEventListener('click',event=>{event.stopPropagation();const lane=api.laneId?.(Number(label.dataset.track));if(!lane)return;recordState.armed=recordState.armed===lane?null:lane;paintTrackRecord();toast(recordState.armed?`Record enabled: ${api.trackName?.(Number(label.dataset.track))||'track'}`:'Record disabled');});
   i?.addEventListener('click',event=>{event.stopPropagation();const lane=api.laneId?.(Number(label.dataset.track));if(!lane)return;if(recordState.monitor.has(lane))recordState.monitor.delete(lane);else recordState.monitor.add(lane);paintTrackRecord();toast(recordState.monitor.has(lane)?'Input Monitoring on (applies when this track records)':'Input Monitoring off');});
  }
 }
 /** The recorder target for the control-bar Record button: {laneId?, selfMonitor}. */
 function recordTarget(){syncProject();const laneId=recordState.armed;return laneId?{laneId,selfMonitor:recordState.monitor.has(laneId)}:{};}

 // ── Control bar: Count-in (startRecording count_in_beats) and the editable LCD key
 const metronome=$('#metronome');
 if(metronome&&!$('#logic-count-in')){const button=doc.createElement('button');button.type='button';button.id='logic-count-in';button.className='tool-square logic-count-in';button.textContent='1234';button.setAttribute('aria-label','Count-in');button.setAttribute('aria-pressed','false');metronome.after(button);}
 function paintCountIn(){const button=$('#logic-count-in');if(!button)return;const state=countIn.state(),recording=!!api.recording?.();button.disabled=!state.enabled||recording;button.title=state.reason||(state.on?`Count-in: ${state.bars===2?'2 bars':'1 bar'} before the take (Record ▸ Count-in sets bars)`:'Count-in: off (Record ▸ Count-in sets bars)');button.classList.toggle('on',state.on);button.setAttribute('aria-pressed',String(state.on));}
 on($('#logic-count-in'),'click',event=>{event.stopPropagation();try{const state=countIn.toggle();toast(state.on?'Count-in on':'Count-in off');}catch(error){toast(error.message);}paintCountIn();});
 /** Called by the Record button before the microphone take starts: count in when on. */
 async function countInBeforeRecord({laneId,seekSeconds,bpm,signature}={}){
  if(!countIn.state().on)return null;
  try{return await countIn.start({laneId,beats:countInBeats(signature),seekSeconds,bpm});}finally{paintCountIn();}
 }
 function paintKey(){const el=$('#lcd-key');if(!el)return;const raw=api.getProject?.()?.cloud?.rawProject,text=projectKeyText(raw?.key,raw?.scale),studio=!!studioClient();if(el.textContent!==text)el.textContent=text;el.classList.toggle('logic-lcd-editable',studio);el.setAttribute('role','button');el.tabIndex=studio?0:-1;el.title=studio?`Key: ${text==='—'?'none':text}. Click to choose the project key (⌘Z undoes). Freestyle ▸ Analyze Key… detects it.`:`Key: ${text==='—'?'none':text}. Changing the key needs a Studio API (OAuth) project.`;}
 on($('#lcd-key'),'keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();openKeyPopup();}});

 // ── Hooks after the application's own renders
 const wrap=name=>{const previous=api.hooks[name];api.hooks[name]=(...args)=>{try{previous?.(...args);}finally{try{paintFades();paintStems();paintTrackRecord();paintKey();paintCountIn();}catch(error){api.log?.('region-tools-paint',{message:String(error?.message||error).slice(0,160)});}}};disposers.push(()=>{api.hooks[name]=previous;});};
 wrap('afterTracks');wrap('mixer');
 paintFades();paintStems();paintTrackRecord();paintKey();paintCountIn();
 return{controller,patternGain,commitPatternGain,stems,projectKeys,countIn,paintFades,paintStems,paintTrackRecord,paintKey,paintCountIn,recordTarget,recordState,commitFade,commitGain,commitKey,openKeyPopup,openStemSplitter,runStemSplit,analyzeKey,countInBeforeRecord,destroy(){closeKeyPopup();for(const dispose of disposers.splice(0))dispose();delete api.hooks.regionRows;delete api.hooks.bindRegionRows;}};
}
