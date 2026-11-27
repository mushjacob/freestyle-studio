/** Illogic Amateur Classic — presentation helpers for the lighter "classic" skin (logic-classic.css).
 *
 * UI shell only: nothing here talks to the engine.
 *  - LCD: the bar number is padded with dim leading zeros ("001. 1").
 *  - Mixer: a label column (Setting, EQ, Input, Audio FX, Sends, Output, Automation, Pan, dB)
 *    left of the strips, aligned to the first strip's sections.
 *  - Inspector: a Quick Help section that shows the name and description (title) of the control
 *    under the pointer.
 */
const LABELS=Object.freeze([
 ['Setting','.logic-setting'],['Gain Reduction',null],['EQ','.logic-eq-thumb'],['MIDI FX','.logic-midi-fx, .logic-slot-spacer'],['Input','.logic-instrument, .logic-input'],
 ['Audio FX','.logic-audio-fx'],['Sends','.logic-sends, .logic-spacer-sends'],['Output','.logic-output'],['Group','.logic-group'],['Automation','.logic-automation-mode'],['Pan','.mixer-pan'],['dB','.strip-db']]);

/** "7" → 2 leading zeros, "12" → 1, "128" → 0 (three-digit bar field). */
export function lcdBarPad(text){const digits=String(text??'').trim();return /^\d{1,3}$/.test(digits)?3-digits.length:0;}

export function mountLcdPadding(document){
 const bar=document.querySelector('#lcd-bar');if(!bar)return()=>{};
 const paint=()=>{const pad=String(lcdBarPad(bar.textContent));if(bar.dataset.pad!==pad)bar.dataset.pad=pad;};
 paint();const Observer=document.defaultView?.MutationObserver;if(!Observer)return()=>{};
 const observer=new Observer(paint);observer.observe(bar,{childList:true,characterData:true,subtree:true});return()=>observer.disconnect();
}

/** The label column: one label per strip section, vertically centred on that section of the first visible strip. */
export function mountMixerLabels(document){
 const body=document.querySelector('#mixer .mixer-body'),host=document.querySelector('#mixer-strips');if(!body||!host)return()=>{};
 const column=document.createElement('div');column.className='lc-mixer-labels';column.setAttribute('aria-hidden','true');body.prepend(column);
 const win=document.defaultView;let frame=0;
 const layout=()=>{
  frame=0;const strip=[...host.querySelectorAll('.logic-channel-strip')].find(node=>node.getBoundingClientRect().height>0);
  if(!strip){column.replaceChildren();column.hidden=true;return;}
  column.hidden=false;const origin=column.getBoundingClientRect().top,nodes=[];let settingBottom=null,eqTop=null;
  for(const [text,selector]of LABELS){
   let top=null;
   if(selector){const target=strip.querySelector(selector);if(!target)continue;const rect=target.getBoundingClientRect();if(!(rect.height>0))continue;
    // Tall areas (Audio FX, Sends) are labelled at their first row.
    top=rect.top+Math.min(rect.height,18)/2;if(text==='Setting')settingBottom=rect.bottom;if(text==='EQ')eqTop=rect.top;}
   nodes.push({text,top});
  }
  // The gain-reduction meter sits between Setting and EQ.
  const meter=nodes.find(node=>node.text==='Gain Reduction');if(meter){if(settingBottom!==null&&eqTop!==null&&eqTop-settingBottom>=8)meter.top=(settingBottom+eqTop)/2;else nodes.splice(nodes.indexOf(meter),1);}
  column.replaceChildren(...nodes.map(({text,top})=>{const label=document.createElement('span');label.textContent=text;label.style.top=`${Math.round(top-origin)}px`;return label;}));
 };
 const schedule=()=>{if(!frame)frame=win.requestAnimationFrame(layout);};
 const Observer=win.MutationObserver,observer=Observer?new Observer(schedule):null;observer?.observe(host,{childList:true,subtree:true});
 const mixer=document.querySelector('#mixer');const shown=Observer?new Observer(schedule):null;if(mixer)shown?.observe(mixer,{attributes:true,attributeFilter:['class','style','data-mixer-filter']});
 win.addEventListener('resize',schedule);schedule();
 return()=>{observer?.disconnect();shown?.disconnect();win.removeEventListener('resize',schedule);column.remove();};
}

