/** Passive, bounded UI diagnostics. No drag payload, names, IDs, URLs, files or
 * event objects are retained. Capture-phase destination records describe what
 * reached the document; dragstart bubbles after the source has populated MIME.
 */
const MIME='application/vegetable-library-sound';
const types=new Set([MIME,'application/vegetable-pattern','Files','text/plain','text/uri-list']);
const effects=new Set(['none','copy','move','link','all','copyMove','copyLink','linkMove','uninitialized']);
const tags=new Set(['html','body','aside','section','div','span','button','input','select','option','small','strong','svg','path','circle','rect','canvas','p','label','a']);
const names=['pointerdown','pointerup','dragstart','dragover','drop','dragend'];
const closest=(target,selector)=>target?.closest?.(selector)??null;
function editor(target){
 const node=closest(target,'#rack,#playlist,#piano,#mixer,.browser');
 return node?.classList?.contains('browser')?'browser':['rack','playlist','piano','mixer'].includes(node?.id)?node.id:null;
}
function transfer(event){
 let present=[];try{present=Array.from(event.dataTransfer?.types||[]).filter(type=>types.has(type));}catch{}
 const effect=key=>{try{const value=event.dataTransfer?.[key];return effects.has(value)?value:null;}catch{return null;}};
 return{types:[...new Set(present)].sort(),customMime:present.includes(MIME),effectAllowed:effect('effectAllowed'),dropEffect:effect('dropEffect')};
}
export class LibraryDragDiagnostics{
 constructor({document,maxEvents=16}={}){
  if(!document?.addEventListener||!document?.removeEventListener)throw new TypeError('Drag diagnostics needs a document.');
  if(!Number.isInteger(maxEvents)||maxEvents<1||maxEvents>128)throw new RangeError('Keep between1 and128 recent drag records.');
  Object.assign(this,{document,maxEvents});const performance=document.defaultView?.performance??globalThis.performance;this.now=()=>performance.now();this.epoch=this.now();this.recent=[];this.last=null;this.gesture=null;this.sourceRow=null;this.destroyed=false;this.counters=Object.fromEntries(['total',...names].map(name=>[name,0]));this.listeners=[];
  for(const name of names){const listener=event=>this.observe(name,event),capture=name!=='dragstart';document.addEventListener(name,listener,capture);this.listeners.push({name,listener,capture});}
 }
 time(){return Math.max(0,this.now()-this.epoch);}
 begin(row,at){this.sourceRow=row;this.gesture={candidate:true,active:false,sourceEditor:editor(row),sourceDraggable:row.draggable===true,startedAt:at,firstOverAt:null,lastOverAt:null,firstLaneOverAt:null,lastLaneOverAt:null,endedAt:null};}
 observe(name,event){
  if(this.destroyed)return;
  const row=closest(event.target,'.library-sound-row'),at=this.time();
  if(name==='pointerdown'){if(!row)return;this.begin(row,at);}
  else if(name==='dragstart'){if(!row&&!this.gesture?.candidate&&!this.gesture?.active)return;if(row&&row!==this.sourceRow||!this.gesture)this.begin(row,at);this.gesture.active=!event.defaultPrevented;}
  else if(name==='pointerup'){if(!row&&!this.gesture?.candidate&&!this.gesture?.active)return;if(row&&(!this.gesture||!this.gesture.candidate&&!this.gesture.active))this.begin(row,at);}
  else if(!this.gesture?.candidate&&!this.gesture?.active)return;
  const laneGrid=!!closest(event.target,'.lane-grid'),tag=String(event.target?.localName??'').toLowerCase(),data=transfer(event);
  const record={type:name,at,isTrusted:event.isTrusted===true,sourceEditor:this.gesture.sourceEditor,sourceDraggable:this.sourceRow?.draggable===true,sourceConnected:this.sourceRow?.isConnected===true,destinationEditor:editor(event.target),targetTag:tags.has(tag)?tag:'other',laneGrid,defaultPrevented:event.defaultPrevented===true,...data};
  if(name==='dragover'){this.gesture.firstOverAt??=at;this.gesture.lastOverAt=at;if(laneGrid){this.gesture.firstLaneOverAt??=at;this.gesture.lastLaneOverAt=at;}}
  if(name==='dragend'||name==='pointerup'&&!this.gesture.active){this.gesture.candidate=this.gesture.active=false;this.gesture.endedAt=at;}
  this.counters.total++;this.counters[name]++;this.last=record;this.recent.push(record);if(this.recent.length>this.maxEvents)this.recent.splice(0,this.recent.length-this.maxEvents);
 }
 snapshot(){
  const gesture=this.gesture?{...this.gesture,sourceConnected:this.sourceRow?.isConnected===true,totalDurationMs:(this.gesture.endedAt??this.time())-this.gesture.startedAt,overDurationMs:this.gesture.firstOverAt===null?null:this.gesture.lastOverAt-this.gesture.firstOverAt,laneOverDurationMs:this.gesture.firstLaneOverAt===null?null:this.gesture.lastLaneOverAt-this.gesture.firstLaneOverAt}:null;
  return structuredClone({destroyed:this.destroyed,counters:this.counters,last:this.last,recent:this.recent,gesture});
 }
 destroy(){if(this.destroyed)return;if(this.gesture&&this.gesture.endedAt===null){this.gesture.endedAt=this.time();this.gesture.candidate=this.gesture.active=false;}this.destroyed=true;for(const{name,listener,capture}of this.listeners)this.document.removeEventListener(name,listener,capture);this.listeners=[];this.sourceRow=null;}
}
