/** Step entry follows FL: by default left-click toggles (a drag paints in the
 * direction set by its first step) and right-click disables; the optional
 * two-button mode makes left only enable. Reference: Image-Line
 * channelrack.htm, section 13. Pointer previews are local.
 */
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const point=p=>p&&finite(p.x)&&finite(p.y);
const clone=value=>structuredClone(value);
const inside=(p,cell)=>p.x>=cell.left&&p.x<cell.right&&p.y>=cell.top&&p.y<cell.bottom;
/** Half-open cells own their left/top edge. A corner touched only mid-segment
 * is not an entered step; an exact final pointer coordinate still selects its
 * containing cell. Returns entry time to resolve toggle direction in path order.
 */
export function rackStepIntersection(from,to,cell){
 if(!point(from)||!point(to))return null;
 const dx=to.x-from.x,dy=to.y-from.y;if(!Number.isFinite(dx)||!Number.isFinite(dy))throw new RangeError('Step stroke coordinates exceed finite bounds.');
 if(dx===0&&dy===0)return inside(to,cell)?0:null;
 let first=0,last=1;
 for(const [origin,delta,min,max]of [[from.x,dx,cell.left,cell.right],[from.y,dy,cell.top,cell.bottom]]){
  if(delta===0){if(origin<min||origin>=max)return null;continue;}
  const a=(min-origin)/delta,b=(max-origin)/delta;first=Math.max(first,Math.min(a,b));last=Math.min(last,Math.max(a,b));if(first>last)return null;
 }
 if(first<last)return first;
 return first===1&&inside(to,cell)?1:null;
}
function validRows(rows){
 if(!Array.isArray(rows))throw new TypeError('Load canonical step rows before editing.');const ids=new Set();
 for(const row of rows){
  if(!row||typeof row.channelId!=='string'||!row.channelId||ids.has(row.channelId)||!Array.isArray(row.steps))throw new TypeError('Load canonical step rows before editing.');ids.add(row.channelId);
  for(let i=0;i<row.steps.length;i++){const step=row.steps[i];if(!Object.hasOwn(row.steps,i)||typeof step!=='boolean'&&!(finite(step)&&step>=0&&step<=1))throw new TypeError('Load complete canonical step arrays before editing.');}
  for(const key of Object.keys(row.steps))if((/^_+truncated/i.test(key)||key==='truncated'||/Truncated$/.test(key)||/_truncated$/.test(key))&&row.steps[key])throw new TypeError('Load complete canonical step arrays before editing.');
 }
}
export class RackStepStroke{
 constructor({rows,cells,mode='on',paint=()=>{},restore=()=>{},isValid=()=>true,onInvalid=()=>{},raf=fn=>requestAnimationFrame(fn),caf=id=>cancelAnimationFrame(id)}={}){
  validRows(rows);if(!Array.isArray(cells)||!['on','off','toggle'].includes(mode))throw new TypeError('Choose a step stroke and complete channel rows.');
  this.rows=new Map(rows.map(row=>[row.channelId,clone(row.steps)]));const keys=new Set();
  this.cells=cells.map(cell=>{if(!cell||!this.rows.has(cell.channelId)||!Number.isInteger(cell.index)||cell.index<0||cell.index>=this.rows.get(cell.channelId).length||!['left','right','top','bottom'].every(key=>finite(cell[key]))||cell.right<=cell.left||cell.bottom<=cell.top)throw new TypeError('Step cells need explicit channel identities, indexes and visible bounds.');const key=JSON.stringify([cell.channelId,cell.index]);if(keys.has(key))throw new TypeError('Each visible step needs one unambiguous cell rectangle.');keys.add(key);return{...cell};});
  Object.assign(this,{mode,paint,restore,isValid,onInvalid,raf,caf});this.resolvedMode=mode==='toggle'?null:mode;this.changedRows=new Map();this.visited=new Set();this.previous=null;this.frame=null;this.active=true;
 }
 addPoint(next,{schedule=true}={}){
  if(!this.active||!point(next))return false;
  if(!this.isValid()){this.finish(null,{cancel:true});this.onInvalid();return false;}
  const from=this.previous||next;let changed=false;
  const hits=this.cells.map(cell=>({cell,at:rackStepIntersection(from,next,cell)})).filter(hit=>hit.at!==null).sort((a,b)=>a.at-b.at);
  for(const {cell}of hits){
   const key=JSON.stringify([cell.channelId,cell.index]);if(this.visited.has(key))continue;this.visited.add(key);
   const source=this.rows.get(cell.channelId),current=this.changedRows.get(cell.channelId)||source,value=current[cell.index];
   if(this.resolvedMode===null)this.resolvedMode=value?'off':'on';
   if(this.resolvedMode==='on'&&value||this.resolvedMode==='off'&&!value)continue;
   const row=this.changedRows.get(cell.channelId)||clone(source);row[cell.index]=this.resolvedMode==='on';this.changedRows.set(cell.channelId,row);changed=true;
  }
  this.previous={x:next.x,y:next.y};
  if(changed&&schedule&&this.frame===null)this.frame=this.raf(()=>{this.frame=null;if(!this.active)return;if(!this.isValid()){this.finish(null,{cancel:true});this.onInvalid();return;}try{this.paint(this.snapshot());}catch(error){this.finish(null,{cancel:true});this.onInvalid(error);}});
  return changed;
 }
 snapshot(){return{stepsByChannel:new Map([...this.changedRows].map(([id,steps])=>[id,clone(steps)]))};}
 finish(next,{cancel=false}={}){
  if(!this.active)return this.result;
  cancel=cancel||!this.isValid();if(!cancel)this.addPoint(next,{schedule:false});if(this.frame!==null)this.caf(this.frame);this.frame=null;this.active=false;
  this.result={...cancel?{stepsByChannel:new Map()}:this.snapshot(),cancelled:cancel,changed:!cancel&&this.changedRows.size>0};this.restore();return this.result;
 }
}

