/**
 * Disabelton devices-lane engine tools: stem separation (abl-stems.js), the project Scale chooser (abl-scale.js) and
 * the shared seams the Device View presets use (Studio API client + one global history step).
 *
 *  window.ablEngineTools = {studioClient(), recordStep({kind,label,undo,redo,detail}) → bool, stems, scale}
 *  window.ablStems.clipMenuItems(clip, guard) → context-menu items for an audio clip (the shell's clip menu calls it)
 *  window.ablScale (see abl-scale.js) + 'abl:scale-change'
 *
 * hooks (app.js): document, studioClient(), projectId(), rawProject(), history(), refresh(), etag(), reloadEngine(detail),
 *  menu(event, items), toast, fail, log, status(text), detectTrackId().
 */
import {AblStems} from './abl-stems.js';
import {installAblScale} from './abl-scale.js';

export function installAblEngineTools(hooks={}){
 const document=hooks.document||globalThis.document,window=document.defaultView||globalThis;
 const studioClient=()=>{try{return hooks.studioClient?.()??null;}catch{return null;}};
 const history=()=>{try{return hooks.history?.()??null;}catch{return null;}};
 const stems=new AblStems({client:studioClient,projectId:()=>hooks.projectId?.()??null,history,refresh:()=>hooks.refresh?.(),etag:()=>hooks.etag?.()??null,reloadEngine:detail=>hooks.reloadEngine?.(detail),
  status:text=>{try{if(hooks.status)hooks.status(text);else{const node=document.querySelector('#status-message');if(node)node.textContent=text;}}catch{}},toast:text=>hooks.toast?.(text),log:(kind,data)=>hooks.log?.(kind,data),fail:error=>hooks.fail?.(error)});
 const scale=installAblScale({document,client:studioClient,projectId:()=>hooks.projectId?.()??null,rawProject:()=>hooks.rawProject?.()??null,history,menu:(event,items)=>hooks.menu?.(event,items),toast:text=>hooks.toast?.(text),fail:error=>hooks.fail?.(error),log:(kind,data)=>hooks.log?.(kind,data),detectTrackId:()=>hooks.detectTrackId?.()??null,
  // menu runs reject into the app's fail(); direct API calls return their promise.
 });
 // A newly opened project repaints the chooser with its saved key (cheap: compares the project id).
 const timer=setInterval(()=>{try{scale.sync();scale.mount();}catch{}},1000);timer?.unref?.();/* never keeps a test runner alive */
 const recordStep=step=>{const h=history();if(!h?.recordExternalStep)return false;try{return h.recordExternalStep(step);}catch(error){try{hooks.log?.('abl-history-step-error',{kind:step?.kind,message:String(error?.message||error).slice(0,160)});}catch{}return false;}};
 const api={studioClient,recordStep,stems,scale:scale.api};
 window.ablEngineTools=api;
 window.ablStems={clipMenuItems:(clip,guard)=>stems.menuItems(clip,guard),run:(clip,mode)=>stems.run(clip,mode),get busy(){return !!stems.job;},cancel:()=>stems.cancel()};
 return{api,stems,scale,destroy(){clearInterval(timer);scale.observer?.disconnect?.();if(window.ablEngineTools===api)delete window.ablEngineTools;delete window.ablStems;delete window.ablScale;}};
}
