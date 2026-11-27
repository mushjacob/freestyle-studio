import {SELECTION_MODES,TIME_FORMATS,selectionValues,editSelection,formatTimeValue,parseTimeValue,stepTimeDigit} from './audacity-time.js';

export class AudacityTimeToolbar {
 constructor(workspace){this.workspace=workspace;this.mode='start-end';this.formats=['hms-ms','hms-ms'];this.positionFormat='hms';}
 mount(){
  const selection=this.workspace.bottom.querySelector('.au-selection');
  selection.classList.add('au-native-selection');
  selection.innerHTML='<div class="au-selection-setup"><span>Selection</span><button type="button" class="au-selection-mode" aria-label="Selection Toolbar Setup" title="Selection Toolbar Setup">⚑</button></div>'+['start','end'].map((edge,index)=>`<div class="au-time-field"><label class="au-time-label" for="au-selection-${edge}"></label><input id="au-selection-${edge}" class="au-time-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-time-index="${index}"><button type="button" class="au-time-format" data-format-index="${index}" aria-label="Time format">▾</button></div>`).join('');
  this.fields=[...selection.querySelectorAll('.au-time-input')];
  selection.querySelector('.au-selection-mode').onclick=e=>this.workspace.menuAt(e.currentTarget,SELECTION_MODES.map(mode=>[mode.label,this.mode===mode.id?'✓':'',()=>this.setMode(mode.id)]));
  this.fields.forEach((input,index)=>{
   input.onchange=()=>this.commit(index);
   input.onkeydown=e=>{
    if(e.key==='Enter'){e.preventDefault();e.stopPropagation();this.commit(index);input.select();}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();input.setCustomValidity('');this.render(true);input.blur();}
    else if(e.key==='ArrowUp'||e.key==='ArrowDown'){
     e.preventDefault();e.stopPropagation();
     try{const next=stepTimeDigit(input.value,input.selectionStart??0,e.key==='ArrowUp'?1:-1,this.formats[index],this.options());input.value=next.text;this.commit(index);input.setSelectionRange(next.caret,next.caret+1);}
     catch(error){this.error(input,error);}
    }
   };
   input.onblur=()=>{if(!input.validity.valid){input.setCustomValidity('');this.render(true);}};
   input.oncontextmenu=e=>{e.preventDefault();this.formatMenu(input,index);};
  });
  selection.querySelectorAll('[data-format-index]').forEach(button=>button.onclick=()=>this.formatMenu(button,Number(button.dataset.formatIndex)));
  const position=this.workspace.bottom.querySelector('#au-position');
  position.classList.add('au-native-position');position.setAttribute('aria-label','Audio Position');
  position.oncontextmenu=e=>{e.preventDefault();this.formatMenu(position,'position');};
  position.title='Audio Position · Right-click to change time format';
  this.render(true);return this;
 }
 options(){const state=this.workspace.getProject()?.cloud?.rawState;const sampleRate=Number(state?.transport?.sample_rate??state?.sample_rate);return {sampleRate:Number.isFinite(sampleRate)&&sampleRate>0?sampleRate:undefined};}
 setMode(mode){if(!SELECTION_MODES.some(item=>item.id===mode))throw new Error('Unknown selection mode.');this.mode=mode;this.render(true);}
 setFormat(index,format){
  const meta=TIME_FORMATS.find(item=>item.id===format);if(!meta)throw new Error('Unknown time format.');
  if(meta.requiresSampleRate&&!this.options().sampleRate)throw new Error('The cloud sample rate is unavailable.');
  if(index==='position'){this.positionFormat=format;this.updatePosition(this.position||0);}else{this.formats[index]=format;this.render(true);}
 }
 formatMenu(button,index){const chosen=index==='position'?this.positionFormat:this.formats[index];this.workspace.menuAt(button,TIME_FORMATS.map(format=>[format.label,chosen===format.id?'✓':'',()=>this.setFormat(index,format.id),!!(format.requiresSampleRate&&!this.options().sampleRate)]));}
 error(input,error){input.setCustomValidity(error.message||'Enter a valid time.');input.reportValidity();}
 commit(index){
  const input=this.fields[index];
  try{const value=parseTimeValue(input.value,this.formats[index],this.options());const next=editSelection(this.workspace.selection,this.mode,index,value);input.setCustomValidity('');const changed=next.start!==this.workspace.selection.start||next.end!==this.workspace.selection.end;this.workspace.selection=next;this.workspace.paintSelection();this.render(true);if(changed)this.workspace.seek(next.start);return true;}
  catch(error){this.error(input,error);return false;}
 }
 render(force=false){
  if(!this.fields)return;
  const mode=SELECTION_MODES.find(item=>item.id===this.mode),values=selectionValues(this.workspace.selection,this.mode);
  this.fields.forEach((input,index)=>{
   const label=mode.fields[index];input.setAttribute('aria-label',`Selection ${label.toLowerCase()}`);input.title=`Selection ${label.toLowerCase()}`;input.previousElementSibling.textContent=label;
   if(force||document.activeElement!==input){try{input.value=formatTimeValue(values[index],this.formats[index],this.options());}catch{this.formats[index]='hms-ms';input.value=formatTimeValue(values[index],'hms-ms',this.options());}input.style.width=`calc(${input.value.length+1}ch + ${input.value.length+10}px)`;}
  });
 }
 updatePosition(seconds){this.position=seconds;const output=this.workspace.bottom.querySelector('#au-position');try{output.textContent=formatTimeValue(seconds,this.positionFormat,this.options());}catch{this.positionFormat='hms';output.textContent=formatTimeValue(seconds,'hms',this.options());}}
}
