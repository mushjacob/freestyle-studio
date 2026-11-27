/** FL-style plug-in wrapper chrome for a plug-in window (display + navigation only).
 *  Title bar, left to right like FL's wrapper: options menu arrow, settings gear
 *  (the typed parameter page), plug-in name, preset selector (◀ name ▶) and the
 *  window buttons. The mirrored GUI below it is fitted to the frame's own size. */
export function presetStep(current,count,direction){
 if(!Number.isInteger(count)||count<=0)return null;
 const index=Number.isInteger(current)&&current>=0&&current<count?current:direction>0?-1:0;
 return((index+direction)%count+count)%count;
}
/** Window width that fits a mirrored frame (natural px) inside the viewport. */
export function fittedWindowWidth(frameWidth,{viewportWidth=1280,padding=34,min=360}={}){
 if(!Number.isFinite(frameWidth)||frameWidth<=0)return null;
 return Math.round(Math.max(min,Math.min(viewportWidth-24,frameWidth+padding)));
}
export function decoratePluginWindow(dialog,{name='Plugin',onTab=()=>{},getPrograms=()=>null,setProgram=null,onMenu=null,document:doc=dialog?.ownerDocument||globalThis.document,viewport=()=>globalThis.innerWidth||1280}={}){
 const header=dialog?.querySelector?.('header');if(!header||header.dataset.flWrapper==='true')return null;
 header.dataset.flWrapper='true';dialog.classList.add('fl-plugin-wrapper');
 const make=(tag,className,text,title)=>{const node=doc.createElement(tag);node.className=className;if(text!=null)node.textContent=text;if(title){node.title=title;node.setAttribute('aria-label',title);}if(tag==='button')node.type='button';return node;};
 const close=header.querySelector('button');
 const menu=make('button','plugin-wrapper-menu','▸','Plug-in options'),gear=make('button','plugin-wrapper-gear','⚙','Detailed settings: parameter list');
 const title=make('span','plugin-wrapper-title',null);
 // Keep the dialog's own title text node content inside a span so the buttons can sit around it.
 for(const node of [...header.childNodes])if(node!==close){title.append(node);}
 if(!title.textContent.trim())title.textContent=name;
 const presets=make('span','plugin-wrapper-presets'),previous=make('button','plugin-wrapper-preset-prev','◀','Previous preset'),label=make('span','plugin-wrapper-preset-name','Presets'),next=make('button','plugin-wrapper-preset-next','▶','Next preset');
 presets.append(previous,label,next);
 header.replaceChildren(menu,gear,title,presets,...(close?[close]:[]));
 let showingParameters=dialog.dataset.pluginTab==='parameters',busy=false;
 gear.setAttribute('aria-pressed',String(showingParameters));
 gear.onclick=()=>{showingParameters=dialog.dataset.pluginTab!=='parameters';onTab(showingParameters?'parameters':'gui');gear.setAttribute('aria-pressed',String(showingParameters));};
 if(typeof onMenu==='function')menu.onclick=event=>onMenu(event,menu);else menu.disabled=true;
 const paint=()=>{
  const state=getPrograms()||null,count=state?.count,usable=Number.isInteger(count)&&count>0&&typeof setProgram==='function';
  previous.disabled=next.disabled=!usable||busy;
  label.textContent=usable?(state.name||`Preset ${Number.isInteger(state.current)?state.current+1:'–'} / ${count}`):'Presets';
  presets.title=usable?'Factory presets of this plug-in':'This plug-in reports no factory presets. Use the presets inside its own GUI.';
 };
 const step=direction=>async()=>{const state=getPrograms();const target=presetStep(state?.current,state?.count,direction);if(target===null||busy)return;busy=true;paint();try{await setProgram(target);}finally{busy=false;paint();}};
 previous.onclick=step(-1);next.onclick=step(1);paint();
 // Fit the window to the mirrored GUI once its first frame arrives (and when the plug-in resizes it).
 const fit=image=>{const width=fittedWindowWidth(image.naturalWidth||image.width,{viewportWidth:viewport()});if(width&&dialog.dataset.pluginTab!=='parameters'){dialog.style.width=`${width}px`;const rect=dialog.getBoundingClientRect?.();if(rect&&rect.right>viewport()-6)dialog.style.left=`${Math.max(6,viewport()-width-12)}px`;}};
 dialog.addEventListener('load',event=>{const image=event.target;if(image?.classList?.contains('plugin-gui-frame'))fit(image);},true);
 return{paint,fit,elements:{menu,gear,title,presets,previous,next,label}};
}
