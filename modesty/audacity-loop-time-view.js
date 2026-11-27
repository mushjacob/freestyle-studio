import {TIME_FORMATS,formatTimeValue,parseTimeValue,stepTimeDigit} from './audacity-time.js';
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const abort=()=>Object.assign(new Error('The cloud project changed. Reopen the loop position command.'),{name:'AbortError'});

/** PlayRegion accessors order crossed endpoints; they do not pin to the other
 * edge. Freestyle additionally requires a nonempty loop of at least 50ms.
 * Primary: Audacity ViewInfo.h/.cpp and SelectUtilities::OnSetRegion. */
export function loopEndpointRange(bounds,edge,valueSeconds){
 if(!['start','end'].includes(edge))throw new Error('Choose Loop In or Loop Out.');
 if(!finite(valueSeconds)||Number(valueSeconds)<0)throw new Error('Loop position must be a non-negative finite time.');
 if(!finite(bounds?.start)||!finite(bounds?.end)||Number(bounds.start)<0||Number(bounds.end)<Number(bounds.start))throw new Error('Freestyle has not supplied ordered loop bounds.');
 const a=edge==='start'?Number(valueSeconds):Number(bounds.start),b=edge==='end'?Number(valueSeconds):Number(bounds.end),start=Math.min(a,b),end=Math.max(a,b);
 if(end-start<.05)throw new Error('The Freestyle loop region must be at least 50 milliseconds long.');
 return {enabled:true,start,end};
}

/** Numeric Loop In/Out. Activation precedes the command, including Cancel, as
 * in native TransportMenus. Merely editing Position never sends a cloud write. */
