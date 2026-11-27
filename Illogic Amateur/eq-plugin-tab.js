/** The native EQ slot's plugin-window tab: typed bands (getLaneEq / setLaneEqBand)
 * with one history step per committed band edit and exact restore on undo/redo. */
import {LaneEqController,EqEditorView,eqSupported,studioEqSender,describeEqBand} from './eq-editor.js';

const identity=plugin=>plugin?.instance_id??plugin?.instanceId??plugin?.id??null;
const typeOf=plugin=>plugin?.type_id??plugin?.typeId??plugin?.type??null;
export const isNativeEqPlugin=plugin=>typeOf(plugin)==='native-eq';
// Persisted EQ band writes in flight (history presses queue behind them: app.js historyEditInFlight).
let inFlight=0;export const eqEditsInFlight=()=>inFlight>0;

/** Returns {controller, view} when mounted, or null when this plugin window has no typed EQ. */
export function mountPluginEqTab({dialog,content,controller,plugin,channel,fetch,historyFetch,history,historyScope=()=>undefined,onError=()=>{},log=()=>{},bypass=null,onExtended=null,name='Channel EQ',document:doc=globalThis.document}={}){
 if(!controller?.isRestMode||controller.target?.kind!=='lane'||!eqSupported(controller.operations)||!isNativeEqPlugin(plugin)||typeof identity(plugin)!=='string')return null;
 const tabs=content.querySelector('.plugin-window-tabs');if(!tabs)return null;
 const tab=doc.createElement('button');tab.type='button';tab.setAttribute('role','tab');tab.dataset.pluginTab='eq';tab.textContent='EQ';tabs.prepend(tab);
 // The plugin window is position:fixed with no width (shrink-to-fit) and overflow:auto (fl-native-dialogs.css:15, :100):
 // its width followed its content, plus a scrollbar whenever content overflowed during a drag. Pin it.
 // The EQ panel pins its own width (EqEditorView.layout), so the window just hugs it.
 dialog.style.maxWidth='calc(100vw - 12px)';dialog.classList?.add('logic-eq-window');
 const panel=doc.createElement('div');panel.className='plugin-eq-panel';panel.setAttribute('role','tabpanel');panel.textContent='Reading the EQ bands from Freestyle…';tabs.after(panel);
 const scope={projectId:controller.projectId,laneId:controller.target.id,trackId:controller.context().track_id??null,instanceId:identity(plugin)};
 const make=(send,hooks={})=>new LaneEqController({send,...scope,...hooks,log});
 const isOpen=()=>dialog.isConnected&&dialog.open!==false;
 let eq;

 const apply=band=>async(from,to)=>{
  // A fresh, history-scoped writer: checks the band still holds `from`, writes `to`, reads it back.
  // The open view adopts the confirmed band at once (its own fetch is not history-scoped).
  const writer=make(studioEqSender(historyFetch()));const confirmed=await writer.applyExact(from,to);
  if(isOpen())eq.adopt(confirmed);log('eq-band-history',{laneId:scope.laneId,band,to:describeEqBand(confirmed)});return{laneId:scope.laneId,band,value:confirmed};
 };
 const step=({band,before,after})=>({undo:()=>apply(band)(after,before),redo:()=>apply(band)(before,after),detail:{laneId:scope.laneId,instanceId:scope.instanceId,band,before,after}});
 const label=band=>`EQ band ${band+1} – ${channel?.name||'Track'}`;
 // Release: open the step optimistically before the write (⌘Z meanwhile waits for it).
 const onBegin=({band})=>{inFlight++;let token=null;try{token=history?.beginExternalStep?.({kind:'eq_band',label:label(band)})??null;}catch{token=null;}return{token};};
 const settle=reserved=>{if(reserved)inFlight=Math.max(0,inFlight-1);};
 const onCommit=({band,before,after,token})=>{
  settle(token);const pending=token?.token;
  if(pending)history.finishExternalStep(pending,step({band,before,after}));
  else history?.recordExternalStep?.({kind:'eq_band',label:label(band),scope:historyScope(),...step({band,before,after})});
 };
 const onFail=({token,error})=>{settle(token);if(token?.token)history.failExternalStep(token.token,error);};
 eq=make(studioEqSender(fetch),{onBegin,onCommit,onFail});
 // Outside changes: re-read when the window regains focus (not mid-drag, at most every 2 s).
 let lastRead=0;dialog.addEventListener?.('focusin',()=>{const now=Date.now();if(now-lastRead<2000||eq.drag||inFlight)return;lastRead=now;eq.load().catch(()=>{});});
 const view=new EqEditorView({controller:eq,onError,document:doc,bypass,onExtended,name});
 eq.load().then(()=>{if(!isOpen())return;view.mount(panel);},error=>{panel.textContent=error.message;log('eq-load-error',{laneId:scope.laneId,code:error?.code??null,status:error?.status??null});});
 dialog.addEventListener?.('close',()=>view.destroy?.(),{once:true});
 return{controller:eq,view,tab,panel};
}

