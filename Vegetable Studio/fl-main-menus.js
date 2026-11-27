/** The eight main menus (File, Edit, Add, Patterns, View, Options, Tools, Help)
 * in the entry order, separators, names and shortcuts of the reference
 * desktop menu bar captured on 2026-11-17 (agent-coordination/daw-menus).
 *
 * Pure: `a` holds the commands the app can run, `s` the state and lists it
 * shows. An entry without a Freestyle operation keeps its place, disabled,
 * with the reason as its tooltip. Entries the reference does not have follow
 * in one trailing "Vegetable Studio" submenu. Product names in entry labels
 * are this product's own. No DOM, no I/O.
 */
import {patternSelectorMenuItems} from './fl-context-menus.js';

export const NOT_HERE='Not available in Vegetable Studio.';
const item=(label,shortcut,run,reason=null)=>({label,shortcut:shortcut||'',run:typeof run==='function'?run:()=>{},disabled:!!reason||typeof run!=='function',title:reason||(typeof run==='function'?'':NOT_HERE)});
const off=(label,shortcut='',reason=NOT_HERE)=>item(label,shortcut,null,reason);
const check=(label,shortcut,checked,run,reason=null)=>({...item(label,shortcut,run,reason),checked:!!checked});
const sub=(label,submenu,reason=null)=>({label,shortcut:'',submenu,disabled:!!reason,title:reason||''});
const own=(items,extra)=>extra?.length?[...items,null,sub('Vegetable Studio',extra)]:items;
const offAll=(labels,reason)=>labels.map(label=>label===null?null:off(label,'',reason));

export function fileMenuItems({a={},s={},extra=[]}={}){
 const templates='Freestyle has no project templates: New creates an empty project.',formats='Freestyle exports WAV (and MIDI from the patterns).',stems='Per-track export is not available: Freestyle has no stem export operation.';
 const recent=Array.isArray(s.recent)?s.recent.slice(0,10).map((row,index)=>item(row.title,`⌥${index===9?0:index+1}`,a.openRecent?()=>a.openRecent(row):null)):[off(s.recent===null?'Reading recent projects…':'No other projects','','Recent projects are read from your Freestyle library.')];
 const saves=Array.isArray(s.saves)&&s.saves.length?s.saves.map(row=>item(row.label,'',a.revert?()=>a.revert(row):null)):[off('No saves yet','','Use Save first: every save is a restorable snapshot.')];
 return own([
  item('New','',a.newProject),
  sub('New from template',[...['Advanced','Minimal','Other','Performance','Power User','Utility'].map(name=>sub(name,[off('(none)','',templates)],templates)),null,item('Empty','',a.newProject),null,off('Change default template...','',templates)]),
  item('Open...','⌘O',a.open),
  null,
  item('Save','⌘S',a.save),
  item('Save as...','⇧⌘S',a.saveAs),
  item('Save new version','⌘N',a.saveNewVersion),
  item('Save and back up to cloud','',a.save,a.save?null:NOT_HERE),
  off('Save to new project folder...','','Freestyle projects live in your cloud library, not in folders.'),
  off('Save as template...','',templates),
  off('Delete unused files and save project','','Freestyle manages project files in the cloud.'),
  null,
  sub('Import',[item('MIDI file...','',a.importMidi)]),
  sub('Export',[
   null,item('Wave file...','⌘R',a.exportWav),off('MP3 file...','⇧⌘R',formats),off('OGG file...','',formats),off('FLAC file...','',formats),item('MIDI file...','⇧⌘M',a.exportMidi),off('M4A file...','',formats),off('Last exported format(s)...','',formats),
   null,off('Master...','⌥⌘M','Mastering is not available in Vegetable Studio.'),
   null,off('Upload...','','Use Vegetable Studio ▸ Freestyle project tools… to publish.'),
   null,sub('All playlist tracks',offAll(['From song start...','From track start...','Time selection...'],stems)),sub('All playlist track groups',offAll(['From song start...','From track start...','Time selection...'],stems)),
   null,off('Video file...','',formats),
   null,off('Zipped loop package...','',formats),off('Project bones...','',formats),off('Project data files...','',formats)]),
  null,
  ...recent,
  null,
  sub('Revert to last backup',saves,s.ready===false?'Open a Freestyle project first.':null),
  null,
  off('Exit','⌘Q','Close the browser tab to leave Vegetable Studio.')
 ],extra);
}

