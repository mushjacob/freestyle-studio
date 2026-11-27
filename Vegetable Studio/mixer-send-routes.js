/** FL route arrows for mixer sends: with a lane selected, every bus strip shows a small arrow at its bottom;
 * click it to send the selected lane there (post-fader), click again to remove the send. A routed arrow shows
 * FL's send level knob (0-200%) and a pre/post-fader tap; right-click opens the route menu. State comes from
 * mixer-sends.js (pure); every write goes through onToggle / onLevel / onTap (the app's undoable controller),
 * never straight to the engine. The strip view calls decorate() as it builds a strip and paint() after any
 * selection or model change; the DOM stays in place between paints.
 */
import {sendRouteView,sendRouteTitle,SEND_LABELS,SEND_DEFAULT_LEVEL,SEND_MAX_LEVEL,findSend,levelPercent,levelText,percentToLevel} from './mixer-sends.js';

const clone=value=>value==null?value:structuredClone(value);
/** Apply one view to one strip's parts (exported for tests). */
export function paintSendRoute(parts,view,{sourceName,destinationName}={}){
 const{root,button,range,output,tap}=parts;
 if(!view||!view.visible){root.hidden=true;root.dataset.state=view?.state||'none';return;}
 const routed=view.state==='routed';
 root.hidden=false;root.dataset.state=view.state;root.dataset.enabled=String(view.enabled);
 button.disabled=!view.enabled;button.setAttribute('aria-disabled',String(!view.enabled));button.setAttribute('aria-pressed',String(routed));
 button.title=sendRouteTitle(view,{sourceName,destinationName});
 button.setAttribute('aria-label',routed?SEND_LABELS.unroute:SEND_LABELS.route);
 range.hidden=output.hidden=tap.hidden=!routed;
 if(routed){
  range.disabled=tap.disabled=!view.enabled;range.title=view.enabled?`${SEND_LABELS.level} · double-click for 100%`:view.reason||'Unavailable';
  tap.textContent=view.preFader?'pre':'post';tap.setAttribute('aria-pressed',String(view.preFader===true));tap.title=view.enabled?`${view.preFader?SEND_LABELS.pre:SEND_LABELS.post} · click to switch`:view.reason||'Unavailable';
  if(parts.dragging!==true){range.value=String(levelPercent(view.level));output.textContent=levelText(view.level);range.setAttribute('aria-valuetext',levelText(view.level));}
 }
}
export function createSendRoutes({document=globalThis.document,getRows,getSelectedKey,getSends,isSupported,isEditable,onToggle,onLevel,onTap,onMenu=null,onError=()=>{}}={}){
 if(typeof getRows!=='function'||typeof getSelectedKey!=='function'||typeof getSends!=='function'||typeof onToggle!=='function'||typeof onLevel!=='function'||typeof onTap!=='function')throw new TypeError('Send routes need rows, selection, sends and write callbacks.');
 const items=new Map(),rowOf=key=>getRows().find(row=>row.key===key)??null;
 const viewFor=(source,destination)=>sendRouteView({source,destination,sends:getSends(),supported:isSupported(),editable:isEditable()});
 const fail=error=>{try{onError(error);}catch{}};
 const run=task=>{try{const result=task();if(result&&typeof result.catch==='function')result.catch(fail);}catch(error){fail(error);}};
 const make=(parent,tag,className)=>{const node=document.createElement(tag);node.className=className;parent.append(node);return node;};
 return{
  /** Called once per strip while the strip view renders it (the master gets no arrow). */
  decorate(strip,row){
   if(!strip||row.kind==='bus'&&row.id==='master')return null;
   const root=make(strip,'div','strip-send');root.dataset.stripSend=row.key;root.hidden=true;
   const button=make(root,'button','send-route');button.type='button';button.textContent='▼';
   const range=make(root,'input','send-level');range.type='range';range.min='0';range.max=String(SEND_MAX_LEVEL*100);range.step='1';range.value=String(levelPercent(SEND_DEFAULT_LEVEL));range.hidden=true;range.setAttribute('aria-label',SEND_LABELS.level);
   const output=make(root,'output','send-level-text');output.hidden=true;
   const tap=make(root,'button','send-tap');tap.type='button';tap.textContent='post';tap.hidden=true;
   const parts={root,button,range,output,tap,key:row.key,dragging:false};items.set(row.key,parts);
   const current=()=>{const source=rowOf(getSelectedKey()),destination=rowOf(row.key);return{source,destination,view:source&&destination?viewFor(source,destination):null};};
   for(const control of [button,tap])control.addEventListener('pointerdown',event=>event.stopPropagation());
   button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const{source,destination,view}=current();if(!view?.enabled)return;run(()=>onToggle({source:clone(source),destination:clone(destination),view}));});
   tap.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const{source,destination,view}=current();if(!view?.enabled||view.state!=='routed')return;run(()=>onTap({source:clone(source),destination:clone(destination),preFader:view.preFader!==true}));});
   for(const control of [button,range,tap])control.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();if(typeof onMenu!=='function')return;const{source,destination,view}=current();if(view?.visible)run(()=>onMenu({event,source:clone(source),destination:clone(destination),view}));});
   for(const name of ['pointerdown','click'])range.addEventListener(name,event=>event.stopPropagation());
   range.addEventListener('pointerdown',()=>{parts.dragging=true;});range.addEventListener('blur',()=>{if(parts.dragging){parts.dragging=false;this.paint();}});
   // Dragging only updates the readout; release commits one level write (setLaneSend has no live-only mode).
   range.addEventListener('input',()=>{const level=percentToLevel(Number(range.value));if(level!==null)output.textContent=levelText(level);});
   const commit=level=>{
    parts.dragging=false;const{source,destination,view}=current();
    if(!view?.enabled||view.state!=='routed'||level===null){this.paint();return;}
    const send=findSend(getSends(),source.id,destination.id);if(!send||Math.abs(send.level-level)<1e-6){this.paint();return;}
    run(()=>onLevel({source:clone(source),destination:clone(destination),level}));};
   range.addEventListener('change',()=>commit(percentToLevel(Number(range.value))));
   range.addEventListener('dblclick',event=>{event.preventDefault();range.value=String(levelPercent(SEND_DEFAULT_LEVEL));commit(SEND_DEFAULT_LEVEL);});
   return parts;
  },
  /** Repaint every decorated strip from the current selection, sends and engine support. */
  paint(){
   const source=rowOf(getSelectedKey());
   for(const[key,parts]of items){
    if(parts.root.isConnected===false){items.delete(key);continue;}
    const destination=rowOf(key);
    paintSendRoute(parts,source&&destination?viewFor(source,destination):null,{sourceName:source?.name||source?.id,destinationName:destination?.name||destination?.id});
   }
  },
  /** Forget strips that were replaced by a re-render. */
  reset(){items.clear();},
 };
}