/** The lane EQ STAGE (no plug-in slot) in its own Channel EQ window: the same view and history steps as the
 * native EQ insert, addressed without plugin_index. Returns {controller, view, panel, destroy}. */
export function mountLaneEqWindow({dialog,content,projectId,laneId,trackId=null,laneName='Track',fetch,historyFetch,history,historyScope=()=>undefined,onError=()=>{},log=()=>{},document:doc=globalThis.document}={}){
 const panel=doc.createElement('div');panel.className='plugin-eq-panel';panel.setAttribute('role','group');panel.setAttribute('aria-label',`Channel EQ – ${laneName}`);panel.textContent='Reading the EQ bands from Freestyle…';content.append(panel);
 const scope={projectId,laneId,trackId,instanceId:null};const make=(send,hooks={})=>new LaneEqController({send,...scope,...hooks,log});
 const isOpen=()=>dialog.isConnected&&dialog.open!==false;let eq;
 const apply=band=>async(from,to)=>{const writer=make(studioEqSender(historyFetch()));const confirmed=await writer.applyExact(from,to);if(isOpen())eq.adopt(confirmed);log('eq-band-history',{laneId,band,to:describeEqBand(confirmed)});return{laneId,band,value:confirmed};};
 const step=({band,before,after})=>({undo:()=>apply(band)(after,before),redo:()=>apply(band)(before,after),detail:{laneId,band,before,after,section:'channel-eq'}});
 const label=band=>`EQ band ${band+1} – ${laneName}`;
 const onBegin=({band})=>{inFlight++;let token=null;try{token=history?.beginExternalStep?.({kind:'eq_band',label:label(band)})??null;}catch{token=null;}return{token};};
 const settle=reserved=>{if(reserved)inFlight=Math.max(0,inFlight-1);};
 const onCommit=({band,before,after,token})=>{settle(token);const pending=token?.token;if(pending)history.finishExternalStep(pending,step({band,before,after}));else history?.recordExternalStep?.({kind:'eq_band',label:label(band),scope:historyScope(),...step({band,before,after})});};
 const onFail=({token,error})=>{settle(token);if(token?.token)history.failExternalStep(token.token,error);};
 eq=make(studioEqSender(fetch),{onBegin,onCommit,onFail});
 let lastRead=0;dialog.addEventListener?.('focusin',()=>{const now=Date.now();if(now-lastRead<2000||eq.drag||inFlight)return;lastRead=now;eq.load().catch(()=>{});});
 const view=new EqEditorView({controller:eq,onError,document:doc});
 const ready=eq.load().then(()=>{if(isOpen())view.mount(panel);},error=>{panel.textContent=error.message;log('eq-load-error',{laneId,code:error?.code??null,status:error?.status??null});});
 const destroy=()=>view.destroy?.();dialog.addEventListener?.('close',destroy,{once:true});
 return{controller:eq,view,panel,ready,destroy};
}