export function editMenuItems({a={},s={},extra=[]}={}){
 const none=s.editor?null:'Click the Channel rack, Piano roll or Playlist first.';
 return own([
  // The reference shows ONE history entry here, named after the last step ("Undo …" / "Redo …", ⌥⌘Z); Redo is in the trailing group.
  item(s.undoLabel||'Undo','⌥⌘Z',a.undo),
  null,
  item('Cut','⌘X',a.cut,none),item('Copy','⌘C',a.copy,none),item('Paste','⌘V',a.paste,none)
 ],extra);
}

/** `generators` / `effects` are [{category, entries:[menu items]}] from the Freestyle catalog. */
export function addMenuItems({a={},s={},generators=[],effects=[],generatorNote=null,effectNote=null,extra=[]}={}){
 const view='The plugin lists are always grouped by category.',modes=[check('Categories','',true,null,view),check('Simple','',false,null,view),check('Tree','',false,null,view)];
 const grouped=(groups,note)=>groups.length?groups.flatMap(group=>[null,...group.entries]):[null,off(note||'No plugins available','','The Freestyle catalog is empty for this project.')];
 return own([
  null,
  item('More plugins...','',a.morePlugins),
  ...grouped(generators,generatorNote),
  null,
  ...modes,
  null,
  sub('Effect',[item('More plugins...','',a.moreEffects,s.effectReason||null),item('Plugin database','⇧F8',a.browseDatabase),...grouped(effects,effectNote),null,...modes]),
  item('Plugin picker','F8',a.pluginPicker),
  item('Browse plugin database','',a.browseDatabase),
  item('Browse all installed plugins','',a.browseDatabase),
  item('Browse presets','',a.browsePresets),
  null,
  item('Refresh plugin list (fast scan)','',a.refreshPlugins),
  off('Manage plugins','','Plug-ins are installed on the Freestyle engine host.'),
  off('Manage cloud plugins...','','Plug-ins are installed on the Freestyle engine host.'),
  null,
  item('Automation for last tweaked parameter','',a.automateLastTweaked,s.lastTweakedReason||null),
  null,
  item('Pattern','',a.addPattern)
 ],extra);
}

export function patternsMenuItems({run={},reasons={},extra=[]}={}){
 const items=patternSelectorMenuItems({run,reasons});
 return own(items,extra);
}

export function viewMenuItems({a={},s={},extra=[]}={}){
 const toolbar='The toolbar has one layout in Vegetable Studio.',news='Not available in Vegetable Studio.';
 return own([
  null,
  check('Playlist','F5',s.playlist,a.playlist),check('Piano roll','F7',s.piano,a.piano),check('Channel rack','F6',s.rack,a.rack),check('Mixer','F9',s.mixer,a.mixer),check('Browser','⌥F8',s.browser,a.browser),
  item('Project picker','⌘F8',a.projectPicker),item('Plugin picker','F8',a.pluginPicker),item('Tempo tapper','',a.tempoTapper),
  off('Touch controller','','Use the typing keyboard (⌘T) or a MIDI keyboard.'),off('Script output','','Scripting is not available in Vegetable Studio.'),
  sub('Toolbars',[null,...offAll(['Edit','Separators','Flat buttons','Show cloud status in the hint bar','Show detected MIDI chords near the hint bar',null,'Hint bar','Hide',null,'Compact','Default (hint above menu)','Default (macOS)','Default','Single line centered','Single line'],toolbar)]),
  off('Tests','','Not available in Vegetable Studio.'),
  off('Plugin performance monitor','','Plug-ins run on the Freestyle engine, not in this browser.'),
  item('Welcome to Vegetable Studio','',a.welcome),
  null,
  item('Close all windows','F12',a.closeAll),item('Close all plugin windows','⌥F12',a.closePlugins),item('Close all unfocused windows','',a.closeUnfocused),
  off('Align all channel editors','','Plug-in windows keep the place you give them.'),
  sub('Arrange windows',[item('Realign','⇧⌘H',a.arrange),off('Into workspace','','Windows are always inside the workspace.'),null,item('Desktop (default)','',a.arrange),off('Desktop (alternate)'),off('Tablet (default)'),off('Tablet (alternate)'),...(s.layouts?.length?s.layouts.map(layout=>item(layout.label,'',layout.run)):[off('Custom','','Save a custom layout first.')]),null,item('Save custom layout','',a.saveLayout),...(s.deleteLayouts?.length?[sub('Delete custom layout',s.deleteLayouts.map(layout=>item(layout.label,'',layout.run)))]:[])]),
  sub('Background',offAll(['Set image wallpaper...','Set dynamic wallpaper','Set background color...'],'The workspace background follows the theme.')),
  null,
  item('Undo history','',a.undoHistory),item('Patterns','',a.browsePatterns),item('Generators in use','',a.browseGenerators),item('Effects in use','',a.browseEffects),
  off('Remote control','','Not available in Vegetable Studio.'),
  item('Plugin database','⇧F8',a.browseDatabase),
  null,
  off('Downloads','',news),off('News','',news),off('Notifications','',news),
  check('Enter Full Screen','⌃⌘F',s.fullscreen,a.fullscreen)
 ],extra);
}

