/** Application menus of Trashlab: File, Edit, Track, Navigate, Record, Mix, View, Window, Help.
 *
 * Entry names, order, separators, submenus and shortcuts follow the reference workstation's
 * menu bar (captured from the running application's menu structure). Entries Freestyle cannot
 * perform stay in place, disabled, with the reason as their tooltip. Everything the reference
 * has no entry for lives in the Freestyle menu (app.js), which sits before Help.
 *
 * Pure data builder: `actions` supplies the callbacks and state readers; nothing here does I/O.
 * macOS-injected entries (Edit ▸ AutoFill / Start Dictation / Emoji & Symbols, the Window
 * document list) are not part of the application's own menus and are left out.
 */
export const MAIN_MENU_ORDER=Object.freeze(['File','Edit','Track','Navigate','Record','Mix','View','Window','Freestyle','Help']);
const off=(label,title,shortcut='')=>({label,shortcut,disabled:true,title});
/** A disabled group heading inside a submenu ("Cycle Off", "Cycle On"). */
const heading=label=>({label,disabled:true,title:''});
const NO={
 template:'Freestyle has no project templates.',movie:'Freestyle projects have no movie track.',marker:'Freestyle projects have no markers.',
 global:'Freestyle projects have no global tracks (tempo and signature are in Freestyle ▸ Track ▸ Tempo & Time Signatures…).',stack:'Freestyle has no track stacks.',hide:'Freestyle cannot hide tracks.',
 sort:'Tracks keep the order you drag them into.',score:'There is no Score Editor.',list:'There are no List Editors.',group:'Freestyle has no mixer groups.',
 auto:'Add, move and delete automation points in the track’s automation lane (A).',convert:'Freestyle has one automation kind per target; nothing to convert.',os:'macOS and the browser own this window command.',
 take:'Freestyle keeps one recording per region; there are no take folders.',share:'Use Freestyle ▸ Project for the project link and collaborators.',place:'Freestyle bounces the whole mix (⌘B); bounce in place is not available.',
 exportTrack:'Freestyle bounces the whole mix (⌘B); per-track and per-region export is not available.',cloud:'Freestyle stores project audio in the cloud.',smart:'Smart Controls are not available for Freestyle cloud tracks.',
 alt:'Freestyle has no track alternatives.',punch:'Freestyle recording has no punch-in.',tile:'macOS window tiling applies to the browser window.',playButton:'Space plays from the playhead; ⇧Space plays from the selection.',
 stopButton:'Stop always stops at the current position; Return goes to the beginning.',overlapMidi:'A new MIDI take always becomes its own region on the same track.',overlapAudio:'A new audio take always becomes its own region on the same track.',
 autoLocators:'Set the locators from a selection with ⌘U or U.',help:'See Freestyle ▸ Freestyle Documentation.',
};
export const MAIN_MENU_REASONS=NO;