const QUICK_HELP_DEFAULT=Object.freeze({title:'Quick Help',text:'Move the pointer over a button, slider or area to show its name and what it does here.'});
/** What Quick Help shows for an element: its label and its description (title). */
export function quickHelpFor(element){
 const target=element?.closest?.('[title],[aria-label]');if(!target)return null;
 const describe=target.getAttribute('title')||'',label=target.getAttribute('aria-label')||'';
 // Name: the accessible label, else a plain button's own short caption, else the start of its description.
 const caption=target.children.length===0?(target.textContent||'').trim():'';
 const name=(label||(caption.length>0&&caption.length<=28?caption:'')||describe.split(/[·:(]/)[0]).trim().slice(0,60);
 if(!name&&!describe)return null;return{title:name||'Control',text:describe&&describe!==name?describe:''};
}
export function mountQuickHelp(document){
 const inspector=document.querySelector('#logic-inspector');if(!inspector)return()=>{};
 const section=document.createElement('details');section.className='logic-insp-section lc-quick-help';section.open=true;
 section.innerHTML='<summary><b>Quick Help</b></summary><div class="lc-quick-help-body" aria-live="off"><b></b><p></p></div>';
 inspector.prepend(section);const title=section.querySelector('.lc-quick-help-body b'),text=section.querySelector('.lc-quick-help-body p');
 const show=({title:name,text:body})=>{if(title.textContent!==name)title.textContent=name;if(text.textContent!==body)text.textContent=body;};show(QUICK_HELP_DEFAULT);
 const over=event=>{if(!section.open||inspector.offsetParent===null)return;if(section.contains(event.target))return;show(quickHelpFor(event.target)||QUICK_HELP_DEFAULT);};
 document.addEventListener('pointerover',over,{passive:true});
 return()=>{document.removeEventListener('pointerover',over);section.remove();};
}

export const LIBRARY_UNSUPPORTED=Object.freeze({
 revert:'Revert: loading a patch is saved to the track at once in Freestyle. Use Undo (⌘Z) to go back to the previous patch.',
 remove:'Delete: Freestyle’s patch catalog is read-only; there are no user patches to delete.',
 save:'Save…: Freestyle has no user patch library to save the track’s current sound into.'});
/** The Library pane's footer row. Freestyle has no user-patch store, so the three actions are shown disabled with the reason. */
export function mountLibraryFooter(document){
 const pane=document.querySelector('.main-layout>aside.browser');if(!pane)return()=>{};
 const footer=document.createElement('div');footer.className='lc-library-footer';footer.setAttribute('role','group');footer.setAttribute('aria-label','Library patch actions');
 const button=(text,title)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.disabled=true;node.title=title;return node;};
 const spacer=document.createElement('span');spacer.className='lc-library-spacer';
 footer.append(button('Revert',LIBRARY_UNSUPPORTED.revert),spacer,button('Delete',LIBRARY_UNSUPPORTED.remove),button('Save…',LIBRARY_UNSUPPORTED.save));pane.append(footer);
 return()=>footer.remove();
}

export function mountClassicSkin(document=globalThis.document){
 if(!document?.body)return()=>{};document.documentElement.classList.add('logic-classic');
 const undo=[mountLcdPadding(document),mountMixerLabels(document),mountQuickHelp(document),mountLibraryFooter(document)];
 return()=>{for(const stop of undo)try{stop();}catch{}};
}
if(typeof window!=='undefined'&&window.document){
 const start=()=>mountClassicSkin(window.document);
 if(window.document.readyState==='loading')window.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
}
