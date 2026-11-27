/** Replace the instrument of an instrument track in place (GitHub issue #20): replaceLaneInstrument,
 *  PUT /projects/{id}/lanes/{lane_id}/instrument {instrument_id, preset?} with If-Match = the timeline revision.
 *  The lane keeps its patterns, notes, effects, sends and mix. The reply's `undo` request (previous instrument id +
 *  its signed saved state) puts the exact previous sound back; it is sent through the same typed operation, only
 *  after checking it addresses this project and lane.
 *
 *  `send(body, ifMatch)` performs one replaceLaneInstrument for this lane and resolves its data; `revision()`
 *  resolves the current If-Match. Pure otherwise. */
const fail=(message,fields={})=>Object.assign(new Error(message),fields);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** The checked undo body, or null when the reply has none (nothing changed / no saved instrument before). */
export function replaceUndoBody(receipt,{projectId,laneId}){
 const undo=receipt?.undo;if(undo==null)return null;
 if(!record(undo)||undo.method!=='PUT'||typeof undo.path!=='string'||!record(undo.body)||typeof undo.body.instrument_id!=='string')throw fail('Freestyle returned an instrument Undo this app cannot send.',{operationUncertain:true});
 const path=undo.path.replace(/^\/api\/v1/,'');
 if(path!==`/projects/${projectId}/lanes/${laneId}/instrument`)throw fail('Freestyle returned an instrument Undo for another track. It was not sent.',{operationUncertain:true});
 return{...undo.body};
}
export class LaneInstrumentReplace{
 constructor({send,revision,projectId,laneId}){if(typeof send!=='function'||typeof revision!=='function')throw new TypeError('LaneInstrumentReplace needs send and revision.');Object.assign(this,{send,revision,projectId,laneId});}
 check(receipt){if(!record(receipt)||receipt.ok===false)throw fail('Freestyle did not confirm the instrument change.',{operationUncertain:true});if(receipt.laneId!==undefined&&receipt.laneId!==this.laneId)throw fail('The instrument change acknowledgement names another track.',{operationUncertain:true});return receipt;}
 /** Replace now. Resolves {receipt, replaced, undoBody, redoBody}. */
 async replace(instrumentId,{preset=null}={}){
  if(typeof instrumentId!=='string'||!instrumentId)throw fail('Choose an instrument.',{dispatched:false});
  const body={instrument_id:instrumentId,...(typeof preset==='string'&&preset?{preset}:{})};
  const receipt=this.check(await this.send(body,await this.revision()));
  return{receipt,replaced:receipt.replaced===true,undoBody:receipt.replaced===true?replaceUndoBody(receipt,this):null,redoBody:body};
 }
 /** Send a checked undo (or redo) body. Resolves the receipt; its own `undo` reverses it again. */
 async apply(body){const receipt=this.check(await this.send({...body},await this.revision()));return{receipt,undoBody:replaceUndoBody(receipt,this)};}
}
