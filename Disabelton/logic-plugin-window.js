/**
 * Logic Pro plug-in window chrome around the existing Freestyle plug-in window
 * (engine GUI mirror + typed parameter page, built in app.js pluginDialog).
 *
 * Logic's window: the title bar shows the track name; the header row has the
 * power (bypass) button, the Setting ▾ (presets) menu, ◀ ▶ preset stepping,
 * Compare, Copy, Paste, the View size, and the Controls/Editor switch.
 * This module adds only that chrome. Plug-in input keeps going through the
 * untouched GUI mirror (REST pointer path, coalescing, one Undo step per
 * gesture); "Editor" and "Controls" just switch the existing panels.
 */
export const LOGIC_PLUGIN_UNSUPPORTED=Object.freeze({
 presets:'Plug-in presets: Freestyle has no preset list or preset-load API for lane plug-ins.',
 compare:'Compare: Freestyle has no saved-versus-edited plug-in state comparison.',
 copy:'Copy/Paste settings: Freestyle has no plug-in settings clipboard. Setting ▸ “Copy effects chain…” copies a whole chain to another track.',
});
export const LOGIC_PLUGIN_VIEWS=Object.freeze([.5,.75,1,1.25,1.5,2]);
function button(document,className,text,{title='',disabled=false,label=null}={}){const node=document.createElement('button');node.type='button';node.className=className;node.textContent=text;if(title)node.title=title;if(label)node.setAttribute('aria-label',label);node.disabled=!!disabled;return node;}
/**
 * dialog: the plug-in <dialog>; content: its .dialog-content.
 * options: {trackName, pluginName, tabs:{show(name), current()}, hasTab(name),
 *   bypass:{state()→{known,bypassed,busy}, toggle()→Promise}, menu(event,items),
 *   settingItems()→extra Setting menu items, onError(error)}
 */
export function mountLogicPluginHeader(dialog,content,options={}){
 const document=dialog.ownerDocument,fail=error=>{try{options.onError?.(error);}catch{}};
 dialog.classList.add('logic-plugin-window');
 // Logic: the window title is the track's name.
 const header=dialog.querySelector(':scope > header');
 if(header&&options.trackName){const close=header.querySelector('button');const title=document.createElement('span');title.className='logic-plugin-title';title.textContent=options.trackName;header.replaceChildren(title,...close?[close]:[]);dialog.setAttribute('aria-label',`${options.pluginName||'Plug-in'} on ${options.trackName}`);}
 const bar=document.createElement('div');bar.className='logic-plugin-header';
 const power=button(document,'logic-plugin-power','⏻',{label:`${options.pluginName||'Plug-in'} on/off`});
 const paintPower=()=>{let state={};try{state=options.bypass?.state?.()||{};}catch{}power.disabled=!state.known||!!state.busy||typeof options.bypass?.toggle!=='function';power.classList.toggle('on',state.known&&!state.bypassed);power.setAttribute('aria-pressed',state.known?String(!state.bypassed):'mixed');power.title=state.known?`${state.bypassed?'Turn on':'Bypass'} ${options.pluginName||'plug-in'}`:'Bypass state not read yet (open the strip’s slot menu to read it)';};
 power.onclick=()=>{if(power.disabled)return;power.disabled=true;Promise.resolve().then(()=>options.bypass.toggle()).catch(fail).finally(paintPower);};
 const setting=button(document,'logic-plugin-setting','Setting ▾',{title:'Plug-in settings'});
 setting.onclick=event=>{let extra=[];try{extra=options.settingItems?.()||[];}catch(error){fail(error);}options.menu?.(event,[{label:'Default',disabled:true,title:LOGIC_PLUGIN_UNSUPPORTED.presets},{label:'Save As…',disabled:true,title:LOGIC_PLUGIN_UNSUPPORTED.presets},...extra.length?[null,...extra]:[]]);};
 const previous=button(document,'logic-plugin-prev','◀',{title:LOGIC_PLUGIN_UNSUPPORTED.presets,disabled:true,label:'Previous setting'}),next=button(document,'logic-plugin-next','▶',{title:LOGIC_PLUGIN_UNSUPPORTED.presets,disabled:true,label:'Next setting'});
 const compare=button(document,'logic-plugin-compare','Compare',{title:LOGIC_PLUGIN_UNSUPPORTED.compare,disabled:true});
 const copy=button(document,'logic-plugin-copy','Copy',{title:LOGIC_PLUGIN_UNSUPPORTED.copy,disabled:true}),paste=button(document,'logic-plugin-paste','Paste',{title:LOGIC_PLUGIN_UNSUPPORTED.copy,disabled:true});
 const name=document.createElement('span');name.className='logic-plugin-name';name.textContent=options.pluginName||'Plug-in';
 // View: scales the plug-in panel; the mirror maps input from its on-screen rectangle, so input is unchanged.
 let view=1;const viewButton=button(document,'logic-plugin-view','View: 100% ▾',{title:'Plug-in window size'});
 const setView=value=>{view=value;dialog.style.setProperty('--logic-plugin-view',String(value));viewButton.textContent=`View: ${Math.round(value*100)}% ▾`;};
 viewButton.onclick=event=>options.menu?.(event,LOGIC_PLUGIN_VIEWS.map(value=>({label:`${Math.round(value*100)}%`,checked:value===view,run:()=>setView(value)})));
 const modes=document.createElement('div');modes.className='logic-plugin-modes';modes.setAttribute('role','group');modes.setAttribute('aria-label','Plug-in view');
 const editorTab=()=>options.hasTab?.('eq')?'eq':'gui';
 const controls=button(document,'logic-plugin-controls','Controls',{title:'Generic parameter view'}),editor=button(document,'logic-plugin-editor','Editor',{title:'Plug-in editor'});
 const paintModes=()=>{let tab='';try{tab=options.tabs?.current?.()||'';}catch{}const onControls=tab==='parameters';controls.classList.toggle('selected',onControls);editor.classList.toggle('selected',!onControls);controls.setAttribute('aria-pressed',String(onControls));editor.setAttribute('aria-pressed',String(!onControls));};
 controls.onclick=()=>{try{options.tabs?.show?.('parameters');}catch(error){fail(error);}paintModes();};
 editor.onclick=()=>{try{options.tabs?.show?.(editorTab());}catch(error){fail(error);}paintModes();};
 modes.append(editor,controls);
 const left=document.createElement('div');left.className='logic-plugin-header-left';left.append(power,setting,previous,next,compare,copy,paste);
 const right=document.createElement('div');right.className='logic-plugin-header-right';right.append(viewButton);
 const second=document.createElement('div');second.className='logic-plugin-subheader';second.append(name,modes);
 bar.append(left,right);content.prepend(bar,second);
 setView(1);paintPower();paintModes();
 // Any panel switch (e.g. opening the original GUI) keeps the Controls/Editor switch in step.
 const Observer=document.defaultView?.MutationObserver||globalThis.MutationObserver;if(Observer){const observer=new Observer(()=>paintModes());observer.observe(dialog,{attributes:true,attributeFilter:['data-plugin-tab']});dialog.addEventListener('close',()=>observer.disconnect(),{once:true});}
 return{element:bar,repaint(){paintPower();paintModes();},setView,get view(){return view;}};
}
