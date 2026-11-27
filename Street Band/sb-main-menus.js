/** Street Band menu bar: Street Band, File, Edit, Track, Record, Mix, Share, View, Window, Help.
 *
 * Pure composer. `base` is the inherited menu map (logic-main-menus.js builders plus TracksEdit and
 * Freestyle from app.js): each Street Band entry is picked from it by label, so it keeps the handler,
 * disabled state and tooltip that are already proven there. Entries the engine cannot back stay in
 * place, disabled, with the reason as their tooltip. `x` supplies the few Street Band-only actions
 * (panes, About, share links). Nothing here does I/O.
 */
export const SB_MENU_ORDER=Object.freeze(['Street Band','File','Edit','Track','Record','Mix','Share','View','Window','Help']);
const off=(label,title,shortcut='')=>({label,shortcut,disabled:true,title});
const norm=item=>!item||item.column?null:Array.isArray(item)?{label:item[0],shortcut:item[1]??'',run:item[2],disabled:!!item[3],title:item[4]||''}:item;
/** Depth-first search of a menu for an entry by label (optionally below a parent path). */
export function findMenuItem(items,label){
 for(const raw of items||[]){const item=norm(raw);if(!item)continue;if(item.label===label)return item;if(Array.isArray(item.submenu)){const hit=findMenuItem(item.submenu,label);if(hit)return hit;}}
 return null;
}
const NO={
 os:'macOS and the browser own this window command.',movie:'Freestyle projects have no movie track.',arrange:'Freestyle projects have no arrangement markers.',
 share:'Sharing goes through Freestyle: use Copy Project Link or Share Settings… below.',loop:'The Loop Browser lists Freestyle’s catalogue; regions cannot be added to it.',
 join:'Freestyle has no region join operation.',print:'There is no Score Editor to print from.',automation:'Add, move and delete automation points in the track’s automation lane (A).'
};
export const SB_MENU_REASONS=NO;

