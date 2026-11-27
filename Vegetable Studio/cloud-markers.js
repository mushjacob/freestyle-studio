/** Saved Playlist markers (L09/P36) through Studio API `getMarkers` / `setMarkers`.
 *
 * One revisioned whole-list document per project. Every write sends If-Match with the revision
 * this editor last read; a 412 adopts the list the server sent and the edit is NOT retried (the
 * user repeats it on current data). Edits are recorded in MarkersHistory so Undo/Redo can write the
 * previous / next list back. Never writes `model.loop`: a loop marker is applied by the caller
 * through the existing Playlist loop controls.
 */
import {StudioApiClient} from './studio-api-client.js';
import {MarkersHistory,normalizeMarkers,sameMarkers} from './markers.js';
const clone=value=>value==null?value:structuredClone(value);
const fail=(message,code,extra={})=>Object.assign(new Error(message),{code,...extra});
export const MARKERS_OPERATIONS=Object.freeze(['getMarkers','setMarkers']);

export class CloudMarkers{
 constructor({engine,client=new StudioApiClient(),onChange=()=>{}}={}){
  if(!engine||typeof client?.call!=='function')throw new TypeError('Markers need an engine and a Studio API client.');
  Object.assign(this,{engine,client,onChange});this.projectId=null;this.revision=null;this.markers=[];this.available=null;this.busy=false;this.history=new MarkersHistory();
 }
 get ready(){return this.available===true&&!!this.projectId&&this.projectId===this.engine.projectId;}
 snapshot(){return{projectId:this.projectId,revision:this.revision,markers:clone(this.markers),available:this.available,busy:this.busy};}
 notify(){try{this.onChange(this.snapshot());}catch{}}
 adopt(projectId,data){this.projectId=projectId;this.revision=Number.isInteger(data?.revision)?data.revision:0;this.markers=normalizeMarkers(data?.markers);this.available=true;}
 /** Forget everything (project closed or switched). */
 reset(){this.projectId=null;this.revision=null;this.markers=[];this.available=null;this.history.forget();this.notify();}
 /** Read the saved list. A backend without getMarkers (or any read failure) leaves the feature unavailable until the next load. */
 async load(){
  const projectId=this.engine.projectId;if(!projectId||!this.engine.ready)return this.snapshot();
  if(this.projectId!==projectId){this.projectId=null;this.markers=[];this.history.forget();}
  let result;
  try{result=await this.client.call('getMarkers',{path:{project_id:projectId}});}
  catch{if(projectId===this.engine.projectId){this.available=false;this.notify();}return this.snapshot();}
  if(projectId!==this.engine.projectId)return this.snapshot();
  this.adopt(projectId,result.data);this.notify();return this.snapshot();
 }
 /** Replace the list at the last read revision. Returns the saved list. */
 async write(next,{label='Edit markers',record=true}={}){
  if(!this.ready)throw fail('Open a Freestyle project with markers before editing them.','markers_unavailable');
  if(this.busy)throw fail('Wait for the current marker change to finish.','markers_busy');
  const projectId=this.projectId,before=clone(this.markers),list=normalizeMarkers(next);this.busy=true;this.notify();
  try{
   let result;
   try{result=await this.client.call('setMarkers',{path:{project_id:projectId},body:{markers:list}},{ifMatch:`"${this.revision}"`});}
   catch(error){
    const current=error?.status===412?error.details?.current:null;
    if(current&&projectId===this.engine.projectId){this.adopt(projectId,current);throw fail('The markers changed elsewhere. Repeat the edit on the current markers.','markers_revision_conflict',{status:412});}
    throw error;
   }
   if(projectId!==this.engine.projectId)throw fail('The project changed while the markers were saving.','markers_scope_changed');
   this.adopt(projectId,result.data);if(record)this.history.record({projectId,before,after:this.markers,label});
   return clone(this.markers);
  }finally{this.busy=false;this.notify();}
 }
 canUndo(){return this.ready&&this.history.canUndo(this.projectId);}
 canRedo(){return this.ready&&this.history.canRedo(this.projectId);}
 /** One Undo/Redo step: refused (nothing written) when the saved list is not the one the step expects. */
 step(direction){
  return this.history.step(direction,{projectId:this.projectId,current:()=>this.markers,write:list=>this.write(list,{record:false})});
 }
 same(list){return sameMarkers(this.markers,list);}
}
