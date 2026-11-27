/** Pure polyphonic Piano roll paint/delete strokes. Positions use beats and
 * continuous keyboard rows (0 is MIDI127); rendering never changes the score.
 * Native controls: Image-Line pianoroll.htm, Draw/Paint/Delete toolbar entries.
 */
const EPS=1e-9,MAX_CELLS=50000;
const finite=number=>typeof number==='number'&&Number.isFinite(number);
const clone=value=>structuredClone(value);
const point=value=>value&&finite(value.beat)&&finite(value.row);
const cell=value=>Math.floor(value+EPS);

/** Traverse every grid cell crossed by a line, including fast diagonal sweeps. */
export function pianoStrokeCells(from,to,{originBeat=0,stride=.25}={}){
 if(!point(from)||!point(to)||!finite(stride)||stride<=0)throw new TypeError('A piano stroke requires finite points and a positive spacing.');
 const x0=(from.beat-originBeat)/stride,y0=from.row,x1=(to.beat-originBeat)/stride,y1=to.row,dx=x1-x0,dy=y1-y0;
 let x=cell(x0),y=cell(y0),lastX=cell(x1),lastY=cell(y1);const found=[[x,y]],stepX=Math.sign(dx),stepY=Math.sign(dy),deltaX=stepX?1/Math.abs(dx):Infinity,deltaY=stepY?1/Math.abs(dy):Infinity;
 let nextX=stepX?((stepX>0?x+1:x)-x0)/dx:Infinity,nextY=stepY?((stepY>0?y+1:y)-y0)/dy:Infinity;
 while(x!==lastX||y!==lastY){
  if(found.length>=MAX_CELLS)throw new RangeError('This stroke crosses too many note cells. Use a shorter stroke or a larger note spacing.');
  if(nextX<nextY-EPS){x+=stepX;nextX+=deltaX;}else if(nextY<nextX-EPS){y+=stepY;nextY+=deltaY;}else{x+=stepX;y+=stepY;nextX+=deltaX;nextY+=deltaY;}
  found.push([x,y]);
 }
 return found;
}
function hitsNote(from,to,note){
 const left=note.start,right=note.start+note.duration,top=127-note.pitch,bottom=top+1,dx=to.beat-from.beat,dy=to.row-from.row;let first=0,last=1;
 for(const [p,q]of [[-dx,from.beat-left],[dx,right-from.beat],[-dy,from.row-top],[dy,bottom-from.row]]){
  if(Math.abs(p)<EPS){if(q<0)return false;continue;}const t=q/p;
  if(p<0){if(t>last)return false;first=Math.max(first,t);}else{if(t<first)return false;last=Math.min(last,t);}
 }
 return first<=last;
}
export class PianoStroke{
 constructor({notes=[],mode='paint',length=.5,snapBeats=.25,velocity=.8,idFactory=()=>crypto.randomUUID(),source={},paint=()=>{},restore=()=>{},isValid=()=>true,onInvalid=()=>{},raf=fn=>requestAnimationFrame(fn),caf=id=>cancelAnimationFrame(id)}={}){
  if(!['paint','erase'].includes(mode)||!finite(length)||length<=0||!finite(snapBeats)||snapBeats<0||!finite(velocity)||velocity<0||velocity>1)throw new TypeError('Piano strokes require a tool, a positive authored length, nonnegative snap and a valid velocity.');
  if(notes.some(n=>!n||n.id==null||!finite(n.start)||n.start<0||!finite(n.duration)||n.duration<=0||!Number.isInteger(n.pitch)||n.pitch<0||n.pitch>127))throw new TypeError('Load the complete canonical note score before painting or deleting.');
  Object.assign(this,{notes,mode,length,snapBeats,velocity,idFactory,source,paint,restore,isValid,onInvalid,raf,caf});this.created=[];this.erased=new Set();this.visited=new Set();this.reserved=new Set(notes.flatMap(n=>[String(n.id),n.cloudRaw?.id==null?'':String(n.cloudRaw.id)]));for(const id of [source.id,source.cloudRaw?.id])if(id!=null)this.reserved.add(String(id));this.previous=null;this.originBeat=null;this.frame=null;this.active=true;
 }
 allocate(){for(let i=0;i<64;i++){const id=String(this.idFactory()??'');if(id&&!this.reserved.has(id)){this.reserved.add(id);return id;}}throw new Error('A new painted note needs an unused identity.');}
 addPoint(next,{schedule=true}={}){
  if(!this.active||!point(next))return false;
  if(!this.isValid()){this.finish(undefined,{cancel:true});this.onInvalid();return false;}
  if(this.originBeat===null)this.originBeat=this.snapBeats>0?Math.max(0,Math.floor(Math.max(0,next.beat)/this.snapBeats+EPS)*this.snapBeats):Math.max(0,next.beat);
  const before=this.created.length+this.erased.size,from=this.previous??next;
  if(this.mode==='erase'){
   for(const note of this.notes)if(!this.erased.has(note.id)&&hitsNote(from,next,note))this.erased.add(note.id);
  }else{
   const stride=Math.max(this.length,this.snapBeats);
   for(const [index,row]of pianoStrokeCells(from,next,{originBeat:this.originBeat,stride})){
    const start=this.originBeat+index*stride,pitch=127-row,key=`${index}:${row}`;if(this.visited.has(key)||start< -EPS||row<0||row>127)continue;this.visited.add(key);
    if(this.visited.size>MAX_CELLS)throw new RangeError('This stroke creates too many note cells. Finish it and start another.');
    const onset=Math.max(0,start);
    const occupied=note=>note.pitch===pitch&&note.start<onset+this.length-EPS&&note.start+note.duration>onset+EPS;
    if(this.notes.some(occupied)||this.created.some(occupied))continue;
    const created={...clone(this.source),id:this.allocate(),pitch,start:onset,duration:this.length,velocity:this.velocity};if(created.cloudRaw&&Object.hasOwn(created.cloudRaw,'id'))created.cloudRaw.id=created.id;this.created.push(created);
   }
  }
  this.previous={...next};const changed=before!==this.created.length+this.erased.size;
  if(changed&&schedule&&this.frame===null)this.frame=this.raf(()=>{this.frame=null;if(!this.active)return;if(!this.isValid()){this.finish(undefined,{cancel:true});this.onInvalid();return;}this.paint(this.snapshot());});
  return changed;
 }
 snapshot(){return{notes:this.notes.filter(n=>!this.erased.has(n.id)).concat(this.created),created:this.created.slice(),erased:new Set(this.erased)};}
 finish(next,{cancel=false}={}){
  if(!this.active)return this.result;
  cancel=cancel||!this.isValid();if(!cancel)this.addPoint(next,{schedule:false});if(this.frame!==null)this.caf(this.frame);this.frame=null;this.active=false;this.restore();
  return this.result={...cancel?{notes:this.notes,created:[],erased:new Set()}:this.snapshot(),cancelled:cancel,changed:!cancel&&(this.created.length>0||this.erased.size>0)};
 }
}

/** Native paste starts at the first bar intersecting the visible timeline. */
export function visiblePianoPasteBeat(scrollLeft,pixelsPerBar){
 if(!finite(scrollLeft)||scrollLeft<0||!finite(pixelsPerBar)||pixelsPerBar<=0)throw new RangeError('Piano paste requires a valid viewport position and scale.');
 return Math.floor((scrollLeft+EPS)/pixelsPerBar)*4;
}
