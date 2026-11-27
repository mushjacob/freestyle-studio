/** Mixer sends: one undoable write per route toggle, level change or pre/post change.
 * Pure orchestration over injected pieces: `api` (StudioApiSends), the held live sends (`getSends` /
 * `applyOp`) and the project history journal (`history.context()` + `history.recordExternalStep`, the
 * journal every mixer edit uses). Every step's inverse is guarded: it refuses, and dispatches nothing, when
 * the send is no longer in the state that edit left.
 */
import {SEND_DEFAULT_LEVEL,findSend} from './mixer-sends.js';

const near=(a,b)=>typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=1e-5;
const sameState=(a,b)=>a===null||b===null?a===b:near(a.level,b.level)&&a.preFader===b.preFader;
const stateOf=send=>send?{level:send.level,preFader:send.preFader}:null;
const nameOf=row=>row?.name||row?.id||'track';
function historyConflict(message){return Object.assign(new Error(message),{code:'studio_send_history_conflict',dispatched:false,historyNotApplied:true,explicitRejection:true});}
const busyError=()=>Object.assign(new Error('Wait for the current send change.'),{code:'studio_sends_busy',dispatched:false});

export function createSendsController({api,getSends,applyOp=()=>{},history=null,notify=()=>{}}={}){
 if(!api||typeof getSends!=='function')throw new TypeError('The sends controller needs the sends API and the held sends.');
 const live=(laneId,busId)=>findSend(getSends(),laneId,busId);
 const accept=op=>{applyOp(op);try{notify(op);}catch{}};
 const record=(label,detail,undo,redo)=>{
  if(!history||typeof history.recordExternalStep!=='function')return false;
  try{return history.recordExternalStep({kind:'mixer',label,scope:history.context?.(),detail,undo,redo});}catch{return false;}
 };
 /** Write `state` ({level,preFader} or null = no send) and hold the engine's answer. */
 const write=async(laneId,busId,state)=>{
  if(state===null){await api.remove({laneId,busId});accept({type:'remove',laneId,busId});return null;}
  const{send}=await api.put({laneId,busId,level:state.level,preFader:state.preFader});accept({type:'put',send});return stateOf(send);
 };
 /** One undo step: from `before` to `after`. */
 const change=async({laneId,busId,before,after,label,control})=>{
  if(api.busy)throw busyError();
  const current=stateOf(live(laneId,busId));
  if(!sameState(current,before))throw historyConflict('This send changed. Reload the mixer.');
  if(sameState(before,after))return{action:'unchanged',laneId,busId};
  const written=await write(laneId,busId,after);
  const step=(from,to,verb)=>async()=>{if(!sameState(stateOf(live(laneId,busId)),from))throw historyConflict(`This send changed after that edit. ${verb} will not overwrite it.`);await write(laneId,busId,to);return{status:'confirmed'};};
  record(label,{laneId,busId,control,before,after:written},step(written,before,'Undo'),step(before,written,'Redo'));
  return{action:written===null?'removed':before===null?'added':'changed',laneId,busId,state:written};
 };
 const ids=({source,destination})=>({laneId:source.id,busId:destination.id,names:`${nameOf(source)} → ${nameOf(destination)}`});
 return{
  /** FL route arrow: add the send source -> destination (level 100%, post-fader), or remove it. */
  toggle(packet){
   const{laneId,busId,names}=ids(packet),before=stateOf(live(laneId,busId));
   return before?change({laneId,busId,before,after:null,label:`Remove send ${names}`,control:'send'}):change({laneId,busId,before:null,after:{level:SEND_DEFAULT_LEVEL,preFader:false},label:`Route ${names}`,control:'send'});
  },
  /** FL send knob: one confirmed level write for the whole gesture. */
  setLevel(packet){
   const{laneId,busId,names}=ids(packet),before=stateOf(live(laneId,busId));
   if(!before)return Promise.reject(historyConflict('This send is gone. Reload the mixer.'));
   return change({laneId,busId,before,after:{...before,level:packet.level},label:`Send level ${names}`,control:'send-level'});
  },
  /** Pre-/post-fader tap. */
  setPreFader(packet){
   const{laneId,busId,names}=ids(packet),before=stateOf(live(laneId,busId));
   if(!before)return Promise.reject(historyConflict('This send is gone. Reload the mixer.'));
   return change({laneId,busId,before,after:{...before,preFader:packet.preFader===true},label:`Send ${packet.preFader===true?'pre':'post'}-fader ${names}`,control:'send-tap'});
  },
 };
}
