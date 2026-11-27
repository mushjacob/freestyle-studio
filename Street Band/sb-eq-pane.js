/** Street Band Smart Controls ▸ EQ: the track's lane EQ stage (typed getLaneEq / setLaneEqBand, the
 * same contract as the EQ plug-in window) shown as the Channel-EQ-style graph embedded in the pane.
 * A drag sends persist:false engine ticks; the release writes persist:true and is ONE history step
 * ("EQ band 3 – Bass") with exact restore on Undo / Redo. Nothing is drawn before a typed read of
 * this lane's bands. */
import {LaneEqController,EqEditorView,studioEqSender,describeEqBand} from './eq-editor.js';

let inFlight=0;
/** Persisted pane EQ writes in flight (history presses can wait for them). */
export const streetBandEqInFlight=()=>inFlight>0;

export function mountStreetBandEq({projectId,laneId,trackId=null,laneName='Track',fetch,historyFetch=()=>fetch,history=null,historyScope=()=>undefined,log=()=>{},onError=()=>{},document:doc=globalThis.document}={}){
 const element=doc.createElement('div');element.className='sb-eq-pane';element.setAttribute('aria-label',`EQ – ${laneName}`);
 const note=doc.createElement('p');note.className='sb-eq-note';note.setAttribute('role','status');note.textContent='Reading the EQ bands from Freestyle…';element.append(note);
 const scope={projectId,laneId,trackId};let destroyed=false,eq,view=null;
 const make=(send,hooks={})=>new LaneEqController({send,...scope,...hooks,log});
 const apply=band=>async(from,to)=>{
  // A fresh, history-scoped writer: checks the band still holds `from`, writes `to`, reads it back.
  const writer=make(studioEqSender(historyFetch())),confirmed=await writer.applyExact(from,to);
  if(!destroyed)eq.adopt(confirmed);log('eq-band-history',{laneId,band,to:describeEqBand(confirmed),pane:'smart-controls'});return{laneId,band,value:confirmed};
 };
 const step=({band,before,after})=>({undo:()=>apply(band)(after,before),redo:()=>apply(band)(before,after),detail:{laneId,band,before,after,section:'smart-controls'}});
 const label=band=>`EQ band ${band+1} – ${laneName}`;
 const settle=()=>{inFlight=Math.max(0,inFlight-1);};
 const onBegin=({band})=>{inFlight++;let token=null;try{token=history?.beginExternalStep?.({kind:'eq_band',label:label(band)})??null;}catch{token=null;}return{token};};
 const onCommit=({band,before,after,token})=>{settle();if(token?.token)history.finishExternalStep(token.token,step({band,before,after}));else history?.recordExternalStep?.({kind:'eq_band',label:label(band),scope:historyScope(),...step({band,before,after})});};
 const onFail=({token,error})=>{settle();if(token?.token)history.failExternalStep(token.token,error);};
 eq=make(studioEqSender(fetch),{onBegin,onCommit,onFail});
 const ready=eq.load().then(()=>{if(destroyed)return;note.remove();const host=doc.createElement('div');host.className='sb-eq-host';element.append(host);view=new EqEditorView({controller:eq,onError,document:doc,width:960,height:150,fluid:true});view.mount(host);},error=>{if(destroyed)return;note.textContent=error?.message||'Freestyle could not read this track’s EQ.';note.classList.add('sb-eq-error');log('eq-load-error',{laneId,code:error?.code??null,status:error?.status??null,pane:'smart-controls'});});
 return{element,controller:eq,ready,get view(){return view;},refresh(){if(destroyed||eq.drag||inFlight)return Promise.resolve();return eq.load().catch(()=>{});},destroy(){destroyed=true;view?.destroy?.();element.remove();}};
}