export function streetBandMenus(base,x){
 const menu=name=>{try{return base[name]?.()||[];}catch{return[];}};
 /** An inherited entry, optionally relabelled; a disabled stand-in when the source menu has no such entry. */
 const pick=(name,label,changes={})=>{const item=findMenuItem(menu(name),label);return item?{...item,...changes}:off(changes.label||label,'Not available in this project.',changes.shortcut||'');};
 const shell=()=>x.shell?.()||null;
 const pane=(name,label,shortcut,title='')=>{const s=shell(),shown=!!s?.shown(name);return{label:`${shown?'Hide':'Show'} ${label}`,shortcut,title,disabled:!s,run:()=>shell()?.toggle(name)};};
 const App=()=>[
  {label:'About Street Band',run:x.about},null,
  off('Settings…','Street Band has no settings window: audio, MIDI and devices are handled by the Freestyle cloud engine and the browser.','⌘,'),
  {label:'Key Commands…',shortcut:'⌥K',run:x.keyCommands},null,
  {label:'Sound Library',submenu:[{label:'Open Library',shortcut:'Y',disabled:!shell(),run:()=>shell()?.toggle('library',true)},off('Download All Available Sounds','Freestyle streams its sound catalogue from the cloud; there is nothing to download.'),off('Reinstall Sound Library','Freestyle streams its sound catalogue from the cloud; there is nothing to install.')]},
  {label:'Freestyle',submenu:menu('Freestyle')},null,
  off('Hide Street Band',NO.os,'⌘H'),off('Quit Street Band',NO.os,'⌘Q')];
 const File=()=>[
  pick('File','New',{label:'New…'}),pick('File','Open…'),pick('File','Open Recent'),null,
  pick('File','Close'),pick('File','Save'),pick('File','Save As…'),pick('File','Revert to'),null,
  {label:'Import',submenu:[pick('File','Audio File…'),pick('File','MIDI File…'),pick('File','Other…'),...(findMenuItem(menu('Freestyle'),'File')?.submenu||[])]},
  {label:'Movie',submenu:[off('Open Movie…',NO.movie,'⌥⌘O'),off('Remove Movie',NO.movie)]},null,
  {label:'Project Title…',run:findMenuItem(menu('File'),'Rename…')?.run,title:'The project title (the only general project setting Freestyle stores).'},null,
  off('Page Setup…',NO.print),off('Print…',NO.print,'⌘P')];
 const Edit=()=>[
  pick('TracksEdit','Undo'),pick('TracksEdit','Redo'),pick('TracksEdit','Undo History…'),null,
  pick('TracksEdit','Cut'),pick('TracksEdit','Copy'),pick('TracksEdit','Paste'),pick('TracksEdit','Delete'),pick('TracksEdit','Delete and Move'),pick('TracksEdit','Select All'),null,
  pick('TracksEdit','Regions at Playhead',{label:'Split Regions at Playhead'}),off('Join Regions',NO.join,'⌘J'),pick('TracksEdit','Repeat',{label:'Repeat Regions'}),null,
  off('Add to Loop Library…',NO.loop,'⌃⇧O')];
 const Track=()=>{
  const none=x.noTrack?.()||'';
  return[
   pick('Track','New Tracks…',{label:'New Track…'}),pick('Track','New Audio Track'),pick('Track','New Software Instrument Track'),pick('Track','New Track With Duplicate Settings'),pick('Track','Rename Track'),pick('Track','Delete Track'),null,
   off('Show Arrangement Track',NO.arrange,'⇧⌘A'),off('Show Movie Track',NO.movie,'⇧⌘O'),off('Show Transposition Track','Freestyle projects have no transposition track.','⇧⌘X'),
   pick('Track','Tempo Track',{label:'Show Tempo Track',title:'Opens Tempo & Time Signatures (Freestyle has no tempo track lane).'}),
   {label:'Show Master Track',shortcut:'⇧⌘M',disabled:!shell(),title:'Opens Smart Controls on the Master tab: master volume and the output’s plug-ins.',run:()=>shell()?.showMaster()},null,
   {label:'Show Track in Smart Controls',disabled:!shell()||!!none,title:none,run:()=>shell()?.toggle('smart',true)},
   off('Configure Track Header…','Track headers always show the icon, name, mute, solo, volume and pan.','⌥T')];
 };
 const Record=()=>{
  const count=findMenuItem(menu('Record'),'Count-in'),bars=(count?.submenu||[]).filter(item=>item&&/^(None|1 Bar|2 Bars)$/.test(norm(item)?.label||'')),metro=x.metronome?.()||{},cycle=x.cycle?.()||{},midi=findMenuItem(menu('Freestyle'),'MIDI Keyboard Input'),panic=findMenuItem(menu('Freestyle'),'Send All Notes Off (MIDI Panic)');
  return[
   {label:'Count-in',submenu:bars.length?bars:[off('None','Count-in is unavailable.')]},
   {label:'Metronome',shortcut:'K',checked:typeof metro.checked==='boolean'?metro.checked:undefined,disabled:!!metro.disabled,title:metro.disabled?'Open a Freestyle project to use the metronome.':'',run:metro.run},null,
   {label:'Record',shortcut:'R',run:x.record},{label:'Cycle',shortcut:'C',checked:typeof cycle.checked==='boolean'?cycle.checked:undefined,run:cycle.run},null,
   ...(midi?[midi]:[]),...(panic?[{...panic,label:'Send All Notes Off'}]:[]),
   off('Use Musical Grid','Recordings always follow the project tempo grid.')];
 };
 const Mix=()=>[
  pick('Mix','Show Automation'),off('Create Volume Fade Out on Main Output',NO.automation),off('Delete All Automation on Selected Track',NO.automation,'⌃⇧⌘⌫'),null,
  pick('Mix','Search and Add Plug-in…',{label:'Add Plug-in…'}),{label:'Show Master Track',shortcut:'⇧⌘M',disabled:!shell(),title:'Opens Smart Controls on the Master tab.',run:()=>shell()?.showMaster()}];
 const Share=()=>{
  const ready=!!x.ready?.(),need=ready?'':'Open a Freestyle project first.';
  return[
   off('Song to Music…',NO.share),off('Song to SoundCloud…',NO.share),off('AirDrop…',NO.share),off('Mail…',NO.share),null,
   {label:'Export Song to Disk…',shortcut:'⌘B',run:x.bounce,title:'Bounce the whole mix to an audio file (rendered in the Freestyle cloud).'},{label:'Export All MIDI Tracks…',run:x.exportAllMidi},null,
   ...(x.embedded?.()?[{label:'Share Project…',run:x.share}]:[]),
   {label:'Copy Project Link',run:x.copyLink,disabled:!ready,title:need},{label:'Share Settings…',run:x.shareSettings,disabled:!ready,title:need}];
 };
 const View=()=>[
  pane('library','Library','Y'),pane('smart','Smart Controls','B'),pane('editors','Editors','E'),pane('loops','Loop Browser','O'),pane('media','Media Browser','F','Project files and audio.'),pane('notes','Note Pad','⌥⌘P'),null,
  {label:'Show Piano Roll',shortcut:'P',disabled:!shell(),run:()=>shell()?.openEditor('piano')},{label:'Show Audio Editor',disabled:!shell(),run:()=>shell()?.openEditor('audio')},
  pick('Mix','Show Automation',{label:'Show Automation'}),null,
  {label:'Zoom to Fit',shortcut:'Z',run:findMenuItem(menu('Freestyle'),'Zoom to Fit')?.run},pick('View','Enter Full Screen')];
 const Window=()=>[
  off('Minimize',NO.os,'⌘M'),off('Zoom',NO.os),null,
  {label:x.typingOpen?.()?'Hide Musical Typing':'Show Musical Typing',shortcut:'⌘K',run:x.toggleTyping},pick('Window','All Plug-in Windows'),null,
  off('Bring All to Front',NO.os)];
 const Help=()=>[
  pick('Help','Street Band Help'),{label:'Quick Help',shortcut:'⇧/',checked:!!shell()?.shown('help'),disabled:!shell(),title:'Shows a short description of whatever is under the pointer.',run:()=>shell()?.toggle('help')},
  {label:'Key Commands…',shortcut:'⌥K',run:x.keyCommands},null,
  pick('Help','Street Band on the Web'),pick('Help','Create Support Profile…')];
 return{'Street Band':App,File,Edit,Track,Record,Mix,Share,View,Window,Help};
}