export function optionsMenuItems({a={},s={},extra=[]}={}){
 const account='Your account is managed on freestyle.audio.';
 return own([
  null,
  item('MIDI settings','F10',a.midiSettings,s.midiReason||null),item('Audio settings','',a.audioSettings),item('General settings','',a.generalSettings),
  off('File settings','','Freestyle projects and sounds live in the cloud library.'),off('Theme settings','','Vegetable Studio has one theme.'),off('Manage plugins','','Plug-ins are installed on the Freestyle engine host.'),
  null,
  item('Project general settings','',a.projectSettings),item('Project info','F11',a.projectInfo),
  null,
  item('Debugging log','',a.debugLog),off('Account settings','',account),
  null,
  check('Enable MIDI remote control','',s.midiInput,a.toggleMidiInput,s.midiReason||null),
  check('Enable MIDI output','',false,null,'MIDI output to hardware is not available: instruments play on the Freestyle engine.'),
  check('Enable MIDI master sync','',false,null,'MIDI clock sync is not available.'),
  null,
  check('Typing keyboard to piano','⌘T',s.typing,a.toggleTyping),
  check('Metronome','⌘M',s.metronome===true,a.toggleMetronome,s.metronomeReason||null),
  check('Recording precount','⌘P',s.precount,a.togglePrecount),
  check('Start on input','⌘I',false,null,'Recording starts with the transport (use the precount).'),
  check('Blend recorded notes','⌘B',true,null,'Recorded notes are always added to the pattern.'),
  check('Step edit','⌘E',s.stepEdit,a.toggleStepEdit),
  check('Loop record','',s.loopRecord,a.toggleLoopRecord),
  check('Auto scrolling','',false,null,'The Playlist does not follow the play position.'),
  check('Enable groups','⇧⌥G',true,null,'Grouped clips always select and move together.'),
  check('Multilink to controllers','⌘J',false,null,'Link one control at a time: right-click a control ▸ Link to controller…'),
  null,
  off('Manage accounts...','',account)
 ],extra);
}