/** The parent captures the pointer and restores DOM styles. Scope must include
 * project/pattern/load/context/page identity. getRows returns COMPLETE arrays;
 * getCells returns only visible rectangles with their absolute array indexes.
 * isEditable must allow this controller's own active interaction barrier.
 */
export class RackStepGesture{
 constructor({getScope,getRows,getCells,getMode=event=>event.button===2?'off':'on',isEditable=()=>true,onStart=()=>{},paint=()=>{},restore=()=>{},commit=()=>{},onFinish=()=>{},onError=()=>{},raf=fn=>globalThis.requestAnimationFrame(fn),caf=id=>globalThis.cancelAnimationFrame(id)}={}){
  if(typeof getScope!=='function'||typeof getRows!=='function'||typeof getCells!=='function')throw new TypeError('RackStepGesture needs scope, complete rows and visible cell callbacks.');
  Object.assign(this,{getScope,getRows,getCells,getMode,isEditable,onStart,paint,restore,commit,onFinish,onError,raf,caf});this.gesture=null;
 }
 get active(){return !!this.gesture;}
 capture(event){const rows=this.getRows();validRows(rows);return JSON.stringify({scope:this.getScope(),rows,mode:this.getMode(event),cells:this.getCells()});}
 current(){try{return !!this.gesture&&this.isEditable()&&this.capture(this.gesture.modeEvent)===this.gesture.scope;}catch{return false;}}
 start(event){
  if(this.active||event?.isPrimary===false||event?.pointerId==null||![0,2].includes(event.button)||!point({x:event.clientX,y:event.clientY})||!this.isEditable())return false;
  try{
   const modeEvent={button:event.button,ctrlKey:!!event.ctrlKey,metaKey:!!event.metaKey,altKey:!!event.altKey,shiftKey:!!event.shiftKey},mode=this.getMode(modeEvent),rows=this.getRows(),cells=this.getCells(),scope=this.capture(modeEvent);
   const stroke=new RackStepStroke({rows,cells,mode,isValid:()=>this.current(),paint:result=>this.paint(result),onInvalid:error=>{this.cancel();if(error)this.onError(error);},raf:this.raf,caf:this.caf});
   this.gesture={pointerId:event.pointerId,modeEvent,scope,stroke};this.onStart({pointerId:event.pointerId,mode,rows:clone(rows)});
   if(!this.current()){this.cancel();return false;}this.move(event);return this.active;
  }catch(error){if(this.active)this.cancel();this.onError(error);return false;}
 }
 move(event){
  if(!this.active||event?.pointerId!==this.gesture.pointerId)return false;if(!this.current()){this.cancel();return false;}
  try{return this.gesture.stroke.addPoint({x:event.clientX,y:event.clientY});}catch(error){this.cancel();this.onError(error);return false;}
 }
 finish(event,{cancel=false}={}){
  const gesture=this.gesture;if(!gesture||event?.pointerId!=null&&event.pointerId!==gesture.pointerId)return null;
  const next={x:event?.clientX,y:event?.clientY};cancel=cancel||!this.current()||!point(next);
  let result;
  try{result=gesture.stroke.finish(next,{cancel});}catch(error){result=gesture.stroke.finish(null,{cancel:true});result.error=error;this.onError(error);}
  this.gesture=null;
  for(const callback of [this.restore,this.onFinish])try{callback(result);}catch(error){result.error=error;this.onError(error);}
  const current=()=>{try{return this.isEditable()&&this.capture(gesture.modeEvent)===gesture.scope;}catch{return false;}};
  if(result.changed&&!result.error&&current())try{const pending=this.commit(result);if(pending&&typeof pending.then==='function')pending.catch(this.onError);}catch(error){result.error=error;this.onError(error);}
  else if(result.changed&&!current()){result.cancelled=true;result.changed=false;}
  return result;
 }
 cancel(event){return this.finish(event,{cancel:true});}
 pointerCancel(event){return this.cancel(event);}
 lostPointerCapture(event){return this.cancel(event);}
 keyDown(event){if(!this.active)return false;if(event.key==='Escape'){event.preventDefault?.();this.cancel();return true;}if(!this.current())this.cancel();return false;}
 blur(){return this.cancel();}
 destroy(){this.cancel();}
}