export class AudacityLoopTimeDialog {
 constructor(workspace,loopController){
  if(!workspace||!loopController)throw new TypeError('Loop Position needs a workspace and loop controller.');
  this.workspace=workspace;this.loop=loopController;this.dialog=null;this.opening=null;this.busy=false;
 }
 options(){return this.workspace.timeToolbar?.options?.()||{sampleRate:this.workspace.getProject?.()?.cloud?.rawState?.transport?.sample_rate};}
 clock(){return this.loop.clock?.()??this.workspace.engine?.session?.positionAt?.()??{};}
 active(clock){return clock.playing===true||this.workspace.paused===true||(clock.playing===undefined&&this.workspace.engine?.playing===true&&!this.workspace.engine?.previewing);}
 streamTime(clock){
  if(!finite(clock.seconds)||Number(clock.seconds)<0||clock.clockAvailable===false||clock.previewClockAvailable===false||clock.clockSource==='none'||!(['live','http','ack'].includes(clock.clockSource)||clock.clockAvailable===true))throw new Error('An authoritative cloud stream position is unavailable. Wait for the playback clock before setting a live loop boundary.');
  return Number(clock.seconds);
 }
 open(edge){
  if(!['start','end'].includes(edge))return Promise.reject(new Error('Choose Loop In or Loop Out.'));
  if(this.opening)return this.opening;
  if(this.dialog?.isConnected){this.input?.focus();return Promise.resolve(this.dialog);}
  const context=this.loop.context();
  const operation=Promise.resolve().then(async()=>{
   if(!this.loop.valid(context))throw abort();
   if(!this.loop.bounds().enabled)await this.loop.toggle();
   if(!this.loop.valid(context))throw abort();
   const bounds=this.loop.bounds();if(!bounds.enabled)throw new Error('Freestyle did not acknowledge loop activation.');
   const clock=this.clock();
   if(this.active(clock))return this.applyValue(edge,this.streamTime(clock),context);
   return this.show(edge,bounds,context);
  }).finally(()=>{if(this.opening===operation)this.opening=null;});
  this.opening=operation;return operation;
 }
 async applyValue(edge,value,context){
  if(!this.loop.valid(context))throw abort();
  const current=this.loop.bounds(),range=loopEndpointRange(current,edge,value);
  if(current.enabled&&range.start===current.start&&range.end===current.end)return current;
  const result=await this.loop.apply(range,context);if(!this.loop.valid(context))throw abort();return result;
 }
 show(edge,bounds,context){
  if(!finite(bounds.start)||!finite(bounds.end)||bounds.start<0||bounds.end<bounds.start)throw new Error('Freestyle has not supplied ordered loop bounds.');
  this.edge=edge;this.context=context;this.position=Number(bounds[edge]);this.dirty=false;this.busy=false;
  const preferred=this.workspace.timeToolbar?.formats?.[edge==='start'?0:1]||'hms-ms';
  this.format=TIME_FORMATS.some(format=>format.id===preferred)?preferred:'hms-ms';
  try{formatTimeValue(this.position,this.format,this.options());}catch{this.format='hms-ms';}
  const d=this.dialog=this.workspace.dialog(edge==='start'?'Set Loop In':'Set Loop Out','<form class="au-loop-time-form"><label for="au-loop-position">Position</label><div class="au-loop-time-row"><input id="au-loop-position" class="au-time-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"><button type="button" class="au-loop-position-format" aria-label="Loop position time format" title="Loop position time format">▾</button></div><p class="au-loop-time-status" role="status" aria-live="polite"></p><footer><button type="button" class="au-loop-time-cancel">Cancel</button><button type="submit" class="au-loop-time-ok primary">OK</button></footer></form>');
  d.classList.add('au-loop-time-dialog');this.input=d.querySelector('#au-loop-position');this.status=d.querySelector('.au-loop-time-status');this.renderPosition();
  d.querySelector('form').onsubmit=event=>{event.preventDefault();this.commit();};
  this.input.oninput=()=>{this.dirty=true;this.input.setCustomValidity('');this.status.textContent='';};
  this.input.onkeydown=event=>{
   if(event.key==='Enter'){event.preventDefault();event.stopPropagation();this.commit();}
   else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!this.busy)d.close();}
   else if(event.key==='ArrowUp'||event.key==='ArrowDown'){
    event.preventDefault();event.stopPropagation();
    try{const next=stepTimeDigit(this.input.value,this.input.selectionStart??0,event.key==='ArrowUp'?1:-1,this.format,this.options());this.input.value=next.text;this.dirty=true;this.input.setCustomValidity('');this.status.textContent='';this.input.setSelectionRange(next.caret,next.caret+1);}
    catch(error){this.error(error,true);}
   }
  };
  d.querySelector('.au-loop-time-cancel').onclick=()=>{if(!this.busy)d.close();};
  const formats=d.querySelector('.au-loop-position-format');formats.onclick=()=>this.formatMenu(formats);this.input.oncontextmenu=event=>{event.preventDefault();this.formatMenu(this.input);};
  d.addEventListener('close',()=>{if(this.dialog===d){this.dialog=null;this.input=null;this.status=null;}},{once:true});
  this.input.focus();this.input.select();return d;
 }
 value(){return !this.dirty&&this.input.value===this.renderedValue?this.position:parseTimeValue(this.input.value,this.format,this.options());}
 renderPosition(){this.renderedValue=formatTimeValue(this.position,this.format,this.options());this.input.value=this.renderedValue;}
 setFormat(formatId){
  const meta=TIME_FORMATS.find(format=>format.id===formatId);if(!meta)throw new Error('Unknown time format.');
  if(meta.requiresSampleRate&&!this.options().sampleRate)throw new Error('The actual cloud sample rate is unavailable.');
  const position=this.value(),text=formatTimeValue(position,formatId,this.options());this.position=position;this.format=formatId;this.dirty=false;this.renderedValue=text;this.input.value=text;this.input.setCustomValidity('');this.status.textContent='';
 }
 formatMenu(button){this.workspace.menuAt(button,TIME_FORMATS.map(format=>[format.label,format.id===this.format?'✓':'',()=>{try{this.setFormat(format.id);}catch(error){this.error(error,true);}},!!(format.requiresSampleRate&&!this.options().sampleRate)]));}
 error(error,invalid=false){if(!this.dialog?.isConnected)return;if(invalid){this.input.setCustomValidity(error.message||'Enter a valid loop position.');this.input.reportValidity();}this.status.textContent=error.message||String(error);}
 async commit(){
  if(!this.dialog?.isConnected||this.busy)return false;
  const d=this.dialog;let value;
  try{if(!this.loop.valid(this.context))throw abort();value=this.value();loopEndpointRange(this.loop.bounds(),this.edge,value);}
  catch(error){this.error(error,true);return false;}
  this.busy=true;this.input.disabled=true;d.querySelectorAll('button').forEach(button=>button.disabled=true);this.input.setCustomValidity('');this.status.textContent='Saving loop position in Freestyle…';
  try{await this.applyValue(this.edge,value,this.context);if(d.isConnected)d.close();return true;}
  catch(error){this.error(error);return false;}
  finally{this.busy=false;if(d.isConnected){this.input.disabled=false;d.querySelectorAll('button').forEach(button=>button.disabled=false);}}
 }
}