export function toolsMenuItems({a={},s={},lastTweaked=null,extra=[]}={}){
 const logging='Audio logging is not available: the audio runs on the Freestyle engine.',stretch='Freestyle stretches audio clips in the cloud: there are no per-channel stretch modes.',modes=['Resample','Stretch','Stretch Pro',null,'e3 generic','e3 mono',null,'Slice stretch','Slice map','Auto',null,'e2 generic','e2 transient','e2 mono','e2 speech'];
 const tweaked=['Edit events','Edit events in new window','Edit events in piano roll','Init song with this position','Delete initial value',null,'Create automation clip','Edit automation clip...',null,'Link to controller...','Override global link...',null,'Copy value','Paste value','Type in value...','Set...',null,'Override volatile link...'];
 const minutes=[2,5,10,20,30].map(n=>item(`Last ${n} minutes`,'',a.dumpScoreLog&&n<=(s.scoreLogMinutes||5)?()=>a.dumpScoreLog(n):null,n<=(s.scoreLogMinutes||5)?s.scoreLogReason||null:`The score log keeps the last ${s.scoreLogMinutes||5} minutes.`));
 return own([
  item('Browser find...','⌘F',a.browserFind),
  sub('One-click audio recording',[null,off('Into audio editor/recorder','','The audio editor is not available: recordings go to the Playlist.'),item('Into playlist as an audio clip','',a.record)]),
  off('Remix a song...','','Not available in Vegetable Studio.'),off('Riff machine...','','Not available in Vegetable Studio.'),
  item('Chord progression tool...','',a.chordProgression),off('Control creator','','Not available in Vegetable Studio.'),
  null,
  item('Sounds','',a.sounds),off('Mastering...','','Not available in Vegetable Studio.'),off('Distribution...','','Use File ▸ Vegetable Studio ▸ Freestyle project tools… to publish.'),off('Manage cloud plugins...','','Plug-ins are installed on the Freestyle engine host.'),off('My account...','','Your account is managed on freestyle.audio.'),
  null,
  off('Save audio clipboard to browser','','There is no audio clipboard.'),off('Save MIDI clipboard to browser','','Use File ▸ Export ▸ MIDI file...'),
  null,
  sub('Dump score log to selected pattern',minutes),item('Clear log','',a.clearScoreLog),
  null,
  check('Enabled','',false,null,logging),sub('Settings',[null,...offAll(['1 minute','2 minutes','5 minutes','10 minutes',null,'Pre effects','Post effects, pre fader'],logging)]),off('Dump to audio editor','',logging),
  null,
  lastTweaked||sub('Last tweaked',[null,null,...offAll(tweaked,'Move a control first.')],'Move a mixer or plug-in control first.'),
  sub('Next to last tweaked',[null,null,...offAll(tweaked,'Only the last tweaked control is remembered.')],'Only the last tweaked control is remembered.'),
  null,
  item('Stop sound','⌘H',a.stopSound),item('Cancel recording','',a.cancelRecording,s.recording?null:'Nothing is recording.'),
  null,
  off('Prepare for performance mode','','Performance mode is not available in Freestyle.'),off('Prepare for MIDI export','','File ▸ Export ▸ MIDI file... needs no preparation.'),
  item('Select unused channels','',a.selectUnused),
  off('Purge unused audio clips','','Freestyle manages stored audio in the cloud.'),off('Switch smart disable for all plugins','','Plug-ins run on the Freestyle engine.'),
  sub('Switch all audio clip channels to',[null,...offAll(modes,stretch)],stretch),sub('Switch selected audio clip channels to',[null,...offAll(modes,stretch)],stretch),
  off('Lock all playlist tracks to content'),off('Unlock all playlist tracks from content'),off('Reset empty playlist tracks','','Freestyle tracks have no colour or icon to reset.'),
  off('Remove all audio editor instances','','The audio editor is not a plug-in here.'),off('Delete unused files and save project','','Freestyle manages project files in the cloud.'),
  sub('Switch all plugin editors to',offAll(['Attached','Detached'],'Plug-in windows are always floating windows.')),
  sub('Set keyboard focus for all plugins to',offAll(['Enabled','Disabled'],'A plug-in window takes the keyboard while you click in it.')),
  sub('Change declicking for selected channels to',offAll(['Out only (no bleeding)','Transient (no bleeding)','Transient (bleeding)','Generic (bleeding)','Smooth (bleeding)','Crossfade (bleeding)'],'Declicking modes are not available in Freestyle.'))
 ],extra);
}

export function helpMenuItems({a={},extra=[]}={}){
 return own([
  item('Help index','F1',a.help),
  item('Chat assistant','',a.assistant,a.assistant?null:'The assistant is available when Vegetable Studio runs inside Freestyle.'),
  sub('Tutorials',[off('Loop starter tutorial','','Loop Starter is not available in Vegetable Studio.'),item('Step sequencer tutorial','',a.help)]),
  null,
  off('Unlock Vegetable Studio','','Nothing to unlock: Vegetable Studio is included with Freestyle.'),off('My account','','Your account is managed on freestyle.audio.'),
  null,
  item('Diagnostics','',a.diagnostics),off('What\'s new','','Not available in Vegetable Studio.'),
  null,
  off('Buy Vegetable Studio and upgrades','','Nothing to buy: Vegetable Studio is included with Freestyle.'),
  null,
  item('Freestyle homepage','',a.homepage),off('Vegetable Studio Mobile','','There is no mobile edition.'),item('Vegetable Studio tutorials','',a.documentation),off('Support - Forum','','Use the Freestyle documentation.'),item('Support - Knowledgebase','',a.documentation),
  null,
  item('About...','',a.about)
 ],extra);
}
