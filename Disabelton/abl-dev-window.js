/**
 * Disabelton (Live-style) plug-in window chrome around the existing Freestyle
 * plug-in window built by app.js pluginDialog (engine GUI mirror over
 * mozart-editor frames with its channel/REST input fallback, plus the typed
 * parameter page). This adds only Live's chrome; input and writes are untouched.
 *
 * Live's floating plug-in window: title "<Track>/<Device>", a small header with
 * the device activator (orange = on), the device name, "Configure" (here: the
 * plug-in's typed parameter list, Live's configure/parameter view) and the
 * Expand toggle (window size). The GUI mirror is the default panel.
 *
 * options: {trackName, pluginName, tabs:{show(name), current()}, hasTab(name),
 *   bypass:{state()→{known,bypassed,busy}, toggle()→Promise}, menu(event,items), onError(error)}
 */
export const ABL_PLUGIN_SCALES=Object.freeze([1,1.5,2]);
function button(document,className,text,{title='',label=null}={}){const node=document.createElement('button');node.type='button';node.className=className;node.textContent=text;if(title)node.title=title;if(label)node.setAttribute('aria-label',label);return node;}
export function mountAblPluginHeader(dialog,content,options={}){
 const document=dialog.ownerDocument,fail=error=>{try{options.onError?.(error);}catch{}},pluginName=options.pluginName||'Plug-in',trackName=options.trackName||'Main';
 dialog.classList.add('abl-plugin-window');
 const header=dialog.querySelector(':scope > header');
 if(header){const close=header.querySelector('button');// Live's "<Track>/<Device>" title; the track part keeps the fork's .logic-plugin-title hook (tests, window registry).
  const title=document.createElement('span');title.className='abl-plugin-title';const track=document.createElement('span');track.className='logic-plugin-title';track.textContent=trackName;title.append(track,document.createTextNode(`/${pluginName}`));header.replaceChildren(title,...close?[close]:[]);}
 dialog.setAttribute('aria-label',`${pluginName} on ${trackName}`);
 const bar=document.createElement('div');bar.className='abl-plugin-header';
 const power=button(document,'abl-plugin-activator logic-plugin-power','',{label:`${pluginName} on/off`});
 const paintPower=()=>{let state={};try{state=options.bypass?.state?.()||{};}catch{}power.disabled=!state.known||!!state.busy||typeof options.bypass?.toggle!=='function';power.classList.toggle('on',!!state.known&&!state.bypassed);power.setAttribute('aria-pressed',state.known?String(!state.bypassed):'mixed');power.title=state.known?`${state.bypassed?'Activate':'Deactivate'} ${pluginName}`:'Reading the device’s on/off state…';};
 power.onclick=()=>{if(power.disabled)return;power.disabled=true;Promise.resolve().then(()=>options.bypass.toggle()).catch(fail).finally(paintPower);};
 const name=document.createElement('span');name.className='abl-plugin-name logic-plugin-name';name.textContent=pluginName;
 const editorTab=()=>options.hasTab?.('eq')?'eq':'gui';
 const configure=button(document,'abl-plugin-configure','Configure',{title:'Show the plug-in’s parameters (Live’s Configure view)'});
 const paintConfigure=()=>{let tab='';try{tab=options.tabs?.current?.()||'';}catch{}const on=tab==='parameters';configure.classList.toggle('on',on);configure.setAttribute('aria-pressed',String(on));};
 configure.onclick=()=>{let tab='';try{tab=options.tabs?.current?.()||'';}catch{}try{options.tabs?.show?.(tab==='parameters'?editorTab():'parameters');}catch(error){fail(error);}paintConfigure();};
 let scale=1;const expand=button(document,'abl-plugin-expand','⤢',{title:'Expand the plug-in window',label:'Expand'});
 const setScale=value=>{scale=value;dialog.style.setProperty('--logic-plugin-view',String(value));dialog.style.setProperty('--abl-plugin-scale',String(value));expand.classList.toggle('on',value!==1);expand.title=value===1?'Expand the plug-in window':`Plug-in window at ${Math.round(value*100)}%`;};
 expand.onclick=()=>setScale(ABL_PLUGIN_SCALES[(ABL_PLUGIN_SCALES.indexOf(scale)+1)%ABL_PLUGIN_SCALES.length]);
 bar.append(power,name,configure,expand);content.prepend(bar);
 // The old tab strip stays in the DOM for the window's own logic, hidden behind Live's chrome.
 const tabs=content.querySelector('.plugin-window-tabs');if(tabs)tabs.hidden=true;
 setScale(1);paintPower();paintConfigure();
 const Observer=document.defaultView?.MutationObserver||globalThis.MutationObserver;if(Observer){const observer=new Observer(()=>paintConfigure());observer.observe(dialog,{attributes:true,attributeFilter:['data-plugin-tab']});dialog.addEventListener('close',()=>observer.disconnect(),{once:true});}
 return{element:bar,repaint(){paintPower();paintConfigure();},setScale,get scale(){return scale;}};
}
