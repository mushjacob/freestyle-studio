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
export const LOGIC_PLUGIN_NO_PROGRAMS='This plug-in reports no factory programs to Freestyle, so there is no previous or next setting to step to.';
/** Previous / Next setting over a plug-in's reported programs (wraps at both ends, as Logic's ◀ ▶ do). null = nothing to step. */
export function programStep({count,current}={},direction=1){
 if(!Number.isInteger(count)||count<2||count>4096)return null;
 const at=Number.isInteger(current)&&current>=0&&current<count?current:direction>0?-1:0;
 return ((at+(direction>0?1:-1))%count+count)%count;
}
/** A program's display name ("Program 3" when the plug-in names none). */
export function programName(programs,index){const found=(Array.isArray(programs)?programs:[]).find(program=>program?.index===index);return typeof found?.name==='string'&&found.name.trim()?found.name.trim():`Program ${index+1}`;}
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
 // Programs the plug-in reports (options.programs: state()→{count,current,programs,busy}, select(index)→Promise) are its
 // settings: the Setting menu lists them and ◀ ▶ step through them. A plug-in without programs keeps both disabled.
 const programState=()=>{let state=null;try{state=options.programs?.state?.()||null;}catch{}const count=Number.isInteger(state?.count)&&state.count>0&&state.count<=4096?state.count:0;return{count,current:Number.isInteger(state?.current)?state.current:null,programs:Array.isArray(state?.programs)?state.programs:[],busy:!!state?.busy};};
 let selecting=false;
 const selectProgram=index=>{if(selecting||typeof options.programs?.select!=='function')return;selecting=true;paintPrograms();Promise.resolve().then(()=>options.programs.select(index)).catch(fail).finally(()=>{selecting=false;paintPrograms();});};
 setting.onclick=event=>{let extra=[];try{extra=options.settingItems?.()||[];}catch(error){fail(error);}const state=programState(),shown=Math.min(state.count,128);
  const programs=state.count?[null,...Array.from({length:shown},(_,index)=>({label:programName(state.programs,index),checked:index===state.current,disabled:state.busy||selecting,run:()=>selectProgram(index)})),...(state.count>shown?[{label:`… ${state.count-shown} more (step with ◀ ▶)`,disabled:true}]:[])]:[];
  options.menu?.(event,[{label:'Default',disabled:true,title:LOGIC_PLUGIN_UNSUPPORTED.presets},{label:'Save As…',disabled:true,title:LOGIC_PLUGIN_UNSUPPORTED.presets},...programs,...extra.length?[null,...extra]:[]]);};
 const previous=button(document,'logic-plugin-prev','◀',{title:LOGIC_PLUGIN_NO_PROGRAMS,disabled:true,label:'Previous setting'}),next=button(document,'logic-plugin-next','▶',{title:LOGIC_PLUGIN_NO_PROGRAMS,disabled:true,label:'Next setting'});
 function paintPrograms(){const state=programState(),can=state.count>1&&!state.busy&&!selecting&&typeof options.programs?.select==='function';
  for(const [node,direction]of [[previous,-1],[next,1]]){const target=programStep(state,direction);node.disabled=!can||target===null;node.title=state.count>1?`${direction<0?'Previous':'Next'} setting${target===null?'':`: ${programName(state.programs,target)}`}`:LOGIC_PLUGIN_NO_PROGRAMS;}
  setting.textContent=`${state.count&&state.current!==null?programName(state.programs,state.current):'Setting'} ▾`;}
 previous.onclick=()=>{const target=programStep(programState(),-1);if(target!==null)selectProgram(target);};next.onclick=()=>{const target=programStep(programState(),1);if(target!==null)selectProgram(target);};
 // Link: with Link on, the window follows the selected track and shows the plug-in in the same slot of its channel strip.
 const link=button(document,'logic-plugin-link','⛓',{title:'Link: follow the selected track (show the plug-in in the same slot of its channel strip)',label:'Link'});
 const paintLink=()=>{let on=false;try{on=!!options.link?.state?.();}catch{}link.disabled=typeof options.link?.toggle!=='function';link.classList.toggle('on',on);link.setAttribute('aria-pressed',String(on));if(link.disabled)link.title='Link: this window cannot follow the track selection.';};
 link.onclick=()=>{try{options.link.toggle();}catch(error){fail(error);}paintLink();};
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
 const right=document.createElement('div');right.className='logic-plugin-header-right';right.append(viewButton,link);
 const second=document.createElement('div');second.className='logic-plugin-subheader';second.append(name,modes);
 bar.append(left,right);content.prepend(bar,second);
 setView(1);paintPower();paintModes();paintPrograms();paintLink();
 // Any panel switch (e.g. opening the original GUI) keeps the Controls/Editor switch in step.
 const Observer=document.defaultView?.MutationObserver||globalThis.MutationObserver;if(Observer){const observer=new Observer(()=>paintModes());observer.observe(dialog,{attributes:true,attributeFilter:['data-plugin-tab']});dialog.addEventListener('close',()=>observer.disconnect(),{once:true});}
 return{element:bar,repaint(){paintPower();paintModes();paintPrograms();paintLink();},setView,get view(){return view;}};
}