export function logicMainMenus(a){
 const key=(label,shortcut,name,args=[],{disabled=false,title=''}={})=>({label,shortcut,run:()=>a.command(name,args),disabled,title});
 const File=()=>{
  const noMidi=a.noMidiSelection();
  return[
   {label:'New',shortcut:'⇧⌘N',run:a.newProject},off('New from Template…',NO.template,'⌘N'),{label:'Open…',shortcut:'⌘O',run:a.open},off('Open Recent','Recent projects are listed in File ▸ Open… (⌘O).'),null,
   off('Close',NO.os,'⌘W'),off('Close Project','Projects stay open in Freestyle; choose another with Open… (⌘O).','⌥⌘W'),{label:'Save',shortcut:'⌘S',run:a.save},{label:'Save As…',shortcut:'⇧⌘S',run:a.saveAs},off('Save A Copy As…','Save As… (⇧⌘S) already saves a separate copy in your Freestyle library.'),off('Save as Template…',NO.template),{label:'Revert to',submenu:a.revertItems()},null,
   {label:'Project Alternatives',submenu:[off('New Alternative…','Saved versions are under File ▸ Revert to.'),off('Edit Alternatives…','Saved versions are under File ▸ Revert to.')]},
   {label:'Project Management',submenu:[off('Clean Up…',NO.cloud+' There is nothing to clean up.'),off('Consolidate…',NO.cloud+' There is nothing to consolidate.'),{label:'Rename…',run:a.renameProject},off('Show in Finder…','The project lives in your Freestyle library, not on this disk.')]},
   {label:'Project Settings',submenu:[{label:'General…',run:a.renameProject,title:'The project title (the only general project setting Freestyle stores).'},{label:'Audio…',run:a.audioInfo},{label:'Recording…',run:a.openRecordMenu,title:'Count-in is set in the Record menu.'},off('Smart Tempo…','Freestyle has no Smart Tempo.'),{label:'MIDI…',shortcut:a.midiLabel(),run:a.toggleMidi,disabled:!a.midiSupported(),title:'Switch the MIDI keyboard input on or off.'},off('Score…',NO.score),off('Movie…',NO.movie),off('Synchronization…','Freestyle has no external synchronisation.'),off('Metronome…','The metronome has one switch: the Click button (K).'),off('Tuning…','Freestyle has no project tuning.'),off('Assets…',NO.cloud),null,off('Import Project Settings…','Freestyle projects have no importable settings.')]},null,
   off('Page Setup…',NO.score),off('Print',NO.score,'⌘P'),null,
   {label:'Movie',submenu:[off('Open Movie…',NO.movie,'⌥⌘O'),off('Remove Movie',NO.movie),null,off('Show in Finder',NO.movie),off('Move Movie Files out of Project…',NO.movie),null,off('Import Audio from Movie',NO.movie),off('Export Audio to Movie…',NO.movie)]},null,
   {label:'Import',submenu:[off('Project Packages…','Use Other… (⌘I) to import a project archive from another workstation (.flp or a zipped project package).'),off('Live Loops Grid…','There is no Live Loops grid.'),{label:'Audio File…',shortcut:'⇧⌘I',run:a.importAudio},{label:'MIDI File…',run:a.importMidi},off('MusicXML…',NO.score),null,off('Final Cut Pro XML…','Freestyle cannot read Final Cut Pro XML.'),off('AAF…','Freestyle cannot read AAF files.'),off('Create Project from ADM BWF…','Freestyle mixes in stereo; it cannot read ADM BWF files.'),{label:'Other…',shortcut:'⌘I',run:a.importOther,title:'Choose a MIDI file, an audio file or a project archive (.flp, .zip, .logicx).'}]},
   {label:'Export',submenu:[off('Add to Browser…','The Browser lists Freestyle’s catalogue; regions cannot be added to it.','⌃⇧O'),off('Regions as Audio Files…',NO.exportTrack),off('Audio Files As…',NO.exportTrack),null,off('Selection as Audio File…',NO.exportTrack),{label:'Selection as MIDI File…',shortcut:'⌥⌘E',run:a.exportSelectionMidi,disabled:noMidi,title:noMidi?'Select MIDI or pattern regions first.':''},off('Selected Track(s) as MainStage Patch…','Freestyle has no patch export.'),off('Selected Track(s) as MainStage Set…','Freestyle has no patch export.'),null,off('Tracks as Audio Files…',NO.exportTrack,'⌘E'),off('All Tracks as Audio Files…',NO.exportTrack,'⇧⌘E'),{label:'All MIDI Tracks as MIDI File…',run:a.exportAllMidi},null,off('Project as AAF File…','Freestyle cannot write AAF files.'),off('Project to Final Cut Pro XML…','Freestyle cannot write Final Cut Pro XML.'),off('Project as Spatial Audio…','Freestyle mixes in stereo.'),off('Score as MusicXML…',NO.score)]},
   {label:'Bounce',submenu:[off('Regions in Place…',NO.place,'⌃B'),off('Tracks in Place…',NO.place,'⌃⌘B'),off('And Replace All Tracks…',NO.place),null,{label:'Project or Section…',shortcut:'⌘B',run:a.bounce}]},
   {label:'Share',submenu:[off('Song to iTunes…',NO.share),off('Song to Voice Memos…',NO.share),null,off('AirDrop…',NO.share),off('Mail…',NO.share),null,off('Project to Mobile App…',NO.share)]}];
 };
 const Edit=()=>{
  const any=a.anySelected(),none=any?'':'Select one or more regions first.',canUndo=a.canUndo(),canRedo=a.canRedo();
  return[
   {label:'Undo',shortcut:'⌘Z',run:a.undo,disabled:!canUndo,title:canUndo?'':'There is nothing to undo.'},{label:'Redo',shortcut:'⇧⌘Z',run:a.redo,disabled:!canRedo,title:canRedo?'':'There is nothing to redo.'},{label:'Undo History…',shortcut:'⌃⌥⌘Z',run:a.undoHistory},off('Delete Undo History','The session history is cleared when the project is reloaded.'),null,
   {label:'Cut',shortcut:'⌘X',run:a.cut,disabled:!any,title:none},{label:'Copy',shortcut:'⌘C',run:a.copy,disabled:!any,title:none},{label:'Paste',shortcut:'⌘V',run:a.paste},{label:'Delete',run:a.delete,disabled:!any,title:none},null,
   {label:'Select All',shortcut:'⌘A',run:a.selectAll}];
 };
 const Track=()=>{
  const noTrack=a.noTrack(),duplicate=a.duplicateBlock(),mixer=a.mixerFocused();
  return[
   {label:'New Tracks…',shortcut:'⌥⌘N',run:a.newTracks},{label:'New Audio Track',shortcut:'⌥⌘A',run:a.newAudioTrack},{label:'New Software Instrument Track',shortcut:'⌥⌘S',run:a.newInstrumentTrack},off('New Session Player SI Track…','Freestyle has no session players.','⌥⌘P'),off('New External MIDI Track','A browser has no external MIDI outputs for Freestyle tracks.','⌥⌘X'),
   {label:'Other',submenu:[{label:'New Track With Duplicate Settings',shortcut:'⌘D',run:a.duplicateTrack,disabled:!!duplicate,title:duplicate||'An empty track below with the same channel strip: instrument and patch, effects, sends, volume, pan and output.'},{label:'New Track With Duplicate Settings and Content',shortcut:'⌥⇧⌘D',run:a.duplicateTrackContent,disabled:!!duplicate,title:duplicate||'A full copy below, with its regions and patterns.'},off('New Track With Next Channel','Every Freestyle track has its own channel strip; use ⌘D.','⌃↩'),off('New Track With Same Channel','Every Freestyle track has its own channel strip; use ⌘D.','⌃⇧↩'),null,off('New Track For Overlapped Regions','Drag overlapped regions to another track.'),off('New Track For Selected Regions','Create a track (⌥⌘N), then press ⌃⇧T (Move Selected Regions to Focused Track).')]},
   {label:'Rename Track',shortcut:'⇧↩',run:a.renameTrack,disabled:!!noTrack&&!mixer,title:mixer?'':noTrack||''},null,
   {label:'Delete Track',shortcut:'⌘⌫',run:a.deleteTrack,disabled:!!noTrack,title:noTrack||''},key('Delete Unused Tracks','⇧⌘⌫','delete-unused-tracks'),null,
   off('Create Track Stack…',NO.stack,'⇧⌘D'),off('Flatten Stack',NO.stack,'⇧⌘U'),off('Convert Folder Stack to Summing Stack',NO.stack),null,
   {label:'Global Tracks',submenu:[off('Global Tracks',NO.global,'G'),off('Configure Global Tracks…',NO.global,'⌥G'),off('Show Single Global Track',NO.global,'⌃⌥⌘G'),null,off('Arrangement Track',NO.global,'⇧⌘A'),off('Marker Track',NO.marker,'⇧⌘K'),off('Movie Track',NO.movie,'⇧⌘O'),off('Signature Track',NO.global),off('Chord Track',NO.global,'⇧⌘C'),off('Transposition Track',NO.global),{label:'Tempo Track',shortcut:'⇧⌘T',run:a.timing,title:'Opens Tempo & Time Signatures (Freestyle has no tempo track lane).'},off('Beat Mapping Track',NO.global,'⇧⌘B')]},
   off('Track Alternatives',NO.alt),off('Master Track','The master channel strip (Stereo Out) is in the Inspector and the Mixer.','⇧⌘M'),null,
   off('Replace or Double Drum Track…','Freestyle has no drum replacement.','⌃D'),off('Convert Regions to New Sampler Track…','Use the region menu ▸ Add to Step Sequencer.','⌃E'),null,
   off('Search and Select Track…','There is no track search; click a track header.','⌃⌘T'),off('Hide/Show Selected Tracks',NO.hide,'⌃H'),off('Hide/Show Unselected Tracks',NO.hide),off('Unhide All Tracks',NO.hide,'⌃⇧H'),off('Toggle Hide View',NO.hide,'H'),null,
   {label:'Sort Tracks by',submenu:['MIDI Channel','Audio Channel','Output Channel','Instrument Name','Track Name','Used, Unused','Creation Date'].map(label=>off(label,NO.sort))},off('Assign Track Color…','Freestyle tracks have no colour field.'),off('Assign Track Icon…','Track icons follow the track type.'),off('Configure Track Header…','Track headers always show number, icon, name, M S R I, volume and pan.','⌥T')];
 };
 const Navigate=()=>{
  const any=a.anySelected(),none=any?'':'Select one or more regions first.',sel={disabled:!any,title:none},scenes=last=>[off('Auto Range',NO.movie),null,off('Marquee Selection',NO.movie),off('Cycle Area',NO.movie),off('Selected Regions',NO.movie),null,off(last,NO.movie)];
  return[
   {label:'Go To',submenu:[{label:'Position…',shortcut:'/',run:a.goToPosition},null,key('Left Locator','⌃⇧,','go-to-locator',['left']),key('Right Locator','⌃⇧.','go-to-locator',['right']),null,key('Selection Start','⌃↖','go-to-selection',['start'],sel),key('Selection End','⌃↘','go-to-selection',['end'],sel),null,off('Next Marker',NO.marker),off('Previous Marker',NO.marker),off('Marker Number…',NO.marker,'⌥/')]},null,
   key('Scroll to Selection','⇧`','scroll-to-selection',[],sel),{label:'Set Locators by Selection and Enable Cycle',shortcut:'⌘U',run:()=>a.setLocators(false),...sel},{label:'Set Rounded Locators by Selection and Enable Cycle',shortcut:'U',run:()=>a.setLocators(true),...sel},null,
   key('Move Locators Forward by Cycle Length','⇧⌘.','move-locators',['1']),key('Move Locators Backwards by Cycle Length','⇧⌘,','move-locators',['-1']),null,
   off('Create Marker',NO.marker,'⌥\''),
   {label:'Other',submenu:[off('Create Marker for Region/Marquee Selection',NO.marker,'⌥⇧\''),off('Create Without Rounding',NO.marker,'⌃⌥\''),null,off('Import Marker from Audio File',NO.marker),off('Export Marker to Audio File',NO.marker),off('Remove Marker from Audio File',NO.marker),null,{label:'Create Movie Scene Cut Markers',submenu:scenes('Entire Movie')},{label:'Remove Movie Scene Cut Markers',submenu:scenes('All Scene Markers')}]},
   off('Rename Marker',NO.marker,'⇧\''),off('Delete Marker at Playhead Position',NO.marker,'⌥⌫'),null,
   off('Open Marker List',NO.marker),off('Open Marker Text',NO.marker),null,
   {label:'Play Button Options',submenu:[off('Play from Marquee Selection',NO.playButton),off('Play from Cycle Start',NO.playButton),off('Play From Selected Region',NO.playButton),off('Play From Last Locate Position',NO.playButton)]},
   {label:'Stop Button Options',submenu:[{label:'Stop',checked:true,disabled:true,title:NO.stopButton},off('Stop and Go to Left Locator',NO.stopButton),off('Stop and Go to Last Locate Position',NO.stopButton),null,off('Jump between Marquee- and Project Start if stopped',NO.stopButton),off('Jump between Cycle- and Project Start if stopped',NO.stopButton),off('Jump between Selected Region- and Project Start if stopped',NO.stopButton),off('Jump between Last Locate Position and Project Start if stopped',NO.stopButton)]},null,
   {label:'Auto Set Locators',submenu:[off('By Marquee Selection','There is no Marquee tool.'),off('By Region Selection',NO.autoLocators),off('By Marker/Chord Selection',NO.marker),off('By Note Selection',NO.autoLocators),null,off('Enable Auto Set Locators',NO.autoLocators)]}];
 };
 const Record=()=>{
  const count=a.countIn(),bars=[0,1,2,3,4,5,6],names=bar=>bar===0?'None':bar===1?'1 Bar':`${bar} Bars`;
  return[
   {label:'Count-in',submenu:[...bars.map(bar=>{const choice=count.choices.find(item=>item.bars===bar);return choice?{label:names(bar),checked:choice.checked,disabled:choice.disabled,title:choice.title,run:choice.run}:off(names(bar),'Count-in is None, 1 Bar or 2 Bars.');}),null,...[1,2,3,4,5,6,7,8,9].map(beats=>off(`${beats}/4`,'Count-in is counted in whole bars.'))]},off('Metronome Settings…','The metronome has one switch: the Click button (K).'),null,
   off('Use Musical Grid','Recordings always follow the project tempo grid.'),off('Allow Quick Punch-In',NO.punch),off('Auto Input Monitoring','Input monitoring is not available for cloud tracks.'),off('Low Latency Monitoring Mode','Freestyle renders in the cloud; there is no low latency mode switch.'),null,
   {label:'Record Button Options',submenu:[{label:'Record',checked:true,disabled:true,title:'R starts a recording; R or Space ends it.'},off('Record / Record Toggle','R starts and ends a recording.'),off('Record / Record Repeat','Freestyle has no record repeat.')]},
   {label:'Overlapping MIDI Recordings',submenu:[heading('Cycle Off'),off('Create Take Folder',NO.take),off('Merge',NO.overlapMidi),{label:'Overlap',checked:true,disabled:true,title:NO.overlapMidi},off('Overlap/Merge Selected Regions',NO.overlapMidi),off('Create Track',NO.overlapMidi),off('Create Track Alternative',NO.alt),null,heading('Cycle On'),off('Create Take Folder',NO.take),off('Merge',NO.overlapMidi),off('Merge Current Recording Only',NO.overlapMidi),off('Create Tracks',NO.overlapMidi),off('Create Tracks and Mute',NO.overlapMidi),off('Create Track Alternatives',NO.alt),null,heading('Replace'),off('Region Erase','Freestyle recording always adds a new region; there is no Replace mode.'),off('Region Punch',NO.punch),off('Content Erase','Freestyle recording always adds a new region; there is no Replace mode.'),off('Content Punch',NO.punch)]},
   {label:'Overlapping Audio Recordings',submenu:[heading('Cycle Off'),off('Create Take Folder',NO.take),off('Create New Track',NO.overlapAudio),off('Create Track Alternative',NO.alt),null,heading('Cycle On'),off('Create Take Folder',NO.take),off('Create Tracks And Mute',NO.overlapAudio),off('Create Track Alternatives',NO.alt)]},
   off('Recording Settings…','Count-in is the only recording setting (Record ▸ Count-in).')];
 };
 const Mix=()=>[
  {label:'Show Automation',shortcut:'A',checked:a.automationShown(),run:a.toggleAutomation},
  {label:'Create Track Automation',submenu:[off('Create 1 Automation Point at Region Borders',NO.auto,'⌃⇧⌘1'),off('Create 2 Automation Points at Region Borders',NO.auto,'⌃⇧⌘2'),null,off('Create 1 Automation Point each for Volume, Pan, Sends',NO.auto),off('Create 2 Automation Points each for Volume, Pan, Sends',NO.auto),off('Create 1 Automation Point for Visible Parameter',NO.auto),off('Create 2 Automation Points for Visible Parameter',NO.auto),null,off('Create Volume Fade-Out on Main Output',NO.auto)]},
  {label:'Convert Automation',submenu:[off('Convert Visible Track Automation to Region Automation',NO.convert,'⌃⌘↓'),off('Convert Visible Region Automation to Track Automation',NO.convert,'⌃⌘↑'),null,off('Convert All Track Automation to Region Automation',NO.convert,'⌃⇧⌘↓'),off('Convert All Region Automation to Track Automation',NO.convert,'⌃⇧⌘↑')]},
  {label:'Delete Automation',submenu:[off('Delete Visible Automation on Selected Tracks',NO.auto,'⌃⌘⌫'),off('Delete All Automation on Selected Tracks',NO.auto,'⌃⇧⌘⌫'),off('Delete Orphaned Automation on Selected Tracks','Freestyle keeps no orphaned automation.','⌃⇧⌫'),off('Delete Redundant Automation Points',NO.auto,'⌃⌫'),off('Delete All Track Automation',NO.auto)]},null,
  {label:'Move Track Automation with Regions',submenu:[{label:'Never',checked:true,disabled:true,title:'Automation stays on the track when regions move.'},off('Always','Automation stays on the track when regions move.'),off('Ask','Automation stays on the track when regions move.')]},off('Enable Automation Quick Access','There is no hardware controller quick access.','⌃⌥⌘A'),off('Autoselect Automation Parameter in Read Mode','Freestyle automation has no Read / Touch / Latch modes.'),off('Automation Settings…','There are no automation settings; open Track Automation (A).'),null,
  off('Group Settings',NO.group,'⌥⇧G'),off('Groups Active',NO.group,'⇧G'),off('Create Group',NO.group,'⌃⌘G'),off('I/O Labels…','Freestyle has one stereo output; there are no I/O labels.'),off('I/O Assignments…','Freestyle has one stereo output; there are no I/O assignments.'),off('Pre-Fader Metering','Meters show the post-fader cloud signal.'),null,
  {label:'Search and Add Plug-in…',shortcut:'⌃⌘P',run:a.addPlugin},off('Mastering Assistant…','Freestyle has no mastering assistant.'),null,
  off('Dolby Atmos…','Freestyle mixes in stereo.')];
 const View=()=>[
  {label:'Browser',shortcut:'B',checked:a.pane('library'),run:()=>a.togglePane('library'),title:'The Library: patches, instruments and sounds.'},{label:'Inspector',shortcut:'I',checked:a.pane('inspector'),run:()=>a.togglePane('inspector')},null,
  {label:'Mixer',shortcut:'X',checked:a.mixerVisible(),run:a.toggleMixer},off('Smart Controls',NO.smart,'Y'),{label:'Editor',shortcut:'E',checked:a.editorVisible(),run:a.toggleEditor},null,
  off('List Editors',NO.list,'D'),off('Note Pads',a.notePadReason,'⌃⇧P'),{label:'Project Files',shortcut:'O',checked:a.pane('browser'),run:()=>a.togglePane('browser'),title:'The All Files browser.'},null,
  {label:'Control Bar',checked:true,disabled:true,title:'The control bar is always shown.'},off('Customize Control Bar and Display…','Choose the display mode from the LCD’s own menu (click its right edge).'),null,
  off('Toolbar','There is no customisable toolbar; its commands are in the menus.','⌃⌥⌘T'),off('Customize Toolbar…','There is no customisable toolbar.'),null,
  off('Movie Window',NO.movie),off('Colors','Freestyle regions and tracks have no colour field.','⌥C'),null,
  {label:'Enter Full Screen',shortcut:'fn F',run:a.fullScreen,title:'Also ⌃⌘F (a browser page cannot read the fn key).'}];
 const Window=()=>{
  const piano=a.pianoFocused(),tiles=labels=>labels.map(label=>off(label,NO.tile));
  return[
   off('Minimize',NO.os,'⌘M'),off('Minimize All',NO.os,'⌥⌘M'),off('Zoom',NO.os,'⌃⌘M'),off('Zoom All',NO.os,'⌃⌥⌘M'),off('Fill',NO.tile,'fn ⌃F'),off('Center',NO.tile,'fn ⌃C'),null,
   {label:'Move & Resize',submenu:[heading('Halves'),...tiles(['Left','Right','Top','Bottom']),null,heading('Quarters'),...tiles(['Top Left','Top Right','Bottom Left','Bottom Right']),null,heading('Arrange'),...tiles(['Left & Right','Left & Quarters','Right & Left','Right & Quarters','Top & Bottom','Top & Quarters','Bottom & Top','Bottom & Quarters','Quarters']),null,off('Return to Previous Size',NO.tile,'fn ⌃R')]},off('Full Screen Tile',NO.tile),null,
   off('Remove Window from Set',NO.os),key('Cycle Through Windows','⌘`','cycle-views',['1']),null,
   off('Bring All to Front',NO.os),off('Arrange in Front',NO.os),null,
   key('Open Main Window','⌘1','show-tracks'),{label:'Open Mixer',shortcut:'⌘2',run:a.openMixer},null,
   off('Open Smart Controls',NO.smart),{label:'Open Piano Roll',shortcut:'⌘4',run:()=>a.openEditor('piano')},off('Open Score Editor',NO.score,'⌘5'),{label:'Open Step Sequencer',shortcut:'⌘3',run:()=>a.openEditor('step')},off('Open Step Editor','Edit note velocities in the Piano Roll’s velocity lane.'),{label:'Open Audio Track Editor',run:()=>a.openEditor('audio')},{label:'Open Audio File Editor',shortcut:'⌘6',run:()=>a.openEditor('audio')},off('Open Smart Tempo Editor','Freestyle has no Smart Tempo.'),null,
   off('Open Event List',NO.list,'⌘7'),off('Open Signature List',NO.list),off('Open Project Audio','The project’s audio files are listed in Project Files (O).','⌘8'),null,
   {label:'Open MIDI Transform',shortcut:'⌘9',run:a.openTransform,disabled:!piano,title:piano?'':'Open the Piano Roll (P) and select notes first.'},null,
   off('Open Transport Float','The transport is in the control bar.'),off('Event Float',NO.list,'⌥E'),off('Region Inspector Float','The Region inspector is in the Inspector (I).','⌥⇧R'),null,
   {label:'Play Surface',shortcut:'⌘K',checked:a.musicalTypingOpen(),run:a.toggleMusicalTyping,title:'Opens Musical Typing (the on-screen keyboard played from the computer keys).'},{label:'Musical Typing',checked:a.musicalTypingOpen(),run:a.toggleMusicalTyping},off('Step Input Keyboard','Step input is not available; record notes with R and Musical Typing.','⌥⌘K'),null,
   {label:'All Plug-in Windows',shortcut:'V',run:a.togglePluginWindows}];
 };
 const Help=()=>[
  off('Quick Help','Every control shows its help as a tooltip when you point at it; there is no Quick Help pane.','⇧/'),
  {label:'Quick Help appears as',submenu:[off('Inspector Pane','There is no Quick Help pane.'),off('Floating Window','There is no Quick Help pane.'),{label:'Bubbles at Pointer Location',checked:true,disabled:true,title:'Help is shown as tooltips at the pointer.'}]},null,
  {label:'Trashlab Help',run:a.help,title:'Key commands and pointer gestures (also ⌘/).'},off('Trashlab Instruments',NO.help),off('Trashlab Effects',NO.help),off('Trashlab Control Surfaces Support','There are no control surface assignments.'),null,
  off('What’s New in Trashlab','See the README in the project repository.'),off('Release Notes','See the README in the project repository.'),null,
  off('Trashlab Support',NO.help),{label:'Trashlab on the Web',run:a.docs,title:'Opens the Freestyle documentation.'},off('Trashlab Discussions',NO.help),{label:'Create Support Profile…',run:a.diagnostics,title:'Connection and interaction diagnostics for a support report.'}];
 return{File,Edit,Track,Navigate,Record,Mix,View,Window,Help};
}
