import {waveformSvg} from './audacity-timeline.js';
import {DEFAULT_TRACK_HEIGHT_PX} from './audacity-layout.js';

/** Shared presentation flags for real supplied waveform data. Solo changes
 * indicator colors, not the sample values or whether an overload is detected. */
export function waveformVisualOptions(workspace,clip){
 const project=workspace.getProject(),tracks=workspace.tracks||[],own=tracks.find(track=>track.index===clip.track);
 const solo=track=>typeof workspace.trackSolo==='function'?workspace.trackSolo(track):!!track.channel?.solo||!!(track.clips?.length&&track.clips.every(item=>item.cloudRaw?.soloed||item.cloudRaw?.solo));
 const ownSolo=own?solo(own):false,muted=!!own?.channel?.mute||(project.mutedTracks||[]).includes(clip.track);
 return {display:workspace.amplitudeView?.displayForClip(clip),showClipping:workspace.displayPreferences?.get?.()?.showClipping===true,clippingMuted:(tracks.some(solo)||muted)&&!ownSolo};
}

const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
export function legacyWaveformMarkup(workspace,clip,width,height,envelope,options={}){
 const hasState=typeof workspace.envelopeView?.waveformState==='function',state=workspace.envelopeView?.waveformState?.(clip);
 if(hasState&&state?.status==='connecting')return '<span class="au-waveform-loading au-legacy-waveform-status" role="status" aria-label="Loading waveform">Loading waveform…</span>';
 if(hasState&&(state?.status!=='ready'||!state.envelope))return `<span class="au-waveform-unavailable au-legacy-waveform-status" role="status">${escape(state?.status==='pending'?'Reading cloud gain envelope…':'Cloud gain envelope unavailable'+(state?.reason?': '+state.reason:''))}</span>`;
 if(hasState&&clip.offsetKnown===false)return '<span class="au-waveform-unavailable au-legacy-waveform-status" role="status">The coarse waveform does not expose its source window.</span>';
 return waveformSvg(clip,width,height,workspace.getProject().bpm,state?.envelope??envelope,options);
}

/** Repaint the legacy coarse-waveform SVG without replacing its clip body or
 * a captured envelope graph. No reads, cloud calls or PCM generation occur. */
export function paintLegacyWaveform(workspace,clip,element,overrides={}){
 const svg=element?.querySelector('.au-waveform'),placeholder=element?.querySelector('.au-legacy-waveform-status');if(!svg&&!placeholder)return false;
 const body=element.querySelector('.au-clip-body'),rect=body?.getBoundingClientRect(),box=svg?.getAttribute('viewBox')?.split(/\s+/).map(Number),width=rect?.width>0?rect.width:box?.[2]||Number.parseFloat(element.style.width),height=rect?.height>0?rect.height:box?.[3]||Math.max(1,(Number.parseFloat(element.closest('.au-track')?.style.height)||DEFAULT_TRACK_HEIGHT_PX)-42);
 if(!(width>0&&height>0))return false;
 const start=workspace.seconds(clip.start),envelope=overrides.envelope??workspace.envelopeView?.controller?.get(clip)?.envelope;
 const options={...(workspace.waveformOptions?.(clip)??waveformVisualOptions(workspace,clip)),startSec:Number(element.dataset.windowStartSec)-start,endSec:Number(element.dataset.windowEndSec)-start,...overrides};delete options.envelope;
 const markup=legacyWaveformMarkup(workspace,clip,width,height,envelope,options);
 if(!markup){(svg||placeholder).remove();return false;}
 const template=element.ownerDocument.createElement('template');template.innerHTML=markup;const fresh=template.content.firstElementChild;
 if(svg&&fresh.matches('.au-waveform')){svg.setAttribute('viewBox',fresh.getAttribute('viewBox'));svg.style.overflow='hidden';svg.innerHTML=fresh.innerHTML;}else (svg||placeholder).replaceWith(fresh);return true;
}
