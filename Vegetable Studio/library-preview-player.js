/** Real media-element preview controls. The waveform is drawn from peaks the browser decodes from the bytes it already fetched. No engine writes. */
import {studioIcon} from './studio-icons.js';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const time=value=>finite(value)&&value>=0?`${Math.floor(value/60)}:${(value%60).toFixed(1).padStart(4,'0')}`:'—:—';
export class LibraryPreviewPlayer{
 constructor({container,getSnapshot,onCommand,onMediaEvent=()=>{}}){
  this.container=container;this.getSnapshot=getSnapshot;this.onCommand=onCommand;this.onMediaEvent=onMediaEvent;this.document=container.ownerDocument;this.listeners=[];this.mediaListeners=[];this.destroyed=false;this.audio=null;
  const make=(tag,className,text)=>{const n=this.document.createElement(tag);n.className=className;if(text)n.textContent=text;return n;};
  this.element=make('section','library-preview-player');this.element.setAttribute('aria-label','Sound preview');
  const heading=make('div','library-preview-heading');this.title=make('strong','library-preview-title');this.status=make('span','library-preview-state');heading.append(this.title,this.status);this.selection=make('div','library-preview-selection');
  this.progress=make('input','library-preview-progress');this.progress.type='range';this.progress.min='0';this.progress.max='1';this.progress.step='.01';this.progress.value='0';this.progress.setAttribute('aria-label','Preview position');this.clock=make('div','library-preview-time');
  const controls=make('div','library-preview-controls');this.buttons={};
  for(const [command,icon,label]of [['play','play','Play preview'],['stop','stop','Stop preview'],['restart','previous','Restart preview'],['loop','reset','Repeat preview']]){const b=make('button',`library-preview-${command}`);b.innerHTML=studioIcon(icon);b.type='button';b.title=label;b.setAttribute('aria-label',label);controls.append(b);this.buttons[command]=b;this.listen(b,'click',()=>this.command(command));}
  this.volume=make('input','library-preview-volume');this.volume.type='range';this.volume.min='0';this.volume.max='1';this.volume.step='.01';this.volume.setAttribute('aria-label','Preview volume');controls.append(this.volume);this.media=make('div','library-preview-media');this.media.hidden=true;
  this.wave=make('canvas','library-preview-wave');this.wave.height=36;this.wave.width=240;this.wave.hidden=true;this.wave.setAttribute('role','img');this.wave.setAttribute('aria-label','Preview waveform');this.peaks=null;
  this.element.append(heading,this.selection,this.wave,this.progress,this.clock,controls,this.media);container.append(this.element);container.closest('.browser-footer')?.classList.add('has-preview-dock');
  this.listen(this.progress,'input',()=>this.command('seek',Number(this.progress.value)));this.listen(this.volume,'input',()=>this.command('volume',Number(this.volume.value)));
  this.listen(this.element,'keydown',event=>{if([' ','Spacebar','Enter'].includes(event.key)||event.target.matches?.('input[type=range]')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))event.stopPropagation();});
  this.listen(this.element,'keyup',event=>{if([' ','Spacebar','Enter'].includes(event.key)||event.target.matches?.('input[type=range]'))event.stopPropagation();});this.refresh();
 }
 /** Draw (or clear, with null) the preview waveform. `peaks` is [{min,max}] in -1..1. */
 setWaveform(peaks){this.peaks=Array.isArray(peaks)&&peaks.length?peaks:null;this.wave.hidden=!this.peaks;this.paintWaveform();}
 paintWaveform(){
  const canvas=this.wave;if(this.destroyed||!this.peaks||typeof canvas.getContext!=='function')return;const g=canvas.getContext('2d');if(!g)return;
  const w=canvas.width=Math.max(60,Math.round(canvas.clientWidth||canvas.width||240)),h=canvas.height,mid=h/2,audio=this.audio,duration=audio?.duration,played=finite(duration)&&duration>0&&finite(audio.currentTime)?Math.max(0,Math.min(1,audio.currentTime/duration)):0,style=canvas.ownerDocument.defaultView?.getComputedStyle?.(canvas);
  g.clearRect(0,0,w,h);const base=style?.getPropertyValue('--wave-color').trim()||'#8aa0ad',lit=style?.getPropertyValue('--wave-played').trim()||'#f1bc7a';
  for(let x=0;x<w;x++){const peak=this.peaks[Math.min(this.peaks.length-1,Math.floor(x*this.peaks.length/w))];g.fillStyle=x/w<played?lit:base;const top=mid-peak.max*mid,bottom=mid-peak.min*mid;g.fillRect(x,top,1,Math.max(1,bottom-top));}
 }
 listen(target,type,handler){target.addEventListener(type,handler);this.listeners.push(()=>target.removeEventListener(type,handler));}
 bind(audio){
  if(audio===this.audio)return;
  for(const remove of this.mediaListeners)remove();this.mediaListeners=[];
  if(this.audio){this.audio.controls=this.previousControls;this.audio.hidden=this.previousHidden;}
  this.media.replaceChildren();this.audio=audio;this.playingObserved=false;this.mediaFailed=false;
  if(!audio)return;
  this.previousControls=audio.controls;this.previousHidden=audio.hidden;audio.controls=false;audio.hidden=true;if(audio.nodeType)this.media.append(audio);
  for(const type of ['loadedmetadata','durationchange','timeupdate','playing','play','pause','ended','error','emptied','waiting','seeking','seeked','volumechange']){
   const handler=()=>{if(this.destroyed||this.audio!==audio)return;if(type==='playing')this.playingObserved=true;if(['pause','ended','error','emptied'].includes(type))this.playingObserved=false;if(type==='error')this.mediaFailed=true;this.refresh();this.onMediaEvent({type,audio});};audio.addEventListener?.(type,handler);this.mediaListeners.push(()=>audio.removeEventListener?.(type,handler));
  }
 }
 refresh(){
  if(this.destroyed)return;const s=this.getSnapshot();this.snapshot=s;this.bind(s.audio||null);const audio=this.audio,duration=audio?.duration,known=finite(duration)&&duration>0,failed=!!s.failed||this.mediaFailed||!!audio?.error,playing=!!audio&&!audio.paused&&!audio.ended&&!failed&&known&&(s.confirmed||this.playingObserved),loading=!!audio&&!audio.paused&&!failed&&!playing;
  this.title.textContent=s.title||'Select a sound';this.title.title=this.title.textContent;this.selection.textContent=s.selectedTitle&&s.selectedTitle!==s.title?`Selected: ${s.selectedTitle} · Enter to preview`:'';this.selection.hidden=!this.selection.textContent;
  this.status.textContent=failed?'Preview unavailable':playing?'Playing':loading?'Loading…':s.handled?'Played in project':audio?.ended?'Ended':audio?'Paused':s.canPlay?'Ready':'';this.element.dataset.state=failed?'error':playing?'playing':loading?'loading':audio?'paused':'idle';
  this.buttons.play.disabled=!s.canPlay;this.buttons.play.innerHTML=studioIcon(playing||loading?'pause':'play');const playLabel=`${audio&&!audio.paused&&!failed?'Pause':'Play'} ${s.title||'preview'}`;this.buttons.play.title=playLabel;this.buttons.play.setAttribute('aria-label',playLabel);
  this.buttons.stop.disabled=!audio||failed;this.buttons.restart.disabled=!audio||failed||!known;this.buttons.loop.disabled=!!s.handled&&!audio;this.volume.disabled=!!s.handled&&!audio;this.buttons.loop.setAttribute('aria-pressed',String(!!s.loop));this.buttons.loop.classList.toggle('active',!!s.loop);
  this.progress.disabled=!audio||failed||!known;this.progress.max=String(known?duration:1);const position=known&&finite(audio.currentTime)?Math.max(0,Math.min(duration,audio.currentTime)):0,volume=finite(s.volume)?Math.max(0,Math.min(1,s.volume)):1;this.progress.value=String(position);this.progress.style.setProperty('--preview-position',known?`${position/duration*100}%`:'0%');this.progress.setAttribute('aria-valuetext',`${time(known?position:null)} of ${time(known?duration:null)}`);this.clock.textContent=`${time(known?position:null)} / ${time(known?duration:null)}`;this.volume.value=String(volume);this.volume.style.setProperty('--preview-level',`${volume*100}%`);this.volume.title=`Preview volume · ${Math.round(volume*100)}%`;this.paintWaveform();
 }
 command(command,value){
  if(this.destroyed)return;const previous=this.snapshot,current=this.getSnapshot();if(previous.scope!==current.scope||previous.audio!==current.audio||previous.item!==current.item){this.refresh();return;}
  const control=command==='seek'?this.progress:command==='volume'?this.volume:this.buttons[command];if(control?.disabled)return;
  // The browser owns error reporting and scoped asynchronous preview handling.
  this.onCommand(command,value,current);this.refresh();
 }
 destroy(){if(this.destroyed)return;this.destroyed=true;for(const remove of [...this.listeners,...this.mediaListeners])remove();if(this.audio){this.audio.controls=this.previousControls;this.audio.hidden=this.previousHidden;}this.element.remove();if(!this.container.querySelector('.library-preview-player'))this.container.closest('.browser-footer')?.classList.remove('has-preview-dock');this.audio=null;}
}
